'use client'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { DownloadIcon, FlameIcon, SearchIcon } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@cobweb/ui/components/badge'
import { Button } from '@cobweb/ui/components/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@cobweb/ui/components/input-group'
import { Panel } from '@cobweb/ui/components/panel'
import { Skeleton } from '@cobweb/ui/components/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@cobweb/ui/components/table'
import { ToggleGroup, ToggleGroupItem } from '@cobweb/ui/components/toggle-group'
import { RECIPIENTS_NOT_READ } from '@/lib/art/result'
import { shortAddress, type SupportedChain } from '@/lib/demo'
import { RECIPIENTS_PAGE, type AirdropView } from '@/lib/manage/airdrop-types'
import { BURN_ADDRESS, recipientSearchOf, recipientsCsvRows, tokenIdsText } from '@/lib/manage/airdrop-view'
import { AirdropHistory, airdropHistoryCsv } from './airdrop-parts'
import type { AirdropServer } from './airdrop-server'
import { CopyButton, Pager, TxLink } from './bits'
import { count, downloadText, relativeTo, shortUtc } from './format'
import { toCsv } from './recipients'

/** How long By recipient waits after the last keystroke before it asks the server. */
const SEARCH_WAIT_MS = 300

const COUNTED =
  'Every airdrop and burn on the contract, also any sent from outside Cobweb, once the chain has confirmed it.'
const NOT_COUNTED =
  "Batches Cobweb confirmed. Airdrops sent from outside Cobweb show once Cobweb has read the contract's history."

type HistoryView = 'transaction' | 'recipient'

/** A sentence in place of a table. */
function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-muted-foreground px-6 py-10 text-center text-sm">{children}</p>
}

/**
 * Airdrop's History (docs/specs/2026-10-16-indexer-overview.md, section 7.3): By transaction, every airdrop and burn
 * with its When, and By recipient, every wallet an airdrop reached, each with its own "Export CSV". The
 * description says whether the history is complete: the indexer has read every block since the deploy.
 */
export function HistoryPanel({
  collectionId,
  view,
  chain,
  server,
}: {
  collectionId: string
  view: AirdropView
  chain: SupportedChain
  server: AirdropServer
}) {
  const [shown, setShown] = useState<HistoryView>('transaction')
  const [exporting, setExporting] = useState(false)
  // Each When counts from the later of the read's time and the indexer's count: the copy's time can trail a
  // recorded airdrop, which would read "in under a minute", and the count is no earlier than any it recorded.
  const now = Math.max(view.readAt, view.countedAt ?? view.readAt)

  async function exportRecipients() {
    setExporting(true)
    try {
      const result = await server.exportRecipients()
      if (result.ok) downloadText('airdrop-recipients.csv', toCsv(recipientsCsvRows(result.data)))
      else toast.error(result.error)
    } catch {
      toast.error(RECIPIENTS_NOT_READ)
    } finally {
      setExporting(false)
    }
  }

  return (
    <Panel
      title="History"
      description={view.counted ? COUNTED : NOT_COUNTED}
      bodyClassName="p-0 pb-2"
      action={
        shown === 'transaction' ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={view.history.length === 0}
            onClick={() => downloadText('airdrop-history.csv', airdropHistoryCsv(view.history, chain))}
          >
            <DownloadIcon aria-hidden="true" />
            Export CSV
          </Button>
        ) : (
          <Button variant="ghost" size="sm" disabled={!view.counted || exporting} onClick={exportRecipients}>
            <DownloadIcon aria-hidden="true" />
            Export CSV
          </Button>
        )
      }
    >
      <div className="px-5 pt-4 pb-2 lg:px-6">
        <ToggleGroup
          type="single"
          variant="outline"
          value={shown}
          onValueChange={(value) => {
            if (value) setShown(value as HistoryView)
          }}
          aria-label="Show the history"
        >
          <ToggleGroupItem value="transaction" className="px-3">
            By transaction
          </ToggleGroupItem>
          <ToggleGroupItem value="recipient" className="px-3">
            By recipient
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      {shown === 'transaction' ? (
        <AirdropHistory airdrops={view.history} chain={chain} now={now} />
      ) : (
        <ByRecipient
          collectionId={collectionId}
          counted={view.counted}
          chain={chain}
          now={now}
          server={server}
        />
      )}
    </Panel>
  )
}

