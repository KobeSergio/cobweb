import { collectionAbi } from '@cobweb/shared/collection-abi'
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  getAbiItem,
  type AbiEvent,
  type Address,
  type Hex,
} from 'viem'
import { describe, expect, it } from 'vitest'
import { NOT_FROM_WALLET, NOT_THIS_CHANGE, NOT_THIS_CONTRACT } from '@/lib/art/result'
import { phaseCalls, type ManageCall } from '@/lib/manage/phase-calls'
import type { PhaseReceipt } from './phase-events'
import { proveQuotaChunk, type ChunkProof } from './quota-chunk'

const CONTRACT: Address = '0x0409454C375c8a6aB05383bFB6D9FcDe9ebB8F85'
const ELSEWHERE: Address = '0x2073D2716161E2Fa4eBcB3BA42348dE8f98A3dDd'
const WALLET: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const STRANGER: Address = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
const A: Address = '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65'
const B: Address = '0x90F79bf6EB2c4f870365E785982E1f101E93b906'

type ReceiptLog = PhaseReceipt['logs'][number]

/** The calldata the wallet sends for a call. */
const inputOf = (call: ManageCall): Hex =>
  encodeFunctionData({ abi: collectionAbi, functionName: call.functionName, args: call.args })

/** `MintQuotasAdded` as the contract emits it: neither argument is indexed, so both sit in data. */
function quotasAdded(group: bigint, count: bigint, address: Address = CONTRACT): ReceiptLog {
  const item = getAbiItem({ abi: collectionAbi, name: 'MintQuotasAdded' }) as AbiEvent
  return {
    address,
    topics: encodeEventTopics({ abi: [item], eventName: item.name } as never) as ReceiptLog['topics'],
    data: encodeAbiParameters(item.inputs, [group, count]),
  }
}

const receipt = (logs: ReceiptLog[], patch: Partial<PhaseReceipt> = {}): PhaseReceipt => ({
  status: 'success',
  from: WALLET,
  to: CONTRACT,
  logs,
  ...patch,
})

const expected = { contract: CONTRACT, from: WALLET.toLowerCase(), onchainId: 1 }
const CHUNK: ManageCall = phaseCalls.quotas(1, [A, B], [2, 0])

describe('proveQuotaChunk', () => {
  it('answers the pairs the calldata carries, lowercased, for a chunk sent from the wallet to the collection', () => {
    expect(proveQuotaChunk(receipt([quotasAdded(1n, 2n)]), inputOf(CHUNK), expected)).toEqual<ChunkProof>({
      ok: true,
      pairs: [
        { address: A.toLowerCase(), quota: 2 },
        { address: B.toLowerCase(), quota: 0 },
      ],
    })
  })

  it("keeps an address's last quota when the calldata repeats it, in any case, as the contract does", () => {
    const repeated = phaseCalls.quotas(1, [A, B, A.toLowerCase() as Address], [3, 2, 0])
    expect(proveQuotaChunk(receipt([quotasAdded(1n, 3n)]), inputOf(repeated), expected)).toEqual<ChunkProof>({
      ok: true,
      pairs: [
        { address: A.toLowerCase(), quota: 0 },
        { address: B.toLowerCase(), quota: 2 },
      ],
    })
  })

  it('matches the contract and the wallet whatever their case', () => {
    const proof = proveQuotaChunk(
      receipt([quotasAdded(1n, 2n, CONTRACT.toLowerCase() as Address)], { from: WALLET }),
      inputOf(CHUNK),
      { contract: CONTRACT.toLowerCase() as Address, from: WALLET.toLowerCase(), onchainId: 1 },
    )
    expect(proof.ok).toBe(true)
  })

  it.each<[string, PhaseReceipt, Hex, number, string]>([
    [
      'another contract',
      receipt([quotasAdded(1n, 2n)], { to: ELSEWHERE }),
      inputOf(CHUNK),
      1,
      NOT_THIS_CONTRACT,
    ],
    [
      'a contract creation',
      receipt([quotasAdded(1n, 2n)], { to: null }),
      inputOf(CHUNK),
      1,
      NOT_THIS_CONTRACT,
    ],
    [
      'another sender',
      receipt([quotasAdded(1n, 2n)], { from: STRANGER }),
      inputOf(CHUNK),
      1,
      NOT_FROM_WALLET,
    ],
    ['a reverted receipt', receipt([], { status: 'reverted' }), inputOf(CHUNK), 1, NOT_THIS_CHANGE],
    ['an input the ABI does not decode', receipt([quotasAdded(1n, 2n)]), '0xdeadbeef', 1, NOT_THIS_CHANGE],
    ['another function', receipt([quotasAdded(1n, 2n)]), inputOf(phaseCalls.open(1)), 1, NOT_THIS_CHANGE],
    ['another group', receipt([quotasAdded(1n, 2n)]), inputOf(CHUNK), 2, NOT_THIS_CHANGE],
    [
      'a quota above 10,000',
      receipt([quotasAdded(1n, 1n)]),
      inputOf(phaseCalls.quotas(1, [A], [10_001])),
      1,
      NOT_THIS_CHANGE,
    ],
    ['no MintQuotasAdded', receipt([]), inputOf(CHUNK), 1, NOT_THIS_CHANGE],
    [
      'MintQuotasAdded with another count',
      receipt([quotasAdded(1n, 3n)]),
      inputOf(CHUNK),
      1,
      NOT_THIS_CHANGE,
    ],
    [
      'MintQuotasAdded from another contract',
      receipt([quotasAdded(1n, 2n, ELSEWHERE)]),
      inputOf(CHUNK),
      1,
      NOT_THIS_CHANGE,
    ],
  ])('refuses %s', (_label, proven, input, onchainId, error) => {
    expect(proveQuotaChunk(proven, input, { ...expected, onchainId })).toEqual<ChunkProof>({
      ok: false,
      error,
    })
  })
})
