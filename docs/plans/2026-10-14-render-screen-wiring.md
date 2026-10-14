# Render Screen Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Lock and upload screen follow the real render job: poll the job row through React Query, show the batches as the worker finishes them, show a failed job with the worker's sentence and the one action that fits (fix the art, try again, unlock on a credit, or tell support), and on the done step show the collage, the metadata CID, the base URI and every batch CID, with sample mode running on the same code and the simulation deleted.

**Architecture:** A credit migration adds `render_jobs.credit_job_id`, the rule `private.render_credit`, the owner-facing `art_render_credit`, and redefines `art_unlock` (a failed paid job can be unlocked and keeps the worker's sentence under the code `unlocked`) and `art_lock` (a lock covered by a credit is inserted `waived`). The web app gains the retry action (`retryCore` and `retryRender`, sending the start message with the row's retry count), the collage route (`GET /api/collections/[id]/collage`, a 302 to a presigned GET on the render bucket), a pure follow module (`render-follow.ts`: the poll interval, the failure face and the view the render step draws), and a flow that polls `getRenderJob` with `useQuery` and settles each job it gets. Sample mode steps a scripted job through the same `reload`, a local runner script renders a collection's paid jobs on a laptop, and `verify:local` and `verify:render` gain the checks that pin the credit, the retry and the collage.

**Tech Stack:** TypeScript strict (ESM, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`) consumed as source; Node 26.8.1 locally, no Vercel deploy in this sub-project; Next 16 (App Router, Turbopack) with React 19; React Query `@tanstack/react-query` ^5.104.1 (already installed and provided); Vitest 5 (Node environment, no component tests); Supabase local (CLI 2.116.0); Anvil through `chain:local`; Prettier 3; `@cobweb/worker` and `@cobweb/shared` consumed as workspace source.

**Spec:** [../specs/2026-10-14-render-screen-wiring.md](../specs/2026-10-14-render-screen-wiring.md)

## Global Constraints

- The spec is the binding authority. Where this plan decides a detail the spec leaves open, the line starts with "Decision:" and the decisions that shape more than one task are collected in the next section.
- Node 26 locally. ESM everywhere. Inside `services/worker` and `packages/shared`, relative imports carry the `.ts` extension (`./ports.ts`). Inside `apps/web/src`, imports are extensionless and use the `@/` alias, as the existing files do. Inside `apps/web/scripts`, relative imports carry the `.ts` extension and the app's modules are imported as `../src/...` (the scripts run under `--import ./scripts/resolve-ts.mjs`). Types are imported with `import type`.
- Vitest 5, Node environment. One file: `pnpm --filter <package> exec vitest run <file>`, for example `pnpm --filter @cobweb/web exec vitest run src/components/upload/render-follow.test.ts`. No component test exists and none is added: pure modules are unit tested, components are checked by typecheck, lint, build and the browser walk.
- Prettier: no semicolons, single quotes, trailing commas, 110 columns. Before each commit run `pnpm exec prettier --write <the files you changed>` from the repo root. Never run `pnpm format` or Prettier on `.`. CI runs `pnpm format:check`, so every file you touch outside `docs/` must be formatted (`docs/` and `packages/ui/src/components/` are in `.prettierignore`).
- typescript-eslint's recommended rules and ESLint's `preserve-caught-error` apply. Do not write `throw new X(...)` directly inside a `catch` block. There is no react-hooks lint plugin; write hook dependencies correctly all the same.
- Copy: plain sentences. No em or en dashes anywhere, code comments, commit messages and docs included. The product is Cobweb; never Kingdomly.
- Security: no env name starts with `NEXT_PUBLIC_` except the ones that already do. No secret value is printed, logged or committed. An error is logged as its name (the start send) or through `errorSummary` (name and one line), never as the error object. Every server action runs through `lockWrite`, which checks the session and the ownership; every route handler calls `getSessionUser()` and reads under the creator's client, so row-level security does the access control.
- Never deploy. Never pass `--prod` or `--target production` to any command. Nothing in this plan talks to Vercel.
- `docs/PLAN.md` must not change. `legacy/` is never read into, copied from, imported or committed.
- Docs keep their history: add dated notes, decisions and status sentences; never rewrite or delete earlier statements in `docs/MASTER_PLAN.md` or in specs (the owner's standing rule since 3 October 2026).
- Local services, for Tasks 1, 2, 3, 4, 5, 9 and 10: `supabase start` at the repo root (the migrations up to `20261013010000_asset_batch_target.sql` are applied; Task 1 applies the new one with `supabase db reset`), `supabase seed buckets` (creates the local `art` and `render` buckets; a restart or a reset alone does not), and `pnpm --filter @cobweb/web chain:local` running in the background on port 8545 with its two printed lines (`RPC_URL_31337` and `FACTORY_ADDRESS_31337`) in `apps/web/.env.local`. Every script refuses an endpoint that is not localhost; never point anything at a remote service.
- Implementers never use `git commit --amend` or `git stash`. `rm` (as `git rm`) is used only where a step says so (Task 8, `render-sim.ts`). To fix a commit, make a new one.
- Before every commit, at the repo root: `pnpm typecheck && pnpm lint && pnpm test`.
- Commit messages are one plain imperative sentence with no prefix, then a blank line, and end with exactly these two lines:

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
```

## Decisions

1. Decision (spec section 8): `MAX_RENDER_RETRIES` stays in `apps/web/src/lib/art/render-job.ts` and `render-follow.ts` imports it from there. The module is already imported by browser code (`upload-sim.ts` reads `jobBase` from it) and it imports only `viem`, the generated types, the pure `uploads-service` and a type from `lock-collection`; nothing server-only. No constant moves.
2. Decision (section 9.1): the poll's `useQuery` passes `retry: false` and `gcTime: 0` besides the options the spec names. The interval is the retry, so React Query's own back-off would only delay the next poll; and a job cached from an earlier mount of the same page must never settle over the fresh job the server rendered, so nothing is kept once the flow unmounts.
3. Decision (section 9.1): the query has no `initialData`; the first poll runs at mount when the job is being followed, so a page opened on a stale render step reconciles at once. A poll that answers `ok: true` with `null` (nothing locked) settles nothing.
4. Decision (sections 9.1, 10 and 11): the collage URL is set only when the done job has a `collageKey`: in sample mode `/demo/collage.svg`, in real mode `/api/collections/<id>/collage`. The deferred done sample (a placeholder-only job, `collageKey` null) shows no collage. `resultOf` sets `collageUrl` to null for a placeholder job whatever the caller passes.
5. Decision (sections 10 and 11): `UploadFlowProps.sampleResult` goes and `sampleDone` (the scenario's done sample job, null in real mode) takes its place; `sampleActions` ends the scripted run on it. The done step now opens only once the job is `done` (the stage comes from the job and the render step has no `onDone`), so the stand-in result the flow built for an unfinished job has no reader left. The spec's `resultOf(DEMO_RENDER_JOBS.done, { collageUrl: '/demo/collage.svg' })` is therefore the flow's one `resultOf(job, { collageUrl })` call over the done sample. Task 6 keeps the stand-in alive for one commit (so the screen builds the sample result exactly as the spec says while the simulation still runs) and Task 8 removes it.
6. Decision (section 11): `apps/web/public/demo/collage.svg` is a 4 by 4 grid of `<image>` elements whose `href` is each tile as a `data:` URI, built once by the command in Task 7 and committed. A browser does not load external files referenced by an SVG shown through `<img>` (which `Artwork` uses), so `<image href="/demo/tokens/1.svg">` would draw nothing; data URIs are part of the document and do draw.
7. Decision (section 10): `tokenPreview` leaves `upload-shared.ts` as the spec says; its one remaining reader, the review step's sample strip, gets a local copy of the one-line helper.
8. Decision (section 4.4): `art_lock` asks for a credit only when the quote total is above zero. A lock that owes nothing (a single asset) never consumes a credit for no fee.
9. Decision (section 5): the review asks `art_render_credit` only when the list has at least one token; the pure `reviewData` answers `credit: false` and the core overrides it. The generated type of the function's answer is `string` (a uuid), so the core tests it with `Boolean(data)`.
10. Decision (section 8): `faceOf` answers `support` for a job whose code or sentence is `unlocked` explicitly, before the `retryable` test, as the spec's note requires (such a job is otherwise not retryable and would read as `credit`).
11. Decision (section 9.2): the counter's sub-line reads "In batches of N tokens" (the view carries the batch size and no token count, and the props are the spec's), and the time line reads "Time left: X, a rough estimate" (the rate may be observed, so "95 seconds per batch" would be wrong). While the job is queued the images row says "Waiting for a render worker".
12. Decision (section 9.2): the `placeholderOnly` branch also shows the failure alert and its action, so a failed placeholder job is not a dead end (`art_render_retry` picks the placeholder job on a deferred collection).
13. Decision (section 12): the shared dependency module is `apps/web/scripts/render-deps.ts`. It owns the local settings (`localConfig()`, which refuses non-local endpoints and fills the environment the web app's storage module and the worker's chain adapter read), the two clients and `localDeps()`; verify-render keeps its chain-read counter and its log capture through the `chain` and `log` options of `localDeps()`.
14. Decision (section 12): `render:local` exits 0 only when every job it started ended `done`; it never deletes anything, and it prints the pinner's folder so the CARs can be inspected.
15. Decision (sections 7 and 13): the collage route gets a unit test in the style of the sweep route test (`collage-route.test.ts`), covering the uuid guard, the session guard, a null key, no done job and the redirect. Row-level security is exercised by the select under the creator's client and by the presign check in verify-render.
16. Decision (section 13): verify-render gains three checks, `1b` (the presigned GET of the collage), `4b` (`retryCore`) and `9b` (the credit on the web side: `unlockCore` after an art failure, `reviewLock` offering the credit, the next `lockCore` waived and queued), and check 9's "known gap" assertion flips to the `art` face. The count goes from 19 to 22.
17. Decision (section 13): the verify-local section is `9i`, `artRenderCredit(A, B)`, called after `artRenderState`; `renderFixture` also returns its token list (one added field, no caller changes), and the section's fixtures use tags 131 to 135. The cleanup clears `credit_job_id` on the run's jobs before deleting them (`on delete restrict`).
18. Decision (section 4): `apps/web/src/lib/database.types.ts` gets `credit_job_id` in the `render_jobs` Row, Insert and Update, in the eight function `Returns` blocks that copy the row, and a relationship entry, written as the generator would write them, in the same commit as the migration.
19. Decision (section 9.1): the flow keeps the current stage in a ref so `settle` can tell a stage change from an unchanged poll without reading state during an effect, and resets `since` when the stage enters render and on every retry.
20. Decision (section 11): the sample run's done job is the scenario's done sample with the run's own base fields, payment and batch counts (`{ ...done, ...jobBase(job), payment, batches }`), so the receipts above the done step keep the run's lock time and quote.

## Review Focus

Inputs and failure modes the spec implies but its own test list would not exercise, most likely to bite a creator first. Each is pinned to a test in the task that owns the code.

1. An art problem (`layer-size`, `missing-image`, ...) is reported `retryable: true` by the job model, so a screen that trusted `retryable` would offer "Try again" to a creator whose retry fails the same way, five times. Expected: the `art` face, "Unlock and fix the art", never "Try again". Pinned by "answers art for every art problem code, whatever retryable says, and before retry or credit" (Task 5, `render-follow.test.ts`) and by the flipped assertion of verify-render check 9 (Task 5).
2. A creator whose 3-token render failed locks 4 tokens next: the credit must not be spent on a lock it does not cover, and a credit must be usable once only, even when two locks race. Expected: the larger lock pays in full and the credit stays for a later, smaller lock; a used credit is never offered again; the collection row lock serialises two locks. Pinned by "art_lock: a larger lock pays in full and leaves the credit for a later, smaller lock" and "art_render_credit: a used credit is no longer offered" (Task 1, verify:local 9i).
3. A retry's start message is sent with the same idempotency key as the first start and dropped for a day, so "Try again" does nothing until the sweep. Expected: the key carries the row's new retry count. Pinned by "sends one start message carrying the job's retries, so a retry is never a duplicate of the first start" (Task 3, `start.test.ts`) and by verify-render check 4b asserting `retries: 1` in the queued message (Task 3).
4. The screen keeps polling a finished or failed job, or polls every 3 seconds for an hour-long render. Expected: `pollInterval` is `false` for every state that is not followed and 15 seconds from two minutes exactly. Pinned by "is false for every state that is not followed" and "slows to 15 seconds from two minutes exactly" (Task 5, `render-follow.test.ts`).
5. The collage route presigns an empty key for a job without a collage (a placeholder job, or a job whose collage step was skipped) or answers for a signed-out visitor. Expected: 404, and the presigner is never called. Pinned by "answers 404 when the latest done job has no collage key, and when there is no done job" and "answers 404 when signed out, without reading a job" (Task 4, `collage-route.test.ts`).

## File map

| Path | Task | Responsibility |
| --- | --- | --- |
| `supabase/migrations/20261014000000_render_credit.sql` | 1 | `credit_job_id`, `private.render_credit`, `art_render_credit`, `art_unlock` and `art_lock` redefined |
| `apps/web/src/lib/database.types.ts` | 1 | The column in every row shape, the relationship, the `art_render_credit` function |
| `apps/web/scripts/verify-local.ts` | 1 | Section 9i (the credit), `renderFixture` returning its list, the cleanup clearing credit links |
| `apps/web/src/lib/art/render-job.ts`, `render-job.test.ts` | 2 | `credit_job_id` in `JobRow` and `JOB_COLUMNS`, `credited` on every job |
| `apps/web/src/lib/demo/types.ts` | 2 | `RenderJobBase.credited` |
| `apps/web/src/lib/demo/data.ts` | 2, 7 | `credited: false` on the samples (2); `SampleJobState` `failed`, the failed samples, the done sample's collage key, `imagesCid` gone (7) |
| `apps/web/src/lib/demo/data.test.ts` | 7 | The failed samples and the collage key |
| `apps/web/src/lib/art/lock-review.ts`, `lock-review.test.ts` | 2 | `ReviewData.credit`, `EMPTY_REVIEW` |
| `apps/web/src/lib/art/lock-core.ts` | 2, 3 | `reviewLock` asking `art_render_credit` (2); `retryCore`, `confirmCore` passing the row's retries (3) |
| `apps/web/src/components/upload/pay-machine.test.ts` | 2 | The test's job fixture gains `credited` |
| `apps/web/src/components/upload/review-step.tsx` | 2, 6 | The two credit sentences (2); the local `tokenPreview` (6) |
| `apps/web/src/components/upload/upload-screen.tsx` | 2, 6, 7, 8 | The sample review's `credit` (2); the sample result through `resultOf` (6); the outcomes comment (7); `sampleDone` (8) |
| `apps/web/scripts/verify-render.ts` | 2, 3, 4, 5, 9 | Checks 9b (2), 4b (3), 1b (4); check 9's face assertion (5); the refactor onto `render-deps.ts` (9) |
| `apps/web/src/lib/render/start.ts`, `start.test.ts` | 3 | `startRender(queue, { id, retries })`, `startIfReady` at 0 |
| `apps/web/src/app/actions/lock.ts` | 3 | `retryRender` |
| `apps/web/src/components/upload/upload-shared.ts`, `upload-shared.test.ts` | 3, 6 | `UploadActions.retry` (3); `RenderResult`, `resultOf(job, { collageUrl })`, `tokenPreview` gone (6) |
| `apps/web/src/components/upload/upload-actions.ts` | 3 | `retry` mapped to `retryRender` |
| `apps/web/src/components/upload/upload-sim.ts`, `upload-sim.test.ts` | 3, 7 | A `retry` stub (3); the scripted run, both outcomes, `art-problem` (7) |
| `apps/web/src/lib/storage/config.ts`, `objects.ts` | 4 | `renderBucket()`, `presignGet` with a bucket option |
| `apps/web/src/app/api/collections/[id]/collage/route.ts`, `apps/web/src/lib/storage/collage-route.test.ts` | 4 | The collage route and its test |
| `apps/web/src/components/upload/render-follow.ts`, `render-follow.test.ts` | 5 | `follows`, `pollInterval`, `faceOf`, `renderView`, the constants |
| `apps/web/src/components/upload/done-step.tsx` | 6 | The collage, the CID rows, the batch list |
| `apps/web/src/components/upload/upload-flow.tsx` | 6, 8 | The stand-in result on the new shape (6); polling, `settle`, the retry and unlock handlers, `sampleDone` (8) |
| `apps/web/public/demo/collage.svg` | 7 | The sample collage |
| `apps/web/src/components/upload/render-step.tsx` | 8 | Rewritten on `RenderView`, the four faces |
| `apps/web/src/components/upload/render-sim.ts` | 8 | Deleted |
| `apps/web/src/app/collections/[id]/upload/page.tsx` | 8 | `?job=failed`, the doc comment |
| `apps/web/scripts/render-deps.ts` | 9 | The shared local settings, clients and worker ports |
| `apps/web/scripts/render-local.ts`, `apps/web/package.json`, `CLAUDE.md` | 9 | The local render runner and its command |
| `docs/MASTER_PLAN.md`, `docs/specs/2026-10-09-lock-and-pay.md`, `docs/specs/2026-10-12-render-job-state.md`, `docs/specs/2026-10-12-render-worker.md`, `docs/specs/2026-10-14-render-screen-wiring.md` | 10 | The status, the Render credit decision, the dated notes, the landing note and the acceptance boxes |

---

### Task 1: The credit migration, the types and the verify:local section

**Files:**

- Create: `supabase/migrations/20261014000000_render_credit.sql`
- Modify: `apps/web/src/lib/database.types.ts` (the `render_jobs` Row, Insert, Update and Relationships; the eight function `Returns` blocks that copy the row; a new `art_render_credit` entry)
- Modify: `apps/web/scripts/verify-local.ts` (`renderFixture` returns `list`; `main` calls `artRenderCredit`; the new section 9i before `// 10. Cleanup`; the cleanup clears credit links first)
- Test: `pnpm --filter @cobweb/web verify:local`

**Interfaces:**

- Consumes: `private.lock_owned_collection(uuid, uuid)`, `private.collection_owned(uuid)`, the `render_jobs` waiver columns (`waived_by`, `waived_reason`), `art_claim_render`, `art_batch_start`, `art_batch_failed`, `art_batch_done`, `art_render_finish` (existing migrations).
- Produces:
  - `render_jobs.credit_job_id uuid null`, constraint `render_jobs_credit_has_waiver`, index `render_jobs_credit_job_id_idx`
  - `private.render_credit(p_collection_id uuid, p_token_count integer) returns public.render_jobs`
  - `public.art_render_credit(p_collection_id uuid, p_token_count integer) returns uuid` (`authenticated` only)
  - `public.art_unlock(uuid)` redefined, `public.art_lock(...)` redefined, same signatures and grants
  - In `database.types.ts`: `credit_job_id: string | null` on the row shapes, `art_render_credit: { Args: { p_collection_id: string; p_token_count: number }; Returns: string }`

This task needs local Supabase running. `supabase db reset` applies every migration from scratch and wipes the local storage buckets, so run `supabase seed buckets` after it.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20261014000000_render_credit.sql`:

```sql
-- The render credit (docs/specs/2026-10-14-render-screen-wiring.md, section 4): a paid render that
-- fails and is unlocked leaves a credit, and the next lock of the collection with the same or fewer
-- tokens is recorded waived on the strength of that payment, so the creator pays once. The rule lives
-- in one function, private.render_credit, which art_lock and the review's art_render_credit both ask,
-- so the web app never mirrors it. art_unlock is redefined to take the collection's latest real job
-- whatever its state, so a failed paid job can be unlocked (it keeps the worker's sentence and takes
-- the code unlocked, which every existing check for an unlocked job reads); a job failed with
-- payment-mismatch stays with support and leaves no credit. art_lock is redefined to insert a lock
-- covered by a credit as waived, with the quote columns filled as for a paid lock and credit_job_id
-- naming the job whose payment it rests on. Both keep their signatures and grants, and the rest of
-- their bodies is as in 20261009020000_lock_and_pay.sql and 20261012010000_render_job_state.sql.

-- ---------------------------------------------------------------------------------------------
-- render_jobs.credit_job_id: the job whose payment a waived lock rests on
-- ---------------------------------------------------------------------------------------------
alter table public.render_jobs
  add column credit_job_id uuid references public.render_jobs (id) on delete restrict,
  -- Only a waived job rests on a credit.
  add constraint render_jobs_credit_has_waiver check (credit_job_id is null or waived_by is not null);

-- The "named by no other job" lookup in private.render_credit.
create index render_jobs_credit_job_id_idx on public.render_jobs (credit_job_id)
  where credit_job_id is not null;

-- ---------------------------------------------------------------------------------------------
-- private.render_credit: the rule
-- ---------------------------------------------------------------------------------------------

-- The newest real job of the collection that failed and was unlocked, carries a payment or a waiver,
-- covers p_token_count, and is named by no other job's credit_job_id; null when there is none. A job
-- cancelled while unpaid has neither a payment nor a waiver, so it is never a credit. A credited job
-- that fails and is unlocked carries a waiver, so it is the next credit: the creator's one payment
-- follows the collection until a render finishes. A larger lock finds no credit and pays in full; the
-- older credit stays for a later, smaller lock.
create function private.render_credit(p_collection_id uuid, p_token_count integer)
returns public.render_jobs
language sql
stable
security definer
set search_path = ''
as $$
  select j.*
  from public.render_jobs j
  where j.collection_id = p_collection_id
    and j.kind = 'real'
    and j.state = 'failed'
    and j.error_code = 'unlocked'
    and (j.payment_tx_hash is not null or j.waived_by is not null)
    and j.token_count >= p_token_count
    and not exists (select 1 from public.render_jobs u where u.credit_job_id = j.id)
  order by j.created_at desc, j.id desc
  limit 1;
$$;

revoke all on function private.render_credit(uuid, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- art_render_credit: the review asks whether a credit covers the lock it is about to make
-- ---------------------------------------------------------------------------------------------
create function public.art_render_credit(p_collection_id uuid, p_token_count integer)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_credit public.render_jobs;
begin
  -- The owner check the read policies use: a stranger's or unknown collection reads as not found.
  if not (select private.collection_owned(p_collection_id)) then
    raise exception 'collection not found' using errcode = '42501';
  end if;
  v_credit := private.render_credit(p_collection_id, p_token_count);
  return v_credit.id;
end;
$$;

-- Granted to authenticated only: it acts for the signed-in owner, as art_render_retry does.
revoke all on function public.art_render_credit(uuid, integer) from public, anon, service_role;
grant execute on function public.art_render_credit(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- art_unlock, redefined: the latest real job whatever its state, so a failed paid job can be
-- unlocked and leave its credit. Otherwise as in 20261012010000_render_job_state.sql.
-- ---------------------------------------------------------------------------------------------
create or replace function public.art_unlock(p_collection_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_collection public.collections;
  v_job public.render_jobs;
begin
  v_collection := private.lock_owned_collection(p_collection_id, (select auth.uid()));
  -- The collection's latest real job, in any state. A job cancelled by an unlock counts here, so it
  -- is refused by name below.
  select j.* into v_job
  from public.render_jobs j
  where j.collection_id = p_collection_id and j.kind = 'real'
  order by j.created_at desc, j.id desc
  limit 1
  for update;
  -- (1) Nothing to unlock: no job, no lock on the collection, a finished job, or a job already unlocked.
  if v_job.id is null
    or v_collection.art_locked_at is null
    or v_job.state = 'done'
    or v_job.error_code = 'unlocked'
    or v_job.error = 'unlocked'
  then
    raise exception 'The art is not locked.' using errcode = '23514';
  end if;
  -- (2) The payment itself is in doubt: only support may look at it, and no credit is left.
  if v_job.state = 'failed' and v_job.error_code = 'payment-mismatch' then
    raise exception 'The payment for this job could not be verified. Tell support about it.' using errcode = '23514';
  end if;
  -- (3) Paid and waiting for a worker, rendering or finalizing: the lock holds.
  if v_job.state not in ('payment_due', 'failed') then
    raise exception 'The art is paid for and stays locked.' using errcode = '23514';
  end if;
  -- (4) A payment recorded on an open lock (a short one) keeps it, so the payment is never stranded.
  if v_job.state = 'payment_due' and v_job.payment_tx_hash is not null then
    raise exception 'A payment is recorded on this lock, so it stays.' using errcode = '23514';
  end if;
  update public.collections c
  set art_locked_at = null,
      status = case when c.status = 'art_locked' then 'draft'::public.collection_status else c.status end
  where c.id = v_collection.id;
  if v_job.state = 'payment_due' then
    -- Cancelled while unpaid, as before: no payment, no waiver, never a credit.
    update public.render_jobs j
    set state = 'failed', error = 'unlocked', error_code = 'unlocked', finished_at = now()
    where j.id = v_job.id and j.collection_id = p_collection_id;
  else
    -- A failed render: the worker's sentence, the finish time, the retries, the payment and the batch
    -- rows stay as the worker left them. The code marks the unlock and makes the job a credit.
    update public.render_jobs j
    set error_code = 'unlocked'
    where j.id = v_job.id and j.collection_id = p_collection_id;
  end if;
  -- A generative supply is saved again by the next generate; 1/1 and single asset keep theirs. A
  -- second statement, because the frozen-field guard allows a supply change only once the row is draft.
  if v_collection.project_type = 'generative' and v_collection.status = 'art_locked' then
    update public.collections c set max_supply = null where c.id = v_collection.id;
  end if;
end;
$$;

revoke all on function public.art_unlock(uuid) from public, anon;
grant execute on function public.art_unlock(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- art_lock, redefined: a lock covered by a credit is inserted waived, the quote filled as for a
-- paid lock and credit_job_id set. Otherwise as in 20261009020000_lock_and_pay.sql.
-- ---------------------------------------------------------------------------------------------
create or replace function public.art_lock(
  p_collection_id uuid,
  p_owner uuid,
  p_kind text,
  p_token_list jsonb,
  p_token_list_hash text,
  p_allow_duplicates boolean,
  p_fee_per_token_wei numeric,
  p_chain_id integer,
  p_payer text,
  p_factory text default null
)
returns public.render_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_collection public.collections;
  v_wallet text;
  v_count integer;
  v_mismatch boolean;
  v_fee numeric(78, 0);
  v_total numeric(78, 0);
  v_credit public.render_jobs;
  v_job public.render_jobs;
begin
  v_collection := private.lock_owned_collection(p_collection_id, p_owner);
  if v_collection.art_locked_at is not null or exists (
    select 1 from public.render_jobs j
    where j.collection_id = p_collection_id and j.kind = 'real' and j.state not in ('done', 'failed')
  ) then
    raise exception 'The art is already locked.' using errcode = '23514';
  end if;
  select p.wallet_address into v_wallet from public.profiles p where p.id = p_owner;
  if v_wallet is null or p_payer is distinct from v_wallet then
    raise exception 'The quote must be issued to your sign-in wallet.' using errcode = '23514';
  end if;
  if p_chain_id is null or p_chain_id <= 0 then
    raise exception 'Choose the network the fee is paid on.' using errcode = '23514';
  end if;
  -- A single asset pays nothing, so a chain without a factory may still lock it: null is allowed.
  if p_factory is not null and p_factory !~ '^0x[0-9a-f]{40}$' then
    raise exception 'Choose the network the fee is paid on.' using errcode = '23514';
  end if;
  if p_fee_per_token_wei is null or p_fee_per_token_wei < 0 or p_fee_per_token_wei <> trunc(p_fee_per_token_wei) then
    raise exception 'The fee must be a whole number of wei.' using errcode = '23514';
  end if;
  if p_token_list_hash is null or p_token_list_hash !~ '^0x[0-9a-f]{64}$' then
    raise exception 'The token list hash is not valid.' using errcode = '23514';
  end if;
  if p_token_list is null or jsonb_typeof(p_token_list) <> 'array' or jsonb_array_length(p_token_list) = 0 then
    raise exception 'There is nothing to lock yet.' using errcode = '23514';
  end if;
  if p_kind is distinct from v_collection.project_type::text then
    raise exception 'The art changed while locking. Review it again.' using errcode = '23514';
  end if;

  v_count := jsonb_array_length(p_token_list);
  if v_collection.project_type = 'generative' then
    -- Same ids, art collections and DNA as the stored tokens, no more, no less.
    with given as (
      select x.id, x."collectionId" as art_collection_id, x.dna
      from jsonb_to_recordset(p_token_list) as x(id integer, "collectionId" uuid, dna uuid[])
    ),
    stored as (
      select t.token_id as id, t.art_collection_id, t.dna
      from public.tokens t
      where t.collection_id = p_collection_id
    )
    select (select count(*) from stored) <> v_count
      or exists (select * from given except select * from stored)
      or exists (select * from stored except select * from given)
    into v_mismatch;
  else
    -- Every edition of every asset file, ids 1 to N in file order (position, upload time, id), as
    -- buildAssetTokenList in apps/web/src/lib/art/asset-tokens.ts makes them.
    with ordered as (
      select u.id, u.quantity, u.attributes,
        coalesce(sum(u.quantity) over (
          order by u.position nulls last, u.created_at, u.id
          rows between unbounded preceding and 1 preceding
        ), 0)::integer as before
      from public.uploads u
      where u.collection_id = p_collection_id and u.kind = 'asset'
    ),
    expected as (
      select o.before + g.n as id, o.id as upload_id, o.attributes
      from ordered o
      cross join lateral generate_series(1, o.quantity) as g(n)
    ),
    given as (
      select x.id, x."uploadId" as upload_id, x.attributes
      from jsonb_to_recordset(p_token_list) as x(id integer, "uploadId" uuid, attributes jsonb)
    )
    select (select count(*) from expected) <> v_count
      or exists (select * from given except select * from expected)
      or exists (select * from expected except select * from given)
    into v_mismatch;
  end if;
  if v_mismatch then
    raise exception 'The art changed while locking. Review it again.' using errcode = '23514';
  end if;

  -- A zero or missing fee means the chain's fee is not set: only a single asset may cost nothing.
  if v_collection.project_type <> 'single_asset' and (p_fee_per_token_wei is null or p_fee_per_token_wei = 0) then
    raise exception 'This chain is not ready for payments yet.' using errcode = '23514';
  end if;
  if v_collection.max_supply is not null and v_collection.max_supply <> v_count then
    raise exception 'The supply does not match the tokens. Generate again.' using errcode = '23514';
  end if;

  -- A single asset pays nothing (MASTER_PLAN, Decisions: art fee).
  v_fee := case when v_collection.project_type = 'single_asset' then 0 else p_fee_per_token_wei end;
  v_total := v_fee * v_count;

  -- The collections row first, as the lock trigger's note in the art tables migration asks. Locking
  -- fixes the token count (supply_set_after_draft), so a supply not yet set takes the locked count.
  update public.collections c
  set art_locked_at = now(),
      max_supply = coalesce(c.max_supply, v_count),
      status = case when c.status = 'draft' then 'art_locked'::public.collection_status else c.status end
  where c.id = p_collection_id;

  -- The credit: a paid render of this collection that failed and was unlocked, covering this count.
  -- The collection row lock above serialises two locks, so a credit is used once. A lock that owes
  -- nothing needs none.
  if v_total > 0 then
    v_credit := private.render_credit(p_collection_id, v_count);
  end if;

  insert into public.render_jobs (
    collection_id, kind, state, token_count, token_list_hash, allow_duplicates,
    fee_per_token_wei, quote_total_wei, quote_chain_id, quote_payer, quote_factory, quote_expires_at,
    paid_at, waived_by, waived_reason, credit_job_id, batch_size, batches_total, token_list
  )
  values (
    p_collection_id,
    'real',
    case
      when v_credit.id is not null then 'waived'::public.render_state
      when v_total = 0 then 'paid'::public.render_state
      else 'payment_due'::public.render_state
    end,
    v_count,
    p_token_list_hash,
    coalesce(p_allow_duplicates, false),
    v_fee,
    v_total,
    p_chain_id,
    v_wallet,
    p_factory,
    now() + interval '24 hours',
    case when v_credit.id is not null or v_total = 0 then now() end,
    case when v_credit.id is not null then p_owner end,
    case when v_credit.id is not null then 'credit' end,
    v_credit.id,
    100,
    ceil(v_count / 100.0)::integer,
    case when v_collection.project_type = 'generative' then null else p_token_list end
  )
  returning * into v_job;
  return v_job;
end;
$$;

revoke all on function public.art_lock(uuid, uuid, text, jsonb, text, boolean, numeric, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.art_lock(uuid, uuid, text, jsonb, text, boolean, numeric, integer, text, text)
  to service_role;
```

- [ ] **Step 2: Apply the migration locally**

```bash
supabase db reset
supabase seed buckets
```

Expected: the reset output lists `Applying migration 20261014000000_render_credit.sql...` after the earlier migrations with no error and ends `Finished supabase db reset`; the seed prints that the `art` and `render` buckets exist. If the reset fails on this file, the SQL error names the statement; fix the migration and reset again.

- [ ] **Step 3: Update the generated types by hand**

In `apps/web/src/lib/database.types.ts`, every block that lists `collage_key` is a copy of the `render_jobs` row (the table's `Row`, `Insert` and `Update`, and the `Returns` of `art_batch_failed`, `art_claim_render`, `art_lock`, `art_lock_placeholder`, `art_record_payment`, `art_render_finish`, `art_render_retry` and `art_requote`: eleven blocks). In each, insert a `credit_job_id` line directly after the block's `created_at` line, with the same optionality (`credit_job_id: string | null` where the block has `created_at: string`, `credit_job_id?: string | null` where it has `created_at?: string`). This command does exactly that, from `apps/web`:

```bash
node -e '
const fs = require("fs")
const path = "src/lib/database.types.ts"
let text = fs.readFileSync(path, "utf8")
text = text.replace(
  /^(\s*)collage_key(\??): string \| null\n([\s\S]*?)^(\s*)created_at(\??): string\n/gm,
  (block, _i1, _o1, _mid, indent, optional) => `${block}${indent}credit_job_id${optional}: string | null\n`,
)
fs.writeFileSync(path, text)
'
grep -c 'credit_job_id' src/lib/database.types.ts
```

Expected: `11`.

Then, in the `render_jobs` block's `Relationships` array, insert this entry between the `render_jobs_collection_id_fkey` entry and the `render_jobs_placeholder_upload_id_fkey` entry:

```ts
          {
            foreignKeyName: 'render_jobs_credit_job_id_fkey'
            columns: ['credit_job_id']
            isOneToOne: false
            referencedRelation: 'render_jobs'
            referencedColumns: ['id']
          },
```

And in `Functions`, directly before the line `      art_render_finish: {`, insert:

```ts
      art_render_credit: { Args: { p_collection_id: string; p_token_count: number }; Returns: string }
```

Run `grep -c 'credit_job_id' src/lib/database.types.ts` again. Expected: `13`.

- [ ] **Step 4: Make `renderFixture` return its list**

In `apps/web/scripts/verify-local.ts`, in `renderFixture` (section 9h), replace

```ts
  return { cid, jobId }
}
```

with

```ts
  return { cid, jobId, list }
}
```

- [ ] **Step 5: Write section 9i**

In `apps/web/scripts/verify-local.ts`, directly before the comment block that starts `// 10. Cleanup` (the three lines beginning `// ----`), insert:

```ts
// ---------------------------------------------------------------------------------------------
// 9i. The render credit: art_unlock on a failed paid job, private.render_credit through
// art_render_credit, and art_lock recording a credited lock waived
// (docs/specs/2026-10-14-render-screen-wiring.md, section 4)
// ---------------------------------------------------------------------------------------------

/** Takes a paid one-batch job to `failed` the way the worker does: the claim, a start, a final failure. */
async function failRender(jobId: string, code: string, message: string): Promise<string | null> {
  const { failed } = await runSteps(
    [
      ['art_claim_render', { p_job_id: jobId }],
      ['art_batch_start', { p_job_id: jobId, p_index: 0 }],
      [
        'art_batch_failed',
        { p_job_id: jobId, p_index: 0, p_code: code, p_message: message, p_final: true },
      ],
    ],
    async () => '',
  )
  return failed
}

type CreditRow = {
  id: string
  state: string
  error: string | null
  error_code: string | null
  finished_at: string | null
  retries: number
  payment_tx_hash: string | null
  waived_by: string | null
  waived_reason: string | null
  credit_job_id: string | null
  paid_at: string | null
  quote_total_wei: string
  quote_chain_id: number | null
  quote_payer: string | null
  quote_factory: string | null
  quote_expires_at: string | null
}

async function creditRow(id: string): Promise<CreditRow> {
  const { data, error } = await admin
    .from('render_jobs')
    .select(
      'id, state, error, error_code, finished_at, retries, payment_tx_hash, waived_by, waived_reason, credit_job_id, paid_at, quote_total_wei::text, quote_chain_id, quote_payer, quote_factory, quote_expires_at',
    )
    .eq('id', id)
    .single()
  if (error) throw new Error(`credit row: ${describe(error as DbError)}`)
  return data as unknown as CreditRow
}

const PINNED_ELSEWHERE = 'The pinning service answered with a different CID.'

const creditOf = async (client: SupabaseClient, cid: string, count: number) =>
  callArt(client, 'art_render_credit', { p_collection_id: cid, p_token_count: count })

async function artRenderCredit(A: Creator, B: Creator): Promise<void> {
  const payer = A.account.address.toLowerCase()
  // A paid job failed by the worker, unlocked, then locked again on its credit.
  const paid = await renderFixture(A, payer, 131)
  // A paid job failed with payment-mismatch before the claim: no unlock, no credit.
  const mismatch = await renderFixture(A, payer, 132)
  // A paid job claimed and left rendering.
  const rendering = await renderFixture(A, payer, 133)
  // A paid job taken to done.
  const finished = await renderFixture(A, payer, 134)
  // A job waiting for payment, unlocked while unpaid.
  const unpaid = await renderFixture(A, payer, 135, false)
  let credited = ''

  await check('render credit: the column exists and a credit link needs a waiver', async () => {
    const row = await admin.from('render_jobs').select('credit_job_id').limit(1)
    if (row.error) return describe(row.error as DbError)
    const bad = await admin.from('render_jobs').update({ credit_job_id: paid.jobId }).eq('id', mismatch.jobId)
    return expectError(bad.error as DbError, CHECK)
  })

  await check(
    'art_unlock: a paid job the worker failed is unlocked, keeps its sentence and takes the code unlocked',
    async () => {
      const failed = await failRender(paid.jobId, 'cid-mismatch', PINNED_ELSEWHERE)
      if (failed) return `setup: ${failed}`
      const before = await creditRow(paid.jobId)
      if (before.state !== 'failed' || (await lockState(paid.cid)).status !== 'art_locked')
        return `setup: ${JSON.stringify(before)}`
      const { error } = await callArt(A.client, 'art_unlock', { p_collection_id: paid.cid })
      if (error) return describe(error)
      const job = await creditRow(paid.jobId)
      const state = await lockState(paid.cid)
      const batch = (await batchesOf(paid.jobId))[0]
      return job.state === 'failed' &&
        job.error === PINNED_ELSEWHERE &&
        job.error_code === 'unlocked' &&
        job.finished_at === before.finished_at &&
        job.retries === before.retries &&
        job.payment_tx_hash === before.payment_tx_hash &&
        batch?.state === 'failed' &&
        state.art_locked_at === null &&
        state.status === 'draft' &&
        state.max_supply === null
        ? null
        : `${JSON.stringify(job)} ${JSON.stringify(batch)} ${JSON.stringify(state)}`
    },
  )

  await check(
    'art_render_credit: the owner sees the credit for the same count and a smaller one, none for a larger one',
    async () => {
      const same = await creditOf(A.client, paid.cid, 3)
      if (same.error) return describe(same.error)
      const smaller = await creditOf(A.client, paid.cid, 2)
      if (smaller.error) return describe(smaller.error)
      const larger = await creditOf(A.client, paid.cid, 4)
      if (larger.error) return describe(larger.error)
      return same.data === paid.jobId && smaller.data === paid.jobId && larger.data === null
        ? null
        : JSON.stringify({ same: same.data, smaller: smaller.data, larger: larger.data })
    },
  )

  await check("art_render_credit: B's session on A's collection is refused as not found", async () => {
    const { error } = await creditOf(B.client, paid.cid, 3)
    return expectSentence(error, PERMISSION, 'collection not found')
  })

  await check('art_render_credit: the service role and a signed-out caller cannot execute it', async () => {
    const problems: string[] = []
    for (const [who, client] of [
      ['service role', admin],
      ['signed out', anon],
    ] as const) {
      const { error } = await creditOf(client, paid.cid, 3)
      const problem = expectSentence(error, PERMISSION, 'permission denied')
      if (problem) problems.push(`${who}: ${problem}`)
    }
    return problems.length ? problems.join('; ') : null
  })

  await check(
    'art_lock: the next lock at the same count is waived on the credit, with the quote filled and the link set',
    async () => {
      const { data, error } = await callArt(admin, 'art_lock', lockArgs(A.userId, paid.cid, paid.list, payer))
      if (error) return describe(error)
      credited = idOf(data)
      const job = await creditRow(credited)
      const state = await lockState(paid.cid)
      return job.state === 'waived' &&
        job.waived_by === A.userId &&
        job.waived_reason === 'credit' &&
        job.credit_job_id === paid.jobId &&
        job.paid_at !== null &&
        job.payment_tx_hash === null &&
        job.quote_total_wei === '75000000000000' &&
        job.quote_chain_id === 31337 &&
        job.quote_payer === payer &&
        job.quote_factory === FACTORY_ADDRESS &&
        job.quote_expires_at !== null &&
        state.art_locked_at !== null &&
        state.status === 'art_locked'
        ? null
        : `${JSON.stringify(job)} ${JSON.stringify(state)}`
    },
  )

  await check('art_render_credit: a used credit is no longer offered', async () => {
    const { data, error } = await creditOf(A.client, paid.cid, 3)
    if (error) return describe(error)
    return data === null ? null : `still offered: ${JSON.stringify(data)}`
  })

  await check('art_unlock: a waived job waiting for a worker stays locked', async () => {
    const { error } = await callArt(A.client, 'art_unlock', { p_collection_id: paid.cid })
    return expectSentence(error, CHECK, 'The art is paid for and stays locked.')
  })

  await check(
    'render credit: a credited job that fails and is unlocked is the next credit, and the one before it stays used',
    async () => {
      const failed = await failRender(credited, 'dead-letter', 'The render stopped after three tries.')
      if (failed) return `setup: ${failed}`
      const unlock = await callArt(A.client, 'art_unlock', { p_collection_id: paid.cid })
      if (unlock.error) return `unlock: ${describe(unlock.error)}`
      const job = await creditRow(credited)
      if (job.state !== 'failed' || job.error_code !== 'unlocked' || job.waived_reason !== 'credit')
        return JSON.stringify(job)
      const { data, error } = await creditOf(A.client, paid.cid, 3)
      if (error) return describe(error)
      return data === credited ? null : `credit ${JSON.stringify(data)}, expected the credited job`
    },
  )

  await check('art_unlock: an already unlocked job is refused as not locked', async () => {
    const { error } = await callArt(A.client, 'art_unlock', { p_collection_id: paid.cid })
    return expectSentence(error, CHECK, 'The art is not locked.')
  })

  await check(
    'art_lock: a larger lock pays in full and leaves the credit for a later, smaller lock',
    async () => {
      // A fourth token, so the next lock asks for more than the credit covers.
      const first = await admin
        .from('tokens')
        .select('art_collection_id, dna')
        .eq('collection_id', paid.cid)
        .eq('token_id', 1)
        .single()
      if (first.error) return `setup: ${describe(first.error as DbError)}`
      const art = first.data.art_collection_id
      const dna = first.data.dna as string[]
      const insert = await A.client.from('tokens').insert(tokenRow(paid.cid, art, 4, dna))
      if (insert.error) return `setup: ${describe(insert.error as DbError)}`
      const list = [...paid.list, { id: 4, collectionId: art, dna }]
      const { data, error } = await callArt(admin, 'art_lock', lockArgs(A.userId, paid.cid, list, payer))
      if (error) return describe(error)
      const job = await creditRow(idOf(data))
      if (job.state !== 'payment_due' || job.credit_job_id !== null || job.waived_by !== null)
        return JSON.stringify(job)
      const offered = await creditOf(A.client, paid.cid, 3)
      if (offered.error) return describe(offered.error)
      if (offered.data !== credited) return `credit ${JSON.stringify(offered.data)} while a larger lock is open`
      // Cancelled unpaid: the lock opens again and the credit is untouched.
      const unlock = await callArt(A.client, 'art_unlock', { p_collection_id: paid.cid })
      if (unlock.error) return `unlock: ${describe(unlock.error)}`
      const cancelled = await creditRow(job.id)
      const again = await creditOf(A.client, paid.cid, 3)
      return cancelled.state === 'failed' &&
        cancelled.error === 'unlocked' &&
        cancelled.error_code === 'unlocked' &&
        cancelled.payment_tx_hash === null &&
        again.data === credited
        ? null
        : `${JSON.stringify(cancelled)} credit ${JSON.stringify(again.data)}`
    },
  )

  await check('art_unlock: a job failed with payment-mismatch is refused, and leaves no credit', async () => {
    const { error: fail } = await callArt(admin, 'art_batch_failed', {
      p_job_id: mismatch.jobId,
      p_index: null,
      p_code: 'payment-mismatch',
      p_message: 'The payment could not be verified on chain.',
      p_final: true,
    })
    if (fail) return `setup: ${describe(fail)}`
    const { error } = await callArt(A.client, 'art_unlock', { p_collection_id: mismatch.cid })
    const refused = expectSentence(
      error,
      CHECK,
      'The payment for this job could not be verified. Tell support about it.',
    )
    if (refused) return refused
    const state = await lockState(mismatch.cid)
    const credit = await creditOf(A.client, mismatch.cid, 1)
    return state.art_locked_at !== null && credit.data === null
      ? null
      : `${JSON.stringify(state)} credit ${JSON.stringify(credit.data)}`
  })

  await check('art_unlock: a rendering job is refused as paid for', async () => {
    const claim = await callArt(admin, 'art_claim_render', { p_job_id: rendering.jobId })
    if (claim.error) return `setup: ${describe(claim.error)}`
    const { error } = await callArt(A.client, 'art_unlock', { p_collection_id: rendering.cid })
    const refused = expectSentence(error, CHECK, 'The art is paid for and stays locked.')
    if (refused) return refused
    return (await lockState(rendering.cid)).status === 'rendering'
      ? null
      : 'the refused call changed the collection'
  })

  await check('art_unlock: a done job is refused as not locked', async () => {
    const { failed } = await runSteps(
      [
        ['art_claim_render', { p_job_id: finished.jobId }],
        ['art_batch_start', { p_job_id: finished.jobId, p_index: 0 }],
        [
          'art_batch_done',
          { p_job_id: finished.jobId, p_index: 0, p_images_cid: CID('k'), p_images_size: 64 },
        ],
        [
          'art_render_finish',
          { p_job_id: finished.jobId, p_metadata_cid: CID('l'), p_base_uri: `ipfs://${CID('l')}/` },
        ],
      ],
      async () => '',
    )
    if (failed) return `setup: ${failed}`
    const { error } = await callArt(A.client, 'art_unlock', { p_collection_id: finished.cid })
    const refused = expectSentence(error, CHECK, 'The art is not locked.')
    if (refused) return refused
    const state = await lockState(finished.cid)
    return state.status === 'rendered' && state.art_locked_at !== null ? null : JSON.stringify(state)
  })

  await check(
    'art_unlock: an unpaid job is still cancelled with both fields unlocked, and is never a credit',
    async () => {
      const { error } = await callArt(A.client, 'art_unlock', { p_collection_id: unpaid.cid })
      if (error) return describe(error)
      const job = await creditRow(unpaid.jobId)
      const state = await lockState(unpaid.cid)
      const credit = await creditOf(A.client, unpaid.cid, 1)
      return job.state === 'failed' &&
        job.error === 'unlocked' &&
        job.error_code === 'unlocked' &&
        job.finished_at !== null &&
        state.art_locked_at === null &&
        state.status === 'draft' &&
        credit.data === null
        ? null
        : `${JSON.stringify(job)} ${JSON.stringify(state)} credit ${JSON.stringify(credit.data)}`
    },
  )
}
```

In `main`, directly after the line `  await artRenderState(A, B)`, add:

```ts
  await artRenderCredit(A, B)
