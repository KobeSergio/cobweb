import { collectionAbi } from '@cobweb/shared/collection-abi'
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  getAbiItem,
  zeroAddress,
  type Abi,
  type AbiEvent,
  type Address,
  type Hex,
} from 'viem'
import { describe, expect, it } from 'vitest'
import { NOT_FROM_WALLET, NOT_THIS_CHANGE, NOT_THIS_CONTRACT } from '@/lib/art/result'
import { BURN_ADDRESS } from '@/lib/manage/airdrop-view'
import { abiOf, airdropCalls, phaseCalls, type ManageCall } from '@/lib/manage/phase-calls'
import { proveAirdrop, type AirdropProof } from './airdrop-batch'
import type { PhaseReceipt } from './phase-events'

const CONTRACT: Address = '0x0409454C375c8a6aB05383bFB6D9FcDe9ebB8F85'
const ELSEWHERE: Address = '0x2073D2716161E2Fa4eBcB3BA42348dE8f98A3dDd'
const WALLET: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const STRANGER: Address = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
const A: Address = '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65'
const B: Address = '0x90F79bf6EB2c4f870365E785982E1f101E93b906'
const FEE = 100_000_000_000_000n

type ReceiptLog = PhaseReceipt['logs'][number]

/** The calldata the wallet sends for a call. */
const inputOf = (call: ManageCall): Hex =>
  encodeFunctionData({ abi: abiOf(call) as Abi, functionName: call.functionName, args: call.args })

/** `NFTsAirdropped` as the contract emits it: nothing indexed, so all three sit in data. */
function airdropped(
  recipients: bigint,
  amount: bigint,
  feePaid: bigint,
  address: Address = CONTRACT,
): ReceiptLog {
  const item = getAbiItem({ abi: collectionAbi, name: 'NFTsAirdropped' }) as AbiEvent
  return {
    address,
    topics: encodeEventTopics({ abi: [item], eventName: item.name } as never) as ReceiptLog['topics'],
    data: encodeAbiParameters(item.inputs, [recipients, amount, feePaid]),
  }
}

/** `Transfer` as ERC721A emits it: from, to and the id all indexed. */
function transfer(from: Address, to: Address, tokenId: bigint, address: Address = CONTRACT): ReceiptLog {
  return {
    address,
    topics: encodeEventTopics({
      abi: collectionAbi,
      eventName: 'Transfer',
      args: { from, to, tokenId },
    }) as ReceiptLog['topics'],
    data: '0x',
  }
}

/** One mint per recipient, ids running on from `first`. */
const mints = (recipients: Address[], first: bigint, address: Address = CONTRACT) =>
  recipients.map((recipient, index) => transfer(zeroAddress, recipient, first + BigInt(index), address))

const receipt = (logs: ReceiptLog[], patch: Partial<PhaseReceipt> = {}): PhaseReceipt => ({
  status: 'success',
  from: WALLET,
  to: CONTRACT,
  logs,
  ...patch,
})

const expected = { contract: CONTRACT, from: WALLET.toLowerCase() }
const BATCH: ManageCall = airdropCalls.batch(
  [
    { address: A, amount: 2 },
    { address: B, amount: 1 },
  ],
  FEE.toString(),
)
const LOGS = [...mints([A, A, B], 5n), airdropped(2n, 3n, 3n * FEE)]

