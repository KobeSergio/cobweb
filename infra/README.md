# Cobweb render infrastructure

One AWS CDK stack, `CobwebRender`, in `us-east-1`, defined in `lib/render-stack.ts`. Spec: `docs/specs/2026-10-12-render-worker.md`, section 9.

Nothing here has been deployed. Every step under "Deploy" is an action for the owner of the AWS account: no AWS credential and no Filebase key exists on the development machine, and the template tests and `synth` need neither.

## What the stack creates

- `RenderQueue`, a standard SQS queue. Its visibility timeout is 6 times the render function's timeout (60 minutes). After 3 receives a message moves to `RenderDeadLetters`. When a function's run of a message throws for the first time, the function sets that message's visibility to 120 seconds before reporting it as failed, so a transient fault is retried once after two minutes and not after the hour. A second failure waits the queue's own hour, so an outage does not dead-letter every message within minutes and spend creators' retries.
- `RenderDeadLetters`, the dead-letter queue. It keeps messages for 14 days and has no redrive of its own. Its visibility timeout is 6 times the dead-letter function's timeout (6 minutes).
- `RenderDeadLettersAlarm`, a CloudWatch alarm on the `Invocations` of `DeadLetterFunction` (sum over 5 minutes, at least 1, one evaluation period, missing data counts as not breaching). That function runs only when a message has died, and it acknowledges every message it handles, so the queue's own depth is never a useful signal; an invocation is. See "Notifications for the alarm" for where to attach a target.
- `RenderFunction`: Node 22, arm64, 4,096 MB memory, 10 minutes, 4,096 MB ephemeral storage, fed by `RenderQueue` one message at a time with partial batch failures reported and at most `MAX_RENDER_CONCURRENCY` (10) running at once.
- `DeadLetterFunction`: 512 MB, 1 minute, fed by `RenderDeadLetters` one message at a time with partial batch failures reported, so a dead message survives a database outage.
- `SweepFunction`: 512 MB, 1 minute, run by the `SweepRule` EventBridge rule every 15 minutes.
- Three log groups, one for each function, that keep 30 days of logs and are kept when the stack is deleted.
- `RenderBucket`: a private bucket for collages. All public access is blocked, it is encrypted, it accepts TLS only, and it is retained when the stack is deleted.
- Two secrets, each holding a generated placeholder (the stack never contains a real value): `RenderSecrets`, read by the render function only, and `JobsSecrets`, read by the dead-letter and sweep functions and holding the Supabase service key alone. The dead-letter and sweep roles have no grant on `RenderSecrets`.
- Four stack outputs: `RenderQueueUrl`, `RenderBucketName`, `RenderSecretArn` and `JobsSecretArn`.

The render function may read objects in the art bucket (`s3:GetObject`) and list the art bucket (`s3:ListBucket`, so S3 answers 404 and not 403 for a missing key), put objects in the render bucket (`s3:PutObject` on its objects and nothing else), send to and receive from the render queue (including `sqs:ChangeMessageVisibility`), and read `RenderSecrets`. The dead-letter function may receive from its queue (including `sqs:ChangeMessageVisibility`) and read `JobsSecrets`. The sweep function may send to the render queue, read its attributes (`sqs:GetQueueAttributes`, which the send grant already includes) and read `JobsSecrets`. Only the render function touches the art bucket. Every role has the basic Lambda execution policy and one default policy, nothing else. No Allow action contains a `*`, no statement has a wildcard resource other than `/*` after a bucket ARN, and `test/render-stack.test.ts` holds that, with each role's actions listed exactly.

An art bucket that has its own KMS key, or that lives in another account, needs grants this stack does not make (a key policy entry for the render role, or a bucket policy in the other account). The stack grants on the bucket's ARN only.

The web app needs a read grant (`s3:GetObject`) on `RenderBucket` to sign collage URLs. This stack does not give it, because the web app's role is not defined here. It is owed to the screen sub-project.

