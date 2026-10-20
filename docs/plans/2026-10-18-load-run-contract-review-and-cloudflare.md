# Load Run, Contract Review and Cloudflare in Front Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Cobweb, before its first real launch, three proofs that mint day's read path and its contracts stand: Phase 7's second sub-project of three, each part built and proven on a laptop with its hosted half left to the owner's checklist. The load run: a k6 script on the freshness server's state and wallet endpoints, driven at the pollers' rate with the page's own request headers, whose local profile `verify:load` runs against the server in process on Anvil with a phase starting mid-run, and whose hosted profile the owner runs behind Cloudflare at 20,000 pollers every 3 s and 5,000 wallet reads in a minute, judged by k6's thresholds and by `/health`'s own count of what reaches the origin. The contract review: Slither over both contracts with all 17 findings judged in the repository and held in its triage database, a CI job that fails on any medium or high finding nobody has judged, the invariant suite driving every value and ownership path under thirteen invariants, each shown to fail on a mutation of the contracts, run once deeply, and a record in `docs/reference/`. Cloudflare in front: a checklist the owner applies by hand, and `check:edge`, which proves the zone from outside in 13 checks, each judged by a pure function tested on answers shaped as Cloudflare's. No finding is confirmed, so no contract changes.

**Architecture:** In `apps/freshness`, `requests.ts` counts the origin's answers per whole second over the last 60 s (state answers and their 304s by collection, wallet answers, refusals), the server counts each answer as it writes it, and `/health` carries the totals as `requests`. `load/profile.js` holds the k6 run's parameters, options and readings in plain JavaScript that Vitest tests, and `load/k6-freshness.js` is the k6 entry. In `apps/web`, `scripts/verify-load.ts` deploys a collection on Anvil, starts the freshness server in process, schedules Public 10 s ahead with a block mined every second, runs k6 as a child process and judges its JSON summary against `/health`; `lib/edge/edge-checks.ts` reads and judges Cloudflare's answers and `scripts/check-edge.ts` fetches them. In `contracts/`, `slither.config.json`, `slither.triage.md` and `slither.db.json` hold the analysis and its judgements, `.github/workflows/ci.yml` gains a `slither` job, `test/Invariants.t.sol` drives a factory handler and a collection handler over its own 200-token collection, and `foundry.toml` gains a `deep` profile. `docs/reference/` gains the review's record and the Cloudflare checklist.

**Tech Stack:** TypeScript 6 strict (ESM; the freshness server adds `erasableSyntaxOnly`); k6 1.2.3 (plain JavaScript on `k6/http`, `k6/metrics` and `k6/execution`); Node 26 locally; Vitest 5; viem 2.57; Foundry 1.4.0-nightly `6f49a62` with solc 0.8.30 and prague; slither-analyzer 0.11.6 with crytic-compile 0.4.2 on Python 3.12, through uv; `crytic/slither-action` v0.4.2; Prettier 3.

**Spec:** [../specs/2026-10-18-load-run-contract-review-and-cloudflare.md](../specs/2026-10-18-load-run-contract-review-and-cloudflare.md), with the controller's rulings on its section 15's ten points.

## Global Constraints

- The spec is the binding authority, its section 15 rulings included. Where this plan decides a detail the spec leaves open, or departs from its letter, the decision is collected in the next section and named in the step that carries it.
- Node 26 locally; Node 24 runs the freshness server on Railway from its TypeScript source. ESM everywhere. Inside `apps/freshness/src`, relative imports carry the `.ts` extension and no TypeScript is written that Node cannot erase (`erasableSyntaxOnly`). `apps/freshness/load/` is plain JavaScript for k6: `profile.js` imports nothing, `k6-freshness.js` imports k6's modules and `./profile.js`, and neither is in the package's `tsconfig.json`, which includes `src` alone; `profile.test.ts` beside them is linted, not type-checked. Inside `apps/web/src`, imports are extensionless, as the existing files write them. Inside `apps/web/scripts`, relative imports carry the `.ts` extension and the app's modules are imported as `../src/...`; the scripts run under `node --conditions=react-server --import ./scripts/resolve-ts.mjs`. Types are imported with `import type` or an inline `type` specifier.
- Vitest 5, Node environment. One file: `pnpm --filter <package> exec vitest run <file>`.
- Prettier: no semicolons, single quotes, trailing commas, 110 columns. Before each commit run `pnpm exec prettier --write <the files you changed>` from the repo root. Never run `pnpm format` or Prettier on `.`. Prettier checks `contracts/` apart from `lib`, `out` and `cache`, so `contracts/slither.config.json`, `contracts/slither.db.json`, `contracts/slither.triage.md` and `contracts/README.md` are formatted with it, and so are `.github/workflows/ci.yml`, `CLAUDE.md` and the `.js` files under `apps/freshness/load`. Prettier cannot parse `.sol`, `.toml`, `.gitignore` or `.env.example`, so never list them; `forge fmt` formats the Solidity. `docs/` is not checked. The code blocks in this plan are already formatted, and the commands leave them as they are.
- typescript-eslint's recommended rules and ESLint's `preserve-caught-error` apply. `eslint.config.mjs` is not touched: `k6-freshness.js` declares k6's `__ENV` with a `/* global __ENV */` comment.
- Two text hazards of the tool that writes files: a `\\;` sequence loses one backslash when written through a Bash heredoc or a typed command, and a `
` or `
` escape typed into a tool call becomes the raw line separator. No code block in this plan holds either. Write each file with the Write or Edit tool, or a script that copies the block from this plan, never a heredoc.
- Copy: plain sentences. No em or en dashes anywhere, code, comments, commit messages and docs included. The product is Cobweb; never Kingdomly or realm. Colours come from the theme's tokens, never hex values (no screen changes here). The verify scripts' lines read `PASS <n>. <subject>: <what held>` and `FAIL <n>. <subject>: <what held>: <what happened>`, then `<p> passed, <f> failed`; a `check:edge` FAIL line ends `. Look at: <the check's hint>`. Every sentence of the spec's section 10 is used as it is written there.
- CLAUDE.md rules 1, 3, 7 and 8 bind this sub-project. Liveness stays the contract's: the load run counts any answer showing a phase live before its start, and the invariant suite holds `mintGroupActive` to its flag or a reached start (rule 1). The mint page still polls the freshness server and calls no RPC, now through the edge, and nothing here changes its polls or the server's cache headers (rule 3; spec decision 21). The legacy k6 script is neither read nor copied: the port follows `docs/legacy/market-mint-and-data.md` section 7 and the spec (rule 7). No contract changes: a contract changes only for a confirmed finding, and the triage never touches `contracts/src`, since solc's metadata hash would move the creation code hash the factories approve (rule 8; spec decisions 9 and 11).
- Security: no script prints a key or an RPC URL; `verify:load` hands k6 its `PATH`, `HOME` and `NODE_ENV` alone; `check:edge` reads no secret and writes nothing. The Slither database records the absolute path of the checkout that wrote it and nothing else of the machine.
- Never deploy to any remote chain or service, and never pass `--prod` or `--target production`. The only chain any step touches is the local Anvil on port 8545, and every script refuses an endpoint that is not on this machine. The zone, Railway's and Vercel's settings, the hosted run and the first push are the owner's (spec section 13). Task 4's smoke run reads the Vercel production domain with GET and OPTIONS requests alone.
- The repository is linked to a hosted Supabase project. Never run `supabase db push`, `supabase db reset` or `supabase config push`, and never pass `--linked` to any command. No task here changes the database; Task 9's check list and walk read the local one.
- Never stop or restart Anvil on port 8545: `chain:local` keeps its chain in memory, and a restart would lose the factory and every collection on it.
- `docs/PLAN.md` must not change. `legacy/` is never read into, copied from, imported or committed.
- Docs keep their history: add dated notes and status sentences; never rewrite or delete earlier statements in `docs/MASTER_PLAN.md` or in specs.
- Local services, as the production hardening sub-project left them: `pnpm --filter @cobweb/web chain:local` is running on port 8545 with its two printed lines in `apps/web/.env.local`, and the local Supabase stack runs with its buckets seeded. Tasks 3 and 9 need Anvil; Task 4's smoke run needs the network; Task 5 needs the network once, for uv to fetch Python 3.12 and the analyzer; Tasks 5 and 6 need the submodules in `contracts/lib`; Task 9's check list needs everything. Nothing may listen on port 3100 when Task 9's walk starts the freshness server.
- Tools on the machine: k6 1.2.3 (`brew install k6`), uv (`brew install uv`, Task 5), and Foundry as installed (`forge --version` reads `1.4.0-nightly` at commit `6f49a62`, CI's pin).
- Dependencies install from the local store with `pnpm install --offline`. This sub-project adds no package.
- Implementers never use `git commit --amend` or `git stash`. To fix a commit, make a new one.
- Before every commit, at the repo root: `pnpm exec prettier --write <the files you changed>` (never a Solidity, TOML, `.gitignore` or `.env.example` file), then `pnpm typecheck && pnpm lint && pnpm test`. A commit that touches `contracts/` first runs `forge fmt --check && forge build --sizes && forge test` there.
- Commit messages are one plain imperative sentence with no prefix, then a blank line, and end with exactly these two lines:

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
```

## Decisions

1. Decision (spec section 3): nine tasks in the spec's order: `/health`'s request counts (1); the k6 script (2); `verify:load` (3); `check:edge` with its smoke run (4); Slither, its triage, its database and the CI job (5); the invariant suite, `EtherRejecter.claimTo`, the deep profile and the deep run (6); the record (7); the checklist (8); and the controller's docs, check list and walk (9). Tasks 1, 2, 4, 7 and 8 are transcription (Sonnet); Tasks 3, 5 and 6 are integration (Opus): a child process judged while a phase starts under load on Anvil; a new analyzer, its database and a CI job; a Solidity suite, its mutations and about twenty minutes of machine time. Task 9 is the controller's.
2. Decision (section 4.1): an answer counts while its whole second is among the last 60, the current one included, so it leaves the window as the 61st second begins; a second's counts are dropped when a later second first counts and when `/health` reads them, so memory follows the last minute. A collection's key is `<chain id>:<lowercase address>`, from the route's checksummed address (Task 1).
3. Decision (sections 4.1 and 4.2): the request handler reads the route before answering (`routeOf`, which `answerOf` now takes rather than reads) and counts the answer as it writes it: any status of 400 or above is a refusal whatever the route, a 500 included; else a state answer (200 or 304, HEAD as GET) under its collection, or a wallet answer. Preflights and `/health` are not counted; an OPTIONS to an unknown path is answered 404 and counts as a refusal, since only a known path's OPTIONS is a preflight (Task 1, Review Focus 1).
4. Decision (section 4.2): `server.ts` also re-exports the `RequestsHealth` type beside `STATE_CACHE` and `WALLET_CACHE`, so the web app's scripts read `/health`'s counts typed (Task 1).
5. Decision (section 5.1): `profile.js` holds three pure functions and a list beyond the spec's, each tested: `headerOf` (k6 hands header names canonicalized, as `Etag` and `Cf-Cache-Status`), `edgeOf` (section 5.3's edge counters and its mitigation rule), `notOkSentenceOf` (setup's sentence) and `EDGE_COUNTERS`, so the k6 entry holds no judgement of its own (Task 2).
6. Decision (sections 5.3 and 10): setup's sentence keeps each problem's own full stop but the last one's, where the sentence's own goes, so it never reads "(limit 60 s).. Fix it"; with no problem listed it reads "/health did not answer" when nothing answered and "/health answered <status> without status ok" otherwise (Task 2).
7. Decision (section 5.3; the spec and the repository differ): `livenessOf` reads each group's `flag`, the state body's name for the contract's `activeFlag` (`packages/shared/src/collection-state.ts` maps one to the other and the freshness server writes `flag`); the spec wrote `activeFlag`. A group open by its flag counts in none of the three (Task 2).
8. Decision (section 5.2): the details the spec leaves open. The pollers' rate is `Math.max(1, Math.round(POLLERS / INTERVAL_S))`: 100 locally, 6,667 hosted and 667 for the rehearsal. An ask's collection is its iteration modulo the collections. The health scenario stops at its duration (`gracefulStop: '0s'`) instead of waiting out a 5 s sleep. The planned iterations are `rate * 20 + round(WALLETS * 20 / 60)` locally and `rate * 150 + WALLETS` hosted (the ramp's triangle, the hold and one minute of wallet reads), and the dropped bound is the floor of 1% of them: 25, 10,050 and 1,005 for the rehearsal. BASE may end with one slash, which is dropped (Task 2).
9. Decision (section 5.3): a poll records the `Age` of a 200 or a 304, 0 when it is missing or not a number; `health_counts_missing` counts a parsed `/health` body without `requests`, while an unreadable one fails its check. A counter never added to needs no zero sample: k6 1.2.3 reports a thresholded metric with no sample at count 0, its threshold passed (seen while planning) (Task 2).
10. Decision (section 5.5): the summary's counts are grouped by thousands, its durations given to one decimal and the failed rate to two; the edge's statuses are listed largest first, ties by name, `edge_none` left out; the origin line is written when any `/health` read carried counts. k6 runs `handleSummary` after an abort in `setup` (seen while planning: `test aborted: <sentence>`, exit code 108), so an aborted run's summary reads zeros rather than failing (Task 2).
11. Decision (section 6): `verify:load` runs k6 with `PATH`, `HOME` and `NODE_ENV` alone (`NODE_ENV` because the app's types require it of a `ProcessEnv`), so no setting of the script reaches k6's `__ENV`. Check 3 reads the JSON summary whatever the exit code, to name the failed thresholds; checks 5 and 8 read the named checks in the summary's `root_group.checks`, k6 1.2.3's shape; check 9 compares the whole `requests` object with k6's counts and check 2's read; check 10 proves the ticker stopped by the block number standing still for 1.5 s. Without k6 every check still runs, checks 1 and 3 carrying the sentence (Task 3).
12. Decision (section 8.1): beside the spec's readers, `edge-checks.ts` holds `EDGE_CHECKS` (each check's subject, sentence and hint) and one pure judge per check, `judgeSetup` to `judgeTransport`, each unit-tested on Cloudflare-shaped answers, so the script only fetches: the smoke run reaches check 1's failure alone, and no run reaches a zone before the owner makes one (Task 4, Review Focus 2 to 4).
13. Decision (sections 8.1 and 8.2): the request shapes and readings the spec leaves open. Checks 3, 5, 6 and 8 send decision 4's headers (check 3 without `If-None-Match`, so both its polls answer 200); checks 4 and 7 send plain GETs. Checks 5, 6 and 7 send a priming poll right before the one they judge, so the 1 s copy cannot expire between two checks. A missing `Age` reads 0, as k6 and the page read it. Check 8's wallet is random for each run. Check 12's pages are every HTML answer the run read from the app domain, and its answers every answer of the run. Check 13's redirect may be a 301, 302, 307 or 308 to the same host on https. `--app` and `--freshness` keep their origins, and `--slug` follows the mint page link's rule of 3 to 48 lowercase letters, digits or hyphens (Task 4).
14. Decision (section 7.1): Slither 0.11.6, the newest on PyPI (released 28 July 2026), on Python 3.12 through uv (0.13.1 from Homebrew while planning), with crytic-compile 0.4.2. Confirmed while planning on that version: `--config-file`, `--json -`, `--triage-mode`, `--triage-database` and `--fail-medium` work as the spec reads them; all 17 findings carry the same id from `contracts/` as from the root form the CI job runs, so the database written locally hides the same findings there (the spec's own form is kept). Slither runs `forge clean` before its build, which skips the tests, so `forge build` follows it before anything reads `contracts/out`; the shared package's hash test passed on Slither's build as well (Task 5).
15. Decision (section 7.2): triage mode writes the database with "All" answered at each of its 11 prompts, since every finding is `accepted` or `false positive`, after the run's list is checked to be exactly the 17 of the triage table (a different list stops the task); Prettier then gives it 2,374 lines. Slither reads only each entry's id and description; the rest, the absolute path of the checkout that wrote it included, stays as Slither wrote it, the spec's letter (Task 5).
16. Decision (section 7.2): the triage table has 12 rows, one for each high, medium and low finding (6) and one for each informational or optimization detector (6) with its count and its ids. Its run line names the date and the commit through two fills, `date '+%-d %B %Y'` and `git rev-parse --short HEAD` (the commit the run read, before Task 5's own), the only values a run alone knows (Task 5).
17. Decision (section 7.3): the job uses `crytic/slither-action@v0.4.2`, its newest release tag (16 January 2026), with no `solc-version` input: the action guesses solc from the most common pragma under `contracts/`, which `lib/` makes 0.8.0, but crytic-compile builds through Foundry with the solc 0.8.30 that `foundry.toml` pins, so the guess is never used. The plugin hook that guards configuration files did not refuse an edit of `ci.yml` in the scratch worktree (it guards lint and formatter files), so the job lands in Task 5 with no patch for the owner (Task 5).
18. Decision (section 7.5; decision 13's reasoning and the measurement differ): the invariant suite deploys its own collection of 200 tokens (Public 120, Allowlist 60) through the factory in `setUp`, in place of the base test's 1,000-token one. Measured while planning, a run of 1,000 calls mints 470 to 650 of 1,000 tokens, so no run reached the supply cap, and a mutation letting a mint pass it went unseen even at depth 1,000; at 200 tokens every sampled run sold out, and that mutation fails `invariant_supplyNeverExceedsMax`. Decision 13's deep profile stands as written; its premise, runs reaching the collection's supply and its full allocations, is kept through the smaller collection. The handler's supply bounds follow it: a new group's supply 0 to 40, a group's new supply 0 to 200 (Task 6).
19. Decision (section 7.5): the handler's choices the spec leaves open. A delegated mint uses the caller its vault last delegated to three times in four, else any account, which the registry mock refuses unless the vault delegated to it. A list mint uses the group the last chunk named half the time. On-behalf and delegated mints pick Public, that group or any registered group, a third of the time each. `schedule` picks Public half the time. `warp` moves exactly to the next scheduled start a quarter of the time (Review Focus 5). Seeds wrap before they add (`seed % actors.length + i`), so no action reverts on its own arithmetic. Measured while planning over ten seeded runs of 500 calls, a run then lands about 11 mints through `batchMint` (public or from a list), 2.5 on behalf and 2 delegated, 6.5 of them into a list group, and a mint live by its start alone every other run, where uniform choices landed 0.4 delegated mints a run (Task 6).
20. Decision (section 7.5): invariant 1 sums the held refunds of every account the handlers reach (the five minters, the creator and EtherRejecter), of which only EtherRejecter's may be above 0: summed over EtherRejecter alone, a contract that also held refunds it had already sent passed the suite (seen while planning). The handlers also flag a withdrawal refused while something was owed (proceeds, fees, held refunds, art), which invariants 1, 2, 3 and 5 read, so a lock fails the suite as well as a loss (Task 6).
21. Decision (section 7.5): a scripted step proves the suite against fifteen mutations of the contracts, each applied alone, run on 64 runs with a fixed seed, undone, and Foundry's persisted counterexamples cleared, since a persisted one is replayed on the next run; each mutation fails the invariant it targets, and the record lists them (Task 6).
22. Decision (section 7.6): on the installed forge (1.4.0-nightly `6f49a62`) the default campaign is 256 runs of depth 500 and `show_metrics` is already true (`forge config`); the deep profile inherits solc, the EVM version, the optimizer and the metadata hash from the default one, so its build is the same bytecode. The unit suites hold one fuzz test, `testFuzz_quoteBatchMint`, which the deep profile runs 10,000 times. The deep run took 11.5 minutes on this 12-core laptop, so `CLAUDE.md` and the contracts README say "about 12 minutes" where the spec wrote "tens of minutes" (Tasks 6 and 9).
23. Decision (section 8; task 4's smoke run): the Vercel production domain answered `DEPLOYMENT_NOT_FOUND` (404) on every path on 18 October 2026, so the smoke run's Expected names check 1 alone, which fails whatever the domain serves; the domain sent `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` even on that page (the smoke run's check 13 passed), and whether Vercel sends it on a custom domain is what the owner's check 13 reads (ruling 7) (Task 4).
24. Decision (section 11): this sub-project has no screen, so Task 9's walk runs the owner's commands as far as a laptop can: `check:edge`'s usage refusal, `k6 inspect` of the hosted profile, the local profile run by hand against `pnpm --filter @cobweb/freshness dev` with a collection Anvil holds followed by `/health`'s counts, and Slither from both directories (Task 9).
25. Decision (section 12): the record and the checklist land in Tasks 7 and 8; `CLAUDE.md`, the contracts README, `apps/web/.env.example`, MASTER_PLAN and the freshness server spec's notes in Task 9, after the code they describe. The record's two fills come from Task 6: its commit and the deep run's seconds. The README's coverage figures stand as `forge coverage` read them while planning (Tasks 7 to 9).

## Review Focus

Inputs and failure modes the spec implies but its own test list would not exercise, most likely to bite on mint day. Each is pinned to a test in the task that owns the code, and each was checked against a mutation of the rule it guards.

1. An address spray against the state route. The freshness server has no rate limit (spec decision 19), so `/health`'s `refused` count is how a spray shows, and the counter keys only collections that answered. Counted under the addresses it named, a spray would grow the counter's memory with every address sprayed and push a stranger's key into `collections` and `busiest`, which the hosted run's origin threshold reads. Pinned by "counts an address spray against the state route as refusals, keying no collection (Review Focus 1)" (Task 1, `server.test.ts`): 50 addresses answered 404 count as 50 refusals and no collection. Counting a state route's answer under its collection before reading its status failed it alone.
2. The edge letting a page's first poll through. Each viewer's first poll is a `cache: 'reload'` fetch carrying `Cache-Control: no-cache` and `Pragma: no-cache`; an edge that honoured them would send every arriving viewer's first poll to the origin, tens of thousands at once when a launch opens. Pinned by "check 6: an edge that lets a page's reload poll through to the origin fails (Review Focus 2)" (Task 4, `edge-checks.test.ts`), which passes a HIT alone and fails MISS, EXPIRED, REVALIDATED, BYPASS and DYNAMIC. Accepting REVALIDATED, as check 5 rightly does for a 304, failed it alone.
3. The edge holding the state past its second. An edge TTL set in the zone instead of taken from the origin's `s-maxage=1` shows a phase live late to every viewer, and an edge that never goes back to the origin shows it never. Pinned by "check 4: an edge that holds the state past its second, or never goes back to the origin, fails (Review Focus 3)" (Task 4), with an `Age` climbing to 4 and with twenty HITs. Dropping the `Age` bound failed it alone, and so did dropping the trip back to the origin.
4. A build whose policy still names the earlier freshness origin. `NEXT_PUBLIC_FRESHNESS_URL` is read at build time: set to the custom domain without a redeploy, the hosted app keeps polling Railway's domain, which the checklist then removes, and mint pages lose their live data on the day. Pinned by "check 11: a build whose policy still names an earlier freshness origin fails, as does any script without the nonce (Review Focus 4)" (Task 4), whose policy lists Railway's domain in `connect-src`. Reading only that `connect-src` lists something failed it alone.
5. The second a phase turns live. A phase is live from the first block whose time reaches its start (rule 1); random moves of 1 to 3,600 s almost never land on that second, so a contract honouring a start one second late would pass the spec's suite. Pinned by `invariant_liveOnlyByFlagOrStart` with the collection handler's `warp`, which moves exactly to the next scheduled start a quarter of the time (Task 6, `Invariants.t.sol`): that mutation passed 64 runs with random moves alone, and with the moves to a start it fails the invariant (the mutation script's `M11`).

## File map

| Path | Task | Responsibility |
| --- | --- | --- |
| `apps/freshness/src/requests.ts` | 1 | Create: the origin's answers per whole second over the last 60 s |
| `apps/freshness/src/requests.test.ts` | 1 | Create: the window, the seconds, the 304s, two collections, a key dropped |
| `apps/freshness/src/health.ts` | 1 | Modify: `HealthBody.requests` |
| `apps/freshness/src/server.ts` | 1 | Modify: each answer counted as it is written; `/health`'s `requests`; the re-exports |
| `apps/freshness/src/server.test.ts` | 1 | Modify: the refusals counted, a preflight and `/health` not; the address spray |
| `apps/freshness/load/profile.js` | 2 | Create: the run's parameters, options and readings, pure |
| `apps/freshness/load/profile.test.ts` | 2 | Create: the profile's tests |
| `apps/freshness/load/k6-freshness.js` | 2 | Create: the k6 entry: metrics, `setup`, `poll`, `ask`, `watch`, `handleSummary` |
| `apps/web/scripts/verify-load.ts` | 3 | Create: `verify:load` |
| `apps/web/package.json` | 3, 4 | Modify: the `verify:load` (3) and `check:edge` (4) commands |
| `apps/web/src/lib/edge/edge-checks.ts` | 4 | Create: the arguments, the readers and the 13 judges, pure |
| `apps/web/src/lib/edge/edge-checks.test.ts` | 4 | Create: the judges on Cloudflare-shaped answers |
| `apps/web/scripts/check-edge.ts` | 4 | Create: `check:edge`, the 13 checks from outside |
| `contracts/slither.config.json` | 5 | Create: the filtered paths, no detector excluded |
| `contracts/slither.triage.md` | 5 | Create: each finding's verdict and reason |
| `contracts/slither.db.json` | 5 | Create (by Slither's triage mode): the 17 held findings |
| `.github/workflows/ci.yml` | 5 | Modify: the `slither` job |
| `.gitignore` | 5 | Modify: `contracts/crytic-export/` |
| `contracts/test/utils/BaseTest.sol` | 6 | Modify: `EtherRejecter.claimTo` |
| `contracts/test/Invariants.t.sol` | 6 | Replace: the two handlers and the thirteen invariants |
| `contracts/foundry.toml` | 6 | Modify: the `deep` profile |
| `docs/reference/contract-review-2026-10.md` | 7 | Create: the review's record |
| `docs/reference/cloudflare-setup.md` | 8 | Create: the owner's Cloudflare checklist |
| `docs/MASTER_PLAN.md` | 9 | Modify: the Contracts and Hosting decisions, the Phase 7 status line |
| `docs/specs/2026-10-18-load-run-contract-review-and-cloudflare.md` | 9 | Modify: the acceptance boxes, the landing note |
| `docs/specs/2026-10-16-freshness-server.md` | 9 | Modify: dated notes in sections 6.9 and 12 |
| `CLAUDE.md` | 9 | Modify: five commands |
| `contracts/README.md` | 9 | Modify: Slither, the deep run, the suite's row, the figures |
| `apps/web/.env.example` | 9 | Modify: `NEXT_PUBLIC_FRESHNESS_URL`'s comment |

---

### Task 1: The origin's answers over the last minute on `/health`

**Kind:** transcription. The plan carries every line: a Sonnet implementer.

**Files:**

- Create: `apps/freshness/src/requests.ts`, `apps/freshness/src/requests.test.ts`
- Modify: `apps/freshness/src/health.ts` (`HealthBody.requests`), `apps/freshness/src/server.ts` (the counts, the route read before answering, the re-exports), `apps/freshness/src/server.test.ts` (two cases)
- Test: `pnpm --filter @cobweb/freshness exec vitest run src/requests.test.ts src/server.test.ts`

**Interfaces:**

- Consumes: `routeOf`, `Route`, `Answer`, `STATE_CACHE` and `WALLET_CACHE` of `routes.ts`; `HealthBody` of `health.ts`; the server's `answerOf`, `health` and request handler, as the production hardening sub-project left them.
- Produces:
  - `requests.ts`: `REQUEST_WINDOW_S = 60`; `type RequestsHealth = { windowS: number; state: number; notModified: number; wallet: number; refused: number; collections: number; busiest: number }`; `requestCounts(windowS?: number): { state(now: number, collection: string, notModified: boolean): void; wallet(now: number): void; refused(now: number): void; health(now: number): RequestsHealth }`, an answer counted while its whole second is among the last `windowS`, the current one included (Decision 2)
  - `health.ts`: `HealthBody.requests: RequestsHealth`, after `wallet`; `status`, `problems` and `HEALTH_LIMITS` unchanged
  - `server.ts`: each answer counted as it is written (Decision 3) and `/health` answering `requests`; `export { STATE_CACHE, WALLET_CACHE } from './routes.ts'` and `export type { RequestsHealth } from './requests.ts'`, which `@cobweb/freshness/server` gives Tasks 3 and 4 (Decision 4)

- [ ] **Step 1: Write the failing tests**

The counter's window, its seconds, the 304s within the state answers, two collections and a key dropped after the window (spec section 4.2), and the server's refusals counted with a preflight and `/health` itself left out (Review Focus 1).

Create `apps/freshness/src/requests.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { REQUEST_WINDOW_S, requestCounts, type RequestsHealth } from './requests.ts'

const A = '31337:0x5fbdb2315678afecb367f032d93f642f64180aa3'
const B = '31337:0xe7f1725e7734ce288f8367e1bb143e90bb3f0512'
/** A moment inside second 1,000 of the clock. */
const T = 1_000_000

const EMPTY: RequestsHealth = {
  windowS: REQUEST_WINDOW_S,
  state: 0,
  notModified: 0,
  wallet: 0,
  refused: 0,
  collections: 0,
  busiest: 0,
}

describe('requestCounts (docs/specs/2026-10-18-load-run-contract-review-and-cloudflare.md, section 4.1)', () => {
  it('answers zeros over a 60 s window before any answer', () => {
    expect(requestCounts().health(T)).toEqual(EMPTY)
    expect(requestCounts(10).health(T)).toEqual({ ...EMPTY, windowS: 10 })
  })

  it("sums one second's answers and keeps the 304s within the state answers", () => {
    const counts = requestCounts()
    counts.state(T, A, false)
    counts.state(T + 10, A, true)
    counts.state(T + 999, A, true)
    expect(counts.health(T + 999)).toEqual({ ...EMPTY, state: 3, notModified: 2, collections: 1, busiest: 3 })
  })

  it('counts an answer while its second is among the last 60, the current one included, and drops it after', () => {
    const counts = requestCounts()
    counts.state(T, A, false)
    counts.wallet(T)
    counts.refused(T)
    const last = T + (REQUEST_WINDOW_S - 1) * 1_000
    expect(counts.health(last + 999)).toEqual({
      ...EMPTY,
      state: 1,
      wallet: 1,
      refused: 1,
      collections: 1,
      busiest: 1,
    })
    expect(counts.health(last + 1_000)).toEqual(EMPTY)
  })

  it("counts two collections and names the busiest one's count", () => {
    const counts = requestCounts()
    for (let second = 0; second < 5; second++) counts.state(T + second * 1_000, A, second > 0)
    counts.state(T + 2_000, B, false)
    counts.state(T + 3_000, B, true)
    expect(counts.health(T + 4_000)).toEqual({
      ...EMPTY,
      state: 7,
      notModified: 5,
      collections: 2,
      busiest: 5,
    })
  })

  it('drops a collection once its last second leaves the window', () => {
    const counts = requestCounts()
    counts.state(T, A, false)
    counts.state(T + 30_000, B, false)
    expect(counts.health(T + 59_000)).toMatchObject({ collections: 2, busiest: 1 })
    expect(counts.health(T + 60_000)).toMatchObject({ state: 1, collections: 1, busiest: 1 })
    expect(counts.health(T + 90_000)).toEqual(EMPTY)
  })

  it('counts wallet answers and refusals apart from the state answers', () => {
    const counts = requestCounts()
    counts.wallet(T)
    counts.wallet(T + 1_500)
    counts.refused(T + 2_000)
    expect(counts.health(T + 2_000)).toEqual({ ...EMPTY, wallet: 2, refused: 1 })
  })
})
```

In `apps/freshness/src/server.test.ts`, replace:

```ts
      expect.stringContaining('The indexer is off: set INDEXER_DATABASE_URL to run it.'),
    )
  })
})
```

with:

```ts
      expect.stringContaining('The indexer is off: set INDEXER_DATABASE_URL to run it.'),
    )
  })
})

/** /health's `requests` with nothing counted. */
const NO_REQUESTS: HealthBody['requests'] = {
  windowS: 60,
  state: 0,
  notModified: 0,
  wallet: 0,
  refused: 0,
  collections: 0,
  busiest: 0,
}

