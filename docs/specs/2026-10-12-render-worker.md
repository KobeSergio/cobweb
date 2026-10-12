# Render worker: specification

Phase 4, third sub-project of four (render core, job state, worker and local runner, screen wiring).
Product decisions: [../MASTER_PLAN.md](../MASTER_PLAN.md#decisions) and the Phase 4 section of the same
file, whose status line lists what is owed to this sub-project. What the worker calls:
[2026-10-11-render-core.md](2026-10-11-render-core.md) sections 5 to 11 (the render library) and
[2026-10-12-render-job-state.md](2026-10-12-render-job-state.md) sections 4 to 8 (the six database
functions and their sentences). Payment: [2026-10-09-lock-and-pay.md](2026-10-09-lock-and-pay.md)
section 4 (`jobPayment`, the factory, confirmations). Legacy reference:
[../legacy/artgen-lambda.md](../legacy/artgen-lambda.md) sections 4, 7 and 9.

## 1. Goal

Build the process that turns a paid render job into pinned images and metadata. It checks the payment
on chain, claims the job, renders each batch with `@cobweb/render`, pins the output, records progress
through the job state functions and finishes with the metadata set. Messages may arrive more than
once and in any order; the worker stays correct because every step is idempotent against the
database. It runs locally end to end for development and tests, and on SQS and Lambda in production.

## 2. Decisions taken in the design conversation

- The AWS infrastructure is built in this sub-project, with AWS CDK in TypeScript, in `us-east-1`.
- It is built and tested locally. No AWS or Filebase credentials are on the development machine, so
  the deploy itself, and the two Filebase behaviours the legacy notes mark as unverified (how a CAR is
  imported and how the CID comes back), are owed and recorded, with the exact commands left in the
  infra README. Nothing in this sub-project creates a cloud resource.
- The worker core depends on ports (jobs, store, pinner, chain, queue). Each has a production adapter
  and a local or test double, so the whole pipeline runs without AWS.
- A `RenderProblem` (bad art) fails the job at once: a rerun cannot fix it. Any other error is
  transient: the message is redelivered, and after three receives the dead-letter handler fails the
  job with code `dead-letter`.
- The payment is checked before the claim and fails closed: an unverified payment fails the job with
  `payment-mismatch`; a chain read error is transient.
- The collage is written to a separate render bucket, never to the `art` bucket, so the upload sweep
  cannot see it.

## 3. Scope

In:

- `packages/shared`: a dependency-free `render-queue` entry (the message type, `enqueueRender`, the
  `RenderQueue` port).
- `services/worker` (`@cobweb/worker`): ports, adapters, the spec mapper, the three steps, the
  dead-letter and sweep handlers, the local runner, the Lambda entry points.
- `infra/` (`@cobweb/infra`): the CDK app and stack, with template assertions.
- `apps/web/scripts/verify-render.ts` (`verify:render`) and a local benchmark script.
- Env names in `.env.example` files; commands in CLAUDE.md; MASTER_PLAN status line appended.

Out:

- Deploying, and anything that needs real AWS or Filebase credentials.
- The screen: polling, the Try again button, the `retryRender` action that calls `enqueueRender`
  (fourth sub-project). This sub-project provides `enqueueRender` and the SQS adapter it will use.
- Opacity and extra metadata columns (the mapper passes opacity 1 and no extra fields).
- Source deletion after 90 days (Phase 7).

## 4. The queue contract (`packages/shared/src/render-queue.ts`)

No imports beyond types, so the web app can use it without the worker's dependencies.

```ts
export type RenderMessage =
  | { jobId: string; step: 'start'; retries: number }
  | { jobId: string; step: 'batch'; index: number; retries: number }
  | { jobId: string; step: 'metadata'; retries: number }

export type RenderQueue = { send(messages: RenderMessage[]): Promise<void> }

export function parseRenderMessage(body: string): RenderMessage | null
export function enqueueRender(queue: RenderQueue, job: { id: string; retries: number }): Promise<void>
```

- `retries` is the job's `retries` value when the message was made. Every failure report passes it as
  `p_retries`, so a report older than the creator's latest retry is ignored by the database.
- `enqueueRender` sends one `start` message. `parseRenderMessage` returns null for anything that is
  not exactly one of the three shapes (uuid job id, non-negative integers); a null is acknowledged
  and logged, never retried.
- An SQS adapter `sqsRenderQueue(client, queueUrl)` lives in `services/worker/src/adapters/sqs.ts`
  and is re-exported from a `@cobweb/worker/queue` entry that imports only the SQS client, for the
  web app's later use.

## 5. Ports (`services/worker/src/ports.ts`)

```ts
export type Jobs = {
  job(jobId: string): Promise<JobRecord | null>
  renderData(job: JobRecord): Promise<RenderData>
  tokens(job: JobRecord, index: number): Promise<TokenRows>
  batches(jobId: string): Promise<BatchRecord[]>
  claim(jobId: string): Promise<JobRecord>
  batchStart(jobId: string, index: number): Promise<BatchRecord>
  batchDone(
    jobId: string,
    index: number,
    cid: string,
    size: number,
  ): Promise<{ batchesDone: number; last: boolean }>
  fail(
    jobId: string,
    index: number | null,
    code: string,
    message: string,
    final: boolean,
    retries: number,
  ): Promise<JobRecord>
  finish(jobId: string, result: FinishResult): Promise<JobRecord>
  stuck(olderThanMinutes: number): Promise<{ id: string; retries: number }[]>
}

export type Store = {
  load(ref: ImageRef): Promise<Uint8Array>
  putCollage(key: string, png: Uint8Array): Promise<void>
}

export type Pinner = { pin(car: Uint8Array, expectedCid: string): Promise<string> }
export type Chain = { jobPayment(job: JobRecord): Promise<bigint> }
```

- `Jobs` is the only code that talks to Supabase. It uses a service-role client built in the worker
  (not the web app's, which is bound to Next). A refusal from a database function is thrown as a
  `JobRefusal` carrying the sentence, so steps can tell "already handled" from a real error.
- `Jobs.fail` hides the null-index cast the generated type needs.
- `Store.load` reads `uploads.storage_key` from the art bucket with read-only credentials.
- `Pinner.pin` returns the CID the pinning service reports. The step compares it with the CID the
  render library computed.

Production adapters: `supabaseJobs`, `s3Store`, `filebasePinner`, `viemChain`, `sqsRenderQueue`.
Local and test doubles: `folderPinner` (writes `<cid>.car` under a folder and returns the CID read
from the CAR's root), `wrongCidPinner`, `failingPinner` (fails a chosen batch a chosen number of
times), `memoryQueue` (delivery, redelivery after a throw, a dead-letter list after three receives)
and `memoryStore`. The step tests use hand-written fakes of `Jobs`; the database itself is exercised
by `verify:render`.

## 6. The spec mapper (`services/worker/src/spec.ts`)

Pure functions from rows to the render library's input, unit tested with fixture rows.

```ts
export function renderSpec(data: RenderData): GenerativeSpec | AssetSpec | PlaceholderSpec
export function tokenSlice(data: RenderData, rows: TokenRows): (GenerativeToken | AssetToken)[]
```

- Generative: `canvas` from `collections.canvas_width`; art collections by position; layers bottom
  first; traits with `blank`, `inMetadata` and an `ImageRef` from the trait's upload (`key`, and the
  extension taken from the key); `opacity` 1; `text.tokenName` is `token_name`, or the collection's
  name when null; `extraFields` empty; `batchSize` from the job. Tokens for a batch are the `tokens`
  rows with ids in the batch's range, `dna` as trait ids, `description` as stored.
- 1/1 and single asset: tokens from the `render_jobs.token_list` entries in the batch's range, each
  `uploadId` resolved to an `ImageRef` through the job's uploads.
- Placeholder: the job's `placeholder_upload_id` resolved to an `ImageRef`, with the collection's
  name and description.
- A row that cannot be mapped (a trait that is not blank and has no upload, an unknown upload id, a
  missing canvas) throws a `RenderProblem` with code `missing-image` or `bad-dna`, so it fails the job
  like any other art problem.

## 7. Steps (`services/worker/src/steps.ts`)

```ts
export type Deps = { jobs: Jobs; store: Store; pinner: Pinner; chain: Chain; queue: RenderQueue; log: Log }
export async function handle(message: RenderMessage, deps: Deps): Promise<void>
```

`handle` returns normally when the message is done or needs no work, and throws when it should be
redelivered.

**start**

1. Read the job. Missing, `done` or `failed`: return.
2. Only when the job is `paid` or `waived`: check the payment, unless `quote_total_wei` is 0 or the
   job is waived. The check is `chain.jobPayment(job) >= quote_total_wei`, read from the job's
   `quote_factory` on `quote_chain_id` at the chain's confirmation depth. A read error throws
   (redelivery). A short amount calls `fail(job, null, 'payment-mismatch', 'The payment could not be
verified on chain.', true, retries)` and returns.
3. `claim(job)`. It is idempotent: a job already `rendering` or `finalizing` comes back unchanged.
4. Read the batches. Send one `batch` message per batch not `done`; if all are done, send `metadata`.

**batch**

1. `batchStart`. A returned batch in state `done` means the work exists: go to step 5.
   `JOB_NOT_RENDERING`: return (the job moved on).
2. Build the spec and the batch's tokens; `renderBatch(spec, index, tokens, store.load)`.
3. `pinner.pin(car, cid)`. A different CID: `fail(job, index, 'cid-mismatch', 'The pinning service
returned a different CID.', true, retries)` and return.
4. `batchDone(job, index, cid, size)`.
5. If the done count equals the job's `batches_total`, send `metadata`, whether or not `last` is
   true, so a crash between the flip and the send cannot strand the job.

**metadata**

1. Read the job. Not `finalizing`: return (`done` means finished; anything else is not ready).
2. Real job: read the batch CIDs; `renderMetadataSet(spec, allTokens, cids)`; pin; compare CIDs as
   above (a job-level `cid-mismatch`). Placeholder job: `renderPlaceholder`; pin both CARs.
3. Collage, for real generative and 1/1 jobs only: the worker keeps no batch output, so it composites
   the first 16 tokens of batch 0 again, calls `previewCollage`, and writes the PNG with
   `store.putCollage('<collectionId>/collage/<jobId>.png', png)`. A collage failure is logged and
   skipped (`collage_key` stays null); it never fails a job.
4. `finish(job, { metadataCid, baseUri, placeholderImageCid, collageKey })`.

**Failures**

- An error whose `name` is `RenderProblem`: `fail(job, index, error.code, error.message, true,
retries)` and return. In the metadata step the index is null.
- A `JobRefusal`: `BATCH_RESULT_DIFFERS` and `JOB_RESULT_DIFFERS` become final `cid-mismatch` failures
  (the output was not the same twice); `JOB_NOT_RENDERING`, `JOB_NOT_READY`, `NO_SUCH_BATCH` and
  `BATCHES_STILL_RENDERING` are logged and returned.
- Anything else is thrown.

**Dead letter** (`handleDead(message, deps)`): `fail(job, index, 'dead-letter', 'The render did not
finish after several tries.', true, retries)`, where the index is the message's for a `batch` message
and null otherwise.

**Sweep** (`sweep(deps)`): `jobs.stuck(15)` returns jobs in `rendering` or `finalizing` whose job row
and batch rows were all last updated more than 15 minutes ago; each gets `enqueueRender`. The `start`
step then re-sends the open batches of a `rendering` job, or `metadata` for a `finalizing` one.

## 8. Local runner and scripts

- `services/worker/src/local.ts`: `runLocal(deps, { maxReceives: 3 })` drains a `memoryQueue`,
  calling `handle`, redelivering on a throw and calling `handleDead` after three receives.
- `apps/web/scripts/verify-render.ts`, run as `pnpm --filter @cobweb/web verify:render` (the
  `verify:chain` pattern: local endpoints only, config from `supabase status`, Anvil at
  `127.0.0.1:8545`). It seeds a generative project with drawn layers in local storage, locks and pays
  it on Anvil, then checks:
  1. the runner takes the job to `done` with one CID per batch, a metadata CID, a base URI and a
     collage object in the render bucket; the collection is `rendered`;
  2. with every message delivered twice, the final state is the same;
  3. a pinner that fails once on one batch: the batch is redelivered and the job finishes;
  4. a pinner that always fails on one batch: the job is `failed` with `dead-letter`; the owner's
     `art_render_retry` and `enqueueRender` finish it, and finished batches are not rendered again;
  5. a second project with the same input renders to identical CIDs;
  6. a job whose payment is short on chain is `failed` with `payment-mismatch` and is never claimed;
  7. a wrong-CID pinner fails the job with `cid-mismatch`;
  8. a layer of the wrong size fails the job with the `layer-size` code and its sentence;
  9. the sweep re-enqueues a job left `finalizing` and it finishes;
  10. a placeholder job on a deferred collection finishes with its slash-less base URI.
- `services/worker/scripts/bench.ts` (`pnpm --filter @cobweb/worker bench`): renders one batch of 100
  tokens from generated 2048 by 2048 layers (7 layers) in process and prints wall time, peak resident
  memory and CAR size. It is the input to the Lambda settings in section 9; it is not a test.

## 9. AWS (`infra/`)

One stack, `CobwebRender`, in `us-east-1`, defined in `infra/lib/render-stack.ts`:

- `RenderQueue` (SQS standard) with `RenderDeadLetters` as its dead-letter queue, `maxReceiveCount`
  3, visibility timeout 6 times the render function's timeout.
- `RenderFunction`: Node 22, arm64, handler `services/worker/src/lambda/render.ts`, bundled with
  esbuild including sharp's `linux-arm64` package, event source `RenderQueue` with batch size 1 and
  `reportBatchItemFailures`. Memory 4,096 MB, timeout 10 minutes, ephemeral storage 4,096 MB. These
  three numbers are starting points from PLAN.md; the benchmark on Lambda itself is owed.
- `DeadLetterFunction`: handler `lambda/dead.ts`, event source `RenderDeadLetters`.
- `SweepFunction`: handler `lambda/sweep.ts`, on an EventBridge rule every 15 minutes.
- `RenderBucket`: private, for collages, with public access blocked.
- Configuration from environment variables set by the stack; secrets (the Supabase service key, the
  Filebase keys, RPC URLs) from one Secrets Manager secret read at cold start, never written to the
  template or the logs.
- Roles: the render function may read the art bucket (`s3:GetObject` on its ARN, passed as a stack
  parameter), write the render bucket, send to and receive from the queue, and read the secret. The
  other two functions get only what they use. No wildcard resources.
- `infra/test/render-stack.test.ts` asserts the synthesized template: the redrive policy, the event
  source settings, the runtime and architecture, that no policy statement has a `*` resource, and
  that no secret value appears in the template.
- `infra/README.md`: the bootstrap and deploy commands, the secret's expected keys, and the two
  Filebase behaviours to confirm on first deploy.

The Lambda entry points are thin: parse the SQS record with `parseRenderMessage`, build the
production `Deps` once per container, call `handle`, and return partial batch failures.

`filebasePinner` uploads the CAR to Filebase's S3-compatible endpoint with the documented import
header and reads the CID from the response metadata. Because both behaviours are unverified, the
adapter is isolated behind `Pinner`, covered by a test against a stubbed S3 client, and the README
marks it as the first thing to confirm with a real key.

## 10. Configuration

Worker env names (in `services/worker/.env.example`; none starts with `NEXT_PUBLIC_`, none is read by
the browser, none is printed):

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ART_S3_ENDPOINT`, `ART_S3_REGION`, `ART_S3_BUCKET`,
`ART_S3_ACCESS_KEY_ID`, `ART_S3_SECRET_ACCESS_KEY`, `ART_S3_FORCE_PATH_STYLE`, `RENDER_S3_BUCKET`,
`FILEBASE_S3_ENDPOINT`, `FILEBASE_BUCKET`, `FILEBASE_ACCESS_KEY_ID`, `FILEBASE_SECRET_ACCESS_KEY`,
`RENDER_QUEUE_URL`, `RPC_URL_<chainId>`, `FACTORY_ADDRESS_<chainId>`.

`supabase/config.toml` gains a local `render` bucket (private, PNG only) for `verify:render`.

## 11. Testing

- Unit (Vitest, Node): the message parser; the spec mapper for each project type and each mapping
  failure; every step against fakes of the ports, covering duplicate delivery, a batch already done,
  a job that moved on, a short payment, a chain read error, a wrong CID, a `RenderProblem`, the
  retries value passed through, the metadata send when the count is full but `last` is false, the
  dead-letter handler for each message kind, and the sweep; `folderPinner` and `memoryQueue`;
  `filebasePinner` against a stubbed client; the Lambda handlers' partial-failure response.
- `verify:render` (section 8), run three times in a row to show it is stable.
- CDK template assertions (section 9).
- The existing suite: typecheck, lint, tests, `verify:local` (270), `verify:storage`, `verify:sweep`,
  `verify:chain`, build.

## 12. Acceptance criteria

- [ ] `enqueueRender` and the message type are importable from `@cobweb/shared` without pulling in the
      worker or sharp.
- [ ] `verify:render` passes its ten checks three times in a row against local Supabase, local
      storage and Anvil.
- [ ] The step tests cover every failure path of section 7.
- [ ] `cdk synth` succeeds without AWS credentials and the template assertions pass.
- [ ] No secret value is printed, logged or written to a template; no env name starts with
      `NEXT_PUBLIC_`.
- [ ] MASTER_PLAN's Phase 4 status line records the landing, what is owed (the deploy, the Filebase
      checks, the Lambda benchmark, native x64 goldens in CI, ICC and 16-bit layers across
      architectures) and what the fourth sub-project consumes (`enqueueRender`, the SQS queue adapter,
      the collage key and how to sign it).
