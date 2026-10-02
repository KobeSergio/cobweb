# TheSuits contract: mint mechanics analysis

Source: [TheSuits.sol](TheSuits.sol), the latest collection contract, pasted Oct 2, 2026. It is the model for mint-group handling in the new collection contract. It has no platform fees, airdrop fee, factory or delegate.xyz support; those come from the Kingdomly master contract design ([../legacy/contracts.md](../legacy/contracts.md)).

## How minting works

| Piece | Behaviour |
| --- | --- |
| Mint groups | Ids in `s_activeMintGroups`. Group 0 is public. Initial groups come from the constructor arrays; more are added with `registerMintGroup`. All start closed |
| Liveness | `mintGroupActive(g)`: true if the group's flag is on, or if a start is scheduled and `block.timestamp >= start`. This is the only gate; there is no global toggle and no end time |
| Open and close | `setMintGroupStatus(g, bool)`. Closing also clears the schedule so an old timestamp cannot reopen the group. `stopOrStartAllMintGroups` loops the same call over every group |
| Schedule | `scheduleMintGroupStart(g, ts)`; 0 clears it |
| Public limit | Group 0 only: lifetime per-wallet cap `s_publicMaxMintPerWallet`, checked against `s_addressMints` |
| Allowlist limit | Groups 1+: `s_mintQuotas` (issued) and `s_quotaClaimed` (used). Re-uploading a list restates the allowance without re-granting spent quota |
| Supply | Per-group allocation `s_mintGroupMaxSupply`, with the sum of allocations kept at or under `maxSupply`. Collection cap checked against `_totalMinted()` |
| Payment | `quoteBatchMint` is price times amount. Proceeds are credited to a pull-payment ledger; excess is refunded, and a failed refund is credited to the ledger |
| Mint on behalf | `mintOnBehalf(amount, g, receiver)`: caller pays, receiver's quota is used, receiver gets the tokens. Behind an owner switch |
| Token URI | If the base URI ends in `/`, returns base plus id; otherwise returns the base as-is. Reveal is `setBaseURI`, which emits ERC-4906 `BatchMetadataUpdate` |

## What already matches the new design

- **Start boundary.** Live at exactly `start` (`>=`), as decided.
- **Single-level gate.** The old two-step lock (global toggle plus group toggle) is gone.
- **Quota accounting.** Issued and claimed are stored separately, so chunked re-uploads are safe to retry.
- **Supply cap uses `_totalMinted()`**, so airdrops to the dead address never free up headroom.
- **Single Asset.** A base URI without a trailing `/` returns as-is with no id, which is the Single Asset rule, with no extra code.
- **Pull payments per recipient.** A reverting recipient cannot block anyone else, which removes the coupled-payout problem in the old V3.
- **Explicit group registration.** A mistyped id reverts instead of creating a group.

## Issues to fix when porting

| # | Where | Issue | Fix |
| --- | --- | --- | --- |
| 1 | `_batchMint`, `ExceedsMintGroupMaxSupply` | `setMintGroupMaxSupply` allows a new allocation below what the group has already minted. The revert then computes `maxSupply - mints`, which underflows and surfaces as a raw panic instead of the custom error | Decided: the setter rejects a value below what the group has already minted. Saturate the error as well, as the two neighbouring errors already do |
| 2 | `i_maxSupply` | Immutable, so runtime bytecode differs per collection. This breaks verify-once-per-chain | Move to storage, set in the constructor |
| 3 | `mintOnBehalf` | Not delegated minting. There is no delegate.xyz check, and the token goes to the quota holder, not the caller | Add a separate delegated mint: caller proves delegation from the vault, the vault's quota is used, the caller (hot wallet) receives. Decided: `mintOnBehalf` is kept as well |
| 4 | `s_addressMints` | Written on every mint for every group, read only for group 0. Allowlist mints pay for a storage write nobody reads | Write it only for the public group |
| 5 | `airdropNFTs` | Free, and not counted against any group allocation, so allocations summing to max supply can no longer all be met after an airdrop. The collection cap still holds | Add the per-token airdrop fee. Leave the allocation behaviour, but have the dashboard show remaining mintable supply |
| 6 | `setMintQuota` | Accepts group 0, where quotas are ignored | Revert for the public group |
| 7 | NatSpec on `setMintQuota` and `setMintGroupMaxSupply` | Says "registering the group if new"; the code reverts for unknown groups | Correct the comments |
| 8 | `_mintGroupExists` | Linear scan of the group array on every config call and in `setMintGroupMaxSupply` | Fine for a handful of groups. A `mapping(uint256 => bool)` is cheaper and smaller if size gets tight |
| 9 | `InvalidOperation(string)` | Revert strings cost bytecode, and the contract has a 24 KB ceiling with fees and delegation still to add | Replace with parameterless custom errors |

None of these is a loss-of-funds bug. Issue 1 is the only one a user would hit: an opaque wallet error after a creator lowers an allocation.

## What must be added from the Kingdomly design

- Platform mint fee: snapshot read from the factory in the constructor, held in storage, lowerable only; added in `quoteBatchMint` and credited to the platform's ledger entry (the old 3% was credited to nobody).
- Airdrop fee per token, taken as `msg.value`.
- Delegated mint through delegate.xyz, landing in the hot wallet.
- Factory deployment with identical runtime bytecode.
- A single view returning every group's state, so the freshness server reads a collection in one call instead of five per group.

## Consequences for the rest of the system

- **Freshness server.** Liveness is the `mintGroupActive` view, never computed off-chain from the flag and timestamp. Because a creator can now open or close a group by hand, `MintGroupStatusChanged` and `MintGroupStartTimestampChanged` logs trigger an immediate re-read of the view; the log itself never sets liveness.
- **Events to subscribe to.** `TokensMinted`, `MintGroupStatusChanged`, `MintGroupStartTimestampChanged`, `SalePriceChanged`, `MintGroupMaxSupplyUpdated`, `PublicMaxMintPerWalletChanged`, `MintGroupRegistered`, `BatchMetadataUpdate`.
- **Dashboard.** Each phase needs Open now, Close and Schedule actions. Closing clears the schedule, so reopening needs a new one. Scheduling a time in the past opens the group at once and should be warned about.
- **Unsold allowlist supply** does not roll into public on its own; the creator moves it by lowering one allocation and raising the other.
- **Overlap.** Groups stay open until closed, so an allowlist group and public can be live together.