describe("/health's request counts (docs/specs/2026-10-18-load-run-contract-review-and-cloudflare.md, section 4.2)", () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.stubEnv('RAILWAY_ENVIRONMENT', undefined)
    vi.stubEnv('NODE_ENV', 'test')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('carries requests, counting a 404 for an unknown path and a 400 for a malformed address as refused, and neither a preflight nor /health itself', async () => {
    const freshness = await startFreshness({ port: 0, host: '127.0.0.1', chainIds: [] })
    try {
      const requests = async () =>
        ((await (await fetch(`${freshness.url}/health`)).json()) as HealthBody).requests
      expect(await requests()).toEqual(NO_REQUESTS)
      expect((await fetch(`${freshness.url}/v1/collections`)).status).toBe(404)
      expect((await fetch(`${freshness.url}/v1/state/31337/0x5fbdb2315678`)).status).toBe(400)
      const preflight = await fetch(`${freshness.url}/v1/state/31337/0x${'5f'.repeat(20)}`, {
        method: 'OPTIONS',
      })
      expect(preflight.status).toBe(204)
      expect(await requests()).toEqual({ ...NO_REQUESTS, refused: 2 })
    } finally {
      await freshness.close()
    }
  })

  it('counts an address spray against the state route as refusals, keying no collection (Review Focus 1)', async () => {
    const freshness = await startFreshness({ port: 0, host: '127.0.0.1', chainIds: [] })
    try {
      const addresses = Array.from({ length: 50 }, (_, n) => `0x${(n + 1).toString(16).padStart(40, '0')}`)
      const answers = await Promise.all(
        addresses.map((address) => fetch(`${freshness.url}/v1/state/31337/${address}`)),
      )
      expect(answers.map((answer) => answer.status)).toEqual(Array<number>(50).fill(404))
      const body = (await (await fetch(`${freshness.url}/health`)).json()) as HealthBody
      expect(body.requests).toEqual({ ...NO_REQUESTS, refused: 50 })
    } finally {
      await freshness.close()
    }
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @cobweb/freshness exec vitest run src/requests.test.ts src/server.test.ts`
Expected: FAIL: `Cannot find module './requests.ts'`, `expected undefined to deeply equal` and `Tests  2 failed | 6 passed (8)`.

- [ ] **Step 3: The counter**

Create `apps/freshness/src/requests.ts`:

```ts
/**
 * The origin's answers over the last minute for /health's `requests`
 * (docs/specs/2026-10-18-load-run-contract-review-and-cloudflare.md, section 4.1), pure: the hosted load run
 * reads them every 5 s to judge what reaches the origin behind the edge, and `verify:load` proves them against
 * k6's own counts. Counts are kept per whole second, so memory follows the collections asked for in the last
 * minute and no more; a key is `<chain id>:<lowercase address>` and never leaves this module.
 */

/** The window /health counts over, in seconds, the current second included. */
export const REQUEST_WINDOW_S = 60

/** /health's `requests`: the answers in the window by route, the collections asked for and the busiest one's. */
export type RequestsHealth = {
  windowS: number
  /** State answers of 200 or 304, HEAD as GET. */
  state: number
  /** The 304s among them. */
  notModified: number
  /** Wallet answers of 200. */
  wallet: number
  /** Answers of 400 or above on any route. */
  refused: number
  /** Collections with a state answer in the window. */
  collections: number
  /** The most state answers any one collection had in the window. */
  busiest: number
}

/** One second's answers. */
type Second = {
  state: number
  notModified: number
  wallet: number
  refused: number
  byKey: Map<string, number>
}

/** Counts answers per whole second and sums those of the last `windowS` seconds. */
export function requestCounts(windowS: number = REQUEST_WINDOW_S): {
  state(now: number, collection: string, notModified: boolean): void
  wallet(now: number): void
  refused(now: number): void
  health(now: number): RequestsHealth
} {
  const seconds = new Map<number, Second>()

  /** Drops the seconds that left the window by `second`. */
  function prune(second: number): void {
    for (const at of seconds.keys()) if (at <= second - windowS) seconds.delete(at)
  }

  /** The second `now` falls in, created when it has no answer yet, once the older ones are dropped. */
  function secondOf(now: number): Second {
    const at = Math.floor(now / 1_000)
    let second = seconds.get(at)
    if (!second) {
      prune(at)
      second = { state: 0, notModified: 0, wallet: 0, refused: 0, byKey: new Map() }
      seconds.set(at, second)
    }
    return second
  }

  return {
    state(now, collection, notModified) {
      const second = secondOf(now)
      second.state++
      if (notModified) second.notModified++
      second.byKey.set(collection, (second.byKey.get(collection) ?? 0) + 1)
    },
    wallet(now) {
      secondOf(now).wallet++
    },
    refused(now) {
      secondOf(now).refused++
    },
    health(now) {
      const current = Math.floor(now / 1_000)
      prune(current)
      const totals: RequestsHealth = {
        windowS,
        state: 0,
        notModified: 0,
        wallet: 0,
        refused: 0,
        collections: 0,
        busiest: 0,
      }
      const byKey = new Map<string, number>()
      for (const [at, second] of seconds) {
        if (at > current) continue
        totals.state += second.state
        totals.notModified += second.notModified
        totals.wallet += second.wallet
        totals.refused += second.refused
        for (const [key, count] of second.byKey) byKey.set(key, (byKey.get(key) ?? 0) + count)
      }
      totals.collections = byKey.size
      for (const count of byKey.values()) totals.busiest = Math.max(totals.busiest, count)
      return totals
    },
  }
}
```

- [ ] **Step 4: `/health` and the server**

The route is read before the answer and handed to `answerOf`, so the answer is counted by its route and status as it is written (Decision 3).

In `apps/freshness/src/health.ts`, replace:

```ts
import { BaseError } from 'viem'
import type { Tier } from './tiers.ts'
```

with:

```ts
import { BaseError } from 'viem'
import type { RequestsHealth } from './requests.ts'
import type { Tier } from './tiers.ts'
```

In `apps/freshness/src/health.ts`, replace:

```ts
  wallet: { windows: number; answered: number; waiting: number }
}
```

with:

```ts
  wallet: { windows: number; answered: number; waiting: number }
  /**
   * The origin's answers over the last 60 s by route, which `status` and `problems` do not read
   * (docs/specs/2026-10-18-load-run-contract-review-and-cloudflare.md, section 4.2). It names no address.
   */
  requests: RequestsHealth
}
```

In `apps/freshness/src/server.ts`, replace:

```ts
import { postgresIndexerDb } from './indexer-db.ts'
import {
```

with:

```ts
import { postgresIndexerDb } from './indexer-db.ts'
import { requestCounts } from './requests.ts'
import {
```

In `apps/freshness/src/server.ts`, replace:

```ts
  type Answer,
} from './routes.ts'
```

with:

```ts
  type Answer,
  type Route,
} from './routes.ts'
```

In `apps/freshness/src/server.ts`, replace:

```ts
export type { HealthBody } from './health.ts'
export type { StateBody } from './state-body.ts'
```

with:

```ts
export type { HealthBody } from './health.ts'
export type { RequestsHealth } from './requests.ts'
export { STATE_CACHE, WALLET_CACHE } from './routes.ts'
export type { StateBody } from './state-body.ts'
```

In `apps/freshness/src/server.ts`, replace:

```ts
  const hot = hotSet()
  const served = new Map(
```

with:

```ts
  const hot = hotSet()
  // The origin's answers over the last minute, for /health's `requests`.
  const counts = requestCounts()
  const served = new Map(
```

In `apps/freshness/src/server.ts`, replace:

```ts
      wallet: { windows: total('windows'), answered: total('answered'), waiting: total('waiting') },
    }
```

with:

```ts
      wallet: { windows: total('windows'), answered: total('answered'), waiting: total('waiting') },
      requests: counts.health(Date.now()),
    }
```

In `apps/freshness/src/server.ts`, replace:

```ts

  async function answerOf(request: IncomingMessage): Promise<Answer> {
    const route = routeOf(request.method, request.url)
    if (route.kind === 'refused') return refusal(route.status, route.error)
```

with:

```ts

  async function answerOf(route: Route, request: IncomingMessage): Promise<Answer> {
    if (route.kind === 'refused') return refusal(route.status, route.error)
```

In `apps/freshness/src/server.ts`, replace:

```ts

  /** The requests being answered; each leaves once its answer is written, and `close()` waits for them. */
```

with:

```ts

  /**
   * Counts an answer on /health's `requests` as it is written
   * (docs/specs/2026-10-18-load-run-contract-review-and-cloudflare.md, section 4.1): a refusal of 400 or above on
   * any route, else a state answer under its collection or a wallet answer. Preflights and /health itself are not
   * counted.
   */
  function count(route: Route, answer: Answer): void {
    if (route.kind === 'preflight' || route.kind === 'health') return
    const now = Date.now()
    if (answer.status >= 400) counts.refused(now)
    else if (route.kind === 'state')
      counts.state(now, `${route.chainId}:${route.address.toLowerCase()}`, answer.status === 304)
    else if (route.kind === 'wallet') counts.wallet(now)
  }

  /** The requests being answered; each leaves once its answer is written, and `close()` waits for them. */
```

In `apps/freshness/src/server.ts`, replace:

```ts
    const head = request.method === 'HEAD'
    const answered: Promise<void> = answerOf(request)
      .catch((error: unknown) => {
```

with:

```ts
    const head = request.method === 'HEAD'
    const route = routeOf(request.method, request.url)
    const answered: Promise<void> = answerOf(route, request)
      .catch((error: unknown) => {
```

In `apps/freshness/src/server.ts`, replace:

```ts
      })
      .then((answer) => send(response, head, answer))
      .finally(() => answering.delete(answered))
```

with:

```ts
      })
      .then((answer) => {
        count(route, answer)
        send(response, head, answer)
      })
      .finally(() => answering.delete(answered))
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `pnpm --filter @cobweb/freshness exec vitest run src/requests.test.ts src/server.test.ts`
Expected: PASS, `Tests  14 passed (14)`.

- [ ] **Step 6: Typecheck and lint the freshness server**

Run: `pnpm --filter @cobweb/freshness typecheck && pnpm --filter @cobweb/freshness lint`
Expected: PASS.

- [ ] **Step 7: Format, run the root checks and commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
pnpm exec prettier --write apps/freshness/src/requests.ts apps/freshness/src/requests.test.ts apps/freshness/src/health.ts apps/freshness/src/server.ts apps/freshness/src/server.test.ts
pnpm typecheck && pnpm lint && pnpm test
git add apps/freshness/src/requests.ts apps/freshness/src/requests.test.ts apps/freshness/src/health.ts apps/freshness/src/server.ts apps/freshness/src/server.test.ts
git commit -m "$(cat <<'EOF'
Count the freshness server's answers over the last minute on /health, so the load run can judge what reaches the origin behind the edge

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: freshness 244 tests in 19 files (236 in 18 before); web 1021 in 107 and shared 105 in 14, unchanged.

---

### Task 2: The k6 load run, its two profiles and its summary

**Kind:** transcription. The plan carries every line: a Sonnet implementer.

**Files:**

- Create: `apps/freshness/load/profile.js`, `apps/freshness/load/profile.test.ts`, `apps/freshness/load/k6-freshness.js`
- Test: `pnpm --filter @cobweb/freshness exec vitest run load/profile.test.ts`; `k6 inspect` of both profiles; k6 without a profile

**Interfaces:**

- Consumes: `/health`'s `status`, `problems`, `wallet.windows` and `requests` (Task 1); the state body's `chainId`, `address`, `blockTimestamp`, `degraded` and `groups[]` with `flag`, `active` and `startTimestamp` (Decision 7); the wallet endpoint; Cloudflare's `cf-cache-status`, `cf-mitigated` and `Age`.
- Produces:
  - `profile.js`: `PROFILES`; `EDGE_COUNTERS`; `parametersOf(env)` returning `{ profile, base, collections: [{ chainId, address }], pollers, intervalS, wallets, summaryFile }` or throwing section 10's sentence; `optionsOf(parameters)` returning `{ scenarios, thresholds, summaryTrendStats }`; `statePathOf(collection)`; `walletPathOf(collection, wallet)`; `walletOf(runStartMs, n)`; `livenessOf(body)` returning `{ early, openBySchedule, waiting }`; `headerOf(headers, name)`; `edgeOf(status, headers)` returning `{ cache, mitigated }`; `notOkSentenceOf(status, body)`; `summaryLines(data, parameters)` returning section 10's seven lines (Decisions 5 to 10)
  - `k6-freshness.js`: `options`, `setup`, `poll`, `ask`, `watch` and `handleSummary`; the metrics `state_answers`, `state_not_modified` (a rate), `early_open`, `scheduled_open_reads`, `scheduled_waiting_reads`, `degraded_answers`, `wallet_answers`, `edge_hit` to `edge_none`, `edge_mitigated` and `health_counts_missing` (counters) and `state_age_s`, `health_problems`, `origin_busiest_per_s`, `origin_state_per_s` and `origin_wallet_windows_per_min` (trends); the checks `state answered 200 or 304`, `a 304 carries the ETag it was asked with`, `a 200 body is the asked collection's state`, `wallet answered 200` and `/health answered 200 and ok`, which Task 3 reads by name; k6's JSON summary written to `SUMMARY_FILE` when it is set

- [ ] **Step 1: Write the failing test**

Each profile's defaults, the overrides and each refusal; each scenario and threshold, the dropped bound at the defaults and at a rehearsal's numbers; the wallets and the paths; the liveness readings; the edge's readings; setup's sentence; and the summary's lines from a recorded local summary, behind the edge, without `/health`'s counts, with failed thresholds and after an abort (spec section 11).

Create `apps/freshness/load/profile.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  EDGE_COUNTERS,
  edgeOf,
  headerOf,
  livenessOf,
  notOkSentenceOf,
  optionsOf,
  parametersOf,
  PROFILES,
  statePathOf,
  summaryLines,
  walletOf,
  walletPathOf,
} from './profile.js'

const ADDRESS = '0x5FbDB2315678afecb367f032d93F642f64180aa3'
const LOCAL = { PROFILE: 'local', BASE: 'http://127.0.0.1:53247', COLLECTIONS: `31337/${ADDRESS}` }
const HOSTED = { PROFILE: 'hosted', BASE: 'https://fresh.example.com', COLLECTIONS: `11155111/${ADDRESS}` }

/** k6's JSON summary of a local run of verify:load on Anvil, trimmed to the metrics the summary lines read. */
const RECORDED = {
  metrics: {
    'http_req_duration{route:state}': {
      values: { 'p(95)': 1.043, count: 2001 },
      thresholds: { 'p(95)<200': { ok: true } },
    },
    'http_req_duration{route:wallet}': {
      values: { 'p(95)': 211.945, count: 501 },
      thresholds: { 'p(95)<400': { ok: true } },
    },
    state_not_modified: {
      values: { rate: 0.9899040888440181, passes: 1961, fails: 20 },
      thresholds: { 'rate>0.9': { ok: true } },
    },
    http_req_failed: {
      values: { rate: 0, passes: 0, fails: 2507 },
      thresholds: { 'rate<0.01': { ok: true } },
    },
    dropped_iterations: { values: { count: 0, rate: 0 }, thresholds: { 'count<=25': { ok: true } } },
    edge_none: { values: { count: 2506 } },
    origin_busiest_per_s: { values: { max: 25.033333333333335, count: 4 } },
    origin_wallet_windows_per_min: { values: { max: 263.9472105578884, count: 3 } },
  },
}

describe('parametersOf (docs/specs/2026-10-18-load-run-contract-review-and-cloudflare.md, section 5.1)', () => {
  it("reads each profile's defaults", () => {
    expect(parametersOf(LOCAL)).toEqual({
      profile: 'local',
      base: 'http://127.0.0.1:53247',
      collections: [{ chainId: 31337, address: ADDRESS }],
      pollers: 100,
      intervalS: 1,
      wallets: 1500,
      summaryFile: null,
    })
    expect(parametersOf(HOSTED)).toMatchObject({
      profile: 'hosted',
      pollers: 20000,
      intervalS: 3,
      wallets: 5000,
    })
    expect(PROFILES).toEqual({
      local: { pollers: 100, intervalS: 1, wallets: 1500 },
      hosted: { pollers: 20000, intervalS: 3, wallets: 5000 },
    })
  })

  it('takes the overrides, a trailing slash on BASE and several collections', () => {
    const second = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512'
    expect(
      parametersOf({
        ...HOSTED,
        BASE: 'https://fresh.example.com/',
        COLLECTIONS: `11155111/${ADDRESS}, 84532/${second}`,
        POLLERS: '2000',
        INTERVAL_S: '2',
        WALLETS: '500',
        SUMMARY_FILE: '/tmp/k6-hosted.json',
      }),
    ).toEqual({
      profile: 'hosted',
      base: 'https://fresh.example.com',
      collections: [
        { chainId: 11155111, address: ADDRESS },
        { chainId: 84532, address: second },
      ],
      pollers: 2000,
      intervalS: 2,
      wallets: 500,
      summaryFile: '/tmp/k6-hosted.json',
    })
  })

  it("refuses each value it cannot use with section 10's sentence", () => {
    const refusals: [Record<string, string>, string][] = [
      [{ ...LOCAL, PROFILE: '' }, 'PROFILE must be local or hosted.'],
      [{ ...LOCAL, PROFILE: 'remote' }, 'PROFILE must be local or hosted.'],
      [
        { ...LOCAL, BASE: '' },
        "BASE must be the freshness server's origin, such as https://fresh.example.com.",
      ],
      [
        { ...LOCAL, BASE: 'fresh.example.com' },
        "BASE must be the freshness server's origin, such as https://fresh.example.com.",
      ],
      [
        { ...LOCAL, BASE: 'ftp://fresh.example.com' },
        "BASE must be the freshness server's origin, such as https://fresh.example.com.",
      ],
      [
        { ...LOCAL, BASE: 'https://fresh.example.com/v1' },
        "BASE must be the freshness server's origin, such as https://fresh.example.com.",
      ],
      [
        { ...LOCAL, COLLECTIONS: '' },
        'COLLECTIONS must list one or more <chain id>/<address>, separated by commas.',
      ],
      [
        { ...LOCAL, COLLECTIONS: '31337' },
        'COLLECTIONS must list one or more <chain id>/<address>, separated by commas.',
      ],
      [
        { ...LOCAL, COLLECTIONS: '31337/0x5fbdb2315678' },
        'COLLECTIONS must list one or more <chain id>/<address>, separated by commas.',
      ],
      [
        { ...LOCAL, COLLECTIONS: `31337/${ADDRESS},` },
        'COLLECTIONS must list one or more <chain id>/<address>, separated by commas.',
      ],
      [{ ...LOCAL, POLLERS: '0' }, 'POLLERS, INTERVAL_S and WALLETS must be whole numbers above 0.'],
      [{ ...LOCAL, INTERVAL_S: '1.5' }, 'POLLERS, INTERVAL_S and WALLETS must be whole numbers above 0.'],
      [{ ...LOCAL, WALLETS: 'many' }, 'POLLERS, INTERVAL_S and WALLETS must be whole numbers above 0.'],
    ]
    for (const [env, sentence] of refusals)
      expect(() => parametersOf(env), JSON.stringify(env)).toThrow(sentence)
  })
})

describe('optionsOf (section 5.2 and 5.4)', () => {
  it("runs the local profile's three scenarios for 20 s at 100 polls and 25 wallet reads a second", () => {
    expect(optionsOf(parametersOf(LOCAL)).scenarios).toEqual({
      pollers: {
        executor: 'constant-arrival-rate',
        exec: 'poll',
        rate: 100,
        timeUnit: '1s',
        duration: '20s',
        preAllocatedVUs: 20,
        maxVUs: 100,
      },
      wallets: {
        executor: 'constant-arrival-rate',
        exec: 'ask',
        rate: 1500,
        timeUnit: '1m',
        duration: '20s',
        preAllocatedVUs: 10,
        maxVUs: 50,
      },
      health: { executor: 'constant-vus', exec: 'watch', vus: 1, duration: '20s', gracefulStop: '0s' },
    })
  })

  it('ramps the hosted pollers to 6,667 a second over a minute and holds them for two, the wallets reading in the second', () => {
    expect(optionsOf(parametersOf(HOSTED)).scenarios).toEqual({
      pollers: {
        executor: 'ramping-arrival-rate',
        exec: 'poll',
        startRate: 0,
        timeUnit: '1s',
        stages: [
          { duration: '60s', target: 6667 },
          { duration: '120s', target: 6667 },
        ],
        preAllocatedVUs: 1000,
        maxVUs: 3000,
      },
      wallets: {
        executor: 'constant-arrival-rate',
        exec: 'ask',
        rate: 5000,
        timeUnit: '1m',
        duration: '60s',
        startTime: '60s',
        preAllocatedVUs: 100,
        maxVUs: 500,
      },
      health: { executor: 'constant-vus', exec: 'watch', vus: 1, duration: '180s', gracefulStop: '0s' },
    })
  })

  it('holds each profile to its thresholds, the dropped iterations to 1% of those planned', () => {
    const common = {
      http_req_failed: ['rate<0.01'],
      checks: ['rate>0.99'],
      state_not_modified: ['rate>0.9'],
      degraded_answers: ['count==0'],
      early_open: ['count==0'],
      health_problems: ['max==0'],
    }
    expect(optionsOf(parametersOf(LOCAL)).thresholds).toEqual({
      ...common,
      'http_req_duration{route:state}': ['p(95)<200'],
      'http_req_duration{route:wallet}': ['p(95)<400'],
      dropped_iterations: ['count<=25'],
    })
    expect(optionsOf(parametersOf(HOSTED)).thresholds).toEqual({
      ...common,
      'http_req_duration{route:state}': ['p(95)<500'],
      'http_req_duration{route:wallet}': ['p(95)<1000'],
      dropped_iterations: ['count<=10050'],
      state_age_s: ['max<=10'],
      edge_mitigated: ['count==0'],
      health_counts_missing: ['count==0'],
      origin_busiest_per_s: ['max<=2'],
    })
    const rehearsal = parametersOf({ ...HOSTED, POLLERS: '2000', WALLETS: '500' })
    expect(optionsOf(rehearsal).thresholds.dropped_iterations).toEqual(['count<=1005'])
    expect(optionsOf(parametersOf(LOCAL)).summaryTrendStats).toEqual([
      'avg',
      'min',
      'med',
      'max',
      'p(90)',
      'p(95)',
      'p(99)',
      'count',
    ])
  })
})

describe('walletOf and the paths', () => {
  it('answers 40 lowercase hex digits, distinct for distinct asks and for distinct runs', () => {
    const start = 1_792_323_252_271
    expect(walletOf(start, 0)).toBe('0x01a14eca702f0000000000000000000000000000')
    expect(walletOf(start, 4999)).toBe('0x01a14eca702f0000000000000000000000001387')
    const asks = new Set(Array.from({ length: 5000 }, (_, n) => walletOf(start, n)))
    expect(asks.size).toBe(5000)
    expect(walletOf(start + 1, 7)).not.toBe(walletOf(start, 7))
  })

  it('lowercases the addresses', () => {
    const collection = { chainId: 31337, address: ADDRESS }
    expect(statePathOf(collection)).toBe(`/v1/state/31337/${ADDRESS.toLowerCase()}`)
    expect(walletPathOf(collection, '0xE7F1725E7734CE288F8367E1BB143E90BB3F0512')).toBe(
      `/v1/wallet/31337/${ADDRESS.toLowerCase()}/0xe7f1725e7734ce288f8367e1bb143e90bb3f0512`,
    )
  })
})

describe('livenessOf (section 5.3)', () => {
  const group = (id: number, flag: boolean, active: boolean, startTimestamp: number) => ({
    id,
    flag,
    active,
    startTimestamp,
  })

  it('counts a group open by its flag in none, a scheduled one before its start as waiting and at it as open', () => {
    expect(livenessOf({ blockTimestamp: 1_000, groups: [group(1, true, true, 0)] })).toEqual({
      early: 0,
      openBySchedule: 0,
      waiting: 0,
    })
    expect(livenessOf({ blockTimestamp: 999, groups: [group(0, false, false, 1_000)] })).toEqual({
      early: 0,
      openBySchedule: 0,
      waiting: 1,
    })
    expect(livenessOf({ blockTimestamp: 1_000, groups: [group(0, false, true, 1_000)] })).toEqual({
      early: 0,
      openBySchedule: 1,
      waiting: 0,
    })
  })

  it('counts a group active by neither its flag nor a reached start as early, and a closed unscheduled one in none', () => {
    expect(
      livenessOf({
        blockTimestamp: 999,
        groups: [group(0, false, true, 1_000), group(2, false, true, 0), group(3, false, false, 0)],
      }),
    ).toEqual({ early: 2, openBySchedule: 0, waiting: 0 })
  })
})

describe('edgeOf and headerOf', () => {
  it('reads a header in any case, as k6 hands them canonicalized', () => {
    expect(headerOf({ Etag: 'W/"1"', 'Cf-Cache-Status': 'HIT' }, 'etag')).toBe('W/"1"')
    expect(headerOf({ Etag: 'W/"1"' }, 'Age')).toBeNull()
    expect(headerOf(undefined, 'Age')).toBeNull()
  })

  it('counts each answer by its cf-cache-status, another value as other and none without one', () => {
    expect(EDGE_COUNTERS).toEqual([
      'edge_hit',
      'edge_miss',
      'edge_expired',
      'edge_revalidated',
      'edge_updating',
      'edge_stale',
      'edge_dynamic',
      'edge_bypass',
      'edge_other',
      'edge_none',
    ])
    expect(edgeOf(200, { 'Cf-Cache-Status': 'HIT', Age: '1' })).toEqual({
      cache: 'edge_hit',
      mitigated: false,
    })
    expect(edgeOf(304, { 'Cf-Cache-Status': 'revalidated' })).toEqual({
      cache: 'edge_revalidated',
      mitigated: false,
    })
    expect(edgeOf(200, { 'Cf-Cache-Status': 'NONE' })).toEqual({ cache: 'edge_other', mitigated: false })
    expect(edgeOf(200, { 'Content-Type': 'application/json' })).toEqual({
      cache: 'edge_none',
      mitigated: false,
    })
  })

  it("counts a challenge or a block from the edge in place of an answer as a mitigation, and an origin's JSON refusal as none", () => {
    const challenge = {
      'Cf-Mitigated': 'challenge',
      'Content-Type': 'text/html; charset=UTF-8',
      'Cf-Ray': '8f1a',
    }
    expect(edgeOf(403, challenge)).toEqual({ cache: 'edge_none', mitigated: true })
    expect(edgeOf(200, { 'Cf-Mitigated': 'challenge' })).toMatchObject({ mitigated: true })
    expect(edgeOf(403, { 'Content-Type': 'text/html' })).toMatchObject({ mitigated: true })
    expect(edgeOf(429, { 'Content-Type': 'text/html; charset=UTF-8' })).toMatchObject({ mitigated: true })
    const refusal = { 'Content-Type': 'application/json; charset=utf-8', 'Cf-Cache-Status': 'HIT' }
    expect(edgeOf(404, refusal)).toEqual({ cache: 'edge_hit', mitigated: false })
    expect(edgeOf(503, { 'Content-Type': 'application/json; charset=utf-8' })).toMatchObject({
      mitigated: false,
    })
  })
})

describe("notOkSentenceOf (section 10's setup sentence)", () => {
  it('answers null for an ok /health and the sentence with its problems otherwise', () => {
    expect(notOkSentenceOf(200, { status: 'ok', problems: [] })).toBeNull()
    expect(
      notOkSentenceOf(200, {
        status: 'degraded',
        problems: [
          'Anvil: no good read for 61 s (limit 60 s).',
          'Base: 11 failed reads in 5 minutes (limit 10).',
        ],
      }),
    ).toBe(
      'The freshness server is not ok before the run: Anvil: no good read for 61 s (limit 60 s). Base: 11 failed reads in 5 minutes (limit 10). Fix it, then run again.',
    )
    expect(notOkSentenceOf(0, null)).toBe(
      'The freshness server is not ok before the run: /health did not answer. Fix it, then run again.',
    )
    expect(notOkSentenceOf(200, { hot: 0 })).toBe(
      'The freshness server is not ok before the run: /health answered 200 without status ok. Fix it, then run again.',
    )
  })
})

describe("summaryLines (section 10's summary)", () => {
  const parameters = parametersOf(LOCAL)

  it('writes each line from a recorded local summary', () => {
    expect(summaryLines(RECORDED, parameters)).toEqual([
      'k6-freshness, local profile, against http://127.0.0.1:53247.',
      'State: 2,001 polls, 1,961 of the 1,981 that carried an ETag answered 304, p95 1.0 ms.',
      'Wallet: 501 reads, p95 211.9 ms.',
      'Failed: 0.00% of all requests. Dropped iterations: 0. Edge mitigations: 0.',
      'Edge cache: no answer came through Cloudflare.',
      'Origin: the busiest collection drew at most 25.0 state requests a second; the wallet windows peaked at 264 a minute.',
      'Thresholds: every one passed.',
    ])
  })

  it("lists the edge's statuses largest first, and says when /health carries no counts", () => {
    const behindTheEdge = {
      metrics: {
        ...RECORDED.metrics,
        edge_hit: { values: { count: 1_002_310 } },
        edge_revalidated: { values: { count: 1_204 } },
        edge_dynamic: { values: { count: 36 } },
        edge_expired: { values: { count: 36 } },
        edge_mitigated: { values: { count: 0 } },
        origin_busiest_per_s: { values: { count: 0 } },
        health_counts_missing: { values: { count: 36 } },
      },
    }
    const lines = summaryLines(behindTheEdge, parametersOf(HOSTED))
    expect(lines[0]).toBe('k6-freshness, hosted profile, against https://fresh.example.com.')
    expect(lines[4]).toBe('Edge cache: HIT 1,002,310, REVALIDATED 1,204, DYNAMIC 36, EXPIRED 36.')
    expect(lines[5]).toBe(
      "Origin: /health carries no request counts; deploy this sub-project's freshness server first.",
    )
  })

  it('names each failed threshold, and reads an aborted run as zeros', () => {
    const failing = {
      metrics: {
        ...RECORDED.metrics,
        state_not_modified: {
          ...RECORDED.metrics.state_not_modified,
          thresholds: { 'rate>0.9': { ok: false } },
        },
        origin_busiest_per_s: { values: { max: 3.2, count: 36 }, thresholds: { 'max<=2': { ok: false } } },
      },
    }
    expect(summaryLines(failing, parameters)[6]).toBe(
      'Thresholds failed: origin_busiest_per_s max<=2, state_not_modified rate>0.9.',
    )
    expect(summaryLines({ metrics: {} }, parameters).slice(1, 4)).toEqual([
      'State: 0 polls, 0 of the 0 that carried an ETag answered 304, p95 0.0 ms.',
      'Wallet: 0 reads, p95 0.0 ms.',
      'Failed: 0.00% of all requests. Dropped iterations: 0. Edge mitigations: 0.',
    ])
  })
})
```

- [ ] **Step 2: Run the test to see it fail**

Run: `pnpm --filter @cobweb/freshness exec vitest run load/profile.test.ts`
Expected: FAIL: `Cannot find module './profile.js'` and `Test Files  1 failed (1)`.

- [ ] **Step 3: The parameters, the options and the readings**

Create `apps/freshness/load/profile.js`:

```js
/**
 * The load run's parameters, options and readings (docs/specs/2026-10-18-load-run-contract-review-and-cloudflare.md,
 * section 5), pure and in plain JavaScript: it imports nothing from k6, so Vitest runs profile.test.ts beside it,
 * and k6-freshness.js builds the run from it. The pollers are driven as their rate (decision 3), so the edge and the
 * origin meet the requests 20,000 browsers polling every 3 s would send.
 */

/** Each profile's defaults: pollers, a poller's interval in seconds and wallet reads a minute. */
export const PROFILES = {
  local: { pollers: 100, intervalS: 1, wallets: 1500 },
  hosted: { pollers: 20000, intervalS: 3, wallets: 5000 },
}

/** The local run's length; the hosted pollers ramp for a minute and hold for two, the wallets read in the second. */
const LOCAL_S = 20
const RAMP_S = 60
const HOLD_S = 120

/** The `cf-cache-status` values Cloudflare answers, each counted in its own `edge_<value>` metric. */
const EDGE_STATUSES = ['HIT', 'MISS', 'EXPIRED', 'REVALIDATED', 'UPDATING', 'STALE', 'DYNAMIC', 'BYPASS']

/** The counters every answer counts in one of: its `cf-cache-status`, another value, or none. */
export const EDGE_COUNTERS = [
  ...EDGE_STATUSES.map((status) => `edge_${status.toLowerCase()}`),
  'edge_other',
  'edge_none',
]

const SENTENCES = {
  profile: 'PROFILE must be local or hosted.',
  base: "BASE must be the freshness server's origin, such as https://fresh.example.com.",
  collections: 'COLLECTIONS must list one or more <chain id>/<address>, separated by commas.',
  numbers: 'POLLERS, INTERVAL_S and WALLETS must be whole numbers above 0.',
}

/** http or https, a host or an IPv6 literal, an optional port, and no path but an optional trailing slash. */
const ORIGIN = /^https?:\/\/(?:[a-z0-9.-]+|\[[0-9a-f:.]+\])(?::[0-9]{1,5})?\/?$/i
const COLLECTION = /^([1-9][0-9]{0,15})\/(0x[0-9a-fA-F]{40})$/
const WHOLE = /^[1-9][0-9]{0,8}$/

/**
 * The run's parameters from k6's `__ENV` (or any object of strings): the profile, the freshness origin, the
 * collections, the pollers, their interval, the wallet reads a minute and where the JSON summary goes. Throws the
 * sentence of section 10 for the first value it cannot use.
 */
export function parametersOf(env) {
  const profile = env.PROFILE
  if (profile !== 'local' && profile !== 'hosted') throw new Error(SENTENCES.profile)
  const base = String(env.BASE ?? '').trim()
  if (!ORIGIN.test(base)) throw new Error(SENTENCES.base)
  const collections = String(env.COLLECTIONS ?? '')
    .split(',')
    .map((entry) => COLLECTION.exec(entry.trim()))
  if (collections.some((match) => match === null)) throw new Error(SENTENCES.collections)
  const defaults = PROFILES[profile]
  const whole = (value, fallback) => {
    const text = String(value ?? '').trim()
    if (text === '') return fallback
    if (!WHOLE.test(text)) throw new Error(SENTENCES.numbers)
    return Number(text)
  }
  return {
    profile,
    base: base.replace(/\/$/, ''),
    collections: collections.map((match) => ({ chainId: Number(match[1]), address: match[2] })),
    pollers: whole(env.POLLERS, defaults.pollers),
    intervalS: whole(env.INTERVAL_S, defaults.intervalS),
    wallets: whole(env.WALLETS, defaults.wallets),
    summaryFile: String(env.SUMMARY_FILE ?? '').trim() || null,
  }
}

/** The pollers' rate: POLLERS divided by INTERVAL_S polls a second, at least one. */
function pollRateOf(parameters) {
  return Math.max(1, Math.round(parameters.pollers / parameters.intervalS))
}

/**
 * k6's options: the three scenarios of section 5.2, the thresholds of section 5.4 with the dropped iterations held
 * to 1% of those the scenarios plan, and the summary's trend statistics with `p(99)` and `count` added.
 */
export function optionsOf(parameters) {
  const rate = pollRateOf(parameters)
  const hosted = parameters.profile === 'hosted'
  const scenarios = hosted
    ? {
        pollers: {
          executor: 'ramping-arrival-rate',
          exec: 'poll',
          startRate: 0,
          timeUnit: '1s',
          stages: [
            { duration: `${RAMP_S}s`, target: rate },
            { duration: `${HOLD_S}s`, target: rate },
          ],
          preAllocatedVUs: 1000,
          maxVUs: 3000,
        },
        wallets: {
          executor: 'constant-arrival-rate',
          exec: 'ask',
          rate: parameters.wallets,
          timeUnit: '1m',
          duration: `${RAMP_S}s`,
          startTime: `${RAMP_S}s`,
          preAllocatedVUs: 100,
          maxVUs: 500,
        },
        health: {
          executor: 'constant-vus',
          exec: 'watch',
          vus: 1,
          duration: `${RAMP_S + HOLD_S}s`,
          gracefulStop: '0s',
        },
      }
    : {
        pollers: {
          executor: 'constant-arrival-rate',
          exec: 'poll',
          rate,
          timeUnit: '1s',
          duration: `${LOCAL_S}s`,
          preAllocatedVUs: 20,
          maxVUs: 100,
        },
        wallets: {
          executor: 'constant-arrival-rate',
          exec: 'ask',
          rate: parameters.wallets,
          timeUnit: '1m',
          duration: `${LOCAL_S}s`,
          preAllocatedVUs: 10,
          maxVUs: 50,
        },
        health: {
          executor: 'constant-vus',
          exec: 'watch',
          vus: 1,
          duration: `${LOCAL_S}s`,
          gracefulStop: '0s',
        },
      }
  const planned = hosted
    ? rate * (RAMP_S / 2 + HOLD_S) + parameters.wallets * (RAMP_S / 60)
    : rate * LOCAL_S + Math.round((parameters.wallets * LOCAL_S) / 60)
  const thresholds = {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{route:state}': [hosted ? 'p(95)<500' : 'p(95)<200'],
    'http_req_duration{route:wallet}': [hosted ? 'p(95)<1000' : 'p(95)<400'],
    checks: ['rate>0.99'],
    state_not_modified: ['rate>0.9'],
    degraded_answers: ['count==0'],
    early_open: ['count==0'],
    health_problems: ['max==0'],
    dropped_iterations: [`count<=${Math.floor(planned / 100)}`],
  }
  if (hosted)
    Object.assign(thresholds, {
      state_age_s: ['max<=10'],
      edge_mitigated: ['count==0'],
      health_counts_missing: ['count==0'],
      origin_busiest_per_s: ['max<=2'],
    })
  return {
    scenarios,
    thresholds,
    summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)', 'count'],
  }
}

/** `/v1/state/<chain id>/<lowercase address>`: one edge entry per collection. */
export function statePathOf(collection) {
  return `/v1/state/${collection.chainId}/${collection.address.toLowerCase()}`
}

/** `/v1/wallet/<chain id>/<lowercase address>/<lowercase wallet>`. */
export function walletPathOf(collection, wallet) {
  return `/v1/wallet/${collection.chainId}/${collection.address.toLowerCase()}/${wallet.toLowerCase()}`
}

/**
 * A wallet no other ask of this run or of another run reads: `0x`, the run's start in 12 hex digits and the
 * ask's number in 28, lowercase.
 */
export function walletOf(runStartMs, n) {
  return `0x${runStartMs.toString(16).padStart(12, '0')}${n.toString(16).padStart(28, '0')}`
}

/**
 * How a state body's groups read against its own block time: `early` counts a group active by neither its flag
 * nor a reached start (a start of 0 or above the block's time), `openBySchedule` one active by its start alone,
 * and `waiting` one closed whose start is still ahead. A group open by its flag counts in none.
 */
export function livenessOf(body) {
  const counts = { early: 0, openBySchedule: 0, waiting: 0 }
  for (const group of body.groups) {
    if (group.flag) continue
    const reached = group.startTimestamp !== 0 && group.startTimestamp <= body.blockTimestamp
    if (group.active && !reached) counts.early++
    else if (group.active) counts.openBySchedule++
    else if (group.startTimestamp > body.blockTimestamp) counts.waiting++
  }
  return counts
}

/** A response header by name in any case, as k6 hands them canonicalized; null without it. */
export function headerOf(headers, name) {
  const wanted = name.toLowerCase()
  for (const key of Object.keys(headers ?? {})) if (key.toLowerCase() === wanted) return String(headers[key])
  return null
}

/**
 * Where an answer counts at the edge: the `edge_<value>` counter of its `cf-cache-status`, `edge_other` for another
 * value, `edge_none` without one; and whether the edge mitigated it, a `cf-mitigated` header or a 403 or 429 of HTML,
 * which a challenge or a block answers in place of the origin's JSON.
 */
export function edgeOf(status, headers) {
  const value = headerOf(headers, 'cf-cache-status')
  const upper = value === null ? null : value.trim().toUpperCase()
  const cache =
    upper === null
      ? 'edge_none'
      : EDGE_STATUSES.includes(upper)
        ? `edge_${upper.toLowerCase()}`
        : 'edge_other'
  const html = (headerOf(headers, 'content-type') ?? '').toLowerCase().includes('text/html')
  return {
    cache,
    mitigated: headerOf(headers, 'cf-mitigated') !== null || ((status === 403 || status === 429) && html),
  }
}

/**
 * The sentence `setup` aborts the run with when /health is not ok, its problems joined by spaces (each keeps its own
 * full stop until the last, where the sentence's own goes); null when it is ok.
 */
export function notOkSentenceOf(status, body) {
  if (status === 200 && body?.status === 'ok') return null
  const problems =
    Array.isArray(body?.problems) && body.problems.length
      ? body.problems.join(' ')
      : status === 0
        ? '/health did not answer'
        : `/health answered ${status} without status ok`
  return `The freshness server is not ok before the run: ${problems.replace(/\.$/, '')}. Fix it, then run again.`
}

/** A whole number with its thousands grouped. */
const grouped = (value) => String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

/** Section 10's summary lines from k6's summary data, in place of k6's own text summary. */
export function summaryLines(data, parameters) {
  const metrics = data?.metrics ?? {}
  const number = (name, key) => {
    const value = metrics[name]?.values?.[key]
    return typeof value === 'number' && Number.isFinite(value) ? value : 0
  }
  const state = 'http_req_duration{route:state}'
  const wallet = 'http_req_duration{route:wallet}'
  const passes = number('state_not_modified', 'passes')
  const carried = passes + number('state_not_modified', 'fails')
  const cache = [...EDGE_STATUSES, 'other']
    .map((status) => [status, number(`edge_${status.toLowerCase()}`, 'count')])
    .filter(([, count]) => count > 0)
    .sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1))
  const failed = Object.keys(metrics)
    .sort()
    .flatMap((name) =>
      Object.entries(metrics[name].thresholds ?? {})
        .filter(([, result]) => !result.ok)
        .map(([expression]) => `${name} ${expression}`),
    )
  return [
    `k6-freshness, ${parameters.profile} profile, against ${parameters.base}.`,
    `State: ${grouped(number(state, 'count'))} polls, ${grouped(passes)} of the ${grouped(carried)} that carried an ETag answered 304, p95 ${number(state, 'p(95)').toFixed(1)} ms.`,
    `Wallet: ${grouped(number(wallet, 'count'))} reads, p95 ${number(wallet, 'p(95)').toFixed(1)} ms.`,
    `Failed: ${(number('http_req_failed', 'rate') * 100).toFixed(2)}% of all requests. Dropped iterations: ${grouped(number('dropped_iterations', 'count'))}. Edge mitigations: ${grouped(number('edge_mitigated', 'count'))}.`,
    cache.length
      ? `Edge cache: ${cache.map(([status, count]) => `${status} ${grouped(count)}`).join(', ')}.`
      : 'Edge cache: no answer came through Cloudflare.',
    number('origin_busiest_per_s', 'count') > 0
      ? `Origin: the busiest collection drew at most ${number('origin_busiest_per_s', 'max').toFixed(1)} state requests a second; the wallet windows peaked at ${grouped(number('origin_wallet_windows_per_min', 'max'))} a minute.`
      : "Origin: /health carries no request counts; deploy this sub-project's freshness server first.",
    failed.length ? `Thresholds failed: ${failed.join(', ')}.` : 'Thresholds: every one passed.',
  ]
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `pnpm --filter @cobweb/freshness exec vitest run load/profile.test.ts`
Expected: PASS, `Tests  17 passed (17)`.

- [ ] **Step 5: The k6 entry**

Create `apps/freshness/load/k6-freshness.js`:

```js
/* global __ENV */
/**
 * The load run (docs/specs/2026-10-18-load-run-contract-review-and-cloudflare.md, section 5): pollers on the state
 * endpoint at their rate, each VU keeping the last ETag per collection as one browser's cache does and sending the
 * page's own request headers, wallet reads of wallets no other ask reads, and /health every 5 s for the origin's
 * own counts. It keeps the legacy script's shape alone (a failed rate and a 95th percentile as thresholds, a check
 * per route); nothing of it is copied. `verify:load` runs the local profile against Anvil; the owner runs the hosted
 * one behind Cloudflare:
 *
 *   k6 run --no-usage-report -e PROFILE=hosted -e BASE=https://<freshness domain> \
 *     -e COLLECTIONS=<chain id>/<address> -e SUMMARY_FILE=$HOME/k6-hosted.json apps/freshness/load/k6-freshness.js
 */
import { check, sleep } from 'k6'
import exec from 'k6/execution'
import http from 'k6/http'
import { Counter, Rate, Trend } from 'k6/metrics'
import {
  EDGE_COUNTERS,
  edgeOf,
  headerOf,
  livenessOf,
  notOkSentenceOf,
  optionsOf,
  parametersOf,
  statePathOf,
  summaryLines,
  walletOf,
  walletPathOf,
} from './profile.js'

const parameters = parametersOf(__ENV)
export const options = optionsOf(parameters)

const stateAnswers = new Counter('state_answers')
const notModified = new Rate('state_not_modified')
const earlyOpen = new Counter('early_open')
const scheduledOpenReads = new Counter('scheduled_open_reads')
const scheduledWaitingReads = new Counter('scheduled_waiting_reads')
const degradedAnswers = new Counter('degraded_answers')
const stateAge = new Trend('state_age_s')
const walletAnswers = new Counter('wallet_answers')
const edgeCounters = Object.fromEntries(EDGE_COUNTERS.map((name) => [name, new Counter(name)]))
const edgeMitigated = new Counter('edge_mitigated')
const healthProblems = new Trend('health_problems')
const originBusiest = new Trend('origin_busiest_per_s')
const originState = new Trend('origin_state_per_s')
const originWalletWindows = new Trend('origin_wallet_windows_per_min')
const healthCountsMissing = new Counter('health_counts_missing')

/** The last ETag this VU holds per state path, as one browser's cache keeps it. */
const held = {}
/** This VU's last /health read of the wallet windows and its time. */
let lastWindows = null

/** Counts an answer by its `cf-cache-status`, and as mitigated when the edge challenged or blocked it. */
function edge(answer) {
  const { cache, mitigated } = edgeOf(answer.status, answer.headers)
  edgeCounters[cache].add(1)
  if (mitigated) edgeMitigated.add(1)
}

/** An answer's JSON body, or null when it has none. */
function bodyOf(answer) {
  try {
    return answer.json()
  } catch {
    return null
  }
}

/** Reads /health once and aborts the run with section 10's sentence when it is not ok. */
export function setup() {
  const answer = http.get(`${parameters.base}/health`, { tags: { route: 'health', name: 'health' } })
  const sentence = notOkSentenceOf(answer.status, bodyOf(answer))
  if (sentence) exec.test.abort(sentence)
}

/**
 * One poll of the VU's collection: the page's `cache: 'reload'` headers while no ETag is held, then its
 * `cache: 'no-cache'` headers with the held ETag (decision 4).
 */
export function poll() {
  const collection = parameters.collections[exec.vu.idInTest % parameters.collections.length]
  const path = statePathOf(collection)
  const etag = held[path] ?? null
  const headers = etag
    ? { 'Cache-Control': 'max-age=0', 'If-None-Match': etag }
    : { 'Cache-Control': 'no-cache', Pragma: 'no-cache' }
  const answer = http.get(`${parameters.base}${path}`, { headers, tags: { route: 'state', name: 'state' } })
  edge(answer)
  const answered = answer.status === 200 || answer.status === 304
  check(answer, { 'state answered 200 or 304': () => answered })
  if (!answered) return
  stateAnswers.add(1)
  const age = Number(headerOf(answer.headers, 'age') ?? 0)
  stateAge.add(Number.isFinite(age) && age > 0 ? age : 0)
  if (etag) {
    notModified.add(answer.status === 304)
    if (answer.status === 304)
      check(answer, {
        'a 304 carries the ETag it was asked with': () => headerOf(answer.headers, 'etag') === etag,
      })
  }
  if (answer.status !== 200) return
  const tag = headerOf(answer.headers, 'etag')
  if (tag) held[path] = tag
  const body = bodyOf(answer)
  const own =
    body !== null &&
    body.chainId === collection.chainId &&
    String(body.address).toLowerCase() === collection.address.toLowerCase() &&
    Array.isArray(body.groups)
  check(answer, { "a 200 body is the asked collection's state": () => own })
  if (!own) return
  const liveness = livenessOf(body)
  earlyOpen.add(liveness.early)
  scheduledOpenReads.add(liveness.openBySchedule)
  scheduledWaitingReads.add(liveness.waiting)
  degradedAnswers.add(body.degraded === true ? 1 : 0)
}

/** One wallet read, of a wallet no other ask of this run or of another run reads. */
export function ask() {
  const n = exec.scenario.iterationInTest
  const collection = parameters.collections[n % parameters.collections.length]
  const wallet = walletOf(exec.scenario.startTime, n)
  const answer = http.get(`${parameters.base}${walletPathOf(collection, wallet)}`, {
    headers: { 'Cache-Control': 'max-age=0' },
    tags: { route: 'wallet', name: 'wallet' },
  })
  edge(answer)
  check(answer, { 'wallet answered 200': () => answer.status === 200 })
  if (answer.status === 200) walletAnswers.add(1)
}

/** /health every 5 s: ok, its problems, the origin's state requests a second and the wallet windows a minute. */
export function watch() {
  const answer = http.get(`${parameters.base}/health`, { tags: { route: 'health', name: 'health' } })
  edge(answer)
  const body = bodyOf(answer)
  check(answer, { '/health answered 200 and ok': () => answer.status === 200 && body?.status === 'ok' })
  if (body !== null) {
    if (Array.isArray(body.problems)) healthProblems.add(body.problems.length)
    if (body.requests) {
      originBusiest.add(body.requests.busiest / body.requests.windowS)
      originState.add(body.requests.state / body.requests.windowS)
    } else healthCountsMissing.add(1)
    if (body.wallet) {
      const now = Date.now()
      if (lastWindows !== null && now > lastWindows.at)
        originWalletWindows.add(
          ((body.wallet.windows - lastWindows.windows) * 60000) / (now - lastWindows.at),
        )
      lastWindows = { windows: body.wallet.windows, at: now }
    }
  }
  sleep(5)
}

/** Section 10's lines on standard output, and k6's JSON summary to SUMMARY_FILE when it is set. */
export function handleSummary(data) {
  const summary = { stdout: `${summaryLines(data, parameters).join('\n')}\n` }
  if (parameters.summaryFile) summary[parameters.summaryFile] = JSON.stringify(data)
  return summary
}
```

- [ ] **Step 6: k6 reads both profiles, and refuses a run with no profile**

Run, from the repo root:

```bash
k6 inspect -e PROFILE=local -e BASE=http://127.0.0.1:3100 -e COLLECTIONS=31337/0x5FbDB2315678afecb367f032d93F642f64180aa3 apps/freshness/load/k6-freshness.js | python3 -c 'import json, sys; o = json.load(sys.stdin); print(o["scenarios"]["pollers"]["rate"], o["thresholds"]["dropped_iterations"], len(o["thresholds"]))'
k6 inspect -e PROFILE=hosted -e BASE=https://fresh.example.com -e COLLECTIONS=11155111/0x5FbDB2315678afecb367f032d93F642f64180aa3 apps/freshness/load/k6-freshness.js | python3 -c 'import json, sys; o = json.load(sys.stdin); print(o["scenarios"]["pollers"]["stages"][1]["target"], o["thresholds"]["dropped_iterations"], len(o["thresholds"]))'
k6 run --quiet --no-usage-report apps/freshness/load/k6-freshness.js
```

Expected: `100 ['count<=25'] 9`; then `6667 ['count<=10050'] 13`; then the last command fails with exit code 107 and a line holding `Error: PROFILE must be local or hosted.` (k6 inspects without running, so no server is needed).

- [ ] **Step 7: Lint the freshness server**

Run: `pnpm --filter @cobweb/freshness lint`
Expected: PASS (ESLint reads `load/` with the root config; `__ENV` is declared by the file's `/* global __ENV */`).

- [ ] **Step 8: Format, run the root checks and commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
pnpm exec prettier --write apps/freshness/load/profile.js apps/freshness/load/profile.test.ts apps/freshness/load/k6-freshness.js
pnpm typecheck && pnpm lint && pnpm test
git add apps/freshness/load/profile.js apps/freshness/load/profile.test.ts apps/freshness/load/k6-freshness.js
git commit -m "$(cat <<'EOF'
Port the load test to k6 against the freshness server's state and wallet endpoints, with a local and a hosted profile driven at the pollers' rate and the page's own request headers

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: freshness 261 tests in 20 files; the other packages unchanged.

---

### Task 3: `verify:load`

**Kind:** integration: k6 as a child process judged against the server's own counts while a phase starts on Anvil: an Opus implementer.

**Files:**

- Create: `apps/web/scripts/verify-load.ts`
- Modify: `apps/web/package.json` (`verify:load`)
- Test: `pnpm --filter @cobweb/web verify:load`

**Interfaces:**

- Consumes: `startFreshness`, `Freshness`, `HealthBody` (with `requests`, Task 1) and `StateBody` from `@cobweb/freshness/server`; `apps/freshness/load/k6-freshness.js` with its local profile, its metrics and its check names (Task 2); from `scripts/chain-fixture.ts`, `chain`, `chainReady`, `check`, `CID`, `collectionSalt`, `COLLECTION_CREATION_CODE`, `encodeCollectionArgs`, `factory`, `factoryAbi`, `predictCollectionAddress`, `rpc`, `runChecks`, `sendCall` and `sendRequest`; `phaseCalls.open` and `phaseCalls.schedule` from `src/lib/manage/phase-calls.ts`.
- Produces: `pnpm --filter @cobweb/web verify:load`, the spec's 10 checks in about 35 s, with k6's summary lines relayed under check 3; it leaves one collection on Anvil, about 35 blocks later.

- [ ] **Step 1: The script**

It deploys one collection from a fresh key straight through the factory (simulated, then the simulated request sent), opens Holders, starts the server in process, schedules Public 10 s ahead, mines a block every second, makes one state read, runs k6's local profile for 20 s and judges its exit code, its JSON summary and `/health` (spec section 6; Decision 11).

Create `apps/web/scripts/verify-load.ts`:

```ts
// Runs k6's local profile against the freshness server in process and a LOCAL Anvil chain
// (docs/specs/2026-10-18-load-run-contract-review-and-cloudflare.md, section 6): one collection deployed straight
// through the factory (the deploy simulated, then the simulated request sent), Holders open and Public scheduled
// 10 s ahead with a block mined every second, then `k6 run` as a child process for 20 s, judged by its exit code,
// its JSON summary and /health's request counts. The scheduled start falls inside the run, so the run also shows
// liveness turning under load, and never early. Ten PASS lines. Needs Anvil with the factory and k6 on the PATH;
// no Supabase (the indexer stays off).
//
//   pnpm --filter @cobweb/web chain:local    (then copy its two lines into apps/web/.env.local)
//   brew install k6
//   pnpm --filter @cobweb/web verify:load
//
// The chain fixture (scripts/chain-fixture.ts) reads the settings from the environment and apps/web/.env.local
// and refuses a non-local endpoint. Never prints a key, and hands k6 none of its settings. The collection stays
// on Anvil, about 35 blocks later. Runs under `node --conditions=react-server --import ./scripts/resolve-ts.mjs`.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isAddressEqual, parseEther, type Address } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { startFreshness, type Freshness, type HealthBody, type StateBody } from '@cobweb/freshness/server'
import {
  chain,
  chainReady,
  check,
  CID,
  collectionSalt,
  COLLECTION_CREATION_CODE,
  encodeCollectionArgs,
  factory,
  factoryAbi,
  predictCollectionAddress,
  rpc,
  runChecks,
  sendCall,
  sendRequest,
} from './chain-fixture.ts'

const { phaseCalls } = await import('../src/lib/manage/phase-calls.ts')

/** The launch groups the collection deploys with: Public (id 0) and Holders (id 1). */
const PUBLIC = 0
const HOLDERS = 1
/** Public's scheduled start, ahead of the latest block's time. */
const START_AHEAD_S = 10
const K6_SCRIPT = fileURLToPath(new URL('../../freshness/load/k6-freshness.js', import.meta.url))
const K6_MISSING = 'k6 is not installed; install it with brew install k6.'

const creatorKey = privateKeyToAccount(generatePrivateKey())

/** k6's JSON summary, the parts this script reads. */
type K6Metric = { values: Record<string, number>; thresholds?: Record<string, { ok: boolean }> }
type K6Summary = {
  metrics: Record<string, K6Metric>
  root_group: { checks: { name: string; passes: number; fails: number }[] }
}

let freshness: Freshness | null = null
let ticker: ReturnType<typeof setInterval> | null = null
let mining: Promise<unknown> = Promise.resolve()
let k6: ChildProcess | null = null
let folder: string | null = null

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** A request to the server, failed after 5 s so a hung answer fails its check instead of stalling it. */
async function get(path: string): Promise<Response> {
  if (!freshness) throw new Error('the server is not running')
  return fetch(`${freshness.url}${path}`, { signal: AbortSignal.timeout(5_000) })
}
const healthOf = async () => (await (await get('/health')).json()) as HealthBody

/**
 * A collection deployed straight through the factory from the creator, recording nothing: the deploy is
 * simulated, the factory's answer must be the predicted address, and the simulated request is sent as it is.
 */
async function deployCollection(): Promise<Address> {
  const args = encodeCollectionArgs({
    name: 'Load run',
    symbol: 'LOAD',
    payout: creatorKey.address,
    baseUri: `ipfs://${CID('e')}/`,
    maxSupply: 5n,
    groupSupplies: [3n, 2n],
    groupPrices: [0n, 0n],
    publicMaxPerWallet: 2n,
    royaltyBps: 500,
    owner: creatorKey.address,
    royaltyReceiver: creatorKey.address,
  })
  const salt = collectionSalt(randomUUID())
  const address = predictCollectionAddress({
    factory,
    deployer: creatorKey.address,
    salt,
    creationCode: COLLECTION_CREATION_CODE,
    args,
  })
  const { request, result } = await chain.simulateContract({
    account: creatorKey,
    address: factory,
    abi: factoryAbi,
    functionName: 'deployCollection',
    args: [COLLECTION_CREATION_CODE, args, salt],
  })
  if (!isAddressEqual(result, address))
    throw new Error(`the collection would deploy at ${result}, not ${address}`)
  await sendRequest(creatorKey, request)
  return address
}

/** Mines one block a second until `stopTicker`. */
function startTicker(): void {
  ticker = setInterval(() => {
    mining = chain.mine({ blocks: 1 }).catch(() => {})
  }, 1_000)
}

/** Stops the ticker and waits for a block it was mining. */
async function stopTicker(): Promise<void> {
  if (ticker) clearInterval(ticker)
  ticker = null
  await mining
}

/**
 * `k6 run` with the arguments, its output gathered; the exit code is null when k6 could not start. k6 sees its
 * PATH, HOME and NODE_ENV alone, so no setting of this process reaches its `__ENV`.
 */
function runK6(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: process.env.NODE_ENV,
      PATH: process.env.PATH,
      HOME: process.env.HOME,
    }
    const child = spawn('k6', args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
    k6 = child
    let stdout = ''
    let stderr = ''
    child.stdout!.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')))
    child.stderr!.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')))
    child.once('error', (error) => resolve({ code: null, stdout, stderr: error.message }))
    child.once('close', (code) => {
      k6 = null
      resolve({ code, stdout, stderr })
    })
  })
}

async function main(): Promise<void> {
  const version = spawnSync('k6', ['version'], { encoding: 'utf8' })
  const k6Version = version.error ? null : (version.stdout.trim().split('\n')[0] ?? '')
  console.log(`Verifying the load run with ${k6Version ?? 'no k6'} against ${rpc}`)
  await check(
    '1. setup: k6 answers its version, Anvil answers as 31337 and the factory approves the shipped creation code hash',
    async () => (k6Version?.startsWith('k6 v') ? chainReady() : K6_MISSING),
  )
  await chain.setBalance({ address: creatorKey.address, value: parseEther('10') })
  const collection = await deployCollection()
  await sendCall(creatorKey, collection, phaseCalls.open(HOLDERS))
  freshness = await startFreshness({ port: 0, host: '127.0.0.1', chainIds: [31337] })
  const server = freshness
  const T = Number((await chain.getBlock()).timestamp) + START_AHEAD_S
  await sendCall(creatorKey, collection, phaseCalls.schedule(PUBLIC, T))
  startTicker()

  await check(
    "2. server: with Holders open and Public scheduled 10 s ahead, the collection's first state read answers 200 with Public scheduled and inactive, and /health reads ok, counting that read alone",
    async () => {
      const answer = await get(`/v1/state/31337/${collection.toLowerCase()}`)
      if (answer.status !== 200) return `${answer.status} ${await answer.text()}`
      const groups = ((await answer.json()) as StateBody).groups
      const publicGroup = groups.find((group) => group.id === PUBLIC)
      const holders = groups.find((group) => group.id === HOLDERS)
      if (publicGroup?.startTimestamp !== T || publicGroup.active || publicGroup.flag || !holders?.active)
        return `groups ${JSON.stringify(groups)}`
      const health = await healthOf()
      if (health.status !== 'ok' || health.problems.length)
        return `${health.status}: ${health.problems.join(' ')}`
      const counted = {
        windowS: 60,
        state: 1,
        notModified: 0,
        wallet: 0,
        refused: 0,
        collections: 1,
        busiest: 1,
      }
      return JSON.stringify(health.requests) === JSON.stringify(counted)
        ? null
        : `requests ${JSON.stringify(health.requests)}`
    },
  )

  folder = await mkdtemp(join(tmpdir(), 'cobweb-load-'))
  const summaryFile = join(folder, 'summary.json')
  const run = await runK6([
    'run',
    '--quiet',
    '--no-color',
    '--no-usage-report',
    '-e',
    'PROFILE=local',
    '-e',
    `BASE=${server.url}`,
    '-e',
    `COLLECTIONS=31337/${collection}`,
    '-e',
    `SUMMARY_FILE=${summaryFile}`,
    K6_SCRIPT,
  ])
  let summary: K6Summary = { metrics: {}, root_group: { checks: [] } }
  const value = (name: string, key: string) => summary.metrics[name]?.values[key] ?? 0
  const checked = (name: string) => summary.root_group.checks.find((entry) => entry.name === name)

  await check(
    '3. run: k6 runs the local profile for 20 s, 100 state polls and 25 wallet reads a second, and exits 0 with every threshold passed',
    async () => {
      if (run.code === null) return K6_MISSING
      summary = JSON.parse(await readFile(summaryFile, 'utf8')) as K6Summary
      const failed = Object.entries(summary.metrics).flatMap(([name, metric]) =>
        Object.entries(metric.thresholds ?? {})
          .filter(([, result]) => !result.ok)
          .map(([expression]) => `${name} ${expression}`),
      )
      if (failed.length) return `k6 exited ${run.code}; thresholds failed: ${failed.join(', ')}`
      return run.code === 0 ? null : `k6 exited ${run.code}: ${run.stderr.trim().split('\n').pop()}`
    },
  )
  for (const line of run.stdout.split('\n').filter(Boolean)) console.log(`  ${line}`)

  await check(
    '4. state: at least 1,900 of the 2,000 planned state polls answered 200 or 304, with p95 under 200 ms and under 1% failed',
    async () => {
      const answered = value('state_answers', 'count')
      const p95 = value('http_req_duration{route:state}', 'p(95)')
      const failed = value('http_req_failed', 'rate')
      return answered >= 1_900 && p95 < 200 && failed < 0.01
        ? null
        : `${answered} answered, p95 ${p95} ms, ${failed * 100}% failed`
    },
  )

  await check(
    '5. 304: at least 90% of the polls that carried an ETag answered 304, each with the ETag it carried',
    async () => {
      const notModified = value('state_not_modified', 'passes')
      const carried = notModified + value('state_not_modified', 'fails')
      const tagged = checked('a 304 carries the ETag it was asked with')
      if (!carried || notModified / carried < 0.9) return `${notModified} of the ${carried} answered 304`
      return tagged?.passes === notModified && tagged.fails === 0
        ? null
        : `the ETag check: ${JSON.stringify(tagged)} for ${notModified} 304s`
    },
  )

  await check(
    '6. wallet: at least 475 of the 500 planned wallet reads answered 200, with p95 under 400 ms',
    async () => {
      const answered = value('wallet_answers', 'count')
      const p95 = value('http_req_duration{route:wallet}', 'p(95)')
      return answered >= 475 && p95 < 400 ? null : `${answered} answered, p95 ${p95} ms`
    },
  )

  await check(
    '7. liveness under load: polls before the start read Public scheduled and inactive, polls after it read Public active, and no poll read a group active by neither its flag nor a reached start',
    async () => {
      const waiting = value('scheduled_waiting_reads', 'count')
      const open = value('scheduled_open_reads', 'count')
      const early = value('early_open', 'count')
      return waiting > 0 && open > 0 && early === 0
        ? null
        : `${waiting} read Public waiting, ${open} read it open by its start, ${early} read a group early`
    },
  )

  await check(
    '8. degraded: no answer read degraded, and every /health read k6 made during the run was ok with no problem',
    async () => {
      const degraded = value('degraded_answers', 'count')
      const healthy = checked('/health answered 200 and ok')
      const problems = value('health_problems', 'max')
      return degraded === 0 && healthy && healthy.passes > 0 && healthy.fails === 0 && problems === 0
        ? null
        : `${degraded} degraded, /health ${JSON.stringify(healthy)}, at most ${problems} problems`
    },
  )

  await check(
    "9. origin counts: /health counts, over the last minute, exactly the run's state answers plus the setup's read, its 304s and its wallet answers, all on one collection, which is the busiest, and no refusal",
    async () => {
      const { requests } = await healthOf()
      const state = value('state_answers', 'count') + 1
      const counted = {
        windowS: 60,
        state,
        notModified: value('state_not_modified', 'passes'),
        wallet: value('wallet_answers', 'count'),
        refused: 0,
        collections: 1,
        busiest: state,
      }
      return JSON.stringify(requests) === JSON.stringify(counted)
        ? null
        : `/health ${JSON.stringify(requests)}, k6 ${JSON.stringify(counted)}`
    },
  )

  await check(
    '10. stop: the ticker stops, close() ends the server and its port refuses a connection',
    async () => {
      await stopTicker()
      const block = await chain.getBlockNumber({ cacheTime: 0 })
      await wait(1_500)
      const later = await chain.getBlockNumber({ cacheTime: 0 })
      if (later !== block) return `blocks ${block} then ${later}: the ticker still mines`
      await server.close()
      freshness = null
      try {
        await fetch(`${server.url}/health`, { signal: AbortSignal.timeout(2_000) })
        return 'the port still answers'
      } catch {
        return null
      }
    },
  )
}

async function cleanup(): Promise<void> {
  k6?.kill('SIGKILL')
  await stopTicker()
  await freshness?.close()
  if (folder) await rm(folder, { recursive: true, force: true })
}

await runChecks(main, cleanup)
```

- [ ] **Step 2: The command**

In `apps/web/package.json`, replace:

```json
    "verify:csp": "node --conditions=react-server --import ./scripts/resolve-ts.mjs scripts/verify-csp.ts",
    "verify:sources": "node --conditions=react-server --import ./scripts/resolve-ts.mjs scripts/verify-sources.ts"
  },
