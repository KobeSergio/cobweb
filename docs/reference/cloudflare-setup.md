# Cloudflare in front: the setup checklist

The zone the owner sets by hand in Cloudflare's dashboard, in this order, and the check that proves each part
([../specs/2026-10-18-load-run-contract-review-and-cloudflare.md](../specs/2026-10-18-load-run-contract-review-and-cloudflare.md),
sections 9 and 13). It names the zone's domain `<zone>`, the app's `<app domain>` (the apex or a first-level subdomain)
and the freshness server's `<freshness domain>` (a first-level subdomain such as `fresh.<zone>`, since the free edge
certificate covers the apex and one level of subdomains). `pnpm --filter @cobweb/web check:edge` reads the result from
outside in 13 checks; run it once the zone is set and again after any change to it. The sections follow the spec's
section 13: Before the zone is its step 1, sections 1 to 8 are its steps 2 to 10 (section 8 holds steps 9 and 10 and
moves the `/health` monitor), and sections 9 to 11 are its steps 11 to 13, section 9 ending with step 5's removal of
Railway's generated domain.

## What the setup relies on, and the check that proves it

- Cloudflare caches by file extension unless a rule makes an answer eligible; with the rule's edge TTL taken from the
  origin, the server sends `Cloudflare-CDN-Cache-Control` and the edge reads its `max-age` and stale directives from it,
  with `Cache-Control`'s `s-maxage` as the fallback, so a state holds 1 s and a wallet 5 s (checks 3, 4 and 8).
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

- SSL/TLS encryption mode (SSL/TLS, Overview): Custom SSL/TLS, then Full (strict), so the edge verifies each origin's
  certificate. The Overview defaults to Automatic SSL/TLS.
- Edge Certificates: Always Use HTTPS on; Minimum TLS Version 1.2; Automatic HTTPS Rewrites as it is.
- HSTS (SSL/TLS, Edge Certificates): off, unless check 13 finds no `Strict-Transport-Security` on `/`; then on at six
  months, without `includeSubDomains` and without preload. A preload waits until after the launch.

## 3. The app domain

- Vercel (project cobweb, Settings, Domains): add `<app domain>` for Production.
- Cloudflare DNS: a CNAME for `<app domain>` to `cname.vercel-dns.com` (or the value Vercel's Domains page shows; at the
  apex Cloudflare flattens it), DNS only.
- Once Vercel shows the domain valid with its certificate, switch the record to Proxied.

## 4. The freshness domain

- Railway (service freshness, Settings, Networking): add `<freshness domain>` as a custom domain.
- Cloudflare DNS: a CNAME for `<freshness domain>` to the target Railway shows, DNS only.
- Once Railway shows its certificate, switch the record to Proxied.
- Railway's generated domain stays until `check:edge` passes in section 9, which removes it: removed sooner, the mint
  pages of a deployment that still polls it lose their live data.

Supabase, R2's S3 endpoint and the IPFS gateway stay outside the zone; Cloudflare never fronts Supabase.

## 5. Cache

Make each Cache Rule on the Cache Rules page (Caching, Cache Rules): Create rule, then Custom filter expression under
"When incoming requests match", then Edit expression to paste the When line.

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
  - Cache eligibility: Bypass cache. The rule changes nothing while the `/v1/` rule is the only one making anything
    cacheable (`/health` reads DYNAMIC without it), so a FAIL 2 does not mean this rule is missing: another rule or a
    changed header reached `/health`.
- Tiered Cache: Smart Tiered Caching Topology on, so every colo fills from one upper tier and the origin sees about one
  state request a second per collection however many colos serve a launch.
- Caching, Configuration: Browser Cache TTL "Respect Existing Headers"; Always Online off, so an origin failure is met by
  the edge's copy under the `stale-if-error` of `Cloudflare-CDN-Cache-Control`, not an archived page.
- No other cache rule, and never Cache Everything on `<app domain>`: each page carries its own response's nonce, and a
  cached page would hand every visitor the same one.

## 6. What stays off

Each injects a script the nonce policy would block or rewrites what the app sends; checks 9, 11 and 12 fail on those
that show in the answers they read.

- [ ] Rocket Loader (Speed, Settings, Content Optimization)
- [ ] Speed Brain (Speed, Settings, Content Optimization; it adds a `Speculation-Rules` header to the app's answers;
  on by default on the Free plan)
- [ ] Cloudflare Fonts (Speed, Settings, Content Optimization)
- [ ] Email Address Obfuscation (Security, Settings, filtered by Client-side abuse; on by default for a new zone)
- [ ] Web Analytics' automatic setup (its beacon; the Web Analytics page, Manage site, Disable)
- [ ] Zaraz (Zaraz, Settings: Auto-inject script off)
- [ ] Bot Fight Mode and its JavaScript detections (Security, Settings, filtered by Bot traffic)
- [ ] Managed Transforms (Rules, Settings, the Managed Transforms tab)

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
- The `/health` monitor: point it at `https://<freshness domain>/health` (the keyword `"status":"ok"` every minute, as
  before), since section 9 removes Railway's generated domain.
- Railway: nothing else; the freshness server reads no setting of the zone.

## 9. check:edge

```
pnpm --filter @cobweb/web check:edge --app https://<app domain> --freshness https://<freshness domain> --collection <chain id>/<address>
```

