'use client'

import { ArrowUpRightIcon, EyeIcon } from 'lucide-react'
import { useId, useState } from 'react'
import { toast } from 'sonner'
import { Artwork } from '@cobweb/ui/components/artwork'
import { Badge } from '@cobweb/ui/components/badge'
import { Button } from '@cobweb/ui/components/button'
import { Progress } from '@cobweb/ui/components/progress'
import { Switch } from '@cobweb/ui/components/switch'
import { cn } from '@cobweb/ui/lib/utils'
import { ChainIcon } from '@/components/chains/chain-icon'
import {
  MintPageAddressField,
  type AddressCollection,
} from '@/components/collections/mint-page-address-field'
import type { Deployment, SupportedChain } from '@/lib/demo'
import { AddressLine } from './bits'
import { count, percent, relativeTo } from './format'
import { RevealDialog } from './settings-dialogs'
import { saveOffChain, SAMPLE } from './manage-sim'

/**
 * The top of the overview, one compact row: the artwork, minted of supply, the contract, what the
 * contract points at right now (with Reveal), and holders.
 */
export function OverviewHeader({
  collectionId,
  name,
  deployment,
  chain,
  totalMinted,
  maxSupply,
  holders,
  singleAsset,
  realArtRendered,
}: {
  collectionId: string
  name: string
  deployment: Deployment
  chain: SupportedChain
  totalMinted: number
  maxSupply: number
  holders: number
  singleAsset: boolean
  realArtRendered: boolean
}) {
  const share = percent(totalMinted, maxSupply)
  return (
    <section
      aria-label="The drop at a glance"
      className="bg-card shadow-raised flex flex-wrap items-center gap-x-6 gap-y-4 rounded-xl border p-4"
    >
      <Artwork
        src={SAMPLE.mintPage.avatarUrl}
        alt={`${name} artwork`}
        seed={collectionId}
        className="size-14 shrink-0 rounded-lg border"
      />
      <Fact label="Minted" className="w-44 border-l-0 pl-0">
        <p className="numeric flex items-center gap-2 text-lg leading-tight">
          <span>
            {count(totalMinted)}
            <span className="text-muted-foreground text-sm"> / {count(maxSupply)}</span>
          </span>
          {maxSupply > 0 && totalMinted >= maxSupply && (
            <Badge variant="success" className="h-5 font-sans">
              Sold out
            </Badge>
          )}
        </p>
        <Progress
          size="sm"
          value={share}
          className="mt-1.5"
          aria-label={`${count(totalMinted)} of ${count(maxSupply)} minted`}
        />
      </Fact>
      <Fact
        label={
          <>
            <ChainIcon chainId={chain.id} className="size-3.5" />
            {chain.name}, deployed {relativeTo(deployment.deployedAt, SAMPLE.readAt)}
          </>
        }
      >
        <AddressLine address={deployment.contractAddress} chain={chain} />
      </Fact>
      <ContractPointer
        deployment={deployment}
        chain={chain}
        singleAsset={singleAsset}
        realArtRendered={realArtRendered}
      />
      <Fact label="Holders">
        <p className="numeric text-lg leading-tight">{count(holders)}</p>
      </Fact>
    </section>
  )
}

function Fact({
  label,
  className,
  children,
}: {
  label: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn('grid min-w-0 gap-1 border-l pl-6', className)}>
      <p className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">{label}</p>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

/** `ipfs://bafy...xyz/` as `bafybe…7xyz`. */
function shortCid(uri: string): string {
  const cid = uri.replace(/^ipfs:\/\//, '').replace(/\/$/, '')
  return cid.length > 14 ? `${cid.slice(0, 6)}…${cid.slice(-4)}` : cid
}

/**
 * What the contract's base URI points at: the placeholder until the reveal, then the rendered
 * set. Reveal opens the same dialog as Settings; it is off while the real set is not rendered.
 */
function ContractPointer({
  deployment,
  chain,
  singleAsset,
  realArtRendered,
}: {
  deployment: Deployment
  chain: SupportedChain
  singleAsset: boolean
  realArtRendered: boolean
}) {
  const [state, setState] = useState({ baseUri: deployment.baseUri, revealed: deployment.revealed })
  const [dialog, setDialog] = useState<number | null>(null)
  const [open, setOpen] = useState(false)

  return (
    <Fact label="Points at">
      <div className="flex items-center gap-3">
        <p className="text-sm" title={state.baseUri}>
          {state.revealed ? (
            <>
              Revealed, <span className="numeric">{shortCid(state.baseUri)}</span>
            </>
          ) : (
            'Placeholder (unrevealed)'
          )}
        </p>
        <Button
          variant="secondary"
          size="xs"
          disabled={!realArtRendered}
          title={
            realArtRendered ? undefined : 'The real art is not rendered yet. Reveal opens once it is on IPFS.'
          }
          onClick={() => {
            setDialog(Date.now())
            setOpen(true)
          }}
        >
          <EyeIcon aria-hidden="true" />
          {state.revealed ? 'Change' : 'Reveal'}
        </Button>
      </div>
      {dialog !== null && (
        <RevealDialog
          key={dialog}
          open={open}
          onOpenChange={setOpen}
          chain={chain}
          currentUri={state.baseUri}
          metadataCid={SAMPLE.metadataCid}
          singleAsset={singleAsset}
          onApply={(baseUri) => setState({ baseUri, revealed: true })}
        />
      )}
    </Fact>
  )
}

/**
 * The mint page link as a plain input with a check/save button, the public/private switch beside
 * it, and a way to open the page. With no link yet the switch is off and disabled.
 */
export function MintPageLinkBar({
  collection,
  initialPublished,
}: {
  collection: AddressCollection
  initialPublished: boolean
}) {
  const id = useId()
  const [slug, setSlug] = useState(collection.slug)
  const [published, setPublished] = useState(initialPublished)
  const [saving, setSaving] = useState(false)

  async function toggle(next: boolean) {
    setPublished(next)
    setSaving(true)
    try {
      // SEAM: the mint page settings server action (session and ownership checked) writes `published`.
      await saveOffChain()
      toast.success(next ? 'Mint page is public' : 'Mint page is private')
    } catch {
      setPublished(!next)
      toast.error('The mint page could not be updated. Try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section aria-label="Mint page" className="flex flex-wrap items-start gap-x-8 gap-y-4">
      <div className="min-w-0 flex-1 basis-96">
        <MintPageAddressField
          collection={{ ...collection, slug }}
          inline
          onSaved={(value) => setSlug(value.slug)}
        />
      </div>
      <div className="flex items-center gap-4 pt-7">
        <div className="flex items-center gap-2.5">
          <Switch
            id={`${id}-public`}
            checked={!!slug && published}
            onCheckedChange={toggle}
            disabled={!slug || saving}
            aria-describedby={`${id}-public-help`}
          />
          <div className="grid">
            <label htmlFor={`${id}-public`} className="text-sm font-medium">
              {slug && published ? 'Public' : 'Private'}
            </label>
            <span id={`${id}-public-help`} className="text-muted-foreground text-xs">
              {!slug
                ? 'Save a link first.'
                : published
                  ? 'Anyone with the link can mint.'
                  : 'Visitors see it is not available.'}
            </span>
          </div>
        </div>
        {slug && (
          <Button variant="ghost" size="sm" asChild>
            <a href={`/${slug}`} target="_blank" rel="noreferrer">
              Open mint page
              <ArrowUpRightIcon aria-hidden="true" />
            </a>
          </Button>
        )}
      </div>
    </section>
  )
}
