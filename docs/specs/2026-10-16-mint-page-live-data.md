# The mint page on live data: specification

Phase 6, second sub-project of three (the freshness server; the mint page on live data; the indexer and the Overview),
each with its own spec, plan and run. Product decisions: [../MASTER_PLAN.md](../MASTER_PLAN.md#decisions) (Mint page,
Mint groups, Lock, Art: rarity tiers, Flow: the mint page address and pre-reveal) and the Phase 6 bullets on the page at
`/[slug]`, the mint action, delegated minting and the page sections, decided further by the rulings of 16 October 2026
on the 26 questions of the Phase 6 codebase map. Rules 1 to 4 bind it: liveness is the contract's `active`; the wallet
opens only after a passing simulation, with the simulated request; the page polls the freshness server and calls no RPC
for shared state; every server action checks the session and the ownership, and every table has row-level security. What
it consumes: [2026-10-16-freshness-server.md](2026-10-16-freshness-server.md) sections 6.7, 6.8 and 6.10 and section 14,
items 17 to 26. The screens it puts on real data: [2026-10-03-creator-flow-ui.md](2026-10-03-creator-flow-ui.md)
sections 4.6 (Mint page), 4.7 (the public page), 5 and 7. What Phase 5 left: `joinPhases` and the receipt wait
([2026-10-15-phases.md](2026-10-15-phases.md) section 6.2 and its closing note), eligibility from `walletState`
([2026-10-15-whitelist.md](2026-10-15-whitelist.md) section 12), `tokenUriOf`, the reveal targets and the transfer level
([2026-10-15-airdrop-settings.md](2026-10-15-airdrop-settings.md) sections 6.1 and 7.4). Legacy:
[../legacy/market-mint-and-data.md](../legacy/market-mint-and-data.md) sections 1.4 to 1.8 and 8 (the browser-clock
liveness bug, the discarded simulation, the padded fee, the client-written logs, the mapping to the rebuild) and
[../reference/the-suits-mint-analysis.md](../reference/the-suits-mint-analysis.md) (liveness from the view, overlapping
groups).

## 1. Goal

A visitor opens `/<slug>` and mints from a live collection. The page's content comes from one definer function that
answers only for a deployed collection whose page is published, read on the server and cached under a tag the Mint page
tab expires on save. The chain's state comes only from the freshness server, polled by the browser every 3 s and every
second around a start: liveness is each group's `active`, the chain clock is anchored on each answer, and `degraded` and
every refusal read in words. Quotas and delegated vaults come from the wallet endpoint. A mint is simulated with the
state's exact quote, the wallet gets the simulated request, and the receipt gives the ids. The Mint page tab saves the
settings, media and sections and publishes the page; "Remind me" builds a calendar event from the chain's start; minted
tokens show their metadata's art and, once revealed, their rarity tier. Sample mode runs on the same components.
`verify:mint-page` proves on Anvil, local Supabase and the freshness server in process that the page's own path keeps a
scheduled phase blocked one second before its start, opens it within one poll of the first block at it, mints, and shows
the state after the mint: the browser half of Phase 6's exit criterion.

## 2. Decisions taken in the design conversation

1. **Scope.** Decision: `mint_pages`, `token_ranks`, the public read functions and the `mint-page` bucket; the `[slug]`
   page and the owner's preview on the freshness server's answers; the mint action, delegated minting, Remind me, token
   art, the reveal and rarity; the Mint page tab with its media, sections and publish switch, and the Overview's avatar
   and public switch on the real row; the freshness wire types in `@cobweb/shared`; sample mode on the same components;
   `verify:mint-page` and section 9n of `verify:local`; the browser walk; docs. Out: the indexer, holders, recent
   mints, "Paid by minters" and per-recipient history (the third sub-project); Cloudflare, the k6 run and the full
   Content-Security-Policy (Phase 7); mint on behalf on the page; any change to the contracts or to the freshness
   server's behaviour. Considered: the indexer in the same run (the page needs none of its tables).
2. **One public read, cached by a tag.** Decision: `public.mint_page(p_slug)`, a `security definer` function granted to
   `anon` and `authenticated`, answers one JSON document for a deployed collection whose page is published, and null
   otherwise; every table stays closed to `anon`. The route reads it on the server through a client with no session
   inside `unstable_cache`, tagged `mint-page:<slug>` and revalidated every 60 s, and renders each link on demand once
   per revalidation (`generateStaticParams` answering `[]`, `revalidate = 60`), so the database sees one read per link a
   minute whatever the number of viewers; the tab's actions expire the tag with `updateTag`. Considered: `anon` grants
   and policies on the tables (each column would need its own rule, and one missed leaks); the freshness server joining
   the database (rejected in its spec).

   > **18 October 2026:** The page renders per request, so its scripts carry the response's nonce
   > ([2026-10-17-production-hardening.md](2026-10-17-production-hardening.md), decision 9): `generateStaticParams` and
   > `revalidate` are gone and the build lists `ƒ /[slug]`. The document is still read through `readMintPage`'s 60 s
   > cache under `mint-page:<slug>`, so the database sees one read per link a minute.
3. **Chain state only in the browser.** Decision: the HTML carries no chain state; the first answer comes from the
   browser's first poll at hydration, and until it lands the panel and the phase list show skeletons and the button
   reads "Reading the chain". Considered: the map's server-side fetch for the first paint (an ISR page caches its HTML,
   so a state inside it would be as old as the render, which could also wait out a join).
4. **`mint_pages`.** Decision: one row per collection, written by its owner under row-level security with grants on
   the editable columns: `published`, a description of up to 2,000 characters (empty shows the collection's), three
   media keys (banner, avatar, About banner), four links (website, X, Discord, Telegram) of up to 200 characters with
   their hosts checked, up to six distinct featured token ids, and `sections` as JSON. A trigger refuses publishing a
   collection that is not deployed or has no link and stamps `published_at` and `updated_at`; no client deletes a row.
   Considered: separate team, roadmap, FAQ and carousel tables as legacy had (more grants and joins for a few rows).
5. **The document, and what it never carries.** Decision: the link, name, symbol, project type, chain and contract, the
   description, media keys, links, featured ids, sections, the phases' names, descriptions, visibility and order, and
   the placeholder base URIs. Never: the owner's user id or wallet, the payout address, the deploy transaction, the fee
   snapshot, the token list or DNA, a render job, any CID or base URI of the real art, an upload of the private
   buckets, a whitelist entry. Considered: the reveal targets as Settings reads them (the real job's base URI before
   the reveal would hand out the metadata, and so the rarity, of every unminted token).
6. **The owner's preview.** Decision: `/<slug>/preview` renders the same page for the signed-in owner of the deployed
   collection with that link, published or not, through `public.mint_page_preview(p_slug)` (granted to
   `authenticated`, answering only the owner), under a banner saying who can see it; anyone else gets the not-found
   page. Considered: the preview on `/<slug>` (reading the session would make every public render dynamic).
7. **The `mint-page` bucket.** Decision: a public bucket behind the art bucket's endpoint and keys
   (`MINT_PAGE_S3_BUCKET`, default `mint-page`: Supabase Storage locally, a public R2 bucket in production), keyed
   `<collection id>/<sha256>.<ext>`, written by presigned PUT bound to type and length as layers are, read at
   `MINT_PAGE_MEDIA_URL/<key>`. PNG, JPG, WebP and GIF images, 5 MB for banners and carousel images and 2 MB for the
   avatar and team photos; MP4 slides and the MP3 up to 20 MB; no SVG. Considered: signed URLs (cached HTML would carry
   links that expire within the hour); SVG as today's form takes (a file on a public origin can carry script).
8. **Saving and publishing.** Decision: four server actions in `app/actions/mint-page.ts`, each checking the session and
   the ownership first: `getMintPageSettings` reads the tab's row; `presignMintPageMedia` signs the files a save needs;
   `saveMintPage` validates the whole draft with one zod schema, checks each new key was uploaded within its slot's cap,
   writes the row, deletes the objects the old row named and the new one does not, records the ranks when the page is
   published and expires the tag; `setMintPagePublished` flips the switch for the Overview. Files stay in the browser
   until Save, as today. Considered: uploading on pick (a file the creator then drops would stay in the bucket).
9. **Sections.** Decision: `sections` holds the five sections, each with its `enabled` switch, under one zod schema the
   save validates and the page parses: Team (12 members), Roadmap (12 items), FAQ (20 items), one MP3 and a carousel of
   5 uploads or token ids, with legacy's text limits (section 4.1). SQL checks the size (64 KB), that it is an object,
   and that every media key in it is the collection's; a section the page cannot parse is left off. Considered: a JSON
   schema in SQL (an extension for a check the action already makes).
10. **The freshness client.** Decision: the browser fetches `<NEXT_PUBLIC_FRESHNESS_URL>/v1/state/<chain id>/<lowercase
    address>` and the wallet path with `cache: 'no-cache'`, so each poll is a conditional request on the browser's
    stored `ETag`; it reads `Age` and counts an answer older than 10 s as a failed poll, keeps the highest `block` seen
    and ignores a body below it, takes a body at the same block without moving the clock (a revalidated copy, or a
    changed `degraded`), and treats 404 `not-a-collection` as final for that page load only. `NEXT_PUBLIC_FRESHNESS_URL`
    is the one new public variable. Considered: sending `If-None-Match` by hand (a preflight on every poll).
11. **The cadence.** Decision: per the server's tiers, 1 s in its fast window (here while a visible phase is starting
    or scheduled within 60 s on the chain clock, wider than the server's 15 s so the page is fast first) and before the
    first answer; 3 s at its live and idle tiers and while `degraded` (the server answers its last state at once);
    nothing while the tab is hidden, and a poll at once on return; after a failed poll, the answer's `Retry-After` (1 s
    without one), doubled per further failure up to 8 s; none after a final refusal. Considered: 3 s throughout (a
    start would be seen up to 3 s late).
12. **The chain clock.** Decision: each accepted body with a new block anchors the clock at its `blockTimestamp` plus its
    `Age`, and `performance.now()` runs it from there; `readAt` dates the server's read for the degraded banner. The
    clock labels countdowns and picks the cadence, never makes a phase live, and errs late by at most one server tick.
    Considered: anchoring on `readAt` (the server's wall clock can lead the chain's last block by a block interval, so
    a countdown would end before the chain can open the phase).
13. **`degraded`.** Decision: the banner shows when the body says `degraded` (minutes from `readAt`) or when the page has
    had no accepted answer for 10 s (minutes from the last one); minting stays possible, since every mint is simulated.
    Considered: blocking the button while degraded (the simulation is the guard, as the banner already says).
14. **The wallet answer.** Decision: read on connect, on a change of account or chain, on return to the tab, after each of
    this wallet's mints, when a phase turns live, and from "Check again" beside "Not on this list"; never on a timer.
    Until it answers, the button reads "Checking this wallet". A whitelist phase is eligible when its quota is above 0,
    so a listed wallet whose quota is not on chain yet reads "Not on this list". Considered: a 15 s poll (10,000
    connected wallets would send eight times the wallet reads the plan sizes the server for).
