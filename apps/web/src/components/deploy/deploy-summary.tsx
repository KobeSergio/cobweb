'use client'

import { sampleSupply, DEMO_COLLECTION } from '@/lib/demo'
import { RotateCwIcon, TriangleAlertIcon } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@cobweb/ui/components/alert'
import { Artwork } from '@cobweb/ui/components/artwork'
import { Button } from '@cobweb/ui/components/button'
import { Panel } from '@cobweb/ui/components/panel'
import { Skeleton } from '@cobweb/ui/components/skeleton'
import { ChainName } from '@/components/chains/chain-icon'
import { slugState } from '@/lib/collections'
import type { Tables } from '@/lib/database.types'
import { formatBps, formatNative, shortAddress } from '@/lib/demo/helpers'
import type { Address, FeeSnapshot, SupportedChain } from '@/lib/demo/types'
import { CopyValue, SummaryRow } from './copy-value'

/** The factory's fees as read in the browser; the server's snapshot stays shown while a new read runs. */
export type FeesState = { status: 'loading' | 'ready' | 'error'; data: FeeSnapshot | null }

/** The deploy cost: the gas of the prepared call times the gas price, when it can be estimated. */
export type CostState =
  | { kind: 'none' }
  | { kind: 'no-wallet' }
  | { kind: 'other-chain'; chainName: string }
  | { kind: 'loading' }
  | { kind: 'ready'; wei: string }
  | { kind: 'unknown' }

export type SummaryProps = {
  collection: Tables<'collections'>
  chain: SupportedChain | null
  fees: FeesState
  onRetryFees: () => void
  cost: CostState
  /** The server's prediction for the current settings; null while the settings are incomplete. */
  predicted: Address | null
  /** A prediction is on its way: the settings changed less than 400 ms ago, or the server is answering. */
  predicting: boolean
  /** The server's refusal to prepare, shown where the address would be; null when there is none. */
  predictError: string | null
  payout: Address | null
  royaltyBps: number | null
  royaltyReceiver: Address | null
  /** The base URI the contract starts on, or null before any finished render. */
  startsOn: string | null
  /** The contract starts on a placeholder, so there is something to reveal to. */
  startsOnPlaceholder: boolean
  /** The real set's base URI, or null while it is not rendered. */
  revealsTo: string | null
  artSrc: string | null
}

/** What a mint costs collectors on top of the price, for a chain's fee snapshot. */
export function mintFeeText(fees: FeeSnapshot, symbol: string): string {
  return `${formatNative(fees.mintFeeFlatWei, symbol, 8)} + ${formatBps(fees.mintFeeBps)} of price`
}

/** `ipfs://bafybeihk…7lly/`: the first ten characters after the scheme and the last six. */
function shortUri(uri: string): string {
  return uri.replace(/^(ipfs:\/\/.{10}).*(.{6})$/, '$1…$2')
}

function costText(cost: CostState, symbol: string): string {
  switch (cost.kind) {
    case 'ready':
      return `about ${formatNative(cost.wei, symbol, 6)}`
    case 'loading':
      return 'Estimating'
    case 'other-chain':
      return `Could not be estimated while your wallet is on another network. It switches to ${cost.chainName} when you deploy.`
    case 'no-wallet':
      return 'Connect your wallet to estimate it.'
    case 'unknown':
      return 'Could not be estimated'
    case 'none':
      return 'Fill in the settings'
  }
}

