import { DELEGATION_TYPE } from '@cobweb/shared'
import { getAddress, zeroAddress, zeroHash, type Address, type Hex } from 'viem'

/**
 * The vault filter (docs/specs/2026-10-16-freshness-server.md, section 6.8), pure: which of a wallet's
 * incoming delegations name a vault it may mint for on this collection. The collection asks
 * `checkDelegateForContract(caller, vault, this, "")`, which accepts only a whole-wallet (ALL) or a contract
 * (CONTRACT) delegation with empty rights.
 */

/** The most vaults a wallet answer lists. */
export const MAX_VAULTS = 10

/** One delegation as the registry's `getIncomingDelegations` answers it. */
export type Delegation = {
  type_: number
  to: Address
  from: Address
  rights: Hex
  contract_: Address
  tokenId: bigint
  amount: bigint
}

/**
 * The vaults: the `from` of each ALL delegation, or CONTRACT one for this collection (compared without case),
 * with empty rights; never the wallet itself or the zero address; each once, in the registry's order, at most
 * 10.
 */
export function vaultsOf(
  delegations: readonly Delegation[],
  collection: Address,
  wallet: Address,
): Address[] {
  const vaults: Address[] = []
  const seen = new Set<string>([wallet.toLowerCase(), zeroAddress])
  for (const delegation of delegations) {
    if (vaults.length === MAX_VAULTS) break
    const scoped =
      delegation.type_ === DELEGATION_TYPE.all ||
      (delegation.type_ === DELEGATION_TYPE.contract &&
        delegation.contract_.toLowerCase() === collection.toLowerCase())
    const from = delegation.from.toLowerCase()
    if (!scoped || delegation.rights.toLowerCase() !== zeroHash || seen.has(from)) continue
    seen.add(from)
    vaults.push(getAddress(delegation.from))
  }
  return vaults
}