15. **Local mints.** Decision: each mint the page saw land is kept with its group, its holder (the vault, else the
    wallet), its count and its receipt's block; supply counts add those above the state's block and allowances those
    above the wallet answer's, so a later answer that includes them never counts them twice. Considered: dropping them
    on the next answer (an answer read before the receipt's block would hide them).
16. **Browser transports.** Decision: `lib/wagmi.ts` names a `transports` entry for each chain it lists, `http()` on
    viem's public endpoint for the chain, with no key; the simulation and the receipt go through it and the send through
    the wallet. Both concern the visitor's own transaction, not shared state, so rule 3 holds. Considered: the ruling's
    optional `NEXT_PUBLIC_RPC_URL_<id>` (a provider key in the bundle, and a second family of public variables); wagmi's
    `unstable_connector` (it picks the first injected wallet, not the connected one).
17. **The mint action.** Decision: the value is the state's quote exactly, `(price + flat fee + price x bps / 10,000) x
    quantity`, the contract's `quoteBatchMint`; the call is `batchMint(quantity, group)`, or `delegateMint(quantity,
    group, vault)` with a vault; the flow simulates it from the connected account, and on `MintGroupInactive` while the
    page's state reads the group live it waits for the next accepted answer (at most 2 s) and simulates once more; only
    a passing simulation opens the wallet, with `writeContract(simulated.request)` unchanged; the receipt is read
    through viem's public client for up to 180 s, and the minted ids are the collection's `Transfer` logs from the zero
    address to the minting wallet. Considered: `quoteBatchMint` over RPC (rule 3, and the state carries its inputs).
18. **Failures in words.** Decision: fourteen kinds, each with its title, sentence and way forward (section 7.6);
    every one before the wallet opens says nothing was sent. Considered: today's five (a revoked delegation or a
    changed fee would read as a closed phase or a failure on chain).
19. **Delegated minting.** Decision: the wallet answer's vaults (up to 10, from the delegate registry, none where it has
    no code) are offered on a live whitelist phase where the vault has quota left; the tokens land in the connected
    wallet and the vault's quota is used. The public phase is minted by the wallet itself, and mint on behalf has no
    control on the page, whatever `mintOnBehalfActive` says. Considered: vaults on the public phase (it is open to the
    connected wallet already); a mint-on-behalf form while the switch is on (it serves third-party checkouts, and on
    the page any visitor could use up another wallet's limit).
20. **Phases.** Decision: the state's groups joined with the document's phases by id through `joinPhases`: named groups
    in the creator's order, groups registered outside Cobweb after them as "Group N", hidden ones left off; Open now,
    Coming up and Finished each keep the join's order; a row shows its description as plain text; the panel still opens
    on the cheapest phase the wallet can mint. Considered: Coming up by start time (the creator's order is Manage's).
21. **Token art.** Decision: a token's art is the `image` of its metadata, read in the browser through the IPFS gateway
    at the URI the contract's rule gives (`tokenUriOf(baseUri, id)`), `ipfs://` turned into the gateway's path and
    `https://` kept; an MP4 plays muted in a loop. The gateway is the server variable `IPFS_GATEWAY_URL` (default
    `https://ipfs.io/ipfs`), passed to the page with its content. Before the reveal the art stage shows the
    placeholder's image and the featured strip and token slides stay hidden. Considered: images from
    `render_batches.images_cid` (a batch's CID shows every token in it before the reveal); `NEXT_PUBLIC_IPFS_GATEWAY`.
22. **The reveal on the page.** Decision: the collection reads revealed when the state's `baseUri` is neither empty nor
    one of the document's placeholders (the latest done placeholder job's base URI and the deploy-time one, each left
    out when it is the real job's); a custom link reads revealed. Considered: `pointerOf` against the three targets
    (the public document would carry the real one).
23. **Rarity.** Decision: on a generative collection, `token_ranks` keeps one row per real job, its ranks in an array
    indexed by token id, computed with `rankTokens` and Generate's attribute key over the stored token list and recorded
    by a service-role function when the tab saves or publishes a page and when Settings confirms a reveal;
    `public.mint_page_tiers(p_slug, p_base_uri, p_ids)` answers up to 20 ids only when `p_base_uri` is the real job's,
    so nothing reads before the reveal. The success view shows each token's tier; before the reveal one line reads
    "Rarity shows after the reveal"; single asset and 1/1 collections show "#12 of 500" (the id and the supply).
    Considered: ranking in SQL (exact arithmetic can order Generate's near ties differently); ranking when the render
    finishes (the worker's code).
24. **Transfers and royalties.** Decision: Transfers reads "Locked by the creator" at level 9, "Open" at 0 and 1,
    "Restricted by the creator" at any other level, and is left out at `none` or `unread`; Royalties reads the state's
    basis points as a percentage, with "enforced on secondary sales through the transfer validator" only at level 0.
    Considered: `chainView`'s `transferLock` (a guess per chain, not the collection's level).
25. **Remind me.** Decision: a phase scheduled ahead on the chain clock offers "Google Calendar" (a link) and "Download a
    calendar file" (an `.ics` built in the browser), at the group's `startTimestamp` in UTC for 30 minutes, titled
    "<collection>: <phase> opens", with the page's link and "Minting opens when the chain reaches this time." Nothing
    is stored, so no table and no policy. Considered: email reminders (dropped in MASTER_PLAN).
26. **Copy and safety.** Decision: descriptions, bios, roadmap and FAQ text render as plain text with their line breaks;
    links are https only and open in a new tab with `noreferrer`; prices are in the native token and no USD shows.
    Considered: rich text as legacy had (an HTML surface creators fill).
27. **One page, two sources.** Decision: `MintSource` (state polls, wallet polls, the chain's simulate and receipt, tiers,
    token art) has a live implementation on the freshness client, wagmi, Supabase and the gateway and a sample one on
    `lib/demo`, chosen by `isDemoMode()`; components see only the source. Considered: two pages (the reviewed states
    would drift from the shipped ones).
28. **The tab, the Overview and Deploy.** Decision: the tab reads and saves the real row with its media and sections (the
    "Phase 6" badge goes), links Preview and, once public, the page; featured and carousel tokens are picked from the
    rendered set with thumbnails from its metadata at the real job's base URI, which only the owner's page receives; a
    single asset collection picks none. The Overview's avatar and public switch read the row, and Deploy's deployed
    view links the page. A token as the avatar stays out. Considered: legacy's token avatar (the cached HTML would need
    that token's image before the reveal; the creator can upload it).
29. **The wire types.** Decision: `StateBody`, `WalletBody`, `QuotaBody`, `RefusalCode` and two path builders move to
    `@cobweb/shared`'s browser entry; the freshness server imports them and `@cobweb/freshness/server` re-exports them
    as today. Considered: importing them from `@cobweb/freshness/server` (a development dependency of the web app).
30. **The Content-Security-Policy.** Decision: unchanged here; the freshness origin joins `connect-src` with Phase 7's
    full policy, and section 12 lists every origin the page connects to. Considered: a `connect-src` now (it must list
    every wallet connector's endpoints, and one missing endpoint stops minting at launch).
31. **`verify:mint-page`.** Decision: 17 checks against local Supabase, local storage, Anvil with the factory and the
    freshness server started in process from `@cobweb/freshness/server`, on a collection deployed through the deploy
    fixture, running the page's own modules: the live source, the join and the model for what the page shows, and
    `runMint` through `wagmiMintChain` on a wagmi config with wagmi's mock connector for a holder Anvil impersonates.
    Considered: a browser test (no harness exists; the walk covers the screen).
32. **Docs and tests.** Decision: sections 10 and 11.

## 3. Scope

In: the migration (two tables, five functions, three check helpers, a trigger) and the bucket; the wire types; the
server's reads, cores, actions and routes; the live source, its hooks and the model; the mint action, its failures and
delegated minting; the sections, Remind me, art and rarity; the tab, the Overview, the deployed view and the Settings
hook; `wagmi.ts`'s transports; sample mode; sections 10 and 11. Out: as decision 1.

## 4. Database (`supabase/migrations/20261016100000_mint_page.sql`)

### 4.1 `mint_pages`

```sql
create table public.mint_pages (
  collection_id uuid primary key references public.collections (id) on delete cascade,
  published boolean not null default false,
  published_at timestamptz,
  description text not null default '' check (char_length(description) <= 2000),
  banner_key text, avatar_key text, about_banner_key text,
  website_url text check (website_url ~ '^https://\S+$'),
  x_url text check (x_url ~ '^https://(www\.)?(x|twitter)\.com/\S+$'),
  discord_url text check (discord_url ~ '^https://(www\.)?discord\.(gg|com)/\S+$'),
  telegram_url text check (telegram_url ~ '^https://(www\.)?(t|telegram)\.me/\S+$'),
  featured_token_ids integer[] not null default '{}' check (private.token_ids_ok(featured_token_ids, 6)),
  sections jsonb not null default '{}'::jsonb check (private.mint_page_sections_ok(collection_id, sections)),
  updated_at timestamptz not null default now(),
  constraint mint_pages_links_length check (greatest(char_length(website_url), char_length(x_url),
    char_length(discord_url), char_length(telegram_url)) <= 200),
  constraint mint_pages_media_keys check (private.mint_page_key_ok(collection_id, banner_key, 'image')
    and private.mint_page_key_ok(collection_id, avatar_key, 'image')
    and private.mint_page_key_ok(collection_id, about_banner_key, 'image'))
);

alter table public.mint_pages enable row level security;
create policy "mint_pages: owner reads" on public.mint_pages for select to authenticated
using ((select private.collection_owned(collection_id)));
create policy "mint_pages: owner inserts" on public.mint_pages for insert to authenticated
with check ((select private.collection_owned(collection_id)));
create policy "mint_pages: owner updates" on public.mint_pages for update to authenticated
using ((select private.collection_owned(collection_id))) with check ((select private.collection_owned(collection_id)));
revoke all on public.mint_pages from anon, authenticated;
grant select on public.mint_pages to authenticated;
grant insert (collection_id, published, description, banner_key, avatar_key, about_banner_key, website_url, x_url,
  discord_url, telegram_url, featured_token_ids, sections) on public.mint_pages to authenticated;
grant update (published, description, banner_key, avatar_key, about_banner_key, website_url, x_url, discord_url,
  telegram_url, featured_token_ids, sections) on public.mint_pages to authenticated;
```

The check helpers, all `immutable`, `security invoker`, `set search_path = ''`, revoked from `public` and `anon` and
granted to `authenticated` and `service_role` (a check constraint runs them as the writer):

- `private.token_ids_ok(p_ids integer[], p_max integer)`: at most `p_max` ids, none null, each at least 1, no repeat.
- `private.mint_page_key_ok(p_collection_id uuid, p_key text, p_kind text)`: null, or
  `^<collection id>/[0-9a-f]{64}\.(png|jpg|webp|gif)$` for `image`, with `mp4` added for `slide` and `mp3` alone for
  `music`.
- `private.mint_page_sections_ok(p_collection_id uuid, p_sections jsonb)`: an object of at most 65,536 bytes as text
  whose keys at `$.team.members[*].imageKey`, `$.carousel.items[*].key` and `$.music.key` pass
  `mint_page_key_ok` as `image`, `slide` and `music`.

`public.mint_pages_guard()` (`security invoker`), `before insert or update ... for each row`: when a row turns published
(inserted published, or updated from false to true) it reads the collection and refuses one that is not `deployed` or
has no slug with 'A mint page goes public once its contract is deployed and it has a link.' (`23514`), and sets
`published_at` to now; otherwise it keeps the old `published_at`; it always sets `updated_at`. The table's comment: "The
public mint page's settings, one row per collection, written by its owner. Read publicly only through mint_page, for a
deployed collection whose row is published. Media keys name objects of the mint-page bucket under the collection's id;
sections is the JSON lib/mint/page-doc.ts validates."

The section limits, legacy's (the creator-flow audit, section 13), checked by the zod schema of 6.1: Team, at most 12
members, each a name and a role of 1 to 20 characters, a bio of up to 500, an optional photo key and X, Discord and
Telegram links of up to 40 characters, https; Roadmap, at most 12 items, a date and a title of 1 to 20 characters and a
description of up to 500; FAQ, at most 20 items, a question of 1 to 40 and an answer of 1 to 500; Music, one key and
its file name of up to 100 characters; Carousel, at most 5 slides, an upload (a key, `image` or `video`, its file name)
or a token id. Every item has an `id` of 1 to 40 characters from `[a-z0-9-]` for the editor's order.

### 4.2 `token_ranks`

```sql
create table public.token_ranks (
  job_id uuid primary key references public.render_jobs (id) on delete cascade,
  ranks integer[] not null check (cardinality(ranks) between 1 and 100000 and array_position(ranks, null) is null),
  created_at timestamptz not null default now()
);
alter table public.token_ranks enable row level security;
create policy "token_ranks: owner reads" on public.token_ranks for select to authenticated
using (exists (select 1 from public.render_jobs j where j.id = job_id and (select private.collection_owned(j.collection_id))));
revoke all on public.token_ranks from anon, authenticated;
grant select on public.token_ranks to authenticated;
```

Comment: "ranks[i] is token i's rarity rank (1 the rarest) in a done real job's stored token list, by rankTokens with
Generate's attribute key. Written only by token_ranks_record; read publicly only through mint_page_tiers, for the
revealed base URI."

### 4.3 Functions

```sql
create function private.mint_page_document(p_collection_id uuid) returns jsonb       -- stable, invoker
create function public.mint_page(p_slug text) returns jsonb                          -- anon, authenticated
create function public.mint_page_preview(p_slug text) returns jsonb                  -- authenticated
create function public.mint_page_tiers(p_slug text, p_base_uri text, p_ids integer[]) returns jsonb  -- anon, authenticated
create function public.token_ranks_record(p_collection_id uuid, p_owner uuid, p_job_id uuid,
  p_ranks integer[]) returns boolean                                                 -- service_role
```

All set `search_path = ''`; each is revoked from `public` and granted as its comment says. The document:

```jsonc
{ "slug": "night-owls", "name": "Night Owls", "symbol": "OWL", "projectType": "generative",
  "chainId": 31337, "contract": "0x…",                      // lowercase, as stored
  "description": "…",                                       // the page's, else the collection's
  "media": { "banner": "<key>", "avatar": null, "aboutBanner": null },
  "socials": { "website": "https://…", "x": null, "discord": null, "telegram": null },
  "featuredTokenIds": [5, 10], "sections": { … },          // as saved; {} without a row
  "phases": [{ "id": 0, "name": "Public", "description": "", "visible": true, "position": 0 }],
  "placeholders": ["ipfs://…/metadata.json"],
  "published": true }
```

- `private.mint_page_document` builds it from `collections`, `mint_pages` (left joined, so a collection without a row
  reads the defaults), `mint_groups` ordered by `position` then `onchain_id`, and `placeholders`: the base URI of the
  collection's latest done `placeholder` job and `deployments.args->>'baseUri'`, distinct, nulls dropped, each left
  out when it equals the latest done `real` job's `base_uri`. It is revoked from every client role.
- `public.mint_page` (`security definer`, `stable`): the document of the collection whose slug is `lower(btrim(p_slug))`,
  `status = 'deployed'`, with a `deployments` row and a published `mint_pages` row; null otherwise.
- `public.mint_page_preview` (`security definer`, `stable`): the same without the published condition, for a collection
  whose `owner_id` is `(select auth.uid())`; null for anyone else.
- `public.mint_page_tiers` (`security definer`, `stable`): for a published, deployed, `generative` collection whose
  latest done real job's `base_uri` equals `p_base_uri` and has a `token_ranks` row, and 1 to 20 ids,
  `{ "total": <cardinality>, "ranks": { "<id>": <rank> } }` for the ids from 1 to the total; null otherwise.
- `public.token_ranks_record` (`plpgsql`, `security definer`): starts with
  `private.lock_owned_collection(p_collection_id, p_owner)`; refuses with 'The rendered set could not be ranked.'
  (`23514`) unless the collection is generative and `p_job_id` is its `real` job in state `done`, with
  `cardinality(p_ranks) = token_count` and `p_ranks` a permutation of 1 to `token_count`; inserts
  `on conflict (job_id) do nothing` and answers whether it inserted.

### 4.4 Storage

`supabase/config.toml` gains the bucket, which `supabase seed buckets` creates locally:

```toml
# The public mint page's media (docs/specs/2026-10-16-mint-page-live-data.md, section 4.4). Public: the page and its
# cached HTML link the objects directly. Written only through presigned PUTs the Mint page tab's actions sign.
[storage.buckets.mint-page]
public = true
file_size_limit = "20MiB"
allowed_mime_types = ["image/png", "image/jpeg", "image/webp", "image/gif", "video/mp4", "audio/mpeg"]
```

| Slot | Types | At most | Shape |
| --- | --- | --- | --- |
| Banner, About banner | PNG, JPG, WebP, GIF | 5 MB | 3 to 1 advised, a warning only |
| Avatar | PNG, JPG, WebP, GIF | 2 MB | square advised; at least 400 by 400 |
| Team photo | PNG, JPG, WebP, GIF | 2 MB | square advised |
| Carousel slide | PNG, JPG, WebP, GIF; MP4 | 5 MB; 20 MB | |
| Music | MP3 (`audio/mpeg`) | 20 MB | |

No `storage.objects` policy is added: writes are presigned with the S3 keys, as the art bucket's are, and reads are
public. In production the bucket is a public R2 bucket on a custom domain with the art bucket's CORS rule for PUT from
the app's origin (section 12). Objects are content-addressed, so an object is never overwritten with other bytes.

### 4.5 Types (`apps/web/src/lib/database.types.ts`, by hand)

`mint_pages` and `token_ranks` gain Row, Insert, Update and Relationships as the generator writes them (arrays as
`number[]`, `sections` as `Json`), and Functions the four public functions with their arguments, `Json` answers and
`token_ranks_record`'s `boolean`.

## 5. The shared package

```ts
// packages/shared/src/freshness-wire.ts, exported from the browser entry (index.ts)
export type StateBody = { /* the freshness spec's section 6.7, moved from apps/freshness/src/state-body.ts */ }
export type QuotaBody = { id: number; quota: number; claimed: number }
export type WalletBody = { /* section 6.8, moved from apps/freshness/src/wallet.ts */ }
export type RefusalCode = 'bad-request' | 'not-found' | 'chain-not-served' | 'not-a-collection' | 'method-not-allowed'
  | 'chain-unreadable' | 'not-read-yet' | 'wallet-unreadable' | 'busy' | 'internal'
export function statePath(chainId: number, address: Address): string                   // /v1/state/<id>/<lowercase>
export function walletPath(chainId: number, address: Address, wallet: Address): string  // both addresses lowercase
```

`apps/freshness/src/state-body.ts`, `wallet.ts` and `routes.ts` import the types from `@cobweb/shared`, and `server.ts`
keeps re-exporting `StateBody` and `WalletBody`; behaviour is unchanged and `verify:freshness` keeps its 16 checks.
`@cobweb/dna` is used as it is (`rankTokens`, `buildTraitIndex`, `attributeKeyOf`, `rarityTier`).

## 6. The server

### 6.1 The document, the media and the read (`apps/web/src/lib/mint/page-doc.ts`, `media.ts`, `page-read.ts`)

```ts
// page-doc.ts, pure
export const sectionsSchema: z.ZodType<StoredSections>     // 4.1's limits; keys, not URLs
export const pageDocSchema: z.ZodType<PageDoc>             // 4.3's document; sections kept as unknown
export type MintPageStatic = { slug: string; name: string; symbol: string
  projectType: 'generative' | 'one_of_one' | 'single_asset'; chain: SupportedChain; contract: Address
  description: string; bannerUrl: string | null; avatarUrl: string | null; aboutBannerUrl: string | null
  socials: Socials; featuredTokenIds: number[]; sections: MintPageSections   // URLs; a section that fails is left off
  phases: PhaseRow[]; placeholders: string[]; gateway: string }
export function pageStaticOf(doc: PageDoc, urls: { media(key: string): string; gateway: string }): MintPageStatic | null
// media.ts, pure, shared by the browser and the server
export type MediaSlot = 'banner' | 'avatar' | 'about' | 'team' | 'slide' | 'music'
export const MEDIA_SLOTS: Record<MediaSlot, { types: readonly string[]; maxBytes: Record<string, number>; minSide?: number }>
export function mintPageMediaProblem(slot: MediaSlot, file: FileFacts): string | null
export function mintPageKey(collectionId: string, contentHash: string, mime: string): string
export function keyBelongs(collectionId: string, key: string, slot: MediaSlot): boolean
// page-read.ts, server-only
export const mintPageTag = (slug: string) => `mint-page:${slug}`
export function mediaBase(): string     // MINT_PAGE_MEDIA_URL, else <NEXT_PUBLIC_SUPABASE_URL>/storage/v1/object/public/<bucket>
export function ipfsGateway(): string   // IPFS_GATEWAY_URL, else https://ipfs.io/ipfs
export function readMintPage(slug: string): Promise<MintPageStatic | null>
export function readMintPagePreview(slug: string): Promise<(MintPageStatic & { published: boolean }) | null>
```

`PhaseRow` is `Pick<PhaseRowCopy, 'onchain_id' | 'name' | 'description' | 'visible' | 'position'>`, the part of the copy
`joinPhases` reads (its parameter widens to it), the document's `id` read as `onchain_id`. `pageStaticOf` answers null
for a chain this build does not list (`chainById`), turns keys into URLs and drops a section that fails `sectionsSchema`
or whose switch is off. `readMintPage` calls `mint_page` through a Supabase client built from the publishable key with
no session, inside `unstable_cache(fn, ['mint-page', slug], { tags: [mintPageTag(slug)], revalidate: 60 })`; a failed
call throws, so ISR keeps serving the last page. `readMintPagePreview` calls `mint_page_preview` with the session's
client, uncached. `mintPageMediaProblem`'s sentences: 'Use a PNG, JPG, WebP or GIF image.', 'Use a PNG, JPG, WebP or GIF
image, or an MP4 video.', 'Use an MP3 file.', '<n> MB is over the <m> MB limit.', 'The avatar must be at least 400 by
400.'

### 6.2 Settings, media and publish (`apps/web/src/lib/mint/settings-core.ts`, `app/actions/mint-page.ts`)

```ts
export type MediaAsk = { slot: MediaSlot; mime: string; bytes: number; width: number | null; height: number | null
  contentHash: string }
export type MintPageSettingsView = { published: boolean; description: string
  media: Record<'banner' | 'avatar' | 'about', { key: string; url: string } | null>; socials: Socials
  featuredTokenIds: number[]; sections: EditableSections          // keys and URLs side by side
  art: { realBaseUri: string | null; supply: number; projectType: MintPageStatic['projectType'] } }
export const mintPageInputSchema: z.ZodType<MintPageInput>   // the row's editable fields, sections by sectionsSchema
export async function mintPageSettingsCore(ctx: PhasesContext): Promise<DeployOutcome<MintPageSettingsView>>
export async function presignMintPageMediaCore(ctx: PhasesContext, asks: MediaAsk[]):
  Promise<DeployOutcome<{ key: string; putUrl: string | null }[]>>
export async function saveMintPageCore(ctx: PhasesContext, input: MintPageInput):
  Promise<DeployOutcome<MintPageSettingsView>>
export async function setMintPagePublishedCore(ctx: PhasesContext, published: boolean):
  Promise<DeployOutcome<{ published: boolean }>>
// app/actions/mint-page.ts: getMintPageSettings, presignMintPageMedia, saveMintPage, setMintPagePublished
```

Each action parses its input, runs its core through `phasesWrite` (session, ownership, the service client on first use)
and, after a successful save or publish, calls `updateTag(mintPageTag(slug))` and
`revalidatePath('/collections/[id]', 'layout')`. The cores:

- Every core refuses a collection without a deployment with 'The contract is not deployed yet.'
- `mintPageSettingsCore`: the row (defaults without one), its keys with their URLs, the latest done real job's
  `base_uri` (`doneJobRow`), `collections.max_supply` and the project type. Only the owner's page receives `realBaseUri`.
- `presignMintPageMediaCore`: at most 21 asks; each refused with its `mintPageMediaProblem` sentence; an object already
  stored at the key with the same length and type answers `putUrl: null`; otherwise a PUT URL on the mint-page bucket
  bound to the type and the length, valid 15 minutes (`presignPut`, `headObject` and `deleteObjects` take the bucket
  as `presignGet` does).
- `saveMintPageCore`: `mintPageInputSchema` (the row's fields and `sectionsSchema`, with the hosts of the Mint page
  tab's links); featured ids at most the collection's supply; every key `keyBelongs`; each key the stored row does not
  name must HEAD to an object of its slot's types within its cap, else 'A file did not finish uploading. Choose it
  again, then save.'; an upsert on `collection_id` with the session's client; then the objects the old row named and
  the new one does not are deleted (a failure is logged, never the save's); when the saved row is published,
  `ensureTokenRanksCore` (6.3; a failure is logged). A check violation reads 'Some fields could not be saved. Check them
  and try again.'
- `setMintPagePublishedCore`: without a link 'Set a link first. The page can go public once it has one.'; upserts
  `published` (a row with the defaults when none exists); the trigger's refusal reads as its message; on publishing,
  `ensureTokenRanksCore`.

### 6.3 The ranks (`apps/web/src/lib/mint/ranks-core.ts`)

```ts
export function ranksOf(tokens: readonly { id: number; dna: string[] }[], layers: Layer[]): number[]  // [id - 1], pure
export async function ensureTokenRanksCore(ctx: PhasesContext): Promise<'recorded' | 'present' | 'skipped'>
```

`ranksOf` is `rankTokens(tokens, attributeKeyOf(buildTraitIndex(layers)))` laid out by id, the ranks Generate shows.
`ensureTokenRanksCore` skips a collection that is not generative or has no done real job; answers `present` when the
owner reads a `token_ranks` row for that job; otherwise reads the job's `token_list` and the layers with their traits
(`readArtRows` with the owner's client, then `toProject`), and records `ranksOf` through `token_ranks_record` with the
service client. Callers: the save of a published page, `setMintPagePublished(true)`, and Settings' `confirmSettingsTx`
when the confirmed call is `setBaseURI` and the fresh view reads revealed (a failure there is logged and the confirm's
answer is unchanged).

### 6.4 The routes

- `app/[slug]/page.tsx`: outside sample mode, `readMintPage(slug)`; null, or a reserved word, is `notFound()`. It
  exports `generateStaticParams` answering `[]` and `revalidate = 60`, so a link renders on its first visit and is
  cached under its tag; `generateMetadata` reads the same cached document ("Mint <name>", the description's first 200
  characters, the banner as the Open Graph and Twitter image when there is one). Sample mode is per request, as today.
- `app/[slug]/preview/page.tsx` (new, dynamic): `readMintPagePreview(slug)`; null is `notFound()`; `robots` noindex; the
  same page under the preview banner (7.8). In sample mode, the sample under that banner.
- `not-found.tsx` and `loading.tsx` stay. No top-level route is added, so `RESERVED_SLUGS` stays as it is.

## 7. The web app

### 7.1 The freshness client and the live source (`apps/web/src/lib/mint/fresh-client.ts`, `live-source.ts`)

```ts
export const UNREACHABLE_AGE_S = 10, RETRY_MAX_MS = 8_000, OWN_DEGRADED_MS = 10_000, NEXT_ANSWER_MAX_MS = 2_000
export type StatePoll =
  | { kind: 'body'; body: StateBody; ageSeconds: number }
  | { kind: 'retry'; afterMs: number; reason: 'not-read-yet' | 'chain-unreadable' | 'busy' | 'stale' | 'network' }
  | { kind: 'final'; reason: 'not-a-collection' | 'unavailable' }
export type WalletPoll = { kind: 'body'; body: WalletBody } | { kind: 'retry'; afterMs: number } | { kind: 'final' }
export function pollState(base: string | undefined, chainId: number, address: Address, fetchImpl?: typeof fetch): Promise<StatePoll>
export function pollWallet(base: string | undefined, chainId: number, address: Address, wallet: Address,
  fetchImpl?: typeof fetch): Promise<WalletPoll>
export type FreshTrack = { body: StateBody | null; highestBlock: number; anchor: { seconds: number; at: number } | null
  lastGoodAt: number | null; failures: number; retryMs: number | null; final: 'not-a-collection' | 'unavailable' | null }
export function foldState(track: FreshTrack, poll: StatePoll, nowMs: number): FreshTrack
export function chainNowOf(track: FreshTrack, nowMs: number): number | null
export function ownDegraded(track: FreshTrack, nowMs: number): boolean
export function cadenceMs(track: FreshTrack, phases: readonly Phase[]): number | null
// live-source.ts
export type MintSource = { pollState(): Promise<StatePoll>; pollWallet(wallet: Address): Promise<WalletPoll>
  chain: MintChain; tiers(baseUri: string, ids: number[]): Promise<{ total: number; ranks: Record<number, number> } | null>
  tokenArt(baseUri: string, id: number): Promise<TokenArt | null> }
export function liveMintSource(page: MintPageStatic, deps: { freshnessUrl: string | undefined; chain: MintChain
  supabase: SupabaseClient; fetchImpl?: typeof fetch }): MintSource
```

`pollState` fetches `base + statePath(...)` with `cache: 'no-cache'`. A 200 whose body parses (zod, typed against
`StateBody`) for the asked chain and address is a `body` with `Age` in seconds (0 without the header); an `Age` above
10 is `retry` `stale` after 1 s; a 503 is `retry` after its `Retry-After` (1 s without one); a 404 `not-a-collection`
is `final`; a 404 of another code, a 400 and a missing base URL are `final` `unavailable`; anything else (a network
error, another status, a body that does not parse) is `retry` `network` after 1 s. `pollWallet` is the same on
`walletPath`. `foldState`: a body above `highestBlock` replaces the shown one, anchors the clock at `blockTimestamp +
ageSeconds` with `performance.now()`, sets `lastGoodAt` and clears the failures; a body at `highestBlock` replaces the
shown one and sets `lastGoodAt` but keeps the anchor; a body below is ignored and counts as nothing; a `retry` adds a
failure and sets `retryMs` to `min(RETRY_MAX_MS, afterMs x 2^(failures - 1))`; a `final` stops polling. `cadenceMs` is
null after a final, `retryMs` after a failure, 1,000 with no body or when a visible phase is `starting` or `scheduled`
with `startsIn` of at most 60, else 3,000. `ownDegraded` is a body shown with no accepted answer for 10 s.

### 7.2 The hooks (`apps/web/src/components/mint/use-live-state.ts`, `use-wallet-view.ts`, `use-token-art.ts`)

`useLiveState(source, page)` runs React Query (`refetchInterval` from `cadenceMs` over its body's phases,
`refetchIntervalInBackground: false`,
`refetchOnWindowFocus: true`, `retry: false`) and folds each poll into the track; it answers the track, `chainNow`
(ticking each second from the anchor) and `nextAnswer()`, which resolves on the next accepted body or after
`NEXT_ANSWER_MAX_MS`. `useWalletView(source, wallet)` reads on the events of decision 14, retrying after `Retry-After`
up to 8 s. `useTokenArt(source, baseUri, ids)` caches each `(baseUri, id)` for the page's life (IPFS content does not
change).

### 7.3 What the page shows per answer

| Answer | The page |
| --- | --- |
| A body with a new block | Shows it; the clock re-anchors; the page's own degraded clears |
| A body at the same block | Its fields replace the shown ones (`degraded` may have changed); the clock runs on |
| A body below the highest block | Ignored |
| `degraded: true` | The banner: "Live status may be out of date." and "We have not reached the chain for N minutes, so counts and phase status can lag. Every mint is still checked against the chain before your wallet opens." (N from `readAt`; "for a little while" under a minute) |
| `Age` above 10 s, a 503, a network error, a body that does not parse | A failed poll, retried as 7.1 says. With nothing shown yet the panel reads "Reading the chain", and after 10 s "Live status is taking longer than usual. This page keeps trying."; with a body shown, the banner after 10 s |
| 404 `not-a-collection` | Final for this page load: no more polls; the panel reads "This contract could not be confirmed on its chain yet. Reload the page in a minute." with Reload, and no mint button |
| 404 of another code, 400, or a build without `NEXT_PUBLIC_FRESHNESS_URL` | Final: "Live status is not available for this collection right now." and no mint button |

A wallet answer that fails keeps the button at "Checking this wallet" while it retries; a final one follows the state's.

### 7.4 The page model (`apps/web/src/lib/mint/live-data.ts`, `components/mint/model.ts`)

```ts
export type MintLive = { block: number; blockTimestamp: number; readAt: number; degraded: boolean
  supply: { max: number; minted: number }; publicMaxMintPerWallet: number; fees: FeeSnapshot; groups: MintGroup[]
  creator: Address; royaltyBps: number; baseUri: string; revealed: boolean; mintOnBehalfActive: boolean
  transfers: 'open' | 'locked' | 'restricted' | null; royaltyEnforced: boolean }
export type WalletView = WalletState & { block: number }
export type LocalMint = { groupId: number; holder: Address; count: number; block: number }
export function liveOf(page: MintPageStatic, body: StateBody): MintLive
export function walletViewOf(body: WalletBody): WalletView
export function revealedOf(baseUri: string, placeholders: readonly string[]): boolean
export function transfersOf(level: StateBody['transferLevel']): MintLive['transfers']
```

`liveOf` joins the groups with `joinPhases(body, page.phases)`, takes the fees as wei strings, the owner as the creator
and the royalty's basis points, and the reveal and the rows by decisions 22 and 24. `walletViewOf` maps each
`QuotaBody` to `{ groupId, quota, used: claimed, eligible: id === 0 || quota > 0 }` and keeps a vault's whitelist groups
with quota above 0, dropping a vault with none. `model.ts` takes `MintLive` and `MintPageStatic` in place of the sample
`MintPageData`, and `LocalMint[]` in place of `LocalMints`: `derivePhases` adds a local mint to supply counts when its
block is above `live.block` and to allowances when above the wallet view's block; `sortPhases` keeps the join's order
within each section; `deriveAction` gains "Reading the chain" (no body) and "Checking this wallet" (connected, no
wallet answer), and after a final refusal the panel shows 7.3's sentence in place of the button. Otherwise the labels
stay: at T-1, "Starts in 00:00:01";
past the start by the clock while `active` is false, "Starting, waiting for the chain"; "Mint N for X" only when the
group is `active`. `MintPageExtras` goes: the creator, the royalty and `degraded` are in `MintLive`, the previews in
`tokenArt`.

### 7.5 The mint action (`apps/web/src/lib/mint/mint-call.ts`, `mint-run.ts`, `wagmi-chain.ts`; `lib/wagmi.ts`)

```ts
export type MintCall = { address: Address; abi: typeof collectionAbi; functionName: 'batchMint' | 'delegateMint'
  args: readonly [bigint, bigint] | readonly [bigint, bigint, Address]; value: bigint; chainId: number; account: Address }
export function mintCallOf(params: MintParams): MintCall
export function mintedTokenIds(receipt: Pick<TransactionReceipt, 'logs'>, contract: Address, receiver: Address): number[]
export type MintChain = { simulate(call: MintCall): Promise<() => Promise<Hex>>
  receipt(hash: Hex, chainId: number): Promise<TransactionReceipt> }
export async function runMint(chain: MintChain, params: MintParams,
  live: { isLive(groupId: number): boolean; nextAnswer(): Promise<void> },
  steps: { wallet(): void; sent(hash: Hex): void }): Promise<{ hash: Hex; tokenIds: number[]; block: number }>
export function wagmiMintChain(config: Config): MintChain
```

`MintParams` keeps its fields; `valueWei` is `quote(live, group.priceWei, quantity).totalWei`. `runMint` simulates;
on a simulation failing with `MintGroupInactive` while `isLive(group)` is true it awaits `nextAnswer()` and simulates
once more; it calls `steps.wallet()` and the send only after a passing simulation, `steps.sent(hash)` on the hash, then
waits for the receipt: `reverted` throws `reverted`; `success` answers the hash, `mintedTokenIds(receipt, contract,
account)` (the collection's `Transfer` logs from the zero address to the account, sorted) and the receipt's block.
Errors become `MintFailure` through 7.6. `wagmiMintChain` simulates with wagmi's
`simulateContract(config, { ...call })` and returns `() => writeContract(config, simulated.request)`; the receipt is
`getPublicClient(config, { chainId }).waitForTransactionReceipt({ hash, timeout: 180_000 })`, as the manage actions
read theirs. `useMintFlow` keeps its steps (checking, wallet, confirming, success or error) on `runMint`; after a
success it records the local mint, reads the wallet and polls the state at once. `lib/wagmi.ts` gains
`transports: Object.fromEntries(chains.map((chain) => [chain.id, http()]))`.

### 7.6 Failures (`apps/web/src/lib/mint/mint-failure.ts`, `components/mint/mint-flow-dialog.tsx`)

`mintFailureOf(error, at: 'checking' | 'wallet' | 'confirming')` reads the error's cause chain as `tx-errors.ts` does
(a rejection is `UserRejectedRequestError` or code 4001; "insufficient funds" anywhere is the balance; the revert is
viem's decoded `ContractFunctionRevertedError`) and answers a kind with the revert's counts. `MintFailureKind` and the
dialog's copy:

| Kind | When | Title | Sentence | Actions |
| --- | --- | --- | --- | --- |
| `rejected` | Cancelled in the wallet or at the switch | You cancelled in your wallet | Nothing was sent and nothing was charged. You can try again whenever you are ready. | Try again, Close |
| `phase-closed` | `MintGroupInactive`, after the one retry | This phase is not open | The check found the phase closed, so nothing was sent. The page shows which phases are open. | See open phases |
| `sold-out` | `ExceedsMintGroupMaxSupply`, `ExceedsMaxSupply` | Fewer tokens are left | Only N are left, so nothing was sent. (At 0: Every token of this phase is minted. Nothing was sent.) | Mint N, Close |
| `quota-exceeded` | `ExceedsPublicMaxPerWallet`, `ExceedsMintQuota` | That is more than this wallet can mint | This wallet can mint N more in this phase, often because another of its mints landed first. Nothing was sent. | Mint fewer, Try again |
| `not-listed` | `NotInWhitelist` | This wallet is not on the list | The contract does not list this wallet for this phase. Nothing was sent. | See open phases |
| `not-delegate` | `NotDelegate` | The vault no longer delegates to this wallet | delegate.xyz shows no delegation from this vault to this wallet for the collection. Nothing was sent. | Use this wallet, Close |
| `price-changed` | `InsufficientEther` | The price changed | The total changed after this page read it, so nothing was sent. The page shows the new total. | Try again |
| `insufficient-balance` | Insufficient funds | Not enough funds in this wallet | The wallet cannot cover the total plus gas. Nothing was sent. | Mint fewer, Try again |
| `contract-wallet` | `TransferToNonERC721ReceiverImplementer` | This wallet cannot hold the tokens | It is a contract that cannot receive ERC-721 tokens. Mint from another wallet. Nothing was sent. | Close |
| `wrong-network` | The wallet's chain changed before the send | Your wallet changed network | Switch back to <chain>, then try again. Nothing was sent. | Try again |
| `check-failed` | Any other failure of the simulation, the network's included | The check could not be completed | The mint could not be checked against the contract. Nothing was sent. Try again in a moment. | Try again, Close |
| `wallet-failed` | Any other failure in the wallet | Your wallet did not send it | <the wallet's short message> Nothing was charged. | Try again, Close |
| `reverted` | The receipt's status is reverted | The transaction failed on chain | The network rejected it, usually because the phase closed or sold out while it waited. No tokens were minted; only gas was spent. | Try again, Close |
| `unconfirmed` | No receipt within 180 s | Not confirmed yet | The transaction was sent but is not confirmed after three minutes. It may still land: check it on the explorer before you mint again. | View transaction, Close |

The dialog stays locked while the wallet is open or the transaction is in flight, as today; "Mint N" sets the
quantity to the count the revert named and closes the dialog.

### 7.7 Art, the reveal and rarity (`apps/web/src/lib/mint/token-art.ts`, `components/mint/mint-success.tsx`)

```ts
export type TokenArt = { layers: string[]; video: boolean }
export function gatewayUrlOf(uri: string, gateway: string): string | null   // ipfs:// to <gateway>/<cid>/<path>; https kept
export async function tokenArtOf(baseUri: string, id: number, gateway: string, fetchImpl?: typeof fetch): Promise<TokenArt | null>
```

`tokenUriOf` in `settings-view.ts` gains an optional `tokenId` (default 1) for the contract's rule. `tokenArtOf` fetches
the metadata at `gatewayUrlOf(tokenUriOf(baseUri, id), gateway)`, reads `image`, and answers its gateway URL, `video`
when it ends in `.mp4`; a failed fetch or a missing image is null, shown as the `Artwork` pattern with "#<id>". What
shows where, by the state's `revealed`:

- The art stage: the carousel's slides when it is on (uploads always, token slides once revealed), else the featured
  tokens once revealed, else one card with token 1's art at the state's base URI (the placeholder's image before the
  reveal, the one image of a single asset), else the avatar until the state answers.
- "From the collection": the featured tokens once revealed; hidden before the reveal and for a single asset.
- The success view: each minted id's art at the state's base URI. Under the grid: on a generative collection, revealed
  and ranked, each token's tier chip (`TierDot` and `rarityTier(rank, total)` from Generate's `rarity.tsx`, its range as
  the title, such as "Top 15% by rarity"); generative and not revealed, one line "Rarity shows after the reveal";
  generative and revealed without ranks, nothing; single asset and 1/1, "#12 of 500" under each token. Tiers are asked
  once per mint, through `source.tiers(baseUri, ids)` (the first 20 ids), and a failure shows nothing.
- Details: Art reads "Revealed" or "Not revealed yet", from the state.

### 7.8 Sections, Remind me, Details and the preview banner

- `components/mint/page-sections.tsx` (new): after About and Details, in this order and each only when on and not
  empty: Roadmap (date, title, description), Team (photo or the `Artwork` pattern, name, role, bio, the member's links
  as icon buttons), FAQ (shadcn `Accordion`, one open at a time). Text keeps its line breaks (`whitespace-pre-line`).
- `components/mint/music-button.tsx` (new): in the top bar when the music section is on with a track: a play and pause
  button ("Play music", "Pause music") with the file name in a tooltip, an `<audio>` with `preload="none"` and `loop`,
  never playing on load; the avatar is its Media Session artwork.
- `lib/mint/remind.ts` and `components/mint/remind-me.tsx` (new): `icsOf(reminder, stampSeconds)` writes one `VEVENT`
  (CRLF lines folded at 75 octets, text escaped, `UID:<chain id>-<contract>-<group id>-<start>@cobweb`, `DTSTART` and
  `DTEND` 30 minutes later in UTC) and `googleCalendarUrl(reminder)` the template link with `dates` as `<start>/<end>`,
  each `YYYYMMDDTHHMMSSZ`; the menu (shadcn `DropdownMenu`) sits under the countdown and on scheduled rows, and the file
  is saved as `<slug>-phase-<id>.ics`.
- `collection-sections.tsx`: About shows the About banner (else the banner); Details reads supply, royalties, transfers
  and art from `MintLive` (decisions 22 and 24); phase rows show their descriptions.
- The top bar's avatar and the backdrop take the URLs, with the `Artwork` pattern and a gradient of the theme's
  colour tokens when there are none.
- `components/mint/preview-banner.tsx` (new), on the preview only: "Preview. Only you can see this page; it is not
  public yet." or, once public, "Preview of your public page.", with a link to the Mint page tab.

### 7.9 The Mint page tab, the Overview, Deploy and Settings

- `app/collections/[id]/manage/mint-page/page.tsx`: on real data, `getMintPageSettings` and the phases view (`getPhases`)
  for the miniature; in sample mode as today.
- `mint-page-screen.tsx`: one draft holds the row's fields and the sections (lifted out of `MintPageSections`' own
  state). Save asks `presignMintPageMedia` for the new files, PUTs each with its type, then calls `saveMintPage`; a
  failed PUT stops it with "A file could not be uploaded. Try again." and nothing is written. The public switch saves
  with Save. The link field (`MintPageAddressField`, `reserveSlug`) and its copy stay; "Preview" opens
  `/<slug>/preview` once the link exists, and "Open mint page" shows once public. The description's hint becomes
  "Shown in About on the page."
- `mint-page-fields.tsx` and `mint-page-section-parts.tsx`: the slots take 4.4's types and caps (SVG leaves); an About
  banner slot joins the About panel. `FeaturedPicker` and the carousel's "Add a token" list ids 1 to 48 of the
  rendered set (at most the supply) with thumbnails through `useTokenArt` at `realBaseUri`, plus "Add by number" for
  any id up to the supply; without a done real job, "No token previews yet. They appear once the art is rendered.";
  for a single asset, "Every token shares one image, which the page shows in place of featured tokens."
- `mint-page-sections.tsx`: the "Phase 6" badge and the "Preview only" sentence go; the panel reads "Team, roadmap,
  FAQ, music and a carousel. Each shows on the page when its switch is on and it has content."
- `mint-page-preview.tsx`: on real data, minted and the live phase come from the phases view, with the draft laid over.
- The Overview: `OverviewHeader`'s avatar from the row (the `Artwork` pattern without one); `MintPageLinkBar` starts
  from the row and its switch calls `setMintPagePublished`; sample mode keeps `SAMPLE.mintPage`.
- The deployed view: the next step reads "Add a banner and links, then make the page public." and the link row "Not
  public yet. Make it public in Manage drop, Mint page." or "Open mint page" once public.
- `app/actions/mint-page-address.ts`: after a link is saved on a deployed collection, `updateTag(mintPageTag(slug))`, as
  a not-found answer may be cached for it.
- `app/actions/settings.ts`: `confirmSettingsTx` calls `ensureTokenRanksCore` as 6.3 says.

## 8. Sample mode

- `/[slug]` in sample mode builds `MintPageStatic` from `DEMO_MINT_PAGE_SETTINGS`, `DEMO_MINT_PAGE_SECTIONS` and the
  sample collection, and `sampleMintSource` (`components/mint/sample-source.ts`) answers polls with a state body made
  from `getMintPageData(slug, variant)`: its clock advances in real seconds from `DEMO_NOW`, and a scheduled group reads
  active 2 s after its start on that clock, as the chain would report it. The wallet is today's sample wallet, the chain
  today's simulated check, send and wait (`simulateMint`, `sendMint`, `waitForMint`) as a `MintChain`, tiers are
  `DEMO_TOKENS`' ranks once revealed, and art is `/demo/tokens` or the stacked layers.
- The switches stay: `?state=`, `?wallet=`, `?degraded=1`, `?start=<seconds>`, and `?fail=` now takes every kind of
  7.6. New: `?refusal=reading|slow|not-a-collection|unavailable` (the panels of 7.3), `?art=placeholder` (before the
  reveal) and `?type=single_asset|one_of_one` (the rarity spot's alternative).
- `/<slug>/preview` shows the sample under the preview banner. The Mint page tab keeps the sample row, files as browser
  URLs and Save after 900 ms (`saveOffChain`), with the sections in the one draft.

## 9. Stage rules

- Outside sample mode, `/<slug>` shows the page only for a deployed collection with a link and a published page;
  otherwise the not-found page ("This mint page does not exist or is not published yet."). `/<slug>/preview` shows it
  to the collection's owner only.
- The Mint page tab follows Manage drop's rules (deployed, or sample mode); publishing needs the link, and the switch
  stays off without one.

## 10. Testing

- Unit tests in `apps/web` (new unless marked):
  - `lib/mint/fresh-client.test.ts` on a fake `fetch`: the URL lowercases both addresses; `cache: 'no-cache'` is set; a
    body above the highest block anchors at `blockTimestamp + Age`, one at the same block keeps the anchor and takes
    `degraded`, one below is ignored; `Age` 10 is a body and 11 a failed poll; a 503 waits its `Retry-After`, then
    doubles to 8 s; 404 `not-a-collection` and `chain-not-served`, a 400 and a missing base are final; a body for
    another address is a failed poll; `cadenceMs` is 1 s with no body and with a phase 60 s from its start or starting,
    3 s at 61 s, null after a final; `ownDegraded` turns on 10 s after the last accepted body and not before.
  - `lib/mint/live-data.test.ts`: groups by position, "Group N" after them, hidden ones kept for the model to drop;
    revealed false for an empty base URI and each placeholder, true for the real one and a custom link; levels 0 and 1
    open, 9 locked, 2 to 8 restricted, `none` and `unread` null; the royalty sentence only at 0; wallet quotas to
    eligibility, the public group always eligible, vaults with whitelist quota only.
  - `lib/mint/mint-call.test.ts`: `batchMint` and `delegateMint` encode against hand-written signatures; the value equals
    the contract's `quoteBatchMint` formula for prices and fees with remainders; `mintedTokenIds` keeps the collection's
    `Transfer` logs from the zero address to the receiver, sorted, and drops other contracts, other receivers and
    transfers between holders.
  - `lib/mint/mint-run.test.ts` on a fake chain: the wallet step and the send never run when the simulation throws; the
    send gets the simulated request's function unchanged; `MintGroupInactive` while live waits for the next answer and
    simulates once more, and not when the group is not live; a reverted receipt throws `reverted`.
  - `lib/mint/mint-failure.test.ts`: each row of 7.6 from a decoded revert, a 4001, an insufficient-funds message, a
    chain mismatch, a transport error at the check and a receipt timeout, with the counts in the sentences.
  - `lib/mint/token-art.test.ts`: `gatewayUrlOf` for `ipfs://` paths, `https://` kept, other schemes refused; the
    metadata's image through the gateway, an MP4 as video, a failed fetch as null; a single-file base for every id.
  - `lib/mint/remind.test.ts`: the `.ics` in UTC with CRLF, escaped commas, semicolons and line breaks, folded lines, a
    30-minute end and the UID; the Google link's dates and encoded text.
  - `lib/mint/page-doc.test.ts`, `media.test.ts` and `ranks-core.test.ts`: the document parses; each section's limits,
    a failing section left off and the rest kept; keys per slot, another collection's refused; each slot's types and
    caps, an SVG refused, the avatar's 400 px; `ranksOf` equals `rankTokens` with `attributeKeyOf`, laid out by id.
  - `components/mint/model.test.ts` (changed): the labels of 7.4 (T-1 "Starts in 00:00:01", starting, live, reading,
    checking, not listed, wallet and vault limits, phase sold out, sold out, switch); local mints counted
    above the state's block for supply and above the wallet's for allowances, never twice; the join's order within
    each section.
  - `components/mint/sample-source.test.ts`: the sample clock flips a scheduled group 2 s after its start; each
    `?refusal=` and `?fail=` value.
  - Changed: `lib/manage/settings-view.test.ts` (`tokenUriOf` with an id), `lib/wagmi.test.ts` (a transport per chain).
- `packages/shared`'s `freshness-wire.test.ts`: both paths lowercase; `apps/freshness`'s `routes.test.ts`: they route.
- `verify:local`, 365 plus 14 (379): "anon: reads nothing from mint_pages" and "anon: reads nothing from token_ranks" in
  the anon loop, and a section 9n on a collection recorded as deployed as 9k records one, beside a draft:
  1. "mint_pages: the owner inserts and reads its row; B reads nothing and cannot insert, update or publish it"
  2. "mint_pages: a description over 2,000 characters, an http link, an X link on another host, a 201-character link,
     seven featured ids, a repeated or zero id, a key outside the collection or of another shape, and sections over
     64 KB or naming another collection's key are refused"
  3. "mint_pages: publishing a draft, or a deployed collection without a link, is refused; publishing a deployed
     collection with a link sets published_at"
  4. "mint_pages: the owner cannot set published_at or updated_at, and cannot delete the row"
  5. "mint_page: anon and B read the published document by its link in any case, and null for an unpublished page, a
     draft and an unknown link"
  6. "mint_page: the document has the page's fields and the phases by position, an empty description reads the
     collection's, and it holds no owner id, payout, transaction, fee, CID, real base URI or whitelist entry"
  7. "mint_page: placeholders hold the placeholder job's and the deploy-time base URIs, never the real job's"
  8. "mint_page_preview: the owner reads the unpublished document; B and anon read null"
  9. "token_ranks_record: a signed-out caller and the owner's session cannot execute it; the service role records a
     permutation for the done real job and answers true, a second record false"
  10. "token_ranks_record: a placeholder job, another collection's job, a wrong length and a repeated rank are refused"
  11. "token_ranks: the owner reads its job's row; B and anon read nothing; no client writes it"
  12. "mint_page_tiers: up to 20 ids at the real base URI of a published generative collection; null for another base
      URI, an unpublished page, 21 ids or no ranks"
- `verify:mint-page` (new, `scripts/verify-mint-page.ts` on `deploy-fixture.ts`; `"verify:mint-page": "node
  --conditions=react-server --import ./scripts/resolve-ts.mjs scripts/verify-mint-page.ts"`; `@wagmi/core`, at the
  version `wagmi` resolves, joins the dev dependencies for `createConfig`, `mock` and `connect` outside React). It needs
  local Supabase with the mint-page bucket, local storage and Anvil with the factory. A creator deploys a collection
  through `deployedCollection`, a supply of 3 with Public at 0.001 ETH (allocation 2, 1 per wallet) and Holders free
  (allocation 1); a holder and a stranger are fresh keys given 10 ETH; the server runs from `startFreshness({ port: 0,
  chainIds: [31337] })`; polls run at the page's cadence. The checks:
  1. "setup: Anvil answers as 31337 with the factory approving the shipped code hash, Supabase and the mint-page bucket
     answer, and the freshness server serves 31337 on a free port"
  2. "unpublished: the link reads null from mint_page as anon, and the owner's preview reads it with published false"
  3. "media: a banner and an avatar are signed bound to type and length, put, and read without a session at their media
     URLs with their types; a 6 MB banner, an SVG and a WAV for the music are refused before signing"
  4. "save: the description, the four links, featured tokens 1 and 2 and the five sections with a team photo and an MP3
     are saved; another creator's save is refused as not found; a key never uploaded is refused"
  5. "publish: anon reads the document, readMintPage's builder turns keys into media URLs, the phases read Public then
     Holders, placeholders is empty (deployed on the real set), no private field is present, and the ranks are
     recorded"
  6. "replaced media: a save with a new banner deletes the old object, which no longer reads; the new one reads"
  7. "state: the live source reads the state at a lowercase URL; liveOf shows Public and Holders by name and position,
     the owner as the creator, 500 bps, revealed, no Transfers row (Anvil has no validator) and Public's quote"
  8. "T-1: with Public scheduled at T and a block mined at T-1, the page's action reads 'Starts in 00:00:01', blocked,
     and nothing is sent"
  9. "T: a block mined at T is read by the page's 1 s polls with Public live within 2.5 s, the action reads 'Mint 1 for
     <total>', and no body with a block time below T read Public live"
  10. "price changed: the stranger's 1 from Public with one wei under the quote fails the check as price-changed and
      sends nothing (its nonce unchanged)"
  11. "mint: runMint through wagmiMintChain (the mock connector, the holder impersonated) mints 1 from Public; the sent
      transaction's calldata and value are the simulated request's, the value is the page's quote, and the id is 1"
  12. "after the mint: the local mint counts while the state's block is below the receipt's and not after, so minted
      reads 1 once; the holder's wallet answer reads publicMinted 1 and the action 'Wallet limit reached'"
  13. "whitelist: after the creator opens Holders and writes a quota of 2 for the holder, the holder's Holders phase
      reads eligible with 2 left and the stranger's not eligible, both with no vaults (Anvil has no registry)"
  14. "over quota: 3 from Holders fails the check as quota-exceeded and sends nothing"
  15. "tiers: the tiers read answers ids 1 and 2 at the real base URI with ranksOf's ranks over the stored list, and null
      at any other base URI"
  16. "refusals: the factory's address reads final not-a-collection, and with the server closed a poll reads a retry
      after 1 s"
  17. "unpublish: anon reads null again while the preview still reads the document; the fixtures are removed"

  Seventeen PASS lines. Checks 8 and 9 are the browser half of Phase 6's exit criterion on the page's own code.
- The browser walk, recorded in the landing note, with the dev wallet against local Supabase, Anvil, `pnpm --filter
  @cobweb/freshness dev` and the web app with `NEXT_PUBLIC_FRESHNESS_URL=http://127.0.0.1:3100`: (1) the tab saves a
  description, banner, avatar, About banner, links, featured tokens and the five sections with media; Preview shows them
  under its banner while `/<slug>` is not found; (2) publish, and `/<slug>` shows the page: skeleton, then the state; (3)
  a phase scheduled 60 s ahead counts down on the chain clock; at T-1 the button reads "Starts in 00:00:01" and a click
  opens no wallet; at T it reads "Starting, waiting for the chain" until the poll, then "Mint 1 for ..."; (4) Remind me's
  link and file; (5) a mint through the wallet: check, wallet, confirming, success with the art and the rarity spot,
  counts updated, the wallet limit; (6) a listed and an unlisted wallet; (7) a rejection and an over-quota check; (8)
  the server stopped: the banner after 10 s, cleared on restart; (9) a phone width: the drawer, the sticky bar, the 14 px
  root; (10) every sample switch.
- `pnpm typecheck && pnpm lint && pnpm test && pnpm format:check`, `pnpm build`, and every verify script at its count.

## 11. Documentation

- `CLAUDE.md`: after `verify:freshness`, `pnpm --filter @cobweb/web verify:mint-page   # the public page against local
  Supabase, local storage, Anvil and the freshness server in process: save, media and publish, liveness at T-1 and T, a
  mint through the page's path and the state after it, the tiers`; the `supabase seed buckets` comment names the
  `mint-page` bucket too.
- `apps/web/.env.example`: `NEXT_PUBLIC_FRESHNESS_URL` ("The freshness server's origin, public: the mint page polls it
  from the browser. Local: http://127.0.0.1:3100 with `pnpm --filter @cobweb/freshness dev`. Read at build time;
  rebuild after changing it."); `MINT_PAGE_S3_BUCKET=mint-page` and `MINT_PAGE_MEDIA_URL` (server only; the bucket's
  public base, by default Supabase Storage's public URL for it; in production the R2 bucket's custom domain);
  `IPFS_GATEWAY_URL` (server only; a public gateway with no key in the URL, by default https://ipfs.io/ipfs).
- `turbo.json`: `NEXT_PUBLIC_FRESHNESS_URL` joins the build task's `env`.
- `docs/MASTER_PLAN.md`, dated notes only: the Phase 6 status line gains "Mint page on live data (second sub-project
  of three) landed on <date>; see [specs/2026-10-16-mint-page-live-data.md](specs/2026-10-16-mint-page-live-data.md)."
  with what exists, "Known:" with section 12's items and "Next: the indexer and the Overview."; under Mint page, a dated
  decision: "**The public page's data** (decided 16 October 2026). One definer read of a published page, cached by its
  tag; chain state only from the browser's polls of the freshness server; token art from metadata at the chain's base
  URI; rarity only for the revealed base URI."
- Dated notes: in [2026-10-03-creator-flow-ui.md](2026-10-03-creator-flow-ui.md) sections 4.6 and 13, what changed
  (the sections saved and shown, the caps, SVG gone, the About banner, the token avatar left out, Preview); in section
  4.7, the refusal panels, Remind me and the rarity spot; in [2026-10-14-deploy.md](2026-10-14-deploy.md), that "Open
  mint page" returns; in the freshness spec's section 12, that the item owed to this sub-project is closed and its
  server-render timeout is moot.
- This spec: the landing note after section 13.

## 12. Owed and known

- The third sub-project: the indexer, holders, recent mints, "Paid by minters" and per-recipient history. Meanwhile the
  page shows the minted count from the state, no holder count (sold out still links to the explorer's holders) and no
  recent mints; the Overview keeps holders and recent mints as sample and "Paid by minters" in sample mode only.
- Owed by the owner (hosted): the `mint-page` R2 bucket, public on a custom domain, with the art bucket's CORS rule for
  PUT from the app's origin; on Vercel, `NEXT_PUBLIC_FRESHNESS_URL` (the Railway domain until Cloudflare),
  `MINT_PAGE_S3_BUCKET`, `MINT_PAGE_MEDIA_URL` and `IPFS_GATEWAY_URL` (a Filebase dedicated gateway), then a rebuild;
  `supabase db push`; `NEXT_PUBLIC_DEMO_DATA=0` when production leaves sample mode.
- Owed to Phase 7: the full Content-Security-Policy. For the mint page its `connect-src` lists `'self'`, the freshness
  origin, the Supabase origin (the tiers read), the IPFS gateway (metadata), each listed chain's public RPC (the check
  and the receipt) and the wallet connectors' endpoints (WalletConnect's relay and API, the Coinbase SDK); `img-src` and
  `media-src` add the media origin and the gateway. Also: Cloudflare in front, which the page's `no-cache` and `Age`
  rules already expect; a sweep of uploads never saved (a PUT without a save), on the upload sweep's pattern.
- Owed before launch, on a testnet: delegated minting with a whole-wallet and a contract delegation, and the transfer
  level, which Anvil cannot show (no registry, no validator).
- Known: tiers wait for a save of the published page or a reveal through Settings, so a reveal made outside Cobweb
  shows none until then; edits in Phases reach the page within 60 s (the tag's revalidation); the chain clock errs late
  by up to one server tick, and the banner's minutes and the `.ics` stamp use the browser's clock (labels only); the
  check and the receipt go to viem's public endpoints, which can rate-limit or fail ("The check could not be
  completed", nothing sent); the check is retried once on `MintGroupInactive`; a hidden phase still mints for anyone who
  calls the contract; the first visit to a link after a revalidation costs one function and one database read; the
  verify's collection has three tokens, so its tiers cover three ranks.

> **18 October 2026:** The full Content-Security-Policy landed ([2026-10-17-production-hardening.md](2026-10-17-production-hardening.md)): `connect-src` lists the Supabase, freshness, storage and gateway origins, each launch chain's public RPC and the WalletConnect and MetaMask hosts of the pinned versions (Coinbase's SDK is not among RainbowKit's default wallets); images come from any https host, and media from the storage, media and gateway origins. The page renders per request for its nonce. The sweep of mint page files no page names runs daily with the upload sweep, dry until `UPLOAD_SWEEP_DELETE=1`.

> **17 October 2026:** The third sub-project's items landed ([2026-10-16-indexer-overview.md](2026-10-16-indexer-overview.md)): the state body carries `activity`, the holders and the 10 latest mints from the indexer's memory, so the page shows a Holders row in Details and Recent mints under the phases, and neither while `activity` is null; the Overview shows holders, recent mints and "Paid by minters" on real data.

## 13. Acceptance criteria

- [x] The migration applies and `verify:local` passes (379): `mint_pages` and `token_ranks` are closed to `anon`, the
      owner writes its page within the checks, and the page is read publicly only through the three functions.
- [x] `/<slug>` renders a published page from its cached document and the freshness server's answers: liveness only from
      `active`, the cadence of 7.1, the clock of decision 12, `degraded` and every refusal of 7.3.
- [x] A mint is simulated with the state's exact quote and sent as the simulated request; the receipt gives the ids;
      every failure of 7.6 reads in words; local mints never count twice.
- [x] Vaults from the wallet answer mint through `delegateMint` on whitelist phases.
- [x] The Mint page tab saves its fields, media and sections, publishes, and previews; the Overview and Deploy read the
      row.
- [x] Remind me, the sections, the art before and after the reveal, the tiers and the "#12 of 500" spot show as section 7
      says.
- [x] `verify:mint-page` passes its 17 checks, the browser half of Phase 6's exit criterion among them; every other
      verify script, `pnpm typecheck`, `lint`, `test`, `format:check` and `build` pass.
- [x] Sample mode renders every state; the walk is recorded in the landing note.

Checked on 16 October 2026 on Anvil, local Supabase and its storage: `pnpm typecheck`, `pnpm lint`, `pnpm test` (web 877 in 93 files, shared 105 in 14 files, freshness 112 in 11 files, dna 60, render 117, worker 282) and `pnpm format:check` pass; `pnpm build` passes in sample mode and in live mode (`NEXT_PUBLIC_DEMO_DATA=0` with `COBWEB_TEST_CHAINS=1`), both listing `● /[slug]` and `ƒ /[slug]/preview`; the twelve verify scripts pass (`verify:local` 380, `verify:chain` 12, `verify:storage` 15, `verify:sweep` 8, `verify:render` 22, `verify:deploy` 15, `verify:phases` 20, `verify:whitelist` 18, `verify:airdrop` 15, `verify:settings` 17, `verify:freshness` 16, `verify:mint-page` 17), each with 0 failed. The browser walk ran with a fresh dev wallet and a collection made through the flow (three layers, twelve tokens, locked, paid, rendered with `render:local` and deployed on Anvil with Public at 0.001 ETH): (1) the Mint page tab saved the description, the banner, the avatar (a 200 px one refused in its field with "The avatar must be at least 400 by 400."), the About banner, the four links, four featured tokens and the five sections with a team photo, an image slide, a token slide and an MP3 ("Mint page saved" in under a second, six objects in the bucket under the collection id), and Preview showed them under "Preview. Only you can see this page; it is not public yet." with noindex while `/<slug>` answered 404 with the not-found sentence; (2) "Page is public" saved with the page, "Open mint page" appeared, and `/<slug>` showed the page, "Reading the chain" first and the state about 300 ms later, with the sections, the bucket images and the token art on the pattern fallback (the public gateway refuses the local CIDs); (3) with a phase scheduled from Phases two minutes ahead on the chain's clock and no other transaction sent, the row counted down once a second to "in 00:00:01", read "Start time reached, waiting for the chain" at T with no block at T, and left that state within a second of a block mined with `cast rpc evm_mine` (the button's own labels, "Starts in 00:00:01" and "Starting, waiting for the chain", are pinned by `verify:mint-page` checks 8 and 9 and by the model's tests); (4) Remind me offered Google Calendar (the calendar template URL in a new tab with noreferrer) and a calendar file named `<slug>-phase-<id>.ics` (CRLF, folded at 75 octets, the UID, a 30 minute event); (5) a mint through the wallet ran the check, "Confirm in your wallet" and the success view with the token's number, the pattern art and its tier chip ("Uncommon: top 50% by rarity", the rank Generate shows), the counts moved to 1 of 12 and "1 minted by you", and the action read "Wallet limit reached" with the per-wallet limit at 1; a free mint on the whitelist phase landed the same way; (6) on a whitelist phase the dev wallet read "This wallet is not on this list" before its chunk and "You are on this list. 0 of 1 minted" after it, the new group reading "Group 1" until the document cache refreshed within 60 s; (7) the rejection and the over-quota words were checked in sample mode (`?wallet=connected&fail=rejected`, `&fail=quota-exceeded`), `verify:mint-page` checks 10 and 14 sending the live ones; (8) "Live status may be out of date" showed about 10 s after the freshness server stopped and cleared 3 s after it came back; (9) at 390 px the root font read 14 px, nothing scrolled sideways, the fixed bar held the action, and the mint flow opened as a drawer from the bottom edge; (10) in sample mode `/night-owls` rendered every `?state=`, `?wallet=`, `?degraded=1`, `?start=10`, every `?refusal=` (the first body after 6 s for `reading`, "This page keeps trying" at 10 s for `slow`, the two final sentences), `?art=placeholder`, both `?type=` and all fourteen `?fail=` kinds with their words and ways forward, the retry succeeding; and, beyond the spec's list, (11) the Settings reveal recorded the ranks only when its pointer read revealed. Departures from this spec's letter, each ruled during the run: `/[slug]` reads no query and sample mode reads its switches in the browser (plan Decision 2); `turbo.json` is not touched, since Turborepo infers `NEXT_PUBLIC_FRESHNESS_URL` (Decision 3); the media and gateway URLs and the tag live in `page-urls.ts`, re-exported by `page-read.ts` (Decision 6); `readMintPagePreview` answers the collection id and null for a signed-out visitor (Decision 8); the ranks are taken over the collection's `tokens` rows, since a generative job stores no `token_list` (Decision 9); the route's `loading.tsx` is removed so a dead or unpublished link answers 404 on the first visit and from the cache (section 6.4 said it stays); the polls until the first body of a page load, and after a 60 s pause, bypass the browser's stored copy with `cache: 'reload'`, since a 304 served as 200 would anchor the chain clock on an old block; `verify:mint-page` check 9 also requires "Starting, waiting for the chain" on a clock reading T over the block at T-1, beyond section 10's sentence; a save carries the row's `updated_at` and is refused when the row changed elsewhere; the chosen phase is honoured only while it reads live and is dropped once it gives way, so a phase that reopens is offered in the picker rather than switched to; Try again restarts only the same phase and vault's mint and otherwise closes the flow; a start at or past 2^53 (uint256 max set outside Cobweb as "never") is read along the live path so the labels can say "Not scheduled" rather than the page retrying forever; the sticky bar's amount follows the mint label's total, so a zero price with a flat fee reads the fee, not "Free"; the freshness server's preflight answer allows `Cache-Control` and `Pragma` beside `If-None-Match`; `verify:local` counts 380 and its preview check also proves the anon refusal, and `verify:mint-page` check 6 also proves the stale-save refusal; a start past the year 9999 reads "Not scheduled" with no countdown; a sold-out check with none left reads "No tokens are left" and a spent quota offers Close; a zero total reads "Mint 1 free"; the public row's count is labelled "minted by you in <phase>", the phase's own count rather than a sum. Hosted steps still owed (section 12): the `mint-page` bucket on R2, public on a custom domain with the art bucket's CORS rule; `NEXT_PUBLIC_FRESHNESS_URL`, `MINT_PAGE_S3_BUCKET`, `MINT_PAGE_MEDIA_URL` and `IPFS_GATEWAY_URL` on Vercel, then a rebuild; `supabase db push` for the migration; `NEXT_PUBLIC_DEMO_DATA=0` when production leaves sample mode; iOS Safari and Firefox walked on a testnet before launch. Defects found and fixed during the run: the task fix rounds 9af2347 (the freshness client: `cache: 'reload'` until the first body, the replaced hash, the confirming read first, the metadata timeout), 1d8d894 (the page: the MintCancelled guard, the sticky bar per shape, the dead link's 404, the sample source built in SampleMintPage), 15fbd2b (the reminder's bound, the Google link on select, the tier colours in one module), 49b371d (the tab: the fieldset during a save, the three caps, an unreadable image refused, `runSave` lifted, the link patterns shared), 6dd006a (the sample switches) and 375dadf (the verify: check 9 "Starting" on a clock at T, the cadence, the cleanup); then the fix wave 22354dc (the chosen phase honoured only while it reads live), 9967771 (a save from a stale tab refused by `updated_at`), 81b8007 (a fresh poll after a 60 s pause), 819ccca (a start past the year 9999), 536c4c7 (a stored object never rewritten, a moved key against its slot's cap, every refused publish in words, the tag expired on every landed save, an empty file refused, the document checked again when read), 73e6c7c (`verify:local` section 9n), 48abfab (the final wallet sentence, the token art retried, spent vaults hidden, Try again closing the flow), b70ef3d (the Phases writes expire the tag, the PUT's time limit, the bucket guard, the Overview on a failed read), a9395dc (the preflight hedge), 52c0029 (the copy), and the optional 52fabbb (the sample page on its own chunk), fa47171 (no request URL in a FAIL line), 1405f98 (one logged ranks wrapper), 743c25f (the sold-out and quota words), e914cba (the dialog's width, `flowRuns`, the slow read from the tab's return), aed647f (one `sameAddress`, `isAddress`, the overlap line) and f5411cd (the dna `rank` sub-path); and the second wave 20850ee (the focus given back after a save sent with Enter), e14c247 (the pattern for token slides and the miniature while there is no base URI), 3bb613d (the host hints for a port or the wrong case, and b5ab140 naming the typed host in the case hint), b60ebcd (a section's image applied to the sections as they are when read), 57fb196 (the section, image and file errors tied to their controls), 2af8b64 (Try again only on the failed phase and vault), 8285d11 (the chosen phase dropped once it gives way), 0583cb3 (a start past 2^53 read on the live path) 04e650b (the sticky bar's amount from the mint label's total) and 0a03bb7 (the same draft kept for a no-op section update and every picked file's URL tracked from its landing).

## 14. Reconciliations with the rulings

Where a ruling could not be written as stated, or the rulings and the map left a gap, this spec takes the nearest
workable reading:

1. "ISR by tag" (Q19) with "the first paint's state from a server-side fetch": one Next render cannot be both cached and
   fresh without Cache Components, so the shell is cached by tag and the first state is the browser's first poll
   (decision 3); the freshness spec's owed server-render timeout is moot.
2. "Explicit wagmi transports from optional `NEXT_PUBLIC_RPC_URL_<id>`" (Q7): written as `http()` on viem's public
   endpoint per chain, since no RPC key may reach the browser and the freshness URL is the one new public variable.
3. "Token art through `NEXT_PUBLIC_IPFS_GATEWAY`" and images "from `render_batches.images_cid`" (Q11): the gateway is the
   server variable `IPFS_GATEWAY_URL`, passed with the page's content, and the art comes from each token's metadata at
   the chain's base URI, since a batch's images CID before the reveal shows every token of the batch.
4. "Reveal state through `pointerOf`" (Q11): the public document cannot carry the real target, so revealed means "not a
   placeholder" and the tiers function checks the real base URI on the server; Settings and the Overview keep
   `pointerOf`.
5. "Rank once when the real job finishes, or at first publish" (Q10): recorded when a published page is saved or
   published and when Settings confirms a reveal, leaving the worker as it is; one array per real job rather than a
   `tokens` column, since the rendered list, not the editable `tokens` rows, is what mints; "shown only when Revealed"
   is enforced by the server as well.
6. Media (Q9): the team photos, slides and MP3 join the ruled banner, avatar and About banner in the bucket, with caps
   below the form's 20 MB for images and no SVG; "a preview with a banner" for the owner is its own route.
7. Cadence and `degraded` (Q5, Q6): kept, with 1 s before the first answer, the page's own flag after 10 s without an
   accepted answer, and an `Age` above 10 s counted as unreachable (freshness spec item 26).
8. "Keeps the highest `block`" (item 26): a body at the same block is still taken, since it can carry a changed
   `degraded`, but it does not move the clock.
9. The countdown "anchored on each 200's `blockTimestamp` and `readAt`": anchored on `blockTimestamp` plus `Age`, so it
   errs late; `readAt` dates the banner (decision 12).
10. Kept as ruled, with these readings: vaults on whitelist phases only and no mint-on-behalf control (Q12, Q21); local
    mints measured against both the state's and the wallet answer's blocks (Q13); Coming up in the creator's order
    (Q22); Remind me storing nothing (Q24); the royalty sentence only at level 0 (Q25); the unlisted wallet (Q26); the
    sample's clock opening a scheduled group 2 s after its start, so the countdown's end can be reviewed (Q20).
11. The wallet endpoint, which the map left open: read on events, never on a timer (decision 14).
12. "The freshness origin in the CSP's `connect-src`": left to Phase 7's full policy, as MASTER_PLAN's Phase 6 line
    records, with the page's origins listed in section 12.
13. The public read (Q1): three functions where the ruling names one, the owner's preview and the tiers answering only
    the owner or the revealed base URI.
14. Added: the wire types move to `@cobweb/shared`, `joinPhases`' row type widens, `tokenUriOf` takes an id, and the
    creator-flow audit's token avatar stays out.
