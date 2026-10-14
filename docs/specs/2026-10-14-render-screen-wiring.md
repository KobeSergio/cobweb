# Render screen wiring: specification

Phase 4, fourth sub-project of four (render core, job state, worker and local runner, screen wiring).
It closes Phase 4. Product decisions: [../MASTER_PLAN.md](../MASTER_PLAN.md#decisions) and the Phase 4
section of the same file ("dashboard progress by polling the job row"; "done when a paid 10,000-token
job renders end to end, survives a forced batch failure and retry"). What the screen reads:
[2026-10-12-render-job-state.md](2026-10-12-render-job-state.md) sections 7 and 9 (`art_render_retry`,
the `RenderJob` model). What the worker leaves behind and what it owed this sub-project:
[2026-10-12-render-worker.md](2026-10-12-render-worker.md) sections 3 and 8 (`enqueueRender`, the collage
key, `ART_PROBLEM_CODES`). The queue the retry sends on:
[2026-10-13-render-worker-vercel.md](2026-10-13-render-worker-vercel.md) sections 4 and 7. Lock, unlock
and the sentences: [2026-10-09-lock-and-pay.md](2026-10-09-lock-and-pay.md) sections 6 and 7. Legacy
reference: [../legacy/market-creator-flow.md](../legacy/market-creator-flow.md) section 5 (a WebSocket
fed a percent bar and a phase line; completion showed the metadata CID; there was no retry and no
failure screen).

## 1. Goal

The Lock and upload screen follows the real render job instead of the simulation in
`components/upload/render-sim.ts`: it polls the job row, shows the batches as the worker finishes them,
shows a failed job with its sentence and the one action that fits the failure, lets the creator retry,
and on the done step shows the preview collage, the metadata CID, the base URI and every batch CID.

A creator whose paid render fails for good is never left at a dead end: an art problem, or five failed
retries on a worker fault, lets the creator unlock, fix the art and lock again, and the payment already
made covers the next lock. Only a payment mismatch stays with support.

## 2. Decisions taken in the design conversation

1. **A paid render that fails and is unlocked leaves a credit.** The next lock of the same collection
   with the same or fewer tokens is recorded `waived`, through the waiver columns `render_jobs`
   already has, so the creator pays once. Considered: unlock and pay again (the creator pays twice when
   the review missed a problem, refunds by hand); no unlock, tell support (a dead end until the owner
   acts). A payment mismatch leaves no credit and cannot be unlocked: the payment itself is in doubt.
2. **The credit rule lives in one SQL function.** `art_lock` and the review both ask it, so the web app
   never mirrors the rule. The credit is any unused credit whose token count covers the lock, newest
   first; a larger lock pays in full and leaves the older credit usable by a later, smaller lock.
3. **A failed job that is unlocked keeps the worker's sentence** in `error` and takes the code
   `unlocked` in `error_code`. Every existing check for an unlocked job (the batch functions, the retry,
   the latest-job filter, the model's `retryable`) reads the code, so nothing else changes.
4. **Polling through React Query.** It is installed and provided, and the project's rule names it for
   server data. The interval comes from a pure function (3 seconds, then 15 after two minutes), the
   query calls the existing `getRenderJob` action, and the library handles unmount and background tabs.
   Considered: a hand loop with injected sleep like the pay machine (re-implements the library);
   Supabase Realtime (the plan chose polling the job row, and Realtime needs publication and its own
   access rules).
5. **The collage is served by a route**, `GET /api/collections/[id]/collage`, that mirrors the uploads
   route: session, the key read under row-level security, a 302 to a presigned GET. Considered: a
   presigned URL inside the job model (expires in client state); a public bucket (no).
6. **Four faces for a failed job**: art (unlock and fix), retry (try again, retries left), credit (no
   retries left; unlock and lock again free), support (payment mismatch). The worker's own sentence is
   the explanation; there is no per-code advice beyond it.
7. **The retry sends the start message itself**, with the row's new retry count, and swallows a failed
   send the way the pay flow does: the sweep re-sends within 15 minutes for a `rendering` job nothing
   touched.
8. **Sample mode steps a scripted job through the same reload path**, so the demo keeps moving on the
   real code and the simulation file is deleted.
9. **A local render runner script** makes the real screen reach done on a laptop, since the dev
   app's queue only logs. It reuses the verify-render helpers.
10. **The server page refreshes only when the stage changes or the job ends**, never on an ordinary
    poll.
11. **The done step shows the collage** in place of the sample tiles, and lists every batch CID in a
    collapsible list.

## 3. Scope

In: the credit migration and its verify:local section; the review's credit line; the model's
`credited` flag; the retry action; the collage route and the render-bucket presign; the follow module;
the flow's polling; the render and done steps rewritten; sample mode's scripted run and two outcomes;
the local render runner; the verify:render checks; docs.

Out: the reveal flow that owns a deployed collection's rendering status, and the retry's job selection
on a deferred collection that later holds a real job (Phase 5); a partial credit for a larger lock
(the larger lock pays in full); a read-only session check for the poll (the existing verified check
is used; see section 15); real token images from a gateway on the done step (the collage stands for
them); alerting (Phase 7).

## 4. Database: the credit (`supabase/migrations/20261014000000_render_credit.sql`)

### 4.1 Column

`render_jobs.credit_job_id uuid references public.render_jobs (id) on delete restrict`, null unless the
job was recorded `waived` on the strength of that job's payment. Constraint
`render_jobs_credit_has_waiver check (credit_job_id is null or waived_by is not null)`. A partial
index `render_jobs_credit_job_id_idx on public.render_jobs (credit_job_id) where credit_job_id is not null`
serves the "not yet used" lookup.

### 4.2 The rule

```sql
create function private.render_credit(p_collection_id uuid, p_token_count integer)
returns public.render_jobs language sql stable security definer set search_path = ''
```

The newest real job of the collection that is `failed` with `error_code = 'unlocked'`, carries a
payment (`payment_tx_hash is not null`) or a waiver (`waived_by is not null`), has
`token_count >= p_token_count`, and is named by no other job's `credit_job_id`. Ordered by
`created_at desc, id desc`, limit 1; null when none. A job cancelled while unpaid has neither a
payment nor a waiver, so it is never a credit. A credited job that fails and is unlocked carries a
waiver, so it is the next credit: the creator's one payment follows the collection until a render
finishes.

```sql
create function public.art_render_credit(p_collection_id uuid, p_token_count integer)
returns uuid language plpgsql stable security definer set search_path = ''
```

For the signed-in owner: refuses a stranger's or unknown collection with 'collection not found'
(42501) through the same owner check the read policies use, then returns the credit job's id or null.
`execute` is granted to `authenticated` only (revoked from `public`, `anon` and `service_role`): it
acts for the signed-in owner, as `art_render_retry` does.

### 4.3 `art_unlock`, redefined

Same signature, grants and search path. It takes the collection's latest real job (`order by
created_at desc, id desc`, `for update`) instead of the open one, after locking the collection row
through `private.lock_owned_collection`. Checks, in this order, all `23514`:

1. No job, `art_locked_at` null, a `done` job, or a job whose `error_code` or `error` is `unlocked`:
   'The art is not locked.'
2. `failed` with `error_code = 'payment-mismatch'`: 'The payment for this job could not be verified.
   Tell support about it.'
3. Any state other than `payment_due` and `failed` (`locked`, `paid`, `waived`, `rendering`,
   `finalizing`): 'The art is paid for and stays locked.'
4. `payment_due` with `payment_tx_hash` set: 'A payment is recorded on this lock, so it stays.'

Then the collection row as today (`art_locked_at` null, `status` from `art_locked` to `draft`, a
generative project's `max_supply` cleared), and the job:

- `payment_due`: as today, `state = 'failed'`, `error = 'unlocked'`, `error_code = 'unlocked'`,
  `finished_at = now()`.
- `failed`: `error_code = 'unlocked'` only. `error`, `finished_at`, `retries`, the payment and the
  batch rows stay as the worker left them.

> **14 October 2026 (whole-branch review):** on a collection that finishes its art later (`art_deferred`), when the latest real job is absent or unlocked, `art_unlock` also takes the collection's latest placeholder job (`order by created_at desc, id desc`, `for update`); if that job is `failed` and not already unlocked it gets `error_code = 'unlocked'` only and the function returns, writing nothing on the collection (a placeholder lock is free and sets no `art_locked_at`), so `art_lock_placeholder` accepts a new lock. In every other case the checks above run on the real job as before, so a deferred collection with no failed placeholder job still reads 'The art is not locked.'

### 4.4 `art_lock`, redefined

Same signature and grants (service role). After its checks and the collection update, before the
insert: `v_credit := private.render_credit(p_collection_id, v_count)`. With a credit the row is
inserted with `state = 'waived'`, `waived_by = p_owner`, `waived_reason = 'credit'`,
`credit_job_id = v_credit.id`, `paid_at = now()`, and the quote columns (`fee_per_token_wei`,
`quote_total_wei`, `quote_chain_id`, `quote_payer`, `quote_factory`, `quote_expires_at`) filled as for
a paid lock, so the row records what the credit was worth. Without a credit the insert is unchanged
(`paid` at a zero total, else `payment_due`). The concurrent-lock case is serialised by the
collection row lock, so a credit is used once.

### 4.5 Sentences

No new sentence. The unlock's refusal of a payment-mismatch job reuses `PAYMENT_UNVERIFIED`, already in
`LOCK_SENTENCES`, so `lockWriteError` passes it through unchanged.

## 5. The credit on the web side

- `ReviewData` (`lib/art/lock-review.ts`) gains `credit: boolean`. The review core calls
  `art_render_credit(p_collection_id, p_token_count)` under the creator's client with the list's token
  count and sets `credit` to whether an id came back. `EMPTY_REVIEW` and the sample review carry
  `false`.
- The review step, with `credit` true: the sentence "Cobweb checks and stores these N tokens exactly as
  they are now, and quotes the fee from this supply. You cannot edit the layers, traits, rules or
  tokens afterwards, unless you unlock before paying." becomes "Cobweb checks and stores these N tokens
  exactly as they are now. The render that failed left a credit, so this lock is free and the render
  starts at once. You cannot edit the layers, traits, rules or tokens afterwards." and "Locking is final
  once the fee is paid. Until then you can unlock and edit again." becomes "Locking is final: the
  credit pays the fee at once." The button keeps its label.
- `JOB_COLUMNS` (`lib/art/render-job.ts`) gains `credit_job_id`; `JobRow.credit_job_id: string | null`;
  `RenderJobBase` gains `credited: boolean` (`row.credit_job_id !== null`; `false` from `pendingJob` and
  in every sample job).
- The pay progression item's receipt for a credited job reads "No fee: covered by the credit from the
  render that failed". The lock core is unchanged: a `waived` job comes back and `startIfReady` sends
  its start message as it does for any waived job. The unlock core is unchanged: its on-chain check
  applies only to an open `payment_due` job, and the database decides the rest.

## 6. The retry action

`app/actions/lock.ts`:

```ts
export async function retryRender(collectionId: string): Promise<ActionResult<RenderJob>>
```

Through `lockWrite`, so the session and ownership checks and the error mapping are the shared ones.
`retryCore(ctx)` in `lib/art/lock-core.ts` calls `art_render_retry` under the creator's client
(`ctx.supabase`; the function refuses the service role), returns `{ error }` on a refusal, otherwise
sends the start message with the returned row's `retries` and returns the job loaded through
`loadJob`.

`lib/render/start.ts`: `startRender(queue, job: { id: string; retries: number }, log?)` takes the
retry count; the message key `<jobId>:start:<retries>` is new for every retry, so it is never dropped
as a duplicate of the first start. `confirmCore` passes `{ id: row.id, retries: row.retries }`.
`startIfReady(queue, job: { id; state }, log?)` keeps sending `retries: 0`: a lock is always a fresh
job. A failed send is logged with the job id and the error's name, never the message, and swallowed:
the job is `rendering` with its batches queued, and the sweep re-sends its start within 15 minutes.

`UploadActions` (`components/upload/upload-shared.ts`) gains `retry(): Promise<ActionResult<RenderJob>>`;
`realActions` maps it to `retryRender`.

## 7. The collage route

`app/api/collections/[id]/collage/route.ts`, `GET`, mirrors `app/api/uploads/[id]/route.ts`:

1. `id` must match the uuid pattern, else 404.
2. `getSessionUser()`, else 404.
3. Under the creator's client: the collection's latest real job in state `done` (`order by created_at
   desc`, limit 1), its `collage_key`. No row, or a null key, is 404; another creator's collection is a
   404 through row-level security.
4. `presignGet(key, 3600, { bucket: renderBucket() })`, then a 302 with
   `Cache-Control: private, max-age=3000`.

`lib/storage/config.ts` gains `renderBucket(): string`, `RENDER_S3_BUCKET` or the throw 'Object
storage is not configured: set RENDER_S3_BUCKET.' `presignGet(key, expiresSeconds = 3600, options?:
{ bucket?: string })` presigns on the given bucket, the art bucket by default. The S3 client is the
shared one: the worker writes the collage with the same endpoint and credentials
(`services/worker/src/env.ts`), and `.env.example` already documents the variable.

## 8. Following the job (`components/upload/render-follow.ts`)

Pure, browser-safe, unit tested. It replaces `render-sim.ts`, which is deleted along with
`followRender` and `retryBatch`. It reads `ART_PROBLEM_CODES` from `@cobweb/shared/render-queue` (it
imports nothing) and `MAX_RENDER_RETRIES` from `lib/art/render-job.ts`; if that module cannot be
imported by the browser, the constant moves to a browser-safe module and the server reads it there.

```ts
export const RENDER_BATCH_SIZE = 100       // moved from render-sim.ts
export const SECONDS_PER_BATCH = 95        // the rough estimate before a rate is observed
export const METADATA_SECONDS = 60
export const POLL_FAST_MS = 3_000
export const POLL_SLOW_MS = 15_000
export const POLL_SLOW_AFTER_MS = 120_000

export function follows(state: RenderJobState): boolean
export function pollInterval(state: RenderJobState, elapsedMs: number): number | false

export type FailureFace = 'art' | 'retry' | 'credit' | 'support'
export type RenderView = {
  phase: 'queued' | 'images' | 'metadata' | 'done'
  total: number
  done: number
  size: number
  /** While rendering: the 1-based batch the worker is retrying on its own, or null. */
  retryingBatch: number | null
  /** Null once the job is done or failed. */
  timeLeftSeconds: number | null
  failure: {
    face: FailureFace
    sentence: string
    code: string | null
    failedBatch: number | null
    retriesLeft: number
  } | null
}
export function faceOf(job: Extract<RenderJob, { state: 'failed' }>): FailureFace
export function renderView(job: RenderJob, nowSeconds: number): RenderView
```

- `follows` is true for `paid`, `waived`, `rendering` and `finalizing`.
- `pollInterval` is `false` when not following, `POLL_FAST_MS` while `elapsedMs < POLL_SLOW_AFTER_MS`,
  else `POLL_SLOW_MS`.
- `faceOf`, in order: `errorCode === 'payment-mismatch'` is `support`; a code in `ART_PROBLEM_CODES`
  is `art` (a retry fails the same way, whatever `retryable` says); `retryable` is `retry`; otherwise
  `credit` (the retries are used up). A job whose code is `unlocked` never reaches the screen (the
  latest-job filter hides it); `faceOf` answers `support` for it all the same.
- `renderView`: `paid` and `waived` are `queued` (done 0); `rendering` is `images`; `finalizing` is
  `metadata`; `done` is `done`; `failed` takes `images` while `done < total`, else `metadata`, with
  `failure` set from the job (`retriesLeft = MAX_RENDER_RETRIES - retries`). `retryingBatch` is the
  rendering job's `failedBatch`. Time left: queued, `total * SECONDS_PER_BATCH + METADATA_SECONDS`;
  images, `remaining * rate + METADATA_SECONDS` where `rate` is `(nowSeconds - startedAt) / done` once
  `done >= 1`, else `SECONDS_PER_BATCH`; metadata, `METADATA_SECONDS`; done and failed, null. A job
  without `batches` (the pending job) is `queued` with `total = max(1, ceil(tokenCount / RENDER_BATCH_SIZE))`.

## 9. The flow and the render step

### 9.1 `upload-flow.tsx`

- `useQuery` from React Query, `queryKey: ['render-job', collectionId]`, `queryFn` calling
  `actions.reload()` and throwing its error sentence on `ok: false`, `enabled: follows(job.state)`,
  `refetchInterval: () => pollInterval(job.state, Date.now() - since)`, `staleTime: 0`. `since` is a
  ref set when the stage enters render and on every retry. The query's data goes through `settle`
  from an effect keyed on the data reference; React Query's structural sharing keeps an unchanged job
  the same reference, so an unchanged poll settles nothing.
- `settle(next)` sets the job and the stage from `STAGE_FOR_JOB` as today, and calls
  `router.refresh()` only when the stage changed or `next.state` is `done` or `failed` (never in
  sample mode). The done stage comes from the job, so a reload lands on the right step; the render
  step no longer has an `onDone` callback.
- A query error does not stop the interval; the render step shows "Cobweb cannot reach the server;
  still trying." while `isError` holds.
- Retry: `since` reset, `actions.retry()`, `settle` on success, the error sentence shown in the alert
  on failure. Unlock from a failed job: `actions.unlock()` then `unlocked()` as today; the refresh
  brings the review back with `credit` true. In sample mode the flow keeps a `creditAfterUnlock` flag
  so the sample review shows the credit line too.
- The done result: `resultOf(job, { collageUrl })` with `collageUrl` `/demo/collage.svg` in sample
  mode, `/api/collections/<id>/collage` when the job has a `collageKey`, else null.

### 9.2 `render-step.tsx`

Rewritten on the view:

```ts
export function RenderStep(props: {
  view: RenderView
  readOnly: boolean
  placeholder?: boolean
  placeholderOnly?: boolean
  busy: boolean
  actionError: string | null
  connectionLost: boolean
  onRetry: () => void
  onUnlock: () => void
})
```

The counter "N of M batches done", the `Progress` bar, the phase rows (Placeholder when `placeholder`;
Render images; Upload metadata to IPFS), "Time left" from `timeLeftSeconds` through `formatDuration`,
and the "You can leave this page" note stay as they are, driven by the view. The `placeholderOnly`
branch stays. Alerts:

- `retryingBatch` set: an informational `Alert`, "Batch N did not render", "The worker retries it on
  its own; the finished batches are kept."
- `failure` set: a destructive `Alert` whose body is the worker's sentence, titled "Batch N did not
  render" when `failedBatch` is set and "The render stopped" otherwise, except the `art` face, titled
  "The art needs a fix", and the `support` face, titled "The payment could not be verified". Under
  the sentence, by face, unless `readOnly`:
  - `art`: "Unlock the art, fix it on the Art screens and lock again. The credit from this render makes
    the next lock free." Button "Unlock and fix the art" (`onUnlock`).
  - `retry`: "The finished batches are kept; a retry renders only the rest. N retries left." Button
    "Try again" (`onRetry`).
  - `credit`: "No retries are left. Unlock and lock again: the credit from this render makes the next
    lock free." Button "Unlock and lock again" (`onUnlock`).
  - `support`: nothing under the sentence.
  `actionError` shows under the button; `busy` disables it with a spinner.
- `connectionLost`: a muted line under the counter.

## 10. The done step

`RenderResult` (`upload-shared.ts`) becomes:

```ts
export type RenderResult = {
  batchCids: string[]
  metadataCid: string | null
  baseUri: string | null
  collageUrl: string | null
  placeholder: RenderPlaceholder | null
  placeholderUri?: string | null
}
export function resultOf(job: Extract<RenderJob, { state: 'done' }>, options: { collageUrl: string | null }): RenderResult
```

A placeholder job's result keeps `batchCids` empty, `metadataCid` and `baseUri` null and `placeholderUri`
set, as today. `DoneStep` shows, in order: the collage (`Artwork`, square, alt "The first 16 tokens",
caption "A preview of the first 16 tokens") when `collageUrl` is set; the rows Metadata CID
(`CopyValue` with the gateway link), Base URI (`CopyValue`), Images as "N batches" opening a
`Collapsible` list of "Batch k" with `CopyValue` and the gateway link for each CID; the Real art and
placeholder rows as today for a deferred result; the Phase 5 footer sentence as today. The sample tile
gallery and `tokenPreview` are removed.

## 11. Sample mode

- `SampleJobState` gains `failed`; `DEMO_RENDER_JOBS.failed` (and the deferred set's) is the rendering
  sample stopped at batch 10: `error` 'The pinning service answered with a different CID.',
  `errorCode: 'cid-mismatch'`, `failedBatch: 10`, `retries: 1`, `retryable: true`. `?job=failed` joins
  `SAMPLE_STATES`. The done sample gets a non-null `collageKey` so the sample done step shows the
  collage; the flow uses the static URL in sample mode. Its extra `imagesCid` field goes: the upload
  screen builds the sample result with `resultOf(DEMO_RENDER_JOBS.done, { collageUrl: '/demo/collage.svg' })`.
- `sampleActions(initial)` keeps a cursor. `reload()` advances it: `paid` or `waived` to `rendering`
  at 0 done; `rendering` by two batches a call until the total, then `finalizing`, then the done
  sample. With the `batch-failed` outcome the run stops two batches after its start at a `failed` job
  with the `cid-mismatch` sentence (`retryable: true`); `retry()` resumes from there as `rendering`
  with no failed batch and the outcome cleared. With the new `art-problem` outcome it stops at a
  `failed` job with `errorCode: 'layer-size'` and the sentence 'The image for trait "Moon" in layer
  "Sky" is 2047 by 2048; every layer image must be 2048 by 2048.'; `unlock()` returns to review as
  today. `UploadOutcome` and `UPLOAD_OUTCOMES` gain `'art-problem'`.
- `apps/web/public/demo/collage.svg`: a hand-written 4 by 4 grid of `<image>` elements over the
  existing `/demo/tokens/<k>.svg` tiles, viewBox square.

## 12. The local render runner

`apps/web/scripts/render-local.ts`, script `render:local`
(`node --conditions=react-server --import ./scripts/resolve-ts.mjs scripts/render-local.ts <collectionId>`).
It refuses any endpoint that is not local, as verify-render does, builds the worker's production
dependencies against local Supabase (service role), local storage (the art and render buckets), Anvil
and a folder pinner under the system temp directory, with the in-memory queue; finds the collection's
jobs in `paid`, `waived`, `rendering` and `finalizing` (real and placeholder); sends each a start
message with its `retries`; runs `runLocal`; prints each job's final state, its CIDs and the pinner's
folder. The dependency builder is shared with verify-render (one module under `apps/web/scripts/`),
so the two cannot drift. The command joins the project's command list.

## 13. Testing

- Unit: `render-follow.test.ts` (`follows`, `pollInterval` at the boundaries, `faceOf` for every face
  and the code precedence, `renderView` for each state, the observed rate and the fallback estimate,
  the pending job); `start.test.ts` (the retry count in the message, `startIfReady` still at 0);
  `upload-shared.test.ts` (`resultOf` with batch CIDs, base URI and collage, the placeholder result).
- `verify:local`, a new section after 9h using the service client and the owner: a real job taken to
  `failed` through `art_claim_render` and a final `art_batch_failed`; `art_unlock` succeeds, the
  sentence is kept, the code is `unlocked`, `art_locked_at` is null and the status `draft`;
  `art_render_credit` answers the job for the same count and for a smaller one, null for a larger one
  and 'collection not found' for the other creator; `art_lock` again at the same count is `waived`
  with `waived_reason = 'credit'`, `credit_job_id` set and `paid_at` set; `art_render_credit` now
  answers null (used); the credited job failed and unlocked is the next credit; `art_unlock` refuses a
  `payment-mismatch` job with `PAYMENT_UNVERIFIED`, a `rendering` job with 'The art is paid for and
  stays locked.', a `done` job and an already unlocked job with 'The art is not locked.'; the unlock
  of an unpaid `payment_due` job still cancels it with both fields `unlocked`.
- `verify:render`: a check that `retryCore` on a failed job (the failing pinner from check 3) answers
  the job `rendering`, the queue holds a start message with `retries` 1, and `runLocal` with the
  folder pinner finishes it to `done`; a check that `presignGet` on the render bucket for the collage
  key answers a URL that fetches with 200 and `image/png`.
- `pnpm typecheck && pnpm lint && pnpm test`, `pnpm build`, `verify:local`, `verify:chain`,
  `verify:storage`, `verify:sweep`, `verify:render`.
- A browser walk with the dev wallet against local Supabase, local storage and Anvil: lock and pay a
  generative collection, run `render:local`, watch the step count batches and reach done with the
  collage, the metadata CID and the batch list, and reload onto the done step; in sample mode
  `?job=rendering` steps to done, `?outcome=batch-failed` shows Try again and the run resumes,
  `?outcome=art-problem` shows Unlock and fix the art and the review comes back with the credit line,
  `?job=failed` shows the retry face.

## 14. Documentation

- `docs/MASTER_PLAN.md`: the Phase 4 status line records the landing on 14 October 2026 and that Phase
  4 is complete, carries the items owed to Phase 5 (the reveal flow owning a deployed collection's
  status; the retry's job selection on a deferred collection that later holds a real job) and the
  minors of section 15; the Art decisions gain a dated **Render credit** entry.
- Dated notes in [2026-10-09-lock-and-pay.md](2026-10-09-lock-and-pay.md) at the `art_unlock` and
  `unlockArt` rows, in [2026-10-12-render-job-state.md](2026-10-12-render-job-state.md) section 7
  (the retry action exists; a failed job can be unlocked) and section 9 (the known gap on art
  problems is closed by the `art` face), and in [2026-10-12-render-worker.md](2026-10-12-render-worker.md)
  section 3 (what the fourth sub-project consumed).
- `CLAUDE.md` gains `render:local`; the upload page's doc comment drops "rendering is simulated".

## 15. Owed and known

- The poll runs the existing action, whose session check is the verified one (an auth round trip a
  poll). A read-only variant of the owner check is an optimisation for when the poll count shows it.
- The time estimate is rough: an observed rate over batches done, 95 seconds a batch before that.
- Polling pauses in a background tab and resumes on return; the global query options keep
  `refetchOnWindowFocus` off, so the first poll after a return waits one interval.
- A credit is never partial: a larger lock pays in full and the older credit stays for a smaller lock.

## 16. Acceptance criteria

- [x] The migration applies on local Supabase; `verify:local` passes with the credit section.
- [x] `art_unlock` cancels a failed paid job and refuses a payment-mismatch, a rendering and an unlocked
      one with the sentences above; `art_lock` records a credited lock `waived` with the link.
- [x] The review shows the credit line when a credit covers the count; the pay item shows the credit
      receipt on a credited job.
- [x] `retryRender` re-queues a failed job with the new retry count; `verify:render` shows the runner
      finishing it.
- [x] The collage route answers 302 to a working presigned URL for the owner and 404 otherwise.
- [x] The screen polls at 3 then 15 seconds, stops at done and failed, shows the four faces, and the
      done step shows the collage, the metadata CID, the base URI and every batch CID.
- [x] `render-sim.ts` is gone; sample mode runs on the reload path with both outcomes.
- [x] Root typecheck, lint, test and build pass; the verify scripts pass; the browser walk is recorded
      in this spec's landing note.

Checked on 14 October 2026 on local Supabase, local storage and Anvil: root typecheck, lint and tests (web 334); next build; verify:local 289 checks; verify:chain 12; verify:storage 15; verify:sweep 8; verify:render 22. Browser walk with the dev wallet: a generative collection of 5 tokens from a folder of 512 by 512 layers (3 layers, 9 traits) was locked on Anvil and paid 0.000125 ETH from the dev wallet, and the render step opened at "0 of 1 batches done" with "Waiting for a render worker", the rough time estimate and the receipt "Paid 0.000125 ETH on Anvil", while the network tab showed one server action call every 3 seconds. render:local with the collection's id printed the start line (real job, paid, retries 0), three deliveries handled with none thrown or dead lettered, the job done with its batch CID, the metadata CID, the base URI, the collage key and the pin folder, and exited 0 in under 3 seconds. Without a reload the next poll replaced the render step with the done step: the collage from /api/collections/<id>/collage, the Metadata CID with its gateway link, the Base URI and "1 batch" under Images opening to the batch CID with its gateway link; the stepper showed the stage done and the Deploy link opened. A reload landed on the done step with the same rows and the collage. In the signed in session a fetch of the collage route got a redirect (opaque to the fetch) that, followed, answered 200 image/png (93,020 bytes) from local storage, and a fresh context without cookies got 404. The five sample checks ran with NEXT_PUBLIC_DEMO_DATA=1 against a collection created for the walk: ?job=rendering rose two batches a poll every 3 seconds to 16 of 16, ran the metadata row and opened the done step with the sample collage, the Metadata CID, the Base URI, "1 batch" and the placeholder rows, with no server action request made; ?job=failed showed "9 of 16 batches done", "Stopped at batch 10", the alert "Batch 10 did not render", "4 retries left." and "Try again", and the run resumed to the done step; ?job=payment_due&outcome=batch-failed stopped the run after the sample payment at "1 of 8 batches done" with "Batch 2 did not render", "5 retries left." and "Try again", and the retry resumed to done; ?job=payment_due&outcome=art-problem stopped at "1 of 8 batches done" with "The art needs a fix", the layer sentence, the unlock advice and "Unlock and fix the art", after which the review's footer read "Locking is final: the credit pays the fee at once.", the lock dialog named the credit, and Lock art, Pay and the run reached done; ?job=done showed the collage and the Metadata, Base URI, Images "1 batch" and Placeholder rows, and with &art=deferred no collage, "Real art / Not rendered yet" and the placeholder base URI row. A second collection was locked and paid: before the payment the pay step offered "Unlock the art" and after it no unlock was offered; render:local finished the job and the done step opened with the collage. A third collection stood in for the wrong size case: the wrong-size layer could not be uploaded because the folder import pins one image size for the whole project, so the art failure was driven by deleting one layer object from the local art bucket after the payment, which failed the job with `missing-image` (render:local printed "Token 1: an image file is missing." and exited 1); the screen showed "0 of 1 batches done", "Stopped at batch 1", the Render images row failed and the alert "The art needs a fix" with the worker's sentence, the unlock advice and "Unlock and fix the art"; after the unlock the stage nav showed Art as next, the review's footer read "Locking is final: the credit pays the fee at once." and the lock dialog read that the render that failed left a credit, so the lock is free and the render starts at once; with the object restored, Lock art skipped the pay step and opened the render step at once with the receipt "No fee: covered by the credit from the render that failed", render:local rendered the waived job to done and the done step opened with the collage, and the job rows showed the first job failed with error_code unlocked and no waiver and the second done with waived_reason credit and credit_job_id naming the first. Also noted during the walk, outside this sub-project: the dev wallet switches chain from the page with wallet_switchEthereumChain and the account menu has no network item, though the dev wallet README still says it does; and in sample mode the ?job=rendering estimate reads about 167 hours, since the demo job's startedAt is nine days before DEMO_NOW, a known minor of the sample data.
