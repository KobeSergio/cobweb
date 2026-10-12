/**
 * The render pipeline on AWS (docs/specs/2026-10-12-render-worker.md, section 9): a queue with a
 * dead-letter queue and an alarm on it, the render function, the dead-letter function, the sweep on
 * a 15 minute rule, a private bucket for collages and one secret. Nothing secret is written here:
 * the secret is created with a generated placeholder and its real value is put in place by hand
 * after the first deploy (infra/README.md).
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CfnParameter, Duration, Fn, RemovalPolicy, Size, Stack } from 'aws-cdk-lib'
import type { StackProps } from 'aws-cdk-lib'
import { ComparisonOperator, TreatMissingData } from 'aws-cdk-lib/aws-cloudwatch'
import { Rule, Schedule } from 'aws-cdk-lib/aws-events'
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets'
import { PolicyStatement } from 'aws-cdk-lib/aws-iam'
import { Architecture, Runtime } from 'aws-cdk-lib/aws-lambda'
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources'
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs'
import type { BundlingOptions } from 'aws-cdk-lib/aws-lambda-nodejs'
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3'
import { Secret } from 'aws-cdk-lib/aws-secretsmanager'
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs'
import type { Construct } from 'constructs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const lambdaDir = resolve(repoRoot, 'services/worker/src/lambda')

/** The render library's exact sharp pin, so the Lambda runs the version the CIDs were proven with. */
const SHARP_VERSION = (
  JSON.parse(readFileSync(resolve(repoRoot, 'services/render/package.json'), 'utf8')) as {
    dependencies: { sharp: string }
  }
).dependencies.sharp

/** Starting points from PLAN.md; the benchmark on Lambda itself is owed (infra/README.md). */
export const RENDER_MEMORY_MB = 4096
export const RENDER_TIMEOUT = Duration.minutes(10)
export const RENDER_EPHEMERAL_MB = 4096
export const MAX_RECEIVES = 3

/** The dead-letter and sweep functions: small, and one minute is far more than they need. */
const SMALL_MEMORY_MB = 512
const SMALL_TIMEOUT = Duration.minutes(1)

/** A queue's visibility timeout is six times the timeout of the function that reads it. */
const visibilityFor = (timeout: Duration) => Duration.seconds(timeout.toSeconds() * 6)

/**
 * esbuild bundles everything, the AWS SDK included, so the versions are the lock file's. sharp is
 * the exception: it loads a native binary at run time, so it stays external and its linux arm64
 * build is installed beside the bundle with npm (which ships with Node). No Docker is involved. All
 * three functions get it: each imports the worker's steps, which load the render library.
 */
const BUNDLING: BundlingOptions = {
  bundleAwsSDK: true,
  externalModules: ['sharp'],
  commandHooks: {
    beforeBundling: () => [],
    beforeInstall: () => [],
    afterBundling: (_inputDir: string, outputDir: string) => [
      `npm install --prefix "${outputDir}" --no-save --no-package-lock --no-audit --no-fund --os=linux --cpu=arm64 --libc=glibc sharp@${SHARP_VERSION}`,
    ],
  },
}

