'use client'

import { useCallback, useRef, useState } from 'react'
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

/**
 * The mint, step by step, on `runMint` (docs/specs/2026-10-16-mint-page-live-data.md, section 7.5): the check,
 * the wallet with the simulated request, then the chain. A closed flow stops following its mint; a transaction
 * already sent keeps going on chain.
 */
export function useMintFlow(options: {
  chain: MintChain
  live: { isLive(groupId: number): boolean; nextAnswer(): Promise<void> }
  onMinted: (params: MintParams, result: MintResult) => void
}) {
  const [state, setState] = useState<FlowState>({ step: 'idle' })
  const run = useRef(0)
  const { chain, live, onMinted } = options

  const start = useCallback(
    async (params: MintParams) => {
      const id = ++run.current
      const alive = () => run.current === id
      let at: FlowStep = 'checking'
      let hash: Hex | undefined
      setState({ step: 'checking', params })
      try {
        const result = await runMint(chain, params, live, {
          wallet: () => {
            at = 'wallet'
            if (alive()) setState({ step: 'wallet', params })
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
        const failure = error instanceof MintFailure ? error : mintFailureOf(error, at, hash)
        if (alive())
          setState({ step: 'error', params, failedAt: at, failure, hash: failure.detail.hash ?? hash })
      }
    },
    [chain, live, onMinted],
  )

  /** Closes the flow. A transaction already sent keeps going on chain; only the view stops. */
  const reset = useCallback(() => {
    run.current += 1
    setState({ step: 'idle' })
  }, [])

  return { state, start, reset }
}
