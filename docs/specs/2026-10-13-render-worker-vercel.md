# Render worker on Vercel

**Date:** 13 October 2026. **Phase:** 4, render pipeline. **Supersedes:** section 9 (AWS) of
[2026-10-12-render-worker.md](2026-10-12-render-worker.md) and the `infra` package. Everything else
in that spec stands unless this one says otherwise.

## 1. Goal

Run the render worker with no AWS account and no server that runs all the time. The worker's code is
kept: the five ports, the three steps, the local runner, the render library and the database
functions are unchanged. What changes is the shell around them: where messages wait, what runs the
steps, where layers and collages are stored, and where secrets live.

## 2. Decisions taken in the design conversation

Facts checked against Vercel's documentation on 13 October 2026, and against a proof run on that day:
a throwaway Vercel function running the worker's real `renderBatch` rendered 100 tokens at 2048 by
2048 with 7 layers in 187 seconds with a peak resident set of 779 MB on the default 2 GB instance,
and produced the same CID as the arm64 laptop.

1. **Compute is Vercel Functions on fluid compute.** They scale to zero. Pro allows 800 seconds per
   invocation and a Performance instance of 4 GB and 2 vCPU. Billing is active CPU plus memory
   while a request is in flight; a 10,000 token job at 4 MB an image costs about $1.50 of compute.
2. **The queue is Vercel Queues** (public beta), push mode. Topics are scoped to the Vercel project
   and messages are delivered to the deployment that published them, so the consumer lives in the
   same project as the publisher.
3. **The worker runs inside the web app** (`apps/web`) as route handlers: the queue consumer and the
   sweep cron. A separate project could not receive the web app's messages without an extra
   enqueue endpoint, and the web app's environment already holds every secret except the Filebase
   key.
4. **Layers and collages live in Cloudflare R2**, through its S3 endpoint. R2 has no egress charge,
   and the worker reads each token's layers from storage. The code already takes any S3 endpoint;
   locally both buckets stay on Supabase Storage. No code depends on R2.
5. **No worker-side layer cache.** The render library already reads each distinct layer once per
   `renderBatch` call (`cachedLoader` in `services/render/src/batch.ts`, unbounded, so a batch's
   distinct layers sit in memory beside the CAR; a few hundred 4 MB files fit the 4 GB instance). A
   cache across batches is impossible on functions that scale to zero, and the egress a batch's
   reads cost is answered by R2, not by code. (The design conversation first planned a 512 MB
   cache; planning found it redundant and it was dropped on 13 October 2026.)
6. **Duplicates are stopped by idempotency keys**, not by a backlog read. Every message carries a
   key of job id, step, batch index and retry count; Vercel drops a duplicate for 24 hours. The
   sweep's "wait two hours while the queue is busy" rule and `RenderQueue.backlog` go. A
   consequence, accepted: a sweep re-send for a job whose start message with the same retry count
   was published less than 24 hours ago is dropped. Inside that day Vercel's own retries are the
   recovery path (a message is retried until it is acknowledged or expires), so the sweep's job
   within the day is the start message that was never published (the send after payment failed)
   and, after the day, anything else.
7. **Dead-lettering is in the consumer.** Vercel Queues has no dead-letter queue. A message whose run
   has thrown on its third delivery is handed to `handleDead` and acknowledged; a first failure is
   retried after 120 seconds, later failures after an hour, as on SQS.
8. **The start message is sent when a job becomes `paid` or `waived`**: in the pay flow when the
   payment is recorded, and in the lock flow when `art_lock` returns a job already `waived` (a
   single asset with no fee), so the job starts within seconds. A failed send is logged and left
   to the sweep. This was owed to the screen sub-project and moves here.
9. **1/1 and single-asset batches target 500 MB** at lock (was 1 GB); the worker's ceiling becomes
   600 MB (was 1.2 GB). Generative batches stay at 100 tokens. The owner's experience is that
   marketplaces cache and cap video assets around 5 to 10 MB, so 1 GB batches were far above need.
