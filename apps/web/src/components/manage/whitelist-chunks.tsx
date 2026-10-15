'use client'

import { InfoIcon, RotateCwIcon, UploadIcon } from 'lucide-react'
import { useReducer } from 'react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@cobweb/ui/components/alert'
import { Button } from '@cobweb/ui/components/button'
import { Spinner } from '@cobweb/ui/components/spinner'
import { StatusBadge } from '@cobweb/ui/components/status-badge'
import { cn } from '@cobweb/ui/lib/utils'
import { deployReducer, type DeployEvent } from '@/components/deploy/deploy-machine'
import { classifyError } from '@/components/deploy/tx-errors'
import { isTxRunning, TX_IDLE, TxProgress, type TxFailure } from '@/components/deploy/tx-progress'
import type { MintGroup, SupportedChain } from '@/lib/demo'
import type { GroupList, SentChunk, WhitelistView } from '@/lib/manage/whitelist-types'
import { WHITELIST_CHUNK } from '@/lib/manage/whitelist-view'
import { TxLink } from './bits'
import { count } from './format'
import { useManageActions } from './manage-context'
import { runManage } from './manage-machine'
import type { ChunkRow } from './whitelist-model'
import type { WhitelistServer } from './whitelist-server'

/**
 * The on-chain write (docs/specs/2026-10-15-whitelist.md, section 7.3): one block per `setMintQuota`
 * transaction, written with its transaction, the next one (or the one that failed, with its error), and the ones
 * waiting. The server builds each chunk from the entries not written, so a failure is resumed by writing again.
 */
