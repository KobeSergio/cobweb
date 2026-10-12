import { App } from 'aws-cdk-lib'
import { Match, Template } from 'aws-cdk-lib/assertions'
import { describe, expect, it } from 'vitest'
import { RenderStack } from '../lib/render-stack.ts'

/**
 * The synthesized template. Bundling is skipped (`aws:cdk:bundling-stacks` empty), so these tests
 * need no esbuild run, no npm install, no Docker and no AWS credentials.
 */
function synth(): Template {
  const app = new App({ context: { 'aws:cdk:bundling-stacks': [] } })
  return Template.fromStack(new RenderStack(app, 'CobwebRender', { env: { region: 'us-east-1' } }))
}

type Resource = { Type: string; Properties: Record<string, unknown> }
type Statement = { Effect: string; Action: string | string[]; Resource?: unknown }

const template = synth()
const resources = Object.entries(template.toJSON().Resources as Record<string, Resource>)
const ofType = (type: string) => resources.filter(([, resource]) => resource.Type === type)
const logicalId = (prefix: string, type: string) => {
  const found = ofType(type).find(([id]) => id.startsWith(prefix))
  if (!found) throw new Error(`No ${type} named ${prefix}`)
  return found[0]
}
const propertiesOf = (prefix: string, type: string) =>
  resources.find(([id, resource]) => id.startsWith(prefix) && resource.Type === type)![1].Properties

/** The role policy statements of the function whose logical id starts with `prefix`. */
function statementsOf(prefix: string): Statement[] {
  return ofType('AWS::IAM::Policy')
    .filter(([id]) => id.startsWith(`${prefix}ServiceRoleDefaultPolicy`))
    .flatMap(([, policy]) => (policy.Properties.PolicyDocument as { Statement: Statement[] }).Statement)
}
const actionsOf = (prefix: string) => statementsOf(prefix).flatMap((statement) => statement.Action)
const touchesArtBucket = (statement: Statement) => JSON.stringify(statement.Resource).includes('ArtBucketArn')

const LITERAL_BUCKET_OBJECTS = /^arn:aws[a-z-]*:s3:::[a-z0-9.-]{3,63}\/\*$/

/**
 * The entries of a statement's Resource that carry a wildcard. The one allowed form is a trailing
 * `/*` directly after a bucket ARN: a literal bucket ARN with `/*`, or a CloudFormation join whose
 * last part is `/*` and whose part before it is a reference to the ARN. Everything else with a `*`
 * (`arn:aws:s3:::*`, `arn:aws:sqs:us-east-1:123456789012:*`, `*`) is returned.
 */
function wildResources(statement: Statement): string[] {
  const wild: string[] = []
  for (const entry of [statement.Resource].flat()) {
    if (typeof entry === 'string') {
      if (entry.includes('*') && !LITERAL_BUCKET_OBJECTS.test(entry)) wild.push(entry)
      continue
    }
    const join = (entry as { 'Fn::Join'?: [string, unknown[]] } | null)?.['Fn::Join']
    if (!join) {
      if (JSON.stringify(entry).includes('*')) wild.push(JSON.stringify(entry))
      continue
    }
    const [separator, parts] = join
    const last = parts.length - 1
    const allowed = (part: unknown, index: number) =>
      typeof part !== 'string' ||
      !part.includes('*') ||
      (part === '/*' &&
        separator === '' &&
        index === last &&
        index > 0 &&
        typeof parts[index - 1] === 'object')
    if (!parts.every(allowed)) wild.push(JSON.stringify(entry))
  }
  return wild
}

/**
 * The actions an Allow statement grants that are `*` or a whole service (`s3:*`). `s3:Abort*` is
 * narrower. A Deny is not counted: the TLS-only policies that `enforceSSL` adds deny `s3:*` and
 * `sqs:*` on plain HTTP, which takes access away.
 */
function wideActions(statement: Statement): string[] {
  if (statement.Effect !== 'Allow') return []
  return [statement.Action].flat().filter((action) => action === '*' || action.endsWith(':*'))
}

