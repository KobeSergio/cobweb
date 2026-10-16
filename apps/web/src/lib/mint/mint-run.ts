import type { Hex, TransactionReceipt } from 'viem'
import { mintCallOf, mintedTokenIds, type MintCall, type MintParams } from './mint-call'
import { MintFailure, mintFailureOf, revertNameOf } from './mint-failure'

/**
 * The mint, step by step (docs/specs/2026-10-16-mint-page-live-data.md, section 7.5): simulate the call from the
 * connected account, open the wallet only after a passing simulation with exactly the simulated request
 * (CLAUDE.md rule 2), then read the receipt and the ids it minted. A simulation that finds the group inactive
 * while the page's state reads it live waits for the next accepted answer and checks once more.
 */

/** Where the page's mints go: the live chain through wagmi, or the sample's simulated one. */
export type MintChain = {
  /** Simulates the call; resolves with the function that sends the simulated request, unchanged. */
  simulate(call: MintCall): Promise<() => Promise<Hex>>
  /** The transaction's receipt, waited for up to three minutes. */
  receipt(hash: Hex, chainId: number): Promise<TransactionReceipt>
}

export type MintResult = { hash: Hex; tokenIds: number[]; block: number }

export async function runMint(
  chain: MintChain,
  params: MintParams,
  live: { isLive(groupId: number): boolean; nextAnswer(): Promise<void> },
  steps: { wallet(): void; sent(hash: Hex): void },
): Promise<MintResult> {
  const call = mintCallOf(params)
  let send: () => Promise<Hex>
  try {
    send = await chain.simulate(call)
  } catch (error) {
    // The chain opened the group a moment before the page's state shows it, or the state read it live first:
    // the check runs once more after the next answer.
    if (revertNameOf(error) !== 'MintGroupInactive' || !live.isLive(params.groupId))
      throw mintFailureOf(error, 'checking')
    await live.nextAnswer()
    try {
      send = await chain.simulate(call)
    } catch (again) {
      throw mintFailureOf(again, 'checking')
    }
  }
  steps.wallet()
  let hash: Hex
  try {
    hash = await send()
  } catch (error) {
    throw mintFailureOf(error, 'wallet')
  }
  steps.sent(hash)
  let receipt: TransactionReceipt
  try {
    receipt = await chain.receipt(hash, params.chainId)
  } catch (error) {
    throw mintFailureOf(error, 'confirming', hash)
  }
  if (receipt.status === 'reverted') throw new MintFailure('reverted', { hash })
  return {
    hash,
    tokenIds: mintedTokenIds(receipt, params.contract, params.account),
    block: Number(receipt.blockNumber),
  }
}
