# Contract review, October 2026

The review of Cobweb's two contracts before the first real launch
([../specs/2026-10-18-load-run-contract-review-and-cloudflare.md](../specs/2026-10-18-load-run-contract-review-and-cloudflare.md),
section 7): Slither over both contracts with every finding triaged, a reading of six areas, and the invariant suite on
CI's default campaign and once deeply. It found nothing to fix, so no contract changed. It is also the brief for the
external look, which is the owner's decision.

## 1. Scope

- Commit `1011644`, where `contracts/src` stands as it has since `94a6c1f` (2 October 2026).
- `contracts/src/CobwebCollection.sol` (941 lines), `contracts/src/CobwebFactory.sol` (285 lines) and
  `contracts/src/interfaces/` (`ICobwebFactory`, `IDelegateRegistry`), with the library code they inherit read where it
  is called: OpenZeppelin 5.7.0's `ReentrancyGuard`, `Ownable`, `ERC2981` and `AccessControl`, and Limit Break's
  creator-token-standards 5.0.0 (`ERC721AC`, over ERC721A 4.2.3).
- solc 0.8.30, EVM version prague and the optimizer at 200 runs, as `contracts/foundry.toml` pins them, with Foundry's
  default of keeping solc's metadata hash (`bytecode_hash = "ipfs"`).
- The creation code reviewed: 20,271 bytes with the hash
  `0xa57eac3d6d8dca5d3bb294162c964342bd351cba3cf034f1b8b6b3e2ca9ae594`, the one `packages/shared/src/collection.ts`
  ships and the factory admin approves. `CobwebCollection`'s runtime code is 17,845 bytes of the 24,576 allowed.

## 2. Tools

- Slither: slither-analyzer 0.11.6 (the newest on PyPI, released 28 July 2026) on Python 3.12, run through uv, with
  crytic-compile 0.4.2 building through Foundry: 102 detectors, none excluded, run on 19 October 2026 at `82ed358`,
  whose `contracts/src` is the same as the reviewed commit's. `contracts/slither.config.json` sets
  `"include_paths": "contracts/src/"`, so a finding is kept when any of its elements lies under `contracts/src`, library
  evidence included; the 109 of an unfiltered run's 131 findings whose elements all lie in the libraries are not
  triaged.
- CI: the `slither` job runs the same analyzer through `crytic/slither-action` v0.4.2 on every push to `main` and every
  pull request, reading the triage database, and fails on a medium or high finding the database does not hold. It runs
  on the action's own toolchain, not on the nightly the `contracts` job pins: Python 3.10 and the latest stable Foundry,
  as the action's v0.4.2 source reads, and crytic-compile unpinned (Slither 0.11.6 asks for `>=0.4.2,<0.5.0`, and 0.4.2
  was the only release in that range on 18 October 2026). It reads the syntax tree of the same solc 0.8.30. The root
  form the job runs (`slither contracts ...`, from the repository root) gives every finding the same id locally as the
  run from `contracts/`, because an id is built from each file's short name, which reads `src/...` in both; so the job
  should hide the same findings. The job has not run on GitHub yet (section 7).
- Foundry: forge 1.4.0-nightly at `6f49a62`, locally and in CI's `contracts` job
  (`nightly-6f49a622bd1c2219f918752b372d401aeeb8e851`).

## 3. Slither

22 findings from 15 of the 102 detectors, none confirmed:

| Impact | Confidence | Detector | Findings | Verdict |
| --- | --- | --- | --- | --- |
| High | High | encode-packed-collision | 2 | false positive |
| Medium | High, Medium | incorrect-equality, reentrancy-no-eth | 2 | incorrect-equality a false positive, reentrancy-no-eth accepted |
| Low | High, Medium | reentrancy-benign (2), reentrancy-events, shadowing-local, timestamp | 5 | accepted |
| Informational | High, Medium | assembly, cyclomatic-complexity, dead-code, low-level-calls (3), pragma, unimplemented-functions, unindexed-event-address (3) | 11 | accepted, except unimplemented-functions, a false positive |
| Optimization | High | immutable-states | 2 | accepted |