describe('the wildcard check', () => {
  const statement = (Resource: unknown, Action: string | string[] = 's3:GetObject'): Statement => ({
    Effect: 'Allow',
    Action,
    Resource,
  })
  const bucketArn = { 'Fn::GetAtt': ['RenderBucket', 'Arn'] }

  it('accepts a trailing /* directly after a bucket ARN and nothing else', () => {
    expect(wildResources(statement({ 'Fn::Join': ['', [bucketArn, '/*']] }))).toEqual([])
    expect(wildResources(statement({ 'Fn::Join': ['', [{ Ref: 'ArtBucketArn' }, '/*']] }))).toEqual([])
    expect(wildResources(statement('arn:aws:s3:::some-bucket/*'))).toEqual([])
    expect(wildResources(statement([bucketArn, { Ref: 'Secret' }]))).toEqual([])
  })

  it('refuses every other wildcard in a resource, as a string or inside a join', () => {
    for (const bad of [
      '*',
      'arn:aws:s3:::*',
      'arn:aws:sqs:us-east-1:123456789012:*',
      'arn:aws:s3:::some-bucket/*/*',
      { 'Fn::Join': ['', ['arn:aws:s3:::', '*']] },
      { 'Fn::Join': ['', [bucketArn, '/*', '/more']] },
      { 'Fn::Join': ['', ['/*']] },
      { 'Fn::Join': ['', [bucketArn, '*']] },
      { 'Fn::Join': ['', ['arn:aws:', { Ref: 'AWS::Partition' }, ':s3:::*']] },
    ])
      expect(wildResources(statement(bad)), JSON.stringify(bad)).not.toEqual([])
  })

  it('refuses Action * and a service-wide action, and allows a narrow suffix wildcard', () => {
    expect(wideActions(statement('x', '*'))).toEqual(['*'])
    expect(wideActions(statement('x', ['s3:GetObject', 's3:*']))).toEqual(['s3:*'])
    expect(wideActions(statement('x', ['sqs:*']))).toEqual(['sqs:*'])
    expect(wideActions(statement('x', ['s3:Abort*', 's3:PutObject']))).toEqual([])
    expect(wideActions({ ...statement('x', 's3:*'), Effect: 'Deny' })).toEqual([])
  })
})

describe('queues', () => {
  it('redrives the render queue to the dead-letter queue after three receives', () => {
    template.hasResourceProperties('AWS::SQS::Queue', {
      VisibilityTimeout: 3600,
      RedrivePolicy: {
        maxReceiveCount: 3,
        deadLetterTargetArn: { 'Fn::GetAtt': [logicalId('RenderDeadLetters', 'AWS::SQS::Queue'), 'Arn'] },
      },
    })
    template.resourceCountIs('AWS::SQS::Queue', 2)
  })

  it('gives the dead-letter queue no redrive of its own and keeps its messages 14 days', () => {
    const properties = propertiesOf('RenderDeadLetters', 'AWS::SQS::Queue')
    expect(properties).not.toHaveProperty('RedrivePolicy')
    expect(properties.MessageRetentionPeriod).toBe(14 * 24 * 60 * 60)
  })

  it('gives each queue a visibility timeout of six times the timeout of the function that reads it', () => {
    const mappings = ofType('AWS::Lambda::EventSourceMapping').map(([, mapping]) => mapping.Properties)
    expect(mappings).toHaveLength(2)
    const expected = { RenderFunction: [600, 3600], DeadLetterFunction: [60, 360] } as const
    for (const [name, [timeout, visibility]] of Object.entries(expected)) {
      const functionId = logicalId(name, 'AWS::Lambda::Function')
      const mapping = mappings.find(
        (candidate) => (candidate.FunctionName as { Ref: string }).Ref === functionId,
      )
      const queueId = (mapping?.EventSourceArn as { 'Fn::GetAtt': string[] })['Fn::GetAtt'][0]!
      const queue = template.toJSON().Resources[queueId] as Resource
      const fn = template.toJSON().Resources[functionId] as Resource
      expect(fn.Properties.Timeout, name).toBe(timeout)
      expect(queue.Properties.VisibilityTimeout, name).toBe(visibility)
      expect(queue.Properties.VisibilityTimeout, name).toBe((fn.Properties.Timeout as number) * 6)
    }
  })
})

describe('the dead-letter alarm', () => {
  it('watches the visible messages of the dead-letter queue, five minutes at a time', () => {
    template.resourceCountIs('AWS::CloudWatch::Alarm', 1)
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      Namespace: 'AWS/SQS',
      MetricName: 'ApproximateNumberOfMessagesVisible',
      Dimensions: [
        {
          Name: 'QueueName',
          Value: { 'Fn::GetAtt': [logicalId('RenderDeadLetters', 'AWS::SQS::Queue'), 'QueueName'] },
        },
      ],
      Statistic: 'Maximum',
      Period: 300,
      EvaluationPeriods: 1,
      Threshold: 1,
      ComparisonOperator: 'GreaterThanOrEqualToThreshold',
      TreatMissingData: 'notBreaching',
    })
  })

  it('notifies no one yet: no action and no topic are wired', () => {
    const alarm = propertiesOf('RenderDeadLettersAlarm', 'AWS::CloudWatch::Alarm')
    expect(alarm).not.toHaveProperty('AlarmActions')
    expect(alarm).not.toHaveProperty('OKActions')
    template.resourceCountIs('AWS::SNS::Topic', 0)
    template.resourceCountIs('AWS::SNS::Subscription', 0)
  })
})