10. **Performance instance, region `iad1`, 25 batches in flight.** The instance and region are
    project settings; the cap is `maxConcurrency` on the queue trigger. 25 is a starting point to
    raise after the first real job shows Filebase's ingest rate.
11. **Alerting is deferred to Phase 7**, with the other alerts. Vercel Observability can alert on
    queue retry depth from the dashboard; nothing in code.
12. **Deleted outright:** the `infra` package, the Lambda entry points, the SQS adapter, the Secrets
    Manager loader, and the SQS, Secrets Manager and Lambda type dependencies. The S3 SDK stays:
    Supabase Storage, R2 and Filebase all speak S3. `docs/PLAN.md` is kept verbatim by rule.

## 3. Scope

In: the Vercel queue adapter and consumer, the sweep cron route, the web app's queue module and the
start send in the pay and lock flows, the batch target and ceiling, `vercel.json`, the Next
config for the worker packages, the deletions, docs, a preview deployment.

Out: the retry action and the screen's polling (screen wiring, next sub-project); production env
values and the production deploy (the owner); the live Filebase checks (need the owner's key);
alerting (Phase 7).

## 4. The queue contract (`packages/shared/src/render-queue.ts`)

`RenderQueue` loses `backlog`: `{ send(messages: RenderMessage[]): Promise<void> }`. A new
`messageKey(message): string` returns the idempotency key: `<jobId>:start:<retries>`,
`<jobId>:batch:<index>:<retries>`, `<jobId>:metadata:<retries>`. Under 64 characters, within Vercel's
256. `RENDER_TOPIC = 'render'` and `RENDER_RETENTION_SECONDS = 604800` (7 days, the maximum, so a
long backlog never expires a message; the deduplication window is 24 hours regardless). Everything
else in the contract is unchanged.

## 5. The Vercel queue adapter (`services/worker/src/adapters/vercel-queue.ts`)

```ts
export type QueueSender = {
  send(topic: string, body: unknown, options: { idempotencyKey: string; retentionSeconds: number }): Promise<unknown>
}
export function vercelRenderQueue(sender: QueueSender): RenderQueue
```

Sends messages one at a time, in order, each with its `messageKey` and the retention. A throw
propagates: the caller's step is retried, and the messages already sent are deduplicated on the
rerun. The adapter imports nothing from `@vercel/queue`; the route passes the SDK's `send`. It is
re-exported from the `@cobweb/worker/queue` entry, which imports nothing heavy, for the retry action
later.

## 6. The consumer (`services/worker/src/vercel/consumer.ts`)

```ts
export const MAX_DELIVERIES = 3
export const FIRST_RETRY_SECONDS = 120
export const LATER_RETRY_SECONDS = 3600

export function queueConsumer(getDeps: () => Promise<Deps>, log?: Log):
  (body: unknown, metadata: { messageId: string; deliveryCount: number }) => Promise<void>
export function retryAfter(metadata: { deliveryCount: number }): { afterSeconds: number }
```

`queueConsumer` returns the function the route hands to `handleCallback`:

- A body that is not a render message (checked with `parseRenderMessage` on its JSON) is logged and
  returned, so it is acknowledged and never retried.
- Otherwise `handle(message, deps)`. A throw on a delivery below `MAX_DELIVERIES` is logged (name
  and masked line, never the error object) and rethrown; the SDK's `retry` callback, `retryAfter`,
  answers 120 seconds for the first delivery and 3600 for later ones.
- A throw on the third delivery calls `handleDead(message, deps)` and returns, so the message is
  acknowledged and the job carries `dead-letter`. If `handleDead` itself throws (a database outage),
  the error is rethrown so the message comes back and the report is made on the next delivery, as
  the dead-letter function did on AWS. The trigger's `maxDeliveries` is 10, a bound on runaway cost,
  never the normal path.
- `getDeps` is called once per instance and memoised; a failed build is tried again on the next
  message, as the Lambda loader did.

## 7. The web app

- `apps/web/src/app/api/queues/render/route.ts`: `export const maxDuration = 800`;
  `export const POST = handleCallback(queueConsumer(deps), { retry: retryAfter })`. `deps` builds
  `productionDeps(process.env, { queue: vercelRenderQueue({ send }) })` once.
- `apps/web/src/app/api/cron/render-sweep/route.ts`: `GET`, refuses without
  `Authorization: Bearer <CRON_SECRET>` (404, as the other routes answer the unknown), then
  `sweep(deps)` with the `jobs` kind of deps. Returns the count re-sent.
- `apps/web/src/lib/render/queue.ts`: `renderQueue(): RenderQueue`. On Vercel (`process.env.VERCEL`
  set) the Vercel adapter over the SDK's `send`; anywhere else a queue whose `send` logs
  `render not queued (no queue here)` with the job id and returns, so local development and the
  verify scripts, which drive the local runner themselves, never reach Vercel.
- The pay flow (`apps/web/src/lib/art/lock-core.ts`): after `art_record_payment` succeeds and the
  payment is not short, `enqueueRender(ctx.queue, { id: row.id, retries: 0 })`. The lock flow does
  the same when the job `art_lock` returns is already `waived`. A throw from the send is logged with
  the job id and swallowed: the row is recorded, and the sweep starts the job within 15 minutes.
  `LockContext` gains `queue: RenderQueue`, supplied by the server action layer from
  `renderQueue()`.
- `apps/web/vercel.json`: `regions: ["iad1"]`; the trigger on the consumer route
  (`type: queue/v2beta`, `topic: render`, `retryAfterSeconds: 120`, `maxDeliveries: 10`,
  `maxConcurrency: 25`); `crons: [{ path: "/api/cron/render-sweep", schedule: "*/15 * * * *" }]`.
  Paths carry the `src/` prefix.
- `next.config.ts`: `transpilePackages` gains `@cobweb/worker` and `@cobweb/render`;
  `serverExternalPackages: ['sharp']` so the native module is not bundled.
- `@vercel/queue` (0.8.0, the current release) is a dependency of `apps/web` only.

## 8. The worker package

- `productionDeps(env, { queue, log?, kind? })`: the queue is injected; the function builds no queue
  client. `WORKER_ENV` loses `RENDER_QUEUE_URL`. `env.ts` imports no SQS or Secrets Manager client.
- `MAX_BATCH_BYTES` becomes 600,000,000. No layer cache is added (decision 5).
- `sweep` loses the busy branch and `STUCK_MINUTES_BUSY`; it always uses `STUCK_MINUTES`.
  `memoryQueue` loses `backlog`.
- Deleted: `src/lambda/` (all files), `src/adapters/sqs.ts` and its test. `src/testing/stub-aws.ts`
  is renamed `stub-s3.ts`: it is a generic S3 stand-in the Filebase and store tests use.
  `src/queue.ts` re-exports the Vercel adapter instead of the SQS one. `index.ts` exports
  `vercelRenderQueue`, `queueConsumer`, `retryAfter` and the new constants, and no longer exports
  `sqsRenderQueue` or `STUCK_MINUTES_BUSY`.
- `package.json` drops `@aws-sdk/client-sqs`, `@aws-sdk/client-secrets-manager` and
  `@types/aws-lambda`.

## 9. Database

`supabase/migrations/20261013010000_asset_batch_target.sql` replaces
`private.render_jobs_size_asset_batches()` with the same function at a 500,000,000 byte target. The
trigger is unchanged. `verify:local`'s batch-size checks move with it: the 45-token job of
52,428,800-byte files now gets `batch_size` 9 and `batches_total` 5; five distinct files of that size
(262 MB together) still fit one batch of 100.

## 10. Configuration

Web app env (`apps/web/.env.example`), all server-only: the existing names plus `FILEBASE_BUCKET`,
`FILEBASE_ACCESS_KEY_ID`, `FILEBASE_SECRET_ACCESS_KEY`, `FILEBASE_S3_ENDPOINT` (optional),
`CRON_SECRET`, and `RPC_URL_<chainId>` and `FACTORY_ADDRESS_<chainId>` per launch chain.
`RENDER_QUEUE_URL` goes. `services/worker/.env.example` loses it too.

Vercel project settings, documented in `services/worker/README.md` and done by the owner: Function
CPU set to Performance; region `iad1`; the env values above for Production; `CRON_SECRET` generated;
the Supabase project created in us-east-1 to sit beside the functions. R2: one bucket for layers and
one for collages in the same account, an API token with object read and write on both, a CORS rule
on the layer bucket allowing `PUT` from the app's origin (browser uploads are presigned PUTs), and
`ART_S3_ENDPOINT=https://<account id>.r2.cloudflarestorage.com`, `ART_S3_REGION=auto`,
`ART_S3_FORCE_PATH_STYLE=1`.

## 11. Testing

- Unit (Vitest): the message keys; the adapter (order, key and retention per message, a throw
  propagates); the consumer (a non-message acknowledged; a throw rethrown below three deliveries;
  the third delivery calls `handleDead` and resolves; a `handleDead` throw rethrown; deps built once
  and rebuilt after a failed build); `retryAfter`; the sweep without a busy branch;
  `productionDeps` with an injected queue and without `RENDER_QUEUE_URL`. In the web app: the queue
  module's choice by environment; the pay flow sends one start message with `retries` 0 after a
  recorded payment, sends nothing for a short payment, and reports success when the send throws;
  the lock flow sends one for a job returned `waived` and none for a job returned `payment_due`.
- `verify:render`, three times. The runner and its doubles are unchanged apart from `backlog`.
- `verify:local` with the new batch-size numbers.
- `pnpm build` of the web app with the worker packages transpiled and sharp external.
- A preview deployment of `apps/web` to a new Vercel project named `cobweb`, created by the CLI from
  this machine, to show the Next build with sharp succeeds on Vercel and the queue trigger and cron
  are registered. No production deployment, no secrets: the consumer fails at its first message
  until the owner enters the env values, and no message is sent to a preview.
- The whole suite: typecheck, lint, test, `verify:storage`, `verify:sweep`, `verify:chain`.

## 12. Documentation

- This spec. The worker spec's section 9 and the AWS lines of sections 4, 8, 10 and 11 are marked
  superseded with a pointer here; the body text is not rewritten.
- `docs/MASTER_PLAN.md`: a dated decision under Decisions (hosting: Vercel, R2, no AWS, with the
  reasons above); the accounts line of Phase 0 (Supabase, Vercel, Cloudflare, Filebase; Railway
  stays for the freshness server); the Phase 4 status paragraph gains this sub-project and loses the
  AWS to-dos (the deploy, the Lambda benchmark, the alarm target); the owner's remaining to-dos are
  the production env values and the live Filebase checks.
- `CLAUDE.md`: the layout loses `infra/`; the commands lose the two infra lines; the worker line says
  where it runs. The root `README.md` loses its SQS, Lambda and S3 wording the same way.
- `services/worker/README.md` (new): what runs where, the env names, the Vercel settings, the R2
  setup, the two Filebase behaviours to confirm, the cap and how to raise it, and how to run the
  local runner. `infra/README.md` goes with the package.

## 13. Acceptance criteria

- [ ] No file under `apps`, `packages`, `services` or `supabase` imports `@aws-sdk/client-sqs`,
      `@aws-sdk/client-secrets-manager`, `aws-lambda` or `aws-cdk-lib`; `infra` is gone from the
      workspace and the repo.
- [ ] `pnpm typecheck`, `lint`, `test` and `build` pass; `verify:render` passes three times;
      `verify:local`, `verify:storage`, `verify:sweep` and `verify:chain` pass.
- [ ] A recorded payment sends one start message with the job's key; the sweep sends start messages
      with the same keys, so a stuck job is never rendered twice within a day.
- [ ] A message that throws three times fails its job with `dead-letter` and is acknowledged.
- [ ] The preview deployment builds, and `vercel inspect` (or the deployment's function list) shows
      the consumer route with its trigger and the cron.
- [ ] The docs in section 12 are updated, and `docs/PLAN.md` is unchanged.