Each finding's id, lines, verdict and reason are in [contracts/slither.triage.md](../../contracts/slither.triage.md), 17
rows over the 22 ids, and the 22 are in `contracts/slither.db.json`, so CI fails only on a medium or high finding nobody
has judged. The two high findings are the factory packing a collection's creation code and its constructor arguments
into the init code CREATE2 deploys, once to deploy and once to predict the address: a collision would need two splits of
the same bytes, and the factory checks the hash of the creation code alone against its approvals before it packs, so no
split it accepts deploys code it did not approve. The first medium finding is `withdraw`'s refusal of an empty balance:
ether forced into the factory only gives the admin more to send to the treasury. The second is the chunked `_safeMint`
of a mint or an airdrop, which calls the receiver after a chunk's writes and writes the next chunk after the call: every
state write after a receiver callback belongs to the next chunk's mint and reads storage afresh, every mint, airdrop and
withdrawal entry point is `nonReentrant`, and ERC721A reverts if a callback moves `_currentIndex`. Of the low findings,
`timestamp` is the liveness comparison itself (a phase is live from the first block at or after its start) and
`shadowing-local` the holder parameter of `isApprovedForAll`, named as ERC721A names it; the one false positive among
the informational findings is `unimplemented-functions`, since `ERC721AC._tokenType()` implements what
`CreatorTokenBase` declares. No finding was fixed.

## 4. A reading of six areas

**Value flows.** The native token enters in five places that account for it: the three mints (`batchMint`,
`mintOnBehalf`, `delegateMint`), `airdropNFTs` and the factory's `payForArt`. Neither contract has a `receive` or
`fallback`, but four functions ERC721A 4.2.3 makes payable, as ERC-721 declares them (`approve`, `transferFrom` and both
`safeTransferFrom`), take it and credit no one. A mint quotes its cost from the group's price and the collection's fees
(`quoteBatchMint`), refuses less, credits the creator the price and the platform the fee before it mints, and then
pushes the excess back to the caller, holding it in the caller's pending balance when the push fails, so a minter whose
wallet rejects ether still mints and claims later. An airdrop charges the per-token fee the same way. Every balance
leaves through a withdrawal of its own, each reverting on a failed transfer and, in a collection, zeroing its balance
before the transfer: `withdrawMintFunds` sends the creator's balance to the payout address, `withdrawPlatformFees` the
platform's to the factory's current treasury, `withdrawPendingBalance` and `withdrawPendingBalanceTo` (two entry points
to one internal function) a caller's own held refunds, and the factory's `withdraw` its whole balance to the treasury.
So the collection holds exactly what it owes, unless ether arrives outside a mint or airdrop: the creator's balance,
the platform's and the held refunds, which invariant 1 holds; ether forced in from outside (a selfdestruct) or sent
with a transfer or an approval is owed to no one and stays.

**Access.** The owner (the creator) controls the sale: groups, prices, supplies, schedules, quotas, the public cap, the
on-behalf switch, the base URI, the payout address, royalties, airdrops and the transfer validator. The payout address
may also withdraw the proceeds, which reach only it, so a renounced or lost ownership never strands them. The platform
admin, an account holding the factory's admin role, sets a collection's fees up or down (`setFees`, the rate capped at
10,000 bps) and, on the factory, the approved creation code, the default fees, the art rate, the treasury, the art
withdrawal and the role itself; the factory refuses to revoke its last admin (`LastAdmin`). Anyone may deploy approved
code, mint within the rules, pay for art and send the platform's balance to the treasury, whose destination the factory
fixes. Invariant 4 holds the fee rule over random callers, the creator among them; invariant 6 holds the last-admin rule
over random grants and revokes, each sent by an admin, and that a stranger cannot grant or revoke the role rests on
OpenZeppelin's `AccessControl`, since no test has a stranger try.