/** The live summary beside the form: what will be deployed, where, and what it costs. */
export function DeploySummary(props: SummaryProps) {
  const { collection, chain, fees, cost, predicted, predicting, predictError, artSrc } = props
  const symbol = chain?.nativeSymbol ?? ''

  return (
    <Panel title="Summary" bodyClassName="p-0">
      <div className="flex items-center gap-4 border-b p-5">
        <Artwork
          src={artSrc}
          alt={`${collection.name} sample token`}
          seed={collection.id}
          className="border-border-strong size-16 shrink-0 rounded-lg border"
        />
        <div className="min-w-0">
          <p className="truncate font-semibold">{collection.name}</p>
          <p className="text-muted-foreground text-[0.8125rem]">
            <span className="numeric text-foreground/85">{collection.symbol}</span> ·{' '}
            <span className="numeric">
              {sampleSupply(collection.max_supply, DEMO_COLLECTION.maxSupply).toLocaleString('en-US')}
            </span>{' '}
            tokens · {chain ? <ChainName chain={chain} iconClassName="size-3.5" /> : 'No chain yet'}
          </p>
        </div>
      </div>

      <dl className="divide-y px-5">
        <SummaryRow label="Contract address">
          {predicted ? (
            <CopyValue value={predicted} label="Contract address" display={shortAddress(predicted, 6)} />
          ) : predictError ? (
            <span className="text-destructive-foreground text-[0.8125rem]">{predictError}</span>
          ) : (
            <span className="text-muted-foreground text-[0.8125rem]">
              {predicting ? 'Predicting' : 'Fill in the settings'}
            </span>
          )}
        </SummaryRow>
        <SummaryRow label="Payout">
          {props.payout ? (
            <span className="numeric text-[0.8125rem]" title={props.payout}>
              {shortAddress(props.payout)}
            </span>
          ) : (
            <Missing />
          )}
        </SummaryRow>
        <SummaryRow label="Royalty">
          {props.royaltyBps !== null && props.royaltyReceiver ? (
            <span className="numeric text-[0.8125rem]">
              {formatBps(props.royaltyBps)} to {shortAddress(props.royaltyReceiver)}
            </span>
          ) : (
            <Missing />
          )}
        </SummaryRow>
        <SummaryRow label="Mint page link">
          <MintPageAddress collection={collection} />
        </SummaryRow>
        <SummaryRow label="Starts on">
          {props.startsOn ? (
            <span className="numeric truncate text-[0.8125rem]" title={props.startsOn}>
              {shortUri(props.startsOn)}
            </span>
          ) : (
            <span className="text-destructive-foreground text-[0.8125rem]">Not rendered yet</span>
          )}
        </SummaryRow>
        {props.startsOnPlaceholder && (
          <SummaryRow label="Reveals to">
            {props.revealsTo ? (
              <span className="numeric truncate text-[0.8125rem]" title={props.revealsTo}>
                {shortUri(props.revealsTo)}
              </span>
            ) : (
              <span className="text-muted-foreground text-[0.8125rem]">Not rendered yet</span>
            )}
          </SummaryRow>
        )}
      </dl>
      {predicted && (
        <p className="text-muted-foreground border-t px-5 py-3 text-xs leading-snug">
          Predicted by Cobweb from your settings. The address is the same on every chain, and it changes if
          you change a setting above.
        </p>
      )}

      <div className="bg-surface-2/40 border-t px-5 pt-4 pb-5">
        <h3 className="text-sm font-medium">Platform fees</h3>
        {!chain ? (
          <p className="text-muted-foreground mt-2 text-[0.8125rem]">Choose a chain to see its fees.</p>
        ) : fees.data ? (
          <>
            <dl className="mt-1 divide-y">
              <SummaryRow label="Per token minted">
                <span className="numeric text-[0.8125rem]">{mintFeeText(fees.data, symbol)}</span>
              </SummaryRow>
              <SummaryRow label="Per token airdropped">
                <span className="numeric text-[0.8125rem]">
                  {formatNative(fees.data.airdropFeePerTokenWei, symbol, 8)}
                </span>
              </SummaryRow>
              <SummaryRow label="Deploy cost">
                <span
                  className={
                    cost.kind === 'ready'
                      ? 'numeric text-[0.8125rem]'
                      : 'text-muted-foreground text-[0.8125rem]'
                  }
                >
                  {costText(cost, symbol)}
                </span>
              </SummaryRow>
            </dl>
            <p className="text-muted-foreground mt-2 text-xs leading-snug">
              Collectors pay the mint fee on top of your price. The contract copies these from the Cobweb
              factory when it is created; only Cobweb can change them afterwards. Deploy cost is network gas,
              paid by you.
            </p>
          </>
        ) : fees.status === 'error' ? (
          <Alert variant="destructive" className="mt-3">
            <TriangleAlertIcon aria-hidden="true" />
            <AlertTitle>Could not read the fees</AlertTitle>
            <AlertDescription>
              <p>The factory on {chain.name} did not answer. Deploy stays off until the fees are known.</p>
              <Button variant="secondary" size="xs" onClick={props.onRetryFees} className="mt-1">
                <RotateCwIcon />
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        ) : (
          <div className="mt-3 space-y-2.5" aria-busy="true" aria-label="Reading fees from the factory">
            <Skeleton className="h-4 w-full rounded-sm" />
            <Skeleton className="h-4 w-4/5 rounded-sm" />
            <Skeleton className="h-4 w-3/5 rounded-sm" />
          </div>
        )}
      </div>
    </Panel>
  )
}

function MintPageAddress({ collection }: { collection: Tables<'collections'> }) {
  const state = slugState(collection)
  if (state.kind === 'reserved' || state.kind === 'permanent')
    return (
      <span className="numeric truncate text-[0.8125rem]" title={`cobweb.app/${state.slug}`}>
        cobweb.app/{state.slug}
      </span>
    )
  return (
    <span className="text-destructive-foreground text-[0.8125rem]">
      {state.kind === 'lapsed' ? 'Lapsed. Reserve it again' : 'Reserve one to deploy'}
    </span>
  )
}

function Missing() {
  return <span className="text-destructive-foreground text-[0.8125rem]">Needs a valid address</span>
}
