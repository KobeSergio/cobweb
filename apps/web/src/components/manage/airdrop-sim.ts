/**
 * Sample mode for Airdrop (docs/specs/2026-10-15-airdrop-settings.md, section 8). Nothing here talks to a wallet,
 * an RPC or the database: `sampleAirdropServer` has the shape of `airdropServer` (airdrop-server.ts), and its
 * confirm applies exactly the call the simulated wallet sent, as `airdrop_record` would record it, so the screen
 * runs the same code in both modes.
 */
import { getAddress, type Address, type Hex } from 'viem'
import type { ActionResult } from '@/lib/art/result'
import {
  DEMO_AIRDROPS,
  DEMO_COLLECTION,
  DEMO_DEPLOYMENT,
  DEMO_NOW,
  sampleAddress,
  sampleSupply,
  sampleTxHash,
  scaleSampleToSupply,
} from '@/lib/demo'
import type { AirdropJob, AirdropRow, AirdropView } from '@/lib/manage/airdrop-types'
import { airdropViewOf, BURN_ADDRESS } from '@/lib/manage/airdrop-view'
import { airdropCalls, type ManageCall } from '@/lib/manage/phase-calls'
import type { AirdropServer } from './airdrop-server'

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** The blocks the sample's two records landed in, in the order `DEMO_AIRDROPS` lists them. */
const SAMPLE_BLOCKS = [21_499_990, 21_499_995]

/** The sample's records as `airdropViewCore` reads them: newest first, ids from the first one on. */
function sampleHistory(): AirdropRow[] {
  return DEMO_AIRDROPS.map((record, index): AirdropRow => {
    const first = record.firstTokenId ?? 1
    return {
      txHash: record.txHash,
      kind: record.burn ? 'burn' : 'airdrop',
      recipients: record.recipients,
      tokens: record.tokens,
      feePaidWei: record.feePaidWei,
      firstTokenId: first,
      lastTokenId: first + record.tokens - 1,
      block: SAMPLE_BLOCKS[index] ?? 0,
      confirmedAt: record.at,
    }
  }).reverse()
}

/**
 * The Base sample: the contract's airdrop fee of 0.00005 ETH a token, the sample's supply and minted count scaled
 * to the collection's supply, the two sample records (10 tokens to 4 wallets, then a burn of 2), and the session
 * wallet as the owner unless `owner` names another (`?owner=other`). With `chainReachable` false, the record alone,
 * as the core builds it (`?chain=unreachable`).
 */
export function sampleAirdropView(
  collection: { max_supply: number | null },
  wallet: Address,
  options: { chainReachable?: boolean; owner?: Address } = {},
): AirdropView {
  const maxSupply = sampleSupply(collection.max_supply, DEMO_COLLECTION.maxSupply)
  const base = {
    chainId: DEMO_DEPLOYMENT.chainId,
    contract: DEMO_DEPLOYMENT.contractAddress,
    maxSupply,
    readAt: DEMO_NOW,
  }
  if (options.chainReachable === false) return airdropViewOf(base, sampleHistory(), null)
  return airdropViewOf(base, sampleHistory(), {
    block: 21_500_000n,
    blockTimestamp: DEMO_NOW,
    maxSupply,
    totalMinted: scaleSampleToSupply(maxSupply).totalMinted,
    feePerTokenWei: DEMO_DEPLOYMENT.fees.airdropFeePerTokenWei,
    owner: options.owner ?? wallet,
  })
}

/**
 * The view after an `airdropNFTs` lands, as `airdrop_record` records it: a row with ids after the minted total, the
 * fee times its tokens, the next block and its kind from the recipients, newest first, and its tokens minted. A hash
 * already listed changes nothing.
 */
export function sampleApplyAirdrop(call: ManageCall, view: AirdropView, hash: Hex): AirdropView {
  const txHash = hash.toLowerCase() as Hex
  if (call.functionName !== 'airdropNFTs' || view.history.some((row) => row.txHash === txHash)) return view
  const [recipients, amounts] = call.args
  const tokens = Number(amounts.reduce((sum, amount) => sum + amount, 0n))
  const minted = view.totalMinted ?? 0
  const [only] = recipients
  const row: AirdropRow = {
    txHash,
    kind: recipients.length === 1 && only?.toLowerCase() === BURN_ADDRESS.toLowerCase() ? 'burn' : 'airdrop',
    recipients: recipients.length,
    tokens,
    feePaidWei: (BigInt(view.feePerTokenWei ?? '0') * BigInt(tokens)).toString(),
    firstTokenId: minted + 1,
    lastTokenId: minted + tokens,
    block: Math.max(0, ...view.history.map((entry) => entry.block)) + 1,
    confirmedAt: view.readAt,
  }
  const totalMinted = minted + tokens
  return {
    ...view,
    history: [row, ...view.history],
    totalMinted,
    left: Math.max(0, view.maxSupply - totalMinted),
  }
}

/**
 * The sample server: every answer takes 900 ms. A confirm applies the call the simulated wallet sent with that
 * hash, or, for a hash it never sent (`?batch=pending`), the first unsent batch of `sampleAirdropJob`.
 */
export function sampleAirdropServer(
  current: () => AirdropView,
  sent: Map<Hex, ManageCall> = new Map(),
): AirdropServer {
  const answer = async <T>(data: () => T): Promise<ActionResult<T>> => {
    await wait(900)
    return { ok: true, data: data() }
  }
  return {
    read: () => answer(current),
    confirm: (hash) =>
      answer(() => {
        const view = current()
        const job = sampleAirdropJob()
        const call =
          sent.get(hash) ?? airdropCalls.batch(job.batches[job.sent] ?? [], view.feePerTokenWei ?? '0')
        return sampleApplyAirdrop(call, view, hash)
      }),
  }
}

/**
 * The job `?batch=pending` shows: two batches frozen from a sample list (2 wallets with 3 tokens, then 1 wallet with
 * 1 token), the first sent with `sampleTxHash(40)` and not confirmed yet.
 */
export function sampleAirdropJob(): AirdropJob {
  const wallet = (seed: number) => getAddress(sampleAddress(seed))
  const batches = [
    [
      { address: wallet(700), amount: 2 },
      { address: wallet(701), amount: 1 },
    ],
    [{ address: wallet(702), amount: 1 }],
  ]
  return { kind: 'airdrop', batches, sent: 0, pending: sampleTxHash(40) }
}
