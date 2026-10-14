import { getAddress, type Address, type Hex } from 'viem'
import { describe, expect, it } from 'vitest'
import {
  collectionSalt,
  encodeCollectionArgs,
  predictCollectionAddress,
  type CollectionArgs,
} from './deploy-address.ts'
import { onchainJobId } from './job-id.ts'

const COLLECTION = '0f4a0f3e-2f5e-4e3a-9d1c-1b2c3d4e5f60'
/** The local factory, as chain:local deploys it from Anvil's first account at nonce 0. */
const FACTORY: Address = '0x5FbDB2315678afecb367f032d93F642f64180aa3'
const DEPLOYER: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const RECEIVER: Address = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
const TINY_CODE: Hex = '0x6080604052'

const args: CollectionArgs = {
  name: 'Night Owls',
  symbol: 'OWLS',
  payout: DEPLOYER,
  baseUri: 'ipfs://bafybeihkoviema7g3gxyt6la7vd5ho32ictqbilu3wnlo3rs7ewhnp7lly/',
  maxSupply: 777n,
  groupSupplies: [600n, 177n],
  groupPrices: [0n, 3_000_000_000_000_000n],
  publicMaxPerWallet: 3n,
  royaltyBps: 500,
  owner: DEPLOYER,
  royaltyReceiver: RECEIVER,
}

/**
 * `cast abi-encode` of the same arguments on 14 October 2026, as 32-byte words: the head (the tuple
 * and two array offsets, the cap, the royalty, the owner, the receiver), then the tuple (its three
 * string offsets, the payout, the supply, the strings), then the two arrays.
 */
const ENCODED_WORDS = [
  '00000000000000000000000000000000000000000000000000000000000000e0',
  '0000000000000000000000000000000000000000000000000000000000000280',
  '00000000000000000000000000000000000000000000000000000000000002e0',
  '0000000000000000000000000000000000000000000000000000000000000003',
  '00000000000000000000000000000000000000000000000000000000000001f4',
  '00000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c8',
  '0000000000000000000000003c44cdddb6a900fa2b585dd299e03d12fa4293bc',
  '00000000000000000000000000000000000000000000000000000000000000a0',
  '00000000000000000000000000000000000000000000000000000000000000e0',
  '00000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c8',
  '0000000000000000000000000000000000000000000000000000000000000120',
  '0000000000000000000000000000000000000000000000000000000000000309',
  '000000000000000000000000000000000000000000000000000000000000000a',
  '4e69676874204f776c7300000000000000000000000000000000000000000000',
  '0000000000000000000000000000000000000000000000000000000000000004',
  '4f574c5300000000000000000000000000000000000000000000000000000000',
  '0000000000000000000000000000000000000000000000000000000000000043',
  '697066733a2f2f62616679626569686b6f7669656d6137673367787974366c61',
  '37766435686f33326963747162696c7533776e6c6f337273376577686e70376c',
  '6c792f0000000000000000000000000000000000000000000000000000000000',
  '0000000000000000000000000000000000000000000000000000000000000002',
  '0000000000000000000000000000000000000000000000000000000000000258',
  '00000000000000000000000000000000000000000000000000000000000000b1',
  '0000000000000000000000000000000000000000000000000000000000000002',
  '0000000000000000000000000000000000000000000000000000000000000000',
  '000000000000000000000000000000000000000000000000000aa87bee538000',
]
const ENCODED = `0x${ENCODED_WORDS.join('')}` as const

describe('collectionSalt', () => {
  it('puts the 16 uuid bytes first and pads with 16 zero bytes, as the job id does for payments', () => {
    expect(collectionSalt(COLLECTION)).toBe(`0x0f4a0f3e2f5e4e3a9d1c1b2c3d4e5f60${'0'.repeat(32)}`)
    expect(collectionSalt(COLLECTION.toUpperCase())).toBe(collectionSalt(COLLECTION))
    expect(collectionSalt(COLLECTION)).toBe(onchainJobId(COLLECTION))
  })

  it('refuses what is not a uuid', () => {
    expect(() => collectionSalt('collection-1')).toThrow('A collection id is a uuid.')
    expect(() => collectionSalt(`0x${'1'.repeat(64)}`)).toThrow('A collection id is a uuid.')
  })
})

describe('encodeCollectionArgs', () => {
  it("matches abi.encode of the constructor's arguments (the cast abi-encode vector)", () => {
    expect(ENCODED_WORDS).toHaveLength(26)
    expect(encodeCollectionArgs(args)).toBe(ENCODED)
  })

  it('encodes the royalty as a uint96 and every group in order', () => {
    const encoded = encodeCollectionArgs({ ...args, royaltyBps: 1000, groupPrices: [1n, 2n] })
    const words = encoded.slice(2).match(/.{64}/g) ?? []
    expect(words[4]).toBe('00000000000000000000000000000000000000000000000000000000000003e8')
    expect(words[24]).toBe('0000000000000000000000000000000000000000000000000000000000000001')
    expect(words[25]).toBe('0000000000000000000000000000000000000000000000000000000000000002')
  })
})

describe('predictCollectionAddress', () => {
  it("matches the factory's predictCollectionAddress view (the cast call vector)", () => {
    const predicted = predictCollectionAddress({
      factory: FACTORY,
      deployer: DEPLOYER,
      salt: collectionSalt(COLLECTION),
      creationCode: TINY_CODE,
      args: ENCODED,
    })
    expect(predicted).toBe('0x0409454C375c8a6aB05383bFB6D9FcDe9ebB8F85')
    expect(predicted).toBe(getAddress(predicted))
  })

  it('changes with the deployer, the salt, the code and the arguments, and not with the case of the inputs', () => {
    const base = {
      factory: FACTORY,
      deployer: DEPLOYER,
      salt: collectionSalt(COLLECTION),
      creationCode: TINY_CODE,
      args: ENCODED,
    }
    const predicted = predictCollectionAddress(base)
    expect(predictCollectionAddress({ ...base, deployer: RECEIVER })).toBe(
      '0x2073D2716161E2Fa4eBcB3BA42348dE8f98A3dDd',
    )
    expect(predictCollectionAddress({ ...base, salt: `0x${'1'.repeat(64)}` })).not.toBe(predicted)
    expect(predictCollectionAddress({ ...base, creationCode: '0x60806040' })).not.toBe(predicted)
    expect(
      predictCollectionAddress({ ...base, args: encodeCollectionArgs({ ...args, royaltyBps: 600 }) }),
    ).not.toBe(predicted)
    expect(
      predictCollectionAddress({
        ...base,
        factory: FACTORY.toLowerCase() as Address,
        deployer: DEPLOYER.toLowerCase() as Address,
      }),
    ).toBe(predicted)
  })
})
