# Render Job State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a paid or waived render job move through the database truthfully while the worker runs: claim once, seed batches, record each batch idempotently, flip to `finalizing` exactly once, store every CID, record failures with their cause, let the creator retry, and move the collection's status with the job; then give the screen and the worker one job model.

**Architecture:** Two migrations: `20261012000000_render_state_finalizing.sql` adds the `finalizing` enum value on its own (committed before anything uses it), and `20261012010000_render_job_state.sql` changes the `render_jobs` and `render_batches` columns and constraints and adds five service-role functions (`art_claim_render`, `art_batch_start`, `art_batch_done`, `art_batch_failed`, `art_render_finish`) and one session function (`art_render_retry`), all `security definer` with `set search_path = ''`; every function that writes the collection locks the collection row before the job row, as `art_unlock` does, and every status write leaves a `deployed` collection alone. `verify:local` section 9h (`artRenderState`) proves them, including two concurrent last-batch reports through PostgREST. The job model in `apps/web/src/lib/art/render-job.ts` reads the batch rows (`BatchRow`, `BATCH_COLUMNS`) and maps every state into the `RenderJob` union in `apps/web/src/lib/demo/types.ts`; `renderJobCore` loads the batch rows under the creator's session; the Lock and upload screen maps `finalizing` to its render stage and the sample data gains a `finalizing` job.

**Tech Stack:** Supabase Postgres 17 (local, CLI 2.116) with PL/pgSQL `security definer` functions, `supabase gen types typescript --local`, supabase-js against PostgREST, Next 16 app router, React 19 client components, TypeScript strict on Node 26 (type stripping for scripts), Vitest 5 in the Node environment.

**Spec:** [../specs/2026-10-12-render-job-state.md](../specs/2026-10-12-render-job-state.md)

## Global Constraints

- The spec is the binding authority. Where this plan decides a detail the spec leaves open, the task says so in a line that starts with "Decision:".
- SQL follows `supabase/migrations/20261009020000_lock_and_pay.sql` exactly: a header comment naming the spec, `language plpgsql`, `security definer`, `set search_path = ''`, `revoke all on function ... from public, anon, authenticated` then `grant execute ... to service_role` for the five service functions, `revoke all ... from public, anon` then `grant execute ... to authenticated` for `art_render_retry`, refusals raised with `errcode = '23514'` and the sentence verbatim from spec section 8, `(select auth.uid())` in the session function, table aliases on every column reference, two-space indent, hand formatted.
- Lock order (ruling on spec section 6): every function that writes the collection row (`art_claim_render`, `art_batch_failed` when `p_final`, `art_render_finish`, `art_render_retry`) locks the collection row `for no key update` first and the job row `for update` second, the order `art_unlock` and the other lock-and-pay functions use, so no two functions can wait on each other in opposite orders. The service functions take the collection lock through `private.lock_job_collection(p_job_id)` (Task 2); `art_render_retry` through `private.lock_owned_collection(p_collection_id, (select auth.uid()))`. `art_batch_start` and `art_batch_done` lock only the job row.
- Every collection status write in these functions is conditional: `and c.status <> 'deployed'`. A deployed collection keeps its status; the reveal flow (Phase 5) owns a deployed collection's rendering status.
- The collection's status follows a real job only: `rendering` at claim and retry, `rendered` at finish, `art_locked` after a final failure. A placeholder job (`kind = 'placeholder'`) never writes `collections`.
- The ten sentences of spec section 8, plus the ruling's `A job-level failure must be final.`, character for character: `This job is not ready to render.`, `The batch count does not match the token count.`, `This job is not rendering.`, `There is no such batch.`, `This batch was already recorded with a different result.`, `This batch is already done.`, `This job was already finished with a different result.`, `This job has batches still rendering.`, `This job has not failed.`, `This job was unlocked. Lock the art again to render it.`, `A job-level failure must be final.`
- After any migration change, from the repo root: `supabase db reset`, then `supabase seed buckets`, then `pnpm --filter @cobweb/web verify:local`. After the migration is final for a task: `supabase gen types typescript --local > apps/web/src/lib/database.types.ts` then `pnpm exec prettier --write apps/web/src/lib/database.types.ts`. Never run any of this against anything but localhost.
- `verify:local` checks follow the script's patterns: `check(name, fn)` returning `null` or a description, `callArt`, `expectError`, `expectSentence`, `expectNothing`, `CHECK`, `PERMISSION`, `lockArgs`, `payArgs`, `txHash`, `idOf` (every job id it sees goes to `createdJobIds`, which cleanup deletes before the collections), `lockState`, `countRows`.
- Code style: Prettier (no semicolons, single quotes, trailing commas, 110 columns); run `pnpm exec prettier --write` on every changed TypeScript file before committing. TypeScript strict with `noUncheckedIndexedAccess` and `verbatimModuleSyntax` (`import type` for types). typescript-eslint's recommended rules apply to `apps/web/scripts` too, so no unused variable or parameter is introduced before the task that uses it.
- Copy: plain sentences, no em or en dashes anywhere (code comments included), "Whitelist" never "Allowlist", the product is Cobweb.
- `render-sim.ts` is not touched (spec section 9). Nothing here talks to a queue, a Lambda, S3, Filebase or a chain.
- Implementers never use `rm` and never use `git commit --amend`. To fix a commit, make a new one.
- Commit messages are one imperative sentence with no prefix, and end with exactly these two lines:

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bcHX4HZG5YGWhxjGuiWos
```

- Tests: `pnpm --filter @cobweb/web exec vitest run <file>` for one file; `pnpm typecheck && pnpm lint && pnpm test` at the root before every commit.

## Review Focus

Inputs and failure modes the spec implies but its listed tests would not exercise, most likely to bite first. Each is pinned to the task that owns the code, with its check written there.

1. The last batch's report delivered twice (SQS is at-least-once): the second copy arrives after the job already flipped to `finalizing`. Expected: no change, `last` false, the job stays `finalizing` with `batches_done` 3, so the metadata step is never enqueued twice. Pinned by "art_batch_done: a redelivered last batch after the flip changes nothing and is not the last" in `verify:local` 9h, Task 3, step 1.
2. A retry after a partial render (batch 0 done, batch 1 failed for good): a reset that touched every batch would throw away finished work and its CID. Expected: batch 0 keeps `done` and its CID, only batch 1 goes back to `queued` (keeping its attempts and error code until its next start), the job is `rendering` with `batches_done` 1. Pinned by "art_render_retry: after a partial render the finished batch keeps its CID and only the failed batch is queued", Task 5, step 1.
3. A worker bug that reports a batch done with no CID or a CID that is not base32 CIDv1: a hole in the batch list would later break `batchCids` and the metadata step. Expected: refused with 23514 and the batch stays open. Pinned by the `render_batches_images_cid_valid` and `render_batches_done_has_cid` constraints and the check "art_batch_done: a missing or malformed CID is refused and the batch stays open", Task 3, step 1.
4. A message for a job id that does not exist (a job cleaned up, or a typo in a manual replay): Expected: the state sentence, not a crash or a null row. Pinned by "art_claim_render: an unknown job id is refused", Task 2, step 1 (the other service functions share the same `if not found or ...` guard).
5. A deferred-art collection whose placeholder render fails and is retried: the retry must find the placeholder job (there is no real job) and neither the failure nor the retry may move the collection off `draft`. Pinned by "placeholder render: a final failure and the owner's retry pick the placeholder job and leave the status alone", Task 6, step 1.

## File map

| Path                                                             | Task   | Responsibility                                                                       |
| ---------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------ |
| `supabase/migrations/20261012000000_render_state_finalizing.sql` | 1      | `render_state` gains `finalizing`, committed on its own                              |
| `supabase/migrations/20261012010000_render_job_state.sql`        | 1 to 5 | Columns and constraints (1), then the six functions (2 to 5)                         |
| `apps/web/scripts/verify-local.ts`                               | 1 to 6 | Section 9h `artRenderState(A, B)`, called after `artLockAndPay`                      |
| `apps/web/src/lib/database.types.ts`                             | 1 to 5 | Regenerated after each migration change                                              |
| `apps/web/src/lib/art/render-job.ts`                             | 1, 7   | `JobRow`, `JOB_COLUMNS`, `BatchRow`, `BATCH_COLUMNS`, `toRenderJob`, `placeholderOf` |
| `apps/web/src/lib/art/render-job.test.ts`                        | 1, 7   | The model's unit tests                                                               |
| `apps/web/src/lib/demo/types.ts`                                 | 1, 7   | `RenderJobState` and the `RenderJob` union                                           |
| `apps/web/src/components/upload/upload-flow.tsx`                 | 1, 7   | `STAGE_FOR_JOB`, `renderStartOf`, the done step's result                             |
| `apps/web/src/lib/art/result.ts`                                 | 6      | The ten sentences                                                                    |
| `apps/web/src/lib/art/db-error.ts`, `db-error.test.ts`           | 6      | `LOCK_SENTENCES` passes them through                                                 |
| `apps/web/src/lib/art/lock-core.ts`                              | 7      | `jobFromRow` reads the batch rows (so `renderJobCore`, `loadJob` and `quoteCore` do) |
| `apps/web/src/lib/demo/data.ts`, `data.test.ts`                  | 7      | Sample `finalizing` jobs and the new `done` fields                                   |
| `apps/web/src/app/collections/[id]/upload/page.tsx`              | 7      | `?job=finalizing` in sample mode                                                     |
| `apps/web/src/components/deploy/deploy-screen.tsx`               | 7      | The deferred sample's real metadata stays empty                                      |
| `apps/web/src/app/collections/[id]/manage/page.tsx`              | 7      | `realArtRendered` from `placeholderImageCid`                                         |
| `apps/web/src/app/collections/[id]/manage/settings/page.tsx`     | 7      | Same                                                                                 |
| `docs/MASTER_PLAN.md`, `docs/specs/2026-10-09-lock-and-pay.md`   | 8      | Status line, deferral pointer                                                        |
| `docs/specs/2026-10-12-render-job-state.md`                      | 8      | Acceptance boxes ticked                                                              |

Every hit of `images_cid` or `imagesCid` outside migrations and docs, and what happens to it:

- `apps/web/src/lib/art/render-job.ts:27` (`JobRow.images_cid`) and `:42` (`JOB_COLUMNS`): removed in Task 1.
- `apps/web/src/lib/art/render-job.ts:118` (`imagesCid: row.images_cid`): becomes `imagesCid: null` in Task 1, removed with the new `done` shape in Task 7.
- `apps/web/src/lib/art/render-job.test.ts:31` and `:118`, `:126`: fixture field and done assertion removed in Task 1.
- `apps/web/src/lib/database.types.ts` (eight hits): regenerated in Task 1; the `render_batches` hits stay (the batch column keeps its name).
- `apps/web/src/lib/demo/types.ts:161` (`done.imagesCid`): removed in Task 7.
- `apps/web/src/lib/demo/data.ts:245`, `:265`, `:309`: the real sample keeps an `imagesCid` extra field for the upload screen (Task 7); the deferred sample's `imagesCid: null` is removed (Task 7).
- `apps/web/src/components/upload/upload-screen.tsx:61`, `:71`: unchanged; they read the real sample's extra `imagesCid`.
- `apps/web/src/components/upload/upload-flow.tsx:136`: unchanged (sample result); the done branch builds its result through `resultOf` in Task 7.
- `apps/web/src/components/upload/upload-shared.ts:28`, `:38` and `done-step.tsx:21`, `:28`: unchanged; `RenderResult.imagesCid` is the done step's own field, fed from the first batch CID until the fourth sub-project lists `batchCids`.
- `apps/web/scripts/*`: no hits (`jobFor` in 9g does not select it).

---

### Task 1: The `finalizing` value, the new columns and constraints, the regenerated types and the model's compile fix

**Files:**

- Create: `supabase/migrations/20261012000000_render_state_finalizing.sql`
- Create: `supabase/migrations/20261012010000_render_job_state.sql`
- Modify: `apps/web/scripts/verify-local.ts` (main, after `await artLockAndPay(A, B)` at line 1043; new section 9h after `artLockAndPay`, before `// 10. Cleanup`)
- Modify: `apps/web/src/lib/database.types.ts` (regenerated)
- Modify: `apps/web/src/lib/art/render-job.ts:7-42`, `:98-121`
- Modify: `apps/web/src/lib/art/render-job.test.ts`
- Modify: `apps/web/src/lib/demo/types.ts:69`, `:139-162`
- Modify: `apps/web/src/components/upload/upload-flow.tsx:29-37`

**Interfaces:**

- Consumes: `lockArgs`, `payArgs`, `txHash`, `idOf`, `callArt`, `insertCollection`, `insertArtCollection`, `insertUploadRow`, `insertLayer`, `insertTrait`, `tokenRow`, `describe`, `expectError`, `CHECK` from `verify-local.ts` (sections 9a to 9g).
- Produces (SQL): `render_state` value `finalizing`; `render_jobs.base_uri text`, `placeholder_image_cid text`, `collage_key text`, `error_code text`; `render_jobs.images_cid` dropped; constraint `render_jobs_done_complete`; `render_batches.images_size bigint`, `error_code text`, `started_at timestamptz`, `finished_at timestamptz`; constraints `render_batches_images_cid_valid` and `render_batches_done_has_cid`.
- Produces (verify-local): `const CID: (letter: string) => string` (a valid 59-character base32 CIDv1), `const NO_JOB = '00000000-0000-0000-0000-000000000000'`, `async function renderFixture(A: Creator, payer: string, tag: number, pay = true): Promise<{ cid: string; jobId: string }>` (three tokens, locked, paid with `txHash(tag)` for 75000000000000 wei unless `pay` is false), `async function artRenderState(A: Creator): Promise<void>` (Task 2 widens it to `(A, B)`).
- Produces (TypeScript): `JobRow` without `images_cid` and with `base_uri: string | null`, `placeholder_image_cid: string | null`, `collage_key: string | null`, `error_code: string | null`; `type BatchRow = { index: number; state: Enums<'batch_state'>; attempts: number; images_cid: string | null; images_size: number | null; error: string | null; error_code: string | null }`; `const BATCH_COLUMNS = 'index, state, attempts, images_cid, images_size, error, error_code'`; `RenderJobState` includes `'finalizing'`; the `RenderJob` union gains `RenderJobBase & { state: 'finalizing'; payment: RenderPayment | null; batches: RenderBatches; startedAt: number }`; `STAGE_FOR_JOB.finalizing = 'render'`.

Decision: the enum value goes in its own migration file, before the main one, although spec section 3 names one file. The Supabase CLI applies each migration file in one transaction, and Postgres refuses any use of an enum value in the transaction that added it to an existing type ("unsafe use of new value", SQLSTATE 55P04; confirmed on a scratch Postgres for a PL/pgSQL function that compares against the value). PL/pgSQL bodies are not run at creation, so one file would apply today, but any later statement in that file that compared against `finalizing` (a constraint, a backfill, a SQL-language function) would fail the reset. A file of its own commits the value first.

Decision: `render_batches_done_has_cid` (`state <> 'done' or images_cid is not null`) is added beside the spec's format check, as `render_jobs_done_complete` does for the job: a `done` batch without its directory would leave a hole in `batchCids` (Review Focus 3).

- [ ] **Step 1: Write the failing checks**

In `apps/web/scripts/verify-local.ts`, in `main()`, after the line `await artLockAndPay(A, B)` (line 1043), add:

```ts
await artRenderState(A)
```

Then add this section after the closing brace of `artLockAndPay` and before the `// 10. Cleanup` banner:

```ts
// ---------------------------------------------------------------------------------------------
// 9h. Render job state: the functions the render worker and the retry call
// (docs/specs/2026-10-12-render-job-state.md)
// ---------------------------------------------------------------------------------------------

/** A CIDv1 in base32, as the worker reports them: 59 characters of a to z and 2 to 7. */
const CID = (letter: string) => `bafybei${letter.repeat(52)}`
const NO_JOB = '00000000-0000-0000-0000-000000000000'

