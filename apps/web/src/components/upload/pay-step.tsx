'use client'

import { InfoIcon, LockOpenIcon, RefreshCwIcon, WalletIcon } from 'lucide-react'
import { useEffect, useReducer, useRef, useState } from 'react'
import type { Address, Hex } from 'viem'
import { useAccount, useConfig } from 'wagmi'
import { readContract, simulateContract, waitForTransactionReceipt, writeContract } from 'wagmi/actions'
import { factoryAbi } from '@cobweb/shared'
import { Alert, AlertDescription, AlertTitle } from '@cobweb/ui/components/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@cobweb/ui/components/alert-dialog'
import { Button } from '@cobweb/ui/components/button'
import { Input } from '@cobweb/ui/components/input'
import { Label } from '@cobweb/ui/components/label'
import { Spinner } from '@cobweb/ui/components/spinner'
import { ChainName } from '@/components/chains/chain-icon'
import { SummaryRow } from '@/components/deploy/copy-value'
import { isTxRunning, TX_IDLE, TxProgress } from '@/components/deploy/tx-progress'
import { quoteExpired } from '@/lib/art/quote'
import { NOT_A_HASH, PAYMENT_ON_CHAIN, THROWN } from '@/lib/art/result'
import { explorerTxUrl, formatNative, shortAddress } from '@/lib/demo/helpers'
import type { RenderJob, SupportedChain } from '@/lib/demo/types'
import {
  browserStore,
  forgetPayment,
  isShortPayment,
  payReducer,
  pendingPayment,
  rememberPayment,
  retryHash,
  runPayment,
  type PayEvent,
} from './pay-machine'
import type { UploadActions } from './upload-shared'
import { payArtFee, type UploadOutcome } from './upload-sim'

const ALREADY_PAID_ON_CHAIN =
  'This wallet already paid for this job on chain. Paste the transaction hash below so Cobweb can record it; you will not pay twice.'
const HASH_RE = /^0x[0-9a-fA-F]{64}$/

/**
 * Pay the generation fee (docs/specs/2026-10-09-lock-and-pay.md, section 8): the quote, then
 * `payForArt(jobId)` simulated, sent from the quote's wallet, mined, and confirmed by the server from
 * the receipt. While the fee is unpaid the art can be unlocked, and an expired quote is renewed
 * without unlocking. Sample mode simulates the payment (upload-sim.ts).
 */