**Reentrancy.** Every function of a collection that credits or pays out the native token is `nonReentrant`: the three
mints, the airdrop and the four withdrawals. Inside a mint the order is checks, then every counter and balance written,
then the mint, which the collection runs as ERC721A `_safeMint` calls of at most 20 tokens each (`MINT_CHUNK`). The
receiver's `onERC721Received` callback, run for each token of a chunk once the chunk is written, is the only call before
the refund that can change state (a delegated mint's question to the registry is a view). A receiver that calls back
finds every guarded entry point locked and the collection's counts and balances final; ERC721A has finished the chunk's
writes before the call and reverts the mint if the call moves its `_currentIndex`, and the next chunk reads its state
afresh. What the receiver can still call, its own transfers and approvals or the settings if it is the owner, finds
every finished chunk whole (Slither's `reentrancy-no-eth` on the chunked `_safeMint` and a `reentrancy-benign` on the
next chunk's first ownership slot, both accepted). The refund push comes last, and the one write after it credits a
pending balance only when the push failed (the other `reentrancy-benign`, accepted). The factory's `withdraw` is the
admins' alone and sends its whole balance, so a treasury that calls back finds nothing left (`reentrancy-events`,
accepted). Deploying runs the collection's constructor, which reads the factory's fees and, where Limit Break's default
validator has code, registers the collection's token type with it in a try that ignores a failure; the collection has no
runtime code yet for that call to re-enter.

**External trust.** A collection trusts three contracts. The factory that deployed it, recorded in the constructor: its
default fees are read once there (so no deployer supplies its own), and its `isAdmin` and `treasury` at each admin
check and each platform withdrawal, so a treasury rotation reaches every collection. The delegate.xyz v2 registry at its
fixed address, asked by `delegateMint` whether the caller may act for the vault; on a chain without it the call
reverts, so delegated mints there fail closed. Limit Break's transfer validator: at deployment the constructor registers
the collection's token type with the default validator, where it has code, in a try that ignores a failure; transfers
are checked only where the configured validator has code, and the collection's `isApprovedForAll` honours the automatic
approval for Limit Break's default validator alone, so a validator the creator installs gets no approval a holder did
not give. A collection deployed by any other contract is not one the factory records, and the app and the freshness
server refuse it.

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
is held and later claimed to another account), airdrops, burns, every withdrawal but `withdrawPendingBalance` (which the
unit suite calls only to see it refused, `CobwebCollection.t.sol:631`), the admin's fee changes and a stranger's refused
attempt, the factory's defaults, the treasury, the payout address, group registration, prices, supplies, a group opened
or closed and all of them at once, schedules with time moving, whitelist chunks written and written again, the public
cap, the on-behalf switch, delegations and transfers between holders. Time moves 1 to 3,600 s at a time, and an eighth
of the moves go exactly to the next scheduled start of a group whose flag is off and an eighth to the second before it
(a group whose flag is on is live whatever its start, and a flag turned off resets the start to 0). Its collection has
200 tokens (Public 120, Allowlist 60), so most runs sell it out and the supply bounds are reached.

