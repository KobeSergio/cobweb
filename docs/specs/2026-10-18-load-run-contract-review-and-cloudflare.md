# The load run, the contract review and Cloudflare in front: specification

Phase 7, second sub-project of three (production hardening in code, landed on 18 October 2026; this one; then the
launch sub-project), each with its own spec, plan and run. Product decisions:
[../MASTER_PLAN.md](../MASTER_PLAN.md#decisions) and the Phase 7 bullets this run closes, "Port the k6 test; run 20,000
pollers and 5,000 quota reads in a minute against the Cloudflare endpoint." and "Contract review: Slither, invariant
run, and an external look if budget allows.", with Phase 6's "Cloudflare in front: 1 s cache per collection, 5 s per
wallet." The source plan: [../PLAN.md](../PLAN.md), its mint day diagram (the edge holding a state 1 s and a wallet 5 s,
the origin seeing about one request a second per collection) and "Before the first real launch: port the k6 load test
from the Suits backend and run it against the Cloudflare-fronted endpoint at 20k concurrent pollers and 5k quota reads
in one minute." The controller ruled the scope, the k6 profiles, the review's tools and record, the Cloudflare
configuration and the copy before this spec; the decisions that carry a ruling say "decided", and where the letter of
one could not work, this spec keeps its intent, writes the reading it takes and lists the point in section 15. The
rest are this spec's, each with its reason. Rules 1, 3, 7 and 8 bind it: liveness stays the contract's, and the load
run counts any answer that shows a phase live before its start; the mint page still polls the freshness server and no
RPC, now through the edge; the legacy k6 script is read, never copied; a contract changes only for a confirmed finding,
and the triage never touches the source, since solc's metadata hash would move the creation code hash with it. What it
consumes: [2026-10-16-freshness-server.md](2026-10-16-freshness-server.md) decisions 12, 15 and 17 and sections 6.7,
6.9, 6.10 and 12 (the cache headers, the wallet windows, `/health`, what the page relies on, the Cloudflare rule and the
k6 run it owes); [2026-10-16-mint-page-live-data.md](2026-10-16-mint-page-live-data.md) decisions 10 and 11 and section
7.1 (the page's `no-cache` and `reload` polls and its `Age` rule);
[2026-10-17-production-hardening.md](2026-10-17-production-hardening.md) decisions 2 and 14 and sections 12 and 15 (the
policy's headers, the report week and its positive control, the captcha block's single home);
[2026-10-14-deploy.md](2026-10-14-deploy.md) section 5.3 (the creation code hash the factory approves);
[../reference/the-suits-mint-analysis.md](../reference/the-suits-mint-analysis.md) (the mint model the invariants hold);
[../legacy/market-mint-and-data.md](../legacy/market-mint-and-data.md) section 7 (the legacy k6 script and what its port
must change). Out, for the third sub-project: the mainnet factory deploys and their verification, the fee values, the
secrets rotation, the hosted Supabase settings (among them the site URL and redirect URLs the custom domain needs) and
the launch list; and the external review, which is the owner's decision.

## 1. Goal

Before the first real launch, Cobweb holds three proofs that mint day's read path and its contracts stand. The load
run: a k6 script, ported from the legacy one's shape to the freshness server's two endpoints, runs a local profile in
`verify:load` against the server on Anvil and a hosted profile the owner runs against the freshness domain behind
Cloudflare, at 20,000 pollers every 3 s and 5,000 wallet reads in a minute, with state answers under 500 ms at the 95th
percentile, under 1% failed, none older than the page accepts, and the origin, by its own count on `/health`, seeing
about one request a second per collection. The contract review: Slither runs over both contracts with every finding
triaged in the repository and a CI job that fails on any new finding of medium or high impact; the invariant suite
drives every value and ownership path (mints of each kind, airdrops, burns, withdrawals, phase edits, admin fee changes,
whitelist chunks) under invariants for fee custody, proceeds, phase bounds and ownership, once deeply; a record in
`docs/reference/` says what was found and done. Cloudflare in front: a checklist sets the zone by hand (the freshness
domain's answers cached by the origin's own headers, the app's pages passed through unchanged with nothing injected),
and `check:edge` proves it from outside in 13 checks. Nothing in the mint page's polls or the freshness server's cache
headers changes unless a check shows a defect.

## 2. Decisions

1. **Scope (decided).** Decision: three deliverables in code and one hosted checklist. (a) The load run:
   `apps/freshness/load/k6-freshness.js` with its pure `profile.js`, two profiles, `verify:load` for the local one and
   `/health`'s request counts for the origin's side of the hosted one. (b) The contract review: Slither with its config,
   triage file and database; a CI job; the extended invariant suite; a `deep` Foundry profile run once; the record in
   `docs/reference/contract-review-2026-10.md`. (c) Cloudflare in front, the code side: `check:edge` and the checklist
   `docs/reference/cloudflare-setup.md`. Docs, unit tests and the owner's steps (section 13) complete it. Out: as the
   header lists, and a rate limiting rule (decision 19). Considered: three sub-projects (the three meet in one hosted
   sequence, the zone first, then `check:edge`, then the hosted run, so one checklist orders them).
2. **The k6 port (decided).** Decision: one script in plain JavaScript on k6's own modules (`k6/http`, `k6/metrics`,
   `k6/execution`), its profile chosen by `-e PROFILE=local|hosted`, against the state and wallet endpoints and
   `/health`. From the legacy script it keeps only the shape, a failed rate and a 95th percentile as thresholds and a
   check per route; its backend targets, its writes and its key (line 22) are left behind, and nothing of it is copied.
   Considered: a k6 cloud run (costs money, not needed); a Vitest-driven load (not a load tool).
3. **Pollers as their rate.** Decision: both profiles drive the pollers on k6's arrival-rate executors at POLLERS divided
   by INTERVAL_S polls a second (100 locally; 6,667 hosted, ramped over a minute and held for two), each poll made by a
   VU that keeps the last ETag per collection, as one browser's cache does; the wallet reads also run on a rate (25 a
   second locally; 5,000 in the hosted minute). The edge and the origin meet the same requests whether 20,000 clients
   or 3,000 VUs send them. Considered: one VU per poller sleeping 3 s, the plan's literal shape (k6 holds about a
   megabyte or more per VU, so 20,000 would need tens of gigabytes on one machine); a distributed run (k6 cloud or
   k6-operator: money or a cluster).
4. **Requests shaped as the page sends them.** Decision: a VU's first poll of a collection, with no ETag held, carries
   what the page's `cache: 'reload'` fetch adds (`Cache-Control: no-cache`, `Pragma: no-cache`), and every later one
   what its `cache: 'no-cache'` fetch adds (`Cache-Control: max-age=0`) with the held ETag in `If-None-Match`; wallet
   reads carry `Cache-Control: max-age=0`; `check:edge` checks 3, 5, 6 and 8 send the same. So the edge is proven
   against the requests it will meet: an edge that honoured a browser's request directives would pass every poll to the
   origin. Considered: plain GETs (they would prove a cache the page never meets).
5. **Thresholds (decided in part).** Decision: section 5.4. The ruled bounds are the state route's 95th percentile
   (under 200 ms locally, under 500 ms at the edge) and the failed rate (under 1%). This spec adds, in both profiles, at
   least 90% of the polls that carried an ETag answered 304, no answer reading `degraded`, no answer showing a phase
   live early and `/health` ok at every read; the wallet route's own 95th percentile (under 400 ms locally, under 1,000
   ms hosted), since a wallet read waits up to one 200 ms window and a multicall by design and, at the edge, each
   wallet's first read is a miss; and for the hosted run an `Age` of at most 10 s (the page's own limit), no answer
   refused or challenged by the edge, at most 1% of the planned iterations dropped (else the machine set the pace, not
   the edge) and at most 2 state requests a second at the origin for the busiest collection, about 1 expected (section
   15, point 1). Considered: the legacy 5% and 2,000 ms (written for a backend with no edge in front); one percentile for
   both routes.
6. **The origin's count on `/health`.** Decision: `/health` gains `requests`, the origin's answers over the last 60 s by
   route (section 4); the hosted run reads it every 5 s and judges the busiest collection's count divided by 60, and
   `verify:load` proves the counts exact against k6's own. It names no address. This is the cheapest proof the ruling
   allows: one small module, readable by the run and provable on a laptop. Considered: Railway's HTTP logs (counted by
   hand per path in a dashboard; nothing the run reads or a verify proves); counting in k6 (k6 sees only the edge's
   answers).
7. **`verify:load` (decided).** Decision: the script deploys one collection on Anvil through the factory (simulated,
   then the simulated request sent), opens Holders, starts the freshness server in process, schedules Public about 10 s
   ahead with a block mined every second, runs k6's local profile as a child process for 20 s and judges its exit code,
   its JSON summary and then `/health`'s counts: 10 checks (section 6). The scheduled start puts a phase boundary inside
   the run, so the run also shows liveness turning under load, and never early. Considered: k6 against
   `pnpm --filter @cobweb/freshness dev` (a second process to start, configure and stop, where `startFreshness` in
   process is how `verify:freshness` and `verify:indexer` already run it); judging k6's text output (the JSON summary is
   k6's machine-readable form).