```

with:

```json
    "verify:csp": "node --conditions=react-server --import ./scripts/resolve-ts.mjs scripts/verify-csp.ts",
    "verify:sources": "node --conditions=react-server --import ./scripts/resolve-ts.mjs scripts/verify-sources.ts",
    "verify:load": "node --conditions=react-server --import ./scripts/resolve-ts.mjs scripts/verify-load.ts"
  },
```

- [ ] **Step 3: Run it with no k6 on the PATH, to see check 1 refuse with its sentence**

Run, from `apps/web`: `env PATH=/usr/bin:/bin "$(command -v node)" --conditions=react-server --import ./scripts/resolve-ts.mjs scripts/verify-load.ts`
Expected: FAIL, exit code 1: `FAIL 1. setup: k6 answers its version, Anvil answers as 31337 and the factory approves the shipped creation code hash: k6 is not installed; install it with brew install k6.`, check 3 failing with the same sentence, and `3 passed, 7 failed` (checks 2, 9 and 10 pass with no k6).

- [ ] **Step 4: Run it**

Run: `pnpm --filter @cobweb/web verify:load`
Expected: PASS, `10 passed, 0 failed`, with k6's seven summary lines indented under check 3's line, from `  k6-freshness, local profile, against http://127.0.0.1:<port>.` to `  Thresholds: every one passed.`, the state line reading about 2,000 polls with about 1,960 of the 1,980 that carried an ETag answered 304.

- [ ] **Step 5: Typecheck and lint the web app**

Run: `pnpm --filter @cobweb/web typecheck && pnpm --filter @cobweb/web lint`
Expected: PASS.

- [ ] **Step 6: Format, run the root checks and commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
pnpm exec prettier --write apps/web/scripts/verify-load.ts apps/web/package.json
pnpm typecheck && pnpm lint && pnpm test
git add apps/web/scripts/verify-load.ts apps/web/package.json
git commit -m "$(cat <<'EOF'
Add verify:load, which runs k6's local profile against the freshness server in process on Anvil with a phase starting mid-run and judges k6's summary against /health's own counts

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: web 1021 tests in 107 files, unchanged; the other packages unchanged.

---

### Task 4: `check:edge`

**Kind:** transcription. The plan carries every line: a Sonnet implementer.

**Files:**

- Create: `apps/web/src/lib/edge/edge-checks.ts`, `apps/web/src/lib/edge/edge-checks.test.ts`, `apps/web/scripts/check-edge.ts`
- Modify: `apps/web/package.json` (`check:edge`)
- Test: `pnpm --filter @cobweb/web exec vitest run src/lib/edge/edge-checks.test.ts`; the usage refusals and the smoke run

**Interfaces:**

- Consumes: `STATE_CACHE` and `WALLET_CACHE` from `@cobweb/freshness/server` (Task 1); the page policy as the proxy writes it (`content-security-policy` in enforce mode, `content-security-policy-report-only` alone in report-only mode, with `report-to csp` and `Reporting-Endpoints: csp="<origin>/api/csp-report"` on https) and `next.config.ts`'s `X-Frame-Options`, `X-Content-Type-Options` and `Referrer-Policy`, as the production hardening sub-project left them.
- Produces:
  - `edge-checks.ts`: `type EdgeAnswer = { status: number; headers: Headers; body: string }`; `type EdgeArgs = { app: URL; freshness: URL; chainId: number; address: Address; slug: string | null }`; `INJECTED_MARKS`; `EDGE_CHECKS`, 13 of `{ subject, held, hint }` in section 8.2's order and words; the readers `edgeArgsOf`, `viaCloudflare`, `cacheStatusOf`, `ageOf`, `isWeakEtag`, `scriptNonces`, `pagePolicyOf`, `nonceOf`, `directiveOf` and `injectedIn`; the judges, each answering null or the problem: `judgeSetup(home, health, state)`, `judgeHealth(reads)`, `judgeStateAtEdge(first, second, stateCache)`, `judgeOneSecond(polls)`, `judgeNotModified(answer, etag)`, `judgeFirstPoll(answer)`, `judgeQuery(answer)`, `judgeWallet(first, second, later, walletCache)`, `judgeCors(preflight, state)`, `judgePages(home, mint)`, `judgePolicy(page, args)`, `judgeInjected(pages, answers)` and `judgeTransport(redirect, home, app)` (Decisions 12 and 13)
  - `pnpm --filter @cobweb/web check:edge --app <url> --freshness <url> --collection <chain id>/<address> [--slug <link>]`: 13 PASS or FAIL lines, then the totals; exit code 0 when all pass, 1 on any failure, 2 with section 10's usage line

- [ ] **Step 1: Write the failing tests**

The arguments; the readers on Cloudflare-shaped answers (spec section 11); and every judge on answers as Cloudflare passes them, each with the misconfiguration its hint names (Review Focus 2, 3 and 4).

Create `apps/web/src/lib/edge/edge-checks.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  ageOf,
  cacheStatusOf,
  directiveOf,
  EDGE_CHECKS,
  edgeArgsOf,
  injectedIn,
  isWeakEtag,
  judgeCors,
  judgeFirstPoll,
  judgeHealth,
  judgeInjected,
  judgeNotModified,
  judgeOneSecond,
  judgePages,
  judgePolicy,
  judgeQuery,
  judgeSetup,
  judgeStateAtEdge,
  judgeTransport,
  judgeWallet,
  nonceOf,
  pagePolicyOf,
  scriptNonces,
  viaCloudflare,
  type EdgeAnswer,
} from './edge-checks'

const APP = 'https://cobweb.example'
const FRESHNESS = 'https://fresh.cobweb.example'
const ADDRESS = '0x5FbDB2315678afecb367f032d93F642f64180aa3'
const STATE_CACHE = 'public, max-age=0, s-maxage=1, stale-while-revalidate=1, stale-if-error=60'
const WALLET_CACHE = 'public, max-age=0, s-maxage=5'
const ETAG = 'W/"5d41402abc4b2a76b9719d911017c592"'
const RAY = '8f1a2b3c4d5e6f70-SIN'
const NONCE = 'q2Vx3f8NoHn2pQb1sZ4tWw=='
const OTHER_NONCE = 'Hk9rT1mZ0aQ7yLc5vB3nXg=='

function answer(status: number, headers: Record<string, string> = {}, body = ''): EdgeAnswer {
  return { status, headers: new Headers(headers), body }
}

/** A state answer from the edge, as Cloudflare passes the origin's headers on. */
function state(cache: string | null, age?: number, extra: Record<string, string> = {}): EdgeAnswer {
  return answer(
    200,
    {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': STATE_CACHE,
      etag: ETAG,
      'access-control-allow-origin': '*',
      'access-control-expose-headers': 'ETag, Retry-After, Age',
      'cf-ray': RAY,
      ...(cache === null ? {} : { 'cf-cache-status': cache }),
      ...(age === undefined ? {} : { age: String(age) }),
      ...extra,
    },
    '{"chainId":11155111}',
  )
}

/** The app's page policy, as the proxy writes it on https. */
function policy(nonce: string, freshness = FRESHNESS): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://challenges.cloudflare.com`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    `connect-src 'self' https://umwkpwtkwmdizgndxnjc.supabase.co ${freshness} https://rpc.walletconnect.org`,
    "frame-ancestors 'none'",
    'report-uri /api/csp-report',
    'report-to csp',
  ].join('; ')
}

