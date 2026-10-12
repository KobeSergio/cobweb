import { readFileSync } from 'node:fs'
import { App } from 'aws-cdk-lib'
import { Match, Template } from 'aws-cdk-lib/assertions'
import { describe, expect, it } from 'vitest'
import { MAX_RENDER_CONCURRENCY, RenderStack } from '../lib/render-stack.ts'

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
      // A part that is not text (a reference, a nested join) is looked into as a whole.
      (typeof part !== 'string' ? !JSON.stringify(part).includes('*') : !part.includes('*')) ||
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
 * The actions an Allow statement grants that carry a `*` anywhere: `*`, a whole service (`s3:*`) or a
 * prefix (`s3:Put*`, `s3:Abort*`). A Deny is not counted: the TLS-only policies that `enforceSSL` adds
 * deny `s3:*` and `sqs:*` on plain HTTP, which takes access away.
 */
function wideActions(statement: Statement): string[] {
  if (statement.Effect !== 'Allow') return []
  return [statement.Action].flat().filter((action) => action.includes('*'))
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
      { 'Fn::Join': ['', [{ 'Fn::Join': ['', ['arn:aws:s3:::*']] }, '/*']] },
      { 'Fn::Join': ['', [{ 'Fn::Join': ['', [bucketArn, '*']] }, '/objects']] },
    ])
      expect(wildResources(statement(bad)), JSON.stringify(bad)).not.toEqual([])
  })

  it('refuses any * in an Allow action: all, a service, or a prefix', () => {
    expect(wideActions(statement('x', '*'))).toEqual(['*'])
    expect(wideActions(statement('x', ['s3:GetObject', 's3:*']))).toEqual(['s3:*'])
    expect(wideActions(statement('x', ['sqs:*']))).toEqual(['sqs:*'])
    expect(wideActions(statement('x', ['s3:Abort*', 's3:PutObject']))).toEqual(['s3:Abort*'])
    expect(wideActions(statement('x', 's3:Put*'))).toEqual(['s3:Put*'])
    expect(wideActions(statement('x', ['s3:PutObject']))).toEqual([])
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
  it('watches the invocations of the dead-letter function, five minutes at a time', () => {
    template.resourceCountIs('AWS::CloudWatch::Alarm', 1)
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      Namespace: 'AWS/Lambda',
      MetricName: 'Invocations',
      Dimensions: [
        { Name: 'FunctionName', Value: { Ref: logicalId('DeadLetterFunction', 'AWS::Lambda::Function') } },
      ],
      Statistic: 'Sum',
      Period: 300,
      EvaluationPeriods: 1,
      Threshold: 1,
      ComparisonOperator: 'GreaterThanOrEqualToThreshold',
      TreatMissingData: 'notBreaching',
    })
  })

  it('does not watch the queue: the dead-letter function empties it', () => {
    const alarm = propertiesOf('RenderDeadLettersAlarm', 'AWS::CloudWatch::Alarm')
    expect(alarm.MetricName).not.toBe('ApproximateNumberOfMessagesVisible')
    expect(alarm.Namespace).not.toBe('AWS/SQS')
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

  it('cap the render event source at MAX_RENDER_CONCURRENCY, named, and leave the dead-letter one alone', () => {
    expect(MAX_RENDER_CONCURRENCY).toBe(10)
    const mappings = ofType('AWS::Lambda::EventSourceMapping').map(([, mapping]) => mapping.Properties)
    const renderId = logicalId('RenderFunction', 'AWS::Lambda::Function')
    const render = mappings.find((mapping) => (mapping.FunctionName as { Ref: string }).Ref === renderId)
    expect(render?.ScalingConfig).toEqual({ MaximumConcurrency: MAX_RENDER_CONCURRENCY })
    const others = mappings.filter((mapping) => mapping !== render)
    expect(others).toHaveLength(1)
    expect(others[0]).not.toHaveProperty('ScalingConfig')
    template.resourcePropertiesCountIs(
      'AWS::Lambda::Function',
      { ReservedConcurrentExecutions: Match.anyValue() },
      0,
    )
  })

  it('keep their logs 30 days, in log groups the stack names and keeps on deletion', () => {
    const groups = ofType('AWS::Logs::LogGroup')
    expect(groups).toHaveLength(3)
    for (const [, group] of groups) expect(group.Properties.RetentionInDays).toBe(30)
    template.resourceCountIs('Custom::LogRetention', 0)
    for (const name of ['RenderFunction', 'DeadLetterFunction', 'SweepFunction']) {
      const fn = propertiesOf(name, 'AWS::Lambda::Function')
      const logGroup = (fn.LoggingConfig as { LogGroup: { Ref: string } }).LogGroup.Ref
      expect(logGroup.startsWith(`${name}LogGroup`), name).toBe(true)
      expect(template.toJSON().Resources[logGroup].DeletionPolicy).toBe('Retain')
    }
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

  const sortedUnique = (actions: string[]) => [...new Set(actions)].sort()

  it('give each function exactly the actions it uses, nothing more', () => {
    expect(sortedUnique(actionsOf('RenderFunction'))).toEqual([
      's3:GetObject',
      's3:ListBucket',
      's3:PutObject',
      'secretsmanager:DescribeSecret',
      'secretsmanager:GetSecretValue',
      'sqs:ChangeMessageVisibility',
      'sqs:DeleteMessage',
      'sqs:GetQueueAttributes',
      'sqs:GetQueueUrl',
      'sqs:ReceiveMessage',
      'sqs:SendMessage',
    ])
    expect(sortedUnique(actionsOf('DeadLetterFunction'))).toEqual([
      'secretsmanager:DescribeSecret',
      'secretsmanager:GetSecretValue',
      'sqs:ChangeMessageVisibility',
      'sqs:DeleteMessage',
      'sqs:GetQueueAttributes',
      'sqs:GetQueueUrl',
      'sqs:ReceiveMessage',
    ])
    expect(sortedUnique(actionsOf('SweepFunction'))).toEqual([
      'secretsmanager:DescribeSecret',
      'secretsmanager:GetSecretValue',
      'sqs:GetQueueAttributes',
      'sqs:GetQueueUrl',
      'sqs:SendMessage',
    ])
  })

  it('write to the render bucket with s3:PutObject on its objects alone', () => {
    const puts = statementsOf('RenderFunction').filter((statement) =>
      [statement.Action].flat().some((action) => action.startsWith('s3:Put')),
    )
    expect(puts).toEqual([
      {
        Effect: 'Allow',
        Action: 's3:PutObject',
        Resource: {
          'Fn::Join': ['', [{ 'Fn::GetAtt': [logicalId('RenderBucket', 'AWS::S3::Bucket'), 'Arn'] }, '/*']],
        },
      },
    ])
  })

  it('let the sweep read the render queue attributes (the grant that sends covers it) and the dead-letter function change visibility', () => {
    const queueArn = { 'Fn::GetAtt': [logicalId('RenderQueue', 'AWS::SQS::Queue'), 'Arn'] }
    const sweep = statementsOf('SweepFunction').find((statement) =>
      [statement.Action].flat().includes('sqs:GetQueueAttributes'),
    )
    expect(sweep?.Resource).toEqual(queueArn)
    for (const [name, queue] of [
      ['RenderFunction', 'RenderQueue'],
      ['DeadLetterFunction', 'RenderDeadLetters'],
    ] as const) {
      const visibility = statementsOf(name).find((statement) =>
        [statement.Action].flat().includes('sqs:ChangeMessageVisibility'),
      )
      expect(visibility?.Resource, name).toEqual({
        'Fn::GetAtt': [logicalId(queue, 'AWS::SQS::Queue'), 'Arn'],
      })
    }
  })

  const rolesAndPolicies = () => {
    const names = ['RenderFunction', 'DeadLetterFunction', 'SweepFunction']
    return names.map((name) => {
      const id = logicalId(`${name}ServiceRole`, 'AWS::IAM::Role')
      return { name, id, role: propertiesOf(id, 'AWS::IAM::Role') }
    })
  }

  it('have exactly three roles, each trusting Lambda alone, with only the basic execution policy attached', () => {
    expect(ofType('AWS::IAM::Role')).toHaveLength(3)
    for (const { name, role } of rolesAndPolicies()) {
      expect(role.ManagedPolicyArns, name).toEqual([
        {
          'Fn::Join': [
            '',
            ['arn:', { Ref: 'AWS::Partition' }, ':iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'],
          ],
        },
      ])
      expect(role.AssumeRolePolicyDocument, name).toEqual({
        Statement: [
          { Action: 'sts:AssumeRole', Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' } },
        ],
        Version: '2012-10-17',
      })
      expect(role, name).not.toHaveProperty('Policies')
      expect(role, name).not.toHaveProperty('PermissionsBoundary')
    }
  })

  it('have one policy a role, the default one, and no policy on a user or a group', () => {
    const policies = ofType('AWS::IAM::Policy')
    expect(policies).toHaveLength(3)
    for (const { name, id } of rolesAndPolicies()) {
      const own = policies.filter(
        ([, policy]) => JSON.stringify(policy.Properties.Roles) === JSON.stringify([{ Ref: id }]),
      )
      expect(own, name).toHaveLength(1)
      expect(own[0]![0].startsWith(`${name}ServiceRoleDefaultPolicy`), name).toBe(true)
    }
    for (const type of [
      'AWS::IAM::User',
      'AWS::IAM::Group',
      'AWS::IAM::ManagedPolicy',
      'AWS::IAM::UserToGroupAddition',
    ])
      expect(ofType(type), type).toEqual([])
  })

  it('let the bucket and both queues speak one resource policy each: the TLS-only Deny', () => {
    const policies = [...ofType('AWS::S3::BucketPolicy'), ...ofType('AWS::SQS::QueuePolicy')]
    expect(policies).toHaveLength(3)
    for (const [id, policy] of policies) {
      const document = policy.Properties.PolicyDocument as { Statement: Record<string, unknown>[] }
      expect(document.Statement, id).toHaveLength(1)
      const [statement] = document.Statement
      const service = policy.Type === 'AWS::S3::BucketPolicy' ? 's3' : 'sqs'
      expect(statement, id).toMatchObject({
        Effect: 'Deny',
        Action: `${service}:*`,
        Principal: { AWS: '*' },
        Condition: { Bool: { 'aws:SecureTransport': 'false' } },
      })
      expect(Object.keys(statement!).sort(), id).toEqual([
        'Action',
        'Condition',
        'Effect',
        'Principal',
        'Resource',
      ])
    }
  })
})

describe('secrets', () => {
  const text = JSON.stringify(template.toJSON())
  const RENDER_SECRETS = logicalId('RenderSecrets', 'AWS::SecretsManager::Secret')
  const JOBS_SECRETS = logicalId('JobsSecrets', 'AWS::SecretsManager::Secret')

  it('are two, pinned by logical id and properties, with no value in the template', () => {
    expect(
      ofType('AWS::SecretsManager::Secret')
        .map(([id]) => id)
        .sort(),
    ).toEqual([JOBS_SECRETS, RENDER_SECRETS].sort())
    // A change to either id or property would replace the secret and lose the value set by hand.
    expect(RENDER_SECRETS).toBe('RenderSecretsF37EF303')
    expect(JOBS_SECRETS).toBe('JobsSecrets91A0830C')
    for (const id of [RENDER_SECRETS, JOBS_SECRETS]) {
      const resource = template.toJSON().Resources[id] as Resource & {
        DeletionPolicy: string
        UpdateReplacePolicy: string
      }
      expect(resource.Properties, id).not.toHaveProperty('SecretString')
      expect(resource.DeletionPolicy, id).toBe('Retain')
      expect(resource.UpdateReplacePolicy, id).toBe('Retain')
    }
    expect(propertiesOf(RENDER_SECRETS, 'AWS::SecretsManager::Secret')).toEqual({
      Description:
        'Cobweb render worker, render function only: the Supabase service key, the art storage keys, the Filebase keys and the RPC URLs.',
      GenerateSecretString: {},
    })
    expect(propertiesOf(JOBS_SECRETS, 'AWS::SecretsManager::Secret')).toEqual({
      Description: 'Cobweb render worker, dead-letter and sweep functions: the Supabase service key only.',
      GenerateSecretString: {},
    })
    expect(text).not.toContain('"SecretString"')
  })

  it('are read by the right functions: RenderSecrets by the render function alone, JobsSecrets by the other two', () => {
    const readers = (secret: string) =>
      ['RenderFunction', 'DeadLetterFunction', 'SweepFunction'].filter((name) =>
        statementsOf(name).some(
          (statement) =>
            [statement.Action].flat().includes('secretsmanager:GetSecretValue') &&
            JSON.stringify(statement.Resource) === JSON.stringify({ Ref: secret }),
        ),
      )
    expect(readers(RENDER_SECRETS)).toEqual(['RenderFunction'])
    expect(readers(JOBS_SECRETS)).toEqual(['DeadLetterFunction', 'SweepFunction'])
    for (const name of ['DeadLetterFunction', 'SweepFunction'])
      expect(JSON.stringify(statementsOf(name)), name).not.toContain(RENDER_SECRETS)
    expect(JSON.stringify(statementsOf('RenderFunction'))).not.toContain(JOBS_SECRETS)
  })

  const COMMON = ['NODE_ENV', 'RENDER_QUEUE_URL', 'SUPABASE_URL']
  const ENV_NAMES = {
    RenderFunction: [
      ...COMMON,
      'ART_S3_BUCKET',
      'ART_S3_REGION',
      'FILEBASE_BUCKET',
      'FILEBASE_S3_ENDPOINT',
      'RENDER_S3_BUCKET',
      'RENDER_SECRET_ARN',
    ],
    DeadLetterFunction: [...COMMON, 'JOBS_SECRET_ARN', 'RENDER_DEAD_LETTER_QUEUE_URL'],
    SweepFunction: [...COMMON, 'JOBS_SECRET_ARN'],
  } as const

  it('reach each function as its own secret ARN only: no key, no RPC URL, no other secret, in any environment', () => {
    for (const [name, expected] of Object.entries(ENV_NAMES)) {
      const variables = (
        propertiesOf(name, 'AWS::Lambda::Function').Environment as {
          Variables: Record<string, unknown>
        }
      ).Variables
      expect(Object.keys(variables).sort(), name).toEqual([...expected].sort())
      const own = name === 'RenderFunction' ? RENDER_SECRETS : JOBS_SECRETS
      expect(variables[name === 'RenderFunction' ? 'RENDER_SECRET_ARN' : 'JOBS_SECRET_ARN'], name).toEqual({
        Ref: own,
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

describe('outputs', () => {
  it('give the render queue URL, the render bucket name and the two secret ARNs', () => {
    const outputs = template.toJSON().Outputs as Record<string, { Value: unknown }>
    expect(Object.keys(outputs).sort()).toEqual([
      'JobsSecretArn',
      'RenderBucketName',
      'RenderQueueUrl',
      'RenderSecretArn',
    ])
    expect(outputs.RenderQueueUrl?.Value).toEqual({ Ref: logicalId('RenderQueue', 'AWS::SQS::Queue') })
    expect(outputs.RenderBucketName?.Value).toEqual({ Ref: logicalId('RenderBucket', 'AWS::S3::Bucket') })
    expect(outputs.RenderSecretArn?.Value).toEqual({
      Ref: logicalId('RenderSecrets', 'AWS::SecretsManager::Secret'),
    })
    expect(outputs.JobsSecretArn?.Value).toEqual({
      Ref: logicalId('JobsSecrets', 'AWS::SecretsManager::Secret'),
    })
  })
})

describe('the sharp lockfile', () => {
  const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'))
  const renderSharp: string = read('../../services/render/package.json').dependencies.sharp
  const lock = read('../lambda-deps/package-lock.json') as {
    packages: Record<string, { version?: string; integrity?: string }>
  }

  it('pins sharp at the render library version, in package.json and in the lockfile', () => {
    expect(read('../lambda-deps/package.json').dependencies).toEqual({ sharp: renderSharp })
    expect(renderSharp).toMatch(/^\d+\.\d+\.\d+$/)
    expect(lock.packages['node_modules/sharp']?.version).toBe(renderSharp)
  })

  it('carries an integrity hash for sharp and for its linux arm64 packages', () => {
    for (const name of ['sharp', '@img/sharp-linux-arm64', '@img/sharp-libvips-linux-arm64']) {
      expect(lock.packages[`node_modules/${name}`]?.integrity, name).toMatch(/^sha512-/)
    }
  })

  it('has an integrity hash for every package it installs', () => {
    for (const [path, entry] of Object.entries(lock.packages))
      if (path !== '') expect(entry.integrity, path).toMatch(/^sha512-/)
  })
})