/** A generative project of three tokens, locked, and paid for unless `pay` is false. */
async function renderFixture(A: Creator, payer: string, tag: number, pay = true) {
  const col = await insertCollection(A.client)
  if (!col.row) throw new Error(`setup: ${describe(col.error)}`)
  const cid = col.row.id
  const art = (await insertArtCollection(A.client, cid, { size: 3 })).row!.id
  const uploadId = await insertUploadRow(A.client, cid)
  const layer = (await insertLayer(A.client, cid, art)).row!.id
  const traits: string[] = []
  for (const name of ['Wide', 'Sleepy', 'Wink'])
    traits.push((await insertTrait(A.client, cid, layer, { name, upload_id: uploadId })).row!.id)
  const list = traits.map((trait, i) => ({ id: i + 1, collectionId: art, dna: [trait] }))
  const tokens = await A.client.from('tokens').insert(list.map((t) => tokenRow(cid, art, t.id, t.dna)))
  if (tokens.error) throw new Error(`setup: ${describe(tokens.error as DbError)}`)
  const lock = await callArt(admin, 'art_lock', lockArgs(A.userId, cid, list, payer))
  if (lock.error) throw new Error(`setup: lock: ${describe(lock.error)}`)
  const jobId = idOf(lock.data)
  if (pay) {
    const paid = await callArt(
      admin,
      'art_record_payment',
      payArgs(A.userId, cid, jobId, txHash(tag), payer, '75000000000000'),
    )
    if (paid.error) throw new Error(`setup: pay: ${describe(paid.error)}`)
  }
  return { cid, jobId }
}

async function artRenderState(A: Creator): Promise<void> {
  const payer = A.account.address.toLowerCase()
  // One batch (batch size 100, three tokens).
  const one = await renderFixture(A, payer, 102)

  await check(
    'render state: the new job and batch columns exist and render_jobs.images_cid is gone',
    async () => {
      const job = await admin
        .from('render_jobs')
        .select('base_uri, placeholder_image_cid, collage_key, error_code')
        .limit(1)
      if (job.error) return `render_jobs: ${describe(job.error as DbError)}`
      const batch = await admin
        .from('render_batches')
        .select('images_size, error_code, started_at, finished_at')
        .limit(1)
      if (batch.error) return `render_batches: ${describe(batch.error as DbError)}`
      const gone = await admin.from('render_jobs').select('images_cid').limit(1)
      return gone.error ? null : 'render_jobs.images_cid still exists'
    },
  )

  await check(
    'render state: finalizing is a render state, and a done job needs its metadata and base URI',
    async () => {
      const finalizing = await admin
        .from('render_jobs')
        .update({ state: 'finalizing' })
        .eq('id', NO_JOB)
        .select('id')
      if (finalizing.error) return `finalizing: ${describe(finalizing.error as DbError)}`
      const done = await admin
        .from('render_jobs')
        .update({ state: 'done', metadata_cid: CID('m') })
        .eq('id', one.jobId)
        .select('id')
      return expectError(done.error as DbError, CHECK, done.data)
    },
  )
}
```

In `apps/web/src/lib/art/render-job.test.ts`:

Change the import line to:

```ts
import { BATCH_COLUMNS, JOB_COLUMNS, pendingJob, toRenderJob, ZERO_ADDRESS, type JobRow } from './render-job'
```

In the `row` fixture, replace the line `images_cid: null,` with nothing, and replace

```ts
  metadata_cid: null,
  placeholder_upload_id: null,
  onchain_job_id: ONCHAIN,
  error: null,
```

with

```ts
  metadata_cid: null,
  base_uri: null,
  placeholder_image_cid: null,
  collage_key: null,
  placeholder_upload_id: null,
  onchain_job_id: ONCHAIN,
  error: null,
  error_code: null,
```

In the test "maps failed with its error, rendering with its start, done with its CIDs", delete the line `images_cid: 'bafyimages',` from the done row and the line `imagesCid: 'bafyimages',` from its expectation.

After the test "reads every numeric wei column as text", add:

```ts
it('reads the new job columns and the batch columns, and no longer reads images_cid', () => {
  for (const column of ['base_uri', 'placeholder_image_cid', 'collage_key', 'error_code'])
    expect(JOB_COLUMNS).toContain(column)
  expect(JOB_COLUMNS).not.toContain('images_cid')
  expect(BATCH_COLUMNS).toBe('index, state, attempts, images_cid, images_size, error, error_code')
})