/** A page's HTML as Next writes it: nonced scripts, a module and a JSON script. */
function html(nonce: string, extra = ''): string {
  return [
    '<!DOCTYPE html><html><head>',
    `<script src="/_next/static/chunks/webpack.js" async="" nonce="${nonce}"></script>`,
    '<script type="application/json" id="__cobweb">{"chains":[1]}</script>',
    '</head><body>',
    `<script nonce="${nonce}">self.__next_f.push([1,""])</script>`,
    `<script type="module" nonce="${nonce}" src="/_next/static/chunks/main.js"></script>`,
    extra,
    '</body></html>',
  ].join('')
}

/** A page from the app through the edge, in enforce mode unless the headers say otherwise; null drops a header. */
function page(nonce: string, headers: Record<string, string | null> = {}, body = html(nonce)): EdgeAnswer {
  const merged: Record<string, string | null> = {
    'content-type': 'text/html; charset=utf-8',
    'cf-cache-status': 'DYNAMIC',
    'cf-ray': RAY,
    'content-security-policy': policy(nonce),
    'reporting-endpoints': `csp="${APP}/api/csp-report"`,
    'x-frame-options': 'DENY',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'strict-transport-security': 'max-age=63072000',
    ...headers,
  }
  const kept = Object.entries(merged).filter((entry): entry is [string, string] => entry[1] !== null)
  return answer(200, Object.fromEntries(kept), body)
}

const ROCKET_LOADED = [
  `<script type="a1b2c3d4e5f6a7b8c9d0e1f2-text/javascript" nonce="${NONCE}" src="/_next/static/chunks/main.js"></script>`,
  '<script src="/cdn-cgi/scripts/7d0fa10a/cloudflare-static/rocket-loader.min.js" data-cf-settings="a1b2c3d4e5f6a7b8c9d0e1f2-|49" defer></script>',
].join('')
const EMAIL_OBFUSCATED = [
  '<a href="/cdn-cgi/l/email-protection" class="__cf_email__" data-cfemail="1c7479707073">[email&#160;protected]</a>',
  '<script data-cfasync="false" src="/cdn-cgi/scripts/5c5dd728/cloudflare-static/email-decode.min.js"></script>',
].join('')
const BEACON =
  '<script defer src=\'https://static.cloudflareinsights.com/beacon.min.js\' data-cf-beacon=\'{"token": "0a1b2c"}\'></script>'

describe('edgeArgsOf (docs/specs/2026-10-18-load-run-contract-review-and-cloudflare.md, section 8.1)', () => {
  const ARGS = ['--app', APP, '--freshness', FRESHNESS, '--collection', `11155111/${ADDRESS}`]

  it("reads the four arguments, the slug optional, keeping the URLs' origins and the address in lower case", () => {
    const read = edgeArgsOf([...ARGS, '--slug', 'night-owls'])
    expect(read?.app.href).toBe(`${APP}/`)
    expect(read?.freshness.href).toBe(`${FRESHNESS}/`)
    expect(read).toMatchObject({ chainId: 11155111, address: ADDRESS.toLowerCase(), slug: 'night-owls' })
    expect(edgeArgsOf(ARGS)?.slug).toBeNull()
    expect(edgeArgsOf(['--app', `${APP}/mint`, ...ARGS.slice(2)])?.app.href).toBe(`${APP}/`)
  })

  it('answers null for a missing argument, an http URL, a malformed collection or slug, or an unknown or repeated flag', () => {
    const unusable: string[][] = [
      [],
      ARGS.slice(2),
      ARGS.slice(0, 4),
      [...ARGS.slice(0, 5)],
      ['--app', 'http://cobweb.example', ...ARGS.slice(2)],
      ['--app', APP, '--freshness', 'http://fresh.cobweb.example', ...ARGS.slice(4)],
      [...ARGS.slice(0, 5), `11155111/${ADDRESS.slice(0, 20)}`],
      [...ARGS.slice(0, 5), ADDRESS],
      [...ARGS, '--slug', 'Night Owls'],
      [...ARGS, '--wallet', ADDRESS],
      [...ARGS, '--app', APP],
    ]
    for (const argv of unusable) expect(edgeArgsOf(argv), argv.join(' ')).toBeNull()
  })
})

describe('the readers (section 8.1)', () => {
  it("reads cf-ray, cf-cache-status and Age on a Cloudflare answer, and none of them on Vercel's own", () => {
    const hit = state('hit', 1)
    expect([viaCloudflare(hit), cacheStatusOf(hit), ageOf(hit)]).toEqual([true, 'HIT', 1])
    const vercel = answer(200, { 'x-vercel-cache': 'MISS', 'x-vercel-id': 'sin1::abc', age: 'soon' })
    expect([viaCloudflare(vercel), cacheStatusOf(vercel), ageOf(vercel)]).toEqual([false, null, null])
  })

  it('tells a weak ETag from a strong one', () => {
    expect([isWeakEtag(ETAG), isWeakEtag('"5d41"'), isWeakEtag('W/5d41'), isWeakEtag(null)]).toEqual([
      true,
      false,
      false,
      false,
    ])
  })

  it("reads each JavaScript script's nonce, a module's among them, leaving a JSON script out", () => {
    expect(scriptNonces(html(NONCE))).toEqual([NONCE, NONCE, NONCE])
  })

  it('reads a Rocket Loader rewrite as a script that keeps its nonce and a loader that has none', () => {
    expect(scriptNonces(ROCKET_LOADED)).toEqual([NONCE, null])
  })

  it('takes the enforced policy, else the report-only one, and null with neither or with the framing policy alone', () => {
    expect(pagePolicyOf(new Headers({ 'content-security-policy': policy(NONCE) }))).toEqual({
      mode: 'enforce',
      policy: policy(NONCE),
    })
    expect(pagePolicyOf(new Headers({ 'content-security-policy-report-only': policy(NONCE) }))).toEqual({
      mode: 'report-only',
      policy: policy(NONCE),
    })
    expect(pagePolicyOf(new Headers())).toBeNull()
    expect(pagePolicyOf(new Headers({ 'content-security-policy': "frame-ancestors 'none'" }))).toBeNull()
  })

  it('reads a directive and the nonce of script-src', () => {
    expect(nonceOf(policy(NONCE))).toBe(NONCE)
    expect(nonceOf("script-src 'self' 'strict-dynamic'")).toBeNull()
    expect(directiveOf(policy(NONCE), 'Connect-Src')).toEqual([
      "'self'",
      'https://umwkpwtkwmdizgndxnjc.supabase.co',
      FRESHNESS,
      'https://rpc.walletconnect.org',
    ])
    expect(directiveOf(policy(NONCE), 'img-src')).toEqual([])
  })

  it('finds each injected mark in its usual shape, and none on a clean page', () => {
    expect(injectedIn(html(NONCE, ROCKET_LOADED))).toEqual(['rocket-loader', '/cdn-cgi/'])
    expect(injectedIn(html(NONCE, EMAIL_OBFUSCATED))).toEqual(['email-decode', '/cdn-cgi/'])
    expect(injectedIn(html(NONCE, BEACON))).toEqual(['beacon.min.js', 'cloudflareinsights.com'])
    expect(injectedIn(html(NONCE))).toEqual([])
  })
})

describe('the judges (section 8.2)', () => {
  const health = (body: object, headers: Record<string, string> = {}) =>
    answer(
      200,
      { 'cf-ray': RAY, 'cache-control': 'no-store', 'cf-cache-status': 'DYNAMIC', ...headers },
      JSON.stringify(body),
    )

  it('names the 13 checks in order', () => {
    expect(EDGE_CHECKS.map((entry) => entry.subject)).toEqual([
      'setup',
      'health',
      'state at the edge',
      'a 1 s edge',
      '304 at the edge',
      'first poll',
      'query ignored',
      'wallet',
      'CORS',
      'pages',
      'policy intact',
      'nothing injected',
      'transport',
    ])
  })

  it('check 1: both domains through Cloudflare, /health ok and the state 200', () => {
    expect(judgeSetup(page(NONCE), health({ status: 'ok' }), state('MISS'))).toBeNull()
    const vercel = answer(200, { 'content-type': 'text/html' })
    expect(judgeSetup(vercel, vercel, vercel)).toBe(
      'the app domain and the freshness domain answered with no cf-ray header',
    )
    expect(judgeSetup(page(NONCE), health({ status: 'degraded' }), state('MISS'))).toBe(
      '/health answered 200 {"status":"degraded"}',
    )
    expect(
      judgeSetup(
        page(NONCE),
        health({ status: 'ok' }),
        answer(404, { 'cf-ray': RAY }, '{"error":"not-a-collection"}'),
      ),
    ).toBe('the state answered 404 {"error":"not-a-collection"}')
  })

  it('check 2: /health no-store and never cached at the edge', () => {
    const bypass = health({ status: 'ok' }, { 'cf-cache-status': 'BYPASS' })
    expect(judgeHealth([health({ status: 'ok' }), bypass])).toBeNull()
    expect(judgeHealth([bypass, health({ status: 'ok' }, { 'cf-cache-status': 'HIT', age: '3' })])).toBe(
      'read 2 answered 200 with Cache-Control no-store and HIT',
    )
  })

  it("check 3: the origin's Cache-Control and weak ETag kept, the second poll a HIT with Age 0 or 1", () => {
    expect(judgeStateAtEdge(state('MISS'), state('HIT', 0), STATE_CACHE)).toBeNull()
    expect(judgeStateAtEdge(state('EXPIRED'), state('HIT'), STATE_CACHE)).toBeNull()
    expect(judgeStateAtEdge(state('MISS'), state('EXPIRED', 0), STATE_CACHE)).toBe(
      'the second poll was EXPIRED with Age 0',
    )
    const browserTtl = state('HIT', 0, { 'cache-control': 'public, max-age=14400' })
    expect(judgeStateAtEdge(state('MISS'), browserTtl, STATE_CACHE)).toBe(
      `poll 2 carried Cache-Control public, max-age=14400, not ${STATE_CACHE}`,
    )
    expect(judgeStateAtEdge(state('MISS', 0, { etag: '"5d41"' }), state('HIT', 0), STATE_CACHE)).toBe(
      'poll 1 carried ETag "5d41"',
    )
  })

  it('check 4: an edge that holds the state past its second, or never goes back to the origin, fails (Review Focus 3)', () => {
    const second = ['HIT', 'HIT', 'HIT', 'HIT', 'UPDATING', 'HIT', 'HIT', 'HIT', 'REVALIDATED', 'HIT']
    const polls = [...second, ...second].map((cache, index) => state(cache, cache === 'HIT' ? index % 2 : 0))
    expect(judgeOneSecond(polls)).toBeNull()
    const held = Array.from({ length: 20 }, (_, index) => state('HIT', Math.floor(index / 4)))
    expect(judgeOneSecond(held)).toBe('a poll showed Age 4')
    const neverBack = Array.from({ length: 20 }, (_, index) => state('HIT', index % 2))
    expect(judgeOneSecond(neverBack)).toBe('0 of the 20 polls answered other than HIT')
    expect(judgeOneSecond([state('HIT', 0), answer(503, { 'cf-ray': RAY })])).toBe('poll 2 answered 503')
  })

  it('check 5: a 304 with the ETag it was asked with, from the edge or revalidated', () => {
    const notModified = (cache: string, etag = ETAG) =>
      answer(304, { etag, 'cache-control': STATE_CACHE, 'cf-cache-status': cache, 'cf-ray': RAY })
    expect(judgeNotModified(notModified('HIT'), ETAG)).toBeNull()
    expect(judgeNotModified(notModified('REVALIDATED'), ETAG)).toBeNull()
    expect(judgeNotModified(state('HIT'), ETAG)).toBe(`the poll carrying ${ETAG} answered 200`)
    expect(judgeNotModified(notModified('HIT', 'W/"0"'), ETAG)).toBe(
      `the 304 carried ETag W/"0", not ${ETAG}`,
    )
    expect(judgeNotModified(notModified('MISS'), ETAG)).toBe('the 304 was MISS')
  })

  it("check 6: an edge that lets a page's reload poll through to the origin fails (Review Focus 2)", () => {
    expect(judgeFirstPoll(state('HIT', 0))).toBeNull()
    for (const cache of ['MISS', 'EXPIRED', 'REVALIDATED', 'BYPASS', 'DYNAMIC'])
      expect(judgeFirstPoll(state(cache, 0))).toBe(`the reload poll answered 200, ${cache}`)
    expect(judgeFirstPoll(state(null))).toBe('the reload poll answered 200, no cf-cache-status')
  })

  it('check 7: a random query right after a cached poll is a HIT', () => {
    expect(judgeQuery(state('HIT', 0))).toBeNull()
    expect(judgeQuery(state('MISS'))).toBe('the poll with a random query answered 200, MISS')
  })

  it('check 8: the wallet held 5 s at the edge and no longer', () => {
    const read = (cache: string, age?: number, extra: Record<string, string> = {}) =>
      answer(200, {
        'cache-control': WALLET_CACHE,
        'cf-cache-status': cache,
        'cf-ray': RAY,
        ...(age === undefined ? {} : { age: String(age) }),
        ...extra,
      })
    expect(judgeWallet(read('MISS'), read('HIT', 0), read('EXPIRED'), WALLET_CACHE)).toBeNull()
    expect(judgeWallet(read('MISS'), read('MISS'), read('MISS'), WALLET_CACHE)).toBe(
      'the second read was MISS with Age 0',
    )
    expect(judgeWallet(read('MISS'), read('HIT', 0), read('HIT', 6), WALLET_CACHE)).toBe(
      'the read 6 s after the first was a HIT with Age 6',
    )
    expect(
      judgeWallet(
        read('MISS', 0, { 'cache-control': 'public, max-age=14400' }),
        read('HIT'),
        read('MISS'),
        WALLET_CACHE,
      ),
    ).toBe(`read 1 carried Cache-Control public, max-age=14400, not ${WALLET_CACHE}`)
  })

  it("check 9: the preflight allows the page's headers for a day, and the state exposes ETag, Retry-After and Age", () => {
    const preflight = (allowed: string) =>
      answer(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, HEAD',
        'access-control-allow-headers': allowed,
        'access-control-max-age': '86400',
        'cf-ray': RAY,
      })
    expect(judgeCors(preflight('If-None-Match, Cache-Control, Pragma'), state('HIT'))).toBeNull()
    expect(judgeCors(preflight('If-None-Match'), state('HIT'))).toBe(
      'the preflight does not allow cache-control, pragma',
    )
    expect(
      judgeCors(
        preflight('If-None-Match, Cache-Control, Pragma'),
        state('HIT', 0, { 'access-control-expose-headers': 'ETag' }),
      ),
    ).toBe('the state answer does not expose retry-after, age')
  })

  it('check 10: every page dynamic at the edge, each load of / with its own nonce', () => {
    expect(judgePages([page(NONCE), page(OTHER_NONCE)], page(NONCE))).toBeNull()
    expect(judgePages([page(NONCE), page(NONCE)], null)).toBe('two loads of / carried the same nonce')
    expect(judgePages([page(NONCE), page(OTHER_NONCE, { 'cf-cache-status': 'HIT' })], null)).toBe(
      '/ again answered 200 text/html; charset=utf-8, HIT',
    )
    expect(
      judgePages(
        [page(NONCE), page(OTHER_NONCE)],
        answer(404, { 'content-type': 'text/html', 'cf-cache-status': 'DYNAMIC' }),
      ),
    ).toBe('the mint page answered 404 text/html, DYNAMIC')
  })

  it('check 11: a build whose policy still names an earlier freshness origin fails, as does any script without the nonce (Review Focus 4)', () => {
    const args = { app: new URL(APP), freshness: new URL(FRESHNESS) }
    expect(judgePolicy(page(NONCE), args)).toBeNull()
    const reportOnly = page(NONCE, {
      'content-security-policy': null,
      'content-security-policy-report-only': policy(NONCE),
    })
    expect(judgePolicy(reportOnly, args)).toBeNull()
    const earlier = page(NONCE, {
      'content-security-policy': policy(NONCE, 'https://freshness-production.up.railway.app'),
    })
    expect(judgePolicy(earlier, args)).toBe(`connect-src does not list ${FRESHNESS}`)
    expect(judgePolicy(page(NONCE, {}, html(NONCE, ROCKET_LOADED)), args)).toBe(
      "1 of the 5 scripts lack the response's nonce",
    )
    expect(judgePolicy(page(NONCE, { 'x-frame-options': null }), args)).toBe(
      'x-frame-options arrived as null',
    )
    expect(judgePolicy(page(NONCE, { 'content-security-policy': "frame-ancestors 'none'" }), args)).toBe(
      'the page carries no policy naming script-src',
    )
    expect(
      judgePolicy(
        page(NONCE, { 'reporting-endpoints': 'csp="https://cobweb-cobweb3.vercel.app/api/csp-report"' }),
        args,
      ),
    ).toBe(`Reporting-Endpoints does not name ${APP}/api/csp-report`)
  })

  it('check 12: no injected script in any page and no Speculation-Rules on any answer', () => {
    expect(judgeInjected([page(NONCE)], [page(NONCE), state('HIT')])).toBeNull()
    expect(judgeInjected([page(NONCE, {}, html(NONCE, EMAIL_OBFUSCATED))], [])).toBe(
      'a page holds email-decode, /cdn-cgi/',
    )
    const speedBrain = page(NONCE, { 'speculation-rules': '"/cdn-cgi/speculation"' })
    expect(judgeInjected([page(NONCE)], [speedBrain])).toBe('an answer carries Speculation-Rules')
  })

  it('check 13: http:// redirected to the same host on https://, and HSTS on /', () => {
    const app = new URL(APP)
    const redirect = (status: number, location?: string) =>
      answer(status, { 'cf-ray': RAY, ...(location ? { location } : {}) })
    expect(judgeTransport(redirect(301, `${APP}/`), page(NONCE), app)).toBeNull()
    expect(judgeTransport(redirect(308, APP), page(NONCE), app)).toBeNull()
    expect(judgeTransport(redirect(200), page(NONCE), app)).toBe('http:// answered 200 to no Location')
    expect(judgeTransport(redirect(301, 'https://cobweb-cobweb3.vercel.app/'), page(NONCE), app)).toBe(
      'http:// answered 301 to https://cobweb-cobweb3.vercel.app/',
    )
    expect(
      judgeTransport(redirect(301, `${APP}/`), page(NONCE, { 'strict-transport-security': null }), app),
    ).toBe('/ carries no Strict-Transport-Security')
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @cobweb/web exec vitest run src/lib/edge/edge-checks.test.ts`
Expected: FAIL: `Cannot find module './edge-checks'` and `Test Files  1 failed (1)`.

- [ ] **Step 3: The readers and the judges**

Create `apps/web/src/lib/edge/edge-checks.ts`:

```ts
import type { Address } from 'viem'

/**
 * Cloudflare in front, read from outside (docs/specs/2026-10-18-load-run-contract-review-and-cloudflare.md,
 * section 8), pure: the arguments, the readers of an answer and each check's judgement of the answers
 * `scripts/check-edge.ts` fetched. They are unit-tested on answers shaped as Cloudflare's, since no run can reach a
 * zone before the owner makes one. A judgement answers null when its check held, else the problem.
 */

export type EdgeAnswer = { status: number; headers: Headers; body: string }
export type EdgeArgs = { app: URL; freshness: URL; chainId: number; address: Address; slug: string | null }

/**
 * What Cloudflare's features put into a page: Rocket Loader, Email Address Obfuscation's decoder, Web Analytics'
 * beacon and its host, and any path under /cdn-cgi/.
 */
export const INJECTED_MARKS: readonly string[] = [
  'rocket-loader',
  'email-decode',
  'beacon.min.js',
  'cloudflareinsights.com',
  '/cdn-cgi/',
]

/** The 13 checks in order (section 8.2): each one's subject, what holds when it passes and where to look when not. */
export const EDGE_CHECKS: readonly { subject: string; held: string; hint: string }[] = [
  {
    subject: 'setup',
    held: "the app domain and the freshness domain both answer through Cloudflare (a cf-ray header on each), /health reads ok, and the collection's state answers 200",
    hint: "the two DNS records are Proxied, and the URLs given are the custom domains, not Vercel's or Railway's own.",
  },
  {
    subject: 'health',
    held: '/health answers 200 with Cache-Control no-store and cf-cache-status DYNAMIC or BYPASS on two reads in a row',
    hint: 'the Cache Rule that bypasses /health.',
  },
  {
    subject: 'state at the edge',
    held: "two state polls in a row answer 200 with the origin's Cache-Control unchanged and a weak ETag, the second a HIT with Age 0 or 1",
    hint: "the Cache Rule for /v1/ (eligible, Edge TTL from the origin's Cache-Control, Browser TTL from the origin) and the zone's Browser Cache TTL.",
  },
  {
    subject: 'a 1 s edge',
    held: 'polls every 250 ms for 5 s never show an Age above 2, and at least two answer other than HIT, the edge going back to the origin',
    hint: "the /v1/ rule's Edge TTL, which must follow the origin's Cache-Control rather than set its own.",
  },
  {
    subject: '304 at the edge',
    held: 'a poll carrying the last ETag answers 304 with that ETag, HIT or REVALIDATED',
    hint: 'Respect Strong ETags (off) and the /v1/ rule.',
  },
  {
    subject: 'first poll',
    held: "a poll with the page's reload headers, Cache-Control no-cache and Pragma no-cache, is answered from the edge's copy (a HIT)",
    hint: "nothing in the zone; the edge passed the browser's directives to the origin, a defect for the controller (decision 21).",
  },
  {
    subject: 'query ignored',
    held: 'a poll with a random query string, right after a cached one, is a HIT',
    hint: "the /v1/ rule's cache key (Ignore query string), or the zone's Caching Level (Ignore Query String).",
  },
  {
    subject: 'wallet',
    held: 'two reads of a fresh wallet in a row answer 200 with Cache-Control public, max-age=0, s-maxage=5, the second a HIT with Age at most 5, and a read 6 s after the first is not a HIT',
    hint: 'the /v1/ rule, as for check 3.',
  },
  {
    subject: 'CORS',
    held: "a preflight from the app's origin for If-None-Match, Cache-Control and Pragma answers 204 allowing them with Access-Control-Max-Age 86400, and a state answer from the edge carries Access-Control-Allow-Origin * and exposes ETag, Retry-After and Age",
    hint: "a Transform Rule or a Managed Transform touching the freshness domain's headers.",
  },
  {
    subject: 'pages',
    held: '/ and the mint page given answer 200 HTML with cf-cache-status DYNAMIC, and two loads of / carry different nonces',
    hint: "a rule caching the app domain's pages (Cache Everything, or a Cache Rule making them eligible), which must not exist.",
  },
  {
    subject: 'policy intact',
    held: "the page policy, enforced or report-only, has 'strict-dynamic' and the nonce every script carries, its connect-src lists the freshness origin, Reporting-Endpoints names the app's /api/csp-report, and X-Frame-Options DENY, X-Content-Type-Options nosniff and Referrer-Policy strict-origin-when-cross-origin arrive",
    hint: 'Managed Transforms (off), CSP_MODE on Vercel (not off), and a redeploy after NEXT_PUBLIC_FRESHNESS_URL moved.',
  },
  {
    subject: 'nothing injected',
    held: 'no page read holds a Cloudflare script (rocket-loader, email-decode, beacon.min.js, cloudflareinsights.com or a /cdn-cgi/ path) and no answer carries a Speculation-Rules header',
    hint: 'the feature named, in the list that stays off.',
  },
  {
    subject: 'transport',
    held: 'http:// on the app domain answers a redirect to its https:// address, and / carries Strict-Transport-Security',
    hint: "Always Use HTTPS, and HSTS (Vercel's header, or Cloudflare's if Vercel sends none).",
  },
]

const FLAGS = ['--app', '--freshness', '--collection', '--slug'] as const
const COLLECTION = /^([1-9][0-9]{0,15})\/(0x[0-9a-fA-F]{40})$/
/** A mint page's link, as `src/lib/collections.ts` and the database's check write it. */
const SLUG = /^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/

/** An https URL's origin, or null for anything else. */
function httpsOf(value: string | undefined): URL | null {
  try {
    const url = new URL(value ?? '')
    return url.protocol === 'https:' ? new URL(url.origin) : null
  } catch {
    return null
  }
}

/**
 * `--app`, `--freshness`, `--collection` and the optional `--slug`, each given once with its value; null without a
 * usable set: both URLs https (their origins are kept), the collection `<chain id>/<address>`, the slug a mint
 * page's link.
 */
export function edgeArgsOf(argv: readonly string[]): EdgeArgs | null {
  const values = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index] ?? ''
    const value = argv[index + 1]
    if (!(FLAGS as readonly string[]).includes(name) || value === undefined || values.has(name)) return null
    values.set(name, value)
  }
  const app = httpsOf(values.get('--app'))
  const freshness = httpsOf(values.get('--freshness'))
  const collection = COLLECTION.exec(values.get('--collection') ?? '')
  const slug = values.get('--slug') ?? null
  if (!app || !freshness || !collection || (slug !== null && !SLUG.test(slug))) return null
  return {
    app,
    freshness,
    chainId: Number(collection[1]),
    address: collection[2]!.toLowerCase() as Address,
    slug,
  }
}

/** Whether the answer came through Cloudflare: it carries a cf-ray header. */
export function viaCloudflare(answer: EdgeAnswer): boolean {
  return answer.headers.has('cf-ray')
}

/** The answer's cf-cache-status in upper case, or null without one. */
export function cacheStatusOf(answer: EdgeAnswer): string | null {
  return answer.headers.get('cf-cache-status')?.trim().toUpperCase() ?? null
}

/** The answer's Age in seconds, or null without a whole number there. */
export function ageOf(answer: EdgeAnswer): number | null {
  const age = answer.headers.get('age')?.trim()
  return age && /^[0-9]+$/.test(age) ? Number(age) : null
}

/** Whether an ETag is weak: `W/"..."`. */
export function isWeakEtag(value: string | null): boolean {
  return value !== null && /^W\/"[^"]*"$/.test(value)
}

/** An attribute of a tag's attribute text, double-quoted, single-quoted or bare; null without it. */
function attributeOf(attributes: string, name: string): string | null {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(
    attributes,
  )
  return match ? (match[1] ?? match[2] ?? match[3] ?? '') : null
}

/**
 * The nonce of each script of a JavaScript type in the HTML, in order, null where a script has none: no type, a
 * module or a type naming JavaScript (Rocket Loader's rewritten `<hash>-text/javascript` included); a JSON or other
 * data script is left out.
 */
export function scriptNonces(html: string): (string | null)[] {
  return [...html.matchAll(/<script\b([^>]*)>/gi)].flatMap((match) => {
    const attributes = match[1] ?? ''
    const type = attributeOf(attributes, 'type')?.trim().toLowerCase()
    if (type && type !== 'module' && !type.includes('javascript')) return []
    return [attributeOf(attributes, 'nonce')]
  })
}

/** A policy's directives by name, in lower case. */
function directivesOf(policy: string): Map<string, string[]> {
  const directives = new Map<string, string[]>()
  for (const entry of policy.split(';')) {
    const [name, ...sources] = entry.trim().split(/\s+/)
    if (name && !directives.has(name.toLowerCase())) directives.set(name.toLowerCase(), sources)
  }
  return directives
}

/** A directive's sources, in order; empty when the policy does not name it. */
export function directiveOf(policy: string, name: string): string[] {
  return directivesOf(policy).get(name.toLowerCase()) ?? []
}

/** The nonce of the policy's script-src, or null. */
export function nonceOf(policy: string): string | null {
  const source = directiveOf(policy, 'script-src').find((value) => /^'nonce-[^']+'$/.test(value))
  return source ? source.slice("'nonce-".length, -1) : null
}

/**
 * The page's policy: the enforced one when it names script-src (off, the enforced header is the framing policy
 * alone), else the report-only one, which the report week sends with no enforced policy beside it; null with neither.
 */
export function pagePolicyOf(headers: Headers): { mode: 'enforce' | 'report-only'; policy: string } | null {
  const enforced = headers.get('content-security-policy')
  if (enforced && directiveOf(enforced, 'script-src').length) return { mode: 'enforce', policy: enforced }
  const reported = headers.get('content-security-policy-report-only')
  return reported ? { mode: 'report-only', policy: reported } : null
}

/** The marks of Cloudflare's injections found in the HTML, in the order of `INJECTED_MARKS`. */
export function injectedIn(html: string): string[] {
  return INJECTED_MARKS.filter((mark) => html.includes(mark))
}

/** A cf-cache-status for a problem line. */
const statusText = (answer: EdgeAnswer) => cacheStatusOf(answer) ?? 'no cf-cache-status'

/** Whether /health answered 200 with `"status":"ok"`. */
function healthOk(answer: EdgeAnswer): boolean {
  try {
    return answer.status === 200 && (JSON.parse(answer.body) as { status?: unknown }).status === 'ok'
  } catch {
    return false
  }
}

/** Check 1: `/` and /health through Cloudflare, /health ok, the collection's state 200. */
export function judgeSetup(home: EdgeAnswer, health: EdgeAnswer, state: EdgeAnswer): string | null {
  const direct = [
    ['the app domain', home],
    ['the freshness domain', health],
  ].flatMap(([name, answer]) => (viaCloudflare(answer as EdgeAnswer) ? [] : [name as string]))
  if (direct.length) return `${direct.join(' and ')} answered with no cf-ray header`
  if (!healthOk(health)) return `/health answered ${health.status} ${health.body.slice(0, 120)}`
  return state.status === 200 ? null : `the state answered ${state.status} ${state.body.slice(0, 120)}`
}

/** Check 2: each /health read 200, no-store, DYNAMIC or BYPASS. */
export function judgeHealth(reads: readonly EdgeAnswer[]): string | null {
  for (const [index, read] of reads.entries()) {
    const cache = read.headers.get('cache-control')
    const status = cacheStatusOf(read)
    if (read.status !== 200 || cache !== 'no-store' || (status !== 'DYNAMIC' && status !== 'BYPASS'))
      return `read ${index + 1} answered ${read.status} with Cache-Control ${cache} and ${statusText(read)}`
  }
  return null
}

/** Check 3: both polls 200 with the origin's Cache-Control and a weak ETag; the second a HIT with Age 0 or 1. */
export function judgeStateAtEdge(first: EdgeAnswer, second: EdgeAnswer, stateCache: string): string | null {
  for (const [index, poll] of [first, second].entries()) {
    if (poll.status !== 200) return `poll ${index + 1} answered ${poll.status}`
    const cache = poll.headers.get('cache-control')
    if (cache !== stateCache) return `poll ${index + 1} carried Cache-Control ${cache}, not ${stateCache}`
    if (!isWeakEtag(poll.headers.get('etag')))
      return `poll ${index + 1} carried ETag ${poll.headers.get('etag')}`
  }
  const age = ageOf(second) ?? 0
  return cacheStatusOf(second) === 'HIT' && age <= 1
    ? null
    : `the second poll was ${statusText(second)} with Age ${age}`
}

/**
 * Check 4: no poll shows an Age above 2 and at least two answer other than HIT, so the edge holds the state for its
 * second and goes back to the origin after it (Review Focus 3).
 */
export function judgeOneSecond(polls: readonly EdgeAnswer[]): string | null {
  const refused = polls.findIndex((poll) => poll.status !== 200)
  if (refused >= 0) return `poll ${refused + 1} answered ${polls[refused]!.status}`
  const oldest = Math.max(0, ...polls.map((poll) => ageOf(poll) ?? 0))
  if (oldest > 2) return `a poll showed Age ${oldest}`
  const back = polls.filter((poll) => cacheStatusOf(poll) !== 'HIT').length
  return back >= 2 ? null : `${back} of the ${polls.length} polls answered other than HIT`
}

/** Check 5: the conditional poll answers 304 with the ETag it carried, from the edge's copy or revalidated. */
export function judgeNotModified(answer: EdgeAnswer, etag: string): string | null {
  if (answer.status !== 304) return `the poll carrying ${etag} answered ${answer.status}`
  const returned = answer.headers.get('etag')
  if (returned !== etag) return `the 304 carried ETag ${returned}, not ${etag}`
  const status = cacheStatusOf(answer)
  return status === 'HIT' || status === 'REVALIDATED' ? null : `the 304 was ${statusText(answer)}`
}

/** Checks 6 and 7: the poll was answered 200 from the edge's copy. */
function judgeHit(answer: EdgeAnswer, poll: string): string | null {
  return answer.status === 200 && cacheStatusOf(answer) === 'HIT'
    ? null
    : `the ${poll} answered ${answer.status}, ${statusText(answer)}`
}

/**
 * Check 6: a poll carrying the page's reload headers is a HIT, so the edge never lets a browser's request directives
 * send its first poll to the origin (Review Focus 2).
 */
export function judgeFirstPoll(answer: EdgeAnswer): string | null {
  return judgeHit(answer, 'reload poll')
}

/** Check 7: a poll with a random query string, right after a cached one, is a HIT. */
export function judgeQuery(answer: EdgeAnswer): string | null {
  return judgeHit(answer, 'poll with a random query')
}

/** Check 8: two reads 200 with the wallet's Cache-Control, the second a HIT with Age at most 5; one 6 s on not a HIT. */
export function judgeWallet(
  first: EdgeAnswer,
  second: EdgeAnswer,
  later: EdgeAnswer,
  walletCache: string,
): string | null {
  for (const [index, read] of [first, second].entries()) {
    if (read.status !== 200) return `read ${index + 1} answered ${read.status}`
    const cache = read.headers.get('cache-control')
    if (cache !== walletCache) return `read ${index + 1} carried Cache-Control ${cache}, not ${walletCache}`
  }
  const age = ageOf(second) ?? 0
  if (cacheStatusOf(second) !== 'HIT' || age > 5)
    return `the second read was ${statusText(second)} with Age ${age}`
  return cacheStatusOf(later) === 'HIT'
    ? `the read 6 s after the first was a HIT with Age ${ageOf(later)}`
    : null
}

/** A comma-separated header's values in lower case. */
const listOf = (value: string | null) => (value ?? '').split(',').map((entry) => entry.trim().toLowerCase())

