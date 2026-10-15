import { getAbiItem, getAddress, toFunctionSelector } from 'viem'
import { describe, expect, it } from 'vitest'
import { DELEGATE_REGISTRY, delegateRegistryAbi, DELEGATION_TYPE } from './delegate-registry-abi.ts'

describe('delegateRegistryAbi (docs/specs/2026-10-16-freshness-server.md, section 5.3)', () => {
  it("holds getIncomingDelegations(address) alone, as the registry's source declares it", () => {
    expect(delegateRegistryAbi.map((entry) => `${entry.type} ${entry.name}`)).toEqual([
      'function getIncomingDelegations',
    ])
    const listing = getAbiItem({ abi: delegateRegistryAbi, name: 'getIncomingDelegations' })
    expect(toFunctionSelector(listing)).toBe('0x42f87c25')
    expect(listing.stateMutability).toBe('view')
    expect(listing.inputs.map((input) => [input.name, input.type])).toEqual([['to', 'address']])
  })

  it('answers the seven fields of a Delegation, in order, with their types', () => {
    const [output] = getAbiItem({ abi: delegateRegistryAbi, name: 'getIncomingDelegations' }).outputs
    expect(output.type).toBe('tuple[]')
    expect(output.components.map((field) => [field.name, field.type])).toEqual([
      ['type_', 'uint8'],
      ['to', 'address'],
      ['from', 'address'],
      ['rights', 'bytes32'],
      ['contract_', 'address'],
      ['tokenId', 'uint256'],
      ['amount', 'uint256'],
    ])
  })

  it('ships the address the collection holds, checksummed, and the DelegationType values', () => {
    expect(DELEGATE_REGISTRY).toBe('0x00000000000000447e69651d841bD8D104Bed493')
    expect(getAddress(DELEGATE_REGISTRY)).toBe(DELEGATE_REGISTRY)
    expect(DELEGATION_TYPE).toEqual({ none: 0, all: 1, contract: 2, erc721: 3, erc20: 4, erc1155: 5 })
  })
})
