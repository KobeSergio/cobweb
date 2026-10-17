# Production hardening in code: specification

Phase 7, first sub-project of three (production hardening in code, then the two hosted and launch sub-projects), each
with its own spec, plan and run. Product decisions: [../MASTER_PLAN.md](../MASTER_PLAN.md#decisions) and the Phase 7
bullets this run closes in code: the full Content-Security-Policy, the captcha on wallet sign-in, the per-wallet cap on
collections, asymmetric JWT signing keys, the lifecycle rule for layer sources and the alerts on the freshness server's
health, with the Phase 6 Known item that names a login role for the indexer. The controller took decisions 2 to 8
before this spec; where the letter of one could not work, this spec keeps its intent, writes the reading it takes and
lists the point in section 14 for a ruling. The rest are this spec's, each with its reason. Rules 3 and 4 bind it: the
mint page still polls the freshness server and calls no RPC for shared state; every server action checks the session
and the ownership, and every table keeps row-level security. What it consumes:
[2026-10-16-mint-page-live-data.md](2026-10-16-mint-page-live-data.md) decision 2 and section 12 (the page's origins),
[2026-10-16-indexer-overview.md](2026-10-16-indexer-overview.md) decision 3 and section 12 (the role),
[2026-10-16-freshness-server.md](2026-10-16-freshness-server.md) decision 17 and section 6.9 (`/health`),
[2026-10-09-lock-and-pay.md](2026-10-09-lock-and-pay.md) section 9 (the upload sweep) and
[2026-10-13-render-worker-vercel.md](2026-10-13-render-worker-vercel.md) section 7 (the cron). Out, for the second and
third sub-projects: the k6 port and load run, Slither and the invariant run, Cloudflare in front, the mainnet factory
deploys, the secrets rotation, the hosted Supabase settings (email provider off, site URL, session limits), the
streamed recipients export and the second indexer replica with a lease.

## 1. Goal

Cobweb carries the protections a public launch needs, each built and proven on a laptop, with the hosted switches
left as a checklist. Every page carries a Content-Security-Policy under which a script runs only with the response's
nonce, listing exactly the origins the app calls; it starts as a report-only policy that logs what it would block,
then is enforced. A wallet signs in only after a Cloudflare Turnstile check that Supabase Auth verifies before it
checks the signature, and holds at most 20 collections that are not deployed, so mint page links cannot be squatted in
bulk. Sessions are verified against the project's public signing keys, cached, with no call to the auth server on
each page. A daily cron deletes a collection's original art files 90 days after its deploy and its final render,
keeping thumbnails, the rendered art and the metadata. The indexer logs in as a role that can run its four functions
and nothing else, so Railway no longer holds the service role key. `/health` answers `degraded` with its reasons at
documented thresholds a monitor keys on. `verify:csp`, `verify:sources`, section 9p of `verify:local` and
`verify:indexer` through the role prove it.

## 2. Decisions

1. **Scope.** Decision: the policy (a pure module, the proxy, the report endpoint, every page rendered per request);
   the Turnstile check on the sign-in button; the draft cap (a column, a trigger, the create action); the local ES256
   session key and its proof; the source sweep (a migration, a core, its storage port, a daily cron, the uploads
   route's fallback, the Art notice); the indexer's role (a migration, a Postgres port in the freshness server, its
   settings); `/health`'s status and thresholds; the verifies above; unit tests; the walk; docs; the owner's checklist
   (section 12). Out: as the header lists; Permissions-Policy and HSTS (no page asks for a device permission, and
   Vercel, later Cloudflare, sets transport security); the items of section 14, point 8. Considered: one run per item
   (each is a few modules; one plan of nine tasks keeps the docs and the walk to one pass).
2. **The Content-Security-Policy (decided).** Decision: a nonce-based `script-src` (`'self' 'nonce-<n>'
   'strict-dynamic'`) made per request in `proxy.ts`, which Next 16.3 reads from the request's policy header and puts
   on its own scripts (section 5.1); `connect-src`, `img-src`, `media-src` and `frame-src` listing exactly what the
   browser calls (section 5.2); `CSP_MODE` switching between `enforce`, `report-only` and `off`, with violations posted
   to `/api/csp-report` and logged; a unit test per route class and `verify:csp` on a production build prove the
   headers and that every script carries its response's nonce. Considered: hashes through `experimental.sri` (App
   Router pages carry inline flight scripts no file hash covers); the header in `next.config.ts` (a fixed header
   cannot carry a fresh nonce).
3. **The draft cap (decided).** Decision: a wallet holds at most 20 collections that are not deployed (status
   `draft`, `art_locked`, `rendering` or `rendered`); deployed ones are not counted. A `before insert` trigger on
   `collections`, serialized per owner, refuses the next one, and `createCollection` checks first and maps the
   trigger's refusal to the same sentence. Considered: a count in the insert policy's `with check` (two concurrent
   inserts both pass); the action alone (the owner's insert grant reaches PostgREST directly).
4. **The captcha (decided).** Decision: Cloudflare Turnstile on the sign-in button; its token travels with the SIWE
   message and signature as `signInWithWeb3({ ..., options: { captchaToken } })`, and Supabase Auth's captcha check,
   which runs on `/token?grant_type=web3` before the grant's handler verifies the signature, verifies it with
   Cloudflare using the secret in the hosted auth settings. Off locally and in the verify scripts: without
   `NEXT_PUBLIC_TURNSTILE_SITE_KEY` the button renders no widget and sends no token, the way `NEXT_PUBLIC_DEMO_DATA`
   switches sample mode, and the local auth server keeps captcha off. The reading: sign-in has no server action (the
   browser posts to Supabase Auth), and an app action that checked the token would leave the public grant open to a
   bot that posts to it directly (section 14, point 2). Considered: an app action calling Cloudflare's siteverify,
   then the grant (bypassable, and a token is single use, so it cannot be checked twice); hCaptcha (Cloudflare fronts
   the app in the second sub-project).
5. **Session keys (decided).** Decision: sessions are verified against the project's JWKS. `getClaims()`, which the
   proxy and `getSessionUser` already call, verifies an ES256 token locally with the key set auth-js caches per
   process for 10 minutes, fetching it again only for a key id it does not hold; on an HS256 secret it calls
   `GET /auth/v1/user` instead, twice a page. So the code is right as it is; the switch is the owner's rotation to an
   ES256 key (section 12), the local stack signs with an ES256 key of its own (decision 18), and section 9p proves the
   local path. Writes keep `getVerifiedUser`, one auth call each, so a session signed out elsewhere is refused at once
   (Phase 2's rule). Considered: the key set from a variable (no fetch, but a rotation needs a redeploy); writes on
   `getClaims` too (a stolen token would outlive its sign-out by the token's lifetime).
6. **The layer-source lifecycle (decided).** Decision: a daily cron, `/api/cron/source-sweep`, on the render sweep's
   pattern (`CRON_SECRET`, a 404 for anyone else), deletes a collection's original files (the `layers`, `assets` and
   `placeholders` folders under its id in the art bucket) once it was deployed at least 90 days ago and its last real
   render finished at least 90 days ago with no real render open; it keeps the thumbnails, the rendered output on
   IPFS, the metadata, the collage and every row, and records `collections.art_sources_deleted_at`. It runs dry,
   logging what it would delete, until `SOURCE_SWEEP_DELETE=1`. `verify:sources` proves it against local storage.
   Considered: R2's lifecycle rules (they count from each object's upload); 90 days from the deploy alone (a
   collection deployed on its placeholder may still be finishing its real art).
7. **The indexer's role (decided).** Decision: the migration creates `cobweb_indexer`, a login role that executes
   `indexer_targets`, `indexer_start`, `indexer_record` and `indexer_summaries` and nothing else; the freshness server
   connects as it through Supabase's session pooler with `postgres` (postgres.js) from `INDEXER_DATABASE_URL`, and the
   owner sets its password outside git. The research (section 8.1): PostgREST switches to a custom role only for a
   JWT whose `role` claim names it, signed by a key the project trusts; under decision 5's ES256 keys that means
   importing a private key and rotating to it, so it signs every session, and the token cannot be revoked short of
   that key. A password on a login role is the smallest credential that is both narrow and rotatable alone.
   Considered: a role JWT signed with the legacy HS256 secret (valid only while that secret stays trusted, which keeps
   anyone holding it able to mint a `service_role` token); the service role key (the Phase 6 Known item).
8. **Alerts as code (decided).** Decision: `/health` gains `status: 'ok' | 'degraded'` and `problems`, one sentence
   per threshold crossed (section 8.2): for a chain, no good read for 60 s or a head more than 120 s old while it has
   hot collections, or more than 10 failed reads in 5 minutes; for its indexer, no good pass for 120 s, collections
   behind for more than 900 s, or more than 5 failed passes in 5 minutes. It stays 200 (freshness decision 17), so
   Railway's deploy check never refuses a deployment during an RPC outage; a monitor keys on the body and is the
   owner's. Considered: 503 when degraded (that deploy check); thresholds on the cumulative counters (they only grow).
9. **Every page renders per request.** Decision: the root layout awaits `connection()`, so no page of the app is
   prerendered (Next's own `/_global-error` apart) and every page's scripts carry its response's nonce; `/[slug]`
   drops `revalidate` and `generateStaticParams`, and `readMintPage` keeps its 60 s cache under the link's tag, so the
   database still sees one read per link a minute.
   Considered: ISR for `/[slug]` under `'self' 'unsafe-inline'` scripts (the page where visitors sign mints would get
   the weakest policy); Vercel's guide to nonces with a CDN cache (a proxy that fetches the cached HTML and writes a
   nonce into every script tag it holds, buffering the page) (section 14, point 1).
10. **One owner of the policy.** Decision: the proxy sets `Content-Security-Policy`; `next.config.ts` drops its framing
    policy and keeps `X-Frame-Options: DENY`, `X-Content-Type-Options` and `Referrer-Policy` on every path, static
    files included. `frame-ancestors 'none'` stays enforced in every mode: in report-only mode it is the enforced
    header beside the report-only policy. API routes get the framing policy alone. Considered: both places setting the
    header (two policies, and Next would read the nonce from whichever request header came first).
11. **Styles allow inline.** Decision: `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`, no nonce:
    RainbowKit renders its theme in a `<style>` element, sonner and Reown's AppKit insert style elements and React's
    `style` attributes are inline, none with a nonce, and a nonce in `style-src` makes browsers ignore
    `'unsafe-inline'`. Considered: a style nonce (each of those would break).
12. **Origins from the app's own sources.** Decision: the policy reads the settings the app reads: the Supabase,
    freshness, storage, media and gateway origins with `mediaBase()`'s and `ipfsGateway()`'s defaults, each chain's
    RPC origin from `availableChains()`, the chain objects whose `rpcUrls.default.http[0]` wagmi's `http()` calls, and
    the wallet connectors' hosts read from the installed packages (section 5.2). A test holds each against its source.
    Considered: a hand list (it drifts the day a chain or a variable changes).
13. **Development and local.** Decision: `NODE_ENV=development` adds `'unsafe-eval'` (React's development build) and
    the dev server's `ws://<host>`; a run off Vercel (`VERCEL` unset, `next start` on a laptop too) adds the dev
    wallet's signer, `http://127.0.0.1:8787`, which its injected provider fetches from the page, and drops
    `upgrade-insecure-requests`, since local Supabase, storage, Anvil and the freshness server answer over http.
    Considered: a switch of its own for the dev wallet (one more variable for a walk-only need).
14. **The mode switch.** Decision: `CSP_MODE` is `enforce`, `report-only` or `off`, read by the proxy at run time;
    unset, it is `enforce` off Vercel and `report-only` on Vercel, so the first hosted deploy reports before it blocks
    and the owner sets `enforce` after a week of reports (section 12). `off` keeps the enforced framing policy alone,
    the way back if the policy ever blocks production. Considered: `enforce` everywhere (a hosted-only origin, R2 or
    the media domain, would break uploads on the first deploy); `report-only` everywhere (walks would never enforce).
15. **Reports.** Decision: `report-uri /api/csp-report` and `report-to csp` with `Reporting-Endpoints`; the endpoint
    takes both report formats up to 16 KB, logs one line per violation (disposition, directive, the blocked origin or
    keyword, the page's path without query) and answers 204, at most 100 lines a minute per instance. Considered: a
    reporting service (an account, and a third party reading page paths); reports in the database (a public write).
16. **Previews.** Decision: preview deployments carry the production policy with their own settings, and the owner
    turns the Vercel Toolbar off for Preview (section 12), since the toolbar does not support `'strict-dynamic'`.
    Considered: dropping `'strict-dynamic'` on previews (a preview would test a weaker policy than production ships).
17. **The cap lives on the profile.** Decision: `profiles.draft_cap` (default 20, 0 to 1,000), read by the trigger
    and the action and changed only by the service role, so support can raise one wallet's cap and a verify that makes
    many collections for one wallet raises its own. Considered: a constant (`verify:local` makes about 42 collections
    for one wallet); a database setting (a knob read on every insert and set outside migrations).
18. **The local session key.** Decision: `supabase/config.toml` sets `signing_keys_path = "./signing_keys.json"`, a
    file `supabase gen signing-key --algorithm ES256` writes once and `.gitignore` keeps out, so the local auth server
    signs ES256 as production will after the rotation. Considered: local HS256 with the key-set path covered only by
    unit tests (every walk and verify would run the path production leaves) (section 14, point 6).
19. **What the purge keeps.** Decision: rows stay (`traits.upload_id` and `render_jobs.placeholder_upload_id` restrict
    deletion, and the tokens and metadata point at them); `collection_sources_deleted` sets the mark after checking the
    rule again under the collection's lock; triggers then refuse a new `uploads` or `render_jobs` row for it;
    `/api/uploads/[id]` serves an original's thumbnail once its file is gone; the Art notice says so. A failed run
    leaves no mark and the next resumes. Considered: a mark per upload (a collection's files go together); deleting
    the thumbnails too (a few kilobytes each, and the Art screens keep their previews).
20. **The indexer's connection.** Decision: `INDEXER_DATABASE_URL` replaces `SUPABASE_URL` and
    `SUPABASE_SERVICE_ROLE_KEY` in the freshness server; a URL that is not `postgres://` or `postgresql://`, has no
    password or names a user other than `cobweb_indexer` (or the pooler's `cobweb_indexer.<project ref>`) refuses the
    start; the two old variables, when set, are logged as unread; `@supabase/supabase-js` leaves `apps/freshness`.
    Considered: both clients (Railway would keep a reason to hold the service role key).
21. **`/health`'s windows.** Decision: failures are counted over the last 5 minutes (`failedTicksRecent`,
    `failedPassesRecent`); the indexer reports its last pass without a failure (`lastGoodPassAt`) and since when
    collections have been behind (`behindSince`); `problems` are sentences an alert can show. Considered: problem codes
    (an alert would need a lookup).
22. **Proof.** Decision: `verify:csp` (10 checks) on a production build in sample mode, which needs no database or
    chain; `verify:sources` (9) against local Supabase and local storage; section 9p of `verify:local` (9);
    `verify:indexer` keeps its 15 through the role. Considered: unit tests alone (a page slipped back to static would
    pass them and ship scripts without a nonce).
23. **Docs and tests.** Decision: sections 10 and 11.

## 3. Scope and tasks

In: as decision 1. The plan's nine tasks, in order: (1) the migration, its types, the local signing key and section 9p
of `verify:local`, with `verify:local` run on the ES256 key before anything else; (2) `csp.ts`, `csp-report.ts` and the
report route with their tests; (3) the proxy, the root layout, `/[slug]`, `next.config.ts`, `proxy.test.ts` and
`verify:csp`; (4) the Turnstile check on the sign-in button; (5) the draft cap in the create action; (6) the source
sweep (core, port, cron, `vercel.json`, the uploads route, the Art notice, the sample switch) and `verify:sources`;
(7) the role in the freshness server and `verify:indexer` through it; (8) `/health`'s status and thresholds; (9) docs,
the full check list and the walk.

## 4. Database (`supabase/migrations/20261017100000_production_hardening.sql`)

### 4.1 The draft cap

```sql
alter table public.profiles
  add column draft_cap integer not null default 20 check (draft_cap between 0 and 1000);

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
```

Security invoker, as `collections_guard_frozen_fields`: a creator counts the rows row-level security shows it, its
own, and the service role sees all of one owner's. `authenticated` keeps `select` on its profile and gains no write;
the service role raises a cap with an update. The column's comment says both.

### 4.2 The indexer's role

```sql
do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles r where r.rolname = 'cobweb_indexer') then
    create role cobweb_indexer with login noinherit nocreatedb nocreaterole nobypassrls connection limit 8;
  end if;
end;
$$;
alter role cobweb_indexer set statement_timeout = '10s';
alter role cobweb_indexer set idle_in_transaction_session_timeout = '30s';
grant usage on schema public to cobweb_indexer;
grant execute on function public.indexer_targets(integer) to cobweb_indexer;
grant execute on function public.indexer_start(uuid, bigint) to cobweb_indexer;
grant execute on function public.indexer_record(integer, bigint, bigint, timestamptz, uuid[], jsonb) to cobweb_indexer;
grant execute on function public.indexer_summaries(integer) to cobweb_indexer;
```

No password: no migration holds a secret, and a role without one cannot log in until the owner sets it. The four
functions are security definer, so the role needs no table grant, and Supabase's default privileges name `anon`,
`authenticated` and `service_role`, never a new role. A role outlives `supabase db reset`, hence the existence check.
`service_role` keeps its execute grants (the verifies and support use them). The role's comment says how it logs in.

### 4.3 The layer sources

- `collections.art_sources_deleted_at timestamptz`, null until the sweep has deleted the originals; the owner reads it
  through the table's select grant; no client role writes it (the reservation migration's column grants stand).
- `public.collections_sources_due(p_limit integer) returns jsonb`, security definer, service role only:
  `[{ collectionId, objects, bytes }]`, oldest deploy first, at most `p_limit`, for each collection whose status is
  `deployed`, with no mark, `deployments.deployed_at` at least 90 days ago, a `real` render job in state `done` whose
  latest `finished_at` is at least 90 days ago and no `real` job outside `done` and `failed`; `objects` and `bytes`
  count its `uploads` rows of kind `layer_image`, `asset` and `placeholder`.
- `public.collection_sources_deleted(p_collection_id uuid) returns boolean`, security definer, service role only:
  locks the collection, refuses one the rule above does not hold for (`23514`, section 9.3), answers false when the
  mark is set already and true when it sets `art_sources_deleted_at = now()`.
- `public.refuse_after_sources_deleted()`, a security definer trigger function behind `before insert` triggers
  `uploads_refuse_after_sources_deleted` and `render_jobs_refuse_after_sources_deleted`: a row for a marked collection
  is refused (`23514`). The app reaches neither path after a final render, since the art stays locked; the triggers
  stop a direct call from writing rows whose files are gone.

90 days is written once in each function, with a comment naming `SOURCE_RETENTION_DAYS` in `source-sweep.ts`.

### 4.4 Types (`apps/web/src/lib/database.types.ts`, by hand)

`profiles` gains `draft_cap: number`; `collections` gains `art_sources_deleted_at: string | null`; Functions gain
`collections_sources_due` and `collection_sources_deleted` with `Json` and `boolean` answers.

### 4.5 Auth settings (`supabase/config.toml`, `.gitignore`)

- `[auth]` sets `signing_keys_path = "./signing_keys.json"`; `.gitignore` gains `supabase/signing_keys.json`; the CLI
  then signs local sessions with that ES256 key and serves it at `/auth/v1/.well-known/jwks.json`.
- `[auth.captcha]` stays off. A commented `[remotes.cobweb.auth.captcha]` block (`enabled = true`, `provider =
  "turnstile"`, `secret = "env(SUPABASE_AUTH_CAPTCHA_SECRET)"`) states the hosted check; the owner uncomments it in
  the change that turns captcha on (section 12), since a `supabase config push` with it on before the site key is live
  would lock every sign-in out, and one without it turns the hosted check off (section 14, point 7).

## 5. The Content-Security-Policy

### 5.1 What Next 16.3 does (research)

- `app-render.js` reads `content-security-policy`, else `content-security-policy-report-only`, from the request's
  headers and takes the first `'nonce-<value>'` of its `script-src`, else `default-src` (`getScriptNonceFromHeader`).
  With one, Next puts it on its framework and page scripts, the inline flight data and any `<Script nonce>`. The app
  has no `next/script`, no inline script and no `dangerouslySetInnerHTML` of its own.
- A nonce exists only for a page rendered for a request. A prerendered or ISR page was rendered without one, so its
  scripts are blocked (the bundled guide: every page must render dynamically; Partial Prerendering is incompatible).
  Today `/[slug]` (built `●`), `/_not-found` and `/_global-error` are prerendered.
- `proxy.ts` runs on Node.js (Next 16 refuses a `runtime` option there) before every request its matcher admits;
  `request.cookies.set` writes into `request.headers`, which `NextResponse.next({ request })` forwards as
  `x-middleware-request-<name>`, so a header set there reaches the render; `unstable_doesProxyMatch` tests a matcher.
- Turbopack changes nothing in production; in development React needs `'unsafe-eval'`, and hot reload opens a
  websocket to the dev server.
- `experimental.sri` adds integrity to script files and leaves the inline flight scripts, so it cannot keep a page
  static under a strict policy. Vercel's guide to nonces with a CDN cache rewrites cached HTML in middleware and
  itself recommends nonces at render time.

### 5.2 The policy (`apps/web/src/lib/security/csp.ts`, pure)

```ts
export type CspMode = 'enforce' | 'report-only' | 'off'
export type RouteClass = 'page' | 'api'
export type CspEnv = Record<string, string | undefined>
export type CspSources = { supabase: string | null; freshness: string | null; storage: string | null
  media: string | null; gateway: string; rpcs: string[]; turnstile: boolean; development: boolean; local: boolean
  host: string }
export const CSP_REPORT_PATH = '/api/csp-report'
export const FRAME_POLICY = "frame-ancestors 'none'"
export const DEV_WALLET_ORIGIN = 'http://127.0.0.1:8787'
export const WALLET_CONNECT_ORIGINS: readonly string[]
export const METAMASK_ORIGINS: readonly string[]
export function cspModeOf(env: CspEnv): CspMode
export function routeClassOf(pathname: string): RouteClass
export function originOf(url: string | undefined): string | null
export function cspSourcesOf(env: CspEnv, chains: readonly ChainConfig[], host: string): CspSources
export function pagePolicy(nonce: string, sources: CspSources, mode: 'enforce' | 'report-only'): string
export function newNonce(): string
export function cspHeaders(input: { mode: CspMode; routeClass: RouteClass; nonce: string; sources: CspSources
  reportOrigin: string }): { request: Record<string, string>; response: Record<string, string> }
```

- `cspModeOf`: `CSP_MODE` when it is one of the three; else `report-only` when `VERCEL` is `1`, `enforce` otherwise.
  `routeClassOf`: `api` for `/api` and below, `page` otherwise. `newNonce`: 16 random bytes, base64.
- `cspSourcesOf`: `supabase` from `NEXT_PUBLIC_SUPABASE_URL`; `freshness` from `NEXT_PUBLIC_FRESHNESS_URL`; `storage`
  from `ART_S3_ENDPOINT` (path style, as every documented configuration sets it, keeps presigned URLs on the
  endpoint's origin); `media` from `MINT_PAGE_MEDIA_URL`, else the Supabase origin; `gateway` from
  `IPFS_GATEWAY_URL`, else `https://ipfs.io`; `rpcs` the distinct origins of each `availableChains()` entry's
  `viem.rpcUrls.default.http[0]`; `turnstile` when `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is set; `development` when
  `NODE_ENV` is `development`; `local` when `VERCEL` is not `1`. It reads no secret: each value reaches the browser
  anyway.
- `WALLET_CONNECT_ORIGINS`: `https://rpc.walletconnect.org`, `wss://relay.walletconnect.org`,
  `https://pulse.walletconnect.org`, `https://api.web3modal.org`, `https://verify.walletconnect.org`,
  `https://verify.walletconnect.com` (`@walletconnect/core` and `@walletconnect/ethereum-provider` 2.21.1 and
  `@reown/appkit` 1.7.8, which RainbowKit 2.2.11's WalletConnect option opens; Verify loads its attestation in a
  hidden frame). `METAMASK_ORIGINS`: `https://metamask-sdk.api.cx.metamask.io`, `wss://metamask-sdk.api.cx.metamask.io`
  and `https://mm-sdk-analytics.api.cx.metamask.io` (`@metamask/sdk` 0.33.1, which RainbowKit's MetaMask option uses
  with the extension or on a phone). Each list's comment names its versions; an upgrade reads them again.
- `pagePolicy`, in this order, each source list deduplicated and without null origins:

```text
default-src 'self';
script-src 'self' 'nonce-<n>' 'strict-dynamic' [turnstile: https://challenges.cloudflare.com]
  [development: 'unsafe-eval'];
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
img-src 'self' data: blob: <storage> <media> <gateway> https://api.web3modal.org;
media-src 'self' blob: <storage> <media> <gateway>;
font-src 'self' https://fonts.gstatic.com;
connect-src 'self' <supabase> <freshness> <storage> <gateway> <rpcs> <WALLET_CONNECT_ORIGINS> <METAMASK_ORIGINS>
  [local: http://127.0.0.1:8787] [development: ws://<host>];
frame-src https://verify.walletconnect.org https://verify.walletconnect.com
  [turnstile: https://challenges.cloudflare.com];
object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none';
[enforce, not local: upgrade-insecure-requests;]
report-uri /api/csp-report; report-to csp
```

  Block explorers are links, never fetched, so they are absent. The two Google hosts serve the Inter font AppKit's
  modal imports. Cloudflare's host in `script-src` serves browsers without `'strict-dynamic'`; the others admit
  Turnstile's script because the app's nonced bundle inserts it.
- `cspHeaders`: for `page` in `enforce`, the request gets `content-security-policy` and `x-nonce`, the response
  `Content-Security-Policy` and `Reporting-Endpoints: csp="<reportOrigin>/api/csp-report"`; in `report-only`, the
  request gets `content-security-policy-report-only` and `x-nonce`, the response `Content-Security-Policy:
  frame-ancestors 'none'`, `Content-Security-Policy-Report-Only` and `Reporting-Endpoints`; in `off`, the response
  gets the framing policy alone. For `api`, the response gets the framing policy alone in every mode. The request
  never carries the framing policy, where Next would read no nonce.

### 5.3 The proxy (`apps/web/src/proxy.ts`, changed)

```ts
export async function proxy(request: NextRequest): Promise<NextResponse>
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|assets/|api/csp-report|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
```

In order: delete any `content-security-policy`, `content-security-policy-report-only` and `x-nonce` the request
arrived with, so no client chooses the nonce Next applies; work out the mode, the class, a nonce and the sources
(`availableChains()`, `request.nextUrl.host`, `request.nextUrl.origin` for the report URL); set the request headers on
`request.headers`; refresh the session exactly as today (`createServerClient`, `NextResponse.next({ request })` in
`setAll`, `getClaims()` with nothing between them); set the response headers on the final `response`. The matcher
skips the report endpoint, whose posts need no session.

### 5.4 Rendering per request

- `apps/web/src/app/layout.tsx`: `RootLayout` becomes async and awaits `connection()` from `next/server` first, so
  every page, `/_not-found` included, renders per request. `/_global-error` stays Next's prerendered page (section 12).
- `apps/web/src/app/[slug]/page.tsx`: `revalidate` and `generateStaticParams` go; the doc comment says the page renders
  per request for its nonce and reads its document through `readMintPage`'s 60 s cache under `mint-page:<slug>`, which
  the Mint page tab expires. The build lists `ƒ /[slug]`.

### 5.5 Reports (`apps/web/src/lib/security/csp-report.ts`, pure; `apps/web/src/app/api/csp-report/route.ts`)

```ts
export const REPORT_MAX_BYTES = 16_384, REPORT_LINES_PER_MINUTE = 100
export type Violation = { disposition: 'enforce' | 'report'; directive: string; blocked: string; page: string }
export function violationsOf(contentType: string, body: unknown): Violation[]
export function violationLine(violation: Violation): string
export function reportLimiter(perMinute?: number): { allow(now: number): boolean; dropped(now: number): number | null }
// route.ts
export async function POST(request: Request): Promise<Response>
```

`violationsOf` reads `application/csp-report` (`{ "csp-report": { ... } }`) and `application/reports+json` (a list of
`{ type: "csp-violation", body: { ... } }`); `blocked` is the blocked URL's origin or its keyword (`inline`, `eval`,
`data`, `blob`), `page` the document's path without query or fragment, each at most 200 characters. The route
answers 415 for another type, 413 above 16 KB, 400 for a body that does not parse and 204 otherwise, logging each
violation with `console.warn` while the limiter allows and, once a minute after it refuses, the count it dropped.

### 5.6 `next.config.ts`

`headers()` keeps `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` and `Referrer-Policy:
strict-origin-when-cross-origin` on `/:path*` and drops `Content-Security-Policy`, which the proxy owns.

## 6. Sign-in, sessions and the draft cap

### 6.1 The Turnstile check (`apps/web/src/lib/turnstile.ts`, `apps/web/src/components/auth/use-turnstile.ts`)

```ts
// turnstile.ts, new
export const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
export const TURNSTILE_LOAD_MS = 15_000
export type TurnstileApi = { render(container: HTMLElement, options: Record<string, unknown>): string
  reset(widgetId: string): void; remove(widgetId: string): void }
export function turnstileSiteKey(value?: string): string | null
export function loadTurnstile(doc?: Document, timeoutMs?: number): Promise<TurnstileApi>
// use-turnstile.ts, new, 'use client'
export function useTurnstile(siteKey: string | null): { container: RefCallback<HTMLDivElement>
  token(): string | null; ready: boolean; failed: boolean; reset(): void }
```

- `turnstileSiteKey` defaults to `process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY`, written literally so Next inlines it at
  build, as `NEXT_PUBLIC_DEMO_DATA` is; blank is null.
- `loadTurnstile` appends the script once, resolves with `window.turnstile` when it loads and rejects on its error or
  after 15 s. The app's nonced bundle inserts it, which `'strict-dynamic'` admits.
- `useTurnstile` renders the widget into its container with `sitekey`, `action: 'sign-in'`, `appearance:
  'interaction-only'`, `size: 'flexible'`, `theme: 'dark'` and `'refresh-expired': 'auto'`; its callbacks keep the
  latest token (read through `token()` when the signature returns, since a token can refresh while the wallet is
  open), clear it on expiry and set `failed` on an error or a failed load; `reset()` asks for a new token. Without a
  site key it renders nothing and `ready` is true.

### 6.2 The sign-in button (`apps/web/src/components/auth/sign-in-button.tsx`, changed; `sign-in-failure.ts`, new)

```ts
export type SignInFailure = 'rejected' | 'captcha' | 'other'
export function signInFailureOf(error: unknown): SignInFailure
```

Once the wallet is connected, the widget's container sits above "Sign in as ..."; while a site key is set and no token
is held, the button is disabled and reads section 9.3's label, and after a failed check the line under it says so.
`signIn` sends `options: { captchaToken }` when it holds a token and resets the check after any refusal, since
Supabase spends a token once it is sent. `signInFailureOf`: a wallet rejection (`/reject|denied/i` or code 4001) is
`rejected` ("Signature request cancelled.", as today), an error whose `code` is `captcha_failed` is `captcha`, anything
else `other` ("Sign-in failed. Try again.", as today).

### 6.3 Sessions

`getSessionUser`, `getVerifiedUser` and the proxy's `getClaims()` are unchanged: with the local key (section 4.5) and
the owner's rotation (section 12) they verify locally, as decision 5 reads. `getVerifiedUser`'s doc comment gains that
writes keep the auth server's check after the rotation.

### 6.4 The draft cap (`apps/web/src/app/actions/collections.ts`, `apps/web/src/lib/collections.ts`)

```ts
export const DRAFT_CAP_DEFAULT = 20
export const DRAFT_CAP_REFUSAL = 'This wallet holds its limit of collections that are not deployed.'
export function draftCapSentence(cap: number): string
export function draftCapOf(error: { code?: string; message?: string; details?: string } | null): number | null
```

After the session check and the form's validation, `createCollection` reads the creator's `profiles.draft_cap` and
the count of its collections whose status is not `deployed` (row-level security limits both to its own) and answers
`{ formError: draftCapSentence(cap) }` at the cap. An insert the trigger refuses (`draftCapOf` reads the cap from
`23514`, the message and `details`, else null) answers the same. The dialog shows it in its existing alert.

## 7. The layer sources

### 7.1 The core (`apps/web/src/lib/storage/source-sweep.ts`, pure)

```ts
export const SOURCE_RETENTION_DAYS = 90, SOURCES_PER_RUN = 20
export const SOURCE_FOLDERS = ['layers', 'assets', 'placeholders'] as const
export type DueCollection = { collectionId: string; objects: number; bytes: number }
export type SourceSweepDeps = { due(limit: number): Promise<DueCollection[]>
  list(prefix: string): AsyncIterable<{ key: string }[]>; remove(keys: string[]): Promise<void>
  mark(collectionId: string): Promise<boolean> }
export type SourceSweepReport = { dryRun: boolean; due: number; deleted: number; marked: number; failed: string[] }
export function sourcePrefixes(collectionId: string): string[]
export function sourceSweepDryRun(env: Record<string, string | undefined>): boolean
export async function sweepSources(deps: SourceSweepDeps,
  options: { dryRun: boolean; limit?: number; log?: (line: string) => void }): Promise<SourceSweepReport>
```

`sourcePrefixes` gives `<id>/layers/`, `<id>/assets/` and `<id>/placeholders/`, never `thumbnails/`. `sweepSources`
asks `due(limit)` (20 by default); for each collection it lists the three prefixes; a dry run logs the count and the
recorded size and deletes nothing; otherwise it removes the keys a page at a time, lists again to confirm none is
left and calls `mark`. A failure for one collection is logged and listed in `failed`, leaves no mark, and the run goes
on. `sourceSweepDryRun` is true unless `SOURCE_SWEEP_DELETE` is `1`.

### 7.2 The port and the cron

- `apps/web/src/lib/storage/source-sweep-deps.ts` (server only): `sourceSweepDeps(): SourceSweepDeps` over
  `listObjectPages` and `deleteObjects` (the art bucket) and `createServiceClient()` for the two functions;
  `createServiceClient`'s doc comment gains this caller.
- `apps/web/src/app/api/cron/source-sweep/route.ts`: `maxDuration = 300` and `GET(request)`: `cronAuthorized` or 404,
  then `sweepSources(sourceSweepDeps(), { dryRun: sourceSweepDryRun(process.env), log })`, answering the report as
  JSON; a thrown failure is logged masked and answered with an empty 500, as `/api/cron/render-sweep`.
- `apps/web/vercel.json`: `{ "path": "/api/cron/source-sweep", "schedule": "30 7 * * *" }` beside the render sweep.

### 7.3 Serving and the notice

- `apps/web/src/lib/storage/uploads-service.ts` gains `servedKeyOf(input: { variant: 'original' | 'thumb'; kind:
  UploadKind; key: string; thumbnailKey: string | null; sourcesDeleted: boolean }): string | null`.
  `GET /api/uploads/[id]` reads the collection's `art_sources_deleted_at` with the row and signs `servedKeyOf`'s key,
  or answers 404 for null (an original with no thumbnail after the purge), which `Artwork` draws as its pattern.
- `ArtLiveNotice` gains `sourcesDeleted: boolean` and, for a deployed collection with the mark, shows section 9.3's
  line; `ArtLayout` passes `collection.art_sources_deleted_at !== null`.

## 8. The freshness server

### 8.1 The role (`apps/freshness/src/config.ts`, `indexer-db.ts`, `server.ts`, `index.ts`)

```ts
// config.ts, changed
export const INDEXER_ROLE = 'cobweb_indexer'
export type IndexerOptions = { databaseUrl: string; passMs?: { behind: number; fast: number; idle: number }
  targetsEveryMs?: number }
export function indexerOptionsOf(env: Record<string, string | undefined>): IndexerOptions | null
export function checkIndexerOptions(options: IndexerOptions): IndexerOptions
export function unreadIndexerVariables(env: Record<string, string | undefined>): string[]
// indexer-db.ts, changed
export type IndexerFunction = 'indexer_targets' | 'indexer_start' | 'indexer_record' | 'indexer_summaries'
export type IndexerCall = (fn: IndexerFunction, args: readonly unknown[]) => Promise<unknown>
export function indexerDbOf(call: IndexerCall): IndexerDb
export function postgresIndexerDb(options: IndexerOptions): IndexerDb & { end(): Promise<void> }
```

- `indexerOptionsOf` reads `INDEXER_DATABASE_URL` (blank is unset; unset leaves the indexer off).
  `checkIndexerOptions` refuses, as a `BaseError` named `ConfigurationError` whose sentence never carries the value,
  a URL that is not `postgres://` or `postgresql://`, one without a password and one whose user is not
  `cobweb_indexer` or `cobweb_indexer.<project ref>`. `unreadIndexerVariables` names `SUPABASE_URL` and
  `SUPABASE_SERVICE_ROLE_KEY` when set; `index.ts` logs them as unread and starts.
- `indexerDbOf` keeps today's mapping (blocks as numbers, the sync time as ISO, the summaries' shape) over a `call`
  that answers a function's `jsonb`. `postgresIndexerDb` makes that call on `postgres(databaseUrl, { max: 4,
  prepare: false, connect_timeout: 10, idle_timeout: 60 })` as `select public.<fn>(<arguments with casts>) as answer`,
  abandons it after `DB_TIMEOUT_MS` (10 s, the role's `statement_timeout` too) and throws `IndexerWriteError` with the
  Postgres code (`23514`; `42501`; `42883` for a missing function; `28P01` for a refused password), `TIMEOUT` or
  `NETWORK`, with `gap` for the two sentences as today. `prepare: false` keeps it valid on either pooler mode.
- `startFreshness` builds `postgresIndexerDb(checkIndexerOptions(...))` before it listens and ends it in `close()`
  after the indexers stop; the start line reads section 9.3's sentences.
- `apps/freshness/package.json`: `"postgres": "^3.4.5"` joins and `@supabase/supabase-js` leaves; `apps/web` gains
  `postgres` as a dev dependency for its verify scripts.

The research behind decision 7: Supabase's gateway hands PostgREST the request's JWT, and PostgREST switches to the
role its `role` claim names when `authenticator` is a member of it; Supabase's signing-key guide says minting your own
token needs a private key imported as a standby key and then rotated to, which makes it the key every session is
signed with. `supabase gen bearer-jwt --role` can mint one locally only because the local key is on the laptop.

### 8.2 `/health` (`apps/freshness/src/health.ts`, `recent.ts`, `chain-reader.ts`, `indexer.ts`, `server.ts`)

```ts
// recent.ts, new, pure
export const RECENT_WINDOW_MS = 300_000
export function recentCounter(windowMs?: number, cap?: number): { note(now: number): void; count(now: number): number }
// health.ts, changed
export const HEALTH_LIMITS = { readerStaleS: 60, readerLagS: 120, readerFailures: 10, indexerStaleS: 120,
  indexerBehindS: 900, indexerFailures: 5 } as const
export type ReaderHealth = { /* as today */ failedTicksRecent: number }
export type IndexerHealth = { /* as today */ failedPassesRecent: number; lastGoodPassAt: string | null
  behindSince: string | null }
export type HealthBody = { status: 'ok' | 'degraded'; problems: string[]; startedAt: string; hot: number
  chains: ChainHealth[]; wallet: { windows: number; answered: number; waiting: number } }
export function healthProblems(chains: readonly ChainHealth[], now: number, startedAt: number,
  limits?: typeof HEALTH_LIMITS): string[]
```

- `recentCounter` keeps the times of at most 1,000 failures and counts those inside the window.
- The reader notes each failed tick and each noted factory failure. The indexer notes each counted failure, sets
  `lastGoodPassAt` at the end of a pass without one, and at the end of every pass sets `behindSince` to now when its
  `behind` count rises from 0 and to null at 0.
- `healthProblems`, per chain, one sentence for each of: with hot collections, no good tick for more than 60 s
  (counted from the start while there was none), or a head more than 120 s old; more than 10 failed reads in 5
  minutes; with the indexer on, no good pass for more than 120 s (from the start while there was none), collections
  behind for more than 900 s, or more than 5 failed passes in 5 minutes. `server.ts`'s `health()` sets `status` to
  `degraded` when it answers any. `healthAnswer` stays 200 with `no-store`. The comment above `HEALTH_LIMITS`
  documents each threshold and the monitor's keyword.

## 9. Sample mode, stage rules and copy

### 9.1 Sample mode

The Art screens read `?sources=deleted` to show the notice; the sign-in button follows the site key in sample mode
too; the policy is the same in both modes.

### 9.2 Stage rules

Unchanged. The purge reads only deployed collections whose final render is done, whose art the stage rules already
keep locked.

### 9.3 Copy

| Where | When | Sentence |
| --- | --- | --- |
| Create collection dialog | The wallet holds its cap | This wallet already has <cap> collections that are not deployed, the most it can hold. Delete a draft or deploy one, then create this one. |
| Database, `collections` insert | The same, from any client | This wallet holds its limit of collections that are not deployed. (`detail`: the cap) |
| Sign-in button | A site key is set and no token is held yet | Checking your browser… |
| Sign-in, under the button | The check could not load or failed | The browser check could not run. Reload the page and try again. |
| Sign-in toast | Supabase answers `captcha_failed` | The browser check did not pass. Try again. |
| Art notice | A deployed collection's originals are deleted | The original art files were deleted 90 days after the deploy. The rendered art and its metadata stay on IPFS. |
| Database, `uploads` and `render_jobs` insert | Its collection is marked | This collection's art files were deleted 90 days after its deploy, so its art cannot change. |
| Database, `collection_sources_deleted` | Not due | This collection's art files are not due for deletion. |
| Source sweep log | A dry run | Source sweep (dry run): <collection id> has <n> original files (<size>) due; nothing was deleted. |
| Source sweep log | Deleted | Source sweep: deleted <n> original files (<size>) of <collection id>. |
| Source sweep log | Failed | Source sweep: <collection id> failed and is tried again tomorrow: <error summary> |
| CSP report log | Each violation | CSP <enforce or report>: <directive> blocked <origin or keyword> on <path> |
| CSP report log | Over 100 a minute | CSP: <n> more reports in the last minute were not logged. |
| Freshness start, refused | Not a Postgres URL | INDEXER_DATABASE_URL must be a postgres:// or postgresql:// connection string. |
| Freshness start, refused | No password | INDEXER_DATABASE_URL has no password; include the cobweb_indexer role's password. |
| Freshness start, refused | Another user | INDEXER_DATABASE_URL must connect as the cobweb_indexer role. |
| Freshness start | Indexer on | The indexer runs on <chain names> as cobweb_indexer. |
| Freshness start | Indexer off | The indexer is off: set INDEXER_DATABASE_URL to run it. |
| Freshness start | Old variables set | No longer read, remove from this service: <SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, as set>. |
| `/health` problem | No good read | <chain>: no good read for <n> s (limit 60 s). |
| `/health` problem | Old head | <chain>: the newest block is <n> s old (limit 120 s). |
| `/health` problem | Failed reads | <chain>: <n> failed reads in 5 minutes (limit 10). |
| `/health` problem | No good pass | <chain>: no good index pass for <n> s (limit 120 s). |
| `/health` problem | Behind | <chain>: <n> collections behind for <m> s (limit 900 s). |
| `/health` problem | Failed passes | <chain>: <n> failed index passes in 5 minutes (limit 5). |

## 10. Testing

- Unit tests in `apps/web` (new unless marked):
  - `lib/security/csp.test.ts`: `cspModeOf` for each value, unset on and off Vercel and an unknown value;
    `routeClassOf`; `originOf` (null for blank or unparsable, the origin of a URL with a path); `cspSourcesOf` (each
    variable and its default; `media` and `gateway` equal to `new URL(mediaBase()).origin` and
    `new URL(ipfsGateway()).origin` under the same settings; every chain of `lib/wagmi.ts`'s `chains` with its RPC
    origin in `rpcs`; test chains only where shown); `pagePolicy` (the directives in production enforce mode, the
    nonce in `script-src` alone, `'unsafe-eval'` and `ws://` only in development, the dev wallet only off Vercel,
    `upgrade-insecure-requests` only when enforced on Vercel, Cloudflare only with a site key, no duplicates);
    `cspHeaders` for each class and mode (the request header's name, never the framing policy on the request,
    `Reporting-Endpoints`); `newNonce` (24 base64 characters, two calls differ).
  - `proxy.test.ts` (`@supabase/ssr` mocked): for each class and mode, the response's headers and the forwarded
    request header (`x-middleware-request-content-security-policy` or its report-only twin) carrying the response's
    nonce; a client's own policy header replaced; two requests, two nonces; `getClaims` called once;
    `unstable_doesProxyMatch` admitting `/`, `/collections`, `/night-owls` and `/api/uploads/x` and refusing
    `/_next/static/x.js`, `/demo/tokens/1.svg` and `/api/csp-report`.
  - `lib/security/csp-report.test.ts`: both formats; origins and keywords; the path without its query; 200-character
    fields; an unknown type; the limiter at 100 a minute and its dropped count.
  - `lib/turnstile.test.ts` on a fake document: one script for two loads; resolved on load; rejected on error and
    after 15 s; a blank site key is null. `components/auth/sign-in-failure.test.ts`: the three kinds.
  - `lib/storage/source-sweep.test.ts` on fakes: the prefixes; a dry run deletes nothing; a run deletes the three
    folders page by page and marks after an empty list; a failed removal leaves no mark and the next collection runs;
    the limit; `sourceSweepDryRun`.
  - Changed: `lib/collections.test.ts` (`draftCapSentence`; `draftCapOf` for the refusal, another `23514` and a
    missing detail), `lib/storage/uploads-service.test.ts` (`servedKeyOf` for each variant with and without the mark
    and a thumbnail).
- Unit tests in `apps/freshness`: `config.test.ts` (changed: a pooler URL and a local URL give the options, unset gives
  null, each refusal's sentence carries no part of the URL, `unreadIndexerVariables`); `indexer-db.test.ts` (rewritten
  on a fake `call`: each function's arguments and casts, answers mapped as today, a Postgres code, the gap sentences,
  `TIMEOUT` and `NETWORK`); `recent.test.ts` (new: inside and outside the window, the cap); `health.test.ts` (changed:
  each threshold at its limit reads ok and one past it reads its sentence, the start's grace, no hot collection means
  no reader problem, an indexer off none of its own); `indexer.test.ts` (changed: `lastGoodPassAt` only after a pass
  without failure, `behindSince` set and cleared, `failedPassesRecent`); `chain-reader.test.ts` (changed:
  `failedTicksRecent`); `server.test.ts` (changed: `/health` answers 200 with `status` and `problems`).
- `verify:local`, a section 9p of nine checks (404, from the 395 of the indexer's run), with the setup raising the
  `draft_cap` of the two wallets the earlier sections use to 1,000 through the service role, and `postgres` on
  `supabase status`'s `DB_URL` for the catalog reads:
  1. "draft cap: a wallet's profile reads draft_cap 20, which neither its owner nor anon can change"
  2. "draft cap: a fresh wallet's 21st collection not deployed is refused with 23514, the cap's message and detail 20;
     once the service role marks one deployed the 21st lands; a cap raised to 22 admits one more"
  3. "sessions: a wallet's access token is signed with ES256 under a key id /auth/v1/.well-known/jwks.json lists"
  4. "sessions: getClaims verifies that token five times with at most one key-set read and no call to
     /auth/v1/user, and refuses it with its signature altered"
  5. "indexer role: cobweb_indexer can log in, neither inherits nor bypasses row-level security, and executes the four
     indexer functions"
  6. "indexer role: it reads no table or view in public, private, auth or storage, and executes no other function anon
     cannot"
  7. "sources: collections_sources_due and collection_sources_deleted run for the service role only"
  8. "sources: the owner reads art_sources_deleted_at and no client sets it"
  9. "sources: once a collection is marked, a new uploads row and a new render job for it are refused"
- `verify:csp` (new, `scripts/verify-csp.ts`, `"verify:csp": "node --conditions=react-server --import
  ./scripts/resolve-ts.mjs scripts/verify-csp.ts"`). It needs a production build made in sample mode
  (`NEXT_PUBLIC_DEMO_DATA=1 pnpm --filter @cobweb/web build`) and nothing else; it starts `next start` on port 3210
  with `CSP_MODE=enforce` and `VERCEL` unset, and reads each `<script>` of a JavaScript type in the HTML:
  1. "setup: the build answers on 3210 in sample mode, /night-owls rendering the sample page"
  2. "sign-in page: / carries Content-Security-Policy with a nonce beside 'strict-dynamic' in script-src, no
     'unsafe-eval' and no nonce in style-src, and every script carries that nonce"
  3. "per request: a second / carries another nonce, which its scripts carry"
  4. "mint page: /night-owls renders per request with every script on its response's nonce, and connect-src lists
     each launch chain's RPC origin, the build's Supabase and freshness origins and the WalletConnect relay"
  5. "dashboard: /collections without a session answers its redirect to / with the page policy"
  6. "not found: /no/such/page answers 404 with the page policy and nonced scripts"
  7. "API and static: /api/uploads/<a random id> answers 404 with frame-ancestors 'none' alone, and /icon.svg carries
     X-Frame-Options DENY and no policy"
  8. "report-only: started again with CSP_MODE=report-only, / carries frame-ancestors 'none' alone as its enforced
     policy and the full policy as Content-Security-Policy-Report-Only, its scripts on that policy's nonce, with
     Reporting-Endpoints naming /api/csp-report"
  9. "reports: a report-uri body and a Reporting API body each answer 204 and log one line with the directive, the
     blocked origin and the path; 17 KB answers 413 and another type 415"
  10. "stop: the server stops and port 3210 is free"
- `verify:sources` (new, `scripts/verify-sources.ts`, same command shape), against local Supabase and local storage,
  recording deploys as section 9j of `verify:local` does and moving timestamps with the service role:
  1. "setup: a creator with three collections recorded as deployed, each with recorded originals and thumbnails in
     the art bucket: A deployed and finally rendered 91 days ago, B deployed 91 days ago and rendered 10 days ago, C
     deployed 91 days ago with only its placeholder rendered"
  2. "due: collections_sources_due lists A alone with its originals' count and size; neither a signed-out caller nor
     the creator can call it or collection_sources_deleted"
  3. "dry run: the sweep reports A's originals and deletes nothing"
  4. "sweep: A's layers, assets and placeholders are deleted, its thumbnails stay, it is marked, and B's and C's
     objects are untouched"
  5. "again: a second run finds nothing due and deletes nothing"
  6. "resume: with A's mark cleared and one original put back, a run deletes it and marks A again"
  7. "not due: collection_sources_deleted on B is refused with its sentence"
  8. "guards: a new uploads row and a new render job for A are refused with the guard's sentence"
  9. "cleanup: the run leaves no object, row or user"
- `verify:indexer` keeps its 15 checks: the server runs with `indexer: { databaseUrl, ... }` for `cobweb_indexer` at a
  password the run sets through `DB_URL` and clears at the end (or a local `INDEXER_DATABASE_URL` already set); check
  1 adds "with its indexer on as cobweb_indexer" and check 14 adds "status ok with no problems, its last good pass and
  no failed pass in the last 5 minutes". `verify:freshness` keeps 16, check 2 adding "status ok with no problems".
- The browser walk, recorded in the landing note, with a fresh dev wallet against local Supabase on the ES256 key,
  Anvil, the freshness server with `INDEXER_DATABASE_URL` and the web app in development with `CSP_MODE` unset (so
  enforced): (1) sign in, then Collections, a create, a layer folder uploaded to local storage with its thumbnails
  through `/api/uploads`, Lock and upload, Deploy, each Manage tab with the Mint page tab's media and Preview, and the
  public page with its polls, a mint and token art, the console showing no violation; (2) RainbowKit's modal with the
  WalletConnect QR view and MetaMask's, no violation; (3) `NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA`
  signs in through the widget and `2x00000000000000000000AB` shows the failure line, no violation from Cloudflare's
  frame; (4) under `report-only` a script added from the console runs and its report line reaches the server log,
  under `enforce` it is blocked and reported; (5) the dev wallet at its cap, lowered through the service role, gets the
  refusal in the dialog; (6) a marked collection shows the Art notice and its thumbnails; (7) `/health` reads `ok`, then
  `degraded` with "Anvil: no good read ..." about a minute after Anvil stops, and `ok` again after it returns; (8) at
  390 px the sign-in step with the widget fits; (9) step 1's public page and one Manage tab on `next start`.
- `pnpm typecheck && pnpm lint && pnpm test && pnpm format:check`, `pnpm build` (listing `ƒ /[slug]` and no `●` page)
  and every verify script at its count.

## 11. Documentation

- `CLAUDE.md`, commands: before `supabase start`, `supabase gen signing-key --algorithm ES256   # once: the local
  ES256 session key in supabase/signing_keys.json (gitignored)`; after `verify:indexer`, `pnpm --filter @cobweb/web
  verify:csp   # the policy on a sample-mode production build: a nonce on every page and script, the origins,
  report-only, the report endpoint` and `pnpm --filter @cobweb/web verify:sources   # the source sweep against local
  Supabase and local storage: due, dry run, delete, resume, the guards`.
- `apps/web/.env.example`: `CSP_MODE` ("enforce, report-only or off; unset is enforce locally and report-only on
  Vercel"), `NEXT_PUBLIC_TURNSTILE_SITE_KEY` ("Cloudflare Turnstile's site key, public, read at build time; empty
  turns the sign-in check off, as locally; the test key 1x00000000000000000000AA always passes"),
  `SOURCE_SWEEP_DELETE` ("1 lets the daily source sweep delete; anything else runs it dry").
- `apps/freshness/.env.example`: `INDEXER_DATABASE_URL` in place of the two Supabase variables ("The indexer's
  connection as the cobweb_indexer role, a secret: Supabase's session pooler string with the user
  cobweb_indexer.<project ref> and the role's password. Empty: the indexer is off. Local:
  postgresql://cobweb_indexer:<password>@127.0.0.1:54322/postgres, after `alter role cobweb_indexer with password
  '<password>';` in local Studio's SQL editor").
- `supabase/config.toml` and `.gitignore`: section 4.5.
- `docs/MASTER_PLAN.md`, dated notes only: the Phase 7 status line becomes "in progress", with "Production hardening
  in code (first sub-project of three) landed on <date>; see
  [specs/2026-10-17-production-hardening.md](specs/2026-10-17-production-hardening.md).", what exists, "Known:" with
  section 12's items and the owner's checklist; under Decisions, a new "### Security" with dated decisions for the
  policy (decisions 2, 9 and 14), wallet sign-in (decisions 3 and 4), session keys (decision 5) and the art source
  lifecycle (decision 6), and under Hosting "**The indexer's database role** (decided 17 October 2026)" (decision 7)
  and "**Health alerts**" (decision 8). Under Art, after "Originals are uploaded and kept", "(17 October 2026: until
  90 days after the deploy and the final render; see the art source lifecycle.)".
- Dated notes: in [2026-10-16-mint-page-live-data.md](2026-10-16-mint-page-live-data.md) decision 2 and section 12
  (the page renders per request; the policy with its origins landed); in
  [2026-10-16-indexer-overview.md](2026-10-16-indexer-overview.md) decision 3 and section 12 (the role replaces the
  service role key and supabase-js); in [2026-10-16-freshness-server.md](2026-10-16-freshness-server.md) section 6.9
  (`status` and `problems`); in [2026-10-08-art-upload.md](2026-10-08-art-upload.md) section 2 (the lifecycle
  deletion landed, without R2's rules); in [2026-10-03-creator-flow-ui.md](2026-10-03-creator-flow-ui.md) section 4.1
  (the browser check on sign-in and the cap's refusal).
- This spec: the landing note after section 13.

## 12. Owed and known

- Owed by the owner (hosted), in this order:
  1. `supabase db push` for the migration (the cap, the role, the source columns and functions).
  2. In the dashboard's SQL editor, `alter role cobweb_indexer with password '<32 or more random characters>';`, kept
     in a password manager; on Railway's `freshness`, `INDEXER_DATABASE_URL` (the session pooler string with user
     `cobweb_indexer.umwkpwtkwmdizgndxnjc`), a redeploy, `/health` listing each chain's indexer with `lastGoodPassAt`
     moving, then `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` removed and a redeploy with no "No longer read" line.
     A password rotation is the same statement and the variable together.
  3. JWT keys: if the project's current key is the legacy HS256 secret, create a standby ECC (P-256) key, wait 20
     minutes (Supabase's edge and the clients' caches), rotate, and check that `/auth/v1/.well-known/jwks.json` lists
     an ES256 key and that page loads after a sign-in make no `/auth/v1/user` call in the auth logs. The legacy secret
     stays as previously used; revoking it waits until every server key is an `sb_secret_` key (the secrets rotation).
  4. Turnstile: a widget for the production hostname (and later the custom domain); on Vercel,
     `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and a rebuild, the widget showing on sign-in; then captcha on in Supabase
     (Turnstile with the secret, in the dashboard, or by uncommenting `[remotes.cobweb.auth.captcha]` and running
     `supabase config push` with `SUPABASE_AUTH_CAPTCHA_SECRET` set), and two checks: a sign-in on production works,
     and a POST to `/auth/v1/token?grant_type=web3` without a token answers 400 `captcha_failed`. The site key goes
     first, or every sign-in fails.
  5. Vercel: `CSP_MODE` unset on Production and Preview (report-only); the Vercel Toolbar off for Preview (project
     settings, or `VERCEL_PREVIEW_FEEDBACK_ENABLED=0`); a week of "CSP" log lines read across sign-in, the dashboard and
     the mint page, any missing origin added in code; then `CSP_MODE=enforce` and a redeploy. Any later change of
     `ART_S3_ENDPOINT`, `MINT_PAGE_MEDIA_URL`, `IPFS_GATEWAY_URL` or `NEXT_PUBLIC_FRESHNESS_URL` (R2, the media domain,
     Cloudflare) moves the policy with it on the next deploy.
  6. Vercel: after the daily source sweep's dry runs list what is expected (none is due before 90 days after the first
     real deploy), `SOURCE_SWEEP_DELETE=1`.
  7. A monitor on `https://<freshness domain>/health`: the keyword `"status":"ok"`, every minute, an alert after two
     misses, the body's `problems` in the alert; and Vercel Observability's alert on the render queue's retries (Phase
     4's item).
- Known: `/_global-error` stays Next's prerendered page, so if the root layout itself throws, that page shows without
  its scripts under `enforce`; every page is now a function call per view, the mint page's HTML is no longer cached at
  Vercel's edge (or, later, Cloudflare's) and its database reads are unchanged; an ENS avatar, and token art or
  metadata at an https address outside the gateway (a base URI set outside Cobweb), are blocked, so RainbowKit shows
  its generated avatar and the page its pattern; the wallet connectors' hosts are those of the pinned versions, and an
  upgrade can add one, which report-only or the walk shows; inline styles stay allowed, so an injected style can change
  how a page looks, never run script; a cookie with a forged key id makes auth-js fetch the key set again for that
  request (Supabase's edge caches it); a revoked signing key is trusted for up to 10 minutes per server process and
  10 at Supabase's edge; writes keep one auth call each; the cap counts paid collections that are not deployed, so a
  creator at the cap with only paid ones deploys one or asks support (only drafts can be deleted); a wallet farm that
  solves a check per wallet still holds 20 drafts each, bounded by the reservation's 3 days and Supabase's 30 web3
  sign-ins per 5 minutes per IP address; Turnstile lists the production hostnames, so previews cannot sign in, which
  their origin already prevents; after the purge, Generate's full-size preview and any original-size view show the
  pattern while trait thumbnails and the rendered art stay; the sweep takes 20 collections a run, so a backlog clears
  at 20 a day; the lag threshold can trip on a chain with a hot collection that makes no block for two minutes (a quiet
  Orbit chain), which the testnet run checks for Robinhood Chain; the role's 4 pooled connections per process stay
  under its limit of 8 with a second replica; report lines live as long as Vercel keeps logs.

## 13. Acceptance criteria

- [ ] The migration applies and `verify:local` passes (404): the cap's column and trigger, the role's grants (the four
      functions, nothing else), the source functions for the service role only and the guards; local sessions are
      ES256 and verified with no `/auth/v1/user` call.
- [ ] Every page answers the page policy with a fresh nonce on its every script (or, in report-only mode, the enforced
      framing policy beside the report-only policy), API routes the framing policy alone; `verify:csp` passes its 10
      checks and the walk shows no violation, the dev wallet included.
- [ ] `/[slug]` renders per request and its document read stays cached under its tag; the build lists `ƒ /[slug]`.
- [ ] With a site key the sign-in sends a Turnstile token and handles each refusal in words; without one it runs as
      today, as every verify does.
- [ ] A wallet holds at most its `draft_cap` (20) collections that are not deployed: the action and the database each
      refuse the next with section 9.3's sentence.
- [ ] The daily source sweep deletes originals 90 days after the later of the deploy and the final render, keeps
      thumbnails, rendered output and rows, runs dry until `SOURCE_SWEEP_DELETE=1`; `verify:sources` passes its 9.
- [ ] The freshness server's indexer runs as `cobweb_indexer` from `INDEXER_DATABASE_URL` and refuses another user;
      `verify:indexer` passes its 15 and `verify:freshness` its 16.
- [ ] `/health` answers 200 with `status: 'degraded'` and its problems past each documented threshold, `ok` otherwise.
- [ ] `pnpm typecheck`, `lint`, `test`, `format:check` and `build` pass, and every verify script at its count.
- [ ] Section 11's docs are written, and the landing note lists the owner's checklist.

## 14. Reconciliations and points to rule

Reconciliations with earlier specs, each with its reason:

1. The mint page spec's decision 2 (rendered once per revalidation, `generateStaticParams` and `revalidate = 60`): the
   page renders per request so its scripts carry a nonce; the read stays cached by tag, so the database's one read per
   link a minute holds.
2. The indexer spec's decision 3 and its reconciliation 2 (supabase-js with the service role key): the role through
   postgres.js; supabase-js leaves `apps/freshness`.
3. The freshness spec's decision 17 (`status: 'ok'`, always 200): still 200; `status` gains `degraded` with `problems`.
4. MASTER_PLAN lists the captcha and the asymmetric keys under hosted Supabase settings: each has its code part here and
   its hosted switch in section 12.
5. The Art decision "Originals are uploaded and kept": kept until 90 days after the deploy and the final render.
6. `next.config.ts`'s framing policy moves into the proxy's policy; its other three headers stay.

Points for the controller to rule on, each with this spec's recommendation:

1. `/[slug]` per request (decision 9) costs a function call per view and its edge cache; the alternative keeps ISR with
   `'self' 'unsafe-inline'` scripts on that page alone. Recommended: per request, since visitors sign mints there.
2. The captcha is checked by Supabase Auth, not an app action (decision 4's reading of "verified in the sign-in action
   before the signature is checked"): an app check would leave the public web3 grant open. Recommended: as written.
3. The role connects to Postgres through the pooler, not through PostgREST (decision 7's research). Recommended: as
   written; a PostgREST role needs a token signed with the project's session key.
4. `img-src` is exact (decision 12); `https:` for images alone would keep ENS avatars and https token art outside the
   gateway at little risk while scripts stay locked. Recommended: exact for launch, revisited after the report week.
5. On Vercel, unset means report-only (decision 14), which can be forgotten. Recommended: the third sub-project's
   launch list carries "`CSP_MODE=enforce` set" as a gate.
6. Whether Supabase CLI 2.116.0 keeps `supabase status`'s legacy keys and the publishable and secret keys working with
   `signing_keys_path` set is unproven here. The plan's first task runs `verify:local` on the key before anything
   else; if the keys break, it keeps local HS256 and covers the key-set path with unit tests on a generated key.
7. The captcha's remote block ships commented (section 4.5), since a push with it on before the site key is live locks
   every sign-in out and a push without it turns the hosted check off. Recommended: the owner uncomments it in the
   change that turns captcha on.
8. Hardening owed by earlier phases that none of the three sub-projects names: `record_upload` trusting a caller's
   size (Phase 4's "owed to hardening"), a schedule for the upload sweep, and a sweep of mint page media never saved
   (Phase 6's Known). Each is small and local. Recommended: a tenth task in this plan, or a named home.
9. Previews keep the strict policy and lose the Vercel Toolbar (decision 16). Recommended: as written.
10. The cap counts every collection that is not deployed, paid ones included (decision 3's "deployed not counted",
    read literally): the Deploy form, where a link is reserved, opens for a rendered collection and for a deferred one
    whose placeholder is rendered, which costs nothing, so counting `draft` alone could leave link holders uncounted.
    Recommended: as written.

Rulings on the ten points (17 October 2026, before planning): 1, per request, as recommended, and the mint page's spec and MASTER_PLAN gain a dated note that `/[slug]` is no longer static, the build listing it as `ƒ`; 2, as written; 3, as written; 4, the cheap alternative is taken, `img-src 'self' data: blob: https:`, since an image cannot run a script and a creator's custom metadata pointer may put token art on any https host; 5, as written, with "`CSP_MODE=enforce` set" a gate in the third sub-project's launch list; 6, the plan writer checks the local signing key while planning, since it builds the code first, and the plan records which path the first task takes; 7, as written; 8, a tenth task in this plan carries the three items; 9, as written; 10, as written.