it('maps finalizing with its batches and start', () => {
  expect(
    toRenderJob(
      row({ state: 'finalizing', started_at: '2026-10-09T11:00:00+00:00', batches_done: 1 }),
      extra,
    ),
  ).toMatchObject({
    state: 'finalizing',
    startedAt: at('2026-10-09T11:00:00Z'),
    batches: { total: 1, done: 1, size: 100 },
  })
})
```

- [ ] **Step 2: Run the checks and tests to verify they fail**

Run:

```bash
supabase db reset 2>&1 | tail -3
supabase seed buckets
pnpm --filter @cobweb/web verify:local 2>&1 | grep -E '^(FAIL|[0-9]+ passed)'
pnpm --filter @cobweb/web exec vitest run src/lib/art/render-job.test.ts
```

Expected: exactly two FAIL lines:
`FAIL render state: the new job and batch columns exist and render_jobs.images_cid is gone: render_jobs: 42703 column render_jobs.base_uri does not exist` and
`FAIL render state: finalizing is a render state, and a done job needs its metadata and base URI: finalizing: 22P02 invalid input value for enum render_state: "finalizing"`; the summary reads `203 passed, 2 failed`. Vitest: FAIL, `BATCH_COLUMNS` is undefined and the finalizing mapping returns `undefined`.

- [ ] **Step 3: Write the migrations**

Create `supabase/migrations/20261012000000_render_state_finalizing.sql`:

```sql
-- Render job state (docs/specs/2026-10-12-render-job-state.md, section 4): `finalizing`, the state
-- between the last batch landing and the metadata being stored. In a file of its own because the
-- Supabase CLI applies each migration file in one transaction, and Postgres refuses to use an enum
-- value in the transaction that added it ("unsafe use of new value", 55P04). The functions in
-- 20261012010000_render_job_state.sql compare against it, so it is committed first.
alter type public.render_state add value 'finalizing' after 'rendering';
```

The partial index `render_jobs_one_open_per_kind` (`where state not in ('done', 'failed')`) is unchanged and treats `finalizing` as open, as spec section 4 requires.

Create `supabase/migrations/20261012010000_render_job_state.sql`:

```sql
-- Render job state (docs/specs/2026-10-12-render-job-state.md, sections 4 to 8): the functions the
-- render worker calls as it claims a paid or waived job, seeds and runs its batches, flips the job
-- to finalizing when the last batch lands, stores the CIDs and records a failure, and the one the
-- creator calls to retry a failed render. The five service functions take the job id and nothing
-- else about the caller: only the service role runs them (the worker authenticates with it, as the
-- lock functions' server code does). art_render_retry runs as the signed-in creator and checks the
-- owner through private.lock_owned_collection, as art_unlock does. A function that writes the
-- collection row locks it first and the job row second, the order art_unlock uses, so no two
-- functions wait on each other in opposite orders; art_batch_start and art_batch_done lock the job
-- row alone, which serializes two deliveries of one job. The collection follows a real job:
-- rendering while it renders or finalizes, rendered once done, art_locked again after a final
-- failure. A placeholder job never moves the collection's status, and no write moves a deployed
-- collection: the reveal flow (Phase 5) owns its status.

-- ---------------------------------------------------------------------------------------------
-- render_jobs: the base URI, the placeholder image directory, the collage and the error code
-- ---------------------------------------------------------------------------------------------
alter table public.render_jobs
  -- Each batch directory has its own CID on its batch row (section 5).
  drop column images_cid,
  -- What the contract gets: ipfs://<cid>/ for generative and 1/1, ipfs://<cid>/metadata.json for
  -- a single asset and the placeholder.
  add column base_uri text check (base_uri is null or base_uri ~ '^ipfs://[a-z2-7]{59}/'),
  -- The placeholder's image directory; set on placeholder jobs only. Its metadata CID is metadata_cid.
  add column placeholder_image_cid text
    check (placeholder_image_cid is null or placeholder_image_cid ~ '^[a-z2-7]{59}$'),
  -- The storage key of the preview collage the worker wrote; null when there is none.
  add column collage_key text check (collage_key is null or char_length(collage_key) between 1 and 256),
  -- RenderProblem.code, or the worker's own (dead-letter, payment-mismatch, cid-mismatch). error
  -- keeps the sentence.
  add column error_code text check (error_code is null or char_length(error_code) between 1 and 40),
  drop constraint render_jobs_done_has_metadata,
  add constraint render_jobs_done_complete
    check (state <> 'done' or (metadata_cid is not null and base_uri is not null));

-- ---------------------------------------------------------------------------------------------
-- render_batches: the CAR size, the error code, the run's times, a CID that is one
-- ---------------------------------------------------------------------------------------------
alter table public.render_batches
  add column images_size bigint check (images_size is null or images_size >= 0),
  add column error_code text check (error_code is null or char_length(error_code) between 1 and 40),
  add column started_at timestamptz,
  add column finished_at timestamptz,
  add constraint render_batches_images_cid_valid check (images_cid is null or images_cid ~ '^[a-z2-7]{59}$'),
  -- A done batch has its directory: the job's list of batch CIDs never has a hole.
  add constraint render_batches_done_has_cid check (state <> 'done' or images_cid is not null);
```

- [ ] **Step 4: Reset, run, expect the checks to pass**

Run:

```bash
supabase db reset 2>&1 | tail -3
supabase seed buckets
pnpm --filter @cobweb/web verify:local 2>&1 | grep -E '^(FAIL|[0-9]+ passed)'
```

Expected: no `FAIL` lines; `205 passed, 0 failed`. If the reset prints an error, fix the SQL and run the three commands again.

- [ ] **Step 5: Regenerate the types and fix the model to compile**

Run:

```bash
supabase gen types typescript --local > apps/web/src/lib/database.types.ts
pnpm exec prettier --write apps/web/src/lib/database.types.ts
```

Expected in the regenerated file: `Enums.render_state` is `'locked' | 'payment_due' | 'paid' | 'waived' | 'rendering' | 'finalizing' | 'done' | 'failed'`; `Tables.render_jobs.Row` has no `images_cid` and has `base_uri: string | null`, `collage_key: string | null`, `error_code: string | null`, `placeholder_image_cid: string | null`; `Tables.render_batches.Row` has `images_size: number | null`, `error_code: string | null`, `started_at: string | null`, `finished_at: string | null`. The code below relies on `Enums<'render_state'>` (now with `finalizing`, which makes the `toRenderJob` switch need a `finalizing` case) and `Enums<'batch_state'>`.

In `apps/web/src/lib/art/render-job.ts`, replace the lines from `/** A render_jobs row as the lock core reads it` through the end of the `JOB_COLUMNS` declaration (lines 6 to 42) with:

```ts
/** A render_jobs row as the lock core reads it (`JOB_COLUMNS`): the wei columns arrive as text. */
export type JobRow = {
  id: string
  collection_id: string
  kind: Enums<'render_kind'>
  state: Enums<'render_state'>
  token_count: number
  token_list_hash: string | null
  allow_duplicates: boolean
  fee_per_token_wei: string
  quote_total_wei: string
  quote_chain_id: number | null
  quote_payer: string | null
  quote_factory: string | null
  quote_expires_at: string | null
  payment_tx_hash: string | null
  paid_at: string | null
  paid_amount_wei: string | null
  batch_size: number
  batches_total: number
  batches_done: number
  metadata_cid: string | null
  /** What the contract gets: `ipfs://<cid>/`, or `ipfs://<cid>/metadata.json` for a single asset and the placeholder. */
  base_uri: string | null
  /** The placeholder's image directory; set on a placeholder job only. */
  placeholder_image_cid: string | null
  collage_key: string | null
  placeholder_upload_id: string | null
  onchain_job_id: string | null
  error: string | null
  error_code: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
}

/**
 * The select for a `JobRow`. PostgREST returns numeric as a JSON number, which rounds anything past
 * 2^53 wei; the casts keep every wei (Review Focus 3).
 */
export const JOB_COLUMNS =
  'id, collection_id, kind, state, token_count, token_list_hash, allow_duplicates, fee_per_token_wei::text, quote_total_wei::text, quote_chain_id, quote_payer, quote_factory, quote_expires_at, payment_tx_hash, paid_at, paid_amount_wei::text, batch_size, batches_total, batches_done, metadata_cid, base_uri, placeholder_image_cid, collage_key, placeholder_upload_id, onchain_job_id, error, error_code, created_at, started_at, finished_at'

/** A render_batches row as the lock core reads it (`BATCH_COLUMNS`). */
export type BatchRow = {
  index: number
  state: Enums<'batch_state'>
  attempts: number
  /** The batch directory's CID, once the batch is done. */
  images_cid: string | null
  /** The CAR size the worker uploaded, in bytes. */
  images_size: number | null
  error: string | null
  error_code: string | null
}

export const BATCH_COLUMNS = 'index, state, attempts, images_cid, images_size, error, error_code'
```

In the same file, replace the `case 'rendering':` and `case 'done':` branches of the switch in `toRenderJob` with:

```ts
    case 'rendering':
      return { ...base, state: 'rendering', payment, batches, startedAt }
    case 'finalizing':
      return { ...base, state: 'finalizing', payment, batches, startedAt }
    case 'done':
      return {
        ...base,
        state: 'done',
        payment,
        batches,
        startedAt,
        finishedAt: seconds(row.finished_at),
        // render_jobs.images_cid is gone: each batch directory has its CID on its batch row.
        imagesCid: null,
        metadataCid: row.metadata_cid,
      }
```

In `apps/web/src/lib/demo/types.ts`, change line 69 to:

```ts
export type RenderJobState =
  'locked' | 'payment_due' | 'paid' | 'waived' | 'rendering' | 'finalizing' | 'done' | 'failed'
```

and in the `RenderJob` union, after the `state: 'rendering'` member and before the `state: 'done'` member, add:

```ts
  | (RenderJobBase & {
      /** Every batch is in; the metadata is being written and pinned. */
      state: 'finalizing'
      payment: RenderPayment | null
      batches: RenderBatches
      startedAt: number
    })
```

In `apps/web/src/components/upload/upload-flow.tsx`, in `STAGE_FOR_JOB`, after `rendering: 'render',` add:

```ts
  finalizing: 'render',
```

- [ ] **Step 6: Run the tests and the root checks**

Run:

```bash
pnpm --filter @cobweb/web exec vitest run src/lib/art/render-job.test.ts
pnpm exec prettier --write apps/web/scripts/verify-local.ts apps/web/src/lib/art/render-job.ts apps/web/src/lib/art/render-job.test.ts apps/web/src/lib/demo/types.ts apps/web/src/components/upload/upload-flow.tsx
pnpm typecheck && pnpm lint && pnpm test
```

Expected: the render-job tests PASS; typecheck, lint and the root suite are clean.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20261012000000_render_state_finalizing.sql supabase/migrations/20261012010000_render_job_state.sql apps/web/scripts/verify-local.ts apps/web/src/lib/database.types.ts apps/web/src/lib/art/render-job.ts apps/web/src/lib/art/render-job.test.ts apps/web/src/lib/demo/types.ts apps/web/src/components/upload/upload-flow.tsx
git commit -F - <<'MSG'
Add the finalizing render state and the render job and batch columns, and drop the job's images CID

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bcHX4HZG5YGWhxjGuiWos
MSG
```

---

### Task 2: `art_claim_render` and 9h group 1

**Files:**

- Modify: `supabase/migrations/20261012010000_render_job_state.sql` (append)
- Modify: `apps/web/scripts/verify-local.ts` (section 9h and the call in `main`)
- Modify: `apps/web/src/lib/database.types.ts` (regenerated)

**Interfaces:**

- Consumes: `CID`, `NO_JOB`, `renderFixture`, `artRenderState` from Task 1; `lockState`, `countRows`, `expectSentence`, `expectNothing` from 9f and 9g.
- Produces (SQL): `private.lock_job_collection(p_job_id uuid) returns void` (locks the job's collections row `for no key update`; no grants, called only from the definer functions); `public.art_claim_render(p_job_id uuid) returns public.render_jobs`, service role only.
- Produces (verify-local): `artRenderState(A: Creator, B: Creator)`; fixtures `three` (tag 101, set to batch size 1 and three batches before its claim) and `due` (tag 103, locked, never paid); `type RenderJobCheck`, `async function renderJob(id: string): Promise<RenderJobCheck>`, `type BatchCheck`, `async function batchesOf(jobId: string): Promise<BatchCheck[]>` (ordered by index).

- [ ] **Step 1: Write the failing checks**

In `main()`, change `await artRenderState(A)` to:

```ts
await artRenderState(A, B)
```

Change the signature line `async function artRenderState(A: Creator): Promise<void> {` to:

```ts
async function artRenderState(A: Creator, B: Creator): Promise<void> {
```

Above `async function artRenderState`, add:

```ts
type RenderJobCheck = {
  state: string
  batches_done: number
  started_at: string | null
  finished_at: string | null
  metadata_cid: string | null
  base_uri: string | null
  placeholder_image_cid: string | null
  collage_key: string | null
  error: string | null
  error_code: string | null
}

async function renderJob(id: string): Promise<RenderJobCheck> {
  const { data, error } = await admin
    .from('render_jobs')
    .select(
      'state, batches_done, started_at, finished_at, metadata_cid, base_uri, placeholder_image_cid, collage_key, error, error_code',
    )
    .eq('id', id)
    .single()
  if (error) throw new Error(`render job: ${describe(error as DbError)}`)
  return data as RenderJobCheck
}

type BatchCheck = {
  index: number
  state: string
  attempts: number
  first_token_id: number
  last_token_id: number
  images_cid: string | null
  error_code: string | null
  started_at: string | null
  finished_at: string | null
}

async function batchesOf(jobId: string): Promise<BatchCheck[]> {
  const { data, error } = await admin
    .from('render_batches')
    .select(
      'index, state, attempts, first_token_id, last_token_id, images_cid, error_code, started_at, finished_at',
    )
    .eq('job_id', jobId)
    .order('index')
  if (error) throw new Error(`render batches: ${describe(error as DbError)}`)
  return data as BatchCheck[]
}
```

In `artRenderState`, after the line `const one = await renderFixture(A, payer, 102)`, add:

```ts
// Three batches: batch size 1 is set through the service client before the claim.
const three = await renderFixture(A, payer, 101)
// Locked and waiting for payment; unlocked in group 7.
const due = await renderFixture(A, payer, 103, false)
```

At the end of `artRenderState`, append:

```ts
// Group 1: the claim.
await check('art_claim_render: a batch count that does not match the token count is refused', async () => {
  const set = await admin.from('render_jobs').update({ batch_size: 1 }).eq('id', three.jobId)
  if (set.error) return `setup: ${describe(set.error as DbError)}`
  const { error } = await callArt(admin, 'art_claim_render', { p_job_id: three.jobId })
  return expectSentence(error, CHECK, 'The batch count does not match the token count.')
})

await check(
  'art_claim_render: three batch rows with their token ranges, the job and the collection rendering',
  async () => {
    const set = await admin.from('render_jobs').update({ batches_total: 3 }).eq('id', three.jobId)
    if (set.error) return `setup: ${describe(set.error as DbError)}`
    const { data, error } = await callArt(admin, 'art_claim_render', { p_job_id: three.jobId })
    if (error) return describe(error)
    const job = await renderJob(three.jobId)
    const ranges = (await batchesOf(three.jobId))
      .map((b) => `${b.index}:${b.first_token_id}-${b.last_token_id}:${b.state}:${b.attempts}`)
      .join(' ')
    const status = (await lockState(three.cid)).status
    const problems = [
      (data as { id?: string } | null)?.id === three.jobId ? null : `returned ${JSON.stringify(data)}`,
      job.state === 'rendering' && job.started_at !== null && job.batches_done === 0
        ? null
        : JSON.stringify(job),
      ranges === '0:1-1:queued:0 1:2-2:queued:0 2:3-3:queued:0' ? null : `batches ${ranges}`,
      status === 'rendering' ? null : `collection ${status}`,
    ].filter(Boolean)
    return problems.length ? problems.join('; ') : null
  },
)

await check('art_claim_render: a second claim returns the same job and adds no batch', async () => {
  const before = await renderJob(three.jobId)
  const { data, error } = await callArt(admin, 'art_claim_render', { p_job_id: three.jobId })
  if (error) return describe(error)
  const after = await renderJob(three.jobId)
  const count = await countRows('render_batches', 'job_id', three.jobId)
  return (data as { state?: string } | null)?.state === 'rendering' &&
    after.started_at === before.started_at &&
    count === 3
    ? null
    : `${count} batches, ${JSON.stringify(after)}`
})

await check('art_claim_render: a job waiting for payment is refused', async () => {
  const { error } = await callArt(admin, 'art_claim_render', { p_job_id: due.jobId })
  return expectSentence(error, CHECK, 'This job is not ready to render.')
})

await check('art_claim_render: an unknown job id is refused', async () => {
  const { error } = await callArt(admin, 'art_claim_render', { p_job_id: NO_JOB })
  return expectSentence(error, CHECK, 'This job is not ready to render.')
})

await check("render_batches: A reads the job's batch rows and their new columns; B reads none", async () => {
  const mine = await A.client
    .from('render_batches')
    .select('index, images_size, error_code, started_at, finished_at')
    .eq('job_id', three.jobId)
  if (mine.error) return describe(mine.error as DbError)
  if (mine.data.length !== 3) return `A sees ${mine.data.length} rows`
  const theirs = await B.client.from('render_batches').select('index').eq('job_id', three.jobId)
  return expectNothing(theirs.error as DbError, theirs.data)
})
```

- [ ] **Step 2: Run the checks to verify they fail**

Run:

```bash
pnpm --filter @cobweb/web verify:local 2>&1 | grep -E '^(FAIL|[0-9]+ passed)'
```

Expected: six FAIL lines, the five `art_claim_render` checks with `Could not find the function public.art_claim_render(p_job_id) in the schema cache` (PGRST202, shown as `wrong error: PGRST202 ...` for the refusals) and `render_batches: A reads ...: A sees 0 rows`; the summary reads `205 passed, 6 failed`.

- [ ] **Step 3: Write the function**

Append to `supabase/migrations/20261012010000_render_job_state.sql`:

```sql
-- ---------------------------------------------------------------------------------------------
-- The collection lock the writing service functions start with
-- ---------------------------------------------------------------------------------------------

-- Locks the job's collections row `for no key update`, before the caller locks the job row: the
-- order art_unlock, art_render_retry and the lock-and-pay functions take them (collection, then
-- job), so no two functions wait on each other in opposite orders. A job's collection_id never
-- changes, so reading it unlocked is safe. An unknown job locks nothing; the caller refuses it.
-- Security invoker: it runs with the rights of the definer function that calls it.
create function private.lock_job_collection(p_job_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform 1
  from public.collections c
  where c.id = (select j.collection_id from public.render_jobs j where j.id = p_job_id)
  for no key update;
end;
$$;

revoke all on function private.lock_job_collection(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- art_claim_render: a paid or waived job starts rendering and gets its batch rows, once
-- ---------------------------------------------------------------------------------------------
create function public.art_claim_render(p_job_id uuid)
returns public.render_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.render_jobs;
begin
  perform private.lock_job_collection(p_job_id);
  select j.* into v_job from public.render_jobs j where j.id = p_job_id for update;
  if not found or v_job.state not in ('paid', 'waived', 'rendering') then
    raise exception 'This job is not ready to render.' using errcode = '23514';
  end if;
  -- A redelivered claim: the batches are seeded already.
  if v_job.state = 'rendering' then
    return v_job;
  end if;
  -- Numeric division: integer division would turn 3 / 100 into 0 before ceil saw it.
  if v_job.batches_total <> ceil(v_job.token_count::numeric / v_job.batch_size)::integer then
    raise exception 'The batch count does not match the token count.' using errcode = '23514';
  end if;
  insert into public.render_batches (job_id, index, state, first_token_id, last_token_id)
  select v_job.id, g.i, 'queued', g.i * v_job.batch_size + 1, least((g.i + 1) * v_job.batch_size, v_job.token_count)
  from generate_series(0, v_job.batches_total - 1) as g(i);
  update public.render_jobs j
  set state = 'rendering', started_at = now(), batches_done = 0, error = null, error_code = null
  where j.id = v_job.id
  returning * into v_job;
  -- A deployed collection keeps its status: the reveal flow (Phase 5) owns it.
  if v_job.kind = 'real' then
    update public.collections c
    set status = 'rendering'
    where c.id = v_job.collection_id and c.status <> 'deployed';
  end if;
  return v_job;
end;
$$;

revoke all on function public.art_claim_render(uuid) from public, anon, authenticated;
grant execute on function public.art_claim_render(uuid) to service_role;
```

Decision: an unknown job id answers "This job is not ready to render." (the spec names no sentence for it; Review Focus 4). The same `if not found or ...` guard gives every service function its state sentence for an unknown id.

- [ ] **Step 4: Reset, run, expect pass**

Run:

```bash
supabase db reset 2>&1 | tail -3
supabase seed buckets
pnpm --filter @cobweb/web verify:local 2>&1 | grep -E '^(FAIL|[0-9]+ passed)'
```

Expected: no `FAIL` lines; `211 passed, 0 failed`.

- [ ] **Step 5: Regenerate the types; root checks**

Run:

```bash
supabase gen types typescript --local > apps/web/src/lib/database.types.ts
pnpm exec prettier --write apps/web/src/lib/database.types.ts apps/web/scripts/verify-local.ts
pnpm typecheck && pnpm lint && pnpm test
```

Expected: `Database['public']['Functions']['art_claim_render']` has `Args: { p_job_id: string }` and returns the `render_jobs` row type; root checks pass.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261012010000_render_job_state.sql apps/web/scripts/verify-local.ts apps/web/src/lib/database.types.ts
git commit -F - <<'MSG'
Add art_claim_render, which seeds the batch rows once and moves a real collection to rendering

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bcHX4HZG5YGWhxjGuiWos
MSG
```

---

### Task 3: `art_batch_start` and `art_batch_done`, 9h groups 2 to 4

**Files:**

- Modify: `supabase/migrations/20261012010000_render_job_state.sql` (append)
- Modify: `apps/web/scripts/verify-local.ts` (section 9h)
- Modify: `apps/web/src/lib/database.types.ts` (regenerated)

**Interfaces:**

- Consumes: `three` (claimed, three queued batches), `due`, `CID`, `renderJob`, `batchesOf` from Tasks 1 and 2.
- Produces (SQL): `public.art_batch_start(p_job_id uuid, p_index integer) returns public.render_batches`; `public.art_batch_done(p_job_id uuid, p_index integer, p_images_cid text, p_images_size bigint) returns table (batches_done integer, last boolean)`, both service role only. Through PostgREST, `art_batch_done` answers an array of one row: `[{ batches_done: number, last: boolean }]`.
- Produces (verify-local): `type DoneResult = { batches_done: number; last: boolean }`, `const doneOf: (data: unknown) => DoneResult | undefined`. After this task `three` is `finalizing` with batches 0 (`CID('a')`), 1 (`CID('c')`) and 2 (`CID('d')`) done.

Decision: the output columns keep the spec's names `batches_done` and `last`. `batches_done` is also a `render_jobs` column, so the function body starts with `#variable_conflict use_column` and qualifies every column with a table alias; the output row is returned with `return query select ...`, never by assigning the output variables.

- [ ] **Step 1: Write the failing checks**

Above `async function artRenderState`, add:

```ts
type DoneResult = { batches_done: number; last: boolean }
/** art_batch_done returns a table: PostgREST answers an array of one row. */
const doneOf = (data: unknown) => (data as DoneResult[] | null)?.[0]
```

At the end of `artRenderState`, append:

```ts
// Group 2: a batch starts.
await check('art_batch_start: a queued batch runs with its first attempt', async () => {
  const { data, error } = await callArt(admin, 'art_batch_start', { p_job_id: three.jobId, p_index: 0 })
  if (error) return describe(error)
  const batch = data as BatchCheck
  return batch.state === 'running' && batch.attempts === 1 && batch.started_at !== null
    ? null
    : JSON.stringify(batch)
})

await check('art_batch_start: a redelivered start keeps it running and counts the attempt', async () => {
  const { data, error } = await callArt(admin, 'art_batch_start', { p_job_id: three.jobId, p_index: 0 })
  if (error) return describe(error)
  const batch = data as BatchCheck
  return batch.state === 'running' && batch.attempts === 2 ? null : JSON.stringify(batch)
})

await check('art_batch_start: an unknown batch is refused', async () => {
  const { error } = await callArt(admin, 'art_batch_start', { p_job_id: three.jobId, p_index: 3 })
  return expectSentence(error, CHECK, 'There is no such batch.')
})

await check('art_batch_start and art_batch_done: a job waiting for payment is refused', async () => {
  const start = await callArt(admin, 'art_batch_start', { p_job_id: due.jobId, p_index: 0 })
  const done = await callArt(admin, 'art_batch_done', {
    p_job_id: due.jobId,
    p_index: 0,
    p_images_cid: CID('a'),
    p_images_size: 1,
  })
  return (
    expectSentence(start.error, CHECK, 'This job is not rendering.') ??
    expectSentence(done.error, CHECK, 'This job is not rendering.')
  )
})

// Group 3: a batch lands, once.
const batch0 = { p_job_id: three.jobId, p_index: 0, p_images_cid: CID('a'), p_images_size: 1024 }
await check('art_batch_done: batch 0 is recorded; one of three done, not the last', async () => {
  const { data, error } = await callArt(admin, 'art_batch_done', batch0)
  if (error) return describe(error)
  const result = doneOf(data)
  const batch = (await batchesOf(three.jobId))[0]
  const job = await renderJob(three.jobId)
  return result?.batches_done === 1 &&
    result.last === false &&
    batch?.state === 'done' &&
    batch.images_cid === CID('a') &&
    batch.finished_at !== null &&
    job.batches_done === 1 &&
    job.state === 'rendering'
    ? null
    : `${JSON.stringify(result)} ${JSON.stringify(batch)} ${JSON.stringify(job)}`
})

await check('art_batch_done: the same report again changes nothing and is not the last', async () => {
  const before = (await batchesOf(three.jobId))[0]
  const { data, error } = await callArt(admin, 'art_batch_done', batch0)
  if (error) return describe(error)
  const result = doneOf(data)
  const after = (await batchesOf(three.jobId))[0]
  return result?.batches_done === 1 && result.last === false && after?.finished_at === before?.finished_at
    ? null
    : `${JSON.stringify(result)} ${JSON.stringify(after)}`
})

await check('art_batch_done: a different CID for a done batch is refused', async () => {
  const { error } = await callArt(admin, 'art_batch_done', { ...batch0, p_images_cid: CID('b') })
  return expectSentence(error, CHECK, 'This batch was already recorded with a different result.')
})

await check('art_batch_start: a redelivered start of a done batch returns it unchanged', async () => {
  const { data, error } = await callArt(admin, 'art_batch_start', { p_job_id: three.jobId, p_index: 0 })
  if (error) return describe(error)
  const batch = data as BatchCheck
  return batch.state === 'done' && batch.attempts === 2 && batch.images_cid === CID('a')
    ? null
    : JSON.stringify(batch)
})

await check('art_batch_done: a missing or malformed CID is refused and the batch stays open', async () => {
  const missing = await callArt(admin, 'art_batch_done', {
    p_job_id: three.jobId,
    p_index: 1,
    p_images_cid: null,
    p_images_size: 1,
  })
  const malformed = await callArt(admin, 'art_batch_done', {
    p_job_id: three.jobId,
    p_index: 1,
    p_images_cid: 'QmNotBase32',
    p_images_size: 1,
  })
  const problem = expectError(missing.error, CHECK) ?? expectError(malformed.error, CHECK)
  if (problem) return problem
  const batch = (await batchesOf(three.jobId))[1]
  const job = await renderJob(three.jobId)
  return batch?.state === 'queued' && job.batches_done === 1
    ? null
    : `${JSON.stringify(batch)} ${JSON.stringify(job)}`
})

// Group 4: the last two batches land at once. Two PostgREST requests run on two connections, so the
// job row lock really serializes them.
await check(
  'art_batch_done: the last two batches at once flip the job to finalizing exactly once',
  async () => {
    const results = await Promise.all(
      [1, 2].map((index) =>
        callArt(admin, 'art_batch_done', {
          p_job_id: three.jobId,
          p_index: index,
          p_images_cid: CID(index === 1 ? 'c' : 'd'),
          p_images_size: 2048,
        }),
      ),
    )
    const refused = results.find((r) => r.error)
    if (refused) return describe(refused.error)
    const lasts = results.filter((r) => doneOf(r.data)?.last === true).length
    const job = await renderJob(three.jobId)
    return lasts === 1 && job.state === 'finalizing' && job.batches_done === 3
      ? null
      : `${lasts} last, ${JSON.stringify(job)}`
  },
)

await check(
  'art_batch_done: a redelivered last batch after the flip changes nothing and is not the last',
  async () => {
    const { data, error } = await callArt(admin, 'art_batch_done', {
      p_job_id: three.jobId,
      p_index: 2,
      p_images_cid: CID('d'),
      p_images_size: 2048,
    })
    if (error) return describe(error)
    const result = doneOf(data)
    const job = await renderJob(three.jobId)
    return result?.last === false && result.batches_done === 3 && job.state === 'finalizing'
      ? null
      : `${JSON.stringify(result)} ${JSON.stringify(job)}`
  },
)
```

- [ ] **Step 2: Run the checks to verify they fail**

Run:

```bash
pnpm --filter @cobweb/web verify:local 2>&1 | grep -E '^(FAIL|[0-9]+ passed)'
```

Expected: eleven FAIL lines, each naming `Could not find the function public.art_batch_start` or `Could not find the function public.art_batch_done` (PGRST202); the summary reads `211 passed, 11 failed`.

- [ ] **Step 3: Write the functions**

Append to `supabase/migrations/20261012010000_render_job_state.sql`:

```sql
-- ---------------------------------------------------------------------------------------------
-- art_batch_start: a batch's run begins; a redelivered finished batch is skipped
-- ---------------------------------------------------------------------------------------------
create function public.art_batch_start(p_job_id uuid, p_index integer)
returns public.render_batches
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.render_jobs;
  v_batch public.render_batches;
begin
  select j.* into v_job from public.render_jobs j where j.id = p_job_id for update;
  if not found or v_job.state <> 'rendering' then
    raise exception 'This job is not rendering.' using errcode = '23514';
  end if;
  select b.* into v_batch
  from public.render_batches b
  where b.job_id = p_job_id and b.index = p_index
  for update;
  if not found then
    raise exception 'There is no such batch.' using errcode = '23514';
  end if;
  if v_batch.state = 'done' then
    return v_batch;
  end if;
  if v_batch.state = 'running' then
    -- Another copy is running: counted, otherwise untouched. The worker's output is idempotent.
    update public.render_batches b
    set attempts = b.attempts + 1
    where b.job_id = p_job_id and b.index = p_index
    returning * into v_batch;
  else
    update public.render_batches b
    set state = 'running', attempts = b.attempts + 1, started_at = now(), error = null, error_code = null
    where b.job_id = p_job_id and b.index = p_index
    returning * into v_batch;
  end if;
  return v_batch;
end;
$$;

revoke all on function public.art_batch_start(uuid, integer) from public, anon, authenticated;
grant execute on function public.art_batch_start(uuid, integer) to service_role;

-- ---------------------------------------------------------------------------------------------
-- art_batch_done: a batch's directory is recorded once; the last one flips the job to finalizing
-- ---------------------------------------------------------------------------------------------
-- The output columns are named as the spec names them, and batches_done is also a render_jobs
-- column: the directive and the table aliases keep every reference in the body on the column.
create function public.art_batch_done(p_job_id uuid, p_index integer, p_images_cid text, p_images_size bigint)
returns table (batches_done integer, last boolean)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_job public.render_jobs;
  v_batch public.render_batches;
  v_done integer;
  v_flipped uuid;
begin
  select j.* into v_job from public.render_jobs j where j.id = p_job_id for update;
  if not found or v_job.state not in ('rendering', 'finalizing') then
    raise exception 'This job is not rendering.' using errcode = '23514';
  end if;
  select b.* into v_batch
  from public.render_batches b
  where b.job_id = p_job_id and b.index = p_index
  for update;
  if not found then
    raise exception 'There is no such batch.' using errcode = '23514';
  end if;
  if v_batch.state = 'done' then
    if v_batch.images_cid is distinct from p_images_cid then
      raise exception 'This batch was already recorded with a different result.' using errcode = '23514';
    end if;
    -- A redelivered report of the same result: nothing changes, and it is never the last.
    return query select v_job.batches_done, false;
    return;
  end if;
  update public.render_batches b
  set state = 'done', images_cid = p_images_cid, images_size = p_images_size, finished_at = now(),
      error = null, error_code = null
  where b.job_id = p_job_id and b.index = p_index;
  -- Recounted from the rows, never incremented: a redelivery cannot count twice.
  select count(*)::integer into v_done
  from public.render_batches b
  where b.job_id = p_job_id and b.state = 'done';
  update public.render_jobs j set batches_done = v_done where j.id = p_job_id;
  -- The one conditional flip. Calls for the last two batches serialize on the job row lock taken
  -- above: the first sees one batch missing, the second sees the full count and flips.
  update public.render_jobs j
  set state = 'finalizing'
  where j.id = p_job_id and j.state = 'rendering' and j.batches_done = j.batches_total
  returning j.id into v_flipped;
  return query select v_done, v_flipped is not null;
end;
$$;

revoke all on function public.art_batch_done(uuid, integer, text, bigint) from public, anon, authenticated;
grant execute on function public.art_batch_done(uuid, integer, text, bigint) to service_role;
```

`art_batch_start` and `art_batch_done` write no collection row, so they lock the job row alone (Global Constraints, lock order). Why the concurrent check holds: in read committed, the second call's `select ... for update` waits for the first call's transaction, then re-reads the committed job row; its `count(*)` is a new statement with a new snapshot, so it sees the first call's done batch. Exactly one call sees the full count while the job is still `rendering`.

- [ ] **Step 4: Reset, run, expect pass**

Run:

```bash
supabase db reset 2>&1 | tail -3
supabase seed buckets
pnpm --filter @cobweb/web verify:local 2>&1 | grep -E '^(FAIL|[0-9]+ passed)'
```

Expected: no `FAIL` lines; `222 passed, 0 failed`. Run it twice more: the concurrent check must pass every time.

- [ ] **Step 5: Regenerate the types; root checks**

Run:

```bash
supabase gen types typescript --local > apps/web/src/lib/database.types.ts
pnpm exec prettier --write apps/web/src/lib/database.types.ts apps/web/scripts/verify-local.ts
pnpm typecheck && pnpm lint && pnpm test
```

Expected: `art_batch_start` returns the `render_batches` row type; `art_batch_done` has `Args: { p_images_cid: string; p_images_size: number; p_index: number; p_job_id: string }` and `Returns: { batches_done: number; last: boolean }[]`; root checks pass.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261012010000_render_job_state.sql apps/web/scripts/verify-local.ts apps/web/src/lib/database.types.ts
git commit -F - <<'MSG'
Add art_batch_start and art_batch_done, recording each batch once and flipping the job to finalizing exactly once

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bcHX4HZG5YGWhxjGuiWos
MSG
```

---

### Task 4: `art_batch_failed` and `art_render_finish`, 9h groups 5 and 6

**Files:**

- Modify: `supabase/migrations/20261012010000_render_job_state.sql` (append)
- Modify: `apps/web/scripts/verify-local.ts` (section 9h)
- Modify: `apps/web/src/lib/database.types.ts` (regenerated)

**Interfaces:**

- Consumes: `three` (`finalizing`), `one` (paid, one batch), `due`, `CID`, `renderJob`, `batchesOf`, `lockState`, `doneOf` from earlier tasks.
- Produces (verify-local): fixtures `shipped` (tag 105, its collection set to `deployed` through the service client) and `meta` (tag 106, one batch, brought to `finalizing` and failed at job level).
- Produces (SQL): `public.art_batch_failed(p_job_id uuid, p_index integer, p_code text, p_message text, p_final boolean) returns public.render_jobs`, where a null `p_index` is a job-level failure (the metadata step, or the worker's own checks such as `cid-mismatch`), allowed only with `p_final` true and refused otherwise with `A job-level failure must be final.`; `public.art_render_finish(p_job_id uuid, p_metadata_cid text, p_base_uri text, p_placeholder_image_cid text default null, p_collage_key text default null) returns public.render_jobs`, both service role only. After this task `three` is `done` and its collection `rendered`; `one` is `failed` (`error_code` `layer-missing`, error `A layer image is missing.`), its batch `failed` with attempts 1, its collection `art_locked`.

- [ ] **Step 1: Write the failing checks**

In `artRenderState`, after the line `const due = await renderFixture(A, payer, 103, false)`, add:

```ts
// A collection already deployed: the render must not move its status (the reveal flow owns it).
const shipped = await renderFixture(A, payer, 105)
// One batch, brought to finalizing, then failed at job level.
const meta = await renderFixture(A, payer, 106)
```

At the end of `artRenderState`, append:

```ts
// Group 5: the finish.
await check('art_batch_failed: a failure reported for a done batch is refused', async () => {
  const { error } = await callArt(admin, 'art_batch_failed', {
    p_job_id: three.jobId,
    p_index: 0,
    p_code: 'late-report',
    p_message: 'A late failure.',
    p_final: false,
  })
  return expectSentence(error, CHECK, 'This batch is already done.')
})

await check('art_batch_failed and art_render_finish: a job waiting for payment is refused', async () => {
  const failed = await callArt(admin, 'art_batch_failed', {
    p_job_id: due.jobId,
    p_index: 0,
    p_code: 'x',
    p_message: 'x',
    p_final: true,
  })
  const finish = await callArt(admin, 'art_render_finish', {
    p_job_id: due.jobId,
    p_metadata_cid: CID('m'),
    p_base_uri: `ipfs://${CID('m')}/`,
  })
  return (
    expectSentence(failed.error, CHECK, 'This job is not rendering.') ??
    expectSentence(finish.error, CHECK, 'This job has batches still rendering.')
  )
})

const finishArgs = {
  p_job_id: three.jobId,
  p_metadata_cid: CID('m'),
  p_base_uri: `ipfs://${CID('m')}/`,
  p_collage_key: 'collages/verify.webp',
}
await check('art_render_finish: the job is done with its CIDs and the collection is rendered', async () => {
  const { error } = await callArt(admin, 'art_render_finish', finishArgs)
  if (error) return describe(error)
  const job = await renderJob(three.jobId)
  const status = (await lockState(three.cid)).status
  return job.state === 'done' &&
    job.metadata_cid === CID('m') &&
    job.base_uri === `ipfs://${CID('m')}/` &&
    job.collage_key === 'collages/verify.webp' &&
    job.placeholder_image_cid === null &&
    job.finished_at !== null &&
    status === 'rendered'
    ? null
    : `${JSON.stringify(job)} collection ${status}`
})

await check('art_render_finish: the same call again returns the job unchanged', async () => {
  const before = await renderJob(three.jobId)
  const { error } = await callArt(admin, 'art_render_finish', finishArgs)
  if (error) return describe(error)
  const after = await renderJob(three.jobId)
  return after.state === 'done' && after.finished_at === before.finished_at ? null : JSON.stringify(after)
})

await check('art_render_finish: different values for a done job are refused', async () => {
  const { error } = await callArt(admin, 'art_render_finish', { ...finishArgs, p_metadata_cid: CID('n') })
  return expectSentence(error, CHECK, 'This job was already finished with a different result.')
})

await check('art_render_finish: a job still rendering is refused', async () => {
  const claim = await callArt(admin, 'art_claim_render', { p_job_id: one.jobId })
  if (claim.error) return `setup: ${describe(claim.error)}`
  const { error } = await callArt(admin, 'art_render_finish', {
    p_job_id: one.jobId,
    p_metadata_cid: CID('m'),
    p_base_uri: `ipfs://${CID('m')}/`,
  })
  return expectSentence(error, CHECK, 'This job has batches still rendering.')
})

await check(
  'render functions: a deployed collection keeps its status through the claim and the finish',
  async () => {
    const deploy = await admin
      .from('collections')
      .update({ status: 'deployed', chain_id: 31337, contract_address: `0x${'ab'.repeat(20)}` })
      .eq('id', shipped.cid)
    if (deploy.error) return `setup: ${describe(deploy.error as DbError)}`
    const steps: [string, Record<string, unknown>][] = [
      ['art_claim_render', { p_job_id: shipped.jobId }],
      ['art_batch_done', { p_job_id: shipped.jobId, p_index: 0, p_images_cid: CID('g'), p_images_size: 64 }],
      [
        'art_render_finish',
        { p_job_id: shipped.jobId, p_metadata_cid: CID('h'), p_base_uri: `ipfs://${CID('h')}/` },
      ],
    ]
    const seen: string[] = []
    for (const [fn, args] of steps) {
      const { error } = await callArt(admin, fn, args)
      if (error) return `${fn}: ${describe(error)}`
      seen.push((await lockState(shipped.cid)).status)
    }
    const job = await renderJob(shipped.jobId)
    return job.state === 'done' && seen.every((status) => status === 'deployed')
      ? null
      : `${job.state}, statuses ${seen.join(' ')}`
  },
)

// Group 6: failures, on the one-batch job.
const failure = {
  p_job_id: one.jobId,
  p_index: 0,
  p_code: 'layer-missing',
  p_message: 'A layer image is missing.',
}
await check(
  'art_batch_failed: a failure that is not final leaves the job rendering and the batch failed with its code',
  async () => {
    const start = await callArt(admin, 'art_batch_start', { p_job_id: one.jobId, p_index: 0 })
    if (start.error) return `setup: ${describe(start.error)}`
    const { data, error } = await callArt(admin, 'art_batch_failed', { ...failure, p_final: false })
    if (error) return describe(error)
    const job = await renderJob(one.jobId)
    const batch = (await batchesOf(one.jobId))[0]
    return (data as { state?: string } | null)?.state === 'rendering' &&
      job.state === 'rendering' &&
      job.error === null &&
      batch?.state === 'failed' &&
      batch.error_code === 'layer-missing' &&
      batch.finished_at !== null
      ? null
      : `${JSON.stringify(job)} ${JSON.stringify(batch)}`
  },
)

await check(
  'art_batch_failed: a final failure fails the job with its code and returns the collection to art_locked',
  async () => {
    const { error } = await callArt(admin, 'art_batch_failed', { ...failure, p_final: true })
    if (error) return describe(error)
    const job = await renderJob(one.jobId)
    const state = await lockState(one.cid)
    return job.state === 'failed' &&
      job.error_code === 'layer-missing' &&
      job.error === 'A layer image is missing.' &&
      job.finished_at !== null &&
      state.status === 'art_locked' &&
      state.art_locked_at !== null
      ? null
      : `${JSON.stringify(job)} ${JSON.stringify(state)}`
  },
)
await check(
  'art_batch_failed: a job-level failure must be final, and a final one fails a finalizing job and returns the collection to art_locked',
  async () => {
    const claim = await callArt(admin, 'art_claim_render', { p_job_id: meta.jobId })
    if (claim.error) return `setup: claim: ${describe(claim.error)}`
    const done = await callArt(admin, 'art_batch_done', {
      p_job_id: meta.jobId,
      p_index: 0,
      p_images_cid: CID('i'),
      p_images_size: 128,
    })
    if (done.error || doneOf(done.data)?.last !== true) return `setup: done: ${describe(done.error)}`
    const jobLevel = {
      p_job_id: meta.jobId,
      p_index: null,
      p_code: 'cid-mismatch',
      p_message: 'The pinning service returned a different CID.',
    }
    const notFinal = await callArt(admin, 'art_batch_failed', { ...jobLevel, p_final: false })
    const problem = expectSentence(notFinal.error, CHECK, 'A job-level failure must be final.')
    if (problem) return `not final: ${problem}`
    if ((await renderJob(meta.jobId)).state !== 'finalizing') return 'the refused call changed the job'
    const { error } = await callArt(admin, 'art_batch_failed', { ...jobLevel, p_final: true })
    if (error) return describe(error)
    const job = await renderJob(meta.jobId)
    const batch = (await batchesOf(meta.jobId))[0]
    const state = await lockState(meta.cid)
    return job.state === 'failed' &&
      job.error_code === 'cid-mismatch' &&
      job.error === 'The pinning service returned a different CID.' &&
      job.finished_at !== null &&
      batch?.state === 'done' &&
      batch.images_cid === CID('i') &&
      state.status === 'art_locked'
      ? null
      : `${JSON.stringify(job)} ${JSON.stringify(batch)} ${JSON.stringify(state)}`
  },
)
```

- [ ] **Step 2: Run the checks to verify they fail**

Run:

```bash
pnpm --filter @cobweb/web verify:local 2>&1 | grep -E '^(FAIL|[0-9]+ passed)'
```

Expected: ten FAIL lines naming `Could not find the function public.art_batch_failed` or `Could not find the function public.art_render_finish` (PGRST202; the deployed check reaches `art_render_finish` after the claim and the batch, which exist); the summary reads `222 passed, 10 failed`.

- [ ] **Step 3: Write the functions**

Append to `supabase/migrations/20261012010000_render_job_state.sql`:

```sql
-- ---------------------------------------------------------------------------------------------
-- art_batch_failed: a batch's failure with its cause; a final one fails the job. A null index is
-- a job-level failure (the metadata step, or the worker's own checks), allowed only as final.
-- ---------------------------------------------------------------------------------------------
create function public.art_batch_failed(
  p_job_id uuid,
  p_index integer,
  p_code text,
  p_message text,
  p_final boolean
)
returns public.render_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.render_jobs;
  v_batch public.render_batches;
begin
  -- A job-level failure has no batch to retry: it ends the job or it is not reported.
  if p_index is null and p_final is not true then
    raise exception 'A job-level failure must be final.' using errcode = '23514';
  end if;
  -- A final failure writes the collection, so its row is locked before the job row.
  if p_final then
    perform private.lock_job_collection(p_job_id);
  end if;
  select j.* into v_job from public.render_jobs j where j.id = p_job_id for update;
  if not found or v_job.state not in ('rendering', 'finalizing') then
    raise exception 'This job is not rendering.' using errcode = '23514';
  end if;
  if p_index is not null then
    select b.* into v_batch
    from public.render_batches b
    where b.job_id = p_job_id and b.index = p_index
    for update;
    if not found then
      raise exception 'There is no such batch.' using errcode = '23514';
    end if;
    -- A failure reported after the batch's success is a worker bug, not a state to record.
    if v_batch.state = 'done' then
      raise exception 'This batch is already done.' using errcode = '23514';
    end if;
    update public.render_batches b
    set state = 'failed', error_code = p_code, error = p_message, finished_at = now()
    where b.job_id = p_job_id and b.index = p_index;
  end if;
  if p_final then
    update public.render_jobs j
    set state = 'failed', error_code = p_code, error = p_message, finished_at = now()
    where j.id = p_job_id
    returning * into v_job;
    -- A deployed collection keeps its status: the reveal flow (Phase 5) owns it.
    if v_job.kind = 'real' then
      update public.collections c
      set status = 'art_locked'
      where c.id = v_job.collection_id and c.status <> 'deployed';
    end if;
  end if;
  return v_job;
end;
$$;

revoke all on function public.art_batch_failed(uuid, integer, text, text, boolean) from public, anon, authenticated;
grant execute on function public.art_batch_failed(uuid, integer, text, text, boolean) to service_role;

-- ---------------------------------------------------------------------------------------------
-- art_render_finish: the metadata and base URI of a job whose batches are all done
-- ---------------------------------------------------------------------------------------------
create function public.art_render_finish(
  p_job_id uuid,
  p_metadata_cid text,
  p_base_uri text,
  p_placeholder_image_cid text default null,
  p_collage_key text default null
)
returns public.render_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.render_jobs;
begin
  perform private.lock_job_collection(p_job_id);
  select j.* into v_job from public.render_jobs j where j.id = p_job_id for update;
  if found and v_job.state = 'done' then
    if v_job.metadata_cid is not distinct from p_metadata_cid and v_job.base_uri is not distinct from p_base_uri then
      return v_job;
    end if;
    raise exception 'This job was already finished with a different result.' using errcode = '23514';
  end if;
  if not found or v_job.state <> 'finalizing' or exists (
    select 1 from public.render_batches b where b.job_id = p_job_id and b.state <> 'done'
  ) then
    raise exception 'This job has batches still rendering.' using errcode = '23514';
  end if;
  update public.render_jobs j
  set state = 'done',
      metadata_cid = p_metadata_cid,
      base_uri = p_base_uri,
      placeholder_image_cid = p_placeholder_image_cid,
      collage_key = p_collage_key,
      finished_at = now()
  where j.id = p_job_id
  returning * into v_job;
  -- A deployed collection keeps its status: the reveal flow (Phase 5) owns it.
  if v_job.kind = 'real' then
    update public.collections c
    set status = 'rendered'
    where c.id = v_job.collection_id and c.status <> 'deployed';
  end if;
  return v_job;
end;
$$;

revoke all on function public.art_render_finish(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.art_render_finish(uuid, text, text, text, text) to service_role;
```

- [ ] **Step 4: Reset, run, expect pass**

Run:

```bash
supabase db reset 2>&1 | tail -3
supabase seed buckets
pnpm --filter @cobweb/web verify:local 2>&1 | grep -E '^(FAIL|[0-9]+ passed)'
```

Expected: no `FAIL` lines; `232 passed, 0 failed`.

- [ ] **Step 5: Regenerate the types; root checks**

Run:

```bash
supabase gen types typescript --local > apps/web/src/lib/database.types.ts
pnpm exec prettier --write apps/web/src/lib/database.types.ts apps/web/scripts/verify-local.ts
pnpm typecheck && pnpm lint && pnpm test
```

Expected: `art_batch_failed` and `art_render_finish` return the `render_jobs` row type; `art_render_finish` has `p_collage_key?: string` and `p_placeholder_image_cid?: string`; root checks pass.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261012010000_render_job_state.sql apps/web/scripts/verify-local.ts apps/web/src/lib/database.types.ts
git commit -F - <<'MSG'
Add art_batch_failed and art_render_finish, recording batch and job-level failures with their codes and storing the finished job's CIDs

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bcHX4HZG5YGWhxjGuiWos
MSG
```

---

### Task 5: `art_render_retry`, 9h groups 7 and 8

**Files:**

- Modify: `supabase/migrations/20261012010000_render_job_state.sql` (append)
- Modify: `apps/web/scripts/verify-local.ts` (section 9h)
- Modify: `apps/web/src/lib/database.types.ts` (regenerated)

**Interfaces:**

- Consumes: `one` (`failed`), `three`, `due` (`payment_due`), `renderFixture`, `renderJob`, `batchesOf`, `lockState`, `anon` from earlier tasks.
- Produces (SQL): `public.art_render_retry(p_collection_id uuid) returns public.render_jobs`, granted to `authenticated` only. The third sub-project's sweep and the fourth sub-project's `retryRender` rely on it leaving the job `rendering` with its failed batches `queued`.
- Produces (verify-local): fixture `two` (tag 104, batch size 2, two batches). Consumes `meta` (Task 4: `failed` at job level, its one batch `done`, collection `art_locked`).

Decision (ruling on the retry after a job-level failure): `art_render_retry` sets the job `finalizing` when every batch row is `done` (nothing to re-queue; the metadata step reruns) and `rendering` otherwise. The worker's sweep re-enqueues the metadata step for a job left `finalizing` with no pending work.

Decision: the job is chosen as spec section 7 states it: the collection's latest `real` job (by `created_at`, then `id`), or, when the art is deferred and there is no real job, its latest `placeholder` job. Unlike `latestJobRow` in `lock-core.ts`, a job cancelled by an unlock is not skipped, so it is refused by name ("This job was unlocked. ...") instead of "This job has not failed." when it is the latest.

- [ ] **Step 1: Write the failing checks**

In `artRenderState`, after the line `const due = await renderFixture(A, payer, 103, false)`, add:

```ts
// Two batches (batch size 2): one finishes, one fails for good, then the retry.
const two = await renderFixture(A, payer, 104)
```

At the end of `artRenderState`, append:

```ts
// Group 7: the retry.
await check("art_render_retry: the owner's retry queues the failed batch and renders again", async () => {
  const { data, error } = await callArt(A.client, 'art_render_retry', { p_collection_id: one.cid })
  if (error) return describe(error)
  const job = await renderJob(one.jobId)
  const batch = (await batchesOf(one.jobId))[0]
  const status = (await lockState(one.cid)).status
  return (data as { id?: string } | null)?.id === one.jobId &&
    job.state === 'rendering' &&
    job.error === null &&
    job.error_code === null &&
    job.finished_at === null &&
    batch?.state === 'queued' &&
    batch.attempts === 1 &&
    status === 'rendering'
    ? null
    : `${JSON.stringify(job)} ${JSON.stringify(batch)} collection ${status}`
})

await check(
  'art_render_retry: after a partial render the finished batch keeps its CID and only the failed batch is queued',
  async () => {
    const set = await admin
      .from('render_jobs')
      .update({ batch_size: 2, batches_total: 2 })
      .eq('id', two.jobId)
    if (set.error) return `setup: ${describe(set.error as DbError)}`
    const steps: [string, Record<string, unknown>][] = [
      ['art_claim_render', { p_job_id: two.jobId }],
      ['art_batch_done', { p_job_id: two.jobId, p_index: 0, p_images_cid: CID('f'), p_images_size: 4096 }],
      ['art_batch_start', { p_job_id: two.jobId, p_index: 1 }],
      [
        'art_batch_failed',
        {
          p_job_id: two.jobId,
          p_index: 1,
          p_code: 'render-timeout',
          p_message: 'The batch took too long.',
          p_final: true,
        },
      ],
    ]
    for (const [fn, args] of steps) {
      const { error } = await callArt(admin, fn, args)
      if (error) return `setup: ${fn}: ${describe(error)}`
    }
    const retry = await callArt(A.client, 'art_render_retry', { p_collection_id: two.cid })
    if (retry.error) return describe(retry.error)
    const job = await renderJob(two.jobId)
    const batches = (await batchesOf(two.jobId))
      .map((b) => `${b.index}:${b.state}:${b.images_cid ?? '-'}:${b.attempts}:${b.error_code ?? '-'}`)
      .join(' ')
    const expected = `0:done:${CID('f')}:0:- 1:queued:-:1:render-timeout`
    return job.state === 'rendering' && job.batches_done === 1 && batches === expected
      ? null
      : `${JSON.stringify(job)} ${batches}`
  },
)

await check(
  'art_render_retry: after a job-level failure with every batch done, the job goes back to finalizing',
  async () => {
    const { error } = await callArt(A.client, 'art_render_retry', { p_collection_id: meta.cid })
    if (error) return describe(error)
    const job = await renderJob(meta.jobId)
    const batches = (await batchesOf(meta.jobId))
      .map((b) => `${b.index}:${b.state}:${b.images_cid ?? '-'}`)
      .join(' ')
    const status = (await lockState(meta.cid)).status
    return job.state === 'finalizing' &&
      job.error === null &&
      job.error_code === null &&
      job.finished_at === null &&
      job.batches_done === 1 &&
      batches === `0:done:${CID('i')}` &&
      status === 'rendering'
      ? null
      : `${JSON.stringify(job)} ${batches} collection ${status}`
  },
)

await check('art_render_retry: a job that has not failed is refused', async () => {
  const { error } = await callArt(A.client, 'art_render_retry', { p_collection_id: one.cid })
  return expectSentence(error, CHECK, 'This job has not failed.')
})

await check("art_render_retry: B's session on A's collection is refused as not found", async () => {
  const { error } = await callArt(B.client, 'art_render_retry', { p_collection_id: one.cid })
  return expectSentence(error, PERMISSION, 'collection not found')
})

await check('art_render_retry: a job cancelled by an unlock is refused by name', async () => {
  const unlock = await callArt(A.client, 'art_unlock', { p_collection_id: due.cid })
  if (unlock.error) return `setup: ${describe(unlock.error)}`
  const { error } = await callArt(A.client, 'art_render_retry', { p_collection_id: due.cid })
  return expectSentence(error, CHECK, 'This job was unlocked. Lock the art again to render it.')
})

// Group 8: who may call them. The five service functions take a job id and check nothing else, so
// only the service role may run them.
const renderCalls: [string, Record<string, unknown>][] = [
  ['art_claim_render', { p_job_id: three.jobId }],
  ['art_batch_start', { p_job_id: one.jobId, p_index: 0 }],
  ['art_batch_done', { p_job_id: one.jobId, p_index: 0, p_images_cid: CID('e'), p_images_size: 1 }],
  ['art_batch_failed', { p_job_id: one.jobId, p_index: 0, p_code: 'x', p_message: 'x', p_final: true }],
  [
    'art_render_finish',
    { p_job_id: three.jobId, p_metadata_cid: CID('m'), p_base_uri: `ipfs://${CID('m')}/` },
  ],
]
await check(
  "render functions: the owner's own session cannot execute the five service functions",
  async () => {
    const problems: string[] = []
    for (const [fn, args] of renderCalls) {
      const { error } = await callArt(A.client, fn, args)
      const problem = expectSentence(error, PERMISSION, 'permission denied')
      if (problem) problems.push(`${fn}: ${problem}`)
    }
    return problems.length ? problems.join('; ') : null
  },
)

await check(
  'render functions: a signed-out caller cannot execute any of them, and nothing changed',
  async () => {
    const problems: string[] = []
    for (const [fn, args] of [
      ...renderCalls,
      ['art_render_retry', { p_collection_id: one.cid }] as [string, Record<string, unknown>],
    ]) {
      const { error } = await callArt(anon, fn, args)
      const problem = expectError(error, PERMISSION)
      if (problem) problems.push(`${fn}: ${problem}`)
    }
    const job = await renderJob(one.jobId)
    const batch = (await batchesOf(one.jobId))[0]
    if (job.state !== 'rendering' || batch?.state !== 'queued')
      problems.push(`changed: ${JSON.stringify(job)} ${JSON.stringify(batch)}`)
    return problems.length ? problems.join('; ') : null
  },
)
```

- [ ] **Step 2: Run the checks to verify they fail**

Run:

```bash
pnpm --filter @cobweb/web verify:local 2>&1 | grep -E '^(FAIL|[0-9]+ passed)'
```

Expected: seven FAIL lines: the six `art_render_retry` checks (`Could not find the function public.art_render_retry(p_collection_id) in the schema cache`, PGRST202) and the signed-out check (`art_render_retry: wrong error: PGRST202 ...`). The owner's-session check already passes, since Tasks 2 to 4 granted the five service functions to the service role only. The summary reads `233 passed, 7 failed`.

- [ ] **Step 3: Write the function**

Append to `supabase/migrations/20261012010000_render_job_state.sql`:

```sql
-- ---------------------------------------------------------------------------------------------
-- art_render_retry: the creator retries a failed render; finished batches keep their CIDs
-- ---------------------------------------------------------------------------------------------
create function public.art_render_retry(p_collection_id uuid)
returns public.render_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_collection public.collections;
  v_job public.render_jobs;
begin
  -- The collection row first, then the job row: the order every writing function here uses.
  v_collection := private.lock_owned_collection(p_collection_id, (select auth.uid()));
  -- The collection's latest real job, or its placeholder job when the art is deferred and no real
  -- job exists. A job cancelled by an unlock counts here, so it is refused by name below.
  select j.* into v_job
  from public.render_jobs j
  where j.collection_id = v_collection.id and j.kind = 'real'
  order by j.created_at desc, j.id desc
  limit 1
  for update;
  if not found and v_collection.art_deferred then
    select j.* into v_job
    from public.render_jobs j
    where j.collection_id = v_collection.id and j.kind = 'placeholder'
    order by j.created_at desc, j.id desc
    limit 1
    for update;
  end if;
  -- A select into that finds nothing leaves every field null.
  if v_job.id is null or v_job.state <> 'failed' then
    raise exception 'This job has not failed.' using errcode = '23514';
  end if;
  if v_job.error = 'unlocked' then
    raise exception 'This job was unlocked. Lock the art again to render it.' using errcode = '23514';
  end if;
  -- Attempts are kept; each batch's error stays until its next start clears it.
  update public.render_batches b set state = 'queued' where b.job_id = v_job.id and b.state = 'failed';
  -- With every batch done (a job-level failure in the metadata step) nothing is re-queued: the job
  -- goes back to finalizing and the metadata step reruns. Otherwise it renders the queued batches.
  update public.render_jobs j
  set state = case
        when exists (select 1 from public.render_batches b where b.job_id = j.id and b.state <> 'done')
          then 'rendering'::public.render_state
        else 'finalizing'::public.render_state
      end,
      error = null, error_code = null, finished_at = null
  where j.id = v_job.id and j.collection_id = p_collection_id
  returning * into v_job;
  -- A deployed collection keeps its status: the reveal flow (Phase 5) owns it.
  if v_job.kind = 'real' then
    update public.collections c
    set status = 'rendering'
    where c.id = v_collection.id and c.status <> 'deployed';
  end if;
  return v_job;
end;
$$;

revoke all on function public.art_render_retry(uuid) from public, anon;
grant execute on function public.art_render_retry(uuid) to authenticated;
```

- [ ] **Step 4: Reset, run, expect pass**

Run:

```bash
supabase db reset 2>&1 | tail -3
supabase seed buckets
pnpm --filter @cobweb/web verify:local 2>&1 | grep -E '^(FAIL|[0-9]+ passed)'
```

Expected: no `FAIL` lines; `240 passed, 0 failed`.

- [ ] **Step 5: Regenerate the types; root checks**

Run:

```bash
supabase gen types typescript --local > apps/web/src/lib/database.types.ts
pnpm exec prettier --write apps/web/src/lib/database.types.ts apps/web/scripts/verify-local.ts
pnpm typecheck && pnpm lint && pnpm test
```

Expected: `art_render_retry` has `Args: { p_collection_id: string }` and returns the `render_jobs` row type; root checks pass.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261012010000_render_job_state.sql apps/web/scripts/verify-local.ts apps/web/src/lib/database.types.ts
git commit -F - <<'MSG'
Add art_render_retry for the creator, returning a job with every batch done to finalizing, and check who may call the render functions

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bcHX4HZG5YGWhxjGuiWos
MSG
```

---

### Task 6: The placeholder path (9h group 9) and the sentences

**Files:**

- Modify: `apps/web/scripts/verify-local.ts` (section 9h)
- Modify: `apps/web/src/lib/art/result.ts` (after line 60)
- Modify: `apps/web/src/lib/art/db-error.ts:1-39`, `:70-97`
- Test: `apps/web/src/lib/art/db-error.test.ts`

**Interfaces:**

- Consumes: the six functions (Tasks 2 to 5); `recordUpload`, `insertCollection`, `idOf`, `doneOf`, `renderJob`, `batchesOf`, `lockState` in `verify-local.ts`.
- Produces: exported constants in `apps/web/src/lib/art/result.ts`: `JOB_NOT_READY`, `BATCH_COUNT_MISMATCH`, `JOB_NOT_RENDERING`, `NO_SUCH_BATCH`, `BATCH_RESULT_DIFFERS`, `BATCH_ALREADY_DONE`, `JOB_RESULT_DIFFERS`, `BATCHES_STILL_RENDERING`, `JOB_NOT_FAILED`, `JOB_UNLOCKED` (strings of spec section 8) and `JOB_FAILURE_NEEDS_FINAL` (the ruling's `A job-level failure must be final.`); `lockWriteError` returns each of them as it is for code 23514. The fourth sub-project's `retryRender` maps `art_render_retry` errors through `lockWriteError`.

- [ ] **Step 1: Write the checks and the failing test**

At the end of `artRenderState`, append:

```ts
// Group 9: deferred art. The placeholder job runs the same path and never moves the collection's status.
const d = (await insertCollection(A.client)).row!.id
const deferredSet = await A.client.from('collections').update({ art_deferred: true }).eq('id', d)
if (deferredSet.error) throw new Error(`setup: ${describe(deferredSet.error as DbError)}`)
const placeholderUpload = await recordUpload(A.client, d, { kind: 'placeholder' })
if (!placeholderUpload.id) throw new Error(`setup: ${describe(placeholderUpload.error)}`)
const placeholderLock = await callArt(A.client, 'art_lock_placeholder', {
  p_collection_id: d,
  p_placeholder_upload_id: placeholderUpload.id,
})
if (placeholderLock.error) throw new Error(`setup: ${describe(placeholderLock.error)}`)
const placeholderJob = idOf(placeholderLock.data)

await check('placeholder render: the claim seeds one batch and the collection stays draft', async () => {
  const { error } = await callArt(admin, 'art_claim_render', { p_job_id: placeholderJob })
  if (error) return describe(error)
  const job = await renderJob(placeholderJob)
  const batches = (await batchesOf(placeholderJob))
    .map((b) => `${b.index}:${b.first_token_id}-${b.last_token_id}`)
    .join(' ')
  const status = (await lockState(d)).status
  return job.state === 'rendering' && batches === '0:1-1' && status === 'draft'
    ? null
    : `${job.state} ${batches} ${status}`
})

await check(
  "placeholder render: a final failure and the owner's retry pick the placeholder job and leave the status alone",
  async () => {
    const start = await callArt(admin, 'art_batch_start', { p_job_id: placeholderJob, p_index: 0 })
    if (start.error) return `start: ${describe(start.error)}`
    const failed = await callArt(admin, 'art_batch_failed', {
      p_job_id: placeholderJob,
      p_index: 0,
      p_code: 'placeholder-unreadable',
      p_message: 'The placeholder file could not be read.',
      p_final: true,
    })
    if (failed.error) return `failed: ${describe(failed.error)}`
    const afterFailure = (await lockState(d)).status
    const retry = await callArt(A.client, 'art_render_retry', { p_collection_id: d })
    if (retry.error) return `retry: ${describe(retry.error)}`
    const job = await renderJob(placeholderJob)
    const status = (await lockState(d)).status
    return (retry.data as { id?: string } | null)?.id === placeholderJob &&
      job.state === 'rendering' &&
      afterFailure === 'draft' &&
      status === 'draft'
      ? null
      : `${JSON.stringify(job)} after failure ${afterFailure}, after retry ${status}`
  },
)

await check(
  'placeholder render: its batch lands last and the job finishes on a metadata file with its image CID',
  async () => {
    const done = await callArt(admin, 'art_batch_done', {
      p_job_id: placeholderJob,
      p_index: 0,
      p_images_cid: CID('p'),
      p_images_size: 512,
    })
    if (done.error) return `done: ${describe(done.error)}`
    const finish = await callArt(admin, 'art_render_finish', {
      p_job_id: placeholderJob,
      p_metadata_cid: CID('q'),
      p_base_uri: `ipfs://${CID('q')}/metadata.json`,
      p_placeholder_image_cid: CID('p'),
    })
    if (finish.error) return `finish: ${describe(finish.error)}`
    const job = await renderJob(placeholderJob)
    const status = (await lockState(d)).status
    return doneOf(done.data)?.last === true &&
      job.state === 'done' &&
      job.metadata_cid === CID('q') &&
      job.base_uri === `ipfs://${CID('q')}/metadata.json` &&
      job.placeholder_image_cid === CID('p') &&
      status === 'draft'
      ? null
      : `${JSON.stringify(job)} collection ${status}`
  },
)
```

In `apps/web/src/lib/art/db-error.test.ts`, add to the import from `./result` (keeping the list sorted):

```ts
  BATCH_ALREADY_DONE,
  BATCH_COUNT_MISMATCH,
  BATCH_RESULT_DIFFERS,
  BATCHES_STILL_RENDERING,
  JOB_FAILURE_NEEDS_FINAL,
  JOB_NOT_FAILED,
  JOB_NOT_READY,
  JOB_NOT_RENDERING,
  JOB_RESULT_DIFFERS,
  JOB_UNLOCKED,
  NO_SUCH_BATCH,
