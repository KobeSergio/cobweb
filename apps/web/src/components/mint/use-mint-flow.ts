'use client'

import { useCallback, useState } from 'react'
import type { Hex } from 'viem'
import type { MintParams } from '@/lib/mint/mint-call'
import { MintFailure, mintFailureOf, type MintStep } from '@/lib/mint/mint-failure'
import { runMint, type MintChain, type MintResult } from '@/lib/mint/mint-run'

export type FlowStep = MintStep

export type FlowState =
  | { step: 'idle' }
  | { step: FlowStep; params: MintParams; hash?: Hex }
  | { step: 'success'; params: MintParams; hash: Hex; tokenIds: number[] }
  | { step: 'error'; params: MintParams; failedAt: FlowStep; failure: MintFailure; hash?: Hex }

/** Thrown from the wallet step of a flow closed during the check, so its run ends before the wallet opens. */
export class MintCancelled extends Error {
  constructor() {
    super('The mint was closed before the wallet opened.')
    this.name = 'MintCancelled'
  }
}

/**
 * The flow's runs, pure: each is alive until the next one starts or the flow closes, so a closed or replaced run
 * neither opens the wallet nor shows its end.
 */
export function flowRuns() {
  let current = 0
  return {
    /** Starts a run; the answer says whether it is still the flow's. */
    begin(): () => boolean {
      const id = ++current
      return () => current === id
    },
    /** The flow closed: the running one is no longer alive. */
    close(): void {
      current += 1
    },
  }
}

/**
 * The mint, step by step, on `runMint` (docs/specs/2026-10-16-mint-page-live-data.md, section 7.5): the check,
 * the wallet with the simulated request, then the chain. A flow closed during the check ends before the wallet
 * opens, so nothing is sent; a transaction already sent keeps going on chain, and a closed flow stops showing it.
 */
export function useMintFlow(options: {
  chain: MintChain
  live: { isLive(groupId: number): boolean; nextAnswer(): Promise<void> }
  onMinted: (params: MintParams, result: MintResult) => void
}) {
  const [state, setState] = useState<FlowState>({ step: 'idle' })
  const [runs] = useState(flowRuns)
  const { chain, live, onMinted } = options

  const start = useCallback(
    async (params: MintParams) => {
      const alive = runs.begin()
      let at: FlowStep = 'checking'
      let hash: Hex | undefined
      setState({ step: 'checking', params })
      try {
        const result = await runMint(chain, params, live, {
          wallet: () => {
            // Closed during the check: the run ends here, before the wallet opens, and nothing is sent.
            if (!alive()) throw new MintCancelled()
            at = 'wallet'
            setState({ step: 'wallet', params })
          },
          sent: (sent) => {
            at = 'confirming'
            hash = sent
            if (alive()) setState({ step: 'confirming', params, hash: sent })
          },
        })
        onMinted(params, result)
        if (alive()) setState({ step: 'success', params, hash: result.hash, tokenIds: result.tokenIds })
      } catch (error) {
        // A closed flow shows nothing, its cancel included.
        if (error instanceof MintCancelled || !alive()) return
        const failure = error instanceof MintFailure ? error : mintFailureOf(error, at, hash)
        setState({ step: 'error', params, failedAt: at, failure, hash: failure.detail.hash ?? hash })
      }
    },
    [chain, live, onMinted, runs],
  )

  /**
   * Closes the flow. A run still in its check ends before the wallet opens; a transaction already sent keeps going
   * on chain, and only the view stops.
   */
  const reset = useCallback(() => {
    runs.close()
    setState({ step: 'idle' })
  }, [runs])

  return { state, start, reset }
}
