import { factoryAbi } from '@cobweb/shared'
import { encodeAbiParameters, encodeEventTopics, type Address, type Hex } from 'viem'
import { describe, expect, it } from 'vitest'
import { NOT_THIS_JOB, OTHER_WALLET, SHORT_PAYMENT } from '@/lib/art/result'
import { matchArtPaid, type ReceiptLike } from './art-paid'

const FACTORY: Address = '0x5FbDB2315678afecb367f032d93F642f64180aa3'
const ELSEWHERE: Address = '0x0000000000000000000000000000000000000AbC'
const JOB: Hex = `0x0f4a0f3e2f5e4e3a9d1c1b2c3d4e5f60${'0'.repeat(32)}`
const OTHER_JOB: Hex = `0x1f4a0f3e2f5e4e3a9d1c1b2c3d4e5f61${'0'.repeat(32)}`
const PAYER: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const STRANGER: Address = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'

type ReceiptLog = ReceiptLike['logs'][number]

function artPaid(address: Address, jobId: Hex, payer: Address, amount: bigint): ReceiptLog {
  const topics = encodeEventTopics({ abi: factoryAbi, eventName: 'ArtPaid', args: { jobId, payer } })
  return {
    address,
    topics: topics as ReceiptLog['topics'],
    data: encodeAbiParameters([{ type: 'uint256' }], [amount]),
  }
}

const receipt = (...logs: ReceiptLog[]): ReceiptLike => ({ status: 'success', logs })
const expected = { factory: FACTORY, jobId: JOB, payer: PAYER.toLowerCase(), minAmount: 100n }

describe('matchArtPaid', () => {
  it("matches the factory's ArtPaid log for this job from the quote's wallet with at least the quote", () => {
    expect(matchArtPaid(receipt(artPaid(FACTORY, JOB, PAYER, 100n)), expected)).toEqual({
      ok: true,
      payer: PAYER,
      amount: 100n,
    })
    expect(matchArtPaid(receipt(artPaid(FACTORY, JOB, PAYER, 150n)), expected)).toEqual({
      ok: true,
      payer: PAYER,
      amount: 150n,
    })
  })

  it('refuses a payment for another job', () => {
    expect(matchArtPaid(receipt(artPaid(FACTORY, OTHER_JOB, PAYER, 100n)), expected)).toEqual({
      ok: false,
      error: NOT_THIS_JOB,
    })
  })

  it('refuses a payment from another wallet', () => {
    expect(matchArtPaid(receipt(artPaid(FACTORY, JOB, STRANGER, 100n)), expected)).toEqual({
      ok: false,
      error: OTHER_WALLET,
    })
  })

  it('refuses a payment short of the quote', () => {
    expect(matchArtPaid(receipt(artPaid(FACTORY, JOB, PAYER, 99n)), expected)).toEqual({
      ok: false,
      error: SHORT_PAYMENT,
    })
  })

  it('refuses a receipt with no ArtPaid log, and one that reverted', () => {
    expect(matchArtPaid(receipt(), expected)).toEqual({ ok: false, error: NOT_THIS_JOB })
    expect(
      matchArtPaid({ status: 'reverted', logs: [artPaid(FACTORY, JOB, PAYER, 100n)] }, expected),
    ).toEqual({ ok: false, error: NOT_THIS_JOB })
  })

  it('ignores an ArtPaid log emitted by any other contract', () => {
    expect(matchArtPaid(receipt(artPaid(ELSEWHERE, JOB, PAYER, 100n)), expected)).toEqual({
      ok: false,
      error: NOT_THIS_JOB,
    })
  })

  it("skips the factory's other logs and finds the matching one among several", () => {
    const unrelated: ReceiptLog = { address: FACTORY, topics: [`0x${'12'.repeat(32)}`], data: '0x' }
    expect(
      matchArtPaid(
        receipt(unrelated, artPaid(FACTORY, JOB, PAYER, 10n), artPaid(FACTORY, JOB, PAYER, 100n)),
        expected,
      ),
    ).toEqual({ ok: true, payer: PAYER, amount: 100n })
  })
})