8. **Slither, run locally (decided).** Decision: from `contracts/`, `uvx --python 3.12 --from slither-analyzer==` with
   the pinned version, then `slither . --config-file slither.config.json`; the plan pins one release (the newest on PyPI
   when it runs) and writes it into that command, the CI job and the record; `brew install uv` once on the machine. The
   config filters `lib/`, `test/` and `script/` and excludes no detector. Considered: `pipx run slither-analyzer` (it
   runs on the machine's Python, Homebrew's 3.14 here, which the analyzer's dependencies may not support yet; uv fetches
   3.12 for the run); Mythril or Echidna (not now); a CI-only Slither (the triage needs a local run).
9. **Triage in Slither's database, never in the source (decided in part).** Decision: `contracts/slither.triage.md`
   names every finding with its verdict (`fixed`, `accepted` or `false positive`) and its reason; the `accepted` and
   `false positive` ones are recorded in `contracts/slither.db.json`, the triage database Slither's `--triage-mode`
   writes and later runs read to hide them, so CI fails only on what nobody has judged. No `slither-disable` comment goes
   into `src/`: solc appends a hash of the metadata, which carries each source file's hash and which `foundry.toml`
   keeps, so a comment moves the creation code hash the factories approve. Considered: `slither-disable-next-line`
   comments (that hash); `detectors_to_exclude` in the config (it would hide a detector's future findings everywhere,
   and the ruling keeps every detector, those such as `immutable-states` that ask for the immutables rule 8 rules out
   included).
10. **The CI job (decided).** Decision: a `slither` job in `.github/workflows/ci.yml` on `crytic/slither-action` at its
    newest release tag, with the pinned analyzer, the config and the database, failing on a medium or high finding the
    database does not hold; low and informational findings print and pass. Considered: Slither through uv in the
    contracts job (one toolchain for both runs; the ruling names the action, which brings its own toolchain and fail
    threshold); failing on low findings (the low detectors flag what this code does by design, such as comparing
    `block.timestamp` with a scheduled start, so each would need a database entry before any push passed).
11. **A contract change only for a confirmed finding (decided).** Decision: a finding a reader confirms (a real loss,
    lock or bypass, whatever its impact) is fixed in the contract with a test that fails before the fix, and the change
    then follows the deploy spec's section 5.3 (section 7.4); the record and the landing note name the old and the new
    creation code hash, and the owner approves the new one on every factory already deployed (section 13, step 15).
    Considered: fixing low and informational findings (each change moves the creation code hash and asks for an
    approval for no confirmed risk).
12. **The invariant suite (decided; its actions and invariants set here).** Decision: `test/Invariants.t.sol` keeps one
    collection handler and gains a factory handler. The collection handler covers airdrops, burns (airdrops to the dead
    address), every withdrawal (proceeds, platform fees, held refunds), phase edits (registration, price, allocation,
    open, close, close all, schedules with time moving), admin fee changes (the collection's own, a stranger's refused
    attempt, the factory's defaults), whitelist chunks (up to 50 addresses, and a chunk written again), and also mints on
    behalf, delegated mints and transfers between holders, since each moves value or ownership the invariants must hold
    over (section 15, point 10). Thirteen invariants in four groups (section 7.5). Considered: Echidna or Medusa for the
    same properties (decision 8 keeps the tools to Foundry and Slither); one file per handler (the handlers share the
    actors, the treasuries and the ghost totals).
13. **The deep profile.** Decision: `[profile.deep.invariant]` with `runs = 1000`, `depth = 1000`, `fail_on_revert =
    false` and `show_metrics = true`, and `[profile.deep.fuzz]` with `runs = 10000`, run as `FOUNDRY_PROFILE=deep forge
    test`. Foundry's default campaign, which `foundry.toml` leaves as it is and CI runs on every push, is 256 runs of
    depth 500; the deep one makes about a million calls, about eight times as many, in sequences twice as long, so more
    runs reach the states near a 1,000-token collection's supply and its full allocations, where the bounds are tested.
    Considered: 2,000 runs of depth 200 (a depth below the default 500 explores shorter sequences than every push already
    does; section 15, point 2).
14. **The record (decided).** Decision: `docs/reference/contract-review-2026-10.md` (section 7.7): what was reviewed, the
    tools, Slither's findings with a pointer to the triage, a reading of six areas, the invariants with both runs'
    results, any change with both hashes, and the external look, owed as the owner's decision with this record as its
    brief. Considered: the triage in the record alone (CI reads the database, and the triage file beside it keeps each
    reason next to the code it judges).
15. **The zone by hand (decided).** Decision: the owner sets the zone in Cloudflare's dashboard from
    `docs/reference/cloudflare-setup.md`, which section 9 specifies with each rule's expression, and `check:edge` proves
    the result. Considered: Terraform or the Cloudflare API for the zone (one-time setup, not worth a tool).
16. **What the edge caches (decided in part).** Decision: one Cache Rule makes `<freshness domain>/v1/*` eligible, with
    the edge TTL taken from the origin's `Cache-Control` (`s-maxage` 1 s for a state, 5 s for a wallet, 10 s for a
    refusal) and the browser's left to the origin; a second bypasses `/health`; the first rule's cache key ignores the
    query string, as the origin does, so a query cannot send polls past the edge; Smart Tiered Cache fills every colo from
    one upper tier, so the origin's count stays about one a second per collection however many colos serve a launch.
    Nothing on the app domain is cached but Next's static files: each page carries its own response's nonce, and a cached
    page would hand every visitor the same one. Considered: a Cloudflare Worker for the state cache (the origin's headers
    already say what to cache); Cloudflare's default (it caches by file extension, so the extensionless JSON would never
    be cached); the default cache key (a random query per poll reaches the origin at the viewers' rate); no tiering (each
    colo serving a collection revalidates it every second).
17. **The app domain proxied, its answers unchanged (decided).** Decision: `<app domain>` is a proxied CNAME to Vercel.
    Cloudflare passes the app's `Content-Security-Policy` (or, during the report week,
    `Content-Security-Policy-Report-Only`), `Reporting-Endpoints`, `X-Frame-Options`, `X-Content-Type-Options` and
    `Referrer-Policy` through unchanged and injects nothing: Rocket Loader, Email Address Obfuscation, Web Analytics'
    automatic beacon, Bot Fight Mode with its JavaScript detections, Zaraz, Speed Brain, Cloudflare Fonts and Managed
    Transforms stay off (section 9.5), since each injects a script the nonce policy would block or rewrites what the app
    sends. A managed challenge page is
    Cloudflare's own page and is fine. The report week's positive control reruns on `<app domain>`. Considered: the app
    domain DNS only, with Cloudflare in front of the freshness domain alone (section 15, point 6).
18. **TLS and transport (decided in part).** Decision: SSL/TLS Full (strict), each origin's certificate issued before its
    record is proxied (section 9.2); Always Use HTTPS; TLS 1.2 at least. `Strict-Transport-Security` comes from Vercel's
    own header when Vercel sends one on the custom domain, else from Cloudflare's HSTS at six months without preload,
    which `check:edge` check 13 decides (section 15, point 7). Considered: Full or Flexible (the edge would accept an
    origin certificate it cannot verify, or speak plain http to the origin); Cloudflare's HSTS from the start (two
    sources for one header, and a preload is slow to undo).
19. **No rate limiting rule (decided).** Decision: none in this sub-project. Supabase's own limits cover sign-in, the CSP
    report route has its limiter, and the freshness server answers from memory, its refusals held 10 s at the edge; the
    `refused` count on `/health` now shows a spray. Considered: a free-plan rate limiting rule on `/v1/` against address
    spraying, which the freshness spec's section 12 owed (reconciliation 1); a limit per client address there would also
    meet the hosted run and viewers who share one carrier address.
20. **`check:edge` (decided).** Decision: `pnpm --filter @cobweb/web check:edge --app <url> --freshness <url>
    --collection <chain id>/<address>`, with `--slug <link>` optional, which the owner runs once the zone is set and
    after any change to it: 13 checks with PASS and FAIL lines in the verify scripts' form, each failure naming the
    setting to look at (section 8). Its judgements are pure functions in `apps/web/src/lib/edge/edge-checks.ts`,
    unit-tested on answers shaped as Cloudflare's, since no run can reach a zone before the owner makes one. Considered:
    curl lines in the checklist (each answer judged by eye); reading the zone's settings through Cloudflare's API (a
    token for what the answers already prove).
21. **The headers and the polls stay (decided).** Decision: nothing changes the mint page's polls or the freshness
    server's cache headers unless `check:edge` or `verify:load` shows a defect; then the fix is in scope and named in the
    landing note. One is named now: if check 4 shows the edge ignoring `s-maxage`, the state answer adds
    `Cloudflare-CDN-Cache-Control: max-age=1, stale-while-revalidate=1, stale-if-error=60` and the wallet answer
    `Cloudflare-CDN-Cache-Control: max-age=5`, a header Cloudflare reads before `Cache-Control` and no browser reads.
    Considered: moving the edge-only directives into `CDN-Cache-Control` now (Phase 6's Known listed it; the page's
    `no-cache` polls already keep a browser from serving a stale copy, so nothing needs it unless check 4 does;
    reconciliation 2).
22. **What waits for the third sub-project (decided).** Decision: this sub-project serves the app on `<app domain>` but
    moves no sign-in: Supabase accepts a wallet's signature only from the origins its auth settings list, which are the
    third sub-project's, on a `supabase config push` that keeps `[remotes.cobweb.auth.captcha]` uncommented (the hosted
    captcha switch's only home) and is followed by the no-token probe; until then creators sign in on the Vercel domain
    while visitors read and mint on either. The hosted run needs a served chain with a deployed collection: before the
    mainnet factories, a testnet's (section 15, point 3). Considered: adding `<app domain>` to the sign-in origins here (a
    push belongs with the hosted Supabase settings, and every push must carry the captcha block).