```

In `cleanup`, replace the first check with:

```ts
  await check('cleanup: delete render jobs created by this run', async () => {
    if (createdJobIds.size === 0) return null
    // A credited lock points at the job it rests on (on delete restrict): clear the links first.
    const unlinked = await admin
      .from('render_jobs')
      .update({ credit_job_id: null })
      .in('id', [...createdJobIds])
    if (unlinked.error) return describe(unlinked.error)
    const { error } = await admin
      .from('render_jobs')
      .delete()
      .in('id', [...createdJobIds])
    return error ? describe(error) : null
  })
```

- [ ] **Step 6: Run verify:local**

Run: `pnpm --filter @cobweb/web verify:local`
Expected: fifteen new `PASS` lines whose names start `render credit:`, `art_unlock:`, `art_render_credit:` and `art_lock:` appear after section 9h's lines, and the script ends `289 passed, 0 failed` (274 before this task, 15 added). The earlier `art_unlock` checks in 9g ("while payment is due", "with nothing locked", "after payment is refused", "clears a generative supply", "a recorded payment protects the job") still print PASS: the redefinition keeps their behaviour.

- [ ] **Step 7: Format, run the root checks and commit**

```bash
pnpm exec prettier --write apps/web/src/lib/database.types.ts apps/web/scripts/verify-local.ts
pnpm typecheck && pnpm lint && pnpm test
git add supabase/migrations/20261014000000_render_credit.sql apps/web/src/lib/database.types.ts apps/web/scripts/verify-local.ts
git commit -m "$(cat <<'EOF'
Add the render credit: a failed paid job can be unlocked and the next lock it covers is recorded waived

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

---

### Task 2: The credit on the web side

**Files:**