/** Check 9: the preflight allows the page's three request headers for a day; a state answer exposes its three. */
export function judgeCors(preflight: EdgeAnswer, state: EdgeAnswer): string | null {
  if (preflight.status !== 204) return `the preflight answered ${preflight.status}`
  const allowed = listOf(preflight.headers.get('access-control-allow-headers'))
  const refused = ['if-none-match', 'cache-control', 'pragma'].filter((name) => !allowed.includes(name))
  if (refused.length) return `the preflight does not allow ${refused.join(', ')}`
  const maxAge = preflight.headers.get('access-control-max-age')
  if (maxAge !== '86400') return `the preflight carried Access-Control-Max-Age ${maxAge}`
  const origin = state.headers.get('access-control-allow-origin')
  if (origin !== '*') return `the state answer carried Access-Control-Allow-Origin ${origin}`
  const exposed = listOf(state.headers.get('access-control-expose-headers'))
  const hidden = ['etag', 'retry-after', 'age'].filter((name) => !exposed.includes(name))
  return hidden.length ? `the state answer does not expose ${hidden.join(', ')}` : null
}

/** Check 10: each page 200 HTML and DYNAMIC; the two loads of `/` carry two different nonces. */
export function judgePages(home: readonly [EdgeAnswer, EdgeAnswer], mint: EdgeAnswer | null): string | null {
  const pages: [string, EdgeAnswer][] = [
    ['/', home[0]],
    ['/ again', home[1]],
    ...(mint ? [['the mint page', mint] as [string, EdgeAnswer]] : []),
  ]
  for (const [name, page] of pages) {
    const html = (page.headers.get('content-type') ?? '').includes('text/html')
    if (page.status !== 200 || !html || cacheStatusOf(page) !== 'DYNAMIC')
      return `${name} answered ${page.status} ${page.headers.get('content-type')}, ${statusText(page)}`
  }
  const [first, second] = home.map((page) => {
    const policy = pagePolicyOf(page.headers)
    return policy ? nonceOf(policy.policy) : null
  })
  if (!first || !second) return 'a load of / carried no nonce'
  return first === second ? 'two loads of / carried the same nonce' : null
}

/**
 * Check 11: the page policy has 'strict-dynamic' and a nonce every script carries, its connect-src lists the
 * freshness origin given (a build still naming an earlier origin, before its redeploy, fails here: Review Focus 4),
 * Reporting-Endpoints names the app's report path, and the three headers arrive as the app sends them.
 */
export function judgePolicy(page: EdgeAnswer, args: Pick<EdgeArgs, 'app' | 'freshness'>): string | null {
  const found = pagePolicyOf(page.headers)
  if (!found) return 'the page carries no policy naming script-src'
  if (!directiveOf(found.policy, 'script-src').includes("'strict-dynamic'"))
    return `the ${found.mode} policy's script-src has no 'strict-dynamic'`
  const nonce = nonceOf(found.policy)
  if (!nonce) return `the ${found.mode} policy's script-src has no nonce`
  const scripts = scriptNonces(page.body)
  const off = scripts.filter((carried) => carried !== nonce).length
  if (!scripts.length || off) return `${off} of the ${scripts.length} scripts lack the response's nonce`
  if (!directiveOf(found.policy, 'connect-src').includes(args.freshness.origin))
    return `connect-src does not list ${args.freshness.origin}`
  const endpoint = `${args.app.origin}/api/csp-report`
  if (!(page.headers.get('reporting-endpoints') ?? '').includes(`"${endpoint}"`))
    return `Reporting-Endpoints does not name ${endpoint}`
  const expected: [string, string][] = [
    ['x-frame-options', 'DENY'],
    ['x-content-type-options', 'nosniff'],
    ['referrer-policy', 'strict-origin-when-cross-origin'],
  ]
  for (const [name, value] of expected)
    if (page.headers.get(name) !== value) return `${name} arrived as ${page.headers.get(name)}`
  return null
}

/** Check 12: no page holds an injected mark and no answer carries a Speculation-Rules header. */
export function judgeInjected(pages: readonly EdgeAnswer[], answers: readonly EdgeAnswer[]): string | null {
  const marks = INJECTED_MARKS.filter((mark) => pages.some((page) => page.body.includes(mark)))
  if (marks.length) return `a page holds ${marks.join(', ')}`
  return answers.some((answer) => answer.headers.has('speculation-rules'))
    ? 'an answer carries Speculation-Rules'
    : null
}

/** Check 13: http:// answers a redirect to the same host on https://, and `/` carries Strict-Transport-Security. */
export function judgeTransport(redirect: EdgeAnswer, home: EdgeAnswer, app: URL): string | null {
  const location = redirect.headers.get('location') ?? ''
  const secure = location === `https://${app.host}` || location.startsWith(`https://${app.host}/`)
  if (![301, 302, 307, 308].includes(redirect.status) || !secure)
    return `http:// answered ${redirect.status} to ${location || 'no Location'}`
  return home.headers.has('strict-transport-security') ? null : '/ carries no Strict-Transport-Security'
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm --filter @cobweb/web exec vitest run src/lib/edge/edge-checks.test.ts`
Expected: PASS, `Tests  23 passed (23)`.

- [ ] **Step 5: The script and its command**

Create `apps/web/scripts/check-edge.ts`:

```ts
// Reads Cloudflare in front of the app and the freshness server from outside
// (docs/specs/2026-10-18-load-run-contract-review-and-cloudflare.md, section 8): 13 checks with PASS and FAIL lines in
// the verify scripts' form, each failure naming the setting to look at, judged by src/lib/edge/edge-checks.ts. The
// owner runs it once the zone is set (docs/reference/cloudflare-setup.md) and after any change to it. Checks 3, 5, 6
// and 8 send the page's own request headers; checks 4 and 8 depend on timing, so one failure on a slow line is decided
// by a rerun. Reads no secret and writes nothing; it proves the colo nearest the machine that runs it.
//
//   pnpm --filter @cobweb/web check:edge --app https://<app domain> --freshness https://<freshness domain> \
//     --collection <chain id>/<address> [--slug <mint page link>]
//
// Runs under `node --conditions=react-server --import ./scripts/resolve-ts.mjs`.

import { randomBytes } from 'node:crypto'
import { STATE_CACHE, WALLET_CACHE } from '@cobweb/freshness/server'
import {
  EDGE_CHECKS,
  edgeArgsOf,
  judgeCors,
  judgeFirstPoll,
  judgeHealth,
  judgeInjected,
  judgeNotModified,
  judgeOneSecond,
  judgePages,
  judgePolicy,
  judgeQuery,
  judgeSetup,
  judgeStateAtEdge,
  judgeTransport,
  judgeWallet,
  type EdgeAnswer,
} from '../src/lib/edge/edge-checks.ts'

const USAGE =
  'Usage: pnpm --filter @cobweb/web check:edge --app https://<app domain> --freshness https://<freshness domain> --collection <chain id>/<address> [--slug <mint page link>]'

const args = edgeArgsOf(process.argv.slice(2))
if (!args) {
  console.error(USAGE)
  process.exit(2)
}
const { app, freshness } = args

/** A poll as the page's `cache: 'no-cache'` fetch sends it, and its first as `cache: 'reload'` sends it (decision 4). */
const NO_CACHE = { 'Cache-Control': 'max-age=0' }
const RELOAD = { 'Cache-Control': 'no-cache', Pragma: 'no-cache' }
const statePath = `/v1/state/${args.chainId}/${args.address}`

/** Every answer read, with its URL, for check 12. */
const seen: { url: URL; answer: EdgeAnswer }[] = []

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** One request with no redirect followed, given up after 10 s; its status, headers and body. */
async function ask(
  url: URL,
  init: { method?: string; headers?: Record<string, string> } = {},
): Promise<EdgeAnswer> {
  const response = await fetch(url, {
    method: init.method ?? 'GET',
    headers: init.headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
  })
  const answer = { status: response.status, headers: response.headers, body: await response.text() }
  seen.push({ url, answer })
  return answer
}

const at = (base: URL, path: string) => new URL(path, base)
const poll = (headers: Record<string, string> = {}, query = '') =>
  ask(at(freshness, `${statePath}${query}`), { headers })

/** A thrown error as one line: its message, and the code of its cause where fetch gives one. */
function thrown(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const code = (error.cause as { code?: unknown } | undefined)?.code
  return `${error.message.split('\n')[0]}${typeof code === 'string' ? ` (${code})` : ''}`
}

let passed = 0
let failed = 0

/** Runs check `n`: its PASS line, or its FAIL line with the problem and where to look. */
async function check(n: number, judge: () => Promise<string | null>): Promise<void> {
  const { subject, held, hint } = EDGE_CHECKS[n - 1]!
  let problem: string | null
  try {
    problem = await judge()
  } catch (error) {
    problem = `threw ${thrown(error)}`
  }
  if (problem === null) {
    passed++
    console.log(`PASS ${n}. ${subject}: ${held}`)
  } else {
    failed++
    console.log(`FAIL ${n}. ${subject}: ${held}: ${problem}. Look at: ${hint}`)
  }
}

console.log(`Reading ${app.origin} and ${freshness.origin} from outside`)

await check(1, async () =>
  judgeSetup(await ask(app), await ask(at(freshness, '/health')), await poll(NO_CACHE)),
)

await check(2, async () =>
  judgeHealth([await ask(at(freshness, '/health')), await ask(at(freshness, '/health'))]),
)

await check(3, async () => judgeStateAtEdge(await poll(NO_CACHE), await poll(NO_CACHE), STATE_CACHE))

await check(4, async () => {
  const polls: EdgeAnswer[] = []
  for (let n = 0; n < 20; n++) {
    const sent = Date.now()
    polls.push(await poll())
    await wait(Math.max(0, 250 - (Date.now() - sent)))
  }
  return judgeOneSecond(polls)
})

await check(5, async () => {
  const etag = (await poll(NO_CACHE)).headers.get('etag')
  if (!etag) return 'the poll before it carried no ETag'
  return judgeNotModified(await poll({ ...NO_CACHE, 'If-None-Match': etag }), etag)
})

await check(6, async () => {
  await poll(NO_CACHE)
  return judgeFirstPoll(await poll(RELOAD))
})

await check(7, async () => {
  await poll()
  return judgeQuery(await poll({}, `?check-edge=${randomBytes(8).toString('hex')}`))
})

await check(8, async () => {
  const wallet = at(
    freshness,
    `/v1/wallet/${args.chainId}/${args.address}/0x${randomBytes(20).toString('hex')}`,
  )
  const sent = Date.now()
  const first = await ask(wallet, { headers: NO_CACHE })
  const second = await ask(wallet, { headers: NO_CACHE })
  await wait(Math.max(0, 6_000 - (Date.now() - sent)))
  return judgeWallet(first, second, await ask(wallet, { headers: NO_CACHE }), WALLET_CACHE)
})

await check(9, async () => {
  const preflight = await ask(at(freshness, statePath), {
    method: 'OPTIONS',
    headers: {
      Origin: app.origin,
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'if-none-match, cache-control, pragma',
    },
  })
  return judgeCors(preflight, await poll({ ...NO_CACHE, Origin: app.origin }))
})

await check(10, async () =>
  judgePages([await ask(app), await ask(app)], args.slug ? await ask(at(app, `/${args.slug}`)) : null),
)

await check(11, async () => judgePolicy(await ask(app), args))

await check(12, async () => {
  const pages = seen
    .filter(
      ({ url, answer }) =>
        url.origin === app.origin && answer.headers.get('content-type')?.includes('text/html'),
    )
    .map(({ answer }) => answer)
  return judgeInjected(
    pages,
    seen.map(({ answer }) => answer),
  )
})

await check(13, async () => judgeTransport(await ask(new URL(`http://${app.host}/`)), await ask(app), app))

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
```

In `apps/web/package.json`, replace:

```json
    "verify:sources": "node --conditions=react-server --import ./scripts/resolve-ts.mjs scripts/verify-sources.ts",
    "verify:load": "node --conditions=react-server --import ./scripts/resolve-ts.mjs scripts/verify-load.ts"
  },
```

with:

```json
    "verify:sources": "node --conditions=react-server --import ./scripts/resolve-ts.mjs scripts/verify-sources.ts",
    "verify:load": "node --conditions=react-server --import ./scripts/resolve-ts.mjs scripts/verify-load.ts",
    "check:edge": "node --conditions=react-server --import ./scripts/resolve-ts.mjs scripts/check-edge.ts"
  },
```

- [ ] **Step 6: Typecheck and lint the web app**

Run: `pnpm --filter @cobweb/web typecheck && pnpm --filter @cobweb/web lint`
Expected: PASS.

- [ ] **Step 7: The usage refusals**

Run: `pnpm --filter @cobweb/web check:edge`
Expected: exit code 2 and `Usage: pnpm --filter @cobweb/web check:edge --app https://<app domain> --freshness https://<freshness domain> --collection <chain id>/<address> [--slug <mint page link>]`.

Run: `pnpm --filter @cobweb/web check:edge --app http://cobweb.example --freshness https://fresh.cobweb.example --collection 1/0x5FbDB2315678afecb367f032d93F642f64180aa3`
Expected: exit code 2 and the same usage line (an http URL).

- [ ] **Step 8: The smoke run**

The app and the freshness server both pointed at the Vercel production domain, which is not behind Cloudflare (spec section 3, task 4; Decision 23).

Run: `pnpm --filter @cobweb/web check:edge --app https://cobweb-cobweb3.vercel.app --freshness https://cobweb-cobweb3.vercel.app --collection 31337/0x5FbDB2315678afecb367f032d93F642f64180aa3`
Expected: FAIL, exit code 1, after about 12 s: thirteen lines numbered 1 to 13, the first `FAIL 1. setup: the app domain and the freshness domain both answer through Cloudflare (a cf-ray header on each), /health reads ok, and the collection's state answers 200: the app domain and the freshness domain answered with no cf-ray header. Look at: the two DNS records are Proxied, and the URLs given are the custom domains, not Vercel's or Railway's own.`, then the totals line. The other twelve read whatever the domain then serves.

- [ ] **Step 9: Format, run the root checks and commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
pnpm exec prettier --write apps/web/src/lib/edge/edge-checks.ts apps/web/src/lib/edge/edge-checks.test.ts apps/web/scripts/check-edge.ts apps/web/package.json
pnpm typecheck && pnpm lint && pnpm test
git add apps/web/src/lib/edge/edge-checks.ts apps/web/src/lib/edge/edge-checks.test.ts apps/web/scripts/check-edge.ts apps/web/package.json
git commit -m "$(cat <<'EOF'
Add check:edge, which reads Cloudflare in front of the app and the freshness server from outside in 13 checks, each judged by a pure function tested on answers shaped as Cloudflare's

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: web 1044 tests in 108 files; the other packages unchanged.

---

### Task 5: Slither, its triage, its database and the CI job

**Kind:** integration: a new analyzer on the machine, its database written by its own triage mode, and a CI job: an Opus implementer.

**Files:**

- Create: `contracts/slither.config.json`, `contracts/slither.triage.md`, `contracts/slither.db.json` (written by Slither, formatted by Prettier)
- Modify: `.github/workflows/ci.yml` (the `slither` job), `.gitignore` (`contracts/crytic-export/`)
- Test: Slither from `contracts/` and from the repository root at the medium threshold; `pnpm --filter @cobweb/shared test`

**Interfaces:**

- Consumes: `contracts/src` as it stands since `94a6c1f`, creation code hash `0xa57eac3d6d8dca5d3bb294162c964342bd351cba3cf034f1b8b6b3e2ca9ae594`; `contracts/foundry.toml`'s solc 0.8.30 and prague; the submodules in `contracts/lib`.
- Produces: the pinned command `uvx --python 3.12 --from slither-analyzer==0.11.6 slither . --config-file slither.config.json`, run from `contracts/`, which reads `slither.db.json` beside it and reports 0 results; `contracts/slither.triage.md` with its 12 rows over the 17 findings; `contracts/slither.db.json` holding all 17; the `slither` job in CI. Task 7's record cites all three; Task 9 runs the command again.

- [ ] **Step 1: uv**

