import { factoryAbi } from '@cobweb/shared'
import { encodeAbiParameters, encodeEventTopics, type Address, type Hex } from 'viem'
import { describe, expect, it } from 'vitest'
import { NOT_THIS_DEPLOY, OTHER_CODE, OTHER_CONTRACT } from '@/lib/art/result'
import type { ReceiptLike } from './art-paid'
import { matchCollectionDeployed } from './collection-deployed'

const FACTORY: Address = '0x5FbDB2315678afecb367f032d93F642f64180aa3'
const ELSEWHERE: Address = '0x0000000000000000000000000000000000000AbC'
const DEPLOYER: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const STRANGER: Address = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
const PREDICTED: Address = '0x0409454C375c8a6aB05383bFB6D9FcDe9ebB8F85'
const OTHER: Address = '0x2073D2716161E2Fa4eBcB3BA42348dE8f98A3dDd'
const SALT: Hex = `0x0f4a0f3e2f5e4e3a9d1c1b2c3d4e5f60${'0'.repeat(32)}`
const OTHER_SALT: Hex = `0x${'1'.repeat(64)}`
const CODE_HASH: Hex = '0xa57eac3d6d8dca5d3bb294162c964342bd351cba3cf034f1b8b6b3e2ca9ae594'
const OTHER_HASH: Hex = `0x${'b'.repeat(64)}`

type ReceiptLog = ReceiptLike['logs'][number]

function deployed(
  address: Address,
  args: { collection: Address; codeHash: Hex; deployer: Address; salt: Hex },
): ReceiptLog {
  const topics = encodeEventTopics({
    abi: factoryAbi,
    eventName: 'CollectionDeployed',
    args: { collection: args.collection, codeHash: args.codeHash, deployer: args.deployer },
  })
  return {
    address,
    topics: topics as ReceiptLog['topics'],
    data: encodeAbiParameters([{ type: 'bytes32' }], [args.salt]),
  }
}

/** The factory's real `ArtPaid` log, with the same job id and wallet as the deploy's salt and deployer. */
function artPaid(address: Address): ReceiptLog {
  const topics = encodeEventTopics({
    abi: factoryAbi,
    eventName: 'ArtPaid',
    args: { jobId: SALT, payer: DEPLOYER },
  })
  return {
    address,
    topics: topics as ReceiptLog['topics'],
    data: encodeAbiParameters([{ type: 'uint256' }], [125_000_000_000_000n]),
  }
}

const receipt = (...logs: ReceiptLog[]): ReceiptLike => ({ status: 'success', logs })
const expected = {
  factory: FACTORY,
  deployer: DEPLOYER,
  salt: SALT,
  codeHash: CODE_HASH,
  predicted: PREDICTED,
}
const good = { collection: PREDICTED, codeHash: CODE_HASH, deployer: DEPLOYER, salt: SALT }

describe('matchCollectionDeployed', () => {
  it("matches the factory's CollectionDeployed log for this deployer and salt at the predicted address", () => {
    expect(matchCollectionDeployed(receipt(deployed(FACTORY, good)), expected)).toEqual({
      ok: true,
      collection: PREDICTED,
    })
    // The address is answered checksummed whatever the log's case.
    expect(
      matchCollectionDeployed(
        receipt(deployed(FACTORY, { ...good, collection: PREDICTED.toLowerCase() as Address })),
        { ...expected, predicted: PREDICTED.toLowerCase() as Address },
      ),
    ).toEqual({ ok: true, collection: PREDICTED })
  })

  it('refuses a receipt with no CollectionDeployed log, and one that reverted', () => {
    expect(matchCollectionDeployed(receipt(), expected)).toEqual({ ok: false, error: NOT_THIS_DEPLOY })
    expect(
      matchCollectionDeployed({ status: 'reverted', logs: [deployed(FACTORY, good)] }, expected),
    ).toEqual({
      ok: false,
      error: NOT_THIS_DEPLOY,
    })
  })

  it('ignores a CollectionDeployed log emitted by any other contract (Review Focus 1)', () => {
    expect(matchCollectionDeployed(receipt(deployed(ELSEWHERE, good)), expected)).toEqual({
      ok: false,
      error: NOT_THIS_DEPLOY,
    })
  })

  it('refuses a log for another deployer or another salt (Review Focus 1)', () => {
    expect(
      matchCollectionDeployed(receipt(deployed(FACTORY, { ...good, deployer: STRANGER })), expected),
    ).toEqual({
      ok: false,
      error: NOT_THIS_DEPLOY,
    })
    expect(
      matchCollectionDeployed(receipt(deployed(FACTORY, { ...good, salt: OTHER_SALT })), expected),
    ).toEqual({
      ok: false,
      error: NOT_THIS_DEPLOY,
    })
  })

  it('refuses a deployment of other contract code', () => {
    expect(
      matchCollectionDeployed(receipt(deployed(FACTORY, { ...good, codeHash: OTHER_HASH })), expected),
    ).toEqual({
      ok: false,
      error: OTHER_CODE,
    })
  })

  it('refuses a collection built from other arguments: the address differs from the prediction (Review Focus 1)', () => {
    expect(
      matchCollectionDeployed(receipt(deployed(FACTORY, { ...good, collection: OTHER })), expected),
    ).toEqual({
      ok: false,
      error: OTHER_CONTRACT,
    })
  })

  it("skips the factory's other logs and finds the matching one among several", () => {
    const unrelated: ReceiptLog = { address: FACTORY, topics: [`0x${'12'.repeat(32)}`], data: '0x' }
    expect(
      matchCollectionDeployed(
        receipt(
          unrelated,
          deployed(FACTORY, { ...good, salt: OTHER_SALT, collection: OTHER }),
          deployed(FACTORY, { ...good, codeHash: OTHER_HASH }),
          deployed(FACTORY, good),
        ),
        expected,
      ),
    ).toEqual({ ok: true, collection: PREDICTED })
  })

  it("skips the factory's ArtPaid log by its name: viem decodes any event of the ABI", () => {
    expect(matchCollectionDeployed(receipt(artPaid(FACTORY)), expected)).toEqual({
      ok: false,
      error: NOT_THIS_DEPLOY,
    })
    expect(matchCollectionDeployed(receipt(artPaid(FACTORY), deployed(FACTORY, good)), expected)).toEqual({
      ok: true,
      collection: PREDICTED,
    })
  })
})
