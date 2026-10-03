'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Hex } from '@/lib/demo'
import { simulateRequest, simulatedTxHash, waitForReceipt, type TxRequest } from './simulate'

/**
 * The honest sequence every transaction goes through:
 * checking (simulate) -> wallet (confirm in wallet) -> confirming (receipt) -> done,
 * with a failure possible at each of the first three.
 */
export type TxPhase = 'idle' | 'checking' | 'wallet' | 'confirming' | 'done' | 'failed'
export type TxStep = 'checking' | 'wallet' | 'confirming'

export type TxState =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'wallet' }
  | { phase: 'confirming'; hash: Hex }
  | { phase: 'done'; hash: Hex }
  | { phase: 'failed'; step: TxStep; message: string; hash?: Hex }

export const TX_STEPS: { step: TxStep; label: string; detail: string }[] = [
  { step: 'checking', label: 'Checking', detail: 'Simulating the call against the chain.' },
  { step: 'wallet', label: 'Confirm in wallet', detail: 'Approve the transaction in your wallet.' },
  { step: 'confirming', label: 'Confirming', detail: 'Waiting for the transaction to be included.' },
]

export type UseTransaction = {
  state: TxState
  /** Starts the sequence at "checking". */
  start: (request: TxRequest) => void
  /**
   * The simulated wallet's answer while `phase` is `wallet`.
   * SEAM: `walletClient.writeContract(simulated.request)`; a user rejection becomes `reject`.
   */
  respond: (answer: 'approve' | 'reject' | 'approve-revert') => void
  reset: () => void
  busy: boolean
}

/**
 * Runs one transaction through the sequence. `onConfirmed` fires once with the hash when the
 * receipt succeeds; `onFailed` with the message when any step fails.
 */
export function useTransaction(
  handlers: {
    onConfirmed?: (hash: Hex) => void
    onFailed?: (message: string, step: TxStep) => void
  } = {},
): UseTransaction {
  const [state, setState] = useState<TxState>({ phase: 'idle' })
  const run = useRef(0)
  const handlersRef = useRef(handlers)
  useEffect(() => {
    handlersRef.current = handlers
  })
  useEffect(
    () => () => {
      // Unmounted: drop any step still in flight.
      run.current++
    },
    [],
  )

  const fail = useCallback((step: TxStep, message: string, hash?: Hex) => {
    setState({ phase: 'failed', step, message, hash })
    handlersRef.current.onFailed?.(message, step)
  }, [])

  const start = useCallback(
    (request: TxRequest) => {
      const id = ++run.current
      setState({ phase: 'checking' })
      void simulateRequest(request).then((result) => {
        if (id !== run.current) return
        if (!result.ok) fail('checking', `The contract would reject this: ${result.reason}`)
        else setState({ phase: 'wallet' })
      })
    },
    [fail],
  )

  const respond = useCallback(
    (answer: 'approve' | 'reject' | 'approve-revert') => {
      const id = run.current
      if (answer === 'reject') {
        fail('wallet', 'The signature request was cancelled in the wallet. Nothing was sent. Try again.')
        return
      }
      const hash = simulatedTxHash()
      setState({ phase: 'confirming', hash })
      void waitForReceipt(answer === 'approve-revert').then((status) => {
        if (id !== run.current) return
        if (status === 'reverted') {
          fail(
            'confirming',
            'The transaction was included but reverted, so nothing changed. You paid gas only. Try again.',
            hash,
          )
          return
        }
        setState({ phase: 'done', hash })
        handlersRef.current.onConfirmed?.(hash)
      })
    },
    [fail],
  )

  const reset = useCallback(() => {
    run.current++
    setState({ phase: 'idle' })
  }, [])

  const busy = state.phase === 'checking' || state.phase === 'wallet' || state.phase === 'confirming'
  return { state, start, respond, reset, busy }
}