Both handlers keep ghost totals and a flag for each thing that must never happen, and catch the refusals a contract may
give (a stranger's or a minter's call, a withdrawal, a repeated payment, a group or a supply the collection refuses, the
last admin's revoke). Thirteen of the 31 actions (`grantAdmin`, `setTreasury`, `setPayout`, `setFees`, `setFactoryFees`,
`setPrice`, `setStatus`, `schedule`, `setAll`, `writeChunk`, `setPublicCap`, `setMintOnBehalf` and `transfer`) call the
contracts without a `try`, since a contract must accept them. The flags are a stranger's fee change landing, a mint in a
group that was not live when it was sent, a cap or quota passed (a mint on behalf with the switch off, or a delegated
mint without a delegation, counts as passing one), a claimed count going down, a payment other than the quote, a
repeated art payment landing, the last admin removed, and a withdrawal refused while something was owed: one flag for
each of the collection's three withdrawals (`heldClaimRefused`, `feesWithdrawalRefused` and
`proceedsWithdrawalRefused`, read by invariants 1, 2 and 3) and the factory's, read by invariant 5. Payments are
compared by addition, so a payout larger than the payment sets `chargedOtherThanQuote`, which fails invariant 1,
instead of reverting a handler; a refund held for `EtherRejecter` is the excess the model expects to be held (what
`_refundExcessEther` credits, `msg.value - totalCost`, from the same quote the handler read), and any other credit sets
the same flag. Beyond [the plan's](../plans/2026-10-18-load-run-contract-review-and-cloudflare.md) decisions 18 to 21,
two things depart from the spec's section 7.5: mints on behalf and delegated mints overpay the quote as the public mint
does, which the spec's action table does not list for them, and invariant 11 also holds that no mint lands without the
right to its cap or quota (the on-behalf switch on, or the vault's delegation to the caller).

The thirteen invariants, in four groups:

- Fee custody and proceeds: 1 `invariant_balanceEqualsWhatIsOwed`, 2 `invariant_platformFeesReachOnlyTheTreasury`,
  3 `invariant_proceedsReachOnlyThePayout`, 4 `invariant_feesChangeOnlyByTheAdmin`,
  5 `invariant_artPaymentsHeldOrPaidToTheTreasury`.
- The admins: 6 `invariant_anAdminAlwaysRemains`.
- Phase bounds: 7 `invariant_supplyNeverExceedsMax`, 8 `invariant_groupMintsNeverExceedAllocation`,
  9 `invariant_allocationsFitInCollection`, 10 `invariant_liveOnlyByFlagOrStart`, 11 `invariant_capsAndQuotasHeld`.
- Ownership counts: 12 `invariant_everyTokenCameFromAGroupOrAnAirdrop`, 13 `invariant_ownershipAddsUp`.

Results:

- CI's default campaign, on every push to `main` and every pull request: 256 runs of depth 500, 128,000 calls per
  invariant, every action between 3,948 and 4,313 of them, no call reverting; all thirteen pass in 61 s on a 12-core
  laptop, beside the 87 unit tests (100 in all).
- The deep run, once, on `1011644` (`FOUNDRY_PROFILE=deep forge test`, by hand and never in CI): 1,000 runs of depth
  1,000, 1,000,000 calls per invariant, every action between 31,669 and 32,720 of them, no call reverting, and the one
  fuzz test (`testFuzz_quoteBatchMint`) at 10,000 runs; all 100 tests pass, in 661 s (about 11 minutes) on a 12-core
  laptop.
- `reverts: 0` holds by construction for the calls the handlers catch; for the thirteen actions that call without a
  `try` it shows that every call the handlers made was accepted. Either way it measures the handlers' health, not the
  contracts'. What shows an invariant at work is the mutations below: one that fails it shows the campaigns reach the
  states it guards, and the passing runs show it holds there.

Each invariant was checked against a mutation of the contracts that breaks what it holds, seventeen in all, applied by
a script one at a time on 64 runs of depth 500 with a fixed seed and then undone, and each failed the invariant it
targets:

| Mutation | Invariants that failed |
| --- | --- |
| M1 a refund held although it reached the minter | `invariant_balanceEqualsWhatIsOwed` (1) |
| M2 the platform's fees paid to whoever asked | `invariant_platformFeesReachOnlyTheTreasury` (2) |
| M3 the proceeds paid to whoever asked | `invariant_proceedsReachOnlyThePayout` (3) |
| M4 the fees set by a stranger | `invariant_feesChangeOnlyByTheAdmin` (4) |
| M5 the art paid to the admin who withdraws | `invariant_artPaymentsHeldOrPaidToTheTreasury` (5) |
| M6 the last admin removable | `invariant_anAdminAlwaysRemains` (6), `invariant_artPaymentsHeldOrPaidToTheTreasury` (5) |
| M7 a mint past the collection's supply | `invariant_supplyNeverExceedsMax` (7) |
| M8 a group's mints past its allocation | `invariant_groupMintsNeverExceedAllocation` (8) |
| M9 allocations past the supply | `invariant_allocationsFitInCollection` (9) |
| M10 a start kept after a close | `invariant_liveOnlyByFlagOrStart` (10) |
| M11 a start honoured a second late | `invariant_liveOnlyByFlagOrStart` (10) |
| M12 no public cap | `invariant_capsAndQuotasHeld` (11) |
| M13 a chunk resetting claimed counts | `invariant_capsAndQuotasHeld` (11) |
| M14 a group's mints left uncounted | `invariant_everyTokenCameFromAGroupOrAnAirdrop` (12) |
| M15 a delegated mint on the caller's own cap | `invariant_capsAndQuotasHeld` (11), `invariant_ownershipAddsUp` (13) |
| M16 a delegated mint without a delegation | `invariant_capsAndQuotasHeld` (11) |
| M17 a start honoured a second early | `invariant_liveOnlyByFlagOrStart` (10) |

M16 drops the `NotDelegate` check from `delegateMint`. M17 reads `block.timestamp + 1 >= start` and M11
`block.timestamp >= start + 1`, so the suite catches a start honoured a second early as well as a second late. A one-off
probe outside the script, run the same way (64 runs, seed 1) and undone, dropped the `MintOnBehalfNotActive` check of
`mintOnBehalf` and failed `invariant_capsAndQuotasHeld` (11): a mint on behalf with the switch off. No mutation
exercises `mintedWhileNotLive`, `chargedOtherThanQuote`, the collection's three withdrawal flags (a lock there is argued
from the code) or `EtherRejecter`'s held-refund checks (M1 fails invariant 1 through the held refunds of the minters),
so those rest on their reading alone; M6 exercises the factory's withdrawal flag through invariant 5, and M16
`capOrQuotaPassed`.

## 6. Changes

None. No finding was confirmed, so the contracts, the creation code hash
`0xa57eac3d6d8dca5d3bb294162c964342bd351cba3cf034f1b8b6b3e2ca9ae594` and every approval stay as they are; no factory
owes a new approval.

## 7. Owed

- The external look: the owner's decision before mainnet, with this record and the triage as its brief. The areas to
  put to an outside reviewer first: the refund path and its held balances, the fee and admin rules across the factory
  and its collections, liveness at a scheduled start, and the transfer validator's approval.
- The first run of the `slither` job, on the owner's first push of this work: green on `main` (spec section 13, step
  14). A red first run is fixed in a follow-up commit, never by loosening the threshold (spec section 7.3).
