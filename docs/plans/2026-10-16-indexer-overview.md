# The Indexer and the Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teach Cobweb what happened on its collections from the chain, Phase 6's third and last sub-project. Inside the freshness server's process, one indexer per served chain reads the logs of every collection Cobweb deployed there, from each collection's deploy block to the chain's confirmation depth, in scans of at most 500 blocks over at most 100 contracts, and records each mint, each token's owner, each airdrop with its recipients and each withdrawal once per log through one service-role function, with a cursor per collection that makes a restart, a rescan and a backfill safe. The state body the mint page already polls gains `activity`, the holders and the 10 latest mints from the indexer's memory, so the page shows a Holders row and Recent mints with no database on the request path. The Overview shows holders, recent mints and "Paid by minters" on real data, with "Counting" until the indexer has read every block since the deploy and a line when its count trails the chain read; Already withdrawn counts withdrawals made outside Cobweb. Airdrop's History lists airdrops sent from outside Cobweb with their block times, and By recipient finds, pages and exports every wallet an airdrop reached. Sample mode renders every new state, and `verify:indexer` proves on Anvil, local Supabase and the server in process that every kind of record lands once and survives a replay, a restart and a backfill.

**Architecture:** The migration adds `indexer_cursors`, `mints`, `token_owners` and `airdrop_recipients` under row-level security (the owner reads all but `token_owners`, no client writes any), makes `airdrops.sent_by` nullable with a new `block_time`, and adds four `security definer` functions for the service role alone: `indexer_targets`, `indexer_start`, `indexer_record` (one segment of one scan in one transaction: the cursors locked in id order, the gap check, every table keyed so a log read twice leaves one row, the holders recounted, the cursors moved, the summaries answered) and `indexer_summaries`. In `apps/freshness`, `indexer-records.ts` pairs each mint or airdrop event with its transaction's transfers from the zero address, `indexer-plan.ts` plans the scans, cuts their logs into writes and paces the passes, `activity.ts` turns a summary into the state body's `activity`, `indexer-db.ts` is the database port on supabase-js with the service role key, and `indexer.ts` runs the passes for one chain beside its reader; `startFreshness` starts one per served chain when it is given the indexer's options (from `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`), stops them in `close()`, reports them on `/health`, and appends their activity to each state body, whose ETag covers it. In `apps/web`, `activity-view.ts` and `activity-core.ts` give the Overview its holders, recent mints and "Paid by minters"; `airdrop-core.ts` gains the counted flag, By recipient's page and its export; `airdrop-history.tsx` is History with its two views; `live-data.ts` and `recent-mints.tsx` show the activity on the mint page, which reads it through its parser as null when a server sends none.

**Tech Stack:** TypeScript 6 strict (ESM, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`; the freshness server adds `erasableSyntaxOnly`) consumed as source; Node 24 runs the freshness server's TypeScript on Railway, Node 26 locally; viem 2.57 (`getLogs` with `events` and `strict: true`, `getAbiItem`); `@supabase/supabase-js` 2.117.2, the render worker's version, now in `apps/freshness`; Supabase (Postgres 17, row-level security, `security definer` functions answering jsonb); Next 16.3 with React 19 and TanStack Query 5 (`useQuery`, `keepPreviousData`); zod 4.6; Vitest 5 (Node environment, fake timers, fake fetches); Anvil through `chain:local`; Prettier 3.

**Spec:** [../specs/2026-10-16-indexer-overview.md](../specs/2026-10-16-indexer-overview.md)

## Global Constraints

- The spec is the binding authority, its section 14 reconciliations included. Where this plan decides a detail the spec leaves open, or departs from its letter, the decision is collected in the next section and named in the step that carries it.
- Node 26 locally; Node 24 runs the freshness server on Railway, from its TypeScript source with no build step. ESM everywhere. Inside `apps/web/src`, imports are extensionless and use the `@/` alias, as the existing files do. Inside `packages/shared` and `apps/freshness`, relative imports carry the `.ts` extension, and the freshness server writes no TypeScript that Node cannot erase (`erasableSyntaxOnly`: no enums, no parameter properties). Inside `apps/web/scripts`, relative imports carry the `.ts` extension and the app's modules are imported as `../src/...` after the fixture sets the environment; the scripts run under `node --conditions=react-server --import ./scripts/resolve-ts.mjs`. Types are imported with `import type` or an inline `type` specifier.
- Vitest 5, Node environment. One file: `pnpm --filter <package> exec vitest run <file>`, for example `pnpm --filter @cobweb/freshness exec vitest run src/indexer.test.ts`. A fake `fetch` is a plain function cast `as typeof fetch`; a fake viem client or database port is a plain object with the methods the code calls, cast `as unknown as PublicClient` where needed. Timers are faked with `vi.useFakeTimers()` and advanced with `vi.advanceTimersByTimeAsync`.
- Test fixtures: annotate every fixture constant with its type (`const A: Address = ...`, `const body: StateBody = ...`), since an unannotated literal widens and fails `tsc`.
- Prettier: no semicolons, single quotes, trailing commas, 110 columns. Before each commit run `pnpm exec prettier --write <the files you changed>` from the repo root. Never run `pnpm format` or Prettier on `.`. Prettier cannot parse `.sql` or `.env.example` files, so never list them. CI runs `pnpm format:check`, so every other file you touch outside `docs/` must be formatted (`docs/`, `contracts/out/` and `packages/ui/src/components/` are in `.prettierignore`). The code blocks in this plan are already formatted; Prettier leaves them as they are.
- typescript-eslint's recommended rules and ESLint's `preserve-caught-error` apply. Do not write `throw new X(...)` directly inside a `catch` block without `{ cause }`. `eslint.config.mjs` is not touched.
- Copy: plain sentences. No em or en dashes anywhere, code, comments, commit messages and docs included. The product is Cobweb; never Kingdomly or realm. Colours come from the theme's tokens, never hex values; UI is built from the shadcn components in `packages/ui` (`@cobweb/ui/components/...`).
- CLAUDE.md rules 1, 3 and 4 bind this sub-project. Liveness stays each group's `active`, the contract's own; the indexer reads only what happened (rule 1). The mint page still calls no RPC for shared state: its holders and recent mints arrive in the state body it already polls from the freshness server (rule 3). The three new actions (`getActivity`, `getAirdropRecipients`, `exportAirdropRecipients`) run through `phasesWrite`, which checks the session and the ownership, as `getAirdrop` does with its new counted read, and all four new tables have row-level security (rule 4).
- Security: `SUPABASE_SERVICE_ROLE_KEY` is a secret that never leaves the server. It lives only in the freshness server's environment (on Railway, the owner's step); the verify reads the local one from `supabase status` through the fixture. No key or RPC URL is printed, logged or committed: `IndexerWriteError` names the function and the code, never the database's message; the log lines carry `failureLine` and never a full message; `/health` carries no URL, key or message, and `verify:indexer` checks it. The request path reads no database: the state body's `activity` comes from the indexer's memory.
- Never deploy to any remote chain or service, and never pass `--prod` or `--target production` to any command. The only chain any step touches is the local Anvil on port 8545; every script refuses an endpoint that is not localhost. The hosted migration and Railway's two variables are the owner's (spec section 12).
- The repository is linked to a hosted Supabase project (`supabase/.temp`). Never run `supabase db push`, never pass `--linked` or `--project-ref` to any command, never run `supabase db reset` or `supabase stop`. The only Supabase commands a step runs are `supabase migration up --local` and `supabase status`.
- `docs/PLAN.md` must not change. `legacy/` is never read into, copied from, imported or committed.
- Docs keep their history: add dated notes and status sentences; never rewrite or delete earlier statements in `docs/MASTER_PLAN.md` or in specs.
- Local services, as the previous sub-project left them: `supabase start` at the repo root has run (the migrations up to `20261016100000_mint_page.sql` are applied; Task 1 applies the new one with `supabase migration up --local`, which keeps the local data), `supabase seed buckets` has run (the `art`, `render` and `mint-page` buckets), and `pnpm --filter @cobweb/web chain:local` is running on port 8545 with its two printed lines (`RPC_URL_31337` and `FACTORY_ADDRESS_31337`, the factory at `0x5FbDB2315678afecb367f032d93F642f64180aa3`) in `apps/web/.env.local`, the factory approving the shipped creation code. `apps/web/.env.local` keeps `NEXT_PUBLIC_DEMO_DATA=1`, so `pnpm build` runs sample mode. Task 1 needs Supabase; Tasks 3 and 4 run `verify:freshness`, which needs Anvil alone; Task 8 needs Supabase and Anvil; Task 9 needs everything, the freshness server and the dev wallet. Tasks 2, 5, 6 and 7 need nothing running.
- The local database keeps the earlier walks' collections, recorded as deployed on chain 31337. The indexer reads every collection deployed on a chain it serves, so on this machine it also starts a cursor for each walk collection whose deploy transaction is on the running Anvil, and logs once a minute each one whose deploy is not ("The deploy of <id> on Anvil could not be read; it is tried again in a minute."). That is expected; `verify:indexer` counts the database's cursors on 31337 rather than one (Decision 18).
- Dependencies install from the local store: `pnpm install --offline`, so the lockfile resolves exactly as this plan was checked (Task 3 adds `@supabase/supabase-js` to the freshness package; the lockfile gains three lines).
- Implementers never use `git commit --amend` or `git stash`. `git rm` is used only where a step says so. To fix a commit, make a new one.
- Before every commit, at the repo root: `pnpm exec prettier --write <the files you changed>`, then `pnpm typecheck && pnpm lint && pnpm test`.
- Commit messages are one plain imperative sentence with no prefix, then a blank line, and end with exactly these two lines:

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
```

## Decisions

1. Decision (spec section 3): nine tasks in the spec's order. The migration, its types and `verify:local`'s section 9o (1); the indexer's wire types and pure modules (2); the indexer, its database port, its options, the server's start and stop and `/health` (3); `activity` in the state body and its tag, with the page's parser (4); the Overview on live data (5); Airdrop's History, By recipient and its export, and the Settings sentence (6); the mint page's Holders and Recent mints and its sample switch (7); `verify:indexer` (8); the whole check list, the browser walk and the docs (9, the controller's). Neither Task 3 nor Task 6 is split: at about 1,930 and 1,850 lines they stay under the previous plan's largest task (its Task 5, about 3,640 lines).
2. Decision (sections 3 and 5): Task 2 adds `MintBody` and `StateActivity` to the shared package without the field, and Task 4 adds `activity` to `StateBody` together with everything that writes or reads it: the server's body, the page's parser with its tests, and `activity: null` in the sample's body and in the web app's body fixtures. A required field breaks every `StateBody` literal at once, and every task ends with the root checks green, so the parser cannot wait for Task 7, which the spec's section 3 gives "the mint page's Holders and Recent mints" (Task 7 keeps them).
3. Decision (sections 6.2 and 6.6): `Summary` is defined in `activity.ts` (Task 2), which takes it, and `indexer-db.ts` re-exports it (Task 3); `IndexerHealth` is defined in `health.ts` beside `ChainHealth`, and `indexer.ts` re-exports it. The reader's own health type becomes `ReaderHealth`, `ChainHealth` is `ReaderHealth & { indexer: IndexerHealth | null }` and `chainHealth(reader, indexer)` composes a chain's entry, so `chain-reader.ts` changes two type annotations and nothing in its tick. The spec lists both types with their modules (Tasks 2 and 3).
4. Decision (section 6.4): `recordsOf` answers `unpaired: Hex[]`, the transaction of each mint or airdrop that did not pair, instead of a count, since its log line names the transaction; `/health` counts them once their segment is written or deferred, so a segment read again after a failed write is not counted twice (Tasks 2 and 3).
5. Decision (section 4.3): `indexer_record` answers each named collection as `indexer_summaries` lists it, its id and contract beside its holders, `syncedAt` and `recentMints`, through one helper (`private.indexer_summary`), so the port answers whole summaries from either function; `indexer_targets` and `indexer_start` share `private.indexer_target` the same way (Task 1).
6. Decision (section 4.3): `indexer_record` keeps one airdrop per transaction (`distinct on (r.tx)`, the lowest first token id) and one owner record per token (`distinct on` the collection and the token, the latest block and log index) before each insert. `INSERT ... ON CONFLICT DO UPDATE` refuses to touch one row twice in a statement (21000), so a transaction with two `NFTsAirdropped` events, which the spec's Known list keeps, would otherwise fail its whole write on every retry and stall the collection for good (Review Focus 3). `verify:local`'s check 7 names the case, so section 9o keeps ten checks and the count stays 394 (Task 1).
7. Decision (section 6.5): a pass with any failure (the summaries, the targets, a start, the head, a scan, a block time or a write) waits the fast delay, 5 s, before the next, whatever else it found. The spec's cadence (decision 7) says nothing of failures: as a backfill's pass it would retry every second on the provider quota the reader shares, and as an idle chain's it would wait 20 s (Review Focus 2, Task 3).
8. Decision (section 6.2): each database call is abandoned after 10 s (`DB_TIMEOUT_MS`) through supabase-js's `abortSignal`, and fails with the code `TIMEOUT`; a call that got no answer at all fails with `NETWORK`. Passes never overlap and `close()` waits for the one in flight, so one call that never answers would otherwise stop the chain's indexing and the server's stop (Review Focus 1). The spec names the Postgres codes only (Task 3).
9. Decision (sections 6.5 and 6.6): a cursor this process starts gets an empty summary (0 holders, no mint) at once, so the state body carries the activity of a collection with no mint yet once it reads synced. The spec loads summaries at start and from the answers of writes with records, so a long-running server would show nothing for a new drop until its first mint while a restarted one, loading every summary, shows Holders 0 (Review Focus 4, Task 3).
10. Decision (section 6.5): a deploy whose receipt cannot be read is logged at most once a minute per collection, whatever `targetsEveryMs` is; `verify:indexer` reads the targets every second, and on this machine six walk collections name deploys from an earlier Anvil. A cursor taken again from the database after a gap refusal keeps its range (Task 3).
11. Decision (section 6.1): the indexers start once the server listens, so a start that fails (a port in use) leaves none running, and `close()` stops them with the readers and windows. `index.ts` reads the options inside its start, so a `ConfigurationError` from `indexerOptionsOf` is logged as a failed start rather than thrown at the top level (Task 3).
12. Decision (section 7.5): the page's parser reads `activity: activitySchema.nullable().catch(null)`, not `.nullish().catch(null)`. Zod 4 leaves a missing key absent under `nullish`, which `StateBody`'s `activity: StateActivity | null` does not type; with `nullable` and `catch`, a body without `activity`, with null or with a malformed one reads null (checked against zod 4.6.5). The schema takes any number of mints and the page shows the first 10, so a server that sends more never blanks the activity (Tasks 4 and 7).
13. Decision (section 7.1): `activityViewCore` reads the cursor and the mints with the creator's client and throws on a read error, as `phaseBase` and `readAll` do, so the action logs it and the Overview reads "Not read". It does not refuse a collection without a deployment, since the Overview reaches it only for a deployed one, and a stranger's client reads nothing under row-level security (Task 5).
14. Decision (section 7.3): By recipient orders newest block first, then each transaction's runs by first token id ascending, the order of the spec's index `(collection_id, block desc, first_token_id)`. A page past the last, which PostgREST refuses with 416 (`PGRST103`), answers no row with the count read alone. A query the core cannot read is refused with By recipient's not-read sentence, "The recipients could not be read. Try again in a moment." (`RECIPIENTS_NOT_READ`). `verify:indexer`'s check 10 names the page past the last (Tasks 6 and 8).
15. Decision (section 7.3): History lives in a new `airdrop-history.tsx` (the switch, By transaction with its export, By recipient with its search, pager and export), which the Airdrop screen renders in place of its History panel; `tokenRange` takes its text from the new `tokenIdsText`, which the CSV rows share. The sample's recipients are a demo type, `AirdropRecipientRecord`, since `lib/demo` imports nothing from `lib/manage` (Task 6).
16. Decision (sections 7.2 and 7.5): the Overview's Recent mints rows and the page's are keyed by hash and first token id, since two mints in one transaction share a hash (Tasks 5 and 7).
17. Decision (section 10): tests beyond the spec's list, each for a Review Focus line or the port: `indexer-db.test.ts` (six tests: the calls' shapes, the answers' mapping, the refusals' codes and gap, `NETWORK`, and the 10 s limit), and in `indexer.test.ts` the fast delay after a failure and a started collection's empty summary, and in `indexer-records.test.ts` a mint made from inside another collection's mint (Tasks 2 and 3).
18. Decision (section 10, `verify:indexer`): the airdrop through Cobweb is sent and confirmed while the server is stopped, then the server starts again, since a running indexer at Anvil's depth of 1 could record the airdrop before the confirm and leave its sender null, the race the spec's Known list describes; the burn pays a fee of 0.0001 ETH a token that the factory's admin sets on the collection, as `verify:airdrop` does, since the local factory's fees are 0; the 1,200 empty blocks are mined 100 at a time, each call well under viem's 10 s request timeout (an idle local Anvil took 2.4 s per 100 blocks, and one call of 1,200 timed out); check 14 counts every cursor the database holds on 31337 (the walks' among them, Global Constraints) where the spec writes "with one collection"; check 9's "refused as not found" is checked as the action checks it (the stranger's ownership read answers `NOT_FOUND`) and the core on the stranger's client reads nothing (Task 8).
19. Decision (section 11, and this plan's brief): `CLAUDE.md`'s two lines and `apps/freshness/.env.example`'s two variables are written in Task 9 with the other docs, after the code they describe has landed (Task 9).

## Review Focus

Inputs and failure modes the spec implies but its own test list would not exercise, most likely to bite on mint day first. Each is pinned to a test in the task that owns the code.

1. A database call that never answers (a connection held open behind a proxy or a pooler during a mint). Passes never overlap and `close()` waits for the pass in flight, so without a limit one such call would stop the chain's indexing for good, freeze the state body's activity, and hang the server's stop on Railway's SIGTERM. Each call is abandoned after 10 s and fails as `TIMEOUT`, so the pass counts a failure and the next one tries again. Pinned by "abandons a call that has not answered after 10 s, so it cannot hold a pass (Review Focus 1)" (Task 3, `indexer-db.test.ts`).
2. An outage of the database or the provider during a backfill or a busy mint. A pass that left a cursor below the safe block would run again 1 s later and repeat its failing scan or write every second, on the provider quota the chain's reader shares, so the mint page would read degraded while the indexer retried. A pass with any failure waits the fast delay, 5 s. Pinned by "waits the fast delay after a failed write rather than the backfill 1 s (Review Focus 2)" (Task 3, `indexer.test.ts`).
3. A transaction with two `NFTsAirdropped` events (a Safe owning the collection batches two `airdropNFTs` calls). Inserted as two rows of one key in one `ON CONFLICT DO UPDATE`, PostgreSQL refuses the whole write (21000) on every retry, and the collection's indexing would stall at that block for good, its holders and mints with it. The first airdrop is kept and both recipient rows. Pinned by `verify:local`'s check "airdrops: ...; a transaction with two airdrops keeps the first and both recipient rows" (Task 1, `verify-local.ts`).
4. A collection that has not minted yet, in a server that has been running since before it deployed. Its cursor would have no summary until its first mint, so the state body would carry no activity and the page no Holders row, while a restarted server, which loads every summary, shows Holders 0. A cursor the process starts gets an empty summary. Pinned by "answers 0 holders and no mint for a collection it started, once read to the safe block (Review Focus 4)" (Task 3, `indexer.test.ts`).
5. A mint made from inside another collection's mint (a receiver contract that mints a second Cobweb collection from its `onERC721Received` hook, between the first collection's transfer and its `TokensMinted`). With one list of pending transfers per transaction, both mints would read unpaired and neither would be recorded. The pending transfers are kept per collection. Pinned by "pairs a mint made from inside another collection mint with its own transfers (Review Focus 5)" (Task 2, `indexer-records.test.ts`).

## File map

| Path | Task | Responsibility |
| --- | --- | --- |
| `supabase/migrations/20261016200000_indexer.sql` | 1 | `indexer_cursors`, `mints`, `token_owners`, `airdrop_recipients`, the `airdrops` changes and the four service-role functions |
| `apps/web/src/lib/database.types.ts`, `apps/web/scripts/verify-local.ts` | 1 | The new tables' and functions' types; the four anon checks and section 9o's ten |
| `packages/shared/src/freshness-wire.ts` | 2, 4 | `MintBody` and `StateActivity` (2); `StateBody.activity` (4) |
| `apps/freshness/src/indexer-records.ts`, `indexer-plan.ts`, `activity.ts` and their tests | 2 | A segment's records, the passes' plan and pace, the state body's activity |
| `apps/freshness/src/indexer-db.ts`, `indexer.ts` and their tests, `config.ts`, `health.ts`, `chain-reader.ts`, `server.ts`, `index.ts`, `config.test.ts`, `health.test.ts`, `apps/freshness/package.json`, `pnpm-lock.yaml` | 3 | The database port, one chain's passes, the options, `/health`, the start and stop |
| `apps/freshness/src/state-body.ts`, `state-body.test.ts`, `server.ts`; `apps/web/src/lib/mint/fresh-client.ts`, `fresh-client.test.ts`, `live-source.test.ts`, `live-data.test.ts`, `apps/web/src/components/mint/sample-source.ts` | 4 | `activity` in the body and its tag, from the indexer's memory; the page's parser |
| `apps/web/src/lib/manage/activity-view.ts`, `activity-view.test.ts`, `activity-core.ts`, `apps/web/src/app/actions/activity.ts`, the Overview's route, `overview-screen.tsx`, `overview-cards.tsx`, `overview-parts.tsx`, `manage-sim.ts`, `manage-sim.test.ts` | 5 | The Overview's holders, recent mints and "Paid by minters"; `?activity=counting` and `?activity=behind` |
| `apps/web/src/lib/manage/airdrop-types.ts`, `airdrop-view.ts`, `airdrop-view.test.ts`, `airdrop-core.ts`, `apps/web/src/app/actions/airdrop.ts`, `apps/web/src/lib/art/result.ts`, `apps/web/src/lib/demo/types.ts`, `data.ts`, `apps/web/src/components/manage/airdrop-history.tsx`, `airdrop-parts.tsx`, `airdrop-screen.tsx`, `airdrop-server.ts`, `airdrop-sim.ts`, `airdrop-sim.test.ts`, the Airdrop route | 6 | History with its two views, By recipient's page and export, `?activity=counting`, the Settings sentence |
| `apps/web/src/lib/mint/live-data.ts`, `live-data.test.ts`, `apps/web/src/components/mint/recent-mints.tsx`, `collection-sections.tsx`, `mint-page.tsx`, `sample-source.ts`, `sample-source.test.ts`, `model.test.ts` | 7 | The page's Holders row and Recent mints; `?activity=none` |
| `apps/web/scripts/verify-indexer.ts`, `apps/web/package.json` | 8 | `verify:indexer` (15 checks) and its command |
| `docs/MASTER_PLAN.md`, `docs/specs/2026-10-16-indexer-overview.md`, `2026-10-16-freshness-server.md`, `2026-10-16-mint-page-live-data.md`, `2026-10-15-airdrop-settings.md`, `2026-10-03-creator-flow-ui.md`, `CLAUDE.md`, `apps/freshness/.env.example` | 9 | The Phase 6 status line, the Hosting and Flow decisions, the acceptance boxes and the landing note, the dated notes, the command and the variables |

---

### Task 1: The indexer's tables, functions and types, with `verify:local`'s section 9o

**Kind:** transcription. The plan carries every line: a Sonnet implementer.

**Files:**

- Create: `supabase/migrations/20261016200000_indexer.sql`
- Modify: `apps/web/src/lib/database.types.ts` (six blocks), `apps/web/scripts/verify-local.ts` (the anon loop, section 9o and its call)
- Test: `pnpm --filter @cobweb/web verify:local`

**Interfaces:**

- Consumes: `private.collection_owned(uuid)` from `20261008010000_art_tables.sql`; `collections` (`status`), `deployments` (`chain_id`, `contract_address`, `tx_hash`, `deployed_at`), `airdrops`, `withdrawals` and `airdrop_record` from the earlier migrations; `verify-local.ts`'s helpers (`check`, `expectError`, `expectNothing`, `expectSentence`, `refusedAll`, `callArt`, `countRows`, `renderedFixture`, `recordArgs`, `dropArgs`, `airdropRows`, `withdrawalRows`, `insertCollection`, `sortedJson`, `blockTime`, `ADDRESS40`, `HEX64`, `NOT_DEPLOYED_SENTENCE`, `PERMISSION`, `CHECK`, the A and B creators, `admin`, `anon`).
- Produces:
  - `public.indexer_cursors` (`collection_id` primary key, cascading from `collections`; `chain_id`, `contract` lowercase, `from_block`, `indexed_block` at least `from_block - 1`, `synced_at`, `holders`, `updated_at`; unique `(chain_id, contract)`), `public.mints` (keyed by `(tx_hash, log_index)`), `public.token_owners` (keyed by `(collection_id, token_id)`) and `public.airdrop_recipients` (keyed by `(tx_hash, first_token_id)`, cascading from `airdrops`), under row-level security: the owner reads the cursors, mints and recipients; no grant on `token_owners`; no client writes any of them
  - `airdrops.sent_by` nullable and `airdrops.block_time timestamptz`, with the two tables' new comments
  - `public.indexer_targets(p_chain_id integer) returns jsonb`: `[{ collectionId, contract, deployTx, fromBlock, indexedBlock, syncedAt }]`, oldest deploy first, the last three null without a cursor, `syncedAt` in Unix seconds
  - `public.indexer_start(p_collection_id uuid, p_from_block bigint) returns jsonb`: the cursor as a target; refuses a collection without a deployment with 'The contract is not deployed yet.'
  - `public.indexer_record(p_chain_id integer, p_from_block bigint, p_to_block bigint, p_synced_at timestamptz, p_collections uuid[], p_records jsonb) returns jsonb`: `{ "<collection id>": { collectionId, contract, holders, syncedAt, recentMints: [{ tx, recipient, groupId, amount, firstTokenId, blockTime }] } }` for each collection a record names (Decision 5); refuses 'A collection is not indexed on this chain.', 'The indexer would skip blocks.' and 'A record names a collection outside this write.' (all `23514`); `p_records` is `{ mints, owners, airdrops, withdrawals }` as spec section 4.3 writes them
  - `public.indexer_summaries(p_chain_id integer) returns jsonb`: every cursor of the chain as `indexer_record` answers one
  - the four functions run for `service_role` only; in `database.types.ts`, the four tables' `Row`, `Insert`, `Update` and `Relationships`, the `airdrops` changes and the four functions' `Args` and `Returns`

- [ ] **Step 1: Write the failing checks**

The anon loop gains the four tables, and section 9o runs after the mint page section on two collections recorded as deployed on chain 31337 as section 9k records one, a third recorded on Base and a draft. Its check 7 also writes one transaction with two airdrops (Decision 6, Review Focus 3).

In `apps/web/scripts/verify-local.ts`, replace:

```ts
    'mint_pages',
    'token_ranks',
  ]) {
    await check(`anon: reads nothing from ${table}`, async () => {
```

with:

```ts
    'mint_pages',
    'token_ranks',
    'indexer_cursors',
    'mints',
    'token_owners',
    'airdrop_recipients',
  ]) {
    await check(`anon: reads nothing from ${table}`, async () => {
```

In `apps/web/scripts/verify-local.ts`, replace:

```ts
  await artAirdropSettings(A, B)
  await artMintPage(A, B)
}

```

with:

```ts
  await artAirdropSettings(A, B)
  await artMintPage(A, B)
  await artIndexer(A, B)
}

```

In `apps/web/scripts/verify-local.ts`, replace:

```ts

// ---------------------------------------------------------------------------------------------
// 10. Cleanup
// ---------------------------------------------------------------------------------------------
```

with:

```ts

// ---------------------------------------------------------------------------------------------
// 9o. The indexer: indexer_cursors, mints, token_owners and airdrop_recipients, the airdrops changes, and the
// four service-role functions indexer_targets, indexer_start, indexer_record and indexer_summaries
// (docs/specs/2026-10-16-indexer-overview.md, section 4)
// ---------------------------------------------------------------------------------------------
type CursorCheckRow = {
  chain_id: number
  contract: string
  from_block: number
  indexed_block: number
  synced_at: string | null
  holders: number
}

async function cursorRow(cid: string): Promise<CursorCheckRow | null> {
  const { data, error } = await admin
    .from('indexer_cursors')
    .select('chain_id, contract, from_block, indexed_block, synced_at, holders')
    .eq('collection_id', cid)
    .maybeSingle()
  if (error) throw new Error(`cursor: ${describe(error as DbError)}`)
  return data as CursorCheckRow | null
}

/** Every row the indexer keeps for a collection, as the service role reads them, as one string to compare. */
async function indexedRows(cid: string): Promise<string> {
  const read = async (table: string, columns: string, order: string) => {
    const { data, error } = await admin.from(table).select(columns).eq('collection_id', cid).order(order)
    if (error) throw new Error(`${table}: ${describe(error as DbError)}`)
    return data
  }
  return JSON.stringify([
    await read(
      'mints',
      'tx_hash, log_index, block, block_time, recipient, vault, group_id, amount, first_token_id',
      'tx_hash',
    ),
    await read('token_owners', 'token_id, owner, block, log_index', 'token_id'),
    await read(
      'airdrops',
      'tx_hash, kind, recipients, tokens, fee_paid_wei::text, first_token_id, last_token_id, block, sent_by, block_time',
      'tx_hash',
    ),
    await read(
      'airdrop_recipients',
      'tx_hash, first_token_id, recipient, tokens, block, block_time',
      'first_token_id',
    ),
    await read('withdrawals', 'tx_hash, amount_wei::text, payout_address, block', 'tx_hash'),
    await cursorRow(cid),
  ])
}

const GAP_SENTENCE = 'The indexer would skip blocks.'
const CHAIN_SENTENCE = 'A collection is not indexed on this chain.'
const OUTSIDE_SENTENCE = 'A record names a collection outside this write.'
/** A transaction the indexer's records name. */
const INDEX_TX = (n: number) => `0x${HEX64(0x1d3e_0000 + n)}`
/** A holder the records name. */
const HOLDER = (n: number) => ADDRESS40(0x401d_0000 + n)
const DEAD_ADDRESS = '0x000000000000000000000000000000000000dead'
/** A test block's time in Unix seconds, the moment `blockTime` (9k) writes as ISO. */
const blockSeconds = (block: number) => 1_793_491_200 + block
/** Two times as the same moment, whatever their format. */
const sameTime = (a: string | null | undefined, b: string) => !!a && Date.parse(a) === Date.parse(b)

type IndexRecords = {
  mints?: Record<string, unknown>[]
  owners?: Record<string, unknown>[]
  airdrops?: Record<string, unknown>[]
  withdrawals?: Record<string, unknown>[]
}

const recordWrite = (
  collections: string[],
  from: number,
  to: number,
  records: IndexRecords,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  p_chain_id: 31337,
  p_from_block: from,
  p_to_block: to,
  p_synced_at: null,
  p_collections: collections,
  p_records: records,
  ...overrides,
})

const mintRecord = (cid: string, n: number, block: number, overrides: Record<string, unknown> = {}) => ({
  collectionId: cid,
  tx: INDEX_TX(n),
  logIndex: 3,
  block,
  blockTime: blockSeconds(block),
  recipient: HOLDER(1),
  vault: null,
  groupId: 0,
  amount: 1,
  firstTokenId: 1,
  ...overrides,
})

const ownerRecord = (cid: string, tokenId: number, owner: string, block: number, logIndex = 0) => ({
  collectionId: cid,
  tokenId,
  owner,
  block,
  logIndex,
})

/** A mints row as a client would insert it. */
const mintRecordRow = (cid: string) => ({
  log_index: 0,
  collection_id: cid,
  block: 1,
  block_time: blockTime(1),
  recipient: HOLDER(1),
  group_id: 0,
  amount: 1,
  first_token_id: 1,
})

async function artIndexer(A: Creator, B: Creator): Promise<void> {
  const payer = A.account.address.toLowerCase()
  // Two collections recorded as deployed on 31337 as 9k records one, a third on Base, and a draft.
  const deployedOn = async (tag: number, n: number, chainId: number) => {
    const { cid } = await renderedFixture(A, payer, tag)
    const recorded = await callArt(
      admin,
      'collection_record_deploy',
      recordArgs(A.userId, cid, payer, n, { p_chain_id: chainId }),
    )
    if (recorded.error) throw new Error(`setup: record: ${describe(recorded.error)}`)
    return cid
  }
  const first = await deployedOn(191, 16, 31337)
  const second = await deployedOn(192, 17, 31337)
  const onBase = await deployedOn(193, 18, 8453)
  const draft = await insertCollection(A.client)
  if (!draft.row) throw new Error(`setup: ${describe(draft.error)}`)
  const draftId = draft.row.id
  const indexer = (client: SupabaseClient, fn: string, args: Record<string, unknown>) =>
    callArt(client, fn, args)

  await check(
    "indexer functions: a signed-out caller and the owner's session cannot execute indexer_targets, indexer_start, indexer_record or indexer_summaries",
    async () => {
      const problems: string[] = []
      for (const [label, client] of [
        ['anon', anon],
        ['owner', A.client],
      ] as const)
        for (const [fn, args] of [
          ['indexer_targets', { p_chain_id: 31337 }],
          ['indexer_start', { p_collection_id: first, p_from_block: 100 }],
          ['indexer_record', recordWrite([first], 100, 101, {})],
          ['indexer_summaries', { p_chain_id: 31337 }],
        ] as const) {
          const { error } = await indexer(client, fn, args)
          const problem = expectError(error, PERMISSION)
          if (problem) problems.push(`${label} ${fn}: ${problem}`)
        }
      if (problems.length) return problems.join('; ')
      return (await cursorRow(first)) === null ? null : 'a cursor was written'
    },
  )

  await check(
    "indexer_targets: the service role reads the chain's deployed collections with their contract, deploy transaction and cursor, and no draft or collection of another chain",
    async () => {
      const { data, error } = await indexer(admin, 'indexer_targets', { p_chain_id: 31337 })
      if (error) return describe(error)
      const targets = data as Record<string, unknown>[]
      const ids = targets.map((target) => target.collectionId)
      const want = (cid: string, n: number) => ({
        collectionId: cid,
        contract: ADDRESS40(n),
        deployTx: `0x${HEX64(2000 + n)}`,
        fromBlock: null,
        indexedBlock: null,
        syncedAt: null,
      })
      const problems: string[] = []
      for (const [cid, n] of [
        [first, 16],
        [second, 17],
      ] as const) {
        const target = targets.find((entry) => entry.collectionId === cid)
        if (sortedJson(target) !== sortedJson(want(cid, n))) problems.push(`target ${JSON.stringify(target)}`)
      }
      if (ids.indexOf(first) > ids.indexOf(second)) problems.push('not in deploy order')
      if (ids.includes(draftId) || ids.includes(onBase))
        problems.push('a draft or a Base collection is listed')
      const base = await indexer(admin, 'indexer_targets', { p_chain_id: 8453 })
      const baseIds = ((base.data ?? []) as Record<string, unknown>[]).map((target) => target.collectionId)
      if (!baseIds.includes(onBase)) problems.push('Base does not list its collection')
      return problems.length ? problems.join('; ') : null
    },
  )

  await check(
    'indexer_start: the cursor starts at the deploy block, indexed one below it, not synced, with 0 holders; a second start keeps the first; a collection without a deployment is refused',
    async () => {
      const started = await indexer(admin, 'indexer_start', { p_collection_id: first, p_from_block: 100 })
      if (started.error) return `start: ${describe(started.error)}`
      const want = {
        collectionId: first,
        contract: ADDRESS40(16),
        deployTx: `0x${HEX64(2016)}`,
        fromBlock: 100,
        indexedBlock: 99,
        syncedAt: null,
      }
      if (sortedJson(started.data) !== sortedJson(want)) return `answer ${JSON.stringify(started.data)}`
      const again = await indexer(admin, 'indexer_start', { p_collection_id: first, p_from_block: 150 })
      if (again.error || sortedJson(again.data) !== sortedJson(want))
        return `second start: ${again.error ? describe(again.error) : JSON.stringify(again.data)}`
      const row = await cursorRow(first)
      const kept =
        row?.chain_id === 31337 &&
        row.contract === ADDRESS40(16) &&
        row.from_block === 100 &&
        row.indexed_block === 99 &&
        row.synced_at === null &&
        row.holders === 0
      if (!kept) return `cursor ${JSON.stringify(row)}`
      const refused = await indexer(admin, 'indexer_start', { p_collection_id: draftId, p_from_block: 1 })
      return expectSentence(refused.error, CHECK, NOT_DEPLOYED_SENTENCE)
    },
  )
  for (const [cid, block] of [
    [second, 100],
    [onBase, 100],
  ] as const) {
    const started = await indexer(admin, 'indexer_start', { p_collection_id: cid, p_from_block: block })
    if (started.error) throw new Error(`setup: start: ${describe(started.error)}`)
  }

  // Two mints (the second delegated), the six owners they and an airdrop leave, the airdrop with its two runs and
  // a withdrawal, from block 100 to 120.
  const firstWrite = recordWrite(
    [first],
    100,
    120,
    {
      mints: [
        mintRecord(first, 1, 110, { amount: 2, firstTokenId: 1 }),
        mintRecord(first, 2, 115, {
          logIndex: 2,
          recipient: HOLDER(2),
          vault: HOLDER(9),
          groupId: 1,
          firstTokenId: 3,
        }),
      ],
      owners: [
        ownerRecord(first, 1, HOLDER(1), 110, 1),
        ownerRecord(first, 2, HOLDER(1), 110, 2),
        ownerRecord(first, 3, HOLDER(2), 115, 1),
        ownerRecord(first, 4, HOLDER(3), 118, 0),
        ownerRecord(first, 5, HOLDER(3), 118, 1),
        ownerRecord(first, 6, HOLDER(4), 118, 2),
      ],
      airdrops: [
        {
          collectionId: first,
          tx: INDEX_TX(3),
          block: 118,
          blockTime: blockSeconds(118),
          kind: 'airdrop',
          recipients: 2,
          tokens: 3,
          feePaidWei: '150000000000000',
          firstTokenId: 4,
          lastTokenId: 6,
          runs: [
            { recipient: HOLDER(3), tokens: 2, firstTokenId: 4 },
            { recipient: HOLDER(4), tokens: 1, firstTokenId: 6 },
          ],
        },
      ],
      withdrawals: [
        {
          collectionId: first,
          tx: INDEX_TX(4),
          block: 119,
          payoutAddress: payer,
          amountWei: '2000000000000000',
        },
      ],
    },
    { p_synced_at: blockTime(120) },
  )
  const firstAnswer = {
    [first]: {
      collectionId: first,
      contract: ADDRESS40(16),
      holders: 4,
      syncedAt: blockSeconds(120),
      recentMints: [
        {
          tx: INDEX_TX(2),
          recipient: HOLDER(2),
          groupId: 1,
          amount: 1,
          firstTokenId: 3,
          blockTime: blockSeconds(115),
        },
        {
          tx: INDEX_TX(1),
          recipient: HOLDER(1),
          groupId: 0,
          amount: 2,
          firstTokenId: 1,
          blockTime: blockSeconds(110),
        },
      ],
    },
  }

  await check(
    "indexer_record: mints, owners, an airdrop with its recipients and a withdrawal are recorded, the cursor moves to the range's end with its synced time, and the answer carries the holders and the mints newest first",
    async () => {
      const written = await indexer(admin, 'indexer_record', firstWrite)
      if (written.error) return `write: ${describe(written.error)}`
      if (sortedJson(written.data) !== sortedJson(firstAnswer))
        return `answer ${JSON.stringify(written.data)}`
      const problems: string[] = []
      const mints = await admin
        .from('mints')
        .select('tx_hash, log_index, block, block_time, recipient, vault, group_id, amount, first_token_id')
        .eq('collection_id', first)
        .order('block')
      const delegated = mints.data?.[1]
      if (
        mints.error ||
        mints.data.length !== 2 ||
        delegated?.vault !== HOLDER(9) ||
        delegated.recipient !== HOLDER(2) ||
        !sameTime(delegated.block_time, blockTime(115))
      )
        problems.push(`mints ${mints.error ? describe(mints.error as DbError) : JSON.stringify(mints.data)}`)
      if ((await countRows('token_owners', 'collection_id', first)) !== 6) problems.push('not six owners')
      const drops = await airdropRows(first)
      if (drops.length !== 1 || drops[0]?.kind !== 'airdrop' || drops[0].fee_paid_wei !== '150000000000000')
        problems.push(`airdrops ${JSON.stringify(drops)}`)
      if ((await countRows('airdrop_recipients', 'tx_hash', INDEX_TX(3))) !== 2) problems.push('not two runs')
      const withdrawals = await withdrawalRows(first)
      if (withdrawals.length !== 1 || withdrawals[0]?.amount_wei !== '2000000000000000')
        problems.push(`withdrawals ${JSON.stringify(withdrawals)}`)
      const row = await cursorRow(first)
      if (row?.indexed_block !== 120 || !sameTime(row.synced_at, blockTime(120)) || row.holders !== 4)
        problems.push(`cursor ${JSON.stringify(row)}`)
      return problems.length ? problems.join('; ') : null
    },
  )

  await check(
    'indexer_record: the same write again changes no row and answers the same; a range that would skip blocks, a collection of another chain and a record naming a collection outside the write are refused',
    async () => {
      const before = await indexedRows(first)
      const again = await indexer(admin, 'indexer_record', firstWrite)
      if (again.error) return `again: ${describe(again.error)}`
      if (sortedJson(again.data) !== sortedJson(firstAnswer)) return `answer ${JSON.stringify(again.data)}`
      if ((await indexedRows(first)) !== before) return 'the same write changed a row'
      const refused = refusedAll([
        [
          'a gap',
          (await indexer(admin, 'indexer_record', recordWrite([first], 122, 125, {}))).error,
          CHECK,
          GAP_SENTENCE,
        ],
        [
          'a range ending before it starts',
          (await indexer(admin, 'indexer_record', recordWrite([first], 121, 120, {}))).error,
          CHECK,
          GAP_SENTENCE,
        ],
        [
          'a collection of another chain',
          (await indexer(admin, 'indexer_record', recordWrite([onBase], 101, 102, {}))).error,
          CHECK,
          CHAIN_SENTENCE,
        ],
        [
          'a record outside the write',
          (
            await indexer(
              admin,
              'indexer_record',
              recordWrite([first], 121, 122, { mints: [mintRecord(second, 5, 121)] }),
            )
          ).error,
          CHECK,
          OUTSIDE_SENTENCE,
        ],
      ])
      if (refused) return refused
      return (await indexedRows(first)) === before ? null : 'a refused write changed a row'
    },
  )

  await check(
    'token_owners: an older transfer of a token is ignored and a newer one wins; holders count distinct owners without the dead address',
    async () => {
      const written = await indexer(
        admin,
        'indexer_record',
        recordWrite([first], 121, 130, {
          owners: [
            ownerRecord(first, 1, HOLDER(5), 125),
            ownerRecord(first, 2, HOLDER(6), 105),
            ownerRecord(first, 7, DEAD_ADDRESS, 126),
          ],
        }),
      )
      if (written.error) return `write: ${describe(written.error)}`
      const { data, error } = await admin
        .from('token_owners')
        .select('token_id, owner')
        .eq('collection_id', first)
        .order('token_id')
      if (error) return describe(error as DbError)
      const owners = data.map((row) => `${row.token_id}:${row.owner}`).join(' ')
      const want = [HOLDER(5), HOLDER(1), HOLDER(2), HOLDER(3), HOLDER(3), HOLDER(4), DEAD_ADDRESS]
        .map((owner, index) => `${index + 1}:${owner}`)
        .join(' ')
      if (owners !== want) return `owners ${owners}`
      const row = await cursorRow(first)
      // Five holders: the dead address is not one, and a write without a synced time keeps the last.
      return row?.holders === 5 && row.indexed_block === 130 && sameTime(row.synced_at, blockTime(120))
        ? null
        : `cursor ${JSON.stringify(row)}`
    },
  )

  await check(
    'airdrops: a row the indexer writes has no sender and its block time; a row airdrop_record wrote keeps its sender and gains its block time; a transaction with two airdrops keeps the first and both recipient rows',
    async () => {
      const proven = await callArt(
        admin,
        'airdrop_record',
        dropArgs(A.userId, first, INDEX_TX(5), payer, {
          p_recipients: 1,
          p_tokens: 1,
          p_fee_paid_wei: '50000000000000',
          p_first_token_id: 8,
          p_last_token_id: 8,
          p_block: 135,
        }),
      )
      if (proven.error) return `airdrop_record: ${describe(proven.error)}`
      const written = await indexer(
        admin,
        'indexer_record',
        recordWrite([first], 131, 140, {
          owners: [ownerRecord(first, 8, HOLDER(6), 135)],
          airdrops: [
            {
              collectionId: first,
              tx: INDEX_TX(5),
              block: 135,
              blockTime: blockSeconds(135),
              kind: 'airdrop',
              recipients: 1,
              tokens: 1,
              feePaidWei: '50000000000000',
              firstTokenId: 8,
              lastTokenId: 8,
              runs: [{ recipient: HOLDER(6), tokens: 1, firstTokenId: 8 }],
            },
          ],
        }),
      )
      if (written.error) return `write: ${describe(written.error)}`
      const { data, error } = await admin
        .from('airdrops')
        .select('tx_hash, sent_by, block_time')
        .eq('collection_id', first)
        .order('block')
      if (error) return describe(error as DbError)
      const [read, proved] = data
      if (
        read?.tx_hash !== INDEX_TX(3) ||
        read.sent_by !== null ||
        !sameTime(read.block_time, blockTime(118))
      )
        return `the indexer's row ${JSON.stringify(read)}`
      if (proved?.sent_by !== payer || !sameTime(proved.block_time, blockTime(135)))
        return `airdrop_record's row ${JSON.stringify(proved)}`
      if ((await countRows('airdrop_recipients', 'tx_hash', INDEX_TX(5))) !== 1) return 'no recipient row'
      // A contract owner batching two airdropNFTs calls in one transaction (Review Focus 3): one airdrops row,
      // the first, and every recipient row.
      const twice = (firstTokenId: number, recipient: string) => ({
        collectionId: first,
        tx: INDEX_TX(7),
        block: 141,
        blockTime: blockSeconds(141),
        kind: 'airdrop',
        recipients: 1,
        tokens: 1,
        feePaidWei: '50000000000000',
        firstTokenId,
        lastTokenId: firstTokenId,
        runs: [{ recipient, tokens: 1, firstTokenId }],
      })
      const batched = await indexer(
        admin,
        'indexer_record',
        recordWrite([first], 141, 145, {
          owners: [ownerRecord(first, 9, HOLDER(7), 141, 1), ownerRecord(first, 10, HOLDER(8), 141, 3)],
          airdrops: [twice(9, HOLDER(7)), twice(10, HOLDER(8))],
        }),
      )
      if (batched.error) return `two airdrops in one transaction: ${describe(batched.error)}`
      const kept = await admin.from('airdrops').select('first_token_id').eq('tx_hash', INDEX_TX(7))
      if (kept.error || JSON.stringify(kept.data) !== JSON.stringify([{ first_token_id: 9 }]))
        return `two airdrops kept ${kept.error ? describe(kept.error as DbError) : JSON.stringify(kept.data)}`
      return (await countRows('airdrop_recipients', 'tx_hash', INDEX_TX(7))) === 2
        ? null
        : 'not both recipient rows'
    },
  )

  await check(
    'indexer_cursors, mints and airdrop_recipients: the owner reads its rows; B reads nothing; no client inserts, updates or deletes them',
    async () => {
      const before = await indexedRows(first)
      const problems: string[] = []
      for (const [table, rows, patch, row] of [
        [
          'indexer_cursors',
          1,
          { holders: 9 },
          {
            collection_id: draftId,
            chain_id: 31337,
            contract: ADDRESS40(0x1d),
            from_block: 1,
            indexed_block: 0,
          },
        ],
        ['mints', 2, { amount: 9 }, { ...mintRecordRow(draftId), tx_hash: INDEX_TX(6) }],
        [
          'airdrop_recipients',
          5,
          { tokens: 9 },
          {
            tx_hash: INDEX_TX(3),
            first_token_id: 9,
            collection_id: first,
            recipient: HOLDER(7),
            tokens: 1,
            block: 118,
            block_time: blockTime(118),
          },
        ],
      ] as const) {
        const own = await A.client.from(table).select().eq('collection_id', first)
        if (own.error || own.data.length !== rows)
          problems.push(`A reads ${table}: ${own.data?.length ?? describe(own.error as DbError)}`)
        const other = await B.client.from(table).select().eq('collection_id', first)
        const unseen = expectNothing(other.error as DbError, other.data)
        if (unseen) problems.push(`B reads ${table}: ${unseen}`)
        for (const [label, result] of [
          ['inserts', await A.client.from(table).insert(row).select()],
          ['updates', await A.client.from(table).update(patch).eq('collection_id', first).select()],
          ['deletes', await A.client.from(table).delete().eq('collection_id', first).select()],
        ] as const) {
          const refused = expectError(result.error as DbError, PERMISSION, result.data)
          if (refused) problems.push(`A ${label} ${table}: ${refused}`)
        }
      }
      if (problems.length) return problems.join('; ')
      return (await indexedRows(first)) === before ? null : 'a client changed a row'
    },
  )

  await check('token_owners: neither the owner nor B reads or writes it', async () => {
    const before = await indexedRows(first)
    const problems: string[] = []
    for (const [label, client] of [
      ['owner', A.client],
      ['B', B.client],
    ] as const) {
      const read = await client.from('token_owners').select().eq('collection_id', first)
      const unseen = expectNothing(read.error as DbError, read.data)
      if (unseen) problems.push(`${label} reads: ${unseen}`)
      for (const [what, result] of [
        [
          'inserts',
          await client
            .from('token_owners')
            .insert({ collection_id: first, token_id: 99, owner: HOLDER(8), block: 1, log_index: 0 })
            .select(),
        ],
        [
          'updates',
          await client
            .from('token_owners')
            .update({ owner: HOLDER(8) })
            .eq('collection_id', first)
            .select(),
        ],
        ['deletes', await client.from('token_owners').delete().eq('collection_id', first).select()],
      ] as const) {
        const refused = expectError(result.error as DbError, PERMISSION, result.data)
        if (refused) problems.push(`${label} ${what}: ${refused}`)
      }
    }
    if (problems.length) return problems.join('; ')
    return (await indexedRows(first)) === before ? null : 'a client changed an owner'
  })

  await check(
    'indexer_summaries: every cursor of the chain with its holders, synced time and at most 10 mints, newest first',
    async () => {
      // Twelve mints of one token each on the second collection, all to one holder, from block 101 to 112.
      const mints = Array.from({ length: 12 }, (_, index) =>
        mintRecord(second, 20 + index, 101 + index, { recipient: HOLDER(7), firstTokenId: index + 1 }),
      )
      const owners = mints.map((mint) => ownerRecord(second, mint.firstTokenId, HOLDER(7), mint.block, 1))
      const written = await indexer(
        admin,
        'indexer_record',
        recordWrite([second], 100, 112, { mints, owners }, { p_synced_at: blockTime(112) }),
      )
      if (written.error) return `write: ${describe(written.error)}`
      const { data, error } = await indexer(admin, 'indexer_summaries', { p_chain_id: 31337 })
      if (error) return describe(error)
      const summaries = data as {
        collectionId: string
        holders: number
        syncedAt: number | null
        recentMints: { tx: string }[]
      }[]
      const cursors = await admin.from('indexer_cursors').select('collection_id').eq('chain_id', 31337)
      if (cursors.error) return describe(cursors.error as DbError)
      const listed = summaries.map((entry) => entry.collectionId).sort()
      const all = cursors.data.map((row) => row.collection_id as string).sort()
      if (JSON.stringify(listed) !== JSON.stringify(all))
        return `listed ${listed.length} of ${all.length} cursors`
      if (listed.includes(onBase)) return 'the Base cursor is listed'
      const one = summaries.find((entry) => entry.collectionId === first)
      if (one?.holders !== 8 || one.syncedAt !== blockSeconds(120) || one.recentMints.length !== 2)
        return `first ${JSON.stringify(one)}`
      const two = summaries.find((entry) => entry.collectionId === second)
      const newest = mints
        .slice(2)
        .reverse()
        .map((mint) => mint.tx)
      return two?.holders === 1 &&
        two.syncedAt === blockSeconds(112) &&
        JSON.stringify(two.recentMints.map((mint) => mint.tx)) === JSON.stringify(newest)
        ? null
        : `second ${JSON.stringify(two)}`
    },
  )
}

// ---------------------------------------------------------------------------------------------
// 10. Cleanup
// ---------------------------------------------------------------------------------------------
```

- [ ] **Step 2: Run the checks to see them fail**

Run: `pnpm --filter @cobweb/web verify:local`
Expected: FAIL. The four anon checks pass (an unknown table reads nothing), the first three checks of section 9o fail on the missing functions, and the setup after them stops the run: the output ends `FAIL run: setup: start: PGRST202 Could not find the function public.indexer_start(p_collection_id, p_from_block) in the schema cache` and `384 passed, 4 failed`.

- [ ] **Step 3: The migration**

The four tables and their policies, the `airdrops` changes, then the two private helpers the four functions share (Decision 5) and the functions. `indexer_record` keeps one airdrop per transaction and one owner record per token before its inserts (Decision 6).

Create `supabase/migrations/20261016200000_indexer.sql`:

```sql
-- The indexer and the Overview (docs/specs/2026-10-16-indexer-overview.md, section 4): indexer_cursors, one row per
-- deployed collection the freshness server's indexer reads, with how far every log is recorded and the holders;
-- mints, token_owners and airdrop_recipients, what the indexer read from each collection's logs; airdrops and
-- withdrawals take the indexer's rows beside the ones Cobweb proves (airdrops.sent_by nullable, a new block_time);
-- and the four service-role functions indexer_targets, indexer_start, indexer_record and indexer_summaries, which
-- answer jsonb since PostgREST caps a set of rows at max_rows. The owner reads indexer_cursors, mints and
-- airdrop_recipients; token_owners is read by no client; no client writes any of them.

-- ---------------------------------------------------------------------------------------------
-- The new tables
-- ---------------------------------------------------------------------------------------------
create table public.indexer_cursors (
  collection_id uuid primary key references public.collections (id) on delete cascade,
  chain_id integer not null check (chain_id > 0),
  contract text not null check (contract ~ '^0x[0-9a-f]{40}$'),
  from_block bigint not null check (from_block >= 0),
  indexed_block bigint not null,
  synced_at timestamptz,
  holders integer not null default 0 check (holders >= 0),
  updated_at timestamptz not null default now(),
  constraint indexer_cursors_block check (indexed_block >= from_block - 1),
  unique (chain_id, contract)
);

comment on table public.indexer_cursors is
  'One row per deployed collection the indexer reads: every log at or below indexed_block is recorded. synced_at is the chain''s time at the last pass that read the collection to the chain''s confirmation depth, null before the first. holders counts the distinct owners in token_owners other than the dead address. Written only by indexer_start and indexer_record.';

create table public.mints (
  tx_hash text not null check (tx_hash ~ '^0x[0-9a-f]{64}$'),
  log_index integer not null check (log_index >= 0),
  collection_id uuid not null references public.collections (id) on delete cascade,
  block bigint not null check (block >= 0),
  block_time timestamptz not null,
  recipient text not null check (recipient ~ '^0x[0-9a-f]{40}$'),
  vault text check (vault ~ '^0x[0-9a-f]{40}$'),
  group_id bigint not null check (group_id between 0 and 9007199254740991),
  amount integer not null check (amount >= 1),
  first_token_id bigint not null check (first_token_id >= 1),
  primary key (tx_hash, log_index)
);
create index mints_collection_recent_idx on public.mints (collection_id, block desc, log_index desc);

comment on table public.mints is
  'One row per TokensMinted or TokensDelegateMinted log, at the chain''s confirmation depth: the receiver of the tokens, the vault whose allowance a delegated mint used, the group, the amount and the first of its consecutive token ids. Written only by indexer_record.';

create table public.token_owners (
  collection_id uuid not null references public.collections (id) on delete cascade,
  token_id bigint not null check (token_id >= 1),
  owner text not null check (owner ~ '^0x[0-9a-f]{40}$'),
  block bigint not null check (block >= 0),
  log_index integer not null check (log_index >= 0),
  primary key (collection_id, token_id)
);
create index token_owners_owner_idx on public.token_owners (collection_id, owner);

comment on table public.token_owners is
  'Each minted token''s owner after the latest Transfer log at the chain''s confirmation depth. Read by no client; written only by indexer_record.';

create table public.airdrop_recipients (
  tx_hash text not null references public.airdrops (tx_hash) on delete cascade,
  first_token_id bigint not null check (first_token_id >= 1),
  collection_id uuid not null references public.collections (id) on delete cascade,
  recipient text not null check (recipient ~ '^0x[0-9a-f]{40}$'),
  tokens integer not null check (tokens >= 1),
  block bigint not null check (block >= 0),
  block_time timestamptz not null,
  primary key (tx_hash, first_token_id)
);
create index airdrop_recipients_collection_idx on public.airdrop_recipients (collection_id, block desc, first_token_id);

comment on table public.airdrop_recipients is
  'One row per run of consecutive token ids an airdropNFTs transaction minted to one address, from its Transfer logs. Written only by indexer_record.';

-- indexer_cursors, mints and airdrop_recipients: the owner reads; no client role writes (the revokes undo
-- Supabase's default grants on a new table).
alter table public.indexer_cursors enable row level security;
create policy "indexer_cursors: owner reads" on public.indexer_cursors
for select to authenticated
using ((select private.collection_owned(collection_id)));
revoke all on public.indexer_cursors from anon, authenticated;
grant select on public.indexer_cursors to authenticated;

alter table public.mints enable row level security;
create policy "mints: owner reads" on public.mints
for select to authenticated
using ((select private.collection_owned(collection_id)));
revoke all on public.mints from anon, authenticated;
grant select on public.mints to authenticated;

alter table public.airdrop_recipients enable row level security;
create policy "airdrop_recipients: owner reads" on public.airdrop_recipients
for select to authenticated
using ((select private.collection_owned(collection_id)));
revoke all on public.airdrop_recipients from anon, authenticated;
grant select on public.airdrop_recipients to authenticated;

-- token_owners: no policy and no grant; only the definer functions below read it.
alter table public.token_owners enable row level security;
revoke all on public.token_owners from anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- airdrops and withdrawals: the indexer's rows beside Cobweb's
-- ---------------------------------------------------------------------------------------------
alter table public.airdrops alter column sent_by drop not null;
alter table public.airdrops add column block_time timestamptz;

comment on table public.airdrops is
  'One row per airdropNFTs transaction: proven by Cobweb from its receipt and calldata (airdrop_record) or read from its logs by the indexer (indexer_record), whichever lands first. kind is burn when the only recipient is the dead address. sent_by is null for a row the indexer wrote, since logs do not name the sender; block_time is the block''s time, set by the indexer.';
comment on table public.withdrawals is
  'One row per withdrawMintFunds transaction, with the amount and payout address of its MintFundsWithdrawn log: proven by Cobweb from its receipt (withdrawal_record) or read from the log by the indexer (indexer_record), whichever lands first.';

-- ---------------------------------------------------------------------------------------------
-- What the functions answer, built once: a target and a summary
-- ---------------------------------------------------------------------------------------------
-- A deployed collection as the indexer reads it: { collectionId, contract, deployTx, fromBlock, indexedBlock,
-- syncedAt }, the last three null without a cursor, syncedAt in Unix seconds. Revoked from every client role: the
-- definer functions below call it.
create function private.indexer_target(p_collection_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'collectionId', c.id,
    'contract', d.contract_address,
    'deployTx', d.tx_hash,
    'fromBlock', k.from_block,
    'indexedBlock', k.indexed_block,
    'syncedAt', floor(extract(epoch from k.synced_at))::bigint
  )
  from public.collections c
  join public.deployments d on d.collection_id = c.id
  left join public.indexer_cursors k on k.collection_id = c.id
  where c.id = p_collection_id;
$$;

-- A cursor's summary: { collectionId, contract, holders, syncedAt, recentMints }, its 10 latest mints by block then
-- log index, newest first, each { tx, recipient, groupId, amount, firstTokenId, blockTime }, times in Unix seconds.
create function private.indexer_summary(p_collection_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'collectionId', k.collection_id,
    'contract', k.contract,
    'holders', k.holders,
    'syncedAt', floor(extract(epoch from k.synced_at))::bigint,
    'recentMints', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'tx', m.tx_hash, 'recipient', m.recipient, 'groupId', m.group_id, 'amount', m.amount,
            'firstTokenId', m.first_token_id, 'blockTime', floor(extract(epoch from m.block_time))::bigint
          )
          order by m.block desc, m.log_index desc
        )
        from (
          select * from public.mints latest
          where latest.collection_id = k.collection_id
          order by latest.block desc, latest.log_index desc
          limit 10
        ) m
      ),
      '[]'::jsonb
    )
  )
  from public.indexer_cursors k
  where k.collection_id = p_collection_id;
$$;

revoke all on function private.indexer_target(uuid) from public, anon, authenticated;
revoke all on function private.indexer_summary(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- indexer_targets: what the indexer reads on a chain
-- ---------------------------------------------------------------------------------------------
-- Service role only. Every collection deployed with a deployments row on the chain, oldest deploy first, with its
-- cursor when it has one.
create function public.indexer_targets(p_chain_id integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(private.indexer_target(c.id) order by d.deployed_at, c.id), '[]'::jsonb)
  from public.collections c
  join public.deployments d on d.collection_id = c.id
  where c.status = 'deployed' and d.chain_id = p_chain_id;
$$;

revoke all on function public.indexer_targets(integer) from public, anon, authenticated;
grant execute on function public.indexer_targets(integer) to service_role;

-- ---------------------------------------------------------------------------------------------
-- indexer_start: a collection's cursor, at its deploy block
-- ---------------------------------------------------------------------------------------------
-- Service role only. The cursor takes the deployment's chain and contract, starts at p_from_block (the deploy
-- transaction's block, which the indexer reads from its receipt) and is indexed one below it. A cursor already
-- there is kept as it is. Answers the cursor as indexer_targets lists it.
create function public.indexer_start(p_collection_id uuid, p_from_block bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deployment public.deployments;
begin
  select d.* into v_deployment
  from public.deployments d
  where d.collection_id = p_collection_id;
  if not found then
    raise exception 'The contract is not deployed yet.' using errcode = '23514';
  end if;
  insert into public.indexer_cursors (collection_id, chain_id, contract, from_block, indexed_block)
  values (p_collection_id, v_deployment.chain_id, v_deployment.contract_address, p_from_block, p_from_block - 1)
  on conflict (collection_id) do nothing;
  return private.indexer_target(p_collection_id);
end;
$$;

revoke all on function public.indexer_start(uuid, bigint) from public, anon, authenticated;
grant execute on function public.indexer_start(uuid, bigint) to service_role;

-- ---------------------------------------------------------------------------------------------
-- indexer_record: one segment of one scan, in one transaction
-- ---------------------------------------------------------------------------------------------
-- Service role only. p_records is { mints, owners, airdrops, withdrawals } (docs/specs/2026-10-16-indexer-overview.md,
-- section 4.3), addresses lowercase, times in Unix seconds. The cursors are locked in id order, so two writers never
-- deadlock; a write that would leave a gap below p_from_block, or names a collection outside p_collections, is
-- refused. Every row is keyed so that a log read twice, a range read again and two writers at once leave one row
-- each: a mint by its transaction and log index, an airdrop and a withdrawal by their transaction (the first row
-- wins, Cobweb's or the indexer's; a transaction's first airdrop when it holds two), a recipient row by its
-- transaction and first token id, and a token's owner changes only for a later block and log index. Answers
-- { "<collection id>": <summary> } for each collection a record names.
create function public.indexer_record(
  p_chain_id integer,
  p_from_block bigint,
  p_to_block bigint,
  p_synced_at timestamptz,
  p_collections uuid[],
  p_records jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_records jsonb := coalesce(p_records, '{}'::jsonb);
  v_wanted integer;
  v_found integer;
begin
  perform 1
  from public.indexer_cursors k
  where k.collection_id = any(p_collections)
  order by k.collection_id
  for update;
  select count(distinct c.id) into v_wanted from unnest(p_collections) as c(id);
  select count(*) into v_found
  from public.indexer_cursors k
  where k.collection_id = any(p_collections) and k.chain_id = p_chain_id;
  if p_collections is null or v_found <> v_wanted then
    raise exception 'A collection is not indexed on this chain.' using errcode = '23514';
  end if;
  if p_from_block is null or p_to_block is null or p_to_block < p_from_block or exists (
    select 1 from public.indexer_cursors k
    where k.collection_id = any(p_collections) and k.indexed_block < p_from_block - 1
  ) then
    raise exception 'The indexer would skip blocks.' using errcode = '23514';
  end if;
  if exists (
    select 1 from jsonb_path_query(v_records, '$.*[*].collectionId') as r(id)
    where (r.id #>> '{}')::uuid <> all(p_collections)
  ) then
    raise exception 'A record names a collection outside this write.' using errcode = '23514';
  end if;

  insert into public.mints (
    tx_hash, log_index, collection_id, block, block_time, recipient, vault, group_id, amount, first_token_id
  )
  select m.tx, m."logIndex", m."collectionId", m.block, to_timestamp(m."blockTime"), m.recipient, m.vault,
    m."groupId", m.amount, m."firstTokenId"
  from jsonb_to_recordset(coalesce(v_records->'mints', '[]'::jsonb)) as m(
    tx text, "logIndex" integer, "collectionId" uuid, block bigint, "blockTime" bigint, recipient text, vault text,
    "groupId" bigint, amount integer, "firstTokenId" bigint
  )
  on conflict do nothing;

  insert into public.token_owners as t (collection_id, token_id, owner, block, log_index)
  select distinct on (o."collectionId", o."tokenId") o."collectionId", o."tokenId", o.owner, o.block, o."logIndex"
  from jsonb_to_recordset(coalesce(v_records->'owners', '[]'::jsonb)) as o(
    "collectionId" uuid, "tokenId" bigint, owner text, block bigint, "logIndex" integer
  )
  order by o."collectionId", o."tokenId", o.block desc, o."logIndex" desc
  on conflict (collection_id, token_id) do update
  set owner = excluded.owner, block = excluded.block, log_index = excluded.log_index
  where (t.block, t.log_index) < (excluded.block, excluded.log_index);

  insert into public.airdrops as a (
    tx_hash, collection_id, kind, recipients, tokens, fee_paid_wei, first_token_id, last_token_id, block, sent_by,
    block_time
  )
  select distinct on (r.tx) r.tx, r."collectionId", r.kind, r.recipients, r.tokens, r."feePaidWei",
    r."firstTokenId", r."lastTokenId", r.block, null, to_timestamp(r."blockTime")
  from jsonb_to_recordset(coalesce(v_records->'airdrops', '[]'::jsonb)) as r(
    tx text, "collectionId" uuid, block bigint, "blockTime" bigint, kind text, recipients integer, tokens integer,
    "feePaidWei" numeric, "firstTokenId" bigint, "lastTokenId" bigint
  )
  order by r.tx, r."firstTokenId"
  on conflict (tx_hash) do update
  set block_time = excluded.block_time
  where a.block_time is null;

  insert into public.airdrop_recipients (tx_hash, first_token_id, collection_id, recipient, tokens, block, block_time)
  select r.tx, run."firstTokenId", r."collectionId", run.recipient, run.tokens, r.block, to_timestamp(r."blockTime")
  from jsonb_to_recordset(coalesce(v_records->'airdrops', '[]'::jsonb)) as r(
    tx text, "collectionId" uuid, block bigint, "blockTime" bigint, runs jsonb
  )
  cross join lateral jsonb_to_recordset(coalesce(r.runs, '[]'::jsonb)) as run(
    recipient text, tokens integer, "firstTokenId" bigint
  )
  on conflict do nothing;

  insert into public.withdrawals (tx_hash, collection_id, amount_wei, payout_address, block)
  select w.tx, w."collectionId", w."amountWei", w."payoutAddress", w.block
  from jsonb_to_recordset(coalesce(v_records->'withdrawals', '[]'::jsonb)) as w(
    tx text, "collectionId" uuid, block bigint, "payoutAddress" text, "amountWei" numeric
  )
  on conflict do nothing;

  update public.indexer_cursors k
  set holders = (
    select count(distinct o.owner)
    from public.token_owners o
    where o.collection_id = k.collection_id and o.owner <> '0x000000000000000000000000000000000000dead'
  )
  where k.collection_id in (
    select o."collectionId"
    from jsonb_to_recordset(coalesce(v_records->'owners', '[]'::jsonb)) as o("collectionId" uuid)
  );

  update public.indexer_cursors k
  set indexed_block = greatest(k.indexed_block, p_to_block),
      synced_at = greatest(k.synced_at, p_synced_at),
      updated_at = now()
  where k.collection_id = any(p_collections);

  return (
    select coalesce(jsonb_object_agg(named.id::text, private.indexer_summary(named.id)), '{}'::jsonb)
    from (
      select distinct (r.id #>> '{}')::uuid as id
      from jsonb_path_query(v_records, '$.*[*].collectionId') as r(id)
    ) as named
  );
end;
$$;

revoke all on function public.indexer_record(integer, bigint, bigint, timestamptz, uuid[], jsonb)
  from public, anon, authenticated;
grant execute on function public.indexer_record(integer, bigint, bigint, timestamptz, uuid[], jsonb) to service_role;

-- ---------------------------------------------------------------------------------------------
-- indexer_summaries: every cursor of a chain as indexer_record answers it
-- ---------------------------------------------------------------------------------------------
-- Service role only: what the freshness server loads at start, so the state body carries the holders and the
-- latest mints from its memory.
create function public.indexer_summaries(p_chain_id integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(private.indexer_summary(k.collection_id) order by k.collection_id), '[]'::jsonb)
  from public.indexer_cursors k
  where k.chain_id = p_chain_id;
$$;

revoke all on function public.indexer_summaries(integer) from public, anon, authenticated;
grant execute on function public.indexer_summaries(integer) to service_role;
```

- [ ] **Step 4: Apply the migration**

Run: `supabase migration up --local`
Expected: `Applying migration 20261016200000_indexer.sql...` and `Migrations applied`.

Should the migration have to be undone on the local database (to apply a corrected file, for instance), this SQL does it; pipe it to `docker exec -i supabase_db_cobweb psql -U postgres -v ON_ERROR_STOP=1` from the repo root, then apply the migration again with `supabase migration up --local`. It deletes the airdrop rows only the indexer wrote, which have no sender, and keeps the withdrawals the indexer read, which the earlier schema reads as Cobweb's.

```sql
begin;
drop function public.indexer_summaries(integer);
drop function public.indexer_record(integer, bigint, bigint, timestamptz, uuid[], jsonb);
drop function public.indexer_start(uuid, bigint);
drop function public.indexer_targets(integer);
drop function private.indexer_summary(uuid);
drop function private.indexer_target(uuid);
drop table public.airdrop_recipients;
drop table public.token_owners;
drop table public.mints;
drop table public.indexer_cursors;
-- The airdrops only the indexer recorded have no sender; they go before the column is required again.
delete from public.airdrops where sent_by is null;
alter table public.airdrops drop column block_time;
alter table public.airdrops alter column sent_by set not null;
comment on table public.airdrops is
  'One row per airdropNFTs transaction Cobweb proved from its receipt and calldata, written only by airdrop_record. kind is burn when the only recipient is the dead address. Airdrops sent outside Cobweb are not here.';
comment on table public.withdrawals is
  'One row per withdrawMintFunds transaction Cobweb proved from its receipt, with the amount and payout address of its MintFundsWithdrawn event, written only by withdrawal_record. Withdrawals made outside Cobweb are not here.';
delete from supabase_migrations.schema_migrations where version = '20261016200000';
commit;
```

- [ ] **Step 5: The types**

The tables in the generator's order and form (checked against `supabase gen types typescript --local`), the functions' arguments as the generator writes them.

In `apps/web/src/lib/database.types.ts`, replace:

```ts
  public: {
    Tables: {
      airdrops: {
        Row: {
          block: number
          collection_id: string
          confirmed_at: string
```

with:

```ts
  public: {
    Tables: {
      airdrop_recipients: {
        Row: {
          block: number
          block_time: string
          collection_id: string
          first_token_id: number
          recipient: string
          tokens: number
          tx_hash: string
        }
        Insert: {
          block: number
          block_time: string
          collection_id: string
          first_token_id: number
          recipient: string
          tokens: number
          tx_hash: string
        }
        Update: {
          block?: number
          block_time?: string
          collection_id?: string
          first_token_id?: number
          recipient?: string
          tokens?: number
          tx_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: 'airdrop_recipients_collection_id_fkey'
            columns: ['collection_id']
            isOneToOne: false
            referencedRelation: 'collections'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'airdrop_recipients_tx_hash_fkey'
            columns: ['tx_hash']
            isOneToOne: false
            referencedRelation: 'airdrops'
            referencedColumns: ['tx_hash']
          },
        ]
      }
      airdrops: {
        Row: {
          block: number
          block_time: string | null
          collection_id: string
          confirmed_at: string
```

In `apps/web/src/lib/database.types.ts`, replace:

```ts
          last_token_id: number
          recipients: number
          sent_by: string
          tokens: number
          tx_hash: string
        }
        Insert: {
          block: number
          collection_id: string
          confirmed_at?: string
```

with:

```ts
          last_token_id: number
          recipients: number
          sent_by: string | null
          tokens: number
          tx_hash: string
        }
        Insert: {
          block: number
          block_time?: string | null
          collection_id: string
          confirmed_at?: string
```

In `apps/web/src/lib/database.types.ts`, replace:

```ts
          last_token_id: number
          recipients: number
          sent_by: string
          tokens: number
          tx_hash: string
        }
        Update: {
          block?: number
          collection_id?: string
          confirmed_at?: string
```

with:

```ts
          last_token_id: number
          recipients: number
          sent_by?: string | null
          tokens: number
          tx_hash: string
        }
        Update: {
          block?: number
          block_time?: string | null
          collection_id?: string
          confirmed_at?: string
```

In `apps/web/src/lib/database.types.ts`, replace:

```ts
          last_token_id?: number
          recipients?: number
          sent_by?: string
          tokens?: number
          tx_hash?: string
```

with:

```ts
          last_token_id?: number
          recipients?: number
          sent_by?: string | null
          tokens?: number
          tx_hash?: string
```

In `apps/web/src/lib/database.types.ts`, replace:

```ts
        ]
      }
      layers: {
        Row: {
```

with:

```ts
        ]
      }
      indexer_cursors: {
        Row: {
          chain_id: number
          collection_id: string
          contract: string
          from_block: number
          holders: number
          indexed_block: number
          synced_at: string | null
          updated_at: string
        }
        Insert: {
          chain_id: number
          collection_id: string
          contract: string
          from_block: number
          holders?: number
          indexed_block: number
          synced_at?: string | null
          updated_at?: string
        }
        Update: {
          chain_id?: number
          collection_id?: string
          contract?: string
          from_block?: number
          holders?: number
          indexed_block?: number
          synced_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'indexer_cursors_collection_id_fkey'
            columns: ['collection_id']
            isOneToOne: true
            referencedRelation: 'collections'
            referencedColumns: ['id']
          },
        ]
      }
      layers: {
        Row: {
```

In `apps/web/src/lib/database.types.ts`, replace:

```ts
            foreignKeyName: 'mint_pages_collection_id_fkey'
            columns: ['collection_id']
            isOneToOne: true
            referencedRelation: 'collections'
            referencedColumns: ['id']
          },
```

with:

```ts
            foreignKeyName: 'mint_pages_collection_id_fkey'
            columns: ['collection_id']
            isOneToOne: true
            referencedRelation: 'collections'
            referencedColumns: ['id']
          },
        ]
      }
      mints: {
        Row: {
          amount: number
          block: number
          block_time: string
          collection_id: string
          first_token_id: number
          group_id: number
          log_index: number
          recipient: string
          tx_hash: string
          vault: string | null
        }
        Insert: {
          amount: number
          block: number
          block_time: string
          collection_id: string
          first_token_id: number
          group_id: number
          log_index: number
          recipient: string
          tx_hash: string
          vault?: string | null
        }
        Update: {
          amount?: number
          block?: number
          block_time?: string
          collection_id?: string
          first_token_id?: number
          group_id?: number
          log_index?: number
          recipient?: string
          tx_hash?: string
          vault?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'mints_collection_id_fkey'
            columns: ['collection_id']
            isOneToOne: false
            referencedRelation: 'collections'
            referencedColumns: ['id']
          },
```

In `apps/web/src/lib/database.types.ts`, replace:

```ts
            isOneToOne: false
            referencedRelation: 'traits'
            referencedColumns: ['id']
          },
```

with:

```ts
            isOneToOne: false
            referencedRelation: 'traits'
            referencedColumns: ['id']
          },
        ]
      }
      token_owners: {
        Row: {
          block: number
          collection_id: string
          log_index: number
          owner: string
          token_id: number
        }
        Insert: {
          block: number
          collection_id: string
          log_index: number
          owner: string
          token_id: number
        }
        Update: {
          block?: number
          collection_id?: string
          log_index?: number
          owner?: string
          token_id?: number
        }
        Relationships: [
          {
            foreignKeyName: 'token_owners_collection_id_fkey'
            columns: ['collection_id']
            isOneToOne: false
            referencedRelation: 'collections'
            referencedColumns: ['id']
          },
```

In `apps/web/src/lib/database.types.ts`, replace:

```ts
        }
      }
      mint_group_move: {
        Args: { p_collection_id: string; p_onchain_id: number; p_up: boolean }
```

with:

```ts
        }
      }
      indexer_record: {
        Args: {
          p_chain_id: number
          p_collections: string[]
          p_from_block: number
          p_records: Json
          p_synced_at: string
          p_to_block: number
        }
        Returns: Json
      }
      indexer_start: {
        Args: { p_collection_id: string; p_from_block: number }
        Returns: Json
      }
      indexer_summaries: {
        Args: { p_chain_id: number }
        Returns: Json
      }
      indexer_targets: {
        Args: { p_chain_id: number }
        Returns: Json
      }
      mint_group_move: {
        Args: { p_collection_id: string; p_onchain_id: number; p_up: boolean }
```

- [ ] **Step 6: Run the checks to see them pass**

Run: `pnpm --filter @cobweb/web verify:local`
Expected: PASS, `394 passed, 0 failed`: the four anon checks and section 9o's ten beside the 380 before.

- [ ] **Step 7: Format, run the root checks and commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
pnpm exec prettier --write apps/web/src/lib/database.types.ts apps/web/scripts/verify-local.ts
pnpm typecheck && pnpm lint && pnpm test
git add supabase/migrations/20261016200000_indexer.sql apps/web/src/lib/database.types.ts apps/web/scripts/verify-local.ts
git commit -m "$(cat <<'EOF'
Add the indexer's tables and its four service-role functions, the airdrops' block time and optional sender, their types, and verify:local's section 9o

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: the tests are unchanged (web 877 in 93 files, shared 105, freshness 112, dna 60, render 117, worker 282).

---

### Task 2: The indexer's wire types and pure modules: the records, the plan and the activity

**Kind:** transcription. The plan carries every line: a Sonnet implementer.

**Files:**

- Create: `apps/freshness/src/indexer-records.ts`, `apps/freshness/src/indexer-plan.ts`, `apps/freshness/src/activity.ts`, and the tests `apps/freshness/src/indexer-records.test.ts`, `indexer-plan.test.ts`, `activity.test.ts`
- Modify: `packages/shared/src/freshness-wire.ts` (the `Hex` import and two types)
- Test: the three new test files

**Interfaces:**

- Consumes: `collectionAbi` from `@cobweb/shared/collection-abi`; `chainById` and each chain's `confirmations` from `@cobweb/shared`; `Tier` from `apps/freshness/src/tiers.ts`; viem's `getAbiItem`, `getAddress` and `zeroAddress`.
- Produces:
  - `@cobweb/shared`: `MintBody = { txHash: Hex; recipient: Address; groupId: number; amount: number; firstTokenId: number; blockTimestamp: number }` and `StateActivity = { holders: number; recentMints: MintBody[] }` (`StateBody` gains its field in Task 4, Decision 2)
  - `indexer-records.ts`: `DEAD_ADDRESS: Address` (lowercase), `INDEX_EVENTS` (the ABI's `Transfer`, `TokensMinted`, `TokensDelegateMinted`, `NFTsAirdropped`, `MintFundsWithdrawn`), `IndexEventName`, `IndexLog = { address; eventName; args: unknown; blockNumber: bigint; logIndex: number; transactionHash: Hex }`, `MintRecord`, `OwnerRecord`, `RunRecord`, `AirdropRecord`, `WithdrawalRecord`, `Records = { mints; owners; airdrops; withdrawals }`, `eventBlocksOf(logs: readonly IndexLog[]): bigint[]`, `recordsOf(logs: readonly IndexLog[], collections: ReadonlyMap<string, string>, blockTimes: ReadonlyMap<bigint, number>): { records: Records; unpaired: Hex[] }` (Decision 4)
  - `indexer-plan.ts`: `MAX_RANGE = 500n`, `ADDRESSES_PER_SCAN = 100`, `LAGGING_SCANS_PER_PASS = 10`, `MAX_LOGS_PER_WRITE = 2_000`, `PASS_MS = { behind: 1_000, fast: 5_000, idle: 20_000 }`, `TARGETS_EVERY_MS = 60_000`, `CURSOR_WRITE_EVERY_MS = 60_000`, `Cursor = { collectionId; contract: Address; scanned: bigint; written: bigint; range: bigint; syncedAt: number | null; writtenAt: number }`, `Scan = { cursors: Cursor[]; fromBlock: bigint; toBlock: bigint }`, `safeBlockOf(head: bigint, confirmations: number): bigint`, `scansOf(cursors: readonly Cursor[], safe: bigint): Scan[]`, `segmentsOf<T extends { blockNumber: bigint }>(logs: readonly T[], scan: Scan, max?: number): { fromBlock: bigint; toBlock: bigint; logs: T[] }[]`, `passDelayMs(pass: { behind: boolean; recorded: boolean; tier: Tier | null }, delays?: { behind: number; fast: number; idle: number }): number`
  - `activity.ts`: `ACTIVITY_LAG_MAX_S = 300`, `RECENT_MINTS = 10`, `Summary = { collectionId: string; contract: Address; holders: number; syncedAt: number | null; recentMints: MintBody[] }` (Decision 3), `activityOf(summary: Summary | undefined, syncedAt: number | null, blockTimestamp: number): StateActivity | null`

- [ ] **Step 1: Write the failing tests**

The records' logs are encoded from the collection's ABI and decoded with viem's `parseEventLogs`, as `getLogs` decodes them. The case for a mint made from inside another collection's mint pins Review Focus 5.

Create `apps/freshness/src/indexer-records.test.ts`:

```ts
import { collectionAbi } from '@cobweb/shared/collection-abi'
import {
  encodeAbiParameters,
  encodeEventTopics,
  parseAbiParameters,
  parseEventLogs,
  zeroAddress,
  type Address,
  type Hex,
  type Log,
} from 'viem'
import { describe, expect, it } from 'vitest'
import { DEAD_ADDRESS, eventBlocksOf, INDEX_EVENTS, recordsOf, type IndexLog } from './indexer-records.ts'

const COLLECTION: Address = '0x0409454C375c8a6aB05383bFB6D9FcDe9ebB8F85'
const SECOND: Address = '0x5FbDB2315678afecb367f032d93F642f64180aa3'
const OTHER: Address = '0x721C008fdff27BF06E7E123956E2Fe03B63342e3'
const ID = '0a977c0b-7e53-476b-8c08-6c685315c3af'
const SECOND_ID = '7d2c9e10-5b44-4a6f-9c3e-2f1b8a7d6e5c'
const A: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const B: Address = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
const C: Address = '0x90F79bf6EB2c4f870365E785982E1f101E93b906'
const VAULT: Address = '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65'
const DEAD: Address = '0x000000000000000000000000000000000000dEaD'
const BLOCK_HASH: Hex = `0x${'b1'.repeat(32)}`
const COLLECTIONS: ReadonlyMap<string, string> = new Map([
  [COLLECTION.toLowerCase(), ID],
  [SECOND.toLowerCase(), SECOND_ID],
])
/** Each test block's time: 1,800,000,000 plus the block. */
const TIMES: ReadonlyMap<bigint, number> = new Map(
  [100n, 101n, 102n, 103n].map((block) => [block, 1_800_000_000 + Number(block)]),
)

const TX = (n: number): Hex => `0x${n.toString(16).padStart(64, '0')}`
const lower = (address: Address) => address.toLowerCase()

/**
 * An event as the contract emits it: its topics and data, from the collection unless another address is
 * given.
 */
type Emitted = { address: Address; topics: Hex[]; data: Hex }
const transfer = (from: Address, to: Address, tokenId: bigint, address: Address = COLLECTION): Emitted => ({
  address,
  topics: encodeEventTopics({
    abi: INDEX_EVENTS,
    eventName: 'Transfer',
    args: { from, to, tokenId },
  }) as Hex[],
  data: '0x',
})
const minted = (
  recipient: Address,
  amount: bigint,
  mintGroup: bigint,
  address: Address = COLLECTION,
): Emitted => ({
  address,
  topics: encodeEventTopics({ abi: INDEX_EVENTS, eventName: 'TokensMinted', args: { recipient } }) as Hex[],
  data: encodeAbiParameters(parseAbiParameters('uint256, uint256'), [amount, mintGroup]),
})
const delegateMinted = (vault: Address, recipient: Address, amount: bigint, mintGroup: bigint): Emitted => ({
  address: COLLECTION,
  topics: encodeEventTopics({
    abi: INDEX_EVENTS,
    eventName: 'TokensDelegateMinted',
    args: { vault, recipient },
  }) as Hex[],
  data: encodeAbiParameters(parseAbiParameters('uint256, uint256'), [amount, mintGroup]),
})
const airdropped = (recipients: bigint, amount: bigint, feePaid: bigint): Emitted => ({
  address: COLLECTION,
  topics: encodeEventTopics({ abi: INDEX_EVENTS, eventName: 'NFTsAirdropped' }) as Hex[],
  data: encodeAbiParameters(parseAbiParameters('uint256, uint256, uint256'), [recipients, amount, feePaid]),
})
const withdrawn = (payoutAddress: Address, amount: bigint): Emitted => ({
  address: COLLECTION,
  topics: encodeEventTopics({
    abi: INDEX_EVENTS,
    eventName: 'MintFundsWithdrawn',
    args: { payoutAddress },
  }) as Hex[],
  data: encodeAbiParameters(parseAbiParameters('uint256'), [amount]),
})
/** Transfers from the zero address to one wallet, one per id. */
const mintedTo = (to: Address, ...ids: bigint[]) => ids.map((id) => transfer(zeroAddress, to, id))

/**
 * Transactions as a node answers their logs (each one's at its block, log indexes counted per block), decoded
 * as `getLogs` decodes them for `INDEX_EVENTS` with `strict: true`.
 */
function logsOf(...transactions: [block: bigint, tx: number, events: Emitted[]][]): IndexLog[] {
  const indexes = new Map<bigint, number>()
  const logs: Log[] = transactions.flatMap(([block, tx, events]) =>
    events.map((event): Log => {
      const logIndex = indexes.get(block) ?? 0
      indexes.set(block, logIndex + 1)
      return {
        address: event.address,
        topics: event.topics as [Hex, ...Hex[]],
        data: event.data,
        blockNumber: block,
        blockHash: BLOCK_HASH,
        logIndex,
        transactionHash: TX(tx),
        transactionIndex: 0,
        removed: false,
      }
    }),
  )
  return parseEventLogs({ abi: INDEX_EVENTS, logs, strict: true }) as unknown as IndexLog[]
}

const recordsFor = (logs: IndexLog[]) => recordsOf(logs, COLLECTIONS, TIMES)

describe('INDEX_EVENTS (docs/specs/2026-10-16-indexer-overview.md, section 6.4)', () => {
  it("are the collection ABI's five events the indexer reads", () => {
    expect(INDEX_EVENTS.map((event) => event.name)).toEqual([
      'Transfer',
      'TokensMinted',
      'TokensDelegateMinted',
      'NFTsAirdropped',
      'MintFundsWithdrawn',
    ])
    for (const event of INDEX_EVENTS)
      expect(event).toEqual(collectionAbi.find((item) => item.type === 'event' && item.name === event.name))
  })
})

describe('eventBlocksOf', () => {
  it('names each block with a mint or an airdrop event once, ascending, and no block of transfers or withdrawals alone', () => {
    const logs = logsOf(
      [102n, 3, [...mintedTo(A, 3n), minted(A, 1n, 0n)]],
      [100n, 1, [...mintedTo(B, 1n), airdropped(1n, 1n, 0n)]],
      [101n, 2, [transfer(B, C, 1n), withdrawn(A, 5n)]],
      [102n, 4, [...mintedTo(A, 4n), minted(A, 1n, 0n)]],
    )
    expect(eventBlocksOf(logs)).toEqual([100n, 102n])
  })
})

describe('recordsOf (docs/specs/2026-10-16-indexer-overview.md, section 6.4)', () => {
  it('records a mint of 3 as one mint with its first id, its group and its block time, and the three owners', () => {
    const { records, unpaired } = recordsFor(
      logsOf([100n, 1, [...mintedTo(A, 5n, 6n, 7n), minted(A, 3n, 0n)]]),
    )
    expect(records.mints).toEqual([
      {
        collectionId: ID,
        tx: TX(1),
        logIndex: 3,
        block: 100,
        blockTime: 1_800_000_100,
        recipient: lower(A),
        vault: null,
        groupId: 0,
        amount: 3,
        firstTokenId: 5,
      },
    ])
    expect(records.owners).toEqual(
      [5, 6, 7].map((tokenId, logIndex) => ({
        collectionId: ID,
        tokenId,
        owner: lower(A),
        block: 100,
        logIndex,
      })),
    )
    expect([records.airdrops, records.withdrawals, unpaired]).toEqual([[], [], []])
  })

  it('keeps the vault and the hot wallet as recipient for a delegated mint', () => {
    const { records } = recordsFor(
      logsOf([100n, 1, [...mintedTo(A, 8n, 9n), delegateMinted(VAULT, A, 2n, 1n)]]),
    )
    expect(records.mints).toMatchObject([
      { recipient: lower(A), vault: lower(VAULT), groupId: 1, amount: 2, firstTokenId: 8 },
    ])
  })

  it('names the receiver of a mint on behalf, whose tokens it holds, not the caller who paid', () => {
    // mintOnBehalf mints to the receiver and emits TokensMinted for it; the caller appears in no log.
    const { records } = recordsFor(logsOf([100n, 1, [...mintedTo(B, 10n), minted(B, 1n, 0n)]]))
    expect(records.mints).toMatchObject([{ recipient: lower(B), vault: null, firstTokenId: 10 }])
  })

  it('pairs two mints in one transaction in order, each with the transfers before it', () => {
    const { records, unpaired } = recordsFor(
      logsOf([100n, 1, [...mintedTo(A, 1n), minted(A, 1n, 0n), ...mintedTo(B, 2n, 3n), minted(B, 2n, 1n)]]),
    )
    expect(
      records.mints.map((mint) => [mint.recipient, mint.amount, mint.firstTokenId, mint.groupId]),
    ).toEqual([
      [lower(A), 1, 1, 0],
      [lower(B), 2, 2, 1],
    ])
    expect(unpaired).toEqual([])
  })

  it('does not record a mint with fewer transfers than its amount, or with one to another address, and names it unpaired', () => {
    const { records, unpaired } = recordsFor(
      logsOf(
        [100n, 1, [...mintedTo(A, 1n), minted(A, 2n, 0n)]],
        [101n, 2, [transfer(zeroAddress, A, 2n), transfer(zeroAddress, B, 3n), minted(A, 2n, 0n)]],
      ),
    )
    expect(records.mints).toEqual([])
    expect(unpaired).toEqual([TX(1), TX(2)])
    // Their transfers still move owners.
    expect(records.owners.map((owner) => [owner.tokenId, owner.owner])).toEqual([
      [1, lower(A)],
      [2, lower(A)],
      [3, lower(B)],
    ])
  })

  it('pairs a mint made from inside another collection mint with its own transfers (Review Focus 5)', () => {
    // A receiver contract mints the second collection from its onERC721Received hook, between the first
    // collection's transfer and its TokensMinted: each collection keeps its own pending transfers.
    const { records, unpaired } = recordsFor(
      logsOf([
        100n,
        1,
        [
          transfer(zeroAddress, A, 1n),
          transfer(zeroAddress, A, 1n, SECOND),
          minted(A, 1n, 0n, SECOND),
          minted(A, 1n, 0n),
        ],
      ]),
    )
    expect(records.mints.map((mint) => [mint.collectionId, mint.amount, mint.firstTokenId])).toEqual([
      [SECOND_ID, 1, 1],
      [ID, 1, 1],
    ])
    expect(unpaired).toEqual([])
  })

  it('records an airdrop of A 2, B 1 and A 1 as three runs in order, with its counts and fee', () => {
    const { records } = recordsFor(
      logsOf([
        101n,
        2,
        [
          ...mintedTo(A, 11n, 12n),
          transfer(zeroAddress, B, 13n),
          transfer(zeroAddress, A, 14n),
          airdropped(2n, 4n, 400_000_000_000_000n),
        ],
      ]),
    )
    expect(records.airdrops).toEqual([
      {
        collectionId: ID,
        tx: TX(2),
        block: 101,
        blockTime: 1_800_000_101,
        kind: 'airdrop',
        recipients: 2,
        tokens: 4,
        feePaidWei: '400000000000000',
        firstTokenId: 11,
        lastTokenId: 14,
        runs: [
          { recipient: lower(A), tokens: 2, firstTokenId: 11 },
          { recipient: lower(B), tokens: 1, firstTokenId: 13 },
          { recipient: lower(A), tokens: 1, firstTokenId: 14 },
        ],
      },
    ])
  })

  it('records the dead address alone with 2 tokens as a burn, and nothing for an airdrop of 0 tokens', () => {
    const { records, unpaired } = recordsFor(
      logsOf(
        [101n, 2, [...mintedTo(DEAD, 15n, 16n), airdropped(1n, 2n, 200n)]],
        [102n, 3, [airdropped(1n, 0n, 0n)]],
      ),
    )
    expect(records.airdrops).toMatchObject([
      {
        kind: 'burn',
        recipients: 1,
        tokens: 2,
        firstTokenId: 15,
        lastTokenId: 16,
        runs: [{ recipient: DEAD_ADDRESS, tokens: 2, firstTokenId: 15 }],
      },
    ])
    expect(unpaired).toEqual([])
  })

  it('does not record an airdrop whose count does not match its transfers, and names it unpaired', () => {
    const { records, unpaired } = recordsFor(logsOf([101n, 2, [...mintedTo(A, 1n), airdropped(1n, 2n, 0n)]]))
    expect(records.airdrops).toEqual([])
    expect(unpaired).toEqual([TX(2)])
  })

  it("keeps a withdrawal's amount and payout address", () => {
    const { records } = recordsFor(logsOf([103n, 4, [withdrawn(B, 2_000_000_000_000_000n)]]))
    expect(records.withdrawals).toEqual([
      { collectionId: ID, tx: TX(4), block: 103, payoutAddress: lower(B), amountWei: '2000000000000000' },
    ])
  })

  it('moves owners on transfers between holders and keeps only the latest per token, whatever order the logs come in', () => {
    const logs = logsOf(
      [100n, 1, [...mintedTo(A, 1n), minted(A, 1n, 0n)]],
      [101n, 2, [transfer(A, B, 1n)]],
      [102n, 3, [transfer(B, C, 1n)]],
    )
    const { records, unpaired } = recordsFor([...logs].reverse())
    expect(records.owners).toEqual([
      { collectionId: ID, tokenId: 1, owner: lower(C), block: 102, logIndex: 0 },
    ])
    expect(records.mints).toHaveLength(1)
    expect(unpaired).toEqual([])
  })

  it('does not record a mint whose group id is above 2^53 - 1, while its transfers move owners', () => {
    const { records, unpaired } = recordsFor(
      logsOf([100n, 1, [...mintedTo(A, 1n), minted(A, 1n, 2n ** 53n)]]),
    )
    expect(records.mints).toEqual([])
    expect(records.owners).toMatchObject([{ tokenId: 1, owner: lower(A) }])
    expect(unpaired).toEqual([TX(1)])
  })

  it('names transfers from the zero address left at the end of a transaction as one unpaired mint', () => {
    const { records, unpaired } = recordsFor(
      logsOf([100n, 1, mintedTo(A, 1n, 2n)], [101n, 2, mintedTo(B, 3n)]),
    )
    expect(records.mints).toEqual([])
    expect(unpaired).toEqual([TX(1), TX(2)])
  })

  it('ignores a log of another address', () => {
    const { records, unpaired } = recordsFor(
      logsOf([100n, 1, [transfer(zeroAddress, A, 1n, OTHER), minted(A, 1n, 0n, OTHER)]]),
    )
    expect(records).toEqual({ mints: [], owners: [], airdrops: [], withdrawals: [] })
    expect(unpaired).toEqual([])
  })
})
```

Create `apps/freshness/src/indexer-plan.test.ts`:

```ts
import { chainById } from '@cobweb/shared'
import type { Address } from 'viem'
import { describe, expect, it } from 'vitest'
import {
  MAX_LOGS_PER_WRITE,
  MAX_RANGE,
  PASS_MS,
  passDelayMs,
  safeBlockOf,
  scansOf,
  segmentsOf,
  type Cursor,
  type Scan,
} from './indexer-plan.ts'

/** The n-th cursor of a test, scanned to a block, with its own contract. */
const cursorAt = (n: number, scanned: bigint, range: bigint = MAX_RANGE): Cursor => ({
  collectionId: `collection-${n}`,
  contract: `0x${n.toString(16).padStart(40, '0')}` as Address,
  scanned,
  written: scanned,
  range,
  syncedAt: null,
  writtenAt: 0,
})
const many = (from: number, count: number, scanned: bigint) =>
  Array.from({ length: count }, (_, index) => cursorAt(from + index, scanned))
/** Each scan as `<from>-<to> x<cursors>`. */
const shape = (scans: Scan[]) =>
  scans.map((scan) => `${scan.fromBlock}-${scan.toBlock} x${scan.cursors.length}`)

describe('safeBlockOf (docs/specs/2026-10-16-indexer-overview.md, section 6.3)', () => {
  it("is the head on Anvil, two below it on Arbitrum's 3 confirmations and four below on Ethereum's 5", () => {
    const depth = (id: number) => chainById(id, false)!.confirmations
    expect(safeBlockOf(100n, depth(31337))).toBe(100n)
    expect(safeBlockOf(100n, depth(42161))).toBe(98n)
    expect(safeBlockOf(100n, depth(1))).toBe(96n)
  })

  it('is never below 0', () => {
    expect(safeBlockOf(2n, 5)).toBe(0n)
    expect(safeBlockOf(0n, 1)).toBe(0n)
  })
})

describe('scansOf', () => {
  it('groups the cursors by scanned block in chunks of 100 addresses', () => {
    const scans = scansOf([...many(1, 250, 999n)], 2_000n)
    expect(shape(scans)).toEqual(['1000-1499 x100', '1000-1499 x100', '1000-1499 x50'])
    expect(scans[2]!.cursors[0]!.collectionId).toBe('collection-201')
  })

  it('reads at most 500 blocks a scan, ends at the safe block, and takes the group smallest range', () => {
    expect(shape(scansOf([cursorAt(1, 999n)], 1_200n))).toEqual(['1000-1200 x1'])
    expect(shape(scansOf([cursorAt(1, 999n)], 5_000n))).toEqual(['1000-1499 x1'])
    expect(shape(scansOf([cursorAt(1, 999n), cursorAt(2, 999n, 125n)], 5_000n))).toEqual(['1000-1124 x2'])
  })

  it('takes a range halved down to 1 block', () => {
    expect(shape(scansOf([cursorAt(1, 999n, 1n)], 5_000n))).toEqual(['1000-1000 x1'])
    expect(shape(scansOf([cursorAt(1, 999n, 250n)], 5_000n))).toEqual(['1000-1249 x1'])
  })

  it('plans the front group in full and at most 10 lagging scans, the closest to the front first', () => {
    const cursors = [
      ...many(1, 3, 4_000n),
      ...many(100, 1_050, 3_000n),
      ...many(2_000, 150, 5_000n),
      cursorAt(3_000, 100n),
    ]
    expect(shape(scansOf(cursors, 9_000n))).toEqual([
      '5001-5500 x100',
      '5001-5500 x50',
      '4001-4500 x3',
      ...Array.from({ length: 9 }, () => '3001-3500 x100'),
    ])
  })

  it('plans nothing for a cursor at or above the safe block', () => {
    expect(scansOf([cursorAt(1, 1_200n), cursorAt(2, 1_300n)], 1_200n)).toEqual([])
    expect(shape(scansOf([cursorAt(1, 1_199n), cursorAt(2, 1_200n)], 1_200n))).toEqual(['1200-1200 x1'])
  })
})

describe('segmentsOf', () => {
  const scan: Scan = { cursors: [cursorAt(1, 4n)], fromBlock: 5n, toBlock: 20n }
  const logsAt = (block: bigint, count: number) =>
    Array.from({ length: count }, () => ({ blockNumber: block }))
  const cut = (logs: { blockNumber: bigint }[]) =>
    segmentsOf(logs, scan).map((segment) => `${segment.fromBlock}-${segment.toBlock} x${segment.logs.length}`)

  it('cuts at block boundaries into writes of at most 2,000 logs, the last ending at the scan end', () => {
    expect(MAX_LOGS_PER_WRITE).toBe(2_000)
    expect(cut([...logsAt(12n, 100), ...logsAt(10n, 1_500), ...logsAt(11n, 600)])).toEqual([
      '5-10 x1500',
      '11-20 x700',
    ])
    expect(
      cut([...logsAt(10n, 1_500), ...logsAt(11n, 600), ...logsAt(12n, 100), ...logsAt(13n, 1_500)]),
    ).toEqual(['5-10 x1500', '11-12 x700', '13-20 x1500'])
  })

  it('keeps one block of more than 2,000 logs whole', () => {
    expect(cut([...logsAt(9n, 10), ...logsAt(10n, 2_500), ...logsAt(11n, 10)])).toEqual([
      '5-9 x10',
      '10-10 x2500',
      '11-20 x10',
    ])
  })

  it('covers the scan with one segment when it found no log', () => {
    expect(segmentsOf([], scan)).toEqual([{ fromBlock: 5n, toBlock: 20n, logs: [] }])
  })
})

describe('passDelayMs', () => {
  it('waits 1 s during a backfill, 5 s after a pass that recorded or on a fast or live chain, 20 s otherwise', () => {
    expect(PASS_MS).toEqual({ behind: 1_000, fast: 5_000, idle: 20_000 })
    expect(passDelayMs({ behind: true, recorded: false, tier: 'idle' })).toBe(1_000)
    expect(passDelayMs({ behind: false, recorded: true, tier: null })).toBe(5_000)
    expect(passDelayMs({ behind: false, recorded: false, tier: 'fast' })).toBe(5_000)
    expect(passDelayMs({ behind: false, recorded: false, tier: 'live' })).toBe(5_000)
    expect(passDelayMs({ behind: false, recorded: false, tier: 'idle' })).toBe(20_000)
    expect(passDelayMs({ behind: false, recorded: false, tier: null })).toBe(20_000)
  })

  it('takes the delays it is given', () => {
    const delays = { behind: 200, fast: 500, idle: 700 }
    expect(passDelayMs({ behind: true, recorded: true, tier: 'live' }, delays)).toBe(200)
    expect(passDelayMs({ behind: false, recorded: false, tier: 'live' }, delays)).toBe(500)
    expect(passDelayMs({ behind: false, recorded: false, tier: null }, delays)).toBe(700)
  })
})
```

Create `apps/freshness/src/activity.test.ts`:

```ts
import type { MintBody } from '@cobweb/shared'
import type { Address, Hex } from 'viem'
import { describe, expect, it } from 'vitest'
import { ACTIVITY_LAG_MAX_S, activityOf, RECENT_MINTS, type Summary } from './activity.ts'

const CONTRACT: Address = '0x0409454c375c8a6ab05383bfb6d9fcde9ebb8f85'
const MINTER: Address = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8'
const CHECKSUMMED: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'

/** Twelve mints newest first, as the database answers them: lowercase recipients, one block apart. */
const mints: MintBody[] = Array.from({ length: 12 }, (_, index) => ({
  txHash: `0x${(12 - index).toString(16).padStart(64, '0')}` as Hex,
  recipient: MINTER,
  groupId: 0,
  amount: 1,
  firstTokenId: 12 - index,
  blockTimestamp: 1_800_000_012 - index,
}))
const summary: Summary = {
  collectionId: '0a977c0b-7e53-476b-8c08-6c685315c3af',
  contract: CONTRACT,
  holders: 7,
  syncedAt: 1_800_000_000,
  recentMints: mints,
}

describe('activityOf (docs/specs/2026-10-16-indexer-overview.md, section 6.6)', () => {
  it('is null without a summary, before the first sync and at 301 s behind the state', () => {
    expect(ACTIVITY_LAG_MAX_S).toBe(300)
    expect(activityOf(undefined, 1_800_000_000, 1_800_000_000)).toBeNull()
    expect(activityOf(summary, null, 1_800_000_000)).toBeNull()
    expect(activityOf(summary, 1_800_000_000, 1_800_000_301)).toBeNull()
  })

  it('carries the holders at 300 s behind, and when the state reads an older block than the sync', () => {
    expect(activityOf(summary, 1_800_000_000, 1_800_000_300)?.holders).toBe(7)
    expect(activityOf(summary, 1_800_000_000, 1_799_999_000)?.holders).toBe(7)
  })

  it('carries at most 10 mints, newest first, recipients checksummed', () => {
    expect(RECENT_MINTS).toBe(10)
    const activity = activityOf(summary, 1_800_000_000, 1_800_000_010)
    expect(activity?.recentMints).toHaveLength(10)
    expect(activity?.recentMints.map((mint) => mint.firstTokenId)).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3])
    expect(activity?.recentMints[0]).toEqual({ ...mints[0], recipient: CHECKSUMMED })
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @cobweb/freshness exec vitest run src/indexer-records.test.ts src/indexer-plan.test.ts src/activity.test.ts`
Expected: FAIL. Each file fails to load (`Cannot find module './indexer-records.ts'`, `Cannot find module './indexer-plan.ts'`, `Cannot find module './activity.ts'`): `Test Files  3 failed (3)` and `Tests  no tests`.

- [ ] **Step 3: The wire types**

In `packages/shared/src/freshness-wire.ts`, replace:

```ts
import type { Address } from 'viem'
import type { ChainGroup } from './collection-state.ts'

```

with:

```ts
import type { Address, Hex } from 'viem'
import type { ChainGroup } from './collection-state.ts'

```

In `packages/shared/src/freshness-wire.ts`, replace:

```ts
  transferValidator: Address
  transferLevel: 'none' | 'unread' | number
}

```

with:

```ts
  transferValidator: Address
  transferLevel: 'none' | 'unread' | number
}

/**
 * One mint the indexer recorded, as the state body carries it (docs/specs/2026-10-16-indexer-overview.md,
 * section 5).
 */
export type MintBody = {
  txHash: Hex
  /** Who received the tokens (a delegated mint's hot wallet, a mint on behalf's receiver), checksummed. */
  recipient: Address
  groupId: number
  amount: number
  /** The first of its consecutive token ids. */
  firstTokenId: number
  /** The block's time (Unix seconds). */
  blockTimestamp: number
}

/** A collection's holders and latest mints, from the indexer at the chain's confirmation depth. */
export type StateActivity = {
  /** Distinct owners of at least one token, the dead address left out. */
  holders: number
  /** At most 10, newest first. */
  recentMints: MintBody[]
}

```

- [ ] **Step 4: The records**

Each transaction's logs are walked in log index order, with the pending transfers from the zero address kept per collection; a mint or airdrop that does not pair is named among the unpaired by its transaction.

Create `apps/freshness/src/indexer-records.ts`:

```ts
import { collectionAbi } from '@cobweb/shared/collection-abi'
import { getAbiItem, zeroAddress, type Address, type Hex } from 'viem'

/**
 * What a segment's logs record (docs/specs/2026-10-16-indexer-overview.md, section 6.4), pure, in the shape
 * `indexer_record` takes: addresses lowercase, times in Unix seconds, wei as decimal strings. Within a
 * transaction, a collection's transfers from the zero address since its last mint or airdrop event belong to
 * its next `TokensMinted`, `TokensDelegateMinted` or `NFTsAirdropped`, the order the contract emits them in.
 * A mint or an airdrop that does not pair with its transfers is not recorded and is named among the unpaired,
 * while every `Transfer` still moves its token's owner.
 */

/** Where a burn mints its tokens (MASTER_PLAN, Contracts: burn), lowercase as the tables hold it. */
export const DEAD_ADDRESS: Address = '0x000000000000000000000000000000000000dead'

/** The five events the indexer reads (decision 5), from the collection's ABI. */
export const INDEX_EVENTS = [
  getAbiItem({ abi: collectionAbi, name: 'Transfer' }),
  getAbiItem({ abi: collectionAbi, name: 'TokensMinted' }),
  getAbiItem({ abi: collectionAbi, name: 'TokensDelegateMinted' }),
  getAbiItem({ abi: collectionAbi, name: 'NFTsAirdropped' }),
  getAbiItem({ abi: collectionAbi, name: 'MintFundsWithdrawn' }),
] as const

export type IndexEventName = (typeof INDEX_EVENTS)[number]['name']

/** A log as viem's `getLogs` answers it for `INDEX_EVENTS` with `strict: true`: decoded, its args by name. */
export type IndexLog = {
  address: Address
  eventName: IndexEventName
  args: unknown
  blockNumber: bigint
  logIndex: number
  transactionHash: Hex
}

export type MintRecord = {
  collectionId: string
  tx: Hex
  /** The mint event's own log index. */
  logIndex: number
  block: number
  blockTime: number
  recipient: Address
  /** The vault whose allowance a delegated mint used; null for `TokensMinted`. */
  vault: Address | null
  groupId: number
  amount: number
  firstTokenId: number
}

export type OwnerRecord = {
  collectionId: string
  tokenId: number
  owner: Address
  block: number
  logIndex: number
}

/** Consecutive transfers of one airdrop to one address. */
export type RunRecord = { recipient: Address; tokens: number; firstTokenId: number }

export type AirdropRecord = {
  collectionId: string
  tx: Hex
  block: number
  blockTime: number
  kind: 'airdrop' | 'burn'
  recipients: number
  tokens: number
  feePaidWei: string
  firstTokenId: number
  lastTokenId: number
  runs: RunRecord[]
}

export type WithdrawalRecord = {
  collectionId: string
  tx: Hex
  block: number
  payoutAddress: Address
  amountWei: string
}

export type Records = {
  mints: MintRecord[]
  owners: OwnerRecord[]
  airdrops: AirdropRecord[]
  withdrawals: WithdrawalRecord[]
}

/** The events that pair with transfers, whose blocks' times the records carry. */
const PAIRING: ReadonlySet<IndexEventName> = new Set([
  'TokensMinted',
  'TokensDelegateMinted',
  'NFTsAirdropped',
])

/** The largest group id `mints.group_id` takes: 2^53 - 1, the largest whole number JSON carries exactly. */
const MAX_GROUP_ID = BigInt(Number.MAX_SAFE_INTEGER)

const byBlock = (a: bigint, b: bigint) => (a < b ? -1 : a > b ? 1 : 0)
const lower = (address: Address) => address.toLowerCase() as Address

/** The blocks with a mint or an airdrop event, ascending: the blocks whose times `recordsOf` needs. */
export function eventBlocksOf(logs: readonly IndexLog[]): bigint[] {
  const blocks = new Set<bigint>()
  for (const log of logs) if (PAIRING.has(log.eventName)) blocks.add(log.blockNumber)
  return [...blocks].sort(byBlock)
}

/** A transfer from the zero address waiting for its mint or airdrop event. */
type Pending = { tokenId: bigint; to: Address }

/** The lowest and the highest of the pending ids. */
function idRange(pending: readonly Pending[]): { first: bigint; last: bigint } {
  let first = pending[0]!.tokenId
  let last = first
  for (const { tokenId } of pending) {
    if (tokenId < first) first = tokenId
    if (tokenId > last) last = tokenId
  }
  return { first, last }
}

/** Consecutive pending transfers to one address, in log order. */
function runsOf(pending: readonly Pending[]): RunRecord[] {
  const runs: RunRecord[] = []
  for (const { tokenId, to } of pending) {
    const run = runs[runs.length - 1]
    if (run && run.recipient === to) run.tokens += 1
    else runs.push({ recipient: to, tokens: 1, firstTokenId: Number(tokenId) })
  }
  return runs
}

/**
 * The records of a segment's logs for the collections given (lowercase contract to collection id; a log of
 * any other address is ignored), walking each transaction's logs in log index order. `blockTimes` holds the
 * time of each block `eventBlocksOf` names. `unpaired` names the transaction of each mint or airdrop that did
 * not pair, once per event, and once per collection whose transfers from the zero address were left at the
 * end of a transaction.
 */
export function recordsOf(
  logs: readonly IndexLog[],
  collections: ReadonlyMap<string, string>,
  blockTimes: ReadonlyMap<bigint, number>,
): { records: Records; unpaired: Hex[] } {
  const records: Records = { mints: [], owners: [], airdrops: [], withdrawals: [] }
  const unpaired: Hex[] = []
  const owners = new Map<string, OwnerRecord>()
  const ours = logs
    .filter((log) => collections.has(log.address.toLowerCase()))
    .sort((a, b) => byBlock(a.blockNumber, b.blockNumber) || a.logIndex - b.logIndex)
  let tx: Hex | null = null
  let pending = new Map<string, Pending[]>()
  const endTransaction = () => {
    for (const left of pending.values()) if (left.length && tx) unpaired.push(tx)
    pending = new Map()
  }

  for (const log of ours) {
    const hash = log.transactionHash.toLowerCase() as Hex
    if (hash !== tx) {
      endTransaction()
      tx = hash
    }
    const collectionId = collections.get(log.address.toLowerCase())!
    const block = Number(log.blockNumber)
    const timeOf = () => {
      const time = blockTimes.get(log.blockNumber)
      if (time === undefined) throw new Error(`The time of block ${log.blockNumber} was not read.`)
      return time
    }
    /** The collection's pending transfers, which this event takes. */
    const take = () => {
      const taken = pending.get(collectionId) ?? []
      pending.delete(collectionId)
      return taken
    }

    if (log.eventName === 'Transfer') {
      const { from, to, tokenId } = log.args as { from: Address; to: Address; tokenId: bigint }
      const owner = lower(to)
      // Only the latest transfer of each token is kept: the logs run in block and log index order.
      owners.set(`${collectionId}:${tokenId}`, {
        collectionId,
        tokenId: Number(tokenId),
        owner,
        block,
        logIndex: log.logIndex,
      })
      if (lower(from) === zeroAddress)
        pending.set(collectionId, [...(pending.get(collectionId) ?? []), { tokenId, to: owner }])
    } else if (log.eventName === 'TokensMinted' || log.eventName === 'TokensDelegateMinted') {
      const args = log.args as { vault?: Address; recipient: Address; amount: bigint; mintGroup: bigint }
      const transfers = take()
      const recipient = lower(args.recipient)
      const paired =
        transfers.length > 0 &&
        BigInt(transfers.length) === args.amount &&
        transfers.every((transfer) => transfer.to === recipient) &&
        args.mintGroup <= MAX_GROUP_ID
      if (!paired) {
        unpaired.push(hash)
        continue
      }
      records.mints.push({
        collectionId,
        tx: hash,
        logIndex: log.logIndex,
        block,
        blockTime: timeOf(),
        recipient,
        vault: log.eventName === 'TokensDelegateMinted' && args.vault ? lower(args.vault) : null,
        groupId: Number(args.mintGroup),
        amount: transfers.length,
        firstTokenId: Number(idRange(transfers).first),
      })
    } else if (log.eventName === 'NFTsAirdropped') {
      const args = log.args as { recipients: bigint; amount: bigint; feePaid: bigint }
      const transfers = take()
      // An airdrop of 0 tokens records nothing; a count that does not match its transfers is unpaired.
      if (args.amount === 0n && transfers.length === 0) continue
      if (BigInt(transfers.length) !== args.amount) {
        unpaired.push(hash)
        continue
      }
      const runs = runsOf(transfers)
      const { first, last } = idRange(transfers)
      records.airdrops.push({
        collectionId,
        tx: hash,
        block,
        blockTime: timeOf(),
        kind:
          args.recipients === 1n && runs.every((run) => run.recipient === DEAD_ADDRESS) ? 'burn' : 'airdrop',
        recipients: Number(args.recipients),
        tokens: transfers.length,
        feePaidWei: args.feePaid.toString(),
        firstTokenId: Number(first),
        lastTokenId: Number(last),
        runs,
      })
    } else {
      const args = log.args as { payoutAddress: Address; amount: bigint }
      records.withdrawals.push({
        collectionId,
        tx: hash,
        block,
        payoutAddress: lower(args.payoutAddress),
        amountWei: args.amount.toString(),
      })
    }
  }
  endTransaction()
  records.owners = [...owners.values()]
  return { records, unpaired }
}
```

- [ ] **Step 5: The plan and the activity**

Create `apps/freshness/src/indexer-plan.ts`:

```ts
import type { Address } from 'viem'
import type { Tier } from './tiers.ts'

/**
 * The indexer's plan (docs/specs/2026-10-16-indexer-overview.md, section 6.3), pure: the safe block, which
 * logs each pass asks for, how a scan's logs are cut into writes, and when the next pass runs.
 */

/** The most blocks one scan reads. */
export const MAX_RANGE = 500n
/** The most collections one scan asks for. */
export const ADDRESSES_PER_SCAN = 100
/** The most scans the groups behind the front take in one pass. */
export const LAGGING_SCANS_PER_PASS = 10
/** The most logs one write carries, unless one block alone holds more. */
export const MAX_LOGS_PER_WRITE = 2_000
/** The wait from one pass's start to the next: during a backfill, while a chain is busy, otherwise. */
export const PASS_MS = { behind: 1_000, fast: 5_000, idle: 20_000 } as const
/** How often the deployed collections are read again. */
export const TARGETS_EVERY_MS = 60_000
/** How often a cursor with nothing to record is written anyway. */
export const CURSOR_WRITE_EVERY_MS = 60_000

/**
 * A collection as a pass reads it. `scanned` is how far this process has read and `written` how far the
 * database's cursor has moved, both blocks; `range` is the blocks its next scan may read; `syncedAt` the
 * chain's time when a pass last read it to the safe block (Unix seconds); `writtenAt` when its cursor was
 * last written.
 */
export type Cursor = {
  collectionId: string
  contract: Address
  scanned: bigint
  written: bigint
  range: bigint
  syncedAt: number | null
  writtenAt: number
}

/** One `getLogs` call: the cursors whose contracts it asks for, and its blocks, both ends included. */
export type Scan = { cursors: Cursor[]; fromBlock: bigint; toBlock: bigint }

/**
 * The highest block buried under the chain's confirmations (the head counted): `head - confirmations + 1`,
 * never below 0.
 */
export function safeBlockOf(head: bigint, confirmations: number): bigint {
  const safe = head - BigInt(confirmations) + 1n
  return safe > 0n ? safe : 0n
}

/**
 * The scans of a pass: the cursors below the safe block grouped by `scanned`. The front group (the highest
 * `scanned`) is planned in full, one scan per 100 addresses; the groups behind it take at most 10 scans in
 * all, the closest to the front first, so they reach it and merge. Each scan runs from `scanned + 1` to the
 * lower of the safe block and `scanned` plus the group's smallest range.
 */
export function scansOf(cursors: readonly Cursor[], safe: bigint): Scan[] {
  const groups = new Map<bigint, Cursor[]>()
  for (const cursor of cursors) {
    if (cursor.scanned >= safe) continue
    const group = groups.get(cursor.scanned)
    if (group) group.push(cursor)
    else groups.set(cursor.scanned, [cursor])
  }
  const ordered = [...groups.entries()].sort(([a], [b]) => (a > b ? -1 : a < b ? 1 : 0))
  const scans: Scan[] = []
  let lagging = 0
  for (const [index, [scanned, group]] of ordered.entries()) {
    const range = group.reduce((least, cursor) => (cursor.range < least ? cursor.range : least), MAX_RANGE)
    const end = scanned + range
    const toBlock = end < safe ? end : safe
    for (let start = 0; start < group.length; start += ADDRESSES_PER_SCAN) {
      if (index > 0) {
        if (lagging === LAGGING_SCANS_PER_PASS) return scans
        lagging++
      }
      scans.push({
        cursors: group.slice(start, start + ADDRESSES_PER_SCAN),
        fromBlock: scanned + 1n,
        toBlock,
      })
    }
  }
  return scans
}

/**
 * A scan's logs cut at block boundaries into writes of at most `max` logs each, unless one block alone holds
 * more, which is written whole. The segments cover the scan's blocks without a gap: the first starts at its
 * `fromBlock` and the last ends at its `toBlock`, logs or not.
 */
export function segmentsOf<T extends { blockNumber: bigint }>(
  logs: readonly T[],
  scan: Scan,
  max: number = MAX_LOGS_PER_WRITE,
): { fromBlock: bigint; toBlock: bigint; logs: T[] }[] {
  // A stable sort: the logs of one block keep the order the node answered them in.
  const sorted = [...logs].sort((a, b) =>
    a.blockNumber < b.blockNumber ? -1 : a.blockNumber > b.blockNumber ? 1 : 0,
  )
  const segments: { fromBlock: bigint; toBlock: bigint; logs: T[] }[] = []
  let current: T[] = []
  let from = scan.fromBlock
  for (let index = 0; index < sorted.length;) {
    const block = sorted[index]!.blockNumber
    let end = index
    while (end < sorted.length && sorted[end]!.blockNumber === block) end++
    if (current.length > 0 && current.length + (end - index) > max) {
      segments.push({ fromBlock: from, toBlock: block - 1n, logs: current })
      from = block
      current = []
    }
    current = current.concat(sorted.slice(index, end))
    index = end
  }
  segments.push({ fromBlock: from, toBlock: scan.toBlock, logs: current })
  return segments
}

/**
 * The wait from a pass's start to the next: `behind` while a cursor is still below the safe block after it (a
 * backfill), else `fast` when it recorded anything or the chain's reader is at its fast or live tier, else
 * `idle`.
 */
export function passDelayMs(
  pass: { behind: boolean; recorded: boolean; tier: Tier | null },
  delays: { behind: number; fast: number; idle: number } = PASS_MS,
): number {
  if (pass.behind) return delays.behind
  return pass.recorded || pass.tier === 'fast' || pass.tier === 'live' ? delays.fast : delays.idle
}
```

Create `apps/freshness/src/activity.ts`:

```ts
import type { MintBody, StateActivity } from '@cobweb/shared'
import { getAddress, type Address } from 'viem'

/**
 * A collection's activity for the state body (docs/specs/2026-10-16-indexer-overview.md, section 6.6), pure:
 * the holders and the latest mints from the indexer's summary, while the indexer has read the collection to
 * the chain's confirmation depth within 300 s of chain time.
 */

/**
 * How far, in seconds of chain time, the indexer's last read to the safe block may trail the state's block.
 */
export const ACTIVITY_LAG_MAX_S = 300
/** The most mints the state body carries. */
export const RECENT_MINTS = 10

/**
 * A cursor's summary as `indexer_record` and `indexer_summaries` answer it: its holders and its latest mints,
 * newest first, recipients as the database holds them (lowercase); `syncedAt` in Unix seconds.
 */
export type Summary = {
  collectionId: string
  contract: Address
  holders: number
  syncedAt: number | null
  recentMints: MintBody[]
}

/**
 * The state body's `activity`: null without a summary, before the indexer's first read to the safe block
 * (`syncedAt` null, the cursor's in memory), and while that read is more than 300 s of chain time behind
 * `blockTimestamp`; otherwise the holders and the first 10 mints, recipients checksummed.
 */
export function activityOf(
  summary: Summary | undefined,
  syncedAt: number | null,
  blockTimestamp: number,
): StateActivity | null {
  if (!summary || syncedAt === null || blockTimestamp - syncedAt > ACTIVITY_LAG_MAX_S) return null
  return {
    holders: summary.holders,
    recentMints: summary.recentMints
      .slice(0, RECENT_MINTS)
      .map((mint) => ({ ...mint, recipient: getAddress(mint.recipient) })),
  }
}
```

- [ ] **Step 6: Run the tests to see them pass, then typecheck and lint both packages**

Run: `pnpm --filter @cobweb/freshness exec vitest run src/indexer-records.test.ts src/indexer-plan.test.ts src/activity.test.ts`
Expected: PASS, `Test Files  3 passed (3)` and `Tests  31 passed (31)`.

Run: `pnpm --filter @cobweb/shared typecheck && pnpm --filter @cobweb/shared lint && pnpm --filter @cobweb/freshness typecheck && pnpm --filter @cobweb/freshness lint`
Expected: no errors and no warnings.

- [ ] **Step 7: Format, run the root checks and commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
pnpm exec prettier --write packages/shared/src/freshness-wire.ts apps/freshness/src/indexer-records.ts apps/freshness/src/indexer-plan.ts apps/freshness/src/activity.ts apps/freshness/src/indexer-records.test.ts apps/freshness/src/indexer-plan.test.ts apps/freshness/src/activity.test.ts
pnpm typecheck && pnpm lint && pnpm test
git add packages/shared/src/freshness-wire.ts apps/freshness/src/indexer-records.ts apps/freshness/src/indexer-plan.ts apps/freshness/src/activity.ts apps/freshness/src/indexer-records.test.ts apps/freshness/src/indexer-plan.test.ts apps/freshness/src/activity.test.ts
git commit -m "$(cat <<'EOF'
Add the indexer's wire types and its pure modules: the records of a segment's logs, the plan and pace of each pass, and the state body's activity

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: the freshness package reports 143 tests in 14 files; the others are unchanged (web 877, shared 105).

---

### Task 3: The indexer in the freshness server: the database port, the passes, the options, the start and stop, and `/health`

**Kind:** integration. The plan carries every line, but the task changes the running server's start, stop and `/health` and drives one chain's passes on fake timers: an Opus implementer.

**Files:**

- Create: `apps/freshness/src/indexer-db.ts`, `apps/freshness/src/indexer.ts`, and the tests `apps/freshness/src/indexer-db.test.ts`, `indexer.test.ts`
- Modify: `apps/freshness/package.json` (one dependency), `pnpm-lock.yaml` (by `pnpm install --offline`), `apps/freshness/src/config.ts` (the options), `health.ts` (the indexer's health and the chain's entry), `chain-reader.ts` (its health's type, two lines), `server.ts` (the option, the indexers, `/health`, the stop, the start line), `index.ts` (the start), `config.test.ts` and `health.test.ts` (a block each)
- Test: the four test files, the freshness package, then `verify:freshness`

**Interfaces:**

- Consumes: Task 1's four functions; Task 2's `INDEX_EVENTS`, `IndexLog`, `Records`, `eventBlocksOf`, `recordsOf`, `MAX_RANGE`, `PASS_MS`, `TARGETS_EVERY_MS`, `CURSOR_WRITE_EVERY_MS`, `Cursor`, `Scan`, `safeBlockOf`, `scansOf`, `segmentsOf`, `passDelayMs`, `ACTIVITY_LAG_MAX_S`, `Summary` and `activityOf`; `errorName` and `failureLine` from `health.ts`; the reader's `health().tier`; `publicClientFor` from `@cobweb/shared/clients`; `createClient` from `@supabase/supabase-js`.
- Produces:
  - `config.ts`: `IndexerOptions = { supabaseUrl: string; serviceRoleKey: string; passMs?: { behind: number; fast: number; idle: number }; targetsEveryMs?: number }`, `indexerOptionsOf(env: Record<string, string | undefined>): IndexerOptions | null` (null with neither variable; a `BaseError` named `ConfigurationError` with one alone)
  - `health.ts`: `ReaderHealth` (the reader's fields, unchanged), `IndexerHealth = { collections: number; behind: number; block: number | null; lastPassAt: string | null; failedPasses: number; lastError: string | null; unpaired: number }`, `ChainHealth = ReaderHealth & { indexer: IndexerHealth | null }`, `chainHealth(reader: ReaderHealth, indexer: IndexerHealth | null): ChainHealth` (Decision 3)
  - `indexer-db.ts`: `Target = { collectionId: string; contract: Address; deployTx: Hex; fromBlock: bigint | null; indexedBlock: bigint | null; syncedAt: number | null }`, `RecordWrite = { chainId: number; fromBlock: bigint; toBlock: bigint; syncedAt: number | null; collections: string[]; records: Records }`, `IndexerDb = { targets(chainId: number): Promise<Target[]>; start(collectionId: string, fromBlock: bigint): Promise<void>; record(write: RecordWrite): Promise<Summary[]>; summaries(chainId: number): Promise<Summary[]> }`, `DB_TIMEOUT_MS = 10_000`, `class IndexerWriteError extends Error { code: string; gap: boolean }`, `supabaseIndexerDb(options: IndexerOptions, fetchImpl?: typeof fetch): IndexerDb`, and `Summary` re-exported
  - `indexer.ts`: `chainIndexer(chain: ChainConfig, client: PublicClient, db: IndexerDb, options: { tier(): Tier | null; passMs?: IndexerOptions['passMs']; targetsEveryMs?: number }): { activityOf(address: Address, blockTimestamp: number): StateActivity | null; health(): IndexerHealth; stop(): Promise<void> }`, `ChainIndexer`, and `IndexerHealth` re-exported
  - `server.ts`: `FreshnessOptions` gains `indexer?: IndexerOptions | null`; `./server` also exports `IndexerOptions`; `/health`'s chains gain `indexer`; the start line names the indexer's chains or says it is off; `index.ts` passes `indexerOptionsOf(process.env)`

- [ ] **Step 1: Write the failing tests**

`indexer-db.test.ts` drives the port through supabase-js against a fake `fetch`, the call that never answers included (Decision 17, Review Focus 1). `indexer.test.ts` runs one chain's passes on a fake chain and a fake database with fake timers; its cases for the fast delay after a failure and a started collection's empty summary pin Review Focus 2 and 4.

Create `apps/freshness/src/indexer-db.test.ts`:

```ts
import type { Address, Hex } from 'viem'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { failureLine } from './health.ts'
import { DB_TIMEOUT_MS, IndexerWriteError, supabaseIndexerDb, type RecordWrite } from './indexer-db.ts'

const URL_BASE = 'http://127.0.0.1:54321'
const KEY = 'service-role-key-value'
const ID = '0a977c0b-7e53-476b-8c08-6c685315c3af'
const CONTRACT: Address = '0x0409454c375c8a6ab05383bfb6d9fcde9ebb8f85'
const MINTER: Address = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8'
const DEPLOY: Hex = `0x${'da'.repeat(32)}`
const MINT_TX: Hex = `0x${'0b'.repeat(32)}`

/** A JSON answer as PostgREST gives it. */
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
/** PostgREST's answer to a function that raised. */
const refusal = (code: string, message: string, status = 400) =>
  json({ code, message, details: null, hint: null }, status)

type Sent = { fn: string; args: Record<string, unknown>; apikey: string | null }

/**
 * A fetch answering each call with the next answer: a response, a network failure, or `hang`, which never
 * answers and fails only when its signal aborts. It records each function called, its arguments and the key.
 */
function fakeFetch(...answers: (Response | 'hang' | 'down')[]) {
  const sent: Sent[] = []
  const impl = ((input: string | URL, init?: RequestInit) => {
    sent.push({
      fn: new URL(String(input)).pathname.replace('/rest/v1/rpc/', ''),
      args: JSON.parse(String(init?.body)) as Record<string, unknown>,
      apikey: new Headers(init?.headers).get('apikey'),
    })
    const answer = answers.shift()
    if (answer === 'down') return Promise.reject(new TypeError('fetch failed'))
    if (answer === 'hang')
      return new Promise((_, reject) =>
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('This operation was aborted', 'AbortError')),
        ),
      )
    return Promise.resolve(answer ?? json(null))
  }) as typeof fetch
  return { sent, db: supabaseIndexerDb({ supabaseUrl: URL_BASE, serviceRoleKey: KEY }, impl) }
}

/** What a promise settles to: its value, or the error it rejected with. */
const settled = <T>(promise: Promise<T>) =>
  promise.then(
    (value) => value,
    (error: unknown) => error,
  )

describe('supabaseIndexerDb (docs/specs/2026-10-16-indexer-overview.md, section 6.2)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('reads the targets with the service role key, blocks as bigints and null without a cursor', async () => {
    const { sent, db } = fakeFetch(
      json([
        {
          collectionId: ID,
          contract: CONTRACT,
          deployTx: DEPLOY,
          fromBlock: null,
          indexedBlock: null,
          syncedAt: null,
        },
        {
          collectionId: ID,
          contract: CONTRACT,
          deployTx: DEPLOY,
          fromBlock: 50,
          indexedBlock: 120,
          syncedAt: 1_800_000_120,
        },
      ]),
    )
    expect(await db.targets(31337)).toEqual([
      {
        collectionId: ID,
        contract: CONTRACT,
        deployTx: DEPLOY,
        fromBlock: null,
        indexedBlock: null,
        syncedAt: null,
      },
      {
        collectionId: ID,
        contract: CONTRACT,
        deployTx: DEPLOY,
        fromBlock: 50n,
        indexedBlock: 120n,
        syncedAt: 1_800_000_120,
      },
    ])
    expect(sent).toEqual([{ fn: 'indexer_targets', args: { p_chain_id: 31337 }, apikey: KEY }])
  })

  it('writes a segment with its blocks as numbers and its sync time as ISO, and answers whole summaries', async () => {
    const answer = {
      [ID]: {
        collectionId: ID,
        contract: CONTRACT,
        holders: 2,
        syncedAt: 1_800_000_100,
        recentMints: [
          {
            tx: MINT_TX,
            recipient: MINTER,
            groupId: 1,
            amount: 2,
            firstTokenId: 5,
            blockTime: 1_800_000_090,
          },
        ],
      },
    }
    const { sent, db } = fakeFetch(json(answer), json({}))
    const write: RecordWrite = {
      chainId: 31337,
      fromBlock: 91n,
      toBlock: 100n,
      syncedAt: 1_800_000_100,
      collections: [ID],
      records: { mints: [], owners: [], airdrops: [], withdrawals: [] },
    }
    expect(await db.record(write)).toEqual([
      {
        collectionId: ID,
        contract: CONTRACT,
        holders: 2,
        syncedAt: 1_800_000_100,
        recentMints: [
          {
            txHash: MINT_TX,
            recipient: MINTER,
            groupId: 1,
            amount: 2,
            firstTokenId: 5,
            blockTimestamp: 1_800_000_090,
          },
        ],
      },
    ])
    expect(sent[0]).toEqual({
      fn: 'indexer_record',
      args: {
        p_chain_id: 31337,
        p_from_block: 91,
        p_to_block: 100,
        p_synced_at: new Date(1_800_000_100_000).toISOString(),
        p_collections: [ID],
        p_records: { mints: [], owners: [], airdrops: [], withdrawals: [] },
      },
      apikey: KEY,
    })
    // A write that leaves the cursor unsynced sends no time, and a write naming no collection answers none.
    expect(await db.record({ ...write, syncedAt: null })).toEqual([])
    expect(sent[1]?.args.p_synced_at).toBeNull()
  })

  it('starts a cursor at its block, and loads the summaries', async () => {
    const { sent, db } = fakeFetch(json({}), json([]))
    await db.start(ID, 50n)
    expect(await db.summaries(31337)).toEqual([])
    expect(sent.map(({ fn, args }) => [fn, args])).toEqual([
      ['indexer_start', { p_collection_id: ID, p_from_block: 50 }],
      ['indexer_summaries', { p_chain_id: 31337 }],
    ])
  })

  it("names a refusal by its function and code, a gap for a skip and an unindexed collection, never the database's message", async () => {
    const { db } = fakeFetch(
      refusal('23514', 'The indexer would skip blocks.'),
      refusal('23514', 'A collection is not indexed on this chain.'),
      refusal('23514', 'A record names a collection outside this write.'),
      refusal(
        'PGRST202',
        'Could not find the function public.indexer_targets(p_chain_id) in the schema cache',
        404,
      ),
    )
    const write: RecordWrite = {
      chainId: 31337,
      fromBlock: 1n,
      toBlock: 2n,
      syncedAt: null,
      collections: [ID],
      records: { mints: [], owners: [], airdrops: [], withdrawals: [] },
    }
    const errors = [
      await settled(db.record(write)),
      await settled(db.record(write)),
      await settled(db.record(write)),
      await settled(db.targets(31337)),
    ]
    expect(errors.map((error) => error instanceof IndexerWriteError && [error.code, error.gap])).toEqual([
      ['23514', true],
      ['23514', true],
      ['23514', false],
      ['PGRST202', false],
    ])
    expect((errors[0] as Error).message).toBe("The indexer's indexer_record call failed (23514).")
    expect(errors.map((error) => failureLine(error))).toEqual([
      'IndexerWriteError (23514)',
      'IndexerWriteError (23514)',
      'IndexerWriteError (23514)',
      'IndexerWriteError (PGRST202)',
    ])
  })

  it('names a call no database answered NETWORK', async () => {
    const { db } = fakeFetch('down')
    const error = await settled(db.summaries(31337))
    expect(error instanceof IndexerWriteError && [error.code, error.gap]).toEqual(['NETWORK', false])
  })

  it('abandons a call that has not answered after 10 s, so it cannot hold a pass (Review Focus 1)', async () => {
    vi.useFakeTimers()
    const { db } = fakeFetch('hang')
    let outcome: unknown = 'waiting'
    void settled(db.summaries(31337)).then((value) => {
      outcome = value
    })
    await vi.advanceTimersByTimeAsync(DB_TIMEOUT_MS - 1)
    expect(outcome).toBe('waiting')
    await vi.advanceTimersByTimeAsync(1)
    expect(outcome instanceof IndexerWriteError && [outcome.code, outcome.message]).toEqual([
      'TIMEOUT',
      "The indexer's indexer_summaries call failed (TIMEOUT).",
    ])
  })
})
```

Create `apps/freshness/src/indexer.test.ts`:

```ts
import { chainById, type ChainConfig } from '@cobweb/shared'
import {
  getAddress,
  HttpRequestError,
  TransactionReceiptNotFoundError,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Summary } from './activity.ts'
import { IndexerWriteError, type IndexerDb, type RecordWrite, type Target } from './indexer-db.ts'
import type { IndexLog } from './indexer-records.ts'
import { chainIndexer } from './indexer.ts'
import type { Tier } from './tiers.ts'

/** Anvil asks for 1 confirmation, so the safe block is the head. */
const ANVIL: ChainConfig = chainById(31337, false)!
const A: Address = '0x0409454C375c8a6aB05383bFB6D9FcDe9ebB8F85'
const B: Address = '0x5FbDB2315678afecb367f032d93F642f64180aa3'
const MINTER: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const ID_A = '0a977c0b-7e53-476b-8c08-6c685315c3af'
const ID_B = '7d2c9e10-5b44-4a6f-9c3e-2f1b8a7d6e5c'
const DEPLOY_A: Hex = `0x${'da'.repeat(32)}`
const DEPLOY_B: Hex = `0x${'db'.repeat(32)}`
const TX = (n: bigint): Hex => `0x${n.toString(16).padStart(64, '0')}`
/** Each block's time: 1,800,000,000 plus the block. */
const timeOf = (block: bigint) => 1_800_000_000 + Number(block)
const NO_RECORDS = { mints: [], owners: [], airdrops: [], withdrawals: [] }

/** A mint of one token in its own transaction at a block, decoded as getLogs answers it. */
const mintAt = (block: bigint, tokenId: bigint, contract: Address = A, amount = 1n): IndexLog[] => [
  {
    address: contract,
    eventName: 'Transfer',
    args: { from: zeroAddress, to: MINTER, tokenId },
    blockNumber: block,
    logIndex: 0,
    transactionHash: TX(block),
  },
  {
    address: contract,
    eventName: 'TokensMinted',
    args: { recipient: MINTER, amount, mintGroup: 0n },
    blockNumber: block,
    logIndex: 1,
    transactionHash: TX(block),
  },
]

/**
 * A fake chain recording every call as `head`, `time <block>`, `logs <from>-<to> x<addresses>` or
 * `receipt <hash>`. Its getLogs answers the logs of the addresses and blocks asked for.
 */
function fakeChain() {
  const chain = {
    head: 100n,
    logs: [] as IndexLog[],
    receipts: new Map<Hex, bigint>([[DEPLOY_A, 50n]]),
    calls: [] as string[],
    /** The next getLogs calls fail while this is above 0. */
    logsFailures: 0,
    /** When set, every head read waits for it. */
    gate: null as Promise<void> | null,
  }
  const client = {
    async getBlock(args: { blockTag?: 'latest'; blockNumber?: bigint }) {
      if (args.blockNumber === undefined) {
        chain.calls.push('head')
        if (chain.gate) await chain.gate
        return { number: chain.head, timestamp: BigInt(timeOf(chain.head)) }
      }
      chain.calls.push(`time ${args.blockNumber}`)
      return { number: args.blockNumber, timestamp: BigInt(timeOf(args.blockNumber)) }
    },
    async getLogs({
      address,
      fromBlock,
      toBlock,
    }: {
      address: Address[]
      fromBlock: bigint
      toBlock: bigint
    }) {
      chain.calls.push(`logs ${fromBlock}-${toBlock} x${address.length}`)
      if (chain.logsFailures > 0) {
        chain.logsFailures--
        // A provider refusing the range; viem's message carries the URL, with the provider's key.
        throw new HttpRequestError({ url: 'https://rpc.example/v2/secret-key', status: 413 })
      }
      const asked = new Set(address.map((contract) => contract.toLowerCase()))
      return chain.logs.filter(
        (log) =>
          asked.has(log.address.toLowerCase()) && log.blockNumber >= fromBlock && log.blockNumber <= toBlock,
      )
    },
    async getTransactionReceipt({ hash }: { hash: Hex }) {
      chain.calls.push(`receipt ${hash}`)
      const blockNumber = chain.receipts.get(hash)
      if (blockNumber === undefined) throw new TransactionReceiptNotFoundError({ hash })
      return { blockNumber }
    },
  } as unknown as PublicClient
  return { chain, client }
}

/** A target with its cursor at a block, synced at that block's time unless `synced` is false. */
const targetAt = (
  collectionId: string,
  contract: Address,
  deployTx: Hex,
  indexed: bigint | null,
  synced = true,
): Target => ({
  collectionId,
  contract: contract.toLowerCase() as Address,
  deployTx,
  fromBlock: indexed === null ? null : 50n,
  indexedBlock: indexed,
  syncedAt: indexed !== null && synced ? timeOf(indexed) : null,
})

/** A summary as the database answers it: recipients lowercase. */
const summaryOf = (
  collectionId: string,
  contract: Address,
  holders: number,
  mints: bigint[] = [],
): Summary => ({
  collectionId,
  contract: contract.toLowerCase() as Address,
  holders,
  syncedAt: null,
  recentMints: mints.map((block) => ({
    txHash: TX(block),
    recipient: MINTER.toLowerCase() as Address,
    groupId: 0,
    amount: 1,
    firstTokenId: Number(block),
    blockTimestamp: timeOf(block),
  })),
})

/**
 * A fake database recording every call as `summaries`, `targets`, `start <id> <block>` or
 * `record <from>-<to>`. A write moves its targets' cursors as indexer_record does, and answers
 * `answer(write)`.
 */
function fakeDb(targets: Target[]) {
  const db = {
    targets,
    calls: [] as string[],
    writes: [] as RecordWrite[],
    summaries: [] as Summary[],
    summariesFailures: 0,
    /** The next writes throw these, in order. */
    recordFailures: [] as Error[],
    answer: (write: RecordWrite): Summary[] => {
      void write
      return []
    },
  }
  const port: IndexerDb = {
    async targets() {
      db.calls.push('targets')
      return db.targets.map((target) => ({ ...target }))
    },
    async start(collectionId, fromBlock) {
      db.calls.push(`start ${collectionId} ${fromBlock}`)
      const target = db.targets.find((entry) => entry.collectionId === collectionId)!
      target.fromBlock = fromBlock
      target.indexedBlock = fromBlock - 1n
    },
    async record(write) {
      db.calls.push(`record ${write.fromBlock}-${write.toBlock}`)
      const failure = db.recordFailures.shift()
      if (failure) throw failure
      db.writes.push(write)
      for (const id of write.collections) {
        const target = db.targets.find((entry) => entry.collectionId === id)!
        if (target.indexedBlock === null || target.indexedBlock < write.toBlock)
          target.indexedBlock = write.toBlock
        if (write.syncedAt !== null) target.syncedAt = write.syncedAt
      }
      return db.answer(write)
    },
    async summaries() {
      db.calls.push('summaries')
      if (db.summariesFailures > 0) {
        db.summariesFailures--
        throw new IndexerWriteError('indexer_summaries', 'NETWORK', false)
      }
      return db.summaries
    },
  }
  return { db, port }
}

/** Lets the indexer's promises run, at the fake clock's current time. */
const settle = () => vi.advanceTimersByTimeAsync(0)
/** The indexer on Anvil at the default pace, its chain's reader at `tier`. */
const indexerOn = (client: PublicClient, port: IndexerDb, tier: Tier | null = 'idle') =>
  chainIndexer(ANVIL, client, port, { tier: () => tier })
const logCalls = (calls: string[]) => calls.filter((call) => call.startsWith('logs'))

describe('chainIndexer (docs/specs/2026-10-16-indexer-overview.md, section 6.5)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('loads the summaries before it reads the targets and the chain, and answers the activity from them', async () => {
    const { chain, client } = fakeChain()
    const { db, port } = fakeDb([targetAt(ID_A, A, DEPLOY_A, 100n)])
    db.summaries = [summaryOf(ID_A, A, 3, [99n])]
    const indexer = indexerOn(client, port)
    await settle()
    expect(db.calls).toEqual(['summaries', 'targets'])
    expect(chain.calls).toEqual(['head'])
    expect(indexer.activityOf(A, timeOf(100n))).toEqual({
      holders: 3,
      recentMints: [
        {
          txHash: TX(99n),
          recipient: MINTER,
          groupId: 0,
          amount: 1,
          firstTokenId: 99,
          blockTimestamp: timeOf(99n),
        },
      ],
    })
    await indexer.stop()
  })

  it('answers no activity while the summaries fail to load, and loads them on the next pass', async () => {
    const { client } = fakeChain()
    const { db, port } = fakeDb([targetAt(ID_A, A, DEPLOY_A, 100n)])
    db.summaries = [summaryOf(ID_A, A, 3)]
    db.summariesFailures = 1
    const indexer = indexerOn(client, port)
    await settle()
    expect(indexer.activityOf(A, timeOf(100n))).toBeNull()
    expect(indexer.health()).toMatchObject({ failedPasses: 1, lastError: 'IndexerWriteError' })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(db.calls.filter((call) => call === 'summaries')).toHaveLength(2)
    expect(indexer.activityOf(A, timeOf(100n))?.holders).toBe(3)
    await indexer.stop()
  })

  it('reads the targets every 60 s, starts a new one at its deploy block, and tries a missing receipt at the next read', async () => {
    const { chain, client } = fakeChain()
    const { db, port } = fakeDb([targetAt(ID_A, A, DEPLOY_A, null)])
    const indexer = indexerOn(client, port)
    await settle()
    expect(db.calls).toEqual(['summaries', 'targets', `start ${ID_A} 50`, 'record 50-100'])
    expect(chain.calls).toEqual([`receipt ${DEPLOY_A}`, 'head', 'logs 50-100 x1'])
    db.targets.push(targetAt(ID_B, B, DEPLOY_B, null))
    db.calls.length = 0
    await vi.advanceTimersByTimeAsync(40_000)
    expect(db.calls).toEqual([])
    await vi.advanceTimersByTimeAsync(20_000)
    expect(db.calls).toEqual(['targets'])
    expect(console.error).toHaveBeenCalledWith(
      `The deploy of ${ID_B} on Anvil could not be read; it is tried again in a minute.`,
    )
    chain.receipts.set(DEPLOY_B, 70n)
    db.calls.length = 0
    await vi.advanceTimersByTimeAsync(60_000)
    expect(db.calls).toEqual(['targets', `start ${ID_B} 70`, 'record 70-100'])
    await indexer.stop()
  })

  it('writes from one above the lowest written block of the scan, once groups merge', async () => {
    const { chain, client } = fakeChain()
    const { db, port } = fakeDb([targetAt(ID_A, A, DEPLOY_A, 100n), targetAt(ID_B, B, DEPLOY_B, 90n)])
    const indexer = indexerOn(client, port)
    await settle()
    // B reads 91 to 100 with nothing to record and defers its write; both cursors now read 100.
    expect(logCalls(chain.calls)).toEqual(['logs 91-100 x1'])
    expect(db.writes).toEqual([])
    chain.head = 110n
    chain.logs = mintAt(105n, 1n, B)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(logCalls(chain.calls)).toEqual(['logs 91-100 x1', 'logs 101-110 x2'])
    expect(db.writes).toMatchObject([
      { chainId: 31337, fromBlock: 91n, toBlock: 110n, syncedAt: timeOf(110n), collections: [ID_A, ID_B] },
    ])
    await indexer.stop()
  })

  it('defers an empty pass to a minute while its cursor reads synced, then writes the blocks it read', async () => {
    const { chain, client } = fakeChain()
    const { db, port } = fakeDb([targetAt(ID_A, A, DEPLOY_A, 100n)])
    db.summaries = [summaryOf(ID_A, A, 1)]
    const indexer = indexerOn(client, port)
    await settle()
    for (const head of [101n, 102n]) {
      chain.head = head
      await vi.advanceTimersByTimeAsync(20_000)
      expect(db.writes).toEqual([])
      // Synced at the head in memory, so the state 300 s on still carries the activity.
      expect(indexer.activityOf(A, timeOf(head) + 300)?.holders).toBe(1)
      expect(indexer.activityOf(A, timeOf(head) + 301)).toBeNull()
    }
    chain.head = 103n
    await vi.advanceTimersByTimeAsync(20_000)
    expect(db.writes).toEqual([
      {
        chainId: 31337,
        fromBlock: 101n,
        toBlock: 103n,
        syncedAt: timeOf(103n),
        collections: [ID_A],
        records: NO_RECORDS,
      },
    ])
    await indexer.stop()
  })

  it('writes a first read to the safe block at once', async () => {
    const { chain, client } = fakeChain()
    const { db, port } = fakeDb([targetAt(ID_A, A, DEPLOY_A, 90n, false)])
    const indexer = indexerOn(client, port)
    await settle()
    expect(logCalls(chain.calls)).toEqual(['logs 91-100 x1'])
    expect(db.writes).toEqual([
      {
        chainId: 31337,
        fromBlock: 91n,
        toBlock: 100n,
        syncedAt: timeOf(100n),
        collections: [ID_A],
        records: NO_RECORDS,
      },
    ])
    await indexer.stop()
  })

  it('answers 0 holders and no mint for a collection it started, once read to the safe block (Review Focus 4)', async () => {
    const { client } = fakeChain()
    const { port } = fakeDb([targetAt(ID_A, A, DEPLOY_A, null)])
    const indexer = indexerOn(client, port)
    await settle()
    expect(indexer.activityOf(A, timeOf(100n))).toEqual({ holders: 0, recentMints: [] })
    await indexer.stop()
  })

  it('rewinds a failed write to the written block and reads the range again', async () => {
    const { chain, client } = fakeChain()
    const { db, port } = fakeDb([targetAt(ID_A, A, DEPLOY_A, 100n)])
    chain.head = 103n
    chain.logs = mintAt(102n, 1n)
    db.recordFailures = [new IndexerWriteError('indexer_record', 'NETWORK', false)]
    const indexer = indexerOn(client, port)
    await settle()
    expect(db.calls).toContain('record 101-103')
    expect(db.writes).toEqual([])
    expect(indexer.health()).toMatchObject({ failedPasses: 1, lastError: 'IndexerWriteError' })
    expect(console.error).toHaveBeenCalledWith('The index write on Anvil failed: IndexerWriteError (NETWORK)')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(logCalls(chain.calls)).toEqual(['logs 101-103 x1', 'logs 101-103 x1'])
    expect(db.writes).toHaveLength(1)
    expect(db.writes[0]).toMatchObject({ fromBlock: 101n, toBlock: 103n, syncedAt: timeOf(103n) })
    expect(db.writes[0]!.records.mints).toMatchObject([{ collectionId: ID_A, block: 102, firstTokenId: 1 }])
    await indexer.stop()
  })

  it('waits the fast delay after a failed write rather than the backfill 1 s (Review Focus 2)', async () => {
    const { chain, client } = fakeChain()
    const { db, port } = fakeDb([targetAt(ID_A, A, DEPLOY_A, 0n, false)])
    chain.head = 2_000n
    chain.logs = mintAt(100n, 1n)
    db.recordFailures = [new IndexerWriteError('indexer_record', 'NETWORK', false)]
    const indexer = indexerOn(client, port)
    await settle()
    expect(logCalls(chain.calls)).toEqual(['logs 1-500 x1'])
    await vi.advanceTimersByTimeAsync(4_999)
    expect(logCalls(chain.calls)).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(logCalls(chain.calls)).toEqual(['logs 1-500 x1', 'logs 1-500 x1'])
    // Written this time, so the backfill goes on 1 s later.
    await vi.advanceTimersByTimeAsync(1_000)
    expect(logCalls(chain.calls)).toEqual(['logs 1-500 x1', 'logs 1-500 x1', 'logs 501-1000 x1'])
    await indexer.stop()
  })

  it('reads the targets again after a gap refusal and takes the database cursor', async () => {
    const { chain, client } = fakeChain()
    const { db, port } = fakeDb([targetAt(ID_A, A, DEPLOY_A, 100n)])
    chain.head = 105n
    chain.logs = mintAt(103n, 1n)
    db.recordFailures = [new IndexerWriteError('indexer_record', '23514', true)]
    const indexer = indexerOn(client, port)
    await settle()
    // Another indexer recorded the blocks meanwhile.
    db.targets[0]!.indexedBlock = 105n
    db.targets[0]!.syncedAt = timeOf(105n)
    db.calls.length = 0
    chain.calls.length = 0
    await vi.advanceTimersByTimeAsync(5_000)
    expect(db.calls).toEqual(['targets'])
    expect(chain.calls).toEqual(['head'])
    await indexer.stop()
  })

  it('halves a failed scan range down to 1 and never below, then reads on with no block skipped', async () => {
    const { chain, client } = fakeChain()
    const { port } = fakeDb([targetAt(ID_A, A, DEPLOY_A, 0n, false)])
    chain.head = 2_000n
    chain.logsFailures = 9
    const indexer = indexerOn(client, port)
    await settle()
    await vi.advanceTimersByTimeAsync(9 * 5_000 + 1_000)
    expect(logCalls(chain.calls)).toEqual([
      'logs 1-500 x1',
      'logs 1-250 x1',
      'logs 1-125 x1',
      'logs 1-62 x1',
      'logs 1-31 x1',
      'logs 1-15 x1',
      'logs 1-7 x1',
      'logs 1-3 x1',
      'logs 1-1 x1',
      'logs 1-1 x1',
      'logs 2-501 x1',
    ])
    expect(indexer.health()).toMatchObject({ failedPasses: 9, lastError: 'HttpRequestError' })
    expect(console.error).toHaveBeenCalledWith(
      'The index scan of blocks 1 to 500 on Anvil failed, so its range halves: HttpRequestError: HTTP request failed.',
    )
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('secret-key')
    await indexer.stop()
  })

  it("follows each write's answer for the activity, and answers none for a contract it does not read", async () => {
    const { chain, client } = fakeChain()
    const { db, port } = fakeDb([targetAt(ID_A, A, DEPLOY_A, 100n)])
    db.summaries = [summaryOf(ID_A, A, 0)]
    db.answer = (write) => {
      const mints = chain.logs.filter((log) => log.eventName === 'TokensMinted').map((log) => log.blockNumber)
      return [{ ...summaryOf(ID_A, A, mints.length, mints.reverse()), syncedAt: write.syncedAt }]
    }
    const indexer = indexerOn(client, port, 'live')
    await settle()
    chain.head = 101n
    chain.logs = mintAt(101n, 1n)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(indexer.activityOf(A, timeOf(101n))).toMatchObject({
      holders: 1,
      recentMints: [{ txHash: TX(101n), recipient: MINTER, firstTokenId: 101 }],
    })
    chain.head = 102n
    chain.logs = [...chain.logs, ...mintAt(102n, 2n)]
    await vi.advanceTimersByTimeAsync(5_000)
    expect(indexer.activityOf(A, timeOf(102n))?.holders).toBe(2)
    expect(indexer.activityOf(A, timeOf(102n))?.recentMints.map((mint) => mint.firstTokenId)).toEqual([
      102, 101,
    ])
    expect(indexer.activityOf(getAddress(B), timeOf(102n))).toBeNull()
    await indexer.stop()
  })

  it('reports its collections, those behind, the safe block, the last pass, its failures and the unpaired mints', async () => {
    const { chain, client } = fakeChain()
    const { port } = fakeDb([targetAt(ID_A, A, DEPLOY_A, 100n), targetAt(ID_B, B, DEPLOY_B, null)])
    chain.head = 103n
    // A mint of 2 whose transaction moved one token: not recorded, its transfer still an owner.
    chain.logs = mintAt(102n, 1n, A, 2n)
    const indexer = indexerOn(client, port)
    await settle()
    expect(indexer.health()).toEqual({
      collections: 1,
      behind: 0,
      block: 103,
      lastPassAt: new Date(1_000_000).toISOString(),
      failedPasses: 0,
      lastError: null,
      unpaired: 1,
    })
    expect(console.error).toHaveBeenCalledWith(
      `A mint or airdrop in ${TX(102n)} on Anvil did not pair with its transfers and is not recorded.`,
    )
    await indexer.stop()
  })

  it('waits for the pass in flight when stopped, and makes no call after', async () => {
    const { chain, client } = fakeChain()
    const { db, port } = fakeDb([targetAt(ID_A, A, DEPLOY_A, 100n)])
    let release = () => {}
    chain.gate = new Promise((resolve) => {
      release = resolve
    })
    const indexer = indexerOn(client, port)
    await settle()
    let stopped = false
    const stopping = indexer.stop().then(() => {
      stopped = true
    })
    await settle()
    expect(stopped).toBe(false)
    release()
    await stopping
    const calls = chain.calls.length + db.calls.length
    await vi.advanceTimersByTimeAsync(120_000)
    expect(chain.calls.length + db.calls.length).toBe(calls)
  })
})
```

In `apps/freshness/src/config.test.ts`, replace:

```ts
import { availableChains } from '@cobweb/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PORT, portOf, servedChains } from './config.ts'
import { errorLine } from './health.ts'

```

with:

```ts
import { availableChains } from '@cobweb/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PORT, indexerOptionsOf, portOf, servedChains } from './config.ts'
import { errorLine } from './health.ts'

```

In `apps/freshness/src/config.test.ts`, replace:

```ts
    expect([portOf(undefined), portOf(''), portOf('4000')]).toEqual([3100, 3100, 4000])
  })
})
```

with:

```ts
    expect([portOf(undefined), portOf(''), portOf('4000')]).toEqual([3100, 3100, 4000])
  })
})

describe('indexerOptionsOf (docs/specs/2026-10-16-indexer-overview.md, section 6.1)', () => {
  const URL = 'http://127.0.0.1:54321'
  const KEY = 'service-role-key-value'

  it('answers the options from both variables, and null from neither or from blanks', () => {
    expect(indexerOptionsOf({ SUPABASE_URL: URL, SUPABASE_SERVICE_ROLE_KEY: KEY })).toEqual({
      supabaseUrl: URL,
      serviceRoleKey: KEY,
    })
    expect(indexerOptionsOf({})).toBeNull()
    expect(indexerOptionsOf({ SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' })).toBeNull()
  })

  it('refuses one set alone with a sentence naming both variables, never a value', () => {
    for (const env of [
      { SUPABASE_URL: URL },
      { SUPABASE_SERVICE_ROLE_KEY: KEY },
      { SUPABASE_URL: URL, SUPABASE_SERVICE_ROLE_KEY: '' },
    ]) {
      const line = errorLine(thrownBy(() => indexerOptionsOf(env)))
      expect(line).toBe(
        'ConfigurationError: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are both needed to run the indexer; set both or neither.',
      )
      expect(line).not.toContain(KEY)
    }
  })
})
```

In `apps/freshness/src/health.test.ts`, replace:

```ts
import { BaseError, HttpRequestError, LimitExceededRpcError, RpcRequestError } from 'viem'
import { describe, expect, it } from 'vitest'
import { errorLine, errorName, failureLine } from './health.ts'

/** An RPC URL as a provider issues it, its key in the path. */
```

with:

```ts
import { BaseError, HttpRequestError, LimitExceededRpcError, RpcRequestError } from 'viem'
import { describe, expect, it } from 'vitest'
import {
  chainHealth,
  errorLine,
  errorName,
  failureLine,
  type IndexerHealth,
  type ReaderHealth,
} from './health.ts'

/** An RPC URL as a provider issues it, its key in the path. */
```

In `apps/freshness/src/health.test.ts`, replace:

```ts
  })
})
```

with:

```ts
  })
})

describe('chainHealth (docs/specs/2026-10-16-indexer-overview.md, section 6.7)', () => {
  const reader: ReaderHealth = {
    chainId: 31337,
    name: 'Anvil',
    hot: 1,
    tier: 'live',
    block: 120,
    lagSeconds: 2,
    lastGoodTickAt: '2026-10-16T12:00:00.000Z',
    failedTicks: 0,
    lastError: null,
    logGaps: 0,
  }
  const indexer: IndexerHealth = {
    collections: 2,
    behind: 1,
    block: 119,
    lastPassAt: '2026-10-16T12:00:01.000Z',
    failedPasses: 3,
    lastError: 'IndexerWriteError',
    unpaired: 1,
  }

  it("keeps the reader's fields and adds the indexer's last, null while the indexer is off", () => {
    expect(chainHealth(reader, null)).toEqual({ ...reader, indexer: null })
    const on = chainHealth(reader, indexer)
    expect(Object.keys(on)).toEqual([...Object.keys(reader), 'indexer'])
    expect(on.indexer).toEqual(indexer)
    expect(Object.keys(on.indexer!)).toEqual([
      'collections',
      'behind',
      'block',
      'lastPassAt',
      'failedPasses',
      'lastError',
      'unpaired',
    ])
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @cobweb/freshness exec vitest run src/indexer-db.test.ts src/indexer.test.ts src/config.test.ts src/health.test.ts`
Expected: FAIL. The two new files fail to load (`Cannot find module './indexer-db.ts'`), and the new cases of the other two fail with `TypeError: indexerOptionsOf is not a function` and `TypeError: chainHealth is not a function`: `Test Files  4 failed (4)` and `Tests  3 failed | 10 passed (13)`.

- [ ] **Step 3: The database client**

The render worker's client and version (spec decision 3).

In `apps/freshness/package.json`, replace:

```json
  "dependencies": {
    "@cobweb/shared": "workspace:^",
    "viem": "^2.57.2"
  }
```

with:

```json
  "dependencies": {
    "@cobweb/shared": "workspace:^",
    "@supabase/supabase-js": "^2.117.2",
    "viem": "^2.57.2"
  }
```

Run: `pnpm install --offline`
Expected: the install ends `Done`, with the peer warnings the workspace already has.

Run: `git diff --stat pnpm-lock.yaml`
Expected: `pnpm-lock.yaml | 3 +++`.

The three lines are the freshness importer's `@supabase/supabase-js` at 2.117.2, the version the worker already resolves; nothing else in the lockfile moves.

- [ ] **Step 4: The options and the health shapes**

In `apps/freshness/src/config.ts`, replace:

```ts
  return chains
}
```

with:

```ts
  return chains
}

/**
 * The indexer's settings (docs/specs/2026-10-16-indexer-overview.md, section 6.1): its database, the
 * project's API URL and service role key, the names and the client the render worker uses; and the passes'
 * delays and the targets' read, which `verify:indexer` shortens.
 */
export type IndexerOptions = {
  supabaseUrl: string
  serviceRoleKey: string
  /** The wait from a pass's start to the next: during a backfill, while a chain is busy, otherwise. */
  passMs?: { behind: number; fast: number; idle: number }
  /** How often the deployed collections are read again. */
  targetsEveryMs?: number
}

/**
 * The indexer's options from `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, a blank one read as unset: null
 * when neither is set, so the indexer stays off. One set alone refuses the start, as a malformed factory
 * address does: a viem `BaseError` named `ConfigurationError` whose sentence names both variables, never a
 * value.
 */
export function indexerOptionsOf(env: Record<string, string | undefined>): IndexerOptions | null {
  const supabaseUrl = env.SUPABASE_URL ?? ''
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!supabaseUrl && !serviceRoleKey) return null
  if (!supabaseUrl || !serviceRoleKey)
    throw new BaseError(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are both needed to run the indexer; set both or neither.',
      { name: 'ConfigurationError' },
    )
  return { supabaseUrl, serviceRoleKey }
}
```

In `apps/freshness/src/health.ts`, replace:

```ts
/**
 * `/health` (docs/specs/2026-10-16-freshness-server.md, section 6.9), pure: what it reports per served chain
 * and for the server, and how a failure is named. It never carries an RPC URL or an error's message.
 */

export type ChainHealth = {
  chainId: number
  name: string
```

with:

```ts
/**
 * `/health` (docs/specs/2026-10-16-freshness-server.md, section 6.9), pure: what it reports per served chain
 * and for the server, and how a failure is named. It never carries an RPC URL, a key or an error's message.
 */

/** A chain's reader on /health. */
export type ReaderHealth = {
  chainId: number
  name: string
```

In `apps/freshness/src/health.ts`, replace:

```ts
  /** Log scans skipped or failed, whose collections were read in full instead. */
  logGaps: number
}

```

with:

```ts
  /** Log scans skipped or failed, whose collections were read in full instead. */
  logGaps: number
}

/** A chain's indexer on /health (docs/specs/2026-10-16-indexer-overview.md, section 6.7). */
export type IndexerHealth = {
  /** The collections with a cursor in this process. */
  collections: number
  /**
   * Those not read to the safe block yet, or last read there more than 300 s of chain time before the head.
   */
  behind: number
  /** The last safe block a pass reached; null before one. */
  block: number | null
  /** When the last pass ended (ISO); null before one. */
  lastPassAt: string | null
  /** Failures: each failed head, scan, block time, write or database read counts one. */
  failedPasses: number
  /** The last failure's error name, never its message. */
  lastError: string | null
  /** Mints and airdrops that did not pair with their transfers, so are not recorded. */
  unpaired: number
}

/** A chain on /health: its reader's fields, then its indexer's, null while the indexer is off. */
export type ChainHealth = ReaderHealth & { indexer: IndexerHealth | null }

/** A chain's /health entry from its reader and its indexer (null while the indexer is off). */
export function chainHealth(reader: ReaderHealth, indexer: IndexerHealth | null): ChainHealth {
  return { ...reader, indexer }
}

```

The reader keeps its tick; only its health's type is renamed (Decision 3).

In `apps/freshness/src/chain-reader.ts`, replace:

```ts
  type PublicClient,
} from 'viem'
import { errorLine, errorName, type ChainHealth } from './health.ts'
import type { HotEntry, HotSet } from './hot-set.ts'
import { scanLogs, type GetLogs } from './logs.ts'
```

with:

```ts
  type PublicClient,
} from 'viem'
import { errorLine, errorName, type ReaderHealth } from './health.ts'
import type { HotEntry, HotSet } from './hot-set.ts'
import { scanLogs, type GetLogs } from './logs.ts'
```

In `apps/freshness/src/chain-reader.ts`, replace:

```ts
  hot: HotSet,
  client: PublicClient,
): { wake(): void; stop(): Promise<void>; health(): ChainHealth; noteFailure(error: unknown): void } {
  /** The last block the logs were scanned to; null before the chain's first tick. */
  let scanned: bigint | null = null
```

with:

```ts
  hot: HotSet,
  client: PublicClient,
): { wake(): void; stop(): Promise<void>; health(): ReaderHealth; noteFailure(error: unknown): void } {
  /** The last block the logs were scanned to; null before the chain's first tick. */
  let scanned: bigint | null = null
```

- [ ] **Step 5: The database port**

Each call through `call`, abandoned after 10 s (Decision 8); a refusal is named by its function and code.

Create `apps/freshness/src/indexer-db.ts`:

```ts
import type { MintBody } from '@cobweb/shared'
import { createClient } from '@supabase/supabase-js'
import type { Address, Hex } from 'viem'
import type { Summary } from './activity.ts'
import type { IndexerOptions } from './config.ts'
import type { Records } from './indexer-records.ts'

/**
 * The indexer's database (docs/specs/2026-10-16-indexer-overview.md, section 6.2): the four service-role
 * functions of its migration, through supabase-js with the service role key, as the render worker's client.
 * The request path never uses it. A failure throws `IndexerWriteError`, which names the function and the
 * code, never the database's message or the key.
 */

export type { Summary } from './activity.ts'

/**
 * A deployed collection as `indexer_targets` lists it: without a cursor, its blocks and sync time are null.
 */
export type Target = {
  collectionId: string
  contract: Address
  deployTx: Hex
  fromBlock: bigint | null
  indexedBlock: bigint | null
  /** Unix seconds. */
  syncedAt: number | null
}

/** One write: one segment of one scan, for the scan's collections. */
export type RecordWrite = {
  chainId: number
  fromBlock: bigint
  toBlock: bigint
  /** The head's time when the segment ends at the safe block (Unix seconds), else null. */
  syncedAt: number | null
  collections: string[]
  records: Records
}

export type IndexerDb = {
  targets(chainId: number): Promise<Target[]>
  start(collectionId: string, fromBlock: bigint): Promise<void>
  record(write: RecordWrite): Promise<Summary[]>
  summaries(chainId: number): Promise<Summary[]>
}

/** How long one database call may take before it is abandoned and counts as failed (Review Focus 1). */
export const DB_TIMEOUT_MS = 10_000

/** The refusals that mean the cursors in memory no longer match the database's. */
const GAP_SENTENCES: readonly string[] = [
  'The indexer would skip blocks.',
  'A collection is not indexed on this chain.',
]

/**
 * A database call that failed: the function and the code, a Postgres code such as 23514, PostgREST's such as
 * PGRST202 (the migration is missing), or TIMEOUT or NETWORK when no answer came. `gap` when the refusal
 * means the cursors in memory no longer match the database's, so the targets are read again.
 */
export class IndexerWriteError extends Error {
  readonly code: string
  readonly gap: boolean

  constructor(fn: string, code: string, gap: boolean) {
    super(`The indexer's ${fn} call failed (${code}).`)
    this.name = 'IndexerWriteError'
    this.code = code
    this.gap = gap
  }
}

/**
 * A mint as the functions answer it: the transaction, the recipient as stored, the block's time in Unix
 * seconds.
 */
type DbMint = {
  tx: Hex
  recipient: Address
  groupId: number
  amount: number
  firstTokenId: number
  blockTime: number
}
type DbSummary = Omit<Summary, 'recentMints'> & { recentMints: DbMint[] }
type DbTarget = Omit<Target, 'fromBlock' | 'indexedBlock'> & {
  fromBlock: number | null
  indexedBlock: number | null
}

const summaryOf = (raw: DbSummary): Summary => ({
  collectionId: raw.collectionId,
  contract: raw.contract,
  holders: raw.holders,
  syncedAt: raw.syncedAt,
  recentMints: raw.recentMints.map((mint): MintBody => ({
    txHash: mint.tx,
    recipient: mint.recipient,
    groupId: mint.groupId,
    amount: mint.amount,
    firstTokenId: mint.firstTokenId,
    blockTimestamp: mint.blockTime,
  })),
})

const blockOf = (value: number | null) => (value === null ? null : BigInt(value))

/**
 * The port on supabase-js. Blocks travel as numbers, which hold any block below 2^53 exactly, and the sync
 * time as ISO. Each call is abandoned after `DB_TIMEOUT_MS`, so a connection that never answers cannot hold a
 * chain's passes, which never overlap, or the server's close.
 */
export function supabaseIndexerDb(options: IndexerOptions, fetchImpl: typeof fetch = fetch): IndexerDb {
  const client = createClient(options.supabaseUrl, options.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fetchImpl },
  })

  async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const timeout = new AbortController()
    const timer = setTimeout(() => timeout.abort(), DB_TIMEOUT_MS)
    try {
      const { data, error } = await client.rpc(fn, args).abortSignal(timeout.signal)
      if (error) {
        const code = error.code || (timeout.signal.aborted ? 'TIMEOUT' : 'NETWORK')
        throw new IndexerWriteError(fn, code, GAP_SENTENCES.includes(error.message))
      }
      return data as T
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    async targets(chainId) {
      const rows = await call<DbTarget[]>('indexer_targets', { p_chain_id: chainId })
      return rows.map((row) => ({
        ...row,
        fromBlock: blockOf(row.fromBlock),
        indexedBlock: blockOf(row.indexedBlock),
      }))
    },
    async start(collectionId, fromBlock) {
      await call('indexer_start', { p_collection_id: collectionId, p_from_block: Number(fromBlock) })
    },
    async record(write) {
      const answer = await call<Record<string, DbSummary>>('indexer_record', {
        p_chain_id: write.chainId,
        p_from_block: Number(write.fromBlock),
        p_to_block: Number(write.toBlock),
        p_synced_at: write.syncedAt === null ? null : new Date(write.syncedAt * 1_000).toISOString(),
        p_collections: write.collections,
        p_records: write.records,
      })
      return Object.values(answer).map(summaryOf)
    },
    async summaries(chainId) {
      return (await call<DbSummary[]>('indexer_summaries', { p_chain_id: chainId })).map(summaryOf)
    },
  }
}
```

- [ ] **Step 6: One chain's passes**

The summaries until they load, the targets every minute or after a gap, the head, then the plan's scans, each segment written or deferred; a pass with a failure waits the fast delay (Decision 7); a cursor this process starts gets an empty summary (Decision 9); an unreadable deploy is logged once a minute (Decision 10).

Create `apps/freshness/src/indexer.ts`:

```ts
import type { ChainConfig, StateActivity } from '@cobweb/shared'
import type { Address, PublicClient } from 'viem'
import { ACTIVITY_LAG_MAX_S, activityOf as activityFrom, type Summary } from './activity.ts'
import type { IndexerOptions } from './config.ts'
import { errorName, failureLine, type IndexerHealth } from './health.ts'
import { IndexerWriteError, type IndexerDb, type Target } from './indexer-db.ts'
import {
  CURSOR_WRITE_EVERY_MS,
  MAX_RANGE,
  PASS_MS,
  passDelayMs,
  safeBlockOf,
  scansOf,
  segmentsOf,
  TARGETS_EVERY_MS,
  type Cursor,
  type Scan,
} from './indexer-plan.ts'
import { eventBlocksOf, INDEX_EVENTS, recordsOf, type IndexLog, type Records } from './indexer-records.ts'
import type { Tier } from './tiers.ts'

export type { IndexerHealth } from './health.ts'

/** Block times read at once, at most. */
const TIMES_AT_ONCE = 10
/** An unreadable deploy is logged at most once a minute per collection, whatever the targets' pace. */
const DEPLOY_LOG_EVERY_MS = 60_000

const hasRecords = (records: Records) =>
  records.mints.length + records.owners.length + records.airdrops.length + records.withdrawals.length > 0

/**
 * The indexer of one chain (docs/specs/2026-10-16-indexer-overview.md, section 6.5). Each pass loads the
 * chain's summaries until they have loaded, reads the targets every minute (and after a gap refusal),
 * starting a new one at its deploy transaction's block, reads the head, then scans each cursor's logs up to
 * the safe block in the plan's scans and writes what they record, segment by segment. Passes never overlap;
 * the next starts the plan's delay after this one started, at once when it ran longer, and the fast delay
 * after a pass with any failure (Review Focus 2). `activityOf` answers from memory, for the state body; the
 * request path reads no database.
 */
export function chainIndexer(
  chain: ChainConfig,
  client: PublicClient,
  db: IndexerDb,
  options: { tier(): Tier | null; passMs?: IndexerOptions['passMs']; targetsEveryMs?: number },
): {
  activityOf(address: Address, blockTimestamp: number): StateActivity | null
  health(): IndexerHealth
  stop(): Promise<void>
} {
  const delays = options.passMs ?? PASS_MS
  const targetsEveryMs = options.targetsEveryMs ?? TARGETS_EVERY_MS
  /** The cursors by collection id, and each collection's id by its lowercase contract. */
  const cursors = new Map<string, Cursor>()
  const idByContract = new Map<string, string>()
  const summaries = new Map<string, Summary>()
  let summariesLoaded = false
  let targetsReadAt: number | null = null
  let targetsDue = false
  const deployLoggedAt = new Map<string, number>()
  let timer: ReturnType<typeof setTimeout> | null = null
  let running: Promise<void> | null = null
  let stopped = false
  let safeBlock: bigint | null = null
  let headTime: number | null = null
  let lastPassAt: number | null = null
  let failedPasses = 0
  let lastError: string | null = null
  let unpaired = 0

  /** Counts a failure for /health and logs it as its name, its code and viem's short message, never more. */
  function failed(line: string, error: unknown): void {
    failedPasses++
    lastError = errorName(error)
    console.error(`${line}: ${failureLine(error)}`)
  }

  function setCursor(cursor: Cursor): void {
    cursors.set(cursor.collectionId, cursor)
    idByContract.set(cursor.contract.toLowerCase(), cursor.collectionId)
  }

  /** A cursor at the database's block, as a new one or after a gap refusal; a known one keeps its range. */
  const cursorOf = (target: Target, indexed: bigint, now: number): Cursor => ({
    collectionId: target.collectionId,
    contract: target.contract,
    scanned: indexed,
    written: indexed,
    range: cursors.get(target.collectionId)?.range ?? MAX_RANGE,
    syncedAt: target.syncedAt,
    writtenAt: now,
  })

  /** A target without a cursor: its deploy transaction's block, then its cursor there. */
  async function startTarget(target: Target, now: number): Promise<void> {
    let block: bigint
    try {
      block = (await client.getTransactionReceipt({ hash: target.deployTx })).blockNumber
    } catch {
      const logged = deployLoggedAt.get(target.collectionId)
      if (logged === undefined || now - logged >= DEPLOY_LOG_EVERY_MS) {
        deployLoggedAt.set(target.collectionId, now)
        console.error(
          `The deploy of ${target.collectionId} on ${chain.name} could not be read; it is tried again in a minute.`,
        )
      }
      return
    }
    await db.start(target.collectionId, block)
    deployLoggedAt.delete(target.collectionId)
    setCursor({ ...cursorOf(target, block - 1n, now), syncedAt: null })
    // A cursor this process starts has no record yet: its summary is empty until a write answers one, so the
    // state body carries 0 holders once it reads synced rather than nothing until a mint (Review Focus 4).
    if (!summaries.has(target.collectionId))
      summaries.set(target.collectionId, {
        collectionId: target.collectionId,
        contract: target.contract,
        holders: 0,
        syncedAt: null,
        recentMints: [],
      })
  }

  /** The targets: a new one starts, the database's cursor is taken only when new or after a gap refusal. */
  async function readTargets(now: number): Promise<void> {
    const targets = await db.targets(chain.id)
    const listed = new Set(targets.map((target) => target.collectionId))
    for (const [id, cursor] of cursors)
      if (!listed.has(id)) {
        cursors.delete(id)
        idByContract.delete(cursor.contract.toLowerCase())
      }
    for (const id of summaries.keys()) if (!listed.has(id)) summaries.delete(id)
    for (const target of targets) {
      if (stopped) return
      if (target.indexedBlock === null) await startTarget(target, now)
      else if (targetsDue || !cursors.has(target.collectionId))
        setCursor(cursorOf(target, target.indexedBlock, now))
    }
    targetsReadAt = now
    targetsDue = false
  }

  /** The times of the blocks not read yet, at most 10 at once. */
  async function readTimes(blocks: readonly bigint[], times: Map<bigint, number>): Promise<void> {
    const missing = blocks.filter((block) => !times.has(block))
    for (let at = 0; at < missing.length; at += TIMES_AT_ONCE) {
      const read = await Promise.all(
        missing.slice(at, at + TIMES_AT_ONCE).map((blockNumber) => client.getBlock({ blockNumber })),
      )
      for (const block of read) times.set(block.number, Number(block.timestamp))
    }
  }

  /**
   * One scan: its logs, then each segment's records written or deferred. Answers whether it failed and
   * recorded.
   */
  async function runScan(
    scan: Scan,
    safe: bigint,
    head: { timestamp: number },
  ): Promise<{ failed: boolean; recorded: boolean }> {
    let logs: IndexLog[]
    try {
      logs = (await client.getLogs({
        address: scan.cursors.map((cursor) => cursor.contract),
        events: INDEX_EVENTS,
        fromBlock: scan.fromBlock,
        toBlock: scan.toBlock,
        strict: true,
      })) as unknown as IndexLog[]
    } catch (error) {
      for (const cursor of scan.cursors) cursor.range = cursor.range > 1n ? cursor.range / 2n : 1n
      failed(
        `The index scan of blocks ${scan.fromBlock} to ${scan.toBlock} on ${chain.name} failed, so its range halves`,
        error,
      )
      return { failed: true, recorded: false }
    }
    for (const cursor of scan.cursors) cursor.range = MAX_RANGE
    const collections = new Map(
      scan.cursors.map((cursor) => [cursor.contract.toLowerCase(), cursor.collectionId]),
    )
    const times = new Map<bigint, number>()
    let recorded = false
    for (const segment of segmentsOf(logs, scan)) {
      if (stopped) break
      try {
        await readTimes(eventBlocksOf(segment.logs), times)
      } catch (error) {
        failed(`An index pass on ${chain.name} failed`, error)
        return { failed: true, recorded }
      }
      const { records, unpaired: missed } = recordsOf(segment.logs, collections, times)
      const toSafe = segment.toBlock === safe
      const now = Date.now()
      const due =
        hasRecords(records) ||
        (toSafe && scan.cursors.some((cursor) => cursor.syncedAt === null)) ||
        scan.cursors.some((cursor) => now - cursor.writtenAt >= CURSOR_WRITE_EVERY_MS)
      if (due) {
        const lowest = scan.cursors.reduce(
          (least, cursor) => (cursor.written < least ? cursor.written : least),
          scan.cursors[0]!.written,
        )
        try {
          const answered = await db.record({
            chainId: chain.id,
            fromBlock: lowest + 1n,
            toBlock: segment.toBlock,
            syncedAt: toSafe ? head.timestamp : null,
            collections: scan.cursors.map((cursor) => cursor.collectionId),
            records,
          })
          for (const summary of answered)
            if (cursors.has(summary.collectionId)) summaries.set(summary.collectionId, summary)
        } catch (error) {
          // The scan's deferred blocks are read again from the database's cursor on the next pass.
          for (const cursor of scan.cursors) cursor.scanned = cursor.written
          if (error instanceof IndexerWriteError && error.gap) targetsDue = true
          failed(`The index write on ${chain.name} failed`, error)
          return { failed: true, recorded }
        }
        for (const cursor of scan.cursors) {
          cursor.written = segment.toBlock
          cursor.writtenAt = now
        }
        recorded ||= hasRecords(records)
      }
      for (const cursor of scan.cursors) {
        cursor.scanned = segment.toBlock
        if (toSafe) cursor.syncedAt = head.timestamp
      }
      // Counted once its segment is done, so a segment read again after a failed write is not counted twice.
      for (const tx of missed) {
        unpaired++
        console.error(
          `A mint or airdrop in ${tx} on ${chain.name} did not pair with its transfers and is not recorded.`,
        )
      }
    }
    return { failed: false, recorded }
  }

  /** One pass; answers the wait to the next. */
  async function pass(): Promise<number> {
    const startedAt = Date.now()
    let anyFailure = false
    let recorded = false
    const wait = (behind: boolean) => {
      // A pass with a failure waits the fast delay: an outage is neither retried every second on the quota
      // the reader shares nor left for an idle chain's 20 s (Review Focus 2).
      const delay = anyFailure ? delays.fast : passDelayMs({ behind, recorded, tier: options.tier() }, delays)
      return Math.max(0, startedAt + delay - Date.now())
    }
    if (!summariesLoaded)
      try {
        for (const summary of await db.summaries(chain.id)) summaries.set(summary.collectionId, summary)
        summariesLoaded = true
      } catch (error) {
        anyFailure = true
        failed(`An index pass on ${chain.name} failed`, error)
      }
    if (!stopped && (targetsDue || targetsReadAt === null || startedAt - targetsReadAt >= targetsEveryMs))
      try {
        await readTargets(startedAt)
      } catch (error) {
        anyFailure = true
        failed(`An index pass on ${chain.name} failed`, error)
      }
    if (stopped) return 0
    let head: { number: bigint; timestamp: number }
    try {
      const block = await client.getBlock({ blockTag: 'latest' })
      head = { number: block.number, timestamp: Number(block.timestamp) }
    } catch (error) {
      failed(`An index pass on ${chain.name} failed`, error)
      anyFailure = true
      lastPassAt = Date.now()
      return wait(false)
    }
    const safe = safeBlockOf(head.number, chain.confirmations)
    safeBlock = safe
    headTime = head.timestamp
    for (const scan of scansOf([...cursors.values()], safe)) {
      if (stopped) break
      const outcome = await runScan(scan, safe, head)
      anyFailure ||= outcome.failed
      recorded ||= outcome.recorded
    }
    lastPassAt = Date.now()
    return wait([...cursors.values()].some((cursor) => cursor.scanned < safe))
  }

  function run(): void {
    timer = null
    running = pass()
      .catch((error: unknown) => {
        // A pass that threw outside its own steps counts as failed, and the next comes after the idle delay.
        failed(`An index pass on ${chain.name} failed`, error)
        return delays.idle
      })
      .then((delay) => {
        running = null
        if (!stopped) timer = setTimeout(run, delay)
      })
  }
  run()

  return {
    activityOf(address, blockTimestamp) {
      const id = idByContract.get(address.toLowerCase())
      if (id === undefined) return null
      return activityFrom(summaries.get(id), cursors.get(id)?.syncedAt ?? null, blockTimestamp)
    },
    health() {
      const all = [...cursors.values()]
      return {
        collections: all.length,
        behind: all.filter(
          (cursor) =>
            cursor.syncedAt === null ||
            (headTime !== null && headTime - cursor.syncedAt > ACTIVITY_LAG_MAX_S),
        ).length,
        block: safeBlock === null ? null : Number(safeBlock),
        lastPassAt: lastPassAt === null ? null : new Date(lastPassAt).toISOString(),
        failedPasses,
        lastError,
        unpaired,
      }
    },
    async stop() {
      stopped = true
      if (timer) clearTimeout(timer)
      timer = null
      await running
    },
  }
}

export type ChainIndexer = ReturnType<typeof chainIndexer>
```

- [ ] **Step 7: Run the tests to see them pass**

Run: `pnpm --filter @cobweb/freshness exec vitest run src/indexer-db.test.ts src/indexer.test.ts src/config.test.ts src/health.test.ts`
Expected: PASS, `Test Files  4 passed (4)` and `Tests  33 passed (33)`.

- [ ] **Step 8: The server's start, stop and `/health`**

The indexers start once the server listens and stop with the readers and windows; `index.ts` reads the options inside its start (Decision 11).

In `apps/freshness/src/server.ts`, replace:

```ts
import { chainReader } from './chain-reader.ts'
import { collectionCheck } from './collection-check.ts'
import { servedChains } from './config.ts'
import { failureLine, type HealthBody } from './health.ts'
import { hotSet, JOIN_WAIT_MS, type HotEntry } from './hot-set.ts'
import {
  healthAnswer,
```

with:

```ts
import { chainReader } from './chain-reader.ts'
import { collectionCheck } from './collection-check.ts'
import { servedChains, type IndexerOptions } from './config.ts'
import { chainHealth, failureLine, type HealthBody } from './health.ts'
import { hotSet, JOIN_WAIT_MS, type HotEntry } from './hot-set.ts'
import { chainIndexer, type ChainIndexer } from './indexer.ts'
import { supabaseIndexerDb } from './indexer-db.ts'
import {
  healthAnswer,
```

In `apps/freshness/src/server.ts`, replace:

```ts
import { walletWindows } from './wallet.ts'

export type { HealthBody } from './health.ts'
export type { StateBody } from './state-body.ts'
```

with:

```ts
import { walletWindows } from './wallet.ts'

export type { IndexerOptions } from './config.ts'
export type { HealthBody } from './health.ts'
export type { StateBody } from './state-body.ts'
```

In `apps/freshness/src/server.ts`, replace:

```ts
/**
 * The freshness server (docs/specs/2026-10-16-freshness-server.md, section 6): one `node:http` server over
 * the chains whose two variables are set. It makes no call until a request arrives, reads no database, and
 * never computes liveness. `index.ts` starts it on Railway; `verify:freshness` starts it in process.
 */

```

with:

```ts
/**
 * The freshness server (docs/specs/2026-10-16-freshness-server.md, section 6): one `node:http` server over
 * the chains whose two variables are set. Without the indexer it makes no call until a request arrives; with
 * it, each served chain's indexer reads the chain's collections into the database from the start
 * (docs/specs/2026-10-16-indexer-overview.md, section 6.1), while the request path still reads no database.
 * It never computes liveness. `index.ts` starts it on Railway; `verify:freshness` and `verify:indexer` start
 * it in process.
 */

```

In `apps/freshness/src/server.ts`, replace:

```ts
  /** Limits the chains served; the verify serves Anvil alone. */
  chainIds?: number[]
}

```

with:

```ts
  /** Limits the chains served; the verify serves Anvil alone. */
  chainIds?: number[]
  /**
   * The indexer's database and pace; without them the indexer is off and the state body's activity is null.
   */
  indexer?: IndexerOptions | null
}

```

In `apps/freshness/src/server.ts`, replace:

```ts
      return [
        chain.id,
        { chain, client, reader: chainReader(chain, hot, client), windows: walletWindows(chain, client) },
      ]
    }),
```

with:

```ts
      return [
        chain.id,
        {
          chain,
          client,
          reader: chainReader(chain, hot, client),
          windows: walletWindows(chain, client),
          // Started once the server listens, so a start that fails leaves no indexer running.
          indexer: null as ChainIndexer | null,
        },
      ]
    }),
```

In `apps/freshness/src/server.ts`, replace:

```ts
      startedAt,
      hot: hot.size(),
      chains: chains.map(({ reader }) => reader.health()),
      wallet: { windows: total('windows'), answered: total('answered'), waiting: total('waiting') },
    }
```

with:

```ts
      startedAt,
      hot: hot.size(),
      chains: chains.map(({ reader, indexer }) => chainHealth(reader.health(), indexer?.health() ?? null)),
      wallet: { windows: total('windows'), answered: total('answered'), waiting: total('waiting') },
    }
```

In `apps/freshness/src/server.ts`, replace:

```ts
  })
  const { port } = server.address() as AddressInfo
  const names = [...served.values()].map(({ chain }) => `${chain.name} (${chain.id})`)
  console.log(
    `The freshness server listens on port ${port}, serving ${names.length ? names.join(', ') : 'no chain'}.`,
  )

  /**
   * Stops accepting connections, waits for every reader, window and request in flight, then closes the
   * connections left and waits for any request a kept-alive connection carried meanwhile, so the server makes
   * no call once it resolves (Decision 3). The first failure is thrown once everything has settled.
   */
  async function shutDown(): Promise<void> {
    const closed = new Promise<Error | undefined>((resolve) => server.close((error) => resolve(error)))
    const settled = await Promise.allSettled([
      ...[...served.values()].flatMap(({ reader, windows }) => [reader.stop(), windows.stop()]),
      ...answering,
    ])
```

with:

```ts
  })
  const { port } = server.address() as AddressInfo
  const indexing = options.indexer ?? null
  if (indexing) {
    const db = supabaseIndexerDb(indexing)
    for (const entry of served.values())
      entry.indexer = chainIndexer(entry.chain, entry.client, db, {
        tier: () => entry.reader.health().tier,
        passMs: indexing.passMs,
        targetsEveryMs: indexing.targetsEveryMs,
      })
  }
  const names = [...served.values()].map(({ chain }) => `${chain.name} (${chain.id})`)
  const listed = names.length ? names.join(', ') : 'no chain'
  console.log(
    `The freshness server listens on port ${port}, serving ${listed}. ${
      indexing
        ? `The indexer runs on ${listed}.`
        : 'The indexer is off: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to run it.'
    }`,
  )

  /**
   * Stops accepting connections, waits for every reader, window, indexer and request in flight, then closes
   * the connections left and waits for any request a kept-alive connection carried meanwhile, so the server
   * makes no call once it resolves (Decision 3). The first failure is thrown once everything has settled.
   */
  async function shutDown(): Promise<void> {
    const closed = new Promise<Error | undefined>((resolve) => server.close((error) => resolve(error)))
    const settled = await Promise.allSettled([
      ...[...served.values()].flatMap(({ reader, windows, indexer }) => [
        reader.stop(),
        windows.stop(),
        ...(indexer ? [indexer.stop()] : []),
      ]),
      ...answering,
    ])
```

In `apps/freshness/src/index.ts`, replace:

```ts
import { portOf } from './config.ts'
import { failureLine } from './health.ts'
import { startFreshness } from './server.ts'

// The freshness server as Railway runs it (docs/specs/2026-10-16-freshness-server.md, section 6.1): Node runs
// this TypeScript source as it is, on PORT. A start that fails (a served chain's factory that is not an
// address, or a port already in use) is logged through `failureLine`, which names the error and its code and
// never prints a full message, and exits 1. On SIGTERM it stops its ticks and windows, closes the server and
// exits.

const freshness = await startFreshness({ port: portOf(process.env.PORT) }).catch((error: unknown) => {
  console.error(`The freshness server did not start: ${failureLine(error)}`)
  process.exit(1)
```

with:

```ts
import { indexerOptionsOf, portOf } from './config.ts'
import { failureLine } from './health.ts'
import { startFreshness } from './server.ts'

// The freshness server as Railway runs it (docs/specs/2026-10-16-freshness-server.md, section 6.1): Node runs
// this TypeScript source as it is, on PORT, with the indexer when SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
// are set (docs/specs/2026-10-16-indexer-overview.md, section 6.1). A start that fails (a served chain's
// factory that is not an address, one of the two database variables set alone, or a port already in use) is
// logged through `failureLine`, which names the error and its code and never prints a full message, and exits
// 1. On SIGTERM it stops its ticks, windows and indexers, closes the server and exits.

/** The start, its options read inside it, so a refused option fails it as a failed start. */
async function start() {
  return startFreshness({ port: portOf(process.env.PORT), indexer: indexerOptionsOf(process.env) })
}

const freshness = await start().catch((error: unknown) => {
  console.error(`The freshness server did not start: ${failureLine(error)}`)
  process.exit(1)
```

- [ ] **Step 9: Typecheck, lint and test the package, then the server end to end**

Run: `pnpm --filter @cobweb/freshness typecheck && pnpm --filter @cobweb/freshness lint && pnpm --filter @cobweb/freshness exec vitest run`
Expected: no errors and no warnings, and `Test Files  16 passed (16)` and `Tests  166 passed (166)`.

Run: `pnpm --filter @cobweb/web verify:freshness`
Expected: PASS, `16 passed, 0 failed` (about 60 s; it moves Anvil's clock about 600 s ahead), its start line ending `The indexer is off: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to run it.`, since the verify passes no indexer.

- [ ] **Step 10: Format, run the root checks and commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
pnpm exec prettier --write apps/freshness/package.json apps/freshness/src/config.ts apps/freshness/src/health.ts apps/freshness/src/chain-reader.ts apps/freshness/src/indexer-db.ts apps/freshness/src/indexer.ts apps/freshness/src/server.ts apps/freshness/src/index.ts apps/freshness/src/indexer-db.test.ts apps/freshness/src/indexer.test.ts apps/freshness/src/config.test.ts apps/freshness/src/health.test.ts
pnpm typecheck && pnpm lint && pnpm test
git add apps/freshness/package.json pnpm-lock.yaml apps/freshness/src/config.ts apps/freshness/src/health.ts apps/freshness/src/chain-reader.ts apps/freshness/src/indexer-db.ts apps/freshness/src/indexer.ts apps/freshness/src/server.ts apps/freshness/src/index.ts apps/freshness/src/indexer-db.test.ts apps/freshness/src/indexer.test.ts apps/freshness/src/config.test.ts apps/freshness/src/health.test.ts
git commit -m "$(cat <<'EOF'
Run the indexer in the freshness server for every served chain, with its database port, its options, its stop and its health

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: the freshness package reports 166 tests in 16 files; the others are unchanged (web 877, shared 105).

---

### Task 4: `activity` in the state body and its tag, and the mint page's parser

**Kind:** transcription. The plan carries every line: a Sonnet implementer.

**Files:**

- Modify: `packages/shared/src/freshness-wire.ts` (the field), `apps/freshness/src/state-body.ts` (the parameter, the field, the tag's comment), `apps/freshness/src/server.ts` (the state route), `apps/web/src/lib/mint/fresh-client.ts` (the parser), `apps/web/src/components/mint/sample-source.ts` (`activity: null`)
- Modify (tests): `apps/freshness/src/state-body.test.ts`, `apps/web/src/lib/mint/fresh-client.test.ts`, `live-source.test.ts`, `live-data.test.ts`
- Test: the four test files, then `verify:freshness`

**Interfaces:**

- Consumes: Task 2's `StateActivity`; Task 3's `chainIndexer(...).activityOf` on each served chain's entry.
- Produces: `StateBody.activity: StateActivity | null`, last in the body; `stateBody(chainId: number, entry: HotEntry, degraded: boolean, activity: StateActivity | null): StateBody`; the state route asks `indexer?.activityOf(entry.address, entry.read.state.blockTimestamp) ?? null`; `etagOf` covers `activity`; the page's `stateBodySchema` reads `activity` as null when it is missing, null or malformed (Decision 12). Task 7 fills the sample's activity.

- [ ] **Step 1: Write the failing tests**

The body's keys end with `activity`; the tag moves with the holders, a new mint and a flip to or from null, and holds when only a cursor moved. The page parses the activity and reads a body without it, with null or with a malformed one as null. The web app's body fixtures gain `activity: null` (Decision 2).

In `apps/freshness/src/state-body.test.ts`, replace:

```ts
import type { Address } from 'viem'
import { describe, expect, it } from 'vitest'
import type { CollectionRead } from './chain-reader.ts'
```

with:

```ts
import type { StateActivity } from '@cobweb/shared'
import type { Address, Hex } from 'viem'
import { describe, expect, it } from 'vitest'
import type { CollectionRead } from './chain-reader.ts'
```

In `apps/freshness/src/state-body.test.ts`, replace:

```ts
const OWNER: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const VALIDATOR: Address = '0x721C008fdff27BF06E7E123956E2Fe03B63342e3'

const read: CollectionRead = {
```

with:

```ts
const OWNER: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const VALIDATOR: Address = '0x721C008fdff27BF06E7E123956E2Fe03B63342e3'
const MINT_TX: Hex = `0x${'0b'.repeat(32)}`
/** Two holders and their one mint, as the indexer's memory answers them. */
const ACTIVITY: StateActivity = {
  holders: 2,
  recentMints: [
    {
      txHash: MINT_TX,
      recipient: OWNER,
      groupId: 1,
      amount: 1,
      firstTokenId: 1,
      blockTimestamp: 1_799_999_990,
    },
  ],
}

const read: CollectionRead = {
```

In `apps/freshness/src/state-body.test.ts`, replace:

```ts

describe('stateBody (docs/specs/2026-10-16-freshness-server.md, section 6.7)', () => {
  it('answers every field from a read, in order, readAt in Unix seconds', () => {
    const body = stateBody(31337, entry(), false)
    expect(body).toEqual<StateBody>({
      chainId: 31337,
```

with:

```ts

describe('stateBody (docs/specs/2026-10-16-freshness-server.md, section 6.7)', () => {
  it('answers every field from a read, in order, readAt in Unix seconds, the activity last', () => {
    const body = stateBody(31337, entry(), false, ACTIVITY)
    expect(body).toEqual<StateBody>({
      chainId: 31337,
```

In `apps/freshness/src/state-body.test.ts`, replace:

```ts
      transferValidator: VALIDATOR,
      transferLevel: 'none',
    })
    expect(Object.keys(body)).toEqual([
```

with:

```ts
      transferValidator: VALIDATOR,
      transferLevel: 'none',
      activity: ACTIVITY,
    })
    expect(Object.keys(body)).toEqual([
```

In `apps/freshness/src/state-body.test.ts`, replace:

```ts
      'transferValidator',
      'transferLevel',
    ])
    expect(Object.keys(body.groups[0]!)).toEqual([
```

with:

```ts
      'transferValidator',
      'transferLevel',
      'activity',
    ])
    expect(Object.keys(body.groups[0]!)).toEqual([
```

In `apps/freshness/src/state-body.test.ts`, replace:

```ts
  it('answers the transfer level as none, unread or its number', () => {
    const level = (transferLevel: CollectionRead['extras']['transferLevel']) =>
      stateBody(31337, entry({ extras: { ...read.extras, transferLevel } }), false).transferLevel
    expect(level({ kind: 'none', reason: 'zero' })).toBe('none')
    expect(level({ kind: 'unread' })).toBe('unread')
```

with:

```ts
  it('answers the transfer level as none, unread or its number', () => {
    const level = (transferLevel: CollectionRead['extras']['transferLevel']) =>
      stateBody(31337, entry({ extras: { ...read.extras, transferLevel } }), false, null).transferLevel
    expect(level({ kind: 'none', reason: 'zero' })).toBe('none')
    expect(level({ kind: 'unread' })).toBe('unread')
```

In `apps/freshness/src/state-body.test.ts`, replace:

```ts
describe('etagOf', () => {
  const tag = (body: StateBody) => etagOf(body)
  const base = stateBody(31337, entry(), false)

  it('is weak, 32 hex digits, and equal for equal reads', () => {
    expect(tag(base)).toMatch(/^W\/"[0-9a-f]{32}"$/)
    expect(tag(stateBody(31337, entry(), false))).toBe(tag(base))
  })

```

with:

```ts
describe('etagOf', () => {
  const tag = (body: StateBody) => etagOf(body)
  const base = stateBody(31337, entry(), false, ACTIVITY)

  it('is weak, 32 hex digits, and equal for equal reads', () => {
    expect(tag(base)).toMatch(/^W\/"[0-9a-f]{32}"$/)
    expect(tag(stateBody(31337, entry(), false, ACTIVITY))).toBe(tag(base))
  })

```

In `apps/freshness/src/state-body.test.ts`, replace:

```ts
      transferValidator: OWNER,
      transferLevel: 'unread',
    }
    const untagged: string[] = ['readAt', 'block', 'blockTimestamp']
```

with:

```ts
      transferValidator: OWNER,
      transferLevel: 'unread',
      activity: null,
    }
    const untagged: string[] = ['readAt', 'block', 'blockTimestamp']
```

In `apps/freshness/src/state-body.test.ts`, replace:

```ts
    for (const [key, value] of Object.entries(tagged))
      expect(tag({ ...base, [key]: value }), key).not.toBe(tag(base))
  })
})
```

with:

```ts
    for (const [key, value] of Object.entries(tagged))
      expect(tag({ ...base, [key]: value }), key).not.toBe(tag(base))
  })

  it('changes with the holders, a new mint and a flip to or from null, and not when only a cursor moved (docs/specs/2026-10-16-indexer-overview.md, section 6.6)', () => {
    const newer = { ...ACTIVITY.recentMints[0]!, txHash: `0x${'0c'.repeat(32)}` as Hex, firstTokenId: 2 }
    const changed: (StateActivity | null)[] = [
      { ...ACTIVITY, holders: 3 },
      { ...ACTIVITY, recentMints: [newer, ...ACTIVITY.recentMints] },
      null,
    ]
    for (const activity of changed) expect(tag({ ...base, activity })).not.toBe(tag(base))
    expect(tag({ ...base, activity: null })).not.toBe(
      tag({ ...base, activity: { holders: 0, recentMints: [] } }),
    )
    // A pass that only moved the cursors: a later block with the same activity.
    const later = {
      ...base,
      block: base.block + 5,
      blockTimestamp: base.blockTimestamp + 5,
      readAt: base.readAt + 5,
    }
    expect(tag({ ...later, activity: structuredClone(ACTIVITY) })).toBe(tag(base))
  })
})
```

In `apps/web/src/lib/mint/fresh-client.test.ts`, replace:

```ts
import type { StateBody, WalletBody } from '@cobweb/shared'
import type { Address } from 'viem'
import { describe, expect, it, vi } from 'vitest'
```

with:

```ts
import type { StateActivity, StateBody, WalletBody } from '@cobweb/shared'
import type { Address } from 'viem'
import { describe, expect, it, vi } from 'vitest'
```

In `apps/web/src/lib/mint/fresh-client.test.ts`, replace:

```ts
  transferValidator: '0x0000000000000000000000000000000000000000',
  transferLevel: 'none',
}
const wallet: WalletBody = {
```

with:

```ts
  transferValidator: '0x0000000000000000000000000000000000000000',
  transferLevel: 'none',
  activity: null,
}
const wallet: WalletBody = {
```

In `apps/web/src/lib/mint/fresh-client.test.ts`, replace:

```ts
    expect(readingLong(shown, 60_000, 0)).toBe(false)
  })
})
```

with:

```ts
    expect(readingLong(shown, 60_000, 0)).toBe(false)
  })
})

describe("the state body's activity (docs/specs/2026-10-16-indexer-overview.md, section 7.5)", () => {
  const activity: StateActivity = {
    holders: 2,
    recentMints: [
      {
        txHash: `0x${'ab'.repeat(32)}`,
        recipient: WALLET,
        groupId: 0,
        amount: 1,
        firstTokenId: 1,
        blockTimestamp: 1_791_039_590,
      },
    ],
  }
  const read = async (value: unknown) => {
    const { fetchImpl } = fakeFetch([json(value)])
    return pollState(BASE, 31337, COLLECTION, fetchImpl)
  }

  it('reads the holders and the latest mints', async () => {
    expect(await read({ ...body, activity })).toEqual<StatePoll>({
      kind: 'body',
      body: { ...body, activity },
      ageSeconds: 0,
    })
  })

  it('reads a body without activity, with null or with a malformed one as null, and keeps the body', async () => {
    const without = Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'activity'))
    for (const value of [
      without,
      { ...body, activity: null },
      { ...body, activity: { holders: -1, recentMints: [] } },
      { ...body, activity: { ...activity, recentMints: [{ ...activity.recentMints[0], txHash: '0x12' }] } },
    ])
      expect(await read(value)).toEqual<StatePoll>({
        kind: 'body',
        body: { ...body, activity: null },
        ageSeconds: 0,
      })
  })
})
```

In `apps/web/src/lib/mint/live-source.test.ts`, replace:

```ts
    transferValidator: '0x0000000000000000000000000000000000000000',
    transferLevel: 'none',
  }
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
```

with:

```ts
    transferValidator: '0x0000000000000000000000000000000000000000',
    transferLevel: 'none',
    activity: null,
  }
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
```

In `apps/web/src/lib/mint/live-data.test.ts`, replace:

```ts
  transferValidator: '0x721C008fdff27BF06E7E123956E2Fe03B63342e3',
  transferLevel: 0,
}

```

with:

```ts
  transferValidator: '0x721C008fdff27BF06E7E123956E2Fe03B63342e3',
  transferLevel: 0,
  activity: null,
}

```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @cobweb/freshness exec vitest run src/state-body.test.ts`
Expected: FAIL. The body has no `activity` and its tag ignores it: `Tests  3 failed | 5 passed (8)`.

Run: `pnpm --filter @cobweb/web exec vitest run src/lib/mint/fresh-client.test.ts src/lib/mint/live-source.test.ts src/lib/mint/live-data.test.ts`
Expected: FAIL. Today's parser drops `activity`, so the two new cases fail and so do two earlier ones whose fixture now carries `activity: null`: `Test Files  1 failed | 2 passed (3)` and `Tests  4 failed | 35 passed (39)`.

- [ ] **Step 3: The wire field**

In `packages/shared/src/freshness-wire.ts`, replace:

```ts
  transferValidator: Address
  transferLevel: 'none' | 'unread' | number
}

```

with:

```ts
  transferValidator: Address
  transferLevel: 'none' | 'unread' | number
  /**
   * The holders and the latest mints, from the indexer's memory (docs/specs/2026-10-16-indexer-overview.md,
   * section 6.6): null while the indexer is off, has not read the collection to the chain's confirmation
   * depth, or trails the state by more than 300 s of chain time.
   */
  activity: StateActivity | null
}

```

- [ ] **Step 4: The server's body and its route**

In `apps/freshness/src/state-body.ts`, replace:

```ts
import { createHash } from 'node:crypto'
import type { StateBody } from '@cobweb/shared'
import type { HotEntry } from './hot-set.ts'

```

with:

```ts
import { createHash } from 'node:crypto'
import type { StateActivity, StateBody } from '@cobweb/shared'
import type { HotEntry } from './hot-set.ts'

```

In `apps/freshness/src/state-body.ts`, replace:

```ts
export type { StateBody }

/** The body of an entry with a read, keys in this order and the groups in the contract's. */
export function stateBody(chainId: number, entry: HotEntry, degraded: boolean): StateBody {
  const { read, readAt } = entry
  if (!read || readAt === null) throw new Error('A state body needs a read.')
```

with:

```ts
export type { StateBody }

/**
 * The body of an entry with a read, keys in this order and the groups in the contract's, with the indexer's
 * activity last (docs/specs/2026-10-16-indexer-overview.md, section 6.6).
 */
export function stateBody(
  chainId: number,
  entry: HotEntry,
  degraded: boolean,
  activity: StateActivity | null,
): StateBody {
  const { read, readAt } = entry
  if (!read || readAt === null) throw new Error('A state body needs a read.')
```

In `apps/freshness/src/state-body.ts`, replace:

```ts
    transferValidator: extras.transferValidator,
    transferLevel: level.kind === 'level' ? level.level : level.kind,
  }
}
```

with:

```ts
    transferValidator: extras.transferValidator,
    transferLevel: level.kind === 'level' ? level.level : level.kind,
    activity,
  }
}
```

In `apps/freshness/src/state-body.ts`, replace:

```ts
/**
 * A weak tag over the body without `readAt`, `block` and `blockTimestamp`: a tick that changes nothing else
 * keeps it, so a poll with `If-None-Match` answers 304. `degraded` is inside it.
 */
export function etagOf(body: StateBody): string {
```

with:

```ts
/**
 * A weak tag over the body without `readAt`, `block` and `blockTimestamp`: a tick that changes nothing else
 * keeps it, so a poll with `If-None-Match` answers 304. `degraded` and `activity` are inside it: a new mint,
 * a new holder count or a flip to or from null answers 200, a pass that only moves cursors keeps the tag.
 */
export function etagOf(body: StateBody): string {
```

In `apps/freshness/src/server.ts`, replace:

```ts
    const refusedAnswer = await refused(chainId, address)
    if (refusedAnswer) return refusedAnswer
    const { reader } = served.get(chainId)!
    const { entry, joined } = hot.join(chainId, address, Date.now())
    if (joined) reader.wake()
    await firstRead(entry)
    if (entry.read === null || entry.readAt === null) return refusal(503, 'not-read-yet')
    const degraded = isDegraded(entry.readAt, Date.now(), reader.health().tier ?? 'live')
    const body = stateBody(chainId, entry, degraded)
    const etag = etagOf(body)
    return stateAnswer(body, etag, etagMatches(ifNoneMatch, etag))
```

with:

```ts
    const refusedAnswer = await refused(chainId, address)
    if (refusedAnswer) return refusedAnswer
    const { reader, indexer } = served.get(chainId)!
    const { entry, joined } = hot.join(chainId, address, Date.now())
    if (joined) reader.wake()
    await firstRead(entry)
    if (entry.read === null || entry.readAt === null) return refusal(503, 'not-read-yet')
    const degraded = isDegraded(entry.readAt, Date.now(), reader.health().tier ?? 'live')
    const activity = indexer?.activityOf(entry.address, entry.read.state.blockTimestamp) ?? null
    const body = stateBody(chainId, entry, degraded, activity)
    const etag = etagOf(body)
    return stateAnswer(body, etag, etagMatches(ifNoneMatch, etag))
```

- [ ] **Step 5: The page's parser and the sample's body**

`nullable().catch(null)`, so a missing key reads null as `StateBody` types it (Decision 12).

In `apps/web/src/lib/mint/fresh-client.ts`, replace:

```ts
import { statePath, walletPath, type StateBody, type WalletBody } from '@cobweb/shared'
import { isAddress, type Address } from 'viem'
import { z } from 'zod'
import type { Phase } from '@/components/mint/model'
```

with:

```ts
import { statePath, walletPath, type StateActivity, type StateBody, type WalletBody } from '@cobweb/shared'
import { isAddress, type Address, type Hex } from 'viem'
import { z } from 'zod'
import type { Phase } from '@/components/mint/model'
```

In `apps/web/src/lib/mint/fresh-client.ts`, replace:

```ts
const start = z.number().min(0)
const wei = z.string().regex(/^[0-9]+$/)

const stateBodySchema: z.ZodType<StateBody> = z.object({
```

with:

```ts
const start = z.number().min(0)
const wei = z.string().regex(/^[0-9]+$/)
const txHash = z.custom<Hex>((value) => typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value))

/** The indexer's holders and latest mints (docs/specs/2026-10-16-indexer-overview.md, section 7.5). */
const activitySchema: z.ZodType<StateActivity> = z.object({
  holders: count,
  recentMints: z.array(
    z.object({
      txHash,
      recipient: addressShape,
      groupId: count,
      amount: count,
      firstTokenId: count,
      blockTimestamp: count,
    }),
  ),
})

const stateBodySchema: z.ZodType<StateBody> = z.object({
```

In `apps/web/src/lib/mint/fresh-client.ts`, replace:

```ts
  transferValidator: addressShape,
  transferLevel: z.union([z.literal('none'), z.literal('unread'), count]),
})

```

with:

```ts
  transferValidator: addressShape,
  transferLevel: z.union([z.literal('none'), z.literal('unread'), count]),
  // A body without it (a server before the indexer), with null or with a malformed one is kept, its activity
  // null: the page then shows neither Holders nor Recent mints.
  activity: activitySchema.nullable().catch(null),
})

```

In `apps/web/src/components/mint/sample-source.ts`, replace:

```ts
        transferValidator: DEFAULT_TRANSFER_VALIDATOR,
        transferLevel: 0,
      }
      return { kind: 'body', body, ageSeconds: 0 }
```

with:

```ts
        transferValidator: DEFAULT_TRANSFER_VALIDATOR,
        transferLevel: 0,
        activity: null,
      }
      return { kind: 'body', body, ageSeconds: 0 }
```

- [ ] **Step 6: Run the tests to see them pass, then typecheck and lint the three packages**

Run: `pnpm --filter @cobweb/freshness exec vitest run src/state-body.test.ts`
Expected: PASS, `Tests  8 passed (8)`.

Run: `pnpm --filter @cobweb/web exec vitest run src/lib/mint/fresh-client.test.ts src/lib/mint/live-source.test.ts src/lib/mint/live-data.test.ts`
Expected: PASS, `Test Files  3 passed (3)` and `Tests  39 passed (39)`.

Run: `pnpm --filter @cobweb/shared typecheck && pnpm --filter @cobweb/freshness typecheck && pnpm --filter @cobweb/freshness lint && pnpm --filter @cobweb/web typecheck && pnpm --filter @cobweb/web lint`
Expected: no errors and no warnings.

- [ ] **Step 7: The server end to end**

Run: `pnpm --filter @cobweb/web verify:freshness`
Expected: PASS, `16 passed, 0 failed` (about 60 s).

The verify starts no indexer, so every body it reads carries `activity: null`.

- [ ] **Step 8: Format, run the root checks and commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
pnpm exec prettier --write packages/shared/src/freshness-wire.ts apps/freshness/src/state-body.ts apps/freshness/src/server.ts apps/freshness/src/state-body.test.ts apps/web/src/lib/mint/fresh-client.ts apps/web/src/components/mint/sample-source.ts apps/web/src/lib/mint/fresh-client.test.ts apps/web/src/lib/mint/live-source.test.ts apps/web/src/lib/mint/live-data.test.ts
pnpm typecheck && pnpm lint && pnpm test
git add packages/shared/src/freshness-wire.ts apps/freshness/src/state-body.ts apps/freshness/src/server.ts apps/freshness/src/state-body.test.ts apps/web/src/lib/mint/fresh-client.ts apps/web/src/components/mint/sample-source.ts apps/web/src/lib/mint/fresh-client.test.ts apps/web/src/lib/mint/live-source.test.ts apps/web/src/lib/mint/live-data.test.ts
git commit -m "$(cat <<'EOF'
Carry the indexer's activity in the state body and its tag, and read it on the mint page, a body without it read as null

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: the freshness package reports 167 tests in 16 files and the web app 879 in 93; the shared package is unchanged (105).

---

### Task 5: The Overview on live data: holders, recent mints and "Paid by minters"

**Kind:** transcription. The plan carries every line: a Sonnet implementer.

**Files:**

- Create: `apps/web/src/lib/manage/activity-view.ts`, `apps/web/src/lib/manage/activity-core.ts`, `apps/web/src/app/actions/activity.ts`, and the test `apps/web/src/lib/manage/activity-view.test.ts`
- Modify: `apps/web/src/components/manage/manage-sim.ts` (`sampleActivityView`), `overview-cards.tsx` (Holders), `overview-parts.tsx` (Recent mints), `overview-screen.tsx` (the props, the proceeds), `apps/web/src/app/collections/[id]/manage/page.tsx` (the read and the sample), `apps/web/src/components/manage/manage-sim.test.ts` (a block)
- Test: `activity-view.test.ts`, `manage-sim.test.ts`

**Interfaces:**

- Consumes: Task 1's `indexer_cursors` (`synced_at`, `holders`) and `mints` (`tx_hash`, `recipient`, `amount`, `group_id`, `block_time`, `first_token_id`, ordered by `block` then `log_index`); `PhasesContext` and `phasesWrite`; `SettingsView` (`creatorBalanceWei`, `withdrawnWei`); `DropActivity['recentMints']`, `DEMO_ACTIVITY` and `DEMO_NOW` from `lib/demo`; `duration` and `relativeTo` from `components/manage/format.ts`.
- Produces:
  - `lib/manage/activity-view.ts`: `RECENT_MINTS_SHOWN = 12`, `BEHIND_AFTER_S = 300`, `CursorRow = { synced_at: string | null; holders: number }`, `MintRow`, `ActivityView = { counted: boolean; holders: number; countedAt: number | null; recentMints: DropActivity['recentMints'] }`, `activityViewOf(cursor: CursorRow | null, mints: MintRow[]): ActivityView`, `behindOf(activity: ActivityView, readAt: number, chainReachable: boolean): boolean`, `PaidByMinters = { kind: 'wei'; wei: string } | { kind: 'counting' } | { kind: 'not-read' }`, `paidByMintersOf(settings: Pick<SettingsView, 'creatorBalanceWei' | 'withdrawnWei'>, activity: ActivityView | null): PaidByMinters`
  - `lib/manage/activity-core.ts`: `activityViewCore(ctx: PhasesContext): Promise<DeployOutcome<ActivityView>>` (Decision 13); `app/actions/activity.ts`: `getActivity(collectionId: string): Promise<ActionResult<ActivityView>>`
  - `components/manage/manage-sim.ts`: `sampleActivityView(variant: string | undefined): ActivityView` (`'counting'`, `'behind'`, else counted)
  - `OverviewScreenProps.activity: ActivityView | null` in place of `activity: DropActivity` and `paidByMintersWei`; `OverviewHeader`'s `holders: number | 'counting' | null`; `RecentMints({ activity, groups, chain, readAt, chainReachable })`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/lib/manage/activity-view.test.ts`:

```ts
import type { Address, Hex } from 'viem'
import { describe, expect, it } from 'vitest'
import {
  activityViewOf,
  BEHIND_AFTER_S,
  behindOf,
  paidByMintersOf,
  RECENT_MINTS_SHOWN,
  type ActivityView,
  type MintRow,
} from './activity-view'

const MINTER: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
/** 1 November 2026 00:00 UTC, as the cursor's synced_at reads it. */
const SYNCED_AT = 1_793_491_200
const SYNCED = '2026-11-01T00:00:00+00:00'
/** Fourteen mints newest first, 12 s apart, as the core reads them: recipients lowercase. */
const rows: MintRow[] = Array.from({ length: 14 }, (_, index) => ({
  tx_hash: `0x${(14 - index).toString(16).padStart(64, '0')}`,
  recipient: MINTER.toLowerCase(),
  amount: 1 + (index % 2),
  group_id: index % 2,
  block_time: new Date((SYNCED_AT - index * 12) * 1_000).toISOString(),
  first_token_id: 30 - index * 2,
}))
const counted: ActivityView = activityViewOf({ synced_at: SYNCED, holders: 171 }, rows)

describe('activityViewOf (docs/specs/2026-10-16-indexer-overview.md, section 7.1)', () => {
  it('reads not counted without a cursor, or with one the indexer has not synced yet', () => {
    expect(activityViewOf(null, [])).toEqual({ counted: false, holders: 0, countedAt: null, recentMints: [] })
    expect(activityViewOf({ synced_at: null, holders: 0 }, []).counted).toBe(false)
  })

  it('reads counted with the holders and the 12 latest mints, newest first, minters checksummed', () => {
    expect(RECENT_MINTS_SHOWN).toBe(12)
    expect(counted).toMatchObject({ counted: true, holders: 171, countedAt: SYNCED_AT })
    expect(counted.recentMints).toHaveLength(12)
    expect(counted.recentMints[0]).toEqual({
      txHash: `0x${'e'.padStart(64, '0')}` as Hex,
      minter: MINTER,
      amount: 1,
      groupId: 0,
      at: SYNCED_AT,
      firstTokenId: 30,
    })
    expect(counted.recentMints.map((mint) => mint.at)).toEqual(
      Array.from({ length: 12 }, (_, index) => SYNCED_AT - index * 12),
    )
  })
})

describe('behindOf', () => {
  it('is behind at 301 s and not at 300 s', () => {
    expect(BEHIND_AFTER_S).toBe(300)
    expect(behindOf(counted, SYNCED_AT + 300, true)).toBe(false)
    expect(behindOf(counted, SYNCED_AT + 301, true)).toBe(true)
  })

  it('is never behind while the chain read is the copy, or before the indexer has counted', () => {
    expect(behindOf(counted, SYNCED_AT + 3_600, false)).toBe(false)
    expect(behindOf(activityViewOf(null, []), SYNCED_AT + 3_600, true)).toBe(false)
  })
})

describe('paidByMintersOf (docs/specs/2026-10-16-indexer-overview.md, decision 15)', () => {
  it("pays minters the creator's balance plus every withdrawal, to the wei", () => {
    expect(paidByMintersOf({ creatorBalanceWei: '700', withdrawnWei: '300' }, counted)).toEqual({
      kind: 'wei',
      wei: '1000',
    })
    expect(
      paidByMintersOf({ creatorBalanceWei: '1500000000000000000000', withdrawnWei: '2' }, counted),
    ).toEqual({ kind: 'wei', wei: '1500000000000000000002' })
  })

  it('reads counting before the indexer has counted, and not read without the view or the balance', () => {
    expect(
      paidByMintersOf({ creatorBalanceWei: '700', withdrawnWei: '0' }, activityViewOf(null, [])),
    ).toEqual({
      kind: 'counting',
    })
    expect(paidByMintersOf({ creatorBalanceWei: '700', withdrawnWei: '0' }, null)).toEqual({
      kind: 'not-read',
    })
    expect(paidByMintersOf({ creatorBalanceWei: null, withdrawnWei: '0' }, counted)).toEqual({
      kind: 'not-read',
    })
  })
})
```

In `apps/web/src/components/manage/manage-sim.test.ts`, replace:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { classifyError } from '@/components/deploy/tx-errors'
import { DEMO_COLLECTION, DEMO_MINT_GROUPS, DEMO_NOW, DEMO_TOTAL_MINTED } from '@/lib/demo'
import { airdropCalls, phaseCalls, settingsCalls, type ManageCall } from '@/lib/manage/phase-calls'
import type { PhasesView } from '@/lib/manage/phases-types'
import {
  sampleApply,
  sampleManageActions,
```

with:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { classifyError } from '@/components/deploy/tx-errors'
import { DEMO_ACTIVITY, DEMO_COLLECTION, DEMO_MINT_GROUPS, DEMO_NOW, DEMO_TOTAL_MINTED } from '@/lib/demo'
import { behindOf, paidByMintersOf } from '@/lib/manage/activity-view'
import { airdropCalls, phaseCalls, settingsCalls, type ManageCall } from '@/lib/manage/phase-calls'
import type { PhasesView } from '@/lib/manage/phases-types'
import {
  sampleActivityView,
  sampleApply,
  sampleManageActions,
```

In `apps/web/src/components/manage/manage-sim.test.ts`, replace:

```ts
    vi.useRealTimers()
  })
})
```

with:

```ts
    vi.useRealTimers()
  })
})

describe('the Overview activity on the sample (docs/specs/2026-10-16-indexer-overview.md, section 8)', () => {
  it('reads counted with 171 holders and 12 mints 30 s before the sample now, not counted or 20 minutes behind on its switches', () => {
    expect(sampleActivityView(undefined)).toEqual({
      counted: true,
      holders: 171,
      countedAt: DEMO_NOW - 30,
      recentMints: DEMO_ACTIVITY.recentMints,
    })
    expect(sampleActivityView('counting')).toMatchObject({ counted: false, countedAt: null })
    const behind = sampleActivityView('behind')
    expect(behind).toMatchObject({ counted: true, countedAt: DEMO_NOW - 1_200 })
    expect(behindOf(behind, DEMO_NOW, true)).toBe(true)
    expect(behindOf(sampleActivityView(undefined), DEMO_NOW, true)).toBe(false)
  })

  it("pays minters the sample's gross through paidByMintersOf, and reads counting before the count", () => {
    const wallet: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
    const settings = sampleSettingsView({ max_supply: DEMO_COLLECTION.maxSupply }, wallet)
    expect(paidByMintersOf(settings, sampleActivityView(undefined))).toEqual({
      kind: 'wei',
      wei: DEMO_ACTIVITY.proceeds.grossWei,
    })
    expect(paidByMintersOf(settings, sampleActivityView('counting'))).toEqual({ kind: 'counting' })
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @cobweb/web exec vitest run src/lib/manage/activity-view.test.ts src/components/manage/manage-sim.test.ts`
Expected: FAIL. Both files fail to load on the missing view (`Cannot find module './activity-view'` for the first): `Test Files  2 failed (2)` and `Tests  no tests`.

- [ ] **Step 3: The view, the core and the action**

Create `apps/web/src/lib/manage/activity-view.ts`:

```ts
import { getAddress, type Hex } from 'viem'
import type { DropActivity } from '@/lib/demo'
import type { SettingsView } from './settings-types'

/**
 * The Overview's activity, pure (docs/specs/2026-10-16-indexer-overview.md, section 7.1): the holders and the
 * latest mints the indexer recorded, whether it has read every block since the deploy, how far behind the
 * chain read its count is, and "Paid by minters". For the browser and the server.
 */

/** The most mints Recent mints shows. */
export const RECENT_MINTS_SHOWN = 12
/** A count more than this many seconds of chain time behind the chain read shows the behind line. */
export const BEHIND_AFTER_S = 300

/** The `indexer_cursors` columns the view reads. */
export type CursorRow = { synced_at: string | null; holders: number }
/** The `mints` columns the view reads. */
export type MintRow = {
  tx_hash: string
  recipient: string
  amount: number
  group_id: number
  block_time: string
  first_token_id: number
}

export type ActivityView = {
  /** The indexer has read every block since the deploy: its counts are whole. */
  counted: boolean
  holders: number
  /** The chain's time at the indexer's last read to the confirmation depth (Unix seconds); null before one. */
  countedAt: number | null
  /** Newest first. */
  recentMints: DropActivity['recentMints']
}

const seconds = (time: string) => Math.floor(Date.parse(time) / 1_000)

/** The view from the collection's cursor (null without one) and its latest mints, newest first. */
export function activityViewOf(cursor: CursorRow | null, mints: MintRow[]): ActivityView {
  const countedAt = cursor?.synced_at ? seconds(cursor.synced_at) : null
  return {
    counted: countedAt !== null,
    holders: cursor?.holders ?? 0,
    countedAt,
    recentMints: mints.slice(0, RECENT_MINTS_SHOWN).map((row) => ({
      txHash: row.tx_hash as Hex,
      minter: getAddress(row.recipient),
      amount: row.amount,
      groupId: row.group_id,
      at: seconds(row.block_time),
      firstTokenId: row.first_token_id,
    })),
  }
}

/**
 * Whether the count trails the chain read by more than 300 s: only while the chain read is reachable (the copy's
 * time says nothing of the chain) and the view is counted.
 */
export function behindOf(activity: ActivityView, readAt: number, chainReachable: boolean): boolean {
  return (
    chainReachable &&
    activity.counted &&
    activity.countedAt !== null &&
    readAt - activity.countedAt > BEHIND_AFTER_S
  )
}

/** "Paid by minters": an amount, "Counting" or "Not read". */
export type PaidByMinters = { kind: 'wei'; wei: string } | { kind: 'counting' } | { kind: 'not-read' }

/**
 * Everything minters paid the creator, platform fees apart (decision 15): `creatorBalance()` plus every
 * `MintFundsWithdrawn`, since the balance grows only on mints and falls only to 0 on a withdrawal, which emits
 * what it paid out. Not read without an activity view or without the balance; counting until the indexer has
 * read every block since the deploy.
 */
export function paidByMintersOf(
  settings: Pick<SettingsView, 'creatorBalanceWei' | 'withdrawnWei'>,
  activity: ActivityView | null,
): PaidByMinters {
  if (!activity || settings.creatorBalanceWei === null) return { kind: 'not-read' }
  if (!activity.counted) return { kind: 'counting' }
  return { kind: 'wei', wei: (BigInt(settings.creatorBalanceWei) + BigInt(settings.withdrawnWei)).toString() }
}
```

Create `apps/web/src/lib/manage/activity-core.ts`:

```ts
import type { DeployOutcome } from '@/lib/deploy/deploy-core'
import { activityViewOf, RECENT_MINTS_SHOWN, type ActivityView } from './activity-view'
import type { PhasesContext } from './phases-core'

/**
 * The Overview's activity on the server (docs/specs/2026-10-16-indexer-overview.md, section 7.1): the
 * collection's `indexer_cursors` row and its 12 latest `mints` by block then log index, read with the creator's
 * client under row-level security, after the action's session and ownership check. No `server-only` marker, so
 * `verify:indexer` can import it; the browser never does. A read that fails throws, so the action logs it and
 * the Overview reads "Not read".
 */
export async function activityViewCore(ctx: PhasesContext): Promise<DeployOutcome<ActivityView>> {
  const [cursor, mints] = await Promise.all([
    ctx.supabase
      .from('indexer_cursors')
      .select('synced_at, holders')
      .eq('collection_id', ctx.collection.id)
      .maybeSingle(),
    ctx.supabase
      .from('mints')
      .select('tx_hash, recipient, amount, group_id, block_time, first_token_id')
      .eq('collection_id', ctx.collection.id)
      .order('block', { ascending: false })
      .order('log_index', { ascending: false })
      .limit(RECENT_MINTS_SHOWN),
  ])
  if (cursor.error) throw new Error(`The indexer's cursor could not be read: ${cursor.error.message}`)
  if (mints.error) throw new Error(`The mints could not be read: ${mints.error.message}`)
  return { data: activityViewOf(cursor.data, mints.data) }
}
```

Create `apps/web/src/app/actions/activity.ts`:

```ts
'use server'

import type { ActionResult } from '@/lib/art/result'
import { activityViewCore } from '@/lib/manage/activity-core'
import type { ActivityView } from '@/lib/manage/activity-view'
import { phasesWrite } from '@/lib/manage/phases-write'

/**
 * The Overview's activity (docs/specs/2026-10-16-indexer-overview.md, section 7.1): the holders and the latest
 * mints the indexer recorded, through `phasesWrite`, which checks the session and the ownership (CLAUDE.md rule
 * 4).
 */
export async function getActivity(collectionId: string): Promise<ActionResult<ActivityView>> {
  return phasesWrite(collectionId, activityViewCore)
}
```

- [ ] **Step 4: The sample's view**

In `apps/web/src/components/manage/manage-sim.ts`, replace:

```ts
import type { Tables } from '@/lib/database.types'
import {
  DEMO_COLLECTION,
  DEMO_DEPLOYMENT,
```

with:

```ts
import type { Tables } from '@/lib/database.types'
import {
  DEMO_ACTIVITY,
  DEMO_COLLECTION,
  DEMO_DEPLOYMENT,
```

In `apps/web/src/components/manage/manage-sim.ts`, replace:

```ts
import type { Hex, MintGroup } from '@/lib/demo'
import type { ActionResult } from '@/lib/art/result'
import { phaseCalls, type ManageCall } from '@/lib/manage/phase-calls'
import type { PhaseAdd, PhasesView } from '@/lib/manage/phases-types'
```

with:

```ts
import type { Hex, MintGroup } from '@/lib/demo'
import type { ActionResult } from '@/lib/art/result'
import type { ActivityView } from '@/lib/manage/activity-view'
import { phaseCalls, type ManageCall } from '@/lib/manage/phase-calls'
import type { PhaseAdd, PhasesView } from '@/lib/manage/phases-types'
```

In `apps/web/src/components/manage/manage-sim.ts`, replace:

```ts
    updatedAt: null,
  }
}

```

with:

```ts
    updatedAt: null,
  }
}

/**
 * The Overview's activity in sample mode (docs/specs/2026-10-16-indexer-overview.md, section 8): the sample's 171
 * holders and its 12 mints, counted 30 s before the sample's now; `?activity=counting` not counted yet, and
 * `?activity=behind` counted 20 minutes before the sample's now.
 */
export function sampleActivityView(variant: string | undefined): ActivityView {
  const counted: ActivityView = {
    counted: true,
    holders: DEMO_ACTIVITY.holders,
    countedAt: DEMO_NOW - 30,
    recentMints: DEMO_ACTIVITY.recentMints,
  }
  if (variant === 'counting') return { ...counted, counted: false, countedAt: null }
  if (variant === 'behind') return { ...counted, countedAt: DEMO_NOW - 20 * 60 }
  return counted
}

```

- [ ] **Step 5: Run the tests to see them pass**

Run: `pnpm --filter @cobweb/web exec vitest run src/lib/manage/activity-view.test.ts src/components/manage/manage-sim.test.ts`
Expected: PASS, `Test Files  2 passed (2)` and `Tests  21 passed (21)`.

- [ ] **Step 6: The screen and the route**

The header's Holders reads the count, "Counting" or "Not read"; Proceeds shows "Paid by minters" on real data; Recent mints shows the table, "Counting", the none sentence or "Not read", and the behind line under it; rows are keyed by hash and first token id (Decision 16). The route reads the activity beside its other reads, a refusal passing `activity: null`, and sample mode takes `?activity=`.

In `apps/web/src/components/manage/overview-cards.tsx`, replace:

```tsx
 * The top of the overview, one compact row: the artwork, minted of supply, the contract, what the
 * contract points at right now (with Reveal), and holders. Minted reads "Not read" while the contract
 * cannot be read (`totalMinted` null); "deployed" is relative to the read's time (`readAt`).
 */
export function OverviewHeader({
```

with:

```tsx
 * The top of the overview, one compact row: the artwork, minted of supply, the contract, what the
 * contract points at right now (with Reveal), and holders. Minted reads "Not read" while the contract
 * cannot be read (`totalMinted` null); "deployed" is relative to the read's time (`readAt`). Holders is the
 * indexer's count, "Counting" until it has read every block since the deploy, and "Not read" when its view
 * could not be read (docs/specs/2026-10-16-indexer-overview.md, section 7.2).
 */
export function OverviewHeader({
```

In `apps/web/src/components/manage/overview-cards.tsx`, replace:

```tsx
  maxSupply: number
  readAt: number
  holders: number
  settings: SettingsView
} & RevealProps) {
```

with:

```tsx
  maxSupply: number
  readAt: number
  holders: number | 'counting' | null
  settings: SettingsView
} & RevealProps) {
```

In `apps/web/src/components/manage/overview-cards.tsx`, replace:

```tsx
      <ContractPointer settings={settings} chain={chain} {...reveal} />
      <Fact label="Holders">
        <p className="numeric text-lg leading-tight">{count(holders)}</p>
      </Fact>
    </section>
```

with:

```tsx
      <ContractPointer settings={settings} chain={chain} {...reveal} />
      <Fact label="Holders">
        {typeof holders === 'number' ? (
          <p className="numeric text-lg leading-tight">{count(holders)}</p>
        ) : (
          <p className="text-muted-foreground text-lg leading-tight">
            {holders === 'counting' ? 'Counting' : 'Not read'}
          </p>
        )}
      </Fact>
    </section>
```

In `apps/web/src/components/manage/overview-parts.tsx`, replace:

```tsx
import { StatusBadge } from '@cobweb/ui/components/status-badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@cobweb/ui/components/table'
import {
  explorerTxUrl,
  formatNative,
  shortAddress,
  type DropActivity,
  type MintGroup,
  type SupportedChain,
} from '@/lib/demo'
import { count, localDateTime, percent, relativeTo, shortUtc, useTimeZone } from './format'

/**
```

with:

```tsx
import { StatusBadge } from '@cobweb/ui/components/status-badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@cobweb/ui/components/table'
import { explorerTxUrl, formatNative, shortAddress, type MintGroup, type SupportedChain } from '@/lib/demo'
import { behindOf, type ActivityView } from '@/lib/manage/activity-view'
import { count, duration, localDateTime, percent, relativeTo, shortUtc, useTimeZone } from './format'

/**
```

In `apps/web/src/components/manage/overview-parts.tsx`, replace:

```tsx
}

/** The latest mints, newest first. */
export function RecentMints({
  mints,
  groups,
  chain,
  readAt,
}: {
  mints: DropActivity['recentMints']
  groups: MintGroup[]
  chain: SupportedChain
  readAt: number
}) {
  if (mints.length === 0) {
    return (
      <p className="text-muted-foreground px-6 py-10 text-center text-sm">
        No mints yet. They appear here as they land.
      </p>
    )
  }
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="pl-6">Minter</TableHead>
          <TableHead>Phase</TableHead>
          <TableHead className="text-right">Tokens</TableHead>
          <TableHead className="text-right">Token ids</TableHead>
          <TableHead className="pr-6 text-right">When</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {mints.map((mint) => (
          <TableRow key={mint.txHash}>
            <TableCell className="numeric pl-6" title={mint.minter}>
              {shortAddress(mint.minter)}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {groups.find((group) => group.id === mint.groupId)?.name ?? `Phase ${mint.groupId}`}
            </TableCell>
            <TableCell className="numeric text-right">{mint.amount}</TableCell>
            <TableCell className="numeric text-muted-foreground text-right">
              {mint.amount === 1
                ? `#${mint.firstTokenId}`
                : `#${mint.firstTokenId} to #${mint.firstTokenId + mint.amount - 1}`}
            </TableCell>
            <TableCell className="pr-6 text-right">
              <a
                href={explorerTxUrl(chain, mint.txHash)}
                target="_blank"
                rel="noreferrer"
                className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex items-center gap-1 rounded-sm outline-none focus-visible:ring-2"
              >
                {relativeTo(mint.at, readAt)}
                <ExternalLinkIcon aria-hidden="true" className="size-3" />
                <span className="sr-only">, view transaction</span>
              </a>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
```

with:

```tsx
}

/** A sentence in place of the table. */
function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-muted-foreground px-6 py-10 text-center text-sm">{children}</p>
}

/**
 * The latest mints the indexer recorded, newest first (docs/specs/2026-10-16-indexer-overview.md, section 7.2):
 * "Counting" until it has read every block since the deploy, and under the table a line when its count trails
 * the chain read by more than 5 minutes.
 */
export function RecentMints({
  activity,
  groups,
  chain,
  readAt,
  chainReachable,
}: {
  /** Null when the view could not be read. */
  activity: ActivityView | null
  groups: MintGroup[]
  chain: SupportedChain
  /** The chain read's time (the copy's while it is not reachable). */
  readAt: number
  chainReachable: boolean
}) {
  if (!activity) return <Note>The mint history could not be read. Reload the page to try again.</Note>
  if (!activity.counted)
    return (
      <Note>
        Counting the mints from the chain. They show here once Cobweb has read every block since the deploy.
      </Note>
    )
  const mints = activity.recentMints
  const behind = behindOf(activity, readAt, chainReachable) && activity.countedAt !== null && (
    <p className="text-muted-foreground border-t px-6 pt-3 text-[0.8125rem]">
      Counted to the chain as it was {duration(readAt - activity.countedAt)} ago. Newer mints show once Cobweb
      catches up.
    </p>
  )
  if (mints.length === 0)
    return (
      <>
        <Note>No mints yet. Each one shows here a few blocks after it lands.</Note>
        {behind}
      </>
    )
  return (
    <>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="pl-6">Minter</TableHead>
            <TableHead>Phase</TableHead>
            <TableHead className="text-right">Tokens</TableHead>
            <TableHead className="text-right">Token ids</TableHead>
            <TableHead className="pr-6 text-right">When</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {mints.map((mint) => (
            // Two mints in one transaction share its hash; their first token ids differ.
            <TableRow key={`${mint.txHash}:${mint.firstTokenId}`}>
              <TableCell className="numeric pl-6" title={mint.minter}>
                {shortAddress(mint.minter)}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {groups.find((group) => group.id === mint.groupId)?.name ?? `Phase ${mint.groupId}`}
              </TableCell>
              <TableCell className="numeric text-right">{mint.amount}</TableCell>
              <TableCell className="numeric text-muted-foreground text-right">
                {mint.amount === 1
                  ? `#${mint.firstTokenId}`
                  : `#${mint.firstTokenId} to #${mint.firstTokenId + mint.amount - 1}`}
              </TableCell>
              <TableCell className="pr-6 text-right">
                <a
                  href={explorerTxUrl(chain, mint.txHash)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex items-center gap-1 rounded-sm outline-none focus-visible:ring-2"
                >
                  {relativeTo(mint.at, readAt)}
                  <ExternalLinkIcon aria-hidden="true" className="size-3" />
                  <span className="sr-only">, view transaction</span>
                </a>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {behind}
    </>
  )
}
```

In `apps/web/src/components/manage/overview-screen.tsx`, replace:

```tsx
import { NOT_OWNER } from '@/lib/art/result'
import type { Tables } from '@/lib/database.types'
import { formatNative, type DropActivity, type MintGroup, type SupportedChain } from '@/lib/demo'
import type { ManageCall } from '@/lib/manage/phase-calls'
import type { SettingsView } from '@/lib/manage/settings-types'
```

with:

```tsx
import { NOT_OWNER } from '@/lib/art/result'
import type { Tables } from '@/lib/database.types'
import { formatNative, type MintGroup, type SupportedChain } from '@/lib/demo'
import { paidByMintersOf, type ActivityView } from '@/lib/manage/activity-view'
import type { ManageCall } from '@/lib/manage/phase-calls'
import type { SettingsView } from '@/lib/manage/settings-types'
```

In `apps/web/src/components/manage/overview-screen.tsx`, replace:

```tsx
  /** Phases as the chain reports them; `active` comes from `mintGroupActive`. */
  groups: MintGroup[]
  /** Holders and recent mints: the sample's, on real data too, until the indexer. */
  activity: DropActivity
  /** Everything minted, from the chain read; null while the contract cannot be read. */
  totalMinted: number | null
```

with:

```tsx
  /** Phases as the chain reports them; `active` comes from `mintGroupActive`. */
  groups: MintGroup[]
  /**
   * Holders and recent mints from the indexer, and whether it has counted every block since the deploy
   * (docs/specs/2026-10-16-indexer-overview.md, section 7.2); null when the view could not be read.
   */
  activity: ActivityView | null
  /** Everything minted, from the chain read; null while the contract cannot be read. */
  totalMinted: number | null
```

In `apps/web/src/components/manage/overview-screen.tsx`, replace:

```tsx
  wallet: Address
  sample: boolean
  /** "Paid by minters": the sample's in sample mode, null on real data until the indexer. */
  paidByMintersWei: string | null
  /**
   * The mint page's row: its avatar and whether it is public; null when it could not be read, so the header shows
```

with:

```tsx
  wallet: Address
  sample: boolean
  /**
   * The mint page's row: its avatar and whether it is public; null when it could not be read, so the header shows
```

In `apps/web/src/components/manage/overview-screen.tsx`, replace:

```tsx
 * supply, the contract, what it points at with Reveal, holders), the mint page link, then live phases, proceeds
 * and recent mints. Reveal runs on its own manage actions and answers a fresh settings view. Tradability lives in
 * Settings, Advanced.
 */
export function OverviewScreen({
```

with:

```tsx
 * supply, the contract, what it points at with Reveal, holders), the mint page link, then live phases, proceeds
 * and recent mints. Reveal runs on its own manage actions and answers a fresh settings view. Tradability lives in
 * Settings, Advanced. Holders, recent mints and "Paid by minters" come from the indexer
 * (docs/specs/2026-10-16-indexer-overview.md, section 7.2).
 */
export function OverviewScreen({
```

In `apps/web/src/components/manage/overview-screen.tsx`, replace:

```tsx
  wallet,
  sample,
  paidByMintersWei,
  mintPage,
}: OverviewScreenProps) {
```

with:

```tsx
  wallet,
  sample,
  mintPage,
}: OverviewScreenProps) {
```

In `apps/web/src/components/manage/overview-screen.tsx`, replace:

```tsx
  const owner = settings.owner
  const blocked = owner !== null && owner.toLowerCase() !== wallet.toLowerCase() ? NOT_OWNER(owner) : null

  return (
```

with:

```tsx
  const owner = settings.owner
  const blocked = owner !== null && owner.toLowerCase() !== wallet.toLowerCase() ? NOT_OWNER(owner) : null
  const paid = paidByMintersOf(settings, activity)

  return (
```

In `apps/web/src/components/manage/overview-screen.tsx`, replace:

```tsx
          maxSupply={maxSupply}
          readAt={readAt}
          holders={activity.holders}
          settings={settings}
          blocked={blocked}
```

with:

```tsx
          maxSupply={maxSupply}
          readAt={readAt}
          holders={activity === null ? null : activity.counted ? activity.holders : 'counting'}
          settings={settings}
          blocked={blocked}
```

In `apps/web/src/components/manage/overview-screen.tsx`, replace:

```tsx
              </div>
              <dl className="divide-y border-t">
                {paidByMintersWei !== null && (
                  <Row label="Paid by minters">{formatNative(paidByMintersWei, symbol)}</Row>
                )}
                <Row label="Already withdrawn">{formatNative(settings.withdrawnWei, symbol)}</Row>
              </dl>
```

with:

```tsx
              </div>
              <dl className="divide-y border-t">
                <Row label="Paid by minters">
                  {paid.kind === 'wei' ? (
                    formatNative(paid.wei, symbol)
                  ) : (
                    <span className="text-muted-foreground font-sans">
                      {paid.kind === 'counting' ? 'Counting' : 'Not read'}
                    </span>
                  )}
                </Row>
                <Row label="Already withdrawn">{formatNative(settings.withdrawnWei, symbol)}</Row>
              </dl>
```

In `apps/web/src/components/manage/overview-screen.tsx`, replace:

```tsx

          <Panel title="Recent mints" className="lg:col-span-2" bodyClassName="p-0 pb-2">
            <RecentMints mints={activity.recentMints} groups={groups} chain={chain} readAt={readAt} />
          </Panel>
        </div>
```

with:

```tsx

          <Panel title="Recent mints" className="lg:col-span-2" bodyClassName="p-0 pb-2">
            <RecentMints
              activity={activity}
              groups={groups}
              chain={chain}
              readAt={readAt}
              chainReachable={chainReachable}
            />
          </Panel>
        </div>
```

In `apps/web/src/app/collections/[id]/manage/page.tsx`, replace:

```tsx
import { getAddress } from 'viem'
import { getDeployment } from '@/app/actions/deploy'
import { getMintPageSettings } from '@/app/actions/mint-page'
import { getPhases } from '@/app/actions/phases'
import { getSettings } from '@/app/actions/settings'
import { ManageUnavailable } from '@/components/manage/manage-unavailable'
import { OverviewScreen } from '@/components/manage/overview-screen'
import { SAMPLE } from '@/components/manage/manage-sim'
import { sampleSettingsView } from '@/components/manage/settings-sim'
import { StagePage } from '@/components/shell/stage-page'
import { NOT_DEPLOYED } from '@/lib/art/result'
import { requireOwnedCollection, requireUser } from '@/lib/auth'
import { chainView } from '@/lib/chain/chain-view'
import {
  DEMO_ACTIVITY,
  DEMO_COLLECTION,
  DEMO_DEPLOYMENT,
```

with:

```tsx
import { getAddress } from 'viem'
import { getActivity } from '@/app/actions/activity'
import { getDeployment } from '@/app/actions/deploy'
import { getMintPageSettings } from '@/app/actions/mint-page'
import { getPhases } from '@/app/actions/phases'
import { getSettings } from '@/app/actions/settings'
import { ManageUnavailable } from '@/components/manage/manage-unavailable'
import { OverviewScreen } from '@/components/manage/overview-screen'
import { SAMPLE, sampleActivityView } from '@/components/manage/manage-sim'
import { sampleSettingsView } from '@/components/manage/settings-sim'
import { StagePage } from '@/components/shell/stage-page'
import { NOT_DEPLOYED } from '@/lib/art/result'
import { requireOwnedCollection, requireUser } from '@/lib/auth'
import { chainView } from '@/lib/chain/chain-view'
import {
  DEMO_COLLECTION,
  DEMO_DEPLOYMENT,
```

In `apps/web/src/app/collections/[id]/manage/page.tsx`, replace:

```tsx
 * deploy time come from the deployment record; minted and the live phases from the server's read of the chain;
 * what the base URI points at, Reveal and proceeds from the settings read; the avatar and the mint page bar's public
 * switch from the mint page's row (docs/specs/2026-10-16-mint-page-live-data.md, section 7.9). Holders and recent
 * mints keep their sample values until the indexer, and "Paid by minters" shows in sample mode only.
 * In sample mode `?art=deferred` shows the deferred-art scenario, whose real set is not rendered yet, and
 * `?art=revealed` a collection already revealed.
 */
export default async function Page({
```

with:

```tsx
 * deploy time come from the deployment record; minted and the live phases from the server's read of the chain;
 * what the base URI points at, Reveal and proceeds from the settings read; the avatar and the mint page bar's public
 * switch from the mint page's row (docs/specs/2026-10-16-mint-page-live-data.md, section 7.9); holders, recent mints
 * and "Paid by minters" from the indexer's tables (docs/specs/2026-10-16-indexer-overview.md, section 7.2), "Not
 * read" when they could not be read. In sample mode `?art=deferred` shows the deferred-art scenario, whose real set
 * is not rendered yet, `?art=revealed` a collection already revealed, `?activity=counting` the indexer not counted
 * yet and `?activity=behind` its count 20 minutes behind the chain.
 */
export default async function Page({
```

In `apps/web/src/app/collections/[id]/manage/page.tsx`, replace:

```tsx
          chain={getChain(DEMO_DEPLOYMENT.chainId)!}
          groups={sample.groups}
          activity={DEMO_ACTIVITY}
          totalMinted={sample.totalMinted}
          maxSupply={maxSupply}
```

with:

```tsx
          chain={getChain(DEMO_DEPLOYMENT.chainId)!}
          groups={sample.groups}
          activity={sampleActivityView(await searchParam(searchParams, 'activity'))}
          totalMinted={sample.totalMinted}
          maxSupply={maxSupply}
```

In `apps/web/src/app/collections/[id]/manage/page.tsx`, replace:

```tsx
          wallet={wallet}
          sample
          paidByMintersWei={DEMO_ACTIVITY.proceeds.grossWei}
          mintPage={{ avatarUrl: SAMPLE.mintPage.avatarUrl, published: SAMPLE.mintPage.published }}
        />
      </StagePage>
    )
  }

  const [record, phases, settings, mintPage] = await Promise.all([
    getDeployment(collection.id),
    getPhases(collection.id),
    getSettings(collection.id),
    getMintPageSettings(collection.id),
  ])
  if (!record.ok || !record.data || !phases.ok || !settings.ok) {
```

with:

```tsx
          wallet={wallet}
          sample
          mintPage={{ avatarUrl: SAMPLE.mintPage.avatarUrl, published: SAMPLE.mintPage.published }}
        />
      </StagePage>
    )
  }

  const [record, phases, settings, mintPage, activity] = await Promise.all([
    getDeployment(collection.id),
    getPhases(collection.id),
    getSettings(collection.id),
    getMintPageSettings(collection.id),
    getActivity(collection.id),
  ])
  if (!record.ok || !record.data || !phases.ok || !settings.ok) {
```

In `apps/web/src/app/collections/[id]/manage/page.tsx`, replace:

```tsx
        chain={chainView(view.chainId)}
        groups={view.groups}
        activity={DEMO_ACTIVITY}
        totalMinted={view.chainReachable ? view.totalMinted : null}
        maxSupply={view.maxSupply}
```

with:

```tsx
        chain={chainView(view.chainId)}
        groups={view.groups}
        // A refused read does not stop the page: holders, recent mints and "Paid by minters" read "Not read".
        activity={activity.ok ? activity.data : null}
        totalMinted={view.chainReachable ? view.totalMinted : null}
        maxSupply={view.maxSupply}
```

In `apps/web/src/app/collections/[id]/manage/page.tsx`, replace:

```tsx
        wallet={wallet}
        sample={false}
        paidByMintersWei={null}
        // The row only dresses the header and the switch: unread, they show the pattern and wait for a reload.
        mintPage={
```

with:

```tsx
        wallet={wallet}
        sample={false}
        // The row only dresses the header and the switch: unread, they show the pattern and wait for a reload.
        mintPage={
```

- [ ] **Step 7: Typecheck and lint the web app**

Run: `pnpm --filter @cobweb/web typecheck && pnpm --filter @cobweb/web lint`
Expected: no errors and no warnings.

- [ ] **Step 8: Format, run the root checks and commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
pnpm exec prettier --write apps/web/src/lib/manage/activity-view.ts apps/web/src/lib/manage/activity-core.ts apps/web/src/app/actions/activity.ts apps/web/src/lib/manage/activity-view.test.ts apps/web/src/components/manage/manage-sim.ts apps/web/src/components/manage/manage-sim.test.ts apps/web/src/components/manage/overview-cards.tsx apps/web/src/components/manage/overview-parts.tsx apps/web/src/components/manage/overview-screen.tsx 'apps/web/src/app/collections/[id]/manage/page.tsx'
pnpm typecheck && pnpm lint && pnpm test
git add apps/web/src/lib/manage/activity-view.ts apps/web/src/lib/manage/activity-core.ts apps/web/src/app/actions/activity.ts apps/web/src/lib/manage/activity-view.test.ts apps/web/src/components/manage/manage-sim.ts apps/web/src/components/manage/manage-sim.test.ts apps/web/src/components/manage/overview-cards.tsx apps/web/src/components/manage/overview-parts.tsx apps/web/src/components/manage/overview-screen.tsx 'apps/web/src/app/collections/[id]/manage/page.tsx'
git commit -m "$(cat <<'EOF'
Put the Overview's holders, recent mints and Paid by minters on the indexer's tables, with the Counting, behind and Not read states

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: the web app reports 887 tests in 94 files; the other packages are unchanged.

---

### Task 6: Airdrop's History with block times, By recipient with its search, pages and export, and the Settings sentence

**Kind:** integration. The plan carries every line, but the task spans the view, the server's query with its 416 path, the actions, the sample server and a new panel across fifteen files: an Opus implementer.

**Files:**

- Create: `apps/web/src/components/manage/airdrop-history.tsx`
- Modify: `apps/web/src/lib/manage/airdrop-types.ts` (`counted`, `RecipientRow`, `RecipientPage`, `RECIPIENTS_PAGE`), `airdrop-view.ts` (When from the block time, `counted`, the recipient helpers), `airdrop-core.ts` (the counted read and the two recipients cores), `apps/web/src/app/actions/airdrop.ts` (two actions), `apps/web/src/lib/art/result.ts` (two sentences), `apps/web/src/lib/demo/types.ts` and `data.ts` (the sample's recipients), `apps/web/src/components/manage/airdrop-server.ts` (two methods), `airdrop-sim.ts` (`counted`, `sampleRecipients`, the sample server's methods), `airdrop-parts.tsx` (`tokenRange` and History's comment), `airdrop-screen.tsx` (History through the new panel), `apps/web/src/app/collections/[id]/manage/airdrop/page.tsx` (`?activity=counting`)
- Modify (tests): `apps/web/src/lib/manage/airdrop-view.test.ts`, `apps/web/src/components/manage/airdrop-sim.test.ts`
- Test: the two test files

**Interfaces:**

- Consumes: Task 1's `airdrops.block_time`, `airdrop_recipients` and `indexer_cursors.synced_at`; `readAll`, `phasesWrite`, `manageRecordError`, `Pager`, `CopyButton`, `TxLink`, `toCsv`, `downloadText`, `shortUtc`, `relativeTo`, `count`; the shadcn `ToggleGroup`, `InputGroup`, `Panel`, `Badge`, `Table` and `Skeleton`; TanStack Query's `useQuery` and `keepPreviousData`.
- Produces:
  - `airdrop-types.ts`: `AirdropView.counted: boolean`, `RecipientRow = { txHash: Hex; wallet: Address; tokens: number; firstTokenId: number; lastTokenId: number; at: number; burn: boolean }`, `RecipientPage = { rows: RecipientRow[]; total: number; page: number }`, `RECIPIENTS_PAGE = 25`
  - `airdrop-view.ts`: `AirdropDbRow.block_time`, `RecipientDbRow`, `airdropViewOf(base: { chainId; contract; maxSupply; readAt; counted: boolean }, history, state)`, `tokenIdsText(first: number, last: number): string`, `recipientSearchOf(input: string): string`, `recipientRowsOf(rows: RecipientDbRow[]): RecipientRow[]`, `recipientsCsvRows(rows: RecipientRow[]): string[][]`
  - `airdrop-core.ts`: `airdropViewCore` reads `block_time` and the counted flag; `airdropRecipientsCore(ctx: AirdropContext, query: { search: string; page: number }): Promise<DeployOutcome<RecipientPage>>`, `airdropRecipientsAllCore(ctx: AirdropContext): Promise<DeployOutcome<RecipientRow[]>>` (Decision 14)
  - `app/actions/airdrop.ts`: `getAirdropRecipients(collectionId: string, query: { search: string; page: number }): Promise<ActionResult<RecipientPage>>`, `exportAirdropRecipients(collectionId: string): Promise<ActionResult<RecipientRow[]>>`
  - `lib/art/result.ts`: `WITHDRAWAL_TIMED_OUT` reworded (spec section 7.4), `RECIPIENTS_NOT_READ = 'The recipients could not be read. Try again in a moment.'`
  - `AirdropServer` gains `recipients(query)` and `exportRecipients()`; `sampleAirdropView(collection, wallet, { chainReachable?, owner?, counted? })`; `sampleRecipients(): RecipientRow[]`; `DEMO_AIRDROP_RECIPIENTS: AirdropRecipientRecord[]` (Decision 15)
  - `airdrop-history.tsx`: `HistoryPanel({ collectionId, view, chain, server })`

- [ ] **Step 1: Write the failing tests**

When reads the block's time once the indexer has read the airdrop; the view carries `counted`; the recipient rows mark the dead address a burn; the search keeps hex digits only; the CSV rows; the sample's counted switch, its recipients and its pages, search and export.

In `apps/web/src/lib/manage/airdrop-view.test.ts`, replace:

```ts
import { getAddress, pad, toHex, type Address, type Hex } from 'viem'
import { describe, expect, it } from 'vitest'
import type { AirdropRow, AirdropState, AirdropView, BatchEntry } from './airdrop-types'
import { airdropRowsOf, airdropViewOf, batchesOf, tokensOf, type AirdropDbRow } from './airdrop-view'

const CONTRACT: Address = '0x0409454C375c8a6aB05383bFB6D9FcDe9ebB8F85'
```

with:

```ts
import { getAddress, pad, toHex, type Address, type Hex } from 'viem'
import { describe, expect, it } from 'vitest'
import type { AirdropRow, AirdropState, AirdropView, BatchEntry, RecipientRow } from './airdrop-types'
import {
  airdropRowsOf,
  airdropViewOf,
  batchesOf,
  recipientRowsOf,
  recipientSearchOf,
  recipientsCsvRows,
  tokenIdsText,
  tokensOf,
  type AirdropDbRow,
  type RecipientDbRow,
} from './airdrop-view'

const CONTRACT: Address = '0x0409454C375c8a6aB05383bFB6D9FcDe9ebB8F85'
```

In `apps/web/src/lib/manage/airdrop-view.test.ts`, replace:

```ts
    block: 21_499_995,
    confirmed_at: '2026-10-13T15:00:00.400+00:00',
  },
  {
```

with:

```ts
    block: 21_499_995,
    confirmed_at: '2026-10-13T15:00:00.400+00:00',
    // Read by the indexer: its block came 2 s before Cobweb recorded it.
    block_time: '2026-10-13T14:59:58+00:00',
  },
  {
```

In `apps/web/src/lib/manage/airdrop-view.test.ts`, replace:

```ts
    block: 21_499_990,
    confirmed_at: '2026-10-11T15:00:00+00:00',
  },
]

describe('airdropRowsOf', () => {
  it('keeps the order read and reads confirmed_at as Unix seconds', () => {
    expect(airdropRowsOf(ROWS)).toEqual<AirdropRow[]>([
      {
```

with:

```ts
    block: 21_499_990,
    confirmed_at: '2026-10-11T15:00:00+00:00',
    block_time: null,
  },
]

describe('airdropRowsOf', () => {
  it("keeps the order read, and reads When from the block's time once the indexer read it, else from confirmed_at, in Unix seconds", () => {
    expect(airdropRowsOf(ROWS)).toEqual<AirdropRow[]>([
      {
```

In `apps/web/src/lib/manage/airdrop-view.test.ts`, replace:

```ts
        lastTokenId: 12,
        block: 21_499_995,
        confirmedAt: 1_791_903_600,
      },
      {
```

with:

```ts
        lastTokenId: 12,
        block: 21_499_995,
        confirmedAt: 1_791_903_598,
      },
      {
```

In `apps/web/src/lib/manage/airdrop-view.test.ts`, replace:

```ts

describe('airdropViewOf', () => {
  const base = { chainId: 31337, contract: CONTRACT, maxSupply: 3, readAt: 1_791_000_000 }
  const history = airdropRowsOf(ROWS)
  const state: AirdropState = {
```

with:

```ts

describe('airdropViewOf', () => {
  const base = { chainId: 31337, contract: CONTRACT, maxSupply: 3, readAt: 1_791_000_000, counted: true }
  const history = airdropRowsOf(ROWS)
  const state: AirdropState = {
```

In `apps/web/src/lib/manage/airdrop-view.test.ts`, replace:

```ts
      readAt: 1_791_039_600,
      chainReachable: true,
    })
    expect(airdropViewOf(base, history, { ...state, totalMinted: 13 }).left).toBe(0)
  })

  it("answers Cobweb's record alone when the chain does not answer", () => {
    expect(airdropViewOf(base, history, null)).toEqual<AirdropView>({
      chainId: 31337,
      contract: CONTRACT,
```

with:

```ts
      readAt: 1_791_039_600,
      chainReachable: true,
      counted: true,
    })
    expect(airdropViewOf(base, history, { ...state, totalMinted: 13 }).left).toBe(0)
  })

  it("answers Cobweb's record alone when the chain does not answer", () => {
    expect(airdropViewOf({ ...base, counted: false }, history, null)).toEqual<AirdropView>({
      chainId: 31337,
      contract: CONTRACT,
```

In `apps/web/src/lib/manage/airdrop-view.test.ts`, replace:

```ts
      readAt: 1_791_000_000,
      chainReachable: false,
    })
  })
})
```

with:

```ts
      readAt: 1_791_000_000,
      chainReachable: false,
      counted: false,
    })
  })
})

const RECIPIENTS: RecipientDbRow[] = [
  {
    tx_hash: TX_B,
    recipient: '0x000000000000000000000000000000000000dead',
    tokens: 2,
    first_token_id: 11,
    block_time: '2026-10-13T14:59:58+00:00',
  },
  {
    tx_hash: TX_A,
    recipient: OWNER.toLowerCase(),
    tokens: 4,
    first_token_id: 1,
    block_time: '2026-10-11T14:59:00+00:00',
  },
  {
    tx_hash: TX_A,
    recipient: wallet(0).toLowerCase(),
    tokens: 1,
    first_token_id: 5,
    block_time: '2026-10-11T14:59:00+00:00',
  },
]

describe('recipientRowsOf (docs/specs/2026-10-16-indexer-overview.md, section 7.3)', () => {
  it('keeps the order read, checksums each wallet, marks the dead address a burn and ends each run at its last id', () => {
    expect(recipientRowsOf(RECIPIENTS)).toEqual<RecipientRow[]>([
      {
        txHash: TX_B,
        wallet: '0x000000000000000000000000000000000000dEaD',
        tokens: 2,
        firstTokenId: 11,
        lastTokenId: 12,
        at: 1_791_903_598,
        burn: true,
      },
      {
        txHash: TX_A,
        wallet: OWNER,
        tokens: 4,
        firstTokenId: 1,
        lastTokenId: 4,
        at: 1_791_730_740,
        burn: false,
      },
      {
        txHash: TX_A,
        wallet: wallet(0),
        tokens: 1,
        firstTokenId: 5,
        lastTokenId: 5,
        at: 1_791_730_740,
        burn: false,
      },
    ])
  })
})

describe('recipientSearchOf', () => {
  it('keeps the hex digits typed, lowercase, and drops a leading 0x', () => {
    expect(recipientSearchOf('0xAbC1')).toBe('abc1')
    expect(recipientSearchOf('  0X12dEaD ')).toBe('12dead')
    expect(recipientSearchOf('0x')).toBe('')
  })

  it('drops anything else, so the search carries no LIKE wildcard', () => {
    expect(recipientSearchOf('12-34_%')).toBe('1234')
    expect(recipientSearchOf('%')).toBe('')
    expect(recipientSearchOf('x1y')).toBe('1')
  })
})

describe('recipientsCsvRows', () => {
  it('writes the header, then a row per run with its UTC date, wallet, tokens, token ids and transaction', () => {
    expect(recipientsCsvRows(recipientRowsOf(RECIPIENTS))).toEqual([
      ['date_utc', 'wallet', 'tokens', 'token_ids', 'tx_hash'],
      ['2026-10-13T14:59:58.000Z', '0x000000000000000000000000000000000000dEaD', '2', '#11 to #12', TX_B],
      ['2026-10-11T14:59:00.000Z', OWNER, '4', '#1 to #4', TX_A],
      ['2026-10-11T14:59:00.000Z', wallet(0), '1', '#5', TX_A],
    ])
    expect(tokenIdsText(7, 7)).toBe('#7')
  })
})
```

In `apps/web/src/components/manage/airdrop-sim.test.ts`, replace:

```ts
import { airdropCalls, type ManageCall } from '@/lib/manage/phase-calls'
import { airdropJob, rememberAirdropJob } from './manage-machine'
import { sampleAirdropJob, sampleAirdropServer, sampleAirdropView, sampleApplyAirdrop } from './airdrop-sim'

const WALLET: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
```

with:

```ts
import { airdropCalls, type ManageCall } from '@/lib/manage/phase-calls'
import { airdropJob, rememberAirdropJob } from './manage-machine'
import {
  sampleAirdropJob,
  sampleAirdropServer,
  sampleAirdropView,
  sampleApplyAirdrop,
  sampleRecipients,
} from './airdrop-sim'

const WALLET: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
```

In `apps/web/src/components/manage/airdrop-sim.test.ts`, replace:

```ts
      [10, DEMO_AIRDROPS[0]!.at],
    ])
  })

```

with:

```ts
      [10, DEMO_AIRDROPS[0]!.at],
    ])
  })

  it('reads counted, and not counted for ?activity=counting (docs/specs/2026-10-16-indexer-overview.md, section 8)', () => {
    expect(view.counted).toBe(true)
    expect(sampleAirdropView({ max_supply: 100 }, WALLET, { counted: false }).counted).toBe(false)
  })

```

In `apps/web/src/components/manage/airdrop-sim.test.ts`, replace:

```ts
      tokens: 3,
    })
  })
})
```

with:

```ts
      tokens: 3,
    })
  })

  it('answers By recipient from the sample after 300 ms: newest first, searched by part of an address, and the export', async () => {
    const server = sampleAirdropServer(() => view)
    const after300 = async <T>(answer: Promise<T>) => {
      await vi.advanceTimersByTimeAsync(300)
      return answer
    }
    const all = sampleRecipients()
    expect(all.map((row) => [row.tokens, row.firstTokenId, row.lastTokenId, row.burn])).toEqual([
      [2, 11, 12, true],
      [4, 1, 4, false],
      [3, 5, 7, false],
      [2, 8, 9, false],
      [1, 10, 10, false],
    ])
    expect(all.reduce((sum, row) => sum + row.tokens, 0)).toBe(
      DEMO_AIRDROPS.reduce((sum, airdrop) => sum + airdrop.tokens, 0),
    )
    const first = await after300(server.recipients({ search: '', page: 0 }))
    expect(first).toEqual({ ok: true, data: { rows: all, total: 5, page: 0 } })
    const part = all[2]!.wallet.slice(10, 16)
    const found = await after300(server.recipients({ search: `0x${part.toUpperCase()}`, page: 0 }))
    expect(found.ok && found.data.rows.map((row) => row.wallet)).toEqual([all[2]!.wallet])
    expect(await after300(server.exportRecipients())).toEqual({ ok: true, data: all })
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @cobweb/web exec vitest run src/lib/manage/airdrop-view.test.ts src/components/manage/airdrop-sim.test.ts`
Expected: FAIL. The helpers do not exist yet (`TypeError: recipientRowsOf is not a function`, `TypeError: sampleRecipients is not a function`) and the views carry no `counted`: `Test Files  2 failed (2)` and `Tests  9 failed | 11 passed (20)`.

- [ ] **Step 3: The types, the view and the sentences**

In `apps/web/src/lib/manage/airdrop-types.ts`, replace:

```ts
/**
 * The shapes Airdrop moves between the chain, the database, the server and the screen
 * (docs/specs/2026-10-15-airdrop-settings.md, section 6.1). Types only, so the browser imports them without the
 * server module (airdrop-core.ts).
 */

/** Tokens sent to wallets, or a burn: tokens minted to the dead address. */
export type AirdropKind = 'airdrop' | 'burn'

/** One transaction Cobweb proved and recorded, as History shows it. */
export type AirdropRow = {
  txHash: Hex
```

with:

```ts
/**
 * The shapes Airdrop moves between the chain, the database, the server and the screen
 * (docs/specs/2026-10-15-airdrop-settings.md, section 6.1; docs/specs/2026-10-16-indexer-overview.md, section 7.3).
 * Types and By recipient's page size only, so the browser imports them without the server module (airdrop-core.ts).
 */

/** Tokens sent to wallets, or a burn: tokens minted to the dead address. */
export type AirdropKind = 'airdrop' | 'burn'

/** One airdropNFTs transaction, proven by Cobweb or read by the indexer, as History shows it. */
export type AirdropRow = {
  txHash: Hex
```

In `apps/web/src/lib/manage/airdrop-types.ts`, replace:

```ts
  lastTokenId: number
  block: number
  /** When Cobweb recorded it (Unix seconds): later than its block when "Check again" came late. */
  confirmedAt: number
}
```

with:

```ts
  lastTokenId: number
  block: number
  /**
   * When it happened (Unix seconds): its block's time once the indexer has read it, else the time Cobweb recorded
   * it, which is later than its block when "Check again" came late.
   */
  confirmedAt: number
}
```

In `apps/web/src/lib/manage/airdrop-types.ts`, replace:

```ts
  /** False: the history is Cobweb's record, and the fee, minted and left are not read. */
  chainReachable: boolean
}

/** One recipient of a batch: a checksummed address and its tokens (1 to 1,000). */
```

with:

```ts
  /** False: the history is Cobweb's record, and the fee, minted and left are not read. */
  chainReachable: boolean
  /**
   * The indexer has read every block since the deploy, so the history lists the airdrops sent from outside Cobweb
   * too, and By recipient every wallet an airdrop reached.
   */
  counted: boolean
}

/** One run of an airdrop to one wallet, as By recipient shows it. */
export type RecipientRow = {
  txHash: Hex
  /** Checksummed. */
  wallet: Address
  tokens: number
  firstTokenId: number
  lastTokenId: number
  /** The block's time (Unix seconds). */
  at: number
  /** Minted to the dead address. */
  burn: boolean
}

/** One page of By recipient: its rows, how many match in all, and which page it is (from 0). */
export type RecipientPage = { rows: RecipientRow[]; total: number; page: number }

/** The rows of one page of By recipient. */
export const RECIPIENTS_PAGE = 25

/** One recipient of a batch: a checksummed address and its tokens (1 to 1,000). */
```

In `apps/web/src/lib/manage/airdrop-view.ts`, replace:

```ts
import type { Address, Hex } from 'viem'
import type { AirdropRow, AirdropState, AirdropView, BatchEntry } from './airdrop-types'

/**
```

with:

```ts
import { getAddress, type Address, type Hex } from 'viem'
import type { AirdropRow, AirdropState, AirdropView, BatchEntry, RecipientRow } from './airdrop-types'

/**
```

In `apps/web/src/lib/manage/airdrop-view.ts`, replace:

```ts
  block: number
  confirmed_at: string
}

```

with:

```ts
  block: number
  confirmed_at: string
  /** The block's time, set once the indexer has read the airdrop. */
  block_time: string | null
}

/** An `airdrop_recipients` row as the server reads it. */
export type RecipientDbRow = {
  tx_hash: string
  recipient: string
  tokens: number
  first_token_id: number
  block_time: string
}

```

In `apps/web/src/lib/manage/airdrop-view.ts`, replace:

```ts
}

/** The rows as History shows them, in the order read (newest first), `confirmed_at` in Unix seconds. */
export function airdropRowsOf(rows: AirdropDbRow[]): AirdropRow[] {
  return rows.map((row) => ({
```

with:

```ts
}

/**
 * The rows as History shows them, in the order read (newest first). When is the block's time once the indexer has
 * read the airdrop, else the time Cobweb recorded it, in Unix seconds (docs/specs/2026-10-16-indexer-overview.md,
 * decision 21).
 */
export function airdropRowsOf(rows: AirdropDbRow[]): AirdropRow[] {
  return rows.map((row) => ({
```

In `apps/web/src/lib/manage/airdrop-view.ts`, replace:

```ts
    lastTokenId: row.last_token_id,
    block: row.block,
    confirmedAt: Math.floor(Date.parse(row.confirmed_at) / 1000),
  }))
}

/**
 * The view from a read: the fee, the owner, minted and left at the read's block, its time as `readAt`. Without
 * one (the chain did not answer), Cobweb's record alone: the history, the collection's supply and the copy's time.
 */
export function airdropViewOf(
  base: { chainId: number; contract: Address; maxSupply: number; readAt: number },
  history: AirdropRow[],
  state: AirdropState | null,
```

with:

```ts
    lastTokenId: row.last_token_id,
    block: row.block,
    confirmedAt: Math.floor(Date.parse(row.block_time ?? row.confirmed_at) / 1000),
  }))
}

/**
 * The view from a read: the fee, the owner, minted and left at the read's block, its time as `readAt`. Without
 * one (the chain did not answer), Cobweb's record alone: the history, the collection's supply and the copy's time.
 * `counted` says whether the indexer has read every block since the deploy.
 */
export function airdropViewOf(
  base: { chainId: number; contract: Address; maxSupply: number; readAt: number; counted: boolean },
  history: AirdropRow[],
  state: AirdropState | null,
```

In `apps/web/src/lib/manage/airdrop-view.ts`, replace:

```ts
      readAt: base.readAt,
      chainReachable: false,
    }
  return {
```

with:

```ts
      readAt: base.readAt,
      chainReachable: false,
      counted: base.counted,
    }
  return {
```

In `apps/web/src/lib/manage/airdrop-view.ts`, replace:

```ts
    readAt: state.blockTimestamp,
    chainReachable: true,
  }
}
```

with:

```ts
    readAt: state.blockTimestamp,
    chainReachable: true,
    counted: base.counted,
  }
}

/** Token ids from the first to the last, as History writes them: `#41 to #50`, or `#41` for one. */
export function tokenIdsText(first: number, last: number): string {
  return first === last ? `#${first}` : `#${first} to #${last}`
}

/**
 * By recipient's search as the server applies it (docs/specs/2026-10-16-indexer-overview.md, section 7.3): the
 * hex digits typed, lowercase, a leading 0x dropped, so it matches any part of a stored address and carries no
 * LIKE wildcard.
 */
export function recipientSearchOf(input: string): string {
  const text = input.trim().toLowerCase()
  return (text.startsWith('0x') ? text.slice(2) : text).replace(/[^0-9a-f]/g, '')
}

/** The rows as By recipient shows them, in the order read: wallets checksummed, the dead address a burn. */
export function recipientRowsOf(rows: RecipientDbRow[]): RecipientRow[] {
  return rows.map((row) => ({
    txHash: row.tx_hash as Hex,
    wallet: getAddress(row.recipient),
    tokens: row.tokens,
    firstTokenId: row.first_token_id,
    lastTokenId: row.first_token_id + row.tokens - 1,
    at: Math.floor(Date.parse(row.block_time) / 1000),
    burn: row.recipient.toLowerCase() === BURN_ADDRESS.toLowerCase(),
  }))
}

/** By recipient as CSV rows, the header first, then one row per run in the order given. */
export function recipientsCsvRows(rows: RecipientRow[]): string[][] {
  return [
    ['date_utc', 'wallet', 'tokens', 'token_ids', 'tx_hash'],
    ...rows.map((row) => [
      new Date(row.at * 1000).toISOString(),
      row.wallet,
      String(row.tokens),
      tokenIdsText(row.firstTokenId, row.lastTokenId),
      row.txHash,
    ]),
  ]
}
```

In `apps/web/src/lib/art/result.ts`, replace:

```ts
export const SETTINGS_TIMED_OUT =
  'The setting is not confirmed yet. Read the contract again in a minute to see it.'
// A withdrawal is counted in Withdrawn so far only once Cobweb confirms it, so its wait says so.
export const WITHDRAWAL_NOT_CONFIRMED = 'The withdrawal has not been confirmed on chain yet.'
export const WITHDRAWAL_TIMED_OUT =
  'The withdrawal is not confirmed yet, and it may have landed. Check again in a minute: Withdrawn so far counts only the withdrawals Cobweb confirmed.'
export const NOT_OWNER = (owner: string) =>
  `This wallet is not the contract's owner. Changes on chain need ${owner}.`
```

with:

```ts
export const SETTINGS_TIMED_OUT =
  'The setting is not confirmed yet. Read the contract again in a minute to see it.'
// A withdrawal is counted in Withdrawn so far once Cobweb confirms it or the indexer reads it at the chain's depth
// (docs/specs/2026-10-16-indexer-overview.md, section 7.4), so its wait says so.
export const WITHDRAWAL_NOT_CONFIRMED = 'The withdrawal has not been confirmed on chain yet.'
export const WITHDRAWAL_TIMED_OUT =
  'The withdrawal is not confirmed yet, and it may have landed. Check again in a minute: Withdrawn so far counts it once the chain has confirmed it.'
// Airdrop's By recipient (docs/specs/2026-10-16-indexer-overview.md, section 7.3): said by the screen, and by the
// server for a query it cannot read.
export const RECIPIENTS_NOT_READ = 'The recipients could not be read. Try again in a moment.'
export const NOT_OWNER = (owner: string) =>
  `This wallet is not the contract's owner. Changes on chain need ${owner}.`
```

- [ ] **Step 4: The server: the counted read, By recipient's page and its export**

A page past the last, which PostgREST refuses with 416, reads no row with the count (Decision 14).

In `apps/web/src/lib/manage/airdrop-core.ts`, replace:

```ts
  type PublicClient,
} from 'viem'
import { errorSummary } from '@/lib/art/lock-core'
import { readAll } from '@/lib/art/read-all'
import { AIRDROP_NOT_CONFIRMED, CHAIN_NOT_READY, NOT_DEPLOYED, PHASE_REVERTED } from '@/lib/art/result'
import { proveAirdrop } from '@/lib/chain/airdrop-batch'
import type { DeployOutcome } from '@/lib/deploy/deploy-core'
import type { AirdropReader, AirdropView } from './airdrop-types'
import { airdropRowsOf, airdropViewOf, type AirdropDbRow } from './airdrop-view'
import { phaseBase, type PhasesContext } from './phases-core'

```

with:

```ts
  type PublicClient,
} from 'viem'
import { z } from 'zod'
import { errorSummary } from '@/lib/art/lock-core'
import { readAll } from '@/lib/art/read-all'
import {
  AIRDROP_NOT_CONFIRMED,
  CHAIN_NOT_READY,
  NOT_DEPLOYED,
  PHASE_REVERTED,
  RECIPIENTS_NOT_READ,
} from '@/lib/art/result'
import { proveAirdrop } from '@/lib/chain/airdrop-batch'
import type { DeployOutcome } from '@/lib/deploy/deploy-core'
import {
  RECIPIENTS_PAGE,
  type AirdropReader,
  type AirdropView,
  type RecipientPage,
  type RecipientRow,
} from './airdrop-types'
import {
  airdropRowsOf,
  airdropViewOf,
  recipientRowsOf,
  recipientSearchOf,
  type AirdropDbRow,
  type RecipientDbRow,
} from './airdrop-view'
import { phaseBase, type PhasesContext } from './phases-core'

```

In `apps/web/src/lib/manage/airdrop-core.ts`, replace:

```ts
/** The `airdrops` columns the view reads, the fee as text. */
const AIRDROP_COLUMNS =
  'tx_hash, kind, recipients, tokens, fee_paid_wei::text, first_token_id, last_token_id, block, confirmed_at'

/**
```

with:

```ts
/** The `airdrops` columns the view reads, the fee as text. */
const AIRDROP_COLUMNS =
  'tx_hash, kind, recipients, tokens, fee_paid_wei::text, first_token_id, last_token_id, block, confirmed_at, block_time'
/** The `airdrop_recipients` columns By recipient reads. */
const RECIPIENT_COLUMNS = 'tx_hash, recipient, tokens, first_token_id, block_time'

/** By recipient's query: up to 42 characters of search (an address with its 0x) and a page from 0 to 4,000. */
const recipientsQuery = z.object({
  search: z.string().max(42),
  page: z.number().int().min(0).max(4_000),
})

/**
 * Whether the indexer has read every block since the deploy, so the history is complete: the collection's cursor
 * has a synced time (docs/specs/2026-10-16-indexer-overview.md, decision 21).
 */
async function countedOf(ctx: AirdropContext): Promise<boolean> {
  const { data, error } = await ctx.supabase
    .from('indexer_cursors')
    .select('synced_at')
    .eq('collection_id', ctx.collection.id)
    .maybeSingle()
  if (error) throw new Error(`The indexer's cursor could not be read: ${error.message}`)
  return data?.synced_at != null
}

/**
```

In `apps/web/src/lib/manage/airdrop-core.ts`, replace:

```ts

/**
 * What the Airdrop tab shows (section 6.3): Cobweb's records of the collection, newest block first, with the
 * contract's fee, supply and owner, or the records alone when the chain does not answer. It refreshes nothing.
 */
export async function airdropViewCore(
```

with:

```ts

/**
 * What the Airdrop tab shows (section 6.3): the collection's airdrops, Cobweb's and the indexer's, newest block
 * first, with the contract's fee, supply and owner, or the records alone when the chain does not answer, and
 * whether the indexer has counted the collection. It refreshes nothing.
 */
export async function airdropViewCore(
```

In `apps/web/src/lib/manage/airdrop-core.ts`, replace:

```ts
      .range(from, to),
  )
  const state = await read(base.chainId, base.contract)
  return {
```

with:

```ts
      .range(from, to),
  )
  const counted = await countedOf(ctx)
  const state = await read(base.chainId, base.contract)
  return {
```

In `apps/web/src/lib/manage/airdrop-core.ts`, replace:

```ts
        maxSupply: ctx.collection.max_supply ?? 0,
        readAt: base.readAt,
      },
      airdropRowsOf(rows),
      state,
    ),
  }
}

```

with:

```ts
        maxSupply: ctx.collection.max_supply ?? 0,
        readAt: base.readAt,
        counted,
      },
      airdropRowsOf(rows),
      state,
    ),
  }
}

/** By recipient's order: newest block first, then each transaction's runs by their first token id. */
const RECIPIENTS_ORDER = { block: { ascending: false }, first_token_id: { ascending: true } } as const

/**
 * One page of By recipient (docs/specs/2026-10-16-indexer-overview.md, section 7.3): 25 rows of
 * `airdrop_recipients`, newest first, with an exact count, filtered to the addresses holding the search's hex
 * digits. A query it cannot read is refused with RECIPIENTS_NOT_READ; a page past the last answers no row with
 * the count.
 */
export async function airdropRecipientsCore(
  ctx: AirdropContext,
  query: { search: string; page: number },
): Promise<DeployOutcome<RecipientPage>> {
  const parsed = recipientsQuery.safeParse(query)
  if (!parsed.success) return { refused: RECIPIENTS_NOT_READ }
  const { page } = parsed.data
  const search = recipientSearchOf(parsed.data.search)
  const matching = (head: boolean) => {
    const select = ctx.supabase
      .from('airdrop_recipients')
      .select(RECIPIENT_COLUMNS, { count: 'exact', head })
      .eq('collection_id', ctx.collection.id)
    return search ? select.like('recipient', `%${search}%`) : select
  }
  const from = page * RECIPIENTS_PAGE
  const { data, error, count } = await matching(false)
    .order('block', RECIPIENTS_ORDER.block)
    .order('first_token_id', RECIPIENTS_ORDER.first_token_id)
    .range(from, from + RECIPIENTS_PAGE - 1)
  if (error?.code === 'PGRST103') {
    // A page past the last: PostgREST refuses its range (416), so the page is empty and the count read alone.
    const total = await matching(true)
    if (total.error) throw new Error(`The recipients could not be counted: ${total.error.message}`)
    return { data: { rows: [], total: total.count ?? 0, page } }
  }
  if (error) throw new Error(`The recipients could not be read: ${error.message}`)
  return { data: { rows: recipientRowsOf(data), total: count ?? 0, page } }
}

/** Every row of By recipient, for its export: read 1,000 at a time, in the page's order. */
export async function airdropRecipientsAllCore(ctx: AirdropContext): Promise<DeployOutcome<RecipientRow[]>> {
  const rows = await readAll<RecipientDbRow>((from, to) =>
    ctx.supabase
      .from('airdrop_recipients')
      .select(RECIPIENT_COLUMNS)
      .eq('collection_id', ctx.collection.id)
      .order('block', RECIPIENTS_ORDER.block)
      .order('first_token_id', RECIPIENTS_ORDER.first_token_id)
      .range(from, to),
  )
  return { data: recipientRowsOf(rows) }
}

```

In `apps/web/src/app/actions/airdrop.ts`, replace:

```ts
import type { ActionResult } from '@/lib/art/result'
import { parse } from '@/lib/art/schemas'
import { airdropViewCore, confirmAirdropCore, readAirdropState } from '@/lib/manage/airdrop-core'
import type { AirdropView } from '@/lib/manage/airdrop-types'
import { phasesWrite } from '@/lib/manage/phases-write'

```

with:

```ts
import type { ActionResult } from '@/lib/art/result'
import { parse } from '@/lib/art/schemas'
import {
  airdropRecipientsAllCore,
  airdropRecipientsCore,
  airdropViewCore,
  confirmAirdropCore,
  readAirdropState,
} from '@/lib/manage/airdrop-core'
import type { AirdropView, RecipientPage, RecipientRow } from '@/lib/manage/airdrop-types'
import { phasesWrite } from '@/lib/manage/phases-write'

```

In `apps/web/src/app/actions/airdrop.ts`, replace:

```ts
  return phasesWrite(collectionId, (ctx) => confirmAirdropCore(ctx, hash.data), manageRecordError)
}
```

with:

```ts
  return phasesWrite(collectionId, (ctx) => confirmAirdropCore(ctx, hash.data), manageRecordError)
}

/**
 * One page of By recipient (docs/specs/2026-10-16-indexer-overview.md, section 7.3): 25 wallets an airdrop
 * reached, newest first, searched by any part of the address. The core reads the query; a query it cannot read
 * is refused.
 */
export async function getAirdropRecipients(
  collectionId: string,
  query: { search: string; page: number },
): Promise<ActionResult<RecipientPage>> {
  return phasesWrite(collectionId, (ctx) => airdropRecipientsCore(ctx, query), manageRecordError)
}

/** Every row of By recipient, for "Export CSV", which the browser builds from them. */
export async function exportAirdropRecipients(collectionId: string): Promise<ActionResult<RecipientRow[]>> {
  return phasesWrite(collectionId, airdropRecipientsAllCore, manageRecordError)
}
```

- [ ] **Step 5: The sample and the server object**

In `apps/web/src/lib/demo/types.ts`, replace:

```ts
}

/** A past airdrop. Replaced by: indexed `NFTsAirdropped` events. */
export type AirdropRecord = {
```

with:

```ts
}

/** One wallet's run of a past airdrop, as By recipient lists it. Replaced by: the indexer's `airdrop_recipients`. */
export type AirdropRecipientRecord = {
  txHash: Hex
  wallet: Address
  tokens: number
  firstTokenId: number
  at: number
}

/** A past airdrop. Replaced by: indexed `NFTsAirdropped` events. */
export type AirdropRecord = {
```

In `apps/web/src/lib/demo/data.ts`, replace:

```ts
import type {
  Address,
  AirdropRecord,
  DeployDraft,
```

with:

```ts
import type {
  Address,
  AirdropRecipientRecord,
  AirdropRecord,
  DeployDraft,
```

In `apps/web/src/lib/demo/data.ts`, replace:

```ts
]

/** Hourly mints for the last 48 hours: the whitelist opened 30 hours ago with a rush, then settled. */
function mintsOverTime(): { at: number; count: number }[] {
```

with:

```ts
]

/**
 * The sample airdrops' recipients, newest first (docs/specs/2026-10-16-indexer-overview.md, section 8): the burn's 2
 * tokens from #11 at the dead address, then the first airdrop's four wallets with 4, 3, 2 and 1 tokens from #1.
 */
export const DEMO_AIRDROP_RECIPIENTS: AirdropRecipientRecord[] = [
  {
    txHash: DEMO_AIRDROPS[1]!.txHash,
    wallet: '0x000000000000000000000000000000000000dEaD',
    tokens: 2,
    firstTokenId: 11,
    at: DEMO_AIRDROPS[1]!.at,
  },
  ...[4, 3, 2, 1].map((tokens, index) => ({
    txHash: DEMO_AIRDROPS[0]!.txHash,
    wallet: sampleAddress(600 + index),
    tokens,
    firstTokenId: [1, 5, 8, 10][index]!,
    at: DEMO_AIRDROPS[0]!.at,
  })),
]

/** Hourly mints for the last 48 hours: the whitelist opened 30 hours ago with a rush, then settled. */
function mintsOverTime(): { at: number; count: number }[] {
```

In `apps/web/src/components/manage/airdrop-server.ts`, replace:

```ts
import type { Hex } from 'viem'
import { confirmAirdrop, getAirdrop } from '@/app/actions/airdrop'
import type { ActionResult } from '@/lib/art/result'
import type { AirdropView } from '@/lib/manage/airdrop-types'

/**
 * Airdrop's server, bound to one collection (docs/specs/2026-10-15-airdrop-settings.md, section 7.2): the two
 * actions in one object, which `sampleAirdropServer` (airdrop-sim.ts) mirrors in sample mode. A confirm sends
 * the hash alone.
 */
export type AirdropServer = {
  read(): Promise<ActionResult<AirdropView>>
  confirm(hash: Hex): Promise<ActionResult<AirdropView>>
}

export function airdropServer(collectionId: string): AirdropServer {
  return {
    read: () => getAirdrop(collectionId),
    confirm: (hash) => confirmAirdrop(collectionId, hash),
  }
}
```

with:

```ts
import type { Hex } from 'viem'
import {
  confirmAirdrop,
  exportAirdropRecipients,
  getAirdrop,
  getAirdropRecipients,
} from '@/app/actions/airdrop'
import type { ActionResult } from '@/lib/art/result'
import type { AirdropView, RecipientPage, RecipientRow } from '@/lib/manage/airdrop-types'

/**
 * Airdrop's server, bound to one collection (docs/specs/2026-10-15-airdrop-settings.md, section 7.2): the
 * actions in one object, which `sampleAirdropServer` (airdrop-sim.ts) mirrors in sample mode. A confirm sends
 * the hash alone; By recipient asks for a page by its search and number, and for every row to export
 * (docs/specs/2026-10-16-indexer-overview.md, section 7.3).
 */
export type AirdropServer = {
  read(): Promise<ActionResult<AirdropView>>
  confirm(hash: Hex): Promise<ActionResult<AirdropView>>
  recipients(query: { search: string; page: number }): Promise<ActionResult<RecipientPage>>
  exportRecipients(): Promise<ActionResult<RecipientRow[]>>
}

export function airdropServer(collectionId: string): AirdropServer {
  return {
    read: () => getAirdrop(collectionId),
    confirm: (hash) => confirmAirdrop(collectionId, hash),
    recipients: (query) => getAirdropRecipients(collectionId, query),
    exportRecipients: () => exportAirdropRecipients(collectionId),
  }
}
```

In `apps/web/src/components/manage/airdrop-sim.ts`, replace:

```ts
import type { ActionResult } from '@/lib/art/result'
import {
  DEMO_AIRDROPS,
  DEMO_COLLECTION,
```

with:

```ts
import type { ActionResult } from '@/lib/art/result'
import {
  DEMO_AIRDROP_RECIPIENTS,
  DEMO_AIRDROPS,
  DEMO_COLLECTION,
```

In `apps/web/src/components/manage/airdrop-sim.ts`, replace:

```ts
  scaleSampleToSupply,
} from '@/lib/demo'
import type { AirdropJob, AirdropRow, AirdropView } from '@/lib/manage/airdrop-types'
import { airdropViewOf, BURN_ADDRESS } from '@/lib/manage/airdrop-view'
import { airdropCalls, type ManageCall } from '@/lib/manage/phase-calls'
import type { AirdropServer } from './airdrop-server'
```

with:

```ts
  scaleSampleToSupply,
} from '@/lib/demo'
import {
  RECIPIENTS_PAGE,
  type AirdropJob,
  type AirdropRow,
  type AirdropView,
  type RecipientRow,
} from '@/lib/manage/airdrop-types'
import { airdropViewOf, BURN_ADDRESS, recipientSearchOf } from '@/lib/manage/airdrop-view'
import { airdropCalls, type ManageCall } from '@/lib/manage/phase-calls'
import type { AirdropServer } from './airdrop-server'
```

In `apps/web/src/components/manage/airdrop-sim.ts`, replace:

```ts
 * to the collection's supply, the two sample records (10 tokens to 4 wallets, then a burn of 2), and the session
 * wallet as the owner unless `owner` names another (`?owner=other`). With `chainReachable` false, the record alone,
 * as the core builds it (`?chain=unreachable`).
 */
export function sampleAirdropView(
  collection: { max_supply: number | null },
  wallet: Address,
  options: { chainReachable?: boolean; owner?: Address } = {},
): AirdropView {
  const maxSupply = sampleSupply(collection.max_supply, DEMO_COLLECTION.maxSupply)
```

with:

```ts
 * to the collection's supply, the two sample records (10 tokens to 4 wallets, then a burn of 2), and the session
 * wallet as the owner unless `owner` names another (`?owner=other`). With `chainReachable` false, the record alone,
 * as the core builds it (`?chain=unreachable`). Counted by the indexer unless `counted` is false
 * (`?activity=counting`, docs/specs/2026-10-16-indexer-overview.md, section 8).
 */
export function sampleAirdropView(
  collection: { max_supply: number | null },
  wallet: Address,
  options: { chainReachable?: boolean; owner?: Address; counted?: boolean } = {},
): AirdropView {
  const maxSupply = sampleSupply(collection.max_supply, DEMO_COLLECTION.maxSupply)
```

In `apps/web/src/components/manage/airdrop-sim.ts`, replace:

```ts
    maxSupply,
    readAt: DEMO_NOW,
  }
  if (options.chainReachable === false) return airdropViewOf(base, sampleHistory(), null)
```

with:

```ts
    maxSupply,
    readAt: DEMO_NOW,
    counted: options.counted ?? true,
  }
  if (options.chainReachable === false) return airdropViewOf(base, sampleHistory(), null)
```

In `apps/web/src/components/manage/airdrop-sim.ts`, replace:

```ts
}

/**
 * The sample server: every answer takes 900 ms. A confirm applies the call the simulated wallet sent with that
 * hash, or, for a hash it never sent (`?batch=pending`), the first unsent batch of `sampleAirdropJob`.
 */
export function sampleAirdropServer(
```

with:

```ts
}

/** The sample's recipients as By recipient reads them: newest first, wallets checksummed, the dead address a burn. */
export function sampleRecipients(): RecipientRow[] {
  return DEMO_AIRDROP_RECIPIENTS.map((record) => ({
    txHash: record.txHash,
    wallet: getAddress(record.wallet),
    tokens: record.tokens,
    firstTokenId: record.firstTokenId,
    lastTokenId: record.firstTokenId + record.tokens - 1,
    at: record.at,
    burn: record.wallet.toLowerCase() === BURN_ADDRESS.toLowerCase(),
  }))
}

/**
 * The sample server: every view answer takes 900 ms. A confirm applies the call the simulated wallet sent with
 * that hash, or, for a hash it never sent (`?batch=pending`), the first unsent batch of `sampleAirdropJob`. By
 * recipient's pages and its export answer from `sampleRecipients` after 300 ms.
 */
export function sampleAirdropServer(
```

In `apps/web/src/components/manage/airdrop-sim.ts`, replace:

```ts
    return { ok: true, data: data() }
  }
  return {
    read: () => answer(current),
    confirm: (hash) =>
      answer(() => {
```

with:

```ts
    return { ok: true, data: data() }
  }
  const recipientsAnswer = async <T>(data: () => T): Promise<ActionResult<T>> => {
    await wait(300)
    return { ok: true, data: data() }
  }
  return {
    read: () => answer(current),
    recipients: ({ search, page }) =>
      recipientsAnswer(() => {
        const digits = recipientSearchOf(search)
        const rows = sampleRecipients().filter((row) => row.wallet.toLowerCase().includes(digits))
        return {
          rows: rows.slice(page * RECIPIENTS_PAGE, (page + 1) * RECIPIENTS_PAGE),
          total: rows.length,
          page,
        }
      }),
    exportRecipients: () => recipientsAnswer(sampleRecipients),
    confirm: (hash) =>
      answer(() => {
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `pnpm --filter @cobweb/web exec vitest run src/lib/manage/airdrop-view.test.ts src/components/manage/airdrop-sim.test.ts`
Expected: PASS, `Test Files  2 passed (2)` and `Tests  20 passed (20)`.

- [ ] **Step 7: History's panel, the screen and the route**

By transaction keeps today's table and its "Export CSV"; By recipient asks the server 300 ms after the last keystroke and goes back to the first page; each view has its own export (Decision 15).

In `apps/web/src/components/manage/airdrop-parts.tsx`, replace:

```tsx
import { formatNative, mulWei, shortAddress, type SupportedChain } from '@/lib/demo'
import type { AirdropRow, AirdropView } from '@/lib/manage/airdrop-types'
import { AIRDROP_MAX_TOKENS, BURN_ADDRESS } from '@/lib/manage/airdrop-view'
import { burnRequest, tokensLabel } from './airdrop-dialogs'
import { Row, TxLink } from './bits'
```

with:

```tsx
import { formatNative, mulWei, shortAddress, type SupportedChain } from '@/lib/demo'
import type { AirdropRow, AirdropView } from '@/lib/manage/airdrop-types'
import { AIRDROP_MAX_TOKENS, BURN_ADDRESS, tokenIdsText } from '@/lib/manage/airdrop-view'
import { burnRequest, tokensLabel } from './airdrop-dialogs'
import { Row, TxLink } from './bits'
```

In `apps/web/src/components/manage/airdrop-parts.tsx`, replace:

```tsx
/** Token ids a recorded airdrop minted: `#41 to #50`, or `#41` for one. */
export function tokenRange(airdrop: AirdropRow): string {
  return airdrop.firstTokenId === airdrop.lastTokenId
    ? `#${airdrop.firstTokenId}`
    : `#${airdrop.firstTokenId} to #${airdrop.lastTokenId}`
}

```

with:

```tsx
/** Token ids a recorded airdrop minted: `#41 to #50`, or `#41` for one. */
export function tokenRange(airdrop: AirdropRow): string {
  return tokenIdsText(airdrop.firstTokenId, airdrop.lastTokenId)
}

```

In `apps/web/src/components/manage/airdrop-parts.tsx`, replace:

```tsx
}

/** The batches and burns Cobweb confirmed, newest first. When is when Cobweb recorded each. */
export function AirdropHistory({
  airdrops,
```

with:

```tsx
}

/**
 * The airdrops and burns, newest first: Cobweb's and, once the indexer has read the contract, those sent from
 * outside Cobweb. When is the block's time once the indexer has read each, else when Cobweb recorded it.
 */
export function AirdropHistory({
  airdrops,
```

Create `apps/web/src/components/manage/airdrop-history.tsx`:

```tsx
'use client'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { DownloadIcon, FlameIcon, SearchIcon } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@cobweb/ui/components/badge'
import { Button } from '@cobweb/ui/components/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@cobweb/ui/components/input-group'
import { Panel } from '@cobweb/ui/components/panel'
import { Skeleton } from '@cobweb/ui/components/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@cobweb/ui/components/table'
import { ToggleGroup, ToggleGroupItem } from '@cobweb/ui/components/toggle-group'
import { RECIPIENTS_NOT_READ } from '@/lib/art/result'
import { shortAddress, type SupportedChain } from '@/lib/demo'
import { RECIPIENTS_PAGE, type AirdropView } from '@/lib/manage/airdrop-types'
import { BURN_ADDRESS, recipientSearchOf, recipientsCsvRows, tokenIdsText } from '@/lib/manage/airdrop-view'
import { AirdropHistory, airdropHistoryCsv } from './airdrop-parts'
import type { AirdropServer } from './airdrop-server'
import { CopyButton, Pager, TxLink } from './bits'
import { count, downloadText, relativeTo, shortUtc } from './format'
import { toCsv } from './recipients'

/** How long By recipient waits after the last keystroke before it asks the server. */
const SEARCH_WAIT_MS = 300

const COUNTED =
  'Every airdrop and burn on the contract, also any sent from outside Cobweb, once the chain has confirmed it.'
const NOT_COUNTED =
  "Batches Cobweb confirmed. Airdrops sent from outside Cobweb show once Cobweb has read the contract's history."

type HistoryView = 'transaction' | 'recipient'

/** A sentence in place of a table. */
function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-muted-foreground px-6 py-10 text-center text-sm">{children}</p>
}

/**
 * Airdrop's History (docs/specs/2026-10-16-indexer-overview.md, section 7.3): By transaction, every airdrop and burn
 * with its When, and By recipient, every wallet an airdrop reached, each with its own "Export CSV". The
 * description says whether the history is complete: the indexer has read every block since the deploy.
 */
export function HistoryPanel({
  collectionId,
  view,
  chain,
  server,
}: {
  collectionId: string
  view: AirdropView
  chain: SupportedChain
  server: AirdropServer
}) {
  const [shown, setShown] = useState<HistoryView>('transaction')
  const [exporting, setExporting] = useState(false)

  async function exportRecipients() {
    setExporting(true)
    try {
      const result = await server.exportRecipients()
      if (result.ok) downloadText('airdrop-recipients.csv', toCsv(recipientsCsvRows(result.data)))
      else toast.error(result.error)
    } catch {
      toast.error(RECIPIENTS_NOT_READ)
    } finally {
      setExporting(false)
    }
  }

  return (
    <Panel
      title="History"
      description={view.counted ? COUNTED : NOT_COUNTED}
      bodyClassName="p-0 pb-2"
      action={
        shown === 'transaction' ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={view.history.length === 0}
            onClick={() => downloadText('airdrop-history.csv', airdropHistoryCsv(view.history, chain))}
          >
            <DownloadIcon aria-hidden="true" />
            Export CSV
          </Button>
        ) : (
          <Button variant="ghost" size="sm" disabled={!view.counted || exporting} onClick={exportRecipients}>
            <DownloadIcon aria-hidden="true" />
            Export CSV
          </Button>
        )
      }
    >
      <div className="px-5 pt-4 pb-2 lg:px-6">
        <ToggleGroup
          type="single"
          variant="outline"
          value={shown}
          onValueChange={(value) => {
            if (value) setShown(value as HistoryView)
          }}
          aria-label="Show the history"
        >
          <ToggleGroupItem value="transaction" className="px-3">
            By transaction
          </ToggleGroupItem>
          <ToggleGroupItem value="recipient" className="px-3">
            By recipient
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      {shown === 'transaction' ? (
        <AirdropHistory airdrops={view.history} chain={chain} readAt={view.readAt} />
      ) : (
        <ByRecipient
          collectionId={collectionId}
          counted={view.counted}
          chain={chain}
          readAt={view.readAt}
          server={server}
        />
      )}
    </Panel>
  )
}

/**
 * By recipient: 25 rows at a time, newest first, read on the server; the search goes to the server 300 ms after
 * the last keystroke and back to the first page.
 */
function ByRecipient({
  collectionId,
  counted,
  chain,
  readAt,
  server,
}: {
  collectionId: string
  counted: boolean
  chain: SupportedChain
  readAt: number
  server: AirdropServer
}) {
  const id = useId()
  const [typed, setTyped] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  useEffect(() => {
    const next = recipientSearchOf(typed)
    if (next === search) return
    const timer = setTimeout(() => {
      setSearch(next)
      setPage(0)
    }, SEARCH_WAIT_MS)
    return () => clearTimeout(timer)
  }, [typed, search])
  const recipients = useQuery({
    queryKey: ['airdrop-recipients', collectionId, search, page],
    queryFn: async () => {
      const result = await server.recipients({ search, page })
      if (!result.ok) throw new Error(result.error)
      return result.data
    },
    enabled: counted,
    placeholderData: keepPreviousData,
    retry: false,
  })

  if (!counted) return <Note>Recipients show once Cobweb has read the contract&apos;s history.</Note>
  const data = recipients.data
  return (
    <div className="grid gap-4">
      <div className="px-5 pt-2 lg:px-6">
        <InputGroup className="w-full sm:w-72">
          <InputGroupAddon>
            <SearchIcon aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            id={`${id}-search`}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder="Search addresses"
            aria-label="Search addresses"
            className="numeric"
            spellCheck={false}
            maxLength={42}
          />
        </InputGroup>
      </div>

      {recipients.isError ? (
        <div className="grid justify-items-center gap-3 px-6 py-10 text-center">
          <p className="text-muted-foreground text-sm">{RECIPIENTS_NOT_READ}</p>
          <Button variant="secondary" size="sm" onClick={() => void recipients.refetch()}>
            Try again
          </Button>
        </div>
      ) : !data ? (
        <div className="grid gap-2 px-6 py-4" aria-busy="true">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : data.total === 0 ? (
        <Note>{search ? 'No address matches that search.' : 'No wallet has received an airdrop yet.'}</Note>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-6">Wallet</TableHead>
              <TableHead className="text-right">Tokens</TableHead>
              <TableHead>Token ids</TableHead>
              <TableHead>When</TableHead>
              <TableHead className="pr-6 text-right">Transaction</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.rows.map((row) => (
              <TableRow key={`${row.txHash}:${row.firstTokenId}`}>
                <TableCell className="pl-6">
                  {row.burn ? (
                    <span className="inline-flex items-center gap-2">
                      <Badge variant="destructive">
                        <FlameIcon aria-hidden="true" />
                        Burn
                      </Badge>
                      <span className="numeric text-muted-foreground">{shortAddress(BURN_ADDRESS, 6)}</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      <span className="numeric">{row.wallet}</span>
                      <CopyButton value={row.wallet} label="Copy address" />
                    </span>
                  )}
                </TableCell>
                <TableCell className="numeric text-right">{count(row.tokens)}</TableCell>
                <TableCell className="numeric text-muted-foreground text-[0.8125rem]">
                  {tokenIdsText(row.firstTokenId, row.lastTokenId)}
                </TableCell>
                <TableCell>
                  <span className="numeric text-sm">{shortUtc(row.at)}</span>
                  <span className="text-muted-foreground block text-[0.8125rem]">
                    {relativeTo(row.at, readAt)}
                  </span>
                </TableCell>
                <TableCell className="pr-6 text-right">
                  <TxLink chain={chain} hash={row.txHash} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {data && data.total > 0 && (
        <div className="border-t px-5 py-3 lg:px-6">
          <Pager
            page={data.page}
            pages={Math.ceil(data.total / RECIPIENTS_PAGE)}
            total={data.total}
            pageSize={RECIPIENTS_PAGE}
            onPage={setPage}
            noun="recipients"
          />
        </div>
      )}
    </div>
  )
}
```

In `apps/web/src/components/manage/airdrop-screen.tsx`, replace:

```tsx
'use client'

import { DownloadIcon, FlameIcon, RefreshCwIcon, SendIcon, TriangleAlertIcon, UserXIcon } from 'lucide-react'
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
```

with:

```tsx
'use client'

import { FlameIcon, RefreshCwIcon, SendIcon, TriangleAlertIcon, UserXIcon } from 'lucide-react'
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
```

In `apps/web/src/components/manage/airdrop-screen.tsx`, replace:

```tsx
import { batchRequest, PendingBatchPanel, tokensLabel, walletsLabel } from './airdrop-dialogs'
import { burnJob, frozenJob, unsentTokens, waitsOn, withConfirmed, withPending } from './airdrop-job'
import {
  AirdropHistory,
  airdropHistoryCsv,
  BurnDialog,
  burnError,
  BurnQuantity,
  SupplyNote,
} from './airdrop-parts'
import { airdropServer, type AirdropServer } from './airdrop-server'
import { sampleAirdropJob, sampleAirdropServer } from './airdrop-sim'
import { Row } from './bits'
import { count, downloadText, relativeTo } from './format'
import { realManageActions } from './manage-actions'
import { ManageActionsProvider, type ManageTarget } from './manage-context'
```

with:

```tsx
import { batchRequest, PendingBatchPanel, tokensLabel, walletsLabel } from './airdrop-dialogs'
import { burnJob, frozenJob, unsentTokens, waitsOn, withConfirmed, withPending } from './airdrop-job'
import { HistoryPanel } from './airdrop-history'
import { BurnDialog, burnError, BurnQuantity, SupplyNote } from './airdrop-parts'
import { airdropServer, type AirdropServer } from './airdrop-server'
import { sampleAirdropJob, sampleAirdropServer } from './airdrop-sim'
import { Row } from './bits'
import { count, relativeTo } from './format'
import { realManageActions } from './manage-actions'
import { ManageActionsProvider, type ManageTarget } from './manage-context'
```

In `apps/web/src/components/manage/airdrop-screen.tsx`, replace:

```tsx
 * Manage drop, Airdrop (docs/specs/2026-10-15-airdrop-settings.md, section 7.3): send tokens to a list of wallets
 * for the contract's airdrop fee or, with "Burn instead of sending" on, burn a quantity by airdrop to the dead
 * address; and History, Cobweb's record of the batches it confirmed. The list freezes into batches of at most 500
 * wallets and 1,000 tokens at the first send, and the job is kept in this browser until every batch is confirmed.
 * Each batch runs the manage machine from the sign-in wallet and answers the fresh view. Sample mode runs the same
 * code on the sample actions and server.
 */
export function AirdropScreen({
```

with:

```tsx
 * Manage drop, Airdrop (docs/specs/2026-10-15-airdrop-settings.md, section 7.3): send tokens to a list of wallets
 * for the contract's airdrop fee or, with "Burn instead of sending" on, burn a quantity by airdrop to the dead
 * address; and History, by transaction or by recipient (airdrop-history.tsx). The list freezes into batches of
 * at most 500 wallets and 1,000 tokens at the first send, and the job is kept in this browser until every batch
 * is confirmed. Each batch runs the manage machine from the sign-in wallet and answers the fresh view. Sample
 * mode runs the same code on the sample actions and server.
 */
export function AirdropScreen({
```

In `apps/web/src/components/manage/airdrop-screen.tsx`, replace:

```tsx
        </div>

        <Panel
          title="History"
          description="Batches Cobweb confirmed. Airdrops sent from outside Cobweb are not listed."
          bodyClassName="p-0 pb-2"
          action={
            <Button
              variant="ghost"
              size="sm"
              disabled={view.history.length === 0}
              onClick={() => downloadText('airdrop-history.csv', airdropHistoryCsv(view.history, chain))}
            >
              <DownloadIcon aria-hidden="true" />
              Export CSV
            </Button>
          }
        >
          <AirdropHistory airdrops={view.history} chain={chain} readAt={view.readAt} />
        </Panel>

        {burnDialog && (
```

with:

```tsx
        </div>

        <HistoryPanel collectionId={collection.id} view={view} chain={chain} server={server} />

        {burnDialog && (
```

In `apps/web/src/app/collections/[id]/manage/airdrop/page.tsx`, replace:

```tsx
/**
 * Manage drop, Airdrop (docs/specs/2026-10-15-airdrop-settings.md, section 7.3): the contract's fee, supply and
 * owner read on the server, with Cobweb's records of the batches it confirmed. Sample mode only
 * (`NEXT_PUBLIC_DEMO_DATA=1`): the sample on any collection, `?chain=unreachable` shows the record alone with its
 * alert, `?owner=other` the owner check, `?batch=pending` a batch waiting to be confirmed.
 */
export default async function Page({
```

with:

```tsx
/**
 * Manage drop, Airdrop (docs/specs/2026-10-15-airdrop-settings.md, section 7.3): the contract's fee, supply and
 * owner read on the server, with the collection's airdrops, Cobweb's and those the indexer read
 * (docs/specs/2026-10-16-indexer-overview.md, section 7.3). Sample mode only (`NEXT_PUBLIC_DEMO_DATA=1`): the sample
 * on any collection, `?chain=unreachable` shows the record alone with its alert, `?owner=other` the owner check,
 * `?batch=pending` a batch waiting to be confirmed, `?activity=counting` the history before the indexer has read
 * the contract.
 */
export default async function Page({
```

In `apps/web/src/app/collections/[id]/manage/airdrop/page.tsx`, replace:

```tsx
      chainReachable: (await searchParam(searchParams, 'chain')) !== 'unreachable',
      owner: (await searchParam(searchParams, 'owner')) === 'other' ? getAddress(DEMO_MINTER) : undefined,
    })
  } else {
```

with:

```tsx
      chainReachable: (await searchParam(searchParams, 'chain')) !== 'unreachable',
      owner: (await searchParam(searchParams, 'owner')) === 'other' ? getAddress(DEMO_MINTER) : undefined,
      counted: (await searchParam(searchParams, 'activity')) !== 'counting',
    })
  } else {
```

- [ ] **Step 8: Typecheck and lint the web app**

Run: `pnpm --filter @cobweb/web typecheck && pnpm --filter @cobweb/web lint`
Expected: no errors and no warnings.

- [ ] **Step 9: Format, run the root checks and commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
pnpm exec prettier --write apps/web/src/lib/manage/airdrop-types.ts apps/web/src/lib/manage/airdrop-view.ts apps/web/src/lib/manage/airdrop-view.test.ts apps/web/src/lib/manage/airdrop-core.ts apps/web/src/app/actions/airdrop.ts apps/web/src/lib/art/result.ts apps/web/src/lib/demo/types.ts apps/web/src/lib/demo/data.ts apps/web/src/components/manage/airdrop-server.ts apps/web/src/components/manage/airdrop-sim.ts apps/web/src/components/manage/airdrop-sim.test.ts apps/web/src/components/manage/airdrop-parts.tsx apps/web/src/components/manage/airdrop-history.tsx apps/web/src/components/manage/airdrop-screen.tsx 'apps/web/src/app/collections/[id]/manage/airdrop/page.tsx'
pnpm typecheck && pnpm lint && pnpm test
git add apps/web/src/lib/manage/airdrop-types.ts apps/web/src/lib/manage/airdrop-view.ts apps/web/src/lib/manage/airdrop-view.test.ts apps/web/src/lib/manage/airdrop-core.ts apps/web/src/app/actions/airdrop.ts apps/web/src/lib/art/result.ts apps/web/src/lib/demo/types.ts apps/web/src/lib/demo/data.ts apps/web/src/components/manage/airdrop-server.ts apps/web/src/components/manage/airdrop-sim.ts apps/web/src/components/manage/airdrop-sim.test.ts apps/web/src/components/manage/airdrop-parts.tsx apps/web/src/components/manage/airdrop-history.tsx apps/web/src/components/manage/airdrop-screen.tsx 'apps/web/src/app/collections/[id]/manage/airdrop/page.tsx'
git commit -m "$(cat <<'EOF'
List every airdrop in History with its block time, add By recipient with its search on the server, its pages and its export, and say when Withdrawn so far counts a withdrawal

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: the web app reports 893 tests in 94 files; the other packages are unchanged.

---

### Task 7: The mint page's Holders and Recent mints, and the sample's `?activity=none`

**Kind:** transcription. The plan carries every line: a Sonnet implementer.

**Files:**

- Create: `apps/web/src/components/mint/recent-mints.tsx`
- Modify: `apps/web/src/lib/mint/live-data.ts` (`MintActivity`, `activityOfBody`, `MintLive.activity`), `apps/web/src/components/mint/collection-sections.tsx` (the Holders row), `mint-page.tsx` (Recent mints under the phases), `sample-source.ts` (the sample's activity and `?activity=none`)
- Modify (tests): `apps/web/src/lib/mint/live-data.test.ts`, `apps/web/src/components/mint/sample-source.test.ts`, `model.test.ts` (`activity: null` in its fixture)
- Test: the three test files

**Interfaces:**

- Consumes: Task 4's `StateBody.activity`; `joinPhases` from `lib/manage/phases-view.ts`; `useMint()`'s `page`, `live` and `chainNow`; `formatDistance` from `components/mint/format.ts`; `explorerTxUrl` and `shortAddress` from `lib/demo/helpers.ts`; `DEMO_ACTIVITY`.
- Produces:
  - `lib/mint/live-data.ts`: `MintActivity = { holders: number; recentMints: (MintBody & { phase: string | null })[] }`, `activityOfBody(activity: StateActivity | null, groups: readonly MintGroup[]): MintActivity | null` (each mint's phase as the phase list names it, "Group N" for a group registered outside Cobweb, null for a hidden one; at most 10), `MintLive.activity: MintActivity | null`
  - `components/mint/recent-mints.tsx`: `RecentMints()`, left out while `activity` is null or holds no mint
  - `SampleSwitches.activity: 'none' | null`; the sample's state body carries 171 holders and the sample's 10 latest mints, or null for `?activity=none`

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/lib/mint/live-data.test.ts`, replace:

```ts
import type { StateBody, WalletBody } from '@cobweb/shared'
import type { Address } from 'viem'
import { describe, expect, it } from 'vitest'
import { liveOf, revealedOf, transfersOf, walletViewOf } from './live-data'
import type { MintPageStatic } from './page-doc'

```

with:

```ts
import type { MintBody, StateBody, WalletBody } from '@cobweb/shared'
import type { Address, Hex } from 'viem'
import { describe, expect, it } from 'vitest'
import { activityOfBody, liveOf, revealedOf, transfersOf, walletViewOf } from './live-data'
import type { MintPageStatic } from './page-doc'

```

In `apps/web/src/lib/mint/live-data.test.ts`, replace:

```ts
})

describe('revealedOf and transfersOf', () => {
  it('reads revealed for the real base and a custom link, not for an empty base or a placeholder', () => {
```

with:

```ts
})

describe('activityOfBody (docs/specs/2026-10-16-indexer-overview.md, section 7.5)', () => {
  const mint = (groupId: number, firstTokenId: number): MintBody => ({
    txHash: `0x${firstTokenId.toString(16).padStart(64, '0')}` as Hex,
    recipient: OWNER,
    groupId,
    amount: 1,
    firstTokenId,
    blockTimestamp: 990,
  })

  it("names each mint's phase as the phase list does, Group N for a group registered outside Cobweb, none for a hidden one", () => {
    const live = liveOf(page, {
      ...body,
      activity: { holders: 4, recentMints: [mint(1, 4), mint(0, 3), mint(2, 2), mint(3, 1)] },
    })
    expect(live.activity?.holders).toBe(4)
    expect(live.activity?.recentMints.map((entry) => [entry.firstTokenId, entry.phase])).toEqual([
      [4, 'Holders'],
      [3, 'Public'],
      [2, null],
      [1, 'Group 3'],
    ])
  })

  it('carries no activity without one, at most 10 mints, and names a group the page does not list by its id', () => {
    expect(liveOf(page, body).activity).toBeNull()
    const many = Array.from({ length: 12 }, (_, index) => mint(0, index + 1))
    expect(activityOfBody({ holders: 1, recentMints: many }, [])?.recentMints).toHaveLength(10)
    expect(activityOfBody({ holders: 1, recentMints: [mint(7, 1)] }, [])?.recentMints[0]?.phase).toBe(
      'Group 7',
    )
  })
})

describe('revealedOf and transfersOf', () => {
  it('reads revealed for the real base and a custom link, not for an empty base or a placeholder', () => {
```

In `apps/web/src/components/mint/sample-source.test.ts`, replace:

```ts
import type { StateBody } from '@cobweb/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEMO_MINTER, DEMO_NOW, DEMO_TOKENS, DEMO_VAULT } from '@/lib/demo'
import type { MintParams } from '@/lib/mint/mint-call'
import { MintFailure, type MintFailureKind } from '@/lib/mint/mint-failure'
```

with:

```ts
import type { StateBody } from '@cobweb/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAddress } from 'viem'
import { DEMO_ACTIVITY, DEMO_MINTER, DEMO_NOW, DEMO_TOKENS, DEMO_VAULT } from '@/lib/demo'
import type { MintParams } from '@/lib/mint/mint-call'
import { MintFailure, type MintFailureKind } from '@/lib/mint/mint-failure'
```

In `apps/web/src/components/mint/sample-source.test.ts`, replace:

```ts
    now = 1_000_000 + 32_000
    expect(group(await state(source))?.active).toBe(true)
  })

```

with:

```ts
    now = 1_000_000 + 32_000
    expect(group(await state(source))?.active).toBe(true)
  })

  it("carries the sample's 171 holders and its 10 latest mints at their times, and none for ?activity=none (docs/specs/2026-10-16-indexer-overview.md, section 8)", async () => {
    const { activity } = await state(sampleMintSource(page, switches(), clock))
    expect(activity?.holders).toBe(171)
    expect(activity?.recentMints).toHaveLength(10)
    expect(activity?.recentMints[0]).toEqual({
      txHash: DEMO_ACTIVITY.recentMints[0]!.txHash,
      recipient: getAddress(DEMO_ACTIVITY.recentMints[0]!.minter),
      groupId: 1,
      amount: 1,
      firstTokenId: DEMO_ACTIVITY.recentMints[0]!.firstTokenId,
      blockTimestamp: DEMO_NOW - 4 * 60,
    })
    expect((await state(sampleMintSource(page, switches('activity=none'), clock))).activity).toBeNull()
  })

```

In `apps/web/src/components/mint/model.test.ts`, replace:

```ts
  transfers: null,
  royaltyEnforced: false,
  ...overrides,
})
```

with:

```ts
  transfers: null,
  royaltyEnforced: false,
  activity: null,
  ...overrides,
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @cobweb/web exec vitest run src/lib/mint/live-data.test.ts src/components/mint/sample-source.test.ts src/components/mint/model.test.ts`
Expected: FAIL. The page's view has no activity and the sample sends none: `Test Files  2 failed | 1 passed (3)` and `Tests  3 failed | 38 passed (41)`.

- [ ] **Step 3: The page's view of the activity**

In `apps/web/src/lib/mint/live-data.ts`, replace:

```ts
import type { StateBody, WalletBody } from '@cobweb/shared'
import type { Address } from 'viem'
import type { FeeSnapshot, MintGroup, WalletState } from '@/lib/demo/types'
```

with:

```ts
import type { MintBody, StateActivity, StateBody, WalletBody } from '@cobweb/shared'
import type { Address } from 'viem'
import type { FeeSnapshot, MintGroup, WalletState } from '@/lib/demo/types'
```

In `apps/web/src/lib/mint/live-data.ts`, replace:

```ts
/**
 * The chain's state as the mint page reads it (docs/specs/2026-10-16-mint-page-live-data.md, section 7.4), pure:
 * the freshness server's state body joined with the document's phases, the reveal and the transfer rows; the
 * wallet answer as allowances; and the mints this page saw land. Liveness is each group's `active`.
 */
export type MintLive = {
  block: number
```

with:

```ts
/**
 * The chain's state as the mint page reads it (docs/specs/2026-10-16-mint-page-live-data.md, section 7.4), pure:
 * the freshness server's state body joined with the document's phases, the reveal and the transfer rows, the
 * indexer's holders and latest mints (docs/specs/2026-10-16-indexer-overview.md, section 7.5); the wallet answer
 * as allowances; and the mints this page saw land. Liveness is each group's `active`.
 */

/** The most mints Recent mints shows. */
const RECENT_MINTS_SHOWN = 10

/** The indexer's activity as the page shows it: each mint with its phase's name, null for a hidden phase. */
export type MintActivity = { holders: number; recentMints: (MintBody & { phase: string | null })[] }
export type MintLive = {
  block: number
```

In `apps/web/src/lib/mint/live-data.ts`, replace:

```ts
  /** Royalties are enforced through the transfer validator: level 0 only. */
  royaltyEnforced: boolean
}

```

with:

```ts
  /** Royalties are enforced through the transfer validator: level 0 only. */
  royaltyEnforced: boolean
  /** The holders and the latest mints; null while the indexer has none to give (the page then shows neither). */
  activity: MintActivity | null
}

```

In `apps/web/src/lib/mint/live-data.ts`, replace:

```ts
}

/** The page's view of a state body. */
export function liveOf(page: MintPageStatic, body: StateBody): MintLive {
  return {
    block: body.block,
```

with:

```ts
}

/**
 * The body's activity as the page shows it: each mint's phase as the phase list names it ("Group N" for a group
 * registered outside Cobweb), null for a hidden phase, at most 10 mints.
 */
export function activityOfBody(
  activity: StateActivity | null,
  groups: readonly MintGroup[],
): MintActivity | null {
  if (!activity) return null
  return {
    holders: activity.holders,
    recentMints: activity.recentMints.slice(0, RECENT_MINTS_SHOWN).map((mint) => {
      const group = groups.find((entry) => entry.id === mint.groupId)
      const phase = !group ? `Group ${mint.groupId}` : group.visible === false ? null : group.name
      return { ...mint, phase }
    }),
  }
}

/** The page's view of a state body. */
export function liveOf(page: MintPageStatic, body: StateBody): MintLive {
  const groups = joinPhases(body, page.phases)
  return {
    block: body.block,
```

In `apps/web/src/lib/mint/live-data.ts`, replace:

```ts
      airdropFeePerTokenWei: body.airdropFeePerTokenWei,
    },
    groups: joinPhases(body, page.phases),
    creator: body.owner,
    royaltyBps: body.royalty.bps,
```

with:

```ts
      airdropFeePerTokenWei: body.airdropFeePerTokenWei,
    },
    groups,
    creator: body.owner,
    royaltyBps: body.royalty.bps,
```

In `apps/web/src/lib/mint/live-data.ts`, replace:

```ts
    transfers: transfersOf(body.transferLevel),
    royaltyEnforced: body.transferLevel === 0,
  }
}
```

with:

```ts
    transfers: transfersOf(body.transferLevel),
    royaltyEnforced: body.transferLevel === 0,
    activity: activityOfBody(body.activity, groups),
  }
}
```

- [ ] **Step 4: The sample's activity**

In `apps/web/src/components/mint/sample-source.ts`, replace:

```ts
  encodeErrorResult,
  encodeEventTopics,
  UserRejectedRequestError,
  WaitForTransactionReceiptTimeoutError,
```

with:

```ts
  encodeErrorResult,
  encodeEventTopics,
  getAddress,
  UserRejectedRequestError,
  WaitForTransactionReceiptTimeoutError,
```

In `apps/web/src/components/mint/sample-source.ts`, replace:

```ts
} from 'viem'
import {
  DEMO_CREATOR,
  DEMO_DEPLOYMENT,
```

with:

```ts
} from 'viem'
import {
  DEMO_ACTIVITY,
  DEMO_CREATOR,
  DEMO_DEPLOYMENT,
```

In `apps/web/src/components/mint/sample-source.ts`, replace:

```ts
 *   ?art=placeholder      before the reveal: the placeholder's art, no featured tokens, no tiers
 *   ?type=single_asset | one_of_one   every token's number of the supply in place of its tier
 */
export type SampleSwitches = {
```

with:

```ts
 *   ?art=placeholder      before the reveal: the placeholder's art, no featured tokens, no tiers
 *   ?type=single_asset | one_of_one   every token's number of the supply in place of its tier
 *   ?activity=none        the state carries no activity (docs/specs/2026-10-16-indexer-overview.md, section 8):
 *                         no Holders row and no Recent mints
 */
export type SampleSwitches = {
```

In `apps/web/src/components/mint/sample-source.ts`, replace:

```ts
  /** Another project type, for the rarity spot's alternative. */
  type: 'single_asset' | 'one_of_one' | null
}

```

with:

```ts
  /** Another project type, for the rarity spot's alternative. */
  type: 'single_asset' | 'one_of_one' | null
  /** The state carries no activity: no Holders row and no Recent mints. */
  activity: 'none' | null
}

```

In `apps/web/src/components/mint/sample-source.ts`, replace:

```ts
    art: query.get('art') === 'placeholder' ? 'placeholder' : null,
    type: TYPES.find((type) => type === query.get('type')) ?? null,
  }
}
```

with:

```ts
    art: query.get('art') === 'placeholder' ? 'placeholder' : null,
    type: TYPES.find((type) => type === query.get('type')) ?? null,
    activity: query.get('activity') === 'none' ? 'none' : null,
  }
}
```

In `apps/web/src/components/mint/sample-source.ts`, replace:

```ts
        transferValidator: DEFAULT_TRANSFER_VALIDATOR,
        transferLevel: 0,
        activity: null,
      }
      return { kind: 'body', body, ageSeconds: 0 }
```

with:

```ts
        transferValidator: DEFAULT_TRANSFER_VALIDATOR,
        transferLevel: 0,
        // The sample's holders and its 10 latest mints, at their times on the sample's clock.
        activity:
          switches.activity === 'none'
            ? null
            : {
                holders: DEMO_ACTIVITY.holders,
                recentMints: DEMO_ACTIVITY.recentMints.slice(0, 10).map((mint) => ({
                  txHash: mint.txHash,
                  recipient: getAddress(mint.minter),
                  groupId: mint.groupId,
                  amount: mint.amount,
                  firstTokenId: mint.firstTokenId,
                  blockTimestamp: mint.at,
                })),
              },
      }
      return { kind: 'body', body, ageSeconds: 0 }
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `pnpm --filter @cobweb/web exec vitest run src/lib/mint/live-data.test.ts src/components/mint/sample-source.test.ts src/components/mint/model.test.ts`
Expected: PASS, `Test Files  3 passed (3)` and `Tests  41 passed (41)`.

- [ ] **Step 6: The page**

Details gains Holders after Supply, and Recent mints renders under the phases, each row a link to its transaction where the chain has an explorer, its time on the chain clock; rows are keyed by hash and first token id (Decision 16).

In `apps/web/src/components/mint/collection-sections.tsx`, replace:

```tsx
      value: live ? <span className="numeric">{live.supply.max.toLocaleString('en-US')}</span> : pending,
    },
    {
      label: 'Royalties',
```

with:

```tsx
      value: live ? <span className="numeric">{live.supply.max.toLocaleString('en-US')}</span> : pending,
    },
    // The indexer's count (docs/specs/2026-10-16-indexer-overview.md, section 7.5); left out while it has none.
    ...(live?.activity
      ? [
          {
            label: 'Holders',
            value: <span className="numeric">{live.activity.holders.toLocaleString('en-US')}</span>,
          },
        ]
      : []),
    {
      label: 'Royalties',
```

Create `apps/web/src/components/mint/recent-mints.tsx`:

```tsx
'use client'

import { explorerTxUrl, shortAddress } from '@/lib/demo/helpers'
import { formatDistance } from './format'
import { useMint } from './mint-context'

/**
 * The latest mints, under the phases (docs/specs/2026-10-16-indexer-overview.md, section 7.5): each one's receiver,
 * count and phase, and its time on the chain clock, each row a link to its transaction on the chain's explorer
 * (plain text without one). Left out while the indexer's activity is null or holds no mint.
 */
export function RecentMints() {
  const { page, live, chainNow } = useMint()
  const mints = live?.activity?.recentMints ?? []
  if (mints.length === 0) return null
  const chain = page.chain
  return (
    <section aria-labelledby="recent-mints-title" className="mt-10">
      <h2 id="recent-mints-title" className="text-heading">
        Recent mints
      </h2>
      <ol className="mt-4 divide-y rounded-xl border bg-card shadow-raised">
        {mints.map((mint) => {
          const what = (
            <>
              <span className="numeric">{shortAddress(mint.recipient)}</span> minted {mint.amount}
              {mint.phase && ` in ${mint.phase}`}
            </>
          )
          const seconds = chainNow === null ? 0 : chainNow - mint.blockTimestamp
          return (
            <li
              key={`${mint.txHash}:${mint.firstTokenId}`}
              className="flex items-baseline justify-between gap-3 px-4 py-3 text-sm"
            >
              {chain.explorerUrl ? (
                <a
                  href={explorerTxUrl(chain, mint.txHash)}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 truncate underline-offset-4 hover:underline"
                >
                  {what}
                  <span className="sr-only">, view transaction</span>
                </a>
              ) : (
                <span className="min-w-0 truncate">{what}</span>
              )}
              <span className="shrink-0 text-[0.8125rem] text-muted-foreground">
                {formatDistance(seconds)} ago
              </span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
```

In `apps/web/src/components/mint/mint-page.tsx`, replace:

```tsx
import { PageSections } from './page-sections'
import { PhaseList } from './phase-list'
import { StickyMintBar } from './sticky-mint-bar'
import type { MintPageProps } from './types'
```

with:

```tsx
import { PageSections } from './page-sections'
import { PhaseList } from './phase-list'
import { RecentMints } from './recent-mints'
import { StickyMintBar } from './sticky-mint-bar'
import type { MintPageProps } from './types'
```

In `apps/web/src/components/mint/mint-page.tsx`, replace:

```tsx
              <MintPanel />
              <PhaseList />
            </div>
          </div>
```

with:

```tsx
              <MintPanel />
              <PhaseList />
              <RecentMints />
            </div>
          </div>
```

- [ ] **Step 7: Typecheck and lint the web app**

Run: `pnpm --filter @cobweb/web typecheck && pnpm --filter @cobweb/web lint`
Expected: no errors and no warnings.

- [ ] **Step 8: Format, run the root checks and commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
pnpm exec prettier --write apps/web/src/lib/mint/live-data.ts apps/web/src/lib/mint/live-data.test.ts apps/web/src/components/mint/sample-source.ts apps/web/src/components/mint/sample-source.test.ts apps/web/src/components/mint/model.test.ts apps/web/src/components/mint/collection-sections.tsx apps/web/src/components/mint/recent-mints.tsx apps/web/src/components/mint/mint-page.tsx
pnpm typecheck && pnpm lint && pnpm test
git add apps/web/src/lib/mint/live-data.ts apps/web/src/lib/mint/live-data.test.ts apps/web/src/components/mint/sample-source.ts apps/web/src/components/mint/sample-source.test.ts apps/web/src/components/mint/model.test.ts apps/web/src/components/mint/collection-sections.tsx apps/web/src/components/mint/recent-mints.tsx apps/web/src/components/mint/mint-page.tsx
git commit -m "$(cat <<'EOF'
Show Holders and Recent mints on the mint page from the state body's activity, and leave both out in sample mode with ?activity=none

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: the web app reports 896 tests in 94 files; the other packages are unchanged.

---

### Task 8: `verify:indexer`

**Kind:** integration. The plan carries every line, but the script drives the live stack (local Supabase, Anvil, the server in process) through waits on the indexer's pace and meets this machine's own data: an Opus implementer.

**Files:**

- Create: `apps/web/scripts/verify-indexer.ts`
- Modify: `apps/web/package.json` (the command)
- Test: `pnpm --filter @cobweb/web verify:indexer`

**Interfaces:**

- Consumes: everything Tasks 1 to 7 produce; `startFreshness`, `IndexerOptions` and `HealthBody` from `@cobweb/freshness/server`; the fixture's `admin`, `chain`, `chainReady`, `check`, `deployedCollection`, `failureLine`, `readLockCollection`, `removeFixtures`, `rpc`, `runChecks`, `sendCall`, `sendRequest`, `settings` and `signIn`; `activityViewCore`, `paidByMintersOf`, `airdropViewCore`, `confirmAirdropCore`, `airdropRecipientsCore`, `airdropRecipientsAllCore`, `recipientsCsvRows`, `phasesViewCore`, `settingsViewCore`, `airdropCalls`, `phaseCalls` and `settingsCalls`.
- Produces: `pnpm --filter @cobweb/web verify:indexer`, fifteen checks (spec section 10, with Decision 18's choices and Decision 14's page past the last in check 10).

There is no failing run first: every module the script reads exists once Tasks 1 to 7 have landed, so its first run is its proof.

- [ ] **Step 1: The script**

The server runs in process with its indexer on fast intervals (`passMs` of 200, 500 and 500 ms, the targets every second). The airdrop through Cobweb is sent and confirmed while the server is stopped, the burn pays the airdrop fee the factory's admin sets, the 1,200 empty blocks are mined 100 at a time, and check 14 counts every cursor the database holds on 31337 (Decision 18).

Create `apps/web/scripts/verify-indexer.ts`:

```ts
// Checks the indexer in the freshness server against LOCAL Supabase, a LOCAL Anvil chain and the server in process
// (docs/specs/2026-10-16-indexer-overview.md, section 10): a creator deploys a collection of three tokens through
// the cores with Public (0.001 ETH, 2, 1 per wallet) and Holders (free, 1); the server runs with its indexer on
// fast intervals; then a mint, an airdrop through Cobweb, a burn and a withdrawal sent straight from the creator's
// wallet, and a transfer, each read back from the indexer's tables, the state body, the Overview's and Airdrop's
// cores; then a replay, a restart and a backfill over 1,200 empty blocks, /health and the stop. Fifteen PASS
// lines with the cleanup.
//
//   supabase start
//   pnpm --filter @cobweb/web chain:local    (then copy its two lines into apps/web/.env.local)
//   pnpm --filter @cobweb/web verify:indexer
//
// The fixture (scripts/deploy-fixture.ts) reads the settings from the environment, `supabase status -o env` and
// apps/web/.env.local, and refuses non-local endpoints. The server's database is the local one, with the service
// role key the fixture read; the script prints no key and no URL, and a thrown error prints viem's short message
// or its first line (chain-fixture.ts). The indexer reads every collection deployed on Anvil the database lists,
// the earlier walks' among them, and logs once a minute each one whose deploy is not on this chain. The cleanup
// closes the server and deletes every row the run created, the indexer's with its collection. What stays is on
// Anvil: the collection with its mint, airdrop, burn, transfer and withdrawal, the three fresh accounts, 1,200
// more blocks and the chain's clock about 1,200 s ahead. Runs under
// `node --conditions=react-server --import ./scripts/resolve-ts.mjs`.

import { createWalletClient, http, parseEther, type Address, type Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { anvil } from 'viem/chains'
import { statePath, type StateBody } from '@cobweb/shared'
import { collectionAbi } from '@cobweb/shared/collection-abi'
import {
  startFreshness,
  type Freshness,
  type HealthBody,
  type IndexerOptions,
} from '@cobweb/freshness/server'
import {
  admin,
  chain,
  chainReady,
  check,
  deployedCollection,
  failureLine,
  readLockCollection,
  removeFixtures,
  rpc,
  runChecks,
  sendCall,
  sendRequest,
  settings,
  signIn,
  type Creator,
  type Deployed,
  type DeployForm,
} from './deploy-fixture.ts'

const { activityViewCore } = await import('../src/lib/manage/activity-core.ts')
const { paidByMintersOf } = await import('../src/lib/manage/activity-view.ts')
const { airdropRecipientsAllCore, airdropRecipientsCore, airdropViewCore, confirmAirdropCore } =
  await import('../src/lib/manage/airdrop-core.ts')
const { BURN_ADDRESS, recipientsCsvRows } = await import('../src/lib/manage/airdrop-view.ts')
const { airdropCalls, phaseCalls, settingsCalls } = await import('../src/lib/manage/phase-calls.ts')
const { phasesViewCore } = await import('../src/lib/manage/phases-core.ts')
const { settingsViewCore } = await import('../src/lib/manage/settings-core.ts')
const { NOT_FOUND } = await import('../src/lib/art/result.ts')
type PhasesContext = import('../src/lib/manage/phases-core.ts').PhasesContext

/** The launch groups: Public (id 0) and Holders (id 1). */
const PUBLIC = 0
const PUBLIC_PRICE = 1_000_000_000_000_000n
/** Anvil's first account: the local factory's admin, unlocked on the node, so no key is needed. */
const PLATFORM_ADMIN: Address = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
/** The airdrop fee the admin sets: 0.0001 ETH a token, so the burn pays one. */
const FEE = 100_000_000_000_000n
/** The indexer on fast intervals, so each change is read within about a second. */
const INDEXER: IndexerOptions = {
  supabaseUrl: settings.url,
  serviceRoleKey: settings.serviceKey,
  passMs: { behind: 200, fast: 500, idle: 500 },
  targetsEveryMs: 1_000,
}
/** How long a change may take to reach the tables: a pass, a write and the reads. */
const RECORDED_WITHIN_MS = 5_000
/** How long a server started again may take to answer the activity. */
const ACTIVITY_WITHIN_MS = 2_000
/** How long one request to the server may take. */
const REQUEST_TIMEOUT_MS = 5_000
const DEAD = BURN_ADDRESS.toLowerCase()

const creatorKey = privateKeyToAccount(generatePrivateKey())
const holderKey = privateKeyToAccount(generatePrivateKey())
const strangerKey = privateKeyToAccount(generatePrivateKey())
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const lower = (address: Address) => address.toLowerCase()
const sameTime = (a: string | null | undefined, seconds: number) => !!a && Date.parse(a) === seconds * 1_000

/** The value `read` answers within `ms`, polled every 100 ms, or null. */
async function until<T>(read: () => Promise<T | null | undefined | false>, ms: number): Promise<T | null> {
  const end = performance.now() + ms
  for (;;) {
    const value = await read()
    if (value) return value
    if (performance.now() >= end) return null
    await wait(100)
  }
}

let freshness: Freshness | null = null

/** The freshness server in process, serving Anvil alone, with its indexer on. */
async function startServer(): Promise<Freshness> {
  freshness = await startFreshness({ port: 0, host: '127.0.0.1', chainIds: [31337], indexer: INDEXER })
  return freshness
}

async function stopServer(): Promise<void> {
  const server = freshness
  freshness = null
  await server?.close()
}

/** The running server, or a throw. */
function server(): Freshness {
  if (!freshness) throw new Error('the freshness server is not running')
  return freshness
}

type StateAnswer = { status: number; etag: string | null; body: StateBody | null }

async function stateOf(contract: Address): Promise<StateAnswer> {
  const response = await fetch(`${server().url}${statePath(31337, contract)}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const body = response.status === 200 ? ((await response.json()) as StateBody) : null
  return { status: response.status, etag: response.headers.get('etag'), body }
}

async function healthOf(): Promise<{ text: string; body: HealthBody }> {
  const response = await fetch(`${server().url}/health`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  const text = await response.text()
  return { text, body: JSON.parse(text) as HealthBody }
}

type CursorRow = { from_block: number; indexed_block: number; synced_at: string | null; holders: number }

async function cursorOf(cid: string): Promise<CursorRow | null> {
  const { data, error } = await admin
    .from('indexer_cursors')
    .select('from_block, indexed_block, synced_at, holders')
    .eq('collection_id', cid)
    .maybeSingle()
  if (error) throw new Error(`the cursor: ${error.message}`)
  return data
}

/** Every row the indexer keeps for the collection, and its cursor's start and holders, as one string to compare. */
async function indexedRows(cid: string): Promise<string> {
  const reads = await Promise.all([
    admin
      .from('mints')
      .select('tx_hash, log_index, block, block_time, recipient, vault, group_id, amount, first_token_id')
      .eq('collection_id', cid)
      .order('tx_hash'),
    admin
      .from('token_owners')
      .select('token_id, owner, block, log_index')
      .eq('collection_id', cid)
      .order('token_id'),
    admin
      .from('airdrops')
      .select(
        'tx_hash, kind, recipients, tokens, fee_paid_wei::text, first_token_id, last_token_id, block, sent_by, block_time',
      )
      .eq('collection_id', cid)
      .order('tx_hash'),
    admin
      .from('airdrop_recipients')
      .select('tx_hash, first_token_id, recipient, tokens, block, block_time')
      .eq('collection_id', cid)
      .order('first_token_id'),
    admin
      .from('withdrawals')
      .select('tx_hash, amount_wei::text, payout_address, block')
      .eq('collection_id', cid)
      .order('tx_hash'),
    admin.from('indexer_cursors').select('from_block, holders').eq('collection_id', cid),
  ])
  for (const { error } of reads) if (error) throw new Error(`the indexed rows: ${error.message}`)
  return JSON.stringify(reads.map(({ data }) => data))
}

/** The time of a transaction's block (Unix seconds). */
async function blockTimeOf(hash: Hex): Promise<number> {
  const receipt = await chain.getTransactionReceipt({ hash })
  return Number((await chain.getBlock({ blockNumber: receipt.blockNumber })).timestamp)
}

/** Sets the collection's fees from the platform admin, sent as an unlocked JSON-RPC account, and waits. */
async function setAirdropFee(contract: Address): Promise<void> {
  const platform = createWalletClient({ account: PLATFORM_ADMIN, chain: anvil, transport: http(rpc) })
  const hash = await platform.writeContract({
    address: contract,
    abi: collectionAbi,
    functionName: 'setFees',
    args: [0n, 0n, FEE],
  })
  const receipt = await chain.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`setFees reverted: ${hash}`)
}

/** The owner check the actions run first (`ownedCollection`): the collection's owner, else not found. */
async function ownership(creator: Creator, cid: string): Promise<string> {
  const collection = await readLockCollection(creator.client, cid)
  return collection && collection.owner_id === creator.userId ? 'owned' : NOT_FOUND
}

/** What main set up, for the cleanup's check. */
let subject: { deployed: Deployed } | null = null

async function main(): Promise<void> {
  console.log(
    `Verifying the indexer on chain 31337 at ${new URL(rpc).host} against Supabase at ${new URL(settings.url).host}`,
  )
  for (const key of [creatorKey, holderKey, strangerKey])
    await chain.setBalance({ address: key.address, value: parseEther('10') })
  const creator = await signIn(creatorKey)
  const stranger = await signIn(strangerKey)
  const form: DeployForm = {
    chainId: 31337,
    payout: creatorKey.address,
    royaltyBps: 500,
    royaltyReceiver: creatorKey.address,
    publicMaxPerWallet: 1,
    groups: [
      { name: 'Public', priceWei: PUBLIC_PRICE.toString(), maxSupply: 2 },
      { name: 'Holders', priceWei: '0', maxSupply: 1 },
    ],
  }
  let deployed: Deployed | null = null
  let before: { counted: boolean } | null = null

  await check(
    '1. setup: Anvil answers as 31337 with the factory approving the shipped code hash, Supabase answers, and the freshness server serves 31337 with its indexer on',
    async () => {
      const unready = await chainReady()
      if (unready) return unready
      const cursors = await admin.from('indexer_cursors').select('*', { count: 'exact', head: true })
      if (cursors.error) return `Supabase: ${cursors.error.message}; run supabase migration up --local`
      deployed = await deployedCollection(creator, form, 'indexer')
      subject = { deployed }
      await setAirdropFee(deployed.record.contractAddress)
      // The Overview's view before any indexer has read the collection, for check 2.
      const view = await activityViewCore(deployed.ctx)
      if (!('data' in view)) return `the view before: ${JSON.stringify(view)}`
      before = view.data
      await startServer()
      const { body } = await healthOf()
      const entry = body.chains.find((chainHealth) => chainHealth.chainId === 31337)
      return body.chains.length === 1 && entry?.indexer
        ? null
        : `serves ${body.chains.map((chainHealth) => chainHealth.chainId).join(' ')}, indexer ${JSON.stringify(entry?.indexer)}`
    },
  )
  const run = deployed as Deployed | null
  if (!run || !freshness) throw new Error('the collection or the server did not start')
  const { cid, ctx } = run
  const contract = run.record.contractAddress
  const deployBlock = Number((await chain.getTransactionReceipt({ hash: run.hash })).blockNumber)

  await check(
    "2. counting: before the server starts the owner's activity view reads not counted; after it starts the cursor is at the deploy block within one targets read, and the view reads counted with 0 holders and no mint",
    async () => {
      if (!before || before.counted) return `before the server: ${JSON.stringify(before)}`
      const cursor = await until(async () => {
        const row = await cursorOf(cid)
        return row?.from_block === deployBlock ? row : null
      }, INDEXER.targetsEveryMs! + 1_000)
      if (!cursor)
        return `no cursor at the deploy block ${deployBlock}: ${JSON.stringify(await cursorOf(cid))}`
      const counted = await until(async () => {
        const view = await activityViewCore(ctx)
        return 'data' in view && view.data.counted ? view.data : null
      }, RECORDED_WITHIN_MS)
      return counted?.holders === 0 && counted.recentMints.length === 0
        ? null
        : `view ${JSON.stringify(counted)}`
    },
  )

  // The holder mints 1 from Public, opened by the creator.
  await sendCall(creatorKey, contract, phaseCalls.open(PUBLIC))
  const [total] = await chain.readContract({
    address: contract,
    abi: collectionAbi,
    functionName: 'quoteBatchMint',
    args: [BigInt(PUBLIC), 1n],
  })
  const { request: mintRequest } = await chain.simulateContract({
    address: contract,
    abi: collectionAbi,
    functionName: 'batchMint',
    args: [1n, BigInt(PUBLIC)],
    value: total,
    account: holderKey,
  })
  const mintHash = await sendRequest(holderKey, mintRequest)
  const mintTime = await blockTimeOf(mintHash)

  await check(
    "3. mint: the holder's mint of 1 from Public is recorded once with its recipient, group 0, amount 1, token 1 and its block's time; token 1's owner is the holder and holders read 1",
    async () => {
      const mints = await until(async () => {
        const { data } = await admin.from('mints').select('*').eq('collection_id', cid)
        return data?.length ? data : null
      }, RECORDED_WITHIN_MS)
      const [mint] = mints ?? []
      if (
        mints?.length !== 1 ||
        mint?.tx_hash !== mintHash ||
        mint.recipient !== lower(holderKey.address) ||
        mint.vault !== null ||
        mint.group_id !== 0 ||
        mint.amount !== 1 ||
        mint.first_token_id !== 1 ||
        !sameTime(mint.block_time, mintTime)
      )
        return `mints ${JSON.stringify(mints)}`
      const owner = await admin
        .from('token_owners')
        .select('owner')
        .eq('collection_id', cid)
        .eq('token_id', 1)
        .maybeSingle()
      if (owner.data?.owner !== lower(holderKey.address)) return `token 1 ${JSON.stringify(owner.data)}`
      const cursor = await until(async () => {
        const row = await cursorOf(cid)
        return row?.holders === 1 ? row : null
      }, RECORDED_WITHIN_MS)
      return cursor ? null : `holders ${(await cursorOf(cid))?.holders}`
    },
  )

  let mintedEtag: string | null = null
  await check(
    "4. state: the state endpoint's activity reads 1 holder and the mint, and an empty block leaves its ETag unchanged",
    async () => {
      const read = await until(async () => {
        const answer = await stateOf(contract)
        return answer.body?.activity?.holders === 1 ? answer : null
      }, RECORDED_WITHIN_MS)
      const mint = read?.body?.activity?.recentMints[0]
      if (
        !read?.etag ||
        read.body?.activity?.recentMints.length !== 1 ||
        mint?.txHash !== mintHash ||
        mint.recipient !== holderKey.address ||
        mint.groupId !== 0 ||
        mint.amount !== 1 ||
        mint.firstTokenId !== 1 ||
        mint.blockTimestamp !== mintTime
      )
        return `state ${read?.status} ${JSON.stringify(read?.body?.activity)}`
      await chain.mine({ blocks: 1 })
      const head = Number(await chain.getBlockNumber())
      // One reader tick reads the empty block, then one indexer pass moves the cursor past it.
      const later = await until(async () => {
        const answer = await stateOf(contract)
        return answer.body && answer.body.block >= head ? answer : null
      }, RECORDED_WITHIN_MS)
      await wait(1_000)
      const after = await stateOf(contract)
      mintedEtag = read.etag
      return later && after.etag === read.etag && after.body?.block === head
        ? null
        : `the tag ${read.etag} then ${after.etag} at block ${after.body?.block}, head ${head}`
    },
  )

  // Confirmed through Cobweb while no indexer runs, so Cobweb's record lands first, as it does in the app.
  await stopServer()
  const airdropHash = await sendCall(
    creatorKey,
    contract,
    airdropCalls.batch([{ address: strangerKey.address, amount: 1 }], FEE.toString()),
  )
  const confirmed = await confirmAirdropCore(ctx, airdropHash)
  await startServer()
  const airdropTime = await blockTimeOf(airdropHash)

  await check(
    '5. airdrop through Cobweb: a batch of 1 to the stranger confirmed by confirmAirdropCore keeps its sender, gains its block time and has one recipient row',
    async () => {
      if (!('data' in confirmed)) return `confirm ${JSON.stringify(confirmed)}`
      const row = await until(async () => {
        const { data } = await admin.from('airdrops').select('*').eq('tx_hash', airdropHash).maybeSingle()
        return data?.block_time ? data : null
      }, RECORDED_WITHIN_MS)
      if (row?.sent_by !== lower(creatorKey.address) || !sameTime(row.block_time, airdropTime))
        return `airdrop ${JSON.stringify(row)}`
      const { data } = await admin.from('airdrop_recipients').select('*').eq('tx_hash', airdropHash)
      const [run] = data ?? []
      return data?.length === 1 &&
        run?.recipient === lower(strangerKey.address) &&
        run.tokens === 1 &&
        run.first_token_id === 2
        ? null
        : `recipients ${JSON.stringify(data)}`
    },
  )

  const burnHash = await sendCall(creatorKey, contract, airdropCalls.burn(1, FEE.toString()))
  const burnTime = await blockTimeOf(burnHash)

  await check(
    "6. burn outside Cobweb: airdropNFTs to the dead address sent straight from the creator's wallet is recorded as a burn with no sender, its fee, token 3 and one recipient row; holders still read 2",
    async () => {
      const row = await until(async () => {
        const { data } = await admin
          .from('airdrops')
          .select(
            'kind, recipients, tokens, fee_paid_wei::text, first_token_id, last_token_id, sent_by, block_time',
          )
          .eq('tx_hash', burnHash)
          .maybeSingle()
        return data
      }, RECORDED_WITHIN_MS)
      if (
        row?.kind !== 'burn' ||
        row.sent_by !== null ||
        row.recipients !== 1 ||
        row.tokens !== 1 ||
        row.fee_paid_wei !== FEE.toString() ||
        row.first_token_id !== 3 ||
        row.last_token_id !== 3 ||
        !sameTime(row.block_time, burnTime)
      )
        return `burn ${JSON.stringify(row)}`
      const { data } = await admin
        .from('airdrop_recipients')
        .select('recipient, tokens, first_token_id')
        .eq('tx_hash', burnHash)
      if (JSON.stringify(data) !== JSON.stringify([{ recipient: DEAD, tokens: 1, first_token_id: 3 }]))
        return `recipients ${JSON.stringify(data)}`
      const cursor = await cursorOf(cid)
      return cursor?.holders === 2 ? null : `holders ${cursor?.holders}`
    },
  )

  await check(
    "7. transfer: the holder's transfer of token 1 to the stranger makes the stranger its owner, holders read 1, and the state answers a new ETag",
    async () => {
      const prior = await until(async () => {
        const answer = await stateOf(contract)
        return answer.body?.activity?.holders === 2 ? answer : null
      }, RECORDED_WITHIN_MS)
      if (!prior?.etag || prior.etag === mintedEtag)
        return `the state before ${JSON.stringify(prior?.body?.activity)}`
      const { request } = await chain.simulateContract({
        address: contract,
        abi: collectionAbi,
        functionName: 'transferFrom',
        args: [holderKey.address, strangerKey.address, 1n],
        account: holderKey,
      })
      await sendRequest(holderKey, request)
      const owner = await until(async () => {
        const { data } = await admin
          .from('token_owners')
          .select('owner')
          .eq('collection_id', cid)
          .eq('token_id', 1)
          .maybeSingle()
        return data?.owner === lower(strangerKey.address) ? data : null
      }, RECORDED_WITHIN_MS)
      if (!owner) return 'token 1 did not move to the stranger'
      if ((await cursorOf(cid))?.holders !== 1) return `holders ${(await cursorOf(cid))?.holders}`
      const after = await until(async () => {
        const answer = await stateOf(contract)
        return answer.body?.activity?.holders === 1 ? answer : null
      }, RECORDED_WITHIN_MS)
      return after?.etag && after.etag !== prior.etag ? null : `the tag ${prior.etag} then ${after?.etag}`
    },
  )

  const withdrawHash = await sendCall(creatorKey, contract, settingsCalls.withdraw())

  await check(
    "8. withdrawal outside Cobweb: withdrawMintFunds sent straight from the creator's wallet is recorded with the event's amount, the settings view's withdrawn sum includes it, and Paid by minters equals Public's price",
    async () => {
      const row = await until(async () => {
        const { data } = await admin
          .from('withdrawals')
          .select('amount_wei::text, payout_address')
          .eq('tx_hash', withdrawHash)
          .maybeSingle()
        return data
      }, RECORDED_WITHIN_MS)
      if (row?.amount_wei !== PUBLIC_PRICE.toString() || row.payout_address !== lower(creatorKey.address))
        return `withdrawal ${JSON.stringify(row)}`
      const settingsView = await settingsViewCore(ctx)
      if (!('data' in settingsView)) return `settings ${JSON.stringify(settingsView)}`
      if (
        settingsView.data.withdrawnWei !== PUBLIC_PRICE.toString() ||
        settingsView.data.creatorBalanceWei !== '0'
      )
        return `withdrawn ${settingsView.data.withdrawnWei}, balance ${settingsView.data.creatorBalanceWei}`
      const activity = await activityViewCore(ctx)
      if (!('data' in activity)) return `activity ${JSON.stringify(activity)}`
      const paid = paidByMintersOf(settingsView.data, activity.data)
      return paid.kind === 'wei' && paid.wei === PUBLIC_PRICE.toString()
        ? null
        : `paid ${JSON.stringify(paid)}`
    },
  )

  await check(
    "9. Overview: the owner's activity view reads counted, 1 holder and the mint under Public's name; another creator's read is refused as not found",
    async () => {
      const view = await activityViewCore(ctx)
      if (!('data' in view)) return `view ${JSON.stringify(view)}`
      const [mint] = view.data.recentMints
      if (
        !view.data.counted ||
        view.data.holders !== 1 ||
        view.data.recentMints.length !== 1 ||
        mint?.txHash !== mintHash ||
        mint.minter !== holderKey.address ||
        mint.amount !== 1 ||
        mint.firstTokenId !== 1 ||
        mint.at !== mintTime
      )
        return `view ${JSON.stringify(view.data)}`
      const phases = await phasesViewCore(ctx)
      if (!('data' in phases)) return `phases ${JSON.stringify(phases)}`
      const name = phases.data.groups.find((group) => group.id === mint.groupId)?.name
      if (name !== 'Public') return `the mint's phase ${name}`
      // The action refuses another creator at its owner check; the core on that creator's client reads nothing.
      if ((await ownership(stranger, cid)) !== NOT_FOUND) return 'the stranger owns the collection'
      const forged: PhasesContext = { ...ctx, supabase: stranger.client, owner: stranger.userId }
      const theirs = await activityViewCore(forged)
      return 'data' in theirs && !theirs.data.counted && theirs.data.recentMints.length === 0
        ? null
        : `another creator reads ${JSON.stringify(theirs)}`
    },
  )

  await check(
    '10. Airdrop: the history lists the burn and the airdrop newest first with their block times and reads counted; the recipients search finds the stranger by four characters of the address, a page past the last reads none, and the export has a row per recipient',
    async () => {
      const view = await airdropViewCore(ctx)
      if (!('data' in view)) return `view ${JSON.stringify(view)}`
      const history = view.data.history.map((row) => [row.txHash, row.kind, row.confirmedAt])
      if (
        !view.data.counted ||
        JSON.stringify(history) !==
          JSON.stringify([
            [burnHash, 'burn', burnTime],
            [airdropHash, 'airdrop', airdropTime],
          ])
      )
        return `history ${JSON.stringify(history)}, counted ${view.data.counted}`
      // Four of the stranger's hex digits the dead address does not hold, typed in capitals.
      const digits = lower(strangerKey.address).slice(2)
      let part = ''
      for (let at = 0; at + 4 <= digits.length && !part; at++)
        if (!DEAD.includes(digits.slice(at, at + 4))) part = digits.slice(at, at + 4)
      const found = await airdropRecipientsCore(ctx, { search: part.toUpperCase(), page: 0 })
      if (!('data' in found)) return `search ${JSON.stringify(found)}`
      const stranger = found.data.rows.find((row) => row.wallet === strangerKey.address)
      if (
        !stranger ||
        stranger.tokens !== 1 ||
        stranger.firstTokenId !== 2 ||
        !found.data.rows.every((row) => lower(row.wallet).includes(part))
      )
        return `search ${part}: ${JSON.stringify(found.data)}`
      const past = await airdropRecipientsCore(ctx, { search: '', page: 3 })
      if (!('data' in past) || past.data.rows.length !== 0 || past.data.total !== 2)
        return `a page past the last: ${JSON.stringify(past)}`
      const all = await airdropRecipientsAllCore(ctx)
      if (!('data' in all)) return `export ${JSON.stringify(all)}`
      const rows = all.data.map((row) => [row.wallet, row.tokens, row.firstTokenId, row.burn])
      return JSON.stringify(rows) ===
        JSON.stringify([
          [BURN_ADDRESS, 1, 3, true],
          [strangerKey.address, 1, 2, false],
        ]) && recipientsCsvRows(all.data).length === 3
        ? null
        : `export ${JSON.stringify(rows)}`
    },
  )

  await check(
    '11. replay: with the server stopped and the cursor set back to the deploy block, a server started again reads the collection again and every table keeps the same rows and holders; a write starting two blocks past the cursor is refused as skipping blocks',
    async () => {
      const rows = await indexedRows(cid)
      await stopServer()
      const back = await admin
        .from('indexer_cursors')
        .update({ indexed_block: deployBlock - 1 })
        .eq('collection_id', cid)
        .select('indexed_block')
      if (back.error || back.data[0]?.indexed_block !== deployBlock - 1)
        return `setting the cursor back: ${back.error?.message ?? JSON.stringify(back.data)}`
      const skipped = await admin.rpc('indexer_record', {
        p_chain_id: 31337,
        p_from_block: deployBlock + 1,
        p_to_block: deployBlock + 2,
        p_synced_at: null as unknown as string,
        p_collections: [cid],
        p_records: {},
      })
      if (skipped.error?.code !== '23514' || skipped.error.message !== 'The indexer would skip blocks.')
        return `a write past the cursor: ${skipped.error ? `${skipped.error.code} ${skipped.error.message}` : 'accepted'}`
      await startServer()
      const head = Number(await chain.getBlockNumber())
      const read = await until(async () => {
        const cursor = await cursorOf(cid)
        return cursor && cursor.indexed_block >= head ? cursor : null
      }, RECORDED_WITHIN_MS)
      if (!read) return `the cursor at ${(await cursorOf(cid))?.indexed_block}, head ${head}`
      return (await indexedRows(cid)) === rows ? null : 'the rows changed when the collection was read again'
    },
  )

  await check(
    '12. restart: a server started again answers the activity within 2 s, before any new record, and writes no new row',
    async () => {
      const rows = await indexedRows(cid)
      await stopServer()
      await startServer()
      const startedAt = performance.now()
      const answer = await until(async () => {
        const state = await stateOf(contract)
        return state.body?.activity?.holders === 1 ? state : null
      }, ACTIVITY_WITHIN_MS)
      const took = Math.round(performance.now() - startedAt)
      if (!answer) return `no activity within ${ACTIVITY_WITHIN_MS} ms`
      await wait(2_000)
      return (await indexedRows(cid)) === rows ? null : `a new row after the restart (activity in ${took} ms)`
    },
  )

  await check(
    '13. backfill: with the server stopped, the cursor, mints, owners and recipient rows removed and 1,200 empty blocks mined, a server started again rebuilds the same rows from the deploy block and reads counted again',
    async () => {
      const rows = await indexedRows(cid)
      await stopServer()
      for (const table of ['indexer_cursors', 'mints', 'token_owners', 'airdrop_recipients'] as const) {
        const removed = await admin.from(table).delete().eq('collection_id', cid)
        if (removed.error) return `removing ${table}: ${removed.error.message}`
      }
      // In steps of 100, each well under viem's 10 s request timeout: a local Anvil can take 25 ms a block.
      for (let mined = 0; mined < 1_200; mined += 100) await chain.mine({ blocks: 100 })
      const head = Number(await chain.getBlockNumber())
      await startServer()
      const cursor = await until(async () => {
        const row = await cursorOf(cid)
        return row?.synced_at && row.indexed_block >= head ? row : null
      }, RECORDED_WITHIN_MS * 2)
      if (cursor?.from_block !== deployBlock) return `the cursor ${JSON.stringify(await cursorOf(cid))}`
      if ((await indexedRows(cid)) !== rows) return 'the rows rebuilt differ'
      const view = await activityViewCore(ctx)
      return 'data' in view && view.data.counted && view.data.holders === 1
        ? null
        : `view ${JSON.stringify(view)}`
    },
  )

  await check(
    "14. health: /health reports chain 31337's indexer with every collection the database indexes there (this one among them), none behind, its block and last pass, no failed pass and nothing unpaired, and neither a URL nor a key",
    async () => {
      const head = Number(await chain.getBlockNumber())
      const cursors = await admin.from('indexer_cursors').select('collection_id').eq('chain_id', 31337)
      if (cursors.error) return `cursors: ${cursors.error.message}`
      if (!cursors.data.some((row) => row.collection_id === cid)) return 'no cursor for the collection'
      const health = await until(async () => {
        const read = await healthOf()
        const indexer = read.body.chains.find((entry) => entry.chainId === 31337)?.indexer
        return indexer && indexer.block === head && indexer.behind === 0 ? { ...read, indexer } : null
      }, RECORDED_WITHIN_MS)
      if (!health) return `health ${JSON.stringify((await healthOf()).body.chains)}`
      const { indexer, text } = health
      const recent = indexer.lastPassAt !== null && Date.now() - Date.parse(indexer.lastPassAt) < 5_000
      if (
        indexer.collections !== cursors.data.length ||
        !recent ||
        indexer.failedPasses !== 0 ||
        indexer.lastError !== null ||
        indexer.unpaired !== 0
      )
        return `indexer ${JSON.stringify(indexer)} for ${cursors.data.length} cursors`
      const leaked = [settings.serviceKey, settings.url, rpc].filter((secret) => text.includes(secret))
      return leaked.length ? `/health carries ${leaked.length} of the URLs and the key` : null
    },
  )
}

/** Runs a cleanup step whatever failed before it: its problem (a string it answers or a throw), or null. */
async function attempt(label: string, fn: () => Promise<unknown>): Promise<string | null> {
  try {
    const problem = await fn()
    return typeof problem === 'string' ? problem : null
  } catch (error) {
    return `${label} threw ${failureLine(error)}`
  }
}

/** Each indexer table's rows for the collection, as counts. */
async function indexerCounts(cid: string): Promise<string> {
  const counts: string[] = []
  for (const table of ['indexer_cursors', 'mints', 'token_owners', 'airdrop_recipients'] as const) {
    const { count, error } = await admin
      .from(table)
      .select('*', { count: 'exact', head: true })
      .eq('collection_id', cid)
    counts.push(error ? `${table}: ${error.message}` : `${table} ${count}`)
  }
  return counts.join(', ')
}

/** Every cursor of chain 31337 with the time of its last write, as one string to compare. */
async function cursorWrites(): Promise<string> {
  const { data, error } = await admin
    .from('indexer_cursors')
    .select('collection_id, indexed_block, updated_at')
    .eq('chain_id', 31337)
    .order('collection_id')
  if (error) throw new Error(`the cursors: ${error.message}`)
  return JSON.stringify(data)
}

async function cleanup(): Promise<void> {
  await check(
    '15. stop: close() ends the indexer, no write lands for 3 s after it, and the fixtures are removed',
    async () => {
      const run = subject
      const problems: (string | null)[] = [
        await attempt('closing the freshness server', async () => {
          if (!freshness) return null
          await stopServer()
          const writes = await cursorWrites()
          await wait(3_000)
          return (await cursorWrites()) === writes ? null : 'a cursor was written after close()'
        }),
        await attempt('removing the fixtures', removeFixtures),
      ]
      if (run)
        problems.push(
          await attempt('counting the indexer rows', async () => {
            const counts = await indexerCounts(run.deployed.cid)
            return counts === 'indexer_cursors 0, mints 0, token_owners 0, airdrop_recipients 0'
              ? null
              : `left: ${counts}`
          }),
        )
      return problems.find((problem) => problem !== null) ?? null
    },
  )
}

await runChecks(main, cleanup)
```

- [ ] **Step 2: The command**

In `apps/web/package.json`, replace:

```json
    "verify:settings": "node --conditions=react-server --import ./scripts/resolve-ts.mjs scripts/verify-settings.ts",
    "verify:freshness": "node --conditions=react-server --import ./scripts/resolve-ts.mjs scripts/verify-freshness.ts",
    "verify:mint-page": "node --conditions=react-server --import ./scripts/resolve-ts.mjs scripts/verify-mint-page.ts"
  },
  "devDependencies": {
```

with:

```json
    "verify:settings": "node --conditions=react-server --import ./scripts/resolve-ts.mjs scripts/verify-settings.ts",
    "verify:freshness": "node --conditions=react-server --import ./scripts/resolve-ts.mjs scripts/verify-freshness.ts",
    "verify:mint-page": "node --conditions=react-server --import ./scripts/resolve-ts.mjs scripts/verify-mint-page.ts",
    "verify:indexer": "node --conditions=react-server --import ./scripts/resolve-ts.mjs scripts/verify-indexer.ts"
  },
  "devDependencies": {
```

- [ ] **Step 3: Typecheck and lint the web app**

Run: `pnpm --filter @cobweb/web typecheck && pnpm --filter @cobweb/web lint`
Expected: no errors and no warnings.

- [ ] **Step 4: Run the checks**

Run: `pnpm --filter @cobweb/web verify:indexer`
Expected: PASS, `15 passed, 0 failed` in about 80 s, the server's start line reading `The indexer runs on Anvil (31337).` each of the five times it starts. It mines 1,200 blocks and moves Anvil's clock about 1,200 s ahead. On a database that keeps the earlier walks' collections, the log also shows a line a minute for each walk whose deploy is not on this Anvil (Global Constraints).

- [ ] **Step 5: Format, run the root checks and commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
pnpm exec prettier --write apps/web/scripts/verify-indexer.ts apps/web/package.json
pnpm typecheck && pnpm lint && pnpm test
git add apps/web/scripts/verify-indexer.ts apps/web/package.json
git commit -m "$(cat <<'EOF'
Add verify:indexer, fifteen checks of the indexer against local Supabase, Anvil and the freshness server in process

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: test counts unchanged (web 896 in 94 files, shared 105, freshness 167).

---

### Task 9: The whole check list, the browser walk, MASTER_PLAN, the dated notes, the landing note, CLAUDE.md and the server's example settings

This task is the controller's: it runs every check, walks the Overview, Airdrop and the mint page in the browser against the local services with the indexer on, and records what it saw. The doc edits add dated sentences; nothing earlier is rewritten or deleted.

**Files:**

- Modify: `docs/MASTER_PLAN.md` (the Phase 6 status line; the Hosting decision; the Flow note)
- Modify: `docs/specs/2026-10-16-indexer-overview.md` (the acceptance boxes; the landing note)
- Modify: `docs/specs/2026-10-16-freshness-server.md`, `2026-10-16-mint-page-live-data.md`, `2026-10-15-airdrop-settings.md` (a dated note in section 12 each), `docs/specs/2026-10-03-creator-flow-ui.md` (a dated note in section 4.6)
- Modify: `CLAUDE.md` (the layout line and the command), `apps/freshness/.env.example` (the two variables)

**Interfaces:**

- Consumes: everything Tasks 1 to 8 produce; the local services (`supabase start` with its buckets seeded, `pnpm --filter @cobweb/web chain:local` with its two lines in `apps/web/.env.local`); the freshness server (`pnpm --filter @cobweb/freshness dev`) with the indexer's two variables; the dev wallet in `apps/web/scripts/dev-wallet` (the one the earlier walks used); Foundry's `cast`, installed with Anvil.
- Produces: the docs, `CLAUDE.md`'s command and the server's example settings.

In every sentence below, `<date>` is the day the work lands, written as `date '+%-d %B %Y'` prints it (for example `16 October 2026`).

- [ ] **Step 1: The whole check list**

Run at the repo root, one after another, and note each count:

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
pnpm typecheck && pnpm lint && pnpm test && pnpm format:check
pnpm build
pnpm --filter @cobweb/web verify:local
pnpm --filter @cobweb/web verify:chain
pnpm --filter @cobweb/web verify:storage
pnpm --filter @cobweb/web verify:sweep
pnpm --filter @cobweb/web verify:render
pnpm --filter @cobweb/web verify:deploy
pnpm --filter @cobweb/web verify:phases
pnpm --filter @cobweb/web verify:whitelist
pnpm --filter @cobweb/web verify:airdrop
pnpm --filter @cobweb/web verify:settings
pnpm --filter @cobweb/web verify:freshness
pnpm --filter @cobweb/web verify:mint-page
pnpm --filter @cobweb/web verify:indexer
```

Expected: tests pass (web 896 in 94 files, shared 105 in 14, freshness 167 in 16, dna 60, render 117, worker 282); the format check and the build pass, the build still listing `● /[slug]` and `ƒ /[slug]/preview`; `verify:local` 394, `verify:chain` 12, `verify:storage` 15, `verify:sweep` 8, `verify:render` 22, `verify:deploy` 15, `verify:phases` 20, `verify:whitelist` 18, `verify:airdrop` 15 (with the gas line), `verify:settings` 17, `verify:freshness` 16, `verify:mint-page` 17 and `verify:indexer` 15, each with `0 failed`. `verify:freshness` and `verify:mint-page` each move Anvil's clock about 600 s ahead and `verify:indexer` about 1,200 s, which the other scripts, reading chain time, do not mind.

- [ ] **Step 2: The browser walk**

The spec's section 10 walk, with the indexer on. Give the freshness server the chain's two lines and the local database's URL and service role key in `apps/freshness/.env` (git ignores it; the command prints no key):

```
{ grep -E '^(RPC_URL_31337|FACTORY_ADDRESS_31337)=' apps/web/.env.local; supabase status -o env | sed -n -E 's/^API_URL="?([^"]*)"?$/SUPABASE_URL=\1/p; s/^SERVICE_ROLE_KEY="?([^"]*)"?$/SUPABASE_SERVICE_ROLE_KEY=\1/p'; } > apps/freshness/.env
```

Then three terminals at the repo root: the freshness server, the dev wallet's signer as the owner of the collection the walk deploys (with the `DEV_WALLET_KEY` the earlier walks used), and the web app on live data:

```
pnpm --filter @cobweb/freshness dev
DEV_WALLET_KEY=<the dev wallet's key> node apps/web/scripts/dev-wallet/signer.mjs
NEXT_PUBLIC_DEMO_DATA=0 NEXT_PUBLIC_FRESHNESS_URL=http://127.0.0.1:3100 pnpm --filter @cobweb/web dev
```

The server's start line ends `The indexer runs on Anvil (31337).` The app runs at `http://localhost:3000` (the signer answers that origin only), with `inject.js` added as the earlier walks did; switch the wallet to Anvil in the account menu. Each `cast` call below sends from an address Anvil impersonates (`cast rpc anvil_impersonateAccount <address> --rpc-url http://127.0.0.1:8545`, then `cast send ... --unlocked --from <address> --rpc-url http://127.0.0.1:8545`), so no key is typed. Walk each item and note what it showed:

1. Deploy a collection through the flow (Details, Art, Lock and upload with `render:local`, Deploy) while the freshness server is stopped: the Overview reads Holders "Counting", Recent mints "Counting the mints from the chain. They show here once Cobweb has read every block since the deploy." and "Paid by minters" "Counting". Start the server: on a reload, Holders 0, "No mints yet. Each one shows here a few blocks after it lands." and "Paid by minters" 0.
2. Publish the mint page, open Public in Phases, and mint 1 on `/<slug>`: within a few seconds the page shows Holders 1 in Details and the mint under "Recent mints" ("<short address> minted 1 in Public", "under a minute ago"), and the Overview's Recent mints lists it, Holders 1.
3. Transfer the token with `cast send <contract> 'transferFrom(address,address,uint256)' <minter> <another address> 1`: Holders stays 1 (the other address now holds it); transfer a second minted token to a third address and Holders reads 2.
4. An airdrop of 2 tokens to two wallets through Airdrop, then a burn of 1 sent with `cast send <contract> 'airdropNFTs(address[],uint256[])' '[0x000000000000000000000000000000000000dEaD]' '[1]' --value <the fee>` from the owner: History reads "Every airdrop and burn on the contract, also any sent from outside Cobweb, once the chain has confirmed it." and lists the burn above the airdrop, each When its block's time; By recipient lists three rows (the burn's "Burn" badge with "0x000000…00dEaD"), the search finds one wallet by four characters of its address and "No address matches that search." for `ffff`; the pager reads "1 to 3 of 3 recipients"; both exports save `airdrop-history.csv` and `airdrop-recipients.csv`.
5. Send `cast send <contract> 'withdrawMintFunds()'` from the owner: Already withdrawn moves to the withdrawn amount while "Paid by minters" holds.
6. Stop and start the freshness server: the page's Holders row and Recent mints return within seconds of its first answer.
7. At a phone width (390 px), the page's Recent mints list fits with no sideways scroll.
8. Sample mode (stop the web app and start it again without the two variables): the Overview with `?activity=counting` and `?activity=behind` ("Counted to the chain as it was 20 minutes ago. Newer mints show once Cobweb catches up."), Airdrop with `?activity=counting` (History's description, By recipient's "Recipients show once Cobweb has read the contract's history."), By recipient's search and pages on the sample, and `/night-owls` with and without `?activity=none`.

A step that does not behave as written is a defect: fix it in a new commit (or send it back to the task that owns it) before recording the landing. Remove `apps/freshness/.env` after the walk, or keep it out of every commit (git ignores it).

- [ ] **Step 3: MASTER_PLAN**

Phase 6's status line gains the third sub-project's sentence after the second; Hosting gains the indexer's decision after the freshness server's; Flow's holder snapshot gains a dated note.

In `docs/MASTER_PLAN.md`, replace:

```markdown
"minted by you" is the phase's own count, not a sum over the phases. Next: the indexer and the Overview.
```

with:

```markdown
"minted by you" is the phase's own count, not a sum over the phases. Next: the indexer and the Overview. The indexer and the Overview (third sub-project of three) landed on <date>; see [specs/2026-10-16-indexer-overview.md](specs/2026-10-16-indexer-overview.md). What exists: the indexer migration (`indexer_cursors`, one row per deployed collection the indexer reads with how far every log is recorded, its synced time and its holders; `mints`, `token_owners` and `airdrop_recipients`, read by the owner except `token_owners` and written only through `indexer_start` and `indexer_record`; `airdrops.sent_by` nullable with `block_time`, so `airdrops` and `withdrawals` hold the indexer's rows beside Cobweb's; and `indexer_targets`, `indexer_start`, `indexer_record` and `indexer_summaries` for the service role only, the write taking one segment in one transaction with the cursors locked in id order, the gap check, every row keyed so a log read twice leaves one, one airdrop per transaction and the holders recounted); in the freshness server, one indexer per served chain beside its reader when `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set (one alone refuses the start): `Transfer`, the two mint events, `NFTsAirdropped` and `MintFundsWithdrawn` through viem's `getLogs` over at most 100 contracts and 500 blocks a scan to the chain's confirmation depth, a failed scan halving its range, cut into writes of at most 2,000 logs, each mint or airdrop paired with its transaction's transfers per collection, passes 1 s apart during a backfill, 5 s while a chain is busy or after a failure and 20 s otherwise, the targets read every minute, a cursor written when it has records, at its first sync or once a minute, each database call abandoned after 10 s, the indexer on `/health`, and `activity` in the state body (the holders and the 10 latest mints from the indexer's memory while it is within 300 s of the state's block time, covered by the ETag); in the web app, the Overview's holders, recent mints and "Paid by minters" (`creatorBalance()` plus every withdrawal) with "Counting", the behind line and "Not read", Already withdrawn counting withdrawals made outside Cobweb, Airdrop's History listing every airdrop with its block time, By transaction and By recipient with the server's search, 25 a page and both exports, and the mint page's Holders row and Recent mints; sample mode's `?activity=` switches; `verify:local` with 394 checks and `pnpm --filter @cobweb/web verify:indexer` with 15. Known: the owner's hosted steps (`supabase db push` for the migration, then on Railway's `freshness` service `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` and a redeploy, after which `/health` lists each served chain's `indexer`; until then the Overview reads "Counting" and the page shows neither Holders nor Recent mints); alerts on the indexer's `/health`, a second replica with a lease, a login role with execute on the four functions only in place of the service role key and the k6 run against the body with `activity` are Phase 7's; on a testnet before launch: each provider's `eth_getLogs` limits with 100 addresses and 500 blocks, a backfill's pace on Arbitrum's fast blocks, the lag at each chain's depth and delegated mints with their vaults, which Anvil cannot show; a reorg deeper than the depth leaves its rows; the activity trails the chain by the depth plus up to one pass; a restart rescans up to a minute of blocks; a mint or airdrop that does not pair, a group id above 2^53 - 1 and an airdrop of 0 tokens are not recorded while their transfers still move owners; a transaction with two airdrops keeps the first in `airdrops` and every recipient row; an airdrop the indexer recorded before Cobweb's confirm keeps no sender; one block of more than 2,000 logs is written in one call; "Paid by minters" and Already withdrawn read low by a withdrawal's amount until it is at the chain's depth; Recent mints name the receiver, never the payer; the indexer covers Cobweb's own collections only. Phase 6 is complete locally.
```

In `docs/MASTER_PLAN.md`, replace:

```markdown
Railway deprecated config as code. Manage keeps its own reads.

## Open decisions
```

with:

```markdown
Railway deprecated config as code. Manage keeps its own reads.
- **The indexer** (decided 16 October 2026; [specs/2026-10-16-indexer-overview.md](specs/2026-10-16-indexer-overview.md)). Runs in the freshness server's process on Railway for every collection Cobweb deployed on a served chain, from its deploy block to the chain's confirmation depth, with a cursor per collection: `Transfer`, the two mint events, `NFTsAirdropped` and `MintFundsWithdrawn` over at most 500 blocks per scan, written once per log through one service-role function. The state body carries holders and the latest mints from its memory, so the request path still reads no database.

## Open decisions
```

In `docs/MASTER_PLAN.md`, replace:

```markdown
- **Holder snapshot import** for Whitelist and Airdrop is a serverless function that reads `totalSupply` and loops `ownerOf` in batches over a private RPC endpoint. No indexer.
```

with:

```markdown
- **Holder snapshot import** for Whitelist and Airdrop is a serverless function that reads `totalSupply` and loops `ownerOf` in batches over a private RPC endpoint. No indexer. (16 October 2026: the indexer covers Cobweb's own collections only; the snapshot still reads any collection's owners from the chain.)
```

- [ ] **Step 4: The dated notes**

In `docs/specs/2026-10-16-freshness-server.md`, replace:

```markdown
`NFTsAirdropped` and `MintFundsWithdrawn`, which the reader's scan leaves out.

Owed before launch, on a testnet with the registry and the validator deployed:
```

with:

```markdown
`NFTsAirdropped` and `MintFundsWithdrawn`, which the reader's scan leaves out.

> **<date>:** Closed by [2026-10-16-indexer-overview.md](2026-10-16-indexer-overview.md): the indexer runs in `apps/freshness`, one per served chain beside its reader, sharing the clients, the chain list and the RPC variables; `logs.ts` stays the reader's, since the indexer reads decoded logs through viem's `getLogs` at each chain's confirmation depth. Decision 20 changes: the process now holds a database client for the indexer, from `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, while the request path still reads none, since the state body's `activity` comes from the indexer's memory.

Owed before launch, on a testnet with the registry and the validator deployed:
```

In `docs/specs/2026-10-16-mint-page-live-data.md`, replace:

```markdown
  verify's collection has three tokens, so its tiers cover three ranks.

## 13. Acceptance criteria
```

with:

```markdown
  verify's collection has three tokens, so its tiers cover three ranks.

> **<date>:** The third sub-project's items landed ([2026-10-16-indexer-overview.md](2026-10-16-indexer-overview.md)): the state body carries `activity`, the holders and the 10 latest mints from the indexer's memory, so the page shows a Holders row in Details and Recent mints under the phases, and neither while `activity` is null; the Overview shows holders, recent mints and "Paid by minters" on real data.

## 13. Acceptance criteria
```

In `docs/specs/2026-10-15-airdrop-settings.md`, replace:

```markdown
  behind a running holder snapshot.

## 13. Acceptance criteria
```

with:

```markdown
  behind a running holder snapshot.

> **<date>:** The indexer reads `NFTsAirdropped`, `Transfer` and `MintFundsWithdrawn` ([2026-10-16-indexer-overview.md](2026-10-16-indexer-overview.md)): airdrops and withdrawals made outside Cobweb are listed and counted (`airdrops.sent_by` is null for a row the indexer wrote), "Paid by minters" shows on the Overview as `creatorBalance()` plus every withdrawal, History's When is the block's time once the indexer has read the airdrop, and By recipient lists every wallet an airdrop reached. Withdrawn so far counts a withdrawal once the chain has confirmed it, however it was sent.

## 13. Acceptance criteria
```

In `docs/specs/2026-10-03-creator-flow-ui.md`, replace:

```markdown
Preview opens the owner's view at `/<slug>/preview` under a banner, public or not.

### 4.7 Public mint page (`/[slug]`)
```

with:

```markdown
Preview opens the owner's view at `/<slug>/preview` under a banner, public or not.

> **<date>:** The Overview and History run on the indexer's data ([2026-10-16-indexer-overview.md](2026-10-16-indexer-overview.md)). What changed from the sample: holders, recent mints and "Paid by minters" come from the chain's logs, with "Counting" until Cobweb has read every block since the deploy and a line when its count trails the chain by more than 5 minutes; the mints-over-time chart, the platform fees line and the checklist stay out (review round 1). Airdrop's History lists every airdrop and burn on the contract with its block's time and gains a By recipient view, each wallet a row with its tokens and token ids, searched by any part of the address, 25 a page, with its own CSV export; legacy's Import Type is not kept, since Cobweb stores no list.

### 4.7 Public mint page (`/[slug]`)
```

- [ ] **Step 5: The acceptance boxes and the landing note**

In section 13 of `docs/specs/2026-10-16-indexer-overview.md`, change each `- [ ]` to `- [x]` whose criterion Steps 1 and 2 confirmed (all ten when everything passed). Then, after the list and before `## 14. Reconciliations with the rulings`, add one paragraph that starts `Checked on <date> on Anvil, local Supabase and the freshness server with its indexer:` and records: the root checks with the web, shared and freshness test counts; the build; each verify script with its count; the walk's eight items as they behaved; the departures from the spec's letter (this plan's Decisions 2 to 9, 12, 14 and 18); the hosted steps still owed (section 12's list); and any defect found with the commit that fixed it.

- [ ] **Step 6: CLAUDE.md and the server's example settings**

In `CLAUDE.md`, replace:

```markdown
apps/freshness     Railway service that reads chain state for mint pages: the state and wallet endpoints, run from source on Node 24
```

with:

```markdown
apps/freshness     Railway service that reads chain state for mint pages and indexes Cobweb's collections: the state and wallet endpoints and the indexer, run from source on Node 24
```

In `CLAUDE.md`, replace:

```markdown
pnpm --filter @cobweb/web verify:mint-page   # the public page against local Supabase, local storage, Anvil and the freshness server in process: save, media and publish, liveness at T-1 and T, a mint through the page's path and the state after it, the tiers
```

with:

```markdown
pnpm --filter @cobweb/web verify:mint-page   # the public page against local Supabase, local storage, Anvil and the freshness server in process: save, media and publish, liveness at T-1 and T, a mint through the page's path and the state after it, the tiers
pnpm --filter @cobweb/web verify:indexer   # the indexer in the freshness server against local Supabase and Anvil: mints, owners, airdrops and withdrawals once each, a replay, a restart and a backfill, the Overview, Airdrop and the state body
```

In `apps/freshness/.env.example`, replace:

```
# environment only.
COBWEB_TEST_CHAINS=

# Per chain: the server reads a chain when both of its variables are set. RPC_URL_<id> is a secret (the URL
```

with:

```
# environment only.
COBWEB_TEST_CHAINS=

# The indexer's database: the project's API URL and its service role key, a secret that never leaves the
# server. Set both to run the indexer, or neither. Local: the values `supabase status` prints.
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

# Per chain: the server reads a chain when both of its variables are set. RPC_URL_<id> is a secret (the URL
```

- [ ] **Step 7: Commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
git add docs/MASTER_PLAN.md docs/specs/2026-10-16-indexer-overview.md docs/specs/2026-10-16-freshness-server.md docs/specs/2026-10-16-mint-page-live-data.md docs/specs/2026-10-15-airdrop-settings.md docs/specs/2026-10-03-creator-flow-ui.md CLAUDE.md apps/freshness/.env.example
git commit -m "$(cat <<'EOF'
Record the indexer and the Overview's landing in MASTER_PLAN with the indexer's Hosting decision, in its spec and the notes of the specs it changes, CLAUDE.md and the freshness server's example settings

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: `git show --stat HEAD` lists the six docs, `CLAUDE.md` and `apps/freshness/.env.example` only; `git diff HEAD~1 -- docs/PLAN.md` prints nothing.

---

## Self-review

**Spec coverage.** Sections 1 to 3 (the goal, the 25 decisions, the scope): Tasks 1 to 9 in section 3's order (Decision 1). Section 4.1 (the new tables), 4.2 (`airdrops` and `withdrawals`), 4.3 (the four functions) and 4.4 (the types): Task 1. Section 5 (the shared package): `MintBody` and `StateActivity` in Task 2, `StateBody.activity` in Task 4 (Decision 2). Section 6.1 (the options, the configuration and the start, the start line included): Task 3. Section 6.2 (the database port): Task 3. Section 6.3 (the plan) and 6.4 (the records): Task 2. Section 6.5 (the pass): Task 3. Section 6.6 (activity and the state body): `activity.ts` in Task 2, the body, the route and the tag in Task 4. Section 6.7 (`/health` and the five log lines): Task 3. Section 7.1 (the Overview's read): Task 5. Section 7.2 (the Overview's page and screen, its copy table): Task 5. Section 7.3 (Airdrop, its copy table): Task 6. Section 7.4 (Settings): Task 6. Section 7.5 (the mint page): the parser in Task 4, the view, Details and Recent mints in Task 7. Section 8 (sample mode): the Overview's switches in Task 5, Airdrop's in Task 6, the mint page's in Task 7. Section 9 (stage rules): unchanged. Section 10 (testing): the unit tests in Tasks 2 to 7, `verify:local` in Task 1, `verify:indexer` in Task 8, the walk and the check list in Task 9. Section 11 (documentation): Task 9. Section 12 (owed and known): the `Known:` list Task 9 writes into MASTER_PLAN and the landing note. Section 13 (acceptance): Task 9. Section 14's reconciliations: 1 (a database client in the process, the request path reading none) Tasks 3 and 4; 2 (supabase-js at run time) Task 3; 3 (with the indexer on, the server reads its targets and each chain's head at start) Task 3; 4 (`logs.ts` stays the reader's) Task 3; 5 (History's copy, `sent_by` nullable, When from `block_time`) Tasks 1 and 6; 6 ("Paid by minters" as the Overview's row) Task 5; 7 (the holder snapshot unchanged) Task 9's Flow note; 8 (mints keyed by the transaction and the log index) Task 1; 9 (Import Type not kept) Task 9's note in the creator flow spec; 10 (one cursor row per collection) Task 1.

**Where this plan departs from the spec's letter.** The page's parser comes with the wire field in Task 4, not with the page in Task 7 (Decision 2); `Summary` and `IndexerHealth` live where their first reader is, and are re-exported where the spec lists them (Decision 3); `recordsOf` answers the unpaired transactions, not a count (Decision 4); `indexer_record`'s answer carries each collection's id and contract (Decision 5); one airdrop per transaction and one owner per token before each insert, with check 7's name gaining the case (Decision 6); a pass with a failure waits the fast delay (Decision 7); each database call is abandoned after 10 s, with the codes `TIMEOUT` and `NETWORK` (Decision 8); a started cursor's empty summary (Decision 9); `nullable().catch(null)` in place of `nullish().catch(null)` (Decision 12); By recipient's order, its page past the last and its refusal's sentence, with check 10's name gaining the page past the last (Decision 14); `verify:indexer`'s confirm with the server stopped, its fee, its mining in steps and check 14 counting the database's cursors, with check 14's name saying so (Decision 18). Details the spec leaves open: the log throttle and the range a reset cursor keeps (Decision 10), the indexers' start after the listen and the options read inside the start (Decision 11), the activity core's reads (Decision 13), History's new file and the sample's demo type (Decision 15), the rows' keys (Decision 16), the tests beyond the spec's list (Decision 17) and where `CLAUDE.md` and the example settings are written (Decision 19).

**Placeholder scan.** No step says "add error handling" or "similar to Task N"; every code step shows a whole file or an exact anchor with its replacement. The only values filled at landing are Task 9's `<date>`, its acceptance boxes and its landing paragraph, each defined where it is used, and the walk's runtime values (the dev wallet's key, the deployed collection's contract and owner, the fee), which only the walk knows.

**Type consistency.** `indexer_cursors`, `mints`, `token_owners`, `airdrop_recipients`, `indexer_targets`, `indexer_start`, `indexer_record`, `indexer_summaries`, `private.indexer_target`, `private.indexer_summary`, `MintBody`, `StateActivity`, `StateBody.activity`, `DEAD_ADDRESS`, `INDEX_EVENTS`, `IndexEventName`, `IndexLog`, `MintRecord`, `OwnerRecord`, `RunRecord`, `AirdropRecord`, `WithdrawalRecord`, `Records`, `eventBlocksOf`, `recordsOf`, `MAX_RANGE`, `ADDRESSES_PER_SCAN`, `LAGGING_SCANS_PER_PASS`, `MAX_LOGS_PER_WRITE`, `PASS_MS`, `TARGETS_EVERY_MS`, `CURSOR_WRITE_EVERY_MS`, `Cursor`, `Scan`, `safeBlockOf`, `scansOf`, `segmentsOf`, `passDelayMs`, `ACTIVITY_LAG_MAX_S`, `RECENT_MINTS`, `Summary`, `activityOf`, `IndexerOptions`, `indexerOptionsOf`, `ReaderHealth`, `IndexerHealth`, `ChainHealth`, `chainHealth`, `Target`, `RecordWrite`, `IndexerDb`, `DB_TIMEOUT_MS`, `IndexerWriteError`, `supabaseIndexerDb`, `chainIndexer`, `ChainIndexer`, `FreshnessOptions.indexer`, `stateBody`, `etagOf`, `activitySchema`, `RECENT_MINTS_SHOWN`, `BEHIND_AFTER_S`, `CursorRow`, `MintRow`, `ActivityView`, `activityViewOf`, `behindOf`, `PaidByMinters`, `paidByMintersOf`, `activityViewCore`, `getActivity`, `sampleActivityView`, `AirdropView.counted`, `RecipientRow`, `RecipientPage`, `RECIPIENTS_PAGE`, `AirdropDbRow.block_time`, `RecipientDbRow`, `tokenIdsText`, `recipientSearchOf`, `recipientRowsOf`, `recipientsCsvRows`, `airdropRecipientsCore`, `airdropRecipientsAllCore`, `getAirdropRecipients`, `exportAirdropRecipients`, `RECIPIENTS_NOT_READ`, `WITHDRAWAL_TIMED_OUT`, `AirdropRecipientRecord`, `DEMO_AIRDROP_RECIPIENTS`, `sampleRecipients`, `AirdropServer.recipients`, `AirdropServer.exportRecipients`, `HistoryPanel`, `MintActivity`, `activityOfBody`, `MintLive.activity`, `RecentMints` and `SampleSwitches.activity` are spelled the same in every task that uses them.

**Review Focus.** Five lines, each with its test in the owning task: a database call that never answers (Task 3, `indexer-db.test.ts`), an outage retried every second (Task 3, `indexer.test.ts`), two airdrops in one transaction (Task 1, `verify:local`'s check 7), a collection that has not minted yet (Task 3, `indexer.test.ts`) and a mint made from inside another collection's mint (Task 2, `indexer-records.test.ts`). Each was checked against a mutation of the rule it guards: the call's abort signal dropped failed exactly its test, and so did the started cursor's empty summary dropped and one pending list for every collection; the failed pass treated as a backfill failed its test and the two others that pace on the fast delay after a failure (the summaries' retry and the halving), all three in `indexer.test.ts`; `distinct on (r.tx)` dropped from `indexer_record` failed check 7 with `21000 ON CONFLICT DO UPDATE command cannot affect row a second time`, and checks 8 and 10, which count that write's rows (`391 passed, 3 failed`). Each mutation was restored and the suites passed again.

**Checked while planning.** The code was written first in a scratch worktree of the repository at `46761d2` (its own branch, one commit per task), and every code block here is taken from those commits by a script; each anchored edit is generated from its commit's diff and was checked by applying it to the parent's file. The counts at those commits: the web app 877 tests in 93 files before, 879 after Task 4, 887 in 94 after Task 5, 893 after Task 6 and 896 after Task 7 (Task 8 adds a script and no test); the freshness package 112 in 11 before, 143 in 14 after Task 2, 166 in 16 after Task 3 and 167 after Task 4; the shared package 105 in 14 throughout; dna 60, render 117 and worker 282 unchanged; `pnpm typecheck`, `lint` and `test` pass at every commit. Each "see it fail" output was recorded by running the step's command at the task's parent commit with only the task's tests written in (for Task 1, `verify:local` before the migration), and its Expected line quotes that run. The migration was applied with `supabase migration up --local`: `verify:local` read `384 passed, 4 failed` before it, section 9o stopping at `PGRST202` since `indexer_start` did not exist, and `394 passed` after; the new blocks of `database.types.ts` match `supabase gen types typescript --local` up to the line breaks Prettier keeps from the file. The whole check list ran once, at Task 8's commit, in about 10.5 minutes: `pnpm typecheck`, `lint`, `test` and `format:check` pass, the one build lists `● /[slug]` and `ƒ /[slug]/preview`, and `verify:local` 394, `verify:chain` 12, `verify:storage` 15, `verify:sweep` 8, `verify:render` 22, `verify:deploy` 15, `verify:phases` 20, `verify:whitelist` 18, `verify:airdrop` 15 (its gas line reading 26,880,045), `verify:settings` 17, `verify:freshness` 16, `verify:mint-page` 17 and `verify:indexer` 15, each with `0 failed`. `verify:indexer` passed four times, `15 passed, 0 failed` in about 80 s each with `The indexer runs on Anvil (31337).` at each of its five starts: twice at Task 8's commit, once in the check list and once in the apply pass below. A smoke run of the server in process with the indexer on, against this machine's database and Anvil, started a cursor for the walk collection "Mint Walk 1", whose deploy is on the running Anvil, and logged each of the six other walk deploys, made on an Anvil since restarted, as unreadable (Global Constraints, Decision 10); it wrote no row to `airdrops` or `withdrawals`. Measured while planning: an idle local Anvil mines 100 blocks in about 2.4 s while one `anvil_mine` of 1,200 outran viem's 10 s request timeout, PostgREST refuses a page past the last with 416 (`PGRST103`), and zod 4.6.5 leaves a missing key absent under `nullish` (Decisions 12, 14 and 18). Five mutations, one per Review Focus line, each failed the test named there, and the suites passed again once each was restored. Then the plan itself was applied to a second worktree at `46761d2` (a real offline install, Next's route types and the repository's `contracts/out`) by a script that performs each "Create", "Replace the whole of", "In ..., replace: ... with:" and "At the end of ..., append:" literally and refuses an anchor found other than once, runs each "Run:" line and bash block through zsh (each bash block with errexit), checks each Run's exit against its Expected line (a "FAIL" needs a failing run) and finds each backticked fragment of that line in the output, and checks that Prettier changes none of a commit's files: every one of its 175 directives (18 files created, 157 anchored edits) landed with its anchor found exactly once, the eight "see it fail" steps failed as their Expected lines say and the 21 other Runs passed with every fragment found, each of the eight commit blocks ran green with Prettier changing nothing and made its commit with the two trailer lines, and after each of Tasks 1 to 8 the worktree's committed tree matched the scratch commit path for path (873 paths after Task 1, 890 after Task 8). The first attempt stopped at Task 3's lockfile line, whose Expected named the package in backticks; it and Task 4's `verify:freshness` line, which named `activity: null` the same way, were reworded with the prose moved to a paragraph of its own and no directive changed, and the pass reported here ran Tasks 1 and 2 and then 3 to 9 on one worktree, Task 3 started again from Task 2's commit. In it `verify:local` read `384 passed, 4 failed` and then `394 passed, 0 failed`, `verify:freshness` 16 at Tasks 3 and 4, and `verify:indexer` 15. Task 9's ten doc anchors were each found once and its commit changed the five docs, `CLAUDE.md` and `apps/freshness/.env.example` (the acceptance boxes and the landing note are the controller's to write); its check list did not run a second time there, since this planning run was held to one build and the tree it checks matched Task 8's scratch commit, where the list ran. Afterwards the migration was reversed on the local database (its four functions, two helpers and four tables dropped, the airdrops only the indexer recorded deleted, `airdrops` given back its required `sent_by` without `block_time`, both tables' comments restored, its row deleted from `supabase_migrations.schema_migrations`): `pg_dump --schema-only` of `public` and `private` then matched the dump taken before the first script, and the rows of `collections`, `deployments`, `mint_groups`, `whitelist_entries`, `airdrops`, `withdrawals`, `render_jobs`, `tokens`, `uploads` and the users (10, 7, 14, 2,004, 3, 1, 8, 53, 146 and 8) matched a snapshot taken before the first script, so the local database is at the mint page state the plan starts from. Anvil kept running on port 8545 with its factory and was never restarted; the planning runs left their verify collections on it and moved it ahead (each `verify:indexer` run by 1,200 blocks and about 1,200 s, each `verify:freshness` and `verify:mint-page` run by about 600 s). Not run while planning: the browser walk (this planning run started no dev server, so Task 9's walk is its first), anything hosted (`supabase db push`, Railway's two variables), a testnet (each provider's `eth_getLogs` limits, a backfill's pace on Arbitrum, delegated mints) and a reorg.
