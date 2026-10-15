import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getAbiItem, keccak256, toEventSelector, toFunctionSelector } from 'viem'
import { describe, expect, it } from 'vitest'
import { collectionAbi as abiOnly } from './collection-abi.ts'
import { COLLECTION_CODE_HASH, COLLECTION_CREATION_CODE, collectionAbi } from './collection.ts'

const artifact = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../contracts/out/CobwebCollection.sol/CobwebCollection.json',
)
/** The limit CI has watched since Phase 1 (docs/MASTER_PLAN.md, Phase 1: creation code under 24 KB). */
const MAX_CREATION_CODE_BYTES = 24_576

describe('the shipped collection artifact', () => {
  it('ships a hash that is the keccak256 of the shipped creation code', () => {
    expect(COLLECTION_CREATION_CODE).toMatch(/^0x[0-9a-f]+$/)
    expect(COLLECTION_CODE_HASH).toBe(keccak256(COLLECTION_CREATION_CODE))
  })

  it('ships creation code under 24,576 bytes', () => {
    const bytes = (COLLECTION_CREATION_CODE.length - 2) / 2
    expect(Number.isInteger(bytes)).toBe(true)
    expect(bytes).toBeGreaterThan(10_000)
    expect(bytes).toBeLessThan(MAX_CREATION_CODE_BYTES)
  })

  it('carries the constructor and the views the deploy checks read', () => {
    const constructor = collectionAbi.find((entry) => entry.type === 'constructor')
    expect(
      constructor && 'inputs' in constructor ? constructor.inputs.map((input) => input.type) : [],
    ).toEqual(['tuple', 'uint256[]', 'uint256[]', 'uint256', 'uint96', 'address', 'address'])
    for (const [name, signature] of [
      ['name', 'name()'],
      ['symbol', 'symbol()'],
      ['maxSupply', 'maxSupply()'],
      ['baseURI', 'baseURI()'],
      ['owner', 'owner()'],
      ['royaltyInfo', 'royaltyInfo(uint256,uint256)'],
      ['collectionState', 'collectionState()'],
      ['publicMaxMintPerWallet', 'publicMaxMintPerWallet()'],
      ['ownerPayoutAddress', 'ownerPayoutAddress()'],
      ['fees', 'fees()'],
    ] as const) {
      expect(toFunctionSelector(getAbiItem({ abi: collectionAbi, name }))).toBe(toFunctionSelector(signature))
    }
  })

  if (existsSync(artifact)) {
    it('ships the bytecode and the ABI of the Foundry build in contracts/out', () => {
      const built = JSON.parse(readFileSync(artifact, 'utf8')) as {
        abi: unknown[]
        bytecode: { object: string }
      }
      expect(COLLECTION_CREATION_CODE).toBe(built.bytecode.object)
      expect(COLLECTION_CODE_HASH).toBe(keccak256(built.bytecode.object as `0x${string}`))
      expect(abiOnly).toEqual(built.abi)
    })
  } else {
    it.skip('ships the bytecode and the ABI of the Foundry build in contracts/out (run forge build in contracts/ to check it)', () => {})
  }
})

/** `name(type,type)`, from an ABI item. */
const signatureOf = (item: { name: string; inputs: readonly { type: string }[] }) =>
  `${item.name}(${item.inputs.map((input) => input.type).join(',')})`
/** The argument names of an ABI item, in order. */
const namesOf = (item: { inputs: readonly { name?: string }[] }) => item.inputs.map((input) => input.name)