- On a testnet, owed elsewhere (the freshness server spec, section 12): the validator's security levels as Settings
  reads them (`getCollectionSecurityPolicy`), and the delegate registry's code on each launch chain, Berachain and Monad
  mainnet among them.
- Known, and not changed:
  - The ids of the two reentrancy findings (`4e19691ed281`, `5213771d2e34`) and of the pragma finding (`e01e78cc7f27`)
    carry the line numbers of library files, so a submodule bump that moves those lines reopens them, and the medium
    one (`reentrancy-no-eth`) turns the `slither` job red until it is triaged again.
  - `_safeMint` lets one recipient contract without `onERC721Received` (an EIP-7702 wallet whose delegate lacks it
    included) revert its own mint or the owner's whole airdrop batch, and the error names no address; for an airdrop the
    creator drops that recipient and sends again.
  - The collection's views are briefly inconsistent during a receiver callback (a group's count is final before the
    first chunk is minted, the token count grows chunk by chunk), and no on-chain decision reads them.
  - `approve`, `transferFrom` and both `safeTransferFrom` are `payable` in ERC721A 4.2.3, as ERC-721 declares them:
    ether sent with one credits no one, reaches no ledger, and no withdrawal sends it out. No handler sends ether with
    them. It is not a lock under the spec's decision 11, so the review found nothing to fix there: only the sender's own
    mistaken ether stays, the signatures are ones every ERC721A collection shares, and a fix would move the creation
    code hash.
