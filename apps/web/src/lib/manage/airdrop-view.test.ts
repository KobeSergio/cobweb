import { getAddress, pad, toHex, type Address, type Hex } from 'viem'
import { describe, expect, it } from 'vitest'
import type { AirdropRow, AirdropState, AirdropView, BatchEntry } from './airdrop-types'
import { airdropRowsOf, airdropViewOf, batchesOf, tokensOf, type AirdropDbRow } from './airdrop-view'

const CONTRACT: Address = '0x0409454C375c8a6aB05383bFB6D9FcDe9ebB8F85'
const OWNER: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const TX_A: Hex = `0x${'a1'.repeat(32)}`
const TX_B: Hex = `0x${'b2'.repeat(32)}`

/** A wallet of its own for each index. */
const wallet = (index: number): Address => getAddress(pad(toHex(index + 1), { size: 20 }))
const entries = (count: number, amount: number): BatchEntry[] =>
  Array.from({ length: count }, (_, index) => ({ address: wallet(index), amount }))
/** Each batch as "<wallets>:<tokens>". */
const sizes = (batches: BatchEntry[][]) => batches.map((batch) => `${batch.length}:${tokensOf(batch)}`)

describe('batchesOf', () => {
  it('splits 1,200 wallets of one token into batches of 500 wallets', () => {
    expect(sizes(batchesOf(entries(1_200, 1)))).toEqual(['500:500', '500:500', '200:200'])
  })

  it('starts a new batch at 1,000 tokens even under 500 wallets (Review Focus 2)', () => {
    expect(sizes(batchesOf(entries(600, 2)))).toEqual(['500:1000', '100:200'])
    expect(sizes(batchesOf(entries(300, 4)))).toEqual(['250:1000', '50:200'])
  })

  it("keeps the list's order: an entry that does not fit starts the next batch", () => {
    const list: BatchEntry[] = [
      { address: wallet(0), amount: 600 },
      { address: wallet(1), amount: 500 },
      { address: wallet(2), amount: 400 },
      { address: wallet(3), amount: 1000 },
    ]
    expect(batchesOf(list)).toEqual([[list[0]], [list[1], list[2]], [list[3]]])
  })

  it('copies only the address and the amount of each entry, and answers no batch for no entries', () => {
    const parsed = { address: wallet(0), amount: 2, line: 7 }
    expect(batchesOf([parsed])).toEqual([[{ address: wallet(0), amount: 2 }]])
    expect(batchesOf([])).toEqual([])
  })
})

const ROWS: AirdropDbRow[] = [
  {
    tx_hash: TX_B,
    kind: 'burn',
    recipients: 1,
    tokens: 2,
    fee_paid_wei: '100000000000000',
    first_token_id: 11,
    last_token_id: 12,
    block: 21_499_995,
    confirmed_at: '2026-10-13T15:00:00.400+00:00',
  },
  {
    tx_hash: TX_A,
    kind: 'airdrop',
    recipients: 4,
    tokens: 10,
    fee_paid_wei: '500000000000000',
    first_token_id: 1,
    last_token_id: 10,
    block: 21_499_990,
    confirmed_at: '2026-10-11T15:00:00+00:00',
  },
]

describe('airdropRowsOf', () => {
  it('keeps the order read and reads confirmed_at as Unix seconds', () => {
    expect(airdropRowsOf(ROWS)).toEqual<AirdropRow[]>([
      {
        txHash: TX_B,
        kind: 'burn',
        recipients: 1,
        tokens: 2,
        feePaidWei: '100000000000000',
        firstTokenId: 11,
        lastTokenId: 12,
        block: 21_499_995,
        confirmedAt: 1_791_903_600,
      },
      {
        txHash: TX_A,
        kind: 'airdrop',
        recipients: 4,
        tokens: 10,
        feePaidWei: '500000000000000',
        firstTokenId: 1,
        lastTokenId: 10,
        block: 21_499_990,
        confirmedAt: 1_791_730_800,
      },
    ])
  })
})

describe('airdropViewOf', () => {
  const base = { chainId: 31337, contract: CONTRACT, maxSupply: 3, readAt: 1_791_000_000 }
  const history = airdropRowsOf(ROWS)
  const state: AirdropState = {
    block: 120n,
    blockTimestamp: 1_791_039_600,
    maxSupply: 12,
    totalMinted: 4,
    feePerTokenWei: '100000000000000',
    owner: OWNER,
  }

  it("reads the fee, the owner, minted and left from a read, at the read's block time", () => {
    expect(airdropViewOf(base, history, state)).toEqual<AirdropView>({
      chainId: 31337,
      contract: CONTRACT,
      owner: OWNER,
      feePerTokenWei: '100000000000000',
      maxSupply: 12,
      totalMinted: 4,
      left: 8,
      history,
      blockTimestamp: 1_791_039_600,
      readAt: 1_791_039_600,
      chainReachable: true,
    })
    expect(airdropViewOf(base, history, { ...state, totalMinted: 13 }).left).toBe(0)
  })

  it("answers Cobweb's record alone when the chain does not answer", () => {
    expect(airdropViewOf(base, history, null)).toEqual<AirdropView>({
      chainId: 31337,
      contract: CONTRACT,
      owner: null,
      feePerTokenWei: null,
      maxSupply: 3,
      totalMinted: null,
      left: null,
      history,
      blockTimestamp: 1_791_000_000,
      readAt: 1_791_000_000,
      chainReachable: false,
    })
  })
})
