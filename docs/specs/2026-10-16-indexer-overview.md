# The indexer and the Overview: specification

Phase 6, third and last sub-project of three (the freshness server; the mint page on live data; the indexer and the
Overview), each with its own spec, plan and run. Product decisions: [../MASTER_PLAN.md](../MASTER_PLAN.md#decisions)
(Hosting: the freshness server; Mint page: the public page's data; Contracts: fees, burn; Flow: the holder snapshot)
and the Known items of the Phase 5 and Phase 6 status lines that name this sub-project: holders, recent mints, "Paid by
minters", per-recipient history, and airdrops and withdrawals made outside Cobweb. No questions were put to the owner:
under the standing instruction the recommended option is taken at every point, by the owner's stand-in, and each
decision below carries its reason. Rules 1, 3 and 4 bind it: liveness stays the contract's `active`; the mint page
polls the freshness server and calls no RPC for shared state; every server action checks the session and the
ownership, and every table has row-level security. What it consumes:
[2026-10-16-freshness-server.md](2026-10-16-freshness-server.md) sections 6.4 to 6.9 and section 12 ("Owed to the third
sub-project"), [2026-10-16-mint-page-live-data.md](2026-10-16-mint-page-live-data.md) sections 7.1, 7.4 and 12, and
[2026-10-15-airdrop-settings.md](2026-10-15-airdrop-settings.md) sections 4.1, 7.3, 7.5 and 12. The screens it puts on
real data: [2026-10-03-creator-flow-ui.md](2026-10-03-creator-flow-ui.md) section 4.6 (the Overview and Airdrop's
History), section 4.7 (the public page) and the audit rows of section 13 (Overview, Airdrop: History per recipient). The
contract: `contracts/src/CobwebCollection.sol` (`TokensMinted`, `TokensDelegateMinted`, `NFTsAirdropped`,
`MintFundsWithdrawn`, ERC721A's per-token `Transfer`, `creatorBalance()`). Legacy:
[../legacy/market-mint-and-data.md](../legacy/market-mint-and-data.md) section 4.3 (`mint_logs` and `airdrop_history`)
and section 8 (mint logs written by the freshness server from `Transfer` logs, idempotent per log).

## 1. Goal

Cobweb learns what happened on its collections from the chain, not from the browser. Inside the freshness server's
process on Railway, one indexer per served chain reads the logs of every collection Cobweb deployed there, from each
collection's deploy block to the chain's confirmation depth, and records each mint, each token's owner, each airdrop with
its recipients and each withdrawal, once per log, through one service-role function. A cursor per collection makes a
restart, a rescan and a backfill safe. The Overview shows holders, recent mints and "Paid by minters" on real data, and
Already withdrawn counts withdrawals made outside Cobweb. Airdrop's History lists airdrops sent from outside Cobweb with
their block times, and a By recipient view finds, pages and exports every wallet an airdrop reached. The state body the
mint page already polls gains `activity`, the holder count and the latest mints from the indexer's memory, so the page
shows Holders and Recent mints with no database on the request path. Sample mode runs on the same components.
`verify:indexer` proves on Anvil, local Supabase and the freshness server in process that every kind of record lands
once, survives a replay, a restart and a backfill, and reaches the Overview, Airdrop and the state body.

## 2. Decisions

1. **Scope.** Decision: the indexer in `apps/freshness` (targets, cursors, scans, records, writes, summaries), its
   migration (four tables, two changed tables, four functions), `activity` in the state body, the indexer on
   `/health`; the Overview's holders, recent mints and "Paid by minters" on real data; Airdrop's History with airdrops
   sent outside Cobweb, block times and the By recipient view; the mint page's Holders row and Recent mints; sample
   mode; `verify:indexer` and section 9o of `verify:local`; the unit tests; the walk; docs. Out: Cloudflare, the k6
   run, alerts, a second replica and a narrower database role (Phase 7); holder lists, a mints-over-time chart, a reorg
   rollback past the depth and collections deployed outside Cobweb's flow (not planned); any change to the contracts,
   the reader's tick, the wallet endpoint or the dashboard's chain reads. Considered: the Overview and the per-recipient
   view as a run of their own (each is a read of the same tables, and the plan stays at nine tasks, section 3).
2. **Where it runs.** Decision: in the freshness server's process, one indexer per served chain beside its reader,
   sharing the chain list, the clients and the RPC variables; the process gains a database client that the request
   path never uses. Railway's process is always on, so passes run every few seconds and a backfill continues without
   invocation limits or a lease; the state body can carry the indexer's summaries from memory, so holders and recent
   mints reach the mint page through the polls it already makes (rule 3) and no viewer request reaches the database;
   the provider keys already live there. Considered: a Vercel cron in `apps/web` (one run a minute at best, PLAN.md's
   "no CRON jobs" for mint data, overlapping runs that need a lease, and the page's list frozen into a document cached
   for 60 s); a second Railway service from the same package (isolation, but the page would need a database read or a
   call between services for the activity, and two services to deploy and watch).
3. **The database client.** Decision: `@supabase/supabase-js` with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, the
   names and the client the render worker uses. With neither set the indexer stays off and the server runs as today
   with `activity` null; one without the other refuses the start, as a malformed factory address does. Considered:
   plain `fetch` to PostgREST (a second client shape beside the worker's); a login role with execute on the four
   functions only (least privilege, but a direct Postgres connection, a driver and a password no migration can hold;
   listed for Phase 7).
4. **What it indexes.** Decision: every collection whose row is `deployed` with a `deployments` row on a served chain,
   read through `indexer_targets` every 60 s; a new one starts at its deploy transaction's block, read once from its
   receipt. Considered: the factory's `CollectionDeployed` logs (a collection deployed outside Cobweb's flow has no row
   for its records); storing the deploy block at confirm (a change to the deploy path for one read per collection).
5. **How it reads events.** Decision: per pass, one viem `getLogs` over the collection ABI's five events (`Transfer`,
   `TokensMinted`, `TokensDelegateMinted`, `NFTsAirdropped`, `MintFundsWithdrawn`) per group of collections sharing a
   cursor and per 100 addresses, over at most 500 blocks; a failed scan halves its group's range, down to one block,
   and a success restores 500; the front group is scanned in full on every pass and the lagging groups take at most 10
   scans a pass; every call goes through `RPC_URL_<id>`. Considered: one cursor per chain (a new collection would
   rescan every other collection's history); a scan per collection (calls that grow with collections that never mint);
   topics without addresses (every ERC-20 and ERC-721 `Transfer` on the chain shares the topic); the public endpoints
   the mint page's check uses (their rate limits are that spec's Known, and the indexer runs on the provider's quota).
6. **Reorg depth.** Decision: a pass reads up to the safe block, `head - confirmations + 1`, the depth payments and
   airdrop proofs use (`confirmations` from `@cobweb/shared`: Ethereum 5, the other launch chains and Robinhood Chain
   Testnet 3, Sepolia 2, Anvil 1), so every recorded log is as final as a recorded payment and nothing is rolled back. Considered: reading at the
   head with block hashes and a rollback window (rows that can vanish, for lists that trail the live minted count by
   seconds anyway).
7. **Cadence.** Decision: the next pass starts 1 s after one that left a collection below the safe block (a backfill),
   5 s after one that recorded anything or while the chain's reader is at its fast or live tier, and 20 s after any
   other. Considered: a fixed 5 s (four times the idle calls on six chains); the reader's tick (it reads only the hot
   collections, and at the head).
8. **The cursor.** Decision: one `indexer_cursors` row per collection; `indexed_block` means every log at or below it
   is recorded; a write moves it forward only and never past a gap. A pass writes when it has records, when a
   collection first reaches the safe block, or when its last write is a minute old, so an idle chain writes once a
   minute and a restart rescans at most a minute of blocks. Considered: a write on every pass (a database call every
   5 s per chain for nothing); a cursor per chain (decision 5).
9. **Pairing.** Decision: within a transaction, a collection's `Transfer` logs from the zero address since its last
   mint or airdrop event belong to its next `TokensMinted`, `TokensDelegateMinted` or `NFTsAirdropped`, the order the
   contract emits them in. A mint is recorded with its recipient, vault, group, amount and first token id when its
   transfers number its amount and all go to its recipient; otherwise it is not recorded and `/health` counts it. An
   airdrop is recorded with its counts and fee and one recipient row per run of consecutive ids; every `Transfer` moves
   its token's owner. Considered: decoding each transaction's calldata (a call per transaction, for what the logs
   carry); `NFTsAirdropped` alone (it names no recipient).
10. **The tables.** Decision: `mints`, `token_owners`, `airdrop_recipients` and `indexer_cursors` (section 4.1);
    `airdrops` and `withdrawals` take the indexer's rows beside Cobweb's proven ones, with `airdrops.sent_by` nullable
    and a new `airdrops.block_time`. Considered: separate tables for airdrops and withdrawals found on chain (History
    and the withdrawn sum would read two sources for one fact).
11. **Idempotency.** Decision: a mint is keyed by its transaction and log index, an airdrop and a withdrawal by their
    transaction (the first row wins, Cobweb's or the indexer's), a recipient row by its transaction and first token id,
    each inserted `on conflict do nothing`; a token's owner changes only for a later block and log index; holders are
    recounted from `token_owners`. A log read twice, a range rescanned after a restart and two processes writing at
    once leave one row each. Considered: balances per owner (a transfer applied twice would count twice).
12. **One write.** Decision: `indexer_record` takes one segment (a block range of one scan, cut at block boundaries
    at 2,000 logs) for the scan's collections in one transaction, checks the gap, writes every table, recounts holders,
    moves the cursors and answers the changed collections' holders and latest mints. Considered: a call per collection
    (a call per idle collection a minute); the service role writing the tables directly (the gap check and the holder
    count would live outside the transaction).
13. **Row-level security and readers.** Decision: the owner reads `indexer_cursors`, `mints` and `airdrop_recipients`
    through `private.collection_owned`; `token_owners` has no policy and no grant; no client writes any of them; `anon`
    reads nothing, and no public function is added, since the mint page's activity comes through the freshness server.
    Considered: a public definer for recent mints (the database on every viewer's poll, or a list frozen in the cached
    document).
14. **Holders.** Decision: the count of distinct owners of at least one token, the dead address left out (a burn is
    an airdrop to it), recounted by the write for the collections whose owners changed and kept on the cursor row.
    Considered: counting on read (each Overview load and each summary would scan the collection's owners).
15. **"Paid by minters".** Decision: `creatorBalance()` (Settings' read at the head) plus every `MintFundsWithdrawn`
    the contract emitted (the `withdrawals` rows, Cobweb's and the indexer's), shown once the indexer has read every
    block since the deploy. The creator's balance grows only on mints, by the price times the amount, and falls only to
    0 on a withdrawal, which emits what it paid out, so the sum is everything minters paid the creator, platform fees
    apart. Considered: each mint's value (no event carries it; the price at each mint's block would come from the price
    events and the constructor's arguments, a history one missed event would corrupt); `creatorBalance()` read at the
    indexer's block (an archive read during a backfill).
16. **The mint page's path.** Decision: the state body gains `activity`, the holders and the 10 latest mints from the
    indexer's summaries in memory, loaded at start through `indexer_summaries` and refreshed from each write's answer;
    the request path reads no database. Considered: the cached document (a list that never moves during a visit and is
    up to 60 s old at load); a new freshness endpoint (a second poll for two fields).
17. **Activity's freshness.** Decision: `activity` is null until the indexer has read the collection to the safe block
    once, and while its last such read is more than 300 s of chain time behind the state's `blockTimestamp`.
    Considered: a lag flag beside the list (one more state for the page to explain).
18. **What the mint page shows.** Decision: a Holders row in Details and a Recent mints list under the phases, each
    mint's receiver, count, phase as the phase list names it, time on the chain clock and transaction link; neither
    while `activity` is null. Considered: the holder count in the panel (the panel's count is minted of supply, which
    moves faster).
19. **The Overview on live data.** Decision: Holders from the cursor row, Recent mints (the 12 latest) from `mints`,
    "Paid by minters" by decision 15 and Already withdrawn from every withdrawal; "Counting" until the indexer has read
    every block since the deploy, and a line when its count is more than 5 minutes behind the chain read. Nothing on
    the Overview stays sample on real data; the mints-over-time chart, the platform fees line and the checklist stay
    dropped (the creator flow spec's review round 1). Considered: counts shown before the first full read (partial
    counts that read as final).
20. **Per-recipient history.** Decision: History gains "By transaction" and "By recipient"; By recipient reads
    `airdrop_recipients` 25 rows at a time on the server, newest first, searched by any part of the address, with
    "Export CSV" of every row. Considered: legacy's Import Type (Cobweb stores no list); every row in the page payload
    (up to 100,000 rows, the supply's cap).
21. **History's time and copy.** Decision: When is the block's time once the indexer has read the airdrop
    (`block_time`), else the time Cobweb recorded it; the description says whether the history is complete. Considered:
    `confirmed_at` alone (a backfill would date old airdrops at the backfill).
22. **`/health`.** Decision: each chain gains `indexer` (collections, those behind, the last safe block, the last pass,
    failed passes, the last error's name, unpaired mints and airdrops), null while the indexer is off. Considered: an endpoint of
    its own (Railway's check and Phase 7's alerts read one place).
23. **Sample mode.** Decision: the same screens on sample sources, with `?activity=counting` and `?activity=behind` on
    the Overview, `?activity=counting` on Airdrop and `?activity=none` on the mint page. Considered: no switches (the
    new states could then be reviewed only on a chain).
24. **`verify:indexer`.** Decision: 15 checks against local Supabase, Anvil with the factory and the freshness server
    in process with its indexer on fast intervals, on a collection deployed through the deploy fixture, through the
    app's own cores. Considered: more checks in `verify:freshness` (it runs on Anvil alone, without a database, by its
    decision 21).
25. **Docs and tests.** Decision: sections 10 and 11.

## 3. Scope

In: the migration and its types; the wire types; in `apps/freshness`, the indexer's modules, its options, its start and
stop, `activity` in the state body and the indexer on `/health`; in `apps/web`, the Overview's read and screen, Airdrop's
History and By recipient with its actions, the Settings sentence, the mint page's Holders and Recent mints; sample mode;
`verify:indexer`, section 9o of `verify:local`; the unit tests; docs; the owner's hosted steps (section 12). Out: as
decision 1. The plan's nine tasks, in order: (1) the migration, the types and section 9o; (2) the wire types and the
indexer's pure modules (`indexer-records.ts`, `indexer-plan.ts`, `activity.ts`) with their tests; (3) the indexer
(`indexer-db.ts`, `indexer.ts`), its options, the server's start and stop and `/health`; (4) `activity` in the state body
and its tag; (5) the Overview on live data; (6) Airdrop's History, By recipient and its export, and the Settings
sentence; (7) the mint page's Holders and Recent mints and the sample switches; (8) `verify:indexer`; (9) docs, the full
run and the walk.

## 4. Database (`supabase/migrations/20261016200000_indexer.sql`)

### 4.1 The new tables

```sql
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

create table public.token_owners (
  collection_id uuid not null references public.collections (id) on delete cascade,
  token_id bigint not null check (token_id >= 1),
  owner text not null check (owner ~ '^0x[0-9a-f]{40}$'),
  block bigint not null check (block >= 0),
  log_index integer not null check (log_index >= 0),
  primary key (collection_id, token_id)
);
create index token_owners_owner_idx on public.token_owners (collection_id, owner);

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

-- indexer_cursors, mints and airdrop_recipients: the owner reads; no client role writes.
alter table public.mints enable row level security;
create policy "mints: owner reads" on public.mints for select to authenticated
using ((select private.collection_owned(collection_id)));
revoke all on public.mints from anon, authenticated;
grant select on public.mints to authenticated;
-- the same three statements, named for their table, for indexer_cursors and airdrop_recipients

-- token_owners: no policy and no grant; only the definer functions below read it.
alter table public.token_owners enable row level security;
revoke all on public.token_owners from anon, authenticated;
```

The comments:

- `indexer_cursors`: "One row per deployed collection the indexer reads: every log at or below indexed_block is
  recorded. synced_at is the chain's time at the last pass that read the collection to the chain's confirmation depth,
  null before the first. holders counts the distinct owners in token_owners other than the dead address. Written only
  by indexer_start and indexer_record."
- `mints`: "One row per TokensMinted or TokensDelegateMinted log, at the chain's confirmation depth: the receiver of
  the tokens, the vault whose allowance a delegated mint used, the group, the amount and the first of its consecutive
  token ids. Written only by indexer_record."
- `token_owners`: "Each minted token's owner after the latest Transfer log at the chain's confirmation depth. Read by
  no client; written only by indexer_record."
- `airdrop_recipients`: "One row per run of consecutive token ids an airdropNFTs transaction minted to one address,
  from its Transfer logs. Written only by indexer_record."

### 4.2 `airdrops` and `withdrawals`

```sql
alter table public.airdrops alter column sent_by drop not null;
alter table public.airdrops add column block_time timestamptz;
```

The new comments: `airdrops`, "One row per airdropNFTs transaction: proven by Cobweb from its receipt and calldata
(airdrop_record) or read from its logs by the indexer (indexer_record), whichever lands first. kind is burn when the
only recipient is the dead address. sent_by is null for a row the indexer wrote, since logs do not name the sender;
block_time is the block's time, set by the indexer."; `withdrawals`, "One row per withdrawMintFunds transaction, with
the amount and payout address of its MintFundsWithdrawn log: proven by Cobweb from its receipt (withdrawal_record) or
read from the log by the indexer (indexer_record), whichever lands first." `airdrop_record` and `withdrawal_record` are
unchanged.

### 4.3 Functions

```sql
create function public.indexer_targets(p_chain_id integer) returns jsonb                      -- service_role
create function public.indexer_start(p_collection_id uuid, p_from_block bigint) returns jsonb  -- service_role
create function public.indexer_record(p_chain_id integer, p_from_block bigint, p_to_block bigint,
  p_synced_at timestamptz, p_collections uuid[], p_records jsonb) returns jsonb                -- service_role
create function public.indexer_summaries(p_chain_id integer) returns jsonb                    -- service_role
```

All are `security definer` with `set search_path = ''`, revoked from `public`, `anon` and `authenticated` and granted to
`service_role`. They answer jsonb, since PostgREST caps a set of rows at `max_rows` (1,000).

- `indexer_targets` (`stable`): `[{ "collectionId", "contract", "deployTx", "fromBlock", "indexedBlock", "syncedAt" }]`
  for every collection with `status = 'deployed'` and a `deployments` row on the chain, ordered by `deployed_at`, left
  joined to its cursor (the last three null without one); `syncedAt` in Unix seconds.
- `indexer_start` (`plpgsql`): refuses a collection without a `deployments` row with 'The contract is not deployed
  yet.' (`23514`); inserts its cursor (the deployment's chain and contract, `from_block` as given, `indexed_block` one
  below it) `on conflict (collection_id) do nothing`; answers the cursor as `indexer_targets` writes one.
- `indexer_record` (`plpgsql`), one segment of one scan:
  1. Locks the cursors of `p_collections` `for update`, in id order so two writers never deadlock. It refuses with 'A
     collection is not indexed on this chain.' (`23514`) unless every one has a cursor on `p_chain_id`, and with 'The
     indexer would skip blocks.' (`23514`) when `p_to_block` is below `p_from_block` or a cursor's `indexed_block` is
     below `p_from_block - 1`.
  2. Refuses with 'A record names a collection outside this write.' (`23514`) any record whose `collectionId` is not in
     `p_collections`.
  3. Inserts the mints `on conflict do nothing`; upserts the owners, changing a row only when the record's block and
     log index come later than the stored ones; inserts each airdrop with `sent_by` null `on conflict (tx_hash) do
     update set block_time = excluded.block_time where airdrops.block_time is null`, then its runs into
     `airdrop_recipients` `on conflict do nothing`; inserts the withdrawals `on conflict do nothing`. Each table's
     checks raise as they are.
  4. Sets `holders` for each collection with an owner record: the distinct owners other than
     `0x000000000000000000000000000000000000dead`.
  5. Sets each cursor's `indexed_block` to `greatest(indexed_block, p_to_block)`, its `synced_at` to
     `greatest(synced_at, p_synced_at)` when `p_synced_at` is given, and `updated_at` to now.
  6. Answers `{ "<collection id>": { "holders", "syncedAt", "recentMints" } }` for each collection with a record, the
     mints its 10 latest by block then log index, newest first.
- `indexer_summaries` (`stable`): `[{ "collectionId", "contract", "holders", "syncedAt", "recentMints" }]` for every
  cursor on the chain, as `indexer_record` answers them.

The records, addresses lowercase, times in Unix seconds:

```jsonc
{ "mints": [{ "collectionId": "<uuid>", "tx": "0x…", "logIndex": 9, "block": 120, "blockTime": 1760600000,
              "recipient": "0x…", "vault": null, "groupId": 0, "amount": 2, "firstTokenId": 5 }],
  "owners": [{ "collectionId": "<uuid>", "tokenId": 5, "owner": "0x…", "block": 120, "logIndex": 7 }],
  "airdrops": [{ "collectionId": "<uuid>", "tx": "0x…", "block": 130, "blockTime": 1760600100, "kind": "airdrop",
                 "recipients": 2, "tokens": 3, "feePaidWei": "150000000000000", "firstTokenId": 7, "lastTokenId": 9,
                 "runs": [{ "recipient": "0x…", "tokens": 2, "firstTokenId": 7 }, { "recipient": "0x…", "tokens": 1,
                 "firstTokenId": 9 }] }],
  "withdrawals": [{ "collectionId": "<uuid>", "tx": "0x…", "block": 140, "payoutAddress": "0x…",
                    "amountWei": "2000000000000000" }] }
```

A recent mint in the answers: `{ "tx", "recipient", "groupId", "amount", "firstTokenId", "blockTime" }`.

### 4.4 Types (`apps/web/src/lib/database.types.ts`, by hand)

`indexer_cursors`, `mints`, `token_owners` and `airdrop_recipients` gain Row, Insert, Update and Relationships as the
generator writes them; `airdrops` gains `block_time: string | null` and its `sent_by` reads `string | null`; Functions
gain the four functions with their arguments and `Json` answers.

## 5. The shared package

```ts
// packages/shared/src/freshness-wire.ts, changed
/** One mint the indexer recorded, as the state body carries it. */
export type MintBody = { txHash: Hex; recipient: Address; groupId: number; amount: number; firstTokenId: number
  blockTimestamp: number }
/** A collection's holders and latest mints, from the indexer at the chain's confirmation depth. */
export type StateActivity = { holders: number; recentMints: MintBody[] }
export type StateBody = { /* every field as today */ activity: StateActivity | null }
```

`recipient` is checksummed, as the body's other addresses are; `recentMints` holds at most 10, newest first. Nothing
else in the package changes: the indexer takes its events from `collectionAbi` and its depths from `confirmationsFor`.

## 6. The freshness server

### 6.1 Options, configuration and the start

```ts
// apps/freshness/src/config.ts, changed
export type IndexerOptions = { supabaseUrl: string; serviceRoleKey: string
  passMs?: { behind: number; fast: number; idle: number }; targetsEveryMs?: number }
export function indexerOptionsOf(env: Record<string, string | undefined>): IndexerOptions | null
// apps/freshness/src/server.ts, changed
export type FreshnessOptions = { port: number; host?: string; chainIds?: number[]; indexer?: IndexerOptions | null }
```

`indexerOptionsOf` answers the options from the two variables, null when neither is set, and throws a `BaseError` named
`ConfigurationError` with "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are both needed to run the indexer; set both or
neither." when one is set alone, which `index.ts` logs as a failed start. `index.ts` passes the options to
`startFreshness`; the verify passes its own. With options, `startFreshness` creates one database client and one
`chainIndexer` per served chain, which starts at once; `close()` stops the indexers with the readers and windows and
waits for a pass in flight. `apps/freshness/package.json` gains `"@supabase/supabase-js": "^2.117.2"`, the worker's
version; `./server` also exports `IndexerOptions`. The start's line gains "The indexer runs on <chain names>." or "The
indexer is off: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to run it."

### 6.2 The database port (`apps/freshness/src/indexer-db.ts`)

```ts
export type Target = { collectionId: string; contract: Address; deployTx: Hex; fromBlock: bigint | null
  indexedBlock: bigint | null; syncedAt: number | null }
export type Summary = { collectionId: string; contract: Address; holders: number; syncedAt: number | null
  recentMints: MintBody[] }
export type RecordWrite = { chainId: number; fromBlock: bigint; toBlock: bigint; syncedAt: number | null
  collections: string[]; records: Records }
export type IndexerDb = {
  targets(chainId: number): Promise<Target[]>
  start(collectionId: string, fromBlock: bigint): Promise<void>
  record(write: RecordWrite): Promise<Summary[]>
  summaries(chainId: number): Promise<Summary[]> }
export class IndexerWriteError extends Error { code: string; gap: boolean }
export function supabaseIndexerDb(options: IndexerOptions): IndexerDb
```

The client is `createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })`,
calling the four functions of 4.3. A refusal throws `IndexerWriteError` with the Postgres code, `gap` true for 'The
indexer would skip blocks.' and 'A collection is not indexed on this chain.'; its message names the function and the
code, never the database's message or the key.

### 6.3 The plan (`apps/freshness/src/indexer-plan.ts`, pure)

```ts
export const MAX_RANGE = 500n, ADDRESSES_PER_SCAN = 100, LAGGING_SCANS_PER_PASS = 10, MAX_LOGS_PER_WRITE = 2_000
export const PASS_MS = { behind: 1_000, fast: 5_000, idle: 20_000 } as const
export const TARGETS_EVERY_MS = 60_000, CURSOR_WRITE_EVERY_MS = 60_000
export type Cursor = { collectionId: string; contract: Address; scanned: bigint; written: bigint; range: bigint
  syncedAt: number | null; writtenAt: number }
export type Scan = { cursors: Cursor[]; fromBlock: bigint; toBlock: bigint }
export function safeBlockOf(head: bigint, confirmations: number): bigint
export function scansOf(cursors: readonly Cursor[], safe: bigint): Scan[]
export function segmentsOf<T extends { blockNumber: bigint }>(logs: readonly T[], scan: Scan,
  max?: number): { fromBlock: bigint; toBlock: bigint; logs: T[] }[]
export function passDelayMs(pass: { behind: boolean; recorded: boolean; tier: Tier | null },
  delays?: { behind: number; fast: number; idle: number }): number
```

- `safeBlockOf` is `head - confirmations + 1`, never below 0: the head on Anvil, four below it on Ethereum.
- `scanned` and `written` are blocks: `scanned` how far this process has read, `written` how far the database's
  cursor has moved; both start at `indexed_block`. `range` starts at 500.
- `scansOf` groups the cursors below the safe block by `scanned`. The front group (the highest `scanned`) is planned
  in full: one scan per 100 addresses. The other groups take at most 10 scans in all, the closest to the front first, so
  they reach it and merge. Each scan runs from `scanned + 1` to the lower of the safe block and `scanned + range`, the
  group's smallest `range`. Nothing is planned for a cursor at or above the safe block.
- `segmentsOf` cuts a scan's logs, sorted by block and log index, at block boundaries so that no segment carries more
  than 2,000 logs, unless one block alone does; the last segment ends at the scan's `toBlock`.
- `passDelayMs` answers `behind` when a cursor is below the safe block after the pass, else `fast` when the pass
  recorded anything or the chain's reader tier is `fast` or `live`, else `idle`.

### 6.4 The records (`apps/freshness/src/indexer-records.ts`, pure)

```ts
export const DEAD_ADDRESS = '0x000000000000000000000000000000000000dead'
export const INDEX_EVENTS  // the five events of decision 5, taken from collectionAbi with getAbiItem
export type IndexLog = { address: Address; eventName: (typeof INDEX_EVENTS)[number]['name']; args: unknown
  blockNumber: bigint; logIndex: number; transactionHash: Hex }
export type Records = { mints: MintRecord[]; owners: OwnerRecord[]; airdrops: AirdropRecord[]
  withdrawals: WithdrawalRecord[] }
export function eventBlocksOf(logs: readonly IndexLog[]): bigint[]   // blocks with a mint or an airdrop event
export function recordsOf(logs: readonly IndexLog[], collections: ReadonlyMap<string, string>,
  blockTimes: ReadonlyMap<bigint, number>): { records: Records; unpaired: number }
```

`collections` maps a lowercase contract to its collection id; a log of any other address is ignored. `recordsOf` walks
each transaction's logs in log index order, keeping per collection the pending transfers from the zero address:

- `Transfer(from, to, tokenId)`: an owner record for the token at its block and log index (only the latest per token
  is kept); from the zero address, the token joins the pending transfers.
- `TokensMinted(recipient, amount, mintGroup)` and `TokensDelegateMinted(vault, recipient, amount, mintGroup)`: when
  the pending transfers number `amount` and all go to `recipient`, a mint with the lowest pending id as its first token
  id, `vault` null for `TokensMinted`; otherwise one unpaired mint. A group id above 2^53 - 1 is not recorded, its
  transfers still move owners, and it counts as unpaired. The pending transfers clear.
- `NFTsAirdropped(recipients, amount, feePaid)`: with `amount` at least 1 and as many pending transfers, an airdrop
  with `recipients`, `amount` as its tokens, `feePaid`, the lowest and highest pending ids and its runs (consecutive
  pending transfers to one address); `kind` is `burn` when `recipients` is 1 and every run goes to the dead address.
  An airdrop of 0 tokens records nothing; a count that does not match is one unpaired airdrop. The pending transfers
  clear.
- `MintFundsWithdrawn(payoutAddress, amount)`: a withdrawal.
- Pending transfers left at the end of a transaction count as one unpaired mint.

Logs come from viem's `getLogs({ address, events: INDEX_EVENTS, fromBlock, toBlock, strict: true })`, decoded, so no
topic is written by hand.

### 6.5 The pass (`apps/freshness/src/indexer.ts`)

```ts
export type IndexerHealth = { collections: number; behind: number; block: number | null; lastPassAt: string | null
  failedPasses: number; lastError: string | null; unpaired: number }
export function chainIndexer(chain: ChainConfig, client: PublicClient, db: IndexerDb, options: {
  tier(): Tier | null; passMs?: IndexerOptions['passMs']; targetsEveryMs?: number }): {
  activityOf(address: Address, blockTimestamp: number): StateActivity | null
  health(): IndexerHealth
  stop(): Promise<void> }
```

Passes on a chain never overlap. Each pass:

1. Until the chain's summaries have loaded, loads them through `db.summaries` (a failure leaves `activity` null and
   is tried again on the next pass).
2. When the targets were read 60 s ago or never, or after a gap refusal, reads them through `db.targets`: a target
   without a cursor gets the block of its deploy transaction's receipt and `db.start`; a receipt that cannot be read
   is tried at the next read. Cursors take `indexed_block` and `synced_at` from the database only when they are new or
   after a gap refusal, so a restart starts from the database's cursor; a target no longer listed leaves with its
   summary.
3. Reads the head with `getBlock({ blockTag: 'latest' })`, its number and timestamp; a failure fails the pass. The
   safe block is `safeBlockOf(number, chain.confirmations)`.
4. Runs `scansOf(cursors, safe)` in order. A scan whose `getLogs` fails halves the range of its cursors (never below
   1n) and the pass goes on with the next scan; a scan that succeeds restores 500.
5. For each segment of a successful scan: the times of its `eventBlocksOf` blocks through `getBlock({ blockNumber })`
   (cached, at most 10 at once; a failure stops the scan's remaining segments); `recordsOf`; then a write when the
   segment has records, when a cursor of the scan reaches the safe block with no `syncedAt` yet, or when the scan's
   oldest `writtenAt` is a minute old. The write sends `fromBlock` one above the lowest `written` of the scan's
   cursors, `toBlock` the segment's end, `syncedAt` the head's timestamp when the segment ends at the safe block, else
   null.
6. A successful write sets `written` and `scanned` to the segment's end and `writtenAt` to now, and takes the answer's
   summaries. A deferred write sets `scanned` only. A failed write sets `scanned` back to `written` for the scan's
   cursors and stops the scan; a gap refusal also has the targets read again on the next pass.
7. Each cursor whose `scanned` reached the safe block takes the head's timestamp as its `syncedAt` in memory, written
   or deferred.
8. The next pass starts `passDelayMs` after this one started, at once when it ran longer.

### 6.6 Activity (`apps/freshness/src/activity.ts`, pure) and the state body

```ts
export const ACTIVITY_LAG_MAX_S = 300, RECENT_MINTS = 10
export function activityOf(summary: Summary | undefined, syncedAt: number | null,
  blockTimestamp: number): StateActivity | null
```

`activityOf` answers null without a summary, while `syncedAt` (the cursor's, in memory) is null, and when
`blockTimestamp - syncedAt` is above 300; otherwise the summary's holders and its first 10 mints with recipients
checksummed. `stateBody(chainId, entry, degraded, activity)` appends `activity` after `transferLevel`, and the state
route asks `indexer?.activityOf(entry.address, read.state.blockTimestamp)`. The ETag covers `activity`: a new mint, a
changed holder count or a flip to or from null answers 200, while a pass that only moves cursors leaves the tag as it
was. The page's parser takes a body without `activity` as null (7.5), so the two deploy in either order.

### 6.7 `/health` and the logs

`ChainHealth` gains `indexer: IndexerHealth | null`: the collections with a cursor, those whose `syncedAt` is null or
more than 300 s before the last head's time, the last safe block a pass reached, the last pass's time (ISO), the failed
passes (a failed head, scan or write counts one each), the last failure's error name and the unpaired mints and
airdrops; null while the indexer is off. It never carries a URL, a key or a message. The log lines, each with
`errorLine` or `failureLine` and never a full message: "An index pass on <chain> failed: <line>", "The index scan of
blocks <from> to <to> on <chain> failed, so its range halves: <line>", "The index write on <chain> failed: <line>",
"The deploy of <collection id> on <chain> could not be read; it is tried again in a minute." and "A mint or airdrop in
<transaction> on <chain> did not pair with its transfers and is not recorded."

## 7. The web app

### 7.1 The Overview's read (`apps/web/src/lib/manage/activity-view.ts`, `activity-core.ts`, `app/actions/activity.ts`)

```ts
// activity-view.ts, pure
export const RECENT_MINTS_SHOWN = 12, BEHIND_AFTER_S = 300
export type ActivityView = { counted: boolean; holders: number; countedAt: number | null
  recentMints: DropActivity['recentMints'] }
export function activityViewOf(cursor: CursorRow | null, mints: MintRow[]): ActivityView
export function behindOf(activity: ActivityView, readAt: number, chainReachable: boolean): boolean
export type PaidByMinters = { kind: 'wei'; wei: string } | { kind: 'counting' } | { kind: 'not-read' }
export function paidByMintersOf(settings: Pick<SettingsView, 'creatorBalanceWei' | 'withdrawnWei'>,
  activity: ActivityView | null): PaidByMinters
// activity-core.ts
export async function activityViewCore(ctx: PhasesContext): Promise<DeployOutcome<ActivityView>>
// app/actions/activity.ts: getActivity(collectionId), through phasesWrite
```

`CursorRow` and `MintRow` are the columns `activityViewCore` selects. It reads, with the owner's client, the
collection's `indexer_cursors` row and its 12 latest `mints` by block then log index; `counted` is `synced_at` set, `countedAt` its Unix seconds, and each mint maps to `{ txHash,
minter: recipient, amount, groupId, at: block_time, firstTokenId }`. `behindOf` is true only when the chain read is
reachable, the view is counted and `readAt - countedAt` is above 300. `paidByMintersOf` answers `not-read` without an
activity view or without `creatorBalanceWei`, `counting` while not counted, and otherwise the sum of
`creatorBalanceWei` and `withdrawnWei`.

### 7.2 The Overview's page and screen

- `manage/page.tsx` adds `getActivity(collection.id)` to its parallel reads; a refusal does not stop the page, it
  passes `activity: null`. Sample mode passes `sampleActivityView` with the page's `activity` search parameter
  (section 8).
  `OverviewScreenProps` replaces `activity: DropActivity` and `paidByMintersWei` with `activity: ActivityView | null`.
- `OverviewHeader`'s `holders` becomes `number | 'counting' | null`: the count, "Counting" while not counted, "Not read"
  when the view could not be read.
- Proceeds: "Paid by minters" shows on real data from `paidByMintersOf`: the amount, "Counting" or "Not read";
  "Already withdrawn" keeps `withdrawnWei`, which now also counts withdrawals made outside Cobweb.
- `RecentMints` takes the view: the table as today; under it, when `behindOf` holds, the behind line.

| Where | Sentence | Change |
| --- | --- | --- |
| Header, Holders, not counted yet | "Counting" | New |
| Header, Holders, not read | "Not read" | New |
| Recent mints, not counted yet | "Counting the mints from the chain. They show here once Cobweb has read every block since the deploy." | New |
| Recent mints, none | "No mints yet. Each one shows here a few blocks after it lands." | Was "No mints yet. They appear here as they land." |
| Recent mints, behind | "Counted to the chain as it was <duration> ago. Newer mints show once Cobweb catches up." (`duration(readAt - countedAt)`) | New |
| Recent mints, not read | "The mint history could not be read. Reload the page to try again." | New |
| Proceeds, Paid by minters | The amount, "Counting" or "Not read" | Changed: shown on real data |

### 7.3 Airdrop

```ts
// apps/web/src/lib/manage/airdrop-types.ts, changed
export type AirdropRow = { /* as today; confirmedAt is block_time once the indexer read it, else confirmed_at */ }
export type AirdropView = { /* as today */ counted: boolean }
export type RecipientRow = { txHash: Hex; wallet: Address; tokens: number; firstTokenId: number; lastTokenId: number
  at: number; burn: boolean }
export type RecipientPage = { rows: RecipientRow[]; total: number; page: number }
export const RECIPIENTS_PAGE = 25
// airdrop-view.ts, changed
export function recipientSearchOf(input: string): string        // lowercase hex digits only, a leading 0x dropped
export function recipientRowsOf(rows: RecipientDbRow[]): RecipientRow[]
export function recipientsCsvRows(rows: RecipientRow[]): string[][]
// airdrop-core.ts, changed
export async function airdropRecipientsCore(ctx: AirdropContext, query: { search: string; page: number }):
  Promise<DeployOutcome<RecipientPage>>
export async function airdropRecipientsAllCore(ctx: AirdropContext): Promise<DeployOutcome<RecipientRow[]>>
// app/actions/airdrop.ts gains getAirdropRecipients(collectionId, query) and exportAirdropRecipients(collectionId)
```

- `airdropViewCore` reads `block_time` with the rows and the cursor's `synced_at`, so `counted` says whether History is
  complete. `AIRDROP_COLUMNS` gains `block_time`.
- `airdropRecipientsCore` parses the query (`search` up to 42 characters, `page` a whole number from 0 to 4,000), reads
  25 rows of `airdrop_recipients` with the owner's client, newest first by block then first token id, with an exact
  count, filtered by `recipient like '%<search>%'` when `recipientSearchOf` leaves anything; `lastTokenId` is the first
  plus the tokens less one, and `burn` marks the dead address. `airdropRecipientsAllCore` reads every row in pages of
  1,000 (`readAll`) for the export.
- History's panel gains a switch, `ToggleGroup` with "By transaction" (today's table and its "Export CSV") and "By
  recipient". By recipient shows the search (`InputGroup` with the search icon, as the Whitelist table's), then a table
  of Wallet, Tokens, Token ids, When and Transaction, with the shared `Pager` (noun "recipients"); the search asks the
  server 300 ms after the last keystroke and goes back to the first page. "Export CSV" there saves
  `airdrop-recipients.csv` from `exportAirdropRecipients`, built in the browser with `toCsv` from
  `recipientsCsvRows`: `date_utc`, `wallet`, `tokens`, `token_ids` (as `tokenRange` writes them) and `tx_hash`.
- When is `confirmedAt` in By transaction and `at` (the block's time) in By recipient, each with its time relative to
  the view's `readAt`. `RecipientDbRow` is the columns `airdropRecipientsCore` selects.

| Where | Sentence | Change |
| --- | --- | --- |
| History, counted | "Every airdrop and burn on the contract, also any sent from outside Cobweb, once the chain has confirmed it." | Was "Batches Cobweb confirmed. Airdrops sent from outside Cobweb are not listed." |
| History, not counted yet | "Batches Cobweb confirmed. Airdrops sent from outside Cobweb show once Cobweb has read the contract's history." | Changed |
| History switch | "By transaction", "By recipient" | New |
| By recipient, search | "Search addresses" (placeholder and label) | New (the Whitelist table's words) |
| By recipient, none | "No wallet has received an airdrop yet." | New |
| By recipient, no match | "No address matches that search." | New (the Whitelist table's words) |
| By recipient, not counted yet | "Recipients show once Cobweb has read the contract's history." | New |
| By recipient, not read | "The recipients could not be read. Try again in a moment." with "Try again" | New |
| By recipient, the dead address | The "Burn" badge, with "0x000000…00dEaD" | New |
| Pager | "<from> to <to> of <total> recipients", "Previous page", "Next page" | Reused (`Pager`) |
| Export CSV, By recipient | "Export CSV", the file `airdrop-recipients.csv` | New |

### 7.4 Settings

`WITHDRAWAL_TIMED_OUT` in `result.ts` becomes 'The withdrawal is not confirmed yet, and it may have landed. Check
again in a minute: Withdrawn so far counts it once the chain has confirmed it.', and the comment above it says a
withdrawal is counted once Cobweb confirms it or the indexer reads it. Nothing else in Settings changes; "Paid by
minters" is the Overview's row.

### 7.5 The mint page (`apps/web/src/lib/mint/fresh-client.ts`, `live-data.ts`, `components/mint/recent-mints.tsx`)

```ts
// live-data.ts, changed
export type MintActivity = { holders: number; recentMints: (MintBody & { phase: string | null })[] }
// MintLive gains activity: MintActivity | null
export function activityOfBody(activity: StateActivity | null, groups: readonly MintGroup[]): MintActivity | null
```

- `stateBodySchema` gains `activity: activitySchema.nullish().catch(null)`, so a body without it, with null or with a
  malformed one is kept with `activity` null.
- `liveOf` sets `activity` through `activityOfBody`: each mint's `phase` is its group's name as the phase list shows it
  ("Group N" for a group registered outside Cobweb), null for a hidden group.
- `Details` gains a Holders row after Supply, `live.activity.holders`, left out while `activity` is null.
- `RecentMints` (new) renders under `PhaseList` in the right column: the title, then each mint's short address, count,
  phase and time, `formatDistance(chainNow - blockTimestamp)` on the chain clock, each row a link to its transaction on
  the chain's explorer (plain text without one); left out while `activity` is null or has no mint.

| Where | Sentence | Change |
| --- | --- | --- |
| Details | "Holders" with the count | New |
| Recent mints | "Recent mints" | New |
| A mint | "<short address> minted <n>", with " in <phase>" when the phase has a name to show | New |
| A mint's time | "<distance> ago", "under a minute ago" | New |
| A mint's link | ", view transaction" (screen readers) | New |

## 8. Sample mode

- The Overview: `sampleActivityView(variant)` in `manage-sim.ts` builds a counted view from `DEMO_ACTIVITY` (171
  holders, its 12 mints, `countedAt` 30 s before `DEMO_NOW`); `?activity=counting` shows it not counted and
  `?activity=behind` counted 20 minutes before `DEMO_NOW`. "Paid by minters" comes from `paidByMintersOf` over the
  sample settings, which gives `DEMO_ACTIVITY.proceeds.grossWei` as today.
- Airdrop: `sampleAirdropView` reads counted, `?activity=counting` not; `DEMO_AIRDROP_RECIPIENTS` (new in `data.ts`)
  holds the first sample airdrop's four wallets with 4, 3, 2 and 1 tokens from #1 and the burn's 2 from #11 at the dead
  address; the sample server answers recipient pages and the export from it after 300 ms.
- The mint page: the sample source's state body carries `activity` from `DEMO_ACTIVITY` (171 holders, its first 10
  mints, their times on the sample clock); `?activity=none` sends null.

## 9. Stage rules

Unchanged. The Overview and Airdrop read the indexer's tables for a deployed collection, or the samples. The state body
carries `activity` for any collection the indexer reads, published or not, since what it counts is public on chain.

## 10. Testing

- Unit tests in `apps/freshness` (new unless marked):
  - `indexer-records.test.ts`, on logs built from the collection ABI: a mint of 3 (three transfers from the zero
    address, then `TokensMinted`) is one mint with its first id; a delegated mint keeps the vault and the hot wallet as
    recipient; a mint on behalf names the receiver; two mints in one transaction pair in order; a mint with fewer
    transfers than its amount, or with one to another address, is not recorded and counts as unpaired; an airdrop of A
    2, B 1 and A 1 gives three runs in order with its counts and fee; the dead address alone with 2 tokens is a burn; an
    airdrop of 0 tokens records nothing; a withdrawal keeps the event's amount and payout address; transfers between
    holders move owners and only the latest per token is kept; a group id above 2^53 - 1 is not recorded while its
    transfers move owners; a log of another address is ignored; `INDEX_EVENTS` are the five events from the ABI.
  - `indexer-plan.test.ts`: `safeBlockOf` for 1, 3 and 5 confirmations and never below 0; groups by scanned block in
    chunks of 100 addresses; ranges of at most 500 blocks ending at the safe block; the front group in full and at most
    10 lagging scans, the closest first; nothing planned at or above the safe block; a range halved down to 1; segments
    cut at block boundaries at 2,000 logs, one larger block kept whole; the three delays.
  - `indexer.test.ts` on a fake chain and a fake database: the summaries load before the first scan; the targets every
    60 s, a new target started at its deploy receipt's block and a missing receipt tried at the next read; a write from
    the lowest written block plus one; an empty pass deferring its write to a minute while its cursors read synced; a
    first sync written at once; a failed write rewinding to the written block and the range read again; a gap refusal
    reading the targets again; a failed scan halving the range while no block is skipped; `activityOf` following each
    write's answer; `stop()` waiting for the pass in flight, with no call after it.
  - `activity.test.ts`: null without a summary, before the first sync and at 301 s behind; present at 300 s; at most 10
    mints, newest first, recipients checksummed.
  - Changed: `state-body.test.ts` (`activity` last; the tag changes with holders, with a new mint and with a flip to
    null, not when only a cursor moves), `health.test.ts` (the indexer's fields, null when off), `config.test.ts` (both
    variables give the options, neither gives null, one alone throws its sentence).
- Unit tests in `apps/web`:
  - `lib/manage/activity-view.test.ts` (new): not counted without a cursor or with one never synced; counted with
    holders and 12 mints newest first; behind at 301 s and not at 300 s, never while the chain read is the copy; "Paid
    by minters" as the sum, counting and not read.
  - Changed: `lib/manage/airdrop-view.test.ts` (When from `block_time`, else `confirmed_at`; recipient rows with burns
    marked; `recipientSearchOf` keeps hex digits only and drops a leading 0x; the CSV rows), `lib/mint/fresh-client.test.ts`
    (`activity` parses; missing, null and malformed read null with the body kept), `lib/mint/live-data.test.ts` (phase
    names as the phase list shows them, none for a hidden group), `components/mint/sample-source.test.ts` and
    `components/manage/manage-sim.test.ts` (the `?activity=` switches).
- `verify:local`, 380 plus 14 (394): "anon: reads nothing from indexer_cursors", "... from mints", "... from
  token_owners" and "... from airdrop_recipients" in the anon loop, and a section 9o on two collections recorded as
  deployed on chain 31337 (as 9k records them), a third recorded on another chain, and a draft:
  1. "indexer functions: a signed-out caller and the owner's session cannot execute indexer_targets, indexer_start,
     indexer_record or indexer_summaries"
  2. "indexer_targets: the service role reads the chain's deployed collections with their contract, deploy
     transaction and cursor, and no draft or collection of another chain"
  3. "indexer_start: the cursor starts at the deploy block, indexed one below it, not synced, with 0 holders; a second
     start keeps the first; a collection without a deployment is refused"
  4. "indexer_record: mints, owners, an airdrop with its recipients and a withdrawal are recorded, the cursor moves to
     the range's end with its synced time, and the answer carries the holders and the mints newest first"
  5. "indexer_record: the same write again changes no row and answers the same; a range that would skip blocks, a
     collection of another chain and a record naming a collection outside the write are refused"
  6. "token_owners: an older transfer of a token is ignored and a newer one wins; holders count distinct owners
     without the dead address"
  7. "airdrops: a row the indexer writes has no sender and its block time; a row airdrop_record wrote keeps its sender
     and gains its block time"
  8. "indexer_cursors, mints and airdrop_recipients: the owner reads its rows; B reads nothing; no client inserts,
     updates or deletes them"
  9. "token_owners: neither the owner nor B reads or writes it"
  10. "indexer_summaries: every cursor of the chain with its holders, synced time and at most 10 mints, newest first"
- `verify:indexer` (new, `scripts/verify-indexer.ts` on `deploy-fixture.ts`; `"verify:indexer": "node
  --conditions=react-server --import ./scripts/resolve-ts.mjs scripts/verify-indexer.ts"`). It needs local Supabase
  and Anvil with the factory. A creator deploys a collection through `deployedCollection` (three tokens, Public at
  0.001 ETH with an allocation of 2 and 1 per wallet, Holders free with 1); a holder and a stranger are fresh keys
  given 10 ETH; the server runs from `startFreshness({ port: 0, chainIds: [31337], indexer: { supabaseUrl,
  serviceRoleKey, passMs: { behind: 200, fast: 500, idle: 500 }, targetsEveryMs: 1_000 } })` with the fixture's local
  settings. The checks:
  1. "setup: Anvil answers as 31337 with the factory approving the shipped code hash, Supabase answers, and the
     freshness server serves 31337 with its indexer on"
  2. "counting: before the server starts the owner's activity view reads not counted; after it starts the cursor is at
     the deploy block within one targets read, and the view reads counted with 0 holders and no mint"
  3. "mint: the holder's mint of 1 from Public is recorded once with its recipient, group 0, amount 1, token 1 and its
     block's time; token 1's owner is the holder and holders read 1"
  4. "state: the state endpoint's activity reads 1 holder and the mint, and an empty block leaves its ETag unchanged"
  5. "airdrop through Cobweb: a batch of 1 to the stranger confirmed by confirmAirdropCore keeps its sender, gains its
     block time and has one recipient row"
  6. "burn outside Cobweb: airdropNFTs to the dead address sent straight from the creator's wallet is recorded as a
     burn with no sender, its fee, token 3 and one recipient row; holders still read 2"
  7. "transfer: the holder's transfer of token 1 to the stranger makes the stranger its owner, holders read 1, and the
     state answers a new ETag"
  8. "withdrawal outside Cobweb: withdrawMintFunds sent straight from the creator's wallet is recorded with the
     event's amount, the settings view's withdrawn sum includes it, and Paid by minters equals Public's price"
  9. "Overview: the owner's activity view reads counted, 1 holder and the mint under Public's name; another creator's
     read is refused as not found"
  10. "Airdrop: the history lists the burn and the airdrop newest first with their block times and reads counted; the
      recipients search finds the stranger by four characters of the address, and the export has a row per recipient"
  11. "replay: with the server stopped and the cursor set back to the deploy block, a server started again reads the
      collection again and every table keeps the same rows and holders; a write starting two blocks past the cursor is
      refused as skipping blocks"
  12. "restart: a server started again answers the activity within 2 s, before any new record, and writes no new row"
  13. "backfill: with the server stopped, the cursor, mints, owners and recipient rows removed and 1,200 empty blocks
      mined, a server started again rebuilds the same rows from the deploy block and reads counted again"
  14. "health: /health reports chain 31337's indexer with one collection, none behind, its block and last pass, no
      failed pass and nothing unpaired, and neither a URL nor a key"
  15. "stop: close() ends the indexer, no write lands for 3 s after it, and the fixtures are removed"

  Fifteen PASS lines. Delegated minting and mint on behalf are covered by the unit tests, since Anvil has no delegate
  registry.
- The browser walk, recorded in the landing note, with the dev wallet against local Supabase, Anvil, the web app and
  `pnpm --filter @cobweb/freshness dev` with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `apps/freshness/.env`:
  (1) a collection deployed through the flow: the Overview reads "Counting", then counted with no mint; (2) a mint on
  the mint page shows in its Recent mints and in the Overview's within a few seconds, Holders 1 on both; (3) a
  transfer sent with `cast send` changes Holders; (4) an airdrop through Cobweb and a burn sent with `cast send` show
  in History with their block times; By recipient finds a wallet by part of its address and pages; both exports; (5)
  a `withdrawMintFunds` sent with `cast send` moves Already withdrawn while Paid by minters holds; (6) the freshness
  server restarted: the page's activity returns within seconds; (7) at 390 px the Recent mints list fits with no
  sideways scroll; (8) every sample switch of section 8.
- `pnpm typecheck && pnpm lint && pnpm test && pnpm format:check`, `pnpm build`, and every verify script at its count:
  `verify:freshness` keeps its 16 checks and `verify:mint-page` its 17, since neither starts the indexer.

## 11. Documentation

- `CLAUDE.md`: the layout line for `apps/freshness` becomes "Railway service that reads chain state for mint pages and
  indexes Cobweb's collections: the state and wallet endpoints and the indexer, run from source on Node 24"; after
  `verify:mint-page`, `pnpm --filter @cobweb/web verify:indexer   # the indexer in the freshness server against local
  Supabase and Anvil: mints, owners, airdrops and withdrawals once each, a replay, a restart and a backfill, the
  Overview, Airdrop and the state body`.
- `apps/freshness/.env.example`: `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` ("The indexer's database: the project's
  API URL and its service role key, a secret that never leaves the server. Set both to run the indexer, or neither.
  Local: the values `supabase status` prints.").
- `docs/MASTER_PLAN.md`, dated notes only: the Phase 6 status line gains "The indexer and the Overview (third
  sub-project of three) landed on <date>; see [specs/2026-10-16-indexer-overview.md](specs/2026-10-16-indexer-overview.md)."
  with what exists, "Known:" with section 12's items and "Phase 6 is complete locally."; under Hosting, a dated
  decision: "**The indexer** (decided 16 October 2026; [specs/2026-10-16-indexer-overview.md](specs/2026-10-16-indexer-overview.md)).
  Runs in the freshness server's process on Railway for every collection Cobweb deployed on a served chain, from its
  deploy block to the chain's confirmation depth, with a cursor per collection: `Transfer`, the two mint events,
  `NFTsAirdropped` and `MintFundsWithdrawn` over at most 500 blocks per scan, written once per log through one
  service-role function. The state body carries holders and the latest mints from its memory, so the request path
  still reads no database."; under Flow, after the holder snapshot decision, "(16 October 2026: the indexer covers
  Cobweb's own collections only; the snapshot still reads any collection's owners from the chain.)".
- Dated notes: in [2026-10-16-freshness-server.md](2026-10-16-freshness-server.md) section 12, that the item owed to
  the third sub-project is closed, with decision 20's change (the process holds a database client for the indexer;
  the request path reads none); in [2026-10-16-mint-page-live-data.md](2026-10-16-mint-page-live-data.md) section 12,
  that holders and recent mints are on the page; in [2026-10-15-airdrop-settings.md](2026-10-15-airdrop-settings.md)
  section 12, that airdrops and withdrawals made outside Cobweb are listed and counted, "Paid by minters" shows and
  History's When is the block's time; in [2026-10-03-creator-flow-ui.md](2026-10-03-creator-flow-ui.md) section 4.6,
  what changed on the Overview and in History (By recipient, its search and export, Import Type not kept).
- This spec: the landing note after section 13.

## 12. Owed and known

- Owed by the owner (hosted): `supabase db push` for the migration; on Railway's `freshness` service, `SUPABASE_URL`
  (the hosted project's API URL) and `SUPABASE_SERVICE_ROLE_KEY` (its service role key), then a redeploy, after which
  `/health` lists each served chain's `indexer`. The migration goes first: without its functions every pass fails and
  `/health` names it. The web app needs the migration for the Overview and Airdrop; the page reads a body with or
  without `activity`, so the web app and the freshness server deploy in either order. Nothing new on Vercel.
- Owed to Phase 7: alerts on `/health`'s indexer (collections behind, failed passes); the second replica, which would
  double every scan (the writes stay idempotent) and so comes with a lease; a login role for the indexer with execute
  on its four functions only, in place of the service role key; the k6 run against the body with `activity`.
- Owed before launch, on a testnet: each provider's `eth_getLogs` limits with 100 addresses and 500 blocks, beside the
  reader's 500-block check; the pace of a backfill on Arbitrum's fast blocks; the indexer's lag at each chain's depth;
  delegated mints recorded with their vaults, which Anvil cannot show.
- Not planned: holder lists or exports, a mints-over-time chart, a rollback for reorgs deeper than the depth, and
  collections deployed outside Cobweb's flow.
- Known: a reorg deeper than the confirmation depth leaves its rows, as it would a payment; the activity trails the
  chain by the depth plus up to one pass (about a minute on Ethereum, seconds on the others, up to 20 s more on an idle
  chain); until the owner sets the two variables on Railway, and on any chain the freshness server does not serve, the
  Overview reads "Counting" and the page shows neither Holders nor Recent mints; a restart rescans up to a minute of
  blocks; a mint or airdrop that does not pair with its transfers, a group id above 2^53 - 1 and an airdrop of 0
  tokens are not recorded, while their transfers still move owners; a transaction with two `NFTsAirdropped` events (a
  contract owner batching) keeps the first in `airdrops`, keyed by its hash, while every recipient row is kept; an
  airdrop the indexer recorded before Cobweb's confirm keeps `sent_by` null; one block with more than 2,000 logs is
  written in one call; "Paid by minters" and Already withdrawn read low by a withdrawal's amount until it is at the
  chain's depth; per-recipient rows of a batch sent through Cobweb show once the indexer reads it; Recent mints name the
  receiver (a delegated mint's hot wallet, a mint on behalf's receiver), never the payer; an export of tens of thousands
  of recipients takes a few seconds; a collection the indexer meets long after its deploy is backfilled at about ten
  scans of 500 blocks a second, the provider allowing.

## 13. Acceptance criteria

- [x] The migration applies and `verify:local` passes (394): the four tables are under row-level security and closed
      to `anon`, `token_owners` is read by no client, and the four indexer functions run for the service role only.
- [x] With `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` set, the freshness server indexes every collection Cobweb
      deployed on each served chain from its deploy block to the chain's confirmation depth, in scans of at most 500
      blocks; without them it runs as before with `activity` null, and one alone refuses the start.
- [x] Mints, token owners, airdrops with their recipients and withdrawals are recorded once per log, also when a range
      is read again, after a restart and in a backfill; a write that would skip blocks is refused.
- [x] The state body carries `activity` (holders and up to 10 mints) only while the indexer has the collection within
      300 s of the state's block time, the request path reads no database, and `verify:freshness` keeps its 16 checks.
- [x] The Overview shows holders, recent mints and "Paid by minters" on real data with the Counting, behind and Not
      read states of 7.2, and Already withdrawn counts withdrawals made outside Cobweb.
- [x] Airdrop's History lists airdrops sent outside Cobweb with their block times, and By recipient finds, pages and
      exports every recipient.
- [x] The mint page shows Holders in Details and Recent mints under the phases from the state body, and neither while
      `activity` is null.
- [x] `verify:indexer` passes its 15 checks; every other verify script, `pnpm typecheck`, `lint`, `test`,
      `format:check` and `build` pass.
- [x] Sample mode renders every state of section 8; the walk is recorded in the landing note.
- [x] Section 11's docs are written, and the landing note lists the owner's hosted steps.

Checked on 17 October 2026 on Anvil, local Supabase and the freshness server with its indexer: the root checks pass (web 902 tests in 94 files, shared 105, freshness 198, dna 60, render 117, worker 282; typecheck, lint and format:check clean); both builds list `● /[slug]` and `ƒ /[slug]/preview`; `verify:local` 395, `verify:chain` 12, `verify:storage` 15, `verify:sweep` 8, `verify:render` 22, `verify:deploy` 15, `verify:phases` 20, `verify:whitelist` 18, `verify:airdrop` 15, `verify:settings` 17, `verify:freshness` 16, `verify:mint-page` 17 and `verify:indexer` 15, each with 0 failed; the list ran on 97f9e8b, and the one commit after it (6a0ca70) changes a style rule on the page's Recent mints only and re-ran typecheck, lint and the page's tests. The browser walk (Playwright with a fresh dev wallet, the web app on live data, the freshness server with its indexer on Anvil) passed its eight items: a collection deployed through the flow with the server stopped read Holders, Recent mints and "Paid by minters" as "Counting", then Holders 0, "No mints yet" and 0 ETH within seconds of the server's start; a mint from the page showed Holders 1 in Details and "0x…7038 minted 1 in Public, under a minute ago" within about 30 s, and the Overview the same row; two transfers by cast moved Holders to 2; an airdrop of 2 through the tab and a burn by cast listed in History newest first with their block times, By recipient with the Burn badge, a four-character search, "No address matches that search." and both CSV exports; a withdrawal by cast moved Already withdrawn to 0.002 ETH while "Paid by minters" held; a server restart answered the page's Holders and Recent mints with its first body; 390 px fits with no sideways scroll; sample mode renders every switch. Departures from the spec's letter, each in the plan's Decisions (2 to 9, 12, 14 and 18) or ruled while executing: a database answer without a Postgres code fails as `HTTP_<status>` and NETWORK is kept for a call with no answer (an empty-body 404 reads `HTTP_204`); a halved range doubles back toward 500 only once a minute has passed since the cursor's last failed scan, instead of restoring 500 at once; `indexerOptionsOf` refuses a `SUPABASE_URL` that is not an http or https project URL before the server listens; every scan re-reads at most half its range (up to 32 blocks) below its cursor, a segment with any record writes at once, and a scan that still fails at one block halves its collections, so a lagging node's short answer and a block a provider cannot answer no longer move a cursor past unread logs or stall a chunk; `withdrawals` is keyed by transaction and collection; `/health`'s `lastError` carries the error's name and code; a `null` inside `p_collections` is refused. Defects found and fixed before the merge: the Task 3 review's NETWORK label (6d3ef5e and f9116d0); the Task 8 review's stop proof and the whole-branch review's lagging node, unreadable block and two-collection transaction (2836049, f00327b, 44b5c32, c1cac12 and d18db04); the walk's "in under a minute" labels on the Overview and History, the search that widened on non-hex input and the rest of the parked minors (a090a71, bb828c9, bdfa260, ff43a11, 2cfe456, 97f9e8b and 6a0ca70). Still owed to the owner (section 12): `supabase db push` for this migration before `NEXT_PUBLIC_DEMO_DATA=0` (the Airdrop tab reads `block_time` and the cursor), then `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` on Railway's `freshness` service and a redeploy; a testnet check of each provider's `eth_getLogs` limits (a cap under about 7 blocks never catches up on Arbitrum), a backfill's pace, a lagging node behind a load balancer and delegated mints.

## 14. Reconciliations with the rulings

No rulings were given for this sub-project beyond the standing instruction, so this section starts with the places
where it departs from an earlier spec's decision, each with its reason; the run adds its own items here, dated.

1. The freshness spec's decision 20 ("No database"): the process now holds a database client for the indexer. The
   request path still reads none, which was that decision's reason (the database on the hot path, a second cache to
   clear): `activity` comes from the indexer's memory.
2. The freshness spec's decision 2 ("viem and `@cobweb/shared` only" at run time): `@supabase/supabase-js` joins them,
   the client the render worker already uses.
3. The freshness spec's section 6.1 ("makes no call until a request arrives"): with the indexer on, the server reads
   its targets and each chain's head at start; without it, nothing changes and `verify:freshness` check 2 holds.
4. The freshness spec's section 12 ("sharing `logs.ts` and the clients"): the indexer shares the clients, the chain
   list and the variables; `logs.ts` stays the reader's, since the indexer's scan has its own events, its depth and
   decoded logs through viem's `getLogs`.
5. The airdrop and settings spec's History ("Airdrops sent from outside Cobweb are not listed") and its `airdrops`
   table: the indexer's rows join Cobweb's, `sent_by` becomes nullable and When takes the block's time.
6. The airdrop and settings spec's decision 14 ("'Paid by minters' waits for Phase 6"): read as the Overview's row,
   where the creator flow spec and the sample show it; Settings keeps its rows.
7. MASTER_PLAN's holder snapshot ("No indexer"): unchanged, since the snapshot reads another collection's owners from
   the chain; the indexer covers Cobweb's own collections and does not feed it.
8. The legacy mapping's `mint_logs` ("unique `(chain_id, tx_hash, log_index)`"): keyed by the transaction and log
   index, as `airdrops` keys on the hash alone; a transaction hash differs across chains.
9. The creator flow audit's legacy History (Wallet Address, Import Type, Quantity): Import Type is not kept, since
   Cobweb stores no list; the rest is By recipient.
10. "An indexer cursor per collection and chain": one row per collection carrying its chain, since a collection lives
    on one chain.