```

and inside `describe('lockWriteError', ...)`, after the test "passes the lock and pay sentences through", add:

```ts
it('passes the render job sentences through, word for word', () => {
  const sentences = {
    [JOB_NOT_READY]: 'This job is not ready to render.',
    [BATCH_COUNT_MISMATCH]: 'The batch count does not match the token count.',
    [JOB_NOT_RENDERING]: 'This job is not rendering.',
    [NO_SUCH_BATCH]: 'There is no such batch.',
    [BATCH_RESULT_DIFFERS]: 'This batch was already recorded with a different result.',
    [BATCH_ALREADY_DONE]: 'This batch is already done.',
    [JOB_RESULT_DIFFERS]: 'This job was already finished with a different result.',
    [BATCHES_STILL_RENDERING]: 'This job has batches still rendering.',
    [JOB_NOT_FAILED]: 'This job has not failed.',
    [JOB_UNLOCKED]: 'This job was unlocked. Lock the art again to render it.',
    [JOB_FAILURE_NEEDS_FINAL]: 'A job-level failure must be final.',
  }
  for (const [constant, sentence] of Object.entries(sentences)) {
    expect(constant).toBe(sentence)
    expect(lockWriteError({ code: '23514', message: sentence })).toBe(sentence)
  }
})
```

- [ ] **Step 2: Run them**

Run:

```bash
pnpm --filter @cobweb/web verify:local 2>&1 | grep -E '^(FAIL|[0-9]+ passed)'
pnpm --filter @cobweb/web exec vitest run src/lib/art/db-error.test.ts
```

Expected: `verify:local` has no FAIL lines and reads `243 passed, 0 failed`: the functions already branch on `kind`, so group 9 pins the placeholder path rather than driving new SQL (a FAIL here is a defect in Tasks 2 to 5; fix it there in a new commit). Vitest: FAIL, the eleven constants are not exported from `./result` (the object keys read `undefined`).

- [ ] **Step 3: Add the sentences**

In `apps/web/src/lib/art/result.ts`, after the last line (`export const NOT_A_HASH = ...`), add:

```ts
// Render job state (docs/specs/2026-10-12-render-job-state.md, section 8). The database raises these as they are.
export const JOB_NOT_READY = 'This job is not ready to render.'
export const BATCH_COUNT_MISMATCH = 'The batch count does not match the token count.'
export const JOB_NOT_RENDERING = 'This job is not rendering.'
export const NO_SUCH_BATCH = 'There is no such batch.'
export const BATCH_RESULT_DIFFERS = 'This batch was already recorded with a different result.'
export const BATCH_ALREADY_DONE = 'This batch is already done.'
export const JOB_RESULT_DIFFERS = 'This job was already finished with a different result.'
export const BATCHES_STILL_RENDERING = 'This job has batches still rendering.'
export const JOB_NOT_FAILED = 'This job has not failed.'
export const JOB_UNLOCKED = 'This job was unlocked. Lock the art again to render it.'
// Ruling on spec section 4: a job-level failure (art_batch_failed with no batch) is final only.
export const JOB_FAILURE_NEEDS_FINAL = 'A job-level failure must be final.'
```

In `apps/web/src/lib/art/db-error.ts`, add the eleven names to the import from `./result` (sorted as the existing list is), change the comment above `LOCK_SENTENCES` to:

```ts
/**
 * Sentences the lock, pay and render functions raise (supabase/migrations/20261009020000_lock_and_pay.sql,
 * 20261012010000_render_job_state.sql).
 */
