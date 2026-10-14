import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getAbiItem, keccak256, toFunctionSelector } from 'viem'
import { describe, expect, it } from 'vitest'
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
    it('ships the bytecode of the Foundry build in contracts/out', () => {
      const built = JSON.parse(readFileSync(artifact, 'utf8')) as { bytecode: { object: string } }
      expect(COLLECTION_CREATION_CODE).toBe(built.bytecode.object)
      expect(COLLECTION_CODE_HASH).toBe(keccak256(built.bytecode.object as `0x${string}`))
    })
  } else {
    it.skip('ships the bytecode of the Foundry build in contracts/out (run forge build in contracts/ to check it)', () => {})
  }
})
