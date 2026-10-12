# Cobweb render infrastructure

One AWS CDK stack, `CobwebRender`, in `us-east-1`, defined in `lib/render-stack.ts`. Spec: `docs/specs/2026-10-12-render-worker.md`, section 9.

Nothing here has been deployed. Every step under "Deploy" is an action for the owner of the AWS account: no AWS credential and no Filebase key exists on the development machine, and the template tests and `synth` need neither.

## What the stack creates

- `RenderQueue`, a standard SQS queue. Its visibility timeout is 6 times the render function's timeout (60 minutes). After 3 receives a message moves to `RenderDeadLetters`.
- `RenderDeadLetters`, the dead-letter queue. It keeps messages for 14 days and has no redrive of its own. Its visibility timeout is 6 times the dead-letter function's timeout (6 minutes).
- `RenderDeadLettersAlarm`, a CloudWatch alarm on that queue's `ApproximateNumberOfMessagesVisible` (maximum over 5 minutes, at least 1, one evaluation period, missing data counts as not breaching). It is there so a job that can never be started or failed is seen by a person.
- `RenderFunction`: Node 22, arm64, 4,096 MB memory, 10 minutes, 4,096 MB ephemeral storage, fed by `RenderQueue` one message at a time with partial batch failures reported.
- `DeadLetterFunction`: 512 MB, 1 minute, fed by `RenderDeadLetters` one message at a time with partial batch failures reported, so a dead message survives a database outage.
- `SweepFunction`: 512 MB, 1 minute, run by the `SweepRule` EventBridge rule every 15 minutes.
- `RenderBucket`: a private bucket for collages. All public access is blocked, it is encrypted, it accepts TLS only, and it is retained when the stack is deleted.
- `RenderSecrets`: one Secrets Manager secret holding a generated placeholder. The stack never contains a real value.

The render function may read objects in the art bucket (`s3:GetObject`) and list the art bucket (`s3:ListBucket`, so S3 answers 404 and not 403 for a missing key), put objects in the render bucket, send to and receive from the render queue, and read the secret. The dead-letter function may receive from its queue and read the secret. The sweep function may send to the render queue and read the secret. Only the render function touches the art bucket. No statement has a wildcard resource other than `/*` after a bucket ARN, and `test/render-stack.test.ts` holds that.

The functions set `NODE_ENV=production`. The stack does not set `AWS_REGION`: Lambda sets it and the SQS and S3 clients use it.

## Local

```
pnpm --filter @cobweb/infra test     # template assertions; no bundling, no Docker, no credentials
pnpm --filter @cobweb/infra synth    # full synthesis with bundling into infra/cdk.out
```

`synth` needs no AWS credentials and no Docker. esbuild is a root dev dependency because CDK runs it from the directory that holds `pnpm-lock.yaml`. sharp's linux arm64 build is installed beside each bundle with `npm install --os=linux --cpu=arm64 --libc=glibc`, so the first run needs the npm registry or a warm npm cache. `infra/cdk.out` is not committed.

Never run Prettier on `.` from inside `infra`: it would rewrite the bundles in `cdk.out`. From the repo root, name the paths you changed.

## Prerequisites the owner supplies

- An AWS account, and credentials for a deploy role scoped to this stack (CloudFormation, Lambda, SQS, S3, IAM roles for the functions, Secrets Manager, EventBridge, CloudWatch), set up in your shell as usual.
- The art bucket's ARN (`arn:aws:s3:::<name>`) and its region.
- The Supabase project URL (`https://<project>.supabase.co`).
- The name of the Filebase IPFS bucket, and a Filebase access key pair for the secret below.

## Deploy

Each command is run by the owner, from the repo root, after `pnpm install`.

```
aws sts get-caller-identity
pnpm --filter @cobweb/infra exec cdk bootstrap aws://<account>/us-east-1
pnpm --filter @cobweb/infra synth
pnpm --filter @cobweb/infra exec cdk diff \
  --parameters ArtBucketArn=arn:aws:s3:::<art bucket> \
  --parameters ArtBucketRegion=<its region> \
  --parameters SupabaseUrl=https://<project>.supabase.co \
  --parameters FilebaseBucket=<the Filebase IPFS bucket>
pnpm --filter @cobweb/infra exec cdk deploy \
  --parameters ArtBucketArn=arn:aws:s3:::<art bucket> \
  --parameters ArtBucketRegion=<its region> \
  --parameters SupabaseUrl=https://<project>.supabase.co \
  --parameters FilebaseBucket=<the Filebase IPFS bucket>
```

