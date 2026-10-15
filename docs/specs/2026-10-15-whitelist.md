# Whitelist: specification

Phase 5, third sub-project of four (deploy; phases; whitelist and holder snapshot; airdrop and settings). Product
decisions: [../MASTER_PLAN.md](../MASTER_PLAN.md#decisions) (whitelist quotas, holder snapshot import) and the Phase 5
bullets "Whitelist: CSV upload, validation, chunked on-chain writes with resume after a failed chunk." and "Holder
snapshot import for Whitelist and Airdrop, as a serverless function." The sample screens:
[2026-10-03-creator-flow-ui.md](2026-10-03-creator-flow-ui.md) section 4.6 and its audit's Whitelist and Airdrop
tables (section 13). The contract: `contracts/src/CobwebCollection.sol` (`setMintQuota`, `mintQuotas`,
`quotaClaimed`, `walletState`, `MintQuotasAdded`, the quota errors). What Phases left:
[2026-10-15-phases.md](2026-10-15-phases.md) sections 7.1 to 7.3 and 12. Legacy:
[../legacy/market-creator-flow.md](../legacy/market-creator-flow.md) section 6.5 (batches of 1,000, no resume point)
and [../legacy/market-mint-and-data.md](../legacy/market-mint-and-data.md) section 4 (the `whitelists` table).

## 1. Goal

A creator with a deployed collection keeps one whitelist per whitelist phase in Manage drop, Whitelist: addresses and
quotas from a CSV, pasted text, one at a time or a holder snapshot, edited or removed, then written on chain in chunks
of 500 addresses per `setMintQuota` transaction from the creator's wallet through the manage machine. The server
builds each chunk from the entries not yet written, proves each confirmed chunk from its receipt and calldata, and
keeps on each entry what the chain was last proven to hold, so a failed or lost chunk is resumed by writing the next
one. Quota used comes from the chain. The holder snapshot is a server action reading another ERC-721 contract at one
block, for Whitelist and Airdrop alike.

## 2. Decisions taken in the design conversation

1. **Scope.** The Whitelist tab on real data: lists in `whitelist_entries`, chunked writes through the manage machine
   confirmed from receipt and calldata, resume after a failed or lost chunk, staged removal, quota edits, CSV and
   paste, the holder snapshot as a server action shared with Airdrop's recipients input (the rest of Airdrop stays
   sample), sample mode, `verify:whitelist`, docs. Out: minting and mint page eligibility (Phase 6, `walletState`
   through the freshness server), gates, partner codes, per-chain chunk sizes, ERC-1155 snapshots, deleting a phase,
   airdrop sends and settings (fourth sub-project). Considered: the snapshot with the airdrop sends (one input, two
   behaviours until then).
2. **Truth.** The chain holds issued and claimed quota; `whitelist_entries` holds the creator's list (address, quota)
   and a copy of what the chain was last proven to hold: `written_quota` (null until a chunk carrying the address is
   confirmed), `written_tx`, `written_at`. An entry is written when `written_quota = quota`. A `quota` of 0 is a
   removal, written as a zero while `written_quota > 0`, else deleted at once; the confirm deletes its row once the
   zero is written. Chunks are not stored: the next is the first 500 entries not written in lowercase address order,
   built by the server. Considered: a chunk table (nothing to key it by once the chain holds the truth); keeping
   `quota > 0` (a removal needs a zero written).