describe('functions', () => {
  it('run Node 22 on arm64, all three', () => {
    const functions = ofType('AWS::Lambda::Function')
    expect(functions.map(([id]) => id.replace(/[0-9A-F]{8}$/, '')).sort()).toEqual([
      'DeadLetterFunction',
      'RenderFunction',
      'SweepFunction',
    ])
    for (const [, fn] of functions) {
      expect(fn.Properties.Runtime).toBe('nodejs22.x')
      expect(fn.Properties.Architectures).toEqual(['arm64'])
      expect(fn.Properties.Handler).toBe('index.handler')
    }
  })

  it('give the render function its memory, timeout and ephemeral storage', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      MemorySize: 4096,
      Timeout: 600,
      EphemeralStorage: { Size: 4096 },
    })
  })

  it('read each queue one message at a time and report partial failures', () => {
    const mappings = ofType('AWS::Lambda::EventSourceMapping').map(([, mapping]) => mapping.Properties)
    expect(mappings).toHaveLength(2)
    for (const mapping of mappings) {
      expect(mapping.BatchSize).toBe(1)
      expect(mapping.FunctionResponseTypes).toEqual(['ReportBatchItemFailures'])
    }
    const sourceOf = (fn: string) =>
      mappings.find(
        (mapping) => (mapping.FunctionName as { Ref: string }).Ref === logicalId(fn, 'AWS::Lambda::Function'),
      )?.EventSourceArn
    expect(sourceOf('RenderFunction')).toEqual({
      'Fn::GetAtt': [logicalId('RenderQueue', 'AWS::SQS::Queue'), 'Arn'],
    })
    expect(sourceOf('DeadLetterFunction')).toEqual({
      'Fn::GetAtt': [logicalId('RenderDeadLetters', 'AWS::SQS::Queue'), 'Arn'],
    })
  })

  it('run the sweep every 15 minutes', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      ScheduleExpression: 'rate(15 minutes)',
      Targets: [
        Match.objectLike({
          Arn: { 'Fn::GetAtt': [logicalId('SweepFunction', 'AWS::Lambda::Function'), 'Arn'] },
        }),
      ],
    })
  })

  it('set NODE_ENV to production and never override AWS_REGION, on all three', () => {
    const functions = ofType('AWS::Lambda::Function')
    expect(functions).toHaveLength(3)
    for (const [id, fn] of functions) {
      const variables = (fn.Properties.Environment as { Variables: Record<string, unknown> }).Variables
      expect(variables.NODE_ENV, id).toBe('production')
      expect(variables, id).not.toHaveProperty('AWS_REGION')
      expect(variables, id).not.toHaveProperty('AWS_DEFAULT_REGION')
    }
    expect(JSON.stringify(template.toJSON())).not.toContain('AWS_REGION')
  })
})

describe('the render bucket', () => {
  it('is private, with public access blocked, encrypted, TLS only and retained', () => {
    template.resourceCountIs('AWS::S3::Bucket', 1)
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          Match.objectLike({ ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }),
        ],
      },
    })
    template.hasResource('AWS::S3::Bucket', { DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain' })
    template.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Deny',
            Action: 's3:*',
            Condition: { Bool: { 'aws:SecureTransport': 'false' } },
          }),
        ]),
      },
    })
  })

  it('has no object deleter and no custom resource that would empty it', () => {
    template.resourceCountIs('Custom::S3AutoDeleteObjects', 0)
    expect(JSON.stringify(template.toJSON())).not.toContain('autoDeleteObjects')
  })
})