```

and add these entries at the end of the `LOCK_SENTENCES` set, after `PAYMENT_AMOUNT_INVALID,`:

```ts
  JOB_NOT_READY,
  BATCH_COUNT_MISMATCH,
  JOB_NOT_RENDERING,
  NO_SUCH_BATCH,
  BATCH_RESULT_DIFFERS,
  BATCH_ALREADY_DONE,
  JOB_RESULT_DIFFERS,
  BATCHES_STILL_RENDERING,
  JOB_NOT_FAILED,
  JOB_UNLOCKED,
  JOB_FAILURE_NEEDS_FINAL,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
pnpm --filter @cobweb/web exec vitest run src/lib/art/db-error.test.ts
```

Expected: PASS.

- [ ] **Step 5: Root checks and commit**

Run:

```bash
pnpm exec prettier --write apps/web/scripts/verify-local.ts apps/web/src/lib/art/result.ts apps/web/src/lib/art/db-error.ts apps/web/src/lib/art/db-error.test.ts
pnpm typecheck && pnpm lint && pnpm test
```

Expected: clean.

```bash
git add apps/web/scripts/verify-local.ts apps/web/src/lib/art/result.ts apps/web/src/lib/art/db-error.ts apps/web/src/lib/art/db-error.test.ts
git commit -F - <<'MSG'
Check the placeholder render path and pass the render job sentences through to the creator

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bcHX4HZG5YGWhxjGuiWos
MSG
```

---

### Task 7: The job model

**Files:**

- Modify: `apps/web/src/lib/art/render-job.ts` (`placeholderOf`, `toRenderJob`, `pendingJob`)
- Test: `apps/web/src/lib/art/render-job.test.ts` (replaced)
- Modify: `apps/web/src/lib/demo/types.ts` (`RenderPlaceholder` comment, the `RenderJob` union)
- Modify: `apps/web/src/lib/art/lock-core.ts:15`, `:160-174`
- Modify: `apps/web/src/components/upload/upload-flow.tsx:83-92`, `:131-148`
- Modify: `apps/web/src/lib/demo/data.ts:234-312`
- Test: `apps/web/src/lib/demo/data.test.ts`
- Modify: `apps/web/src/app/collections/[id]/upload/page.tsx:19`, `:50-53`
- Modify: `apps/web/src/components/deploy/deploy-screen.tsx:52-63`
- Modify: `apps/web/src/app/collections/[id]/manage/page.tsx:57`
- Modify: `apps/web/src/app/collections/[id]/manage/settings/page.tsx:42`

**Interfaces:**

- Consumes: `JobRow`, `BatchRow`, `BATCH_COLUMNS` (Task 1); `readAll` (`apps/web/src/lib/art/read-all.ts`).
- Produces: `toRenderJob(row: JobRow, batchRows: BatchRow[], extra: { factory: Address | null; placeholder: JobPlaceholder }): RenderJob`; the `RenderJob` union of spec section 9 (shapes in Step 3); `SampleJobState` includes `'finalizing'`; `DEMO_RENDER_JOBS.finalizing` and `DEMO_DEFERRED_RENDER_JOBS.finalizing`. The fourth sub-project's screen reads `rendering.failedBatch`, `failed.errorCode`, `failed.failedBatch`, `failed.retryable`, `done.metadataCid`, `done.baseUri`, `done.batchCids`, `done.placeholderImageCid`, `done.collageKey`.

Decision: `toRenderJob` takes `(row, batchRows, extra)` rather than the spec's `(row, batches, placeholder)`, because `extra` already carries the factory the quote falls back to; the batch rows are the new second argument as the spec asks.

Decision: `startedAt` and `finishedAt` stay unix seconds (`number`), as every existing state, the sample data and the screen use them; spec section 9's `string` would contradict its own "the common fields are unchanged". Every post-payment state keeps its `payment` field, which the spec's sketch leaves out.

Decision: `failed.error` is `string`, as the spec gives it; the database always sets it on a failed job (the worker's message, or `unlocked`), and a null reads as `''`. A `done` row without `metadata_cid` or `base_uri` throws, as a missing on-chain id does: the constraint `render_jobs_done_complete` makes it impossible.

Decision: the done step keeps one "Images CID" row and shows the first batch directory (`batchCids[0]`); listing every batch directory is the fourth sub-project's screen work, recorded in Task 8.

- [ ] **Step 1: Write the failing tests**

Replace `apps/web/src/lib/art/render-job.test.ts` with:

```ts
import { describe, expect, it } from 'vitest'
import {
  BATCH_COLUMNS,
  JOB_COLUMNS,
  pendingJob,
  toRenderJob,
  ZERO_ADDRESS,
  type BatchRow,
  type JobRow,
} from './render-job'

