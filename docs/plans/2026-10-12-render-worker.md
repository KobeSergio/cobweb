# Render Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the process that turns a paid (or waived) render job into pinned images and metadata: it checks the payment on chain, claims the job, renders each batch with `@cobweb/render`, pins the output, records progress through the job state functions and finishes with the metadata set, correctly under duplicate and out-of-order delivery, running end to end locally and defined for SQS and Lambda.

**Architecture:** A dependency-free queue contract (`RenderMessage`, `parseRenderMessage`, `enqueueRender`, the `RenderQueue` port) lives in `packages/shared`. A new package `@cobweb/worker` in `services/worker` holds the worker: five ports (`Jobs`, `Store`, `Pinner`, `Chain`, `RenderQueue`), a pure spec mapper from database rows to the render library's input, three idempotent steps (`start`, `batch`, `metadata`) behind one `handle(message, deps)`, a dead-letter handler and a sweep. Each port has a production adapter (`supabaseJobs`, `s3Store`, `filebasePinner`, `viemChain`, `sqsRenderQueue`) and a local double (`memoryQueue`, `memoryStore`, `folderPinner`, `wrongCidPinner`, `failingPinner`), so `runLocal` drains a whole job without AWS and `verify:render` proves it against local Supabase, local storage and Anvil. A new package `@cobweb/infra` in `infra` defines one CDK stack, `CobwebRender`, whose three Lambda functions are thin SQS and schedule wrappers around the same steps. Nothing is deployed and nothing needs AWS or Filebase credentials.

**Tech Stack:** TypeScript strict (ESM, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`) consumed as source; Node 26 locally (type stripping for scripts, with `apps/web/scripts/resolve-ts.mjs`), Node 22 on Lambda (arm64); Vitest 5 in the Node environment; `@cobweb/render` (sharp 0.35.5, `@ipld/car` 5.4.7); supabase-js 2.117 with the service role; viem 2.57; AWS SDK v3 3.1147.0 (`client-s3`, `client-sqs`, `client-secrets-manager`); AWS CDK (`aws-cdk-lib` 2.273.0, `constructs` 10.8.1, `aws-cdk` 2.1145.0) bundling with esbuild 0.28.2; local Supabase (Postgres, Storage over its S3 protocol) and Anvil.

**Spec:** [../specs/2026-10-12-render-worker.md](../specs/2026-10-12-render-worker.md). It builds on [../specs/2026-10-11-render-core.md](../specs/2026-10-11-render-core.md) sections 5 to 11 and [../specs/2026-10-12-render-job-state.md](../specs/2026-10-12-render-job-state.md) sections 4 to 9.

## Global Constraints

- The spec is the binding authority. Where this plan decides a detail the spec leaves open, a line starts with "Decision:". The decisions that shape more than one task are collected in the next section.
- Every code block in this plan was written, formatted with the repo's Prettier settings, type checked, linted and (for unit tests) run in a scratch copy of the repo before it was pasted here. `apps/web/scripts/verify-render.ts` is the exception: it was type checked and linted and its imports were loaded under Node, but it was never run, because the planning session was not allowed to write to the local database. Tasks 10 and 11 are where it first runs.
- Node 26 locally, Node 22 on Lambda. ESM everywhere (`"type": "module"`). TypeScript strict with `noUncheckedIndexedAccess` and `verbatimModuleSyntax`: types are imported with `import type`.
- Inside `services/worker` and `infra`, relative imports carry the `.ts` extension (`./ports.ts`), as `packages/shared` does, so Node can run the files as they are. Both `tsconfig.json` files set `allowImportingTsExtensions`.
- Vitest 5, Node environment, no config file (the defaults pick up `src/**/*.test.ts` and `test/**/*.test.ts`). One file: `pnpm --filter <package> exec vitest run <file>`.
- Prettier: no semicolons, single quotes, trailing commas, 110 columns. Run `pnpm exec prettier --write <the files you changed>` from the repo root before each commit. Never run `pnpm format` or Prettier on `.`: the repo has files outside this work that are not formatted, and from inside `infra` Prettier does not read the root ignore file and would rewrite the bundles in `infra/cdk.out`.
- typescript-eslint's recommended rules apply to every package and to `apps/web/scripts`: no unused import, variable or parameter is introduced before the task that uses it.
- Copy: plain sentences. No em or en dashes anywhere, code comments and docs included. "Whitelist", never "Allowlist". The product is Cobweb.
- Security: `SUPABASE_SERVICE_ROLE_KEY`, the storage keys, the Filebase keys and every RPC URL are server only. No env name starts with `NEXT_PUBLIC_`. No value is printed or logged. An error is logged as `errorSummary(error)` (its name and one short line with anything URL shaped replaced), never as the error object, because viem and AWS errors can carry a URL with a key in it. No secret is written into a CDK template. Scripts refuse non-local endpoints.
- Nothing in any task creates a cloud resource or needs AWS or Filebase credentials. `cdk synth` and the template tests run without them. Never run `cdk deploy` or `cdk bootstrap`.
- `legacy/` is never imported, copied from or committed.
- The worker never writes to the `art` bucket. Its only write to storage is the collage, to the render bucket, under `<collection id>/collage/<job id>.png`.
- The sentences the database refuses with are copied character for character from `supabase/migrations/20261012010000_render_job_state.sql`; a test reads the migration to hold that.
- The four failure sentences the worker writes, character for character: `The payment could not be verified on chain.` (code `payment-mismatch`), `The pinning service returned a different CID.` (code `cid-mismatch`), `The render gave a different result than the one already recorded.` (code `cid-mismatch`), `The render did not finish after several tries.` (code `dead-letter`).
- Local services, for Tasks 10, 11 and 13 only: `supabase start` at the repo root, `supabase seed buckets`, and `pnpm --filter @cobweb/web chain:local` with its two lines in `apps/web/.env.local`. Never point a script at anything but localhost. This plan changes no migration, so the database is never reset.
- Implementers never use `rm`, `git commit --amend` or `git stash`. To fix a commit, make a new one.
- Commit messages are one imperative sentence with no prefix, and end with exactly these two lines (this overrides the skill's example):

```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bcHX4HZG5YGWhxjGuiWos
```

- Before every commit, at the repo root: `pnpm typecheck && pnpm lint && pnpm test`.

## Decisions

Each line settles something the spec leaves open. Tasks refer to them by number.

1. Decision: `services/worker` is consumed as TypeScript source, like `@cobweb/render` (`exports` point at `./src`). Tests run under Vitest. Scripts run under Node 26 with `--import apps/web/scripts/resolve-ts.mjs`, the hook `verify:chain` already uses: the worker's own imports carry `.ts`, and the hook adds `.ts` to the render library's extensionless ones. `apps/web` takes `@cobweb/worker` as a dev dependency so `verify:render` imports `@cobweb/worker` and `@cobweb/worker/local`; nothing in `apps/web/src` imports it.
2. Decision: the Lambda bundle is made by CDK's `NodejsFunction` with esbuild run locally, never in Docker. esbuild is a root dev dependency because CDK runs `pnpm exec -- esbuild` from the directory that holds `pnpm-lock.yaml` (with esbuild only in `infra`, synthesis fails with `Command "esbuild" not found`; verified). The output is CommonJS (`index.js`, CDK's default), which esbuild produces from the ESM source. `bundleAwsSDK: true` bundles the SDK at the lock file's version. sharp stays external (`externalModules: ['sharp']`) and an `afterBundling` hook installs it beside the bundle with `npm install --prefix <output> --os=linux --cpu=arm64 --libc=glibc sharp@<the render library's exact pin>`. All three functions get it, because each imports the steps, and the steps import the render library, which loads sharp when it is imported. Verified in a scratch copy: `cdk synth` succeeds with no AWS credentials and no Docker, and each of the three bundles loads and answers in the `public.ecr.aws/lambda/nodejs:22` arm64 image.
3. Decision: the template tests skip bundling with the context `'aws:cdk:bundling-stacks': []`, so they need no esbuild run, no npm install, no Docker and no network, and finish in about a second. `Code.fromInline` was not used: it would test a different construct than the one deployed.
4. Decision: `packages/shared` exports the queue contract twice: as the subpath `@cobweb/shared/render-queue` (a file with no imports at all, which the worker's `@cobweb/worker/queue` entry uses) and from the package index (which the web app and scripts already import; the index also loads viem). `parseRenderMessage` accepts lower-case uuids only, the form Postgres writes.
5. Decision: the worker reads the generated database types with a type-only relative import of `apps/web/src/lib/database.types.ts`. The import is erased, so the worker never loads the web app, and there is one generated file to keep current.
6. Decision: `JobRecord` never carries `token_list` (it can be megabytes), and `quote_total_wei` is selected as `quote_total_wei::text` and held as a `bigint`, as the web app's `JOB_COLUMNS` does. A numeric read as a JSON number loses wei above 2^53, and the rows the job state functions return are read that way, so `claim`, `fail` and `finish` ignore the returned row and read the job again with the worker's own select.
7. Decision: `supabaseJobs` keeps one job's render data and one job's file list per instance (one per Lambda container). Art cannot change while its job is open and the list is frozen at lock, so a container working through a job's batches reads them once.
8. Decision: `supabaseJobs.tokens` checks that a batch has exactly the tokens of its id range and throws a `RenderProblem` with code `batch-range` otherwise. `renderBatch` checks only that each token given belongs to the batch (read `services/render/src/batch.ts`, `checkRange`), so a batch with tokens missing would otherwise render and pin a short directory with no error.
9. Decision: the metadata step reads the job's tokens through `jobs.tokens(job, index)`, one batch at a time with 8 reads in flight, and keeps only the render library's token for each. Trait and collection ids are shared between tokens, so a 100,000 token generative job holds about 20 MB of tokens; `renderMetadataSet` then builds about 70 MB of JSON, which `packDirectory` holds about three times over, for a peak near 300 MB. That fits the render function's 4,096 MB; it would not fit a 512 MB function. A single asset job reads only batch 0, since its one metadata file describes token 1. No call loads the 100,000 `tokens` rows at once.
10. Decision: the collage's 16 images come from `renderBatch({ ...spec, batchSize: 16 }, 0, firstTokens, store.load)`, where `firstTokens` are the first 16 tokens of the job's batch 0. With a batch size of 16, ids 1 to 16 are exactly batch 0 under either reading of the library's range rule, only exported functions are used, and at most 16 tokens are composited. The files kept for the collage are the stills (`png`, `jpg`, `webp`); GIF and MP4 files are left out. A job whose first files are all GIF or MP4 gets no collage.
11. Decision: a placeholder job's one batch is the placeholder's image directory. The batch step calls `renderPlaceholder`, pins `image` and records its CID and size with `art_batch_done`; the metadata step calls `renderPlaceholder` again, pins both CARs and finishes with `placeholderImageCid` set.
12. Decision: `BATCH_RESULT_DIFFERS` and `JOB_RESULT_DIFFERS` are recorded as a job-level failure (`index` null) with code `cid-mismatch` and the sentence `The render gave a different result than the one already recorded.` The batch cannot be named: `art_batch_failed` refuses a failure that names a done batch (`This batch is already done.`). When the database refuses a failure report itself (the job moved on), the refusal is logged and the message is acknowledged; a message that cannot fail its job must not loop.
13. Decision: `stuck(15)` is one query for jobs in `rendering` or `finalizing` whose `updated_at` is before the cutoff (oldest first, at most 100), then one `limit 1` query a job for any batch row at or after the cutoff; a job with none is stuck. The cutoff is the worker's clock minus 15 minutes; `supabaseJobs` takes an optional `now` so a test and `verify:render` can move it.
14. Decision: the payment check reads `jobPayment(onchain_job_id, quote_payer)` on the job's `quote_factory` (or `FACTORY_ADDRESS_<chainId>` when the job has none) at block `latest - (confirmations - 1)`, with `latest` read with `cacheTime: 0`, as `confirmCore` in `apps/web/src/lib/art/lock-core.ts` reads it. `viemChain` imports `chainById`, `factoryAbi` and `factoryAddress` from `@cobweb/shared`, the browser-safe entry; `@cobweb/shared/server` imports `server-only`, which resolves only inside Next. The RPC URL comes from the worker's own environment record. A job with no chain or no payer answers 0, which fails closed. A chain, RPC URL or factory that is not configured throws, which is transient.
15. Decision: `memoryQueue` has `take()` (the next message with its receive count raised), `release(entry, maxReceives)` (back to the end, or to `dead` once received `maxReceives` times) and `takeDead()`; `copies: 2` delivers every message twice and `drop` loses the messages it picks. `runLocal` owns the loop and `maxReceives`. `failingPinner(inner, { nth, times })` picks the upload by the order in which distinct CIDs first arrive, which is the batch index when the local runner works through batches in order.
16. Decision: `s3Store` takes two `{ client, bucket }` pairs, the art bucket (read) and the render bucket (write). Locally both are Supabase Storage behind one client. On AWS the art client uses `ART_S3_REGION` and the function's role (no access key), and the render client uses the stack's region and the same role.
17. Decision: the stack creates the one secret with a generated value nobody uses, and the README gives the command that puts the real JSON in place after the first deploy. Deploy-time values that are not secret are CloudFormation parameters (`ArtBucketArn`, `ArtBucketRegion`, `SupabaseUrl`, `FilebaseBucket`). The functions get one extra environment name the spec's list does not have, `RENDER_SECRET_ARN`, which is not a secret.
18. Decision: `@aws-sdk/client-sqs` and `@aws-sdk/client-secrets-manager` are pinned exactly to 3.1147.0, the version `@aws-sdk/client-s3` is locked at, and `services/worker` pins `client-s3` to the same. A caret range resolved 3.1149.0 in the scratch copy, which installed a second `@aws-sdk/core` and broke `apps/web`'s type check of its presigner calls.
19. Decision: `verify:render` copies the minimum from `verify-chain.ts` (config discovery, the local-only guard, `signIn`, `contextFor`, `pay`, `check`), because that script runs on import and exports nothing. It stores layer images with the S3 client and records them with `record_upload` under the creator's session, locks and pays through `lockCore` and `confirmCore`, and sets `batch_size` 2 with the service client so five tokens make three batches, as `verify:local` 9h does.
20. Decision: a stored attribute entry is kept when it has a text `trait_type` and a text or number `value` (a number is written as its decimal text); any other entry is left out. A paid job is not failed for a stray attribute.
21. Decision: the dead-letter and sweep functions get 512 MB and a one minute timeout. The dead-letter queue keeps messages 14 days. A dead-letter message whose handler throws (the database is unreachable) stays on the dead-letter queue and is tried again.
22. Decision: `Log` is `(event, fields?) => void` with plain field values; `consoleLog` writes one JSON object a line.
23. Decision: `filebasePinner` uploads the CAR as `<cid>.car` with PutObject and reads the CID back with HeadObject, because the SDK does not expose PutObject's custom response headers.
24. Decision: CI is unchanged. `packages/shared`, `services/worker` and `infra` each have a `test` script, so their unit tests run under `pnpm test` through Turborepo. `verify:render` is local only, like the other verify scripts.

## Review Focus

Inputs and failure modes the spec implies but its listed tests would not exercise, most likely to bite first. Each is pinned to the task that owns the code.

1. A failure report the database itself refuses: the job finished, failed or was retried between the error and the report, or the batch named is already done. Expected: the refusal is logged and the message is acknowledged, so it cannot loop to the dead-letter queue and fail a healthy job from there. Pinned by "records a different finish result as a cid-mismatch and does not loop when that is refused too" (Task 6, `steps.test.ts`) and "acknowledges a dead message whose job cannot be failed" (Task 7, `steps.test.ts`).
2. A batch whose stored tokens are fewer than its id range (rows removed by hand, or a file list cut short). `renderBatch` checks membership only, so the batch would render, pin and be recorded short, and the job would finish with tokens missing. Expected: the job fails with `batch-range`. Pinned by "refuses a batch with fewer tokens stored than its range as a render problem" (Task 8, `supabase-jobs.test.ts`) and "fails the job for a render problem thrown by the mapper" (Task 5, `steps.test.ts`).
3. A quote above 2^53 wei (0.01 native a token on a 10,000 token set is 10^20 wei). Read as a JSON number it rounds, and the payment check compares against the wrong total. Expected: every wei is kept. Pinned by "reads the quote as a bigint, exactly" and "claims and then reads the job again, so the quote keeps every wei" (Task 8, `supabase-jobs.test.ts`).
4. An RPC or storage error whose message carries a URL with a key in it. Expected: the log line has the error's name and one short line with the URL replaced, and nothing else. Pinned by the `errorSummary` tests (Task 2, `ports.test.ts`) and "reports only the message whose run threw" (Task 9, `lambda.test.ts`), which asserts the logged line.
5. The queue refuses a send after the database already moved: the start step claimed the job, or the last batch flipped it to `finalizing`. Expected: the step throws so the message is redelivered, and the repeat sends again without redoing or double counting the work. Pinned by "throws when the queue refuses the batch messages, so the start is redelivered" (Task 4), "skips the work for a batch already done and still sends metadata when the count is full" (Task 5) and "throws when SQS refuses some entries" (Task 9, `sqs.test.ts`).

## File map

| Path                                                                                                                             | Task   | Responsibility                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------- |
| `packages/shared/src/render-queue.ts`, `render-queue.test.ts`                                                                    | 1      | `RenderMessage`, `RenderQueue`, `parseRenderMessage`, `enqueueRender`                  |
| `packages/shared/src/index.ts`, `package.json`                                                                                   | 1      | Re-export and the `./render-queue` subpath                                             |
| `services/worker/package.json`, `tsconfig.json`                                                                                  | 2      | The `@cobweb/worker` package                                                           |
| `services/worker/src/ports.ts`, `ports.test.ts`                                                                                  | 2      | Port types, `SENTENCES`, `JobRefusal`, `refusalOf`, the name checks                    |
| `services/worker/src/log.ts`                                                                                                     | 2      | `Log`, `errorSummary`, `consoleLog`                                                    |
| `services/worker/src/doubles/memory-queue.ts`, `memory-store.ts`, `pinners.ts`, `draw.ts`, `doubles.test.ts`                     | 2      | Local and test doubles                                                                 |
| `services/worker/src/spec.ts`, `spec.test.ts`                                                                                    | 3      | `imageRef`, `renderSpec`, `tokenSlice`                                                 |
| `services/worker/src/testing/fixtures.ts`                                                                                        | 3      | Fixture rows and images                                                                |
| `services/worker/src/testing/fake-jobs.ts`, `harness.ts`                                                                         | 4      | The fake `Jobs` port and the step tests' wiring                                        |
| `services/worker/src/steps.ts`, `steps.test.ts`                                                                                  | 4 to 7 | `Deps`, `handle` (start in 4, batch in 5, metadata in 6), `handleDead` and `sweep` (7) |
| `services/worker/src/local.ts`, `local.test.ts`                                                                                  | 7      | `runLocal` and the `@cobweb/worker/local` entry                                        |
| `services/worker/src/adapters/supabase-jobs.ts`, `supabase-jobs.test.ts`                                                         | 8      | `supabaseJobs`                                                                         |
| `services/worker/src/adapters/s3-store.ts`, `viem-chain.ts` and their tests                                                      | 8      | `s3Store`, `viemChain`                                                                 |
| `services/worker/src/testing/stub-client.ts`, `stub-aws.ts`                                                                      | 8      | Stand-ins for the Supabase and AWS clients                                             |
| `services/worker/src/adapters/filebase.ts`, `sqs.ts` and their tests                                                             | 9      | `filebasePinner`, `sqsRenderQueue`                                                     |
| `services/worker/src/env.ts`, `env.test.ts`, `.env.example`                                                                      | 9      | Env names and `productionDeps`                                                         |
| `services/worker/src/index.ts`, `queue.ts`                                                                                       | 9      | The package entries                                                                    |
| `services/worker/src/lambda/handler.ts`, `deps.ts`, `render.ts`, `dead.ts`, `sweep.ts`, `lambda.test.ts`                         | 9      | The Lambda entry points                                                                |
| `supabase/config.toml`                                                                                                           | 10     | The local `render` bucket                                                              |
| `apps/web/scripts/verify-render.ts`, `apps/web/package.json`                                                                     | 10, 11 | `verify:render` (setup and checks 1 to 5, then 6 to 10)                                |
| `services/worker/scripts/bench.ts`                                                                                               | 11     | The local benchmark                                                                    |
| `infra/package.json`, `tsconfig.json`, `cdk.json`, `bin/app.ts`, `lib/render-stack.ts`, `test/render-stack.test.ts`, `README.md` | 12     | The CDK app, the stack, its assertions, the deploy notes                               |
| `pnpm-workspace.yaml`, root `package.json`, `.gitignore`, `.prettierignore`, `eslint.config.mjs`                                 | 12     | Workspace wiring for `infra`                                                           |
| `docs/MASTER_PLAN.md`, `CLAUDE.md`, `apps/web/.env.example`, `docs/specs/2026-10-12-render-worker.md`                            | 13     | Status line, layout and commands, env names, acceptance boxes                          |

---

### Task 1: The queue contract in `packages/shared`

**Files:**

- Create: `packages/shared/src/render-queue.ts`
- Create: `packages/shared/src/render-queue.test.ts`
- Modify: `packages/shared/src/index.ts` (one line appended)
- Modify: `packages/shared/package.json` (`exports`)

**Interfaces:**

- Consumes: nothing.
- Produces, from `@cobweb/shared` and from `@cobweb/shared/render-queue`:
  - `type RenderMessage = { jobId: string; step: 'start'; retries: number } | { jobId: string; step: 'batch'; index: number; retries: number } | { jobId: string; step: 'metadata'; retries: number }`
  - `type RenderQueue = { send(messages: RenderMessage[]): Promise<void> }`
  - `function parseRenderMessage(body: string): RenderMessage | null`
  - `function enqueueRender(queue: RenderQueue, job: { id: string; retries: number }): Promise<void>`

Decision 4 applies: the file imports nothing, is exported both from the index and as its own subpath, and the parser accepts lower-case uuids only.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/render-queue.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { enqueueRender, parseRenderMessage, type RenderMessage } from './render-queue.ts'

const JOB = '3f0c2f5e-8a51-4c0e-9d7b-0d0f5a3b9c11'
const body = (value: unknown) => JSON.stringify(value)

describe('parseRenderMessage', () => {
  it('reads each of the three shapes', () => {
    expect(parseRenderMessage(body({ jobId: JOB, step: 'start', retries: 0 }))).toEqual({
      jobId: JOB,
      step: 'start',
      retries: 0,
    })
    expect(parseRenderMessage(body({ jobId: JOB, step: 'batch', index: 7, retries: 2 }))).toEqual({
      jobId: JOB,
      step: 'batch',
      index: 7,
      retries: 2,
    })
    expect(parseRenderMessage(body({ jobId: JOB, step: 'metadata', retries: 5 }))).toEqual({
      jobId: JOB,
      step: 'metadata',
      retries: 5,
    })
  })

  it('round-trips what the worker sends', () => {
    const messages: RenderMessage[] = [
      { jobId: JOB, step: 'start', retries: 1 },
      { jobId: JOB, step: 'batch', index: 0, retries: 1 },
      { jobId: JOB, step: 'metadata', retries: 1 },
    ]
    for (const message of messages) expect(parseRenderMessage(JSON.stringify(message))).toEqual(message)
  })

  it.each([
    ['not JSON', '{'],
    ['an empty body', ''],
    ['null', 'null'],
    ['an array', body([{ jobId: JOB, step: 'start', retries: 0 }])],
    ['a string', body('start')],
    ['no job id', body({ step: 'start', retries: 0 })],
    ['a job id that is not a uuid', body({ jobId: 'job-1', step: 'start', retries: 0 })],
    ['an upper-case job id', body({ jobId: JOB.toUpperCase(), step: 'start', retries: 0 })],
    ['an unknown step', body({ jobId: JOB, step: 'collage', retries: 0 })],
    ['no retries', body({ jobId: JOB, step: 'start' })],
    ['negative retries', body({ jobId: JOB, step: 'start', retries: -1 })],
    ['fractional retries', body({ jobId: JOB, step: 'start', retries: 1.5 })],
    ['retries as text', body({ jobId: JOB, step: 'start', retries: '1' })],
    ['a batch without an index', body({ jobId: JOB, step: 'batch', retries: 0 })],
    ['a batch with a negative index', body({ jobId: JOB, step: 'batch', index: -1, retries: 0 })],
    ['a batch with a fractional index', body({ jobId: JOB, step: 'batch', index: 0.5, retries: 0 })],
    ['a start with an index', body({ jobId: JOB, step: 'start', index: 0, retries: 0 })],
    ['an extra key', body({ jobId: JOB, step: 'metadata', retries: 0, range: [1, 100] })],
    ['an extra key on a batch', body({ jobId: JOB, step: 'batch', index: 0, retries: 0, final: true })],
  ])('returns null for %s', (_name, text) => {
    expect(parseRenderMessage(text)).toBeNull()
  })
})

describe('enqueueRender', () => {
  it('sends one start message with the job retries', async () => {
    const sent: RenderMessage[][] = []
    await enqueueRender({ send: async (messages) => void sent.push(messages) }, { id: JOB, retries: 3 })
    expect(sent).toEqual([[{ jobId: JOB, step: 'start', retries: 3 }]])
  })

  it('passes a queue failure on to the caller', async () => {
    const queue = { send: () => Promise.reject(new Error('queue down')) }
    await expect(enqueueRender(queue, { id: JOB, retries: 0 })).rejects.toThrow('queue down')
  })
})

describe('the module', () => {
  it('imports nothing, so the web app can use it without the worker or sharp', () => {
    const source = readFileSync(new URL('./render-queue.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/^\s*import\s/m)
    expect(source).not.toMatch(/\brequire\(/)
  })
})
```

- [ ] **Step 2: Run the test to see it fail**

Run: `pnpm --filter @cobweb/shared exec vitest run src/render-queue.test.ts`
Expected: FAIL. `Error: Cannot find module './render-queue.ts' imported from .../packages/shared/src/render-queue.test.ts`, "Test Files 1 failed", no tests run.

- [ ] **Step 3: Write the module**

Create `packages/shared/src/render-queue.ts`:

```ts
/**
 * The render queue contract (docs/specs/2026-10-12-render-worker.md, section 4): the message the web
 * app sends and the worker handles. This file imports nothing, so the web app can use it without the
 * worker's dependencies.
 */

export type RenderMessage =
  | { jobId: string; step: 'start'; retries: number }
  | { jobId: string; step: 'batch'; index: number; retries: number }
  | { jobId: string; step: 'metadata'; retries: number }

/** Where messages go: SQS in production, an in-memory queue locally. */
export type RenderQueue = { send(messages: RenderMessage[]): Promise<void> }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

function hasExactly(value: Record<string, unknown>, keys: string[]): boolean {
  const own = Object.keys(value)
  return own.length === keys.length && keys.every((key) => own.includes(key))
}

/**
 * A queue message body as a `RenderMessage`, or null for anything that is not exactly one of the
 * three shapes: a lower-case uuid job id, non-negative whole numbers, no other key. The caller
 * acknowledges and logs a null; it is never retried.
 */
export function parseRenderMessage(body: string): RenderMessage | null {
  let value: unknown
  try {
    value = JSON.parse(body)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const message = value as Record<string, unknown>
  const { jobId, step, retries, index } = message
  if (typeof jobId !== 'string' || !UUID.test(jobId) || !isCount(retries)) return null
  if (step === 'start' || step === 'metadata')
    return hasExactly(message, ['jobId', 'step', 'retries']) ? { jobId, step, retries } : null
  if (step === 'batch' && isCount(index))
    return hasExactly(message, ['jobId', 'step', 'index', 'retries']) ? { jobId, step, index, retries } : null
  return null
}

/**
 * Starts (or restarts) a job's render: one `start` message carrying the job's current `retries`.
 * The start step works out which batches are still open, so this is all a retry needs to send.
 */
export function enqueueRender(queue: RenderQueue, job: { id: string; retries: number }): Promise<void> {
  return queue.send([{ jobId: job.id, step: 'start', retries: job.retries }])
}
```

- [ ] **Step 4: Export it**

Append this line to `packages/shared/src/index.ts`, after the `job-id.ts` line:

```ts
export * from './render-queue.ts'
```

In `packages/shared/package.json`, the `exports` block becomes:

```json
{
  "exports": {
    ".": "./src/index.ts",
    "./server": "./src/server.ts",
    "./render-queue": "./src/render-queue.ts"
  }
}
```

(Only the `./render-queue` line is new; leave the rest of the file as it is. No dependency is added.)

- [ ] **Step 5: Run the test to see it pass**

Run: `pnpm --filter @cobweb/shared exec vitest run src/render-queue.test.ts`
Expected: PASS, 24 tests.

- [ ] **Step 6: Format, run the root checks and commit**

Run: `pnpm exec prettier --write packages/shared/src/render-queue.ts packages/shared/src/render-queue.test.ts packages/shared/src/index.ts packages/shared/package.json`

Run at the repo root: `pnpm typecheck && pnpm lint && pnpm test`
Expected: every Turborepo task succeeds.

```bash
git add packages/shared/src/render-queue.ts \
  packages/shared/src/render-queue.test.ts \
  packages/shared/src/index.ts \
  packages/shared/package.json
git commit -m "Add the render queue contract to the shared package" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bcHX4HZG5YGWhxjGuiWos"
```

---

### Task 2: The worker package, its ports and its local doubles

**Files:**

- Create: `services/worker/package.json`
- Create: `services/worker/tsconfig.json`
- Create: `services/worker/src/ports.ts`
- Create: `services/worker/src/log.ts`
- Create: `services/worker/src/ports.test.ts`
- Create: `services/worker/src/doubles/memory-queue.ts`
- Create: `services/worker/src/doubles/memory-store.ts`
- Create: `services/worker/src/doubles/pinners.ts`
- Create: `services/worker/src/doubles/draw.ts`
- Create: `services/worker/src/doubles/doubles.test.ts`
- Modify: `pnpm-lock.yaml` (by `pnpm install`)

**Interfaces:**

- Consumes: `RenderMessage`, `RenderQueue` from `@cobweb/shared/render-queue` (Task 1); `ImageRef`, `RenderProblem`, `packDirectory` from `@cobweb/render`.
- Produces, from `services/worker/src/ports.ts`:
  - `type RenderState`, `type JobRecord` (`id`, `collectionId`, `kind`, `state`, `tokenCount`, `batchSize`, `batchesTotal`, `batchesDone`, `quoteTotalWei: bigint`, `quoteChainId`, `quotePayer`, `quoteFactory`, `onchainJobId`, `placeholderUploadId`, `retries`, `errorCode`), `type BatchRecord` (`index`, `state`, `attempts`, `firstTokenId`, `lastTokenId`, `imagesCid`), `type FinishResult` (`metadataCid`, `baseUri`, `placeholderImageCid`, `collageKey`), `type RenderData` (`job`, `collection`, `artCollections`, `layers`, `traits`, `uploads`), `type TokenRows`
  - `type Jobs`, `type Store`, `type Pinner`, `type Chain` exactly as spec section 5
  - `const SENTENCES`, `type RefusalCode`, `class JobRefusal extends Error { code: RefusalCode }`, `function refusalOf(error): JobRefusal | null`, `function isJobRefusal(error): error is JobRefusal`, `function isRenderProblem(error): error is Error & { code: string }`
- Produces, from `log.ts`: `type Log = (event: string, fields?: Record<string, string | number | boolean | null>) => void`, `function errorSummary(error: unknown): string`, `const consoleLog: Log`
- Produces, from `doubles/`:
  - `memoryQueue(options?: { copies?: number; drop?: (message: RenderMessage) => boolean }): MemoryQueue` with `sent`, `dead`, `dropped`, `take(): QueueEntry | null`, `release(entry: QueueEntry, maxReceives: number): void`, `takeDead(): RenderMessage | null`, `size(): number`; `type QueueEntry = { message: RenderMessage; receives: number }`
  - `memoryStore(images: Record<string, Uint8Array>): MemoryStore` with `loads: string[]` and `collages: Map<string, Uint8Array>`
  - `carRoot(car: Uint8Array): Promise<string>`, `folderPinner(dir: string): FolderPinner` with `pinned: string[]`, `WRONG_CID`, `wrongCidPinner(): Pinner`, `failingPinner(inner: Pinner, options: { nth: number; times: number }): FailingPinner` with `failures: number`
  - `flatPng(colour: Rgba, size = 64): Promise<Uint8Array>`, `sizeOf(image: Uint8Array): Promise<{ width: number; height: number }>`

Decisions 1, 15, 18 and 22 apply. `RenderData` carries the job, because spec section 6 gives `renderSpec(data)` one argument and the batch size and placeholder upload live on the job.

- [ ] **Step 1: Create the package**

Create `services/worker/package.json`. It lists every dependency the later tasks use, so the lock file changes once:

```json
{
  "name": "@cobweb/worker",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./queue": "./src/queue.ts",
    "./local": "./src/local.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "test": "vitest run",
    "bench": "node --import ../../apps/web/scripts/resolve-ts.mjs scripts/bench.ts"
  },
  "dependencies": {
    "@aws-sdk/client-s3": "3.1147.0",
    "@aws-sdk/client-secrets-manager": "3.1147.0",
    "@aws-sdk/client-sqs": "3.1147.0",
    "@cobweb/render": "workspace:*",
    "@cobweb/shared": "workspace:*",
    "@ipld/car": "5.4.7",
    "@supabase/supabase-js": "^2.117.2",
    "sharp": "0.35.5",
    "viem": "^2.57.2"
  },
  "devDependencies": {
    "@types/aws-lambda": "^8.10.164",
    "@types/node": "^26.6.4",
    "vitest": "^5.0.3"
  }
}
```

Create `services/worker/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["node"], "allowImportingTsExtensions": true },
  "include": ["src", "scripts"]
}
```

Run at the repo root: `pnpm install`
Expected: it finishes without an error and `pnpm-lock.yaml` gains the worker's importer. Then run `pnpm typecheck`: expected to succeed for every package, `apps/web` included (decision 18: if `apps/web` now fails in `src/lib/storage/objects.ts` with "Types have separate declarations of a private property", an AWS SDK package resolved to a newer version than 3.1147.0; fix the pin, do not edit the web app).

- [ ] **Step 2: Write the failing tests**

Create `services/worker/src/ports.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { RenderProblem } from '@cobweb/render'
import { describe, expect, it } from 'vitest'
import { errorSummary } from './log.ts'
import { isJobRefusal, isRenderProblem, JobRefusal, refusalOf, SENTENCES } from './ports.ts'

describe('SENTENCES', () => {
  it('are raised, character for character, by the job state migration', () => {
    const sql = readFileSync(
      new URL('../../../supabase/migrations/20261012010000_render_job_state.sql', import.meta.url),
      'utf8',
    )
    for (const sentence of Object.values(SENTENCES))
      expect(sql, sentence).toContain(`raise exception '${sentence}'`)
  })
})

describe('refusalOf', () => {
  it('maps a check violation with a known sentence to its refusal', () => {
    const refusal = refusalOf({ code: '23514', message: 'This job is not rendering.' })
    expect(refusal).toBeInstanceOf(JobRefusal)
    expect(refusal?.code).toBe('JOB_NOT_RENDERING')
    expect(refusal?.message).toBe('This job is not rendering.')
    expect(refusal?.name).toBe('JobRefusal')
  })

  it('maps every sentence', () => {
    for (const [code, message] of Object.entries(SENTENCES))
      expect(refusalOf({ code: '23514', message })?.code).toBe(code)
  })

  it('is null for another errcode, an unknown sentence and no error', () => {
    expect(refusalOf({ code: '42501', message: 'This job is not rendering.' })).toBeNull()
    expect(refusalOf({ code: '23514', message: 'new row violates check constraint' })).toBeNull()
    expect(refusalOf({ message: 'This job is not rendering.' })).toBeNull()
    expect(refusalOf(null)).toBeNull()
  })
})

describe('the name checks', () => {
  it('tell a refusal and a render problem from any other error', () => {
    expect(isJobRefusal(new JobRefusal('NO_SUCH_BATCH'))).toBe(true)
    expect(isJobRefusal(new Error('This job is not rendering.'))).toBe(false)
    expect(isRenderProblem(new RenderProblem('layer-size', 'Too small.'))).toBe(true)
    expect(isRenderProblem(new Error('layer-size'))).toBe(false)
    expect(isRenderProblem('layer-size')).toBe(false)
  })
})

describe('errorSummary', () => {
  it('keeps the name and one short line, and never a URL', () => {
    const error = new Error('HTTP request failed.\nURL: https://rpc.example/v2/secret-key\nDetails: none')
    expect(errorSummary(error)).toBe('Error: HTTP request failed.')
    const inline = new TypeError('fetch failed for https://rpc.example/v2/secret-key today')
    expect(errorSummary(inline)).toBe('TypeError: fetch failed for [url] today')
  })

  it('prefers the short message viem errors carry', () => {
    const error = Object.assign(new Error('long text with https://rpc.example/key'), {
      shortMessage: 'The contract function "jobPayment" reverted.',
    })
    expect(errorSummary(error)).toBe('Error: The contract function "jobPayment" reverted.')
  })

  it('cuts a long message and names a thrown value that is not an error', () => {
    expect(errorSummary(new Error('x'.repeat(500))).length).toBe('Error: '.length + 200)
    expect(errorSummary('boom')).toBe('Unknown error')
  })
})
```

Create `services/worker/src/doubles/doubles.test.ts`:

```ts
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { packDirectory } from '@cobweb/render'
import type { RenderMessage } from '@cobweb/shared/render-queue'
import { describe, expect, it } from 'vitest'
import { flatPng, sizeOf } from './draw.ts'
import { memoryQueue } from './memory-queue.ts'
import { memoryStore } from './memory-store.ts'
import { carRoot, failingPinner, folderPinner, WRONG_CID, wrongCidPinner } from './pinners.ts'

const JOB = '3f0c2f5e-8a51-4c0e-9d7b-0d0f5a3b9c11'
const start: RenderMessage = { jobId: JOB, step: 'start', retries: 0 }
const batch = (index: number): RenderMessage => ({ jobId: JOB, step: 'batch', index, retries: 0 })
const text = (value: string) => new TextEncoder().encode(value)

describe('memoryQueue', () => {
  it('delivers in order and counts each receive', async () => {
    const queue = memoryQueue()
    await queue.send([start, batch(0)])
    expect(queue.size()).toBe(2)
    expect(queue.take()).toEqual({ message: start, receives: 1 })
    expect(queue.take()).toEqual({ message: batch(0), receives: 1 })
    expect(queue.take()).toBeNull()
    expect(queue.sent).toEqual([start, batch(0)])
  })

  it('redelivers a released message after the ones already waiting', async () => {
    const queue = memoryQueue()
    await queue.send([batch(0), batch(1)])
    const first = queue.take()!
    queue.release(first, 3)
    expect(queue.take()?.message).toEqual(batch(1))
    expect(queue.take()).toEqual({ message: batch(0), receives: 2 })
  })

  it('moves a message to the dead-letter list after three receives', async () => {
    const queue = memoryQueue()
    await queue.send([batch(4)])
    for (let receive = 1; receive <= 3; receive++) {
      const entry = queue.take()!
      expect(entry.receives).toBe(receive)
      queue.release(entry, 3)
    }
    expect(queue.take()).toBeNull()
    expect(queue.dead).toEqual([batch(4)])
    expect(queue.takeDead()).toEqual(batch(4))
    expect(queue.takeDead()).toBeNull()
  })

  it('delivers every message twice when asked for two copies', async () => {
    const queue = memoryQueue({ copies: 2 })
    await queue.send([start])
    expect(queue.size()).toBe(2)
    expect(queue.take()?.message).toEqual(start)
    expect(queue.take()?.message).toEqual(start)
    expect(queue.sent).toEqual([start])
  })

  it('loses the messages the drop option picks', async () => {
    const queue = memoryQueue({ drop: (message) => message.step === 'batch' })
    await queue.send([start, batch(0)])
    expect(queue.size()).toBe(1)
    expect(queue.dropped).toEqual([batch(0)])
    expect(queue.sent).toEqual([start, batch(0)])
  })
})

describe('memoryStore', () => {
  it('loads by key, records the loads and throws for a missing key', async () => {
    const store = memoryStore({ 'a.png': text('a') })
    expect(await store.load({ key: 'a.png', ext: 'png' })).toEqual(text('a'))
    await expect(store.load({ key: 'b.png', ext: 'png' })).rejects.toThrow('No object at b.png')
    expect(store.loads).toEqual(['a.png', 'b.png'])
  })

  it('keeps collages by key', async () => {
    const store = memoryStore({})
    await store.putCollage('c/collage/j.png', text('png'))
    expect(store.collages.get('c/collage/j.png')).toEqual(text('png'))
  })
})

describe('folderPinner', () => {
  it('writes <cid>.car and answers with the CID read from the CAR root', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'cobweb-pins-')), 'nested')
    const packed = await packDirectory([{ name: '1.png', bytes: text('one') }])
    const pinner = folderPinner(dir)
    expect(await pinner.pin(packed.car, 'not-what-the-car-says')).toBe(packed.cid)
    expect(readdirSync(dir)).toEqual([`${packed.cid}.car`])
    expect(new Uint8Array(readFileSync(join(dir, `${packed.cid}.car`)))).toEqual(packed.car)
    expect(pinner.pinned).toEqual([packed.cid])
    expect(await carRoot(packed.car)).toBe(packed.cid)
  })

  it('refuses bytes that are not a CAR', async () => {
    const pinner = folderPinner(mkdtempSync(join(tmpdir(), 'cobweb-pins-')))
    await expect(pinner.pin(text('not a car'), 'x')).rejects.toThrow()
  })
})