The functions set `NODE_ENV=production`. The stack does not set `AWS_REGION`: Lambda sets it and the SQS and S3 clients use it.

## Local

```
pnpm --filter @cobweb/infra test     # template assertions; no bundling, no Docker, no credentials
pnpm --filter @cobweb/infra synth    # full synthesis with bundling into infra/cdk.out
```

`synth` needs no AWS credentials and no Docker. esbuild is a root dev dependency because CDK runs it from the directory that holds `pnpm-lock.yaml`. sharp is installed beside each bundle from a lockfile: `infra/lambda-deps/package.json` pins `sharp` at exactly the render library's version and `infra/lambda-deps/package-lock.json` holds the integrity hashes for linux arm64. The bundling hook copies those two files next to the bundle and runs `npm ci --omit=dev --ignore-scripts --os=linux --cpu=arm64 --libc=glibc` there, never a bare `npm install`, so the first run needs the npm registry or a warm npm cache. A test checks that the lockfile pins the version in `services/render/package.json` and carries an integrity hash for `sharp` and `@img/sharp-linux-arm64`. To upgrade sharp, change both `package.json` files together and regenerate the lockfile in `infra/lambda-deps` with `npm install --package-lock-only --os=linux --cpu=arm64 --libc=glibc`. `infra/cdk.out` is not committed.

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
pnpm --filter @cobweb/infra exec cdk diff
pnpm --filter @cobweb/infra exec cdk deploy \
  --parameters ArtBucketArn=arn:aws:s3:::<art bucket> \
  --parameters ArtBucketRegion=<its region> \
  --parameters SupabaseUrl=https://<project>.supabase.co \
  --parameters FilebaseBucket=<the Filebase IPFS bucket>
```

1. `aws sts get-caller-identity` confirms the account you mean to use.
2. `cdk bootstrap` is run once per account and region.
3. `synth` builds the bundles and the template.
4. `cdk diff` is the change set to review: on the first deploy it should show only new resources, no wildcard resource, and no secret value. It takes no `--parameters`. The four parameters are given to `cdk deploy`; a later deploy reuses the previous values, so repeat them only to change one.
5. `cdk deploy` creates the stack. Its outputs give the queue URL, the render bucket name and the two secret ARNs.

Before every later deploy, read the `cdk diff` and check that it shows no change to `RenderSecrets` or `JobsSecrets`. A change to a secret's properties, or a rename that moves its logical id, replaces it with a new placeholder and leaves the old one retained, and every function then fails at cold start with an unreadable secret until the value is entered again. Keep each JSON object in a place you control, so it can be entered again.

## The secrets

Each function reads one Secrets Manager secret at cold start and merges its JSON over its environment. **Until both values are set, the functions fail at cold start** with "not a JSON object of text values", and messages go back to the queue. After the first deploy, replace each generated placeholder with one JSON object of text values.

`RenderSecrets` (read by `RenderFunction` only):

| Key                          | Value (placeholder only)                                                    |
| ---------------------------- | --------------------------------------------------------------------------- |
| `SUPABASE_SERVICE_ROLE_KEY`  | `<the Supabase service-role key>`                                           |
| `FILEBASE_ACCESS_KEY_ID`     | `<the Filebase access key id>`                                              |
| `FILEBASE_SECRET_ACCESS_KEY` | `<the Filebase secret key>`                                                 |
| `RPC_URL_<chainId>`          | `<an RPC URL>`, one per chain jobs are paid on (1, 42161, 8453, and so on)  |
| `FACTORY_ADDRESS_<chainId>`  | Optional, not secret: `<a factory address>` for a chain with no quote       |
| `ART_S3_ACCESS_KEY_ID`       | Only when the art bucket is not reached with the role: `<an access key id>` |
| `ART_S3_SECRET_ACCESS_KEY`   | Only with the key id above: `<its secret key>`                              |

`JobsSecrets` (read by `DeadLetterFunction` and `SweepFunction`):

| Key                         | Value (placeholder only)          |
| --------------------------- | --------------------------------- |
| `SUPABASE_SERVICE_ROLE_KEY` | `<the Supabase service-role key>` |

The owner puts each in place without writing it to a file that could be committed. Run the command, paste the JSON, and end the input. Use the ARNs from the stack outputs `RenderSecretArn` and `JobsSecretArn`:

```
aws secretsmanager put-secret-value --region us-east-1 \
  --secret-id <the RenderSecretArn output> \
  --secret-string file:///dev/stdin

