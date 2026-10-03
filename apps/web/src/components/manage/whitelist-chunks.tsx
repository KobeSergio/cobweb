'use client'

import { ExternalLinkIcon, RotateCwIcon, UploadIcon } from 'lucide-react'
import { Button } from '@cobweb/ui/components/button'
import { StatusBadge } from '@cobweb/ui/components/status-badge'
import { cn } from '@cobweb/ui/lib/utils'
import { explorerTxUrl, shortAddress, type SupportedChain } from '@/lib/demo'
import { count } from './format'
import type { ListState, PendingChunk } from './whitelist-model'

/**
 * The on-chain write, one block per `setMintQuota` transaction: written, waiting, or failed.
 * The next chunk is always the first one waiting, so a failure is resumed by writing it again.
 */
export function WhitelistChunks({
  list,
  pending,
  chain,
  onWrite,
}: {
  list: ListState
  pending: PendingChunk[]
  chain: SupportedChain
  onWrite: (chunk: PendingChunk) => void
}) {
  const total = list.written.length + pending.length
  const next = pending[0]
  const waitingAddresses = pending.reduce((sum, chunk) => sum + chunk.entries.length, 0)

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-sm">
            <span className="numeric text-lg">{count(list.written.length)}</span>
            <span className="text-muted-foreground"> of </span>
            <span className="numeric text-lg">{count(total)}</span>
            <span className="text-muted-foreground"> chunks written</span>
          </p>
          <p className="text-muted-foreground text-[0.8125rem]">
            {next
              ? `${count(waitingAddresses)} ${waitingAddresses === 1 ? 'address is' : 'addresses are'} not on chain yet, so ${waitingAddresses === 1 ? 'it cannot' : 'they cannot'} mint in this phase.`
              : 'Every address is on chain.'}{' '}
            Up to {count(list.chunkSize)} addresses go in each transaction.
          </p>
        </div>
        {next && (
          <Button onClick={() => onWrite(next)}>
            {next.status === 'failed' ? (
              <RotateCwIcon aria-hidden="true" />
            ) : (
              <UploadIcon aria-hidden="true" />
            )}
            {next.status === 'failed' ? `Retry chunk ${next.number}` : `Write chunk ${next.number}`}
          </Button>
        )}
      </div>

      {total > 0 && (
        <ol aria-label="Chunks" className="flex gap-1">
          {list.written.map((chunk, index) => (
            <li
              key={`w${index}`}
              className="bg-primary h-2 min-w-1 rounded-full"
              style={{ flexGrow: chunk.size, flexBasis: 0 }}
            >
              <span className="sr-only">
                Chunk {index + 1}, {chunk.size} addresses, written
              </span>
            </li>
          ))}
          {pending.map((chunk) => (
            <li
              key={`p${chunk.number}`}
              className={cn(
                'h-2 min-w-1 rounded-full',
                chunk.status === 'failed' ? 'bg-destructive' : 'bg-well shadow-inset border border-dashed',
              )}
              style={{ flexGrow: chunk.entries.length, flexBasis: 0 }}
            >
              <span className="sr-only">
                Chunk {chunk.number}, {chunk.entries.length} addresses,{' '}
                {chunk.status === 'failed' ? 'failed' : 'not written'}
              </span>
            </li>
          ))}
        </ol>
      )}

      {total > 0 && (
        <ul className="divide-y rounded-lg border text-sm">
          {list.written.map((chunk, index) => (
            <li key={`w${index}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
              <span className="w-20 font-medium">Chunk {index + 1}</span>
              <span className="numeric text-muted-foreground w-28">{count(chunk.size)} addresses</span>
              <StatusBadge status="done">Written</StatusBadge>
              {chunk.txHash && (
                <a
                  href={explorerTxUrl(chain, chunk.txHash)}
                  target="_blank"
                  rel="noreferrer"
                  className="numeric text-muted-foreground hover:text-foreground focus-visible:ring-ring ml-auto inline-flex items-center gap-1 rounded-sm text-[0.8125rem] outline-none focus-visible:ring-2"
                >
                  {shortAddress(chunk.txHash, 6)}
                  <ExternalLinkIcon aria-hidden="true" className="size-3" />
                  <span className="sr-only">, view transaction</span>
                </a>
              )}
            </li>
          ))}
          {pending.map((chunk, index) => (
            <li key={`p${chunk.number}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
              <span className="w-20 font-medium">Chunk {chunk.number}</span>
              <span className="numeric text-muted-foreground w-28">
                {count(chunk.entries.length)} addresses
              </span>
              {chunk.status === 'failed' ? (
                <StatusBadge status="error">Failed</StatusBadge>
              ) : (
                <StatusBadge status="draft">{index === 0 ? 'Next' : 'Waiting'}</StatusBadge>
              )}
              {chunk.error && (
                <span className="text-destructive-foreground basis-full text-[0.8125rem]">{chunk.error}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
