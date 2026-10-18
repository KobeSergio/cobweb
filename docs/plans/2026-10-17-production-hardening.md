# Production Hardening in Code Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Cobweb the protections a public launch needs, Phase 7's first sub-project of three, each built and proven on a laptop with its hosted switch left to the owner's checklist. Every page carries a Content-Security-Policy whose scripts run only with the response's nonce, made per request in the proxy, with `connect-src`, `media-src` and `frame-src` listing exactly the origins the app reads from its own settings; it starts as a report-only policy on Vercel and is enforced locally, and violations reach `/api/csp-report` as one JSON line each. A wallet signs in after a Cloudflare Turnstile check that Supabase Auth verifies before the signature, and holds at most 20 collections that are not deployed. Local sessions are signed with an ES256 key and verified against the key set with no call to the auth server per page. A daily cron deletes a collection's original art files 90 days after its deploy and its final render. The freshness server's indexer logs in as `cobweb_indexer`, a role that executes its four functions and nothing else, over verified TLS off the machine, so Railway no longer holds the service role key. `/health` answers `degraded` with its reasons. Task 9, the tenth task the ruling on the spec's point 8 added, carries the three items earlier phases owed: `record_upload` runs for the service role alone, and a daily sweep removes art uploads never recorded and mint page media never saved.

**Architecture:** One migration (`20261017100000_production_hardening.sql`) adds `profiles.draft_cap` with a `before insert` trigger on `collections` serialized per owner by an advisory lock; the `cobweb_indexer` login role with execute on the four indexer functions; `collections.art_sources_deleted_at`, the service-role functions `collections_sources_due` and `collection_sources_deleted`, and triggers that refuse a new upload or render job for a marked collection. `supabase/config.toml` signs local sessions with `supabase/signing_keys.json` (ES256, gitignored). In `apps/web`, `lib/security/csp.ts` writes the policy from the settings, `lib/security/csp-report.ts` reads both report formats through allow-listed schemas and limits the log, `proxy.ts` sets the headers with a fresh nonce before it refreshes the session, the root layout awaits `connection()` so every page renders per request, `lib/turnstile.ts` and `use-turnstile.ts` add the check to the sign-in button, the create action words the cap, `lib/storage/source-sweep.ts` with its port and `/api/cron/source-sweep` delete the sources, and `/api/uploads/[id]` serves thumbnails once originals are gone. In `apps/freshness`, `indexer-db.ts` calls the four functions as the role through postgres.js with verified TLS, and `health.ts` with `recent.ts` turns the readers' and indexers' recent failures into `status` and `problems`. Task 9 moves `record_upload` behind the service role (`20261017110000_upload_hardening.sql`) and adds `/api/cron/upload-sweep` over the art and mint-page buckets.

**Tech Stack:** TypeScript 6 strict (ESM, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`; the freshness server adds `erasableSyntaxOnly`); Next 16.3.8 (proxy on Node, `connection()`, `next/experimental/testing/server`); React 19; `@supabase/ssr` 0.12 and `@supabase/supabase-js` 2.117 (auth-js `getClaims` with its 10-minute key-set cache); Supabase CLI 2.116.0 (Postgres 17, `signing_keys_path`); postgres.js 3.4.9 (new, exact); zod 4.6; viem 2.57; Vitest 5; Prettier 3; Cloudflare Turnstile (`api.js?render=explicit`).

**Spec:** [../specs/2026-10-17-production-hardening.md](../specs/2026-10-17-production-hardening.md), with the controller's rulings on its section 14 and three rulings during planning (Decisions 6, 15 and 16).

## Global Constraints

- The spec is the binding authority, its section 14 rulings included. Where this plan decides a detail the spec leaves open, or departs from its letter, the decision is collected in the next section and named in the step that carries it.
- Node 26 locally; Node 24 runs the freshness server on Railway, from its TypeScript source with no build step. ESM everywhere. Inside `apps/web/src`, imports are extensionless and use the `@/` alias, as the existing files do. Inside `packages/shared` and `apps/freshness`, relative imports carry the `.ts` extension, and the freshness server writes no TypeScript that Node cannot erase (`erasableSyntaxOnly`). Inside `apps/web/scripts`, relative imports carry the `.ts` extension and the app's modules are imported as `../src/...` after the script sets the environment; the scripts run under `node --conditions=react-server --import ./scripts/resolve-ts.mjs` (`verify:local` runs under plain `node`). Types are imported with `import type` or an inline `type` specifier.
- Vitest 5, Node environment. One file: `pnpm --filter <package> exec vitest run <file>`, for example `pnpm --filter @cobweb/web exec vitest run src/lib/security/csp.test.ts`. A module that imports `server-only` is tested with `vi.mock('server-only', () => ({}))`.
- Test fixtures: annotate every fixture constant with its type (`const PRODUCTION: CspSources = ...`), since an unannotated literal widens and fails `tsc`.
- Prettier: no semicolons, single quotes, trailing commas, 110 columns. Before each commit run `pnpm exec prettier --write <the files you changed>` from the repo root. Never run `pnpm format` or Prettier on `.`. Prettier cannot parse `.sql`, `.toml`, `.gitignore` or `.env.example` files, so never list them. CI runs `pnpm format:check`, so every other file you touch outside `docs/` must be formatted. The code blocks in this plan are already formatted; Prettier leaves them as they are.
- typescript-eslint's recommended rules and ESLint's `preserve-caught-error` apply: never `throw new X(...)` directly inside a `catch` block without `{ cause }`. `eslint.config.mjs` is not touched.
- Two text hazards of the tool that writes files: a `\\;` sequence loses one backslash when written through a Bash heredoc or a typed command, and a `\u2028` or `\u2029` escape typed into a tool call becomes the raw line separator, which breaks a regular expression literal. No code block in this plan holds either (the report tests build their control characters with `String.fromCharCode`). Write each file with the Write or Edit tool, or a script that copies the block from this plan, never a heredoc.
- Copy: plain sentences. No em or en dashes anywhere, code, comments, commit messages and docs included. The product is Cobweb; never Kingdomly or realm. Colours come from the theme's tokens, never hex values; UI is built from the shadcn components in `packages/ui` (`@cobweb/ui/components/...`).
- CLAUDE.md rules 3 and 4 bind this sub-project. The mint page still polls the freshness server and calls no RPC for shared state: the policy's `connect-src` lists each chain's public RPC only for the visitor's own transaction, as before (rule 3). Every server action keeps its session and ownership checks: `createCollection` reads the cap under row-level security after `getVerifiedUser`, `confirmUpload` records through the service client only after `ownedUnlocked`; every table keeps row-level security, and the new functions run for the service role alone (rule 4).
- Security: `supabase/signing_keys.json` holds a private key and is gitignored; `INDEXER_DATABASE_URL` carries the role's password and lives only in the freshness server's environment (on Railway, the owner's step); the role's password is never in a migration, a log or a commit (`verify:indexer` sets a random one through `DB_URL` and clears it); the Turnstile secret lives only in Supabase's hosted auth settings, and `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is public; `CRON_SECRET` guards both new crons; `CSP_MODE`, `SOURCE_SWEEP_DELETE` and `UPLOAD_SWEEP_DELETE` are the switches, each safe when unset. No key, password or URL is printed, logged or committed: a `ConfigurationError` names the variable, never its value; `IndexerWriteError` names the function and the code; a violation line is JSON of cleaned, allow-listed fields.
- Never deploy to any remote chain or service, and never pass `--prod` or `--target production` to any command. The only chain any step touches is the local Anvil on port 8545; every script refuses an endpoint that is not localhost. The hosted migrations, the role's password, Railway's and Vercel's variables, the key rotation and captcha are the owner's (spec section 12).
- The repository is linked to a hosted Supabase project (`supabase/.temp`). Never run `supabase db push`, `supabase db reset` or `supabase config push`, and never pass `--linked` or `--project-ref` to any command. The Supabase commands a step runs are `supabase migration up --local`, `supabase status`, `supabase gen signing-key` (Task 1, once) and, in Task 1 alone, `supabase stop` (never with `--no-backup`, which would delete the local data) followed by `supabase start`, so the stack loads the key.
- `docs/PLAN.md` must not change. `legacy/` is never read into, copied from, imported or committed.
- Docs keep their history: add dated notes and status sentences; never rewrite or delete earlier statements in `docs/MASTER_PLAN.md` or in specs.
- Local services, as the indexer sub-project left them: `supabase start` at the repo root has run with the migrations up to `20261016200000_indexer.sql` applied (Tasks 1 and 9 apply theirs with `supabase migration up --local`, which keeps the local data), `supabase seed buckets` has run (the `art`, `render` and `mint-page` buckets), and `pnpm --filter @cobweb/web chain:local` is running on port 8545 with its two printed lines in `apps/web/.env.local`, which keeps `NEXT_PUBLIC_DEMO_DATA=1`, so `pnpm build` runs sample mode. From Task 1 on, the local stack signs sessions with the ES256 key. Tasks 1, 6 and 9 need Supabase and its storage; Tasks 7 and 8 need Supabase and Anvil; Task 3 needs a production build and nothing running; Task 10 needs everything, the freshness server and the dev wallet. Tasks 2, 4 and 5 need nothing running. Nothing may listen on ports 3100, 3210 or 8787 when a verify starts its own server, and no `pnpm --filter @cobweb/freshness dev` may run with `INDEXER_DATABASE_URL` set during `verify:indexer` (it would race its checks).
- Dependencies install from the local store: `pnpm install --offline`, so the lockfile resolves exactly as this plan was checked (Tasks 1 and 7 add `postgres` 3.4.9; Decision 3).
- Implementers never use `git commit --amend` or `git stash`. To fix a commit, make a new one.
- Before every commit, at the repo root: `pnpm exec prettier --write <the files you changed>`, then `pnpm typecheck && pnpm lint && pnpm test`.
- Commit messages are one plain imperative sentence with no prefix, then a blank line, and end with exactly these two lines:

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
```

## Decisions

1. Decision (spec section 3 and the ruling on section 14, point 8): ten tasks. The spec's first eight in its order: the migration, its types, the local signing key and `verify:local`'s section 9p (1); the policy, the report reader and the report route (2); the proxy, the root layout, `/[slug]`, `next.config.ts`, `proxy.test.ts` and `verify:csp` (3); the Turnstile check (4); the cap in the create action (5); the source sweep and `verify:sources` (6); the role in the freshness server and `verify:indexer` through it (7); `/health`'s status and thresholds (8). Then the tenth task the ruling added, the three items earlier phases owed (9), and last the spec's ninth, the controller's docs, check list and walk (10). Tasks 2, 4, 5 and 8 are transcription (Sonnet); Tasks 1, 3, 6, 7 and 9 are integration (Opus): a stack restart, Next's rendering, a storage port and a cron, a database driver with TLS, and a migration that moves every script's upload record.
2. Decision (ruling on section 14, point 6; section 4.5): the local ES256 key works, checked while planning. With `signing_keys_path` set, Supabase CLI 2.116.0 signs the `anon` and `service_role` JWTs `supabase status` prints with the ES256 key and serves its public half at `/auth/v1/.well-known/jwks.json`; the publishable, secret and S3 keys stay as they were, and the unchanged `verify:local` passed 395 on the key. So Task 1 keeps the key and its proof. Without the path the stack already serves one ES256 key, which the CLI supplies (key id `b81269f1-21d8-4f2e-b719-c2240a840d90`) and gives its auth container to sign with, while the `anon` and `service_role` JWTs stay on the HS256 secret; the path puts a key made on the machine in its place and signs those two JWTs with it, as production will after the rotation. The CLI reads the configured file before it writes and fails when it is missing, so the key is made with `echo '[]' > supabase/signing_keys.json && supabase gen signing-key --algorithm ES256 --yes` (the spec wrote the command alone), and `CLAUDE.md` says the same. The stack loads it on `supabase stop` then `supabase start`, which keeps the local data (Task 1).
3. Decision (section 8.1): `postgres` 3.4.9, pinned exactly, joins `apps/web`'s devDependencies in Task 1, where section 9p first uses it, and `apps/freshness`'s dependencies in Task 7, in place of `@supabase/supabase-js`. The spec wrote `^3.4.5`; the local store held 3.4.5 without its registry entry, so the one addition was resolved online while planning, at the newest 3.4 release; `pnpm install --offline` resolves it from the lockfile (Tasks 1 and 7).
4. Decision (section 10, `verify:local`): section 9p reads the catalog through postgres.js on `DB_URL` as `postgres`, which is not a superuser locally and may not `set role cobweb_indexer`; checks 5 and 6 act as the role inside a transaction that grants `cobweb_indexer` to `postgres` and rolls back, so no membership stays. Check 5 also reads the role's two timeouts, and "can log in" is its `rolcanlogin` (the login itself is `verify:indexer`'s, Task 7). Check 2 adds a race for a wallet's last place under its cap, with two connections, so its name says so (Review Focus 5). The setup raises the `draft_cap` of the two wallets the earlier sections use to 1,000, and logs an INFO line when it cannot, as before the migration (Task 1).
5. Decision (ruling on section 14, point 4; section 5.2): `img-src 'self' data: blob: https:` as ruled, plus the storage, media and gateway origins when one answers over http, as the local services do (`http://127.0.0.1:55321`), so local art and media load under the enforced policy. `media-src` keeps the spec's exact list (Task 2).
6. Decision (the controller's first ruling during planning, on log injection; section 5.5): a report is never interpolated into a log line. Each format is read through a zod schema of allow-listed fields (`document-uri`, `violated-directive`, `effective-directive`, `blocked-uri`, `source-file`, `line-number`, `column-number`, `disposition` and their Reporting API names; `original-policy` and every other field dropped); every string loses its control characters (below 0x20 and 0x7f, with the C1 range and U+2028 and U+2029) and is cut to 256 characters (the spec wrote 200); the document is kept as its path without query or fragment and a blocked or source URL as its origin or keyword; and the line is one JSON object, `{"csp":...,"directive","blocked","page","source","line","column"}`, in place of the spec's sentence. A body that does not parse or fails the schema is counted with the reports held back, answered 400 and never logged. So `violationsOf` answers `{ violations, malformed }` and the limiter gains `drop(now)`. The rate limit stays (Task 2, Review Focus 1).
7. Decision (sections 5.2 and 5.3, decision 10; a library fact): in report-only mode the response carries no enforced policy. Next 16.3.8's `resolve-routes.js` copies each of the proxy's response headers into the request it renders (`req.headers[key] = value`), and `app-render.js` reads `content-security-policy` before `content-security-policy-report-only`, so an enforced `frame-ancestors 'none'` beside the report-only policy became the request's policy, Next read no nonce from it, and every script of a report-only page went out without one (seen while planning: 38 of 38). `X-Frame-Options: DENY`, which `next.config.ts` keeps on every path, holds the framing block in that mode; enforce and off answer as the spec writes. `verify:csp`'s check 8 names the header it now reads (Tasks 2 and 3, Review Focus 4).
8. Decision (section 10, `proxy.test.ts`): the matcher is tested with `unstable_doesMiddlewareMatch` from `next/experimental/testing/server`; Next 16.3.8 exports no `unstable_doesProxyMatch` (Task 3).
9. Decision (section 10, `verify:csp`): `Reporting-Endpoints` names `request.nextUrl.origin`, which a local `next start` reads as `http://localhost:3210` whatever host the request used, so check 8 checks the endpoint's path. The run starts the server with `NEXT_PUBLIC_FRESHNESS_URL` from the environment or `apps/web/.env.local`, else `http://127.0.0.1:3100`, and check 4 expects that origin, since the proxy reads the variable at run time (Task 3).
10. Decision (section 10): tests beyond the spec's list, each for a route or a Review Focus line: `csp-report-route.test.ts` (Task 2); `source-sweep-route.test.ts` and the source core's refusal to mark a collection whose folders still list files after the removal (Task 6); in `indexer-db.test.ts`, `indexerConnectionOf`'s TLS for each kind of host (Task 7); `upload-sweep-route.test.ts`, `mediaKeysOf` and `sweepUploads` (Task 9).
11. Decision (section 6.2): `signInFailureOf` reads `captcha_failed` before the rejection words, so a captcha message that happened to say "denied" still reads as the check; the button resets the check after any failure, as the spec's "after any refusal" reads (Task 4).
12. Decision (section 6.4): `draftCapOf` answers the default cap, 20, for the trigger's refusal when its detail is missing or not a number, so the dialog still words the cap (Task 5).
13. Decision (section 7.3): once a collection's originals are deleted, `servedKeyOf` serves an original's thumbnail through `?variant=thumb` (null without one) and answers null for an original-size view, so `Artwork` draws its pattern there, as the spec's Known list reads; a thumbnail row is always served as itself (Task 6).
14. Decision (section 10, `verify:sources`): the three collections are recorded as deployed through `collection_record_deploy` on Base (8453), a chain no local indexer serves, after their uploads and done render jobs are written by the service role; the sweep runs through the app's own port with its due list kept to the run's collections, so it can never delete another collection's files on this machine, and check 2's "A alone" is read among the run's three (Task 6).
15. Decision (the controller's second ruling, on transport): the indexer's connection requires TLS for any host other than `localhost`, `127.0.0.1` or `[::1]`, where plain TCP serves the local stack. `indexerOptionsOf` and `checkIndexerOptions` refuse at start, before the server listens, a connection string to another machine whose `sslmode` or `ssl` parameter turns TLS off or leaves it unverified, with a `ConfigurationError` naming `INDEXER_DATABASE_URL` alone; `INDEXER_DATABASE_SSL_CA` names the database's CA certificate, and a string's `sslrootcert` path is read the same way and dropped from the string, which postgres.js would otherwise send the server as a setting (Task 7, Review Focus 2).
16. Decision (the controller's third ruling, on certificate validation): the connection never disables validation. postgres.js 3.4.9's `src/connection.js` maps `ssl: 'require'`, `'allow'` and `'prefer'` to `rejectUnauthorized: false` (and `'prefer'` falls back to plain TCP), and merges an object into Node's TLS options, so for a host off the machine the port passes `{ rejectUnauthorized: true }`, with `ca` when a CA file is given, and Node's host check, never a string mode; `sslmode=require`, `prefer`, `allow` and `disable` are refused at start, and `verify-ca` and `verify-full` are taken. Supabase's session pooler presents a publicly trusted certificate; a direct connection to the database host needs Supabase's CA file, which the owner downloads from the dashboard and names through `INDEXER_DATABASE_SSL_CA` (Task 7, Review Focus 2). (Corrected 18 October 2026: probed with Node's CA store, the session pooler presents `*.pooler.supabase.com` under Supabase's own root, so the owner downloads `prod-ca-2021.crt` from the dashboard and gives it through `INDEXER_DATABASE_SSL_CA`, which takes the certificate's PEM text or a file path; the fix wave made the variable take both forms.)
17. Decision (section 8.1): the port is `indexerDbOf(call)`, which keeps today's mapping, over `postgresIndexerDb(options, open)`, whose `open(url, ssl)` is the seam the tests fake, and `indexerConnectionOf(options)` builds the string and its TLS. `IndexerWriteError` carries a Postgres code read from postgres.js's `PostgresError`, `TIMEOUT` (the call abandoned and cancelled after 10 s), `NETWORK` (no answer) or `NO_ANSWER` (a function answering nothing), where the supabase-js port had `HTTP_<status>` (Task 7).
18. Decision (section 10): `verify:indexer`'s check 1 changes in Task 7 with the role; its check 14 and `verify:freshness`'s check 2 change in Task 8, which adds the fields they read (Tasks 7 and 8).
19. Decision (section 8.2): `recentCounter` counts a failure while it is less than 5 minutes old, so one at exactly 5 minutes has left the window (Task 8).
20. Decision (ruling on section 14, point 8, first item): `record_upload` gains `p_owner_id` and runs for the service role alone (`20261017110000_upload_hardening.sql`), so the size a row records is the one `confirmUpload` read with its HEAD after `ownedUnlocked`, which now answers the creator's id; every script that recorded an upload as a creator records it through the service role for the collection's owner, and `verify:local` gains section 9q, one check of the refusals and the owner, so it reads 405 (Task 9).
21. Decision (ruling on section 14, point 8, second and third items): one daily cron, `/api/cron/upload-sweep` at 07:00 UTC (`maxDuration` 800), runs the existing `sweepOrphans` core over the art bucket against `uploads.storage_key` and over the mint-page bucket against the keys each collection's `mint_pages` row names (`mediaKeysOf`), each object over a day old, dry until `UPLOAD_SWEEP_DELETE=1`, as the source sweep is; `listObjectPages` takes a bucket, and `verify:sweep` gains the two ports' checks (10) (11 since the Task 9 fix round's over-64-keys check, 18 October 2026) and runs under the TypeScript resolver (Task 9).
22. Decision (section 11): `CLAUDE.md`'s lines, both `.env.example` files and the dated notes are written in Task 10 after the code they describe; the local database URL there uses port 55322, the one `supabase/config.toml` sets (the spec wrote 54322); the notes cover the specs this run changes, `2026-10-09-lock-and-pay.md` section 9 among them for the upload sweep's schedule; and the owner's checklist gains the pooler's TLS and `UPLOAD_SWEEP_DELETE` (Task 10).
23. Decision (section 10, the walk's item 7): the walk pauses Anvil with `kill -STOP` and resumes it with `kill -CONT` in place of stopping it, since `chain:local` keeps its chain in memory and a restart would lose the factory and every collection on it; a paused node answers no read, as a stopped one does (Task 10).

## Review Focus

Inputs and failure modes the spec implies but its own test list would not exercise, most likely to bite once the site is public. Each is pinned to a test in the task that owns the code, and each was checked against a mutation of the rule it guards.

1. A violation report as log input. The report endpoint is public and its body is the browser's, or anyone's: a field carrying a newline, a carriage return, an escape sequence or ten kilobytes would forge or flood log lines an alert reads. Pinned by "keeps a report carrying newlines and a 10 KB field to one bounded JSON line (Review Focus 1)" (Task 2, `csp-report.test.ts`), with the route's twin in `csp-report-route.test.ts`. Keeping the control characters failed it, and writing a sentence in place of the JSON line failed it and five others.
2. The indexer's connection to a hosted database. postgres.js connects in plain TCP unless told otherwise, and its `require`, `allow` and `prefer` modes leave the certificate unchecked, so the role's password and every write could be read or answered by a host in between. Pinned by "verifies the certificate and the host of a database on another machine, whatever its string names" (Task 7, `indexer-db.test.ts`) and "refuses a connection string that asks for unverified TLS to another machine, and lets this machine use plain TCP" (Task 7, `config.test.ts`). Leaving a hosted string to the driver's default failed the first, and letting `sslmode=require` through failed the second.
3. A request that brings its own policy or nonce. Next reads the nonce from the request's policy header, so a `content-security-policy`, `content-security-policy-report-only` or `x-nonce` header a client sends would choose the nonce scripts run on, or reach an API route as a policy. Pinned by "replaces a client's own policy and nonce, so no client chooses the nonce Next applies" (Task 3, `proxy.test.ts`). Keeping the client's headers failed it.
4. Report-only mode losing its nonce. The first hosted deploys run report-only; with an enforced framing policy beside it, Next would copy that policy into the request it renders and read no nonce, so every script would be reported and the week of reports would be noise. Pinned by "reports in report-only mode with no enforced policy, which Next would copy into the request" (Task 3, `proxy.test.ts`), "puts the report-only policy on a page request and its response, with no enforced policy" (Task 2, `csp.test.ts`) and `verify:csp`'s check 8. Adding the enforced framing policy back failed both unit tests.
5. Two inserts at once for a wallet's last place under its cap (two tabs, or a script posting to PostgREST). Without the trigger's per-owner lock both would count the same rows and both would land, past the cap the squatting rule relies on. Pinned by `verify:local`'s check 2, "... and of two inserts sent at once for its last place the second waits for the first and is refused" (Task 1), which holds the first insert's transaction open on one connection while the second is sent on another. The trigger without its advisory lock failed it with "the second insert did not wait for the first" (`404 passed, 1 failed`).

## File map

| Path | Task | Responsibility |
| --- | --- | --- |
| `supabase/migrations/20261017100000_production_hardening.sql`, `supabase/config.toml`, `.gitignore` | 1 | The cap, the role, the source column, functions and guards; the local ES256 key and the hosted captcha block |
| `apps/web/src/lib/database.types.ts`, `apps/web/scripts/verify-local.ts`, `apps/web/package.json`, `pnpm-lock.yaml` | 1, 3, 6, 9 | The new columns and functions; section 9p (1) and 9q (9); `postgres` (1); the `verify:csp` (3), `verify:sources` (6) and `verify:sweep` (9) commands |
| `apps/web/src/lib/security/csp.ts`, `csp-report.ts`, their tests, `csp-report-route.test.ts`, `apps/web/src/app/api/csp-report/route.ts` | 2 | The policy, the report reader and limiter, the report endpoint |
| `apps/web/src/proxy.ts`, `proxy.test.ts`, `src/app/layout.tsx`, `src/app/[slug]/page.tsx`, `next.config.ts`, `scripts/verify-csp.ts` | 3 | The headers with a fresh nonce, every page per request, the framing header, `verify:csp` |
| `apps/web/src/lib/turnstile.ts`, its test, `src/components/auth/use-turnstile.ts`, `sign-in-failure.ts`, its test, `sign-in-button.tsx` | 4 | The browser check on sign-in |
| `apps/web/src/lib/collections.ts`, `collections.test.ts`, `src/app/actions/collections.ts` | 5 | The cap in the create action |
| `apps/web/src/lib/storage/source-sweep.ts`, `source-sweep-deps.ts`, their tests, `src/app/api/cron/source-sweep/route.ts`, `vercel.json`, `vercel-config.test.ts`, `uploads-service.ts`, its test, `src/app/api/uploads/[id]/route.ts`, `art-live-notice.tsx`, the Art layout, `supabase/service.ts`, `scripts/verify-sources.ts` | 6 | The source sweep, its cron, the served thumbnails, the Art notice, `verify:sources` |
| `apps/freshness/src/config.ts`, `indexer-db.ts`, `server.ts`, `index.ts`, their tests, `apps/freshness/package.json`, `apps/web/scripts/verify-indexer.ts` | 7 | The role's connection with verified TLS, the start and stop, `verify:indexer` through the role |
| `apps/freshness/src/recent.ts`, `health.ts`, `chain-reader.ts`, `indexer.ts`, `server.ts`, their tests, `apps/web/scripts/verify-freshness.ts`, `verify-indexer.ts` | 8 | `/health`'s status and problems |
| `supabase/migrations/20261017110000_upload_hardening.sql`, `src/lib/art/owned.ts`, `src/app/actions/uploads.ts`, `src/lib/storage/objects.ts`, `sweep.ts`, `upload-sweep-deps.ts`, `src/lib/mint/media.ts`, their tests, `src/app/api/cron/upload-sweep/route.ts`, the six scripts that record uploads, `verify-sweep.ts` | 9 | `record_upload` behind the service role; the daily upload sweep |
| `docs/MASTER_PLAN.md`, `docs/specs/2026-10-17-production-hardening.md`, the six specs this run changes, `CLAUDE.md`, `apps/web/.env.example`, `apps/freshness/.env.example` | 10 | The status line, the Security and Hosting decisions, the notes, the landing note, the commands and the variables |

---

### Task 1: The draft cap, the indexer's role and the layer sources in the database, the local ES256 key, and `verify:local`'s section 9p

**Kind:** integration: a stack restart on a new key and a migration, with every line given: an Opus implementer.

**Files:**

- Create: `supabase/migrations/20261017100000_production_hardening.sql`
- Modify: `.gitignore` (the key file), `supabase/config.toml` (the key's path and the hosted captcha block), `apps/web/package.json` (`postgres`), `pnpm-lock.yaml` (by `pnpm install --offline`), `apps/web/scripts/verify-local.ts` (the caps' setup, section 9p and its call), `apps/web/src/lib/database.types.ts` (the new columns and functions)
- Local, never committed: `supabase/signing_keys.json`
- Test: `pnpm --filter @cobweb/web verify:local`

**Interfaces:**

- Consumes: `public.indexer_targets(integer)`, `indexer_start(uuid, bigint)`, `indexer_record(integer, bigint, bigint, timestamptz, uuid[], jsonb)` and `indexer_summaries(integer)` from `20261016200000_indexer.sql`; `collections_guard_frozen_fields`'s security invoker pattern; `deployments.deployed_at`; `render_jobs` (`kind`, `state`, `finished_at`); `uploads` (`kind`, `bytes`); `verify-local.ts`'s helpers (`check`, `info`, `describe`, `expectError`, `expectNothing`, `expectSentence`, `refusedAll`, `callArt`, `countRows`, `insertCollection`, `collectionInput`, `recordUpload`, `stored`, `signInCreator`, `config`, `uniqueName`, `pause`, `ADDRESS40`, `PERMISSION`, `CHECK`, `createdJobIds`, `admin`, `anon`, `url`, `publishableKey`, `clientOptions`).
- Produces:
  - `profiles.draft_cap integer not null default 20` (0 to 1,000) and `public.collections_guard_draft_cap()` behind the `before insert` trigger `collections_guard_draft_cap`, refusing with `23514`, 'This wallet holds its limit of collections that are not deployed.' and `detail` the cap
  - the login role `cobweb_indexer` (noinherit, nobypassrls, connection limit 8, `statement_timeout` 10 s, `idle_in_transaction_session_timeout` 30 s, no password) with usage on `public` and execute on the four indexer functions
  - `collections.art_sources_deleted_at timestamptz`; `public.collections_sources_due(p_limit integer) returns jsonb` (`[{ collectionId, objects, bytes }]`, oldest deploy first) and `public.collection_sources_deleted(p_collection_id uuid) returns boolean` for the service role only, the second refusing with `23514` and "This collection's art files are not due for deletion."; `public.refuse_after_sources_deleted()` behind `uploads_refuse_after_sources_deleted` and `render_jobs_refuse_after_sources_deleted`, refusing with `23514` and "This collection's art files were deleted 90 days after its deploy, so its art cannot change."
  - in `database.types.ts`, `profiles.draft_cap: number`, `collections.art_sources_deleted_at: string | null`, `collection_sources_deleted: { Args: { p_collection_id: string }; Returns: boolean }` and `collections_sources_due: { Args: { p_limit: number }; Returns: Json }`
  - `supabase/config.toml`: `signing_keys_path = "./signing_keys.json"` and a commented `[remotes.cobweb.auth.captcha]` block

- [ ] **Step 1: The local session key, then `verify:local` on it before anything else**

The key's file is gitignored, the configuration names it and keeps the hosted captcha block commented (spec section 4.5), and the stack restarts to load it (Decision 2).

In `.gitignore`, replace:

```
!.env.example
```

with:

```
!.env.example
supabase/signing_keys.json
```

In `supabase/config.toml`, replace:

```toml
# signing_keys_path = "./signing_keys.json"
```

with:

```toml
# The local ES256 session key (docs/specs/2026-10-17-production-hardening.md, section 4.5), so local sessions are
# verified against the key set as production's are after the owner's rotation. Written once, before the first
# `supabase start`, by `echo '[]' > supabase/signing_keys.json && supabase gen signing-key --algorithm ES256 --yes`
# (the CLI reads the file before it writes); .gitignore keeps it out.
signing_keys_path = "./signing_keys.json"
```

In `supabase/config.toml`, replace:

```toml
additional_redirect_urls = ["https://cobweb-cobweb3.vercel.app/**"]
```

with:

```toml
additional_redirect_urls = ["https://cobweb-cobweb3.vercel.app/**"]

# The hosted captcha check on wallet sign-in (docs/specs/2026-10-17-production-hardening.md, sections 4.5 and 12):
# Supabase Auth verifies the Cloudflare Turnstile token with this secret before it checks the signature. Off
# locally. The owner uncomments it in the change that turns captcha on, once NEXT_PUBLIC_TURNSTILE_SITE_KEY is
# live on Vercel: a `supabase config push` with it on before the site key is live locks every sign-in out, and
# one without it turns the hosted check off.
# [remotes.cobweb.auth.captcha]
# enabled = true
# provider = "turnstile"
# secret = "env(SUPABASE_AUTH_CAPTCHA_SECRET)"
```

Run: `echo '[]' > supabase/signing_keys.json && supabase gen signing-key --algorithm ES256 --yes`
Expected: PASS, `JWT signing key appended to: supabase/signing_keys.json (now contains 1 keys)`. The file holds a private key; never print it.

Run: `git check-ignore supabase/signing_keys.json`
Expected: PASS, `supabase/signing_keys.json`.

Run: `supabase stop`
Expected: PASS, `Stopped supabase local development setup.`

Never pass `--no-backup` to it: the data volumes stay, and the next start restores from them.

Run: `supabase start > /dev/null && curl -s http://127.0.0.1:55321/auth/v1/.well-known/jwks.json`
Expected: PASS, `"alg":"ES256"`.

The start's own output lists the API keys, so it goes nowhere; the key set it serves is public.

Run: `pnpm --filter @cobweb/web verify:local`
Expected: PASS, `395 passed, 0 failed`: the unchanged checks pass on sessions and API keys the ES256 key signs.

- [ ] **Step 2: Write the failing checks**

`postgres` joins the web app's dev dependencies for the catalog reads (Decision 3).

In `apps/web/package.json`, replace:

```json
    "multiformats": "14.0.5",
```

with:

```json
    "multiformats": "14.0.5",
    "postgres": "3.4.9",
```

Run: `pnpm install --offline`
Expected: PASS, `Done in`.

`pnpm-lock.yaml` gains nine lines for `postgres@3.4.9`.

The setup raises the two wallets' caps after their sign-in; section 9p runs after the indexer's section, on fresh wallets, with the race of check 2 on two connections and the role's reads inside a transaction that is rolled back (Decision 4, Review Focus 5).

In `apps/web/scripts/verify-local.ts`, replace:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
```

with:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import postgres from 'postgres'
```

In `apps/web/scripts/verify-local.ts`, replace:

```ts
  const B: Creator = b
```

with:

```ts
  const B: Creator = b
  // Section 9p's cap: the sections below make about 42 collections for A, so both wallets may hold 1,000.
  {
    const { error } = await admin.from('profiles').update({ draft_cap: 1000 }).in('id', [A.userId, B.userId])
    if (error) info(`the draft caps were not raised: ${describe(error)}`)
  }
```

In `apps/web/scripts/verify-local.ts`, replace:

```ts
  await artIndexer(A, B)
```

with:

```ts
  await artIndexer(A, B)
  await artHardening()
```

In `apps/web/scripts/verify-local.ts`, replace:

```ts
// ---------------------------------------------------------------------------------------------
// 10. Cleanup
```

with:

```ts
// ---------------------------------------------------------------------------------------------
// 9p. Production hardening: the draft cap, the ES256 session key, the indexer's role, and the layer sources'
// functions and guards (docs/specs/2026-10-17-production-hardening.md, section 4)
// ---------------------------------------------------------------------------------------------
const DRAFT_CAP_SENTENCE = 'This wallet holds its limit of collections that are not deployed.'
const NOT_DUE_SENTENCE = "This collection's art files are not due for deletion."
const SOURCES_GONE_SENTENCE =
  "This collection's art files were deleted 90 days after its deploy, so its art cannot change."
const INDEXER_FUNCTIONS = ['indexer_record', 'indexer_start', 'indexer_summaries', 'indexer_targets']

/** The local database as its superuser, from `supabase status`'s DB_URL, for the catalog reads and the race. */
function superuser(max = 1): postgres.Sql {
  const dbUrl = config('SUPABASE_DB_URL', ['DB_URL'])
  if (!['localhost', '127.0.0.1'].includes(new URL(dbUrl).hostname)) throw new Error('DB_URL is not local.')
  return postgres(dbUrl, { max, onnotice: () => {} })
}

/**
 * Two inserts for an owner's last place under its cap, the second sent while the first's transaction is open: null
 * when the second waited on the first's lock and was then refused with the cap's message (Review Focus 5).
 */
async function raceForLastPlace(ownerId: string): Promise<string | null> {
  const sql = superuser(2)
  const first = await sql.reserve()
  const second = await sql.reserve()
  const row = () => ({ owner_id: ownerId, name: uniqueName(), symbol: 'RACE', project_type: 'generative' })
  try {
    await first`begin`
    await first`insert into public.collections ${first(row())}`
    let settled = false
    const racing = second`insert into public.collections ${second(row())}`
      .then(
        () => null,
        (error: { code?: string; message?: string }) => error,
      )
      .finally(() => {
        settled = true
      })
    await pause(300)
    if (settled) {
      await first`rollback`
      return 'the second insert did not wait for the first'
    }
    await first`commit`
    const refused = await racing
    return refused?.code === '23514' && refused.message === DRAFT_CAP_SENTENCE
      ? null
      : `the second insert: ${refused ? `${refused.code} ${refused.message}` : 'landed'}`
  } finally {
    first.release()
    second.release()
    await sql.end()
  }
}

/**
 * What `read` answers as cobweb_indexer, or the error it fails with. Inside a transaction that is rolled back, the
 * local `postgres`, which is not a superuser and so may not take the role as it is, joins it for that transaction
 * alone.
 */
async function asIndexerRole<T>(
  sql: postgres.Sql,
  read: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<{ value?: T; error?: { code?: string; message: string } }> {
  const rolledBack = 'rolled back'
  let value: T | undefined
  try {
    await sql.begin(async (tx) => {
      await tx`grant cobweb_indexer to postgres`
      await tx`set local role cobweb_indexer`
      value = await read(tx)
      throw new Error(rolledBack)
    })
  } catch (thrown) {
    const failure = thrown as { code?: string; message: string }
    if (failure.message !== rolledBack) return { error: failure }
  }
  return { value }
}

/** A creator's access token, as its session holds it. */
async function accessToken(creator: Creator): Promise<string> {
  const { data } = await creator.client.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('no access token')
  return token
}

/** A token's header, decoded. */
const jwtHeader = (token: string) =>
  JSON.parse(Buffer.from(token.split('.')[0] ?? '', 'base64url').toString('utf8')) as {
    alg?: string
    kid?: string
  }

async function artHardening(): Promise<void> {
  const C = await signInCreator()

  await check(
    "draft cap: a wallet's profile reads draft_cap 20, which neither its owner nor anon can change",
    async () => {
      const own = await C.client.from('profiles').select('draft_cap').eq('id', C.userId).single()
      if (own.error || own.data.draft_cap !== 20)
        return `read: ${own.error ? describe(own.error) : own.data.draft_cap}`
      const byOwner = await C.client.from('profiles').update({ draft_cap: 1000 }).eq('id', C.userId).select()
      const owner = expectError(byOwner.error, PERMISSION, byOwner.data)
      if (owner) return `owner: ${owner}`
      const byAnon = await anon.from('profiles').update({ draft_cap: 1000 }).eq('id', C.userId).select()
      const anonProblem = expectNothing(byAnon.error, byAnon.data)
      if (anonProblem) return `anon: ${anonProblem}`
      const { data } = await admin.from('profiles').select('draft_cap').eq('id', C.userId).single()
      return data?.draft_cap === 20 ? null : `stored ${data?.draft_cap}`
    },
  )

  await check(
    "draft cap: a fresh wallet's 21st collection not deployed is refused with 23514, the cap's message and detail 20; once the service role marks one deployed the 21st lands; a cap raised to 22 admits one more, and of two inserts sent at once for its last place the second waits for the first and is refused",
    async () => {
      const D = await signInCreator()
      const ids: string[] = []
      for (let n = 1; n <= 20; n++) {
        const made = await insertCollection(D.client)
        if (!made.row) return `collection ${n}: ${describe(made.error)}`
        ids.push(made.row.id)
      }
      const refused = await insertCollection(D.client)
      const capped = expectSentence(refused.error, CHECK, DRAFT_CAP_SENTENCE)
      if (capped) return `21st: ${capped}`
      if (refused.error?.details !== '20') return `21st: detail ${refused.error?.details}`
      const marked = await admin
        .from('collections')
        .update({
          status: 'deployed',
          max_supply: 100,
          chain_id: 1,
          contract_address: ADDRESS40(0x9e00_0001),
        })
        .eq('id', ids[0]!)
      if (marked.error) return `mark: ${describe(marked.error)}`
      const after = await insertCollection(D.client)
      if (!after.row) return `21st after a deploy: ${describe(after.error)}`
      const raised = await admin.from('profiles').update({ draft_cap: 22 }).eq('id', D.userId)
      if (raised.error) return `raise: ${describe(raised.error)}`
      const more = await insertCollection(D.client)
      if (!more.row) return `22nd under a cap of 22: ${describe(more.error)}`
      // 21 held under 22: one place left, asked for twice at once.
      return raceForLastPlace(D.userId)
    },
  )

  await check(
    "sessions: a wallet's access token is signed with ES256 under a key id /auth/v1/.well-known/jwks.json lists",
    async () => {
      const header = jwtHeader(await accessToken(C))
      if (header.alg !== 'ES256' || !header.kid) return `header ${JSON.stringify(header)}`
      const response = await fetch(`${url}/auth/v1/.well-known/jwks.json`)
      const set = (await response.json()) as { keys?: Record<string, unknown>[] }
      const key = set.keys?.find((entry) => entry.kid === header.kid)
      if (!key) return `key id ${header.kid} is not in the key set`
      return key.alg === 'ES256' && !('d' in key)
        ? null
        : `listed as ${String(key.alg)}, private part ${'d' in key}`
    },
  )

  await check(
    'sessions: getClaims verifies that token five times with at most one key-set read and no call to /auth/v1/user, and refuses it with its signature altered',
    async () => {
      const token = await accessToken(C)
      const paths: string[] = []
      const counting = ((input: RequestInfo | URL, init?: RequestInit) => {
        paths.push(new URL(input instanceof Request ? input.url : String(input)).pathname)
        return fetch(input, init)
      }) as typeof fetch
      const client = createClient(url, publishableKey, { ...clientOptions, global: { fetch: counting } })
      for (let n = 1; n <= 5; n++) {
        const { data, error } = await client.auth.getClaims(token)
        if (error || data?.claims.sub !== C.userId) return `read ${n}: ${error?.message ?? 'another subject'}`
      }
      const keyReads = paths.filter((path) => path === '/auth/v1/.well-known/jwks.json').length
      const userCalls = paths.filter((path) => path === '/auth/v1/user').length
      if (keyReads > 1 || userCalls > 0) return `${keyReads} key-set reads and ${userCalls} user calls`
      const [head, body, signature = ''] = token.split('.')
      const altered = `${head}.${body}.${signature.slice(0, 10)}${signature[10] === 'A' ? 'B' : 'A'}${signature.slice(11)}`
      const refused = await client.auth.getClaims(altered)
      if (!refused.error) return 'an altered signature was accepted'
      return paths.includes('/auth/v1/user') ? 'the altered token was sent to /auth/v1/user' : null
    },
  )

  await check(
    'indexer role: cobweb_indexer can log in, neither inherits nor bypasses row-level security, and executes the four indexer functions',
    async () => {
      const sql = superuser()
      try {
        const [role] = await sql<
          { rolcanlogin: boolean; rolinherit: boolean; rolbypassrls: boolean; rolsuper: boolean }[]
        >`
          select rolcanlogin, rolinherit, rolbypassrls, rolsuper from pg_catalog.pg_roles where rolname = 'cobweb_indexer'`
        if (!role) return 'the role does not exist'
        if (!role.rolcanlogin || role.rolinherit || role.rolbypassrls || role.rolsuper)
          return `attributes ${JSON.stringify(role)}`
        const [settings] = await sql<{ setconfig: string[] }[]>`
          select s.setconfig from pg_catalog.pg_db_role_setting s
          join pg_catalog.pg_roles r on r.oid = s.setrole where r.rolname = 'cobweb_indexer' and s.setdatabase = 0`
        const wanted = ['idle_in_transaction_session_timeout=30s', 'statement_timeout=10s']
        if (JSON.stringify([...(settings?.setconfig ?? [])].sort()) !== JSON.stringify(wanted))
          return `settings ${JSON.stringify(settings?.setconfig)}`
        const granted = await sql<{ proname: string }[]>`
          select p.proname from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = any(${INDEXER_FUNCTIONS})
            and has_function_privilege('cobweb_indexer', p.oid, 'execute')
          order by p.proname`
        if (granted.map((row) => row.proname).join() !== INDEXER_FUNCTIONS.join())
          return `executes ${granted.map((row) => row.proname).join(', ')}`
        const { value, error } = await asIndexerRole(sql, async (tx) => {
          const [read] = await tx<{ targets: unknown; summaries: unknown }[]>`
            select public.indexer_targets(1) as targets, public.indexer_summaries(1) as summaries`
          return read
        })
        if (error) return `as the role: ${error.code} ${error.message}`
        return Array.isArray(value?.targets) && Array.isArray(value?.summaries)
          ? null
          : `as the role: ${JSON.stringify(value)}`
      } finally {
        await sql.end()
      }
    },
  )

  await check(
    'indexer role: it reads no table or view in public, private, auth or storage, and executes no other function anon cannot',
    async () => {
      const sql = superuser()
      try {
        const readable = await sql<{ name: string }[]>`
          select n.nspname || '.' || c.relname as name from pg_catalog.pg_class c
          join pg_catalog.pg_namespace n on n.oid = c.relnamespace
          where n.nspname in ('public', 'private', 'auth', 'storage') and c.relkind in ('r', 'v', 'm', 'p', 'f')
            and has_table_privilege('cobweb_indexer', c.oid, 'select')`
        if (readable.length) return `reads ${readable.map((row) => row.name).join(', ')}`
        const extra = await sql<{ name: string }[]>`
          select n.nspname || '.' || p.proname as name from pg_catalog.pg_proc p
          join pg_catalog.pg_namespace n on n.oid = p.pronamespace
          where has_function_privilege('cobweb_indexer', p.oid, 'execute')
            and not has_function_privilege('anon', p.oid, 'execute')
          order by 1`
        const want = INDEXER_FUNCTIONS.map((name) => `public.${name}`).join()
        if (extra.map((row) => row.name).join() !== want)
          return `executes ${extra.map((row) => row.name).join(', ')}`
        // And in practice: a table read as the role is refused.
        const { error } = await asIndexerRole(sql, (tx) => tx`select count(*) from public.collections`)
        return error?.code === '42501' ? null : `public.collections: ${error ? error.code : 'read'}`
      } finally {
        await sql.end()
      }
    },
  )

  const col = await insertCollection(C.client)
  if (!col.row) throw new Error(`setup: ${describe(col.error)}`)
  const cid = col.row.id

  await check(
    'sources: collections_sources_due and collection_sources_deleted run for the service role only',
    async () => {
      const refused = refusedAll([
        [
          'anon due',
          (await callArt(anon, 'collections_sources_due', { p_limit: 5 })).error,
          PERMISSION,
          'permission denied',
        ],
        [
          'owner due',
          (await callArt(C.client, 'collections_sources_due', { p_limit: 5 })).error,
          PERMISSION,
          'permission denied',
        ],
        [
          'anon mark',
          (await callArt(anon, 'collection_sources_deleted', { p_collection_id: cid })).error,
          PERMISSION,
          'permission denied',
        ],
        [
          'owner mark',
          (await callArt(C.client, 'collection_sources_deleted', { p_collection_id: cid })).error,
          PERMISSION,
          'permission denied',
        ],
      ])
      if (refused) return refused
      const due = await callArt(admin, 'collections_sources_due', { p_limit: 1000 })
      if (due.error || !Array.isArray(due.data)) return `service due: ${describe(due.error)}`
      if ((due.data as { collectionId: string }[]).some((entry) => entry.collectionId === cid))
        return 'a draft is due'
      const mark = await callArt(admin, 'collection_sources_deleted', { p_collection_id: cid })
      return expectSentence(mark.error, CHECK, NOT_DUE_SENTENCE)
    },
  )

  await check('sources: the owner reads art_sources_deleted_at and no client sets it', async () => {
    const read = await C.client.from('collections').select('art_sources_deleted_at').eq('id', cid).single()
    if (read.error || read.data.art_sources_deleted_at !== null)
      return `read: ${read.error ? describe(read.error) : read.data.art_sources_deleted_at}`
    const now = new Date().toISOString()
    const updated = await C.client
      .from('collections')
      .update({ art_sources_deleted_at: now })
      .eq('id', cid)
      .select()
    const update = expectError(updated.error, PERMISSION, updated.data)
    if (update) return `update: ${update}`
    const inserted = await C.client
      .from('collections')
      .insert(collectionInput({ art_sources_deleted_at: now }))
      .select()
    const insert = expectError(inserted.error, PERMISSION, inserted.data)
    if (insert) return `insert: ${insert}`
    const byAnon = await anon
      .from('collections')
      .update({ art_sources_deleted_at: now })
      .eq('id', cid)
      .select()
    const anonProblem = expectNothing(byAnon.error, byAnon.data)
    if (anonProblem) return `anon: ${anonProblem}`
    return (await stored(cid))?.status === 'draft' &&
      (await admin.from('collections').select('art_sources_deleted_at').eq('id', cid).single()).data
        ?.art_sources_deleted_at === null
      ? null
      : 'the mark was set'
  })

  await check(
    'sources: once a collection is marked, a new uploads row and a new render job for it are refused',
    async () => {
      // The sweep marks only a due collection; the guards stand for any marked one, so the service role marks a draft.
      const mark = await admin
        .from('collections')
        .update({ art_sources_deleted_at: new Date().toISOString() })
        .eq('id', cid)
      if (mark.error) return `mark: ${describe(mark.error)}`
      const upload = await recordUpload(C.client, cid)
      const job = await admin
        .from('render_jobs')
        .insert({
          collection_id: cid,
          kind: 'real',
          token_count: 1,
          fee_per_token_wei: 0,
          quote_total_wei: 0,
        })
        .select('id')
      for (const row of (job.data ?? []) as { id: string }[]) createdJobIds.add(row.id)
      const refused = refusedAll([
        ['upload', upload.error, CHECK, SOURCES_GONE_SENTENCE],
        ['render job', job.error as DbError, CHECK, SOURCES_GONE_SENTENCE],
      ])
      if (refused) return refused
      const rows =
        (await countRows('uploads', 'collection_id', cid)) +
        (await countRows('render_jobs', 'collection_id', cid))
      return rows === 0 ? null : `${rows} row(s) written`
    },
  )
}

// ---------------------------------------------------------------------------------------------
// 10. Cleanup
```

- [ ] **Step 3: Run the checks to see them fail**

Run: `pnpm --filter @cobweb/web verify:local`
Expected: FAIL. The earlier sections and the two session checks pass, since the key is already ES256, and the other seven checks of section 9p fail on the missing column, role and functions: `INFO the draft caps were not raised` and `397 passed, 7 failed`.

- [ ] **Step 4: The migration**

The cap and its trigger, the role, then the layer sources' column, functions and guards (spec section 4).

Create `supabase/migrations/20261017100000_production_hardening.sql`:

```sql
-- Production hardening in code (docs/specs/2026-10-17-production-hardening.md, section 4): the per-wallet cap on
-- collections that are not deployed, read from profiles.draft_cap by a trigger that serializes one owner's inserts;
-- cobweb_indexer, the login role the freshness server's indexer connects as, which executes its four functions and
-- nothing else; and the layer sources' lifecycle: collections.art_sources_deleted_at, the two service-role functions
-- the daily source sweep calls, and the triggers that refuse a new upload or render job once a collection's
-- original files are gone.

-- ---------------------------------------------------------------------------------------------
-- The draft cap (section 4.1)
-- ---------------------------------------------------------------------------------------------
alter table public.profiles
  add column draft_cap integer not null default 20 check (draft_cap between 0 and 1000);

comment on column public.profiles.draft_cap is
  'How many collections that are not deployed the wallet may hold; the collections insert trigger refuses the next. The owner reads it through its select grant; only the service role changes it, so support can raise one wallet''s cap.';

-- Security invoker, as collections_guard_frozen_fields: a creator counts the rows row-level security shows it, its
-- own, and the service role sees all of one owner's.
create function public.collections_guard_draft_cap()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_cap integer;
  v_held integer;
begin
  -- One owner's inserts run one at a time, so two at once cannot both take the last place.
  perform pg_advisory_xact_lock(hashtextextended('collections_draft_cap:' || new.owner_id::text, 0));
  v_cap := coalesce((select p.draft_cap from public.profiles p where p.id = new.owner_id), 20);
  select count(*) into v_held
  from public.collections c
  where c.owner_id = new.owner_id and c.status <> 'deployed';
  if v_held >= v_cap then
    raise exception 'This wallet holds its limit of collections that are not deployed.'
      using errcode = '23514', detail = v_cap::text;
  end if;
  return new;
end;
$$;

create trigger collections_guard_draft_cap
before insert on public.collections
for each row execute function public.collections_guard_draft_cap();

-- ---------------------------------------------------------------------------------------------
-- The indexer's role (section 4.2)
-- ---------------------------------------------------------------------------------------------
-- No password: no migration holds a secret, and a role without one cannot log in until the owner sets it. A role
-- outlives `supabase db reset`, hence the existence check.
do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles r where r.rolname = 'cobweb_indexer') then
    create role cobweb_indexer with login noinherit nocreatedb nocreaterole nobypassrls connection limit 8;
  end if;
end;
$$;
alter role cobweb_indexer set statement_timeout = '10s';
alter role cobweb_indexer set idle_in_transaction_session_timeout = '30s';

comment on role cobweb_indexer is
  'The freshness server''s indexer: executes indexer_targets, indexer_start, indexer_record and indexer_summaries and nothing else. It logs in with a password the owner sets outside git (alter role cobweb_indexer with password ...), through the session pooler as cobweb_indexer.<project ref>, from the server''s INDEXER_DATABASE_URL.';

-- The four functions are security definer, so the role needs no table grant; Supabase's default privileges name
-- anon, authenticated and service_role, never a new role. service_role keeps its execute grants.
grant usage on schema public to cobweb_indexer;
grant execute on function public.indexer_targets(integer) to cobweb_indexer;
grant execute on function public.indexer_start(uuid, bigint) to cobweb_indexer;
grant execute on function public.indexer_record(integer, bigint, bigint, timestamptz, uuid[], jsonb) to cobweb_indexer;
grant execute on function public.indexer_summaries(integer) to cobweb_indexer;

-- ---------------------------------------------------------------------------------------------
-- The layer sources (section 4.3)
-- ---------------------------------------------------------------------------------------------
-- The owner reads it through the table's select grant; no client role writes it, since the reservation
-- migration's column grants name the columns a creator may set.
alter table public.collections add column art_sources_deleted_at timestamptz;

comment on column public.collections.art_sources_deleted_at is
  'When the daily source sweep deleted the collection''s original files (the layers, assets and placeholders folders of the art bucket), 90 days after its deploy and its last real render; null before. Set only by collection_sources_deleted.';

-- The collections whose original files are due for deletion, oldest deploy first, at most p_limit: deployed, not
-- marked, deployed at least 90 days ago, with a real render job done whose latest finish is at least 90 days ago
-- and no real job outside done and failed. objects and bytes count the uploads rows of the three kinds the sweep
-- deletes. 90 days is SOURCE_RETENTION_DAYS in apps/web/src/lib/storage/source-sweep.ts.
create function public.collections_sources_due(p_limit integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with cutoff as (select now() - interval '90 days' as at),
  due as (
    select c.id, d.deployed_at
    from public.collections c
    join public.deployments d on d.collection_id = c.id
    cross join cutoff
    where c.status = 'deployed'
      and c.art_sources_deleted_at is null
      and d.deployed_at <= cutoff.at
      and (
        select max(j.finished_at) from public.render_jobs j
        where j.collection_id = c.id and j.kind = 'real' and j.state = 'done'
      ) <= cutoff.at
      and not exists (
        select 1 from public.render_jobs j
        where j.collection_id = c.id and j.kind = 'real' and j.state not in ('done', 'failed')
      )
    order by d.deployed_at, c.id
    limit greatest(p_limit, 0)
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'collectionId', due.id,
        'objects', (
          select count(*) from public.uploads u
          where u.collection_id = due.id and u.kind in ('layer_image', 'asset', 'placeholder')
        ),
        'bytes', (
          select coalesce(sum(u.bytes), 0) from public.uploads u
          where u.collection_id = due.id and u.kind in ('layer_image', 'asset', 'placeholder')
        )
      )
      order by due.deployed_at, due.id
    ),
    '[]'::jsonb
  )
  from due;
$$;

revoke all on function public.collections_sources_due(integer) from public, anon, authenticated;
grant execute on function public.collections_sources_due(integer) to service_role;

-- Marks a collection's original files deleted, under the collection's lock: false when the mark is set already,
-- true when it sets it, refused when the rule above does not hold. The sweep calls it once the three folders list
-- empty, so a failed run leaves no mark and the next resumes. 90 days is SOURCE_RETENTION_DAYS in
-- apps/web/src/lib/storage/source-sweep.ts.
create function public.collection_sources_deleted(p_collection_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cutoff timestamptz := now() - interval '90 days';
  v_status public.collection_status;
  v_marked timestamptz;
begin
  select c.status, c.art_sources_deleted_at into v_status, v_marked
  from public.collections c where c.id = p_collection_id for update;
  if found and v_marked is not null then
    return false;
  end if;
  if not found
    or v_status <> 'deployed'
    or not exists (
      select 1 from public.deployments d where d.collection_id = p_collection_id and d.deployed_at <= v_cutoff
    )
    or coalesce((
      select max(j.finished_at) from public.render_jobs j
      where j.collection_id = p_collection_id and j.kind = 'real' and j.state = 'done'
    ) > v_cutoff, true)
    or exists (
      select 1 from public.render_jobs j
      where j.collection_id = p_collection_id and j.kind = 'real' and j.state not in ('done', 'failed')
    )
  then
    raise exception 'This collection''s art files are not due for deletion.' using errcode = '23514';
  end if;
  update public.collections set art_sources_deleted_at = now() where id = p_collection_id;
  return true;
end;
$$;

revoke all on function public.collection_sources_deleted(uuid) from public, anon, authenticated;
grant execute on function public.collection_sources_deleted(uuid) to service_role;

-- Once a collection is marked, a new uploads row or render job for it is refused: the app reaches neither path
-- after a final render, since the art stays locked, and these stop a direct call from writing rows whose files are
-- gone.
create function public.refuse_after_sources_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.collections c
    where c.id = new.collection_id and c.art_sources_deleted_at is not null
  ) then
    raise exception 'This collection''s art files were deleted 90 days after its deploy, so its art cannot change.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.refuse_after_sources_deleted() from public, anon, authenticated;

create trigger uploads_refuse_after_sources_deleted
before insert on public.uploads
for each row execute function public.refuse_after_sources_deleted();

create trigger render_jobs_refuse_after_sources_deleted
before insert on public.render_jobs
for each row execute function public.refuse_after_sources_deleted();
```

- [ ] **Step 5: Apply the migration**

Run: `supabase migration up --local`
Expected: PASS, `Applying migration 20261017100000_production_hardening.sql...`.

Should the migration have to be undone on the local database (to apply a corrected file, for instance), this SQL does it; pipe it to `docker exec -i supabase_db_cobweb psql -U postgres -v ON_ERROR_STOP=1` from the repo root, then apply the migration again with `supabase migration up --local`. The role goes with its grants, settings and comment.

```sql
begin;
drop trigger render_jobs_refuse_after_sources_deleted on public.render_jobs;
drop trigger uploads_refuse_after_sources_deleted on public.uploads;
drop function public.refuse_after_sources_deleted();
drop function public.collection_sources_deleted(uuid);
drop function public.collections_sources_due(integer);
alter table public.collections drop column art_sources_deleted_at;
revoke execute on function public.indexer_summaries(integer) from cobweb_indexer;
revoke execute on function public.indexer_record(integer, bigint, bigint, timestamptz, uuid[], jsonb) from cobweb_indexer;
revoke execute on function public.indexer_start(uuid, bigint) from cobweb_indexer;
revoke execute on function public.indexer_targets(integer) from cobweb_indexer;
revoke usage on schema public from cobweb_indexer;
drop role cobweb_indexer;
drop trigger collections_guard_draft_cap on public.collections;
drop function public.collections_guard_draft_cap();
alter table public.profiles drop column draft_cap;
delete from supabase_migrations.schema_migrations where version = '20261017100000';
commit;
```

- [ ] **Step 6: The types**

The new columns and functions in the generator's order and form (checked against `supabase gen types typescript --local`).

In `apps/web/src/lib/database.types.ts`, replace:

```ts
          art_locked_at: string | null
```

with:

```ts
          art_locked_at: string | null
          art_sources_deleted_at: string | null
```

In `apps/web/src/lib/database.types.ts`, replace:

```ts
        Insert: {
          art_deferred?: boolean
          art_locked_at?: string | null
          canvas_height?: number | null
          canvas_width?: number | null
```

with:

```ts
        Insert: {
          art_deferred?: boolean
          art_locked_at?: string | null
          art_sources_deleted_at?: string | null
          canvas_height?: number | null
          canvas_width?: number | null
```

In `apps/web/src/lib/database.types.ts`, replace:

```ts
          art_locked_at?: string | null
          canvas_height?: number | null
```

with:

```ts
          art_locked_at?: string | null
          art_sources_deleted_at?: string | null
          canvas_height?: number | null
```

In `apps/web/src/lib/database.types.ts`, replace:

```ts
        Row: {
          created_at: string
          id: string
```

with:

```ts
        Row: {
          created_at: string
          draft_cap: number
          id: string
```

In `apps/web/src/lib/database.types.ts`, replace:

```ts
          created_at?: string
          id: string
```

with:

```ts
          created_at?: string
          draft_cap?: number
          id: string
```

In `apps/web/src/lib/database.types.ts`, replace:

```ts
        Update: {
          created_at?: string
          id?: string
```

with:

```ts
        Update: {
          created_at?: string
          draft_cap?: number
          id?: string
```

In `apps/web/src/lib/database.types.ts`, replace:

```ts
      }
      indexer_record: {
```

with:

```ts
      }
      collection_sources_deleted: {
        Args: { p_collection_id: string }
        Returns: boolean
      }
      collections_sources_due: { Args: { p_limit: number }; Returns: Json }
      indexer_record: {
```

- [ ] **Step 7: Run the checks to see them pass**

Run: `pnpm --filter @cobweb/web verify:local`
Expected: PASS, `404 passed, 0 failed`: section 9p's nine beside the 395 before.

- [ ] **Step 8: Format, run the root checks and commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
pnpm exec prettier --write apps/web/src/lib/database.types.ts apps/web/scripts/verify-local.ts apps/web/package.json
pnpm typecheck && pnpm lint && pnpm test
git add .gitignore supabase/config.toml supabase/migrations/20261017100000_production_hardening.sql apps/web/package.json pnpm-lock.yaml apps/web/scripts/verify-local.ts apps/web/src/lib/database.types.ts
git commit -m "$(cat <<'EOF'
Add the draft cap, the indexer's login role and the layer sources' functions and guards, sign local sessions with an ES256 key, and add verify:local's section 9p

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: the tests are unchanged (web 902 in 94 files, shared 105 in 14, freshness 198 in 17, dna 60, render 117, worker 282); `git show --stat HEAD` lists no `supabase/signing_keys.json`.

---

### Task 2: The Content-Security-Policy's module, the violation reports' reader and the report endpoint

**Kind:** transcription. The plan carries every line: a Sonnet implementer.

**Files:**

- Create: `apps/web/src/lib/security/csp.ts`, `apps/web/src/lib/security/csp-report.ts`, `apps/web/src/app/api/csp-report/route.ts`, and the tests `apps/web/src/lib/security/csp.test.ts`, `csp-report.test.ts`, `csp-report-route.test.ts`
- Test: the three new test files

**Interfaces:**

- Consumes: `ChainConfig` and `availableChains` from `@cobweb/shared`; `mediaBase` and `ipfsGateway` from `@/lib/mint/page-urls` and `chains` from `@/lib/wagmi` (in the tests); zod.
- Produces:
  - `csp.ts`: `CspMode = 'enforce' | 'report-only' | 'off'`, `RouteClass = 'page' | 'api'`, `CspEnv`, `CspSources = { supabase; freshness; storage; media: string | null; gateway: string; rpcs: string[]; turnstile; development; local: boolean; host: string }`, `CSP_REPORT_PATH = '/api/csp-report'`, `FRAME_POLICY = "frame-ancestors 'none'"`, `DEV_WALLET_ORIGIN = 'http://127.0.0.1:8787'`, `TURNSTILE_ORIGIN`, `WALLET_CONNECT_ORIGINS`, `METAMASK_ORIGINS`, `cspModeOf(env)`, `routeClassOf(pathname)`, `originOf(url)`, `cspSourcesOf(env, chains, host)`, `pagePolicy(nonce, sources, mode)`, `newNonce()`, `cspHeaders({ mode, routeClass, nonce, sources, reportOrigin }): { request; response }` (no enforced policy in report-only mode, Decision 7)
  - `csp-report.ts`: `REPORT_MAX_BYTES = 16_384`, `REPORT_LINES_PER_MINUTE = 100`, `REPORT_FIELD_MAX = 256`, `Violation = { disposition; directive; blocked; page; source: string | null; line: number | null; column: number | null }`, `cleanField(value)`, `violationsOf(contentType, body): { violations: Violation[]; malformed: number }`, `violationLine(violation)` (one JSON line), `reportLimiter(perMinute?): { allow(now); drop(now); dropped(now) }` (Decision 6)
  - `route.ts`: `POST(request: Request): Promise<Response>`, answering 415, 413, 400 or 204

- [ ] **Step 1: Write the failing tests**

The policy's tests read the media base and the gateway from the app's own module and the chains from `lib/wagmi.ts` (decision 12). The report tests build their control characters with `String.fromCharCode` (Global Constraints) and pin Review Focus 1.

Create `apps/web/src/lib/security/csp.test.ts`:

```ts
import { availableChains, LAUNCH_CHAINS } from '@cobweb/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ipfsGateway, mediaBase } from '@/lib/mint/page-urls'
import {
  CSP_REPORT_PATH,
  cspHeaders,
  cspModeOf,
  cspSourcesOf,
  DEV_WALLET_ORIGIN,
  FRAME_POLICY,
  METAMASK_ORIGINS,
  newNonce,
  originOf,
  pagePolicy,
  routeClassOf,
  TURNSTILE_ORIGIN,
  WALLET_CONNECT_ORIGINS,
  type CspSources,
} from './csp'

// The storage config the media base reads carries the server marker; RainbowKit builds its config when
// lib/wagmi.ts loads, and this test reads only its chains.
vi.mock('server-only', () => ({}))
vi.mock('@rainbow-me/rainbowkit', () => ({ getDefaultConfig: (parameters: unknown) => parameters }))

const NONCE = 'bm9uY2Utb2YtdGhlLXRlc3Q='

/** A production deploy's sources: everything on https, on Vercel, no site key. */
const PRODUCTION: CspSources = {
  supabase: 'https://abcdefghijklmnopqrst.supabase.co',
  freshness: 'https://fresh.cobweb.example',
  storage: 'https://account.r2.cloudflarestorage.com',
  media: 'https://media.cobweb.example',
  gateway: 'https://cobweb.myfilebase.com',
  rpcs: ['https://mainnet.base.org', 'https://arb1.arbitrum.io'],
  turnstile: false,
  development: false,
  local: false,
  host: 'cobweb.example',
}

/** The policy's directives by name. */
function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy.split('; ').map((entry) => {
      const [name = '', ...values] = entry.split(' ')
      return [name, values]
    }),
  )
}

describe('cspModeOf (docs/specs/2026-10-17-production-hardening.md, decision 14)', () => {
  it('reads each mode CSP_MODE names, on Vercel or off it', () => {
    for (const mode of ['enforce', 'report-only', 'off'] as const) {
      expect(cspModeOf({ CSP_MODE: mode })).toBe(mode)
      expect(cspModeOf({ CSP_MODE: mode, VERCEL: '1' })).toBe(mode)
    }
  })

  it('reads unset or unknown as report-only on Vercel and enforce off it', () => {
    expect(cspModeOf({})).toBe('enforce')
    expect(cspModeOf({ VERCEL: '1' })).toBe('report-only')
    expect(cspModeOf({ CSP_MODE: 'strict' })).toBe('enforce')
    expect(cspModeOf({ CSP_MODE: 'ENFORCE', VERCEL: '1' })).toBe('report-only')
    expect(cspModeOf({ CSP_MODE: '' })).toBe('enforce')
  })
})

describe('routeClassOf', () => {
  it('reads /api and below as api, everything else as a page', () => {
    expect(['/api', '/api/csp-report', '/api/uploads/x'].map(routeClassOf)).toEqual(['api', 'api', 'api'])
    expect(['/', '/collections', '/night-owls', '/apiary', '/api-docs'].map(routeClassOf)).toEqual([
      'page',
      'page',
      'page',
      'page',
      'page',
    ])
  })
})

describe('originOf', () => {
  it('answers the origin of a URL with a path, and null for a blank or unparsable value', () => {
    expect(originOf('https://abc.supabase.co/storage/v1/s3')).toBe('https://abc.supabase.co')
    expect(originOf('http://127.0.0.1:55321/')).toBe('http://127.0.0.1:55321')
    expect(originOf(' https://fresh.example ')).toBe('https://fresh.example')
    for (const value of [undefined, '', '  ', 'not a url', '127.0.0.1:3100', 'data:image/png;base64,AA'])
      expect(originOf(value)).toBeNull()
  })
})

describe('cspSourcesOf (decision 12)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  const env = {
    NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
    NEXT_PUBLIC_FRESHNESS_URL: 'https://fresh.cobweb.example/',
    ART_S3_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
    MINT_PAGE_MEDIA_URL: 'https://media.cobweb.example/pages',
    IPFS_GATEWAY_URL: 'https://cobweb.myfilebase.com/ipfs',
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
    NODE_ENV: 'production',
    VERCEL: '1',
  }

  it('reads each variable as its origin', () => {
    expect(cspSourcesOf(env, [], 'cobweb.example')).toEqual({
      supabase: 'https://abcdefghijklmnopqrst.supabase.co',
      freshness: 'https://fresh.cobweb.example',
      storage: 'https://account.r2.cloudflarestorage.com',
      media: 'https://media.cobweb.example',
      gateway: 'https://cobweb.myfilebase.com',
      rpcs: [],
      turnstile: true,
      development: false,
      local: false,
      host: 'cobweb.example',
    })
  })

  it('falls back as the app does: media on the Supabase origin, the gateway on ipfs.io, the rest absent', () => {
    expect(
      cspSourcesOf({ NEXT_PUBLIC_SUPABASE_URL: env.NEXT_PUBLIC_SUPABASE_URL }, [], 'localhost:3000'),
    ).toEqual({
      supabase: 'https://abcdefghijklmnopqrst.supabase.co',
      freshness: null,
      storage: null,
      media: 'https://abcdefghijklmnopqrst.supabase.co',
      gateway: 'https://ipfs.io',
      rpcs: [],
      turnstile: false,
      development: false,
      local: true,
      host: 'localhost:3000',
    })
    expect(
      cspSourcesOf({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: '  ', NODE_ENV: 'development' }, [], 'h').turnstile,
    ).toBe(false)
    expect(cspSourcesOf({ NODE_ENV: 'development' }, [], 'h').development).toBe(true)
  })

  it('matches the origins of mediaBase() and ipfsGateway() under the same settings, set or not', () => {
    for (const settings of [env, { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:55321' }]) {
      for (const name of ['MINT_PAGE_MEDIA_URL', 'IPFS_GATEWAY_URL', 'NEXT_PUBLIC_SUPABASE_URL'] as const)
        vi.stubEnv(name, (settings as Record<string, string | undefined>)[name] ?? '')
      const sources = cspSourcesOf(settings, [], 'h')
      expect(sources.media).toBe(new URL(mediaBase()).origin)
      expect(sources.gateway).toBe(new URL(ipfsGateway()).origin)
    }
  })

  it("lists the RPC origin of every chain lib/wagmi.ts's transports call, once each", async () => {
    const { chains } = await import('@/lib/wagmi')
    const { rpcs } = cspSourcesOf({}, availableChains(), 'h')
    for (const chain of chains) expect(rpcs).toContain(new URL(chain.rpcUrls.default.http[0]!).origin)
    expect(new Set(rpcs).size).toBe(rpcs.length)
  })

  it('lists the test chains only where they are shown', () => {
    const anvil = 'http://127.0.0.1:8545'
    expect(cspSourcesOf({}, availableChains(false), 'h').rpcs).toContain(anvil)
    expect(cspSourcesOf({}, availableChains(true), 'h').rpcs).not.toContain(anvil)
    expect(cspSourcesOf({}, availableChains(true), 'h').rpcs).toHaveLength(LAUNCH_CHAINS.length)
  })
})

describe('pagePolicy (section 5.2)', () => {
  it('writes every directive in order for a production deploy enforced on Vercel', () => {
    const rpcs = PRODUCTION.rpcs.join(' ')
    const wallets = [...WALLET_CONNECT_ORIGINS, ...METAMASK_ORIGINS].join(' ')
    expect(pagePolicy(NONCE, PRODUCTION, 'enforce')).toBe(
      [
        "default-src 'self'",
        `script-src 'self' 'nonce-${NONCE}' 'strict-dynamic'`,
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "img-src 'self' data: blob: https:",
        "media-src 'self' blob: https://account.r2.cloudflarestorage.com https://media.cobweb.example https://cobweb.myfilebase.com",
        "font-src 'self' https://fonts.gstatic.com",
        `connect-src 'self' https://abcdefghijklmnopqrst.supabase.co https://fresh.cobweb.example https://account.r2.cloudflarestorage.com https://cobweb.myfilebase.com ${rpcs} ${wallets}`,
        'frame-src https://verify.walletconnect.org https://verify.walletconnect.com',
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        'upgrade-insecure-requests',
        `report-uri ${CSP_REPORT_PATH}`,
        'report-to csp',
      ].join('; '),
    )
  })

  it('carries the nonce in script-src alone, never in style-src', () => {
    const policy = pagePolicy(NONCE, PRODUCTION, 'enforce')
    expect(policy.split(NONCE)).toHaveLength(2)
    expect(directives(policy).get('script-src')).toContain(`'nonce-${NONCE}'`)
    expect(
      directives(policy)
        .get('style-src')!
        .some((source) => source.startsWith("'nonce-")),
    ).toBe(false)
  })

  it("adds 'unsafe-eval' and the dev server's websocket only in development", () => {
    const production = directives(pagePolicy(NONCE, PRODUCTION, 'enforce'))
    expect(production.get('script-src')).not.toContain("'unsafe-eval'")
    expect(production.get('connect-src')!.some((source) => source.startsWith('ws://'))).toBe(false)
    const development = directives(pagePolicy(NONCE, { ...PRODUCTION, development: true }, 'enforce'))
    expect(development.get('script-src')).toContain("'unsafe-eval'")
    expect(development.get('connect-src')).toContain('ws://cobweb.example')
  })

  it("adds the dev wallet's signer only off Vercel", () => {
    expect(directives(pagePolicy(NONCE, PRODUCTION, 'enforce')).get('connect-src')).not.toContain(
      DEV_WALLET_ORIGIN,
    )
    expect(
      directives(pagePolicy(NONCE, { ...PRODUCTION, local: true }, 'enforce')).get('connect-src'),
    ).toContain(DEV_WALLET_ORIGIN)
  })

  it('upgrades insecure requests only when enforced on Vercel', () => {
    const upgrades = (sources: CspSources, mode: 'enforce' | 'report-only') =>
      directives(pagePolicy(NONCE, sources, mode)).has('upgrade-insecure-requests')
    expect(upgrades(PRODUCTION, 'enforce')).toBe(true)
    expect(upgrades(PRODUCTION, 'report-only')).toBe(false)
    expect(upgrades({ ...PRODUCTION, local: true }, 'enforce')).toBe(false)
  })

  it("names Cloudflare's script and frame only with a site key", () => {
    const without = directives(pagePolicy(NONCE, PRODUCTION, 'enforce'))
    expect([...without.get('script-src')!, ...without.get('frame-src')!]).not.toContain(TURNSTILE_ORIGIN)
    const withKey = directives(pagePolicy(NONCE, { ...PRODUCTION, turnstile: true }, 'enforce'))
    expect(withKey.get('script-src')).toContain(TURNSTILE_ORIGIN)
    expect(withKey.get('frame-src')).toContain(TURNSTILE_ORIGIN)
  })

  it('lists each source once, and the local services that answer over http for images and media', () => {
    const local: CspSources = {
      supabase: 'http://127.0.0.1:55321',
      freshness: 'http://127.0.0.1:3100',
      storage: 'http://127.0.0.1:55321',
      media: 'http://127.0.0.1:55321',
      gateway: 'https://ipfs.io',
      rpcs: ['https://mainnet.base.org', 'http://127.0.0.1:8545', 'https://mainnet.base.org'],
      turnstile: false,
      development: true,
      local: true,
      host: 'localhost:3000',
    }
    for (const [name, sources] of directives(pagePolicy(NONCE, local, 'enforce')))
      expect(new Set(sources).size, name).toBe(sources.length)
    const policy = directives(pagePolicy(NONCE, local, 'enforce'))
    expect(policy.get('img-src')).toEqual(["'self'", 'data:', 'blob:', 'https:', 'http://127.0.0.1:55321'])
    expect(policy.get('media-src')).toEqual(["'self'", 'blob:', 'http://127.0.0.1:55321', 'https://ipfs.io'])
  })
})

describe('cspHeaders (section 5.2)', () => {
  const input = { nonce: NONCE, sources: PRODUCTION, reportOrigin: 'https://cobweb.example' }
  const policy = pagePolicy(NONCE, PRODUCTION, 'enforce')
  const reportOnly = pagePolicy(NONCE, PRODUCTION, 'report-only')
  const reporting = `csp="https://cobweb.example${CSP_REPORT_PATH}"`

  it('puts the enforced policy on a page request and its response', () => {
    expect(cspHeaders({ ...input, mode: 'enforce', routeClass: 'page' })).toEqual({
      request: { 'content-security-policy': policy, 'x-nonce': NONCE },
      response: { 'Content-Security-Policy': policy, 'Reporting-Endpoints': reporting },
    })
  })

  it('puts the report-only policy on a page request and its response, with no enforced policy', () => {
    expect(cspHeaders({ ...input, mode: 'report-only', routeClass: 'page' })).toEqual({
      request: { 'content-security-policy-report-only': reportOnly, 'x-nonce': NONCE },
      response: { 'Content-Security-Policy-Report-Only': reportOnly, 'Reporting-Endpoints': reporting },
    })
  })

  it('answers the framing policy alone for a page when off, and for an API route in every mode', () => {
    const framing = { request: {}, response: { 'Content-Security-Policy': FRAME_POLICY } }
    expect(cspHeaders({ ...input, mode: 'off', routeClass: 'page' })).toEqual(framing)
    for (const mode of ['enforce', 'report-only', 'off'] as const)
      expect(cspHeaders({ ...input, mode, routeClass: 'api' })).toEqual(framing)
  })

  it('never carries the framing policy alone on the request, where Next would find no nonce', () => {
    for (const mode of ['enforce', 'report-only', 'off'] as const)
      for (const routeClass of ['page', 'api'] as const)
        for (const value of Object.values(cspHeaders({ ...input, mode, routeClass }).request))
          expect(value).not.toBe(FRAME_POLICY)
  })
})

describe('newNonce', () => {
  it('answers 24 base64 characters, a new one each call', () => {
    const first = newNonce()
    expect(first).toMatch(/^[A-Za-z0-9+/]{22}==$/)
    expect(newNonce()).not.toBe(first)
  })
})
```

Create `apps/web/src/lib/security/csp-report.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  cleanField,
  REPORT_FIELD_MAX,
  REPORT_LINES_PER_MINUTE,
  reportLimiter,
  violationLine,
  violationsOf,
  type Violation,
} from './csp-report'

/** A report-uri body, as browsers post it with `application/csp-report`. */
const legacy = (report: Record<string, unknown>) => ({
  'csp-report': {
    'document-uri': 'https://cobweb.example/night-owls?ref=x#mint',
    'violated-directive': "script-src-elem 'self'",
    'effective-directive': 'script-src-elem',
    'blocked-uri': 'https://evil.example/x.js?token=secret',
    'original-policy': "default-src 'self'; script-src 'nonce-abc'",
    disposition: 'enforce',
    ...report,
  },
})

/** A Reporting API report, as browsers post a list of them with `application/reports+json`. */
const reporting = (body: Record<string, unknown>, type = 'csp-violation') => ({
  type,
  url: 'https://cobweb.example/collections?tab=1',
  body: {
    documentURL: 'https://cobweb.example/collections?tab=1',
    effectiveDirective: 'connect-src',
    blockedURL: 'wss://relay.example/socket?key=secret',
    sourceFile: 'https://cobweb.example/_next/static/chunks/app.js?v=2',
    lineNumber: 12,
    columnNumber: 4,
    disposition: 'report',
    ...body,
  },
})

/** How many line breaks of any kind a string holds: a logged line must hold none. */
const lineBreaks = (text: string) =>
  [...text].filter((char) => [0x0a, 0x0d, 0x2028, 0x2029].includes(char.codePointAt(0)!)).length

/** The characters a logged field never carries: controls, the C1 range and the line and paragraph separators. */
const CONTROLS = String.fromCharCode(0x0a, 0x0d, 0x09, 0x00, 0x1b, 0x7f, 0x85, 0x2028, 0x2029)

const first = (contentType: string, body: unknown) => violationsOf(contentType, body).violations[0]!

describe('violationsOf (docs/specs/2026-10-17-production-hardening.md, section 5.5)', () => {
  it('reads a report-uri body: the directive, the blocked origin and the path without query or fragment', () => {
    expect(violationsOf('application/csp-report', legacy({}))).toEqual({
      violations: [
        {
          disposition: 'enforce',
          directive: 'script-src-elem',
          blocked: 'https://evil.example',
          page: '/night-owls',
          source: null,
          line: null,
          column: null,
        },
      ],
      malformed: 0,
    })
    // Without an effective directive, the violated one's first word.
    const withoutEffective = legacy({ 'effective-directive': undefined })
    expect(first('application/csp-report; charset=utf-8', withoutEffective).directive).toBe('script-src-elem')
  })

  it('reads every csp-violation of a Reporting API list, its source as an origin, and skips the other reports', () => {
    const data = {
      effectiveDirective: 'img-src',
      blockedURL: 'data',
      disposition: 'enforce',
      sourceFile: undefined,
    }
    expect(
      violationsOf('application/reports+json', [
        reporting({}),
        reporting({}, 'deprecation'),
        reporting(data),
      ]),
    ).toEqual({
      violations: [
        {
          disposition: 'report',
          directive: 'connect-src',
          blocked: 'wss://relay.example',
          page: '/collections',
          source: 'https://cobweb.example',
          line: 12,
          column: 4,
        },
        {
          disposition: 'enforce',
          directive: 'img-src',
          blocked: 'data',
          page: '/collections',
          source: null,
          line: 12,
          column: 4,
        },
      ],
      malformed: 0,
    })
  })

  it('names a blocked keyword, a data URL and a blob URL by their word, never their content', () => {
    const blocked = (value: string) =>
      first('application/csp-report', legacy({ 'blocked-uri': value })).blocked
    expect(['inline', 'eval', 'data', 'blob'].map(blocked)).toEqual(['inline', 'eval', 'data', 'blob'])
    expect(blocked('data:image/png;base64,iVBORw0KGgo=')).toBe('data')
    expect(blocked('blob:https://cobweb.example/4b1f6c2e-0000-4000-8000-000000000000')).toBe('blob')
    expect(blocked('')).toBe('unknown')
  })

  it('cuts each field to 256 characters before it is read', () => {
    const long = 'a'.repeat(300)
    const violation = first(
      'application/csp-report',
      legacy({
        'effective-directive': long,
        'blocked-uri': long,
        'document-uri': `https://cobweb.example/${long}`,
      }),
    )
    expect(REPORT_FIELD_MAX).toBe(256)
    expect([violation.directive.length, violation.blocked.length]).toEqual([256, 256])
    // The document's address is cut first, so its path keeps what fits after the origin.
    expect(violation.page).toBe(`/${long}`.slice(0, 256 - 'https://cobweb.example'.length))
  })

  it('counts a body that fails the schema as malformed and reads nothing from it', () => {
    for (const body of [
      legacy({ 'blocked-uri': 42 }),
      legacy({ 'line-number': -1 }),
      legacy({ disposition: 'observe' }),
      { report: {} },
      null,
      [legacy({})],
    ])
      expect(violationsOf('application/csp-report', body)).toEqual({ violations: [], malformed: 1 })
    expect(violationsOf('application/reports+json', legacy({}))).toEqual({ violations: [], malformed: 1 })
    expect(
      violationsOf('application/reports+json', [reporting({ blockedURL: { url: 'x' } }), reporting({})]),
    ).toMatchObject({ violations: [{ directive: 'connect-src' }], malformed: 1 })
  })

  it('holds no violation for another content type', () => {
    expect(violationsOf('application/json', legacy({}))).toEqual({ violations: [], malformed: 0 })
    expect(violationsOf('text/plain', [reporting({})])).toEqual({ violations: [], malformed: 0 })
  })
})

describe('cleanField', () => {
  it('drops every control character, the C1 range and the line separators, then trims and cuts', () => {
    expect(cleanField(`a${CONTROLS}b${CONTROLS}c`)).toBe('abc')
    expect(cleanField('  \n kept \n ')).toBe('kept')
    expect(cleanField(undefined)).toBe('')
    expect(cleanField('x'.repeat(10_000))).toHaveLength(256)
  })
})

describe('violationLine', () => {
  it('writes one JSON object, its first key csp', () => {
    const violation: Violation = {
      disposition: 'report',
      directive: 'connect-src',
      blocked: 'wss://relay.example',
      page: '/collections',
      source: null,
      line: 3,
      column: null,
    }
    expect(violationLine(violation)).toBe(
      '{"csp":"report","directive":"connect-src","blocked":"wss://relay.example","page":"/collections","source":null,"line":3,"column":null}',
    )
  })

  it('keeps a report carrying newlines and a 10 KB field to one bounded JSON line (Review Focus 1)', () => {
    const forged = 'inline\n{"csp":"enforce","directive":"forged"}\r\n'
    const huge = 'b'.repeat(10_240)
    const [violation] = violationsOf(
      'application/csp-report',
      legacy({
        'effective-directive': `script-src\n${huge}`,
        'blocked-uri': forged,
        'document-uri': `https://cobweb.example/x\n\r${huge}?q=1`,
        'source-file': `https://cobweb.example/${CONTROLS}${huge}`,
      }),
    ).violations
    const line = violationLine(violation!)
    expect(lineBreaks(line)).toBe(0)
    expect(line.length).toBeLessThan(2_048)
    expect(JSON.parse(line)).toMatchObject({
      csp: 'enforce',
      blocked: 'inline{"csp":"enforce","directive":"forged"}',
    })
    expect(line).not.toContain('original-policy')
  })
})

describe('reportLimiter', () => {
  it('allows 100 lines a minute, then counts what it held back once the minute is over', () => {
    const limiter = reportLimiter()
    const start = 1_000_000
    const allowed = Array.from({ length: REPORT_LINES_PER_MINUTE + 7 }, () => limiter.allow(start))
    expect(allowed.filter(Boolean)).toHaveLength(100)
    expect(limiter.dropped(start + 59_999)).toBeNull()
    expect(limiter.dropped(start + 60_000)).toBe(7)
    expect(limiter.dropped(start + 60_001)).toBeNull()
    expect(limiter.allow(start + 60_002)).toBe(true)
  })

  it('counts a dropped report with those held back, without using the allowance', () => {
    const limiter = reportLimiter(2)
    limiter.drop(0)
    expect([limiter.allow(1), limiter.allow(2), limiter.allow(3)]).toEqual([true, true, false])
    expect(limiter.dropped(60_000)).toBe(2)
  })
})
```

Create `apps/web/src/lib/security/csp-report-route.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** The route with a fresh limiter. */
async function route() {
  vi.resetModules()
  return (await import('@/app/api/csp-report/route')).POST
}

const post = (body: string | ReadableStream<Uint8Array>, type: string, length?: number) =>
  new Request('https://cobweb.test/api/csp-report', {
    method: 'POST',
    body,
    headers: { 'content-type': type, ...(length === undefined ? {} : { 'content-length': String(length) }) },
    ...(typeof body === 'string' ? {} : { duplex: 'half' }),
  } as RequestInit)

const legacy = (fields: Record<string, unknown>) =>
  JSON.stringify({
    'csp-report': {
      'document-uri': 'https://cobweb.test/night-owls?ref=1',
      'effective-directive': 'script-src-elem',
      'blocked-uri': 'https://evil.example/x.js',
      disposition: 'enforce',
      ...fields,
    },
  })
const report = legacy({})
const LINE =
  '{"csp":"enforce","directive":"script-src-elem","blocked":"https://evil.example","page":"/night-owls","source":null,"line":null,"column":null}'

/** How many line breaks of any kind a string holds: a logged line must hold none. */
const lineBreaks = (text: string) =>
  [...text].filter((char) => [0x0a, 0x0d, 0x2028, 0x2029].includes(char.codePointAt(0)!)).length

describe('POST /api/csp-report (docs/specs/2026-10-17-production-hardening.md, section 5.5)', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  beforeEach(() => warn.mockClear())
  afterEach(() => vi.useRealTimers())

  it('answers 204 and logs one JSON line per violation', async () => {
    const POST = await route()
    const response = await POST(post(report, 'application/csp-report'))
    expect(response.status).toBe(204)
    expect(warn.mock.calls).toEqual([[LINE]])
  })

  it('logs a report carrying newlines and a 10 KB field as one bounded JSON line (Review Focus 1)', async () => {
    const POST = await route()
    const body = legacy({
      'blocked-uri': `inline\n${'c'.repeat(10_240)}`,
      'document-uri': 'https://cobweb.test/a\r\nCSP enforce: forged blocked x on /b',
    })
    expect((await POST(post(body, 'application/csp-report'))).status).toBe(204)
    expect(warn).toHaveBeenCalledTimes(1)
    const line = String(warn.mock.calls[0]![0])
    expect(lineBreaks(line)).toBe(0)
    expect(line.length).toBeLessThan(2_048)
    expect(JSON.parse(line)).toMatchObject({
      csp: 'enforce',
      page: '/aCSP%20enforce:%20forged%20blocked%20x%20on%20/b',
    })
  })

  it('answers 415 for another type and logs nothing', async () => {
    const POST = await route()
    expect((await POST(post(report, 'application/json'))).status).toBe(415)
    expect(warn).not.toHaveBeenCalled()
  })

  it('answers 400 for a body that does not parse or fails the schema, logs nothing of it, and counts it', async () => {
    vi.useFakeTimers({ now: 1_000_000 })
    const POST = await route()
    expect((await POST(post('{"csp-report":', 'application/csp-report'))).status).toBe(400)
    expect((await POST(post(legacy({ 'blocked-uri': 42 }), 'application/csp-report'))).status).toBe(400)
    expect(warn).not.toHaveBeenCalled()
    vi.setSystemTime(1_060_000)
    await POST(post(report, 'application/csp-report'))
    expect(warn.mock.calls).toEqual([[LINE], ['CSP: 2 more reports in the last minute were not logged.']])
  })

  it('answers 413 above 16 KB, whether or not the length is declared', async () => {
    const POST = await route()
    const large = legacy({ 'blocked-uri': 'a'.repeat(17_000) })
    expect((await POST(post(large, 'application/csp-report', large.length))).status).toBe(413)
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let n = 0; n < 17; n++) controller.enqueue(new Uint8Array(1_024).fill(32))
        controller.close()
      },
    })
    expect((await POST(post(stream, 'application/csp-report'))).status).toBe(413)
    expect(warn).not.toHaveBeenCalled()
  })

  it('logs 100 lines a minute, then the count it held back once the minute is over', async () => {
    vi.useFakeTimers({ now: 1_000_000 })
    const POST = await route()
    const many = JSON.stringify(
      Array.from({ length: 101 }, () => ({
        type: 'csp-violation',
        body: { documentURL: 'https://cobweb.test/', effectiveDirective: 'img-src', blockedURL: 'data' },
      })),
    )
    expect((await POST(post(many, 'application/reports+json'))).status).toBe(204)
    expect(warn).toHaveBeenCalledTimes(100)
    vi.setSystemTime(1_060_000)
    await POST(post(report, 'application/csp-report'))
    expect(warn.mock.calls.slice(100)).toEqual([
      [LINE],
      ['CSP: 1 more reports in the last minute were not logged.'],
    ])
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @cobweb/web exec vitest run src/lib/security`
Expected: FAIL, the three files on modules that do not exist yet: `Cannot find module '/src/lib/security/csp'`, `Cannot find module './csp-report'`, `Cannot find package '@/app/api/csp-report/route'` and `Test Files  3 failed (3)`.

- [ ] **Step 3: The policy**

Images from any https host, as ruled, with the local services' http origins (Decision 5); report-only mode without an enforced policy (Decision 7).

Create `apps/web/src/lib/security/csp.ts`:

```ts
import type { ChainConfig } from '@cobweb/shared'

/**
 * The Content-Security-Policy (docs/specs/2026-10-17-production-hardening.md, section 5.2), pure: the proxy
 * works out the mode, the route's class, a nonce and the sources for each request, and this module writes the
 * headers. Scripts run only with the response's nonce (`'strict-dynamic'` admits what a nonced script inserts);
 * every origin the browser calls is read from the settings the app itself reads, never from a hand list. No
 * value here is a secret: each one reaches the browser anyway.
 */

export type CspMode = 'enforce' | 'report-only' | 'off'
export type RouteClass = 'page' | 'api'
export type CspEnv = Record<string, string | undefined>
export type CspSources = {
  supabase: string | null
  freshness: string | null
  storage: string | null
  media: string | null
  gateway: string
  rpcs: string[]
  turnstile: boolean
  development: boolean
  local: boolean
  host: string
}

export const CSP_REPORT_PATH = '/api/csp-report'
export const FRAME_POLICY = "frame-ancestors 'none'"
/** The dev wallet's signer (apps/web/scripts/dev-wallet), which its injected provider fetches from the page. */
export const DEV_WALLET_ORIGIN = 'http://127.0.0.1:8787'
/** Cloudflare Turnstile's script and frame. */
export const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com'

/**
 * WalletConnect's relay, RPC, events and Verify, and the wallet list RainbowKit 2.2.11's WalletConnect option
 * opens: `@walletconnect/core` and `@walletconnect/ethereum-provider` 2.21.1 and `@reown/appkit` 1.7.8. Verify
 * loads its attestation in a hidden frame. An upgrade of any of them reads its hosts again.
 */
export const WALLET_CONNECT_ORIGINS: readonly string[] = [
  'https://rpc.walletconnect.org',
  'wss://relay.walletconnect.org',
  'https://pulse.walletconnect.org',
  'https://api.web3modal.org',
  'https://verify.walletconnect.org',
  'https://verify.walletconnect.com',
]

/**
 * MetaMask's SDK, which RainbowKit's MetaMask option uses with the extension or on a phone: `@metamask/sdk` 0.33.1.
 * An upgrade reads its hosts again.
 */
export const METAMASK_ORIGINS: readonly string[] = [
  'https://metamask-sdk.api.cx.metamask.io',
  'wss://metamask-sdk.api.cx.metamask.io',
  'https://mm-sdk-analytics.api.cx.metamask.io',
]

const MODES: readonly CspMode[] = ['enforce', 'report-only', 'off']

/** `CSP_MODE` when it is one of the three; unset (or unknown), report-only on Vercel and enforce off it. */
export function cspModeOf(env: CspEnv): CspMode {
  const mode = env.CSP_MODE as CspMode | undefined
  if (mode && MODES.includes(mode)) return mode
  return env.VERCEL === '1' ? 'report-only' : 'enforce'
}

/** `api` for /api and below, `page` for everything else. */
export function routeClassOf(pathname: string): RouteClass {
  return pathname === '/api' || pathname.startsWith('/api/') ? 'api' : 'page'
}

/** A URL's origin, or null for a blank or unparsable value or one with no origin (a `data:` URL). */
export function originOf(url: string | undefined): string | null {
  if (!url?.trim()) return null
  try {
    const { origin } = new URL(url.trim())
    return origin === 'null' ? null : origin
  } catch {
    return null
  }
}

/**
 * The origins the browser calls, from the settings the app reads: Supabase, the freshness server, the storage
 * endpoint (path style keeps every presigned URL on it), the mint page's media (`mediaBase()`'s default is the
 * Supabase origin), the IPFS gateway (`ipfsGateway()`'s default is ipfs.io) and each available chain's public RPC,
 * which wagmi's `http()` calls.
 */
export function cspSourcesOf(env: CspEnv, chains: readonly ChainConfig[], host: string): CspSources {
  const supabase = originOf(env.NEXT_PUBLIC_SUPABASE_URL)
  const rpcs = chains.flatMap((chain) => {
    const origin = originOf(chain.viem.rpcUrls.default.http[0])
    return origin ? [origin] : []
  })
  return {
    supabase,
    freshness: originOf(env.NEXT_PUBLIC_FRESHNESS_URL),
    storage: originOf(env.ART_S3_ENDPOINT),
    media: originOf(env.MINT_PAGE_MEDIA_URL) ?? supabase,
    gateway: originOf(env.IPFS_GATEWAY_URL) ?? 'https://ipfs.io',
    rpcs: [...new Set(rpcs)],
    turnstile: Boolean(env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim()),
    development: env.NODE_ENV === 'development',
    local: env.VERCEL !== '1',
    host,
  }
}

/** A directive with its sources in order, each once, null ones left out. */
function directive(name: string, sources: readonly (string | null | false)[]): string {
  const kept = sources.filter((source): source is string => typeof source === 'string' && source.length > 0)
  return [name, ...new Set(kept)].join(' ')
}

/**
 * The page policy, its directives in the spec's order. Images may come from any https host (the ruling on the
 * spec's section 14, point 4: an image cannot run script, and a creator's metadata may put token art on any host),
 * and from the storage, media and gateway origins when one answers over http, as the local services do. Styles
 * allow inline, since RainbowKit, sonner and AppKit write style elements without a nonce (decision 11).
 */
export function pagePolicy(nonce: string, sources: CspSources, mode: 'enforce' | 'report-only'): string {
  const plain = [sources.storage, sources.media, sources.gateway].filter(
    (origin): origin is string => origin !== null && origin.startsWith('http:'),
  )
  return [
    "default-src 'self'",
    directive('script-src', [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      sources.turnstile && TURNSTILE_ORIGIN,
      sources.development && "'unsafe-eval'",
    ]),
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    directive('img-src', ["'self'", 'data:', 'blob:', 'https:', ...plain]),
    directive('media-src', ["'self'", 'blob:', sources.storage, sources.media, sources.gateway]),
    "font-src 'self' https://fonts.gstatic.com",
    directive('connect-src', [
      "'self'",
      sources.supabase,
      sources.freshness,
      sources.storage,
      sources.gateway,
      ...sources.rpcs,
      ...WALLET_CONNECT_ORIGINS,
      ...METAMASK_ORIGINS,
      sources.local && DEV_WALLET_ORIGIN,
      sources.development && `ws://${sources.host}`,
    ]),
    directive('frame-src', [
      'https://verify.walletconnect.org',
      'https://verify.walletconnect.com',
      sources.turnstile && TURNSTILE_ORIGIN,
    ]),
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    FRAME_POLICY,
    ...(mode === 'enforce' && !sources.local ? ['upgrade-insecure-requests'] : []),
    `report-uri ${CSP_REPORT_PATH}`,
    'report-to csp',
  ].join('; ')
}

/** 16 random bytes in base64: 24 characters. */
export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return btoa(String.fromCharCode(...bytes))
}

/**
 * The headers for one request. A page in enforce mode: the policy on the request, where Next reads its nonce, and
 * on the response. In report-only mode: the report-only policy on both and no enforced policy, since Next 16.3
 * copies each of the proxy's response headers into the request it renders and reads `content-security-policy`
 * before the report-only header: an enforced `frame-ancestors 'none'` there would leave every script without its
 * nonce. `X-Frame-Options: DENY`, which next.config.ts sets on every path, keeps the framing block in that mode.
 * Off, and for every API route: the framing policy alone. The request never carries the framing policy, where
 * Next would find no nonce.
 */
export function cspHeaders(input: {
  mode: CspMode
  routeClass: RouteClass
  nonce: string
  sources: CspSources
  reportOrigin: string
}): { request: Record<string, string>; response: Record<string, string> } {
  const { mode, routeClass, nonce, sources, reportOrigin } = input
  if (routeClass === 'api' || mode === 'off')
    return { request: {}, response: { 'Content-Security-Policy': FRAME_POLICY } }
  const policy = pagePolicy(nonce, sources, mode)
  const reporting = { 'Reporting-Endpoints': `csp="${reportOrigin}${CSP_REPORT_PATH}"` }
  if (mode === 'enforce')
    return {
      request: { 'content-security-policy': policy, 'x-nonce': nonce },
      response: { 'Content-Security-Policy': policy, ...reporting },
    }
  return {
    request: { 'content-security-policy-report-only': policy, 'x-nonce': nonce },
    response: { 'Content-Security-Policy-Report-Only': policy, ...reporting },
  }
}
```

- [ ] **Step 4: The reports and their endpoint**

Allow-listed fields, cleaned and cut, one JSON line each, a malformed body counted and never logged (Decision 6).

Create `apps/web/src/lib/security/csp-report.ts`:

```ts
import { z } from 'zod'

/**
 * The policy's violation reports (docs/specs/2026-10-17-production-hardening.md, section 5.5), pure. A report is
 * attacker-controlled input bound for the log, so nothing of it is written as it arrives: each format is read
 * through a schema of allow-listed fields (any other, the original policy among them, is dropped), every string
 * loses its control characters and is cut to 256 characters, the document is kept as its path without query or
 * fragment and a blocked or source URL as its origin or keyword, and the line is one JSON object. A body that
 * fails the schema is counted and dropped unread. The limiter keeps one instance to 100 lines a minute.
 */

export const REPORT_MAX_BYTES = 16_384
export const REPORT_LINES_PER_MINUTE = 100
/** The longest a logged string may be. */
export const REPORT_FIELD_MAX = 256

export type Violation = {
  disposition: 'enforce' | 'report'
  /** The effective directive, else the violated one's first word. */
  directive: string
  /** The blocked URL's origin, or its keyword (`inline`, `eval`, `data`, `blob`). */
  blocked: string
  /** The document's path, without its query or fragment. */
  page: string
  /** The origin (or keyword) of the file the violation came from, when the browser names one. */
  source: string | null
  line: number | null
  column: number | null
}

const MINUTE_MS = 60_000

const optionalText = z.string().optional()
const position = z.number().int().nonnegative().optional()
const disposition = z.enum(['enforce', 'report']).optional()

/** The report-uri format (`application/csp-report`): the fields Cobweb reads, every other one dropped. */
const legacyReport = z.object({
  'csp-report': z.object({
    'document-uri': optionalText,
    'violated-directive': optionalText,
    'effective-directive': optionalText,
    'blocked-uri': optionalText,
    'source-file': optionalText,
    'line-number': position,
    'column-number': position,
    disposition,
  }),
})

/** A Reporting API csp-violation's body (`application/reports+json`): the same fields under its names. */
const reportingBody = z.object({
  documentURL: optionalText,
  effectiveDirective: optionalText,
  blockedURL: optionalText,
  sourceFile: optionalText,
  lineNumber: position,
  columnNumber: position,
  disposition,
})

/** Every code point below 0x20, 0x7f, the C1 range and the line and paragraph separators. */
const isControl = (code: number) =>
  code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029

/** A string without control characters, so nothing in it can start a log line, trimmed and cut to 256. */
export function cleanField(value: string | undefined): string {
  return [...(value ?? '')]
    .filter((char) => !isControl(char.codePointAt(0)!))
    .join('')
    .trim()
    .slice(0, REPORT_FIELD_MAX)
}

/** A URL as its origin, a data or blob URL as its scheme, anything else as its first word: a keyword. */
function originOrKeyword(value: string | undefined): string | null {
  const raw = cleanField(value)
  if (!raw) return null
  try {
    const url = new URL(raw)
    // A blob URL's origin is its page's, so it is named by its scheme, as a data URL is.
    if (url.protocol === 'blob:' || url.origin === 'null') return url.protocol.replace(/:$/, '')
    return url.origin.slice(0, REPORT_FIELD_MAX)
  } catch {
    return raw.split(' ')[0]!
  }
}

/** The document's path, without its query or fragment. */
function pathOf(value: string | undefined): string {
  try {
    return new URL(cleanField(value)).pathname.slice(0, REPORT_FIELD_MAX)
  } catch {
    return 'unknown'
  }
}

function violationOf(fields: {
  disposition?: 'enforce' | 'report'
  effective?: string
  violated?: string
  blocked?: string
  document?: string
  source?: string
  line?: number
  column?: number
}): Violation {
  return {
    disposition: fields.disposition ?? 'enforce',
    directive: cleanField(fields.effective) || cleanField(fields.violated).split(' ')[0] || 'unknown',
    blocked: originOrKeyword(fields.blocked) ?? 'unknown',
    page: pathOf(fields.document),
    source: originOrKeyword(fields.source),
    line: fields.line ?? null,
    column: fields.column ?? null,
  }
}

/**
 * The violations of a report body, and how many reports in it failed the schema (counted, never logged). The
 * report-uri format holds one; a Reporting API list holds one per `csp-violation` report, other report types
 * skipped. Another content type holds none.
 */
export function violationsOf(
  contentType: string,
  body: unknown,
): { violations: Violation[]; malformed: number } {
  const type = contentType.split(';')[0]!.trim().toLowerCase()
  if (type === 'application/csp-report') {
    const parsed = legacyReport.safeParse(body)
    if (!parsed.success) return { violations: [], malformed: 1 }
    const report = parsed.data['csp-report']
    return {
      violations: [
        violationOf({
          disposition: report.disposition,
          effective: report['effective-directive'],
          violated: report['violated-directive'],
          blocked: report['blocked-uri'],
          document: report['document-uri'],
          source: report['source-file'],
          line: report['line-number'],
          column: report['column-number'],
        }),
      ],
      malformed: 0,
    }
  }
  if (type !== 'application/reports+json') return { violations: [], malformed: 0 }
  if (!Array.isArray(body)) return { violations: [], malformed: 1 }
  const violations: Violation[] = []
  let malformed = 0
  for (const report of body as unknown[]) {
    if (
      typeof report !== 'object' ||
      report === null ||
      (report as { type?: unknown }).type !== 'csp-violation'
    )
      continue
    const parsed = reportingBody.safeParse((report as { body?: unknown }).body)
    if (!parsed.success) {
      malformed++
      continue
    }
    violations.push(
      violationOf({
        disposition: parsed.data.disposition,
        effective: parsed.data.effectiveDirective,
        blocked: parsed.data.blockedURL,
        document: parsed.data.documentURL,
        source: parsed.data.sourceFile,
        line: parsed.data.lineNumber,
        column: parsed.data.columnNumber,
      }),
    )
  }
  return { violations, malformed }
}

/** One violation as the log writes it: one JSON object on one line, its first key `csp`. */
export function violationLine(violation: Violation): string {
  return JSON.stringify({
    csp: violation.disposition,
    directive: violation.directive,
    blocked: violation.blocked,
    page: violation.page,
    source: violation.source,
    line: violation.line,
    column: violation.column,
  })
}

/**
 * At most `perMinute` lines in each minute from the first one; `drop` counts a report not logged for another
 * reason (one that failed the schema); `dropped` answers how many the last minute held back once that minute is
 * over, then null until another is.
 */
export function reportLimiter(perMinute = REPORT_LINES_PER_MINUTE): {
  allow(now: number): boolean
  drop(now: number): void
  dropped(now: number): number | null
} {
  let windowStart = Number.NEGATIVE_INFINITY
  let used = 0
  let held = 0
  let owed = 0
  const roll = (now: number) => {
    if (now - windowStart < MINUTE_MS) return
    owed += held
    held = 0
    used = 0
    windowStart = now
  }
  return {
    allow(now) {
      roll(now)
      if (used < perMinute) {
        used++
        return true
      }
      held++
      return false
    },
    drop(now) {
      roll(now)
      held++
    },
    dropped(now) {
      roll(now)
      if (owed === 0) return null
      const count = owed
      owed = 0
      return count
    },
  }
}
```

Create `apps/web/src/app/api/csp-report/route.ts`:

```ts
import { REPORT_MAX_BYTES, reportLimiter, violationLine, violationsOf } from '@/lib/security/csp-report'

/**
 * Where browsers post the policy's violations (docs/specs/2026-10-17-production-hardening.md, section 5.5), in
 * either report format, up to 16 KB: one JSON line per violation, at most 100 a minute per instance, then the
 * count held back. A body that does not parse or fails the report schema is counted with those and never logged.
 * No session, no database: the proxy's matcher skips this route. 415 for another type, 413 above 16 KB, 400 for
 * a body that is not a report, 204 otherwise.
 */

const TYPES = ['application/csp-report', 'application/reports+json']
const limiter = reportLimiter()

/** The body as text, or null once it passes `max` bytes, read no further than that. */
async function bodyText(request: Request, max: number): Promise<string | null> {
  if (Number(request.headers.get('content-length') ?? 0) > max) return null
  const reader = request.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}

/** Logs the count held back in the minute just over, once. */
function logDropped(now: number): void {
  const dropped = limiter.dropped(now)
  if (dropped !== null) console.warn(`CSP: ${dropped} more reports in the last minute were not logged.`)
}

export async function POST(request: Request): Promise<Response> {
  const type = (request.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
  if (!TYPES.includes(type)) return new Response(null, { status: 415 })
  const raw = await bodyText(request, REPORT_MAX_BYTES)
  if (raw === null) return new Response(null, { status: 413 })
  const now = Date.now()
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    limiter.drop(now)
    logDropped(now)
    return new Response(null, { status: 400 })
  }
  const { violations, malformed } = violationsOf(type, body)
  for (const violation of violations) if (limiter.allow(now)) console.warn(violationLine(violation))
  for (let count = 0; count < malformed; count++) limiter.drop(now)
  logDropped(now)
  return new Response(null, { status: violations.length === 0 && malformed > 0 ? 400 : 204 })
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `pnpm --filter @cobweb/web exec vitest run src/lib/security`
Expected: PASS, `Tests  38 passed (38)`.

- [ ] **Step 6: Typecheck and lint the web app**

Run: `pnpm --filter @cobweb/web typecheck && pnpm --filter @cobweb/web lint`
Expected: PASS.

- [ ] **Step 7: Format, run the root checks and commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
pnpm exec prettier --write apps/web/src/lib/security/csp.ts apps/web/src/lib/security/csp.test.ts apps/web/src/lib/security/csp-report.ts apps/web/src/lib/security/csp-report.test.ts apps/web/src/lib/security/csp-report-route.test.ts apps/web/src/app/api/csp-report/route.ts
pnpm typecheck && pnpm lint && pnpm test
git add apps/web/src/lib/security apps/web/src/app/api/csp-report
git commit -m "$(cat <<'EOF'
Add the Content-Security-Policy's pure module, the violation reports' schema, cleaner and limiter, and the report endpoint

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: web 940 tests in 97 files; the other packages unchanged.

---

### Task 3: The policy in the proxy with a fresh nonce, every page rendered per request, the framing header, and `verify:csp`

**Kind:** integration: Next's proxy, its rendering and a production build: an Opus implementer.

**Files:**

- Create: `apps/web/src/proxy.test.ts`, `apps/web/scripts/verify-csp.ts`
- Modify: `apps/web/src/proxy.ts` (whole), `apps/web/src/app/layout.tsx`, `apps/web/src/app/[slug]/page.tsx`, `apps/web/next.config.ts`, `apps/web/package.json` (the command)
- Test: `apps/web/src/proxy.test.ts`; `pnpm --filter @cobweb/web verify:csp` on a sample-mode production build

**Interfaces:**

- Consumes: `cspHeaders`, `cspModeOf`, `cspSourcesOf`, `newNonce`, `routeClassOf`, `FRAME_POLICY` and `CSP_REPORT_PATH` (Task 2); `availableChains` and `LAUNCH_CHAINS` from `@cobweb/shared`; `createServerClient` from `@supabase/ssr`; `connection` from `next/server`; `unstable_doesMiddlewareMatch` from `next/experimental/testing/server` (Decision 8).
- Produces:
  - `proxy(request: NextRequest): Promise<NextResponse>`: deletes any `content-security-policy`, `content-security-policy-report-only` and `x-nonce` the request arrived with, sets the request's policy and `x-nonce`, refreshes the session as before, then sets the response's headers; `config.matcher` skipping `api/csp-report` beside the static paths
  - `RootLayout` awaiting `connection()`, so every page renders per request; `/[slug]` without `revalidate` and `generateStaticParams`
  - `next.config.ts`'s headers without `Content-Security-Policy`
  - `verify:csp` (`node --conditions=react-server --import ./scripts/resolve-ts.mjs scripts/verify-csp.ts`), ten checks on port 3210

- [ ] **Step 1: Write the failing tests**

`@supabase/ssr` is mocked, so the test reads only the headers the proxy sets and forwards (`x-middleware-request-<name>`, which Next reads as the request's). The replacement test pins Review Focus 3 and the report-only test Review Focus 4.

Create `apps/web/src/proxy.test.ts`:

```ts
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FRAME_POLICY } from '@/lib/security/csp'
import { config, proxy } from './proxy'

const mocks = vi.hoisted(() => ({
  getClaims: vi.fn(async () => ({ data: null, error: null })),
}))
vi.mock('@supabase/ssr', () => ({ createServerClient: () => ({ auth: { getClaims: mocks.getClaims } }) }))

const ORIGIN = 'https://cobweb.test'
const request = (path: string, headers: Record<string, string> = {}) =>
  new NextRequest(`${ORIGIN}${path}`, { headers })

/** The nonce a policy's script-src carries, or null. */
const nonceOf = (policy: string | null) => policy?.match(/'nonce-([^']+)'/)?.[1] ?? null

/** The request headers the response forwards to the render, as Next reads them. */
const forwarded = (response: Response, name: string) => response.headers.get(`x-middleware-request-${name}`)

describe('proxy (docs/specs/2026-10-17-production-hardening.md, section 5.3)', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://abcdefghijklmnopqrst.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test')
    vi.stubEnv('VERCEL', '1')
    mocks.getClaims.mockClear()
  })
  afterEach(() => vi.unstubAllEnvs())

  it('enforces the page policy, forwarding it to the render with the nonce its response carries', async () => {
    vi.stubEnv('CSP_MODE', 'enforce')
    const response = await proxy(request('/night-owls'))
    const policy = response.headers.get('Content-Security-Policy')
    const nonce = nonceOf(policy)
    expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/)
    expect(policy).toContain('upgrade-insecure-requests')
    expect(response.headers.get('Content-Security-Policy-Report-Only')).toBeNull()
    expect(response.headers.get('Reporting-Endpoints')).toBe(`csp="${ORIGIN}/api/csp-report"`)
    expect(forwarded(response, 'content-security-policy')).toBe(policy)
    expect(forwarded(response, 'x-nonce')).toBe(nonce)
    expect(forwarded(response, 'content-security-policy-report-only')).toBeNull()
  })

  it('reports in report-only mode with no enforced policy, which Next would copy into the request', async () => {
    vi.stubEnv('CSP_MODE', 'report-only')
    const response = await proxy(request('/'))
    const policy = response.headers.get('Content-Security-Policy-Report-Only')
    expect(response.headers.get('Content-Security-Policy')).toBeNull()
    expect(policy).toContain("'strict-dynamic'")
    expect(policy).not.toContain('upgrade-insecure-requests')
    expect(forwarded(response, 'content-security-policy-report-only')).toBe(policy)
    expect(forwarded(response, 'x-nonce')).toBe(nonceOf(policy))
    expect(forwarded(response, 'content-security-policy')).toBeNull()
  })

  it('reads unset as report-only on Vercel and enforce off it', async () => {
    expect((await proxy(request('/'))).headers.get('Content-Security-Policy-Report-Only')).toContain(
      "'nonce-",
    )
    vi.stubEnv('VERCEL', '')
    expect(nonceOf((await proxy(request('/'))).headers.get('Content-Security-Policy'))).not.toBeNull()
  })

  it('keeps the framing policy alone when off, and for an API route in every mode, forwarding no policy', async () => {
    const cases: [string, string][] = [
      ['off', '/collections'],
      ['enforce', '/api/uploads/x'],
      ['report-only', '/api/uploads/x'],
      ['off', '/api/uploads/x'],
    ]
    for (const [mode, path] of cases) {
      vi.stubEnv('CSP_MODE', mode)
      const response = await proxy(request(path))
      expect(response.headers.get('Content-Security-Policy')).toBe(FRAME_POLICY)
      expect(response.headers.get('Content-Security-Policy-Report-Only')).toBeNull()
      expect(response.headers.get('Reporting-Endpoints')).toBeNull()
      expect(forwarded(response, 'content-security-policy')).toBeNull()
      expect(forwarded(response, 'x-nonce')).toBeNull()
    }
  })

  it("replaces a client's own policy and nonce, so no client chooses the nonce Next applies", async () => {
    const chosen = {
      'content-security-policy': "script-src 'nonce-Y2hvc2Vu'",
      'content-security-policy-report-only': "script-src 'nonce-Y2hvc2Vu'",
      'x-nonce': 'Y2hvc2Vu',
    }
    vi.stubEnv('CSP_MODE', 'enforce')
    const page = await proxy(request('/', chosen))
    expect(nonceOf(forwarded(page, 'content-security-policy'))).not.toBe('Y2hvc2Vu')
    expect(forwarded(page, 'x-nonce')).not.toBe('Y2hvc2Vu')
    expect(forwarded(page, 'content-security-policy-report-only')).toBeNull()
    const api = await proxy(request('/api/uploads/x', chosen))
    for (const name of Object.keys(chosen)) expect(forwarded(api, name)).toBeNull()
  })

  it('makes a new nonce for every request and refreshes the session once each', async () => {
    vi.stubEnv('CSP_MODE', 'enforce')
    const first = nonceOf((await proxy(request('/'))).headers.get('Content-Security-Policy'))
    const second = nonceOf((await proxy(request('/'))).headers.get('Content-Security-Policy'))
    expect(first).not.toBe(second)
    expect(mocks.getClaims).toHaveBeenCalledTimes(2)
  })
})

describe("the proxy's matcher", () => {
  const matches = (url: string) => unstable_doesMiddlewareMatch({ config, url })

  it('admits pages and API routes, and skips static files and the report endpoint', () => {
    for (const url of ['/', '/collections', '/night-owls', '/api/uploads/x'])
      expect(matches(url), url).toBe(true)
    for (const url of ['/_next/static/x.js', '/demo/tokens/1.svg', '/api/csp-report'])
      expect(matches(url), url).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @cobweb/web exec vitest run src/proxy.test.ts`
Expected: FAIL. The proxy sets no policy yet and its matcher admits the report endpoint: `Tests  7 failed (7)`.

- [ ] **Step 3: The proxy**

Replace the whole of `apps/web/src/proxy.ts` with:

```ts
import { availableChains } from '@cobweb/shared'
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { cspHeaders, cspModeOf, cspSourcesOf, newNonce, routeClassOf } from '@/lib/security/csp'

/** Request headers that would choose the policy or the nonce Next applies, which no client may send. */
const CLIENT_CHOSEN = ['content-security-policy', 'content-security-policy-report-only', 'x-nonce']

/**
 * Runs before every request its matcher admits. It sets the Content-Security-Policy with a fresh nonce
 * (docs/specs/2026-10-17-production-hardening.md, section 5.3): on the request, where Next reads the nonce and
 * puts it on every script of the page it renders, and on the response. It keeps the Supabase session fresh: it
 * refreshes an expiring token and writes the new cookies to both the request (for the page about to render) and
 * the response (for the browser). It makes no access decisions; pages do that through `lib/auth`.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  for (const name of CLIENT_CHOSEN) request.headers.delete(name)
  const csp = cspHeaders({
    mode: cspModeOf(process.env),
    routeClass: routeClassOf(request.nextUrl.pathname),
    nonce: newNonce(),
    sources: cspSourcesOf(process.env, availableChains(), request.nextUrl.host),
    reportOrigin: request.nextUrl.origin,
  })
  for (const [name, value] of Object.entries(csp.request)) request.headers.set(name, value)

  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value)
          }
          response = NextResponse.next({ request })
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options)
          }
          // A response that carries a refreshed session must never be stored by a shared cache.
          for (const [key, value] of Object.entries(headers ?? {})) {
            response.headers.set(key, value)
          }
        },
      },
    },
  )

  // Validates the token and refreshes it if needed. Nothing may run between creating the client
  // and this call.
  await supabase.auth.getClaims()

  for (const [name, value] of Object.entries(csp.response)) response.headers.set(name, value)
  return response
}

export const config = {
  // The report endpoint is skipped too: its posts need no session and carry no page.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|assets/|api/csp-report|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm --filter @cobweb/web exec vitest run src/proxy.test.ts`
Expected: PASS, `Tests  7 passed (7)`.

- [ ] **Step 5: Every page per request, and the framing header left to the proxy**

The root layout awaits `connection()`, `/[slug]` loses its static settings and keeps its tagged read (spec section 5.4), and `next.config.ts` keeps its other three headers on every path (spec section 5.6).

In `apps/web/src/app/layout.tsx`, replace:

```tsx
import { Geist_Mono, Poppins } from 'next/font/google'
```

with:

```tsx
import { Geist_Mono, Poppins } from 'next/font/google'
import { connection } from 'next/server'
```

In `apps/web/src/app/layout.tsx`, replace:

```tsx
export default function RootLayout({ children }: { children: React.ReactNode }) {
```

with:

```tsx
/**
 * Every page renders for its request, so each response's scripts carry that response's nonce
 * (docs/specs/2026-10-17-production-hardening.md, decision 9); only Next's own `/_global-error` is prerendered.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await connection()
```

In `apps/web/src/app/[slug]/page.tsx`, replace:

```tsx
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
```

with:

```tsx
 * no session is needed. The page renders per request, so its scripts carry the response's nonce
 * (docs/specs/2026-10-17-production-hardening.md, decision 9); its content is the published page's document, read
 * through `readMintPage`'s 60 s cache under the link's tag `mint-page:<slug>`, which the Mint page tab's actions
 * expire, so the database still sees one read per link a minute. The chain's state comes from the browser's polls
 * of the freshness server, never from the HTML. Sample mode's switches are read by the browser.
 */
```

In `apps/web/next.config.ts`, replace:

```ts
          // The app asks wallets for signatures and, later, transactions. It must never be shown
          // inside another site's frame, where a click could be disguised.
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
```

with:

```ts
          // The app asks wallets for signatures and transactions. It must never be shown inside another
          // site's frame, where a click could be disguised: the proxy's Content-Security-Policy says
          // `frame-ancestors 'none'` on every page and API route in every mode, and this header covers static
          // files and older browsers (docs/specs/2026-10-17-production-hardening.md, decision 10).
```

- [ ] **Step 6: `verify:csp`**

It starts `next start` on port 3210 in each mode, reads every script of a JavaScript type in the HTML, and reads the server's log lines for the reports (Decisions 7 and 9).

Create `apps/web/scripts/verify-csp.ts`:

```ts
// Checks the Content-Security-Policy on a production build (docs/specs/2026-10-17-production-hardening.md, section
// 10): `next start` on port 3210 with CSP_MODE=enforce and VERCEL unset, then with CSP_MODE=report-only, reading
// the headers and every script of a JavaScript type in the HTML of the sign-in page, the sample mint page, the
// dashboard's redirect and the not-found page, an API route and a static file, and posting both report formats to
// the report endpoint. Ten PASS lines. Needs a production build made in sample mode and nothing else: no database,
// no chain.
//
//   NEXT_PUBLIC_DEMO_DATA=1 pnpm --filter @cobweb/web build
//   pnpm --filter @cobweb/web verify:csp
//
// The server's freshness origin is NEXT_PUBLIC_FRESHNESS_URL (from the environment or apps/web/.env.local), else
// http://127.0.0.1:3100, which the run sets. Runs under `node --conditions=react-server --import
// ./scripts/resolve-ts.mjs`. Never prints a key.

import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LAUNCH_CHAINS } from '@cobweb/shared'
import { CSP_REPORT_PATH, FRAME_POLICY } from '../src/lib/security/csp.ts'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 3210
const BASE = `http://127.0.0.1:${PORT}`
const DEFAULT_FRESHNESS = 'http://127.0.0.1:3100'
const RELAY = 'wss://relay.walletconnect.org'
const START_TIMEOUT_MS = 60_000

let passed = 0
const failed: string[] = []

/** A check returns null on success, or a description of what happened instead. */
async function check(name: string, fn: () => Promise<string | null>): Promise<void> {
  let problem: string | null
  try {
    problem = await fn()
  } catch (e) {
    problem = `threw ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`
  }
  if (problem === null) {
    passed++
    console.log(`PASS ${name}`)
  } else {
    failed.push(name)
    console.log(`FAIL ${name}: ${problem}`)
  }
}

/** The app's local settings, as `next start` loads them: the environment first, then apps/web/.env.local. */
function setting(name: string): string | undefined {
  if (process.env[name]) return process.env[name]
  const file = resolve(appRoot, '.env.local')
  if (!existsSync(file)) return undefined
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const [, key, value] = line.match(/^([A-Z0-9_]+)=(.*)$/) ?? []
    if (key === name && value) return value.trim().replace(/^"(.*)"$/, '$1')
  }
  return undefined
}

const origin = (url: string | undefined) => (url ? new URL(url).origin : null)
const freshnessUrl = setting('NEXT_PUBLIC_FRESHNESS_URL') || DEFAULT_FRESHNESS
const supabaseOrigin = origin(setting('NEXT_PUBLIC_SUPABASE_URL'))

/** Whether something already listens on the port. */
function portBusy(port: number): Promise<boolean> {
  return new Promise((done) => {
    const probe = createServer()
    probe.once('error', () => done(true))
    probe.listen(port, '127.0.0.1', () => probe.close(() => done(false)))
  })
}

type Server = { child: ChildProcess; output: string[] }
let server: Server | null = null

/** `next start` on port 3210 in the given mode, VERCEL unset; resolves once / answers. */
async function startServer(mode: 'enforce' | 'report-only'): Promise<Server> {
  const next = createRequire(import.meta.url).resolve('next/dist/bin/next')
  const env: NodeJS.ProcessEnv = { ...process.env, CSP_MODE: mode, NEXT_PUBLIC_FRESHNESS_URL: freshnessUrl }
  delete env.VERCEL
  const child = spawn(process.execPath, [next, 'start', '--port', String(PORT), '--hostname', '127.0.0.1'], {
    cwd: appRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const output: string[] = []
  const collect = (chunk: Buffer) => output.push(...chunk.toString('utf8').split('\n').filter(Boolean))
  child.stdout!.on('data', collect)
  child.stderr!.on('data', collect)
  const started: Server = { child, output }
  server = started
  const until = Date.now() + START_TIMEOUT_MS
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error(`next start exited with ${child.exitCode}`)
    try {
      if ((await fetch(`${BASE}/`, { redirect: 'manual' })).status > 0) return started
    } catch {
      // Not listening yet.
    }
    await new Promise((wait) => setTimeout(wait, 250))
  }
  throw new Error(`next start did not answer within ${START_TIMEOUT_MS / 1000} s`)
}

/** Stops the server and waits for it to exit. */
async function stopServer(): Promise<void> {
  const running = server
  server = null
  if (!running || running.child.exitCode !== null) return
  const exited = new Promise<void>((done) => running.child.once('exit', () => done()))
  running.child.kill('SIGTERM')
  await Promise.race([exited, new Promise((wait) => setTimeout(wait, 10_000))])
  if (running.child.exitCode === null) running.child.kill('SIGKILL')
}

type Page = { status: number; headers: Headers; html: string }

async function get(path: string): Promise<Page> {
  const response = await fetch(`${BASE}${path}`, { redirect: 'manual' })
  return { status: response.status, headers: response.headers, html: await response.text() }
}

/** The policy's directives by name. */
function directives(policy: string | null): Map<string, string[]> {
  return new Map(
    (policy ?? '')
      .split(';')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [name = '', ...values] = entry.split(/\s+/)
        return [name, values]
      }),
  )
}

/** The nonce of a policy's script-src beside 'strict-dynamic', or null. */
function nonceOf(policy: string | null): string | null {
  const script = directives(policy).get('script-src') ?? []
  if (!script.includes("'strict-dynamic'")) return null
  const source = script.find((value) => value.startsWith("'nonce-"))
  return source ? source.slice("'nonce-".length, -1) : null
}

/** Every `<script>` of a JavaScript type: no type, a JavaScript MIME type or a module, with its nonce. */
function scriptsOf(html: string): { nonce: string | null }[] {
  return [...html.matchAll(/<script\b([^>]*)>/gi)].flatMap((match) => {
    const attributes = match[1] ?? ''
    const type = attributes.match(/\btype="([^"]*)"/i)?.[1]?.toLowerCase()
    if (type && type !== 'module' && !type.includes('javascript')) return []
    return [{ nonce: attributes.match(/\bnonce="([^"]*)"/i)?.[1] ?? null }]
  })
}

/** Null when the page has scripts and every one carries `nonce`. */
function scriptsOn(page: Page, nonce: string | null): string | null {
  const scripts = scriptsOf(page.html)
  if (!scripts.length) return 'no script in the HTML'
  const off = scripts.filter((script) => script.nonce !== nonce)
  return off.length ? `${off.length} of ${scripts.length} scripts without the response's nonce` : null
}

/** Null when the page carries the enforced page policy with a nonce its every script carries. */
function pagePolicyOn(page: Page): string | null {
  const policy = page.headers.get('content-security-policy')
  const nonce = nonceOf(policy)
  if (!nonce) return `no nonce beside 'strict-dynamic': ${policy?.slice(0, 120)}`
  return scriptsOn(page, nonce)
}

/** The server's lines since `from` that parse as a violation's JSON line. */
function violationLines(from: number): Record<string, unknown>[] {
  return (server?.output.slice(from) ?? []).flatMap((line) => {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>
      return typeof parsed === 'object' && parsed !== null && 'csp' in parsed ? [parsed] : []
    } catch {
      return []
    }
  })
}

async function post(body: string, type: string): Promise<number> {
  const response = await fetch(`${BASE}${CSP_REPORT_PATH}`, {
    method: 'POST',
    body,
    headers: { 'content-type': type },
  })
  return response.status
}

async function main(): Promise<void> {
  if (!existsSync(resolve(appRoot, '.next/BUILD_ID')))
    throw new Error('No production build: run NEXT_PUBLIC_DEMO_DATA=1 pnpm --filter @cobweb/web build first.')
  if (await portBusy(PORT)) throw new Error(`Port ${PORT} is in use.`)

  await check(
    'setup: the build answers on 3210 in sample mode, /night-owls rendering the sample page',
    async () => {
      await startServer('enforce')
      const page = await get('/night-owls')
      if (page.status !== 200) return `/night-owls answered ${page.status}`
      return page.html.includes('Night Owls')
        ? null
        : 'the sample collection is not on the page (build in sample mode)'
    },
  )

  let firstNonce: string | null = null
  await check(
    "sign-in page: / carries Content-Security-Policy with a nonce beside 'strict-dynamic' in script-src, no 'unsafe-eval' and no nonce in style-src, and every script carries that nonce",
    async () => {
      const page = await get('/')
      if (page.status !== 200) return `/ answered ${page.status}`
      const policy = directives(page.headers.get('content-security-policy'))
      if (policy.get('script-src')?.includes("'unsafe-eval'")) return "script-src carries 'unsafe-eval'"
      if (policy.get('style-src')?.some((source) => source.startsWith("'nonce-")))
        return 'style-src carries a nonce'
      firstNonce = nonceOf(page.headers.get('content-security-policy'))
      return pagePolicyOn(page)
    },
  )

  await check('per request: a second / carries another nonce, which its scripts carry', async () => {
    const page = await get('/')
    const nonce = nonceOf(page.headers.get('content-security-policy'))
    if (!nonce || nonce === firstNonce) return `the nonce ${nonce === firstNonce ? 'repeated' : 'is missing'}`
    return scriptsOn(page, nonce)
  })

  await check(
    "mint page: /night-owls renders per request with every script on its response's nonce, and connect-src lists each launch chain's RPC origin, the build's Supabase and freshness origins and the WalletConnect relay",
    async () => {
      const first = await get('/night-owls')
      const second = await get('/night-owls')
      const nonces = [first, second].map((page) => nonceOf(page.headers.get('content-security-policy')))
      if (!nonces[0] || nonces[0] === nonces[1])
        return `nonces ${nonces.join(' and ')}: not rendered per request`
      const scripts = pagePolicyOn(first) ?? pagePolicyOn(second)
      if (scripts) return scripts
      const connect = directives(first.headers.get('content-security-policy')).get('connect-src') ?? []
      const wanted = [
        ...LAUNCH_CHAINS.map((chain) => new URL(chain.viem.rpcUrls.default.http[0]!).origin),
        supabaseOrigin,
        new URL(freshnessUrl).origin,
        RELAY,
      ]
      const missing = wanted.filter((source) => !source || !connect.includes(source))
      return missing.length ? `connect-src lacks ${missing.join(', ')}` : null
    },
  )

  await check(
    'dashboard: /collections without a session answers its redirect to / with the page policy',
    async () => {
      const page = await get('/collections')
      const location = page.headers.get('location')
      if (page.status < 300 || page.status > 308 || !location || new URL(location, BASE).pathname !== '/')
        return `answered ${page.status} to ${location}`
      return nonceOf(page.headers.get('content-security-policy'))
        ? null
        : 'the redirect carries no page policy'
    },
  )

  await check('not found: /no/such/page answers 404 with the page policy and nonced scripts', async () => {
    const page = await get('/no/such/page')
    if (page.status !== 404) return `answered ${page.status}`
    return pagePolicyOn(page)
  })

  await check(
    "API and static: /api/uploads/<a random id> answers 404 with frame-ancestors 'none' alone, and /icon.svg carries X-Frame-Options DENY and no policy",
    async () => {
      const api = await get(`/api/uploads/${randomUUID()}`)
      if (api.status !== 404) return `the upload route answered ${api.status}`
      if (api.headers.get('content-security-policy') !== FRAME_POLICY)
        return `the upload route's policy: ${api.headers.get('content-security-policy')}`
      if (api.headers.get('content-security-policy-report-only')) return 'the upload route reports a policy'
      const icon = await get('/icon.svg')
      if (icon.status !== 200) return `/icon.svg answered ${icon.status}`
      if (icon.headers.get('x-frame-options') !== 'DENY')
        return `/icon.svg X-Frame-Options ${icon.headers.get('x-frame-options')}`
      return icon.headers.get('content-security-policy') ||
        icon.headers.get('content-security-policy-report-only')
        ? '/icon.svg carries a policy'
        : null
    },
  )

  await check(
    "report-only: started again with CSP_MODE=report-only, / carries X-Frame-Options DENY and no enforced policy, and the full policy as Content-Security-Policy-Report-Only, its scripts on that policy's nonce, with Reporting-Endpoints naming /api/csp-report",
    async () => {
      await stopServer()
      await startServer('report-only')
      const page = await get('/')
      // Next copies the proxy's response headers into the request it renders, so an enforced framing policy would
      // hide the nonce: the framing block is X-Frame-Options in this mode.
      if (page.headers.get('content-security-policy') !== null)
        return `enforced policy: ${page.headers.get('content-security-policy')}`
      if (page.headers.get('x-frame-options') !== 'DENY')
        return `X-Frame-Options ${page.headers.get('x-frame-options')}`
      const reportOnly = page.headers.get('content-security-policy-report-only')
      const nonce = nonceOf(reportOnly)
      if (!nonce) return `no nonce in the report-only policy: ${reportOnly?.slice(0, 120)}`
      // The endpoint is on the origin Next reads for the request: localhost for a local `next start`.
      const endpoint = page.headers.get('reporting-endpoints')?.match(/^csp="(http[^"]+)"$/)?.[1]
      if (!endpoint || new URL(endpoint).pathname !== CSP_REPORT_PATH)
        return `Reporting-Endpoints: ${page.headers.get('reporting-endpoints')}`
      return scriptsOn(page, nonce)
    },
  )

  await check(
    'reports: a report-uri body and a Reporting API body each answer 204 and log one line with the directive, the blocked origin and the path; 17 KB answers 413 and another type 415',
    async () => {
      const from = server?.output.length ?? 0
      const legacy = JSON.stringify({
        'csp-report': {
          'document-uri': `${BASE}/night-owls?ref=verify`,
          'effective-directive': 'script-src-elem',
          'blocked-uri': 'https://evil.example/x.js?key=secret',
          disposition: 'enforce',
        },
      })
      const reporting = JSON.stringify([
        {
          type: 'csp-violation',
          body: {
            documentURL: `${BASE}/collections?tab=verify`,
            effectiveDirective: 'connect-src',
            blockedURL: 'wss://relay.evil.example/socket?key=secret',
            disposition: 'report',
          },
        },
      ])
      const statuses = [
        await post(legacy, 'application/csp-report'),
        await post(reporting, 'application/reports+json'),
      ]
      if (statuses.some((status) => status !== 204)) return `answered ${statuses.join(' and ')}`
      const wanted = [
        { directive: 'script-src-elem', blocked: 'https://evil.example', page: '/night-owls' },
        { directive: 'connect-src', blocked: 'wss://relay.evil.example', page: '/collections' },
      ]
      let lines: Record<string, unknown>[] = []
      for (let wait = 0; wait < 40 && lines.length < 2; wait++) {
        await new Promise((done) => setTimeout(done, 50))
        lines = violationLines(from)
      }
      for (const want of wanted)
        if (
          lines.filter((line) => Object.entries(want).every(([key, value]) => line[key] === value)).length !==
          1
        )
          return `no single line for ${want.directive}: ${JSON.stringify(lines)}`
      if (server?.output.slice(from).some((line) => line.includes('secret'))) return 'a line carries a query'
      const large = JSON.stringify({ 'csp-report': { 'blocked-uri': 'a'.repeat(17 * 1024) } })
      const tooLarge = await post(large, 'application/csp-report')
      const wrongType = await post(legacy, 'application/json')
      return tooLarge === 413 && wrongType === 415
        ? null
        : `17 KB answered ${tooLarge}, another type ${wrongType}`
    },
  )

  await check('stop: the server stops and port 3210 is free', async () => {
    await stopServer()
    return (await portBusy(PORT)) ? `port ${PORT} is still in use` : null
  })
}

try {
  await main()
} catch (e) {
  failed.push('run')
  console.log(`FAIL run: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`)
} finally {
  await stopServer()
}

console.log(`\n${passed} passed, ${failed.length} failed`)
process.exit(failed.length ? 1 : 0)
```

In `apps/web/package.json`, replace:

```json
    "verify:indexer": "node --conditions=react-server --import ./scripts/resolve-ts.mjs scripts/verify-indexer.ts"
```

with:

```json
    "verify:indexer": "node --conditions=react-server --import ./scripts/resolve-ts.mjs scripts/verify-indexer.ts",
    "verify:csp": "node --conditions=react-server --import ./scripts/resolve-ts.mjs scripts/verify-csp.ts"
```

- [ ] **Step 7: Build in sample mode and run `verify:csp`**

Run: `NEXT_PUBLIC_DEMO_DATA=1 pnpm --filter @cobweb/web build`
Expected: PASS. The route list reads `ƒ /[slug]` and `ƒ /_not-found`.

Every page is dynamic and none is prerendered; only the icon is static.

Run: `pnpm --filter @cobweb/web verify:csp`
Expected: PASS, `10 passed, 0 failed`. Nothing may listen on port 3210 before it starts; check 10 shows the port free again.

- [ ] **Step 8: Typecheck and lint the web app**

Run: `pnpm --filter @cobweb/web typecheck && pnpm --filter @cobweb/web lint`
Expected: PASS.

- [ ] **Step 9: Format, run the root checks and commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
pnpm exec prettier --write apps/web/src/proxy.ts apps/web/src/proxy.test.ts apps/web/src/app/layout.tsx 'apps/web/src/app/[slug]/page.tsx' apps/web/next.config.ts apps/web/scripts/verify-csp.ts apps/web/package.json
pnpm typecheck && pnpm lint && pnpm test
git add apps/web/src/proxy.ts apps/web/src/proxy.test.ts apps/web/src/app/layout.tsx 'apps/web/src/app/[slug]/page.tsx' apps/web/next.config.ts apps/web/scripts/verify-csp.ts apps/web/package.json
git commit -m "$(cat <<'EOF'
Set the Content-Security-Policy with a fresh nonce in the proxy, render every page per request, leave the framing header to the proxy, and add verify:csp

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: web 947 tests in 98 files; the other packages unchanged.

---

### Task 4: Cloudflare Turnstile's browser check on the sign-in button

**Kind:** transcription. The plan carries every line: a Sonnet implementer.

**Files:**

- Create: `apps/web/src/lib/turnstile.ts`, `apps/web/src/components/auth/use-turnstile.ts`, `apps/web/src/components/auth/sign-in-failure.ts`, and the tests `apps/web/src/lib/turnstile.test.ts`, `apps/web/src/components/auth/sign-in-failure.test.ts`
- Modify: `apps/web/src/components/auth/sign-in-button.tsx`
- Test: the two new test files

**Interfaces:**

- Consumes: `createClient` from `@/lib/supabase/client` (`auth.signInWithWeb3` with `options.captchaToken`); wagmi's `useAccount`, `useSignMessage`, `useDisconnect`; `toast` from sonner.
- Produces:
  - `turnstile.ts`: `TURNSTILE_SCRIPT_URL`, `TURNSTILE_LOAD_MS = 15_000`, `TurnstileApi = { render; reset; remove }`, `turnstileSiteKey(value = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY): string | null`, `loadTurnstile(doc = document, timeoutMs = 15_000): Promise<TurnstileApi>` (one script per document)
  - `use-turnstile.ts` (`'use client'`): `useTurnstile(siteKey): { container: RefCallback<HTMLDivElement>; token(): string | null; ready: boolean; failed: boolean; reset(): void }`
  - `sign-in-failure.ts`: `SignInFailure = 'rejected' | 'captcha' | 'other'`, `signInFailureOf(error)` (Decision 11)
  - the sign-in button: the widget's container above "Sign in as ...", "Checking your browser…" while a site key is set and no token is held, the failure line, the token sent as `options.captchaToken`, the check reset after any failure

- [ ] **Step 1: Write the failing tests**

The loader's tests run on a fake document that records the scripts appended to its head.

Create `apps/web/src/lib/turnstile.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  loadTurnstile,
  TURNSTILE_LOAD_MS,
  TURNSTILE_SCRIPT_URL,
  turnstileSiteKey,
  type TurnstileApi,
} from './turnstile'

type FakeScript = { src: string; async: boolean; onload: (() => void) | null; onerror: (() => void) | null }

/** A document that records the scripts appended to its head, and the window its loaded script fills. */
function fakeDocument() {
  const appended: FakeScript[] = []
  const view: { turnstile?: TurnstileApi } = {}
  const doc = {
    createElement: (): FakeScript => ({ src: '', async: false, onload: null, onerror: null }),
    head: { appendChild: (script: FakeScript) => appended.push(script) },
    defaultView: view,
  }
  return { doc: doc as unknown as Document, appended, view }
}

const API: TurnstileApi = { render: () => 'widget-1', reset: () => {}, remove: () => {} }

/** What a promise settles to: its value, or the error it rejected with. */
const settled = <T>(promise: Promise<T>) =>
  promise.then(
    (value) => value,
    (error: unknown) => error,
  )

describe('turnstileSiteKey (docs/specs/2026-10-17-production-hardening.md, section 6.1)', () => {
  it('reads a blank key as null and trims a set one', () => {
    expect([turnstileSiteKey(undefined), turnstileSiteKey(''), turnstileSiteKey('   ')]).toEqual([
      null,
      null,
      null,
    ])
    expect(turnstileSiteKey(' 1x00000000000000000000AA ')).toBe('1x00000000000000000000AA')
  })
})

describe('loadTurnstile', () => {
  afterEach(() => vi.useRealTimers())

  it('appends one script for two loads and resolves both with window.turnstile once it loads', async () => {
    const { doc, appended, view } = fakeDocument()
    const first = loadTurnstile(doc)
    const second = loadTurnstile(doc)
    expect(appended).toHaveLength(1)
    expect(appended[0]).toMatchObject({ src: TURNSTILE_SCRIPT_URL, async: true })
    view.turnstile = API
    appended[0]!.onload!()
    expect(await first).toBe(API)
    expect(await second).toBe(API)
  })

  it('rejects when the script fails to load, or loads without its interface', async () => {
    const failing = fakeDocument()
    const failed = loadTurnstile(failing.doc)
    failing.appended[0]!.onerror!()
    expect(String(await settled(failed))).toContain('could not load')
    const empty = fakeDocument()
    const bare = loadTurnstile(empty.doc)
    empty.appended[0]!.onload!()
    expect(String(await settled(bare))).toContain('without its interface')
  })

  it('rejects after 15 s without a load', async () => {
    vi.useFakeTimers()
    const { doc } = fakeDocument()
    const loading = settled(loadTurnstile(doc))
    await vi.advanceTimersByTimeAsync(TURNSTILE_LOAD_MS - 1)
    expect(await Promise.race([loading, Promise.resolve('pending')])).toBe('pending')
    await vi.advanceTimersByTimeAsync(1)
    expect(String(await loading)).toContain('did not load in time')
  })
})
```

Create `apps/web/src/components/auth/sign-in-failure.test.ts`:

```ts
import { UserRejectedRequestError } from 'viem'
import { describe, expect, it } from 'vitest'
import { signInFailureOf } from './sign-in-failure'

describe('signInFailureOf (docs/specs/2026-10-17-production-hardening.md, section 6.2)', () => {
  it("reads a wallet's refusal as rejected, by its words or its code", () => {
    expect(signInFailureOf(new UserRejectedRequestError(new Error('User rejected the request.')))).toBe(
      'rejected',
    )
    expect(signInFailureOf(new Error('MetaMask Tx Signature: User denied message signature.'))).toBe(
      'rejected',
    )
    expect(signInFailureOf({ code: 4001, message: 'Request refused' })).toBe('rejected')
  })

  it("reads Supabase Auth's captcha_failed as captcha", () => {
    expect(
      signInFailureOf({ code: 'captcha_failed', message: 'captcha protection: request disallowed' }),
    ).toBe('captcha')
  })

  it('reads anything else as other', () => {
    for (const error of [
      new Error('Signature verification failed'),
      { code: 'over_request_rate_limit' },
      null,
      'x',
    ])
      expect(signInFailureOf(error)).toBe('other')
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @cobweb/web exec vitest run src/lib/turnstile.test.ts src/components/auth/sign-in-failure.test.ts`
Expected: FAIL, both files on modules that do not exist yet: `Cannot find module './turnstile'`, `Cannot find module './sign-in-failure'` and `Test Files  2 failed (2)`.

- [ ] **Step 3: The loader and the failure's reading**

Create `apps/web/src/lib/turnstile.ts`:

```ts
/**
 * Cloudflare Turnstile, the browser check on wallet sign-in (docs/specs/2026-10-17-production-hardening.md,
 * section 6.1): the site key and the script's loader. The token travels with the signed message to Supabase Auth,
 * which verifies it with Cloudflare before it checks the signature. Without a site key the check is off, as it is
 * locally and in every verify.
 */

export const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
export const TURNSTILE_LOAD_MS = 15_000

export type TurnstileApi = {
  render(container: HTMLElement, options: Record<string, unknown>): string
  reset(widgetId: string): void
  remove(widgetId: string): void
}

/**
 * The site key, or null when it is blank. `process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY` is written out literally so
 * Next inlines the build's value, as it does `NEXT_PUBLIC_DEMO_DATA`.
 */
export function turnstileSiteKey(
  value: string | undefined = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
): string | null {
  const key = value?.trim()
  return key ? key : null
}

/** One load per document: a second call answers the first one's promise. */
const loads = new WeakMap<Document, Promise<TurnstileApi>>()

/**
 * Appends Turnstile's script once and resolves with `window.turnstile` when it loads; rejects on the script's
 * error or after 15 s. The app's nonced bundle inserts the script, which `'strict-dynamic'` admits.
 */
export function loadTurnstile(
  doc: Document = document,
  timeoutMs = TURNSTILE_LOAD_MS,
): Promise<TurnstileApi> {
  const known = loads.get(doc)
  if (known) return known
  const loaded = new Promise<TurnstileApi>((resolve, reject) => {
    const script = doc.createElement('script')
    const timer = setTimeout(() => reject(new Error('The browser check did not load in time.')), timeoutMs)
    script.src = TURNSTILE_SCRIPT_URL
    script.async = true
    script.onload = () => {
      clearTimeout(timer)
      const api = (doc.defaultView as { turnstile?: TurnstileApi } | null)?.turnstile
      if (api) resolve(api)
      else reject(new Error('The browser check loaded without its interface.'))
    }
    script.onerror = () => {
      clearTimeout(timer)
      reject(new Error('The browser check could not load.'))
    }
    doc.head.appendChild(script)
  })
  loads.set(doc, loaded)
  return loaded
}
```

Create `apps/web/src/components/auth/sign-in-failure.ts`:

```ts
/** Why a sign-in failed, as the button words it (docs/specs/2026-10-17-production-hardening.md, section 6.2). */
export type SignInFailure = 'rejected' | 'captcha' | 'other'

/**
 * `captcha` for Supabase Auth's `captcha_failed`, `rejected` for a wallet that refused to sign (code 4001, or a
 * message saying it rejected or denied the request), `other` for anything else.
 */
export function signInFailureOf(error: unknown): SignInFailure {
  const { code, message } = (typeof error === 'object' && error !== null ? error : {}) as {
    code?: unknown
    message?: unknown
  }
  if (code === 'captcha_failed') return 'captcha'
  if (code === 4001 || (typeof message === 'string' && /reject|denied/i.test(message))) return 'rejected'
  return 'other'
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm --filter @cobweb/web exec vitest run src/lib/turnstile.test.ts src/components/auth/sign-in-failure.test.ts`
Expected: PASS, `Tests  7 passed (7)`.

- [ ] **Step 5: The hook and the button**

The widget renders with `action: 'sign-in'`, `appearance: 'interaction-only'`, `size: 'flexible'`, `theme: 'dark'` and `'refresh-expired': 'auto'`, and its token is read when the signature returns (spec section 6.1). Without a site key the button runs as before, as every verify does.

Create `apps/web/src/components/auth/use-turnstile.ts`:

```ts
'use client'

import { useCallback, useEffect, useRef, useState, type RefCallback } from 'react'
import { loadTurnstile, type TurnstileApi } from '@/lib/turnstile'

/**
 * The browser check on the sign-in button (docs/specs/2026-10-17-production-hardening.md, section 6.1). With a site
 * key it renders Turnstile's widget into its container and keeps the latest token, read through `token()` when the
 * signature returns, since a token can refresh while the wallet is open; `ready` while one is held, `failed` once
 * the check errs or its script cannot load; `reset()` asks for a new token. Without a site key it renders nothing
 * and is ready.
 */
export function useTurnstile(siteKey: string | null): {
  container: RefCallback<HTMLDivElement>
  token(): string | null
  ready: boolean
  failed: boolean
  reset(): void
} {
  const [element, setElement] = useState<HTMLDivElement | null>(null)
  const [held, setHeld] = useState(false)
  const [failed, setFailed] = useState(false)
  const latest = useRef<string | null>(null)
  const widget = useRef<{ api: TurnstileApi; id: string } | null>(null)

  useEffect(() => {
    if (!siteKey || !element) return
    let gone = false
    loadTurnstile().then(
      (api) => {
        if (gone) return
        const id = api.render(element, {
          sitekey: siteKey,
          action: 'sign-in',
          appearance: 'interaction-only',
          size: 'flexible',
          theme: 'dark',
          'refresh-expired': 'auto',
          callback: (token: string) => {
            latest.current = token
            setHeld(true)
            setFailed(false)
          },
          'expired-callback': () => {
            latest.current = null
            setHeld(false)
          },
          'error-callback': () => {
            latest.current = null
            setHeld(false)
            setFailed(true)
          },
        })
        widget.current = { api, id }
      },
      () => {
        if (!gone) setFailed(true)
      },
    )
    return () => {
      gone = true
      latest.current = null
      if (widget.current) widget.current.api.remove(widget.current.id)
      widget.current = null
    }
  }, [siteKey, element])

  const token = useCallback(() => latest.current, [])
  const reset = useCallback(() => {
    if (!widget.current) return
    latest.current = null
    setHeld(false)
    widget.current.api.reset(widget.current.id)
  }, [])

  return { container: setElement, token, ready: siteKey === null || held, failed, reset }
}
```

In `apps/web/src/components/auth/sign-in-button.tsx`, replace:

```tsx
import { createClient } from '@/lib/supabase/client'
```

with:

```tsx
import { createClient } from '@/lib/supabase/client'
import { turnstileSiteKey } from '@/lib/turnstile'
import { signInFailureOf } from './sign-in-failure'
import { useTurnstile } from './use-turnstile'
```

In `apps/web/src/components/auth/sign-in-button.tsx`, replace:

```tsx
/**
 * Two steps, one button: connect a wallet, then sign a message to prove it is yours. The signed
 * message is verified by Supabase, which starts the session. Signing costs nothing and sends no
 * transaction.
```

with:

```tsx
/** What each failure says, in the toast (docs/specs/2026-10-17-production-hardening.md, section 9.3). */
const FAILURE_SENTENCE = {
  rejected: 'Signature request cancelled.',
  captcha: 'The browser check did not pass. Try again.',
  other: 'Sign-in failed. Try again.',
} as const

/**
 * Two steps, one button: connect a wallet, then sign a message to prove it is yours. The signed
 * message is verified by Supabase, which starts the session. Signing costs nothing and sends no
 * transaction. With a Turnstile site key, a browser check runs above the button once the wallet is
 * connected, and its token travels with the signature; Supabase Auth verifies it before the signature
 * (docs/specs/2026-10-17-production-hardening.md, section 6.2).
```

In `apps/web/src/components/auth/sign-in-button.tsx`, replace:

```tsx
  const [signingIn, setSigningIn] = useState(false)
```

with:

```tsx
  const [signingIn, setSigningIn] = useState(false)
  const siteKey = turnstileSiteKey()
  const check = useTurnstile(siteKey)
```

In `apps/web/src/components/auth/sign-in-button.tsx`, replace:

```tsx
      const { error } = await createClient().auth.signInWithWeb3({ chain: 'ethereum', message, signature })
```

with:

```tsx
      // Read when the signature returns: the token can refresh while the wallet is open.
      const captchaToken = check.token()
      const { error } = await createClient().auth.signInWithWeb3({
        chain: 'ethereum',
        message,
        signature,
        ...(captchaToken ? { options: { captchaToken } } : {}),
      })
```

In `apps/web/src/components/auth/sign-in-button.tsx`, replace:

```tsx
      const rejected = error instanceof Error && /reject|denied/i.test(error.message)
      toast.error(rejected ? 'Signature request cancelled.' : 'Sign-in failed. Try again.')
```

with:

```tsx
      toast.error(FAILURE_SENTENCE[signInFailureOf(error)])
      // Supabase spends a token once it is sent, so the next attempt asks for a new one.
      check.reset()
```

In `apps/web/src/components/auth/sign-in-button.tsx`, replace:

```tsx
  return (
    <div className="flex w-full flex-col items-center gap-3">
      <Button size="lg" className="w-full" onClick={signIn} disabled={signingIn}>
        {signingIn && <Spinner />}
        {signingIn ? 'Check your wallet…' : `Sign in as ${truncate(address)}`}
      </Button>
```

with:

```tsx
  const checking = !check.ready
  return (
    <div className="flex w-full flex-col items-center gap-3">
      {siteKey && <div ref={check.container} className="w-full empty:hidden" />}
      <Button size="lg" className="w-full" onClick={signIn} disabled={signingIn || checking}>
        {(signingIn || (checking && !check.failed)) && <Spinner />}
        {signingIn
          ? 'Check your wallet…'
          : checking
            ? 'Checking your browser…'
            : `Sign in as ${truncate(address)}`}
      </Button>
      {check.failed && (
        <p role="alert" className="text-destructive-foreground text-center text-sm">
          The browser check could not run. Reload the page and try again.
        </p>
      )}
```

- [ ] **Step 6: Typecheck and lint the web app**

Run: `pnpm --filter @cobweb/web typecheck && pnpm --filter @cobweb/web lint`
Expected: PASS.

- [ ] **Step 7: Format, run the root checks and commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
pnpm exec prettier --write apps/web/src/lib/turnstile.ts apps/web/src/lib/turnstile.test.ts apps/web/src/components/auth/use-turnstile.ts apps/web/src/components/auth/sign-in-failure.ts apps/web/src/components/auth/sign-in-failure.test.ts apps/web/src/components/auth/sign-in-button.tsx
pnpm typecheck && pnpm lint && pnpm test
git add apps/web/src/lib/turnstile.ts apps/web/src/lib/turnstile.test.ts apps/web/src/components/auth/use-turnstile.ts apps/web/src/components/auth/sign-in-failure.ts apps/web/src/components/auth/sign-in-failure.test.ts apps/web/src/components/auth/sign-in-button.tsx
git commit -m "$(cat <<'EOF'
Run Cloudflare Turnstile's browser check on the sign-in button when a site key is set, send its token with the signature, and word each refusal

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: web 954 tests in 100 files; the other packages unchanged.

---

### Task 5: The draft cap in the create action

**Kind:** transcription. The plan carries every line: a Sonnet implementer.

**Files:**

- Create: `apps/web/src/lib/collections.test.ts`
- Modify: `apps/web/src/lib/collections.ts`, `apps/web/src/app/actions/collections.ts`
- Test: `apps/web/src/lib/collections.test.ts`

**Interfaces:**

- Consumes: `profiles.draft_cap` and the trigger's refusal (Task 1); `getVerifiedUser`; `createClient` from `@/lib/supabase/server`.
- Produces: `DRAFT_CAP_DEFAULT = 20`, `DRAFT_CAP_REFUSAL`, `draftCapSentence(cap): string`, `draftCapOf(error): number | null` (Decision 12); `createCollection` reading the creator's cap and its collections that are not deployed after the session check and the form's validation, and answering `{ formError: draftCapSentence(cap) }` at the cap or on the trigger's refusal.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/lib/collections.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { DRAFT_CAP_DEFAULT, DRAFT_CAP_REFUSAL, draftCapOf, draftCapSentence } from './collections'

describe('the draft cap (docs/specs/2026-10-17-production-hardening.md, section 6.4)', () => {
  it("words the dialog's refusal with the wallet's cap", () => {
    expect(draftCapSentence(20)).toBe(
      'This wallet already has 20 collections that are not deployed, the most it can hold. Delete a draft or deploy one, then create this one.',
    )
    expect(draftCapSentence(22)).toContain('already has 22 collections')
  })

  it("reads the cap from the trigger's refusal and its detail", () => {
    expect(draftCapOf({ code: '23514', message: DRAFT_CAP_REFUSAL, details: '20' })).toBe(20)
    expect(draftCapOf({ code: '23514', message: DRAFT_CAP_REFUSAL, details: '1000' })).toBe(1000)
  })

  it('reads the default cap when the refusal has no usable detail', () => {
    expect(draftCapOf({ code: '23514', message: DRAFT_CAP_REFUSAL })).toBe(DRAFT_CAP_DEFAULT)
    expect(draftCapOf({ code: '23514', message: DRAFT_CAP_REFUSAL, details: 'many' })).toBe(DRAFT_CAP_DEFAULT)
  })

  it('reads no cap from another 23514, another code or no error', () => {
    expect(
      draftCapOf({ code: '23514', message: 'Keep the name under 64 characters.', details: '20' }),
    ).toBeNull()
    expect(draftCapOf({ code: '42501', message: DRAFT_CAP_REFUSAL, details: '20' })).toBeNull()
    expect(draftCapOf(null)).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @cobweb/web exec vitest run src/lib/collections.test.ts`
Expected: FAIL, the cap's exports missing: `draftCapSentence is not a function` and `Tests  4 failed (4)`.

- [ ] **Step 3: The sentence, the refusal's reading and the action**

Row-level security limits both reads to the creator's own rows; the action words the cap first, and the trigger refuses the same insert under its lock, worded the same (spec section 6.4).

In `apps/web/src/lib/collections.ts`, replace:

```ts
export const RESERVATION_DAYS = 3
```

with:

```ts
export const RESERVATION_DAYS = 3

/**
 * The most collections that are not deployed a wallet holds unless support raised its `profiles.draft_cap`
 * (docs/specs/2026-10-17-production-hardening.md, section 6.4), so mint page links cannot be squatted in bulk.
 */
export const DRAFT_CAP_DEFAULT = 20

/** The database's refusal of an insert past the cap, its `detail` the cap. */
export const DRAFT_CAP_REFUSAL = 'This wallet holds its limit of collections that are not deployed.'

/** What the Create collection dialog says at the cap. */
export function draftCapSentence(cap: number): string {
  return `This wallet already has ${cap} collections that are not deployed, the most it can hold. Delete a draft or deploy one, then create this one.`
}

/**
 * The cap an insert refusal names: the trigger's 23514 with its message, its `details` the cap (the default when
 * a detail is missing); null for any other error.
 */
export function draftCapOf(
  error: { code?: string; message?: string; details?: string } | null,
): number | null {
  if (error?.code !== '23514' || error.message !== DRAFT_CAP_REFUSAL) return null
  const cap = Number(error.details)
  return error.details && Number.isInteger(cap) && cap >= 0 ? cap : DRAFT_CAP_DEFAULT
}
```

In `apps/web/src/app/actions/collections.ts`, replace:

```ts
import { createCollectionSchema } from '@/lib/collections'
```

with:

```ts
import { createCollectionSchema, DRAFT_CAP_DEFAULT, draftCapOf, draftCapSentence } from '@/lib/collections'
```

In `apps/web/src/app/actions/collections.ts`, replace:

```ts
 * folder upload while there are no layers; 1/1s and Single asset on the asset upload.
```

with:

```ts
 * folder upload while there are no layers; 1/1s and Single asset on the asset upload.
 *
 * A wallet holds at most its `profiles.draft_cap` collections that are not deployed
 * (docs/specs/2026-10-17-production-hardening.md, section 6.4): the count is read first so the dialog
 * words the refusal, and the database's trigger refuses the same insert under a lock, worded the same.
```

In `apps/web/src/app/actions/collections.ts`, replace:

```ts
  const supabase = await createClient()
```

with:

```ts
  const supabase = await createClient()
  // Row-level security limits both reads to the creator's own rows.
  const [profile, held] = await Promise.all([
    supabase.from('profiles').select('draft_cap').eq('id', user.id).maybeSingle(),
    supabase
      .from('collections')
      .select('id', { count: 'exact', head: true })
      .eq('owner_id', user.id)
      .neq('status', 'deployed'),
  ])
  const cap = profile.data?.draft_cap ?? DRAFT_CAP_DEFAULT
  if ((held.count ?? 0) >= cap) return { formError: draftCapSentence(cap) }

```

In `apps/web/src/app/actions/collections.ts`, replace:

```ts
  if (error) return { formError: 'The collection could not be created. Try again.' }
```

with:

```ts
  if (error) {
    const refusedAt = draftCapOf(error)
    return {
      formError:
        refusedAt === null ? 'The collection could not be created. Try again.' : draftCapSentence(refusedAt),
    }
  }
```

- [ ] **Step 4: Run the tests to see them pass, then typecheck and lint the web app**

Run: `pnpm --filter @cobweb/web exec vitest run src/lib/collections.test.ts`
Expected: PASS, `Tests  4 passed (4)`.

Run: `pnpm --filter @cobweb/web typecheck && pnpm --filter @cobweb/web lint`
Expected: PASS.

- [ ] **Step 5: Format, run the root checks and commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
pnpm exec prettier --write apps/web/src/lib/collections.ts apps/web/src/lib/collections.test.ts apps/web/src/app/actions/collections.ts
pnpm typecheck && pnpm lint && pnpm test
git add apps/web/src/lib/collections.ts apps/web/src/lib/collections.test.ts apps/web/src/app/actions/collections.ts
git commit -m "$(cat <<'EOF'
Refuse a new collection past the wallet's draft cap in the create action, worded as the database's refusal is

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: web 958 tests in 101 files; the other packages unchanged.

---

### Task 6: The source sweep, its daily cron, the thumbnails served once originals are gone, the Art notice, and `verify:sources`

**Kind:** integration: a storage port, a cron, a route and a screen beside a verify on local storage: an Opus implementer.

**Files:**

- Create: `apps/web/src/lib/storage/source-sweep.ts`, `apps/web/src/lib/storage/source-sweep-deps.ts`, `apps/web/src/app/api/cron/source-sweep/route.ts`, `apps/web/scripts/verify-sources.ts`, and the tests `apps/web/src/lib/storage/source-sweep.test.ts`, `source-sweep-route.test.ts`
- Modify: `apps/web/src/lib/storage/uploads-service.ts` and its test, `apps/web/src/app/api/uploads/[id]/route.ts`, `apps/web/src/components/shell/art-live-notice.tsx`, `apps/web/src/app/collections/[id]/art/layout.tsx`, `apps/web/src/lib/supabase/service.ts` (its callers), `apps/web/vercel.json`, `apps/web/src/lib/render/vercel-config.test.ts`, `apps/web/package.json` (the command)
- Test: the two new test files, `uploads-service.test.ts`, `vercel-config.test.ts`; `pnpm --filter @cobweb/web verify:sources`

**Interfaces:**

- Consumes: `collections_sources_due`, `collection_sources_deleted` and `art_sources_deleted_at` (Task 1); `listObjectPages`, `deleteObjects` and `presignPut` from `@/lib/storage/objects`; `createServiceClient`; `cronAuthorized` from `@/lib/render/env`; `consoleLog` and `errorSummary` from `@cobweb/worker`; `collection_record_deploy` and `reserve_slug` (in the verify).
- Produces:
  - `source-sweep.ts`: `SOURCE_RETENTION_DAYS = 90`, `SOURCES_PER_RUN = 20`, `SOURCE_FOLDERS`, `DueCollection`, `SourceSweepDeps = { due; list; remove; mark }`, `SourceSweepReport = { dryRun; due; deleted; marked; failed }`, `sourcePrefixes(collectionId)`, `sourceSweepDryRun(env)`, `sizeText(bytes)`, `sweepSources(deps, { dryRun, limit?, log? })`
  - `source-sweep-deps.ts`: `sourceSweepDeps(): SourceSweepDeps`
  - `GET /api/cron/source-sweep` (`maxDuration = 300`), daily at 07:30 UTC in `vercel.json`
  - `uploads-service.ts`: `servedKeyOf({ variant, kind, key, thumbnailKey, sourcesDeleted }): string | null` (Decision 13); `ArtLiveNotice`'s `sourcesDeleted: boolean` and the sample's `?sources=deleted`
  - `verify:sources`, nine checks

- [ ] **Step 1: Write the failing tests**

The core's tests run on a bucket in memory; the route's mock the sweep and its port, as the render sweep's test does.

Create `apps/web/src/lib/storage/source-sweep.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  sizeText,
  SOURCE_FOLDERS,
  sourcePrefixes,
  sourceSweepDryRun,
  sweepSources,
  type DueCollection,
  type SourceSweepDeps,
} from './source-sweep'

const A = '0a977c0b-7e53-476b-8c08-6c685315c3af'
const B = '5b2c1d3e-4f50-4617-8829-3a4b5c6d7e8f'

/**
 * A bucket in memory: the keys it holds, listed a page of `pageSize` at a time; the calls the sweep made; and a
 * removal that fails for the collections named in `failing`.
 */
function fakeDeps(
  keys: string[],
  due: DueCollection[],
  options: { pageSize?: number; failing?: string[] } = {},
) {
  const stored = new Set(keys)
  const calls: string[] = []
  const deps: SourceSweepDeps = {
    async due(limit) {
      calls.push(`due ${limit}`)
      return due.slice(0, limit)
    },
    async *list(prefix) {
      calls.push(`list ${prefix}`)
      const matching = [...stored].filter((key) => key.startsWith(prefix)).sort()
      const size = options.pageSize ?? 1000
      for (let at = 0; at < matching.length; at += size)
        yield matching.slice(at, at + size).map((key) => ({ key }))
      if (!matching.length) yield []
    },
    async remove(removed) {
      calls.push(`remove ${removed.length}`)
      if (options.failing?.some((id) => removed[0]!.startsWith(id)))
        throw new Error('Storage refused: http://s3.test/x')
      for (const key of removed) stored.delete(key)
    },
    async mark(collectionId) {
      calls.push(`mark ${collectionId}`)
      return true
    },
  }
  return { deps, stored, calls }
}

/** A collection's originals and thumbnails, two of each kind. */
const filesOf = (id: string) => [
  ...SOURCE_FOLDERS.flatMap((folder) => [`${id}/${folder}/1.png`, `${id}/${folder}/2.png`]),
  `${id}/thumbnails/1.webp`,
  `${id}/thumbnails/2.webp`,
]

describe('sourcePrefixes and sourceSweepDryRun (docs/specs/2026-10-17-production-hardening.md, section 7.1)', () => {
  it("names a collection's three source folders and never its thumbnails", () => {
    expect(sourcePrefixes(A)).toEqual([`${A}/layers/`, `${A}/assets/`, `${A}/placeholders/`])
  })

  it('runs dry unless SOURCE_SWEEP_DELETE is 1', () => {
    expect([{}, { SOURCE_SWEEP_DELETE: '' }, { SOURCE_SWEEP_DELETE: 'true' }].map(sourceSweepDryRun)).toEqual(
      [true, true, true],
    )
    expect(sourceSweepDryRun({ SOURCE_SWEEP_DELETE: '1' })).toBe(false)
  })

  it('writes a size in the units the log reads', () => {
    expect([512, 3_500, 13_107_200, 1_288_490_189].map(sizeText)).toEqual([
      '512 B',
      '3.4 KB',
      '12.5 MB',
      '1.2 GB',
    ])
  })
})

describe('sweepSources', () => {
  it('lists and logs a dry run, deleting and marking nothing', async () => {
    const lines: string[] = []
    const { deps, stored, calls } = fakeDeps(filesOf(A), [{ collectionId: A, objects: 6, bytes: 13_107_200 }])
    const report = await sweepSources(deps, { dryRun: true, log: (line) => lines.push(line) })
    expect(report).toEqual({ dryRun: true, due: 1, deleted: 0, marked: 0, failed: [] })
    expect(stored.size).toBe(8)
    expect(calls.some((call) => call.startsWith('remove') || call.startsWith('mark'))).toBe(false)
    expect(lines).toEqual([
      `Source sweep (dry run): ${A} has 6 original files (12.5 MB) due; nothing was deleted.`,
    ])
  })

  it('deletes the three folders a page at a time, keeps the thumbnails, and marks after an empty list', async () => {
    const lines: string[] = []
    const { deps, stored, calls } = fakeDeps(filesOf(A), [{ collectionId: A, objects: 6, bytes: 2_048 }], {
      pageSize: 1,
    })
    const report = await sweepSources(deps, { dryRun: false, log: (line) => lines.push(line) })
    expect(report).toEqual({ dryRun: false, due: 1, deleted: 6, marked: 1, failed: [] })
    expect([...stored].sort()).toEqual([`${A}/thumbnails/1.webp`, `${A}/thumbnails/2.webp`])
    expect(calls.filter((call) => call.startsWith('remove'))).toEqual(Array(6).fill('remove 1'))
    // The mark comes after the second listing of all three folders.
    expect(calls.at(-1)).toBe(`mark ${A}`)
    expect(calls.slice(-4, -1)).toEqual(sourcePrefixes(A).map((prefix) => `list ${prefix}`))
    expect(lines).toEqual([`Source sweep: deleted 6 original files (2.0 KB) of ${A}.`])
  })

  it('leaves a failed collection unmarked, logs it without its URL, and goes on to the next', async () => {
    const lines: string[] = []
    const due = [
      { collectionId: A, objects: 6, bytes: 100 },
      { collectionId: B, objects: 6, bytes: 100 },
    ]
    const { deps, stored, calls } = fakeDeps([...filesOf(A), ...filesOf(B)], due, { failing: [A] })
    const report = await sweepSources(deps, { dryRun: false, log: (line) => lines.push(line) })
    expect(report).toEqual({ dryRun: false, due: 2, deleted: 6, marked: 1, failed: [A] })
    expect(calls).not.toContain(`mark ${A}`)
    expect(calls).toContain(`mark ${B}`)
    expect([...stored].filter((key) => key.startsWith(A))).toHaveLength(8)
    expect(lines[0]).toBe(
      `Source sweep: ${A} failed and is tried again tomorrow: Error: Storage refused: [url]`,
    )
  })

  it('refuses to mark a collection whose folders still list files after the removal', async () => {
    const { deps, calls } = fakeDeps(filesOf(A), [{ collectionId: A, objects: 6, bytes: 100 }])
    const removeNothing: SourceSweepDeps = { ...deps, remove: async () => {} }
    const report = await sweepSources(removeNothing, { dryRun: false, log: () => {} })
    expect(report).toMatchObject({ deleted: 0, marked: 0, failed: [A] })
    expect(calls).not.toContain(`mark ${A}`)
  })

  it('asks for 20 collections a run unless told another limit', async () => {
    const { deps, calls } = fakeDeps([], [])
    await sweepSources(deps, { dryRun: true, log: () => {} })
    await sweepSources(deps, { dryRun: true, limit: 3, log: () => {} })
    expect(calls).toEqual(['due 20', 'due 3'])
  })
})
```

Create `apps/web/src/lib/storage/source-sweep-route.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/cron/source-sweep/route'

const mocks = vi.hoisted(() => ({
  sweepSources: vi.fn<(deps: unknown, options: { dryRun: boolean }) => Promise<unknown>>(),
  sourceSweepDeps: vi.fn<() => unknown>(() => ({ port: 'sources' })),
  log: vi.fn<(event: string, fields?: Record<string, unknown>) => void>(),
}))
vi.mock('@cobweb/worker', () => ({
  consoleLog: mocks.log,
  errorSummary: (error: unknown) => `${(error as Error).name}: [masked]`,
}))
vi.mock('@/lib/storage/source-sweep', async (original) => ({
  ...(await original<typeof import('@/lib/storage/source-sweep')>()),
  sweepSources: mocks.sweepSources,
}))
vi.mock('@/lib/storage/source-sweep-deps', () => ({ sourceSweepDeps: mocks.sourceSweepDeps }))

const SECRET = 'cron-secret-value'
const request = (authorization?: string) =>
  new Request('https://cobweb.test/api/cron/source-sweep', {
    headers: authorization === undefined ? {} : { authorization },
  })
const REPORT = { dryRun: true, due: 1, deleted: 0, marked: 0, failed: [] }

describe('GET /api/cron/source-sweep (docs/specs/2026-10-17-production-hardening.md, section 7.2)', () => {
  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', SECRET)
    mocks.sweepSources.mockReset()
    mocks.log.mockReset()
  })
  afterEach(() => vi.unstubAllEnvs())

  it('answers 404 and does not sweep without the secret', async () => {
    for (const header of [undefined, 'Bearer other-secret-value', SECRET])
      expect((await GET(request(header))).status).toBe(404)
    vi.stubEnv('CRON_SECRET', '')
    expect((await GET(request('Bearer '))).status).toBe(404)
    expect(mocks.sweepSources).not.toHaveBeenCalled()
  })

  it('sweeps dry until SOURCE_SWEEP_DELETE is 1, and answers the report', async () => {
    mocks.sweepSources.mockResolvedValue(REPORT)
    const response = await GET(request(`Bearer ${SECRET}`))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(REPORT)
    expect(mocks.sweepSources).toHaveBeenLastCalledWith({ port: 'sources' }, { dryRun: true })
    vi.stubEnv('SOURCE_SWEEP_DELETE', '1')
    await GET(request(`Bearer ${SECRET}`))
    expect(mocks.sweepSources).toHaveBeenLastCalledWith({ port: 'sources' }, { dryRun: false })
  })

  it('answers 500 with an empty body and logs the masked error when the sweep throws', async () => {
    mocks.sweepSources.mockRejectedValue(new Error('https://db.example/?key=abc'))
    const response = await GET(request(`Bearer ${SECRET}`))
    expect(response.status).toBe(500)
    expect(await response.text()).toBe('')
    expect(mocks.log).toHaveBeenCalledWith('source sweep failed', { error: 'Error: [masked]' })
  })
})
```

In `apps/web/src/lib/storage/uploads-service.test.ts`, replace:

```ts
import { admissionInputProblem, servedUrl, toRecord } from './uploads-service'
```

with:

```ts
import { admissionInputProblem, servedKeyOf, servedUrl, toRecord } from './uploads-service'
```

In `apps/web/src/lib/storage/uploads-service.test.ts`, replace:

```ts
  })
})
```

with:

```ts
  })
})

describe('servedKeyOf (docs/specs/2026-10-17-production-hardening.md, section 7.3)', () => {
  const original = {
    kind: 'layer_image' as const,
    key: 'c/layers/a.png',
    thumbnailKey: 'c/thumbnails/a.webp',
  }
  const served = (variant: 'original' | 'thumb', sourcesDeleted: boolean, thumbnailKey: string | null) =>
    servedKeyOf({ ...original, variant, thumbnailKey, sourcesDeleted })

  it('serves an original, and its thumbnail for ?variant=thumb, falling back to the original before the purge', () => {
    expect(served('original', false, original.thumbnailKey)).toBe('c/layers/a.png')
    expect(served('thumb', false, original.thumbnailKey)).toBe('c/thumbnails/a.webp')
    expect(served('thumb', false, null)).toBe('c/layers/a.png')
  })

  it('serves only the thumbnail once the originals are deleted, and nothing for an original-size view', () => {
    expect(served('thumb', true, original.thumbnailKey)).toBe('c/thumbnails/a.webp')
    expect(served('thumb', true, null)).toBeNull()
    expect(served('original', true, original.thumbnailKey)).toBeNull()
    expect(served('original', true, null)).toBeNull()
  })

  it('serves a thumbnail row as itself, marked or not', () => {
    for (const sourcesDeleted of [false, true])
      for (const variant of ['original', 'thumb'] as const)
        expect(
          servedKeyOf({
            kind: 'thumbnail',
            key: 'c/thumbnails/a.webp',
            thumbnailKey: null,
            variant,
            sourcesDeleted,
          }),
        ).toBe('c/thumbnails/a.webp')
  })
})
```

In `apps/web/src/lib/render/vercel-config.test.ts`, replace:

```ts
const SWEEP = 'src/app/api/cron/render-sweep/route.ts'
```

with:

```ts
const SWEEP = 'src/app/api/cron/render-sweep/route.ts'
const SOURCE_SWEEP = 'src/app/api/cron/source-sweep/route.ts'
```

In `apps/web/src/lib/render/vercel-config.test.ts`, replace:

```ts
  it('runs the sweep every 15 minutes, on a route that exists', () => {
    expect(config.crons).toEqual([{ path: '/api/cron/render-sweep', schedule: '*/15 * * * *' }])
    expect(existsSync(app(SWEEP))).toBe(true)
```

with:

```ts
  it('runs the render sweep every 15 minutes and the source sweep daily, on routes that exist', () => {
    expect(config.crons).toEqual([
      { path: '/api/cron/render-sweep', schedule: '*/15 * * * *' },
      { path: '/api/cron/source-sweep', schedule: '30 7 * * *' },
    ])
    expect(existsSync(app(SWEEP))).toBe(true)
    expect(existsSync(app(SOURCE_SWEEP))).toBe(true)
    expect(readFileSync(app(SOURCE_SWEEP), 'utf8')).toContain('export const maxDuration = 300')
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @cobweb/web exec vitest run src/lib/storage src/lib/render/vercel-config.test.ts`
Expected: FAIL, the sweep's two modules missing, the serving rule not yet exported and the cron not yet scheduled: `Cannot find module './source-sweep'`, `Cannot find package '@/app/api/cron/source-sweep/route'`, `servedKeyOf is not a function`, `runs the render sweep every 15 minutes and the source sweep daily, on routes that exist` and `Test Files  4 failed | 5 passed (9)`.

- [ ] **Step 3: The core**

A run deletes each due collection's three folders a page at a time, lists them again and marks the collection only once they list empty (spec section 7.1, Decision 10).

Create `apps/web/src/lib/storage/source-sweep.ts`:

```ts
/**
 * The layer sources' lifecycle (docs/specs/2026-10-17-production-hardening.md, section 7.1), pure: a daily sweep
 * deletes a collection's original files, the `layers`, `assets` and `placeholders` folders under its id in the art
 * bucket, once it was deployed at least 90 days ago and its last real render finished at least 90 days ago. The
 * thumbnails, the rendered output on IPFS, the metadata and every row stay. The database decides what is due
 * (`collections_sources_due`) and marks a collection once its folders list empty (`collection_sources_deleted`),
 * so a failed run leaves no mark and the next one resumes. It runs dry until SOURCE_SWEEP_DELETE is 1.
 */

/** The database's two functions write 90 days once each, naming this constant. */
export const SOURCE_RETENTION_DAYS = 90
export const SOURCES_PER_RUN = 20
export const SOURCE_FOLDERS = ['layers', 'assets', 'placeholders'] as const

export type DueCollection = { collectionId: string; objects: number; bytes: number }

export type SourceSweepDeps = {
  /** The due collections, oldest deploy first, at most `limit`. */
  due(limit: number): Promise<DueCollection[]>
  /** The art bucket's objects under a prefix, a page at a time. */
  list(prefix: string): AsyncIterable<{ key: string }[]>
  remove(keys: string[]): Promise<void>
  /** Marks the collection's originals deleted: true when this call set the mark. */
  mark(collectionId: string): Promise<boolean>
}

export type SourceSweepReport = {
  dryRun: boolean
  due: number
  deleted: number
  marked: number
  failed: string[]
}

/** A collection's three source folders. Never its thumbnails. */
export function sourcePrefixes(collectionId: string): string[] {
  return SOURCE_FOLDERS.map((folder) => `${collectionId}/${folder}/`)
}

/** True unless SOURCE_SWEEP_DELETE is 1: the sweep logs what it would delete and deletes nothing. */
export function sourceSweepDryRun(env: Record<string, string | undefined>): boolean {
  return env.SOURCE_SWEEP_DELETE !== '1'
}

const KB = 1024
/** A size as the log writes it: 512 B, 3.4 KB, 12.5 MB, 1.2 GB. */
export function sizeText(bytes: number): string {
  if (bytes < KB) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / KB
  let unit = 0
  while (value >= KB && unit < units.length - 1) {
    value /= KB
    unit++
  }
  return `${value.toFixed(1)} ${units[unit]}`
}

/** A failure as the log writes it: its name and its first line, any URL replaced, cut at 200 characters. */
function failureText(error: unknown): string {
  if (!(error instanceof Error)) return 'Unknown error'
  const line = (error.message.split('\n')[0] ?? '').replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[url]')
  return `${error.name}: ${line}`.slice(0, 200)
}

/** The keys under a collection's three folders, a page at a time. */
async function* sourcePages(deps: SourceSweepDeps, collectionId: string): AsyncGenerator<string[]> {
  for (const prefix of sourcePrefixes(collectionId))
    for await (const page of deps.list(prefix)) yield page.map((entry) => entry.key)
}

/**
 * One run: the due collections (20 by default), each listed folder by folder. A dry run logs each one's files and
 * recorded size and deletes nothing. Otherwise the keys are removed a page at a time, the folders listed again to
 * confirm none is left, and the collection marked. A failure for one collection is logged and listed, leaves no
 * mark, and the run goes on to the next.
 */
export async function sweepSources(
  deps: SourceSweepDeps,
  options: { dryRun: boolean; limit?: number; log?: (line: string) => void },
): Promise<SourceSweepReport> {
  const log = options.log ?? ((line: string) => console.log(line))
  const due = await deps.due(options.limit ?? SOURCES_PER_RUN)
  const report: SourceSweepReport = {
    dryRun: options.dryRun,
    due: due.length,
    deleted: 0,
    marked: 0,
    failed: [],
  }
  for (const entry of due) {
    try {
      if (options.dryRun) {
        let found = 0
        for await (const keys of sourcePages(deps, entry.collectionId)) found += keys.length
        log(
          `Source sweep (dry run): ${entry.collectionId} has ${found} original files (${sizeText(entry.bytes)}) due; nothing was deleted.`,
        )
        continue
      }
      let deleted = 0
      for await (const keys of sourcePages(deps, entry.collectionId)) {
        if (!keys.length) continue
        await deps.remove(keys)
        deleted += keys.length
      }
      for await (const keys of sourcePages(deps, entry.collectionId))
        if (keys.length) throw new Error(`${keys.length} original files are still stored.`)
      if (await deps.mark(entry.collectionId)) report.marked++
      report.deleted += deleted
      log(
        `Source sweep: deleted ${deleted} original files (${sizeText(entry.bytes)}) of ${entry.collectionId}.`,
      )
    } catch (error) {
      report.failed.push(entry.collectionId)
      log(`Source sweep: ${entry.collectionId} failed and is tried again tomorrow: ${failureText(error)}`)
    }
  }
  return report
}
```

- [ ] **Step 4: The port and the cron**

Create `apps/web/src/lib/storage/source-sweep-deps.ts`:

```ts
import 'server-only'
import { createServiceClient } from '@/lib/supabase/service'
import { deleteObjects, listObjectPages } from './objects'
import type { DueCollection, SourceSweepDeps } from './source-sweep'

/**
 * The source sweep's port (docs/specs/2026-10-17-production-hardening.md, section 7.2): the art bucket through the
 * storage module, and the two service-role functions through the service client. Server only; the daily cron
 * builds it, with no session.
 */
export function sourceSweepDeps(): SourceSweepDeps {
  const supabase = createServiceClient()
  return {
    async due(limit) {
      const { data, error } = await supabase.rpc('collections_sources_due', { p_limit: limit })
      if (error) throw new Error(`The due collections could not be read (${error.code}).`)
      return data as DueCollection[]
    },
    list: (prefix) => listObjectPages(prefix),
    remove: (keys) => deleteObjects(keys),
    async mark(collectionId) {
      const { data, error } = await supabase.rpc('collection_sources_deleted', {
        p_collection_id: collectionId,
      })
      if (error) throw new Error(`The collection could not be marked (${error.code}): ${error.message}`)
      return data === true
    },
  }
}
```

Create `apps/web/src/app/api/cron/source-sweep/route.ts`:

```ts
import { consoleLog, errorSummary } from '@cobweb/worker'
import { cronAuthorized } from '@/lib/render/env'
import { sourceSweepDryRun, sweepSources } from '@/lib/storage/source-sweep'
import { sourceSweepDeps } from '@/lib/storage/source-sweep-deps'

/** Up to 20 collections a run, each a few list and delete calls. */
export const maxDuration = 300

/**
 * The source sweep, run by Vercel Cron every day at 07:30 UTC (docs/specs/2026-10-17-production-hardening.md,
 * section 7.2): deletes the original files of the collections due, dry until SOURCE_SWEEP_DELETE is 1, and answers
 * the run's report. Vercel sends `Authorization: Bearer <CRON_SECRET>`; any other caller gets a 404, as the render
 * sweep answers. A failure is logged masked and answered with an empty 500.
 */
export async function GET(request: Request): Promise<Response> {
  if (!cronAuthorized(request.headers.get('authorization'), process.env.CRON_SECRET))
    return new Response(null, { status: 404 })
  try {
    const report = await sweepSources(sourceSweepDeps(), { dryRun: sourceSweepDryRun(process.env) })
    return Response.json(report)
  } catch (error) {
    consoleLog('source sweep failed', { error: errorSummary(error) })
    return new Response(null, { status: 500 })
  }
}
```

In `apps/web/src/lib/supabase/service.ts`, replace:

```ts
 * read or a write a creator's session can do. No session is kept.
```

with:

```ts
 * read or a write a creator's session can do. No session is kept. The daily source sweep's port
 * (lib/storage/source-sweep-deps.ts) also calls `collections_sources_due` and
 * `collection_sources_deleted` with it, for no creator (docs/specs/2026-10-17-production-hardening.md,
 * section 7.2).
```

In `apps/web/vercel.json`, replace:

```json
  "crons": [{ "path": "/api/cron/render-sweep", "schedule": "*/15 * * * *" }]
```

with:

```json
  "crons": [
    { "path": "/api/cron/render-sweep", "schedule": "*/15 * * * *" },
    { "path": "/api/cron/source-sweep", "schedule": "30 7 * * *" }
  ]
```

- [ ] **Step 5: Serving the thumbnails, and the notice**

In `apps/web/src/lib/storage/uploads-service.ts`, replace:

```ts
export type ConfirmInput = AdmitInput & { key: string; thumbnailKey: string | null }

export function servedUrl(id: string, variant?: 'thumb'): string {
```

with:

```ts
export type ConfirmInput = AdmitInput & { key: string; thumbnailKey: string | null }

/**
 * The key `/api/uploads/[id]` signs (docs/specs/2026-10-17-production-hardening.md, section 7.3), or null for a
 * 404. A thumbnail row is served as itself. An original is served as itself, and with `?variant=thumb` as its
 * thumbnail when it has one. Once the collection's original files are deleted, an original is served only as its
 * thumbnail through `?variant=thumb`: an original-size view answers null, which `Artwork` draws as its pattern.
 */
export function servedKeyOf(input: {
  variant: 'original' | 'thumb'
  kind: UploadKind
  key: string
  thumbnailKey: string | null
  sourcesDeleted: boolean
}): string | null {
  if (input.kind === 'thumbnail') return input.key
  if (input.sourcesDeleted) return input.variant === 'thumb' ? input.thumbnailKey : null
  return input.variant === 'thumb' ? (input.thumbnailKey ?? input.key) : input.key
}

export function servedUrl(id: string, variant?: 'thumb'): string {
```

In `apps/web/src/app/api/uploads/[id]/route.ts`, replace:

```ts
import { presignGet } from '@/lib/storage/objects'
```

with:

```ts
import { presignGet } from '@/lib/storage/objects'
import { servedKeyOf } from '@/lib/storage/uploads-service'
```

In `apps/web/src/app/api/uploads/[id]/route.ts`, replace:

```ts
 * `?variant=thumb` it serves the browser-made thumbnail when there is one, else the original.
```

with:

```ts
 * `?variant=thumb` it serves the browser-made thumbnail when there is one, else the original. Once the
 * collection's original files are deleted, an original is served only as its thumbnail, and any other view
 * of it is a 404 (docs/specs/2026-10-17-production-hardening.md, section 7.3).
```

In `apps/web/src/app/api/uploads/[id]/route.ts`, replace:

```ts
    .select('id, collection_id, kind, storage_key, content_hash, mime')
```

with:

```ts
    .select('id, collection_id, kind, storage_key, content_hash, mime, collections(art_sources_deleted_at)')
```

In `apps/web/src/app/api/uploads/[id]/route.ts`, replace:

```ts
  let key = row.storage_key
  if (request.nextUrl.searchParams.get('variant') === 'thumb' && row.kind !== 'thumbnail') {
```

with:

```ts
  const variant = request.nextUrl.searchParams.get('variant') === 'thumb' ? 'thumb' : 'original'
  let thumbnailKey: string | null = null
  if (variant === 'thumb' && row.kind !== 'thumbnail') {
```

In `apps/web/src/app/api/uploads/[id]/route.ts`, replace:

```ts
    if (thumb) key = thumb.storage_key
  }
```

with:

```ts
    thumbnailKey = thumb?.storage_key ?? null
  }
  const key = servedKeyOf({
    variant,
    kind: row.kind,
    key: row.storage_key,
    thumbnailKey,
    sourcesDeleted: row.collections?.art_sources_deleted_at != null,
  })
  if (!key) return new NextResponse(null, { status: 404 })
```

In `apps/web/src/components/shell/art-live-notice.tsx`, replace:

```tsx
import { RadioIcon } from 'lucide-react'
```

with:

```tsx
import { ArchiveIcon, RadioIcon } from 'lucide-react'
```

In `apps/web/src/components/shell/art-live-notice.tsx`, replace:

```tsx
 * stepper. Renders nothing otherwise. Sample mode reads `?art=deferred&state=deployed`.
```

with:

```tsx
 * stepper. Above those of a deployed collection whose original files the source sweep deleted, the
 * line says so (docs/specs/2026-10-17-production-hardening.md, section 7.3). Renders nothing
 * otherwise. Sample mode reads `?art=deferred&state=deployed`, and `?sources=deleted` for the second.
```

In `apps/web/src/components/shell/art-live-notice.tsx`, replace:

```tsx
  artDeferred = false,
```

with:

```tsx
  artDeferred = false,
  sourcesDeleted,
```

In `apps/web/src/components/shell/art-live-notice.tsx`, replace:

```tsx
}) {
  const searchParams = useSearchParams()
```

with:

```tsx
  sourcesDeleted: boolean
}) {
  const searchParams = useSearchParams()
  if ((deployed && sourcesDeleted) || (demo && searchParams.get('sources') === 'deleted'))
    return (
      <p
        role="note"
        className="text-muted-foreground flex min-h-10 items-center gap-2 border-b px-6 py-2 text-[0.8125rem]"
      >
        <ArchiveIcon aria-hidden="true" className="text-faint size-4 shrink-0" />
        <span className="min-w-0">
          The original art files were deleted 90 days after the deploy. The rendered art and its metadata stay
          on IPFS.
        </span>
      </p>
    )
```

In `apps/web/src/app/collections/[id]/art/layout.tsx`, replace:

```tsx
 * drop is live and the art is revealed from Settings.
```

with:

```tsx
 * drop is live and the art is revealed from Settings, or that the original files were deleted
 * (sample mode: `?sources=deleted`).
```

In `apps/web/src/app/collections/[id]/art/layout.tsx`, replace:

```tsx
      artDeferred={artDeferred}
    />
```

with:

```tsx
      artDeferred={artDeferred}
      sourcesDeleted={collection.art_sources_deleted_at !== null}
    />
```

- [ ] **Step 6: Run the tests to see them pass, then typecheck and lint the web app**

Run: `pnpm --filter @cobweb/web exec vitest run src/lib/storage src/lib/render/vercel-config.test.ts`
Expected: PASS, `Test Files  9 passed (9)` and `Tests  43 passed (43)`.

Run: `pnpm --filter @cobweb/web typecheck && pnpm --filter @cobweb/web lint`
Expected: PASS.

- [ ] **Step 7: `verify:sources`**

It records the three collections' deploys on Base through `collection_record_deploy`, moves their times back with the service role and keeps the sweep's due list to its own collections (Decision 14).

Create `apps/web/scripts/verify-sources.ts`:

```ts
// Checks the layer sources' lifecycle against LOCAL Supabase and local storage (docs/specs/2026-10-17-production-
// hardening.md, section 10): a creator with three collections recorded as deployed through
// collection_record_deploy, as verify:local's section 9j records one, each with originals and thumbnails stored
// in the art bucket, their deploys and renders moved back with the service role; collections_sources_due, the
// sweep through the app's own port (its due list kept to this run's collections), a dry run, a sweep, a second
// run, a resumed run, the refusal and the guards. Nine PASS lines. Needs Supabase and its buckets, nothing else.
//
//   pnpm --filter @cobweb/web verify:sources
//
// Anything unset is discovered with `supabase status -o env`. Never prints a key. Runs under `node
// --conditions=react-server --import ./scripts/resolve-ts.mjs`.

import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { createSiweMessage, generateSiweNonce } from 'viem/siwe'
import type { Database } from '../src/lib/database.types.ts'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

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

// The storage module and the service client read these as they are called; set them first.
process.env.ART_S3_ENDPOINT = config('ART_S3_ENDPOINT', ['STORAGE_S3_URL'])
process.env.ART_S3_REGION = config('ART_S3_REGION', ['S3_PROTOCOL_REGION'], 'local')
process.env.ART_S3_BUCKET = config('ART_S3_BUCKET', [], 'art')
process.env.ART_S3_ACCESS_KEY_ID = config('ART_S3_ACCESS_KEY_ID', ['S3_PROTOCOL_ACCESS_KEY_ID'])
process.env.ART_S3_SECRET_ACCESS_KEY = config('ART_S3_SECRET_ACCESS_KEY', ['S3_PROTOCOL_ACCESS_KEY_SECRET'])
process.env.ART_S3_FORCE_PATH_STYLE = '1'
const url = config('NEXT_PUBLIC_SUPABASE_URL', ['API_URL'])
const publishableKey = config('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', ['PUBLISHABLE_KEY', 'ANON_KEY'])
const serviceKey = config('SUPABASE_SERVICE_ROLE_KEY', ['SERVICE_ROLE_KEY', 'SECRET_KEY'])
process.env.NEXT_PUBLIC_SUPABASE_URL = url
process.env.SUPABASE_SERVICE_ROLE_KEY = serviceKey
for (const endpoint of [url, process.env.ART_S3_ENDPOINT])
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(new URL(endpoint).hostname)) {
    console.error(`Refusing to run: ${new URL(endpoint).host} is not local.`)
    process.exit(2)
  }

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
type Client = SupabaseClient<Database>
const admin: Client = createClient<Database>(url, serviceKey, clientOptions)
const anon: Client = createClient<Database>(url, publishableKey, clientOptions)
const { deleteObjects, listObjectPages, presignPut } = await import('../src/lib/storage/objects.ts')
const { SOURCE_FOLDERS, sweepSources } = await import('../src/lib/storage/source-sweep.ts')
const { sourceSweepDeps } = await import('../src/lib/storage/source-sweep-deps.ts')
type SourceSweepDeps = import('../src/lib/storage/source-sweep.ts').SourceSweepDeps

let passed = 0
const failed: string[] = []
async function check(name: string, fn: () => Promise<string | null>): Promise<void> {
  let problem: string | null
  try {
    problem = await fn()
  } catch (e) {
    problem = `threw ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`
  }
  if (problem === null) {
    passed++
    console.log(`PASS ${name}`)
  } else {
    failed.push(name)
    console.log(`FAIL ${name}: ${problem}`)
  }
}

const NOT_DUE = "This collection's art files are not due for deletion."
const GUARD = "This collection's art files were deleted 90 days after its deploy, so its art cannot change."
const DAY_MS = 86_400_000
const run = randomBytes(3).toString('hex')
const HEX64 = () => randomBytes(32).toString('hex')
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS).toISOString()
// A 1 x 1 transparent PNG, stored as each original and, under a thumbnail's type, as each thumbnail.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)
const CID = (letter: string) => `bafybei${letter.repeat(52)}`

async function put(key: string, mime: string): Promise<void> {
  const response = await fetch(await presignPut(key, mime, PNG.byteLength), {
    method: 'PUT',
    body: new Uint8Array(PNG),
    headers: { 'Content-Type': mime },
  })
  if (!response.ok) throw new Error(`PUT ${key}: ${response.status}`)
}

/** Every key the art bucket holds under a prefix. */
async function keysUnder(prefix: string): Promise<string[]> {
  const keys: string[] = []
  for await (const page of listObjectPages(prefix)) keys.push(...page.map((entry) => entry.key))
  return keys
}

/** A collection's stored originals (its three source folders) and thumbnails, counted. */
async function stored(cid: string): Promise<{ originals: number; thumbnails: number }> {
  let originals = 0
  for (const folder of SOURCE_FOLDERS) originals += (await keysUnder(`${cid}/${folder}/`)).length
  return { originals, thumbnails: (await keysUnder(`${cid}/thumbnails/`)).length }
}

const markOf = async (cid: string) =>
  (await admin.from('collections').select('art_sources_deleted_at').eq('id', cid).single()).data
    ?.art_sources_deleted_at ?? null

type Fixture = { cid: string; originals: string[] }
type UploadKind = Database['public']['Enums']['upload_kind']
let userId: string | null = null
let creator: Client | null = null
const fixtures: Record<'A' | 'B' | 'C', Fixture | null> = { A: null, B: null, C: null }
const jobIds: string[] = []
const cids = () => Object.values(fixtures).flatMap((fixture) => (fixture ? [fixture.cid] : []))

async function signIn(): Promise<Client> {
  const account = privateKeyToAccount(generatePrivateKey())
  const client = createClient<Database>(url, publishableKey, clientOptions)
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
  const { data, error } = await client.auth.signInWithWeb3({
    chain: 'ethereum',
    message,
    signature: await account.signMessage({ message }),
  })
  if (error || !data.user) throw new Error(`sign-in: ${error?.message ?? 'no user'}`)
  userId = data.user.id
  creator = client
  return client
}

/** Fails with the step's words and the database's code and message. */
function must(step: string, error: { code?: string; message: string } | null): void {
  if (error) throw new Error(`${step}: ${error.code ?? '?'} ${error.message}`)
}

/**
 * A collection recorded as deployed on Base (a chain no local indexer serves), its two layer images, an asset and a
 * placeholder stored with a thumbnail each and recorded, rendered to done (a real job, or for a deferred one its
 * placeholder alone), then its deploy and its render moved back by the given days.
 */
async function deployedFixture(
  creator: Client,
  tag: 'A' | 'B' | 'C',
  options: { deferred: boolean; deployedDaysAgo: number; renderedDaysAgo: number },
): Promise<Fixture> {
  const made = await creator
    .from('collections')
    .insert({ name: `Sources ${run} ${tag}`, symbol: 'SRC', project_type: 'generative' })
    .select('id')
    .single()
  must(`${tag} collection`, made.error)
  const cid = made.data!.id
  fixtures[tag] = { cid, originals: [] }
  must(
    `${tag} supply`,
    (
      await creator
        .from('collections')
        .update({ max_supply: 3, art_deferred: options.deferred })
        .eq('id', cid)
    ).error,
  )
  must(
    `${tag} link`,
    (
      await creator.rpc('reserve_slug', {
        p_collection_id: cid,
        p_slug: `sources-${run}-${tag.toLowerCase()}`,
      })
    ).error,
  )
  const files: { kind: 'layer_image' | 'asset' | 'placeholder'; folder: string }[] = [
    { kind: 'layer_image', folder: 'layers' },
    { kind: 'layer_image', folder: 'layers' },
    { kind: 'asset', folder: 'assets' },
    { kind: 'placeholder', folder: 'placeholders' },
  ]
  let placeholderId: string | null = null
  for (const file of files) {
    const hash = createHash('sha256').update(`${cid}:${fixtures[tag].originals.length}`).digest('hex')
    const key = `${cid}/${file.folder}/${hash}.png`
    const thumbnail = `${cid}/thumbnails/${hash}.webp`
    await put(key, 'image/png')
    await put(thumbnail, 'image/webp')
    const rows = await admin
      .from('uploads')
      .insert([
        { ...uploadRow(cid, file.kind, key, hash, 'image/png'), file_name: `${file.folder}.png` },
        { ...uploadRow(cid, 'thumbnail', thumbnail, hash, 'image/webp'), file_name: `${file.folder}.webp` },
      ])
      .select('id, kind')
    must(`${tag} uploads`, rows.error)
    if (file.kind === 'placeholder') placeholderId = rows.data!.find((row) => row.kind === 'placeholder')!.id
    fixtures[tag].originals.push(key)
  }
  const job = await admin
    .from('render_jobs')
    .insert({
      collection_id: cid,
      kind: options.deferred ? 'placeholder' : 'real',
      state: 'done',
      token_count: 3,
      fee_per_token_wei: 0,
      quote_total_wei: 0,
      metadata_cid: CID('e'),
      base_uri: `ipfs://${CID('e')}/`,
      placeholder_upload_id: options.deferred ? placeholderId : null,
      finished_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  must(`${tag} render job`, job.error)
  jobIds.push(job.data!.id)
  if (!options.deferred)
    must(
      `${tag} lock`,
      (await admin.from('collections').update({ art_locked_at: new Date().toISOString() }).eq('id', cid))
        .error,
    )
  const n = parseInt(createHash('sha256').update(cid).digest('hex').slice(0, 8), 16)
  must(
    `${tag} deploy`,
    (
      await admin.rpc('collection_record_deploy', {
        p_collection_id: cid,
        p_owner: userId!,
        p_chain_id: 8453,
        p_factory: `0x${'5f'.repeat(20)}`,
        p_deployer: `0x${'de'.repeat(20)}`,
        p_salt: `0x${HEX64()}`,
        p_code_hash: `0x${HEX64()}`,
        p_args: { name: 'Sources', symbol: 'SRC', maxSupply: '3', groupSupplies: ['3'], groupPrices: ['0'] },
        p_contract_address: `0x${n.toString(16).padStart(40, '0')}`,
        p_tx_hash: `0x${HEX64()}`,
        p_base_uri: `ipfs://${CID('e')}/`,
        p_payout_address: `0x${'de'.repeat(20)}`,
        p_royalty_bps: 500,
        p_royalty_receiver: `0x${'de'.repeat(20)}`,
        p_public_max_per_wallet: 3,
        p_mint_fee_flat_wei: 0,
        p_mint_fee_bps: 0,
        p_airdrop_fee_per_token_wei: 0,
        p_groups: [{ name: 'Public', price_wei: '0', max_supply: 3 }],
      })
    ).error,
  )
  must(
    `${tag} deploy time`,
    (
      await admin
        .from('deployments')
        .update({ deployed_at: daysAgo(options.deployedDaysAgo) })
        .eq('collection_id', cid)
    ).error,
  )
  must(
    `${tag} render time`,
    (
      await admin
        .from('render_jobs')
        .update({ finished_at: daysAgo(options.renderedDaysAgo) })
        .eq('id', job.data!.id)
    ).error,
  )
  return fixtures[tag]
}

const uploadRow = (cid: string, kind: UploadKind, key: string, hash: string, mime: string) => ({
  collection_id: cid,
  kind,
  storage_key: key,
  content_hash: hash,
  mime,
  media_type: 'image' as const,
  bytes: PNG.byteLength,
  width: 1,
  height: 1,
})

/** The app's own port, its due list kept to this run's collections, so no other collection is ever swept. */
function runDeps(): SourceSweepDeps {
  const port = sourceSweepDeps()
  return {
    ...port,
    due: async (limit) =>
      (await port.due(1000)).filter((entry) => cids().includes(entry.collectionId)).slice(0, limit),
  }
}

async function main(): Promise<void> {
  await check(
    'setup: a creator with three collections recorded as deployed, each with recorded originals and thumbnails in the art bucket: A deployed and finally rendered 91 days ago, B deployed 91 days ago and rendered 10 days ago, C deployed 91 days ago with only its placeholder rendered',
    async () => {
      const creator = await signIn()
      await deployedFixture(creator, 'A', { deferred: false, deployedDaysAgo: 91, renderedDaysAgo: 91 })
      await deployedFixture(creator, 'B', { deferred: false, deployedDaysAgo: 91, renderedDaysAgo: 10 })
      await deployedFixture(creator, 'C', { deferred: true, deployedDaysAgo: 91, renderedDaysAgo: 91 })
      for (const fixture of Object.values(fixtures)) {
        const { originals, thumbnails } = await stored(fixture!.cid)
        if (originals !== 4 || thumbnails !== 4)
          return `${fixture!.cid} stores ${originals} and ${thumbnails}`
      }
      const deployed = await admin.from('collections').select('status').in('id', cids())
      return deployed.data?.every((row) => row.status === 'deployed')
        ? null
        : 'not every collection is deployed'
    },
  )
  const { A, B, C } = fixtures as Record<'A' | 'B' | 'C', Fixture>
  const owner = creator!

  await check(
    "due: collections_sources_due lists A alone with its originals' count and size; neither a signed-out caller nor the creator can call it or collection_sources_deleted",
    async () => {
      const due = await admin.rpc('collections_sources_due', { p_limit: 1000 })
      must('due', due.error)
      const listed = (due.data as { collectionId: string; objects: number; bytes: number }[]).filter(
        (entry) => cids().includes(entry.collectionId),
      )
      const [only] = listed
      if (listed.length !== 1 || only!.collectionId !== A.cid || only!.objects !== 4)
        return `listed ${JSON.stringify(listed)}`
      if (only!.bytes !== 4 * PNG.byteLength) return `A's size ${only!.bytes}`
      for (const [who, client] of [
        ['signed out', anon],
        ['creator', owner],
      ] as const) {
        const calls = [
          await client.rpc('collections_sources_due', { p_limit: 5 }),
          await client.rpc('collection_sources_deleted', { p_collection_id: A.cid }),
        ]
        for (const call of calls)
          if (call.error?.code !== '42501')
            return `${who}: ${call.error?.code ?? 'answered'} ${call.error?.message ?? ''}`
      }
      return (await markOf(A.cid)) === null ? null : 'a refused call marked A'
    },
  )

  await check("dry run: the sweep reports A's originals and deletes nothing", async () => {
    const lines: string[] = []
    const report = await sweepSources(runDeps(), { dryRun: true, log: (line) => lines.push(line) })
    if (
      JSON.stringify(report) !== JSON.stringify({ dryRun: true, due: 1, deleted: 0, marked: 0, failed: [] })
    )
      return `report ${JSON.stringify(report)}`
    if (!lines[0]?.startsWith(`Source sweep (dry run): ${A.cid} has 4 original files`))
      return `logged ${lines[0]}`
    const left = await stored(A.cid)
    return left.originals === 4 && (await markOf(A.cid)) === null ? null : `stored ${JSON.stringify(left)}`
  })

  await check(
    "sweep: A's layers, assets and placeholders are deleted, its thumbnails stay, it is marked, and B's and C's objects are untouched",
    async () => {
      const report = await sweepSources(runDeps(), { dryRun: false, log: () => {} })
      if (
        JSON.stringify(report) !==
        JSON.stringify({ dryRun: false, due: 1, deleted: 4, marked: 1, failed: [] })
      )
        return `report ${JSON.stringify(report)}`
      const a = await stored(A.cid)
      if (a.originals !== 0 || a.thumbnails !== 4) return `A stores ${JSON.stringify(a)}`
      if ((await markOf(A.cid)) === null) return 'A is not marked'
      for (const other of [B, C]) {
        const left = await stored(other.cid)
        if (left.originals !== 4 || left.thumbnails !== 4)
          return `${other.cid} stores ${JSON.stringify(left)}`
        if ((await markOf(other.cid)) !== null) return `${other.cid} is marked`
      }
      const rows = await admin
        .from('uploads')
        .select('id', { count: 'exact', head: true })
        .eq('collection_id', A.cid)
      return rows.count === 8 ? null : `A has ${rows.count} upload rows`
    },
  )

  await check('again: a second run finds nothing due and deletes nothing', async () => {
    const report = await sweepSources(runDeps(), { dryRun: false, log: () => {} })
    return JSON.stringify(report) ===
      JSON.stringify({ dryRun: false, due: 0, deleted: 0, marked: 0, failed: [] })
      ? null
      : `report ${JSON.stringify(report)}`
  })

  await check(
    "resume: with A's mark cleared and one original put back, a run deletes it and marks A again",
    async () => {
      must(
        'clear',
        (await admin.from('collections').update({ art_sources_deleted_at: null }).eq('id', A.cid)).error,
      )
      await put(A.originals[0]!, 'image/png')
      const report = await sweepSources(runDeps(), { dryRun: false, log: () => {} })
      if (
        JSON.stringify(report) !==
        JSON.stringify({ dryRun: false, due: 1, deleted: 1, marked: 1, failed: [] })
      )
        return `report ${JSON.stringify(report)}`
      return (await stored(A.cid)).originals === 0 && (await markOf(A.cid)) !== null
        ? null
        : 'A was not swept again'
    },
  )

  await check('not due: collection_sources_deleted on B is refused with its sentence', async () => {
    const { error } = await admin.rpc('collection_sources_deleted', { p_collection_id: B.cid })
    if (error?.code !== '23514' || error.message !== NOT_DUE)
      return `${error?.code ?? 'answered'} ${error?.message ?? ''}`
    return (await markOf(B.cid)) === null ? null : 'B was marked'
  })

  await check(
    "guards: a new uploads row and a new render job for A are refused with the guard's sentence",
    async () => {
      const hash = HEX64()
      const upload = await admin
        .from('uploads')
        .insert({
          ...uploadRow(A.cid, 'layer_image', `${A.cid}/layers/${hash}.png`, hash, 'image/png'),
          file_name: 'late.png',
        })
        .select('id')
      const job = await admin
        .from('render_jobs')
        .insert({
          collection_id: A.cid,
          kind: 'real',
          token_count: 1,
          fee_per_token_wei: 0,
          quote_total_wei: 0,
        })
        .select('id')
      for (const row of job.data ?? []) jobIds.push(row.id)
      for (const [what, error] of [
        ['upload', upload.error],
        ['render job', job.error],
      ] as const)
        if (error?.code !== '23514' || error.message !== GUARD)
          return `${what}: ${error?.code ?? 'written'} ${error?.message ?? ''}`
      return null
    },
  )
}

async function cleanup(): Promise<void> {
  await check('cleanup: the run leaves no object, row or user', async () => {
    const problems: string[] = []
    for (const cid of cids()) {
      const keys = await keysUnder(`${cid}/`)
      if (keys.length) await deleteObjects(keys)
    }
    if (jobIds.length) {
      const { error } = await admin.from('render_jobs').delete().in('id', jobIds)
      if (error) problems.push(`jobs: ${error.message}`)
    }
    if (cids().length) {
      const { error } = await admin.from('collections').delete().in('id', cids())
      if (error) problems.push(`collections: ${error.message}`)
    }
    if (userId) {
      const { error } = await admin.auth.admin.deleteUser(userId)
      if (error) problems.push(`user: ${error.message}`)
    }
    for (const cid of cids()) {
      if ((await keysUnder(`${cid}/`)).length) problems.push(`${cid} still stores objects`)
      const rows = (table: 'deployments' | 'uploads' | 'render_jobs' | 'mint_groups') =>
        admin.from(table).select('*', { count: 'exact', head: true }).eq('collection_id', cid)
      const left = await Promise.all([
        admin.from('collections').select('*', { count: 'exact', head: true }).eq('id', cid),
        rows('deployments'),
        rows('uploads'),
        rows('render_jobs'),
        rows('mint_groups'),
      ])
      const total = left.reduce((sum, { count }) => sum + (count ?? 0), 0)
      if (total) problems.push(`${total} row(s) of ${cid} left`)
    }
    if (userId && (await admin.auth.admin.getUserById(userId)).data.user) problems.push('the user is left')
    return problems.length ? problems.join('; ') : null
  })
}

try {
  await main()
} catch (e) {
  failed.push('run')
  console.log(`FAIL run: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`)
} finally {
  await cleanup()
}

console.log(`\n${passed} passed, ${failed.length} failed`)
process.exit(failed.length ? 1 : 0)
```

In `apps/web/package.json`, replace:

```json
    "verify:csp": "node --conditions=react-server --import ./scripts/resolve-ts.mjs scripts/verify-csp.ts"
```

with:

```json
    "verify:csp": "node --conditions=react-server --import ./scripts/resolve-ts.mjs scripts/verify-csp.ts",
    "verify:sources": "node --conditions=react-server --import ./scripts/resolve-ts.mjs scripts/verify-sources.ts"
```

Run: `pnpm --filter @cobweb/web verify:sources`
Expected: PASS, `9 passed, 0 failed`.

- [ ] **Step 8: Format, run the root checks and commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
pnpm exec prettier --write apps/web/src/lib/storage/source-sweep.ts apps/web/src/lib/storage/source-sweep.test.ts apps/web/src/lib/storage/source-sweep-deps.ts apps/web/src/lib/storage/source-sweep-route.test.ts apps/web/src/app/api/cron/source-sweep/route.ts apps/web/src/lib/storage/uploads-service.ts apps/web/src/lib/storage/uploads-service.test.ts 'apps/web/src/app/api/uploads/[id]/route.ts' apps/web/src/components/shell/art-live-notice.tsx 'apps/web/src/app/collections/[id]/art/layout.tsx' apps/web/src/lib/supabase/service.ts apps/web/vercel.json apps/web/src/lib/render/vercel-config.test.ts apps/web/scripts/verify-sources.ts apps/web/package.json
pnpm typecheck && pnpm lint && pnpm test
git add apps/web/src/lib/storage apps/web/src/app/api/cron/source-sweep 'apps/web/src/app/api/uploads/[id]/route.ts' apps/web/src/components/shell/art-live-notice.tsx 'apps/web/src/app/collections/[id]/art/layout.tsx' apps/web/src/lib/supabase/service.ts apps/web/vercel.json apps/web/src/lib/render/vercel-config.test.ts apps/web/scripts/verify-sources.ts apps/web/package.json
git commit -m "$(cat <<'EOF'
Add the daily source sweep that deletes a collection's original art files 90 days after its deploy and final render, serve thumbnails once they are gone, say so above Art, and add verify:sources

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: web 972 tests in 103 files; the other packages unchanged.

---

### Task 7: The indexer as `cobweb_indexer` over postgres.js, with verified TLS off this machine

**Kind:** integration: a database driver in place of the service role key, its TLS and a verify against the local database through the new role: an Opus implementer.

**Files:**

- Modify: `apps/freshness/package.json` (`postgres` in place of `@supabase/supabase-js`), `pnpm-lock.yaml` (by `pnpm install --offline`), `apps/freshness/src/config.ts`, `apps/freshness/src/indexer-db.ts` (whole), `apps/freshness/src/server.ts`, `apps/freshness/src/index.ts`, `apps/web/scripts/verify-indexer.ts`, and the tests `apps/freshness/src/config.test.ts`, `indexer-db.test.ts` (whole), `server.test.ts`
- Test: the three test files; `pnpm --filter @cobweb/web verify:indexer`

**Interfaces:**

- Consumes: the role `cobweb_indexer` and its execute grants on the four indexer functions (Task 1); `chainIndexer` and `IndexerDb` (unchanged: `targets`, `start`, `record`, `summaries`); `IndexerWriteError`, `DB_TIMEOUT_MS` and the gap sentences of the current `indexer-db.ts`; viem's `BaseError`; in the verify, `refuseRemote` from `deploy-fixture.ts` and `config` from `render-deps.ts`.
- Produces:
  - `config.ts`: `INDEXER_ROLE = 'cobweb_indexer'`, `IndexerOptions = { databaseUrl: string; sslCaFile?: string; passMs?; targetsEveryMs? }`, `isLoopbackHost(hostname)`, `indexerOptionsOf(env)` reading `INDEXER_DATABASE_URL` and `INDEXER_DATABASE_SSL_CA`, `checkIndexerOptions(options)` refusing, as a `ConfigurationError` whose sentence names `INDEXER_DATABASE_URL` and never its value, a string that is not `postgres://` or `postgresql://`, one with no password, one whose user is neither `cobweb_indexer` nor the pooler's `cobweb_indexer.<ref>`, and one asking for unverified TLS to another machine (`sslmode` or `ssl` other than `verify-ca` or `verify-full`; Decision 15); `unreadIndexerVariables(env)`
  - `indexer-db.ts`: `IndexerFunction`, `IndexerCall`, `indexerDbOf(call)`, `INDEXER_PARAMETERS`, `IndexerSql`, `IndexerTls = { rejectUnauthorized: true; ca?: string } | undefined`, `indexerConnectionOf(options, readCa?): { databaseUrl; ssl: IndexerTls }`, `postgresIndexerDb(options, open?): IndexerDb & { end(): Promise<void> }` (Decision 16)
  - `startFreshness` checking the options before it listens, ending the connections on close and on a failed listen, and its start line "The indexer runs on ... as cobweb_indexer." or "The indexer is off: set INDEXER_DATABASE_URL to run it."; `index.ts` naming `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as no longer read where still set
  - `verify:indexer` through the role: a local `INDEXER_DATABASE_URL` when set, else a password set on the role for the run and cleared in its cleanup (Decision 17)

- [ ] **Step 1: Write the failing tests**

The connection's tests pin Review Focus 2: a database on another machine is verified whatever its string names, and a string asking for less is refused at start. The port's tests run on a fake `IndexerSql`, so no database is needed.

In `apps/freshness/src/config.test.ts`, replace:

```ts
import { checkIndexerOptions, DEFAULT_PORT, indexerOptionsOf, portOf, servedChains } from './config.ts'
```

with:

```ts
import {
  checkIndexerOptions,
  DEFAULT_PORT,
  indexerOptionsOf,
  portOf,
  servedChains,
  unreadIndexerVariables,
} from './config.ts'
```

In `apps/freshness/src/config.test.ts`, replace:

```ts
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

  it('refuses a SUPABASE_URL that is not an http or https URL, naming the variable, never the value', () => {
    for (const supabaseUrl of [
      'localhost:54321',
      'ftp://127.0.0.1:54321',
      // The URL parser reads it as http://127.0.0.1:54321/, but supabase-js refuses it without the slashes.
      'http:127.0.0.1:54321',
      'http://',
      'not a url',
    ]) {
      const env = { SUPABASE_URL: supabaseUrl, SUPABASE_SERVICE_ROLE_KEY: KEY }
      expect(errorLine(thrownBy(() => indexerOptionsOf(env)))).toBe(
        'ConfigurationError: SUPABASE_URL must be an http or https URL.',
      )
    }
    // A hosted project's URL, its scheme in any case.
    const hosted = 'HTTPS://abcdefghijklmnopqrst.supabase.co'
    expect(indexerOptionsOf({ SUPABASE_URL: hosted, SUPABASE_SERVICE_ROLE_KEY: KEY })).toEqual({
      supabaseUrl: hosted,
      serviceRoleKey: KEY,
    })
  })

  it('refuses a SUPABASE_URL with a path, which a project URL never has, naming the variable, never the value', () => {
    for (const supabaseUrl of [
      'https://abcdefghijklmnopqrst.supabase.co/rest/v1',
      'http://127.0.0.1:54321/secret-path',
      'http://127.0.0.1:54321//',
    ]) {
      const line = errorLine(
        thrownBy(() => indexerOptionsOf({ SUPABASE_URL: supabaseUrl, SUPABASE_SERVICE_ROLE_KEY: KEY })),
      )
      expect(line).toBe("ConfigurationError: SUPABASE_URL must be the project's URL, with no path.")
      expect(line).not.toContain('secret-path')
    }
    // The root path, written or not, is the project URL.
    for (const supabaseUrl of ['http://127.0.0.1:54321/', 'https://abcdefghijklmnopqrst.supabase.co'])
      expect(indexerOptionsOf({ SUPABASE_URL: supabaseUrl, SUPABASE_SERVICE_ROLE_KEY: KEY })).toEqual({
        supabaseUrl,
        serviceRoleKey: KEY,
      })
  })

  it("checks a caller's options by the same rules, the passes' pace kept", () => {
    const options = { supabaseUrl: URL, serviceRoleKey: KEY, targetsEveryMs: 1_000 }
    expect(checkIndexerOptions(options)).toBe(options)
    for (const [refused, sentence] of [
      [{ supabaseUrl: '', serviceRoleKey: '' }, 'are both needed'],
      [{ supabaseUrl: URL, serviceRoleKey: '' }, 'are both needed'],
      [{ supabaseUrl: 'not a url', serviceRoleKey: KEY }, 'must be an http or https URL'],
      [{ supabaseUrl: `${URL}/rest/v1`, serviceRoleKey: KEY }, 'with no path'],
    ] as const)
      expect(errorLine(thrownBy(() => checkIndexerOptions(refused)))).toContain(sentence)
  })
})
```

with:

```ts
describe('indexerOptionsOf (docs/specs/2026-10-17-production-hardening.md, section 8.1)', () => {
  const PASSWORD = 's3cret-Pa55word'
  const LOCAL = `postgresql://cobweb_indexer:${PASSWORD}@127.0.0.1:55322/postgres`
  const POOLER = `postgres://cobweb_indexer.abcdefghijklmnopqrst:${PASSWORD}@aws-0-us-east-1.pooler.supabase.com:5432/postgres`

  it('answers the options from a local URL or the session pooler, and null when unset or blank', () => {
    expect(indexerOptionsOf({ INDEXER_DATABASE_URL: LOCAL })).toEqual({ databaseUrl: LOCAL })
    expect(indexerOptionsOf({ INDEXER_DATABASE_URL: ` ${POOLER} ` })).toEqual({ databaseUrl: POOLER })
    expect(indexerOptionsOf({})).toBeNull()
    expect(indexerOptionsOf({ INDEXER_DATABASE_URL: '  ' })).toBeNull()
    // The old variables alone leave the indexer off.
    expect(
      indexerOptionsOf({ SUPABASE_URL: 'http://127.0.0.1:55321', SUPABASE_SERVICE_ROLE_KEY: 'key' }),
    ).toBeNull()
  })

  it('refuses each malformed URL with a sentence that carries no part of it', () => {
    const cases: [string, string][] = [
      ['https://127.0.0.1:55321', 'must be a postgres:// or postgresql:// connection string'],
      ['not a url', 'must be a postgres:// or postgresql:// connection string'],
      [
        `mysql://cobweb_indexer:${PASSWORD}@db.example:3306/postgres`,
        'must be a postgres:// or postgresql://',
      ],
      ['postgresql://cobweb_indexer@127.0.0.1:55322/postgres', 'has no password'],
      [
        `postgresql://postgres:${PASSWORD}@127.0.0.1:55322/postgres`,
        'must connect as the cobweb_indexer role',
      ],
      [
        `postgresql://service_role:${PASSWORD}@db.example:5432/postgres`,
        'must connect as the cobweb_indexer role',
      ],
      [
        `postgresql://cobweb_indexer_x:${PASSWORD}@db.example:5432/postgres`,
        'must connect as the cobweb_indexer role',
      ],
      [
        `postgresql://%E0%A4%A:${PASSWORD}@db.example:5432/postgres`,
        'must connect as the cobweb_indexer role',
      ],
    ]
    for (const [value, sentence] of cases) {
      const line = errorLine(thrownBy(() => indexerOptionsOf({ INDEXER_DATABASE_URL: value })))
      expect(line).toContain(`ConfigurationError: INDEXER_DATABASE_URL ${sentence}`)
      for (const part of [PASSWORD, '127.0.0.1', 'db.example', '55322', 'service_role', 'mysql', '%E0'])
        expect(line).not.toContain(part)
    }
  })

  it('refuses a connection string that asks for unverified TLS to another machine, and lets this machine use plain TCP', () => {
    for (const mode of ['verify-ca', 'verify-full'])
      expect(indexerOptionsOf({ INDEXER_DATABASE_URL: `${POOLER}?sslmode=${mode}` })).toEqual({
        databaseUrl: `${POOLER}?sslmode=${mode}`,
      })
    for (const weak of [
      'sslmode=require',
      'sslmode=prefer',
      'sslmode=allow',
      'sslmode=disable',
      'ssl=false',
    ]) {
      const line = errorLine(thrownBy(() => indexerOptionsOf({ INDEXER_DATABASE_URL: `${POOLER}?${weak}` })))
      expect(line).toBe(
        'ConfigurationError: INDEXER_DATABASE_URL must verify TLS for a database on another machine: leave sslmode out, or set it to verify-full.',
      )
      expect(line).not.toContain(PASSWORD)
    }
    expect(indexerOptionsOf({ INDEXER_DATABASE_URL: `${LOCAL}?sslmode=disable` })).toEqual({
      databaseUrl: `${LOCAL}?sslmode=disable`,
    })
  })

  it("takes the path of the database's CA certificate from INDEXER_DATABASE_SSL_CA when it is set", () => {
    const path = '/app/certs/supabase-ca.crt'
    expect(indexerOptionsOf({ INDEXER_DATABASE_URL: POOLER, INDEXER_DATABASE_SSL_CA: ` ${path} ` })).toEqual({
      databaseUrl: POOLER,
      sslCaFile: path,
    })
    expect(indexerOptionsOf({ INDEXER_DATABASE_URL: POOLER, INDEXER_DATABASE_SSL_CA: ' ' })).toEqual({
      databaseUrl: POOLER,
    })
  })

  it("checks a caller's options by the same rules, the passes' pace kept", () => {
    const options = { databaseUrl: LOCAL, targetsEveryMs: 1_000 }
    expect(checkIndexerOptions(options)).toBe(options)
    expect(errorLine(thrownBy(() => checkIndexerOptions({ databaseUrl: '' })))).toContain(
      'must be a postgres://',
    )
  })
})

describe('unreadIndexerVariables', () => {
  it('names the two old variables where they are still set', () => {
    expect(unreadIndexerVariables({ SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'key' })).toEqual([
      'SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
    ])
    expect(unreadIndexerVariables({ SUPABASE_SERVICE_ROLE_KEY: 'key', SUPABASE_URL: ' ' })).toEqual([
      'SUPABASE_SERVICE_ROLE_KEY',
    ])
    expect(unreadIndexerVariables({ INDEXER_DATABASE_URL: 'postgres://x' })).toEqual([])
  })
})
```

Replace the whole of `apps/freshness/src/indexer-db.test.ts` with:

```ts
import type { Address, Hex } from 'viem'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { errorLine, failureLine } from './health.ts'
import {
  DB_TIMEOUT_MS,
  indexerConnectionOf,
  indexerDbOf,
  IndexerWriteError,
  postgresIndexerDb,
  type IndexerCall,
  type IndexerSql,
  type IndexerTls,
  type RecordWrite,
} from './indexer-db.ts'

const ID = '0a977c0b-7e53-476b-8c08-6c685315c3af'
const CONTRACT: Address = '0x0409454c375c8a6ab05383bfb6d9fcde9ebb8f85'
const MINTER: Address = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8'
const DEPLOY: Hex = `0x${'da'.repeat(32)}`
const MINT_TX: Hex = `0x${'0b'.repeat(32)}`
const URL_WITH_SECRET = 'postgresql://cobweb_indexer:s3cret@db.example:5432/postgres'

const WRITE: RecordWrite = {
  chainId: 31337,
  fromBlock: 91n,
  toBlock: 100n,
  syncedAt: 1_800_000_100,
  collections: [ID],
  records: { mints: [], owners: [], airdrops: [], withdrawals: [] },
}

/** A call answering each call with the next answer, recording each function and its arguments. */
function fakeCall(...answers: unknown[]) {
  const sent: { fn: string; args: readonly unknown[] }[] = []
  const call: IndexerCall = async (fn, args) => {
    sent.push({ fn, args })
    return answers.shift() ?? null
  }
  return { sent, db: indexerDbOf(call) }
}

/**
 * A postgres.js client answering each query with the next answer: a value as the row's `answer`, an error to
 * throw, or `hang`, which never answers. It records each query and its parameters, the cancellations and the end.
 */
function fakeSql(...answers: unknown[]) {
  const sent: { query: string; parameters: unknown[] }[] = []
  const state = {
    cancelled: 0,
    ended: null as { timeout: number } | null,
    opened: '',
    ssl: null as IndexerTls | null,
  }
  const sql: IndexerSql = {
    unsafe(query, parameters) {
      sent.push({ query, parameters })
      const answer = answers.shift()
      const settled =
        answer === 'hang'
          ? new Promise<never>(() => {})
          : answer instanceof Error
            ? Promise.reject(answer)
            : Promise.resolve([{ answer }])
      return Object.assign(settled, { cancel: () => state.cancelled++ })
    },
    async end(options) {
      state.ended = options
    },
  }
  const db = postgresIndexerDb({ databaseUrl: URL_WITH_SECRET }, (url, ssl) => {
    state.opened = url
    state.ssl = ssl
    return sql
  })
  return { sent, state, db }
}

/** A Postgres refusal as postgres.js throws it. */
const pgError = (code: string, message: string) =>
  Object.assign(new Error(message), { name: 'PostgresError', code })

/** What a promise settles to: its value, or the error it rejected with. */
const settled = <T>(promise: Promise<T>) =>
  promise.then(
    (value) => value,
    (error: unknown) => error,
  )

const codeOf = (error: unknown) => error instanceof IndexerWriteError && [error.code, error.gap]

describe('indexerDbOf (docs/specs/2026-10-17-production-hardening.md, section 8.1)', () => {
  it('reads the targets with blocks as bigints, null without a cursor', async () => {
    const target = { collectionId: ID, contract: CONTRACT, deployTx: DEPLOY, syncedAt: null }
    const { sent, db } = fakeCall([
      { ...target, fromBlock: null, indexedBlock: null },
      { ...target, fromBlock: 50, indexedBlock: 120, syncedAt: 1_800_000_120 },
    ])
    expect(await db.targets(31337)).toEqual([
      { ...target, fromBlock: null, indexedBlock: null },
      { ...target, fromBlock: 50n, indexedBlock: 120n, syncedAt: 1_800_000_120 },
    ])
    expect(sent).toEqual([{ fn: 'indexer_targets', args: [31337] }])
  })

  it('writes a segment with its blocks as numbers and its sync time as ISO, and answers whole summaries', async () => {
    const summary = { collectionId: ID, contract: CONTRACT, holders: 2, syncedAt: 1_800_000_100 }
    const mint = {
      tx: MINT_TX,
      recipient: MINTER,
      groupId: 1,
      amount: 2,
      firstTokenId: 5,
      blockTime: 1_800_000_090,
    }
    const { sent, db } = fakeCall({ [ID]: { ...summary, recentMints: [mint] } }, {})
    expect(await db.record(WRITE)).toEqual([
      {
        ...summary,
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
      args: [31337, 91, 100, new Date(1_800_000_100_000).toISOString(), [ID], WRITE.records],
    })
    // A write that leaves the cursor unsynced sends no time, and a write naming no collection answers none.
    expect(await db.record({ ...WRITE, syncedAt: null })).toEqual([])
    expect(sent[1]?.args[3]).toBeNull()
  })

  it('starts a cursor at its block, and loads the summaries', async () => {
    const { sent, db } = fakeCall({ collectionId: ID }, [])
    await db.start(ID, 50n)
    expect(await db.summaries(31337)).toEqual([])
    expect(sent).toEqual([
      { fn: 'indexer_start', args: [ID, 50] },
      { fn: 'indexer_summaries', args: [31337] },
    ])
  })

  it('fails each function that answers nothing as NO_ANSWER', async () => {
    const { db } = fakeCall()
    const errors = [
      await settled(db.targets(31337)),
      await settled(db.start(ID, 50n)),
      await settled(db.record(WRITE)),
      await settled(db.summaries(31337)),
    ]
    expect(errors.map((error) => error instanceof IndexerWriteError && error.message)).toEqual([
      "The indexer's indexer_targets call failed (NO_ANSWER).",
      "The indexer's indexer_start call failed (NO_ANSWER).",
      "The indexer's indexer_record call failed (NO_ANSWER).",
      "The indexer's indexer_summaries call failed (NO_ANSWER).",
    ])
  })
})

describe("indexerConnectionOf: the connection's TLS", () => {
  const LOCAL = 'postgresql://cobweb_indexer:pw@127.0.0.1:55322/postgres'
  const HOSTED =
    'postgres://cobweb_indexer.abcdefghijklmnopqrst:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres'
  const PEM = '-----BEGIN CERTIFICATE-----\nMIIBkTCB+wIJAN\n-----END CERTIFICATE-----'
  /** A file reader that records each path and answers the PEM. */
  const reader = (read: string[]) => (path: string) => {
    read.push(path)
    return PEM
  }

  it('lets a database on this machine use plain TCP, as the local stack does', () => {
    expect(indexerConnectionOf({ databaseUrl: LOCAL })).toEqual({ databaseUrl: LOCAL, ssl: undefined })
    const named = 'postgresql://cobweb_indexer:pw@localhost:55322/postgres'
    expect(indexerConnectionOf({ databaseUrl: named })).toEqual({ databaseUrl: named, ssl: undefined })
  })

  it('verifies the certificate and the host of a database on another machine, whatever its string names', () => {
    expect(indexerConnectionOf({ databaseUrl: HOSTED })).toEqual({
      databaseUrl: HOSTED,
      ssl: { rejectUnauthorized: true },
    })
    const verified = `${HOSTED}?sslmode=verify-full`
    expect(indexerConnectionOf({ databaseUrl: verified }).ssl).toEqual({ rejectUnauthorized: true })
    expect(indexerConnectionOf({ databaseUrl: `${HOSTED}?sslrootcert=system` })).toEqual({
      databaseUrl: HOSTED,
      ssl: { rejectUnauthorized: true },
    })
  })

  it('trusts the CA the file INDEXER_DATABASE_SSL_CA names, or else the one sslrootcert names, dropping that parameter', () => {
    const read: string[] = []
    expect(
      indexerConnectionOf({ databaseUrl: HOSTED, sslCaFile: '/app/certs/ca.crt' }, reader(read)),
    ).toEqual({
      databaseUrl: HOSTED,
      ssl: { rejectUnauthorized: true, ca: PEM },
    })
    const fromString = indexerConnectionOf(
      { databaseUrl: `${HOSTED}?sslrootcert=/etc/ssl/supabase.crt&sslmode=verify-full` },
      reader(read),
    )
    expect(fromString).toEqual({
      databaseUrl: `${HOSTED}?sslmode=verify-full`,
      ssl: { rejectUnauthorized: true, ca: PEM },
    })
    expect(read).toEqual(['/app/certs/ca.crt', '/etc/ssl/supabase.crt'])
  })

  it('refuses a CA file that cannot be read, naming the variable, never the path', () => {
    const missing = () => {
      throw new Error('ENOENT: no such file or directory, open /secret/ca.crt')
    }
    const refusals: unknown[] = []
    for (const options of [
      { databaseUrl: HOSTED, sslCaFile: '/secret/ca.crt' },
      { databaseUrl: `${HOSTED}?sslrootcert=/secret/ca.crt` },
    ])
      try {
        indexerConnectionOf(options, missing)
      } catch (error) {
        refusals.push(error)
      }
    expect(refusals.map(errorLine)).toEqual([
      'ConfigurationError: INDEXER_DATABASE_SSL_CA names a CA certificate file that cannot be read.',
      'ConfigurationError: INDEXER_DATABASE_URL names a CA certificate file that cannot be read.',
    ])
  })
})

describe('postgresIndexerDb', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('opens its connection string and calls each function with its arguments and casts', async () => {
    const { sent, state, db } = fakeSql([], {}, {}, [])
    await db.targets(31337)
    await db.start(ID, 50n)
    await db.record(WRITE)
    await db.summaries(31337)
    expect([state.opened, state.ssl]).toEqual([URL_WITH_SECRET, { rejectUnauthorized: true }])
    expect(sent).toEqual([
      { query: 'select public.indexer_targets($1::integer) as answer', parameters: [31337] },
      { query: 'select public.indexer_start($1::uuid, $2::bigint) as answer', parameters: [ID, 50] },
      {
        query:
          'select public.indexer_record($1::integer, $2::bigint, $3::bigint, $4::timestamptz, $5::uuid[], $6::jsonb) as answer',
        parameters: [31337, 91, 100, new Date(1_800_000_100_000).toISOString(), [ID], WRITE.records],
      },
      { query: 'select public.indexer_summaries($1::integer) as answer', parameters: [31337] },
    ])
  })

  it("names a refusal by its function and Postgres code, a gap for a skip and an unindexed collection, never the database's message", async () => {
    const { db } = fakeSql(
      pgError('23514', 'The indexer would skip blocks.'),
      pgError('23514', 'A collection is not indexed on this chain.'),
      pgError('23514', 'A record names a collection outside this write.'),
      pgError('42501', 'permission denied for function indexer_targets'),
      pgError('42883', 'function public.indexer_summaries(integer) does not exist'),
      pgError('28P01', 'password authentication failed for user "cobweb_indexer"'),
    )
    const errors = [
      await settled(db.record(WRITE)),
      await settled(db.record(WRITE)),
      await settled(db.record(WRITE)),
      await settled(db.targets(31337)),
      await settled(db.summaries(31337)),
      await settled(db.summaries(31337)),
    ]
    expect(errors.map(codeOf)).toEqual([
      ['23514', true],
      ['23514', true],
      ['23514', false],
      ['42501', false],
      ['42883', false],
      ['28P01', false],
    ])
    expect((errors[0] as Error).message).toBe("The indexer's indexer_record call failed (23514).")
    expect(errors.map((error) => failureLine(error))).toEqual([
      'IndexerWriteError (23514)',
      'IndexerWriteError (23514)',
      'IndexerWriteError (23514)',
      'IndexerWriteError (42501)',
      'IndexerWriteError (42883)',
      'IndexerWriteError (28P01)',
    ])
  })

  it('names a call no database answered NETWORK, whatever its error carries', async () => {
    const refused = Object.assign(new Error(`connect ECONNREFUSED to ${URL_WITH_SECRET}`), {
      code: 'ECONNREFUSED',
    })
    const closed = Object.assign(new Error('write CONNECTION_CLOSED db.example:5432'), {
      code: 'CONNECTION_CLOSED',
    })
    const { db } = fakeSql(refused, closed)
    const errors = [await settled(db.summaries(31337)), await settled(db.targets(31337))]
    expect(errors.map(codeOf)).toEqual([
      ['NETWORK', false],
      ['NETWORK', false],
    ])
    expect(errors.map((error) => failureLine(error)).join(' ')).not.toContain('s3cret')
  })

  it('abandons and cancels a call that has not answered after 10 s, so it cannot hold a pass', async () => {
    vi.useFakeTimers()
    const { state, db } = fakeSql('hang')
    let outcome: unknown = 'waiting'
    void settled(db.summaries(31337)).then((value) => {
      outcome = value
    })
    await vi.advanceTimersByTimeAsync(DB_TIMEOUT_MS - 1)
    expect([outcome, state.cancelled]).toEqual(['waiting', 0])
    await vi.advanceTimersByTimeAsync(1)
    expect(outcome instanceof IndexerWriteError && [outcome.code, outcome.message]).toEqual([
      'TIMEOUT',
      "The indexer's indexer_summaries call failed (TIMEOUT).",
    ])
    expect(state.cancelled).toBe(1)
  })

  it('closes its connections on end', async () => {
    const { state, db } = fakeSql()
    await db.end()
    expect(state.ended).toEqual({ timeout: 5 })
  })
})
```

In `apps/freshness/src/server.test.ts`, replace:

```ts
describe('startFreshness with the indexer (docs/specs/2026-10-16-indexer-overview.md, section 6.1)', () => {
```

with:

```ts
describe('startFreshness with the indexer (docs/specs/2026-10-17-production-hardening.md, section 8.1)', () => {
```

In `apps/freshness/src/server.test.ts`, replace:

```ts
      [{ supabaseUrl: 'not a url', serviceRoleKey: 'key' }, 'must be an http or https URL'],
      [{ supabaseUrl: 'http://127.0.0.1:54321/rest/v1', serviceRoleKey: 'key' }, 'with no path'],
      [{ supabaseUrl: '', serviceRoleKey: '' }, 'are both needed'],
```

with:

```ts
      [{ databaseUrl: 'http://127.0.0.1:55321' }, 'must be a postgres:// or postgresql:// connection string'],
      [{ databaseUrl: 'postgresql://cobweb_indexer@127.0.0.1:55322/postgres' }, 'has no password'],
      [
        { databaseUrl: 'postgresql://postgres:pw@127.0.0.1:55322/postgres' },
        'must connect as the cobweb_indexer role',
      ],
```

In `apps/freshness/src/server.test.ts`, replace:

```ts
  it('listens with options it can use, the passes starting on each served chain, and closes', async () => {
```

with:

```ts
  it('listens with options it can use, connecting on the first call, and closes its connections', async () => {
    // Nothing listens on port 1: a pass would fail as NETWORK, and with no chain served none runs.
```

In `apps/freshness/src/server.test.ts`, replace:

```ts
      indexer: { supabaseUrl: 'http://127.0.0.1:54321', serviceRoleKey: 'key' },
```

with:

```ts
      indexer: { databaseUrl: 'postgresql://cobweb_indexer:pw@127.0.0.1:1/postgres' },
```

In `apps/freshness/src/server.test.ts`, replace:

```ts
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('The indexer runs on no chain.'))
```

with:

```ts
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('The indexer runs on no chain as cobweb_indexer.'),
    )
  })

  it('says the indexer is off without its database', async () => {
    const freshness = await startFreshness({ port: 0, host: '127.0.0.1', chainIds: [] })
    await freshness.close()
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('The indexer is off: set INDEXER_DATABASE_URL to run it.'),
    )
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @cobweb/freshness exec vitest run src/config.test.ts src/indexer-db.test.ts src/server.test.ts`
Expected: FAIL, the new options and the connection missing: `indexerConnectionOf is not a function`, `unreadIndexerVariables is not a function` and `Test Files  3 failed (3)`.

- [ ] **Step 3: The driver**

postgres.js 3.4.9, pinned as the web app's is (Decision 3), in place of supabase-js, which the freshness server no longer needs.

In `apps/freshness/package.json`, replace:

```json
    "@supabase/supabase-js": "^2.117.2",
```

with:

```json
    "postgres": "3.4.9",
```

Run: `pnpm install --offline`
Expected: PASS, `Done in`.

`pnpm-lock.yaml` changes three lines, the freshness server's importer.

- [ ] **Step 4: The options**

In `apps/freshness/src/config.ts`, replace:

```ts
/**
 * The indexer's settings (docs/specs/2026-10-16-indexer-overview.md, section 6.1): its database, the
 * project's API URL and service role key, the names and the client the render worker uses; and the passes'
 * delays and the targets' read, which `verify:indexer` shortens.
 */
export type IndexerOptions = {
  supabaseUrl: string
  serviceRoleKey: string
```

with:

```ts
/** The login role the indexer connects as (docs/specs/2026-10-17-production-hardening.md, section 8.1). */
export const INDEXER_ROLE = 'cobweb_indexer'

/**
 * The indexer's settings (docs/specs/2026-10-17-production-hardening.md, section 8.1): its database, a connection
 * string for the cobweb_indexer role, which executes the indexer's four functions and nothing else, with the path
 * of the database's CA certificate when one is given; and the passes' delays and the targets' read, which
 * `verify:indexer` shortens.
 */
export type IndexerOptions = {
  databaseUrl: string
  /** The path of the database's CA certificate (PEM), which the connection's verification then trusts. */
  sslCaFile?: string
```

In `apps/freshness/src/config.ts`, replace:

```ts
/**
 * Whether a value is a URL supabase-js takes: `http://` or `https://`, then a URL that parses. `createClient`
 * throws on any other.
 */
function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim()) && URL.canParse(value.trim())
}

/**
 * The indexer's options from `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, a blank one read as unset: null
 * when neither is set, so the indexer stays off. Otherwise they are checked as `checkIndexerOptions` checks
 * them, which refuses the start as a malformed factory address does.
 */
export function indexerOptionsOf(env: Record<string, string | undefined>): IndexerOptions | null {
  const supabaseUrl = env.SUPABASE_URL ?? ''
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!supabaseUrl && !serviceRoleKey) return null
  return checkIndexerOptions({ supabaseUrl, serviceRoleKey })
}

/**
 * The indexer's options, answered as they are once checked: both values set, and `SUPABASE_URL` an http or
 * https URL with no path, as a project's API URL is (a path would send every call to the wrong place). A
 * refusal is a viem `BaseError` named `ConfigurationError` whose sentence names the variables, never a value.
 * `startFreshness` checks its options with it before it listens.
 */
export function checkIndexerOptions(options: IndexerOptions): IndexerOptions {
  if (!options.supabaseUrl || !options.serviceRoleKey)
    throw new BaseError(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are both needed to run the indexer; set both or neither.',
      { name: 'ConfigurationError' },
    )
  if (!isHttpUrl(options.supabaseUrl))
    throw new BaseError('SUPABASE_URL must be an http or https URL.', { name: 'ConfigurationError' })
  if (new URL(options.supabaseUrl.trim()).pathname !== '/')
    throw new BaseError("SUPABASE_URL must be the project's URL, with no path.", {
      name: 'ConfigurationError',
    })
  return options
}
```

with:

```ts
/** Hosts on this machine, where the local stack answers over plain TCP. */
const LOOPBACK_HOSTS: readonly string[] = ['localhost', '127.0.0.1', '[::1]']
/** The TLS modes a connection string may name for a database on another machine: the verified ones. */
const VERIFIED_MODES: readonly string[] = ['verify-ca', 'verify-full']

/** Whether a connection string's host is this machine. */
export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.includes(hostname)
}

/** The session pooler's name for the role: cobweb_indexer.<project ref>. */
const POOLER_USER = /^cobweb_indexer\.[a-z0-9]+$/

/** The variables the indexer read before it had its own role, which nothing reads now. */
const OLD_VARIABLES = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const

/**
 * The indexer's options from `INDEXER_DATABASE_URL`, a blank one read as unset: null when it is unset, so the
 * indexer stays off; with `INDEXER_DATABASE_SSL_CA`, the path of the database's CA certificate, when set. Otherwise
 * it is checked as `checkIndexerOptions` checks it, which refuses the start as a malformed factory address does.
 */
export function indexerOptionsOf(env: Record<string, string | undefined>): IndexerOptions | null {
  const databaseUrl = env.INDEXER_DATABASE_URL?.trim() ?? ''
  if (!databaseUrl) return null
  const sslCaFile = env.INDEXER_DATABASE_SSL_CA?.trim()
  return checkIndexerOptions(sslCaFile ? { databaseUrl, sslCaFile } : { databaseUrl })
}

const refusal = (sentence: string) => new BaseError(sentence, { name: 'ConfigurationError' })

/**
 * The indexer's options, answered as they are once checked: a `postgres://` or `postgresql://` connection string
 * with a password, whose user is cobweb_indexer, or the session pooler's cobweb_indexer.<project ref>, and which
 * asks for no unverified connection to a database that is not on this machine (an `sslmode` or `ssl` parameter,
 * when given, of verify-ca or verify-full; require, prefer, allow and disable each leave the certificate unchecked
 * or TLS off). A refusal is a viem `BaseError` named `ConfigurationError` whose sentence never carries any part of
 * the value. `startFreshness` checks its options with it before it listens.
 */
export function checkIndexerOptions(options: IndexerOptions): IndexerOptions {
  let url: URL | null
  try {
    url = new URL(options.databaseUrl.trim())
  } catch {
    url = null
  }
  if (!url || !['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname)
    throw refusal('INDEXER_DATABASE_URL must be a postgres:// or postgresql:// connection string.')
  if (!url.password)
    throw refusal("INDEXER_DATABASE_URL has no password; include the cobweb_indexer role's password.")
  let user: string
  try {
    user = decodeURIComponent(url.username)
  } catch {
    user = ''
  }
  if (user !== INDEXER_ROLE && !POOLER_USER.test(user))
    throw refusal('INDEXER_DATABASE_URL must connect as the cobweb_indexer role.')
  if (!isLoopbackHost(url.hostname))
    for (const name of ['sslmode', 'ssl']) {
      const mode = url.searchParams.get(name)
      if (mode !== null && !VERIFIED_MODES.includes(mode))
        throw refusal(
          'INDEXER_DATABASE_URL must verify TLS for a database on another machine: leave sslmode out, or set it to verify-full.',
        )
    }
  return options
}

/** `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` where still set: `index.ts` logs them as no longer read. */
export function unreadIndexerVariables(env: Record<string, string | undefined>): string[] {
  return OLD_VARIABLES.filter((name) => Boolean(env[name]?.trim()))
}
```

- [ ] **Step 5: The port over postgres.js**

Each call is `select public.<fn>(<parameters with casts>) as answer` on a client with no prepared statements, so either pooler mode serves; TLS is an object postgres.js merges into Node's options, never one of its string modes (Decision 16).

Replace the whole of `apps/freshness/src/indexer-db.ts` with:

```ts
import { readFileSync } from 'node:fs'
import type { MintBody } from '@cobweb/shared'
import postgres from 'postgres'
import { BaseError, type Address, type Hex } from 'viem'
import type { Summary } from './activity.ts'
import { isLoopbackHost, type IndexerOptions } from './config.ts'
import type { Records } from './indexer-records.ts'

/**
 * The indexer's database (docs/specs/2026-10-17-production-hardening.md, section 8.1): the four functions of its
 * migration, called as the cobweb_indexer role over postgres.js, which may execute those four and nothing else.
 * The request path never uses it. A failure throws `IndexerWriteError`, which names the function and the code,
 * never the database's message or the connection string.
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

export type IndexerFunction = 'indexer_targets' | 'indexer_start' | 'indexer_record' | 'indexer_summaries'

/** One function's call with its arguments in order, answering its jsonb. */
export type IndexerCall = (fn: IndexerFunction, args: readonly unknown[]) => Promise<unknown>

/**
 * How long one database call may take before it is abandoned and counts as failed: the role's statement_timeout
 * too (indexer spec, Review Focus 1).
 */
export const DB_TIMEOUT_MS = 10_000

/** The refusals that mean the cursors in memory no longer match the database's. */
const GAP_SENTENCES: readonly string[] = [
  'The indexer would skip blocks.',
  'A collection is not indexed on this chain.',
]

/**
 * A database call that failed: the function and the code, a Postgres code such as 23514, 42501 (a grant is
 * missing), 42883 (the function is missing) or 28P01 (the password is refused), TIMEOUT when the call was
 * abandoned, or NETWORK when no answer came. `gap` when the refusal means the cursors in memory no longer match
 * the database's, so the targets are read again.
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
 * The port over a call. Blocks travel as numbers, which hold any block below 2^53 exactly, and the sync time as
 * ISO. Every function answers jsonb, so a call answering nothing failed too.
 */
export function indexerDbOf(call: IndexerCall): IndexerDb {
  async function answered<T>(fn: IndexerFunction, args: readonly unknown[]): Promise<T> {
    const answer = await call(fn, args)
    if (answer === null || answer === undefined) throw new IndexerWriteError(fn, 'NO_ANSWER', false)
    return answer as T
  }

  return {
    async targets(chainId) {
      const rows = await answered<DbTarget[]>('indexer_targets', [chainId])
      return rows.map((row) => ({
        ...row,
        fromBlock: blockOf(row.fromBlock),
        indexedBlock: blockOf(row.indexedBlock),
      }))
    },
    async start(collectionId, fromBlock) {
      await answered('indexer_start', [collectionId, Number(fromBlock)])
    },
    async record(write) {
      const answer = await answered<Record<string, DbSummary>>('indexer_record', [
        write.chainId,
        Number(write.fromBlock),
        Number(write.toBlock),
        write.syncedAt === null ? null : new Date(write.syncedAt * 1_000).toISOString(),
        write.collections,
        write.records,
      ])
      return Object.values(answer).map(summaryOf)
    },
    async summaries(chainId) {
      return (await answered<DbSummary[]>('indexer_summaries', [chainId])).map(summaryOf)
    },
  }
}

/** Each function's parameters with their casts, so Postgres picks its one signature. */
export const INDEXER_PARAMETERS: Record<IndexerFunction, string> = {
  indexer_targets: '$1::integer',
  indexer_start: '$1::uuid, $2::bigint',
  indexer_record: '$1::integer, $2::bigint, $3::bigint, $4::timestamptz, $5::uuid[], $6::jsonb',
  indexer_summaries: '$1::integer',
}

/** The part of a postgres.js client the port uses: a query with parameters, which can be cancelled, and `end`. */
export type IndexerSql = {
  unsafe(query: string, parameters: unknown[]): PromiseLike<{ answer: unknown }[]> & { cancel(): unknown }
  end(options: { timeout: number }): Promise<void>
}

/**
 * The connection's TLS as postgres.js takes it: an object, which it merges into Node's TLS options, so the
 * certificate is checked against the system's CAs, or the given one, and the host against the certificate (Node's
 * default); or undefined for a database on this machine, where the connection string decides (plain TCP for the
 * local stack). Never postgres.js's string modes: in 3.4.9 `require`, `allow` and `prefer` set
 * `rejectUnauthorized: false`, and `prefer` falls back to plain TCP.
 */
export type IndexerTls = { rejectUnauthorized: true; ca?: string } | undefined

/** A CA certificate that cannot be read refuses the start, naming the variable that named it, never the path. */
const unreadableCa = (variable: string, error: unknown) =>
  new BaseError(`${variable} names a CA certificate file that cannot be read.`, {
    name: 'ConfigurationError',
    cause: error as Error,
  })

/**
 * The connection string postgres.js gets and its TLS (docs/specs/2026-10-17-production-hardening.md, section 8.1):
 * for a database on another machine, always verified (`rejectUnauthorized: true` with Node's host check), trusting
 * the CA certificate `INDEXER_DATABASE_SSL_CA` names, or else the file the string's `sslrootcert` names, when one
 * is given; for this machine, whatever the string says unless a CA is given. The string loses `sslrootcert`, which
 * postgres.js would send the server as a setting; `sslrootcert=system` means the system's CAs, the default.
 */
export function indexerConnectionOf(
  options: IndexerOptions,
  readCa: (path: string) => string = (path) => readFileSync(path, 'utf8'),
): { databaseUrl: string; ssl: IndexerTls } {
  const url = new URL(options.databaseUrl.trim())
  const rootCert = url.searchParams.get('sslrootcert')
  url.searchParams.delete('sslrootcert')
  const databaseUrl = url.toString()
  let ca: string | undefined
  if (options.sslCaFile)
    try {
      ca = readCa(options.sslCaFile)
    } catch (error) {
      throw unreadableCa('INDEXER_DATABASE_SSL_CA', error)
    }
  else if (rootCert && rootCert !== 'system')
    try {
      ca = readCa(rootCert)
    } catch (error) {
      throw unreadableCa('INDEXER_DATABASE_URL', error)
    }
  if (ca) return { databaseUrl, ssl: { rejectUnauthorized: true, ca } }
  if (isLoopbackHost(url.hostname)) return { databaseUrl, ssl: undefined }
  return { databaseUrl, ssl: { rejectUnauthorized: true } }
}

/** postgres.js on the connection string: at most 4 connections, no prepared statements, so either pooler mode serves. */
const connect = (databaseUrl: string, ssl: IndexerTls): IndexerSql =>
  postgres(databaseUrl, {
    max: 4,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 60,
    onnotice: () => {},
    ...(ssl === undefined ? {} : { ssl }),
  }) as unknown as IndexerSql

/** A Postgres refusal's code; anything else (a refused connection, a reset, a closed socket) is NETWORK. */
const codeOf = (error: unknown) => {
  const failure = error as { name?: unknown; code?: unknown }
  return failure?.name === 'PostgresError' && typeof failure.code === 'string' ? failure.code : 'NETWORK'
}

/**
 * The port as the cobweb_indexer role, over verified TLS to any database not on this machine: each call is
 * `select public.<fn>(<parameters with casts>) as answer`, abandoned and cancelled after `DB_TIMEOUT_MS`, so a
 * connection that never answers cannot hold a chain's passes, which never overlap, or the server's close. `end`
 * closes the connections. A CA certificate file that cannot be read refuses the start.
 */
export function postgresIndexerDb(
  options: IndexerOptions,
  open: (databaseUrl: string, ssl: IndexerTls) => IndexerSql = connect,
): IndexerDb & { end(): Promise<void> } {
  const { databaseUrl, ssl } = indexerConnectionOf(options)
  const sql = open(databaseUrl, ssl)

  const call: IndexerCall = async (fn, args) => {
    const query = sql.unsafe(`select public.${fn}(${INDEXER_PARAMETERS[fn]}) as answer`, [...args])
    let timer: ReturnType<typeof setTimeout> | undefined
    const timedOut = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), DB_TIMEOUT_MS)
    })
    try {
      const outcome = await Promise.race([query, timedOut])
      if (outcome === 'timeout') {
        query.cancel()
        // Its cancellation fails the query later; the call has failed already, as TIMEOUT.
        void Promise.resolve(query).catch(() => {})
        throw new IndexerWriteError(fn, 'TIMEOUT', false)
      }
      return outcome[0]?.answer ?? null
    } catch (error) {
      if (error instanceof IndexerWriteError) throw error
      const message = (error as { message?: unknown })?.message
      throw new IndexerWriteError(fn, codeOf(error), GAP_SENTENCES.includes(String(message)))
    } finally {
      clearTimeout(timer)
    }
  }

  return { ...indexerDbOf(call), end: () => sql.end({ timeout: 5 }) }
}
```

- [ ] **Step 6: Run the options' and the port's tests to see them pass**

Run: `pnpm --filter @cobweb/freshness exec vitest run src/config.test.ts src/indexer-db.test.ts`
Expected: PASS, `Tests  25 passed (25)`.

- [ ] **Step 7: The server and its start**

In `apps/freshness/src/server.ts`, replace:

```ts
import { checkIndexerOptions, servedChains, type IndexerOptions } from './config.ts'
import { chainHealth, failureLine, type HealthBody } from './health.ts'
import { hotSet, JOIN_WAIT_MS, type HotEntry } from './hot-set.ts'
import { chainIndexer, type ChainIndexer } from './indexer.ts'
import { supabaseIndexerDb } from './indexer-db.ts'
```

with:

```ts
import { checkIndexerOptions, INDEXER_ROLE, servedChains, type IndexerOptions } from './config.ts'
import { chainHealth, failureLine, type HealthBody } from './health.ts'
import { hotSet, JOIN_WAIT_MS, type HotEntry } from './hot-set.ts'
import { chainIndexer, type ChainIndexer } from './indexer.ts'
import { postgresIndexerDb } from './indexer-db.ts'
```

In `apps/freshness/src/server.ts`, replace:

```ts
 * (docs/specs/2026-10-16-indexer-overview.md, section 6.1), while the request path still reads no database.
```

with:

```ts
 * (docs/specs/2026-10-16-indexer-overview.md, section 6.1), connected as the cobweb_indexer role
 * (docs/specs/2026-10-17-production-hardening.md, section 8.1), while the request path still reads no database.
```

In `apps/freshness/src/server.ts`, replace:

```ts
  // listening server; the indexers' passes start once it listens (Decision 11).
  const db = indexing ? supabaseIndexerDb(checkIndexerOptions(indexing)) : null
```

with:

```ts
  // listening server; postgres.js connects on the first call, and the indexers' passes start once it listens.
  const db = indexing ? postgresIndexerDb(checkIndexerOptions(indexing)) : null
```

In `apps/freshness/src/server.ts`, replace:

```ts
      resolve()
    })
  })
```

with:

```ts
      resolve()
    })
  }).catch(async (error: unknown) => {
    await db?.end()
    throw error
  })
```

In `apps/freshness/src/server.ts`, replace:

```ts
        ? `The indexer runs on ${listed}.`
        : 'The indexer is off: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to run it.'
```

with:

```ts
        ? `The indexer runs on ${listed} as ${INDEXER_ROLE}.`
        : 'The indexer is off: set INDEXER_DATABASE_URL to run it.'
```

In `apps/freshness/src/server.ts`, replace:

```ts
   * the connections left and waits for any request a kept-alive connection carried meanwhile, so the server
   * makes no call once it resolves (Decision 3). The first failure is thrown once everything has settled.
```

with:

```ts
   * the connections left and waits for any request a kept-alive connection carried meanwhile, then the indexer's
   * database connections, so the server makes no call once it resolves. The first failure is thrown once
   * everything has settled.
```

In `apps/freshness/src/server.ts`, replace:

```ts
    settled.push(...(await Promise.allSettled([...answering])))
```

with:

```ts
    settled.push(...(await Promise.allSettled([...answering])))
    if (db) settled.push(...(await Promise.allSettled([db.end()])))
```

In `apps/freshness/src/index.ts`, replace:

```ts
import { indexerOptionsOf, portOf } from './config.ts'
```

with:

```ts
import { indexerOptionsOf, portOf, unreadIndexerVariables } from './config.ts'
```

In `apps/freshness/src/index.ts`, replace:

```ts
// this TypeScript source as it is, on PORT, with the indexer when SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
// are set (docs/specs/2026-10-16-indexer-overview.md, section 6.1). A start that fails (a served chain's
// factory that is not an address, one of the two database variables set alone, or a port already in use) is
// logged through `failureLine`, which names the error and its code and never prints a full message, and exits
// 1. On SIGTERM it stops its ticks, windows and indexers, closes the server and exits.

/** The start, its options read inside it, so a refused option fails it as a failed start. */
async function start() {
```

with:

```ts
// this TypeScript source as it is, on PORT, with the indexer when INDEXER_DATABASE_URL is set, connected as the
// cobweb_indexer role (docs/specs/2026-10-17-production-hardening.md, section 8.1). A start that fails (a served
// chain's factory that is not an address, a database URL that is not the role's, or a port already in use) is
// logged through `failureLine`, which names the error and its code and never prints a full message, and exits
// 1. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, which the indexer read before its role, are named as no longer
// read when set. On SIGTERM it stops its ticks, windows and indexers, closes the server and exits.

/** The start, its options read inside it, so a refused option fails it as a failed start. */
async function start() {
  const unread = unreadIndexerVariables(process.env)
  if (unread.length) console.log(`No longer read, remove from this service: ${unread.join(' and ')}.`)
```

Run: `pnpm --filter @cobweb/freshness exec vitest run src/server.test.ts`
Expected: PASS, `Tests  3 passed (3)`.

- [ ] **Step 8: Typecheck and lint the freshness server**

Run: `pnpm --filter @cobweb/freshness typecheck && pnpm --filter @cobweb/freshness lint`
Expected: PASS.

- [ ] **Step 9: `verify:indexer` through the role**

The run sets a password on `cobweb_indexer` through `supabase status`'s `DB_URL` unless a local `INDEXER_DATABASE_URL` is set, connects through it, and clears it in its cleanup; check 1 names the role.

In `apps/web/scripts/verify-indexer.ts`, replace:

```ts
// apps/web/.env.local, and refuses non-local endpoints. The server's database is the local one, with the service
// role key the fixture read; the script prints no key and no URL, and a thrown error prints viem's short message
// or its first line (chain-fixture.ts). Stop any other indexer on the same database first (a running
// `pnpm --filter @cobweb/freshness dev` with the two variables set): it would race checks 11, 13 and 15. The
```

with:

```ts
// apps/web/.env.local, and refuses non-local endpoints. The server's indexer connects to the local database as the
// cobweb_indexer role (docs/specs/2026-10-17-production-hardening.md, section 8.1): through INDEXER_DATABASE_URL
// when the environment sets a local one, else at a password this run sets through `supabase status`'s DB_URL and
// clears in its cleanup. The script prints no key, no password and no URL, and a thrown error prints viem's short
// message or its first line (chain-fixture.ts). Stop any other indexer on the same database first (a running
// `pnpm --filter @cobweb/freshness dev` with INDEXER_DATABASE_URL set): it would race checks 11, 13 and 15. The
```

In `apps/web/scripts/verify-indexer.ts`, replace:

```ts
// `node --conditions=react-server --import ./scripts/resolve-ts.mjs`.

import { isAddressEqual, parseEther, type Address, type Hex } from 'viem'
```

with:

```ts
// `node --conditions=react-server --import ./scripts/resolve-ts.mjs`.

import { randomBytes } from 'node:crypto'
import postgres from 'postgres'
import { isAddressEqual, parseEther, type Address, type Hex } from 'viem'
```

In `apps/web/scripts/verify-indexer.ts`, replace:

```ts
  readLockCollection,
```

with:

```ts
  readLockCollection,
  refuseRemote,
```

In `apps/web/scripts/verify-indexer.ts`, replace:

```ts
} from './deploy-fixture.ts'
```

with:

```ts
} from './deploy-fixture.ts'
import { config } from './render-deps.ts'
```

In `apps/web/scripts/verify-indexer.ts`, replace:

```ts
/** The indexer on fast intervals, so each change is read within about a second. */
const INDEXER: IndexerOptions = {
  supabaseUrl: settings.url,
  serviceRoleKey: settings.serviceKey,
  passMs: { behind: 200, fast: 500, idle: 500 },
  targetsEveryMs: 1_000,
```

with:

```ts
/** The indexer's pace: fast intervals, so each change is read within about a second. */
const PACE = { passMs: { behind: 200, fast: 500, idle: 500 }, targetsEveryMs: 1_000 }
/** The indexer's options, its database set at the first start. */
let indexer: IndexerOptions | null = null
/** Clears the password this run set on cobweb_indexer, when it set one. */
let clearPassword: (() => Promise<void>) | null = null

/**
 * The role's connection string: a local INDEXER_DATABASE_URL already set, else the local database as
 * cobweb_indexer at a password set here through DB_URL, which the cleanup clears.
 */
async function indexerDatabaseUrl(): Promise<string> {
  const given = process.env.INDEXER_DATABASE_URL?.trim()
  if (given) {
    refuseRemote(given)
    return given
  }
  const dbUrl = config('SUPABASE_DB_URL', ['DB_URL'])
  refuseRemote(dbUrl)
  const password = randomBytes(24).toString('hex')
  const owner = postgres(dbUrl, { max: 1, onnotice: () => {} })
  await owner.unsafe(`alter role cobweb_indexer with password '${password}'`)
  clearPassword = async () => {
    await owner.unsafe('alter role cobweb_indexer with password null')
    await owner.end()
  }
  const url = new URL(dbUrl)
  url.username = 'cobweb_indexer'
  url.password = password
  return url.toString()
```

In `apps/web/scripts/verify-indexer.ts`, replace:

```ts
/** The freshness server in process, serving Anvil alone, with its indexer on. */
async function startServer(): Promise<Freshness> {
  freshness = await startFreshness({ port: 0, host: '127.0.0.1', chainIds: [31337], indexer: INDEXER })
```

with:

```ts
/** The freshness server in process, serving Anvil alone, with its indexer on as cobweb_indexer. */
async function startServer(): Promise<Freshness> {
  indexer ??= { databaseUrl: await indexerDatabaseUrl(), ...PACE }
  freshness = await startFreshness({ port: 0, host: '127.0.0.1', chainIds: [31337], indexer })
```

In `apps/web/scripts/verify-indexer.ts`, replace:

```ts
    '1. setup: Anvil answers as 31337 with the factory approving the shipped code hash, Supabase answers, and the freshness server serves 31337 with its indexer on',
```

with:

```ts
    '1. setup: Anvil answers as 31337 with the factory approving the shipped code hash, Supabase answers, and the freshness server serves 31337 with its indexer on as cobweb_indexer',
```

In `apps/web/scripts/verify-indexer.ts`, replace:

```ts
      }, INDEXER.targetsEveryMs! + 1_000)
```

with:

```ts
      }, PACE.targetsEveryMs + 1_000)
```

In `apps/web/scripts/verify-indexer.ts`, replace:

```ts
        await attempt('removing the fixtures', removeFixtures),
```

with:

```ts
        await attempt('removing the fixtures', removeFixtures),
        await attempt('clearing the role password', async () => clearPassword?.()),
```

Run: `pnpm --filter @cobweb/web verify:indexer`
Expected: PASS, `15 passed, 0 failed`. Nothing else may index the local database meanwhile.

- [ ] **Step 10: Format, run the root checks and commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
pnpm exec prettier --write apps/freshness/package.json apps/freshness/src/config.ts apps/freshness/src/config.test.ts apps/freshness/src/indexer-db.ts apps/freshness/src/indexer-db.test.ts apps/freshness/src/server.ts apps/freshness/src/server.test.ts apps/freshness/src/index.ts apps/web/scripts/verify-indexer.ts
pnpm typecheck && pnpm lint && pnpm test
git add apps/freshness/package.json pnpm-lock.yaml apps/freshness/src/config.ts apps/freshness/src/config.test.ts apps/freshness/src/indexer-db.ts apps/freshness/src/indexer-db.test.ts apps/freshness/src/server.ts apps/freshness/src/server.test.ts apps/freshness/src/index.ts apps/web/scripts/verify-indexer.ts
git commit -m "$(cat <<'EOF'
Connect the freshness server's indexer as the cobweb_indexer role over postgres.js from INDEXER_DATABASE_URL in place of the service role key, with verified TLS to any database off this machine, and run verify:indexer through the role

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: freshness 199 tests in 17 files; web 972 in 103; the other packages unchanged.

---

### Task 8: `/health`'s status and problems over the last 5 minutes

**Kind:** transcription. The plan carries every line: a Sonnet implementer.

**Files:**

- Create: `apps/freshness/src/recent.ts`, `apps/freshness/src/recent.test.ts`
- Modify: `apps/freshness/src/health.ts`, `chain-reader.ts`, `indexer.ts`, `server.ts`, their tests (`health.test.ts`, `chain-reader.test.ts`, `indexer.test.ts`, `server.test.ts`), `apps/web/scripts/verify-freshness.ts` (check 2), `apps/web/scripts/verify-indexer.ts` (check 14)
- Test: the five test files; `pnpm --filter @cobweb/web verify:freshness` and `verify:indexer`

**Interfaces:**

- Consumes: `ReaderHealth`, `IndexerHealth`, `ChainHealth` and `chainHealth` of `health.ts`; the reader's tick and factory-read failures; the indexer's passes (Task 7's port).
- Produces:
  - `recent.ts`: `RECENT_WINDOW_MS = 300_000`, `recentCounter(windowMs?, cap = 1_000): { note(now); count(now) }`, a failure counted while it is less than 5 minutes old (Decision 19)
  - `health.ts`: `ReaderHealth.failedTicksRecent`; `IndexerHealth.failedPassesRecent`, `lastGoodPassAt: string | null`, `behindSince: string | null`; `HealthBody.status: 'ok' | 'degraded'` and `problems: string[]`; `HEALTH_LIMITS = { readerStaleS: 60, readerLagS: 120, readerFailures: 10, indexerStaleS: 120, indexerBehindS: 900, indexerFailures: 5 }`; `healthProblems(chains, now, startedAt, limits?)`, one sentence per threshold crossed (for example "Anvil: no good read for 61 s (limit 60 s).")
  - the reader counting its failed ticks and factory reads in the window; the indexer setting `lastGoodPassAt` only after a pass without a failure, `behindSince` at the end of each pass, and counting its failed passes in the window; `/health` answering 200 with `status` and `problems`

- [ ] **Step 1: Write the failing tests**

Each threshold is read at its limit (ok) and one past it (its sentence), with the start's grace while there was no good read or pass yet (spec section 8.2).

Create `apps/freshness/src/recent.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { RECENT_WINDOW_MS, recentCounter } from './recent.ts'

describe('recentCounter (docs/specs/2026-10-17-production-hardening.md, section 8.2)', () => {
  it('counts the failures inside the last 5 minutes and drops the older ones', () => {
    const counter = recentCounter()
    counter.note(1_000)
    counter.note(2_000)
    counter.note(250_000)
    expect(counter.count(250_000)).toBe(3)
    expect(counter.count(1_000 + RECENT_WINDOW_MS - 1)).toBe(3)
    expect(counter.count(1_000 + RECENT_WINDOW_MS)).toBe(2)
    expect(counter.count(250_000 + RECENT_WINDOW_MS)).toBe(0)
  })

  it('keeps the latest at most, as many as its cap', () => {
    const counter = recentCounter(RECENT_WINDOW_MS, 3)
    for (let at = 1; at <= 5; at++) counter.note(at)
    expect(counter.count(10)).toBe(3)
    expect(recentCounter(1_000).count(0)).toBe(0)
  })
})
```

In `apps/freshness/src/health.test.ts`, replace:

```ts
  failureName,
```

with:

```ts
  failureName,
  HEALTH_LIMITS,
  healthProblems,
  type ChainHealth,
```

In `apps/freshness/src/health.test.ts`, replace:

```ts
    logGaps: 0,
```

with:

```ts
    logGaps: 0,
    failedTicksRecent: 0,
```

In `apps/freshness/src/health.test.ts`, replace:

```ts
    unpaired: 1,
```

with:

```ts
    unpaired: 1,
    failedPassesRecent: 0,
    lastGoodPassAt: '2026-10-16T12:00:01.000Z',
    behindSince: null,
```

In `apps/freshness/src/health.test.ts`, replace:

```ts
    ])
  })
})
```

with:

```ts
      'failedPassesRecent',
      'lastGoodPassAt',
      'behindSince',
    ])
  })
})

describe('healthProblems (docs/specs/2026-10-17-production-hardening.md, section 8.2)', () => {
  const START = Date.parse('2026-10-17T12:00:00.000Z')
  /** ISO for `seconds` after the start. */
  const at = (seconds: number) => new Date(START + seconds * 1_000).toISOString()
  /** A chain read well and indexed well at 1,000 s past the start, with one hot collection. */
  const healthy = (
    changes: Partial<ReaderHealth> = {},
    indexer: Partial<IndexerHealth> | null = {},
  ): ChainHealth => ({
    chainId: 31337,
    name: 'Anvil',
    hot: 1,
    tier: 'live',
    block: 120,
    lagSeconds: 2,
    lastGoodTickAt: at(1_000),
    failedTicks: 40,
    lastError: 'HttpRequestError',
    logGaps: 0,
    failedTicksRecent: 0,
    ...changes,
    indexer:
      indexer === null
        ? null
        : {
            collections: 2,
            behind: 0,
            block: 119,
            lastPassAt: at(1_000),
            failedPasses: 30,
            lastError: 'IndexerWriteError (23514)',
            unpaired: 0,
            failedPassesRecent: 0,
            lastGoodPassAt: at(1_000),
            behindSince: null,
            ...indexer,
          },
  })
  const problemsAt = (seconds: number, chain: ChainHealth) =>
    healthProblems([chain], START + seconds * 1_000, START)

  it('reads ok at each limit, the cumulative counts aside', () => {
    expect(HEALTH_LIMITS).toEqual({
      readerStaleS: 60,
      readerLagS: 120,
      readerFailures: 10,
      indexerStaleS: 120,
      indexerBehindS: 900,
      indexerFailures: 5,
    })
    const atLimits = healthy(
      { lagSeconds: 120, failedTicksRecent: 10 },
      { failedPassesRecent: 5, behind: 1, behindSince: at(160) },
    )
    expect(problemsAt(1_060, atLimits)).toEqual([])
  })

  it("says one sentence for each limit a chain's reader passes", () => {
    expect(problemsAt(1_061, healthy())).toEqual(['Anvil: no good read for 61 s (limit 60 s).'])
    expect(problemsAt(1_000, healthy({ lagSeconds: 121 }))).toEqual([
      'Anvil: the newest block is 121 s old (limit 120 s).',
    ])
    expect(problemsAt(1_000, healthy({ failedTicksRecent: 11 }))).toEqual([
      'Anvil: 11 failed reads in 5 minutes (limit 10).',
    ])
  })

  it("says one sentence for each limit a chain's indexer passes", () => {
    const fresh = { lastGoodTickAt: at(1_121) }
    expect(problemsAt(1_121, healthy(fresh))).toEqual(['Anvil: no good index pass for 121 s (limit 120 s).'])
    expect(problemsAt(1_000, healthy({}, { behind: 3, behindSince: at(99) }))).toEqual([
      'Anvil: 3 collections behind for 901 s (limit 900 s).',
    ])
    expect(problemsAt(1_000, healthy({}, { failedPassesRecent: 6 }))).toEqual([
      'Anvil: 6 failed index passes in 5 minutes (limit 5).',
    ])
  })

  it('counts from the start while there was no good read or pass yet', () => {
    const none = healthy({ lastGoodTickAt: null }, { lastGoodPassAt: null })
    expect(problemsAt(60, none)).toEqual([])
    expect(problemsAt(121, none)).toEqual([
      'Anvil: no good read for 121 s (limit 60 s).',
      'Anvil: no good index pass for 121 s (limit 120 s).',
    ])
  })

  it('has no reader problem but its failures with no hot collection, and no indexer problem with the indexer off', () => {
    const quiet = healthy({ hot: 0, lastGoodTickAt: null, lagSeconds: 500, failedTicksRecent: 11 }, null)
    expect(problemsAt(10_000, quiet)).toEqual(['Anvil: 11 failed reads in 5 minutes (limit 10).'])
  })

  it('names each chain in the order served', () => {
    const base = healthy({ chainId: 8453, name: 'Base', failedTicksRecent: 12 }, null)
    expect(healthProblems([base, healthy({ lagSeconds: 200 })], START + 1_999_000, START)).toEqual([
      'Base: no good read for 999 s (limit 60 s).',
      'Base: 12 failed reads in 5 minutes (limit 10).',
      'Anvil: no good read for 999 s (limit 60 s).',
      'Anvil: the newest block is 200 s old (limit 120 s).',
      'Anvil: no good index pass for 999 s (limit 120 s).',
    ])
  })
})
```

In `apps/freshness/src/chain-reader.test.ts`, replace:

```ts
import { hotSet, type HotSet } from './hot-set.ts'
```

with:

```ts
import { hotSet, type HotSet } from './hot-set.ts'
import { RECENT_WINDOW_MS } from './recent.ts'
```

In `apps/freshness/src/chain-reader.test.ts`, replace:

```ts
  })

  it("fails a tick whose head does not answer, keeping every read and logging the error's name, never the RPC URL", async () => {
```

with:

```ts
  })

  it('counts failed ticks and the factory reads the server could not make over the last 5 minutes, for /health', async () => {
    const { chain, client } = fakeChain()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const hot = hotSet()
    const reader = chainReader(ANVIL, hot, client)
    reader.noteFailure(rpcDown(429))
    chain.failure = rpcDown(503)
    hot.join(31337, A, Date.now())
    reader.wake()
    await settle()
    expect(reader.health()).toMatchObject({ failedTicks: 2, failedTicksRecent: 2 })
    await reader.stop()
    vi.setSystemTime(Date.now() + RECENT_WINDOW_MS)
    expect(reader.health()).toMatchObject({ failedTicks: 2, failedTicksRecent: 0 })
  })

  it("fails a tick whose head does not answer, keeping every read and logging the error's name, never the RPC URL", async () => {
```

In `apps/freshness/src/indexer.test.ts`, replace:

```ts
import { chainIndexer } from './indexer.ts'
```

with:

```ts
import { chainIndexer } from './indexer.ts'
import { RECENT_WINDOW_MS } from './recent.ts'
```

In `apps/freshness/src/indexer.test.ts`, replace:

```ts
      unpaired: 1,
```

with:

```ts
      unpaired: 1,
      failedPassesRecent: 0,
      lastGoodPassAt: new Date(1_000_000).toISOString(),
      behindSince: null,
```

In `apps/freshness/src/indexer.test.ts`, replace:

```ts
  })

  it('waits for the pass in flight when stopped, and makes no call after', async () => {
```

with:

```ts
  })

  it('sets its last good pass only after a pass without a failure, and counts the failures of the last 5 minutes (docs/specs/2026-10-17-production-hardening.md, section 8.2)', async () => {
    const { chain, client } = fakeChain()
    const { port } = fakeDb([targetAt(ID_A, A, DEPLOY_A, 100n)])
    chain.headFailures = 1
    const indexer = indexerOn(client, port)
    await settle()
    expect(indexer.health()).toMatchObject({ failedPasses: 1, failedPassesRecent: 1, lastGoodPassAt: null })
    // The fast delay after a failed pass, then a good one.
    await vi.advanceTimersByTimeAsync(5_000)
    expect(indexer.health()).toMatchObject({
      failedPasses: 1,
      failedPassesRecent: 1,
      lastGoodPassAt: new Date(1_005_000).toISOString(),
    })
    await vi.advanceTimersByTimeAsync(RECENT_WINDOW_MS)
    expect(indexer.health()).toMatchObject({ failedPasses: 1, failedPassesRecent: 0 })
    await indexer.stop()
  })

  it('notes since when its collections are behind at the end of each pass, and clears it once none is', async () => {
    const { chain, client } = fakeChain()
    const { port } = fakeDb([targetAt(ID_A, A, DEPLOY_A, 100n)])
    // 500 blocks behind: more than one pass's scan of 500 from 32 blocks below the cursor.
    chain.head = 600n
    const indexer = indexerOn(client, port)
    await settle()
    expect(indexer.health()).toMatchObject({ behind: 1, behindSince: new Date(1_000_000).toISOString() })
    // The backfill's next pass, 1 s later, reaches the safe block.
    await vi.advanceTimersByTimeAsync(1_000)
    expect(indexer.health()).toMatchObject({ behind: 0, behindSince: null })
    chain.head = 1_200n
    await vi.advanceTimersByTimeAsync(20_000)
    expect(indexer.health()).toMatchObject({ behind: 1, behindSince: new Date(1_021_000).toISOString() })
    await indexer.stop()
  })

  it('waits for the pass in flight when stopped, and makes no call after', async () => {
```

In `apps/freshness/src/server.test.ts`, replace:

```ts
    expect([health.status, ((await health.json()) as { status: string }).status]).toEqual([200, 'ok'])
```

with:

```ts
    expect(health.status).toBe(200)
    expect(await health.json()).toMatchObject({ status: 'ok', problems: [] })
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @cobweb/freshness exec vitest run src/recent.test.ts src/health.test.ts src/chain-reader.test.ts src/indexer.test.ts src/server.test.ts`
Expected: FAIL: `Cannot find module './recent.ts'`, `healthProblems is not a function` and `Test Files  5 failed (5)`.

- [ ] **Step 3: The window and the thresholds**

Create `apps/freshness/src/recent.ts`:

```ts
/**
 * Failures counted over the last 5 minutes for /health's thresholds (docs/specs/2026-10-17-production-hardening.md,
 * section 8.2), pure: a cumulative counter only grows, so an alert on it would never clear.
 */

export const RECENT_WINDOW_MS = 300_000
/** At most this many failure times are kept: more than any threshold needs. */
const RECENT_CAP = 1_000

/** Notes failure times and counts those inside the window, keeping at most `cap` of the latest. */
export function recentCounter(
  windowMs: number = RECENT_WINDOW_MS,
  cap: number = RECENT_CAP,
): { note(now: number): void; count(now: number): number } {
  const times: number[] = []
  return {
    note(now) {
      times.push(now)
      if (times.length > cap) times.splice(0, times.length - cap)
    },
    count(now) {
      while (times.length && now - times[0]! >= windowMs) times.shift()
      return times.length
    },
  }
}
```

In `apps/freshness/src/health.ts`, replace:

```ts
  logGaps: number
```

with:

```ts
  logGaps: number
  /** Failed ticks and noted factory failures in the last 5 minutes. */
  failedTicksRecent: number
```

In `apps/freshness/src/health.ts`, replace:

```ts
  unpaired: number
```

with:

```ts
  unpaired: number
  /** Failures in the last 5 minutes. */
  failedPassesRecent: number
  /** When the last pass without a failure ended (ISO); null before one. */
  lastGoodPassAt: string | null
  /** Since when some collection has been behind, without a pass finding none since (ISO); null while none is. */
  behindSince: string | null
```

In `apps/freshness/src/health.ts`, replace:

```ts
  status: 'ok'
```

with:

```ts
  status: 'ok' | 'degraded'
  /** One sentence per threshold crossed, which an alert can show; empty while `status` is ok. */
  problems: string[]
```

In `apps/freshness/src/health.ts`, replace:

```ts
}

/** How many causes deep the log line looks, so a cause that refers back to itself cannot loop. */
```

with:

```ts
}

/**
 * The thresholds /health answers `degraded` past (docs/specs/2026-10-17-production-hardening.md, section 8.2). It
 * stays 200, so Railway's deploy check never refuses a deployment during an RPC outage; a monitor keys on the body:
 * the keyword `"status":"ok"`, and the `problems` in its alert. Per chain:
 * - readerStaleS: with hot collections, no good read for more than 60 s (counted from the start while there was
 *   none): the chain's RPC is down or refusing;
 * - readerLagS: with hot collections, the newest block read is more than 120 s old: the node is stuck, or a quiet
 *   chain makes no block;
 * - readerFailures: more than 10 failed reads (ticks and factory reads) in 5 minutes: the RPC is flapping;
 * - indexerStaleS: with the indexer on, no pass without a failure for more than 120 s (from the start while there
 *   was none): the database or the RPC fails every pass;
 * - indexerBehindS: collections behind the safe block for more than 900 s: a backfill too slow, or a stuck one;
 * - indexerFailures: more than 5 failed passes in 5 minutes.
 */
export const HEALTH_LIMITS = {
  readerStaleS: 60,
  readerLagS: 120,
  readerFailures: 10,
  indexerStaleS: 120,
  indexerBehindS: 900,
  indexerFailures: 5,
} as const

/** Whole seconds from an ISO time, or from the start while there is none, to `now`. */
const secondsSince = (iso: string | null, startedAt: number, now: number) =>
  Math.floor((now - (iso === null ? startedAt : Date.parse(iso))) / 1_000)

/**
 * One sentence per threshold crossed, per chain, in the order of `HEALTH_LIMITS`. A chain with no hot collection
 * has no reader problem but its failures; an indexer that is off has none of its own.
 */
export function healthProblems(
  chains: readonly ChainHealth[],
  now: number,
  startedAt: number,
  limits: typeof HEALTH_LIMITS = HEALTH_LIMITS,
): string[] {
  return chains.flatMap((chain) => {
    const problems: string[] = []
    if (chain.hot > 0) {
      const stale = secondsSince(chain.lastGoodTickAt, startedAt, now)
      if (stale > limits.readerStaleS)
        problems.push(`${chain.name}: no good read for ${stale} s (limit ${limits.readerStaleS} s).`)
      if (chain.lagSeconds !== null && chain.lagSeconds > limits.readerLagS)
        problems.push(
          `${chain.name}: the newest block is ${chain.lagSeconds} s old (limit ${limits.readerLagS} s).`,
        )
    }
    if (chain.failedTicksRecent > limits.readerFailures)
      problems.push(
        `${chain.name}: ${chain.failedTicksRecent} failed reads in 5 minutes (limit ${limits.readerFailures}).`,
      )
    const indexer = chain.indexer
    if (indexer) {
      const stale = secondsSince(indexer.lastGoodPassAt, startedAt, now)
      if (stale > limits.indexerStaleS)
        problems.push(`${chain.name}: no good index pass for ${stale} s (limit ${limits.indexerStaleS} s).`)
      if (indexer.behindSince !== null) {
        const behind = secondsSince(indexer.behindSince, startedAt, now)
        if (behind > limits.indexerBehindS)
          problems.push(
            `${chain.name}: ${indexer.behind} collections behind for ${behind} s (limit ${limits.indexerBehindS} s).`,
          )
      }
      if (indexer.failedPassesRecent > limits.indexerFailures)
        problems.push(
          `${chain.name}: ${indexer.failedPassesRecent} failed index passes in 5 minutes (limit ${limits.indexerFailures}).`,
        )
    }
    return problems
  })
}

/** How many causes deep the log line looks, so a cause that refers back to itself cannot loop. */
```

- [ ] **Step 4: The reader, the indexer and `/health`**

In `apps/freshness/src/chain-reader.ts`, replace:

```ts
import { scanLogs, type GetLogs } from './logs.ts'
```

with:

```ts
import { scanLogs, type GetLogs } from './logs.ts'
import { recentCounter } from './recent.ts'
```

In `apps/freshness/src/chain-reader.ts`, replace:

```ts
  let logGaps = 0
```

with:

```ts
  let logGaps = 0
  /** Failed ticks and noted factory failures, for /health's 5-minute count. */
  const recentFailures = recentCounter()
```

In `apps/freshness/src/chain-reader.ts`, replace:

```ts
    failedTicks++
    lastError = errorName(error)
```

with:

```ts
    failedTicks++
    recentFailures.note(Date.now())
    lastError = errorName(error)
```

In `apps/freshness/src/chain-reader.ts`, replace:

```ts
        logGaps,
```

with:

```ts
        logGaps,
        failedTicksRecent: recentFailures.count(Date.now()),
```

In `apps/freshness/src/chain-reader.ts`, replace:

```ts
      failedTicks++
      lastError = errorName(error)
      const now = Date.now()
```

with:

```ts
      const now = Date.now()
      failedTicks++
      recentFailures.note(now)
      lastError = errorName(error)
```

In `apps/freshness/src/indexer.ts`, replace:

```ts
import { eventBlocksOf, INDEX_EVENTS, recordsOf, type IndexLog, type Records } from './indexer-records.ts'
```

with:

```ts
import { eventBlocksOf, INDEX_EVENTS, recordsOf, type IndexLog, type Records } from './indexer-records.ts'
import { recentCounter } from './recent.ts'
```

In `apps/freshness/src/indexer.ts`, replace:

```ts
  let unpaired = 0
```

with:

```ts
  let unpaired = 0
  /** Each counted failure, for /health's 5-minute count. */
  const recentFailures = recentCounter()
  /** When the last pass without a failure ended; null before one. */
  let lastGoodPassAt: number | null = null
  /** Since when some collection has been behind, set at the end of a pass that finds one; null while none is. */
  let behindSince: number | null = null
```

In `apps/freshness/src/indexer.ts`, replace:

```ts
    lastError = failureName(error)
```

with:

```ts
    recentFailures.note(Date.now())
    lastError = failureName(error)
  }

  /** The collections not read to the safe block yet, or last read there more than 300 s of chain time before the head. */
  const behindCount = () =>
    [...cursors.values()].filter(
      (cursor) =>
        cursor.syncedAt === null || (headTime !== null && headTime - cursor.syncedAt > ACTIVITY_LAG_MAX_S),
    ).length

  /**
   * The end of a pass that reached the chain: its time, its time as the last good pass when it had no failure, and
   * since when some collection has been behind (now when the count rises from 0, null at 0).
   */
  function passEnded(failure: boolean): void {
    const now = Date.now()
    lastPassAt = now
    if (!failure) lastGoodPassAt = now
    if (behindCount() === 0) behindSince = null
    else behindSince ??= now
```

In `apps/freshness/src/indexer.ts`, replace:

```ts
      lastPassAt = Date.now()
```

with:

```ts
      passEnded(true)
```

In `apps/freshness/src/indexer.ts`, replace:

```ts
    lastPassAt = Date.now()
```

with:

```ts
    passEnded(anyFailure)
```

In `apps/freshness/src/indexer.ts`, replace:

```ts
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
```

with:

```ts
      const iso = (at: number | null) => (at === null ? null : new Date(at).toISOString())
      return {
        collections: cursors.size,
        behind: behindCount(),
        block: safeBlock === null ? null : Number(safeBlock),
        lastPassAt: iso(lastPassAt),
        failedPasses,
        lastError,
        unpaired,
        failedPassesRecent: recentFailures.count(Date.now()),
        lastGoodPassAt: iso(lastGoodPassAt),
        behindSince: iso(behindSince),
```

In `apps/freshness/src/server.ts`, replace:

```ts
import { chainHealth, failureLine, type HealthBody } from './health.ts'
```

with:

```ts
import { chainHealth, failureLine, healthProblems, type HealthBody } from './health.ts'
```

In `apps/freshness/src/server.ts`, replace:

```ts
  const startedAt = new Date().toISOString()
```

with:

```ts
  const startedMs = Date.now()
  const startedAt = new Date(startedMs).toISOString()
```

In `apps/freshness/src/server.ts`, replace:

```ts
  }

  function health(): HealthBody {
```

with:

```ts
  }

  /**
   * /health: each chain's reader and indexer, the wallet windows, and `degraded` with one sentence per threshold
   * crossed (docs/specs/2026-10-17-production-hardening.md, section 8.2). Always 200.
   */
  function health(): HealthBody {
```

In `apps/freshness/src/server.ts`, replace:

```ts
    return {
      status: 'ok',
      startedAt,
      hot: hot.size(),
      chains: chains.map(({ reader, indexer }) => chainHealth(reader.health(), indexer?.health() ?? null)),
```

with:

```ts
    const entries = chains.map(({ reader, indexer }) =>
      chainHealth(reader.health(), indexer?.health() ?? null),
    )
    const problems = healthProblems(entries, Date.now(), startedMs)
    return {
      status: problems.length ? 'degraded' : 'ok',
      problems,
      startedAt,
      hot: hot.size(),
      chains: entries,
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `pnpm --filter @cobweb/freshness exec vitest run src/recent.test.ts src/health.test.ts src/chain-reader.test.ts src/indexer.test.ts src/server.test.ts`
Expected: PASS, `Tests  71 passed (71)`.

- [ ] **Step 6: Typecheck and lint the freshness server**

Run: `pnpm --filter @cobweb/freshness typecheck && pnpm --filter @cobweb/freshness lint`
Expected: PASS.

- [ ] **Step 7: The two verifies read the status**

`verify:freshness`'s check 2 and `verify:indexer`'s check 14 read `status` and `problems`, the indexer's also its last good pass, its failed passes in the window and `behindSince` (Decision 18).

In `apps/web/scripts/verify-freshness.ts`, replace:

```ts
    '2. at start: before any request, /health answers 200 with no-store, chain 31337 served with no hot collection and no block, and the switch has carried no request',
```

with:

```ts
    '2. at start: before any request, /health answers 200 with no-store and status ok with no problems, chain 31337 served with no hot collection and no block, and the switch has carried no request',
```

In `apps/web/scripts/verify-freshness.ts`, replace:

```ts
        return `${answer.status} ${answer.headers.get('cache-control')}`
```

with:

```ts
        return `${answer.status} ${answer.headers.get('cache-control')}`
      if (body.status !== 'ok' || body.problems.length) return `${body.status}: ${body.problems.join(' ')}`
```

In `apps/web/scripts/verify-indexer.ts`, replace:

```ts
    "14. health: /health reports chain 31337's indexer with every collection the database indexes there (this one among them), none behind, its block and last pass, no failed pass and nothing unpaired, its reader with no failure either, and no key, URL or host anywhere in the body",
```

with:

```ts
    "14. health: /health answers status ok with no problems and reports chain 31337's indexer with every collection the database indexes there (this one among them), none behind, its block, its last pass, its last good pass and no failed pass in the last 5 minutes, no failed pass at all and nothing unpaired, its reader with no failure either, and no key, URL or host anywhere in the body",
```

In `apps/web/scripts/verify-indexer.ts`, replace:

```ts
      const recent = indexer.lastPassAt !== null && Date.now() - Date.parse(indexer.lastPassAt) < 5_000
      if (
        indexer.collections !== cursors.data.length ||
        !recent ||
```

with:

```ts
      if (body.status !== 'ok' || body.problems.length) return `${body.status}: ${body.problems.join(' ')}`
      const within = (at: string | null) => at !== null && Date.now() - Date.parse(at) < 5_000
      if (
        indexer.collections !== cursors.data.length ||
        !within(indexer.lastPassAt) ||
        !within(indexer.lastGoodPassAt) ||
        indexer.failedPassesRecent !== 0 ||
        indexer.behindSince !== null ||
```

Run: `pnpm --filter @cobweb/web verify:freshness`
Expected: PASS, `16 passed, 0 failed`.

Run: `pnpm --filter @cobweb/web verify:indexer`
Expected: PASS, `15 passed, 0 failed`.

- [ ] **Step 8: Format, run the root checks and commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
pnpm exec prettier --write apps/freshness/src/recent.ts apps/freshness/src/recent.test.ts apps/freshness/src/health.ts apps/freshness/src/health.test.ts apps/freshness/src/chain-reader.ts apps/freshness/src/chain-reader.test.ts apps/freshness/src/indexer.ts apps/freshness/src/indexer.test.ts apps/freshness/src/server.ts apps/freshness/src/server.test.ts apps/web/scripts/verify-freshness.ts apps/web/scripts/verify-indexer.ts
pnpm typecheck && pnpm lint && pnpm test
git add apps/freshness/src/recent.ts apps/freshness/src/recent.test.ts apps/freshness/src/health.ts apps/freshness/src/health.test.ts apps/freshness/src/chain-reader.ts apps/freshness/src/chain-reader.test.ts apps/freshness/src/indexer.ts apps/freshness/src/indexer.test.ts apps/freshness/src/server.ts apps/freshness/src/server.test.ts apps/web/scripts/verify-freshness.ts apps/web/scripts/verify-indexer.ts
git commit -m "$(cat <<'EOF'
Answer degraded on /health with one sentence per documented threshold crossed, counting the reader's and the indexer's failures over the last 5 minutes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: freshness 216 tests in 18 files; the other packages unchanged.

---

### Task 9: `record_upload` behind the service role, and the daily upload sweep

**Kind:** integration: a migration that changes how every script records an upload, beside a cron over two buckets: an Opus implementer.

**Files:**

- Create: `supabase/migrations/20261017110000_upload_hardening.sql`, `apps/web/src/lib/storage/upload-sweep-deps.ts`, `apps/web/src/app/api/cron/upload-sweep/route.ts`, `apps/web/src/lib/storage/upload-sweep-route.test.ts`
- Modify: `apps/web/src/lib/database.types.ts`, `apps/web/src/lib/art/owned.ts`, `apps/web/src/app/actions/uploads.ts`, `apps/web/src/lib/supabase/service.ts` (its callers), `apps/web/src/lib/storage/objects.ts`, `apps/web/src/lib/storage/sweep.ts` and its test, `apps/web/src/lib/mint/media.ts` and its test, `apps/web/vercel.json`, `apps/web/src/lib/render/vercel-config.test.ts`, the scripts that record uploads (`deploy-fixture.ts`, `verify-chain.ts`, `verify-deploy.ts`, `verify-render.ts`, `verify-storage.ts`, `verify-local.ts`), `apps/web/scripts/verify-sweep.ts`, `apps/web/package.json` (`verify:sweep`)
- Test: the four test files; `verify:local`, `verify:sweep`, and the five verifies whose record calls change

**Interfaces:**

- Consumes: `record_upload`'s current body (`20261008020000`), `ownedUnlocked`, `confirmUpload`'s HEAD, `createServiceClient`; `sweepOrphans`, `SweepDeps` and `listObjectPages`; `mediaBucket` and the `mint_pages` row (`banner_key`, `avatar_key`, `about_banner_key`, `sections`); `cronAuthorized`, `consoleLog` and `errorSummary`.
- Produces:
  - `public.record_upload(p_owner_id uuid, p_collection_id uuid, ...)`, security definer, executed by the service role alone, recording for the collection's owner only (Decision 20); `ownedUnlocked` answering `userId`; `confirmUpload` recording through the service client after `ownedUnlocked`
  - `verify:local`'s section 9q, one check: "uploads: record_upload runs for the service role alone and for the collection's owner only: the owner's own call and anon's are refused, as is the service role's for another owner" (405)
  - `listObjectPages(prefix, { bucket? })`; `MintPageMediaRow`, `mediaKeysOf(row): string[]`; `UPLOAD_SWEEP_MIN_AGE_MS = 86_400_000`, `uploadSweepDryRun(env)`, `SweepCounts`, `UploadSweepReport`, `sweepUploads({ art, media }, { dryRun, now, log? })`; `uploadSweepDeps(): { art: SweepDeps; media: SweepDeps }`
  - `GET /api/cron/upload-sweep` (`maxDuration = 800`), daily at 07:00 UTC in `vercel.json` (Decision 21); `verify:sweep` under the TypeScript resolver, with two checks of the cron's ports (10)

- [ ] **Step 1: Write the failing checks and tests**

`verify:local` records its uploads through the service role for each collection's owner and gains section 9q; the sweeps' tests cover the media keys, the two buckets' report and the cron.

In `apps/web/scripts/verify-local.ts`, replace:

```ts
const createdUserIds = new Set<string>()
```

with:

```ts
const createdUserIds = new Set<string>()
/** Each signed-in creator's user id by its client: the upload action records a file for the owner it checked. */
const ownerOf = new Map<SupabaseClient, string>()
```

In `apps/web/scripts/verify-local.ts`, replace:

```ts
  if (error || !user) throw new Error(`sign-in failed: ${error?.message ?? 'no user'}`)
```

with:

```ts
  if (error || !user) throw new Error(`sign-in failed: ${error?.message ?? 'no user'}`)
  ownerOf.set(client, user.id)
```

In `apps/web/scripts/verify-local.ts`, replace:

```ts
/** Records an upload through the RPC, as the upload server action will; returns the new row id. */
```

with:

```ts
/**
 * Records an upload through the RPC as the upload server action does: through the service role, for the
 * client's creator as its owner (docs/specs/2026-10-17-production-hardening.md, section 14, point 8); returns the
 * new row id.
 */
```

In `apps/web/scripts/verify-local.ts`, replace:

```ts
  const { data, error } = await client.rpc('record_upload', {
```

with:

```ts
  const { data, error } = await admin.rpc('record_upload', {
    p_owner_id: ownerOf.get(client) ?? null,
```

In `apps/web/scripts/verify-local.ts`, replace:

```ts
  await artHardening()
```

with:

```ts
  await artHardening()
  await artUploadHardening(A)
```

In `apps/web/scripts/verify-local.ts`, replace:

```ts
// ---------------------------------------------------------------------------------------------
// 10. Cleanup
```

with:

```ts
// ---------------------------------------------------------------------------------------------
// 9q. Hardening owed by earlier phases: record_upload for the service role alone, which the upload action calls
// for the owner it checked, with the size it read from storage (docs/specs/2026-10-17-production-hardening.md,
// section 14, point 8)
// ---------------------------------------------------------------------------------------------
async function artUploadHardening(A: Creator): Promise<void> {
  const E = await signInCreator()
  const col = await insertCollection(E.client)
  if (!col.row) throw new Error(`setup: ${describe(col.error)}`)
  const cid = col.row.id
  await check(
    "uploads: record_upload runs for the service role alone and for the collection's owner only: the owner's own call and anon's are refused, as is the service role's for another owner",
    async () => {
      const input = uploadInput(cid)
      const args = {
        p_owner_id: E.userId,
        p_collection_id: cid,
        p_kind: input.kind,
        p_storage_key: input.storage_key,
        p_content_hash: input.content_hash,
        p_mime: input.mime,
        p_media_type: input.media_type,
        p_bytes: input.bytes,
        p_width: input.width,
        p_height: input.height,
        p_file_name: input.file_name,
      }
      const refused = refusedAll([
        ['owner', (await callArt(E.client, 'record_upload', args)).error, PERMISSION, 'permission denied'],
        ['anon', (await callArt(anon, 'record_upload', args)).error, PERMISSION, 'permission denied'],
        [
          'another owner',
          (await callArt(admin, 'record_upload', { ...args, p_owner_id: A.userId })).error,
          PERMISSION,
          'collection not found',
        ],
      ])
      if (refused) return refused
      if ((await countRows('uploads', 'collection_id', cid)) !== 0) return 'a refused call wrote a row'
      const recorded = await callArt(admin, 'record_upload', args)
      if (recorded.error || typeof recorded.data !== 'string')
        return `the owner's record: ${describe(recorded.error)}`
      const { data } = await admin.from('uploads').select('bytes').eq('id', recorded.data).single()
      return data?.bytes === input.bytes ? null : `recorded ${data?.bytes} bytes`
    },
  )
}

// ---------------------------------------------------------------------------------------------
// 10. Cleanup
```

In `apps/web/src/lib/mint/media.test.ts`, replace:

```ts
import { keyBelongs, mimeOfKey, mintPageKey, mintPageMediaProblem, type MediaSlot } from './media'
```

with:

```ts
import {
  keyBelongs,
  mediaKeysOf,
  mimeOfKey,
  mintPageKey,
  mintPageMediaProblem,
  type MediaSlot,
} from './media'
```

In `apps/web/src/lib/mint/media.test.ts`, replace:

```ts
    expect(mimeOfKey(`${COLLECTION}/${HASH}.svg`)).toBeNull()
  })
})
```

with:

```ts
    expect(mimeOfKey(`${COLLECTION}/${HASH}.svg`)).toBeNull()
  })
})

describe('mediaKeysOf (docs/specs/2026-10-17-production-hardening.md, section 14, point 8)', () => {
  const key = (n: number, extension = 'png') =>
    `${COLLECTION}/${n.toString(16).padStart(64, '0')}.${extension}`

  it("names a page's three images, its team's photos, its carousel's uploads and its music", () => {
    const sections = {
      team: { enabled: true, members: [{ imageKey: key(4) }, { imageKey: null }, { imageKey: key(5) }] },
      carousel: {
        enabled: true,
        items: [
          { kind: 'upload', key: key(6, 'mp4') },
          { kind: 'token', tokenId: 3 },
        ],
      },
      music: { enabled: false, key: key(7, 'mp3'), fileName: 'theme.mp3' },
      roadmap: { enabled: true, items: [] },
    }
    expect(mediaKeysOf({ banner_key: key(1), avatar_key: null, about_banner_key: key(3), sections })).toEqual(
      [key(1), key(3), key(4), key(5), key(6, 'mp4'), key(7, 'mp3')],
    )
  })

  it('names nothing for an empty page or sections of another shape', () => {
    const empty = { banner_key: null, avatar_key: null, about_banner_key: null }
    for (const sections of [{}, null, 'x', { team: { members: 'x' } }, { carousel: { items: [null] } }])
      expect(mediaKeysOf({ ...empty, sections })).toEqual([])
  })
})
```

In `apps/web/src/lib/storage/sweep.test.ts`, replace:

```ts
import { parseSweepArgs, sweepOrphans, type StoredObject, type SweepDeps } from './sweep'
```

with:

```ts
import {
  parseSweepArgs,
  sweepOrphans,
  sweepUploads,
  UPLOAD_SWEEP_MIN_AGE_MS,
  uploadSweepDryRun,
  type StoredObject,
  type SweepDeps,
} from './sweep'
```

In `apps/web/src/lib/storage/sweep.test.ts`, replace:

```ts
    expect(() => parseSweepArgs(['--everything'])).toThrow('Unknown option: --everything')
  })
})
```

with:

```ts
    expect(() => parseSweepArgs(['--everything'])).toThrow('Unknown option: --everything')
  })
})

describe('sweepUploads (docs/specs/2026-10-17-production-hardening.md, section 14, point 8)', () => {
  it('sweeps the art bucket and the mint page files over a day old, one line each, counting and naming no key', async () => {
    const art = fake(pages, ['c1/assets/a.png'])
    const media = fake(
      [[object('c1/ab.png', 30), object('c1/cd.png', 30), object('c1/ef.png', 3)]],
      ['c1/ab.png'],
    )
    const lines: string[] = []
    const report = await sweepUploads(
      { art: art.deps, media: media.deps },
      { dryRun: false, now: NOW, log: (line) => lines.push(line) },
    )
    expect(report).toEqual({
      dryRun: false,
      art: { listed: 4, old: 3, orphaned: 2, deleted: 2 },
      media: { listed: 3, old: 2, orphaned: 1, deleted: 1 },
    })
    expect(art.removed).toEqual([['c1/assets/b.png'], ['c2/layers/d.png']])
    expect(media.removed).toEqual([['c1/cd.png']])
    expect([art.prefixes, media.prefixes]).toEqual([[''], ['']])
    expect(lines).toEqual([
      'Upload sweep: deleted 2 unrecorded art files over a day old, of 4 listed.',
      'Upload sweep: deleted 1 mint page files no page names over a day old, of 3 listed.',
    ])
    expect(UPLOAD_SWEEP_MIN_AGE_MS).toBe(24 * HOUR)
  })

  it('runs dry unless UPLOAD_SWEEP_DELETE is 1, deleting nothing', async () => {
    expect([{}, { UPLOAD_SWEEP_DELETE: 'yes' }].map(uploadSweepDryRun)).toEqual([true, true])
    expect(uploadSweepDryRun({ UPLOAD_SWEEP_DELETE: '1' })).toBe(false)
    const art = fake(pages, [])
    const media = fake([], [])
    const lines: string[] = []
    const report = await sweepUploads(
      { art: art.deps, media: media.deps },
      { dryRun: true, now: NOW, log: (line) => lines.push(line) },
    )
    expect(report.art).toEqual({ listed: 4, old: 3, orphaned: 3, deleted: 0 })
    expect(art.removed).toEqual([])
    expect(lines[0]).toBe(
      'Upload sweep (dry run): 3 unrecorded art files over a day old would be deleted, of 4 listed; nothing was deleted.',
    )
  })
})
```

Create `apps/web/src/lib/storage/upload-sweep-route.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/cron/upload-sweep/route'

const mocks = vi.hoisted(() => ({
  sweepUploads: vi.fn<(deps: unknown, options: { dryRun: boolean; now: number }) => Promise<unknown>>(),
  uploadSweepDeps: vi.fn<() => unknown>(() => ({ ports: 'uploads' })),
  log: vi.fn<(event: string, fields?: Record<string, unknown>) => void>(),
}))
vi.mock('@cobweb/worker', () => ({
  consoleLog: mocks.log,
  errorSummary: (error: unknown) => `${(error as Error).name}: [masked]`,
}))
vi.mock('@/lib/storage/sweep', async (original) => ({
  ...(await original<typeof import('@/lib/storage/sweep')>()),
  sweepUploads: mocks.sweepUploads,
}))
vi.mock('@/lib/storage/upload-sweep-deps', () => ({ uploadSweepDeps: mocks.uploadSweepDeps }))

const SECRET = 'cron-secret-value'
const request = (authorization?: string) =>
  new Request('https://cobweb.test/api/cron/upload-sweep', {
    headers: authorization === undefined ? {} : { authorization },
  })
const COUNTS = { listed: 4, old: 3, orphaned: 1, deleted: 0 }
const REPORT = { dryRun: true, art: COUNTS, media: COUNTS }

describe('GET /api/cron/upload-sweep (docs/specs/2026-10-17-production-hardening.md, section 14, point 8)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 1_000_000 })
    vi.stubEnv('CRON_SECRET', SECRET)
    mocks.sweepUploads.mockReset()
    mocks.log.mockReset()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.useRealTimers()
  })

  it('answers 404 and does not sweep without the secret', async () => {
    for (const header of [undefined, 'Bearer other-secret-value', SECRET])
      expect((await GET(request(header))).status).toBe(404)
    expect(mocks.sweepUploads).not.toHaveBeenCalled()
  })

  it('sweeps dry until UPLOAD_SWEEP_DELETE is 1, and answers the counts', async () => {
    mocks.sweepUploads.mockResolvedValue(REPORT)
    const response = await GET(request(`Bearer ${SECRET}`))
    expect([response.status, await response.json()]).toEqual([200, REPORT])
    expect(mocks.sweepUploads).toHaveBeenLastCalledWith(
      { ports: 'uploads' },
      { dryRun: true, now: 1_000_000 },
    )
    vi.stubEnv('UPLOAD_SWEEP_DELETE', '1')
    await GET(request(`Bearer ${SECRET}`))
    expect(mocks.sweepUploads).toHaveBeenLastCalledWith(
      { ports: 'uploads' },
      { dryRun: false, now: 1_000_000 },
    )
  })

  it('answers 500 with an empty body and logs the masked error when the sweep throws', async () => {
    mocks.sweepUploads.mockRejectedValue(new Error('https://storage.example/?key=abc'))
    const response = await GET(request(`Bearer ${SECRET}`))
    expect([response.status, await response.text()]).toEqual([500, ''])
    expect(mocks.log).toHaveBeenCalledWith('upload sweep failed', { error: 'Error: [masked]' })
  })
})
```

In `apps/web/src/lib/render/vercel-config.test.ts`, replace:

```ts
const SOURCE_SWEEP = 'src/app/api/cron/source-sweep/route.ts'
```

with:

```ts
const SOURCE_SWEEP = 'src/app/api/cron/source-sweep/route.ts'
const UPLOAD_SWEEP = 'src/app/api/cron/upload-sweep/route.ts'
```

In `apps/web/src/lib/render/vercel-config.test.ts`, replace:

```ts
  it('runs the render sweep every 15 minutes and the source sweep daily, on routes that exist', () => {
    expect(config.crons).toEqual([
      { path: '/api/cron/render-sweep', schedule: '*/15 * * * *' },
      { path: '/api/cron/source-sweep', schedule: '30 7 * * *' },
```

with:

```ts
  it('runs the render sweep every 15 minutes and the source and upload sweeps daily, on routes that exist', () => {
    expect(config.crons).toEqual([
      { path: '/api/cron/render-sweep', schedule: '*/15 * * * *' },
      { path: '/api/cron/source-sweep', schedule: '30 7 * * *' },
      { path: '/api/cron/upload-sweep', schedule: '0 7 * * *' },
```

In `apps/web/src/lib/render/vercel-config.test.ts`, replace:

```ts
    expect(readFileSync(app(SOURCE_SWEEP), 'utf8')).toContain('export const maxDuration = 300')
```

with:

```ts
    expect(readFileSync(app(SOURCE_SWEEP), 'utf8')).toContain('export const maxDuration = 300')
    expect(readFileSync(app(UPLOAD_SWEEP), 'utf8')).toContain('export const maxDuration = 800')
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @cobweb/web verify:local`
Expected: FAIL. Before the migration no `record_upload` takes an owner, so the uploads' checks fail and the run stops at their setup: `PGRST202 Could not find the function public.record_upload`, `FAIL run: upload setup` and `106 passed, 8 failed`.

Run: `pnpm --filter @cobweb/web exec vitest run src/lib/mint/media.test.ts src/lib/storage/sweep.test.ts src/lib/storage/upload-sweep-route.test.ts src/lib/render/vercel-config.test.ts`
Expected: FAIL: `mediaKeysOf is not a function`, `sweepUploads is not a function`, `Cannot find package '@/app/api/cron/upload-sweep/route'` and `Test Files  4 failed (4)`.

- [ ] **Step 3: The migration**

The old two-argument function is dropped, the new one takes the owner first and is executed by the service role alone (spec section 14, point 8).

Create `supabase/migrations/20261017110000_upload_hardening.sql`:

```sql
-- Hardening owed by earlier phases (docs/specs/2026-10-17-production-hardening.md, section 14, point 8, ruled into
-- this plan's last code task): record_upload runs for the service role alone, so the size and type a row records
-- are the ones the upload action read from the stored object (HEAD) after it checked the session and the
-- ownership, never a caller's word. A creator's session could call it directly before, and record a small size for
-- a large object, past the project's 5 GB cap and the batch size the lock plans from. The owner the server checked
-- is passed in; the function locks the collection as that owner's, as it locked the caller's before.
drop function public.record_upload(
  uuid, public.upload_kind, text, text, text, public.media_type, bigint, integer, integer, text
);

create function public.record_upload(
  p_owner_id uuid,
  p_collection_id uuid,
  p_kind public.upload_kind,
  p_storage_key text,
  p_content_hash text,
  p_mime text,
  p_media_type public.media_type,
  p_bytes bigint,
  p_width integer,
  p_height integer,
  p_file_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_locked timestamptz;
  v_cw integer;
  v_ch integer;
  v_used bigint;
  v_id uuid;
begin
  if p_owner_id is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select c.owner_id, c.art_locked_at, c.canvas_width, c.canvas_height
  into v_owner, v_locked, v_cw, v_ch
  from public.collections c where c.id = p_collection_id and c.owner_id = p_owner_id for update;
  -- Only the owner's own row is ever locked; the owner test is in the select above.
  if v_owner is null then
    raise exception 'collection not found' using errcode = '42501';
  end if;
  if v_locked is not null then
    raise exception 'The art is locked and cannot change.' using errcode = '42501';
  end if;
  -- The column's check gives the key its shape; this pins the prefix to the owner's collection.
  if p_storage_key is null or split_part(p_storage_key, '/', 1) <> p_collection_id::text then
    raise exception 'The storage key must be under the collection''s own prefix.' using errcode = '23514';
  end if;

  -- A duplicate is reported before the cap, so a second tab at the cap reuses the file.
  if exists (
    select 1 from public.uploads u
    where u.collection_id = p_collection_id and u.content_hash = p_content_hash and u.kind = p_kind
  ) then
    raise unique_violation using message = 'This file is already in the project.';
  end if;

  select coalesce(sum(u.bytes), 0) into v_used from public.uploads u where u.collection_id = p_collection_id;
  if v_used + p_bytes > 5368709120 then
    raise exception 'This project has reached its 5 GB of files. Delete some files to upload more.'
      using errcode = '23514';
  end if;

  -- With no layer images left the canvas is unset, so deleting the last one frees it.
  if v_cw is not null and not exists (
    select 1 from public.uploads u where u.collection_id = p_collection_id and u.kind = 'layer_image'
  ) then
    v_cw := null;
    v_ch := null;
  end if;

  if p_kind = 'layer_image' then
    if v_cw is null then
      update public.collections set canvas_width = p_width, canvas_height = p_height
      where id = p_collection_id;
    elsif p_width is distinct from v_cw or p_height is distinct from v_ch then
      raise exception 'Every layer image must be % x % in this project.', v_cw, v_ch
        using errcode = '23514';
    end if;
  end if;

  insert into public.uploads (collection_id, kind, storage_key, content_hash, mime, media_type, bytes, width, height, file_name)
  values (p_collection_id, p_kind, p_storage_key, p_content_hash, p_mime, p_media_type, p_bytes, p_width, p_height, p_file_name)
  returning id into v_id;
  return v_id;
end;
$$;

comment on function public.record_upload(
  uuid, uuid, public.upload_kind, text, text, text, public.media_type, bigint, integer, integer, text
) is
  'Records an upload for its owner''s collection, for the service role only: the upload action calls it after it checked the session, the ownership and the stored object''s size and type. Enforces the prefix, the 5 GB cap and the shared canvas under the collection''s lock.';

revoke all on function public.record_upload(
  uuid, uuid, public.upload_kind, text, text, text, public.media_type, bigint, integer, integer, text
) from public, anon, authenticated;
grant execute on function public.record_upload(
  uuid, uuid, public.upload_kind, text, text, text, public.media_type, bigint, integer, integer, text
) to service_role;
```

Run: `supabase migration up --local`
Expected: PASS, `Applying migration 20261017110000_upload_hardening.sql...`.

Should the migration have to be undone on the local database, this SQL gives `record_upload` back its earlier body and grants; pipe it to `docker exec -i supabase_db_cobweb psql -U postgres -v ON_ERROR_STOP=1` from the repo root, then apply the migration again.

```sql
begin;
drop function public.record_upload(
  uuid, uuid, public.upload_kind, text, text, text, public.media_type, bigint, integer, integer, text
);
create function public.record_upload(
  p_collection_id uuid,
  p_kind public.upload_kind,
  p_storage_key text,
  p_content_hash text,
  p_mime text,
  p_media_type public.media_type,
  p_bytes bigint,
  p_width integer,
  p_height integer,
  p_file_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_owner uuid;
  v_locked timestamptz;
  v_cw integer;
  v_ch integer;
  v_used bigint;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select c.owner_id, c.art_locked_at, c.canvas_width, c.canvas_height
  into v_owner, v_locked, v_cw, v_ch
  from public.collections c where c.id = p_collection_id and c.owner_id = v_uid for update;
  -- Only the caller's own row is ever locked; the owner test is in the select above.
  if v_owner is null then
    raise exception 'collection not found' using errcode = '42501';
  end if;
  if v_locked is not null then
    raise exception 'The art is locked and cannot change.' using errcode = '42501';
  end if;
  -- The column's check gives the key its shape; this pins the prefix to the caller's collection.
  if p_storage_key is null or split_part(p_storage_key, '/', 1) <> p_collection_id::text then
    raise exception 'The storage key must be under the collection''s own prefix.' using errcode = '23514';
  end if;

  -- A duplicate is reported before the cap, so a second tab at the cap reuses the file.
  if exists (
    select 1 from public.uploads u
    where u.collection_id = p_collection_id and u.content_hash = p_content_hash and u.kind = p_kind
  ) then
    raise unique_violation using message = 'This file is already in the project.';
  end if;

  select coalesce(sum(u.bytes), 0) into v_used from public.uploads u where u.collection_id = p_collection_id;
  if v_used + p_bytes > 5368709120 then
    raise exception 'This project has reached its 5 GB of files. Delete some files to upload more.'
      using errcode = '23514';
  end if;

  -- With no layer images left the canvas is unset, so deleting the last one frees it.
  if v_cw is not null and not exists (
    select 1 from public.uploads u where u.collection_id = p_collection_id and u.kind = 'layer_image'
  ) then
    v_cw := null;
    v_ch := null;
  end if;

  if p_kind = 'layer_image' then
    if v_cw is null then
      update public.collections set canvas_width = p_width, canvas_height = p_height
      where id = p_collection_id;
    elsif p_width is distinct from v_cw or p_height is distinct from v_ch then
      raise exception 'Every layer image must be % x % in this project.', v_cw, v_ch
        using errcode = '23514';
    end if;
  end if;

  insert into public.uploads (collection_id, kind, storage_key, content_hash, mime, media_type, bytes, width, height, file_name)
  values (p_collection_id, p_kind, p_storage_key, p_content_hash, p_mime, p_media_type, p_bytes, p_width, p_height, p_file_name)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.record_upload(uuid, public.upload_kind, text, text, text, public.media_type, bigint, integer, integer, text)
  from public, anon;
grant execute on function public.record_upload(uuid, public.upload_kind, text, text, text, public.media_type, bigint, integer, integer, text)
  to authenticated;
delete from supabase_migrations.schema_migrations where version = '20261017110000';
commit;
```

- [ ] **Step 4: The types and the upload action**

In `apps/web/src/lib/database.types.ts`, replace:

```ts
          p_mime: string
```

with:

```ts
          p_mime: string
          p_owner_id: string
```

In `apps/web/src/lib/art/owned.ts`, replace:

```ts
  { error: string } | { error?: undefined; supabase: ArtClient; canvas: Canvas; collection: OwnedCollection }
```

with:

```ts
  | { error: string }
  | { error?: undefined; supabase: ArtClient; canvas: Canvas; collection: OwnedCollection; userId: string }
```

In `apps/web/src/lib/art/owned.ts`, replace:

```ts
 * The collection, only if the signed-in creator owns it and its art is not locked. The session is
 * confirmed with the auth server, the row is read under row-level security, and the explicit owner
 * test is a second line of defence. The database checks both again on every write.
```

with:

```ts
 * The collection, only if the signed-in creator owns it and its art is not locked, with the creator's
 * id. The session is confirmed with the auth server, the row is read under row-level security, and the
 * explicit owner test is a second line of defence. The database checks both again on every write.
```

In `apps/web/src/lib/art/owned.ts`, replace:

```ts
  return { supabase, canvas, collection }
```

with:

```ts
  return { supabase, canvas, collection, userId: user.id }
```

In `apps/web/src/app/actions/uploads.ts`, replace:

```ts
import { createClient } from '@/lib/supabase/server'
```

with:

```ts
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
```

In `apps/web/src/app/actions/uploads.ts`, replace:

```ts
 * this creator's own project. A row is written only through `record_upload`, which also enforces
 * the 5 GB cap and the shared canvas size under the collection's row lock.
```

with:

```ts
 * this creator's own project. A row is written only through `record_upload`, which runs for the
 * service role alone, so the size it records is the one read here, never a caller's word
 * (docs/specs/2026-10-17-production-hardening.md, section 14, point 8); it takes the owner this
 * action checked, and enforces the 5 GB cap and the shared canvas size under the collection's row lock.
```

In `apps/web/src/app/actions/uploads.ts`, replace:

```ts
  if (ctx.error !== undefined) return { error: ctx.error }
  const { supabase, canvas } = ctx
  const problem = admissionProblem(input.kind, input, canvas)
```

with:

```ts
  if (ctx.error !== undefined) return { error: ctx.error }
  const { supabase, canvas, userId } = ctx
  const problem = admissionProblem(input.kind, input, canvas)
```

In `apps/web/src/app/actions/uploads.ts`, replace:

```ts
  if (cap) return { error: cap }

  const record = (
```

with:

```ts
  if (cap) return { error: cap }

  const service = createServiceClient()
  const record = (
```

In `apps/web/src/app/actions/uploads.ts`, replace:

```ts
    supabase.rpc('record_upload', {
```

with:

```ts
    service.rpc('record_upload', {
      p_owner_id: userId,
```

In `apps/web/src/lib/supabase/service.ts`, replace:

```ts
 * section 7.2).
```

with:

```ts
 * section 7.2); `confirmUpload` (app/actions/uploads.ts) calls `record_upload` with it for the owner it
 * checked, with the size it read from storage; and the daily upload sweep's port
 * (lib/storage/upload-sweep-deps.ts) reads which keys are recorded or saved.
```

- [ ] **Step 5: The scripts that record uploads**

Each records through the service role for the collection's owner, which it reads where it did not hold it (Decision 20).

In `apps/web/scripts/deploy-fixture.ts`, replace:

```ts
    })
    .select('id')
```

with:

```ts
    })
    .select('id, owner_id')
```

In `apps/web/scripts/deploy-fixture.ts`, replace:

```ts
      const upload = await client.rpc('record_upload', {
```

with:

```ts
      // As the upload action records it: through the service role, for the collection's owner.
      const upload = await admin.rpc('record_upload', {
        p_owner_id: col.owner_id,
```

In `apps/web/scripts/verify-chain.ts`, replace:

```ts
    .insert({ name: `Chain check ${Date.now()} ${++fileCount}`, symbol: 'CHK', project_type: 'generative' })
    .select('id')
```

with:

```ts
    .insert({ name: `Chain check ${Date.now()} ${++fileCount}`, symbol: 'CHK', project_type: 'generative' })
    .select('id, owner_id')
```

In `apps/web/scripts/verify-chain.ts`, replace:

```ts
      const upload = await client.rpc('record_upload', {
```

with:

```ts
      // As the upload action records it: through the service role, for the collection's owner.
      const upload = await admin.rpc('record_upload', {
        p_owner_id: col.owner_id,
```

In `apps/web/scripts/verify-deploy.ts`, replace:

```ts
import {
```

with:

```ts
import {
  admin,
```

In `apps/web/scripts/verify-deploy.ts`, replace:

```ts
      const upload = await client.rpc('record_upload', {
```

with:

```ts
      // As the upload action records it: through the service role, for the collection's owner.
      const upload = await admin.rpc('record_upload', {
        p_owner_id: userId,
```

In `apps/web/scripts/verify-render.ts`, replace:

```ts
/** Stores a drawn PNG in the art bucket under an upload key and records it as the creator would. */
```

with:

```ts
/**
 * Stores a drawn PNG in the art bucket under an upload key and records it as the upload action does: through the
 * service role, for the collection's owner as the creator's session reads it.
 */
```

In `apps/web/scripts/verify-render.ts`, replace:

```ts
  const recorded = await client.rpc('record_upload', {
```

with:

```ts
  const owned = await client.from('collections').select('owner_id').eq('id', cid).single()
  if (owned.error) throw new Error(`owner: ${owned.error.message}`)
  const recorded = await admin.rpc('record_upload', {
    p_owner_id: owned.data.owner_id,
```

In `apps/web/scripts/verify-storage.ts`, replace:

```ts
// Rows: record_upload as the actions call it, the duplicate that the action turns into reuse, and
// the project cap, with a throwaway wallet that is deleted at the end.
```

with:

```ts
// Rows: record_upload as the actions call it (through the service role, for the owner), the duplicate that
// the action turns into reuse, and the project cap, with a throwaway wallet that is deleted at the end.
```

In `apps/web/scripts/verify-storage.ts`, replace:

```ts
const recordInput = (cid: string, storage_key: string) => ({
```

with:

```ts
// As the upload action records a file: through the service role, for the collection's owner.
const recordInput = (cid: string, storage_key: string) => ({
  p_owner_id: userId as string,
```

In `apps/web/scripts/verify-storage.ts`, replace:

```ts
  const { data, error } = await creator.rpc('record_upload', recordInput(collectionId, recorded))
```

with:

```ts
  const { data, error } = await admin.rpc('record_upload', recordInput(collectionId, recorded))
```

In `apps/web/scripts/verify-storage.ts`, replace:

```ts
    const { error } = await creator.rpc('record_upload', recordInput(collectionId, recorded))
```

with:

```ts
    const { error } = await admin.rpc('record_upload', recordInput(collectionId, recorded))
```

In `apps/web/scripts/verify-storage.ts`, replace:

```ts
  const { error } = await creator.rpc('record_upload', {
```

with:

```ts
  const { error } = await admin.rpc('record_upload', {
```

In `apps/web/scripts/verify-storage.ts`, replace:

```ts
  const { data, error } = await creator.rpc('record_upload', {
```

with:

```ts
  const { data, error } = await admin.rpc('record_upload', {
```

In `apps/web/scripts/verify-storage.ts`, replace:

```ts
  const { error: refused } = await creator.rpc('record_upload', {
```

with:

```ts
  const { error: refused } = await admin.rpc('record_upload', {
```

- [ ] **Step 6: Run `verify:local` to see it pass**

Run: `pnpm --filter @cobweb/web verify:local`
Expected: PASS, `405 passed, 0 failed`.

- [ ] **Step 7: The upload sweep and its cron**

In `apps/web/src/lib/storage/objects.ts`, replace:

```ts
/** The bucket's objects under a prefix with their last-modified time, a page of up to 1,000 at a time. */
export async function* listObjectPages(
  prefix: string,
): AsyncGenerator<{ key: string; lastModified: Date }[]> {
  const { bucket } = storageConfig()
```

with:

```ts
/**
 * The objects under a prefix with their last-modified time, a page of up to 1,000 at a time, on the art bucket
 * unless another is named.
 */
export async function* listObjectPages(
  prefix: string,
  options: { bucket?: string } = {},
): AsyncGenerator<{ key: string; lastModified: Date }[]> {
  const bucket = options.bucket ?? storageConfig().bucket
```

In `apps/web/src/lib/mint/media.ts`, replace:

```ts
  return Object.keys(EXTENSION).find((type) => EXTENSION[type] === extension) ?? null
}
```

with:

```ts
  return Object.keys(EXTENSION).find((type) => EXTENSION[type] === extension) ?? null
}

/** The media a mint page's row names, as `mint_pages` stores them. */
export type MintPageMediaRow = {
  banner_key: string | null
  avatar_key: string | null
  about_banner_key: string | null
  sections: unknown
}

/**
 * Every key a mint page's row names in the mint-page bucket: its three images, its team's photos, its carousel's
 * uploads and its music. The upload sweep keeps these and deletes the collection's other files once a day old
 * (docs/specs/2026-10-17-production-hardening.md, section 14, point 8).
 */
export function mediaKeysOf(row: MintPageMediaRow): string[] {
  const sections = (row.sections ?? {}) as {
    team?: { members?: { imageKey?: unknown }[] }
    carousel?: { items?: { key?: unknown }[] }
    music?: { key?: unknown }
  }
  const listed = <T>(items: T[] | undefined) => (Array.isArray(items) ? items : [])
  return [
    row.banner_key,
    row.avatar_key,
    row.about_banner_key,
    ...listed(sections.team?.members).map((member) => member?.imageKey),
    ...listed(sections.carousel?.items).map((item) => item?.key),
    sections.music?.key,
  ].filter((key): key is string => typeof key === 'string' && key.length > 0)
}
```

In `apps/web/src/lib/storage/sweep.ts`, replace:

```ts
 * so these would take storage for good. Pure: the script wires S3 and the service role in.
```

with:

```ts
 * so these would take storage for good. The same core sweeps the mint page's files no page names. Pure:
 * the script and the daily cron wire S3 and the service role in.
```

In `apps/web/src/lib/storage/sweep.ts`, replace:

```ts
}

export type SweepArgs = { dryRun: boolean; allowRemote: boolean; minAgeHours: number; prefix: string }
```

with:

```ts
}

/** A day: an object this young may be between its PUT and its record, or its page's save. */
export const UPLOAD_SWEEP_MIN_AGE_MS = 86_400_000

/** True unless UPLOAD_SWEEP_DELETE is 1: the daily upload sweep logs what it would delete and deletes nothing. */
export function uploadSweepDryRun(env: Record<string, string | undefined>): boolean {
  return env.UPLOAD_SWEEP_DELETE !== '1'
}

export type SweepCounts = { listed: number; old: number; orphaned: number; deleted: number }
export type UploadSweepReport = { dryRun: boolean; art: SweepCounts; media: SweepCounts }

/**
 * The daily upload sweep (docs/specs/2026-10-17-production-hardening.md, section 14, point 8): the art bucket's
 * objects no `uploads` row records, and the mint-page bucket's files no page names, each over a day old. One line
 * per bucket; the report counts, and names no key.
 */
export async function sweepUploads(
  deps: { art: SweepDeps; media: SweepDeps },
  options: { dryRun: boolean; now: number; log?: (line: string) => void },
): Promise<UploadSweepReport> {
  const log = options.log ?? ((line: string) => console.log(line))
  const swept = async (port: SweepDeps, what: string): Promise<SweepCounts> => {
    const report = await sweepOrphans(port, {
      prefix: '',
      minAgeMs: UPLOAD_SWEEP_MIN_AGE_MS,
      now: options.now,
      dryRun: options.dryRun,
    })
    log(
      options.dryRun
        ? `Upload sweep (dry run): ${report.orphaned.length} ${what} over a day old would be deleted, of ${report.listed} listed; nothing was deleted.`
        : `Upload sweep: deleted ${report.deleted} ${what} over a day old, of ${report.listed} listed.`,
    )
    return {
      listed: report.listed,
      old: report.old,
      orphaned: report.orphaned.length,
      deleted: report.deleted,
    }
  }
  return {
    dryRun: options.dryRun,
    art: await swept(deps.art, 'unrecorded art files'),
    media: await swept(deps.media, 'mint page files no page names'),
  }
}

export type SweepArgs = { dryRun: boolean; allowRemote: boolean; minAgeHours: number; prefix: string }
```

Create `apps/web/src/lib/storage/upload-sweep-deps.ts`:

```ts
import 'server-only'
import { mediaKeysOf } from '@/lib/mint/media'
import { createServiceClient } from '@/lib/supabase/service'
import { mintPageBucket } from './config'
import { deleteObjects, listObjectPages } from './objects'
import type { SweepDeps } from './sweep'

/** Keys or collections per database read, so a query string stays short. */
const CHUNK = 100
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * The daily upload sweep's ports (docs/specs/2026-10-17-production-hardening.md, section 14, point 8): the art
 * bucket against `uploads.storage_key`, and the mint-page bucket against the keys each collection's `mint_pages`
 * row names, through the service client. Server only; the cron builds them, with no session.
 */
export function uploadSweepDeps(): { art: SweepDeps; media: SweepDeps } {
  const supabase = createServiceClient()
  const mediaBucket = mintPageBucket()
  return {
    art: {
      list: (prefix) => listObjectPages(prefix),
      async recorded(keys) {
        const found = new Set<string>()
        for (let at = 0; at < keys.length; at += CHUNK) {
          const { data, error } = await supabase
            .from('uploads')
            .select('storage_key')
            .in('storage_key', keys.slice(at, at + CHUNK))
          if (error) throw new Error(`The uploads could not be read (${error.code}).`)
          for (const row of data) found.add(row.storage_key)
        }
        return found
      },
      remove: (keys) => deleteObjects(keys),
    },
    media: {
      list: (prefix) => listObjectPages(prefix, { bucket: mediaBucket }),
      async recorded(keys) {
        // A key's first segment is its collection's id; a key without one is named by no page.
        const collections = [...new Set(keys.map((key) => key.split('/')[0]!))].filter((id) => UUID.test(id))
        const named = new Set<string>()
        for (let at = 0; at < collections.length; at += CHUNK) {
          const { data, error } = await supabase
            .from('mint_pages')
            .select('banner_key, avatar_key, about_banner_key, sections')
            .in('collection_id', collections.slice(at, at + CHUNK))
          if (error) throw new Error(`The mint pages could not be read (${error.code}).`)
          for (const row of data) for (const key of mediaKeysOf(row)) named.add(key)
        }
        return new Set(keys.filter((key) => named.has(key)))
      },
      remove: (keys) => deleteObjects(keys, { bucket: mediaBucket }),
    },
  }
}
```

Create `apps/web/src/app/api/cron/upload-sweep/route.ts`:

```ts
import { consoleLog, errorSummary } from '@cobweb/worker'
import { cronAuthorized } from '@/lib/render/env'
import { sweepUploads, uploadSweepDryRun } from '@/lib/storage/sweep'
import { uploadSweepDeps } from '@/lib/storage/upload-sweep-deps'

/** Each bucket is listed whole, a page of 1,000 keys at a time. */
export const maxDuration = 800

/**
 * The upload sweep, run by Vercel Cron every day at 07:00 UTC (docs/specs/2026-10-17-production-hardening.md,
 * section 14, point 8): deletes the art files no upload row records and the mint page files no page names, each
 * over a day old, dry until UPLOAD_SWEEP_DELETE is 1, and answers the counts. Vercel sends `Authorization: Bearer
 * <CRON_SECRET>`; any other caller gets a 404, as the render sweep answers. A failure is logged masked and answered
 * with an empty 500.
 */
export async function GET(request: Request): Promise<Response> {
  if (!cronAuthorized(request.headers.get('authorization'), process.env.CRON_SECRET))
    return new Response(null, { status: 404 })
  try {
    const report = await sweepUploads(uploadSweepDeps(), {
      dryRun: uploadSweepDryRun(process.env),
      now: Date.now(),
    })
    return Response.json(report)
  } catch (error) {
    consoleLog('upload sweep failed', { error: errorSummary(error) })
    return new Response(null, { status: 500 })
  }
}
```

In `apps/web/vercel.json`, replace:

```json
    { "path": "/api/cron/source-sweep", "schedule": "30 7 * * *" }
```

with:

```json
    { "path": "/api/cron/source-sweep", "schedule": "30 7 * * *" },
    { "path": "/api/cron/upload-sweep", "schedule": "0 7 * * *" }
```

- [ ] **Step 8: Run the tests to see them pass, then typecheck and lint the web app**

Run: `pnpm --filter @cobweb/web exec vitest run src/lib/mint/media.test.ts src/lib/storage/sweep.test.ts src/lib/storage/upload-sweep-route.test.ts src/lib/render/vercel-config.test.ts`
Expected: PASS, `Tests  28 passed (28)`.

Run: `pnpm --filter @cobweb/web typecheck && pnpm --filter @cobweb/web lint`
Expected: PASS.

- [ ] **Step 9: `verify:sweep` with the cron's ports, and the verifies whose records changed**

`verify:sweep` now imports the app's port, so it runs under the TypeScript resolver.

In `apps/web/scripts/verify-sweep.ts`, replace:

```ts
// remote Supabase. Anything unset is discovered with `supabase status -o env`. Never prints a key.
```

with:

```ts
// remote Supabase. Then the daily cron's two ports (docs/specs/2026-10-17-production-hardening.md,
// section 14, point 8) on the same collection's prefix: the art bucket's, and the mint-page bucket's
// against the collection's page. Anything unset is discovered with `supabase status -o env`. Never
// prints a key. Runs under `node --conditions=react-server --import ./scripts/resolve-ts.mjs`.
```

In `apps/web/scripts/verify-sweep.ts`, replace:

```ts
const { deleteObjects, headObject, presignPut } = await import('../src/lib/storage/objects.ts')
```

with:

```ts
const { deleteObjects, headObject, presignPut } = await import('../src/lib/storage/objects.ts')
const { sweepOrphans } = await import('../src/lib/storage/sweep.ts')
const { uploadSweepDeps } = await import('../src/lib/storage/upload-sweep-deps.ts')
const { mintPageBucket } = await import('../src/lib/storage/config.ts')
const { mintPageKey } = await import('../src/lib/mint/media.ts')
```

In `apps/web/scripts/verify-sweep.ts`, replace:

```ts
async function put(key: string, body: Buffer): Promise<void> {
  const res = await fetch(await presignPut(key, 'image/png', body.byteLength), {
```

with:

```ts
async function put(key: string, body: Buffer, bucket?: string): Promise<void> {
  const res = await fetch(await presignPut(key, 'image/png', body.byteLength, 900, { bucket }), {
```

In `apps/web/scripts/verify-sweep.ts`, replace:

```ts
  const recorded = await creator.rpc('record_upload', {
```

with:

```ts
  // As the upload action records it: through the service role, for the collection's owner.
  const recorded = await admin.rpc('record_upload', {
    p_owner_id: userId,
```

In `apps/web/scripts/verify-sweep.ts`, replace:

```ts
await check('cleanup: the run leaves no object, row or user behind', async () => {
  await deleteObjects([recordedKey, orphanKey].filter(Boolean))
```

with:

```ts
/** The cron's sweep of one port on this run's collection alone, past a minimum age of 0. */
const swept = (port: 'art' | 'media') =>
  sweepOrphans(uploadSweepDeps()[port], {
    prefix: `${collectionId}/`,
    minAgeMs: 0,
    now: Date.now(),
    dryRun: false,
  })

let lateKey = ''
await check(
  "upload sweep: the cron's art port deletes an unrecorded object and keeps the recorded one",
  async () => {
    lateKey = storageKey(collectionId!, 'placeholder', sha(Buffer.from('late')), 'image/png')
    await put(lateKey, OTHER)
    const report = await swept('art')
    if (report.deleted !== 1 || report.orphaned[0] !== lateKey) return `report ${JSON.stringify(report)}`
    if ((await headObject(lateKey)) !== null) return 'the unrecorded object is still there'
    return (await headObject(recordedKey)) ? null : 'the recorded object was deleted'
  },
)

const mediaBucket = mintPageBucket()
let savedMedia = ''
let unsavedMedia = ''
await check(
  "media sweep: the cron's mint page port deletes a file no page names and keeps the one the page names",
  async () => {
    savedMedia = mintPageKey(collectionId!, sha(PNG), 'image/png')
    unsavedMedia = mintPageKey(collectionId!, sha(OTHER), 'image/png')
    await put(savedMedia, PNG, mediaBucket)
    await put(unsavedMedia, OTHER, mediaBucket)
    const page = await creator
      .from('mint_pages')
      .insert({ collection_id: collectionId, banner_key: savedMedia })
    if (page.error) return `page: ${page.error.message}`
    const report = await swept('media')
    if (report.deleted !== 1 || report.orphaned[0] !== unsavedMedia) return `report ${JSON.stringify(report)}`
    if ((await headObject(unsavedMedia, { bucket: mediaBucket })) !== null)
      return 'the unsaved file is still there'
    return (await headObject(savedMedia, { bucket: mediaBucket })) ? null : 'the saved file was deleted'
  },
)

await check('cleanup: the run leaves no object, row or user behind', async () => {
  await deleteObjects([recordedKey, orphanKey, lateKey].filter(Boolean))
  await deleteObjects([savedMedia, unsavedMedia].filter(Boolean), { bucket: mediaBucket })
```

In `apps/web/package.json`, replace:

```json
    "verify:sweep": "node --conditions=react-server scripts/verify-sweep.ts",
```

with:

```json
    "verify:sweep": "node --conditions=react-server --import ./scripts/resolve-ts.mjs scripts/verify-sweep.ts",
```

Run: `pnpm --filter @cobweb/web verify:sweep`
Expected: PASS, `10 passed, 0 failed`.

Run: `pnpm --filter @cobweb/web verify:storage && pnpm --filter @cobweb/web verify:chain && pnpm --filter @cobweb/web verify:deploy`
Expected: PASS, `15 passed, 0 failed` (storage and deploy) and `12 passed, 0 failed` (chain).

Run: `pnpm --filter @cobweb/web verify:render && pnpm --filter @cobweb/web verify:phases`
Expected: PASS, `22 passed, 0 failed` and `20 passed, 0 failed`.

- [ ] **Step 10: Format, run the root checks and commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
pnpm exec prettier --write apps/web/src/lib/database.types.ts apps/web/src/lib/art/owned.ts apps/web/src/app/actions/uploads.ts apps/web/src/lib/supabase/service.ts apps/web/src/lib/storage/objects.ts apps/web/src/lib/storage/sweep.ts apps/web/src/lib/storage/sweep.test.ts apps/web/src/lib/storage/upload-sweep-deps.ts apps/web/src/lib/storage/upload-sweep-route.test.ts apps/web/src/lib/mint/media.ts apps/web/src/lib/mint/media.test.ts apps/web/src/app/api/cron/upload-sweep/route.ts apps/web/vercel.json apps/web/src/lib/render/vercel-config.test.ts apps/web/scripts/deploy-fixture.ts apps/web/scripts/verify-chain.ts apps/web/scripts/verify-deploy.ts apps/web/scripts/verify-render.ts apps/web/scripts/verify-storage.ts apps/web/scripts/verify-local.ts apps/web/scripts/verify-sweep.ts apps/web/package.json
pnpm typecheck && pnpm lint && pnpm test
git add supabase/migrations/20261017110000_upload_hardening.sql apps/web/src/lib/database.types.ts apps/web/src/lib/art/owned.ts apps/web/src/app/actions/uploads.ts apps/web/src/lib/supabase/service.ts apps/web/src/lib/storage/objects.ts apps/web/src/lib/storage/sweep.ts apps/web/src/lib/storage/sweep.test.ts apps/web/src/lib/storage/upload-sweep-deps.ts apps/web/src/lib/storage/upload-sweep-route.test.ts apps/web/src/lib/mint/media.ts apps/web/src/lib/mint/media.test.ts apps/web/src/app/api/cron/upload-sweep apps/web/vercel.json apps/web/src/lib/render/vercel-config.test.ts apps/web/scripts/deploy-fixture.ts apps/web/scripts/verify-chain.ts apps/web/scripts/verify-deploy.ts apps/web/scripts/verify-render.ts apps/web/scripts/verify-storage.ts apps/web/scripts/verify-local.ts apps/web/scripts/verify-sweep.ts apps/web/package.json
git commit -m "$(cat <<'EOF'
Record uploads through the service role for the owner the upload action checked, and add the daily upload sweep of unrecorded art files and unsaved mint page media

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: web 979 tests in 104 files; the other packages unchanged.

---

### Task 10: The whole check list, the browser walk, MASTER_PLAN, the dated notes, the landing note, CLAUDE.md and both example settings

This task is the controller's: it runs every check, walks the app in the browser against the local services with the policy enforced, the indexer on as its role and the dev wallet, and records what it saw. The doc edits add dated sentences; nothing earlier is rewritten or deleted.

**Files:**

- Modify: `docs/MASTER_PLAN.md` (the Art note, Hosting's two decisions, the new Security section, the Phase 7 status line)
- Modify: `docs/specs/2026-10-17-production-hardening.md` (the acceptance boxes; the landing note)
- Modify: `docs/specs/2026-10-16-mint-page-live-data.md` (decision 2 and section 12), `docs/specs/2026-10-16-indexer-overview.md` (decision 3 and section 12), `docs/specs/2026-10-16-freshness-server.md` (section 6.9), `docs/specs/2026-10-08-art-upload.md` (section 2), `docs/specs/2026-10-03-creator-flow-ui.md` (section 4.1), `docs/specs/2026-10-09-lock-and-pay.md` (section 9), each a dated note
- Modify: `CLAUDE.md` (the key's command and the two verifies), `apps/web/.env.example` (four variables), `apps/freshness/.env.example` (the indexer's two variables in place of the Supabase pair)

**Interfaces:**

- Consumes: everything Tasks 1 to 9 produce; the local services (`supabase start` on the ES256 key with its buckets seeded, `pnpm --filter @cobweb/web chain:local` with its two lines in `apps/web/.env.local`); the freshness server (`pnpm --filter @cobweb/freshness dev`) with `INDEXER_DATABASE_URL`; the dev wallet in `apps/web/scripts/dev-wallet` and Playwright; Foundry's `cast`, installed with Anvil.
- Produces: the docs, `CLAUDE.md`'s commands and both example settings.

In every sentence below, `<date>` is the day the work lands, written as `date '+%-d %B %Y'` prints it (for example `17 October 2026`).

- [ ] **Step 1: The whole check list**

Run at the repo root, one after another, and note each count. Nothing may listen on ports 3100, 3210 or 8787, and no freshness server may index the local database, while it runs.

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
pnpm --filter @cobweb/web verify:csp
pnpm --filter @cobweb/web verify:sources
```

Expected: tests pass (web 979 in 104 files, shared 105 in 14, freshness 216 in 18, dna 60, render 117, worker 282); the format check and the build pass, the build listing `ƒ /[slug]`, `ƒ /api/cron/source-sweep` and `ƒ /api/cron/upload-sweep` with every page dynamic and only `/icon.svg` static; `verify:local` 405, `verify:chain` 12, `verify:storage` 15, `verify:sweep` 10, `verify:render` 22, `verify:deploy` 15, `verify:phases` 20, `verify:whitelist` 18, `verify:airdrop` 15 (with the gas line), `verify:settings` 17, `verify:freshness` 16, `verify:mint-page` 17, `verify:indexer` 15, `verify:csp` 10 and `verify:sources` 9, each with `0 failed`. `pnpm build` runs sample mode (`NEXT_PUBLIC_DEMO_DATA=1` in `apps/web/.env.local`), which `verify:csp` needs.

- [ ] **Step 2: The browser walk**

The spec's section 10 walk: a fresh dev wallet against local Supabase on the ES256 key, Anvil, the freshness server with its indexer as `cobweb_indexer`, and the web app in development with `CSP_MODE` unset, so the policy is enforced.

1. Give the role a password for the walk and the freshness server its settings in `apps/freshness/.env`, which git ignores; nothing prints the password:

   ```
   PW=$(openssl rand -hex 24)
   echo "alter role cobweb_indexer with password '$PW';" | docker exec -i supabase_db_cobweb psql -U postgres -q
   { grep -E '^(RPC_URL_31337|FACTORY_ADDRESS_31337)=' apps/web/.env.local; echo "INDEXER_DATABASE_URL=postgresql://cobweb_indexer:$PW@127.0.0.1:55322/postgres"; } > apps/freshness/.env
   unset PW
   ```

2. Three terminals at the repo root: the freshness server, the dev wallet's signer (a fresh key, so a fresh wallet; it prints only its address) and the web app on live data:

   ```
   pnpm --filter @cobweb/freshness dev
   node apps/web/scripts/dev-wallet/signer.mjs
   NEXT_PUBLIC_DEMO_DATA=0 NEXT_PUBLIC_FRESHNESS_URL=http://127.0.0.1:3100 pnpm --filter @cobweb/web dev
   ```

   The server's start line ends `The indexer runs on Anvil (31337) as cobweb_indexer.` and no "No longer read" line shows. Fund the wallet on Anvil with `cast rpc anvil_setBalance <its address> 0x56BC75E2D63100000 --rpc-url http://127.0.0.1:8545` (100 ETH). In Playwright (the MCP tools' `browser_run_code_unsafe`), add the provider before each page loads, `await page.addInitScript({ path: '/Users/kobs/Desktop/CobwebLaunchpad/apps/web/scripts/dev-wallet/inject.js' })`, then open `http://localhost:3000` (the signer answers that origin only). After every page below, read the console (`browser_console_messages`): no message names the Content Security Policy. Walk each item and note what it showed:

3. Sign in (Connect wallet, Dev Wallet, Sign in as ...), then Collections, a create, a layer folder uploaded to local storage with its thumbnails drawn through `/api/uploads`, Rules and Generate, Lock and upload (pay on Anvil after switching the network in the account menu, then `pnpm --filter @cobweb/web render:local <collectionId>`), Deploy, each Manage tab (Overview, Phases, Whitelist, Airdrop, Mint page with a banner and a music file uploaded, Settings) and Preview; publish the page, open a phase, and on `/<slug>` watch its polls to the freshness server, mint 1 and see the token's art. No violation anywhere (spec section 10, item 1).
4. RainbowKit's modal: the WalletConnect view with its QR code, and MetaMask's view. No violation (item 2).
5. Stop the web app and start it again with `NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA` before the command: sign out, and the sign-in step shows Cloudflare's widget above the button, which reads "Checking your browser…" until the check passes, then "Sign in as ..."; the sign-in works. Start it again with `2x00000000000000000000AB`: the widget fails and "The browser check could not run. Reload the page and try again." shows under the button. No violation from Cloudflare's frame in either (item 3).
6. Start the web app again with `CSP_MODE=report-only` (no site key) and run in the console `const s = document.createElement('script'); s.textContent = "document.title = 'injected'"; document.head.append(s)`: the title changes, and the web app's terminal shows one line starting `{"csp":"report","directive":"script-src-elem"`. Start it again without `CSP_MODE` and run the same: the title stays, the console names the policy, and the terminal shows one line starting `{"csp":"enforce"` (item 4).
7. Lower the wallet's cap to what it holds, then open Create collection and submit: the dialog reads "This wallet already has <n> collections that are not deployed, the most it can hold. Delete a draft or deploy one, then create this one." Give the cap back after (`set draft_cap = 20`) (item 5):

   ```
   echo "update public.profiles p set draft_cap = (select count(*) from public.collections c where c.owner_id = p.id and c.status <> 'deployed') where p.wallet_address = lower('<the wallet's address>');" | docker exec -i supabase_db_cobweb psql -U postgres -q
   ```

8. Mark the walk's collection with `echo "update public.collections set art_sources_deleted_at = now() where id = '<its id>';" | docker exec -i supabase_db_cobweb psql -U postgres -q`: its Art pages show "The original art files were deleted 90 days after the deploy. The rendered art and its metadata stay on IPFS." above them and the traits' thumbnails still draw, while Generate's full-size preview shows the pattern. Clear the mark after (`set art_sources_deleted_at = null`) (item 6).
9. With `/<slug>` open, so Anvil has a hot collection, `curl -s http://127.0.0.1:3100/health` reads `"status":"ok"` and `"problems":[]`. Pause Anvil with `kill -STOP $(pgrep -x anvil)` (stopping it would lose the chain, Decision 23): about a minute later `/health` reads `"status":"degraded"` with "Anvil: no good read for <n> s (limit 60 s)." among its problems, still with 200. Resume it with `kill -CONT $(pgrep -x anvil)`: within a few seconds `/health` reads `"status":"ok"` again (item 7).
10. At a phone width (390 px), with the site key of item 5, the sign-in step with the widget fits with no sideways scroll (item 8).
11. Stop the web app, build it on live data and start it with `next start` on port 3000: `NEXT_PUBLIC_DEMO_DATA=0 NEXT_PUBLIC_FRESHNESS_URL=http://127.0.0.1:3100 pnpm --filter @cobweb/web build`, then `NEXT_PUBLIC_DEMO_DATA=0 NEXT_PUBLIC_FRESHNESS_URL=http://127.0.0.1:3100 pnpm --filter @cobweb/web exec next start -p 3000`. Item 3's public page with a mint, and its Overview tab, show no violation (item 9).

After the walk: stop the three processes, clear the role's password (`echo "alter role cobweb_indexer with password null;" | docker exec -i supabase_db_cobweb psql -U postgres -q`), remove `apps/freshness/.env`, and build in sample mode again (`pnpm --filter @cobweb/web build`), which `verify:csp` reads. A step that does not behave as written is a defect: fix it in a new commit (or send it back to the task that owns it) before recording the landing.

- [ ] **Step 3: MASTER_PLAN**

Under Art, the layer images' note gains its dated end; Hosting gains the role and the health alerts after the indexer; a new "### Security" section follows Hosting, before "## Open decisions"; Phase 7's status line becomes in progress.

In `docs/MASTER_PLAN.md`, replace:

```markdown
- **Layer images.** Originals are uploaded and kept. Every image is square (1:1), at most 2048 x 2048, the same size across a project, and at most 10 MB per file. The browser makes a separate small thumbnail for preview screens.
```

with:

```markdown
- **Layer images.** Originals are uploaded and kept (17 October 2026: until 90 days after the deploy and the final render; see the art source lifecycle). Every image is square (1:1), at most 2048 x 2048, the same size across a project, and at most 10 MB per file. The browser makes a separate small thumbnail for preview screens.
```

In `docs/MASTER_PLAN.md`, replace:

```markdown
- **The indexer** (decided 16 October 2026; [specs/2026-10-16-indexer-overview.md](specs/2026-10-16-indexer-overview.md)). Runs in the freshness server's process on Railway for every collection Cobweb deployed on a served chain, from its deploy block to the chain's confirmation depth, with a cursor per collection: `Transfer`, the two mint events, `NFTsAirdropped` and `MintFundsWithdrawn` over at most 500 blocks per scan, written once per log through one service-role function. The state body carries holders and the latest mints from its memory, so the request path still reads no database.
```

with:

```markdown
- **The indexer** (decided 16 October 2026; [specs/2026-10-16-indexer-overview.md](specs/2026-10-16-indexer-overview.md)). Runs in the freshness server's process on Railway for every collection Cobweb deployed on a served chain, from its deploy block to the chain's confirmation depth, with a cursor per collection: `Transfer`, the two mint events, `NFTsAirdropped` and `MintFundsWithdrawn` over at most 500 blocks per scan, written once per log through one service-role function. The state body carries holders and the latest mints from its memory, so the request path still reads no database.
- **The indexer's database role** (decided 17 October 2026; [specs/2026-10-17-production-hardening.md](specs/2026-10-17-production-hardening.md)). The indexer connects as `cobweb_indexer`, a login role that executes its four functions and nothing else, over postgres.js from `INDEXER_DATABASE_URL` through Supabase's session pooler, with verified TLS to any database off the machine; the owner sets its password outside git. Railway no longer holds the service role key. A role token for PostgREST would need the project's session signing key.
- **Health alerts** (decided 17 October 2026; [specs/2026-10-17-production-hardening.md](specs/2026-10-17-production-hardening.md)). `/health` answers `degraded` with one sentence per threshold crossed, over the last 5 minutes for failures, and stays 200 so Railway's deploy check never refuses a deployment during an RPC outage. A monitor keys on `"status":"ok"` every minute and alerts after two misses, with the body's `problems`; it is the owner's.

### Security

- **The Content-Security-Policy** (decided 17 October 2026; [specs/2026-10-17-production-hardening.md](specs/2026-10-17-production-hardening.md)). Every page renders per request with a nonce the proxy makes, scripts run only on it and what `'strict-dynamic'` admits, and the other directives list the origins the app reads from its own settings. `CSP_MODE` switches between enforce, report-only and off; unset, it is report-only on Vercel, so the first hosted deploys report before they block, and the owner sets enforce after a week of reports. Violations are logged as one JSON line each, read through a schema of allow-listed fields.
- **Wallet sign-in** (decided 17 October 2026; [specs/2026-10-17-production-hardening.md](specs/2026-10-17-production-hardening.md)). Cloudflare Turnstile's token travels with the signed message and Supabase Auth verifies it before the signature, so the public grant is covered too; a wallet holds at most its `draft_cap` (20) collections that are not deployed, which a trigger enforces under a lock per owner.
- **Session keys** (decided 17 October 2026; [specs/2026-10-17-production-hardening.md](specs/2026-10-17-production-hardening.md)). Sessions are verified against the project's ES256 key set, cached per process for 10 minutes, with no call to the auth server per page; writes keep the auth server's check, so a session signed out elsewhere is refused at once. The local stack signs with an ES256 key of its own.
- **The art source lifecycle** (decided 17 October 2026; [specs/2026-10-17-production-hardening.md](specs/2026-10-17-production-hardening.md)). A daily cron deletes a collection's original art files once it was deployed at least 90 days ago and its last real render finished at least 90 days ago, keeping thumbnails, the rendered art on IPFS, the metadata and every row, and marks the collection; it runs dry until `SOURCE_SWEEP_DELETE=1`.
```

In `docs/MASTER_PLAN.md`, replace:

```markdown
**Status:** not started.
```

with:

```markdown
**Status:** in progress. Production hardening in code (first sub-project of three: production hardening in code, then the hosted and launch sub-projects, each with its own spec, plan and run) landed on <date>; see [specs/2026-10-17-production-hardening.md](specs/2026-10-17-production-hardening.md). What exists: the Content-Security-Policy, set by the proxy with a fresh nonce for every page, each rendered per request (`/[slug]` included, its document still read through the 60 s cache under its tag), so a script runs only on its response's nonce and what `'strict-dynamic'` admits from it; `connect-src`, `media-src` and `frame-src` listing the origins the app reads from its own settings, each launch chain's public RPC and the wallet connectors' hosts of the pinned versions; images from any https host; `frame-ancestors 'none'` on every page and API route; `CSP_MODE` (enforce, report-only or off; unset is enforce off Vercel and report-only on it, where the framing block is `X-Frame-Options` alone, since Next copies the proxy's response headers into the request it renders and would read no nonce from an enforced framing policy); `/api/csp-report`, which reads both report formats through a schema of allow-listed fields and logs one JSON line per violation, at most 100 a minute an instance; Cloudflare Turnstile's browser check on wallet sign-in when `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is set, its token verified by Supabase Auth before the signature; `profiles.draft_cap` (20) with a trigger that refuses a wallet's next collection that is not deployed, which the create action words first; local sessions signed with an ES256 key in `supabase/signing_keys.json` and verified against the key set with no call to the auth server per page; the daily source sweep (`/api/cron/source-sweep`, dry until `SOURCE_SWEEP_DELETE=1`) deleting a collection's original art files 90 days after its deploy and its final render, thumbnails, rendered output and rows kept, with the Art notice and `/api/uploads/[id]` serving thumbnails alone once the originals are gone; `cobweb_indexer`, the login role the freshness server's indexer connects as over postgres.js from `INDEXER_DATABASE_URL`, with verified TLS to any database off the machine, in place of the service role key; `/health` answering `degraded` with one sentence per threshold crossed (no good read for 60 s, a head 120 s old or 10 failed reads in 5 minutes on a chain; no good index pass for 120 s, collections behind for 900 s or 5 failed passes in 5 minutes on its indexer), still 200; and the three items earlier phases owed: `record_upload` for the service role alone, so the size a row records is the one the upload action read from storage, and the daily upload sweep (`/api/cron/upload-sweep`, dry until `UPLOAD_SWEEP_DELETE=1`) of art files no row records and mint page files no page names; `verify:local` with 405 checks, `pnpm --filter @cobweb/web verify:csp` with 10, `verify:sources` with 9 and `verify:sweep` with 10. Known: `/_global-error` stays Next's prerendered page, so if the root layout itself throws, that page shows without its scripts under enforce; every page is a function call per view, and the mint page's HTML is no longer cached at Vercel's edge (its database reads are unchanged); inline styles stay allowed; the wallet connectors' hosts are those of the pinned versions, and an upgrade can add one, which report-only or the walk shows; a revoked signing key is trusted for up to 10 minutes per server process; the cap counts paid collections that are not deployed; Turnstile lists the production hostnames, so previews cannot sign in; after the purge, original-size views show the pattern while thumbnails and the rendered art stay; the source sweep takes 20 collections a run and the upload sweep lists both buckets whole each day; the lag threshold can trip on a quiet chain with a hot collection; report lines live as long as Vercel keeps logs. Owed by the owner, in this order (the spec's section 12): `supabase db push` for both migrations; the role's password, then `INDEXER_DATABASE_URL` on Railway's `freshness` (the session pooler, whose certificate is publicly trusted; a direct connection to the database host needs Supabase's CA file on the service, named by `INDEXER_DATABASE_SSL_CA`), then `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` removed; the rotation to an ES256 key; Turnstile's site key on Vercel, then captcha on in Supabase; `CSP_MODE` unset on Production and Preview, the Vercel Toolbar off for Preview, a week of report lines read, then `CSP_MODE=enforce`; `SOURCE_SWEEP_DELETE=1` and `UPLOAD_SWEEP_DELETE=1` once their dry runs list what is expected; a monitor on `/health`'s `"status":"ok"`. Next: the hosted and launch sub-projects.
```

- [ ] **Step 4: The dated notes**

In `docs/specs/2026-10-16-mint-page-live-data.md`, replace:

```markdown
   the database (rejected in its spec).
```

with:

```markdown
   the database (rejected in its spec).

   > **<date>:** The page renders per request, so its scripts carry the response's nonce
   > ([2026-10-17-production-hardening.md](2026-10-17-production-hardening.md), decision 9): `generateStaticParams` and
   > `revalidate` are gone and the build lists `ƒ /[slug]`. The document is still read through `readMintPage`'s 60 s
   > cache under `mint-page:<slug>`, so the database sees one read per link a minute.
```

In `docs/specs/2026-10-16-mint-page-live-data.md`, replace:

```markdown
  verify's collection has three tokens, so its tiers cover three ranks.

> **17 October 2026:** The third sub-project's items landed ([2026-10-16-indexer-overview.md](2026-10-16-indexer-overview.md)): the state body carries `activity`, the holders and the 10 latest mints from the indexer's memory, so the page shows a Holders row in Details and Recent mints under the phases, and neither while `activity` is null; the Overview shows holders, recent mints and "Paid by minters" on real data.
```

with:

```markdown
  verify's collection has three tokens, so its tiers cover three ranks.

> **<date>:** The full Content-Security-Policy landed ([2026-10-17-production-hardening.md](2026-10-17-production-hardening.md)): `connect-src` lists the Supabase, freshness, storage and gateway origins, each launch chain's public RPC and the WalletConnect and MetaMask hosts of the pinned versions (Coinbase's SDK is not among RainbowKit's default wallets); images come from any https host, and media from the storage, media and gateway origins. The page renders per request for its nonce. The sweep of mint page files no page names runs daily with the upload sweep, dry until `UPLOAD_SWEEP_DELETE=1`.

> **17 October 2026:** The third sub-project's items landed ([2026-10-16-indexer-overview.md](2026-10-16-indexer-overview.md)): the state body carries `activity`, the holders and the 10 latest mints from the indexer's memory, so the page shows a Holders row in Details and Recent mints under the phases, and neither while `activity` is null; the Overview shows holders, recent mints and "Paid by minters" on real data.
```

In `docs/specs/2026-10-16-indexer-overview.md`, replace:

```markdown
   listed for Phase 7).
```

with:

```markdown
   listed for Phase 7).

   > **<date>:** The login role replaced the service role key
   > ([2026-10-17-production-hardening.md](2026-10-17-production-hardening.md), decision 7): the indexer connects as
   > `cobweb_indexer` over postgres.js from `INDEXER_DATABASE_URL`, with verified TLS to any database off the machine,
   > and `@supabase/supabase-js` left `apps/freshness`.
```

In `docs/specs/2026-10-16-indexer-overview.md`, replace:

```markdown
  scans of 500 blocks a second, the provider allowing.

## 13. Acceptance criteria
```

with:

```markdown
  scans of 500 blocks a second, the provider allowing.

> **<date>:** Two Phase 7 items landed ([2026-10-17-production-hardening.md](2026-10-17-production-hardening.md)): the role, so the owner's Railway step is now `INDEXER_DATABASE_URL` (the session pooler string for `cobweb_indexer.<project ref>` and the password the owner sets) in place of `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, which the server names as no longer read; and the alerts, `/health`'s `status` and `problems` with the indexer's `failedPassesRecent`, `lastGoodPassAt` and `behindSince`.

## 13. Acceptance criteria
```

In `docs/specs/2026-10-16-freshness-server.md`, replace:

```markdown
answers 200 with `Cache-Control: no-store` whatever it reports, and HEAD likewise.

### 6.10 What the mint page relies on
```

with:

```markdown
answers 200 with `Cache-Control: no-store` whatever it reports, and HEAD likewise.

> **<date>:** `/health` gains `status: 'ok' | 'degraded'` and `problems`, one sentence per threshold crossed ([2026-10-17-production-hardening.md](2026-10-17-production-hardening.md), section 8.2): for a chain with hot collections, no good read for 60 s or a head 120 s old; more than 10 failed reads in 5 minutes (`failedTicksRecent`); for its indexer, no good pass for 120 s, collections behind for 900 s or more than 5 failed passes in 5 minutes. It stays 200, so Railway's deploy check never refuses a deployment during an RPC outage; a monitor keys on the body.

### 6.10 What the mint page relies on
```

In `docs/specs/2026-10-08-art-upload.md`, replace:

```markdown
  The key shape leaves room for all three.
```

with:

```markdown
  The key shape leaves room for all three.

  > **<date>:** The lifecycle deletion landed as a daily cron in the app, not as R2's rules, which count from each
  > object's upload ([2026-10-17-production-hardening.md](2026-10-17-production-hardening.md), decision 6): a
  > collection's `layers`, `assets` and `placeholders` folders go 90 days after its deploy and its final render, and
  > its thumbnails stay. `record_upload` now runs for the service role alone, so a row's size is the one the upload
  > action read from storage.
```

In `docs/specs/2026-10-03-creator-flow-ui.md`, replace:

```markdown
  4,000 for single asset). The mint page address is not chosen here; it is reserved in Deploy.
```

with:

```markdown
  4,000 for single asset). The mint page address is not chosen here; it is reserved in Deploy.

> **<date>:** Sign-in runs Cloudflare Turnstile's browser check above "Sign in as ..." when a site key is set ([2026-10-17-production-hardening.md](2026-10-17-production-hardening.md), section 6.2): the button reads "Checking your browser…" until a token is held, a failed check says "The browser check could not run. Reload the page and try again.", and a refusal from Supabase reads "The browser check did not pass. Try again." The Create collection dialog refuses a wallet's collection past its cap of collections that are not deployed (20 unless support raised it) with "This wallet already has <cap> collections that are not deployed, the most it can hold. Delete a draft or deploy one, then create this one."
```

In `docs/specs/2026-10-09-lock-and-pay.md`, replace:

```markdown
scheduled later with care. Documented in CLAUDE.md commands.

## 10. Testing
```

with:

```markdown
scheduled later with care. Documented in CLAUDE.md commands.

> **<date>:** Scheduled ([2026-10-17-production-hardening.md](2026-10-17-production-hardening.md), section 14, point 8): `/api/cron/upload-sweep` runs the same core every day at 07:00 UTC over the art bucket and over the mint-page bucket's files no page names, each over a day old, dry until `UPLOAD_SWEEP_DELETE=1`. `record_upload` runs for the service role alone, called by `confirmUpload` with the owner it checked and the size it read from storage.

## 10. Testing
```

- [ ] **Step 5: The acceptance boxes and the landing note**

In section 13 of `docs/specs/2026-10-17-production-hardening.md`, change each `- [ ]` to `- [x]` whose criterion Steps 1 and 2 confirmed (all ten when everything passed). Then, after the list and before `## 14. Reconciliations and points to rule`, add one paragraph that starts `Checked on <date> on Anvil, local Supabase on the ES256 key, the freshness server with its indexer as cobweb_indexer, and the web app with the policy enforced:` and records: the root checks with the web, shared and freshness test counts; the build; each verify script with its count; the walk's nine items as they behaved; the departures from the spec's letter (this plan's Decisions 2 to 9, 15 to 17, 20 to 23); the owner's checklist still owed (section 12's seven steps, with the pooler's TLS of Decision 16 and `UPLOAD_SWEEP_DELETE=1`); and any defect found with the commit that fixed it.

- [ ] **Step 6: CLAUDE.md and both example settings**

In `CLAUDE.md`, replace:

```markdown
cd contracts && forge test                # contracts
```

with:

```markdown
cd contracts && forge test                # contracts
echo '[]' > supabase/signing_keys.json && supabase gen signing-key --algorithm ES256 --yes   # once, before the first supabase start: the local ES256 session key in supabase/signing_keys.json (gitignored)
```

In `CLAUDE.md`, replace:

```markdown
pnpm --filter @cobweb/web verify:indexer   # the indexer in the freshness server against local Supabase and Anvil: mints, owners, airdrops and withdrawals once each, a replay, a restart and a backfill, the Overview, Airdrop and the state body
```

with:

```markdown
pnpm --filter @cobweb/web verify:indexer   # the indexer in the freshness server against local Supabase and Anvil: mints, owners, airdrops and withdrawals once each, a replay, a restart and a backfill, the Overview, Airdrop and the state body
pnpm --filter @cobweb/web verify:csp   # the policy on a sample-mode production build: a nonce on every page and script, the origins, report-only, the report endpoint
pnpm --filter @cobweb/web verify:sources   # the source sweep against local Supabase and local storage: due, dry run, delete, resume, the guards
```

In `apps/web/.env.example`, replace:

```
CRON_SECRET=
```

with:

```
CRON_SECRET=

# The Content-Security-Policy's mode: enforce, report-only or off; unset is enforce locally and report-only on
# Vercel. Read by the proxy at run time.
CSP_MODE=

# Cloudflare Turnstile's site key, public, read at build time; empty turns the sign-in check off, as locally. The
# test key 1x00000000000000000000AA always passes.
NEXT_PUBLIC_TURNSTILE_SITE_KEY=

# 1 lets the daily source sweep delete; anything else runs it dry.
SOURCE_SWEEP_DELETE=

# 1 lets the daily upload sweep delete unrecorded art files and mint page files no page names; anything else runs
# it dry.
UPLOAD_SWEEP_DELETE=
```

In `apps/freshness/.env.example`, replace:

```
# The indexer's database: the project's API URL and its service role key, a secret that never leaves the
# server. Set both to run the indexer, or neither. Local: the values `supabase status` prints.
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

with:

```
# The indexer's connection as the cobweb_indexer role, a secret: Supabase's session pooler string with the user
# cobweb_indexer.<project ref> and the role's password. Empty: the indexer is off. Local:
# postgresql://cobweb_indexer:<password>@127.0.0.1:55322/postgres, after
# `alter role cobweb_indexer with password '<password>';` in local Studio's SQL editor. Off this machine the
# connection is always TLS with the certificate and the host verified; sslmode, when given, must be verify-full.
INDEXER_DATABASE_URL=
# The path of the database's CA certificate (PEM), for a direct connection to the database host, whose certificate
# Supabase signs with its own CA (Database settings, SSL configuration, Download certificate). Empty: the system's
# CAs, which the session pooler's certificate chains to.
INDEXER_DATABASE_SSL_CA=
```

- [ ] **Step 7: Commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
git add docs/MASTER_PLAN.md docs/specs/2026-10-17-production-hardening.md docs/specs/2026-10-16-mint-page-live-data.md docs/specs/2026-10-16-indexer-overview.md docs/specs/2026-10-16-freshness-server.md docs/specs/2026-10-08-art-upload.md docs/specs/2026-10-03-creator-flow-ui.md docs/specs/2026-10-09-lock-and-pay.md CLAUDE.md apps/web/.env.example apps/freshness/.env.example
git commit -m "$(cat <<'EOF'
Record production hardening in code in MASTER_PLAN with its Security and Hosting decisions, in its spec and the notes of the specs it changes, CLAUDE.md and both example settings

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: `git show --stat HEAD` lists the seven docs, `CLAUDE.md` and the two `.env.example` files only; `git diff HEAD~1 -- docs/PLAN.md` prints nothing.

---

## Self-review

**Spec coverage.** Sections 1 to 3 (the goal, the 17 decisions, the scope): Tasks 1 to 8 in section 3's order, Task 9 for the ruling on point 8 and Task 10 the controller's (Decision 1). Section 4.1 (the draft cap): the column and the trigger in Task 1, the action in Task 5. Section 4.2 (the role) and 4.3 (the layer sources): Task 1. Section 4.4 (the types): Task 1, with `record_upload`'s new argument in Task 9. Section 4.5 (`config.toml` and `.gitignore`): Task 1. Section 5.1 (what Next does): Decisions 7 and 8. Section 5.2 (the policy): Task 2. Section 5.3 (the proxy) and 5.4 (rendering per request): Task 3. Section 5.5 (reports): Task 2 (Decision 6). Section 5.6 (`next.config.ts`): Task 3. Section 6.1 (the check) and 6.2 (the button): Task 4. Section 6.3 (sessions): the key and checks 3 and 4 of section 9p in Task 1, `getClaims` once a request in Task 3's proxy test. Section 6.4 (the cap's action): Task 5. Section 7 (the layer sources' core, port, cron, serving and notice): Task 6. Section 8.1 (the role in the freshness server): Task 7. Section 8.2 (`/health`): Task 8. Section 9.1 (sample mode, `?sources=deleted`): Task 6. Section 9.2 (stage rules): unchanged. Section 9.3 (copy): the sign-in lines in Task 4, the cap's sentence in Task 5, the notice in Task 6, the health sentences in Task 8. Section 10 (testing): the unit tests in Tasks 2 to 9, `verify:local`'s section 9p in Task 1 and 9q in Task 9, `verify:csp` in Task 3, `verify:sources` in Task 6, `verify:indexer` in Tasks 7 and 8, `verify:freshness` in Task 8, `verify:sweep` in Task 9, the walk and the check list in Task 10. Section 11 (documentation): Task 10. Section 12 (owed and known): the `Known:` list and the owner's checklist Task 10 writes into MASTER_PLAN and the landing note. Section 13 (acceptance): Task 10. Section 14's reconciliations: 1 (`/[slug]` per request, its read cached by tag) Task 3 and the mint page spec's note in Task 10; 2 (the role through postgres.js, supabase-js leaving the freshness server) Task 7; 3 (`/health` still 200 with `status` and `problems`) Task 8; 4 (the captcha and the keys: code here, hosted switch in section 12) Tasks 1 and 4; 5 (originals kept until 90 days) Task 6 and MASTER_PLAN's Art note; 6 (the framing policy into the proxy, the other three headers kept) Task 3. The rulings: 1 per request (Task 3, with the notes of Task 10); 2, 3, 7, 9 and 10 as written (Tasks 4, 7, 1, 3 and 1); 4 `img-src ... https:` (Task 2, Decision 5); 5 report-only on Vercel when unset (Task 2), its gate in MASTER_PLAN's owner list (Task 10); 6 the key checked while planning (Decision 2); 8 the tenth task (Task 9, Decisions 20 and 21).

**Where this plan departs from the spec's letter.** The key's command makes its file first (Decision 2); `postgres` is 3.4.9, exact (Decision 3); section 9p acts as the role inside a rolled-back grant and check 2's name gains the race (Decision 4); `img-src` adds the local services' http origins (Decision 5); a report is read through allow-listed schemas, cut at 256 and logged as one JSON line, and a malformed body is counted, never logged (Decision 6); report-only mode carries no enforced policy, so `X-Frame-Options` holds the framing block there and `verify:csp`'s check 8 names that header (Decision 7); the matcher is tested with `unstable_doesMiddlewareMatch` (Decision 8); `verify:csp`'s check 8 checks the endpoint's path (Decision 9); the indexer's connection requires verified TLS off the machine and refuses an unverified `sslmode` at start (Decisions 15 and 16); the port's codes gain `NO_ANSWER` in place of `HTTP_<status>` (Decision 17); the tenth task's migration, sweep and checks (Decisions 20 and 21); the local database URL's port (Decision 22); the walk pauses Anvil (Decision 23). Details the spec leaves open: the tests beyond its list (Decision 10), the failure's reading and the check's reset (Decision 11), the cap's default for a refusal without its detail (Decision 12), what an original-size view serves after the purge (Decision 13), how `verify:sources` records its deploys (Decision 14), where each verify's names change (Decision 18) and the window's edge (Decision 19).

**Placeholder scan.** No step says "add error handling" or "similar to Task N"; every code step shows a whole file or an exact anchor with its replacement. The only values filled at landing are Task 10's `<date>`, its acceptance boxes and its landing paragraph, each defined where it is used, and the walk's runtime values (the wallet's address, the collection's id, the cap it holds), which only the walk knows.

**Type consistency.** `profiles.draft_cap`, `collections_guard_draft_cap`, `cobweb_indexer`, `collections.art_sources_deleted_at`, `collections_sources_due`, `collection_sources_deleted`, `refuse_after_sources_deleted`, `record_upload`'s `p_owner_id`, `CspMode`, `RouteClass`, `CspEnv`, `CspSources`, `CSP_REPORT_PATH`, `FRAME_POLICY`, `DEV_WALLET_ORIGIN`, `TURNSTILE_ORIGIN`, `WALLET_CONNECT_ORIGINS`, `METAMASK_ORIGINS`, `cspModeOf`, `routeClassOf`, `originOf`, `cspSourcesOf`, `pagePolicy`, `newNonce`, `cspHeaders`, `REPORT_MAX_BYTES`, `REPORT_LINES_PER_MINUTE`, `REPORT_FIELD_MAX`, `Violation`, `cleanField`, `violationsOf`, `violationLine`, `reportLimiter`, `TURNSTILE_SCRIPT_URL`, `TURNSTILE_LOAD_MS`, `TurnstileApi`, `turnstileSiteKey`, `loadTurnstile`, `useTurnstile`, `SignInFailure`, `signInFailureOf`, `DRAFT_CAP_DEFAULT`, `DRAFT_CAP_REFUSAL`, `draftCapSentence`, `draftCapOf`, `SOURCE_RETENTION_DAYS`, `SOURCES_PER_RUN`, `SOURCE_FOLDERS`, `DueCollection`, `SourceSweepDeps`, `SourceSweepReport`, `sourcePrefixes`, `sourceSweepDryRun`, `sizeText`, `sweepSources`, `sourceSweepDeps`, `servedKeyOf`, `ArtLiveNotice`'s `sourcesDeleted`, `INDEXER_ROLE`, `IndexerOptions`, `isLoopbackHost`, `indexerOptionsOf`, `checkIndexerOptions`, `unreadIndexerVariables`, `IndexerFunction`, `IndexerCall`, `indexerDbOf`, `INDEXER_PARAMETERS`, `IndexerSql`, `IndexerTls`, `indexerConnectionOf`, `postgresIndexerDb`, `IndexerWriteError`, `DB_TIMEOUT_MS`, `RECENT_WINDOW_MS`, `recentCounter`, `ReaderHealth.failedTicksRecent`, `IndexerHealth.failedPassesRecent`, `IndexerHealth.lastGoodPassAt`, `IndexerHealth.behindSince`, `HealthBody.status`, `HealthBody.problems`, `HEALTH_LIMITS`, `healthProblems`, `ownedUnlocked`'s `userId`, `listObjectPages`'s `bucket`, `MintPageMediaRow`, `mediaKeysOf`, `UPLOAD_SWEEP_MIN_AGE_MS`, `uploadSweepDryRun`, `SweepCounts`, `UploadSweepReport`, `sweepUploads` and `uploadSweepDeps` are spelled the same in every task that uses them, and each exported name is exported once.

**Review Focus.** Five lines, each with its test in the owning task: a violation report as log input (Task 2, `csp-report.test.ts`), the indexer's connection to a hosted database (Task 7, `indexer-db.test.ts` and `config.test.ts`), a request that brings its own policy or nonce (Task 3, `proxy.test.ts`), report-only mode losing its nonce (Tasks 2 and 3, `csp.test.ts` and `proxy.test.ts`) and two inserts at once for a wallet's last place (Task 1, `verify:local`'s check 2). Each was checked against a mutation of the rule it guards: the cleaner keeping every character failed its Review Focus test and the cleaner's own (`2 failed | 15 passed`), and a sentence in place of the JSON line failed six, both route twins among them; a hosted string left to the driver's default (`ssl` undefined) failed the TLS test and the port's own connection test, and `require` among the verified modes failed the refusal's test; keeping the client's headers failed the replacement test alone; the enforced framing policy in report-only mode failed the two report-only tests; and the trigger without its advisory lock failed check 2 with "the second insert did not wait for the first" (`404 passed, 1 failed`). Each mutation was restored and the suites passed again.

**Checked while planning.** The code was written first in a scratch worktree of the repository at `49aea80` (its own branch, one commit per task), and every code block here is taken from those commits by a script; each anchored edit is generated from its commit's diff and was checked by applying it to the parent's file, its old text found exactly once. The counts at those commits: the web app 902 tests in 94 files before, 940 in 97 after Task 2, 947 in 98 after Task 3, 954 in 100 after Task 4, 958 in 101 after Task 5, 972 in 103 after Task 6 and 979 in 104 after Task 9; the freshness package 198 in 17 before, 199 after Task 7 and 216 in 18 after Task 8; the shared package 105 in 14 throughout; dna 60, render 117 and worker 282 unchanged; `pnpm typecheck`, `lint` and `test` pass at every commit. The local signing key first (the ruling on point 6): with `signing_keys_path` set and the stack restarted from the scratch worktree, the key set served one ES256 key, the JWTs `supabase status` prints were signed with it, the publishable, secret and S3 keys answered as before, and the unchanged `verify:local` passed `395 passed, 0 failed`, so Task 1 keeps the key; section 9p's check 4 counts its key-set reads and `/auth/v1/user` calls through a counting `fetch`, which was seen to count a `getUser` call, so its zero is not vacuous. Library facts read while planning: Supabase CLI 2.116.0 fails `gen signing-key` on a configured file that does not exist (Decision 2); Next 16.3.8's `resolve-routes.js` copies the proxy's response headers into the request, which left 38 of 38 scripts of a report-only page without a nonce while the enforced framing policy was beside it (Decision 7); Next exports `unstable_doesMiddlewareMatch` and no proxy twin (Decision 8); postgres.js 3.4.9's `src/connection.js` maps `require`, `allow` and `prefer` to `rejectUnauthorized: false` and merges an object into Node's TLS options, and sends an unknown URL parameter such as `sslrootcert` to the server as a setting (Decisions 15 and 16); the local `postgres` role is not a superuser and cannot `set role cobweb_indexer` without a membership (Decision 4). The two migrations were applied with `supabase migration up --local`, and the new blocks of `database.types.ts` match `supabase gen types typescript --local` up to the line breaks Prettier keeps from the file. Each verify passed at its task's commit: `verify:local` 404 (Task 1) and 405 (Task 9), `verify:csp` 10 (Task 3, on a sample-mode build), `verify:sources` 9 (Task 6), `verify:indexer` 15 through the role (Tasks 7 and 8), `verify:freshness` 16 (Task 8), `verify:sweep` 10, `verify:storage` 15, `verify:chain` 12, `verify:deploy` 15, `verify:render` 22 and `verify:phases` 20 (Task 9). Five Review Focus lines, six mutations, each failing the test named there (see Review Focus above); each was restored and the suites passed again. Then the plan itself was applied to a second worktree at `49aea80` (a real offline install, Next's route types, the repository's `contracts/out` and `apps/web/.env.local`) by a script that performs each "Create", "Replace the whole of" and "In ..., replace: ... with:" literally and refuses an anchor found other than once, runs each "Run:" line through zsh at the worktree's root, checks its exit against its Expected line (a "FAIL" needs a failing run) and looks for each backticked fragment of that line in the output, and runs each bash block one command at a time with the repository's path replaced by the worktree's, stopping at the first that fails, after `prettier --check` on the files the block's `prettier --write` names: every one of its 205 directives (27 files created, 3 replaced whole, 175 anchored edits) landed with its anchor found exactly once; the ten "see it fail" steps failed and the 37 other Runs passed; each of the ten commit blocks found nothing for Prettier to change, ran green and made its commit with the two trailer lines and a clean status; and after each task the worktree's committed tree equaled the scratch commit's (894 paths after Task 1, 920 after Tasks 9 and 10). In that pass Task 1 made the worktree's own key and restarted the stack from it, and `verify:local` read `395 passed, 0 failed` on it, `397 passed, 7 failed` before the migration and `404 passed, 0 failed` after; Task 9's read `106 passed, 8 failed` before its migration, stopping at the uploads' setup, and `405 passed, 0 failed` after; `verify:csp` read 10, `verify:sources` 9, `verify:indexer` 15 at Tasks 7 and 8 (its server's start line ending `The indexer runs on Anvil (31337) as cobweb_indexer.`), `verify:freshness` 16, `verify:sweep` 10 and Task 9's five others their counts. Seven Expected lines named fragments that run did not print: six of "see it fail" steps, where Vitest 5 prints `Cannot find module` and `Cannot find package` and Task 9's `verify:local` stops at the uploads' setup, and Task 6's file count. They were reworded to what the run printed, no directive changed, and a second script then found every fragment of the plan's 47 Expected lines, and each exit, in the outputs that pass saved. The whole check list ran once, in that worktree at Task 9's commit, in about 10 minutes: `pnpm typecheck`, `lint` and `test` (replayed from Turborepo's cache of the run Task 9's commit block had just made: web 979 in 104 files, shared 105 in 14, freshness 216 in 18, dna 60, render 117, worker 282) and `format:check` pass; the build ran (22 s) and lists every page as `ƒ`, `/[slug]` and the two new crons among them, with `/icon.svg` alone static; `verify:local` 405, `verify:chain` 12, `verify:storage` 15, `verify:sweep` 10, `verify:render` 22, `verify:deploy` 15, `verify:phases` 20, `verify:whitelist` 18, `verify:airdrop` 15 (its gas line reading 26,880,045), `verify:settings` 17, `verify:freshness` 16, `verify:mint-page` 17, `verify:indexer` 15, `verify:csp` 10 and `verify:sources` 9, each with `0 failed`. Task 10's 15 doc anchors were each found once and its commit changed the six docs, `CLAUDE.md` and both `.env.example` files (the acceptance boxes and the landing note are the controller's to write). Afterwards both migrations were reversed on the local database with the rollback SQL of Tasks 1 and 9 (`record_upload` given back its earlier body and grants; the source guards, functions and column, the role with its grants, and the cap's trigger, function and column dropped; both rows deleted from `supabase_migrations.schema_migrations`, which ends at `20261016200000` again): `pg_dump --schema-only` of `public` and `private` then matched the dump taken before the first change line for line, and the rows of every public table, each bucket and the users matched a snapshot taken before it (among them `collections` 11, `deployments` 8, `uploads` 164, `tokens` 65, `whitelist_entries` 2,004 and `profiles` 9; 164 objects in `art`, 6 in `mint-page` and 8 in `render`; 9 users). The stack was then restarted from the main checkout: the keys `supabase status` prints hash as they did before the first restart, the `anon` and `service_role` JWTs are HS256 again, and the key set lists the CLI's own key (Decision 2). Anvil kept running on port 8545 with its factory and was never restarted; the planning runs moved it ahead (each `verify:indexer` run by 1,200 blocks and about 1,200 s, each `verify:freshness` and `verify:mint-page` run by about 600 s). Not run while planning: the browser walk (Task 10's walk is its first), anything hosted (`supabase db push`, the role's password and `INDEXER_DATABASE_URL` on Railway, so TLS to the session pooler and a direct host's CA file are covered by the unit tests alone, the ES256 rotation, Turnstile's site key with captcha on in Supabase, the week of reports and `CSP_MODE=enforce`), and a testnet.