const JOB = '0f4a0f3e-2f5e-4e3a-9d1c-1b2c3d4e5f60'
const ONCHAIN = `0x0f4a0f3e2f5e4e3a9d1c1b2c3d4e5f60${'0'.repeat(32)}`
const FACTORY = '0x5FbDB2315678afecb367f032d93F642f64180aa3'
const PAYER = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8'
const TX = `0x${'ab'.repeat(32)}`
const at = (iso: string) => Date.parse(iso) / 1000
const CID = (letter: string) => `bafybei${letter.repeat(52)}`

const row = (overrides: Partial<JobRow> = {}): JobRow => ({
  id: JOB,
  collection_id: '1f4a0f3e-2f5e-4e3a-9d1c-1b2c3d4e5f61',
  kind: 'real',
  state: 'payment_due',
  token_count: 3,
  token_list_hash: `0x${'cd'.repeat(32)}`,
  allow_duplicates: true,
  fee_per_token_wei: '83333333333333334',
  quote_total_wei: '250000000000000001',
  quote_chain_id: 31337,
  quote_payer: PAYER,
  quote_factory: null,
  quote_expires_at: '2026-10-10T10:00:00+00:00',
  payment_tx_hash: null,
  paid_at: null,
  paid_amount_wei: null,
  batch_size: 100,
  batches_total: 1,
  batches_done: 0,
  metadata_cid: null,
  base_uri: null,
  placeholder_image_cid: null,
  collage_key: null,
  placeholder_upload_id: null,
  onchain_job_id: ONCHAIN,
  error: null,
  error_code: null,
  created_at: '2026-10-09T10:00:00+00:00',
  started_at: null,
  finished_at: null,
  ...overrides,
})

const batch = (index: number, overrides: Partial<BatchRow> = {}): BatchRow => ({
  index,
  state: 'queued',
  attempts: 0,
  images_cid: null,
  images_size: null,
  error: null,
  error_code: null,
  ...overrides,
})

const done = (index: number, letter: string) => batch(index, { state: 'done', images_cid: CID(letter) })

const extra = { factory: FACTORY, placeholder: null } as const

