'use client'

import { RocketIcon } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@cobweb/ui/components/dialog'
import { Button } from '@cobweb/ui/components/button'
import { Spinner } from '@cobweb/ui/components/spinner'
import { ChainName } from '@/components/chains/chain-icon'
import { explorerTxUrl, formatBps, formatNative, shortAddress } from '@/lib/demo/helpers'
import type { Address, FeeSnapshot, SupportedChain } from '@/lib/demo/types'
import { SummaryRow } from './copy-value'
import { mintFeeText } from './deploy-summary'
import { isTxRunning, TxProgress, type TxPhase } from './tx-progress'

export type FinalCheck = {
  name: string
  /** The reserved mint page link, e.g. `cobweb.app/night-owls`. */
  mintPageLink: string
  symbol: string
  maxSupply: number
  chain: SupportedChain
  walletChain: SupportedChain | undefined
  predicted: Address
  payout: Address
  royaltyBps: number
  royaltyReceiver: Address
  publicCap: number
  /** The phases the contract starts with, closed, in group order. */
  phases: { name: string; priceWei: string; maxSupply: number }[]
  fees: FeeSnapshot
  deployCostWei: string | undefined
}

/** The final check before deploying, then the transaction's progress in the same dialog. */
export function DeployDialog({
  open,
  onOpenChange,
  check,
  phase,
  onDeploy,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  check: FinalCheck | null
  phase: TxPhase
  onDeploy: () => void
}) {
  const running = isTxRunning(phase)
  if (!check) return null
  const { chain } = check
  const needsSwitch = check.walletChain?.id !== chain.id

  return (
    <Dialog open={open} onOpenChange={(next) => !running && onOpenChange(next)}>
      <DialogContent
        showCloseButton={!running}
        onEscapeKeyDown={(event) => running && event.preventDefault()}
        onInteractOutside={(event) => running && event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>
            Deploy {check.name} on <ChainName chain={chain} iconClassName="size-5" />
          </DialogTitle>
          <DialogDescription>
            {phase.step === 'idle'
              ? 'Check these once more. Name, symbol and supply cannot change after this.'
              : 'Keep this window open until the deploy is confirmed.'}
          </DialogDescription>
        </DialogHeader>

        {phase.step === 'idle' || phase.step === 'failed' ? (
          <dl className="divide-y border-y">
            <SummaryRow label="Collection">
              <span>
                {check.name} <span className="numeric text-muted-foreground">{check.symbol}</span>
              </span>
            </SummaryRow>
            <SummaryRow label="Chain">
              <ChainName chain={chain} className="text-[0.8125rem]" />
            </SummaryRow>
            <SummaryRow label="Supply">
              <span className="numeric">{check.maxSupply.toLocaleString('en-US')}</span>
            </SummaryRow>
            <SummaryRow label="Contract address">
              <span className="numeric text-[0.8125rem]" title={check.predicted}>
                {shortAddress(check.predicted, 6)}
              </span>
            </SummaryRow>
            <SummaryRow label="Mint page link">
              <span className="numeric text-[0.8125rem]">{check.mintPageLink}</span>
            </SummaryRow>
            <SummaryRow label="Payout">
              <span className="numeric text-[0.8125rem]" title={check.payout}>
                {shortAddress(check.payout, 6)}
              </span>
            </SummaryRow>
            <SummaryRow label="Royalty">
              <span className="numeric text-[0.8125rem]">
                {formatBps(check.royaltyBps)} to {shortAddress(check.royaltyReceiver)}
              </span>
            </SummaryRow>
            <SummaryRow label="Public limit">
              <span>
                <span className="numeric">{check.publicCap}</span> per wallet
              </span>
            </SummaryRow>
            {check.phases.map((phase, index) => (
              <SummaryRow key={index} label={`Phase ${index}: ${phase.name}`}>
                <span className="numeric text-[0.8125rem]">
                  {formatNative(phase.priceWei, chain.nativeSymbol, 18)} ·{' '}
                  {phase.maxSupply.toLocaleString('en-US')} tokens
                </span>
              </SummaryRow>
            ))}
            <SummaryRow label="Mint fee">
              <span className="numeric text-[0.8125rem]">{mintFeeText(check.fees, chain.nativeSymbol)}</span>
            </SummaryRow>
            <SummaryRow label="Gas">
              <span className="numeric text-[0.8125rem]">
                {check.deployCostWei
                  ? `about ${formatNative(check.deployCostWei, chain.nativeSymbol, 6)}`
                  : 'Shown in your wallet'}
              </span>
            </SummaryRow>
          </dl>
        ) : null}

        {phase.step !== 'idle' && (
          <TxProgress
            phase={phase}
            txUrl={(hash) => explorerTxUrl(chain, hash)}
            steps={[
              {
                step: 'preparing',
                label: 'Preparing the deploy',
                detail:
                  'Cobweb builds the contract settings from the collection and the render, and predicts the address.',
              },
              ...(needsSwitch
                ? [
                    {
                      step: 'switching' as const,
                      label: `Switch to ${chain.name}`,
                      detail: `Approve the network switch${check.walletChain ? ` from ${check.walletChain.name}` : ''} in your wallet.`,
                    },
                  ]
                : []),
              {
                step: 'simulating',
                label: 'Checking the deploy',
                detail:
                  'A dry run against the factory, so the wallet only opens for a deploy that will go through.',
              },
              {
                step: 'wallet',
                label: 'Confirm in your wallet',
                detail: 'Your wallet shows a call to the Cobweb factory and the gas for it.',
              },
              {
                step: 'confirming',
                label: `Confirming on ${chain.name}`,
                detail: 'Sent. Waiting for the transaction to be included in a block.',
              },
              {
                step: 'verifying',
                label: 'Recording the contract',
                detail:
                  'Cobweb reads the factory event from the receipt and records the address once it equals the prediction.',
              },
            ]}
          />
        )}

        {needsSwitch && phase.step === 'idle' && (
          <p className="text-muted-foreground text-[0.8125rem]">
            Your wallet is on {check.walletChain?.name ?? 'another network'}. It asks to switch to{' '}
            <ChainName chain={chain} className="text-foreground" iconClassName="size-3.5" /> first.
          </p>
        )}

        <DialogFooter>
          {!running && (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {phase.step === 'failed' ? 'Close' : 'Go back'}
            </Button>
          )}
          <Button onClick={onDeploy} disabled={running}>
            {running ? <Spinner /> : <RocketIcon />}
            {running ? 'Deploying' : phase.step === 'failed' ? 'Try again' : 'Deploy contract'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