describe('the ABI-only entry and what Phases relies on (docs/specs/2026-10-15-phases.md, section 5)', () => {
  it('exports the same ABI from both entries', () => {
    expect(abiOnly).toBe(collectionAbi)
    expect(abiOnly.length).toBeGreaterThan(100)
  })

  it('carries the calls Manage drop sends, with their selectors and argument names (the price first in changeSalePrice)', () => {
    for (const [name, signature, inputs] of [
      [
        'registerMintGroup',
        'registerMintGroup(uint256,uint256,uint256,uint256)',
        ['mintGroup', 'price', 'maxSupply_', 'startTimestamp'],
      ],
      ['setMintGroupStatus', 'setMintGroupStatus(uint256,bool)', ['mintGroup', 'status']],
      ['scheduleMintGroupStart', 'scheduleMintGroupStart(uint256,uint256)', ['mintGroup', 'startTimestamp']],
      ['changeSalePrice', 'changeSalePrice(uint256,uint256)', ['newMintPrice', 'mintGroup']],
      ['setMintGroupMaxSupply', 'setMintGroupMaxSupply(uint256,uint256)', ['mintGroup', 'newMaxSupply']],
      ['setPublicMaxMintPerWallet', 'setPublicMaxMintPerWallet(uint256)', ['newPublicMaxMintPerWallet']],
      ['stopOrStartAllMintGroups', 'stopOrStartAllMintGroups(bool)', ['status']],
      ['mintGroups', 'mintGroups()', []],
    ] as const) {
      const item = getAbiItem({ abi: abiOnly, name })
      expect(toFunctionSelector(item)).toBe(toFunctionSelector(signature))
      expect(namesOf(item)).toEqual(inputs)
    }
  })

  it('carries the events the confirm matches', () => {
    for (const [name, signature] of [
      ['MintGroupRegistered', 'MintGroupRegistered(uint256)'],
      ['MintGroupStatusChanged', 'MintGroupStatusChanged(uint256,bool)'],
      ['AllMintGroupsStatusChanged', 'AllMintGroupsStatusChanged(bool,uint256)'],
      ['MintGroupStartTimestampChanged', 'MintGroupStartTimestampChanged(uint256,uint256)'],
      ['SalePriceChanged', 'SalePriceChanged(uint256,uint256)'],
      ['MintGroupMaxSupplyUpdated', 'MintGroupMaxSupplyUpdated(uint256,uint256)'],
      ['PublicMaxMintPerWalletChanged', 'PublicMaxMintPerWalletChanged(uint256)'],
    ] as const) {
      expect(toEventSelector(getAbiItem({ abi: abiOnly, name }))).toBe(toEventSelector(signature))
    }
  })

  it('carries the errors the manage sentences decode', () => {
    for (const [name, signature] of [
      ['BelowMinted', 'BelowMinted(uint256)'],
      ['AllocationsExceedMaxSupply', 'AllocationsExceedMaxSupply()'],
      ['MintGroupAlreadyExists', 'MintGroupAlreadyExists(uint256)'],
      ['MintGroupDoesNotExist', 'MintGroupDoesNotExist(uint256)'],
      ['AddressZero', 'AddressZero()'],
      ['Unauthorized', 'Unauthorized(address)'],
      ['OwnableUnauthorizedAccount', 'OwnableUnauthorizedAccount(address)'],
    ] as const) {
      expect(signatureOf(getAbiItem({ abi: abiOnly, name }))).toBe(signature)
    }
  })
})

describe('what Whitelist relies on (docs/specs/2026-10-15-whitelist.md, section 5)', () => {
  it('carries setMintQuota with its argument names, and the quota and ERC-721 views the server reads', () => {
    const quotas = getAbiItem({ abi: abiOnly, name: 'setMintQuota' })
    expect(toFunctionSelector(quotas)).toBe(toFunctionSelector('setMintQuota(address[],uint256,uint256[])'))
    expect(namesOf(quotas)).toEqual(['addressesToAdd', 'mintGroup', 'mintQuotas_'])
    for (const [name, signature] of [
      ['mintQuotas', 'mintQuotas(uint256,address)'],
      ['quotaClaimed', 'quotaClaimed(uint256,address)'],
      ['walletState', 'walletState(address)'],
      ['ownerOf', 'ownerOf(uint256)'],
      ['totalSupply', 'totalSupply()'],
      ['supportsInterface', 'supportsInterface(bytes4)'],
    ] as const) {
      expect(toFunctionSelector(getAbiItem({ abi: abiOnly, name }))).toBe(toFunctionSelector(signature))
    }
  })

  it('carries the event a chunk leaves and the errors the quota sentences decode', () => {
    expect(toEventSelector(getAbiItem({ abi: abiOnly, name: 'MintQuotasAdded' }))).toBe(
      toEventSelector('MintQuotasAdded(uint256,uint256)'),
    )
    for (const [name, signature] of [
      ['ArrayLengthMismatch', 'ArrayLengthMismatch()'],
      ['PublicGroupHasNoQuota', 'PublicGroupHasNoQuota()'],
      ['NotInWhitelist', 'NotInWhitelist(address,uint256)'],
      ['ExceedsMintQuota', 'ExceedsMintQuota(uint256,uint256)'],
    ] as const) {
      expect(signatureOf(getAbiItem({ abi: abiOnly, name }))).toBe(signature)
    }
    expect(namesOf(getAbiItem({ abi: abiOnly, name: 'ExceedsMintQuota' }))).toEqual(['requested', 'allowed'])
  })
})