23. **Copy (decided).** Decision: section 10, verbatim; no em or en dash; the product is Cobweb; PASS and FAIL lines in
    the verify scripts' form, `PASS <n>. <subject>: <what held>` and `FAIL <n>. <subject>: <what held>: <what
    happened>`, then `<p> passed, <f> failed`. Considered: none (ruled).
24. **Docs and tests.** Decision: sections 11 and 12.

## 3. Scope and tasks

In: as decision 1. The plan's tasks, in order: (1) `/health`'s request counts (`requests.ts` and its test, `health.ts`,
`server.ts` with its two re-exports, `server.test.ts`); (2) the k6 script (`profile.js` and its test,
`k6-freshness.js`); (3) `verify:load` with its package script, run on Anvil; (4) `check:edge`
(`lib/edge/edge-checks.ts` and its test, `scripts/check-edge.ts`, the package script) and its smoke run: with `--app`
and `--freshness` both set to the Vercel production domain, which is not behind Cloudflare, and any `--collection`, it
prints all 13 lines, fails check 1 with its hint and exits 1; (5) Slither: `uv`, the config, the local run, the triage
file and database, the CI job, `.gitignore`, and any fix decision 11 allows; (6) the invariant suite,
`EtherRejecter.claimTo`, the deep profile and the deep run; (7) the record; (8) the checklist; (9) docs and the full
check list. Tasks 5 to 7 run in that order, so the deep run reads the contracts as they will ship.

Not in it: a change to the mint page or to the freshness server's cache headers (decision 21); a Cloudflare Worker, a
rate limiting rule or an API token; `verify:load` or `check:edge` in CI (Anvil, k6 and a zone are local or hosted);
Echidna, Mythril or a paid review; anything of the third sub-project.

## 4. The origin's request counts (`apps/freshness`)

### 4.1 `requests.ts` (new, pure)

```ts
export const REQUEST_WINDOW_S = 60
export type RequestsHealth = { windowS: number; state: number; notModified: number; wallet: number; refused: number
  collections: number; busiest: number }
export function requestCounts(windowS?: number): {
  state(now: number, collection: string, notModified: boolean): void
  wallet(now: number): void
  refused(now: number): void
  health(now: number): RequestsHealth
}
```

- Counts are kept per whole second (`Math.floor(now / 1000)`) for the last `windowS` seconds, the current one
  included; `health` sums those inside the window.
- `state` counts a state answer of 200 or 304 (HEAD as GET) under its collection's key, `<chain id>:<lowercase
  address>`; `notModified` counts the 304s among them. `collections` is the number of keys with a state answer in the
  window and `busiest` the most any one key had; a key leaves once its last second leaves the window, so memory follows
  the collections asked for in the last minute and no more.
- `wallet` counts wallet answers of 200; `refused` counts every answer of 400 or above on any route. Preflights and
  `/health` itself are not counted.

### 4.2 `/health` and the server

- `health.ts`: `HealthBody` gains `requests: RequestsHealth`, after `wallet`. `status`, `problems` and `HEALTH_LIMITS`
  do not read it and are unchanged.
- `server.ts`: one `requestCounts()` per server; each answer is counted as it is written, by its route and status as
  section 4.1 says; `health()` adds `requests: counts.health(Date.now())`. It re-exports `STATE_CACHE` and
  `WALLET_CACHE` from `routes.ts`, which `check:edge` compares with what the edge passes on.
- An answer reads, for example, `"requests":{"windowS":60,"state":61,"notModified":58,"wallet":0,"refused":0,
  "collections":1,"busiest":61}`.
- Tests: `requests.test.ts` (new): an empty counter; counts inside the window and gone after it; one second's answers
  summed; the 304s within `state`; two collections, `collections` 2 and the busiest one's count; a key dropped after
  the window; `wallet` and `refused`. `server.test.ts` (changed): `/health` carries `requests`; a 404 for an unknown path
  and a 400 for a malformed address count as refused; a preflight and `/health` itself are not counted. `verify:load`
  check 9 proves the state, 304 and wallet counts end to end.

## 5. The k6 script (`apps/freshness/load/`)

### 5.1 Files and parameters

- `profile.js` (new, pure, plain JavaScript): the parameters, the options, the paths, the wallets, the reading of a
  state body and the summary's lines. It imports nothing from k6, so Vitest runs `profile.test.ts` beside it.
- `k6-freshness.js` (new): the k6 entry, with its metrics, `setup`, the three scenario functions and `handleSummary`. It
  opens with `/* global __ENV */`, so the root ESLint config needs no change.
- Both are formatted by Prettier and linted by `apps/freshness`'s `eslint .`; neither is in the package's
  `tsconfig.json`, which includes `src` alone.

```js
// profile.js
export const PROFILES                          // { local, hosted }: the defaults of the table below
export function parametersOf(env)              // { profile, base, collections: [{ chainId, address }], pollers,
                                               //   intervalS, wallets, summaryFile }; throws section 10's sentence
export function optionsOf(parameters)          // k6's options: scenarios, thresholds, summaryTrendStats
export function statePathOf(collection)        // /v1/state/<chain id>/<lowercase address>
export function walletPathOf(collection, wallet)
export function walletOf(runStartMs, n)        // 0x, the run's start in 12 hex digits, n in 28; lowercase
export function livenessOf(body)               // { early, openBySchedule, waiting }, counts over body.groups
export function summaryLines(data, parameters) // section 10's lines
// k6-freshness.js
export const options                           // optionsOf(parametersOf(__ENV))
export function setup()
export function poll()
export function ask()
export function watch()
export function handleSummary(data)
```

The parameters, each passed as `-e NAME=value`:

| Name           | Local                  | Hosted                       | Meaning                                                   |
| -------------- | ---------------------- | ---------------------------- | --------------------------------------------------------- |
| `PROFILE`      | `local`                | `hosted`                     | Required                                                  |
| `BASE`         | set by `verify:load`   | `https://<freshness domain>` | The freshness origin: http or https, no path              |
| `COLLECTIONS`  | set by `verify:load`   | the owner's                  | `<chain id>/<address>`, one or more, separated by commas  |
| `POLLERS`      | 100                    | 20000                        | Pollers                                                   |
| `INTERVAL_S`   | 1                      | 3                            | A poller's interval in seconds                            |
| `WALLETS`      | 1500                   | 5000                         | Wallet reads a minute                                     |
| `SUMMARY_FILE` | set by `verify:load`   | optional                     | Where `handleSummary` writes k6's JSON summary            |

### 5.2 Scenarios

| Scenario  | Function | Local                                                                              | Hosted                                                                                                                         |
| --------- | -------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `pollers` | `poll`   | `constant-arrival-rate`, 100 a second for 20 s, 20 VUs allocated, at most 100      | `ramping-arrival-rate` from 0 to 6,667 a second over 60 s, then 6,667 a second for 120 s, 1,000 VUs allocated, at most 3,000 |
| `wallets` | `ask`    | `constant-arrival-rate`, 1,500 a minute for 20 s (500 reads), 10 VUs, at most 50   | `constant-arrival-rate`, 5,000 a minute for 60 s from the 60th second, 100 VUs, at most 500                                    |
| `health`  | `watch`  | `constant-vus`, 1 VU for 20 s                                                      | `constant-vus`, 1 VU for 180 s                                                                                                 |

A poll's collection is its VU's number modulo the collections listed. An ask's wallet is `walletOf` of the scenario's
start time and its iteration in the test, so no two asks of one run, or of two runs, share a wallet. `watch` reads
`/health` every 5 s. `setup` reads `/health` once and, when it is not ok, aborts the run with section 10's sentence.

### 5.3 Requests and what each answer adds

- Every request is tagged with its route (`state`, `wallet` or `health`) and named by it, so a run's 5,000 wallet URLs
  make one series.
- A poll sends decision 4's headers. A 200 or a 304 counts in `state_answers` and passes the check "state answered 200
  or 304". When it carried an ETag, `state_not_modified` records whether it answered 304, and a 304 must carry the ETag
  it was asked with ("a 304 carries the ETag it was asked with"). A 200's ETag replaces the one held; its body must be
  the asked collection's state ("a 200 body is the asked collection's state"), and `livenessOf` adds to `early_open`,
  `scheduled_open_reads` and `scheduled_waiting_reads`, while `degraded: true` counts in `degraded_answers`. `Age` (0
  without it) goes to `state_age_s`.
- An ask passes "wallet answered 200" and counts in `wallet_answers`.
- Every answer counts in one of `edge_hit`, `edge_miss`, `edge_expired`, `edge_revalidated`, `edge_updating`,
  `edge_stale`, `edge_dynamic`, `edge_bypass` and `edge_other` by its `cf-cache-status`, or in `edge_none` without one;
  an answer with a `cf-mitigated` header, or a 403 or 429 of HTML, counts in `edge_mitigated`.
- `watch` passes "/health answered 200 and ok" and records `health_problems` (the number of `problems`),
  `origin_busiest_per_s` (`requests.busiest` divided by `requests.windowS`), `origin_state_per_s` and, from the change
  of `wallet.windows` between two reads, `origin_wallet_windows_per_min`; a body without `requests` counts in
  `health_counts_missing`.