describe('toRenderJob', () => {
  it('maps a job waiting for payment, every wei kept exact (Review Focus 3)', () => {
    const job = toRenderJob(row(), [], extra)
    expect(job).toMatchObject({
      id: JOB,
      state: 'payment_due',
      jobId: ONCHAIN,
      tokenCount: 3,
      lockedAt: at('2026-10-09T10:00:00Z'),
      lockOptions: { allowDuplicates: true },
      placeholder: null,
      quote: {
        chainId: 31337,
        perTokenWei: '83333333333333334',
        tokenCount: 3,
        totalWei: '250000000000000001',
        payer: PAYER,
        expiresAt: at('2026-10-10T10:00:00Z'),
        factory: FACTORY,
      },
    })
  })

  it('exposes the factory stored on the job, checksummed, and falls back to the configured one', () => {
    const stored = '0xe7f1725e7734ce288f8367e1bb143e90bb3f0512'
    expect(toRenderJob(row({ quote_factory: stored }), [], extra).quote.factory).toBe(
      '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
    )
    expect(toRenderJob(row({ quote_factory: null }), [], extra).quote.factory).toBe(FACTORY)
    expect(
      toRenderJob(row({ quote_factory: null }), [], { ...extra, factory: null }).quote.factory,
    ).toBeNull()
  })

  it('reads every numeric wei column as text', () => {
    for (const column of ['fee_per_token_wei::text', 'quote_total_wei::text', 'paid_amount_wei::text'])
      expect(JOB_COLUMNS).toContain(column)
    expect(JOB_COLUMNS).toContain('quote_factory')
  })

  it('reads the new job columns and the batch columns, and no longer reads images_cid', () => {
    for (const column of ['base_uri', 'placeholder_image_cid', 'collage_key', 'error_code'])
      expect(JOB_COLUMNS).toContain(column)
    expect(JOB_COLUMNS).not.toContain('images_cid')
    expect(BATCH_COLUMNS).toBe('index, state, attempts, images_cid, images_size, error, error_code')
  })

  it('maps paid with its payment, and waived or zero-quote paid without one', () => {
    const paid = toRenderJob(
      row({
        state: 'paid',
        payment_tx_hash: TX,
        paid_at: '2026-10-09T11:00:00+00:00',
        paid_amount_wei: '250000000000000001',
      }),
      [],
      extra,
    )
    expect(paid).toMatchObject({
      state: 'paid',
      payment: { txHash: TX, paidAt: at('2026-10-09T11:00:00Z'), amountWei: '250000000000000001' },
      batches: { total: 1, done: 0, size: 100 },
    })
    expect(toRenderJob(row({ state: 'waived' }), [], extra)).toMatchObject({ state: 'waived', payment: null })
    expect(toRenderJob(row({ state: 'paid', quote_total_wei: '0' }), [], extra)).toMatchObject({
      state: 'paid',
      payment: null,
    })
  })

  it('maps rendering with its start and the lowest failed batch, 1-based, or null', () => {
    const rendering = row({
      state: 'rendering',
      paid_at: '2026-10-09T11:00:00+00:00',
      batch_size: 1,
      batches_total: 3,
      batches_done: 1,
    })
    expect(toRenderJob(rendering, [done(0, 'a'), batch(1), batch(2)], extra)).toMatchObject({
      state: 'rendering',
      startedAt: at('2026-10-09T11:00:00Z'),
      batches: { total: 3, done: 1, size: 1 },
      failedBatch: null,
    })
    const failing = [done(0, 'a'), batch(2, { state: 'failed' }), batch(1, { state: 'failed' })]
    expect(toRenderJob(rendering, failing, extra)).toMatchObject({ state: 'rendering', failedBatch: 2 })
  })

  it('maps finalizing with its batches and start', () => {
    expect(
      toRenderJob(
        row({ state: 'finalizing', started_at: '2026-10-09T11:00:00+00:00', batches_done: 1 }),
        [done(0, 'a')],
        extra,
      ),
    ).toMatchObject({
      state: 'finalizing',
      startedAt: at('2026-10-09T11:00:00Z'),
      batches: { total: 1, done: 1, size: 100 },
    })
  })

  it('maps a failed render as retryable, with its code and its failed batch', () => {
    const job = toRenderJob(
      row({ state: 'failed', error: 'A layer image is missing.', error_code: 'layer-missing' }),
      [batch(0, { state: 'failed', error: 'A layer image is missing.', error_code: 'layer-missing' })],
      extra,
    )
    expect(job).toMatchObject({
      state: 'failed',
      error: 'A layer image is missing.',
      errorCode: 'layer-missing',
      failedBatch: 1,
      retryable: true,
    })
  })

  it('maps a job cancelled by an unlock as failed and not retryable', () => {
    expect(toRenderJob(row({ state: 'failed', error: 'unlocked' }), [], extra)).toMatchObject({
      state: 'failed',
      error: 'unlocked',
      errorCode: null,
      failedBatch: null,
      retryable: false,
    })
  })

  it('maps done with its base URI, its collage and the batch CIDs in batch order', () => {
    const job = toRenderJob(
      row({
        state: 'done',
        batch_size: 1,
        batches_total: 3,
        batches_done: 3,
        started_at: '2026-10-09T11:00:00+00:00',
        finished_at: '2026-10-09T11:30:00+00:00',
        metadata_cid: CID('m'),
        base_uri: `ipfs://${CID('m')}/`,
        collage_key: 'collages/x.webp',
      }),
      [done(2, 'c'), done(0, 'a'), done(1, 'b')],
      extra,
    )
    expect(job).toMatchObject({
      state: 'done',
      startedAt: at('2026-10-09T11:00:00Z'),
      finishedAt: at('2026-10-09T11:30:00Z'),
      metadataCid: CID('m'),
      baseUri: `ipfs://${CID('m')}/`,
      batchCids: [CID('a'), CID('b'), CID('c')],
      placeholderImageCid: null,
      collageKey: 'collages/x.webp',
    })
    expect(job).not.toHaveProperty('imagesCid')
  })

  it('refuses a done row without its metadata and base URI', () => {
    expect(() => toRenderJob(row({ state: 'done', metadata_cid: CID('m') }), [], extra)).toThrow(
      `Render job ${JOB} is done without its metadata.`,
    )
  })

  it('serves the placeholder file through the app, with its pinned CID once the placeholder job is done', () => {
    const placeholder = { uploadId: 'u-1', mediaType: 'gif' } as const
    const paid = toRenderJob(row({ kind: 'placeholder', state: 'paid' }), [], { factory: null, placeholder })
    expect(paid.placeholder).toEqual({
      cid: '',
      mediaType: 'gif',
      imageUrl: '/api/uploads/u-1',
      uploadId: 'u-1',
    })
    expect(paid.quote.factory).toBeNull()
    const finished = toRenderJob(
      row({
        kind: 'placeholder',
        state: 'done',
        metadata_cid: CID('q'),
        base_uri: `ipfs://${CID('q')}/metadata.json`,
        placeholder_image_cid: CID('p'),
        finished_at: '2026-10-09T11:30:00+00:00',
      }),
      [done(0, 'p')],
      { factory: null, placeholder },
    )
    expect(finished.placeholder?.cid).toBe(CID('p'))
    expect(finished).toMatchObject({
      state: 'done',
      placeholderImageCid: CID('p'),
      baseUri: `ipfs://${CID('q')}/metadata.json`,
    })
  })
})

