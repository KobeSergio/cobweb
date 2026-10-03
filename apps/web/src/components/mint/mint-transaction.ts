import { sampleTxHash } from '@/lib/demo/helpers'
import type { Address, Hex } from '@/lib/demo'
import type { MintFailureKind } from './types'

/*
 * THE SEAM. Everything the mint page does on-chain goes through these three functions. Today they
 * simulate the chain in client state, with realistic pauses, so every step of the flow can be
 * designed and reviewed without a wallet or a deployed contract.
 *
 * Phase 6 replaces the bodies with wagmi actions, keeping the signatures:
 *
 *   simulateMint:  const { request } = await simulateContract(config, {
 *                    address, abi: cobwebCollectionAbi, chainId,
 *                    functionName: vault ? 'delegateMint' : 'batchMint',
 *                    args: vault ? [amount, groupId, vault] : [amount, groupId],
 *                    value, account,
 *                  })
 *                  // Revert reasons map to MintFailure kinds (MintGroupInactive -> phase-closed, ...).
 *   sendMint:      return writeContract(config, simulated.request)   // the simulated request, unchanged
 *   waitForMint:   const receipt = await waitForTransactionReceipt(config, { hash })
 *                  // token ids from the Transfer logs; receipt.status 'reverted' -> reverted
 *
 * The wallet must open only after simulateMint resolves (CLAUDE.md rule 2).
 */

export type MintParams = {
  contract: Address
  chainId: number
  groupId: number
  amount: number
  /** Mint against this vault's allowance (delegate.xyz). Tokens still go to the caller. */
  vault: Address | null
  /** Price plus platform fee for `amount` tokens, in wei. The most the mint can charge. */
  valueWei: bigint
  account: Address
}

/** What a passing simulation hands to the wallet. Phase 6: viem's simulated `request`. */
export type SimulatedMint = { request: MintParams; firstTokenId: number }

export class MintFailure extends Error {
  constructor(
    readonly kind: MintFailureKind,
    readonly hash?: Hex,
  ) {
    super(kind)
    this.name = 'MintFailure'
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Sample-mode knobs: which failure to produce, and the id the next token gets. */
export type SampleChain = { failure: MintFailureKind | null; nextTokenId: number }

let txSeed = 0

export async function simulateMint(params: MintParams, sample: SampleChain): Promise<SimulatedMint> {
  await wait(900)
  if (sample.failure === 'phase-closed' || sample.failure === 'quota-exceeded') {
    throw new MintFailure(sample.failure)
  }
  if (sample.failure === 'insufficient-balance') throw new MintFailure('insufficient-balance')
  return { request: params, firstTokenId: sample.nextTokenId }
}

/** Opens the wallet with the simulated request. Resolves with the transaction hash once signed. */
export async function sendMint(simulated: SimulatedMint, sample: SampleChain): Promise<Hex> {
  void simulated
  await wait(1600)
  if (sample.failure === 'rejected') throw new MintFailure('rejected')
  txSeed += 1
  return sampleTxHash(9_000 + txSeed)
}

/** Waits for the transaction to land. Resolves with the minted token ids. */
export async function waitForMint(
  simulated: SimulatedMint,
  hash: Hex,
  sample: SampleChain,
): Promise<number[]> {
  await wait(2200)
  if (sample.failure === 'reverted') throw new MintFailure('reverted', hash)
  return Array.from({ length: simulated.request.amount }, (_, index) => simulated.firstTokenId + index)
}