- `livenessOf`: a group is early when it reads `active` with `activeFlag` false and a `startTimestamp` of 0 or above
  the body's `blockTimestamp`; open by schedule when it reads `active` with the flag false and a start at or below
  `blockTimestamp`; waiting when it reads inactive with the flag false and a start above `blockTimestamp`.

### 5.4 Thresholds

| Metric                            | Local                | Hosted               |
| --------------------------------- | -------------------- | -------------------- |
| `http_req_failed`                 | rate under 1%        | rate under 1%        |
| `http_req_duration{route:state}`  | p(95) under 200 ms   | p(95) under 500 ms   |
| `http_req_duration{route:wallet}` | p(95) under 400 ms   | p(95) under 1,000 ms |
| `checks`                          | rate above 99%       | rate above 99%       |
| `state_not_modified`              | rate above 90%       | rate above 90%       |
| `degraded_answers`                | count 0              | count 0              |
| `early_open`                      | count 0              | count 0              |
| `health_problems`                 | max 0                | max 0                |
| `dropped_iterations`              | at most 1% planned   | at most 1% planned   |
| `state_age_s`                     |                      | max 10               |
| `edge_mitigated`                  |                      | count 0              |
| `health_counts_missing`           |                      | count 0              |
| `origin_busiest_per_s`            |                      | max 2                |

The planned iterations are the polls and asks the scenarios schedule: 2,500 locally, so at most 25 dropped; about
1,005,050 hosted at the defaults, so at most 10,050. `optionsOf` computes the bound from the parameters, so a rehearsal
at lower numbers gets its own. `summaryTrendStats` adds `p(99)` and `count` to k6's defaults.

### 5.5 The summary

`handleSummary` writes k6's JSON summary to `SUMMARY_FILE` when it is set and section 10's lines to standard output, in
place of k6's text summary (keeping that would mean importing k6's summary module from the network).

### 5.6 The hosted run

The owner's (section 13, step 13), once `check:edge` passes, from the repository root, on a machine with 8 cores and
16 GB of memory on a steady line, with k6 installed:

```
k6 run --no-usage-report -e PROFILE=hosted -e BASE=https://<freshness domain> \
  -e COLLECTIONS=<chain id>/<address> -e SUMMARY_FILE=$HOME/k6-hosted.json apps/freshness/load/k6-freshness.js
```

A rehearsal comes first, with `-e POLLERS=2000 -e WALLETS=500` added, which also proves the machine; then the full
run, about three and a half minutes. The collections are deployed Cobweb collections on a chain the hosted freshness
service serves, one to three, the pollers shared among them.

## 6. `verify:load` (`apps/web/scripts/verify-load.ts`)

### 6.1 Setup

`"verify:load": "node --conditions=react-server --import ./scripts/resolve-ts.mjs scripts/verify-load.ts"`. It needs
Anvil with the factory (`chain:local`) and k6 on the PATH, and no Supabase: the indexer stays off. Through
`chain-fixture.ts` it refuses a non-local endpoint, prints no key and writes its PASS and FAIL lines. In order: it
deploys one collection from a fresh key straight through the factory as `verify:freshness` does (Public and Holders,
both closed), opens Holders, starts the server with `startFreshness({ port: 0, host: '127.0.0.1', chainIds: [31337] })`,
schedules Public at the latest block's time plus 10 s, starts a ticker that mines one block a second, makes one state
read, then runs `k6 run --quiet --no-color --no-usage-report` on `apps/freshness/load/k6-freshness.js` with
`PROFILE=local`, `BASE`, `COLLECTIONS` and `SUMMARY_FILE` in a temporary folder, relaying k6's summary lines indented
under its own. It judges k6's exit code, the summary's `metrics` (values and thresholds) and `/health`. The cleanup
stops the ticker and the server and removes the folder; the collection stays on Anvil.

### 6.2 The checks

1. "setup: k6 answers its version, Anvil answers as 31337 and the factory approves the shipped creation code hash"
2. "server: with Holders open and Public scheduled 10 s ahead, the collection's first state read answers 200 with
   Public scheduled and inactive, and /health reads ok, counting that read alone"
3. "run: k6 runs the local profile for 20 s, 100 state polls and 25 wallet reads a second, and exits 0 with every
   threshold passed"
4. "state: at least 1,900 of the 2,000 planned state polls answered 200 or 304, with p95 under 200 ms and under 1%
   failed"
5. "304: at least 90% of the polls that carried an ETag answered 304, each with the ETag it carried"
6. "wallet: at least 475 of the 500 planned wallet reads answered 200, with p95 under 400 ms"
7. "liveness under load: polls before the start read Public scheduled and inactive, polls after it read Public active,
   and no poll read a group active by neither its flag nor a reached start"
8. "degraded: no answer read degraded, and every /health read k6 made during the run was ok with no problem"
9. "origin counts: /health counts, over the last minute, exactly the run's state answers plus the setup's read, its
   304s and its wallet answers, all on one collection, which is the busiest, and no refusal"
10. "stop: the ticker stops, close() ends the server and its port refuses a connection"

Check 1's failure for a missing binary carries section 10's sentence. The run takes about 30 s.

## 7. The contract review

### 7.1 Slither

- Once on the machine: `brew install uv`.
- From `contracts/` (decided): `uvx --python 3.12 --from slither-analyzer==` with the pinned version, then `slither .
  --config-file slither.config.json`, which reads `slither.db.json` beside it; with `--json -` for the list the triage
  reads. crytic-compile builds through Foundry with the solc 0.8.30 `foundry.toml` pins. The plan confirms each flag on
  the pinned version, and that a finding's id is the same from this run and from the CI job's (target `contracts` from
  the repository root); if it is not, both use the root form, `slither contracts --config-file
  contracts/slither.config.json --triage-database contracts/slither.db.json` from the repository root, so the database
  written locally hides the same findings in CI.
- `contracts/slither.config.json` (new):

```json
{
  "filter_paths": "(lib/|test/|script/)"
}
```

- `.gitignore` gains `contracts/crytic-export/`, for what crytic-compile may leave.

### 7.2 Triage

- `contracts/slither.triage.md` (new): the analyzer's version, the command, the commit and the date of the run; then a
  table `| Id | Detector | Impact | Confidence | Where | Verdict | Reason |` with one row per finding of high, medium or
  low impact and one row per detector for informational and optimization findings, with their count; the id is the
  first 12 hex digits of Slither's, and Where is `Contract.function` with the file and lines.
