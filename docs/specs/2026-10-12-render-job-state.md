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

| From                  | To         | By                            | Collection status           |
| --------------------- | ---------- | ----------------------------- | --------------------------- |
| paid, waived          | rendering  | `art_claim_render`            | rendering (real jobs only)  |
| rendering             | finalizing | `art_batch_done` (last batch) | unchanged                   |
| finalizing            | done       | `art_render_finish`           | rendered (real jobs only)   |
| rendering, finalizing | failed     | `art_batch_failed` with final | art_locked (real jobs only) |
| failed (not unlocked) | rendering  | `art_render_retry` (session)  | rendering (real jobs only)  |

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
- Replace `render_jobs_done_has_metadata` with `render_jobs_done_complete`: `state <> 'done' or
(metadata_cid is not null and base_uri is not null)`.
- `batches_done` keeps its check; the functions set it to the count of done batch rows.

`render_batches`:

- Add `images_size bigint` (check null or `>= 0`), the CAR size the worker uploaded.
- Add `error_code text` (same check as the job's), `started_at timestamptz`, `finished_at timestamptz`.
- `images_cid` keeps its meaning (the batch directory CID); add check null or `^[a-z2-7]{59}$`.
- `attempts` keeps counting starts across retries.

Both tables keep their owner-read policies; clients still have no write path. `collection_status`
already has `rendering` and `rendered`.

## 6. Service functions

All `security definer`, `set search_path = ''`, `revoke all from public, anon, authenticated`, `grant
execute to service_role`, refusals raised with errcode 23514 and a plain sentence (section 8). Every
function that writes the collection (`art_claim_render`, `art_batch_failed` when final, `art_render_finish`) locks the collection row first, then the job row, as `art_unlock` does; `art_batch_start` and `art_batch_done` lock only the job row, so no lock cycle is possible. Every collection status write is conditional on the current status not being `deployed`: a deployed collection keeps its status (the reveal flow in Phase 5 owns it).

```sql
art_claim_render(p_job_id uuid) returns public.render_jobs
```

- State `paid` or `waived`: set `state = 'rendering'`, `started_at = now()`, `batches_done = 0`, clear
  `error` and `error_code`; insert one `render_batches` row per batch `i` in `0 .. batches_total - 1`
  with `state = 'queued'`, `first_token_id = i * batch_size + 1`, `last_token_id = least((i + 1) *
batch_size, token_count)`; for a real job set the collection's status to `rendering`.
- State `rendering`: return the row unchanged (idempotent claim).
- Any other state: "This job is not ready to render." Also refuse when `batches_total <>
ceil(token_count / batch_size)` with "The batch count does not match the token count."
- Returns the job row.

```sql
art_batch_start(p_job_id uuid, p_index integer) returns public.render_batches
```

- Job not `rendering`: "This job is not rendering."
- Batch `done`: return it unchanged (the worker skips a redelivered finished batch).
- Batch `queued` or `failed`: set `running`, `attempts = attempts + 1`, `started_at = now()`, clear
  `error` and `error_code`.
- Batch `running`: return it with `attempts + 1` (a redelivery while another copy runs; the worker's
  output is idempotent, so running twice is wasteful but safe).
- Unknown index: "There is no such batch."

```sql
art_batch_done(p_job_id uuid, p_index integer, p_images_cid text, p_images_size bigint)
  returns table (batches_done integer, last boolean)
```

- Job not `rendering` or `finalizing`: "This job is not rendering."
- Batch already `done` with the same CID: no change, `last = false`.
- Batch already `done` with a different CID: "This batch was already recorded with a different result."
- Otherwise set `done`, `images_cid`, `images_size`, `finished_at = now()`, clear the error; set the
  job's `batches_done` to the count of done rows; then run one conditional update:
  `update render_jobs set state = 'finalizing' where id = p_job_id and state = 'rendering' and
batches_done = batches_total returning id`; `last` is true exactly when that returned a row. Two
  concurrent calls for the last two batches serialize on the job row lock, so one sees the full count
  and the other sees `finalizing` already set.

```sql
art_batch_failed(p_job_id uuid, p_index integer, p_code text, p_message text, p_final boolean) -- p_index nullable
  returns public.render_jobs
```

- Job not `rendering` or `finalizing`: "This job is not rendering."
- Batch `done`: "This batch is already done." (a failure report after success is a worker bug).
- `p_index` null is a job-level failure (the metadata step or the worker's own checks), allowed only with `p_final` true; it touches no batch row. Null with `p_final` false: "A job-level failure must be final."
- Set the batch `failed`, `error_code = p_code`, `error = p_message`, `finished_at = now()`.
- When `p_final`: set the job `failed`, `error_code = p_code`, `error = p_message`, `finished_at =
now()`; for a real job set the collection's status to `art_locked`.
- Returns the job row.

```sql
art_render_finish(p_job_id uuid, p_metadata_cid text, p_base_uri text,
  p_placeholder_image_cid text default null, p_collage_key text default null) returns public.render_jobs
```

- Job `done` with the same `metadata_cid` and `base_uri`: return it unchanged.
- Job `done` with different values: "This job was already finished with a different result."
- Job not `finalizing`, or any batch row not `done`: "This job has batches still rendering."
- Set `done`, `metadata_cid`, `base_uri`, `placeholder_image_cid`, `collage_key`, `finished_at =
now()`; for a real job set the collection's status to `rendered`.

## 7. Session function

```sql
art_render_retry(p_collection_id uuid) returns public.render_jobs
```

`security definer`, `set search_path = ''`, granted to `authenticated` only. Owner through
`private.lock_owned_collection(p_collection_id, auth.uid())` (42501 'collection not found' for a
stranger, as the lock functions). The job is the collection's latest `real` job, or its `placeholder`
job when the collection is deferred and has no real job (unlocked jobs included, so the refusal below can name them).

- Job not `failed`: "This job has not failed."
- `error = 'unlocked'`: "This job was unlocked. Lock the art again to render it."
- Set every `failed` batch to `queued` (attempts kept, error kept until the next start clears it); set
  the job `finalizing` when every batch row is already `done` (a job-level failure in the metadata step; the worker reruns that step) and `rendering` otherwise, clear `error`, `error_code` and `finished_at`; for a real job set the
  collection's status to `rendering`. Returns the job row.

The fourth sub-project's `retryRender` action calls this, then the third sub-project's
`enqueueRender(jobId)`, in that order, so a failed enqueue leaves a job that the worker's periodic
sweep (third sub-project) can pick up.

## 8. Sentences

Added to `LOCK_SENTENCES` in `apps/web/src/lib/art/db-error.ts` and exported from `result.ts`:

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

## 9. The job model

`apps/web/src/lib/art/render-job.ts`:

- `JobRow` gains `base_uri`, `placeholder_image_cid`, `collage_key`, `error_code`, loses `images_cid`;
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
1-based index of the lowest batch row in state `failed`, or null. `retryable` is `error !==
'unlocked'`. `batchCids` is the ordered list of batch `images_cid` values. `placeholderOf` reads the
real CID from `placeholder_image_cid` when set and keeps `''` only for the sample data path.

`renderJobCore` (lock-core.ts) loads the batch rows with the job under the creator's client (owner-read
policy) and passes them to `toRenderJob`. `STAGE_FOR_JOB` maps `finalizing` to the render stage.
`render-sim.ts` is untouched here; the fourth sub-project replaces it.

The sample data path (`NEXT_PUBLIC_DEMO_DATA`) gets a `finalizing` sample so the stage can be seen.

## 10. Testing

- `verify:local` section 9h, `artRenderState(A, B)`, after 9g, using the service client and two owner
  sessions, on fixtures locked and paid as 9g does (3 tokens; one fixture keeps batch size 100 for one
  batch, a second has `batch_size` set to 1 through the service client before claim for three batches):
  1. claim: three batch rows with the right token ranges, job `rendering` with `started_at`, collection
     `rendering`; a second claim returns the same row and inserts nothing; claim on a `payment_due` job
     is refused with `JOB_NOT_READY`.
  2. start: batch 0 becomes `running` with `attempts` 1; a second start keeps `running` and counts 2;
     an unknown index is refused with `NO_SUCH_BATCH`.
  3. done: batch 0 done gives `batches_done` 1 and `last` false; the same call again changes nothing
     and is `last` false; a different CID is refused with `BATCH_RESULT_DIFFERS`.
  4. the last two batches done concurrently (`Promise.all`): exactly one `last` true, job `finalizing`,
     `batches_done` 3.
  5. finish: job `done` with `metadata_cid`, `base_uri`, `finished_at`, collection `rendered`; the same
     call again is unchanged; different values are refused with `JOB_RESULT_DIFFERS`; finish on a
     `rendering` job is refused with `BATCHES_STILL_RENDERING`.
  6. failure: on the one-batch fixture, start then `art_batch_failed` with `p_final` false leaves the
     job `rendering` and the batch `failed` with its code; with `p_final` true the job is `failed`
     with the code and the collection is `art_locked`.
  7. retry: the owner's session calls `art_render_retry`: job `rendering`, batch `queued`, collection
     `rendering`; a stranger gets 'collection not found'; anon is refused; on a job whose `error` is
     `unlocked` (unlock a locked fixture first) the refusal is `JOB_UNLOCKED`.
  8. access: every service function called with the owner's session and with anon is refused,
     matching the 9g matrix.
  9. placeholder: a deferred fixture's placeholder job claims (one batch), finishes with a slash-less
     base URI and `placeholder_image_cid`, and the collection's status never changes.
- Unit tests for `toRenderJob` (`render-job.test.ts`): each new state, `failedBatch`, `retryable`,
  `batchCids` order, the placeholder CID.
- Typecheck, lint, the root test suite, `verify:local` (203 plus 9h), `verify:storage`, `verify:chain`,
  `verify:sweep`, build.

## 11. Acceptance criteria

- [ ] The migration applies on `supabase db reset`; `database.types.ts` regenerated; typecheck and lint
      pass.
- [ ] Every function of sections 6 and 7 exists with the signature, grants and refusals given; every
      sentence of section 8 is in `LOCK_SENTENCES`.
- [ ] `verify:local` 9h passes all nine groups, including the concurrent last-batch check.
- [ ] `toRenderJob` produces every state of section 9 and the screen's stage mapping accepts
      `finalizing`.
- [ ] MASTER_PLAN's Phase 4 status line records the landing and the interfaces the third and fourth
      sub-projects consume: the six functions, the `RenderJob` union, `enqueueRender(jobId)` owed by
      the third, `retryRender` owed by the fourth.