aws secretsmanager put-secret-value --region us-east-1 \
  --secret-id <the JobsSecretArn output> \
  --secret-string file:///dev/stdin
```

A function that is already warm keeps the old value until its container is recycled.

## Batch sizes and memory

A batch is held in memory about 2.8 times over while it is packed, so a batch should stay under about 1 GB of files. At lock, a database trigger sizes the batches of a 1/1 or single asset job from the largest file the list names: the batch size is 1 GB divided by that size, between 1 and 100 (20 files a batch for 50 MB videos), and the batch count follows. When all the distinct files a job names together stay under 1 GB the batch size stays 100, because a batch holds each distinct file once however many tokens share it (a single asset, or editions of a few files). That size is a planning number, taken from the size the upload recorded. The render function adds up the bytes it really loads in each 1/1 or single asset batch and fails the job with `batch-too-large` past 1.2 GB, and it refuses any single file over the 50 MiB upload limit. Streaming the CAR so batches need not be sized by memory is owed.

## The sweep

The sweep runs every 15 minutes and sends a start message again for each job that nothing has touched for 15 minutes. Because the sweep marks a job just after its cutoff, a job that stays stuck is sent again about every 30 minutes, not every 15. While the render queue has messages waiting it waits 120 minutes instead, and it never skips, because the queue is shared by every creator. If it cannot read the backlog it uses 15 minutes. After it sends a job's start message it sets the job row's `updated_at`, so a job is sent again at most once per threshold; `updated_at` on a render job therefore also means "last swept". The sweep function needs `sqs:GetQueueAttributes` on the render queue to read the backlog, and has it. Per-tenant fairness in the shared queue is owed; the concurrency cap is the only bound today.

## Concurrency

`MAX_RENDER_CONCURRENCY` in `lib/render-stack.ts` is 10: at most ten render functions run at once, so a 10,000 token job (100 batches) takes about ten batches at a time. It is set on the event source, not as reserved concurrency, which would push throttled messages toward the dead-letter queue. The number is a starting point, to be revisited after a benchmark on Lambda itself and once Filebase's limits on simultaneous uploads are known.

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

The alarm has no action, because no topic or address has been chosen. It fires when `DeadLetterFunction` is invoked, which happens whenever a message dies, including a start message for a job that was never claimed (the sweep then sends it again). To attach a target, create an SNS topic with a subscription for the person who should be told, then add the topic as an alarm action on `RenderDeadLettersAlarm` in `lib/render-stack.ts` (`alarm.addAlarmAction(new SnsAction(topic))`, from `aws-cdk-lib/aws-cloudwatch-actions`), or set it once in the CloudWatch console. Add an assertion for it to the template test.

## Tear down

```
pnpm --filter @cobweb/infra exec cdk destroy
```

Run by the owner. The stack's resources are deleted except those retained on purpose: `RenderBucket` (the collages), `RenderSecrets`, `JobsSecrets`, and the three log groups (`RenderFunctionLogGroup`, `DeadLetterFunctionLogGroup` and `SweepFunctionLogGroup`, each with its generated suffix). Empty and delete the bucket by hand when its collages are no longer needed, delete the secrets from the Secrets Manager console, and delete the log groups from the CloudWatch console. The CDK bootstrap stack is left in place.