- Verdicts: `fixed` (confirmed and changed under decision 11: the commit and the new creation code hash); `accepted`
  (the pattern is there by design: why); `false positive` (the detector's premise does not hold: why).
- `contracts/slither.db.json` (new): the `accepted` and `false positive` findings, written by Slither's triage mode from
  the run of section 7.1, then formatted by Prettier, since `pnpm format:check` reads `contracts/` apart from `lib`,
  `out` and `cache`; Slither reads it whatever its layout. A finding that cites a statement is keyed by its source
  lines, so an edit near it re-opens it, and it is triaged again in the change that moved it.

### 7.3 The CI job

A third job, `slither`, beside `node` and `contracts` and independent of them: `actions/checkout@v4` with submodules,
then `crytic/slither-action` at its newest release tag with `target: contracts`, `slither-version` the pinned release,
`slither-config: contracts/slither.config.json`, the database named through `slither-args`, and `fail-on: medium`. The
action compiles `contracts/` with Foundry itself. A medium or high finding the database does not hold fails the job;
low and informational findings print and pass. No push happens in this sub-project, so the owner's first push shows the
job green (section 13, step 14); a red first run is fixed in a follow-up commit, never by loosening the threshold.

### 7.4 A contract change

Only for a confirmed finding (decision 11), in its own commit: the fix and a test that fails without it; `forge fmt`,
`forge build --sizes` (the collection's runtime code under 24 KB); `pnpm --filter @cobweb/shared abi` and the three
generated files committed (`factory-abi.ts`, `collection.ts`, `collection-abi.ts`); `pnpm --filter @cobweb/shared test`
asserting the new hash against `contracts/out`; Anvil deployed again with `chain:local` and every verify script that
deploys a collection run again; the triage row `fixed`; the record and the landing note naming the old and the new
creation code hash. The approval on a deployed factory is the owner's (section 13, step 15).

### 7.5 The invariant suite (`contracts/test/Invariants.t.sol`, `contracts/test/utils/BaseTest.sol`)

The actors: five accounts, the creator, the payout addresses the handler sets, two treasuries, `EtherRejecter` (which
gains `claimTo(CobwebCollection collection, address to)`, claiming its held refunds through `withdrawPendingBalanceTo`)
and the dead address; `setUp` etches the registry mock at its address. Both handlers keep ghost totals: what was
charged, withdrawn and received; the refunds held and claimed; the tokens airdropped and burned; each account's public
mints; the last claimed count per group and address; the admin's last fees; the art paid and withdrawn; the admins; and
a flag for each thing that must never happen (a stranger's fee change landing, a mint in a group that was not live, a
cap or quota passed, a claimed count going down). Expected reverts are caught in the handlers.

The collection handler's actions (amounts bounded as written):

| Action                                  | What it does                                                                                                   |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `mintPublic(actor, amount, overpay)`    | An account mints 1 to 10 from Public, paying the quote and up to 1 ether more                                  |
| `mintFromList(actor, group, amount)`    | An account mints 1 to 10 from a registered whitelist group on its quota                                        |
| `mintOnBehalf(payer, receiver, group, amount)` | A payer mints for a receiver's cap or quota while the switch is on                                      |
| `delegateMint(caller, vault, group, amount)`   | A caller the vault delegated to, through the registry mock, mints on the vault's cap or quota            |
| `mintRefused(amount, overpay)`          | `EtherRejecter` mints from Public with an excess its refund cannot reach, so the excess is held for it         |
| `claimHeld(to)`                         | `EtherRejecter` claims its held refunds to an account                                                          |
| `airdrop(recipients, amounts)`          | The creator airdrops 1 to 10 tokens to up to three accounts, paying the fee and an excess                      |
| `burn(amount)`                          | The creator airdrops 1 to 10 tokens to the dead address, paying the fee                                        |
| `withdrawProceeds(byPayout)`            | The owner or the payout address withdraws the creator's balance                                                |
| `withdrawFees(caller)`                  | Anyone sends the platform balance to the factory's treasury                                                    |
| `setTreasury(which)`                    | The admin moves the factory's treasury between the two treasuries                                              |
| `setPayout(actor)`                      | The creator points the payout address at an account                                                            |
| `setFees(flat, bps, airdropFee)`        | The admin sets the collection's fees, up or down                                                               |
| `setFeesAsStranger(caller, ...)`        | The creator or an account tries to, and must be refused                                                        |
| `setFactoryFees(flat, bps, airdropFee)` | The admin changes the factory's defaults, which the deployed collection must not take                          |
| `registerGroup(price, supply, start)`   | The creator registers the next group id, 2 to 6                                                                |
| `setPrice`, `setStatus`, `setGroupSupply` | As today, for any registered group                                                                           |
| `schedule(group, offset)`               | The creator schedules a start 1 to 3,600 s ahead, or clears it with 0                                          |
| `setAll(open)`                          | The creator opens or closes every group at once                                                                |
| `warp(seconds)`                         | Time moves 1 to 3,600 s, with a block                                                                          |
| `writeChunk(group, size, quota, again)` | The creator writes quotas of 0 to 20 for 1 to 50 addresses (the accounts first), or writes the last chunk again |
| `setPublicCap`, `setMintOnBehalf(open)`, `delegate(vault, caller, on)` | The public cap, the on-behalf switch and the registry mock's delegation               |
| `transfer(token, to)`                   | A token an account holds moves to another account                                                              |

The factory handler's actions: `payForArt(payer, job, amount)` (job ids 1 to 20, a repeat refused), `withdrawArt()` (the
admin), and `grantAdmin(who)` and `revokeAdmin(who)` among three accounts (the last admin's revoke refused).

The invariants:

- Fee custody and proceeds:
  1. `invariant_balanceEqualsWhatIsOwed` (extended): the collection's balance equals `creatorBalance` plus
     `platformBalance` plus `EtherRejecter`'s held refunds, which equal the excesses credited less those claimed; every
     mint took exactly its quote, its excess returned or held.
  2. `invariant_platformFeesReachOnlyTheTreasury`: the fees charged on mints and airdrops equal `platformBalance` plus
     the fees withdrawn, and the two treasuries together received exactly the fees withdrawn.
  3. `invariant_proceedsReachOnlyThePayout`: the proceeds charged equal `creatorBalance` plus the proceeds withdrawn,
     and the payout addresses received exactly the proceeds withdrawn, whoever asked.
  4. `invariant_feesChangeOnlyByTheAdmin`: `fees()` equals the admin's last setting (before any, the factory's defaults
     at the deploy), no stranger's attempt landed, and no change of the factory's defaults reached it.
  5. `invariant_artPaymentsHeldOrPaidToTheTreasury`: the factory's balance equals the art paid less the art withdrawn,
     and the treasury received exactly what was withdrawn.
- The admins:
  6. `invariant_anAdminAlwaysRemains`: at least one of the three accounts holds the admin role, and `isAdmin` agrees
     with the handler's record for each.
- Phase bounds:
  7. `invariant_supplyNeverExceedsMax` (as today).
  8. `invariant_groupMintsNeverExceedAllocation`: for every registered group.
  9. `invariant_allocationsFitInCollection`: over every registered group.
  10. `invariant_liveOnlyByFlagOrStart`: for every registered group, `mintGroupActive` equals its flag, or a non-zero
      start that `block.timestamp` has reached; `collectionState()` reports the same `active`; a group closed since its
      last schedule has no start; no mint landed in a group that was not live when it was sent.
  11. `invariant_capsAndQuotasHeld`: no mint passed the public cap or a quota as they stood when it landed, and no
      claimed count ever went down, a chunk written again included.
- Ownership counts:
  12. `invariant_everyTokenCameFromAGroupOrAnAirdrop`: `totalMinted` equals every registered group's mints plus every
      airdropped token, burns included.
  13. `invariant_ownershipAddsUp`: the balances of every account the handlers reach sum to `totalSupply`, which equals
      `totalMinted`; the dead address holds exactly the tokens burned; each account's `publicMints` equals the public
      mints counted against it.

### 7.6 The deep profile (`contracts/foundry.toml`)

```toml
[profile.deep.invariant]
runs = 1000
depth = 1000
fail_on_revert = false
show_metrics = true

[profile.deep.fuzz]
runs = 10000
```

`cd contracts && FOUNDRY_PROFILE=deep forge test`, once, on the contracts as they will ship (after task 5). The record
takes from it the time, the calls and reverts per handler action (`show_metrics`) and the result. A failure is read
first as a finding or a handler error; a finding becomes a unit test from the shrunk sequence and goes through decision
11. The plan confirms `show_metrics` and the default campaign on the installed forge.

### 7.7 The record (`docs/reference/contract-review-2026-10.md`)

1. Scope: the commit, `src/CobwebCollection.sol`, `src/CobwebFactory.sol` and `src/interfaces/`, solc 0.8.30, prague,
   200 optimizer runs, and the creation code hash reviewed.
2. Tools: slither-analyzer and its Python, crytic-compile, the local forge and CI's pinned nightly.
3. Slither: the findings by impact and confidence, the fixes, and the pointer to `contracts/slither.triage.md`.
4. A reading of six areas, a paragraph each: value flows (every payable path and withdrawal); access (owner, payout
   address, platform admin, anyone); reentrancy (the guarded entry points and the receiver callback); external trust
   (the factory read in the constructor and at withdrawal, the delegate registry, the transfer validator and its
   approval); CREATE2 and the approved hash; the analysis doc's fixes still in place.
5. Invariants: the thirteen in their groups; CI's default campaign and the deep run (time, calls, reverts per action,
   result).
6. Changes: none, or each with its finding, commit and both hashes, and the approvals owed.
7. Owed: the external look, the owner's decision before mainnet, with this record and the triage as its brief; the
   testnet checks owed elsewhere (the validator's levels, the registry's code on each launch chain).

## 8. `check:edge`

### 8.1 The judges and the script

```ts
// apps/web/src/lib/edge/edge-checks.ts, pure
export type EdgeAnswer = { status: number; headers: Headers; body: string }
export type EdgeArgs = { app: URL; freshness: URL; chainId: number; address: Address; slug: string | null }
export const INJECTED_MARKS: readonly string[] // rocket-loader, email-decode, beacon.min.js, cloudflareinsights.com,
                                               // /cdn-cgi/
export function edgeArgsOf(argv: readonly string[]): EdgeArgs | null
export function viaCloudflare(answer: EdgeAnswer): boolean        // a cf-ray header
export function cacheStatusOf(answer: EdgeAnswer): string | null  // cf-cache-status, upper case
export function ageOf(answer: EdgeAnswer): number | null
export function isWeakEtag(value: string | null): boolean
export function scriptNonces(html: string): (string | null)[]     // each script of a JavaScript type
export function pagePolicyOf(headers: Headers): { mode: 'enforce' | 'report-only'; policy: string } | null
export function nonceOf(policy: string): string | null
export function directiveOf(policy: string, name: string): string[]
export function injectedIn(html: string): string[]                 // the marks found
```

`apps/web/scripts/check-edge.ts`, with `"check:edge": "node --conditions=react-server --import
./scripts/resolve-ts.mjs scripts/check-edge.ts"`: it reads `--app`, `--freshness`, `--collection` and `--slug` through
`edgeArgsOf`, and without a usable set prints section 10's usage line and exits 2. Every request goes from Node's
`fetch` with `redirect: 'manual'`, gives up after 10 s, and reads its headers and body; the wallet is a random address
of the run; the expected cache headers are `STATE_CACHE` and `WALLET_CACHE` from `@cobweb/freshness/server`. Each check
prints its PASS line or its FAIL line with the problem and section 8.2's hint, then the totals; it exits 1 on any
failure. It reads no secret and writes nothing.

### 8.2 The checks

1. "setup: the app domain and the freshness domain both answer through Cloudflare (a cf-ray header on each), /health
   reads ok, and the collection's state answers 200". Look at: the two DNS records are Proxied, and the URLs given are
   the custom domains, not Vercel's or Railway's own.
2. "health: /health answers 200 with Cache-Control no-store and cf-cache-status DYNAMIC or BYPASS on two reads in a
   row". Look at: the Cache Rule that bypasses /health.
