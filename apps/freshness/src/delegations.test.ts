import { DELEGATION_TYPE } from '@cobweb/shared'
import { getAddress, zeroAddress, zeroHash, type Address, type Hex } from 'viem'
import { describe, expect, it } from 'vitest'
import { MAX_VAULTS, vaultsOf, type Delegation } from './delegations.ts'

const COLLECTION: Address = '0x0409454C375c8a6aB05383bFB6D9FcDe9ebB8F85'
const OTHER_CONTRACT: Address = '0x5FbDB2315678afecb367f032d93F642f64180aa3'
const WALLET: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const RIGHTS: Hex = `0x${'61'.repeat(32)}`

/** The vault of index `n`, checksummed, distinct for every n. */
const vault = (n: number) => getAddress(`0x${(n + 1).toString(16).padStart(40, '0')}`)

/**
 * A delegation to the wallet, as the registry lists it: ALL from `from` unless the overrides say otherwise.
 */
const delegation = (from: Address, overrides: Partial<Delegation> = {}): Delegation => ({
  type_: DELEGATION_TYPE.all,
  to: WALLET,
  from,
  rights: zeroHash,
  contract_: zeroAddress,
  tokenId: 0n,
  amount: 0n,
  ...overrides,
})

describe('vaultsOf (docs/specs/2026-10-16-freshness-server.md, section 6.8)', () => {
  it('keeps ALL, and CONTRACT for this collection in any case, with empty rights', () => {
    expect(
      vaultsOf(
        [
          delegation(vault(0)),
          delegation(vault(1), { type_: DELEGATION_TYPE.contract, contract_: COLLECTION }),
          delegation(vault(2), {
            type_: DELEGATION_TYPE.contract,
            contract_: COLLECTION.toLowerCase() as Address,
          }),
        ],
        COLLECTION,
        WALLET,
      ),
    ).toEqual([vault(0), vault(1), vault(2)])
  })

  it('drops CONTRACT for another contract, the token-scoped types, rights, the wallet itself and the zero address', () => {
    expect(
      vaultsOf(
        [
          delegation(vault(0), { type_: DELEGATION_TYPE.contract, contract_: OTHER_CONTRACT }),
          delegation(vault(1), { type_: DELEGATION_TYPE.erc721, contract_: COLLECTION, tokenId: 1n }),
          delegation(vault(2), { type_: DELEGATION_TYPE.erc20, contract_: COLLECTION, amount: 5n }),
          delegation(vault(3), { type_: DELEGATION_TYPE.erc1155, contract_: COLLECTION, tokenId: 1n }),
          delegation(vault(4), { type_: DELEGATION_TYPE.none }),
          delegation(vault(5), { rights: RIGHTS }),
          delegation(WALLET),
          delegation(WALLET.toLowerCase() as Address),
          delegation(zeroAddress),
        ],
        COLLECTION,
        WALLET,
      ),
    ).toEqual([])
  })

  it("keeps a vault that delegates twice once, in the registry's order", () => {
    expect(
      vaultsOf(
        [
          delegation(vault(2)),
          delegation(vault(1), { type_: DELEGATION_TYPE.contract, contract_: COLLECTION }),
          delegation(vault(2), { type_: DELEGATION_TYPE.contract, contract_: COLLECTION }),
          delegation(vault(0)),
        ],
        COLLECTION,
        WALLET,
      ),
    ).toEqual([vault(2), vault(1), vault(0)])
  })

  it('stops at 10 vaults', () => {
    const many = Array.from({ length: 12 }, (_, n) => delegation(vault(n)))
    expect(MAX_VAULTS).toBe(10)
    expect(vaultsOf(many, COLLECTION, WALLET)).toEqual(Array.from({ length: 10 }, (_, n) => vault(n)))
  })
})
