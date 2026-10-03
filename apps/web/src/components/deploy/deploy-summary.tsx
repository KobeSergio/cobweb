'use client'

import { RotateCwIcon, TriangleAlertIcon } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@cobweb/ui/components/alert'
import { Artwork } from '@cobweb/ui/components/artwork'
import { Button } from '@cobweb/ui/components/button'
import { Panel } from '@cobweb/ui/components/panel'
import { Skeleton } from '@cobweb/ui/components/skeleton'
import { slugState } from '@/lib/collections'
import type { Tables } from '@/lib/database.types'
import { formatBps, formatNative, shortAddress } from '@/lib/demo/helpers'
import type { Address, FeeSnapshot, SupportedChain } from '@/lib/demo/types'
import { CopyValue, SummaryRow } from './copy-value'
import type { FactoryRead } from './deploy-sim'

export type SummaryProps = {
  collection: Tables<'collections'>
  chain: SupportedChain | null
  fees: FeeSnapshot | undefined
  deployCostWei: string | undefined
  factory: FactoryRead
  predicted: Address | null
  payout: Address | null
  royaltyBps: number | null
  royaltyReceiver: Address | null
  /** The base URI the contract starts on: the placeholder with "Reveal later" or deferred art. */
  baseUri: string
  /** The real metadata the reveal points at, or empty when the art is deferred and not rendered yet. */
  metadataCid: string
  artSrc: string
}

/** What a mint costs collectors on top of the price, for a chain's fee snapshot. */
export function mintFeeText(fees: FeeSnapshot, symbol: string): string {
  return `${formatNative(fees.mintFeeFlatWei, symbol, 8)} + ${formatBps(fees.mintFeeBps)} of price`
}

/** The live summary beside the form: what will be deployed, where, and what it costs. */
export function DeploySummary(props: SummaryProps) {
  const { collection, chain, fees, deployCostWei, factory, predicted, artSrc } = props
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
            <span className="numeric">{collection.max_supply.toLocaleString('en-US')}</span> tokens ·{' '}
            {chain ? chain.name : 'No chain yet'}
          </p>
        </div>
      </div>

      <dl className="divide-y px-5">
        <SummaryRow label="Contract address">
          {predicted ? (
            <CopyValue value={predicted} label="Contract address" display={shortAddress(predicted, 6)} />
          ) : (
            <span className="text-muted-foreground text-[0.8125rem]">Fill in the settings</span>
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
        <SummaryRow label="Mint page">
          <MintPageAddress collection={collection} />
        </SummaryRow>
        <SummaryRow label="Starts on">
          <span className="numeric truncate text-[0.8125rem]" title={props.baseUri}>
            {props.baseUri.replace(/^(ipfs:\/\/.{10}).*(.{6})$/, '$1…$2')}
          </span>
        </SummaryRow>
        <SummaryRow label="Reveals to">
          {props.metadataCid ? (
            <span className="numeric text-[0.8125rem]" title={`ipfs://${props.metadataCid}`}>
              {`ipfs://${props.metadataCid.slice(0, 10)}…${props.metadataCid.slice(-6)}`}
            </span>
          ) : (
            <span className="text-muted-foreground text-[0.8125rem]">Not rendered yet</span>
          )}
        </SummaryRow>
      </dl>
      {predicted && (
        <p className="text-muted-foreground border-t px-5 py-3 text-xs leading-snug">
          The address is the same on every chain. It changes if you change a setting above.
        </p>
      )}

      <div className="bg-surface-2/40 border-t px-5 pt-4 pb-5">
        <h3 className="text-sm font-medium">Platform fees</h3>
        {!chain ? (
          <p className="text-muted-foreground mt-2 text-[0.8125rem]">Choose a chain to see its fees.</p>
        ) : factory.status === 'loading' ? (
          <div className="mt-3 space-y-2.5" aria-busy="true" aria-label="Reading fees from the factory">
            <Skeleton className="h-4 w-full rounded-sm" />
            <Skeleton className="h-4 w-4/5 rounded-sm" />
            <Skeleton className="h-4 w-3/5 rounded-sm" />
          </div>
        ) : factory.status === 'error' || !fees ? (
          <Alert variant="destructive" className="mt-3">
            <TriangleAlertIcon aria-hidden="true" />
            <AlertTitle>Could not read the fees</AlertTitle>
            <AlertDescription>
              <p>The factory on {chain.name} did not answer. Deploy stays off until the fees are known.</p>
              <Button variant="secondary" size="xs" onClick={factory.retry} className="mt-1">
                <RotateCwIcon />
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <dl className="mt-1 divide-y">
              <SummaryRow label="Per token minted">
                <span className="numeric text-[0.8125rem]">{mintFeeText(fees, symbol)}</span>
              </SummaryRow>
              <SummaryRow label="Per token airdropped">
                <span className="numeric text-[0.8125rem]">
                  {formatNative(fees.airdropFeePerTokenWei, symbol, 8)}
                </span>
              </SummaryRow>
              <SummaryRow label="Deploy cost">
                {deployCostWei ? (
                  <span className="numeric text-[0.8125rem]">
                    about {formatNative(deployCostWei, symbol, 6)}
                  </span>
                ) : (
                  <span className="text-muted-foreground text-[0.8125rem]">No estimate</span>
                )}
              </SummaryRow>
            </dl>
            <p className="text-muted-foreground mt-2 text-xs leading-snug">
              Collectors pay the mint fee on top of your price. The contract copies these from the Cobweb
              factory when it is created; only Cobweb can change them afterwards. Deploy cost is network gas,
              paid by you.
            </p>
          </>
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
    <span className="text-muted-foreground text-[0.8125rem]">
      {state.kind === 'lapsed' ? 'Lapsed, none yet' : 'None yet'}
    </span>
  )
}

function Missing() {
  return <span className="text-destructive-foreground text-[0.8125rem]">Needs a valid address</span>
}
