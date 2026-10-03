'use client'

import { WalletIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@cobweb/ui/components/button'
import { Spinner } from '@cobweb/ui/components/spinner'
import { explorerTxUrl, formatNative, shortAddress } from '@/lib/demo/helpers'
import type { ArtFeeQuote, Hex, SupportedChain } from '@/lib/demo/types'
import { SummaryRow } from '@/components/deploy/copy-value'
import { isTxRunning, TX_IDLE, TxProgress, type TxPhase } from '@/components/deploy/tx-progress'
import { payArtFee, type UploadOutcome } from './upload-sim'

/** Pay the generation fee: the quote, then `payForArt(jobId)` simulated, signed and verified. */
export function PayStep({
  quote,
  chain,
  readOnly,
  outcome,
  deferred = false,
  onPaid,
}: {
  quote: ArtFeeQuote
  chain: SupportedChain
  readOnly: boolean
  outcome?: UploadOutcome
  /** Deferred art: this run pays for the placeholder alone, one file at the per-token rate. */
  deferred?: boolean
  onPaid: (txHash: Hex) => void
}) {
  const [phase, setPhase] = useState<TxPhase>(TX_IDLE)
  const [attempt, setAttempt] = useState(0)
  const controller = useRef<AbortController | null>(null)
  const running = isTxRunning(phase)
  const symbol = chain.nativeSymbol
  const total = formatNative(quote.totalWei, symbol, 8)

  useEffect(() => () => controller.current?.abort(), [])

  async function pay() {
    controller.current = new AbortController()
    try {
      const txHash = await payArtFee(setPhase, {
        outcome: attempt === 0 ? outcome : undefined,
        signal: controller.current.signal,
      })
      setAttempt((count) => count + 1)
      if (txHash) onPaid(txHash)
    } catch {
      // Unmounted mid-payment.
    }
  }

  const amount = total.slice(0, total.lastIndexOf(' '))

  return (
    <div className="divide-y">
      <div className="grid gap-8 p-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="space-y-2">
          <p className="text-muted-foreground text-[0.8125rem]">
            {deferred ? 'Placeholder fee' : 'Generation fee'}
          </p>
          <p className="flex items-baseline gap-2">
            <span className="numeric text-[2.5rem] leading-none font-medium tracking-tight">{amount}</span>
            <span className="numeric text-muted-foreground text-base">{symbol}</span>
          </p>
          <p className="text-muted-foreground text-[0.8125rem]">
            {deferred ? (
              <>
                One placeholder file at{' '}
                <span className="numeric text-foreground/85">
                  {formatNative(quote.perTokenWei, symbol, 8)}
                </span>
                . The real set is paid for when you lock it.
              </>
            ) : (
              <>
                <span className="numeric text-foreground/85">{quote.tokenCount.toLocaleString('en-US')}</span>{' '}
                tokens ×{' '}
                <span className="numeric text-foreground/85">
                  {formatNative(quote.perTokenWei, symbol, 8)}
                </span>{' '}
                per token
              </>
            )}
          </p>
        </div>
        <dl className="divide-y">
          <SummaryRow label="Network">{chain.name}</SummaryRow>
          <SummaryRow label="Paid to">Cobweb factory</SummaryRow>
          <SummaryRow label="From your wallet">
            <span className="numeric text-[0.8125rem]" title={quote.payer}>
              {shortAddress(quote.payer, 6)}
            </span>
          </SummaryRow>
          <SummaryRow label="Total">
            <span className="numeric font-medium">{total}</span>
          </SummaryRow>
        </dl>
      </div>

      {phase.step !== 'idle' && (
        <div className="p-6">
          <TxProgress
            phase={phase}
            txUrl={(hash) => explorerTxUrl(chain, hash)}
            steps={[
              {
                step: 'simulating',
                label: 'Checking the payment',
                detail:
                  'A dry run against the factory, so the wallet only opens for a payment that will go through.',
              },
              {
                step: 'wallet',
                label: 'Confirm in your wallet',
                detail: `Your wallet shows ${total} to the Cobweb factory on ${chain.name}.`,
              },
              {
                step: 'confirming',
                label: `Confirming on ${chain.name}`,
                detail: 'Sent. Waiting for the transaction to be included in a block.',
              },
              {
                step: 'verifying',
                label: 'Waiting for confirmation',
                detail:
                  'Cobweb is checking the payment event against your quote. Rendering starts as soon as it matches.',
              },
            ]}
          />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4 p-6">
        <p className="text-muted-foreground max-w-md text-[0.8125rem] leading-snug">
          Only a payment from <span className="numeric">{shortAddress(quote.payer)}</span> counts for this
          job. The job is marked paid once the payment is confirmed on chain, not when you sign.
        </p>
        {!readOnly && (
          <Button onClick={pay} disabled={running}>
            {running ? <Spinner /> : <WalletIcon />}
            {running ? 'Paying' : phase.step === 'failed' ? 'Try again' : `Pay ${total}`}
          </Button>
        )}
      </div>
    </div>
  )
}
