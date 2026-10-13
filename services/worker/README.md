# Render worker

`@cobweb/worker` turns a `paid` or `waived` render job into pinned images and metadata. The specs are
[docs/specs/2026-10-12-render-worker.md](../../docs/specs/2026-10-12-render-worker.md) (ports, steps,
local runner) and [docs/specs/2026-10-13-render-worker-vercel.md](../../docs/specs/2026-10-13-render-worker-vercel.md)
(how it runs on Vercel).

## What runs where

- This package holds the five ports and their adapters, the three steps (`start`, `batch`,
  `metadata`), the dead-letter handler, the sweep, the Vercel queue adapter and the
  queue consumer. It imports nothing from `@vercel/queue`; the web app passes the SDK in.
- On Vercel the worker runs inside `apps/web`, in the same project as the pay flow, because a topic's
  messages are delivered to the deployment that published them:
  - `POST /api/queues/render` (`src/app/api/queues/render/route.ts`): the consumer of the `render`
    topic. Only Vercel's queue infrastructure invokes it. `maxDuration` 800 seconds.
  - `GET /api/cron/render-sweep` (`src/app/api/cron/render-sweep/route.ts`): every 15 minutes, with
    `Authorization: Bearer <CRON_SECRET>`; any other caller gets a 404.
  - The pay flow (`src/lib/art/lock-core.ts`, `confirmCore`) sends a job's start message as soon as the
    payment is recorded, and the lock (`lockCore`) sends it for a job locked as `waived` (a single
    asset, which pays nothing). A failed send is logged and the sweep starts the job.
- Locally nothing reaches Vercel: the web app's queue only logs `render not queued (no queue here)`,
  and `pnpm --filter @cobweb/web verify:render` drives the local runner (`@cobweb/worker/local`) over a
  queue in memory and a folder standing in for Filebase.

## Delivery, retries and duplicates

- Every message carries an idempotency key, `<jobId>:<step>[:<index>]:<retries>`. Vercel drops a
  second message with the same key for 24 hours, so a rerun step or a sweep never renders a batch twice
  within a day. A creator's retry raises `retries` and so gets new keys.
- A message whose run throws is delivered again after 120 seconds the first time and an hour after
  that. On its third delivery a failure fails the job with `dead-letter` and the message is
  acknowledged. If that report cannot be written (a database outage) the message comes back and the
  report is made then. The trigger's `maxDeliveries` of 10 bounds a runaway; it is never the normal
  path.
- The sweep sends a start message again for each job nothing has touched for 15 minutes.

## Environment

Every name is server only and none starts with `NEXT_PUBLIC_`. They live in the web app's environment
(`apps/web/.env.example`); `services/worker/.env.example` lists the worker's own view of them.

| Name                                                   | Secret | What                                                          |
| ------------------------------------------------------ | ------ | ------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`                             | no     | The Supabase URL; the worker routes pass it as `SUPABASE_URL` |
| `SUPABASE_SERVICE_ROLE_KEY`                            | yes    | The worker's database key                                     |
| `ART_S3_ENDPOINT`                                      | no     | `https://<account id>.r2.cloudflarestorage.com`               |
| `ART_S3_REGION`                                        | no     | `auto`                                                        |
| `ART_S3_FORCE_PATH_STYLE`                              | no     | `1`                                                           |
| `ART_S3_BUCKET`                                        | no     | The R2 bucket for layers, assets and placeholders             |
| `RENDER_S3_BUCKET`                                     | no     | The R2 bucket for collages; never the art bucket              |
| `ART_S3_ACCESS_KEY_ID`, `ART_S3_SECRET_ACCESS_KEY`     | yes    | The R2 API token, object read and write on both buckets       |
| `FILEBASE_BUCKET`                                      | no     | The Filebase IPFS bucket                                      |
| `FILEBASE_ACCESS_KEY_ID`, `FILEBASE_SECRET_ACCESS_KEY` | yes    | The Filebase key pair                                         |
| `FILEBASE_S3_ENDPOINT`                                 | no     | Optional; defaults to `https://s3.filebase.com`               |
| `RPC_URL_<chainId>`                                    | yes    | One per launch chain                                          |
| `FACTORY_ADDRESS_<chainId>`                            | no     | One per launch chain                                          |
| `CRON_SECRET`                                          | yes    | Sent by Vercel Cron; generate with `openssl rand -hex 32`     |