1. `aws sts get-caller-identity` confirms the account you mean to use.
2. `cdk bootstrap` is run once per account and region.
3. `synth` builds the bundles and the template.
4. `cdk diff` is the change set to review: on the first deploy it should show only new resources, no wildcard resource, and no secret value.
5. `cdk deploy` creates the stack.

## The secret

The functions read one Secrets Manager secret at cold start and merge its JSON over their environment. After the first deploy, replace the generated placeholder with one JSON object of text values. The keys are:

| Key                          | Value (placeholder only)                                                   |
| ---------------------------- | -------------------------------------------------------------------------- |
| `SUPABASE_SERVICE_ROLE_KEY`  | `<the Supabase service-role key>`                                          |
| `FILEBASE_ACCESS_KEY_ID`     | `<the Filebase access key id>`                                             |
| `FILEBASE_SECRET_ACCESS_KEY` | `<the Filebase secret key>`                                                |
| `RPC_URL_<chainId>`          | `<an RPC URL>`, one per chain jobs are paid on (1, 42161, 8453, and so on) |
| `FACTORY_ADDRESS_<chainId>`  | Optional, not secret: `<a factory address>` for a chain with no quote      |

The owner puts it in place without writing it to a file that could be committed. Run the command, paste the JSON, and end the input:

```
aws secretsmanager put-secret-value --region us-east-1 \
  --secret-id <the RenderSecrets ARN from the stack resources in the console> \
  --secret-string file:///dev/stdin
```

A function that is already warm keeps the old value until its container is recycled.

## Behaviours to confirm on the first deploy

The first two come from Filebase's public documentation and have not been checked against a live account.

1. **Filebase accepts a CAR uploaded with the import metadata.** The pinner (`services/worker/src/adapters/filebase.ts`) uploads `<cid>.car` with the object metadata `import: car` (`FILEBASE_IMPORT_METADATA`). Confirm with a real key that a small CAR uploaded this way is imported as a directory and not stored as one opaque file:

   ```
   npx -y ipfs-car@3.1.0 pack ./some-folder --output folder.car
   aws --endpoint https://s3.filebase.com s3 cp folder.car s3://<bucket>/folder.car --metadata 'import=car'
   ```

2. **Filebase returns the CID in the head response's metadata.** The pinner reads the metadata key `cid` (`FILEBASE_CID_METADATA_KEY`, the `x-amz-meta-cid` header) with a HeadObject after the upload, because the SDK does not expose PutObject's response headers. Filebase may need a moment to import the CAR, so the pinner repeats the head up to 3 times, one second apart, and then fails the attempt so the message is retried. Confirm the key, and that the value is the CIDv1 root the render library computed and not a CIDv0:

   ```
   aws --endpoint https://s3.filebase.com s3api head-object --bucket <bucket> --key folder.car
   ```

   If either differs, change the two constants and nothing else. The worker already fails a job with `cid-mismatch` rather than accept a different CID.

3. **The render function's memory, timeout and ephemeral storage are starting points.** 4,096 MB, 10 minutes and 4,096 MB come from PLAN.md. The local benchmark (`pnpm --filter @cobweb/worker bench`) rendered 100 tokens at 2048 by 2048 with 7 layers on a 12 core arm64 laptop in about 52 seconds, with a peak resident memory of 695 MB and a 146 MB CAR. That is not a Lambda measurement, and a benchmark on Lambda itself is owed. Run one real batch on Lambda, read the duration and the maximum memory used from the function's REPORT log line, and set `RENDER_MEMORY_MB`, `RENDER_TIMEOUT` and `RENDER_EPHEMERAL_MB` in `lib/render-stack.ts` from it. Lambda gives CPU in proportion to memory, so the laptop's 52 seconds does not carry over.

## Notifications for the alarm

The alarm has no action, because no topic or address has been chosen. To attach one, create an SNS topic with a subscription for the person who should be told, then add the topic as an alarm action on `RenderDeadLettersAlarm` in `lib/render-stack.ts` (`alarm.addAlarmAction(new SnsAction(topic))`, from `aws-cdk-lib/aws-cloudwatch-actions`), or set it once in the CloudWatch console. Add an assertion for it to the template test.

## Tear down

```
pnpm --filter @cobweb/infra exec cdk destroy
```

Run by the owner. The stack's resources are deleted except two, which are retained on purpose: `RenderBucket` (the collages) and `RenderSecrets`. Empty and delete the bucket by hand when its collages are no longer needed, and delete the secret from the Secrets Manager console. The CDK bootstrap stack is left in place.
