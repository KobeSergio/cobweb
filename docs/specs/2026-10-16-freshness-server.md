# Freshness server: specification

Phase 6, first sub-project of three (the freshness server; the mint page on live data; the indexer and the Overview),
each with its own spec, plan and run. Product decisions: [../MASTER_PLAN.md](../MASTER_PLAN.md#decisions) (Mint page,
Mint groups, Lock and Hosting) and the Phase 6 bullets "Freshness server: per-chain multicall with tiered polling, one
topic-filtered logs subscription per chain, in-memory state per collection, HTTP with ETag and cache headers,
`degraded` flag." and "Quota endpoint batching wallet reads into 200 ms multicall windows.", decided further by the
rulings of 16 October 2026 on the 26 questions of the Phase 6 codebase map. Rule 3 is the server's reason to exist:
mint pages never call an RPC for shared state. The plan: [../PLAN.md](../PLAN.md) locked decisions 4 and 5, the mint
day traffic and the load and scale table. The contract: `contracts/src/CobwebCollection.sol` (`collectionState()`,
`walletState(address)`, `mintGroupActive`, `delegateMint`, the events) and `CobwebFactory.isCollection`. What Phase 5
left: [2026-10-15-phases.md](2026-10-15-phases.md) sections 6.1 and 12 and
[2026-10-15-airdrop-settings.md](2026-10-15-airdrop-settings.md) sections 6.1, 6.2 and 12 (the readers this
sub-project moves, and the level read). Legacy: [../legacy/market-mint-and-data.md](../legacy/market-mint-and-data.md)
sections 1.3, 7 and 8 (one multicall per tab against a public RPC, the k6 endpoints, the mapping to one Railway
reader).

## 1. Goal

Mint pages never call an RPC for shared state; they poll one Cobweb service that reads the chains for them. This
sub-project builds that service. `apps/freshness` runs on Railway as one Node process started from its TypeScript
source. A collection joins its in-memory hot set on its first request, once the chain's factory confirms it is a Cobweb
collection, and leaves after 10 minutes without one. For each chain with a hot collection, a tick reads the head, scans
the logs since the last tick once for the events that change what a mint page shows, and reads every hot collection's
`collectionState()` at the head in one multicall: every 1 s around a scheduled start, every 2 s while a phase is live
and every 20 s otherwise. `GET /v1/state/{chainId}/{address}` answers the last read with the owner, royalty, base URI,
transfer validator and level, a weak ETag that unchanged ticks keep, edge cache headers and a `degraded` flag;
`GET /v1/wallet/{chainId}/{address}/{wallet}` answers the wallet's quotas and up to 10 delegated vaults, read in 200 ms
windows; `/health` reports each chain's lag. The server reads no database and never computes liveness: `active` is the
contract's. Phase 5's pure chain readers move into `@cobweb/shared` for the server and the web app, and
`verify:freshness` proves on Anvil that the endpoint reports a scheduled phase inactive one second before its start and
active within one tick of the first block at it.

## 2. Decisions taken in the design conversation

1. **Scope.** Decision: the freshness server in `apps/freshness` with its state, wallet and health endpoints,
   `degraded` and its package for Railway; the pure readers it shares with `apps/web` moved into `@cobweb/shared`, with
   the client factory behind a `clients` entry and the delegate registry's ABI; the `COBWEB_TEST_CHAINS` switch with
   Robinhood Chain Testnet; `verify:freshness` on Anvil for the server half of Phase 6's exit criterion; docs. Out: the
   database and the public read path (`mint_pages`, the `mint-page` bucket, `public.mint_page`), the mint page on live
   data, the mint action and the Mint page tab (the second sub-project); the indexer, holders, recent mints, "Paid by
   minters" and the reveal notice (the third); Cloudflare, the k6 run, alerts and a second replica (Phase 7); the
   dashboard, which keeps its own reads (rule 3 binds the mint page only); SSE. Considered: the server and the page as
   one sub-project (the page is built on the server's answers, so those are fixed and proven first).
2. **One Node service, run from its source.** Decision: `apps/freshness` is one `node:http` server started by
   `node src/index.ts`. Node 24 strips the TypeScript, as the web scripts already rely on, so there is no build step.
   It listens on `PORT` (3100 when unset), runs as one replica, and depends at run time on `viem` and `@cobweb/shared`
   only. Considered: a build with tsc or esbuild (an artifact to keep in step with the source); a framework such as
   Hono or Fastify (a dependency for three routes).
3. **Railway's settings live on the service.** Decision: the ruled settings (no build step, the start command, the
   watch paths `apps/freshness/**` and `packages/shared/**`, the `/health` check, one replica, Node 24) are set on the
   Railway service by the owner (section 12), not in a `railway.json`. Railway's documentation, read on 16 October
   2026, says "Config as Code is deprecated. Prefer Infrastructure as Code. Existing files keep working for legacy
   services until 2026-12-01", and the documented options of its replacement, `.railway/railway.ts`, carry no watch
   paths. Considered: `railway.json` as ruled (deprecated, and read only until 1 December 2026); `.railway/railway.ts`
   (no watch paths among its documented options, plus a new package and a CLI apply step for one service).
4. **Chains and transport.** Decision: the server reads each chain of `availableChains()` whose `RPC_URL_<id>` and
   `FACTORY_ADDRESS_<id>` are both set, the names `apps/web` uses, over HTTP only: no WebSocket and no `newHeads`. A
   chain with no hot collection makes no call. Considered: `eth_subscribe('logs')` over a WebSocket (a second secret
   URL per chain and reconnect logic, for logs a tick reads anyway).
