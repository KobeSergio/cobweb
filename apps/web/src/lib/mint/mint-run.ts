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
  /**
   * The mined transaction's receipt, waited for up to three minutes. When the wallet replaced the transaction (a
   * speed-up, a cancel, or another transaction with its nonce), it is the replacement's, and `replaced` is told
   * its hash first.
   */
  receipt(hash: Hex, chainId: number, replaced?: (hash: Hex) => void): Promise<TransactionReceipt>
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
    // The page's state reads the group live while the check's RPC, a block behind, still finds it inactive: the
    // check runs once more after the next answer. A group the state does not read live is not checked again.
    if (revertNameOf(error) !== 'MintGroupInactive' || !live.isLive(params.groupId))
      throw mintFailureOf(error, 'checking')
    await live.nextAnswer()
    try {
      send = await chain.simulate(call)
    } catch (again) {
      throw mintFailureOf(again, 'checking')
    }
  }
  // Outside any try: a wallet step that throws (a flow closed during the check) ends the run before the wallet
  // opens, and nothing is sent.
  steps.wallet()
  let hash: Hex
  try {
    hash = await send()
  } catch (error) {
    throw mintFailureOf(error, 'wallet')
  }
  steps.sent(hash)
  // The result is the mined transaction's, and a replacement is its own outcome, not a failure: a speed-up mints
  // as the original would; a cancel, or another transaction with the nonce, lands with no ids for the receiver,
  // which the page shows as a success without art, and the failure dialog does not open.
  let mined = hash
  let receipt: TransactionReceipt
  try {
    receipt = await chain.receipt(hash, params.chainId, (replacement) => {
      mined = replacement
    })
  } catch (error) {
    throw mintFailureOf(error, 'confirming', mined)
  }
  if (receipt.status === 'reverted') throw new MintFailure('reverted', { hash: mined })
  return {
    hash: mined,
    tokenIds: mintedTokenIds(receipt, params.contract, params.account),
    block: Number(receipt.blockNumber),
  }
}