/**
 * By recipient: 25 rows at a time, newest first, read on the server; the search goes to the server 300 ms after
 * the last keystroke and back to the first page.
 */
function ByRecipient({
  collectionId,
  counted,
  chain,
  now,
  server,
}: {
  collectionId: string
  counted: boolean
  chain: SupportedChain
  /** The time each When counts from: the later of the read's time and the indexer's count. */
  now: number
  server: AirdropServer
}) {
  const id = useId()
  const [typed, setTyped] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  useEffect(() => {
    const next = recipientSearchOf(typed)
    if (next === search) return
    const timer = setTimeout(() => {
      setSearch(next)
      setPage(0)
    }, SEARCH_WAIT_MS)
    return () => clearTimeout(timer)
  }, [typed, search])
  const recipients = useQuery({
    queryKey: ['airdrop-recipients', collectionId, search, page],
    queryFn: async () => {
      const result = await server.recipients({ search, page })
      if (!result.ok) throw new Error(result.error)
      return result.data
    },
    enabled: counted,
    placeholderData: keepPreviousData,
    retry: false,
  })

  if (!counted) return <Note>Recipients show once Cobweb has read the contract&apos;s history.</Note>
  const data = recipients.data
  return (
    <div className="grid gap-4">
      <div className="px-5 pt-2 lg:px-6">
        <InputGroup className="w-full sm:w-72">
          <InputGroupAddon>
            <SearchIcon aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            id={`${id}-search`}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder="Search addresses"
            aria-label="Search addresses"
            className="numeric"
            spellCheck={false}
            maxLength={42}
          />
        </InputGroup>
      </div>

      {recipients.isError ? (
        <div className="grid justify-items-center gap-3 px-6 py-10 text-center">
          <p className="text-muted-foreground text-sm">{RECIPIENTS_NOT_READ}</p>
          <Button variant="secondary" size="sm" onClick={() => void recipients.refetch()}>
            Try again
          </Button>
        </div>
      ) : !data ? (
        <div className="grid gap-2 px-6 py-4" aria-busy="true">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : data.total === 0 ? (
        <Note>{search ? 'No address matches that search.' : 'No wallet has received an airdrop yet.'}</Note>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-6">Wallet</TableHead>
              <TableHead className="text-right">Tokens</TableHead>
              <TableHead>Token ids</TableHead>
              <TableHead>When</TableHead>
              <TableHead className="pr-6 text-right">Transaction</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.rows.map((row) => (
              <TableRow key={`${row.txHash}:${row.firstTokenId}`}>
                <TableCell className="pl-6">
                  {row.burn ? (
                    <span className="inline-flex items-center gap-2">
                      <Badge variant="destructive">
                        <FlameIcon aria-hidden="true" />
                        Burn
                      </Badge>
                      <span className="numeric text-muted-foreground">{shortAddress(BURN_ADDRESS, 6)}</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      <span className="numeric">{row.wallet}</span>
                      <CopyButton value={row.wallet} label="Copy address" />
                    </span>
                  )}
                </TableCell>
                <TableCell className="numeric text-right">{count(row.tokens)}</TableCell>
                <TableCell className="numeric text-muted-foreground text-[0.8125rem]">
                  {tokenIdsText(row.firstTokenId, row.lastTokenId)}
                </TableCell>
                <TableCell>
                  <span className="numeric text-sm">{shortUtc(row.at)}</span>
                  <span className="text-muted-foreground block text-[0.8125rem]">
                    {relativeTo(row.at, now)}
                  </span>
                </TableCell>
                <TableCell className="pr-6 text-right">
                  <TxLink chain={chain} hash={row.txHash} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {data && data.total > 0 && (
        <div className="border-t px-5 py-3 lg:px-6">
          <Pager
            page={data.page}
            pages={Math.ceil(data.total / RECIPIENTS_PAGE)}
            total={data.total}
            pageSize={RECIPIENTS_PAGE}
            onPage={setPage}
            noun="recipients"
          />
        </div>
      )}
    </div>
  )
}