5. **The test-chain switch.** Decision: `COBWEB_TEST_CHAINS=1` shows Sepolia, Robinhood Chain Testnet (46630, new in
   `TEST_CHAINS`, with Robinhood Chain's 3 confirmations) and Anvil wherever `NODE_ENV=production` hides them: in the
   shared chain list (so in `apps/web`'s server code and in the freshness server), in the web app's browser bundle
   through `next.config.ts`'s `env`, and in the wallet's chain list (`lib/wagmi.ts`). Considered: the switch in server
   code only (on a preview, the browser's chain names and the wallet's chains would disagree with the server's);
   `NEXT_PUBLIC_COBWEB_TEST_CHAINS` beside it (two names for one switch).
6. **The hot set.** Decision: a collection joins on its first state request and leaves after 10 minutes without one.
   It is accepted once `isCollection(address)` answers true on its chain's configured factory; true is remembered for
   the life of the process (the factory only ever sets it), false for 60 s (at most 10,000 addresses), and an address
   that is not a collection answers 404. A request for a collection that is joining waits up to 2 s for its first
   read. Considered: reading every deployed collection (the list lives in the database, which the third sub-project
   brings); trusting the path (any contract could pose as a collection); answering 503 at once on a join (the first
   visitor of every collection, and every page's server render after a restart, would see it).
7. **One tick per chain.** Decision: a tick reads the head (`getBlockNumber` with `cacheTime: 0`), scans the logs since
   the last scanned block (decision 8), then reads `collectionState()` of every hot collection not yet read at that
   head in one `readEach`, the extras in the same `readEach` where they are due (decision 10), and the levels after it.
   A collection already read at the head counts as read again, since its state cannot have changed. Ticks on a chain
   never overlap. Considered: a read per request (RPC use would follow viewers); reading only the collections a log
   marked (a mint changes the state without a log in the filter, and the ruling reads every hot collection).
8. **The log scan.** Decision: one `eth_getLogs` per chain per tick, from the block after the last one scanned to the
   head, over the hot collections and those of their validators that have code, for 15 topics: nine state events (the
   group events for status, close all, start, registration, price and allocation, then the public limit, mint on
   behalf and `FeesUpdated`), five extras events (`BatchMetadataUpdate`, `OwnershipTransferred`,
   `DefaultRoyaltyUpdated`, `TokenRoyaltyUpdated`, `TransferValidatorUpdated`) and the validator's
   `SetTransferSecurityLevel`, kept only when its topic1 is a hot collection using that validator. A matching log marks
   its collection for a full read (state and extras) in the same tick, at the block the scan ends on. A range over 500
   blocks, or a failed scan, marks every hot collection instead. Considered: a second call with topic1 set to the
   collections (two calls a tick for events a validator emits a few times a day); `Transfer` and the mint events (the
   heaviest traffic on mint day, for counts every tick reads anyway).
9. **The tiers.** Decision: a chain ticks at the fastest tier any hot collection needs: 1 s from 15 s before to 30 s
   after any scheduled start, measured on the last read's `blockTimestamp`; 2 s while any group is active and not sold
   out, or while a collection has no read yet; 20 s otherwise. An idle chain also wakes when the nearest start's window
   should open, estimated from the last read's block time. The server never computes liveness: `active` is the view's,
   and the tiers only decide when to read it. Considered: a tier per collection (one multicall reads every hot
   collection of the chain at its tier anyway); no early wake (a 20 s idle tick can step over the window's first 5 s
   and reach the fast tier only after the start).
10. **The extras.** Decision: `owner()`, `royaltyInfo(1, 10000)` (its amount is the basis points, as Settings reads
    it), `baseURI()` and `getTransferValidator()` join the tick's `readEach` for a collection that is new, marked by a
    log, or whose extras were read 60 s ago; then the level as Settings reads it, through `levelOf`: none for the zero
    address or a validator without code, the policy's `transferSecurityLevel` from
    `getCollectionSecurityPolicy(collection)`, unread when the validator reverts or does not answer. Considered: every
    tick (four more calls per collection a second at the fast tier, for values that change only with a log).
11. **The state endpoint.** Decision: `GET /v1/state/{chainId}/{address}` answers `block`, `blockTimestamp`, `readAt`
    (the server's time of the last successful read), `degraded`, every `collectionState()` field (the groups as
    `chainStateOf` maps them, the fees as wei strings), `owner`, `royalty { receiver, bps }`, `baseUri`,
    `transferValidator` and `transferLevel` (`none`, `unread` or the level). `block` never goes back. Considered: the
    legacy shape with `phases[].start/end` and `serverTime` (there is no end time, and `readAt` is the server's time).
12. **The ETag and the cache headers.** Decision: a weak ETag over the body without `readAt`, `block` and
    `blockTimestamp`, so a tick that changes nothing else answers 304 to `If-None-Match`; `degraded` is inside it.
    Answers carry `Cache-Control: public, max-age=0, s-maxage=1, stale-while-revalidate=1, stale-if-error=60` and
    `Access-Control-Allow-Origin: *`. Considered: a strong ETag (Cloudflare weakens one when it compresses); a tag over
    the whole body (it would change every tick and never answer 304).
13. **Refusals.** Decision: 400 for a malformed chain id or address, 404 for a chain not served, an address that is
    not a collection or an unknown path, 405 for other methods, and 503 with `Retry-After: 1` and `no-store` while a
    first read has not succeeded, the factory cannot be read, or a wallet read failed or waits behind a full queue.
    Each refusal is `{ "error": "<code>" }`. Considered: a 200 with an empty state before the first read (a page could
    take it for the chain's answer).
14. **`degraded`.** Decision: a collection reads degraded when its last successful read is older than the larger of
    three ticks of its chain's tier and 10 s (10 s at the 1 s and 2 s tiers, 60 s at the idle tier). The flag changes
    the ETag, and minting stays possible while it is set, since every mint is simulated first. Considered: the smaller
    of the two (an idle collection would read degraded 10 s after each of its 20 s reads).
15. **The wallet endpoint.** Decision: `GET /v1/wallet/{chainId}/{address}/{wallet}` answers `walletState(wallet)` and
    up to 10 delegated vaults, each with its own `walletState`. Asks are gathered per chain into 200 ms windows: one
    head per window, the wallets' `walletState` and the registry's listings in one `readEach`, then the vaults'
    `walletState` at the same block; a pair asked twice in a window is read once. Answers carry
    `Cache-Control: public, max-age=0, s-maxage=5` and no ETag. Considered: a wallet cache on the server (the edge
    holds each answer 5 s, and a server cache would need every mint and every quota write to clear it).
16. **Delegated vaults.** Decision: the delegate.xyz v2 registry at `0x00000000000000447e69651d841bD8D104Bed493`
    answers `getIncomingDelegations(wallet)`; a vault is the `from` of a delegation of type ALL, or CONTRACT for this
    collection, with empty rights, since the collection asks `checkDelegateForContract(caller, vault, this, "")`; the
    distinct vaults in the registry's order, never the wallet itself, at most 10. Where the registry has no code the
    answer has no vaults. The ABI is written by hand from the registry's published source and pinned in
    `@cobweb/shared`. Considered: `checkDelegateForContract` per candidate (the candidates come from the listing
    anyway); token-scoped delegations (the collection's check ignores them).
17. **`/health`.** Decision: `GET /health` always answers 200 with `no-store`: per served chain its hot collections,
    tier, last block, lag, last good tick, failed ticks, the last failure's error name and the log gaps; the hot set's
    size; the wallet windows. It never carries an RPC URL or an error message. Considered: answering 503 when a chain
    lags (Railway's deploy check would refuse every deployment while one RPC provider is down).
18. **The shared readers.** Decision: the readers `apps/web` imports across its modules today move into
    `@cobweb/shared`'s browser-safe entry with their types and tests: `readEach` (with `revertedRead` and its group
    sizes), `chainStateOf`, `levelOf`, `TRANSFER_LEVELS` and `pointerOf`; `apps/web` imports them from there, unchanged.
    Two of the names the map listed stay where they are: `mintedIds` (private to `airdrop-batch.ts`) and `joinPhases`
    (it returns the demo `MintGroup`), both for the mint page, which lives in `apps/web`. Considered: all seven (the
    demo type would move into the shared package with them); a new package for the readers (one more workspace for
    five functions).
19. **The client factory.** Decision: `@cobweb/shared/clients` exports `src/clients.ts` (`publicClientFor`), which has
    never carried the `server-only` marker; the `server` entry keeps the marker and re-exports it; the freshness server
    imports the new entry, and a lint rule keeps `apps/web` on `@cobweb/shared/server`. The server uses viem's HTTP
    transport defaults (a 10 s timeout, three retries). Considered: running the server with `--conditions=react-server`
    (the rulings' adjustment: a condition only Next's server build needs); a factory with shorter timeouts for the
    server (a second factory to keep in step, while `degraded` already bounds what a viewer sees).
20. **No database.** Decision: the server reads chains only; group names, order and visibility and the reveal targets
    reach the page through the second sub-project's public read path, joined by group id. Considered: the server
    joining `mint_groups` for names (the database on the hot path, and a second cache to clear on every save).
21. **`verify:freshness`.** Decision: `pnpm --filter @cobweb/web verify:freshness`, in `apps/web` as every verify script
    is. It starts the server in process from `@cobweb/freshness/server` against Anvil through an RPC switch the script
    can fail, deploys its collections straight through the factory with the fixture's `deploy` (as `verify:airdrop`
    check 14 does, recording nothing), and runs 16 checks. The fixture's chain half moves to
    `scripts/chain-fixture.ts`, which `deploy-fixture.ts` re-exports, so this script needs Anvil alone. Considered:
    `pnpm --filter @cobweb/freshness verify` (its own `check`, totals and Anvil client, which the fixture exists to keep
    in one place); importing `deploy-fixture.ts` whole (`supabase start` for a script that reads and writes no row).
22. **Docs.** Decision: section 11. Considered: a README in `apps/freshness` (CLAUDE.md and this spec hold its commands
    and settings).
23. **Tests.** Decision: section 10. Considered: HTTP tests of the server in vitest (the verify runs it end to end on a
    chain; the unit tests cover its rules).

## 3. Scope

In: `apps/freshness` (the collection check, the hot set, the tick, the log scan, the extras and the level, the tiers
and `degraded`, the state, wallet and health endpoints, the wallet windows and the vault filter, the package and its
start); in `@cobweb/shared`, the five readers with their types and tests, the `clients` entry, the registry's ABI, the
test-chain switch and Robinhood Chain Testnet; in `apps/web`, the imports of the moved readers, the switch in the
browser bundle and the wallet's chain list, the lint rule, the fixture's chain half and `verify:freshness`; the unit
tests; docs; the owner's hosted steps, listed in section 12. Out: as decision 1, plus any change to the contracts, the
dashboard's reads and the sample mint page.

## 4. Database

None. The server opens no database connection, and this sub-project adds no migration, type or policy. The page's
database side (`mint_pages`, the `mint-page` bucket, `public.mint_page(p_slug)`) is the second sub-project's, and the
indexer's tables are the third's.

## 5. The shared package

### 5.1 The moved readers

```ts
// packages/shared/src/read-each.ts, moved from apps/web/src/lib/chain/read-each.ts with its test
export const MULTICALL_GROUP = 500, PARALLEL_GROUP = 50
export function revertedRead(error: unknown): boolean
export async function readEach<T>(client: PublicClient, calls: readonly ContractFunctionParameters[],
  options?: { blockNumber?: bigint }): Promise<(T | null)[]>
// packages/shared/src/collection-state.ts, moved from phases-types.ts (the types) and phases-core.ts (the rest)
export type ChainGroup = { id: number; priceWei: string; maxSupply: number; minted: number; startTimestamp: number;
  flag: boolean; active: boolean }
export type ChainState = { block: bigint; blockTimestamp: number; maxSupply: number; totalMinted: number;
  publicMaxMintPerWallet: number; mintOnBehalfActive: boolean; groups: ChainGroup[] }
export type CollectionStateResult = ContractFunctionReturnType<typeof collectionAbi, 'view', 'collectionState'>
export function chainStateOf(state: CollectionStateResult, block: bigint): ChainState
// packages/shared/src/transfer-level.ts, moved from settings-view.ts and settings-types.ts
export const TRANSFER_LEVELS = { enforced: 0, open: 1, locked: 9 } as const
export type TransferLevelValue = (typeof TRANSFER_LEVELS)[keyof typeof TRANSFER_LEVELS]
export type TransferLevelState = { kind: 'none'; reason: 'zero' | 'no-code' } | { kind: 'unread' } | { kind: 'level'; level: number }
export function levelOf(validator: Address, hasCode: boolean, policyLevel: number | null): TransferLevelState
// packages/shared/src/reveal-pointer.ts, moved from settings-view.ts and settings-types.ts
export type RevealPointer = 'revealed' | 'placeholder' | 'custom'
export type RevealTargets = { real: string | null; placeholder: string | null; start: string }
export function pointerOf(baseUri: string, targets: RevealTargets): RevealPointer
```

Each moves as it is, its relative imports rewritten to the package's `.ts` form. `collection-state.ts` takes the ABI's
type through `import type { collectionAbi }`, so the browser entry gains no ABI at run time. `index.ts` exports the four
modules and the registry's (5.3). The `levelOf` and `pointerOf` cases of `settings-view.test.ts` move into
`transfer-level.test.ts` and `reveal-pointer.test.ts`; `read-each.test.ts` moves unchanged. Section 7.1 lists every
file of `apps/web` that changes.

### 5.2 The `clients` entry

```jsonc
// packages/shared/package.json, "exports" gains one entry; src/clients.ts is unchanged
"./clients": "./src/clients.ts"   // publicClientFor(chainId): one viem public client per chain over RPC_URL_<id>
```

`clients.ts` already carries no marker; the marker stays on `server.ts`, which goes on importing `server-only` and
re-exporting `clients.ts` and `rpc.ts`, so `apps/web` keeps its guard. The freshness server imports
`@cobweb/shared/clients` and gets one cached client per chain with viem's HTTP transport defaults.

### 5.3 The delegate registry

```ts
// packages/shared/src/delegate-registry-abi.ts, written by hand, exported from the browser entry
export const DELEGATE_REGISTRY: Address = '0x00000000000000447e69651d841bD8D104Bed493'
export const DELEGATION_TYPE = { none: 0, all: 1, contract: 2, erc721: 3, erc20: 4, erc1155: 5 } as const
export const delegateRegistryAbi: readonly [/* the one entry below */]
```

```solidity
function getIncomingDelegations(address to) external view returns ((uint8 type_, address to, address from, bytes32 rights, address contract_, uint256 tokenId, uint256 amount)[] delegations)
```

Written from the registry's published source (github.com/delegatexyz/delegate-registry, `src/IDelegateRegistry.sol`,
`@custom:version 2.0`, the `DelegationType` enum `NONE, ALL, CONTRACT, ERC721, ERC20, ERC1155` encoded as `uint8`),
confirmed on 16 October 2026 together with the two rules of its implementation this server relies on:
`getIncomingDelegations` leaves out revoked delegations, and `checkDelegateForContract(to, from, contract_, "")`
accepts only an ALL or a CONTRACT delegation with empty rights. The address is the one the collection holds
(`CobwebCollection.sol` line 119) and the one the registry's README lists for its EVM chains (its zkSync deployments,
on no launch chain, use another). The file's header says where it comes from, as `validator-abi.ts`'s does.

### 5.4 The test chains

```ts
// packages/shared/src/chains.ts, changed
export const TEST_CHAINS: readonly ChainConfig[]   // Sepolia (2), Robinhood Chain Testnet (46630, 3), Anvil (1)
export const hidesTestChains = () =>
  process.env.NODE_ENV === 'production' && process.env.COBWEB_TEST_CHAINS !== '1'
export function availableChains(hideTestChains = hidesTestChains()): readonly ChainConfig[]
// chainById, confirmationsFor and factoryAddress, and rpcUrl in rpc.ts, take the same default
```

`isProduction()` becomes `hidesTestChains()`; nothing else reads it. Both variables are read as literal
`process.env.NAME` expressions, which Next replaces in the browser bundle (7.2). Robinhood Chain Testnet is viem's
`robinhoodTestnet` (Blockscout explorer, `multicall3`), named "Robinhood Chain Testnet", with the 3 confirmations of
the chain it rehearses.

## 6. The freshness server

### 6.1 The package and its start

```jsonc
// apps/freshness/package.json
"engines": { "node": ">=24" },
"exports": { "./server": "./src/server.ts" },
"scripts": { "start": "node src/index.ts", "dev": "node --watch --env-file-if-exists=.env src/index.ts",
  "typecheck": "tsc --noEmit", "lint": "eslint .", "test": "vitest run" },
"dependencies": { "@cobweb/shared": "workspace:^", "viem": "^2.57.2" }
// apps/freshness/tsconfig.json adds "types": ["node"], "allowImportingTsExtensions": true and "erasableSyntaxOnly": true
```

```ts
// apps/freshness/src/server.ts
export type FreshnessOptions = { port: number; host?: string; chainIds?: number[] }
export type Freshness = { url: string; close(): Promise<void> }
export async function startFreshness(options: FreshnessOptions): Promise<Freshness>
// apps/freshness/src/index.ts: startFreshness({ port: Number(process.env.PORT ?? DEFAULT_PORT) }), closed on SIGTERM
```

The source is erasable TypeScript only (no enums, namespaces or parameter properties, which `erasableSyntaxOnly`
refuses at typecheck), with `.ts` extensions on relative imports and `import type` for types, so Node runs it as it is.
`startFreshness` makes no call until a request arrives; `chainIds` limits the chains served (the verify serves Anvil
alone). On SIGTERM the process stops its ticks and windows, closes the server and exits. Modules: `config.ts`,
`routes.ts`, `collection-check.ts`, `hot-set.ts`, `chain-reader.ts`, `logs.ts`, `tiers.ts`, `state-body.ts`,
`wallet.ts`, `delegations.ts` and `health.ts`. A failure is logged as the error's name and viem's short message, never
the RPC URL, which carries the provider's key; requests are not logged.

### 6.2 Configuration

```ts
// apps/freshness/src/config.ts
export const DEFAULT_PORT = 3100
export function servedChains(chainIds?: number[]): ChainConfig[]   // availableChains() with both variables set
```

The variables are `PORT` (Railway sets it), `NODE_ENV`, `COBWEB_TEST_CHAINS`, and per chain `RPC_URL_<id>` and
`FACTORY_ADDRESS_<id>`. The served chains are read once at start, and the start's log line names them, never their
URLs. `apps/freshness/.env.example` lists the names; `dev` reads `apps/freshness/.env`, which git ignores, when it
exists.

### 6.3 The collection check and the hot set

```ts
// apps/freshness/src/collection-check.ts
export const NEGATIVE_TTL_MS = 60_000, NEGATIVE_MAX = 10_000
export function collectionCheck(read: (chainId: number, address: Address) => Promise<boolean>,
  now?: () => number): (chainId: number, address: Address) => Promise<boolean>
// apps/freshness/src/hot-set.ts, pure (the time is passed in)
export const HOT_TTL_MS = 600_000, JOIN_WAIT_MS = 2_000
export type HotEntry = { chainId: number; address: Address; requestedAt: number; read: CollectionRead | null;
  readAt: number | null; extrasReadAt: number | null; marked: boolean }
export function hotSet(): { join(chainId: number, address: Address, now: number): { entry: HotEntry; joined: boolean };
  onChain(chainId: number): HotEntry[]; expire(now: number): HotEntry[]; size(chainId?: number): number }
export type HotSet = ReturnType<typeof hotSet>
```

`read` is `isCollection(address)` on `factoryAddress(chainId)` through `factoryAbi` at the latest block. A true answer
is kept for the process, a false one for 60 s, at most 10,000 falses with the oldest forgotten first; asks for one
address in flight share one read, and a failed read is not kept (503 `chain-unreadable`). Keys are the chain and the
lowercase address. A state request that passes the check refreshes `requestedAt`. A new entry is marked for a full read
and wakes its chain's reader for a tick at once. Requests for an entry without a read wait for it until `JOIN_WAIT_MS`
after the join; after that, such an entry answers 503 `not-read-yet` at once until a read lands. Each tick first
expires its chain's entries; a chain whose last entry leaves stops ticking and forgets its scanned block.

### 6.4 The tick

```ts
// apps/freshness/src/chain-reader.ts
export type FeeWei = { mintFeeFlatWei: string; mintFeeBps: number; airdropFeePerTokenWei: string }
export type Extras = { owner: Address; royalty: { receiver: Address; bps: number }; baseUri: string;
  transferValidator: Address; transferLevel: TransferLevelState }
export type CollectionRead = { state: ChainState; fees: FeeWei; extras: Extras }
export function chainReader(chain: ChainConfig, hot: HotSet, client: PublicClient):
  { wake(): void; stop(): void; health(): ChainHealth }
```

Each tick, on one chain:

1. Expire the chain's entries; with none left, stop.
2. Read the head with `getBlockNumber({ cacheTime: 0 })` (viem would otherwise reuse a recent head for its polling
   interval). A failure fails the tick.
3. An entry read at the head or later (a load-balanced RPC can answer an older head) counts as read now: its `readAt`
   moves and nothing else does.
4. When the head passed the last scanned block, scan the logs (6.5), marking entries.
5. For the other entries, one `readEach` at the head: `collectionState()` for each, and the four extras for each entry
   that is new, marked, or whose extras were read 60 s ago. A request failing as a whole fails the tick; a call
   answering null leaves its entry as it was, its mark included.
6. For the entries whose extras were read: the zero validator reads `none`; a validator not yet known to have code is
   asked `getCode` at the head, and code found is remembered for the chain; then one `readEach` at the head of
   `getCollectionSecurityPolicy(collection)` on each validator with code, through `validatorAbi`. `levelOf` maps each
   answer, a null reads `unread`, and a failed request reads `unread` for all of them without failing the tick.
7. Each entry read gets its new `CollectionRead` (the state through `chainStateOf`, the fees as wei strings, the extras
   kept from before when they were not read), its `block` and `readAt`, and loses its mark once its extras were read.
8. Set the chain's tier and the delay to the next tick (6.6): the next tick starts one interval after this one started,
   or at once when this one ran longer.

### 6.5 The log scan

```ts
// apps/freshness/src/logs.ts
export const MAX_LOG_RANGE = 500n
export const STATE_EVENTS = ['MintGroupStatusChanged', 'AllMintGroupsStatusChanged', 'MintGroupStartTimestampChanged',
  'MintGroupRegistered', 'SalePriceChanged', 'MintGroupMaxSupplyUpdated', 'PublicMaxMintPerWalletChanged',
  'MintOnBehalfUpdated', 'FeesUpdated'] as const
export const EXTRAS_EVENTS = ['BatchMetadataUpdate', 'OwnershipTransferred', 'DefaultRoyaltyUpdated',
  'TokenRoyaltyUpdated', 'TransferValidatorUpdated'] as const
export function watchedTopics(): Hex[]   // the 14 events from collectionAbi and SetTransferSecurityLevel from validatorAbi
export function marksOf(logs: readonly Pick<Log, 'address' | 'topics'>[],
  hot: readonly { address: Address; validator: Address | null }[]): Set<string>   // lowercase addresses to read in full
```

The scan is one `eth_getLogs` from the block after the last scanned to the head, its `address` the hot collections and
the distinct validators of their last extras that have code, its `topics` `[watchedTopics()]`. Topics come from the
ABIs, never written by hand. A log from a hot collection with a watched topic marks that collection; a log from a
validator marks the collection named in its topic1 only when the topic is `SetTransferSecurityLevel` and that
collection's validator is that address; anything else is ignored. A chain's first tick scans nothing and starts from its
head. A scan whose range would pass 500 blocks (after an outage) is not sent and every hot entry is marked instead, as
when the call fails; either way the scanned block moves to the head and `/health` counts a gap. Not in the filter:
`MintQuotasAdded` (it changes only `walletState`, which every wallet ask reads at the head), the mint events and
`Transfer` (the counts are in `collectionState()`, read every tick), `OwnerPayoutAddressUpdated` and the withdrawal and
airdrop events (nothing the state answer carries).

### 6.6 The tiers and `degraded`

```ts
// apps/freshness/src/tiers.ts, pure
export const TIER_MS = { fast: 1_000, live: 2_000, idle: 20_000 } as const
export type Tier = keyof typeof TIER_MS
export const FAST_BEFORE_S = 15, FAST_AFTER_S = 30, DEGRADED_FLOOR_MS = 10_000
export function tierOf(state: Pick<ChainState, 'blockTimestamp' | 'maxSupply' | 'totalMinted' | 'groups'> | null): Tier
export function chainTier(states: readonly (ChainState | null)[]): Tier
export function nextDelayMs(tier: Tier, reads: readonly { state: ChainState; readAt: number }[], startedAt: number,
  now: number): number
export function degradedAfterMs(tier: Tier): number                          // max(3 * TIER_MS[tier], DEGRADED_FLOOR_MS)
export function isDegraded(readAt: number, now: number, tier: Tier): boolean  // now - readAt > degradedAfterMs(tier)
```

`tierOf` answers `fast` when any group's `startTimestamp` is not 0 and the read's `blockTimestamp` lies from 15 s
before it to 30 s after it, both ends included; else `live` when any group is `active` and not sold out (its `minted`
below its `maxSupply`, and `totalMinted` below the collection's `maxSupply`); else `idle`. A collection with no read yet
is `live`. `chainTier` is the fastest of a chain's entries. `nextDelayMs` is the tier's interval counted from the tick's
start, shortened on an idle chain to the moment the nearest start's window opens, estimated as that read's `readAt`
plus the seconds from its `blockTimestamp` to `start - 15`. A request computes `degraded` with its chain's tier at that
moment: after 10 s at the fast and live tiers, after 60 s at idle.

### 6.7 The state endpoint and the refusals

```ts
// apps/freshness/src/state-body.ts, pure
export type StateBody = {
  chainId: number; address: Address                             // checksummed
  block: number; blockTimestamp: number; readAt: number         // readAt: Unix seconds of the last successful read
  degraded: boolean
  maxSupply: number; totalMinted: number; publicMaxMintPerWallet: number
  mintFeeFlatWei: string; mintFeeBps: number; airdropFeePerTokenWei: string; mintOnBehalfActive: boolean
  groups: ChainGroup[]                                         // id, priceWei, maxSupply, minted, startTimestamp, flag, active
  owner: Address; royalty: { receiver: Address; bps: number }; baseUri: string
  transferValidator: Address; transferLevel: 'none' | 'unread' | number
}
export function stateBody(chainId: number, entry: HotEntry, degraded: boolean): StateBody   // an entry with a read
export function etagOf(body: StateBody): string                                           // W/"<32 hex digits>"
export function etagMatches(ifNoneMatch: string | undefined, etag: string): boolean
```

Keys keep this order and the groups the contract's order; counts are numbers and wei are decimal strings, as
`chainStateOf` maps them. `etagOf` hashes with SHA-256 the JSON of the body without `readAt`, `block` and
`blockTimestamp` and keeps 32 hex digits. `etagMatches` compares weakly with each tag the header lists, and `*` matches.
The answers of both endpoints:

| Answer | When |
| --- | --- |
| 200 with the body | the state endpoint: the collection has a read and `If-None-Match` does not match its tag; the wallet endpoint: its window read the wallet |
| 304, no body | the state endpoint only: `If-None-Match` matches the collection's tag |
| 400 `bad-request` | a chain id that is not a positive whole number without leading zeros, or an address or wallet that is not `0x` and 40 hex digits, or is in mixed case with a wrong checksum |
| 404 `not-found` | any other path, `/` included |
| 404 `chain-not-served` | a chain the server does not serve |
| 404 `not-a-collection` | `isCollection` answers false |
| 405 `method-not-allowed` | a method other than GET, HEAD and OPTIONS, with `Allow: GET, HEAD, OPTIONS` |
| 503 `chain-unreadable` | the factory could not be read |
| 503 `not-read-yet` | the collection's first read has not succeeded by the end of the join wait |
| 503 `wallet-unreadable` | the wallet's window failed to read it |
| 503 `busy` | 5,000 wallet asks already wait on the chain |

A 200 or 304 of the state carries `ETag`, `Cache-Control: public, max-age=0, s-maxage=1, stale-while-revalidate=1,
stale-if-error=60` and `Access-Control-Allow-Origin: *`, the 200 also `Content-Type: application/json;
charset=utf-8`. Every refusal carries `Access-Control-Allow-Origin: *`; a 4xx answer also
`Cache-Control: public, max-age=0, s-maxage=10`, and a 503 `Retry-After: 1` and `Cache-Control: no-store`. HEAD answers
as GET without a body. OPTIONS on a `/v1` path answers 204 with `Access-Control-Allow-Origin: *`,
`Access-Control-Allow-Methods: GET, HEAD`, `Access-Control-Allow-Headers: If-None-Match` and
`Access-Control-Max-Age: 86400`.

### 6.8 The wallet endpoint and the vaults

```ts
// apps/freshness/src/wallet.ts
export const WINDOW_MS = 200, WINDOW_MAX = 200, QUEUE_MAX = 5_000
export type QuotaBody = { id: number; quota: number; claimed: number }
export type WalletBody = { chainId: number; address: Address; wallet: Address; block: number; publicMinted: number;
  groups: QuotaBody[]; vaults: { vault: Address; publicMinted: number; groups: QuotaBody[] }[] }
export function walletWindows(chain: ChainConfig, client: PublicClient): {
  ask(address: Address, wallet: Address): Promise<WalletBody | 'busy' | 'unreadable'>
  stats(): { windows: number; answered: number; waiting: number }; stop(): void }
// apps/freshness/src/delegations.ts, pure
export const MAX_VAULTS = 10
export type Delegation = { type_: number; to: Address; from: Address; rights: Hex; contract_: Address; tokenId: bigint;
  amount: bigint }
export function vaultsOf(delegations: readonly Delegation[], collection: Address, wallet: Address): Address[]
```

The path is checked as the state's is, the collection check included; a wallet ask does not make a collection hot. The
first ask on a chain opens a window that closes 200 ms later and then takes up to 200 distinct (collection, wallet)
pairs, the rest waiting for the next window, which opens at once. A window reads the head, then one `readEach` at it:
`walletState(wallet)` on each pair's collection and, where the registry has code on the chain,
`getIncomingDelegations(wallet)` once per distinct wallet. `vaultsOf` picks each pair's vaults, and a second `readEach`
at the same head reads `walletState(vault)` on the collection for each. `vaultsOf` keeps a delegation whose `type_` is
ALL, or CONTRACT with `contract_` the collection compared without case, and whose `rights` are zero; drops a `from`
that is the wallet or the zero address; keeps each vault once, in the registry's order, and the first 10. A
`walletState` answer gives `publicMinted` and, per registered group in the contract's order, `quota` (issued) and
`claimed`, both 0 for the public group. The registry is asked `getCode` once per chain: code found is kept, and none is
asked again after an hour. A failed head or `readEach` fails its window's asks (503 `wallet-unreadable`), a null
`walletState` fails its pair, and a null listing reads as no vaults. An ask beyond the 5,000 waiting answers 503
`busy`. Answers carry `Cache-Control: public, max-age=0, s-maxage=5` and `Access-Control-Allow-Origin: *`.

### 6.9 `/health`

```ts
// apps/freshness/src/health.ts, pure
export type ChainHealth = { chainId: number; name: string; hot: number; tier: Tier | null; block: number | null;
  lagSeconds: number | null; lastGoodTickAt: string | null; failedTicks: number; lastError: string | null;
  logGaps: number }
export type HealthBody = { status: 'ok'; startedAt: string; hot: number; chains: ChainHealth[];
  wallet: { windows: number; answered: number; waiting: number } }
```

One `ChainHealth` per served chain. `lagSeconds` is the time since the block time of the head the chain's last good
tick read, null before one; `lastGoodTickAt` is that tick's time (ISO); `lastError` is the last failure's error name
(`HttpRequestError`, for example), never its message; `tier` is null while the chain has no hot entry. `/health`
answers 200 with `Cache-Control: no-store` whatever it reports, and HEAD likewise.

### 6.10 What the mint page relies on

The second sub-project builds on these answers:

- Liveness is `groups[].active` and nothing else; `startTimestamp` and `blockTimestamp` only label countdowns.
- A 304 says the page's copy is current; its `block`, `blockTimestamp` and `readAt` are those of the last change, and
  the page anchors its chain clock on each 200.
- `degraded` is the server's view and `readAt` gives the banner's minutes while it is set; a page that cannot reach the
  server for 10 s raises its own.
- URLs carry addresses in lower case, one edge entry per collection and wallet. The page lets the browser's cache send
  `If-None-Match`; a fetch that sets the header itself makes a CORS preflight, which the server answers.
- A 503 means trying again after `Retry-After`; a 404 `not-a-collection` is final.
- A group's name, description, visibility and order come from the database by `id`; a group the database does not
  name shows as "Group N".
- The wallet answer is the chain's: eligibility (quota left, the group live and not sold out) is the page's, and a
  listed wallet whose quota is not on chain yet reads as not listed.

## 7. The web app

### 7.1 The moved imports

Behaviour is unchanged; these files change and no other:

- `src/lib/chain/read-each.ts` and `read-each.test.ts`: deleted, moved to `packages/shared/src`.
- `src/lib/manage/phases-core.ts`: loses `CollectionStateResult` and `chainStateOf`, and imports `chainStateOf` from
  `@cobweb/shared` for `readCollectionState`.
- `src/lib/manage/phases-types.ts`: `ChainGroup` and `ChainState` move; the file re-exports them from `@cobweb/shared`,
  so `phases-view.ts`, `phases-view.test.ts`, `settings-types.ts` and `settings-view.test.ts` keep their imports.
- `src/lib/manage/airdrop-core.ts`: `readEach`, `chainStateOf` and `CollectionStateResult` from `@cobweb/shared` (were
  `@/lib/chain/read-each` and `./phases-core`).
- `src/lib/manage/settings-core.ts`: `readEach`, `revertedRead`, `chainStateOf`, `CollectionStateResult` and `levelOf`
  from `@cobweb/shared` (were `@/lib/chain/read-each`, `./phases-core` and `./settings-view`).
- `src/lib/manage/snapshot-core.ts`: `readEach` and `revertedRead` from `@cobweb/shared`.
- `src/lib/manage/whitelist-core.ts`: `readEach` from `@cobweb/shared`.
- `src/lib/manage/settings-view.ts`: loses `TRANSFER_LEVELS`, `TransferLevelValue`, `pointerOf` and `levelOf`, and
  imports `pointerOf` from `@cobweb/shared` for `settingsViewOf`.
- `src/lib/manage/settings-types.ts`: `TransferLevelState`, `RevealPointer` and `RevealTargets` move; the file
  re-exports them, so `tradability.tsx`, `settings-dialogs.tsx`, `settings-sim.ts`, `settings-core.ts`,
  `settings-view.ts` and `settings-view.test.ts` keep their type imports.
- `src/lib/manage/settings-view.test.ts`: its `pointerOf` and `levelOf` cases move to the shared tests.
- `src/lib/manage/phase-calls.ts`: `TRANSFER_LEVELS` and `TransferLevelValue` from `@cobweb/shared` (were
  `./settings-view`).
- `src/components/manage/tradability.tsx`: `TRANSFER_LEVELS` and `TransferLevelValue` from `@cobweb/shared` (were
  `@/lib/manage/settings-view`).
- `src/components/manage/settings-sim.ts`: `pointerOf` and `TRANSFER_LEVELS` from `@cobweb/shared`; `settingsViewOf`
  stays on `@/lib/manage/settings-view`.

### 7.2 The test-chain switch

- `next.config.ts` gains `env: { COBWEB_TEST_CHAINS: process.env.COBWEB_TEST_CHAINS ?? '' }`, so the browser bundle
  carries the build's value; Next documents `env` as replacing `process.env.COBWEB_TEST_CHAINS` at build time.
- `src/lib/wagmi.ts`: `chains` is the six launch chains, plus Sepolia, Robinhood Chain Testnet and Anvil unless
  `hidesTestChains()`, the shared rule, in place of its own `NODE_ENV` check.
- `.env.example` documents `COBWEB_TEST_CHAINS` beside the chain variables: "1 shows Sepolia, Robinhood Chain Testnet
  and Anvil where NODE_ENV=production hides them. A hosted test environment only."

Server code needs nothing more: `availableChains`, `chainById` and the rest take the new default.

### 7.3 The scripts and the lint rule

- `scripts/chain-fixture.ts` (new): the fixture's chain half, moved out of `deploy-fixture.ts`. It holds the Anvil
  settings through `localChainConfig()` (`RPC_URL_31337` and `FACTORY_ADDRESS_31337` from the environment or
  `.env.local`, a non-local URL refused with exit code 2, as today), the test client `chain`, `check`, `runChecks`,
  `chainReady`, `CID`, `HEX64`, `pay`, `deploy`, `sendCall`, `simulationSentence`, `handOver` and the shared deploy
  helpers. `deploy-fixture.ts` re-exports it and keeps the Supabase half, so the five scripts that import it are
  unchanged, and `render-deps.ts`'s `localConfig()` takes its chain part from `localChainConfig()`.
- `scripts/verify-freshness.ts` (new), with `"verify:freshness": "node --conditions=react-server --import
  ./scripts/resolve-ts.mjs scripts/verify-freshness.ts"`; `@cobweb/freshness` joins the dev dependencies of
  `apps/web` for `@cobweb/freshness/server`.
- `eslint.config.mjs`: under `apps/web/**`, `no-restricted-imports` refuses `@cobweb/shared/clients` with "Import
  @cobweb/shared/server in the web app: it keeps the server-only marker."

## 8. Sample mode

Unchanged. The mint page stays on its sample data until the second sub-project; the server has no sample mode, and its
proof runs on Anvil.

## 9. Stage rules

Unchanged. The server answers any Cobweb collection on a served chain, published or not, since what it serves is public
on chain; whether a page shows it is the second sub-project's rule.

## 10. Testing

- Unit tests in `apps/freshness` (new):
  - `tiers.test.ts`: a start 16 s ahead of the read is idle, 15 s ahead fast, 30 s after fast and 31 s after idle; a
    start of 0 is never fast; an active group with allocation left is live, one sold out by its allocation or by the
    collection's supply is idle; a collection with no read is live; a chain takes the fastest of its collections and is
    idle with none; `degradedAfterMs` is 10 s at fast and live and 60 s at idle; `isDegraded` is false at exactly the
    limit and true 1 ms later; an idle chain whose nearest start opens its window 8 s after the read waits 8 s, and an
    open window does not shorten a fast tick.
  - `hot-set.test.ts`: a join answers `joined` once per chain and address whatever the address's case; a request
    refreshes `requestedAt`; an entry with no request for 10 minutes leaves and one requested 9 minutes 59 seconds ago
    stays; a chain's list empties when its last entry leaves.
  - `collection-check.test.ts`: true is kept; false is kept 60 s, then asked again; at most 10,000 falses, the oldest
    forgotten first; two asks of one address in flight share one read; a failed read is not kept.
  - `logs.test.ts`: the watched topics are the 14 events of 6.5 and `SetTransferSecurityLevel`, from the ABIs; a watched
    log of a hot collection marks it; a validator's `SetTransferSecurityLevel` marks the collection in its topic1 only
    when that collection uses that validator; a log of another address, topic or collection marks nothing; a range over
    500 blocks marks every hot collection.
  - `state-body.test.ts`: the body's fields and their order from a read; the tag is weak and equal for equal reads;
    `readAt`, `block` and `blockTimestamp` leave it unchanged; `degraded`, a group's `active` and the base URI change
    it; `If-None-Match` matches the tag in weak and strong form, inside a list and as `*`, and nothing else.
  - `delegations.test.ts`: `vaultsOf` keeps ALL and CONTRACT for the collection (in any case) with empty rights; drops
    CONTRACT for another contract, ERC721, ERC20 and ERC1155, any delegation with rights, the wallet itself and the zero
    address; keeps a vault delegating twice once; keeps the registry's order; stops at 10.
  - `wallet.test.ts` on a fake reader: asks within 200 ms share one window; a pair asked twice is read once; a window
    takes at most 200 pairs and the next opens at once for the rest; the ask past 5,000 waiting answers `busy`; a failed
    window fails its asks; vaults are read at the window's head after the listing; no listing where the registry has no
    code.
  - `routes.test.ts`: the state, wallet and health routes and the preflight; chain ids `0`, `-1`, `1.5`, `01` and
    letters refused; a lowercase or correctly checksummed address accepted and answered checksummed, a wrong checksum
    and 39 or 41 digits refused; unknown paths and other methods.
- Unit tests in `packages/shared`: `read-each.test.ts` (moved); `collection-state.test.ts` (new: `chainStateOf` maps a
  `collectionState()` answer); `transfer-level.test.ts` and `reveal-pointer.test.ts` (the moved cases, plus
  `TRANSFER_LEVELS`' values); `delegate-registry-abi.test.ts` (new: the selector `0x42f87c25` of
  `getIncomingDelegations(address)`, the seven tuple fields in order with their types, the address's checksum, the
  `DELEGATION_TYPE` values); `entries.test.ts` (new: the `clients` entry's module imports no `server-only`, and the
  `server` entry's still does); `chains.test.ts` (changed: Robinhood Chain Testnet among the test chains, and with
  `vi.stubEnv` the switch showing them where `NODE_ENV=production` hides them, while any value but `1` does not).
- In `apps/web`, `settings-view.test.ts` keeps its other cases; nothing else changes.
- `verify:freshness` (new, `scripts/verify-freshness.ts` on `chain-fixture.ts`). It needs Anvil with the factory
  (`chain:local`) and nothing else. Two collections, A and B, are deployed straight through the factory with
  `encodeCollectionArgs` and the fixture's `deploy`, recording nothing: a supply of 5, Public (free, allocation 3) and
  Holders (free, allocation 2), 2 per wallet, a 5% royalty to the creator, base URI `ipfs://<CID('e')>/`. The creator, a
  holder and a stranger are fresh keys given 10 ETH. The RPC switch is an HTTP server on 127.0.0.1 that forwards each
  request to Anvil, answers 503 while failing and counts what it carries; `RPC_URL_31337` points at it before
  `startFreshness({ port: 0, chainIds: [31337] })`. Polls run every 100 ms. The checks:
  1. "chain: Anvil answers as 31337 and the factory approves the shipped creation code hash"
  2. "at start: before any request, /health answers 200 with no-store, chain 31337 served with no hot collection and no
     block, and the switch has carried no request"
  3. "refusals: the stranger's wallet and the factory answer 404 not-a-collection, chain 999 answers 404
     chain-not-served, a malformed address 400 and an unknown path 404, each with s-maxage=10; a POST answers 405"
  4. "first read: with Holders open and Public scheduled at T, 600 s after the latest block, A's first request answers
     200 within the join wait; its collectionState fields equal a direct read at its block; the owner, a royalty of 500
     bps to the creator, the base URI and the default validator are A's; transferLevel is none, degraded false and
     readAt within 2 s; with the state's cache headers, a weak ETag and Access-Control-Allow-Origin *"
  5. "tier: /health reports chain 31337 at the 2 s tier with one hot collection"
  6. "ETag: an empty block is read under the same ETag; If-None-Match with it answers 304 with no body and the same
     headers, another tag answers 200; OPTIONS answers 204 with the CORS headers"
  7. "at T-1: a block mined at T-1 with evm_setNextBlockTimestamp and evm_mine is read within one tick: blockTimestamp
     T-1, Public with flag false, startTimestamp T and active false; /health then reports the 1 s tier"
  8. "at T: a block mined at T is read within 1.5 s (one 1 s tick and the read) with Public active true under a new
     ETag, and no answer polled since T-1 with a blockTimestamp below T read Public active"
  9. "wallet: once the creator writes a quota of 2 for the holder in Holders, the holder's answer reads publicMinted 0,
     Holders quota 2 and claimed 0, and the stranger's Holders quota 0, both with no vaults (Anvil has no registry
     code) and s-maxage=5"
  10. "a mint: the holder mints one from Holders with the value quoteBatchMint answers; its answer reads claimed 1 at
      once, and A's state reads Holders minted 1 and totalMinted 1 under a new ETag within one tick"
  11. "windows: ten wallets asked together are answered from one 200 ms window: /health's wallet windows rise by one
      and answered by ten"
  12. "extras on their logs: setBaseURI to ipfs://<CID('f')>/, a royalty of 750 bps to the stranger and the validator
      set to the zero address each read within one tick of their receipt, the last with transferLevel none"
  13. "first read pending: B, known as a collection from a wallet request, answers 503 not-read-yet with Retry-After 1
      and no-store while the switch fails, then 200 within two ticks of it passing again"
  14. "degraded: with the switch failing, A answers its last state with degraded true under a new ETag once its last
      read is more than 10 s old, readAt unchanged, and /health names the failure; with the switch passing, degraded is
      false again within one tick"
  15. "health: /health reports chain 31337 with two hot collections, its tier, block, lag and last good tick, and
      neither the switch's URL nor Anvil's"
  16. "stop: close() ends the server; its port refuses a connection and the switch carries no request for 3 s"

  Sixteen PASS lines. Checks 7 and 8 are the server half of Phase 6's exit criterion: never active before the chain's
  time reaches the start, and active within one tick of the first block at it.
- The start as Railway runs it: `NODE_ENV=production COBWEB_TEST_CHAINS=1 PORT=3100 pnpm --filter @cobweb/freshness
  start` with the two Anvil variables answers `/health` listing Anvil, and without `COBWEB_TEST_CHAINS` lists no chain.
- `pnpm typecheck && pnpm lint && pnpm test && pnpm format:check`, `pnpm build`, and every verify script: the fixture's
  split must leave `verify:deploy`, `verify:phases`, `verify:whitelist`, `verify:airdrop` and `verify:settings` at their
  counts, and `localConfig()`'s change must leave `verify:render` at its count.

## 11. Documentation

- `CLAUDE.md`: the layout line for `apps/freshness` becomes "Railway service that reads chain state for mint pages: the
  state and wallet endpoints, run from source on Node 24", and the `packages/shared` line names the pure chain readers
  (browser entry) and the `clients` entry beside the server entry. After `verify:settings`:

```
pnpm --filter @cobweb/freshness dev       # the freshness server on port 3100 against the chains in apps/freshness/.env
pnpm --filter @cobweb/freshness test      # the freshness server: tiers, the hot set, the ETag, degraded, the delegation filter, the wallet windows
pnpm --filter @cobweb/web verify:freshness   # the freshness server in process against Anvil: liveness at T-1 and at T, the ETag, the refusals, the wallet endpoint and degraded
```

- `docs/MASTER_PLAN.md`, dated notes only: the Phase 6 status line becomes "**Status:** in progress." followed by
  "Freshness server (first sub-project of three: the freshness server; the mint page on live data; the indexer and the
  Overview, each with its own spec, plan and run) landed on <date>; see
  [specs/2026-10-16-freshness-server.md](specs/2026-10-16-freshness-server.md)." with what exists (`apps/freshness` run
  from its source with no build step; the hot set; per chain and tick one `eth_getLogs` and one multicall at one block
  at 1 s, 2 s or 20 s; the extras on their logs and every 60 s; the state endpoint with a weak ETag, the cache headers
  and `degraded`; the wallet endpoint in 200 ms windows with up to 10 delegated vaults; `/health`; the readers in
  `@cobweb/shared` with the `clients` entry and the registry's ABI; `COBWEB_TEST_CHAINS` with Robinhood Chain Testnet;
  `pnpm --filter @cobweb/web verify:freshness` with 16 checks), "Known:" with section 12's items, and "Next: the mint
  page on live data." Under Hosting, a dated decision: "**The freshness server** (decided 16 October 2026;
  [specs/2026-10-16-freshness-server.md](specs/2026-10-16-freshness-server.md)). One Node service on Railway, run
  from its TypeScript source by Node 24, reads every chain whose `RPC_URL_<id>` and `FACTORY_ADDRESS_<id>` are set,
  over HTTP only: per chain and tick, one `eth_getLogs` and one multicall at one block over the collections requested
  in the last 10 minutes, every 1 s around a scheduled start, 2 s while a phase is live and 20 s otherwise. It serves
  the state and wallet endpoints with ETag and cache headers and a `degraded` flag, reads no database and never
  computes liveness. Its Railway settings live on the service, since Railway deprecated config as code. Manage keeps
  its own reads." The Phase 6 bullets and the Mint groups line "The freshness server may replace the read in Phase 6."
  stay as written.
- This spec: the landing note after section 13 records the checks run with their counts, the start as Railway runs it
  and the hosted steps still owed.
- `apps/freshness/.env.example` (new) and `apps/web/.env.example` (7.2).

## 12. Owed and known

Outside this sub-project, as section 3 says: the database, the public read path and the mint page (the second
sub-project), the indexer (the third), Cloudflare and the k6 run (Phase 7). The dashboard keeps its own reads, since
rule 3 binds the mint page only.

Owed by the owner (hosted, not done by this sub-project):

- The Railway service `freshness` in the existing project: from the repository's `main`, with no root directory (the
  workspace installs from the root); a build command that builds nothing (for example
  `echo "No build step: Node 24 runs the TypeScript source"`, since the default would run the root `turbo run build`);
  the start command `pnpm --filter @cobweb/freshness start`; the watch paths `apps/freshness/**` and
  `packages/shared/**`; the health check path `/health`; restart on failure; one replica; a Railway domain until
  Cloudflare.
- Its variables: `RAILPACK_NODE_VERSION=24` (the root's `engines` says only `>=22`), `NODE_ENV=production`, and
  `RPC_URL_<id>` with `FACTORY_ADDRESS_<id>` for each chain it serves; `COBWEB_TEST_CHAINS=1` on a test environment
  only. Until the mainnet factories (Phase 7), the test chains are all it can serve, and Phase 1 still owes the testnet
  factory deploy.
- Once deployed, `curl https://<domain>/health` lists the served chains.
- In Phase 7, the Cloudflare rule: a proxied subdomain of the zone in front of the Railway domain and a cache rule that
  makes `/v1/*` eligible and respects the origin's `s-maxage`; confirmed on the account's plan: a 1 s edge TTL,
  `stale-while-revalidate`, `stale-if-error`, the weak ETags kept and 304s to conditional requests; a rate limit
  against address spraying.

Owed to Phase 7:

- The k6 run against the Cloudflare endpoint (20,000 pollers, 5,000 wallet asks a minute), ported to `/v1/state` and
  `/v1/wallet`, with `groups[].startTimestamp` for `phases[].start` (there is no end) and `readAt` for `serverTime`;
  staleness from `readAt` on 200s, since a 304 keeps an older body by design.
- Alerts on `/health`'s lag, failed ticks and gaps; the second replica; the freshness origin in the full CSP's
  `connect-src`.

Owed to the second sub-project: the database and the public read path (`mint_pages`, the `mint-page` bucket,
`public.mint_page`), the mint page on the answers of 6.10 with the web app's variable for the freshness origin, and a
timeout on its server render's fetch, which can wait out a join.

> **16 October 2026:** Closed by [2026-10-16-mint-page-live-data.md](2026-10-16-mint-page-live-data.md): the database, the public read path and the mint page on the answers of 6.10 landed, with `NEXT_PUBLIC_FRESHNESS_URL` for the origin. The server render's timeout is moot: the page's HTML is cached by link and carries no chain state, and the first state is the browser's first poll.

Owed to the third sub-project: the indexer runs in `apps/freshness` beside the reader, sharing `logs.ts` and the
clients; its scan covers every deployed collection at each chain's depth with `Transfer`, the mint events,
`NFTsAirdropped` and `MintFundsWithdrawn`, which the reader's scan leaves out.

> **17 October 2026:** Closed by [2026-10-16-indexer-overview.md](2026-10-16-indexer-overview.md): the indexer runs in `apps/freshness`, one per served chain beside its reader, sharing the clients, the chain list and the RPC variables; `logs.ts` stays the reader's, since the indexer reads decoded logs through viem's `getLogs` at each chain's confirmation depth. Decision 20 changes: the process now holds a database client for the indexer, from `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, while the request path still reads none, since the state body's `activity` comes from the indexer's memory.

Owed before launch, on a testnet with the registry and the validator deployed:

- A wallet with a whole-wallet and a contract delegation reads its vaults, which Anvil cannot show; the registry's code
  on Berachain and Monad mainnet, which its README does not list among its mainnets although MASTER_PLAN says it is on
  all six launch chains.
- `getCollectionSecurityPolicy` on the default validator (the Settings flag, owed already), which the level read
  shares.
- Each provider's `eth_getLogs` range limit against the 500-block guard, and how its head behaves behind a load
  balancer.

Known:

- Anvil has no `multicall3`, validator code or registry, so the verify reads in parallel, reads every level `none` and
  every wallet without vaults.
- One replica: a restart empties the hot set, so each collection's first poll waits for its first read (up to 2 s, then
  503), and Cloudflare's `stale-if-error` covers the gap only once Phase 7 sets it, serving the copy from before the
  restart.
- A start scheduled less than one idle interval ahead (20 s) can be read up to that late; the page shows "Starting,
  waiting for the chain" meanwhile.
- A node that keeps answering an old head reads as fresh, since the head did not move; `/health`'s `lagSeconds` shows
  it.
- Reads are at the head, not at a depth, so a reorg can show a state and then take it back: liveness must be read at the
  latest block, since a mint lands after it.
- viem's HTTP transport waits up to 10 s and retries three times, so one slow RPC can stretch a tick; ticks never
  overlap, and `degraded` shows the delay.
- No origin rate limit: an address spray costs one `isCollection` read per new address a minute, in bounded memory.
- The extras are read on their logs and every 60 s, so they can be older than `block`, which is the state's block.
- `royaltyInfo(1, 10000)` reads token 1's royalty, as Settings does, and levels 2 to 8 are answered as numbers.

## 13. Acceptance criteria

- [x] `pnpm --filter @cobweb/freshness start` runs the TypeScript source on Node 24 with no build step, on `PORT`,
      reading each chain whose two variables are set; `COBWEB_TEST_CHAINS=1` shows the test chains under
      `NODE_ENV=production` in the shared list, the web app's browser bundle and its wallet's chain list.
- [x] Per chain and tick, one `eth_getLogs` and one `readEach` at one block over the hot set, at 1 s, 2 s or 20 s as
      section 6.6 sets them; the extras on their logs and every 60 s; liveness only from the view's `active`.
- [x] The state endpoint answers every field of 6.7 with a weak ETag that unchanged ticks keep, 304 to a match, the
      cache and CORS headers, 404 for an address that is not a collection and 503 with `Retry-After` before the first
      read; `degraded` follows 6.6.
- [x] The wallet endpoint answers `walletState` and up to 10 vaults with empty-rights delegations, from 200 ms windows,
      with `s-maxage=5`.
- [x] `/health` reports each chain's tier, lag and hot collections, and never an RPC URL.
- [x] `apps/web` imports the five readers from `@cobweb/shared` with no behaviour change; `pnpm typecheck`, `lint`,
      `test`, `format:check` and `build` pass, and every verify script still passes.
- [x] `verify:freshness` passes its 16 checks, the server half of Phase 6's exit criterion among them; section 11's
      docs are written, and the landing note lists the owner's hosted steps.

Checked on 16 October 2026 on Anvil and local Supabase: `pnpm typecheck`, `pnpm lint`, `pnpm test` (shared 103, freshness 110 in 11 files, web 697 in 74 files, dna 60, render 117, worker 282) and `pnpm format:check` pass; `pnpm build` passes, and in the client chunks a build with `COBWEB_TEST_CHAINS=1` compiles the switch to show the test chains while the default build compiles it to hide them (the wallet chunk adds Sepolia, Robinhood Chain Testnet and Anvil behind that switch); `verify:local` 365, `verify:chain` 12, `verify:storage` 15, `verify:sweep` 8, `verify:render` 22, `verify:deploy` 15, `verify:phases` 20, `verify:whitelist` 18, `verify:airdrop` 15 (the 500-wallet batch at 26,880,045 gas), `verify:settings` 17 and `verify:freshness` 16 (about 60 s; once more with the Supabase variables unset, on Anvil alone), each with 0 failed. The start as Railway runs it: with `NODE_ENV=production COBWEB_TEST_CHAINS=1 PORT=3100` the server served Anvil and answered the state endpoint (200 in 43 ms on a collection's first request, 304 on its weak ETag, HEAD without a body, a lowercase address checksummed), the wallet endpoint, `/health` and every refusal, with no URL in its log; without the switch it served no chain and answered `chain-not-served`; SIGTERM ended both starts with the port free. Departures from this spec's letter, each ruled during the run and listed in section 14 (items 17 to 26): section 7.3's lint rule is not in the branch and is the owner's one-line step (a plugin hook that guards lint configs refused the edit; the patch is ready); the web app fixes `COBWEB_TEST_CHAINS` at build time and Turborepo passes it to the build; `index.ts` reads `PORT || 3100`; the early wake is floored at one fast tick, a stale wake moment does not shorten the delay after a successful tick, and after a failed tick the reader retries at the fast cadence while a start's window is open; the tier `degraded` and `/health` use counts the entries with a read; every CORS answer exposes `ETag`, `Retry-After` and `Age`; the router works on the raw request target; `close()` stops accepting first and waits for the requests in flight; a failed factory read counts on its chain's `/health`, is logged at most once per 10 s, and at most 50 are in flight per chain; a malformed factory address refuses the start; an entry keeps its mark after a full read below the scanned block; a null registry listing is logged; the server keeps idle connections 65 s. Hosted steps still owed (section 12): the Railway service for `apps/freshness` with its build command, start command (`pnpm --filter @cobweb/freshness start`), watch paths, health check on `/health`, one replica, `RAILPACK_NODE_VERSION=24` and the variables (`PORT`, `NODE_ENV=production`, `COBWEB_TEST_CHAINS=1` while only the test chains have factories, and `RPC_URL_<id>` with `FACTORY_ADDRESS_<id>` per served chain); the owner's `eslint.config.mjs` step; the Cloudflare rule in Phase 7. Defects found and fixed during the run: d4f524d (Turborepo stripped the switch from the web build), 7c06ebd (a frozen read made an idle chain read back to back), af288c1 (the reader's head guard, gap count, scanned block, null-call rule and stop contract pinned; a tick that throws outside its try caught), bcf29c0 (a request target such as `//` answered 500; `close()` kept accepting; a joining collection flashed `degraded` on its neighbours), and the fix wave 9c27097, 69166d1, 6e8062e, 8961962, b724026, 2ba6d6e, 0ccc1a2 and 4168894 (the parked review items, the verify's two deploys simulated, the fixture's settings in a side-effect-free module, the whole-branch review's items).

## 14. Reconciliations with the rulings

Where a ruling could not be written as stated, or the rulings and the map left a gap, this spec takes the nearest
workable reading:

1. "A `railway.json` with watch paths": not written. Railway deprecated config as code (`railway.json` keeps working
   for legacy services until 1 December 2026), and its replacement's documented options have no watch paths, so the
   ruled values are the service's settings, set by the owner (section 12).
2. "The viem client factory moves to `packages/shared/src/clients.ts` without `server-only`": it is already there
   without the marker, which `server.ts` carries; the change is the `./clients` export, with a lint rule keeping
   `apps/web` on `@cobweb/shared/server`.
3. "The pure readers move ... or whichever of them `apps/web` imports today": the five that another module imports
   move with their types; `mintedIds` is private to `airdrop-batch.ts` and `joinPhases` returns the demo `MintGroup`,
   and both serve only `apps/web` (the mint page's receipt and join, in the second sub-project), so they stay.
4. "The ETag over the chain-derived body only": written as the body without `readAt`, `block` and `blockTimestamp`,
   with `degraded` inside. `block` and `blockTimestamp` change every tick on every launch chain but Ethereum, so a tag
   over them would never answer 304; and with `degraded` outside, a client sending `If-None-Match` would get 304s of
   the healthy body through a whole outage. No clock value is in the tag.
5. "Older than three ticks of its tier or 10 s": read as the larger of the two; the smaller would flag every idle
   collection 10 s after each of its 20 s reads.
6. "One `eth_getLogs` ... `SetTransferSecurityLevel` on each hot collection's validator with topic1 the collection":
   one call cannot set topic1 for the validator's logs without filtering the collections' own logs on the same
   position, so the call asks the validators for the event and the server keeps those whose topic1 is a hot collection
   using that validator.
7. "The mint group events": read as the events that change what `collectionState()` reports (status, close all, start,
   registration, price, allocation, the public limit, mint on behalf), with `FeesUpdated`; `MintQuotasAdded` is left
   out, since it changes only `walletState`, which every wallet ask reads at the head. Every tick reads each hot
   collection's state at the block the scan ends on, so a matching log marks its collection for a full read, state and
   extras, in that tick.
8. "One multicall" is one `readEach`: a `multicall` per 500 calls where the chain has `multicall3`, and parallel reads
   on Anvil, which has none.
9. Added: a request for a collection that is joining waits up to 2 s for its first read before the 503, so the first
   visitor of a collection and a page's server render usually get the state.
10. Added: a tick that finds the head at the block a collection was last read at counts as a read of it (its state
    cannot have changed); otherwise a collection on Ethereum, with 12 s blocks, would read degraded between blocks.
11. Added to the tiers: a collection with no read yet counts as live (2 s), so a failed first read is tried again every
    2 s rather than 20; and an idle chain wakes when the nearest start's window opens, since the ruled 15 s lead is
    shorter than the 20 s idle interval.
12. `COBWEB_TEST_CHAINS` "also in `apps/web`'s `availableChains`": it also reaches the browser bundle through
    `next.config.ts`'s `env` and the wallet's chain list in `lib/wagmi.ts`, both of which hide the test chains under
    production today; Robinhood Chain Testnet takes Robinhood Chain's 3 confirmations.
13. "Deploying a collection through the fixture" with no database: the collections are deployed straight through the
    factory with the fixture's `deploy`, as `verify:airdrop` check 14 deploys its gas collection, and the fixture's
    chain half moves to `chain-fixture.ts`, re-exported, so the script runs without Supabase; the script lives in
    `apps/web` and starts the server from `@cobweb/freshness/server`.
14. The vault filter adds empty rights: the collection's `checkDelegateForContract(caller, vault, this, "")` accepts
    only delegations with empty rights, so a delegation carrying rights would list a vault whose mint reverts
    `NotDelegate`.
15. Flag: the registry's README lists Ethereum, Arbitrum, Base and Robinhood among its mainnets and Sepolia among its
    testnets, but not Berachain or Monad mainnet, while MASTER_PLAN says it has code on all six launch chains; the
    server answers no vaults where it has none, and the launch check confirms the code on each chain.
16. "`/health` reporting each chain's lag": the lag is the time since the block time of the head the last good tick
    read, and `/health` always answers 200, so Railway's deploy check passes while one RPC provider is down.

17. Run, 16 October 2026: section 6.6's early wake is never sooner than one fast interval after the tick's start, and a wake
    moment that lies at or before the tick's start comes from a stale read and does not shorten the delay after a
    successful tick (7c06ebd and 9c27097), while after a failed tick the reader retries at the fast cadence as long as
    a read's window moment has passed, so an RPC blip at the wake tick cannot leave a start unread for 20 s (4168894); a fresh read's wake is unchanged, since its `readAt` is after the tick's start.
18. Run, 16 October 2026: the tier a request's `degraded` and `/health` use is computed over the chain's entries that have a
    read, not "its chain's tier" over every entry (line 410), so a joining collection cannot flash `degraded` on its
    neighbours; the tick's own scheduling tier still counts an unread entry as live (bcf29c0).
19. Run, 16 October 2026: every CORS answer carries `Access-Control-Expose-Headers: ETag, Retry-After, Age`, which section
    6.10's conditional fetch, `Retry-After` retry and the edge's `Age` need across origins (bcf29c0, b724026).
20. Run, 16 October 2026: the router works on the raw request target, so `//`, a dotted path, a backslash and an
    absolute-form target answer 404 `not-found` where `new URL` answered 500 (bcf29c0); `close()` stops accepting
    before the readers stop, waits for the requests in flight and keeps idle connections 65 s (bcf29c0, b724026).
21. Run, 16 October 2026: `index.ts` reads `PORT || 3100` where section 6.1 writes `??`, since a blank `PORT=` in a copied
    `.env` means unset, as a blank chain variable does (6852718); a start failure is logged with its code (0ccc1a2).
22. Run, 16 October 2026: a failed factory read (`isCollection`) counts into its chain's `failedTicks` and `lastError` on
    `/health` and is logged at most once per chain per 10 s; at most 50 factory reads are in flight per chain and a
    state request beyond them answers 503 `busy`; a malformed `FACTORY_ADDRESS_<id>` refuses the start (b724026).
23. Run, 16 October 2026: an entry read in full at a head below the scanned block keeps its mark, so an extras change in the
    blocks between that head and the scanned block is read on the next tick (9c27097); a null registry listing is
    logged at most once per chain per 10 s (section 6.8), and the wallet windows checksum their two addresses before
    reading (9c27097, 4168894).
24. Run, 16 October 2026: section 7.3's lint rule is the owner's one-line step, since a plugin hook that guards lint configs
    refused the edit during the run; the patch is ready and nothing in `apps/web` imports `@cobweb/shared/clients`.
25. Run, 16 October 2026: the web app fixes `COBWEB_TEST_CHAINS` at build time (both bundles), and `turbo.json` declares it
    for the build task, since Turborepo's strict environment would otherwise strip it (d4f524d); a hosted test
    environment sets it where the build runs and rebuilds after changing it.
26. Run, 16 October 2026: section 6.10 with a cache in front: the browser's own `stale-while-revalidate` and Phase 7's edge can
    serve a poll one answer late and answer an outage from the edge's copy for up to 60 s with `degraded: false`, so
    the mint page fetches with `cache: 'no-cache'` (still conditional), reads `Age` and treats an `Age` above 10 s as
    unreachable, keeps the highest `block` it has seen and ignores a body below it, and treats a 404
    `not-a-collection` as final for that page load only (about 70 s; a fresh deploy can read it on a lagging node).
