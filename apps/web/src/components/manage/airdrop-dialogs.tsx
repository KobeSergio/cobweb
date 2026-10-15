'use client'

import { InfoIcon } from 'lucide-react'
import { useReducer } from 'react'
import { toast } from 'sonner'
import type { Hex } from 'viem'
import { Alert, AlertDescription, AlertTitle } from '@cobweb/ui/components/alert'
import { Button } from '@cobweb/ui/components/button'
import { Spinner } from '@cobweb/ui/components/spinner'
import { deployReducer, type DeployEvent } from '@/components/deploy/deploy-machine'
import { classifyError } from '@/components/deploy/tx-errors'
import { isTxRunning, TX_IDLE, TxProgress, type TxFailure } from '@/components/deploy/tx-progress'
import type { ActionResult } from '@/lib/art/result'
import type { SupportedChain } from '@/lib/demo'
import type { AirdropJob, AirdropView, BatchEntry } from '@/lib/manage/airdrop-types'
import { tokensOf } from '@/lib/manage/airdrop-view'
import { airdropCalls, reviewOf, type ManageCall } from '@/lib/manage/phase-calls'
import type { AirdropServer } from './airdrop-server'
import { TxLink } from './bits'
import { count } from './format'
import type { ManageRequest } from './manage-actions'
import { useManageActions } from './manage-context'
import { runManage } from './manage-machine'

/** Keeps a sent hash in the job until the server confirms it. */
type Pending = { remember(hash: Hex): void; forget(): void }

/** `1 token`, `4 tokens`; `1 wallet`, `3 wallets`. */
export const tokensLabel = (value: number) => `${count(value)} ${value === 1 ? 'token' : 'tokens'}`
export const walletsLabel = (value: number) => `${count(value)} ${value === 1 ? 'wallet' : 'wallets'}`

/** A call as the airdrop dialogs send it: the call, its review from the ABI, the server's confirm and the hash kept. */
function requestOf(
  call: ManageCall,
  chain: SupportedChain,
  confirm: (hash: Hex) => Promise<ActionResult<AirdropView>>,
  pending: Pending,
): ManageRequest<AirdropView> {
  return {
    call,
    review: { contract: 'Collection', functionName: 'airdropNFTs', args: reviewOf(call, chain) },
    confirm,
    pending,
  }
}

/**
 * One batch as the send dialog sends it (docs/specs/2026-10-15-airdrop-settings.md, section 7.3): `airdropNFTs`
 * with the contract's fee for its tokens as the value, the review in counts with the value, the server's confirm
 * from the receipt and calldata, and the hash kept in the job until then.
 */
export function batchRequest(
  entries: BatchEntry[],
  feePerTokenWei: string,
  chain: SupportedChain,
  confirm: (hash: Hex) => Promise<ActionResult<AirdropView>>,
  pending: Pending,
): ManageRequest<AirdropView> {
  return requestOf(airdropCalls.batch(entries, feePerTokenWei), chain, confirm, pending)
}

/** A burn as its dialog sends it: one batch of `amount` tokens to the dead address, the same way. */
export function burnRequest(
  amount: number,
  feePerTokenWei: string,
  chain: SupportedChain,
  confirm: (hash: Hex) => Promise<ActionResult<AirdropView>>,
  pending: Pending,
): ManageRequest<AirdropView> {
  return requestOf(airdropCalls.burn(amount, feePerTokenWei), chain, confirm, pending)
}

/**
 * A batch or a burn this browser sent and Cobweb has not confirmed (section 7.3): "Check again" runs the manage
 * machine from its last step, which reads the receipt and the calldata on the server; a terminal refusal is
 * toasted and forgets the hash (`onForget`). "Discard" forgets it and marks the batch failed (`onDiscard`), under
 * the warning that a landed batch sent again mints twice.
 */
export function PendingBatchPanel({
  job,
  chain,
  server,
  onView,
  onConfirmed,
  onForget,
  onDiscard,
}: {
  job: AirdropJob
  chain: SupportedChain
  server: AirdropServer
  onView: (view: AirdropView) => void
  onConfirmed: () => void
  onForget: () => void
  onDiscard: () => void
}) {
  const { chainId, wallet } = useManageActions()
  const [phase, dispatch] = useReducer(deployReducer, TX_IDLE)
  const running = isTxRunning(phase)
  const burn = job.kind === 'burn'
  const batch = job.batches[job.sent] ?? []
  const tokens = tokensOf(batch)

  async function check() {
    const hash = job.pending
    if (!hash) return
    const last: { failure: TxFailure | null } = { failure: null }
    const report = (event: DeployEvent) => {
      if (event.type === 'failed') last.failure = event.failure
      dispatch(event)
    }
    let view: AirdropView | null = null
    try {
      view = await runManage<AirdropView>(
        {
          call: null,
          account: wallet,
          wallet,
          chainId,
          connectedChainId: chainId,
          sentHash: hash,
          nativeSymbol: chain.nativeSymbol,
        },
        {
          switchChain: async () => {},
          simulate: () => Promise.reject(new Error('A sent batch is checked, never sent again.')),
          wait: async () => 'success',
          confirm: (sent) => server.confirm(sent),
          forget: onForget,
          sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
          now: () => Date.now(),
        },
        report,
      )
    } catch (error) {
      report({ type: 'failed', failure: classifyError(error, 'confirming', 'manage', chain.nativeSymbol) })
    }
    if (view) {
      onView(view)
      onConfirmed()
      toast.success(burn ? 'The burn is on chain' : 'The batch is on chain')
      return
    }
    if (last.failure?.kind === 'refused') toast.error(last.failure.message)
  }

  return (
    <Alert>
      <InfoIcon aria-hidden="true" />
      <AlertTitle>
        {burn ? 'A burn is waiting to be confirmed' : 'A batch is waiting to be confirmed'}
      </AlertTitle>
      <AlertDescription>
        <p>
          {burn
            ? `This browser sent a burn of ${tokensLabel(tokens)} to the dead address.`
            : `This browser sent batch ${job.sent + 1} of ${job.batches.length}: ${tokensLabel(tokens)} to ${walletsLabel(batch.length)}.`}{' '}
          Cobweb lists it in History once the receipt and the transaction show the tokens minted.
        </p>
        {job.pending && <TxLink chain={chain} hash={job.pending} label="Transaction" />}
        {phase.step !== 'idle' && (
          <TxProgress
            phase={phase}
            steps={[
              {
                step: 'verifying',
                label: 'Reading the batch',
                detail:
                  'Cobweb checks the receipt and the recipients and amounts the transaction carried, then reads the contract again.',
              },
            ]}
          />
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => void check()} disabled={running}>
            {running && <Spinner />}
            Check again
          </Button>
          <Button variant="ghost" size="sm" onClick={onDiscard} disabled={running}>
            Discard
          </Button>
        </div>
        <p className="text-muted-foreground text-[0.8125rem]">
          Discard only a transaction that failed or never left your wallet. If it landed, sending the batch
          again mints its tokens twice.
        </p>
      </AlertDescription>
    </Alert>
  )
}