export class RenderStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props)

    const artBucketArn = new CfnParameter(this, 'ArtBucketArn', {
      type: 'String',
      description: 'ARN of the bucket that holds layer images, assets and placeholders. Read only.',
      allowedPattern: '^arn:aws[a-z-]*:s3:::[a-z0-9.-]{3,63}$',
    })
    const artBucketRegion = new CfnParameter(this, 'ArtBucketRegion', {
      type: 'String',
      default: 'us-east-1',
      description: 'Region of the art bucket.',
    })
    const supabaseUrl = new CfnParameter(this, 'SupabaseUrl', {
      type: 'String',
      description: 'The Supabase project URL. Not a secret.',
      allowedPattern: '^https://.+$',
    })
    const filebaseBucket = new CfnParameter(this, 'FilebaseBucket', {
      type: 'String',
      description: 'The Filebase IPFS bucket the CARs are uploaded to.',
    })

    // The dead-letter queue has no redrive of its own. Its retention is set, not defaulted.
    const deadLetters = new Queue(this, 'RenderDeadLetters', {
      retentionPeriod: Duration.days(14),
      visibilityTimeout: visibilityFor(SMALL_TIMEOUT),
      encryption: QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
    })
    const queue = new Queue(this, 'RenderQueue', {
      visibilityTimeout: visibilityFor(RENDER_TIMEOUT),
      deadLetterQueue: { queue: deadLetters, maxReceiveCount: MAX_RECEIVES },
      encryption: QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
    })
    // A dead message the dead-letter function could not act on stays visible; a person must see it.
    // No notification target is wired here: infra/README.md says where to attach one.
    deadLetters
      .metricApproximateNumberOfMessagesVisible({ period: Duration.minutes(5), statistic: 'Maximum' })
      .createAlarm(this, 'RenderDeadLettersAlarm', {
        alarmDescription: 'A render job message is on the dead-letter queue and has not been cleared.',
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: TreatMissingData.NOT_BREACHING,
      })

    // Never emptied on stack deletion: the collages are kept.
    const renderBucket = new Bucket(this, 'RenderBucket', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
    })
    // Created with a generated placeholder nobody uses. Its real value, a JSON object, is put in
    // place by hand (infra/README.md), so no secret ever passes through a template.
    const secret = new Secret(this, 'RenderSecrets', {
      description: 'Cobweb render worker: the Supabase service key, the Filebase keys and the RPC URLs.',
      removalPolicy: RemovalPolicy.RETAIN,
    })

    // AWS_REGION is not set here: Lambda sets it, and the SQS and S3 clients rely on that.
    const environment = {
      NODE_ENV: 'production',
      SUPABASE_URL: supabaseUrl.valueAsString,
      ART_S3_BUCKET: Fn.select(5, Fn.split(':', artBucketArn.valueAsString)),
      ART_S3_REGION: artBucketRegion.valueAsString,
      RENDER_S3_BUCKET: renderBucket.bucketName,
      FILEBASE_S3_ENDPOINT: 'https://s3.filebase.com',
      FILEBASE_BUCKET: filebaseBucket.valueAsString,
      RENDER_QUEUE_URL: queue.queueUrl,
      RENDER_SECRET_ARN: secret.secretArn,
    }
    const common = {
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      projectRoot: repoRoot,
      depsLockFilePath: resolve(repoRoot, 'pnpm-lock.yaml'),
      environment,
      bundling: BUNDLING,
    }

    const render = new NodejsFunction(this, 'RenderFunction', {
      ...common,
      entry: resolve(lambdaDir, 'render.ts'),
      memorySize: RENDER_MEMORY_MB,
      timeout: RENDER_TIMEOUT,
      ephemeralStorageSize: Size.mebibytes(RENDER_EPHEMERAL_MB),
    })
    render.addEventSource(new SqsEventSource(queue, { batchSize: 1, reportBatchItemFailures: true }))
    // Reading objects needs GetObject on the objects; ListBucket on the bucket itself is what makes S3
    // answer 404 instead of 403 for a missing key, and the worker treats only a true not-found as
    // missing art.
    render.addToRolePolicy(
      new PolicyStatement({ actions: ['s3:GetObject'], resources: [`${artBucketArn.valueAsString}/*`] }),
    )
    render.addToRolePolicy(
      new PolicyStatement({ actions: ['s3:ListBucket'], resources: [artBucketArn.valueAsString] }),
    )
    renderBucket.grantPut(render)
    queue.grantSendMessages(render)
    secret.grantRead(render)

    const dead = new NodejsFunction(this, 'DeadLetterFunction', {
      ...common,
      entry: resolve(lambdaDir, 'dead.ts'),
      memorySize: SMALL_MEMORY_MB,
      timeout: SMALL_TIMEOUT,
    })
    dead.addEventSource(new SqsEventSource(deadLetters, { batchSize: 1, reportBatchItemFailures: true }))
    secret.grantRead(dead)

    const sweep = new NodejsFunction(this, 'SweepFunction', {
      ...common,
      entry: resolve(lambdaDir, 'sweep.ts'),
      memorySize: SMALL_MEMORY_MB,
      timeout: SMALL_TIMEOUT,
    })
    queue.grantSendMessages(sweep)
    secret.grantRead(sweep)
    new Rule(this, 'SweepRule', {
      schedule: Schedule.rate(Duration.minutes(15)),
      targets: [new LambdaFunction(sweep)],
    })
  }
}
