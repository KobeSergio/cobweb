# Airdrop and Settings: specification

Phase 5, fourth sub-project of four (deploy; phases; whitelist and holder snapshot; airdrop and settings). Product
decisions: [../MASTER_PLAN.md](../MASTER_PLAN.md#decisions) (Contracts: burn, mint on behalf, single asset `tokenURI`,
royalty per collection; the Lock section; Flow: pre-reveal) and the Phase 5 bullet "Manage: reveal, airdrop with fee,
burn, phase edits, withdraw, lock, and changing the transfer validator address in Settings." The sample screens:
[2026-10-03-creator-flow-ui.md](2026-10-03-creator-flow-ui.md) sections 4.6 and 7 and its audit's Airdrop and Settings
tables (section 13). The contract: `contracts/src/CobwebCollection.sol` (`airdropNFTs`, `withdrawMintFunds`,
`setOwnerPayoutAddress`, `setDefaultRoyalty`, `setBaseURI`, `setMintOnBehalfStatus`, and the views, events and errors
named below) and the pinned creator-token-standards at 980a63b (`setTransferValidator`, `getTransferValidator`, and the
validator's `setTransferSecurityLevelOfCollection` and `getCollectionSecurityPolicy`). What the earlier sub-projects
left: [2026-10-15-phases.md](2026-10-15-phases.md) sections 7.3, 7.5 and 12 and
[2026-10-15-whitelist.md](2026-10-15-whitelist.md) sections 7.2 and 12. Legacy:
[../legacy/market-creator-flow.md](../legacy/market-creator-flow.md) section 6.7 (oracle quotes with slippage, batches
of 500, ids from `topics[3]`, `airdrop_history`) and [../legacy/contracts.md](../legacy/contracts.md) sections 3.8 to
3.12.

## 1. Goal

A creator with a deployed collection airdrops and burns tokens and runs the contract's settings from Manage drop, on
the contract's state. Airdrop parses a list in the browser, freezes it into batches of at most 500 wallets and 1,000
tokens, and sends each batch as one `airdropNFTs` from the creator's wallet through the manage machine, with the
contract's airdrop fee for its tokens as the value; the server proves each batch from its receipt and calldata at the
chain's confirmation depth and records it, so History lists what landed through Cobweb with its token ids and fee.
Settings reads the balances, the payout address, the royalty, the base URI, mint on behalf, the transfer validator and
its level from the chain at one block; every change is a transaction from the creator's wallet confirmed from its
receipt, and Cobweb keeps copies of what it last read for when the chain does not answer. The Overview's pointer,
Reveal and proceeds come from the same read. A wallet that is not the contract's owner reads everything and sends
nothing.

## 2. Decisions taken in the design conversation

1. **Scope.** Decision: Airdrop (airdrop and burn) and Settings (withdraw, payout address, royalty, reveal with the
   way back to the placeholder and a custom link, mint on behalf, the transfer validator address, the transfer level)
   on real data; the Overview's pointer, revealed state and Reveal on the real actions, and its proceeds; the owner
   check; `verify:airdrop` and `verify:settings`; sample mode on the same code; the browser walk. Out: the indexer and
   the freshness server (Phase 6), the mint page, "Paid by minters", holders and recent mints (sample until Phase 6),
   ownership transfer and renounce, per-token royalty, automatic validator approval, the platform admin setters.
   Considered: leaving the level control out until a testnet validator is checked (it ships, off wherever the
   validator has no code, and the level values are verified on a testnet before launch).
2. **Truth and copies.** Decision: the chain holds every setting and balance. `deployments.payout_address`,
   `royalty_bps`, `royalty_receiver` and `base_uri` become copies of the contract's values, with the new
   `transfer_validator` and `mint_on_behalf`, written only by `settings_refresh` from a server read (the deploy-time
   values stay in `args`); balances and the transfer level are never copied. `airdrops` and `withdrawals` are Cobweb's
   records of the transactions it proved. Considered: no copies, the chain read on every load (the tab would be empty
   while the chain does not answer).
3. **One read, every copy.** Decision: `settingsViewCore` reads ten views at one block through `readEach`, then
   refreshes the phase copies through `mint_groups_refresh` and the settings copies through `settings_refresh` with that
   block, since the two share `state_block` and `state_read_at`. Considered: `settings_refresh` alone (`state_read_at`
   would then name a read that never refreshed the phase copies, and the Phases alert shows that time).
4. **Payable and validator calls in the machine.** Decision: `ManageCall` gains `value?: bigint` and `target?:
   CallTarget` (absent is the collection; the validator's target carries its address, and `abiOf(call)` picks
   `validatorAbi`); `SentCall` gains `value` and `target`; `sentCallShape` takes `airdropNFTs`, the six Settings
   functions on the collection and the level call; `realManageActions.simulate` passes the value, the address and the
   ABI; `reviewOf` adds a "Value" row. Every tab now sends calls, so the sample-only seams go: `sampleRequest`,
   `TxRequest.check` and `valueWei`, `ManageActions.review`, and the shared sample target behind `useManageActions`.
   Considered: a second machine for payable and validator calls (two sequences, one dialog).
5. **Airdrop batches.** Decision: the browser parses the list with the shared input, freezes it at the first send and
   builds batches of at most 500 recipients and at most 1,000 tokens in the list's order; each batch is one
   `airdropNFTs(recipients, amounts)` whose `value` is exactly the contract's `airdropFeePerToken` times its tokens. The
   server stores no list. Considered: a list stored and chunked by the server, as the Whitelist (a landed batch is on
   chain and an unsent one is in the browser, so the server has nothing to resume).
6. **The job in the browser.** Decision: `cobweb-airdrop:<collectionId>` keeps `{ kind, batches, sent, pending }`, the
   frozen job with the hash of a batch sent but not confirmed; a reload shows the waiting batch with "Check again" and
   "Discard", and "Stop and drop the unsent batches" clears the job. Discard forgets the hash and marks the batch failed
   for the visit, under a warning that a landed batch sent again mints twice. Considered: Discard counting the batch as
   sent (a batch that never landed would be skipped without a word).
7. **The batch proof.** Decision: `confirmAirdropCore(ctx, txHash)` checks the receipt, waits for the chain's
   confirmation depth, decodes the calldata as `airdropNFTs`, matches `NFTsAirdropped(recipients, amount, feePaid)` to
   the decoded counts and takes the first and last token id from the `Transfer` logs from the zero address; then
   `airdrop_record` writes one row per transaction. The kind is `burn` when the calldata's only recipient is the dead
   address. Considered: the browser naming the batch, its index or its kind (the calldata says all of it; rule 4).
8. **Burn.** Decision: a burn is one batch, `airdropNFTs([0x000000000000000000000000000000000000dEaD], [N])` with N at
   most 1,000 (the batch cap), behind the typed "burn N"; while its hash is pending it is a job of kind `burn` in the same
   store. Considered: splitting a larger burn into batches (one typed confirmation would send several transactions).
9. **Repeats.** Decision: the parser checks a repeated address's summed quantity against 1,000 too, and leaves out the
   line that passes it with its line number. Considered: refusing every line of that address (its earlier lines were
   valid).
10. **Settings proofs.** Decision: each change is confirmed through `matchPhaseEvent` with new `ExpectedEvent` variants
    (addresses compared without case; the decoded arguments returned); the reveal also from its calldata, decoded as
    `setBaseURI(newBaseURI)` and equal to the URI sent, since `BatchMetadataUpdate` carries none; the level from the
    validator's own log, after the server checks that the target is the collection's validator. The withdraw waits for
    the chain's depth and records `withdrawals` from the event's amount; the others need no depth, as in Phases, since
    their copies are read again on every load. Considered: a chain read after the receipt as the proof (a later change
    can hide the one being confirmed).
11. **Reveal.** Decision: the dialog offers "Rendered metadata" (the latest done real job's `base_uri`, exact),
    "Placeholder" (the latest done placeholder job's, whenever one exists) and "Another IPFS link" (a full `ipfs://` URI
    with a CID, under the red warning); "Token 1 now" and "Token 1 after" follow `tokenURI`'s rule. The pointer is
    Revealed when the base URI equals the real job's, Placeholder when it equals the placeholder job's or the deploy-time
    start URI, otherwise Custom. Reveal stays off while no real job is done, as today. Considered: building the URI from a
    CID (a rendered single asset's base ends in `/metadata.json`, which a CID alone cannot rebuild).
12. **The transfer validator and the level.** Decision: `packages/shared` ships `validatorAbi` (the pinned library's
    level setter, `getCollectionSecurityPolicy` and `SetTransferSecurityLevel`) and `DEFAULT_TRANSFER_VALIDATOR`; the
    levels are enforced 0, open 1 and locked 9, sent as `setTransferSecurityLevelOfCollection(collection, level, false,
    false, false)`; the level control shows when the validator address has code at the read's block, and otherwise the
    sentence for no validator. Considered: `chainView`'s `transferLock` (a testnet flag, not what the chain holds).
13. **The owner check.** Decision: both views carry `owner()`; when it is not the session wallet, an alert names the
    owner and every send is off, while the dialogs still open for reading (`TransactionDialog` gains `blocked`).
    Considered: hiding the buttons (the creator could not see what a change would send).
14. **Money.** Decision: "Your balance" is `creatorBalance()`, "Withdrawn so far" the sum of `withdrawals`, "Platform
    fees, paid to Cobweb" `platformBalance()`, a new "Platform fees per token" row `fees()` (read only), and "Refunds
    held for this wallet" `pendingBalance(wallet)` when above 0. None of the balances is copied: each reads "Not read"
    while the chain does not answer. "Paid by minters" waits for Phase 6. Considered: a scan of `MintFundsWithdrawn`
    logs for the withdrawn total (a log scan per load; Phase 6's indexer will hold them).
15. **The royalty copy.** Decision: `deployments.royalty_bps` takes 0 to 10,000, the contract's range, as the copy;
    the 10% cap stays the app's (the dialog, the shape and the deploy form). Considered: keeping 0 to 1,000 (a royalty
    set above 10% outside Cobweb could never be copied).
16. **The deployed view.** Decision: `readDeployment` reads the base URI, the payout address and the royalty from
    `deployments.args`, as Phases moved the public limit there, so the deployed view keeps showing what landed.
    Considered: leaving it on the columns (they are copies now).
17. **The Overview.** Decision: the Overview reads `getSettings` beside the record and the phases: the pointer
    (Revealed, Placeholder or Custom), Reveal on the real actions under its own `ManageActionsProvider`, and "Withdrawable
    now" and "Already withdrawn" from the settings view; holders and recent mints stay sample, and "Paid by minters"
    shows in sample mode only. Considered: the proceeds panel sample until Phase 6 (a real collection would show sample
    balances).
18. **Pending answers.** Decision: the machine's polling map gains `AIRDROP_NOT_CONFIRMED` to `AIRDROP_TIMED_OUT` and
    `SETTINGS_NOT_CONFIRMED` to `SETTINGS_TIMED_OUT`, each with its own text, since the map is keyed by the sentence.
    Considered: `PHASE_NOT_CONFIRMED` for both (its timeout says nothing about minting twice).
19. **Sentences.** Decision: an Airdrop and Settings block in `result.ts`; `revertSentence` gains the ruled sentences
    and six more (nothing to withdraw, a payout that refuses funds, a validator without code, the two royalty errors and
    the zero address), with amounts in the chain's native unit through a new `ManageInput.nativeSymbol`. Considered: the
    generic "The check against the contract failed" for the Settings errors (`verify:settings` checks them in words).
20. **Shapes.** Decision: every input is parsed before the session read (rule 4); the confirms take the hash (Airdrop)
    or the hash and a Settings `SentCall`, never a value to record. Considered: the dialogs' checks alone.
21. **Sample mode.** Decision: the same screens on `sampleAirdropServer`, `sampleSettingsServer` and the sample actions,
    with the states `?batch=pending`, `?chain=unreachable`, `?owner=other`, `?art=deferred` and `?art=revealed`.
    Considered: the sample screens kept beside the real ones (two screens to keep in step).
22. **Scripts.** Decision: `verify:airdrop` (15 checks) and `verify:settings` (17) on the deploy fixture; the
    1,000-supply collection for the gas measurement is deployed straight through the factory; on Anvil the default
    validator has no code, so the way back to it is checked as its refusal in words. Considered: one script for both
    tabs (each runs on its own fixture and stays readable).
23. **Database writes.** Decision: two tables under row-level security (the owner reads through
    `private.collection_owned`; no client writes) and three definers for the service role only, the types by hand.
    Considered: the owner's client inserting the records (the records come from proofs, never from the browser).
24. **Docs.** Decision: section 11. Considered: a dated MASTER_PLAN decision for the records (the Lock and burn
    decisions hold the rules; this spec holds the mechanism).
25. **Tests and the walk.** Decision: section 10. Considered: component tests (the repo tests pure modules and walks
    screens).

## 3. Scope

In: the migration (two tables, two `deployments` columns, the royalty range, three functions); `validatorAbi` and
`DEFAULT_TRANSFER_VALIDATOR` in the shared package; payable and validator calls in the manage calls, their shapes, the
machine, the actions and the dialog; the Airdrop view, the batch proof and its record; the Settings view, the change
confirm, the copies and the withdrawal record; the Airdrop, Settings and Overview pages and screens on real data, each
with its own manage actions; the job store and the waiting batch; the owner check; sample mode; `verify:airdrop`,
`verify:settings` and section 9m of `verify:local`; docs. Out: as decision 1, plus per-recipient history and airdrops
or withdrawals made outside Cobweb (Phase 6's indexer reads `NFTsAirdropped`, `Transfer` and `MintFundsWithdrawn`),
`withdrawPlatformFees` and the pending-refund claims (callable by anyone; Cobweb offers neither), a notice to the mint
page on reveal (Phase 6 subscribes to `BatchMetadataUpdate`), and the two items Phase 4 owes Phase 5 (section 12).

## 4. Database (`supabase/migrations/20261016000000_airdrop_settings.sql`)

### 4.1 `airdrops` and `withdrawals`

```sql
create table public.airdrops (
  tx_hash text primary key check (tx_hash ~ '^0x[0-9a-f]{64}$'),
  collection_id uuid not null references public.collections (id) on delete cascade,
  kind text not null check (kind in ('airdrop', 'burn')),
  recipients integer not null check (recipients >= 1),
  tokens integer not null check (tokens >= 1),
  fee_paid_wei numeric(78, 0) not null check (fee_paid_wei >= 0),
  first_token_id bigint not null check (first_token_id >= 1),
  last_token_id bigint not null,
  block bigint not null check (block >= 0),
  sent_by text not null check (sent_by ~ '^0x[0-9a-f]{40}$'),
  confirmed_at timestamptz not null default now(),
  constraint airdrops_token_range check (last_token_id - first_token_id + 1 = tokens),
  constraint airdrops_burn_one_recipient check (kind <> 'burn' or recipients = 1)
);
create index airdrops_collection_id_block_idx on public.airdrops (collection_id, block desc);

create table public.withdrawals (
  tx_hash text primary key check (tx_hash ~ '^0x[0-9a-f]{64}$'),
  collection_id uuid not null references public.collections (id) on delete cascade,
  amount_wei numeric(78, 0) not null check (amount_wei > 0),
  payout_address text not null check (payout_address ~ '^0x[0-9a-f]{40}$'),
  block bigint not null check (block >= 0),
  confirmed_at timestamptz not null default now()
);
create index withdrawals_collection_id_idx on public.withdrawals (collection_id);

alter table public.airdrops enable row level security;
create policy "airdrops: owner reads" on public.airdrops
for select to authenticated
using ((select private.collection_owned(collection_id)));
revoke all on public.airdrops from anon, authenticated;
grant select on public.airdrops to authenticated;
-- The same four statements for public.withdrawals, its policy "withdrawals: owner reads".
```

`tx_hash` is the primary key, so one row per transaction and a hash is never recorded twice. The owner reads; no
client role writes (the revokes undo Supabase's default grants on a new table); only `airdrop_record` and
`withdrawal_record`, below, insert. The indexes serve the policy's `collection_id` and History's order. The comments:
`airdrops`, "One row per airdropNFTs transaction Cobweb proved from its receipt and calldata, written only by
airdrop_record. kind is burn when the only recipient is the dead address. Airdrops sent outside Cobweb are not here.";
`withdrawals`, "One row per withdrawMintFunds transaction Cobweb proved from its receipt, with the amount and payout
address of its MintFundsWithdrawn event, written only by withdrawal_record. Withdrawals made outside Cobweb are not
here."

### 4.2 `deployments`

```sql
alter table public.deployments drop constraint deployments_royalty_bps_check;
alter table public.deployments
  add constraint deployments_royalty_bps_check check (royalty_bps between 0 and 10000),
  add column transfer_validator text check (transfer_validator ~ '^0x[0-9a-f]{40}$'),
  add column mint_on_behalf boolean not null default false;
```

`payout_address`, `royalty_bps`, `royalty_receiver` and `base_uri` become copies of the contract's
`ownerPayoutAddress()`, the default royalty (`royaltyInfo(1, 10000)`), and `baseURI()`; `transfer_validator` copies
`getTransferValidator()` (null until the first read; the zero address means no validator) and `mint_on_behalf`
copies `collectionState().mintOnBehalfActive`. `collection_record_deploy` is unchanged: a new row's copies are the
deploy-time values, `transfer_validator` null and `mint_on_behalf` false. Each column comment says what it copies,
that `settings_refresh` alone refreshes it, and where the deploy-time value stays (`args.payout`, `args.royaltyBps`,
`args.royaltyReceiver`, `args.baseUri`); the royalty's adds "The contract allows up to 10,000; Cobweb sets at most
1,000." The comment on `state_block` becomes "The block of the server read the copies were last refreshed from:
mint_groups price_wei, max_supply and start_at and public_max_per_wallet by mint_groups_refresh; payout_address,
royalty_bps, royalty_receiver, base_uri, transfer_validator and mint_on_behalf by settings_refresh."

### 4.3 Functions

```sql
create function public.settings_refresh(p_collection_id uuid, p_owner uuid, p_block bigint,
  p_block_time timestamptz, p_settings jsonb) returns boolean
create function public.airdrop_record(p_collection_id uuid, p_owner uuid, p_tx text, p_kind text,
  p_recipients integer, p_tokens integer, p_fee_paid_wei numeric, p_first_token_id bigint,
  p_last_token_id bigint, p_block bigint, p_sent_by text) returns boolean
create function public.withdrawal_record(p_collection_id uuid, p_owner uuid, p_tx text, p_amount_wei numeric,
  p_payout_address text, p_block bigint) returns boolean
```

All three are `plpgsql`, `security definer`, `set search_path = ''`, revoked from `public`, `anon` and
`authenticated` and granted to `service_role`, as `mint_groups_refresh` and `whitelist_chunk_record` are. Each takes a
verified user's id as `p_owner` and starts with `private.lock_owned_collection(p_collection_id, p_owner)` ('collection
not found', `42501`), then refuses a collection without a `deployments` row with 'The contract is not deployed yet.'
(`23514`).

- `settings_refresh` selects the deployment `for update`, and writes nothing and answers false when `p_block` is
  below `state_block` (a slower read never overwrites a newer one; the same block is accepted, since
  `settingsViewCore` refreshes the phase copies first with that block). Otherwise it sets the six copies from
  `p_settings` (`{ payout_address, royalty_bps, royalty_receiver, base_uri, transfer_validator, mint_on_behalf }`,
  addresses lowercase, every key required: a missing one leaves a null the column refuses), `state_block` and
  `state_read_at`, and answers true. The checks raise as they are (`23514`: a royalty above 10,000, a malformed
  address).
- `airdrop_record` refuses with 'The transaction did not make this change.' (`23514`) a `p_tx` that is not 32
  lowercase hex bytes, a `p_sent_by` that is not 20 lowercase hex bytes, and a `p_kind` other than `airdrop` or `burn`; it inserts the row
  (`confirmed_at` now) `on conflict (tx_hash) do nothing` and answers whether it inserted one, so a second record of a
  hash answers false and changes nothing. The table's checks raise as they are (`23514`): a burn to more than one
  recipient, a token range that does not match `tokens`, a negative fee.
- `withdrawal_record` refuses a malformed `p_tx` or `p_payout_address` the same way, inserts `on conflict (tx_hash)
  do nothing` and answers whether it inserted; an amount of 0 or less raises the table's check.

A hash already recorded is left as it is whichever collection it names: the proofs tie a hash to one contract.

### 4.4 Types (`apps/web/src/lib/database.types.ts`, by hand)

`airdrops` and `withdrawals` gain their Row, Insert, Update and Relationships (`collection_id` to `collections`) as the
generator writes them: numeric and bigint columns as `number`, `kind` as `string`. The `deployments` Row gains
`mint_on_behalf: boolean` and `transfer_validator: string | null`; Insert and Update gain them as optional. Functions
gain:

```ts
airdrop_record: { Args: { p_block: number; p_collection_id: string; p_fee_paid_wei: number; p_first_token_id: number; p_kind: string; p_last_token_id: number; p_owner: string; p_recipients: number; p_sent_by: string; p_tokens: number; p_tx: string }; Returns: boolean }
settings_refresh: { Args: { p_block: number; p_block_time: string; p_collection_id: string; p_owner: string; p_settings: Json }; Returns: boolean }
withdrawal_record: { Args: { p_amount_wei: number; p_block: number; p_collection_id: string; p_owner: string; p_payout_address: string; p_tx: string }; Returns: boolean }
```

The cores pass wei as decimal strings cast `as unknown as number`, as the deploy confirm passes the fee snapshot, so
no wei is lost.

## 5. The shared package

```ts
// packages/shared/src/validator-abi.ts, exported from the browser entry (index.ts)
export const validatorAbi: readonly [/* the three entries below */]
export const DEFAULT_TRANSFER_VALIDATOR: Address = '0x721C008fdff27BF06E7E123956E2Fe03B63342e3'
```

Written by hand from the pinned library (`contracts/lib/creator-token-standards` at 980a63b:
`src/utils/CreatorTokenTransferValidator.sol` lines 809 to 828, 945 to 949 and 179, the struct in
`src/utils/TransferPolicy.sol` lines 25 to 32, the address in `src/utils/CreatorTokenBase.sol` line 43), since Foundry
never compiles the validator and `copy-abi.ts` copies only what `contracts/out` holds; the file's header says so. Its
three entries, nothing else:

```solidity
function setTransferSecurityLevelOfCollection(address collection, uint8 level, bool disableAuthorizationMode, bool disableWildcardOperators, bool enableAccountFreezingMode)
function getCollectionSecurityPolicy(address collection) view returns ((bool disableAuthorizationMode, bool authorizersCannotSetWildcardOperators, uint8 transferSecurityLevel, uint120 listId, bool enableAccountFreezingMode, uint16 tokenType))
event SetTransferSecurityLevel(address indexed collection, uint8 level)
```

`validator-abi.test.ts` pins the two selectors, the event's topic and indexed input, the input names and the address's
checksum. `collection.test.ts` pins what this sub-project calls: `airdropNFTs(address[],uint256[])` (payable,
`['recipients', 'amounts']`), `withdrawMintFunds()`, `setOwnerPayoutAddress(address)` (`['newOwnerPayoutAddress']`),
`setDefaultRoyalty(address,uint96)` (`['receiver', 'feeNumerator']`), `setBaseURI(string)` (`['newBaseURI']`),
`setMintOnBehalfStatus(bool)` (`['status']`), `setTransferValidator(address)` (`['transferValidator_']`),
`setFees(uint256,uint256,uint256)` and `transferOwnership(address)` (the scripts); the views `fees()`,
`creatorBalance()`, `platformBalance()`, `pendingBalance(address)`, `ownerPayoutAddress()`,
`royaltyInfo(uint256,uint256)`, `baseURI()`, `getTransferValidator()`, `DEFAULT_TRANSFER_VALIDATOR()`, `owner()` and
`tokenURI(uint256)`; the events `NFTsAirdropped(uint256,uint256,uint256)`, `MintFundsWithdrawn(address,uint256)`
(`payoutAddress` indexed), `OwnerPayoutAddressUpdated(address)`, `DefaultRoyaltyUpdated(address,uint96)`,
`MintOnBehalfUpdated(bool)`, `TransferValidatorUpdated(address,address)`, `BatchMetadataUpdate(uint256,uint256)` and
`Transfer(address,address,uint256)`; and the errors `ExceedsMaxSupply(uint256,uint256)`,
`InsufficientEther(uint256,uint256)`, `TransferToNonERC721ReceiverImplementer()`, `NothingToWithdraw()`,
`WithdrawFailed()`, `CreatorTokenBase__InvalidTransferValidatorContract()`, `ERC2981InvalidDefaultRoyalty(uint256,uint256)`,
`ERC2981InvalidDefaultRoyaltyReceiver(address)` and `MintToZeroAddress()`.

## 6. The server

### 6.1 Types and the pure views

```ts
// apps/web/src/lib/manage/airdrop-types.ts, types only
export type AirdropKind = 'airdrop' | 'burn'
export type AirdropRow = { txHash: Hex; kind: AirdropKind; recipients: number; tokens: number; feePaidWei: string;
  firstTokenId: number; lastTokenId: number; block: number; confirmedAt: number }
export type AirdropView = { chainId: number; contract: Address; owner: Address | null; feePerTokenWei: string | null;
  maxSupply: number; totalMinted: number | null; left: number | null; history: AirdropRow[]; blockTimestamp: number;
  readAt: number; chainReachable: boolean }
export type BatchEntry = { address: Address; amount: number }
export type AirdropJob = { kind: AirdropKind; batches: BatchEntry[][]; sent: number; pending: Hex | null }
export type AirdropState = { block: bigint; blockTimestamp: number; maxSupply: number; totalMinted: number;
  feePerTokenWei: string; owner: Address }
export type AirdropReader = (chainId: number, address: Address, atLeast?: bigint) => Promise<AirdropState | null>
// apps/web/src/lib/manage/airdrop-view.ts, pure, for the browser and the server
export const AIRDROP_MAX_RECIPIENTS = 500, AIRDROP_MAX_TOKENS = 1_000, AIRDROP_MAX_PER_ADDRESS = 1_000
export const BURN_ADDRESS: Address = '0x000000000000000000000000000000000000dEaD'
export type AirdropDbRow = { tx_hash: string; kind: string; recipients: number; tokens: number; fee_paid_wei: string;
  first_token_id: number; last_token_id: number; block: number; confirmed_at: string }
export function batchesOf(entries: readonly BatchEntry[]): BatchEntry[][]
export function tokensOf(entries: readonly BatchEntry[]): number
export function airdropRowsOf(rows: AirdropDbRow[]): AirdropRow[]
export function airdropViewOf(base: { chainId: number; contract: Address; maxSupply: number; readAt: number },
  history: AirdropRow[], state: AirdropState | null): AirdropView
```

`batchesOf` walks the entries in the list's order and starts a new batch when the next entry would take the current
one past 500 recipients or 1,000 tokens; an entry carries 1 to 1,000 tokens, so each fits a batch. `airdropRowsOf`
keeps the order read (newest first) and turns `confirmed_at` into Unix seconds. `airdropViewOf` with a state answers
the fee, the owner, minted, `left` (`maxSupply - totalMinted`, never below 0) and the read's block time as `readAt`
and `blockTimestamp`; without one, owner, fee, minted and left are null, `maxSupply` is the collection's `max_supply`,
`readAt` the copy's time from `phaseBase` and `chainReachable` false. `holders.ts` leaves out `BURN_ADDRESS` (compared
lowercase) in place of its own constant; the demo's lowercase `DEAD_ADDRESS` goes, and the screens show
`BURN_ADDRESS`.

```ts
// apps/web/src/lib/manage/settings-types.ts, types only
export type TransferLevelState = { kind: 'none'; reason: 'zero' | 'no-code' } | { kind: 'unread' } | { kind: 'level'; level: number }
export type RevealPointer = 'revealed' | 'placeholder' | 'custom'
export type RevealTargets = { real: string | null; placeholder: string | null; start: string }
export type SettingsView = { chainId: number; contract: Address; owner: Address | null;
  creatorBalanceWei: string | null; platformBalanceWei: string | null; pendingBalanceWei: string | null;
  withdrawnWei: string; fees: FeeSnapshot | null; payout: Address; royaltyBps: number; royaltyReceiver: Address;
  baseUri: string; transferValidator: Address | null; mintOnBehalf: boolean; level: TransferLevelState | null;
  targets: RevealTargets; pointer: RevealPointer; realArtRendered: boolean; blockTimestamp: number; readAt: number;
  chainReachable: boolean }
export type SettingsState = { block: bigint; blockTimestamp: number; chain: ChainState; creatorBalanceWei: string;
  platformBalanceWei: string; pendingBalanceWei: string; payout: Address; royaltyBps: number; royaltyReceiver: Address;
  baseUri: string; validator: Address; owner: Address; fees: FeeSnapshot; level: TransferLevelState }
export type SettingsReader = (chainId: number, address: Address, wallet: Address, atLeast?: bigint) => Promise<SettingsState | null>
export type SettingsCopyRow = { payout_address: string; royalty_bps: number; royalty_receiver: string; base_uri: string;
  transfer_validator: string | null; mint_on_behalf: boolean; args: PreparedArgs }
// apps/web/src/lib/manage/settings-view.ts, pure, for the browser and the server
export const TRANSFER_LEVELS = { enforced: 0, open: 1, locked: 9 } as const
export type TransferLevelValue = (typeof TRANSFER_LEVELS)[keyof typeof TRANSFER_LEVELS]
export const BASE_URI_MAX = 512
export function ipfsUriValid(value: string): boolean
export function tokenUriOf(base: string): string
export function pointerOf(baseUri: string, targets: RevealTargets): RevealPointer
export function levelOf(validator: Address, hasCode: boolean, policyLevel: number | null): TransferLevelState
export function settingsViewOf(base: { chainId: number; contract: Address; readAt: number }, copies: SettingsCopyRow,
  targets: RevealTargets, withdrawnWei: string, state: SettingsState | null): SettingsView
export function settingsPayload(state: SettingsState): { payout_address: string; royalty_bps: number;
  royalty_receiver: string; base_uri: string; transfer_validator: string; mint_on_behalf: boolean }
```

`ipfsUriValid` accepts `^ipfs://(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{58,})(/\S*)?$` of at most 512 characters, which
the rendered jobs' `ipfs://<cid>/` and `ipfs://<cid>/metadata.json` both pass. `tokenUriOf` is the contract's rule: an
empty base stays empty, a base not ending in "/" is returned as it is, otherwise the base plus "1". `pointerOf` answers
`revealed` when the base URI equals `targets.real`, `placeholder` when it equals `targets.placeholder` or
`targets.start` (the deploy-time `args.baseUri`), else `custom`; strings compare exactly, and the real job is checked
first, so a collection deployed on its real job reads revealed. `levelOf` answers `none/zero` for the zero address,
`none/no-code` without code, `unread` for a null policy level, else `level`. `settingsViewOf` with a state answers the
chain's values, the copied fields included, and the read's block time; without one, the copies, with the balances,
fees, owner and level null, `chainReachable` false and `readAt` the copy's time. In both, `realArtRendered` is
`targets.real !== null` and `pointer` is `pointerOf` of the base URI shown. `settingsPayload` lowercases the
addresses for `settings_refresh`.

### 6.2 The chain reads

```ts
// apps/web/src/lib/manage/phases-core.ts, gains
export function chainStateOf(state: CollectionStateResult, block: bigint): ChainState
export async function refreshPhaseCopies(ctx: PhasesContext, state: ChainState): Promise<void>
// apps/web/src/lib/manage/airdrop-core.ts and apps/web/src/lib/manage/settings-core.ts
export const readAirdropState: AirdropReader
export const readSettingsState: SettingsReader
```

`chainStateOf` is `readCollectionState`'s mapping moved out (`CollectionStateResult` is viem's return type of
`collectionState`), so three readers share one mapping; `refreshPhaseCopies` is the private `refreshCopies`, exported
unchanged. Both new readers take `publicClientFor(chainId)`, `getBlockNumber({ cacheTime: 0 })` and the later of that
block and `atLeast`, then one `readEach` at that block; a request failing as a whole, or a null where a view must
answer, is logged with `errorSummary` and answers null, as `readCollectionState` does. `readAirdropState` reads
`collectionState()`, `fees()` and `owner()`; the fee is `fees().airdropFeePerToken`, which equals
`collectionState().airdropFeePerToken`. `readSettingsState` reads, in this order, `collectionState()`,
`creatorBalance()`, `platformBalance()`, `pendingBalance(wallet)`, `ownerPayoutAddress()`, `royaltyInfo(1, 10000)`
(the receiver, and the amount as the basis points, since the sale price equals the denominator), `baseURI()`,
`getTransferValidator()`, `owner()` and `fees()`; then, for a validator other than the zero address, `getCode` at the
block and, when it has code, `getCollectionSecurityPolicy(collection)` on the validator through `validatorAbi` at the
block, whose `transferSecurityLevel` is the level. There a revert or an empty answer reads `unread`, and a failed
request is logged and reads `unread`: the validator never fails the read. No `server-only` marker, as
`phases-core.ts`, so the scripts import both modules; the browser never does.

### 6.3 The Airdrop view and the batch proof

```ts
// apps/web/src/lib/manage/airdrop-core.ts
export type AirdropContext = PhasesContext
export async function airdropViewCore(ctx: AirdropContext, read: AirdropReader = readAirdropState): Promise<DeployOutcome<AirdropView>>
export async function confirmAirdropCore(ctx: AirdropContext, txHash: Hex, read: AirdropReader = readAirdropState): Promise<DeployOutcome<AirdropView>>
// apps/web/src/lib/chain/airdrop-batch.ts, pure
export type AirdropProof = { ok: true; batch: { kind: AirdropKind; recipients: number; tokens: number;
  feePaidWei: string; firstTokenId: number; lastTokenId: number } } | { ok: false; error: string }
export function proveAirdrop(receipt: PhaseReceipt, input: Hex, expected: { contract: Address; from: string }): AirdropProof
```

`airdropViewCore` runs `phaseBase` (`NOT_DEPLOYED`), reads the collection's `airdrops` rows under the creator's client
through `readAll` in pages of 1,000 (`tx_hash, kind, recipients, tokens, fee_paid_wei::text, first_token_id,
last_token_id, block, confirmed_at`, by `block` descending, then `tx_hash`), then reads the chain; it refreshes
nothing.

The confirm: `phaseBase` (`NOT_DEPLOYED`); `publicClientFor` (`CHAIN_NOT_READY` when it throws);
`getTransactionReceipt` (not found or empty: `AIRDROP_NOT_CONFIRMED`, which the machine polls; reverted:
`PHASE_REVERTED`); the depth, `hasConfirmations(receipt.blockNumber, latest, confirmationsFor(chainId))` with
`getBlockNumber({ cacheTime: 0 })` (too shallow, or the block not read: `AIRDROP_NOT_CONFIRMED`); `getTransaction`
(not found: `AIRDROP_NOT_CONFIRMED`); `proveAirdrop`; `airdrop_record` through `ctx.service()` with `p_owner:
ctx.owner`, the hash, the proof's batch, `p_block` the receipt's block and `p_sent_by` the receipt's `from`
lowercased; then `airdropViewCore` with the reader bound to the receipt's block. The browser sends only the hash. A
second confirm of the same hash records nothing (`airdrop_record` answers false) and answers the view again.

`proveAirdrop` checks `to` (`NOT_THIS_CONTRACT`) and `from` (`NOT_FROM_WALLET`) first, as `matchPhaseEvent` does, then
refuses `NOT_THIS_CHANGE` for: a failed status; an input the collection ABI does not decode, or another function than
`airdropNFTs`; unequal lengths, or 0 tokens in total; no `NFTsAirdropped` from the collection whose `recipients` and
`amount` equal the decoded length and total (found by `matchPhaseEvent`, whose decoded `feePaid` is the fee); `Transfer`
logs from the collection with `from` the zero address whose count is not the total, or whose ids do not run
consecutively. The first and last token ids are the smallest and the largest of those ids. The kind is `burn` when the
decoded recipients are exactly one and it is `BURN_ADDRESS` (compared without case), else `airdrop`.

### 6.4 The Settings view and the change confirm

```ts
// apps/web/src/lib/manage/settings-core.ts
export type SettingsContext = PhasesContext
export async function settingsViewCore(ctx: SettingsContext, read: SettingsReader = readSettingsState): Promise<DeployOutcome<SettingsView>>
export async function confirmSettingsTxCore(ctx: SettingsContext, txHash: Hex, call: ManageCall,
  read: SettingsReader = readSettingsState): Promise<DeployOutcome<SettingsView>>
// apps/web/src/lib/chain/phase-events.ts, changed
export type PhaseEventMatch = { ok: true; args: Record<string, unknown> } | { ok: false; error: string }
export function matchPhaseEvent(receipt: PhaseReceipt, expected: { contract: Address; from: string; event: ExpectedEvent;
  abi?: Abi }): PhaseEventMatch
// apps/web/src/lib/deploy/deploy-core.ts, now exported
export async function doneJobRow(supabase: LockClient, collectionId: string, kind: 'real' | 'placeholder'): Promise<JobRow | null>
```

`settingsViewCore` runs `phaseBase` (`NOT_DEPLOYED`); reads under the creator's client the copies (`payout_address,
royalty_bps, royalty_receiver, base_uri, transfer_validator, mint_on_behalf, args`), the targets (the `base_uri` of
`doneJobRow(..., 'real')` and of `doneJobRow(..., 'placeholder')`, and `args.baseUri`) and the sum of the collection's
`withdrawals` (`amount_wei::text`, added as bigints); then reads the chain with the session wallet, checksummed. A read
refreshes the copies: `refreshPhaseCopies(ctx, state.chain)`, then `settings_refresh` through `ctx.service()` with
`p_owner: ctx.owner`, the read's block and time and `settingsPayload(state)`; a refresh that fails, or answers false,
is logged and never fails the view. A null read answers the copy view.

The confirm runs `phaseBase` (`NOT_DEPLOYED`), `publicClientFor` (`CHAIN_NOT_READY`) and `getTransactionReceipt` (not
found or empty: `SETTINGS_NOT_CONFIRMED`; reverted: `PHASE_REVERTED`), then, by the call:

- the level (`target` set): `getTransferValidator()` on the collection at the receipt's block must equal the target
  (else `NOT_THIS_CONTRACT`; a failed read is `SETTINGS_NOT_CONFIRMED`), then `matchPhaseEvent` with `contract` the
  target, `abi: validatorAbi` and `SetTransferSecurityLevel(collection, level)`;
- any other call: `matchPhaseEvent` with `contract` the collection and `expectedEvent(call)`;
- `setBaseURI`, after the match: `getTransaction` (not found: `SETTINGS_NOT_CONFIRMED`) and its input decoded through
  the collection ABI as `setBaseURI` whose `newBaseURI` equals the call's (else `NOT_THIS_CHANGE`);
- `withdrawMintFunds`: before the match, the depth as the airdrop's (`SETTINGS_NOT_CONFIRMED` until then); after it,
  `withdrawal_record` through `ctx.service()` with the match's `amount` and `payoutAddress` (lowercased) and the
  receipt's block.

Then `settingsViewCore` with the reader bound to the receipt's block, which refreshes the copies. A second confirm of
the same hash answers the view again; the withdrawal stays recorded once.

`matchPhaseEvent` decodes with `expected.abi` (default `collectionAbi`) the logs whose address is `expected.contract`,
and answers the decoded arguments with a match; `sameArgs` compares strings without case (addresses) and every other
value exactly, so a wanted argument may be a bigint, a boolean, a number or a string. Its other callers read `ok` only.
`readDeployment` reads `baseUri`, `payout`, `royaltyBps` and `royaltyReceiver` from `args` (`args.baseUri`,
`args.payout`, `args.royaltyBps`, `args.royaltyReceiver`), and those four columns leave `DEPLOYMENT_COLUMNS`.

### 6.5 The actions (`apps/web/src/app/actions/airdrop.ts` and `settings.ts`) and their shapes

```ts
export async function getAirdrop(collectionId: string): Promise<ActionResult<AirdropView>>
export async function confirmAirdrop(collectionId: string, txHash: string): Promise<ActionResult<AirdropView>>
export async function getSettings(collectionId: string): Promise<ActionResult<SettingsView>>
export async function confirmSettingsTx(collectionId: string, txHash: string, sent: SentCall): Promise<ActionResult<SettingsView>>
// apps/web/src/lib/manage/phase-schemas.ts, changed
export function parseSentCall(input: unknown, functions?: ReadonlySet<string>): { ok: true; data: SentCall } | { ok: false; error: string }
```

Each action parses its input first: the hash through `lock-schemas`' `txHash`; a sent call through
`parseSentCall(sent, SETTINGS_FUNCTIONS)` (`UNSAVED` for another function or any shape it refuses), then `callOf`.
Then `phasesWrite(collectionId, run, manageRecordError)` checks the session and the ownership (rule 4). The reads go
through `cache(readAirdropState)` and `cache(readSettingsState)`, once per request, as `getPhases` reads.
`confirmPhaseTx` now parses with `PHASE_FUNCTIONS`, so a Phases confirm never accepts an airdrop or a Settings call.

### 6.6 Sentences (`apps/web/src/lib/art/result.ts`, an Airdrop and Settings block) and errors

```ts
// Said by the server or the screen (the database raises none of these).
export const AIRDROP_NOT_CONFIRMED = 'The tokens have not been confirmed on chain yet.'
export const AIRDROP_TIMED_OUT =
  'The tokens are not confirmed yet. Check again in a minute, and do not send the batch again: it would mint its tokens twice.'
export const SETTINGS_NOT_CONFIRMED = 'The setting has not been confirmed on chain yet.'
export const SETTINGS_TIMED_OUT = 'The setting is not confirmed yet. Read the contract again in a minute to see it.'
export const NOT_OWNER = (owner: string) => `This wallet is not the contract's owner. Changes on chain need ${owner}.`
export const IPFS_LINK_INVALID = 'Enter a full ipfs:// link with its CID.'
export function manageRecordError(error: DbError): string   // apps/web/src/lib/art/db-error.ts
```

`manageRecordError` maps `42501` to `NOT_FOUND`, a `23514` carrying `NOT_DEPLOYED` or `NOT_THIS_CHANGE` to itself, and
anything else to `UNSAVED`. `revertSentence(errorName, args, symbol?)` (`tx-errors.ts`) gains the cases below, each
followed by " Nothing was sent." as today; counts carry separators, and amounts read as native amounts with the chain's
symbol through `formatNative(value, symbol, 18)`, or as "<n> wei" without one. `classifyError(error, at, subject,
symbol?)` passes the symbol, which `runManage` takes from `ManageInput.nativeSymbol`.

```
ExceedsMaxSupply(requested, available)            Only <available> tokens are left to mint, not <requested>.
                                                  (1 left: Only 1 token is left to mint, not <requested>. 0 left: No tokens are left to mint.)
InsufficientEther(required, provided)             The airdrop fee is <required> and <provided> was sent. Read again for the current fee.
TransferToNonERC721ReceiverImplementer()          One recipient is a contract that cannot receive ERC-721 tokens. Send to wallets only.
ArrayLengthMismatch()                             The addresses and amounts do not line up. Reload and try again.
NothingToWithdraw()                               There is nothing to withdraw: the balance is 0.
WithdrawFailed()                                  The payout address did not accept the funds. Change the payout address, then withdraw again.
CreatorTokenBase__InvalidTransferValidatorContract()
                                                  There is no contract at that address on this chain. A validator must be a contract, or the zero address to remove the check.
ERC2981InvalidDefaultRoyalty(numerator, denominator)
                                                  The royalty cannot be more than 100%.
ERC2981InvalidDefaultRoyaltyReceiver(receiver)    The royalty recipient cannot be the zero address.
MintToZeroAddress()                               The zero address cannot mint or receive tokens.
```

`ArrayLengthMismatch`'s sentence was "The addresses and quotas do not line up. Reload and try again."; the new one
covers quotas too. `MintToZeroAddress` reads `ZERO_ADDRESS`. The validator's own errors are not in `validatorAbi`, so a
refused level call reads "The check against the contract failed: <short message>", as any undecoded error does.

## 7. The screens

### 7.1 The calls, the machine and the dialog

```ts
// apps/web/src/lib/manage/phase-calls.ts
export type ManageFunction = /* the eight Phases and Whitelist functions */ | 'airdropNFTs' | 'withdrawMintFunds'
  | 'setOwnerPayoutAddress' | 'setDefaultRoyalty' | 'setBaseURI' | 'setMintOnBehalfStatus' | 'setTransferValidator'
export type ValidatorFunction = 'setTransferSecurityLevelOfCollection'
export type CallTarget = { contract: 'validator'; address: Address }
export type ManageCall =
  | { [F in ManageFunction]: { functionName: F; args: ContractFunctionArgs<typeof collectionAbi, 'nonpayable' | 'payable', F>;
      value?: bigint; target?: undefined } }[ManageFunction]
  | { functionName: ValidatorFunction; args: ContractFunctionArgs<typeof validatorAbi, 'nonpayable', ValidatorFunction>;
      value?: undefined; target: CallTarget }
export type SentCall = { functionName: ManageFunction | ValidatorFunction; args: (string | boolean | string[])[];
  value?: string; target?: { contract: 'validator'; address: string } }
export type ExpectedEvent = /* the eight Phases and Whitelist events */
  | { eventName: 'NFTsAirdropped'; args: { recipients: bigint; amount: bigint } }
  | { eventName: 'MintFundsWithdrawn'; args: Record<string, never> }
  | { eventName: 'OwnerPayoutAddressUpdated'; args: { newOwnerPayoutAddress: Address } }
  | { eventName: 'DefaultRoyaltyUpdated'; args: { receiver: Address; feeNumerator: bigint } }
  | { eventName: 'MintOnBehalfUpdated'; args: { newStatus: boolean } }
  | { eventName: 'TransferValidatorUpdated'; args: { newValidator: Address } }
  | { eventName: 'BatchMetadataUpdate'; args: { fromTokenId: bigint; toTokenId: bigint } }
  | { eventName: 'SetTransferSecurityLevel'; args: { collection: Address; level: number } }
export const PHASE_FUNCTIONS: ReadonlySet<string>      // the seven Phases functions
export const SETTINGS_FUNCTIONS: ReadonlySet<string>   // the six Settings functions on the collection and the level call
export const airdropCalls: { batch(entries: BatchEntry[], feePerTokenWei: string): ManageCall
  burn(amount: number, feePerTokenWei: string): ManageCall }
export const settingsCalls: { withdraw(): ManageCall; payout(address: Address): ManageCall
  royalty(receiver: Address, bps: number): ManageCall; baseUri(uri: string): ManageCall; mintOnBehalf(on: boolean): ManageCall
  validator(address: Address): ManageCall; level(validator: Address, collection: Address, level: TransferLevelValue): ManageCall }
export function abiOf(call: ManageCall): typeof collectionAbi | typeof validatorAbi
```

- `airdropCalls.batch` sends the entries' addresses and amounts in order, with `value` the fee per token times their
  tokens; `burn` sends `[BURN_ADDRESS]` and `[amount]` under the same rule. `settingsCalls.level` carries `target: {
  contract: 'validator', address: validator }` and the arguments `[collection, level, false, false, false]`.
- `expectedEvent`: `airdropNFTs` gives `NFTsAirdropped(length, total)` (the fee is not compared);
  `withdrawMintFunds` gives `MintFundsWithdrawn` with no argument compared; `setOwnerPayoutAddress(a)`,
  `OwnerPayoutAddressUpdated(a)`; `setDefaultRoyalty(r, n)`, `DefaultRoyaltyUpdated(r, n)`;
  `setMintOnBehalfStatus(s)`, `MintOnBehalfUpdated(s)`; `setTransferValidator(v)`, `TransferValidatorUpdated` with
  `newValidator` v (the old one is not compared); `setBaseURI`, `BatchMetadataUpdate(1, 2^256 - 1)`; the level,
  `SetTransferSecurityLevel(collection, level)`.
- `sentOf` carries the value as a decimal string and the target with its address, strings and numbers as strings;
  `callOf` reverses it. `sentCallShape` gains `airdropNFTs` (1 to 500 checksummed addresses, as many amounts as decimal
  strings of 1 to 1,000, 1,000 tokens at most in total, `value` a required `uintText`), `withdrawMintFunds` (no
  argument), `setOwnerPayoutAddress` (a checksummed address, not zero), `setDefaultRoyalty` (a checksummed address, not
  zero, and basis points of 0 to 1,000), `setBaseURI` (a string `ipfsUriValid` accepts), `setMintOnBehalfStatus` (a
  boolean), `setTransferValidator` (a checksummed address, zero allowed) and `setTransferSecurityLevelOfCollection` (a
  checksummed address, a level of "0", "1" or "9", `false` three times, and a required target whose address is
  checksummed and not zero). A value or a target on another function is stripped.
- `reviewOf(call, chain)` names the arguments from `abiOf(call)` (a trailing underscore dropped, so
  `transferValidator`) and reads: `recipients` "<n> addresses" ("1 address"); `amounts` "<n> amounts, <t> tokens in
  total" ("1 amount, 1 token in total"); `feeNumerator` "<bps> (<percent>)", such as "750 (7.5%)"; `level` "<n>
  (<title>)", such as "9 (locked)", from "royalties enforced", "royalties not enforced" and "locked" (another level
  reads "<n>"); a zero validator "0x0000000000000000000000000000000000000000 (removes the check)"; other strings and
  addresses as they are; and, for a call with a value, a last row "Value", "<native> (<wei> wei)", such as "0.0004 ETH
  (400000000000000 wei)".

```ts
// apps/web/src/components/manage/manage-actions.ts
export type TxRequest = { contract: 'Collection' | 'Transfer validator'; functionName: string; args: { name: string; value: string }[] }
export type ManageRequest<T> = { call: ManageCall; review: TxRequest; confirm(hash: Hex): Promise<ActionResult<T>>
  pending?: { remember(hash: Hex): void; forget(): void } }
// apps/web/src/components/manage/manage-machine.ts
export type ManageInput = { /* as today */ nativeSymbol?: string }
export function rememberAirdropJob(store: KeyStore | null, collectionId: string, job: AirdropJob): void
export function airdropJob(store: KeyStore | null, collectionId: string): AirdropJob | null
export function forgetAirdropJob(store: KeyStore | null, collectionId: string): void
// apps/web/src/components/manage/transaction-dialog.tsx
export type TransactionDialogProps<T> = { /* as today */ blocked?: string | null }
```

- `realManageActions.simulate(call)` calls `simulateContract(config, { address: call.target?.address ??
  target.contract, abi: abiOf(call), functionName, args, value: call.value, chainId, account: wallet })` and sends the
  simulated request unchanged (rule 2). `ManageActions.review`, `TxRequest.check` and `valueWei`, and `sampleRequest`
  go; `ManageRequest.call` is never null (`ManageInput.call` stays nullable for "Check again").
- The machine's `NOT_CONFIRMED_YET` map gains `[AIRDROP_NOT_CONFIRMED, AIRDROP_TIMED_OUT]` and
  `[SETTINGS_NOT_CONFIRMED, SETTINGS_TIMED_OUT]`; `isTerminalManageAnswer` is unchanged (the new proofs refuse with its
  sentences); `runManage` passes `input.nativeSymbol` to `classifyError` at every step.
- The job store's key is `cobweb-airdrop:<collectionId>`, one job per collection. A stored value reads as none unless
  its kind is `airdrop` or `burn`; its batches are one or more non-empty lists of entries, each with a checksummed
  address and an integer amount of 1 to 1,000, at most 500 entries and 1,000 tokens a batch; `sent` is an integer from
  0 below the number of batches; `pending` is null or a 32-byte hash; and a burn is one batch of one entry to
  `BURN_ADDRESS` with a pending hash. Storage that is blocked or full keeps the job for the visit only, as the other
  stores do.
- `TransactionDialog` passes `nativeSymbol: chain.nativeSymbol`. The wallet step's detail reads "Your wallet shows a
  call to the <contract> contract and the gas for it." with the review's contract lowercased ("collection" or
  "transfer validator"), or for a call with a value "Your wallet shows a call to the collection contract, the <value>
  sent with it, and the gas for it." With `blocked` set, its sentence shows under the review in muted text and the
  action is off. `CallReview` loses its `valueWei` row; the Value row comes from `reviewOf`.
- `useManageActions()` throws "ManageActionsProvider is missing." without a provider, and the shared sample target
  (`sampleFallback`) goes: Phases, Whitelist, Airdrop, Settings and the Overview each provide theirs.

The dialog's copy, shared by every tab (each screen's own copy is in its section below):

| Where | Sentence | Change |
| --- | --- | --- |
| Wallet step detail | "Your wallet shows a call to the <contract> contract and the gas for it." | Was "Your wallet shows a call to the collection contract and the gas for it." |
| Wallet step detail, with a value | "Your wallet shows a call to the collection contract, the <value> sent with it, and the gas for it." | New |
| Under the review, the owner check | "This wallet is not the contract's owner. Changes on chain need <owner>." | New (`blocked`, `NOT_OWNER`) |
| Reviews | "Value", "<native> (<wei> wei)" | Moved from `valueWei` into `reviewOf` |
| Reviews | "<n> amounts, <t> tokens in total"; "<bps> (<percent>)"; "<n> (<title>)"; "(removes the check)" | New rows (section 7.1) |
| A simulation refused | The sentences of section 6.6, each followed by " Nothing was sent." | New and changed |

### 7.2 The browser's servers and the job

```ts
// apps/web/src/components/manage/airdrop-server.ts and settings-server.ts
export type AirdropServer = { read(): Promise<ActionResult<AirdropView>>; confirm(hash: Hex): Promise<ActionResult<AirdropView>> }
export function airdropServer(collectionId: string): AirdropServer
export type SettingsServer = { read(): Promise<ActionResult<SettingsView>>; confirm(hash: Hex, call: ManageCall): Promise<ActionResult<SettingsView>> }
export function settingsServer(collectionId: string): SettingsServer     // confirm sends sentOf(call)
// apps/web/src/components/manage/airdrop-job.ts, pure
export function frozenJob(rows: readonly Recipient[]): AirdropJob                   // airdrop, batchesOf(rows), sent 0, no hash
export function burnJob(amount: number, hash: Hex): AirdropJob                     // burn, one entry to BURN_ADDRESS, the hash
export function withPending(job: AirdropJob, hash: Hex | null): AirdropJob | null  // a burn without a hash is null
export function withConfirmed(job: AirdropJob): AirdropJob | null                 // sent + 1, no hash; null after the last batch
export function unsentTokens(job: AirdropJob): number
```

### 7.3 Airdrop

- The page (`manage/airdrop/page.tsx`) adds `requireUser()` and branches on `ctx.demo` as Whitelist does: the sample
  view, `sampleAirdropView(collection, wallet, { chainReachable, owner })` from `?chain=unreachable` and `?owner=other`
  (`DEMO_MINTER`), or `getAirdrop`, a refusal shown by `ManageUnavailable` titled "The airdrop could not be read".
  `maxDuration = 300`, the title "Airdrop" and the description "Send tokens straight to wallets, or burn some. Each
  token costs the airdrop fee and uses collection supply." stay; it renders `AirdropScreen` with `collection`, `view`,
  `wallet`, `sample`, `samplePending` (`?batch=pending`) and `snapshotChainIds` (as today).
- The screen keeps the view in state under its own `ManageActionsProvider`: `realManageActions` on the view's chain and
  contract with the session wallet, or `sampleManageActions` on `samplePhasesView(collection)` with the airdrop view's
  `maxSupply` and `totalMinted`; the server is `airdropServer` or its sample, and the snapshot prefers the view's
  chain. The job is read with `airdropJob(browserStore(), collection.id)` on mount (in sample mode, `sampleAirdropJob`
  for `?batch=pending`, else none), and every change to it is stored, except in sample mode.
- Under the heading, "Read from the chain <relative to readAt>" with "Read again" (the view replaced, or the refusal
  toasted). While unreachable, an alert "The contract could not be read": "The history below is Cobweb's record of the
  batches it confirmed. The fee and the tokens left to mint are not shown, and sending waits until the contract can be
  read." with "Read again". When the owner is not the session wallet, an alert "This wallet is not the contract's
  owner": "Changes on chain need <owner>." (the full checksummed address).
- The send and burn buttons follow the first reason that applies: while unreachable they are off with
  `UNREADABLE_REASON`; with the owner check they open their dialogs, whose action is off with `NOT_OWNER(owner)`
  (opening the send dialog then freezes and stores nothing); while the job has a pending hash they are off with
  "Confirm or discard the waiting transaction first."
- Recipients as today. The switch is off while a job exists, with "Finish or stop the airdrop in progress first." (an
  airdrop job) or "Confirm or discard the waiting burn first." (a burn job). A frozen job shows "Sending to <N> wallets
  in <B> transactions. The list is locked until every batch is sent." with "Stop and drop the unsent batches" (after a
  batch was sent: the job and the text go) or "Edit the list" (none sent: the job goes).
- The quote: Recipients, Tokens, Fee per token (the view's fee) and Total fee, both "Not read" while unreachable;
  Transactions, the number of `batchesOf(rows)` or of the job's batches; the "Exact" note as today and a new line "Up
  to 500 wallets and 1,000 tokens go in each transaction."; `SupplyNote` from the view's `left`, both rows "Not read"
  while unreachable; the allocation note as today; with a job, the batch list with "Sent", "Confirming" (the batch whose
  hash is pending), "Failed" (its sentence beneath), "Next" and "Waiting"; the over-supply alert and the button labels
  as today.
- "Send airdrop" or "Send batch 1 of <B>" freezes the list (`frozenJob`), stores it and opens the dialog on batch
  `sent`. The dialog keeps its copy: the title "Send batch <i> of <B>" or "Send airdrop", "<T> tokens to <W> wallets.
  They arrive as soon as the transaction confirms." ("1 token", "1 wallet", "It arrives"), the action "Send airdrop" and
  the success "<T> tokens airdropped" ("1 token airdropped"). A confirmed batch replaces the view and advances the job
  (`withConfirmed`; after the last batch the job and the text go); a failure marks the batch failed for the visit, and
  the button reads "Retry batch <n>".

```ts
// apps/web/src/components/manage/airdrop-dialogs.tsx (BurnDialog stays in airdrop-parts.tsx)
export function batchRequest(entries: BatchEntry[], feePerTokenWei: string, chain: SupportedChain,
  confirm: (hash: Hex) => Promise<ActionResult<AirdropView>>, pending: { remember(hash: Hex): void; forget(): void }): ManageRequest<AirdropView>
export function burnRequest(amount: number, feePerTokenWei: string, chain: SupportedChain,
  confirm: (hash: Hex) => Promise<ActionResult<AirdropView>>, pending: { remember(hash: Hex): void; forget(): void }): ManageRequest<AirdropView>
export function PendingBatchPanel(props: { job: AirdropJob; chain: SupportedChain; server: AirdropServer;
  onView(view: AirdropView): void; onConfirmed(): void; onDiscard(): void }): React.JSX.Element
```

- Both requests build the call with `airdropCalls`, the review `{ contract: 'Collection', functionName:
  'airdropNFTs', args: reviewOf(call, chain) }` and the server's confirm, and keep the hash in the job (`withPending`;
  a burn's `remember` stores `burnJob(amount, hash)`).
- The waiting batch (`PendingBatchPanel`) shows above the panels whenever the job has a pending hash: "A batch is
  waiting to be confirmed" ("A burn is waiting to be confirmed"), "This browser sent batch <i> of <B>: <T> tokens to
  <W> wallets. Cobweb lists it in History once the receipt and the transaction show the tokens minted." (a burn: "This
  browser sent a burn of <N> tokens to the dead address. Cobweb lists it in History once the receipt and the
  transaction show the tokens minted."), the transaction link (the hash as text without an explorer), "Check again"
  (the machine from verifying, its step "Reading the batch", "Cobweb checks the receipt and the recipients and amounts
  the transaction carried, then reads the contract again."; the toast "The batch is on chain" or "The burn is on
  chain"; a terminal refusal is toasted and forgets the hash) and "Discard", above the line "Discard only a
  transaction that failed or never left your wallet. If it landed, sending the batch again mints its tokens twice."
  Discard forgets the hash (a burn job goes) and marks the batch failed for the visit with "Discarded before it was
  confirmed."
- Burn: `BurnQuantity` and the burn quote as today, the dead address shown as `shortAddress(BURN_ADDRESS, 6)`
  ("0x000000…00dEaD"). `burnError(quantity, left)` gains "Burn up to 1,000 tokens at a time." after its two checks, and
  the field's help reads "Up to 1,000 at a time. <left> are left to mint." when more than 1,000 are left (else today's
  "Up to <left>, the tokens left to mint."). "Burn <N> tokens" opens `BurnDialog`, which keeps its copy, its rows and
  the typed "burn N", takes `blocked`, and sends `burnRequest` once the phrase matches.
- History gains the description "Batches Cobweb confirmed. Airdrops sent from outside Cobweb are not listed.";
  `AirdropHistory`, `airdropHistoryCsv` and `tokenRange` take `AirdropRow` (When is `confirmedAt` with its time
  relative to the view's `readAt`, Kind comes from `kind`, Token ids from the first and last id); "Export CSV" as today.
- `parseRecipients` with `onDuplicate: 'sum'` leaves out a line whose amount takes its address past `maxAmount`, with
  "With its earlier lines, the <amountName> for this address passes <max>." The earlier sum stays, and the line is not
  counted as merged.

| Where | Sentence | Change |
| --- | --- | --- |
| Under the heading | "Read from the chain <relative to readAt>", "Read again" | New on this tab (Whitelist's words) |
| Alert, the chain unreachable | "The contract could not be read" / "The history below is Cobweb's record of the batches it confirmed. The fee and the tokens left to mint are not shown, and sending waits until the contract can be read." / "Read again" | New |
| Alert, the owner check | "This wallet is not the contract's owner" / "Changes on chain need <owner>." | New |
| Send and burn, unreachable | "The contract could not be read, so changes on chain wait until it can be." | Reused (`UNREADABLE_REASON`) |
| Dialog action, the owner check | "This wallet is not the contract's owner. Changes on chain need <owner>." | New (`NOT_OWNER`) |
| Send and burn, a pending hash | "Confirm or discard the waiting transaction first." | New |
| Switch help, a burn job | "Confirm or discard the waiting burn first." | New |
| Quote, unreachable | "Not read" (Fee per token, Total fee, Left to mint, the after row) | New |
| Quote | "Up to 500 wallets and 1,000 tokens go in each transaction." | New |
| Batch list | "Confirming"; under "Failed", its sentence or "Discarded before it was confirmed." | New |
| Send dialog, one token or wallet | "1 token to 1 wallet. It arrives as soon as the transaction confirms."; "1 token airdropped" | Singular forms of today's copy |
| Waiting batch | "A batch is waiting to be confirmed" / "A burn is waiting to be confirmed" | New |
| Waiting batch | "This browser sent batch <i> of <B>: <T> tokens to <W> wallets. Cobweb lists it in History once the receipt and the transaction show the tokens minted." | New |
| Waiting burn | "This browser sent a burn of <N> tokens to the dead address. Cobweb lists it in History once the receipt and the transaction show the tokens minted." | New |
| Waiting batch, checking | "Reading the batch" / "Cobweb checks the receipt and the recipients and amounts the transaction carried, then reads the contract again." | New |
| Waiting batch | "Discard only a transaction that failed or never left your wallet. If it landed, sending the batch again mints its tokens twice." | New |
| Toasts | "The batch is on chain" / "The burn is on chain" | New |
| History | "Batches Cobweb confirmed. Airdrops sent from outside Cobweb are not listed." | New |
| Recipients, a repeat | "With its earlier lines, the quantity for this address passes 1,000." | New |
| Burn field | "Burn up to 1,000 tokens at a time."; "Up to 1,000 at a time. <left> are left to mint." | New |
| Dead address | "0x000000…00dEaD" | Was "0x000000…00dead" |
| Not confirmed in time | `AIRDROP_TIMED_OUT` (section 6.6) | New |

### 7.4 Settings

- The page adds `requireUser()` and keeps `stageContext(..., { art })`: the sample view, `sampleSettingsView(collection,
  wallet, { chainReachable, owner, art })` from `?chain=`, `?owner=` and `?art=`, or `getSettings`, a refusal shown by
  `ManageUnavailable` titled "The settings could not be read". The title and the description "Withdraw proceeds, the
  payout address, royalties and reveal. Advanced holds tradability and mint on behalf." stay; it renders
  `SettingsScreen` with `collection`, `view`, `wallet` and `sample`.
- The screen keeps the view in state under its own provider (`realManageActions` on the view's chain and contract, or
  `sampleManageActions(() => samplePhasesView(collection), sampleSent, () => viewRef.current)`), with
  `settingsServer` or its sample; every confirmed change answers a view that replaces it, and the dialogs' `at` freeze
  stays.
- Under the heading, "Read from the chain <relative to readAt>" with "Read again". While unreachable, an alert "The
  contract could not be read": "These are the payout address, royalties, metadata and transfer validator Cobweb last
  read, on <UTC>. Balances and the transfer level are not shown, and changes on chain wait until it can be read." with
  "Read again"; every button and the switch are then off with `UNREADABLE_REASON` as their title. The owner check shows
  Airdrop's alert, and every dialog opens with its action off (`blocked: NOT_OWNER(owner)`).
- Money: "Withdraw proceeds" with today's description; "Your balance" (`creatorBalanceWei`, "Not read"); "Withdraw"
  (off at 0 or not read); the rows "Withdrawn so far" (`withdrawnWei`), "Platform fees, paid to Cobweb"
  (`platformBalanceWei`, "Not read") and "Platform fees per token" ("<flat> + <bps> per mint, <airdrop> per airdrop",
  such as "0.0001 ETH + 1% per mint, 0.00005 ETH per airdrop", or "Not read"); when `pendingBalanceWei` is above 0,
  "Refunds held for this wallet" with "The contract could not send these back. This wallet can claim them from the
  contract." "Payout address" and "Royalties" as today, from the view.
- Metadata: "Reveal" with today's description; the badge "Revealed", "Placeholder" or "Custom" from `pointer`; the
  button "Reveal" (placeholder) or "Change metadata" (revealed or custom), off while `!realArtRendered` with today's
  sentence; "Base URI <baseUri>".
- Advanced: `TradabilitySettings`, then "Mint on behalf" as today (On or Off, the switch opening the dialog).
  `TradabilitySettings(props: { view: SettingsView; chain: SupportedChain; off: string | null; blocked: string | null;
  confirm(hash: Hex, call: ManageCall): Promise<ActionResult<SettingsView>>; onConfirmed(view: SettingsView): void })`
  shows "Transfer validator" with the address ("Not read" while the copy is null), the badge "Limit Break default"
  (`DEFAULT_TRANSFER_VALIDATOR`), "No validator" (the zero address) or "Custom", and "Change validator"; then
  "Transfers" with today's description and, by `level`: null, "Not read"; `none/no-code`, "<chain> has no transfer
  validator, so transfers cannot be locked there."; `none/zero`, "No validator is set, so transfers are not checked.";
  `unread`, "The validator did not answer for this collection, so its level is not shown."; levels 0, 1 and 9, today's
  three badges; another level, "Level <n>, set outside Cobweb". "Change level" shows for `unread` and `level` only,
  destructive while enforced, as today.

```ts
// apps/web/src/components/manage/settings-dialogs.tsx and tradability.tsx
type SettingsDialogBase = { open: boolean; onOpenChange(open: boolean): void; chain: SupportedChain; blocked: string | null
  confirm(hash: Hex, call: ManageCall): Promise<ActionResult<SettingsView>>; onConfirmed(view: SettingsView): void }
export function PayoutDialog(props: SettingsDialogBase & { current: Address }): React.JSX.Element
export function RoyaltyDialog(props: SettingsDialogBase & { receiver: Address; bps: number }): React.JSX.Element
export function RevealDialog(props: SettingsDialogBase & { current: string; targets: RevealTargets; pointer: RevealPointer }): React.JSX.Element
function ValidatorDialog(props: SettingsDialogBase & { current: Address }): React.JSX.Element
function LevelDialog(props: SettingsDialogBase & { validator: Address; collection: Address; current: number | null }): React.JSX.Element
```

- Each dialog builds its call with `settingsCalls`, the review `{ contract, functionName, args: reviewOf(call, chain) }`
  ("Transfer validator" for the level, else "Collection") and `confirm: (hash) => props.confirm(hash, call)`; its
  request stays null while nothing would change, as today.
- Withdraw (in the screen) keeps its copy and its rows "Amount" (the balance when it opened) and "To" (the payout), and
  sends `settingsCalls.withdraw()`. Payout and Royalties keep their copy and checks; the review names
  `newOwnerPayoutAddress`, and `receiver` with `feeNumerator`.
- Reveal offers, in this order, "Rendered metadata", "From the art you locked and rendered on Cobweb." (with a real
  job); "Placeholder", "The placeholder every token showed before the reveal." (with a placeholder job); and "Another
  IPFS link", "A metadata link you pinned yourself: a folder ending in / gives each token its own file, and a single
  file is shown for every token." (always). It opens on the first source offered that differs from the current base
  URI, and " (now)" follows the one that equals it. With "Another IPFS link", today's red alert ("Check the link before
  you confirm", "Pointing the collection at the wrong IPFS link breaks the art and metadata of every token already
  minted. Check the CID before you confirm.") and the field "IPFS link", placeholder "ipfs://bafy.../", error
  `IPFS_LINK_INVALID`. "Token 1 now" is `tokenUriOf(current)` and "Token 1 after" `tokenUriOf(target)`, or "Enter a
  link". The title is "Reveal the art" while the pointer is the placeholder, else "Change the metadata" with "Holders
  and marketplaces see the new metadata once this confirms. Marketplaces refresh on the metadata update event, which
  can take a few minutes." The action and the success follow the source: "Reveal" and "Metadata updated. The
  collection is revealed."; "Use the placeholder" and "Metadata updated. Every token shows the placeholder."; "Use
  this link" and "Metadata updated. The collection points at your link." It is destructive with "Another IPFS link",
  as today. The `singleAsset` prop and `withSlash` go: the targets are the jobs' `base_uri` values, exact.
- Mint on behalf keeps its copy and sends `settingsCalls.mintOnBehalf(!current)`. Validator keeps its copy, and "Use the
  Limit Break default" fills `DEFAULT_TRANSFER_VALIDATOR`; it sends `settingsCalls.validator(address)`. Level keeps its
  copy; its options carry their `TRANSFER_LEVELS` value in place of the old `arg` strings, " (now)" follows the current
  level when it is read, and it sends `settingsCalls.level(view.transferValidator, view.contract, value)`.

| Where | Sentence | Change |
| --- | --- | --- |
| Under the heading | "Read from the chain <relative to readAt>", "Read again" | New on this tab |
| Alert, the chain unreachable | "The contract could not be read" / "These are the payout address, royalties, metadata and transfer validator Cobweb last read, on <UTC>. Balances and the transfer level are not shown, and changes on chain wait until it can be read." / "Read again" | New |
| Alert, the owner check | "This wallet is not the contract's owner" / "Changes on chain need <owner>." | New |
| Buttons, unreachable | "The contract could not be read, so changes on chain wait until it can be." | Reused (`UNREADABLE_REASON`) |
| Dialog action, the owner check | "This wallet is not the contract's owner. Changes on chain need <owner>." | New (`NOT_OWNER`) |
| Your balance, Platform fees, the fee rates | "Not read" | New |
| Money row | "Platform fees per token" / "<flat> + <bps> per mint, <airdrop> per airdrop" | New |
| Money row, above 0 | "Refunds held for this wallet" / "The contract could not send these back. This wallet can claim them from the contract." | New |
| Reveal badge | "Placeholder" | Was "Not revealed" |
| Reveal badge | "Custom" | New |
| Validator | "No validator"; "Not read" | New |
| Transfers | "No validator is set, so transfers are not checked." | New |
| Transfers | "The validator did not answer for this collection, so its level is not shown." | New |
| Transfers | "Level <n>, set outside Cobweb"; "Not read" | New |
| Transfers | "<chain> has no transfer validator, so transfers cannot be locked there." | Kept; now shown when the validator has no code |
| Reveal dialog | "Change the metadata" / "Holders and marketplaces see the new metadata once this confirms. Marketplaces refresh on the metadata update event, which can take a few minutes." | New |
| Reveal source | "Placeholder" / "The placeholder every token showed before the reveal." | New |
| Reveal source | "Another IPFS link" / "A metadata link you pinned yourself: a folder ending in / gives each token its own file, and a single file is shown for every token." | Was "Another IPFS folder" / "A metadata CID you pinned yourself." |
| Reveal field | "IPFS link", placeholder "ipfs://bafy.../", error "Enter a full ipfs:// link with its CID." | Was "Metadata CID", "bafy...", "That does not look like an IPFS CID." |
| Reveal sources | " (now)" | New |
| Token 1 after | "Enter a link" | Was "Enter a CID" |
| Reveal actions | "Use the placeholder"; "Use this link" | New ("Reveal" stays) |
| Reveal success | "Metadata updated. Every token shows the placeholder."; "Metadata updated. The collection points at your link." | New ("Metadata updated. The collection is revealed." stays) |
| Reviews | `newOwnerPayoutAddress`; `receiver`, `feeNumerator` "750 (7.5%)"; `newBaseURI`; `status`; `transferValidator` with "(removes the check)"; `collection`, `level` "9 (locked)" and three flags "false" | From the ABI (were the sample's names) |
| Not confirmed in time | `SETTINGS_TIMED_OUT` (section 6.6) | New |

### 7.5 The Overview

- The page adds `requireUser()` and reads `getDeployment`, `getPhases` and `getSettings` together; any refusal shows
  `ManageUnavailable` titled "The drop could not be read", as today. Sample mode passes `sampleSettingsView(collection,
  wallet, { art })` with `DEMO_DEPLOYMENT`'s contract and deploy time.
- `OverviewScreenProps` replaces `deployment: Deployment` and `realArtRendered` with `contract: Address`, `deployedAt:
  number`, `settings: SettingsView`, `wallet: Address` and `sample: boolean`, and gains `paidByMintersWei: string |
  null` (`DEMO_ACTIVITY.proceeds.grossWei` in sample mode, null on real data); `activity` stays for holders and recent
  mints. The screen provides its own `ManageActionsProvider`, as Settings does, and the page's seam comment goes: the
  Overview no longer reads `DEMO_DEPLOYMENT`'s base URI, fees, royalty or payout on real data.
- `ContractPointer` reads "Revealed, <short cid>", "Placeholder (unrevealed)" or "Custom, <short cid>" from the view's
  pointer, and "Reveal" (placeholder) or "Change" (else), off while `!realArtRendered` with today's title. It opens the
  same `RevealDialog` with the view's targets and the owner check's `blocked`; a confirmed change replaces the view.
  `shortCid` takes the CID from the URI (the part after `ipfs://` and before the next "/"), so
  `ipfs://<cid>/metadata.json` shows its CID.
- Proceeds: "Withdrawable now" from `creatorBalanceWei` ("Not read" while unreachable), "Already withdrawn" from
  `withdrawnWei`, and "Paid by minters" only when `paidByMintersWei` is set; "Withdraw proceeds" links to Settings, as
  today.

| Where | Sentence | Change |
| --- | --- | --- |
| Points at | "Custom, <short cid>" | New ("Revealed, <short cid>" and "Placeholder (unrevealed)" stay) |
| Withdrawable now, unreachable | "Not read" | New |
| Paid by minters | Not shown on real data | Changed (sample mode keeps it) |
| Reveal from the Overview | The Settings Reveal dialog's copy (section 7.4) | Changed with it |

## 8. Sample mode

```ts
// apps/web/src/components/manage/airdrop-sim.ts
export function sampleAirdropView(collection: { max_supply: number | null }, wallet: Address,
  options?: { chainReachable?: boolean; owner?: Address }): AirdropView
export function sampleApplyAirdrop(call: ManageCall, view: AirdropView, hash: Hex): AirdropView
export function sampleAirdropServer(current: () => AirdropView, sent?: Map<Hex, ManageCall>): AirdropServer
export function sampleAirdropJob(view: AirdropView): AirdropJob
// apps/web/src/components/manage/settings-sim.ts
export function sampleSettingsView(collection: { max_supply: number | null }, wallet: Address,
  options?: { chainReachable?: boolean; owner?: Address; art?: string }): SettingsView
export function sampleApplySettings(call: ManageCall, view: SettingsView): SettingsView
export function sampleSettingsServer(current: () => SettingsView): SettingsServer
// apps/web/src/components/manage/manage-sim.ts, changed
export function sampleManageActions(current: () => PhasesView, sent?: Map<Hex, ManageCall>, settings?: () => SettingsView): ManageActions
export function sampleRevert(call: ManageCall, view: PhasesView, settings?: SettingsView): ContractFunctionRevertedError | null
```

- `sampleAirdropView` is the Base sample (`DEMO_DEPLOYMENT`'s chain and contract): the fee
  `ethFees.airdropFeePerTokenWei` (0.00005 ETH), the supply `sampleSupply(collection.max_supply,
  DEMO_COLLECTION.maxSupply)` with minted from `scaleSampleToSupply`, `DEMO_AIRDROPS` as rows (10 tokens to 4 wallets
  from #1, then the burn of 2 from #11, at blocks 21499990 and 21499995, `confirmedAt` their `at`), and the owner the
  session wallet, or `DEMO_MINTER` for `?owner=other`; unreachable, the copy the core builds. `DEMO_AIRDROPS` and
  `AirdropRecord` stay as sample-only shapes, mapped here.
- `sampleApplyAirdrop` adds the call's row as `airdrop_record` would (ids after the minted total, the fee times the
  tokens, the next block, the kind from the recipients) and its tokens to minted. `sampleAirdropServer` answers after
  900 ms; `confirm` applies the call the simulated wallet sent with that hash, or, for a hash it never sent
  (`?batch=pending`), the first unsent batch of `sampleAirdropJob`.
- `sampleAirdropJob` is a frozen job of two batches (2 wallets with 3 tokens, then 1 wallet with 1 token) whose first
  batch is pending with `sampleTxHash(40)`.
- `sampleSettingsView`: the balances from `DEMO_ACTIVITY.proceeds` (`withdrawableWei`, `platformFeesWei`,
  `withdrawnWei`), no pending refund, the fees `ethFees`, the payout and royalty of `DEMO_DEPLOYMENT`, the targets
  `ipfs://<DEMO_RENDER_JOBS.done.metadataCid>/` (none for `?art=deferred`) and `ipfs://<DEMO_PLACEHOLDER.cid>/metadata.json`
  with the latter as the start, the base URI the placeholder's (the real target for `?art=revealed`), mint on behalf
  off, `DEFAULT_TRANSFER_VALIDATOR` at level 0, and the owner as Airdrop's; unreachable, the copy.
- `sampleApplySettings` applies a call as the chain would and a read would show it: the withdraw moves the balance
  into the withdrawn sum; the payout, the royalty, the base URI (and the pointer), mint on behalf and the validator take
  the call's values (the zero address reads `none/zero`, any other address level 0); the level call sets the level.
  `sampleSettingsServer` answers after 900 ms with the call applied.
- `sampleRevert` gains `airdropNFTs` with unequal lengths (`ArrayLengthMismatch`) or more tokens than `maxSupply -
  totalMinted` (`ExceedsMaxSupply(total, available)`), and `withdrawMintFunds` with a settings balance of 0
  (`NothingToWithdraw`); `sampleApply` lists the new functions and changes no group. The simulated wallet (Approve,
  Reject, "Approve, then revert") and the timings are as today.
- States: Airdrop `?batch=pending` (the waiting batch), `?chain=unreachable` and `?owner=other`; Settings
  `?chain=unreachable`, `?owner=other`, `?art=deferred` (no real job, so Reveal is off) and `?art=revealed`; the
  Overview `?art=deferred` and `?art=revealed`.

## 9. Stage rules

Unchanged: Manage drop opens once the collection is deployed, and in sample mode before. The Airdrop, Settings and
Overview pages branch on `ctx.demo` as Phases does: sample mode shows the sample views on any collection; otherwise
they read the record and the chain.

## 10. Testing

- Unit tests change in `phase-calls` (each new builder's encoding against a hand-written signature, the value and the
  target, `expectedEvent` for each new call, `abiOf`, `reviewOf`'s new rows and its Value row, the `SentCall` round
  trip with a value and a target), `phase-schemas` (each new member; a 501st recipient, a 1,001st token, a missing
  value, a royalty of 1,001, a URI without `ipfs://` or past 512 characters, a level of 2, a level call without a
  target; the function filters), `phase-events` (each new variant, an address in another case, a number argument, the
  validator's ABI and address, the decoded arguments returned), `manage-actions` (the simulation gets the value, and the
  validator's address and ABI), `manage-machine` (polling to `AIRDROP_TIMED_OUT` and `SETTINGS_TIMED_OUT`; the job
  store, its malformed values read as none; the symbol in a sentence), `manage-sim` (the new `sampleRevert` cases),
  `tx-errors` (each new sentence, its singular and zero forms, amounts with and without a symbol), `recipients` (a
  repeat past 1,000 left out with its line), `holders` (the dead address from `BURN_ADDRESS`) and the shared
  `collection` tests. New: `validator-abi.test.ts`; `airdrop-batch.test.ts` (a batch and a burn from
  `encodeFunctionData` and logs from `encodeEventTopics`; consecutive ids out of order accepted; each refusal of 6.3);
  `airdrop-view.test.ts` (`batchesOf` by recipients and by tokens in the list's order, `airdropRowsOf`, the copy);
  `settings-view.test.ts` (`pointerOf`, `tokenUriOf` with and without the slash and empty, `levelOf`, `ipfsUriValid`,
  the copy); `airdrop-job.test.ts`; `airdrop-sim.test.ts` and `settings-sim.test.ts`.
- `verify:local`, 342 plus 21 (363): two in the anon loop, "anon: reads nothing from airdrops" and "anon: reads nothing
  from withdrawals", and 19 in a section 9m on a collection recorded as deployed as 9k records one, beside a draft:
  1. "deployments: a new deployment reads transfer_validator null and mint_on_behalf false"
  2. "airdrops and withdrawals: the owner reads nothing before a record, and a client insert, update or delete is
     refused"
  3. "airdrop_record: a signed-out caller and the owner's session cannot execute it"
  4. "airdrop_record: a draft is refused as not deployed, another owner as not found"
  5. "airdrop_record: a malformed hash, sender or kind is refused as not this change"
  6. "airdrop_record: a burn to two recipients, an id range that does not match the tokens, or a negative fee is
     refused"
  7. "airdrop_record: records the batch and answers true; the owner reads it and B reads nothing"
  8. "airdrop_record: a second record of the hash answers false and changes nothing"
  9. "airdrops: the owner cannot update or delete a recorded row"
  10. "withdrawal_record: a signed-out caller and the owner's session cannot execute it"
  11. "withdrawal_record: a draft is refused as not deployed, another owner as not found, a malformed hash or payout
      address as not this change"
  12. "withdrawal_record: an amount of 0 is refused"
  13. "withdrawal_record: records the withdrawal and answers true; the owner reads it and B reads nothing"
  14. "withdrawal_record: a second record of the hash answers false and changes nothing; the owner cannot update or
      delete the row"
  15. "settings_refresh: a signed-out caller and the owner's session cannot execute it"
  16. "settings_refresh: a draft is refused as not deployed, another owner as not found"
  17. "settings_refresh: writes the six copies, state_block and state_read_at, and answers true"
  18. "settings_refresh: an older block answers false and writes nothing; the same block is accepted"
  19. "settings_refresh: a royalty of 1,500 is copied; 10,001, a malformed address or a missing key is refused; the
      owner cannot update a copy"

  Each refusal is checked by its SQLSTATE and its words: `42501` with 'permission denied for function ...' for an
  execute refused and 'collection not found' for another owner; `23514` with 'The contract is not deployed yet.' or
  'The transaction did not make this change.', or with the constraint's name for a table check; `23502` for a missing
  key.
- `verify:airdrop` (new, `scripts/verify-airdrop.ts` on `deploy-fixture.ts`, run as `verify:whitelist` is;
  `removeFixtures` also checks that no `airdrops` or `withdrawals` row is left). Batches are built with `airdropCalls`,
  simulated as wagmi does and sent from the creator's key; the platform admin is Anvil's first account
  (`0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`, the factory admin `DeployLocal` sets), sent as an unlocked JSON-RPC
  account. The fixture is deployed with Public (free, allocation 3, 1 per wallet), so its supply is 3. (1) The chain is
  ready. (2) `airdropViewCore` reads max supply 3, minted 0, left 3, the fee 0, the owner the creator, no history,
  `chainReachable`. (3) The admin's `setFees(0, 0, 100000000000000)` lands and the view reads the fee as
  100000000000000 wei. (4) A short value is refused: a one-token batch simulated with 1 wei less reads, through
  `classifyError` with the symbol, "The airdrop fee is 0.0001 ETH and 0.000099999999999999 ETH was sent. Read again for
  the current fee. Nothing was sent.", and no row is written. (5) Two fresh wallets with one token each (value
  200000000000000) are sent and confirmed through `confirmAirdropCore`: one row (airdrop, 2 recipients, 2 tokens, fee
  200000000000000, ids 1 to 2, the receipt's block, sent by the creator), `ownerOf(1)` and `ownerOf(2)` the
  recipients, minted 2 and left 1, `platformBalance()` 200000000000000. (6) The same hash confirmed again answers the
  same view, and `airdrop_record` with the same arguments answers false: one row still. (7) Over supply is refused: a
  two-token batch reads "Only 1 token is left to mint, not 2. Nothing was sent." (8) A contract recipient is refused: a
  one-token batch to the factory reads "One recipient is a contract that cannot receive ERC-721 tokens. Send to wallets
  only. Nothing was sent." (9) A burn of one (`airdropCalls.burn`) is confirmed: a burn row (1 recipient, 1 token, ids 3
  to 3), `ownerOf(3)` the dead address, left 0, the history newest first. (10) Proofs refused, recording nothing: the
  `setFees` hash (`NOT_FROM_WALLET`), an Open of Public from the creator (`NOT_THIS_CHANGE`), the fixture's deploy
  hash (`NOT_THIS_CONTRACT`). (11) A stranger's session reads no deployment and no rows: `airdropViewCore` and the
  confirm of the airdrop's hash answer `NOT_DEPLOYED`, a read of `airdrops` answers nothing, and `airdrop_record` from
  the stranger's client is refused (`42501`). (12) The owner check: after `transferOwnership(stranger)` from the
  creator, the view's owner is the stranger, and a batch simulated from the creator reads "Only the contract's owner
  can make this change, and <creator> is not the owner. Nothing was sent."; the stranger hands it back and the view
  reads the creator. (13) The failure path: `airdropViewCore(ctx, async () => null)` answers both rows with the owner,
  the fee, minted and left null and `chainReachable` false. (14) The gas of a full batch: a collection of supply 1,000
  (one Public group, free, allocation 1,000) deployed through the factory from the creator with
  `encodeCollectionArgs` and the fixture's `deploy` (not recorded in Cobweb), the same `setFees` on it, then one batch of 500 fresh wallets with 2 tokens each (1,000 tokens, value
  100000000000000000) lands; `proveAirdrop` on its receipt and input answers 500 recipients, 1,000 tokens and ids 1 to
  1,000; the script prints the gas used and says when it is above 16,777,216; the check fails only if the batch does
  not land. (15) Cleanup: the run leaves no job, deployment, phase, whitelist entry, airdrop, withdrawal, collection or
  user behind.
- `verify:settings` (new, `scripts/verify-settings.ts` on `deploy-fixture.ts`; changes built with `settingsCalls` and
  `phaseCalls`, simulated as wagmi does and sent from the creator's key). The fixture is deployed with Public (0.001
  ETH, allocation 3, 2 per wallet), the royalty 5% to the creator and the payout the creator. (1) The chain is ready.
  (2) `settingsViewCore` reads the owner the creator, balances 0, withdrawn 0, fees (0, 0, 0), the payout, 500 bps to
  the creator, the base URI the real job's `ipfs://<CID('e')>/` with the pointer revealed and no placeholder,
  `realArtRendered`, mint on behalf off, the validator `0x721C008fdff27BF06E7E123956E2Fe03B63342e3` at `none/no-code`;
  `DEFAULT_TRANSFER_VALIDATOR()` equals the shared constant; the copies equal the read at its `state_block`, with
  `transfer_validator` set. (3) Nothing to withdraw: `withdrawMintFunds()` simulated reads "There is nothing to
  withdraw: the balance is 0. Nothing was sent.", and no row is written. (4) Withdraw: Public opened through
  `confirmPhaseTxCore`, the stranger mints one for 0.001 ETH, and the view reads the balance 1000000000000000;
  `withdrawMintFunds()` confirmed through `confirmSettingsTxCore` writes one `withdrawals` row (1000000000000000 wei,
  the creator, the receipt's block), and the view reads the balance 0 and withdrawn 1000000000000000. (5) The same
  hash confirmed again answers the same view, and `withdrawal_record` answers false: one row still. (6) The payout: a
  fresh address confirmed reads in the view and in `deployments.payout_address`, `readDeployment` still answers the
  creator (from `args`), and the zero address is refused by the shape (`UNSAVED`), never sent. (7) The royalty: 750 bps
  to a fresh address confirmed reads in the view, in `royaltyInfo(1, 10000)` and in the copies; 1,001 bps is refused by
  the shape. (8) A custom URI: `setBaseURI('ipfs://<CID('f')>/')` confirmed reads the pointer custom, the copy, and
  `tokenURI(1)` `ipfs://<CID('f')>/1`. (9) Back to the real job: its `base_uri` confirmed reads the pointer revealed;
  the custom change's hash confirmed as the real URI's call answers `NOT_THIS_CHANGE` (its calldata carried the other
  URI) and changes nothing. (10) Mint on behalf on, then off: each confirmed reads in the view and the copy. (11) The
  validator: the zero address confirmed reads `none/zero` and the copy; the default, simulated, reads "There is no
  contract at that address on this chain. A validator must be a contract, or the zero address to remove the check.
  Nothing was sent." (no code at the default on Anvil). (12) An older block: `settings_refresh` with `state_block - 1`
  and other values answers false, and the copies keep the last read. (13) Proofs refused, changing nothing: the
  royalty's hash as a payout change (`NOT_THIS_CHANGE`), the stranger's mint (`NOT_FROM_WALLET`), the fixture's deploy
  hash (`NOT_THIS_CONTRACT`), and a level call targeting the factory confirmed with the mint on behalf hash
  (`NOT_THIS_CONTRACT`, the target not being the collection's validator). (14)
  A stranger's session: `settingsViewCore` and the withdraw's confirm answer `NOT_DEPLOYED`, a read of `withdrawals`
  answers nothing, and `settings_refresh` from the stranger's client is refused (`42501`). (15) The owner check: after
  `transferOwnership(stranger)`, the view's owner is the stranger and `setMintOnBehalfStatus(true)` simulated from the
  creator reads "Only the contract's owner can make this change, and <creator> is not the owner. Nothing was sent.";
  ownership comes back. (16) The failure path: `settingsViewCore(ctx, async () => null)` answers the copies, the
  withdrawn sum, balances, fees and level null, `chainReachable` false and `readAt` the copy's time. (17) Cleanup.
- `pnpm typecheck && pnpm lint && pnpm test && pnpm format:check`, `pnpm build`, every verify script.
- A browser walk with the dev wallet on local Supabase, local storage and Anvil (`chain:local`, the dev wallet signer,
  Playwright with `inject.js`), on two fresh collections, each locked, paid, rendered by `render:local` and deployed:
  "Airdrop Walk 1" (12 tokens, on its real job, Public at 0.001 ETH with an allocation of 12 and 2 per wallet) and
  "Reveal Walk 1" (4 tokens with "Reveal later", on its placeholder). After each deploy, Anvil's first account (the
  factory admin) sets the airdrop fee with `cast send <collection> "setFees(uint256,uint256,uint256)" 0 0
  100000000000000`. Each step, with the copy it must show:
  1. Airdrop reads "Read from the chain under a minute ago" with "Read again", Fee per token "0.0001 ETH", Left to mint
     "12", and History "No airdrops yet. Each one you send is listed here." under "Batches Cobweb confirmed. Airdrops
     sent from outside Cobweb are not listed."
  2. Paste three wallets (2, 1 and 1 tokens) and a fourth line repeating the first with 999: the preview reads Valid 3,
     Total tokens 4, Rejected 1, "1 line was left out" and Line 4 "With its earlier lines, the quantity for this
     address passes 1,000."; the quote Recipients 3, Tokens 4, Fee per token "0.0001 ETH", Transactions 1, Total fee
     "0.0004 ETH", "Up to 500 wallets and 1,000 tokens go in each transaction.", Left to mint 12 and After this airdrop
     8.
  3. "Send airdrop" opens "Send airdrop" with "4 tokens to 3 wallets. They arrive as soon as the transaction confirms."
     and the review "Sends to the collection on Anvil", `airdropNFTs`, recipients "3 addresses", amounts "3 amounts, 4
     tokens in total", Value "0.0004 ETH (400000000000000 wei)". Reject in the wallet reads "Cancelled in your wallet" /
     "Nothing was sent and no gas was spent. Try again when you are ready.", and Batch 1 reads "Failed" with that
     sentence and "Retry batch 1". The retry runs "Checking the change", "Confirm in your wallet" ("Your wallet shows a
     call to the collection contract, the 0.0004 ETH sent with it, and the gas for it."), "Confirming on Anvil" and
     "Reading the contract" to the toast "4 tokens airdropped"; History lists Airdrop, 3, 4, "#1 to #4", "0.0004 ETH"
     and the hash as text; Left to mint reads 8, and the list is empty again.
  4. A one-line list with the factory's address reads, at "Checking the change", "The change would fail" / "One
     recipient is a contract that cannot receive ERC-721 tokens. Send to wallets only. Nothing was sent."; "Back to
     edit", then "Edit the list", unfreezes it.
  5. Two wallets with one token each, reloaded at "Confirming on Anvil": the panel "A batch is waiting to be confirmed"
     / "This browser sent batch 1 of 1: 2 tokens to 2 wallets. Cobweb lists it in History once the receipt and the
     transaction show the tokens minted.", the hash, "Check again", "Discard" and "Discard only a transaction that
     failed or never left your wallet. If it landed, sending the batch again mints its tokens twice."; the send button
     off with "Confirm or discard the waiting transaction first."; "Check again" shows "Reading the batch" and toasts
     "The batch is on chain", and History gains "#5 to #6". A job planted with an unknown hash and discarded reads
     batch 1 "Failed" with "Discarded before it was confirmed." and "Retry batch 1"; "Edit the list" clears it.
  6. Burn: "Burn instead of sending", Tokens to burn 2: "Burn 2 tokens to 0x000000…00dEaD", Tokens 2, Fee per token
     "0.0001 ETH", Transactions 1, Total fee "0.0002 ETH", Left to mint 6, After the burn 4. "Burn 2 tokens" opens the
     dialog with "Left to mint now" 6, "Left after the burn" 4, "Fee" "0.0002 ETH" and "Type burn 2 to confirm"; once
     typed, the review reads recipients "1 address", amounts "1 amount, 2 tokens in total" and Value "0.0002 ETH
     (200000000000000 wei)"; it lands with "2 tokens burned", and History lists Burn first: 1, 2, "#7 to #8", "0.0002
     ETH".
  7. Over supply: a list of 5 tokens reads "5 tokens is more than the 4 left. Remove some recipients." with the button
     off; Tokens to burn 5 reads "Only 4 tokens are left to mint."
  8. "Export CSV" saves `airdrop-history.csv` with `date_utc,kind,recipients,tokens,token_ids,fee_eth,tx_hash`, the
     burn first. The Snapshot tab reads the collection's holders on Anvil.
  9. The owner check: with `anvil_impersonateAccount` and `cast send --unlocked`, the dev wallet hands the contract to
     Anvil's second account; a reload shows "This wallet is not the contract's owner" / "Changes on chain need
     <second account>."; "Send airdrop" and "Burn 2 tokens" open their dialogs with the action off and "This wallet is
     not the contract's owner. Changes on chain need <second account>." under the review; the contract handed back
     and "Read again" clear it.
  10. Settings, after Public is opened on Phases and Anvil's first account mints one token for 0.001 ETH with `cast`:
      "Read from the chain under a minute ago", Your balance "0.001 ETH", Withdrawn so far "0 ETH", "Platform fees,
      paid to Cobweb" "0.0008 ETH", "Platform fees per token" "0 ETH + 0% per mint, 0.0001 ETH per airdrop", the
      payout and "5%" to the dev wallet, "Revealed" with "Change metadata" and "Base URI ipfs://<real CID>/", the
      validator with "Limit Break default", Transfers "Anvil has no transfer validator, so transfers cannot be locked
      there." without "Change level", and Mint on behalf "Off".
  11. Withdraw: "Withdraw proceeds", "The whole balance goes to the payout address in one transaction.", Amount "0.001
      ETH", To the payout, the review `withdrawMintFunds` with no argument rows; it lands with "Proceeds withdrawn";
      Your balance "0 ETH" with Withdraw off, and Withdrawn so far "0.001 ETH".
  12. Payout: the zero address reads "The zero address cannot receive anything. The contract refuses it.", the current
      one "That is the current payout address.", Anvil's third account "Checksummed: <address>"; the review
      `newOwnerPayoutAddress`; "Payout address changed".
  13. Royalties: "10.5" reads "Enter 0 to 10, with up to two decimals."; "7.5" reads "750 bps on chain. 0 to 10%.";
      the review `receiver` and `feeNumerator` "750 (7.5%)"; "Royalties updated" and "7.5%".
  14. Reveal, custom and back: "Change metadata" opens "Change the metadata" on "Another IPFS link", with "Rendered
      metadata (now)" and the red "Check the link before you confirm"; "bafy..." without the scheme reads "Enter a
      full ipfs:// link with its CID."; a full `ipfs://<CID>/` shows "Token 1 now" `ipfs://<real CID>/1` and "Token 1
      after" `ipfs://<CID>/1`; "Use this link" reviews `newBaseURI` and lands with "Metadata updated. The collection
      points at your link." and the badge "Custom"; "Rendered metadata" and "Reveal" land with "Metadata updated. The
      collection is revealed." and "Revealed".
  15. Reveal Walk 1: Settings reads "Placeholder" with "Reveal" and "Base URI ipfs://<placeholder CID>/metadata.json";
      "Reveal the art" opens on "Rendered metadata" with "Placeholder (now)", "Token 1 now" `ipfs://<placeholder
      CID>/metadata.json` and "Token 1 after" `ipfs://<real CID>/1`; "Reveal" lands with "Metadata updated. The
      collection is revealed."; "Change metadata", "Placeholder" and "Use the placeholder" land with "Metadata updated.
      Every token shows the placeholder."; the Overview reads "Placeholder (unrevealed)" with "Reveal", which reveals
      from the Overview to "Revealed, <short cid>".
  16. Mint on behalf: the switch opens "Turn on mint on behalf" with "Anyone can pay to mint for any wallet, which uses
      up that wallet's limit or quota. The wallet receives the tokens." and the review `status` "true"; "Mint on behalf
      is on" and "On"; then off with "Mint on behalf is off".
  17. The validator: "Change validator" with the zero address and the tick reviews `transferValidator`
      "0x0000000000000000000000000000000000000000 (removes the check)" and lands with "Transfer validator changed";
      "No validator" and "No validator is set, so transfers are not checked."; then "Use the Limit Break default" and
      the tick read "The change would fail" / "There is no contract at that address on this chain. A validator must be
      a contract, or the zero address to remove the check. Nothing was sent."
  18. The owner check on Settings, as step 9: the alert, and every dialog opening with its action off and the sentence.
  19. The Overview of "Airdrop Walk 1": "Revealed, <short cid>" with "Change", "Withdrawable now" "0 ETH", "Already
      withdrawn" "0.001 ETH", and no "Paid by minters".
  20. Anvil stopped: Airdrop shows "The contract could not be read" / "The history below is Cobweb's record of the
      batches it confirmed. The fee and the tokens left to mint are not shown, and sending waits until the contract can
      be read." with "Read again", "Not read" for the fee, the total fee and Left to mint, the buttons off with "The
      contract could not be read, so changes on chain wait until it can be.", and the history listed; Settings shows
      "The contract could not be read" / "These are the payout address, royalties, metadata and transfer validator
      Cobweb last read, on <UTC>. Balances and the transfer level are not shown, and changes on chain wait until it can
      be read.", Your balance and both platform fee rows "Not read", Withdrawn so far "0.001 ETH", the copies shown,
      Transfers "Not read" and every button off; the Overview's "Withdrawable now" reads "Not read".
  21. Sample mode (`NEXT_PUBLIC_DEMO_DATA=1`) on a draft with a supply of 5,000: 1,200 wallets with one token read
      Transactions 3 and 600 wallets with two tokens read Transactions 2; the simulated wallet's Reject, "Approve, then
      revert" ("The change failed on chain") and Approve run batch by batch, "Stop and drop the unsent batches" after
      the first; `?batch=pending` shows the waiting batch and "Check again" lists it; `?chain=unreachable` and
      `?owner=other` show their alerts on Airdrop and Settings; `?art=deferred` turns Reveal off with "The real art is
      not rendered yet. Finish it in Art, then lock and upload it; Reveal opens once it is on IPFS."; `?art=revealed`
      reads "Revealed" on Settings and the Overview; every Settings dialog runs on the simulated wallet.

## 11. Documentation

- `docs/MASTER_PLAN.md`: the Phase 5 status line gains, at its end, "Airdrop and Settings (fourth sub-project of four)
  landed on <date>; see [specs/2026-10-15-airdrop-settings.md](specs/2026-10-15-airdrop-settings.md)." with what
  exists (the migration: `airdrops` and `withdrawals`, read by the owner and written only by `airdrop_record` and
  `withdrawal_record` after a proof, and `deployments`' payout, royalty, base URI, `transfer_validator` and
  `mint_on_behalf` as copies refreshed by `settings_refresh`; `validatorAbi` and `DEFAULT_TRANSFER_VALIDATOR` in the
  shared package; payable and validator calls in the manage machine; airdrop batches of at most 500 wallets and 1,000
  tokens built in the browser, sent with the contract's fee as the value, proven from the receipt and calldata at the
  chain's depth and listed with their token ids; the job kept in the browser with "Check again" and "Discard"; burn as
  a batch to the dead address; Settings read at one block, balances never copied, each change confirmed from its
  receipt, the reveal also from its calldata and the level from the validator's log; the withdrawals recorded; Reveal
  to the rendered metadata, the placeholder or another IPFS link; the owner check; the Overview's pointer, Reveal and
  proceeds; sample mode on the same code; `verify:airdrop` with 15 checks and `verify:settings` with 17, and the
  500-wallet batch's gas), then "Phase 5 is complete." and section 12's items as Known. The line's opening
  "**Status:** in progress." becomes "**Status:** complete." when the done-when (a rendered collection to a deployed
  contract with two phases and a 2,000-address whitelist on testnet, without leaving the flow) is recorded on a
  testnet; until then the appended sentence reads "Phase 5 is complete locally; the done-when run on a testnet is
  owed." The line's earlier sentences, which say the Airdrop and Settings dialogs run on the sample actions, stay as
  history.
- Dated notes: in [2026-10-03-creator-flow-ui.md](2026-10-03-creator-flow-ui.md) section 4.6, after the Whitelist
  note, what changed (batches of at most 500 wallets and 1,000 tokens; the value is the contract's fee exactly; the
  frozen job kept in the browser with "Check again" and "Discard", and a discarded batch that landed mints twice if sent
  again; History as Cobweb's record of confirmed batches, airdrops sent outside Cobweb not listed, token ids from the
  receipt's `Transfer` logs; a burn of at most 1,000 tokens a transaction; a repeated address's sum checked against
  1,000; Settings read from the chain with copies for when it cannot be; "Withdrawn so far" counting withdrawals made
  through Cobweb; "Platform fees per token" from `fees()`; "Paid by minters" in Phase 6; Reveal's three sources; the
  level control following the validator's code; the owner check; the Overview's pointer reading Custom too, and its
  proceeds from the contract); in the same spec's section 7, that "revert to placeholder" is offered whenever a
  placeholder job exists, also after the reveal, the rendered metadata is the real job's `base_uri` exactly (a single
  asset's ends in `/metadata.json`), a custom link is a full `ipfs://` URI, and Reveal opens once the real set is
  rendered; in the Phases spec's section 12, closing "Airdrop and Settings still run on sample data, their dialogs on
  the sample actions, until the fourth sub-project" with a link here (holders, recent mints and "Paid by minters" wait
  for Phase 6); in the Whitelist spec's section 12, closing "The Airdrop and Settings dialogs keep `sampleRequest` until
  the fourth sub-project" (`sampleRequest` is gone, and Airdrop's snapshot now feeds real batches); in the deploy
  spec's section 6.3, that `readDeployment` reads the base URI, the payout address and the royalty from
  `deployments.args`, since those columns are copies now.
- `CLAUDE.md`, after `verify:whitelist`:

```
pnpm --filter @cobweb/web verify:airdrop    # each batch and burn sent and proven from its receipt and calldata, the fee, the refusals, the owner check and a 500-wallet batch's gas, against local Supabase and Anvil
pnpm --filter @cobweb/web verify:settings   # the read, each setting sent and confirmed from its receipt, the copies, the refusals and the owner check, against local Supabase and Anvil
```

## 12. Owed and known

- Phase 6 brings holders, recent mints, "Paid by minters", per-recipient history and the mint page's reveal state and
  transfer level through the freshness server. Airdrops and withdrawals made outside Cobweb are neither listed nor
  counted until its indexer reads `NFTsAirdropped`, `Transfer` and `MintFundsWithdrawn`.
- The batch caps (500 wallets, 1,000 tokens) are provisional until `verify:airdrop`'s measurement, which the landing
  note records. From the code, each fresh recipient writes two new storage slots besides a `Transfer` log per token, so
  500 fresh wallets may pass the 16,777,216 per-transaction gas cap where one applies; if the figure does, the wallet
  cap drops before launch. Monad and Berachain are measured on testnet before launch.
- A discarded batch that landed is sent again by "Retry batch <n>" and mints twice (the waiting panel says so); a
  replaced transaction is never matched, as in Phases; a job too large for the browser's storage is kept for the visit
  only. History's When is the time Cobweb recorded the batch (`confirmed_at`), later than its block when "Check again"
  comes late.
- The level: the default validator `0x721C008fdff27BF06E7E123956E2Fe03B63342e3` is the one legacy drove as V5 with
  `setRulesetOfCollection(collection, 0, 1 or 2, 0x0, 0, 0)`, while `validatorAbi` holds the pinned library's call
  (legacy's V4). The testnet check before launch covers the function as well as the values 0, 1 and 9; until then a
  validator that does not answer it refuses at "Checking the change" and nothing is sent. The level call sets the
  three flags to false; levels 2 to 8 set outside Cobweb read "Level <n>, set outside Cobweb"; the validator's errors
  read generically.
- Verify covers the validator address only: Anvil has no validator code, so the level control, its confirm and the way
  back to the default are checked on a testnet where the validator is deployed.
- `royaltyInfo(1, 10000)` reads token 1's royalty, so a per-token royalty set on token 1 outside Cobweb shows in place
  of the default. The payout address may withdraw on chain when it is not the owner; under the owner check Cobweb sends
  nothing. Refunds held for this wallet are shown, not claimed.
- A custom link is checked for its form, never fetched: a wrong CID shows only on marketplaces and the mint page.
  Reveal stays off until Cobweb has rendered the real set, so a creator whose metadata lives elsewhere sets a custom
  link only after that.
- `state_read_at` is the time of the last read of either kind: after a Phases read, the settings copies can be older
  than the time the Settings alert names (they show only while the chain does not answer).
- Owed by Phase 4 and outside this sub-project's rulings: the reveal flow owning a deployed collection's rendering
  status, and the retry's job selection on a deferred collection that later holds a real job.
- Next runs a tab's server actions one at a time (the Whitelist's landing note), so an airdrop confirm's polls wait
  behind a running holder snapshot.

## 13. Acceptance criteria

- [ ] The migration applies and `verify:local` passes (363); `airdrops` and `withdrawals` are read by the owner and
      written only by their record functions after a proof, and the `deployments` copies only by `settings_refresh` from
      a server read.
- [ ] Every airdrop batch holds at most 500 wallets and 1,000 tokens in the list's order, is simulated with the
      contract's fee for its tokens as the value and sent from the session wallet by the manage machine, is proven by the
      server from its receipt and calldata at the chain's depth, recorded once and listed in History with its token
      ids; a lost receipt is recovered with "Check again"; a burn is the same call to the dead address behind "burn N".
- [ ] Every Settings change is simulated and sent from the session wallet (the level on the validator), confirmed from
      its receipt (the reveal also from its calldata) and answered with a fresh read that refreshes the copies; balances
      are never copied, and the withdrawals Cobweb confirmed are counted.
- [ ] Reveal offers the rendered metadata, the placeholder and another IPFS link, with token 1's URI before and after by
      the contract's rule; Revealed, Placeholder and Custom follow the contract's base URI on Settings and the Overview.
- [ ] A wallet that is not the contract's owner sees the alert and sends nothing; with the chain down, the copies show
      and nothing is sent.
- [ ] `verify:airdrop` (15) and `verify:settings` (17) pass, the 500-wallet batch's gas recorded in the landing note;
      `verify:deploy`, `verify:phases` and `verify:whitelist` still pass.
- [ ] Sample mode renders every state; the browser walk is recorded in this spec's landing note.

## 14. Reconciliations with the design conversation

Where a ruling could not be written as stated, or the rulings disagreed, this spec takes the nearest workable reading. All seventeen were accepted on 15 October 2026 and bind the plan:

1. `confirmAirdropCore(ctx, txHash, index?)` is written without `index`: the server stores no list, so an index has
   nothing to be checked against and no column to land in; the calldata gives the batch and its kind.
2. "Paid by minters" is ruled both "sample until Phase 6" and "dropped from Settings", but only the Overview shows it:
   written as shown in sample mode only, with the Overview's other two proceeds rows from the settings view (the Phases
   spec owed proceeds to this sub-project).
3. The read includes `platformBalance()` while "the platform fees row shows `fees()`": written as two rows, "Platform
   fees, paid to Cobweb" (the balance) and "Platform fees per token" (the rates).
4. The validator "back to the default" cannot succeed on Anvil, where the default has no code
   (`CreatorTokenBase__InvalidTransferValidatorContract`): `verify:settings` checks it as that refusal in words, and
   the successful way back is walked on a testnet with the validator deployed.
5. Flag: the default validator is the one legacy drove as V5 with `setRulesetOfCollection`, while the ruled call is
   the pinned library's (legacy's V4); if V5 does not answer it, the level control fails its simulation on every launch
   chain, so the testnet check must cover the function, not only the values.
6. Flag: whether Sepolia holds validator code is not checked here; keyed on the validator's code, as ruled, the level
   control shows on Sepolia if it does, so "off on Sepolia" holds only if it has none.
7. The deploy fixture makes collections of three tokens, so the 1,000-supply collection for the gas measurement is
   deployed straight through the factory with the fixture's `deploy` and `encodeCollectionArgs`, not recorded in
   Cobweb.
8. Flag: from the code, 500 fresh wallets may cost about 25,000,000 gas (two new storage slots per wallet, a log per
   token), above the 16,777,216 per-transaction cap where one applies; the measurement decides the provisional caps.
9. `state_block` is shared, so `settingsViewCore` refreshes the phase copies with the same block before
   `settings_refresh`; otherwise `state_read_at` would name a read that never refreshed them.
10. "Phase 5 complete": the Phase 5 done-when names a testnet run and no walk has run on one, so section 11 makes
    "complete" wait for it ("complete locally" until then); the two items Phase 4 owes Phase 5 stay owed (section 12).
11. Added to section 11: a dated note in the deploy spec's section 6.3, since `readDeployment` now reads the base URI,
    the payout and the royalty from `args`.
12. `SentCall.value` and the `airdropNFTs` member of `sentCallShape` serve the round trip, the tests and the scripts
    only: the airdrop confirm takes the hash alone, as ruled.
13. A burn is one batch, so it is at most 1,000 tokens a transaction; today's sample allowed everything left to mint.
14. "The validator with its address and ABI": the target is absent for the collection and carries the validator's
    address; `abiOf(call)` picks the ABI, so no ABI object crosses the server boundary.
15. "`collectionState()` (via `phaseBase`)": `phaseBase` supplies the deployment's chain and address, and
    `collectionState()` is the first of the ten reads at one block.
16. The Overview shows no royalty or payout: those seams close by the Overview no longer taking the sample
    `Deployment`.
17. "Royalty keeps the 10% cap" in the dialog, the shape and the deploy form; the copy column widens to the contract's
    0 to 10,000 so a royalty set outside Cobweb can be copied (decision 15).
