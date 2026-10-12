/**
 * The render pipeline on AWS (docs/specs/2026-10-12-render-worker.md, section 9): a queue with a
 * dead-letter queue and an alarm on the dead-letter function, the render function, the dead-letter
 * function, the sweep on a 15 minute rule, a private bucket for collages and two secrets. Nothing
 * secret is written here: each secret is created with a generated placeholder and its real value is
 * put in place by hand after the first deploy (infra/README.md).
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CfnOutput, CfnParameter, Duration, Fn, RemovalPolicy, Size, Stack } from 'aws-cdk-lib'
import type { StackProps } from 'aws-cdk-lib'
import { ComparisonOperator, TreatMissingData } from 'aws-cdk-lib/aws-cloudwatch'
import { Rule, Schedule } from 'aws-cdk-lib/aws-events'
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets'
import { PolicyStatement } from 'aws-cdk-lib/aws-iam'
import { Architecture, Runtime } from 'aws-cdk-lib/aws-lambda'
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources'
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs'
import type { BundlingOptions } from 'aws-cdk-lib/aws-lambda-nodejs'
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs'
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3'
import { Secret } from 'aws-cdk-lib/aws-secretsmanager'
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs'
import type { Construct } from 'constructs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const lambdaDir = resolve(repoRoot, 'services/worker/src/lambda')

/** Starting points from PLAN.md; the benchmark on Lambda itself is owed (infra/README.md). */
export const RENDER_MEMORY_MB = 4096
export const RENDER_TIMEOUT = Duration.minutes(10)
export const RENDER_EPHEMERAL_MB = 4096
export const MAX_RECEIVES = 3
/**
 * The most render functions that run at once. A 10,000 token job sends 100 batch messages; without a
 * cap they would all run together, and Filebase's limits on simultaneous CAR uploads are not known.
 * Revisited after a benchmark on Lambda and once those limits are known.
 */
export const MAX_RENDER_CONCURRENCY = 10

/** The dead-letter and sweep functions: small, and one minute is far more than they need. */
const SMALL_MEMORY_MB = 512
const SMALL_TIMEOUT = Duration.minutes(1)

/** A queue's visibility timeout is six times the timeout of the function that reads it. */
const visibilityFor = (timeout: Duration) => Duration.seconds(timeout.toSeconds() * 6)

/** Where the pinned sharp install lives: package.json and package-lock.json, for linux arm64. */
const lambdaDepsDir = resolve(repoRoot, 'infra/lambda-deps')

/**
 * esbuild bundles everything, the AWS SDK included, so the versions are the lock file's. sharp is
 * the exception: it loads a native binary at run time, so it stays external and is installed beside
 * the bundle from infra/lambda-deps/package-lock.json (sharp at the render library's version, with
 * integrity hashes) by `npm ci`: never a bare `npm install`, and install scripts are off. No Docker
 * is involved. All three functions get it: each imports the worker's steps, which load the render
 * library.
 */