- Modify: `apps/web/src/lib/demo/types.ts` (`RenderJobBase`)
- Modify: `apps/web/src/lib/art/render-job.ts` (`JobRow`, `JOB_COLUMNS`, `toRenderJob`, `pendingJob`, `jobBase`)
- Modify: `apps/web/src/lib/demo/data.ts` (the `jobBase` literal)
- Modify: `apps/web/src/components/upload/pay-machine.test.ts` (the `paidWith` fixture)
- Modify: `apps/web/src/lib/art/lock-review.ts` (`ReviewData`, `EMPTY_REVIEW`, `reviewData`)
- Modify: `apps/web/src/lib/art/lock-core.ts` (`reviewLock`)
- Modify: `apps/web/src/components/upload/upload-screen.tsx` (`sampleReview`)
- Modify: `apps/web/src/components/upload/review-step.tsx` (the two sentences)
- Modify: `apps/web/src/components/upload/upload-flow.tsx` (the pay item's receipt)
- Modify: `apps/web/scripts/verify-render.ts` (check 9 hoisted, check 9b)
- Test: `apps/web/src/lib/art/render-job.test.ts`, `apps/web/src/lib/art/lock-review.test.ts`, `pnpm --filter @cobweb/web verify:render`

**Interfaces:**

- Consumes: `art_render_credit(p_collection_id, p_token_count)` (Task 1); `JobRow`, `toRenderJob`, `pendingJob`, `jobBase` (existing); `unlockCore`, `lockCore`, `reviewLock` from `lock-core.ts`; `memoryQueue` from `@cobweb/worker/local`.
- Produces:
  - `RenderJobBase.credited: boolean` on every `RenderJob`
  - `JobRow.credit_job_id: string | null`; `JOB_COLUMNS` reads `credit_job_id`
  - `ReviewData.credit: boolean`; `EMPTY_REVIEW.credit === false`; `reviewData(...)` answers `credit: false`
  - `reviewLock(ctx): Promise<ReviewData>` with `credit` from the database

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/lib/art/render-job.test.ts`, in the `row` helper add `credit_job_id: null,` directly after `collage_key: null,`. Replace the test `'reads the new job columns and the batch columns, and no longer reads images_cid'` with:

```ts
  it('reads the new job columns and the batch columns, and no longer reads images_cid', () => {
    for (const column of [
      'base_uri',
      'placeholder_image_cid',
      'collage_key',
      'error_code',
      'retries',
      'credit_job_id',
    ])
      expect(JOB_COLUMNS).toContain(column)
    expect(JOB_COLUMNS).not.toContain('images_cid')
    expect(BATCH_COLUMNS).toBe('index, state, attempts, images_cid, images_size, error, error_code')
  })

  it('marks a job locked on a credit as credited, and every other job as not', () => {
    const credit = '7a1c0f3e-2f5e-4e3a-9d1c-1b2c3d4e5f62'
    expect(toRenderJob(row({ state: 'waived', credit_job_id: credit }), [], extra)).toMatchObject({
      state: 'waived',
      credited: true,
      payment: null,
    })
    expect(toRenderJob(row(), [], extra).credited).toBe(false)
    expect(toRenderJob(row({ state: 'waived' }), [], extra).credited).toBe(false)
  })
```

In the `pendingJob` test, replace `placeholder: null,` inside the `toMatchObject` with:

```ts
      placeholder: null,
      credited: false,
```

In `apps/web/src/lib/art/lock-review.test.ts`, in the first test's `toEqual` object add `credit: false,` after `constants: [{ name: 'Wide', count: 1 }],`, and add this test at the end of the `describe('reviewData for a generative project', ...)` block:

```ts
  it('never claims a credit on its own: the database decides that', () => {
    const review = reviewData(generative([{ id: 1, collectionId: 'c1', dna: ['wide'] }]), 'generative')
    expect(review.credit).toBe(false)
    expect(EMPTY_REVIEW.credit).toBe(false)
  })
```

and change the import line to `import { EMPTY_REVIEW, lockRefusal, reviewChecks, reviewData, type LockList } from './lock-review'`.

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @cobweb/web exec vitest run src/lib/art/render-job.test.ts src/lib/art/lock-review.test.ts`
Expected: FAIL. `JOB_COLUMNS` does not contain `credit_job_id`, `credited` is undefined, and `credit` is missing from the review.

- [ ] **Step 3: Add `credited` to the job model**

In `apps/web/src/lib/demo/types.ts`, in `RenderJobBase`, after the `placeholder: RenderPlaceholder | null` member add:

```ts
  /** True when the lock was recorded waived on the credit of a paid render that failed (`render_jobs.credit_job_id`). */
  credited: boolean
```

In `apps/web/src/lib/art/render-job.ts`:

1. In `JobRow`, after `retries: number` add:

```ts
  /** The job whose payment this waived lock rests on, or null. */
  credit_job_id: string | null
```

2. Replace the `JOB_COLUMNS` constant with:

```ts
export const JOB_COLUMNS =
  'id, collection_id, kind, state, token_count, token_list_hash, allow_duplicates, fee_per_token_wei::text, quote_total_wei::text, quote_chain_id, quote_payer, quote_factory, quote_expires_at, payment_tx_hash, paid_at, paid_amount_wei::text, batch_size, batches_total, batches_done, metadata_cid, base_uri, placeholder_image_cid, collage_key, placeholder_upload_id, onchain_job_id, error, error_code, retries, credit_job_id, created_at, started_at, finished_at'
```

3. In `toRenderJob`, in the `base` literal after `placeholder: placeholderOf(extra.placeholder, row.placeholder_image_cid),` add:

```ts
    credited: row.credit_job_id !== null,
```

4. In `pendingJob`, after `placeholder: placeholderOf(placeholder, null),` add `credited: false,`.

5. Replace `jobBase` with:

```ts
/** The fields every state shares, to build a job in another state from it (sample mode). */
export function jobBase(job: RenderJob): RenderJobBase {
  const { id, jobId, tokenCount, lockedAt, tokenListHash, quote, lockOptions, placeholder, credited } = job
  return { id, jobId, tokenCount, lockedAt, tokenListHash, quote, lockOptions, placeholder, credited }
}
```

In `apps/web/src/lib/demo/data.ts`, in the `jobBase` object literal (the one with `id: 'job_night_owls_01'`), after `lockOptions: { allowDuplicates: false },` add `credited: false,`. The deferred base spreads it.

In `apps/web/src/components/upload/pay-machine.test.ts`, in `paidWith`, after `placeholder: null,` add `credited: false,`.

- [ ] **Step 4: Add `credit` to the review**

In `apps/web/src/lib/art/lock-review.ts`:

1. In `ReviewData`, after `constants: { name: string; count: number }[]` add:

```ts
  /** A paid render that failed and was unlocked left a credit that covers this lock: the lock is free. */
  credit: boolean
```

2. In `EMPTY_REVIEW`, after `constants: [],` add `credit: false,`.

3. In `reviewData`, add `credit: false,` after `constants: [],` in the assets branch and after the `constants:` entry in the generative branch (the pure review never claims a credit; the core asks the database).

In `apps/web/src/lib/art/lock-core.ts`, replace `reviewLock` with:

```ts
export async function reviewLock(ctx: LockContext): Promise<ReviewData> {
  const review = reviewData(await readLockList(ctx.supabase, ctx.collection), ctx.collection.project_type)
  return { ...review, credit: await creditCovers(ctx, review.tokenCount) }
}

/**
 * Whether a credit from a paid render that failed and was unlocked covers a lock of this many tokens
 * (docs/specs/2026-10-14-render-screen-wiring.md, section 5). The rule is the database's
 * (`private.render_credit`); the web app only asks, under the creator's client.
 */
async function creditCovers(ctx: LockContext, tokenCount: number): Promise<boolean> {
  if (tokenCount === 0) return false
  const { data, error } = await ctx.supabase.rpc('art_render_credit', {
    p_collection_id: ctx.collection.id,
    p_token_count: tokenCount,
  })
  if (error) throw new Error(`The render credit could not be read: ${error.message}`)
  // The credit job's id, or null when there is none; the generated type says string.
  return Boolean(data)
}
```

Also in `LockContext`, replace the doc comment of `supabase` with:

```ts
  /** The creator's client under row-level security: every read, `art_unlock`, `art_lock_placeholder`, `art_render_credit`, `art_render_retry`. */
```

In `apps/web/src/components/upload/upload-screen.tsx`, in `sampleReview`'s returned object, after the `constants:` entry add `credit: false,`.

- [ ] **Step 5: Show the credit on the review step and the pay receipt**

In `apps/web/src/components/upload/review-step.tsx`, replace the footer sentence

```tsx
                : 'Locking is final once the fee is paid. Until then you can unlock and edit again.')}
```

with

```tsx
                : review.credit
                  ? 'Locking is final: the credit pays the fee at once.'
                  : 'Locking is final once the fee is paid. Until then you can unlock and edit again.')}
```

and in the `AlertDialogDescription`, replace

```tsx
                : `Cobweb checks and stores these ${fmt(review.tokenCount)} tokens exactly as they are now, and quotes the fee from this supply. You cannot edit the layers, traits, rules or tokens afterwards, unless you unlock before paying.`}
```

with

```tsx
                : review.credit
                  ? `Cobweb checks and stores these ${fmt(review.tokenCount)} tokens exactly as they are now. The render that failed left a credit, so this lock is free and the render starts at once. You cannot edit the layers, traits, rules or tokens afterwards.`
                  : `Cobweb checks and stores these ${fmt(review.tokenCount)} tokens exactly as they are now, and quotes the fee from this supply. You cannot edit the layers, traits, rules or tokens afterwards, unless you unlock before paying.`}
```

The button keeps its label.

In `apps/web/src/components/upload/upload-flow.tsx`, in the second `ProgressionItem` (title "Pay the generation fee"), replace

```tsx
          receipt={
            free ? (
```

with

```tsx
          receipt={
            job.credited ? (
              'No fee: covered by the credit from the render that failed'
            ) : free ? (
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `pnpm --filter @cobweb/web exec vitest run src/lib/art/render-job.test.ts src/lib/art/lock-review.test.ts src/components/upload/pay-machine.test.ts`
Expected: PASS. `render-job.test.ts` 20 tests (19 before), `lock-review.test.ts` 7 tests (6 before), `pay-machine.test.ts` unchanged.

- [ ] **Step 7: Check the credit end to end in verify:render**

In `apps/web/scripts/verify-render.ts`:

1. Change the dynamic import of the cores to:

```ts
const { confirmCore, loadJob, lockCore, lockPlaceholderCore, reviewLock, unlockCore } = await import(
  '../src/lib/art/lock-core.ts'
)
```

2. Hoist check 9's project. Replace

```ts
  // 9. A layer of the wrong size (the spec's check 8).
  await check('9. a layer of the wrong size fails the job with layer-size and its sentence', async () => {
    const cid = await seededProject(creator.client, 'nine', true)
    const jobId = await lockedAndPaid(creator, cid)
```

with

```ts
  // 9. A layer of the wrong size (the spec's check 8). The project is shared with 9b.
  const wrongSize = await seededProject(creator.client, 'nine', true)
  const wrongSizeJob = await lockedAndPaid(creator, wrongSize)
  await check('9. a layer of the wrong size fails the job with layer-size and its sentence', async () => {
    const cid = wrongSize
    const jobId = wrongSizeJob
```

3. Directly after check 9's closing `})`, before `// 10. The sweep, a job left finalizing`, add:

```ts
  // 9b. The credit on the web side (docs/specs/2026-10-14-render-screen-wiring.md, sections 4 and 5):
  // the art failure is unlocked through the core, the review offers the credit, and the next lock is
  // recorded waived on it and queued at once.
  await check(
    '9b. after an art failure the unlock leaves a credit: the review says so, and the next lock is waived and queued',
    async () => {
      const queue = local.memoryQueue()
      const ctx = {
        ...(await contextFor(creator.client, creator.userId, creator.account.address, wrongSize)),
        queue,
      }
      const unlocked = await unlockCore(ctx)
      if (!('data' in unlocked)) return `unlock: ${refusal(unlocked)}`
      const before = await jobRow(wrongSizeJob)
      if (before.state !== 'failed' || before.error_code !== 'unlocked')
        return `after the unlock: ${JSON.stringify(before)}`
      if ((await statusOf(wrongSize)) !== 'draft') return `collection ${await statusOf(wrongSize)}`
      const review = await reviewLock(ctx)
      if (!review.credit) return `the review offers no credit: ${JSON.stringify(review)}`
      const locked = await lockCore(ctx, { allowDuplicates: false, chainId: 31337 })
      if (!('data' in locked)) return `lock: ${refusal(locked)}`
      const job = locked.data
      if (job.state !== 'waived' || !job.credited)
        return `the lock came back ${job.state}, credited ${String(job.credited)}`
      const want = [{ jobId: job.id, step: 'start', retries: 0 }]
      if (JSON.stringify(queue.sent) !== JSON.stringify(want)) return `queued ${JSON.stringify(queue.sent)}`
      // The credit is used: a review of the same count now offers none.
      const again = await reviewLock(ctx)
      return again.credit ? 'the used credit is still offered' : null
    },
  )
```

Run: `pnpm --filter @cobweb/web verify:render`
Expected: `20 passed, 0 failed`, with `PASS 9b. ...` after `PASS 9. ...`.

- [ ] **Step 8: Format, run the root checks and commit**

```bash
pnpm exec prettier --write apps/web/src/lib/demo/types.ts apps/web/src/lib/art/render-job.ts apps/web/src/lib/art/render-job.test.ts apps/web/src/lib/demo/data.ts apps/web/src/components/upload/pay-machine.test.ts apps/web/src/lib/art/lock-review.ts apps/web/src/lib/art/lock-review.test.ts apps/web/src/lib/art/lock-core.ts apps/web/src/components/upload/upload-screen.tsx apps/web/src/components/upload/review-step.tsx apps/web/src/components/upload/upload-flow.tsx apps/web/scripts/verify-render.ts
pnpm typecheck && pnpm lint && pnpm test
git add apps/web/src/lib/demo/types.ts apps/web/src/lib/art/render-job.ts apps/web/src/lib/art/render-job.test.ts apps/web/src/lib/demo/data.ts apps/web/src/components/upload/pay-machine.test.ts apps/web/src/lib/art/lock-review.ts apps/web/src/lib/art/lock-review.test.ts apps/web/src/lib/art/lock-core.ts apps/web/src/components/upload/upload-screen.tsx apps/web/src/components/upload/review-step.tsx apps/web/src/components/upload/upload-flow.tsx apps/web/scripts/verify-render.ts
git commit -m "$(cat <<'EOF'
Show the render credit on the review and the pay receipt, and mark a job locked on one as credited

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: the web package reports 307 tests (305 before, 2 added).

---

### Task 3: The retry action

**Files:**

- Modify: `apps/web/src/lib/render/start.ts`, `apps/web/src/lib/render/start.test.ts`
- Modify: `apps/web/src/lib/art/lock-core.ts` (`confirmCore`, new `retryCore`)
- Modify: `apps/web/src/app/actions/lock.ts` (`retryRender`)
- Modify: `apps/web/src/components/upload/upload-shared.ts` (`UploadActions.retry`)
- Modify: `apps/web/src/components/upload/upload-actions.ts`, `apps/web/src/components/upload/upload-sim.ts`
- Modify: `apps/web/scripts/verify-render.ts` (check 4b)
- Test: `start.test.ts`, `pnpm --filter @cobweb/web verify:render`

**Interfaces:**

- Consumes: `enqueueRender(queue, { id, retries })` and `messageKey` from `@cobweb/shared/render-queue`; `art_render_retry(p_collection_id)` (existing); `lockWrite`, `loadJob`, `LockContext`, `LockOutcome`.
- Produces:
  - `startRender(queue: RenderQueue, job: { id: string; retries: number }, log?: (line: string) => void): Promise<void>`
  - `startIfReady(queue: RenderQueue, job: { id: string; state: string }, log?: (line: string) => void): Promise<void>` (sends `retries: 0`)
  - `retryCore(ctx: LockContext): Promise<LockOutcome<RenderJob>>` in `@/lib/art/lock-core`
  - `retryRender(collectionId: string): Promise<ActionResult<RenderJob>>` in `@/app/actions/lock`
  - `UploadActions.retry(): Promise<ActionResult<RenderJob>>`

- [ ] **Step 1: Write the failing tests**

Replace `apps/web/src/lib/render/start.test.ts` with:

```ts
import { messageKey, type RenderMessage, type RenderQueue } from '@cobweb/shared/render-queue'
import { describe, expect, it } from 'vitest'
import { startIfReady, startRender } from './start'

const JOB = '3f0c2f5e-8a51-4c0e-9d7b-0d0f5a3b9c11'

/** A queue that keeps what is sent. */
function recording() {
  const sent: RenderMessage[][] = []
  const queue: RenderQueue = { send: async (messages) => void sent.push(messages) }
  return { sent, queue }
}

describe('startRender', () => {
  it('sends one start message with retries 0 for a fresh job', async () => {
    const { sent, queue } = recording()
    await startRender(queue, { id: JOB, retries: 0 }, () => {})
    expect(sent).toEqual([[{ jobId: JOB, step: 'start', retries: 0 }]])
  })

  it("sends one start message carrying the job's retries, so a retry is never a duplicate of the first start", async () => {
    const { sent, queue } = recording()
    await startRender(queue, { id: JOB, retries: 3 }, () => {})
    expect(sent).toEqual([[{ jobId: JOB, step: 'start', retries: 3 }]])
    const [first] = sent[0] ?? []
    expect(first && messageKey(first)).toBe(`${JOB}:start:3`)
    expect(messageKey({ jobId: JOB, step: 'start', retries: 0 })).not.toBe(`${JOB}:start:3`)
  })

  it('swallows a failed send and logs the job id with the error name only', async () => {
    const lines: string[] = []
    const queue: RenderQueue = {
      send: () => Promise.reject(new TypeError('fetch failed https://queue.example/?token=abc')),
    }
    await expect(
      startRender(queue, { id: JOB, retries: 1 }, (line) => lines.push(line)),
    ).resolves.toBeUndefined()
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain(JOB)
    expect(lines[0]).toContain('TypeError')
    expect(lines[0]).not.toContain('https://')
    expect(lines[0]).not.toContain('token')
  })
})

describe('startIfReady', () => {
  it('starts a job the lock returned paid or waived with retries 0, and nothing else', async () => {
    for (const state of ['paid', 'waived']) {
      const ready = recording()
      await startIfReady(ready.queue, { id: JOB, state }, () => {})
      expect(ready.sent).toEqual([[{ jobId: JOB, step: 'start', retries: 0 }]])
    }
    for (const state of ['payment_due', 'locked', 'rendering', 'failed']) {
      const other = recording()
      await startIfReady(other.queue, { id: JOB, state }, () => {})
      expect(other.sent).toEqual([])
    }
  })

  it('returns normally when the send at lock fails, and logs the job id', async () => {
    const lines: string[] = []
    const queue: RenderQueue = { send: () => Promise.reject(new Error('queue down')) }
    await expect(
      startIfReady(queue, { id: JOB, state: 'paid' }, (line) => lines.push(line)),
    ).resolves.toBeUndefined()
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain(JOB)
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @cobweb/web exec vitest run src/lib/render/start.test.ts`
Expected: FAIL. The message carries `jobId: '[object Object]'` or a type error: `startRender` still takes a string.

- [ ] **Step 3: Carry the retry count in the start message**

Replace `apps/web/src/lib/render/start.ts` with:

```ts
import { enqueueRender, type RenderQueue } from '@cobweb/shared/render-queue'

/**
 * Sends a job's start message (docs/specs/2026-10-13-render-worker-vercel.md, section 7, and
 * 2026-10-14-render-screen-wiring.md, section 6) with the job's retry count: the message key is
 * `<jobId>:start:<retries>`, new for every retry, so a retry is never dropped as a duplicate of the first
 * start. A failed send is logged with the job id and the error's name and swallowed: the payment is
 * already recorded (or the retry already re-queued the batches), and the sweep starts the job within 15
 * minutes. The error's message is left out, because it can carry a URL with a token in it.
 */
export async function startRender(
  queue: RenderQueue,
  job: { id: string; retries: number },
  log: (line: string) => void = console.error,
): Promise<void> {
  try {
    await enqueueRender(queue, { id: job.id, retries: job.retries })
  } catch (error) {
    const name = error instanceof Error ? error.name : 'Unknown error'
    log(`The render of job ${job.id} was not queued (${name}); the sweep will start it.`)
  }
}

/**
 * Starts a job the lock returned already `paid` or `waived`: a lock that owes nothing (a single asset,
 * a placeholder, a collection whose fee is zero, or a lock covered by a credit) has no payment step to
 * send its start message. A lock is always a fresh job, so it starts at retries 0. Any other state sends
 * nothing; a `payment_due` job is started when its payment is recorded.
 */
export async function startIfReady(
  queue: RenderQueue,
  job: { id: string; state: string },
  log: (line: string) => void = console.error,
): Promise<void> {
  if (job.state === 'paid' || job.state === 'waived') await startRender(queue, { id: job.id, retries: 0 }, log)
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm --filter @cobweb/web exec vitest run src/lib/render/start.test.ts`
Expected: PASS, 5 tests (4 before).

- [ ] **Step 5: The retry core and the action**

In `apps/web/src/lib/art/lock-core.ts`:

1. In `confirmCore`, replace

```ts
  await startRender(ctx.queue, row.id)
```

with

```ts
  await startRender(ctx.queue, { id: row.id, retries: row.retries })
```

2. After `renderJobCore` (the end of the file), add:

```ts

/**
 * The creator's retry of a failed render (docs/specs/2026-10-14-render-screen-wiring.md, section 6):
 * `art_render_retry` under the creator's client (the function refuses the service role; it re-queues
 * the failed batches and raises `retries`), then the start message with the row's new retry count. A
 * failed send is logged and swallowed: the job is `rendering` with its batches queued, and the sweep
 * re-sends its start within 15 minutes.
 */
export async function retryCore(ctx: LockContext): Promise<LockOutcome<RenderJob>> {
  const { data, error } = await ctx.supabase.rpc('art_render_retry', { p_collection_id: ctx.collection.id })
  if (error) return { error }
  const row = data as unknown as Pick<JobRow, 'id' | 'retries'>
  await startRender(ctx.queue, { id: row.id, retries: row.retries })
  return { data: await loadJob(ctx.supabase, row.id) }
}
```

In `apps/web/src/app/actions/lock.ts`, add `retryCore,` to the import list from `@/lib/art/lock-core` (alphabetical, after `renderJobCore,`), and at the end of the file add:

```ts

/** Retries a failed render: re-queues the failed batches and sends the start message with the new retry count. */
export async function retryRender(collectionId: string): Promise<ActionResult<RenderJob>> {
  return lockWrite(collectionId, (ctx) => retryCore(ctx))
}
```

In `apps/web/src/components/upload/upload-shared.ts`, in `UploadActions`, after `reload(): Promise<ActionResult<RenderJob | null>>` add:

```ts
  /** Retries a failed render; the job comes back `rendering` (or `finalizing`), or the refusal's sentence. */
  retry(): Promise<ActionResult<RenderJob>>
```

In `apps/web/src/components/upload/upload-actions.ts`, add `retryRender,` to the import list from `@/app/actions/lock` (after `quoteArt,`), and after `reload: () => getRenderJob(collectionId),` add:

```ts
    retry: () => retryRender(collectionId),
```

In `apps/web/src/components/upload/upload-sim.ts`, in `sampleActions`, after `reload: async () => ({ ok: true, data: initial }),` add (Task 7 replaces it with the scripted run):

```ts
    retry: async () => ({ ok: true, data: initial }),
```

- [ ] **Step 6: Check the retry core in verify:render**

In `apps/web/scripts/verify-render.ts`, add `retryCore,` to the dynamic import of the cores (alphabetical: `..., lockPlaceholderCore, retryCore, reviewLock, unlockCore`), and directly after check 4's closing `)` (before `// 5. Determinism across projects.`) add:

```ts
  // 4b. The retry action's core: art_render_retry, then the start message with the new retry count.
  await check(
    '4b. retryCore on a failed job answers it rendering, queues one start with retries 1, and the runner finishes it',
    async () => {
      const cid = await seededProject(creator.client, 'four b')
      const jobId = await lockedAndPaid(creator, cid)
      const failing = local.failingPinner(local.folderPinner(pins), { nth: 1, times: Infinity })
      const run = await render(jobId, depsFor(local.memoryQueue(), failing))
      if (run.dead !== 1) return `run ${JSON.stringify(run)}`
      if ((await jobRow(jobId)).state !== 'failed') return 'the job did not fail'
      const queue = local.memoryQueue()
      const ctx = { ...(await contextFor(creator.client, creator.userId, creator.account.address, cid)), queue }
      const retried = await retryCore(ctx)
      if (!('data' in retried)) return `retry: ${refusal(retried)}`
      if (retried.data.state !== 'rendering') return `the retry answered ${retried.data.state}`
      const want = [{ jobId, step: 'start', retries: 1 }]
      if (JSON.stringify(queue.sent) !== JSON.stringify(want)) return `queued ${JSON.stringify(queue.sent)}`
      // The queue already holds the start message: the runner drains it with a pinner that works.
      const again = await local.runLocal(depsFor(queue, local.folderPinner(pins)))
      if (again.thrown || again.dead) return `the retry had failures: ${JSON.stringify(again)}`
      const problem = await doneProblem(jobId)
      if (problem) return problem
      return (await jobRow(jobId)).retries === 1 ? null : 'retries is not 1'
    },
  )
```

Run: `pnpm --filter @cobweb/web verify:render`
Expected: `21 passed, 0 failed`, `PASS 4b. ...` after `PASS 4. ...`. Then `pnpm --filter @cobweb/web verify:chain`: still `12 passed, 0 failed` (a fresh job's start carries `retries: 0`, which the pay check asserts).

- [ ] **Step 7: Format, run the root checks and commit**

```bash
pnpm exec prettier --write apps/web/src/lib/render/start.ts apps/web/src/lib/render/start.test.ts apps/web/src/lib/art/lock-core.ts apps/web/src/app/actions/lock.ts apps/web/src/components/upload/upload-shared.ts apps/web/src/components/upload/upload-actions.ts apps/web/src/components/upload/upload-sim.ts apps/web/scripts/verify-render.ts
pnpm typecheck && pnpm lint && pnpm test
git add apps/web/src/lib/render/start.ts apps/web/src/lib/render/start.test.ts apps/web/src/lib/art/lock-core.ts apps/web/src/app/actions/lock.ts apps/web/src/components/upload/upload-shared.ts apps/web/src/components/upload/upload-actions.ts apps/web/src/components/upload/upload-sim.ts apps/web/scripts/verify-render.ts
git commit -m "$(cat <<'EOF'
Add the retry action, which re-queues a failed render and sends its start message with the new retry count

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: the web package reports 308 tests.

---

### Task 4: The collage route

**Files:**

- Modify: `apps/web/src/lib/storage/config.ts` (`renderBucket`)
- Modify: `apps/web/src/lib/storage/objects.ts` (`presignGet` bucket option)
- Create: `apps/web/src/app/api/collections/[id]/collage/route.ts`
- Create: `apps/web/src/lib/storage/collage-route.test.ts`
- Modify: `apps/web/scripts/verify-render.ts` (the storage environment, check 1b)
- Test: `collage-route.test.ts`, `pnpm --filter @cobweb/web verify:render`

**Interfaces:**

- Consumes: `getSessionUser()` from `@/lib/auth`; `createClient()` from `@/lib/supabase/server`; `s3()` and `storageConfig()` from `@/lib/storage/config`; `render_jobs.collage_key`.
- Produces:
  - `renderBucket(): string` in `@/lib/storage/config` (throws `'Object storage is not configured: set RENDER_S3_BUCKET.'`)
  - `presignGet(key: string, expiresSeconds = 3600, options: { bucket?: string } = {}): Promise<string>`
  - `GET /api/collections/[id]/collage`: 404, or 302 to the presigned GET with `Cache-Control: private, max-age=3000`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/storage/collage-route.test.ts`:

```ts
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    maybeSingle: vi.fn<() => Promise<{ data: { collage_key: string | null } | null; error: null }>>(),
  }
  chain.select.mockReturnValue(chain)
  chain.eq.mockReturnValue(chain)
  chain.order.mockReturnValue(chain)
  chain.limit.mockReturnValue(chain)
  return {
    chain,
    user: null as { id: string; walletAddress: string } | null,
    getSessionUser: vi.fn(async () => mocks.user),
    presignGet: vi.fn<(key: string, expires: number, options: { bucket?: string }) => Promise<string>>(),
  }
})
vi.mock('@/lib/auth', () => ({ getSessionUser: mocks.getSessionUser }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ from: () => mocks.chain }) }))
vi.mock('@/lib/storage/config', () => ({ renderBucket: () => 'render' }))
vi.mock('@/lib/storage/objects', () => ({ presignGet: mocks.presignGet }))

import { GET } from '@/app/api/collections/[id]/collage/route'

const COLLECTION = '1f4a0f3e-2f5e-4e3a-9d1c-1b2c3d4e5f61'
const KEY = `${COLLECTION}/collage/0f4a0f3e-2f5e-4e3a-9d1c-1b2c3d4e5f60.png`
const get = (id: string) =>
  GET(new NextRequest(`https://cobweb.test/api/collections/${id}/collage`), { params: Promise.resolve({ id }) })

describe('GET /api/collections/[id]/collage', () => {
  beforeEach(() => {
    mocks.user = { id: 'u-1', walletAddress: '0xabc' }
    mocks.chain.maybeSingle.mockResolvedValue({ data: { collage_key: KEY }, error: null })
    mocks.getSessionUser.mockClear()
    mocks.chain.select.mockClear()
    mocks.chain.eq.mockClear()
    mocks.chain.order.mockClear()
    mocks.chain.limit.mockClear()
    mocks.presignGet.mockReset()
    mocks.presignGet.mockResolvedValue('https://storage.local/signed')
  })

  it('answers 404 for an id that is not a uuid, before any session check', async () => {
    expect((await get('nope')).status).toBe(404)
    expect(mocks.getSessionUser).not.toHaveBeenCalled()
  })

  it('answers 404 when signed out, without reading a job', async () => {
    mocks.user = null
    expect((await get(COLLECTION)).status).toBe(404)
    expect(mocks.chain.select).not.toHaveBeenCalled()
    expect(mocks.presignGet).not.toHaveBeenCalled()
  })

  it('answers 404 when the latest done job has no collage key, and when there is no done job', async () => {
    mocks.chain.maybeSingle.mockResolvedValue({ data: { collage_key: null }, error: null })
    expect((await get(COLLECTION)).status).toBe(404)
    mocks.chain.maybeSingle.mockResolvedValue({ data: null, error: null })
    expect((await get(COLLECTION)).status).toBe(404)
    expect(mocks.presignGet).not.toHaveBeenCalled()
  })

  it('redirects the owner to a presigned GET on the render bucket, good for an hour and cached privately', async () => {
    const response = await get(COLLECTION)
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://storage.local/signed')
    expect(response.headers.get('cache-control')).toBe('private, max-age=3000')
    expect(mocks.presignGet).toHaveBeenCalledWith(KEY, 3600, { bucket: 'render' })
    // The latest real job in state done, under the creator's client.
    expect(mocks.chain.select).toHaveBeenCalledWith('collage_key')
    expect(mocks.chain.eq).toHaveBeenCalledWith('collection_id', COLLECTION)
    expect(mocks.chain.eq).toHaveBeenCalledWith('kind', 'real')
    expect(mocks.chain.eq).toHaveBeenCalledWith('state', 'done')
    expect(mocks.chain.order).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(mocks.chain.limit).toHaveBeenCalledWith(1)
  })
})
```

- [ ] **Step 2: Run the test to see it fail**

Run: `pnpm --filter @cobweb/web exec vitest run src/lib/storage/collage-route.test.ts`
Expected: FAIL, the route module cannot be found.

- [ ] **Step 3: The render bucket and the presign option**

In `apps/web/src/lib/storage/config.ts`, after `storageConfig` add:

```ts
/**
 * The bucket the render worker writes preview collages to (`RENDER_S3_BUCKET`), behind the same endpoint
 * and credentials as the art bucket (services/worker/src/env.ts). Never the art bucket itself: the upload
 * sweep deletes what no upload row records there.
 */
export function renderBucket(): string {
  const bucket = process.env.RENDER_S3_BUCKET
  if (!bucket) throw new Error('Object storage is not configured: set RENDER_S3_BUCKET.')
  return bucket
}
```

In `apps/web/src/lib/storage/objects.ts`, replace `presignGet` with:

```ts
/** A GET URL for one object, valid an hour by default, on the art bucket unless another is named. */
export async function presignGet(
  key: string,
  expiresSeconds = 3600,
  options: { bucket?: string } = {},
): Promise<string> {
  const bucket = options.bucket ?? storageConfig().bucket
  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: expiresSeconds })
}
```

- [ ] **Step 4: The route**

Create `apps/web/src/app/api/collections/[id]/collage/route.ts`:

```ts
import { NextResponse, type NextRequest } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { renderBucket } from '@/lib/storage/config'
import { presignGet } from '@/lib/storage/objects'

/**
 * Serves a collection's preview collage (docs/specs/2026-10-14-render-screen-wiring.md, section 7), as
 * the uploads route serves a file: the session is checked (verified locally; row-level security does
 * the access control), the latest finished real job's collage key is read under the creator's client
 * (another creator's collection, a job without a collage and nothing finished are all a 404), and the
 * answer is a redirect to a signed URL on the render bucket, good for an hour.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse(null, { status: 404 })
  const user = await getSessionUser()
  if (!user) return new NextResponse(null, { status: 404 })
  const supabase = await createClient()
  const { data: row } = await supabase
    .from('render_jobs')
    .select('collage_key')
    .eq('collection_id', id)
    .eq('kind', 'real')
    .eq('state', 'done')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!row?.collage_key) return new NextResponse(null, { status: 404 })
  const url = await presignGet(row.collage_key, 3600, { bucket: renderBucket() })
  return NextResponse.redirect(url, { status: 302, headers: { 'Cache-Control': 'private, max-age=3000' } })
}
```

- [ ] **Step 5: Run the test to see it pass**

Run: `pnpm --filter @cobweb/web exec vitest run src/lib/storage/collage-route.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Check the presigned collage in verify:render**

In `apps/web/scripts/verify-render.ts`:

1. Directly after the line `const RENDER_BUCKET = config('RENDER_S3_BUCKET', [], 'render')`, add:

```ts
// The web app's storage module reads ART_S3_* and RENDER_S3_BUCKET from the environment (check 1b).
for (const [name, value] of Object.entries(storage)) process.env[name] ??= value
process.env.ART_S3_BUCKET ??= ART_BUCKET
process.env.RENDER_S3_BUCKET ??= RENDER_BUCKET
```

2. Directly after the line `const schemas = await import('../src/lib/art/schemas.ts')`, add:

```ts
const { presignGet } = await import('../src/lib/storage/objects.ts')
const { renderBucket } = await import('../src/lib/storage/config.ts')
```

3. Directly after check 1's closing `})` (before `// 2. Duplicate delivery.`), add:

```ts
  // 1b. The collage as the screen gets it: the web app's presigned GET on the render bucket.
  await check(
    '1b. presignGet on the render bucket answers a URL that fetches the collage with 200 and image/png',
    async () => {
      const key = `${firstCid}/collage/${firstJob}.png`
      const signed = await presignGet(key, 60, { bucket: renderBucket() })
      if (!isLocalUrl(signed)) return 'the signed URL is not local'
      const response = await fetch(signed)
      if (response.status !== 200) return `status ${response.status}`
      const type = response.headers.get('content-type')
      if (type !== 'image/png') return `content type ${type}`
      const bytes = new Uint8Array(await response.arrayBuffer())
      const got = await local.rgbaAt(bytes, 128, 128).catch((e: unknown) => String(e))
      if (typeof got === 'string') return `the served collage does not decode: ${got}`
      return got.width === 1024 && got.height === 256
        ? null
        : `the served collage is ${got.width} by ${got.height}`
    },
  )
```

Run: `pnpm --filter @cobweb/web verify:render`
Expected: `22 passed, 0 failed`, `PASS 1b. ...` after `PASS 1. ...`.

- [ ] **Step 7: Format, run the root checks and commit**

```bash
pnpm exec prettier --write apps/web/src/lib/storage/config.ts apps/web/src/lib/storage/objects.ts "apps/web/src/app/api/collections/[id]/collage/route.ts" apps/web/src/lib/storage/collage-route.test.ts apps/web/scripts/verify-render.ts
pnpm typecheck && pnpm lint && pnpm test
git add apps/web/src/lib/storage/config.ts apps/web/src/lib/storage/objects.ts "apps/web/src/app/api/collections/[id]/collage/route.ts" apps/web/src/lib/storage/collage-route.test.ts apps/web/scripts/verify-render.ts
git commit -m "$(cat <<'EOF'
Serve a collection's preview collage through a route that redirects the owner to a presigned GET on the render bucket

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: the web package reports 312 tests.

---

### Task 5: The follow module

**Files:**

- Create: `apps/web/src/components/upload/render-follow.ts`
- Create: `apps/web/src/components/upload/render-follow.test.ts`
- Modify: `apps/web/scripts/verify-render.ts` (check 9's model assertion)
- Test: `render-follow.test.ts`, `pnpm --filter @cobweb/web verify:render`

**Interfaces:**

- Consumes: `ART_PROBLEM_CODES` from `@cobweb/shared/render-queue`; `MAX_RENDER_RETRIES` from `@/lib/art/render-job` (Decision 1); `RenderJob`, `RenderJobState` from `@/lib/demo/types` (with `credited`, Task 2).
- Produces, from `./render-follow`: `RENDER_BATCH_SIZE`, `SECONDS_PER_BATCH`, `METADATA_SECONDS`, `POLL_FAST_MS`, `POLL_SLOW_MS`, `POLL_SLOW_AFTER_MS`, `follows(state)`, `pollInterval(state, elapsedMs)`, `FailureFace`, `RenderView`, `faceOf(job)`, `renderView(job, nowSeconds)`, exactly as spec section 8 declares them.

`render-sim.ts` still exists after this task (Task 8 deletes it); nothing imports `render-follow.ts` yet besides its test and verify-render.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/components/upload/render-follow.test.ts`:

```ts
import { ART_PROBLEM_CODES } from '@cobweb/shared/render-queue'
import { describe, expect, it } from 'vitest'
import { MAX_RENDER_RETRIES } from '@/lib/art/render-job'
import type { RenderJob, RenderJobBase, RenderJobState } from '@/lib/demo/types'
import {
  faceOf,
  follows,
  METADATA_SECONDS,
  POLL_FAST_MS,
  POLL_SLOW_AFTER_MS,
  POLL_SLOW_MS,
  pollInterval,
  RENDER_BATCH_SIZE,
  renderView,
  SECONDS_PER_BATCH,
} from './render-follow'

const base: RenderJobBase = {
  id: '0f4a0f3e-2f5e-4e3a-9d1c-1b2c3d4e5f60',
  jobId: `0x${'1'.repeat(64)}`,
  tokenCount: 250,
  lockedAt: 1_000,
  tokenListHash: `0x${'2'.repeat(64)}`,
  quote: {
    chainId: 31337,
    perTokenWei: '1',
    tokenCount: 250,
    totalWei: '250',
    payer: `0x${'3'.repeat(40)}`,
    expiresAt: 2_000,
    factory: null,
  },
  lockOptions: { allowDuplicates: false },
  placeholder: null,
  credited: false,
}
const batches = { total: 5, done: 2, size: 50 }
const STARTED = 10_000

type Failed = Extract<RenderJob, { state: 'failed' }>

const paid: RenderJob = { ...base, state: 'paid', payment: null, batches: { ...batches, done: 0 } }
const rendering = (done: number, failedBatch: number | null = null): RenderJob => ({
  ...base,
  state: 'rendering',
  payment: null,
  batches: { ...batches, done },
  startedAt: STARTED,
  failedBatch,
})
const finalizing: RenderJob = {
  ...base,
  state: 'finalizing',
  payment: null,
  batches: { ...batches, done: 5 },
  startedAt: STARTED,
}
const done: RenderJob = {
  ...base,
  state: 'done',
  payment: null,
  batches: { ...batches, done: 5 },
  startedAt: STARTED,
  finishedAt: STARTED + 600,
  metadataCid: `b${'m'.repeat(58)}`,
  baseUri: `ipfs://b${'m'.repeat(58)}/`,
  batchCids: [],
  placeholderImageCid: null,
  collageKey: null,
}
const failed = (fields: Partial<Failed> = {}): Failed => ({
  ...base,
  state: 'failed',
  payment: null,
  batches: { ...batches, done: 2 },
  error: 'The pinning service answered with a different CID.',
  errorCode: 'cid-mismatch',
  retries: 1,
  failedBatch: 3,
  retryable: true,
  ...fields,
})

describe('follows', () => {
  it('is true while the job is paid, waived, rendering or finalizing', () => {
    for (const state of ['paid', 'waived', 'rendering', 'finalizing'] as RenderJobState[])
      expect(follows(state)).toBe(true)
  })

  it('is false for every state that is not followed', () => {
    for (const state of ['locked', 'payment_due', 'done', 'failed'] as RenderJobState[])
      expect(follows(state)).toBe(false)
  })
})

describe('pollInterval', () => {
  it('is false for every state that is not followed, whatever the elapsed time', () => {
    for (const state of ['locked', 'payment_due', 'done', 'failed'] as RenderJobState[]) {
      expect(pollInterval(state, 0)).toBe(false)
      expect(pollInterval(state, POLL_SLOW_AFTER_MS)).toBe(false)
    }
  })

  it('polls every 3 seconds for the first two minutes', () => {
    expect(POLL_FAST_MS).toBe(3_000)
    expect(pollInterval('rendering', 0)).toBe(POLL_FAST_MS)
    expect(pollInterval('paid', POLL_SLOW_AFTER_MS - 1)).toBe(POLL_FAST_MS)
  })

  it('slows to 15 seconds from two minutes exactly', () => {
    expect(POLL_SLOW_MS).toBe(15_000)
    expect(POLL_SLOW_AFTER_MS).toBe(120_000)
    expect(pollInterval('rendering', POLL_SLOW_AFTER_MS)).toBe(POLL_SLOW_MS)
    expect(pollInterval('finalizing', 60 * 60 * 1000)).toBe(POLL_SLOW_MS)
  })
})

describe('faceOf', () => {
  it('answers support for a payment mismatch, and for an unlocked job', () => {
    expect(faceOf(failed({ errorCode: 'payment-mismatch', retryable: false }))).toBe('support')
    expect(faceOf(failed({ errorCode: 'unlocked', error: 'x', retryable: false }))).toBe('support')
    expect(faceOf(failed({ errorCode: null, error: 'unlocked', retryable: false }))).toBe('support')
  })

  it('answers art for every art problem code, whatever retryable says, and before retry or credit', () => {
    for (const code of ART_PROBLEM_CODES) {
      expect(faceOf(failed({ errorCode: code, retryable: true }))).toBe('art')
      expect(faceOf(failed({ errorCode: code, retryable: false, retries: MAX_RENDER_RETRIES }))).toBe('art')
    }
  })

  it('answers retry for a retryable worker failure, and credit once the retries are used up', () => {
    expect(faceOf(failed({ errorCode: 'cid-mismatch', retryable: true }))).toBe('retry')
    expect(faceOf(failed({ errorCode: 'dead-letter', retryable: true, retries: 4 }))).toBe('retry')
    expect(faceOf(failed({ errorCode: 'dead-letter', retryable: false, retries: 5 }))).toBe('credit')
    expect(faceOf(failed({ errorCode: null, retryable: false, retries: 5 }))).toBe('credit')
  })
})

describe('renderView', () => {
  it('shows a paid or waived job as queued, nothing done, with the rough estimate', () => {
    const view = renderView(paid, STARTED)
    expect(view).toEqual({
      phase: 'queued',
      total: 5,
      done: 0,
      size: 50,
      retryingBatch: null,
      timeLeftSeconds: 5 * SECONDS_PER_BATCH + METADATA_SECONDS,
      failure: null,
    })
    expect(renderView({ ...paid, state: 'waived' }, STARTED).phase).toBe('queued')
  })

  it('shows a rendering job in the images phase with the rough estimate before a batch is done', () => {
    const view = renderView(rendering(0), STARTED + 30)
    expect(view.phase).toBe('images')
    expect(view.done).toBe(0)
    expect(view.timeLeftSeconds).toBe(5 * SECONDS_PER_BATCH + METADATA_SECONDS)
  })

  it('estimates from the observed rate once a batch is done', () => {
    // Two batches in 300 seconds: 150 a batch, three left.
    const view = renderView(rendering(2), STARTED + 300)
    expect(view.timeLeftSeconds).toBe(3 * 150 + METADATA_SECONDS)
    // A clock behind the start reads as no time passed: nothing below the metadata estimate.
    expect(renderView(rendering(2), STARTED - 5).timeLeftSeconds).toBe(METADATA_SECONDS)
  })

  it("carries the batch the worker is retrying on its own, and never a failure, while rendering", () => {
    const view = renderView(rendering(2, 3), STARTED)
    expect(view.retryingBatch).toBe(3)
    expect(view.failure).toBeNull()
    expect(renderView(rendering(2), STARTED).retryingBatch).toBeNull()
  })

  it('shows finalizing as the metadata phase with the metadata estimate, and done as done with none', () => {
    expect(renderView(finalizing, STARTED)).toMatchObject({
      phase: 'metadata',
      done: 5,
      timeLeftSeconds: METADATA_SECONDS,
      failure: null,
    })
    expect(renderView(done, STARTED)).toMatchObject({ phase: 'done', done: 5, timeLeftSeconds: null })
  })

  it('shows a failed job with its face, sentence, code, batch and retries left, in the phase it stopped in', () => {
    const images = renderView(failed(), STARTED)
    expect(images).toEqual({
      phase: 'images',
      total: 5,
      done: 2,
      size: 50,
      retryingBatch: null,
      timeLeftSeconds: null,
      failure: {
        face: 'retry',
        sentence: 'The pinning service answered with a different CID.',
        code: 'cid-mismatch',
        failedBatch: 3,
        retriesLeft: MAX_RENDER_RETRIES - 1,
      },
    })
    const metadata = renderView(
      failed({ batches: { ...batches, done: 5 }, failedBatch: null, retries: 5, retryable: false }),
      STARTED,
    )
    expect(metadata.phase).toBe('metadata')
    expect(metadata.failure).toMatchObject({ face: 'credit', failedBatch: null, retriesLeft: 0 })
  })

  it('shows a job without batches (nothing locked, or locked and unpaid) as queued over the default batch size', () => {
    expect(RENDER_BATCH_SIZE).toBe(100)
    const pending: RenderJob = { ...base, state: 'locked' }
    expect(renderView(pending, STARTED)).toEqual({
      phase: 'queued',
      total: 3,
      done: 0,
      size: RENDER_BATCH_SIZE,
      retryingBatch: null,
      timeLeftSeconds: 3 * SECONDS_PER_BATCH + METADATA_SECONDS,
      failure: null,
    })
    const empty: RenderJob = { ...base, tokenCount: 0, state: 'payment_due', payment: null }
    expect(renderView(empty, STARTED).total).toBe(1)
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @cobweb/web exec vitest run src/components/upload/render-follow.test.ts`
Expected: FAIL, the module `./render-follow` cannot be found.

- [ ] **Step 3: Write the module**

Create `apps/web/src/components/upload/render-follow.ts`:

```ts
import { ART_PROBLEM_CODES } from '@cobweb/shared/render-queue'
import { MAX_RENDER_RETRIES } from '@/lib/art/render-job'
import type { RenderJob, RenderJobState } from '@/lib/demo/types'

/**
 * Following a render job (docs/specs/2026-10-14-render-screen-wiring.md, section 8): when the screen
 * polls and how often, which face a failed job shows, and the view the render step draws from a job.
 * Pure and browser-safe; the flow (upload-flow.tsx) polls, this decides.
 */

/** Tokens per render batch for a fresh job (`render_jobs.batch_size`). */
export const RENDER_BATCH_SIZE = 100
/** The rough time a batch takes, in seconds, before a rate is observed. */
export const SECONDS_PER_BATCH = 95
/** The rough time the metadata step takes, in seconds. */
export const METADATA_SECONDS = 60
export const POLL_FAST_MS = 3_000
export const POLL_SLOW_MS = 15_000
export const POLL_SLOW_AFTER_MS = 120_000

const FOLLOWED: readonly RenderJobState[] = ['paid', 'waived', 'rendering', 'finalizing']

/** Whether a job in this state is still moving on the server, so the screen polls it. */
export function follows(state: RenderJobState): boolean {
  return FOLLOWED.includes(state)
}

/** How long until the next poll: 3 seconds for the first two minutes of the render stage, then 15; false when not following. */
export function pollInterval(state: RenderJobState, elapsedMs: number): number | false {
  if (!follows(state)) return false
  return elapsedMs < POLL_SLOW_AFTER_MS ? POLL_FAST_MS : POLL_SLOW_MS
}

/**
 * The one action that fits a failed job: `art` (unlock and fix the art), `retry` (try again),
 * `credit` (no retries left; unlock and lock again on the credit), `support` (the payment is in doubt).
 */
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

type FailedJob = Extract<RenderJob, { state: 'failed' }>

const ART_CODES: readonly string[] = ART_PROBLEM_CODES

/** The face of a failed job, in order: the payment in doubt, an unlock, an art problem, a retry left, the credit. */
export function faceOf(job: FailedJob): FailureFace {
  if (job.errorCode === 'payment-mismatch') return 'support'
  // Never on the screen (the latest-job filter hides it); answered all the same.
  if (job.errorCode === 'unlocked' || job.error === 'unlocked') return 'support'
  // A retry fails the same way, whatever `retryable` says: the art has to change.
  if (job.errorCode !== null && ART_CODES.includes(job.errorCode)) return 'art'
  if (job.retryable) return 'retry'
  return 'credit'
}

/** The images phase's estimate: the observed seconds a batch once one is done, else the rough one. */
function imagesTimeLeft(total: number, done: number, startedAt: number, nowSeconds: number): number {
  const rate = done >= 1 ? Math.max(0, nowSeconds - startedAt) / done : SECONDS_PER_BATCH
  return Math.round((total - done) * rate + METADATA_SECONDS)
}

/** What the render step shows for a job, at `nowSeconds` (unix seconds, for the observed rate). */
export function renderView(job: RenderJob, nowSeconds: number): RenderView {
  if (!('batches' in job)) {
    // Nothing locked, or locked and unpaid: the batches are not known until the claim.
    const total = Math.max(1, Math.ceil(job.tokenCount / RENDER_BATCH_SIZE))
    return {
      phase: 'queued',
      total,
      done: 0,
      size: RENDER_BATCH_SIZE,
      retryingBatch: null,
      timeLeftSeconds: total * SECONDS_PER_BATCH + METADATA_SECONDS,
      failure: null,
    }
  }
  const { total, done, size } = job.batches
  const shared = { total, done, size, retryingBatch: null, failure: null }
  switch (job.state) {
    case 'paid':
    case 'waived':
      return { ...shared, phase: 'queued', done: 0, timeLeftSeconds: total * SECONDS_PER_BATCH + METADATA_SECONDS }
    case 'rendering':
      return {
        ...shared,
        phase: 'images',
        retryingBatch: job.failedBatch,
        timeLeftSeconds: imagesTimeLeft(total, done, job.startedAt, nowSeconds),
      }
    case 'finalizing':
      return { ...shared, phase: 'metadata', timeLeftSeconds: METADATA_SECONDS }
    case 'done':
      return { ...shared, phase: 'done', timeLeftSeconds: null }
    case 'failed':
      return {
        ...shared,
        phase: done < total ? 'images' : 'metadata',
        timeLeftSeconds: null,
        failure: {
          face: faceOf(job),
          sentence: job.error,
          code: job.errorCode,
          failedBatch: job.failedBatch,
          retriesLeft: Math.max(0, MAX_RENDER_RETRIES - job.retries),
        },
      }
  }
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm --filter @cobweb/web exec vitest run src/components/upload/render-follow.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Flip verify-render's known gap to the art face**

In `apps/web/scripts/verify-render.ts`, directly after the line `const { renderBucket } = await import('../src/lib/storage/config.ts')`, add:

```ts
const { faceOf } = await import('../src/components/upload/render-follow.ts')
```

and in check 9 replace

```ts
    // The web app's model of the job. The creator can fix this art only by unlocking it, so a retry
    // fails the same way; the model still calls the job retryable. A known gap, recorded for the
    // screen sub-project, which should offer the unlock first.
    const model = await loadJob(creator.client, jobId)
    if (model.state !== 'failed') return `the web model says ${model.state}`
    return model.errorCode === 'layer-size' && model.retryable
      ? null
      : `model ${JSON.stringify({ errorCode: model.errorCode, retryable: model.retryable })}`
```

with

```ts
    // The web app's model of the job. The creator can fix this art only by unlocking it, so a retry
    // fails the same way: the model still calls the job retryable (the database would accept a retry),
    // but the screen's face is `art`, which offers the unlock and never "Try again".
    const model = await loadJob(creator.client, jobId)
    if (model.state !== 'failed') return `the web model says ${model.state}`
    if (model.errorCode !== 'layer-size' || !model.retryable)
      return `model ${JSON.stringify({ errorCode: model.errorCode, retryable: model.retryable })}`
    return faceOf(model) === 'art' ? null : `face ${faceOf(model)}`
```

Run: `pnpm --filter @cobweb/web verify:render`
Expected: `22 passed, 0 failed`.

- [ ] **Step 6: Format, run the root checks and commit**

```bash
pnpm exec prettier --write apps/web/src/components/upload/render-follow.ts apps/web/src/components/upload/render-follow.test.ts apps/web/scripts/verify-render.ts
pnpm typecheck && pnpm lint && pnpm test
git add apps/web/src/components/upload/render-follow.ts apps/web/src/components/upload/render-follow.test.ts apps/web/scripts/verify-render.ts
git commit -m "$(cat <<'EOF'
Add the follow module: the poll interval, the face of a failed job and the view the render step draws

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: the web package reports 327 tests.

---

### Task 6: The render result and the done step

**Files:**

- Modify: `apps/web/src/components/upload/upload-shared.ts` (`RenderResult`, `resultOf`, `tokenPreview` removed)
- Modify: `apps/web/src/components/upload/upload-shared.test.ts`
- Modify: `apps/web/src/components/upload/review-step.tsx` (local `tokenPreview`)
- Modify: `apps/web/src/components/upload/done-step.tsx` (rewritten)
- Modify: `apps/web/src/components/upload/upload-flow.tsx` (the stand-in result on the new shape)
- Modify: `apps/web/src/components/upload/upload-screen.tsx` (the sample result through `resultOf`)
- Test: `upload-shared.test.ts`; typecheck, lint and build

**Interfaces:**

- Consumes: `RenderJob` (done branch), `RenderPlaceholder`; `Artwork`, `Collapsible`, `CollapsibleTrigger`, `CollapsibleContent`, `Button`, `CopyValue`, `MediaPreview`, `mediaLabel` (existing).
- Produces:
  - `RenderResult = { batchCids: string[]; metadataCid: string | null; baseUri: string | null; collageUrl: string | null; placeholder: RenderPlaceholder | null; placeholderUri?: string | null }`
  - `resultOf(job: Extract<RenderJob, { state: 'done' }>, options: { collageUrl: string | null }): RenderResult`
  - `DoneStep({ result, tokenCount })` unchanged in signature

The simulation still drives the render step after this task, so the flow keeps building a stand-in result for an unfinished job (Decision 5); Task 8 removes it.

- [ ] **Step 1: Write the failing tests**

Replace `apps/web/src/components/upload/upload-shared.test.ts` with:

```ts
import { describe, expect, it } from 'vitest'
import type { RenderJob } from '@/lib/demo/types'
import { resultOf } from './upload-shared'

type Done = Extract<RenderJob, { state: 'done' }>

const CID_A = `b${'a'.repeat(58)}`
const CID_B = `b${'b'.repeat(58)}`
const CID_C = `b${'c'.repeat(58)}`
const CID_M = `b${'m'.repeat(58)}`
const placeholder = { cid: CID_A, mediaType: 'image', imageUrl: '/p.png' }

/** Only the fields `resultOf` reads; the rest of a done job is irrelevant here. */
const done = (fields: Partial<Done>): Done =>
  ({
    state: 'done',
    metadataCid: CID_M,
    baseUri: `ipfs://${CID_M}/`,
    batchCids: [CID_B, CID_C],
    placeholderImageCid: null,
    placeholder: null,
    collageKey: 'c/collage/j.png',
    ...fields,
  }) as unknown as Done

describe('resultOf', () => {
  it('lists every batch CID with the metadata CID, the base URI and the collage URL for a real job', () => {
    expect(resultOf(done({}), { collageUrl: '/api/collections/c/collage' })).toEqual({
      batchCids: [CID_B, CID_C],
      metadataCid: CID_M,
      baseUri: `ipfs://${CID_M}/`,
      collageUrl: '/api/collections/c/collage',
      placeholder: null,
    })
  })

  it('carries no collage when none is given', () => {
    expect(resultOf(done({ collageKey: null }), { collageUrl: null }).collageUrl).toBeNull()
  })

  it("shows a finished placeholder job's base URI, not the image directory CID, and no collage", () => {
    const uri = `ipfs://${CID_M}/metadata.json`
    const result = resultOf(
      done({ baseUri: uri, placeholderImageCid: CID_A, batchCids: [CID_A], placeholder } as Partial<Done>),
      { collageUrl: '/demo/collage.svg' },
    )
    expect(result).toEqual({
      batchCids: [],
      metadataCid: null,
      baseUri: null,
      collageUrl: null,
      placeholder,
      placeholderUri: uri,
    })
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @cobweb/web exec vitest run src/components/upload/upload-shared.test.ts`
Expected: FAIL. `resultOf` answers `imagesCid` and ignores the options.

- [ ] **Step 3: The result shape**

In `apps/web/src/components/upload/upload-shared.ts`, replace everything from the `RenderResult` doc comment through the end of `tokenPreview` (that is, the `RenderResult` type, `resultOf`, `IPFS_GATEWAY` and `tokenPreview`; keep `formatDuration`) with:

```ts
/**
 * The IPFS result of a finished render, as the done step shows it (docs/specs/2026-10-14-render-screen-wiring.md,
 * section 10). The real set's CIDs are empty or null when the art is deferred and only the placeholder was
 * rendered; `placeholder` is null without "Reveal later"; `collageUrl` is where the preview collage is served
 * from, or null when the job has none.
 */
export type RenderResult = {
  /** Each batch directory's CID, in batch order. */
  batchCids: string[]
  metadataCid: string | null
  /** What the contract is given: `ipfs://<cid>/`. */
  baseUri: string | null
  collageUrl: string | null
  placeholder: RenderPlaceholder | null
  /**
   * The base URI a finished placeholder job gives the contract (`ipfs://<cid>/metadata.json`), which
   * the done step shows for the placeholder in place of the image directory CID.
   */
  placeholderUri?: string | null
}

/**
 * A finished job as the done step shows it. A placeholder job rendered no real set, shows the base URI
 * the contract is given, and has no collage whatever the caller passes.
 */
export function resultOf(
  job: Extract<RenderJob, { state: 'done' }>,
  options: { collageUrl: string | null },
): RenderResult {
  if (job.placeholderImageCid !== null)
    return {
      batchCids: [],
      metadataCid: null,
      baseUri: null,
      collageUrl: null,
      placeholder: job.placeholder,
      placeholderUri: job.baseUri,
    }
  return {
    batchCids: job.batchCids,
    metadataCid: job.metadataCid,
    baseUri: job.baseUri,
    collageUrl: options.collageUrl,
    placeholder: job.placeholder,
  }
}

/** A public gateway for the "open" links next to CIDs. */
export const IPFS_GATEWAY = 'https://ipfs.io/ipfs/'
```

In `apps/web/src/components/upload/review-step.tsx`, change the import `import { tokenPreview, type UploadActions } from './upload-shared'` to `import type { UploadActions } from './upload-shared'`, and after `const fmt = (value: number) => value.toLocaleString('en-US')` add:

```ts
/** The sample strip's preview for a token id. Only 24 sample images exist, so ids past 24 reuse them. */
const tokenPreview = (id: number) => `/demo/tokens/${((id - 1) % 24) + 1}.svg`
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm --filter @cobweb/web exec vitest run src/components/upload/upload-shared.test.ts`
Expected: PASS, 3 tests (2 before).

- [ ] **Step 5: Rewrite the done step**

Replace `apps/web/src/components/upload/done-step.tsx` with:

```tsx
'use client'

import { ChevronDownIcon } from 'lucide-react'
import { useState } from 'react'
import { Artwork } from '@cobweb/ui/components/artwork'
import { Button } from '@cobweb/ui/components/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@cobweb/ui/components/collapsible'
import { cn } from '@cobweb/ui/lib/utils'
import { CopyValue } from '@/components/deploy/copy-value'
import { mediaLabel } from '@/components/art/assets/media'
import { MediaPreview } from '@/components/art/assets/media-preview'
import { IPFS_GATEWAY, type RenderResult } from './upload-shared'

/** The gateway link for an `ipfs://` URI. */
const gatewayUrl = (uri: string) => `${IPFS_GATEWAY}${uri.replace(/^ipfs:\/\//, '')}`

const fmt = (value: number) => value.toLocaleString('en-US')

/**
 * Done: the preview collage, the pinned CIDs (the metadata, the base URI and every batch directory)
 * and a pointer to Deploy. Creators always see their CIDs: the real set and, with "Reveal later", the
 * placeholder (MASTER_PLAN, Flow: pre-reveal). With deferred art the real set is not rendered yet and
 * says so.
 */
export function DoneStep({ result, tokenCount }: { result: RenderResult; tokenCount: number }) {
  const { placeholder, metadataCid, baseUri } = result
  const rendered = metadataCid !== null && baseUri !== null
  const [batchesOpen, setBatchesOpen] = useState(false)
  const batchCount = result.batchCids.length

  return (
    <div className="divide-y">
      {result.collageUrl && (
        <figure className="space-y-3 p-6">
          <div className="mx-auto w-full max-w-sm">
            <Artwork
              src={result.collageUrl}
              alt="The first 16 tokens"
              seed="collage"
              className="border-border-strong rounded-lg border"
            />
          </div>
          <figcaption className="text-muted-foreground text-center text-[0.8125rem]">
            A preview of the first 16 tokens
          </figcaption>
        </figure>
      )}

      <dl className="divide-y px-6">
        {metadataCid !== null && baseUri !== null ? (
          <>
            <Row
              label="Metadata"
              help={
                placeholder
                  ? 'The real set: one file per token. The contract reveals to it from Settings.'
                  : 'One file per token. The contract starts here.'
              }
            >
              <CopyValue
                value={metadataCid}
                label="Metadata CID"
                href={`${IPFS_GATEWAY}${metadataCid}`}
                linkLabel="Open on an IPFS gateway"
              />
            </Row>
            <Row label="Base URI" help="What the contract is given: the metadata directory, with the token id appended.">
              <CopyValue value={baseUri} label="Base URI" />
            </Row>
            <Row label="Images" help={`${fmt(tokenCount)} final images, one directory per batch.`}>
              <Collapsible open={batchesOpen} onOpenChange={setBatchesOpen}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="-ml-2.5">
                    <ChevronDownIcon
                      aria-hidden="true"
                      className={cn('transition-transform', batchesOpen && 'rotate-180')}
                    />
                    <span className="numeric">{fmt(batchCount)}</span> {batchCount === 1 ? 'batch' : 'batches'}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <ol className="mt-2 space-y-1">
                    {result.batchCids.map((cid, index) => (
                      <li key={cid} className="grid gap-x-3 sm:grid-cols-[4.5rem_minmax(0,1fr)] sm:items-center">
                        <span className="text-muted-foreground text-[0.8125rem]">Batch {index + 1}</span>
                        <CopyValue
                          value={cid}
                          label={`Batch ${index + 1} CID`}
                          href={`${IPFS_GATEWAY}${cid}`}
                          linkLabel="Open on an IPFS gateway"
                        />
                      </li>
                    ))}
                  </ol>
                </CollapsibleContent>
              </Collapsible>
            </Row>
          </>
        ) : (
          <Row
            label="Real art"
            help="Lock the real art later from Art. It is rendered to its own CID, and you reveal to it from Settings."
          >
            <p className="text-sm">Not rendered yet</p>
          </Row>
        )}
        {placeholder && (
          <Row
            label="Placeholder"
            help={
              result.placeholderUri
                ? "The placeholder's metadata. Every token shows the placeholder until you reveal. The contract starts here."
                : `${mediaLabel(placeholder.mediaType)}. Every token shows it until you reveal.`
            }
          >
            <CopyValue
              value={result.placeholderUri ?? placeholder.cid}
              label={result.placeholderUri ? 'Placeholder base URI' : 'Placeholder CID'}
              href={result.placeholderUri ? gatewayUrl(result.placeholderUri) : `${IPFS_GATEWAY}${placeholder.cid}`}
              linkLabel="Open on an IPFS gateway"
            />
          </Row>
        )}
      </dl>

      {placeholder && (
        <div className="p-6">
          <div className="space-y-3 sm:w-40">
            <h4 className="text-sm font-medium">Placeholder</h4>
            <MediaPreview
              src={placeholder.imageUrl}
              mediaType={placeholder.mediaType}
              alt="The placeholder every token shows before the reveal"
              seed="placeholder"
              className="border-border-strong rounded-lg border"
              imageClassName="object-contain"
            />
          </div>
        </div>
      )}

      <p className="text-muted-foreground p-6 text-[0.8125rem] leading-snug">
        {!rendered
          ? 'The placeholder is stored on IPFS. Next, deploy the contract on it, then finish the art; the real set is locked and rendered later, and you reveal to it from Settings.'
          : placeholder
            ? 'Your art is stored on IPFS and cannot change. Next, deploy the contract: it starts on the placeholder and points at the metadata when you reveal.'
            : 'Your art is stored on IPFS and cannot change. Next, deploy the contract: it starts on the metadata, so every token shows its art from the first mint.'}
      </p>
    </div>
  )
}

/** One row of the CID list: a label, the value and a line of help. */
function Row({ label, help, children }: { label: string; help: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-x-6 gap-y-1 py-4 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-baseline">
      <dt className="text-sm font-medium">{label}</dt>
      <dd className="min-w-0 space-y-0.5">
        {children}
        <p className="text-muted-foreground text-[0.8125rem]">{help}</p>
      </dd>
    </div>
  )
}
```

- [ ] **Step 6: Keep the flow and the screen on the new shape**

In `apps/web/src/components/upload/upload-flow.tsx`, replace

```ts
  const result: RenderResult =
    job.state === 'done'
      ? resultOf(job)
      : {
          imagesCid: deferred ? null : sampleResult.imagesCid,
          metadataCid: deferred ? null : sampleResult.metadataCid,
          placeholder:
            placeholderOn && reveal.file
              ? {
                  cid: sampleResult.placeholder?.cid ?? '',
                  mediaType: reveal.file.mediaType,
                  imageUrl: reveal.file.url,
                }
              : null,
        }
```

with

```ts
  const result: RenderResult =
    job.state === 'done'
      ? resultOf(job, { collageUrl: null })
      : {
          batchCids: deferred ? [] : sampleResult.batchCids,
          metadataCid: deferred ? null : sampleResult.metadataCid,
          baseUri: deferred ? null : sampleResult.baseUri,
          collageUrl: deferred ? null : sampleResult.collageUrl,
          placeholder:
            placeholderOn && reveal.file
              ? {
                  cid: sampleResult.placeholder?.cid ?? '',
                  mediaType: reveal.file.mediaType,
                  imageUrl: reveal.file.url,
                }
              : null,
        }
```

In `apps/web/src/components/upload/upload-screen.tsx`:

1. Change `import { UploadFlow } from './upload-flow'` to the two lines:

```ts
import { UploadFlow } from './upload-flow'
import { resultOf } from './upload-shared'
```

2. Delete the line `  const { imagesCid, metadataCid, placeholder } = DEMO_RENDER_JOBS.done`.

3. Replace `      sampleResult={{ imagesCid, metadataCid, placeholder }}` with:

```tsx
      sampleResult={resultOf(DEMO_RENDER_JOBS.done, { collageUrl: '/demo/collage.svg' })}
```

- [ ] **Step 7: Typecheck, lint, build, format and commit**

```bash
pnpm exec prettier --write apps/web/src/components/upload/upload-shared.ts apps/web/src/components/upload/upload-shared.test.ts apps/web/src/components/upload/review-step.tsx apps/web/src/components/upload/done-step.tsx apps/web/src/components/upload/upload-flow.tsx apps/web/src/components/upload/upload-screen.tsx
pnpm typecheck && pnpm lint && pnpm test
pnpm --filter @cobweb/web build
git add apps/web/src/components/upload/upload-shared.ts apps/web/src/components/upload/upload-shared.test.ts apps/web/src/components/upload/review-step.tsx apps/web/src/components/upload/done-step.tsx apps/web/src/components/upload/upload-flow.tsx apps/web/src/components/upload/upload-screen.tsx
git commit -m "$(cat <<'EOF'
Show the collage, the metadata CID, the base URI and every batch CID on the done step

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: typecheck, lint and build pass (`grep -rn tokenPreview apps/web/src/components/upload/upload-shared.ts` prints nothing); the web package reports 328 tests.

---

### Task 7: Sample mode

**Files:**

- Modify: `apps/web/src/lib/demo/data.ts` (`SampleJobState`, the failed samples, the done sample's `collageKey`, `imagesCid` gone)
- Modify: `apps/web/src/lib/demo/data.test.ts`
- Modify: `apps/web/src/components/upload/upload-sim.ts` (rewritten: the outcomes, the scripted run)
- Create: `apps/web/src/components/upload/upload-sim.test.ts`
- Create: `apps/web/public/demo/collage.svg`
- Modify: `apps/web/src/components/upload/upload-screen.tsx` (the outcomes comment)
- Test: `data.test.ts`, `upload-sim.test.ts`

**Interfaces:**

- Consumes: `jobBase`, `RENDER_BATCH_SIZE` (from `./render-follow`, Task 5), `JOB_NOT_FAILED` from `@/lib/art/result`, `UploadActions` with `retry` (Task 3).
- Produces:
  - `SampleJobState` includes `'failed'`; `DEMO_RENDER_JOBS.failed` and `DEMO_DEFERRED_RENDER_JOBS.failed`
  - `UploadOutcome` includes `'art-problem'`; `UPLOAD_OUTCOMES` lists it
  - `sampleActions(initial: RenderJob, options?: { outcome?: UploadOutcome; done?: Extract<RenderJob, { state: 'done' }> }): UploadActions` (the flow passes the scenario's done sample; without one the run stays `finalizing`)
  - `SAMPLE_BATCHES_PER_RELOAD = 2`, `SAMPLE_BATCH_FAILURE`, `SAMPLE_ART_PROBLEM` (exported sentences)

The flow still calls `sampleActions(initialJob)` after this task; the `options` argument is given a default so it compiles, and Task 8 passes the outcome and the done sample.

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/lib/demo/data.test.ts`, replace the `describe('sample render jobs', ...)` block with:

```ts
describe('sample render jobs', () => {
  it('have a finalizing job with every batch in, in both scenarios', () => {
    for (const artDeferred of [false, true]) {
      const job = getRenderJob('finalizing', { artDeferred })
      expect(job.state).toBe('finalizing')
      if (job.state === 'finalizing') expect(job.batches.done).toBe(job.batches.total)
    }
  })

  it('mark the deferred run as the placeholder alone and the real run as the real set, with its collage', () => {
    expect(DEMO_DEFERRED_RENDER_JOBS.done.placeholderImageCid).not.toBeNull()
    expect(DEMO_DEFERRED_RENDER_JOBS.done.collageKey).toBeNull()
    expect(DEMO_RENDER_JOBS.done.placeholderImageCid).toBeNull()
    expect(DEMO_RENDER_JOBS.done.batchCids).toHaveLength(1)
    expect(DEMO_RENDER_JOBS.done.collageKey).not.toBeNull()
    expect(DEMO_RENDER_JOBS.done).not.toHaveProperty('imagesCid')
  })

  it("have a failed job stopped at batch 10 on the worker's sentence, retryable, in both scenarios", () => {
    expect(DEMO_RENDER_JOBS.failed).toMatchObject({
      state: 'failed',
      error: 'The pinning service answered with a different CID.',
      errorCode: 'cid-mismatch',
      failedBatch: 10,
      retries: 1,
      retryable: true,
      batches: { done: 9 },
    })
    expect(DEMO_DEFERRED_RENDER_JOBS.failed).toMatchObject({ state: 'failed', errorCode: 'cid-mismatch' })
    expect(getRenderJob('failed').state).toBe('failed')
  })
})
```

Create `apps/web/src/components/upload/upload-sim.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RenderJob, RenderJobBase } from '@/lib/demo/types'
import { SAMPLE_ART_PROBLEM, SAMPLE_BATCH_FAILURE, sampleActions, UPLOAD_OUTCOMES } from './upload-sim'

const base: RenderJobBase = {
  id: 'job-1',
  jobId: `0x${'1'.repeat(64)}`,
  tokenCount: 250,
  lockedAt: 1_000,
  tokenListHash: `0x${'2'.repeat(64)}`,
  quote: {
    chainId: 8453,
    perTokenWei: '1',
    tokenCount: 250,
    totalWei: '250',
    payer: `0x${'3'.repeat(40)}`,
    expiresAt: 2_000,
  },
  lockOptions: { allowDuplicates: false },
  placeholder: null,
  credited: false,
}
const payment = { txHash: `0x${'4'.repeat(64)}` as const, paidAt: 1_100, amountWei: '250' }
const paid: RenderJob = { ...base, state: 'paid', payment, batches: { total: 3, done: 0, size: 100 } }
const rendering: RenderJob = {
  ...base,
  state: 'rendering',
  payment,
  batches: { total: 16, done: 9, size: 50 },
  startedAt: 1_200,
  failedBatch: null,
}
const done: Extract<RenderJob, { state: 'done' }> = {
  ...base,
  state: 'done',
  payment,
  batches: { total: 3, done: 3, size: 100 },
  startedAt: 1_200,
  finishedAt: 1_900,
  metadataCid: `b${'m'.repeat(58)}`,
  baseUri: `ipfs://b${'m'.repeat(58)}/`,
  batchCids: [`b${'a'.repeat(58)}`],
  placeholderImageCid: null,
  collageKey: 'c/collage/j.png',
}

/** `reload` until the job is done or `limit` calls have been made; the states seen, in order. */
async function run(actions: ReturnType<typeof sampleActions>, limit = 20): Promise<RenderJob[]> {
  const seen: RenderJob[] = []
  for (let n = 0; n < limit; n++) {
    const result = await actions.reload()
    if (!result.ok || !result.data) throw new Error('reload failed')
    seen.push(result.data)
    if (result.data.state === 'done' || result.data.state === 'failed') break
  }
  return seen
}

const summary = (job: RenderJob) => ('batches' in job ? `${job.state}:${job.batches.done}` : job.state)

describe('sampleActions', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('lists the art problem among the outcomes', () => {
    expect(UPLOAD_OUTCOMES).toContain('art-problem')
    expect(UPLOAD_OUTCOMES).toContain('batch-failed')
  })

  it('steps a paid job to rendering, two batches a reload, then finalizing, then the done sample', async () => {
    const seen = await run(sampleActions(paid, { done }))
    expect(seen.map(summary)).toEqual(['rendering:0', 'rendering:2', 'rendering:3', 'finalizing:3', 'done:3'])
    const last = seen.at(-1)
    expect(last).toMatchObject({ state: 'done', metadataCid: done.metadataCid, lockedAt: base.lockedAt })
    // Once done, a reload answers the same job.
    const again = await sampleActions(paid, { done }).reload()
    expect(again.ok).toBe(true)
  })

  it('stops two batches after the start on the batch-failed outcome, and retry resumes with the outcome cleared', async () => {
    const actions = sampleActions(rendering, { outcome: 'batch-failed', done })
    const seen = await run(actions)
    expect(seen.map(summary)).toEqual(['failed:10'])
    expect(seen[0]).toMatchObject({
      error: SAMPLE_BATCH_FAILURE,
      errorCode: 'cid-mismatch',
      failedBatch: 11,
      retryable: true,
    })
    const retrying = actions.retry()
    await vi.runAllTimersAsync()
    const retried = await retrying
    expect(retried.ok && retried.data).toMatchObject({ state: 'rendering', failedBatch: null, batches: { done: 10 } })
    const rest = await run(actions)
    expect(rest.map(summary)).toEqual(['rendering:12', 'rendering:14', 'rendering:16', 'finalizing:16', 'done:16'])
  })

  it('stops on the layer problem with the art-problem outcome, and an unlock clears it for the next lock', async () => {
    const actions = sampleActions(paid, { outcome: 'art-problem', done })
    const seen = await run(actions)
    expect(seen.map(summary)).toEqual(['rendering:0', 'failed:1'])
    expect(seen[1]).toMatchObject({ error: SAMPLE_ART_PROBLEM, errorCode: 'layer-size', failedBatch: 2 })
    const unlocking = actions.unlock()
    await vi.runAllTimersAsync()
    expect((await unlocking).ok).toBe(true)
    const locking = actions.lock({ allowDuplicates: false, chainId: 8453 })
    await vi.runAllTimersAsync()
    const locked = await locking
    expect(locked.ok && locked.data.state).toBe('payment_due')
    const confirmed = await actions.confirm('job-1', `0x${'5'.repeat(64)}`)
    expect(confirmed.ok && confirmed.data.state).toBe('paid')
    const rest = await run(actions)
    expect(rest.map(summary)).toEqual(['rendering:0', 'rendering:2', 'rendering:3', 'finalizing:3', 'done:3'])
  })

  it('leaves a job that is not followed where it is', async () => {
    const locked: RenderJob = { ...base, state: 'locked' }
    const result = await sampleActions(locked, { done }).reload()
    expect(result.ok && result.data).toBe(locked)
    const retry = await sampleActions(locked, { done }).retry()
    expect(retry.ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @cobweb/web exec vitest run src/lib/demo/data.test.ts src/components/upload/upload-sim.test.ts`
Expected: FAIL. `DEMO_RENDER_JOBS.failed` is undefined, `collageKey` is null, `SAMPLE_ART_PROBLEM` is not exported and `reload` answers the initial job.

- [ ] **Step 3: The failed samples and the collage key**

In `apps/web/src/lib/demo/data.ts`:

1. Replace the `SampleJobState` type with:

```ts
/** The states the sample shows on Lock and upload (`?job=`). */
export type SampleJobState = Extract<
  RenderJobState,
  'locked' | 'payment_due' | 'rendering' | 'finalizing' | 'failed' | 'done'
>
```

2. Replace the `DEMO_RENDER_JOBS` declaration line and its type (the three lines from `export const DEMO_RENDER_JOBS: Omit<...` through `} = {`) with:

```ts
export const DEMO_RENDER_JOBS: RenderJobsByState = {
```

3. In `DEMO_RENDER_JOBS`, after the `finalizing` entry and before `done`, add:

```ts
  // The rendering sample stopped by the worker at batch 10: the retry face.
  failed: {
    ...jobBase,
    state: 'failed',
    placeholder: DEMO_PLACEHOLDER,
    payment,
    batches: { total: batchTotal, done: 9, size: BATCH_SIZE },
    error: 'The pinning service answered with a different CID.',
    errorCode: 'cid-mismatch',
    retries: 1,
    failedBatch: 10,
    retryable: true,
  },
```

4. In the `done` entry, delete the two lines

```ts
    // The upload screen's sample result reads this one images CID.
    imagesCid: SAMPLE_IMAGES_CID,
```

and replace `    collageKey: null,` (the one inside `DEMO_RENDER_JOBS.done`) with:

```ts
    // The sample done step shows the static collage at /demo/collage.svg; the key only says there is one.
    collageKey: 'night-owls/collage/job_night_owls_01.png',
```

5. In `DEMO_DEFERRED_RENDER_JOBS`, after the `finalizing` entry and before `done`, add:

```ts
  failed: {
    ...deferredBase,
    state: 'failed',
    placeholder: DEMO_PLACEHOLDER,
    payment: deferredPayment,
    batches: { total: 1, done: 0, size: 1 },
    error: 'The pinning service answered with a different CID.',
    errorCode: 'cid-mismatch',
    retries: 1,
    failedBatch: 1,
    retryable: true,
  },
```

The deferred `done` keeps `collageKey: null`. If `RenderPlaceholder` is no longer referenced in the file after step 2, remove it from the `import type` list (it is still used by `DEMO_PLACEHOLDER`, so it stays).

- [ ] **Step 4: Rewrite the sample actions**

Replace `apps/web/src/components/upload/upload-sim.ts` with:

```ts
/**
 * Sample mode only (`NEXT_PUBLIC_DEMO_DATA=1`): the Lock and upload actions simulated in client
 * state, so every state can be reviewed without a wallet, a chain or a database, as the Art screens
 * do. Real mode uses `realActions` (upload-actions.ts) and pays through wagmi (pay-machine.ts).
 *
 * The render is a scripted job stepped through the same `reload` the real screen polls
 * (docs/specs/2026-10-14-render-screen-wiring.md, section 11): paid to rendering, two batches a call,
 * then finalizing, then the done sample. Failures are driven by `?outcome=` on the first attempt only,
 * so every failure state can be reviewed and the way out then works: `check-failed` gives the sample
 * set two identical tokens for the duplicates check; `batch-failed` stops the run two batches after its
 * start on a worker failure the creator retries; `art-problem` stops it on a layer problem the creator
 * unlocks to fix.
 */
import type { TxFailure, TxPhase } from '@/components/deploy/tx-progress'
import { jobBase } from '@/lib/art/render-job'
import { JOB_NOT_FAILED } from '@/lib/art/result'
import { sampleTxHash } from '@/lib/demo/helpers'
import type { Hex, RenderJob } from '@/lib/demo/types'
import { RENDER_BATCH_SIZE } from './render-follow'
import type { UploadActions } from './upload-shared'

export type UploadOutcome =
  | 'rejected'
  | 'reverted'
  | 'balance'
  | 'check-failed'
  | 'batch-failed'
  | 'art-problem'

export const UPLOAD_OUTCOMES: UploadOutcome[] = [
  'rejected',
  'reverted',
  'balance',
  'check-failed',
  'batch-failed',
  'art-problem',
]

/** The creator's choices under "Lock options", stored with the job (`RenderJob['lockOptions']`). */
export type LockOptions = {
  /** Accept identical trait combinations; the server honours it when it validates the list at lock. */
  allowDuplicates: boolean
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(signal.reason)
      },
      { once: true },
    )
  })
}

const DAY = 24 * 60 * 60
const nowSeconds = () => Math.floor(Date.now() / 1000)

/** How many batches each `reload` moves a rendering sample job on by. */
export const SAMPLE_BATCHES_PER_RELOAD = 2
/** The worker's sentence the `batch-failed` outcome stops on. */
export const SAMPLE_BATCH_FAILURE = 'The pinning service answered with a different CID.'
/** The render problem the `art-problem` outcome stops on. */
export const SAMPLE_ART_PROBLEM =
  'The image for trait "Moon" in layer "Sky" is 2047 by 2048; every layer image must be 2048 by 2048.'

type DoneJob = Extract<RenderJob, { state: 'done' }>
type Rendering = Extract<RenderJob, { state: 'rendering' }>
type WithBatches = Extract<RenderJob, { state: 'paid' | 'waived' | 'rendering' | 'finalizing' | 'failed' }>

/**
 * The screen's actions in sample mode: they wait like the real ones and write nothing. `reload` steps
 * the scripted render from wherever the job is; `done` is the job the run ends on (the screen passes
 * the scenario's done sample, which keeps the run's own lock, quote, payment and batch counts).
 */
export function sampleActions(
  initial: RenderJob,
  options: { outcome?: UploadOutcome; done?: DoneJob } = {},
): UploadActions {
  const base = jobBase(initial)
  const batches = {
    total: Math.max(1, Math.ceil(base.tokenCount / RENDER_BATCH_SIZE)),
    done: 0,
    size: RENDER_BATCH_SIZE,
  }
  let current: RenderJob = initial
  // The render outcome fires once: a retry or an unlock clears it.
  let outcome = options.outcome
  // How many batches were done when the run started, for the stop two batches later.
  let startDone: number | null = null

  const paid = (txHash: Hex | null): RenderJob => ({
    ...base,
    state: 'paid',
    payment: txHash ? { txHash, paidAt: nowSeconds(), amountWei: base.quote.totalWei } : null,
    batches,
  })

  const rendering = (from: WithBatches, done: number): Rendering => ({
    ...jobBase(from),
    state: 'rendering',
    payment: from.payment,
    batches: { ...from.batches, done },
    startedAt: 'startedAt' in from ? from.startedAt : nowSeconds(),
    failedBatch: null,
  })

  const failed = (from: Rendering, done: number, kind: 'batch-failed' | 'art-problem'): RenderJob => ({
    ...jobBase(from),
    state: 'failed',
    payment: from.payment,
    batches: { ...from.batches, done },
    error: kind === 'batch-failed' ? SAMPLE_BATCH_FAILURE : SAMPLE_ART_PROBLEM,
    errorCode: kind === 'batch-failed' ? 'cid-mismatch' : 'layer-size',
    retries: 0,
    failedBatch: done + 1,
    retryable: true,
  })

  const finished = (from: Rendering, done: DoneJob): RenderJob => ({
    ...done,
    ...jobBase(from),
    payment: from.payment,
    batches: { ...from.batches, done: from.batches.total },
    startedAt: from.startedAt,
    finishedAt: nowSeconds(),
  })

  /** One poll: the next scripted state of the job, or the same job when nothing follows it. */
  function step(job: RenderJob): RenderJob {
    if (job.state === 'paid' || job.state === 'waived') {
      startDone ??= 0
      return rendering(job, 0)
    }
    if (job.state === 'rendering') {
      startDone ??= job.batches.done
      const { total, done } = job.batches
      if (done >= total)
        return { ...jobBase(job), state: 'finalizing', payment: job.payment, batches: job.batches, startedAt: job.startedAt }
      const stopAt = Math.min(startDone + SAMPLE_BATCHES_PER_RELOAD, total)
      const next = Math.min(done + SAMPLE_BATCHES_PER_RELOAD, total)
      if ((outcome === 'batch-failed' || outcome === 'art-problem') && next >= stopAt)
        return failed(job, stopAt - 1, outcome)
      return { ...job, batches: { ...job.batches, done: next } }
    }
    if (job.state === 'finalizing') return options.done ? finished(rendering(job, job.batches.total), options.done) : job
    return job
  }

  return {
    lock: async () => {
      await sleep(1200)
      current = {
        ...base,
        lockedAt: nowSeconds(),
        quote: { ...base.quote, expiresAt: nowSeconds() + DAY },
        state: 'payment_due',
        payment: null,
      }
      return { ok: true, data: current }
    },
    unlock: async () => {
      await sleep(600)
      outcome = undefined
      startDone = null
      current = { ...base, state: 'locked' }
      return { ok: true, data: null }
    },
    requote: async () => {
      current = {
        ...base,
        quote: { ...base.quote, expiresAt: nowSeconds() + DAY },
        state: 'payment_due',
        payment: null,
      }
      return { ok: true, data: current }
    },
    confirm: async (_jobId, txHash) => {
      current = paid(txHash)
      return { ok: true, data: current }
    },
    reload: async () => {
      current = step(current)
      return { ok: true, data: current }
    },
    retry: async () => {
      await sleep(600)
      if (current.state !== 'failed') return { ok: false, error: JOB_NOT_FAILED }
      outcome = undefined
      startDone = null
      current = rendering(current, current.batches.done)
      return { ok: true, data: current }
    },
    lockPlaceholder: async () => {
      await sleep(1200)
      current = { ...paid(null), lockedAt: nowSeconds() }
      return { ok: true, data: current }
    },
    uploadPlaceholder: null,
    removePlaceholder: async () => ({ ok: true, data: undefined }),
  }
}

const FAILURES: Record<
  'rejected' | 'reverted' | 'balance',
  { at: 'simulating' | 'wallet'; failure: TxFailure }
> = {
  rejected: {
    at: 'wallet',
    failure: {
      kind: 'rejected',
      title: 'Payment cancelled in your wallet',
      message: 'Nothing was sent and nothing was charged. Try again when you are ready.',
    },
  },
  reverted: {
    at: 'simulating',
    failure: {
      kind: 'reverted',
      title: 'The payment would fail',
      message:
        'The check against the factory reverted with JobAlreadyPaid: this wallet has a payment for this job already. Refresh the page; if the job still asks for payment, contact support.',
    },
  },
  balance: {
    at: 'simulating',
    failure: {
      kind: 'balance',
      title: 'Not enough funds in this wallet',
      message:
        'The fee and network gas are more than this wallet holds on the network. Add funds, then try again.',
    },
  },
}

/** Sample mode's payment: simulate, the wallet, the receipt and the server's check, with pauses. */
export async function payArtFee(
  onPhase: (phase: TxPhase) => void,
  options: { outcome?: UploadOutcome; signal: AbortSignal },
): Promise<Hex | null> {
  const { signal, outcome } = options
  const failure = outcome && outcome in FAILURES ? FAILURES[outcome as keyof typeof FAILURES] : null

  onPhase({ step: 'simulating' })
  await sleep(900, signal)
  if (failure?.at === 'simulating') {
    onPhase({ step: 'failed', ...failure })
    return null
  }

  onPhase({ step: 'wallet' })
  await sleep(1600, signal)
  if (failure?.at === 'wallet') {
    onPhase({ step: 'failed', ...failure })
    return null
  }

  const txHash = sampleTxHash(Math.floor(Date.now() / 1000) % 100_000)
  onPhase({ step: 'confirming', txHash })
  await sleep(1800, signal)
  onPhase({ step: 'verifying', txHash })
  await sleep(2000, signal)
  onPhase({ step: 'success', txHash })
  return txHash
}
```

In `apps/web/src/components/upload/upload-screen.tsx`, replace the `sampleOutcome` doc comment's second line

```ts
   * can be reviewed. rejected | reverted | balance | check-failed | batch-failed.
```

with

```ts
   * can be reviewed. rejected | reverted | balance | check-failed | batch-failed | art-problem.
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `pnpm --filter @cobweb/web exec vitest run src/lib/demo/data.test.ts src/components/upload/upload-sim.test.ts`
Expected: PASS. `data.test.ts` 12 tests (11 before), `upload-sim.test.ts` 5 tests.

- [ ] **Step 6: Build the sample collage**

From the repo root:

```bash
node -e '
const fs = require("fs")
const tiles = Array.from({ length: 16 }, (_, k) => {
  const svg = fs.readFileSync(`apps/web/public/demo/tokens/${k + 1}.svg`, "utf8")
  const href = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`
  const x = (k % 4) * 256
  const y = Math.floor(k / 4) * 256
  return `  <image href="${href}" x="${x}" y="${y}" width="256" height="256"/>`
})
const out = [
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">`,
  `  <title>A preview of the first 16 tokens</title>`,
  ...tiles,
  `</svg>`,
  ``,
].join("\n")
fs.writeFileSync("apps/web/public/demo/collage.svg", out)
'
grep -c '<image ' apps/web/public/demo/collage.svg
```

Expected: `16`, and the file is about 120 KB (`ls -la apps/web/public/demo/collage.svg`). A browser shows four rows of four owls when it opens the file directly. Each tile sits in a 256 by 256 cell, the same grid the worker's collage uses (4 columns of 256 pixel cells); the tiles are embedded as data URIs because an SVG shown through `<img>` cannot load external files (Decision 6).

- [ ] **Step 7: Format, run the root checks and commit**

```bash
pnpm exec prettier --write apps/web/src/lib/demo/data.ts apps/web/src/lib/demo/data.test.ts apps/web/src/components/upload/upload-sim.ts apps/web/src/components/upload/upload-sim.test.ts apps/web/src/components/upload/upload-screen.tsx
pnpm typecheck && pnpm lint && pnpm test
git add apps/web/src/lib/demo/data.ts apps/web/src/lib/demo/data.test.ts apps/web/src/components/upload/upload-sim.ts apps/web/src/components/upload/upload-sim.test.ts apps/web/src/components/upload/upload-screen.tsx apps/web/public/demo/collage.svg
git commit -m "$(cat <<'EOF'
Script the sample render through reload, with a failed sample, the art problem outcome and a sample collage

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: the web package reports 334 tests (328 before, 6 added).

---

### Task 8: The flow polls the job and the render step shows the four faces

**Files:**

- Modify: `apps/web/src/components/upload/upload-flow.tsx` (rewritten)
- Modify: `apps/web/src/components/upload/render-step.tsx` (rewritten)
- Delete: `apps/web/src/components/upload/render-sim.ts`
- Modify: `apps/web/src/components/upload/upload-screen.tsx` (`sampleDone` in place of `sampleResult`)
- Modify: `apps/web/src/app/collections/[id]/upload/page.tsx` (`?job=failed`, the doc comment)
- Test: typecheck, lint and build; the manual checks in sample mode listed in Step 5

**Interfaces:**

- Consumes: `useQuery` from `@tanstack/react-query` (provided by `components/providers.tsx`); `follows`, `pollInterval`, `renderView`, `RenderView`, `SECONDS_PER_BATCH`, `FailureFace` (Task 5); `resultOf`, `RenderResult`, `formatDuration`, `UploadActions.retry` (Tasks 3 and 6); `sampleActions(initial, { outcome, done })` (Task 7); `THROWN` from `@/lib/art/result`; `getRenderJob as sampleRenderJob` from `@/lib/demo`.
- Produces:
  - `UploadFlowProps.sampleDone: Extract<RenderJob, { state: 'done' }> | null` (replaces `sampleResult`)
  - `RenderStep(props: { view: RenderView; readOnly: boolean; placeholder?: boolean; placeholderOnly?: boolean; busy: boolean; actionError: string | null; connectionLost: boolean; onRetry: () => void; onUnlock: () => void })`

- [ ] **Step 1: Rewrite the flow**

Replace `apps/web/src/components/upload/upload-flow.tsx` with:

```tsx
'use client'

import { useQuery } from '@tanstack/react-query'
import { ExternalLinkIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { StatusBadge } from '@cobweb/ui/components/status-badge'
import { ChainName } from '@/components/chains/chain-icon'
import { StageFooter } from '@/components/shell/stage-footer'
import type { ReviewData } from '@/lib/art/lock-review'
import { THROWN } from '@/lib/art/result'
import { chainView } from '@/lib/chain/chain-view'
import { explorerTxUrl, formatNative, formatUtc, shortAddress } from '@/lib/demo/helpers'
import type { RenderJob } from '@/lib/demo/types'
import type { FlowLink } from '@/lib/steps'
import { DoneStep } from './done-step'
import { PayStep } from './pay-step'
import { Dot, ProgressionItem, type ProgressionState } from './progression'
import { follows, pollInterval, renderView } from './render-follow'
import { RenderStep } from './render-step'
import type { RevealLaterState } from './reveal-later'
import { ReviewStep } from './review-step'
import { realActions } from './upload-actions'
import { resultOf } from './upload-shared'
import { sampleActions, type LockOptions, type UploadOutcome } from './upload-sim'

type Stage = 'review' | 'pay' | 'render' | 'done'

const ORDER: Stage[] = ['review', 'pay', 'render', 'done']

const STAGE_FOR_JOB: Record<RenderJob['state'], Stage> = {
  locked: 'review',
  payment_due: 'pay',
  paid: 'render',
  waived: 'render',
  rendering: 'render',
  finalizing: 'render',
  failed: 'render',
  done: 'done',
}

/** The static collage sample mode shows on the done step. */
const SAMPLE_COLLAGE = '/demo/collage.svg'

export type UploadFlowProps = {
  collectionId: string
  /** `collections.chain_id`: the quote is on it when set, otherwise on the chain the wallet is on at lock. */
  collectionChainId: number | null
  job: RenderJob
  /** The job to fall back to after an unlock: nothing locked yet. */
  pending: RenderJob
  review: ReviewData
  sample: boolean
  /** Sample mode: the done job the scripted render ends on. Null in real mode. */
  sampleDone: Extract<RenderJob, { state: 'done' }> | null
  /** The description saved with the job's placeholder, when it has one. */
  placeholderDescription: string
  /** "Finish the art later" (MASTER_PLAN, Flow: pre-reveal): this run locks and renders the placeholder alone. */
  deferred: boolean
  /** A 1/1 or single asset project (no Generate step). */
  assetsFlow: boolean
  readOnly: boolean
  previous?: FlowLink
  next?: FlowLink
  outcome?: UploadOutcome
}

function revealFrom(job: RenderJob, deferred: boolean, description: string): RevealLaterState {
  const placeholder = job.placeholder
  const extension =
    placeholder?.mediaType === 'video' ? 'mp4' : placeholder?.mediaType === 'gif' ? 'gif' : 'png'
  return {
    on: deferred || placeholder !== null,
    forced: deferred,
    file: placeholder
      ? {
          url: placeholder.imageUrl,
          fileName: `placeholder.${extension}`,
          mediaType: placeholder.mediaType,
          bytes: null,
          owned: false,
          ...(placeholder.uploadId ? { uploadId: placeholder.uploadId } : {}),
        }
      : null,
    description: placeholder ? description : '',
  }
}

/**
 * The four states of Lock and upload as one vertical progression. The job from the server sets where
 * it starts; review, lock, pay, unlock and retry run through `realActions` (sample mode:
 * `sampleActions`). While a job renders the flow polls `reload` through React Query
 * (docs/specs/2026-10-14-render-screen-wiring.md, section 9), 3 seconds apart for two minutes and 15
 * after, and settles each job it gets; the stage always comes from the job.
 */
export function UploadFlow({
  collectionId,
  collectionChainId,
  job: initialJob,
  pending,
  review,
  sample,
  sampleDone,
  placeholderDescription,
  deferred,
  assetsFlow,
  readOnly,
  previous,
  next,
  outcome,
}: UploadFlowProps) {
  const router = useRouter()
  const actions = useMemo(
    () =>
      sample && sampleDone
        ? sampleActions(initialJob, { outcome, done: sampleDone })
        : realActions(collectionId),
    [sample, sampleDone, initialJob, outcome, collectionId],
  )
  const [job, setJob] = useState(initialJob)
  const [stage, setStage] = useState<Stage>(STAGE_FOR_JOB[initialJob.state])
  // The stage as a ref too, so settle can tell a change from an unchanged poll inside an effect.
  const stageRef = useRef(stage)
  // When the render stage was entered (or the last retry made), for the poll's slow-down after two minutes.
  const since = useRef(Date.now())
  // "Reveal later": forced on for deferred art, and on whenever the job already has a placeholder.
  const [reveal, setReveal] = useState<RevealLaterState>(() =>
    revealFrom(initialJob, deferred, placeholderDescription),
  )
  const placeholderOn = reveal.on && reveal.file !== null
  const [lockOptions, setLockOptions] = useState<LockOptions>(initialJob.lockOptions)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  // Sample mode: an unlock after a failed render shows the review's credit line, as the server would.
  const [creditAfterUnlock, setCreditAfterUnlock] = useState(false)
  const chain = chainView(job.quote.chainId)
  const paymentTx = 'payment' in job ? (job.payment?.txHash ?? null) : null
  const free = job.quote.totalWei === '0'
  const view = renderView(job, Math.floor(Date.now() / 1000))
  const collageUrl =
    job.state === 'done' && job.collageKey
      ? sample
        ? SAMPLE_COLLAGE
        : `/api/collections/${collectionId}/collage`
      : null
  const result = job.state === 'done' ? resultOf(job, { collageUrl }) : null
  const total = formatNative(job.quote.totalWei, chain.nativeSymbol, 8)
  const current = ORDER.indexOf(stage)
  const stateOf = (item: Stage): ProgressionState => {
    const index = ORDER.indexOf(item)
    return index < current ? 'done' : index === current ? 'current' : 'pending'
  }
  // The last state shows its body while it is the current one, and stays open once done.
  const doneState: ProgressionState = stage === 'done' ? 'current' : 'pending'

  /**
   * A job from the server: show the step its state belongs to. The server page (the stepper, the Art
   * screens) is refreshed when the stage changes or the job ends, never on an ordinary poll.
   */
  function settle(nextJob: RenderJob) {
    const nextStage = STAGE_FOR_JOB[nextJob.state]
    const changed = nextStage !== stageRef.current
    if (changed && nextStage === 'render') since.current = Date.now()
    stageRef.current = nextStage
    setJob(nextJob)
    setStage(nextStage)
    if (!sample && (changed || nextJob.state === 'done' || nextJob.state === 'failed')) router.refresh()
  }

  function unlocked() {
    stageRef.current = 'review'
    setJob(pending)
    setStage('review')
    setActionError(null)
    if (!sample) router.refresh()
  }

  const poll = useQuery({
    queryKey: ['render-job', collectionId],
    queryFn: async () => {
      const answer = await actions.reload()
      if (!answer.ok) throw new Error(answer.error)
      return answer.data
    },
    enabled: follows(job.state),
    refetchInterval: () => pollInterval(job.state, Date.now() - since.current),
    staleTime: 0,
    // The interval is the retry, and a job cached from an earlier mount must not settle over this one.
    retry: false,
    gcTime: 0,
  })
  const polled = poll.data
  // React Query keeps an unchanged job the same reference, so an unchanged poll settles nothing.
  useEffect(() => {
    if (polled) settle(polled)
  }, [polled])

  async function retry() {
    setBusy(true)
    setActionError(null)
    try {
      const answer = await actions.retry()
      if (answer.ok) {
        since.current = Date.now()
        settle(answer.data)
      } else {
        setActionError(answer.error)
      }
    } catch {
      setActionError(THROWN)
    } finally {
      setBusy(false)
    }
  }

  async function unlockFailed() {
    setBusy(true)
    setActionError(null)
    try {
      const answer = await actions.unlock()
      if (answer.ok) {
        if (sample) setCreditAfterUnlock(true)
        unlocked()
      } else {
        setActionError(answer.error)
      }
    } catch {
      setActionError(THROWN)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <ol aria-label="Lock and upload progress" className="pb-10">
        <ProgressionItem
          index={1}
          title="Review and lock"
          state={stateOf('review')}
          receipt={
            <>
              {deferred ? 'Placeholder locked' : 'Locked'}{' '}
              <span className="numeric">{formatUtc(job.lockedAt)}</span>
              <Dot />
              {deferred ? (
                'Real art later, from Art'
              ) : (
                <>
                  Token list hash{' '}
                  <span className="numeric" title={job.tokenListHash}>
                    {shortAddress(job.tokenListHash, 6)}
                  </span>
                </>
              )}
              {!deferred && (
                <>
                  <Dot />
                  {placeholderOn ? 'Reveal later' : 'Reveal at mint'}
                </>
              )}
              {!deferred && lockOptions.allowDuplicates && (
                <>
                  <Dot />
                  Identical tokens allowed
                </>
              )}
            </>
          }
        >
          <ReviewStep
            review={sample && creditAfterUnlock ? { ...review, credit: true } : review}
            previews={sample}
            readOnly={readOnly}
            previous={previous}
            deferred={deferred}
            reveal={reveal}
            onReveal={setReveal}
            lockOptions={lockOptions}
            onLockOptions={setLockOptions}
            actions={actions}
            collectionChainId={collectionChainId}
            sample={sample}
            assetsFlow={assetsFlow}
            onLocked={settle}
          />
        </ProgressionItem>

        <ProgressionItem
          index={2}
          title={deferred ? 'Placeholder fee' : 'Pay the generation fee'}
          state={stateOf('pay')}
          status={<StatusBadge status="draft">Payment due</StatusBadge>}
          receipt={
            job.credited ? (
              'No fee: covered by the credit from the render that failed'
            ) : free ? (
              deferred ? (
                'No fee for the placeholder'
              ) : (
                'No fee'
              )
            ) : (
              <>
                Paid <span className="numeric text-foreground/85">{total}</span> on{' '}
                <ChainName chain={chain} iconClassName="size-3.5" />
                {paymentTx && chain.explorerUrl && (
                  <>
                    <Dot />
                    <a
                      href={explorerTxUrl(chain, paymentTx)}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:text-foreground inline-flex items-center gap-1 underline-offset-4 hover:underline"
                    >
                      <span className="numeric">{shortAddress(paymentTx, 6)}</span>
                      <ExternalLinkIcon aria-hidden="true" className="size-3" />
                      <span className="sr-only">View payment on the explorer (new tab)</span>
                    </a>
                  </>
                )}
              </>
            )
          }
        >
          <PayStep
            job={job}
            chain={chain}
            readOnly={readOnly}
            sample={sample}
            outcome={outcome}
            actions={actions}
            onPaid={settle}
            onUnlocked={unlocked}
            onRequoted={setJob}
          />
        </ProgressionItem>

        <ProgressionItem
          index={3}
          title={deferred ? 'Render the placeholder' : 'Render and upload'}
          state={stateOf('render')}
          status={<StatusBadge status="pending">Rendering</StatusBadge>}
          receipt={
            deferred ? (
              'Placeholder pinned to IPFS'
            ) : (
              <>
                <span className="numeric">{job.tokenCount.toLocaleString('en-US')}</span> images and metadata
                pinned to IPFS
                <Dot />
                <span className="numeric">{view.total}</span> batches
                {placeholderOn && (
                  <>
                    <Dot />
                    Placeholder pinned
                  </>
                )}
              </>
            )
          }
        >
          <RenderStep
            view={view}
            readOnly={readOnly}
            placeholder={placeholderOn}
            placeholderOnly={deferred}
            busy={busy}
            actionError={actionError}
            connectionLost={poll.isError}
            onRetry={retry}
            onUnlock={unlockFailed}
          />
        </ProgressionItem>

        <ProgressionItem
          index={4}
          title="Ready to deploy"
          state={doneState}
          status={<StatusBadge status="done">Uploaded</StatusBadge>}
          last
        >
          {result && <DoneStep result={result} tokenCount={job.tokenCount} />}
        </ProgressionItem>
      </ol>

      <StageFooter previous={previous} next={stage === 'done' ? next : undefined}>
        {stage !== 'done' && (
          <p className="text-muted-foreground text-sm">Deploy opens once the upload finishes.</p>
        )}
      </StageFooter>
    </div>
  )
}
```

- [ ] **Step 2: Rewrite the render step**

Replace `apps/web/src/components/upload/render-step.tsx` with:

```tsx
'use client'

import { CheckIcon, InfoIcon, LockOpenIcon, RotateCwIcon, XIcon } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@cobweb/ui/components/alert'
import { Button } from '@cobweb/ui/components/button'
import { Progress } from '@cobweb/ui/components/progress'
import { Spinner } from '@cobweb/ui/components/spinner'
import { cn } from '@cobweb/ui/lib/utils'
import type { FailureFace, RenderView } from './render-follow'
import { formatDuration } from './upload-shared'

const CONNECTION_LOST = 'Cobweb cannot reach the server; still trying.'

/** What the failure alert says under the worker's sentence, by face, and the one button that fits. */
function faceCopy(face: FailureFace, retriesLeft: number): { advice: string; button: string } | null {
  switch (face) {
    case 'art':
      return {
        advice:
          'Unlock the art, fix it on the Art screens and lock again. The credit from this render makes the next lock free.',
        button: 'Unlock and fix the art',
      }
    case 'retry':
      return {
        advice: `The finished batches are kept; a retry renders only the rest. ${retriesLeft} ${
          retriesLeft === 1 ? 'retry' : 'retries'
        } left.`,
        button: 'Try again',
      }
    case 'credit':
      return {
        advice:
          'No retries are left. Unlock and lock again: the credit from this render makes the next lock free.',
        button: 'Unlock and lock again',
      }
    case 'support':
      return null
  }
}

function failureTitle(failure: NonNullable<RenderView['failure']>): string {
  if (failure.face === 'art') return 'The art needs a fix'
  if (failure.face === 'support') return 'The payment could not be verified'
  return failure.failedBatch !== null ? `Batch ${failure.failedBatch} did not render` : 'The render stopped'
}

/**
 * Rendering (docs/specs/2026-10-14-render-screen-wiring.md, section 9.2): coarse progress only, batches
 * done of total, then the metadata upload, drawn from the view the flow derives from the polled job.
 * A batch the worker retries on its own is an informational note; a failed job shows the worker's
 * sentence and one of four faces: fix the art, try again, unlock on the credit, or tell support. With
 * "Reveal later" the placeholder is its own small phase, pinned first; with deferred art it is the only one.
 */
export function RenderStep({
  view,
  readOnly,
  placeholder = false,
  placeholderOnly = false,
  busy,
  actionError,
  connectionLost,
  onRetry,
  onUnlock,
}: {
  view: RenderView
  readOnly: boolean
  /** "Reveal later" is on: show the placeholder's own phase. */
  placeholder?: boolean
  /** Deferred art: this run renders the placeholder alone. */
  placeholderOnly?: boolean
  /** A retry or an unlock is in flight. */
  busy: boolean
  /** The sentence the last retry or unlock was refused with, or null. */
  actionError: string | null
  /** The last poll failed; the next one is still scheduled. */
  connectionLost: boolean
  onRetry: () => void
  onUnlock: () => void
}) {
  const { failure } = view
  const imagesDone = view.phase === 'metadata' || view.phase === 'done'
  const copy = failure ? faceCopy(failure.face, failure.retriesLeft) : null
  const onAction = failure?.face === 'retry' ? onRetry : onUnlock
  // The placeholder is one file, pinned before the first batch of the real set finishes.
  const placeholderState = view.phase === 'done' || view.done > 0 ? 'done' : 'running'
  const placeholderRow = (
    <PhaseRow
      label="Placeholder"
      state={placeholderOnly ? (view.phase === 'done' ? 'done' : failure ? 'failed' : 'running') : placeholderState}
      detail={
        (placeholderOnly ? view.phase === 'done' : placeholderState === 'done')
          ? 'Done. Pinned to its own CID'
          : 'Pinning the one placeholder file'
      }
    />
  )

  const failureAlert = failure && (
    <Alert variant="destructive">
      <XIcon aria-hidden="true" />
      <AlertTitle>{failureTitle(failure)}</AlertTitle>
      <AlertDescription>
        <p>{failure.sentence}</p>
        {copy && !readOnly && (
          <>
            <p>{copy.advice}</p>
            <Button onClick={onAction} disabled={busy} className="mt-1">
              {busy ? <Spinner /> : failure.face === 'retry' ? <RotateCwIcon /> : <LockOpenIcon />}
              {copy.button}
            </Button>
            {actionError && <p className="text-destructive-foreground">{actionError}</p>}
          </>
        )}
      </AlertDescription>
    </Alert>
  )

  if (placeholderOnly) {
    return (
      <div className="divide-y">
        <div className="space-y-4 p-6">
          <ol className="grid gap-3 sm:grid-cols-2">{placeholderRow}</ol>
          {failureAlert}
          {connectionLost && <p className="text-muted-foreground text-[0.8125rem]">{CONNECTION_LOST}</p>}
          <p className="text-muted-foreground text-[0.8125rem] leading-snug">
            Only the placeholder is rendered in this run. The real set is rendered when you lock it from Art.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="divide-y">
      <div className="space-y-5 p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <p className="flex items-baseline gap-2">
            <span className="numeric text-[2rem] leading-none font-medium tracking-tight">{view.done}</span>
            <span className="numeric text-muted-foreground text-sm">of {view.total} batches done</span>
          </p>
          <p className="text-muted-foreground text-[0.8125rem]" aria-live="polite">
            {failure ? (
              failure.failedBatch !== null ? (
                <>Stopped at batch {failure.failedBatch}</>
              ) : (
                'Stopped'
              )
            ) : view.phase === 'queued' ? (
              'Waiting for a render worker'
            ) : imagesDone ? (
              'Images finished'
            ) : (
              <>
                In batches of <span className="numeric">{view.size}</span> tokens
              </>
            )}
          </p>
        </div>
        {connectionLost && <p className="text-muted-foreground text-[0.8125rem]">{CONNECTION_LOST}</p>}
        <Progress
          size="lg"
          value={imagesDone ? 100 : (view.done / view.total) * 100}
          aria-label="Batches rendered"
          aria-valuetext={`${view.done} of ${view.total} batches`}
        />

        <ol className={cn('grid gap-3', placeholder ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
          {placeholder && placeholderRow}
          <PhaseRow
            label="Render images"
            state={
              failure && view.phase === 'images' ? 'failed' : imagesDone ? 'done' : 'running'
            }
            detail={
              view.phase === 'queued' ? (
                'Waiting for a render worker'
              ) : (
                <>
                  <span className="numeric">{view.done}</span> of <span className="numeric">{view.total}</span>{' '}
                  batches
                </>
              )
            }
          />
          <PhaseRow
            label="Upload metadata to IPFS"
            state={
              view.phase === 'done'
                ? 'done'
                : view.phase === 'metadata'
                  ? failure
                    ? 'failed'
                    : 'running'
                  : 'waiting'
            }
            detail={
              view.phase === 'done'
                ? 'Done'
                : view.phase === 'metadata'
                  ? 'Writing and pinning the metadata'
                  : 'After the images'
            }
          />
        </ol>

        {view.retryingBatch !== null && !failure && (
          <Alert>
            <InfoIcon aria-hidden="true" />
            <AlertTitle>Batch {view.retryingBatch} did not render</AlertTitle>
            <AlertDescription>
              <p>The worker retries it on its own; the finished batches are kept.</p>
            </AlertDescription>
          </Alert>
        )}

        {failureAlert}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 p-6">
        <div className="text-muted-foreground max-w-lg space-y-1 text-[0.8125rem] leading-snug">
          {view.timeLeftSeconds !== null && (
            <p className="text-foreground/90">Time left: {formatDuration(view.timeLeftSeconds)}, a rough estimate.</p>
          )}
          <p className="flex items-start gap-2">
            <InfoIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            You can leave this page. Rendering runs on Cobweb&apos;s servers and this page shows the latest
            progress when you come back.
          </p>
        </div>
      </div>
    </div>
  )
}

function PhaseRow({
  label,
  state,
  detail,
}: {
  label: string
  state: 'waiting' | 'running' | 'done' | 'failed'
  detail: React.ReactNode
}) {
  return (
    <li className="bg-surface-2/50 flex items-start gap-3 rounded-lg border px-4 py-3">
      <span
        aria-hidden="true"
        className={cn(
          'mt-px flex size-5 shrink-0 items-center justify-center rounded-full',
          state === 'done' && 'bg-success-soft text-success-foreground',
          state === 'failed' && 'bg-destructive-soft text-destructive-foreground',
          state === 'running' && 'text-primary',
          state === 'waiting' && 'ring-border-strong ring-1 ring-inset',
        )}
      >
        {state === 'done' && <CheckIcon className="size-3" strokeWidth={3} />}
        {state === 'failed' && <XIcon className="size-3" strokeWidth={3} />}
        {state === 'running' && <Spinner className="size-4" />}
      </span>
      <span className="min-w-0">
        <span className={cn('block text-sm font-medium', state === 'waiting' && 'text-muted-foreground')}>
          {label}
          <span className="sr-only">, {state}</span>
        </span>
        <span className="text-muted-foreground block text-[0.8125rem]">{detail}</span>
      </span>
    </li>
  )
}
```

`LockOpenIcon` is exported by the installed `lucide-react` (checked in `lucide-react.d.ts`).

- [ ] **Step 3: Delete the simulation and pass the done sample**

```bash
git rm apps/web/src/components/upload/render-sim.ts
```

In `apps/web/src/components/upload/upload-screen.tsx`:

1. Replace the two import lines

```ts
import { UploadFlow } from './upload-flow'
import { resultOf } from './upload-shared'
```

with

```ts
import { UploadFlow } from './upload-flow'
```

2. In the `@/lib/demo` import list, delete `  DEMO_RENDER_JOBS,` and add `  getRenderJob as sampleRenderJob,` (keeping the list alphabetical: after `DEMO_TOKENS,` and before `type GeneratedToken,`).

3. `sampleRenderJob('done', ...)` is typed `RenderJob`, and the prop wants the done branch, so narrow it with a guard. Directly after the `const outcome = ...` line in `UploadScreen`, add:

```ts
  const sampleDone = sample ? sampleRenderJob('done', { artDeferred }) : null
  if (sampleDone && sampleDone.state !== 'done') throw new Error('The sample done job is not done.')
```

and replace

```tsx
      sampleResult={resultOf(DEMO_RENDER_JOBS.done, { collageUrl: '/demo/collage.svg' })}
```

with

```tsx
      sampleDone={sampleDone}
```

(The thrown guard narrows `sampleDone` to `Extract<RenderJob, { state: 'done' }> | null`, the prop's type.)

4. Replace the doc comment above `UploadScreen` with:

```ts
/**
 * Lock and upload: review and lock the art, pay the generation fee through the factory's
 * `payForArt(jobId)` (simulate first, then send), then follow the render in batches as the worker
 * finishes them. Server part: in sample mode it works out the sample's review and picks the done sample
 * here, so the client bundle does not carry the sample art.
 */
```

In `apps/web/src/app/collections/[id]/upload/page.tsx`:

1. Replace the `SAMPLE_STATES` line with:

```ts
const SAMPLE_STATES: SampleJobState[] = ['locked', 'payment_due', 'rendering', 'finalizing', 'failed', 'done']
```

2. Replace the doc comment above `UploadPage` with:

```ts
/**
 * Stage 3, Lock and upload (docs/specs/2026-10-09-lock-and-pay.md, section 8, and
 * 2026-10-14-render-screen-wiring.md). Review, lock, pay, unlock and retry are real, and the screen
 * polls the render job as the worker moves it. Sample mode only (`NEXT_PUBLIC_DEMO_DATA=1`):
 * `?job=locked|payment_due|rendering|finalizing|failed|done` picks the state,
 * `?outcome=rejected|reverted|balance|check-failed|batch-failed|art-problem` makes the first attempt
 * fail, and `?art=deferred` shows the deferred-art scenario (the placeholder run, MASTER_PLAN, Flow: pre-reveal).
 */
```

- [ ] **Step 4: Typecheck, lint and build**

```bash
pnpm typecheck && pnpm lint && pnpm test
pnpm --filter @cobweb/web build
git grep -n "render-sim\|RenderProgress\|followRender\|retryBatch\|sampleResult" -- apps/web/src
```

Expected: every command passes and the `git grep` prints nothing.

- [ ] **Step 5: The manual checks in sample mode**

These need a browser. Whoever has one (the controller runs the browser walk in Task 10; an implementer with a browser runs them here) sets `NEXT_PUBLIC_DEMO_DATA=1` in `apps/web/.env.local`, runs `pnpm --filter @cobweb/web dev`, signs in with the dev wallet, opens a collection's Lock and upload page and checks, then sets the variable back to `0`:

1. `?job=rendering`: the render step opens at "9 of 16 batches done", the counter rises by two every 3 seconds, the metadata row runs at 16, then the done step opens with the collage, the Metadata CID, the Base URI and "1 batch" under Images. No request to a server action is made (the network tab shows none).
2. `?job=failed`: the retry face: "Batch 10 did not render", the sentence "The pinning service answered with a different CID.", "The finished batches are kept; a retry renders only the rest. 4 retries left." and the button "Try again"; after it the run resumes at 10 and reaches done.
3. `?job=payment_due&outcome=batch-failed`: after the sample payment the run stops at "1 of 8 batches done" with "Batch 2 did not render" and "Try again"; the retry resumes and reaches done.
4. `?job=payment_due&outcome=art-problem`: the run stops with "The art needs a fix", the layer sentence and "Unlock and fix the art"; after it the review opens with "Locking is final: the credit pays the fee at once." and the lock dialog reads "The render that failed left a credit, so this lock is free and the render starts at once."; locking, paying and the run then reach done.
5. `?job=done`: the done step with the collage and the rows; `?job=done&art=deferred`: no collage, the Real art row "Not rendered yet", the placeholder rows.

An implementer without a browser writes "manual checks not run" in the task report; Task 10's walk covers them.

- [ ] **Step 6: Format and commit**

```bash
pnpm exec prettier --write apps/web/src/components/upload/upload-flow.tsx apps/web/src/components/upload/render-step.tsx apps/web/src/components/upload/upload-screen.tsx "apps/web/src/app/collections/[id]/upload/page.tsx"
pnpm typecheck && pnpm lint && pnpm test
git add apps/web/src/components/upload/upload-flow.tsx apps/web/src/components/upload/render-step.tsx apps/web/src/components/upload/upload-screen.tsx "apps/web/src/app/collections/[id]/upload/page.tsx"
git commit -m "$(cat <<'EOF'
Poll the render job through React Query, show a failed job with its one fitting action, and delete the render simulation

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: the web package still reports 334 tests; `apps/web/src/components/upload/render-sim.ts` is gone from the tree.

---

### Task 9: The local render runner and the shared dependency module

**Files:**

- Create: `apps/web/scripts/render-deps.ts`
- Create: `apps/web/scripts/render-local.ts`
- Modify: `apps/web/scripts/verify-render.ts` (the settings and `depsFor` onto the module)
- Modify: `apps/web/package.json` (the `render:local` script)
- Modify: `CLAUDE.md` (the command)
- Test: `pnpm --filter @cobweb/web verify:render` (22 checks, unchanged behaviour), a smoke run of `render:local`

**Interfaces:**

- Consumes: `isLocalUrl` from `@cobweb/shared`; `artS3Options`, `consoleLog`, `s3Store`, `supabaseJobs`, `viemChain`, types `Chain`, `Deps`, `Log`, `Pinner` from `@cobweb/worker`; `memoryQueue`, `folderPinner`, `runLocal`, type `MemoryQueue` from `@cobweb/worker/local`; `enqueueRender` from `@cobweb/shared`.
- Produces, from `apps/web/scripts/render-deps.ts`:
  - `localConfig(): LocalConfig` with `LocalConfig = { url; publishableKey; serviceKey; storage: StorageEnv; artBucket; renderBucket; rpc; factory: Address }`
  - `adminClient(settings): LocalClient`, `storageClient(settings): S3Client`, `clientOptions`
  - `localDeps(settings, parts: { admin; s3; queue: MemoryQueue; pinner: Pinner; chain?: Chain; log?: Log }): LocalDeps` with `LocalDeps = Deps & { queue: MemoryQueue }`
  - `supabaseStatus()`, `config(envName, statusNames, fallback?)`, `loadChainEnv()`, `repoRoot`

- [ ] **Step 1: Write the shared module**

Create `apps/web/scripts/render-deps.ts`:

```ts
// The local render dependencies that verify:render and render:local share
// (docs/specs/2026-10-14-render-screen-wiring.md, section 12), so the two cannot drift: the local
// Supabase, storage and Anvil settings (from the environment, `supabase status -o env` and
// apps/web/.env.local), the refusal of any endpoint that is not local, the service and storage clients,
// and the worker's ports on the production adapters for the database, storage and the chain, around a
// pinner and a queue the caller picks. Never prints a key.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { S3Client } from '@aws-sdk/client-s3'
import { isLocalUrl } from '@cobweb/shared'
import { artS3Options, consoleLog, s3Store, supabaseJobs, viemChain } from '@cobweb/worker'
import type { Chain, Deps, Log, Pinner } from '@cobweb/worker'
import type { MemoryQueue } from '@cobweb/worker/local'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getAddress, type Address } from 'viem'
import type { Database } from '../src/lib/database.types.ts'

const here = dirname(fileURLToPath(import.meta.url))
export const repoRoot = resolve(here, '../../..')

/** Reads RPC_URL_31337 and FACTORY_ADDRESS_31337 from apps/web/.env.local when the environment does not set them. */
export function loadChainEnv(): void {
  const envFile = resolve(here, '../.env.local')
  if (!existsSync(envFile)) return
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const [, name, value] = line.match(/^(RPC_URL_31337|FACTORY_ADDRESS_31337)=(.*)$/) ?? []
    if (name && value && process.env[name] === undefined) process.env[name] = value.trim()
  }
}

let statusCache: Record<string, string> | null = null

/** `supabase status -o env` from the repo root, read once. */
export function supabaseStatus(): Record<string, string> {
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

/** A setting from the environment, else from the local status under one of `statusNames`, else `fallback`. */
export function config(envName: string, statusNames: string[], fallback?: string): string {
  const fromEnv = process.env[envName]
  if (fromEnv) return fromEnv
  const status = supabaseStatus()
  for (const name of statusNames) if (status[name]) return status[name]
  if (fallback !== undefined) return fallback
  throw new Error(`${envName} is unset and \`supabase status\` did not report ${statusNames.join(' or ')}`)
}

export type StorageEnv = Record<
  | 'ART_S3_ENDPOINT'
  | 'ART_S3_REGION'
  | 'ART_S3_ACCESS_KEY_ID'
  | 'ART_S3_SECRET_ACCESS_KEY'
  | 'ART_S3_FORCE_PATH_STYLE',
  string
>

export type LocalConfig = {
  url: string
  publishableKey: string
  serviceKey: string
  storage: StorageEnv
  artBucket: string
  renderBucket: string
  rpc: string
  factory: Address
}

/**
 * Every local setting, or an explanation on stderr and exit code 2. Refuses any endpoint that is not
 * local. Also fills the environment the web app's storage module and the worker's chain adapter read
 * (ART_S3_*, RENDER_S3_BUCKET, RPC_URL_31337, FACTORY_ADDRESS_31337) when it is not set already.
 */
export function localConfig(): LocalConfig {
  loadChainEnv()
  const url = config('NEXT_PUBLIC_SUPABASE_URL', ['API_URL'])
  const publishableKey = config('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', ['PUBLISHABLE_KEY', 'ANON_KEY'])
  const serviceKey = config('SUPABASE_SERVICE_ROLE_KEY', ['SERVICE_ROLE_KEY', 'SECRET_KEY'])
  const storage: StorageEnv = {
    ART_S3_ENDPOINT: config('ART_S3_ENDPOINT', ['STORAGE_S3_URL']),
    ART_S3_REGION: config('ART_S3_REGION', ['S3_PROTOCOL_REGION'], 'local'),
    ART_S3_ACCESS_KEY_ID: config('ART_S3_ACCESS_KEY_ID', ['S3_PROTOCOL_ACCESS_KEY_ID']),
    ART_S3_SECRET_ACCESS_KEY: config('ART_S3_SECRET_ACCESS_KEY', ['S3_PROTOCOL_ACCESS_KEY_SECRET']),
    ART_S3_FORCE_PATH_STYLE: '1',
  }
  const artBucket = config('ART_S3_BUCKET', [], 'art')
  const renderBucket = config('RENDER_S3_BUCKET', [], 'render')
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
      // The host only: a hosted RPC URL carries its key in the path.
      let host = 'an unreadable address'
      try {
        host = new URL(endpoint).host
      } catch {
        // Keep the placeholder.
      }
      console.error(`Refusing to run: ${host} is not local (expected localhost or 127.0.0.1).`)
      process.exit(2)
    }
  for (const [name, value] of Object.entries(storage)) process.env[name] ??= value
  process.env.ART_S3_BUCKET ??= artBucket
  process.env.RENDER_S3_BUCKET ??= renderBucket
  return { url, publishableKey, serviceKey, storage, artBucket, renderBucket, rpc, factory: getAddress(factoryEnv) }
}

export type LocalClient = SupabaseClient<Database>
export const clientOptions = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
}

/** The service-role client, as the worker's. */
export function adminClient(settings: LocalConfig): LocalClient {
  return createClient<Database>(settings.url, settings.serviceKey, clientOptions)
}

/** The storage client both local buckets sit behind, as the worker's. */
export function storageClient(settings: LocalConfig): S3Client {
  return new S3Client(artS3Options(settings.storage))
}

export type LocalDeps = Deps & { queue: MemoryQueue }

/**
 * The worker's ports on the production adapters for the database (the service client), storage (both
 * local buckets) and the chain (Anvil, read from the process environment), around the queue and the
 * pinner given. `chain` and `log` can be replaced, as verify:render does to count chain reads and keep
 * the log for a failure.
 */
export function localDeps(
  settings: LocalConfig,
  parts: { admin: LocalClient; s3: S3Client; queue: MemoryQueue; pinner: Pinner; chain?: Chain; log?: Log },
): LocalDeps {
  return {
    jobs: supabaseJobs(parts.admin),
    store: s3Store(
      { client: parts.s3, bucket: settings.artBucket },
      { client: parts.s3, bucket: settings.renderBucket },
    ),
    chain: parts.chain ?? viemChain(process.env),
    pinner: parts.pinner,
    queue: parts.queue,
    log: parts.log ?? consoleLog,
  }
}
```

- [ ] **Step 2: Move verify-render onto the module**

In `apps/web/scripts/verify-render.ts`:

1. Replace the four `node:` import lines

```ts
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
```

with

```ts
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
```

2. In the `@aws-sdk/client-s3` import, delete the `S3Client,` line. In the `viem` import, delete the `getAddress,` line.

3. Directly after `import type { Database } from '../src/lib/database.types.ts'`, add:

```ts
import {
  adminClient,
  clientOptions,
  localConfig,
  localDeps,
  storageClient,
  type LocalClient,
  type LocalDeps,
} from './render-deps.ts'
```

4. Replace everything from the line `const here = dirname(fileURLToPath(import.meta.url))` through the line `const factory = getAddress(factoryEnv)` (the `.env.local` loading, `supabaseStatus`, `config`, the dynamic import of `@cobweb/shared`, the settings, the bucket names, the environment fill added in Task 4, the chain settings and the local-endpoint refusal) with:

```ts
const { factoryAbi, isLocalUrl, enqueueRender } = await import('@cobweb/shared')

// Every local setting, with non-local endpoints refused (scripts/render-deps.ts, shared with render:local).
// It also fills the environment the web app's storage module and the worker's chain adapter read.
const settings = localConfig()
const { url, publishableKey, rpc, factory } = settings
const ART_BUCKET = settings.artBucket
const RENDER_BUCKET = settings.renderBucket
```

5. Replace

```ts
const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
type Client = ReturnType<typeof createClient<Database>>
const admin: Client = createClient<Database>(url, serviceKey, clientOptions)
const chain = createTestClient({ chain: anvil, mode: 'anvil', transport: http(rpc) }).extend(publicActions)
const s3 = new S3Client(worker.artS3Options(storage))
```

with

```ts
type Client = LocalClient
const admin: Client = adminClient(settings)
const chain = createTestClient({ chain: anvil, mode: 'anvil', transport: http(rpc) }).extend(publicActions)
const s3 = storageClient(settings)
```

6. Delete the line `type Deps = import('@cobweb/worker').Deps`.

7. Replace `depsFor` and `render`:

```ts
/** The worker's ports: the production adapters for the database, storage and the chain; local doubles for the rest. */
function depsFor(queue: MemoryQueue, pinner: Pinner): Deps & { queue: MemoryQueue } {
  const realChain = worker.viemChain(process.env)
  return {
    jobs: worker.supabaseJobs(admin),
    store: worker.s3Store({ client: s3, bucket: ART_BUCKET }, { client: s3, bucket: RENDER_BUCKET }),
    chain: {
      jobPayment: async (job) => {
        chainReads += 1
        return realChain.jobPayment(job)
      },
    },
    pinner,
    queue,
    log: (event, fields = {}) => void logLines.push(`${event} ${JSON.stringify(fields)}`),
  }
}

/** Enqueues the job's start message and drains the queue, as Vercel Queues and the consumer would. */
async function render(jobId: string, deps: Deps & { queue: MemoryQueue }, retries = 0) {
```

with

```ts
/** The worker's ports from the shared module, with the chain reads counted and the log kept for a failure. */
function depsFor(queue: MemoryQueue, pinner: Pinner): LocalDeps {
  const realChain = worker.viemChain(process.env)
  return localDeps(settings, {
    admin,
    s3,
    queue,
    pinner,
    chain: {
      jobPayment: async (job) => {
        chainReads += 1
        return realChain.jobPayment(job)
      },
    },
    log: (event, fields = {}) => void logLines.push(`${event} ${JSON.stringify(fields)}`),
  })
}

/** Enqueues the job's start message and drains the queue, as Vercel Queues and the consumer would. */
async function render(jobId: string, deps: LocalDeps, retries = 0) {
```

8. Replace `const sweepDeps = (deps: Deps & { queue: MemoryQueue }, jobId: string) => {` with `const sweepDeps = (deps: LocalDeps, jobId: string) => {`.

9. In the header comment, replace the sentence `Supabase and storage settings come from the environment or \`supabase status -o env\`; RPC_URL_31337` (the line starting `// Supabase and storage settings`) and its continuation with:

```ts
// Supabase, storage and chain settings come from scripts/render-deps.ts (the environment, `supabase status
// -o env` and apps/web/.env.local), shared with render:local; it refuses non-local endpoints.
// Never prints a key. Deletes every row and object it creates. Runs under
// `node --conditions=react-server --import ./scripts/resolve-ts.mjs`.
```

`createClient` from `@supabase/supabase-js` and the `Database` type stay: `signIn` builds a publishable client with them. `existsSync` and `readFileSync` stay: the pin folder and `readPin` use them.

Run: `pnpm --filter @cobweb/web verify:render`
Expected: `22 passed, 0 failed`, the same 22 names as after Task 5.

- [ ] **Step 3: Write the runner**

Create `apps/web/scripts/render-local.ts`:

```ts
// Runs the render worker on a laptop for one collection (docs/specs/2026-10-14-render-screen-wiring.md,
// section 12): the dev app's queue only logs, so a job paid in the browser against local Supabase and
// Anvil is rendered here, on the worker's production adapters for the database, storage and the chain,
// with a folder under the system temp directory standing in for the pinning service and a queue in
// memory. Every job of the collection that is paid, waived, rendering or finalizing (real and
// placeholder) gets a start message with its retries, and the runner drains the queue. Prints each
// job's final state, its CIDs and the pinner's folder; exits 0 only when every job ended done. Refuses
// non-local endpoints. Never prints a key. Deletes nothing.
//
//   supabase start && supabase seed buckets
//   pnpm --filter @cobweb/web chain:local    (then copy its two lines into apps/web/.env.local)
//   pnpm --filter @cobweb/web render:local <collectionId>
//
// Runs under `node --conditions=react-server --import ./scripts/resolve-ts.mjs`.

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { enqueueRender } from '@cobweb/shared'
import { consoleLog } from '@cobweb/worker'
import { folderPinner, memoryQueue, runLocal } from '@cobweb/worker/local'
import { adminClient, localConfig, localDeps, storageClient } from './render-deps.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const collectionId = process.argv[2]
if (!collectionId || !UUID.test(collectionId)) {
  console.error('Usage: pnpm --filter @cobweb/web render:local <collectionId>')
  process.exit(2)
}

const settings = localConfig()
const admin = adminClient(settings)

const found = await admin
  .from('render_jobs')
  .select('id, kind, state, retries')
  .eq('collection_id', collectionId)
  .in('state', ['paid', 'waived', 'rendering', 'finalizing'])
  .order('created_at')
if (found.error) {
  console.error(`The jobs could not be read: ${found.error.message}`)
  process.exit(1)
}
const jobs = found.data
if (jobs.length === 0) {
  console.log(`Collection ${collectionId} has no job that is paid, waived, rendering or finalizing.`)
  process.exit(0)
}

const pins = mkdtempSync(join(tmpdir(), 'cobweb-render-local-'))
const queue = memoryQueue()
const deps = localDeps(settings, {
  admin,
  s3: storageClient(settings),
  queue,
  pinner: folderPinner(pins),
  log: consoleLog,
})

console.log(`Rendering ${jobs.length} job(s) of collection ${collectionId} on ${settings.rpc} against ${settings.url}`)
for (const job of jobs) {
  console.log(`  start: ${job.kind} job ${job.id} (${job.state}, retries ${job.retries})`)
  await enqueueRender(queue, { id: job.id, retries: job.retries })
}
const run = await runLocal(deps)
console.log(`Deliveries: ${run.handled} handled, ${run.thrown} thrown, ${run.dead} dead-lettered`)

let allDone = true
for (const job of jobs) {
  const { data: row, error } = await admin
    .from('render_jobs')
    .select('state, error_code, error, metadata_cid, base_uri, collage_key')
    .eq('id', job.id)
    .single()
  if (error) {
    console.error(`  ${job.id}: could not be read: ${error.message}`)
    allDone = false
    continue
  }
  const batches = await admin
    .from('render_batches')
    .select('index, images_cid')
    .eq('job_id', job.id)
    .order('index')
  const failure = row.error_code ? ` (${row.error_code}: ${row.error})` : ''
  console.log(`  ${job.kind} job ${job.id}: ${row.state}${failure}`)
  for (const batch of batches.data ?? [])
    console.log(`    batch ${batch.index + 1}: ${batch.images_cid ?? 'not pinned'}`)
  if (row.metadata_cid) console.log(`    metadata: ${row.metadata_cid}`)
  if (row.base_uri) console.log(`    base URI: ${row.base_uri}`)
  if (row.collage_key) console.log(`    collage: ${row.collage_key} (bucket ${settings.renderBucket})`)
  if (row.state !== 'done') allDone = false
}
console.log(`Pinned CARs are in ${pins}`)
process.exit(allDone ? 0 : 1)
```

In `apps/web/package.json`, after the `"verify:render"` script line add:

```json
    "render:local": "node --conditions=react-server --import ./scripts/resolve-ts.mjs scripts/render-local.ts"
```

(and a comma at the end of the `verify:render` line).

In `CLAUDE.md`, in the Commands block, after the `pnpm --filter @cobweb/worker bench` line add:

```
pnpm --filter @cobweb/web render:local <collectionId>   # renders the collection's paid jobs on the laptop against local Supabase, local storage and Anvil; CARs go to a temp folder
```

- [ ] **Step 4: Smoke the runner**

```bash
pnpm --filter @cobweb/web render:local 00000000-0000-0000-0000-000000000000; echo "exit $?"
pnpm --filter @cobweb/web render:local nope; echo "exit $?"
```

Expected: the first prints `Collection 00000000-0000-0000-0000-000000000000 has no job that is paid, waived, rendering or finalizing.` and `exit 0`; the second prints the usage line and `exit 2`. A run over a real paid collection is part of the browser walk (Task 10), where the expected output is a `start:` line per job, the deliveries line, each job as `done` with its batch CIDs, metadata, base URI and collage key, the pin folder, and `exit 0`.

- [ ] **Step 5: Format, run the root checks and commit**

```bash
pnpm exec prettier --write apps/web/scripts/render-deps.ts apps/web/scripts/render-local.ts apps/web/scripts/verify-render.ts apps/web/package.json
pnpm typecheck && pnpm lint && pnpm test
git add apps/web/scripts/render-deps.ts apps/web/scripts/render-local.ts apps/web/scripts/verify-render.ts apps/web/package.json CLAUDE.md
git commit -m "$(cat <<'EOF'
Add render:local, which renders a collection's paid jobs on the laptop, and share its dependency builder with verify:render

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

---

### Task 10: The docs, the landing note, the whole check list and the browser walk

**Files:**

- Modify: `docs/MASTER_PLAN.md` (the Phase 4 status paragraph, appended; the Art decisions)
- Modify: `docs/specs/2026-10-09-lock-and-pay.md` (dated notes at the `art_unlock` and `unlockArt` rows)
- Modify: `docs/specs/2026-10-12-render-job-state.md` (dated notes in sections 7 and 9)
- Modify: `docs/specs/2026-10-12-render-worker.md` (a dated note in section 3)
- Modify: `docs/specs/2026-10-14-render-screen-wiring.md` (the acceptance boxes and the landing note)

**Interfaces:** none. `docs/PLAN.md` must not change. `CLAUDE.md` (Task 9) and the page's doc comment (Task 8) are already done.

The browser walk (Step 2) is run by the controller with the dev wallet; the implementer receives its result as text and records it in the landing note (Step 4). An implementer with a browser may run it instead.

- [ ] **Step 1: Run the whole suite**

With local Supabase (`supabase status`), the buckets (`supabase seed buckets`) and Anvil (`chain:local`) running:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm format:check
pnpm --filter @cobweb/web verify:local
pnpm --filter @cobweb/web verify:chain
pnpm --filter @cobweb/web verify:storage
pnpm --filter @cobweb/web verify:sweep
pnpm --filter @cobweb/web verify:render
git diff --quiet main -- docs/PLAN.md && echo "PLAN.md unchanged"
git grep -n "render-sim\|sqsRenderQueue\|imagesCid" -- apps/web/src && echo "stale references" || echo "no stale references"
```

Expected: every command exits 0; `verify:local` ends `289 passed, 0 failed`, `verify:chain` `12 passed, 0 failed`, `verify:storage` `15 passed, 0 failed`, `verify:sweep` `8 passed, 0 failed`, `verify:render` `22 passed, 0 failed`; then `PLAN.md unchanged` and `no stale references`. If `verify:render` fails on a timing check (10 or 10b), run it once more; two failures in a row are a defect to report, not to work around.

- [ ] **Step 2: The browser walk**

Run by the controller (or an implementer with a browser), against the dev server (`pnpm --filter @cobweb/web dev` with `NEXT_PUBLIC_DEMO_DATA=0`), the dev wallet on Anvil, local Supabase and local storage. Record each observation as a sentence for the landing note.

1. Create a generative collection; import a small layer folder, generate a few tokens (say 5), open Lock and upload; review and lock; pay the fee through the wallet. Expected: the render step opens at "0 of 1 batches done" with "Waiting for a render worker" and the time estimate; the network tab shows a server action call every 3 seconds.
2. In a terminal, `pnpm --filter @cobweb/web render:local <collectionId>` with the collection's id from the URL. Expected: the script prints the start line, the deliveries, the job `done` with one batch CID, the metadata CID, the base URI, the collage key and the pin folder, and exits 0.
3. Back in the browser, without reloading. Expected: within one poll the counter reaches "1 of 1 batches done", the metadata row runs, then the done step opens with the collage image (the first tokens, from `/api/collections/<id>/collage`), the Metadata CID, the Base URI and "1 batch" under Images, which opens to the batch CID with its gateway link; the stepper shows the stage done and Deploy opens.
4. Reload the page. Expected: it opens on the done step with the same rows and the collage.
5. Open `/api/collections/<id>/collage` directly while signed in: a 302 to local storage and the PNG renders; in a private window (signed out): 404.
6. Set `NEXT_PUBLIC_DEMO_DATA=1`, restart the dev server, and run the five sample checks listed in Task 8 Step 5 (`?job=rendering` steps to done; `?outcome=batch-failed` shows Try again and the run resumes; `?outcome=art-problem` shows Unlock and fix the art and the review comes back with the credit line; `?job=failed` shows the retry face; `?job=done` with and without `&art=deferred`). Set the variable back to `0`.
7. Still in real mode, a second generative collection: lock, pay, and before running the runner, unlock from the pay step is refused as paid (the step offers no unlock after payment); run `render:local` to done. Then a third collection with a wrong-size layer (one trait image of another size than the project's canvas, uploaded from the Layers screen if the admission check allows it; otherwise skip this item and say so): lock, pay, `render:local` fails it with `layer-size`; the screen shows "The art needs a fix", the sentence and "Unlock and fix the art"; after the unlock the review reads "Locking is final: the credit pays the fee at once." and the lock dialog names the credit; lock again; the pay step is skipped and the render step opens at once with "No fee: covered by the credit from the render that failed" on the pay receipt.

- [ ] **Step 3: The docs**

In `docs/MASTER_PLAN.md`:

1. Under `### Art` in `## Decisions`, after the `**Storage limits**` line, add:

```markdown
- **Render credit** (decided 14 October 2026; [specs/2026-10-14-render-screen-wiring.md](specs/2026-10-14-render-screen-wiring.md)). A paid render that fails for good (an art problem, or five failed retries on a worker fault) can be unlocked, and the payment already made covers the next lock of the same collection with the same or fewer tokens: that lock is recorded `waived` with `credit_job_id` naming the job whose payment it rests on, through the waiver columns `render_jobs` already had. The rule lives in one SQL function, `private.render_credit`, which `art_lock` and the review's `art_render_credit` both ask; the web app never mirrors it. A larger lock pays in full and leaves the credit for a later, smaller lock; a credit is never partial. A job failed with `payment-mismatch` cannot be unlocked and leaves no credit: the payment itself is in doubt, so it stays with support.
```

2. At the end of the Phase 4 `**Status:**` paragraph (after the sentence ending `Alerting on queue retries moves to Phase 7.`), append, in the same paragraph:

```markdown
 Screen wiring (fourth sub-project) landed on 14 October 2026; see [specs/2026-10-14-render-screen-wiring.md](specs/2026-10-14-render-screen-wiring.md). The Lock and upload screen polls `getRenderJob` through React Query (3 seconds, then 15 after two minutes), shows the batches as the worker finishes them, shows a failed job with the worker's sentence and one of four faces (fix the art, try again, unlock on the credit, tell support), retries through `retryRender` (which sends the start message with the row's new retry count), and shows the collage, the metadata CID, the base URI and every batch CID on the done step; the collage is served by `GET /api/collections/[id]/collage`; a paid render that fails and is unlocked leaves a credit (the Render credit decision); sample mode runs on the same code and `render-sim.ts` is gone; `pnpm --filter @cobweb/web render:local <collectionId>` renders a collection's paid jobs on a laptop. Phase 4 is complete. Owed to Phase 5: the reveal flow owns a deployed collection's rendering status, and the retry's job selection on a deferred collection that later holds a real job. Minor and known: the poll runs the existing action, whose session check is the verified one (a read-only owner check is an optimisation for when the poll count shows it); the time estimate is rough (an observed rate over batches done, 95 seconds a batch before that); polling pauses in a background tab and the first poll after a return waits one interval; a credit is never partial.
```

In `docs/specs/2026-10-09-lock-and-pay.md`:

1. In the `art_unlock(collection)` row of the functions table (section 6), append inside the second cell, after `'The art is paid for and stays locked.'`:

```markdown
 (14 October 2026: redefined by [2026-10-14-render-screen-wiring.md](2026-10-14-render-screen-wiring.md), section 4.3. It now takes the collection's latest real job whatever its state: a `failed` paid job can be unlocked too, keeping the worker's sentence under the code `unlocked` and leaving a credit; a `payment_due` job is cancelled as before; a `payment-mismatch` failure is refused with `PAYMENT_UNVERIFIED`; a `done` or already unlocked job reads 'The art is not locked.')
```

2. In the `unlockArt(collectionId)` row of the actions table (section 7), append inside the second cell, after `rather than deleting it.`:

```markdown
 (14 October 2026: the on-chain check applies only to an open `payment_due` job; a failed paid job is unlocked by the database and leaves a credit, [2026-10-14-render-screen-wiring.md](2026-10-14-render-screen-wiring.md), section 5.)
```

In `docs/specs/2026-10-12-render-job-state.md`:

1. At the end of section 7 (after the paragraph ending `sweep (third sub-project) can pick up.`), add a paragraph:

```markdown
> **14 October 2026:** the retry action exists: `retryRender` calls this function and sends the start message with the returned row's `retries` ([2026-10-14-render-screen-wiring.md](2026-10-14-render-screen-wiring.md), section 6). A failed paid job can also be unlocked now; it keeps its sentence under the code `unlocked` and leaves a credit for the next lock (section 4 there).
```

2. At the end of section 9 (after the paragraph ending `so the stage can be seen.`), add a paragraph:

```markdown
> **14 October 2026:** the known gap on art problems is closed by the screen: for every code in `ART_PROBLEM_CODES` the failed job shows the `art` face (unlock and fix the art), whatever `retryable` says ([2026-10-14-render-screen-wiring.md](2026-10-14-render-screen-wiring.md), section 8). `RenderJobBase` gained `credited`, and `render-sim.ts` is gone.
```

In `docs/specs/2026-10-12-render-worker.md`, at the end of section 3 (after the `Out:` list, before `## 4.`), add a paragraph:

```markdown
> **14 October 2026:** the fourth sub-project consumed `enqueueRender` (through `startRender` with the row's retry count), `ART_PROBLEM_CODES`, the collage key (served by `GET /api/collections/[id]/collage` through a presigned GET on the render bucket), `art_render_retry` in `retryRender`, and the local runner in `pnpm --filter @cobweb/web render:local`; see [2026-10-14-render-screen-wiring.md](2026-10-14-render-screen-wiring.md).
```

- [ ] **Step 4: The landing note and the acceptance boxes**

In `docs/specs/2026-10-14-render-screen-wiring.md`, turn every `- [ ]` in section 16 into `- [x]` once the matching item holds, and append after the list, as the file's last paragraph, a landing note of this shape, with the measured counts and the walk's observations from Step 2 written out (keep the sentences plain; no dashes):

```markdown
Checked on 14 October 2026 on local Supabase, local storage and Anvil: root typecheck, lint and tests (web 334); next build; verify:local 289 checks; verify:chain 12; verify:storage 15; verify:sweep 8; verify:render 22. Browser walk with the dev wallet: <one sentence per item of the walk, in order: the paid collection polling at 3 seconds, render:local finishing it, the done step reached without a reload with the collage, the metadata CID, the base URI and the batch list, the reload landing on the done step, the collage route's 302 and the signed-out 404, the five sample checks, the second collection and the wrong-size collection with the art face, the credit line on the review and the credited lock skipping the pay step; or the words "not run" with the reason for any item that could not be run>.
```

- [ ] **Step 5: Commit**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add docs/MASTER_PLAN.md docs/specs/2026-10-09-lock-and-pay.md docs/specs/2026-10-12-render-job-state.md docs/specs/2026-10-12-render-worker.md docs/specs/2026-10-14-render-screen-wiring.md
git commit -m "$(cat <<'EOF'
Record the render screen wiring landing, the render credit decision and the notes the earlier specs owe it

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: `git status` is clean, `git log --oneline main..HEAD` lists eleven commits (the plan and the ten tasks), and `git diff --quiet main -- docs/PLAN.md` exits 0.