3. **Who writes what.** The owner's client keeps insert (the list's four columns), delete and `update (quota)`; only
   the service-role definer `whitelist_chunk_record` writes the copies. Adds go through a server action in pages of
   1,000 rows under the creator's client (decision 14), at most 10,000 per group. Considered: entries written by
   definer functions only (the list is the creator's own data; the chain copies are not).
4. **The calls.** `setMintQuota` joins `ManageFunction` (`phaseCalls.quotas`) with arrays in `SentCall` and
   `sentCallShape`, `MintQuotasAdded` in `ExpectedEvent`, counts in `reviewOf` and four quota errors in
   `revertSentence`. Considered: a separate call type for arrays (two machines, two confirms).
5. **The confirm proves the chunk from the calldata:** the receipt, the input decoded as `setMintQuota` for the group
   with its count matched against `MintQuotasAdded`, the record of the decoded pairs, then the view; the browser sends
   only the hash and the group id. An unconfirmed chunk keeps `{ hash, onchainId }` in localStorage through the
   machine's `remember` and `forget`, with "Check again" and "Discard". Considered: reading `mintQuotas` per address
   after the receipt (500 reads to prove what the calldata says).
6. **The view:** the phases view's whitelist groups and a list per named group; quota used is the group's `minted`
   from `collectionState()` (each whitelist mint claims one quota); the Minted column reads `quotaClaimed` for the 25
   addresses on screen, "Not read" when the chain does not answer. Considered: `quotaClaimed` for every entry on load
   (2,000 reads for the done-when list).
7. **The snapshot** is a server action under `ownedCollection`: configured chains, one pinned block, ERC-165 through
   its own one-function ABI (viem's `erc721Abi` has `totalSupply` and `ownerOf` but not `supportsInterface`), at most
   20,000 tokens, `ownerOf` for ids 0 to `totalSupply` in batches. Considered: a route handler with its own
   `maxDuration` (a server action within 300 seconds covers 20,000 tokens).
8. **The screen** is today's sample screen on the real view; with the chain down the writes wait and the edits work;
   the chunk write runs on `TransactionDialog` under the Whitelist's own `ManageActionsProvider`. Considered: hiding
   the table while the chain is down (the list is Cobweb's).
9. **Sample mode** keeps every state, plus `?chunk=pending` and `?chain=unreachable`. Considered: the sample screen
   beside the real one (two screens to keep in step).
10. **`verify:whitelist`** runs 18 checks on the deploy fixture, Holders at 0.001 ETH with 2 tokens beside Public
    (free, 1): the fixture's collection holds three tokens, and quotas are not bounded by an allocation, so 1,100
    addresses need no allocation of 1,100. Considered: more checks in `verify:phases` (one script per sub-project).
11. **Docs:** MASTER_PLAN's status line, two dated notes, `CLAUDE.md`. Considered: a dated MASTER_PLAN decision for
    the copies (the Whitelist quotas decision holds the rule; this spec the mechanism).
12. **Sentences:** a Whitelist block in `result.ts`. Considered: the Phases sentences (they speak of a "change").
13. **Shapes** check every input before the session read. Considered: the browser's parser alone (rule 4).
14. **Adds run `whitelist_entries_add`,** a security invoker on the creator's client: PostgREST's upsert sets every
    inserted column on a conflict, keys included, which the `quota` grant refuses; the function sets `quota` alone
    and locks the group row for the cap. Considered: an update grant on the keys with a trigger refusing a change
    (two grants and a trigger for one rule).
15. **Actions:** eight for the list plus `fetchHolders`, bound by `whitelistServer`. Considered: each edit answering
    the whole view (10,000 rows read back for one quota).
16. **Pending answers:** `verifyManage` polls `WHITELIST_NOT_CONFIRMED` as it polls `PHASE_NOT_CONFIRMED`.
    Considered: `PHASE_NOT_CONFIRMED` for a chunk (a sentence about a "change").
17. **The local model:** pure patches on `GroupList`, applied once the server accepts an edit. Considered: reading the
    view after each edit (a chain read and up to 10,000 rows per click).
18. **Types by hand,** as the generator writes them. Considered: regenerating (the same result, needing the stack).
19. **Sample data:** `DEMO_WHITELISTS` and its types stay as sample-only shapes; `SAMPLE.whitelists` goes, unread.
    Considered: the demo data in the view's shape (churn in shared demo data for one screen).
20. **Airdrop's snapshot:** `SnapshotSource` gains `fetch`; nothing else in Airdrop changes. Considered: the sample
    fetch for Airdrop until the fourth sub-project (one input, two behaviours).
21. **Tests and the walk:** section 10. Considered: component tests (the repo tests pure modules and walks screens).

## 3. Scope

In: the migration and its two functions; `setMintQuota` in the manage calls; the chunk proof; the view, next chunk,
confirm, list edits and usage read; the holder snapshot; the Whitelist page and screen on real data with their own
manage actions and the pending chunk; the snapshot input's `fetch` for Whitelist and Airdrop; sample mode;
`verify:whitelist`; docs. Out: as decision 1, the freshness server's quota endpoint (Phase 6), any scan of the chain
for quotas set outside Cobweb, and the import type (the audit's decision: the inputs share one text).

## 4. Database (`supabase/migrations/20261015100000_whitelist.sql`)

### 4.1 `whitelist_entries`

```sql
alter table public.whitelist_entries drop constraint whitelist_entries_quota_check;
alter table public.whitelist_entries
  add constraint whitelist_entries_quota_check check (quota >= 0),
  add column written_quota integer check (written_quota >= 0),
  add column written_tx text check (written_tx ~ '^0x[0-9a-f]{64}$'),
  add column written_at timestamptz,
  add constraint whitelist_entries_written_together check (
    (written_quota is null) = (written_tx is null) and (written_tx is null) = (written_at is null));
revoke insert, update on public.whitelist_entries from authenticated;
grant insert (mint_group_id, collection_id, wallet_address, quota) on public.whitelist_entries to authenticated;
grant update (quota) on public.whitelist_entries to authenticated;
```

The owner keeps select and delete, and the policy "whitelist_entries: owner all" scopes every grant to the owner's
rows. `quota` is 1 to 10,000 from the screens, or 0 for a removal staged on a written address; the copies are set
together. The table comment says which columns are the list, which the copies, and that only `whitelist_chunk_record`
writes the copies.

### 4.2 Functions

```sql
create function public.whitelist_entries_add(p_collection_id uuid, p_onchain_id integer, p_rows jsonb)
  returns table (added integer, updated integer)
create function public.whitelist_chunk_record(p_collection_id uuid, p_owner uuid, p_onchain_id integer,
  p_tx text, p_rows jsonb) returns integer
```

Both are `plpgsql` with `set search_path = ''`; `p_rows` is `[{ address, quota }]`, addresses lowercase. They raise
`NOT_DEPLOYED` and the database sentences of section 6.6 with `23514`. `whitelist_entries_add` is a security invoker
granted to `authenticated` only, as `mint_group_move` is, so the owner's policy and grants apply: it takes the group
by `(collection_id, onchain_id)` `for no key update` ('phase not found', `42501`, when it sees none), refuses the
public sale (`WRONG_GROUP`), a collection without a `deployments` row (`NOT_DEPLOYED`) and a quota outside 1 to
10,000 (`QUOTA_RANGE`), inserts with
`on conflict (mint_group_id, wallet_address) do update set quota = excluded.quota` where the quota differs (a staged
removal re-added gets its quota back; copies never change), raises `WHITELIST_FULL` (keeping nothing) when the group
then holds more than 10,000 rows, and answers the rows it inserted and changed.
`whitelist_chunk_record` is a security definer for the service role only, given a verified user's id and pairs
decoded from a proven transaction: it locks the collection through `private.lock_owned_collection`, refuses
`NOT_DEPLOYED`, resolves the group by `onchain_id` or raises 'phase not found' (`42501`); for each pair above 0 it
upserts the entry on `(mint_group_id, wallet_address)` (a missing row is created with `quota` equal to the written
value, so a chunk sent outside Cobweb becomes known) and sets the three copies (`written_at` is `now()`) where they
differ; for a pair of 0 it sets the copies on an existing row only; then it deletes the rows of `p_rows` whose written
and listed quotas are both 0. It answers how many entries' copies it wrote: a second record of a hash answers 0.

### 4.3 Types (`apps/web/src/lib/database.types.ts`, by hand)

`whitelist_entries` Row gains `written_at: string | null`, `written_quota: number | null` and
`written_tx: string | null`; Insert and Update gain them as optional. Functions gain:

```ts
whitelist_chunk_record: { Args: { p_collection_id: string; p_onchain_id: number; p_owner: string; p_rows: Json; p_tx: string }; Returns: number }
whitelist_entries_add: { Args: { p_collection_id: string; p_onchain_id: number; p_rows: Json }; Returns: { added: number; updated: number }[] }
```

## 5. The shared package

No code changes: `publicClientFor` and `availableChains` serve the snapshot. `collection.test.ts` pins
`setMintQuota(address[],uint256,uint256[])` with `['addressesToAdd', 'mintGroup', 'mintQuotas_']`,
`mintQuotas(uint256,address)`, `quotaClaimed(uint256,address)`, `walletState(address)`, `ownerOf(uint256)`,
`totalSupply()`, `supportsInterface(bytes4)`, the event `MintQuotasAdded(uint256,uint256)` and the errors
`ArrayLengthMismatch()`, `PublicGroupHasNoQuota()`, `NotInWhitelist(address,uint256)` and
`ExceedsMintQuota(uint256,uint256)`.

## 6. The server

### 6.1 Types and the pure view

```ts
// apps/web/src/lib/manage/whitelist-types.ts, types only
export type ListEntry = { address: Address; quota: number; writtenQuota: number | null; writtenTx: Hex | null }
export type WrittenChunk = { txHash: Hex; addresses: number; writtenAt: number }
export type GroupList = { onchainId: number; entries: ListEntry[]; total: number; written: number;
  unwritten: number; totalQuota: number; quotaUsed: number; chunks: WrittenChunk[] }
export type WhitelistView = { chainId: number; contract: Address; groups: MintGroup[]; lists: GroupList[];
  chunkSize: 500; blockTimestamp: number; readAt: number; chainReachable: boolean }
export type ChunkEntry = { address: Address; quota: number }
export type ChunkPlan = { onchainId: number; number: number; of: number; entries: ChunkEntry[] }
export type SentChunk = { hash: Hex; onchainId: number }
// apps/web/src/lib/manage/whitelist-view.ts, pure, for the browser and the server
export const WHITELIST_CHUNK = 500, WHITELIST_MAX = 10_000, QUOTA_MAX = 10_000, USAGE_PAGE = 25
export type EntryRow = { wallet_address: string; quota: number; written_quota: number | null;
  written_tx: string | null; written_at: string | null }
export function isWritten(entry: Pick<ListEntry, 'quota' | 'writtenQuota'>): boolean
export function entriesOf(rows: EntryRow[]): ListEntry[]
export function writtenChunksOf(rows: EntryRow[]): WrittenChunk[]
export function listOf(onchainId: number, entries: ListEntry[], quotaUsed: number, chunks: WrittenChunk[]): GroupList
export function chunkPlanOf(list: GroupList, size?: number): ChunkPlan | null
export function whitelistGroups(view: PhasesView): MintGroup[]
```

Entries are in lowercase address order, addresses checksummed. `total` counts entries above 0, `written` those whose
`writtenQuota` equals `quota`, `unwritten` the rest (staged removals included); `totalQuota` sums `quota`;
`quotaUsed` is the group's `minted` (0, never shown, when the chain did not answer); a written chunk counts the rows
that still name it. `chunkPlanOf` takes the first `size` (500) entries not written, a removal sending 0, or answers
null when all are written; a plan's `number` is the written chunks plus one, and `of` adds what the unwritten entries
need. `whitelistGroups` keeps the phases view's whitelist groups in its order.

### 6.2 The view, the next chunk and the confirm (`apps/web/src/lib/manage/whitelist-core.ts`)

```ts
export type WhitelistContext = PhasesContext
export async function whitelistViewCore(ctx: WhitelistContext, read: StateReader = readCollectionState): Promise<DeployOutcome<WhitelistView>>
export async function nextChunkCore(ctx: WhitelistContext, onchainId: number): Promise<DeployOutcome<ChunkPlan | null>>
export async function confirmWhitelistChunkCore(ctx: WhitelistContext, txHash: Hex, onchainId: number,
  read: StateReader = readCollectionState): Promise<DeployOutcome<WhitelistView>>
// apps/web/src/lib/chain/quota-chunk.ts, pure
export type ChunkProof = { ok: true; pairs: { address: string; quota: number }[] } | { ok: false; error: string }
export function proveQuotaChunk(receipt: PhaseReceipt, input: Hex, expected: { contract: Address; from: string; onchainId: number }): ChunkProof
```

No `server-only` marker, as `phases-core.ts`, so `verify:whitelist` imports it. `whitelistViewCore` runs
`phasesViewCore(ctx, read)` (its refusal, its refresh of the copies, its copy when the chain does not answer), then
reads under the creator's client the group ids and each named whitelist group's entries through `readAll` in pages of
1,000 by `wallet_address`, joined with `listOf`. `nextChunkCore` refuses `NOT_DEPLOYED` (`phaseBase`, now exported)
and `NAME_FIRST` for a group without a row, reads the entries the same way and answers `chunkPlanOf`.

The confirm: `phaseBase` (`NOT_DEPLOYED`); `publicClientFor` (`CHAIN_NOT_READY` when it throws);
`getTransactionReceipt` (not found: `WHITELIST_NOT_CONFIRMED`, which the machine polls; reverted: `PHASE_REVERTED`);
`getTransaction` (not found: `WHITELIST_NOT_CONFIRMED`); `proveQuotaChunk`; `whitelist_chunk_record` through
`ctx.service()` with `p_owner: ctx.owner`; then `whitelistViewCore` with the reader bound to the receipt's block.
`proveQuotaChunk` checks `to` (`NOT_THIS_CONTRACT`) and `from` (`NOT_FROM_WALLET`) first, as `matchPhaseEvent` does,
then refuses `NOT_THIS_CHANGE` for a failed status, an input the collection ABI does not decode, a function other than
`setMintQuota`, another group, a quota above 10,000 (Cobweb never sends one), or no `MintQuotasAdded(onchainId, n)`
found by `matchPhaseEvent`, `n` being the decoded count. Pairs are lowercased, a repeat keeping its last quota.

### 6.3 The list edits and the usage read

```ts
export async function addEntriesCore(ctx: WhitelistContext, onchainId: number, rows: ChunkEntry[]): Promise<DeployOutcome<{ added: number; updated: number }>>
export async function setEntryQuotaCore(ctx: WhitelistContext, onchainId: number, address: Address, quota: number): Promise<DeployOutcome<undefined>>
export async function setQuotaForAllCore(ctx: WhitelistContext, onchainId: number, quota: number): Promise<DeployOutcome<{ changed: number }>>
export async function removeEntryCore(ctx: WhitelistContext, onchainId: number, address: Address): Promise<DeployOutcome<{ staged: boolean }>>
export async function quotaUsageCore(ctx: WhitelistContext, onchainId: number, addresses: Address[]): Promise<DeployOutcome<(number | null)[]>>
// apps/web/src/lib/chain/read-each.ts
export async function readEach<T>(client: PublicClient, calls: readonly ContractFunctionParameters[], options?: { blockNumber?: bigint }): Promise<(T | null)[]>
```

The edits run under the creator's client after `NOT_DEPLOYED` and `NAME_FIRST`. `addEntriesCore` reads the group's
addresses, refuses `WHITELIST_FULL` when the new ones would pass 10,000 (nothing written), then sends pages of 1,000
rows to `whitelist_entries_add` in turn and sums the answers (a page refused after others landed answers its sentence,
and the screen reads the view again). `setEntryQuotaCore` sends one row, so it also restores a deleted row (Undo).
`setQuotaForAllCore` sets `quota` on the rows above 0 that differ, counting them. `removeEntryCore` deletes a row
whose `written_quota` is null or 0 (`staged: false`), else sets its quota to 0 (`staged: true`). `quotaUsageCore`
reads `quotaClaimed(onchainId, address)` through `readEach`, all null when the chain does not answer. `readEach`
answers a value per call, null where it reverted: where viem's chain has `multicall3`, groups of 500 as one
`multicall` (`allowFailure: true`, `batchSize: 0`); otherwise (Anvil) groups of 50 parallel `readContract` calls;
groups run in turn, and a request failing as a whole throws.

### 6.4 The holder snapshot

```ts
// apps/web/src/lib/manage/holders.ts, pure
export type Holder = { address: Address; balance: number }
export type HolderSnapshot = { holders: Holder[]; block: number; supply: number }
export const SNAPSHOT_MAX_SUPPLY = 20_000
export function holdersOf(owners: readonly (string | null)[]): Holder[]
// apps/web/src/lib/manage/snapshot-core.ts and apps/web/src/app/actions/snapshot.ts
const erc165Abi = parseAbi(['function supportsInterface(bytes4 interfaceId) view returns (bool)'])
export function snapshotChains(): number[]
export async function fetchHoldersCore(chainId: number, contract: Address): Promise<{ data: HolderSnapshot } | { refused: string }>
export async function fetchHolders(collectionId: string, chainId: number, contract: string): Promise<ActionResult<HolderSnapshot>>
```

`snapshotChains()` lists the ids of `availableChains()` whose `RPC_URL_<id>` is set. `fetchHoldersCore` refuses
`SNAPSHOT_CHAIN` for a chain not listed, then reads on one client at the latest block (`cacheTime: 0`): `getCode`
(`NOT_A_CONTRACT(chain)` when empty), `supportsInterface(0x80ac58cd)` through `erc165Abi` (`NOT_ERC721(chain)` when
false or reverting), then through viem's `erc721Abi` `totalSupply()` (`NO_TOTAL_SUPPLY` when reverting;
`SNAPSHOT_TOO_LARGE` above 20,000) and `ownerOf` for ids 0 to the supply through `readEach`, so collections starting
at 0 or 1 are both read and a burned id is skipped. `holdersOf`
leaves out failed reads, the zero address and `0x000000000000000000000000000000000000dEaD`, sums balances per owner,
checksums, and sorts by balance, then lowercase address; `NO_HOLDERS` when none is left. A thrown read is logged with
`errorSummary` and answers `SNAPSHOT_FAILED`. The action parses `snapshotShape`, runs `ownedCollection`, then the
core; the Whitelist and Airdrop pages export `maxDuration = 300` for it.

### 6.5 The actions (`apps/web/src/app/actions/whitelist.ts`) and their shapes

```ts
export async function getWhitelist(collectionId: string): Promise<ActionResult<WhitelistView>>
export async function nextChunk(collectionId: string, onchainId: number): Promise<ActionResult<ChunkPlan | null>>
export async function confirmWhitelistChunk(collectionId: string, txHash: string, onchainId: number): Promise<ActionResult<WhitelistView>>
export async function addEntries(collectionId: string, onchainId: number, rows: { address: string; quota: number }[]): Promise<ActionResult<{ added: number; updated: number }>>
export async function setEntryQuota(collectionId: string, onchainId: number, address: string, quota: number): Promise<ActionResult>
export async function setQuotaForAll(collectionId: string, onchainId: number, quota: number): Promise<ActionResult<{ changed: number }>>
export async function removeEntry(collectionId: string, onchainId: number, address: string): Promise<ActionResult<{ staged: boolean }>>
export async function quotaUsage(collectionId: string, onchainId: number, addresses: string[]): Promise<ActionResult<(number | null)[]>>
// apps/web/src/lib/manage/whitelist-schemas.ts
export const groupIdShape = onchainIdShape.min(1, WRONG_GROUP)
export const quotaShape = z.number({ error: QUOTA_RANGE }).int(QUOTA_RANGE).min(1, QUOTA_RANGE).max(QUOTA_MAX, QUOTA_RANGE)
export const addressShape: z.ZodType<Address>          // valid (mixed case must pass its checksum), not zero, checksummed
export const addEntriesShape: z.ZodType<ChunkEntry[]>  // 1 to 10,000 rows (more is WHITELIST_FULL), repeats merged, last quota wins
export const usageShape: z.ZodType<Address[]>          // 1 to 25 addresses
export const snapshotShape: z.ZodType<{ chainId: number; contract: Address }>
```

Each action parses its input first (a malformed value is `UNSAVED` unless a sentence is named; the zero address is
`ZERO_ADDRESS`), then runs through `phasesWrite(collectionId, run, whitelistWriteError)`, which checks the session and
ownership and gains that third parameter (default `phasesWriteError`). `getWhitelist` reads the chain through
`readOnce`, as `getPhases` does; the hash goes through `lock-schemas`' `txHash`; the cores lowercase addresses for the
database. `snapshotChains()` is a plain server function the pages call.

### 6.6 Sentences (`apps/web/src/lib/art/result.ts`, a Whitelist block) and errors

```ts
export const WHITELIST_FULL = 'A whitelist holds up to 10,000 addresses.'   // the database raises these three as they are
export const QUOTA_RANGE = 'The quota must be 1 to 10,000.'
export const WRONG_GROUP = 'The public sale has no whitelist.'
export const ZERO_ADDRESS = 'The zero address cannot mint or receive tokens.'
export const WHITELIST_NOT_CONFIRMED = 'The chunk has not been confirmed on chain yet.'
export const WHITELIST_TIMED_OUT = 'The chunk is not confirmed yet. Check again in a minute; sending it again is safe.'
export const NOT_A_CONTRACT = (chain: string) => `There is no contract at this address on ${chain}.`
export const NOT_ERC721 = (chain: string) => `This address is not an ERC-721 contract on ${chain}.`
export const NO_TOTAL_SUPPLY = 'This contract does not report its total supply.'
export const SNAPSHOT_TOO_LARGE = 'Snapshots cover collections up to 20,000 tokens for now.'
export const NO_HOLDERS = 'No holders found. Check the address and the chain.'
export const SNAPSHOT_CHAIN = 'Cobweb cannot read this chain yet. Choose another chain.'
export const SNAPSHOT_FAILED = 'The snapshot could not be taken. Try again in a moment.'
export function whitelistWriteError(error: DbError): string   // apps/web/src/lib/art/db-error.ts
```

`whitelistWriteError` maps `42501` 'phase not found' to `NAME_FIRST` and any other `42501` to `NOT_FOUND`, a `23514`
carrying `NOT_DEPLOYED`, `WHITELIST_FULL`, `QUOTA_RANGE` or `WRONG_GROUP` to itself, anything else to `UNSAVED`.
`revertSentence` (`tx-errors.ts`) gains these, each followed by "Nothing was sent." and counts with separators:

```
ArrayLengthMismatch()                 The addresses and quotas do not line up. Reload and try again.
PublicGroupHasNoQuota()               The public sale has no whitelist.
NotInWhitelist(caller, mintGroup)     <caller> is not on the whitelist of phase <mintGroup>.
ExceedsMintQuota(requested, allowed)  This wallet can mint <allowed> more in this phase, not <requested>.
```

## 7. The screens

### 7.1 The calls and the machine

```ts
// apps/web/src/lib/manage/phase-calls.ts
export type ManageFunction = 'registerMintGroup' | 'setMintGroupStatus' | 'scheduleMintGroupStart' | 'changeSalePrice'
  | 'setMintGroupMaxSupply' | 'setPublicMaxMintPerWallet' | 'stopOrStartAllMintGroups' | 'setMintQuota'
export type SentCall = { functionName: ManageFunction; args: (string | boolean | string[])[] }
export type ExpectedEvent = /* the seven Phases events */
  | { eventName: 'MintQuotasAdded'; args: { mintGroup: bigint; numberOfAddresses: bigint } }
phaseCalls.quotas(id: number, addresses: Address[], quotas: number[]): ManageCall  // setMintQuota(addresses, id, quotas)
// apps/web/src/components/manage/manage-machine.ts
export function rememberChunk(store: KeyStore | null, collectionId: string, sent: SentChunk): void
export function sentChunk(store: KeyStore | null, collectionId: string): SentChunk | null
export function forgetChunk(store: KeyStore | null, collectionId: string): void
```

`expectedEvent` answers `MintQuotasAdded(id, addresses.length)`; `sentOf` and `callOf` carry arrays as strings;
`sentCallShape` takes `[string[], string, string[]]`: checksummed addresses, equal lengths, 1 to 500 entries, quotas
as decimal strings of 0 to 10,000. `reviewOf` rows use the ABI's names: `addressesToAdd` "500 addresses" ("1
address"), `mintGroup` "1", `mintQuotas` "500 quotas, 1,240 in total" ("1 quota, 2 in total"). The store's key is
`cobweb-whitelist:<collectionId>`, one chunk per collection; a value without a 32-byte hash and an integer id of 1 or
more reads as none, as for the pending add. `verifyManage` times out on a chunk with `WHITELIST_TIMED_OUT`, and
`ManageRequest.pending` now serves Add phase and the chunk write.

### 7.2 The browser's server and the snapshot source

```ts
// apps/web/src/components/manage/whitelist-server.ts
export type WhitelistServer = {
  read(): Promise<ActionResult<WhitelistView>>; nextChunk(onchainId: number): Promise<ActionResult<ChunkPlan | null>>
  confirmChunk(hash: Hex, onchainId: number): Promise<ActionResult<WhitelistView>>
  addEntries(onchainId: number, rows: ChunkEntry[]): Promise<ActionResult<{ added: number; updated: number }>>
  setEntryQuota(onchainId: number, address: Address, quota: number): Promise<ActionResult>
  setQuotaForAll(onchainId: number, quota: number): Promise<ActionResult<{ changed: number }>>
  removeEntry(onchainId: number, address: Address): Promise<ActionResult<{ staged: boolean }>>
  quotaUsage(onchainId: number, addresses: Address[]): Promise<ActionResult<(number | null)[]>> }
export function whitelistServer(collectionId: string): WhitelistServer
// apps/web/src/components/manage/snapshot-tab.tsx, snapshot-source.ts and snapshot.ts
export type SnapshotSource = { chains: SupportedChain[]; chainId: number; fetch(chainId: number, contract: string): Promise<ActionResult<HolderSnapshot>> }
export function snapshotSource(input: { collectionId: string; sample: boolean; chainIds: number[]; preferred: number }): SnapshotSource | undefined
export async function sampleFetchHolders(chainId: number, contract: string): Promise<ActionResult<HolderSnapshot>>
```

`snapshotSource` answers undefined without a chain (no Snapshot tab), else the chains through `chainView`, the
preferred chain when offered (else the first) and `fetchHolders` bound to the collection, or `sampleFetchHolders`
(`snapshot.ts`'s old seam, renamed). `SnapshotTab` shows a refusal's sentence, or "The snapshot could not be taken.
Try again in a moment." when the call throws; its summary becomes "<N> holders of <0x12..34> on <chain> at block
<block>". `AirdropScreen` gains `snapshotChainIds: number[]` and `sample: boolean` and builds its source (preferred:
its chain); its page passes `snapshotChains()`, or the `SUPPORTED_CHAINS` ids in sample mode.

### 7.3 The page and the screen

- The page (`manage/whitelist/page.tsx`) branches on `ctx.demo` as Phases does: the sample view (`?chain=unreachable`
  for the copy) or `getWhitelist`, a refusal shown by `ManageUnavailable` titled "The whitelist could not be read".
  Its title "Whitelist" and description "Wallet addresses and how many each may mint, per phase. Lists are written
  on-chain in batches." stay; it renders `WhitelistScreen` with `collection`, `view`, `wallet`, `sample`,
  `samplePending` and `snapshotChainIds`, the ids of `snapshotChains()` (the `SUPPORTED_CHAINS` ids in sample mode).
- The screen keeps the view in state under its own `ManageActionsProvider` (`realManageActions` on the view's chain
  and contract with the session wallet, or `sampleManageActions`), with `whitelistServer` or its sample. Under the
  heading: "Read from the chain <relative to readAt>" with "Read again"; while unreachable, an alert "The contract
  could not be read": "The lists below are Cobweb's, with what each chunk wrote. Quota used and minted counts are not
  shown, and chunks wait until the contract can be read." with "Read again".
- Without whitelist groups today's Empty stays ("No whitelist phases", "Add a whitelist phase on the Phases tab, then
  give its addresses a quota here.", "Go to phases"); tabs show for two groups or more, with today's dot; an unnamed
  group's tab is an Empty, "Group N is not named. Name it on the Phases tab to add its whitelist.", "Go to phases".
- A remembered chunk shows above the tabs (`PendingChunkPanel`): "A chunk is waiting to be confirmed", "This browser
  sent a chunk of the <group> whitelist. Cobweb marks its addresses written once the receipt and the transaction show
  them on the contract.", the transaction link, "Check again" (the machine from verifying, its step "Reading the
  chunk", "Cobweb checks the receipt and the addresses the transaction carried, then reads the contract again.", the
  toast "The chunk is on chain"; a terminal refusal is toasted and forgets the chunk) and "Discard". Meanwhile the
  write buttons are off with "Confirm or discard the waiting chunk first."
- A named group shows its name, the status badge from `active` (none while unreachable), and Addresses (`total`),
  Total quota, Quota used ("Not read" while unreachable) and Phase supply with today's hint "Less than the quota
  issued: first come, first served."
- The On-chain write panel keeps its title and "Addresses can mint only after their chunk is written.", then "<W> of
  <M> chunks written", "<N> addresses wait for a chunk. Until it is written, the chain keeps the quota it had, or
  none." ("1 address waits for a chunk.", then the same) or "Every address is on chain.", and "Up to 500 addresses go
  in each transaction." "Write chunk N of M" ("Retry chunk N" after a failure in this visit) asks `server.nextChunk`
  and opens the dialog, off while unreachable with `UNREADABLE_REASON` ("The contract could not be read, so changes on
  chain wait until it can be."); a null plan toasts "Every address is on chain." and reads again. `chunkRows` draws
  "Written" with the transaction link (the hash as text without an explorer), then "Next" or "Failed" with its error,
  then "Waiting".
- The table keeps its search, All or "Not written <N>" (`unwritten`), 25 per page and its columns; On chain reads
  "Written", "Not written" (with "<n> on chain" beneath when an earlier quota was written) or "Removal not written"
  with "Keep" (back to `writtenQuota`). Minted and Left come from `quotaUsage` through React Query (key
  `['whitelist-minted', collectionId, onchainId, ...addresses]`, stale after 30 seconds, off while unreachable,
  invalidated by a confirmed chunk or "Read again"); until it answers, Minted reads "Not read" and Left is blank.
- Edits apply a model patch once the action answers, and toast: "Quota saved. Write the next chunk to put it on
  chain." (or "Quota saved." when it reads written again); "Removal staged. Write the next chunk to apply it." or
  "Address removed." with Undo (`setEntryQuota` with the old quota); "<N> quotas changed. Write the next chunk to put
  them on chain." ("1 quota changed. Write the next chunk to put it on chain.") or "Every address already has that
  quota."; "<added> added, <updated> updated. Write the next chunk to put them on chain." (", <updated> updated" only
  above 0) or "Every address was already listed with that quota." A refusal toasts its sentence and the list stays.
  Export CSV writes `<group slug>-whitelist.csv` with `address, quota, minted, on_chain`, minted as read or blank.

> **15 October 2026:** Two sentences changed after the browser walk: with no address at all the chunk panel reads "No addresses yet." instead of "Every address is on chain.", and "Keep" on a staged removal toasts "Quota saved." like the quota edit it is. Minted still reads "Not read" until a page's read answers, as written above.

### 7.4 The local model and the dialogs

```ts
// apps/web/src/components/manage/whitelist-model.ts, rewritten
export type EntryState = 'written' | 'pending' | 'removing'
export function entryState(entry: ListEntry): EntryState
export function withAdded(list: GroupList, rows: ChunkEntry[]): GroupList
export function withQuota(list: GroupList, address: Address, quota: number): GroupList
export function withQuotaForAll(list: GroupList, quota: number): GroupList
export function withRemoved(list: GroupList, address: Address): GroupList
export function withRestored(list: GroupList, entry: ListEntry): GroupList
export type ChunkRow = { number: number; addresses: number; status: 'written' | 'next' | 'failed' | 'waiting'; txHash?: Hex; error?: string }
export function chunkRows(list: GroupList, size: number, failure: string | null): ChunkRow[]
// apps/web/src/components/manage/whitelist-dialogs.tsx
export function chunkRequest(plan: ChunkPlan, chain: SupportedChain, confirm: (hash: Hex) => Promise<ActionResult<WhitelistView>>,
  pending: { remember(hash: Hex): void; forget(): void }): ManageRequest<WhitelistView>
export function WriteChunkDialog(props: { open: boolean; onOpenChange(open: boolean): void; chain: SupportedChain; group: MintGroup;
  plan: ChunkPlan; retry: boolean; request: ManageRequest<WhitelistView>; onConfirmed(view: WhitelistView): void; onFailed(message: string): void }): React.JSX.Element
export function AddAddressesDialog(props: { open: boolean; onOpenChange(open: boolean): void; group: MintGroup; existing: Set<string>;
  snapshot: SnapshotSource | undefined; onAdd(rows: Recipient[]): Promise<string | null> }): React.JSX.Element
export function QuotaForAllDialog(props: { open: boolean; onOpenChange(open: boolean): void; total: number; onApply(quota: number): Promise<string | null> }): React.JSX.Element
// whitelist-screen.tsx, whitelist-chunks.tsx and whitelist-table.tsx
export type WhitelistScreenProps = { collection: Tables<'collections'>; view: WhitelistView; wallet: Address; sample: boolean;
  samplePending?: boolean; snapshotChainIds: number[] }
export function PendingChunkPanel(props: { sent: SentChunk; group: MintGroup | undefined; chain: SupportedChain; server: WhitelistServer;
  onView(view: WhitelistView): void; onForget(): void }): React.JSX.Element
export function WhitelistChunks(props: { rows: ChunkRow[]; list: GroupList; chain: SupportedChain; write: { label: string; off: string | null;
  busy: boolean } | null; onWrite(): void }): React.JSX.Element
export function WhitelistTable(props: { entries: ListEntry[]; usage: { key: readonly unknown[]; on: boolean; read(addresses: Address[]): Promise<(number | null)[]> };
  onQuota(address: Address, quota: number): void; onRemove(address: Address): void; onRestore(entry: ListEntry): void; toolbar?: React.ReactNode }): React.JSX.Element
```

Each patch recounts through `listOf` and mirrors section 4.2 (`withAdded` keeps lowercase address order,
`withQuotaForAll` leaves removals at 0, `withRemoved` deletes a never-written entry and stages a 0 otherwise).
`chunkRequest` builds `phaseCalls.quotas` from the plan, with the review
`{ contract: 'Collection', functionName: 'setMintQuota', args: reviewOf(call, chain) }`. `WriteChunkDialog` keeps
"Write chunk N of M", "Sets the quota of N addresses in <group>. Sending a chunk twice is safe: quota already used is
never granted again.", "Write chunk" or "Retry chunk", "Chunk N is on chain" and "N addresses are removed by setting
the quota to 0." ("1 address is removed by setting the quota to 0."). The add and quota dialogs keep their copy, wait
for the action ("Adding <N> addresses" with a spinner), show a refusal under the form and close on success; the add
dialog's button is off with "A whitelist holds up to 10,000 addresses. This one has room for <N> more." when the rows
would pass the cap. `parseRecipients` refuses the zero address with `ZERO_ADDRESS` and its line number.

## 8. Sample mode

```ts
// apps/web/src/components/manage/whitelist-sim.ts
export function sampleWhitelistView(collection: { max_supply: number | null }, chainReachable?: boolean): WhitelistView
export function sampleApplyQuotas(call: ManageCall, view: WhitelistView, hash: Hex): WhitelistView
export function sampleWhitelistServer(current: () => WhitelistView, sent?: Map<Hex, ManageCall>): WhitelistServer
export function sampleSentChunk(view: WhitelistView): SentChunk | null
```

`sampleWhitelistView` takes the whitelist groups of `samplePhasesView(collection, chainReachable)` (scaled as Phases
scales them) and `DEMO_WHITELISTS` in address order, an entry in a written sample chunk carrying its quota and that
chunk's `sampleTxHash`: the Owl List shows 500 written and 120 waiting, Team is written. `sampleApplyQuotas` writes a
call's pairs as `whitelist_chunk_record` does; `sampleApply` lists `setMintQuota` and changes no group (a `PhasesView`
holds no quotas); `sampleRevert` refuses unequal lengths, the public sale and an unknown group. The server answers
after 900 ms: `confirmChunk` applies the call the simulated wallet sent with that hash, or the group's next chunk for
a hash it never sent; `quotaUsage` answers `DEMO_WHITELISTS`' `minted` (0 for an address added in the visit, null
while unreachable); the edits answer the counts the screen's patches produce. The actions are
`sampleManageActions(() => samplePhasesView(collection), sent)`; `sampleFetchHolders` waits 900 ms and answers today's
24 holders at block 21500000, their total as the supply. New states: `?chunk=pending` (the panel, from
`sampleSentChunk`) and `?chain=unreachable`.