3. "state at the edge: two state polls in a row answer 200 with the origin's Cache-Control unchanged and a weak ETag,
   the second a HIT with Age 0 or 1". Look at: the Cache Rule for /v1/ (eligible, Edge TTL from the origin's
   Cache-Control, Browser TTL from the origin) and the zone's Browser Cache TTL.
4. "a 1 s edge: polls every 250 ms for 5 s never show an Age above 2, and at least two answer other than HIT, the edge
   going back to the origin". Look at: the /v1/ rule's Edge TTL, which must follow the origin's Cache-Control rather
   than set its own.
5. "304 at the edge: a poll carrying the last ETag answers 304 with that ETag, HIT or REVALIDATED". Look at: Respect
   Strong ETags (off) and the /v1/ rule.
6. "first poll: a poll with the page's reload headers, Cache-Control no-cache and Pragma no-cache, is answered from the
   edge's copy (a HIT)". Look at: nothing in the zone; the edge passed the browser's directives to the origin, a defect
   for the controller (decision 21).
7. "query ignored: a poll with a random query string, right after a cached one, is a HIT". Look at: the /v1/ rule's
   cache key (Ignore query string), or the zone's Caching Level (Ignore Query String).
8. "wallet: two reads of a fresh wallet in a row answer 200 with Cache-Control public, max-age=0, s-maxage=5, the
   second a HIT with Age at most 5, and a read 6 s after the first is not a HIT". Look at: the /v1/ rule, as for check
   3.
9. "CORS: a preflight from the app's origin for If-None-Match, Cache-Control and Pragma answers 204 allowing them with
   Access-Control-Max-Age 86400, and a state answer from the edge carries Access-Control-Allow-Origin * and exposes
   ETag, Retry-After and Age". Look at: a Transform Rule or a Managed Transform touching the freshness domain's
   headers.
10. "pages: / and the mint page given answer 200 HTML with cf-cache-status DYNAMIC, and two loads of / carry different
    nonces". Look at: a rule caching the app domain's pages (Cache Everything, or a Cache Rule making them eligible),
    which must not exist.
11. "policy intact: the page policy, enforced or report-only, has 'strict-dynamic' and the nonce every script carries,
    its connect-src lists the freshness origin, Reporting-Endpoints names the app's /api/csp-report, and X-Frame-Options
    DENY, X-Content-Type-Options nosniff and Referrer-Policy strict-origin-when-cross-origin arrive". Look at: Managed
    Transforms (off), CSP_MODE on Vercel (not off), and a redeploy after NEXT_PUBLIC_FRESHNESS_URL moved.
12. "nothing injected: no page read holds a Cloudflare script (rocket-loader, email-decode, beacon.min.js,
    cloudflareinsights.com or a /cdn-cgi/ path) and no answer carries a Speculation-Rules header". Look at: the feature
    named, in the list that stays off.
13. "transport: http:// on the app domain answers a redirect to its https:// address, and / carries
    Strict-Transport-Security". Look at: Always Use HTTPS, and HSTS (Vercel's header, or Cloudflare's if Vercel sends
    none).

Checks 3, 5, 6 and 8 send decision 4's request headers. Checks 4 and 8 depend on timing, so one failure on a slow line
is decided by a rerun.

## 9. Cloudflare's configuration (`docs/reference/cloudflare-setup.md`)

The checklist the owner applies by hand, in section 13's order. It names the zone's domain `<zone>`, the app's
`<app domain>` (the apex or a first-level subdomain) and the freshness server's `<freshness domain>` (a first-level
subdomain, such as `fresh.<zone>`, since the free edge certificate covers the apex and one level of subdomains).

### 9.1 What it relies on, and the check that proves it

- Cloudflare caches by file extension unless a rule makes an answer eligible; with the rule's edge TTL taken from the
  origin, `s-maxage` sets it (checks 3, 4 and 8).
- The edge keeps the origin's weak ETag and answers 304 to a matching `If-None-Match` from its copy (checks 3 and 5).
- The edge does not let a browser's request directives pass its copy (checks 3, 5 and 6, with decision 4's headers).
- Answers pass with their headers unchanged and HTML pages with no script added (checks 9 to 12).

### 9.2 The zone, DNS and certificates