Add `--slug <mint page link>` once the hosted app leaves sample mode: put an email address (`hello@<app domain>`) in the
description of the test collection's mint page and publish it, so check 12 can see Email Address Obfuscation; until
then that setting is checked by eye. Expected: `13 passed, 0 failed`. Checks 4 and 8 depend on timing, so one failure
on a slow line is decided by a rerun. Checks 3, 5, 6 and 7 take two tries in the script before a failure stands, since
the state's 1 s copy can expire between a check's priming poll and its judged poll on a correct zone; a failure after
two tries is decided by the owner's rerun, as it is for checks 4 and 8. A failure names the setting to look at:

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

The server sends `Cloudflare-CDN-Cache-Control: max-age=1, stale-while-revalidate=1, stale-if-error=60` with the state
and `Cloudflare-CDN-Cache-Control: max-age=5, stale-if-error=60` with a wallet, a header Cloudflare reads before
`Cache-Control` and no browser reads. The edge takes its `max-age` and stale directives from it, with `Cache-Control`'s
`s-maxage` as the fallback, since `s-maxage` alone turns `stale-while-revalidate` off and leaves `stale-if-error`
unread.

Once `check:edge` reads `13 passed, 0 failed`, remove Railway's generated domain from the service (Railway, service
freshness, Settings, Networking), so no client can poll the origin around the edge: check 11 has shown the rebuilt
policy's `connect-src` naming the freshness origin, and the `/health` monitor reads the custom domain since section 8.

## 10. The report week's positive control

In the browser's console on `https://<app domain>/`, run
`document.body.insertAdjacentHTML('beforeend', '<img src="/x" onerror="document.title = 1">')`. Within a minute the
Vercel log shows a line that begins `{"csp":"report","directive":"script-src-attr",` or, once `CSP_MODE=enforce` is set,
`{"csp":"enforce","directive":"script-src-attr",`.

## 11. The hosted load run

From the repository root, on a machine with 8 cores and 16 GB of memory on a steady line, with k6 installed, once
check:edge passes: a rehearsal first, which also proves the machine, with the Railway service restarted once in its
second minute (Railway, service freshness, Deployments, Restart; its failed rate, `Age` and edge counts recorded, not
gated). k6's thresholds on `Age` and `/health` fail around the restart by design, and the failed rate stays under 1% only if the edge serves the state stale, so the machine is
proven by the `Failed:` summary line alone, with `Dropped iterations` at most 1,005 and `Edge mitigations: 0`:

```
k6 run --include-system-env-vars=false \
  --no-usage-report -e PROFILE=hosted -e BASE=https://<freshness domain> \
  -e COLLECTIONS=<chain id>/<address> -e POLLERS=2000 -e WALLETS=500 \
  -e SUMMARY_FILE=$HOME/k6-rehearsal.json apps/freshness/load/k6-freshness.js
```

Then the full run, about three and a half minutes, every threshold passed:

```
k6 run --include-system-env-vars=false \
  --no-usage-report -e PROFILE=hosted -e BASE=https://<freshness domain> \
  -e COLLECTIONS=<chain id>/<address> -e SUMMARY_FILE=$HOME/k6-hosted.json apps/freshness/load/k6-freshness.js
```

Both commands carry `--include-system-env-vars=false`: k6 passes the shell's variables into `__ENV` by default, so a
`POLLERS`, `INTERVAL_S` or `WALLETS` left exported from the rehearsal would change the full run without a word.

`COLLECTIONS` lists one to three deployed Cobweb collections on a chain the hosted freshness service serves, the
pollers shared among them. The summary lines and the JSON summary go to the controller for the dated notes. If
`Edge mitigations` reads above 0, Cloudflare's automatic protection challenged the single machine: run the same command
on two or three machines with `POLLERS` and `WALLETS` divided between them, as whole `-e` numbers (two machines:
`-e POLLERS=10000 -e WALLETS=2500` on each; three machines: `-e POLLERS=6667 -e WALLETS=1667` on each), and never
lower the zone's protection for the run.

## Known

- One machine reaches one or two colos, so the hosted run proves the edge and the origin's count where it lands; launch
  day's `/health` counts show the rest.
- The `Edge cache` line of the run's summary counts the run's own `/health` reads (one every 5 s, about 36 DYNAMIC or
  BYPASS entries over the 180 s hosted run), which are uncached by design and not part of the cache thresholds.
- Until Railway's generated domain is removed, the origin answers around the edge.
- A Cloudflare outage or a wrong setting takes the mint page's live data with it: the page raises its own degraded
  banner after 10 s, and the way back is the freshness record switched to DNS only: Railway serves the custom domain on
  its own certificate, so the mint pages reach the origin with no redeploy and the policy unchanged. In an outage that takes Cloudflare's dashboard down with the proxy, a Railway domain generated again (Railway, service freshness, Settings, Networking), `NEXT_PUBLIC_FRESHNESS_URL` set to it and a redeploy restore live data without Cloudflare.
- Creators sign in on the Vercel domain until the third sub-project adds `<app domain>` to the sign-in origins; visitors
  read and mint on either.
- A creator's text with an email address shows as written only while Email Address Obfuscation stays off.
- `check:edge` reads from one place, so it proves the colo nearest the machine that runs it.
- Check 12 reads PASS when no HTML page was read, and check 10 then fails with a status or type other than 200 HTML; so
  beside such a FAIL 10, when the FAIL 10 names `/`, a PASS 12 means the app domain served no page, not a clean page.
- A PASS on check 13 does not prove Always Use HTTPS is on: Vercel redirects http by itself behind Full (strict), and
  the check's sentence is about the redirect.
- The script's page reads carry Node's default request headers rather than a browser's, so a feature that reacts only
  to a browser navigation is checked by eye in the dashboard (section 6 above; the spec's section 13, step 7).
