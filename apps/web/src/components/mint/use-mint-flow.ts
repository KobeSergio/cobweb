'use client'

import { useCallback, useRef, useState } from 'react'
import type { Hex } from '@/lib/demo'
import {
  MintFailure,
  sendMint,
  simulateMint,
  waitForMint,
  type MintParams,
  type SampleChain,
} from './mint-transaction'
import type { MintFailureKind } from './types'

export type FlowStep = 'checking' | 'wallet' | 'confirming'

export type FlowState =
  | { step: 'idle' }
  | { step: FlowStep; params: MintParams; hash?: Hex }
  | { step: 'success'; params: MintParams; hash: Hex; tokenIds: number[] }
  | { step: 'error'; params: MintParams; failedAt: FlowStep; kind: MintFailureKind; hash?: Hex }

/**
 * The mint, step by step: simulate, then open the wallet with the simulated request, then wait
 * for the chain. A sample failure applies to the first attempt only, so "Try again" can succeed.
 */
export function useMintFlow(options: {
  failure: MintFailureKind | null
  onMinted: (params: MintParams, tokenIds: number[]) => void
}) {
  const [state, setState] = useState<FlowState>({ step: 'idle' })
  const attempts = useRef(0)
  const run = useRef(0)
  const { failure, onMinted } = options

  const start = useCallback(
    async (params: MintParams, nextTokenId: number) => {
      const id = ++run.current
      const sample: SampleChain = {
        failure: attempts.current === 0 ? failure : null,
        nextTokenId,
      }
      attempts.current += 1
      let at: FlowStep = 'checking'
      let hash: Hex | undefined
      const alive = () => run.current === id
      try {
        setState({ step: 'checking', params })
        const simulated = await simulateMint(params, sample)
        if (!alive()) return
        at = 'wallet'
        setState({ step: 'wallet', params })
        hash = await sendMint(simulated, sample)
        if (!alive()) return
        at = 'confirming'
        setState({ step: 'confirming', params, hash })
        const tokenIds = await waitForMint(simulated, hash, sample)
        if (!alive()) return
        onMinted(params, tokenIds)
        setState({ step: 'success', params, hash, tokenIds })
      } catch (error) {
        if (!alive()) return
        const kind = error instanceof MintFailure ? error.kind : 'reverted'
        setState({ step: 'error', params, failedAt: at, kind, hash })
      }
    },
    [failure, onMinted],
  )

  /** Closes the flow. A transaction already sent keeps going on-chain; only the view stops. */
  const reset = useCallback(() => {
    run.current += 1
    setState({ step: 'idle' })
  }, [])

  return { state, start, reset }
}