const BUNDLING: BundlingOptions = {
  bundleAwsSDK: true,
  externalModules: ['sharp'],
  commandHooks: {
    beforeBundling: () => [],
    beforeInstall: () => [],
    afterBundling: (_inputDir: string, outputDir: string) => [
      `cp "${lambdaDepsDir}/package.json" "${lambdaDepsDir}/package-lock.json" "${outputDir}/"`,
      `cd "${outputDir}" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund --os=linux --cpu=arm64 --libc=glibc`,
      // An npm that ignored the platform flags would bundle the build host's sharp: fail the synth instead.
      `test -d "${outputDir}/node_modules/@img/sharp-linux-arm64"`,
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
    // Never emptied on stack deletion: the collages are kept.
    const renderBucket = new Bucket(this, 'RenderBucket', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
    })
    // Each is created with a generated placeholder nobody uses. Its real value, a JSON object, is put in
    // place by hand (infra/README.md), so no secret ever passes through a template. Two, so the dead-letter
    // and sweep functions can read the Supabase key without being able to read the storage, Filebase and
    // RPC keys. Logical ids and properties are pinned by a test: a replacement would lose the value.
    const secret = new Secret(this, 'RenderSecrets', {
      description:
        'Cobweb render worker, render function only: the Supabase service key, the art storage keys, the Filebase keys and the RPC URLs.',
      removalPolicy: RemovalPolicy.RETAIN,
    })
    const jobsSecret = new Secret(this, 'JobsSecrets', {
      description: 'Cobweb render worker, dead-letter and sweep functions: the Supabase service key only.',
      removalPolicy: RemovalPolicy.RETAIN,
    })

    // AWS_REGION is not set here: Lambda sets it, and the SQS and S3 clients rely on that. Each function
    // gets only the names it reads; the keys come from its own secret.
    const base = {
      NODE_ENV: 'production',
      SUPABASE_URL: supabaseUrl.valueAsString,
      RENDER_QUEUE_URL: queue.queueUrl,
    }
    const common = {
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      projectRoot: repoRoot,
      depsLockFilePath: resolve(repoRoot, 'pnpm-lock.yaml'),
      bundling: BUNDLING,
    }
    /** A log group the stack owns: 30 days, and kept when the stack is deleted. */
    const logsOf = (name: string) =>
      new LogGroup(this, `${name}LogGroup`, {
        retention: RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.RETAIN,
      })

    const render = new NodejsFunction(this, 'RenderFunction', {
      ...common,
      entry: resolve(lambdaDir, 'render.ts'),
      memorySize: RENDER_MEMORY_MB,
      timeout: RENDER_TIMEOUT,
      ephemeralStorageSize: Size.mebibytes(RENDER_EPHEMERAL_MB),
      logGroup: logsOf('RenderFunction'),
      environment: {
        ...base,
        ART_S3_BUCKET: Fn.select(5, Fn.split(':', artBucketArn.valueAsString)),
        ART_S3_REGION: artBucketRegion.valueAsString,
        RENDER_S3_BUCKET: renderBucket.bucketName,
        FILEBASE_S3_ENDPOINT: 'https://s3.filebase.com',
        FILEBASE_BUCKET: filebaseBucket.valueAsString,
        RENDER_SECRET_ARN: secret.secretArn,
      },
    })
    render.addEventSource(
      new SqsEventSource(queue, {
        batchSize: 1,
        reportBatchItemFailures: true,
        maxConcurrency: MAX_RENDER_CONCURRENCY,
      }),
    )
    // Reading objects needs GetObject on the objects; ListBucket on the bucket itself is what makes S3
    // answer 404 instead of 403 for a missing key, and the worker treats only a true not-found as
    // missing art.
    render.addToRolePolicy(
      new PolicyStatement({ actions: ['s3:GetObject'], resources: [`${artBucketArn.valueAsString}/*`] }),
    )
    render.addToRolePolicy(
      new PolicyStatement({ actions: ['s3:ListBucket'], resources: [artBucketArn.valueAsString] }),
    )
    // The worker only puts collages: one action, on the bucket's objects (grantPut adds legal hold,
    // retention, tagging and abort as well).
    render.addToRolePolicy(
      new PolicyStatement({ actions: ['s3:PutObject'], resources: [`${renderBucket.bucketArn}/*`] }),
    )
    queue.grantSendMessages(render)
    secret.grantRead(render)

    const dead = new NodejsFunction(this, 'DeadLetterFunction', {
      ...common,
      entry: resolve(lambdaDir, 'dead.ts'),
      memorySize: SMALL_MEMORY_MB,
      timeout: SMALL_TIMEOUT,
      logGroup: logsOf('DeadLetterFunction'),
      environment: {
        ...base,
        RENDER_DEAD_LETTER_QUEUE_URL: deadLetters.queueUrl,
        JOBS_SECRET_ARN: jobsSecret.secretArn,
      },
    })
    dead.addEventSource(new SqsEventSource(deadLetters, { batchSize: 1, reportBatchItemFailures: true }))
    jobsSecret.grantRead(dead)

    const sweep = new NodejsFunction(this, 'SweepFunction', {
      ...common,
      entry: resolve(lambdaDir, 'sweep.ts'),
      memorySize: SMALL_MEMORY_MB,
      timeout: SMALL_TIMEOUT,
      logGroup: logsOf('SweepFunction'),
      environment: { ...base, JOBS_SECRET_ARN: jobsSecret.secretArn },
    })
    // Sending also grants sqs:GetQueueAttributes on the queue, which the sweep reads the backlog with.
    queue.grantSendMessages(sweep)
    jobsSecret.grantRead(sweep)
    new Rule(this, 'SweepRule', {
      schedule: Schedule.rate(Duration.minutes(15)),
      targets: [new LambdaFunction(sweep)],
    })

    // The dead-letter function empties the dead-letter queue, so the queue's own depth is never above
    // zero for long. The function runs only when a message dies, so an invocation is the signal.
    // No notification target is wired here: infra/README.md says where to attach one.
    dead
      .metricInvocations({ period: Duration.minutes(5), statistic: 'Sum' })
      .createAlarm(this, 'RenderDeadLettersAlarm', {
        alarmDescription: 'A render job message died: the dead-letter function ran.',
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: TreatMissingData.NOT_BREACHING,
      })

    new CfnOutput(this, 'RenderQueueUrl', { value: queue.queueUrl })
    new CfnOutput(this, 'RenderBucketName', { value: renderBucket.bucketName })
    new CfnOutput(this, 'RenderSecretArn', { value: secret.secretArn })
    new CfnOutput(this, 'JobsSecretArn', { value: jobsSecret.secretArn })
  }
}