- The zone: `<zone>` on the Free plan, the registrar's nameservers moved to the two Cloudflare names, until Active.
- `<app domain>`: in Vercel (project cobweb, Domains) added for Production; in Cloudflare, a CNAME to
  `cname.vercel-dns.com` (or the value Vercel's Domains page shows; at the apex Cloudflare flattens it), DNS only until
  Vercel shows the domain valid with its certificate, then Proxied.
- `<freshness domain>`: in Railway (service freshness, Settings, Networking) added as a custom domain; in Cloudflare, a
  CNAME to the target Railway shows, DNS only until Railway shows its certificate, then Proxied; then Railway's
  generated domain removed (section 15, point 5).
- Supabase, R2's S3 endpoint and the IPFS gateway stay outside the zone; Cloudflare never fronts Supabase.

### 9.3 TLS

SSL/TLS encryption mode Full (strict); Edge Certificates: Always Use HTTPS on, Minimum TLS Version 1.2, Automatic HTTPS
Rewrites as it is; HSTS off unless check 13 finds no `Strict-Transport-Security`, then on at six months, without
`includeSubDomains` or preload.

### 9.4 Cache

- Cache Rule "Freshness API": when `(http.host eq "<freshness domain>" and starts_with(http.request.uri.path,
  "/v1/"))`; Eligible for cache; Edge TTL "Use cache-control header if present, bypass cache if not"; Browser TTL
  "Respect origin TTL"; Cache key: Ignore query string (where the plan does not offer it in a rule, the zone's Caching
  Level set to Ignore Query String does the same for every cached answer); stale content served while revalidating (the
  default); Respect Strong ETags off (the default).
- Cache Rule "Freshness health": when `(http.host eq "<freshness domain>" and http.request.uri.path eq "/health")`;
  Bypass cache.
- Tiered Cache: Smart Tiered Caching Topology on.
- Caching, Configuration: Browser Cache TTL "Respect Existing Headers"; Always Online off, so an origin failure is met
  by the edge's copy under `stale-if-error`, not an archived page.
- No other cache rule, and never Cache Everything on `<app domain>` (decision 16).

### 9.5 What stays off

Rocket Loader; Speed Brain (it adds a Speculation-Rules header to the app's answers); Cloudflare Fonts; Email Address
Obfuscation (Scrape Shield, on by default for a new zone); Web Analytics' automatic setup (its beacon); Zaraz; Bot Fight
Mode and its JavaScript detections; Managed Transforms. Each would inject a script or rewrite an answer; checks 9, 11
and 12 fail on those that show in the answers they read.

### 9.6 Security

The Cloudflare Free Managed Ruleset stays deployed (the free plan's managed WAF rules, on by default); no custom rule and
no rate limiting rule (decision 19); Security Level and Browser Integrity Check as they are; never "I'm Under Attack"
for the zone while `<freshness domain>` is in it, since every API answer would become a challenge page (if the app ever
needs it, a Configuration Rule turns it on for `<app domain>` alone).

### 9.7 Outside the zone

- Turnstile: `<app domain>` added to the sign-in widget's hostnames.
- Vercel: `NEXT_PUBLIC_FRESHNESS_URL=https://<freshness domain>` on Production and Preview, then a redeploy (the value is
  read at build time; the policy's `connect-src` follows it).
- Railway: nothing else; the freshness server reads no setting of the zone.

## 10. Copy

| Where | When | Sentence |
| --- | --- | --- |
| k6, at start | `PROFILE` missing or another value | PROFILE must be local or hosted. |
| k6, at start | `BASE` missing, not http or https, or with a path | BASE must be the freshness server's origin, such as https://fresh.example.com. |
| k6, at start | `COLLECTIONS` empty or malformed | COLLECTIONS must list one or more <chain id>/<address>, separated by commas. |
| k6, at start | `POLLERS`, `INTERVAL_S` or `WALLETS` not a whole number above 0 | POLLERS, INTERVAL_S and WALLETS must be whole numbers above 0. |
| k6, `setup` | `/health` is not ok | The freshness server is not ok before the run: <its problems, joined by spaces>. Fix it, then run again. |
| k6 summary, line 1 | Always | k6-freshness, <profile> profile, against <BASE>. |
| k6 summary | Always | State: <n> polls, <m> of the <c> that carried an ETag answered 304, p95 <x> ms. |
| k6 summary | Always | Wallet: <n> reads, p95 <x> ms. |
| k6 summary | Always | Failed: <r>% of all requests. Dropped iterations: <d>. Edge mitigations: <k>. |
| k6 summary | Some answer carried `cf-cache-status` | Edge cache: <value> <count>, <value> <count> (largest first). |
| k6 summary | None did | Edge cache: no answer came through Cloudflare. |
| k6 summary | `/health` was read with its counts | Origin: the busiest collection drew at most <x> state requests a second; the wallet windows peaked at <w> a minute. |
| k6 summary | `/health` carried no counts | Origin: /health carries no request counts; deploy this sub-project's freshness server first. |
| k6 summary | Every threshold held | Thresholds: every one passed. |
| k6 summary | Some failed | Thresholds failed: <metric> <expression>, <metric> <expression>. |
| k6 check names | Section 5.3 | state answered 200 or 304 / a 304 carries the ETag it was asked with / a 200 body is the asked collection's state / wallet answered 200 / /health answered 200 and ok |
| `verify:load`, check 1 | k6 is not on the PATH | k6 is not installed; install it with brew install k6. |
| `verify:load`, under check 3's line | Always | k6's summary lines, each indented by two spaces |
| `check:edge` | An argument missing, or a URL not https | Usage: pnpm --filter @cobweb/web check:edge --app https://<app domain> --freshness https://<freshness domain> --collection <chain id>/<address> [--slug <mint page link>] |
| `check:edge`, a FAIL line | Its check failed | <the problem>. Look at: <section 8.2's hint for that check> |
| `check:edge` and `verify:load`, last line | Always | <p> passed, <f> failed |
| Triage verdict | A confirmed finding changed in the contract | fixed |
| Triage verdict | The pattern is there by design | accepted |
| Triage verdict | The detector's premise does not hold | false positive |
| Checklist, the positive control | Section 13, step 12 | In the browser's console on https://<app domain>/, run `document.body.insertAdjacentHTML('beforeend', '<img src="/x" onerror="document.title = 1">')`. Within a minute the Vercel log shows a line that begins `{"csp":"report","directive":"script-src-attr",` or, once CSP_MODE=enforce is set, `{"csp":"enforce","directive":"script-src-attr",`. |

## 11. Testing

- Unit tests in `apps/freshness`:
  - `src/requests.test.ts` (new) and `src/server.test.ts` (changed): section 4.2.
  - `load/profile.test.ts` (new): `parametersOf` (each profile's defaults, the overrides, each refusal's sentence);
    `optionsOf` (each scenario's executor, rate, duration, start time and VUs per profile, each profile's thresholds,
    the dropped bound from the planned iterations at the defaults and at a rehearsal's numbers); `walletOf` (40
    lowercase hex digits, distinct for distinct iterations and for distinct runs); `statePathOf` and `walletPathOf`
    (lowercased addresses); `livenessOf` (a group open by its flag, a scheduled group before and at its start, an early
    group, a closed unscheduled one); `summaryLines` (each line from a recorded summary, with and without
    `cf-cache-status`, with and without `/health`'s counts, with a failed threshold).
- Unit tests in `apps/web`: `src/lib/edge/edge-checks.test.ts` (new): `edgeArgsOf` (each argument missing, an http URL,
  a malformed collection, with and without a slug); `viaCloudflare`, `cacheStatusOf` and `ageOf` on Cloudflare-shaped
  answers; `isWeakEtag`; `scriptNonces` over a nonced page, a module script, a JSON script left out and a Rocket Loader
  rewrite; `pagePolicyOf` in enforce and report-only modes and null with neither; `nonceOf` and `directiveOf`;
  `injectedIn` finding each mark in its usual shape and none on a clean page.
- `verify:load`: its 10 checks against Anvil with k6 1.2.3, the version on this machine.
- `check:edge`: the smoke run of task 4; the owner's run is section 13, step 11.
- Contracts: `forge fmt --check`, `forge build --sizes`, `forge test` (the thirteen invariants on the default campaign
  with every unit test), one deep run (section 7.6), and Slither with the database at the medium threshold exiting 0.
- `pnpm typecheck && pnpm lint && pnpm test && pnpm format:check` and `pnpm build`, and every verify script at its
  count, `verify:load` 10 among them; the others are untouched by this sub-project.

## 12. Documentation

- `CLAUDE.md`, commands: after `verify:indexer`, `pnpm --filter @cobweb/web verify:load   # k6's local profile against
  the freshness server in process and Anvil: polls and wallet reads under load, the 304s, liveness at a start,
  /health's request counts` and `pnpm --filter @cobweb/web check:edge --app https://<app domain> --freshness
  https://<freshness domain> --collection <chain id>/<address>   # Cloudflare in front, read from outside
  (docs/reference/cloudflare-setup.md)`; after `cd contracts && forge test`, the Slither line with its pinned version
  (`# Slither with the triage database; brew install uv once`) and `cd contracts && FOUNDRY_PROFILE=deep forge test   #
  the deep invariant run, tens of minutes`; and the hosted run, `k6 run -e PROFILE=hosted -e
  BASE=https://<freshness domain> -e COLLECTIONS=<chain id>/<address> apps/freshness/load/k6-freshness.js   # the
  owner's load run behind Cloudflare`.
- `contracts/README.md`: "Build, test, deploy" gains Slither (uv once, the command, the triage file and its database,
  the CI job) and the deep run; the suite table's `test/Invariants.t.sol` row names the actions and the four groups of
  invariants; the figures are updated after the run.
- `apps/web/.env.example`: `NEXT_PUBLIC_FRESHNESS_URL`'s comment gains "Production: https://<freshness domain>, behind
  Cloudflare (docs/reference/cloudflare-setup.md)."
- `.gitignore`: `contracts/crytic-export/`.
- New: `docs/reference/cloudflare-setup.md` (section 9, section 13's steps 2 to 13 and section 8.2's hints),
  `docs/reference/contract-review-2026-10.md` (section 7.7), `contracts/slither.triage.md` (section 7.2).
- `docs/MASTER_PLAN.md`, dated notes only: the Phase 7 status line gains "Load run, contract review and Cloudflare in
  front (second sub-project of three) landed on <date>; see
  [specs/2026-10-18-load-run-contract-review-and-cloudflare.md](specs/2026-10-18-load-run-contract-review-and-cloudflare.md).",
  what exists, Known and the owner's steps; under Decisions, in Contracts "**The contract review** (decided 18 October
  2026)" (decisions 8 to 13), and in Hosting "**The load run** (decided 18 October 2026)" (decisions 2 to 6) and
  "**Cloudflare in front** (decided 18 October 2026)" (decisions 15 to 19). The Phase 7 bullets stay as written.
- Dated notes in [2026-10-16-freshness-server.md](2026-10-16-freshness-server.md): section 6.9 (`requests`) and section
  12 (the Cloudflare rule landed as the checklist with `check:edge`, no rate limit, the k6 run's two profiles).
- When the owner reports the hosted run, its summary lines go into a dated line in MASTER_PLAN's Phase 7 status and
  under this spec's landing note.
- This spec: the landing note after section 14.

## 13. The owner's hosted steps, owed and known

Owed by the owner, in this order (the checklist repeats steps 2 to 13):

1. Before the zone: the hosted freshness service runs this sub-project's code (`/health` carries `requests`), its
   indexer as `cobweb_indexer`, and reads `"status":"ok"`; it serves a chain with at least one deployed Cobweb
   collection, deployed through the app or straight through the factory. Before the mainnet factories that is a
   testnet's, with `COBWEB_TEST_CHAINS=1` on the service and the testnet factory Phase 1 owes (section 15, point 3).
2. The zone: `<zone>` on the Free plan, its nameservers moved, Active.
3. TLS: section 9.3.
4. The app domain: section 9.2, DNS only until Vercel's certificate, then Proxied.
5. The freshness domain: section 9.2, DNS only until Railway's certificate, then Proxied; Railway's generated domain
   removed once `https://<freshness domain>/health` answers through Cloudflare (section 15, point 5).
6. Cache: the two Cache Rules with section 9.4's expressions, Smart Tiered Caching, Browser Cache TTL and Always Online.
7. What stays off: each item of section 9.5 checked in the dashboard.
8. Security: section 9.6.
9. Turnstile: `<app domain>` added to the widget's hostnames.
10. Vercel: `NEXT_PUBLIC_FRESHNESS_URL=https://<freshness domain>` on Production and Preview, then a redeploy.
11. `pnpm --filter @cobweb/web check:edge --app https://<app domain> --freshness https://<freshness domain> --collection
    <chain id>/<address>` (with `--slug` naming a published mint page, section 15, point 8): 13 passed, 0 failed; a
    failure's hint names the setting, and after any later change to the zone the check runs again.
12. The report week's positive control on `<app domain>`: section 10's sentence, then the log line within a minute.
13. The hosted run (section 5.6): the rehearsal (with the restart of section 15, point 9, as ruled), then the full run,
    every threshold passed; the summary lines and the JSON summary go to the controller for the dated notes. If
    `edge_mitigated` is above 0, section 15, point 4.
14. After the first push of this work: the `slither` job green on main.
15. Only if the review changed a contract: on every factory already deployed (a testnet's today), the admin approves the
    new creation code hash the record names and removes the old one; a mainnet factory deployed later approves the new
    hash from the start.
16. The external review: the owner's decision before mainnet, with the record and the triage as its brief.

Follow-ons for the third sub-project: `<app domain>` among the sign-in origins (`site_url` and the redirect URLs) on a
`supabase config push` that keeps `[remotes.cobweb.auth.captcha]` uncommented, then the no-token probe; the mainnet
factories, then the hosted run again on the first launch chain's collection, `COBWEB_TEST_CHAINS` removed from the
service; "`check:edge` passes" and "the hosted run passed on the launch chain" on the launch list; the `mint-page`
bucket's public custom domain on R2, which this zone now makes possible (owed by the mint page spec), with
`MINT_PAGE_MEDIA_URL` moving the policy with it on the next deploy.

Known:

- One machine reaches one or two colos, so the hosted run proves the edge and the origin's count where it lands; a
  launch watched worldwide fills many colos, which Smart Tiered Cache funnels through one upper tier, a shape no
  single-machine run shows and launch day's `/health` counts will.
- Before the mainnet factories the run polls a testnet collection, and its wallet reads reach that chain's provider,
  not the launch chain's.
- `/health`'s counts are one process's; a second replica would need both read and added.
- The triage database keys a finding that cites a statement by its source lines, so an edit near it re-opens the
  finding in CI until it is triaged again, as a renamed function does.
- `crytic/slither-action` compiles with the Foundry it installs, not CI's pinned nightly; the analysis reads the syntax
  tree of the same solc 0.8.30 that `foundry.toml` pins.
- Nothing proves `stale-if-error` before an origin fails (section 15, point 9).
- Until Railway's generated domain is removed, the origin answers around the edge (section 15, point 5).
- A Cloudflare outage or a wrong setting takes the mint page's live data with it: the page raises its own degraded
  banner after 10 s, and the way back is `NEXT_PUBLIC_FRESHNESS_URL` set to Railway's domain and a redeploy, the policy
  following.
- Creators sign in on the Vercel domain until the third sub-project adds `<app domain>` to the sign-in origins; visitors
  read and mint on either.
- A creator's text with an email address shows as written only while Email Address Obfuscation stays off.
- `check:edge` reads from one place, so it proves the colo near the machine that runs it.
- The profiles are proven on k6 1.2.3; a later k6 may change the JSON summary `verify:load` reads.
- The deep run is local and takes tens of minutes; CI runs the default campaign on every push.

## 14. Acceptance criteria

- [ ] `/health` answers `requests` over the last 60 s (state answers, 304s, wallet answers, refusals, collections and
      the busiest one's count) with no address, `status` and `problems` unchanged; `requests.test.ts` and
      `server.test.ts` pass.
- [ ] `apps/freshness/load/k6-freshness.js` runs both profiles from section 5's parameters, sends the page's request
      shapes and judges section 5.4's thresholds; `profile.test.ts` passes.
- [ ] `verify:load` passes its 10 checks against Anvil.
- [ ] `check:edge` prints its 13 checks with their hints, its judges pass `edge-checks.test.ts`, and the smoke run fails
      check 1 with its hint and exits 1.
- [ ] Slither runs as section 7.1 says, with the config; every finding is in `slither.triage.md` with its verdict and
      reason; the `accepted` and `false positive` ones are in `slither.db.json`; the run at the medium threshold with
      the database exits 0; the `slither` job is in `ci.yml` as section 7.3 says.
- [ ] No contract changed but for a confirmed finding, each such change carrying its test, its regenerated artifacts and
      both hashes in the record.
- [ ] `forge test` passes with the thirteen invariants on the default campaign, and one deep run (1,000 runs of depth
      1,000) passes, its time and metrics in the record.
- [ ] `docs/reference/contract-review-2026-10.md` holds section 7.7's seven parts.
- [ ] `docs/reference/cloudflare-setup.md` holds section 9 with the exact expressions, the order of section 13 and
      `check:edge`'s hints.
- [ ] The freshness server's cache headers and the mint page's polls are unchanged, or a change is named in the landing
      note with the check that showed its defect.
- [ ] `pnpm typecheck`, `lint`, `test`, `format:check` and `build` pass, with `forge fmt --check`, `forge build --sizes`
      and every verify script at its count.
- [ ] Section 12's docs are written, and the landing note lists the owner's steps.

## 15. Reconciliations and points to rule

Reconciliations with earlier specs and the brief, each with its reason:

1. The freshness spec's section 12 and Phase 6's Known owe "a rate limit against address spraying" with the Cloudflare
   rule: none in this sub-project (decision 19); the freshness spec's Known "No origin rate limit" stands, and
   `/health`'s `refused` count now shows a spray.
2. Phase 6's Known lists "`CDN-Cache-Control` for the edge-only directives" for Phase 7: not added (decision 21), and
   named as the fix if check 4 fails.
3. The freshness spec's section 12 wants the rule "confirmed on the account's plan: a 1 s edge TTL,
   `stale-while-revalidate`, `stale-if-error`, the weak ETags kept and 304s to conditional requests": `check:edge`
   confirms the TTL (checks 3 and 4), the weak ETag (3) and the 304 (5); `stale-while-revalidate` shows only as a
   non-HIT inside check 4's window, and `stale-if-error` waits for an origin failure (point 9).
4. The freshness spec's section 12 owes "staleness from `readAt` on 200s": the run judges staleness as the page does,
   by `Age` and `degraded`, since `readAt` moves with the collection's tier (up to 20 s apart when idle) and the load
   machine's clock is not the server's.
5. The legacy port plan (`docs/legacy/market-mint-and-data.md`, section 7): its 20,000 VUs become a rate (decision 3);
   its quota path is the wallet endpoint, which answers quotas and vaults; its phase-boundary test is `verify:load`
   check 7 and the `early_open` count in both profiles; its restart test is point 9; its 300 ms at the edge is the
   ruled 500 ms.
6. PLAN's load table, "Restart during a launch: Up to 10s stale at the edge": with `stale-if-error=60` the edge may
   answer up to 60 s stale, while the page counts an `Age` above 10 s as unreachable (the freshness spec's item 26), so
   the 10 s holds where the visitor reads it.
7. The brief's deep profile, 2,000 runs of depth 200: 1,000 runs of depth 1,000 (decision 13, point 2).
8. The ruled "p95 under 500 ms at the edge" is read as the state route's; the wallet route has its own (decision 5,
   point 1).

Points for the controller to rule on, each with this spec's recommendation:

1. The thresholds this spec adds to the ruled two: the wallet route's 95th percentile (under 400 ms locally, under
   1,000 ms hosted), an `Age` of at most 10 s, no edge mitigation, at most 1% of the planned iterations dropped, and at
   most 2 origin requests a second for the busiest collection (about 1 expected), with the 304, degraded, early-open and
   `/health` counts in both profiles. Recommended: as written; each is a way the run could pass while mint day would
   not.
2. The deep profile at 1,000 runs of depth 1,000 rather than 2,000 of depth 200. Recommended: as written, since CI
   already runs depth 500 on every push and selling out a 1,000-token collection takes long sequences.
3. Where the hosted run happens: the mainnet factories are the third sub-project's, so the first run polls a testnet
   collection, with `COBWEB_TEST_CHAINS=1` on the service and the testnet factory Phase 1 owes, on a chain that makes
   blocks steadily, since `/health` reads degraded when a hot chain's newest block is two minutes old (a quiet Orbit
   testnet can do that). Recommended: run it on Sepolia as soon as `check:edge` passes, and have the third sub-project's
   launch list repeat it against the first launch chain's collection, whose wallet reads reach that chain's provider.
4. Cloudflare's automatic DDoS protection may challenge one machine sending 6,667 requests a second; the run counts it
   in `edge_mitigated` and fails. Recommended: one machine first; if it is mitigated, the same command on two or three
   machines with POLLERS and WALLETS divided between them, rather than lowering the zone's protection for the run.
5. Railway's generated domain answers the same paths, so a client can poll the origin around the cache. Recommended:
   remove it once the custom domain answers through Cloudflare (section 13, step 5); a secret header added by a
   Transform Rule and checked by the server waits until `/health`'s counts show traffic around the edge.
6. The app domain proxied (decision 17) puts two networks in line: Vercel's firewall then sees Cloudflare's addresses,
   and the app's pages gain nothing from a cache. Recommended: proxied as ruled, for the managed WAF rules and one
   place for TLS, with `check:edge` proving after every change to the zone that the pages pass unchanged.
7. HSTS: check 13 requires `Strict-Transport-Security` on the app domain's pages, and whether Vercel adds it on a custom
   domain is what the check reads. Recommended: Vercel's header if the check finds it; otherwise Cloudflare's at six
   months without preload, which the check then reads; a preload waits until after the launch.
8. Check 12 sees Email Address Obfuscation only on a page that holds an address. Recommended: once the hosted app leaves
   sample mode, the owner's test collection's mint page carries one in its description (`hello@<app domain>`) and
   `check:edge` reads it with `--slug`; until then the setting is checked by eye.
9. Nothing proves `stale-if-error` before the origin fails. Recommended: one rehearsal run (POLLERS=2000) with the
   Railway service restarted in its second minute, its failed rate, `Age` and edge counts recorded in the dated note,
   not gated.
10. The invariant suite goes beyond the ruled list: mints on behalf, delegated mints, transfers and a factory handler for
    art payments and admins. Recommended: as written, since each moves value or ownership the ruled invariants must
    hold over.

Rulings on the ten points (18 October 2026, before planning): 1, as written, every added threshold kept; 2, as written, the deep profile at 1,000 runs of depth 1,000, documented and never in CI; 3, as recommended, the first hosted run on Sepolia once `check:edge` passes (the testnet factory an owner step), repeated on the first launch chain by the third sub-project's launch list; 4, as recommended, one machine first, then the same command split over two or three machines with the pollers and wallets divided, never a lowered protection; 5, as recommended, Railway's generated domain removed once the custom domain answers through Cloudflare, the secret origin header deferred until `/health`'s counts show traffic around the edge; 6, as recommended, the app domain stays proxied, `check:edge` rerun after every zone change; 7, as recommended, Vercel's HSTS header when present, else Cloudflare's at six months without preload, preload after launch; 8, as recommended, the owner's test mint page carries the address and `check:edge` reads it with `--slug` once sample mode is off, the setting checked by eye until then; 9, as recommended, one Railway restart during the rehearsal run, recorded and not gated; 10, as written. The eight reconciliations stand as the spec states them, the arrival-rate executor and the deferred `CDN-Cache-Control` among them.