export function PayStep({
  job,
  chain,
  readOnly,
  sample,
  outcome,
  actions,
  onPaid,
  onUnlocked,
  onRequoted,
}: {
  job: RenderJob
  chain: SupportedChain
  readOnly: boolean
  sample: boolean
  outcome?: UploadOutcome
  actions: UploadActions
  onPaid: (job: RenderJob) => void
  onUnlocked: () => void
  onRequoted: (job: RenderJob) => void
}) {
  const quote = job.quote
  const config = useConfig()
  const { address, chainId } = useAccount()
  const [phase, dispatch] = useReducer(payReducer, TX_IDLE)
  const [attempt, setAttempt] = useState(0)
  const [now, setNow] = useState<number | null>(null)
  const [resumable, setResumable] = useState<Hex | null>(null)
  const [unlockOpen, setUnlockOpen] = useState(false)
  const [busy, setBusy] = useState<'unlock' | 'requote' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [hashOpen, setHashOpen] = useState(false)
  const [hashText, setHashText] = useState('')
  const controller = useRef<AbortController | null>(null)
  const running = isTxRunning(phase)
  const symbol = chain.nativeSymbol
  const total = formatNative(quote.totalWei, symbol, 8)
  const amount = total.slice(0, total.lastIndexOf(' '))
  // Sample quotes are dated in the past; only a real quote expires on screen.
  const expired = !sample && now !== null && quoteExpired(quote.expiresAt, now)
  // A payment was sent and is not recorded yet: unlocking now would strand it.
  const hasShortPayment = job.state === 'payment_due' && job.payment !== null
  // The phase carries a timed-out hash too, so the guard holds when storage is blocked.
  const sent =
    resumable !== null ||
    (running && phase.step !== 'idle' && phase.txHash !== undefined) ||
    retryHash(phase) !== undefined
  // A sent payment is checked even after its quote expired; a new quote would only strand it.
  const canPay = !expired || sent
  const txUrl = chain.explorerUrl ? (hash: Hex) => explorerTxUrl(chain, hash) : undefined
  const waiting = resumable !== null && phase.step === 'idle'

  useEffect(() => () => controller.current?.abort(), [])
  useEffect(() => {
    const tick = () => setNow(Math.floor(Date.now() / 1000))
    tick()
    const timer = setInterval(tick, 30_000)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    if (!sample) setResumable(pendingPayment(browserStore(), job.id))
  }, [sample, job.id])

  async function paySample() {
    controller.current = new AbortController()
    try {
      const txHash = await payArtFee((next) => dispatch({ type: 'set', phase: next }), {
        outcome: attempt === 0 ? outcome : undefined,
        signal: controller.current.signal,
      })
      setAttempt((count) => count + 1)
      if (!txHash) return
      const result = await actions.confirm(job.id, txHash)
      if (result.ok) onPaid(result.data)
    } catch {
      // Unmounted mid-payment.
    }
  }

  async function payReal(typedHash?: Hex) {
    setNotice(null)
    setInfo(null)
    const store = browserStore()
    const sentHash = typedHash ?? retryHash(phase) ?? resumable ?? undefined
    if (!sentHash && quote.factory) {
      // Paid on chain already (a hash this browser lost): never prompt the wallet a second time.
      try {
        const paidWei = await readContract(config, {
          address: quote.factory as Address,
          abi: factoryAbi,
          functionName: 'jobPayment',
          args: [job.jobId, quote.payer as Address],
          chainId: quote.chainId,
        })
        if (paidWei > 0n) {
          setHashOpen(true)
          return setInfo(ALREADY_PAID_ON_CHAIN)
        }
      } catch {
        // The read failed: the simulation below reports a real problem before the wallet opens.
      }
    }
    let refusal: string | null = null
    const track = (event: PayEvent) => {
      if (event.type === 'failed') refusal = event.failure.message
      dispatch(event)
    }
    const paid = await runPayment(
      {
        payer: quote.payer,
        account: address,
        chainId: quote.chainId,
        connectedChainId: chainId,
        chainName: chain.name,
        factory: quote.factory ?? null,
        sentHash,
      },
      {
        simulate: async () => {
          const simulated = await simulateContract(config, {
            address: quote.factory as Address,
            abi: factoryAbi,
            functionName: 'payForArt',
            args: [job.jobId],
            value: BigInt(quote.totalWei),
            chainId: quote.chainId,
            account: address as Address,
          })
          // CLAUDE.md rule 2: the wallet gets exactly the request the simulation passed.
          return () => writeContract(config, simulated.request)
        },
        wait: async (hash) =>
          (await waitForTransactionReceipt(config, { hash, chainId: quote.chainId })).status,
        confirm: (hash) => actions.confirm(job.id, hash),
        reload: () => actions.reload(),
        remember: (hash) => rememberPayment(store, job.id, hash),
        forget: () => forgetPayment(store, job.id),
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        now: () => Date.now(),
      },
      track,
    )
    setResumable(pendingPayment(store, job.id))
    if (paid) return onPaid(paid)
    if (refusal !== null && isShortPayment(refusal)) {
      // The server recorded the short payment on the job: show it as it now stands.
      const current = await actions.reload()
      if (current.ok && current.data) onRequoted(current.data)
    }
  }

  function checkTyped() {
    const text = hashText.trim()
    if (!HASH_RE.test(text)) return setNotice(NOT_A_HASH)
    rememberPayment(browserStore(), job.id, text as Hex)
    setResumable(text as Hex)
    return payReal(text as Hex)
  }

  function discard() {
    forgetPayment(browserStore(), job.id)
    setResumable(null)
    setNotice(null)
    dispatch({ type: 'set', phase: TX_IDLE })
  }

  /** A refusal because the payment is already on chain also opens the hash box, where it is recorded. */
  function refuse(error: string) {
    setNotice(error)
    if (error === PAYMENT_ON_CHAIN) setHashOpen(true)
  }

  async function unlock() {
    setBusy('unlock')
    setNotice(null)
    try {
      const result = await actions.unlock()
      if (result.ok) onUnlocked()
      else refuse(result.error)
    } catch {
      setNotice(THROWN)
    } finally {
      setBusy(null)
    }
  }

  async function requote() {
    setBusy('requote')
    setNotice(null)
    try {
      const result = await actions.requote()
      if (!result.ok) return refuse(result.error)
      dispatch({ type: 'set', phase: TX_IDLE })
      onRequoted(result.data)
    } catch {
      setNotice(THROWN)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="divide-y">
      <div className="grid gap-8 p-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="space-y-2">
          <p className="text-muted-foreground text-[0.8125rem]">Generation fee</p>
          <p className="flex items-baseline gap-2">
            <span className="numeric text-[2.5rem] leading-none font-medium tracking-tight">{amount}</span>
            <span className="numeric text-muted-foreground text-base">{symbol}</span>
          </p>
          <p className="text-muted-foreground text-[0.8125rem]">
            <span className="numeric text-foreground/85">{quote.tokenCount.toLocaleString('en-US')}</span>{' '}
            tokens ×{' '}
            <span className="numeric text-foreground/85">{formatNative(quote.perTokenWei, symbol, 8)}</span>{' '}
            per token
          </p>
        </div>
        <dl className="divide-y">
          <SummaryRow label="Network">
            <ChainName chain={chain} iconClassName="size-3.5" />
          </SummaryRow>
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

      {expired && !readOnly && (
        <div className="p-6">
          <Alert>
            <RefreshCwIcon aria-hidden="true" />
            <AlertTitle>The quote expired</AlertTitle>
            <AlertDescription>
              <p>
                A quote lasts 24 hours, so the fee follows the current rate.{' '}
                {sent ? 'Check the payment first.' : 'Get a new quote to pay.'}
              </p>
              <Button variant="secondary" size="sm" onClick={requote} disabled={busy !== null || sent}>
                {busy === 'requote' ? <Spinner /> : <RefreshCwIcon />}
                Get a new quote
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      )}

      {waiting && (
        <div className="p-6">
          <Alert>
            <InfoIcon aria-hidden="true" />
            <AlertTitle>A payment is waiting to be checked</AlertTitle>
            <AlertDescription>
              This browser sent a payment for this job that Cobweb has not confirmed yet. Check it before you
              pay again.
            </AlertDescription>
          </Alert>
        </div>
      )}

      {hasShortPayment && (
        <div className="p-6">
          <Alert variant="destructive">
            <InfoIcon aria-hidden="true" />
            <AlertTitle>A payment was recorded that is less than the quote</AlertTitle>
            <AlertDescription>
              <p>
                The job still waits for payment. Tell support about job{' '}
                <span className="numeric">{shortAddress(job.jobId, 6)}</span>; the art stays locked.
              </p>
            </AlertDescription>
          </Alert>
        </div>
      )}

      {phase.step !== 'idle' && (
        <div className="p-6">
          <TxProgress
            phase={phase}
            txUrl={txUrl}
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

      {info && (
        <div className="p-6">
          <Alert>
            <InfoIcon aria-hidden="true" />
            <AlertTitle>This payment is already on chain</AlertTitle>
            <AlertDescription>{info}</AlertDescription>
          </Alert>
        </div>
      )}

      {notice && (
        <div className="p-6">
          <Alert variant="destructive">
            <AlertTitle>That did not go through</AlertTitle>
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        </div>
      )}

      {!readOnly && !sample && (
        <div className="space-y-3 p-6">
          {hashOpen ? (
            <div className="space-y-2">
              <Label htmlFor={`${job.id}-hash`}>Transaction hash</Label>
              <div className="flex flex-wrap gap-2">
                <Input
                  id={`${job.id}-hash`}
                  value={hashText}
                  onChange={(event) => setHashText(event.target.value)}
                  placeholder="0x"
                  spellCheck={false}
                  className="numeric max-w-xl min-w-0 flex-1"
                  disabled={running || hasShortPayment}
                  aria-invalid={notice === NOT_A_HASH}
                  aria-describedby={`${job.id}-hash-help`}
                />
                <Button
                  variant="secondary"
                  onClick={checkTyped}
                  disabled={running || hasShortPayment || !hashText.trim()}
                >
                  Check this hash
                </Button>
              </div>
              <p id={`${job.id}-hash-help`} className="text-muted-foreground text-[0.8125rem] leading-snug">
                Use this if you paid and this page lost the transaction. Cobweb checks it against your quote.
              </p>
            </div>
          ) : (
            <Button variant="link" className="h-auto p-0" onClick={() => setHashOpen(true)}>
              I have a transaction hash
            </Button>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4 p-6">
        <p className="text-muted-foreground max-w-md text-[0.8125rem] leading-snug">
          Only a payment from <span className="numeric">{shortAddress(quote.payer)}</span> counts for this
          job. The job is marked paid once the payment is confirmed on chain, not when you sign.
        </p>
        {!readOnly && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              onClick={() => setUnlockOpen(true)}
              disabled={running || sent || hasShortPayment || busy !== null}
            >
              {busy === 'unlock' ? <Spinner /> : <LockOpenIcon />}
              Unlock the art
            </Button>
            {phase.step === 'failed' && retryHash(phase) !== undefined && (
              <Button variant="ghost" onClick={discard} disabled={running}>
                Discard this attempt
              </Button>
            )}
            <Button
              onClick={sample ? paySample : () => payReal()}
              disabled={running || !canPay || hasShortPayment || busy !== null}
            >
              {running ? <Spinner /> : <WalletIcon />}
              {running
                ? 'Paying'
                : waiting
                  ? 'Check the payment'
                  : phase.step === 'failed'
                    ? retryHash(phase) !== undefined
                      ? 'Check again'
                      : 'Try again'
                    : `Pay ${total}`}
            </Button>
          </div>
        )}
      </div>

      <AlertDialog open={unlockOpen} onOpenChange={setUnlockOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unlock the art?</AlertDialogTitle>
            <AlertDialogDescription>
              The lock and the quote are discarded and the Art step opens again, so you can change the layers,
              rules or tokens and lock again. Nothing has been paid, so there is nothing to refund.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep the lock</AlertDialogCancel>
            <AlertDialogAction onClick={unlock}>
              <LockOpenIcon />
              Unlock the art
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