A local or CI build of the web app prints "[QueueClient] Region not detected" twice. The queue SDK builds its client when Next evaluates the consumer route at build time, and VERCEL_REGION is set only at runtime on Vercel. The default it picks, iad1, is the region vercel.json pins, so the line is noise rather than a setting to fix.

## Vercel project settings (the owner)

1. Project `cobweb`, Root Directory `apps/web`, framework Next.js, Node 24.x.
2. Settings, Functions: Function CPU **Performance** (4 GB, 2 vCPU). From the CLI:
   `vercel project update cobweb --function-cpu performance`.
3. Region `iad1` (also set in `apps/web/vercel.json`). Create the Supabase project in us-east-1 so the
   database sits beside the functions.
4. Production environment values for every name in the table above, and `CRON_SECRET`.
5. Crons run on production deployments only; the queue trigger is registered on every deployment.

## Cloudflare R2 (the owner)

1. Two buckets in one account: one for layers, assets and placeholders (`ART_S3_BUCKET`) and one for
   collages (`RENDER_S3_BUCKET`).
2. One R2 API token with Object Read and Write on both buckets; its key id and secret are
   `ART_S3_ACCESS_KEY_ID` and `ART_S3_SECRET_ACCESS_KEY`.
3. A CORS rule on the layer bucket, because browser uploads are presigned PUTs:

   ```json
   [
     {
       "AllowedOrigins": ["https://<the app's origin>"],
       "AllowedMethods": ["PUT"],
       "AllowedHeaders": ["Content-Type"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

4. `ART_S3_ENDPOINT=https://<account id>.r2.cloudflarestorage.com`, `ART_S3_REGION=auto`,
   `ART_S3_FORCE_PATH_STYLE=1`.

## Filebase: two behaviours to confirm with a real key

They come from Filebase's public documentation and have not been checked against a live account.

1. **A CAR uploaded with the import metadata is imported as a directory.** The pinner
   (`src/adapters/filebase.ts`) uploads `<cid>.car` with the object metadata `import: car`
   (`FILEBASE_IMPORT_METADATA`):

   ```
   npx -y ipfs-car@3.1.0 pack ./some-folder --output folder.car
   aws --endpoint https://s3.filebase.com s3 cp folder.car s3://<bucket>/folder.car --metadata 'import=car'
   ```

2. **The CID comes back in the head response's metadata** under `cid` (`FILEBASE_CID_METADATA_KEY`,
   the `x-amz-meta-cid` header), as the CIDv1 root the render library computed:

   ```
   aws --endpoint https://s3.filebase.com s3api head-object --bucket <bucket> --key folder.car
   ```

If either differs, change the two constants and nothing else. The worker already fails a job with
`cid-mismatch` rather than accept a different CID.

## Concurrency

At most 25 batches render at once: `maxConcurrency` on the queue trigger in `apps/web/vercel.json`.
It is a starting point. After the first real job, read Filebase's ingest rate from the logs and raise
the number in `vercel.json` (and in `apps/web/src/lib/render/vercel-config.test.ts`, which pins it).

## Batch sizes and memory

A batch is held about 2.8 times over while it is packed. Generative batches are 100 tokens. 1/1 and
single asset batches are sized at lock to about 500 MB of files, and the batch step fails a job with
`batch-too-large` past 600 MB of files it really loads. The render library reads each distinct layer
once per batch.

## Local

```
pnpm --filter @cobweb/worker test         # steps, adapters, the queue consumer
pnpm --filter @cobweb/web verify:render   # end to end against local Supabase, local storage and Anvil
pnpm --filter @cobweb/worker bench        # one batch of 100 tokens at 2048 x 2048: time, memory, CAR size
```
