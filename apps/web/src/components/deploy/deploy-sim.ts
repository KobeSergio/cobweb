/**
 * SIMULATION SEAM for Deploy. Nothing here talks to a chain; each function stands in for one real
 * action and reports the same states the real one will. Replace them when Phase 5 lands:
 *
 *  - `useFactoryRead`     → `readContract(factory.collectionFees())` and a gas estimate for the
 *                           chosen chain (the props carry today's sample values).
 *  - `predictAddress`     → `factory.predictCollectionAddress(deployer, creationCode, args, salt)`.
 *                           The factory has the same address on every chain (decision D19), so the
 *                           result does not depend on the chain, only on the deployer and the args.
 *  - `deployCollection`   → wagmi: `switchChain` if needed, `simulateContract(deployCollection(...))`,
 *                           `writeContract(request)`, `waitForTransactionReceipt`, then a server
 *                           action that records the address from the `CollectionDeployed` event.
 *
 * Failures are driven by `?outcome=` in sample mode, on the first attempt only.
 */
import { useEffect, useState } from 'react'
import { useAccount } from 'wagmi'
import { sampleAddress, sampleTxHash } from '@/lib/demo/helpers'
import type { Address, Hex } from '@/lib/demo/types'
import type { TxFailure, TxPhase, TxStep } from './tx-progress'

export type DeployOutcome = 'rejected' | 'reverted' | 'balance' | 'switch-rejected' | 'fees-error'

export const DEPLOY_OUTCOMES: DeployOutcome[] = [
  'rejected',
  'reverted',
  'balance',
  'switch-rejected',
  'fees-error',
]

/** The chain a wallet reports when none is connected, so a switch shows when another is picked. */
const SAMPLE_WALLET_CHAIN = 1

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason)
    const timer = setTimeout(resolve, ms)
    const abort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    signal.addEventListener('abort', abort, { once: true })
  })
}

/** The connected wallet and its chain, or the sample creator when no wallet is connected. */
export function useCreatorWallet(sample: Address): { address: Address; chainId: number } {
  const account = useAccount()
  return { address: account.address ?? sample, chainId: account.chainId ?? SAMPLE_WALLET_CHAIN }
}

export type FactoryRead = { status: 'loading' | 'ready' | 'error'; retry: () => void }

/** Reading the factory's fees and a gas estimate for a chain: loading, then ready (or an error). */
export function useFactoryRead(chainId: number | null, outcome?: DeployOutcome): FactoryRead {
  const [state, setState] = useState<{ key: string; status: FactoryRead['status'] } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const key = `${chainId}:${attempt}`

  useEffect(() => {
    if (chainId === null) return
    const timer = setTimeout(
      () => setState({ key, status: outcome === 'fees-error' && attempt === 0 ? 'error' : 'ready' }),
      550,
    )
    return () => clearTimeout(timer)
  }, [chainId, attempt, key, outcome])

  return {
    status: state?.key === key ? state.status : 'loading',
    retry: () => setAttempt((count) => count + 1),
  }
}

export type DeployArgs = {
  name: string
  symbol: string
  maxSupply: number
  payout: Address
  initialBaseUri: string
  publicMaxMintPerWallet: number
  royaltyBps: number
  owner: Address
  royaltyReceiver: Address
}

/** The address `deployCollection` would produce for these args. Sample: a stable hash of them. */
export function predictAddress(collectionId: string, args: DeployArgs): Address {
  const text = `${collectionId}|${JSON.stringify(args)}`
  let hash = 2166136261
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return sampleAddress(hash >>> 0)
}

const FAILURES: Partial<Record<DeployOutcome, { at: TxStep; failure: TxFailure }>> = {
  'switch-rejected': {
    at: 'switching',
    failure: {
      kind: 'switch',
      title: 'Network switch cancelled',
      message:
        'Your wallet stayed on its current network, so nothing was deployed. Try again and approve the switch.',
    },
  },
  balance: {
    at: 'simulating',
    failure: {
      kind: 'balance',
      title: 'Not enough funds for gas',
      message: 'This wallet cannot cover the deploy cost on this network. Add funds, then try again.',
    },
  },
  reverted: {
    at: 'simulating',
    failure: {
      kind: 'reverted',
      title: 'The deploy would fail',
      message:
        'The factory reverted with CollectionExists: a collection with these exact settings is already deployed from this wallet. Change a setting, or open the existing contract from Manage drop.',
    },
  },
  rejected: {
    at: 'wallet',
    failure: {
      kind: 'rejected',
      title: 'Deploy cancelled in your wallet',
      message: 'Nothing was sent and no gas was spent. Try again when you are ready.',
    },
  },
}

/** Deploys through the factory: switch chain, simulate, sign, wait for the receipt. */
export async function deployCollection(
  onPhase: (phase: TxPhase) => void,
  options: { needsSwitch: boolean; outcome?: DeployOutcome; signal: AbortSignal },
): Promise<Hex | null> {
  const { signal } = options
  const failure = options.outcome ? FAILURES[options.outcome] : undefined
  const steps: TxStep[] = [...(options.needsSwitch ? (['switching'] as const) : []), 'simulating', 'wallet']
  const durations: Record<string, number> = { switching: 1200, simulating: 1000, wallet: 1700 }

  for (const step of steps) {
    onPhase({ step })
    await sleep(durations[step]!, signal)
    if (failure?.at === step) {
      onPhase({ step: 'failed', ...failure })
      return null
    }
  }
  const txHash = sampleTxHash(Math.floor(Date.now() / 1000) % 100_000)
  onPhase({ step: 'confirming', txHash })
  await sleep(2200, signal)
  onPhase({ step: 'success', txHash })
  return txHash
}