describe('pendingJob', () => {
  it('is a job with nothing locked yet, on the collection chain', () => {
    expect(pendingJob(8453, null)).toMatchObject({
      state: 'locked',
      tokenCount: 0,
      quote: { chainId: 8453, totalWei: '0', payer: ZERO_ADDRESS, factory: null },
      placeholder: null,
    })
    expect(pendingJob(null, null).quote.chainId).toBe(0)
  })
})
```

In `apps/web/src/lib/demo/data.test.ts`, add to the import from `@/lib/demo`: `DEMO_DEFERRED_RENDER_JOBS`, `DEMO_RENDER_JOBS`, `getRenderJob`. At the end of the file add:

```ts
describe('sample render jobs', () => {
  it('have a finalizing job with every batch in, in both scenarios', () => {
    for (const artDeferred of [false, true]) {
      const job = getRenderJob('finalizing', { artDeferred })
      expect(job.state).toBe('finalizing')
      if (job.state === 'finalizing') expect(job.batches.done).toBe(job.batches.total)
    }
  })

  it('mark the deferred run as the placeholder alone and the real run as the real set', () => {
    expect(DEMO_DEFERRED_RENDER_JOBS.done.placeholderImageCid).not.toBeNull()
    expect(DEMO_RENDER_JOBS.done.placeholderImageCid).toBeNull()
    expect(DEMO_RENDER_JOBS.done.batchCids).toEqual([DEMO_RENDER_JOBS.done.imagesCid])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
pnpm --filter @cobweb/web exec vitest run src/lib/art/render-job.test.ts src/lib/demo/data.test.ts
```

Expected: FAIL. In render-job: the factory and placeholder tests (the batch rows land where `extra` was), the rendering, failed, unlocked, done and placeholder-done tests. In data: `getRenderJob('finalizing')` returns `undefined` and `placeholderImageCid` is undefined.

- [ ] **Step 3: Implement the union and the mapping**

In `apps/web/src/lib/demo/types.ts`, change the `RenderPlaceholder` comment line `reveal, pinned to its own small CID in Phase 4 (`cid` is '' until then).` to:

```ts
 * reveal, pinned to its own small CID (`cid` is '' until its placeholder job is done).
```

and replace the whole `RenderJob` union (from `export type RenderJob =` through the end of the `state: 'done'` member) with:

```ts
export type RenderJob =
  | (RenderJobBase & { state: 'locked' })
  | (RenderJobBase & {
      state: 'payment_due'
      /** Set when a payment was recorded but fell short of the quote; the job stays waiting. */
      payment: RenderPayment | null
    })
  | (RenderJobBase & { state: 'paid' | 'waived'; payment: RenderPayment | null; batches: RenderBatches })
  | (RenderJobBase & {
      state: 'rendering'
      payment: RenderPayment | null
      batches: RenderBatches
      startedAt: number
      /** The 1-based number of the lowest batch that failed and waits for the worker's retry, or null. */
      failedBatch: number | null
    })
  | (RenderJobBase & {
      /** Every batch is in; the metadata is being written and pinned. */
      state: 'finalizing'
      payment: RenderPayment | null
      batches: RenderBatches
      startedAt: number
    })
  | (RenderJobBase & {
      state: 'failed'
      payment: RenderPayment | null
      batches: RenderBatches
      /** The worker's sentence, or `unlocked` for a job an unlock cancelled. */
      error: string
      /** `RenderProblem.code` or the worker's own code; null for an unlock. */
      errorCode: string | null
      /** The 1-based number of the lowest failed batch, or null. */
      failedBatch: number | null
      /** False for a job an unlock cancelled: the creator locks the art again instead. */
      retryable: boolean
    })
  | (RenderJobBase & {
      state: 'done'
      payment: RenderPayment | null
      batches: RenderBatches
      startedAt: number
      finishedAt: number
      /** The metadata directory, or the placeholder's metadata on a placeholder job. */
      metadataCid: string
      /** What the contract gets: `ipfs://<cid>/`, or `ipfs://<cid>/metadata.json` for a single asset and the placeholder. */
      baseUri: string
      /** Each batch directory's CID, in batch order. */
      batchCids: string[]
      /** The placeholder's image directory; set on a placeholder job only. */
      placeholderImageCid: string | null
      /** The storage key of the preview collage, or null. */
      collageKey: string | null
    })
```

In `apps/web/src/lib/art/render-job.ts`, change the demo types import to:

```ts
import type { MediaType, RenderBatches, RenderJob, RenderJobBase, RenderPlaceholder } from '@/lib/demo/types'
```

replace `placeholderOf` with:

```ts
/** The placeholder a job shows; `cid` is its pinned image directory once a placeholder job is done. */
function placeholderOf(placeholder: JobPlaceholder, cid: string | null): RenderPlaceholder | null {
  return placeholder
    ? {
        cid: cid ?? '',
        mediaType: placeholder.mediaType,
        imageUrl: servedUrl(placeholder.uploadId),
        uploadId: placeholder.uploadId,
      }
    : null
}

/** The 1-based number of the lowest batch in state failed, or null. */
function failedBatchOf(batchRows: BatchRow[]): number | null {
  let lowest: number | null = null
  for (const row of batchRows)
    if (row.state === 'failed' && (lowest === null || row.index < lowest)) lowest = row.index
  return lowest === null ? null : lowest + 1
}
```

replace the whole `toRenderJob` function with:

```ts
/**
 * A render_jobs row and its batch rows (none before the claim) as the Lock and upload screen's
 * `RenderJob` (docs/specs/2026-10-12-render-job-state.md, section 9).
 */
export function toRenderJob(
  row: JobRow,
  batchRows: BatchRow[],
  extra: { factory: Address | null; placeholder: JobPlaceholder },
): RenderJob {
  // The database trigger always sets the id; a null here would mean a row it never saw.
  if (row.onchain_job_id === null) throw new Error(`Render job ${row.id} has no on-chain job id.`)
  const base: RenderJobBase = {
    id: row.id,
    jobId: row.onchain_job_id as Hex,
    tokenCount: row.token_count,
    lockedAt: seconds(row.created_at),
    tokenListHash: (row.token_list_hash ?? ZERO_HASH) as Hex,
    quote: {
      chainId: row.quote_chain_id ?? 0,
      perTokenWei: row.fee_per_token_wei,
      tokenCount: row.token_count,
      totalWei: row.quote_total_wei,
      payer: (row.quote_payer ?? ZERO_ADDRESS) as Address,
      expiresAt: seconds(row.quote_expires_at),
      // The factory the quote was issued against; rows from before it was stored use the configured one.
      factory: row.quote_factory ? getAddress(row.quote_factory) : extra.factory,
    },
    lockOptions: { allowDuplicates: row.allow_duplicates },
    placeholder: placeholderOf(extra.placeholder, row.placeholder_image_cid),
  }
  const payment = row.payment_tx_hash
    ? {
        txHash: row.payment_tx_hash as Hex,
        paidAt: seconds(row.paid_at),
        amountWei: row.paid_amount_wei ?? '0',
      }
    : null
  const batches: RenderBatches = { total: row.batches_total, done: row.batches_done, size: row.batch_size }
  const startedAt = seconds(row.started_at ?? row.paid_at)
  switch (row.state) {
    case 'locked':
      return { ...base, state: 'locked' }
    case 'payment_due':
      return { ...base, state: 'payment_due', payment }
    case 'paid':
    case 'waived':
      return { ...base, state: row.state, payment, batches }
    case 'rendering':
      return {
        ...base,
        state: 'rendering',
        payment,
        batches,
        startedAt,
        failedBatch: failedBatchOf(batchRows),
      }
    case 'finalizing':
      return { ...base, state: 'finalizing', payment, batches, startedAt }
    case 'failed':
      return {
        ...base,
        state: 'failed',
        payment,
        batches,
        // Always set by the database: the worker's sentence, or 'unlocked' after an unlock.
        error: row.error ?? '',
        errorCode: row.error_code,
        failedBatch: failedBatchOf(batchRows),
        retryable: row.error !== 'unlocked',
      }
    case 'done': {
      // render_jobs_done_complete makes a done row without them impossible.
      if (row.metadata_cid === null || row.base_uri === null)
        throw new Error(`Render job ${row.id} is done without its metadata.`)
      const ordered = [...batchRows].sort((a, b) => a.index - b.index)
      return {
        ...base,
        state: 'done',
        payment,
        batches,
        startedAt,
        finishedAt: seconds(row.finished_at),
        metadataCid: row.metadata_cid,
        baseUri: row.base_uri,
        batchCids: ordered.flatMap((b) => (b.images_cid ? [b.images_cid] : [])),
        placeholderImageCid: row.placeholder_image_cid,
        collageKey: row.collage_key,
      }
    }
  }
}
```

and in `pendingJob`, change `placeholder: placeholderOf(placeholder),` to:

```ts
    placeholder: placeholderOf(placeholder, null),
```

- [ ] **Step 4: Read the batch rows in the lock core**

In `apps/web/src/lib/art/lock-core.ts`, change the render-job import (line 15) to:

```ts
import {
  BATCH_COLUMNS,
  JOB_COLUMNS,
  toRenderJob,
  type BatchRow,
  type JobPlaceholder,
  type JobRow,
} from './render-job'
```

Above `async function jobFromRow`, add:

```ts
/**
 * The job's batch rows in index order, under the creator's session (owner-read policy); none before
 * the claim. Paged, since a large job can pass PostgREST's 1,000-row cap.
 */
async function batchRows(supabase: LockClient, jobId: string): Promise<BatchRow[]> {
  return readAll<BatchRow>((from, to) =>
    supabase.from('render_batches').select(BATCH_COLUMNS).eq('job_id', jobId).order('index').range(from, to),
  )
}
```

and change the last line of `jobFromRow` to:

```ts
return toRenderJob(row, await batchRows(supabase, row.id), {
  factory: factoryOn(row.quote_chain_id),
  placeholder,
})
```

`renderJobCore`, `loadJob` and `quoteCore` all go through `jobFromRow`, so every `RenderJob` the actions return carries its batch state.

- [ ] **Step 5: The screen and the sample data**

In `apps/web/src/components/upload/upload-flow.tsx`, replace `renderStartOf` with:

```ts
function renderStartOf(job: RenderJob): RenderProgress {
  if (!('batches' in job))
    return {
      phase: 'images',
      total: Math.max(1, Math.ceil(job.tokenCount / RENDER_BATCH_SIZE)),
      done: 0,
      size: RENDER_BATCH_SIZE,
    }
  // A finalizing job has every batch in; only the metadata is left.
  return { phase: job.state === 'finalizing' ? 'metadata' : 'images', ...job.batches }
}

/**
 * A finished job as the done step shows it. A placeholder job rendered no real set. The step shows one
 * images CID, the first batch directory, until the screen lists `batchCids`.
 */
function resultOf(job: Extract<RenderJob, { state: 'done' }>): RenderResult {
  if (job.placeholderImageCid !== null)
    return { imagesCid: null, metadataCid: null, placeholder: job.placeholder }
  return { imagesCid: job.batchCids[0] ?? null, metadataCid: job.metadataCid, placeholder: job.placeholder }
}
```

and in the component, change

```ts
  const result: RenderResult =
    job.state === 'done'
      ? job
      : {
```

to

```ts
  const result: RenderResult =
    job.state === 'done'
      ? resultOf(job)
      : {
```

In `apps/web/src/lib/demo/data.ts`:

Change the `SampleJobState` line to:

```ts
export type SampleJobState = Extract<
  RenderJobState,
  'locked' | 'payment_due' | 'rendering' | 'finalizing' | 'done'
>
```

Above `export const DEMO_RENDER_JOBS`, add:

```ts
const SAMPLE_IMAGES_CID = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
const SAMPLE_METADATA_CID = 'bafybeihkoviema7g3gxyt6la7vd5ho32ictqbilu3wnlo3rs7ewhnp7lly'
/** The deferred run's placeholder metadata: one file, `metadata.json`. */
const SAMPLE_PLACEHOLDER_METADATA_CID = 'bafybeie5gq4jxvzmsym6hjlwxej4rwdoxt7wadqvmmwbqi7r27fclha2va'
```

Replace the declaration line and the `rendering` and `done` entries of `DEMO_RENDER_JOBS` so that it reads:

```ts
export const DEMO_RENDER_JOBS: Omit<RenderJobsByState, 'done'> & {
  done: RenderJobsByState['done'] & { imagesCid: string; placeholder: RenderPlaceholder }
} = {
  locked: { ...jobBase, state: 'locked', placeholder: null },
  payment_due: { ...jobBase, state: 'payment_due', placeholder: DEMO_PLACEHOLDER, payment: null },
  rendering: {
    ...jobBase,
    state: 'rendering',
    placeholder: DEMO_PLACEHOLDER,
    payment,
    batches: { total: batchTotal, done: 9, size: BATCH_SIZE },
    startedAt: payment.paidAt + 60,
    failedBatch: null,
  },
  finalizing: {
    ...jobBase,
    state: 'finalizing',
    placeholder: DEMO_PLACEHOLDER,
    payment,
    batches: { total: batchTotal, done: batchTotal, size: BATCH_SIZE },
    startedAt: payment.paidAt + 60,
  },
  done: {
    ...jobBase,
    state: 'done',
    placeholder: DEMO_PLACEHOLDER,
    payment,
    batches: { total: batchTotal, done: batchTotal, size: BATCH_SIZE },
    startedAt: payment.paidAt + 60,
    finishedAt: payment.paidAt + 60 + 26 * 60,
    // The upload screen's sample result reads this one images CID.
    imagesCid: SAMPLE_IMAGES_CID,
    metadataCid: SAMPLE_METADATA_CID,
    baseUri: `ipfs://${SAMPLE_METADATA_CID}/`,
    batchCids: [SAMPLE_IMAGES_CID],
    placeholderImageCid: null,
    collageKey: null,
  },
}
```

Replace the `rendering` and `done` entries of `DEMO_DEFERRED_RENDER_JOBS` so that it reads:

```ts
export const DEMO_DEFERRED_RENDER_JOBS: RenderJobsByState = {
  locked: { ...deferredBase, state: 'locked', placeholder: null },
  payment_due: { ...deferredBase, state: 'payment_due', placeholder: DEMO_PLACEHOLDER, payment: null },
  rendering: {
    ...deferredBase,
    state: 'rendering',
    placeholder: DEMO_PLACEHOLDER,
    payment: deferredPayment,
    batches: { total: 1, done: 0, size: 1 },
    startedAt: payment.paidAt + 60,
    failedBatch: null,
  },
  finalizing: {
    ...deferredBase,
    state: 'finalizing',
    placeholder: DEMO_PLACEHOLDER,
    payment: deferredPayment,
    batches: { total: 1, done: 1, size: 1 },
    startedAt: payment.paidAt + 60,
  },
  done: {
    ...deferredBase,
    state: 'done',
    placeholder: DEMO_PLACEHOLDER,
    payment: deferredPayment,
    batches: { total: 1, done: 1, size: 1 },
    startedAt: payment.paidAt + 60,
    finishedAt: payment.paidAt + 2 * 60,
    metadataCid: SAMPLE_PLACEHOLDER_METADATA_CID,
    baseUri: `ipfs://${SAMPLE_PLACEHOLDER_METADATA_CID}/metadata.json`,
    batchCids: [DEMO_PLACEHOLDER.cid],
    placeholderImageCid: DEMO_PLACEHOLDER.cid,
    collageKey: null,
  },
}
```

In `apps/web/src/app/collections/[id]/upload/page.tsx`, change line 19 to:

```ts
const SAMPLE_STATES: SampleJobState[] = ['locked', 'payment_due', 'rendering', 'finalizing', 'done']
```

and in the page's doc comment change `` `?job=locked|payment_due|rendering|done` picks the state, `` to:

```ts
 * `?job=locked|payment_due|rendering|finalizing|done` picks the state,
```

In `apps/web/src/components/deploy/deploy-screen.tsx`, change the line `metadataCid={job.metadataCid ?? ''}` to:

```tsx
        metadataCid={job.placeholderImageCid === null ? job.metadataCid : ''}
```

In `apps/web/src/app/collections/[id]/manage/page.tsx` (line 57) and `apps/web/src/app/collections/[id]/manage/settings/page.tsx` (line 42), change `DEMO_DEFERRED_RENDER_JOBS.done.metadataCid !== null` to:

```tsx
DEMO_DEFERRED_RENDER_JOBS.done.placeholderImageCid === null
```

(The deferred sample's done job is the placeholder run, so the real art is still not rendered there, as before.)

- [ ] **Step 6: Run the tests to verify they pass**

Run:

```bash
pnpm --filter @cobweb/web exec vitest run src/lib/art/render-job.test.ts src/lib/demo/data.test.ts
```

Expected: PASS, 2 files.

- [ ] **Step 7: Root checks, the sample screen and commit**

Run:

```bash
pnpm exec prettier --write apps/web/src/lib/art/render-job.ts apps/web/src/lib/art/render-job.test.ts apps/web/src/lib/demo/types.ts apps/web/src/lib/art/lock-core.ts apps/web/src/components/upload/upload-flow.tsx apps/web/src/lib/demo/data.ts apps/web/src/lib/demo/data.test.ts "apps/web/src/app/collections/[id]/upload/page.tsx" apps/web/src/components/deploy/deploy-screen.tsx "apps/web/src/app/collections/[id]/manage/page.tsx" "apps/web/src/app/collections/[id]/manage/settings/page.tsx"
pnpm typecheck && pnpm lint && pnpm test
```

Expected: clean. Then with `NEXT_PUBLIC_DEMO_DATA=1 pnpm --filter @cobweb/web dev`, open Lock and upload for the sample collection with `?job=finalizing` and with `?job=finalizing&art=deferred`: the page opens on the render step with every batch in and moves to the metadata step, then done; `?job=done` and `?job=done&art=deferred` show the same CIDs as before this task.

```bash
git add apps/web/src/lib/art/render-job.ts apps/web/src/lib/art/render-job.test.ts apps/web/src/lib/demo/types.ts apps/web/src/lib/art/lock-core.ts apps/web/src/components/upload/upload-flow.tsx apps/web/src/lib/demo/data.ts apps/web/src/lib/demo/data.test.ts "apps/web/src/app/collections/[id]/upload/page.tsx" apps/web/src/components/deploy/deploy-screen.tsx "apps/web/src/app/collections/[id]/manage/page.tsx" "apps/web/src/app/collections/[id]/manage/settings/page.tsx"
git commit -F - <<'MSG'
Map every render job state with its batch rows into one job model, and show finalizing on Lock and upload

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bcHX4HZG5YGWhxjGuiWos
MSG
```

---

### Task 8: Docs and the full check list

**Files:**

- Modify: `docs/MASTER_PLAN.md` (the Phase 4 **Status:** paragraph, line 200)
- Modify: `docs/specs/2026-10-09-lock-and-pay.md:57-58`
- Modify: `docs/specs/2026-10-12-render-job-state.md:294-303`

**Interfaces:**

- Consumes: everything above.
- Produces: the record the third and fourth sub-projects start from.

- [ ] **Step 1: Append to the Phase 4 status line**

In `docs/MASTER_PLAN.md`, the Phase 4 **Status:** paragraph ends with `Next: job state (second sub-project).` Keep that sentence (the docs keep their history) and append after it, in the same paragraph:

```markdown
Job state (second sub-project) landed on 12 October 2026; see [specs/2026-10-12-render-job-state.md](specs/2026-10-12-render-job-state.md). `render_state` gained `finalizing`; `render_jobs.images_cid` is gone (each batch row carries its directory's CID), and the job gained `base_uri`, `placeholder_image_cid`, `collage_key` and `error_code`. The third sub-project's worker calls, with the service role, `art_claim_render(p_job_id)`, `art_batch_start(p_job_id, p_index)`, `art_batch_done(p_job_id, p_index, p_images_cid, p_images_size)` (it returns `batches_done` and `last`; `last` is true exactly once, for the call that flips the job to `finalizing`), `art_batch_failed(p_job_id, p_index, p_code, p_message, p_final)` (a null `p_index` is a job-level failure, such as a failed metadata step or `cid-mismatch`, and must be final) and `art_render_finish(p_job_id, p_metadata_cid, p_base_uri, p_placeholder_image_cid, p_collage_key)`; it owes `enqueueRender(jobId)`, a periodic sweep that picks up a job left `rendering` with queued batches (a retry whose enqueue failed) and re-enqueues the metadata step for a job left `finalizing` with no pending work (a retry after a job-level failure, which `art_render_retry` returns to `finalizing` when every batch is done), and the collage key convention outside upload-shaped keys. The fourth sub-project's screen reads the `RenderJob` union (`rendering` with `failedBatch`; `finalizing`; `failed` with `errorCode`, `failedBatch` and `retryable`; `done` with `metadataCid`, `baseUri`, `batchCids`, `placeholderImageCid` and `collageKey`) by polling `getRenderJob`, and owes `retryRender`, which calls the session function `art_render_retry(p_collection_id)` and then `enqueueRender(jobId)`, in that order; the done step shows one images CID (the first batch directory) until it lists `batchCids`. Every function that writes the collection locks it before the job, and no status write moves a `deployed` collection: the reveal flow (Phase 5) owns a deployed collection's rendering status. Next: worker and local runner (third sub-project).
```

- [ ] **Step 2: Point the lock-and-pay deferral at this spec**

In `docs/specs/2026-10-09-lock-and-pay.md`, the Out of scope bullet reads:

```markdown
- Rendering: SQS, Lambdas, batch progress, images and metadata CIDs, `collections.status` moving
  to `rendering` or `rendered` (Phase 4). The job stays `paid` with `batches_total` set.
```

Append one sentence to that bullet so it reads:

```markdown
- Rendering: SQS, Lambdas, batch progress, images and metadata CIDs, `collections.status` moving
  to `rendering` or `rendered` (Phase 4). The job stays `paid` with `batches_total` set. Batch
  progress, the CIDs and the status moves are specified in
  [2026-10-12-render-job-state.md](2026-10-12-render-job-state.md).
```

- [ ] **Step 3: Tick the acceptance boxes**

In `docs/specs/2026-10-12-render-job-state.md`, section 11, change each of the five `- [ ]` to `- [x]`. Change nothing else in the spec.

- [ ] **Step 4: Run the full check list**

From the repo root:

```bash
supabase db reset 2>&1 | tail -3
supabase seed buckets
pnpm typecheck && pnpm lint && pnpm test
pnpm --filter @cobweb/web verify:local 2>&1 | grep -E '^(FAIL|[0-9]+ passed)'
pnpm --filter @cobweb/web verify:storage
pnpm --filter @cobweb/web chain:local
pnpm --filter @cobweb/web verify:chain
pnpm --filter @cobweb/web verify:sweep
pnpm build
grep -rn -e images_cid -e imagesCid apps/web/src apps/web/scripts | grep -v database.types.ts
grep -rnE "$(printf '\xe2\x80\x93|\xe2\x80\x94')" supabase/migrations/20261012000000_render_state_finalizing.sql supabase/migrations/20261012010000_render_job_state.sql apps/web/scripts/verify-local.ts apps/web/src docs/MASTER_PLAN.md docs/specs/2026-10-09-lock-and-pay.md
```

Expected: typecheck, lint and the root suite clean; `verify:local` has no FAIL lines and reads `243 passed, 0 failed` (the spec's 203 plus the 40 checks of 9h); `verify:storage`, `verify:chain` (after `chain:local` printed its `.env.local` lines, which `apps/web/.env.local` must hold) and `verify:sweep` end with `0 failed`; the build succeeds; the first grep prints only the `render_batches` `images_cid` reads in `render-job.ts` (`BatchRow`, `BATCH_COLUMNS`, the `batchCids` mapping), the `imagesCid` lines in `upload-shared.ts`, `done-step.tsx`, `upload-flow.tsx`, `upload-screen.tsx` and `lib/demo/data.ts` (the done step's own field and the sample's), and the 9h checks; the dash grep prints nothing.

- [ ] **Step 5: Commit**

```bash
git add docs/MASTER_PLAN.md docs/specs/2026-10-09-lock-and-pay.md docs/specs/2026-10-12-render-job-state.md
git commit -F - <<'MSG'
Record the render job state landing and the interfaces the worker and the screen consume

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bcHX4HZG5YGWhxjGuiWos
MSG
```

---

## Self-review

**Spec coverage.**

| Spec                                                                                 | Task                      |
| ------------------------------------------------------------------------------------ | ------------------------- |
| 3: migration, regenerated types                                                      | 1 to 5                    |
| 4: `finalizing`, the transitions, the open index                                     | 1, 3, 4, 5                |
| 5: drop `images_cid`, the four job columns, the batch columns and checks             | 1                         |
| 5: `render_jobs_done_complete`                                                       | 1                         |
| 6: `art_claim_render`                                                                | 2                         |
| 6: `art_batch_start`, `art_batch_done`                                               | 3                         |
| 6: `art_batch_failed`, `art_render_finish`                                           | 4                         |
| 7: `art_render_retry`                                                                | 5                         |
| 8: the sentences in `result.ts` and `LOCK_SENTENCES`, plus `JOB_FAILURE_NEEDS_FINAL` | 6                         |
| 9: `JobRow`, `JOB_COLUMNS`, `BatchRow`, `BATCH_COLUMNS`                              | 1                         |
| 9: `toRenderJob` with batch rows, the union, `placeholderOf`                         | 7                         |
| 9: `renderJobCore` loads the batch rows, `STAGE_FOR_JOB` maps `finalizing`           | 7, 1                      |
| 9: the sample `finalizing` job                                                       | 7                         |
| 10: 9h groups 1 to 9                                                                 | 2, 3, 3, 3, 4, 4, 5, 5, 6 |
| 10: unit tests for `toRenderJob`                                                     | 1, 7                      |
| 10: the full check list                                                              | 8                         |
| 11 and 3: MASTER_PLAN status line, lock-and-pay annotation, boxes ticked             | 8                         |

**Placeholder scan.** Every code step carries its code; every run step names its command and the expected FAIL or PASS line with the running count (205, 211, 222, 232, 240, 243).

**Type consistency.** `toRenderJob(row, batchRows, extra)` in Task 7 matches its two callers (`jobFromRow` and the tests). `BatchRow` and `BATCH_COLUMNS` (Task 1) match the regenerated `render_batches` row and are read in Task 7. `RenderJobCheck`, `BatchCheck`, `renderJob`, `batchesOf` (Task 2) and `doneOf` (Task 3) are used with the same names in Tasks 3 to 6. Fixtures: `one` (Task 1), `three` and `due` (Task 2), `two` (Task 5), `d` and `placeholderJob` (Task 6); `txHash` tags 101 to 104 do not collide with 9g's 1 to 7.

**Review Focus.** Each of the five lines has its check in the owning task: 1 in Task 3, 2 in Task 5, 3 in Task 1 (constraints) and Task 3 (check), 4 in Task 2, 5 in Task 6.