describe('wrongCidPinner and failingPinner', () => {
  it('answers with a well-formed CID that is not the expected one', async () => {
    expect(WRONG_CID).toMatch(/^[a-z2-7]{59}$/)
    expect(await wrongCidPinner().pin(text('car'), 'bafyexpected')).toBe(WRONG_CID)
  })

  it('fails the chosen upload the chosen number of times, then lets it through', async () => {
    const inner = { pin: async (_car: Uint8Array, cid: string) => cid }
    const pinner = failingPinner(inner, { nth: 1, times: 2 })
    expect(await pinner.pin(text('a'), 'cid-a')).toBe('cid-a')
    await expect(pinner.pin(text('b'), 'cid-b')).rejects.toThrow('The pinning service is not answering.')
    expect(await pinner.pin(text('c'), 'cid-c')).toBe('cid-c')
    await expect(pinner.pin(text('b'), 'cid-b')).rejects.toThrow()
    expect(await pinner.pin(text('b'), 'cid-b')).toBe('cid-b')
    expect(pinner.failures).toBe(2)
  })

  it('never lets the chosen upload through with times Infinity', async () => {
    const pinner = failingPinner({ pin: async (_car, cid) => cid }, { nth: 0, times: Infinity })
    for (let attempt = 0; attempt < 5; attempt++)
      await expect(pinner.pin(text('a'), 'cid-a')).rejects.toThrow()
    expect(await pinner.pin(text('b'), 'cid-b')).toBe('cid-b')
  })
})

describe('flatPng', () => {
  it('draws a square PNG of the size asked for', async () => {
    const png = await flatPng({ r: 10, g: 20, b: 30, alpha: 1 }, 32)
    expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
    expect(await sizeOf(png)).toEqual({ width: 32, height: 32 })
  })
})
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `pnpm --filter @cobweb/worker test`
Expected: FAIL. Both files fail to load: `Cannot find module './log.ts'` and `Cannot find module './draw.ts'`, "Test Files 2 failed".

- [ ] **Step 4: Write the ports and the log**

Create `services/worker/src/ports.ts`:

```ts
/**
 * The worker's ports (docs/specs/2026-10-12-render-worker.md, section 5). The steps depend on these
 * types only; each has a production adapter (src/adapters) and a local or test double (src/doubles).
 */
import type { ImageRef } from '@cobweb/render'

export type RenderState =
  'locked' | 'payment_due' | 'paid' | 'waived' | 'rendering' | 'finalizing' | 'done' | 'failed'

/** The `render_jobs` columns the worker reads. The token list is never part of it (it can be large). */
export type JobRecord = {
  id: string
  collectionId: string
  kind: 'real' | 'placeholder'
  state: RenderState
  tokenCount: number
  batchSize: number
  batchesTotal: number
  batchesDone: number
  /** `quote_total_wei`, read as text so no wei is lost. */
  quoteTotalWei: bigint
  quoteChainId: number | null
  quotePayer: string | null
  quoteFactory: string | null
  /** The factory's bytes32 job id (`render_jobs.onchain_job_id`). */
  onchainJobId: string
  placeholderUploadId: string | null
  /** How many times the creator retried the job; messages carry the value they were made with. */
  retries: number
  errorCode: string | null
}

export type BatchRecord = {
  index: number
  state: 'queued' | 'running' | 'done' | 'failed'
  attempts: number
  firstTokenId: number
  lastTokenId: number
  imagesCid: string | null
}

export type FinishResult = {
  metadataCid: string
  baseUri: string
  placeholderImageCid: string | null
  collageKey: string | null
}

/** Everything the spec mapper needs besides the tokens, as plain rows. Frozen while the job is open. */
export type RenderData = {
  job: JobRecord
  collection: {
    id: string
    name: string
    description: string
    projectType: 'generative' | 'one_of_one' | 'single_asset'
    canvasWidth: number | null
    tokenName: string | null
    tokenDescription: string
    showBlankTraits: boolean
  }
  artCollections: { id: string; position: number }[]
  layers: {
    id: string
    artCollectionId: string
    name: string
    displayName: string | null
    position: number
  }[]
  traits: {
    id: string
    layerId: string
    name: string
    blank: boolean
    inMetadata: boolean
    uploadId: string | null
    position: number
  }[]
  uploads: { id: string; storageKey: string }[]
}

/** One batch's tokens as stored: `tokens` rows for generative, `render_jobs.token_list` entries otherwise. */
export type TokenRows =
  | {
      kind: 'generative'
      rows: { tokenId: number; artCollectionId: string; dna: string[]; description: string | null }[]
    }
  | { kind: 'assets'; rows: { id: number; uploadId: string; attributes: unknown }[] }

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

/**
 * The sentences the job state functions refuse with (supabase/migrations/20261012010000_render_job_state.sql),
 * character for character. A test reads the migration and checks each one is raised there.
 */
export const SENTENCES = {
  JOB_NOT_READY: 'This job is not ready to render.',
  BATCH_COUNT_MISMATCH: 'The batch count does not match the token count.',
  JOB_NOT_RENDERING: 'This job is not rendering.',
  NO_SUCH_BATCH: 'There is no such batch.',
  BATCH_RESULT_DIFFERS: 'This batch was already recorded with a different result.',
  BATCH_ALREADY_DONE: 'This batch is already done.',
  JOB_RESULT_DIFFERS: 'This job was already finished with a different result.',
  BATCHES_STILL_RENDERING: 'This job has batches still rendering.',
  JOB_FAILURE_NEEDS_FINAL: 'A job-level failure must be final.',
} as const

export type RefusalCode = keyof typeof SENTENCES

/** A refusal from a job state function: the database said no, on purpose, with a known sentence. */
export class JobRefusal extends Error {
  code: RefusalCode

  constructor(code: RefusalCode) {
    super(SENTENCES[code])
    this.name = 'JobRefusal'
    this.code = code
  }
}

/** The refusal a database error stands for (errcode 23514 and a known sentence), or null for any other error. */
export function refusalOf(error: { code?: string; message?: string } | null | undefined): JobRefusal | null {
  if (!error || error.code !== '23514') return null
  const found = (Object.keys(SENTENCES) as RefusalCode[]).find((code) => SENTENCES[code] === error.message)
  return found ? new JobRefusal(found) : null
}

/** Checked by name, not `instanceof`: a bundle may hold more than one copy of a module. */
export function isJobRefusal(error: unknown): error is JobRefusal {
  return error instanceof Error && error.name === 'JobRefusal' && 'code' in error
}

/** A `RenderProblem` from `@cobweb/render`, checked by name for the same reason. */
export function isRenderProblem(error: unknown): error is Error & { code: string } {
  return (
    error instanceof Error &&
    error.name === 'RenderProblem' &&
    typeof (error as { code?: unknown }).code === 'string'
  )
}
```

Create `services/worker/src/log.ts`:

```ts
/** One log line: an event name and a few plain fields. Never an error object, never a secret. */
export type Log = (event: string, fields?: Record<string, string | number | boolean | null>) => void

const URL_LIKE = /[a-z][a-z0-9+.-]*:\/\/\S+/gi

/**
 * An error as a log field: its name and a short message. viem and AWS errors can carry an RPC or
 * endpoint URL with a key in it, so viem's `shortMessage` is preferred, only the first line is kept,
 * anything shaped like a URL is replaced and the text is cut at 200 characters.
 */
export function errorSummary(error: unknown): string {
  if (!(error instanceof Error)) return 'Unknown error'
  const short = (error as { shortMessage?: unknown }).shortMessage
  const text = (typeof short === 'string' ? short : error.message).split('\n')[0] ?? ''
  return `${error.name}: ${text.replace(URL_LIKE, '[url]').slice(0, 200)}`
}

/** Writes each line as one JSON object, which CloudWatch indexes by field. */
export const consoleLog: Log = (event, fields = {}) => {
  console.log(JSON.stringify({ event, ...fields }))
}
```

- [ ] **Step 5: Write the doubles**

Create `services/worker/src/doubles/memory-queue.ts`:

```ts
import type { RenderMessage, RenderQueue } from '@cobweb/shared/render-queue'

export type QueueEntry = { message: RenderMessage; receives: number }

export type MemoryQueue = RenderQueue & {
  /** Every message ever sent, in order. */
  sent: RenderMessage[]
  /** Messages that were received `maxReceives` times without success. */
  dead: RenderMessage[]
  /** Messages the `drop` option kept from being delivered. */
  dropped: RenderMessage[]
  /** The next message, with its receive count already raised, or null when the queue is empty. */
  take(): QueueEntry | null
  /** Puts a message that failed back at the end, or on the dead-letter list after `maxReceives` receives. */
  release(entry: QueueEntry, maxReceives: number): void
  /** The next dead-letter message, removed from the list, or null. */
  takeDead(): RenderMessage | null
  size(): number
}

/**
 * A queue in memory with the delivery rules of SQS that matter to the worker: a message that fails
 * comes back, and after `maxReceives` receives it goes to the dead-letter list. `copies: 2` delivers
 * every message twice, which is how the checks exercise duplicate delivery. `drop` loses the
 * messages it picks, as a crash between a database write and a send would.
 */
export function memoryQueue(
  options: { copies?: number; drop?: (message: RenderMessage) => boolean } = {},
): MemoryQueue {
  const copies = Math.max(1, Math.floor(options.copies ?? 1))
  const waiting: QueueEntry[] = []
  const sent: RenderMessage[] = []
  const dead: RenderMessage[] = []
  const dropped: RenderMessage[] = []
  return {
    sent,
    dead,
    dropped,
    async send(messages) {
      for (const message of messages) {
        sent.push(message)
        if (options.drop?.(message)) {
          dropped.push(message)
          continue
        }
        for (let copy = 0; copy < copies; copy++) waiting.push({ message: { ...message }, receives: 0 })
      }
    },
    take() {
      const entry = waiting.shift()
      if (!entry) return null
      entry.receives += 1
      return entry
    },
    release(entry, maxReceives) {
      if (entry.receives >= maxReceives) dead.push(entry.message)
      else waiting.push(entry)
    },
    takeDead() {
      return dead.shift() ?? null
    },
    size() {
      return waiting.length
    },
  }
}
```

Create `services/worker/src/doubles/memory-store.ts`:

```ts
import type { Store } from '../ports.ts'

export type MemoryStore = Store & {
  /** Every key loaded, in order, repeats included. */
  loads: string[]
  /** Collages written, by key. */
  collages: Map<string, Uint8Array>
}

/** A store over a key to bytes map. A missing key throws, as a missing object does in storage. */
export function memoryStore(images: Record<string, Uint8Array>): MemoryStore {
  const loads: string[] = []
  const collages = new Map<string, Uint8Array>()
  return {
    loads,
    collages,
    async load(ref) {
      loads.push(ref.key)
      const bytes = images[ref.key]
      if (!bytes) throw new Error(`No object at ${ref.key}`)
      return bytes
    },
    async putCollage(key, png) {
      collages.set(key, png)
    },
  }
}
```

Create `services/worker/src/doubles/pinners.ts`:

```ts
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CarReader } from '@ipld/car'
import type { Pinner } from '../ports.ts'

/** The root CID a CAR declares, as a base32 string. Throws when the bytes are not a CAR with one root. */
export async function carRoot(car: Uint8Array): Promise<string> {
  const reader = await CarReader.fromBytes(car)
  const roots = await reader.getRoots()
  const [root] = roots
  if (!root || roots.length !== 1) throw new Error('The CAR does not have exactly one root.')
  return root.toString()
}

export type FolderPinner = Pinner & {
  /** Every CID pinned, in order, repeats included. */
  pinned: string[]
}

/**
 * The local stand-in for the pinning service: writes `<cid>.car` under `dir` and answers with the
 * CID read from the CAR's own root, never the one the caller expected, so a wrong expectation shows.
 */
export function folderPinner(dir: string): FolderPinner {
  const pinned: string[] = []
  return {
    pinned,
    async pin(car) {
      const cid = await carRoot(car)
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, `${cid}.car`), car)
      pinned.push(cid)
      return cid
    },
  }
}

/** A well-formed CID that no render produces. */
export const WRONG_CID = `bafybei${'a'.repeat(52)}`

/** A pinning service that answers with a different CID every time. */
export function wrongCidPinner(): Pinner {
  return { pin: async () => WRONG_CID }
}

export type FailingPinner = Pinner & {
  /** How many times it has failed so far. */
  failures: number
}

/**
 * Fails one upload a chosen number of times, then passes everything to `inner`. The upload is
 * chosen by the order in which distinct CIDs first arrive: `nth: 1` is the second distinct CAR,
 * which is batch 1 when the local runner works through the batches in order. `times: Infinity`
 * never lets it through.
 */
export function failingPinner(inner: Pinner, options: { nth: number; times: number }): FailingPinner {
  const seen: string[] = []
  const pinner: FailingPinner = {
    failures: 0,
    async pin(car, expectedCid) {
      if (!seen.includes(expectedCid)) seen.push(expectedCid)
      if (seen.indexOf(expectedCid) === options.nth && pinner.failures < options.times) {
        pinner.failures += 1
        throw new Error('The pinning service is not answering.')
      }
      return inner.pin(car, expectedCid)
    },
  }
  return pinner
}
```

Create `services/worker/src/doubles/draw.ts`:

```ts
import sharp from 'sharp'

export type Rgba = { r: number; g: number; b: number; alpha: number }

/** A flat colour PNG, `size` by `size`. For fixtures only: tests, verify:render and the benchmark. */
export async function flatPng(colour: Rgba, size = 64): Promise<Uint8Array> {
  const png = await sharp({ create: { width: size, height: size, channels: 4, background: colour } })
    .png()
    .toBuffer()
  return new Uint8Array(png)
}

/** The width and height of an image. */
export async function sizeOf(image: Uint8Array): Promise<{ width: number; height: number }> {
  const { width, height } = await sharp(image).metadata()
  return { width, height }
}
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `pnpm --filter @cobweb/worker test`
Expected: PASS, 2 files, 21 tests.

- [ ] **Step 7: Format, run the root checks and commit**

Run: `pnpm exec prettier --write services/worker/package.json services/worker/tsconfig.json services/worker/src`

Run at the repo root: `pnpm typecheck && pnpm lint && pnpm test`
Expected: every Turborepo task succeeds.

```bash
git add services/worker/package.json \
  services/worker/tsconfig.json \
  services/worker/src \
  pnpm-lock.yaml
git commit -m "Add the render worker package with its ports and local doubles" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bcHX4HZG5YGWhxjGuiWos"
```

---

### Task 3: The spec mapper

**Files:**

- Create: `services/worker/src/spec.ts`
- Create: `services/worker/src/spec.test.ts`
- Create: `services/worker/src/testing/fixtures.ts`

**Interfaces:**

- Consumes: `RenderData`, `TokenRows`, `JobRecord`, `BatchRecord` from `./ports.ts` (Task 2); `flatPng` from `./doubles/draw.ts` (Task 2); `RenderProblem` and the spec types from `@cobweb/render`.
- Produces, from `spec.ts`:
  - `function imageRef(key: string): ImageRef | null`
  - `function renderSpec(data: RenderData): GenerativeSpec | AssetSpec | PlaceholderSpec`
  - `function tokenSlice(data: RenderData, rows: TokenRows): (GenerativeToken | AssetToken)[]`
- Produces, from `testing/fixtures.ts` (tests only): `JOB_ID`, `COLLECTION_ID`, `layerKey(name)`, `assetKey(name, ext?)`, `PLACEHOLDER_KEY`, `jobRecord(over?)`, `generativeData(over?)`, `generativeImages()`, `generativeRows(first, last)`, `assetData(over?)`, `assetRows(first, last)`, `assetImages()`, `GIF_BYTES`, `placeholderData(over?)`, `seedBatches(job)`. The fixture job has 5 tokens, batch size 2, 3 batches, quote 125 wei on chain 31337.

The mapper is spec section 6. Layers are bottom first: `layers.position` 0 is the bottom of the stack, and `tokens.dna` lists one trait id per layer in that order. Opacity is 1 and `extraFields` is empty until their columns exist. Decision 20 covers stored attributes. A missing canvas, a non-blank trait with no upload, an unknown upload id and a placeholder job without its file each throw a `RenderProblem` with code `missing-image`; rows of the wrong kind for the project throw `bad-dna` (a file list on a generative project) or `missing-image` (generated tokens on a 1/1 project), the codes the render library uses for the same mix-up.

- [ ] **Step 1: Write the fixtures**

Create `services/worker/src/testing/fixtures.ts`:

```ts
/**
 * Fixture rows for the worker's tests: a small generative project (one art collection, three layers
 * with a blank), its images drawn with sharp, and the 1/1, single asset and placeholder variants.
 * Not exported from the package.
 */
import { flatPng } from '../doubles/draw.ts'
import type { BatchRecord, JobRecord, RenderData, TokenRows } from '../ports.ts'

export const JOB_ID = '3f0c2f5e-8a51-4c0e-9d7b-0d0f5a3b9c11'
export const COLLECTION_ID = '9a1b2c3d-0000-4000-8000-000000000001'
const ART_ID = 'aaaaaaaa-0000-4000-8000-000000000001'

export const layerKey = (name: string) => `${COLLECTION_ID}/layers/${name}.png`
export const assetKey = (name: string, ext = 'png') => `${COLLECTION_ID}/assets/${name}.${ext}`
export const PLACEHOLDER_KEY = `${COLLECTION_ID}/placeholders/hidden.gif`

export function jobRecord(over: Partial<JobRecord> = {}): JobRecord {
  return {
    id: JOB_ID,
    collectionId: COLLECTION_ID,
    kind: 'real',
    state: 'paid',
    tokenCount: 5,
    batchSize: 2,
    batchesTotal: 3,
    batchesDone: 0,
    quoteTotalWei: 125n,
    quoteChainId: 31337,
    quotePayer: '0x00000000000000000000000000000000000000aa',
    quoteFactory: '0x00000000000000000000000000000000000000fa',
    onchainJobId: `0x3f0c2f5e8a514c0e9d7b0d0f5a3b9c11${'0'.repeat(32)}`,
    placeholderUploadId: null,
    retries: 0,
    errorCode: null,
    ...over,
  }
}

/** Three layers bottom first: Background shown as "Scene", Eyes, and Hat with a blank "None". */
export function generativeData(over: Partial<JobRecord> = {}): RenderData {
  const layer = (id: string, name: string, position: number, displayName: string | null = null) => ({
    id,
    artCollectionId: ART_ID,
    name,
    displayName,
    position,
  })
  const trait = (id: string, layerId: string, name: string, position: number, uploadId: string | null) => ({
    id,
    layerId,
    name,
    blank: uploadId === null,
    inMetadata: true,
    uploadId,
    position,
  })
  return {
    job: jobRecord(over),
    collection: {
      id: COLLECTION_ID,
      name: 'Night Owls',
      description: 'Owls that stay up.',
      projectType: 'generative',
      canvasWidth: 64,
      tokenName: 'Owl',
      tokenDescription: 'A night owl.',
      showBlankTraits: false,
    },
    artCollections: [{ id: ART_ID, position: 0 }],
    // Listed out of order on purpose: the mapper sorts by position.
    layers: [layer('l-hat', 'Hat', 2), layer('l-bg', 'Background', 0, 'Scene'), layer('l-eyes', 'Eyes', 1)],
    traits: [
      trait('t-dusk', 'l-bg', 'Dusk', 1, 'u-dusk'),
      trait('t-ink', 'l-bg', 'Ink', 0, 'u-ink'),
      trait('t-wide', 'l-eyes', 'Wide', 0, 'u-wide'),
      trait('t-none', 'l-hat', 'None', 0, null),
      trait('t-cap', 'l-hat', 'Cap', 1, 'u-cap'),
    ],
    uploads: [
      { id: 'u-ink', storageKey: layerKey('ink') },
      { id: 'u-dusk', storageKey: layerKey('dusk') },
      { id: 'u-wide', storageKey: layerKey('wide') },
      { id: 'u-cap', storageKey: layerKey('cap') },
    ],
  }
}

/** Images for every key `generativeData` names, 64 by 64. */
export async function generativeImages(): Promise<Record<string, Uint8Array>> {
  return {
    [layerKey('ink')]: await flatPng({ r: 20, g: 20, b: 60, alpha: 1 }),
    [layerKey('dusk')]: await flatPng({ r: 200, g: 120, b: 60, alpha: 1 }),
    [layerKey('wide')]: await flatPng({ r: 255, g: 255, b: 0, alpha: 0.5 }),
    [layerKey('cap')]: await flatPng({ r: 255, g: 0, b: 0, alpha: 0.5 }),
  }
}

/** Five tokens: ids 1 to 5, alternating backgrounds, the cap on even ids. */
export function generativeRows(first: number, last: number): TokenRows {
  const rows = []
  for (let id = first; id <= last; id++)
    rows.push({
      tokenId: id,
      artCollectionId: ART_ID,
      dna: [id % 2 ? 't-ink' : 't-dusk', 't-wide', id % 2 ? 't-none' : 't-cap'],
      description: id === 3 ? 'The third owl.' : null,
    })
  return { kind: 'generative', rows }
}

/** A 1/1 project of three files (two PNGs and a GIF), one token each. */
export function assetData(over: Partial<JobRecord> = {}): RenderData {
  const base = generativeData({ tokenCount: 3, batchSize: 2, batchesTotal: 2, ...over })
  return {
    ...base,
    collection: { ...base.collection, projectType: 'one_of_one', canvasWidth: null },
    artCollections: [],
    layers: [],
    traits: [],
    uploads: [
      { id: 'u-one', storageKey: assetKey('one') },
      { id: 'u-two', storageKey: assetKey('two') },
      { id: 'u-three', storageKey: assetKey('three', 'gif') },
    ],
  }
}

export function assetRows(first: number, last: number): TokenRows {
  const uploads = ['u-one', 'u-two', 'u-three']
  const rows = []
  for (let id = first; id <= last; id++)
    rows.push({
      id,
      uploadId: uploads[id - 1] ?? 'u-missing',
      attributes: [{ trait_type: 'Edition', value: id }],
    })
  return { kind: 'assets', rows }
}

/** A minimal GIF header padded to the 12 bytes the library's sniffer needs. */
export const GIF_BYTES = new Uint8Array([...new TextEncoder().encode('GIF89a'), 1, 0, 1, 0, 0, 0, 0, 59])

export async function assetImages(): Promise<Record<string, Uint8Array>> {
  return {
    [assetKey('one')]: await flatPng({ r: 10, g: 200, b: 10, alpha: 1 }),
    [assetKey('two')]: await flatPng({ r: 10, g: 10, b: 200, alpha: 1 }),
    [assetKey('three', 'gif')]: GIF_BYTES,
  }
}

/** A placeholder job on a deferred collection: one token, one batch, nothing to pay. */
export function placeholderData(over: Partial<JobRecord> = {}): RenderData {
  const base = generativeData({
    kind: 'placeholder',
    tokenCount: 1,
    batchSize: 1,
    batchesTotal: 1,
    quoteTotalWei: 0n,
    placeholderUploadId: 'u-hidden',
    ...over,
  })
  return {
    ...base,
    collection: { ...base.collection, canvasWidth: null },
    artCollections: [],
    layers: [],
    traits: [],
    uploads: [{ id: 'u-hidden', storageKey: PLACEHOLDER_KEY }],
  }
}

/** The batch rows `art_claim_render` seeds for a job. */
export function seedBatches(job: JobRecord): BatchRecord[] {
  return Array.from({ length: job.batchesTotal }, (_, index) => ({
    index,
    state: 'queued' as const,
    attempts: 0,
    firstTokenId: index * job.batchSize + 1,
    lastTokenId: Math.min((index + 1) * job.batchSize, job.tokenCount),
    imagesCid: null,
  }))
}
```

- [ ] **Step 2: Write the failing test**

Create `services/worker/src/spec.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { imageRef, renderSpec, tokenSlice } from './spec.ts'
import {
  assetData,
  assetKey,
  assetRows,
  generativeData,
  generativeRows,
  layerKey,
  PLACEHOLDER_KEY,
  placeholderData,
} from './testing/fixtures.ts'

const problem = (run: () => unknown): { code?: string; message?: string; name?: string } => {
  try {
    run()
  } catch (error) {
    return error as { code?: string; message?: string; name?: string }
  }
  return {}
}

describe('imageRef', () => {
  it('takes the extension from the key', () => {
    expect(imageRef('c/layers/abc.png')).toEqual({ key: 'c/layers/abc.png', ext: 'png' })
    expect(imageRef('c/assets/abc.mp4')).toEqual({ key: 'c/assets/abc.mp4', ext: 'mp4' })
    expect(imageRef('c/assets/abc.jpg')?.ext).toBe('jpg')
  })

  it('is null for a key with no known extension', () => {
    expect(imageRef('c/assets/abc')).toBeNull()
    expect(imageRef('c/assets/abc.svg')).toBeNull()
    expect(imageRef('c/assets/png')).toBeNull()
  })
})

describe('renderSpec: generative', () => {
  it('maps the canvas, the text and the batch size', () => {
    const spec = renderSpec(generativeData())
    expect(spec).toMatchObject({
      kind: 'generative',
      canvas: 64,
      batchSize: 2,
      text: { tokenName: 'Owl', tokenDescription: 'A night owl.', showBlankTraits: false, extraFields: {} },
    })
  })

  it('orders layers bottom first and traits by position, at full opacity', () => {
    const spec = renderSpec(generativeData())
    if (spec.kind !== 'generative') throw new Error('not generative')
    const [collection] = spec.collections
    expect(collection?.layers.map((layer) => layer.name)).toEqual(['Background', 'Eyes', 'Hat'])
    expect(collection?.layers.map((layer) => layer.opacity)).toEqual([1, 1, 1])
    expect(collection?.layers[0]?.displayName).toBe('Scene')
    expect(collection?.layers[0]?.traits.map((trait) => trait.name)).toEqual(['Ink', 'Dusk'])
  })

  it('gives a trait its upload as an image reference and a blank none', () => {
    const spec = renderSpec(generativeData())
    if (spec.kind !== 'generative') throw new Error('not generative')
    const hat = spec.collections[0]?.layers[2]
    expect(hat?.traits).toEqual([
      { id: 't-none', name: 'None', blank: true, inMetadata: true, image: null },
      {
        id: 't-cap',
        name: 'Cap',
        blank: false,
        inMetadata: true,
        image: { key: layerKey('cap'), ext: 'png' },
      },
    ])
  })

  it('orders art collections by position', () => {
    const data = generativeData()
    data.artCollections = [
      { id: 'second', position: 1 },
      { id: 'first', position: 0 },
    ]
    const spec = renderSpec(data)
    if (spec.kind !== 'generative') throw new Error('not generative')
    expect(spec.collections.map((collection) => collection.id)).toEqual(['first', 'second'])
  })

  it('uses the collection name when there is no token name', () => {
    const data = generativeData()
    data.collection.tokenName = null
    expect(renderSpec(data)).toMatchObject({ text: { tokenName: 'Night Owls' } })
  })

  it('refuses a trait that is not blank and has no upload', () => {
    const data = generativeData()
    data.traits = data.traits.map((trait) => (trait.id === 't-cap' ? { ...trait, uploadId: null } : trait))
    expect(problem(() => renderSpec(data))).toMatchObject({
      name: 'RenderProblem',
      code: 'missing-image',
      message: 'Trait Cap in layer Hat has no image.',
    })
  })

  it('refuses a trait whose upload is not in the project', () => {
    const data = generativeData()
    data.uploads = data.uploads.filter((upload) => upload.id !== 'u-wide')
    expect(problem(() => renderSpec(data))).toMatchObject({ name: 'RenderProblem', code: 'missing-image' })
  })

  it('refuses a project with no canvas', () => {
    const data = generativeData()
    data.collection.canvasWidth = null
    expect(problem(() => renderSpec(data))).toMatchObject({ name: 'RenderProblem', code: 'missing-image' })
  })
})

describe('renderSpec: 1/1, single asset and placeholder', () => {
  it('maps a 1/1 project to an asset spec', () => {
    expect(renderSpec(assetData())).toEqual({
      kind: 'one_of_one',
      batchSize: 2,
      text: { tokenName: 'Owl', tokenDescription: 'A night owl.', showBlankTraits: false, extraFields: {} },
    })
  })

  it('maps a single asset project by its type', () => {
    const data = assetData()
    data.collection.projectType = 'single_asset'
    expect(renderSpec(data).kind).toBe('single_asset')
  })

  it('maps a placeholder job to the placeholder file with the collection name and description', () => {
    expect(renderSpec(placeholderData())).toEqual({
      kind: 'placeholder',
      image: { key: PLACEHOLDER_KEY, ext: 'gif' },
      name: 'Night Owls',
      description: 'Owls that stay up.',
    })
  })

  it('refuses a placeholder job whose file is not in the project', () => {
    const data = placeholderData()
    data.uploads = []
    expect(problem(() => renderSpec(data))).toMatchObject({ name: 'RenderProblem', code: 'missing-image' })
  })
})

describe('tokenSlice', () => {
  it('maps token rows to generative tokens', () => {
    expect(tokenSlice(generativeData(), generativeRows(3, 4))).toEqual([
      {
        id: 3,
        collectionId: 'aaaaaaaa-0000-4000-8000-000000000001',
        dna: ['t-ink', 't-wide', 't-none'],
        description: 'The third owl.',
      },
      {
        id: 4,
        collectionId: 'aaaaaaaa-0000-4000-8000-000000000001',
        dna: ['t-dusk', 't-wide', 't-cap'],
        description: null,
      },
    ])
  })

  it('resolves each list entry to its file and keeps its attributes', () => {
    expect(tokenSlice(assetData(), assetRows(2, 3))).toEqual([
      {
        id: 2,
        image: { key: assetKey('two'), ext: 'png' },
        attributes: [{ trait_type: 'Edition', value: '2' }],
      },
      {
        id: 3,
        image: { key: assetKey('three', 'gif'), ext: 'gif' },
        attributes: [{ trait_type: 'Edition', value: '3' }],
      },
    ])
  })

  it('leaves out attribute entries that are not a trait type and a value', () => {
    const rows = assetRows(1, 1)
    if (rows.kind !== 'assets') throw new Error('not assets')
    rows.rows[0]!.attributes = [
      { trait_type: 'Mood', value: 'Calm' },
      { trait_type: 7, value: 'x' },
      'loose',
      null,
      { trait_type: 'Deep', value: { a: 1 } },
    ]
    expect(tokenSlice(assetData(), rows)[0]).toMatchObject({
      attributes: [{ trait_type: 'Mood', value: 'Calm' }],
    })
    rows.rows[0]!.attributes = 'not a list'
    expect(tokenSlice(assetData(), rows)[0]).toMatchObject({ attributes: [] })
  })

  it('refuses an entry whose upload id is unknown', () => {
    expect(problem(() => tokenSlice(assetData(), assetRows(4, 4)))).toMatchObject({
      name: 'RenderProblem',
      code: 'missing-image',
      message: 'Token 4 names a file the project does not have.',
    })
  })

  it('refuses rows of the wrong kind for the project', () => {
    expect(problem(() => tokenSlice(generativeData(), assetRows(1, 1)))).toMatchObject({ code: 'bad-dna' })
    expect(problem(() => tokenSlice(assetData(), generativeRows(1, 1)))).toMatchObject({
      code: 'missing-image',
    })
  })
})
```

- [ ] **Step 3: Run the test to see it fail**

Run: `pnpm --filter @cobweb/worker exec vitest run src/spec.test.ts`
Expected: FAIL. `Error: Cannot find module './spec.ts' imported from .../services/worker/src/spec.test.ts`.

- [ ] **Step 4: Write the mapper**

Create `services/worker/src/spec.ts`:

```ts
/**
 * The spec mapper (docs/specs/2026-10-12-render-worker.md, section 6): pure functions from the rows
 * the worker reads to the render library's input. A row that cannot be mapped throws a
 * `RenderProblem`, so it fails the job like any other art problem.
 */
import { RenderProblem } from '@cobweb/render'
import type {
  AssetSpec,
  AssetToken,
  GenerativeSpec,
  GenerativeToken,
  ImageRef,
  MetadataText,
  PlaceholderSpec,
  RenderArtCollection,
} from '@cobweb/render'
import type { RenderData, TokenRows } from './ports.ts'

const EXTENSIONS: readonly ImageRef['ext'][] = ['png', 'jpg', 'webp', 'gif', 'mp4']

/** The image reference for a storage key: the key, and the extension taken from it. Null for any other ending. */
export function imageRef(key: string): ImageRef | null {
  const ext = EXTENSIONS.find((known) => key.endsWith(`.${known}`))
  return ext ? { key, ext } : null
}

const byPosition = (a: { position: number }, b: { position: number }) => a.position - b.position

// One lookup per data object, so a batch of tokens does not rebuild it for every token.
const uploadIndexes = new WeakMap<RenderData, Map<string, string>>()

function uploadKeys(data: RenderData): Map<string, string> {
  let index = uploadIndexes.get(data)
  if (!index) {
    index = new Map(data.uploads.map((upload) => [upload.id, upload.storageKey]))
    uploadIndexes.set(data, index)
  }
  return index
}

function refOf(data: RenderData, uploadId: string | null): ImageRef | null {
  const key = uploadId === null ? undefined : uploadKeys(data).get(uploadId)
  return key === undefined ? null : imageRef(key)
}

function textOf(data: RenderData): MetadataText {
  return {
    tokenName: data.collection.tokenName ?? data.collection.name,
    tokenDescription: data.collection.tokenDescription,
    showBlankTraits: data.collection.showBlankTraits,
    extraFields: {},
  }
}

function placeholderSpec(data: RenderData): PlaceholderSpec {
  const image = refOf(data, data.job.placeholderUploadId)
  if (!image) throw new RenderProblem('missing-image', 'The placeholder file is missing from the project.')
  return {
    kind: 'placeholder',
    image,
    name: data.collection.name,
    description: data.collection.description,
  }
}

function generativeSpec(data: RenderData): GenerativeSpec {
  const canvas = data.collection.canvasWidth
  if (canvas === null)
    throw new RenderProblem('missing-image', 'The project has no canvas size, so it has no layer images.')
  const collections: RenderArtCollection[] = [...data.artCollections].sort(byPosition).map((art) => ({
    id: art.id,
    layers: data.layers
      .filter((layer) => layer.artCollectionId === art.id)
      .sort(byPosition)
      .map((layer) => ({
        id: layer.id,
        name: layer.name,
        displayName: layer.displayName,
        opacity: 1,
        traits: data.traits
          .filter((trait) => trait.layerId === layer.id)
          .sort(byPosition)
          .map((trait) => {
            const image = trait.blank ? null : refOf(data, trait.uploadId)
            if (!trait.blank && !image)
              throw new RenderProblem(
                'missing-image',
                `Trait ${trait.name} in layer ${layer.name} has no image.`,
                { detail: { trait: trait.id, layer: layer.id } },
              )
            return { id: trait.id, name: trait.name, blank: trait.blank, inMetadata: trait.inMetadata, image }
          }),
      })),
  }))
  return { kind: 'generative', canvas, collections, text: textOf(data), batchSize: data.job.batchSize }
}