## 9. Stage rules

Unchanged: Manage drop opens once the collection is deployed, and in sample mode before. The Whitelist page branches
on `ctx.demo` as Phases does; the Airdrop page branches only for the snapshot's chains and fetch.

## 10. Testing

- Unit tests change in `phase-calls`, `phase-schemas`, `manage-machine` (polling to `WHITELIST_TIMED_OUT`, the chunk
  store), `manage-sim`, `tx-errors`, `recipients`, `snapshot` and the shared `collection` tests. New:
  `quota-chunk.test.ts` (pairs from `encodeFunctionData`, a repeat's last quota, each refusal of 6.2),
  `read-each.test.ts` (a fake client: multicall groups of 500 with a reverted read as null, groups of 50 without
  multicall3, a failed request thrown), `whitelist-view.test.ts` (counts with a staged removal, the next chunk with a
  removal as 0, chunks in `written_at` order), `whitelist-schemas.test.ts`, `holders.test.ts`,
  `whitelist-model.test.ts` and `whitelist-sim.test.ts`.
- `verify:local`, 326 plus 16 (342), in a section 9l on a collection recorded as deployed as 9k records one; "quota 0
  rejected" becomes "a negative quota is refused". New: quota 0 accepted; an owner insert carrying a copy refused; the
  owner updates `quota` and is refused the copies, `wallet_address` and `mint_group_id`; a negative, malformed or
  partial copy refused; `whitelist_entries_add` refusing a signed-out caller, a draft, B on A's group, a quota of 0 or
  10,001, the public sale and the 10,001st address (nothing kept), and answering its counts; `whitelist_chunk_record`
  refusing the owner's session, a signed-out caller, a draft, another owner, an unknown group and a malformed hash,
  writing the copies, creating a missing row, deleting a written zero's row (an unlisted zero creates nothing), and
  answering 0 for the same hash twice.
- `verify:whitelist` (new, `scripts/verify-whitelist.ts` on `deploy-fixture.ts`, run as `verify:phases` is;
  `removeFixtures` also checks that no `whitelist_entries` row is left); chunks are built with `phaseCalls.quotas`
  from `nextChunkCore`, simulated as wagmi does and sent from the creator's key: (1) the chain is ready; (2) Public
  (free, 1) and Holders (0.001 ETH, 2) read Holders named and empty; (3) 1,100 addresses, the stranger's among them,
  added in two pages answer 1,100 added, Set quota for all to 2 answers what it changed, 20 others re-added at 1 answer
  20 updated; (4) 8,901 more are refused (`WHITELIST_FULL`, nothing written), the zero address by the shape; (5)
  `nextChunkCore` answers chunk 1 of 3, the first 500 lowercase addresses; (6) three chunks confirmed leave written at
  500, 1,000 and 1,100, each copy equal to its quota with its chunk's hash, chunks of 500, 500 and 100, no next chunk;
  (7) `mintQuotas(1, address)` equals the listed quota for the first, 500th, 501st and last address and the stranger;
  (8) chunk 2 confirmed again answers the same counts, its record 0, `written_at` kept; (9) a quota raised to 3
  re-queues only that address, then `mintQuotas` reads 3; (10) a written address removed is staged at 0, written, its
  row deleted and `mintQuotas` 0, while a new one removed is deleted at once and Undo puts it back; (11) with Holders
  open, `quotaUsageCore` reads 0 for the stranger, then 1 once the stranger mints one, and `quotaUsed` 1; (12)
  refusals recording nothing: the stranger's mint (`NOT_FROM_WALLET`), the Open hash and chunk 3 for group 2
  (`NOT_THIS_CHANGE`), a chunk to another collection (`NOT_THIS_CONTRACT`); (13) a stranger's session reads no
  entries, its view and add refused `NOT_DEPLOYED`, its raw add `42501`; (14) a chunk sent outside the flow for an
  unlisted address at 5 creates that row written at 5; (15) after the creator opens Public and mints one,
  `fetchHoldersCore(31337, contract)` answers the creator and the stranger with one token each, supply 2, at a block
  no earlier than the mint's; (16) the stranger's address (`NOT_A_CONTRACT('Anvil')`), the factory
  (`NOT_ERC721('Anvil')`) and chain 999 (`SNAPSHOT_CHAIN`) refused; (17) `whitelistViewCore(ctx, async () => null)`
  answers the same lists, `chainReachable` false; (18) cleanup.
- `pnpm typecheck && pnpm lint && pnpm test`, `pnpm build`, every verify script.
- A browser walk with the dev wallet on local Supabase and Anvil: a 2,000-line CSV with a header, a repeat, a bad
  checksum and the zero address previews its rejections and adds 2,000; Paste and Add one; "Write chunk 1 of 4"
  reviews "500 addresses" and "500 quotas, <N> in total" through the five steps; a rejection, then "Retry chunk 2"; a
  reload mid-confirm, the waiting panel, "Check again" and "Discard"; all four chunks; a quota edit, a written and a
  new removal with Undo, Set quota for all, Export CSV; another wallet's mint in Quota used and Minted; snapshots of
  the collection, a wallet, the factory and a chain without an RPC; Anvil stopped (the alert, "Not read", writes off,
  an edit saved); an unnamed group; Airdrop's real snapshot; sample mode's states.

## 11. Documentation

- `docs/MASTER_PLAN.md`: the Phase 5 status line records Whitelist (third of four) with this spec, what exists (the
  migration and its two functions, `setMintQuota` in the manage calls, chunks built by the server and proven from the
  receipt and calldata, the pending chunk, Minted per page, the snapshot shared with Airdrop, `verify:whitelist` with
  18 checks), airdrop and settings left, and section 12's items; its "the Whitelist, Airdrop and Settings dialogs run
  on the sample actions" becomes "the Airdrop and Settings dialogs".
- Dated notes: in [2026-10-03-creator-flow-ui.md](2026-10-03-creator-flow-ui.md) section 4.6, after the Phases note,
  what changed (no chunk table, the copies per entry, the server's next chunk, the calldata proof, the pending chunk,
  Minted per page, the snapshot as a server action: ERC-721 with ERC-165, one block, at most 20,000 tokens, the
  chains with an RPC, also behind Airdrop's input); in the Phases spec's section 12, closing "The Whitelist tab (the
  next sub-project), Airdrop and Settings still run on sample data" for the Whitelist, with a link here.
- `CLAUDE.md`: `verify:whitelist` after `verify:phases`, described as the list, each chunk sent and confirmed from
  its receipt and calldata, the refusals and the snapshot, against local Supabase and Anvil.

## 12. Owed and known

- The mint page (Phase 6) reads eligibility from `walletState` through the freshness server; `whitelist_entries`
  stays dashboard-only (anon reads nothing). A quota set outside Cobweb is known only once confirmed through Cobweb.
- 500 fresh entries cost about 11M gas, under the 16,777,216 per-transaction cap where one applies; per-chain chunk
  sizes stay out, and Monad and Berachain are measured on testnet before launch.
- Records are not ordered by block: "Check again" on an older hash in a second tab, after a later chunk rewrote the
  address, writes the older copy back until the next chunk (and reads written if the listed quota equals it). A
  chunk's count is the rows that still name it. A removal while its chunk is in flight comes back with the written
  quota, and is removed again with a zero; a discarded chunk that landed is sent again (gas only); a replaced
  transaction is never matched, as in Phases.
- The 10,000 cap is the actions' and `whitelist_entries_add`'s; the owner's direct insert grant is not capped.
- The snapshot reads ERC-721 contracts that answer ERC-165, up to 20,000 tokens, ids 0 to `totalSupply` (holders of
  ids above it, after burns, are missed), on chains with `RPC_URL_<id>` (the private endpoint); no ERC-1155 and no
  rate limit (Phase 7 alerts on RPC errors).
- The page ships every entry, up to 10,000 per group; the export's minted column carries only the pages read in the
  visit. The Airdrop and Settings dialogs keep `sampleRequest` until the fourth sub-project.

> **15 October 2026, at landing:** The chunk confirm now waits for the chain's confirmation depth (`confirmationsFor`, as the deploy confirm does) before `whitelist_chunk_record` writes the copies, since nothing reads them from the chain again; until then it answers "not confirmed yet" and the machine keeps polling. Known, for production hardening: Next runs a tab's server actions one at a time, so a holder snapshot (up to 300 seconds) holds up that tab's other Whitelist actions, the chunk confirm's polls and the Minted reads included; once a group holds more than 10,000 rows (chunks sent outside Cobweb, or the owner's direct insert), every one-row quota change is refused as a full whitelist, because `whitelist_entries_add` counts the whole group rather than the rows the call added; the table allows any quota of 0 or more, so the owner's direct grant can set a quota above 10,000 and the proof then refuses that group's chunk on every retry, each costing gas (a `between 0 and 10000` check would stop it); the snapshot says nothing when it read fewer owners than `totalSupply()` (burned tokens, offset or sparse ids); the confirm's reverted branch has no automated check; a record of an older chunk through "Check again" can write an older copy back until the next chunk; on a chain without multicall3 (Anvil only) an RPC internal error reads as a revert on the parallel read path; a CSV upload landing within about a millisecond of a snapshot can be replaced by it.

> **16 October 2026:** `sampleRequest` is gone: the Airdrop and Settings dialogs run on the manage actions ([2026-10-15-airdrop-settings.md](2026-10-15-airdrop-settings.md)), and Airdrop's holder snapshot now feeds real batches.

## 13. Acceptance criteria

- [x] The migration applies and `verify:local` passes (342); the owner's client writes the list and never a copy,
      which comes only from `whitelist_chunk_record` after a receipt and its calldata prove the chunk.
- [x] Every chunk is the first 500 entries not written in address order, built by the server, simulated and sent from
      the session wallet by the manage machine and confirmed by the server; a lost receipt is recovered with "Check
      again" and a failed chunk is retried.
- [x] Edits and removals are staged and written by the next chunk (a written zero deletes its row, an unwritten
      removal goes at once); quota used and Minted come from the chain; with the chain down the lists still edit.
- [x] The holder snapshot is a server action at one block, refusing what is not an ERC-721 and more than 20,000
      tokens; Whitelist and Airdrop both use it.
- [x] `verify:whitelist` passes; `verify:phases` and `verify:deploy` still pass.
- [x] Sample mode renders every state; the browser walk, with a 2,000-address whitelist written in four chunks, is
      recorded in this spec's landing note.

Checked on 15 October 2026 on local Supabase, local storage and Anvil: the root checks pass (typecheck, lint, format check; tests shared 72, web 587, worker 282, render 117, dna 60), the build passes, and verify:local reads 342 (326 plus 16), verify:chain 12, verify:storage 15, verify:sweep 8, verify:render 22, verify:deploy 15, verify:phases 20 and verify:whitelist 18, each with 0 failed. Browser walk (Playwright with the dev wallet 0xD2Ea...b516, code at 30fa64e): a fresh collection "Whitelist Walk 1" (6 tokens, locked, paid 0.00015 ETH, rendered by render:local, link whitelist-walk-1) deployed with Public (0 ETH, 2) and Holders (whitelist, group 1, 0 ETH, 4) at 0x42Eaa4b1...de01413E; (1) Whitelist read "Read from the chain under a minute ago" with "Read again", Holders Closed with Addresses 0, Total quota 0, Quota used 0, Phase supply 4 and "No addresses yet. Add them from a CSV, by pasting, or one at a time."; (2) Upload CSV with the 2,004-line file previewed Valid 2,000, Total quota 3,999, Rejected 2, "The first line was read as a header and skipped. 1 repeated address was merged.", line 2003 "The checksum does not match. Check the address for a typo." and line 2004 "The zero address cannot mint or receive tokens."; "Add 2,000 addresses" showed "Adding 2,000 addresses" with a spinner, the dialog closed and the toast read "2,000 added. Write the next chunk to put them on chain."; the panel "0 of 4 chunks written", "2,000 addresses wait for a chunk. Until it is written, the chain keeps the quota it had, or none." and "Write chunk 1 of 4"; (3) Paste of two listed addresses at new quotas toasted "0 added, 2 updated. Write the next chunk to put them on chain." and Add one of a listed address "0 added, 1 updated. ..."; the list stayed at 2,000; (4) "Write chunk 1 of 4" reviewed addressesToAdd "500 addresses", mintGroup "1" and mintQuotas "500 quotas, 1,010 in total", ran Checking the change, Confirm in your wallet, Confirming on Anvil and Reading the contract to "Transaction confirmed. Chunk 1 is on chain"; the panel "1 of 4 chunks written" with chunk 1 Written and its hash as text (0x86e7e9f6...); (5) chunk 2 rejected in the wallet read "Cancelled in your wallet / Nothing was sent and no gas was spent. Try again when you are ready.", the panel marked chunk 2 Failed with that sentence and "Retry chunk 2", and the retry wrote it (0xa2b9df19..., toast "Chunk 2 is on chain"); (6) chunk 3 with a reload at "Confirming on Anvil": the panel "A chunk is waiting to be confirmed / This browser sent a chunk of the Holders whitelist..." with the hash (0x8b7509d6...), "Check again" and "Discard", the write button off with "Confirm or discard the waiting chunk first."; "Check again" toasted "The chunk is on chain" and cleared the entry (the server had already recorded the chunk, so the second confirm answered the view again); the hash planted again and "Discard" removed the panel at once; (7) chunk 4 (0x3ad51784...) gave "4 of 4 chunks written", "Every address is on chain." and Not written 0; (8) a quota edit toasted "Quota saved. Write the next chunk to put it on chain." and the row read "Not written" with "2 on chain" beneath, setting it back read "Quota saved." and Written again; removing a written address toasted "Removal staged. Write the next chunk to apply it." with Undo, the row "Removal not written" with Keep, and Keep put it back; an address added since the last chunk removed with "Address removed." and Undo put it back; Set quota for all (2) toasted "1,334 quotas changed. Write the next chunk to put them on chain."; the three chunks the edits needed wrote (500, 500 and 334 addresses, "334 quotas, 668 in total"), after which the earlier chunks recounted to the entries still naming them (160, 159, 181, 167); Export CSV saved holders-whitelist.csv with address,quota,minted,on_chain and minted filled for the 26 rows read; (9) Anvil's first account listed at 2 and written in a one-address chunk ("1 address", "1 quota, 2 in total"), Holders opened on Phases, one token minted from that account with cast: Quota used read 1 and the account's row Minted 1, Left 1; (10) snapshots in Add addresses: the chain menu offered Anvil only, the collection's own contract added its holder with "Added 1 holders of 0x42ea...413e on Anvil at block 331. Review them below before you continue.", a wallet address read "There is no contract at this address on Anvil." and the factory "This address is not an ERC-721 contract on Anvil."; (11) Anvil stopped and Whitelist reloaded in 3.1 s: the alert "The contract could not be read / The lists below are Cobweb's, with what each chunk wrote. Quota used and minted counts are not shown, and chunks wait until the contract can be read." with "Read again", no status badge, Quota used and Minted "Not read", a quota edit still saved and the write button it created was off with "The contract could not be read, so changes on chain wait until it can be."; (12) a group registered outside Cobweb showed as a "Group 2" tab with the Empty "Not named yet / Group 2 is not named. Name it on the Phases tab to add its whitelist." and "Go to phases"; (13) Airdrop's Snapshot tab read the collection's holder on Anvil at block 332 with the same note; (14) sample mode: the Owl List with "1 of 2 chunks written" and 120 addresses waiting, Team written, Minted from the sample's counts, "Write chunk 2 of 2" on the simulated wallet (Reject "Cancelled in your wallet" and "Retry chunk 2"; "Approve, then revert" "The change failed on chain"; Approve "Chunk 2 is on chain"), the Snapshot tab's 24 holders at block 21500000, ?chain=unreachable with the alert and "Not read", ?chunk=pending with the waiting panel whose "Check again" wrote the Owl List's next chunk, and Airdrop's Snapshot tab answering the sample's holders. Defects found, none blocking: the snapshot note's "1 holders" for a single holder, the empty list's panel reading "Every address is on chain.", no toast on Keep, and Minted reading "Not read" while its read is in flight; the first three were fixed in a6aa23d (the final fix wave, which also made the chunk confirm wait for the chain's confirmation depth, made the remove patch follow the server's staged answer, and sorted each add page by address), and the fourth is the wording section 7.3 prescribes. The code walked was 30fa64e; the fix commit was checked by typecheck, lint, the tests (web 588), the build and verify:whitelist (18) before it landed.