describe('roles', () => {
  const statements = resources.flatMap(
    ([, resource]) =>
      (resource.Properties?.PolicyDocument as { Statement?: Statement[] } | undefined)?.Statement ?? [],
  )

  it('have no statement with a wildcard resource other than /* after a bucket ARN', () => {
    expect(statements.length).toBeGreaterThan(8)
    for (const statement of statements) {
      expect(statement.Resource).toBeDefined()
      expect(wildResources(statement), JSON.stringify(statement)).toEqual([])
    }
  })

  it('have no statement with Action * or a service-wide action', () => {
    for (const statement of statements) expect(wideActions(statement), JSON.stringify(statement)).toEqual([])
  })

  it('let the render function read the art bucket objects and list the bucket, and nothing wider', () => {
    const artStatements = statementsOf('RenderFunction').filter(touchesArtBucket)
    expect(artStatements).toHaveLength(2)
    expect(artStatements).toEqual(
      expect.arrayContaining([
        {
          Effect: 'Allow',
          Action: 's3:GetObject',
          Resource: { 'Fn::Join': ['', [{ Ref: 'ArtBucketArn' }, '/*']] },
        },
        { Effect: 'Allow', Action: 's3:ListBucket', Resource: { Ref: 'ArtBucketArn' } },
      ]),
    )
  })

  it('keep the dead-letter and sweep functions away from the art bucket', () => {
    for (const name of ['DeadLetterFunction', 'SweepFunction'])
      expect(statementsOf(name).filter(touchesArtBucket), name).toEqual([])
  })

  it('give each function only what it uses', () => {
    const render = actionsOf('RenderFunction')
    expect(render).toEqual(expect.arrayContaining(['s3:GetObject', 's3:ListBucket', 's3:PutObject']))
    expect(render).toEqual(expect.arrayContaining(['sqs:SendMessage', 'sqs:ReceiveMessage']))
    expect(render).toEqual(expect.arrayContaining(['secretsmanager:GetSecretValue']))
    expect(render).not.toContain('s3:DeleteObject*')
    expect(render).not.toContain('s3:DeleteObject')

    const dead = actionsOf('DeadLetterFunction')
    expect(dead).toEqual(expect.arrayContaining(['sqs:ReceiveMessage', 'secretsmanager:GetSecretValue']))
    expect(dead.filter((action) => action.startsWith('s3:'))).toEqual([])
    expect(dead).not.toContain('sqs:SendMessage')

    const sweep = actionsOf('SweepFunction')
    expect(sweep).toEqual(expect.arrayContaining(['sqs:SendMessage', 'secretsmanager:GetSecretValue']))
    expect(sweep.filter((action) => action.startsWith('s3:'))).toEqual([])
    expect(sweep).not.toContain('sqs:ReceiveMessage')
  })
})

describe('secrets', () => {
  const text = JSON.stringify(template.toJSON())

  it('are one secret whose value is not in the template', () => {
    const secrets = ofType('AWS::SecretsManager::Secret')
    expect(secrets).toHaveLength(1)
    expect(secrets[0]![1].Properties).not.toHaveProperty('SecretString')
    expect(text).not.toContain('"SecretString"')
  })

  it('reach the functions as the secret ARN only: no key, no RPC URL in any environment', () => {
    for (const [, fn] of ofType('AWS::Lambda::Function')) {
      const variables = (fn.Properties.Environment as { Variables: Record<string, unknown> }).Variables
      expect(Object.keys(variables).sort()).toEqual([
        'ART_S3_BUCKET',
        'ART_S3_REGION',
        'FILEBASE_BUCKET',
        'FILEBASE_S3_ENDPOINT',
        'NODE_ENV',
        'RENDER_QUEUE_URL',
        'RENDER_S3_BUCKET',
        'RENDER_SECRET_ARN',
        'SUPABASE_URL',
      ])
      expect(variables.RENDER_SECRET_ARN).toEqual({
        Ref: logicalId('RenderSecrets', 'AWS::SecretsManager::Secret'),
      })
    }
    for (const name of [
      'SUPABASE_SERVICE_ROLE_KEY',
      'FILEBASE_ACCESS_KEY_ID',
      'FILEBASE_SECRET_ACCESS_KEY',
      'ART_S3_ACCESS_KEY_ID',
      'ART_S3_SECRET_ACCESS_KEY',
      'SERVICE_ROLE_KEY',
      'ACCESS_KEY_ID',
      'SECRET_ACCESS_KEY',
      'RPC_URL',
      'NEXT_PUBLIC_',
    ])
      expect(text).not.toContain(name)
  })

  it('take every deploy-time value as a parameter with no default that could be a secret', () => {
    const parameters = template.toJSON().Parameters as Record<string, { Default?: string }>
    expect(
      Object.keys(parameters)
        .filter((name) => name !== 'BootstrapVersion')
        .sort(),
    ).toEqual(['ArtBucketArn', 'ArtBucketRegion', 'FilebaseBucket', 'SupabaseUrl'])
    expect(parameters.ArtBucketRegion?.Default).toBe('us-east-1')
    expect(parameters.SupabaseUrl?.Default).toBeUndefined()
  })
})
