import { getAddress, type Address, type Hex } from 'viem'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KeyStore } from '@/components/deploy/deploy-machine'
import { DEMO_COLLECTION, DEMO_MINTER, DEMO_TOTAL_MINTED, sampleTxHash } from '@/lib/demo'
import type { AirdropView } from '@/lib/manage/airdrop-types'
import { tokensOf } from '@/lib/manage/airdrop-view'
import { airdropCalls, type ManageCall } from '@/lib/manage/phase-calls'
import { airdropJob, rememberAirdropJob } from './manage-machine'
import { sampleAirdropJob, sampleAirdropServer, sampleAirdropView, sampleApplyAirdrop } from './airdrop-sim'

const WALLET: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const A: Address = '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65'
const B: Address = '0x90F79bf6EB2c4f870365E785982E1f101E93b906'
const HASH: Hex = `0x${'cd'.repeat(32)}`
const view: AirdropView = sampleAirdropView({ max_supply: DEMO_COLLECTION.maxSupply }, WALLET)

describe('sampleAirdropView', () => {
  it("reads Base's sample: the fee of 0.00005 ETH, the sample's supply and minted, the two records newest first", () => {
    expect(view).toMatchObject({
      chainId: 8453,
      owner: WALLET,
      feePerTokenWei: '50000000000000',
      maxSupply: DEMO_COLLECTION.maxSupply,
      totalMinted: DEMO_TOTAL_MINTED,
      left: DEMO_COLLECTION.maxSupply - DEMO_TOTAL_MINTED,
      chainReachable: true,
    })
    expect(
      view.history.map((row) => [row.kind, row.recipients, row.tokens, row.firstTokenId, row.block]),
    ).toEqual([
      ['burn', 1, 2, 11, 21_499_995],
      ['airdrop', 4, 10, 1, 21_499_990],
    ])
  })

  it('names another owner for ?owner=other, and keeps the records alone for ?chain=unreachable', () => {
    expect(sampleAirdropView({ max_supply: 100 }, WALLET, { owner: DEMO_MINTER }).owner).toBe(DEMO_MINTER)
    const copy = sampleAirdropView({ max_supply: 100 }, WALLET, { chainReachable: false })
    expect(copy).toMatchObject({
      owner: null,
      feePerTokenWei: null,
      totalMinted: null,
      left: null,
      maxSupply: 100,
      chainReachable: false,
    })
    expect(copy.history).toHaveLength(2)
  })
})

describe('sampleApplyAirdrop', () => {
  it('records a batch after the minted ids with its fee, the next block and its kind, once', () => {
    const call = airdropCalls.batch(
      [
        { address: A, amount: 2 },
        { address: B, amount: 1 },
      ],
      view.feePerTokenWei ?? '0',
    )
    const after = sampleApplyAirdrop(call, view, HASH)
    expect(after.history[0]).toEqual({
      txHash: HASH,
      kind: 'airdrop',
      recipients: 2,
      tokens: 3,
      feePaidWei: '150000000000000',
      firstTokenId: DEMO_TOTAL_MINTED + 1,
      lastTokenId: DEMO_TOTAL_MINTED + 3,
      block: 21_499_996,
      confirmedAt: view.readAt,
    })
    expect(after).toMatchObject({ totalMinted: DEMO_TOTAL_MINTED + 3, left: (view.left ?? 0) - 3 })
    expect(sampleApplyAirdrop(call, after, HASH)).toBe(after)
  })

  it('records a burn to the dead address as a burn', () => {
    expect(sampleApplyAirdrop(airdropCalls.burn(2, '0'), view, HASH).history[0]).toMatchObject({
      kind: 'burn',
      recipients: 1,
      tokens: 2,
    })
  })
})

describe('sampleAirdropJob', () => {
  it('is two batches, 2 wallets with 3 tokens then 1 wallet with 1, the first pending, and a job the store keeps', () => {
    const job = sampleAirdropJob()
    expect(job.batches.map((batch) => [batch.length, tokensOf(batch)])).toEqual([
      [2, 3],
      [1, 1],
    ])
    expect(job).toMatchObject({ kind: 'airdrop', sent: 0, pending: sampleTxHash(40) })
    const map = new Map<string, string>()
    const store: KeyStore = {
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => {
        map.set(key, value)
      },
      removeItem: (key) => {
        map.delete(key)
      },
    }
    rememberAirdropJob(store, 'col-1', job)
    expect(airdropJob(store, 'col-1')).toEqual(job)
    expect(job.batches.flat().every((entry) => entry.address === getAddress(entry.address))).toBe(true)
  })
})

describe('sampleAirdropServer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('confirms the call the wallet sent after 900 ms, and the first unsent batch of the sample job for a hash it never sent', async () => {
    const sent = new Map<Hex, ManageCall>([[HASH, airdropCalls.burn(1, '0')]])
    const server = sampleAirdropServer(() => view, sent)
    const newest = async (answer: ReturnType<typeof server.confirm>) => {
      await vi.advanceTimersByTimeAsync(900)
      const result = await answer
      return result.ok ? result.data.history[0] : result.error
    }
    expect(await newest(server.confirm(HASH))).toMatchObject({ txHash: HASH, kind: 'burn', tokens: 1 })
    expect(await newest(server.confirm(sampleTxHash(40)))).toMatchObject({
      txHash: sampleTxHash(40),
      kind: 'airdrop',
      recipients: 2,
      tokens: 3,
    })
  })
})
