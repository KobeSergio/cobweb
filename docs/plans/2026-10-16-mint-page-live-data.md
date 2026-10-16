# Mint Page on Live Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the public mint page on live data, Phase 6's second sub-project. The creator's Mint page tab saves the page's description, banner, avatar, About banner, four links, featured tokens and five sections (team, roadmap, FAQ, music and a carousel) to one `mint_pages` row and the public `mint-page` bucket, previews it at `/<slug>/preview` and makes it public. `/<slug>` renders a published page from one definer read cached under its link's tag, and the browser polls the freshness server for the chain's state at the page's cadence (1 s before the first answer and within 60 s of a start, 3 s otherwise): liveness only from each group's `active`, a chain clock for the labels, the page's own `degraded` after 10 s without an accepted answer, and every refusal in words. A mint is simulated with the state's exact quote and sent as the simulated request through wagmi (`batchMint`, or `delegateMint` for a delegated vault on a whitelist phase); the receipt gives the ids, a mint the page saw land counts once, every failure reads in words with its ways forward, and the success view shows each token's art from its metadata and, once revealed, its rarity tier from ranks the server records. Sample mode keeps rendering every state, with new switches, and `verify:mint-page` proves the page's own code on Anvil, the labels at T-1 and T among its checks.

**Architecture:** The database gains `mint_pages` (one row per collection, written only by its owner within column checks and a guard trigger) and `token_ranks` (a done real job's rarity ranks, written only through `token_ranks_record` by the service role), read publicly only through `mint_page`, `mint_page_preview` and `mint_page_tiers`; the `mint-page` bucket is public. On the server, `lib/mint` holds `media.ts` and `page-doc.ts` (pure: the slots and their caps, the stored sections, the document and what the page renders from it), `page-urls.ts` (the media and gateway URLs and the cache tag, free of Next's modules), `page-read.ts` (the cached public read and the owner's preview), `ranks-core.ts` and `settings-core.ts`, with the four actions in `app/actions/mint-page.ts`. The state and wallet bodies and their paths move to `@cobweb/shared` (`freshness-wire.ts`), so the server and the page read one wire. In the browser, `fresh-client.ts` reads one poll into an answer and folds it into a track with the chain clock and the cadence; `live-data.ts` turns the answers into the page's view; `mint-call.ts`, `mint-run.ts`, `mint-failure.ts` and `wagmi-chain.ts` are the mint; `token-art.ts` and `remind.ts` the art and the calendar. The live source (`live-source.ts`, on the freshness server, wagmi, Supabase and the IPFS gateway) and the sample source (`sample-source.ts`, on `lib/demo`) answer one `MintSource`, which the hooks `use-live-state`, `use-wallet-view` and `use-token-art` and the model on `MintLive` read. The Mint page tab keeps one draft for the row and its sections; the Overview and Deploy read the row. `verify:mint-page` runs the freshness server in process and drives the page's modules without React, minting through the chain fixture's wagmi wallet.

**Tech Stack:** TypeScript 6 strict (ESM, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`) consumed as source; Next 16.3 (App Router, ISR with `revalidate`, `unstable_cache` tags and `updateTag`); React 19 with TanStack Query 5 (`useQuery`, `useQueries`); wagmi 2.19 and RainbowKit for the wallet, `@wagmi/core` 2.22 for the verify; viem 2.57; zod 4; Supabase (Postgres 15, row-level security, `security definer` functions, Storage over its S3 protocol with presigned PUTs); Vitest 5 (Node environment, fake fetches); Node 26 locally, running the verify scripts through type stripping; Anvil through `chain:local`; Prettier 3.

**Spec:** [../specs/2026-10-16-mint-page-live-data.md](../specs/2026-10-16-mint-page-live-data.md)

## Global Constraints

- The spec is the binding authority, its section 14 reconciliations included. Where this plan decides a detail the spec leaves open, or departs from its letter, the decision is collected in the next section and named in the step that carries it.
- Node 26 locally. ESM everywhere. Inside `apps/web/src`, imports are extensionless and use the `@/` alias, as the existing files do. Inside `packages/shared` and `apps/freshness`, relative imports carry the `.ts` extension. Inside `apps/web/scripts`, relative imports carry the `.ts` extension and the app's modules are imported as `../src/...`; the scripts run under `node --conditions=react-server --import ./scripts/resolve-ts.mjs`, which maps `@/`, adds `.ts` and resolves `server-only` to its empty build. Node cannot load `next/cache` or `next/headers` there, so a module a script imports never imports them (`page-urls.ts` exists for that reason). Types are imported with `import type` or an inline `type` specifier.
- Vitest 5, Node environment. One file: `pnpm --filter <package> exec vitest run <file>`, for example `pnpm --filter @cobweb/web exec vitest run src/lib/mint/fresh-client.test.ts`. A fake `fetch` is a plain function cast `as unknown as typeof fetch`; a fake Supabase client is a plain object with the one method the code calls, cast the same way.
- Test fixtures: annotate every fixture constant with its type (`const BASE: Address = ...`, `const page: MintPageStatic = ...`), since an unannotated literal widens and fails `tsc`.
- Prettier: no semicolons, single quotes, trailing commas, 110 columns. Before each commit run `pnpm exec prettier --write <the files you changed>` from the repo root. Never run `pnpm format` or Prettier on `.`. Prettier cannot parse `.sql` or `.toml` files, so never list them. CI runs `pnpm format:check`, so every other file you touch outside `docs/` must be formatted (`docs/`, `contracts/out/` and `packages/ui/src/components/` are in `.prettierignore`). The code blocks in this plan are already formatted; Prettier leaves them as they are.
- typescript-eslint's recommended rules and ESLint's `preserve-caught-error` apply. Do not write `throw new X(...)` directly inside a `catch` block without `{ cause }`. `eslint.config.mjs` is not touched.
- Copy: plain sentences. No em or en dashes anywhere, code, comments, commit messages and docs included. The product is Cobweb; never Kingdomly or realm. Colours come from the theme's tokens, never hex values; UI is built from the shadcn components in `packages/ui` (`@cobweb/ui/components/...`).
- CLAUDE.md rules 1 to 4 bind this sub-project. Liveness is each group's `active` from the freshness server and nothing else: the chain clock only labels countdowns (rule 1). The mint is simulated, and the wallet gets exactly the simulated request (rule 2: `wagmiMintChain`, and the verify through it). The page never calls an RPC for shared state: the state and wallet answers come from the freshness server, and only the visitor's own transaction (the check, the send, the receipt) goes through wagmi's transport (rule 3). The four Mint page actions run through `phasesWrite`, which checks the session and the ownership, and both new tables have row-level security (rule 4).
- Security: no secret reaches the browser. `NEXT_PUBLIC_FRESHNESS_URL` is the one new public variable; `MINT_PAGE_S3_BUCKET`, `MINT_PAGE_MEDIA_URL` and `IPFS_GATEWAY_URL` are server-only. No key or RPC URL is printed, logged or committed; the verify script prints none.
- Never deploy to any remote chain or service, and never pass `--prod` or `--target production` to any command. The only chain any step touches is the local Anvil on port 8545; every script refuses an endpoint that is not localhost. The hosted bucket, variables and `db push` are the owner's (spec section 12).
- The repository is linked to a hosted Supabase project (`supabase/.temp`). Never run `supabase db push`, never pass `--linked` or `--project-ref` to any command, never run `supabase db reset` or `supabase stop`. The only Supabase commands a step runs are `supabase migration up --local`, `supabase seed buckets --local` and `supabase status`.
- `docs/PLAN.md` must not change. `legacy/` is never read into, copied from, imported or committed.
- Docs keep their history: add dated notes and status sentences; never rewrite or delete earlier statements in `docs/MASTER_PLAN.md` or in specs.
- Local services, as the previous sub-project left them: `supabase start` at the repo root has run (the migrations up to `20261016000000_airdrop_settings.sql` are applied; Task 1 applies the new one with `supabase migration up --local`, which keeps the local data, and seeds the new bucket), `supabase seed buckets` has run (the `art` and `render` buckets), and `pnpm --filter @cobweb/web chain:local` is running on port 8545 with its two printed lines (`RPC_URL_31337` and `FACTORY_ADDRESS_31337`, the factory at `0x5FbDB2315678afecb367f032d93F642f64180aa3`) in `apps/web/.env.local`, the factory approving the shipped creation code. `apps/web/.env.local` keeps `NEXT_PUBLIC_DEMO_DATA=1`, so `pnpm build` and `next dev` run sample mode unless a step says otherwise. Task 1 needs Supabase; Task 3's `verify:freshness` needs Anvil alone; Task 9 needs Supabase with the `mint-page` bucket, its local storage and Anvil; Task 10 needs everything, the freshness server and the dev wallet. Tasks 2 and 4 to 8 need nothing running.
- Next's route types live in `apps/web/.next/types`, which `pnpm typecheck` reads and earlier builds wrote. Task 6 adds a route and regenerates them with `next typegen` before it typechecks.
- Dependencies install from the local store: `pnpm install --offline`, so the lockfile resolves exactly as this plan was checked.
- Implementers never use `git commit --amend` or `git stash`. `git rm` is used only where a step says so. To fix a commit, make a new one.
- Before every commit, at the repo root: `pnpm exec prettier --write <the files you changed>`, then `pnpm typecheck && pnpm lint && pnpm test`.
- Commit messages are one plain imperative sentence with no prefix, then a blank line, and end with exactly these two lines:

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
```

## Decisions

1. Decision (spec sections 4 to 11): ten tasks. The mint page row, the ranks and the public reads with the bucket and `verify:local`'s section 9n (1); the server's media, document, reads, ranks and the four actions (2); the wire types in the shared package (3); the freshness client and the mint's pure modules, the call, the run, the failures, the wagmi chain and token art (4); the page's state model and the page on live data, the mint flow with delegated minting included (5); the sections, Remind me, the music button, the owner's preview and the rarity spot (6); the Mint page tab, the Overview and Deploy (7); sample mode's new switches (8); the chain fixture's wagmi wallet and `verify:mint-page` with `CLAUDE.md` (9); the whole check list, the browser walk and the docs (10, the controller's). The mint's pure modules come with the freshness client in Task 4, before the page, since the live page's mint path needs them.
2. Decision (sections 6.4 and 8): `/[slug]` reads no query. A route that awaits `searchParams` is dynamic, and a sample build of the cached route answered 500 (`DYNAMIC_SERVER_USAGE`) under `next start` once it did, so sample mode reads its switches in the browser: `SampleMintPage` takes them from its own location and shows the skeleton until then. Both builds list `● /[slug]`. The spec writes "Sample mode is per request, as today" (Task 5).
3. Decision (section 11): `turbo.json` is not touched. Turborepo infers `NEXT_PUBLIC_` variables for a Next.js app (`turbo run build --dry=json` lists `NEXT_PUBLIC_FRESHNESS_URL` under `inferred`, and the build's hash changes with its value), and the build inlines it in the client chunks. The spec writes that `turbo.json` gains it.
4. Decision (section 6.2): a save writes the row in two steps, an insert that ignores the existing row and then the update (`writeRow`). PostgREST's merge upsert sends `ON CONFLICT DO UPDATE` over every column the body names, `collection_id` included, which the column grants refuse with 42501 (checked on the local database) (Task 2).
5. Decision (section 4.1): the migration grants `usage on schema private` to `service_role`, which has none by default, so the helpers the spec grants it can run when the service role writes a row (Task 1).
6. Decision (section 6.1): `mintPageTag`, `mediaBase`, `mediaUrl` and `ipfsGateway` live in `page-urls.ts`, which imports no Next module, and `page-read.ts` re-exports them; the settings core and `verify:mint-page` import `page-urls.ts`, since Node cannot load `next/cache` under the scripts' loader. The spec places them in `page-read.ts` (Task 2).
7. Decision (section 7.1): `POLL_TIMEOUT_MS` is 5 s. A poll that has not answered by then counts as a network failure, so a request stuck at the edge never stops the polls (Task 4, Review Focus 1).
8. Decision (sections 6.1 and 7.8): `readMintPagePreview` answers the collection's id beside the page, for the preview banner's link back to the tab, and null for a signed-out visitor before any read: `mint_page_preview` is granted to signed-in callers only, so a signed-out call is refused rather than answered null, and the preview would fail instead of showing the not-found page (Task 6).
9. Decision (section 6.3): the ranks are taken over the collection's `tokens` rows. `art_lock` stores a `token_list` for 1/1 and single-asset jobs only, and none for a generative job, whose list is its `tokens` rows: the lock checks them against the job's hash and keeps them, and the worker renders them. The spec writes "reads the job's `token_list`" (Task 2).
10. Decision (sections 4.4 and 7.3): `mintPageMediaProblem` refuses an avatar whose size is unknown; before the first answer the panel reads "Reading the chain", and a `slow` refusal says the page keeps trying; the sample page is revealed by default, and `?art=placeholder` shows it before the reveal (Tasks 2, 5 and 8).
11. Decision (section 10): in `verify:mint-page` the freshness server listens on 127.0.0.1 as in `verify:freshness`. "Another creator's save is refused as not found" is checked as the action checks it (the stranger's `readLockCollection` and owner test answer `NOT_FOUND`), then through the core with a forged context (refused as not deployed, since the stranger cannot read the deployment) and as a raw update (the row unchanged). Check 8 waits up to one idle tick (20 s) and one 3 s poll for the block at T-1, since nothing is live and the start is 600 s away until the server reads it; checks 12 and 13 wait one 2 s tick, one 3 s poll and 3 s for the reads (Task 9).
12. Decision (section 7.7): on wide screens each featured token takes its share of a wall of six, so a page that features fewer keeps the cards' sizes instead of stretching them across the row (seen in the browser with two featured tokens) (Task 5).
13. Decision (section 10): `@wagmi/core` 2.22.1, the version wagmi 2.19.5 resolves, joins the web app's dev dependencies; `pnpm install --offline` adds only the web importer's entry to the lockfile (Task 9).
14. Decision (section 10): two tests beyond the spec's list for the Review Focus: a poll that hangs (`fresh-client.test.ts`) and the tiers' 20 ids in a new `live-source.test.ts` (Tasks 4 and 6).

## Review Focus

Inputs and failure modes the spec implies but its own test list would not exercise, most likely to bite on mint day first. Each is pinned to a test in the task that owns the code.

1. A poll that never answers (a connection stuck at the edge in the first minute of a mint). Without a time limit the page would wait on it forever, never poll again and keep reading "Starts in" after the phase opened. The request is abandoned after `POLL_TIMEOUT_MS` (5 s) and counts as a network failure, so the next poll comes at the retry's cadence. Pinned by "abandons a poll that has not answered after 5 s as a network failure, so the polls go on (Review Focus 1)" (Task 4, `fresh-client.test.ts`).
2. A wallet answer for another wallet (the visitor switches accounts while a wallet request is in flight). Taken as the new account's, it would show another wallet's quotas, "You are on this list" for an unlisted wallet, and the check would fail. A body whose `wallet` is not the one asked for is a failed poll. Pinned by "asks with both addresses in lowercase and reads the body for that wallet only, an answer for another wallet being a failed poll (Review Focus 2)" (Task 4, `fresh-client.test.ts`).
3. A check that finds the group inactive when the page reads it live (the wallet's RPC a block behind the freshness server at T). The spec retries once after the next answer; a loop would simulate again and again on a busy RPC, and a retry when the page does not read the group live would hide a real "phase closed". Pinned by "does not check again when the group does not read live, nor more than once (Review Focus 3)" (Task 4, `mint-run.test.ts`).
4. A delegated mint (a vault's allowance used through `delegateMint`). Counted against the wallet's own allowance, the page would read "Wallet limit reached" for the wallet and leave the vault's spent quota looking free until the next wallet answer. The local mint is held by the vault and counts toward the vault's allowance only. Pinned by "count a vault's mint toward the vault's allowance, not the wallet's (Review Focus 4)" (Task 5, `model.test.ts`).
5. A mint of more than 20 tokens. `mint_page_tiers` answers null for more than 20 ids, so asking for all of them would show no rarity at all on the biggest mints; the source asks for the first 20. Pinned by "asks for the first 20 ids of a larger mint, which the function answers, never 21 (Review Focus 5)" (Task 6, `live-source.test.ts`).

## File map

| Path | Task | Responsibility |
| --- | --- | --- |
| `supabase/migrations/20261016100000_mint_page.sql`, `supabase/config.toml` | 1 | `mint_pages`, `token_ranks`, the guard, the three reads and `token_ranks_record`; the `mint-page` bucket |
| `apps/web/src/lib/database.types.ts`, `apps/web/scripts/verify-local.ts` | 1 | The new tables' and functions' types; the anon checks and section 9n |
| `apps/web/src/lib/storage/objects.ts`, `config.ts` | 2 | A bucket option on the object helpers; `mintPageBucket` |
| `apps/web/src/lib/mint/media.ts`, `page-doc.ts`, `page-urls.ts`, `page-read.ts`, `ranks-core.ts`, `settings-core.ts` and the tests of the first three | 2 | The slots and keys, the stored sections and the document, the URLs and the tag, the reads, the ranks, the tab's server side |
| `apps/web/src/app/actions/mint-page.ts`, `settings.ts`, `mint-page-address.ts`, `apps/web/src/lib/art/result.ts`, `apps/web/src/lib/manage/phases-types.ts`, `phases-view.ts`, `apps/web/.env.example` | 2 | The four actions; the reveal's ranks; the link's tag; the sentences; `PhaseRow`; the server's variables |
| `packages/shared/src/freshness-wire.ts`, `freshness-wire.test.ts`, `index.ts`; `apps/freshness/src/state-body.ts`, `wallet.ts`, `routes.ts`, `routes.test.ts` | 3 | `StateBody`, `WalletBody`, `statePath`, `walletPath` shared by the server and the page |
| `apps/web/src/lib/mint/fresh-client.ts`, `live-data.ts`, `mint-call.ts`, `mint-failure.ts`, `mint-run.ts`, `wagmi-chain.ts`, `token-art.ts` and their tests | 4 | The polls and the track, the page's view of the answers, the mint, its failures, token art |
| `apps/web/src/lib/manage/settings-view.ts`, `apps/web/src/lib/wagmi.ts`, `apps/web/src/components/deploy/tx-errors.ts` and two tests | 4 | `tokenUriOf` by id; a transport per chain; the cause chain's readers exported |
| `apps/web/src/lib/mint/live-source.ts`, `apps/web/src/components/mint/model.ts`, `model.test.ts`, `use-live-state.ts`, `use-wallet-view.ts`, `use-token-art.ts`, `sample-source.ts`, `sample-source.test.ts`, `sample-page.tsx`, `mint-context.tsx`, `use-mint-flow.ts`, `types.ts` | 5 | The sources, the hooks, the model, the context and the flow on live data |
| `apps/web/src/components/mint/*.tsx` (the page's components), `apps/web/src/app/[slug]/page.tsx`, `sample-data.ts`; `mint-transaction.ts` removed | 5 | The page on the model; the route cached by link |
| `apps/web/src/lib/mint/remind.ts`, `remind.test.ts`, `live-source.test.ts`, `apps/web/src/components/mint/remind-me.tsx`, `page-sections.tsx`, `music-button.tsx`, `preview-banner.tsx`, `apps/web/src/app/[slug]/preview/page.tsx` | 6 | Remind me, the sections, the music, the preview; the tiers |
| `apps/web/src/components/manage/mint-page-draft.ts`, `mint-page-draft.test.ts`, `mint-page-*.tsx`, `manage-sim.ts`, `overview-cards.tsx`, `overview-screen.tsx`, the tab's and the Overview's routes, `apps/web/src/components/deploy/deployed-view.tsx`, `deploy-flow.tsx`, `deploy-screen.tsx`, the deploy route | 7 | The tab's one draft and its save; the Overview and Deploy on the row |
| `apps/web/src/components/mint/sample-source.ts`, `sample-source.test.ts`, `sample-page.tsx` | 8 | `?refusal=`, `?art=`, `?type=` and every `?fail=` kind |
| `apps/web/scripts/chain-fixture.ts`, `verify-mint-page.ts`, `apps/web/package.json`, `pnpm-lock.yaml`, `CLAUDE.md` | 9 | The wagmi wallet; `verify:mint-page` (17 checks); its dev dependency and command |
| `docs/MASTER_PLAN.md`, `docs/specs/2026-10-16-mint-page-live-data.md`, `2026-10-03-creator-flow-ui.md`, `2026-10-14-deploy.md`, `2026-10-16-freshness-server.md` | 10 | The Phase 6 status line and the decision, the acceptance boxes and the landing note, the dated notes |

---

### Task 1: The mint page row, the ranks and the public reads, with the bucket and `verify:local`'s section 9n

**Files:**

- Create: `supabase/migrations/20261016100000_mint_page.sql`
- Modify: `supabase/config.toml` (one bucket block), `apps/web/src/lib/database.types.ts` (four blocks), `apps/web/scripts/verify-local.ts` (the anon loop, section 9n and its call)
- Test: `pnpm --filter @cobweb/web verify:local`

**Interfaces:**

- Consumes: `private.collection_owned(uuid)` and `private.lock_owned_collection(uuid, uuid)` from the earlier migrations; `collections` (`status`, `slug`, `owner_id`, `project_type`, `description`), `deployments` (`base_uri` at deploy), `mint_groups` (`onchain_id`, `name`, `description`, `visible`, `position`), `render_jobs` (`kind`, `state`, `base_uri`, `token_count`); `verify-local.ts`'s fixtures (`check`, `expectNothing`, `expectError`, `renderedFixture`, `deferredFixture`, `recordArgs`, `recordedArgs`, the A and B clients, `admin`, `anon`).
- Produces:
  - `public.mint_pages` (`collection_id` primary key, cascading from `collections`; `published`, `published_at`; `description` up to 2,000 characters; `banner_key`, `avatar_key`, `about_banner_key`; `website_url`, `x_url`, `discord_url`, `telegram_url`, https on their hosts and up to 200 characters; `featured_token_ids` up to six distinct ids from 1; `sections` jsonb up to 64 KB whose keys are the collection's; `updated_at`), with the owner's select, insert and update policies, grants on the editable columns only, and the `mint_pages_guard` trigger (publishing needs a deployed collection with a link and stamps `published_at`; every write stamps `updated_at`)
  - `public.token_ranks` (`job_id` primary key, cascading from `render_jobs`; `ranks integer[]`; `created_at`), the owner's select only
  - `public.mint_page(p_slug text) returns jsonb` (anon and authenticated: the document of a deployed collection whose page is published, else null); `public.mint_page_preview(p_slug text) returns jsonb` (authenticated: the same document for the collection's owner, published or not); `public.mint_page_tiers(p_slug text, p_base_uri text, p_ids integer[]) returns jsonb` (anon and authenticated: `{ "total": n, "ranks": { "<id>": rank } }` for 1 to 20 ids at the latest done real job's base URI of a published generative collection, else null); `public.token_ranks_record(p_collection_id uuid, p_owner uuid, p_job_id uuid, p_ranks integer[]) returns boolean` (service role: records a permutation of 1 to the job's token count once)
  - the document `{ slug, name, symbol, projectType, chainId, contract, description, media: { banner, avatar, aboutBanner }, socials: { website, x, discord, telegram }, featuredTokenIds, sections, phases: [{ id, name, description, visible, position }], placeholders, published }`, built by `private.mint_page_document(uuid)`
  - the `mint-page` bucket: public, 20 MiB per file, PNG, JPEG, WebP, GIF, MP4 and MP3
  - in `database.types.ts`: the two tables' `Row`, `Insert` and `Update` types and the four functions' `Args` and `Returns`

- [ ] **Step 1: Write the failing checks**

The anon loop gains the two tables, and section 9n runs after the airdrop and settings section on a collection recorded as deployed as section 9k records one, beside a draft.

In `apps/web/scripts/verify-local.ts`, replace:

```ts
    'airdrops',
    'withdrawals',
  ]) {
    await check(`anon: reads nothing from ${table}`, async () => {
```

with:

```ts
    'airdrops',
    'withdrawals',
    'mint_pages',
    'token_ranks',
  ]) {
    await check(`anon: reads nothing from ${table}`, async () => {
```

In `apps/web/scripts/verify-local.ts`, replace:

```ts
  await artWhitelist(A, B)
  await artAirdropSettings(A, B)
}

```

with:

```ts
  await artWhitelist(A, B)
  await artAirdropSettings(A, B)
  await artMintPage(A, B)
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
// 9n. The mint page: mint_pages with its checks, grants and trigger, token_ranks with token_ranks_record, and
// the public reads mint_page, mint_page_preview and mint_page_tiers
// (docs/specs/2026-10-16-mint-page-live-data.md, section 4)
// ---------------------------------------------------------------------------------------------
type PageCheckRow = { published: boolean; published_at: string | null; description: string }

async function pageRow(cid: string): Promise<PageCheckRow | null> {
  const { data, error } = await admin
    .from('mint_pages')
    .select('published, published_at, description')
    .eq('collection_id', cid)
    .maybeSingle()
  if (error) throw new Error(`mint page: ${describe(error as DbError)}`)
  return data as PageCheckRow | null
}

/** A key of the mint-page bucket under a collection: `<collection id>/<64 hex>.<ext>`. */
const PAGE_KEY = (cid: string, n: number, ext = 'png') => `${cid}/${HEX64(0xa000 + n)}.${ext}`
const PAGE_SENTENCE = 'A mint page goes public once its contract is deployed and it has a link.'
/** JSON with every object's keys sorted, since jsonb answers its keys in its own order. */
const sortedJson = (value: unknown) =>
  JSON.stringify(value, (_key, entry: unknown) =>
    entry && typeof entry === 'object' && !Array.isArray(entry)
      ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => (a < b ? -1 : 1)))
      : entry,
  )
const RANK_SENTENCE = 'The rendered set could not be ranked.'
/** The deployment's constructor as collection_record_deploy stores it, with the deploy-time base URI. */
const recordedArgs = (baseUri: string) => ({
  name: 'Verify',
  symbol: 'VFY',
  maxSupply: '3',
  groupSupplies: ['2', '1'],
  groupPrices: ['0', '1000000000000000'],
  baseUri,
})

async function artMintPage(A: Creator, B: Creator): Promise<void> {
  const payer = A.account.address.toLowerCase()
  const realUri = `ipfs://${CID('e')}/`
  const placeholderUri = `ipfs://${CID('q')}/metadata.json`
  const deployUri = `ipfs://${CID('p')}/metadata.json`
  // Rendered and recorded as deployed on the real set, as 9k records one, with a fee that can be searched for.
  const { cid, jobId } = await renderedFixture(A, payer, 181)
  const recorded = await callArt(
    admin,
    'collection_record_deploy',
    recordArgs(A.userId, cid, payer, 14, {
      p_args: recordedArgs(realUri),
      p_mint_fee_flat_wei: '123456789123',
    }),
  )
  if (recorded.error) throw new Error(`setup: record: ${describe(recorded.error)}`)
  const deployedRow = await stored(cid)
  const pageSlug = deployedRow?.slug
  if (!deployedRow || !pageSlug) throw new Error('setup: the deployed collection has no link')
  // A collection that finished its art later, deployed on an earlier placeholder than its latest done one.
  const deferred = await deferredFixture(A)
  const deferredRecord = await callArt(
    admin,
    'collection_record_deploy',
    recordArgs(A.userId, deferred.cid, payer, 15, { p_base_uri: deployUri, p_args: recordedArgs(deployUri) }),
  )
  if (deferredRecord.error) throw new Error(`setup: deferred record: ${describe(deferredRecord.error)}`)
  const deferredSlug = (await stored(deferred.cid))?.slug
  if (!deferredSlug) throw new Error('setup: the deferred collection has no link')
  // A draft with a link, and a collection marked deployed without one.
  const draft = await insertCollection(A.client)
  if (!draft.row) throw new Error(`setup: ${describe(draft.error)}`)
  const draftId = draft.row.id
  const draftSlug = slug()
  const draftLink = await reserve(A.client, draftId, draftSlug)
  if (draftLink) throw new Error(`setup: draft link: ${describe(draftLink)}`)
  const bare = await insertCollection(A.client)
  if (!bare.row) throw new Error(`setup: ${describe(bare.error)}`)
  const bareId = bare.row.id
  const bareSet = await admin
    .from('collections')
    .update({ status: 'deployed', max_supply: 3, chain_id: 31337, contract_address: ADDRESS40(0xb0b) })
    .eq('id', bareId)
  if (bareSet.error) throw new Error(`setup: bare: ${describe(bareSet.error as DbError)}`)
  // A listed wallet the document must never carry.
  const listedWallet = ADDRESS40(0x11573d)
  const holders = await groupRowId(cid, 1)
  const listed = await A.client
    .from('whitelist_entries')
    .insert({ mint_group_id: holders, collection_id: cid, wallet_address: listedWallet, quota: 2 })
  if (listed.error) throw new Error(`setup: whitelist: ${describe(listed.error as DbError)}`)

  const page = (client: SupabaseClient, patch: Record<string, unknown>, at = cid) =>
    client.from('mint_pages').update(patch).eq('collection_id', at).select()
  const read = async (client: SupabaseClient, fn: string, slugText: string) => {
    const { data, error } = await client.rpc(fn, { p_slug: slugText })
    return { doc: data as Record<string, unknown> | null, error: error as DbError }
  }
  const tiers = async (client: SupabaseClient, baseUri: string, ids: number[], at = pageSlug) => {
    const { data, error } = await client.rpc('mint_page_tiers', {
      p_slug: at,
      p_base_uri: baseUri,
      p_ids: ids,
    })
    if (error) throw new Error(`mint_page_tiers: ${describe(error as DbError)}`)
    return data as { total: number; ranks: Record<string, number> } | null
  }
  const rank = (client: SupabaseClient, overrides: Record<string, unknown> = {}) =>
    callArt(client, 'token_ranks_record', {
      p_collection_id: cid,
      p_owner: A.userId,
      p_job_id: jobId,
      p_ranks: [2, 3, 1],
      ...overrides,
    })

  await check(
    'mint_pages: the owner inserts and reads its row; B reads nothing and cannot insert, update or publish it',
    async () => {
      const inserted = await A.client.from('mint_pages').insert({ collection_id: cid }).select()
      if (inserted.error) return `insert: ${describe(inserted.error as DbError)}`
      const own = await A.client.from('mint_pages').select('collection_id').eq('collection_id', cid)
      if (own.error || own.data.length !== 1)
        return `A reads ${own.data?.length ?? describe(own.error as DbError)}`
      const problems: string[] = []
      const other = await B.client.from('mint_pages').select().eq('collection_id', cid)
      const unseen = expectNothing(other.error as DbError, other.data)
      if (unseen) problems.push(`B reads: ${unseen}`)
      const foreign = await B.client.from('mint_pages').insert({ collection_id: bareId }).select()
      const refused = expectError(foreign.error as DbError, PERMISSION, foreign.data)
      if (refused) problems.push(`B inserts: ${refused}`)
      for (const [label, patch] of [
        ['update', { description: 'Taken over' }],
        ['publish', { published: true }],
      ] as const) {
        const changed = await page(B.client, patch)
        const nothing = expectNothing(changed.error as DbError, changed.data)
        if (nothing) problems.push(`B ${label}: ${nothing}`)
      }
      if (problems.length) return problems.join('; ')
      const row = await pageRow(cid)
      return row?.published === false && row.description === '' ? null : JSON.stringify(row)
    },
  )

  await check(
    "mint_pages: a description over 2,000 characters, an http link, an X link on another host, a 201-character link, seven featured ids, a repeated or zero id, a key outside the collection or of another shape, and sections over 64 KB or naming another collection's key are refused",
    async () => {
      const problems: string[] = []
      for (const [label, patch] of [
        ['2,001 characters', { description: 'd'.repeat(2001) }],
        ['http link', { website_url: 'http://example.com' }],
        ['X on another host', { x_url: 'https://example.com/owls' }],
        ['201 characters', { website_url: `https://example.com/${'a'.repeat(181)}` }],
        ['seven ids', { featured_token_ids: [1, 2, 3, 4, 5, 6, 7] }],
        ['a repeated id', { featured_token_ids: [2, 2] }],
        ['id 0', { featured_token_ids: [0] }],
        ["another collection's key", { banner_key: PAGE_KEY(draftId, 1) }],
        ['an SVG key', { avatar_key: `${cid}/${HEX64(0xa001)}.svg` }],
        ['a short hash', { about_banner_key: `${cid}/abc.png` }],
        ['over 64 KB', { sections: { faq: { enabled: true, items: [] }, note: 'x'.repeat(65_600) } }],
        [
          "another collection's key in sections",
          { sections: { team: { enabled: true, members: [{ imageKey: PAGE_KEY(draftId, 2) }] } } },
        ],
      ] as const) {
        const changed = await page(A.client, patch)
        const problem = expectError(changed.error as DbError, CHECK, changed.data)
        if (problem) problems.push(`${label}: ${problem}`)
      }
      if (problems.length) return problems.join('; ')
      const row = await pageRow(cid)
      return row?.description === '' ? null : JSON.stringify(row)
    },
  )

  await check(
    'mint_pages: publishing a draft, or a deployed collection without a link, is refused; publishing a deployed collection with a link sets published_at',
    async () => {
      const problems: string[] = []
      for (const [label, at] of [
        ['a draft', draftId],
        ['no link', bareId],
      ] as const) {
        const inserted = await A.client
          .from('mint_pages')
          .insert({ collection_id: at, published: true })
          .select()
        const problem = expectSentence(inserted.error as DbError, CHECK, PAGE_SENTENCE)
        if (problem) problems.push(`${label}: ${problem}`)
      }
      const unpublishedDraft = await A.client.from('mint_pages').insert({ collection_id: draftId }).select()
      if (unpublishedDraft.error)
        problems.push(`the draft's row: ${describe(unpublishedDraft.error as DbError)}`)
      const draftPublish = await page(A.client, { published: true }, draftId)
      const draftRefused = expectSentence(draftPublish.error as DbError, CHECK, PAGE_SENTENCE)
      if (draftRefused) problems.push(`publishing the draft's row: ${draftRefused}`)
      if (problems.length) return problems.join('; ')
      const before = Date.now()
      const published = await page(A.client, { published: true })
      if (published.error) return `publish: ${describe(published.error as DbError)}`
      const row = await pageRow(cid)
      const at = row?.published_at ? Date.parse(row.published_at) : 0
      return row?.published && Math.abs(at - before) < 60_000 ? null : JSON.stringify(row)
    },
  )

  await check(
    'mint_pages: the owner cannot set published_at or updated_at, and cannot delete the row',
    async () => {
      const problems: string[] = []
      for (const [label, patch] of [
        ['published_at', { published_at: '2020-01-01T00:00:00Z' }],
        ['updated_at', { updated_at: '2020-01-01T00:00:00Z' }],
      ] as const) {
        const changed = await page(A.client, patch)
        const problem = expectError(changed.error as DbError, PERMISSION, changed.data)
        if (problem) problems.push(`${label}: ${problem}`)
      }
      const removed = await A.client.from('mint_pages').delete().eq('collection_id', cid).select()
      const kept = expectError(removed.error as DbError, PERMISSION, removed.data)
      if (kept) problems.push(`delete: ${kept}`)
      if (problems.length) return problems.join('; ')
      const row = await pageRow(cid)
      return row?.published && row.published_at && !row.published_at.startsWith('2020')
        ? null
        : JSON.stringify(row)
    },
  )

  // The page's fields, Holders moved before Public, and a description on the deferred collection itself.
  const saved = await page(A.client, {
    description: 'From the page',
    banner_key: PAGE_KEY(cid, 1),
    about_banner_key: PAGE_KEY(cid, 2, 'jpg'),
    website_url: 'https://example.com/owls',
    x_url: 'https://x.com/owls',
    discord_url: 'https://discord.gg/owls',
    telegram_url: 'https://t.me/owls',
    featured_token_ids: [2, 1],
    sections: { music: { enabled: true, key: PAGE_KEY(cid, 3, 'mp3'), fileName: 'theme.mp3' } },
  })
  if (saved.error) throw new Error(`setup: page: ${describe(saved.error as DbError)}`)
  const moved = await callArt(A.client, 'mint_group_move', {
    p_collection_id: cid,
    p_onchain_id: 1,
    p_up: true,
  })
  if (moved.error) throw new Error(`setup: move: ${describe(moved.error)}`)
  const described = await A.client
    .from('collections')
    .update({ description: 'Owls who keep odd hours.' })
    .eq('id', deferred.cid)
  if (described.error) throw new Error(`setup: description: ${describe(described.error as DbError)}`)
  const deferredPage = await A.client.from('mint_pages').insert({ collection_id: deferred.cid }).select()
  if (deferredPage.error) throw new Error(`setup: deferred page: ${describe(deferredPage.error as DbError)}`)

  await check(
    'mint_page: anon and B read the published document by its link in any case, and null for an unpublished page, a draft and an unknown link',
    async () => {
      const problems: string[] = []
      for (const [label, client] of [
        ['anon', anon],
        ['B', B.client],
      ] as const) {
        const published = await read(client, 'mint_page', pageSlug.toUpperCase())
        if (published.error || published.doc?.slug !== pageSlug)
          problems.push(
            `${label} published: ${published.error ? describe(published.error) : JSON.stringify(published.doc)}`,
          )
        for (const [what, at] of [
          ['unpublished', deferredSlug],
          ['draft', draftSlug],
          ['unknown', `no-such-${runId}`],
        ] as const) {
          const missing = await read(client, 'mint_page', at)
          if (missing.error || missing.doc !== null)
            problems.push(
              `${label} ${what}: ${missing.error ? describe(missing.error) : JSON.stringify(missing.doc)}`,
            )
        }
      }
      return problems.length ? problems.join('; ') : null
    },
  )

  await check(
    "mint_page: the document has the page's fields and the phases by position, an empty description reads the collection's, and it holds no owner id, payout, transaction, fee, CID, real base URI or whitelist entry",
    async () => {
      const { doc, error } = await read(anon, 'mint_page', pageSlug)
      if (error || !doc) return error ? describe(error) : 'no document'
      const want = {
        slug: pageSlug,
        name: deployedRow.name,
        symbol: 'VFY',
        projectType: 'generative',
        chainId: 31337,
        contract: ADDRESS40(14),
        description: 'From the page',
        media: { banner: PAGE_KEY(cid, 1), avatar: null, aboutBanner: PAGE_KEY(cid, 2, 'jpg') },
        socials: {
          website: 'https://example.com/owls',
          x: 'https://x.com/owls',
          discord: 'https://discord.gg/owls',
          telegram: 'https://t.me/owls',
        },
        featuredTokenIds: [2, 1],
        sections: { music: { enabled: true, key: PAGE_KEY(cid, 3, 'mp3'), fileName: 'theme.mp3' } },
        phases: [
          { id: 1, name: 'Holders', description: '', visible: true, position: 0 },
          { id: 0, name: 'Public', description: '', visible: true, position: 1 },
        ],
        placeholders: [],
        published: true,
      }
      const got = Object.fromEntries(Object.keys(want).map((key) => [key, doc[key]]))
      if (sortedJson(got) !== sortedJson(want)) return `document ${JSON.stringify(doc)}`
      const extra = Object.keys(doc).filter((key) => !(key in want))
      if (extra.length) return `extra keys: ${extra.join(', ')}`
      const text = JSON.stringify(doc)
      const leaked = [
        A.userId,
        payer,
        `0x${HEX64(2014)}`,
        '123456789123',
        CID('d'),
        CID('e'),
        listedWallet,
      ].filter((value) => text.includes(value))
      if (leaked.length) return `holds ${leaked.join(', ')}`
      const empty = await read(A.client, 'mint_page_preview', deferredSlug)
      return empty.doc?.description === 'Owls who keep odd hours.'
        ? null
        : `empty description: ${JSON.stringify(empty.doc?.description)}`
    },
  )

  await check(
    "mint_page: placeholders hold the placeholder job's and the deploy-time base URIs, never the real job's",
    async () => {
      const { doc, error } = await read(A.client, 'mint_page_preview', deferredSlug)
      if (error || !doc) return error ? describe(error) : 'no document'
      const placeholders = JSON.stringify(doc.placeholders)
      if (placeholders !== JSON.stringify([deployUri, placeholderUri])) return `deferred: ${placeholders}`
      const real = await read(anon, 'mint_page', pageSlug)
      return JSON.stringify(real.doc?.placeholders) === '[]'
        ? null
        : `deployed on the real set: ${JSON.stringify(real.doc?.placeholders)}`
    },
  )

  await check(
    'mint_page_preview: the owner reads the unpublished document; B and anon read null',
    async () => {
      const own = await read(A.client, 'mint_page_preview', deferredSlug)
      if (own.error || own.doc?.slug !== deferredSlug || own.doc.published !== false)
        return `owner: ${own.error ? describe(own.error) : JSON.stringify(own.doc)}`
      const other = await read(B.client, 'mint_page_preview', deferredSlug)
      if (other.error || other.doc !== null)
        return `B: ${other.error ? describe(other.error) : JSON.stringify(other.doc)}`
      const signedOut = await read(anon, 'mint_page_preview', deferredSlug)
      return signedOut.doc === null ? null : `anon: ${JSON.stringify(signedOut.doc)}`
    },
  )

  await check(
    "token_ranks_record: a signed-out caller and the owner's session cannot execute it; the service role records a permutation for the done real job and answers true, a second record false",
    async () => {
      const problems: string[] = []
      for (const [label, client] of [
        ['anon', anon],
        ['owner', A.client],
      ] as const) {
        const { error } = await rank(client)
        const problem = expectError(error, PERMISSION)
        if (problem) problems.push(`${label}: ${problem}`)
      }
      if (problems.length) return problems.join('; ')
      const first = await rank(admin)
      if (first.error || first.data !== true)
        return `first: ${first.error ? describe(first.error) : String(first.data)}`
      const second = await rank(admin, { p_ranks: [1, 2, 3] })
      if (second.error || second.data !== false)
        return `second: ${second.error ? describe(second.error) : String(second.data)}`
      const { data } = await admin.from('token_ranks').select('ranks').eq('job_id', jobId).single()
      return JSON.stringify(data?.ranks) === '[2,3,1]' ? null : JSON.stringify(data)
    },
  )

  await check(
    "token_ranks_record: a placeholder job, another collection's job, a wrong length and a repeated rank are refused",
    async () => {
      const problems: string[] = []
      for (const [label, overrides] of [
        ['a placeholder job', { p_collection_id: deferred.cid, p_job_id: deferred.jobId, p_ranks: [1] }],
        ["another collection's job", { p_job_id: deferred.jobId }],
        ['a wrong length', { p_ranks: [1, 2] }],
        ['a repeated rank', { p_ranks: [1, 1, 2] }],
      ] as const) {
        const { error } = await rank(admin, overrides)
        const problem = expectSentence(error, CHECK, RANK_SENTENCE)
        if (problem) problems.push(`${label}: ${problem}`)
      }
      return problems.length ? problems.join('; ') : null
    },
  )

  await check(
    "token_ranks: the owner reads its job's row; B and anon read nothing; no client writes it",
    async () => {
      const own = await A.client.from('token_ranks').select('ranks').eq('job_id', jobId)
      if (own.error || JSON.stringify(own.data) !== JSON.stringify([{ ranks: [2, 3, 1] }]))
        return `owner: ${own.error ? describe(own.error as DbError) : JSON.stringify(own.data)}`
      const problems: string[] = []
      for (const [label, client] of [
        ['B', B.client],
        ['anon', anon],
      ] as const) {
        const { data, error } = await client.from('token_ranks').select()
        const problem = expectNothing(error as DbError, data)
        if (problem) problems.push(`${label}: ${problem}`)
      }
      for (const [label, result] of [
        [
          'insert',
          await A.client
            .from('token_ranks')
            .insert({ job_id: deferred.jobId, ranks: [1] })
            .select(),
        ],
        [
          'update',
          await A.client
            .from('token_ranks')
            .update({ ranks: [1, 2, 3] })
            .eq('job_id', jobId)
            .select(),
        ],
        ['delete', await A.client.from('token_ranks').delete().eq('job_id', jobId).select()],
      ] as const) {
        const problem = expectError(result.error as DbError, PERMISSION, result.data)
        if (problem) problems.push(`owner ${label}: ${problem}`)
      }
      return problems.length ? problems.join('; ') : null
    },
  )

  await check(
    'mint_page_tiers: up to 20 ids at the real base URI of a published generative collection; null for another base URI, an unpublished page, 21 ids or no ranks',
    async () => {
      const ranked = await tiers(anon, realUri, [1, 2, 3, 4])
      if (JSON.stringify(ranked) !== JSON.stringify({ ranks: { '1': 2, '2': 3, '3': 1 }, total: 3 }))
        return `ranked: ${JSON.stringify(ranked)}`
      const problems: string[] = []
      if ((await tiers(anon, placeholderUri, [1])) !== null) problems.push('another base URI')
      if (
        (await tiers(
          anon,
          realUri,
          Array.from({ length: 21 }, (_, index) => index + 1),
        )) !== null
      )
        problems.push('21 ids')
      const hidden = await page(A.client, { published: false })
      if (hidden.error) return `unpublish: ${describe(hidden.error as DbError)}`
      if ((await tiers(anon, realUri, [1])) !== null) problems.push('an unpublished page')
      const shown = await page(A.client, { published: true })
      if (shown.error) return `publish again: ${describe(shown.error as DbError)}`
      const dropped = await admin.from('token_ranks').delete().eq('job_id', jobId)
      if (dropped.error) return `drop the ranks: ${describe(dropped.error as DbError)}`
      if ((await tiers(anon, realUri, [1])) !== null) problems.push('no ranks')
      const again = await rank(admin)
      if (again.error || again.data !== true) return `record again: ${String(again.data)}`
      return problems.length ? problems.join('; ') : null
    },
  )
}

// ---------------------------------------------------------------------------------------------
// 10. Cleanup
// ---------------------------------------------------------------------------------------------
```

- [ ] **Step 2: Run the checks to see them fail**

Run: `pnpm --filter @cobweb/web verify:local`
Expected: FAIL. The two anon checks pass (an unknown table reads nothing), the first four checks of section 9n fail on the missing table, and its setup stops the run: the output ends `FAIL run: setup: page: PGRST205 Could not find the table 'public.mint_pages' in the schema cache` and `367 passed, 5 failed`.

- [ ] **Step 3: The migration and the bucket**

The checks run as the writer, so the helpers are granted to the roles that write, and the service role is given the private schema's usage it lacked (Decision 5).

Create `supabase/migrations/20261016100000_mint_page.sql`:

```sql
-- The mint page on live data (docs/specs/2026-10-16-mint-page-live-data.md, section 4): mint_pages, one row per
-- collection that its owner writes under row-level security with grants on the editable columns, checked by three
-- helpers and stamped by a trigger; token_ranks, the rarity ranks of a done real job, written only by
-- token_ranks_record; and the public reads, mint_page, mint_page_preview and mint_page_tiers, the only way anon reads
-- either table. The document they answer comes from private.mint_page_document and never carries the owner's id or
-- wallet, the payout, the deploy transaction, the fee snapshot, the token list, a CID or base URI of the real art,
-- an upload of the private buckets or a whitelist entry.

-- ---------------------------------------------------------------------------------------------
-- The check helpers: immutable, run as the writer, so granted to the roles that write
-- ---------------------------------------------------------------------------------------------
-- The service role had no usage on the private schema; a check it runs as the writer needs it.
grant usage on schema private to service_role;

-- At most p_max ids, none null, each at least 1, no repeat.
create function private.token_ids_ok(p_ids integer[], p_max integer)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select p_ids is not null
    and cardinality(p_ids) <= p_max
    and array_position(p_ids, null) is null
    and not exists (select 1 from unnest(p_ids) as id where id < 1)
    and cardinality(p_ids) = (select count(distinct id) from unnest(p_ids) as id);
$$;

-- Null, or a key of the mint-page bucket under the collection's id: `<collection id>/<sha256>.<ext>`, the
-- extension PNG, JPG, WebP or GIF for `image`, those or MP4 for `slide`, and MP3 alone for `music`.
create function private.mint_page_key_ok(p_collection_id uuid, p_key text, p_kind text)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select p_key is null or coalesce(
    p_key ~ (
      '^' || p_collection_id::text || '/[0-9a-f]{64}\.'
      || case p_kind
           when 'image' then '(png|jpg|webp|gif)'
           when 'slide' then '(png|jpg|webp|gif|mp4)'
           when 'music' then 'mp3'
         end
      || '$'
    ),
    false
  );
$$;

-- An object of at most 64 KB as text whose media keys are the collection's: the team photos as images, the
-- carousel's uploads as slides and the music's file. The rest of its shape is the save's zod schema.
create function private.mint_page_sections_ok(p_collection_id uuid, p_sections jsonb)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select jsonb_typeof(p_sections) = 'object'
    and octet_length(p_sections::text) <= 65536
    and not exists (
      select 1 from jsonb_path_query(p_sections, '$.team.members[*].imageKey') as k(value)
      where not private.mint_page_key_ok(p_collection_id, k.value #>> '{}', 'image')
    )
    and not exists (
      select 1 from jsonb_path_query(p_sections, '$.carousel.items[*].key') as k(value)
      where not private.mint_page_key_ok(p_collection_id, k.value #>> '{}', 'slide')
    )
    and not exists (
      select 1 from jsonb_path_query(p_sections, '$.music.key') as k(value)
      where not private.mint_page_key_ok(p_collection_id, k.value #>> '{}', 'music')
    );
$$;

revoke all on function private.token_ids_ok(integer[], integer) from public, anon;
revoke all on function private.mint_page_key_ok(uuid, text, text) from public, anon;
revoke all on function private.mint_page_sections_ok(uuid, jsonb) from public, anon;
grant execute on function private.token_ids_ok(integer[], integer) to authenticated, service_role;
grant execute on function private.mint_page_key_ok(uuid, text, text) to authenticated, service_role;
grant execute on function private.mint_page_sections_ok(uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- mint_pages: the public page's settings, one row per collection, written by its owner
-- ---------------------------------------------------------------------------------------------
create table public.mint_pages (
  collection_id uuid primary key references public.collections (id) on delete cascade,
  published boolean not null default false,
  published_at timestamptz,
  description text not null default '' check (char_length(description) <= 2000),
  banner_key text,
  avatar_key text,
  about_banner_key text,
  website_url text check (website_url ~ '^https://\S+$'),
  x_url text check (x_url ~ '^https://(www\.)?(x|twitter)\.com/\S+$'),
  discord_url text check (discord_url ~ '^https://(www\.)?discord\.(gg|com)/\S+$'),
  telegram_url text check (telegram_url ~ '^https://(www\.)?(t|telegram)\.me/\S+$'),
  featured_token_ids integer[] not null default '{}' check (private.token_ids_ok(featured_token_ids, 6)),
  sections jsonb not null default '{}'::jsonb check (private.mint_page_sections_ok(collection_id, sections)),
  updated_at timestamptz not null default now(),
  constraint mint_pages_links_length check (
    greatest(char_length(website_url), char_length(x_url), char_length(discord_url), char_length(telegram_url))
      <= 200
  ),
  constraint mint_pages_media_keys check (
    private.mint_page_key_ok(collection_id, banner_key, 'image')
    and private.mint_page_key_ok(collection_id, avatar_key, 'image')
    and private.mint_page_key_ok(collection_id, about_banner_key, 'image')
  )
);

comment on table public.mint_pages is
  'The public mint page''s settings, one row per collection, written by its owner. Read publicly only through mint_page, for a deployed collection whose row is published. Media keys name objects of the mint-page bucket under the collection''s id; sections is the JSON lib/mint/page-doc.ts validates.';

-- The owner reads, inserts and updates under row-level security, through the editable columns only; no client
-- role deletes a row (the collection's delete cascades). The trigger below stamps published_at and updated_at.
alter table public.mint_pages enable row level security;
create policy "mint_pages: owner reads" on public.mint_pages
for select to authenticated
using ((select private.collection_owned(collection_id)));
create policy "mint_pages: owner inserts" on public.mint_pages
for insert to authenticated
with check ((select private.collection_owned(collection_id)));
create policy "mint_pages: owner updates" on public.mint_pages
for update to authenticated
using ((select private.collection_owned(collection_id)))
with check ((select private.collection_owned(collection_id)));
revoke all on public.mint_pages from anon, authenticated;
grant select on public.mint_pages to authenticated;
grant insert (
  collection_id, published, description, banner_key, avatar_key, about_banner_key, website_url, x_url,
  discord_url, telegram_url, featured_token_ids, sections
) on public.mint_pages to authenticated;
grant update (
  published, description, banner_key, avatar_key, about_banner_key, website_url, x_url, discord_url,
  telegram_url, featured_token_ids, sections
) on public.mint_pages to authenticated;

-- A row turning published (inserted published, or updated from false to true) needs a deployed collection with a
-- link, and stamps published_at; any other write keeps the old published_at. Every write stamps updated_at.
create function public.mint_pages_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.published and (tg_op = 'INSERT' or not old.published) then
    if not exists (
      select 1 from public.collections c
      where c.id = new.collection_id and c.status = 'deployed' and c.slug is not null
    ) then
      raise exception 'A mint page goes public once its contract is deployed and it has a link.'
        using errcode = '23514';
    end if;
    new.published_at := now();
  elsif tg_op = 'INSERT' then
    new.published_at := null;
  else
    new.published_at := old.published_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger mint_pages_guard
before insert or update on public.mint_pages
for each row execute function public.mint_pages_guard();

-- ---------------------------------------------------------------------------------------------
-- token_ranks: a done real job's rarity ranks, written only by token_ranks_record
-- ---------------------------------------------------------------------------------------------
create table public.token_ranks (
  job_id uuid primary key references public.render_jobs (id) on delete cascade,
  ranks integer[] not null check (cardinality(ranks) between 1 and 100000 and array_position(ranks, null) is null),
  created_at timestamptz not null default now()
);

comment on table public.token_ranks is
  'ranks[i] is token i''s rarity rank (1 the rarest) in a done real job''s stored token list, by rankTokens with Generate''s attribute key. Written only by token_ranks_record; read publicly only through mint_page_tiers, for the revealed base URI.';

alter table public.token_ranks enable row level security;
create policy "token_ranks: owner reads" on public.token_ranks
for select to authenticated
using (
  exists (
    select 1 from public.render_jobs j
    where j.id = job_id and (select private.collection_owned(j.collection_id))
  )
);
revoke all on public.token_ranks from anon, authenticated;
grant select on public.token_ranks to authenticated;

-- ---------------------------------------------------------------------------------------------
-- The document: what the public page shows, and nothing it must not
-- ---------------------------------------------------------------------------------------------
-- The collection's link, name, symbol, type, chain and contract (lowercase, as stored); the page's description, else
-- the collection's; its media keys, links, featured ids and sections ({} without a row); the phases' names,
-- descriptions, visibility and order; and the placeholder base URIs, which are the latest done placeholder job's
-- and the deploy-time one, distinct, each left out when it is the latest done real job's. Revoked from every
-- client role: the definer functions below call it.
create function private.mint_page_document(p_collection_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with real_job as (
    select j.base_uri from public.render_jobs j
    where j.collection_id = p_collection_id and j.kind = 'real' and j.state = 'done'
    order by j.created_at desc
    limit 1
  ), placeholder_job as (
    select j.base_uri from public.render_jobs j
    where j.collection_id = p_collection_id and j.kind = 'placeholder' and j.state = 'done'
    order by j.created_at desc
    limit 1
  ), starts as (
    select base_uri as uri from placeholder_job
    union all
    select d.args->>'baseUri' from public.deployments d where d.collection_id = p_collection_id
  )
  select jsonb_build_object(
    'slug', c.slug,
    'name', c.name,
    'symbol', c.symbol,
    'projectType', c.project_type,
    'chainId', c.chain_id,
    'contract', c.contract_address,
    'description', case when coalesce(p.description, '') = '' then c.description else p.description end,
    'media', jsonb_build_object(
      'banner', p.banner_key, 'avatar', p.avatar_key, 'aboutBanner', p.about_banner_key
    ),
    'socials', jsonb_build_object(
      'website', p.website_url, 'x', p.x_url, 'discord', p.discord_url, 'telegram', p.telegram_url
    ),
    'featuredTokenIds', to_jsonb(coalesce(p.featured_token_ids, '{}'::integer[])),
    'sections', coalesce(p.sections, '{}'::jsonb),
    'phases', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', g.onchain_id, 'name', g.name, 'description', g.description, 'visible', g.visible,
            'position', g.position
          )
          order by g.position nulls last, g.onchain_id
        ),
        '[]'::jsonb
      )
      from public.mint_groups g
      where g.collection_id = c.id
    ),
    'placeholders', (
      select coalesce(jsonb_agg(distinct s.uri), '[]'::jsonb)
      from starts s
      where s.uri is not null and s.uri is distinct from (select r.base_uri from real_job r)
    ),
    'published', coalesce(p.published, false)
  )
  from public.collections c
  left join public.mint_pages p on p.collection_id = c.id
  where c.id = p_collection_id;
$$;

revoke all on function private.mint_page_document(uuid) from public, anon, authenticated;

-- The document of the deployed collection with this link, for anyone, once its page is published; null otherwise.
create function public.mint_page(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.mint_page_document(c.id)
  from public.collections c
  join public.mint_pages p on p.collection_id = c.id and p.published
  where c.slug = lower(btrim(p_slug))
    and c.status = 'deployed'
    and exists (select 1 from public.deployments d where d.collection_id = c.id);
$$;

revoke all on function public.mint_page(text) from public;
grant execute on function public.mint_page(text) to anon, authenticated;

-- The same document for the signed-in owner, published or not (the owner's preview); null for anyone else.
create function public.mint_page_preview(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.mint_page_document(c.id)
  from public.collections c
  where c.slug = lower(btrim(p_slug))
    and c.status = 'deployed'
    and c.owner_id = (select auth.uid())
    and exists (select 1 from public.deployments d where d.collection_id = c.id);
$$;

revoke all on function public.mint_page_preview(text) from public, anon;
grant execute on function public.mint_page_preview(text) to authenticated;

-- The rarity ranks of 1 to 20 ids, only at the real base URI: for a published, deployed, generative collection
-- whose latest done real job's base URI is p_base_uri and has ranks, { "total": n, "ranks": { "<id>": rank } } for
-- the ids from 1 to n; null otherwise, so nothing reads before the reveal.
create function public.mint_page_tiers(p_slug text, p_base_uri text, p_ids integer[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with collection as (
    select c.id from public.collections c
    join public.mint_pages p on p.collection_id = c.id and p.published
    where c.slug = lower(btrim(p_slug))
      and c.status = 'deployed'
      and c.project_type = 'generative'
      and exists (select 1 from public.deployments d where d.collection_id = c.id)
  ), real_job as (
    select j.id, j.base_uri from public.render_jobs j
    join collection on j.collection_id = collection.id
    where j.kind = 'real' and j.state = 'done'
    order by j.created_at desc
    limit 1
  ), ranked as (
    select t.ranks from public.token_ranks t
    join real_job on t.job_id = real_job.id
    where real_job.base_uri = p_base_uri
  )
  select jsonb_build_object(
    'total', cardinality(ranked.ranks),
    'ranks', coalesce(
      (
        select jsonb_object_agg(id::text, ranked.ranks[id])
        from unnest(p_ids) as id
        where id between 1 and cardinality(ranked.ranks)
      ),
      '{}'::jsonb
    )
  )
  from ranked
  where p_ids is not null and cardinality(p_ids) between 1 and 20;
$$;

revoke all on function public.mint_page_tiers(text, text, integer[]) from public;
grant execute on function public.mint_page_tiers(text, text, integer[]) to anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- token_ranks_record: the ranks of a done real job, computed by the server
-- ---------------------------------------------------------------------------------------------
-- Service role only; p_owner must equal collections.owner_id. The collection must be generative, the job its done
-- real job, and the ranks a permutation of 1 to the job's token count. A job already ranked is left as it is: the
-- function answers whether it inserted the row.
create function public.token_ranks_record(
  p_collection_id uuid,
  p_owner uuid,
  p_job_id uuid,
  p_ranks integer[]
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_collection public.collections;
  v_count integer;
begin
  v_collection := private.lock_owned_collection(p_collection_id, p_owner);
  select j.token_count into v_count
  from public.render_jobs j
  where j.id = p_job_id and j.collection_id = v_collection.id and j.kind = 'real' and j.state = 'done';
  if v_collection.project_type <> 'generative'
    or v_count is null
    or p_ranks is null
    or cardinality(p_ranks) <> v_count
    or (select count(distinct r) from unnest(p_ranks) as r where r between 1 and v_count) <> v_count then
    raise exception 'The rendered set could not be ranked.' using errcode = '23514';
  end if;
  insert into public.token_ranks (job_id, ranks)
  values (p_job_id, p_ranks)
  on conflict (job_id) do nothing;
  return found;
end;
$$;

revoke all on function public.token_ranks_record(uuid, uuid, uuid, integer[]) from public, anon, authenticated;
grant execute on function public.token_ranks_record(uuid, uuid, uuid, integer[]) to service_role;
```

In `supabase/config.toml`, replace:

```toml
file_size_limit = "50MiB"
allowed_mime_types = ["image/png"]

# Allow connections via S3 compatible clients
```

with:

```toml
file_size_limit = "50MiB"
allowed_mime_types = ["image/png"]

# The public mint page's media (docs/specs/2026-10-16-mint-page-live-data.md, section 4.4). Public: the page and its
# cached HTML link the objects directly. Written only through presigned PUTs the Mint page tab's actions sign.
[storage.buckets.mint-page]
public = true
file_size_limit = "20MiB"
allowed_mime_types = ["image/png", "image/jpeg", "image/webp", "image/gif", "video/mp4", "audio/mpeg"]

# Allow connections via S3 compatible clients
```

- [ ] **Step 4: Apply the migration and seed the bucket**

Run: `supabase migration up --local`
Expected: `Applying migration 20261016100000_mint_page.sql...` and `Migrations applied`.

Run: `supabase seed buckets --local`
Expected: `Creating Storage bucket: mint-page`, with `art` and `render` updated.

- [ ] **Step 5: The types**

In `apps/web/src/lib/database.types.ts`, replace:

```ts
        ]
      }
      profiles: {
        Row: {
```

with:

```ts
        ]
      }
      mint_pages: {
        Row: {
          about_banner_key: string | null
          avatar_key: string | null
          banner_key: string | null
          collection_id: string
          description: string
          discord_url: string | null
          featured_token_ids: number[]
          published: boolean
          published_at: string | null
          sections: Json
          telegram_url: string | null
          updated_at: string
          website_url: string | null
          x_url: string | null
        }
        Insert: {
          about_banner_key?: string | null
          avatar_key?: string | null
          banner_key?: string | null
          collection_id: string
          description?: string
          discord_url?: string | null
          featured_token_ids?: number[]
          published?: boolean
          published_at?: string | null
          sections?: Json
          telegram_url?: string | null
          updated_at?: string
          website_url?: string | null
          x_url?: string | null
        }
        Update: {
          about_banner_key?: string | null
          avatar_key?: string | null
          banner_key?: string | null
          collection_id?: string
          description?: string
          discord_url?: string | null
          featured_token_ids?: number[]
          published?: boolean
          published_at?: string | null
          sections?: Json
          telegram_url?: string | null
          updated_at?: string
          website_url?: string | null
          x_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'mint_pages_collection_id_fkey'
            columns: ['collection_id']
            isOneToOne: true
            referencedRelation: 'collections'
            referencedColumns: ['id']
          },
        ]
      }
      profiles: {
        Row: {
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
      token_ranks: {
        Row: {
          created_at: string
          job_id: string
          ranks: number[]
        }
        Insert: {
          created_at?: string
          job_id: string
          ranks: number[]
        }
        Update: {
          created_at?: string
          job_id?: string
          ranks?: number[]
        }
        Relationships: [
          {
            foreignKeyName: 'token_ranks_job_id_fkey'
            columns: ['job_id']
            isOneToOne: true
            referencedRelation: 'render_jobs'
            referencedColumns: ['id']
          },
```

In `apps/web/src/lib/database.types.ts`, replace:

```ts
        Returns: boolean
      }
      record_upload: {
        Args: {
```

with:

```ts
        Returns: boolean
      }
      mint_page: {
        Args: { p_slug: string }
        Returns: Json
      }
      mint_page_preview: {
        Args: { p_slug: string }
        Returns: Json
      }
      mint_page_tiers: {
        Args: { p_base_uri: string; p_ids: number[]; p_slug: string }
        Returns: Json
      }
      record_upload: {
        Args: {
```

In `apps/web/src/lib/database.types.ts`, replace:

```ts
        Args: { p_a: number; p_b: number; p_collection_id: string }
        Returns: undefined
      }
      whitelist_chunk_record: {
```

with:

```ts
        Args: { p_a: number; p_b: number; p_collection_id: string }
        Returns: undefined
      }
      token_ranks_record: {
        Args: {
          p_collection_id: string
          p_job_id: string
          p_owner: string
          p_ranks: number[]
        }
        Returns: boolean
      }
      whitelist_chunk_record: {
```

- [ ] **Step 6: Run the checks to see them pass**

Run: `pnpm --filter @cobweb/web verify:local`
Expected: PASS, `379 passed, 0 failed`: the two anon checks and section 9n's twelve beside the 365 before.

- [ ] **Step 7: Format, run the root checks and commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
pnpm exec prettier --write apps/web/src/lib/database.types.ts apps/web/scripts/verify-local.ts
pnpm typecheck && pnpm lint && pnpm test
git add supabase/migrations/20261016100000_mint_page.sql supabase/config.toml apps/web/src/lib/database.types.ts apps/web/scripts/verify-local.ts
git commit -m "$(cat <<'EOF'
Add the mint page row and the token ranks with their checks and guard, the three public reads and the record function, the mint-page bucket, their types, and verify:local's section 9n

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: the tests are unchanged (web 697 in 74 files, shared 103, freshness 110, dna 60, render 117, worker 282).

---

### Task 2: The server side of the page: the media slots and keys, the document, the reads, the ranks and the four actions

**Files:**

- Create: `apps/web/src/lib/mint/media.ts`, `page-doc.ts`, `page-urls.ts`, `page-read.ts`, `ranks-core.ts`, `settings-core.ts`, `apps/web/src/app/actions/mint-page.ts`, and the tests `apps/web/src/lib/mint/media.test.ts`, `page-doc.test.ts`, `ranks-core.test.ts`
- Modify: `apps/web/src/lib/art/result.ts`, `apps/web/src/lib/manage/phases-types.ts`, `phases-view.ts`, `apps/web/src/lib/storage/objects.ts`, `config.ts`, `apps/web/src/app/actions/settings.ts`, `mint-page-address.ts`, `apps/web/.env.example`
- Test: the three new test files

**Interfaces:**

- Consumes: Task 1's table, functions and types; `rankTokens`, `attributeKeyOf`, `buildTraitIndex` and `Layer` from `@cobweb/dna`; `readArtRows` (`lib/art/read-rows.ts`) and `toProject` (`lib/art/rows.ts`); `doneJobRow` and `DeployOutcome` (`lib/deploy/deploy-core.ts`); `PhasesContext` and `phasesWrite` (`lib/manage`); `chainById` (`@cobweb/shared`) and `chainView` (`lib/chain/chain-view.ts`); `FileFacts` (`lib/storage/admission.ts`); `Socials` and `SupportedChain` (`lib/demo/types.ts`); the S3 client and object helpers in `lib/storage`.
- Produces:
  - `lib/art/result.ts`: `PAGE_NOT_PUBLIC`, `RANKS_REFUSED` (the database's sentences), `PAGE_LINK_FIRST`, `PAGE_FIELDS`, `PAGE_FILE_MISSING`, `PAGE_UPLOAD_FAILED`
  - `lib/manage/phases-types.ts`: `PhaseRow = Pick<PhaseRowCopy, 'onchain_id' | 'name' | 'description' | 'visible' | 'position'>`; `joinPhases(state, rows: readonly PhaseRow[])`
  - `lib/mint/media.ts`: `MediaSlot = 'banner' | 'avatar' | 'about' | 'team' | 'slide' | 'music'`, `MEDIA_SLOTS` (types, caps per type, the avatar's `minSide: 400`), `mintPageMediaProblem(slot: MediaSlot, file: FileFacts): string | null`, `mintPageKey(collectionId: string, contentHash: string, mime: string): string` (`<collection id>/<sha256>.<ext>`), `keyBelongs(collectionId: string, key: string, slot: MediaSlot): boolean`, `mimeOfKey(key: string): string | null`
  - `lib/mint/page-doc.ts`: `StoredMember`, `StoredRoadmapItem`, `StoredFaqItem`, `StoredUploadSlide`, `StoredTokenSlide`, `StoredSlide`, `StoredSections`, `SECTION_SCHEMAS`, `sectionsSchema`, `emptySections(): StoredSections`, `storedSectionsOf(raw: unknown): StoredSections`, `PageDoc`, `pageDocSchema`, `PageMember`, `PageSlide`, `MintPageSections`, `MintPageStatic = { slug; name; symbol; projectType; chain: SupportedChain; contract: Address; description; bannerUrl; avatarUrl; aboutBannerUrl; socials: Socials; featuredTokenIds; sections: MintPageSections; phases: PhaseRow[]; placeholders: string[]; gateway: string }`, `pageSectionsOf(raw: unknown, media: (key: string) => string): MintPageSections`, `pageStaticOf(doc: PageDoc, urls: { media(key: string): string; gateway: string }): MintPageStatic | null`
  - `lib/mint/page-urls.ts`: `mintPageTag(slug: string): string` (`mint-page:<slug>`), `mediaBase(): string`, `mediaUrl(key: string): string`, `ipfsGateway(): string` (Decision 6)
  - `lib/mint/page-read.ts` (server only): `readMintPage(slug: string): Promise<MintPageStatic | null>`, cached under the link's tag for 60 s; `readMintPagePreview(slug: string): Promise<(MintPageStatic & { published: boolean }) | null>`; the four names of `page-urls.ts` re-exported
  - `lib/mint/ranks-core.ts`: `ranksOf(tokens: readonly { id: number; dna: string[] }[], layers: Layer[]): number[]`, `ensureTokenRanksCore(ctx: PhasesContext): Promise<'recorded' | 'present' | 'skipped'>` (Decision 9)
  - `lib/storage/objects.ts`: `presignPut`, `headObject` and `deleteObjects` take `options: { bucket?: string } = {}` as `presignGet` already does, the art bucket without one; `lib/storage/config.ts`: `mintPageBucket(): string` (`MINT_PAGE_S3_BUCKET`, else `mint-page`)
  - `lib/mint/settings-core.ts`: `MediaAsk = { slot; mime; bytes; width; height; contentHash }`, `MediaRef = { key; url }`, `EditableMember`, `EditableSlide`, `EditableSections`, `MintPageSettingsView = { published; description; media: Record<'banner' | 'avatar' | 'about', MediaRef | null>; socials; featuredTokenIds; sections: EditableSections; art: { realBaseUri; supply; projectType } }`, `MintPageInput`, `MEDIA_ASKS_MAX = 21`, `mediaAsksSchema`, `mintPageInputSchema`, `editableSectionsOf(stored, url)`, `mintPageSettingsCore(ctx)`, `presignMintPageMediaCore(ctx, asks: MediaAsk[]): Promise<DeployOutcome<{ key: string; putUrl: string | null }[]>>`, `saveMintPageCore(ctx, input: MintPageInput): Promise<DeployOutcome<MintPageSettingsView>>`, `setMintPagePublishedCore(ctx, published: boolean): Promise<DeployOutcome<{ published: boolean }>>` (Decision 4)
  - `app/actions/mint-page.ts`: `getMintPageSettings(collectionId)`, `presignMintPageMedia(collectionId, asks)`, `saveMintPage(collectionId, input)`, `setMintPagePublished(collectionId, published)`, each an `ActionResult`; a save or switch that lands calls `updateTag(mintPageTag(slug))`
  - `app/actions/settings.ts`: a confirmed `setBaseURI` whose fresh view reads revealed records the ranks (logged on failure); `app/actions/mint-page-address.ts`: a link saved on a deployed collection expires its tag

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/lib/mint/media.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { FileFacts } from '@/lib/storage/admission'
import { keyBelongs, mimeOfKey, mintPageKey, mintPageMediaProblem } from './media'

const MB = 1024 * 1024
const COLLECTION = '0a977c0b-7e53-476b-8c08-6c685315c3af'
const OTHER = '7d2c9e10-5b44-4a6f-9c3e-2f1b8a7d6e5c'
const HASH = 'ab'.repeat(32)
const image = (mime: string, bytes: number, side = 1000): FileFacts => ({
  mime,
  bytes,
  width: side,
  height: side,
})

describe('mintPageMediaProblem (docs/specs/2026-10-16-mint-page-live-data.md, section 4.4)', () => {
  it('takes PNG, JPG, WebP and GIF in the image slots, and refuses an SVG and a video there', () => {
    for (const mime of ['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
      for (const slot of ['banner', 'about', 'avatar', 'team'] as const)
        expect(mintPageMediaProblem(slot, image(mime, MB))).toBeNull()
    expect(mintPageMediaProblem('banner', image('image/svg+xml', 1000))).toBe(
      'Use a PNG, JPG, WebP or GIF image.',
    )
    expect(mintPageMediaProblem('team', image('video/mp4', MB))).toBe('Use a PNG, JPG, WebP or GIF image.')
  })

  it('caps banners at 5 MB and the avatar and team photos at 2 MB', () => {
    expect(mintPageMediaProblem('banner', image('image/png', 5 * MB))).toBeNull()
    expect(mintPageMediaProblem('banner', image('image/png', 6 * MB))).toBe('6 MB is over the 5 MB limit.')
    expect(mintPageMediaProblem('about', image('image/jpeg', 5 * MB + 1))).toBe(
      '6 MB is over the 5 MB limit.',
    )
    expect(mintPageMediaProblem('avatar', image('image/png', 3 * MB))).toBe('3 MB is over the 2 MB limit.')
    expect(mintPageMediaProblem('team', image('image/gif', 2 * MB + 1))).toBe('3 MB is over the 2 MB limit.')
  })

  it('takes images up to 5 MB and an MP4 up to 20 MB as a carousel slide', () => {
    expect(mintPageMediaProblem('slide', image('image/webp', 5 * MB))).toBeNull()
    expect(mintPageMediaProblem('slide', image('image/webp', 6 * MB))).toBe('6 MB is over the 5 MB limit.')
    const video: FileFacts = { mime: 'video/mp4', bytes: 20 * MB, width: null, height: null }
    expect(mintPageMediaProblem('slide', video)).toBeNull()
    expect(mintPageMediaProblem('slide', { ...video, bytes: 21 * MB })).toBe('21 MB is over the 20 MB limit.')
    expect(mintPageMediaProblem('slide', image('image/svg+xml', 10))).toBe(
      'Use a PNG, JPG, WebP or GIF image, or an MP4 video.',
    )
  })

  it('takes one MP3 up to 20 MB as the music, and nothing else', () => {
    const track: FileFacts = { mime: 'audio/mpeg', bytes: 20 * MB, width: null, height: null }
    expect(mintPageMediaProblem('music', track)).toBeNull()
    expect(mintPageMediaProblem('music', { ...track, bytes: 20 * MB + 1 })).toBe(
      '21 MB is over the 20 MB limit.',
    )
    expect(mintPageMediaProblem('music', { ...track, mime: 'audio/wav' })).toBe('Use an MP3 file.')
  })

  it('needs an avatar of at least 400 by 400, read from the file', () => {
    expect(mintPageMediaProblem('avatar', image('image/png', MB, 400))).toBeNull()
    expect(mintPageMediaProblem('avatar', { mime: 'image/png', bytes: MB, width: 800, height: 399 })).toBe(
      'The avatar must be at least 400 by 400.',
    )
    expect(mintPageMediaProblem('avatar', { mime: 'image/png', bytes: MB, width: null, height: null })).toBe(
      'The avatar must be at least 400 by 400.',
    )
    expect(mintPageMediaProblem('banner', image('image/png', MB, 100))).toBeNull()
  })
})

describe('mintPageKey and keyBelongs', () => {
  it('names a file by the collection and its hash, with the extension of its type', () => {
    expect(mintPageKey(COLLECTION, HASH, 'image/jpeg')).toBe(`${COLLECTION}/${HASH}.jpg`)
    expect(mintPageKey(COLLECTION, HASH, 'audio/mpeg')).toBe(`${COLLECTION}/${HASH}.mp3`)
    expect(() => mintPageKey(COLLECTION, 'AB'.repeat(32), 'image/png')).toThrow()
    expect(() => mintPageKey(COLLECTION, HASH, 'image/svg+xml')).toThrow()
  })

  it("keeps each slot to its types, and refuses another collection's key or another shape", () => {
    expect(keyBelongs(COLLECTION, `${COLLECTION}/${HASH}.png`, 'banner')).toBe(true)
    expect(keyBelongs(COLLECTION, `${COLLECTION}/${HASH}.mp4`, 'banner')).toBe(false)
    expect(keyBelongs(COLLECTION, `${COLLECTION}/${HASH}.mp4`, 'slide')).toBe(true)
    expect(keyBelongs(COLLECTION, `${COLLECTION}/${HASH}.mp3`, 'music')).toBe(true)
    expect(keyBelongs(COLLECTION, `${COLLECTION}/${HASH}.png`, 'music')).toBe(false)
    expect(keyBelongs(COLLECTION, `${OTHER}/${HASH}.png`, 'avatar')).toBe(false)
    expect(keyBelongs(COLLECTION, `${COLLECTION}/${HASH}.svg`, 'team')).toBe(false)
    expect(keyBelongs(COLLECTION, `${COLLECTION}/layers/${HASH}.png`, 'about')).toBe(false)
  })

  it('reads the type back from a key', () => {
    expect(mimeOfKey(`${COLLECTION}/${HASH}.webp`)).toBe('image/webp')
    expect(mimeOfKey(`${COLLECTION}/${HASH}.mp4`)).toBe('video/mp4')
    expect(mimeOfKey(`${COLLECTION}/${HASH}.svg`)).toBeNull()
  })
})
```

Create `apps/web/src/lib/mint/page-doc.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  emptySections,
  pageDocSchema,
  pageSectionsOf,
  pageStaticOf,
  sectionsSchema,
  type PageDoc,
  type StoredSections,
} from './page-doc'

const COLLECTION = '0a977c0b-7e53-476b-8c08-6c685315c3af'
const key = (n: number, extension = 'png') => `${COLLECTION}/${n.toString(16).padStart(64, '0')}.${extension}`
const media = (value: string) => `https://media.example/${value}`
const urls = { media, gateway: 'https://ipfs.io/ipfs' }

/** Every section on and filled, within the limits. */
const full: StoredSections = {
  team: {
    enabled: true,
    members: [
      {
        id: 'team-1',
        name: 'Mara Quill',
        role: 'Artist',
        bio: 'Draws every owl by hand.',
        imageKey: key(1),
        x: 'https://x.com/mara',
      },
      { id: 'team-2', name: 'Tobin', role: 'Community', bio: '', imageKey: null },
    ],
  },
  roadmap: { enabled: true, items: [{ id: 'road-1', date: 'Q4 2026', title: 'Mint', description: '' }] },
  faq: { enabled: true, items: [{ id: 'faq-1', question: 'How many?', answer: 'Up to three.' }] },
  music: { enabled: true, key: key(2, 'mp3'), fileName: 'theme.mp3' },
  carousel: {
    enabled: true,
    items: [
      { id: 'slide-1', kind: 'upload', key: key(3, 'mp4'), fileName: 'trailer.mp4', mediaType: 'video' },
      { id: 'slide-2', kind: 'token', tokenId: 5 },
    ],
  },
}

const doc: PageDoc = {
  slug: 'night-owls',
  name: 'Night Owls',
  symbol: 'OWLS',
  projectType: 'generative',
  chainId: 31337,
  contract: '0x5fbdb2315678afecb367f032d93f642f64180aa3',
  description: 'Owls who keep odd hours.',
  media: { banner: key(4), avatar: null, aboutBanner: key(5, 'jpg') },
  socials: { website: 'https://example.com', x: null, discord: 'https://discord.gg/owls', telegram: null },
  featuredTokenIds: [5, 10],
  sections: full,
  phases: [
    { id: 1, name: 'Holders', description: 'For holders.', visible: true, position: 0 },
    { id: 0, name: 'Public', description: '', visible: true, position: 1 },
  ],
  placeholders: ['ipfs://bafybeiplaceholder/metadata.json'],
  published: true,
}

describe('sectionsSchema (docs/specs/2026-10-16-mint-page-live-data.md, section 4.1)', () => {
  it('takes the five sections within their limits, and the empty ones', () => {
    expect(sectionsSchema.safeParse(full).success).toBe(true)
    expect(sectionsSchema.safeParse(emptySections()).success).toBe(true)
  })

  it("refuses what is over legacy's limits", () => {
    const member = full.team.members[0]!
    const over: [string, StoredSections][] = [
      [
        '13 members',
        {
          ...full,
          team: {
            enabled: true,
            members: Array.from({ length: 13 }, (_, n) => ({ ...member, id: `m-${n}` })),
          },
        },
      ],
      [
        'a 21-character name',
        { ...full, team: { enabled: true, members: [{ ...member, name: 'n'.repeat(21) }] } },
      ],
      ['a blank role', { ...full, team: { enabled: true, members: [{ ...member, role: '  ' }] } }],
      [
        'a 501-character bio',
        { ...full, team: { enabled: true, members: [{ ...member, bio: 'b'.repeat(501) }] } },
      ],
      [
        'an http link',
        { ...full, team: { enabled: true, members: [{ ...member, x: 'http://x.com/mara' }] } },
      ],
      [
        'a 41-character link',
        {
          ...full,
          team: { enabled: true, members: [{ ...member, discord: `https://discord.gg/${'d'.repeat(22)}` }] },
        },
      ],
      [
        '13 milestones',
        {
          ...full,
          roadmap: {
            enabled: true,
            items: Array.from({ length: 13 }, (_, n) => ({
              id: `r-${n}`,
              date: 'Q1',
              title: 'T',
              description: '',
            })),
          },
        },
      ],
      [
        'a 21-character title',
        {
          ...full,
          roadmap: {
            enabled: true,
            items: [{ id: 'r', date: 'Q1', title: 't'.repeat(21), description: '' }],
          },
        },
      ],
      [
        '21 questions',
        {
          ...full,
          faq: {
            enabled: true,
            items: Array.from({ length: 21 }, (_, n) => ({ id: `f-${n}`, question: 'Q', answer: 'A' })),
          },
        },
      ],
      [
        'a 41-character question',
        { ...full, faq: { enabled: true, items: [{ id: 'f', question: 'q'.repeat(41), answer: 'A' }] } },
      ],
      [
        'an empty answer',
        { ...full, faq: { enabled: true, items: [{ id: 'f', question: 'Q', answer: '' }] } },
      ],
      ['a track without its name', { ...full, music: { enabled: true, key: key(2, 'mp3'), fileName: null } }],
      [
        'six slides',
        {
          ...full,
          carousel: {
            enabled: true,
            items: Array.from({ length: 6 }, (_, n) => ({
              id: `s-${n}`,
              kind: 'token' as const,
              tokenId: n + 1,
            })),
          },
        },
      ],
      [
        'a video slide on an image key',
        {
          ...full,
          carousel: {
            enabled: true,
            items: [{ id: 's', kind: 'upload', key: key(3), fileName: 'a.png', mediaType: 'video' }],
          },
        },
      ],
      ['token 0', { ...full, carousel: { enabled: true, items: [{ id: 's', kind: 'token', tokenId: 0 }] } }],
      [
        'an id with capitals',
        { ...full, faq: { enabled: true, items: [{ id: 'Faq', question: 'Q', answer: 'A' }] } },
      ],
      [
        'a repeated id',
        {
          ...full,
          faq: {
            enabled: true,
            items: [
              { id: 'f', question: 'Q', answer: 'A' },
              { id: 'f', question: 'R', answer: 'B' },
            ],
          },
        },
      ],
    ]
    for (const [label, value] of over) expect(sectionsSchema.safeParse(value).success, label).toBe(false)
  })
})

describe('pageSectionsOf', () => {
  it('turns keys into URLs and keeps the sections that are on and have content', () => {
    const sections = pageSectionsOf(full, media)
    expect(sections.team?.[0]).toEqual({
      id: 'team-1',
      name: 'Mara Quill',
      role: 'Artist',
      bio: 'Draws every owl by hand.',
      imageUrl: media(key(1)),
      x: 'https://x.com/mara',
    })
    expect(sections.team?.[1]?.imageUrl).toBeNull()
    expect(sections.music).toEqual({ url: media(key(2, 'mp3')), fileName: 'theme.mp3' })
    expect(sections.carousel).toEqual([
      {
        id: 'slide-1',
        kind: 'upload',
        url: media(key(3, 'mp4')),
        fileName: 'trailer.mp4',
        mediaType: 'video',
      },
      { id: 'slide-2', kind: 'token', tokenId: 5 },
    ])
    expect(sections.roadmap).toHaveLength(1)
    expect(sections.faq).toHaveLength(1)
  })

  it('leaves off a section that fails its schema, is switched off or is empty, and keeps the rest', () => {
    const sections = pageSectionsOf(
      {
        ...full,
        team: { enabled: true, members: [{ id: 'x', name: '', role: 'r', bio: '', imageKey: null }] },
        roadmap: { ...full.roadmap, enabled: false },
        faq: { enabled: true, items: [] },
      },
      media,
    )
    expect(Object.keys(sections).sort()).toEqual(['carousel', 'music'])
    expect(pageSectionsOf({}, media)).toEqual({})
    expect(pageSectionsOf('not an object', media)).toEqual({})
  })
})

describe('pageDocSchema and pageStaticOf (section 4.3)', () => {
  it('parses the document, and refuses one without its fields', () => {
    expect(pageDocSchema.parse(JSON.parse(JSON.stringify(doc)))).toEqual(doc)
    expect(pageDocSchema.safeParse({ ...doc, contract: 'night-owls' }).success).toBe(false)
    const { phases: _phases, ...withoutPhases } = doc
    void _phases
    expect(pageDocSchema.safeParse(withoutPhases).success).toBe(false)
  })

  it('builds the page: the chain, the checksummed contract, URLs for the keys, the links that are set and the rows', () => {
    const page = pageStaticOf(doc, urls)
    expect(page).toMatchObject({
      slug: 'night-owls',
      chain: { id: 31337, name: 'Anvil', nativeSymbol: 'ETH' },
      contract: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
      bannerUrl: media(key(4)),
      avatarUrl: null,
      aboutBannerUrl: media(key(5, 'jpg')),
      socials: { website: 'https://example.com', discord: 'https://discord.gg/owls' },
      featuredTokenIds: [5, 10],
      placeholders: ['ipfs://bafybeiplaceholder/metadata.json'],
      gateway: 'https://ipfs.io/ipfs',
    })
    expect(Object.keys(page!.socials)).toEqual(['website', 'discord'])
    expect(page!.phases).toEqual([
      { onchain_id: 1, name: 'Holders', description: 'For holders.', visible: true, position: 0 },
      { onchain_id: 0, name: 'Public', description: '', visible: true, position: 1 },
    ])
  })

  it('answers null for a chain this build does not list', () => {
    expect(pageStaticOf({ ...doc, chainId: 999 }, urls)).toBeNull()
  })
})
```

Create `apps/web/src/lib/mint/ranks-core.test.ts`:

```ts
import { attributeKeyOf, buildTraitIndex, rankTokens } from '@cobweb/dna'
import { describe, expect, it, vi } from 'vitest'
import { DEMO_LAYERS, DEMO_TOKENS } from '@/lib/demo'
import { ranksOf } from './ranks-core'

// The core's job read lives in the deploy core, which loads the server's chain clients.
vi.mock('@/lib/deploy/deploy-core', () => ({ doneJobRow: vi.fn() }))

describe('ranksOf (docs/specs/2026-10-16-mint-page-live-data.md, section 6.3)', () => {
  it("equals rankTokens with Generate's attribute key, laid out by id", () => {
    const ranks = ranksOf(DEMO_TOKENS, DEMO_LAYERS)
    expect(ranks).toHaveLength(DEMO_TOKENS.length)
    for (const token of DEMO_TOKENS) expect(ranks[token.id - 1]).toBe(token.rank)
    const ranked = rankTokens(DEMO_TOKENS, attributeKeyOf(buildTraitIndex(DEMO_LAYERS)))
    expect(ranks).toEqual([...ranked].sort((a, b) => a.id - b.id).map((token) => token.rank))
  })

  it('is a permutation of 1 to the count, whatever order the list is stored in', () => {
    const reversed = [...DEMO_TOKENS].reverse().slice(0, 40)
    const ranks = ranksOf(
      reversed.map(({ id, dna }) => ({ id: id - 737, dna })),
      DEMO_LAYERS,
    )
    expect([...ranks].sort((a, b) => a - b)).toEqual(Array.from({ length: 40 }, (_, index) => index + 1))
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @cobweb/web exec vitest run src/lib/mint/media.test.ts src/lib/mint/page-doc.test.ts src/lib/mint/ranks-core.test.ts`
Expected: FAIL. Each file fails to load (`Cannot find module './media'`, `Cannot find module './page-doc'`, and the ranks core): `Test Files  3 failed (3)` and `Tests  no tests`.

- [ ] **Step 3: The sentences, the phase rows, the media and the document**

In `apps/web/src/lib/art/result.ts`, replace:

```ts
  `This wallet is not the contract's owner. Changes on chain need ${owner}.`
export const IPFS_LINK_INVALID = 'Enter a full ipfs:// link with its CID.'
```

with:

```ts
  `This wallet is not the contract's owner. Changes on chain need ${owner}.`
export const IPFS_LINK_INVALID = 'Enter a full ipfs:// link with its CID.'

// The mint page (docs/specs/2026-10-16-mint-page-live-data.md, section 6.2). The database raises PAGE_NOT_PUBLIC and
// RANKS_REFUSED as they are.
export const PAGE_NOT_PUBLIC = 'A mint page goes public once its contract is deployed and it has a link.'
export const RANKS_REFUSED = 'The rendered set could not be ranked.'
// Said by the server or the screen (the database does not raise these).
export const PAGE_LINK_FIRST = 'Set a link first. The page can go public once it has one.'
export const PAGE_FIELDS = 'Some fields could not be saved. Check them and try again.'
export const PAGE_FILE_MISSING = 'A file did not finish uploading. Choose it again, then save.'
export const PAGE_UPLOAD_FAILED = 'A file could not be uploaded. Try again.'
```

In `apps/web/src/lib/manage/phases-types.ts`, replace:

```ts
export type PhaseTxExpected = { event: ExpectedEvent; add?: PhaseAdd }

/** A `mint_groups` row as the view reads it: numeric columns as text, so no wei is lost. */
export type PhaseRowCopy = {
```

with:

```ts
export type PhaseTxExpected = { event: ExpectedEvent; add?: PhaseAdd }

/**
 * The part of a `mint_groups` row the join reads: the mint page's document carries these alone
 * (docs/specs/2026-10-16-mint-page-live-data.md, section 6.1).
 */
export type PhaseRow = Pick<PhaseRowCopy, 'onchain_id' | 'name' | 'description' | 'visible' | 'position'>

/** A `mint_groups` row as the view reads it: numeric columns as text, so no wei is lost. */
export type PhaseRowCopy = {
```

In `apps/web/src/lib/manage/phases-view.ts`, replace:

```ts
import type { Address } from 'viem'
import type { MintGroup } from '@/lib/demo/types'
import type { ChainGroup, ChainState, PhaseRowCopy, PhasesView } from './phases-types'

/**
```

with:

```ts
import type { Address } from 'viem'
import type { MintGroup } from '@/lib/demo/types'
import type { ChainGroup, ChainState, PhaseRow, PhaseRowCopy, PhasesView } from './phases-types'

/**
```

In `apps/web/src/lib/manage/phases-view.ts`, replace:

```ts

/** Rows in the creator's order: by position, then by id; a row parked inside a move sorts last. */
function byPosition(a: PhaseRowCopy, b: PhaseRowCopy): number {
  const left = a.position ?? Number.MAX_SAFE_INTEGER
  const right = b.position ?? Number.MAX_SAFE_INTEGER
```

with:

```ts

/** Rows in the creator's order: by position, then by id; a row parked inside a move sorts last. */
function byPosition(a: PhaseRow, b: PhaseRow): number {
  const left = a.position ?? Number.MAX_SAFE_INTEGER
  const right = b.position ?? Number.MAX_SAFE_INTEGER
```

In `apps/web/src/lib/manage/phases-view.ts`, replace:

```ts
 * The chain's groups with their rows: rows by position, then id, each group taking its row's name,
 * description and visibility; the groups without a row follow by id as "Group N" (`named: false`); a row
 * the chain does not list is left out.
 */
export function joinPhases(state: Pick<ChainState, 'groups'>, rows: PhaseRowCopy[]): MintGroup[] {
  const onChain = new Map(state.groups.map((group) => [group.id, group]))
  const named = [...rows].sort(byPosition).flatMap((row): MintGroup[] => {
```

with:

```ts
 * The chain's groups with their rows: rows by position, then id, each group taking its row's name,
 * description and visibility; the groups without a row follow by id as "Group N" (`named: false`); a row
 * the chain does not list is left out. The mint page passes its document's rows, which carry these fields alone.
 */
export function joinPhases(state: Pick<ChainState, 'groups'>, rows: readonly PhaseRow[]): MintGroup[] {
  const onChain = new Map(state.groups.map((group) => [group.id, group]))
  const named = [...rows].sort(byPosition).flatMap((row): MintGroup[] => {
```

Create `apps/web/src/lib/mint/media.ts`:

```ts
import type { FileFacts } from '@/lib/storage/admission'

/**
 * The mint page's media (docs/specs/2026-10-16-mint-page-live-data.md, section 4.4), pure, for the browser
 * and the server: what each slot takes and up to what size, the key of a file in the mint-page bucket, and
 * whether a key is the collection's. No SVG: a file on a public origin can carry script.
 */
export type MediaSlot = 'banner' | 'avatar' | 'about' | 'team' | 'slide' | 'music'

const MB = 1024 * 1024
const IMAGES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const
const capOf = (types: readonly string[], bytes: number): Record<string, number> =>
  Object.fromEntries(types.map((type) => [type, bytes]))

export const MEDIA_SLOTS: Record<
  MediaSlot,
  { types: readonly string[]; maxBytes: Record<string, number>; minSide?: number }
> = {
  banner: { types: IMAGES, maxBytes: capOf(IMAGES, 5 * MB) },
  about: { types: IMAGES, maxBytes: capOf(IMAGES, 5 * MB) },
  avatar: { types: IMAGES, maxBytes: capOf(IMAGES, 2 * MB), minSide: 400 },
  team: { types: IMAGES, maxBytes: capOf(IMAGES, 2 * MB) },
  slide: {
    types: [...IMAGES, 'video/mp4'],
    maxBytes: { ...capOf(IMAGES, 5 * MB), 'video/mp4': 20 * MB },
  },
  music: { types: ['audio/mpeg'], maxBytes: { 'audio/mpeg': 20 * MB } },
}

/** The extension each type is stored under, as the database's key check expects it. */
const EXTENSION: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'audio/mpeg': 'mp3',
}

const IMAGE_TYPES = 'Use a PNG, JPG, WebP or GIF image.'
const TYPE_SENTENCE: Record<MediaSlot, string> = {
  banner: IMAGE_TYPES,
  about: IMAGE_TYPES,
  avatar: IMAGE_TYPES,
  team: IMAGE_TYPES,
  slide: 'Use a PNG, JPG, WebP or GIF image, or an MP4 video.',
  music: 'Use an MP3 file.',
}

const mb = (bytes: number) => Math.ceil(bytes / MB)

/** Why a file cannot go in a slot, in the creator's words, or null. The browser and the signing action both ask. */
export function mintPageMediaProblem(slot: MediaSlot, file: FileFacts): string | null {
  const rule = MEDIA_SLOTS[slot]
  if (!rule.types.includes(file.mime)) return TYPE_SENTENCE[slot]
  const max = rule.maxBytes[file.mime] ?? 0
  if (file.bytes > max) return `${mb(file.bytes)} MB is over the ${mb(max)} MB limit.`
  if (
    rule.minSide !== undefined &&
    (file.width === null || file.height === null || Math.min(file.width, file.height) < rule.minSide)
  )
    return `The avatar must be at least ${rule.minSide} by ${rule.minSide}.`
  return null
}

/** A file's key in the mint-page bucket: `<collection id>/<sha256>.<ext>`, so an object never changes its bytes. */
export function mintPageKey(collectionId: string, contentHash: string, mime: string): string {
  if (!/^[0-9a-f]{64}$/.test(contentHash)) throw new Error('A content hash is 64 lowercase hex characters.')
  const extension = EXTENSION[mime]
  if (!extension) throw new Error(`Unsupported file type: ${mime}`)
  return `${collectionId}/${contentHash}.${extension}`
}

/** Whether a key is one of the collection's in the mint-page bucket, of a type the slot takes. */
export function keyBelongs(collectionId: string, key: string, slot: MediaSlot): boolean {
  if (!/^[0-9a-f-]{36}$/.test(collectionId)) return false
  const extensions = MEDIA_SLOTS[slot].types.map((type) => EXTENSION[type]).join('|')
  return new RegExp(`^${collectionId}/[0-9a-f]{64}\\.(${extensions})$`).test(key)
}

/** The type a key's extension stands for, or null. */
export function mimeOfKey(key: string): string | null {
  const extension = key.slice(key.lastIndexOf('.') + 1)
  return Object.keys(EXTENSION).find((type) => EXTENSION[type] === extension) ?? null
}
```

Create `apps/web/src/lib/mint/page-doc.ts`:

```ts
import { chainById } from '@cobweb/shared'
import { getAddress, type Address } from 'viem'
import { z } from 'zod'
import { chainView } from '@/lib/chain/chain-view'
import type { Socials, SupportedChain } from '@/lib/demo/types'
import type { PhaseRow } from '@/lib/manage/phases-types'

/**
 * The public mint page's document (docs/specs/2026-10-16-mint-page-live-data.md, sections 4.1, 4.3 and 6.1),
 * pure: the sections as `mint_pages.sections` stores them (media keys, not URLs) with legacy's limits, the
 * document `public.mint_page` answers, and what the page renders from it, keys turned into URLs. A section the
 * page cannot parse, or whose switch is off, is left off.
 */

/** An item's id, for the editor's order: 1 to 40 of `[a-z0-9-]`. */
const itemId = z.string().regex(/^[a-z0-9-]{1,40}$/)
/** Text of 1 to `max` characters that is not only spaces. */
const required = (max: number) => z.string().max(max).regex(/\S/)
const optional = (max: number) => z.string().max(max)
/** A team member's link: https, up to 40 characters. */
const memberLink = z
  .string()
  .max(40)
  .regex(/^https:\/\/\S+$/)
/** Every item of a list has its own id. */
const distinctIds = (items: readonly { id: string }[]) =>
  new Set(items.map((item) => item.id)).size === items.length

export type StoredMember = {
  id: string
  name: string
  role: string
  bio: string
  /** A team photo's key in the mint-page bucket, or null for none. */
  imageKey: string | null
  x?: string
  discord?: string
  telegram?: string
}
export type StoredRoadmapItem = { id: string; date: string; title: string; description: string }
export type StoredFaqItem = { id: string; question: string; answer: string }
export type StoredUploadSlide = {
  id: string
  kind: 'upload'
  key: string
  fileName: string
  mediaType: 'image' | 'video'
}
export type StoredTokenSlide = { id: string; kind: 'token'; tokenId: number }
export type StoredSlide = StoredUploadSlide | StoredTokenSlide

/** The five sections as `mint_pages.sections` stores them, each with its switch. */
export type StoredSections = {
  team: { enabled: boolean; members: StoredMember[] }
  roadmap: { enabled: boolean; items: StoredRoadmapItem[] }
  faq: { enabled: boolean; items: StoredFaqItem[] }
  /** One track: its key and file name, both or neither. */
  music: { enabled: boolean; key: string | null; fileName: string | null }
  carousel: { enabled: boolean; items: StoredSlide[] }
}

/** Each section's schema, so the page keeps the sections that parse and leaves the rest off. */
export const SECTION_SCHEMAS: { [K in keyof StoredSections]: z.ZodType<StoredSections[K]> } = {
  team: z.object({
    enabled: z.boolean(),
    members: z
      .array(
        z.object({
          id: itemId,
          name: required(20),
          role: required(20),
          bio: optional(500),
          imageKey: z.string().nullable(),
          x: memberLink.optional(),
          discord: memberLink.optional(),
          telegram: memberLink.optional(),
        }),
      )
      .max(12)
      .refine(distinctIds),
  }),
  roadmap: z.object({
    enabled: z.boolean(),
    items: z
      .array(z.object({ id: itemId, date: required(20), title: required(20), description: optional(500) }))
      .max(12)
      .refine(distinctIds),
  }),
  faq: z.object({
    enabled: z.boolean(),
    items: z
      .array(z.object({ id: itemId, question: required(40), answer: required(500) }))
      .max(20)
      .refine(distinctIds),
  }),
  music: z
    .object({ enabled: z.boolean(), key: z.string().nullable(), fileName: required(100).nullable() })
    .refine((music) => (music.key === null) === (music.fileName === null)),
  carousel: z.object({
    enabled: z.boolean(),
    items: z
      .array(
        z.discriminatedUnion('kind', [
          z
            .object({
              id: itemId,
              kind: z.literal('upload'),
              key: z.string(),
              fileName: required(100),
              mediaType: z.enum(['image', 'video']),
            })
            .refine((slide) => (slide.mediaType === 'video') === slide.key.endsWith('.mp4')),
          z.object({ id: itemId, kind: z.literal('token'), tokenId: z.number().int().min(1) }),
        ]),
      )
      .max(5)
      .refine(distinctIds),
  }),
}

/** The sections a save writes: all five, each within its limits. The save also checks every key is the collection's. */
export const sectionsSchema: z.ZodType<StoredSections> = z.object(SECTION_SCHEMAS)

/** The sections a row holds before its first save. */
export function emptySections(): StoredSections {
  return {
    team: { enabled: false, members: [] },
    roadmap: { enabled: false, items: [] },
    faq: { enabled: false, items: [] },
    music: { enabled: false, key: null, fileName: null },
    carousel: { enabled: false, items: [] },
  }
}

/** A stored value read section by section: a section that does not parse reads as empty. */
export function storedSectionsOf(raw: unknown): StoredSections {
  const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const empty = emptySections()
  const read = <K extends keyof StoredSections>(key: K): StoredSections[K] => {
    const parsed = SECTION_SCHEMAS[key].safeParse(value[key])
    return parsed.success ? parsed.data : empty[key]
  }
  return {
    team: read('team'),
    roadmap: read('roadmap'),
    faq: read('faq'),
    music: read('music'),
    carousel: read('carousel'),
  }
}

/** `public.mint_page`'s document (section 4.3). */
export type PageDoc = {
  slug: string
  name: string
  symbol: string
  projectType: 'generative' | 'one_of_one' | 'single_asset'
  chainId: number
  /** Lowercase, as stored. */
  contract: string
  /** The page's, else the collection's. */
  description: string
  media: { banner: string | null; avatar: string | null; aboutBanner: string | null }
  socials: { website: string | null; x: string | null; discord: string | null; telegram: string | null }
  featuredTokenIds: number[]
  /** As saved, `{}` without a row; parsed section by section. */
  sections: unknown
  phases: { id: number; name: string; description: string; visible: boolean; position: number | null }[]
  /** The placeholder base URIs: none of them is the real job's. */
  placeholders: string[]
  published: boolean
}

const nullableText = z.string().nullable()

export const pageDocSchema: z.ZodType<PageDoc> = z.object({
  slug: z.string(),
  name: z.string(),
  symbol: z.string(),
  projectType: z.enum(['generative', 'one_of_one', 'single_asset']),
  chainId: z.number().int(),
  contract: z.string().regex(/^0x[0-9a-f]{40}$/),
  description: z.string(),
  media: z.object({ banner: nullableText, avatar: nullableText, aboutBanner: nullableText }),
  socials: z.object({
    website: nullableText,
    x: nullableText,
    discord: nullableText,
    telegram: nullableText,
  }),
  featuredTokenIds: z.array(z.number().int()),
  sections: z.unknown(),
  phases: z.array(
    z.object({
      id: z.number().int(),
      name: z.string(),
      description: z.string(),
      visible: z.boolean(),
      position: z.number().int().nullable(),
    }),
  ),
  placeholders: z.array(z.string()),
  published: z.boolean(),
})

/** A team member on the page: the photo as a URL, or null for the artwork pattern. */
export type PageMember = Omit<StoredMember, 'imageKey'> & { imageUrl: string | null }
export type PageSlide = (Omit<StoredUploadSlide, 'key'> & { url: string }) | StoredTokenSlide

/** The sections the page shows: each one present is on and has content. */
export type MintPageSections = {
  team?: PageMember[]
  roadmap?: StoredRoadmapItem[]
  faq?: StoredFaqItem[]
  music?: { url: string; fileName: string }
  carousel?: PageSlide[]
}

/** What the page renders that is not chain state, read on the server and cached by its tag. */
export type MintPageStatic = {
  slug: string
  name: string
  symbol: string
  projectType: PageDoc['projectType']
  chain: SupportedChain
  contract: Address
  description: string
  bannerUrl: string | null
  avatarUrl: string | null
  aboutBannerUrl: string | null
  socials: Socials
  featuredTokenIds: number[]
  sections: MintPageSections
  phases: PhaseRow[]
  placeholders: string[]
  /** The IPFS gateway token art is read through. */
  gateway: string
}

/** The sections that are on and have content, keys turned into URLs. */
export function pageSectionsOf(raw: unknown, media: (key: string) => string): MintPageSections {
  const stored = storedSectionsOf(raw)
  const sections: MintPageSections = {}
  if (stored.team.enabled && stored.team.members.length)
    sections.team = stored.team.members.map(({ imageKey, ...member }) => ({
      ...member,
      imageUrl: imageKey === null ? null : media(imageKey),
    }))
  if (stored.roadmap.enabled && stored.roadmap.items.length) sections.roadmap = stored.roadmap.items
  if (stored.faq.enabled && stored.faq.items.length) sections.faq = stored.faq.items
  if (stored.music.enabled && stored.music.key !== null && stored.music.fileName !== null)
    sections.music = { url: media(stored.music.key), fileName: stored.music.fileName }
  if (stored.carousel.enabled && stored.carousel.items.length)
    sections.carousel = stored.carousel.items.map((slide) => {
      if (slide.kind === 'token') return slide
      const { key, ...rest } = slide
      return { ...rest, url: media(key) }
    })
  return sections
}

/** The links that are set, for the page's buttons. */
function socialsOf(socials: PageDoc['socials']): Socials {
  return Object.fromEntries(Object.entries(socials).filter(([, value]) => value)) as Socials
}

/**
 * What the page renders from a document, or null for a chain this build does not list. Keys become URLs
 * through `urls.media`; the gateway is passed on for token art.
 */
export function pageStaticOf(
  doc: PageDoc,
  urls: { media(key: string): string; gateway: string },
): MintPageStatic | null {
  if (!chainById(doc.chainId)) return null
  const url = (key: string | null) => (key === null ? null : urls.media(key))
  return {
    slug: doc.slug,
    name: doc.name,
    symbol: doc.symbol,
    projectType: doc.projectType,
    chain: chainView(doc.chainId),
    contract: getAddress(doc.contract),
    description: doc.description,
    bannerUrl: url(doc.media.banner),
    avatarUrl: url(doc.media.avatar),
    aboutBannerUrl: url(doc.media.aboutBanner),
    socials: socialsOf(doc.socials),
    featuredTokenIds: doc.featuredTokenIds,
    sections: pageSectionsOf(doc.sections, urls.media),
    phases: doc.phases.map((phase) => ({
      onchain_id: phase.id,
      name: phase.name,
      description: phase.description,
      visible: phase.visible,
      position: phase.position,
    })),
    placeholders: doc.placeholders,
    gateway: urls.gateway,
  }
}
```

- [ ] **Step 4: The ranks**

The ranks are taken over the collection's `tokens` rows, a generative job's list (Decision 9).

Create `apps/web/src/lib/mint/ranks-core.ts`:

```ts
import { attributeKeyOf, buildTraitIndex, rankTokens, type Layer } from '@cobweb/dna'
import { readArtRows } from '@/lib/art/read-rows'
import { toProject } from '@/lib/art/rows'
import { doneJobRow } from '@/lib/deploy/deploy-core'
import type { PhasesContext } from '@/lib/manage/phases-core'

/**
 * The rarity ranks of a rendered set (docs/specs/2026-10-16-mint-page-live-data.md, section 6.3), recorded in
 * `token_ranks` so the public page can show a minted token's tier once the collection is revealed. No
 * `server-only` marker, so verify:mint-page can import it; the browser never does.
 */

/** Each token's rank, 1 the rarest, laid out by id (`ranks[id - 1]`): the ranks Generate shows. */
export function ranksOf(tokens: readonly { id: number; dna: string[] }[], layers: Layer[]): number[] {
  const ranked = rankTokens(
    tokens.map((token) => ({ id: token.id, collectionId: '', dna: token.dna })),
    attributeKeyOf(buildTraitIndex(layers)),
  )
  const ranks: number[] = []
  for (const token of ranked) ranks[token.id - 1] = token.rank
  return ranks
}

/**
 * Records the ranks of the collection's done real job unless they are there: skipped for a collection that is
 * not generative or has no done real job, present when the owner reads a row for the job, else ranked from the
 * collection's `tokens` rows and the layers, and recorded with the service client. A generative job's list is
 * those rows: `art_lock` checks them against the job's hash and stores no `token_list` for them, the lock keeps
 * them as they are, and the worker renders them. Throws on a failed read or record; every caller logs that and
 * goes on.
 */
export async function ensureTokenRanksCore(ctx: PhasesContext): Promise<'recorded' | 'present' | 'skipped'> {
  const { collection } = ctx
  if (collection.project_type !== 'generative') return 'skipped'
  const job = await doneJobRow(ctx.supabase, collection.id, 'real')
  if (!job) return 'skipped'
  const present = await ctx.supabase.from('token_ranks').select('job_id').eq('job_id', job.id).maybeSingle()
  if (present.error) throw new Error(`The ranks could not be read: ${present.error.message}`)
  if (present.data) return 'present'
  const rows = await readArtRows(ctx.supabase, collection.id)
  const tokens = rows.tokens.map((row) => ({ id: row.token_id, dna: row.dna }))
  const layers = toProject({ collection, ...rows, tokens: [] }).layers ?? []
  const { data, error } = await ctx.service().rpc('token_ranks_record', {
    p_collection_id: collection.id,
    p_owner: ctx.owner,
    p_job_id: job.id,
    p_ranks: ranksOf(tokens, layers),
  })
  if (error) throw new Error(`The ranks could not be recorded: ${error.code} ${error.message}`)
  return data ? 'recorded' : 'present'
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `pnpm --filter @cobweb/web exec vitest run src/lib/mint/media.test.ts src/lib/mint/page-doc.test.ts src/lib/mint/ranks-core.test.ts`
Expected: PASS, `Test Files  3 passed (3)` and `Tests  17 passed (17)`.

- [ ] **Step 6: The bucket, the URLs and the reads**

In `apps/web/src/lib/storage/objects.ts`, replace:

```ts
import { s3, storageConfig } from './config.ts'

/** A PUT URL bound to the declared type and length, valid 15 minutes by default. */
export async function presignPut(
  key: string,
  mime: string,
  bytes: number,
  expiresSeconds = 900,
): Promise<string> {
  const { bucket } = storageConfig()
  const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: mime, ContentLength: bytes })
  // Signing content-type makes the type part of the URL, next to content-length and host.
```

with:

```ts
import { s3, storageConfig } from './config.ts'

/** A PUT URL bound to the declared type and length, valid 15 minutes by default, on the art bucket unless another is named. */
export async function presignPut(
  key: string,
  mime: string,
  bytes: number,
  expiresSeconds = 900,
  options: { bucket?: string } = {},
): Promise<string> {
  const bucket = options.bucket ?? storageConfig().bucket
  const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: mime, ContentLength: bytes })
  // Signing content-type makes the type part of the URL, next to content-length and host.
```

In `apps/web/src/lib/storage/objects.ts`, replace:

```ts

/**
 * Size and type of a stored object. Null means "no object at this key". A missing bucket also
 * HEADs as 404, so a wrongly configured bucket looks like a missing object; callers that treat
 * null as "not uploaded yet" should know that.
 */
export async function headObject(key: string): Promise<{ bytes: number; mime: string | null } | null> {
  const { bucket } = storageConfig()
  try {
    const head = await s3().send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
```

with:

```ts

/**
 * Size and type of a stored object, on the art bucket unless another is named. Null means "no object at
 * this key". A missing bucket also HEADs as 404, so a wrongly configured bucket looks like a missing object;
 * callers that treat null as "not uploaded yet" should know that.
 */
export async function headObject(
  key: string,
  options: { bucket?: string } = {},
): Promise<{ bytes: number; mime: string | null } | null> {
  const bucket = options.bucket ?? storageConfig().bucket
  try {
    const head = await s3().send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
```

In `apps/web/src/lib/storage/objects.ts`, replace:

```ts
}

export async function deleteObjects(keys: string[]): Promise<void> {
  if (keys.length === 0) return
  const { bucket } = storageConfig()
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000)
```

with:

```ts
}

/** Deletes the objects, on the art bucket unless another is named. */
export async function deleteObjects(keys: string[], options: { bucket?: string } = {}): Promise<void> {
  if (keys.length === 0) return
  const bucket = options.bucket ?? storageConfig().bucket
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000)
```

In `apps/web/src/lib/storage/config.ts`, replace:

```ts
}

let client: S3Client | null = null

```

with:

```ts
}

/**
 * The public bucket of the mint page's media (`MINT_PAGE_S3_BUCKET`, default `mint-page`), behind the same
 * endpoint and credentials as the art bucket (docs/specs/2026-10-16-mint-page-live-data.md, section 4.4).
 */
export function mintPageBucket(): string {
  return process.env.MINT_PAGE_S3_BUCKET || 'mint-page'
}

let client: S3Client | null = null

```

Create `apps/web/src/lib/mint/page-urls.ts`:

```ts
import { mintPageBucket } from '@/lib/storage/config'

/**
 * Where the public page's files are read (docs/specs/2026-10-16-mint-page-live-data.md, sections 6.1 and 7.7),
 * and the tag its cached document is kept under. Server only (the storage config carries the marker); free of
 * Next's modules, so the settings core and verify:mint-page use it outside a request. page-read.ts re-exports it.
 */

/** The tag the Mint page tab's actions expire on save. */
export const mintPageTag = (slug: string) => `mint-page:${slug}`

const trimSlash = (url: string) => url.replace(/\/+$/, '')

/** The public base of the mint-page bucket: `MINT_PAGE_MEDIA_URL`, else Supabase Storage's public URL for it. */
export function mediaBase(): string {
  const base = process.env.MINT_PAGE_MEDIA_URL
  if (base) return trimSlash(base)
  return `${trimSlash(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')}/storage/v1/object/public/${mintPageBucket()}`
}

/** An object's public URL. */
export const mediaUrl = (key: string) => `${mediaBase()}/${key}`

/** The IPFS gateway token art is read through: `IPFS_GATEWAY_URL`, else https://ipfs.io/ipfs. */
export function ipfsGateway(): string {
  return trimSlash(process.env.IPFS_GATEWAY_URL || 'https://ipfs.io/ipfs')
}
```

Create `apps/web/src/lib/mint/page-read.ts`:

```ts
import 'server-only'
import { createClient } from '@supabase/supabase-js'
import { unstable_cache } from 'next/cache'
import type { Database } from '@/lib/database.types'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { pageDocSchema, pageStaticOf, type MintPageStatic } from './page-doc'
import { ipfsGateway, mediaUrl, mintPageTag } from './page-urls'

export { ipfsGateway, mediaBase, mediaUrl, mintPageTag } from './page-urls'

/**
 * The public page's read (docs/specs/2026-10-16-mint-page-live-data.md, section 6.1): the document of a
 * published page through a client with no session, cached under the link's tag for 60 s, so the database sees
 * one read per link a minute whatever the number of visitors; and the owner's preview through the session,
 * uncached. Keys become URLs on the public media base; token art is read through the IPFS gateway (both in
 * page-urls.ts, re-exported here).
 */

/** The publishable key's client, with no session: every visitor reads the same document. */
function publicClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  )
}

const pageOf = (raw: unknown) =>
  pageStaticOf(pageDocSchema.parse(raw), { media: mediaUrl, gateway: ipfsGateway() })

/** The links are lowercase, so `/Night-Owls` reads and is tagged as `night-owls`. */
const linkOf = (slug: string) => slug.trim().toLowerCase()

/**
 * The published page at a link, or null. A failed read throws, so the cached page keeps being served; a
 * document that does not parse throws too.
 */
export async function readMintPage(slug: string): Promise<MintPageStatic | null> {
  const link = linkOf(slug)
  const raw = await unstable_cache(
    async () => {
      const { data, error } = await publicClient().rpc('mint_page', { p_slug: link })
      if (error) throw new Error(`The mint page could not be read: ${error.code} ${error.message}`)
      return data
    },
    ['mint-page', link],
    { tags: [mintPageTag(link)], revalidate: 60 },
  )()
  return raw === null ? null : pageOf(raw)
}

/** The page at a link for its signed-in owner, published or not, or null for anyone else. Uncached. */
export async function readMintPagePreview(
  slug: string,
): Promise<(MintPageStatic & { published: boolean }) | null> {
  const supabase = await createSessionClient()
  const { data, error } = await supabase.rpc('mint_page_preview', { p_slug: linkOf(slug) })
  if (error) throw new Error(`The mint page preview could not be read: ${error.code} ${error.message}`)
  if (data === null) return null
  const page = pageOf(data)
  return page && { ...page, published: pageDocSchema.parse(data).published }
}
```

- [ ] **Step 7: The settings core and the actions**

A save writes the row in two steps (Decision 4); a published page's save records its ranks, and so does a confirmed reveal in Settings.

Create `apps/web/src/lib/mint/settings-core.ts`:

```ts
import { z } from 'zod'
import type { DbError } from '@/lib/art/db-error'
import { errorSummary } from '@/lib/art/lock-core'
import {
  NOT_DEPLOYED,
  PAGE_FIELDS,
  PAGE_FILE_MISSING,
  PAGE_LINK_FIRST,
  PAGE_NOT_PUBLIC,
  UNSAVED,
} from '@/lib/art/result'
import type { Tables, TablesUpdate } from '@/lib/database.types'
import { doneJobRow, type DeployOutcome } from '@/lib/deploy/deploy-core'
import type { Socials } from '@/lib/demo/types'
import type { PhasesContext } from '@/lib/manage/phases-core'
import { mintPageBucket } from '@/lib/storage/config'
import { deleteObjects, headObject, presignPut } from '@/lib/storage/objects'
import {
  keyBelongs,
  MEDIA_SLOTS,
  mimeOfKey,
  mintPageKey,
  mintPageMediaProblem,
  type MediaSlot,
} from './media'
import {
  sectionsSchema,
  storedSectionsOf,
  type MintPageStatic,
  type StoredMember,
  type StoredSections,
  type StoredTokenSlide,
  type StoredUploadSlide,
} from './page-doc'
import { mediaUrl } from './page-urls'
import { ensureTokenRanksCore } from './ranks-core'

/**
 * The Mint page tab on the server (docs/specs/2026-10-16-mint-page-live-data.md, section 6.2): the tab's view
 * of the `mint_pages` row, the presigned PUTs a save needs on the mint-page bucket, the save of the whole draft
 * and the Overview's public switch, on a Supabase client acting as the signed-in creator. The actions
 * (app/actions/mint-page.ts) call these after the session and ownership check; verify:mint-page calls them
 * with a signed-in script client. No `server-only` marker, so the script can import it; the browser imports
 * its types only.
 */

/** A file the browser asks to upload: its slot, its facts and its SHA-256. */
export type MediaAsk = {
  slot: MediaSlot
  mime: string
  bytes: number
  width: number | null
  height: number | null
  contentHash: string
}

/** A stored file as the tab edits it: its key and where it reads. */
export type MediaRef = { key: string; url: string }

/** The sections as the tab edits them: keys and URLs side by side. */
export type EditableMember = StoredMember & { imageUrl: string | null }
export type EditableSlide = (StoredUploadSlide & { url: string }) | StoredTokenSlide
export type EditableSections = {
  team: { enabled: boolean; members: EditableMember[] }
  roadmap: StoredSections['roadmap']
  faq: StoredSections['faq']
  music: StoredSections['music'] & { url: string | null }
  carousel: { enabled: boolean; items: EditableSlide[] }
}

/** What the Mint page tab shows and saves. `art` tells it which tokens it can feature and where their metadata is. */
export type MintPageSettingsView = {
  published: boolean
  description: string
  media: Record<'banner' | 'avatar' | 'about', MediaRef | null>
  socials: Socials
  featuredTokenIds: number[]
  sections: EditableSections
  art: { realBaseUri: string | null; supply: number; projectType: MintPageStatic['projectType'] }
}

/** The row's editable fields as a save sends them: keys, not URLs. */
export type MintPageInput = {
  published: boolean
  description: string
  media: Record<'banner' | 'avatar' | 'about', string | null>
  socials: { website: string | null; x: string | null; discord: string | null; telegram: string | null }
  featuredTokenIds: number[]
  sections: StoredSections
}

/** The most files one save can name: three page images, twelve team photos, five slides and the music. */
export const MEDIA_ASKS_MAX = 21

export const mediaAsksSchema: z.ZodType<MediaAsk[]> = z
  .array(
    z.object({
      slot: z.enum(['banner', 'avatar', 'about', 'team', 'slide', 'music']),
      mime: z.string().max(64),
      bytes: z.number().int().min(1),
      width: z.number().int().min(1).nullable(),
      height: z.number().int().min(1).nullable(),
      contentHash: z.string().regex(/^[0-9a-f]{64}$/),
    }),
    { error: UNSAVED },
  )
  .min(1, UNSAVED)
  .max(MEDIA_ASKS_MAX, UNSAVED)

/** A page link: https, up to 200 characters, on the hosts the database's checks name. */
const pageLink = (pattern: RegExp) => z.string().max(200).regex(pattern).nullable()

export const mintPageInputSchema: z.ZodType<MintPageInput> = z.object({
  published: z.boolean(),
  description: z.string().max(2000),
  media: z.object({
    banner: z.string().nullable(),
    avatar: z.string().nullable(),
    about: z.string().nullable(),
  }),
  socials: z.object({
    website: pageLink(/^https:\/\/\S+$/),
    x: pageLink(/^https:\/\/(www\.)?(x|twitter)\.com\/\S+$/),
    discord: pageLink(/^https:\/\/(www\.)?discord\.(gg|com)\/\S+$/),
    telegram: pageLink(/^https:\/\/(www\.)?(t|telegram)\.me\/\S+$/),
  }),
  featuredTokenIds: z
    .array(z.number().int().min(1))
    .max(6)
    .refine((ids) => new Set(ids).size === ids.length),
  sections: sectionsSchema,
})

const ROW_COLUMNS =
  'published, description, banner_key, avatar_key, about_banner_key, website_url, x_url, discord_url, telegram_url, featured_token_ids, sections'
type PageRow = Pick<
  Tables<'mint_pages'>,
  | 'published'
  | 'description'
  | 'banner_key'
  | 'avatar_key'
  | 'about_banner_key'
  | 'website_url'
  | 'x_url'
  | 'discord_url'
  | 'telegram_url'
  | 'featured_token_ids'
  | 'sections'
>

/** The sections with each stored key's URL beside it. */
export function editableSectionsOf(stored: StoredSections, url: (key: string) => string): EditableSections {
  return {
    team: {
      enabled: stored.team.enabled,
      members: stored.team.members.map((member) => ({
        ...member,
        imageUrl: member.imageKey === null ? null : url(member.imageKey),
      })),
    },
    roadmap: stored.roadmap,
    faq: stored.faq,
    music: { ...stored.music, url: stored.music.key === null ? null : url(stored.music.key) },
    carousel: {
      enabled: stored.carousel.enabled,
      items: stored.carousel.items.map((slide) =>
        slide.kind === 'token' ? slide : { ...slide, url: url(slide.key) },
      ),
    },
  }
}

/** Every media key a row, or a save, names, with its slot. */
function keysOf(fields: {
  banner: string | null
  avatar: string | null
  about: string | null
  sections: StoredSections
}): { key: string; slot: MediaSlot }[] {
  const keys: { key: string; slot: MediaSlot }[] = []
  const add = (key: string | null, slot: MediaSlot) => {
    if (key !== null) keys.push({ key, slot })
  }
  add(fields.banner, 'banner')
  add(fields.avatar, 'avatar')
  add(fields.about, 'about')
  for (const member of fields.sections.team.members) add(member.imageKey, 'team')
  for (const slide of fields.sections.carousel.items) if (slide.kind === 'upload') add(slide.key, 'slide')
  add(fields.sections.music.key, 'music')
  return keys
}

const rowKeys = (row: PageRow) =>
  keysOf({
    banner: row.banner_key,
    avatar: row.avatar_key,
    about: row.about_banner_key,
    sections: storedSectionsOf(row.sections),
  })

/** Whether the collection has a deployment, under the creator's client: every core needs one. */
async function deployed(ctx: PhasesContext): Promise<boolean> {
  const { data, error } = await ctx.supabase
    .from('deployments')
    .select('collection_id')
    .eq('collection_id', ctx.collection.id)
    .maybeSingle()
  if (error) throw new Error(`The deployment could not be read: ${error.message}`)
  return data !== null
}

async function readRow(ctx: PhasesContext): Promise<PageRow | null> {
  const { data, error } = await ctx.supabase
    .from('mint_pages')
    .select(ROW_COLUMNS)
    .eq('collection_id', ctx.collection.id)
    .maybeSingle()
  if (error) throw new Error(`The mint page could not be read: ${error.message}`)
  return data
}

async function viewOf(ctx: PhasesContext, row: PageRow | null): Promise<MintPageSettingsView> {
  const real = await doneJobRow(ctx.supabase, ctx.collection.id, 'real')
  const ref = (key: string | null): MediaRef | null => (key === null ? null : { key, url: mediaUrl(key) })
  const socials: Socials = {}
  if (row?.website_url) socials.website = row.website_url
  if (row?.x_url) socials.x = row.x_url
  if (row?.discord_url) socials.discord = row.discord_url
  if (row?.telegram_url) socials.telegram = row.telegram_url
  return {
    published: row?.published ?? false,
    description: row?.description ?? '',
    media: {
      banner: ref(row?.banner_key ?? null),
      avatar: ref(row?.avatar_key ?? null),
      about: ref(row?.about_banner_key ?? null),
    },
    socials,
    featuredTokenIds: row?.featured_token_ids ?? [],
    sections: editableSectionsOf(storedSectionsOf(row?.sections), mediaUrl),
    art: {
      realBaseUri: real?.base_uri ?? null,
      supply: ctx.collection.max_supply ?? 0,
      projectType: ctx.collection.project_type,
    },
  }
}

/** A refused write in the creator's words: the trigger's own sentence, else a check's; anything else is an error. */
function refusalOf(error: DbError & object): { refused: string } | { error: DbError } {
  if (error.code === '23514')
    return { refused: error.message === PAGE_NOT_PUBLIC ? PAGE_NOT_PUBLIC : PAGE_FIELDS }
  return { error }
}

/**
 * Writes the row's fields: an insert that does nothing when the row exists, then the update, so the owner never
 * needs a right on `collection_id` beyond the insert's.
 */
async function writeRow(ctx: PhasesContext, fields: TablesUpdate<'mint_pages'>) {
  const ensured = await ctx.supabase
    .from('mint_pages')
    .upsert({ collection_id: ctx.collection.id }, { onConflict: 'collection_id', ignoreDuplicates: true })
  if (ensured.error) return { error: ensured.error }
  return ctx.supabase
    .from('mint_pages')
    .update(fields)
    .eq('collection_id', ctx.collection.id)
    .select(ROW_COLUMNS)
    .single()
}

/** Records the ranks for a published page; a failure is logged and never fails the save. */
async function rank(ctx: PhasesContext): Promise<void> {
  try {
    await ensureTokenRanksCore(ctx)
  } catch (error) {
    console.error(`The ranks of ${ctx.collection.id} could not be recorded: ${errorSummary(error)}`)
  }
}

/** The tab's view: the row (the defaults without one), its keys with their URLs and the art the tab features from. */
export async function mintPageSettingsCore(ctx: PhasesContext): Promise<DeployOutcome<MintPageSettingsView>> {
  if (!(await deployed(ctx))) return { refused: NOT_DEPLOYED }
  return { data: await viewOf(ctx, await readRow(ctx)) }
}

/**
 * The PUT URLs a save needs, one per file: each file refused in its slot's words, an object already stored at
 * its key with the same length and type answering no URL, else a URL on the mint-page bucket bound to the type
 * and the length, valid 15 minutes.
 */
export async function presignMintPageMediaCore(
  ctx: PhasesContext,
  asks: MediaAsk[],
): Promise<DeployOutcome<{ key: string; putUrl: string | null }[]>> {
  if (!(await deployed(ctx))) return { refused: NOT_DEPLOYED }
  for (const ask of asks) {
    const problem = mintPageMediaProblem(ask.slot, ask)
    if (problem) return { refused: problem }
  }
  const bucket = mintPageBucket()
  const signed = await Promise.all(
    asks.map(async (ask) => {
      const key = mintPageKey(ctx.collection.id, ask.contentHash, ask.mime)
      const head = await headObject(key, { bucket })
      if (head && head.bytes === ask.bytes && head.mime === ask.mime) return { key, putUrl: null }
      return { key, putUrl: await presignPut(key, ask.mime, ask.bytes, 900, { bucket }) }
    }),
  )
  return { data: signed }
}

/** Whether a stored object is of its slot's types, matches its key's extension and is within the slot's cap. */
function fits(slot: MediaSlot, key: string, head: { bytes: number; mime: string | null }): boolean {
  const rule = MEDIA_SLOTS[slot]
  if (head.mime === null || head.mime !== mimeOfKey(key) || !rule.types.includes(head.mime)) return false
  return head.bytes <= (rule.maxBytes[head.mime] ?? 0)
}

/**
 * Saves the whole draft (the action parsed it with `mintPageInputSchema`): featured tokens and token slides
 * within the supply, every key the collection's, each key the stored row does not name already uploaded within
 * its slot's cap, then the row; then the objects the old row named and the new one does not are deleted, and a
 * published page has its ranks recorded (both logged on failure, never the save's).
 */
export async function saveMintPageCore(
  ctx: PhasesContext,
  input: MintPageInput,
): Promise<DeployOutcome<MintPageSettingsView>> {
  if (!(await deployed(ctx))) return { refused: NOT_DEPLOYED }
  const { collection } = ctx
  const supply = collection.max_supply ?? 0
  const tokenSlides = input.sections.carousel.items.flatMap((slide) =>
    slide.kind === 'token' ? [slide.tokenId] : [],
  )
  if ([...input.featuredTokenIds, ...tokenSlides].some((id) => id > supply)) return { refused: PAGE_FIELDS }
  if (input.published && !collection.slug) return { refused: PAGE_LINK_FIRST }
  const keys = keysOf({ ...input.media, sections: input.sections })
  if (keys.some(({ key, slot }) => !keyBelongs(collection.id, key, slot))) return { refused: PAGE_FIELDS }
  const old = await readRow(ctx)
  const stored = new Set(old ? rowKeys(old).map(({ key }) => key) : [])
  const bucket = mintPageBucket()
  for (const { key, slot } of keys) {
    if (stored.has(key)) continue
    const head = await headObject(key, { bucket })
    if (!head || !fits(slot, key, head)) return { refused: PAGE_FILE_MISSING }
  }
  const saved = await writeRow(ctx, {
    published: input.published,
    description: input.description,
    banner_key: input.media.banner,
    avatar_key: input.media.avatar,
    about_banner_key: input.media.about,
    website_url: input.socials.website,
    x_url: input.socials.x,
    discord_url: input.socials.discord,
    telegram_url: input.socials.telegram,
    featured_token_ids: input.featuredTokenIds,
    sections: input.sections,
  })
  if ('error' in saved && saved.error) return refusalOf(saved.error)
  const row = 'data' in saved ? saved.data : null
  if (!row) return { refused: PAGE_FIELDS }
  const kept = new Set(keys.map(({ key }) => key))
  const replaced = [...stored].filter((key) => !kept.has(key))
  try {
    await deleteObjects(replaced, { bucket })
  } catch (error) {
    console.error(`The replaced media of ${collection.id} could not be deleted: ${errorSummary(error)}`)
  }
  if (row.published) await rank(ctx)
  return { data: await viewOf(ctx, row) }
}

/** The Overview's public switch: a page goes public only with a link, and the trigger checks the deployment again. */
export async function setMintPagePublishedCore(
  ctx: PhasesContext,
  published: boolean,
): Promise<DeployOutcome<{ published: boolean }>> {
  if (!(await deployed(ctx))) return { refused: NOT_DEPLOYED }
  if (published && !ctx.collection.slug) return { refused: PAGE_LINK_FIRST }
  const saved = await writeRow(ctx, { published })
  if ('error' in saved && saved.error) {
    if (saved.error.code === '23514') return { refused: saved.error.message }
    return { error: saved.error }
  }
  if (published) await rank(ctx)
  return { data: { published } }
}
```

Create `apps/web/src/app/actions/mint-page.ts`:

```ts
'use server'

import { revalidatePath, updateTag } from 'next/cache'
import { z } from 'zod'
import { fail, PAGE_FIELDS, UNSAVED, type ActionResult } from '@/lib/art/result'
import { parse } from '@/lib/art/schemas'
import { phasesWrite } from '@/lib/manage/phases-write'
import { mintPageTag } from '@/lib/mint/page-urls'
import {
  mediaAsksSchema,
  mintPageInputSchema,
  mintPageSettingsCore,
  presignMintPageMediaCore,
  saveMintPageCore,
  setMintPagePublishedCore,
  type MediaAsk,
  type MintPageInput,
  type MintPageSettingsView,
} from '@/lib/mint/settings-core'

/**
 * The Mint page tab's server actions (docs/specs/2026-10-16-mint-page-live-data.md, section 6.2). Each checks
 * its input first, then runs through `phasesWrite`, which checks the session and the ownership (CLAUDE.md rule
 * 4). A save or a switch that lands expires the page's cached document, so the public page shows it on its next
 * visit, and the workspace's pages.
 */

/** Expires the public page's tag and the workspace's pages after a write. */
function expire(slug: string | null): void {
  if (slug) updateTag(mintPageTag(slug))
  revalidatePath('/collections/[id]', 'layout')
}

/** The tab's row with its media, sections and the art it can feature. */
export async function getMintPageSettings(collectionId: string): Promise<ActionResult<MintPageSettingsView>> {
  return phasesWrite(collectionId, (ctx) => mintPageSettingsCore(ctx))
}

/** The PUT URLs for the files a save needs, each checked against its slot first. */
export async function presignMintPageMedia(
  collectionId: string,
  asks: MediaAsk[],
): Promise<ActionResult<{ key: string; putUrl: string | null }[]>> {
  const input = parse(mediaAsksSchema, asks)
  if (!input.ok) return input
  return phasesWrite(collectionId, (ctx) => presignMintPageMediaCore(ctx, input.data))
}

/** Saves the whole draft once its files are uploaded, then answers the saved view. */
export async function saveMintPage(
  collectionId: string,
  input: MintPageInput,
): Promise<ActionResult<MintPageSettingsView>> {
  const draft = mintPageInputSchema.safeParse(input)
  if (!draft.success) return fail(PAGE_FIELDS)
  let slug: string | null = null
  const result = await phasesWrite(collectionId, (ctx) => {
    slug = ctx.collection.slug
    return saveMintPageCore(ctx, draft.data)
  })
  if (result.ok) expire(slug)
  return result
}

/** The Overview's public switch. */
export async function setMintPagePublished(
  collectionId: string,
  published: boolean,
): Promise<ActionResult<{ published: boolean }>> {
  const value = parse(z.boolean({ error: UNSAVED }), published)
  if (!value.ok) return value
  let slug: string | null = null
  const result = await phasesWrite(collectionId, (ctx) => {
    slug = ctx.collection.slug
    return setMintPagePublishedCore(ctx, value.data)
  })
  if (result.ok) expire(slug)
  return result
}
```

In `apps/web/src/app/actions/settings.ts`, replace:

```ts
import { cache } from 'react'
import { manageRecordError } from '@/lib/art/db-error'
import { txHash as txHashSchema } from '@/lib/art/lock-schemas'
import type { ActionResult } from '@/lib/art/result'
```

with:

```ts
import { cache } from 'react'
import { manageRecordError } from '@/lib/art/db-error'
import { errorSummary } from '@/lib/art/lock-core'
import { txHash as txHashSchema } from '@/lib/art/lock-schemas'
import type { ActionResult } from '@/lib/art/result'
```

In `apps/web/src/app/actions/settings.ts`, replace:

```ts
import { confirmSettingsTxCore, readSettingsState, settingsViewCore } from '@/lib/manage/settings-core'
import type { SettingsView } from '@/lib/manage/settings-types'

/**
 * Settings' server actions (docs/specs/2026-10-15-airdrop-settings.md, section 6.5). Each checks its input first,
 * then runs through `phasesWrite`, which checks the session and the ownership (CLAUDE.md rule 4), with the record
 * functions' sentences for a database refusal. A confirm takes the hash and the call the browser sent, checked
 * against the Settings functions; the server proves the change from its receipt and reads the chain again.
 */

```

with:

```ts
import { confirmSettingsTxCore, readSettingsState, settingsViewCore } from '@/lib/manage/settings-core'
import type { SettingsView } from '@/lib/manage/settings-types'
import { ensureTokenRanksCore } from '@/lib/mint/ranks-core'

/**
 * Settings' server actions (docs/specs/2026-10-15-airdrop-settings.md, section 6.5). Each checks its input first,
 * then runs through `phasesWrite`, which checks the session and the ownership (CLAUDE.md rule 4), with the record
 * functions' sentences for a database refusal. A confirm takes the hash and the call the browser sent, checked
 * against the Settings functions; the server proves the change from its receipt and reads the chain again. A
 * confirmed reveal records the rendered set's ranks for the mint page (docs/specs/2026-10-16-mint-page-live-data.md,
 * section 6.3).
 */

```

In `apps/web/src/app/actions/settings.ts`, replace:

```ts
  const call = parseSentCall(sent, SETTINGS_FUNCTIONS)
  if (!call.ok) return call
  return phasesWrite(
    collectionId,
    (ctx) => confirmSettingsTxCore(ctx, hash.data, callOf(call.data)),
    manageRecordError,
  )
```

with:

```ts
  const call = parseSentCall(sent, SETTINGS_FUNCTIONS)
  if (!call.ok) return call
  const confirmed = callOf(call.data)
  return phasesWrite(
    collectionId,
    async (ctx) => {
      const outcome = await confirmSettingsTxCore(ctx, hash.data, confirmed)
      // A failure is logged and the confirm's answer is unchanged.
      if ('data' in outcome && confirmed.functionName === 'setBaseURI' && outcome.data.pointer === 'revealed')
        await ensureTokenRanksCore(ctx).catch((error: unknown) =>
          console.error(`The ranks of ${ctx.collection.id} could not be recorded: ${errorSummary(error)}`),
        )
      return outcome
    },
    manageRecordError,
  )
```

In `apps/web/src/app/actions/mint-page-address.ts`, replace:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getVerifiedUser } from '@/lib/auth'
import { slugSchema } from '@/lib/collections'
import { createClient } from '@/lib/supabase/server'

```

with:

```ts
'use server'

import { revalidatePath, updateTag } from 'next/cache'
import { z } from 'zod'
import { getVerifiedUser } from '@/lib/auth'
import { slugSchema } from '@/lib/collections'
import { mintPageTag } from '@/lib/mint/page-urls'
import { createClient } from '@/lib/supabase/server'

```

In `apps/web/src/app/actions/mint-page-address.ts`, replace:

```ts
 * reservation lasts 3 days; on a deployed collection without a link it is kept at once.
 * The database function `reserve_slug` checks ownership again, takes over a lapsed reservation and
 * (until a migration allows it) refuses to change the link of a deployed collection.
 */
export async function reserveSlug(collectionId: string, slug: string): Promise<ReserveSlugResult> {
```

with:

```ts
 * reservation lasts 3 days; on a deployed collection without a link it is kept at once.
 * The database function `reserve_slug` checks ownership again, takes over a lapsed reservation and
 * (until a migration allows it) refuses to change the link of a deployed collection. A link saved on a deployed
 * collection expires its mint page's tag, since a not-found answer may be cached for it.
 */
export async function reserveSlug(collectionId: string, slug: string): Promise<ReserveSlugResult> {
```

In `apps/web/src/app/actions/mint-page-address.ts`, replace:

```ts
  const { data: current } = await supabase
    .from('collections')
    .select('id, owner_id')
    .eq('id', parsed.data.collectionId)
    .maybeSingle()
```

with:

```ts
  const { data: current } = await supabase
    .from('collections')
    .select('id, owner_id, status')
    .eq('id', parsed.data.collectionId)
    .maybeSingle()
```

In `apps/web/src/app/actions/mint-page-address.ts`, replace:

```ts
    .maybeSingle()

  revalidatePath('/collections/[id]', 'layout')
  return { ok: true, slug: saved?.slug ?? parsed.data.slug, reservedAt: saved?.slug_reserved_at ?? null }
}
```

with:

```ts
    .maybeSingle()

  const savedSlug = saved?.slug ?? parsed.data.slug
  if (current.status === 'deployed') updateTag(mintPageTag(savedSlug))
  revalidatePath('/collections/[id]', 'layout')
  return { ok: true, slug: savedSlug, reservedAt: saved?.slug_reserved_at ?? null }
}
```

In `apps/web/.env.example`, replace:

```
COBWEB_TEST_CHAINS=

# The render bucket (server only; never NEXT_PUBLIC_): the preview collages the render worker writes.
# Local: the "render" bucket in Supabase Storage, created by `supabase seed buckets`. Production: the
```

with:

```
COBWEB_TEST_CHAINS=

# The mint page's media (server only; never NEXT_PUBLIC_): the public bucket the Mint page tab uploads the
# banner, avatar, About banner, team photos, slides and music to, behind the art bucket's endpoint and keys.
# Local: the "mint-page" bucket in Supabase Storage, created by `supabase seed buckets`. Production: a public R2
# bucket on a custom domain, with the art bucket's CORS rule for PUT from the app origin.
MINT_PAGE_S3_BUCKET=mint-page
# The bucket's public base, which the page links its files from. Empty: Supabase Storage's public URL for it
# (<NEXT_PUBLIC_SUPABASE_URL>/storage/v1/object/public/<bucket>). Production: the R2 bucket's custom domain.
MINT_PAGE_MEDIA_URL=

# The IPFS gateway the mint page reads token metadata and art through (server only; the page receives it with
# its content). A public gateway with no key in the URL. Empty: https://ipfs.io/ipfs.
IPFS_GATEWAY_URL=

# The render bucket (server only; never NEXT_PUBLIC_): the preview collages the render worker writes.
# Local: the "render" bucket in Supabase Storage, created by `supabase seed buckets`. Production: the
```

- [ ] **Step 8: Typecheck and lint the web app**

Run: `pnpm --filter @cobweb/web typecheck && pnpm --filter @cobweb/web lint`
Expected: no errors and no warnings.

- [ ] **Step 9: Format, run the root checks and commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
pnpm exec prettier --write apps/web/src/lib/mint/media.ts apps/web/src/lib/mint/media.test.ts apps/web/src/lib/mint/page-doc.ts apps/web/src/lib/mint/page-doc.test.ts apps/web/src/lib/mint/page-urls.ts apps/web/src/lib/mint/page-read.ts apps/web/src/lib/mint/ranks-core.ts apps/web/src/lib/mint/ranks-core.test.ts apps/web/src/lib/mint/settings-core.ts apps/web/src/app/actions/mint-page.ts apps/web/src/app/actions/settings.ts apps/web/src/app/actions/mint-page-address.ts apps/web/src/lib/art/result.ts apps/web/src/lib/manage/phases-types.ts apps/web/src/lib/manage/phases-view.ts apps/web/src/lib/storage/objects.ts apps/web/src/lib/storage/config.ts
pnpm typecheck && pnpm lint && pnpm test
git add apps/web/src/lib/mint/media.ts apps/web/src/lib/mint/media.test.ts apps/web/src/lib/mint/page-doc.ts apps/web/src/lib/mint/page-doc.test.ts apps/web/src/lib/mint/page-urls.ts apps/web/src/lib/mint/page-read.ts apps/web/src/lib/mint/ranks-core.ts apps/web/src/lib/mint/ranks-core.test.ts apps/web/src/lib/mint/settings-core.ts apps/web/src/app/actions/mint-page.ts apps/web/src/app/actions/settings.ts apps/web/src/app/actions/mint-page-address.ts apps/web/src/lib/art/result.ts apps/web/src/lib/manage/phases-types.ts apps/web/src/lib/manage/phases-view.ts apps/web/src/lib/storage/objects.ts apps/web/src/lib/storage/config.ts apps/web/.env.example
git commit -m "$(cat <<'EOF'
Serve the Mint page tab from the server: the media slots and keys on the mint-page bucket, the stored sections and the page's document, the cached public read and the owner's preview, the ranks, and the four actions, with the reveal's ranks in Settings

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: the web app reports 714 tests in 77 files; the other packages are unchanged.

---

### Task 3: The freshness server's wire types and paths in the shared package

**Files:**

- Create: `packages/shared/src/freshness-wire.ts`, `packages/shared/src/freshness-wire.test.ts`
- Modify: `packages/shared/src/index.ts` (one export), `apps/freshness/src/state-body.ts`, `wallet.ts`, `routes.ts` (each imports its types from the shared package and re-exports them), `apps/freshness/src/routes.test.ts` (one case)
- Test: `packages/shared/src/freshness-wire.test.ts`, `apps/freshness/src/routes.test.ts`, then `verify:freshness`

**Interfaces:**

- Consumes: `ChainGroup` from `packages/shared/src/collection-state.ts`; the freshness server's `stateBody`, `walletWindows` and `routeOf`, unchanged in behaviour.
- Produces: in `@cobweb/shared` (the browser entry): `StateBody`, `QuotaBody`, `WalletBody`, `RefusalCode` (moved from `apps/freshness` unchanged), `statePath(chainId: number, address: Address): string` (`/v1/state/<chain id>/<lowercase collection>`) and `walletPath(chainId: number, address: Address, wallet: Address): string` (`/v1/wallet/<chain id>/<lowercase collection>/<lowercase wallet>`). `state-body.ts`, `wallet.ts` and `routes.ts` re-export the moved types, so `@cobweb/freshness/server` and every importer keep their imports.

- [ ] **Step 1: Write the failing tests**

Create `packages/shared/src/freshness-wire.test.ts`:

```ts
import type { Address } from 'viem'
import { describe, expect, it } from 'vitest'
import { statePath, walletPath } from './freshness-wire.ts'

const COLLECTION: Address = '0x0409454C375c8a6aB05383bFB6D9FcDe9ebB8F85'
const WALLET: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'

describe('the freshness paths (docs/specs/2026-10-16-mint-page-live-data.md, section 5)', () => {
  it('name the chain and the collection in lowercase', () => {
    expect(statePath(31337, COLLECTION)).toBe('/v1/state/31337/0x0409454c375c8a6ab05383bfb6d9fcde9ebb8f85')
  })

  it('name the wallet in lowercase too', () => {
    expect(walletPath(8453, COLLECTION, WALLET)).toBe(
      '/v1/wallet/8453/0x0409454c375c8a6ab05383bfb6d9fcde9ebb8f85/0x70997970c51812dc3a010c7d01b50e0d17dc79c8',
    )
  })
})
```

In `apps/freshness/src/routes.test.ts`, replace:

```ts
import type { Address } from 'viem'
import { describe, expect, it } from 'vitest'
```

with:

```ts
import { statePath, walletPath } from '@cobweb/shared'
import type { Address } from 'viem'
import { describe, expect, it } from 'vitest'
```

In `apps/freshness/src/routes.test.ts`, replace:

```ts

describe('routeOf (docs/specs/2026-10-16-freshness-server.md, section 6.7)', () => {
  it('routes the state, wallet and health paths, HEAD as GET, and the preflight', () => {
    expect(routeOf('GET', `/v1/state/31337/${lower(A)}`)).toEqual<Route>({
```

with:

```ts

describe('routeOf (docs/specs/2026-10-16-freshness-server.md, section 6.7)', () => {
  it('routes the paths the mint page builds with the shared package (docs/specs/2026-10-16-mint-page-live-data.md, section 5)', () => {
    expect(routeOf('GET', statePath(31337, A))).toEqual<Route>({ kind: 'state', chainId: 31337, address: A })
    expect(routeOf('GET', walletPath(31337, A, W))).toEqual<Route>({
      kind: 'wallet',
      chainId: 31337,
      address: A,
      wallet: W,
    })
  })

  it('routes the state, wallet and health paths, HEAD as GET, and the preflight', () => {
    expect(routeOf('GET', `/v1/state/31337/${lower(A)}`)).toEqual<Route>({
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @cobweb/shared exec vitest run src/freshness-wire.test.ts`
Expected: FAIL. The file fails to load with `Cannot find module './freshness-wire.ts'`: `Test Files  1 failed (1)` and `Tests  no tests`.

Run: `pnpm --filter @cobweb/freshness exec vitest run src/routes.test.ts`
Expected: FAIL. The new case fails with `TypeError: statePath is not a function`: `Tests  1 failed | 13 passed (14)`.

- [ ] **Step 3: The wire types and paths**

Create `packages/shared/src/freshness-wire.ts`:

```ts
import type { Address } from 'viem'
import type { ChainGroup } from './collection-state.ts'

/**
 * What the freshness server answers and where (docs/specs/2026-10-16-freshness-server.md, sections 6.7 and
 * 6.8), shared by the server, which writes these bodies, and the mint page, which polls them
 * (docs/specs/2026-10-16-mint-page-live-data.md, section 5). Types and two path builders; no ABI.
 */

/**
 * The state endpoint's body. Liveness is each group's `active`, the contract's own; the times only label
 * countdowns.
 */
export type StateBody = {
  chainId: number
  /** Checksummed. */
  address: Address
  /** The block of the last read; it never goes back. */
  block: number
  blockTimestamp: number
  /** Unix seconds of the last successful read, on the server's clock. */
  readAt: number
  degraded: boolean
  maxSupply: number
  totalMinted: number
  publicMaxMintPerWallet: number
  mintFeeFlatWei: string
  mintFeeBps: number
  airdropFeePerTokenWei: string
  mintOnBehalfActive: boolean
  /** In the contract's order. */
  groups: ChainGroup[]
  owner: Address
  royalty: { receiver: Address; bps: number }
  baseUri: string
  transferValidator: Address
  transferLevel: 'none' | 'unread' | number
}

/** One registered group of `walletState`: the quota issued and claimed, both 0 for the public group. */
export type QuotaBody = { id: number; quota: number; claimed: number }

/** The wallet endpoint's body: a wallet's quotas in a collection, and those of up to 10 vaults that delegate to it. */
export type WalletBody = {
  chainId: number
  /** The collection, checksummed. */
  address: Address
  /** Checksummed. */
  wallet: Address
  /** The block the window read at. */
  block: number
  publicMinted: number
  groups: QuotaBody[]
  vaults: { vault: Address; publicMinted: number; groups: QuotaBody[] }[]
}

/** What a refusal's `{ "error": "<code>" }` names. */
export type RefusalCode =
  | 'bad-request'
  | 'not-found'
  | 'chain-not-served'
  | 'not-a-collection'
  | 'method-not-allowed'
  | 'chain-unreadable'
  | 'not-read-yet'
  | 'wallet-unreadable'
  | 'busy'
  | 'internal'

/** `/v1/state/<chain id>/<collection>`, the address in lowercase: one edge entry per collection. */
export function statePath(chainId: number, address: Address): string {
  return `/v1/state/${chainId}/${address.toLowerCase()}`
}

/** `/v1/wallet/<chain id>/<collection>/<wallet>`, both addresses in lowercase. */
export function walletPath(chainId: number, address: Address, wallet: Address): string {
  return `/v1/wallet/${chainId}/${address.toLowerCase()}/${wallet.toLowerCase()}`
}
```

In `packages/shared/src/index.ts`, replace:

```ts
// Browser-safe entry: the chain list, the factory ABI, the job ids, the render queue contract, the deploy
// address helpers, the transfer validator's and the delegate registry's ABIs, and the pure chain readers the
// web app and the freshness server share. Nothing here reads a server-only variable.
// Client code must never import `@cobweb/shared/server` (RPC URLs and viem public clients).
export * from './chains.ts'
export * from './collection-state.ts'
export * from './delegate-registry-abi.ts'
export * from './deploy-address.ts'
export * from './factory-abi.ts'
export * from './job-id.ts'
export * from './read-each.ts'
```

with:

```ts
// Browser-safe entry: the chain list, the factory ABI, the job ids, the render queue contract, the deploy
// address helpers, the transfer validator's and the delegate registry's ABIs, the pure chain readers the
// web app and the freshness server share, and the freshness server's wire types and paths. Nothing here reads
// a server-only variable.
// Client code must never import `@cobweb/shared/server` (RPC URLs and viem public clients).
export * from './chains.ts'
export * from './collection-state.ts'
export * from './delegate-registry-abi.ts'
export * from './deploy-address.ts'
export * from './factory-abi.ts'
export * from './freshness-wire.ts'
export * from './job-id.ts'
export * from './read-each.ts'
```

- [ ] **Step 4: The server takes them from the shared package**

In `apps/freshness/src/state-body.ts`, replace:

```ts
import { createHash } from 'node:crypto'
import type { ChainGroup } from '@cobweb/shared'
import type { Address } from 'viem'
import type { HotEntry } from './hot-set.ts'

/**
 * The state endpoint's body and its tag (docs/specs/2026-10-16-freshness-server.md, sections 6.7 and 6.10),
 * pure. Liveness is each group's `active`, the contract's own; the times only label countdowns.
 */
export type StateBody = {
  chainId: number
  /** Checksummed. */
  address: Address
  /** The block of the last read; it never goes back. */
  block: number
  blockTimestamp: number
  /** Unix seconds of the last successful read, on the server's clock. */
  readAt: number
  degraded: boolean
  maxSupply: number
  totalMinted: number
  publicMaxMintPerWallet: number
  mintFeeFlatWei: string
  mintFeeBps: number
  airdropFeePerTokenWei: string
  mintOnBehalfActive: boolean
  /** In the contract's order. */
  groups: ChainGroup[]
  owner: Address
  royalty: { receiver: Address; bps: number }
  baseUri: string
  transferValidator: Address
  transferLevel: 'none' | 'unread' | number
}

/** The body of an entry with a read, keys in this order and the groups in the contract's. */
```

with:

```ts
import { createHash } from 'node:crypto'
import type { StateBody } from '@cobweb/shared'
import type { HotEntry } from './hot-set.ts'

/**
 * The state endpoint's body and its tag (docs/specs/2026-10-16-freshness-server.md, sections 6.7 and 6.10),
 * pure. Liveness is each group's `active`, the contract's own; the times only label countdowns. The body's type
 * lives in the shared package with the paths, so the mint page reads what this writes.
 */
export type { StateBody }

/** The body of an entry with a read, keys in this order and the groups in the contract's. */
```

In `apps/freshness/src/wallet.ts`, replace:

```ts
import { DELEGATE_REGISTRY, delegateRegistryAbi, readEach, type ChainConfig } from '@cobweb/shared'
import { collectionAbi } from '@cobweb/shared/collection-abi'
import { getAddress, type Address, type ContractFunctionParameters, type PublicClient } from 'viem'
```

with:

```ts
import {
  DELEGATE_REGISTRY,
  delegateRegistryAbi,
  readEach,
  type ChainConfig,
  type QuotaBody,
  type WalletBody,
} from '@cobweb/shared'
import { collectionAbi } from '@cobweb/shared/collection-abi'
import { getAddress, type Address, type ContractFunctionParameters, type PublicClient } from 'viem'
```

In `apps/freshness/src/wallet.ts`, replace:

```ts
export const NULL_LISTING_LOG_EVERY_MS = 10_000

/** One registered group of `walletState`: the quota issued and claimed, both 0 for the public group. */
export type QuotaBody = { id: number; quota: number; claimed: number }

export type WalletBody = {
  chainId: number
  /** The collection, checksummed. */
  address: Address
  /** Checksummed. */
  wallet: Address
  /** The block the window read at. */
  block: number
  publicMinted: number
  groups: QuotaBody[]
  vaults: { vault: Address; publicMinted: number; groups: QuotaBody[] }[]
}

type Answer = WalletBody | 'busy' | 'unreadable'
```

with:

```ts
export const NULL_LISTING_LOG_EVERY_MS = 10_000

/** The answer's types live in the shared package with the paths, so the mint page reads what this writes. */
export type { QuotaBody, WalletBody }

type Answer = WalletBody | 'busy' | 'unreadable'
```

In `apps/freshness/src/routes.ts`, replace:

```ts
import { getAddress, type Address } from 'viem'
import type { HealthBody } from './health.ts'
import type { StateBody } from './state-body.ts'
import type { WalletBody } from './wallet.ts'

/**
 * The routes and the answers (docs/specs/2026-10-16-freshness-server.md, section 6.7), pure: which path a
 * request names, the refusals as `{ "error": "<code>" }`, and every answer's headers.
 */

export type RefusalCode =
  | 'bad-request'
  | 'not-found'
  | 'chain-not-served'
  | 'not-a-collection'
  | 'method-not-allowed'
  | 'chain-unreadable'
  | 'not-read-yet'
  | 'wallet-unreadable'
  | 'busy'
  | 'internal'

export type Route =
```

with:

```ts
import type { RefusalCode, StateBody, WalletBody } from '@cobweb/shared'
import { getAddress, type Address } from 'viem'
import type { HealthBody } from './health.ts'

/**
 * The routes and the answers (docs/specs/2026-10-16-freshness-server.md, section 6.7), pure: which path a
 * request names, the refusals as `{ "error": "<code>" }`, and every answer's headers.
 */

/** The refusals' codes live in the shared package with the bodies, so the mint page reads what this writes. */
export type { RefusalCode }

export type Route =
```

- [ ] **Step 5: Run the tests to see them pass, then typecheck and lint both packages**

Run: `pnpm --filter @cobweb/shared exec vitest run src/freshness-wire.test.ts`
Expected: PASS, `Tests  2 passed (2)`.

Run: `pnpm --filter @cobweb/freshness exec vitest run src/routes.test.ts`
Expected: PASS, `Tests  14 passed (14)`.

Run: `pnpm --filter @cobweb/shared typecheck && pnpm --filter @cobweb/shared lint && pnpm --filter @cobweb/freshness typecheck && pnpm --filter @cobweb/freshness lint`
Expected: no errors and no warnings.

- [ ] **Step 6: The server end to end**

Run: `pnpm --filter @cobweb/web verify:freshness`
Expected: PASS, `16 passed, 0 failed` (about 60 s; it moves Anvil's clock about 600 s ahead).

- [ ] **Step 7: Format, run the root checks and commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
pnpm exec prettier --write packages/shared/src/freshness-wire.ts packages/shared/src/freshness-wire.test.ts packages/shared/src/index.ts apps/freshness/src/state-body.ts apps/freshness/src/wallet.ts apps/freshness/src/routes.ts apps/freshness/src/routes.test.ts
pnpm typecheck && pnpm lint && pnpm test
git add packages/shared/src/freshness-wire.ts packages/shared/src/freshness-wire.test.ts packages/shared/src/index.ts apps/freshness/src/state-body.ts apps/freshness/src/wallet.ts apps/freshness/src/routes.ts apps/freshness/src/routes.test.ts
git commit -m "$(cat <<'EOF'
Move the freshness server's state and wallet bodies and their paths into the shared package, so the server and the mint page read one wire

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: the shared package reports 105 tests in 14 files and the freshness package 111 in 11; the web app is unchanged (714).

---

### Task 4: The freshness client and the mint's pure modules: the call, the run, the failures, the wagmi chain and token art

**Files:**

- Create: `apps/web/src/lib/mint/fresh-client.ts`, `live-data.ts`, `mint-call.ts`, `mint-failure.ts`, `mint-run.ts`, `wagmi-chain.ts`, `token-art.ts`, and the tests `fresh-client.test.ts`, `live-data.test.ts`, `mint-call.test.ts`, `mint-failure.test.ts`, `mint-run.test.ts`, `token-art.test.ts`
- Modify: `apps/web/src/components/deploy/tx-errors.ts` (three readers exported), `apps/web/src/lib/manage/settings-view.ts` (`tokenUriOf` takes an id), `apps/web/src/lib/wagmi.ts` (a transport per chain), and the tests `apps/web/src/lib/manage/settings-view.test.ts`, `apps/web/src/lib/wagmi.test.ts`
- Test: the six new test files and the two changed ones

**Interfaces:**

- Consumes: `StateBody`, `WalletBody`, `statePath`, `walletPath` (Task 3); `MintPageStatic` (Task 2); `joinPhases` (`lib/manage/phases-view.ts`, its rows widened in Task 2); `collectionAbi` (`@cobweb/shared/collection-abi`); `FeeSnapshot`, `MintGroup`, `WalletState` (`lib/demo/types.ts`); the existing `Phase` type of `components/mint/model.ts` (its `status` and `startsIn`); wagmi's `simulateContract`, `writeContract` and `getPublicClient` (`wagmi/actions`).
- Produces:
  - `components/deploy/tx-errors.ts`: `causes(error: unknown): unknown[]`, `shortMessageOf(error: unknown): string`, `revertOf(chain: unknown[]): { errorName: string; args: readonly unknown[] } | null`, now exported
  - `lib/manage/settings-view.ts`: `tokenUriOf(base: string, tokenId = 1): string`
  - `lib/wagmi.ts`: `transports`, `http()` on viem's public endpoint for each listed chain, passed to `getDefaultConfig`
  - `lib/mint/fresh-client.ts`: `UNREACHABLE_AGE_S = 10`, `RETRY_MAX_MS = 8_000`, `OWN_DEGRADED_MS = 10_000`, `NEXT_ANSWER_MAX_MS = 2_000`, `POLL_TIMEOUT_MS = 5_000` (Decision 7); `StatePoll = { kind: 'body'; body: StateBody; ageSeconds } | { kind: 'retry'; afterMs; reason: 'not-read-yet' | 'chain-unreadable' | 'busy' | 'stale' | 'network' } | { kind: 'final'; reason: 'not-a-collection' | 'unavailable' }`, `WalletPoll = { kind: 'body'; body: WalletBody } | { kind: 'retry'; afterMs } | { kind: 'final' }`; `pollState(base: string | undefined, chainId: number, address: Address, fetchImpl?: typeof fetch): Promise<StatePoll>`, `pollWallet(base, chainId, address, wallet: Address, fetchImpl?): Promise<WalletPoll>`; `FreshTrack = { body; highestBlock; anchor: { seconds; at } | null; lastGoodAt; failures; retryMs; final }`, `EMPTY_TRACK`, `foldState(track: FreshTrack, poll: StatePoll, nowMs: number): FreshTrack`, `chainNowOf(track, nowMs): number | null`, `ownDegraded(track, nowMs): boolean`, `cadenceMs(track, phases: readonly Pick<Phase, 'status' | 'startsIn'>[]): number | null`
  - `lib/mint/live-data.ts`: `MintLive = { block; blockTimestamp; readAt; degraded; supply: { max; minted }; publicMaxMintPerWallet; fees: FeeSnapshot; groups: MintGroup[]; creator: Address; royaltyBps; baseUri; revealed; mintOnBehalfActive; transfers: 'open' | 'locked' | 'restricted' | null; royaltyEnforced }`, `WalletView = WalletState & { block: number }`, `LocalMint = { groupId; holder: Address; count; block }`, `revealedOf(baseUri, placeholders): boolean`, `transfersOf(level): MintLive['transfers']`, `liveOf(page: MintPageStatic, body: StateBody): MintLive`, `walletViewOf(body: WalletBody): WalletView`
  - `lib/mint/mint-call.ts`: `MintParams = { contract; chainId; groupId; amount; vault: Address | null; valueWei: bigint; account: Address }`, `MintCall` (what `simulateContract` takes), `Quote = { priceWei; feeWei; totalWei; quantity }`, `quoteOf(fees, priceWei: string, quantity: number): Quote`, `mintCallOf(params: MintParams): MintCall` (`batchMint(amount, group)`, or `delegateMint(amount, group, vault)` with a vault), `mintedTokenIds(receipt: Pick<TransactionReceipt, 'logs'>, contract: Address, receiver: Address): number[]`
  - `lib/mint/mint-failure.ts`: `MintFailureKind` (the fourteen kinds of the spec's 7.6), `MintStep = 'checking' | 'wallet' | 'confirming'`, `MintFailureDetail = { left?; allowed?; message?; hash? }`, `class MintFailure extends Error { kind; detail }`, `revertNameOf(error: unknown): string | null`, `mintFailureOf(error: unknown, at: MintStep, hash?: Hex): MintFailure`, `failureCopy(failure: MintFailure, chainName: string): { title: string; sentence: string }`, `FailureAction`, `failureActions(failure: MintFailure): FailureAction[]`
  - `lib/mint/mint-run.ts`: `MintChain = { simulate(call: MintCall): Promise<() => Promise<Hex>>; receipt(hash: Hex, chainId: number): Promise<TransactionReceipt> }`, `MintResult = { hash; tokenIds: number[]; block: number }`, `runMint(chain: MintChain, params: MintParams, live: { isLive(groupId: number): boolean; nextAnswer(): Promise<void> }, steps: { wallet(): void; sent(hash: Hex): void }): Promise<MintResult>`
  - `lib/mint/wagmi-chain.ts`: `wagmiMintChain(config: Config): MintChain` (simulates through the transport, sends the simulated request, reads the receipt for up to three minutes)
  - `lib/mint/token-art.ts`: `TokenArt = { layers: string[]; video: boolean }`, `gatewayUrlOf(uri: string, gateway: string): string | null`, `tokenArtOf(baseUri: string, id: number, gateway: string, fetchImpl?: typeof fetch): Promise<TokenArt | null>`

- [ ] **Step 1: Write the failing tests**

The tests pin two Review Focus lines in `fresh-client.test.ts` (1 and 2) and one in `mint-run.test.ts` (3).

Create `apps/web/src/lib/mint/fresh-client.test.ts`:

```ts
import type { StateBody, WalletBody } from '@cobweb/shared'
import type { Address } from 'viem'
import { describe, expect, it, vi } from 'vitest'
import {
  cadenceMs,
  chainNowOf,
  EMPTY_TRACK,
  foldState,
  ownDegraded,
  pollState,
  pollWallet,
  POLL_TIMEOUT_MS,
  RETRY_MAX_MS,
  type FreshTrack,
  type StatePoll,
} from './fresh-client'

const BASE = 'https://fresh.example'
const COLLECTION: Address = '0x0409454C375c8a6aB05383bFB6D9FcDe9ebB8F85'
const WALLET: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const OTHER: Address = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'

const body: StateBody = {
  chainId: 31337,
  address: COLLECTION,
  block: 120,
  blockTimestamp: 1_791_039_600,
  readAt: 1_791_039_601,
  degraded: false,
  maxSupply: 3,
  totalMinted: 0,
  publicMaxMintPerWallet: 1,
  mintFeeFlatWei: '10000000000000',
  mintFeeBps: 250,
  airdropFeePerTokenWei: '0',
  mintOnBehalfActive: false,
  groups: [
    {
      id: 0,
      priceWei: '1000000000000000',
      maxSupply: 2,
      minted: 0,
      startTimestamp: 0,
      flag: true,
      active: true,
    },
  ],
  owner: WALLET,
  royalty: { receiver: WALLET, bps: 500 },
  baseUri: 'ipfs://bafybeiexample/',
  transferValidator: '0x0000000000000000000000000000000000000000',
  transferLevel: 'none',
}
const wallet: WalletBody = {
  chainId: 31337,
  address: COLLECTION,
  wallet: WALLET,
  block: 121,
  publicMinted: 1,
  groups: [{ id: 0, quota: 0, claimed: 0 }],
  vaults: [],
}

type Call = { url: string; init: RequestInit | undefined }

/** A fetch that answers each call with the next response, or throws for a network error. */
function fakeFetch(answers: (Response | Error)[]): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = []
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const answer = answers.shift()
    if (!answer || answer instanceof Error) throw answer ?? new Error('no answer')
    return answer
  }) as unknown as typeof fetch
  return { fetchImpl, calls }
}
const json = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', ...headers } })

describe('pollState (docs/specs/2026-10-16-mint-page-live-data.md, section 7.1)', () => {
  it("asks for the collection in lowercase with the browser's conditional request", async () => {
    const { fetchImpl, calls } = fakeFetch([json(body)])
    await pollState(BASE, 31337, COLLECTION, fetchImpl)
    expect(calls[0]?.url).toBe(`${BASE}/v1/state/31337/${COLLECTION.toLowerCase()}`)
    expect(calls[0]?.init?.cache).toBe('no-cache')
  })

  it('reads a body with its Age: 10 s is a body, 11 s a failed poll', async () => {
    const { fetchImpl } = fakeFetch([
      json(body, 200, { Age: '10' }),
      json(body, 200, { Age: '11' }),
      json(body),
    ])
    expect(await pollState(BASE, 31337, COLLECTION, fetchImpl)).toEqual<StatePoll>({
      kind: 'body',
      body,
      ageSeconds: 10,
    })
    expect(await pollState(BASE, 31337, COLLECTION, fetchImpl)).toEqual<StatePoll>({
      kind: 'retry',
      afterMs: 1_000,
      reason: 'stale',
    })
    expect(await pollState(BASE, 31337, COLLECTION, fetchImpl)).toEqual<StatePoll>({
      kind: 'body',
      body,
      ageSeconds: 0,
    })
  })

  it('counts a body for another address or chain, a body that does not parse and a network error as failed polls', async () => {
    const { fetchImpl } = fakeFetch([
      json({ ...body, address: OTHER }),
      json({ ...body, chainId: 1 }),
      json({ ...body, groups: 'none' }),
      new Response('not json', { status: 200 }),
      new Error('offline'),
      json({}, 502),
    ])
    for (let poll = 0; poll < 6; poll++)
      expect(await pollState(BASE, 31337, COLLECTION, fetchImpl)).toEqual<StatePoll>({
        kind: 'retry',
        afterMs: 1_000,
        reason: 'network',
      })
  })

  it('abandons a poll that has not answered after 5 s as a network failure, so the polls go on (Review Focus 1)', async () => {
    const timeout = new AbortController()
    const timer = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal)
    // A request that never answers until its signal aborts, as a connection stuck at the edge does.
    const hanging = ((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('The operation timed out.')))
      })) as unknown as typeof fetch
    try {
      const state = pollState(BASE, 31337, COLLECTION, hanging)
      const own = pollWallet(BASE, 31337, COLLECTION, WALLET, hanging)
      timeout.abort()
      await expect(state).resolves.toEqual<StatePoll>({ kind: 'retry', afterMs: 1_000, reason: 'network' })
      await expect(own).resolves.toEqual({ kind: 'retry', afterMs: 1_000 })
      expect(timer).toHaveBeenCalledWith(POLL_TIMEOUT_MS)
      expect(POLL_TIMEOUT_MS).toBe(5_000)
    } finally {
      timer.mockRestore()
    }
  })

  it('waits for a 503 its Retry-After, 1 s without one, naming its reason', async () => {
    const { fetchImpl } = fakeFetch([
      json({ error: 'not-read-yet' }, 503, { 'Retry-After': '2' }),
      json({ error: 'busy' }, 503),
      json({ error: 'chain-unreadable' }, 503, { 'Retry-After': '1' }),
    ])
    expect(await pollState(BASE, 31337, COLLECTION, fetchImpl)).toEqual<StatePoll>({
      kind: 'retry',
      afterMs: 2_000,
      reason: 'not-read-yet',
    })
    expect(await pollState(BASE, 31337, COLLECTION, fetchImpl)).toMatchObject({
      afterMs: 1_000,
      reason: 'busy',
    })
    expect(await pollState(BASE, 31337, COLLECTION, fetchImpl)).toMatchObject({ reason: 'chain-unreadable' })
  })

  it('is final for a 404 not-a-collection, as unavailable for chain-not-served, a 400 and a build without the origin', async () => {
    const { fetchImpl, calls } = fakeFetch([
      json({ error: 'not-a-collection' }, 404),
      json({ error: 'chain-not-served' }, 404),
      json({ error: 'bad-request' }, 400),
    ])
    expect(await pollState(BASE, 31337, COLLECTION, fetchImpl)).toEqual<StatePoll>({
      kind: 'final',
      reason: 'not-a-collection',
    })
    expect(await pollState(BASE, 31337, COLLECTION, fetchImpl)).toEqual<StatePoll>({
      kind: 'final',
      reason: 'unavailable',
    })
    expect(await pollState(BASE, 31337, COLLECTION, fetchImpl)).toEqual<StatePoll>({
      kind: 'final',
      reason: 'unavailable',
    })
    expect(await pollState(undefined, 31337, COLLECTION, fetchImpl)).toEqual<StatePoll>({
      kind: 'final',
      reason: 'unavailable',
    })
    expect(calls).toHaveLength(3)
  })
})

describe('pollWallet', () => {
  it('asks with both addresses in lowercase and reads the body for that wallet only, an answer for another wallet being a failed poll (Review Focus 2)', async () => {
    const { fetchImpl, calls } = fakeFetch([json(wallet), json({ ...wallet, wallet: OTHER })])
    expect(await pollWallet(BASE, 31337, COLLECTION, WALLET, fetchImpl)).toEqual({
      kind: 'body',
      body: wallet,
    })
    expect(calls[0]?.url).toBe(`${BASE}/v1/wallet/31337/${COLLECTION.toLowerCase()}/${WALLET.toLowerCase()}`)
    expect(calls[0]?.init?.cache).toBe('no-cache')
    expect(await pollWallet(BASE, 31337, COLLECTION, WALLET, fetchImpl)).toEqual({
      kind: 'retry',
      afterMs: 1_000,
    })
  })

  it('retries a 503 after its Retry-After and stops on a 404, a 400 or no origin', async () => {
    const { fetchImpl } = fakeFetch([
      json({ error: 'wallet-unreadable' }, 503, { 'Retry-After': '3' }),
      json({ error: 'not-a-collection' }, 404),
      json({ error: 'bad-request' }, 400),
    ])
    expect(await pollWallet(BASE, 31337, COLLECTION, WALLET, fetchImpl)).toEqual({
      kind: 'retry',
      afterMs: 3_000,
    })
    expect(await pollWallet(BASE, 31337, COLLECTION, WALLET, fetchImpl)).toEqual({ kind: 'final' })
    expect(await pollWallet(BASE, 31337, COLLECTION, WALLET, fetchImpl)).toEqual({ kind: 'final' })
    expect(await pollWallet('', 31337, COLLECTION, WALLET, fetchImpl)).toEqual({ kind: 'final' })
  })
})

describe('foldState and the chain clock', () => {
  const at = (block: number, extra: Partial<StateBody> = {}): StatePoll => ({
    kind: 'body',
    body: { ...body, block, blockTimestamp: body.blockTimestamp + (block - 120) * 2, ...extra },
    ageSeconds: 0,
  })

  it('anchors the clock on a body above the highest block at its block time plus Age, and runs it from there', () => {
    const track = foldState(EMPTY_TRACK, { ...at(120), ageSeconds: 3 } as StatePoll, 5_000)
    expect(track.highestBlock).toBe(120)
    expect(track.anchor).toEqual({ seconds: body.blockTimestamp + 3, at: 5_000 })
    expect(chainNowOf(track, 7_500)).toBe(body.blockTimestamp + 5)
    expect(chainNowOf(EMPTY_TRACK, 7_500)).toBeNull()
  })

  it('takes a body at the same block without moving the clock, so a changed degraded shows', () => {
    const first = foldState(EMPTY_TRACK, at(120), 1_000)
    const same = foldState(
      first,
      at(120, { degraded: true, blockTimestamp: body.blockTimestamp + 50 }),
      4_000,
    )
    expect(same.body?.degraded).toBe(true)
    expect(same.anchor).toEqual(first.anchor)
    expect(same.lastGoodAt).toBe(4_000)
  })

  it('ignores a body below the highest block, which counts as nothing', () => {
    const newer = foldState(EMPTY_TRACK, at(130), 1_000)
    const failed = foldState(newer, { kind: 'retry', afterMs: 1_000, reason: 'network' }, 2_000)
    const older = foldState(failed, at(125, { degraded: true }), 3_000)
    expect(older).toBe(failed)
  })

  it('doubles the wait after each failure up to 8 s, from the 503 Retry-After, and clears it on a body', () => {
    let track: FreshTrack = foldState(EMPTY_TRACK, at(120), 0)
    const waits: (number | null)[] = []
    for (let failure = 0; failure < 5; failure++) {
      track = foldState(track, { kind: 'retry', afterMs: 1_500, reason: 'not-read-yet' }, failure)
      waits.push(track.retryMs)
    }
    expect(waits).toEqual([1_500, 3_000, 6_000, RETRY_MAX_MS, RETRY_MAX_MS])
    const back = foldState(track, at(121), 10)
    expect([back.failures, back.retryMs]).toEqual([0, null])
  })

  it('stops after a final refusal', () => {
    const track = foldState(EMPTY_TRACK, { kind: 'final', reason: 'not-a-collection' }, 0)
    expect(track.final).toBe('not-a-collection')
    expect(cadenceMs(track, [])).toBeNull()
  })
})

describe('cadenceMs and ownDegraded', () => {
  const shown = foldState(EMPTY_TRACK, { kind: 'body', body, ageSeconds: 0 }, 0)

  it('polls every second with no body, a phase starting, or one scheduled 60 s ahead; 3 s at 61 s', () => {
    expect(cadenceMs(EMPTY_TRACK, [])).toBe(1_000)
    expect(cadenceMs(shown, [{ status: 'starting', startsIn: -2 }])).toBe(1_000)
    expect(cadenceMs(shown, [{ status: 'scheduled', startsIn: 60 }])).toBe(1_000)
    expect(cadenceMs(shown, [{ status: 'scheduled', startsIn: 61 }])).toBe(3_000)
    expect(cadenceMs(shown, [{ status: 'live', startsIn: null }])).toBe(3_000)
  })

  it('waits the retry after a failure', () => {
    const failed = foldState(shown, { kind: 'retry', afterMs: 1_000, reason: 'network' }, 1)
    expect(cadenceMs(failed, [{ status: 'scheduled', startsIn: 10 }])).toBe(1_000)
    expect(cadenceMs(foldState(failed, { kind: 'retry', afterMs: 1_000, reason: 'network' }, 2), [])).toBe(
      2_000,
    )
  })

  it('turns on 10 s after the last accepted body, and not before', () => {
    expect(ownDegraded(shown, 9_999)).toBe(false)
    expect(ownDegraded(shown, 10_000)).toBe(true)
    expect(ownDegraded(EMPTY_TRACK, 60_000)).toBe(false)
  })
})
```

Create `apps/web/src/lib/mint/live-data.test.ts`:

```ts
import type { StateBody, WalletBody } from '@cobweb/shared'
import type { Address } from 'viem'
import { describe, expect, it } from 'vitest'
import { liveOf, revealedOf, transfersOf, walletViewOf } from './live-data'
import type { MintPageStatic } from './page-doc'

const COLLECTION: Address = '0x0409454C375c8a6aB05383bFB6D9FcDe9ebB8F85'
const OWNER: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const VAULT: Address = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
const PLACEHOLDER = 'ipfs://bafybeiplaceholder/metadata.json'
const REAL = 'ipfs://bafybeireal/'

const page: MintPageStatic = {
  slug: 'night-owls',
  name: 'Night Owls',
  symbol: 'OWLS',
  projectType: 'generative',
  chain: { id: 31337, name: 'Anvil', nativeSymbol: 'ETH', explorerUrl: '', transferLock: false },
  contract: COLLECTION,
  description: '',
  bannerUrl: null,
  avatarUrl: null,
  aboutBannerUrl: null,
  socials: {},
  featuredTokenIds: [],
  sections: {},
  phases: [
    { onchain_id: 1, name: 'Holders', description: 'For holders.', visible: true, position: 0 },
    { onchain_id: 0, name: 'Public', description: '', visible: true, position: 1 },
    { onchain_id: 2, name: 'Team', description: '', visible: false, position: 2 },
  ],
  placeholders: [PLACEHOLDER],
  gateway: 'https://ipfs.io/ipfs',
}

const group = (id: number, active = false) => ({
  id,
  priceWei: '1000',
  maxSupply: 2,
  minted: 0,
  startTimestamp: 0,
  flag: active,
  active,
})
const body: StateBody = {
  chainId: 31337,
  address: COLLECTION,
  block: 50,
  blockTimestamp: 1_000,
  readAt: 1_002,
  degraded: false,
  maxSupply: 5,
  totalMinted: 1,
  publicMaxMintPerWallet: 2,
  mintFeeFlatWei: '7',
  mintFeeBps: 250,
  airdropFeePerTokenWei: '3',
  mintOnBehalfActive: true,
  groups: [group(0, true), group(1), group(2), group(3)],
  owner: OWNER,
  royalty: { receiver: VAULT, bps: 500 },
  baseUri: REAL,
  transferValidator: '0x721C008fdff27BF06E7E123956E2Fe03B63342e3',
  transferLevel: 0,
}

describe('liveOf (docs/specs/2026-10-16-mint-page-live-data.md, section 7.4)', () => {
  it('joins the groups by position, puts "Group N" after them and keeps the hidden ones for the model to drop', () => {
    const live = liveOf(page, body)
    expect(live.groups.map((entry) => [entry.id, entry.name, entry.visible])).toEqual([
      [1, 'Holders', true],
      [0, 'Public', true],
      [2, 'Team', false],
      [3, 'Group 3', true],
    ])
    expect(live.groups[0]?.description).toBe('For holders.')
  })

  it('takes the fees as wei strings, the owner as the creator and the royalty in basis points', () => {
    const live = liveOf(page, body)
    expect(live.fees).toEqual({ mintFeeFlatWei: '7', mintFeeBps: 250, airdropFeePerTokenWei: '3' })
    expect([live.creator, live.royaltyBps, live.block, live.readAt]).toEqual([OWNER, 500, 50, 1_002])
    expect(live.supply).toEqual({ max: 5, minted: 1 })
  })

  it('reads the royalty sentence only at level 0', () => {
    expect(liveOf(page, body).royaltyEnforced).toBe(true)
    for (const level of [1, 9, 'none', 'unread'] as const)
      expect(liveOf(page, { ...body, transferLevel: level }).royaltyEnforced).toBe(false)
  })
})

describe('revealedOf and transfersOf', () => {
  it('reads revealed for the real base and a custom link, not for an empty base or a placeholder', () => {
    expect(revealedOf('', [PLACEHOLDER])).toBe(false)
    expect(revealedOf(PLACEHOLDER, [PLACEHOLDER])).toBe(false)
    expect(revealedOf(REAL, [PLACEHOLDER])).toBe(true)
    expect(revealedOf('https://example.com/owls/', [PLACEHOLDER])).toBe(true)
  })

  it('reads levels 0 and 1 open, 9 locked, 2 to 8 restricted, and none or unread as nothing to show', () => {
    expect([transfersOf(0), transfersOf(1), transfersOf(9)]).toEqual(['open', 'open', 'locked'])
    for (let level = 2; level <= 8; level++) expect(transfersOf(level)).toBe('restricted')
    expect([transfersOf('none'), transfersOf('unread')]).toEqual([null, null])
  })
})

describe('walletViewOf', () => {
  const answer: WalletBody = {
    chainId: 31337,
    address: COLLECTION,
    wallet: OWNER,
    block: 52,
    publicMinted: 1,
    groups: [
      { id: 0, quota: 0, claimed: 0 },
      { id: 1, quota: 2, claimed: 1 },
      { id: 2, quota: 0, claimed: 0 },
    ],
    vaults: [
      {
        vault: VAULT,
        publicMinted: 0,
        groups: [
          { id: 0, quota: 0, claimed: 0 },
          { id: 1, quota: 3, claimed: 0 },
          { id: 2, quota: 0, claimed: 0 },
        ],
      },
      {
        vault: COLLECTION,
        publicMinted: 2,
        groups: [
          { id: 0, quota: 0, claimed: 0 },
          { id: 1, quota: 0, claimed: 0 },
        ],
      },
    ],
  }

  it('turns quotas into eligibility: the public group always, a whitelist group with a quota above 0', () => {
    const view = walletViewOf(answer)
    expect(view.groups).toEqual([
      { groupId: 0, quota: 0, used: 0, eligible: true },
      { groupId: 1, quota: 2, used: 1, eligible: true },
      { groupId: 2, quota: 0, used: 0, eligible: false },
    ])
    expect([view.address, view.publicMinted, view.block]).toEqual([OWNER, 1, 52])
  })

  it("keeps a vault's whitelist groups with quota, and leaves off a vault with none", () => {
    expect(walletViewOf(answer).delegatedVaults).toEqual([
      { vault: VAULT, groups: [{ groupId: 1, quota: 3, used: 0 }] },
    ])
  })
})
```

Create `apps/web/src/lib/mint/mint-call.test.ts`:

```ts
import { collectionAbi } from '@cobweb/shared/collection-abi'
import {
  encodeEventTopics,
  encodeFunctionData,
  parseAbi,
  zeroAddress,
  type Address,
  type TransactionReceipt,
} from 'viem'
import { describe, expect, it } from 'vitest'
import { mintCallOf, mintedTokenIds, quoteOf, type MintParams } from './mint-call'

const CONTRACT: Address = '0x0409454C375c8a6aB05383bFB6D9FcDe9ebB8F85'
const ACCOUNT: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const VAULT: Address = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
const OTHER: Address = '0x90F79bf6EB2c4f870365E785982E1f101E93b906'
/** The two mint functions as the contract declares them, written by hand. */
const signatures = parseAbi([
  'function batchMint(uint256 amount, uint256 mintGroup) payable returns (uint256 totalCost)',
  'function delegateMint(uint256 amount, uint256 mintGroup, address vault) payable returns (uint256 totalCost)',
])
const params: MintParams = {
  contract: CONTRACT,
  chainId: 31337,
  groupId: 1,
  amount: 3,
  vault: null,
  valueWei: 3_030_000_000_000_000n,
  account: ACCOUNT,
}

describe('mintCallOf (docs/specs/2026-10-16-mint-page-live-data.md, section 7.5)', () => {
  it('calls batchMint(amount, group) from the account with the quoted value', () => {
    const call = mintCallOf(params)
    expect([call.address, call.functionName, call.args, call.value, call.chainId, call.account]).toEqual([
      CONTRACT,
      'batchMint',
      [3n, 1n],
      3_030_000_000_000_000n,
      31337,
      ACCOUNT,
    ])
    expect(encodeFunctionData({ abi: call.abi, functionName: 'batchMint', args: [3n, 1n] })).toBe(
      encodeFunctionData({ abi: signatures, functionName: 'batchMint', args: [3n, 1n] }),
    )
  })

  it("calls delegateMint(amount, group, vault) with a vault, the tokens landing in the caller's wallet", () => {
    const call = mintCallOf({ ...params, vault: VAULT })
    expect([call.functionName, call.args]).toEqual(['delegateMint', [3n, 1n, VAULT]])
    expect(encodeFunctionData({ abi: call.abi, functionName: 'delegateMint', args: [3n, 1n, VAULT] })).toBe(
      encodeFunctionData({ abi: signatures, functionName: 'delegateMint', args: [3n, 1n, VAULT] }),
    )
  })
})

describe("quoteOf: the contract's quoteBatchMint", () => {
  /** quoteBatchMint as the contract computes it. */
  const contract = (price: bigint, flat: bigint, bps: bigint, amount: bigint) => {
    const platformFee = (flat + (price * bps) / 10_000n) * amount
    return price * amount + platformFee
  }

  it('equals it for prices and fees whose basis points leave a remainder', () => {
    const cases: [bigint, bigint, bigint, bigint][] = [
      [1_000_000_000_000_000n, 10_000_000_000_000n, 250n, 3n],
      [333n, 7n, 125n, 2n],
      [0n, 100_000_000_000_000n, 100n, 5n],
      [999_999n, 0n, 9_999n, 1n],
      [123_456_789_012_345_678_901n, 1n, 1n, 4n],
    ]
    for (const [price, flat, bps, amount] of cases) {
      const quote = quoteOf(
        { mintFeeFlatWei: String(flat), mintFeeBps: Number(bps) },
        String(price),
        Number(amount),
      )
      expect(quote.totalWei).toBe(contract(price, flat, bps, amount))
      expect(quote.priceWei + quote.feeWei).toBe(quote.totalWei)
    }
  })
})

describe('mintedTokenIds', () => {
  type ReceiptLog = TransactionReceipt['logs'][number]
  const transfer = (address: Address, from: Address, to: Address, tokenId: bigint) =>
    ({
      address,
      data: '0x',
      topics: encodeEventTopics({ abi: collectionAbi, eventName: 'Transfer', args: { from, to, tokenId } }),
    }) as unknown as ReceiptLog

  it("keeps the collection's mints to the receiver, sorted, and drops other contracts, receivers and transfers", () => {
    const logs = [
      transfer(CONTRACT, zeroAddress, ACCOUNT, 7n),
      transfer(OTHER, zeroAddress, ACCOUNT, 1n),
      transfer(CONTRACT, zeroAddress, VAULT, 8n),
      transfer(CONTRACT, ACCOUNT, VAULT, 7n),
      transfer(CONTRACT.toLowerCase() as Address, zeroAddress, ACCOUNT.toLowerCase() as Address, 5n),
      { address: CONTRACT, data: '0x1234', topics: ['0x' + '0'.repeat(64)] } as unknown as ReceiptLog,
    ]
    expect(mintedTokenIds({ logs }, CONTRACT, ACCOUNT)).toEqual([5, 7])
  })
})
```

Create `apps/web/src/lib/mint/mint-failure.test.ts`:

```ts
import { collectionAbi } from '@cobweb/shared/collection-abi'
import {
  ChainMismatchError,
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  encodeErrorResult,
  HttpRequestError,
  UserRejectedRequestError,
  WaitForTransactionReceiptTimeoutError,
  type Address,
  type Hex,
} from 'viem'
import { anvil } from 'viem/chains'
import { describe, expect, it } from 'vitest'
import {
  failureActions,
  failureCopy,
  MintFailure,
  mintFailureOf,
  revertNameOf,
  type MintFailureKind,
} from './mint-failure'

const CONTRACT: Address = '0x0409454C375c8a6aB05383bFB6D9FcDe9ebB8F85'
const ACCOUNT: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const HASH: Hex = `0x${'ab'.repeat(32)}`

/** A failed simulation as viem throws it: the custom error decoded inside the execution error. */
function reverted(errorName: string, args: readonly unknown[]): ContractFunctionExecutionError {
  const data = encodeErrorResult({ abi: collectionAbi, errorName, args } as Parameters<
    typeof encodeErrorResult
  >[0])
  const revert = new ContractFunctionRevertedError({ abi: collectionAbi, data, functionName: 'batchMint' })
  return new ContractFunctionExecutionError(revert, {
    abi: collectionAbi,
    functionName: 'batchMint',
    args: [1n, 0n],
    contractAddress: CONTRACT,
  })
}
const sentence = (error: unknown, at: 'checking' | 'wallet' | 'confirming' = 'checking') => {
  const failure = mintFailureOf(error, at)
  return { kind: failure.kind, ...failureCopy(failure, 'Base') }
}

describe('mintFailureOf (docs/specs/2026-10-16-mint-page-live-data.md, section 7.6)', () => {
  it('reads each revert of the check as its kind, with the counts in the sentences', () => {
    const cases: [string, readonly unknown[], MintFailureKind, string][] = [
      ['MintGroupInactive', [0n], 'phase-closed', 'The check found the phase closed, so nothing was sent.'],
      ['ExceedsMintGroupMaxSupply', [3n, 2n], 'sold-out', 'Only 2 are left, so nothing was sent.'],
      ['ExceedsMaxSupply', [3n, 1n], 'sold-out', 'Only 1 is left, so nothing was sent.'],
      ['ExceedsMaxSupply', [3n, 0n], 'sold-out', 'Every token of this phase is minted. Nothing was sent.'],
      ['ExceedsPublicMaxPerWallet', [2n, 1n], 'quota-exceeded', 'This wallet can mint 1 more in this phase'],
      ['ExceedsMintQuota', [3n, 2n], 'quota-exceeded', 'This wallet can mint 2 more in this phase'],
      [
        'NotInWhitelist',
        [ACCOUNT, 1n],
        'not-listed',
        'The contract does not list this wallet for this phase.',
      ],
      [
        'NotDelegate',
        [ACCOUNT, CONTRACT],
        'not-delegate',
        'delegate.xyz shows no delegation from this vault',
      ],
      ['InsufficientEther', [10n, 9n], 'price-changed', 'The total changed after this page read it'],
      [
        'TransferToNonERC721ReceiverImplementer',
        [],
        'contract-wallet',
        'It is a contract that cannot receive',
      ],
    ]
    for (const [name, args, kind, words] of cases) {
      const read = sentence(reverted(name, args))
      expect(read.kind, name).toBe(kind)
      expect(read.sentence, name).toContain(words)
      expect(read.sentence, name).toMatch(/nothing was sent/i)
    }
    expect(mintFailureOf(reverted('ExceedsMaxSupply', [3n, 1n]), 'checking').detail.left).toBe(1)
    expect(mintFailureOf(reverted('ExceedsMintQuota', [3n, 2n]), 'checking').detail.allowed).toBe(2)
  })

  it('reads a rejection by its error or code 4001, at the check, in the wallet or at the switch', () => {
    expect(
      sentence(new UserRejectedRequestError(new Error('User rejected the request.')), 'wallet'),
    ).toMatchObject({
      kind: 'rejected',
      title: 'You cancelled in your wallet',
      sentence: 'Nothing was sent and nothing was charged. You can try again whenever you are ready.',
    })
    const coded = Object.assign(new Error('denied'), { code: 4001 })
    expect(mintFailureOf(new Error('wrapped', { cause: coded }), 'checking').kind).toBe('rejected')
  })

  it('reads "insufficient funds" anywhere as the balance, and a changed network as wrong-network', () => {
    const funds = new Error('outer', { cause: new Error('insufficient funds for gas * price + value') })
    expect(sentence(funds).kind).toBe('insufficient-balance')
    expect(sentence(funds, 'wallet').sentence).toBe(
      'The wallet cannot cover the total plus gas. Nothing was sent.',
    )
    const mismatch = new ChainMismatchError({ chain: anvil, currentChainId: 1 })
    expect(sentence(mismatch, 'wallet')).toMatchObject({
      kind: 'wrong-network',
      sentence: 'Switch back to Base, then try again. Nothing was sent.',
    })
  })

  it("reads a transport error at the check as check-failed, and the wallet's own error in its words", () => {
    const transport = new HttpRequestError({ url: 'https://rpc.example', body: {} })
    expect(sentence(transport)).toMatchObject({
      kind: 'check-failed',
      sentence:
        'The mint could not be checked against the contract. Nothing was sent. Try again in a moment.',
    })
    const wallet = sentence(
      Object.assign(new Error('raw'), { shortMessage: 'The wallet is locked.' }),
      'wallet',
    )
    expect(wallet).toMatchObject({
      kind: 'wallet-failed',
      title: 'Your wallet did not send it',
      sentence: 'The wallet is locked. Nothing was charged.',
    })
  })

  it('reads a receipt that did not come as unconfirmed, keeping the hash', () => {
    const failure = mintFailureOf(
      new WaitForTransactionReceiptTimeoutError({ hash: HASH }),
      'confirming',
      HASH,
    )
    expect([failure.kind, failure.detail.hash]).toEqual(['unconfirmed', HASH])
    expect(failureCopy(failure, 'Base').sentence).toContain('It may still land')
    expect(failureCopy(new MintFailure('reverted'), 'Base').sentence).toBe(
      'The network rejected it, usually because the phase closed or sold out while it waited. No tokens were minted; only gas was spent.',
    )
  })

  it('names the revert a simulation decoded, for the retry on MintGroupInactive', () => {
    expect(revertNameOf(reverted('MintGroupInactive', [0n]))).toBe('MintGroupInactive')
    expect(revertNameOf(new Error('no revert'))).toBeNull()
  })
})

describe('failureActions', () => {
  it("offers each kind's ways forward, Mint N with the count the revert named", () => {
    expect(failureActions(new MintFailure('sold-out', { left: 2 }))).toEqual([
      { kind: 'mint-count', count: 2 },
      { kind: 'close' },
    ])
    expect(failureActions(new MintFailure('sold-out', { left: 0 }))).toEqual([{ kind: 'close' }])
    expect(failureActions(new MintFailure('quota-exceeded', { allowed: 1 }))).toEqual([
      { kind: 'mint-fewer', count: 1 },
      { kind: 'retry' },
    ])
    expect(failureActions(new MintFailure('phase-closed'))).toEqual([{ kind: 'see-phases' }])
    expect(failureActions(new MintFailure('not-delegate'))).toEqual([
      { kind: 'use-wallet' },
      { kind: 'close' },
    ])
    expect(failureActions(new MintFailure('unconfirmed'))).toEqual([
      { kind: 'view-transaction' },
      { kind: 'close' },
    ])
    expect(failureActions(new MintFailure('price-changed'))).toEqual([{ kind: 'retry' }])
  })
})
```

Create `apps/web/src/lib/mint/mint-run.test.ts`:

```ts
import { collectionAbi } from '@cobweb/shared/collection-abi'
import {
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  encodeErrorResult,
  encodeEventTopics,
  zeroAddress,
  type Address,
  type Hex,
  type TransactionReceipt,
} from 'viem'
import { describe, expect, it, vi } from 'vitest'
import type { MintCall, MintParams } from './mint-call'
import { MintFailure } from './mint-failure'
import { runMint, type MintChain } from './mint-run'

const CONTRACT: Address = '0x0409454C375c8a6aB05383bFB6D9FcDe9ebB8F85'
const ACCOUNT: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const HASH: Hex = `0x${'cd'.repeat(32)}`
const params: MintParams = {
  contract: CONTRACT,
  chainId: 31337,
  groupId: 0,
  amount: 2,
  vault: null,
  valueWei: 2_000n,
  account: ACCOUNT,
}

const inactive = () => {
  const data = encodeErrorResult({ abi: collectionAbi, errorName: 'MintGroupInactive', args: [0n] })
  return new ContractFunctionExecutionError(
    new ContractFunctionRevertedError({ abi: collectionAbi, data, functionName: 'batchMint' }),
    { abi: collectionAbi, functionName: 'batchMint', args: [2n, 0n], contractAddress: CONTRACT },
  )
}
const minted = (ids: number[], status: 'success' | 'reverted' = 'success'): TransactionReceipt =>
  ({
    status,
    blockNumber: 77n,
    logs: ids.map((id) => ({
      address: CONTRACT,
      data: '0x',
      topics: encodeEventTopics({
        abi: collectionAbi,
        eventName: 'Transfer',
        args: { from: zeroAddress, to: ACCOUNT, tokenId: BigInt(id) },
      }),
    })),
  }) as unknown as TransactionReceipt

/** A chain whose simulation answers from the queue: an error is thrown, a function is the send. */
function fakeChain(simulations: (Error | (() => Promise<Hex>))[], receipt = minted([4, 5])) {
  const calls: MintCall[] = []
  const chain: MintChain = {
    simulate: vi.fn(async (call: MintCall) => {
      calls.push(call)
      const next = simulations.shift()
      if (!next || next instanceof Error) throw next ?? new Error('no simulation')
      return next
    }),
    receipt: vi.fn(async () => receipt),
  }
  return { chain, calls }
}
const steps = () => ({ wallet: vi.fn(), sent: vi.fn() })
const live = (isLive: boolean) => ({ isLive: vi.fn(() => isLive), nextAnswer: vi.fn(async () => {}) })

describe('runMint (docs/specs/2026-10-16-mint-page-live-data.md, section 7.5)', () => {
  it('opens no wallet and sends nothing when the simulation throws', async () => {
    const send = vi.fn(async () => HASH)
    const { chain } = fakeChain([new Error('execution reverted'), send])
    const step = steps()
    await expect(runMint(chain, params, live(false), step)).rejects.toMatchObject({ kind: 'check-failed' })
    expect(step.wallet).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('sends with the function the simulation answered, then reads the ids and the block from the receipt', async () => {
    const send = vi.fn(async () => HASH)
    const { chain, calls } = fakeChain([send])
    const step = steps()
    const result = await runMint(chain, params, live(true), step)
    expect(result).toEqual({ hash: HASH, tokenIds: [4, 5], block: 77 })
    expect(send).toHaveBeenCalledOnce()
    expect(step.wallet).toHaveBeenCalledOnce()
    expect(step.sent).toHaveBeenCalledWith(HASH)
    expect([calls[0]?.functionName, calls[0]?.args, calls[0]?.value]).toEqual(['batchMint', [2n, 0n], 2_000n])
    expect(chain.receipt).toHaveBeenCalledWith(HASH, 31337)
  })

  it('waits for the next answer and checks once more when the group reads live but the check finds it inactive', async () => {
    const send = vi.fn(async () => HASH)
    const { chain } = fakeChain([inactive(), send])
    const state = live(true)
    await expect(runMint(chain, params, state, steps())).resolves.toMatchObject({ tokenIds: [4, 5] })
    expect(state.nextAnswer).toHaveBeenCalledOnce()
    expect(chain.simulate).toHaveBeenCalledTimes(2)
  })

  it('does not check again when the group does not read live, nor more than once (Review Focus 3)', async () => {
    const notLive = fakeChain([inactive(), vi.fn(async () => HASH)])
    const closed = live(false)
    await expect(runMint(notLive.chain, params, closed, steps())).rejects.toMatchObject({
      kind: 'phase-closed',
    })
    expect(closed.nextAnswer).not.toHaveBeenCalled()
    const twice = fakeChain([inactive(), inactive(), vi.fn(async () => HASH)])
    await expect(runMint(twice.chain, params, live(true), steps())).rejects.toMatchObject({
      kind: 'phase-closed',
    })
    expect(twice.chain.simulate).toHaveBeenCalledTimes(2)
  })

  it('throws reverted for a reverted receipt, with the hash', async () => {
    const { chain } = fakeChain([vi.fn(async () => HASH)], minted([], 'reverted'))
    const failure = await runMint(chain, params, live(true), steps()).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(MintFailure)
    expect(failure).toMatchObject({ kind: 'reverted', detail: { hash: HASH } })
  })
})
```

Create `apps/web/src/lib/mint/token-art.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { gatewayUrlOf, tokenArtOf } from './token-art'

const GATEWAY = 'https://ipfs.io/ipfs'
const CID = 'bafybeihkoviema7g3gxyt6la7vd5ho32ictqbilu3wnlo3rs7ewhnp7lly'

/** A fetch that answers each URL from the table, 404 for any other. */
function gatewayFetch(table: Record<string, unknown>) {
  return vi.fn(async (url: string) =>
    url in table
      ? new Response(JSON.stringify(table[url]), { status: 200 })
      : new Response('missing', { status: 404 }),
  ) as unknown as typeof fetch & ReturnType<typeof vi.fn>
}

describe('gatewayUrlOf (docs/specs/2026-10-16-mint-page-live-data.md, section 7.7)', () => {
  it("turns ipfs:// into the gateway's path, keeps https:// and refuses other schemes", () => {
    expect(gatewayUrlOf(`ipfs://${CID}/12`, GATEWAY)).toBe(`${GATEWAY}/${CID}/12`)
    expect(gatewayUrlOf(`ipfs://ipfs/${CID}/a.png`, GATEWAY)).toBe(`${GATEWAY}/${CID}/a.png`)
    expect(gatewayUrlOf('https://cdn.example/owl.png', GATEWAY)).toBe('https://cdn.example/owl.png')
    expect(gatewayUrlOf('http://cdn.example/owl.png', GATEWAY)).toBeNull()
    expect(gatewayUrlOf('data:image/png;base64,AAAA', GATEWAY)).toBeNull()
    expect(gatewayUrlOf('ipfs://', GATEWAY)).toBeNull()
  })
})

describe('tokenArtOf', () => {
  it("reads the metadata's image through the gateway at the token's URI", async () => {
    const fetchImpl = gatewayFetch({ [`${GATEWAY}/${CID}/7`]: { image: `ipfs://${CID}/images/7.png` } })
    expect(await tokenArtOf(`ipfs://${CID}/`, 7, GATEWAY, fetchImpl)).toEqual({
      layers: [`${GATEWAY}/${CID}/images/7.png`],
      video: false,
    })
  })

  it('plays an MP4 image as a video', async () => {
    const fetchImpl = gatewayFetch({ [`${GATEWAY}/${CID}/1`]: { image: 'https://cdn.example/owl.mp4' } })
    expect(await tokenArtOf(`ipfs://${CID}/`, 1, GATEWAY, fetchImpl)).toEqual({
      layers: ['https://cdn.example/owl.mp4'],
      video: true,
    })
  })

  it('reads a single-file base for every id, the placeholder before the reveal', async () => {
    const fetchImpl = gatewayFetch({
      [`${GATEWAY}/${CID}/metadata.json`]: { image: `ipfs://${CID}/placeholder.gif` },
    })
    for (const id of [1, 9, 300])
      expect(await tokenArtOf(`ipfs://${CID}/metadata.json`, id, GATEWAY, fetchImpl)).toEqual({
        layers: [`${GATEWAY}/${CID}/placeholder.gif`],
        video: false,
      })
  })

  it('answers null for a failed fetch, metadata without an image, an image of another scheme and an empty base', async () => {
    const fetchImpl = gatewayFetch({
      [`${GATEWAY}/${CID}/2`]: { name: 'no image' },
      [`${GATEWAY}/${CID}/3`]: { image: 'http://cdn.example/3.png' },
    })
    expect(await tokenArtOf(`ipfs://${CID}/`, 1, GATEWAY, fetchImpl)).toBeNull()
    expect(await tokenArtOf(`ipfs://${CID}/`, 2, GATEWAY, fetchImpl)).toBeNull()
    expect(await tokenArtOf(`ipfs://${CID}/`, 3, GATEWAY, fetchImpl)).toBeNull()
    expect(await tokenArtOf('', 1, GATEWAY, fetchImpl)).toBeNull()
    const offline = vi.fn(async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch
    expect(await tokenArtOf(`ipfs://${CID}/`, 1, GATEWAY, offline)).toBeNull()
  })
})
```

In `apps/web/src/lib/manage/settings-view.test.ts`, replace:

```ts
    expect(tokenUriOf(PLACEHOLDER)).toBe(PLACEHOLDER)
    expect(tokenUriOf('')).toBe('')
  })
})
```

with:

```ts
    expect(tokenUriOf(PLACEHOLDER)).toBe(PLACEHOLDER)
    expect(tokenUriOf('')).toBe('')
  })

  it("names another token's URI by its id, and a single file for every id (docs/specs/2026-10-16-mint-page-live-data.md, section 7.7)", () => {
    expect(tokenUriOf(REAL, 12)).toBe(`${REAL}12`)
    expect(tokenUriOf(PLACEHOLDER, 12)).toBe(PLACEHOLDER)
  })
})
```

In `apps/web/src/lib/wagmi.test.ts`, replace:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'

// RainbowKit builds its config when the module loads; this test reads the chain list only.
vi.mock('@rainbow-me/rainbowkit', () => ({ getDefaultConfig: () => ({}) }))

describe('the wallet chains (docs/specs/2026-10-16-freshness-server.md, section 7.2)', () => {
```

with:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'

// RainbowKit builds its config when the module loads; this test reads what it is given.
vi.mock('@rainbow-me/rainbowkit', () => ({ getDefaultConfig: (parameters: unknown) => parameters }))

describe('the wallet chains (docs/specs/2026-10-16-freshness-server.md, section 7.2)', () => {
```

In `apps/web/src/lib/wagmi.test.ts`, replace:

```ts
    }
  })
})
```

with:

```ts
    }
  })

  it('name a transport for each chain (docs/specs/2026-10-16-mint-page-live-data.md, decision 16)', async () => {
    const { chains, transports, wagmiConfig } = await import('./wagmi')
    const ids = (list: number[]) => [...list].sort((a, b) => a - b)
    expect(ids(Object.keys(transports).map(Number))).toEqual(ids(chains.map((chain) => chain.id)))
    expect((wagmiConfig as unknown as { transports: unknown }).transports).toBe(transports)
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @cobweb/web exec vitest run src/lib/mint/fresh-client.test.ts src/lib/mint/live-data.test.ts src/lib/mint/mint-call.test.ts src/lib/mint/mint-failure.test.ts src/lib/mint/mint-run.test.ts src/lib/mint/token-art.test.ts src/lib/manage/settings-view.test.ts src/lib/wagmi.test.ts`
Expected: FAIL. The six new files fail to load (`Cannot find module './fresh-client'` and the like), `tokenUriOf`'s new case fails on token 1's URI and the transports' case with `TypeError: Cannot convert undefined or null to object`: `Test Files  8 failed (8)` and `Tests  2 failed | 7 passed (9)`.

- [ ] **Step 3: The readers, the token URI and the transports**

In `apps/web/src/components/deploy/tx-errors.ts`, replace:

```ts
}

function causes(error: unknown): unknown[] {
  const list: unknown[] = []
  let current: unknown = error
```

with:

```ts
}

/** The error and its causes, outermost first, at most ten deep. The mint page's failures read them too. */
export function causes(error: unknown): unknown[] {
  const list: unknown[] = []
  let current: unknown = error
```

In `apps/web/src/components/deploy/tx-errors.ts`, replace:

```ts

/** The error's `shortMessage` (viem) or `message`, read so a null or undefined rejection never throws inside a catch. */
function shortMessageOf(error: unknown): string {
  const shaped = error as { shortMessage?: unknown; message?: unknown } | null | undefined
  const message = shaped?.shortMessage ?? shaped?.message
  return typeof message === 'string' && message ? message : 'Unknown error.'
}

/** The custom error viem decoded from a failed simulation (`ContractFunctionRevertedError.data`), or null. */
function revertOf(chain: unknown[]): { errorName: string; args: readonly unknown[] } | null {
  for (const entry of chain) {
    const shaped = entry as { name?: unknown; data?: { errorName?: unknown; args?: unknown } }
```

with:

```ts

/** The error's `shortMessage` (viem) or `message`, read so a null or undefined rejection never throws inside a catch. */
export function shortMessageOf(error: unknown): string {
  const shaped = error as { shortMessage?: unknown; message?: unknown } | null | undefined
  const message = shaped?.shortMessage ?? shaped?.message
  return typeof message === 'string' && message ? message : 'Unknown error.'
}

/** The custom error viem decoded from a failed simulation (`ContractFunctionRevertedError.data`), or null. */
export function revertOf(chain: unknown[]): { errorName: string; args: readonly unknown[] } | null {
  for (const entry of chain) {
    const shaped = entry as { name?: unknown; data?: { errorName?: unknown; args?: unknown } }
```

In `apps/web/src/lib/manage/settings-view.ts`, replace:

```ts
}

/** Token 1's URI by the contract's rule: an empty base stays empty, a base without "/" is every token's URI. */
export function tokenUriOf(base: string): string {
  if (!base || !base.endsWith('/')) return base
  return `${base}1`
}

```

with:

```ts
}

/**
 * A token's URI by the contract's rule, token 1's unless an id is given: an empty base stays empty, a base
 * without "/" is every token's URI.
 */
export function tokenUriOf(base: string, tokenId = 1): string {
  if (!base || !base.endsWith('/')) return base
  return `${base}${tokenId}`
}

```

In `apps/web/src/lib/wagmi.ts`, replace:

```ts
import { hidesTestChains } from '@cobweb/shared'
import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import {
  anvil,
```

with:

```ts
import { hidesTestChains } from '@cobweb/shared'
import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import type { Transport } from 'viem'
import { http } from 'wagmi'
import {
  anvil,
```

In `apps/web/src/lib/wagmi.ts`, replace:

```ts
  : ([...launchChains, sepolia, robinhoodTestnet, anvil] as const)

export const wagmiConfig = getDefaultConfig({
  appName: 'Cobweb',
  // Without a real id, WalletConnect (QR and mobile wallets) will not connect. Browser-extension
  // wallets still work.
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'missing-walletconnect-project-id',
  chains,
  ssr: true,
})
```

with:

```ts
  : ([...launchChains, sepolia, robinhoodTestnet, anvil] as const)

/**
 * One transport per chain, `http()` on viem's public endpoint for it, with no key in the bundle: the mint page's
 * check and receipt go through it and the send through the wallet. Both concern the visitor's own transaction,
 * not shared state (docs/specs/2026-10-16-mint-page-live-data.md, decision 16).
 */
export const transports = Object.fromEntries(chains.map((chain) => [chain.id, http()])) as Record<
  (typeof chains)[number]['id'],
  Transport
>

export const wagmiConfig = getDefaultConfig({
  appName: 'Cobweb',
  // Without a real id, WalletConnect (QR and mobile wallets) will not connect. Browser-extension
  // wallets still work.
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'missing-walletconnect-project-id',
  chains,
  transports,
  ssr: true,
})
```

- [ ] **Step 4: The freshness client and the page's view of its answers**

A poll that has not answered after 5 s counts as a network failure (Decision 7).

Create `apps/web/src/lib/mint/fresh-client.ts`:

```ts
import { statePath, walletPath, type StateBody, type WalletBody } from '@cobweb/shared'
import type { Address } from 'viem'
import { z } from 'zod'
import type { Phase } from '@/components/mint/model'

/**
 * The mint page's freshness client (docs/specs/2026-10-16-mint-page-live-data.md, section 7.1), pure apart from
 * the fetch it is given: one poll of the state or wallet endpoint read into an answer, the track that folds the
 * answers in (the shown body, the highest block, the chain clock's anchor, the failures), the clock, the
 * page's own `degraded` and the cadence. The browser's cache sends `If-None-Match` itself (`cache:
 * 'no-cache'`), so a poll never makes a preflight. Liveness is each group's `active`; nothing here computes it.
 */

/** An answer older than this at the edge counts as a failed poll. */
export const UNREACHABLE_AGE_S = 10
/** The longest wait between polls after failures. */
export const RETRY_MAX_MS = 8_000
/** Without an accepted answer for this long, the page raises its own degraded banner. */
export const OWN_DEGRADED_MS = 10_000
/** How long a mint waits for the next accepted answer before checking again. */
export const NEXT_ANSWER_MAX_MS = 2_000
/** A poll that has not answered after this long counts as a network failure, so a hung request never stops the polls. */
export const POLL_TIMEOUT_MS = 5_000

export type StatePoll =
  | { kind: 'body'; body: StateBody; ageSeconds: number }
  | {
      kind: 'retry'
      afterMs: number
      reason: 'not-read-yet' | 'chain-unreadable' | 'busy' | 'stale' | 'network'
    }
  | { kind: 'final'; reason: 'not-a-collection' | 'unavailable' }
export type WalletPoll =
  { kind: 'body'; body: WalletBody } | { kind: 'retry'; afterMs: number } | { kind: 'final' }

const addressShape = z.custom<Address>(
  (value) => typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value),
)
const count = z.number().int().min(0)
const wei = z.string().regex(/^[0-9]+$/)

const stateBodySchema: z.ZodType<StateBody> = z.object({
  chainId: count,
  address: addressShape,
  block: count,
  blockTimestamp: count,
  readAt: count,
  degraded: z.boolean(),
  maxSupply: count,
  totalMinted: count,
  publicMaxMintPerWallet: count,
  mintFeeFlatWei: wei,
  mintFeeBps: count,
  airdropFeePerTokenWei: wei,
  mintOnBehalfActive: z.boolean(),
  groups: z.array(
    z.object({
      id: count,
      priceWei: wei,
      maxSupply: count,
      minted: count,
      startTimestamp: count,
      flag: z.boolean(),
      active: z.boolean(),
    }),
  ),
  owner: addressShape,
  royalty: z.object({ receiver: addressShape, bps: count }),
  baseUri: z.string(),
  transferValidator: addressShape,
  transferLevel: z.union([z.literal('none'), z.literal('unread'), count]),
})

const quotaSchema = z.object({ id: count, quota: count, claimed: count })
const walletBodySchema: z.ZodType<WalletBody> = z.object({
  chainId: count,
  address: addressShape,
  wallet: addressShape,
  block: count,
  publicMinted: count,
  groups: z.array(quotaSchema),
  vaults: z.array(z.object({ vault: addressShape, publicMinted: count, groups: z.array(quotaSchema) })),
})

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
/** `Retry-After` in milliseconds: its seconds, or 1 s without one. */
const retryAfterMs = (response: Response) => {
  const seconds = Number(response.headers.get('retry-after'))
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1_000 : 1_000
}
/** The edge's `Age` in seconds, 0 without one. */
const ageOf = (response: Response) => {
  const age = Number(response.headers.get('age') ?? 0)
  return Number.isFinite(age) && age > 0 ? age : 0
}
/** The refusal's `{ "error": "<code>" }`, or null for a body that is not one. */
async function refusalCodeOf(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { error?: unknown }
    return typeof body.error === 'string' ? body.error : null
  } catch {
    return null
  }
}

/** One request, failed after `POLL_TIMEOUT_MS`; null when the network did not answer. */
async function request(url: string, fetchImpl: typeof fetch): Promise<Response | null> {
  try {
    return await fetchImpl(url, { cache: 'no-cache', signal: AbortSignal.timeout(POLL_TIMEOUT_MS) })
  } catch {
    return null
  }
}

/**
 * One poll of a collection's state: a body that parses for the asked chain and address, with its edge `Age`;
 * an `Age` above 10 s, a 503 (after its `Retry-After`), a network error, another status or a body that does not
 * parse is a retry; a 404 `not-a-collection` is final for the page load, and any other 404, a 400 or a build
 * without the server's origin final as unavailable.
 */
export async function pollState(
  base: string | undefined,
  chainId: number,
  address: Address,
  fetchImpl: typeof fetch = fetch,
): Promise<StatePoll> {
  if (!base) return { kind: 'final', reason: 'unavailable' }
  const response = await request(`${base}${statePath(chainId, address)}`, fetchImpl)
  if (!response) return { kind: 'retry', afterMs: 1_000, reason: 'network' }
  if (response.status === 200) {
    let parsed: ReturnType<typeof stateBodySchema.safeParse>
    try {
      parsed = stateBodySchema.safeParse(await response.json())
    } catch {
      return { kind: 'retry', afterMs: 1_000, reason: 'network' }
    }
    if (!parsed.success || parsed.data.chainId !== chainId || !same(parsed.data.address, address))
      return { kind: 'retry', afterMs: 1_000, reason: 'network' }
    const ageSeconds = ageOf(response)
    if (ageSeconds > UNREACHABLE_AGE_S) return { kind: 'retry', afterMs: 1_000, reason: 'stale' }
    return { kind: 'body', body: parsed.data, ageSeconds }
  }
  if (response.status === 503) {
    const code = await refusalCodeOf(response)
    const reason =
      code === 'not-read-yet' || code === 'chain-unreadable' || code === 'busy' ? code : 'network'
    return { kind: 'retry', afterMs: retryAfterMs(response), reason }
  }
  if (response.status === 404) {
    const code = await refusalCodeOf(response)
    return { kind: 'final', reason: code === 'not-a-collection' ? 'not-a-collection' : 'unavailable' }
  }
  if (response.status === 400) return { kind: 'final', reason: 'unavailable' }
  return { kind: 'retry', afterMs: 1_000, reason: 'network' }
}

/** One poll of a wallet's quotas and vaults, read as the state's is. */
export async function pollWallet(
  base: string | undefined,
  chainId: number,
  address: Address,
  wallet: Address,
  fetchImpl: typeof fetch = fetch,
): Promise<WalletPoll> {
  if (!base) return { kind: 'final' }
  const response = await request(`${base}${walletPath(chainId, address, wallet)}`, fetchImpl)
  if (!response) return { kind: 'retry', afterMs: 1_000 }
  if (response.status === 200) {
    let parsed: ReturnType<typeof walletBodySchema.safeParse>
    try {
      parsed = walletBodySchema.safeParse(await response.json())
    } catch {
      return { kind: 'retry', afterMs: 1_000 }
    }
    if (
      !parsed.success ||
      parsed.data.chainId !== chainId ||
      !same(parsed.data.address, address) ||
      !same(parsed.data.wallet, wallet) ||
      ageOf(response) > UNREACHABLE_AGE_S
    )
      return { kind: 'retry', afterMs: 1_000 }
    return { kind: 'body', body: parsed.data }
  }
  if (response.status === 503) return { kind: 'retry', afterMs: retryAfterMs(response) }
  if (response.status === 404 || response.status === 400) return { kind: 'final' }
  return { kind: 'retry', afterMs: 1_000 }
}

/** What the page has read: the body it shows, the clock's anchor and how the polls are going. */
export type FreshTrack = {
  body: StateBody | null
  /** The highest block of an accepted body; -1 before the first. */
  highestBlock: number
  /** The chain's time in seconds at `performance.now()` `at`, set by each body with a new block. */
  anchor: { seconds: number; at: number } | null
  /** When the last body was accepted (`performance.now()`). */
  lastGoodAt: number | null
  /** Failed polls since the last accepted body. */
  failures: number
  /** The wait before the next poll after a failure. */
  retryMs: number | null
  /** A refusal that stops the polls for this page load. */
  final: 'not-a-collection' | 'unavailable' | null
}

export const EMPTY_TRACK: FreshTrack = {
  body: null,
  highestBlock: -1,
  anchor: null,
  lastGoodAt: null,
  failures: 0,
  retryMs: null,
  final: null,
}

/**
 * Folds a poll into the track: a body above the highest block replaces the shown one and anchors the clock at its
 * block time plus its `Age`; one at the highest block replaces the shown one (`degraded` may have changed) and
 * keeps the anchor; one below is ignored. A retry adds a failure and doubles its wait up to 8 s; a final stops.
 */
export function foldState(track: FreshTrack, poll: StatePoll, nowMs: number): FreshTrack {
  if (poll.kind === 'final') return { ...track, final: poll.reason, retryMs: null }
  if (poll.kind === 'retry') {
    const failures = track.failures + 1
    return { ...track, failures, retryMs: Math.min(RETRY_MAX_MS, poll.afterMs * 2 ** (failures - 1)) }
  }
  const { body } = poll
  if (body.block < track.highestBlock) return track
  const accepted = { ...track, body, lastGoodAt: nowMs, failures: 0, retryMs: null }
  if (body.block === track.highestBlock) return accepted
  return {
    ...accepted,
    highestBlock: body.block,
    anchor: { seconds: body.blockTimestamp + poll.ageSeconds, at: nowMs },
  }
}

/** The chain's time now by the anchor, in whole seconds; null before the first body. Labels only. */
export function chainNowOf(track: FreshTrack, nowMs: number): number | null {
  if (!track.anchor) return null
  return Math.floor(track.anchor.seconds + (nowMs - track.anchor.at) / 1_000)
}

/** The page's own degraded flag: a body is shown and no answer was accepted for 10 s. */
export function ownDegraded(track: FreshTrack, nowMs: number): boolean {
  return track.body !== null && track.lastGoodAt !== null && nowMs - track.lastGoodAt >= OWN_DEGRADED_MS
}

/**
 * The wait before the next state poll: none after a final refusal; the retry's after a failure; 1 s with no body
 * yet or while a visible phase is starting or scheduled within 60 s by the chain clock; else 3 s.
 */
export function cadenceMs(
  track: FreshTrack,
  phases: readonly Pick<Phase, 'status' | 'startsIn'>[],
): number | null {
  if (track.final) return null
  if (track.retryMs !== null) return track.retryMs
  if (!track.body) return 1_000
  const soon = phases.some(
    (phase) =>
      phase.status === 'starting' ||
      (phase.status === 'scheduled' && phase.startsIn !== null && phase.startsIn <= 60),
  )
  return soon ? 1_000 : 3_000
}
```

Create `apps/web/src/lib/mint/live-data.ts`:

```ts
import type { StateBody, WalletBody } from '@cobweb/shared'
import type { Address } from 'viem'
import type { FeeSnapshot, MintGroup, WalletState } from '@/lib/demo/types'
import { joinPhases } from '@/lib/manage/phases-view'
import type { MintPageStatic } from './page-doc'

/**
 * The chain's state as the mint page reads it (docs/specs/2026-10-16-mint-page-live-data.md, section 7.4), pure:
 * the freshness server's state body joined with the document's phases, the reveal and the transfer rows; the
 * wallet answer as allowances; and the mints this page saw land. Liveness is each group's `active`.
 */
export type MintLive = {
  block: number
  blockTimestamp: number
  /** When the server read the chain (its clock), for the degraded banner's minutes. */
  readAt: number
  degraded: boolean
  supply: { max: number; minted: number }
  publicMaxMintPerWallet: number
  fees: FeeSnapshot
  /** The chain's groups with their names, in the creator's order; groups registered outside Cobweb after them. */
  groups: MintGroup[]
  /** The contract's owner. */
  creator: Address
  royaltyBps: number
  baseUri: string
  /** The base URI is set and is not one of the placeholders. */
  revealed: boolean
  mintOnBehalfActive: boolean
  /** Null when the collection has no validator level to show. */
  transfers: 'open' | 'locked' | 'restricted' | null
  /** Royalties are enforced through the transfer validator: level 0 only. */
  royaltyEnforced: boolean
}

/** A wallet's answer as allowances, with the block it was read at. */
export type WalletView = WalletState & { block: number }

/**
 * A mint this page saw land: its group, who holds the allowance it used (the vault, else the wallet), how many and
 * the receipt's block. Supply counts add it while the state is older than its block, allowances while the wallet
 * answer is, so a later answer that includes it never counts it twice.
 */
export type LocalMint = { groupId: number; holder: Address; count: number; block: number }

/** Revealed: the base URI is neither empty nor a placeholder; a custom link reads revealed. */
export function revealedOf(baseUri: string, placeholders: readonly string[]): boolean {
  return baseUri !== '' && !placeholders.includes(baseUri)
}

/** The Transfers row: locked at level 9, open at 0 and 1, restricted at any other level, and none to show otherwise. */
export function transfersOf(level: StateBody['transferLevel']): MintLive['transfers'] {
  if (level === 'none' || level === 'unread') return null
  if (level === 9) return 'locked'
  return level === 0 || level === 1 ? 'open' : 'restricted'
}

/** The page's view of a state body. */
export function liveOf(page: MintPageStatic, body: StateBody): MintLive {
  return {
    block: body.block,
    blockTimestamp: body.blockTimestamp,
    readAt: body.readAt,
    degraded: body.degraded,
    supply: { max: body.maxSupply, minted: body.totalMinted },
    publicMaxMintPerWallet: body.publicMaxMintPerWallet,
    fees: {
      mintFeeFlatWei: body.mintFeeFlatWei,
      mintFeeBps: body.mintFeeBps,
      airdropFeePerTokenWei: body.airdropFeePerTokenWei,
    },
    groups: joinPhases(body, page.phases),
    creator: body.owner,
    royaltyBps: body.royalty.bps,
    baseUri: body.baseUri,
    revealed: revealedOf(body.baseUri, page.placeholders),
    mintOnBehalfActive: body.mintOnBehalfActive,
    transfers: transfersOf(body.transferLevel),
    royaltyEnforced: body.transferLevel === 0,
  }
}

/**
 * A wallet answer as allowances: each group's quota and what it used, a whitelist group eligible when its quota
 * is above 0 (the public group always), and each vault's whitelist groups with quota left on chain, a vault with
 * none left off.
 */
export function walletViewOf(body: WalletBody): WalletView {
  return {
    address: body.wallet,
    publicMinted: body.publicMinted,
    groups: body.groups.map((group) => ({
      groupId: group.id,
      quota: group.quota,
      used: group.claimed,
      eligible: group.id === 0 || group.quota > 0,
    })),
    delegatedVaults: body.vaults.flatMap((vault) => {
      const groups = vault.groups
        .filter((group) => group.id !== 0 && group.quota > 0)
        .map((group) => ({ groupId: group.id, quota: group.quota, used: group.claimed }))
      return groups.length ? [{ vault: vault.vault, groups }] : []
    }),
    block: body.block,
  }
}
```

- [ ] **Step 5: The mint: the call, the failures, the run and the wagmi chain**

Create `apps/web/src/lib/mint/mint-call.ts`:

```ts
import { collectionAbi } from '@cobweb/shared/collection-abi'
import { decodeEventLog, zeroAddress, type Address, type TransactionReceipt } from 'viem'
import type { FeeSnapshot } from '@/lib/demo/types'

/**
 * The mint as the collection takes it (docs/specs/2026-10-16-mint-page-live-data.md, section 7.5), pure: the
 * total the contract's `quoteBatchMint` charges, the call (`batchMint`, or `delegateMint` with a vault), and the
 * ids a receipt minted to the wallet.
 */

/** What the page mints: the group, how many, against whose allowance, and the total it sends. */
export type MintParams = {
  contract: Address
  chainId: number
  groupId: number
  amount: number
  /** Mint against this vault's allowance (delegate.xyz). Tokens still go to the caller. */
  vault: Address | null
  /** The state's quote for `amount` tokens, in wei: exactly what the contract charges. */
  valueWei: bigint
  account: Address
}

/** The call the wallet sends, as wagmi's `simulateContract` takes it. */
export type MintCall = {
  address: Address
  abi: typeof collectionAbi
  functionName: 'batchMint' | 'delegateMint'
  args: readonly [bigint, bigint] | readonly [bigint, bigint, Address]
  value: bigint
  chainId: number
  account: Address
}

export type Quote = { priceWei: bigint; feeWei: bigint; totalWei: bigint; quantity: number }

/**
 * The contract's `quoteBatchMint`: per token the price plus the flat fee and the basis points of the price, the
 * division rounding down as Solidity's does, times the quantity.
 */
export function quoteOf(
  fees: Pick<FeeSnapshot, 'mintFeeFlatWei' | 'mintFeeBps'>,
  priceWei: string,
  quantity: number,
): Quote {
  const price = BigInt(priceWei)
  const count = BigInt(quantity)
  const feeWei = (BigInt(fees.mintFeeFlatWei) + (price * BigInt(fees.mintFeeBps)) / 10_000n) * count
  return { priceWei: price * count, feeWei, totalWei: price * count + feeWei, quantity }
}

/** The call for a mint: `delegateMint(amount, group, vault)` with a vault, else `batchMint(amount, group)`. */
export function mintCallOf(params: MintParams): MintCall {
  const amount = BigInt(params.amount)
  const group = BigInt(params.groupId)
  return {
    address: params.contract,
    abi: collectionAbi,
    functionName: params.vault ? 'delegateMint' : 'batchMint',
    args: params.vault ? [amount, group, params.vault] : [amount, group],
    value: params.valueWei,
    chainId: params.chainId,
    account: params.account,
  }
}

/**
 * The ids a receipt minted to the receiver, sorted: the collection's `Transfer` logs from the zero address to it.
 * A transfer between holders, another contract's log and a mint to someone else are not this mint's.
 */
export function mintedTokenIds(
  receipt: Pick<TransactionReceipt, 'logs'>,
  contract: Address,
  receiver: Address,
): number[] {
  const ids: number[] = []
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== contract.toLowerCase()) continue
    try {
      const event = decodeEventLog({
        abi: collectionAbi,
        eventName: 'Transfer',
        data: log.data,
        topics: log.topics,
      })
      // viem decodes any event of the ABI by its topic, whatever `eventName` says: the name is compared here.
      if (event.eventName !== 'Transfer') continue
      if (
        event.args.from.toLowerCase() === zeroAddress &&
        event.args.to.toLowerCase() === receiver.toLowerCase()
      )
        ids.push(Number(event.args.tokenId))
    } catch {
      // A log the collection's ABI does not decode.
    }
  }
  return ids.sort((a, b) => a - b)
}
```

Create `apps/web/src/lib/mint/mint-failure.ts`:

```ts
import type { Hex } from 'viem'
import { causes, revertOf, shortMessageOf } from '@/components/deploy/tx-errors'

/**
 * How a mint fails, in words (docs/specs/2026-10-16-mint-page-live-data.md, section 7.6), pure: the error's cause
 * chain read as tx-errors.ts reads it (a rejection is `UserRejectedRequestError` or code 4001, "insufficient
 * funds" anywhere is the balance, the revert is viem's decoded `ContractFunctionRevertedError`), each kind's
 * title and sentence with the revert's counts, and its ways forward. Every kind before the wallet sends says
 * nothing was sent.
 */
export type MintFailureKind =
  | 'rejected'
  | 'phase-closed'
  | 'sold-out'
  | 'quota-exceeded'
  | 'not-listed'
  | 'not-delegate'
  | 'price-changed'
  | 'insufficient-balance'
  | 'contract-wallet'
  | 'wrong-network'
  | 'check-failed'
  | 'wallet-failed'
  | 'reverted'
  | 'unconfirmed'

/** Where the mint was: the check, the wallet, or waiting for the chain. */
export type MintStep = 'checking' | 'wallet' | 'confirming'

/** What a failure's words need: the tokens left, what the wallet may still mint, the wallet's message, the hash. */
export type MintFailureDetail = { left?: number; allowed?: number; message?: string; hash?: Hex }

export class MintFailure extends Error {
  readonly kind: MintFailureKind
  readonly detail: MintFailureDetail

  constructor(kind: MintFailureKind, detail: MintFailureDetail = {}, options?: { cause?: unknown }) {
    super(kind, options)
    this.name = 'MintFailure'
    this.kind = kind
    this.detail = detail
  }
}

/** The collection's custom errors a mint can revert with, by kind. */
const REVERTS: Record<string, MintFailureKind> = {
  MintGroupInactive: 'phase-closed',
  ExceedsMintGroupMaxSupply: 'sold-out',
  ExceedsMaxSupply: 'sold-out',
  ExceedsPublicMaxPerWallet: 'quota-exceeded',
  ExceedsMintQuota: 'quota-exceeded',
  NotInWhitelist: 'not-listed',
  NotDelegate: 'not-delegate',
  InsufficientEther: 'price-changed',
  TransferToNonERC721ReceiverImplementer: 'contract-wallet',
}

/** The custom error's name a failed simulation decoded, or null. */
export function revertNameOf(error: unknown): string | null {
  return revertOf(causes(error))?.errorName ?? null
}

/**
 * A failure in words for the step it happened at. A rejection, the balance and a changed network read the same at
 * every step; a decoded revert reads as its kind with its counts; any other failure is the check's, the wallet's
 * or, once sent, the receipt's not arriving.
 */
export function mintFailureOf(error: unknown, at: MintStep, hash?: Hex): MintFailure {
  if (error instanceof MintFailure) return error
  const chain = causes(error)
  const named = (name: string) => chain.some((entry) => (entry as { name?: unknown }).name === name)
  const fail = (kind: MintFailureKind, detail: MintFailureDetail = {}) =>
    new MintFailure(kind, hash ? { ...detail, hash } : detail, { cause: error })
  if (named('UserRejectedRequestError') || chain.some((entry) => (entry as { code?: unknown }).code === 4001))
    return fail('rejected')
  const text = chain.map((entry) => (entry instanceof Error ? entry.message : String(entry))).join(' ')
  if (/insufficient funds/i.test(text)) return fail('insufficient-balance')
  if (named('ChainMismatchError')) return fail('wrong-network')
  if (at === 'confirming') return fail('unconfirmed')
  const revert = revertOf(chain)
  const kind = revert ? REVERTS[revert.errorName] : undefined
  if (revert && kind) {
    if (kind === 'sold-out') return fail(kind, { left: Number(revert.args[1]) })
    if (kind === 'quota-exceeded') return fail(kind, { allowed: Number(revert.args[1]) })
    return fail(kind)
  }
  if (at === 'checking') return fail('check-failed')
  return fail('wallet-failed', { message: shortMessageOf(error) })
}

/** A failure's title and sentence, with its counts and the collection's chain. */
export function failureCopy(failure: MintFailure, chainName: string): { title: string; sentence: string } {
  const { left = 0, allowed = 0, message } = failure.detail
  switch (failure.kind) {
    case 'rejected':
      return {
        title: 'You cancelled in your wallet',
        sentence: 'Nothing was sent and nothing was charged. You can try again whenever you are ready.',
      }
    case 'phase-closed':
      return {
        title: 'This phase is not open',
        sentence:
          'The check found the phase closed, so nothing was sent. The page shows which phases are open.',
      }
    case 'sold-out':
      return {
        title: 'Fewer tokens are left',
        sentence:
          left === 0
            ? 'Every token of this phase is minted. Nothing was sent.'
            : `Only ${left.toLocaleString('en-US')} ${left === 1 ? 'is' : 'are'} left, so nothing was sent.`,
      }
    case 'quota-exceeded':
      return {
        title: 'That is more than this wallet can mint',
        sentence: `This wallet can mint ${allowed.toLocaleString('en-US')} more in this phase, often because another of its mints landed first. Nothing was sent.`,
      }
    case 'not-listed':
      return {
        title: 'This wallet is not on the list',
        sentence: 'The contract does not list this wallet for this phase. Nothing was sent.',
      }
    case 'not-delegate':
      return {
        title: 'The vault no longer delegates to this wallet',
        sentence:
          'delegate.xyz shows no delegation from this vault to this wallet for the collection. Nothing was sent.',
      }
    case 'price-changed':
      return {
        title: 'The price changed',
        sentence:
          'The total changed after this page read it, so nothing was sent. The page shows the new total.',
      }
    case 'insufficient-balance':
      return {
        title: 'Not enough funds in this wallet',
        sentence: 'The wallet cannot cover the total plus gas. Nothing was sent.',
      }
    case 'contract-wallet':
      return {
        title: 'This wallet cannot hold the tokens',
        sentence:
          'It is a contract that cannot receive ERC-721 tokens. Mint from another wallet. Nothing was sent.',
      }
    case 'wrong-network':
      return {
        title: 'Your wallet changed network',
        sentence: `Switch back to ${chainName}, then try again. Nothing was sent.`,
      }
    case 'check-failed':
      return {
        title: 'The check could not be completed',
        sentence:
          'The mint could not be checked against the contract. Nothing was sent. Try again in a moment.',
      }
    case 'wallet-failed':
      return {
        title: 'Your wallet did not send it',
        sentence: `${message ?? 'Unknown error.'} Nothing was charged.`,
      }
    case 'reverted':
      return {
        title: 'The transaction failed on chain',
        sentence:
          'The network rejected it, usually because the phase closed or sold out while it waited. No tokens were minted; only gas was spent.',
      }
    case 'unconfirmed':
      return {
        title: 'Not confirmed yet',
        sentence:
          'The transaction was sent but is not confirmed after three minutes. It may still land: check it on the explorer before you mint again.',
      }
  }
}

/** A way forward from a failure, as the dialog's buttons offer them, in order. */
export type FailureAction =
  | { kind: 'retry' }
  | { kind: 'close' }
  | { kind: 'see-phases' }
  /** Sets the quantity to the count the revert named, then closes. */
  | { kind: 'mint-count'; count: number }
  | { kind: 'mint-fewer'; count: number }
  /** Mints from this wallet instead of the vault. */
  | { kind: 'use-wallet' }
  | { kind: 'view-transaction' }

export function failureActions(failure: MintFailure): FailureAction[] {
  const { left = 0, allowed = 0 } = failure.detail
  switch (failure.kind) {
    case 'phase-closed':
    case 'not-listed':
      return [{ kind: 'see-phases' }]
    case 'sold-out':
      return left > 0 ? [{ kind: 'mint-count', count: left }, { kind: 'close' }] : [{ kind: 'close' }]
    case 'quota-exceeded':
      return allowed > 0 ? [{ kind: 'mint-fewer', count: allowed }, { kind: 'retry' }] : [{ kind: 'retry' }]
    case 'insufficient-balance':
      return [{ kind: 'mint-fewer', count: 1 }, { kind: 'retry' }]
    case 'not-delegate':
      return [{ kind: 'use-wallet' }, { kind: 'close' }]
    case 'price-changed':
    case 'wrong-network':
      return [{ kind: 'retry' }]
    case 'contract-wallet':
      return [{ kind: 'close' }]
    case 'unconfirmed':
      return [{ kind: 'view-transaction' }, { kind: 'close' }]
    case 'rejected':
    case 'check-failed':
    case 'wallet-failed':
    case 'reverted':
      return [{ kind: 'retry' }, { kind: 'close' }]
  }
}
```

Create `apps/web/src/lib/mint/mint-run.ts`:

```ts
import type { Hex, TransactionReceipt } from 'viem'
import { mintCallOf, mintedTokenIds, type MintCall, type MintParams } from './mint-call'
import { MintFailure, mintFailureOf, revertNameOf } from './mint-failure'

/**
 * The mint, step by step (docs/specs/2026-10-16-mint-page-live-data.md, section 7.5): simulate the call from the
 * connected account, open the wallet only after a passing simulation with exactly the simulated request
 * (CLAUDE.md rule 2), then read the receipt and the ids it minted. A simulation that finds the group inactive
 * while the page's state reads it live waits for the next accepted answer and checks once more.
 */

/** Where the page's mints go: the live chain through wagmi, or the sample's simulated one. */
export type MintChain = {
  /** Simulates the call; resolves with the function that sends the simulated request, unchanged. */
  simulate(call: MintCall): Promise<() => Promise<Hex>>
  /** The transaction's receipt, waited for up to three minutes. */
  receipt(hash: Hex, chainId: number): Promise<TransactionReceipt>
}

export type MintResult = { hash: Hex; tokenIds: number[]; block: number }

export async function runMint(
  chain: MintChain,
  params: MintParams,
  live: { isLive(groupId: number): boolean; nextAnswer(): Promise<void> },
  steps: { wallet(): void; sent(hash: Hex): void },
): Promise<MintResult> {
  const call = mintCallOf(params)
  let send: () => Promise<Hex>
  try {
    send = await chain.simulate(call)
  } catch (error) {
    // The chain opened the group a moment before the page's state shows it, or the state read it live first:
    // the check runs once more after the next answer.
    if (revertNameOf(error) !== 'MintGroupInactive' || !live.isLive(params.groupId))
      throw mintFailureOf(error, 'checking')
    await live.nextAnswer()
    try {
      send = await chain.simulate(call)
    } catch (again) {
      throw mintFailureOf(again, 'checking')
    }
  }
  steps.wallet()
  let hash: Hex
  try {
    hash = await send()
  } catch (error) {
    throw mintFailureOf(error, 'wallet')
  }
  steps.sent(hash)
  let receipt: TransactionReceipt
  try {
    receipt = await chain.receipt(hash, params.chainId)
  } catch (error) {
    throw mintFailureOf(error, 'confirming', hash)
  }
  if (receipt.status === 'reverted') throw new MintFailure('reverted', { hash })
  return {
    hash,
    tokenIds: mintedTokenIds(receipt, params.contract, params.account),
    block: Number(receipt.blockNumber),
  }
}
```

Create `apps/web/src/lib/mint/wagmi-chain.ts`:

```ts
import type { Config } from 'wagmi'
import { getPublicClient, simulateContract, writeContract } from 'wagmi/actions'
import type { MintCall } from './mint-call'
import type { MintChain } from './mint-run'

/**
 * The live chain for the page's mints (docs/specs/2026-10-16-mint-page-live-data.md, section 7.5): wagmi
 * simulates the call through the chain's public transport and sends the simulated request through the connected
 * wallet; the receipt is read through the same transport for up to three minutes, as the manage actions read
 * theirs. Both concern the visitor's own transaction, not shared state (CLAUDE.md rule 3).
 */
export function wagmiMintChain(config: Config): MintChain {
  return {
    simulate: async (call: MintCall) => {
      const simulated = await simulateContract(config, { ...call })
      // CLAUDE.md rule 2: the wallet gets exactly the request the simulation passed.
      return () => writeContract(config, simulated.request)
    },
    receipt: async (hash, chainId) => {
      const client = getPublicClient(config, { chainId })
      if (!client) throw new Error('No RPC for this chain')
      return client.waitForTransactionReceipt({ hash, timeout: 180_000 })
    },
  }
}
```

- [ ] **Step 6: Token art**

Create `apps/web/src/lib/mint/token-art.ts`:

```ts
import { tokenUriOf } from '@/lib/manage/settings-view'

/**
 * A token's art on the mint page (docs/specs/2026-10-16-mint-page-live-data.md, section 7.7): the `image` of its
 * metadata, read in the browser through the IPFS gateway at the URI the contract's rule gives. Before the reveal
 * the base URI is the placeholder's, so every token shows the placeholder's image; nothing reads a CID the chain
 * does not point at.
 */

/** A token drawn from its images, bottom first (one for metadata art), and whether it plays as a video. */
export type TokenArt = { layers: string[]; video: boolean }

/** An `ipfs://` URI as the gateway's path (`<gateway>/<cid>/<path>`), an https URL kept, anything else refused. */
export function gatewayUrlOf(uri: string, gateway: string): string | null {
  if (uri.startsWith('ipfs://')) {
    const path = uri.slice('ipfs://'.length).replace(/^ipfs\//, '')
    return path ? `${gateway}/${path}` : null
  }
  return uri.startsWith('https://') ? uri : null
}

/** A token's art from its metadata, or null when the metadata or its image cannot be read. */
export async function tokenArtOf(
  baseUri: string,
  id: number,
  gateway: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TokenArt | null> {
  const metadataUrl = gatewayUrlOf(tokenUriOf(baseUri, id), gateway)
  if (!metadataUrl) return null
  try {
    const response = await fetchImpl(metadataUrl)
    if (!response.ok) return null
    const metadata = (await response.json()) as { image?: unknown }
    if (typeof metadata.image !== 'string') return null
    const image = gatewayUrlOf(metadata.image, gateway)
    if (!image) return null
    return { layers: [image], video: /\.mp4($|[?#])/i.test(image) }
  } catch {
    return null
  }
}
```

- [ ] **Step 7: Run the tests to see them pass, then typecheck and lint the web app**

Run: `pnpm --filter @cobweb/web exec vitest run src/lib/mint/fresh-client.test.ts src/lib/mint/live-data.test.ts src/lib/mint/mint-call.test.ts src/lib/mint/mint-failure.test.ts src/lib/mint/mint-run.test.ts src/lib/mint/token-art.test.ts src/lib/manage/settings-view.test.ts src/lib/wagmi.test.ts`
Expected: PASS, `Test Files  8 passed (8)` and `Tests  53 passed (53)`.

Run: `pnpm --filter @cobweb/web typecheck && pnpm --filter @cobweb/web lint`
Expected: no errors and no warnings.

- [ ] **Step 8: Format, run the root checks and commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
pnpm exec prettier --write apps/web/src/lib/mint/fresh-client.ts apps/web/src/lib/mint/fresh-client.test.ts apps/web/src/lib/mint/live-data.ts apps/web/src/lib/mint/live-data.test.ts apps/web/src/lib/mint/mint-call.ts apps/web/src/lib/mint/mint-call.test.ts apps/web/src/lib/mint/mint-failure.ts apps/web/src/lib/mint/mint-failure.test.ts apps/web/src/lib/mint/mint-run.ts apps/web/src/lib/mint/mint-run.test.ts apps/web/src/lib/mint/wagmi-chain.ts apps/web/src/lib/mint/token-art.ts apps/web/src/lib/mint/token-art.test.ts apps/web/src/components/deploy/tx-errors.ts apps/web/src/lib/manage/settings-view.ts apps/web/src/lib/manage/settings-view.test.ts apps/web/src/lib/wagmi.ts apps/web/src/lib/wagmi.test.ts
pnpm typecheck && pnpm lint && pnpm test
git add apps/web/src/lib/mint/fresh-client.ts apps/web/src/lib/mint/fresh-client.test.ts apps/web/src/lib/mint/live-data.ts apps/web/src/lib/mint/live-data.test.ts apps/web/src/lib/mint/mint-call.ts apps/web/src/lib/mint/mint-call.test.ts apps/web/src/lib/mint/mint-failure.ts apps/web/src/lib/mint/mint-failure.test.ts apps/web/src/lib/mint/mint-run.ts apps/web/src/lib/mint/mint-run.test.ts apps/web/src/lib/mint/wagmi-chain.ts apps/web/src/lib/mint/token-art.ts apps/web/src/lib/mint/token-art.test.ts apps/web/src/components/deploy/tx-errors.ts apps/web/src/lib/manage/settings-view.ts apps/web/src/lib/manage/settings-view.test.ts apps/web/src/lib/wagmi.ts apps/web/src/lib/wagmi.test.ts
git commit -m "$(cat <<'EOF'
Add the mint page's freshness client with its track, clock and cadence, the page's view of the state and wallet answers, the mint call, run and failures, the wagmi chain and token art, with a transport per chain and tokenUriOf by id

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: the web app reports 760 tests in 83 files; the other packages are unchanged.

---

### Task 5: The page on live data: the model, the sources, the hooks, the mint flow and the route cached by link

**Files:**

- Create: `apps/web/src/lib/mint/live-source.ts`, `apps/web/src/components/mint/use-live-state.ts`, `use-wallet-view.ts`, `use-token-art.ts`, `sample-source.ts`, `sample-source.test.ts`, `sample-page.tsx`
- Modify (whole files): `apps/web/src/components/mint/model.ts`, `model.test.ts`, `types.ts`, `use-mint-flow.ts`, `mint-context.tsx`, `token-image.tsx`, `art-stage.tsx`, `collection-sections.tsx`, `mint-flow-dialog.tsx`, `mint-page.tsx`, `mint-panel.tsx`, `mint-top-bar.tsx`, `apps/web/src/app/[slug]/page.tsx`, `sample-data.ts`
- Modify (blocks): `apps/web/src/components/mint/mint-action.tsx`, `mint-success.tsx`, `panel-controls.tsx`, `phase-list.tsx`, `sticky-mint-bar.tsx`, `wallet-button.tsx`, `apps/web/.env.example`
- Remove (`git rm`): `apps/web/src/components/mint/mint-transaction.ts`
- Test: `model.test.ts`, `sample-source.test.ts`; the build

**Interfaces:**

- Consumes: Tasks 2 to 4 (`MintPageStatic`, `readMintPage`, `pollState`, `pollWallet`, `foldState`, `chainNowOf`, `ownDegraded`, `cadenceMs`, `NEXT_ANSWER_MAX_MS`, `OWN_DEGRADED_MS`, `liveOf`, `walletViewOf`, `MintLive`, `WalletView`, `LocalMint`, `quoteOf`, `Quote`, `MintParams`, `runMint`, `MintChain`, `MintResult`, `MintFailure`, `mintFailureOf`, `failureCopy`, `failureActions`, `wagmiMintChain`, `tokenArtOf`, `TokenArt`); `lib/demo` (`getMintPageData`, `MINT_PAGE_VARIANTS`, `DEMO_NOW`, `DEMO_TOKENS`, `DEMO_DEPLOYMENT`, `DEMO_RENDER_JOBS`, `DEMO_MINT_PAGE_SETTINGS`, `DEMO_MINT_PAGE_SECTIONS`, `sampleTxHash`, `tokenLayerUrls`); `isDemoMode` (`lib/steps.ts`); `RESERVED_SLUGS` (`lib/collections`); wagmi's `useAccount`, `useConfig`, `useSwitchChain` and RainbowKit's `useConnectModal`; TanStack Query's `useQuery` and `useQueries`.
- Produces:
  - `lib/mint/live-source.ts`: `MintSource = { pollState(): Promise<StatePoll>; pollWallet(wallet: Address): Promise<WalletPoll>; chain: MintChain; tokenArt(baseUri: string, id: number): Promise<TokenArt | null> }`, `liveMintSource(page: MintPageStatic, deps: { freshnessUrl: string | undefined; chain: MintChain; supabase: SupabaseClient<Database>; fetchImpl?: typeof fetch }): MintSource`
  - `components/mint/model.ts` on `MintLive`: `PhaseStatus`, `Allowance`, `Phase = { group; status; remainingSupply; startsIn; wallet: (Allowance & { eligible }) | null; vaults: (Allowance & { vault })[] }`, `totalMinted(live, local?)`, `derivePhases(live: MintLive, wallet: WalletView | null, chainNow: number | null, local?: readonly LocalMint[]): Phase[]`, `sortPhases`, `defaultPhaseId`, `quote(live, priceWei, quantity): Quote`, `allowanceFor`, `maxQuantity`, `MintAction`, `deriveAction({ page, live, phase, connected, walletRead, wrongChain, quantity, vault, soldOut }): MintAction` ("Reading the chain" before the first answer, "Starts in <countdown>", "Starting, waiting for the chain", "Checking this wallet", the limits, "Switch to <chain>", "Mint <n> for <total>")
  - `components/mint/use-live-state.ts`: `useLiveState(source: MintSource, page: MintPageStatic)` answering `{ track, live, chainNow, ownDegraded, lastGoodAt, waitingLong, nextAnswer, refresh }`; `use-wallet-view.ts`: `useWalletView(source, page, wallet: Address | null, liveKey: string): { view: WalletView | null; final: boolean; refresh(): void }`; `use-token-art.ts`: `useTokenArt(source: MintSource, baseUri: string | null, ids: readonly number[]): Map<number, TokenArt | null | undefined>`
  - `components/mint/sample-source.ts`: `SampleWalletMode`, `SampleSwitches = { variant; wallet; degraded; start; fail }` (`?fail=` takes five kinds until Task 8), `sampleSwitchesOf(query: URLSearchParams): SampleSwitches`, `SAMPLE_PLACEHOLDER_URI`, `SAMPLE_REVEALED_URI`, `sampleMintSource(page: MintPageStatic, switches: SampleSwitches, now?: () => number): MintSource`
  - `components/mint/sample-page.tsx`: `SampleMintPage({ page })`, the sample under its own location's switches (Decision 2); `components/mint/types.ts`: `MintPageProps = { page: MintPageStatic; sample: SampleSwitches | null }`
  - `components/mint/mint-context.tsx`: `MintProvider({ page, sample, children })` and `useMint()` with the page, the source, the live state, the wallet's view, the phases, the action, the local mints and the flow; `use-mint-flow.ts`: `useMintFlow({ chain, live, onMinted })` on `runMint`; `token-image.tsx`: `TokenArtFrame({ art, id, alt, className, eager })` beside `TokenImage`
  - `app/[slug]/page.tsx`: `revalidate = 60`, `generateStaticParams(): []`, the page from `readMintPage` (or the sample's `samplePageStatic(slug)`), no query read; `app/[slug]/sample-data.ts`: `hasSampleCollection(slug)`, `samplePageStatic(slug): MintPageStatic`
  - `apps/web/.env.example`: `NEXT_PUBLIC_FRESHNESS_URL`

- [ ] **Step 1: Write the failing tests**

`model.test.ts` pins Review Focus 4.

Replace the whole of `apps/web/src/components/mint/model.test.ts` with:

```ts
import type { Address } from 'viem'
import { describe, expect, it } from 'vitest'
import type { MintGroup } from '@/lib/demo/types'
import type { LocalMint, MintLive, WalletView } from '@/lib/mint/live-data'
import type { MintPageStatic } from '@/lib/mint/page-doc'
import { defaultPhaseId, deriveAction, derivePhases, sortPhases, totalMinted, type Phase } from './model'

const WALLET: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const VAULT: Address = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
const NOW = 1_791_039_600
const page: Pick<MintPageStatic, 'chain'> = {
  chain: { id: 31337, name: 'Anvil', nativeSymbol: 'ETH', explorerUrl: '', transferLock: false },
}

const group = (id: number, overrides: Partial<MintGroup> = {}): MintGroup => ({
  id,
  name: id === 0 ? 'Public' : `Group ${id}`,
  kind: id === 0 ? 'public' : 'whitelist',
  priceWei: '1000000000000000',
  maxSupply: 10,
  minted: 0,
  flag: false,
  scheduledStart: 0,
  active: false,
  visible: true,
  ...overrides,
})
const live = (groups: MintGroup[], overrides: Partial<MintLive> = {}): MintLive => ({
  block: 100,
  blockTimestamp: NOW,
  readAt: NOW,
  degraded: false,
  supply: { max: 20, minted: 0 },
  publicMaxMintPerWallet: 2,
  fees: { mintFeeFlatWei: '0', mintFeeBps: 0, airdropFeePerTokenWei: '0' },
  groups,
  creator: WALLET,
  royaltyBps: 500,
  baseUri: '',
  revealed: false,
  mintOnBehalfActive: false,
  transfers: null,
  royaltyEnforced: false,
  ...overrides,
})
const wallet = (overrides: Partial<WalletView> = {}): WalletView => ({
  address: WALLET,
  publicMinted: 0,
  groups: [
    { groupId: 0, quota: 0, used: 0, eligible: true },
    { groupId: 1, quota: 2, used: 0, eligible: true },
    { groupId: 2, quota: 0, used: 0, eligible: false },
  ],
  delegatedVaults: [],
  block: 100,
  ...overrides,
})

/** The action for the one phase of a state, connected with the wallet answer unless told otherwise. */
function actionFor(
  state: MintLive,
  options: {
    chainNow?: number
    view?: WalletView | null
    connected?: boolean
    vault?: Address | null
    wrongChain?: boolean
  } = {},
) {
  const view = options.view === undefined ? wallet() : options.view
  const phases = derivePhases(state, view, options.chainNow ?? NOW)
  const phase = phases.find((entry) => entry.group.id === defaultPhaseId(phases)) ?? null
  return deriveAction({
    page,
    live: state,
    phase,
    connected: options.connected ?? true,
    walletRead: view !== null,
    wrongChain: options.wrongChain ?? false,
    quantity: 1,
    vault: options.vault ?? null,
    soldOut: totalMinted(state) >= state.supply.max,
  })
}

describe('deriveAction (docs/specs/2026-10-16-mint-page-live-data.md, section 7.4)', () => {
  it('reads "Starts in 00:00:01" one second before the start, blocked', () => {
    const action = actionFor(live([group(0, { scheduledStart: NOW + 1 })]))
    expect(action).toEqual({ kind: 'blocked', label: 'Starts in 00:00:01' })
  })

  it('stays blocked past the start by the clock while the chain does not report the phase live', () => {
    const action = actionFor(live([group(0, { scheduledStart: NOW - 5 })]))
    expect(action).toEqual({ kind: 'blocked', label: 'Starting, waiting for the chain' })
  })

  it('offers the mint with its total only when the group is active', () => {
    const action = actionFor(live([group(0, { active: true, flag: true })]))
    expect(action.kind).toBe('mint')
    expect(action.label).toBe('Mint 1 for 0.001 ETH')
  })

  it('reads "Reading the chain" before the first answer and "Checking this wallet" before the wallet answer', () => {
    expect(
      deriveAction({
        page,
        live: null,
        phase: null,
        connected: true,
        walletRead: false,
        wrongChain: false,
        quantity: 1,
        vault: null,
        soldOut: false,
      }),
    ).toEqual({ kind: 'blocked', label: 'Reading the chain' })
    expect(actionFor(live([group(0, { active: true })]), { view: null })).toEqual({
      kind: 'blocked',
      label: 'Checking this wallet',
    })
  })

  it('asks to connect a visitor without a wallet', () => {
    expect(actionFor(live([group(0, { active: true })]), { connected: false, view: null }).kind).toBe(
      'connect',
    )
  })

  it('blocks a wallet that is not listed, including one whose quota is not on chain yet', () => {
    expect(actionFor(live([group(2, { active: true })])).label).toBe('Not on the whitelist for this phase')
  })

  it("reads the wallet's limit and a vault's limit", () => {
    expect(actionFor(live([group(0, { active: true })]), { view: wallet({ publicMinted: 2 }) }).label).toBe(
      'Wallet limit reached',
    )
    const vaulted = wallet({
      delegatedVaults: [{ vault: VAULT, groups: [{ groupId: 1, quota: 1, used: 1 }] }],
    })
    expect(actionFor(live([group(1, { active: true })]), { view: vaulted, vault: VAULT }).label).toBe(
      'Vault limit reached',
    )
  })

  it('reads a phase sold out when it is chosen, the collection sold out and the switch to the chain', () => {
    const soldOutPhase = live([
      group(0, { active: true, minted: 10, maxSupply: 10 }),
      group(1, { active: true }),
    ])
    const [chosen] = derivePhases(soldOutPhase, wallet(), NOW)
    expect(chosen?.status).toBe('soldout')
    expect(
      deriveAction({
        page,
        live: soldOutPhase,
        phase: chosen ?? null,
        connected: true,
        walletRead: true,
        wrongChain: false,
        quantity: 1,
        vault: null,
        soldOut: false,
      }).label,
    ).toBe('Phase sold out')
    expect(actionFor(live([group(0, { active: true })], { supply: { max: 20, minted: 20 } })).label).toBe(
      'Sold out',
    )
    expect(actionFor(live([group(0, { active: true })]), { wrongChain: true })).toEqual({
      kind: 'switch',
      label: 'Switch to Anvil',
    })
  })
})

describe('local mints', () => {
  const mint = (overrides: Partial<LocalMint> = {}): LocalMint => ({
    groupId: 0,
    holder: WALLET,
    count: 1,
    block: 105,
    ...overrides,
  })

  it('count toward supply while the state is older than the receipt, and not once it has read it', () => {
    const before = live([group(0, { active: true })], { block: 104 })
    expect(totalMinted(before, [mint()])).toBe(1)
    expect(derivePhases(before, null, NOW, [mint()])[0]?.remainingSupply).toBe(9)
    const after = live([group(0, { active: true, minted: 1 })], {
      block: 105,
      supply: { max: 20, minted: 1 },
    })
    expect(totalMinted(after, [mint()])).toBe(1)
    expect(derivePhases(after, null, NOW, [mint()])[0]?.remainingSupply).toBe(9)
  })

  it("count toward the wallet's allowance while its answer is older than the receipt, never twice", () => {
    const state = live([group(0, { active: true })])
    const older = derivePhases(state, wallet({ block: 104 }), NOW, [mint()])[0]
    expect(older?.wallet).toMatchObject({ used: 1, remaining: 1 })
    const newer = derivePhases(state, wallet({ block: 105, publicMinted: 1 }), NOW, [mint()])[0]
    expect(newer?.wallet).toMatchObject({ used: 1, remaining: 1 })
  })

  it("count a vault's mint toward the vault's allowance, not the wallet's (Review Focus 4)", () => {
    const view = wallet({
      block: 100,
      delegatedVaults: [{ vault: VAULT, groups: [{ groupId: 1, quota: 3, used: 0 }] }],
    })
    const [phase] = derivePhases(live([group(1, { active: true })]), view, NOW, [
      mint({ groupId: 1, holder: VAULT, count: 2 }),
    ])
    expect(phase?.vaults[0]).toMatchObject({ vault: VAULT, used: 2, remaining: 1 })
    expect(phase?.wallet).toMatchObject({ used: 0, remaining: 2 })
  })
})

describe('the phases', () => {
  it('offer vaults on whitelist phases only, and leave hidden phases off', () => {
    const view = wallet({ delegatedVaults: [{ vault: VAULT, groups: [{ groupId: 1, quota: 3, used: 0 }] }] })
    const phases = derivePhases(
      live([group(0, { active: true }), group(1, { active: true }), group(3, { visible: false })]),
      view,
      NOW,
    )
    expect(phases.map((phase) => [phase.group.id, phase.vaults.length])).toEqual([
      [0, 0],
      [1, 1],
    ])
  })

  it("keep the join's order within each section: open now, coming up, finished", () => {
    const groups = [
      group(4, { scheduledStart: NOW + 500 }),
      group(1, { minted: 3 }),
      group(3, { active: true }),
      group(2, { scheduledStart: NOW + 100 }),
      group(0, { active: true }),
    ]
    const sorted = sortPhases(derivePhases(live(groups), null, NOW)).map((phase: Phase) => phase.group.id)
    expect(sorted).toEqual([3, 0, 4, 2, 1])
  })

  it('open the panel on the cheapest live phase the wallet can mint, else the next start', () => {
    const groups = [group(0, { active: true, priceWei: '5' }), group(1, { active: true, priceWei: '2' })]
    expect(defaultPhaseId(derivePhases(live(groups), wallet(), NOW))).toBe(1)
    const upcoming = [group(4, { scheduledStart: NOW + 500 }), group(2, { scheduledStart: NOW + 100 })]
    expect(defaultPhaseId(derivePhases(live(upcoming), null, NOW))).toBe(2)
  })
})
```

Create `apps/web/src/components/mint/sample-source.test.ts`:

```ts
import type { StateBody } from '@cobweb/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEMO_MINTER, DEMO_NOW } from '@/lib/demo'
import { mintCallOf } from '@/lib/mint/mint-call'
import type { MintPageStatic } from '@/lib/mint/page-doc'
import {
  sampleMintSource,
  sampleSwitchesOf,
  SAMPLE_PLACEHOLDER_URI,
  type SampleSwitches,
} from './sample-source'

const page = {
  slug: 'night-owls',
  chain: {
    id: 8453,
    name: 'Base',
    nativeSymbol: 'ETH',
    explorerUrl: 'https://basescan.org',
    transferLock: true,
  },
  contract: '0x4f2A9C7E1B3d5F6A8C0E2b4D6f8A1C3e5B7D9f0a',
} as unknown as MintPageStatic
const switches = (overrides: Partial<SampleSwitches> = {}): SampleSwitches => ({
  ...sampleSwitchesOf(new URLSearchParams()),
  ...overrides,
})

describe('sampleMintSource (docs/specs/2026-10-16-mint-page-live-data.md, section 8)', () => {
  let now = 0
  const clock = () => now
  beforeEach(() => {
    vi.useFakeTimers()
    now = 1_000_000
  })
  afterEach(() => vi.useRealTimers())

  /** The next state answer, its pauses run on the fake timers. */
  async function state(source: ReturnType<typeof sampleMintSource>): Promise<StateBody> {
    const answer = source.pollState()
    await vi.runAllTimersAsync()
    const poll = await answer
    if (poll.kind !== 'body') throw new Error(`no body: ${poll.kind}`)
    return poll.body
  }

  it('flips a scheduled group active 2 s after its start on its clock, which advances in real seconds', async () => {
    const source = sampleMintSource(page, switches({ variant: 'upcoming', start: 5 }), clock)
    const group = (body: StateBody) => body.groups.find((entry) => entry.startTimestamp === DEMO_NOW + 5)
    expect(group(await state(source))?.active).toBe(false)
    now += 6_000
    const atStart = await state(source)
    expect([atStart.blockTimestamp, group(atStart)?.active]).toEqual([DEMO_NOW + 6, false])
    now += 1_000
    expect(group(await state(source))?.active).toBe(true)
  })

  it('reads the placeholder before the reveal and counts a confirmed mint from its block on', async () => {
    const source = sampleMintSource(page, switches(), clock)
    const before = await state(source)
    expect(before.baseUri).toBe(SAMPLE_PLACEHOLDER_URI)
    const call = mintCallOf({
      contract: page.contract,
      chainId: page.chain.id,
      groupId: 1,
      amount: 1,
      vault: null,
      valueWei: 0n,
      account: DEMO_MINTER,
    })
    const sending = source.chain.simulate(call)
    await vi.runAllTimersAsync()
    const hashing = (await sending)()
    await vi.runAllTimersAsync()
    const receiving = source.chain.receipt(await hashing, page.chain.id)
    await vi.runAllTimersAsync()
    const receipt = await receiving
    expect(receipt.status).toBe('success')
    now += 2_000
    const after = await state(source)
    expect(after.totalMinted).toBe(before.totalMinted + 1)
    expect(after.groups.find((group) => group.id === 1)?.minted).toBe(
      (before.groups.find((group) => group.id === 1)?.minted ?? 0) + 1,
    )
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @cobweb/web exec vitest run src/components/mint/model.test.ts src/components/mint/sample-source.test.ts`
Expected: FAIL. `sample-source.test.ts` fails to load (`Cannot find module './sample-source'`), and the model's cases on the new live view fail on the old model: `Test Files  2 failed (2)` and `Tests  12 failed | 2 passed (14)`.

- [ ] **Step 3: The live source and the hooks**

Create `apps/web/src/lib/mint/live-source.ts`:

```ts
import type { Address } from 'viem'
import { pollState, pollWallet, type StatePoll, type WalletPoll } from './fresh-client'
import type { MintChain } from './mint-run'
import type { MintPageStatic } from './page-doc'
import { tokenArtOf, type TokenArt } from './token-art'

/**
 * Where the mint page reads and mints (docs/specs/2026-10-16-mint-page-live-data.md, decision 27): the state and
 * wallet polls, the chain the mint is checked, sent and confirmed on, and token art. The components see only
 * the source: the live one on the freshness server, wagmi and the IPFS gateway, or the sample one on `lib/demo`
 * (components/mint/sample-source.ts).
 */
export type MintSource = {
  pollState(): Promise<StatePoll>
  pollWallet(wallet: Address): Promise<WalletPoll>
  chain: MintChain
  tokenArt(baseUri: string, id: number): Promise<TokenArt | null>
}

/** The live source: polls the freshness server at `freshnessUrl`, mints through `chain`, reads art through the page's gateway. */
export function liveMintSource(
  page: MintPageStatic,
  deps: { freshnessUrl: string | undefined; chain: MintChain; fetchImpl?: typeof fetch },
): MintSource {
  const fetchImpl = deps.fetchImpl ?? fetch
  return {
    pollState: () => pollState(deps.freshnessUrl, page.chain.id, page.contract, fetchImpl),
    pollWallet: (wallet) => pollWallet(deps.freshnessUrl, page.chain.id, page.contract, wallet, fetchImpl),
    chain: deps.chain,
    tokenArt: (baseUri, id) => tokenArtOf(baseUri, id, page.gateway, fetchImpl),
  }
}
```

Create `apps/web/src/components/mint/use-live-state.ts`:

```ts
'use client'

import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  cadenceMs,
  chainNowOf,
  EMPTY_TRACK,
  foldState,
  NEXT_ANSWER_MAX_MS,
  OWN_DEGRADED_MS,
  ownDegraded,
  type FreshTrack,
} from '@/lib/mint/fresh-client'
import { liveOf, type MintLive } from '@/lib/mint/live-data'
import type { MintSource } from '@/lib/mint/live-source'
import type { MintPageStatic } from '@/lib/mint/page-doc'
import { derivePhases } from './model'

/**
 * The collection's state from the source (docs/specs/2026-10-16-mint-page-live-data.md, section 7.2): polled at
 * the cadence the answers and the phases set (1 s before the first answer and around a start, 3 s otherwise, the
 * retry's wait after a failure, none after a final refusal), not while the tab is hidden and at once on its
 * return, each answer folded into the track. The chain clock ticks each second from the last anchor.
 */
export function useLiveState(source: MintSource, page: MintPageStatic) {
  const trackRef = useRef<FreshTrack>(EMPTY_TRACK)
  const [track, setTrack] = useState<FreshTrack>(EMPTY_TRACK)
  /** Mints waiting for the next accepted answer. */
  const waiters = useRef<(() => void)[]>([])
  const [startedAt] = useState(() => performance.now())
  const [now, setNow] = useState<number | null>(null)

  const query = useQuery({
    queryKey: ['mint-state', page.chain.id, page.contract.toLowerCase()],
    queryFn: async () => {
      const poll = await source.pollState()
      const next = foldState(trackRef.current, poll, performance.now())
      trackRef.current = next
      setTrack(next)
      if (poll.kind === 'body' && next.body === poll.body)
        for (const resolve of waiters.current.splice(0)) resolve()
      return next
    },
    enabled: track.final === null,
    refetchInterval: () => {
      const current = trackRef.current
      const phases = current.body
        ? derivePhases(liveOf(page, current.body), null, chainNowOf(current, performance.now()))
        : []
      return cadenceMs(current, phases) ?? false
    },
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: false,
    structuralSharing: false,
    gcTime: 0,
  })
  const refetch = useRef(query.refetch)
  refetch.current = query.refetch

  useEffect(() => {
    const tick = () => setNow(performance.now())
    tick()
    const id = window.setInterval(tick, 1_000)
    return () => window.clearInterval(id)
  }, [])

  /** Polls at once, after a mint. */
  const refresh = useCallback(() => void refetch.current(), [])

  /** Resolves on the next accepted answer, or after 2 s; asks for it at once. */
  const nextAnswer = useCallback(
    () =>
      new Promise<void>((resolve) => {
        const done = () => {
          window.clearTimeout(timer)
          waiters.current = waiters.current.filter((waiter) => waiter !== done)
          resolve()
        }
        const timer = window.setTimeout(done, NEXT_ANSWER_MAX_MS)
        waiters.current.push(done)
        void refetch.current()
      }),
    [],
  )

  const live: MintLive | null = useMemo(
    () => (track.body ? liveOf(page, track.body) : null),
    [page, track.body],
  )
  const at = now === null ? null : Math.max(now, track.anchor?.at ?? now)
  return {
    track,
    live,
    /** The chain's time by the anchor, ticking each second; labels only. */
    chainNow: at === null ? null : chainNowOf(track, at),
    /** No answer was accepted for 10 s while a body is shown. */
    ownDegraded: at !== null && ownDegraded(track, at),
    /** Since when the page has had no accepted answer (`performance.now()`), for the banner's minutes. */
    lastGoodAt: track.lastGoodAt,
    /** No body yet after 10 s. */
    waitingLong: !track.body && now !== null && now - startedAt >= OWN_DEGRADED_MS,
    nextAnswer,
    refresh,
  }
}
```

Create `apps/web/src/components/mint/use-wallet-view.ts`:

```ts
'use client'

import { useQuery } from '@tanstack/react-query'
import { useCallback, useRef } from 'react'
import type { Address } from 'viem'
import { RETRY_MAX_MS } from '@/lib/mint/fresh-client'
import { walletViewOf, type WalletView } from '@/lib/mint/live-data'
import type { MintSource } from '@/lib/mint/live-source'
import type { MintPageStatic } from '@/lib/mint/page-doc'

/** A wallet answer to try again, after its `Retry-After`. */
class WalletRetry extends Error {
  constructor(readonly afterMs: number) {
    super('retry')
  }
}

/**
 * The connected wallet's answer (docs/specs/2026-10-16-mint-page-live-data.md, decision 14): read when a wallet
 * connects or changes account or chain, on return to the tab, when a phase turns live (`liveKey`), after each of
 * this wallet's mints and from "Check again" (`refresh`); never on a timer. A failed read is tried again after
 * its `Retry-After`, doubling up to 8 s, and the answer is kept meanwhile for the same wallet.
 */
export function useWalletView(
  source: MintSource,
  page: MintPageStatic,
  wallet: Address | null,
  liveKey: string,
): { view: WalletView | null; final: boolean; refresh(): void } {
  const holder = wallet?.toLowerCase() ?? null
  const query = useQuery({
    queryKey: ['mint-wallet', page.chain.id, page.contract.toLowerCase(), holder, liveKey],
    enabled: wallet !== null,
    queryFn: async (): Promise<WalletView | 'final'> => {
      const poll = await source.pollWallet(wallet!)
      if (poll.kind === 'retry') throw new WalletRetry(poll.afterMs)
      return poll.kind === 'body' ? walletViewOf(poll.body) : 'final'
    },
    retry: (_count, error) => error instanceof WalletRetry,
    retryDelay: (attempt, error) =>
      Math.min(RETRY_MAX_MS, (error instanceof WalletRetry ? error.afterMs : 1_000) * 2 ** attempt),
    // The last answer stays while the same wallet is read again; another wallet starts from nothing.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[3] === holder ? previous : undefined,
    refetchOnWindowFocus: true,
    staleTime: 0,
  })
  const refetch = useRef(query.refetch)
  refetch.current = query.refetch
  const refresh = useCallback(() => void refetch.current(), [])
  const data = wallet === null ? undefined : query.data
  return {
    view: data && data !== 'final' && data.address.toLowerCase() === holder ? data : null,
    final: data === 'final',
    refresh,
  }
}
```

Create `apps/web/src/components/mint/use-token-art.ts`:

```ts
'use client'

import { useQueries } from '@tanstack/react-query'
import type { MintSource } from '@/lib/mint/live-source'
import type { TokenArt } from '@/lib/mint/token-art'

/**
 * Token art for some ids at a base URI (docs/specs/2026-10-16-mint-page-live-data.md, section 7.2), each kept for
 * the page's life: IPFS content does not change. Undefined while a token is read; null when it cannot be.
 */
export function useTokenArt(
  source: MintSource,
  baseUri: string | null,
  ids: readonly number[],
): Map<number, TokenArt | null | undefined> {
  const results = useQueries({
    queries: ids.map((id) => ({
      queryKey: ['token-art', baseUri, id],
      queryFn: () => source.tokenArt(baseUri ?? '', id),
      enabled: baseUri !== null && baseUri !== '',
      staleTime: Infinity,
      gcTime: Infinity,
      retry: false,
    })),
  })
  return new Map(ids.map((id, index) => [id, results[index]?.data]))
}
```

- [ ] **Step 4: The model, the page's props, the flow and the context**

Replace the whole of `apps/web/src/components/mint/model.ts` with:

```ts
import { formatNative } from '@/lib/demo/helpers'
import type { Address, MintGroup } from '@/lib/demo/types'
import type { LocalMint, MintLive, WalletView } from '@/lib/mint/live-data'
import { quoteOf, type Quote } from '@/lib/mint/mint-call'
import type { MintPageStatic } from '@/lib/mint/page-doc'
import { formatCountdown } from './format'

/*
 * The mint page's rules, as pure functions of the chain's state (docs/specs/2026-10-16-mint-page-live-data.md,
 * section 7.4). Liveness is read from each group's `active` field (the contract's `mintGroupActive` view,
 * through the freshness server) and from nothing else. The chain clock passed in here only labels countdowns; it
 * never makes a phase live.
 */

export type PhaseStatus =
  /** The chain says the group is open. */
  | 'live'
  /** A start is scheduled and has not been reached. */
  | 'scheduled'
  /** The scheduled start has passed by our estimate, but the chain has not reported it live yet. */
  | 'starting'
  /** Every token of the group's allocation is minted. */
  | 'soldout'
  /** Not open and nothing scheduled, after minting happened. */
  | 'closed'
  /** Not open and nothing scheduled, and nothing minted: the creator has not opened it yet. */
  | 'unscheduled'

export type Allowance = { quota: number; used: number; remaining: number }

export type Phase = {
  group: MintGroup
  status: PhaseStatus
  remainingSupply: number
  /** Seconds until the scheduled start, by the chain clock. Null when nothing is scheduled or the clock is not set. */
  startsIn: number | null
  /** The connected wallet's own allowance in this phase; null until its answer arrives. */
  wallet: (Allowance & { eligible: boolean }) | null
  /** Allowances of vaults that delegated to this wallet, for this phase. */
  vaults: (Allowance & { vault: Address })[]
}

export type { Quote }

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

function allowance(quota: number, used: number, extra = 0): Allowance {
  const total = used + extra
  return { quota, used: total, remaining: Math.max(0, quota - total) }
}

/** Local mints the state has not read yet: those above its block. */
const unreadByState = (live: MintLive, local: readonly LocalMint[]) =>
  local.filter((mint) => mint.block > live.block)

/** Minted so far: the state's count and this page's mints it has not read yet. */
export function totalMinted(live: MintLive, local: readonly LocalMint[] = []): number {
  const extra = unreadByState(live, local).reduce((sum, mint) => sum + mint.count, 0)
  return Math.min(live.supply.max, live.supply.minted + extra)
}

/**
 * The phases the page shows, in the join's order: each visible group with its status, what is left, the
 * countdown and, once the wallet answered, what this wallet and its vaults can mint. A mint this page saw land
 * counts toward supply while the state is older than its receipt, and toward an allowance while the wallet
 * answer is, so it never counts twice.
 */
export function derivePhases(
  live: MintLive,
  wallet: WalletView | null,
  chainNow: number | null,
  local: readonly LocalMint[] = [],
): Phase[] {
  const collectionLeft = live.supply.max - totalMinted(live, local)
  const forState = unreadByState(live, local)
  const forWallet = wallet ? local.filter((mint) => mint.block > wallet.block) : []
  const usedBy = (groupId: number, holder: Address) =>
    forWallet
      .filter((mint) => mint.groupId === groupId && same(mint.holder, holder))
      .reduce((sum, mint) => sum + mint.count, 0)
  // A phase the creator hid (Phases, Edit details) is left off the page, as in legacy.
  return live.groups
    .filter((group) => group.visible !== false)
    .map((group) => {
      const localForGroup = forState
        .filter((mint) => mint.groupId === group.id)
        .reduce((sum, mint) => sum + mint.count, 0)
      const minted = group.minted + localForGroup
      const remainingSupply = Math.max(0, Math.min(group.maxSupply - minted, collectionLeft))
      const startsIn = group.scheduledStart > 0 && chainNow !== null ? group.scheduledStart - chainNow : null

      let status: PhaseStatus
      if (remainingSupply === 0 && (group.active || minted >= group.maxSupply || collectionLeft === 0)) {
        status = 'soldout'
      } else if (group.active) status = 'live'
      else if (group.scheduledStart > 0) status = startsIn === null || startsIn > 0 ? 'scheduled' : 'starting'
      else status = minted > 0 ? 'closed' : 'unscheduled'

      let walletAllowance: Phase['wallet'] = null
      const vaults: Phase['vaults'] = []
      if (wallet) {
        const own = usedBy(group.id, wallet.address)
        if (group.kind === 'public') {
          walletAllowance = {
            eligible: true,
            ...allowance(live.publicMaxMintPerWallet, wallet.publicMinted, own),
          }
        } else {
          const entry = wallet.groups.find((candidate) => candidate.groupId === group.id)
          const eligible = !!entry && entry.eligible && entry.quota > 0
          walletAllowance = { eligible, ...allowance(entry?.quota ?? 0, entry?.used ?? 0, own) }
          for (const delegated of wallet.delegatedVaults) {
            const vaultEntry = delegated.groups.find((candidate) => candidate.groupId === group.id)
            if (vaultEntry && vaultEntry.quota > 0) {
              vaults.push({
                vault: delegated.vault,
                ...allowance(vaultEntry.quota, vaultEntry.used, usedBy(group.id, delegated.vault)),
              })
            }
          }
        }
      }

      return { group, status, remainingSupply, startsIn, wallet: walletAllowance, vaults }
    })
}

/** Open now, Coming up and Finished, each in the join's order. */
const SECTION: Record<PhaseStatus, number> = {
  live: 0,
  starting: 1,
  scheduled: 1,
  unscheduled: 1,
  closed: 2,
  soldout: 2,
}

/** Live first, then what is coming, then what has finished, each section in the creator's order. */
export function sortPhases(phases: Phase[]): Phase[] {
  return [...phases].sort((a, b) => SECTION[a.status] - SECTION[b.status])
}

/** The phase the panel opens on: the cheapest live phase this wallet can mint from, else the next one to start. */
export function defaultPhaseId(phases: Phase[]): number | null {
  const live = phases.filter((phase) => phase.status === 'live')
  const mintable = live
    .filter((phase) => phase.wallet && (phase.wallet.eligible ? phase.wallet.remaining > 0 : false))
    .sort((a, b) => (BigInt(a.group.priceWei) < BigInt(b.group.priceWei) ? -1 : 1))
  if (mintable[0]) return mintable[0].group.id
  const eligibleLive = live.find((phase) => phase.wallet?.eligible)
  if (eligibleLive) return eligibleLive.group.id
  if (live[0]) return live[0].group.id
  const next = phases
    .filter((phase) => phase.status === 'starting' || phase.status === 'scheduled')
    .sort((a, b) => (a.startsIn ?? Infinity) - (b.startsIn ?? Infinity))[0]
  return next?.group.id ?? null
}

/** Price and fee for a quantity: the contract's `quoteBatchMint` at the state's fees. */
export function quote(live: Pick<MintLive, 'fees'>, priceWei: string, quantity: number): Quote {
  return quoteOf(live.fees, priceWei, quantity)
}

/** Who the tokens are minted against: the wallet itself or one of its delegated vaults. */
export function allowanceFor(phase: Phase, vault: Address | null): Allowance | null {
  if (vault) return phase.vaults.find((entry) => entry.vault === vault) ?? null
  return phase.wallet
}

export function maxQuantity(phase: Phase, vault: Address | null): number {
  const own = allowanceFor(phase, vault)
  return Math.max(0, Math.min(own?.remaining ?? 0, phase.remainingSupply))
}

export type MintAction =
  | { kind: 'connect'; label: string }
  | { kind: 'switch'; label: string }
  | { kind: 'mint'; label: string; quote: Quote }
  | { kind: 'blocked'; label: string }

export function deriveAction(input: {
  page: Pick<MintPageStatic, 'chain'>
  /** Null until the first state answer. */
  live: MintLive | null
  phase: Phase | null
  connected: boolean
  /** The connected wallet's answer has arrived. */
  walletRead: boolean
  wrongChain: boolean
  quantity: number
  vault: Address | null
  soldOut: boolean
}): MintAction {
  const { page, live, phase, connected, walletRead, wrongChain, quantity, vault, soldOut } = input
  if (!live) return { kind: 'blocked', label: 'Reading the chain' }
  if (soldOut) return { kind: 'blocked', label: 'Sold out' }
  if (!phase) return { kind: 'blocked', label: 'Minting is paused' }
  if (!connected) return { kind: 'connect', label: 'Connect wallet' }
  if (phase.status === 'scheduled') {
    return { kind: 'blocked', label: `Starts in ${formatCountdown(phase.startsIn ?? 0)}` }
  }
  if (phase.status === 'starting') return { kind: 'blocked', label: 'Starting, waiting for the chain' }
  if (phase.status === 'soldout') return { kind: 'blocked', label: 'Phase sold out' }
  if (phase.status !== 'live') return { kind: 'blocked', label: 'Phase closed' }
  if (!walletRead) return { kind: 'blocked', label: 'Checking this wallet' }
  if (!vault && phase.group.kind === 'whitelist' && !phase.wallet?.eligible) {
    return { kind: 'blocked', label: 'Not on the whitelist for this phase' }
  }
  if (maxQuantity(phase, vault) === 0) {
    return { kind: 'blocked', label: vault ? 'Vault limit reached' : 'Wallet limit reached' }
  }
  if (wrongChain) return { kind: 'switch', label: `Switch to ${page.chain.name}` }
  const q = quote(live, phase.group.priceWei, quantity)
  return {
    kind: 'mint',
    label: `Mint ${quantity} for ${formatNative(q.totalWei, page.chain.nativeSymbol)}`,
    quote: q,
  }
}
```

Replace the whole of `apps/web/src/components/mint/types.ts` with:

```ts
import type { MintPageStatic } from '@/lib/mint/page-doc'
import type { SampleSwitches } from './sample-source'

/**
 * What the public mint page renders (docs/specs/2026-10-16-mint-page-live-data.md, decision 27): the page's
 * content, read on the server, and in sample mode the query switches, from which the browser builds the sample
 * source. The chain's state is never in the HTML: the browser's first poll brings it.
 */
export type MintPageProps = {
  page: MintPageStatic
  /** Sample mode's switches; null on live data. */
  sample: SampleSwitches | null
}
```

Replace the whole of `apps/web/src/components/mint/use-mint-flow.ts` with:

```ts
'use client'

import { useCallback, useRef, useState } from 'react'
import type { Hex } from 'viem'
import type { MintParams } from '@/lib/mint/mint-call'
import { MintFailure, mintFailureOf, type MintStep } from '@/lib/mint/mint-failure'
import { runMint, type MintChain, type MintResult } from '@/lib/mint/mint-run'

export type FlowStep = MintStep

export type FlowState =
  | { step: 'idle' }
  | { step: FlowStep; params: MintParams; hash?: Hex }
  | { step: 'success'; params: MintParams; hash: Hex; tokenIds: number[] }
  | { step: 'error'; params: MintParams; failedAt: FlowStep; failure: MintFailure; hash?: Hex }

/**
 * The mint, step by step, on `runMint` (docs/specs/2026-10-16-mint-page-live-data.md, section 7.5): the check,
 * the wallet with the simulated request, then the chain. A closed flow stops following its mint; a transaction
 * already sent keeps going on chain.
 */
export function useMintFlow(options: {
  chain: MintChain
  live: { isLive(groupId: number): boolean; nextAnswer(): Promise<void> }
  onMinted: (params: MintParams, result: MintResult) => void
}) {
  const [state, setState] = useState<FlowState>({ step: 'idle' })
  const run = useRef(0)
  const { chain, live, onMinted } = options

  const start = useCallback(
    async (params: MintParams) => {
      const id = ++run.current
      const alive = () => run.current === id
      let at: FlowStep = 'checking'
      let hash: Hex | undefined
      setState({ step: 'checking', params })
      try {
        const result = await runMint(chain, params, live, {
          wallet: () => {
            at = 'wallet'
            if (alive()) setState({ step: 'wallet', params })
          },
          sent: (sent) => {
            at = 'confirming'
            hash = sent
            if (alive()) setState({ step: 'confirming', params, hash: sent })
          },
        })
        onMinted(params, result)
        if (alive()) setState({ step: 'success', params, hash: result.hash, tokenIds: result.tokenIds })
      } catch (error) {
        const failure = error instanceof MintFailure ? error : mintFailureOf(error, at, hash)
        if (alive())
          setState({ step: 'error', params, failedAt: at, failure, hash: failure.detail.hash ?? hash })
      }
    },
    [chain, live, onMinted],
  )

  /** Closes the flow. A transaction already sent keeps going on chain; only the view stops. */
  const reset = useCallback(() => {
    run.current += 1
    setState({ step: 'idle' })
  }, [])

  return { state, start, reset }
}
```

Replace the whole of `apps/web/src/components/mint/mint-context.tsx` with:

```tsx
'use client'

import { useConnectModal } from '@rainbow-me/rainbowkit'
import { createContext, use, useCallback, useMemo, useRef, useState } from 'react'
import type { Address } from 'viem'
import { useAccount, useConfig, useSwitchChain } from 'wagmi'
import { DEMO_MINTER } from '@/lib/demo'
import type { FreshTrack } from '@/lib/mint/fresh-client'
import type { LocalMint, MintLive, WalletView } from '@/lib/mint/live-data'
import { liveMintSource, type MintSource } from '@/lib/mint/live-source'
import type { MintParams } from '@/lib/mint/mint-call'
import type { MintResult } from '@/lib/mint/mint-run'
import type { MintPageStatic } from '@/lib/mint/page-doc'
import { wagmiMintChain } from '@/lib/mint/wagmi-chain'
import {
  defaultPhaseId,
  deriveAction,
  derivePhases,
  maxQuantity,
  totalMinted,
  type MintAction,
  type Phase,
} from './model'
import { sampleMintSource } from './sample-source'
import type { MintPageProps } from './types'
import { useLiveState } from './use-live-state'
import { useMintFlow, type FlowState } from './use-mint-flow'
import { useWalletView } from './use-wallet-view'

type MintContextValue = {
  page: MintPageStatic
  source: MintSource
  /** The chain's state; null until the first answer. */
  live: MintLive | null
  track: FreshTrack
  chainNow: number | null
  /** Whole minutes since the chain was last read, when the page reads degraded; null when it does not. */
  degradedMinutes: number | null
  degraded: boolean
  /** No answer yet after 10 s. */
  waitingLong: boolean
  /** The connected wallet (or the sample's), whatever its answer. */
  walletAddress: Address | null
  /** The wallet's answer: its quotas and vaults. */
  wallet: WalletView | null
  /** Asks for the wallet's answer again ("Check again"). */
  checkWallet: () => void
  /** The wallet is a sample stand-in, not a real connection. */
  sampleWallet: boolean
  wrongChain: boolean
  switching: boolean
  phases: Phase[]
  phase: Phase | null
  selectPhase: (groupId: number) => void
  quantity: number
  setQuantity: (quantity: number) => void
  maxQuantity: number
  vault: Address | null
  setVault: (vault: Address | null) => void
  minted: number
  soldOut: boolean
  action: MintAction
  /** Runs the primary action: connect, switch chain, or start the mint. */
  act: () => void
  flow: FlowState
  closeFlow: () => void
}

const MintContext = createContext<MintContextValue | null>(null)

export function useMint(): MintContextValue {
  const value = use(MintContext)
  if (!value) throw new Error('useMint must be used inside MintProvider')
  return value
}

/** Whole minutes from a moment, by the browser's clock: labels only. */
const minutesSince = (fromMs: number, nowMs: number) => Math.max(0, Math.floor((nowMs - fromMs) / 60_000))

export function MintProvider({ page, sample, children }: MintPageProps & { children: React.ReactNode }) {
  const config = useConfig()
  const source = useMemo<MintSource>(
    () =>
      sample
        ? sampleMintSource(page, sample)
        : liveMintSource(page, {
            freshnessUrl: process.env.NEXT_PUBLIC_FRESHNESS_URL,
            chain: wagmiMintChain(config),
          }),
    [page, sample, config],
  )
  const state = useLiveState(source, page)
  const { live, track } = state
  const account = useAccount()
  const { switchChain, isPending: switchingReal } = useSwitchChain()
  const { openConnectModal } = useConnectModal()

  // The wallet: a forced sample wallet, or the real connected one.
  const forced = sample?.wallet ? DEMO_MINTER : null
  const [forcedWrongChain, setForcedWrongChain] = useState(sample?.wallet === 'wrong-chain')
  const [forcedSwitching, setForcedSwitching] = useState(false)
  const real = account.isConnected && account.address ? account.address : null
  const walletAddress = forced ?? real
  const wrongChain = forced ? forcedWrongChain : !!real && account.chainId !== page.chain.id
  // A phase turning live asks for the wallet's answer again; a change of account or chain does too.
  const liveKey = `${account.chainId ?? 0}:${
    live?.groups
      .filter((group) => group.active)
      .map((group) => group.id)
      .join(',') ?? ''
  }`
  const walletState = useWalletView(source, page, walletAddress, liveKey)

  const [local, setLocal] = useState<LocalMint[]>([])
  const minted = live ? totalMinted(live, local) : 0
  const soldOut = !!live && minted >= live.supply.max
  const phases = useMemo(
    () => (live ? derivePhases(live, walletState.view, state.chainNow, local) : []),
    [live, walletState.view, state.chainNow, local],
  )

  const [chosenPhase, setChosenPhase] = useState<number | null>(null)
  const phaseId = phases.some((entry) => entry.group.id === chosenPhase)
    ? chosenPhase
    : defaultPhaseId(phases)
  const phase = phases.find((entry) => entry.group.id === phaseId) ?? null

  const [chosenVault, setChosenVault] = useState<Address | null>(null)
  const vault =
    phase?.status === 'live' && phase.vaults.some((entry) => entry.vault === chosenVault) ? chosenVault : null
  const max = phase ? maxQuantity(phase, vault) : 0
  const [rawQuantity, setRawQuantity] = useState(1)
  const quantity = Math.max(1, Math.min(rawQuantity, Math.max(1, max)))

  const action = deriveAction({
    page,
    live,
    phase,
    connected: !!walletAddress,
    walletRead: walletState.view !== null,
    wrongChain,
    quantity,
    vault,
    soldOut,
  })

  // The mint reads the latest state through refs, so a check that waits for the next answer sees it.
  const liveRef = useRef(live)
  liveRef.current = live
  const { nextAnswer, refresh } = state
  const flowLive = useMemo(
    () => ({
      isLive: (groupId: number) =>
        !!liveRef.current?.groups.some((group) => group.id === groupId && group.active),
      nextAnswer,
    }),
    [nextAnswer],
  )
  const refreshWallet = walletState.refresh
  const onMinted = useCallback(
    (params: MintParams, result: MintResult) => {
      setLocal((current) => [
        ...current,
        {
          groupId: params.groupId,
          holder: params.vault ?? params.account,
          count: result.tokenIds.length || params.amount,
          block: result.block,
        },
      ])
      setRawQuantity(1)
      refreshWallet()
      refresh()
    },
    [refreshWallet, refresh],
  )
  const flowApi = useMintFlow({ chain: source.chain, live: flowLive, onMinted })

  const act = () => {
    if (action.kind === 'connect') return openConnectModal?.()
    if (action.kind === 'switch') {
      if (forced) {
        setForcedSwitching(true)
        window.setTimeout(() => {
          setForcedWrongChain(false)
          setForcedSwitching(false)
        }, 900)
        return
      }
      return switchChain({ chainId: page.chain.id })
    }
    if (action.kind !== 'mint' || !phase || !walletAddress) return
    void flowApi.start({
      contract: page.contract,
      chainId: page.chain.id,
      groupId: phase.group.id,
      amount: quantity,
      vault,
      valueWei: action.quote.totalWei,
      account: walletAddress,
    })
  }

  const degraded = !!live && (live.degraded || state.ownDegraded)
  const nowMs = Date.now()
  const degradedMinutes = !degraded
    ? null
    : live?.degraded
      ? minutesSince(live.readAt * 1_000, nowMs)
      : state.lastGoodAt === null
        ? 0
        : minutesSince(state.lastGoodAt, performance.now())

  const value: MintContextValue = {
    page,
    source,
    live,
    track,
    chainNow: state.chainNow,
    degraded,
    degradedMinutes,
    waitingLong: state.waitingLong,
    walletAddress,
    wallet: walletState.view,
    checkWallet: walletState.refresh,
    sampleWallet: !!forced,
    wrongChain,
    switching: forced ? forcedSwitching : switchingReal,
    phases,
    phase,
    selectPhase: (groupId) => {
      setChosenPhase(groupId)
      setChosenVault(null)
    },
    quantity,
    setQuantity: setRawQuantity,
    maxQuantity: max,
    vault,
    setVault: setChosenVault,
    minted,
    soldOut,
    action,
    act,
    flow: flowApi.state,
    closeFlow: flowApi.reset,
  }

  return <MintContext value={value}>{children}</MintContext>
}
```

- [ ] **Step 5: The sample source and its page**

The sample reads its switches in the browser, so the route stays cached by link (Decision 2).

Create `apps/web/src/components/mint/sample-source.ts`:

```ts
import { DEFAULT_TRANSFER_VALIDATOR, type QuotaBody, type StateBody, type WalletBody } from '@cobweb/shared'
import { collectionAbi } from '@cobweb/shared/collection-abi'
import {
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  encodeErrorResult,
  encodeEventTopics,
  UserRejectedRequestError,
  zeroAddress,
  type Address,
  type Hex,
  type TransactionReceipt,
} from 'viem'
import {
  DEMO_CREATOR,
  DEMO_DEPLOYMENT,
  DEMO_NOW,
  DEMO_PLACEHOLDER,
  DEMO_RENDER_JOBS,
  DEMO_TOKENS,
  getMintPageData,
  MINT_PAGE_VARIANTS,
  sampleTxHash,
  tokenLayerUrls,
  type MintGroup,
  type MintPageVariant,
  type WalletState,
} from '@/lib/demo'
import type { MintSource } from '@/lib/mint/live-source'
import type { MintCall } from '@/lib/mint/mint-call'
import type { MintFailureKind } from '@/lib/mint/mint-failure'
import type { MintChain } from '@/lib/mint/mint-run'
import type { MintPageStatic } from '@/lib/mint/page-doc'

/**
 * The sample-mode source (docs/specs/2026-10-16-mint-page-live-data.md, section 8): the same answers the live
 * source gives, made from `lib/demo`, so every state of the page can be reviewed without a wallet, a server or a
 * chain. Its clock advances in real seconds from `DEMO_NOW`, and a scheduled group reads active 2 s after its
 * start on that clock, as the chain would report it. Its chain simulates the check, the wallet and the receipt
 * with realistic pauses, and the mints it confirms join its answers from their block on.
 */

/** How the sample's wallet is connected: `null` follows a real connection with the sample's allowances. */
export type SampleWalletMode = 'connected' | 'not-listed' | 'limit' | 'wrong-chain' | null

/**
 * The query switches of the sample page, read in the browser from its own location, so the page's route stays
 * cached by link (components/mint/sample-page.tsx):
 *
 *   ?state=upcoming | allowlist-live | public-live | sold-out | closed   (default allowlist-live)
 *   ?wallet=connected     a sample wallet, connected without a real wallet
 *   ?wallet=not-listed    connected, but on no whitelist and with no vaults
 *   ?wallet=limit         connected, every allowance used
 *   ?wallet=wrong-chain   connected on another network
 *   ?fail=rejected | phase-closed | quota-exceeded | insufficient-balance | reverted
 *                         the first mint attempt fails this way; "Try again" then succeeds
 *   ?degraded=1           the freshness server could not read the chain recently
 *   ?start=<seconds>      move the next scheduled start this close, to watch a countdown reach zero
 */
export type SampleSwitches = {
  variant: MintPageVariant
  wallet: SampleWalletMode
  degraded: boolean
  /** Moves the next scheduled start this many seconds after the sample's now. */
  start: number | null
  /** The first mint attempt fails this way; "Try again" then succeeds. */
  fail: MintFailureKind | null
}

const FAILURES: MintFailureKind[] = [
  'rejected',
  'phase-closed',
  'quota-exceeded',
  'insufficient-balance',
  'reverted',
]
const WALLETS: Exclude<SampleWalletMode, null>[] = ['connected', 'not-listed', 'limit', 'wrong-chain']

/** The switches a query names; anything it does not name keeps its default. */
export function sampleSwitchesOf(query: URLSearchParams): SampleSwitches {
  const start = Number(query.get('start'))
  return {
    variant: MINT_PAGE_VARIANTS.find((variant) => variant === query.get('state')) ?? 'allowlist-live',
    wallet: WALLETS.find((mode) => mode === query.get('wallet')) ?? null,
    degraded: query.get('degraded') === '1',
    start: Number.isFinite(start) && start > 0 ? start : null,
    fail: FAILURES.find((kind) => kind === query.get('fail')) ?? null,
  }
}

/** The base URI before the reveal (the placeholder's one file) and after it (the rendered set). */
export const SAMPLE_PLACEHOLDER_URI = DEMO_DEPLOYMENT.baseUri
export const SAMPLE_REVEALED_URI = DEMO_RENDER_JOBS.done.baseUri

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** A simulation's revert as viem throws it, so the page reads it as the live one would. */
function revert(errorName: string, args: readonly unknown[], call: MintCall): ContractFunctionExecutionError {
  const data = encodeErrorResult({ abi: collectionAbi, errorName, args } as Parameters<
    typeof encodeErrorResult
  >[0])
  return new ContractFunctionExecutionError(
    new ContractFunctionRevertedError({ abi: collectionAbi, data, functionName: call.functionName }),
    { abi: collectionAbi, functionName: call.functionName, args: call.args, contractAddress: call.address },
  )
}

/** Where a sample failure strikes: the check, the wallet or the receipt, and the error it throws there. */
function sampleFailure(
  kind: MintFailureKind,
  call: MintCall,
): { at: 'check' | 'wallet' | 'receipt'; error: Error | null } {
  const [amount, group] = call.args
  switch (kind) {
    case 'phase-closed':
      return { at: 'check', error: revert('MintGroupInactive', [group], call) }
    case 'quota-exceeded':
      return { at: 'check', error: revert('ExceedsMintQuota', [amount, 1n], call) }
    case 'insufficient-balance':
      return { at: 'check', error: new Error('insufficient funds for gas * price + value') }
    case 'rejected':
      return { at: 'wallet', error: new UserRejectedRequestError(new Error('User rejected the request.')) }
    default:
      return { at: 'receipt', error: null }
  }
}

/** The sample's wallet answer for any address: the sample minter's allowances, shaped by the wallet switch. */
function quotasOf(
  state: WalletState,
  mode: SampleWalletMode,
  publicMax: number,
): Omit<WalletBody, 'chainId' | 'address' | 'wallet' | 'block'> {
  const notListed = mode === 'not-listed'
  const limit = mode === 'limit'
  const groups: QuotaBody[] = state.groups.map((entry) => {
    const quota = entry.groupId === 0 || notListed ? 0 : entry.quota
    return { id: entry.groupId, quota, claimed: limit ? quota : Math.min(entry.used, quota) }
  })
  return {
    publicMinted: limit ? publicMax : state.publicMinted,
    groups,
    vaults: notListed
      ? []
      : state.delegatedVaults.map((vault) => ({
          vault: vault.vault,
          publicMinted: 0,
          groups: groups.map((entry) => {
            const own = vault.groups.find((candidate) => candidate.groupId === entry.id)
            const quota = own?.quota ?? 0
            return { id: entry.id, quota, claimed: limit ? quota : (own?.used ?? 0) }
          }),
        })),
  }
}

/** The sample source for a page. `now` is the wall clock, so the sample's chain time moves in real seconds. */
export function sampleMintSource(
  page: MintPageStatic,
  switches: SampleSwitches,
  now: () => number = Date.now,
): MintSource {
  const startedAt = now()
  const data = getMintPageData(page.slug, switches.variant)
  let groups: MintGroup[] = data.groups
  if (switches.start !== null) {
    const next = groups
      .filter((group) => !group.active && group.scheduledStart > DEMO_NOW)
      .sort((a, b) => a.scheduledStart - b.scheduledStart)[0]
    if (next)
      groups = groups.map((group) =>
        group.id === next.id
          ? { ...group, scheduledStart: DEMO_NOW + Math.floor(switches.start ?? 0) }
          : group,
      )
  }
  /** The mints the sample's chain confirmed, joining its answers from their block on. */
  const mints: { groupId: number; holder: Address; count: number; block: number }[] = []
  let nextTokenId = data.supply.minted + 1
  let failuresLeft = switches.fail === 'phase-closed' ? 2 : switches.fail ? 1 : 0
  let failNextReceipt = false
  let txSeed = 0
  /** The calls the sample's wallet sent, by hash, for their receipts. */
  const pending = new Map<Hex, MintCall>()

  const elapsed = () => Math.floor((now() - startedAt) / 1_000)
  const blockNow = () => 1_000 + elapsed()
  const landed = (block: number) => mints.filter((mint) => mint.block <= block)
  const mintedBy = (block: number, holder: Address, groupId: number) =>
    landed(block)
      .filter((mint) => mint.groupId === groupId && mint.holder.toLowerCase() === holder.toLowerCase())
      .reduce((sum, mint) => sum + mint.count, 0)

  const chain: MintChain = {
    simulate: async (call) => {
      await wait(900)
      const failure = switches.fail && failuresLeft > 0 ? sampleFailure(switches.fail, call) : null
      if (failure) failuresLeft -= 1
      if (failure?.at === 'check' && failure.error) throw failure.error
      if (failure?.at === 'receipt') failNextReceipt = true
      return async () => {
        await wait(1_600)
        if (failure?.at === 'wallet' && failure.error) throw failure.error
        txSeed += 1
        const hash = sampleTxHash(9_000 + txSeed)
        pending.set(hash, call)
        return hash
      }
    },
    receipt: async (hash) => {
      await wait(2_200)
      const call = pending.get(hash)
      const block = blockNow() + 1
      if (!call || failNextReceipt) {
        failNextReceipt = false
        return { status: 'reverted', blockNumber: BigInt(block), logs: [] } as unknown as TransactionReceipt
      }
      const [amount, group, vault] = call.args
      const count = Number(amount)
      mints.push({ groupId: Number(group), holder: vault ?? call.account, count, block })
      const logs = Array.from({ length: count }, (_, index) => ({
        address: call.address,
        data: '0x' as Hex,
        topics: encodeEventTopics({
          abi: collectionAbi,
          eventName: 'Transfer',
          args: { from: zeroAddress, to: call.account, tokenId: BigInt(nextTokenId + index) },
        }),
      }))
      nextTokenId += count
      return { status: 'success', blockNumber: BigInt(block), logs } as unknown as TransactionReceipt
    },
  }
  return {
    async pollState() {
      await wait(150)
      const seconds = elapsed()
      const block = 1_000 + seconds
      const blockTimestamp = DEMO_NOW + seconds
      const wall = Math.floor(now() / 1_000)
      const minted = landed(block).reduce((sum, mint) => sum + mint.count, 0)
      const body: StateBody = {
        chainId: page.chain.id,
        address: page.contract,
        block,
        blockTimestamp,
        readAt: switches.degraded ? wall - 4 * 60 : wall,
        degraded: switches.degraded,
        maxSupply: data.supply.max,
        totalMinted: Math.min(data.supply.max, data.supply.minted + minted),
        publicMaxMintPerWallet: data.publicMaxMintPerWallet,
        mintFeeFlatWei: data.fees.mintFeeFlatWei,
        mintFeeBps: data.fees.mintFeeBps,
        airdropFeePerTokenWei: data.fees.airdropFeePerTokenWei,
        mintOnBehalfActive: false,
        groups: groups.map((group) => ({
          id: group.id,
          priceWei: group.priceWei,
          maxSupply: group.maxSupply,
          minted:
            group.minted +
            landed(block)
              .filter((mint) => mint.groupId === group.id)
              .reduce((sum, mint) => sum + mint.count, 0),
          startTimestamp: group.scheduledStart,
          flag: group.flag,
          active: group.active || (group.scheduledStart > 0 && blockTimestamp >= group.scheduledStart + 2),
        })),
        owner: DEMO_CREATOR,
        royalty: { receiver: DEMO_DEPLOYMENT.royaltyReceiver, bps: DEMO_DEPLOYMENT.royaltyBps },
        baseUri: data.collection.revealed ? SAMPLE_REVEALED_URI : SAMPLE_PLACEHOLDER_URI,
        transferValidator: DEFAULT_TRANSFER_VALIDATOR,
        transferLevel: 0,
      }
      return { kind: 'body', body, ageSeconds: 0 }
    },

    async pollWallet(wallet) {
      await wait(300)
      const block = blockNow()
      const quotas = quotasOf(data.wallet!, switches.wallet, data.publicMaxMintPerWallet)
      return {
        kind: 'body',
        body: {
          chainId: page.chain.id,
          address: page.contract,
          wallet,
          block,
          publicMinted: quotas.publicMinted + mintedBy(block, wallet, 0),
          groups: quotas.groups.map((entry) => ({
            ...entry,
            claimed: entry.claimed + mintedBy(block, wallet, entry.id),
          })),
          vaults: quotas.vaults.map((vault) => ({
            ...vault,
            groups: vault.groups.map((entry) => ({
              ...entry,
              claimed: entry.claimed + mintedBy(block, vault.vault, entry.id),
            })),
          })),
        },
      }
    },

    chain,

    async tokenArt(baseUri, id) {
      if (baseUri === SAMPLE_PLACEHOLDER_URI) return { layers: [DEMO_PLACEHOLDER.imageUrl], video: false }
      const token = DEMO_TOKENS[id - 1]
      if (!token) return null
      return { layers: token.previewUrl ? [token.previewUrl] : tokenLayerUrls(token.dna), video: false }
    },
  }
}
```

Create `apps/web/src/components/mint/sample-page.tsx`:

```tsx
'use client'

import { useMemo, useSyncExternalStore } from 'react'
import type { MintPageStatic } from '@/lib/mint/page-doc'
import { MintPage } from './mint-page'
import { MintPageSkeleton } from './mint-page-skeleton'
import { sampleSwitchesOf } from './sample-source'

const subscribe = () => () => {}

/**
 * The sample page: its switches come from the browser's own location, read once it has hydrated, so the route
 * renders the same HTML for every query and stays cached by link. The page's skeleton shows until then.
 */
export function SampleMintPage({ page }: { page: MintPageStatic }) {
  const search = useSyncExternalStore(
    subscribe,
    () => window.location.search,
    () => null,
  )
  const switches = useMemo(
    () => (search === null ? null : sampleSwitchesOf(new URLSearchParams(search))),
    [search],
  )
  if (!switches) return <MintPageSkeleton />
  return <MintPage page={page} sample={switches} />
}
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `pnpm --filter @cobweb/web exec vitest run src/components/mint/model.test.ts src/components/mint/sample-source.test.ts`
Expected: PASS, `Test Files  2 passed (2)` and `Tests  16 passed (16)`.

- [ ] **Step 7: The components**

The featured tokens keep a wall of six's sizes on wide screens (Decision 12).

Replace the whole of `apps/web/src/components/mint/token-image.tsx` with:

```tsx
import { Artwork } from '@cobweb/ui/components/artwork'
import { cn } from '@cobweb/ui/lib/utils'
import type { TokenArt } from '@/lib/mint/token-art'

/**
 * A token drawn from its layer images, stacked bottom first. Every layer is square and the same size, so they
 * line up exactly. With one layer it is just the composite image; an MP4 plays muted in a loop.
 */
export function TokenImage({
  layers,
  alt,
  className,
  eager,
  video,
}: {
  layers: string[]
  alt: string
  className?: string
  eager?: boolean
  video?: boolean
}) {
  return (
    <div role="img" aria-label={alt} className={cn('relative isolate aspect-square bg-well', className)}>
      {video && layers[0] ? (
        <video
          src={layers[0]}
          aria-hidden="true"
          muted
          loop
          autoPlay
          playsInline
          preload="metadata"
          className="absolute inset-0 size-full object-cover"
        />
      ) : (
        layers.map((src, index) => (
          <img
            key={`${src}-${index}`}
            src={src}
            alt=""
            aria-hidden="true"
            draggable={false}
            loading={eager ? 'eager' : 'lazy'}
            decoding="async"
            className="absolute inset-0 size-full object-cover select-none"
          />
        ))
      )}
    </div>
  )
}

/**
 * A token's art from its metadata: the image (or the video) once read, the empty well while it is read, and the
 * artwork pattern with the token's number when it cannot be read.
 */
export function TokenArtFrame({
  art,
  id,
  alt,
  className,
  eager,
}: {
  art: TokenArt | null | undefined
  id: number
  alt: string
  className?: string
  eager?: boolean
}) {
  if (art === null)
    return <Artwork src={null} alt={alt} seed={`token-${id}`} label={`#${id}`} className={className} />
  return (
    <TokenImage layers={art?.layers ?? []} video={art?.video} alt={alt} className={className} eager={eager} />
  )
}
```

Replace the whole of `apps/web/src/components/mint/art-stage.tsx` with:

```tsx
'use client'

import { ChevronLeftIcon, ChevronRightIcon, PauseIcon, PlayIcon } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@cobweb/ui/components/button'
import { EASE_OUT } from '@cobweb/ui/lib/motion'
import { cn } from '@cobweb/ui/lib/utils'
import type { TokenArt } from '@/lib/mint/token-art'
import { useMint } from './mint-context'
import { TokenArtFrame } from './token-image'
import { useTokenArt } from './use-token-art'

/** One card of the stage: a token by its id, or an uploaded slide. */
type Card = { key: string; label: string; tokenId: number | null; art: TokenArt | null | undefined }

/** Where each card sits: the front one, two leaning behind it, the rest tucked away. */
const SLOTS = [
  { x: '0%', y: '0%', rotate: 0, scale: 1, opacity: 1, shade: 0 },
  { x: '15%', y: '-5%', rotate: 5, scale: 0.86, opacity: 1, shade: 0.45 },
  { x: '-14%', y: '-3%', rotate: -6, scale: 0.8, opacity: 1, shade: 0.6 },
]
const HIDDEN = { x: '0%', y: '-2%', rotate: 0, scale: 0.74, opacity: 0, shade: 0.7 }
const CYCLE_MS = 5600

/** The average colour of an image, sampled small. Used only for the faint light behind the art. */
async function ambientOf(src: string): Promise<string | null> {
  const img = new Image()
  img.src = src
  try {
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 12
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, 12, 12)
    const pixels = ctx.getImageData(0, 0, 12, 12).data
    let r = 0
    let g = 0
    let b = 0
    for (let i = 0; i < pixels.length; i += 4) {
      r += pixels[i]!
      g += pixels[i + 1]!
      b += pixels[i + 2]!
    }
    const n = pixels.length / 4
    return `${Math.round(r / n)} ${Math.round(g / n)} ${Math.round(b / n)}`
  } catch {
    return null
  }
}

/**
 * What the stage shows (docs/specs/2026-10-16-mint-page-live-data.md, section 7.7): the carousel's slides when it
 * is on (uploads always, token slides once revealed), else the featured tokens once revealed, else one card with
 * token 1's art at the state's base URI (the placeholder's image before the reveal, the one image of a single
 * asset), else the avatar until the state answers.
 */
function useCards(): Card[] {
  const { page, live, source } = useMint()
  const revealed = live?.revealed ?? false
  const carousel = page.sections.carousel
  const slides = useMemo(
    () => (carousel ?? []).filter((slide) => slide.kind === 'upload' || revealed),
    [carousel, revealed],
  )
  const tokenIds = useMemo(() => {
    if (!live) return []
    if (slides.length) return slides.flatMap((slide) => (slide.kind === 'token' ? [slide.tokenId] : []))
    if (revealed && page.featuredTokenIds.length) return page.featuredTokenIds
    return [1]
  }, [live, slides, revealed, page.featuredTokenIds])
  const art = useTokenArt(source, live?.baseUri ?? null, tokenIds)
  const tokenCard = (id: number): Card => ({
    key: `token-${id}`,
    label: `#${id}`,
    tokenId: id,
    art: art.get(id),
  })
  if (!live)
    return [
      {
        key: 'avatar',
        label: page.name,
        tokenId: null,
        art: page.avatarUrl ? { layers: [page.avatarUrl], video: false } : null,
      },
    ]
  if (slides.length)
    return slides.map((slide) =>
      slide.kind === 'token'
        ? tokenCard(slide.tokenId)
        : {
            key: slide.id,
            label: slide.fileName,
            tokenId: null,
            art: { layers: [slide.url], video: slide.mediaType === 'video' },
          },
    )
  return tokenIds.map(tokenCard)
}

/**
 * The hero artwork: the front card held up with two more leaning behind it. The stack turns over slowly so a
 * visitor sees a few tokens without doing anything; it pauses on hover or focus, has its own pause control, and
 * stays still with reduced motion. A faint light in the front image's own colour sits behind the stack.
 */
export function ArtStage() {
  const { page } = useMint()
  const featured = useCards()
  const collectionName = page.name
  const reduce = useReducedMotion()
  const [front, setFront] = useState(0)
  const [paused, setPaused] = useState(false)
  const [hovering, setHovering] = useState(false)
  const [ambient, setAmbient] = useState<Record<string, string>>({})
  const count = featured.length
  const current = featured[front]
  const autoplay = !reduce && !paused && !hovering && count > 1

  useEffect(() => {
    if (!autoplay) return
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') setFront((value) => (value + 1) % count)
    }, CYCLE_MS)
    return () => window.clearInterval(id)
  }, [autoplay, count])

  const frontImage = current?.art && !current.art.video ? (current.art.layers.at(-1) ?? null) : null
  useEffect(() => {
    if (!frontImage || ambient[frontImage]) return
    let cancelled = false
    void ambientOf(frontImage).then((rgb) => {
      if (!cancelled && rgb) setAmbient((map) => ({ ...map, [frontImage]: rgb }))
    })
    return () => {
      cancelled = true
    }
  }, [frontImage, ambient])

  if (!current) return null
  const glow = frontImage ? ambient[frontImage] : undefined
  const move = (step: number) => setFront((value) => (value + step + count) % count)

  return (
    <section
      aria-roledescription="carousel"
      aria-label={`${collectionName} art`}
      className="relative"
      onPointerEnter={() => setHovering(true)}
      onPointerLeave={() => setHovering(false)}
      onFocus={() => setHovering(true)}
      onBlur={() => setHovering(false)}
    >
      {/* The light behind the art, in the front token's own colour. */}
      <AnimatePresence initial={false}>
        {glow && (
          <motion.div
            key={glow}
            aria-hidden="true"
            className="pointer-events-none absolute -inset-[18%] -z-10"
            style={{
              background: `radial-gradient(50% 46% at 50% 48%, rgb(${glow} / 0.34), rgb(${glow} / 0.08) 55%, transparent 75%)`,
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 1.2, ease: EASE_OUT }}
          />
        )}
      </AnimatePresence>

      <div className="relative mx-auto aspect-square w-[84%] max-w-[34rem] sm:w-[76%] lg:w-[82%]">
        {featured.map((token, index) => {
          const position = (index - front + count) % count
          const slot = SLOTS[position] ?? HIDDEN
          return (
            <motion.div
              key={token.key}
              aria-hidden={position !== 0}
              className="absolute inset-0 origin-bottom overflow-hidden rounded-xl border border-border-strong bg-well shadow-overlay"
              style={{ zIndex: SLOTS.length - Math.min(position, SLOTS.length) }}
              initial={false}
              animate={{
                x: slot.x,
                y: slot.y,
                rotate: slot.rotate,
                scale: slot.scale,
                opacity: slot.opacity,
              }}
              transition={{ duration: reduce ? 0 : 0.9, ease: EASE_OUT }}
            >
              <TokenArtFrame
                art={token.art}
                id={token.tokenId ?? 0}
                alt={`${collectionName} ${token.label}`}
                eager={index < 3}
                className="size-full"
              />
              <motion.span
                aria-hidden="true"
                className="absolute inset-0 bg-background"
                initial={false}
                animate={{ opacity: slot.shade }}
                transition={{ duration: reduce ? 0 : 0.9, ease: EASE_OUT }}
              />
            </motion.div>
          )
        })}
      </div>

      <div className="mx-auto mt-6 flex w-[84%] max-w-[34rem] items-center justify-between gap-4 sm:w-[76%] lg:w-[82%]">
        <p className="min-w-0 truncate text-sm text-muted-foreground" aria-live="polite">
          <span className="font-medium text-foreground">{collectionName}</span>{' '}
          <span className="numeric">{current.label}</span>
        </p>
        <div className={cn('flex shrink-0 items-center gap-1', count < 2 && 'invisible')}>
          <Button variant="ghost" size="icon-sm" aria-label="Previous token" onClick={() => move(-1)}>
            <ChevronLeftIcon />
          </Button>
          {!reduce && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={paused ? 'Play the slideshow' : 'Pause the slideshow'}
              aria-pressed={paused}
              onClick={() => setPaused((value) => !value)}
            >
              {paused ? <PlayIcon /> : <PauseIcon />}
            </Button>
          )}
          <Button variant="ghost" size="icon-sm" aria-label="Next token" onClick={() => move(1)}>
            <ChevronRightIcon />
          </Button>
        </div>
      </div>

      <div
        className={cn('mx-auto mt-4 hidden w-[82%] max-w-[34rem] gap-2', count > 1 && 'lg:flex')}
        role="group"
        aria-label="Choose a token"
      >
        {featured.map((token, index) => (
          <button
            key={token.key}
            type="button"
            aria-label={`Show ${collectionName} ${token.label}`}
            aria-current={index === front}
            onClick={() => setFront(index)}
            className={cn(
              'relative aspect-square w-12 cursor-pointer overflow-hidden rounded-md border outline-none transition-[opacity,border-color,transform] duration-150 focus-visible:ring-2 focus-visible:ring-ring active:translate-y-px',
              index === front ? 'border-foreground/60' : 'border-border opacity-55 hover:opacity-90',
            )}
          >
            <TokenArtFrame art={token.art} id={token.tokenId ?? 0} alt="" className="size-full" />
          </button>
        ))}
      </div>
    </section>
  )
}
```

Replace the whole of `apps/web/src/components/mint/collection-sections.tsx` with:

```tsx
'use client'

import { ExternalLinkIcon, GlobeIcon, MessageCircleIcon, AtSignIcon, SendIcon } from 'lucide-react'
import { Button } from '@cobweb/ui/components/button'
import { Skeleton } from '@cobweb/ui/components/skeleton'
import { cn } from '@cobweb/ui/lib/utils'
import { explorerAddressUrl, formatBps, shortAddress } from '@/lib/demo/helpers'
import type { MintLive } from '@/lib/mint/live-data'
import type { MintPageStatic } from '@/lib/mint/page-doc'
import { ChainName } from '@/components/chains/chain-icon'
import { LogoMark } from '@/components/shell/logo'
import { CopyButton } from './copy-button'
import { useMint } from './mint-context'
import { TokenArtFrame } from './token-image'
import { useTokenArt } from './use-token-art'

/*
 * A salon hang: the featured tokens at different sizes and heights, like a wall in a small
 * gallery, rather than a row of equal cards. On phones the wall becomes a strip you swipe. On wide
 * screens each card takes its share of a wall of six (24, 14, 19, 13, 20 and 15 parts of the row,
 * less the five gaps), so a page that features fewer keeps the same sizes instead of stretching them.
 */
const HANG = [
  { size: 'w-[64vw] sm:w-[40vw] lg:w-[calc((100%_-_6.25rem)*24/105)]', align: 'self-start' },
  { size: 'w-[46vw] sm:w-[28vw] lg:w-[calc((100%_-_6.25rem)*14/105)]', align: 'self-end' },
  { size: 'w-[56vw] sm:w-[34vw] lg:w-[calc((100%_-_6.25rem)*19/105)]', align: 'self-center' },
  { size: 'w-[42vw] sm:w-[26vw] lg:w-[calc((100%_-_6.25rem)*13/105)]', align: 'self-start lg:mt-10' },
  { size: 'w-[60vw] sm:w-[36vw] lg:w-[calc((100%_-_6.25rem)*20/105)]', align: 'self-end' },
  { size: 'w-[46vw] sm:w-[28vw] lg:w-[calc((100%_-_6.25rem)*15/105)]', align: 'self-center lg:-mt-6' },
]

/** "From the collection": the featured tokens once revealed; hidden before the reveal and for a single asset. */
export function Gallery() {
  const { page, live, source } = useMint()
  const shown = !!live?.revealed && page.projectType !== 'single_asset'
  const featured = shown ? page.featuredTokenIds : []
  const art = useTokenArt(source, live?.baseUri ?? null, featured)
  if (featured.length === 0) return null
  return (
    <section id="gallery" aria-labelledby="gallery-title" className="scroll-mt-8">
      <h2 id="gallery-title" className="text-title px-4 sm:px-8">
        From the collection
      </h2>
      <ul className="scrollbar-hide mt-8 flex snap-x snap-mandatory scroll-px-4 items-start sm:scroll-px-8 gap-4 overflow-x-auto px-4 pb-4 sm:gap-5 sm:px-8 lg:min-h-[26rem] lg:snap-none lg:overflow-visible">
        {featured.map((id, index) => {
          const hang = HANG[index % HANG.length]!
          return (
            <li key={id} className={cn('shrink-0 snap-start', hang.size, hang.align)}>
              <figure className="group">
                <div className="overflow-hidden rounded-xl border border-border-strong shadow-raised transition-[transform,box-shadow] duration-300 ease-out-expo group-hover:-translate-y-1 group-hover:shadow-lifted">
                  <TokenArtFrame
                    art={art.get(id)}
                    id={id}
                    alt={`${page.name} #${id}`}
                    className="transition-transform duration-500 ease-out-expo group-hover:scale-[1.03]"
                  />
                </div>
                <figcaption className="mt-2.5 flex items-baseline justify-between gap-2 text-[0.8125rem]">
                  <span className="truncate text-muted-foreground">{page.name}</span>
                  <span className="numeric text-foreground">#{id}</span>
                </figcaption>
              </figure>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

const SOCIALS = [
  { key: 'website', label: 'Website', Icon: GlobeIcon },
  { key: 'x', label: 'X', Icon: AtSignIcon },
  { key: 'discord', label: 'Discord', Icon: MessageCircleIcon },
  { key: 'telegram', label: 'Telegram', Icon: SendIcon },
] as const

/** The collection's story: the About banner (else the banner), the description as plain text, and its links. */
export function About({ page }: { page: MintPageStatic }) {
  const socials = SOCIALS.filter((entry) => page.socials[entry.key]?.startsWith('https://'))
  const banner = page.aboutBannerUrl ?? page.bannerUrl
  return (
    <section aria-labelledby="about-title">
      {banner && (
        <div className="mb-8 overflow-hidden rounded-xl border border-border-strong bg-well">
          <img src={banner} alt="" className="aspect-[3/1] w-full object-cover" loading="lazy" />
        </div>
      )}
      <h2 id="about-title" className="text-title">
        About {page.name}
      </h2>
      {page.description && (
        <p className="mt-3 max-w-[62ch] text-base leading-relaxed whitespace-pre-line text-foreground/85">
          {page.description}
        </p>
      )}
      {socials.length > 0 && (
        <div className="mt-6 flex flex-wrap gap-2.5">
          {socials.map(({ key, label, Icon }) => (
            <Button key={key} asChild variant="outline" size="sm">
              <a href={page.socials[key]} target="_blank" rel="noreferrer">
                <Icon />
                {label}
              </a>
            </Button>
          ))}
        </div>
      )}
    </section>
  )
}

/** The Transfers row's words, by the collection's level on its validator. */
const TRANSFERS: Record<NonNullable<MintLive['transfers']>, string> = {
  open: 'Open',
  locked: 'Locked by the creator',
  restricted: 'Restricted by the creator',
}

/** The contract and its facts: supply, royalties, transfers and the art, from the chain's state. */
export function Details() {
  const { page, live } = useMint()
  const chain = page.chain
  const pending = <Skeleton className="h-4 w-20" />
  const rows: { label: string; value: React.ReactNode }[] = [
    { label: 'Chain', value: <ChainName chain={chain} /> },
    { label: 'Token standard', value: 'ERC-721C' },
    {
      label: 'Supply',
      value: live ? <span className="numeric">{live.supply.max.toLocaleString('en-US')}</span> : pending,
    },
    {
      label: 'Royalties',
      value: live ? (
        <>
          <span className="numeric">{formatBps(live.royaltyBps)}</span>
          {live.royaltyEnforced && ', enforced on secondary sales through the transfer validator'}
        </>
      ) : (
        pending
      ),
    },
    ...(live?.transfers ? [{ label: 'Transfers', value: TRANSFERS[live.transfers] }] : []),
    { label: 'Art', value: live ? (live.revealed ? 'Revealed' : 'Not revealed yet') : pending },
  ]
  return (
    <section aria-labelledby="details-title">
      <h2 id="details-title" className="text-title">
        Details
      </h2>
      <div className="mt-5 rounded-xl border bg-card p-5 shadow-raised sm:p-6">
        <p className="text-[0.8125rem] text-muted-foreground">Contract</p>
        <div className="mt-1.5 flex items-center gap-1">
          {chain.explorerUrl ? (
            <a
              href={explorerAddressUrl(chain, page.contract)}
              target="_blank"
              rel="noreferrer"
              className="numeric inline-flex min-w-0 items-center gap-1.5 text-[0.9375rem] underline-offset-4 hover:underline"
            >
              <span className="truncate">{shortAddress(page.contract, 6)}</span>
              <ExternalLinkIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="sr-only">(opens the explorer)</span>
            </a>
          ) : (
            <span className="numeric min-w-0 truncate text-[0.9375rem]">
              {shortAddress(page.contract, 6)}
            </span>
          )}
          <CopyButton value={page.contract} label="Copy contract address" />
        </div>
        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-t pt-5">
          {rows.map((row) => (
            <div key={row.label}>
              <dt className="text-[0.8125rem] text-muted-foreground">{row.label}</dt>
              <dd className="mt-0.5 text-sm">{row.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}

export function MintFooter() {
  return (
    <footer className="mx-auto mt-24 flex max-w-[90rem] flex-col items-center justify-between gap-3 border-t px-4 py-8 pb-28 text-[0.8125rem] text-muted-foreground sm:flex-row sm:px-8 lg:pb-8">
      <a
        href="/"
        className="inline-flex items-center gap-2 rounded-md outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <LogoMark className="size-5" />
        Powered by Cobweb
      </a>
      <p>Prices are in the chain&apos;s native token. Gas is extra.</p>
    </footer>
  )
}
```

Replace the whole of `apps/web/src/components/mint/mint-flow-dialog.tsx` with:

```tsx
'use client'

import { CheckIcon, ExternalLinkIcon, XIcon } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Button } from '@cobweb/ui/components/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@cobweb/ui/components/dialog'
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from '@cobweb/ui/components/drawer'
import { Spinner } from '@cobweb/ui/components/spinner'
import { useIsMobile } from '@cobweb/ui/hooks/use-mobile'
import { transition } from '@cobweb/ui/lib/motion'
import { cn } from '@cobweb/ui/lib/utils'
import { ChainName } from '@/components/chains/chain-icon'
import { explorerTxUrl, formatNative, shortAddress } from '@/lib/demo/helpers'
import { failureActions, failureCopy, type FailureAction } from '@/lib/mint/mint-failure'
import { useMint } from './mint-context'
import { MintSuccess } from './mint-success'
import type { FlowState, FlowStep } from './use-mint-flow'

const STEPS: { step: FlowStep; title: string }[] = [
  { step: 'checking', title: 'Check the mint' },
  { step: 'wallet', title: 'Confirm in your wallet' },
  { step: 'confirming', title: 'Confirm on-chain' },
]

/**
 * The mint, from the check to the result. A dialog on larger screens, a bottom sheet on phones.
 * It cannot be dismissed while the wallet is open or the transaction is in flight, so the visitor
 * always sees how it ended.
 */
export function MintFlowDialog() {
  const { flow, closeFlow, page } = useMint()
  const mobile = useIsMobile()
  const open = flow.step !== 'idle'
  const locked = flow.step === 'wallet' || flow.step === 'confirming'
  const onOpenChange = (next: boolean) => {
    if (!next && !locked) closeFlow()
  }
  const { title, description } = heading(flow, page.name, page.chain.name)

  if (mobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange} dismissible={!locked}>
        <DrawerContent className="px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto w-full max-w-md overflow-y-auto pt-4">
            <DrawerTitle className="text-title">{title}</DrawerTitle>
            <DrawerDescription className="mt-1.5 text-sm leading-relaxed">{description}</DrawerDescription>
            <FlowBody />
          </div>
        </DrawerContent>
      </Drawer>
    )
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={!locked}
        onEscapeKeyDown={(event) => locked && event.preventDefault()}
        onInteractOutside={(event) => locked && event.preventDefault()}
        className={cn('gap-0 sm:max-w-md', flow.step === 'success' && 'sm:max-w-xl')}
      >
        <DialogTitle className="text-title pr-8">{title}</DialogTitle>
        <DialogDescription className="mt-1.5 text-sm leading-relaxed">{description}</DialogDescription>
        <FlowBody />
      </DialogContent>
    </Dialog>
  )
}

function heading(flow: FlowState, name: string, chainName: string): { title: string; description: string } {
  if (flow.step === 'success') {
    const count = flow.tokenIds.length
    return {
      title: `Welcome to ${name}`,
      description: `${count === 1 ? 'Your new token is' : `Your ${count} new tokens are`} in your wallet.`,
    }
  }
  if (flow.step === 'error') {
    const copy = failureCopy(flow.failure, chainName)
    return { title: copy.title, description: copy.sentence }
  }
  if (flow.step === 'wallet')
    return {
      title: 'Confirm in your wallet',
      description: 'Your wallet is open with the checked transaction.',
    }
  if (flow.step === 'confirming')
    return { title: 'Minting', description: 'Sent. The network is including your transaction.' }
  return {
    title: 'Checking your mint',
    description: 'Nothing is sent yet. The mint is checked against the contract first.',
  }
}

/** The label of a way forward; null for one this flow cannot offer. */
function actionLabel(action: FailureAction, hasExplorer: boolean): string | null {
  switch (action.kind) {
    case 'retry':
      return 'Try again'
    case 'close':
      return 'Close'
    case 'see-phases':
      return 'See open phases'
    case 'mint-count':
      return `Mint ${action.count}`
    case 'mint-fewer':
      return 'Mint fewer'
    case 'use-wallet':
      return 'Use this wallet'
    case 'view-transaction':
      return hasExplorer ? 'View transaction' : null
  }
}

function FlowBody() {
  const { flow, act, closeFlow, page, live, setQuantity, setVault } = useMint()
  const reduce = useReducedMotion()
  if (flow.step === 'idle') return null
  if (flow.step === 'success') return <MintSuccess />

  const { params } = flow
  const chain = page.chain
  const total = formatNative(params.valueWei, chain.nativeSymbol)
  const group = live?.groups.find((entry) => entry.id === params.groupId)
  const actions =
    flow.step === 'error'
      ? failureActions(flow.failure).flatMap((action) => {
          const label = actionLabel(action, !!chain.explorerUrl && !!flow.hash)
          return label ? [{ action, label }] : []
        })
      : []
  const run = (action: FailureAction) => {
    if (action.kind === 'retry') return act()
    if (action.kind === 'mint-count' || action.kind === 'mint-fewer') setQuantity(action.count)
    if (action.kind === 'use-wallet') setVault(null)
    if (action.kind === 'view-transaction' && flow.hash) {
      window.open(explorerTxUrl(chain, flow.hash), '_blank', 'noreferrer')
      return
    }
    closeFlow()
  }
  const current = flow.step === 'error' ? flow.failedAt : flow.step
  const currentIndex = STEPS.findIndex((entry) => entry.step === current)

  return (
    <div className="mt-6">
      <div className="rounded-lg bg-surface-2 px-4 py-3.5 text-sm">
        <div className="flex items-baseline justify-between gap-3">
          <span>
            <span className="numeric">{params.amount}</span> {params.amount === 1 ? 'token' : 'tokens'} from{' '}
            {group?.name}
          </span>
          <span className="numeric font-medium">{total}</span>
        </div>
        {params.vault && (
          <p className="mt-1 text-[0.8125rem] text-muted-foreground">
            Using the allowance of vault <span className="numeric">{shortAddress(params.vault)}</span>
          </p>
        )}
        {flow.step === 'error' && flow.failure.kind === 'insufficient-balance' && (
          <p className="mt-1 text-[0.8125rem] text-muted-foreground">
            Add {chain.nativeSymbol} on <ChainName chain={chain} iconClassName="size-3.5" /> to{' '}
            <span className="numeric">{shortAddress(params.account)}</span>, or mint fewer.
          </p>
        )}
      </div>

      <ol className="mt-5 space-y-3" aria-live="polite">
        {STEPS.map((entry, index) => {
          const failed = flow.step === 'error' && index === currentIndex
          const done = index < currentIndex
          const active = index === currentIndex && !failed
          return (
            <li key={entry.step} className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className={cn(
                  'flex size-7 shrink-0 items-center justify-center rounded-full border text-xs',
                  done && 'border-transparent bg-success-soft text-success-foreground',
                  active && 'border-primary-line bg-primary-soft text-primary',
                  failed && 'border-transparent bg-destructive-soft text-destructive-foreground',
                  !done && !active && !failed && 'border-border-strong text-muted-foreground',
                )}
              >
                {done ? (
                  <CheckIcon className="size-3.5" strokeWidth={3} />
                ) : failed ? (
                  <XIcon className="size-3.5" strokeWidth={3} />
                ) : active ? (
                  <Spinner className="size-3.5" />
                ) : (
                  <span className="numeric">{index + 1}</span>
                )}
              </span>
              <span className={cn('text-sm', !done && !active && !failed && 'text-muted-foreground')}>
                {entry.title}
                <span className="sr-only">
                  {done ? ', done' : active ? ', in progress' : failed ? ', failed' : ''}
                </span>
              </span>
            </li>
          )
        })}
      </ol>

      {flow.hash && chain.explorerUrl && (
        <a
          href={explorerTxUrl(chain, flow.hash)}
          target="_blank"
          rel="noreferrer"
          className="mt-5 inline-flex items-center gap-1.5 text-[0.8125rem] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          View transaction <span className="numeric">{shortAddress(flow.hash, 6)}</span>
          <ExternalLinkIcon aria-hidden="true" className="size-3.5" />
        </a>
      )}

      <AnimatePresence initial={false}>
        {flow.step === 'error' && (
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={transition.base}
            className="mt-6 grid gap-2.5 sm:grid-cols-2"
          >
            {actions.map(({ action, label }, index) => (
              <Button
                key={action.kind}
                variant={index === 0 ? 'default' : 'secondary'}
                className={actions.length === 1 ? 'sm:col-span-2' : undefined}
                onClick={() => run(action)}
              >
                {label}
              </Button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
```

Replace the whole of `apps/web/src/components/mint/mint-page.tsx` with:

```tsx
import { ArtStage } from './art-stage'
import { About, Details, Gallery, MintFooter } from './collection-sections'
import { MintProvider } from './mint-context'
import { MintFlowDialog } from './mint-flow-dialog'
import { MintPanel } from './mint-panel'
import { DegradedBanner, MintTopBar } from './mint-top-bar'
import { PhaseList } from './phase-list'
import { StickyMintBar } from './sticky-mint-bar'
import type { MintPageProps } from './types'

/**
 * The public mint page. It stands alone: no app sidebar, the collection's identity at the top, the art and the
 * mint menu side by side, then the collection itself below. The content comes from the page's document; the
 * chain's state from the source the browser polls.
 */
export function MintPage(props: MintPageProps) {
  const { page } = props
  return (
    <MintProvider {...props}>
      {/* Most collectors mint on a phone, so this page reads one step larger there than the
          dashboard's 12px root. The rule only exists while this page is mounted. */}
      <style>{'@media (max-width: 639px) { html { font-size: 14px } }'}</style>
      <div className="relative isolate min-h-svh overflow-x-clip">
        {/* The creator's banner, dimmed into the page behind the hero; the theme's colours without one. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 -z-20 h-[34rem] overflow-hidden"
          style={{ maskImage: 'linear-gradient(to bottom, black 20%, transparent 100%)' }}
        >
          {page.bannerUrl ? (
            <img src={page.bannerUrl} alt="" className="size-full object-cover opacity-[0.16] blur-[2px]" />
          ) : (
            <div className="from-primary/10 via-surface-2 to-background size-full bg-linear-to-b" />
          )}
        </div>

        <MintTopBar page={page} />
        <DegradedBanner />

        <main className="mx-auto max-w-[90rem] px-4 pt-6 sm:px-8 lg:pt-10">
          <div className="grid gap-10 lg:grid-cols-12 lg:gap-12 xl:gap-16">
            <div className="self-start lg:sticky lg:top-10 lg:col-span-7 lg:pt-8">
              <ArtStage />
            </div>
            <div className="lg:col-span-5">
              <MintPanel />
              <PhaseList />
            </div>
          </div>
        </main>

        <div className="mt-24 lg:mt-32">
          <Gallery />
        </div>

        <div className="mx-auto mt-20 grid max-w-[90rem] gap-14 px-4 sm:px-8 lg:mt-28 lg:grid-cols-12 lg:gap-12 xl:gap-16">
          <div className="lg:col-span-7">
            <About page={page} />
          </div>
          <div className="lg:col-span-5">
            <Details />
          </div>
        </div>

        <MintFooter />
        <StickyMintBar />
        <MintFlowDialog />
      </div>
    </MintProvider>
  )
}
```

Replace the whole of `apps/web/src/components/mint/mint-panel.tsx` with:

```tsx
'use client'

import { ArrowDownIcon, ExternalLinkIcon, RotateCwIcon } from 'lucide-react'
import { Button } from '@cobweb/ui/components/button'
import { Progress } from '@cobweb/ui/components/progress'
import { Skeleton } from '@cobweb/ui/components/skeleton'
import { StatusBadge } from '@cobweb/ui/components/status-badge'
import { explorerAddressUrl, formatNative, shortAddress } from '@/lib/demo/helpers'
import { ChainName } from '@/components/chains/chain-icon'
import { Countdown } from './countdown'
import { MintButton, MintHint } from './mint-action'
import { useMint } from './mint-context'
import { Eligibility, PhasePicker, PriceBreakdown, QuantityStepper, VaultPicker } from './panel-controls'
import { useHydrated, useLocalTime } from './use-chain-clock'

/** What the panel says in place of the button once the server refused the collection for this page load. */
const REFUSALS = {
  'not-a-collection': 'This contract could not be confirmed on its chain yet. Reload the page in a minute.',
  unavailable: 'Live status is not available for this collection right now.',
} as const

/** The mint menu: who and what, how much is left, the phase, what this wallet can do, one button. */
export function MintPanel() {
  const {
    page,
    live: state,
    track,
    waitingLong,
    phases,
    phase,
    minted,
    soldOut,
    walletAddress,
    quantity,
    maxQuantity,
  } = useMint()
  const chain = page.chain
  if (track.final) return <Refused reason={track.final} />
  if (!state) return <Reading slow={waitingLong} />
  const live = phases.filter((entry) => entry.status === 'live')
  const max = state.supply.max
  const percent = max > 0 ? Math.floor((minted / max) * 100) : 0
  const picking = live.length > 1 && phase?.status === 'live'

  const overall = soldOut
    ? ({ status: 'soldout', label: 'Sold out' } as const)
    : live.length > 0
      ? ({ status: 'live', label: 'Minting now' } as const)
      : phase?.status === 'starting'
        ? ({ status: 'pending', label: 'Starting' } as const)
        : phase?.status === 'scheduled'
          ? ({ status: 'scheduled', label: 'Upcoming' } as const)
          : ({ status: 'closed', label: 'Paused' } as const)

  return (
    <section
      id="mint"
      aria-labelledby="collection-name"
      className="relative rounded-xl border border-border-strong bg-card p-5 shadow-lifted sm:p-6 xl:p-7"
    >
      <div className="flex items-center justify-between gap-3">
        <StatusBadge status={overall.status}>{overall.label}</StatusBadge>
        <ChainName
          chain={chain}
          className="text-[0.8125rem] text-muted-foreground"
          iconClassName="size-3.5"
        />
      </div>

      <h1
        id="collection-name"
        className="mt-4 text-[2.25rem] leading-[1.05] font-semibold tracking-[-0.035em] sm:text-[2.75rem]"
      >
        {page.name}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        by{' '}
        {chain.explorerUrl ? (
          <a
            href={explorerAddressUrl(chain, state.creator)}
            target="_blank"
            rel="noreferrer"
            className="numeric text-foreground underline-offset-4 hover:underline"
          >
            {shortAddress(state.creator)}
          </a>
        ) : (
          <span className="numeric text-foreground">{shortAddress(state.creator)}</span>
        )}
      </p>

      <div className="mt-5">
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <p>
            <span className="numeric text-lg font-medium">{minted.toLocaleString('en-US')}</span>
            <span className="text-muted-foreground"> of </span>
            <span className="numeric text-muted-foreground">{max.toLocaleString('en-US')}</span>
            <span className="text-muted-foreground"> minted</span>
          </p>
          <p className="numeric text-[0.8125rem] text-muted-foreground">{percent}%</p>
        </div>
        <Progress
          value={max > 0 ? (minted / max) * 100 : 0}
          size="sm"
          className="mt-2.5"
          aria-label={`${minted} of ${max} minted`}
        />
      </div>

      <div className="mt-5 space-y-4 border-t pt-5">
        {soldOut ? (
          <SoldOut />
        ) : !phase ? (
          <Paused />
        ) : (
          <>
            {picking && <PhasePicker live={live} />}
            {(phase.status === 'scheduled' || phase.status === 'starting') && <Upcoming />}
            <PhasePrice />
            {/* The picker's cards already say where this wallet stands in each open phase. */}
            {walletAddress && !picking && <Eligibility phase={phase} />}
            {walletAddress && <VaultPicker phase={phase} />}
            {phase.status === 'live' && walletAddress && maxQuantity > 0 && <QuantityStepper />}
            {((phase.status === 'live' && (!walletAddress || maxQuantity > 0)) ||
              (!walletAddress && phase.status !== 'live')) && (
              <PriceBreakdown phase={phase} quantity={walletAddress && maxQuantity > 0 ? quantity : 1} />
            )}
          </>
        )}
      </div>

      <div className="mt-5 space-y-3" data-mint-action>
        {!soldOut && <MintButton />}
        <MintHint />
      </div>
    </section>
  )
}

/** Before the first answer: the panel's shape, and the button reading "Reading the chain". */
function Reading({ slow }: { slow: boolean }) {
  const { page } = useMint()
  return (
    <section
      id="mint"
      aria-labelledby="collection-name"
      aria-busy="true"
      className="relative rounded-xl border border-border-strong bg-card p-5 shadow-lifted sm:p-6 xl:p-7"
    >
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-6 w-28 rounded-full" />
        <ChainName
          chain={page.chain}
          className="text-[0.8125rem] text-muted-foreground"
          iconClassName="size-3.5"
        />
      </div>
      <h1
        id="collection-name"
        className="mt-4 text-[2.25rem] leading-[1.05] font-semibold tracking-[-0.035em] sm:text-[2.75rem]"
      >
        {page.name}
      </h1>
      <Skeleton className="mt-3 h-4 w-32" />
      <Skeleton className="mt-6 h-4 w-full" />
      <Skeleton className="mt-3 h-1 w-full rounded-full" />
      <div className="mt-5 space-y-4 border-t pt-5">
        <div className="flex justify-between">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-8 w-28" />
        </div>
        <Skeleton className="h-12 w-full rounded-lg" />
      </div>
      <div className="mt-5 space-y-3" data-mint-action>
        <MintButton />
        <p aria-live="polite" className="text-center text-[0.8125rem] leading-snug text-muted-foreground">
          {slow ? 'Live status is taking longer than usual. This page keeps trying.' : 'Reading the chain.'}
        </p>
      </div>
    </section>
  )
}

/** The server refused the collection for this page load: what it means, and no mint button. */
function Refused({ reason }: { reason: keyof typeof REFUSALS }) {
  const { page } = useMint()
  return (
    <section
      id="mint"
      aria-labelledby="collection-name"
      className="relative rounded-xl border border-border-strong bg-card p-5 shadow-lifted sm:p-6 xl:p-7"
    >
      <div className="flex items-center justify-end gap-3">
        <ChainName
          chain={page.chain}
          className="text-[0.8125rem] text-muted-foreground"
          iconClassName="size-3.5"
        />
      </div>
      <h1
        id="collection-name"
        className="mt-4 text-[2.25rem] leading-[1.05] font-semibold tracking-[-0.035em] sm:text-[2.75rem]"
      >
        {page.name}
      </h1>
      <p role="status" className="mt-5 border-t pt-5 text-sm leading-relaxed text-muted-foreground">
        {REFUSALS[reason]}
      </p>
      {reason === 'not-a-collection' && (
        <Button variant="secondary" className="mt-5 w-full" onClick={() => window.location.reload()}>
          <RotateCwIcon />
          Reload
        </Button>
      )}
    </section>
  )
}

function PhasePrice() {
  const { phase, page } = useMint()
  if (!phase) return null
  const free = phase.group.priceWei === '0'
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <p className="text-sm font-semibold">
          {phase.group.name}
          <span className="ml-2 font-normal text-muted-foreground">
            {phase.group.kind === 'public' ? 'Public sale' : 'Whitelist'}
          </span>
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          <span className="numeric">{phase.remainingSupply.toLocaleString('en-US')}</span> of{' '}
          <span className="numeric">{phase.group.maxSupply.toLocaleString('en-US')}</span> left in this phase
        </p>
      </div>
      <p className="text-right">
        <span className="numeric block text-[1.75rem] leading-none font-medium">
          {free ? 'Free' : formatNative(phase.group.priceWei, page.chain.nativeSymbol)}
        </span>
        <span className="mt-1 block text-xs text-muted-foreground">per token</span>
      </p>
    </div>
  )
}

function Upcoming() {
  const { phase } = useMint()
  const when = useLocalTime(phase?.group.scheduledStart ?? 0)
  const hydrated = useHydrated()
  if (!phase) return null
  if (phase.status === 'starting') {
    return (
      <div role="status" className="rounded-lg border border-border-strong bg-surface-2 p-4">
        <p className="flex items-center gap-2.5 text-sm font-medium">
          <span aria-hidden="true" className="relative flex size-2">
            <span className="animate-live-pulse absolute inset-0 rounded-full bg-warning" />
            <span className="relative size-2 rounded-full bg-warning" />
          </span>
          Starting, waiting for the chain
        </p>
        <p className="mt-1.5 text-[0.8125rem] leading-snug text-muted-foreground">
          {phase.group.name} was scheduled for {when}. It opens the moment the chain reports it live, usually
          within a few seconds.
        </p>
      </div>
    )
  }
  return (
    <div>
      <p className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{phase.group.name}</span> opens in
      </p>
      <Countdown seconds={phase.startsIn ?? 0} className="mt-3" />
      <p className="mt-3 text-[0.8125rem] text-muted-foreground">
        <span className="numeric">{when}</span>
        {hydrated && ', your time'}
      </p>
      <p className="sr-only" role="status">
        {phase.group.name} opens {when}.
      </p>
    </div>
  )
}

function SoldOut() {
  const { page, live } = useMint()
  const chain = page.chain
  return (
    <div>
      <p className="text-title">
        Every one of the {(live?.supply.max ?? 0).toLocaleString('en-US')} is minted.
      </p>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {page.name} sold out. Thank you to everyone who minted. Tokens now change hands between holders.
      </p>
      <div className="mt-5 grid gap-2.5 sm:grid-cols-2">
        {chain.explorerUrl && (
          <Button asChild variant="secondary">
            <a href={`${chain.explorerUrl}/token/${page.contract}`} target="_blank" rel="noreferrer">
              Holders on the explorer
              <ExternalLinkIcon />
            </a>
          </Button>
        )}
        <Button asChild variant="outline">
          <a href="#gallery">
            See the collection
            <ArrowDownIcon />
          </a>
        </Button>
      </div>
    </div>
  )
}

function Paused() {
  const { phases } = useMint()
  const finished = phases.filter((entry) => entry.status === 'closed' || entry.status === 'soldout')
  return (
    <div>
      <p className="text-heading">Minting is paused between phases</p>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
        {finished.length > 0
          ? `${listNames(finished.map((entry) => entry.group.name))} ${finished.length === 1 ? 'has' : 'have'} closed. `
          : ''}
        Nothing is scheduled yet. When the creator opens the next phase, it shows here without a refresh.
      </p>
    </div>
  )
}

/** `A`, `A and B`, `A, B and C`. */
function listNames(names: string[]): string {
  if (names.length < 2) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}
```

Replace the whole of `apps/web/src/components/mint/mint-top-bar.tsx` with:

```tsx
'use client'

import { TriangleAlertIcon } from 'lucide-react'
import { Artwork } from '@cobweb/ui/components/artwork'
import type { MintPageStatic } from '@/lib/mint/page-doc'
import { useMint } from './mint-context'
import { WalletButton } from './wallet-button'

/** The slim bar: the collection's identity on the left, the wallet on the right. No app chrome. */
export function MintTopBar({ page }: { page: MintPageStatic }) {
  return (
    <header className="relative z-10 mx-auto flex h-16 max-w-[90rem] items-center justify-between gap-4 px-4 sm:h-[4.5rem] sm:px-8">
      <a
        href="#mint"
        className="flex min-w-0 items-center gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Artwork
          src={page.avatarUrl}
          alt=""
          seed={`${page.slug}-avatar`}
          className="size-9 shrink-0 rounded-full border border-border-strong"
        />
        <span className="truncate text-[0.9375rem] font-semibold tracking-[-0.01em]">{page.name}</span>
        <span className="numeric hidden text-xs text-muted-foreground sm:inline">{page.symbol}</span>
      </a>
      <WalletButton />
    </header>
  )
}

/**
 * Shown when the freshness server could not read the chain recently, or the page could not reach it for 10 s.
 * What the page shows may be a little old; every mint is still checked against the chain before the wallet opens.
 */
export function DegradedBanner() {
  const { degraded, degradedMinutes } = useMint()
  if (!degraded) return null
  const minutes = degradedMinutes ?? 0
  return (
    <div role="status" className="mx-auto max-w-[90rem] px-4 sm:px-8">
      <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3">
        <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning-foreground" />
        <p className="text-[0.8125rem] leading-snug">
          <span className="font-medium text-warning-foreground">Live status may be out of date.</span>{' '}
          <span className="text-foreground/85">
            We have not reached the chain{' '}
            {minutes >= 1 ? `for ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}` : 'for a little while'},
            so counts and phase status can lag. Every mint is still checked against the chain before your
            wallet opens.
          </span>
        </p>
      </div>
    </div>
  )
}
```

In `apps/web/src/components/mint/mint-action.tsx`, replace:

```tsx
/** The line under the button: what the visitor's status means and what happens next. */
export function MintHint({ className }: { className?: string }) {
  const { action, phase, phases, data, vault, wallet } = useMint()
  const nextPublic = phases.find((entry) => entry.group.kind === 'public')
  const publicTime = useLocalTime(nextPublic?.group.scheduledStart ?? 0)
```

with:

```tsx
/** The line under the button: what the visitor's status means and what happens next. */
export function MintHint({ className }: { className?: string }) {
  const { action, phase, phases, page, vault, walletAddress } = useMint()
  const nextPublic = phases.find((entry) => entry.group.kind === 'public')
  const publicTime = useLocalTime(nextPublic?.group.scheduledStart ?? 0)
```

In `apps/web/src/components/mint/mint-action.tsx`, replace:

```tsx
      <p aria-live="polite" className={lineClass}>
        This collection is on{' '}
        <ChainName chain={data.collection.chain} className="text-foreground" iconClassName="size-3.5" />. Your
        wallet will ask you to switch.
      </p>
    )
```

with:

```tsx
      <p aria-live="polite" className={lineClass}>
        This collection is on{' '}
        <ChainName chain={page.chain} className="text-foreground" iconClassName="size-3.5" />. Your wallet
        will ask you to switch.
      </p>
    )
```

In `apps/web/src/components/mint/mint-action.tsx`, replace:

```tsx
    text = `${vault ? 'The vault has' : 'You have'} minted ${own?.used ?? 0} of ${own?.quota ?? 0} in ${phase.group.name}.`
    if (other) text += ` ${other.group.name} still has ${other.wallet!.remaining} for you.`
    else if (nextPublic && nextPublic !== phase && nextPublic.status === 'scheduled' && wallet) {
      text += ` Public opens ${publicTime}.`
    }
  } else if (action.label === 'Phase sold out') {
    text = 'Every token in this phase is minted.'
  }

```

with:

```tsx
    text = `${vault ? 'The vault has' : 'You have'} minted ${own?.used ?? 0} of ${own?.quota ?? 0} in ${phase.group.name}.`
    if (other) text += ` ${other.group.name} still has ${other.wallet!.remaining} for you.`
    else if (nextPublic && nextPublic !== phase && nextPublic.status === 'scheduled' && walletAddress) {
      text += ` Public opens ${publicTime}.`
    }
  } else if (action.label === 'Phase sold out') {
    text = 'Every token in this phase is minted.'
  } else if (action.label === 'Checking this wallet') {
    text = 'Reading what this wallet can mint in each phase.'
  }

```

In `apps/web/src/components/mint/mint-success.tsx`, replace:

```tsx
import { explorerTxUrl } from '@/lib/demo/helpers'
import { useMint } from './mint-context'
import { TokenImage } from './token-image'

/**
 * The peak of the page: the minted tokens are revealed one after another, a curtain lifting off
 * each. Ids, the transaction, a share action, and "Mint more" when the wallet still has room.
 */
export function MintSuccess() {
  const { flow, data, previewFor, action, closeFlow } = useMint()
  const reduce = useReducedMotion()
  if (flow.step !== 'success') return null
  const chain = data.collection.chain
  const name = data.collection.name
  const ids = flow.tokenIds
  const canMintMore = action.kind === 'mint'

```

with:

```tsx
import { explorerTxUrl } from '@/lib/demo/helpers'
import { useMint } from './mint-context'
import { TokenArtFrame } from './token-image'
import { useTokenArt } from './use-token-art'

/**
 * The peak of the page: the minted tokens are revealed one after another, a curtain lifting off
 * each. Ids, the transaction, a share action, and "Mint more" when the wallet still has room.
 */
export function MintSuccess() {
  const { flow, page, live, source, action, closeFlow } = useMint()
  const reduce = useReducedMotion()
  const ids = flow.step === 'success' ? flow.tokenIds : []
  // Each minted token's art at the state's base URI: the placeholder's image before the reveal.
  const art = useTokenArt(source, live?.baseUri ?? null, ids)
  if (flow.step !== 'success') return null
  const chain = page.chain
  const name = page.name
  const canMintMore = action.kind === 'mint'

```

In `apps/web/src/components/mint/mint-success.tsx`, replace:

```tsx
                  transition={{ duration: 1.4, ease: EASE_OUT, delay: reduce ? 0 : 0.35 + index * 0.18 }}
                >
                  <TokenImage layers={previewFor(id).layers} alt={`${name} #${id}`} eager />
                </motion.div>
                {!reduce && (
```

with:

```tsx
                  transition={{ duration: 1.4, ease: EASE_OUT, delay: reduce ? 0 : 0.35 + index * 0.18 }}
                >
                  <TokenArtFrame art={art.get(id)} id={id} alt={`${name} #${id}`} eager />
                </motion.div>
                {!reduce && (
```

In `apps/web/src/components/mint/mint-success.tsx`, replace:

```tsx
      >
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[0.8125rem]">
          <a
            href={explorerTxUrl(chain, flow.hash)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            View transaction
            <ExternalLinkIcon aria-hidden="true" className="size-3.5" />
          </a>
          <button
            type="button"
```

with:

```tsx
      >
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[0.8125rem]">
          {chain.explorerUrl && (
            <a
              href={explorerTxUrl(chain, flow.hash)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              View transaction
              <ExternalLinkIcon aria-hidden="true" className="size-3.5" />
            </a>
          )}
          <button
            type="button"
```

In `apps/web/src/components/mint/panel-controls.tsx`, replace:

```tsx
'use client'

import { CircleCheckIcon, CircleMinusIcon, MinusIcon, PlusIcon, UsersIcon } from 'lucide-react'
import { Button } from '@cobweb/ui/components/button'
import { ChoiceCard, ChoiceCards } from '@cobweb/ui/components/choice-cards'
```

with:

```tsx
'use client'

import { CircleCheckIcon, CircleMinusIcon, MinusIcon, PlusIcon, RotateCwIcon, UsersIcon } from 'lucide-react'
import { Button } from '@cobweb/ui/components/button'
import { ChoiceCard, ChoiceCards } from '@cobweb/ui/components/choice-cards'
```

In `apps/web/src/components/mint/panel-controls.tsx`, replace:

```tsx
 */
export function PhasePicker({ live }: { live: Phase[] }) {
  const { phase, selectPhase, data } = useMint()
  const symbol = data.collection.chain.nativeSymbol
  return (
    <fieldset>
```

with:

```tsx
 */
export function PhasePicker({ live }: { live: Phase[] }) {
  const { phase, selectPhase, page, live: state } = useMint()
  const symbol = page.chain.nativeSymbol
  return (
    <fieldset>
```

In `apps/web/src/components/mint/panel-controls.tsx`, replace:

```tsx
      >
        {live.map((entry) => {
          const standing = phaseStanding(entry, data.publicMaxMintPerWallet)
          const Icon = standing.usable === false ? CircleMinusIcon : CircleCheckIcon
          const kind = entry.group.kind === 'public' ? 'Public sale' : 'Whitelist'
```

with:

```tsx
      >
        {live.map((entry) => {
          const standing = phaseStanding(entry, state?.publicMaxMintPerWallet ?? 0)
          const Icon = standing.usable === false ? CircleMinusIcon : CircleCheckIcon
          const kind = entry.group.kind === 'public' ? 'Public sale' : 'Whitelist'
```

In `apps/web/src/components/mint/panel-controls.tsx`, replace:

```tsx
}

/** The connected wallet's standing in the chosen phase, in one plain sentence and a count. */
export function Eligibility({ phase }: { phase: Phase }) {
  const own = phase.wallet
  if (!own) return null
```

with:

```tsx
}

/**
 * The connected wallet's standing in the chosen phase, in one plain sentence and a count. A wallet the list does
 * not name can ask again: its quota may have just been written on chain.
 */
export function Eligibility({ phase }: { phase: Phase }) {
  const { checkWallet } = useMint()
  const own = phase.wallet
  if (!own) return null
```

In `apps/web/src/components/mint/panel-controls.tsx`, replace:

```tsx
          <span className="text-foreground">{own.remaining}</span> of {own.quota} left
        </p>
      )}
    </div>
```

with:

```tsx
          <span className="text-foreground">{own.remaining}</span> of {own.quota} left
        </p>
      )}
      {!isPublic && !own.eligible && (
        <Button variant="ghost" size="sm" className="shrink-0" onClick={checkWallet}>
          <RotateCwIcon />
          Check again
        </Button>
      )}
    </div>
```

In `apps/web/src/components/mint/panel-controls.tsx`, replace:

```tsx
/** Price and platform fee, itemised, so the total in the wallet is never a surprise. */
export function PriceBreakdown({ phase, quantity }: { phase: Phase; quantity: number }) {
  const { data } = useMint()
  const symbol = data.collection.chain.nativeSymbol
  const q = quote(data, phase.group.priceWei, quantity)
  const each = quote(data, phase.group.priceWei, 1)
  const rows = [
    {
```

with:

```tsx
/** Price and platform fee, itemised, so the total in the wallet is never a surprise. */
export function PriceBreakdown({ phase, quantity }: { phase: Phase; quantity: number }) {
  const { page, live } = useMint()
  if (!live) return null
  const symbol = page.chain.nativeSymbol
  const q = quote(live, phase.group.priceWei, quantity)
  const each = quote(live, phase.group.priceWei, 1)
  const rows = [
    {
```

In `apps/web/src/components/mint/phase-list.tsx`, replace:

```tsx

import { CircleCheckIcon, CircleMinusIcon } from 'lucide-react'
import { StatusBadge, type Status } from '@cobweb/ui/components/status-badge'
import { cn } from '@cobweb/ui/lib/utils'
```

with:

```tsx

import { CircleCheckIcon, CircleMinusIcon } from 'lucide-react'
import { Skeleton } from '@cobweb/ui/components/skeleton'
import { StatusBadge, type Status } from '@cobweb/ui/components/status-badge'
import { cn } from '@cobweb/ui/lib/utils'
```

In `apps/web/src/components/mint/phase-list.tsx`, replace:

```tsx
] as const

/** Every phase, grouped by now, next and done, with what it means for the connected wallet. */
export function PhaseList() {
  const { phases, phase: selected } = useMint()
  const sorted = sortPhases(phases)
  const liveCount = phases.filter((entry) => entry.status === 'live').length
```

with:

```tsx
] as const

/** Every phase, grouped by now, next and done, each group in the creator's order, with what it means for the wallet. */
export function PhaseList() {
  const { live, track, phases, phase: selected } = useMint()
  if (track.final) return null
  if (!live) {
    return (
      <section aria-label="Phases" aria-busy="true" className="mt-10">
        <Skeleton className="h-5 w-20" />
        <Skeleton className="mt-4 h-24 w-full rounded-xl" />
        <Skeleton className="mt-2.5 h-24 w-full rounded-xl" />
      </section>
    )
  }
  const sorted = sortPhases(phases)
  const liveCount = phases.filter((entry) => entry.status === 'live').length
```

In `apps/web/src/components/mint/phase-list.tsx`, replace:

```tsx

function PhaseRow({ phase, selected }: { phase: Phase; selected: boolean }) {
  const { data, wallet } = useMint()
  const { group, status } = phase
  const when = useLocalTime(group.scheduledStart)
  const hydrated = useHydrated()
  const minted = group.maxSupply - phase.remainingSupply
  const fill = Math.min(100, (minted / group.maxSupply) * 100)
  const badge = BADGE[status]
  const symbol = data.collection.chain.nativeSymbol

  return (
```

with:

```tsx

function PhaseRow({ phase, selected }: { phase: Phase; selected: boolean }) {
  const { page, walletAddress } = useMint()
  const { group, status } = phase
  const when = useLocalTime(group.scheduledStart)
  const hydrated = useHydrated()
  const minted = group.maxSupply - phase.remainingSupply
  const fill = group.maxSupply > 0 ? Math.min(100, (minted / group.maxSupply) * 100) : 0
  const badge = BADGE[status]
  const symbol = page.chain.nativeSymbol

  return (
```

In `apps/web/src/components/mint/phase-list.tsx`, replace:

```tsx
        <StatusBadge status={badge.status}>{badge.label}</StatusBadge>
      </div>

      <dl className="mt-2.5 grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1 text-[0.8125rem]">
```

with:

```tsx
        <StatusBadge status={badge.status}>{badge.label}</StatusBadge>
      </div>

      {group.description && (
        <p className="mt-1.5 text-[0.8125rem] leading-snug whitespace-pre-line text-muted-foreground">
          {group.description}
        </p>
      )}

      <dl className="mt-2.5 grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1 text-[0.8125rem]">
```

In `apps/web/src/components/mint/phase-list.tsx`, replace:

```tsx
      )}

      {wallet && group.kind === 'whitelist' && phase.wallet && (
        <p
          className={cn(
```

with:

```tsx
      )}

      {walletAddress && group.kind === 'whitelist' && phase.wallet && (
        <p
          className={cn(
```

In `apps/web/src/components/mint/phase-list.tsx`, replace:

```tsx
        </p>
      )}
      {wallet &&
        group.kind === 'public' &&
        phase.wallet &&
```

with:

```tsx
        </p>
      )}
      {walletAddress &&
        group.kind === 'public' &&
        phase.wallet &&
```

In `apps/web/src/components/mint/sticky-mint-bar.tsx`, replace:

```tsx
 */
export function StickyMintBar() {
  const { phase, action, data, soldOut, minted, quantity, setQuantity, maxQuantity } = useMint()
  const reduce = useReducedMotion()
  const [panelVisible, setPanelVisible] = useState(true)
```

with:

```tsx
 */
export function StickyMintBar() {
  const { phase, action, page, live, track, soldOut, minted, quantity, setQuantity, maxQuantity } = useMint()
  const reduce = useReducedMotion()
  const [panelVisible, setPanelVisible] = useState(true)
```

In `apps/web/src/components/mint/sticky-mint-bar.tsx`, replace:

```tsx
  }, [])

  const show = !panelVisible && !soldOut
  // The stepper lives in the bar too, so a collector never scrolls back up to change the quantity.
  const canPickQuantity = action.kind === 'mint' && maxQuantity > 1
  const symbol = data.collection.chain.nativeSymbol
  const amount =
    action.kind === 'mint'
```

with:

```tsx
  }, [])

  const show = !panelVisible && !soldOut && !track.final
  // The stepper lives in the bar too, so a collector never scrolls back up to change the quantity.
  const canPickQuantity = action.kind === 'mint' && maxQuantity > 1
  const symbol = page.chain.nativeSymbol
  const amount =
    action.kind === 'mint'
```

In `apps/web/src/components/mint/sticky-mint-bar.tsx`, replace:

```tsx
            <div className={canPickQuantity ? 'hidden min-w-0 shrink-0 sm:block' : 'min-w-0 shrink-0'}>
              <p className="truncate text-[0.8125rem] text-muted-foreground">
                {phase ? phase.group.name : data.collection.name}
              </p>
              <p className="numeric text-base font-medium">
                {amount ?? `${minted.toLocaleString('en-US')} / ${data.supply.max.toLocaleString('en-US')}`}
              </p>
            </div>
```

with:

```tsx
            <div className={canPickQuantity ? 'hidden min-w-0 shrink-0 sm:block' : 'min-w-0 shrink-0'}>
              <p className="truncate text-[0.8125rem] text-muted-foreground">
                {phase ? phase.group.name : page.name}
              </p>
              <p className="numeric text-base font-medium">
                {amount ??
                  (live
                    ? `${minted.toLocaleString('en-US')} / ${live.supply.max.toLocaleString('en-US')}`
                    : 'Reading the chain')}
              </p>
            </div>
```

In `apps/web/src/components/mint/wallet-button.tsx`, replace:

```tsx
 */
export function WalletButton() {
  const { wallet, sampleWallet, wrongChain, data } = useMint()

  if (sampleWallet && wallet) {
    return (
      <div className={pill + ' cursor-default hover:bg-surface-2'}>
        <ChainIcon chainId={data.collection.chain.id} className="size-4 text-muted-foreground" />
        <span className="sr-only">
          {wrongChain ? 'On another network, ' : `On ${data.collection.chain.name}, `}
        </span>
        <span className="numeric text-[0.8125rem]">{shortAddress(wallet.address)}</span>
      </div>
    )
```

with:

```tsx
 */
export function WalletButton() {
  const { walletAddress, sampleWallet, wrongChain, page } = useMint()

  if (sampleWallet && walletAddress) {
    return (
      <div className={pill + ' cursor-default hover:bg-surface-2'}>
        <ChainIcon chainId={page.chain.id} className="size-4 text-muted-foreground" />
        <span className="sr-only">{wrongChain ? 'On another network, ' : `On ${page.chain.name}, `}</span>
        <span className="numeric text-[0.8125rem]">{shortAddress(walletAddress)}</span>
      </div>
    )
```

In `apps/web/src/components/mint/wallet-button.tsx`, replace:

```tsx
          )
        }
        if (chain?.unsupported || chain?.id !== data.collection.chain.id) {
          return (
            <button type="button" onClick={openChainModal} className={pill}>
```

with:

```tsx
          )
        }
        if (chain?.unsupported || chain?.id !== page.chain.id) {
          return (
            <button type="button" onClick={openChainModal} className={pill}>
```

In `apps/web/src/components/mint/wallet-button.tsx`, replace:

```tsx
        return (
          <button type="button" onClick={openAccountModal} className={pill}>
            <ChainIcon chainId={data.collection.chain.id} className="size-4 text-muted-foreground" />
            <span className="sr-only">On {data.collection.chain.name}, </span>
            <span className="numeric text-[0.8125rem]">{shortAddress(account.address)}</span>
            <ChevronDownIcon aria-hidden="true" className="size-4 text-muted-foreground" />
```

with:

```tsx
        return (
          <button type="button" onClick={openAccountModal} className={pill}>
            <ChainIcon chainId={page.chain.id} className="size-4 text-muted-foreground" />
            <span className="sr-only">On {page.chain.name}, </span>
            <span className="numeric text-[0.8125rem]">{shortAddress(account.address)}</span>
            <ChevronDownIcon aria-hidden="true" className="size-4 text-muted-foreground" />
```

- [ ] **Step 8: The route, the sample's content and the public variable**

Replace the whole of `apps/web/src/app/[slug]/page.tsx` with:

```tsx
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { MintPage } from '@/components/mint/mint-page'
import { SampleMintPage } from '@/components/mint/sample-page'
import { RESERVED_SLUGS } from '@/lib/collections'
import type { MintPageStatic } from '@/lib/mint/page-doc'
import { readMintPage } from '@/lib/mint/page-read'
import { isDemoMode } from '@/lib/steps'
import { hasSampleCollection, samplePageStatic } from './sample-data'

/*
 * A collection's public mint page, at /<slug> (docs/specs/2026-10-16-mint-page-live-data.md, section 6.4). Public:
 * no session is needed. The content is the published page's document, read on the server and cached under the
 * link's tag; the chain's state comes from the browser's polls of the freshness server, never from the HTML. A
 * link renders on its first visit and is cached for 60 s, and the Mint page tab's actions expire it. The route
 * reads no query, which would make it dynamic: sample mode's switches are read by the browser.
 */
export const revalidate = 60

/** No link is rendered at build time: each renders on its first visit. */
export function generateStaticParams(): { slug: string }[] {
  return []
}

/** The page's content at a link, or null: a reserved word, an unknown or unpublished page, a chain not listed. */
async function pageAt(slug: string): Promise<MintPageStatic | null> {
  if (RESERVED_SLUGS.includes(slug)) return null
  if (isDemoMode()) return hasSampleCollection(slug) ? samplePageStatic(slug) : null
  return readMintPage(slug)
}

export async function generateMetadata(props: PageProps<'/[slug]'>): Promise<Metadata> {
  const { slug } = await props.params
  const page = await pageAt(slug)
  if (!page) return {}
  const title = `Mint ${page.name}`
  const description = page.description.slice(0, 200)
  const images = page.bannerUrl ? [{ url: page.bannerUrl, alt: page.name }] : undefined
  return {
    title,
    description,
    openGraph: { title, description, type: 'website', images },
    twitter: { card: page.bannerUrl ? 'summary_large_image' : 'summary', title, description, images },
  }
}

export default async function Page(props: PageProps<'/[slug]'>) {
  const { slug } = await props.params
  const page = await pageAt(slug)
  if (!page) notFound()
  return isDemoMode() ? <SampleMintPage page={page} /> : <MintPage page={page} sample={null} />
}
```

Replace the whole of `apps/web/src/app/[slug]/sample-data.ts` with:

```ts
import 'server-only'
import { getAddress } from 'viem'
import { SAMPLE_PLACEHOLDER_URI } from '@/components/mint/sample-source'
import { RESERVED_SLUGS } from '@/lib/collections'
import {
  DEMO_COLLECTION,
  DEMO_DEPLOYMENT,
  DEMO_MINT_GROUPS,
  DEMO_MINT_PAGE_SECTIONS,
  DEMO_MINT_PAGE_SETTINGS,
  getChain,
} from '@/lib/demo'
import type { MintPageSections, MintPageStatic } from '@/lib/mint/page-doc'

/*
 * The sample-mode page's content (docs/specs/2026-10-16-mint-page-live-data.md, section 8), built from the
 * sample collection at any link. The query switches are the browser's: components/mint/sample-source.ts reads
 * them, so the route stays cached by link in sample mode too.
 */

/**
 * In sample mode every creator's mint page link shows the sample collection, so "View mint page"
 * in Manage drop leads somewhere. Reserved words and malformed slugs are still not found.
 */
export function hasSampleCollection(slug: string): boolean {
  if (slug === DEMO_COLLECTION.slug) return true
  return (
    /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) && !RESERVED_SLUGS.includes(slug) && !slug.startsWith('no-such')
  )
}

/** The sample's sections as the page shows them: those that are on and have content. */
function sampleSections(): MintPageSections {
  const { team, roadmap, faq, music, carousel } = DEMO_MINT_PAGE_SECTIONS
  const sections: MintPageSections = {}
  if (team.enabled && team.members.length)
    sections.team = team.members.map(({ imageUrl, ...member }) => ({ ...member, imageUrl: imageUrl || null }))
  if (roadmap.enabled && roadmap.items.length) sections.roadmap = roadmap.items
  if (faq.enabled && faq.items.length) sections.faq = faq.items
  if (music.enabled && music.url && music.fileName)
    sections.music = { url: music.url, fileName: music.fileName }
  if (carousel.enabled && carousel.items.length) sections.carousel = carousel.items
  return sections
}

/** The sample collection's page at any link. */
export function samplePageStatic(slug: string): MintPageStatic {
  const settings = DEMO_MINT_PAGE_SETTINGS
  return {
    slug,
    name: DEMO_COLLECTION.name,
    symbol: DEMO_COLLECTION.symbol,
    projectType: 'generative',
    chain: getChain(DEMO_DEPLOYMENT.chainId)!,
    contract: getAddress(DEMO_DEPLOYMENT.contractAddress),
    description: settings.description,
    bannerUrl: settings.bannerUrl,
    avatarUrl: settings.avatarUrl,
    aboutBannerUrl: null,
    socials: settings.socials,
    featuredTokenIds: settings.featuredTokenIds,
    sections: sampleSections(),
    phases: DEMO_MINT_GROUPS.map((group, position) => ({
      onchain_id: group.id,
      name: group.name,
      description: group.description ?? '',
      visible: group.visible !== false,
      position,
    })),
    placeholders: [SAMPLE_PLACEHOLDER_URI],
    gateway: 'https://ipfs.io/ipfs',
  }
}
```

In `apps/web/.env.example`, replace:

```
# it; WalletConnect QR and mobile wallets do not.
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=

# Sample-data mode. 1 opens every stage of the collection workspace and fills the screens with the
```

with:

```
# it; WalletConnect QR and mobile wallets do not.
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=

# The freshness server's origin, public: the mint page polls it from the browser. Local: http://127.0.0.1:3100
# with `pnpm --filter @cobweb/freshness dev`. Read at build time; rebuild after changing it.
NEXT_PUBLIC_FRESHNESS_URL=

# Sample-data mode. 1 opens every stage of the collection workspace and fills the screens with the
```

The simulated transaction moved into the sample source, so its old module goes:

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
git rm -q apps/web/src/components/mint/mint-transaction.ts
```

- [ ] **Step 9: Typecheck, lint and build the web app**

Run: `pnpm --filter @cobweb/web typecheck && pnpm --filter @cobweb/web lint`
Expected: no errors and no warnings.

Run: `pnpm --filter @cobweb/web build`
Expected: the build passes in sample mode (the local environment file turns sample data on) and its route list shows `● /[slug]`: the page is prerendered on its first visit and cached by link, with no query read (Decision 2).

- [ ] **Step 10: Format, run the root checks and commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
pnpm exec prettier --write apps/web/src/lib/mint/live-source.ts apps/web/src/components/mint/use-live-state.ts apps/web/src/components/mint/use-wallet-view.ts apps/web/src/components/mint/use-token-art.ts apps/web/src/components/mint/sample-source.ts apps/web/src/components/mint/sample-source.test.ts apps/web/src/components/mint/sample-page.tsx apps/web/src/components/mint/model.ts apps/web/src/components/mint/model.test.ts apps/web/src/components/mint/types.ts apps/web/src/components/mint/use-mint-flow.ts apps/web/src/components/mint/mint-context.tsx apps/web/src/components/mint/token-image.tsx apps/web/src/components/mint/art-stage.tsx apps/web/src/components/mint/collection-sections.tsx apps/web/src/components/mint/mint-flow-dialog.tsx apps/web/src/components/mint/mint-page.tsx apps/web/src/components/mint/mint-panel.tsx apps/web/src/components/mint/mint-top-bar.tsx apps/web/src/components/mint/mint-action.tsx apps/web/src/components/mint/mint-success.tsx apps/web/src/components/mint/panel-controls.tsx apps/web/src/components/mint/phase-list.tsx apps/web/src/components/mint/sticky-mint-bar.tsx apps/web/src/components/mint/wallet-button.tsx 'apps/web/src/app/[slug]/page.tsx' 'apps/web/src/app/[slug]/sample-data.ts'
pnpm typecheck && pnpm lint && pnpm test
git add apps/web/src/lib/mint/live-source.ts apps/web/src/components/mint/use-live-state.ts apps/web/src/components/mint/use-wallet-view.ts apps/web/src/components/mint/use-token-art.ts apps/web/src/components/mint/sample-source.ts apps/web/src/components/mint/sample-source.test.ts apps/web/src/components/mint/sample-page.tsx apps/web/src/components/mint/model.ts apps/web/src/components/mint/model.test.ts apps/web/src/components/mint/types.ts apps/web/src/components/mint/use-mint-flow.ts apps/web/src/components/mint/mint-context.tsx apps/web/src/components/mint/token-image.tsx apps/web/src/components/mint/art-stage.tsx apps/web/src/components/mint/collection-sections.tsx apps/web/src/components/mint/mint-flow-dialog.tsx apps/web/src/components/mint/mint-page.tsx apps/web/src/components/mint/mint-panel.tsx apps/web/src/components/mint/mint-top-bar.tsx apps/web/src/components/mint/mint-action.tsx apps/web/src/components/mint/mint-success.tsx apps/web/src/components/mint/panel-controls.tsx apps/web/src/components/mint/phase-list.tsx apps/web/src/components/mint/sticky-mint-bar.tsx apps/web/src/components/mint/wallet-button.tsx 'apps/web/src/app/[slug]/page.tsx' 'apps/web/src/app/[slug]/sample-data.ts' apps/web/.env.example
git commit -m "$(cat <<'EOF'
Put the mint page on live data: the model on the freshness server's answers, the live and sample sources, the hooks, the mint through its simulation with the receipt's ids and the local mints, the components, and the route cached by link

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: the web app reports 775 tests in 84 files; the other packages are unchanged.

---

### Task 6: The sections, Remind me, the music button, the owner's preview and the rarity spot

**Files:**

- Create: `apps/web/src/lib/mint/remind.ts`, `remind.test.ts`, `live-source.test.ts`, `apps/web/src/components/mint/remind-me.tsx`, `page-sections.tsx`, `music-button.tsx`, `preview-banner.tsx`, `apps/web/src/app/[slug]/preview/page.tsx`
- Modify: `apps/web/src/lib/mint/live-source.ts` (whole file: the tiers), `page-read.ts` (the preview's answer), `apps/web/src/components/mint/sample-source.ts` (the sample's tiers), `mint-success.tsx`, `mint-context.tsx`, `mint-page.tsx`, `mint-panel.tsx`, `mint-top-bar.tsx`, `phase-list.tsx`
- Test: `remind.test.ts`, `live-source.test.ts`

**Interfaces:**

- Consumes: Task 5's `MintSource`, `useMint`, `Phase`, `TokenArtFrame` and the sample source; Task 2's `readMintPagePreview`, `MintPageSections` and `pageDocSchema`; Task 1's `mint_page_tiers`; `getSessionUser` (`lib/auth.ts`); `TierDot` (`components/art/generate/rarity.tsx`) with `rarityTier` and `TIER_RANGES` (`components/art/state/token-logic.ts`), Generate's tiers; `manageTabHref` (`lib/steps.ts`); shadcn's `DropdownMenu`, `Accordion`, `Tooltip` and the `Artwork` pattern.
- Produces:
  - `lib/mint/remind.ts`: `Reminder = { collection; phase; chainId; contract; groupId; start; url }`, `REMINDER_SECONDS = 30 * 60`, `REMINDER_SENTENCE`, `calendarTime(seconds: number): string`, `icsOf(reminder: Reminder, stampSeconds: number): string` (one `VEVENT`, CRLF lines folded at 75 octets, text escaped, `UID:<chain id>-<contract>-<group id>-<start>@cobweb`), `googleCalendarUrl(reminder: Reminder): string`, `icsFileName(slug: string, groupId: number): string` (`<slug>-phase-<id>.ics`)
  - `lib/mint/live-source.ts`: `Tiers = { total: number; ranks: Record<number, number> }`; `MintSource` gains `tiers(baseUri: string, ids: number[]): Promise<Tiers | null>`, through `mint_page_tiers` for the first 20 ids, null on any failure
  - `lib/mint/page-read.ts`: `readMintPagePreview(slug)` answers `(MintPageStatic & { published: boolean; collectionId: string }) | null`, null for a signed-out visitor before any read (Decision 8)
  - components: `RemindMe({ phase, className })` (under the countdown and on scheduled rows), `PageSections({ page })` (Roadmap, Team and FAQ after About and Details, each only when on and not empty), `MusicButton({ music, artwork, title })` (in the top bar, never playing on load), `PreviewBanner({ published, tabHref })`; the success view's tier chips, "Rarity shows after the reveal", or "#<id> of <supply>" for a single asset and a 1/1
  - `app/[slug]/preview/page.tsx`: dynamic and `noindex`; the owner's page under the preview banner, the not-found page for anyone else; in sample mode, the sample under the banner

- [ ] **Step 1: Write the failing tests**

`live-source.test.ts` pins Review Focus 5.

Create `apps/web/src/lib/mint/remind.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { calendarTime, googleCalendarUrl, icsFileName, icsOf, type Reminder } from './remind'

const reminder: Reminder = {
  collection: 'Night Owls, Vol. 1; the "first" run',
  phase: 'Public',
  chainId: 8453,
  contract: '0x4f2A9C7E1B3d5F6A8C0E2b4D6f8A1C3e5B7D9f0a',
  groupId: 0,
  start: 1_791_212_400,
  url: 'https://cobweb.app/night-owls',
}

describe('icsOf (docs/specs/2026-10-16-mint-page-live-data.md, section 7.8)', () => {
  const ics = icsOf(reminder, 1_791_039_600)
  const lines = ics.split('\r\n')

  it('writes one event at the start in UTC for 30 minutes, with CRLF lines and the UID', () => {
    expect(ics.endsWith('\r\n')).toBe(true)
    expect(ics.replace(/\r\n/g, '')).not.toContain('\n')
    expect(lines).toContain('DTSTART:20261005T150000Z')
    expect(lines).toContain('DTEND:20261005T153000Z')
    expect(lines).toContain('DTSTAMP:20261003T150000Z')
    expect(lines).toContain('UID:8453-0x4f2a9c7e1b3d5f6a8c0e2b4d6f8a1c3e5b7d9f0a-0-1791212400@cobweb')
    expect(lines.filter((line) => line === 'BEGIN:VEVENT')).toHaveLength(1)
  })

  it('escapes commas, semicolons and line breaks in the text', () => {
    const unfolded = ics.replace(/\r\n /g, '')
    expect(unfolded).toContain('SUMMARY:Night Owls\\, Vol. 1\\; the "first" run: Public opens')
    expect(unfolded).toContain(
      'DESCRIPTION:Minting opens when the chain reaches this time.\\nhttps://cobweb.app/night-owls',
    )
  })

  it('folds lines over 75 octets, the continuation starting with a space, never inside a character', () => {
    const long = icsOf({ ...reminder, collection: 'Ö'.repeat(60) }, 0).split('\r\n')
    for (const line of long) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
    const summary = long.findIndex((line) => line.startsWith('SUMMARY:'))
    expect(long[summary + 1]?.startsWith(' ')).toBe(true)
    expect(long.join('\r\n').replace(/\r\n /g, '')).toContain(`SUMMARY:${'Ö'.repeat(60)}: Public opens`)
  })

  it('names the file after the link and the phase', () => {
    expect(icsFileName('night-owls', 2)).toBe('night-owls-phase-2.ics')
  })
})

describe('googleCalendarUrl', () => {
  it("fills the event's dates as start/end and its text, encoded", () => {
    const url = new URL(googleCalendarUrl(reminder))
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render')
    expect(url.searchParams.get('action')).toBe('TEMPLATE')
    expect(url.searchParams.get('dates')).toBe('20261005T150000Z/20261005T153000Z')
    expect(url.searchParams.get('text')).toBe('Night Owls, Vol. 1; the "first" run: Public opens')
    expect(url.searchParams.get('details')).toBe(
      'Minting opens when the chain reaches this time.\nhttps://cobweb.app/night-owls',
    )
    expect(googleCalendarUrl(reminder)).not.toContain(' ')
    expect(calendarTime(0)).toBe('19700101T000000Z')
  })
})
```

Create `apps/web/src/lib/mint/live-source.test.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Address } from 'viem'
import { describe, expect, it, vi } from 'vitest'
import type { Database } from '@/lib/database.types'
import { liveMintSource, type Tiers } from './live-source'
import type { MintChain } from './mint-run'
import type { MintPageStatic } from './page-doc'

const COLLECTION: Address = '0x0409454C375c8a6aB05383bFB6D9FcDe9ebB8F85'
const REAL = 'ipfs://bafybeireal/'

const page: MintPageStatic = {
  slug: 'night-owls',
  name: 'Night Owls',
  symbol: 'OWLS',
  projectType: 'generative',
  chain: { id: 31337, name: 'Anvil', nativeSymbol: 'ETH', explorerUrl: '', transferLock: false },
  contract: COLLECTION,
  description: '',
  bannerUrl: null,
  avatarUrl: null,
  aboutBannerUrl: null,
  socials: {},
  featuredTokenIds: [],
  sections: {},
  phases: [],
  placeholders: [],
  gateway: 'https://ipfs.io/ipfs',
}

/** A Supabase client whose `rpc` answers `data`, recording what it was asked. */
function fakeSupabase(data: unknown) {
  const rpc = vi.fn(async () => ({ data, error: null }))
  return { supabase: { rpc } as unknown as SupabaseClient<Database>, rpc }
}

const chain: MintChain = {
  simulate: async () => async () => '0x',
  receipt: async () => {
    throw new Error('not used')
  },
}

describe('liveMintSource tiers (docs/specs/2026-10-16-mint-page-live-data.md, section 7.7)', () => {
  it('asks for the first 20 ids of a larger mint, which the function answers, never 21 (Review Focus 5)', async () => {
    const { supabase, rpc } = fakeSupabase({ total: 500, ranks: { '1': 12, '2': 480 } })
    const source = liveMintSource(page, { freshnessUrl: 'https://fresh.example', chain, supabase })
    const ids = Array.from({ length: 25 }, (_, index) => index + 1)
    await expect(source.tiers(REAL, ids)).resolves.toEqual<Tiers>({ total: 500, ranks: { 1: 12, 2: 480 } })
    expect(rpc).toHaveBeenCalledWith('mint_page_tiers', {
      p_slug: 'night-owls',
      p_base_uri: REAL,
      p_ids: ids.slice(0, 20),
    })
  })

  it('answers null for no ranks, an answer of another shape, an error and a throw', async () => {
    const source = (supabase: SupabaseClient<Database>) =>
      liveMintSource(page, { freshnessUrl: undefined, chain, supabase })
    expect(await source(fakeSupabase(null).supabase).tiers(REAL, [1])).toBeNull()
    expect(await source(fakeSupabase({ ranks: {} }).supabase).tiers(REAL, [1])).toBeNull()
    const failing = { rpc: async () => ({ data: null, error: { message: 'no' } }) }
    expect(await source(failing as unknown as SupabaseClient<Database>).tiers(REAL, [1])).toBeNull()
    const throwing = {
      rpc: async () => {
        throw new Error('offline')
      },
    }
    expect(await source(throwing as unknown as SupabaseClient<Database>).tiers(REAL, [1])).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @cobweb/web exec vitest run src/lib/mint/remind.test.ts src/lib/mint/live-source.test.ts`
Expected: FAIL. `remind.test.ts` fails to load (`Cannot find module './remind'`) and both cases of `live-source.test.ts` fail with `TypeError: source.tiers is not a function`: `Test Files  2 failed (2)` and `Tests  2 failed (2)`.

- [ ] **Step 3: Remind me**

Create `apps/web/src/lib/mint/remind.ts`:

```ts
import type { Address } from 'viem'

/**
 * "Remind me" for a scheduled phase (docs/specs/2026-10-16-mint-page-live-data.md, decision 25 and section 7.8),
 * pure: one calendar event at the group's start on the chain, in UTC, for 30 minutes, as an `.ics` file built in
 * the browser and as a Google Calendar link. Nothing is stored.
 */
export type Reminder = {
  collection: string
  phase: string
  chainId: number
  contract: Address
  groupId: number
  /** The group's `startTimestamp`, Unix seconds. */
  start: number
  /** The page's link. */
  url: string
}

/** How long the event lasts. */
export const REMINDER_SECONDS = 30 * 60
export const REMINDER_SENTENCE = 'Minting opens when the chain reaches this time.'

/** A time as iCalendar and Google write it in UTC: `YYYYMMDDTHHMMSSZ`. */
export function calendarTime(seconds: number): string {
  return new Date(seconds * 1_000)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')
}

const titleOf = (reminder: Reminder) => `${reminder.collection}: ${reminder.phase} opens`

/** Text as iCalendar escapes it: backslashes, semicolons, commas and line breaks. */
function escapeText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

/** A content line folded at 75 octets, the continuation lines starting with a space, never inside a character. */
function fold(line: string): string {
  const encoder = new TextEncoder()
  const parts: string[] = []
  let current = ''
  let size = 0
  for (const character of line) {
    const bytes = encoder.encode(character).length
    const limit = parts.length === 0 ? 75 : 74
    if (size + bytes > limit) {
      parts.push(current)
      current = ''
      size = 0
    }
    current += character
    size += bytes
  }
  parts.push(current)
  return parts.join('\r\n ')
}

/** The `.ics` file of one reminder; `stampSeconds` dates the file (the browser's clock). */
export function icsOf(reminder: Reminder, stampSeconds: number): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Cobweb//Mint page//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${reminder.chainId}-${reminder.contract.toLowerCase()}-${reminder.groupId}-${reminder.start}@cobweb`,
    `DTSTAMP:${calendarTime(stampSeconds)}`,
    `DTSTART:${calendarTime(reminder.start)}`,
    `DTEND:${calendarTime(reminder.start + REMINDER_SECONDS)}`,
    `SUMMARY:${escapeText(titleOf(reminder))}`,
    `DESCRIPTION:${escapeText(`${REMINDER_SENTENCE}\n${reminder.url}`)}`,
    `URL:${reminder.url}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return `${lines.map(fold).join('\r\n')}\r\n`
}

/** The Google Calendar link that fills in the same event. */
export function googleCalendarUrl(reminder: Reminder): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: titleOf(reminder),
    dates: `${calendarTime(reminder.start)}/${calendarTime(reminder.start + REMINDER_SECONDS)}`,
    details: `${REMINDER_SENTENCE}\n${reminder.url}`,
  })
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

/** The file name the reminder is saved as. */
export const icsFileName = (slug: string, groupId: number) => `${slug}-phase-${groupId}.ics`
```

Create `apps/web/src/components/mint/remind-me.tsx`:

```tsx
'use client'

import { BellIcon, CalendarPlusIcon, DownloadIcon } from 'lucide-react'
import { Button } from '@cobweb/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@cobweb/ui/components/dropdown-menu'
import { cn } from '@cobweb/ui/lib/utils'
import { googleCalendarUrl, icsFileName, icsOf, type Reminder } from '@/lib/mint/remind'
import { useMint } from './mint-context'
import type { Phase } from './model'

/**
 * "Remind me" for a phase scheduled ahead on the chain clock (docs/specs/2026-10-16-mint-page-live-data.md,
 * decision 25): a Google Calendar link and a calendar file built in the browser, at the group's start in UTC.
 * Nothing is stored.
 */
export function RemindMe({ phase, className }: { phase: Phase; className?: string }) {
  const { page } = useMint()
  if (phase.status !== 'scheduled' || phase.group.scheduledStart <= 0) return null
  const reminder = (): Reminder => ({
    collection: page.name,
    phase: phase.group.name,
    chainId: page.chain.id,
    contract: page.contract,
    groupId: phase.group.id,
    start: phase.group.scheduledStart,
    url: `${window.location.origin}/${page.slug}`,
  })
  const download = () => {
    const file = new Blob([icsOf(reminder(), Math.floor(Date.now() / 1_000))], { type: 'text/calendar' })
    const url = URL.createObjectURL(file)
    const link = document.createElement('a')
    link.href = url
    link.download = icsFileName(page.slug, phase.group.id)
    link.click()
    URL.revokeObjectURL(url)
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className={cn('w-fit', className)}>
          <BellIcon />
          Remind me
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem asChild>
          <a href={googleCalendarUrl(reminder())} target="_blank" rel="noreferrer">
            <CalendarPlusIcon />
            Google Calendar
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={download}>
          <DownloadIcon />
          Download a calendar file
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
```

- [ ] **Step 4: The tiers**

Replace the whole of `apps/web/src/lib/mint/live-source.ts` with:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Address } from 'viem'
import type { Database } from '@/lib/database.types'
import { pollState, pollWallet, type StatePoll, type WalletPoll } from './fresh-client'
import type { MintChain } from './mint-run'
import type { MintPageStatic } from './page-doc'
import { tokenArtOf, type TokenArt } from './token-art'

/**
 * Where the mint page reads and mints (docs/specs/2026-10-16-mint-page-live-data.md, decision 27): the state and
 * wallet polls, the chain the mint is checked, sent and confirmed on, the rarity ranks of minted tokens and token
 * art. The components see only the source: the live one on the freshness server, wagmi, Supabase and the IPFS
 * gateway, or the sample one on `lib/demo` (components/mint/sample-source.ts).
 */

/** Minted tokens' ranks at the revealed base URI, with the set's size. */
export type Tiers = { total: number; ranks: Record<number, number> }

export type MintSource = {
  pollState(): Promise<StatePoll>
  pollWallet(wallet: Address): Promise<WalletPoll>
  chain: MintChain
  /** Up to 20 ids' ranks; null before the reveal, without ranks, or when the read fails. */
  tiers(baseUri: string, ids: number[]): Promise<Tiers | null>
  tokenArt(baseUri: string, id: number): Promise<TokenArt | null>
}

/** The tiers read's answer, or null for anything else. */
function tiersOf(data: unknown): Tiers | null {
  const shaped = data as { total?: unknown; ranks?: unknown } | null
  if (!shaped || typeof shaped.total !== 'number' || !shaped.ranks || typeof shaped.ranks !== 'object')
    return null
  const ranks: Record<number, number> = {}
  for (const [id, rank] of Object.entries(shaped.ranks))
    if (typeof rank === 'number' && Number.isInteger(Number(id))) ranks[Number(id)] = rank
  return { total: shaped.total, ranks }
}

/**
 * The live source: polls the freshness server at `freshnessUrl`, mints through `chain`, reads the tiers through
 * `public.mint_page_tiers` and the art through the page's gateway.
 */
export function liveMintSource(
  page: MintPageStatic,
  deps: {
    freshnessUrl: string | undefined
    chain: MintChain
    supabase: SupabaseClient<Database>
    fetchImpl?: typeof fetch
  },
): MintSource {
  const fetchImpl = deps.fetchImpl ?? fetch
  return {
    pollState: () => pollState(deps.freshnessUrl, page.chain.id, page.contract, fetchImpl),
    pollWallet: (wallet) => pollWallet(deps.freshnessUrl, page.chain.id, page.contract, wallet, fetchImpl),
    chain: deps.chain,
    async tiers(baseUri, ids) {
      try {
        const { data, error } = await deps.supabase.rpc('mint_page_tiers', {
          p_slug: page.slug,
          p_base_uri: baseUri,
          p_ids: ids.slice(0, 20),
        })
        return error ? null : tiersOf(data)
      } catch {
        return null
      }
    },
    tokenArt: (baseUri, id) => tokenArtOf(baseUri, id, page.gateway, fetchImpl),
  }
}
```

In `apps/web/src/components/mint/sample-source.ts`, replace:

```ts
    chain,

    async tokenArt(baseUri, id) {
      if (baseUri === SAMPLE_PLACEHOLDER_URI) return { layers: [DEMO_PLACEHOLDER.imageUrl], video: false }
```

with:

```ts
    chain,

    async tiers(baseUri, ids) {
      if (baseUri !== SAMPLE_REVEALED_URI) return null
      const ranks: Record<number, number> = {}
      for (const id of ids.slice(0, 20)) {
        const token = DEMO_TOKENS[id - 1]
        if (token) ranks[id] = token.rank
      }
      return { total: DEMO_TOKENS.length, ranks }
    },

    async tokenArt(baseUri, id) {
      if (baseUri === SAMPLE_PLACEHOLDER_URI) return { layers: [DEMO_PLACEHOLDER.imageUrl], video: false }
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `pnpm --filter @cobweb/web exec vitest run src/lib/mint/remind.test.ts src/lib/mint/live-source.test.ts`
Expected: PASS, `Test Files  2 passed (2)` and `Tests  7 passed (7)`.

- [ ] **Step 6: The sections, the music button and the preview banner**

Create `apps/web/src/components/mint/page-sections.tsx`:

```tsx
import { AtSignIcon, MessageCircleIcon, SendIcon } from 'lucide-react'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@cobweb/ui/components/accordion'
import { Artwork } from '@cobweb/ui/components/artwork'
import { Button } from '@cobweb/ui/components/button'
import type { MintPageStatic, PageMember } from '@/lib/mint/page-doc'

/**
 * The page's own sections (docs/specs/2026-10-16-mint-page-live-data.md, section 7.8), after About and Details,
 * in this order and each only when it is on and has content: Roadmap, Team and FAQ. Text is plain and keeps its
 * line breaks; links are https and open in a new tab.
 */
export function PageSections({ page }: { page: MintPageStatic }) {
  const { roadmap, team, faq } = page.sections
  if (!roadmap && !team && !faq) return null
  return (
    <div className="mx-auto mt-20 grid max-w-[90rem] gap-20 px-4 sm:px-8 lg:mt-28">
      {roadmap && <Roadmap items={roadmap} />}
      {team && <Team members={team} name={page.name} />}
      {faq && <Faq items={faq} />}
    </div>
  )
}

function Roadmap({ items }: { items: NonNullable<MintPageStatic['sections']['roadmap']> }) {
  return (
    <section aria-labelledby="roadmap-title">
      <h2 id="roadmap-title" className="text-title">
        Roadmap
      </h2>
      <ol className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <li key={item.id} className="rounded-xl border bg-card p-5 shadow-raised">
            <p className="numeric text-[0.8125rem] text-muted-foreground">{item.date}</p>
            <p className="mt-1 text-base font-semibold">{item.title}</p>
            {item.description && (
              <p className="mt-2 text-sm leading-relaxed whitespace-pre-line text-foreground/85">
                {item.description}
              </p>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}

const MEMBER_LINKS = [
  { key: 'x', label: 'X', Icon: AtSignIcon },
  { key: 'discord', label: 'Discord', Icon: MessageCircleIcon },
  { key: 'telegram', label: 'Telegram', Icon: SendIcon },
] as const

function Team({ members, name }: { members: PageMember[]; name: string }) {
  return (
    <section aria-labelledby="team-title">
      <h2 id="team-title" className="text-title">
        Team
      </h2>
      <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {members.map((member) => (
          <li key={member.id} className="rounded-xl border bg-card p-5 shadow-raised">
            <Artwork
              src={member.imageUrl}
              alt={member.name}
              seed={`${name}-${member.id}`}
              className="size-20 rounded-xl border"
            />
            <p className="mt-4 text-base font-semibold">{member.name}</p>
            <p className="text-[0.8125rem] text-muted-foreground">{member.role}</p>
            {member.bio && (
              <p className="mt-3 text-sm leading-relaxed whitespace-pre-line text-foreground/85">
                {member.bio}
              </p>
            )}
            <div className="mt-3 flex gap-1">
              {MEMBER_LINKS.filter(({ key }) => member[key]?.startsWith('https://')).map(
                ({ key, label, Icon }) => (
                  <Button key={key} asChild variant="ghost" size="icon-sm">
                    <a
                      href={member[key]}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`${member.name} on ${label}`}
                    >
                      <Icon />
                    </a>
                  </Button>
                ),
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Faq({ items }: { items: NonNullable<MintPageStatic['sections']['faq']> }) {
  return (
    <section aria-labelledby="faq-title" className="max-w-3xl">
      <h2 id="faq-title" className="text-title">
        Questions
      </h2>
      <Accordion type="single" collapsible className="mt-4">
        {items.map((item) => (
          <AccordionItem key={item.id} value={item.id}>
            <AccordionTrigger>{item.question}</AccordionTrigger>
            <AccordionContent className="text-sm leading-relaxed whitespace-pre-line text-foreground/85">
              {item.answer}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  )
}
```

Create `apps/web/src/components/mint/music-button.tsx`:

```tsx
'use client'

import { MusicIcon, PauseIcon } from 'lucide-react'
import { useRef, useState } from 'react'
import { Button } from '@cobweb/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@cobweb/ui/components/tooltip'

/**
 * The page's track, in the top bar (docs/specs/2026-10-16-mint-page-live-data.md, section 7.8): play and pause,
 * never playing on load, looping once started, with the avatar as its cover in the system's media controls.
 */
export function MusicButton({
  music,
  artwork,
  title,
}: {
  music: { url: string; fileName: string }
  artwork: string | null
  title: string
}) {
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const toggle = () => {
    const element = audio.current
    if (!element) return
    if (!element.paused) return element.pause()
    if ('mediaSession' in navigator)
      navigator.mediaSession.metadata = new MediaMetadata({
        title: music.fileName,
        artist: title,
        artwork: artwork ? [{ src: artwork }] : [],
      })
    void element.play().catch(() => setPlaying(false))
  }
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={playing ? 'Pause music' : 'Play music'}
            aria-pressed={playing}
            onClick={toggle}
          >
            {playing ? <PauseIcon /> : <MusicIcon />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{music.fileName}</TooltipContent>
      </Tooltip>
      <audio
        ref={audio}
        src={music.url}
        preload="none"
        loop
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />
    </>
  )
}
```

Create `apps/web/src/components/mint/preview-banner.tsx`:

```tsx
import { ArrowUpRightIcon, EyeIcon } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@cobweb/ui/components/button'

/** Above the owner's preview: who can see it, and the way back to the Mint page tab. */
export function PreviewBanner({ published, tabHref }: { published: boolean; tabHref: string }) {
  return (
    <div role="note" className="border-b border-primary-line bg-primary-soft">
      <div className="mx-auto flex max-w-[90rem] flex-wrap items-center justify-between gap-3 px-4 py-2.5 sm:px-8">
        <p className="flex items-center gap-2 text-[0.8125rem]">
          <EyeIcon aria-hidden="true" className="size-4 shrink-0 text-primary" />
          {published
            ? 'Preview of your public page.'
            : 'Preview. Only you can see this page; it is not public yet.'}
        </p>
        <Button asChild variant="ghost" size="sm">
          <Link href={tabHref}>
            Edit in the Mint page tab
            <ArrowUpRightIcon aria-hidden="true" />
          </Link>
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 7: The rarity spot and the page's wiring**

In `apps/web/src/components/mint/mint-success.tsx`, replace:

```tsx
'use client'

import { ExternalLinkIcon, Share2Icon } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { toast } from 'sonner'
import { Button } from '@cobweb/ui/components/button'
import { EASE_OUT } from '@cobweb/ui/lib/motion'
import { cn } from '@cobweb/ui/lib/utils'
import { explorerTxUrl } from '@/lib/demo/helpers'
import { useMint } from './mint-context'
import { TokenArtFrame } from './token-image'
import { useTokenArt } from './use-token-art'

/**
 * The peak of the page: the minted tokens are revealed one after another, a curtain lifting off
 * each. Ids, the transaction, a share action, and "Mint more" when the wallet still has room.
 */
export function MintSuccess() {
```

with:

```tsx
'use client'

import { useQuery } from '@tanstack/react-query'
import { ExternalLinkIcon, Share2Icon } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { toast } from 'sonner'
import { Button } from '@cobweb/ui/components/button'
import { EASE_OUT } from '@cobweb/ui/lib/motion'
import { cn } from '@cobweb/ui/lib/utils'
import { TierDot } from '@/components/art/generate/rarity'
import { rarityTier, TIER_RANGES } from '@/components/art/state/token-logic'
import { explorerTxUrl } from '@/lib/demo/helpers'
import { useMint } from './mint-context'
import { TokenArtFrame } from './token-image'
import { useTokenArt } from './use-token-art'

/** A minted token's rarity tier, its range as the title (docs/specs/2026-10-16-mint-page-live-data.md, section 7.7). */
function TierChip({ rank, total }: { rank: number; total: number }) {
  const tier = rarityTier(rank, total)
  return (
    <span
      title={`${TIER_RANGES[tier.key]} by rarity`}
      className="inline-flex h-6 items-center gap-1.5 rounded-full border bg-surface-2 px-2 text-xs font-medium"
    >
      <TierDot tier={tier.key} />
      {tier.label}
    </span>
  )
}

/**
 * The peak of the page: the minted tokens are revealed one after another, a curtain lifting off each, with their
 * rarity tier once the collection is revealed (or their number of the supply where every token shares its art).
 * Ids, the transaction, a share action, and "Mint more" when the wallet still has room.
 */
export function MintSuccess() {
```

In `apps/web/src/components/mint/mint-success.tsx`, replace:

```tsx
  // Each minted token's art at the state's base URI: the placeholder's image before the reveal.
  const art = useTokenArt(source, live?.baseUri ?? null, ids)
  if (flow.step !== 'success') return null
  const chain = page.chain
  const name = page.name
```

with:

```tsx
  // Each minted token's art at the state's base URI: the placeholder's image before the reveal.
  const art = useTokenArt(source, live?.baseUri ?? null, ids)
  const generative = page.projectType === 'generative'
  const revealed = !!live?.revealed
  // Asked once per mint, for the first 20 ids; a failure shows nothing.
  const tiers = useQuery({
    queryKey: ['mint-tiers', flow.step === 'success' ? flow.hash : null],
    queryFn: () => source.tiers(live?.baseUri ?? '', ids.slice(0, 20)),
    enabled: flow.step === 'success' && generative && revealed && ids.length > 0,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  })
  if (flow.step !== 'success') return null
  const supply = live?.supply.max ?? 0
  const chain = page.chain
  const name = page.name
```

In `apps/web/src/components/mint/mint-success.tsx`, replace:

```tsx
                <span className="numeric font-medium">#{id}</span>
              </p>
            </motion.li>
          ))}
        </ul>
      </div>

```

with:

```tsx
                <span className="numeric font-medium">#{id}</span>
              </p>
              {generative && tiers.data?.ranks[id] !== undefined && (
                <p className="mt-1.5 flex justify-center">
                  <TierChip rank={tiers.data.ranks[id]} total={tiers.data.total} />
                </p>
              )}
              {!generative && supply > 0 && (
                <p className="numeric mt-1 text-center text-xs text-muted-foreground">
                  #{id} of {supply.toLocaleString('en-US')}
                </p>
              )}
            </motion.li>
          ))}
        </ul>
        {generative && !revealed && (
          <p className="mt-4 text-center text-[0.8125rem] text-muted-foreground">
            Rarity shows after the reveal
          </p>
        )}
      </div>

```

In `apps/web/src/components/mint/mint-context.tsx`, replace:

```tsx
import type { MintPageStatic } from '@/lib/mint/page-doc'
import { wagmiMintChain } from '@/lib/mint/wagmi-chain'
import {
  defaultPhaseId,
```

with:

```tsx
import type { MintPageStatic } from '@/lib/mint/page-doc'
import { wagmiMintChain } from '@/lib/mint/wagmi-chain'
import { createClient } from '@/lib/supabase/client'
import {
  defaultPhaseId,
```

In `apps/web/src/components/mint/mint-context.tsx`, replace:

```tsx
            freshnessUrl: process.env.NEXT_PUBLIC_FRESHNESS_URL,
            chain: wagmiMintChain(config),
          }),
    [page, sample, config],
```

with:

```tsx
            freshnessUrl: process.env.NEXT_PUBLIC_FRESHNESS_URL,
            chain: wagmiMintChain(config),
            supabase: createClient(),
          }),
    [page, sample, config],
```

In `apps/web/src/components/mint/mint-page.tsx`, replace:

```tsx
import { MintPanel } from './mint-panel'
import { DegradedBanner, MintTopBar } from './mint-top-bar'
import { PhaseList } from './phase-list'
import { StickyMintBar } from './sticky-mint-bar'
```

with:

```tsx
import { MintPanel } from './mint-panel'
import { DegradedBanner, MintTopBar } from './mint-top-bar'
import { PageSections } from './page-sections'
import { PhaseList } from './phase-list'
import { StickyMintBar } from './sticky-mint-bar'
```

In `apps/web/src/components/mint/mint-page.tsx`, replace:

```tsx
        </div>

        <MintFooter />
        <StickyMintBar />
```

with:

```tsx
        </div>

        <PageSections page={page} />

        <MintFooter />
        <StickyMintBar />
```

In `apps/web/src/components/mint/mint-panel.tsx`, replace:

```tsx
import { MintButton, MintHint } from './mint-action'
import { useMint } from './mint-context'
import { Eligibility, PhasePicker, PriceBreakdown, QuantityStepper, VaultPicker } from './panel-controls'
import { useHydrated, useLocalTime } from './use-chain-clock'
```

with:

```tsx
import { MintButton, MintHint } from './mint-action'
import { useMint } from './mint-context'
import { RemindMe } from './remind-me'
import { Eligibility, PhasePicker, PriceBreakdown, QuantityStepper, VaultPicker } from './panel-controls'
import { useHydrated, useLocalTime } from './use-chain-clock'
```

In `apps/web/src/components/mint/mint-panel.tsx`, replace:

```tsx
        {hydrated && ', your time'}
      </p>
      <p className="sr-only" role="status">
        {phase.group.name} opens {when}.
```

with:

```tsx
        {hydrated && ', your time'}
      </p>
      <RemindMe phase={phase} className="mt-3" />
      <p className="sr-only" role="status">
        {phase.group.name} opens {when}.
```

In `apps/web/src/components/mint/mint-top-bar.tsx`, replace:

```tsx
import type { MintPageStatic } from '@/lib/mint/page-doc'
import { useMint } from './mint-context'
import { WalletButton } from './wallet-button'

/** The slim bar: the collection's identity on the left, the wallet on the right. No app chrome. */
export function MintTopBar({ page }: { page: MintPageStatic }) {
  return (
```

with:

```tsx
import type { MintPageStatic } from '@/lib/mint/page-doc'
import { useMint } from './mint-context'
import { MusicButton } from './music-button'
import { WalletButton } from './wallet-button'

/** The slim bar: the collection's identity on the left, the music and the wallet on the right. No app chrome. */
export function MintTopBar({ page }: { page: MintPageStatic }) {
  return (
```

In `apps/web/src/components/mint/mint-top-bar.tsx`, replace:

```tsx
        <span className="numeric hidden text-xs text-muted-foreground sm:inline">{page.symbol}</span>
      </a>
      <WalletButton />
    </header>
  )
```

with:

```tsx
        <span className="numeric hidden text-xs text-muted-foreground sm:inline">{page.symbol}</span>
      </a>
      <div className="flex shrink-0 items-center gap-2">
        {page.sections.music && (
          <MusicButton music={page.sections.music} artwork={page.avatarUrl} title={page.name} />
        )}
        <WalletButton />
      </div>
    </header>
  )
```

In `apps/web/src/components/mint/phase-list.tsx`, replace:

```tsx
import { useMint } from './mint-context'
import { sortPhases, type Phase, type PhaseStatus } from './model'
import { useHydrated, useLocalTime } from './use-chain-clock'

```

with:

```tsx
import { useMint } from './mint-context'
import { sortPhases, type Phase, type PhaseStatus } from './model'
import { RemindMe } from './remind-me'
import { useHydrated, useLocalTime } from './use-chain-clock'

```

In `apps/web/src/components/mint/phase-list.tsx`, replace:

```tsx
        </p>
      )}
      {status === 'unscheduled' && (
        <p className="mt-2 text-[0.8125rem] text-muted-foreground">The creator has not set a start yet.</p>
```

with:

```tsx
        </p>
      )}
      {status === 'scheduled' && <RemindMe phase={phase} className="mt-2.5" />}
      {status === 'unscheduled' && (
        <p className="mt-2 text-[0.8125rem] text-muted-foreground">The creator has not set a start yet.</p>
```

- [ ] **Step 8: The owner's preview**

`readMintPagePreview` answers the collection's id for the banner's link back, and null for a signed-out visitor (Decision 8).

In `apps/web/src/lib/mint/page-read.ts`, replace:

```ts
import { createClient } from '@supabase/supabase-js'
import { unstable_cache } from 'next/cache'
import type { Database } from '@/lib/database.types'
import { createClient as createSessionClient } from '@/lib/supabase/server'
```

with:

```ts
import { createClient } from '@supabase/supabase-js'
import { unstable_cache } from 'next/cache'
import { getSessionUser } from '@/lib/auth'
import type { Database } from '@/lib/database.types'
import { createClient as createSessionClient } from '@/lib/supabase/server'
```

In `apps/web/src/lib/mint/page-read.ts`, replace:

```ts
}

/** The page at a link for its signed-in owner, published or not, or null for anyone else. Uncached. */
export async function readMintPagePreview(
  slug: string,
): Promise<(MintPageStatic & { published: boolean }) | null> {
  const supabase = await createSessionClient()
  const { data, error } = await supabase.rpc('mint_page_preview', { p_slug: linkOf(slug) })
  if (error) throw new Error(`The mint page preview could not be read: ${error.code} ${error.message}`)
  if (data === null) return null
  const page = pageOf(data)
  return page && { ...page, published: pageDocSchema.parse(data).published }
}
```

with:

```ts
}

/**
 * The page at a link for its signed-in owner, published or not, with the collection's id for the way back to the
 * Mint page tab; null for anyone else. Uncached.
 */
export async function readMintPagePreview(
  slug: string,
): Promise<(MintPageStatic & { published: boolean; collectionId: string }) | null> {
  // A signed-out visitor gets the not-found page: the function is granted to signed-in callers only.
  if (!(await getSessionUser())) return null
  const supabase = await createSessionClient()
  const link = linkOf(slug)
  const { data, error } = await supabase.rpc('mint_page_preview', { p_slug: link })
  if (error) throw new Error(`The mint page preview could not be read: ${error.code} ${error.message}`)
  if (data === null) return null
  const page = pageOf(data)
  const owned = await supabase.from('collections').select('id').eq('slug', link).maybeSingle()
  if (owned.error) throw new Error(`The collection could not be read: ${owned.error.message}`)
  if (!page || !owned.data) return null
  return { ...page, published: pageDocSchema.parse(data).published, collectionId: owned.data.id }
}
```

Create `apps/web/src/app/[slug]/preview/page.tsx`:

```tsx
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { MintPage } from '@/components/mint/mint-page'
import { PreviewBanner } from '@/components/mint/preview-banner'
import { SampleMintPage } from '@/components/mint/sample-page'
import { RESERVED_SLUGS } from '@/lib/collections'
import { readMintPagePreview } from '@/lib/mint/page-read'
import { isDemoMode, manageTabHref } from '@/lib/steps'
import { hasSampleCollection, samplePageStatic } from '../sample-data'

/*
 * The owner's preview of a mint page, at /<slug>/preview (docs/specs/2026-10-16-mint-page-live-data.md,
 * decision 6): the same page for the signed-in owner of the deployed collection with that link, published or
 * not, under a banner saying who can see it. Anyone else gets the not-found page. Never cached, never indexed.
 */
export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Mint page preview', robots: { index: false, follow: false } }

export default async function Page(props: PageProps<'/[slug]/preview'>) {
  const { slug } = await props.params
  if (RESERVED_SLUGS.includes(slug)) notFound()
  if (isDemoMode()) {
    if (!hasSampleCollection(slug)) notFound()
    return (
      <>
        <PreviewBanner published tabHref="/collections" />
        <SampleMintPage page={samplePageStatic(slug)} />
      </>
    )
  }
  const preview = await readMintPagePreview(slug)
  if (!preview) notFound()
  const { published, collectionId, ...page } = preview
  return (
    <>
      <PreviewBanner published={published} tabHref={manageTabHref(collectionId, 'mint-page')} />
      <MintPage page={page} sample={null} />
    </>
  )
}
```

The new route needs Next's route types before the typecheck:

Run: `pnpm --filter @cobweb/web exec next typegen`
Expected: `Generating route types...` then `Types generated successfully`.

- [ ] **Step 9: Typecheck and lint the web app**

Run: `pnpm --filter @cobweb/web typecheck && pnpm --filter @cobweb/web lint`
Expected: no errors and no warnings.

- [ ] **Step 10: Format, run the root checks and commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
pnpm exec prettier --write apps/web/src/lib/mint/remind.ts apps/web/src/lib/mint/remind.test.ts apps/web/src/lib/mint/live-source.ts apps/web/src/lib/mint/live-source.test.ts apps/web/src/lib/mint/page-read.ts apps/web/src/components/mint/remind-me.tsx apps/web/src/components/mint/page-sections.tsx apps/web/src/components/mint/music-button.tsx apps/web/src/components/mint/preview-banner.tsx apps/web/src/components/mint/sample-source.ts apps/web/src/components/mint/mint-success.tsx apps/web/src/components/mint/mint-context.tsx apps/web/src/components/mint/mint-page.tsx apps/web/src/components/mint/mint-panel.tsx apps/web/src/components/mint/mint-top-bar.tsx apps/web/src/components/mint/phase-list.tsx 'apps/web/src/app/[slug]/preview/page.tsx'
pnpm typecheck && pnpm lint && pnpm test
git add apps/web/src/lib/mint/remind.ts apps/web/src/lib/mint/remind.test.ts apps/web/src/lib/mint/live-source.ts apps/web/src/lib/mint/live-source.test.ts apps/web/src/lib/mint/page-read.ts apps/web/src/components/mint/remind-me.tsx apps/web/src/components/mint/page-sections.tsx apps/web/src/components/mint/music-button.tsx apps/web/src/components/mint/preview-banner.tsx apps/web/src/components/mint/sample-source.ts apps/web/src/components/mint/mint-success.tsx apps/web/src/components/mint/mint-context.tsx apps/web/src/components/mint/mint-page.tsx apps/web/src/components/mint/mint-panel.tsx apps/web/src/components/mint/mint-top-bar.tsx apps/web/src/components/mint/phase-list.tsx 'apps/web/src/app/[slug]/preview/page.tsx'
git commit -m "$(cat <<'EOF'
Add the page's sections, Remind me, the music button, the owner's preview and the rarity spot with tiers at the revealed base URI

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: the web app reports 782 tests in 86 files; the other packages are unchanged.

---

### Task 7: The Mint page tab as one draft, with the Overview and Deploy on the row

**Files:**

- Create: `apps/web/src/components/manage/mint-page-draft.ts`, `mint-page-draft.test.ts`
- Modify (whole files): `apps/web/src/components/manage/mint-page-fields.tsx`, `mint-page-section-parts.tsx`, `mint-page-screen.tsx`, `apps/web/src/app/collections/[id]/manage/mint-page/page.tsx`
- Modify (blocks): `apps/web/src/components/manage/mint-page-sections.tsx`, `mint-page-preview.tsx`, `manage-sim.ts`, `overview-cards.tsx`, `overview-screen.tsx`, `apps/web/src/app/collections/[id]/manage/page.tsx`, `apps/web/src/components/deploy/deployed-view.tsx`, `deploy-flow.tsx`, `deploy-screen.tsx`, `apps/web/src/app/collections/[id]/deploy/page.tsx`, `apps/web/src/components/mint/sample-source.ts` (`sampleTokenArt` exported), `use-token-art.ts` (its source narrowed to `tokenArt`)
- Test: `mint-page-draft.test.ts`

**Interfaces:**

- Consumes: Task 2's actions (`getMintPageSettings`, `presignMintPageMedia`, `saveMintPage`, `setMintPagePublished`), `MintPageSettingsView`, `MintPageInput`, `MediaAsk`, `mintPageMediaProblem`, `MEDIA_SLOTS`, `ipfsGateway`, `PAGE_UPLOAD_FAILED`; Task 5's `useTokenArt` and `TokenArtFrame`; `getPhases` (`app/actions/phases.ts`); the tab's link field (`MintPageAddressField`, `reserveSlug`); `sha256Hex` (`components/art/uploads/hash.ts`); `tokenArtOf` (Task 4); `saveOffChain` (`components/manage/manage-sim.ts`); `DEMO_MINT_PAGE_SETTINGS` and `DEMO_MINT_PAGE_SECTIONS` (`lib/demo`).
- Produces:
  - `components/manage/mint-page-draft.ts`: `DraftFile = { kind: 'stored'; key; url } | { kind: 'picked'; file: File; url; width; height }`, `DraftMember`, `DraftUploadSlide`, `DraftSlide`, `DraftSections`, `MintPageDraft = { published; description; media: Record<'banner' | 'avatar' | 'about', DraftFile | null>; socials; featuredTokenIds; sections: DraftSections }`, `draftOf(view: MintPageSettingsView): MintPageDraft`, `pickedFiles(draft: MintPageDraft): { slot: MediaSlot; file: File; width; height }[]` (each picked file once), `mediaAskOf(entry, contentHash: string): MediaAsk`, `inputOf(draft: MintPageDraft, keys: ReadonlyMap<File, string>): MintPageInput`, `SOCIAL_FIELDS`, `LINK_MAX = 200`, `socialError(value: string | undefined, hosts: string[]): string | null`, `draftInvalid(draft: MintPageDraft): boolean`
  - `components/manage/mint-page-fields.tsx`: `MAX_FEATURED = 6`, `PICKER_TOKENS = 48`, `pickFile(file, slot)`, `ImageSlot`, `TokenPicker` (ids 1 to 48 of the rendered set with thumbnails, and "Add by number" for any id up to the supply); `mint-page-section-parts.tsx`: `LIMITS`, `ItemList`, `Text`, `FilePick`, `Carousel`; `mint-page-sections.tsx`: `MintPageSections`, controlled by the draft
  - `components/manage/mint-page-screen.tsx`: `MintPageScreen({ collection, view, preview, gateway, sample })`: Save asks for the new files' URLs, PUTs each with its type and then saves the draft; a failed PUT stops it with "A file could not be uploaded. Try again." and writes nothing; "Preview" opens `/<slug>/preview`, "Open mint page" shows once public; sample mode saves after 900 ms and writes nothing
  - `components/manage/manage-sim.ts`: `sampleMintPageView(...)`, the tab's sample row; `components/mint/sample-source.ts`: `sampleTokenArt(baseUri: string, id: number): Promise<TokenArt | null>`
  - the Overview: the avatar from the row, `MintPageLinkBar` from the row with its switch on `setMintPagePublished`; the deployed view: "Add a banner and links, then make the page public." and the link row "Not public yet. Make it public in Manage drop, Mint page." or "Open mint page" (`mintPagePublished`)

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/manage/mint-page-draft.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { MintPageSettingsView } from '@/lib/mint/settings-core'
import {
  draftInvalid,
  draftOf,
  inputOf,
  mediaAskOf,
  pickedFiles,
  socialError,
  type DraftFile,
} from './mint-page-draft'

const COLLECTION = '0a977c0b-7e53-476b-8c08-6c685315c3af'
const key = (n: number, extension = 'png') => `${COLLECTION}/${n.toString(16).padStart(64, '0')}.${extension}`
const url = (value: string) => `https://media.example/${value}`

const view: MintPageSettingsView = {
  published: false,
  description: 'Owls.',
  media: { banner: { key: key(1), url: url(key(1)) }, avatar: null, about: null },
  socials: { x: 'https://x.com/owls' },
  featuredTokenIds: [3],
  sections: {
    team: {
      enabled: true,
      members: [
        { id: 'team-1', name: 'Mara', role: 'Artist', bio: '', imageKey: key(2), imageUrl: url(key(2)) },
      ],
    },
    roadmap: { enabled: false, items: [] },
    faq: { enabled: false, items: [] },
    music: { enabled: true, key: key(3, 'mp3'), fileName: 'theme.mp3', url: url(key(3, 'mp3')) },
    carousel: {
      enabled: true,
      items: [
        {
          id: 'slide-1',
          kind: 'upload',
          key: key(4, 'mp4'),
          url: url(key(4, 'mp4')),
          fileName: 'a.mp4',
          mediaType: 'video',
        },
        { id: 'slide-2', kind: 'token', tokenId: 7 },
      ],
    },
  },
  art: { realBaseUri: null, supply: 10, projectType: 'generative' },
}
const picked = (name: string, type: string): DraftFile => ({
  kind: 'picked',
  file: new File(['x'.repeat(10)], name, { type }),
  url: `blob:${name}`,
  width: 500,
  height: 500,
})

describe('the Mint page draft (docs/specs/2026-10-16-mint-page-live-data.md, section 7.9)', () => {
  it('turns a saved view into the input it was saved from, every file as its key', () => {
    const input = inputOf(draftOf(view), new Map())
    expect(input).toEqual({
      published: false,
      description: 'Owls.',
      media: { banner: key(1), avatar: null, about: null },
      socials: { website: null, x: 'https://x.com/owls', discord: null, telegram: null },
      featuredTokenIds: [3],
      sections: {
        team: {
          enabled: true,
          members: [{ id: 'team-1', name: 'Mara', role: 'Artist', bio: '', imageKey: key(2) }],
        },
        roadmap: { enabled: false, items: [] },
        faq: { enabled: false, items: [] },
        music: { enabled: true, key: key(3, 'mp3'), fileName: 'theme.mp3' },
        carousel: {
          enabled: true,
          items: [
            { id: 'slide-1', kind: 'upload', key: key(4, 'mp4'), fileName: 'a.mp4', mediaType: 'video' },
            { id: 'slide-2', kind: 'token', tokenId: 7 },
          ],
        },
      },
    })
  })

  it('lists each picked file once with its slot, and keys it as its upload was named', () => {
    const avatar = picked('avatar.png', 'image/png')
    const draft = draftOf(view)
    draft.media.avatar = avatar
    draft.media.about = avatar
    draft.sections.team.members[0]!.image = picked('mara.jpg', 'image/jpeg')
    const files = pickedFiles(draft)
    expect(files.map((entry) => [entry.slot, entry.file.name])).toEqual([
      ['avatar', 'avatar.png'],
      ['team', 'mara.jpg'],
    ])
    expect(mediaAskOf(files[0]!, 'ab'.repeat(32))).toEqual({
      slot: 'avatar',
      mime: 'image/png',
      bytes: 10,
      width: 500,
      height: 500,
      contentHash: 'ab'.repeat(32),
    })
    const keys = new Map(files.map((entry, index) => [entry.file, key(10 + index)]))
    const input = inputOf(draft, keys)
    expect([input.media.avatar, input.media.about, input.sections.team.members[0]?.imageKey]).toEqual([
      key(10),
      key(10),
      key(11),
    ])
    expect(() => inputOf(draft, new Map())).toThrow()
  })

  it("leaves out empty links and a member's blank links, and the track's name with no track", () => {
    const draft = draftOf(view)
    draft.socials = { website: '  ', x: 'https://x.com/owls ' }
    draft.sections.team.members[0] = {
      ...draft.sections.team.members[0]!,
      x: ' ',
      discord: 'https://discord.gg/m',
    }
    draft.sections.music.track = null
    const input = inputOf(draft, new Map())
    expect(input.socials).toEqual({ website: null, x: 'https://x.com/owls', discord: null, telegram: null })
    expect(input.sections.team.members[0]).toEqual({
      id: 'team-1',
      name: 'Mara',
      role: 'Artist',
      bio: '',
      imageKey: key(2),
      discord: 'https://discord.gg/m',
    })
    expect(input.sections.music).toEqual({ enabled: true, key: null, fileName: null })
  })
})

describe('socialError', () => {
  it('takes an empty link, https on the named hosts with a path, and refuses the rest', () => {
    expect(socialError('', ['x.com'])).toBeNull()
    expect(socialError('https://x.com/owls', ['x.com', 'twitter.com'])).toBeNull()
    expect(socialError('https://www.twitter.com/owls', ['x.com', 'twitter.com'])).toBeNull()
    expect(socialError('http://x.com/owls', ['x.com'])).toBe('Use a link that starts with https://.')
    expect(socialError('https://example.com/owls', ['x.com'])).toBe('Use a x.com link.')
    expect(socialError('https://x.com/', ['x.com'])).toBe('Use a x.com link with its path.')
    expect(socialError(`https://example.com/${'a'.repeat(190)}`, [])).toBe(
      'Use a link of at most 200 characters.',
    )
    expect(socialError('owls', [])).toBe('Enter a full link, starting with https://.')
  })
})

describe('draftInvalid', () => {
  it('refuses a long description, a bad link, and a blank name or answer, and takes the saved draft', () => {
    const draft = draftOf(view)
    expect(draftInvalid(draft)).toBe(false)
    expect(draftInvalid({ ...draft, description: 'd'.repeat(2001) })).toBe(true)
    expect(draftInvalid({ ...draft, socials: { discord: 'https://example.com/x' } })).toBe(true)
    const member = draft.sections.team.members[0]!
    expect(
      draftInvalid({
        ...draft,
        sections: { ...draft.sections, team: { enabled: true, members: [{ ...member, name: ' ' }] } },
      }),
    ).toBe(true)
    expect(
      draftInvalid({
        ...draft,
        sections: { ...draft.sections, team: { enabled: true, members: [{ ...member, x: 'x.com/m' }] } },
      }),
    ).toBe(true)
    expect(
      draftInvalid({
        ...draft,
        sections: {
          ...draft.sections,
          faq: { enabled: true, items: [{ id: 'f', question: 'Q', answer: '' }] },
        },
      }),
    ).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to see it fail**

Run: `pnpm --filter @cobweb/web exec vitest run src/components/manage/mint-page-draft.test.ts`
Expected: FAIL. The file fails to load with `Cannot find module './mint-page-draft'`: `Test Files  1 failed (1)` and `Tests  no tests`.

- [ ] **Step 3: The draft**

Create `apps/web/src/components/manage/mint-page-draft.ts`:

```ts
import type { Socials } from '@/lib/demo/types'
import type { MediaSlot } from '@/lib/mint/media'
import type {
  StoredFaqItem,
  StoredMember,
  StoredRoadmapItem,
  StoredSections,
  StoredTokenSlide,
} from '@/lib/mint/page-doc'
import type { MediaAsk, MintPageInput, MintPageSettingsView } from '@/lib/mint/settings-core'

/**
 * The Mint page tab's draft (docs/specs/2026-10-16-mint-page-live-data.md, section 7.9), pure: the row's fields and
 * the sections in one value, each file either stored (its key and URL) or picked in this browser and kept there
 * until Save. A save uploads the picked files, then sends the draft with every file as its key.
 */

/** A file of the draft: stored in the bucket, or picked and not uploaded yet. */
export type DraftFile =
  | { kind: 'stored'; key: string; url: string }
  | { kind: 'picked'; file: File; url: string; width: number | null; height: number | null }

export type DraftMember = Omit<StoredMember, 'imageKey'> & { image: DraftFile | null }
export type DraftUploadSlide = {
  id: string
  kind: 'upload'
  fileName: string
  mediaType: 'image' | 'video'
  media: DraftFile
}
export type DraftSlide = DraftUploadSlide | StoredTokenSlide
export type DraftSections = {
  team: { enabled: boolean; members: DraftMember[] }
  roadmap: { enabled: boolean; items: StoredRoadmapItem[] }
  faq: { enabled: boolean; items: StoredFaqItem[] }
  music: { enabled: boolean; track: DraftFile | null; fileName: string | null }
  carousel: { enabled: boolean; items: DraftSlide[] }
}
export type MintPageDraft = {
  published: boolean
  description: string
  media: Record<'banner' | 'avatar' | 'about', DraftFile | null>
  socials: Socials
  featuredTokenIds: number[]
  sections: DraftSections
}

const stored = (key: string | null, url: string | null): DraftFile | null =>
  key !== null && url !== null ? { kind: 'stored', key, url } : null

/** The draft of a saved view. */
export function draftOf(view: MintPageSettingsView): MintPageDraft {
  const { team, roadmap, faq, music, carousel } = view.sections
  return {
    published: view.published,
    description: view.description,
    media: {
      banner: view.media.banner && stored(view.media.banner.key, view.media.banner.url),
      avatar: view.media.avatar && stored(view.media.avatar.key, view.media.avatar.url),
      about: view.media.about && stored(view.media.about.key, view.media.about.url),
    },
    socials: view.socials,
    featuredTokenIds: view.featuredTokenIds,
    sections: {
      team: {
        enabled: team.enabled,
        members: team.members.map(({ imageKey, imageUrl, ...member }) => ({
          ...member,
          image: stored(imageKey, imageUrl),
        })),
      },
      roadmap,
      faq,
      music: { enabled: music.enabled, track: stored(music.key, music.url), fileName: music.fileName },
      carousel: {
        enabled: carousel.enabled,
        items: carousel.items.map((slide) =>
          slide.kind === 'token'
            ? slide
            : {
                id: slide.id,
                kind: 'upload',
                fileName: slide.fileName,
                mediaType: slide.mediaType,
                media: { kind: 'stored', key: slide.key, url: slide.url },
              },
        ),
      },
    },
  }
}

/** Every picked file of the draft with its slot, each once: what a save must upload first. */
export function pickedFiles(draft: MintPageDraft): {
  slot: MediaSlot
  file: File
  width: number | null
  height: number | null
}[] {
  const found = new Map<File, { slot: MediaSlot; file: File; width: number | null; height: number | null }>()
  const add = (media: DraftFile | null, slot: MediaSlot) => {
    if (media?.kind === 'picked' && !found.has(media.file))
      found.set(media.file, { slot, file: media.file, width: media.width, height: media.height })
  }
  add(draft.media.banner, 'banner')
  add(draft.media.avatar, 'avatar')
  add(draft.media.about, 'about')
  for (const member of draft.sections.team.members) add(member.image, 'team')
  for (const slide of draft.sections.carousel.items) if (slide.kind === 'upload') add(slide.media, 'slide')
  add(draft.sections.music.track, 'music')
  return [...found.values()]
}

/** What the browser asks the server to sign for a picked file, with its content hash. */
export function mediaAskOf(
  entry: { slot: MediaSlot; file: File; width: number | null; height: number | null },
  contentHash: string,
): MediaAsk {
  return {
    slot: entry.slot,
    mime: entry.file.type,
    bytes: entry.file.size,
    width: entry.width,
    height: entry.height,
    contentHash,
  }
}

/** The save's input: every file as its key, a picked one as the key its upload was given. Empty links are left out. */
export function inputOf(draft: MintPageDraft, keys: ReadonlyMap<File, string>): MintPageInput {
  const keyOf = (media: DraftFile | null): string | null => {
    if (!media) return null
    if (media.kind === 'stored') return media.key
    const key = keys.get(media.file)
    if (!key) throw new Error('A picked file has no key: upload it first.')
    return key
  }
  const link = (value: string | undefined) => value?.trim() || null
  const memberLink = (value: string | undefined) => (value?.trim() ? value.trim() : undefined)
  const { team, roadmap, faq, music, carousel } = draft.sections
  const sections: StoredSections = {
    team: {
      enabled: team.enabled,
      members: team.members.map(({ image, x, discord, telegram, ...member }) => ({
        ...member,
        imageKey: keyOf(image),
        ...(memberLink(x) ? { x: memberLink(x) } : {}),
        ...(memberLink(discord) ? { discord: memberLink(discord) } : {}),
        ...(memberLink(telegram) ? { telegram: memberLink(telegram) } : {}),
      })),
    },
    roadmap,
    faq,
    music: { enabled: music.enabled, key: keyOf(music.track), fileName: music.track ? music.fileName : null },
    carousel: {
      enabled: carousel.enabled,
      items: carousel.items.map((slide) =>
        slide.kind === 'token'
          ? slide
          : {
              id: slide.id,
              kind: 'upload',
              key: keyOf(slide.media)!,
              fileName: slide.fileName,
              mediaType: slide.mediaType,
            },
      ),
    },
  }
  return {
    published: draft.published,
    description: draft.description,
    media: {
      banner: keyOf(draft.media.banner),
      avatar: keyOf(draft.media.avatar),
      about: keyOf(draft.media.about),
    },
    socials: {
      website: link(draft.socials.website),
      x: link(draft.socials.x),
      discord: link(draft.socials.discord),
      telegram: link(draft.socials.telegram),
    },
    featuredTokenIds: draft.featuredTokenIds,
    sections,
  }
}

/** The page's links, each with the hosts the database's checks allow. */
export const SOCIAL_FIELDS: { key: keyof Socials; label: string; placeholder: string; hosts: string[] }[] = [
  { key: 'website', label: 'Website', placeholder: 'https://', hosts: [] },
  { key: 'x', label: 'X', placeholder: 'https://x.com/yourname', hosts: ['x.com', 'twitter.com'] },
  {
    key: 'discord',
    label: 'Discord invite',
    placeholder: 'https://discord.gg/invite',
    hosts: ['discord.gg', 'discord.com'],
  },
  {
    key: 'telegram',
    label: 'Telegram',
    placeholder: 'https://t.me/yourgroup',
    hosts: ['t.me', 'telegram.me'],
  },
]

/** Longest link accepted, as in legacy. */
export const LINK_MAX = 200

/** Why a page link is not usable, or null. Empty is fine: the icon is left off the page. */
export function socialError(value: string | undefined, hosts: string[]): string | null {
  const text = value?.trim()
  if (!text) return null
  if (text.length > LINK_MAX) return `Use a link of at most ${LINK_MAX} characters.`
  try {
    const url = new URL(text)
    if (url.protocol !== 'https:') return 'Use a link that starts with https://.'
    const host = url.hostname.replace(/^www\./, '')
    if (hosts.length > 0 && !hosts.includes(host)) return `Use a ${hosts[0]} link.`
    if (hosts.length > 0 && url.pathname.length < 2) return `Use a ${hosts[0]} link with its path.`
    return null
  } catch {
    return 'Enter a full link, starting with https://.'
  }
}

/** Whether the draft cannot be saved yet: a field over its limit, a link the page would not take, a blank required text. */
export function draftInvalid(draft: MintPageDraft): boolean {
  if (draft.description.length > 2000) return true
  if (SOCIAL_FIELDS.some((field) => socialError(draft.socials[field.key], field.hosts))) return true
  const blank = (text: string) => !text.trim()
  const badLink = (value: string | undefined) => !!value?.trim() && !/^https:\/\/\S+$/.test(value.trim())
  const { team, roadmap, faq } = draft.sections
  return (
    team.members.some(
      (member) =>
        blank(member.name) ||
        blank(member.role) ||
        badLink(member.x) ||
        badLink(member.discord) ||
        badLink(member.telegram),
    ) ||
    roadmap.items.some((item) => blank(item.date) || blank(item.title)) ||
    faq.items.some((item) => blank(item.question) || blank(item.answer))
  )
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `pnpm --filter @cobweb/web exec vitest run src/components/manage/mint-page-draft.test.ts`
Expected: PASS, `Tests  5 passed (5)`.

- [ ] **Step 5: The token thumbnails' source**

In `apps/web/src/components/mint/use-token-art.ts`, replace:

```ts
 */
export function useTokenArt(
  source: MintSource,
  baseUri: string | null,
  ids: readonly number[],
```

with:

```ts
 */
export function useTokenArt(
  source: Pick<MintSource, 'tokenArt'>,
  baseUri: string | null,
  ids: readonly number[],
```

In `apps/web/src/components/mint/sample-source.ts`, replace:

```ts
import type { MintChain } from '@/lib/mint/mint-run'
import type { MintPageStatic } from '@/lib/mint/page-doc'

/**
```

with:

```ts
import type { MintChain } from '@/lib/mint/mint-run'
import type { MintPageStatic } from '@/lib/mint/page-doc'
import type { TokenArt } from '@/lib/mint/token-art'

/**
```

In `apps/web/src/components/mint/sample-source.ts`, replace:

```ts
        })),
  }
}

```

with:

```ts
        })),
  }
}

/** A sample token's art: its preview, or its layers stacked; the placeholder's image before the reveal. */
export async function sampleTokenArt(baseUri: string, id: number): Promise<TokenArt | null> {
  if (baseUri === SAMPLE_PLACEHOLDER_URI) return { layers: [DEMO_PLACEHOLDER.imageUrl], video: false }
  const token = DEMO_TOKENS[id - 1]
  if (!token) return null
  return { layers: token.previewUrl ? [token.previewUrl] : tokenLayerUrls(token.dna), video: false }
}

```

In `apps/web/src/components/mint/sample-source.ts`, replace:

```ts
    },

    async tokenArt(baseUri, id) {
      if (baseUri === SAMPLE_PLACEHOLDER_URI) return { layers: [DEMO_PLACEHOLDER.imageUrl], video: false }
      const token = DEMO_TOKENS[id - 1]
      if (!token) return null
      return { layers: token.previewUrl ? [token.previewUrl] : tokenLayerUrls(token.dna), video: false }
    },
  }
}
```

with:

```ts
    },

    tokenArt: sampleTokenArt,
  }
}
```

- [ ] **Step 6: The tab's fields, sections, miniature and screen**

Replace the whole of `apps/web/src/components/manage/mint-page-fields.tsx` with:

```tsx
'use client'

import { CheckIcon, ImageUpIcon, PlusIcon, XIcon } from 'lucide-react'
import { useId, useState } from 'react'
import { Artwork } from '@cobweb/ui/components/artwork'
import { Button } from '@cobweb/ui/components/button'
import { FieldError } from '@cobweb/ui/components/field'
import { Input } from '@cobweb/ui/components/input'
import { Spinner } from '@cobweb/ui/components/spinner'
import { cn } from '@cobweb/ui/lib/utils'
import { MEDIA_SLOTS, mintPageMediaProblem, type MediaSlot } from '@/lib/mint/media'
import type { TokenArt } from '@/lib/mint/token-art'
import { TokenArtFrame } from '@/components/mint/token-image'
import { count } from './format'
import type { DraftFile } from './mint-page-draft'

export const MAX_FEATURED = 6
/** How many of the rendered set the pickers show as thumbnails; any other id is added by its number. */
export const PICKER_TOKENS = 48

/** The width and height of an image file, or nulls when it cannot be read as one. */
function sizeOf(url: string): Promise<{ width: number | null; height: number | null }> {
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => resolve({ width: null, height: null })
    image.src = url
  })
}

/**
 * A file picked for a slot, checked against the slot's types and caps (docs/specs/2026-10-16-mint-page-live-data.md,
 * section 4.4) with its size read for images; the file stays in the browser until the page is saved.
 */
export async function pickFile(
  file: File,
  slot: MediaSlot,
): Promise<{ picked: DraftFile; problem: null } | { picked: null; problem: string }> {
  const url = URL.createObjectURL(file)
  const size = file.type.startsWith('image/') ? await sizeOf(url) : { width: null, height: null }
  const problem = mintPageMediaProblem(slot, { mime: file.type, bytes: file.size, ...size })
  if (problem) {
    URL.revokeObjectURL(url)
    return { picked: null, problem }
  }
  return { picked: { kind: 'picked', file, url, ...size }, problem: null }
}

/**
 * An image slot: shows the current image, takes a new one by click, checks its type, size and shape, and keeps it
 * in the browser until the page is saved.
 */
export function ImageSlot({
  label,
  hint,
  value,
  onChange,
  seed,
  slot,
  shape,
}: {
  label: string
  hint: string
  value: DraftFile | null
  onChange: (value: DraftFile | null) => void
  seed: string
  slot: MediaSlot
  shape: 'banner' | 'square'
}) {
  const id = useId()
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function take(file: File | undefined) {
    if (!file) return
    setError(null)
    setWarning(null)
    setLoading(true)
    const { picked, problem } = await pickFile(file, slot)
    setLoading(false)
    if (!picked) return setError(problem)
    if (picked.kind === 'picked' && picked.width && picked.height) {
      const ratio = picked.width / picked.height
      if (shape === 'square' && Math.abs(ratio - 1) > 0.05)
        setWarning('This image is not square, so its edges will be cropped.')
      if (shape === 'banner' && (ratio < 2.5 || ratio > 4))
        setWarning('Banners look best at 3 to 1, such as 1500 by 500. This one will be cropped.')
    }
    onChange(picked)
  }

  return (
    <div className="grid gap-2">
      <p id={`${id}-label`} className="text-sm font-medium">
        {label}
      </p>
      <div className={cn('flex gap-4', shape === 'banner' ? 'flex-col' : 'items-center')}>
        <Artwork
          src={value?.url ?? null}
          alt={`${label} preview`}
          seed={seed}
          label={value ? undefined : 'None'}
          className={cn(
            'border',
            shape === 'banner' ? 'aspect-[3/1] w-full rounded-xl' : 'size-24 shrink-0 rounded-xl',
          )}
        >
          {loading && (
            <span className="bg-background/60 absolute inset-0 flex items-center justify-center">
              <Spinner />
            </span>
          )}
        </Artwork>
        <div className="grid gap-1.5">
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" asChild>
              <label
                htmlFor={`${id}-file`}
                className="cursor-pointer has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-ring"
              >
                <ImageUpIcon aria-hidden="true" />
                {value ? 'Replace' : 'Upload'}
                <input
                  id={`${id}-file`}
                  type="file"
                  accept={MEDIA_SLOTS[slot].types.join(',')}
                  className="sr-only"
                  aria-labelledby={`${id}-label`}
                  aria-describedby={`${id}-hint`}
                  onChange={(event) => {
                    void take(event.target.files?.[0])
                    event.target.value = ''
                  }}
                />
              </label>
            </Button>
            {value && (
              <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
                <XIcon aria-hidden="true" />
                Remove
              </Button>
            )}
          </div>
          <p id={`${id}-hint`} className="text-muted-foreground text-[0.8125rem]">
            {hint}
          </p>
          {error && <FieldError>{error}</FieldError>}
          {warning && <p className="text-warning-foreground text-[0.8125rem]">{warning}</p>}
        </div>
      </div>
    </div>
  )
}

/** "Add by number": any token id up to the supply. */
function AddByNumber({
  supply,
  taken,
  onAdd,
  disabled,
}: {
  supply: number
  taken: number[]
  onAdd: (id: number) => void
  disabled: boolean
}) {
  const id = useId()
  const [text, setText] = useState('')
  const value = Number(text)
  const problem = !text.trim()
    ? null
    : !Number.isInteger(value) || value < 1 || value > supply
      ? `Enter a token from 1 to ${count(supply)}.`
      : taken.includes(value)
        ? 'That token is already chosen.'
        : null
  const add = () => {
    if (!text.trim() || problem) return
    onAdd(value)
    setText('')
  }
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center gap-2">
        <Input
          id={id}
          inputMode="numeric"
          aria-label="Token number"
          placeholder="Token number"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              add()
            }
          }}
          className="w-36"
          disabled={disabled}
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={add}
          disabled={disabled || !text.trim() || !!problem}
        >
          <PlusIcon aria-hidden="true" />
          Add by number
        </Button>
      </div>
      {problem && <FieldError>{problem}</FieldError>}
    </div>
  )
}

/**
 * Tokens of the rendered set to pick from: ids 1 to 48 (at most the supply) with thumbnails from their metadata at
 * the real job's base URI, plus any id up to the supply by its number. Without a done real job there are no
 * previews; a single asset picks none, since every token shares its image.
 */
export function TokenPicker({
  art,
  ids,
  value,
  onChange,
  max,
  realBaseUri,
  supply,
  projectType,
}: {
  art: Map<number, TokenArt | null | undefined>
  ids: number[]
  value: number[]
  onChange: (ids: number[]) => void
  max: number
  realBaseUri: string | null
  supply: number
  projectType: 'generative' | 'one_of_one' | 'single_asset'
}) {
  if (projectType === 'single_asset') {
    return (
      <p className="text-muted-foreground text-sm">
        Every token shares one image, which the page shows in place of featured tokens.
      </p>
    )
  }
  const full = value.length >= max
  return (
    <div className="grid gap-3">
      <p className="text-muted-foreground text-[0.8125rem]" aria-live="polite">
        <span className="numeric text-foreground">{value.length}</span> of {max} chosen.
        {full ? ' Remove one to choose another.' : ' Shown in the order you pick them.'}
      </p>
      {value.some((id) => !ids.includes(id)) && (
        <ul className="flex flex-wrap gap-2">
          {value
            .filter((id) => !ids.includes(id))
            .map((id) => (
              <li key={id}>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onChange(value.filter((other) => other !== id))}
                >
                  <span className="numeric">#{count(id)}</span>
                  <XIcon aria-hidden="true" />
                  <span className="sr-only">Remove</span>
                </Button>
              </li>
            ))}
        </ul>
      )}
      {realBaseUri === null ? (
        <p className="text-muted-foreground text-sm">
          No token previews yet. They appear once the art is rendered.
        </p>
      ) : (
        <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6 xl:grid-cols-8">
          {ids.map((tokenId) => {
            const position = value.indexOf(tokenId)
            const chosen = position >= 0
            return (
              <li key={tokenId}>
                <button
                  type="button"
                  aria-pressed={chosen}
                  aria-label={`Token ${tokenId}${chosen ? `, chosen ${position + 1}` : ''}`}
                  disabled={!chosen && full}
                  onClick={() =>
                    onChange(chosen ? value.filter((id) => id !== tokenId) : [...value, tokenId])
                  }
                  className={cn(
                    'group focus-visible:ring-ring focus-visible:ring-offset-background relative block w-full overflow-hidden rounded-lg border outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
                    'transition-[transform,border-color,opacity] duration-150 disabled:cursor-not-allowed disabled:opacity-40',
                    chosen ? 'border-primary' : 'hover:border-border-strong',
                  )}
                >
                  <TokenArtFrame art={art.get(tokenId)} id={tokenId} alt="" />
                  {chosen && (
                    <span className="bg-primary text-primary-foreground numeric absolute top-1 right-1 flex size-5 items-center justify-center rounded-full text-[0.6875rem] font-semibold">
                      {position + 1}
                    </span>
                  )}
                  {!chosen && (
                    <span className="bg-background/70 absolute top-1 right-1 hidden size-5 items-center justify-center rounded-full group-hover:flex">
                      <CheckIcon aria-hidden="true" className="size-3" />
                    </span>
                  )}
                  <span className="numeric bg-background/70 text-muted-foreground absolute bottom-1 left-1 rounded-sm px-1 text-[0.625rem]">
                    #{count(tokenId)}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {supply > 0 && (
        <AddByNumber supply={supply} taken={value} disabled={full} onAdd={(id) => onChange([...value, id])} />
      )}
    </div>
  )
}
```

Replace the whole of `apps/web/src/components/manage/mint-page-section-parts.tsx` with:

```tsx
'use client'

import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Trash2Icon, UploadIcon } from 'lucide-react'
import { useId, useState } from 'react'
import { Artwork } from '@cobweb/ui/components/artwork'
import { Button } from '@cobweb/ui/components/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@cobweb/ui/components/field'
import { Input } from '@cobweb/ui/components/input'
import { Textarea } from '@cobweb/ui/components/textarea'
import { MEDIA_SLOTS, type MediaSlot } from '@/lib/mint/media'
import type { TokenArt } from '@/lib/mint/token-art'
import type { DraftFile, DraftSlide } from './mint-page-draft'
import { pickFile, TokenPicker } from './mint-page-fields'

/** Legacy's limits for each section (docs/specs/2026-10-16-mint-page-live-data.md, section 4.1). */
export const LIMITS = {
  name: 20,
  role: 20,
  handle: 40,
  text: 500,
  date: 20,
  title: 20,
  question: 40,
  slides: 5,
}

type WithId = { id: string }

/** An ordered list of cards with move, remove and add, as legacy's "Arrange" lists. */
export function ItemList<T extends WithId>({
  items,
  onChange,
  addLabel,
  create,
  render,
}: {
  items: T[]
  onChange: (items: T[]) => void
  addLabel: string
  create: () => T
  render: (item: T, update: (patch: Partial<T>) => void) => React.ReactNode
}) {
  const move = (from: number, to: number) => {
    const next = [...items]
    next.splice(to, 0, next.splice(from, 1)[0]!)
    onChange(next)
  }
  return (
    <>
      <ol className="grid gap-3">
        {items.map((item, index) => (
          <li key={item.id} className="bg-surface-2/40 grid gap-3 rounded-lg border p-4">
            <div className="flex justify-end gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Move up"
                disabled={index === 0}
                onClick={() => move(index, index - 1)}
              >
                <ArrowUpIcon />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Move down"
                disabled={index === items.length - 1}
                onClick={() => move(index, index + 1)}
              >
                <ArrowDownIcon />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Remove"
                onClick={() => onChange(items.filter((other) => other.id !== item.id))}
              >
                <Trash2Icon />
              </Button>
            </div>
            {render(item, (patch) =>
              onChange(items.map((other) => (other.id === item.id ? { ...other, ...patch } : other))),
            )}
          </li>
        ))}
      </ol>
      <Button
        type="button"
        variant="secondary"
        className="w-fit"
        onClick={() => onChange([...items, create()])}
      >
        <PlusIcon aria-hidden="true" />
        {addLabel}
      </Button>
    </>
  )
}

/** A text field with legacy's length limit and a counter. `url` asks for an https link. */
export function Text({
  label,
  value,
  max,
  onChange,
  multiline,
  required,
  url,
  placeholder,
}: {
  label: string
  value: string
  max: number
  onChange: (value: string) => void
  multiline?: boolean
  required?: boolean
  url?: boolean
  placeholder?: string
}) {
  const id = useId()
  const error =
    required && !value.trim()
      ? `Add the ${label.toLowerCase()}.`
      : url && value.trim() && !/^https:\/\/\S+\.\S+/.test(value.trim())
        ? 'Use a link that starts with https://.'
        : null
  const props = {
    id,
    value,
    maxLength: max,
    placeholder: placeholder ?? (url ? 'https://' : undefined),
    'aria-invalid': !!error,
  }
  return (
    <Field data-invalid={!!error}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {multiline ? (
        <Textarea {...props} rows={3} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <Input {...props} onChange={(event) => onChange(event.target.value)} />
      )}
      {error ? (
        <FieldError>{error}</FieldError>
      ) : (
        <FieldDescription className="numeric">
          {value.length} / {max}
        </FieldDescription>
      )}
    </Field>
  )
}

/** One file picked in the browser for a slot, checked against the slot's types and caps; it stays there until Save. */
export function FilePick({
  label,
  slot,
  hint,
  onFile,
  onRemove,
  icon,
}: {
  label: string
  slot: MediaSlot
  hint: string
  onFile: (picked: DraftFile, file: File) => void
  onRemove?: () => void
  icon: React.ReactNode
}) {
  const id = useId()
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-2 text-sm">
          {icon}
          {label}
        </span>
        <Button variant="secondary" size="sm" asChild>
          <label
            htmlFor={id}
            className="cursor-pointer has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-ring"
          >
            <UploadIcon aria-hidden="true" />
            Choose a file
            <input
              id={id}
              type="file"
              accept={MEDIA_SLOTS[slot].types.join(',')}
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (!file) return
                void pickFile(file, slot).then(({ picked, problem }) => {
                  setError(problem)
                  if (picked) onFile(picked, file)
                })
              }}
            />
          </label>
        </Button>
        {onRemove && (
          <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
            Remove
          </Button>
        )}
      </div>
      {hint && <p className="text-muted-foreground text-[0.8125rem]">{hint}</p>}
      {error && <FieldError>{error}</FieldError>}
    </div>
  )
}

/**
 * Up to five slides: uploaded images or MP4s, or the collection's own tokens, picked from the rendered set or by
 * their number. Token slides show on the page once the collection is revealed.
 */
export function Carousel({
  items,
  onChange,
  art,
  ids,
  realBaseUri,
  supply,
  projectType,
}: {
  items: DraftSlide[]
  onChange: (items: DraftSlide[]) => void
  art: Map<number, TokenArt | null | undefined>
  ids: number[]
  realBaseUri: string | null
  supply: number
  projectType: 'generative' | 'one_of_one' | 'single_asset'
}) {
  const full = items.length >= LIMITS.slides
  const uploads = items.filter((item) => item.kind === 'upload').length
  const tokenIds = items.flatMap((item) => (item.kind === 'token' ? [item.tokenId] : []))
  /** Keeps the uploads where they are, drops the tokens unpicked and adds the tokens picked, at the end. */
  const pickTokens = (picked: number[]) => {
    const kept = items.filter((item) => item.kind === 'upload' || picked.includes(item.tokenId))
    const added = picked
      .filter((id) => !tokenIds.includes(id))
      .map((tokenId): DraftSlide => ({ id: `slide-${Date.now()}-${tokenId}`, kind: 'token', tokenId }))
    onChange([...kept, ...added])
  }
  return (
    <div className="grid gap-4">
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {items.map((item) => (
          <li key={item.id} className="relative">
            <Artwork
              src={
                item.kind === 'upload'
                  ? item.mediaType === 'image'
                    ? item.media.url
                    : null
                  : (art.get(item.tokenId)?.layers.at(-1) ?? null)
              }
              alt=""
              seed={item.id}
              label={item.kind === 'upload' && item.mediaType === 'video' ? 'MP4' : undefined}
              className="rounded-lg border"
            />
            <span className="numeric bg-background/70 absolute bottom-1 left-1 rounded-sm px-1 text-[0.625rem]">
              {item.kind === 'token' ? `#${item.tokenId}` : item.fileName.slice(0, 12)}
            </span>
            <Button
              type="button"
              variant="secondary"
              size="icon-xs"
              className="absolute top-1 right-1"
              aria-label="Remove slide"
              onClick={() => onChange(items.filter((other) => other.id !== item.id))}
            >
              <Trash2Icon />
            </Button>
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground text-[0.8125rem]">
        <span className="numeric">{items.length}</span> of {LIMITS.slides} slides. PNG, JPG, WebP or GIF up to
        5 MB, or an MP4 up to 20 MB. Token slides show once the collection is revealed.
      </p>
      {!full && (
        <FilePick
          label=""
          slot="slide"
          hint=""
          onFile={(media, file) =>
            onChange([
              ...items,
              {
                id: `slide-${Date.now()}`,
                kind: 'upload',
                fileName: file.name.slice(0, 100) || 'slide',
                mediaType: file.type === 'video/mp4' ? 'video' : 'image',
                media,
              },
            ])
          }
          icon={null}
        />
      )}
      <div className="grid gap-2">
        <p className="text-sm font-medium">Add a token</p>
        <TokenPicker
          art={art}
          ids={ids}
          value={tokenIds}
          onChange={pickTokens}
          max={LIMITS.slides - uploads}
          realBaseUri={realBaseUri}
          supply={supply}
          projectType={projectType}
        />
      </div>
    </div>
  )
}
```

In `apps/web/src/components/manage/mint-page-sections.tsx`, replace:

```tsx

import { MusicIcon } from 'lucide-react'
import { useState } from 'react'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@cobweb/ui/components/accordion'
import { Badge } from '@cobweb/ui/components/badge'
import { Panel } from '@cobweb/ui/components/panel'
import { Switch } from '@cobweb/ui/components/switch'
import {
  // Seam: replaced by the mint page section tables in Phase 6.
  DEMO_MINT_PAGE_SECTIONS,
  type GeneratedToken,
  type MintPageSections as Sections,
  type TeamMember,
} from '@/lib/demo'
import { ImageSlot } from './mint-page-fields'
import { Carousel, FilePick, ItemList, LIMITS, MB, Text } from './mint-page-section-parts'

type Section = keyof Sections

/**
 * Team, Roadmap, FAQ, music and carousel: the mint page sections that return in Phase 6. The
 * form works on sample data so the fields and limits can be reviewed now; nothing is saved and the
 * public page does not show them yet.
 * Seam: Phase 6 stores each section (and its on/off switch) with the mint page settings and uploads
 * files to storage on save.
 */
export function MintPageSections({ candidates }: { candidates: GeneratedToken[] }) {
  const [value, setValue] = useState<Sections>(DEMO_MINT_PAGE_SECTIONS)
  const set = <K extends Section>(key: K, next: Partial<Sections[K]>) =>
    setValue((current) => ({ ...current, [key]: { ...current[key], ...next } }))
  const toggle = (key: Section) => (
    <Switch
```

with:

```tsx

import { MusicIcon } from 'lucide-react'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@cobweb/ui/components/accordion'
import { Panel } from '@cobweb/ui/components/panel'
import { Switch } from '@cobweb/ui/components/switch'
import type { TokenArt } from '@/lib/mint/token-art'
import type { DraftMember, DraftSections } from './mint-page-draft'
import { ImageSlot } from './mint-page-fields'
import { Carousel, FilePick, ItemList, LIMITS, Text } from './mint-page-section-parts'

type Section = keyof DraftSections

/**
 * Team, Roadmap, FAQ, music and a carousel (docs/specs/2026-10-16-mint-page-live-data.md, section 4.1): the mint
 * page's own sections, each with its switch, saved with the rest of the draft. Files stay in the browser until
 * Save, which uploads them first.
 */
export function MintPageSections({
  value,
  onChange,
  art,
  ids,
  realBaseUri,
  supply,
  projectType,
}: {
  value: DraftSections
  onChange: (value: DraftSections) => void
  art: Map<number, TokenArt | null | undefined>
  ids: number[]
  realBaseUri: string | null
  supply: number
  projectType: 'generative' | 'one_of_one' | 'single_asset'
}) {
  const set = <K extends Section>(key: K, next: Partial<DraftSections[K]>) =>
    onChange({ ...value, [key]: { ...value[key], ...next } })
  const toggle = (key: Section) => (
    <Switch
```

In `apps/web/src/components/manage/mint-page-sections.tsx`, replace:

```tsx
  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          More sections <Badge variant="outline">Phase 6</Badge>
        </span>
      }
      description="Team, roadmap, FAQ, music and a carousel, as on the old mint pages. Preview only: these are not saved and not shown on the page until Phase 6."
      bodyClassName="p-0"
    >
```

with:

```tsx
  return (
    <Panel
      title="More sections"
      description="Team, roadmap, FAQ, music and a carousel. Each shows on the page when its switch is on and it has content."
      bodyClassName="p-0"
    >
```

In `apps/web/src/components/manage/mint-page-sections.tsx`, replace:

```tsx
            onChange={(members) => set('team', { members })}
            addLabel="Add a member"
            create={(): TeamMember => ({
              id: `team-${Date.now()}`,
              name: '',
              role: '',
              bio: '',
              imageUrl: '',
            })}
            render={(member, update) => (
              <div className="grid gap-4">
                <ImageSlot
                  label="Photo"
                  hint="Square. PNG, JPG or GIF, up to 20 MB."
                  value={member.imageUrl}
                  onChange={(imageUrl) => update({ imageUrl })}
                  seed={member.id}
                  shape="square"
                  maxBytes={LIMITS.mb * MB}
                />
                <div className="grid gap-4 sm:grid-cols-2">
```

with:

```tsx
            onChange={(members) => set('team', { members })}
            addLabel="Add a member"
            create={(): DraftMember => ({
              id: `team-${Date.now()}`,
              name: '',
              role: '',
              bio: '',
              image: null,
            })}
            render={(member, update) => (
              <div className="grid gap-4">
                <ImageSlot
                  label="Photo"
                  hint="Square. PNG, JPG, WebP or GIF, up to 2 MB."
                  value={member.image}
                  onChange={(image) => update({ image })}
                  seed={member.id}
                  slot="team"
                  shape="square"
                />
                <div className="grid gap-4 sm:grid-cols-2">
```

In `apps/web/src/components/manage/mint-page-sections.tsx`, replace:

```tsx
        </Block>

        <Block id="music" title="Music" count={value.music.fileName ? 1 : 0} toggle={toggle('music')}>
          <FilePick
            label={value.music.fileName ?? 'No track'}
            accept="audio/mpeg,.mp3"
            hint="One MP3, up to 20 MB. It plays with the collection's avatar as its cover."
            check={(file) =>
              file.type === 'audio/mpeg' || /\.mp3$/i.test(file.name) ? null : 'Use an MP3 file.'
            }
            onFile={(file, url) => set('music', { fileName: file.name, url })}
            onRemove={value.music.fileName ? () => set('music', { fileName: null, url: null }) : undefined}
            icon={<MusicIcon aria-hidden="true" />}
          />
```

with:

```tsx
        </Block>

        <Block id="music" title="Music" count={value.music.track ? 1 : 0} toggle={toggle('music')}>
          <FilePick
            label={value.music.track ? (value.music.fileName ?? 'Track') : 'No track'}
            slot="music"
            hint="One MP3, up to 20 MB. It plays with the collection's avatar as its cover."
            onFile={(track, file) =>
              set('music', { track, fileName: file.name.slice(0, 100) || 'track.mp3' })
            }
            onRemove={value.music.track ? () => set('music', { track: null, fileName: null }) : undefined}
            icon={<MusicIcon aria-hidden="true" />}
          />
```

In `apps/web/src/components/manage/mint-page-sections.tsx`, replace:

```tsx
          <Carousel
            items={value.carousel.items}
            candidates={candidates}
            onChange={(items) => set('carousel', { items })}
          />
        </Block>
```

with:

```tsx
          <Carousel
            items={value.carousel.items}
            onChange={(items) => set('carousel', { items })}
            art={art}
            ids={ids}
            realBaseUri={realBaseUri}
            supply={supply}
            projectType={projectType}
          />
        </Block>
```

In `apps/web/src/components/manage/mint-page-preview.tsx`, replace:

```tsx
import { GlobeIcon, LockIcon, MessageCircleIcon, SendIcon } from 'lucide-react'
import { Artwork } from '@cobweb/ui/components/artwork'
import { Progress } from '@cobweb/ui/components/progress'
import { StatusBadge } from '@cobweb/ui/components/status-badge'
import { cn } from '@cobweb/ui/lib/utils'
import { ChainName } from '@/components/chains/chain-icon'
import { formatNative, type MintPageData, type Socials } from '@/lib/demo'
import { count, percent } from './format'

export type PreviewOverrides = {
  description: string
  bannerUrl: string
  avatarUrl: string
  socials: Socials
  featured: { id: number; name: string; imageUrl: string }[]
}

/**
 * A miniature of the public mint page, drawn from the same data the page renders, with the
 * form's unsaved values laid over it. Not interactive: it is a picture of the page.
 */
export function MintPagePreview({
  data,
  overrides,
  url,
}: {
  data: MintPageData
  overrides: PreviewOverrides
  url: string
}) {
  const { collection, supply } = data
  const live = data.groups.find((group) => group.active)
  const symbol = collection.chain.nativeSymbol
  const socials = [
```

with:

```tsx
import { GlobeIcon, MessageCircleIcon, SendIcon } from 'lucide-react'
import { Artwork } from '@cobweb/ui/components/artwork'
import { Progress } from '@cobweb/ui/components/progress'
import { StatusBadge } from '@cobweb/ui/components/status-badge'
import { cn } from '@cobweb/ui/lib/utils'
import { ChainName } from '@/components/chains/chain-icon'
import { TokenArtFrame } from '@/components/mint/token-image'
import { formatNative, type MintGroup, type Socials, type SupportedChain } from '@/lib/demo'
import type { TokenArt } from '@/lib/mint/token-art'
import { count, percent } from './format'

/** What the miniature draws that the form does not edit: the collection, minted so far and the live phase. */
export type PreviewData = {
  name: string
  symbol: string
  slug: string | null
  chain: SupportedChain
  minted: number
  max: number
  /** The phase open now, from the chain's last read; null when none is, or the chain was not read. */
  live: Pick<MintGroup, 'name' | 'priceWei'> | null
}

export type PreviewOverrides = {
  description: string
  bannerUrl: string | null
  avatarUrl: string | null
  socials: Socials
  featured: { id: number; art: TokenArt | null | undefined }[]
}

/**
 * A miniature of the public mint page: minted and the live phase from the phases view (the sample's in sample
 * mode), with the form's unsaved values laid over it. Not interactive: it is a picture of the page.
 */
export function MintPagePreview({
  data,
  overrides,
  url,
}: {
  data: PreviewData
  overrides: PreviewOverrides
  url: string
}) {
  const collection = data
  const supply = { minted: data.minted, max: data.max }
  const live = data.live
  const symbol = collection.chain.nativeSymbol
  const socials = [
```

In `apps/web/src/components/manage/mint-page-preview.tsx`, replace:

```tsx
          src={overrides.bannerUrl || null}
          alt=""
          seed={`${collection.slug}-banner`}
          label={overrides.bannerUrl ? undefined : 'No banner'}
          className="aspect-[3/1]"
```

with:

```tsx
          src={overrides.bannerUrl || null}
          alt=""
          seed={`${collection.slug ?? collection.name}-banner`}
          label={overrides.bannerUrl ? undefined : 'No banner'}
          className="aspect-[3/1]"
```

In `apps/web/src/components/manage/mint-page-preview.tsx`, replace:

```tsx
              src={overrides.avatarUrl || null}
              alt=""
              seed={`${collection.slug}-avatar`}
              className="border-background relative z-10 -mt-7 size-14 shrink-0 rounded-lg border-2"
            />
```

with:

```tsx
              src={overrides.avatarUrl || null}
              alt=""
              seed={`${collection.slug ?? collection.name}-avatar`}
              className="border-background relative z-10 -mt-7 size-14 shrink-0 rounded-lg border-2"
            />
```

In `apps/web/src/components/manage/mint-page-preview.tsx`, replace:

```tsx
              Mint
            </span>
            {collection.transfersLocked && (
              <p className="text-muted-foreground flex items-center gap-1 text-[0.625rem]">
                <LockIcon className="size-2.5" /> Transfers locked
              </p>
            )}
          </div>

          {overrides.featured.length > 0 && (
            <div className="grid grid-cols-6 gap-1.5">
              {overrides.featured.slice(0, 6).map((token) => (
                <Artwork
                  key={token.id}
                  src={token.imageUrl}
                  alt=""
                  seed={String(token.id)}
                  className="rounded-sm"
                />
              ))}
            </div>
```

with:

```tsx
              Mint
            </span>
          </div>

          {overrides.featured.length > 0 && (
            <div className="grid grid-cols-6 gap-1.5">
              {overrides.featured.slice(0, 6).map((token) => (
                <TokenArtFrame key={token.id} art={token.art} id={token.id} alt="" className="rounded-sm" />
              ))}
            </div>
```

In `apps/web/src/components/manage/manage-sim.ts`, replace:

```ts
import { collectionAbi } from '@cobweb/shared/collection-abi'
import { ContractFunctionRevertedError, encodeErrorResult } from 'viem'
import {
  DEMO_COLLECTION,
  DEMO_DEPLOYMENT,
  DEMO_MINT_PAGE_SETTINGS,
  DEMO_NOW,
```

with:

```ts
import { collectionAbi } from '@cobweb/shared/collection-abi'
import { ContractFunctionRevertedError, encodeErrorResult } from 'viem'
import { SAMPLE_REVEALED_URI } from '@/components/mint/sample-source'
import type { Tables } from '@/lib/database.types'
import {
  DEMO_COLLECTION,
  DEMO_DEPLOYMENT,
  DEMO_MINT_PAGE_SECTIONS,
  DEMO_MINT_PAGE_SETTINGS,
  DEMO_NOW,
```

In `apps/web/src/components/manage/manage-sim.ts`, replace:

```ts
import type { PhaseAdd, PhasesView } from '@/lib/manage/phases-types'
import type { SettingsView } from '@/lib/manage/settings-types'
import type { ManageActions } from './manage-actions'
import type { PendingAdd } from './manage-machine'
```

with:

```ts
import type { PhaseAdd, PhasesView } from '@/lib/manage/phases-types'
import type { SettingsView } from '@/lib/manage/settings-types'
import type { MintPageSettingsView } from '@/lib/mint/settings-core'
import type { ManageActions } from './manage-actions'
import type { PendingAdd } from './manage-machine'
```

In `apps/web/src/components/manage/manage-sim.ts`, replace:

```ts
/** Sample values the Overview still reads beyond its props until Phase 6. Each names the real source. */
export const SAMPLE = {
  /** SEAM: the mint page settings row (avatar and the public switch on the overview). */
  mintPage: DEMO_MINT_PAGE_SETTINGS,
} as const

/**
 * Saves off-chain settings (mint page details).
 * SEAM: a server action that checks the session and ownership, then writes the settings row.
 */
export async function saveOffChain(): Promise<void> {
  await wait(900)
}

```

with:

```ts
/** Sample values the Overview still reads beyond its props until Phase 6. Each names the real source. */
export const SAMPLE = {
  /** The sample's mint page row: the Overview's avatar and public switch in sample mode. */
  mintPage: DEMO_MINT_PAGE_SETTINGS,
} as const

/** Saves off-chain settings in sample mode, where nothing is written: the mint page's draft and its switch. */
export async function saveOffChain(): Promise<void> {
  await wait(900)
}

/**
 * The Mint page tab's view in sample mode: the sample's settings and sections, its files as their URLs (which stand
 * in for keys, since sample mode uploads nothing), and the sample's rendered set to feature from.
 */
export function sampleMintPageView(
  collection: Pick<Tables<'collections'>, 'project_type' | 'max_supply'>,
): MintPageSettingsView {
  const settings = DEMO_MINT_PAGE_SETTINGS
  const { team, roadmap, faq, music, carousel } = DEMO_MINT_PAGE_SECTIONS
  const ref = (url: string) => (url ? { key: url, url } : null)
  return {
    published: settings.published,
    description: settings.description,
    media: { banner: ref(settings.bannerUrl), avatar: ref(settings.avatarUrl), about: null },
    socials: settings.socials,
    featuredTokenIds: settings.featuredTokenIds,
    sections: {
      team: {
        enabled: team.enabled,
        members: team.members.map(({ imageUrl, ...member }) => ({
          ...member,
          imageKey: imageUrl || null,
          imageUrl: imageUrl || null,
        })),
      },
      roadmap,
      faq,
      music: { enabled: music.enabled, key: music.url, fileName: music.fileName, url: music.url },
      carousel: {
        enabled: carousel.enabled,
        items: carousel.items.map((item) =>
          item.kind === 'token'
            ? item
            : {
                id: item.id,
                kind: 'upload',
                key: item.url,
                url: item.url,
                fileName: item.fileName,
                mediaType: item.mediaType,
              },
        ),
      },
    },
    art: {
      realBaseUri: SAMPLE_REVEALED_URI,
      supply: sampleSupply(collection.max_supply, DEMO_COLLECTION.maxSupply),
      projectType: collection.project_type,
    },
  }
}

```

Replace the whole of `apps/web/src/components/manage/mint-page-screen.tsx` with:

```tsx
'use client'

import { ArrowUpRightIcon, CheckIcon, EyeIcon } from 'lucide-react'
import { useId, useMemo, useState, useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import { Button } from '@cobweb/ui/components/button'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@cobweb/ui/components/field'
import { Input } from '@cobweb/ui/components/input'
import { Panel } from '@cobweb/ui/components/panel'
import { Spinner } from '@cobweb/ui/components/spinner'
import { Switch } from '@cobweb/ui/components/switch'
import { Textarea } from '@cobweb/ui/components/textarea'
import { presignMintPageMedia, saveMintPage } from '@/app/actions/mint-page'
import { sha256Hex } from '@/components/art/uploads/hash'
import { MintPageAddressField } from '@/components/collections/mint-page-address-field'
import { sampleTokenArt } from '@/components/mint/sample-source'
import { useTokenArt } from '@/components/mint/use-token-art'
import { PAGE_UPLOAD_FAILED } from '@/lib/art/result'
import type { Tables } from '@/lib/database.types'
import type { Socials } from '@/lib/demo'
import type { MintPageSettingsView } from '@/lib/mint/settings-core'
import { tokenArtOf } from '@/lib/mint/token-art'
import { CopyButton } from './bits'
import { saveOffChain } from './manage-sim'
import {
  draftInvalid,
  draftOf,
  inputOf,
  mediaAskOf,
  pickedFiles,
  SOCIAL_FIELDS,
  socialError,
  type MintPageDraft,
} from './mint-page-draft'
import { ImageSlot, MAX_FEATURED, PICKER_TOKENS, TokenPicker } from './mint-page-fields'
import { MintPagePreview, type PreviewData } from './mint-page-preview'
import { MintPageSections } from './mint-page-sections'

export type MintPageScreenProps = {
  collection: Tables<'collections'>
  /** The row with its media, sections and the art the tab features from (the sample's in sample mode). */
  view: MintPageSettingsView
  /** What the miniature draws besides the draft. */
  preview: PreviewData
  /** The IPFS gateway token thumbnails are read through. */
  gateway: string
  /** Sample mode: files stay browser URLs and Save waits instead of writing. */
  sample: boolean
}

const noopSubscribe = () => () => {}

/**
 * Manage drop, mint page (docs/specs/2026-10-16-mint-page-live-data.md, section 7.9): the link, the public switch,
 * the description, the banner, avatar and About banner, the links, featured tokens and the sections, in one draft
 * that Save uploads and writes, beside a miniature of the page. Preview opens the owner's view of the page.
 */
export function MintPageScreen({ collection, view, preview, gateway, sample }: MintPageScreenProps) {
  const id = useId()
  // The link is set here when the collection has none, or changed after a warning.
  const [slug, setSlug] = useState(collection.slug)
  const [changing, setChanging] = useState(false)
  const mintPageHref = slug ? `/${slug}` : null
  const initial = useMemo(() => draftOf(view), [view])
  const [saved, setSaved] = useState<MintPageDraft>(initial)
  const [draft, setDraft] = useState<MintPageDraft>(initial)
  const [saving, setSaving] = useState(false)
  const origin = useSyncExternalStore(
    noopSubscribe,
    () => window.location.origin,
    () => '',
  )
  const publicUrl = `${origin}${mintPageHref ?? ''}`
  // Shown as cobweb.app/<link>, as on Deploy and the Overview; copy and open use the real origin.
  const displayUrl = `cobweb.app/${slug ?? 'your-link'}`

  const { realBaseUri, supply, projectType } = view.art
  const artSource = useMemo(
    () => ({
      tokenArt: sample
        ? sampleTokenArt
        : (base: string, tokenId: number) => tokenArtOf(base, tokenId, gateway),
    }),
    [sample, gateway],
  )
  const pickerIds = useMemo(
    () => Array.from({ length: Math.min(PICKER_TOKENS, supply) }, (_, index) => index + 1),
    [supply],
  )
  const tokenSlides = draft.sections.carousel.items.flatMap((item) =>
    item.kind === 'token' ? [item.tokenId] : [],
  )
  const artIds = [...new Set([...pickerIds, ...draft.featuredTokenIds, ...tokenSlides])]
  const art = useTokenArt(artSource, realBaseUri, realBaseUri ? artIds : [])

  const errors = Object.fromEntries(
    SOCIAL_FIELDS.map((social) => [social.key, socialError(draft.socials[social.key], social.hosts)]),
  ) as Record<keyof Socials, string | null>
  const invalid = draftInvalid(draft)
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)
  const set = <K extends keyof MintPageDraft>(key: K, value: MintPageDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }))
  const setMedia = (slot: keyof MintPageDraft['media'], value: MintPageDraft['media'][typeof slot]) =>
    setDraft((current) => ({ ...current, media: { ...current.media, [slot]: value } }))

  /** Uploads the picked files (each PUT bound to its type and length), then writes the whole draft. */
  async function saveLive(): Promise<boolean> {
    const files = pickedFiles(draft)
    const keys = new Map<File, string>()
    if (files.length) {
      const asks = await Promise.all(
        files.map(async (entry) => mediaAskOf(entry, await sha256Hex(entry.file))),
      )
      const signed = await presignMintPageMedia(collection.id, asks)
      if (!signed.ok) {
        toast.error(signed.error)
        return false
      }
      for (const [index, entry] of signed.data.entries()) {
        const file = files[index]!.file
        keys.set(file, entry.key)
        if (!entry.putUrl) continue
        const put = await fetch(entry.putUrl, {
          method: 'PUT',
          body: file,
          headers: { 'Content-Type': file.type },
        })
        if (!put.ok) {
          toast.error(PAGE_UPLOAD_FAILED)
          return false
        }
      }
    }
    const result = await saveMintPage(collection.id, inputOf(draft, keys))
    if (!result.ok) {
      toast.error(result.error)
      return false
    }
    const next = draftOf(result.data)
    setSaved(next)
    setDraft(next)
    return true
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (invalid || !dirty) return
    setSaving(true)
    try {
      if (sample) {
        await saveOffChain()
        setSaved(draft)
      } else if (!(await saveLive())) return
      toast.success('Mint page saved')
    } catch {
      toast.error('The mint page could not be saved. Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save} className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)]">
      <div className="grid gap-6">
        <Panel title="Mint page link" bodyClassName="grid gap-4 p-5 lg:p-6">
          {mintPageHref && !changing ? (
            <div className="bg-well shadow-inset flex min-w-0 flex-wrap items-center gap-2 rounded-md border py-1.5 pr-1.5 pl-3">
              <span className="numeric min-w-0 flex-1 truncate text-sm">{displayUrl}</span>
              <CopyButton value={publicUrl} label="Copy link" size="icon-sm" />
              <Button variant="ghost" size="sm" asChild>
                <a href={`${mintPageHref}/preview`} target="_blank" rel="noreferrer">
                  <EyeIcon aria-hidden="true" />
                  Preview
                </a>
              </Button>
              {saved.published && (
                <Button variant="ghost" size="sm" asChild>
                  <a href={mintPageHref} target="_blank" rel="noreferrer">
                    Open mint page
                    <ArrowUpRightIcon aria-hidden="true" />
                  </a>
                </Button>
              )}
              <Button type="button" variant="ghost" size="sm" onClick={() => setChanging(true)}>
                Change link
              </Button>
            </div>
          ) : (
            <MintPageAddressField
              key={slug ?? 'none'}
              collection={{ ...collection, slug }}
              changing={changing}
              onCancel={() => setChanging(false)}
              onSaved={(value) => {
                setSlug(value.slug)
                setChanging(false)
              }}
            />
          )}
          <Field orientation="horizontal" data-disabled={!mintPageHref}>
            <Switch
              id={`${id}-published`}
              checked={!!mintPageHref && draft.published}
              onCheckedChange={(value) => set('published', value)}
              disabled={!mintPageHref}
              aria-describedby={`${id}-published-help`}
            />
            <div className="grid gap-0.5">
              <FieldLabel htmlFor={`${id}-published`}>Page is public</FieldLabel>
              <FieldDescription id={`${id}-published-help`}>
                {!mintPageHref
                  ? 'Set a link first. The page can go public once it has one.'
                  : draft.published
                    ? 'Anyone with the link can see it and mint. Saved with the page.'
                    : 'Hidden. Visitors see that the page is not available.'}
              </FieldDescription>
            </div>
          </Field>
        </Panel>

        <Panel title="About" bodyClassName="p-5 lg:p-6">
          <FieldGroup className="gap-6">
            <Field data-invalid={draft.description.length > 2000}>
              <FieldLabel htmlFor={`${id}-description`}>Description</FieldLabel>
              <Textarea
                id={`${id}-description`}
                value={draft.description}
                onChange={(event) => set('description', event.target.value)}
                rows={5}
                aria-describedby={`${id}-description-help`}
              />
              <FieldDescription id={`${id}-description-help`}>
                <span className="numeric">{draft.description.length.toLocaleString('en-US')}</span> of 2,000
                characters. Shown in About on the page.
              </FieldDescription>
            </Field>
            <ImageSlot
              label="Banner"
              hint="3 to 1, such as 1500 by 500. PNG, JPG, WebP or GIF, up to 5 MB."
              value={draft.media.banner}
              onChange={(value) => setMedia('banner', value)}
              seed={`${collection.id}-banner`}
              slot="banner"
              shape="banner"
            />
            <ImageSlot
              label="Avatar"
              hint="Square, at least 400 by 400. PNG, JPG, WebP or GIF, up to 2 MB."
              value={draft.media.avatar}
              onChange={(value) => setMedia('avatar', value)}
              seed={`${collection.id}-avatar`}
              slot="avatar"
              shape="square"
            />
            <ImageSlot
              label="About banner"
              hint="Shown above About; the banner stands in without one. 3 to 1, up to 5 MB."
              value={draft.media.about}
              onChange={(value) => setMedia('about', value)}
              seed={`${collection.id}-about`}
              slot="about"
              shape="banner"
            />
          </FieldGroup>
        </Panel>

        <Panel
          title="Links"
          description="Each link you add shows as a button in About."
          bodyClassName="grid gap-5 p-5 lg:p-6"
        >
          {SOCIAL_FIELDS.map((social) => (
            <Field key={social.key} data-invalid={!!errors[social.key]}>
              <FieldLabel htmlFor={`${id}-${social.key}`}>{social.label}</FieldLabel>
              <Input
                id={`${id}-${social.key}`}
                type="url"
                inputMode="url"
                value={draft.socials[social.key] ?? ''}
                placeholder={social.placeholder}
                onChange={(event) => set('socials', { ...draft.socials, [social.key]: event.target.value })}
                aria-invalid={!!errors[social.key]}
                aria-describedby={errors[social.key] ? `${id}-${social.key}-error` : undefined}
                autoComplete="off"
              />
              {errors[social.key] && (
                <FieldError id={`${id}-${social.key}-error`}>{errors[social.key]}</FieldError>
              )}
            </Field>
          ))}
        </Panel>

        <Panel
          title="Featured tokens"
          description="Shown in the art stage and in From the collection once the collection is revealed."
          bodyClassName="p-5 lg:p-6"
        >
          <TokenPicker
            art={art}
            ids={pickerIds}
            value={draft.featuredTokenIds}
            onChange={(ids) => set('featuredTokenIds', ids)}
            max={MAX_FEATURED}
            realBaseUri={realBaseUri}
            supply={supply}
            projectType={projectType}
          />
        </Panel>

        <MintPageSections
          value={draft.sections}
          onChange={(sections) => set('sections', sections)}
          art={art}
          ids={pickerIds}
          realBaseUri={realBaseUri}
          supply={supply}
          projectType={projectType}
        />
      </div>

      <aside aria-label="Preview" className="grid gap-4 lg:sticky lg:top-6">
        <MintPagePreview
          data={preview}
          url={displayUrl}
          overrides={{
            description: draft.description,
            bannerUrl: draft.media.banner?.url ?? null,
            avatarUrl: draft.media.avatar?.url ?? null,
            socials: Object.fromEntries(
              Object.entries(draft.socials).filter(([key, value]) => value && !errors[key as keyof Socials]),
            ),
            featured: draft.featuredTokenIds.map((tokenId) => ({ id: tokenId, art: art.get(tokenId) })),
          }}
        />
        <div className="bg-card shadow-raised flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3">
          <p className="text-muted-foreground flex items-center gap-1.5 text-sm" aria-live="polite">
            {saving ? (
              'Saving'
            ) : dirty ? (
              <>
                <span aria-hidden="true" className="bg-warning size-1.5 rounded-full" />
                Unsaved changes
              </>
            ) : (
              <>
                <CheckIcon aria-hidden="true" className="text-success-foreground size-4" />
                Saved
              </>
            )}
          </p>
          <div className="flex gap-2">
            {dirty && !saving && (
              <Button type="button" variant="ghost" onClick={() => setDraft(saved)}>
                Discard
              </Button>
            )}
            <Button type="submit" disabled={!dirty || invalid || saving}>
              {saving && <Spinner />}
              Save changes
            </Button>
          </div>
        </div>
        {invalid && (
          <p className="text-destructive-foreground text-sm">Fix the highlighted fields to save.</p>
        )}
      </aside>
    </form>
  )
}
```

Replace the whole of `apps/web/src/app/collections/[id]/manage/mint-page/page.tsx` with:

```tsx
import { getMintPageSettings } from '@/app/actions/mint-page'
import { getPhases } from '@/app/actions/phases'
import { sampleMintPageView } from '@/components/manage/manage-sim'
import { ManageUnavailable } from '@/components/manage/manage-unavailable'
import type { PreviewData } from '@/components/manage/mint-page-preview'
import { MintPageScreen } from '@/components/manage/mint-page-screen'
import { StagePage } from '@/components/shell/stage-page'
import { requireOwnedCollection } from '@/lib/auth'
import { chainView } from '@/lib/chain/chain-view'
import { getMintPageData } from '@/lib/demo'
import { ipfsGateway } from '@/lib/mint/page-urls'
import { LockedStagePage, stageContext, type CollectionParams } from '../../_lib/stage'

const TITLE = 'Mint page'
const DESCRIPTION =
  'The public page where collectors mint: its look, its links, its sections and the tokens it features.'

/**
 * Manage drop, mint page (docs/specs/2026-10-16-mint-page-live-data.md, section 7.9): the row with its media and
 * sections, and the phases view for the miniature, read on the server; sample mode keeps the sample row.
 */
export default async function Page({ params }: { params: CollectionParams }) {
  const { id } = await params
  const collection = await requireOwnedCollection(id)
  const ctx = stageContext(collection, 'manage', 'manage')
  if (ctx.access === 'locked') return <LockedStagePage collection={collection} stage="manage" />

  if (ctx.demo) {
    const data = getMintPageData(collection.slug ?? '', 'allowlist-live')
    const preview: PreviewData = {
      name: data.collection.name,
      symbol: data.collection.symbol,
      slug: collection.slug,
      chain: data.collection.chain,
      minted: data.supply.minted,
      max: data.supply.max,
      live: data.groups.find((group) => group.active) ?? null,
    }
    return (
      <StagePage title={TITLE} description={DESCRIPTION} width="wide">
        <MintPageScreen
          // Manage drop is the deployed collection's home; sample mode opens it before deploy, so the
          // mint page link reads as a deployed one there too (no reservation wording).
          collection={{ ...collection, status: 'deployed' }}
          view={sampleMintPageView(collection)}
          preview={preview}
          gateway={ipfsGateway()}
          sample
        />
      </StagePage>
    )
  }

  const [settings, phases] = await Promise.all([getMintPageSettings(collection.id), getPhases(collection.id)])
  if (!settings.ok || !phases.ok) {
    return (
      <StagePage title={TITLE} description={DESCRIPTION} width="wide">
        <ManageUnavailable
          title="The mint page could not be read"
          message={!settings.ok ? settings.error : !phases.ok ? phases.error : ''}
        />
      </StagePage>
    )
  }
  const view = phases.data
  const preview: PreviewData = {
    name: collection.name,
    symbol: collection.symbol,
    slug: collection.slug,
    chain: chainView(view.chainId),
    minted: view.chainReachable ? view.totalMinted : 0,
    max: view.maxSupply,
    live: view.chainReachable ? (view.groups.find((group) => group.active) ?? null) : null,
  }
  return (
    <StagePage title={TITLE} description={DESCRIPTION} width="wide">
      <MintPageScreen
        collection={collection}
        view={settings.data}
        preview={preview}
        gateway={ipfsGateway()}
        sample={false}
      />
    </StagePage>
  )
}
```

- [ ] **Step 7: The Overview and Deploy read the row**

In `apps/web/src/components/manage/overview-cards.tsx`, replace:

```tsx
  type AddressCollection,
} from '@/components/collections/mint-page-address-field'
import type { ActionResult } from '@/lib/art/result'
import type { SupportedChain } from '@/lib/demo'
import type { ManageCall } from '@/lib/manage/phase-calls'
import type { SettingsView } from '@/lib/manage/settings-types'
import { AddressLine } from './bits'
import { count, percent, relativeTo } from './format'
import { saveOffChain, SAMPLE } from './manage-sim'
import { UNREADABLE_REASON } from './phase-row'
import { RevealDialog } from './settings-dialogs'
```

with:

```tsx
  type AddressCollection,
} from '@/components/collections/mint-page-address-field'
import { setMintPagePublished } from '@/app/actions/mint-page'
import type { ActionResult } from '@/lib/art/result'
import type { SupportedChain } from '@/lib/demo'
import type { ManageCall } from '@/lib/manage/phase-calls'
import type { SettingsView } from '@/lib/manage/settings-types'
import { AddressLine } from './bits'
import { count, percent, relativeTo } from './format'
import { saveOffChain } from './manage-sim'
import { UNREADABLE_REASON } from './phase-row'
import { RevealDialog } from './settings-dialogs'
```

In `apps/web/src/components/manage/overview-cards.tsx`, replace:

```tsx
export function OverviewHeader({
  collectionId,
  name,
  contract,
```

with:

```tsx
export function OverviewHeader({
  collectionId,
  avatarUrl,
  name,
  contract,
```

In `apps/web/src/components/manage/overview-cards.tsx`, replace:

```tsx
}: {
  collectionId: string
  name: string
  contract: Address
```

with:

```tsx
}: {
  collectionId: string
  /** The mint page's avatar; the artwork pattern without one. */
  avatarUrl: string | null
  name: string
  contract: Address
```

In `apps/web/src/components/manage/overview-cards.tsx`, replace:

```tsx
    >
      <Artwork
        src={SAMPLE.mintPage.avatarUrl}
        alt={`${name} artwork`}
        seed={collectionId}
```

with:

```tsx
    >
      <Artwork
        src={avatarUrl}
        alt={`${name} artwork`}
        seed={collectionId}
```

In `apps/web/src/components/manage/overview-cards.tsx`, replace:

```tsx
/**
 * The mint page link as a plain input with a check/save button, the public/private switch beside
 * it, and a way to open the page. With no link yet the switch is off and disabled.
 */
export function MintPageLinkBar({
  collection,
  initialPublished,
}: {
  collection: AddressCollection
  initialPublished: boolean
}) {
  const id = useId()
```

with:

```tsx
/**
 * The mint page link as a plain input with a check/save button, the public/private switch beside
 * it, and a way to open the page. With no link yet the switch is off and disabled. The switch writes the mint
 * page's row (sample mode only waits).
 */
export function MintPageLinkBar({
  collection,
  initialPublished,
  sample,
}: {
  collection: AddressCollection
  initialPublished: boolean
  sample: boolean
}) {
  const id = useId()
```

In `apps/web/src/components/manage/overview-cards.tsx`, replace:

```tsx
    setSaving(true)
    try {
      // SEAM: the mint page settings server action (session and ownership checked) writes `published`.
      await saveOffChain()
      toast.success(next ? 'Mint page is public' : 'Mint page is private')
    } catch {
```

with:

```tsx
    setSaving(true)
    try {
      if (sample) await saveOffChain()
      else {
        const result = await setMintPagePublished(collection.id, next)
        if (!result.ok) {
          setPublished(!next)
          toast.error(result.error)
          return
        }
      }
      toast.success(next ? 'Mint page is public' : 'Mint page is private')
    } catch {
```

In `apps/web/src/components/manage/overview-screen.tsx`, replace:

```tsx
import { realManageActions } from './manage-actions'
import { ManageActionsProvider, type ManageTarget } from './manage-context'
import { SAMPLE, sampleManageActions, samplePhasesView } from './manage-sim'
import { MintPageLinkBar, OverviewHeader } from './overview-cards'
import { LiveNow, RecentMints } from './overview-parts'
```

with:

```tsx
import { realManageActions } from './manage-actions'
import { ManageActionsProvider, type ManageTarget } from './manage-context'
import { sampleManageActions, samplePhasesView } from './manage-sim'
import { MintPageLinkBar, OverviewHeader } from './overview-cards'
import { LiveNow, RecentMints } from './overview-parts'
```

In `apps/web/src/components/manage/overview-screen.tsx`, replace:

```tsx
  wallet: Address
  sample: boolean
  /** "Paid by minters": the sample's in sample mode, null on real data until Phase 6. */
  paidByMintersWei: string | null
}

```

with:

```tsx
  wallet: Address
  sample: boolean
  /** "Paid by minters": the sample's in sample mode, null on real data until the indexer. */
  paidByMintersWei: string | null
  /** The mint page's row: its avatar and whether it is public. */
  mintPage: { avatarUrl: string | null; published: boolean }
}

```

In `apps/web/src/components/manage/overview-screen.tsx`, replace:

```tsx
  sample,
  paidByMintersWei,
}: OverviewScreenProps) {
  const config = useConfig()
```

with:

```tsx
  sample,
  paidByMintersWei,
  mintPage,
}: OverviewScreenProps) {
  const config = useConfig()
```

In `apps/web/src/components/manage/overview-screen.tsx`, replace:

```tsx
        <OverviewHeader
          collectionId={collection.id}
          name={collection.name}
          contract={contract}
```

with:

```tsx
        <OverviewHeader
          collectionId={collection.id}
          avatarUrl={mintPage.avatarUrl}
          name={collection.name}
          contract={contract}
```

In `apps/web/src/components/manage/overview-screen.tsx`, replace:

```tsx
          onConfirmed={setSettings}
        />
        <MintPageLinkBar collection={{ ...collection, slug }} initialPublished={SAMPLE.mintPage.published} />

        <div className="mt-3 grid gap-5 lg:grid-cols-3">
```

with:

```tsx
          onConfirmed={setSettings}
        />
        <MintPageLinkBar
          collection={{ ...collection, slug }}
          initialPublished={mintPage.published}
          sample={sample}
        />

        <div className="mt-3 grid gap-5 lg:grid-cols-3">
```

In `apps/web/src/app/collections/[id]/manage/page.tsx`, replace:

```tsx
import { getAddress } from 'viem'
import { getDeployment } from '@/app/actions/deploy'
import { getPhases } from '@/app/actions/phases'
import { getSettings } from '@/app/actions/settings'
import { ManageUnavailable } from '@/components/manage/manage-unavailable'
import { OverviewScreen } from '@/components/manage/overview-screen'
import { sampleSettingsView } from '@/components/manage/settings-sim'
import { StagePage } from '@/components/shell/stage-page'
```

with:

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
```

In `apps/web/src/app/collections/[id]/manage/page.tsx`, replace:

```tsx
 * Manage drop, overview (docs/specs/2026-10-15-airdrop-settings.md, section 7.5). The header's chain, contract and
 * deploy time come from the deployment record; minted and the live phases from the server's read of the chain;
 * what the base URI points at, Reveal and proceeds from the settings read. Holders, the mint page bar's published
 * state and recent mints keep their sample values until Phase 6, and "Paid by minters" shows in sample mode only.
 * In sample mode `?art=deferred` shows the deferred-art scenario, whose real set is not rendered yet, and
 * `?art=revealed` a collection already revealed.
```

with:

```tsx
 * Manage drop, overview (docs/specs/2026-10-15-airdrop-settings.md, section 7.5). The header's chain, contract and
 * deploy time come from the deployment record; minted and the live phases from the server's read of the chain;
 * what the base URI points at, Reveal and proceeds from the settings read; the avatar and the mint page bar's public
 * switch from the mint page's row (docs/specs/2026-10-16-mint-page-live-data.md, section 7.9). Holders and recent
 * mints keep their sample values until the indexer, and "Paid by minters" shows in sample mode only.
 * In sample mode `?art=deferred` shows the deferred-art scenario, whose real set is not rendered yet, and
 * `?art=revealed` a collection already revealed.
```

In `apps/web/src/app/collections/[id]/manage/page.tsx`, replace:

```tsx
          sample
          paidByMintersWei={DEMO_ACTIVITY.proceeds.grossWei}
        />
      </StagePage>
    )
  }

  const [record, phases, settings] = await Promise.all([
    getDeployment(collection.id),
    getPhases(collection.id),
    getSettings(collection.id),
  ])
  if (!record.ok || !record.data || !phases.ok || !settings.ok) {
    const message = !record.ok
      ? record.error
      : !phases.ok
        ? phases.error
        : !settings.ok
          ? settings.error
          : NOT_DEPLOYED
    return (
      <StagePage title={TITLE} description={DESCRIPTION} width="wide">
```

with:

```tsx
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
  if (!record.ok || !record.data || !phases.ok || !settings.ok || !mintPage.ok) {
    const message = !record.ok
      ? record.error
      : !phases.ok
        ? phases.error
        : !settings.ok
          ? settings.error
          : !mintPage.ok
            ? mintPage.error
            : NOT_DEPLOYED
    return (
      <StagePage title={TITLE} description={DESCRIPTION} width="wide">
```

In `apps/web/src/app/collections/[id]/manage/page.tsx`, replace:

```tsx
        sample={false}
        paidByMintersWei={null}
      />
    </StagePage>
```

with:

```tsx
        sample={false}
        paidByMintersWei={null}
        mintPage={{ avatarUrl: mintPage.data.media.avatar?.url ?? null, published: mintPage.data.published }}
      />
    </StagePage>
```

In `apps/web/src/components/deploy/deployed-view.tsx`, replace:

```tsx
  chain,
  artSrc,
  focusOnMount = false,
}: {
  collection: Tables<'collections'>
  record: DeployRecord
  chain: SupportedChain
  artSrc: string | null
  /** Move focus to the heading, after a deploy that just finished on this screen. */
  focusOnMount?: boolean
```

with:

```tsx
  chain,
  artSrc,
  mintPagePublished,
  focusOnMount = false,
}: {
  collection: Tables<'collections'>
  record: DeployRecord
  chain: SupportedChain
  artSrc: string | null
  /** The mint page is public: the link row opens it. */
  mintPagePublished: boolean
  /** Move focus to the heading, after a deploy that just finished on this screen. */
  focusOnMount?: boolean
```

In `apps/web/src/components/deploy/deployed-view.tsx`, replace:

```tsx
      title: 'Prepare the mint page',
      text: slug
        ? 'Add a banner and links. The public page opens with Phase 6.'
        : 'Choose its link, add a banner and links. The public page opens with Phase 6.',
    },
  ]
```

with:

```tsx
      title: 'Prepare the mint page',
      text: slug
        ? 'Add a banner and links, then make the page public.'
        : 'Choose its link, add a banner and links, then make the page public.',
    },
  ]
```

In `apps/web/src/components/deploy/deployed-view.tsx`, replace:

```tsx
                  <span className="flex min-w-0 flex-col items-end">
                    <span className="numeric text-[0.8125rem]">cobweb.app/{slug}</span>
                    <span className="text-muted-foreground text-xs">
                      Opens with the public mint page in Phase 6.
                    </span>
                  </span>
                ) : (
```

with:

```tsx
                  <span className="flex min-w-0 flex-col items-end">
                    <span className="numeric text-[0.8125rem]">cobweb.app/{slug}</span>
                    {mintPagePublished ? (
                      <a
                        href={`/${slug}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs underline-offset-4 hover:underline"
                      >
                        Open mint page
                      </a>
                    ) : (
                      <span className="text-muted-foreground text-xs">
                        Not public yet. Make it public in Manage drop, Mint page.
                      </span>
                    )}
                  </span>
                ) : (
```

In `apps/web/src/components/deploy/deploy-flow.tsx`, replace:

```tsx
  sessionWallet: Address
  artSrc: string | null
  previous?: FlowLink
  next?: FlowLink
```

with:

```tsx
  sessionWallet: Address
  artSrc: string | null
  /** The mint page is public, for the deployed view's link row. */
  mintPagePublished: boolean
  previous?: FlowLink
  next?: FlowLink
```

In `apps/web/src/components/deploy/deploy-flow.tsx`, replace:

```tsx
            chain={chainView(record.chainId)}
            artSrc={props.artSrc}
            focusOnMount={justDeployed}
          />
```

with:

```tsx
            chain={chainView(record.chainId)}
            artSrc={props.artSrc}
            mintPagePublished={props.mintPagePublished}
            focusOnMount={justDeployed}
          />
```

In `apps/web/src/components/deploy/deploy-screen.tsx`, replace:

```tsx
  /** "Finish the art later" (MASTER_PLAN, Flow: pre-reveal): the contract starts on the placeholder. */
  artDeferred?: boolean
}

```

with:

```tsx
  /** "Finish the art later" (MASTER_PLAN, Flow: pre-reveal): the contract starts on the placeholder. */
  artDeferred?: boolean
  /** The mint page is public, for the deployed view's link row. */
  mintPagePublished: boolean
}

```

In `apps/web/src/components/deploy/deploy-screen.tsx`, replace:

```tsx
          sessionWallet={DEMO_CREATOR}
          artSrc={start.placeholder ? start.placeholder.imageUrl : '/demo/tokens/1.svg'}
          previous={props.previous}
          next={props.next}
```

with:

```tsx
          sessionWallet={DEMO_CREATOR}
          artSrc={start.placeholder ? start.placeholder.imageUrl : '/demo/tokens/1.svg'}
          mintPagePublished={props.mintPagePublished}
          previous={props.previous}
          next={props.next}
```

In `apps/web/src/components/deploy/deploy-screen.tsx`, replace:

```tsx
        sessionWallet={props.sessionWallet}
        artSrc={artSrc}
        previous={props.previous}
        next={props.next}
```

with:

```tsx
        sessionWallet={props.sessionWallet}
        artSrc={artSrc}
        mintPagePublished={props.mintPagePublished}
        previous={props.previous}
        next={props.next}
```

In `apps/web/src/app/collections/[id]/deploy/page.tsx`, replace:

```tsx
import { getAddress } from 'viem'
import { getDeployView } from '@/app/actions/deploy'
import { DeployScreen } from '@/components/deploy/deploy-screen'
import { StagePage } from '@/components/shell/stage-page'
```

with:

```tsx
import { getAddress } from 'viem'
import { getDeployView } from '@/app/actions/deploy'
import { getMintPageSettings } from '@/app/actions/mint-page'
import { SAMPLE } from '@/components/manage/manage-sim'
import { DeployScreen } from '@/components/deploy/deploy-screen'
import { StagePage } from '@/components/shell/stage-page'
```

In `apps/web/src/app/collections/[id]/deploy/page.tsx`, replace:

```tsx
  }
  const deployed = ctx.demo ? sampleDeployed : view !== null && view.record !== null

  return (
```

with:

```tsx
  }
  const deployed = ctx.demo ? sampleDeployed : view !== null && view.record !== null
  // The deployed view's link row opens the page once it is public.
  const mintPage = !ctx.demo && deployed ? await getMintPageSettings(collection.id) : null
  const mintPagePublished = ctx.demo ? SAMPLE.mintPage.published : !!(mintPage?.ok && mintPage.data.published)

  return (
```

In `apps/web/src/app/collections/[id]/deploy/page.tsx`, replace:

```tsx
        next={ctx.next}
        sampleOutcome={ctx.demo ? await searchParam(searchParams, 'outcome') : undefined}
      />
    </StagePage>
```

with:

```tsx
        next={ctx.next}
        sampleOutcome={ctx.demo ? await searchParam(searchParams, 'outcome') : undefined}
        mintPagePublished={mintPagePublished}
      />
    </StagePage>
```

- [ ] **Step 8: Typecheck and lint the web app**

Run: `pnpm --filter @cobweb/web typecheck && pnpm --filter @cobweb/web lint`
Expected: no errors and no warnings.

- [ ] **Step 9: Format, run the root checks and commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
pnpm exec prettier --write apps/web/src/components/manage/mint-page-draft.ts apps/web/src/components/manage/mint-page-draft.test.ts apps/web/src/components/manage/mint-page-fields.tsx apps/web/src/components/manage/mint-page-section-parts.tsx apps/web/src/components/manage/mint-page-sections.tsx apps/web/src/components/manage/mint-page-preview.tsx apps/web/src/components/manage/mint-page-screen.tsx apps/web/src/components/manage/manage-sim.ts apps/web/src/components/manage/overview-cards.tsx apps/web/src/components/manage/overview-screen.tsx apps/web/src/components/deploy/deployed-view.tsx apps/web/src/components/deploy/deploy-flow.tsx apps/web/src/components/deploy/deploy-screen.tsx apps/web/src/components/mint/sample-source.ts apps/web/src/components/mint/use-token-art.ts 'apps/web/src/app/collections/[id]/manage/mint-page/page.tsx' 'apps/web/src/app/collections/[id]/manage/page.tsx' 'apps/web/src/app/collections/[id]/deploy/page.tsx'
pnpm typecheck && pnpm lint && pnpm test
git add apps/web/src/components/manage/mint-page-draft.ts apps/web/src/components/manage/mint-page-draft.test.ts apps/web/src/components/manage/mint-page-fields.tsx apps/web/src/components/manage/mint-page-section-parts.tsx apps/web/src/components/manage/mint-page-sections.tsx apps/web/src/components/manage/mint-page-preview.tsx apps/web/src/components/manage/mint-page-screen.tsx apps/web/src/components/manage/manage-sim.ts apps/web/src/components/manage/overview-cards.tsx apps/web/src/components/manage/overview-screen.tsx apps/web/src/components/deploy/deployed-view.tsx apps/web/src/components/deploy/deploy-flow.tsx apps/web/src/components/deploy/deploy-screen.tsx apps/web/src/components/mint/sample-source.ts apps/web/src/components/mint/use-token-art.ts 'apps/web/src/app/collections/[id]/manage/mint-page/page.tsx' 'apps/web/src/app/collections/[id]/manage/page.tsx' 'apps/web/src/app/collections/[id]/deploy/page.tsx'
git commit -m "$(cat <<'EOF'
Save the Mint page tab as one draft with its media, sections and public switch, and read the row in the Overview and Deploy

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: the web app reports 787 tests in 87 files; the other packages are unchanged.

---

### Task 8: Sample mode's refusal, art and type switches, and every failure kind

**Files:**

- Modify (whole files): `apps/web/src/components/mint/sample-source.ts`, `sample-source.test.ts`
- Modify (one block): `apps/web/src/components/mint/sample-page.tsx` (the project type switch)
- Test: `sample-source.test.ts`

**Interfaces:**

- Consumes: Task 5's sample source and page, Task 6's tiers, Task 4's `MintFailureKind`.
- Produces: `SampleSwitches` gains `refusal: 'reading' | 'slow' | 'not-a-collection' | 'unavailable' | null`, `art: 'placeholder' | null` and `type: 'single_asset' | 'one_of_one' | null`, and `fail` takes every one of the fourteen kinds; `sampleSwitchesOf` reads `?refusal=`, `?art=` and `?type=`. `sampleMintSource` answers each refusal as the server would (final for the page load, retried with the panel's "keeps trying", or the first answer after 6 s), reads the placeholder's base URI with `?art=placeholder` (revealed otherwise, Decision 10), and fails the first mint attempt as each `?fail=` kind says, "Try again" then succeeding. `SampleMintPage` applies `?type=` to the page's project type.

- [ ] **Step 1: Write the failing test**

Replace the whole of `apps/web/src/components/mint/sample-source.test.ts` with:

```ts
import type { StateBody } from '@cobweb/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEMO_MINTER, DEMO_NOW, DEMO_VAULT } from '@/lib/demo'
import { mintCallOf, type MintParams } from '@/lib/mint/mint-call'
import { MintFailure, type MintFailureKind } from '@/lib/mint/mint-failure'
import { runMint } from '@/lib/mint/mint-run'
import type { MintPageStatic } from '@/lib/mint/page-doc'
import {
  sampleMintSource,
  sampleSwitchesOf,
  SAMPLE_PLACEHOLDER_URI,
  SAMPLE_REVEALED_URI,
  type SampleSwitches,
} from './sample-source'

const page = {
  slug: 'night-owls',
  chain: {
    id: 8453,
    name: 'Base',
    nativeSymbol: 'ETH',
    explorerUrl: 'https://basescan.org',
    transferLock: true,
  },
  contract: '0x4f2A9C7E1B3d5F6A8C0E2b4D6f8A1C3e5B7D9f0a',
} as unknown as MintPageStatic
const switches = (query = ''): SampleSwitches => sampleSwitchesOf(new URLSearchParams(query))
const params: MintParams = {
  contract: page.contract,
  chainId: page.chain.id,
  groupId: 1,
  amount: 1,
  vault: null,
  valueWei: 1_000n,
  account: DEMO_MINTER,
}

describe('sampleMintSource (docs/specs/2026-10-16-mint-page-live-data.md, section 8)', () => {
  let now = 0
  const clock = () => now
  beforeEach(() => {
    vi.useFakeTimers()
    now = 1_000_000
  })
  afterEach(() => vi.useRealTimers())

  /** Runs a promise's pauses on the fake timers, the sample's own clock moving with them; a rejection is the caller's. */
  async function settle<T>(promise: Promise<T>, ms = 10_000): Promise<T> {
    promise.catch(() => {})
    for (let step = 0; step < ms / 500; step++) {
      now += 500
      await vi.advanceTimersByTimeAsync(500)
    }
    return promise
  }
  async function state(source: ReturnType<typeof sampleMintSource>): Promise<StateBody> {
    const poll = await settle(source.pollState(), 500)
    if (poll.kind !== 'body') throw new Error(`no body: ${poll.kind}`)
    return poll.body
  }
  /** One mint through the page's own runMint on the sample's chain. */
  const mint = (source: ReturnType<typeof sampleMintSource>, overrides: Partial<MintParams> = {}) =>
    settle(
      runMint(
        source.chain,
        { ...params, ...overrides },
        { isLive: () => true, nextAnswer: async () => {} },
        { wallet: () => {}, sent: () => {} },
      ),
    )

  it('flips a scheduled group active 2 s after its start on its clock, which advances in real seconds', async () => {
    const source = sampleMintSource(page, switches('state=upcoming&start=30'), clock)
    const group = (body: StateBody) => body.groups.find((entry) => entry.startTimestamp === DEMO_NOW + 30)
    const first = await state(source)
    expect([first.blockTimestamp, group(first)?.active]).toEqual([DEMO_NOW, false])
    now = 1_000_000 + 31_000
    const atStart = await state(source)
    expect([atStart.blockTimestamp, group(atStart)?.active]).toEqual([DEMO_NOW + 31, false])
    now = 1_000_000 + 32_000
    expect(group(await state(source))?.active).toBe(true)
  })

  it('is revealed unless ?art=placeholder, and counts a confirmed mint from its block on', async () => {
    expect((await state(sampleMintSource(page, switches(), clock))).baseUri).toBe(SAMPLE_REVEALED_URI)
    const source = sampleMintSource(page, switches('art=placeholder'), clock)
    const before = await state(source)
    expect(before.baseUri).toBe(SAMPLE_PLACEHOLDER_URI)
    const result = await mint(source)
    expect(result.tokenIds).toEqual([before.totalMinted + 1])
    const after = await state(source)
    expect(after.totalMinted).toBe(before.totalMinted + 1)
    const wallet = await settle(source.pollWallet(DEMO_MINTER))
    expect(wallet.kind === 'body' && wallet.body.groups.find((entry) => entry.id === 1)?.claimed).toBe(2)
  })

  it('answers each ?refusal= as the server would: final, retried, or the first answer after 6 s', async () => {
    for (const refusal of ['not-a-collection', 'unavailable'] as const)
      expect(await settle(sampleMintSource(page, switches(`refusal=${refusal}`), clock).pollState())).toEqual(
        {
          kind: 'final',
          reason: refusal,
        },
      )
    expect(await settle(sampleMintSource(page, switches('refusal=slow'), clock).pollState())).toMatchObject({
      kind: 'retry',
    })
    const startedAt = now
    const reading = sampleMintSource(page, switches('refusal=reading'), clock)
    expect((await settle(reading.pollState())).kind).toBe('body')
    expect(now - startedAt).toBeGreaterThanOrEqual(6_000)
  })

  it('fails the first attempt as each ?fail= kind says, and lets "Try again" succeed', async () => {
    const kinds: MintFailureKind[] = [
      'rejected',
      'phase-closed',
      'sold-out',
      'quota-exceeded',
      'not-listed',
      'not-delegate',
      'price-changed',
      'insufficient-balance',
      'contract-wallet',
      'wrong-network',
      'check-failed',
      'wallet-failed',
      'reverted',
      'unconfirmed',
    ]
    for (const kind of kinds) {
      const source = sampleMintSource(page, switches(`fail=${kind}`), clock)
      const overrides = kind === 'not-delegate' ? { vault: DEMO_VAULT } : {}
      const failure = await mint(source, overrides).catch((error: unknown) => error)
      expect(failure, kind).toBeInstanceOf(MintFailure)
      expect((failure as MintFailure).kind, kind).toBe(kind)
      await expect(mint(source, overrides), kind).resolves.toMatchObject({ tokenIds: [expect.any(Number)] })
    }
    expect(mintCallOf(params).functionName).toBe('batchMint')
  })
})
```

- [ ] **Step 2: Run the test to see it fail**

Run: `pnpm --filter @cobweb/web exec vitest run src/components/mint/sample-source.test.ts`
Expected: FAIL. The flip at the start still passes; the reveal, the refusals and the failure kinds fail (the `sold-out` kind with `to be an instance of MintFailure` among them): `Tests  3 failed | 1 passed (4)`.

- [ ] **Step 3: The switches**

Replace the whole of `apps/web/src/components/mint/sample-source.ts` with:

```ts
import { DEFAULT_TRANSFER_VALIDATOR, type QuotaBody, type StateBody, type WalletBody } from '@cobweb/shared'
import { collectionAbi } from '@cobweb/shared/collection-abi'
import {
  ChainMismatchError,
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  encodeErrorResult,
  encodeEventTopics,
  UserRejectedRequestError,
  WaitForTransactionReceiptTimeoutError,
  zeroAddress,
  type Address,
  type Chain,
  type Hex,
  type TransactionReceipt,
} from 'viem'
import {
  DEMO_CREATOR,
  DEMO_DEPLOYMENT,
  DEMO_NOW,
  DEMO_PLACEHOLDER,
  DEMO_RENDER_JOBS,
  DEMO_TOKENS,
  getMintPageData,
  MINT_PAGE_VARIANTS,
  sampleTxHash,
  tokenLayerUrls,
  type MintGroup,
  type MintPageVariant,
  type WalletState,
} from '@/lib/demo'
import type { MintSource } from '@/lib/mint/live-source'
import type { MintCall } from '@/lib/mint/mint-call'
import type { MintFailureKind } from '@/lib/mint/mint-failure'
import type { MintChain } from '@/lib/mint/mint-run'
import type { MintPageStatic } from '@/lib/mint/page-doc'
import type { TokenArt } from '@/lib/mint/token-art'

/**
 * The sample-mode source (docs/specs/2026-10-16-mint-page-live-data.md, section 8): the same answers the live
 * source gives, made from `lib/demo`, so every state of the page can be reviewed without a wallet, a server or a
 * chain. Its clock advances in real seconds from `DEMO_NOW`, and a scheduled group reads active 2 s after its
 * start on that clock, as the chain would report it. Its chain simulates the check, the wallet and the receipt
 * with realistic pauses, and the mints it confirms join its answers from their block on.
 */

/** How the sample's wallet is connected: `null` follows a real connection with the sample's allowances. */
export type SampleWalletMode = 'connected' | 'not-listed' | 'limit' | 'wrong-chain' | null

/**
 * The query switches of the sample page, read in the browser from its own location, so the page's route stays
 * cached by link (components/mint/sample-page.tsx):
 *
 *   ?state=upcoming | allowlist-live | public-live | sold-out | closed   (default allowlist-live)
 *   ?wallet=connected     a sample wallet, connected without a real wallet
 *   ?wallet=not-listed    connected, but on no whitelist and with no vaults
 *   ?wallet=limit         connected, every allowance used
 *   ?wallet=wrong-chain   connected on another network
 *   ?fail=<kind>          the first mint attempt fails this way, any kind of the dialog's fourteen
 *                         (rejected, phase-closed, sold-out, quota-exceeded, not-listed, not-delegate,
 *                         price-changed, insufficient-balance, contract-wallet, wrong-network, check-failed,
 *                         wallet-failed, reverted, unconfirmed); "Try again" then succeeds
 *   ?degraded=1           the freshness server could not read the chain recently
 *   ?start=<seconds>      move the next scheduled start this close, to watch a countdown reach zero
 *   ?refusal=reading      the first answer takes 6 s; slow: no answer, so the page says it keeps trying;
 *                         not-a-collection | unavailable: the server refuses the collection for the page load
 *   ?art=placeholder      before the reveal: the placeholder's art, no featured tokens, no tiers
 *   ?type=single_asset | one_of_one   every token's number of the supply in place of its tier
 */
export type SampleSwitches = {
  variant: MintPageVariant
  wallet: SampleWalletMode
  degraded: boolean
  /** Moves the next scheduled start this many seconds after the sample's now. */
  start: number | null
  /** The first mint attempt fails this way; "Try again" then succeeds. */
  fail: MintFailureKind | null
  /** How the state answers, when it does not answer at once. */
  refusal: 'reading' | 'slow' | 'not-a-collection' | 'unavailable' | null
  /** Before the reveal; the sample is revealed otherwise. */
  art: 'placeholder' | null
  /** Another project type, for the rarity spot's alternative. */
  type: 'single_asset' | 'one_of_one' | null
}

const FAILURES: MintFailureKind[] = [
  'rejected',
  'phase-closed',
  'sold-out',
  'quota-exceeded',
  'not-listed',
  'not-delegate',
  'price-changed',
  'insufficient-balance',
  'contract-wallet',
  'wrong-network',
  'check-failed',
  'wallet-failed',
  'reverted',
  'unconfirmed',
]
const REFUSALS = ['reading', 'slow', 'not-a-collection', 'unavailable'] as const
const TYPES = ['single_asset', 'one_of_one'] as const
const WALLETS: Exclude<SampleWalletMode, null>[] = ['connected', 'not-listed', 'limit', 'wrong-chain']

/** The switches a query names; anything it does not name keeps its default. */
export function sampleSwitchesOf(query: URLSearchParams): SampleSwitches {
  const start = Number(query.get('start'))
  return {
    variant: MINT_PAGE_VARIANTS.find((variant) => variant === query.get('state')) ?? 'allowlist-live',
    wallet: WALLETS.find((mode) => mode === query.get('wallet')) ?? null,
    degraded: query.get('degraded') === '1',
    start: Number.isFinite(start) && start > 0 ? start : null,
    fail: FAILURES.find((kind) => kind === query.get('fail')) ?? null,
    refusal: REFUSALS.find((refusal) => refusal === query.get('refusal')) ?? null,
    art: query.get('art') === 'placeholder' ? 'placeholder' : null,
    type: TYPES.find((type) => type === query.get('type')) ?? null,
  }
}

/** The base URI before the reveal (the placeholder's one file) and after it (the rendered set). */
export const SAMPLE_PLACEHOLDER_URI = DEMO_DEPLOYMENT.baseUri
export const SAMPLE_REVEALED_URI = DEMO_RENDER_JOBS.done.baseUri

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** A simulation's revert as viem throws it, so the page reads it as the live one would. */
function revert(errorName: string, args: readonly unknown[], call: MintCall): ContractFunctionExecutionError {
  const data = encodeErrorResult({ abi: collectionAbi, errorName, args } as Parameters<
    typeof encodeErrorResult
  >[0])
  return new ContractFunctionExecutionError(
    new ContractFunctionRevertedError({ abi: collectionAbi, data, functionName: call.functionName }),
    { abi: collectionAbi, functionName: call.functionName, args: call.args, contractAddress: call.address },
  )
}

/** Where a sample failure strikes: the check, the wallet or the receipt, and the error it throws there. */
function sampleFailure(
  kind: MintFailureKind,
  call: MintCall,
  chainName: string,
): { at: 'check' | 'wallet' | 'receipt'; error: Error | null } {
  const [amount, group, vault] = call.args
  switch (kind) {
    case 'phase-closed':
      return { at: 'check', error: revert('MintGroupInactive', [group], call) }
    case 'sold-out':
      return { at: 'check', error: revert('ExceedsMintGroupMaxSupply', [amount, 1n], call) }
    case 'quota-exceeded':
      return { at: 'check', error: revert('ExceedsMintQuota', [amount, 1n], call) }
    case 'not-listed':
      return { at: 'check', error: revert('NotInWhitelist', [call.account, group], call) }
    case 'not-delegate':
      return { at: 'check', error: revert('NotDelegate', [call.account, vault ?? call.account], call) }
    case 'price-changed':
      return { at: 'check', error: revert('InsufficientEther', [call.value + 1n, call.value], call) }
    case 'insufficient-balance':
      return { at: 'check', error: new Error('insufficient funds for gas * price + value') }
    case 'contract-wallet':
      return { at: 'check', error: revert('TransferToNonERC721ReceiverImplementer', [], call) }
    case 'check-failed':
      return { at: 'check', error: new Error('The RPC did not answer.') }
    case 'rejected':
      return { at: 'wallet', error: new UserRejectedRequestError(new Error('User rejected the request.')) }
    case 'wrong-network':
      return {
        at: 'wallet',
        error: new ChainMismatchError({
          chain: { id: call.chainId, name: chainName } as Chain,
          currentChainId: 1,
        }),
      }
    case 'wallet-failed':
      return {
        at: 'wallet',
        error: Object.assign(new Error('The wallet could not sign.'), {
          shortMessage: 'The wallet could not sign the request.',
        }),
      }
    case 'reverted':
    case 'unconfirmed':
      return { at: 'receipt', error: null }
  }
}

/** The sample's wallet answer for any address: the sample minter's allowances, shaped by the wallet switch. */
function quotasOf(
  state: WalletState,
  mode: SampleWalletMode,
  publicMax: number,
): Omit<WalletBody, 'chainId' | 'address' | 'wallet' | 'block'> {
  const notListed = mode === 'not-listed'
  const limit = mode === 'limit'
  const groups: QuotaBody[] = state.groups.map((entry) => {
    const quota = entry.groupId === 0 || notListed ? 0 : entry.quota
    return { id: entry.groupId, quota, claimed: limit ? quota : Math.min(entry.used, quota) }
  })
  return {
    publicMinted: limit ? publicMax : state.publicMinted,
    groups,
    vaults: notListed
      ? []
      : state.delegatedVaults.map((vault) => ({
          vault: vault.vault,
          publicMinted: 0,
          groups: groups.map((entry) => {
            const own = vault.groups.find((candidate) => candidate.groupId === entry.id)
            const quota = own?.quota ?? 0
            return { id: entry.id, quota, claimed: limit ? quota : (own?.used ?? 0) }
          }),
        })),
  }
}

/** A sample token's art: its preview, or its layers stacked; the placeholder's image before the reveal. */
export async function sampleTokenArt(baseUri: string, id: number): Promise<TokenArt | null> {
  if (baseUri === SAMPLE_PLACEHOLDER_URI) return { layers: [DEMO_PLACEHOLDER.imageUrl], video: false }
  const token = DEMO_TOKENS[id - 1]
  if (!token) return null
  return { layers: token.previewUrl ? [token.previewUrl] : tokenLayerUrls(token.dna), video: false }
}

/** The sample source for a page. `now` is the wall clock, so the sample's chain time moves in real seconds. */
export function sampleMintSource(
  page: MintPageStatic,
  switches: SampleSwitches,
  now: () => number = Date.now,
): MintSource {
  const startedAt = now()
  const data = getMintPageData(page.slug, switches.variant)
  let groups: MintGroup[] = data.groups
  if (switches.start !== null) {
    const next = groups
      .filter((group) => !group.active && group.scheduledStart > DEMO_NOW)
      .sort((a, b) => a.scheduledStart - b.scheduledStart)[0]
    if (next)
      groups = groups.map((group) =>
        group.id === next.id
          ? { ...group, scheduledStart: DEMO_NOW + Math.floor(switches.start ?? 0) }
          : group,
      )
  }
  /** The mints the sample's chain confirmed, joining its answers from their block on. */
  const mints: { groupId: number; holder: Address; count: number; block: number }[] = []
  let nextTokenId = data.supply.minted + 1
  let failuresLeft = switches.fail === 'phase-closed' ? 2 : switches.fail ? 1 : 0
  /** The receipt's own failure for the attempt that sent it: reverted, or never confirmed. */
  let failNextReceipt: 'reverted' | 'unconfirmed' | null = null
  let txSeed = 0
  /** The calls the sample's wallet sent, by hash, for their receipts. */
  const pending = new Map<Hex, MintCall>()

  const elapsed = () => Math.floor((now() - startedAt) / 1_000)
  const blockNow = () => 1_000 + elapsed()
  const landed = (block: number) => mints.filter((mint) => mint.block <= block)
  const mintedBy = (block: number, holder: Address, groupId: number) =>
    landed(block)
      .filter((mint) => mint.groupId === groupId && mint.holder.toLowerCase() === holder.toLowerCase())
      .reduce((sum, mint) => sum + mint.count, 0)

  const chain: MintChain = {
    simulate: async (call) => {
      await wait(900)
      const failure =
        switches.fail && failuresLeft > 0 ? sampleFailure(switches.fail, call, page.chain.name) : null
      if (failure) failuresLeft -= 1
      if (failure?.at === 'check' && failure.error) throw failure.error
      if (failure?.at === 'receipt')
        failNextReceipt = switches.fail === 'unconfirmed' ? 'unconfirmed' : 'reverted'
      return async () => {
        await wait(1_600)
        if (failure?.at === 'wallet' && failure.error) throw failure.error
        txSeed += 1
        const hash = sampleTxHash(9_000 + txSeed)
        pending.set(hash, call)
        return hash
      }
    },
    receipt: async (hash) => {
      await wait(2_200)
      const call = pending.get(hash)
      const block = blockNow() + 1
      const failing = failNextReceipt
      failNextReceipt = null
      if (failing === 'unconfirmed') throw new WaitForTransactionReceiptTimeoutError({ hash })
      if (!call || failing === 'reverted')
        return { status: 'reverted', blockNumber: BigInt(block), logs: [] } as unknown as TransactionReceipt
      const [amount, group, vault] = call.args
      const count = Number(amount)
      mints.push({ groupId: Number(group), holder: vault ?? call.account, count, block })
      const logs = Array.from({ length: count }, (_, index) => ({
        address: call.address,
        data: '0x' as Hex,
        topics: encodeEventTopics({
          abi: collectionAbi,
          eventName: 'Transfer',
          args: { from: zeroAddress, to: call.account, tokenId: BigInt(nextTokenId + index) },
        }),
      }))
      nextTokenId += count
      return { status: 'success', blockNumber: BigInt(block), logs } as unknown as TransactionReceipt
    },
  }
  return {
    async pollState() {
      await wait(150)
      if (switches.refusal === 'not-a-collection' || switches.refusal === 'unavailable')
        return { kind: 'final', reason: switches.refusal }
      if (switches.refusal === 'slow') return { kind: 'retry', afterMs: 1_000, reason: 'not-read-yet' }
      // The first answer takes 6 s, so "Reading the chain" can be reviewed.
      if (switches.refusal === 'reading') await wait(Math.max(0, startedAt + 6_000 - now()))
      const seconds = elapsed()
      const block = 1_000 + seconds
      const blockTimestamp = DEMO_NOW + seconds
      const wall = Math.floor(now() / 1_000)
      const minted = landed(block).reduce((sum, mint) => sum + mint.count, 0)
      const body: StateBody = {
        chainId: page.chain.id,
        address: page.contract,
        block,
        blockTimestamp,
        readAt: switches.degraded ? wall - 4 * 60 : wall,
        degraded: switches.degraded,
        maxSupply: data.supply.max,
        totalMinted: Math.min(data.supply.max, data.supply.minted + minted),
        publicMaxMintPerWallet: data.publicMaxMintPerWallet,
        mintFeeFlatWei: data.fees.mintFeeFlatWei,
        mintFeeBps: data.fees.mintFeeBps,
        airdropFeePerTokenWei: data.fees.airdropFeePerTokenWei,
        mintOnBehalfActive: false,
        groups: groups.map((group) => ({
          id: group.id,
          priceWei: group.priceWei,
          maxSupply: group.maxSupply,
          minted:
            group.minted +
            landed(block)
              .filter((mint) => mint.groupId === group.id)
              .reduce((sum, mint) => sum + mint.count, 0),
          startTimestamp: group.scheduledStart,
          flag: group.flag,
          active: group.active || (group.scheduledStart > 0 && blockTimestamp >= group.scheduledStart + 2),
        })),
        owner: DEMO_CREATOR,
        royalty: { receiver: DEMO_DEPLOYMENT.royaltyReceiver, bps: DEMO_DEPLOYMENT.royaltyBps },
        baseUri: switches.art === 'placeholder' ? SAMPLE_PLACEHOLDER_URI : SAMPLE_REVEALED_URI,
        transferValidator: DEFAULT_TRANSFER_VALIDATOR,
        transferLevel: 0,
      }
      return { kind: 'body', body, ageSeconds: 0 }
    },

    async pollWallet(wallet) {
      await wait(300)
      const block = blockNow()
      const quotas = quotasOf(data.wallet!, switches.wallet, data.publicMaxMintPerWallet)
      return {
        kind: 'body',
        body: {
          chainId: page.chain.id,
          address: page.contract,
          wallet,
          block,
          publicMinted: quotas.publicMinted + mintedBy(block, wallet, 0),
          groups: quotas.groups.map((entry) => ({
            ...entry,
            claimed: entry.claimed + mintedBy(block, wallet, entry.id),
          })),
          vaults: quotas.vaults.map((vault) => ({
            ...vault,
            groups: vault.groups.map((entry) => ({
              ...entry,
              claimed: entry.claimed + mintedBy(block, vault.vault, entry.id),
            })),
          })),
        },
      }
    },

    chain,

    async tiers(baseUri, ids) {
      if (baseUri !== SAMPLE_REVEALED_URI) return null
      const ranks: Record<number, number> = {}
      for (const id of ids.slice(0, 20)) {
        const token = DEMO_TOKENS[id - 1]
        if (token) ranks[id] = token.rank
      }
      return { total: DEMO_TOKENS.length, ranks }
    },

    tokenArt: sampleTokenArt,
  }
}
```

In `apps/web/src/components/mint/sample-page.tsx`, replace:

```tsx
  )
  if (!switches) return <MintPageSkeleton />
  return <MintPage page={page} sample={switches} />
}
```

with:

```tsx
  )
  if (!switches) return <MintPageSkeleton />
  return <MintPage page={switches.type ? { ...page, projectType: switches.type } : page} sample={switches} />
}
```

- [ ] **Step 4: Run the test to see it pass, then typecheck and lint the web app**

Run: `pnpm --filter @cobweb/web exec vitest run src/components/mint/sample-source.test.ts`
Expected: PASS, `Tests  4 passed (4)`.

Run: `pnpm --filter @cobweb/web typecheck && pnpm --filter @cobweb/web lint`
Expected: no errors and no warnings.

- [ ] **Step 5: Format, run the root checks and commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
pnpm exec prettier --write apps/web/src/components/mint/sample-source.ts apps/web/src/components/mint/sample-source.test.ts apps/web/src/components/mint/sample-page.tsx
pnpm typecheck && pnpm lint && pnpm test
git add apps/web/src/components/mint/sample-source.ts apps/web/src/components/mint/sample-source.test.ts apps/web/src/components/mint/sample-page.tsx
git commit -m "$(cat <<'EOF'
Add sample mode's refusal, art and type switches and every failure kind of the mint dialog

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: the web app reports 789 tests in 87 files; the other packages are unchanged.

---

### Task 9: The chain fixture's wagmi wallet and `verify:mint-page`

**Files:**

- Create: `apps/web/scripts/verify-mint-page.ts`
- Modify: `apps/web/package.json` (the script and the dev dependency), `pnpm-lock.yaml` (by `pnpm install --offline`), `apps/web/scripts/chain-fixture.ts` (the wallet), `CLAUDE.md` (the command and the buckets' comment)
- Test: `pnpm --filter @cobweb/web verify:mint-page`

**Interfaces:**

- Consumes: everything Tasks 1 to 8 produce that the page runs on (`presignMintPageMediaCore`, `saveMintPageCore`, `setMintPagePublishedCore`, `mediaUrl`, `ipfsGateway`, `pageDocSchema`, `pageStaticOf`, `ranksOf`, `liveMintSource`, `pollState`, `foldState`, `chainNowOf`, `cadenceMs`, `EMPTY_TRACK`, `NEXT_ANSWER_MAX_MS`, `liveOf`, `walletViewOf`, `runMint`, `MintFailure`, `wagmiMintChain`, `derivePhases`, `defaultPhaseId`, `deriveAction`, `quote`, `totalMinted`, `phaseCalls`); the deploy fixture (`deployedCollection`, `signIn`, `readLockCollection`, `refusal`, `removeFixtures`, `slugFor`, `admin`, `settings`) and the chain fixture (`chain`, `chainReady`, `check`, `runChecks`, `sendCall`, `factory`, `CID`, `HEX64`); `startFreshness` and `TIER_MS` (`@cobweb/freshness/server`); `createConfig`, `mock` and `connect` (`@wagmi/core`).
- Produces: in `chain-fixture.ts`, `wagmiWallet(address: Address): Promise<Config>`: a wagmi config on Anvil with the mock connector connected as the address, which Anvil impersonates, so `wagmiMintChain` simulates through the transport and sends the simulated request through the connector; `scripts/verify-mint-page.ts` with the spec's seventeen checks (Decision 11); `"verify:mint-page": "node --conditions=react-server --import ./scripts/resolve-ts.mjs scripts/verify-mint-page.ts"`; `@wagmi/core` 2.22.1 in the web app's dev dependencies (Decision 13).

- [ ] **Step 1: The script**

The page's state loop runs without React as `useLiveState` runs it (the live source's polls at the page's cadence, each folded into the track), and the action is derived as the mint context derives it. The run deletes every row and object it creates; the collection stays on Anvil.

Create `apps/web/scripts/verify-mint-page.ts`:

```ts
// Checks the public mint page against LOCAL Supabase, LOCAL storage, a LOCAL Anvil chain and the freshness server
// in process (docs/specs/2026-10-16-mint-page-live-data.md, section 10): a creator deploys a collection of three
// tokens through the cores with Public (0.001 ETH, 2, 1 per wallet) and Holders (free, 1); the Mint page tab's
// cores sign, upload, save and publish its media and sections; then the page's own modules read it as the browser
// does: the document through its builder, the live source's polls at the page's cadence folded into the track, the
// labels at T-1 and at T, a mint through runMint and wagmiMintChain (the mock connector on the impersonated
// holder), the local mint, the wallet answers, two failed checks, the tiers and the refusals. Seventeen PASS lines
// with the cleanup.
//
//   supabase start && supabase seed buckets
//   pnpm --filter @cobweb/web chain:local    (then copy its two lines into apps/web/.env.local)
//   pnpm --filter @cobweb/web verify:mint-page
//
// The fixture (scripts/deploy-fixture.ts) reads the settings from the environment, `supabase status -o env` and
// apps/web/.env.local, and refuses non-local endpoints. Never prints a key. Deletes every row and object it
// creates; the collection stays on Anvil, and the chain's clock ends about 600 s ahead of where it was. Runs
// under `node --conditions=react-server --import ./scripts/resolve-ts.mjs`.

import { createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { encodeFunctionData, isAddressEqual, parseEther, type Address } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import type { StateBody } from '@cobweb/shared'
import { collectionAbi } from '@cobweb/shared/collection-abi'
import { startFreshness, TIER_MS, type Freshness, type HealthBody } from '@cobweb/freshness/server'
import type { Database } from '../src/lib/database.types.ts'
import {
  admin,
  chain,
  chainReady,
  check,
  CID,
  deployedCollection,
  factory,
  HEX64,
  readLockCollection,
  refusal,
  removeFixtures,
  rpc,
  runChecks,
  sendCall,
  settings,
  signIn,
  slugFor,
  wagmiWallet,
  type Creator,
  type Deployed,
  type DeployForm,
} from './deploy-fixture.ts'
import { clientOptions } from './render-deps.ts'

// The media URLs are Supabase Storage's public ones for the bucket, as the app's are without MINT_PAGE_MEDIA_URL.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= settings.url

const { presignMintPageMediaCore, saveMintPageCore, setMintPagePublishedCore } =
  await import('../src/lib/mint/settings-core.ts')
const { ipfsGateway, mediaUrl } = await import('../src/lib/mint/page-urls.ts')
const { pageDocSchema, pageStaticOf } = await import('../src/lib/mint/page-doc.ts')
const { ranksOf } = await import('../src/lib/mint/ranks-core.ts')
const { liveMintSource } = await import('../src/lib/mint/live-source.ts')
const { cadenceMs, chainNowOf, EMPTY_TRACK, foldState, NEXT_ANSWER_MAX_MS, pollState } =
  await import('../src/lib/mint/fresh-client.ts')
const { liveOf, walletViewOf } = await import('../src/lib/mint/live-data.ts')
const { runMint } = await import('../src/lib/mint/mint-run.ts')
const { MintFailure } = await import('../src/lib/mint/mint-failure.ts')
const { wagmiMintChain } = await import('../src/lib/mint/wagmi-chain.ts')
const { defaultPhaseId, deriveAction, derivePhases, quote, totalMinted } =
  await import('../src/components/mint/model.ts')
const { formatNative } = await import('../src/lib/demo/helpers.ts')
const { phaseCalls } = await import('../src/lib/manage/phase-calls.ts')
const { readArtRows } = await import('../src/lib/art/read-rows.ts')
const { toProject } = await import('../src/lib/art/rows.ts')
const { mintPageBucket } = await import('../src/lib/storage/config.ts')
const { deleteObjects, headObject } = await import('../src/lib/storage/objects.ts')
const { NOT_DEPLOYED, NOT_FOUND, PAGE_FILE_MISSING } = await import('../src/lib/art/result.ts')
type MediaAsk = import('../src/lib/mint/settings-core.ts').MediaAsk
type MintPageInput = import('../src/lib/mint/settings-core.ts').MintPageInput
type MediaSlot = import('../src/lib/mint/media.ts').MediaSlot
type MintPageStatic = import('../src/lib/mint/page-doc.ts').MintPageStatic
type MintSource = import('../src/lib/mint/live-source.ts').MintSource
type MintChain = import('../src/lib/mint/mint-run.ts').MintChain
type MintResult = import('../src/lib/mint/mint-run.ts').MintResult
type MintCall = import('../src/lib/mint/mint-call.ts').MintCall
type MintParams = import('../src/lib/mint/mint-call.ts').MintParams
type MintFailureInstance = import('../src/lib/mint/mint-failure.ts').MintFailure
type FreshTrack = import('../src/lib/mint/fresh-client.ts').FreshTrack
type MintLive = import('../src/lib/mint/live-data.ts').MintLive
type WalletView = import('../src/lib/mint/live-data.ts').WalletView
type LocalMint = import('../src/lib/mint/live-data.ts').LocalMint
type PhasesContext = import('../src/lib/manage/phases-core.ts').PhasesContext

/** The launch groups: Public (id 0) and Holders (id 1). */
const PUBLIC = 0
const HOLDERS = 1
const PUBLIC_PRICE = 1_000_000_000_000_000n
const REAL = `ipfs://${CID('e')}/`
const DESCRIPTION = 'Three owls on a local chain.'
/** How long the page may take to read a block at T: one 1 s tick of the server, one 1 s poll and the reads. */
const LIVE_WITHIN_MS = 2_500
/**
 * How long the page may take to read the block at T-1: nothing is live and the start is 600 s away, so the chain
 * ticks at the idle tier until the server reads that block (then the start's window is open and it ticks every
 * second), and the page polls every 3 s until it reads it; then the reads.
 */
const START_WITHIN_MS = TIER_MS.idle + 3_000 + 2_000
/** How long the page may take to read a change: one 2 s tick of a live chain, one 3 s poll and the reads. */
const CHANGE_WITHIN_MS = TIER_MS.live + 3_000 + 3_000
/** The fields of `public.mint_page`'s document, and nothing else. */
const DOC_KEYS = [
  'slug',
  'name',
  'symbol',
  'projectType',
  'chainId',
  'contract',
  'description',
  'media',
  'socials',
  'featuredTokenIds',
  'sections',
  'phases',
  'placeholders',
  'published',
]
  .sort()
  .join(' ')

const creatorKey = privateKeyToAccount(generatePrivateKey())
const holderKey = privateKeyToAccount(generatePrivateKey())
const strangerKey = privateKeyToAccount(generatePrivateKey())
/** The publishable key's client with no session: what a visitor reads with. */
const anon = createClient<Database>(settings.url, settings.publishableKey, clientOptions)
const bucket = mintPageBucket()
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// A 1 x 1 transparent PNG; each file appends its own label after the image's end, so each has its own hash.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)
/** An MPEG audio frame header. */
const MP3 = Buffer.from([0xff, 0xfb, 0x90, 0x64])

/** A file the run uploads: its slot, type, bytes and the dimensions the browser would measure. */
type Upload = { slot: MediaSlot; mime: string; body: Buffer; width: number | null; height: number | null }
const image = (slot: MediaSlot, label: string): Upload => ({
  slot,
  mime: 'image/png',
  body: Buffer.concat([PNG, Buffer.from(label)]),
  width: 1500,
  height: 1500,
})
const askOf = (file: Upload): MediaAsk => ({
  slot: file.slot,
  mime: file.mime,
  bytes: file.body.byteLength,
  width: file.width,
  height: file.height,
  contentHash: createHash('sha256').update(file.body).digest('hex'),
})

/** Every key the run stored in the bucket, so the cleanup deletes them. */
const storedKeys = new Set<string>()

const put = (url: string, mime: string, body: Buffer) =>
  fetch(url, { method: 'PUT', body: new Uint8Array(body), headers: { 'Content-Type': mime } })

/** Signs the files through the core, PUTs each one the bucket does not hold yet, and answers their keys in order. */
async function upload(ctx: PhasesContext, files: Upload[]): Promise<string[]> {
  const signed = await presignMintPageMediaCore(ctx, files.map(askOf))
  if (!('data' in signed)) throw new Error(`presign: ${refusal(signed)}`)
  for (const [index, { key, putUrl }] of signed.data.entries()) {
    const file = files[index]!
    if (putUrl) {
      const stored = await put(putUrl, file.mime, file.body)
      if (!stored.ok) throw new Error(`PUT ${key}: ${stored.status}`)
    }
    storedKeys.add(key)
  }
  return signed.data.map(({ key }) => key)
}

/** A media URL read with no session: its status, type and bytes. */
async function readMedia(key: string): Promise<{ status: number; mime: string | null; body: Buffer }> {
  const response = await fetch(mediaUrl(key), { signal: AbortSignal.timeout(5_000) })
  return {
    status: response.status,
    mime: response.headers.get('content-type'),
    body: Buffer.from(await response.arrayBuffer()),
  }
}

/** The owner check the Mint page tab's actions run first (`ownedCollection`): the collection's owner, else not found. */
async function ownership(creator: Creator, cid: string): Promise<string> {
  const collection = await readLockCollection(creator.client, cid)
  return collection && collection.owner_id === creator.userId ? 'owned' : NOT_FOUND
}

/**
 * The real job's id and its ranks as `ranksOf` computes them over the stored list (a generative job's is the
 * collection's `tokens` rows, which the lock keeps) and the collection's layers.
 */
async function expectedRanks(
  creator: Creator,
  deployed: Deployed,
): Promise<{ jobId: string; ranks: number[] }> {
  const job = await admin
    .from('render_jobs')
    .select('id')
    .eq('collection_id', deployed.cid)
    .eq('kind', 'real')
    .eq('state', 'done')
    .single()
  if (job.error) throw new Error(`the real job: ${job.error.message}`)
  const rows = await readArtRows(creator.client, deployed.cid)
  const tokens = rows.tokens.map((row) => ({ id: row.token_id, dna: row.dna }))
  const layers = toProject({ collection: deployed.ctx.collection, ...rows, tokens: [] }).layers ?? []
  return { jobId: job.data.id, ranks: ranksOf(tokens, layers) }
}

/** An answer the page accepted, when it folded it, and the chain clock then. */
type Seen = { body: StateBody; at: number; chainNow: number | null }

/**
 * The page's state loop without React, as useLiveState runs it: the live source's polls at the page's cadence
 * (`cadenceMs` over `derivePhases`), each folded into the track at `performance.now()`; a mint waiting for the
 * next answer polls at once. Every accepted answer is kept with the chain clock at its fold.
 */
function startPage(built: MintPageStatic, source: MintSource) {
  let track: FreshTrack = EMPTY_TRACK
  let running = true
  let wake = () => {}
  const seen: Seen[] = []
  const waiters: (() => void)[] = []
  const loop = (async () => {
    while (running) {
      const poll = await source.pollState()
      const now = performance.now()
      track = foldState(track, poll, now)
      if (poll.kind === 'body' && track.body === poll.body) {
        seen.push({ body: poll.body, at: now, chainNow: chainNowOf(track, now) })
        for (const resolve of waiters.splice(0)) resolve()
      }
      const phases = track.body ? derivePhases(liveOf(built, track.body), null, chainNowOf(track, now)) : []
      const ms = cadenceMs(track, phases)
      if (ms === null) return
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, ms)
        wake = () => {
          clearTimeout(timer)
          resolve()
        }
      })
    }
  })()
  return {
    seen,
    track: () => track,
    live: (): MintLive | null => (track.body ? liveOf(built, track.body) : null),
    isLive: (groupId: number) => !!track.body?.groups.some((group) => group.id === groupId && group.active),
    /** Polls at once, as the page does after a mint. */
    refresh: () => wake(),
    /** Resolves on the next accepted answer, or after 2 s, and polls at once (useLiveState's `nextAnswer`). */
    nextAnswer: () =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, NEXT_ANSWER_MAX_MS)
        waiters.push(() => {
          clearTimeout(timer)
          resolve()
        })
        wake()
      }),
    /** The first answer accepted from index `from` on (by default, from now) that passes `test`, or null after `ms`. */
    async until(test: (entry: Seen) => boolean, ms: number, from = seen.length): Promise<Seen | null> {
      const end = performance.now() + ms
      for (;;) {
        const hit = seen.slice(from).find(test)
        if (hit) return hit
        if (performance.now() >= end) return null
        await wait(25)
      }
    },
    async stop() {
      running = false
      wake()
      await loop
    },
  }
}
type Page = ReturnType<typeof startPage>

/** The page's action for a wallet as the mint context derives it: the default phase, one token, no vault. */
function actionOf(
  built: MintPageStatic,
  live: MintLive,
  wallet: WalletView | null,
  chainNow: number | null,
  local: LocalMint[] = [],
) {
  const phases = derivePhases(live, wallet, chainNow, local)
  const id = defaultPhaseId(phases)
  const phase = phases.find((entry) => entry.group.id === id) ?? null
  const action = deriveAction({
    page: built,
    live,
    phase,
    connected: true,
    walletRead: wallet !== null,
    wrongChain: false,
    quantity: 1,
    vault: null,
    soldOut: totalMinted(live, local) >= live.supply.max,
  })
  return { phase, action }
}

/** A wallet's answer through the live source, as allowances. */
async function walletOf(source: MintSource, address: Address): Promise<WalletView> {
  const poll = await source.pollWallet(address)
  if (poll.kind !== 'body') throw new Error(`the wallet answer for ${address}: ${poll.kind}`)
  return walletViewOf(poll.body)
}

/** A mint the page starts, run to its end: the result or the failure, and whether the wallet opened. */
async function tryMint(
  page: Page,
  mintChain: MintChain,
  params: MintParams,
): Promise<{ result?: MintResult; failure?: MintFailureInstance; walletOpened: boolean }> {
  const opened = { wallet: false }
  try {
    const result = await runMint(mintChain, params, page, {
      wallet: () => {
        opened.wallet = true
      },
      sent: () => {},
    })
    return { result, walletOpened: opened.wallet }
  } catch (error) {
    if (error instanceof MintFailure) return { failure: error, walletOpened: opened.wallet }
    throw error
  }
}

const publicLive = (body: StateBody) => body.groups.some((group) => group.id === PUBLIC && group.active)

let freshness: Freshness | null = null
let page: Page | null = null
/** What main set up, for the cleanup's check. */
let subject: { creator: Creator; deployed: Deployed; slug: string; jobId: string | null } | null = null

async function main(): Promise<void> {
  console.log(`Verifying the mint page on ${rpc} against ${settings.url}`)
  await check(
    '1. setup: Anvil answers as 31337 with the factory approving the shipped code hash, Supabase and the mint-page bucket answer, and the freshness server serves 31337 on a free port',
    async () => {
      const unready = await chainReady()
      if (unready) return unready
      const { data, error } = await admin.storage.getBucket(bucket)
      if (error || !data)
        return `the ${bucket} bucket: ${error?.message ?? 'missing'}; run supabase seed buckets`
      if (!data.public) return `the ${bucket} bucket is not public`
      const server = await startFreshness({ port: 0, host: '127.0.0.1', chainIds: [31337] })
      freshness = server
      const health = (await (await fetch(`${server.url}/health`)).json()) as HealthBody
      const served = health.chains.map((entry) => entry.chainId).join(' ')
      return Number(new URL(server.url).port) > 0 && served === '31337'
        ? null
        : `${server.url} serves ${served}`
    },
  )
  const server = freshness as Freshness | null
  if (!server) throw new Error('the freshness server did not start')

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
  const deployed = await deployedCollection(creator, form, 'mint page')
  const { cid, ctx } = deployed
  const contract = deployed.record.contractAddress
  const slug = slugFor(cid)
  const run = { creator, deployed, slug, jobId: null as string | null }
  subject = run

  await check(
    "2. unpublished: the link reads null from mint_page as anon, and the owner's preview reads it with published false",
    async () => {
      const read = await anon.rpc('mint_page', { p_slug: slug })
      if (read.error || read.data !== null) return `anon: ${read.error?.message ?? JSON.stringify(read.data)}`
      const preview = await creator.client.rpc('mint_page_preview', { p_slug: slug })
      if (preview.error) return `preview: ${preview.error.message}`
      const doc = pageDocSchema.safeParse(preview.data)
      return doc.success && doc.data.slug === slug && !doc.data.published
        ? null
        : `preview ${JSON.stringify(preview.data)}`
    },
  )

  let bannerKey = ''
  let avatarKey = ''
  await check(
    '3. media: a banner and an avatar are signed bound to type and length, put, and read without a session at their media URLs with their types; a 6 MB banner, an SVG and a WAV for the music are refused before signing',
    async () => {
      const banner = image('banner', 'banner one')
      const avatar = image('avatar', 'avatar')
      const signed = await presignMintPageMediaCore(ctx, [askOf(banner), askOf(avatar)])
      if (!('data' in signed)) return `presign: ${refusal(signed)}`
      const [forBanner, forAvatar] = signed.data
      if (!forBanner?.putUrl || !forAvatar?.putUrl) return `no PUT URL: ${JSON.stringify(signed.data)}`
      const otherType = await put(forBanner.putUrl, 'image/jpeg', banner.body)
      const longer = await put(forBanner.putUrl, banner.mime, Buffer.concat([banner.body, Buffer.from('!')]))
      if (otherType.ok || longer.ok)
        return `the URL took another type (${otherType.status}) or length (${longer.status})`
      for (const [entry, file] of [
        [forBanner, banner],
        [forAvatar, avatar],
      ] as const) {
        const stored = await put(entry.putUrl!, file.mime, file.body)
        if (!stored.ok) return `PUT ${entry.key}: ${stored.status}`
        storedKeys.add(entry.key)
        const read = await readMedia(entry.key)
        if (read.status !== 200 || read.mime !== file.mime || !read.body.equals(file.body))
          return `${entry.key} reads ${read.status} ${read.mime}`
      }
      bannerKey = forBanner.key
      avatarKey = forAvatar.key
      const refused: [MediaAsk, string][] = [
        [{ ...askOf(banner), bytes: 6 * 1024 * 1024 }, '6 MB is over the 5 MB limit.'],
        [{ ...askOf(banner), mime: 'image/svg+xml' }, 'Use a PNG, JPG, WebP or GIF image.'],
        [{ ...askOf(banner), slot: 'music', mime: 'audio/wav' }, 'Use an MP3 file.'],
      ]
      for (const [ask, sentence] of refused) {
        const outcome = await presignMintPageMediaCore(ctx, [ask])
        if (refusal(outcome) !== sentence) return `${ask.slot} ${ask.mime} ${ask.bytes}: ${refusal(outcome)}`
      }
      return null
    },
  )

  let draft: MintPageInput | null = null
  /** The draft check 4 saved, with the changes since. */
  const saved = (): MintPageInput => {
    if (!draft) throw new Error('nothing was saved in check 4')
    return draft
  }

  await check(
    "4. save: the description, the four links, featured tokens 1 and 2 and the five sections with a team photo and an MP3 are saved; another creator's save is refused as not found; a key never uploaded is refused",
    async () => {
      const [teamKey, musicKey] = await upload(ctx, [
        image('team', 'team photo'),
        {
          slot: 'music',
          mime: 'audio/mpeg',
          body: Buffer.concat([MP3, Buffer.from('theme')]),
          width: null,
          height: null,
        },
      ])
      const input: MintPageInput = {
        published: false,
        description: DESCRIPTION,
        media: { banner: bannerKey, avatar: avatarKey, about: null },
        socials: {
          website: 'https://owls.example',
          x: 'https://x.com/owls',
          discord: 'https://discord.gg/owls',
          telegram: 'https://t.me/owls',
        },
        featuredTokenIds: [1, 2],
        sections: {
          team: {
            enabled: true,
            members: [{ id: 'ada', name: 'Ada', role: 'Artist', bio: 'Draws owls.', imageKey: teamKey! }],
          },
          roadmap: {
            enabled: true,
            items: [{ id: 'mint', date: 'October', title: 'The mint', description: 'Three owls.' }],
          },
          faq: { enabled: true, items: [{ id: 'chain', question: 'Which chain?', answer: 'A local one.' }] },
          music: { enabled: true, key: musicKey!, fileName: 'theme.mp3' },
          carousel: { enabled: true, items: [{ id: 'first', kind: 'token', tokenId: 1 }] },
        },
      }
      const outcome = await saveMintPageCore(ctx, input)
      if (!('data' in outcome)) return `save: ${refusal(outcome)}`
      const view = outcome.data
      const { sections } = view
      const read = [
        view.description,
        JSON.stringify(view.socials),
        view.featuredTokenIds.join(' '),
        view.media.banner?.key,
        view.media.avatar?.key,
        sections.team.members[0]?.imageUrl,
        sections.music.url,
        [sections.team, sections.roadmap, sections.faq, sections.music, sections.carousel]
          .map((section) => section.enabled)
          .join(' '),
        [sections.roadmap.items, sections.faq.items, sections.carousel.items]
          .map((items) => items.length)
          .join(' '),
      ]
      const want = [
        DESCRIPTION,
        JSON.stringify(input.socials),
        '1 2',
        bannerKey,
        avatarKey,
        mediaUrl(teamKey!),
        mediaUrl(musicKey!),
        'true true true true true',
        '1 1 1',
      ]
      if (JSON.stringify(read) !== JSON.stringify(want)) return `saved ${JSON.stringify(read)}`
      draft = input
      if ((await ownership(stranger, cid)) !== NOT_FOUND) return "the stranger's owner check passed"
      const forged: PhasesContext = {
        supabase: stranger.client,
        service: () => admin,
        owner: stranger.userId,
        wallet: strangerKey.address.toLowerCase(),
        collection: ctx.collection,
      }
      const taken = await saveMintPageCore(forged, { ...input, description: 'Taken.' })
      if (refusal(taken) !== NOT_DEPLOYED) return `the stranger's save through the core: ${refusal(taken)}`
      await stranger.client.from('mint_pages').update({ description: 'Taken.' }).eq('collection_id', cid)
      const missing = await saveMintPageCore(ctx, {
        ...input,
        media: { ...input.media, about: `${cid}/${HEX64(4242)}.png` },
      })
      if (refusal(missing) !== PAGE_FILE_MISSING) return `a key never uploaded: ${refusal(missing)}`
      const row = await admin
        .from('mint_pages')
        .select('description, about_banner_key')
        .eq('collection_id', cid)
        .single()
      return row.data?.description === DESCRIPTION && row.data.about_banner_key === null
        ? null
        : `the row reads ${JSON.stringify(row.data)}`
    },
  )

  await check(
    "5. publish: anon reads the document, readMintPage's builder turns keys into media URLs, the phases read Public then Holders, placeholders is empty (deployed on the real set), no private field is present, and the ranks are recorded",
    async () => {
      const published = await setMintPagePublishedCore(ctx, true)
      if (!('data' in published)) return `publish: ${refusal(published)}`
      const read = await anon.rpc('mint_page', { p_slug: slug })
      if (read.error || read.data === null) return `anon: ${read.error?.message ?? 'null'}`
      const doc = pageDocSchema.parse(read.data)
      const built = pageStaticOf(doc, { media: mediaUrl, gateway: ipfsGateway() })
      if (!built) return 'the builder does not list chain 31337'
      const input = saved()
      const urls = [
        built.bannerUrl,
        built.avatarUrl,
        built.sections.team?.[0]?.imageUrl,
        built.sections.music?.url,
      ]
      const wantUrls = [
        bannerKey,
        avatarKey,
        input.sections.team.members[0]!.imageKey!,
        input.sections.music.key!,
      ].map(mediaUrl)
      if (JSON.stringify(urls) !== JSON.stringify(wantUrls)) return `media URLs ${JSON.stringify(urls)}`
      const phases = [...built.phases]
        .sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity))
        .map((phase) => `${phase.onchain_id}:${phase.name}`)
        .join(' ')
      if (phases !== '0:Public 1:Holders') return `phases ${phases}`
      if (doc.placeholders.length) return `placeholders ${doc.placeholders.join(' ')}`
      const keys = Object.keys(read.data as object)
        .sort()
        .join(' ')
      if (keys !== DOC_KEYS) return `the document's fields: ${keys}`
      const text = JSON.stringify(read.data).toLowerCase()
      const kept = [creator.userId, creatorKey.address, deployed.hash, CID('d'), CID('e')].filter((value) =>
        text.includes(value.toLowerCase()),
      )
      if (kept.length) return `the document holds ${kept.length} private value(s)`
      const { jobId, ranks } = await expectedRanks(creator, deployed)
      run.jobId = jobId
      const recorded = await admin.from('token_ranks').select('ranks').eq('job_id', jobId).maybeSingle()
      if (recorded.error) return `token_ranks: ${recorded.error.message}`
      return JSON.stringify(recorded.data?.ranks) === JSON.stringify(ranks)
        ? null
        : `ranks ${JSON.stringify(recorded.data?.ranks)}, expected ${JSON.stringify(ranks)}`
    },
  )

  await check(
    '6. replaced media: a save with a new banner deletes the old object, which no longer reads; the new one reads',
    async () => {
      const [newKey] = await upload(ctx, [image('banner', 'banner two')])
      const next: MintPageInput = {
        ...saved(),
        published: true,
        media: { ...saved().media, banner: newKey! },
      }
      const outcome = await saveMintPageCore(ctx, next)
      if (!('data' in outcome)) return `save: ${refusal(outcome)}`
      draft = next
      const old = await readMedia(bannerKey)
      const head = await headObject(bannerKey, { bucket })
      if (head || old.status === 200) return `the old banner reads ${old.status}`
      storedKeys.delete(bannerKey)
      bannerKey = newKey!
      const fresh = await readMedia(bannerKey)
      return fresh.status === 200 ? null : `the new banner reads ${fresh.status}`
    },
  )

  const doc = await anon.rpc('mint_page', { p_slug: slug })
  if (doc.error || doc.data === null) throw new Error(`the published page: ${doc.error?.message ?? 'null'}`)
  const built = pageStaticOf(pageDocSchema.parse(doc.data), { media: mediaUrl, gateway: ipfsGateway() })
  if (!built) throw new Error('the page does not list chain 31337')
  const holderChain = wagmiMintChain(await wagmiWallet(holderKey.address))
  const strangerChain = wagmiMintChain(await wagmiWallet(strangerKey.address))
  /** Every URL the live source fetched, in order. */
  const urls: string[] = []
  const source = liveMintSource(built, {
    freshnessUrl: server.url,
    chain: holderChain,
    supabase: anon,
    fetchImpl: (input, init) => {
      urls.push(String(input))
      return fetch(input, init)
    },
  })
  const view = startPage(built, source)
  page = view
  const mintOf = (groupId: number, amount: number, valueWei: bigint, account: Address): MintParams => ({
    contract,
    chainId: 31337,
    groupId,
    amount,
    vault: null,
    valueWei,
    account,
  })

  await check(
    "7. state: the live source reads the state at a lowercase URL; liveOf shows Public and Holders by name and position, the owner as the creator, 500 bps, revealed, no Transfers row (Anvil has no validator) and Public's quote",
    async () => {
      const first = await view.until(() => true, 5_000, 0)
      if (!first) return 'no state within 5 s'
      const stateUrl = `${server.url}/v1/state/31337/${contract.toLowerCase()}`
      if (urls[0] !== stateUrl) return `the first request was ${urls[0]}`
      const live = liveOf(built, first.body)
      const groups = live.groups.map((group) => `${group.id}:${group.name}`).join(' ')
      const [quoted] = await chain.readContract({
        address: contract,
        abi: collectionAbi,
        functionName: 'quoteBatchMint',
        args: [BigInt(PUBLIC), 1n],
        blockNumber: BigInt(first.body.block),
      })
      const publicQuote = quote(live, PUBLIC_PRICE.toString(), 1).totalWei
      return groups === '0:Public 1:Holders' &&
        isAddressEqual(live.creator, creatorKey.address) &&
        live.royaltyBps === 500 &&
        live.revealed &&
        live.transfers === null &&
        publicQuote === quoted
        ? null
        : `${groups} ${live.creator} ${live.royaltyBps} ${live.revealed} ${live.transfers} ${publicQuote} ${quoted}`
    },
  )

  const T = Number((await chain.getBlock()).timestamp) + 600
  await sendCall(creatorKey, contract, phaseCalls.schedule(PUBLIC, T))
  const holderBefore = await walletOf(source, holderKey.address)

  await check(
    "8. T-1: with Public scheduled at T and a block mined at T-1, the page's action reads 'Starts in 00:00:01', blocked, and nothing is sent",
    async () => {
      const nonce = await chain.getTransactionCount({ address: holderKey.address })
      await chain.setNextBlockTimestamp({ timestamp: BigInt(T - 1) })
      await chain.mine({ blocks: 1 })
      const atStart = await view.until((entry) => entry.body.blockTimestamp === T - 1, START_WITHIN_MS)
      if (!atStart) return `the block at T-1 was not read within ${START_WITHIN_MS} ms`
      const { phase, action } = actionOf(built, liveOf(built, atStart.body), holderBefore, atStart.chainNow)
      if (phase?.group.id !== PUBLIC || action.kind !== 'blocked' || action.label !== 'Starts in 00:00:01')
        return `${phase?.group.name}: ${action.kind} ${action.label}`
      const after = await chain.getTransactionCount({ address: holderKey.address })
      return after === nonce ? null : `the holder sent ${after - nonce} transaction(s)`
    },
  )

  await check(
    "9. T: a block mined at T is read by the page's 1 s polls with Public live within 2.5 s, the action reads 'Mint 1 for <total>', and no body with a block time below T read Public live",
    async () => {
      await chain.setNextBlockTimestamp({ timestamp: BigInt(T) })
      await chain.mine({ blocks: 1 })
      const minedAt = performance.now()
      const atT = await view.until(
        (entry) => entry.body.blockTimestamp >= T && publicLive(entry.body),
        LIVE_WITHIN_MS,
      )
      if (!atT || atT.at - minedAt > LIVE_WITHIN_MS)
        return `Public did not read live within ${LIVE_WITHIN_MS} ms of the block at T`
      const live = liveOf(built, atT.body)
      const { action } = actionOf(built, live, await walletOf(source, holderKey.address), atT.chainNow)
      const label = `Mint 1 for ${formatNative(quote(live, PUBLIC_PRICE.toString(), 1).totalWei, built.chain.nativeSymbol)}`
      if (action.kind !== 'mint' || action.label !== label) return `${action.label}, expected ${label}`
      const early = view.seen.filter((entry) => entry.body.blockTimestamp < T && publicLive(entry.body))
      return early.length === 0 ? null : `${early.length} answer(s) below T read Public live`
    },
  )

  await check(
    "10. price changed: the stranger's 1 from Public with one wei under the quote fails the check as price-changed and sends nothing (its nonce unchanged)",
    async () => {
      const live = view.live()
      if (!live) return 'no state'
      const total = quote(live, PUBLIC_PRICE.toString(), 1).totalWei
      const nonce = await chain.getTransactionCount({ address: strangerKey.address })
      const outcome = await tryMint(view, strangerChain, mintOf(PUBLIC, 1, total - 1n, strangerKey.address))
      const after = await chain.getTransactionCount({ address: strangerKey.address })
      return outcome.failure?.kind === 'price-changed' && !outcome.walletOpened && after === nonce
        ? null
        : `${outcome.failure?.kind ?? 'minted'}, wallet opened ${outcome.walletOpened}, nonce ${nonce} then ${after}`
    },
  )

  let minted: { result: MintResult; before: StateBody } | null = null
  await check(
    "11. mint: runMint through wagmiMintChain (the mock connector, the holder impersonated) mints 1 from Public; the sent transaction's calldata and value are the simulated request's, the value is the page's quote, and the id is 1",
    async () => {
      const before = view.track().body
      const live = view.live()
      if (!before || !live) return 'no state'
      const wallet = await walletOf(source, holderKey.address)
      const { action } = actionOf(built, live, wallet, chainNowOf(view.track(), performance.now()))
      if (action.kind !== 'mint') return `the action reads ${action.label}`
      const simulated: MintCall[] = []
      const watched: MintChain = {
        ...holderChain,
        simulate: (call) => {
          simulated.push(call)
          return holderChain.simulate(call)
        },
      }
      const outcome = await tryMint(
        view,
        watched,
        mintOf(PUBLIC, 1, action.quote.totalWei, holderKey.address),
      )
      if (!outcome.result) return `the mint failed: ${outcome.failure?.kind}`
      const [call] = simulated
      if (simulated.length !== 1 || call?.functionName !== 'batchMint')
        return `${simulated.length} simulation(s)`
      const sent = await chain.getTransaction({ hash: outcome.result.hash })
      const data = encodeFunctionData({
        abi: collectionAbi,
        functionName: 'batchMint',
        args: call.args as readonly [bigint, bigint],
      })
      view.refresh()
      minted = { result: outcome.result, before }
      return sent.input === data &&
        sent.value === call.value &&
        call.value === action.quote.totalWei &&
        isAddressEqual(sent.from, holderKey.address) &&
        sent.to !== null &&
        isAddressEqual(sent.to, contract) &&
        outcome.result.tokenIds.join(' ') === '1'
        ? null
        : `sent ${sent.input} ${sent.value} for ${call.value}, ids ${outcome.result.tokenIds.join(' ')}`
    },
  )

  await check(
    "12. after the mint: the local mint counts while the state's block is below the receipt's and not after, so minted reads 1 once; the holder's wallet answer reads publicMinted 1 and the action 'Wallet limit reached'",
    async () => {
      const mint = minted as { result: MintResult; before: StateBody } | null
      if (!mint) return 'no mint'
      const local: LocalMint[] = [
        {
          groupId: PUBLIC,
          holder: holderKey.address,
          count: mint.result.tokenIds.length || 1,
          block: mint.result.block,
        },
      ]
      const older = liveOf(built, mint.before)
      if (older.block >= mint.result.block) return `the state before the mint is at block ${older.block}`
      const caught = await view.until((entry) => entry.body.block >= mint.result.block, CHANGE_WITHIN_MS, 0)
      if (!caught) return `the receipt's block was not read within ${CHANGE_WITHIN_MS} ms`
      const newer = liveOf(built, caught.body)
      const counts = [totalMinted(older, local), newer.supply.minted, totalMinted(newer, local)].join(' ')
      if (counts !== '1 1 1') return `minted reads ${counts}`
      const wallet = await walletOf(source, holderKey.address)
      if (wallet.publicMinted !== 1) return `publicMinted ${wallet.publicMinted}`
      const { action } = actionOf(built, newer, wallet, caught.chainNow, local)
      return action.label === 'Wallet limit reached' ? null : `the action reads ${action.label}`
    },
  )

  await check(
    "13. whitelist: after the creator opens Holders and writes a quota of 2 for the holder, the holder's Holders phase reads eligible with 2 left and the stranger's not eligible, both with no vaults (Anvil has no registry)",
    async () => {
      await sendCall(creatorKey, contract, phaseCalls.open(HOLDERS))
      await sendCall(creatorKey, contract, phaseCalls.quotas(HOLDERS, [holderKey.address], [2]))
      const opened = await view.until(
        (entry) => entry.body.groups.some((group) => group.id === HOLDERS && group.active),
        CHANGE_WITHIN_MS,
        0,
      )
      if (!opened) return `Holders did not read live within ${CHANGE_WITHIN_MS} ms`
      const live = liveOf(built, opened.body)
      const holderView = await walletOf(source, holderKey.address)
      const strangerView = await walletOf(source, strangerKey.address)
      const holdersOf = (wallet: WalletView) =>
        derivePhases(live, wallet, opened.chainNow).find((phase) => phase.group.id === HOLDERS)
      const own = holdersOf(holderView)
      const other = holdersOf(strangerView)
      return own?.wallet?.eligible === true &&
        own.wallet.remaining === 2 &&
        own.vaults.length === 0 &&
        other?.wallet?.eligible === false &&
        other.vaults.length === 0 &&
        holderView.delegatedVaults.length === 0 &&
        strangerView.delegatedVaults.length === 0
        ? null
        : `${JSON.stringify(own?.wallet)} ${JSON.stringify(other?.wallet)}`
    },
  )

  await check(
    '14. over quota: 3 from Holders fails the check as quota-exceeded and sends nothing',
    async () => {
      const live = view.live()
      if (!live) return 'no state'
      const nonce = await chain.getTransactionCount({ address: holderKey.address })
      const outcome = await tryMint(
        view,
        holderChain,
        mintOf(HOLDERS, 3, quote(live, '0', 3).totalWei, holderKey.address),
      )
      const after = await chain.getTransactionCount({ address: holderKey.address })
      return outcome.failure?.kind === 'quota-exceeded' &&
        outcome.failure.detail.allowed === 2 &&
        !outcome.walletOpened &&
        after === nonce
        ? null
        : `${outcome.failure?.kind ?? 'minted'} ${JSON.stringify(outcome.failure?.detail)}, nonce ${nonce} then ${after}`
    },
  )

  await check(
    "15. tiers: the tiers read answers ids 1 and 2 at the real base URI with ranksOf's ranks over the stored list, and null at any other base URI",
    async () => {
      const { ranks } = await expectedRanks(creator, deployed)
      const tiers = await source.tiers(REAL, [1, 2])
      const other = await source.tiers(`ipfs://${CID('f')}/`, [1, 2])
      const want = { total: ranks.length, ranks: { 1: ranks[0], 2: ranks[1] } }
      return ranks.length === 3 && JSON.stringify(tiers) === JSON.stringify(want) && other === null
        ? null
        : `${JSON.stringify(tiers)} ${JSON.stringify(other)}, expected ${JSON.stringify(want)}`
    },
  )

  await check(
    "16. refusals: the factory's address reads final not-a-collection, and with the server closed a poll reads a retry after 1 s",
    async () => {
      const factoryPoll = await pollState(server.url, 31337, factory)
      if (factoryPoll.kind !== 'final' || factoryPoll.reason !== 'not-a-collection')
        return `the factory: ${JSON.stringify(factoryPoll)}`
      await view.stop()
      await server.close()
      freshness = null
      const closed = await pollState(server.url, 31337, contract)
      return closed.kind === 'retry' && closed.afterMs === 1_000 ? null : `closed: ${JSON.stringify(closed)}`
    },
  )
}

/** Unpublishes the page and reads it as anon and as the owner's preview, or says what happened instead. */
async function unpublished(run: NonNullable<typeof subject>): Promise<string | null> {
  const outcome = await setMintPagePublishedCore(run.deployed.ctx, false)
  if (!('data' in outcome)) return `unpublish: ${refusal(outcome)}`
  const read = await anon.rpc('mint_page', { p_slug: run.slug })
  if (read.error || read.data !== null) return `anon: ${read.error?.message ?? 'the document'}`
  const preview = await run.creator.client.rpc('mint_page_preview', { p_slug: run.slug })
  const doc = pageDocSchema.safeParse(preview.data)
  return doc.success && !doc.data.published && doc.data.description === DESCRIPTION
    ? null
    : `preview ${preview.error?.message ?? JSON.stringify(preview.data)}`
}

/** Deletes every object the run stored in the mint-page bucket, then its rows, or says what is left. */
async function removeAll(run: typeof subject): Promise<string | null> {
  const keys = [...storedKeys]
  await deleteObjects(keys, { bucket })
  for (const key of keys) if (await headObject(key, { bucket })) return `${key} is left in ${bucket}`
  const left = await removeFixtures()
  if (left || !run) return left
  const pages = await admin
    .from('mint_pages')
    .select('*', { count: 'exact', head: true })
    .eq('collection_id', run.deployed.cid)
  if (pages.error || pages.count) return `mint_pages: ${pages.error?.message ?? `${pages.count} left`}`
  if (!run.jobId) return null
  const ranks = await admin
    .from('token_ranks')
    .select('*', { count: 'exact', head: true })
    .eq('job_id', run.jobId)
  return ranks.error || ranks.count ? `token_ranks: ${ranks.error?.message ?? `${ranks.count} left`}` : null
}

async function cleanup(): Promise<void> {
  await page?.stop()
  await freshness?.close()
  await check(
    '17. unpublish: anon reads null again while the preview still reads the document; the fixtures are removed',
    async () => {
      const run = subject
      let problem: string | null = 'no collection was deployed'
      if (run) {
        try {
          problem = await unpublished(run)
        } catch (error) {
          problem = `threw ${error instanceof Error ? error.message : String(error)}`
        }
      }
      const left = await removeAll(run)
      return problem ?? left
    },
  )
}

await runChecks(main, cleanup)
```

- [ ] **Step 2: Run the script to see it fail**

Run: `pnpm --filter @cobweb/web exec node --conditions=react-server --import ./scripts/resolve-ts.mjs scripts/verify-mint-page.ts`
Expected: FAIL. The script stops before its first check with `SyntaxError: The requested module './deploy-fixture.ts' does not provide an export named 'wagmiWallet'`.

- [ ] **Step 3: The command and the dev dependency**

In `apps/web/package.json`, replace:

```json
    "verify:airdrop": "node --conditions=react-server --import ./scripts/resolve-ts.mjs scripts/verify-airdrop.ts",
    "verify:settings": "node --conditions=react-server --import ./scripts/resolve-ts.mjs scripts/verify-settings.ts",
    "verify:freshness": "node --conditions=react-server --import ./scripts/resolve-ts.mjs scripts/verify-freshness.ts"
  },
  "devDependencies": {
    "@cobweb/freshness": "workspace:^",
    "@ipld/car": "5.4.7",
    "@ipld/unixfs": "3.0.0",
    "@tailwindcss/postcss": "^4.3.3",
    "@types/react": "^19.3.0",
```

with:

```json
    "verify:airdrop": "node --conditions=react-server --import ./scripts/resolve-ts.mjs scripts/verify-airdrop.ts",
    "verify:settings": "node --conditions=react-server --import ./scripts/resolve-ts.mjs scripts/verify-settings.ts",
    "verify:freshness": "node --conditions=react-server --import ./scripts/resolve-ts.mjs scripts/verify-freshness.ts",
    "verify:mint-page": "node --conditions=react-server --import ./scripts/resolve-ts.mjs scripts/verify-mint-page.ts"
  },
  "devDependencies": {
    "@cobweb/freshness": "workspace:^",
    "@ipld/car": "5.4.7",
    "@ipld/unixfs": "3.0.0",
    "@wagmi/core": "2.22.1",
    "@tailwindcss/postcss": "^4.3.3",
    "@types/react": "^19.3.0",
```

Run: `pnpm install --offline`
Expected: the install ends `Done`, with the peer warnings the workspace already has.

Run: `git diff --stat pnpm-lock.yaml`
Expected: `pnpm-lock.yaml | 3 +++`: the web importer gains @wagmi/core at 2.22.1, the instance wagmi already resolves, and nothing else moves.

- [ ] **Step 4: The wagmi wallet**

In `apps/web/scripts/chain-fixture.ts`, replace:

```ts
// scripts that send to Anvil cannot drift: the local chain settings with a non-local endpoint refused (from
// chain-settings.ts, re-exported), the Anvil client, the PASS and FAIL lines, the payment and the factory
// call, a simulated request sent as it is, and a manage call simulated and sent as the manage machine does.
// deploy-fixture.ts re-exports it with the Supabase half; verify:freshness imports it alone, so it needs
// Anvil and nothing else. Never prints a key.

import {
  createTestClient,
```

with:

```ts
// scripts that send to Anvil cannot drift: the local chain settings with a non-local endpoint refused (from
// chain-settings.ts, re-exported), the Anvil client, the PASS and FAIL lines, the payment and the factory
// call, a simulated request sent as it is, a manage call simulated and sent as the manage machine does, and
// the mint page's wallet: a wagmi config with the mock connector on an impersonated address
// (docs/specs/2026-10-16-mint-page-live-data.md, section 10). deploy-fixture.ts re-exports it with the
// Supabase half; verify:freshness imports it alone, so it needs Anvil and nothing else. Never prints a key.

import { connect, createConfig, mock, type Config } from '@wagmi/core'
import {
  createTestClient,
```

In `apps/web/scripts/chain-fixture.ts`, replace:

```ts
    : `the factory does not approve ${COLLECTION_CODE_HASH}; run forge build, the copy script and chain:local again`
}
```

with:

```ts
    : `the factory does not approve ${COLLECTION_CODE_HASH}; run forge build, the copy script and chain:local again`
}

/**
 * The mint page's wallet on Anvil: a wagmi config on the local chain with the mock connector connected as the
 * address, which Anvil impersonates, so the page's `wagmiMintChain` simulates through the transport and sends
 * the simulated request through the connector, which hands `eth_sendTransaction` to Anvil as a wallet hands it
 * to its node. No key: Anvil signs for the impersonated address.
 */
export async function wagmiWallet(address: Address): Promise<Config> {
  await chain.impersonateAccount({ address })
  const local = { ...anvil, rpcUrls: { default: { http: [rpc] } } }
  const config = createConfig({
    chains: [local],
    connectors: [mock({ accounts: [address] })],
    transports: { [anvil.id]: http(rpc) },
    multiInjectedProviderDiscovery: false,
    storage: null,
  })
  const [connector] = config.connectors
  if (!connector) throw new Error('the mock connector is missing')
  await connect(config, { connector })
  return config
}
```

- [ ] **Step 5: Run the checks to see them pass**

Run: `pnpm --filter @cobweb/web verify:mint-page`
Expected: PASS, `17 passed, 0 failed` in about 50 s (check 8 waits for the server's idle tick); it moves Anvil's clock about 600 s ahead.

- [ ] **Step 6: CLAUDE.md**

In `CLAUDE.md`, replace:

```markdown
pnpm --filter @cobweb/web verify:local    # sign-in and access-rule checks; run after any migration change
pnpm --filter @cobweb/web verify:storage  # presigned PUT, HEAD, signed GET, delete, the 5 GB cap and the canvas, against local storage
supabase seed buckets                     # creates the local `art` and `render` buckets from config.toml (a restart alone does not)
pnpm --filter @cobweb/web chain:local     # Anvil with the factory deployed; prints the .env.local lines
pnpm --filter @cobweb/web verify:chain    # lock, pay and the refusals against Anvil
```

with:

```markdown
pnpm --filter @cobweb/web verify:local    # sign-in and access-rule checks; run after any migration change
pnpm --filter @cobweb/web verify:storage  # presigned PUT, HEAD, signed GET, delete, the 5 GB cap and the canvas, against local storage
supabase seed buckets                     # creates the local `art`, `render` and `mint-page` buckets from config.toml (a restart alone does not)
pnpm --filter @cobweb/web chain:local     # Anvil with the factory deployed; prints the .env.local lines
pnpm --filter @cobweb/web verify:chain    # lock, pay and the refusals against Anvil
```

In `CLAUDE.md`, replace:

````markdown
pnpm --filter @cobweb/freshness test      # the freshness server: tiers, the hot set, the ETag, degraded, the delegation filter, the wallet windows
pnpm --filter @cobweb/web verify:freshness   # the freshness server in process against Anvil: liveness at T-1 and at T, the ETag, the refusals, the wallet endpoint and degraded
pnpm --filter @cobweb/web render:local <collectionId>   # renders the collection's paid jobs on the laptop against local Supabase, local storage and Anvil; CARs go to a temp folder
```
````

with:

````markdown
pnpm --filter @cobweb/freshness test      # the freshness server: tiers, the hot set, the ETag, degraded, the delegation filter, the wallet windows
pnpm --filter @cobweb/web verify:freshness   # the freshness server in process against Anvil: liveness at T-1 and at T, the ETag, the refusals, the wallet endpoint and degraded
pnpm --filter @cobweb/web verify:mint-page   # the public page against local Supabase, local storage, Anvil and the freshness server in process: save, media and publish, liveness at T-1 and T, a mint through the page's path and the state after it, the tiers
pnpm --filter @cobweb/web render:local <collectionId>   # renders the collection's paid jobs on the laptop against local Supabase, local storage and Anvil; CARs go to a temp folder
```
````

- [ ] **Step 7: Format, run the root checks and commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
pnpm exec prettier --write apps/web/scripts/verify-mint-page.ts apps/web/scripts/chain-fixture.ts apps/web/package.json CLAUDE.md
pnpm typecheck && pnpm lint && pnpm test
git add apps/web/scripts/verify-mint-page.ts apps/web/scripts/chain-fixture.ts apps/web/package.json pnpm-lock.yaml CLAUDE.md
git commit -m "$(cat <<'EOF'
Add verify:mint-page on the chain fixture's wagmi wallet, with @wagmi/core as a dev dependency and the command in CLAUDE.md

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: test counts unchanged (web 789 in 87 files, shared 105, freshness 111).

---

### Task 10: The whole check list, the browser walk, MASTER_PLAN, the dated notes and the landing note

This task is the controller's: it runs every check, walks the page in the browser against the local services and records what it saw. The doc edits add dated sentences; nothing earlier is rewritten or deleted.

**Files:**

- Modify: `docs/MASTER_PLAN.md` (the Phase 6 status line; a dated Mint page decision)
- Modify: `docs/specs/2026-10-16-mint-page-live-data.md` (the acceptance boxes; the landing note)
- Modify: `docs/specs/2026-10-03-creator-flow-ui.md` (dated notes in sections 4.6, 4.7 and 13), `docs/specs/2026-10-14-deploy.md` (a dated note in section 12), `docs/specs/2026-10-16-freshness-server.md` (a dated note in section 12)

**Interfaces:**

- Consumes: everything Tasks 1 to 9 produce; the local services (`supabase start` with the `mint-page` bucket seeded, `pnpm --filter @cobweb/web chain:local` with its two lines in `apps/web/.env.local`); the freshness server (`pnpm --filter @cobweb/freshness dev`); the dev wallet in `apps/web/scripts/dev-wallet` (the one the earlier walks used); Foundry's `cast`, installed with Anvil.
- Produces: the docs.

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
```

Expected: tests pass (web 789 in 87 files, shared 105 in 14, freshness 111 in 11, dna 60, render 117, worker 282); the format check and the build pass, the build listing `● /[slug]` and `ƒ /[slug]/preview`; `verify:local` 379, `verify:chain` 12, `verify:storage` 15, `verify:sweep` 8, `verify:render` 22, `verify:deploy` 15, `verify:phases` 20, `verify:whitelist` 18, `verify:airdrop` 15 (with the gas line), `verify:settings` 17, `verify:freshness` 16 and `verify:mint-page` 17, each with `0 failed`. `verify:freshness` and `verify:mint-page` each move Anvil's clock about 600 s ahead, which the other scripts, reading chain time, do not mind.

- [ ] **Step 2: The browser walk**

The spec's section 10 walk, on live data. Three terminals at the repo root: the freshness server on Anvil, the dev wallet's signer as the owner of a deployed generative collection (one from the earlier walks, with the `DEV_WALLET_KEY` they used, or a new one through the flow and `render:local`), and the web app on live data:

```
export $(grep -E '^(RPC_URL_31337|FACTORY_ADDRESS_31337)=' apps/web/.env.local | xargs) && pnpm --filter @cobweb/freshness dev
DEV_WALLET_KEY=<that wallet's key> node apps/web/scripts/dev-wallet/signer.mjs
NEXT_PUBLIC_DEMO_DATA=0 NEXT_PUBLIC_FRESHNESS_URL=http://127.0.0.1:3100 pnpm --filter @cobweb/web dev
```

The page runs at `http://localhost:3000` (the signer answers that origin only), with `inject.js` added as the earlier walks did; switch the wallet to Anvil in the account menu. Anvil mines only when it receives a transaction, which is how the walk reaches T with no block at T. Walk each item and note what it showed:

1. The Mint page tab saves a description, a banner, an avatar (one under 400 by 400 is refused in the field), an About banner, the four links, featured tokens and the five sections with a team photo, a slide and an MP3; Preview shows them under its banner while `/<slug>` is not found.
2. Switch "Page is public" and save: `/<slug>` shows the page, its skeleton first, then the state.
3. Schedule Public 60 s ahead in Phases while no other transaction is sent: the page counts down on the chain clock; at T-1 the button reads "Starts in 00:00:01" and a click opens no wallet; at T it reads "Starting, waiting for the chain", since no block at T exists; mine one with `cast rpc evm_mine --rpc-url http://127.0.0.1:8545` and within about 2 s it reads "Mint 1 for ...".
4. Remind me on a scheduled phase: the Google Calendar link and the `.ics` file, named `<slug>-phase-<id>.ics`.
5. A mint through the wallet: check, wallet, confirming, then the success view with the token's art (the artwork pattern with its number when the gateway cannot reach the local CIDs) and its tier chip; the counts update and the action reads "Wallet limit reached" at the limit.
6. A listed and an unlisted wallet on a whitelist phase (the owner's address written in the Whitelist tab, then the page reloaded): "You are on this list" and "Not on this list".
7. A rejection and an over-quota check: the dev wallet signs whatever it is sent and the page caps the quantity at the allowance, so check their words in sample mode (`?wallet=connected&fail=rejected`, `?wallet=connected&fail=quota-exceeded`); `verify:mint-page` checks 10 and 14 send the live ones.
8. Stop the freshness server: the "Live status may be out of date" banner shows within about 10 s; restart it and the banner clears.
9. A phone width (390 px): the mint flow opens as a drawer, the sticky bar holds the action, and the root font is 14 px with no sideways scroll.
10. Sample mode (stop the web app and start it again without the two variables): `/night-owls` with each `?state=`, `?wallet=`, `?degraded=1`, `?start=10`, every `?refusal=`, `?art=placeholder`, both `?type=` and the fourteen `?fail=` kinds.

A step that does not behave as written is a defect: fix it in a new commit (or send it back to the task that owns it) before recording the landing.

- [ ] **Step 3: MASTER_PLAN**

Phase 6's status line gains the second sub-project's sentence after its first; the Mint page decisions gain a dated one.

In `docs/MASTER_PLAN.md`, replace:

```markdown
treats a 404 `not-a-collection` as final for that page load only. Next: the mint page on live data.
```

with:

```markdown
treats a 404 `not-a-collection` as final for that page load only. Next: the mint page on live data. Mint page on live data (second sub-project of three) landed on <date>; see [specs/2026-10-16-mint-page-live-data.md](specs/2026-10-16-mint-page-live-data.md). What exists: `mint_pages` (one row per collection, written by its owner within column checks and a guard trigger) and `token_ranks` (a done real job's ranks, recorded by the server through `token_ranks_record` when a published page is saved or a reveal is confirmed in Settings), read publicly only through `mint_page`, `mint_page_preview` and `mint_page_tiers`; the public `mint-page` bucket; the Mint page tab saving its description, banner, avatar, About banner, links, featured tokens and five sections as one draft with its files, its public switch and Preview at `/<slug>/preview`, the Overview and Deploy reading the row; `/<slug>` rendered from one read cached under its link's tag for 60 s and expired by the tab's saves; the browser's polls of the freshness server at 1 s before the first answer and within 60 s of a start and 3 s otherwise, liveness only from `active`, a chain clock for the labels, the page's own `degraded` after 10 s, and every refusal in words; the mint simulated with the state's quote and sent as the simulated request through wagmi, `delegateMint` for a delegated vault on a whitelist phase, the receipt's ids, local mints counted once, the fourteen failures in words; token art from each token's metadata through the IPFS gateway, tiers once revealed and "#<id> of <supply>" for a single asset or a 1/1; the sections, Remind me and the music button; `@cobweb/shared`'s wire types and paths; sample mode's switches; `verify:local` with 379 checks and `pnpm --filter @cobweb/web verify:mint-page` with 17. Known: the indexer, holders, recent mints, "Paid by minters" and per-recipient history are the third sub-project's, so the page shows the minted count from the state and no holder count or recent mints, and the Overview keeps holders and recent mints as sample; the owner's hosted steps (the `mint-page` R2 bucket, public on a custom domain with the art bucket's CORS rule; on Vercel `NEXT_PUBLIC_FRESHNESS_URL`, `MINT_PAGE_S3_BUCKET`, `MINT_PAGE_MEDIA_URL` and `IPFS_GATEWAY_URL`, then a rebuild; `supabase db push`; `NEXT_PUBLIC_DEMO_DATA=0` when production leaves sample mode); the full Content-Security-Policy with the page's origins, Cloudflare in front and a sweep of uploads never saved are Phase 7's; on a testnet before launch: delegated minting with a whole-wallet and a contract delegation, and the transfer level, which Anvil cannot show; tiers wait for a save of the published page or a reveal through Settings; edits in Phases reach the page within 60 s; the chain clock errs late by up to one server tick, and the banner's minutes and the `.ics` stamp use the browser's clock; the check and the receipt go to viem's public endpoints, which can rate-limit or fail; the check is retried once on `MintGroupInactive`; a hidden phase still mints for anyone who calls the contract; the first visit to a link after a revalidation costs one function and one database read. Next: the indexer and the Overview.
```

In `docs/MASTER_PLAN.md`, replace:

```markdown
- Under 640 px the page's root font is 14 px.
```

with:

```markdown
- Under 640 px the page's root font is 14 px.
- **The public page's data** (decided 16 October 2026; [specs/2026-10-16-mint-page-live-data.md](specs/2026-10-16-mint-page-live-data.md)). One definer read of a published page, cached by its tag; chain state only from the browser's polls of the freshness server; token art from metadata at the chain's base URI; rarity only for the revealed base URI.
```

- [ ] **Step 4: The dated notes**

In `docs/specs/2026-10-03-creator-flow-ui.md`, replace:

```markdown
and its proceeds come from the contract.

### 4.7 Public mint page (`/[slug]`)
```

with:

```markdown
and its proceeds come from the contract.

> **<date>:** The Mint page tab runs on real data ([2026-10-16-mint-page-live-data.md](2026-10-16-mint-page-live-data.md)). What changed from the sample: the five sections are saved with the page and shown on it, each when its switch is on and it has content; the files go to a public bucket with tighter caps (the banner, the About banner and slides 5 MB, the avatar and team photos 2 MB, an MP4 slide or the music 20 MB) and SVG is no longer taken, since a file on a public origin can carry script; an About banner joins the About panel; the token avatar the audit listed stays out; the public switch saves with the page, and Preview opens the owner's view at `/<slug>/preview` under a banner, public or not.

### 4.7 Public mint page (`/[slug]`)
```

In `docs/specs/2026-10-03-creator-flow-ui.md`, replace:

```markdown
3. The page makes no shared-state RPC calls.

## 5. Sample data contract
```

with:

```markdown
3. The page makes no shared-state RPC calls.

> **<date>:** The public mint page runs on live data ([2026-10-16-mint-page-live-data.md](2026-10-16-mint-page-live-data.md)): refusal panels while the chain is read, when the first answer is slow, when the chain does not confirm the collection and when live status is not available; Remind me on a scheduled phase (Google Calendar or an `.ics` file, nothing stored); and the rarity spot, each minted token's tier chip on a revealed generative collection, "Rarity shows after the reveal" before it, and "#<id> of <supply>" for a single asset or a 1/1.

## 5. Sample data contract
```

At the end of `docs/specs/2026-10-03-creator-flow-ui.md`, append:

```markdown

> **<date>:** The audit's Mint page items are settled by [2026-10-16-mint-page-live-data.md](2026-10-16-mint-page-live-data.md): the sections and their limits as listed above, with that spec's caps (section 4.4) in place of the forms' 20 MB and no SVG; text keeps its line breaks in place of rich text; the token avatar stays out; featured tokens are up to six, picked from the rendered set.
```

In `docs/specs/2026-10-14-deploy.md`, replace:

```markdown
- The fee snapshot in `deployments` is informational; the contract's `fees()` is the truth.
```

with:

```markdown
- The fee snapshot in `deployments` is informational; the contract's `fees()` is the truth.

> **<date>:** "Open mint page" returns ([2026-10-16-mint-page-live-data.md](2026-10-16-mint-page-live-data.md), section 7.9): the deployed view's link row opens the public page once it is public and reads "Not public yet. Make it public in Manage drop, Mint page." until then, and its next step reads "Add a banner and links, then make the page public."
```

In `docs/specs/2026-10-16-freshness-server.md`, replace:

```markdown
timeout on its server render's fetch, which can wait out a join.
```

with:

```markdown
timeout on its server render's fetch, which can wait out a join.

> **<date>:** Closed by [2026-10-16-mint-page-live-data.md](2026-10-16-mint-page-live-data.md): the database, the public read path and the mint page on the answers of 6.10 landed, with `NEXT_PUBLIC_FRESHNESS_URL` for the origin. The server render's timeout is moot: the page's HTML is cached by link and carries no chain state, and the first state is the browser's first poll.
```

- [ ] **Step 5: The acceptance boxes and the landing note**

In section 13 of `docs/specs/2026-10-16-mint-page-live-data.md`, change each `- [ ]` to `- [x]` whose criterion Steps 1 and 2 confirmed (all eight when everything passed). Then, after the list and before `## 14. Reconciliations with the rulings`, add one paragraph that starts `Checked on <date> on Anvil, local Supabase and its storage:` and records: the root checks with the web, shared and freshness test counts; the build; each verify script with its count; the walk's ten items as they behaved; the departures from the spec's letter (this plan's Decisions 2, 3, 6, 8 and 9); the hosted steps still owed (section 12's list); and any defect found with the commit that fixed it.

- [ ] **Step 6: Commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
git add docs/MASTER_PLAN.md docs/specs/2026-10-16-mint-page-live-data.md docs/specs/2026-10-03-creator-flow-ui.md docs/specs/2026-10-14-deploy.md docs/specs/2026-10-16-freshness-server.md
git commit -m "$(cat <<'EOF'
Record the mint page's landing in MASTER_PLAN, with its decision, in its spec and in the notes of the specs it changes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: `git show --stat HEAD` lists the five docs only; `git diff HEAD~1 -- docs/PLAN.md` prints nothing.

---

## Self-review

**Spec coverage.** Sections 1 to 3 (the goal, the 32 decisions, the scope): Tasks 1 to 10 as Decision 1 orders them. Section 4.1 (`mint_pages`), 4.2 (`token_ranks`), 4.3 (the functions) and 4.5 (the types): Task 1. Section 4.4 (storage): the bucket in Task 1, the slots, caps and keys in Task 2. Section 5 (the shared package): Task 3. Section 6.1 (the document, the media and the read): Task 2, with the preview's answer in Task 6. Section 6.2 (settings, media and publish): Task 2. Section 6.3 (the ranks): Task 2, Settings' call included. Section 6.4 (the routes): `/[slug]` in Task 5, the preview in Task 6. Section 7.1 (the freshness client and the live source): Task 4 and Task 5. Section 7.2 (the hooks): Task 5. Section 7.3 (what the page shows per answer): Task 5, the sample's refusals in Task 8. Section 7.4 (the page model): `live-data.ts` in Task 4, `model.ts` in Task 5. Section 7.5 (the mint action): the call, the run, the wagmi chain and the transports in Task 4, the flow in Task 5. Section 7.6 (failures): the kinds and their words in Task 4, the dialog in Task 5, every kind in the sample in Task 8. Section 7.7 (art, the reveal and rarity): `token-art.ts` and `tokenUriOf` in Task 4, the art stage and the gallery in Task 5, the rarity spot and the tiers in Task 6. Section 7.8 (sections, Remind me, Details and the preview banner): Task 6, Details in Task 5. Section 7.9 (the tab, the Overview, Deploy and Settings): Task 7, with Settings' ranks and the link's tag in Task 2. Section 8 (sample mode): Tasks 5 and 8, the tab's sample row in Task 7. Section 9 (stage rules): unchanged. Section 10 (testing): the unit tests in Tasks 2 to 8, `verify:local` in Task 1, `verify:mint-page` in Task 9, the walk and the check list in Task 10. Section 11 (documentation): `CLAUDE.md` in Task 9, `apps/web/.env.example` in Tasks 2 and 5, `turbo.json` left as it is (Decision 3), MASTER_PLAN, the dated notes and the landing note in Task 10. Section 12 (owed and known): the `Known:` list Task 10 writes into MASTER_PLAN. Section 13 (acceptance): Task 10. Section 14's reconciliations: 1 (the shell cached by tag, the first state from the browser's poll) Tasks 2 and 5; 2 (`http()` per chain) Task 4; 3 (the gateway as a server variable passed with the page, art from each token's metadata) Tasks 2 and 4; 4 (revealed means not a placeholder, the tiers checked against the real base URI on the server) Tasks 1 and 4; 5 (ranks recorded at a published page's save, at publish and at a confirmed reveal, one array per real job) Tasks 1 and 2; 6 (the media caps, no SVG, the preview route) Tasks 2, 6 and 7; 7 (the cadence and `degraded`) Task 4; 8 (a body at the same block taken without moving the clock) Task 4; 9 (the clock anchored on `blockTimestamp` plus `Age`) Task 4; 10 (vaults on whitelist phases only, local mints against both blocks, Coming up in the creator's order, Remind me storing nothing, the royalty sentence at level 0, the unlisted wallet, the sample's 2 s) Tasks 4, 5, 6 and 8; 11 (the wallet endpoint read on events) Task 5; 12 (the CSP left to Phase 7) Task 10's `Known:` list; 13 (three functions) Task 1; 14 (the wire types moved, `joinPhases`' rows widened, `tokenUriOf` by id, the token avatar left out) Tasks 2, 3, 4 and 7.

**Where this plan departs from the spec's letter.** `/[slug]` reads no query, so sample mode reads its switches in the browser (Decision 2); `turbo.json` is not touched (Decision 3); the media and gateway URLs and the tag live in `page-urls.ts`, which `page-read.ts` re-exports (Decision 6); `readMintPagePreview` answers the collection's id and null for a signed-out visitor before any read (Decision 8); the ranks are taken over the collection's `tokens` rows, a generative job's list, since such a job stores no `token_list` (Decision 9). Details the spec leaves open: the two-step write (Decision 4), the private schema's usage for the service role (Decision 5), the poll's 5 s limit (Decision 7), the verify's waits and its not-found check (Decision 11), the featured tokens' sizes (Decision 12), the dev dependency's version (Decision 13) and two tests beyond the spec's list (Decision 14).

**Placeholder scan.** No step says "add error handling" or "similar to Task N"; every code step shows a whole file or an exact anchor with its replacement. The only values filled at landing are Task 10's `<date>`, its acceptance boxes and its landing paragraph, each defined where it is used.

**Type consistency.** `PAGE_NOT_PUBLIC`, `RANKS_REFUSED`, `PAGE_LINK_FIRST`, `PAGE_FIELDS`, `PAGE_FILE_MISSING`, `PAGE_UPLOAD_FAILED`, `PhaseRow`, `MediaSlot`, `MEDIA_SLOTS`, `mintPageMediaProblem`, `mintPageKey`, `keyBelongs`, `mimeOfKey`, `StoredSections`, `SECTION_SCHEMAS`, `sectionsSchema`, `emptySections`, `storedSectionsOf`, `PageDoc`, `pageDocSchema`, `MintPageSections`, `MintPageStatic`, `pageSectionsOf`, `pageStaticOf`, `mintPageTag`, `mediaBase`, `mediaUrl`, `ipfsGateway`, `readMintPage`, `readMintPagePreview`, `ranksOf`, `ensureTokenRanksCore`, `mintPageBucket`, `MediaAsk`, `MediaRef`, `MintPageSettingsView`, `MintPageInput`, `MEDIA_ASKS_MAX`, `mediaAsksSchema`, `mintPageInputSchema`, `mintPageSettingsCore`, `presignMintPageMediaCore`, `saveMintPageCore`, `setMintPagePublishedCore`, `getMintPageSettings`, `presignMintPageMedia`, `saveMintPage`, `setMintPagePublished`, `StateBody`, `QuotaBody`, `WalletBody`, `RefusalCode`, `statePath`, `walletPath`, `causes`, `shortMessageOf`, `revertOf`, `tokenUriOf`, `transports`, `UNREACHABLE_AGE_S`, `RETRY_MAX_MS`, `OWN_DEGRADED_MS`, `NEXT_ANSWER_MAX_MS`, `POLL_TIMEOUT_MS`, `StatePoll`, `WalletPoll`, `pollState`, `pollWallet`, `FreshTrack`, `EMPTY_TRACK`, `foldState`, `chainNowOf`, `ownDegraded`, `cadenceMs`, `MintLive`, `WalletView`, `LocalMint`, `revealedOf`, `transfersOf`, `liveOf`, `walletViewOf`, `MintParams`, `MintCall`, `Quote`, `quoteOf`, `mintCallOf`, `mintedTokenIds`, `MintFailureKind`, `MintStep`, `MintFailure`, `revertNameOf`, `mintFailureOf`, `failureCopy`, `FailureAction`, `failureActions`, `MintChain`, `MintResult`, `runMint`, `wagmiMintChain`, `TokenArt`, `gatewayUrlOf`, `tokenArtOf`, `MintSource`, `Tiers`, `liveMintSource`, `Phase`, `derivePhases`, `deriveAction`, `defaultPhaseId`, `totalMinted`, `useLiveState`, `useWalletView`, `useTokenArt`, `SampleSwitches`, `sampleSwitchesOf`, `sampleMintSource`, `sampleTokenArt`, `SAMPLE_PLACEHOLDER_URI`, `SAMPLE_REVEALED_URI`, `SampleMintPage`, `MintPageProps`, `MintProvider`, `useMint`, `useMintFlow`, `TokenArtFrame`, `samplePageStatic`, `Reminder`, `icsOf`, `googleCalendarUrl`, `icsFileName`, `RemindMe`, `PageSections`, `MusicButton`, `PreviewBanner`, `MintPageDraft`, `DraftFile`, `draftOf`, `pickedFiles`, `mediaAskOf`, `inputOf`, `socialError`, `draftInvalid`, `MintPageScreen`, `sampleMintPageView` and `wagmiWallet` are spelled the same in every task that uses them.

**Review Focus.** Five lines, each with its test in the owning task: a poll that hangs (Task 4, `fresh-client.test.ts`), a wallet answer for another wallet (Task 4, `fresh-client.test.ts`), the check retried at most once (Task 4, `mint-run.test.ts`), a delegated mint counted for the vault (Task 5, `model.test.ts`) and the tiers' first 20 ids (Task 6, `live-source.test.ts`). Each was checked against a mutation of the rule it guards (the poll's signal dropped, the wallet check dropped, the retry taken whatever the page reads, the vault's mints counted for the wallet, all ids asked for): each mutation failed exactly its own test and no other of the web app's 789.

**Checked while planning.** The code was written first in a scratch copy of `fa2e98e` outside the repository (its own git, one commit per task), and every code block here is taken from those commits by a script; each anchored edit is generated from its commit's diff and was checked by applying it to the parent's file. The counts at those commits: the web app 697 tests in 74 files before, 714 in 77 after Task 2, 760 in 83 after Task 4, 775 in 84 after Task 5, 782 in 86 after Task 6, 787 in 87 after Task 7 and 789 in 87 after Task 8; the shared package 103 tests in 13 files before and 105 in 14 after Task 3 (with the Foundry build in `contracts/out`, as in the repository), the freshness package 110 then 111 in 11; dna 60, render 117 and worker 282 unchanged; `pnpm typecheck`, `lint`, `test`, `format:check` and `build` pass. The migration was applied with `supabase migration up --local`: `verify:local` read `367 passed, 5 failed` before it and `379 passed` after. Every verify script passed at its count: `verify:local` 379, `verify:chain` 12, `verify:storage` 15, `verify:sweep` 8, `verify:render` 22, `verify:deploy` 15, `verify:phases` 20, `verify:whitelist` 18, `verify:airdrop` 15, `verify:settings` 17, `verify:freshness` 16 and `verify:mint-page` 17 (in about 50 s), each with `0 failed`. Builds: the sample build and a live one both list `● /[slug]` (a sample build of a route that awaited `searchParams` had answered 500 under `next start`, Decision 2); under `next start`, a live build with `COBWEB_TEST_CHAINS=1` (so it lists Anvil) answered a published link `MISS` then `HIT`, a signed-out preview with the not-found page, and the Overview's switch expired the cached page at once both ways; `turbo run build --dry=json` lists `NEXT_PUBLIC_FRESHNESS_URL` under `inferred`, and the build's hash moves with its value (Decision 3). The browser walk ran in the scratch copy with the dev wallet against local Supabase and its storage, Anvil and the freshness server: the tab saved every field, section and file (an avatar of 200 px refused in its field) and Preview showed them while the link answered not found; published, the page showed its state; Public scheduled 45 s ahead with no other transaction counted down to "Starts in 00:00:01" (the button disabled, a click opening nothing) and read "Starting, waiting for the chain" until a block was mined by hand, then the live label (with a block mined every second instead, the page's clock read the start 2 to 3 s late, as the spec's Known list says); Remind me's link and file (CRLF lines, folded, its UID); a mint through the dev wallet showed the check, the wallet, the confirmation and the success view with the fallback art and its tier chip, then the counts and "Wallet limit reached"; an unlisted and a listed wallet on Holders; the banner about 10 s after the server stopped, cleared on its restart; at 390 px the drawer, the sticky bar and the 14 px root with no sideways scroll; and in sample mode every `?state=`, `?wallet=`, `?degraded=1`, `?start=`, `?refusal=`, `?art=` and `?type=` and the fourteen `?fail=` kinds, "Try again" succeeding. Three defects found that way are folded into their tasks: the featured tokens stretched across a wide row when two were featured (Decision 12), the signed-out preview threw instead of answering not found (Decision 8), and `verify:mint-page` found no ranks, since a generative job stores no token list (Decision 9). Seen and left as it was before this sub-project: the roadmap's empty "When" field reads "Add the when.". Then the plan itself was applied to a second fresh copy of `fa2e98e` (a real offline install, Next's route types and the repository's `contracts/out`) by a script that performs each "Create", "Replace the whole of", "In ..., replace: ... with:" and "At the end of ..., append:" literally and refuses an anchor found other than once, runs each "Run:" line and bash block through zsh (each bash block with errexit), checks each Run's exit against its Expected line (a "FAIL" needs a failing run) and finds each backticked fragment of that line in the output, and checks that Prettier changes none of a commit's files: every anchor was found exactly once, the ten "see it fail" steps failed as their Expected lines say, each commit block ran green with Prettier changing nothing, and after each of Tasks 1 to 9 the copy's committed tree matched the scratch commit path for path. Two earlier attempts stopped at Expected lines the output did not bear out (the migration's closing line, and three lines that named code in backticks); those four lines were reworded and no directive changed, and the pass reported here ran Tasks 1 to 4 and then 5 to 10 on one copy. Task 10's check list ran there with the counts above, its six doc anchors were each found once and its append made. Afterwards the migration was reversed on the local database (its functions, tables and trigger dropped, the service role's usage on `private` revoked, its row deleted from `supabase_migrations.schema_migrations`, the empty `mint-page` bucket deleted through the Storage API): `pg_dump --schema-only` of `public` and `private` then matched the dump taken before the pass, and the rows of `collections`, `deployments`, `mint_groups`, `whitelist_entries`, `airdrops`, `withdrawals`, `render_jobs`, `tokens`, `uploads` and the users (9, 6, 12, 2,002, 3, 1, 7, 41, 128 and 6) matched a snapshot taken before the first script, so the local database is at the airdrop and settings state the plan starts from. Anvil keeps running on port 8545 with its factory and was never restarted; the planning runs left their verify and walk collections on it and moved its clock ahead (each `verify:freshness` and `verify:mint-page` run by about 600 s). Not run while planning: anything hosted (the R2 bucket, the Vercel variables, `db push`), a testnet (delegations, the transfer level), a gateway holding the local CIDs (the art showed its fallback) and a wallet that rejects (the dev wallet signs whatever it is sent).
