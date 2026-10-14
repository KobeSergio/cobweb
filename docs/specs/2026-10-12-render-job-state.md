# Render job state: specification

Phase 4, second sub-project of four (render core, job state, worker and local runner, screen wiring).
Product decisions: [../MASTER_PLAN.md](../MASTER_PLAN.md#decisions) and the Phase 4 section of the same
file ("batch completion recorded as a set of finished batch numbers; the last one flips the job to
`finalizing` with one conditional update"; "dashboard progress by polling the job row"). Rows:
[2026-10-08-art-tables.md](2026-10-08-art-tables.md) section 4.8 (`render_jobs`, `render_batches`).
Lock functions and conventions: [2026-10-09-lock-and-pay.md](2026-10-09-lock-and-pay.md) sections 6 and 7. What the worker produces: [2026-10-11-render-core.md](2026-10-11-render-core.md) sections 8 and 9.
Legacy reference: [../legacy/artgen-lambda.md](../legacy/artgen-lambda.md) section 7 and 9.2 (at-least-once
delivery, the exactly-once flip).

## 1. Goal

Make a paid or waived render job move through the database truthfully while the worker runs. The
database is the only place the pipeline's state lives: the worker claims a job exactly once, seeds its
batches, records each batch's completion so a redelivered message is harmless, flips to `finalizing`
exactly once when the last batch lands, stores every content id the worker produces, records a failure
with its cause, and lets the creator retry. The collection's status follows the job. The screen and the
worker read one job model.

Nothing here talks to a queue, a Lambda or the chain. The worker (third sub-project) calls these
functions; the screen (fourth sub-project) reads the model and calls the one session function.

## 2. Decisions taken in the design conversation

- The creator retries a failed render from the Lock and upload screen. A session function resets the
  failed batches and the job; finished batches keep their CIDs; a job failed by unlock is never
  retryable. The button and the re-enqueue are the fourth and third sub-projects' work.
- The screen follows a job by polling `getRenderJob` (every 3 seconds while rendering or finalizing,
  15 seconds after two minutes, stopping at done or failed). No Realtime, no new route.
- The worker authenticates with the service role, as the lock functions do. Service functions take the
  job id and check nothing about the caller beyond the role grant; the session function checks the
  owner through `private.lock_owned_collection` with `auth.uid()`, as `art_unlock` does.
- `finalizing` is a real state, as MASTER_PLAN names it.
- `batches_done` is recomputed from the batch rows on every change, never incremented.
- A batch reported done twice with the same CID is a no-op; a different CID is refused.
- `render_jobs.images_cid` is dropped. Each batch directory has its own CID on its batch row.
- On a final failure the collection returns to `art_locked`; it is `rendering` only while a job is
  rendering or finalizing, and `rendered` once a real job is done. A placeholder job never moves the
  collection's status.

## 3. Scope

In:

- Migrations `supabase/migrations/20261012000000_render_state_finalizing.sql` (the enum value alone, since Postgres refuses to use a value added in the same transaction) and `20261012010000_render_job_state.sql`: the columns, the
  five service functions, the session function, the grants, the sentences.
- Regenerated `apps/web/src/lib/database.types.ts`.
- The job model: `JobRow`, `JOB_COLUMNS`, `toRenderJob`, the `RenderJob` union, the stage mapping, the
  sentence set, `renderJobCore` reading the batch rows.
- `verify:local` section 9h and unit tests for the model.
- MASTER_PLAN Phase 4 status line appended; the lock-and-pay spec's deferral sentence annotated.

Out:

- The queue, the Lambda handlers, S3 and Filebase, the on-chain payment re-check, the dead-letter
  consumer, the collage's storage path (third sub-project; it owes `enqueueRender(jobId)` for the retry
  action and the collage key convention outside upload-shaped keys).
- The polling loop, the Try again button, replacing `render-sim.ts` (fourth sub-project).

## 4. States

`render_state` gains `finalizing` (`alter type ... add value 'finalizing' after 'rendering'`).

| From                          | To                                                | By                            | Collection status           |
| ----------------------------- | ------------------------------------------------- | ----------------------------- | --------------------------- |
| paid, waived                  | rendering                                         | `art_claim_render`            | rendering (real jobs only)  |
| rendering                     | finalizing                                        | `art_batch_done` (last batch) | unchanged                   |
| finalizing                    | done                                              | `art_render_finish`           | rendered (real jobs only)   |
| rendering, finalizing         | failed                                            | `art_batch_failed` with final | art_locked (real jobs only) |
| failed (retryable, section 7) | rendering, or finalizing when every batch is done | `art_render_retry` (session)  | rendering (real jobs only)  |

A placeholder job (`kind = 'placeholder'`, one batch) follows the same path. The partial unique index
`render_jobs_one_open_per_kind` treats `finalizing` as open (its predicate is `state not in ('done',
'failed')`, unchanged).

## 5. Columns

`render_jobs`:

- Drop `images_cid`.
- Add `base_uri text` (check `base_uri is null or base_uri ~ '^ipfs://[a-z2-7]{59}/'`), the base URI the
  contract gets: `ipfs://<cid>/` for generative and 1/1, `ipfs://<cid>/metadata.json` for single asset
  and the placeholder.
- Add `placeholder_image_cid text` (check null or `^[a-z2-7]{59}$`), the placeholder's image directory;
  set only on placeholder jobs. The placeholder's metadata CID goes in `metadata_cid`.
- Add `collage_key text` (check null or length between 1 and 256), the storage key of the preview
  collage the worker wrote; null when none.
- Add `error_code text` (check null or length between 1 and 40), the `RenderProblem.code` or the
  worker's own code (`dead-letter`, `payment-mismatch`, `cid-mismatch`); `error` keeps the sentence.
- `metadata_cid` gets the CID format check (null or `^[a-z2-7]{59}$`), and a table constraint
  (`render_jobs_base_uri_matches_metadata`) ties `base_uri` to it: when both are set, `base_uri` starts with
  `ipfs://` followed by the metadata CID and a slash.
- Add `retries integer not null default 0` (check between 0 and 5), how many times the creator retried
  the job; `art_render_retry` increments it and stops at five.
- Replace `render_jobs_done_has_metadata` with `render_jobs_done_complete`: `state <> 'done' or
(metadata_cid is not null and base_uri is not null)`.
- `batches_done` keeps its check; the functions set it to the count of done batch rows.
- For a real job with a token list (1/1 and single asset), `batch_size` and `batches_total` are set at insert by bytes, not fixed at 100 (migration `20261012020000_asset_batch_size.sql`, described in `docs/specs/2026-10-12-render-worker.md`, section 7).

`render_batches`:

- Add `images_size bigint` (check null or `>= 0`), the CAR size the worker uploaded.
- Add `error_code text` (same check as the job's), `started_at timestamptz`, `finished_at timestamptz`.
- `images_cid` keeps its meaning (the batch directory CID); add check null or `^[a-z2-7]{59}$`.
- Add the check `render_batches_done_has_cid`: `state <> 'done' or images_cid is not null`.
- `attempts` keeps counting starts across retries.

Both tables keep their owner-read policies; clients still have no write path. `collection_status`
already has `rendering` and `rendered`.

## 6. Service functions

All `security definer`, `set search_path = ''`, `revoke all from public, anon, authenticated`, `grant
execute to service_role`, refusals raised with errcode 23514 and a plain sentence (section 8). Every
function that writes the collection (`art_claim_render`, `art_batch_failed` when final, `art_render_finish`) locks the collection row first, then the job row, as `art_unlock` does, through the helper `private.lock_job_collection(p_job_id)` (it locks nothing for an unknown job); `art_batch_start` and `art_batch_done` lock only the job row, so no lock cycle is possible. An unknown job id is refused with each function's state sentence (section 8). Every collection status write is conditional on the current status not being `deployed`: a deployed collection keeps its status (the reveal flow in Phase 5 owns it).

```sql
art_claim_render(p_job_id uuid) returns public.render_jobs
```

- State `paid` or `waived`: set `state = 'rendering'`, `started_at = now()`, `batches_done = 0`, clear
  `error` and `error_code`; insert one `render_batches` row per batch `i` in `0 .. batches_total - 1`
  with `state = 'queued'`, `first_token_id = i * batch_size + 1`, `last_token_id = least((i + 1) *
batch_size, token_count)`; for a real job set the collection's status to `rendering`.
- State `rendering`, `finalizing` or `done`: return the row unchanged, inserting nothing and moving no status (idempotent claim, also for a claim redelivered after the job moved on).
- Any other state: "This job is not ready to render." Also refuse when `batches_total <>
ceil(token_count / batch_size)` with "The batch count does not match the token count."
- Returns the job row.

```sql
art_batch_start(p_job_id uuid, p_index integer) returns public.render_batches
```

- Batch `done`: return it unchanged whatever the job's state, checked before the job's state, so a
  start redelivered after the flip or after the finish is skipped by the worker instead of refused.
- Job not `rendering`: "This job is not rendering."
- Batch `queued` or `failed`: set `running`, `attempts = attempts + 1`, `started_at = now()`, clear
  `finished_at`, `error` and `error_code`.
- Batch `running`: return it with `attempts + 1` (a redelivery while another copy runs; the worker's
  output is idempotent, so running twice is wasteful but safe).
- Unknown index: "There is no such batch."

```sql
art_batch_done(p_job_id uuid, p_index integer, p_images_cid text, p_images_size bigint)
  returns table (batches_done integer, last boolean)
```

- Job not `rendering` or `finalizing`: "This job is not rendering." Exception: a job that is `failed`, has batch rows and was not unlocked (`error_code` and `error` are not `unlocked`) takes the result of a batch that was running beside the one that failed: the batch is recorded as below, `batches_done` is recounted, the job stays `failed` and `last` is false. A failed job with no batch rows, and an unlocked one, are still refused.
- Unknown index: "There is no such batch." The batch may be `queued`, `running` or `failed`.
- Batch already `done` with the same CID: no change, `last = false`. Only the CID is compared; a different `p_images_size` is ignored.
- Batch already `done` with a different CID: "This batch was already recorded with a different result."
- Otherwise set `done`, `images_cid`, `images_size`, `finished_at = now()`, clear the error; set the
  job's `batches_done` to the count of done rows; then run one conditional update:
  `update render_jobs set state = 'finalizing' where id = p_job_id and state = 'rendering' and
batches_done = batches_total returning id`; `last` is true exactly when that returned a row. Two
  concurrent calls for the last two batches serialize on the job row lock, so one sees the full count
  and the other sees `finalizing` already set.

```sql
art_batch_failed(p_job_id uuid, p_index integer, p_code text, p_message text, p_final boolean,
  p_retries integer default null) -- p_index nullable
  returns public.render_jobs
```

- `p_index` null is a job-level failure (the metadata step or the worker's own checks), allowed only with `p_final` true; it touches no batch row. Null with `p_final` false: "A job-level failure must be final." This check runs before the job's state is checked.
- Gate order: the null-index rule; the collection, then the job, locked; the `p_retries` staleness check; a final payment mismatch on a done job (returned unchanged); a final failure of a failed job; the pre-claim failure; the state refusal. A final failure whose normalised code is `payment-mismatch` is never ignored as stale: it takes effect whatever `p_retries` says and whatever the job's state among `paid`, `waived`, `rendering`, `finalizing` and `failed` (it sets or overwrites the job to `failed` with that code; on a real job the collection returns to `art_locked`, a deployed one keeping its status); a `done` job is left unchanged, and so is a job that was unlocked, which stays unlocked. Such a report is about the job, so the batch it names is not read or changed, and a finished or unknown batch cannot refuse it.
- `p_retries` is the job's `retries` value the worker saw when it took the work. When it is not null and less than the job's current `retries`, the report is older than the creator's latest retry: nothing changes and the job row is returned. This runs right after the job row is locked, before any state refusal.
- Job not `rendering` or `finalizing`: "This job is not rendering." Exceptions: a final failure for a job that is already `failed` returns the job unchanged (the first code is kept), so a redelivered dead-letter message is acknowledged, except that a `payment-mismatch` code replaces any other stored code and message, so the gate in section 7 holds whichever report arrived first; and a final `payment-mismatch` for a job that is `paid` or `waived`, not yet claimed, fails the job with the code, the message and `finished_at` and leaves the collection's status as it is (`art_locked`). The worker may check the payment before it claims and record a mismatch this way. No other failure can end an unclaimed job (it is refused with the sentence above), since the creator could neither retry nor unlock it.
- Unknown index: "There is no such batch."
- Batch `done`: "This batch is already done." (a failure report after success is a worker bug).
- `p_code` is trimmed and lower-cased, then clamped to its first 40 characters, and an empty or null code is stored as `unknown`, so a malformed code cannot roll back a failure report and `Payment-Mismatch ` is `payment-mismatch`.
- Set the batch `failed`, `error_code` to the normalised code, `error = p_message`, `finished_at = now()`.
- When `p_final`: set the job `failed`, `error_code` to the normalised code, `error = p_message`, `finished_at =
now()`; for a real job set the collection's status to `art_locked`.
- Returns the job row.

```sql
art_render_finish(p_job_id uuid, p_metadata_cid text, p_base_uri text,
  p_placeholder_image_cid text default null, p_collage_key text default null) returns public.render_jobs
```

- Job `done` with the same `metadata_cid`, `base_uri`, `placeholder_image_cid` and `collage_key` (compared with `is not distinct from`): return it unchanged.
- Job `done` with any different value: "This job was already finished with a different result."
- Job not `finalizing`, or any batch row not `done`: "This job has batches still rendering."
- Set `done`, `metadata_cid`, `base_uri`, `placeholder_image_cid`, `collage_key`, `finished_at =
now()`; for a real job set the collection's status to `rendered`.

## 7. Session function

```sql
art_render_retry(p_collection_id uuid) returns public.render_jobs
```

`security definer`, `set search_path = ''`, granted to `authenticated` only. Owner through
`private.lock_owned_collection(p_collection_id, auth.uid())` (42501 'collection not found' for a
stranger, as the lock functions). The job is the collection's latest `real` job (an unlocked one included, so the refusal below can name it). When the collection's `art_deferred` is true and no real job exists, or the latest real job is unlocked (`error_code` or `error` is `unlocked`), the job is the collection's latest `placeholder` job instead, if there is one. The creator may switch to finishing the art later at any time, so a real lock that was unlocked can precede a placeholder job. `execute` is revoked from `service_role` too: the function acts for the signed-in owner.

- No job, or a job not `failed`: "This job has not failed."
- `error_code = 'unlocked'` or `error = 'unlocked'` (`art_unlock` sets both): "This job was unlocked. Lock the art again to render it."
- `error_code = 'payment-mismatch'` (the worker could not verify the on-chain payment): "The payment for this job could not be verified. Tell support about it." (`PAYMENT_UNVERIFIED`).
- `retries` is already 5: "This job has been retried too many times. Tell support about it." (`RETRY_LIMIT`). A support reset is a service-role update of `retries`.
- A failed job with no batch rows (it failed before the claim): "This job is not ready to render."
- Set every batch in state `failed` or `running` to `queued` (a batch left running belongs to a worker that died with the job; attempts kept, error kept until the next start clears it); set
  the job `finalizing` when every batch row is already `done` (a job-level failure in the metadata step; the worker reruns that step) and `rendering` otherwise, clear `error`, `error_code` and `finished_at`, and increment `retries`; for a real job set the
  collection's status to `rendering`. Returns the job row.

The fourth sub-project's `retryRender` action calls this, then the third sub-project's
`enqueueRender(jobId)`, in that order, so a failed enqueue leaves a job that the worker's periodic
sweep (third sub-project) can pick up.

> **14 October 2026:** the retry action exists: `retryRender` calls this function and sends the start message with the returned row's `retries` ([2026-10-14-render-screen-wiring.md](2026-10-14-render-screen-wiring.md), section 6). A failed paid job can also be unlocked now; it keeps its sentence under the code `unlocked` and leaves a credit for the next lock (section 4 there).

## 8. Sentences

Fourteen sentences, added to `LOCK_SENTENCES` in `apps/web/src/lib/art/db-error.ts` and exported from `result.ts`:

- `JOB_NOT_READY = 'This job is not ready to render.'`
- `BATCH_COUNT_MISMATCH = 'The batch count does not match the token count.'`
- `JOB_NOT_RENDERING = 'This job is not rendering.'`
- `NO_SUCH_BATCH = 'There is no such batch.'`
- `BATCH_RESULT_DIFFERS = 'This batch was already recorded with a different result.'`
- `BATCH_ALREADY_DONE = 'This batch is already done.'`
- `JOB_RESULT_DIFFERS = 'This job was already finished with a different result.'`
- `BATCHES_STILL_RENDERING = 'This job has batches still rendering.'`
- `JOB_NOT_FAILED = 'This job has not failed.'`
- `JOB_UNLOCKED = 'This job was unlocked. Lock the art again to render it.'`
- `JOB_FAILURE_NEEDS_FINAL = 'A job-level failure must be final.'`
- `RETRY_LIMIT = 'This job has been retried too many times. Tell support about it.'`
- `PAYMENT_UNVERIFIED = 'The payment for this job could not be verified. Tell support about it.'`
- `PLACEHOLDER_LIMIT = 'The placeholder has been locked too many times. Tell support about it.'` (raised by `art_lock_placeholder` when the collection already has ten placeholder jobs, in any state)

This migration also redefines two functions of `20261009020000_lock_and_pay.sql` with `create or replace`:
`art_unlock` also sets `error_code = 'unlocked'` on the job it cancels, and `art_lock_placeholder`
refuses an eleventh placeholder job after its other refusals and before the insert.

## 9. The job model

`apps/web/src/lib/art/render-job.ts`:

- `JobRow` gains `base_uri`, `placeholder_image_cid`, `collage_key`, `error_code`, `retries`, loses `images_cid`;
  `JOB_COLUMNS` follows. A new `BatchRow` type (`index`, `state`, `attempts`, `images_cid`,
  `images_size`, `error`, `error_code`) and `BATCH_COLUMNS`.
- `toRenderJob(row, batchRows, extra)` takes the job's batch rows ordered by index (empty before
  claim).

`RenderJob` in `apps/web/src/lib/demo/types.ts`:

```ts
type RenderBatches = { total: number; done: number; size: number }

// The render branches of RenderJob; locked, payment_due and the common fields (including payment) are unchanged.
type RenderBranches =
  | { state: 'paid' | 'waived'; batches: RenderBatches }
  | { state: 'rendering'; batches: RenderBatches; startedAt: number; failedBatch: number | null }
  | { state: 'finalizing'; batches: RenderBatches; startedAt: number }
  | {
      state: 'failed'
      batches: RenderBatches
      error: string
      errorCode: string | null
      failedBatch: number | null
      retries: number
      retryable: boolean
    }
  | {
      state: 'done'
      batches: RenderBatches
      startedAt: number
      finishedAt: number
      metadataCid: string
      baseUri: string
      batchCids: string[]
      placeholderImageCid: string | null
      collageKey: string | null
    }
```

(The `locked` and `payment_due` branches and the common fields are unchanged.) `failedBatch` is the
1-based index of the lowest batch row in state `failed`, or null. `retryable` is `errorCode !==
'unlocked' && error !== 'unlocked' && errorCode !== 'payment-mismatch' && retries < MAX_RENDER_RETRIES` (`MAX_RENDER_RETRIES` is 5). `batchCids` is the ordered list of batch `images_cid` values. `placeholderOf` yields
`''` until a placeholder job is done, then the CID from `placeholder_image_cid`.

`renderJobCore` (lock-core.ts) loads the batch rows with the job under the creator's client (owner-read
policy) with one bounded select, only for rendering, finalizing, failed and done jobs (none exist before the claim), and passes them to `toRenderJob`. `STAGE_FOR_JOB` maps `finalizing` to the render stage.
`render-sim.ts` is untouched here; the fourth sub-project replaces it.

The sample data path (`NEXT_PUBLIC_DEMO_DATA`) gets a `finalizing` sample so the stage can be seen.

> **14 October 2026:** the known gap on art problems is closed by the screen: for every code in `ART_PROBLEM_CODES` the failed job shows the `art` face (unlock and fix the art), whatever `retryable` says ([2026-10-14-render-screen-wiring.md](2026-10-14-render-screen-wiring.md), section 8). `RenderJobBase` gained `credited`, and `render-sim.ts` is gone.

## 10. Testing

- `verify:local` section 9h, `artRenderState(A, B)`, after 9g, using the service client and two owner
  sessions, on fixtures locked and paid as 9g does (3 tokens; one fixture keeps batch size 100 for one
  batch, others have `batch_size` set to 1 or 2 through the service client before the claim). Sixty-four
  checks in all: two on the schema (the new job and batch columns exist and `images_cid` is gone from
  `render_jobs`; `finalizing` is a render state and a done job needs its metadata and base URI), then
  these groups:
  1. claim: three batch rows with the right token ranges, job `rendering` with `started_at`, collection
     `rendering`; a second claim returns the same row and inserts nothing; a batch count that does not
     match, a job waiting for payment and an unknown job id are refused; the owner reads the job's batch
     rows and their new columns and a stranger reads none (6 checks).
  2. start: batch 0 becomes `running` with `attempts` 1; a redelivered start keeps `running` and counts
     2; an unknown index is refused with `NO_SUCH_BATCH`; start and done on a job waiting for payment
     are refused (4 checks).
  3. done: batch 0 done gives `batches_done` 1 and `last` false; the same call again changes nothing;
     a different CID is refused with `BATCH_RESULT_DIFFERS`; a start of a done batch returns it
     unchanged; a missing or malformed CID is refused and the batch stays open (5 checks).
  4. the last two batches done concurrently (`Promise.all`): exactly one `last` true, job `finalizing`,
     `batches_done` 3; a redelivered last batch after the flip changes nothing and is not the last; a
     start of a done batch on a finalizing job returns it unchanged (3 checks).
  5. finish: a failure report for a done batch and a finish or failure on a job waiting for payment are
     refused; a base URI built from another CID is refused; job `done` with `metadata_cid`, `base_uri`,
     `finished_at`, collection `rendered`; the same call again is unchanged; different values are
     refused with `JOB_RESULT_DIFFERS`; finish on a `rendering` job is refused with
     `BATCHES_STILL_RENDERING`; a deployed collection keeps its status; a different collage key or
     placeholder image for a done job is refused; a claim redelivered for a done job returns it
     unchanged (10 checks).
  6. failure: on the one-batch fixture, `art_batch_failed` with `p_final` false leaves the job
     `rendering` and the batch `failed` with its code; with `p_final` true the job is `failed` with
     the code and the collection is `art_locked`; a repeated final failure returns the job unchanged;
     a long code is clamped; a deployed collection keeps its status; a job-level failure must be final
     and fails a finalizing job (6 checks).
  7. retry: the owner's session calls `art_render_retry`: job `rendering`, batch `queued`, collection
     `rendering`; after a partial render the finished batch keeps its CID; a job failed in the
     metadata step returns to `finalizing`; a job that has not failed, a stranger ('collection not
     found'), an unlocked job, the sixth retry, a job failed with `payment-mismatch` and a failed job
     with no batch rows are refused; a deployed collection stays deployed; a batch left running is
     queued again; a claim redelivered for a finalizing job returns it unchanged; an unlock leaves the
     error code `unlocked` and a job with that code is refused by name; a code with mixed case and a
     trailing space is stored normalised and the retry is refused; a payment mismatch reported after
     another final failure replaces the code and the retry is refused; a final report carrying an
     older `p_retries` changes nothing, a current one fails the job, and a final payment mismatch with an older value still fails it; a job-level failure on a paid
     job never claimed fails it, the claim is then refused and the collection stays `art_locked`; a
     batch that lands after a sibling failed for good is recorded without a flip and the retry queues
     only the failed one; a failed job with no batch rows still refuses a batch result (20 checks).
  8. access: every service function called with the owner's session and with anon is refused, and
     anon cannot call the retry function, and the service role cannot either (3 checks, two of them
     looping over the functions).
  9. placeholder: a deferred fixture's placeholder job claims (one batch), finishes with a slash-less
     base URI and `placeholder_image_cid`, and the collection's status never changes; a final failure
     and the owner's retry pick the placeholder job and leave the status alone; a deferred collection whose real lock was unlocked retries its failed
     placeholder job; the eleventh placeholder lock is refused with `PLACEHOLDER_LIMIT` (5 checks).
- Unit tests for `toRenderJob` (`render-job.test.ts`): each new state, `failedBatch`, `retryable`,
  `batchCids` order, the placeholder CID.
- Typecheck, lint, the root test suite, `verify:local` (203 plus 9h, 270 checks in all), `verify:storage`, `verify:chain`,
  `verify:sweep`, build.

## 11. Acceptance criteria

- [x] The migration applies on `supabase db reset`; `database.types.ts` regenerated; typecheck and lint
      pass.
- [x] Every function of sections 6 and 7 exists with the signature, grants and refusals given; every
      sentence of section 8 is in `LOCK_SENTENCES`.
- [x] `verify:local` 9h passes all nine groups, including the concurrent last-batch check.
- [x] `toRenderJob` produces every state of section 9 and the screen's stage mapping accepts
      `finalizing`.
- [x] MASTER_PLAN's Phase 4 status line records the landing and the interfaces the third and fourth
      sub-projects consume: the six functions, the `RenderJob` union, `enqueueRender(jobId)` owed by
      the third, `retryRender` owed by the fourth.