export function WhitelistChunks({
  rows,
  list,
  chain,
  write,
  onWrite,
}: {
  rows: ChunkRow[]
  list: GroupList
  chain: SupportedChain
  /** The write button: its label, why it is off (or null), and whether it is asking for the chunk; null hides it. */
  write: { label: string; off: string | null; busy: boolean } | null
  onWrite: () => void
}) {
  const written = rows.filter((row) => row.status === 'written').length
  const failed = rows.some((row) => row.status === 'failed')
  const waiting = list.unwritten

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-sm">
            <span className="numeric text-lg">{count(written)}</span>
            <span className="text-muted-foreground"> of </span>
            <span className="numeric text-lg">{count(rows.length)}</span>
            <span className="text-muted-foreground"> chunks written</span>
          </p>
          <p className="text-muted-foreground text-[0.8125rem]">
            {waiting > 0
              ? `${count(waiting)} ${waiting === 1 ? 'address waits' : 'addresses wait'} for a chunk. Until it is written, the chain keeps the quota it had, or none.`
              : list.total === 0
                ? 'No addresses yet.'
                : 'Every address is on chain.'}{' '}
            Up to {count(WHITELIST_CHUNK)} addresses go in each transaction.
          </p>
        </div>
        {write && (
          <Button
            onClick={onWrite}
            disabled={write.off !== null || write.busy}
            title={write.off ?? undefined}
          >
            {write.busy ? (
              <Spinner />
            ) : failed ? (
              <RotateCwIcon aria-hidden="true" />
            ) : (
              <UploadIcon aria-hidden="true" />
            )}
            {write.label}
          </Button>
        )}
      </div>
      {write?.off && <p className="text-muted-foreground -mt-3 text-[0.8125rem]">{write.off}</p>}

      {rows.length > 0 && (
        <ol aria-label="Chunks" className="flex gap-1">
          {rows.map((row) => (
            <li
              key={row.number}
              className={cn(
                'h-2 min-w-1 rounded-full',
                row.status === 'written'
                  ? 'bg-primary'
                  : row.status === 'failed'
                    ? 'bg-destructive'
                    : 'bg-well shadow-inset border border-dashed',
              )}
              style={{ flexGrow: row.addresses, flexBasis: 0 }}
            >
              <span className="sr-only">
                Chunk {row.number}, {row.addresses} {row.addresses === 1 ? 'address' : 'addresses'},{' '}
                {row.status === 'written' ? 'written' : row.status === 'failed' ? 'failed' : 'not written'}
              </span>
            </li>
          ))}
        </ol>
      )}

      {rows.length > 0 && (
        <ul className="divide-y rounded-lg border text-sm">
          {rows.map((row) => (
            <li key={row.number} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
              <span className="w-20 font-medium">Chunk {row.number}</span>
              <span className="numeric text-muted-foreground w-28">
                {count(row.addresses)} {row.addresses === 1 ? 'address' : 'addresses'}
              </span>
              {row.status === 'written' ? (
                <StatusBadge status="done">Written</StatusBadge>
              ) : row.status === 'failed' ? (
                <StatusBadge status="error">Failed</StatusBadge>
              ) : (
                <StatusBadge status="draft">{row.status === 'next' ? 'Next' : 'Waiting'}</StatusBadge>
              )}
              {row.txHash && (
                <span className="ml-auto">
                  <TxLink chain={chain} hash={row.txHash} />
                </span>
              )}
              {row.error && (
                <span className="text-destructive-foreground basis-full text-[0.8125rem]">{row.error}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * A chunk this browser sent and Cobweb has not confirmed (section 7.3): "Check again" runs the manage machine
 * from its last step, which reads the receipt and the calldata on the server; "Discard" forgets it. A terminal
 * answer forgets it too, which closes this panel, so its sentence goes to a toast.
 */
export function PendingChunkPanel({
  sent,
  group,
  chain,
  server,
  onView,
  onForget,
}: {
  sent: SentChunk
  group: MintGroup | undefined
  chain: SupportedChain
  server: WhitelistServer
  onView: (view: WhitelistView) => void
  onForget: () => void
}) {
  const { chainId, wallet } = useManageActions()
  const [phase, dispatch] = useReducer(deployReducer, TX_IDLE)
  const running = isTxRunning(phase)

  async function check() {
    const last: { failure: TxFailure | null } = { failure: null }
    const report = (event: DeployEvent) => {
      if (event.type === 'failed') last.failure = event.failure
      dispatch(event)
    }
    let view: WhitelistView | null = null
    try {
      view = await runManage<WhitelistView>(
        { call: null, account: wallet, wallet, chainId, connectedChainId: chainId, sentHash: sent.hash },
        {
          switchChain: async () => {},
          simulate: () => Promise.reject(new Error('A sent chunk is checked, never sent again.')),
          wait: async () => 'success',
          confirm: (hash) => server.confirmChunk(hash, sent.onchainId),
          forget: onForget,
          sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
          now: () => Date.now(),
        },
        report,
      )
    } catch (error) {
      report({ type: 'failed', failure: classifyError(error, 'confirming', 'manage') })
    }
    if (view) {
      onView(view)
      toast.success('The chunk is on chain')
      return
    }
    if (last.failure?.kind === 'refused') toast.error(last.failure.message)
  }

  return (
    <Alert>
      <InfoIcon aria-hidden="true" />
      <AlertTitle>A chunk is waiting to be confirmed</AlertTitle>
      <AlertDescription>
        <p>
          This browser sent a chunk of the{' '}
          <span className="text-foreground">{group?.name ?? `Group ${sent.onchainId}`}</span> whitelist.
          Cobweb marks its addresses written once the receipt and the transaction show them on the contract.
        </p>
        <TxLink chain={chain} hash={sent.hash} label="Transaction" />
        {phase.step !== 'idle' && (
          <TxProgress
            phase={phase}
            steps={[
              {
                step: 'verifying',
                label: 'Reading the chunk',
                detail:
                  'Cobweb checks the receipt and the addresses the transaction carried, then reads the contract again.',
              },
            ]}
          />
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => void check()} disabled={running}>
            {running && <Spinner />}
            Check again
          </Button>
          <Button variant="ghost" size="sm" onClick={onForget} disabled={running}>
            Discard
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  )
}