Run: `uv --version || brew install uv`
Expected: `uv 0.13.1` or a later release (Homebrew's while planning was 0.13.1).

- [ ] **Step 2: The configuration**

It filters the libraries, the tests and the scripts, and excludes no detector (spec section 7.1).

Create `contracts/slither.config.json`:

```json
{
  "filter_paths": "(lib/|test/|script/)"
}
```

- [ ] **Step 3: Run Slither and list its findings**

The first run fetches Python 3.12 and the analyzer into uv's cache. Slither's own build runs `forge clean` first (Decision 14), and its log goes to standard error, so standard output holds the JSON alone.

Run:

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad/contracts
uvx --python 3.12 --from slither-analyzer==0.11.6 slither . --config-file slither.config.json --json - 2>/dev/null | python3 -I -c 'import json, sys; r = json.load(sys.stdin)["results"]["detectors"]; print(len(r), "findings"); [print(x["id"][:12], x["check"], x["impact"], x["confidence"]) for x in sorted(r, key=lambda x: (["High", "Medium", "Low", "Informational", "Optimization"].index(x["impact"]), x["check"], x["id"]))]'
```

Expected, exactly:

```
17 findings
915514f49802 encode-packed-collision High High
fafd57f6cab3 encode-packed-collision High High
b321910c9dc1 incorrect-equality Medium High
672c0e18c7bc reentrancy-benign Low Medium
29c1f2cb3e05 reentrancy-events Low Medium
813cfebdc1e7 timestamp Low Medium
d429863d9583 assembly Informational High
bfc35da9622f cyclomatic-complexity Informational High
3127bbc6f72f dead-code Informational Medium
21ab3f744fcc low-level-calls Informational High
70e70a1181ac low-level-calls Informational High
d73a790ece64 low-level-calls Informational High
2692839ed00b unindexed-event-address Informational High
48f6714cb16b unindexed-event-address Informational High
519a534d6383 unindexed-event-address Informational High
b7b8ff3a1487 immutable-states Optimization High
f31da077b739 immutable-states Optimization High
```

If the list differs in any line, stop and report it to the controller: Step 4 holds every finding, and a finding no row of Step 6 judges must not be held unread.

- [ ] **Step 4: Triage mode writes the database**

Every finding is `accepted` or `false positive` (Step 6's table), so "All" is the answer at each of the 11 detectors' prompts (Decision 15); Prettier then formats the file, which `pnpm format:check` reads.

Run:

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad/contracts
yes All | uvx --python 3.12 --from slither-analyzer==0.11.6 slither . --config-file slither.config.json --triage-mode > /dev/null 2>&1
python3 -I -c 'import json; print(len(json.load(open("slither.db.json"))), "held")'
cd ..
pnpm exec prettier --write contracts/slither.db.json
wc -l contracts/slither.db.json
```

Expected: `17 held`; Prettier writes the file; `2374 contracts/slither.db.json`.

- [ ] **Step 5: The database holds every finding, from `contracts/` and from the root as CI runs it**

Run, from `contracts/`: `uvx --python 3.12 --from slither-analyzer==0.11.6 slither . --config-file slither.config.json --fail-medium`
Expected: exit code 0, the last line `INFO:Slither:. analyzed (29 contracts with 102 detectors), 0 result(s) found`.

Run, from the repo root: `uvx --python 3.12 --from slither-analyzer==0.11.6 slither contracts --config-file contracts/slither.config.json --triage-database contracts/slither.db.json --fail-medium`
Expected: exit code 0, the last line `INFO:Slither:contracts analyzed (29 contracts with 102 detectors), 0 result(s) found` (every id is the same in both forms, Decision 14).

Run, from the repo root, with no database: `uvx --python 3.12 --from slither-analyzer==0.11.6 slither contracts --config-file contracts/slither.config.json --triage-database /nonexistent/slither.db.json --fail-medium`
Expected: FAIL, exit code 255, `17 result(s) found`: the threshold fails a run on the high and medium findings nobody has judged.

- [ ] **Step 6: The triage**

One row per high, medium and low finding and one per informational or optimization detector, with each verdict's reason (spec section 7.2; Decision 16). Write the file, then fill its run line with the date and the commit the run read, and format it.

Create `contracts/slither.triage.md`:

```markdown
# Slither triage

Every finding of Slither's run over `src/`, with its verdict and reason
(docs/specs/2026-10-18-load-run-contract-review-and-cloudflare.md, section 7.2). The `accepted` and `false positive` findings are in `slither.db.json`, the triage database Slither's `--triage-mode` wrote, which every later run reads to hide them, so CI's `slither` job fails only on a medium or high finding nobody has judged. A finding that cites a statement is keyed by its source lines, so an edit near it opens it again: triage it again in the change that moved it. No `slither-disable` comment goes into `src/`, since solc's metadata hash would move the creation code hash the factories approve.

- Analyzer: slither-analyzer 0.11.6 on Python 3.12 through uv, crytic-compile building through Foundry with the solc 0.8.30, prague and 200 optimizer runs that `foundry.toml` pins.
- Command, from `contracts/`: `uvx --python 3.12 --from slither-analyzer==0.11.6 slither . --config-file slither.config.json`, with `--triage-mode` to write the database. CI's `slither` job runs the same analyzer from the repository root as `slither contracts --fail-medium --config-file=contracts/slither.config.json --triage-database contracts/slither.db.json`, which gives every finding the same id.
- Run: <date>, at commit `<commit>`, on the contracts as they stand since `94a6c1f`, creation code hash `0xa57eac3d6d8dca5d3bb294162c964342bd351cba3cf034f1b8b6b3e2ca9ae594`.
- Result: 17 findings from 11 detectors (2 high, 1 medium, 3 low, 9 informational and 2 optimization); none is confirmed, so no contract changed (decision 11).

Verdicts: `fixed` (confirmed and changed under decision 11, with the commit and the new creation code hash), `accepted` (the pattern is there by design), `false positive` (the detector's premise does not hold).

| Id                                             | Detector                    | Impact        | Confidence | Where                                                                                                                                                          | Verdict        | Reason                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------- | --------------------------- | ------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fafd57f6cab3`                                 | encode-packed-collision     | High          | High       | `CobwebFactory.deployCollection`, src/CobwebFactory.sol#104-120, the packing at #111                                                                           | false positive | The packed bytes are the init code itself, the creation code followed by its constructor arguments, which is how EVM init code is formed. The approval check hashes `creationCode` alone first, so bytes moved between the two arguments change the hash checked and are refused unless that exact code is approved; the arguments are the deployer's own either way. |
| `915514f49802`                                 | encode-packed-collision     | High          | High       | `CobwebFactory.predictCollectionAddress`, src/CobwebFactory.sol#126-138, the packing at #132                                                                   | false positive | The same init code `deployCollection` deploys, hashed for its CREATE2 address in a view; it must pack exactly as the deploy does to predict its address.                                                                                                                                                                                                              |
| `b321910c9dc1`                                 | incorrect-equality          | Medium        | High       | `CobwebFactory.withdraw`, src/CobwebFactory.sol#161-168, `amount == 0` at #163                                                                                 | false positive | The detector fears a balance an attacker can move by forcing ether in, so that a strict equality never holds. Here the equality only refuses an empty withdrawal; ether forced into the factory makes the balance non-zero, and the admin then sends it to the treasury, as intended.                                                                                 |
| `672c0e18c7bc`                                 | reentrancy-benign           | Low           | Medium     | `CobwebCollection._refundExcessEther`, src/CobwebCollection.sol#905-913, the call at #908 and the write at #910                                                | accepted       | The refund is pushed last, after every state change of the mint or airdrop, from functions guarded by `nonReentrant`; the write after the call credits the excess to the caller's pending balance only when the push failed, so a caller that re-enters finds every entry point locked and nothing to take.                                                           |
| `29c1f2cb3e05`                                 | reentrancy-events           | Low           | Medium     | `CobwebFactory.withdraw`, src/CobwebFactory.sol#161-168, the call at #165 and the event at #167                                                                | accepted       | The event follows the transfer so that it reports a withdrawal that happened. `withdraw` is the admins' alone and sends the whole balance to the treasury, so a treasury that re-enters could only reorder two events, never move value.                                                                                                                              |
| `813cfebdc1e7`                                 | timestamp                   | Low           | Medium     | `CobwebCollection.mintGroupActive`, src/CobwebCollection.sol#604-608, the comparison at #607                                                                   | accepted       | Comparing `block.timestamp` with a scheduled start is the feature: a phase is live from the first block at or after its start (rule 1). A block producer's few seconds of drift can move a start by those seconds and no more.                                                                                                                                        |
| `d429863d9583`                                 | assembly (1)                | Informational | High       | `CobwebFactory.deployCollection`, src/CobwebFactory.sol#113-115                                                                                                | accepted       | `create2` with a salt bound to the caller is how every collection gets a predictable address; the block reads only the init code's memory and length.                                                                                                                                                                                                                 |
| `bfc35da9622f`                                 | cyclomatic-complexity (1)   | Informational | High       | `CobwebCollection._batchMint`, src/CobwebCollection.sol#829-875                                                                                                | accepted       | One function checks the group, the cap or quota, both supplies and the payment in the order a mint must refuse them; splitting it would scatter one rule.                                                                                                                                                                                                             |
| `3127bbc6f72f`                                 | dead-code (1)               | Informational | Medium     | `CobwebCollection._baseURI`, src/CobwebCollection.sol#934-936                                                                                                  | accepted       | ERC721A's base URI hook, kept consistent with `tokenURI`, which reads the base URI itself; removing it would move the creation code hash for no risk (decision 11).                                                                                                                                                                                                   |
| `21ab3f744fcc`, `70e70a1181ac`, `d73a790ece64` | low-level-calls (3)         | Informational | High       | `CobwebCollection._refundExcessEther` at src/CobwebCollection.sol#908, `CobwebCollection._send` at #897, `CobwebFactory.withdraw` at src/CobwebFactory.sol#165 | accepted       | `call` with all the gas left is how the native token reaches a contract wallet, and each result is checked: a failed refund is held for its owner, a failed withdrawal reverts.                                                                                                                                                                                       |
| `2692839ed00b`, `519a534d6383`, `48f6714cb16b` | unindexed-event-address (3) | Informational | High       | `CobwebCollection.OwnerPayoutAddressUpdated`, `DefaultRoyaltyUpdated` and `TokenRoyaltyUpdated`, src/CobwebCollection.sol#97-99                                | accepted       | Settings events, read by the collection's address that every log carries; indexing an address would change the log layout the app and the indexer decode and move the creation code hash.                                                                                                                                                                             |
| `f31da077b739`, `b7b8ff3a1487`                 | immutable-states (2)        | Optimization  | High       | `CobwebCollection.s_factory` and `CobwebCollection.s_maxSupply`, src/CobwebCollection.sol#123-124                                                              | accepted       | Rule 8: no per-collection immutables, so every collection keeps the same runtime bytecode and an explorer verifies it once per chain.                                                                                                                                                                                                                                 |
```

Run:

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
sed -i '' "s/<commit>/$(git rev-parse --short HEAD)/; s/<date>/$(date '+%-d %B %Y')/" contracts/slither.triage.md
pnpm exec prettier --write contracts/slither.triage.md
! grep -nE '<commit>|<date>' contracts/slither.triage.md
```

Expected: Prettier writes the file, its table already aligned; the last command prints nothing and exits 0, no fill left.

- [ ] **Step 7: The CI job and the ignore line**

A third job beside `node` and `contracts`, on the action's newest release tag, with the pinned analyzer, the configuration and the database, failing on a medium or high finding the database does not hold (spec section 7.3; Decision 17).

In `.github/workflows/ci.yml`, replace:

```yaml
      - run: pnpm --filter @cobweb/shared test
        working-directory: ${{ github.workspace }}
```

with:

```yaml
      - run: pnpm --filter @cobweb/shared test
        working-directory: ${{ github.workspace }}

  slither:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive
      # Slither over both contracts (docs/specs/2026-10-18-load-run-contract-review-and-cloudflare.md, section 7.3):
      # a medium or high finding that contracts/slither.db.json does not hold fails the job; low and informational
      # findings print and pass. contracts/slither.triage.md gives each held finding's verdict and reason.
      - uses: crytic/slither-action@v0.4.2
        with:
          target: contracts
          slither-version: 0.11.6
          slither-config: contracts/slither.config.json
          slither-args: --triage-database contracts/slither.db.json
          fail-on: medium
```

In `.gitignore`, replace:

```
contracts/broadcast/
coverage/
```

with:

```
contracts/broadcast/
contracts/crytic-export/
coverage/
```

- [ ] **Step 8: A full build after Slither's `forge clean`, and the shipped hash**

Slither's build skipped the tests, so the full build comes back before anything reads `contracts/out`.

Run: `cd contracts && forge build --sizes && cd .. && pnpm --filter @cobweb/shared test`
Expected: the sizes table with `CobwebCollection` at `17,845` bytes of runtime code, unchanged; then PASS, `Tests  105 passed (105)`.

- [ ] **Step 9: Format, run the checks and commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad/contracts
forge fmt --check && forge build --sizes && forge test
cd ..
pnpm exec prettier --write contracts/slither.config.json contracts/slither.db.json contracts/slither.triage.md .github/workflows/ci.yml
pnpm typecheck && pnpm lint && pnpm test
git add contracts/slither.config.json contracts/slither.db.json contracts/slither.triage.md .github/workflows/ci.yml .gitignore
git commit -m "$(cat <<'EOF'
Run Slither over both contracts with every finding triaged in the repository and its database, and fail CI on any medium or high finding nobody has judged

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: forge `92 tests passed, 0 failed`; the packages unchanged; `git show --stat HEAD` lists the five files.

---

### Task 6: The invariant suite, `EtherRejecter.claimTo`, the deep profile and the deep run

**Kind:** integration: a Solidity suite over every value and ownership path, fifteen mutations of the contracts and a twelve-minute run: an Opus implementer.

**Files:**

- Modify: `contracts/test/utils/BaseTest.sol` (`EtherRejecter.claimTo`), `contracts/test/Invariants.t.sol` (replaced whole), `contracts/foundry.toml` (the deep profile)
- Outside the repository, removed after use: `/tmp/cobweb-mutations.py`, `/tmp/cobweb-deep-run.txt` (the second is Task 7's)
- Test: `forge test` on the default campaign; the mutation script; `FOUNDRY_PROFILE=deep forge test` once

**Interfaces:**

- Consumes: `BaseTest`'s factory and fees (`MINT_FEE_FLAT`, `MINT_FEE_BPS`, `AIRDROP_FEE`), `admin`, `treasury`, `creator`, `creatorPayout`, `royaltyReceiver`, `PUBLIC_PRICE`, `ALLOWLIST_PRICE`, `PUBLIC_CAP`, `DEAD`, `_etchDelegateRegistry`, `MockDelegateRegistry` and `EtherRejecter`; the contracts as they ship (Task 5 changed none).
- Produces:
  - `EtherRejecter.claimTo(CobwebCollection collection, address to) returns (uint256)`, claiming its held refunds through `withdrawPendingBalanceTo`
  - in `Invariants.t.sol`: `struct Accounts`, `abstract contract Reach`, `FactoryHandler` (`payForArt`, `withdrawArt`, `grantAdmin`, `revokeAdmin`), `CollectionHandler` (the spec's 27 collection actions, Decisions 19 and 20) over the suite's 200-token collection (Decision 18), and `InvariantsTest`'s thirteen invariants by the spec's names in its four groups
  - `[profile.deep.invariant]` (1,000 runs of depth 1,000, `fail_on_revert = false`, `show_metrics = true`) and `[profile.deep.fuzz]` (10,000 runs)
  - the deep run's output in `/tmp/cobweb-deep-run.txt`, whose `real` seconds Task 7's record names

- [ ] **Step 1: `EtherRejecter.claimTo`**

In `contracts/test/utils/BaseTest.sol`, replace:

```solidity
        collection.batchMint{value: msg.value}(amount, mintGroup);
    }
```

with:

```solidity
        collection.batchMint{value: msg.value}(amount, mintGroup);
    }

    /// @dev Claims the refunds held for this contract to an address that can receive them.
    function claimTo(CobwebCollection collection, address to) external returns (uint256) {
        return collection.withdrawPendingBalanceTo(to);
    }
```

- [ ] **Step 2: The suite**

The two handlers share the accounts and the treasuries; the collection handler keeps the ghost totals and a flag for each thing that must never happen, catching each expected revert (spec section 7.5; Decisions 18 to 20).

Replace the whole of `contracts/test/Invariants.t.sol` with:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {BaseTest, EtherRejecter, MockDelegateRegistry} from "./utils/BaseTest.sol";
import {CobwebFactory} from "../src/CobwebFactory.sol";
import {CobwebCollection} from "../src/CobwebCollection.sol";

/// @dev The accounts both handlers reach: five minters, the creator, three platform admins and two treasuries.
struct Accounts {
    address[] actors;
    address creator;
    address[] admins;
    address[] treasuries;
}

/// @dev Reads the accounts both handlers share.
abstract contract Reach is Test {
    CobwebFactory internal immutable factory;
    address[] internal actors;
    address internal immutable creator;
    address[] internal admins;
    address[] internal treasuries;

    constructor(CobwebFactory factory_, Accounts memory accounts) {
        factory = factory_;
        actors = accounts.actors;
        creator = accounts.creator;
        admins = accounts.admins;
        treasuries = accounts.treasuries;
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    /// @dev The first of the three accounts holding the admin role; the factory never lets the last one go.
    function _admin() internal view returns (address) {
        for (uint256 i = 0; i < admins.length; i++) {
            if (factory.isAdmin(admins[i])) return admins[i];
        }
        return admins[0];
    }

    function _treasuryBalances() internal view returns (uint256 total) {
        for (uint256 i = 0; i < treasuries.length; i++) {
            total += treasuries[i].balance;
        }
    }
}

/// @dev Drives the factory's art payments, their withdrawal and the admin role.
contract FactoryHandler is Reach {
    uint256 public artPaid;
    uint256 public artWithdrawn;
    uint256 public artReceived;
    mapping(address => bool) public adminRecord;

    bool public repeatPaymentLanded;
    bool public lastAdminRemoved;
    bool public withdrawalRefused;

    mapping(bytes32 => mapping(address => bool)) internal paid;

    constructor(CobwebFactory factory_, Accounts memory accounts) Reach(factory_, accounts) {
        for (uint256 i = 0; i < admins.length; i++) {
            adminRecord[admins[i]] = factory.isAdmin(admins[i]);
        }
    }

    /// @dev A payer pays for a job; paying again for the same job must be refused.
    function payForArt(uint256 payerSeed, uint256 job, uint256 amount) external {
        address payer = _actor(payerSeed);
        bytes32 jobId = bytes32(bound(job, 1, 20));
        amount = bound(amount, 1, 1 ether);
        bool repeat = paid[jobId][payer];
        vm.prank(payer);
        try factory.payForArt{value: amount}(jobId) {
            if (repeat) repeatPaymentLanded = true;
            paid[jobId][payer] = true;
            artPaid += amount;
        } catch {}
    }

    /// @dev An admin sends everything the factory holds to the treasury.
    function withdrawArt() external {
        uint256 held = address(factory).balance;
        uint256 before = _treasuryBalances();
        vm.prank(_admin());
        try factory.withdraw() {
            artWithdrawn += held;
            artReceived += _treasuryBalances() - before;
        } catch {
            if (held > 0) withdrawalRefused = true;
        }
    }

    function grantAdmin(uint256 whoSeed) external {
        address who = admins[whoSeed % admins.length];
        bytes32 role = factory.DEFAULT_ADMIN_ROLE();
        vm.prank(_admin());
        factory.grantRole(role, who);
        adminRecord[who] = true;
    }

    /// @dev An admin revokes one of the three; the last admin's revoke must be refused.
    function revokeAdmin(uint256 whoSeed) external {
        address who = admins[whoSeed % admins.length];
        bytes32 role = factory.DEFAULT_ADMIN_ROLE();
        uint256 holders = 0;
        for (uint256 i = 0; i < admins.length; i++) {
            if (factory.isAdmin(admins[i])) holders++;
        }
        vm.prank(_admin());
        try factory.revokeRole(role, who) {
            if (adminRecord[who] && holders == 1) lastAdminRemoved = true;
            adminRecord[who] = false;
        } catch {}
    }
}

/// @dev Drives a collection through every path that moves value or ownership: mints of each kind, a refund held for
///      a contract that rejects ether, airdrops, burns, withdrawals, fee and treasury changes, phase edits with time
///      moving, whitelist chunks and transfers between holders.
contract CollectionHandler is Reach {
    uint256 internal constant PUBLIC = 0;
    uint256 internal constant MAX_GROUPS = 7;
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;

    enum Kind {
        Batch,
        OnBehalf,
        Delegate
    }

    CobwebCollection internal immutable collection;
    MockDelegateRegistry internal immutable registry;
    EtherRejecter public immutable rejecter;

    /// @dev Ghost totals: what was charged, withdrawn and received, held and claimed, airdropped and burned.
    uint256 public platformCharged;
    uint256 public proceedsCharged;
    uint256 public feesWithdrawn;
    uint256 public feesReceived;
    uint256 public proceedsWithdrawn;
    uint256 public proceedsReceived;
    uint256 public heldCredited;
    uint256 public heldClaimed;
    uint256 public heldReceived;
    uint256 public airdropped;
    uint256 public burned;
    mapping(address => uint256) public publicMintsOf;
    mapping(uint256 => mapping(address => uint256)) internal lastClaimed;

    /// @dev The registered groups are 0 to groupCount - 1, registered in order.
    uint256 public groupCount = 2;
    mapping(uint256 => bool) public closedSinceSchedule;

    /// @dev The admin's last fees; before any, the factory's defaults at the deploy.
    uint256 public lastFlat;
    uint256 public lastBps;
    uint256 public lastAirdropFee;

    /// @dev What must never happen.
    bool public strangerFeeChangeLanded;
    bool public mintedWhileNotLive;
    bool public capOrQuotaPassed;
    bool public claimedWentDown;
    bool public chargedOtherThanQuote;
    bool public withdrawalRefused;

    address[] internal lastChunk;
    uint256[] internal lastQuotas;
    uint256 internal lastChunkGroup;
    /// @dev The caller each vault last delegated to and has not taken back, so delegated mints find a delegation.
    mapping(address => address) internal delegateOf;

    constructor(
        CobwebCollection collection_,
        CobwebFactory factory_,
        MockDelegateRegistry registry_,
        EtherRejecter rejecter_,
        Accounts memory accounts
    ) Reach(factory_, accounts) {
        collection = collection_;
        registry = registry_;
        rejecter = rejecter_;
        (lastFlat, lastBps, lastAirdropFee) = factory.collectionFees();
        for (uint256 i = 0; i < actors.length; i++) {
            vm.deal(actors[i], 1_000_000 ether);
        }
        vm.deal(creator, 1_000_000 ether);
        vm.deal(address(this), 1_000_000 ether);
    }

    /// @dev After every action, no claimed count of a minter went down.
    modifier notingClaims() {
        _;
        for (uint256 group = 1; group < groupCount; group++) {
            for (uint256 i = 0; i < actors.length; i++) {
                uint256 claimed = collection.quotaClaimed(group, actors[i]);
                if (claimed < lastClaimed[group][actors[i]]) claimedWentDown = true;
                lastClaimed[group][actors[i]] = claimed;
            }
        }
    }

    function mintPublic(uint256 actorSeed, uint256 amount, uint256 overpay) external notingClaims {
        address actor = _actor(actorSeed);
        _mint(Kind.Batch, actor, actor, PUBLIC, bound(amount, 1, 10), bound(overpay, 0, 1 ether));
    }

    /// @dev Half the time from the group the last chunk named, so list mints find their quotas.
    function mintFromList(uint256 actorSeed, uint256 group, uint256 amount) external notingClaims {
        address actor = _actor(actorSeed);
        group = group % 2 == 0 && lastChunk.length > 0 ? lastChunkGroup : 1 + group % (groupCount - 1);
        _mint(Kind.Batch, actor, actor, group, bound(amount, 1, 10), 0);
    }

    /// @dev A payer mints for a receiver's cap or quota; refused while the switch is off.
    function mintOnBehalf(uint256 payerSeed, uint256 receiverSeed, uint256 group, uint256 amount)
        external
        notingClaims
    {
        _mint(Kind.OnBehalf, _actor(payerSeed), _actor(receiverSeed), _groupOf(group), bound(amount, 1, 10), 0);
    }

    /// @dev A caller mints on a vault's cap or quota: three times in four the caller the vault last delegated to, else
    ///      any account, which the registry mock refuses unless the vault delegated to it.
    function delegateMint(uint256 callerSeed, uint256 vaultSeed, uint256 group, uint256 amount) external notingClaims {
        address vault = _actor(vaultSeed);
        address caller = callerSeed % 4 == 0 || delegateOf[vault] == address(0) ? _actor(callerSeed) : delegateOf[vault];
        _mint(Kind.Delegate, caller, vault, _groupOf(group), bound(amount, 1, 10), 0);
    }

    /// @dev EtherRejecter mints from Public with an excess its refund cannot reach, so the excess is held for it.
    function mintRefused(uint256 amount, uint256 overpay) external notingClaims {
        amount = bound(amount, 1, 10);
        overpay = bound(overpay, 1, 1 ether);
        address holder = address(rejecter);
        (uint256 cost, uint256 fee) = collection.quoteBatchMint(PUBLIC, amount);
        bool live = collection.mintGroupActive(PUBLIC);
        bool passes = collection.publicMints(holder) + amount > collection.publicMaxMintPerWallet();
        uint256 heldBefore = collection.pendingBalance(holder);
        uint256 balanceBefore = address(collection).balance;
        try rejecter.mint{value: cost + overpay}(collection, amount, PUBLIC) {}
        catch {
            return;
        }
        if (!live) mintedWhileNotLive = true;
        if (passes) capOrQuotaPassed = true;
        uint256 held = collection.pendingBalance(holder) - heldBefore;
        if (held != overpay || address(collection).balance - balanceBefore != cost + overpay) {
            chargedOtherThanQuote = true;
        }
        heldCredited += held;
        platformCharged += fee;
        proceedsCharged += cost - fee;
        publicMintsOf[holder] += amount;
    }

    /// @dev EtherRejecter claims its held refunds to an account that can receive them.
    function claimHeld(uint256 toSeed) external notingClaims {
        address to = _actor(toSeed);
        uint256 held = collection.pendingBalance(address(rejecter));
        uint256 before = to.balance;
        try rejecter.claimTo(collection, to) returns (uint256 claimed) {
            heldClaimed += claimed;
            heldReceived += to.balance - before;
        } catch {
            if (held > 0) withdrawalRefused = true;
        }
    }

    /// @dev The creator airdrops 1 to 10 tokens to up to three accounts, paying the fee and an excess.
    function airdrop(uint256 seed, uint256 count, uint256 total, uint256 overpay) external notingClaims {
        total = bound(total, 1, 10);
        count = bound(count, 1, 3);
        if (count > total) count = total;
        address[] memory to = new address[](count);
        uint256[] memory amounts = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            to[i] = _actor(seed % actors.length + i);
            amounts[i] = total / count + (i == 0 ? total % count : 0);
        }
        _airdrop(to, amounts, total, bound(overpay, 0, 1 ether));
    }

    /// @dev The creator airdrops 1 to 10 tokens to the dead address, paying the fee.
    function burn(uint256 amount) external notingClaims {
        amount = bound(amount, 1, 10);
        address[] memory to = new address[](1);
        to[0] = DEAD;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = amount;
        if (_airdrop(to, amounts, amount, 0)) burned += amount;
    }

    /// @dev The owner or the payout address withdraws the creator's balance, which only the payout address receives.
    function withdrawProceeds(bool byPayout) external notingClaims {
        address payout = collection.ownerPayoutAddress();
        uint256 owed = collection.creatorBalance();
        uint256 before = payout.balance;
        vm.prank(byPayout ? payout : creator);
        try collection.withdrawMintFunds() returns (uint256 paidOut) {
            proceedsWithdrawn += paidOut;
            proceedsReceived += payout.balance - before;
        } catch {
            if (owed > 0) withdrawalRefused = true;
        }
    }

    /// @dev Anyone sends the platform balance to the factory's treasury.
    function withdrawFees(uint256 callerSeed) external notingClaims {
        address caller = _actor(callerSeed);
        uint256 owed = collection.platformBalance();
        uint256 before = _treasuryBalances();
        vm.prank(caller);
        try collection.withdrawPlatformFees() returns (uint256 paidOut) {
            feesWithdrawn += paidOut;
            feesReceived += _treasuryBalances() - before;
        } catch {
            if (owed > 0) withdrawalRefused = true;
        }
    }

    function setTreasury(uint256 which) external notingClaims {
        address treasury = treasuries[which % treasuries.length];
        vm.prank(_admin());
        factory.setTreasury(treasury);
    }

    function setPayout(uint256 actorSeed) external notingClaims {
        address payout = _actor(actorSeed);
        vm.prank(creator);
        collection.setOwnerPayoutAddress(payout);
    }

    /// @dev The admin sets the collection's fees, up or down.
    function setFees(uint256 flat, uint256 bps, uint256 airdropFee) external notingClaims {
        flat = bound(flat, 0, 1 ether);
        bps = bound(bps, 0, 10_000);
        airdropFee = bound(airdropFee, 0, 1 ether);
        vm.prank(_admin());
        collection.setFees(flat, bps, airdropFee);
        (lastFlat, lastBps, lastAirdropFee) = (flat, bps, airdropFee);
    }

    /// @dev The creator or an account tries to set the fees, and must be refused.
    function setFeesAsStranger(uint256 callerSeed, uint256 flat, uint256 bps, uint256 airdropFee)
        external
        notingClaims
    {
        address caller = callerSeed % 6 == 5 ? creator : _actor(callerSeed);
        flat = bound(flat, 0, 1 ether);
        bps = bound(bps, 0, 10_000);
        airdropFee = bound(airdropFee, 0, 1 ether);
        vm.prank(caller);
        try collection.setFees(flat, bps, airdropFee) {
            strangerFeeChangeLanded = true;
        } catch {}
    }

    /// @dev The admin changes the factory's defaults, which the deployed collection must not take.
    function setFactoryFees(uint256 flat, uint256 bps, uint256 airdropFee) external notingClaims {
        flat = bound(flat, 0, 1 ether);
        bps = bound(bps, 0, 10_000);
        airdropFee = bound(airdropFee, 0, 1 ether);
        vm.prank(_admin());
        factory.setCollectionFees(flat, bps, airdropFee);
    }

    /// @dev The creator registers the next group id, 2 to 6, scheduled or not.
    function registerGroup(uint256 price, uint256 supply, uint256 start) external notingClaims {
        if (groupCount == MAX_GROUPS) return;
        price = bound(price, 0, 10 ether);
        supply = bound(supply, 0, 40);
        uint256 startTimestamp = start % 2 == 0 ? 0 : block.timestamp + bound(start, 1, 3_600);
        vm.prank(creator);
        try collection.registerMintGroup(groupCount, price, supply, startTimestamp) {
            closedSinceSchedule[groupCount] = false;
            groupCount++;
        } catch {}
    }

    function setPrice(uint256 group, uint256 price) external notingClaims {
        group %= groupCount;
        price = bound(price, 0, 10 ether);
        vm.prank(creator);
        collection.changeSalePrice(price, group);
    }

    function setStatus(uint256 group, bool open) external notingClaims {
        group %= groupCount;
        vm.prank(creator);
        collection.setMintGroupStatus(group, open);
        if (!open) closedSinceSchedule[group] = true;
    }

    function setGroupSupply(uint256 group, uint256 supply) external notingClaims {
        group %= groupCount;
        supply = bound(supply, 0, 200);
        vm.prank(creator);
        try collection.setMintGroupMaxSupply(group, supply) {} catch {}
    }

    /// @dev The creator schedules a start 1 to 3,600 s ahead, or clears it with 0; half the time on Public.
    function schedule(uint256 group, uint256 offset) external notingClaims {
        group = group % 2 == 0 ? PUBLIC : group % groupCount;
        offset = bound(offset, 0, 3_600);
        uint256 start = offset == 0 ? 0 : block.timestamp + offset;
        vm.prank(creator);
        collection.scheduleMintGroupStart(group, start);
        closedSinceSchedule[group] = false;
    }

    /// @dev The creator opens or closes every group at once.
    function setAll(bool open) external notingClaims {
        vm.prank(creator);
        collection.stopOrStartAllMintGroups(open);
        if (!open) {
            for (uint256 group = 0; group < groupCount; group++) {
                closedSinceSchedule[group] = true;
            }
        }
    }

    /// @dev Time moves 1 to 3,600 s, with a block; a quarter of the time exactly to the next scheduled start, the
    ///      second a phase turns live (Review Focus 5).
    function warp(uint256 seconds_) external notingClaims {
        uint256 next = type(uint256).max;
        for (uint256 group = 0; group < groupCount; group++) {
            uint256 start = collection.mintGroupStartTimestamp(group);
            if (start > block.timestamp && start < next) next = start;
        }
        bool toStart = seconds_ % 4 == 0 && next != type(uint256).max;
        vm.warp(toStart ? next : block.timestamp + bound(seconds_, 1, 3_600));
        vm.roll(block.number + 1);
    }

    /// @dev The creator writes quotas of 0 to 20 for 1 to 50 addresses (the minters first), or the last chunk again.
    function writeChunk(uint256 group, uint256 size, uint256 quota, bool again) external notingClaims {
        if (!again || lastChunk.length == 0) {
            group = 1 + group % (groupCount - 1);
            size = bound(size, 1, 50);
            delete lastChunk;
            delete lastQuotas;
            for (uint256 i = 0; i < size; i++) {
                lastChunk.push(
                    i < actors.length ? actors[i] : address(uint160(uint256(keccak256(abi.encode("chunk", i)))))
                );
                lastQuotas.push(uint256(keccak256(abi.encode(quota, i))) % 21);
            }
            lastChunkGroup = group;
        }
        vm.prank(creator);
        collection.setMintQuota(lastChunk, lastChunkGroup, lastQuotas);
    }

    function setPublicCap(uint256 cap) external notingClaims {
        cap = bound(cap, 0, 50);
        vm.prank(creator);
        collection.setPublicMaxMintPerWallet(cap);
    }

    function setMintOnBehalf(bool open) external notingClaims {
        vm.prank(creator);
        collection.setMintOnBehalfStatus(open);
    }

    /// @dev A vault delegates to a caller in the registry mock, or takes the delegation back.
    function delegate(uint256 vaultSeed, uint256 callerSeed, bool on) external notingClaims {
        address vault = _actor(vaultSeed);
        address caller = _actor(callerSeed);
        registry.setDelegate(vault, caller, on);
        if (on) delegateOf[vault] = caller;
        else if (delegateOf[vault] == caller) delegateOf[vault] = address(0);
    }

    /// @dev A token a minter holds moves to another minter.
    function transfer(uint256 tokenSeed, uint256 toSeed) external notingClaims {
        uint256 minted = collection.totalMinted();
        if (minted == 0) return;
        uint256 token = 1 + tokenSeed % minted;
        address owner = collection.ownerOf(token);
        if (owner == DEAD || owner == address(rejecter)) return;
        address to = _actor(toSeed);
        vm.prank(owner);
        collection.transferFrom(owner, to, token);
    }

    /// @dev Public, the group the last chunk named, or any registered group, a third of the time each.
    function _groupOf(uint256 seed) internal view returns (uint256) {
        if (seed % 3 == 0) return PUBLIC;
        if (seed % 3 == 1 && lastChunk.length > 0) return lastChunkGroup;
        return seed % groupCount;
    }

    /// @dev A mint judged against the rules as they stood when it was sent: the group live, `holder`'s cap or quota,
    ///      and the quote taken exactly from `payer`, the excess returned.
    function _mint(Kind kind, address payer, address holder, uint256 group, uint256 amount, uint256 overpay) internal {
        (uint256 cost, uint256 fee) = collection.quoteBatchMint(group, amount);
        bool live = collection.mintGroupActive(group);
        bool passes = group == PUBLIC
            ? collection.publicMints(holder) + amount > collection.publicMaxMintPerWallet()
            : collection.quotaClaimed(group, holder) + amount > collection.mintQuotas(group, holder);
        uint256 before = payer.balance;
        bool landed;
        vm.prank(payer);
        if (kind == Kind.Batch) {
            try collection.batchMint{value: cost + overpay}(amount, group) {
                landed = true;
            } catch {}
        } else if (kind == Kind.OnBehalf) {
            try collection.mintOnBehalf{value: cost + overpay}(amount, group, holder) {
                landed = true;
            } catch {}
        } else {
            try collection.delegateMint{value: cost + overpay}(amount, group, holder) {
                landed = true;
            } catch {}
        }
        if (!landed) return;
        if (!live) mintedWhileNotLive = true;
        if (passes) capOrQuotaPassed = true;
        if (before - payer.balance != cost) chargedOtherThanQuote = true;
        platformCharged += fee;
        proceedsCharged += cost - fee;
        if (group == PUBLIC) publicMintsOf[holder] += amount;
    }

    /// @dev An airdrop from the creator, who must pay exactly the fee, the excess returned.
    function _airdrop(address[] memory to, uint256[] memory amounts, uint256 total, uint256 overpay)
        internal
        returns (bool landed)
    {
        (,, uint256 perToken) = collection.fees();
        uint256 fee = perToken * total;
        uint256 before = creator.balance;
        vm.prank(creator);
        try collection.airdropNFTs{value: fee + overpay}(to, amounts) {
            landed = true;
        } catch {
            return false;
        }
        if (before - creator.balance != fee) chargedOtherThanQuote = true;
        platformCharged += fee;
        airdropped += total;
    }
}

contract InvariantsTest is BaseTest {
    /// @dev The suite's collection: 200 tokens, Public 120 and Allowlist 60, small enough that most runs sell it out.
    uint256 internal constant SUPPLY = 200;

    address internal admin2 = makeAddr("admin2");
    address internal admin3 = makeAddr("admin3");
    address internal treasury2 = makeAddr("treasury2");

    CollectionHandler internal handler;
    FactoryHandler internal factoryHandler;
    EtherRejecter internal rejecter;
    address[] internal holders;
    address[] internal admins;

    function setUp() public override {
        super.setUp();
        collection = _smallCollection();
        MockDelegateRegistry registry = _etchDelegateRegistry();
        rejecter = new EtherRejecter();
        vm.prank(creator);
        collection.stopOrStartAllMintGroups(true);

        Accounts memory accounts;
        accounts.actors = new address[](5);
        for (uint256 i = 0; i < 5; i++) {
            accounts.actors[i] = makeAddr(string(abi.encodePacked("actor", vm.toString(i))));
            holders.push(accounts.actors[i]);
        }
        holders.push(address(rejecter));
        accounts.creator = creator;
        admins.push(admin);
        admins.push(admin2);
        admins.push(admin3);
        accounts.admins = admins;
        accounts.treasuries = new address[](2);
        accounts.treasuries[0] = treasury;
        accounts.treasuries[1] = treasury2;

        handler = new CollectionHandler(collection, factory, registry, rejecter, accounts);
        factoryHandler = new FactoryHandler(factory, accounts);
        targetContract(address(handler));
        targetContract(address(factoryHandler));
    }

    /// @dev The suite's collection, deployed through the factory as the base test deploys its own.
    function _smallCollection() internal returns (CobwebCollection) {
        CobwebCollection.BaseVariables memory base = CobwebCollection.BaseVariables({
            name: "Cobweb Invariants",
            symbol: "CBW",
            ownerPayoutAddress: creatorPayout,
            initialBaseURI: "ipfs://unrevealed",
            maxSupply: SUPPLY
        });
        uint256[] memory supplies = new uint256[](2);
        supplies[0] = 120;
        supplies[1] = 60;
        uint256[] memory prices = new uint256[](2);
        prices[0] = PUBLIC_PRICE;
        prices[1] = ALLOWLIST_PRICE;
        bytes memory args = abi.encode(base, supplies, prices, PUBLIC_CAP, uint96(500), creator, royaltyReceiver);
        vm.prank(creator);
        return
            CobwebCollection(factory.deployCollection(type(CobwebCollection).creationCode, args, bytes32(uint256(2))));
    }

    /*//////////////////////////////////////////////////////////////
                         FEE CUSTODY AND PROCEEDS
    //////////////////////////////////////////////////////////////*/
    /// @dev Every wei the collection holds is owed to the creator, the platform or a refund held for an account the
    ///      handlers reach, which only EtherRejecter's failed refunds ever are; and every mint and airdrop took exactly
    ///      its quote, the excess returned or held.
    function invariant_balanceEqualsWhatIsOwed() public view {
        uint256 held = collection.pendingBalance(creator);
        for (uint256 i = 0; i < holders.length; i++) {
            held += collection.pendingBalance(holders[i]);
        }
        assertEq(address(collection).balance, collection.creatorBalance() + collection.platformBalance() + held);
        assertEq(collection.pendingBalance(address(rejecter)), handler.heldCredited() - handler.heldClaimed());
        assertEq(handler.heldReceived(), handler.heldClaimed());
        assertFalse(handler.chargedOtherThanQuote());
    }

    /// @dev Platform fees are owed or were withdrawn, and only the treasuries received them.
    function invariant_platformFeesReachOnlyTheTreasury() public view {
        assertEq(handler.platformCharged(), collection.platformBalance() + handler.feesWithdrawn());
        assertEq(handler.feesReceived(), handler.feesWithdrawn());
        assertEq(treasury.balance + treasury2.balance, handler.feesReceived() + factoryHandler.artReceived());
        assertFalse(handler.withdrawalRefused());
    }

    /// @dev Mint proceeds are owed or were withdrawn, and only the payout address received them, whoever asked.
    function invariant_proceedsReachOnlyThePayout() public view {
        assertEq(handler.proceedsCharged(), collection.creatorBalance() + handler.proceedsWithdrawn());
        assertEq(handler.proceedsReceived(), handler.proceedsWithdrawn());
        assertFalse(handler.withdrawalRefused());
    }

    /// @dev The fees are the admin's last setting, the factory's defaults at the deploy before any.
    function invariant_feesChangeOnlyByTheAdmin() public view {
        (uint256 flat, uint256 bps, uint256 airdropFee) = collection.fees();
        assertEq(flat, handler.lastFlat());
        assertEq(bps, handler.lastBps());
        assertEq(airdropFee, handler.lastAirdropFee());
        assertFalse(handler.strangerFeeChangeLanded());
    }

    /// @dev The factory holds what was paid for art and not withdrawn, and the treasury received what was.
    function invariant_artPaymentsHeldOrPaidToTheTreasury() public view {
        assertEq(address(factory).balance, factoryHandler.artPaid() - factoryHandler.artWithdrawn());
        assertEq(factoryHandler.artReceived(), factoryHandler.artWithdrawn());
        assertFalse(factoryHandler.repeatPaymentLanded());
        assertFalse(factoryHandler.withdrawalRefused());
    }

    /*//////////////////////////////////////////////////////////////
                                THE ADMINS
    //////////////////////////////////////////////////////////////*/
    function invariant_anAdminAlwaysRemains() public view {
        uint256 holding = 0;
        for (uint256 i = 0; i < admins.length; i++) {
            bool isAdmin = factory.isAdmin(admins[i]);
            assertEq(isAdmin, factoryHandler.adminRecord(admins[i]));
            if (isAdmin) holding++;
        }
        assertGt(holding, 0);
        assertFalse(factoryHandler.lastAdminRemoved());
    }

    /*//////////////////////////////////////////////////////////////
                               PHASE BOUNDS
    //////////////////////////////////////////////////////////////*/
    function invariant_supplyNeverExceedsMax() public view {
        assertLe(collection.totalMinted(), collection.maxSupply());
    }

    function invariant_groupMintsNeverExceedAllocation() public view {
        for (uint256 group = 0; group < handler.groupCount(); group++) {
            assertLe(collection.mintGroupMints(group), collection.mintGroupMaxSupply(group));
        }
    }

    function invariant_allocationsFitInCollection() public view {
        uint256 allocated = 0;
        for (uint256 group = 0; group < handler.groupCount(); group++) {
            allocated += collection.mintGroupMaxSupply(group);
        }
        assertLe(allocated, collection.maxSupply());
    }

    /// @dev A group is live by its flag or a reached start and nothing else, in both views; a group closed since its
    ///      last schedule has no start; and no mint landed in a group that was not live when it was sent.
    function invariant_liveOnlyByFlagOrStart() public view {
        CobwebCollection.CollectionState memory state = collection.collectionState();
        assertEq(state.groups.length, handler.groupCount());
        for (uint256 group = 0; group < handler.groupCount(); group++) {
            uint256 start = collection.mintGroupStartTimestamp(group);
            bool live = collection.mintGroupActiveFlag(group) || (start != 0 && block.timestamp >= start);
            assertEq(collection.mintGroupActive(group), live);
            assertEq(state.groups[group].id, group);
            assertEq(state.groups[group].active, live);
            if (handler.closedSinceSchedule(group)) assertEq(start, 0);
        }
        assertFalse(handler.mintedWhileNotLive());
    }

    /// @dev No mint passed the public cap or a quota as they stood when it landed, and no claimed count went down,
    ///      a chunk written again included.
    function invariant_capsAndQuotasHeld() public view {
        assertFalse(handler.capOrQuotaPassed());
        assertFalse(handler.claimedWentDown());
    }

    /*//////////////////////////////////////////////////////////////
                             OWNERSHIP COUNTS
    //////////////////////////////////////////////////////////////*/
    function invariant_everyTokenCameFromAGroupOrAnAirdrop() public view {
        uint256 fromGroups = 0;
        for (uint256 group = 0; group < handler.groupCount(); group++) {
            fromGroups += collection.mintGroupMints(group);
        }
        assertEq(collection.totalMinted(), fromGroups + handler.airdropped());
    }

    /// @dev Every token is held by an account the handlers reach, the dead address holds exactly the burned ones,
    ///      and each account's public mints are those counted against it.
    function invariant_ownershipAddsUp() public view {
        uint256 held = collection.balanceOf(DEAD);
        for (uint256 i = 0; i < holders.length; i++) {
            held += collection.balanceOf(holders[i]);
            assertEq(collection.publicMints(holders[i]), handler.publicMintsOf(holders[i]));
        }
        assertEq(held, collection.totalSupply());
        assertEq(collection.totalSupply(), collection.totalMinted());
        assertEq(collection.balanceOf(DEAD), handler.burned());
    }
}
```

- [ ] **Step 3: Format and build**

Run: `cd contracts && forge fmt --check && forge build --sizes`
Expected: no output from `forge fmt --check`; the sizes table with `CobwebCollection` at `17,845` and `CobwebFactory` at `4,182` bytes of runtime code, unchanged.

- [ ] **Step 4: The suite on the default campaign**

Run: `cd contracts && forge test --match-contract InvariantsTest`
Expected: PASS in about 80 s, `13 passed; 0 failed`, each invariant `(runs: 256, calls: 128000, reverts: 0)`, each followed by its metrics table of 31 actions at about 4,100 calls each.

- [ ] **Step 5: Each invariant against a mutation of the contracts**

Fifteen mutations, each applied alone, run on 64 runs with a fixed seed, then undone; the script clears Foundry's persisted counterexamples before each run and after the last, since a persisted one is replayed on the next run (Decision 21; Review Focus 5 is `M11`).

Create `/tmp/cobweb-mutations.py`:

```python
"""Proves each invariant against a mutation of the contracts (docs/specs/2026-10-18-load-run-contract-review-and-cloudflare.md,
section 7.5): applies one mutation at a time, runs the invariant suite on 64 runs with a fixed seed, prints the
invariants that failed and undoes the mutation, clearing Foundry's persisted counterexamples before each run and after
the last. Run from the repository root; contracts/src is left as it was."""
import os
import pathlib
import re
import shutil
import subprocess

CONTRACTS = pathlib.Path('contracts')
COLLECTION = 'src/CobwebCollection.sol'
FACTORY = 'src/CobwebFactory.sol'
MUTATIONS = [
    ('M1 a refund held although it reached the minter', COLLECTION,
     '            if (!success) {\n                s_pendingBalances[msg.sender] += excess;',
     '            if (success || !success) {\n                s_pendingBalances[msg.sender] += excess;'),
    ("M2 the platform's fees paid to whoever asked", COLLECTION,
     '        _send(treasury, payout);', '        _send(msg.sender, payout);'),
    ('M3 the proceeds paid to whoever asked', COLLECTION,
     '        _send(payoutAddress, payout);', '        _send(msg.sender, payout);'),
    ('M4 the fees set by a stranger', COLLECTION,
     'uint256 airdropFeePerToken) external onlyPlatformAdmin {', 'uint256 airdropFeePerToken) external {'),
    ('M5 the art paid to the admin who withdraws', FACTORY,
     '        address to = s_treasury;', '        address to = msg.sender;'),
    ('M6 the last admin removable', FACTORY,
     '            if (--s_adminCount == 0) revert LastAdmin();', '            --s_adminCount;'),
    ("M7 a mint past the collection's supply", COLLECTION,
     '        if (minted + amount > s_maxSupply) revert ExceedsMaxSupply(amount, s_maxSupply - minted);\n\n'
     '        uint256 platformFee;',
     '        uint256 platformFee;'),
    ("M8 a group's mints past its allocation", COLLECTION,
     '        if (groupMinted + amount > groupMax) {', '        if (groupMinted + amount > groupMax + 1000) {'),
    ('M9 allocations past the supply', COLLECTION,
     '        if (totalAllocatedSupply > s_maxSupply) revert AllocationsExceedMaxSupply();\n', ''),
    ('M10 a start kept after a close', COLLECTION,
     '        if (!status) {\n            s_mintGroupStartTimestamp[mintGroup] = 0;',
     '        if (!status && status) {\n            s_mintGroupStartTimestamp[mintGroup] = 0;'),
    ('M11 a start honoured a second late', COLLECTION,
     '        return start != 0 && block.timestamp >= start;', '        return start != 0 && block.timestamp >= start + 1;'),
    ('M12 no public cap', COLLECTION,
     '            if (amount + alreadyMinted > cap) {', '            if (amount + alreadyMinted > cap + 1000) {'),
    ('M13 a chunk resetting claimed counts', COLLECTION,
     '            s_mintQuotas[mintGroup][addressesToAdd[i]] = mintQuotas_[i];',
     '            s_mintQuotas[mintGroup][addressesToAdd[i]] = mintQuotas_[i];\n'
     '            s_quotaClaimed[mintGroup][addressesToAdd[i]] = 0;'),
    ("M14 a group's mints left uncounted", COLLECTION,
     '        s_mintGroupMints[mintGroup] = groupMinted + amount;', '        s_mintGroupMints[mintGroup] = groupMinted;'),
    ("M15 a delegated mint on the caller's own cap", COLLECTION,
     '        totalCost = _batchMint(vault, amount, mintGroup, msg.sender);',
     '        totalCost = _batchMint(msg.sender, amount, mintGroup, msg.sender);'),
]
ENV = dict(os.environ, FOUNDRY_INVARIANT_RUNS='64', FOUNDRY_DISABLE_NIGHTLY_WARNING='1')
PERSISTED = CONTRACTS / 'cache' / 'invariant'

for name, path, old, new in MUTATIONS:
    source = CONTRACTS / path
    original = source.read_text()
    assert original.count(old) == 1, f'{name}: its line is not in {path} exactly once'
    shutil.rmtree(PERSISTED, ignore_errors=True)
    source.write_text(original.replace(old, new))
    try:
        run = subprocess.run(
            ['forge', 'test', '--match-contract', 'InvariantsTest', '--fuzz-seed', '1'],
            cwd=CONTRACTS, env=ENV, capture_output=True, text=True,
        )
    finally:
        source.write_text(original)
    failing = run.stdout.split('Failing tests:', 1)[1] if 'Failing tests:' in run.stdout else ''
    failed = sorted(set(re.findall(r'invariant_\w+', failing)))
    print(name, '->', ', '.join(failed) if failed else 'nothing failed')
shutil.rmtree(PERSISTED, ignore_errors=True)
```

Run, from the repo root, in about four minutes: `python3 -I /tmp/cobweb-mutations.py`
Expected, exactly:

```
M1 a refund held although it reached the minter -> invariant_balanceEqualsWhatIsOwed
M2 the platform's fees paid to whoever asked -> invariant_platformFeesReachOnlyTheTreasury
M3 the proceeds paid to whoever asked -> invariant_proceedsReachOnlyThePayout
M4 the fees set by a stranger -> invariant_feesChangeOnlyByTheAdmin
M5 the art paid to the admin who withdraws -> invariant_artPaymentsHeldOrPaidToTheTreasury
M6 the last admin removable -> invariant_anAdminAlwaysRemains, invariant_artPaymentsHeldOrPaidToTheTreasury
M7 a mint past the collection's supply -> invariant_supplyNeverExceedsMax
M8 a group's mints past its allocation -> invariant_groupMintsNeverExceedAllocation
M9 allocations past the supply -> invariant_allocationsFitInCollection
M10 a start kept after a close -> invariant_liveOnlyByFlagOrStart
M11 a start honoured a second late -> invariant_liveOnlyByFlagOrStart
M12 no public cap -> invariant_capsAndQuotasHeld
M13 a chunk resetting claimed counts -> invariant_capsAndQuotasHeld
M14 a group's mints left uncounted -> invariant_everyTokenCameFromAGroupOrAnAirdrop
M15 a delegated mint on the caller's own cap -> invariant_capsAndQuotasHeld, invariant_ownershipAddsUp
```

Then run: `git diff --exit-code contracts/src && rm /tmp/cobweb-mutations.py`
Expected: no output, exit code 0: the sources are as they were.

- [ ] **Step 6: The deep profile**

In `contracts/foundry.toml`, replace:

```toml
lint_on_build = false
```

with:

```toml
lint_on_build = false

# The deep invariant run (docs/specs/2026-10-18-load-run-contract-review-and-cloudflare.md, section 7.6), run once by
# hand as `FOUNDRY_PROFILE=deep forge test` and never in CI, which runs the default campaign of 256 runs of depth 500.
[profile.deep.invariant]
runs = 1000
depth = 1000
fail_on_revert = false
show_metrics = true

[profile.deep.fuzz]
runs = 10000
```

Run: `cd contracts && FOUNDRY_PROFILE=deep forge config --json | python3 -c 'import json, sys; c = json.load(sys.stdin); print(c["invariant"]["runs"], c["invariant"]["depth"], c["invariant"]["fail_on_revert"], c["invariant"]["show_metrics"], c["fuzz"]["runs"], c["solc"], c["evm_version"], c["optimizer_runs"])'`
Expected: `1000 1000 False True 10000 0.8.30 prague 200` (the deep profile inherits the compiler settings, so its build is the same bytecode, Decision 22).

Run: `cd contracts && forge config --json | python3 -c 'import json, sys; c = json.load(sys.stdin); print(c["invariant"]["runs"], c["invariant"]["depth"], c["invariant"]["show_metrics"], c["fuzz"]["runs"])'`
Expected: `256 500 True 256`, the default campaign CI keeps running.

- [ ] **Step 7: The whole suite**

Run: `cd contracts && forge test`
Expected: PASS, `100 tests passed, 0 failed, 0 skipped (100 total tests)`: the factory's 23, the collection's 64 and the 13 invariants.

- [ ] **Step 8: The deep run, once**

On the contracts as they ship, after Task 5 (spec section 7.6). It takes about 12 minutes on a 12-core laptop; keep its output for Task 7.

Run, from the repo root:

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad/contracts
/usr/bin/time -p env FOUNDRY_PROFILE=deep forge test > /tmp/cobweb-deep-run.txt 2>&1
grep -E '^\[PASS\] (invariant|testFuzz)|^\[FAIL|Ran [0-9]+ test suites|^real' /tmp/cobweb-deep-run.txt
```

Expected: thirteen lines `[PASS] invariant_<name>() (runs: 1000, calls: 1000000, reverts: 0)`, `[PASS] testFuzz_quoteBatchMint(uint96,uint96,uint16,uint16) (runs: 10000, ...)`, `Ran 3 test suites in ...: 100 tests passed, 0 failed, 0 skipped (100 total tests)` and `real` about 690 (seconds). A failure is read first as a finding or a handler error; a finding becomes a unit test from the shrunk sequence and goes through the spec's decision 11 before anything else.

- [ ] **Step 9: Format, run the checks and commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad/contracts
forge fmt --check && forge build --sizes && forge test
cd ..
pnpm --filter @cobweb/shared test
pnpm typecheck && pnpm lint && pnpm test
git add contracts/test/Invariants.t.sol contracts/test/utils/BaseTest.sol contracts/foundry.toml
git commit -m "$(cat <<'EOF'
Drive every value and ownership path through the invariant suite under thirteen invariants for fee custody, proceeds, the admins, phase bounds and ownership, with a deep profile run by hand

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: forge `100 tests passed`; shared `Tests  105 passed (105)`; the packages unchanged. Keep `/tmp/cobweb-deep-run.txt` for Task 7.

---

### Task 7: The record

**Kind:** transcription, with two values from Task 6's commit and deep run: a Sonnet implementer.

**Files:**

- Create: `docs/reference/contract-review-2026-10.md`
- Reads: `/tmp/cobweb-deep-run.txt` (Task 6), then removes it

**Interfaces:**

- Consumes: Task 5's triage and database (17 findings, none confirmed); Task 6's suite, its fifteen mutations and the deep run's `real` seconds; the commit of Task 6, where the review stands.
- Produces: the spec's section 7.7 in seven parts (scope, tools, Slither, a reading of six areas, invariants, changes, owed), which Task 9's MASTER_PLAN line and the contracts README link to.

- [ ] **Step 1: The record**

`<commit>` and `<seconds>` are filled in Step 2 (Decision 25).

Create `docs/reference/contract-review-2026-10.md`:

```markdown
# Contract review, October 2026

The review of Cobweb's two contracts before the first real launch
([../specs/2026-10-18-load-run-contract-review-and-cloudflare.md](../specs/2026-10-18-load-run-contract-review-and-cloudflare.md),
section 7): Slither over both contracts with every finding triaged, a reading of six areas, and the invariant suite on
CI's default campaign and once deeply. It found nothing to fix, so no contract changed. It is also the brief for the
external look, which is the owner's decision.

## 1. Scope

- Commit `<commit>`, where `contracts/src` stands as it has since `94a6c1f` (2 October 2026).
- `contracts/src/CobwebCollection.sol` (941 lines), `contracts/src/CobwebFactory.sol` (285 lines) and
  `contracts/src/interfaces/` (`ICobwebFactory`, `IDelegateRegistry`), with the library code they inherit read where it
  is called: OpenZeppelin 5.7.0's `ReentrancyGuard`, `Ownable`, `ERC2981` and `AccessControl`, and Limit Break's
  creator-token-standards 5.0.0 (`ERC721AC`, over ERC721A).
- solc 0.8.30, EVM version prague, the optimizer at 200 runs, the metadata hash kept (`bytecode_hash = "ipfs"`), as
  `contracts/foundry.toml` pins them.
- The creation code reviewed: 20,271 bytes with the hash
  `0xa57eac3d6d8dca5d3bb294162c964342bd351cba3cf034f1b8b6b3e2ca9ae594`, the one `packages/shared/src/collection.ts`
  ships and the factory admin approves. `CobwebCollection`'s runtime code is 17,845 bytes of the 24,576 allowed.

## 2. Tools

- Slither: slither-analyzer 0.11.6 (the newest on PyPI, released 28 July 2026) on Python 3.12, run through uv, with
  crytic-compile 0.4.2 building through Foundry: 102 detectors, none excluded, over `src/`
  (`contracts/slither.config.json` filters `lib/`, `test/` and `script/`).
- CI: the `slither` job runs the same analyzer through `crytic/slither-action` v0.4.2 on every push, reading the triage
  database, and fails on a medium or high finding the database does not hold. The action compiles with the Foundry it
  installs, reading the syntax tree of the same solc 0.8.30; run from the repository root it gives every finding the
  same id as the local run from `contracts/`.
- Foundry: forge 1.4.0-nightly at `6f49a62`, locally and in CI's `contracts` job
  (`nightly-6f49a622bd1c2219f918752b372d401aeeb8e851`).

## 3. Slither

17 findings from 11 of the 102 detectors, none confirmed:

| Impact | Confidence | Detector | Findings | Verdict |
| --- | --- | --- | --- | --- |
| High | High | encode-packed-collision | 2 | false positive |
| Medium | High | incorrect-equality | 1 | false positive |
| Low | Medium | reentrancy-benign, reentrancy-events, timestamp | 3 | accepted |
| Informational | High, Medium | assembly, cyclomatic-complexity, dead-code, low-level-calls (3), unindexed-event-address (3) | 9 | accepted |
| Optimization | High | immutable-states | 2 | accepted |

Each finding's id, lines, verdict and reason are in [contracts/slither.triage.md](../../contracts/slither.triage.md),
and the 17 are in `contracts/slither.db.json`, so CI fails only on a finding nobody has judged. The two high findings are
the factory packing a collection's creation code and its constructor arguments into the init code CREATE2 deploys: a
collision would need two splits of the same bytes, and the factory checks the hash of the creation code alone against
its approvals before it packs, so no split it accepts deploys code it did not approve. The medium finding is
`withdraw`'s refusal of an empty balance: ether forced into the factory only gives the admin more to send to the
treasury. No finding was fixed.

## 4. A reading of six areas

**Value flows.** The native token enters in five places: the three mints (`batchMint`, `mintOnBehalf`,
`delegateMint`), `airdropNFTs` and the factory's `payForArt`; neither contract has a `receive` or `fallback`. A mint
quotes its cost from the group's price and the collection's fees (`quoteBatchMint`), refuses less, credits the creator
the price and the platform the fee before it mints, and then pushes the excess back to the caller, holding it in the
caller's pending balance when the push fails, so a minter whose wallet rejects ether still mints and claims later. An
airdrop charges the per-token fee the same way. Every balance leaves through one function, each zeroing it before the
transfer and reverting on a failed one: `withdrawMintFunds` sends the creator's balance to the payout address,
`withdrawPlatformFees` the platform's to the factory's current treasury, `withdrawPendingBalance` and
`withdrawPendingBalanceTo` a caller's own held refunds, and the factory's `withdraw` its whole balance to the treasury.
So the collection holds exactly the creator's balance, the platform's and the held refunds, which invariant 1 holds;
ether forced in from outside (a selfdestruct) is owed to no one and stays.

**Access.** The owner (the creator) controls the sale: groups, prices, supplies, schedules, quotas, the public cap, the
on-behalf switch, the base URI, the payout address, royalties, airdrops and the transfer validator. The payout address
may also withdraw the proceeds, which reach only it, so a renounced or lost ownership never strands them. The platform
admin, an account holding the factory's admin role, sets a collection's fees up or down (`setFees`, the rate capped at
10,000 bps) and, on the factory, the approved creation code, the default fees, the art rate, the treasury, the art
withdrawal and the role itself; the factory refuses to revoke its last admin (`LastAdmin`). Anyone may deploy approved
code, mint within the rules, pay for art and send the platform's balance to the treasury, whose destination the factory
fixes. Invariants 4 and 6 hold the fee and admin rules over random callers.

**Reentrancy.** Every function that moves value is `nonReentrant`: the three mints, the airdrop and the four
withdrawals. Inside a mint the order is checks, then every counter and balance written, then the mint, whose
`onERC721Received` callback is the only call before the refund that can change state (a delegated mint's question to
the registry is a view), so a receiver that calls back finds every guarded entry point locked and the state already
final. The refund push comes last, and the one write after it credits a
pending balance only when the push failed (Slither's `reentrancy-benign`, accepted). The factory's `withdraw` is the
admins' alone and sends its whole balance, so a treasury that calls back finds nothing left (`reentrancy-events`,
accepted). Deploying runs the collection's constructor, which only reads the factory's fees.

**External trust.** A collection trusts three contracts. The factory that deployed it, recorded in the constructor:
its default fees are read once there (so no deployer supplies its own), and its `isAdmin` and `treasury` at each admin
check and each platform withdrawal, so a treasury rotation reaches every collection. The delegate.xyz v2 registry at its
fixed address, asked by `delegateMint` whether the caller may act for the vault; on a chain without it the call
reverts, so delegated mints there fail closed. Limit Break's transfer validator: transfers are checked only where the
configured validator has code, and the collection's `isApprovedForAll` honours the automatic approval for Limit Break's
default validator alone, so a validator the creator installs gets no approval a holder did not give. A collection
deployed by any other contract is not one the factory records, and the app and the freshness server refuse it.

**CREATE2 and the approved hash.** `deployCollection` refuses creation code whose keccak256 an admin has not approved,
salts each deploy with the deployer's address (`keccak256(abi.encode(deployer, salt))`), so no one can take another
deployer's address, and reverts when CREATE2 answers no address. The hash covers solc's metadata, which carries every
source file's hash, so any change to the source, a comment included, needs a new approval: that is why the triage keeps
its judgements in Slither's database and never in `src/`. Runtime bytecode stays identical across collections (no
immutables, rule 8), which the factory suite's `test_deploy_runtimeBytecodeIsIdenticalAcrossCollections` holds.
`removeCreationCode` stops new deploys and leaves existing collections as they are.

**The analysis doc's fixes, still in place.** The nine issues of
[the-suits-mint-analysis.md](the-suits-mint-analysis.md) stay fixed: `setMintGroupMaxSupply` refuses a supply below
what the group minted and the supply errors saturate (1); `maxSupply` lives in storage (2); `delegateMint` takes the
vault's cap or quota and mints to the caller, beside `mintOnBehalf` (3); public mints are counted for the public group
alone (4); the airdrop pays its per-token fee (5); `setMintQuota` refuses the public group (6); registration is explicit
and the NatSpec says so (7); a group's existence is a mapping (8); and every refusal is a custom error (9). A phase is
live exactly at its start (`>=`), and closing a group clears its schedule.

## 5. Invariants

`contracts/test/Invariants.t.sol` drives 31 actions: the factory handler's art payments (a repeat refused), their
withdrawal and the admin role among three accounts (the last admin's revoke refused), and the collection handler's mints
of each kind (public, from a list, on behalf, delegated through the registry mock, and by `EtherRejecter`, whose refund
is held and later claimed to another account), airdrops, burns, every withdrawal, the admin's fee changes and a
stranger's refused attempt, the factory's defaults, the treasury, the payout address, group registration, prices,
supplies, schedules with time moving (a quarter of the moves exactly to the next start), close all, whitelist chunks
written and written again, the public cap, the on-behalf switch, delegations and transfers between holders. Its
collection has 200 tokens (Public 120, Allowlist 60), so most runs sell it out and the supply bounds are reached.

The thirteen invariants, in four groups:

- Fee custody and proceeds: 1 `invariant_balanceEqualsWhatIsOwed`, 2 `invariant_platformFeesReachOnlyTheTreasury`,
  3 `invariant_proceedsReachOnlyThePayout`, 4 `invariant_feesChangeOnlyByTheAdmin`,
  5 `invariant_artPaymentsHeldOrPaidToTheTreasury`.
- The admins: 6 `invariant_anAdminAlwaysRemains`.
- Phase bounds: 7 `invariant_supplyNeverExceedsMax`, 8 `invariant_groupMintsNeverExceedAllocation`,
  9 `invariant_allocationsFitInCollection`, 10 `invariant_liveOnlyByFlagOrStart`, 11 `invariant_capsAndQuotasHeld`.
- Ownership counts: 12 `invariant_everyTokenCameFromAGroupOrAnAirdrop`, 13 `invariant_ownershipAddsUp`.

Results:

- CI's default campaign, on every push: 256 runs of depth 500, 128,000 calls per invariant, every action about 4,100
  of them, no call reverting; all thirteen pass in about 80 s, beside the 87 unit tests (100 in all).
- The deep run, once (`FOUNDRY_PROFILE=deep forge test`): 1,000 runs of depth 1,000, 1,000,000 calls per invariant,
  every action between about 31,800 and 32,800 of them, no call reverting, and the one fuzz test
  (`testFuzz_quoteBatchMint`) at 10,000 runs; all 100 tests pass, in <seconds> s on a 12-core laptop.
- Each invariant was checked against a mutation of the contracts that breaks what it holds, fifteen in all, each on 64
  runs of depth 500 and then undone, and each failed the invariant it targets: a refund held although it reached the
  minter (1); the platform's fees and the proceeds paid to whoever asked (2 and 3); the fees set by a stranger (4); the
  art paid to the admin who withdraws (5); the last admin removable (6, and 5, whose withdrawal then fails); a mint past
  the collection's supply (7); a group's mints past its allocation (8); allocations past the supply (9); a start kept
  after a close and a start honoured a second late (10); no public cap and a chunk resetting claimed counts (11); a
  group's mints left uncounted (12); and a delegated mint on the caller's own cap (13, and 11).

## 6. Changes

None. No finding was confirmed, so the contracts, the creation code hash
`0xa57eac3d6d8dca5d3bb294162c964342bd351cba3cf034f1b8b6b3e2ca9ae594` and every approval stay as they are; no factory
owes a new approval.

## 7. Owed

- The external look: the owner's decision before mainnet, with this record and the triage as its brief. The areas to
  put to an outside reviewer first: the refund path and its held balances, the fee and admin rules across the factory
  and its collections, liveness at a scheduled start, and the transfer validator's approval.
- On a testnet, owed elsewhere (the freshness server spec, section 12): the validator's security levels as Settings
  reads them (`getCollectionSecurityPolicy`), and the delegate registry's code on each launch chain, Berachain and Monad
  mainnet among them.
```

- [ ] **Step 2: Fill the commit and the deep run's seconds**

Run:

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
sed -i '' "s/<commit>/$(git rev-parse --short HEAD)/; s/<seconds>/$(awk '/^real/ {printf "%.0f", $2}' /tmp/cobweb-deep-run.txt)/" docs/reference/contract-review-2026-10.md
! grep -nE '<commit>|<seconds>' docs/reference/contract-review-2026-10.md
grep -n 'all 100 tests pass, in' docs/reference/contract-review-2026-10.md
rm /tmp/cobweb-deep-run.txt
```

Expected: the second command prints nothing and exits 0; the third prints the deep run's line with its seconds (about 690).

- [ ] **Step 3: Commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
git add docs/reference/contract-review-2026-10.md
git commit -m "$(cat <<'EOF'
Record the October 2026 contract review with Slither's findings and their verdicts, a reading of six areas, both invariant runs and the mutations the suite caught

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: `git show --stat HEAD` lists the one file.

---

### Task 8: The Cloudflare checklist

**Kind:** transcription. The plan carries every line: a Sonnet implementer.

**Files:**

- Create: `docs/reference/cloudflare-setup.md`

**Interfaces:**

- Consumes: `check:edge`'s 13 checks and hints (Task 4) and the hosted run's command (Task 2).
- Produces: the spec's section 9 with each rule's exact expression, section 13's steps 2 to 13 in their order, and section 8.2's hints, which Task 9's docs link to.

- [ ] **Step 1: The checklist**

Create `docs/reference/cloudflare-setup.md`:

````markdown
# Cloudflare in front: the setup checklist

The zone the owner sets by hand in Cloudflare's dashboard, in this order, and the check that proves each part
([../specs/2026-10-18-load-run-contract-review-and-cloudflare.md](../specs/2026-10-18-load-run-contract-review-and-cloudflare.md),
sections 9 and 13). It names the zone's domain `<zone>`, the app's `<app domain>` (the apex or a first-level subdomain)
and the freshness server's `<freshness domain>` (a first-level subdomain such as `fresh.<zone>`, since the free edge
certificate covers the apex and one level of subdomains). `pnpm --filter @cobweb/web check:edge` reads the result from
outside in 13 checks; run it once the zone is set and again after any change to it.

## What the setup relies on, and the check that proves it

- Cloudflare caches by file extension unless a rule makes an answer eligible; with the rule's edge TTL taken from the
  origin, `s-maxage` sets it: 1 s for a state, 5 s for a wallet, 10 s for a refusal (checks 3, 4 and 8).
- The edge keeps the origin's weak ETag and answers 304 to a matching `If-None-Match` from its copy (checks 3 and 5).
- The edge does not let a browser's request directives pass its copy: the mint page's first poll carries
  `Cache-Control: no-cache` and `Pragma: no-cache`, and every later one `Cache-Control: max-age=0` (checks 3, 5 and 6).
- Answers pass with their headers unchanged, and HTML pages with no script added (checks 9 to 12).

## Before the zone

The hosted freshness service runs this sub-project's code (`/health` carries `requests`) with its indexer as
`cobweb_indexer`, reads `"status":"ok"`, and serves a chain with at least one deployed Cobweb collection. Before the
mainnet factories that is a testnet's: Sepolia, with `COBWEB_TEST_CHAINS=1` on the service and the testnet factory
Phase 1 owes.

## 1. The zone

`<zone>` on the Free plan, the registrar's nameservers moved to the two Cloudflare names, until the zone reads Active.

## 2. TLS

- SSL/TLS encryption mode: Full (strict), so the edge verifies each origin's certificate.
- Edge Certificates: Always Use HTTPS on; Minimum TLS Version 1.2; Automatic HTTPS Rewrites as it is.
- HSTS: off, unless check 13 finds no `Strict-Transport-Security` on `/`; then on at six months, without
  `includeSubDomains` and without preload. A preload waits until after the launch.

## 3. The app domain

- Vercel (project cobweb, Settings, Domains): add `<app domain>` for Production.
- Cloudflare DNS: a CNAME for `<app domain>` to `cname.vercel-dns.com` (or the value Vercel's Domains page shows; at the
  apex Cloudflare flattens it), DNS only.
- Once Vercel shows the domain valid with its certificate, switch the record to Proxied.

## 4. The freshness domain

- Railway (service freshness, Settings, Networking): add `<freshness domain>` as a custom domain.
- Cloudflare DNS: a CNAME for `<freshness domain>` to the target Railway shows, DNS only.
- Once Railway shows its certificate, switch the record to Proxied.
- Once `https://<freshness domain>/health` answers through Cloudflare (a `cf-ray` header), remove Railway's generated
  domain from the service, so no client can poll the origin around the edge.

Supabase, R2's S3 endpoint and the IPFS gateway stay outside the zone; Cloudflare never fronts Supabase.

## 5. Cache

- Cache Rule "Freshness API":
  - When: `(http.host eq "<freshness domain>" and starts_with(http.request.uri.path, "/v1/"))`
  - Cache eligibility: Eligible for cache.
  - Edge TTL: Use cache-control header if present, bypass cache if not.
  - Browser TTL: Respect origin TTL.
  - Cache key: Ignore query string. Where the plan offers no such setting in a rule, set the zone's Caching Level
    (Caching, Configuration) to Ignore Query String, which does the same for every cached answer.
  - Serve stale content while revalidating: as it is (on).
  - Respect Strong ETags: off (the default).
- Cache Rule "Freshness health":
  - When: `(http.host eq "<freshness domain>" and http.request.uri.path eq "/health")`
  - Cache eligibility: Bypass cache.
- Tiered Cache: Smart Tiered Caching Topology on, so every colo fills from one upper tier and the origin sees about one
  state request a second per collection however many colos serve a launch.
- Caching, Configuration: Browser Cache TTL "Respect Existing Headers"; Always Online off, so an origin failure is met by
  the edge's copy under `stale-if-error`, not an archived page.
- No other cache rule, and never Cache Everything on `<app domain>`: each page carries its own response's nonce, and a
  cached page would hand every visitor the same one.

## 6. What stays off

Each injects a script the nonce policy would block or rewrites what the app sends; checks 9, 11 and 12 fail on those
that show in the answers they read.

- [ ] Rocket Loader (Speed, Optimization)
- [ ] Speed Brain (it adds a `Speculation-Rules` header to the app's answers)
- [ ] Cloudflare Fonts
- [ ] Email Address Obfuscation (Scrape Shield; on by default for a new zone)
- [ ] Web Analytics' automatic setup (its beacon)
- [ ] Zaraz
- [ ] Bot Fight Mode and its JavaScript detections
- [ ] Managed Transforms (Rules, Transform Rules)

## 7. Security

- The Cloudflare Free Managed Ruleset stays deployed (the free plan's managed WAF rules, on by default).
- No custom rule and no rate limiting rule: Supabase's own limits cover sign-in, the CSP report route has its limiter,
  and the freshness server answers from memory, its refusals held 10 s at the edge; `/health`'s `refused` count shows a
  spray.
- Security Level and Browser Integrity Check as they are.
- Never "I'm Under Attack" for the zone while `<freshness domain>` is in it, since every API answer would become a
  challenge page. If the app ever needs it, a Configuration Rule turns it on for `<app domain>` alone.

## 8. Outside the zone

- Turnstile: add `<app domain>` to the sign-in widget's hostnames.
- Vercel: `NEXT_PUBLIC_FRESHNESS_URL=https://<freshness domain>` on Production and Preview, then a redeploy: the value is
  read at build time, and the policy's `connect-src` follows it.
- Railway: nothing else; the freshness server reads no setting of the zone.

## 9. check:edge

```
pnpm --filter @cobweb/web check:edge --app https://<app domain> --freshness https://<freshness domain> --collection <chain id>/<address>
```

Add `--slug <mint page link>` once the hosted app leaves sample mode: the owner's test collection's mint page carries
an email address (`hello@<app domain>`) in its description, so check 12 can see Email Address Obfuscation; until then
that setting is checked by eye. Expected: `13 passed, 0 failed`. Checks 4 and 8 depend on timing, so one failure on a
slow line is decided by a rerun. A failure names the setting to look at:

| Check | Look at |
| --- | --- |
| 1. setup | the two DNS records are Proxied, and the URLs given are the custom domains, not Vercel's or Railway's own. |
| 2. health | the Cache Rule that bypasses /health. |
| 3. state at the edge | the Cache Rule for /v1/ (eligible, Edge TTL from the origin's Cache-Control, Browser TTL from the origin) and the zone's Browser Cache TTL. |
| 4. a 1 s edge | the /v1/ rule's Edge TTL, which must follow the origin's Cache-Control rather than set its own. |
| 5. 304 at the edge | Respect Strong ETags (off) and the /v1/ rule. |
| 6. first poll | nothing in the zone; the edge passed the browser's directives to the origin, a defect for the controller (decision 21). |
| 7. query ignored | the /v1/ rule's cache key (Ignore query string), or the zone's Caching Level (Ignore Query String). |
| 8. wallet | the /v1/ rule, as for check 3. |
| 9. CORS | a Transform Rule or a Managed Transform touching the freshness domain's headers. |
| 10. pages | a rule caching the app domain's pages (Cache Everything, or a Cache Rule making them eligible), which must not exist. |
| 11. policy intact | Managed Transforms (off), CSP_MODE on Vercel (not off), and a redeploy after NEXT_PUBLIC_FRESHNESS_URL moved. |
| 12. nothing injected | the feature named, in the list that stays off. |
| 13. transport | Always Use HTTPS, and HSTS (Vercel's header, or Cloudflare's if Vercel sends none). |

If check 4 shows the edge ignoring `s-maxage`, the fix is the controller's (decision 21): the state answer adds
`Cloudflare-CDN-Cache-Control: max-age=1, stale-while-revalidate=1, stale-if-error=60` and the wallet answer
`Cloudflare-CDN-Cache-Control: max-age=5`, a header Cloudflare reads before `Cache-Control` and no browser reads.

## 10. The report week's positive control

In the browser's console on `https://<app domain>/`, run
`document.body.insertAdjacentHTML('beforeend', '<img src="/x" onerror="document.title = 1">')`. Within a minute the
Vercel log shows a line that begins `{"csp":"report","directive":"script-src-attr",` or, once `CSP_MODE=enforce` is set,
`{"csp":"enforce","directive":"script-src-attr",`.

## 11. The hosted load run

From the repository root, on a machine with 8 cores and 16 GB of memory on a steady line, with k6 installed, once
check:edge passes: a rehearsal first, which also proves the machine, with the Railway service restarted once in its
second minute (its failed rate, `Age` and edge counts recorded, not gated):

```
k6 run --no-usage-report -e PROFILE=hosted -e BASE=https://<freshness domain> \
  -e COLLECTIONS=<chain id>/<address> -e POLLERS=2000 -e WALLETS=500 \
  -e SUMMARY_FILE=$HOME/k6-rehearsal.json apps/freshness/load/k6-freshness.js
```

Then the full run, about three and a half minutes, every threshold passed:

```
k6 run --no-usage-report -e PROFILE=hosted -e BASE=https://<freshness domain> \
  -e COLLECTIONS=<chain id>/<address> -e SUMMARY_FILE=$HOME/k6-hosted.json apps/freshness/load/k6-freshness.js
```

`COLLECTIONS` lists one to three deployed Cobweb collections on a chain the hosted freshness service serves, the
pollers shared among them. The summary lines and the JSON summary go to the controller for the dated notes. If
`Edge mitigations` reads above 0, Cloudflare's automatic protection challenged the single machine: run the same command
on two or three machines with `POLLERS` and `WALLETS` divided between them, and never lower the zone's protection for
the run.

## Known

- One machine reaches one or two colos, so the hosted run proves the edge and the origin's count where it lands; launch
  day's `/health` counts show the rest.
- Until Railway's generated domain is removed, the origin answers around the edge.
- A Cloudflare outage or a wrong setting takes the mint page's live data with it: the page raises its own degraded
  banner after 10 s, and the way back is `NEXT_PUBLIC_FRESHNESS_URL` set to Railway's domain and a redeploy, the policy
  following.
- Creators sign in on the Vercel domain until the third sub-project adds `<app domain>` to the sign-in origins; visitors
  read and mint on either.
- A creator's text with an email address shows as written only while Email Address Obfuscation stays off.
- `check:edge` reads from one place, so it proves the colo nearest the machine that runs it.
````

- [ ] **Step 2: Commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
git add docs/reference/cloudflare-setup.md
git commit -m "$(cat <<'EOF'
Write the Cloudflare checklist the owner applies by hand, in the spec's order, with each rule's expression, what stays off and check:edge's hints

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: `git show --stat HEAD` lists the one file.

---

### Task 9: The whole check list, the owner's commands walked locally, MASTER_PLAN, the dated notes, the landing note, CLAUDE.md, the contracts README and the example settings

This task is the controller's: it runs every check, walks the owner's commands as far as a laptop can (Decision 24), and records what it saw. The doc edits add dated sentences; nothing earlier is rewritten or deleted.

**Files:**

- Modify: `docs/MASTER_PLAN.md` (the Contracts and Hosting decisions, the Phase 7 status line)
- Modify: `docs/specs/2026-10-18-load-run-contract-review-and-cloudflare.md` (the acceptance boxes; the landing note)
- Modify: `docs/specs/2026-10-16-freshness-server.md` (sections 6.9 and 12, each a dated note)
- Modify: `CLAUDE.md` (five commands), `contracts/README.md` (Slither, the deep run, the suite's row, the figures), `apps/web/.env.example` (`NEXT_PUBLIC_FRESHNESS_URL`'s comment)

**Interfaces:**

- Consumes: everything Tasks 1 to 8 produce; the local services (`supabase start` with its buckets seeded, `pnpm --filter @cobweb/web chain:local` with its two lines in `apps/web/.env.local`); k6 and uv on the machine.
- Produces: the docs, `CLAUDE.md`'s commands, the README and the example setting.

In every sentence below, `<date>` is the day the work lands, written as `date '+%-d %B %Y'` prints it (for example `19 October 2026`).

- [ ] **Step 1: The whole check list**

Run at the repo root, one after another, and note each count. Nothing may listen on ports 3100, 3210 or 8787, and no freshness server may index the local database, while it runs.

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
pnpm typecheck && pnpm lint && pnpm test && pnpm format:check
pnpm build
(cd contracts && forge fmt --check && forge build --sizes && forge test)
(cd contracts && uvx --python 3.12 --from slither-analyzer==0.11.6 slither . --config-file slither.config.json --fail-medium)
(cd contracts && forge build) && pnpm --filter @cobweb/shared test
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
pnpm --filter @cobweb/web verify:csp
pnpm --filter @cobweb/web verify:sources
pnpm --filter @cobweb/web verify:load
```

Expected: tests pass (web 1044 in 108 files, freshness 261 in 20, shared 105 in 14, dna 60, render 117, worker 282); the format check and the build pass, the build listing `ƒ /[slug]` with every page dynamic and only `/icon.svg` static (`NEXT_PUBLIC_DEMO_DATA=1` in `apps/web/.env.local`, which `verify:csp` needs); forge `100 tests passed, 0 failed`; Slither exits 0 with `0 result(s) found`; the shared package `Tests  105 passed (105)` after the rebuild; `verify:local` 407, `verify:chain` 12, `verify:storage` 15, `verify:sweep` 11, `verify:render` 22, `verify:deploy` 15, `verify:phases` 20, `verify:whitelist` 18, `verify:airdrop` 15 (with its gas line), `verify:settings` 17, `verify:freshness` 16, `verify:mint-page` 17, `verify:indexer` 15, `verify:csp` 10, `verify:sources` 9 and `verify:load` 10, each with `0 failed`.

- [ ] **Step 2: The walk**

The owner's commands, run where a laptop can run them (Decision 24). Note what each showed.

1. `pnpm --filter @cobweb/web check:edge`: exit code 2 and section 10's usage line.
2. The hosted profile as k6 reads it, with no zone needed:

   ```
   k6 inspect -e PROFILE=hosted -e BASE=https://fresh.example.com -e COLLECTIONS=11155111/0x5FbDB2315678afecb367f032d93F642f64180aa3 apps/freshness/load/k6-freshness.js | python3 -c 'import json, sys; o = json.load(sys.stdin); print(o["scenarios"]["pollers"]["stages"][1]["target"], o["thresholds"]["dropped_iterations"], len(o["thresholds"]))'
   ```

   Expected: `6667 ['count<=10050'] 13`.
3. The local profile by hand against the freshness server as the owner would run it. Give the server Anvil's two settings in `apps/freshness/.env`, which git ignores:

   ```
   grep -E '^(RPC_URL_31337|FACTORY_ADDRESS_31337)=' apps/web/.env.local > apps/freshness/.env
   ```

   In a second terminal at the repo root: `pnpm --filter @cobweb/freshness dev`. Its start line reads `The freshness server listens on port 3100, serving Anvil (31337). The indexer is off: set INDEXER_DATABASE_URL to run it.` Then, with the newest collection Cobweb deployed on Anvil:

   ```
   A=$(docker exec supabase_db_cobweb psql -U postgres -t -A -c "select contract_address from public.deployments where chain_id = 31337 order by deployed_at desc limit 1")
   k6 run --no-usage-report -e PROFILE=local -e BASE=http://127.0.0.1:3100 -e COLLECTIONS=31337/$A apps/freshness/load/k6-freshness.js
   curl -s http://127.0.0.1:3100/health
   ```

   Expected: k6 exits 0 after its seven lines, among them `Edge cache: no answer came through Cloudflare.` and `Thresholds: every one passed.`, the state line about 2,000 polls with about 1,980 of about 1,980 answered 304 (nothing changes on that collection); `/health` reads `"status":"ok"` and its `requests` count the summary's polls as `state`, its 304s as `notModified`, its reads as `wallet`, with `"refused":0,"collections":1`. Stop the server (Ctrl-C) and remove `apps/freshness/.env`.
4. Slither from both directories: Step 1 ran the `contracts/` form; from the repo root, `uvx --python 3.12 --from slither-analyzer==0.11.6 slither contracts --config-file contracts/slither.config.json --triage-database contracts/slither.db.json --fail-medium` exits 0 with `0 result(s) found`, as CI's job will; then `cd contracts && forge build`.

A step that does not behave as written is a defect: fix it in a new commit (or send it back to the task that owns it) before recording the landing.

- [ ] **Step 3: MASTER_PLAN**

Contracts gains the review's decision after the shipped artifact's; Hosting gains the load run's and Cloudflare's after the health alerts; the Phase 7 status line gains this sub-project's sentences after its last ones.

In `docs/MASTER_PLAN.md`, replace:

```markdown
- **The shipped collection artifact** (decided 14 October 2026; [specs/2026-10-14-deploy.md](specs/2026-10-14-deploy.md)). The web app deploys the creation code it ships from `@cobweb/shared/collection`, generated from the Foundry build by the copy script with its keccak256 hash and the ABI, never fetched at request time. `foundry.toml` pins `evm_version`, the shared package's test asserts the shipped hash against `contracts/out`, and CI runs that test after `forge build`, so the hash the admin approves on the factory is the hash the web app sends.

```

with:

```markdown
- **The shipped collection artifact** (decided 14 October 2026; [specs/2026-10-14-deploy.md](specs/2026-10-14-deploy.md)). The web app deploys the creation code it ships from `@cobweb/shared/collection`, generated from the Foundry build by the copy script with its keccak256 hash and the ABI, never fetched at request time. `foundry.toml` pins `evm_version`, the shared package's test asserts the shipped hash against `contracts/out`, and CI runs that test after `forge build`, so the hash the admin approves on the factory is the hash the web app sends.
- **The contract review** (decided 18 October 2026; [specs/2026-10-18-load-run-contract-review-and-cloudflare.md](specs/2026-10-18-load-run-contract-review-and-cloudflare.md)). Slither, pinned at 0.11.6 and run through uv, reads both contracts with every detector; each finding is judged in `contracts/slither.triage.md`, and the judged ones are held in Slither's own triage database, `contracts/slither.db.json`, never as comments in the source, whose metadata hash would move the creation code hash. CI's `slither` job fails on any medium or high finding the database does not hold. A contract changes only for a confirmed finding (a loss, a lock or a bypass), with a test that fails before the fix, the regenerated artifacts and the new hash approved on every deployed factory. The invariant suite drives every value and ownership path under thirteen invariants on CI's default campaign; a `deep` profile (1,000 runs of depth 1,000) is run by hand, never in CI. The October 2026 record: [reference/contract-review-2026-10.md](reference/contract-review-2026-10.md).

```

In `docs/MASTER_PLAN.md`, replace:

```markdown
- **Health alerts** (decided 17 October 2026; [specs/2026-10-17-production-hardening.md](specs/2026-10-17-production-hardening.md)). `/health` answers `degraded` with one sentence per threshold crossed, over the last 5 minutes for failures, and stays 200 so Railway's deploy check never refuses a deployment during an RPC outage. A monitor keys on `"status":"ok"` every minute and alerts after two misses, with the body's `problems`; it is the owner's.

```

with:

```markdown
- **Health alerts** (decided 17 October 2026; [specs/2026-10-17-production-hardening.md](specs/2026-10-17-production-hardening.md)). `/health` answers `degraded` with one sentence per threshold crossed, over the last 5 minutes for failures, and stays 200 so Railway's deploy check never refuses a deployment during an RPC outage. A monitor keys on `"status":"ok"` every minute and alerts after two misses, with the body's `problems`; it is the owner's.
- **The load run** (decided 18 October 2026; [specs/2026-10-18-load-run-contract-review-and-cloudflare.md](specs/2026-10-18-load-run-contract-review-and-cloudflare.md)). k6 drives the freshness server's state and wallet endpoints at the pollers' rate (`POLLERS` divided by `INTERVAL_S` polls a second) with the page's own request headers, each VU keeping a collection's last ETag as one browser does: a local profile `verify:load` runs against the server in process on Anvil with a phase starting mid-run, and a hosted profile the owner runs behind Cloudflare at 20,000 pollers every 3 s and 5,000 wallet reads in a minute. Its thresholds: the state route's 95th percentile under 200 ms locally and 500 ms at the edge, the wallet route's under 400 ms and 1,000 ms, under 1% failed, at least 90% of the polls carrying an ETag answered 304, no answer degraded or showing a phase live before its start, at most 1% of the planned iterations dropped, and at the edge an `Age` of at most 10 s, no challenge and at most 2 state requests a second at the origin for the busiest collection. `/health` counts the origin's answers over the last 60 s (`requests`), which the hosted run reads every 5 s.
- **Cloudflare in front** (decided 18 October 2026; [specs/2026-10-18-load-run-contract-review-and-cloudflare.md](specs/2026-10-18-load-run-contract-review-and-cloudflare.md)). One zone on the Free plan holds the app domain, proxied to Vercel with its answers passed through unchanged and nothing injected (Rocket Loader, Email Address Obfuscation, Web Analytics' beacon, Bot Fight Mode, Zaraz, Speed Brain, Cloudflare Fonts and Managed Transforms off), and the freshness domain, whose `/v1/` answers the edge caches by the origin's own `Cache-Control` (a state 1 s, a wallet 5 s, a refusal 10 s), the query string ignored and every colo filled from one upper tier; `/health` and the app's pages are never cached. TLS is Full (strict) with Always Use HTTPS; HSTS is Vercel's when it sends one, else Cloudflare's at six months without preload. No rate limiting rule. The owner sets the zone by hand from [reference/cloudflare-setup.md](reference/cloudflare-setup.md), and `check:edge` proves it from outside in 13 checks, after every change to the zone.

```

In `docs/MASTER_PLAN.md`, replace:

```markdown

**Status:** in progress. Production hardening in code (first sub-project of three: production hardening in code, then the hosted and launch sub-projects, each with its own spec, plan and run) landed on 18 October 2026; see [specs/2026-10-17-production-hardening.md](specs/2026-10-17-production-hardening.md). What exists: the Content-Security-Policy, set by the proxy with a fresh nonce for every page, each rendered per request (`/[slug]` included, its document still read through the 60 s cache under its tag), so a script runs only on its response's nonce and what `'strict-dynamic'` admits from it; `connect-src`, `media-src` and `frame-src` listing the origins the app reads from its own settings, each launch chain's public RPC and the wallet connectors' hosts of the pinned versions; images from any https host; `frame-ancestors 'none'` on every page and API route; `CSP_MODE` (enforce, report-only or off; unset is enforce off Vercel and report-only on it, where the framing block is `X-Frame-Options` alone, since Next copies the proxy's response headers into the request it renders and would read no nonce from an enforced framing policy); `/api/csp-report`, which reads both report formats through a schema of allow-listed fields and logs one JSON line per violation, at most 100 a minute an instance; Cloudflare Turnstile's browser check on wallet sign-in when `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is set, its token verified by Supabase Auth before the signature; `profiles.draft_cap` (20) with a trigger that refuses a wallet's next collection that is not deployed, which the create action words first; local sessions signed with an ES256 key in `supabase/signing_keys.json` and verified against the key set with no call to the auth server per page; the daily source sweep (`/api/cron/source-sweep`, dry until `SOURCE_SWEEP_DELETE=1`) deleting a collection's original art files 90 days after its deploy and its final render, thumbnails, rendered output and rows kept, with the Art notice and `/api/uploads/[id]` serving thumbnails alone once the originals are gone; `cobweb_indexer`, the login role the freshness server's indexer connects as over postgres.js from `INDEXER_DATABASE_URL`, with verified TLS to any database off the machine, in place of the service role key; `/health` answering `degraded` with one sentence per threshold crossed (no good read for 60 s, a head 120 s old or 10 failed reads in 5 minutes on a chain; no good index pass for 120 s, collections behind for 900 s or 5 failed passes in 5 minutes on its indexer), still 200; and the three items earlier phases owed: `record_upload` for the service role alone, so the size a row records is the one the upload action read from storage, and the daily upload sweep (`/api/cron/upload-sweep`, dry until `UPLOAD_SWEEP_DELETE=1`) of art files no row records and mint page files no page names; `verify:local` with 407 checks, `pnpm --filter @cobweb/web verify:csp` with 10, `verify:sources` with 9 and `verify:sweep` with 11. Known: `/_global-error` stays Next's prerendered page, so if the root layout itself throws, that page shows without its scripts under enforce; every page is a function call per view, and the mint page's HTML is no longer cached at Vercel's edge (its database reads are unchanged); inline styles stay allowed; the wallet connectors' hosts are those of the pinned versions, and an upgrade can add one, which report-only or the walk shows; a revoked signing key is trusted for up to 10 minutes per server process; the cap counts paid collections that are not deployed; Turnstile lists the production hostnames, so previews cannot sign in; after the purge, original-size views show the pattern while thumbnails and the rendered art stay; the source sweep takes 20 collections a run and the upload sweep lists both buckets whole each day; the lag threshold can trip on a quiet chain with a hot collection; report lines live as long as Vercel keeps logs. Owed by the owner, in this order (the spec's section 12): `supabase db push` for both migrations; the role's password, then `INDEXER_DATABASE_URL` on Railway's `freshness` (the session pooler, whose certificate is publicly trusted; a direct connection to the database host needs Supabase's CA file on the service, named by `INDEXER_DATABASE_SSL_CA`), then `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` removed; the rotation to an ES256 key; Turnstile's site key on Vercel, then captcha on in Supabase; `CSP_MODE` unset on Production and Preview, the Vercel Toolbar off for Preview, a week of report lines read, then `CSP_MODE=enforce`; `SOURCE_SWEEP_DELETE=1` and `UPLOAD_SWEEP_DELETE=1` once their dry runs list what is expected; a monitor on `/health`'s `"status":"ok"`. Next: the hosted and launch sub-projects.

```

with:

```markdown

**Status:** in progress. Production hardening in code (first sub-project of three: production hardening in code, then the hosted and launch sub-projects, each with its own spec, plan and run) landed on 18 October 2026; see [specs/2026-10-17-production-hardening.md](specs/2026-10-17-production-hardening.md). What exists: the Content-Security-Policy, set by the proxy with a fresh nonce for every page, each rendered per request (`/[slug]` included, its document still read through the 60 s cache under its tag), so a script runs only on its response's nonce and what `'strict-dynamic'` admits from it; `connect-src`, `media-src` and `frame-src` listing the origins the app reads from its own settings, each launch chain's public RPC and the wallet connectors' hosts of the pinned versions; images from any https host; `frame-ancestors 'none'` on every page and API route; `CSP_MODE` (enforce, report-only or off; unset is enforce off Vercel and report-only on it, where the framing block is `X-Frame-Options` alone, since Next copies the proxy's response headers into the request it renders and would read no nonce from an enforced framing policy); `/api/csp-report`, which reads both report formats through a schema of allow-listed fields and logs one JSON line per violation, at most 100 a minute an instance; Cloudflare Turnstile's browser check on wallet sign-in when `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is set, its token verified by Supabase Auth before the signature; `profiles.draft_cap` (20) with a trigger that refuses a wallet's next collection that is not deployed, which the create action words first; local sessions signed with an ES256 key in `supabase/signing_keys.json` and verified against the key set with no call to the auth server per page; the daily source sweep (`/api/cron/source-sweep`, dry until `SOURCE_SWEEP_DELETE=1`) deleting a collection's original art files 90 days after its deploy and its final render, thumbnails, rendered output and rows kept, with the Art notice and `/api/uploads/[id]` serving thumbnails alone once the originals are gone; `cobweb_indexer`, the login role the freshness server's indexer connects as over postgres.js from `INDEXER_DATABASE_URL`, with verified TLS to any database off the machine, in place of the service role key; `/health` answering `degraded` with one sentence per threshold crossed (no good read for 60 s, a head 120 s old or 10 failed reads in 5 minutes on a chain; no good index pass for 120 s, collections behind for 900 s or 5 failed passes in 5 minutes on its indexer), still 200; and the three items earlier phases owed: `record_upload` for the service role alone, so the size a row records is the one the upload action read from storage, and the daily upload sweep (`/api/cron/upload-sweep`, dry until `UPLOAD_SWEEP_DELETE=1`) of art files no row records and mint page files no page names; `verify:local` with 407 checks, `pnpm --filter @cobweb/web verify:csp` with 10, `verify:sources` with 9 and `verify:sweep` with 11. Known: `/_global-error` stays Next's prerendered page, so if the root layout itself throws, that page shows without its scripts under enforce; every page is a function call per view, and the mint page's HTML is no longer cached at Vercel's edge (its database reads are unchanged); inline styles stay allowed; the wallet connectors' hosts are those of the pinned versions, and an upgrade can add one, which report-only or the walk shows; a revoked signing key is trusted for up to 10 minutes per server process; the cap counts paid collections that are not deployed; Turnstile lists the production hostnames, so previews cannot sign in; after the purge, original-size views show the pattern while thumbnails and the rendered art stay; the source sweep takes 20 collections a run and the upload sweep lists both buckets whole each day; the lag threshold can trip on a quiet chain with a hot collection; report lines live as long as Vercel keeps logs. Owed by the owner, in this order (the spec's section 12): `supabase db push` for both migrations; the role's password, then `INDEXER_DATABASE_URL` on Railway's `freshness` (the session pooler, whose certificate is publicly trusted; a direct connection to the database host needs Supabase's CA file on the service, named by `INDEXER_DATABASE_SSL_CA`), then `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` removed; the rotation to an ES256 key; Turnstile's site key on Vercel, then captcha on in Supabase; `CSP_MODE` unset on Production and Preview, the Vercel Toolbar off for Preview, a week of report lines read, then `CSP_MODE=enforce`; `SOURCE_SWEEP_DELETE=1` and `UPLOAD_SWEEP_DELETE=1` once their dry runs list what is expected; a monitor on `/health`'s `"status":"ok"`. Next: the hosted and launch sub-projects. Load run, contract review and Cloudflare in front (second sub-project of three) landed on <date>; see [specs/2026-10-18-load-run-contract-review-and-cloudflare.md](specs/2026-10-18-load-run-contract-review-and-cloudflare.md). What exists: `/health`'s `requests`, the origin's answers over the last 60 s (state answers and their 304s, wallet answers, refusals, the collections asked for and the busiest one's count); the k6 load run in `apps/freshness/load/`, its local and hosted profiles driven at the pollers' rate with the page's own request headers and judged by the spec's thresholds; `pnpm --filter @cobweb/web verify:load` with 10 checks (k6's local profile against the freshness server in process on Anvil, Public starting mid-run, k6's counts against `/health`'s); `pnpm --filter @cobweb/web check:edge` with 13 checks, each judged by a pure function tested on answers shaped as Cloudflare's; Slither 0.11.6 over both contracts, its 17 findings (2 high, 1 medium, 3 low, 9 informational, 2 optimization) judged in `contracts/slither.triage.md`, none confirmed, all held in `contracts/slither.db.json`, and CI's `slither` job failing on any medium or high finding nobody has judged; the invariant suite's 31 actions over a 200-token collection and the factory under thirteen invariants, each failing on a mutation of the contracts that breaks what it holds, with a `deep` profile run once (1,000 runs of depth 1,000, every invariant passing); the record [reference/contract-review-2026-10.md](reference/contract-review-2026-10.md); and the checklist [reference/cloudflare-setup.md](reference/cloudflare-setup.md). No contract changed. Known: one machine reaches one or two colos, so the hosted run proves the edge where it lands; before the mainnet factories the run polls a Sepolia collection, whose wallet reads reach that chain's provider; `/health`'s counts are one process's; the triage database keys a finding that cites a statement by its lines, so an edit near it opens it again in CI, and it records the absolute path of the checkout that wrote it; nothing proves `stale-if-error` before an origin fails; until Railway's generated domain is removed the origin answers around the edge; a Cloudflare outage or a wrong setting takes the mint page's live data with it until `NEXT_PUBLIC_FRESHNESS_URL` points at Railway's domain again and the app is redeployed; creators sign in on the Vercel domain until the third sub-project adds the app domain to the sign-in origins; the profiles are proven on k6 1.2.3. Owed by the owner, in this order (the spec's section 13): the hosted freshness service on this code, serving a Sepolia collection; the zone; TLS; the app domain; the freshness domain, then Railway's generated domain removed; the two Cache Rules, Smart Tiered Caching, the Browser Cache TTL and Always Online off; the list that stays off; security as it is; Turnstile's hostname; `NEXT_PUBLIC_FRESHNESS_URL` and a redeploy; `check:edge` at 13 passed; the report week's positive control on the app domain; the rehearsal with one Railway restart, then the full hosted run; the `slither` job green after the first push; the external look. Next: the launch sub-project.

```

- [ ] **Step 4: The dated notes**

In `docs/specs/2026-10-16-freshness-server.md`, replace:

```markdown

### 6.10 What the mint page relies on
```

with:

```markdown

> **<date>:** `/health` gains `requests`, the origin's answers over the last 60 s ([2026-10-18-load-run-contract-review-and-cloudflare.md](2026-10-18-load-run-contract-review-and-cloudflare.md), section 4): state answers of 200 or 304 (HEAD as GET) and the 304s among them, wallet answers of 200 and refusals of 400 or above on any route, with the number of collections asked for and the busiest one's count, kept per whole second and naming no address. Preflights and `/health` itself are not counted, and `status` and `problems` do not read it.

### 6.10 What the mint page relies on
```

In `docs/specs/2026-10-16-freshness-server.md`, replace:

```markdown

Owed to the second sub-project: the database and the public read path (`mint_pages`, the `mint-page` bucket,
```

with:

```markdown

> **<date>:** The Cloudflare rule landed as a checklist the owner applies by hand ([../reference/cloudflare-setup.md](../reference/cloudflare-setup.md)) and `check:edge`, which proves the zone from outside in 13 checks, among them the 1 s edge, the weak ETags kept, the 304s from the edge's copy and the browser's directives never passing it ([2026-10-18-load-run-contract-review-and-cloudflare.md](2026-10-18-load-run-contract-review-and-cloudflare.md), sections 8 and 9). No rate limit (its decision 19): `/health`'s `refused` count shows a spray, and the Known "No origin rate limit" stands. The k6 run landed with two profiles, a local one `verify:load` runs on Anvil and a hosted one the owner runs behind Cloudflare; it judges staleness as the page does, by `Age` and `degraded`, not by `readAt` (its reconciliation 4).

Owed to the second sub-project: the database and the public read path (`mint_pages`, the `mint-page` bucket,
```

- [ ] **Step 5: The acceptance boxes and the landing note**

In section 14 of `docs/specs/2026-10-18-load-run-contract-review-and-cloudflare.md`, change each `- [ ]` to `- [x]` whose criterion Steps 1 and 2 confirmed (all twelve when everything passed). Then, after the list and before `## 15. Reconciliations and points to rule`, add one paragraph that starts `Checked on <date> on Anvil, local Supabase, the freshness server in process and by hand, and Foundry 1.4.0-nightly:` and records: the root checks with the web, freshness and shared counts; the build; forge's 100 tests, the deep run's seconds and the fifteen mutations; Slither's 17 findings, none confirmed, and its 0 results with the database from both directories; each verify script with its count, `verify:load`'s 10 among them; `check:edge`'s smoke run (check 1 failing with its hint on the Vercel domain, which answered `DEPLOYMENT_NOT_FOUND` while planning) and the walk as it behaved; the departures from the spec's letter (this plan's Decisions 7, 18 and 22, and the judges of Decision 12); the owner's steps still owed (section 13's sixteen, the first push showing the `slither` job among them); and any defect found with the commit that fixed it.

- [ ] **Step 6: CLAUDE.md, the contracts README and the example setting**

In `CLAUDE.md`, replace:

```markdown
cd contracts && forge test                # contracts
(umask 077 && echo '[]' > supabase/signing_keys.json) && supabase gen signing-key --algorithm ES256 --yes   # once, before the first supabase start: the local ES256 session key in supabase/signing_keys.json (gitignored)
```

with:

```markdown
cd contracts && forge test                # contracts
cd contracts && uvx --python 3.12 --from slither-analyzer==0.11.6 slither . --config-file slither.config.json   # Slither with the triage database; brew install uv once
cd contracts && FOUNDRY_PROFILE=deep forge test   # the deep invariant run, about 12 minutes
(umask 077 && echo '[]' > supabase/signing_keys.json) && supabase gen signing-key --algorithm ES256 --yes   # once, before the first supabase start: the local ES256 session key in supabase/signing_keys.json (gitignored)
```

In `CLAUDE.md`, replace:

```markdown
pnpm --filter @cobweb/web verify:indexer   # the indexer in the freshness server against local Supabase and Anvil: mints, owners, airdrops and withdrawals once each, a replay, a restart and a backfill, the Overview, Airdrop and the state body
pnpm --filter @cobweb/web verify:csp   # the policy on a sample-mode production build: a nonce on every page and script, the origins, report-only, the report endpoint
```

with:

```markdown
pnpm --filter @cobweb/web verify:indexer   # the indexer in the freshness server against local Supabase and Anvil: mints, owners, airdrops and withdrawals once each, a replay, a restart and a backfill, the Overview, Airdrop and the state body
pnpm --filter @cobweb/web verify:load   # k6's local profile against the freshness server in process and Anvil: polls and wallet reads under load, the 304s, liveness at a start, /health's request counts
pnpm --filter @cobweb/web check:edge --app https://<app domain> --freshness https://<freshness domain> --collection <chain id>/<address>   # Cloudflare in front, read from outside (docs/reference/cloudflare-setup.md)
k6 run -e PROFILE=hosted -e BASE=https://<freshness domain> -e COLLECTIONS=<chain id>/<address> apps/freshness/load/k6-freshness.js   # the owner's load run behind Cloudflare
pnpm --filter @cobweb/web verify:csp   # the policy on a sample-mode production build: a nonce on every page and script, the origins, report-only, the report endpoint
```

In `contracts/README.md`, replace:

```markdown

| Suite                         | What it covers                                                                                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `test/CobwebFactory.t.sol`    | Deployment, address prediction, identical bytecode, admin controls, art payment                                                                        |
| `test/CobwebCollection.t.sol` | Liveness, public and allowlist minting, supply, groups, mint on behalf, delegated mint, airdrops, withdrawals, fees, metadata, views, transfer locking |
| `test/Invariants.t.sol`       | Random sequences of mints, airdrops, withdrawals and setting changes; checks that the balance always equals what is owed and supply limits always hold |

Current figures: 92 tests passing, about 95% line coverage on the collection and 97% on the factory. `CobwebCollection` is 17.8 KB of runtime code against the 24 KB limit. Deploying a collection through the factory costs about 4.5M gas.

```

with:

````markdown

| Suite                         | What it covers                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/CobwebFactory.t.sol`    | Deployment, address prediction, identical bytecode, admin controls, art payment                                                                                                                                                                                                                                                                                               |
| `test/CobwebCollection.t.sol` | Liveness, public and allowlist minting, supply, groups, mint on behalf, delegated mint, airdrops, withdrawals, fees, metadata, views, transfer locking                                                                                                                                                                                                                        |
| `test/Invariants.t.sol`       | Thirty-one actions over a 200-token collection and the factory: mints of each kind, a refund held for a contract that rejects ether, airdrops, burns, every withdrawal, fee, treasury and admin changes, phase edits with time moving, whitelist chunks, transfers and art payments; thirteen invariants for fee custody and proceeds, the admins, phase bounds and ownership |

Current figures: 100 tests passing, about 96% line coverage on the collection and 97% on the factory. `CobwebCollection` is 17.8 KB of runtime code against the 24 KB limit. Deploying a collection through the factory costs about 4.5M gas.

**Slither.** `brew install uv` once, then from `contracts/`:

```
uvx --python 3.12 --from slither-analyzer==0.11.6 slither . --config-file slither.config.json
```

It reads `slither.db.json`, the triage database, so it prints only what nobody has judged; `slither.triage.md` gives every finding's verdict and reason. CI's `slither` job runs the same analyzer and fails on a medium or high finding the database does not hold. A finding that cites a statement is keyed by its source lines, so an edit near it opens it again: judge it in that change (add `--triage-mode` to hold it, then its row) or fix it. No `slither-disable` comment goes into `src/`, since it would move the creation code hash.

**The deep invariant run.** `FOUNDRY_PROFILE=deep forge test` runs the invariant suite at 1,000 runs of depth 1,000 and the fuzz test at 10,000 runs, by hand and never in CI, in about 12 minutes on a 12-core laptop. The October 2026 review's record is [docs/reference/contract-review-2026-10.md](../docs/reference/contract-review-2026-10.md).

````

In `apps/web/.env.example`, replace:

```
# The freshness server's origin, public: the mint page polls it from the browser. Local: http://127.0.0.1:3100
# with `pnpm --filter @cobweb/freshness dev`. Read at build time; rebuild after changing it.
NEXT_PUBLIC_FRESHNESS_URL=
```

with:

```
# The freshness server's origin, public: the mint page polls it from the browser. Local: http://127.0.0.1:3100
# with `pnpm --filter @cobweb/freshness dev`. Read at build time; rebuild after changing it. Production:
# https://<freshness domain>, behind Cloudflare (docs/reference/cloudflare-setup.md).
NEXT_PUBLIC_FRESHNESS_URL=
```

- [ ] **Step 7: Commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
pnpm exec prettier --write CLAUDE.md contracts/README.md
git add docs/MASTER_PLAN.md docs/specs/2026-10-18-load-run-contract-review-and-cloudflare.md docs/specs/2026-10-16-freshness-server.md CLAUDE.md contracts/README.md apps/web/.env.example
git commit -m "$(cat <<'EOF'
Record the load run, the contract review and Cloudflare in front in MASTER_PLAN with their decisions, in their spec and the freshness server spec's notes, CLAUDE.md, the contracts README and the web app's example settings

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: `git show --stat HEAD` lists the three docs, `CLAUDE.md`, the README and `apps/web/.env.example` only; `git diff HEAD~1 -- docs/PLAN.md` prints nothing.

---

## Self-review

**Spec coverage.** Sections 1 to 3 (the goal, the 24 decisions, the scope): Tasks 1 to 8 in section 3's order and Task 9 the controller's (Decision 1). Section 4 (the origin's counts): Task 1, with the window and the counting rule of Decisions 2 and 3 and the re-exports of Decision 4. Section 5.1 (the files and parameters): Task 2, `profile.js` and `k6-freshness.js`, with the helpers of Decision 5. Section 5.2 (the scenarios): `optionsOf`, with the details of Decision 8. Section 5.3 (requests and readings): `poll`, `ask`, `watch`, `edgeOf` and `livenessOf` (Decisions 7 and 9). Section 5.4 (thresholds): `optionsOf`, both profiles tested whole. Section 5.5 (the summary): `summaryLines` and `handleSummary` (Decision 10). Section 5.6 (the hosted run): the checklist's step 11 in Task 8 and MASTER_PLAN's owner list in Task 9. Section 6 (`verify:load`): Task 3 (Decision 11). Section 7.1 (Slither): Task 5 Steps 1 to 5 (Decision 14). Section 7.2 (triage): Task 5 Steps 4 and 6 (Decisions 15 and 16). Section 7.3 (the CI job): Task 5 Step 7 (Decision 17). Section 7.4 (a contract change): no finding was confirmed, so no change; Task 6 Step 8 names the path a failure takes. Section 7.5 (the invariant suite): Task 6 (Decisions 18 to 21). Section 7.6 (the deep profile): Task 6 Steps 6 and 8 (Decision 22). Section 7.7 (the record): Task 7. Section 8 (`check:edge`): Task 4 (Decisions 12, 13 and 23). Section 9 (Cloudflare's configuration): Task 8. Section 10 (copy): `parametersOf`'s four sentences, `notOkSentenceOf` and `summaryLines` in Task 2, `verify:load`'s sentence in Task 3, the usage and FAIL lines in Task 4, the verdicts in Task 5, the positive control in Task 8. Section 11 (testing): the unit tests of Tasks 1, 2 and 4, `verify:load` in Task 3, the smoke run in Task 4, the contracts' checks in Tasks 5 and 6, the whole check list in Task 9. Section 12 (documentation): Tasks 7, 8 and 9. Section 13 (the owner's steps): the checklist (Task 8), MASTER_PLAN's owner list and the landing note (Task 9). Section 14 (acceptance): Task 9 Step 5. Section 15's reconciliations: 1 (no rate limit) the checklist's section 7 and the freshness spec's note; 2 (no `CDN-Cache-Control`) the checklist's check 4 paragraph; 3 (what `check:edge` confirms of the old rule) checks 3 to 5; 4 (staleness by `Age` and `degraded`) `state_age_s` and `degraded_answers` in Task 2 and the freshness spec's note; 5 (the legacy port) Tasks 2 and 3; 6 (`stale-if-error` and the 10 s `Age`) the hosted threshold `state_age_s` at 10; 7 (the deep profile's numbers) Task 6 Step 6; 8 (the state route's 500 ms) `optionsOf`. The rulings: 1 every threshold kept (Task 2); 2 the deep profile documented and never in CI (Tasks 6 and 9); 3 Sepolia first (Task 8, Task 9's owner list); 4 one machine first, then split (Task 8); 5 Railway's domain removed (Task 8); 6 the app domain proxied, `check:edge` rerun after every change (Tasks 8 and 9); 7 HSTS from Vercel when present (Tasks 4 and 8, Decision 23); 8 the email address read through `--slug` (Task 8); 9 one restart during the rehearsal (Task 8); 10 the suite beyond the ruled list (Task 6).

**Where this plan departs from the spec's letter.** `livenessOf` reads the body's `flag` where the spec wrote `activeFlag` (Decision 7); `check:edge`'s judgements are each a pure function beside the spec's readers (Decision 12); the invariant suite's collection has 200 tokens, since a 1,000-token one never reached its supply in either campaign (Decision 18); invariant 1 sums the held refunds of every account the handlers reach (Decision 20); the deep run's time reads "about 12 minutes" in `CLAUDE.md` and the README, where the spec wrote "tens of minutes" (Decision 22). Details the spec leaves open: the window's edge and the counting order (Decisions 2 and 3), the extra re-export (4), the profile's helpers, sentence and numbers (5, 6, 8 to 10), `verify:load`'s readings (11), the request shapes (13), Slither's pinned versions and confirmed flags (14 to 17), the handler's choices and its flags (19 and 20), the mutations (21), the smoke run's Expected (23), the walk (24) and the docs' order (25).

**Placeholder scan.** No step says "add error handling" or "similar to Task N"; every code step shows a whole file or an exact anchor with its replacement. The values filled at run time are each defined where they are used: Task 5's `<date>` and `<commit>`, Task 7's `<commit>` and `<seconds>`, Task 9's `<date>`, its acceptance boxes and its landing paragraph, and the walk's collection address, which only the local database knows.

**Type consistency.** `REQUEST_WINDOW_S`, `RequestsHealth`, `requestCounts`, `HealthBody.requests`, `Route`, `answerOf`, `count`, `STATE_CACHE`, `WALLET_CACHE`, `PROFILES`, `EDGE_COUNTERS`, `parametersOf`, `optionsOf`, `statePathOf`, `walletPathOf`, `walletOf`, `livenessOf`, `headerOf`, `edgeOf`, `notOkSentenceOf`, `summaryLines`, `setup`, `poll`, `ask`, `watch`, `handleSummary`, the metric names `state_answers`, `state_not_modified`, `early_open`, `scheduled_open_reads`, `scheduled_waiting_reads`, `degraded_answers`, `state_age_s`, `wallet_answers`, `edge_hit` to `edge_none`, `edge_mitigated`, `health_problems`, `origin_busiest_per_s`, `origin_state_per_s`, `origin_wallet_windows_per_min` and `health_counts_missing`, the five check names, `K6Summary`, `EdgeAnswer`, `EdgeArgs`, `INJECTED_MARKS`, `EDGE_CHECKS`, `edgeArgsOf`, `viaCloudflare`, `cacheStatusOf`, `ageOf`, `isWeakEtag`, `scriptNonces`, `pagePolicyOf`, `nonceOf`, `directiveOf`, `injectedIn`, the thirteen `judge*` functions, `EtherRejecter.claimTo`, `Accounts`, `Reach`, `FactoryHandler`, `CollectionHandler` and the thirteen invariant names are spelled the same in every task that uses them, and each exported name is exported once.

**Review Focus.** Five lines, each with its test in the owning task: an address spray (Task 1, `server.test.ts`), the reload poll let through (Task 4, check 6), the state held past its second (Task 4, check 4), a build naming an earlier freshness origin (Task 4, check 11) and the second a phase turns live (Task 6, `invariant_liveOnlyByFlagOrStart` with `warp`). Each was checked against a mutation of the rule it guards: counting a state route's answer under its collection before reading its status failed the spray test alone (`1 failed | 7 passed`); accepting REVALIDATED for the reload poll failed check 6's test alone; dropping the `Age` bound, and dropping the trip back to the origin, each failed check 4's test alone; reading only that `connect-src` lists something failed check 11's test alone (`1 failed | 22 passed` each); and a start honoured a second late passed 64 runs with random time moves alone and failed `invariant_liveOnlyByFlagOrStart` with the moves to the next start. Each mutation was restored and the suites passed again.

**Checked while planning.** The code was written first in a scratch worktree of the repository at `2402684` (its own branch, one commit per task, rebuilt at the end so that each commit holds its task's final files), and every code block here is taken from those commits by a script; each anchored edit is generated from its commit's diff and was checked by applying it to the parent's file, its old text found exactly once and the edits together rebuilding the commit's file. The counts at those commits: the freshness package 236 tests in 18 files before, 244 in 19 after Task 1 and 261 in 20 after Task 2; the web app 1021 in 107 before and 1044 in 108 after Task 4; shared 105 in 14, dna 60, render 117 and worker 282 throughout; forge 92 tests before and 100 after Task 6; `pnpm typecheck`, `lint` and `test` pass at every commit. Tool facts read while planning: k6 1.2.3 keeps the legacy JSON summary (`metrics` with `values` and `thresholds`, the checks by name in `root_group.checks`), reports a thresholded metric with no sample at count 0 with its threshold passed, runs `handleSummary` after `exec.test.abort` (`test aborted: <sentence>`, exit code 108), prints a sentence thrown at init as `Error: <sentence>` (exit code 107), hands header names canonicalized (`Etag`, `Cf-Cache-Status`) and escapes `<` and `>` in `k6 inspect`'s JSON; a constant arrival rate of 100 a second for 20 s ran 2,001 polls, so `verify:load` judges counts from below and compares `/health` with k6's own (Decisions 5, 9 to 11). Slither 0.11.6 found the same 17 ids from `contracts/` and from the root form, ran `forge clean` before its own build, and reads only each database entry's id and description; `crytic/slither-action` v0.4.2's entrypoint maps `fail-on: medium` to `--fail-medium`, appends `slither-args` and guesses solc 0.8.0 from `lib/`'s pragmas (Decisions 14 to 17). Forge 1.4.0-nightly's default campaign is 256 runs of depth 500 with `show_metrics` on, the deep profile inherits the compiler settings, and a persisted counterexample is replayed on the next run (Decisions 21 and 22). Measured while planning: a run of 1,000 calls on a 1,000-token collection minted 470 to 650 tokens and every sampled run on the 200-token collection sold out (Decision 18); the landing counts of Decision 19 over ten seeded runs each; the default campaign in about 80 s with every action near 4,100 calls and no revert; the deep run in 690 s, 1,000,000 calls per invariant, each of 31 actions between 31,782 and 32,808 calls of each campaign, no revert, all 100 tests passing; `forge coverage` at 96.41% of the collection's lines and 97.33% of the factory's (Decision 25); the fifteen mutations as Task 6 Step 5 lists them, in about four minutes. `verify:load` passed 10 in 35 s at Task 3's commit, and read `3 passed, 7 failed` with no k6 on the PATH; `check:edge` refused its usage twice with exit code 2, and its smoke run printed thirteen lines and exited 1, the Vercel production domain answering `DEPLOYMENT_NOT_FOUND` on every path (Decision 23); the walk's local run against a freshness server started by hand passed every threshold, `/health` then counting exactly the summary's 2,001 state answers, its 1,981 304s and its 501 wallet answers. The whole check list ran once at the final commit, in about 15 minutes: `pnpm typecheck`, `lint` and `test` (web 1044 in 108 files, freshness 261 in 20, shared 105 in 14, dna 60, render 117, worker 282) and `format:check` pass; the build ran in 25 s, `/[slug]` dynamic and `/icon.svg` alone static; `forge fmt --check`, `forge build --sizes` and `forge test` pass with 100 tests in 64 s; Slither reads 0 results at the medium threshold with the database; the shared package passed 105 after the rebuild; and `verify:local` 407, `verify:chain` 12, `verify:storage` 15, `verify:sweep` 11, `verify:render` 22, `verify:deploy` 15, `verify:phases` 20, `verify:whitelist` 18, `verify:airdrop` 15 (its gas line reading 26,880,045), `verify:settings` 17, `verify:freshness` 16, `verify:mint-page` 17, `verify:indexer` 15, `verify:csp` 10, `verify:sources` 9 and `verify:load` 10, each with `0 failed`. Then the plan itself was applied to a second worktree at `2402684` by a script that performs each "Create", "Replace the whole of" and "In ..., replace: ... with:" literally and refuses an anchor found other than once: every one of its 42 directives (14 files created, 1 replaced whole and 27 anchored edits) landed with its anchor found exactly once, and after each task the files it touched equaled that task's scratch commit, the fills of Tasks 5 and 7 aside; the replayed tree then differed from the last scratch commit only in those fill lines and in `contracts/slither.db.json`, which Slither writes in Task 5. Not run while planning: anything hosted (the zone, Railway's and Vercel's settings, the hosted k6 run and its rehearsal, the `slither` job's first run on GitHub) and the external look. The scratch worktree read the local stack through a copy of `supabase/signing_keys.json` and the contract libraries without their git metadata; both left with it.

**Note after the run (20 October 2026).** The figures above are the planner's; the run changed them: Slither reads 22 findings from 15 detectors with `include_paths` (not 17 with `filter_paths`, Decisions 8, 14 to 17); the mutations are seventeen (Decision 21); an eighth of the warps go to the start and an eighth to the second before it (Decision 19 and Review Focus 5); `verify:load` leaves the collection about 25 blocks later and takes about 35 s (Task 3); the deep run takes about 11 minutes (Decision 22); the freshness server sends `Cloudflare-CDN-Cache-Control` and `check:edge` accepts `UPDATING` (Decision 13, Task 4); the Railway domain's removal and the way back follow the spec's section 16. The record `docs/reference/contract-review-2026-10.md` and the spec's section 16 hold the run's values.