describe('proveAirdrop', () => {
  it('answers the batch from the calldata, the fee its event carries and the ids it minted', () => {
    expect(proveAirdrop(receipt(LOGS), inputOf(BATCH), expected)).toEqual<AirdropProof>({
      ok: true,
      batch: {
        kind: 'airdrop',
        recipients: 2,
        tokens: 3,
        feePaidWei: '300000000000000',
        firstTokenId: 5,
        lastTokenId: 7,
      },
    })
  })

  it('accepts consecutive ids in any order, and leaves out a Transfer a recipient contract sends on (Review Focus 3)', () => {
    const logs = [
      transfer(zeroAddress, B, 7n),
      transfer(zeroAddress, A, 5n),
      transfer(A, STRANGER, 5n),
      transfer(zeroAddress, A, 6n),
      airdropped(2n, 3n, 3n * FEE),
    ]
    expect(proveAirdrop(receipt(logs), inputOf(BATCH), expected)).toMatchObject({
      ok: true,
      batch: { tokens: 3, firstTokenId: 5, lastTokenId: 7 },
    })
  })

  it('reads a burn from its only recipient, the dead address, in any case', () => {
    const logs = [...mints([BURN_ADDRESS, BURN_ADDRESS], 11n), airdropped(1n, 2n, 2n * FEE)]
    const lowercase: ManageCall = {
      functionName: 'airdropNFTs',
      args: [[BURN_ADDRESS.toLowerCase() as Address], [2n]],
      value: 2n * FEE,
    }
    for (const call of [airdropCalls.burn(2, FEE.toString()), lowercase])
      expect(proveAirdrop(receipt(logs), inputOf(call), expected)).toEqual<AirdropProof>({
        ok: true,
        batch: {
          kind: 'burn',
          recipients: 1,
          tokens: 2,
          feePaidWei: '200000000000000',
          firstTokenId: 11,
          lastTokenId: 12,
        },
      })
  })

  it('reads one recipient that is not the dead address as an airdrop', () => {
    const one = airdropCalls.batch([{ address: A, amount: 1 }], FEE.toString())
    const proof = proveAirdrop(receipt([...mints([A], 1n), airdropped(1n, 1n, FEE)]), inputOf(one), expected)
    expect(proof).toMatchObject({ ok: true, batch: { kind: 'airdrop', recipients: 1, tokens: 1 } })
  })

  it.each<[string, PhaseReceipt, Hex, string]>([
    ['another contract', receipt(LOGS, { to: ELSEWHERE }), inputOf(BATCH), NOT_THIS_CONTRACT],
    ['a contract creation', receipt(LOGS, { to: null }), inputOf(BATCH), NOT_THIS_CONTRACT],
    ['another sender', receipt(LOGS, { from: STRANGER }), inputOf(BATCH), NOT_FROM_WALLET],
    ['a reverted receipt', receipt([], { status: 'reverted' }), inputOf(BATCH), NOT_THIS_CHANGE],
    ['an input the ABI does not decode', receipt(LOGS), '0xdeadbeef', NOT_THIS_CHANGE],
    ['another function', receipt(LOGS), inputOf(phaseCalls.open(1)), NOT_THIS_CHANGE],
    [
      'recipients and amounts of different lengths',
      receipt(LOGS),
      encodeFunctionData({ abi: collectionAbi, functionName: 'airdropNFTs', args: [[A, B], [3n]] }),
      NOT_THIS_CHANGE,
    ],
    [
      'no token at all',
      receipt([airdropped(1n, 0n, 0n)]),
      inputOf(airdropCalls.batch([{ address: A, amount: 0 }], '0')),
      NOT_THIS_CHANGE,
    ],
    ['no NFTsAirdropped', receipt(mints([A, A, B], 5n)), inputOf(BATCH), NOT_THIS_CHANGE],
    [
      'NFTsAirdropped with other counts',
      receipt([...mints([A, A, B], 5n), airdropped(3n, 3n, 3n * FEE)]),
      inputOf(BATCH),
      NOT_THIS_CHANGE,
    ],
    [
      'NFTsAirdropped from another contract',
      receipt([...mints([A, A, B], 5n), airdropped(2n, 3n, 3n * FEE, ELSEWHERE)]),
      inputOf(BATCH),
      NOT_THIS_CHANGE,
    ],
    [
      'fewer mints than tokens',
      receipt([...mints([A, A], 5n), airdropped(2n, 3n, 3n * FEE)]),
      inputOf(BATCH),
      NOT_THIS_CHANGE,
    ],
    [
      'mints from another contract',
      receipt([...mints([A, A, B], 5n, ELSEWHERE), airdropped(2n, 3n, 3n * FEE)]),
      inputOf(BATCH),
      NOT_THIS_CHANGE,
    ],
    [
      'ids that do not run on',
      receipt([...mints([A, A], 5n), transfer(zeroAddress, B, 8n), airdropped(2n, 3n, 3n * FEE)]),
      inputOf(BATCH),
      NOT_THIS_CHANGE,
    ],
  ])('refuses %s', (_label, proven, input, error) => {
    expect(proveAirdrop(proven, input, expected)).toEqual<AirdropProof>({ ok: false, error })
  })
})