/** The render library's spec for a job: the placeholder's for a placeholder job, else by project type. */
export function renderSpec(data: RenderData): GenerativeSpec | AssetSpec | PlaceholderSpec {
  if (data.job.kind === 'placeholder') return placeholderSpec(data)
  if (data.collection.projectType === 'generative') return generativeSpec(data)
  return { kind: data.collection.projectType, text: textOf(data), batchSize: data.job.batchSize }
}

/** The attribute list stored at lock, kept as it is: entries with a text `trait_type` and a text or number `value`. */
function attributesOf(value: unknown): { trait_type: string; value: string }[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) return []
    const { trait_type: type, value: text } = entry as { trait_type?: unknown; value?: unknown }
    if (typeof type !== 'string') return []
    if (typeof text === 'string') return [{ trait_type: type, value: text }]
    return typeof text === 'number' ? [{ trait_type: type, value: String(text) }] : []
  })
}

/** One batch's stored rows as the render library's tokens. */
export function tokenSlice(data: RenderData, rows: TokenRows): (GenerativeToken | AssetToken)[] {
  const generative = data.collection.projectType === 'generative'
  if (rows.kind === 'generative') {
    if (!generative)
      throw new RenderProblem(
        'missing-image',
        'The job has generated tokens, but the project is not generative.',
      )
    return rows.rows.map((row) => ({
      id: row.tokenId,
      collectionId: row.artCollectionId,
      dna: row.dna,
      description: row.description,
    }))
  }
  if (generative)
    throw new RenderProblem('bad-dna', 'The job has a file list, but the project is generative.')
  return rows.rows.map((row) => {
    const image = refOf(data, row.uploadId)
    if (!image)
      throw new RenderProblem('missing-image', `Token ${row.id} names a file the project does not have.`, {
        tokenId: row.id,
        detail: { upload: row.uploadId },
      })
    return { id: row.id, image, attributes: attributesOf(row.attributes) }
  })
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `pnpm --filter @cobweb/worker test`
Expected: PASS, 3 files, 40 tests.

- [ ] **Step 6: Format, run the root checks and commit**

Run: `pnpm exec prettier --write services/worker/src`

Run at the repo root: `pnpm typecheck && pnpm lint && pnpm test`
Expected: every Turborepo task succeeds.

```bash
git add services/worker/src/spec.ts \
  services/worker/src/spec.test.ts \
  services/worker/src/testing/fixtures.ts
git commit -m "Map stored art rows to the render library's input" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bcHX4HZG5YGWhxjGuiWos"
```

---

### Task 4: The start step: the payment check and the claim

**Files:**

- Create: `services/worker/src/testing/fake-jobs.ts`
- Create: `services/worker/src/testing/harness.ts`
- Create: `services/worker/src/steps.ts`
- Create: `services/worker/src/steps.test.ts`

**Interfaces:**

- Consumes: the ports, `JobRefusal`, `isJobRefusal`, `isRenderProblem` (Task 2); `Log` (Task 2); `memoryQueue`, `memoryStore`, `carRoot` (Task 2); the fixtures (Task 3); `RenderMessage`, `RenderQueue` (Task 1).
- Produces, from `steps.ts`:
  - `type Deps = { jobs: Jobs; store: Store; pinner: Pinner; chain: Chain; queue: RenderQueue; log: Log }`
  - `const PAYMENT_MISMATCH = 'The payment could not be verified on chain.'`, `const RESULT_DIFFERS = 'The render gave a different result than the one already recorded.'`
  - `async function handle(message: RenderMessage, deps: Deps): Promise<void>`: returns when the message is done or needs no work, throws when it should be redelivered. In this task it handles `start`; Tasks 5 and 6 add `batch` and `metadata`.
- Produces, for tests only:
  - `fakeJobs(data: RenderData, rowsOf: (first: number, last: number) => TokenRows, options?: { claimed?: boolean }): FakeJobs`, a `Jobs` with `record`, `rows`, `failures: Failure[]`, `finished`, `calls: string[]`, `stuckJobs`
  - `harness(project?: 'generative' | 'assets' | 'placeholder', options?: { job?: Partial<JobRecord>; claimed?: boolean; paid?: bigint }): Promise<Harness>` with `deps`, `jobs`, `store`, `queue`, `pins`, `lines`, `paymentReads`; `startMessage(retries?)`, `batchMessage(index, retries?)`, `metadataMessage(retries?)`

The step is spec section 7, "start". The payment is checked only for a job in state `paid` with a quote above zero (a waived job and a free one have nothing to check), before the claim, and fails closed: a short amount is a final job-level failure with code `payment-mismatch`, recorded with the message's `retries`; a read error throws. The messages the step sends carry the job's current `retries`, read after the claim, not the `retries` of the message it handled. `handle` also holds the failure mapping every step shares (spec section 7, "Failures"; decision 12): a `RenderProblem` is a final failure with its code and sentence, a refusal is logged, anything else is thrown.

- [ ] **Step 1: Write the fake of the Jobs port and the test wiring**

Create `services/worker/src/testing/fake-jobs.ts`:

```ts
/**
 * A hand-written fake of the `Jobs` port for the step tests: one job in memory that follows the
 * job state functions' rules (docs/specs/2026-10-12-render-job-state.md, section 6) closely enough
 * to exercise the steps. The database itself is exercised by verify:render. Not exported from the
 * package.
 */
import { JobRefusal } from '../ports.ts'
import type { BatchRecord, FinishResult, JobRecord, Jobs, RenderData, TokenRows } from '../ports.ts'
import { seedBatches } from './fixtures.ts'

export type Failure = { index: number | null; code: string; message: string; final: boolean; retries: number }

export type FakeJobs = Jobs & {
  /** The job row as it stands. */
  record: JobRecord
  rows: BatchRecord[]
  /** Every failure report, accepted or not. */
  failures: Failure[]
  finished: FinishResult | null
  /** Method names in call order. */
  calls: string[]
  stuckJobs: { id: string; retries: number }[]
}

export function fakeJobs(
  data: RenderData,
  rowsOf: (first: number, last: number) => TokenRows,
  options: { claimed?: boolean } = {},
): FakeJobs {
  const record: JobRecord = { ...data.job }
  const fake: FakeJobs = {
    record,
    rows: [],
    failures: [],
    finished: null,
    calls: [],
    stuckJobs: [],

    async job(jobId) {
      fake.calls.push('job')
      return jobId === record.id ? { ...record } : null
    },

    async renderData(job) {
      fake.calls.push('renderData')
      return { ...data, job }
    },

    async tokens(job, index) {
      fake.calls.push(`tokens:${index}`)
      return rowsOf(index * job.batchSize + 1, Math.min((index + 1) * job.batchSize, job.tokenCount))
    },

    async batches(jobId) {
      fake.calls.push('batches')
      return jobId === record.id ? fake.rows.map((row) => ({ ...row })) : []
    },

    async claim(jobId) {
      fake.calls.push('claim')
      if (jobId !== record.id) throw new JobRefusal('JOB_NOT_READY')
      if (record.state === 'paid' || record.state === 'waived') {
        record.state = 'rendering'
        record.batchesDone = 0
        fake.rows = seedBatches(record)
      } else if (!['rendering', 'finalizing', 'done'].includes(record.state)) {
        throw new JobRefusal('JOB_NOT_READY')
      }
      return { ...record }
    },

    async batchStart(jobId, index) {
      fake.calls.push(`batchStart:${index}`)
      const row = jobId === record.id ? fake.rows.find((batch) => batch.index === index) : undefined
      if (row?.state === 'done') return { ...row }
      if (jobId !== record.id || record.state !== 'rendering') throw new JobRefusal('JOB_NOT_RENDERING')
      if (!row) throw new JobRefusal('NO_SUCH_BATCH')
      row.state = 'running'
      row.attempts += 1
      return { ...row }
    },

    async batchDone(jobId, index, cid) {
      fake.calls.push(`batchDone:${index}`)
      const open = record.state === 'rendering' || record.state === 'finalizing'
      const failedWithBatches = record.state === 'failed' && fake.rows.length > 0
      if (jobId !== record.id || !(open || failedWithBatches)) throw new JobRefusal('JOB_NOT_RENDERING')
      const row = fake.rows.find((batch) => batch.index === index)
      if (!row) throw new JobRefusal('NO_SUCH_BATCH')
      if (row.state === 'done') {
        if (row.imagesCid !== cid) throw new JobRefusal('BATCH_RESULT_DIFFERS')
        return { batchesDone: record.batchesDone, last: false }
      }
      row.state = 'done'
      row.imagesCid = cid
      record.batchesDone = fake.rows.filter((batch) => batch.state === 'done').length
      const last = record.state === 'rendering' && record.batchesDone === record.batchesTotal
      if (last) record.state = 'finalizing'
      return { batchesDone: record.batchesDone, last }
    },

    async fail(jobId, index, code, message, final, retries) {
      fake.calls.push('fail')
      fake.failures.push({ index, code, message, final, retries })
      if (index === null && !final) throw new JobRefusal('JOB_FAILURE_NEEDS_FINAL')
      if (jobId !== record.id) throw new JobRefusal('JOB_NOT_RENDERING')
      const mismatch = code === 'payment-mismatch'
      if (retries < record.retries && !mismatch) return { ...record }
      if (record.state === 'failed') {
        if (mismatch) record.errorCode = code
        return { ...record }
      }
      const open = record.state === 'rendering' || record.state === 'finalizing'
      const unclaimed = record.state === 'paid' || record.state === 'waived'
      if (!(open || (mismatch && unclaimed))) throw new JobRefusal('JOB_NOT_RENDERING')
      if (index !== null && !mismatch) {
        const row = fake.rows.find((batch) => batch.index === index)
        if (!row) throw new JobRefusal('NO_SUCH_BATCH')
        if (row.state === 'done') throw new JobRefusal('BATCH_ALREADY_DONE')
        row.state = 'failed'
      }
      if (final) {
        record.state = 'failed'
        record.errorCode = code
      }
      return { ...record }
    },

    async finish(jobId, result) {
      fake.calls.push('finish')
      const same = JSON.stringify(fake.finished) === JSON.stringify(result)
      if (jobId === record.id && record.state === 'done') {
        if (same) return { ...record }
        throw new JobRefusal('JOB_RESULT_DIFFERS')
      }
      if (
        jobId !== record.id ||
        record.state !== 'finalizing' ||
        fake.rows.some((row) => row.state !== 'done')
      )
        throw new JobRefusal('BATCHES_STILL_RENDERING')
      record.state = 'done'
      fake.finished = result
      return { ...record }
    },

    async stuck() {
      fake.calls.push('stuck')
      return fake.stuckJobs
    },
  }
  if (options.claimed) {
    record.state = 'rendering'
    fake.rows = seedBatches(record)
  }
  return fake
}
```

Create `services/worker/src/testing/harness.ts`:

```ts
/** The step tests' wiring: fakes of every port around one fixture job. Not exported from the package. */
import type { RenderMessage } from '@cobweb/shared/render-queue'
import { memoryQueue } from '../doubles/memory-queue.ts'
import type { MemoryQueue } from '../doubles/memory-queue.ts'
import { memoryStore } from '../doubles/memory-store.ts'
import type { MemoryStore } from '../doubles/memory-store.ts'
import { carRoot } from '../doubles/pinners.ts'
import type { Chain, JobRecord, Pinner } from '../ports.ts'
import type { Deps } from '../steps.ts'
import { fakeJobs } from './fake-jobs.ts'
import type { FakeJobs } from './fake-jobs.ts'
import {
  assetData,
  assetImages,
  assetRows,
  generativeData,
  generativeImages,
  generativeRows,
  GIF_BYTES,
  JOB_ID,
  PLACEHOLDER_KEY,
  placeholderData,
} from './fixtures.ts'

export type Harness = {
  deps: Deps & { queue: MemoryQueue }
  jobs: FakeJobs
  store: MemoryStore
  queue: MemoryQueue
  /** CIDs pinned, in order. */
  pins: string[]
  /** Log lines as `event` or `event:refusal`. */
  lines: string[]
  /** Calls to the chain. */
  paymentReads: JobRecord[]
}

export const startMessage = (retries = 0): RenderMessage => ({ jobId: JOB_ID, step: 'start', retries })
export const batchMessage = (index: number, retries = 0): RenderMessage => ({
  jobId: JOB_ID,
  step: 'batch',
  index,
  retries,
})
export const metadataMessage = (retries = 0): RenderMessage => ({ jobId: JOB_ID, step: 'metadata', retries })

export async function harness(
  project: 'generative' | 'assets' | 'placeholder' = 'generative',
  options: { job?: Partial<JobRecord>; claimed?: boolean; paid?: bigint } = {},
): Promise<Harness> {
  const data =
    project === 'generative'
      ? generativeData(options.job)
      : project === 'assets'
        ? assetData(options.job)
        : placeholderData(options.job)
  const images =
    project === 'generative'
      ? await generativeImages()
      : project === 'assets'
        ? await assetImages()
        : { [PLACEHOLDER_KEY]: GIF_BYTES }
  const jobs = fakeJobs(data, project === 'generative' ? generativeRows : assetRows, {
    claimed: options.claimed,
  })
  const store = memoryStore(images)
  const queue = memoryQueue()
  const pins: string[] = []
  const lines: string[] = []
  const paymentReads: JobRecord[] = []
  const pinner: Pinner = {
    async pin(car) {
      const cid = await carRoot(car)
      pins.push(cid)
      return cid
    },
  }
  const chain: Chain = {
    async jobPayment(job) {
      paymentReads.push(job)
      return options.paid ?? job.quoteTotalWei
    },
  }
  const deps = {
    jobs,
    store,
    pinner,
    chain,
    queue,
    log: (event: string, fields: Record<string, string | number | boolean | null> = {}) => {
      lines.push(typeof fields.refusal === 'string' ? `${event}:${fields.refusal}` : event)
    },
  }
  return { deps, jobs, store, queue, pins, lines, paymentReads }
}
```

- [ ] **Step 2: Write the failing test**

Create `services/worker/src/steps.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { handle, PAYMENT_MISMATCH } from './steps.ts'
import { batchMessage, harness, metadataMessage, startMessage } from './testing/harness.ts'

describe('start', () => {
  it('checks the payment, claims the job and sends one batch message per batch', async () => {
    const h = await harness()
    await handle(startMessage(), h.deps)
    expect(h.paymentReads).toHaveLength(1)
    expect(h.jobs.record.state).toBe('rendering')
    expect(h.queue.sent).toEqual([batchMessage(0), batchMessage(1), batchMessage(2)])
    expect(h.jobs.calls.indexOf('claim')).toBeGreaterThan(h.jobs.calls.indexOf('job'))
  })

  it('returns without a claim for a missing, done or failed job', async () => {
    for (const state of ['done', 'failed'] as const) {
      const h = await harness('generative', { job: { state } })
      await handle(startMessage(), h.deps)
      expect(h.jobs.calls).toEqual(['job'])
      expect(h.queue.sent).toEqual([])
    }
    const h = await harness()
    await handle({ ...startMessage(), jobId: '00000000-0000-4000-8000-000000000000' }, h.deps)
    expect(h.jobs.calls).toEqual(['job'])
    expect(h.paymentReads).toEqual([])
  })

  it('fails a job whose payment is short with payment-mismatch and never claims it', async () => {
    const h = await harness('generative', { paid: 124n })
    await handle(startMessage(), h.deps)
    expect(h.jobs.failures).toEqual([
      { index: null, code: 'payment-mismatch', message: PAYMENT_MISMATCH, final: true, retries: 0 },
    ])
    expect(h.jobs.calls).not.toContain('claim')
    expect(h.jobs.record.state).toBe('failed')
    expect(h.queue.sent).toEqual([])
  })

  it('accepts a payment above the quote', async () => {
    const h = await harness('generative', { paid: 126n })
    await handle(startMessage(), h.deps)
    expect(h.jobs.record.state).toBe('rendering')
    expect(h.jobs.failures).toEqual([])
  })

  it('throws on a chain read error, so the message is redelivered, and changes nothing', async () => {
    const h = await harness()
    h.deps.chain = { jobPayment: () => Promise.reject(new Error('rpc down')) }
    await expect(handle(startMessage(), h.deps)).rejects.toThrow('rpc down')
    expect(h.jobs.record.state).toBe('paid')
    expect(h.jobs.failures).toEqual([])
    expect(h.jobs.calls).not.toContain('claim')
  })

  it('skips the payment check for a waived job and for a quote of zero', async () => {
    const waived = await harness('generative', { job: { state: 'waived' } })
    await handle(startMessage(), waived.deps)
    expect(waived.paymentReads).toEqual([])
    expect(waived.jobs.record.state).toBe('rendering')
    const free = await harness('generative', { job: { quoteTotalWei: 0n } })
    await handle(startMessage(), free.deps)
    expect(free.paymentReads).toEqual([])
    expect(free.jobs.record.state).toBe('rendering')
  })

  it('does not read the chain again for a job already rendering, and re-sends only open batches', async () => {
    const h = await harness('generative', { claimed: true })
    h.jobs.rows[0]!.state = 'done'
    h.jobs.rows[0]!.imagesCid = 'a'.repeat(59)
    h.jobs.rows[1]!.state = 'failed'
    await handle(startMessage(), h.deps)
    expect(h.paymentReads).toEqual([])
    expect(h.queue.sent).toEqual([batchMessage(1), batchMessage(2)])
  })

  it('sends metadata when every batch is already done', async () => {
    const h = await harness('generative', { claimed: true })
    for (const row of h.jobs.rows) Object.assign(row, { state: 'done', imagesCid: 'a'.repeat(59) })
    h.jobs.record.state = 'finalizing'
    await handle(startMessage(), h.deps)
    expect(h.queue.sent).toEqual([metadataMessage()])
  })

  it('gives the messages it sends the job retries, not the retries of the message it handled', async () => {
    const h = await harness('generative', { claimed: true, job: { retries: 2 } })
    await handle(startMessage(1), h.deps)
    expect(h.queue.sent.map((message) => message.retries)).toEqual([2, 2, 2])
  })

  it('delivered twice, leaves the same state and sends the same batches again', async () => {
    const h = await harness()
    await handle(startMessage(), h.deps)
    await handle(startMessage(), h.deps)
    expect(h.jobs.record.state).toBe('rendering')
    expect(h.jobs.rows).toHaveLength(3)
    expect(h.paymentReads).toHaveLength(1)
    expect(h.queue.sent).toHaveLength(6)
  })

  it('logs and returns for a job that is not ready to render', async () => {
    const h = await harness('generative', { job: { state: 'payment_due' } })
    await handle(startMessage(), h.deps)
    expect(h.lines).toContain('refused:JOB_NOT_READY')
    expect(h.jobs.failures).toEqual([])
    expect(h.queue.sent).toEqual([])
  })

  it('throws when the queue refuses the batch messages, so the start is redelivered', async () => {
    const h = await harness()
    h.deps.queue = { ...h.queue, send: () => Promise.reject(new Error('queue down')) }
    await expect(handle(startMessage(), h.deps)).rejects.toThrow('queue down')
    expect(h.jobs.record.state).toBe('rendering')
  })
})
```

- [ ] **Step 3: Run the test to see it fail**

Run: `pnpm --filter @cobweb/worker exec vitest run src/steps.test.ts`
Expected: FAIL. `Error: Cannot find module './steps.ts'` (the test wiring imports it too).

- [ ] **Step 4: Write the start step**

Create `services/worker/src/steps.ts`:

```ts
/**
 * The three steps, the dead-letter handler and the sweep
 * (docs/specs/2026-10-12-render-worker.md, section 7). Messages may arrive more than once and in
 * any order; every step is idempotent against the database, so a repeat does no harm.
 */
import type { RenderMessage, RenderQueue } from '@cobweb/shared/render-queue'
import type { Log } from './log.ts'
import { isJobRefusal, isRenderProblem } from './ports.ts'
import type { Chain, Jobs, Pinner, Store } from './ports.ts'

export type Deps = { jobs: Jobs; store: Store; pinner: Pinner; chain: Chain; queue: RenderQueue; log: Log }

export const PAYMENT_MISMATCH = 'The payment could not be verified on chain.'
export const RESULT_DIFFERS = 'The render gave a different result than the one already recorded.'

/** A message's batch index, or null for a job-level message. */
const indexOf = (message: RenderMessage): number | null => (message.step === 'batch' ? message.index : null)

/**
 * Records a final failure with the message's `retries`, so a report older than the creator's latest
 * retry is ignored by the database. A refusal of the report itself (the job moved on, the batch is
 * already done) is logged and not thrown: a message that cannot fail its job must not loop.
 */
async function report(
  deps: Deps,
  message: RenderMessage,
  index: number | null,
  code: string,
  text: string,
): Promise<void> {
  try {
    await deps.jobs.fail(message.jobId, index, code, text, true, message.retries)
    deps.log('job failed', { jobId: message.jobId, step: message.step, index, code })
  } catch (error) {
    if (!isJobRefusal(error)) throw error
    deps.log('failure report refused', {
      jobId: message.jobId,
      step: message.step,
      code,
      refusal: error.code,
    })
  }
}

async function start(message: RenderMessage, deps: Deps): Promise<void> {
  const { jobs, queue, log } = deps
  const job = await jobs.job(message.jobId)
  if (!job || job.state === 'done' || job.state === 'failed') {
    log('start skipped', { jobId: message.jobId, state: job?.state ?? 'missing' })
    return
  }
  // The payment is checked before the claim and fails closed. A waived job and a free one have
  // nothing to check. A read error throws out of here: the message is redelivered.
  if (job.state === 'paid' && job.quoteTotalWei > 0n) {
    const paid = await deps.chain.jobPayment(job)
    if (paid < job.quoteTotalWei) {
      await report(deps, message, null, 'payment-mismatch', PAYMENT_MISMATCH)
      return
    }
  }
  const claimed = await jobs.claim(job.id)
  const batches = await jobs.batches(job.id)
  const open = batches.filter((batch) => batch.state !== 'done')
  if (open.length > 0) {
    await queue.send(
      open.map((batch) => ({ jobId: job.id, step: 'batch', index: batch.index, retries: claimed.retries })),
    )
  } else if (batches.length > 0) {
    await queue.send([{ jobId: job.id, step: 'metadata', retries: claimed.retries }])
  }
  log('start done', { jobId: job.id, state: claimed.state, open: open.length, batches: batches.length })
}

/**
 * Handles one message. Returns normally when the message is done or needs no work, and throws when
 * it should be redelivered. A `RenderProblem` (bad art) fails the job at once, since a rerun cannot
 * fix it; a refusal from the database is the job having moved on; anything else is transient.
 */
export async function handle(message: RenderMessage, deps: Deps): Promise<void> {
  try {
    if (message.step === 'start') await start(message, deps)
    else throw new Error(`The ${message.step} step is not built yet.`)
  } catch (error) {
    if (isRenderProblem(error)) {
      await report(deps, message, indexOf(message), error.code, error.message)
      return
    }
    if (!isJobRefusal(error)) throw error
    // The output was not the same twice. The batch named is already done under another CID and the
    // database refuses a failure that names a done batch, so this is recorded on the job.
    if (error.code === 'BATCH_RESULT_DIFFERS' || error.code === 'JOB_RESULT_DIFFERS') {
      await report(deps, message, null, 'cid-mismatch', RESULT_DIFFERS)
      return
    }
    deps.log('refused', {
      jobId: message.jobId,
      step: message.step,
      index: indexOf(message),
      refusal: error.code,
    })
  }
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `pnpm --filter @cobweb/worker test`
Expected: PASS, 4 files, 52 tests (12 of them in `steps.test.ts`).

- [ ] **Step 6: Format, run the root checks and commit**

Run: `pnpm exec prettier --write services/worker/src`

Run at the repo root: `pnpm typecheck && pnpm lint && pnpm test`
Expected: every Turborepo task succeeds.

```bash
git add services/worker/src/steps.ts \
  services/worker/src/steps.test.ts \
  services/worker/src/testing/fake-jobs.ts \
  services/worker/src/testing/harness.ts
git commit -m "Add the start step with the payment check and the claim" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bcHX4HZG5YGWhxjGuiWos"
```

---

### Task 5: The batch step and the failure mapping

**Files:**

- Modify: `services/worker/src/steps.ts`
- Modify: `services/worker/src/steps.test.ts`

**Interfaces:**

- Consumes: `renderSpec`, `tokenSlice` (Task 3); `renderBatch`, `renderPlaceholder`, `PackedDirectory` from `@cobweb/render`; everything Task 4 produced.
- Produces: `const CID_MISMATCH = 'The pinning service returned a different CID.'`; `handle` now handles `batch` messages. Two private helpers later tasks reuse inside `steps.ts`: `pinned(deps, message, packed): Promise<boolean>` and `report(deps, message, index, code, text): Promise<void>` (Task 4).

The step is spec section 7, "batch". `batchStart` answering with a batch already `done` skips straight to the count check. The metadata message is sent whenever the done count equals `batches_total`, whether or not this call made the flip. A placeholder job's batch is its image directory (decision 11).

- [ ] **Step 1: Write the failing tests**

In `services/worker/src/steps.test.ts`, replace the import block at the top with:

```ts
import { RenderProblem } from '@cobweb/render'
import { describe, expect, it } from 'vitest'
import { flatPng } from './doubles/draw.ts'
import { wrongCidPinner } from './doubles/pinners.ts'
import { JobRefusal } from './ports.ts'
import { CID_MISMATCH, handle, PAYMENT_MISMATCH, RESULT_DIFFERS } from './steps.ts'
import { layerKey } from './testing/fixtures.ts'
import { batchMessage, harness, metadataMessage, startMessage } from './testing/harness.ts'
```

Add this line after the imports:

```ts
const CID = /^[a-z2-7]{59}$/
```

Append these two blocks at the end of the file:

```ts
describe('batch', () => {
  it('renders, pins and records the batch', async () => {
    const h = await harness('generative', { claimed: true })
    await handle(batchMessage(1), h.deps)
    const row = h.jobs.rows[1]!
    expect(row.state).toBe('done')
    expect(row.imagesCid).toMatch(CID)
    expect(h.pins).toEqual([row.imagesCid])
    expect(h.jobs.calls).toContain('tokens:1')
    expect(h.jobs.record.batchesDone).toBe(1)
    expect(h.queue.sent).toEqual([])
  })

  it('sends metadata after the last batch', async () => {
    const h = await harness('generative', { claimed: true })
    for (const index of [0, 1, 2]) await handle(batchMessage(index), h.deps)
    expect(h.jobs.record.state).toBe('finalizing')
    expect(h.queue.sent).toEqual([metadataMessage()])
  })

  it('renders the same batch to the same CID twice', async () => {
    const first = await harness('generative', { claimed: true })
    const second = await harness('generative', { claimed: true })
    await handle(batchMessage(0), first.deps)
    await handle(batchMessage(0), second.deps)
    expect(first.jobs.rows[0]!.imagesCid).toBe(second.jobs.rows[0]!.imagesCid)
  })

  it('skips the work for a batch already done and still sends metadata when the count is full', async () => {
    const h = await harness('generative', { claimed: true })
    for (const index of [0, 1, 2]) await handle(batchMessage(index), h.deps)
    const pinsBefore = h.pins.length
    await handle(batchMessage(2), h.deps)
    expect(h.pins).toHaveLength(pinsBefore)
    expect(h.lines).toContain('batch already done')
    expect(h.queue.sent).toEqual([metadataMessage(), metadataMessage()])
  })

  it('sends metadata when the count is full although the database did not report the last batch', async () => {
    const h = await harness('generative', { claimed: true })
    for (const index of [0, 1]) await handle(batchMessage(index), h.deps)
    // The flip happened in another delivery whose send was lost: this call sees a full count, last false.
    h.jobs.batchDone = async () => ({ batchesDone: 3, last: false })
    await handle(batchMessage(2), h.deps)
    expect(h.queue.sent).toEqual([metadataMessage()])
  })

  it('returns when the job moved on', async () => {
    const h = await harness('generative', { claimed: true })
    h.jobs.record.state = 'failed'
    await handle(batchMessage(0), h.deps)
    expect(h.lines).toContain('refused:JOB_NOT_RENDERING')
    expect(h.pins).toEqual([])
    expect(h.jobs.failures).toEqual([])
  })

  it('returns for a batch index the job does not have', async () => {
    const h = await harness('generative', { claimed: true })
    await handle(batchMessage(9), h.deps)
    expect(h.lines).toContain('refused:NO_SUCH_BATCH')
    expect(h.jobs.failures).toEqual([])
  })

  it('fails the job with cid-mismatch when the pinning service answers with another CID', async () => {
    const h = await harness('generative', { claimed: true })
    h.deps.pinner = wrongCidPinner()
    await handle(batchMessage(0, 0), h.deps)
    expect(h.jobs.failures).toEqual([
      { index: 0, code: 'cid-mismatch', message: CID_MISMATCH, final: true, retries: 0 },
    ])
    expect(h.jobs.rows[0]!.state).toBe('failed')
    expect(h.jobs.calls).not.toContain('batchDone:0')
  })

  it('fails the job at once for a render problem, with its code and sentence', async () => {
    const h = await harness('generative', { claimed: true })
    const small = await flatPng({ r: 1, g: 2, b: 3, alpha: 1 }, 32)
    h.deps.store = {
      ...h.store,
      load: async (ref) => (ref.key === layerKey('wide') ? small : h.store.load(ref)),
    }
    await handle(batchMessage(0), h.deps)
    expect(h.jobs.failures).toHaveLength(1)
    expect(h.jobs.failures[0]).toMatchObject({ index: 0, code: 'layer-size', final: true, retries: 0 })
    expect(h.jobs.failures[0]!.message).toContain('is 32 by 32 pixels; the canvas is 64 by 64.')
    expect(h.jobs.record.state).toBe('failed')
  })

  it('fails the job for a layer image missing from storage', async () => {
    const h = await harness('generative', { claimed: true })
    h.deps.store = { ...h.store, load: () => Promise.reject(new Error('NoSuchKey')) }
    await handle(batchMessage(0), h.deps)
    expect(h.jobs.failures[0]).toMatchObject({ index: 0, code: 'missing-image', final: true })
  })

  it('throws on a pinning error, so the message is redelivered, and records nothing', async () => {
    const h = await harness('generative', { claimed: true })
    h.deps.pinner = { pin: () => Promise.reject(new Error('pin down')) }
    await expect(handle(batchMessage(0), h.deps)).rejects.toThrow('pin down')
    expect(h.jobs.failures).toEqual([])
    expect(h.jobs.rows[0]!.state).toBe('running')
  })

  it('passes the retries of the message to the failure report', async () => {
    const h = await harness('generative', { claimed: true, job: { retries: 3 } })
    h.deps.pinner = wrongCidPinner()
    await handle(batchMessage(0, 2), h.deps)
    expect(h.jobs.failures[0]).toMatchObject({ retries: 2 })
    // Older than the latest retry: the fake, like the database, changes nothing.
    expect(h.jobs.record.state).toBe('rendering')
  })

  it('records a batch result that differs from the one stored as a job-level cid-mismatch', async () => {
    const h = await harness('generative', { claimed: true })
    h.jobs.batchDone = () => Promise.reject(new JobRefusal('BATCH_RESULT_DIFFERS'))
    await handle(batchMessage(0), h.deps)
    expect(h.jobs.failures).toEqual([
      { index: null, code: 'cid-mismatch', message: RESULT_DIFFERS, final: true, retries: 0 },
    ])
  })

  it('passes 1/1 files through and records the batch', async () => {
    const h = await harness('assets', { claimed: true })
    await handle(batchMessage(0), h.deps)
    await handle(batchMessage(1), h.deps)
    expect(h.jobs.rows.map((row) => row.state)).toEqual(['done', 'done'])
    expect(h.jobs.record.state).toBe('finalizing')
  })

  it('renders a placeholder job batch as the placeholder image directory', async () => {
    const h = await harness('placeholder', { claimed: true })
    await handle(batchMessage(0), h.deps)
    expect(h.jobs.rows[0]!.imagesCid).toMatch(CID)
    expect(h.jobs.calls).not.toContain('tokens:0')
    expect(h.queue.sent).toEqual([metadataMessage()])
  })
})
```

```ts
describe('failures', () => {
  it('throws anything that is not a render problem or a refusal', async () => {
    const h = await harness('generative', { claimed: true })
    h.jobs.batchStart = () => Promise.reject(new Error('connection reset'))
    await expect(handle(batchMessage(0), h.deps)).rejects.toThrow('connection reset')
    expect(h.jobs.failures).toEqual([])
  })

  it('throws when the failure report itself fails for another reason', async () => {
    const h = await harness('generative', { claimed: true })
    h.deps.pinner = wrongCidPinner()
    h.jobs.fail = () => Promise.reject(new Error('connection reset'))
    await expect(handle(batchMessage(0), h.deps)).rejects.toThrow('connection reset')
  })

  it('does not treat an error that only looks like a render problem by its message as one', async () => {
    const h = await harness('generative', { claimed: true })
    h.jobs.renderData = () => Promise.reject(new Error('layer-size'))
    await expect(handle(batchMessage(0), h.deps)).rejects.toThrow('layer-size')
  })

  it('fails the job for a render problem thrown by the mapper', async () => {
    const h = await harness('generative', { claimed: true })
    h.jobs.tokens = () =>
      Promise.reject(new RenderProblem('batch-range', 'Batch 0 has 1 token stored; 2 are expected.'))
    await handle(batchMessage(0), h.deps)
    expect(h.jobs.failures[0]).toMatchObject({ index: 0, code: 'batch-range', final: true })
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @cobweb/worker exec vitest run src/steps.test.ts`
Expected: FAIL, "19 failed | 12 passed". The new tests fail with `The batch step is not built yet.`

- [ ] **Step 3: Write the batch step**

In `services/worker/src/steps.ts`, replace the import block with:

```ts
import { renderBatch, renderPlaceholder } from '@cobweb/render'
import type { PackedDirectory } from '@cobweb/render'
import type { RenderMessage, RenderQueue } from '@cobweb/shared/render-queue'
import type { Log } from './log.ts'
import { isJobRefusal, isRenderProblem } from './ports.ts'
import type { Chain, Jobs, Pinner, Store } from './ports.ts'
import { renderSpec, tokenSlice } from './spec.ts'
```

Add this constant after `PAYMENT_MISMATCH`:

```ts
export const CID_MISMATCH = 'The pinning service returned a different CID.'
```

Add this function after `report`:

```ts
/** Pins a CAR and compares CIDs. False (after recording `cid-mismatch`) when the service answers with another. */
async function pinned(deps: Deps, message: RenderMessage, packed: PackedDirectory): Promise<boolean> {
  const cid = await deps.pinner.pin(packed.car, packed.cid)
  if (cid === packed.cid) return true
  await report(deps, message, indexOf(message), 'cid-mismatch', CID_MISMATCH)
  return false
}
```

Add this function after `start`:

```ts
async function batch(message: RenderMessage & { step: 'batch' }, deps: Deps): Promise<void> {
  const { jobs, store, queue, log } = deps
  const { jobId, index } = message
  const started = await jobs.batchStart(jobId, index)
  const job = await jobs.job(jobId)
  if (!job) return
  let done = job.batchesDone
  if (started.state !== 'done') {
    const data = await jobs.renderData(job)
    const spec = renderSpec(data)
    // A placeholder job's one batch is the placeholder's image directory; its metadata is the metadata step's.
    const rendered =
      spec.kind === 'placeholder'
        ? (await renderPlaceholder(spec, store.load)).image
        : await renderBatch(spec, index, tokenSlice(data, await jobs.tokens(job, index)), store.load)
    if (!(await pinned(deps, message, rendered))) return
    done = (await jobs.batchDone(jobId, index, rendered.cid, rendered.size)).batchesDone
    log('batch done', { jobId, index, cid: rendered.cid, size: rendered.size, done })
  } else {
    log('batch already done', { jobId, index })
  }
  // Sent whenever the count is full, whether or not this call made the flip, so a crash between the
  // flip and the send cannot strand the job. The metadata step ignores a job that is not finalizing.
  if (done === job.batchesTotal) await queue.send([{ jobId, step: 'metadata', retries: job.retries }])
}
```

Replace `handle` with:

```ts
/**
 * Handles one message. Returns normally when the message is done or needs no work, and throws when
 * it should be redelivered. A `RenderProblem` (bad art) fails the job at once, since a rerun cannot
 * fix it; a refusal from the database is the job having moved on; anything else is transient.
 */
export async function handle(message: RenderMessage, deps: Deps): Promise<void> {
  try {
    if (message.step === 'start') await start(message, deps)
    else if (message.step === 'batch') await batch(message, deps)
    else throw new Error(`The ${message.step} step is not built yet.`)
  } catch (error) {
    if (isRenderProblem(error)) {
      await report(deps, message, indexOf(message), error.code, error.message)
      return
    }
    if (!isJobRefusal(error)) throw error
    // The output was not the same twice. The batch named is already done under another CID and the
    // database refuses a failure that names a done batch, so this is recorded on the job.
    if (error.code === 'BATCH_RESULT_DIFFERS' || error.code === 'JOB_RESULT_DIFFERS') {
      await report(deps, message, null, 'cid-mismatch', RESULT_DIFFERS)
      return
    }
    deps.log('refused', {
      jobId: message.jobId,
      step: message.step,
      index: indexOf(message),
      refusal: error.code,
    })
  }
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm --filter @cobweb/worker test`
Expected: PASS, 4 files, 71 tests.

- [ ] **Step 5: Format, run the root checks and commit**

Run: `pnpm exec prettier --write services/worker/src`

Run at the repo root: `pnpm typecheck && pnpm lint && pnpm test`
Expected: every Turborepo task succeeds.

```bash
git add services/worker/src/steps.ts \
  services/worker/src/steps.test.ts
git commit -m "Add the batch step and map failures to job state" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bcHX4HZG5YGWhxjGuiWos"
```

---

### Task 6: The metadata step and the collage

**Files:**

- Modify: `services/worker/src/steps.ts`
- Modify: `services/worker/src/steps.test.ts`

**Interfaces:**

- Consumes: `renderMetadataSet`, `previewCollage`, `renderBatch`, `renderPlaceholder` from `@cobweb/render`; `errorSummary` (Task 2); `pinned`, `report` and the rest of `steps.ts` (Tasks 4 and 5).
- Produces: `handle` now handles `metadata` messages. No new export.

The step is spec section 7, "metadata". Decisions 9 (how every token is read and what it costs in memory), 10 (the collage) and 11 (the placeholder job) apply. A job that is not `finalizing` returns at once. The collage is written to `<collection id>/collage/<job id>.png` through `store.putCollage`; any failure in it is logged as `collage skipped` and the job finishes with `collageKey` null. A single asset job has no collage.

- [ ] **Step 1: Write the failing tests**

In `services/worker/src/steps.test.ts`, replace the import block at the top with:

```ts
import { RenderProblem } from '@cobweb/render'
import { describe, expect, it } from 'vitest'
import { flatPng, sizeOf } from './doubles/draw.ts'
import { wrongCidPinner } from './doubles/pinners.ts'
import { JobRefusal } from './ports.ts'
import { CID_MISMATCH, handle, PAYMENT_MISMATCH, RESULT_DIFFERS } from './steps.ts'
import { COLLECTION_ID, JOB_ID, layerKey } from './testing/fixtures.ts'
import { batchMessage, harness, metadataMessage, startMessage } from './testing/harness.ts'
```

Append this helper and this block at the end of the file:

```ts
async function finalizing(project: 'generative' | 'assets' | 'placeholder' = 'generative') {
  const h = await harness(project, { claimed: true })
  for (const row of [...h.jobs.rows]) await handle(batchMessage(row.index), h.deps)
  expect(h.jobs.record.state).toBe('finalizing')
  return h
}
```

```ts
describe('metadata', () => {
  it('pins the metadata set, writes the collage and finishes the job', async () => {
    const h = await finalizing()
    await handle(metadataMessage(), h.deps)
    const key = `${COLLECTION_ID}/collage/${JOB_ID}.png`
    expect(h.jobs.record.state).toBe('done')
    expect(h.jobs.finished).toEqual({
      metadataCid: h.pins.at(-1),
      baseUri: `ipfs://${h.pins.at(-1)}/`,
      placeholderImageCid: null,
      collageKey: key,
    })
    expect(h.jobs.finished?.metadataCid).toMatch(CID)
    // Batch 0 holds tokens 1 and 2 at this batch size: one row of four 256 pixel cells.
    expect(await sizeOf(h.store.collages.get(key)!)).toEqual({ width: 1024, height: 256 })
  })

  it('shows at most the first 16 tokens of batch 0 in the collage', async () => {
    const key = `${COLLECTION_ID}/collage/${JOB_ID}.png`
    const five = await harness('generative', { claimed: true, job: { batchSize: 100, batchesTotal: 1 } })
    await handle(batchMessage(0), five.deps)
    await handle(metadataMessage(), five.deps)
    expect(await sizeOf(five.store.collages.get(key)!)).toEqual({ width: 1024, height: 512 })
    const twenty = await harness('generative', {
      claimed: true,
      job: { tokenCount: 20, batchSize: 100, batchesTotal: 1 },
    })
    await handle(batchMessage(0), twenty.deps)
    await handle(metadataMessage(), twenty.deps)
    expect(twenty.jobs.record.state).toBe('done')
    expect(await sizeOf(twenty.store.collages.get(key)!)).toEqual({ width: 1024, height: 1024 })
  })

  it('reads every batch of tokens for the set', async () => {
    const h = await finalizing()
    h.jobs.calls.length = 0
    await handle(metadataMessage(), h.deps)
    expect(h.jobs.calls.filter((call) => call.startsWith('tokens:')).sort()).toEqual([
      'tokens:0',
      'tokens:0',
      'tokens:1',
      'tokens:2',
    ])
  })

  it('returns for a job that is not finalizing', async () => {
    for (const state of ['rendering', 'done', 'failed'] as const) {
      const h = await harness('generative', { claimed: true })
      h.jobs.record.state = state
      await handle(metadataMessage(), h.deps)
      expect(h.lines).toEqual(['metadata skipped'])
      expect(h.jobs.calls).toEqual(['job'])
    }
  })

  it('delivered twice, finishes once and leaves the same result', async () => {
    const h = await finalizing()
    await handle(metadataMessage(), h.deps)
    const finished = h.jobs.finished
    const pins = h.pins.length
    await handle(metadataMessage(), h.deps)
    expect(h.jobs.finished).toBe(finished)
    expect(h.pins).toHaveLength(pins)
  })

  it('renders the same metadata CID for the same project', async () => {
    const first = await finalizing()
    const second = await finalizing()
    await handle(metadataMessage(), first.deps)
    await handle(metadataMessage(), second.deps)
    expect(first.jobs.finished?.metadataCid).toBe(second.jobs.finished?.metadataCid)
  })

  it('fails the job at job level when the pinning service answers with another CID', async () => {
    const h = await finalizing()
    h.deps.pinner = wrongCidPinner()
    await handle(metadataMessage(1), h.deps)
    expect(h.jobs.failures).toEqual([
      { index: null, code: 'cid-mismatch', message: CID_MISMATCH, final: true, retries: 1 },
    ])
    expect(h.jobs.finished).toBeNull()
  })

  it('fails the job at job level for a render problem', async () => {
    const h = await finalizing()
    h.jobs.rows[1]!.imagesCid = null
    await handle(metadataMessage(), h.deps)
    expect(h.jobs.failures[0]).toMatchObject({ index: null, code: 'missing-batch', final: true })
  })

  it('finishes without a collage when the collage cannot be written', async () => {
    const h = await finalizing()
    h.deps.store = { ...h.store, putCollage: () => Promise.reject(new Error('bucket down')) }
    await handle(metadataMessage(), h.deps)
    expect(h.jobs.record.state).toBe('done')
    expect(h.jobs.finished?.collageKey).toBeNull()
    expect(h.lines).toContain('collage skipped')
    expect(h.jobs.failures).toEqual([])
  })

  it('finishes without a collage when its images cannot be composited', async () => {
    const h = await finalizing()
    h.deps.store = { ...h.store, load: () => Promise.reject(new Error('NoSuchKey')) }
    await handle(metadataMessage(), h.deps)
    expect(h.jobs.record.state).toBe('done')
    expect(h.jobs.finished?.collageKey).toBeNull()
  })

  it('throws on a pinning error and leaves the job finalizing', async () => {
    const h = await finalizing()
    h.deps.pinner = { pin: () => Promise.reject(new Error('pin down')) }
    await expect(handle(metadataMessage(), h.deps)).rejects.toThrow('pin down')
    expect(h.jobs.record.state).toBe('finalizing')
  })

  it('logs and returns when the database says batches are still rendering', async () => {
    const h = await finalizing()
    h.jobs.finish = () => Promise.reject(new JobRefusal('BATCHES_STILL_RENDERING'))
    await handle(metadataMessage(), h.deps)
    expect(h.lines).toContain('refused:BATCHES_STILL_RENDERING')
    expect(h.jobs.failures).toEqual([])
  })

  it('records a different finish result as a cid-mismatch and does not loop when that is refused too', async () => {
    const h = await finalizing()
    h.jobs.finish = () => Promise.reject(new JobRefusal('JOB_RESULT_DIFFERS'))
    h.jobs.fail = async (_job, index, code, message, final, retries) => {
      h.jobs.failures.push({ index, code, message, final, retries })
      throw new JobRefusal('JOB_NOT_RENDERING')
    }
    await handle(metadataMessage(), h.deps)
    expect(h.jobs.failures).toEqual([
      { index: null, code: 'cid-mismatch', message: RESULT_DIFFERS, final: true, retries: 0 },
    ])
    expect(h.lines).toContain('failure report refused:JOB_NOT_RENDERING')
  })

  it('makes a collage of the still files of a 1/1 job and leaves the GIF out', async () => {
    const h = await finalizing('assets')
    await handle(metadataMessage(), h.deps)
    const key = `${COLLECTION_ID}/collage/${JOB_ID}.png`
    expect(h.jobs.finished?.collageKey).toBe(key)
    expect(h.jobs.finished?.baseUri).toBe(`ipfs://${h.jobs.finished?.metadataCid}/`)
    // Batch 0 holds tokens 1 and 2, both PNG: one row of four cells.
    expect(await sizeOf(h.store.collages.get(key)!)).toEqual({ width: 1024, height: 256 })
  })

  it('writes one shared file and no collage for a single asset, reading only batch 0', async () => {
    const h = await harness('assets', { claimed: true })
    for (const row of [...h.jobs.rows]) await handle(batchMessage(row.index), h.deps)
    const data = await h.jobs.renderData(h.jobs.record)
    data.collection.projectType = 'single_asset'
    h.jobs.renderData = async (job) => ({ ...data, job })
    h.jobs.calls.length = 0
    await handle(metadataMessage(), h.deps)
    expect(h.jobs.finished?.baseUri).toBe(`ipfs://${h.jobs.finished?.metadataCid}/metadata.json`)
    expect(h.jobs.finished?.collageKey).toBeNull()
    expect(h.jobs.calls.filter((call) => call.startsWith('tokens:'))).toEqual(['tokens:0'])
    expect(h.store.collages.size).toBe(0)
  })

  it('finishes a placeholder job with both CIDs and a slash-less base URI', async () => {
    const h = await finalizing('placeholder')
    await handle(metadataMessage(), h.deps)
    const finished = h.jobs.finished!
    expect(finished.placeholderImageCid).toBe(h.jobs.rows[0]!.imagesCid)
    expect(finished.baseUri).toBe(`ipfs://${finished.metadataCid}/metadata.json`)
    expect(finished.collageKey).toBeNull()
    expect(h.pins.slice(-2)).toEqual([finished.placeholderImageCid, finished.metadataCid])
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @cobweb/worker exec vitest run src/steps.test.ts`
Expected: FAIL, "16 failed | 31 passed". The new tests fail with `The metadata step is not built yet.`

- [ ] **Step 3: Write the metadata step**

In `services/worker/src/steps.ts`, replace the import block with:

```ts
import { previewCollage, renderBatch, renderMetadataSet, renderPlaceholder } from '@cobweb/render'
import type { AssetSpec, AssetToken, GenerativeSpec, GenerativeToken, PackedDirectory } from '@cobweb/render'
import type { RenderMessage, RenderQueue } from '@cobweb/shared/render-queue'
import { errorSummary } from './log.ts'
import type { Log } from './log.ts'
import { isJobRefusal, isRenderProblem } from './ports.ts'
import type { Chain, JobRecord, Jobs, Pinner, RenderData, Store } from './ports.ts'
import { renderSpec, tokenSlice } from './spec.ts'
```

Add these after the sentence constants:

```ts
/** How many tokens the collage shows, and so how many of batch 0 are composited again for it. */
const COLLAGE_TOKENS = 16
/** Batches whose tokens are read at once in the metadata step. */
const TOKEN_READS_IN_FLIGHT = 8

type Token = GenerativeToken | AssetToken
```

Add these four functions after `batch`:

```ts
async function mapLimit<T, R>(items: T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const lane = async () => {
    while (next < items.length) {
      const at = next++
      results[at] = await run(items[at] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane))
  return results
}
```

```ts
/**
 * Every token of the job, read a batch at a time and kept only as the render library's token. Trait
 * and collection ids are shared between tokens, so the same text is kept once: a 100,000 token
 * generative job holds about 20 MB of tokens here, and the metadata set built from them (about 70 MB
 * of JSON, held about three times over while it is packed) peaks near 300 MB.
 */
async function allTokens(job: JobRecord, data: RenderData, jobs: Jobs, indexes: number[]): Promise<Token[]> {
  const seen = new Map<string, string>()
  const shared = (text: string): string => {
    const known = seen.get(text)
    if (known !== undefined) return known
    seen.set(text, text)
    return text
  }
  const slices = await mapLimit(indexes, TOKEN_READS_IN_FLIGHT, async (index) =>
    tokenSlice(data, await jobs.tokens(job, index)).map((token) =>
      'dna' in token
        ? { ...token, collectionId: shared(token.collectionId), dna: token.dna.map(shared) }
        : token,
    ),
  )
  return slices.flat()
}
```

```ts
/**
 * The preview collage: the first 16 tokens of batch 0 composited again (the worker keeps no batch
 * output), stills only, written to the render bucket. Any failure is logged and skipped; a collage
 * never fails a job.
 */
async function collage(
  job: JobRecord,
  data: RenderData,
  spec: GenerativeSpec | AssetSpec,
  deps: Deps,
): Promise<string | null> {
  try {
    const first = tokenSlice(data, await deps.jobs.tokens(job, 0))
      .sort((a, b) => a.id - b.id)
      .slice(0, COLLAGE_TOKENS)
    // With a batch size of 16, ids 1 to 16 are exactly batch 0, whatever the job's own batch size.
    const rendered = await renderBatch({ ...spec, batchSize: COLLAGE_TOKENS }, 0, first, deps.store.load)
    const stills = rendered.files
      .filter((file) => /\.(png|jpg|webp)$/.test(file.name))
      .sort((a, b) => Number.parseInt(a.name, 10) - Number.parseInt(b.name, 10))
      .map((file) => file.bytes)
    if (stills.length === 0) return null
    const key = `${job.collectionId}/collage/${job.id}.png`
    await deps.store.putCollage(key, await previewCollage(stills))
    return key
  } catch (error) {
    deps.log('collage skipped', { jobId: job.id, error: errorSummary(error) })
    return null
  }
}
```

```ts
async function metadata(message: RenderMessage, deps: Deps): Promise<void> {
  const { jobs, store, log } = deps
  const job = await jobs.job(message.jobId)
  if (!job || job.state !== 'finalizing') {
    log('metadata skipped', { jobId: message.jobId, state: job?.state ?? 'missing' })
    return
  }
  const data = await jobs.renderData(job)
  const spec = renderSpec(data)
  if (spec.kind === 'placeholder') {
    const { image, metadata: set } = await renderPlaceholder(spec, store.load)
    if (!(await pinned(deps, message, image)) || !(await pinned(deps, message, set))) return
    await jobs.finish(job.id, {
      metadataCid: set.cid,
      baseUri: set.baseUri,
      placeholderImageCid: image.cid,
      collageKey: null,
    })
    log('job done', { jobId: job.id, metadataCid: set.cid })
    return
  }
  const cids = new Map<number, string>()
  for (const row of await jobs.batches(job.id)) if (row.imagesCid) cids.set(row.index, row.imagesCid)
  // A single asset writes one file for token 1, so only batch 0 is read.
  const indexes = spec.kind === 'single_asset' ? [0] : Array.from({ length: job.batchesTotal }, (_, i) => i)
  const set = await renderMetadataSet(spec, await allTokens(job, data, jobs, indexes), cids)
  if (!(await pinned(deps, message, set))) return
  const collageKey = spec.kind === 'single_asset' ? null : await collage(job, data, spec, deps)
  await jobs.finish(job.id, {
    metadataCid: set.cid,
    baseUri: set.baseUri,
    placeholderImageCid: null,
    collageKey,
  })
  log('job done', { jobId: job.id, metadataCid: set.cid, collage: collageKey !== null })
}
```

Replace `handle` with:

```ts
/**
 * Handles one message. Returns normally when the message is done or needs no work, and throws when
 * it should be redelivered. A `RenderProblem` (bad art) fails the job at once, since a rerun cannot
 * fix it; a refusal from the database is the job having moved on; anything else is transient.
 */
export async function handle(message: RenderMessage, deps: Deps): Promise<void> {
  try {
    if (message.step === 'start') await start(message, deps)
    else if (message.step === 'batch') await batch(message, deps)
    else await metadata(message, deps)
  } catch (error) {
    if (isRenderProblem(error)) {
      await report(deps, message, indexOf(message), error.code, error.message)
      return
    }
    if (!isJobRefusal(error)) throw error
    // The output was not the same twice. The batch named is already done under another CID and the
    // database refuses a failure that names a done batch, so this is recorded on the job.
    if (error.code === 'BATCH_RESULT_DIFFERS' || error.code === 'JOB_RESULT_DIFFERS') {
      await report(deps, message, null, 'cid-mismatch', RESULT_DIFFERS)
      return
    }
    deps.log('refused', {
      jobId: message.jobId,
      step: message.step,
      index: indexOf(message),
      refusal: error.code,
    })
  }
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm --filter @cobweb/worker test`
Expected: PASS, 4 files, 87 tests.

- [ ] **Step 5: Format, run the root checks and commit**

Run: `pnpm exec prettier --write services/worker/src`

Run at the repo root: `pnpm typecheck && pnpm lint && pnpm test`
Expected: every Turborepo task succeeds.

```bash
git add services/worker/src/steps.ts \
  services/worker/src/steps.test.ts
git commit -m "Add the metadata step with the preview collage" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bcHX4HZG5YGWhxjGuiWos"
```

---

### Task 7: The dead-letter handler, the sweep and the local runner

**Files:**

- Modify: `services/worker/src/steps.ts`
- Modify: `services/worker/src/steps.test.ts`
- Create: `services/worker/src/local.ts`
- Create: `services/worker/src/local.test.ts`

**Interfaces:**

- Consumes: `enqueueRender` (Task 1); `report`, `indexOf`, `handle`, `Deps` (Tasks 4 to 6); `MemoryQueue` and the doubles (Task 2); `errorSummary` (Task 2).
- Produces, from `steps.ts`:
  - `const DEAD_LETTER = 'The render did not finish after several tries.'`, `const SWEEP_MINUTES = 15`
  - `async function handleDead(message: RenderMessage, deps: Deps): Promise<void>`
  - `async function sweep(deps: Deps): Promise<number>` (the number of jobs re-enqueued)
- Produces, from `local.ts` (the `@cobweb/worker/local` entry):
  - `type LocalRun = { handled: number; thrown: number; dead: number }`
  - `async function runLocal(deps: Deps & { queue: MemoryQueue }, options?: { maxReceives?: number; maxDeliveries?: number }): Promise<LocalRun>`
  - re-exports: `flatPng`, `sizeOf`, `memoryQueue`, `memoryStore`, `carRoot`, `failingPinner`, `folderPinner`, `WRONG_CID`, `wrongCidPinner` and their types

Spec section 7, "Dead letter" and "Sweep", and section 8, the local runner. Decision 15 covers the queue's API. `runLocal` delivers until the queue is empty, then hands dead-letter messages to `handleDead` one at a time. `maxDeliveries` (100,000) stops a loop in a step from hanging a script.

- [ ] **Step 1: Write the failing tests**

In `services/worker/src/steps.test.ts`, replace the import block at the top with:

```ts
import { RenderProblem } from '@cobweb/render'
import { describe, expect, it } from 'vitest'
import { flatPng, sizeOf } from './doubles/draw.ts'
import { wrongCidPinner } from './doubles/pinners.ts'
import { JobRefusal } from './ports.ts'
import {
  CID_MISMATCH,
  DEAD_LETTER,
  handle,
  handleDead,
  PAYMENT_MISMATCH,
  RESULT_DIFFERS,
  sweep,
} from './steps.ts'
import { COLLECTION_ID, JOB_ID, layerKey } from './testing/fixtures.ts'
import { batchMessage, harness, metadataMessage, startMessage } from './testing/harness.ts'
```

Append these two blocks at the end of the file:

```ts
describe('handleDead', () => {
  it('fails the job with dead-letter, naming the batch of a batch message', async () => {
    const h = await harness('generative', { claimed: true })
    await handleDead(batchMessage(1, 0), h.deps)
    expect(h.jobs.failures).toEqual([
      { index: 1, code: 'dead-letter', message: DEAD_LETTER, final: true, retries: 0 },
    ])
    expect(h.jobs.record.state).toBe('failed')
    expect(h.jobs.record.errorCode).toBe('dead-letter')
  })

  it('fails the job at job level for a start and a metadata message', async () => {
    for (const message of [startMessage(2), metadataMessage(2)]) {
      const h = await harness('generative', { claimed: true, job: { retries: 2 } })
      await handleDead(message, h.deps)
      expect(h.jobs.failures).toEqual([
        { index: null, code: 'dead-letter', message: DEAD_LETTER, final: true, retries: 2 },
      ])
    }
  })

  it('acknowledges a dead message whose job cannot be failed', async () => {
    const h = await harness('generative', { job: { state: 'done' } })
    await handleDead(startMessage(), h.deps)
    expect(h.lines).toContain('failure report refused:JOB_NOT_RENDERING')
    const done = await harness('generative', { claimed: true })
    await handle(batchMessage(0), done.deps)
    await handleDead(batchMessage(0), done.deps)
    expect(done.lines).toContain('failure report refused:BATCH_ALREADY_DONE')
    expect(done.jobs.record.state).toBe('rendering')
  })

  it('throws when the database cannot be reached, so the dead message is kept', async () => {
    const h = await harness('generative', { claimed: true })
    h.jobs.fail = () => Promise.reject(new Error('connection reset'))
    await expect(handleDead(startMessage(), h.deps)).rejects.toThrow('connection reset')
  })
})
```

```ts
describe('sweep', () => {
  it('throws when the queue is down, so the next run tries again', async () => {
    const h = await harness()
    h.jobs.stuckJobs = [{ id: JOB_ID, retries: 0 }]
    h.deps.queue = { ...h.queue, send: () => Promise.reject(new Error('queue down')) }
    await expect(sweep(h.deps)).rejects.toThrow('queue down')
  })

  it('sends a start message for each stuck job, with its retries', async () => {
    const h = await harness()
    const other = '11111111-2222-4333-8444-555555555555'
    h.jobs.stuckJobs = [
      { id: JOB_ID, retries: 1 },
      { id: other, retries: 0 },
    ]
    expect(await sweep(h.deps)).toBe(2)
    expect(h.queue.sent).toEqual([startMessage(1), { jobId: other, step: 'start', retries: 0 }])
  })

  it('asks for jobs untouched for 15 minutes and sends nothing when there are none', async () => {
    const h = await harness()
    const asked: number[] = []
    h.jobs.stuck = async (minutes) => {
      asked.push(minutes)
      return []
    }
    expect(await sweep(h.deps)).toBe(0)
    expect(asked).toEqual([15])
    expect(h.queue.sent).toEqual([])
  })
})
```

Create `services/worker/src/local.test.ts`:

```ts
import { enqueueRender } from '@cobweb/shared/render-queue'
import { describe, expect, it } from 'vitest'
import { memoryQueue } from './doubles/memory-queue.ts'
import { failingPinner } from './doubles/pinners.ts'
import { runLocal } from './local.ts'
import { JOB_ID } from './testing/fixtures.ts'
import { harness } from './testing/harness.ts'

const job = { id: JOB_ID, retries: 0 }

describe('runLocal', () => {
  it('takes a paid job to done: start, three batches, metadata', async () => {
    const h = await harness()
    await enqueueRender(h.queue, job)
    expect(await runLocal(h.deps)).toEqual({ handled: 5, thrown: 0, dead: 0 })
    expect(h.jobs.record.state).toBe('done')
    expect(h.jobs.rows.every((row) => row.state === 'done')).toBe(true)
    expect(h.queue.size()).toBe(0)
  })

  it('ends in the same state when every message is delivered twice', async () => {
    const once = await harness()
    await enqueueRender(once.queue, job)
    await runLocal(once.deps)

    const twice = await harness()
    const queue = memoryQueue({ copies: 2 })
    const deps = { ...twice.deps, queue }
    await enqueueRender(queue, job)
    const run = await runLocal(deps)
    expect(run.thrown).toBe(0)
    expect(run.handled).toBeGreaterThan(5)
    expect(twice.jobs.record.state).toBe('done')
    expect(twice.jobs.finished).toEqual(once.jobs.finished)
    expect(twice.jobs.rows.map((row) => row.imagesCid)).toEqual(once.jobs.rows.map((row) => row.imagesCid))
    expect(twice.jobs.failures).toEqual([])
  })

  it('redelivers a batch whose pin failed once, and the job finishes', async () => {
    const h = await harness()
    const pinner = failingPinner(h.deps.pinner, { nth: 1, times: 1 })
    await enqueueRender(h.queue, job)
    const run = await runLocal({ ...h.deps, pinner })
    expect(run).toEqual({ handled: 5, thrown: 1, dead: 0 })
    expect(pinner.failures).toBe(1)
    expect(h.jobs.record.state).toBe('done')
    expect(h.jobs.rows[1]!.attempts).toBe(2)
  })

  it('dead-letters a batch that fails three times and fails the job, keeping the finished batches', async () => {
    const h = await harness()
    const pinner = failingPinner(h.deps.pinner, { nth: 1, times: Infinity })
    await enqueueRender(h.queue, job)
    const run = await runLocal({ ...h.deps, pinner })
    expect(run).toEqual({ handled: 3, thrown: 3, dead: 1 })
    expect(h.jobs.record.state).toBe('failed')
    expect(h.jobs.record.errorCode).toBe('dead-letter')
    expect(h.jobs.failures).toMatchObject([{ index: 1, code: 'dead-letter', final: true }])
    expect(h.jobs.rows.map((row) => row.state)).toEqual(['done', 'failed', 'done'])
  })

  it('after a retry, renders only the batch that failed', async () => {
    const h = await harness()
    await enqueueRender(h.queue, job)
    await runLocal({ ...h.deps, pinner: failingPinner(h.deps.pinner, { nth: 1, times: Infinity }) })
    // What art_render_retry does: failed batches back to queued, the job rendering, retries raised.
    h.jobs.rows[1]!.state = 'queued'
    h.jobs.record.state = 'rendering'
    h.jobs.record.retries = 1
    h.jobs.calls.length = 0
    await enqueueRender(h.queue, { id: JOB_ID, retries: 1 })
    await runLocal(h.deps)
    expect(h.jobs.record.state).toBe('done')
    expect(h.jobs.calls.filter((call) => call.startsWith('batchDone'))).toEqual(['batchDone:1'])
    expect(h.queue.sent.at(-1)).toEqual({ jobId: JOB_ID, step: 'metadata', retries: 1 })
  })

  it('honours maxReceives', async () => {
    const h = await harness()
    const pinner = failingPinner(h.deps.pinner, { nth: 0, times: Infinity })
    await enqueueRender(h.queue, job)
    const run = await runLocal({ ...h.deps, pinner }, { maxReceives: 1 })
    expect(run.thrown).toBe(1)
    expect(run.dead).toBe(1)
  })

  it('stops with an error instead of looping for ever', async () => {
    const h = await harness()
    await enqueueRender(h.queue, job)
    await expect(runLocal(h.deps, { maxDeliveries: 2 })).rejects.toThrow(
      'The local runner stopped after 2 deliveries.',
    )
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @cobweb/worker test`
Expected: FAIL. `steps.test.ts`: "7 failed | 47 passed" with `handleDead is not a function` and `sweep is not a function`. `local.test.ts`: `Cannot find module './local.ts'`.

- [ ] **Step 3: Write the dead-letter handler and the sweep**

In `services/worker/src/steps.ts`, replace the import block with:

```ts
import { previewCollage, renderBatch, renderMetadataSet, renderPlaceholder } from '@cobweb/render'
import type { AssetSpec, AssetToken, GenerativeSpec, GenerativeToken, PackedDirectory } from '@cobweb/render'
import { enqueueRender } from '@cobweb/shared/render-queue'
import type { RenderMessage, RenderQueue } from '@cobweb/shared/render-queue'
import { errorSummary } from './log.ts'
import type { Log } from './log.ts'
import { isJobRefusal, isRenderProblem } from './ports.ts'
import type { Chain, JobRecord, Jobs, Pinner, RenderData, Store } from './ports.ts'
import { renderSpec, tokenSlice } from './spec.ts'
```

Add this constant after `RESULT_DIFFERS`:

```ts
export const DEAD_LETTER = 'The render did not finish after several tries.'
```

Append at the end of the file:

```ts
/** Fails the job of a message that was received three times without success. */
export async function handleDead(message: RenderMessage, deps: Deps): Promise<void> {
  await report(deps, message, indexOf(message), 'dead-letter', DEAD_LETTER)
}
```

```ts
/** How long a job may sit with nothing touched before the sweep sends its start message again. */
export const SWEEP_MINUTES = 15
```

```ts
/**
 * Re-enqueues jobs left `rendering` or `finalizing` with nothing touched for 15 minutes. The start
 * step then re-sends the open batches, or the metadata step for a finalizing job.
 */
export async function sweep(deps: Deps): Promise<number> {
  const jobs = await deps.jobs.stuck(SWEEP_MINUTES)
  for (const job of jobs) await enqueueRender(deps.queue, job)
  deps.log('sweep', { requeued: jobs.length })
  return jobs.length
}
```

After these edits the file is, in order: the header comment, the imports, `Deps`, the four sentence constants, `COLLAGE_TOKENS`, `TOKEN_READS_IN_FLIGHT`, `Token`, `indexOf`, `report`, `pinned`, `start`, `batch`, `mapLimit`, `allTokens`, `collage`, `metadata`, `handle`, `handleDead`, `SWEEP_MINUTES`, `sweep`.

- [ ] **Step 4: Write the local runner**

Create `services/worker/src/local.ts`:

```ts
/**
 * The local runner (docs/specs/2026-10-12-render-worker.md, section 8): drains an in-memory queue
 * the way SQS and the Lambdas would, so the whole pipeline runs without AWS. Also the entry
 * (`@cobweb/worker/local`) that hands the doubles to scripts.
 */
import type { MemoryQueue } from './doubles/memory-queue.ts'
import { errorSummary } from './log.ts'
import { handle, handleDead } from './steps.ts'
import type { Deps } from './steps.ts'

export { flatPng, sizeOf } from './doubles/draw.ts'
export { memoryQueue } from './doubles/memory-queue.ts'
export type { MemoryQueue, QueueEntry } from './doubles/memory-queue.ts'
export { memoryStore } from './doubles/memory-store.ts'
export type { MemoryStore } from './doubles/memory-store.ts'
export { carRoot, failingPinner, folderPinner, WRONG_CID, wrongCidPinner } from './doubles/pinners.ts'
export type { FailingPinner, FolderPinner } from './doubles/pinners.ts'

export type LocalRun = {
  /** Deliveries that returned normally. */
  handled: number
  /** Deliveries that threw and were put back or dead-lettered. */
  thrown: number
  /** Messages handed to the dead-letter handler. */
  dead: number
}

/**
 * Delivers messages until the queue is empty: a delivery that throws is redelivered, and after
 * `maxReceives` receives (3, the queue's redrive count) the message goes to `handleDead`. Stops with
 * an error after `maxDeliveries`, so a loop in a step cannot hang a script.
 */
export async function runLocal(
  deps: Deps & { queue: MemoryQueue },
  options: { maxReceives?: number; maxDeliveries?: number } = {},
): Promise<LocalRun> {
  const maxReceives = options.maxReceives ?? 3
  const maxDeliveries = options.maxDeliveries ?? 100_000
  const run: LocalRun = { handled: 0, thrown: 0, dead: 0 }
  for (;;) {
    const entry = deps.queue.take()
    if (!entry) {
      const message = deps.queue.takeDead()
      if (!message) return run
      await handleDead(message, deps)
      run.dead += 1
      continue
    }
    if (run.handled + run.thrown >= maxDeliveries)
      throw new Error(`The local runner stopped after ${maxDeliveries} deliveries.`)
    try {
      await handle(entry.message, deps)
      run.handled += 1
    } catch (error) {
      run.thrown += 1
      deps.log('delivery failed', {
        jobId: entry.message.jobId,
        step: entry.message.step,
        receives: entry.receives,
        error: errorSummary(error),
      })
      deps.queue.release(entry, maxReceives)
    }
  }
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `pnpm --filter @cobweb/worker test`
Expected: PASS, 5 files, 101 tests.

- [ ] **Step 6: Format, run the root checks and commit**

Run: `pnpm exec prettier --write services/worker/src`

Run at the repo root: `pnpm typecheck && pnpm lint && pnpm test`
Expected: every Turborepo task succeeds.

```bash
git add services/worker/src/steps.ts \
  services/worker/src/steps.test.ts \
  services/worker/src/local.ts \
  services/worker/src/local.test.ts
git commit -m "Add the dead-letter handler, the sweep and the local runner" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bcHX4HZG5YGWhxjGuiWos"
```

---

### Task 8: The Supabase, storage and chain adapters

**Files:**

- Create: `services/worker/src/testing/stub-client.ts`
- Create: `services/worker/src/adapters/supabase-jobs.ts`
- Create: `services/worker/src/adapters/supabase-jobs.test.ts`
- Create: `services/worker/src/testing/stub-aws.ts`
- Create: `services/worker/src/adapters/s3-store.ts`
- Create: `services/worker/src/adapters/s3-store.test.ts`
- Create: `services/worker/src/adapters/viem-chain.ts`
- Create: `services/worker/src/adapters/viem-chain.test.ts`

**Interfaces:**

- Consumes: the ports and `refusalOf` (Task 2); the fixtures (Task 3); the generated `Database` type in `apps/web/src/lib/database.types.ts` (type only); `chainById`, `factoryAbi`, `factoryAddress`, `Env` from `@cobweb/shared`; `GetObjectCommand`, `PutObjectCommand` from `@aws-sdk/client-s3`.
- Produces:
  - `type WorkerClient = SupabaseClient<Database>`, `supabaseJobs(client: WorkerClient, options?: { now?: () => number }): Jobs`, and for tests `JOB_COLUMNS`, `BATCH_COLUMNS`, `PAGE_SIZE`, `STUCK_LIMIT`, `toJobRecord(row: JobRow)`, `toBatchRecord(row: BatchRow)`, `readPages(what, page)`, `parseTokenList(value)`
  - `type S3Like = Pick<S3Client, 'send'>`, `type Bucket = { client: S3Like; bucket: string }`, `COLLAGE_KEY`, `s3Store(art: Bucket, render: Bucket): Store`
  - `type PaymentReader`, `viemChain(env: Env, readerFor?: (chainId: number) => PaymentReader): Chain`
  - for tests: `stubClient(answer)`, `opOf(call, name)`, `stubAws<Client = S3Like>(answer?)`, `bytes(text)`

Decisions 5, 6, 7, 8, 13, 14 and 16 apply. The exact reads of `supabaseJobs`:

- the job: `render_jobs`, the columns of `JOB_COLUMNS` (never `token_list`), `eq('id', jobId)`, `maybeSingle()`
- the render data, read once per job per instance: the `collections` row (`id, name, description, project_type, canvas_width, token_name, token_description, show_blank_traits`); for a generative job `art_collections` (`id, position`), `layers` (`id, art_collection_id, name, display_name, position`), `traits` (`id, layer_id, name, blank, in_metadata, upload_id, position`) and the `uploads` of kind `layer_image` (`id, storage_key`), each by `collection_id`, ordered by `id` and read a page of 1,000 at a time; for a 1/1 or single asset job the `uploads` of kind `asset`; for a placeholder job only its one upload
- a batch's tokens: for a generative job, `tokens` (`token_id, art_collection_id, dna, description`) with `eq('collection_id', ...)`, `gte('token_id', first)`, `lte('token_id', last)`, ordered by `token_id`, paged; for the others, `render_jobs.token_list` read once per job and sliced by id. `first` is `index * batch_size + 1` and `last` is `min((index + 1) * batch_size, token_count)`. A batch is at most 1,000 tokens by constraint, so one batch is one page.
- the batches: `render_batches` (`index, state, attempts, first_token_id, last_token_id, images_cid`) by `job_id`, ordered by `index`, paged
- `stuck`: decision 13

A database error with code `23514` and one of the nine sentences is thrown as a `JobRefusal`; any other error is thrown as a plain `Error` naming the call, which the steps treat as transient.

- [ ] **Step 1: Write the stand-in for the Supabase client**

Create `services/worker/src/testing/stub-client.ts`:

```ts
/**
 * A stand-in for the Supabase client in adapter tests: it records every query (the table or
 * function, and each builder call in order) and answers with whatever the test's `answer` returns.
 * Not exported from the package.
 */
import type { WorkerClient } from '../adapters/supabase-jobs.ts'

export type StubCall = {
  table?: string
  fn?: string
  args?: Record<string, unknown>
  /** Builder calls in order: `['eq', 'id', '...']`, `['range', 0, 999]`. */
  ops: unknown[][]
}

export type StubAnswer = { data?: unknown; error?: { code?: string; message: string } | null }

export function stubClient(answer: (call: StubCall) => StubAnswer): {
  client: WorkerClient
  calls: StubCall[]
} {
  const calls: StubCall[] = []
  const builder = (call: StubCall): unknown => {
    const proxy: unknown = new Proxy(
      {},
      {
        get(_target, name) {
          if (name === 'then')
            return (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
              Promise.resolve()
                .then(() => ({ data: null, error: null, ...answer(call) }))
                .then(resolve, reject)
          return (...args: unknown[]) => {
            call.ops.push([String(name), ...args])
            return proxy
          }
        },
      },
    )
    return proxy
  }
  const track = (call: StubCall) => {
    calls.push(call)
    return builder(call)
  }
  const client = {
    from: (table: string) => track({ table, ops: [] }),
    rpc: (fn: string, args: Record<string, unknown>) => track({ fn, args, ops: [] }),
  }
  return { client: client as unknown as WorkerClient, calls }
}

/** The arguments of the first builder call with this name, or undefined. */
export function opOf(call: StubCall, name: string): unknown[] | undefined {
  return call.ops.find((op) => op[0] === name)?.slice(1)
}
```

(This file imports the `WorkerClient` type from the adapter written in Step 4. Type imports are erased, so it loads on its own; the type check passes once Step 4 is done.)

- [ ] **Step 2: Write the failing test for the jobs adapter**

Create `services/worker/src/adapters/supabase-jobs.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { JOB_ID, COLLECTION_ID, jobRecord } from '../testing/fixtures.ts'
import { opOf, stubClient } from '../testing/stub-client.ts'
import type { StubAnswer, StubCall } from '../testing/stub-client.ts'
import {
  JOB_COLUMNS,
  parseTokenList,
  readPages,
  supabaseJobs,
  toBatchRecord,
  toJobRecord,
} from './supabase-jobs.ts'
import type { JobRow } from './supabase-jobs.ts'

const row = (over: Partial<JobRow> = {}): JobRow => ({
  id: JOB_ID,
  collection_id: COLLECTION_ID,
  kind: 'real',
  state: 'paid',
  token_count: 5,
  batch_size: 2,
  batches_total: 3,
  batches_done: 0,
  quote_total_wei: '125',
  quote_chain_id: 31337,
  quote_payer: '0x00000000000000000000000000000000000000aa',
  quote_factory: '0x00000000000000000000000000000000000000fa',
  onchain_job_id: `0x3f0c2f5e8a514c0e9d7b0d0f5a3b9c11${'0'.repeat(32)}`,
  placeholder_upload_id: null,
  retries: 0,
  error_code: null,
  ...over,
})

const collectionRow = (projectType: string) => ({
  id: COLLECTION_ID,
  name: 'Night Owls',
  description: 'Owls that stay up.',
  project_type: projectType,
  canvas_width: 64,
  token_name: null,
  token_description: '',
  show_blank_traits: false,
})

/** Answers a paged read once and then with an empty page. */
const firstPage = (call: StubCall, rows: unknown[]): StubAnswer => ({
  data: (opOf(call, 'range')?.[0] ?? 0) === 0 ? rows : [],
})

const caught = async (
  run: () => Promise<unknown>,
): Promise<{ name?: string; code?: string; message?: string }> => {
  try {
    await run()
  } catch (error) {
    return error as { name?: string; code?: string; message?: string }
  }
  return {}
}

describe('row mappers', () => {
  it('reads the quote as a bigint, exactly', () => {
    const record = toJobRecord(row({ quote_total_wei: '123456789012345678901234567890' }))
    expect(record.quoteTotalWei).toBe(123456789012345678901234567890n)
    expect(record).toMatchObject(jobRecord({ quoteTotalWei: 123456789012345678901234567890n }))
  })

  it('maps a batch row', () => {
    expect(
      toBatchRecord({
        index: 2,
        state: 'done',
        attempts: 1,
        first_token_id: 5,
        last_token_id: 5,
        images_cid: 'x',
      }),
    ).toEqual({ index: 2, state: 'done', attempts: 1, firstTokenId: 5, lastTokenId: 5, imagesCid: 'x' })
  })

  it('reads the wei column as text in the job select', () => {
    expect(JOB_COLUMNS).toContain('quote_total_wei::text')
    expect(JOB_COLUMNS).not.toContain('token_list')
  })
})

describe('readPages', () => {
  it('reads until an empty page, moving by the rows it got', async () => {
    const ranges: number[][] = []
    const pages = [[1, 2, 3], [4], []]
    const rows = await readPages('Reading', async (from, to) => {
      ranges.push([from, to])
      return { data: pages[ranges.length - 1] ?? [], error: null }
    })
    expect(rows).toEqual([1, 2, 3, 4])
    expect(ranges).toEqual([
      [0, 999],
      [3, 1002],
      [4, 1003],
    ])
  })

  it('throws on an error', async () => {
    await expect(
      readPages('Reading the traits', async () => ({
        data: null,
        error: { code: '57014', message: 'timeout' },
      })),
    ).rejects.toThrow('Reading the traits failed: 57014 timeout')
  })
})

describe('parseTokenList', () => {
  it('keeps well-formed entries and refuses anything else as a render problem', () => {
    expect(parseTokenList([{ id: 1, uploadId: 'u', attributes: [] }])).toEqual([
      { id: 1, uploadId: 'u', attributes: [] },
    ])
    for (const bad of [null, 'text', [{ id: '1', uploadId: 'u' }], [{ id: 1 }], [null]])
      expect(() => parseTokenList(bad)).toThrow('The file list stored for this job cannot be read.')
  })
})

describe('supabaseJobs: reads', () => {
  it('returns the job, or null when there is none', async () => {
    const found = stubClient(() => ({ data: row() }))
    expect(await supabaseJobs(found.client).job(JOB_ID)).toEqual(jobRecord())
    expect(found.calls[0]).toMatchObject({ table: 'render_jobs' })
    expect(opOf(found.calls[0]!, 'select')).toEqual([JOB_COLUMNS])
    expect(opOf(found.calls[0]!, 'eq')).toEqual(['id', JOB_ID])
    const missing = stubClient(() => ({ data: null }))
    expect(await supabaseJobs(missing.client).job(JOB_ID)).toBeNull()
  })

  it('reads the batches in index order, a page at a time', async () => {
    const { client, calls } = stubClient((call) =>
      firstPage(call, [
        { index: 0, state: 'done', attempts: 1, first_token_id: 1, last_token_id: 2, images_cid: 'c' },
      ]),
    )
    expect(await supabaseJobs(client).batches(JOB_ID)).toEqual([
      { index: 0, state: 'done', attempts: 1, firstTokenId: 1, lastTokenId: 2, imagesCid: 'c' },
    ])
    expect(calls).toHaveLength(2)
    expect(opOf(calls[0]!, 'order')).toEqual(['index'])
  })

  it('reads one batch of tokens by its id range and nothing wider', async () => {
    const { client, calls } = stubClient((call) => {
      if (call.table === 'collections') return { data: collectionRow('generative') }
      if (call.table === 'tokens')
        return firstPage(call, [
          { token_id: 3, art_collection_id: 'a', dna: ['t1'], description: null },
          { token_id: 4, art_collection_id: 'a', dna: ['t2'], description: 'Four' },
        ])
      return firstPage(call, [])
    })
    const rows = await supabaseJobs(client).tokens(jobRecord(), 1)
    expect(rows).toEqual({
      kind: 'generative',
      rows: [
        { tokenId: 3, artCollectionId: 'a', dna: ['t1'], description: null },
        { tokenId: 4, artCollectionId: 'a', dna: ['t2'], description: 'Four' },
      ],
    })
    const read = calls.find((call) => call.table === 'tokens')!
    expect(opOf(read, 'gte')).toEqual(['token_id', 3])
    expect(opOf(read, 'lte')).toEqual(['token_id', 4])
    expect(opOf(read, 'eq')).toEqual(['collection_id', COLLECTION_ID])
  })

  it('reads the short last batch by the token count', async () => {
    const { client, calls } = stubClient((call) => {
      if (call.table === 'collections') return { data: collectionRow('generative') }
      if (call.table === 'tokens')
        return firstPage(call, [{ token_id: 5, art_collection_id: 'a', dna: [], description: null }])
      return firstPage(call, [])
    })
    await supabaseJobs(client).tokens(jobRecord(), 2)
    const read = calls.find((call) => call.table === 'tokens')!
    expect([opOf(read, 'gte'), opOf(read, 'lte')]).toEqual([
      ['token_id', 5],
      ['token_id', 5],
    ])
  })

  it('refuses a batch with fewer tokens stored than its range as a render problem', async () => {
    const { client } = stubClient((call) => {
      if (call.table === 'collections') return { data: collectionRow('generative') }
      if (call.table === 'tokens')
        return firstPage(call, [{ token_id: 1, art_collection_id: 'a', dna: [], description: null }])
      return firstPage(call, [])
    })
    expect(await caught(() => supabaseJobs(client).tokens(jobRecord(), 0))).toMatchObject({
      name: 'RenderProblem',
      code: 'batch-range',
      message: 'Batch 0 has 1 of its 2 tokens stored.',
    })
  })

  it('refuses a batch index past the end of the job', async () => {
    const { client, calls } = stubClient(() => ({ data: null }))
    expect(await caught(() => supabaseJobs(client).tokens(jobRecord(), 3))).toMatchObject({
      name: 'RenderProblem',
      code: 'batch-range',
    })
    expect(calls).toEqual([])
  })

  it('slices the stored file list for a 1/1 job and reads the list once for the job', async () => {
    const list = [3, 1, 2].map((id) => ({ id, uploadId: `u${id}`, attributes: [] }))
    const { client, calls } = stubClient((call) => {
      if (call.table === 'collections') return { data: collectionRow('one_of_one') }
      if (call.table === 'render_jobs') return { data: { token_list: list } }
      return firstPage(call, [])
    })
    const jobs = supabaseJobs(client)
    const record = jobRecord({ tokenCount: 3, batchesTotal: 2 })
    expect(await jobs.tokens(record, 0)).toEqual({
      kind: 'assets',
      rows: [
        { id: 1, uploadId: 'u1', attributes: [] },
        { id: 2, uploadId: 'u2', attributes: [] },
      ],
    })
    expect(await jobs.tokens(record, 1)).toEqual({
      kind: 'assets',
      rows: [{ id: 3, uploadId: 'u3', attributes: [] }],
    })
    expect(calls.filter((call) => call.table === 'render_jobs')).toHaveLength(1)
    expect(calls.filter((call) => call.table === 'collections')).toHaveLength(1)
  })

  it('reads the art rows of a generative job a page at a time and keeps them for the job', async () => {
    const { client, calls } = stubClient((call) => {
      if (call.table === 'collections') return { data: collectionRow('generative') }
      if (call.table === 'art_collections') return firstPage(call, [{ id: 'a', position: 0 }])
      if (call.table === 'layers')
        return firstPage(call, [
          { id: 'l', art_collection_id: 'a', name: 'Eyes', display_name: null, position: 0 },
        ])
      if (call.table === 'traits')
        return firstPage(call, [
          {
            id: 't',
            layer_id: 'l',
            name: 'Wide',
            blank: false,
            in_metadata: true,
            upload_id: 'u',
            position: 0,
          },
        ])
      return firstPage(call, [{ id: 'u', storage_key: 'k.png' }])
    })
    const jobs = supabaseJobs(client)
    const data = await jobs.renderData(jobRecord())
    expect(data).toMatchObject({
      collection: { projectType: 'generative', canvasWidth: 64, tokenName: null },
      artCollections: [{ id: 'a', position: 0 }],
      layers: [{ id: 'l', artCollectionId: 'a', name: 'Eyes', displayName: null, position: 0 }],
      traits: [
        { id: 't', layerId: 'l', name: 'Wide', blank: false, inMetadata: true, uploadId: 'u', position: 0 },
      ],
      uploads: [{ id: 'u', storageKey: 'k.png' }],
    })
    const uploads = calls.find((call) => call.table === 'uploads')!
    expect(uploads.ops).toContainEqual(['eq', 'kind', 'layer_image'])
    const before = calls.length
    const again = await jobs.renderData(jobRecord({ state: 'rendering' }))
    expect(calls).toHaveLength(before)
    expect(again.job.state).toBe('rendering')
  })

  it('reads only the placeholder file for a placeholder job', async () => {
    const { client, calls } = stubClient((call) =>
      call.table === 'collections'
        ? { data: collectionRow('generative') }
        : { data: { id: 'u-hidden', storage_key: 'c/placeholders/h.gif' } },
    )
    const data = await supabaseJobs(client).renderData(
      jobRecord({ kind: 'placeholder', placeholderUploadId: 'u-hidden' }),
    )
    expect(data.uploads).toEqual([{ id: 'u-hidden', storageKey: 'c/placeholders/h.gif' }])
    expect(calls.map((call) => call.table)).toEqual(['collections', 'uploads'])
  })
})

describe('supabaseJobs: the job state functions', () => {
  const afterRpc = (call: StubCall, answer: StubAnswer = {}): StubAnswer =>
    call.fn ? answer : { data: row({ state: 'rendering' }) }

  it('claims and then reads the job again, so the quote keeps every wei', async () => {
    const { client, calls } = stubClient((call) => afterRpc(call))
    const record = await supabaseJobs(client).claim(JOB_ID)
    expect(record.state).toBe('rendering')
    expect(calls[0]).toMatchObject({ fn: 'art_claim_render', args: { p_job_id: JOB_ID } })
    expect(calls[1]).toMatchObject({ table: 'render_jobs' })
  })

  it('throws a refusal for a check violation with a known sentence', async () => {
    const { client } = stubClient(() => ({
      error: { code: '23514', message: 'This job is not ready to render.' },
    }))
    expect(await caught(() => supabaseJobs(client).claim(JOB_ID))).toMatchObject({
      name: 'JobRefusal',
      code: 'JOB_NOT_READY',
    })
  })

  it('throws a plain error for anything else, so the message is redelivered', async () => {
    const { client } = stubClient(() => ({ error: { code: '57014', message: 'canceling statement' } }))
    const error = await caught(() => supabaseJobs(client).batchStart(JOB_ID, 0))
    expect(error.name).toBe('Error')
    expect(error.message).toBe('Starting the batch failed: 57014 canceling statement')
    const unknown = stubClient(() => ({ error: { code: '23514', message: 'violates check constraint "x"' } }))
    expect((await caught(() => supabaseJobs(unknown.client).batchStart(JOB_ID, 0))).name).toBe('Error')
  })

  it('starts a batch and maps the row', async () => {
    const { client, calls } = stubClient(() => ({
      data: {
        index: 1,
        state: 'running',
        attempts: 2,
        first_token_id: 3,
        last_token_id: 4,
        images_cid: null,
      },
    }))
    expect(await supabaseJobs(client).batchStart(JOB_ID, 1)).toMatchObject({
      index: 1,
      state: 'running',
      attempts: 2,
    })
    expect(calls[0]).toMatchObject({ fn: 'art_batch_start', args: { p_job_id: JOB_ID, p_index: 1 } })
  })

  it('records a batch and returns the count and the flip', async () => {
    const { client, calls } = stubClient(() => ({ data: [{ batches_done: 3, last: true }] }))
    expect(await supabaseJobs(client).batchDone(JOB_ID, 2, 'cid', 4096)).toEqual({
      batchesDone: 3,
      last: true,
    })
    expect(calls[0]?.args).toEqual({ p_job_id: JOB_ID, p_index: 2, p_images_cid: 'cid', p_images_size: 4096 })
  })

  it('passes a null index for a job-level failure, and the retries', async () => {
    const { client, calls } = stubClient((call) => afterRpc(call))
    await supabaseJobs(client).fail(JOB_ID, null, 'dead-letter', 'The render did not finish.', true, 2)
    expect(calls[0]).toMatchObject({
      fn: 'art_batch_failed',
      args: {
        p_job_id: JOB_ID,
        p_index: null,
        p_code: 'dead-letter',
        p_message: 'The render did not finish.',
        p_final: true,
        p_retries: 2,
      },
    })
    await supabaseJobs(client).fail(JOB_ID, 4, 'layer-size', 'Too small.', true, 0)
    expect(calls[2]?.args).toMatchObject({ p_index: 4, p_retries: 0 })
  })

  it('leaves the optional finish arguments out when they are null', async () => {
    const { client, calls } = stubClient((call) => afterRpc(call))
    const jobs = supabaseJobs(client)
    await jobs.finish(JOB_ID, {
      metadataCid: 'm',
      baseUri: 'ipfs://m/',
      placeholderImageCid: null,
      collageKey: null,
    })
    expect(calls[0]?.args).toEqual({ p_job_id: JOB_ID, p_metadata_cid: 'm', p_base_uri: 'ipfs://m/' })
    await jobs.finish(JOB_ID, {
      metadataCid: 'm',
      baseUri: 'ipfs://m/',
      placeholderImageCid: 'p',
      collageKey: 'k',
    })
    expect(calls[2]?.args).toEqual({
      p_job_id: JOB_ID,
      p_metadata_cid: 'm',
      p_base_uri: 'ipfs://m/',
      p_placeholder_image_cid: 'p',
      p_collage_key: 'k',
    })
  })
})

describe('supabaseJobs: stuck', () => {
  it('returns open jobs older than the cutoff whose batches are all older too', async () => {
    const quiet = '11111111-2222-4333-8444-555555555555'
    const { client, calls } = stubClient((call) => {
      if (call.table === 'render_jobs')
        return {
          data: [
            { id: JOB_ID, retries: 1 },
            { id: quiet, retries: 0 },
          ],
        }
      // The first job has a batch touched after the cutoff; the second has none.
      return { data: opOf(call, 'eq')?.[1] === JOB_ID ? [{ index: 0 }] : [] }
    })
    const now = Date.parse('2026-10-12T12:00:00.000Z')
    expect(await supabaseJobs(client, { now: () => now }).stuck(15)).toEqual([{ id: quiet, retries: 0 }])
    const jobsRead = calls[0]!
    expect(opOf(jobsRead, 'in')).toEqual(['state', ['rendering', 'finalizing']])
    expect(opOf(jobsRead, 'lt')).toEqual(['updated_at', '2026-10-12T11:45:00.000Z'])
    expect(opOf(jobsRead, 'limit')).toEqual([100])
    expect(opOf(calls[1]!, 'gte')).toEqual(['updated_at', '2026-10-12T11:45:00.000Z'])
    expect(opOf(calls[1]!, 'limit')).toEqual([1])
  })
})
```

- [ ] **Step 3: Run the test to see it fail**

Run: `pnpm --filter @cobweb/worker exec vitest run src/adapters/supabase-jobs.test.ts`
Expected: FAIL. `Error: Cannot find module './supabase-jobs.ts'`.

- [ ] **Step 4: Write the jobs adapter**

Create `services/worker/src/adapters/supabase-jobs.ts`:

```ts
/**
 * The `Jobs` port on Supabase (docs/specs/2026-10-12-render-worker.md, section 5): the only code in
 * the worker that talks to the database. It takes a service-role client built by the worker. Every
 * read is bounded: PostgREST returns at most 1,000 rows a request, so lists are read a page at a
 * time, tokens are read one batch at a time (a batch is at most 1,000 tokens by constraint), and the
 * 100,000 rows of `tokens` are never loaded by one call.
 */
import { RenderProblem } from '@cobweb/render'
import type { SupabaseClient } from '@supabase/supabase-js'
// A type-only import of the generated types: it is erased, so the worker never loads the web app.
import type { Database } from '../../../../apps/web/src/lib/database.types.ts'
import { refusalOf } from '../ports.ts'
import type { BatchRecord, JobRecord, Jobs, RenderData, RenderState, TokenRows } from '../ports.ts'

export type WorkerClient = SupabaseClient<Database>

/** The most rows PostgREST returns for one request (`max_rows` in supabase/config.toml). */
export const PAGE_SIZE = 1000
/** The most jobs one sweep looks at, oldest first. */
export const STUCK_LIMIT = 100

/** `quote_total_wei` is read as text: a numeric read as a JSON number loses wei above 2^53. */
export const JOB_COLUMNS =
  'id, collection_id, kind, state, token_count, batch_size, batches_total, batches_done, quote_total_wei::text, quote_chain_id, quote_payer, quote_factory, onchain_job_id, placeholder_upload_id, retries, error_code'

export const BATCH_COLUMNS = 'index, state, attempts, first_token_id, last_token_id, images_cid'

export type JobRow = {
  id: string
  collection_id: string
  kind: 'real' | 'placeholder'
  state: RenderState
  token_count: number
  batch_size: number
  batches_total: number
  batches_done: number
  quote_total_wei: string
  quote_chain_id: number | null
  quote_payer: string | null
  quote_factory: string | null
  onchain_job_id: string | null
  placeholder_upload_id: string | null
  retries: number
  error_code: string | null
}

export type BatchRow = {
  index: number
  state: BatchRecord['state']
  attempts: number
  first_token_id: number
  last_token_id: number
  images_cid: string | null
}

export function toJobRecord(row: JobRow): JobRecord {
  return {
    id: row.id,
    collectionId: row.collection_id,
    kind: row.kind,
    state: row.state,
    tokenCount: row.token_count,
    batchSize: row.batch_size,
    batchesTotal: row.batches_total,
    batchesDone: row.batches_done,
    quoteTotalWei: BigInt(row.quote_total_wei),
    quoteChainId: row.quote_chain_id,
    quotePayer: row.quote_payer,
    quoteFactory: row.quote_factory,
    onchainJobId: row.onchain_job_id ?? '',
    placeholderUploadId: row.placeholder_upload_id,
    retries: row.retries,
    errorCode: row.error_code,
  }
}

export function toBatchRecord(row: BatchRow): BatchRecord {
  return {
    index: row.index,
    state: row.state,
    attempts: row.attempts,
    firstTokenId: row.first_token_id,
    lastTokenId: row.last_token_id,
    imagesCid: row.images_cid,
  }
}

type DbError = { code?: string; message: string }
type Answer<T> = PromiseLike<{ data: T | null; error: DbError | null }>

/**
 * What to throw for a database error: the refusal when a job state function said no with a known
 * sentence, else an error naming the call. Database messages carry no secret.
 */
function failure(what: string, error: DbError): Error {
  return (
    refusalOf(error) ?? new Error(`${what} failed: ${error.code ?? 'no code'} ${error.message}`.slice(0, 300))
  )
}

/**
 * Reads every row of a query a page at a time. A short page is not the last one (the server may cap
 * a page below the size asked for); only an empty page ends the read.
 */
export async function readPages<T>(
  what: string,
  page: (from: number, to: number) => Answer<T[]>,
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ;) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1)
    if (error) throw failure(what, error)
    if (!data || data.length === 0) return rows
    rows.push(...data)
    from += data.length
  }
}

type ListEntry = { id: number; uploadId: string; attributes: unknown }

/** The stored 1/1 or single asset list, checked entry by entry. */
export function parseTokenList(value: unknown): ListEntry[] {
  const unreadable = () =>
    new RenderProblem('batch-range', 'The file list stored for this job cannot be read.')
  if (!Array.isArray(value)) throw unreadable()
  return value.map((entry: unknown) => {
    const { id, uploadId, attributes } = (entry ?? {}) as {
      id?: unknown
      uploadId?: unknown
      attributes?: unknown
    }
    if (typeof id !== 'number' || !Number.isInteger(id) || typeof uploadId !== 'string') throw unreadable()
    return { id, uploadId, attributes }
  })
}

export function supabaseJobs(client: WorkerClient, options: { now?: () => number } = {}): Jobs {
  const now = options.now ?? Date.now
  // Art is frozen while its job is open (the lock), and a list is frozen at lock, so one job's data
  // and list are read once and kept while the same container works through that job's batches.
  let dataCache: { jobId: string; data: RenderData } | null = null
  let listCache: { jobId: string; list: ListEntry[] } | null = null

  async function job(jobId: string): Promise<JobRecord | null> {
    const { data, error } = await client.from('render_jobs').select(JOB_COLUMNS).eq('id', jobId).maybeSingle()
    if (error) throw failure('Reading the job', error)
    return data ? toJobRecord(data as unknown as JobRow) : null
  }

  async function jobAfter(jobId: string): Promise<JobRecord> {
    const record = await job(jobId)
    if (!record) throw new Error('The job disappeared after it was written.')
    return record
  }

  async function renderData(record: JobRecord): Promise<RenderData> {
    if (dataCache?.jobId === record.id) return { ...dataCache.data, job: record }
    const collectionId = record.collectionId
    const found = await client
      .from('collections')
      .select(
        'id, name, description, project_type, canvas_width, token_name, token_description, show_blank_traits',
      )
      .eq('id', collectionId)
      .maybeSingle()
    if (found.error) throw failure('Reading the collection', found.error)
    if (!found.data) throw new Error('The job has no collection.')
    const collection: RenderData['collection'] = {
      id: found.data.id,
      name: found.data.name,
      description: found.data.description,
      projectType: found.data.project_type,
      canvasWidth: found.data.canvas_width,
      tokenName: found.data.token_name,
      tokenDescription: found.data.token_description,
      showBlankTraits: found.data.show_blank_traits,
    }
    const data: RenderData = {
      job: record,
      collection,
      artCollections: [],
      layers: [],
      traits: [],
      uploads: [],
    }

    if (record.kind === 'placeholder') {
      // A placeholder job needs its one file and nothing else; the art may not exist yet.
      if (record.placeholderUploadId) {
        const upload = await client
          .from('uploads')
          .select('id, storage_key')
          .eq('id', record.placeholderUploadId)
          .eq('collection_id', collectionId)
          .maybeSingle()
        if (upload.error) throw failure('Reading the placeholder', upload.error)
        if (upload.data) data.uploads = [{ id: upload.data.id, storageKey: upload.data.storage_key }]
      }
    } else {
      const generative = collection.projectType === 'generative'
      if (generative) {
        const arts = await readPages('Reading the art collections', (from, to) =>
          client
            .from('art_collections')
            .select('id, position')
            .eq('collection_id', collectionId)
            .order('id')
            .range(from, to),
        )
        data.artCollections = arts.map((row) => ({ id: row.id, position: row.position }))
        const layers = await readPages('Reading the layers', (from, to) =>
          client
            .from('layers')
            .select('id, art_collection_id, name, display_name, position')
            .eq('collection_id', collectionId)
            .order('id')
            .range(from, to),
        )
        data.layers = layers.map((row) => ({
          id: row.id,
          artCollectionId: row.art_collection_id,
          name: row.name,
          displayName: row.display_name,
          position: row.position,
        }))
        const traits = await readPages('Reading the traits', (from, to) =>
          client
            .from('traits')
            .select('id, layer_id, name, blank, in_metadata, upload_id, position')
            .eq('collection_id', collectionId)
            .order('id')
            .range(from, to),
        )
        data.traits = traits.map((row) => ({
          id: row.id,
          layerId: row.layer_id,
          name: row.name,
          blank: row.blank,
          inMetadata: row.in_metadata,
          uploadId: row.upload_id,
          position: row.position,
        }))
      }
      const uploads = await readPages('Reading the uploads', (from, to) =>
        client
          .from('uploads')
          .select('id, storage_key')
          .eq('collection_id', collectionId)
          .eq('kind', generative ? 'layer_image' : 'asset')
          .order('id')
          .range(from, to),
      )
      data.uploads = uploads.map((row) => ({ id: row.id, storageKey: row.storage_key }))
    }
    dataCache = { jobId: record.id, data }
    return data
  }

  async function tokenList(jobId: string): Promise<ListEntry[]> {
    if (listCache?.jobId === jobId) return listCache.list
    const { data, error } = await client
      .from('render_jobs')
      .select('token_list')
      .eq('id', jobId)
      .maybeSingle()
    if (error) throw failure('Reading the file list', error)
    const list = parseTokenList(data?.token_list)
    listCache = { jobId, list }
    return list
  }

  async function tokens(record: JobRecord, index: number): Promise<TokenRows> {
    const first = index * record.batchSize + 1
    const last = Math.min((index + 1) * record.batchSize, record.tokenCount)
    const expected = last - first + 1
    // A batch with fewer tokens than its range would render and pin a short directory without any
    // error, so the count is checked here, where the rows are read.
    const short = (stored: number) =>
      new RenderProblem(
        'batch-range',
        `Batch ${index} has ${stored} of its ${Math.max(expected, 0)} tokens stored.`,
        {
          detail: { batchNo: index },
        },
      )
    if (!Number.isInteger(index) || index < 0 || expected < 1) throw short(0)
    const data = await renderData(record)
    if (data.collection.projectType === 'generative') {
      const rows = await readPages('Reading the tokens', (from, to) =>
        client
          .from('tokens')
          .select('token_id, art_collection_id, dna, description')
          .eq('collection_id', record.collectionId)
          .gte('token_id', first)
          .lte('token_id', last)
          .order('token_id')
          .range(from, to),
      )
      if (rows.length !== expected) throw short(rows.length)
      return {
        kind: 'generative',
        rows: rows.map((row) => ({
          tokenId: row.token_id,
          artCollectionId: row.art_collection_id,
          dna: row.dna,
          description: row.description,
        })),
      }
    }
    const rows = (await tokenList(record.id))
      .filter((entry) => entry.id >= first && entry.id <= last)
      .sort((a, b) => a.id - b.id)
    if (rows.length !== expected) throw short(rows.length)
    return { kind: 'assets', rows }
  }

  return {
    job,
    renderData,
    tokens,

    async batches(jobId) {
      const rows = await readPages('Reading the batches', (from, to) =>
        client
          .from('render_batches')
          .select(BATCH_COLUMNS)
          .eq('job_id', jobId)
          .order('index')
          .range(from, to),
      )
      return rows.map(toBatchRecord)
    },

    async claim(jobId) {
      const { error } = await client.rpc('art_claim_render', { p_job_id: jobId })
      if (error) throw failure('Claiming the job', error)
      return jobAfter(jobId)
    },

    async batchStart(jobId, index) {
      const { data, error } = await client.rpc('art_batch_start', { p_job_id: jobId, p_index: index })
      if (error) throw failure('Starting the batch', error)
      return toBatchRecord(data as BatchRow)
    },

    async batchDone(jobId, index, cid, size) {
      const { data, error } = await client.rpc('art_batch_done', {
        p_job_id: jobId,
        p_index: index,
        p_images_cid: cid,
        p_images_size: size,
      })
      if (error) throw failure('Recording the batch', error)
      const [row] = data ?? []
      if (!row) throw new Error('Recording the batch returned no row.')
      return { batchesDone: row.batches_done, last: row.last }
    },

    async fail(jobId, index, code, message, final, retries) {
      const { error } = await client.rpc('art_batch_failed', {
        p_job_id: jobId,
        // A job-level failure has no batch. The generated type has no null for the argument.
        p_index: index as unknown as number,
        p_code: code,
        p_message: message,
        p_final: final,
        p_retries: retries,
      })
      if (error) throw failure('Recording the failure', error)
      return jobAfter(jobId)
    },

    async finish(jobId, result) {
      const { error } = await client.rpc('art_render_finish', {
        p_job_id: jobId,
        p_metadata_cid: result.metadataCid,
        p_base_uri: result.baseUri,
        ...(result.placeholderImageCid === null
          ? {}
          : { p_placeholder_image_cid: result.placeholderImageCid }),
        ...(result.collageKey === null ? {} : { p_collage_key: result.collageKey }),
      })
      if (error) throw failure('Finishing the job', error)
      return jobAfter(jobId)
    },

    async stuck(olderThanMinutes) {
      const cutoff = new Date(now() - olderThanMinutes * 60_000).toISOString()
      const { data, error } = await client
        .from('render_jobs')
        .select('id, retries')
        .in('state', ['rendering', 'finalizing'])
        .lt('updated_at', cutoff)
        .order('updated_at')
        .limit(STUCK_LIMIT)
      if (error) throw failure('Reading stuck jobs', error)
      const stuck: { id: string; retries: number }[] = []
      for (const row of data ?? []) {
        // One bounded read a job: is any of its batches newer than the cutoff?
        const recent = await client
          .from('render_batches')
          .select('index')
          .eq('job_id', row.id)
          .gte('updated_at', cutoff)
          .limit(1)
        if (recent.error) throw failure('Reading stuck batches', recent.error)
        if ((recent.data ?? []).length === 0) stuck.push({ id: row.id, retries: row.retries })
      }
      return stuck
    },
  }
}
```

- [ ] **Step 5: Run the test to see it pass**

Run: `pnpm --filter @cobweb/worker exec vitest run src/adapters/supabase-jobs.test.ts`
Expected: PASS, 23 tests.

- [ ] **Step 6: Write the stand-in for an AWS client and the failing tests for storage and the chain**

Create `services/worker/src/testing/stub-aws.ts`:

```ts
/**
 * A stand-in for an AWS SDK client in adapter tests: it records each command (its class name and
 * input) and answers with whatever the test's `answer` returns. Not exported from the package.
 */
import type { S3Like } from '../adapters/s3-store.ts'

export type SentCommand = { name: string; input: Record<string, unknown> }

export function stubAws<Client = S3Like>(
  answer: (name: string, input: Record<string, unknown>) => unknown = () => ({}),
): { client: Client; sent: SentCommand[] } {
  const sent: SentCommand[] = []
  const client = {
    send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      sent.push({ name: command.constructor.name, input: command.input })
      return answer(command.constructor.name, command.input)
    },
  }
  return { client: client as unknown as Client, sent }
}

export const bytes = (text: string): Uint8Array => new TextEncoder().encode(text)
```

Create `services/worker/src/adapters/s3-store.test.ts`:

```ts
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { describe, expect, it } from 'vitest'
import { COLLECTION_ID, JOB_ID } from '../testing/fixtures.ts'
import { bytes, stubAws } from '../testing/stub-aws.ts'
import { COLLAGE_KEY, s3Store } from './s3-store.ts'

describe('s3Store', () => {
  it('loads an object from the art bucket by its key', async () => {
    const art = stubAws(() => ({ Body: { transformToByteArray: async () => bytes('png') } }))
    const render = stubAws()
    const store = s3Store({ client: art.client, bucket: 'art' }, { client: render.client, bucket: 'render' })
    expect(await store.load({ key: 'c/layers/a.png', ext: 'png' })).toEqual(bytes('png'))
    expect(art.sent).toEqual([
      { name: GetObjectCommand.name, input: { Bucket: 'art', Key: 'c/layers/a.png' } },
    ])
    expect(render.sent).toEqual([])
  })

  it('throws for a missing object and for an empty answer', async () => {
    const missing = stubAws(() => {
      throw Object.assign(new Error('The specified key does not exist.'), { name: 'NoSuchKey' })
    })
    const store = s3Store(
      { client: missing.client, bucket: 'art' },
      { client: missing.client, bucket: 'render' },
    )
    await expect(store.load({ key: 'c/layers/a.png', ext: 'png' })).rejects.toThrow('does not exist')
    const empty = stubAws(() => ({}))
    const other = s3Store({ client: empty.client, bucket: 'art' }, { client: empty.client, bucket: 'render' })
    await expect(other.load({ key: 'c/layers/a.png', ext: 'png' })).rejects.toThrow('The object has no body.')
  })

  it('writes a collage to the render bucket as a PNG, never to the art bucket', async () => {
    const art = stubAws()
    const render = stubAws()
    const store = s3Store({ client: art.client, bucket: 'art' }, { client: render.client, bucket: 'render' })
    const key = `${COLLECTION_ID}/collage/${JOB_ID}.png`
    await store.putCollage(key, bytes('png'))
    expect(render.sent).toEqual([
      {
        name: PutObjectCommand.name,
        input: { Bucket: 'render', Key: key, Body: bytes('png'), ContentType: 'image/png' },
      },
    ])
    expect(art.sent).toEqual([])
  })

  it('refuses a key shaped like an upload or anything else', async () => {
    const render = stubAws()
    const store = s3Store(
      { client: render.client, bucket: 'art' },
      { client: render.client, bucket: 'render' },
    )
    for (const key of [
      `${COLLECTION_ID}/layers/${'a'.repeat(64)}.png`,
      `${COLLECTION_ID}/collage/../layers/x.png`,
      `collage/${JOB_ID}.png`,
      `${COLLECTION_ID}/collage/${JOB_ID}.gif`,
    ])
      await expect(store.putCollage(key, bytes('png'))).rejects.toThrow('A collage key is')
    expect(render.sent).toEqual([])
    expect(COLLAGE_KEY.test(`${COLLECTION_ID}/collage/${JOB_ID}.png`)).toBe(true)
  })
})
```

Create `services/worker/src/adapters/viem-chain.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { jobRecord } from '../testing/fixtures.ts'
import { viemChain } from './viem-chain.ts'
import type { PaymentReader } from './viem-chain.ts'

describe('viemChain', () => {
  const FACTORY = '0x00000000000000000000000000000000000000fa'
  const reader = (latest: bigint, paid: bigint) => {
    const reads: { address: string; args: readonly unknown[]; blockNumber: bigint }[] = []
    const made: number[] = []
    const stub: PaymentReader = {
      getBlockNumber: async () => latest,
      readContract: async (args) => {
        reads.push({ address: args.address, args: args.args, blockNumber: args.blockNumber })
        return paid
      },
    }
    return {
      reads,
      made,
      readerFor: (chainId: number) => {
        made.push(chainId)
        return stub
      },
    }
  }

  it('reads jobPayment for the job id and payer from the quote factory', async () => {
    const { reads, readerFor } = reader(100n, 125n)
    const job = jobRecord()
    expect(await viemChain({}, readerFor).jobPayment(job)).toBe(125n)
    expect(reads).toEqual([{ address: FACTORY, args: [job.onchainJobId, job.quotePayer], blockNumber: 100n }])
  })

  it('reads at the block the chain confirmations bury', async () => {
    // Ethereum asks for 5 confirmations: the block 4 below the latest.
    const mainnet = reader(100n, 1n)
    await viemChain({}, mainnet.readerFor).jobPayment(jobRecord({ quoteChainId: 1 }))
    expect(mainnet.reads[0]?.blockNumber).toBe(96n)
    const young = reader(2n, 1n)
    await viemChain({}, young.readerFor).jobPayment(jobRecord({ quoteChainId: 1 }))
    expect(young.reads[0]?.blockNumber).toBe(0n)
  })

  it('falls back to the configured factory when the job has none', async () => {
    const { reads, readerFor } = reader(10n, 1n)
    const env = { FACTORY_ADDRESS_31337: '0x5FbDB2315678afecb367f032d93F642f64180aa3' }
    await viemChain(env, readerFor).jobPayment(jobRecord({ quoteFactory: null }))
    expect(reads[0]?.address).toBe('0x5FbDB2315678afecb367f032d93F642f64180aa3')
    await expect(viemChain({}, readerFor).jobPayment(jobRecord({ quoteFactory: null }))).rejects.toThrow(
      'The factory address for chain 31337 is not configured.',
    )
  })

  it('answers zero, without a read, for a job with no chain or no payer', async () => {
    const { reads, readerFor } = reader(10n, 99n)
    const chain = viemChain({}, readerFor)
    expect(await chain.jobPayment(jobRecord({ quoteChainId: null }))).toBe(0n)
    expect(await chain.jobPayment(jobRecord({ quotePayer: null }))).toBe(0n)
    expect(reads).toEqual([])
  })

  it('throws for a chain that is not offered and passes a read error on', async () => {
    const { readerFor } = reader(10n, 1n)
    await expect(viemChain({}, readerFor).jobPayment(jobRecord({ quoteChainId: 999 }))).rejects.toThrow(
      'Chain 999 is not configured.',
    )
    const failing = viemChain({}, () => ({
      getBlockNumber: () => Promise.reject(new Error('rpc down')),
      readContract: async () => 0n,
    }))
    await expect(failing.jobPayment(jobRecord())).rejects.toThrow('rpc down')
  })

  it('throws when the chain has no RPC URL configured', async () => {
    await expect(viemChain({}).jobPayment(jobRecord())).rejects.toThrow(
      'The RPC URL for chain 31337 is not configured.',
    )
  })

  it('makes one reader a chain', async () => {
    const { made, readerFor } = reader(10n, 1n)
    const chain = viemChain({}, readerFor)
    await chain.jobPayment(jobRecord())
    await chain.jobPayment(jobRecord())
    expect(made).toEqual([31337])
  })
})
```

- [ ] **Step 7: Run the tests to see them fail**

Run: `pnpm --filter @cobweb/worker exec vitest run src/adapters/s3-store.test.ts src/adapters/viem-chain.test.ts`
Expected: FAIL. `Cannot find module './s3-store.ts'` and `Cannot find module './viem-chain.ts'`.

- [ ] **Step 8: Write the storage adapter**

Create `services/worker/src/adapters/s3-store.ts`:

```ts
/**
 * The `Store` port on S3 (AWS in production, Supabase Storage locally). It reads layer images,
 * assets and placeholders from the art bucket and writes collages to the render bucket. There is no
 * way to write to the art bucket here, so the upload sweep can never see worker output.
 */
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import type { S3Client } from '@aws-sdk/client-s3'
import type { Store } from '../ports.ts'

export type S3Like = Pick<S3Client, 'send'>
export type Bucket = { client: S3Like; bucket: string }

/** `<collection id>/collage/<job id>.png`: never the shape of an upload key (`<id>/<folder>/<sha256>.<ext>`). */
export const COLLAGE_KEY =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/collage\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/

export function s3Store(art: Bucket, render: Bucket): Store {
  return {
    async load(ref) {
      const found = await art.client.send(new GetObjectCommand({ Bucket: art.bucket, Key: ref.key }))
      if (!found.Body) throw new Error('The object has no body.')
      return found.Body.transformToByteArray()
    },
    async putCollage(key, png) {
      if (!COLLAGE_KEY.test(key)) throw new Error('A collage key is <collection id>/collage/<job id>.png.')
      await render.client.send(
        new PutObjectCommand({ Bucket: render.bucket, Key: key, Body: png, ContentType: 'image/png' }),
      )
    },
  }
}
```

- [ ] **Step 9: Write the chain adapter**

Create `services/worker/src/adapters/viem-chain.ts`:

```ts
/**
 * The `Chain` port on viem: the factory's `jobPayment(jobId, payer)` for a job, read on the job's
 * `quote_chain_id` from its `quote_factory`, at the chain's confirmation depth
 * (docs/specs/2026-10-09-lock-and-pay.md, section 4). Chain config, the ABI and the factory address
 * come from `@cobweb/shared` (the browser-safe entry: `@cobweb/shared/server` imports `server-only`,
 * which only resolves inside Next). RPC URLs come from the worker's own environment.
 */
import { chainById, factoryAbi, factoryAddress } from '@cobweb/shared'
import type { Env } from '@cobweb/shared'
import { createPublicClient, http } from 'viem'
import type { Address, Hex } from 'viem'
import type { Chain } from '../ports.ts'

/** The two reads the payment check makes, so a test can stand in for viem. */
export type PaymentReader = {
  getBlockNumber(args: { cacheTime: number }): Promise<bigint>
  readContract(args: {
    address: Address
    abi: typeof factoryAbi
    functionName: 'jobPayment'
    args: readonly [Hex, Address]
    blockNumber: bigint
  }): Promise<bigint>
}

function viemReader(chainId: number, env: Env): PaymentReader {
  const chain = chainById(chainId)
  const url = chain ? env[chain.rpcEnv] : undefined
  if (!chain || !url) throw new Error(`The RPC URL for chain ${chainId} is not configured.`)
  const client = createPublicClient({ chain: chain.viem, transport: http(url) })
  return {
    getBlockNumber: (args) => client.getBlockNumber(args),
    readContract: (args) => client.readContract(args),
  }
}

export function viemChain(
  env: Env,
  readerFor: (chainId: number) => PaymentReader = (chainId) => viemReader(chainId, env),
): Chain {
  const readers = new Map<number, PaymentReader>()
  return {
    async jobPayment(job) {
      // Fails closed: a job with no chain or no payer cannot have a payment the worker can verify.
      if (job.quoteChainId === null || job.quotePayer === null) return 0n
      const chain = chainById(job.quoteChainId)
      if (!chain) throw new Error(`Chain ${job.quoteChainId} is not configured.`)
      const factory = job.quoteFactory ? (job.quoteFactory as Address) : factoryAddress(chain.id, env)
      let reader = readers.get(chain.id)
      if (!reader) {
        reader = readerFor(chain.id)
        readers.set(chain.id, reader)
      }
      // Read at the block the chain's confirmations bury, so a payment too shallow to survive a
      // reorg does not count yet. cacheTime 0: viem would otherwise reuse an older block number.
      const latest = await reader.getBlockNumber({ cacheTime: 0 })
      const depth = BigInt(chain.confirmations - 1)
      return reader.readContract({
        address: factory,
        abi: factoryAbi,
        functionName: 'jobPayment',
        args: [job.onchainJobId as Hex, job.quotePayer as Address],
        blockNumber: latest > depth ? latest - depth : 0n,
      })
    },
  }
}
```

- [ ] **Step 10: Run the tests to see them pass**

Run: `pnpm --filter @cobweb/worker test`
Expected: PASS, 8 files, 135 tests.

- [ ] **Step 11: Format, run the root checks and commit**

Run: `pnpm exec prettier --write services/worker/src`

Run at the repo root: `pnpm typecheck && pnpm lint && pnpm test`
Expected: every Turborepo task succeeds.

```bash
git add services/worker/src/adapters \
  services/worker/src/testing/stub-client.ts \
  services/worker/src/testing/stub-aws.ts
git commit -m "Add the Supabase, storage and chain adapters" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bcHX4HZG5YGWhxjGuiWos"
```

---

### Task 9: The Filebase and SQS adapters, the production wiring and the Lambda entry points

**Files:**

- Create: `services/worker/src/adapters/filebase.ts`
- Create: `services/worker/src/adapters/filebase.test.ts`
- Create: `services/worker/src/adapters/sqs.ts`
- Create: `services/worker/src/adapters/sqs.test.ts`
- Create: `services/worker/src/queue.ts`
- Create: `services/worker/src/env.ts`
- Create: `services/worker/src/env.test.ts`
- Create: `services/worker/.env.example`
- Create: `services/worker/src/index.ts`
- Create: `services/worker/src/lambda/handler.ts`
- Create: `services/worker/src/lambda/deps.ts`
- Create: `services/worker/src/lambda/render.ts`
- Create: `services/worker/src/lambda/dead.ts`
- Create: `services/worker/src/lambda/sweep.ts`
- Create: `services/worker/src/lambda/lambda.test.ts`

**Interfaces:**

- Consumes: `Pinner`, `S3Like`, `stubAws`, `bytes` (Tasks 2 and 8); `RenderMessage`, `RenderQueue`, `parseRenderMessage` (Task 1); `supabaseJobs`, `s3Store`, `viemChain` (Task 8); `handle`, `handleDead`, `sweep`, `Deps` (Tasks 4 to 7); `consoleLog`, `errorSummary` (Task 2); `SendMessageBatchCommand` from `@aws-sdk/client-sqs`; `GetSecretValueCommand`, `SecretsManagerClient` from `@aws-sdk/client-secrets-manager`; `SQSEvent`, `SQSBatchResponse`, `SQSBatchItemFailure` from `aws-lambda` (types).
- Produces:
  - `FILEBASE_ENDPOINT`, `FILEBASE_IMPORT_METADATA`, `FILEBASE_CID_METADATA_KEY`, `filebasePinner(client: S3Like, bucket: string): Pinner`
  - `SQS_BATCH = 10`, `sqsRenderQueue(client: Pick<SQSClient, 'send'>, queueUrl: string): RenderQueue`, also from the `@cobweb/worker/queue` entry
  - `WORKER_ENV`, `need(env, name)`, `artS3Options(env): S3ClientConfig`, `filebaseS3Options(env): S3ClientConfig`, `workerClient(env): WorkerClient`, `productionDeps(env: Env, log?: Log): Deps`
  - `sqsHandler(getDeps, run, log?): (event: SQSEvent) => Promise<SQSBatchResponse>`, `parseSecret(text): Record<string, string>`, `loadDeps(): Promise<Deps>`, and a `handler` export from each of `lambda/render.ts`, `lambda/dead.ts`, `lambda/sweep.ts`
  - the package index `@cobweb/worker` (everything `verify:render` and the web app need)

Filebase: the three values the adapter depends on were confirmed in Filebase's public documentation (`https://filebase.com/docs/ipfs/pinning/pinning-files`): the S3 endpoint `https://s3.filebase.com` with region `us-east-1`; a CAR is imported when the object carries the metadata `import=car` (the documented command is `aws --endpoint https://s3.filebase.com s3 cp folder.car s3://<bucket>/ --metadata 'import=car'`); and the CID is returned as `x-amz-meta-cid`, also readable with `s3api head-object`. They are **unverified against a live account**: no Filebase key exists on the development machine. They live in three named constants, the adapter is tested against a stubbed client only, and `infra/README.md` (Task 12) gives the two commands that confirm them on the first deploy. Do not call Filebase from any test or script. Decision 23 explains the HeadObject.

SQS takes at most 10 entries in one `SendMessageBatch` call (the SDK's own documentation for `SendMessageBatchCommand` and its `TooManyEntriesInBatchRequest` error), so the adapter sends in chunks of 10 and throws on any partial failure.

The Lambda entry points are thin (spec section 9): parse the record with `parseRenderMessage`, build the production ports once per container, run, and answer with partial batch failures. A body that is not a render message is logged and acknowledged. The secret is one JSON object of text values, read once per container and merged over the environment (decision 17).

- [ ] **Step 1: Write the failing tests for the two adapters**

Create `services/worker/src/adapters/filebase.test.ts`:

```ts
import { HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { describe, expect, it } from 'vitest'
import { bytes, stubAws } from '../testing/stub-aws.ts'
import {
  FILEBASE_CID_METADATA_KEY,
  FILEBASE_ENDPOINT,
  FILEBASE_IMPORT_METADATA,
  filebasePinner,
} from './filebase.ts'

describe('filebasePinner', () => {
  it('uploads the CAR with the import metadata and returns the CID Filebase reports', async () => {
    const { client, sent } = stubAws((name) =>
      name === HeadObjectCommand.name ? { Metadata: { [FILEBASE_CID_METADATA_KEY]: 'bafyreported' } } : {},
    )
    expect(await filebasePinner(client, 'cobweb-pins').pin(bytes('car'), 'bafyexpected')).toBe('bafyreported')
    expect(sent).toEqual([
      {
        name: PutObjectCommand.name,
        input: {
          Bucket: 'cobweb-pins',
          Key: 'bafyexpected.car',
          Body: bytes('car'),
          ContentType: 'application/vnd.ipld.car',
          Metadata: { import: 'car' },
        },
      },
      { name: HeadObjectCommand.name, input: { Bucket: 'cobweb-pins', Key: 'bafyexpected.car' } },
    ])
  })

  it('throws when Filebase reports no CID, so the message is redelivered', async () => {
    const { client } = stubAws(() => ({ Metadata: {} }))
    await expect(filebasePinner(client, 'b').pin(bytes('car'), 'bafy')).rejects.toThrow(
      'The pinning service did not report a CID.',
    )
  })

  it('throws when the upload fails and does not ask for the CID', async () => {
    const { client, sent } = stubAws((name) => {
      if (name === PutObjectCommand.name) throw new Error('503')
      return {}
    })
    await expect(filebasePinner(client, 'b').pin(bytes('car'), 'bafy')).rejects.toThrow('503')
    expect(sent).toHaveLength(1)
  })

  it('keeps the documented values in named constants', () => {
    expect(FILEBASE_ENDPOINT).toBe('https://s3.filebase.com')
    expect(FILEBASE_IMPORT_METADATA).toEqual({ import: 'car' })
    expect(FILEBASE_CID_METADATA_KEY).toBe('cid')
  })
})
```

Create `services/worker/src/adapters/sqs.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { SendMessageBatchCommand } from '@aws-sdk/client-sqs'
import type { SQSClient } from '@aws-sdk/client-sqs'
import { parseRenderMessage } from '@cobweb/shared/render-queue'
import type { RenderMessage } from '@cobweb/shared/render-queue'
import { describe, expect, it } from 'vitest'
import { JOB_ID } from '../testing/fixtures.ts'
import { stubAws } from '../testing/stub-aws.ts'
import { sqsRenderQueue } from './sqs.ts'

describe('sqsRenderQueue', () => {
  type Sqs = Pick<SQSClient, 'send'>
  const messages = (count: number): RenderMessage[] =>
    Array.from({ length: count }, (_, index) => ({
      jobId: JOB_ID,
      step: 'batch' as const,
      index,
      retries: 1,
    }))

  it('sends at most ten entries a call, each a message the parser reads back', async () => {
    const { client, sent } = stubAws<Sqs>()
    await sqsRenderQueue(client, 'https://sqs.example/queue').send(messages(23))
    expect(sent.map((call) => call.name)).toEqual(Array(3).fill(SendMessageBatchCommand.name))
    const entries = sent.map((call) => call.input.Entries as { Id: string; MessageBody: string }[])
    expect(entries.map((batch) => batch.length)).toEqual([10, 10, 3])
    expect(sent[0]?.input.QueueUrl).toBe('https://sqs.example/queue')
    expect(new Set(entries[0]!.map((entry) => entry.Id)).size).toBe(10)
    expect(entries.flat().map((entry) => parseRenderMessage(entry.MessageBody))).toEqual(messages(23))
  })

  it('sends nothing for an empty list', async () => {
    const { client, sent } = stubAws<Sqs>()
    await sqsRenderQueue(client, 'q').send([])
    expect(sent).toEqual([])
  })

  it('throws when SQS refuses some entries', async () => {
    const { client } = stubAws<Sqs>(() => ({ Failed: [{ Id: '0' }, { Id: '4' }] }))
    await expect(sqsRenderQueue(client, 'q').send(messages(5))).rejects.toThrow(
      'The queue refused 2 message(s).',
    )
  })

  it('is reachable through an entry that imports only the SQS client', () => {
    const entry = readFileSync(new URL('../queue.ts', import.meta.url), 'utf8')
    const adapter = readFileSync(new URL('./sqs.ts', import.meta.url), 'utf8')
    const imports = [...`${entry}\n${adapter}`.matchAll(/from '([^']+)'/g)].map((match) => match[1])
    expect(imports.sort()).toEqual([
      './adapters/sqs.ts',
      '@aws-sdk/client-sqs',
      '@aws-sdk/client-sqs',
      '@cobweb/shared/render-queue',
    ])
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @cobweb/worker exec vitest run src/adapters/filebase.test.ts src/adapters/sqs.test.ts`
Expected: FAIL. `Cannot find module './filebase.ts'` and `Cannot find module './sqs.ts'`.

- [ ] **Step 3: Write the two adapters and the queue entry**

Create `services/worker/src/adapters/filebase.ts`:

```ts
/**
 * The `Pinner` port on Filebase's S3-compatible API. Filebase's documentation
 * (filebase.com/docs/ipfs/pinning/pinning-files) gives the endpoint, the `import=car` object
 * metadata that makes it import a CAR, and `x-amz-meta-cid` as where the CID comes back. None of it
 * has been run with a real key from this repo, so the three values live in the constants below and
 * infra/README.md lists confirming them as the first thing to do on a first deploy.
 */
import { HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import type { Pinner } from '../ports.ts'
import type { S3Like } from './s3-store.ts'

/** Filebase's S3 endpoint; its region is `us-east-1`. */
export const FILEBASE_ENDPOINT = 'https://s3.filebase.com'
/** Object metadata (sent as `x-amz-meta-import: car`) that makes Filebase import the body as a CAR. */
export const FILEBASE_IMPORT_METADATA = { import: 'car' } as const
/** The object metadata key Filebase answers with (`x-amz-meta-cid`): the CAR's root CID. */
export const FILEBASE_CID_METADATA_KEY = 'cid'

export function filebasePinner(client: S3Like, bucket: string): Pinner {
  return {
    async pin(car, expectedCid) {
      const key = `${expectedCid}.car`
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: car,
          ContentType: 'application/vnd.ipld.car',
          Metadata: { ...FILEBASE_IMPORT_METADATA },
        }),
      )
      // The SDK does not expose PutObject's custom response headers, so the CID is read back.
      const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
      const cid = head.Metadata?.[FILEBASE_CID_METADATA_KEY]
      if (!cid) throw new Error('The pinning service did not report a CID.')
      return cid
    },
  }
}
```

Create `services/worker/src/adapters/sqs.ts`:

```ts
/** The `RenderQueue` port on SQS. Imports only the SQS client, so the web app can use it for retries. */
import { SendMessageBatchCommand } from '@aws-sdk/client-sqs'
import type { SQSClient } from '@aws-sdk/client-sqs'
import type { RenderMessage, RenderQueue } from '@cobweb/shared/render-queue'

/** The most entries SQS takes in one SendMessageBatch call. */
export const SQS_BATCH = 10

export function sqsRenderQueue(client: Pick<SQSClient, 'send'>, queueUrl: string): RenderQueue {
  return {
    async send(messages: RenderMessage[]) {
      for (let at = 0; at < messages.length; at += SQS_BATCH) {
        const entries = messages.slice(at, at + SQS_BATCH)
        const result = await client.send(
          new SendMessageBatchCommand({
            QueueUrl: queueUrl,
            Entries: entries.map((message, index) => ({
              Id: String(index),
              MessageBody: JSON.stringify(message),
            })),
          }),
        )
        // A partial failure is a failure: the caller throws and the whole step is redelivered.
        if (result.Failed?.length) throw new Error(`The queue refused ${result.Failed.length} message(s).`)
      }
    },
  }
}
```

Create `services/worker/src/queue.ts`:

```ts
// The `@cobweb/worker/queue` entry: the SQS adapter alone, for the web app's retry action. Nothing
// here imports sharp, the render library, Supabase or viem.
export { SQS_BATCH, sqsRenderQueue } from './adapters/sqs.ts'
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm --filter @cobweb/worker exec vitest run src/adapters/filebase.test.ts src/adapters/sqs.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Write the failing tests for the wiring and the Lambda entry points**

Create `services/worker/src/env.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { artS3Options, filebaseS3Options, need, productionDeps, WORKER_ENV } from './env.ts'

const LOCAL = {
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key-value',
  ART_S3_ENDPOINT: 'http://127.0.0.1:54321/storage/v1/s3',
  ART_S3_REGION: 'local',
  ART_S3_BUCKET: 'art',
  ART_S3_ACCESS_KEY_ID: 'art-key-id',
  ART_S3_SECRET_ACCESS_KEY: 'art-key-secret',
  ART_S3_FORCE_PATH_STYLE: '1',
  RENDER_S3_BUCKET: 'render',
  FILEBASE_BUCKET: 'cobweb-pins',
  FILEBASE_ACCESS_KEY_ID: 'filebase-key-id',
  FILEBASE_SECRET_ACCESS_KEY: 'filebase-key-secret',
  RENDER_QUEUE_URL: 'https://sqs.us-east-1.amazonaws.com/000000000000/render',
}

describe('the env names', () => {
  it('never start with NEXT_PUBLIC_', () => {
    for (const name of WORKER_ENV) expect(name.startsWith('NEXT_PUBLIC_')).toBe(false)
  })

  it('are all in .env.example, which sets no secret and no public name', () => {
    const example = readFileSync(new URL('../.env.example', import.meta.url), 'utf8')
    const lines = example.split('\n').filter((line) => line && !line.startsWith('#'))
    const names = lines.map((line) => line.split('=')[0])
    for (const name of WORKER_ENV) expect(names, name).toContain(name)
    expect(names).toContain('RPC_URL_31337')
    expect(names).toContain('FACTORY_ADDRESS_31337')
    expect(example).not.toContain('NEXT_PUBLIC_SUPABASE')
    for (const line of lines)
      if (/KEY|SECRET|RPC_URL/.test(line.split('=')[0] ?? '')) expect(line.endsWith('=')).toBe(true)
  })
})

describe('need', () => {
  it('names the missing variable and never a value', () => {
    expect(need({ A: 'value' }, 'A')).toBe('value')
    expect(() => need({ A: '' }, 'A')).toThrow('A is not set.')
    expect(() => need({}, 'SUPABASE_SERVICE_ROLE_KEY')).toThrow('SUPABASE_SERVICE_ROLE_KEY is not set.')
  })
})

describe('artS3Options', () => {
  it('uses the endpoint, path style and keys of local storage, with the checksum settings that work there', () => {
    expect(artS3Options(LOCAL)).toEqual({
      region: 'local',
      endpoint: 'http://127.0.0.1:54321/storage/v1/s3',
      forcePathStyle: true,
      credentials: { accessKeyId: 'art-key-id', secretAccessKey: 'art-key-secret' },
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    })
  })

  it('leaves credentials to the role on AWS', () => {
    expect(artS3Options({ ART_S3_REGION: 'us-east-1' })).toEqual({
      region: 'us-east-1',
      forcePathStyle: false,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    })
    expect(() => artS3Options({})).toThrow('ART_S3_REGION is not set.')
  })
})

describe('filebaseS3Options', () => {
  it('defaults to the documented endpoint and needs both keys', () => {
    expect(filebaseS3Options(LOCAL)).toMatchObject({
      region: 'us-east-1',
      endpoint: 'https://s3.filebase.com',
      forcePathStyle: true,
    })
    expect(filebaseS3Options({ ...LOCAL, FILEBASE_S3_ENDPOINT: 'http://127.0.0.1:9000' }).endpoint).toBe(
      'http://127.0.0.1:9000',
    )
    expect(() => filebaseS3Options({})).toThrow('FILEBASE_ACCESS_KEY_ID is not set.')
  })
})

describe('productionDeps', () => {
  it('builds every port without opening a connection', () => {
    const deps = productionDeps(LOCAL, () => {})
    expect(Object.keys(deps).sort()).toEqual(['chain', 'jobs', 'log', 'pinner', 'queue', 'store'])
  })

  it('refuses an incomplete environment by name, without echoing any value', () => {
    for (const name of [
      'SUPABASE_SERVICE_ROLE_KEY',
      'RENDER_S3_BUCKET',
      'FILEBASE_BUCKET',
      'RENDER_QUEUE_URL',
    ]) {
      let message = ''
      try {
        productionDeps({ ...LOCAL, [name]: undefined }, () => {})
      } catch (error) {
        message = (error as Error).message
      }
      expect(message).toBe(`${name} is not set.`)
      for (const value of Object.values(LOCAL)) expect(message).not.toContain(value)
    }
  })
})
```

Create `services/worker/src/lambda/lambda.test.ts`:

```ts
import type { SQSEvent, SQSRecord } from 'aws-lambda'
import { describe, expect, it } from 'vitest'
import type { Deps } from '../steps.ts'
import { JOB_ID } from '../testing/fixtures.ts'
import { parseSecret } from './deps.ts'
import { sqsHandler } from './handler.ts'

const record = (messageId: string, body: unknown): SQSRecord =>
  ({ messageId, body: typeof body === 'string' ? body : JSON.stringify(body) }) as SQSRecord
const event = (...records: SQSRecord[]): SQSEvent => ({ Records: records })
const deps = {} as Deps
const start = { jobId: JOB_ID, step: 'start', retries: 0 }

describe('sqsHandler', () => {
  it('runs each message and reports no failure when all return', async () => {
    const ran: unknown[] = []
    const handler = sqsHandler(
      async () => deps,
      async (message) => void ran.push(message),
      () => {},
    )
    const batch = { jobId: JOB_ID, step: 'batch', index: 2, retries: 1 }
    expect(await handler(event(record('m1', start), record('m2', batch)))).toEqual({ batchItemFailures: [] })
    expect(ran).toEqual([start, batch])
  })

  it('reports only the message whose run threw', async () => {
    const lines: string[] = []
    const handler = sqsHandler(
      async () => deps,
      async (message) => {
        if (message.step === 'metadata') throw new Error('pin down at https://s3.example/key')
      },
      (name, fields) => lines.push(`${name} ${String(fields?.error ?? '')}`.trim()),
    )
    const response = await handler(
      event(record('m1', start), record('m2', { jobId: JOB_ID, step: 'metadata', retries: 0 })),
    )
    expect(response).toEqual({ batchItemFailures: [{ itemIdentifier: 'm2' }] })
    expect(lines).toEqual(['message failed Error: pin down at [url]'])
  })

  it('acknowledges and logs a body that is not a render message, without building the ports', async () => {
    const lines: string[] = []
    let built = 0
    const handler = sqsHandler(
      async () => {
        built += 1
        return deps
      },
      async () => {
        throw new Error('must not run')
      },
      (name) => lines.push(name),
    )
    const response = await handler(
      event(record('m1', 'not json'), record('m2', { jobId: 'x', step: 'start' })),
    )
    expect(response).toEqual({ batchItemFailures: [] })
    expect(lines).toEqual(['message ignored', 'message ignored'])
    expect(built).toBe(0)
  })

  it('reports every message when the ports cannot be built, so nothing is lost', async () => {
    const handler = sqsHandler(
      () => Promise.reject(new Error('RENDER_SECRET_ARN is not set.')),
      async () => {},
      () => {},
    )
    expect(await handler(event(record('m1', start), record('m2', start)))).toEqual({
      batchItemFailures: [{ itemIdentifier: 'm1' }, { itemIdentifier: 'm2' }],
    })
  })

  it('answers an empty event with no failures', async () => {
    const handler = sqsHandler(
      async () => deps,
      async () => {},
      () => {},
    )
    expect(await handler(event())).toEqual({ batchItemFailures: [] })
  })
})

describe('parseSecret', () => {
  it('reads a JSON object of text values', () => {
    expect(parseSecret('{"SUPABASE_SERVICE_ROLE_KEY":"k","RPC_URL_1":"https://rpc"}')).toEqual({
      SUPABASE_SERVICE_ROLE_KEY: 'k',
      RPC_URL_1: 'https://rpc',
    })
  })

  it('refuses anything else without echoing it', () => {
    for (const text of [undefined, '', 'generated-password', '[]', '{"A":1}', 'null']) {
      let message = ''
      try {
        parseSecret(text)
      } catch (error) {
        message = (error as Error).message
      }
      expect(message).toBe('The render secret is not a JSON object of text values.')
    }
  })
})
```

- [ ] **Step 6: Run the tests to see them fail**

Run: `pnpm --filter @cobweb/worker exec vitest run src/env.test.ts src/lambda/lambda.test.ts`
Expected: FAIL. `Cannot find module './env.ts'` and `Cannot find module './deps.ts'`.

- [ ] **Step 7: Write the env file and the production wiring**

Create `services/worker/.env.example`:

```
# The render worker's configuration. Server only: none of these is read by a browser, none starts
# with NEXT_PUBLIC_, and no value is printed or logged. Locally the scripts discover what they need
# from `supabase status -o env` and apps/web/.env.local, so this file documents the names; on AWS
# the stack sets the plain values and the secret holds the rest (infra/README.md).

# Supabase: the project URL and the service-role key (secret).
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

# The art bucket, read only. Local: Supabase Storage (STORAGE_S3_URL, S3_PROTOCOL_REGION and the
# S3 protocol keys from `supabase status -o env`), bucket "art", path style on. AWS: leave the
# endpoint, the keys and path style unset; the function's role reads the bucket.
ART_S3_ENDPOINT=
ART_S3_REGION=
ART_S3_BUCKET=art
ART_S3_ACCESS_KEY_ID=
ART_S3_SECRET_ACCESS_KEY=
ART_S3_FORCE_PATH_STYLE=1

# The render bucket, for preview collages. Local: the "render" bucket in Supabase Storage.
RENDER_S3_BUCKET=render

# Filebase (secret keys). The endpoint defaults to https://s3.filebase.com.
FILEBASE_S3_ENDPOINT=
FILEBASE_BUCKET=
FILEBASE_ACCESS_KEY_ID=
FILEBASE_SECRET_ACCESS_KEY=

# The SQS queue the worker sends its own batch and metadata messages to.
RENDER_QUEUE_URL=

# One pair per chain: the RPC URL (secret) and the factory address, as in apps/web/.env.example.
RPC_URL_31337=
FACTORY_ADDRESS_31337=
```

Create `services/worker/src/env.ts`:

```ts
/**
 * The worker's configuration (docs/specs/2026-10-12-render-worker.md, section 10) and the
 * production wiring of the ports. Every value comes from the record passed in (the process
 * environment locally; the environment plus the Secrets Manager secret on Lambda). None of the
 * names starts with NEXT_PUBLIC_, none is read by a browser, and no value is ever logged.
 */
import { S3Client } from '@aws-sdk/client-s3'
import type { S3ClientConfig } from '@aws-sdk/client-s3'
import { SQSClient } from '@aws-sdk/client-sqs'
import type { Env } from '@cobweb/shared'
import { createClient } from '@supabase/supabase-js'
import { FILEBASE_ENDPOINT, filebasePinner } from './adapters/filebase.ts'
import { s3Store } from './adapters/s3-store.ts'
import { sqsRenderQueue } from './adapters/sqs.ts'
import { supabaseJobs } from './adapters/supabase-jobs.ts'
import type { WorkerClient } from './adapters/supabase-jobs.ts'
import { viemChain } from './adapters/viem-chain.ts'
import { consoleLog } from './log.ts'
import type { Log } from './log.ts'
import type { Deps } from './steps.ts'

/** The fixed names. `RPC_URL_<chainId>` and `FACTORY_ADDRESS_<chainId>` are read per chain. */
export const WORKER_ENV = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'ART_S3_ENDPOINT',
  'ART_S3_REGION',
  'ART_S3_BUCKET',
  'ART_S3_ACCESS_KEY_ID',
  'ART_S3_SECRET_ACCESS_KEY',
  'ART_S3_FORCE_PATH_STYLE',
  'RENDER_S3_BUCKET',
  'FILEBASE_S3_ENDPOINT',
  'FILEBASE_BUCKET',
  'FILEBASE_ACCESS_KEY_ID',
  'FILEBASE_SECRET_ACCESS_KEY',
  'RENDER_QUEUE_URL',
] as const

/** A required value. The error names the variable and never a value. */
export function need(env: Env, name: string): string {
  const value = env[name]
  if (!value) throw new Error(`${name} is not set.`)
  return value
}

// The SDK's default checksums add headers that Supabase Storage and Filebase do not all accept; the
// web app's storage client turns them off the same way (apps/web/src/lib/storage/config.ts).
const CHECKSUMS = {
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
} as const

/**
 * The art bucket's client options. With no access key the SDK's default credentials apply, which on
 * Lambda is the function's role; locally the keys of Supabase Storage are set.
 */
export function artS3Options(env: Env): S3ClientConfig {
  const accessKeyId = env.ART_S3_ACCESS_KEY_ID
  const secretAccessKey = env.ART_S3_SECRET_ACCESS_KEY
  return {
    region: need(env, 'ART_S3_REGION'),
    ...(env.ART_S3_ENDPOINT ? { endpoint: env.ART_S3_ENDPOINT } : {}),
    forcePathStyle: env.ART_S3_FORCE_PATH_STYLE === '1',
    ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
    ...CHECKSUMS,
  }
}

export function filebaseS3Options(env: Env): S3ClientConfig {
  return {
    region: 'us-east-1',
    endpoint: env.FILEBASE_S3_ENDPOINT || FILEBASE_ENDPOINT,
    forcePathStyle: true,
    credentials: {
      accessKeyId: need(env, 'FILEBASE_ACCESS_KEY_ID'),
      secretAccessKey: need(env, 'FILEBASE_SECRET_ACCESS_KEY'),
    },
    ...CHECKSUMS,
  }
}

/** The service-role client the worker owns. No session is kept. */
export function workerClient(env: Env): WorkerClient {
  return createClient(need(env, 'SUPABASE_URL'), need(env, 'SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

/** Every port on its production adapter. Building it opens no connection. */
export function productionDeps(env: Env, log: Log = consoleLog): Deps {
  const art = new S3Client(artS3Options(env))
  // With an endpoint set (Supabase Storage, locally) both buckets live behind the art client. On
  // AWS the render bucket is the stack's own, reached with the function's role in its own region.
  const render = env.ART_S3_ENDPOINT ? art : new S3Client({ ...CHECKSUMS })
  return {
    jobs: supabaseJobs(workerClient(env)),
    store: s3Store(
      { client: art, bucket: need(env, 'ART_S3_BUCKET') },
      { client: render, bucket: need(env, 'RENDER_S3_BUCKET') },
    ),
    pinner: filebasePinner(new S3Client(filebaseS3Options(env)), need(env, 'FILEBASE_BUCKET')),
    chain: viemChain(env),
    queue: sqsRenderQueue(new SQSClient({}), need(env, 'RENDER_QUEUE_URL')),
    log,
  }
}
```

- [ ] **Step 8: Write the Lambda entry points**

Create `services/worker/src/lambda/handler.ts`:

```ts
import { parseRenderMessage } from '@cobweb/shared/render-queue'
import type { RenderMessage } from '@cobweb/shared/render-queue'
import type { SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from 'aws-lambda'
import { consoleLog, errorSummary } from '../log.ts'
import type { Log } from '../log.ts'
import type { Deps } from '../steps.ts'

/**
 * An SQS handler around one of the worker's entry points. A body that is not a render message is
 * logged and acknowledged, never retried. A message whose run throws is reported as a partial batch
 * failure, so SQS redelivers that message alone.
 */
export function sqsHandler(
  getDeps: () => Promise<Deps>,
  run: (message: RenderMessage, deps: Deps) => Promise<void>,
  log: Log = consoleLog,
): (event: SQSEvent) => Promise<SQSBatchResponse> {
  return async (event) => {
    const batchItemFailures: SQSBatchItemFailure[] = []
    for (const record of event.Records) {
      const message = parseRenderMessage(record.body)
      if (!message) {
        log('message ignored', { messageId: record.messageId })
        continue
      }
      try {
        await run(message, await getDeps())
      } catch (error) {
        log('message failed', {
          messageId: record.messageId,
          jobId: message.jobId,
          step: message.step,
          error: errorSummary(error),
        })
        batchItemFailures.push({ itemIdentifier: record.messageId })
      }
    }
    return { batchItemFailures }
  }
}
```

Create `services/worker/src/lambda/deps.ts`:

```ts
/**
 * The Lambda side of configuration: the stack sets plain values as environment variables and the
 * ARN of one Secrets Manager secret, read once per container at cold start. The secret is a JSON
 * object of text values (infra/README.md lists its keys); it is merged over the environment and
 * never logged.
 */
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager'
import { productionDeps } from '../env.ts'
import type { Deps } from '../steps.ts'

export function parseSecret(text: string | undefined): Record<string, string> {
  const unreadable = () => new Error('The render secret is not a JSON object of text values.')
  let value: unknown
  try {
    value = JSON.parse(text ?? '')
  } catch {
    throw unreadable()
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw unreadable()
  const entries = Object.entries(value)
  if (entries.some(([, entry]) => typeof entry !== 'string')) throw unreadable()
  return Object.fromEntries(entries) as Record<string, string>
}

async function build(): Promise<Deps> {
  const arn = process.env.RENDER_SECRET_ARN
  if (!arn) throw new Error('RENDER_SECRET_ARN is not set.')
  const found = await new SecretsManagerClient({}).send(new GetSecretValueCommand({ SecretId: arn }))
  return productionDeps({ ...process.env, ...parseSecret(found.SecretString) })
}

let cached: Promise<Deps> | null = null

/** The production ports, built once per container. A failed build is tried again on the next message. */
export function loadDeps(): Promise<Deps> {
  cached ??= build().catch((error: unknown) => {
    cached = null
    throw error
  })
  return cached
}
```

Create `services/worker/src/lambda/render.ts`:

```ts
// RenderFunction: one message from RenderQueue a call (batch size 1).
import { handle } from '../steps.ts'
import { loadDeps } from './deps.ts'
import { sqsHandler } from './handler.ts'

export const handler = sqsHandler(loadDeps, handle)
```

Create `services/worker/src/lambda/dead.ts`:

```ts
// DeadLetterFunction: a message RenderQueue gave up on after three receives fails its job.
import { handleDead } from '../steps.ts'
import { loadDeps } from './deps.ts'
import { sqsHandler } from './handler.ts'

export const handler = sqsHandler(loadDeps, handleDead)
```

Create `services/worker/src/lambda/sweep.ts`:

```ts
// SweepFunction: every 15 minutes, re-enqueue jobs left rendering or finalizing with nothing moving.
import { sweep } from '../steps.ts'
import { loadDeps } from './deps.ts'

export async function handler(): Promise<void> {
  await sweep(await loadDeps())
}
```

- [ ] **Step 9: Write the package index**

Create `services/worker/src/index.ts`:

```ts
export * from './ports.ts'
export { consoleLog, errorSummary } from './log.ts'
export type { Log } from './log.ts'
export { imageRef, renderSpec, tokenSlice } from './spec.ts'
export {
  CID_MISMATCH,
  DEAD_LETTER,
  handle,
  handleDead,
  PAYMENT_MISMATCH,
  RESULT_DIFFERS,
  sweep,
  SWEEP_MINUTES,
} from './steps.ts'
export type { Deps } from './steps.ts'
export { supabaseJobs } from './adapters/supabase-jobs.ts'
export type { WorkerClient } from './adapters/supabase-jobs.ts'
export { s3Store } from './adapters/s3-store.ts'
export { viemChain } from './adapters/viem-chain.ts'
export { filebasePinner } from './adapters/filebase.ts'
export { sqsRenderQueue } from './adapters/sqs.ts'
export { artS3Options, productionDeps, WORKER_ENV, workerClient } from './env.ts'
```

- [ ] **Step 10: Run the tests to see them pass**

Run: `pnpm --filter @cobweb/worker test`
Expected: PASS, 12 files, 158 tests.

- [ ] **Step 11: Check that no secret can reach a log or a browser**

Run: `grep -rn "process\.env" services/worker/src`
Expected: exactly two lines, both in `services/worker/src/lambda/deps.ts` (the secret's ARN, and the environment handed to `productionDeps`).

Run: `grep -rn "console\." services/worker/src`
Expected: exactly one line, in `services/worker/src/log.ts`.

- [ ] **Step 12: Format, run the root checks and commit**

Run: `pnpm exec prettier --write services/worker/src`

Run at the repo root: `pnpm typecheck && pnpm lint && pnpm test`
Expected: every Turborepo task succeeds.

```bash
git add services/worker/src \
  services/worker/.env.example
git commit -m "Add the Filebase and SQS adapters, the production wiring and the Lambda entry points" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bcHX4HZG5YGWhxjGuiWos"
```

---

### Task 10: The local render bucket and `verify:render`, checks 1 to 5

**Files:**

- Create: `apps/web/scripts/verify-render.ts`
- Modify: `apps/web/package.json` (one script, one dev dependency)
- Modify: `supabase/config.toml` (the `render` bucket, after the `art` bucket)
- Modify: `pnpm-lock.yaml` (by `pnpm install`)

**Interfaces:**

- Consumes: `enqueueRender`, `factoryAbi`, `isLocalUrl` from `@cobweb/shared`; `supabaseJobs`, `s3Store`, `viemChain`, `artS3Options`, `sweep`, `SENTENCES`, the sentence constants and the `Deps` and `Pinner` types from `@cobweb/worker` (Task 9); `runLocal`, `memoryQueue`, `folderPinner`, `failingPinner`, `wrongCidPinner`, `flatPng` and the `MemoryQueue` type from `@cobweb/worker/local` (Task 7); `lockCore`, `confirmCore`, `LockContext`, `LockOutcome` from `apps/web/src/lib/art/lock-core.ts`; `readLockCollection` from `lock-collection.ts`; the sentence constants in `apps/web/src/lib/art/result.ts`; the database functions `record_upload` and `art_render_retry`.
- Produces: the command `pnpm --filter @cobweb/web verify:render`; inside the script, helpers Task 11 reuses: `check`, `seededProject(client, label, wrongSize?)`, `newCollection(client, label)`, `upload(client, cid, kind, png, fileName, declared?)`, `contextFor`, `lockedAndPaid(creator, cid, short?)`, `depsFor(queue, pinner)`, `render(jobId, deps, retries?)`, `jobRow`, `batchRows`, `statusOf`, `cidsOf`, `doneProblem`, `refusal`, `pins`, `CID`, `creator`.

Spec section 8. Decision 19 applies. The script runs the production adapters for the database (`supabaseJobs` on the service client), storage (`s3Store` on Supabase Storage's S3 protocol) and the chain (`viemChain` on Anvil), with `folderPinner` for the pinning service and `memoryQueue` for SQS. It refuses any endpoint that is not local and deletes every object, job, collection and user it creates. Each check seeds its own project: five tokens over three layers of two traits, 64 by 64, the same every time, so two renders can be compared CID for CID.

Before this task: `supabase start` at the repo root, and Anvil with the factory (`pnpm --filter @cobweb/web chain:local`, its two lines in `apps/web/.env.local`). Run `pnpm --filter @cobweb/web verify:chain` once to confirm the stack is healthy; expected: all its checks pass.

- [ ] **Step 1: Add the command and the dependency**

In `apps/web/package.json`, add to `scripts`, after `verify:sweep`:

```json
{
  "scripts": {
    "verify:render": "node --conditions=react-server --import ./scripts/resolve-ts.mjs scripts/verify-render.ts"
  }
}
```

and add to `devDependencies` (keep the keys in alphabetical order):

```json
{
  "devDependencies": {
    "@cobweb/worker": "workspace:^"
  }
}
```

Run at the repo root: `pnpm install`

- [ ] **Step 2: Write the script with its setup, checks 1 to 5 and the cleanup**

Create `apps/web/scripts/verify-render.ts`:

```ts
// Checks the render worker end to end against LOCAL Supabase, LOCAL storage and a LOCAL Anvil chain
// (docs/specs/2026-10-12-render-worker.md, section 8): a signed-in creator's generative project with
// drawn layers is locked and paid on Anvil, then the local runner takes the job through the same
// steps the Lambdas run, on the production adapters for the database, storage and the chain, with a
// folder standing in for the pinning service and a queue in memory. Ten checks: the full run,
// duplicate delivery, a pin that fails once, a pin that always fails and the retry after it, identical
// CIDs for identical input, a short payment, a wrong CID, a layer of the wrong size, the sweep and a
// placeholder job.
//
//   supabase start && supabase seed buckets
//   pnpm --filter @cobweb/web chain:local    (then copy its two lines into apps/web/.env.local)
//   pnpm --filter @cobweb/web verify:render
//
// Supabase and storage settings come from the environment or `supabase status -o env`; RPC_URL_31337
// and FACTORY_ADDRESS_31337 from the environment or apps/web/.env.local. Refuses non-local endpoints.
// Never prints a key. Deletes every row and object it creates. Runs under
// `node --conditions=react-server --import ./scripts/resolve-ts.mjs`.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DeleteObjectsCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { createClient } from '@supabase/supabase-js'
import {
  createTestClient,
  createWalletClient,
  getAddress,
  http,
  parseEther,
  publicActions,
  type Hex,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'
import { anvil } from 'viem/chains'
import { createSiweMessage, generateSiweNonce } from 'viem/siwe'
import type { Database } from '../src/lib/database.types.ts'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../../..')

// The two chain settings from apps/web/.env.local when the environment does not set them.
const envFile = resolve(here, '../.env.local')
if (existsSync(envFile))
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const [, name, value] = line.match(/^(RPC_URL_31337|FACTORY_ADDRESS_31337)=(.*)$/) ?? []
    if (name && value && process.env[name] === undefined) process.env[name] = value.trim()
  }

let statusCache: Record<string, string> | null = null
function supabaseStatus(): Record<string, string> {
  if (statusCache) return statusCache
  const out = execFileSync('supabase', ['status', '-o', 'env'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  statusCache = {}
  for (const line of out.split('\n')) {
    const [, name, value] = line.match(/^([A-Z0-9_]+)=(.*)$/) ?? []
    if (name && value !== undefined) statusCache[name] = value.replace(/^"(.*)"$/, '$1')
  }
  return statusCache
}

function config(envName: string, statusNames: string[], fallback?: string): string {
  const fromEnv = process.env[envName]
  if (fromEnv) return fromEnv
  const status = supabaseStatus()
  for (const name of statusNames) if (status[name]) return status[name]
  if (fallback !== undefined) return fallback
  throw new Error(`${envName} is unset and \`supabase status\` did not report ${statusNames.join(' or ')}`)
}

const { factoryAbi, isLocalUrl, enqueueRender } = await import('@cobweb/shared')

const url = config('NEXT_PUBLIC_SUPABASE_URL', ['API_URL'])
const publishableKey = config('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', ['PUBLISHABLE_KEY', 'ANON_KEY'])
const serviceKey = config('SUPABASE_SERVICE_ROLE_KEY', ['SERVICE_ROLE_KEY', 'SECRET_KEY'])
const storage = {
  ART_S3_ENDPOINT: config('ART_S3_ENDPOINT', ['STORAGE_S3_URL']),
  ART_S3_REGION: config('ART_S3_REGION', ['S3_PROTOCOL_REGION'], 'local'),
  ART_S3_ACCESS_KEY_ID: config('ART_S3_ACCESS_KEY_ID', ['S3_PROTOCOL_ACCESS_KEY_ID']),
  ART_S3_SECRET_ACCESS_KEY: config('ART_S3_SECRET_ACCESS_KEY', ['S3_PROTOCOL_ACCESS_KEY_SECRET']),
  ART_S3_FORCE_PATH_STYLE: '1',
}
const ART_BUCKET = config('ART_S3_BUCKET', [], 'art')
const RENDER_BUCKET = config('RENDER_S3_BUCKET', [], 'render')
const rpc = process.env.RPC_URL_31337
const factoryEnv = process.env.FACTORY_ADDRESS_31337
if (!rpc || !factoryEnv) {
  console.error(
    'Set RPC_URL_31337 and FACTORY_ADDRESS_31337: run `pnpm --filter @cobweb/web chain:local` and copy its two lines into apps/web/.env.local.',
  )
  process.exit(2)
}
for (const endpoint of [url, rpc, storage.ART_S3_ENDPOINT])
  if (!isLocalUrl(endpoint)) {
    console.error(`Refusing to run: ${endpoint} is not local (expected localhost or 127.0.0.1).`)
    process.exit(2)
  }
const factory = getAddress(factoryEnv)

// Imported after the environment is set, so the shared clients read the local chain settings.
const { confirmCore, lockCore } = await import('../src/lib/art/lock-core.ts')
const { readLockCollection } = await import('../src/lib/art/lock-collection.ts')
const web = await import('../src/lib/art/result.ts')
const worker = await import('@cobweb/worker')
const local = await import('@cobweb/worker/local')
type LockContext = import('../src/lib/art/lock-core.ts').LockContext
type LockOutcome<T> = import('../src/lib/art/lock-core.ts').LockOutcome<T>
type Deps = import('@cobweb/worker').Deps
type Pinner = import('@cobweb/worker').Pinner
type MemoryQueue = import('@cobweb/worker/local').MemoryQueue

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
type Client = ReturnType<typeof createClient<Database>>
const admin: Client = createClient<Database>(url, serviceKey, clientOptions)
const chain = createTestClient({ chain: anvil, mode: 'anvil', transport: http(rpc) }).extend(publicActions)
const s3 = new S3Client(worker.artS3Options(storage))
const pins = mkdtempSync(join(tmpdir(), 'cobweb-verify-render-'))
const CID = /^[a-z2-7]{59}$/

let passed = 0
const failed: string[] = []
async function check(name: string, fn: () => Promise<string | null>): Promise<void> {
  let problem: string | null
  try {
    problem = await fn()
  } catch (e) {
    problem = `threw ${e instanceof Error ? e.message : String(e)}`
  }
  if (problem === null) {
    passed++
    console.log(`PASS ${name}`)
  } else {
    failed.push(name)
    console.log(`FAIL ${name}: ${problem}`)
  }
}

const userIds: string[] = []
const collectionIds: string[] = []
const artKeys: string[] = []

async function signIn(account: PrivateKeyAccount) {
  const client: Client = createClient<Database>(url, publishableKey, clientOptions)
  const message = createSiweMessage({
    address: account.address,
    chainId: 1,
    domain: 'localhost:3000',
    nonce: generateSiweNonce(),
    uri: 'http://localhost:3000',
    version: '1',
    statement: 'Sign in to Cobweb.',
    issuedAt: new Date(),
  })
  const signature = await account.signMessage({ message })
  const { data, error } = await client.auth.signInWithWeb3({ chain: 'ethereum', message, signature })
  if (error || !data.user) throw new Error(`sign-in failed: ${error?.message ?? 'no user'}`)
  userIds.push(data.user.id)
  return { client, userId: data.user.id }
}

/** Stores a drawn PNG in the art bucket under an upload key and records it as the creator would. */
async function upload(
  client: Client,
  cid: string,
  kind: 'layer_image' | 'placeholder',
  png: Uint8Array,
  fileName: string,
  declared = 64,
): Promise<string> {
  const hash = createHash('sha256').update(png).digest('hex')
  const key = `${cid}/${kind === 'layer_image' ? 'layers' : 'placeholders'}/${hash}.png`
  await s3.send(new PutObjectCommand({ Bucket: ART_BUCKET, Key: key, Body: png, ContentType: 'image/png' }))
  artKeys.push(key)
  const recorded = await client.rpc('record_upload', {
    p_collection_id: cid,
    p_kind: kind,
    p_storage_key: key,
    p_content_hash: hash,
    p_mime: 'image/png',
    p_media_type: 'image',
    p_bytes: png.byteLength,
    p_width: declared,
    p_height: declared,
    p_file_name: fileName,
  })
  if (recorded.error) throw new Error(`upload: ${recorded.error.message}`)
  return recorded.data as string
}

async function newCollection(client: Client, label: string): Promise<string> {
  const { data, error } = await client
    .from('collections')
    .insert({ name: `Render check ${label} ${Date.now()}`, symbol: 'RND', project_type: 'generative' })
    .select('id')
    .single()
  if (error || !data) throw new Error(`collection: ${error?.message ?? 'no row'}`)
  collectionIds.push(data.id)
  return data.id
}

const LAYERS = [
  {
    name: 'Background',
    traits: [
      { r: 20, g: 20, b: 60, alpha: 1 },
      { r: 200, g: 120, b: 60, alpha: 1 },
    ],
  },
  {
    name: 'Body',
    traits: [
      { r: 240, g: 240, b: 240, alpha: 0.5 },
      { r: 90, g: 60, b: 30, alpha: 0.5 },
    ],
  },
  {
    name: 'Eyes',
    traits: [
      { r: 255, g: 255, b: 0, alpha: 0.5 },
      { r: 0, g: 255, b: 255, alpha: 0.5 },
    ],
  },
]
const TOKENS = 5

/**
 * A generative project of five tokens over three layers of two traits, 64 by 64, owned by the
 * client's creator, its layer images drawn and stored. The same every time, so two of them render
 * to identical CIDs. `wrongSize` stores one Eyes image at 32 by 32 while recording it as 64 by 64.
 */
async function seededProject(client: Client, label: string, wrongSize = false): Promise<string> {
  const cid = await newCollection(client, label)
  const named = await client
    .from('collections')
    .update({ token_name: 'Owl', token_description: 'A night owl.' })
    .eq('id', cid)
  if (named.error) throw new Error(`collection text: ${named.error.message}`)
  const art = await client
    .from('art_collections')
    .insert({ collection_id: cid, name: 'Owls', size: TOKENS, position: 0 })
    .select('id')
    .single()
  if (art.error || !art.data) throw new Error(`art collection: ${art.error?.message ?? 'no row'}`)
  const traits: string[][] = []
  for (const [position, layer] of LAYERS.entries()) {
    const row = await client
      .from('layers')
      .insert({ collection_id: cid, art_collection_id: art.data.id, name: layer.name, position })
      .select('id')
      .single()
    if (row.error || !row.data) throw new Error(`layer: ${row.error?.message ?? 'no row'}`)
    const ids: string[] = []
    for (const [index, colour] of layer.traits.entries()) {
      const small = wrongSize && layer.name === 'Eyes' && index === 1
      const png = await local.flatPng(colour, small ? 32 : 64)
      const name = index === 0 ? 'One' : 'Two'
      const uploadId = await upload(client, cid, 'layer_image', png, `${layer.name} ${name}.png`)
      const trait = await client
        .from('traits')
        .insert({
          collection_id: cid,
          layer_id: row.data.id,
          name,
          weight: 50,
          position: index,
          upload_id: uploadId,
        })
        .select('id')
        .single()
      if (trait.error || !trait.data) throw new Error(`trait: ${trait.error?.message ?? 'no row'}`)
      ids.push(trait.data.id)
    }
    traits.push(ids)
  }
  // Token n takes the bits of n - 1 as its picks, so the five tokens differ and every trait is used.
  const tokens = await client.from('tokens').insert(
    Array.from({ length: TOKENS }, (_, n) => ({
      collection_id: cid,
      token_id: n + 1,
      art_collection_id: art.data.id,
      dna: traits.map((ids, layer) => ids[(n >> layer) & 1]!),
    })),
  )
  if (tokens.error) throw new Error(`tokens: ${tokens.error.message}`)
  return cid
}

/** The context `lockWrite` builds: the creator's RLS client, the service client, the owner's id. */
async function contextFor(client: Client, owner: string, wallet: string, cid: string): Promise<LockContext> {
  const collection = await readLockCollection(client, cid)
  if (!collection || collection.owner_id !== owner) throw new Error('the creator cannot read the collection')
  return { supabase: client, service: () => admin, owner, wallet: wallet.toLowerCase(), collection }
}

const refusal = <T>(outcome: LockOutcome<T>) =>
  'refused' in outcome ? outcome.refused : 'error' in outcome ? `db ${outcome.error?.code}` : 'accepted'

async function pay(account: PrivateKeyAccount, jobId: Hex, value: bigint): Promise<Hex> {
  const wallet = createWalletClient({ account, chain: anvil, transport: http(rpc) })
  const hash = await wallet.writeContract({
    address: factory,
    abi: factoryAbi,
    functionName: 'payForArt',
    args: [jobId],
    value,
  })
  const receipt = await chain.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`payForArt reverted: ${hash}`)
  return hash
}

type Creator = { client: Client; userId: string; account: PrivateKeyAccount }

/**
 * Locks a seeded project and pays for it on Anvil through the cores the server actions run, then
 * sets a batch size of 2 with the service client so five tokens make three batches. `short` pays 1
 * wei less and marks the job paid by hand: the state a server bug would leave, which the worker's
 * own payment check must catch.
 */
async function lockedAndPaid(creator: Creator, cid: string, short = false): Promise<string> {
  const ctx = await contextFor(creator.client, creator.userId, creator.account.address, cid)
  const locked = await lockCore(ctx, { allowDuplicates: false, chainId: 31337 })
  if (!('data' in locked)) throw new Error(`lock: ${refusal(locked)}`)
  const job = locked.data
  if (job.state !== 'payment_due') throw new Error(`lock left the job ${job.state}`)
  const total = BigInt(job.quote.totalWei)
  if (short) {
    const hash = await pay(creator.account, job.jobId, total - 1n)
    const forced = await admin
      .from('render_jobs')
      .update({ state: 'paid', payment_tx_hash: hash.toLowerCase(), paid_at: new Date().toISOString() })
      .eq('id', job.id)
    if (forced.error) throw new Error(`force paid: ${forced.error.message}`)
  } else {
    const confirmed = await confirmCore(ctx, job.id, await pay(creator.account, job.jobId, total))
    if (!('data' in confirmed)) throw new Error(`confirm: ${refusal(confirmed)}`)
    if (confirmed.data.state !== 'paid') throw new Error(`confirm left the job ${confirmed.data.state}`)
  }
  const sized = await admin.from('render_jobs').update({ batch_size: 2, batches_total: 3 }).eq('id', job.id)
  if (sized.error) throw new Error(`batch size: ${sized.error.message}`)
  return job.id
}

const logLines: string[] = []

/** The worker's ports: the production adapters for the database, storage and the chain; local doubles for the rest. */
function depsFor(queue: MemoryQueue, pinner: Pinner): Deps & { queue: MemoryQueue } {
  return {
    jobs: worker.supabaseJobs(admin),
    store: worker.s3Store({ client: s3, bucket: ART_BUCKET }, { client: s3, bucket: RENDER_BUCKET }),
    chain: worker.viemChain(process.env),
    pinner,
    queue,
    log: (event, fields = {}) => void logLines.push(`${event} ${JSON.stringify(fields)}`),
  }
}

/** Enqueues the job's start message and drains the queue, as SQS and the Lambdas would. */
async function render(jobId: string, deps: Deps & { queue: MemoryQueue }, retries = 0) {
  await enqueueRender(deps.queue, { id: jobId, retries })
  return local.runLocal(deps)
}

async function jobRow(jobId: string) {
  const { data, error } = await admin
    .from('render_jobs')
    .select(
      'state, error, error_code, metadata_cid, base_uri, collage_key, placeholder_image_cid, batches_done, retries, started_at',
    )
    .eq('id', jobId)
    .single()
  if (error) throw new Error(`job: ${error.message}`)
  return data
}

async function batchRows(jobId: string) {
  const { data, error } = await admin
    .from('render_batches')
    .select('index, state, attempts, images_cid')
    .eq('job_id', jobId)
    .order('index')
  if (error) throw new Error(`batches: ${error.message}`)
  return data
}

async function statusOf(cid: string): Promise<string> {
  const { data, error } = await admin.from('collections').select('status').eq('id', cid).single()
  if (error) throw new Error(`collection: ${error.message}`)
  return data.status
}

/** What a finished job's CIDs are, for comparing two renders. */
async function cidsOf(jobId: string): Promise<string> {
  const job = await jobRow(jobId)
  const batches = await batchRows(jobId)
  return JSON.stringify([batches.map((batch) => batch.images_cid), job.metadata_cid])
}

/** Null when the job is done with three batch CIDs, a metadata CID and its base URI; else what is wrong. */
async function doneProblem(jobId: string): Promise<string | null> {
  const job = await jobRow(jobId)
  const batches = await batchRows(jobId)
  if (job.state !== 'done') return `state ${job.state} (${job.error_code}: ${job.error})`
  const cids = batches.map((batch) => batch.images_cid ?? '')
  if (batches.length !== 3 || batches.some((batch) => batch.state !== 'done')) return JSON.stringify(batches)
  if (!cids.every((cid) => CID.test(cid)) || new Set(cids).size !== 3) return `batch CIDs ${cids.join(', ')}`
  if (!CID.test(job.metadata_cid ?? '')) return `metadata CID ${job.metadata_cid}`
  if (job.base_uri !== `ipfs://${job.metadata_cid}/`) return `base URI ${job.base_uri}`
  return job.batches_done === 3 ? null : `batches_done ${job.batches_done}`
}

async function main(): Promise<void> {
  console.log(`Verifying the render worker on ${rpc} against ${url}`)
  await check('setup: Anvil answers, the factory has code, and the render bucket exists', async () => {
    if ((await chain.getChainId()) !== 31337) return 'not chain 31337'
    const code = await chain.getCode({ address: factory })
    if (!code || code === '0x') return `no contract at ${factory}; run chain:local again`
    try {
      await s3.send(new HeadBucketCommand({ Bucket: RENDER_BUCKET }))
    } catch {
      return `no "${RENDER_BUCKET}" bucket in local storage; run \`supabase seed buckets\``
    }
    return null
  })

  await check('setup: the worker reads the same sentences the web app shows', async () => {
    const pairs: [string, string][] = [
      [worker.SENTENCES.JOB_NOT_READY, web.JOB_NOT_READY],
      [worker.SENTENCES.BATCH_COUNT_MISMATCH, web.BATCH_COUNT_MISMATCH],
      [worker.SENTENCES.JOB_NOT_RENDERING, web.JOB_NOT_RENDERING],
      [worker.SENTENCES.NO_SUCH_BATCH, web.NO_SUCH_BATCH],
      [worker.SENTENCES.BATCH_RESULT_DIFFERS, web.BATCH_RESULT_DIFFERS],
      [worker.SENTENCES.BATCH_ALREADY_DONE, web.BATCH_ALREADY_DONE],
      [worker.SENTENCES.JOB_RESULT_DIFFERS, web.JOB_RESULT_DIFFERS],
      [worker.SENTENCES.BATCHES_STILL_RENDERING, web.BATCHES_STILL_RENDERING],
      [worker.SENTENCES.JOB_FAILURE_NEEDS_FINAL, web.JOB_FAILURE_NEEDS_FINAL],
    ]
    const wrong = pairs.find(([mine, theirs]) => mine !== theirs)
    return wrong ? `"${wrong[0]}" is not "${wrong[1]}"` : null
  })

  const account = privateKeyToAccount(generatePrivateKey())
  await chain.setBalance({ address: account.address, value: parseEther('10') })
  const creator: Creator = { ...(await signIn(account)), account }

  // 1. The full run.
  const firstCid = await seededProject(creator.client, 'one')
  const firstJob = await lockedAndPaid(creator, firstCid)
  await check('1. the runner takes a paid job to done: batch CIDs, metadata, base URI, collage', async () => {
    const pinner = local.folderPinner(pins)
    const run = await render(firstJob, depsFor(local.memoryQueue(), pinner))
    if (run.thrown || run.dead) return `the run had failures: ${JSON.stringify(run)}`
    const problem = await doneProblem(firstJob)
    if (problem) return problem
    const job = await jobRow(firstJob)
    const key = `${firstCid}/collage/${firstJob}.png`
    if (job.collage_key !== key) return `collage key ${job.collage_key}`
    const head = await s3.send(new HeadObjectCommand({ Bucket: RENDER_BUCKET, Key: key }))
    if (head.ContentType !== 'image/png' || !head.ContentLength) return 'the collage is not a PNG object'
    if (!existsSync(join(pins, `${job.metadata_cid}.car`))) return 'the metadata CAR was not pinned'
    if (pinner.pinned.length !== 4) return `pinned ${pinner.pinned.length} CARs, expected 4`
    const status = await statusOf(firstCid)
    return status === 'rendered' ? null : `collection ${status}`
  })

  // 2. Duplicate delivery.
  await check('2. with every message delivered twice, the final state is the same', async () => {
    const cid = await seededProject(creator.client, 'two')
    const jobId = await lockedAndPaid(creator, cid)
    const run = await render(jobId, depsFor(local.memoryQueue({ copies: 2 }), local.folderPinner(pins)))
    if (run.thrown || run.dead) return `the run had failures: ${JSON.stringify(run)}`
    const problem = await doneProblem(jobId)
    if (problem) return problem
    if ((await batchRows(jobId)).some((batch) => batch.attempts < 1)) return 'a batch was never started'
    return (await cidsOf(jobId)) === (await cidsOf(firstJob)) ? null : 'the CIDs differ from the single run'
  })

  // 3. A pin that fails once.
  await check(
    '3. a pin that fails once on one batch: the batch is redelivered and the job finishes',
    async () => {
      const cid = await seededProject(creator.client, 'three')
      const jobId = await lockedAndPaid(creator, cid)
      const pinner = local.failingPinner(local.folderPinner(pins), { nth: 1, times: 1 })
      const run = await render(jobId, depsFor(local.memoryQueue(), pinner))
      if (pinner.failures !== 1 || run.thrown !== 1 || run.dead !== 0) return JSON.stringify({ run, pinner })
      const problem = await doneProblem(jobId)
      if (problem) return problem
      const attempts = (await batchRows(jobId)).map((batch) => batch.attempts)
      return JSON.stringify(attempts) === '[1,2,1]' ? null : `attempts ${JSON.stringify(attempts)}`
    },
  )

  // 4. A pin that always fails, then the creator's retry.
  await check(
    '4. a pin that always fails: dead-letter, then the retry renders only the failed batch',
    async () => {
      const cid = await seededProject(creator.client, 'four')
      const jobId = await lockedAndPaid(creator, cid)
      const failing = local.failingPinner(local.folderPinner(pins), { nth: 1, times: Infinity })
      const run = await render(jobId, depsFor(local.memoryQueue(), failing))
      if (run.dead !== 1 || run.thrown !== 3) return `run ${JSON.stringify(run)}`
      const failedJob = await jobRow(jobId)
      if (failedJob.state !== 'failed' || failedJob.error_code !== 'dead-letter')
        return `after the dead letter: ${JSON.stringify(failedJob)}`
      if (failedJob.error !== worker.DEAD_LETTER) return `error "${failedJob.error}"`
      const states = (await batchRows(jobId)).map((batch) => batch.state)
      if (JSON.stringify(states) !== '["done","failed","done"]') return `batches ${JSON.stringify(states)}`
      if ((await statusOf(cid)) !== 'art_locked') return `collection ${await statusOf(cid)}`

      const retried = await creator.client.rpc('art_render_retry', { p_collection_id: cid })
      if (retried.error) return `retry: ${retried.error.message}`
      const pinner = local.folderPinner(pins)
      const again = await render(jobId, depsFor(local.memoryQueue(), pinner), retried.data.retries)
      if (again.thrown || again.dead) return `the retry had failures: ${JSON.stringify(again)}`
      const problem = await doneProblem(jobId)
      if (problem) return problem
      // The failed batch and the metadata set: the two finished batches are not rendered again.
      if (pinner.pinned.length !== 2) return `the retry pinned ${pinner.pinned.length} CARs, expected 2`
      return (await jobRow(jobId)).retries === 1 ? null : 'retries is not 1'
    },
  )

  // 5. Determinism across projects.
  await check('5. a second project with the same input renders to identical CIDs', async () => {
    const cid = await seededProject(creator.client, 'five')
    const jobId = await lockedAndPaid(creator, cid)
    await render(jobId, depsFor(local.memoryQueue(), local.folderPinner(pins)))
    const problem = await doneProblem(jobId)
    if (problem) return problem
    const [mine, first] = [await cidsOf(jobId), await cidsOf(firstJob)]
    return mine === first ? null : `${mine} is not ${first}`
  })
}

async function deleteKeys(bucket: string, keys: string[]): Promise<string | null> {
  for (let at = 0; at < keys.length; at += 1000) {
    const result = await s3.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: keys.slice(at, at + 1000).map((Key) => ({ Key })) },
      }),
    )
    if (result.Errors?.length) return `${bucket}: ${result.Errors.length} object(s) could not be deleted`
  }
  return null
}

async function cleanup(): Promise<void> {
  await check('cleanup: the run leaves no object, job, collection or user behind', async () => {
    if (collectionIds.length) {
      const collages = await admin
        .from('render_jobs')
        .select('collage_key')
        .in('collection_id', collectionIds)
        .not('collage_key', 'is', null)
      if (collages.error) return `collages: ${collages.error.message}`
      const renderKeys = collages.data.flatMap((row) => (row.collage_key ? [row.collage_key] : []))
      const objects = (await deleteKeys(RENDER_BUCKET, renderKeys)) ?? (await deleteKeys(ART_BUCKET, artKeys))
      if (objects) return objects
      const jobs = await admin.from('render_jobs').delete().in('collection_id', collectionIds)
      if (jobs.error) return `jobs: ${jobs.error.message}`
      const cols = await admin.from('collections').delete().in('id', collectionIds)
      if (cols.error) return `collections: ${cols.error.message}`
    }
    for (const id of userIds) {
      const { error } = await admin.auth.admin.deleteUser(id)
      if (error) return error.message
    }
    rmSync(pins, { recursive: true, force: true })
    return null
  })
}

try {
  await main()
} catch (e) {
  failed.push('run')
  console.log(`FAIL run: ${e instanceof Error ? e.message : String(e)}`)
} finally {
  await cleanup()
}

if (failed.length) console.log(`\nThe worker's last log lines:\n${logLines.slice(-15).join('\n')}`)
console.log(`\n${passed} passed, ${failed.length} failed`)
process.exit(failed.length ? 1 : 0)
```

Run: `pnpm --filter @cobweb/web typecheck && pnpm --filter @cobweb/web lint`
Expected: both succeed.

- [ ] **Step 3: Run it to see it fail for want of the render bucket**

Run: `pnpm --filter @cobweb/web verify:render`
Expected: exactly two FAIL lines and "6 passed, 2 failed":

```
FAIL setup: Anvil answers, the factory has code, and the render bucket exists: no "render" bucket in local storage; run `supabase seed buckets`
FAIL 1. the runner takes a paid job to done: batch CIDs, metadata, base URI, collage: collage key null
```

The job in check 1 still finishes: a collage that cannot be written is skipped, never a failure. This is the first time the script runs (see Global Constraints). If any other check fails, the script prints the worker's last log lines: find the cause. A defect in the worker is fixed in `services/worker` with a unit test that fails first; a mistake in the script is fixed in the script. Never weaken a check to make it pass.

- [ ] **Step 4: Add the local render bucket**

In `supabase/config.toml`, add this block right after the `[storage.buckets.art]` block (before `# Allow connections via S3 compatible clients`):

```toml
# Preview collages the render worker writes (docs/specs/2026-10-12-render-worker.md). Private, PNG
# only, and apart from the `art` bucket so the upload sweep never sees worker output.
[storage.buckets.render]
public = false
file_size_limit = "50MiB"
allowed_mime_types = ["image/png"]
```

Run at the repo root: `supabase seed buckets`
Expected: it reports the `render` bucket created (the `art` bucket already exists). A restart alone does not create it.

- [ ] **Step 5: Run it three times to see it pass and stay stable**

Run, three times in a row: `pnpm --filter @cobweb/web verify:render`
Expected each time: eight PASS lines and "8 passed, 0 failed" (two setup checks, checks 1 to 5, the cleanup).

- [ ] **Step 6: Format, run the root checks and commit**

Run: `pnpm exec prettier --write apps/web/scripts/verify-render.ts apps/web/package.json`

Run at the repo root: `pnpm typecheck && pnpm lint && pnpm test`
Expected: every Turborepo task succeeds.

```bash
git add apps/web/scripts/verify-render.ts \
  apps/web/package.json \
  supabase/config.toml \
  pnpm-lock.yaml
git commit -m "Add the local render bucket and verify the render worker end to end" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bcHX4HZG5YGWhxjGuiWos"
```

---

### Task 11: `verify:render` checks 6 to 10 and the benchmark

**Files:**

- Modify: `apps/web/scripts/verify-render.ts` (one import line; five checks added at the end of `main`)
- Create: `services/worker/scripts/bench.ts`

**Interfaces:**

- Consumes: the helpers Task 10 defined in the script; `lockPlaceholderCore` from `apps/web/src/lib/art/lock-core.ts`; `PAYMENT_UNVERIFIED` from `result.ts`; `worker.PAYMENT_MISMATCH`, `worker.CID_MISMATCH`, `worker.sweep`, `worker.supabaseJobs` (Task 9); `renderBatch` and the spec types from `@cobweb/render`.
- Produces: the ten checks of spec section 8, and the command `pnpm --filter @cobweb/worker bench` (options `--tokens`, `--size`, `--layers`).

How each check reaches its state:

- Check 6: the lock and pay code never marks a short payment paid, so the script pays 1 wei less on Anvil and then sets the row to `paid` with the service client. That is the state a server bug would leave, and the worker's own check must catch it before the claim.
- Check 9: `render_jobs.updated_at` is kept by a trigger, so a job cannot be backdated. The script lets the metadata message get lost (`memoryQueue` with `drop`), then asks a second `supabaseJobs` whose clock is 16 minutes ahead which jobs are stuck, and filters the answer to its own job, so a job another developer left open in the local database is never touched.
- Check 10: a deferred collection locks a placeholder through `lockPlaceholderCore`; the job is `paid` with nothing to pay.

These checks exercise code built in Tasks 4 to 9, so they are expected to pass on their first run; there is no implementation step after them. If one fails, treat it as Task 10 Step 3 says.

- [ ] **Step 1: Add checks 6 to 10**

In `apps/web/scripts/verify-render.ts`, replace the line

```ts
const { confirmCore, lockCore } = await import('../src/lib/art/lock-core.ts')
```

with

```ts
const { confirmCore, lockCore, lockPlaceholderCore } = await import('../src/lib/art/lock-core.ts')
```

Then add the five checks at the end of `main`, after the closing `})` of check 5 and before the closing brace of `main`, indented like the checks above them:

```ts
// 6. A short payment.
await check(
  '6. a job whose payment is short on chain fails with payment-mismatch, never claimed',
  async () => {
    const cid = await seededProject(creator.client, 'six')
    const jobId = await lockedAndPaid(creator, cid, true)
    const pinner = local.folderPinner(pins)
    const run = await render(jobId, depsFor(local.memoryQueue(), pinner))
    if (run.thrown || run.dead) return `run ${JSON.stringify(run)}`
    const job = await jobRow(jobId)
    if (job.state !== 'failed' || job.error_code !== 'payment-mismatch') return JSON.stringify(job)
    if (job.error !== worker.PAYMENT_MISMATCH) return `error "${job.error}"`
    if (job.started_at !== null || (await batchRows(jobId)).length !== 0) return 'the job was claimed'
    if (pinner.pinned.length !== 0) return 'something was pinned'
    const retry = await creator.client.rpc('art_render_retry', { p_collection_id: cid })
    return retry.error?.message === web.PAYMENT_UNVERIFIED
      ? null
      : `retry: ${retry.error?.message ?? 'accepted'}`
  },
)

// 7. A wrong CID from the pinning service.
await check(
  '7. a pinning service that answers with another CID fails the job with cid-mismatch',
  async () => {
    const cid = await seededProject(creator.client, 'seven')
    const jobId = await lockedAndPaid(creator, cid)
    const run = await render(jobId, depsFor(local.memoryQueue(), local.wrongCidPinner()))
    if (run.thrown || run.dead) return `run ${JSON.stringify(run)}`
    const job = await jobRow(jobId)
    if (job.state !== 'failed' || job.error_code !== 'cid-mismatch') return JSON.stringify(job)
    if (job.error !== worker.CID_MISMATCH) return `error "${job.error}"`
    if ((await batchRows(jobId)).some((batch) => batch.state === 'done')) return 'a batch was recorded'
    return (await statusOf(cid)) === 'art_locked' ? null : `collection ${await statusOf(cid)}`
  },
)

// 8. A layer of the wrong size.
await check('8. a layer of the wrong size fails the job with layer-size and its sentence', async () => {
  const cid = await seededProject(creator.client, 'eight', true)
  const jobId = await lockedAndPaid(creator, cid)
  const run = await render(jobId, depsFor(local.memoryQueue(), local.folderPinner(pins)))
  if (run.thrown || run.dead) return `a bad layer was retried: ${JSON.stringify(run)}`
  const job = await jobRow(jobId)
  if (job.state !== 'failed' || job.error_code !== 'layer-size') return JSON.stringify(job)
  return job.error?.includes('is 32 by 32 pixels; the canvas is 64 by 64.') ? null : `error "${job.error}"`
})

// 9. The sweep.
await check('9. the sweep re-enqueues a job left finalizing and it finishes', async () => {
  const cid = await seededProject(creator.client, 'nine')
  const jobId = await lockedAndPaid(creator, cid)
  // The metadata message is lost, as after a crash between the last batch and the send.
  const lossy = local.memoryQueue({ drop: (message) => message.step === 'metadata' })
  await render(jobId, depsFor(lossy, local.folderPinner(pins)))
  if ((await jobRow(jobId)).state !== 'finalizing') return `before the sweep: ${(await jobRow(jobId)).state}`
  const deps = depsFor(local.memoryQueue(), local.folderPinner(pins))
  if ((await deps.jobs.stuck(15)).some((job) => job.id === jobId)) return 'stuck after no time at all'
  // The sweep's view 16 minutes from now, and only of this run's job: a job another developer left
  // open in the local database is not touched.
  const later = worker.supabaseJobs(admin, { now: () => Date.now() + 16 * 60_000 })
  const stuck = async (minutes: number) => (await later.stuck(minutes)).filter((job) => job.id === jobId)
  const swept = await worker.sweep({ ...deps, jobs: { ...deps.jobs, stuck } })
  if (swept !== 1) return `the sweep found ${swept} jobs`
  await local.runLocal(deps)
  return doneProblem(jobId)
})

// 10. A placeholder job.
await check(
  '10. a placeholder job on a deferred collection finishes with its slash-less base URI',
  async () => {
    const cid = await newCollection(creator.client, 'ten')
    const deferred = await creator.client.from('collections').update({ art_deferred: true }).eq('id', cid)
    if (deferred.error) return `defer: ${deferred.error.message}`
    const png = await local.flatPng({ r: 30, g: 30, b: 30, alpha: 1 })
    const uploadId = await upload(creator.client, cid, 'placeholder', png, 'Hidden.png')
    const ctx = await contextFor(creator.client, creator.userId, account.address, cid)
    const locked = await lockPlaceholderCore(ctx, uploadId)
    if (!('data' in locked)) return `lock: ${refusal(locked)}`
    const jobId = locked.data.id
    const run = await render(jobId, depsFor(local.memoryQueue(), local.folderPinner(pins)))
    if (run.thrown || run.dead) return `run ${JSON.stringify(run)}`
    const job = await jobRow(jobId)
    if (job.state !== 'done') return `state ${job.state} (${job.error_code}: ${job.error})`
    if (job.base_uri !== `ipfs://${job.metadata_cid}/metadata.json`) return `base URI ${job.base_uri}`
    if (!CID.test(job.placeholder_image_cid ?? '')) return `placeholder CID ${job.placeholder_image_cid}`
    const [batch] = await batchRows(jobId)
    if (batch?.images_cid !== job.placeholder_image_cid)
      return 'the batch CID is not the placeholder image CID'
    if (job.collage_key !== null) return 'a placeholder job has a collage'
    return (await statusOf(cid)) === 'draft' ? null : `collection ${await statusOf(cid)}`
  },
)
```

- [ ] **Step 2: Run it three times**

Run: `pnpm --filter @cobweb/web typecheck && pnpm --filter @cobweb/web lint`
Expected: both succeed.

Run, three times in a row: `pnpm --filter @cobweb/web verify:render`
Expected each time: thirteen PASS lines and "13 passed, 0 failed" (two setup checks, checks 1 to 10, the cleanup).

- [ ] **Step 3: Write the benchmark**

Create `services/worker/scripts/bench.ts`:

```ts
// Renders one batch in process and prints wall time, peak resident memory and CAR size
// (docs/specs/2026-10-12-render-worker.md, section 8). It is the local input to the Lambda settings
// in infra/lib/render-stack.ts (memory, timeout, ephemeral storage); the same run on Lambda itself is
// owed. Not a test: nothing asserts on its numbers.
//
//   pnpm --filter @cobweb/worker bench
//   options: --tokens <n> (default 100), --size <pixels> (default 2048), --layers <n> (default 7)
//
// Layer images are drawn here (no file is read or written): an opaque background layer and layers
// with a soft-edged disc on transparency, four traits a layer, so the PNGs compress about as real
// art does and every token composites every layer.

import { arch, cpus, platform } from 'node:os'
import { renderBatch } from '@cobweb/render'
import type { GenerativeSpec, GenerativeToken, ImageRef } from '@cobweb/render'
import sharp from 'sharp'

function option(name: string, fallback: number): number {
  const at = process.argv.indexOf(`--${name}`)
  const value = at === -1 ? fallback : Number(process.argv[at + 1])
  if (!Number.isInteger(value) || value < 1) {
    console.error(`--${name} takes a whole number above 0.`)
    process.exit(2)
  }
  return value
}

const TOKENS = option('tokens', 100)
const SIZE = option('size', 2048)
const LAYERS = option('layers', 7)
const TRAITS = 4

/** One layer image as PNG bytes: layer 0 is opaque, the others a disc that fades out at its edge. */
async function drawLayer(layer: number, trait: number): Promise<Uint8Array> {
  const pixels = new Uint8Array(SIZE * SIZE * 4)
  const centre = SIZE / 2
  const radius = (SIZE / 2) * (0.9 - layer * 0.08)
  const [r, g, b] = [
    (layer * 37 + trait * 61) % 256,
    (layer * 91 + trait * 17) % 256,
    (layer * 13 + trait * 113) % 256,
  ]
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const at = (y * SIZE + x) * 4
      const distance = Math.hypot(x - centre, y - centre)
      const shade = ((x >> 5) + (y >> 5)) % 2 ? 24 : 0
      pixels[at] = (r + shade) % 256
      pixels[at + 1] = (g + shade) % 256
      pixels[at + 2] = (b + shade) % 256
      pixels[at + 3] = layer === 0 ? 255 : Math.max(0, Math.min(255, Math.round((radius - distance) * 4)))
    }
  const png = await sharp(pixels, { raw: { width: SIZE, height: SIZE, channels: 4 } })
    .png()
    .toBuffer()
  return new Uint8Array(png)
}

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

console.log(`Drawing ${LAYERS} layers of ${TRAITS} traits at ${SIZE} by ${SIZE}...`)
const images = new Map<string, Uint8Array>()
const spec: GenerativeSpec = {
  kind: 'generative',
  canvas: SIZE,
  batchSize: TOKENS,
  text: { tokenName: 'Bench', tokenDescription: '', showBlankTraits: false, extraFields: {} },
  collections: [{ id: 'bench', layers: [] }],
}
let sourceBytes = 0
for (let layer = 0; layer < LAYERS; layer++) {
  const traits = []
  for (let trait = 0; trait < TRAITS; trait++) {
    const key = `bench/layers/${layer}-${trait}.png`
    const png = await drawLayer(layer, trait)
    images.set(key, png)
    sourceBytes += png.byteLength
    traits.push({
      id: `${layer}-${trait}`,
      name: `Trait ${trait}`,
      blank: false,
      inMetadata: true,
      image: { key, ext: 'png' as const },
    })
  }
  spec.collections[0]!.layers.push({
    id: `layer-${layer}`,
    name: `Layer ${layer}`,
    displayName: null,
    opacity: 1,
    traits,
  })
}
const tokens: GenerativeToken[] = Array.from({ length: TOKENS }, (_, n) => ({
  id: n + 1,
  collectionId: 'bench',
  dna: Array.from({ length: LAYERS }, (_, layer) => `${layer}-${(n + layer * 3 + (n >> layer)) % TRAITS}`),
  description: null,
}))
const load = async (ref: ImageRef): Promise<Uint8Array> => {
  const bytes = images.get(ref.key)
  if (!bytes) throw new Error(`No image at ${ref.key}`)
  return bytes
}

console.log(`Rendering one batch of ${TOKENS} tokens...`)
const started = performance.now()
const batch = await renderBatch(spec, 0, tokens, load)
const seconds = (performance.now() - started) / 1000

// Node reports the peak resident set size in kilobytes.
const peak = process.resourceUsage().maxRSS * 1024
console.log(`Machine:        ${platform()} ${arch()}, ${cpus().length} cores, Node ${process.version}`)
console.log(`Layer images:   ${LAYERS * TRAITS} files, ${megabytes(sourceBytes)}`)
console.log(`Wall time:      ${seconds.toFixed(1)} s (${(seconds / TOKENS).toFixed(2)} s a token)`)
console.log(`Peak memory:    ${megabytes(peak)} resident`)
console.log(`CAR size:       ${megabytes(batch.size)} for ${batch.files.length} files`)
console.log(`Batch CID:      ${batch.cid}`)
```

- [ ] **Step 4: Run the benchmark**

Run a small one first: `pnpm --filter @cobweb/worker bench --tokens 4 --size 256 --layers 3`
Expected: it finishes in about a second and prints six lines (`Machine`, `Layer images`, `Wall time`, `Peak memory`, `CAR size`, `Batch CID`).

Run the real one: `pnpm --filter @cobweb/worker bench`
Expected: the same six lines for 100 tokens at 2048 by 2048 with 7 layers. On the planning machine (darwin arm64, 12 cores, Node 26.8) it printed a wall time of 50.1 s, a peak of 719.3 MB resident and a CAR of 146.1 MB. Numbers on other machines differ; nothing asserts on them. Keep the output: Task 13 does not need it, but the first deploy does (`infra/README.md`).

- [ ] **Step 5: Format, run the root checks and commit**

Run: `pnpm exec prettier --write apps/web/scripts/verify-render.ts services/worker/scripts/bench.ts`

Run at the repo root: `pnpm typecheck && pnpm lint && pnpm test`
Expected: every Turborepo task succeeds.

```bash
git add apps/web/scripts/verify-render.ts \
  services/worker/scripts/bench.ts
git commit -m "Verify the worker's failure paths, the sweep and placeholder jobs, and add the benchmark" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bcHX4HZG5YGWhxjGuiWos"
```

---

### Task 12: The CDK stack, its template assertions and the infra README

**Files:**

- Create: `infra/package.json`
- Create: `infra/tsconfig.json`
- Create: `infra/cdk.json`
- Create: `infra/bin/app.ts`
- Create: `infra/lib/render-stack.ts`
- Create: `infra/test/render-stack.test.ts`
- Create: `infra/README.md`
- Modify: `pnpm-workspace.yaml` (`infra` added to `packages`)
- Modify: root `package.json` (`esbuild` added to `devDependencies`)
- Modify: `.gitignore`, `.prettierignore` (`cdk.out/`)
- Modify: `eslint.config.mjs` (`'**/cdk.out/**'` added to `ignores`)
- Modify: `pnpm-lock.yaml` (by `pnpm install`)

**Interfaces:**

- Consumes: the three handlers `services/worker/src/lambda/render.ts`, `dead.ts`, `sweep.ts` (Task 9), by path; the sharp version in `services/render/package.json`; the environment names `productionDeps` and `loadDeps` read (Task 9).
- Produces: `class RenderStack extends Stack`, constants `RENDER_MEMORY_MB` (4096), `RENDER_TIMEOUT` (10 minutes), `RENDER_EPHEMERAL_MB` (4096), `MAX_RECEIVES` (3); the stack `CobwebRender` with logical ids starting `RenderQueue`, `RenderDeadLetters`, `RenderFunction`, `DeadLetterFunction`, `SweepFunction`, `SweepRule`, `RenderBucket`, `RenderSecrets`; parameters `ArtBucketArn`, `ArtBucketRegion`, `SupabaseUrl`, `FilebaseBucket`; commands `pnpm --filter @cobweb/infra test` and `pnpm --filter @cobweb/infra synth`.

Spec section 9. Decisions 2, 3, 17 and 21 apply. Every CDK name used below was read from the installed packages (`aws-cdk-lib` 2.273.0, `constructs` 10.8.1, `aws-cdk` 2.1145.0) and the stack was synthesized in a scratch copy with no AWS credentials: `Stack`, `CfnParameter`, `Duration`, `Fn`, `RemovalPolicy`, `Size` from `aws-cdk-lib`; `Queue` with `deadLetterQueue: { queue, maxReceiveCount }` from `aws-cdk-lib/aws-sqs`; `NodejsFunction` with `bundling` (`bundleAwsSDK`, `externalModules`, `commandHooks`), `projectRoot` and `depsLockFilePath` from `aws-cdk-lib/aws-lambda-nodejs`; `SqsEventSource` with `batchSize` and `reportBatchItemFailures` from `aws-cdk-lib/aws-lambda-event-sources`; `Rule` and `Schedule.rate` from `aws-cdk-lib/aws-events`; `LambdaFunction` from `aws-cdk-lib/aws-events-targets`; `Bucket` and `BlockPublicAccess.BLOCK_ALL` from `aws-cdk-lib/aws-s3`; `Secret` from `aws-cdk-lib/aws-secretsmanager`; `PolicyStatement` from `aws-cdk-lib/aws-iam`; `Template` and `Match` from `aws-cdk-lib/assertions`.

Never run `cdk deploy` or `cdk bootstrap` in this task, and never run Prettier from inside `infra` on `.` (it rewrote a bundle in `cdk.out` in the scratch copy and broke it).

- [ ] **Step 1: Wire the package into the workspace**

`pnpm-workspace.yaml`, the `packages` list becomes:

```yaml
packages:
  - apps/*
  - services/*
  - packages/*
  - infra
```

Root `package.json`: add `"esbuild": "0.28.2"` to `devDependencies`, between `"@types/node"` and `"eslint"` (decision 2: CDK runs esbuild from the repo root).

`.gitignore`: add a line `cdk.out/` after `coverage/`.

`.prettierignore`: add a line `cdk.out/` at the end.

`eslint.config.mjs`: the `ignores` line becomes:

```js
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/cdk.out/**',
      'legacy/**',
      'contracts/**',
    ],
```

Create `infra/package.json`:

```json
{
  "name": "@cobweb/infra",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "test": "vitest run",
    "synth": "cdk synth --quiet"
  },
  "devDependencies": {
    "@types/node": "^26.6.4",
    "aws-cdk": "2.1145.0",
    "aws-cdk-lib": "2.273.0",
    "constructs": "10.8.1",
    "vitest": "^5.0.3"
  }
}
```

Create `infra/tsconfig.json`:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "types": ["node"], "allowImportingTsExtensions": true },
  "include": ["bin", "lib", "test"]
}
```

Create `infra/cdk.json`:

```json
{
  "app": "node bin/app.ts"
}
```

Run at the repo root: `pnpm install`

- [ ] **Step 2: Write the failing template assertions**

Create `infra/test/render-stack.test.ts`:

```ts
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

/** The role policy statements of the function whose logical id starts with `prefix`. */
function statementsOf(prefix: string): Statement[] {
  return ofType('AWS::IAM::Policy')
    .filter(([id]) => id.startsWith(`${prefix}ServiceRoleDefaultPolicy`))
    .flatMap(([, policy]) => (policy.Properties.PolicyDocument as { Statement: Statement[] }).Statement)
}
const actionsOf = (prefix: string) => statementsOf(prefix).flatMap((statement) => statement.Action)

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

  it('gives the render queue a visibility timeout of six times the render timeout', () => {
    const [, fn] = ofType('AWS::Lambda::Function').find(([id]) => id.startsWith('RenderFunction'))!
    expect(fn.Properties.Timeout).toBe(600)
    template.hasResourceProperties('AWS::SQS::Queue', { VisibilityTimeout: 600 * 6 })
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
})

describe('the render bucket', () => {
  it('is private, with public access blocked', () => {
    template.resourceCountIs('AWS::S3::Bucket', 1)
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    })
  })
})

describe('roles', () => {
  it('have no statement with a wildcard resource', () => {
    const statements = resources.flatMap(
      ([, resource]) =>
        (resource.Properties?.PolicyDocument as { Statement?: Statement[] } | undefined)?.Statement ?? [],
    )
    expect(statements.length).toBeGreaterThan(8)
    for (const statement of statements) {
      expect(statement.Resource).toBeDefined()
      for (const resource of [statement.Resource].flat()) expect(resource).not.toBe('*')
    }
  })

  it('let the render function read the art bucket with s3:GetObject and nothing wider', () => {
    const artRead = statementsOf('RenderFunction').filter((statement) =>
      JSON.stringify(statement.Resource).includes('ArtBucketArn'),
    )
    expect(artRead).toEqual([
      {
        Effect: 'Allow',
        Action: 's3:GetObject',
        Resource: { 'Fn::Join': ['', [{ Ref: 'ArtBucketArn' }, '/*']] },
      },
    ])
  })

  it('give each function only what it uses', () => {
    const render = actionsOf('RenderFunction')
    expect(render).toEqual(expect.arrayContaining(['s3:GetObject', 's3:PutObject', 'sqs:SendMessage']))
    expect(render).toEqual(expect.arrayContaining(['sqs:ReceiveMessage', 'secretsmanager:GetSecretValue']))
    expect(render).not.toContain('s3:DeleteObject*')

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
    for (const name of ['SERVICE_ROLE_KEY', 'ACCESS_KEY_ID', 'SECRET_ACCESS_KEY', 'RPC_URL_', 'NEXT_PUBLIC_'])
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
```

- [ ] **Step 3: Run the test to see it fail**

Run: `pnpm --filter @cobweb/infra test`
Expected: FAIL. `Error: Cannot find module '../lib/render-stack.ts'`.

- [ ] **Step 4: Write the app and the stack**

Create `infra/bin/app.ts`:

```ts
// The CDK app: one stack, in us-east-1. Run through `pnpm --filter @cobweb/infra synth`; Node runs
// this file as it is (type stripping), so there is no build step.
import { App } from 'aws-cdk-lib'
import { RenderStack } from '../lib/render-stack.ts'

const app = new App()
new RenderStack(app, 'CobwebRender', { env: { region: 'us-east-1' } })
```

Create `infra/lib/render-stack.ts`:

```ts
/**
 * The render pipeline on AWS (docs/specs/2026-10-12-render-worker.md, section 9): a queue with a
 * dead-letter queue, the render function, the dead-letter function, the sweep on a 15 minute rule,
 * a private bucket for collages and one secret. Nothing secret is written here: the secret is
 * created empty of meaning and its value is put in place by hand after the first deploy
 * (infra/README.md).
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CfnParameter, Duration, Fn, RemovalPolicy, Size, Stack } from 'aws-cdk-lib'
import type { StackProps } from 'aws-cdk-lib'
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

    const deadLetters = new Queue(this, 'RenderDeadLetters', {
      retentionPeriod: Duration.days(14),
      encryption: QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
    })
    const queue = new Queue(this, 'RenderQueue', {
      visibilityTimeout: Duration.seconds(RENDER_TIMEOUT.toSeconds() * 6),
      deadLetterQueue: { queue: deadLetters, maxReceiveCount: MAX_RECEIVES },
      encryption: QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
    })
    const renderBucket = new Bucket(this, 'RenderBucket', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
    })
    // Created with a generated value nobody uses. Its real value, a JSON object, is put in place by
    // hand (infra/README.md), so no secret ever passes through a template.
    const secret = new Secret(this, 'RenderSecrets', {
      description: 'Cobweb render worker: the Supabase service key, the Filebase keys and the RPC URLs.',
      removalPolicy: RemovalPolicy.RETAIN,
    })

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
    render.addToRolePolicy(
      new PolicyStatement({ actions: ['s3:GetObject'], resources: [`${artBucketArn.valueAsString}/*`] }),
    )
    renderBucket.grantPut(render)
    queue.grantSendMessages(render)
    secret.grantRead(render)

    const dead = new NodejsFunction(this, 'DeadLetterFunction', {
      ...common,
      entry: resolve(lambdaDir, 'dead.ts'),
      memorySize: 512,
      timeout: Duration.minutes(1),
    })
    dead.addEventSource(new SqsEventSource(deadLetters, { batchSize: 1, reportBatchItemFailures: true }))
    secret.grantRead(dead)

    const sweep = new NodejsFunction(this, 'SweepFunction', {
      ...common,
      entry: resolve(lambdaDir, 'sweep.ts'),
      memorySize: 512,
      timeout: Duration.minutes(1),
    })
    queue.grantSendMessages(sweep)
    secret.grantRead(sweep)
    new Rule(this, 'SweepRule', {
      schedule: Schedule.rate(Duration.minutes(15)),
      targets: [new LambdaFunction(sweep)],
    })
  }
}
```

- [ ] **Step 5: Run the test to see it pass**

Run: `pnpm --filter @cobweb/infra test`
Expected: PASS, 13 tests, in about a second. No esbuild run, no npm install, no Docker, no AWS credentials (decision 3).

- [ ] **Step 6: Synthesize with bundling and no credentials**

Run:

```bash
env -u AWS_PROFILE -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
  AWS_CONFIG_FILE=/dev/null AWS_SHARED_CREDENTIALS_FILE=/dev/null AWS_EC2_METADATA_DISABLED=true \
  pnpm --filter @cobweb/infra synth
```

Expected: three "Bundling asset CobwebRender/.../Code/Stage..." lines, each followed by esbuild's summary and npm's "added 6 packages", then exit code 0. It needs the npm registry (or a warm npm cache) for sharp's linux arm64 build, and nothing from AWS.

Run: `ls -d infra/cdk.out/asset.*/node_modules/@img/sharp-linux-arm64 | wc -l`
Expected: `3`, one for each function's bundle.

Run: `git status --short infra`
Expected: `infra/cdk.out` is not listed (it is ignored).

- [ ] **Step 7: Optional, when Docker is running: load each bundle in the Lambda image**

Skip this step when Docker is not available; nothing depends on it. It was run in the scratch copy and passed.

```bash
for asset in infra/cdk.out/asset.*; do
  [ -d "$asset/node_modules" ] || continue
  docker run --rm --platform linux/arm64 --entrypoint node -v "$PWD/$asset:/var/task:ro" -w /var/task \
    public.ecr.aws/lambda/nodejs:22 -e "
      const { handler } = require('./index.js')
      const start = { jobId: '3f0c2f5e-8a51-4c0e-9d7b-0d0f5a3b9c11', step: 'start', retries: 0 }
      const event = { Records: [{ messageId: 'm1', body: 'not json' }, { messageId: 'm2', body: JSON.stringify(start) }] }
      handler(event).then((r) => console.log('OK', JSON.stringify(r)), (e) => console.log('THREW', e.message))"
done
```

Expected: two of the three print `OK {"batchItemFailures":[{"itemIdentifier":"m2"}]}` (the render and dead-letter handlers: the first record is ignored, the second fails because `RENDER_SECRET_ARN` is not set), and one prints `THREW RENDER_SECRET_ARN is not set.` (the sweep). Each of those proves the bundle loads sharp's linux arm64 build under Node 22.

- [ ] **Step 8: Write the README**

Create `infra/README.md`:

````markdown
# Cobweb render infrastructure

One AWS CDK stack, `CobwebRender`, in `us-east-1`, defined in `lib/render-stack.ts`. It holds the
render queue and its dead-letter queue, the three Lambda functions of `services/worker`, the sweep
rule, the collage bucket and one secret. Spec: `docs/specs/2026-10-12-render-worker.md`, section 9.

Nothing here has been deployed yet. Everything below the "Local" heading needs AWS credentials and a
Filebase account, which the development machine does not have; it is recorded so the first deploy is
a checklist and not a design session.

## Local

```
pnpm --filter @cobweb/infra test     # template assertions; no bundling, no Docker, no credentials
pnpm --filter @cobweb/infra synth    # full synthesis with bundling into infra/cdk.out
```

`synth` needs no AWS credentials and no Docker. esbuild (a root dev dependency, because CDK runs it
from the directory that holds `pnpm-lock.yaml`) bundles each function, and sharp's linux arm64 build
is installed beside the bundle with `npm install --os=linux --cpu=arm64 --libc=glibc`, so the first
run needs the npm registry or a warm npm cache. `infra/cdk.out` is not committed. Do not run Prettier
from inside `infra` with `.`: the root `.prettierignore` is not read from there and it would rewrite
the bundles in `cdk.out`.

## The secret

The stack creates one Secrets Manager secret (`RenderSecrets`) with a generated value nobody uses.
After the first deploy, replace its value with one JSON object of text values. The functions read it
once per container and merge it over their environment; nothing in it is logged or written to a
template.

| Key                          | What it is                                                           |
| ---------------------------- | -------------------------------------------------------------------- |
| `SUPABASE_SERVICE_ROLE_KEY`  | The Supabase service-role key                                        |
| `FILEBASE_ACCESS_KEY_ID`     | Filebase S3 access key id                                            |
| `FILEBASE_SECRET_ACCESS_KEY` | Filebase S3 secret key                                               |
| `RPC_URL_<chainId>`          | One per chain jobs are paid on (1, 42161, 8453, and so on)           |
| `FACTORY_ADDRESS_<chainId>`  | Optional, not secret: the fallback when a job has no `quote_factory` |

Put it in place without writing it to a file that could be committed:

```
aws secretsmanager put-secret-value --region us-east-1 \
  --secret-id <the RenderSecrets ARN from the stack outputs or the console> \
  --secret-string file:///dev/stdin
```

Then paste the JSON and end the input. A function that was already warm keeps the old value until
its container is recycled.

## First deploy

```
aws sts get-caller-identity                                   # the account you mean to use
pnpm --filter @cobweb/infra exec cdk bootstrap aws://<account>/us-east-1
pnpm --filter @cobweb/infra exec cdk diff
pnpm --filter @cobweb/infra exec cdk deploy \
  --parameters ArtBucketArn=arn:aws:s3:::<the art bucket> \
  --parameters ArtBucketRegion=<its region> \
  --parameters SupabaseUrl=https://<project>.supabase.co \
  --parameters FilebaseBucket=<the Filebase IPFS bucket>
```

The render function's role may read the art bucket (`s3:GetObject` only), write the collage bucket,
send to and receive from the render queue and read the secret. The dead-letter function may receive
from the dead-letter queue and read the secret. The sweep function may send to the render queue and
read the secret. No statement has a wildcard resource; `test/render-stack.test.ts` holds that.

## Owed on the first deploy

In this order. Each is recorded in MASTER_PLAN's Phase 4 status line.

1. **Filebase, how a CAR is imported.** `services/worker/src/adapters/filebase.ts` uploads the CAR
   with the object metadata `import: car` (`FILEBASE_IMPORT_METADATA`), which Filebase's pinning
   documentation describes. Confirm with a real key that a small CAR uploaded this way lists as a
   directory, not as one opaque file:

   ```
   npx -y ipfs-car@3.1.0 pack ./some-folder --output folder.car
   aws --endpoint https://s3.filebase.com s3 cp folder.car s3://<bucket>/ --metadata 'import=car'
   ```

2. **Filebase, how the CID comes back.** The adapter reads it from the object's metadata key `cid`
   (`FILEBASE_CID_METADATA_KEY`, the `x-amz-meta-cid` header) with a HeadObject after the upload.
   Confirm the key, and that the value is the CIDv1 base32 root the render library computed
   (`bafy...`, 59 characters), not a CIDv0:

   ```
   aws --endpoint https://s3.filebase.com s3api head-object --bucket <bucket> --key folder.car
   ```

   If either differs, change the two constants (and only them); the worker already fails a job with
   `cid-mismatch` rather than accept a different CID.

3. **The benchmark on Lambda.** `pnpm --filter @cobweb/worker bench` prints wall time, peak memory
   and CAR size for one batch of 100 tokens at 2048 by 2048 with 7 layers on this machine. Run one
   real batch on Lambda and set `RENDER_MEMORY_MB`, `RENDER_TIMEOUT` and `RENDER_EPHEMERAL_MB` in
   `lib/render-stack.ts` from what it shows; 4,096 MB, 10 minutes and 4,096 MB are PLAN.md's
   starting points. The metadata step of a 100,000 token job peaks near 300 MB.

4. **CIDs across architectures.** The render library's goldens are verified on darwin arm64 and on
   emulated linux x64. Run `pnpm --filter @cobweb/render test` on a native x64 runner, and render one
   project with an ICC-tagged layer and one with a 16-bit layer on both architectures, before any
   function is moved off arm64.

5. **A CAR larger than 5 GB** cannot go up in one PutObject. A batch of 100 tokens is far below that
   (the local benchmark's CAR is about 150 MB); revisit if the batch size is raised.
````

- [ ] **Step 9: Format, run the root checks and commit**

Run from the repo root (paths, never `.`): `pnpm exec prettier --write infra/package.json infra/tsconfig.json infra/cdk.json infra/bin infra/lib infra/test infra/README.md pnpm-workspace.yaml package.json eslint.config.mjs`

Run at the repo root: `pnpm typecheck && pnpm lint && pnpm test`
Expected: every Turborepo task succeeds. The `@cobweb/infra` tasks are among them.

```bash
git add infra/package.json \
  infra/tsconfig.json \
  infra/cdk.json \
  infra/bin \
  infra/lib \
  infra/test \
  infra/README.md \
  pnpm-workspace.yaml \
  package.json \
  .gitignore \
  .prettierignore \
  eslint.config.mjs \
  pnpm-lock.yaml
git commit -m "Define the render pipeline's AWS stack with template assertions" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bcHX4HZG5YGWhxjGuiWos"
```

---

### Task 13: Docs, env names and the full check list

**Files:**

- Modify: `docs/MASTER_PLAN.md` (the Phase 4 status line, line 200)
- Modify: `CLAUDE.md` (Layout and Commands)
- Modify: `apps/web/.env.example` (one name appended)
- Modify: `docs/specs/2026-10-12-render-worker.md` (the six acceptance boxes)

**Interfaces:**

- Consumes: everything Tasks 1 to 12 landed.
- Produces: nothing in code.

MASTER_PLAN keeps its history: no existing sentence of the status line is rewritten. The one exception is its final sentence, `Next: worker and local runner (third sub-project).`, which is replaced by the text below (which ends with the new `Next:` sentence).

- [ ] **Step 1: Run the full check list first**

With local Supabase and Anvil running (see Global Constraints), run each and compare:

```bash
pnpm typecheck && pnpm lint && pnpm test
pnpm --filter @cobweb/web verify:local
pnpm --filter @cobweb/web verify:storage
pnpm --filter @cobweb/web verify:sweep
pnpm --filter @cobweb/web verify:chain
pnpm --filter @cobweb/web verify:render
pnpm --filter @cobweb/web verify:render
pnpm --filter @cobweb/web verify:render
pnpm --filter @cobweb/infra synth
pnpm build
```

Expected: the first line succeeds for every package; `verify:local` ends with "270 passed, 0 failed"; `verify:storage`, `verify:sweep` and `verify:chain` end with 0 failed; each of the three `verify:render` runs ends with "13 passed, 0 failed"; `synth` exits 0 with no AWS credentials in the environment; `build` succeeds.

Then the hygiene checks:

```bash
LC_ALL=C grep -rn $'\xe2\x80\x93\|\xe2\x80\x94' services/worker/src services/worker/scripts \
  services/worker/.env.example infra/lib infra/bin infra/test infra/README.md \
  packages/shared/src/render-queue.ts packages/shared/src/render-queue.test.ts apps/web/scripts/verify-render.ts
grep -rn "legacy" services/worker/src infra/lib infra/bin packages/shared/src/render-queue.ts
grep -rniE "allowlist|kingdomly" services/worker/src services/worker/scripts infra/lib infra/bin infra/test infra/README.md apps/web/scripts/verify-render.ts
grep -rn "^NEXT_PUBLIC_" services/worker/.env.example
grep -rn "NEXT_PUBLIC_" infra/lib infra/bin
```

Expected: no output from any of the five (the first looks for en and em dashes by their bytes).

- [ ] **Step 2: Append to the Phase 4 status line**

In `docs/MASTER_PLAN.md`, the Phase 4 status paragraph (the line that starts `**Status:** in progress. Items owed to this phase`) ends with the sentence `Next: worker and local runner (third sub-project).` Replace that one sentence, and nothing before it, with the following (one paragraph, on the same line). If the day is no longer 12 October 2026, write the day of the commit in the same form.

```markdown
Worker and local runner (third sub-project) landed on 12 October 2026; see [specs/2026-10-12-render-worker.md](specs/2026-10-12-render-worker.md). `@cobweb/worker` in `services/worker` turns a paid or waived job into pinned images and metadata in three idempotent steps (start, batch, metadata) behind five ports (jobs, store, pinner, chain, queue), each with a production adapter and a local double. It checks `jobPayment` on chain before the claim and fails a short payment with `payment-mismatch`, fails bad art at once with the render library's code, and lets anything else be redelivered, the dead-letter handler failing the job with `dead-letter` after three receives; a sweep re-enqueues a job left rendering or finalizing for 15 minutes. `verify:render` runs the whole pipeline against local Supabase, local storage and Anvil, with a folder for the pinning service and a queue in memory. The collage is written to a separate render bucket under `<collection id>/collage/<job id>.png`, never to the `art` bucket. `infra` holds the CDK stack `CobwebRender` (the queue and its dead-letter queue, three functions, the sweep rule, the collage bucket, one secret); it synthesizes without credentials and nothing is deployed. Owed, listed in `infra/README.md`: the first deploy; confirming on Filebase how a CAR is imported and how the CID comes back (the adapter follows Filebase's documentation and keeps both in named constants); the benchmark on Lambda (`pnpm --filter @cobweb/worker bench` is the local one); the render library's goldens on a native x64 runner in CI; and ICC-tagged and 16-bit layers across architectures. The fourth sub-project consumes `enqueueRender(queue, { id, retries })` from `@cobweb/shared`, `sqsRenderQueue(client, queueUrl)` from `@cobweb/worker/queue`, and `render_jobs.collage_key`, an object key in the render bucket (`RENDER_S3_BUCKET`) that it signs with a GET URL the way `presignGet` signs an art object, with the bucket changed. Next: screen wiring (fourth sub-project).
```

- [ ] **Step 3: Update CLAUDE.md**

In the Layout block, add these two lines after the `services/render` line:

```
services/worker    Render worker: ports, steps, adapters, local runner, Lambda entry points
infra/             AWS CDK stack for the render pipeline (not deployed yet)
```

and change the `packages/shared` line to:

```
packages/shared    Chain config, factory ABI and addresses, job ids, the render queue contract (browser entry) and viem clients (server entry)
```

In the Commands block, change the `supabase seed buckets` line to:

```
supabase seed buckets                     # creates the local `art` and `render` buckets from config.toml (a restart alone does not)
```

and add these lines after the `pnpm --filter @cobweb/render test` line:

```
pnpm --filter @cobweb/worker test         # render worker: the mapper, the three steps, the adapters against stubs
pnpm --filter @cobweb/web verify:render   # the worker end to end against local Supabase, local storage and Anvil
pnpm --filter @cobweb/worker bench        # one batch of 100 tokens at 2048 x 2048: time, memory, CAR size
pnpm --filter @cobweb/infra test          # CDK template assertions; no bundling, no credentials
pnpm --filter @cobweb/infra synth         # full synthesis with bundling; needs no AWS credentials
```

- [ ] **Step 4: Add the render bucket name to the web env example**

Append to `apps/web/.env.example`:

```

# The render bucket (server only; never NEXT_PUBLIC_): the preview collages the render worker writes.
# Local: the "render" bucket in Supabase Storage, created by `supabase seed buckets`. verify:render
# reads it; the worker's own names are in services/worker/.env.example.
RENDER_S3_BUCKET=render
```

- [ ] **Step 5: Tick the acceptance boxes**

In `docs/specs/2026-10-12-render-worker.md`, section 12, change each of the six `- [ ]` to `- [x]`. Each is backed by Step 1: the import test in `render-queue.test.ts` and the `@cobweb/worker/queue` entry test; the three `verify:render` runs; the step tests of Tasks 4 to 7; `synth` and the template assertions; the secret and env tests of Tasks 9 and 12; the status line of Step 2. If Step 1 did not pass in full, do not tick the box it backs; report what failed instead.

- [ ] **Step 6: Format and commit**

Do not run Prettier on these four files: `docs/` is in the repo's Prettier ignore file, and each edit here is a line or a block written to fit.

Run: `git diff --stat`
Expected: four files, and in `docs/MASTER_PLAN.md` one line changed (the status paragraph).

```bash
git add docs/MASTER_PLAN.md \
  CLAUDE.md \
  apps/web/.env.example \
  docs/specs/2026-10-12-render-worker.md
git commit -m "Record the render worker landing in the docs" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bcHX4HZG5YGWhxjGuiWos"
```

---

## Self-review

Run against the spec after the plan was written.

**Spec coverage**

| Spec section                                                                                                   | Task                                                  |
| -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 2, decisions (CDK in us-east-1, local build, ports, RenderProblem final, payment before claim, collage bucket) | 12, 2, 5, 4, 6 and 8                                  |
| 3, scope                                                                                                       | all; the screen, opacity and source deletion stay out |
| 4, the queue contract, `sqsRenderQueue`, the `@cobweb/worker/queue` entry                                      | 1, 9                                                  |
| 5, ports, `JobRefusal`, production adapters, doubles                                                           | 2, 8, 9                                               |
| 6, the spec mapper and its failures                                                                            | 3                                                     |
| 7, start                                                                                                       | 4                                                     |
| 7, batch                                                                                                       | 5                                                     |
| 7, metadata and the collage                                                                                    | 6                                                     |
| 7, failures                                                                                                    | 4 (the mapping in `handle`), 5 (its tests)            |
| 7, dead letter and sweep                                                                                       | 7                                                     |
| 8, `runLocal`                                                                                                  | 7                                                     |
| 8, `verify:render` checks 1 to 5                                                                               | 10                                                    |
| 8, `verify:render` checks 6 to 10, the benchmark                                                               | 11                                                    |
| 9, the stack, roles, assertions, README, thin entry points, `filebasePinner`                                   | 12, 9                                                 |
| 10, env names, the local `render` bucket                                                                       | 9, 10, 13                                             |
| 11, testing                                                                                                    | every task; the full list in 13                       |
| 12, acceptance                                                                                                 | 13                                                    |

Gaps found and closed while writing: the dead-letter and sweep functions also need sharp's linux build, because they import the steps (decision 2); the spec's env list has no name for the secret's ARN (decision 17); `sweep(deps)` keeps the spec's signature and `verify:render` moves the clock instead (Task 11, check 9).

**Placeholder scan:** every code step has its code; no step defers work. The one date in Task 13 is written out, with what to do if the day has changed.

**Type consistency:** `Deps`, `JobRecord`, `BatchRecord`, `FinishResult`, `RenderData`, `TokenRows`, `MemoryQueue`, `QueueEntry`, `S3Like`, `WorkerClient` and `PaymentReader` are each defined once (Tasks 2, 4 and 8) and used under the same names in every later task; the staged versions of `steps.ts` and `steps.test.ts` in Tasks 4 to 7 were each type checked, linted and run on their own in the scratch copy (52, 71, 87 and 101 passing tests), and the files as they stand after Tasks 8 and 9 likewise (135 and 158).

**Review Focus:** five lines, each with its test named in the task that owns the code (Tasks 2, 4, 5, 6, 7, 8 and 9).

## For the reviewer to rule on

Places where the spec could not be followed to the letter, or says something the code underneath does not. Each has a decision above; overrule any of them before execution.

- Section 7, failures: a `BATCH_RESULT_DIFFERS` refusal cannot be recorded against its batch, because `art_batch_failed` refuses a failure that names a done batch (job state spec, section 6). The plan records it on the job (decision 12).
- Section 5 gives `Jobs` only `tokens(job, index)`, so the metadata step of a 100,000 token job makes 1,000 reads (8 in flight). A `tokensPage` method would cut that to 100; it was left out to keep the port as specified (decision 9).
- Section 9 names sharp's linux arm64 package for the render function only. All three functions need it as the worker is written (decision 2). The other way is to keep `handleDead` and `sweep` in a file that does not import the render library.
- Section 9 and section 2: the Filebase endpoint, the `import=car` metadata and `x-amz-meta-cid` are confirmed by Filebase's documentation and not by a live call. Reading the CID with HeadObject through the AWS SDK v3 is the plan's inference (decision 23).
- Section 8, check 6: "a job whose payment is short on chain" cannot be reached through the product (a short payment never marks a job paid), so the script forces the row with the service client.
- Section 8, check 9: a job cannot be backdated (`updated_at` is trigger kept), so the script moves the adapter's clock.
- Section 10: the functions read one name the list does not have, `RENDER_SECRET_ARN` (decision 17).
- Render core spec, section 9, says a batch's tokens "must be exactly those" of the batch; `services/render/src/batch.ts` checks membership only. The worker adds the count check in `supabaseJobs.tokens` (decision 8). Render core spec, section 10, says the worker passes PNG files only; the plan keeps JPG and WebP stills too, so a JPG 1/1 project gets a collage (decision 10).
- `apps/web/scripts/verify-render.ts` was never executed during planning (no writes to the local database were allowed). Everything else in the plan was run.
