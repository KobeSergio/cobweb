'use client'

import { ArrowUpRightIcon, EyeIcon } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { Address, Hex } from 'viem'
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
import { setMintPagePublished } from '@/app/actions/mint-page'
import type { ActionResult } from '@/lib/art/result'
import type { SupportedChain } from '@/lib/demo'
import type { ManageCall } from '@/lib/manage/phase-calls'
import type { SettingsView } from '@/lib/manage/settings-types'
import { AddressLine } from './bits'
import { count, percent, relativeTo } from './format'
import { saveOffChain } from './manage-sim'
import { UNREADABLE_REASON } from './phase-row'
import { RevealDialog } from './settings-dialogs'

/** What the pointer's Reveal needs: the owner check, the server's confirm and where its fresh view goes. */
type RevealProps = {
  blocked: string | null
  confirm: (hash: Hex, call: ManageCall) => Promise<ActionResult<SettingsView>>
  onConfirmed: (view: SettingsView) => void
}

/**
 * The top of the overview, one compact row: the artwork, minted of supply, the contract, what the
 * contract points at right now (with Reveal), and holders. Minted reads "Not read" while the contract
 * cannot be read (`totalMinted` null); "deployed" is relative to the read's time (`readAt`). Holders is the
 * indexer's count, "Counting" until it has read every block since the deploy, and "Not read" when its view
 * could not be read (docs/specs/2026-10-16-indexer-overview.md, section 7.2).
 */
export function OverviewHeader({
  collectionId,
  avatarUrl,
  name,
  contract,
  deployedAt,
  chain,
  totalMinted,
  maxSupply,
  readAt,
  holders,
  settings,
  ...reveal
}: {
  collectionId: string
  /** The mint page's avatar; the artwork pattern without one. */
  avatarUrl: string | null
  name: string
  contract: Address
  deployedAt: number
  chain: SupportedChain
  totalMinted: number | null
  maxSupply: number
  readAt: number
  holders: number | 'counting' | null
  settings: SettingsView
} & RevealProps) {
  return (
    <section
      aria-label="The drop at a glance"
      className="bg-card shadow-raised flex flex-wrap items-center gap-x-6 gap-y-4 rounded-xl border p-4"
    >
      <Artwork
        src={avatarUrl}
        alt={`${name} artwork`}
        seed={collectionId}
        className="size-14 shrink-0 rounded-lg border"
      />
      <Fact label="Minted" className="w-44 border-l-0 pl-0">
        {totalMinted === null ? (
          <p className="text-muted-foreground text-lg leading-tight">Not read</p>
        ) : (
          <>
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
              value={percent(totalMinted, maxSupply)}
              className="mt-1.5"
              aria-label={`${count(totalMinted)} of ${count(maxSupply)} minted`}
            />
          </>
        )}
      </Fact>
      <Fact
        label={
          <>
            <ChainIcon chainId={chain.id} className="size-3.5" />
            {chain.name}, deployed {relativeTo(deployedAt, readAt)}
          </>
        }
      >
        <AddressLine address={contract} chain={chain} />
      </Fact>
      <ContractPointer settings={settings} chain={chain} {...reveal} />
      <Fact label="Holders">
        {typeof holders === 'number' ? (
          <p className="numeric text-lg leading-tight">{count(holders)}</p>
        ) : (
          <p className="text-muted-foreground text-lg leading-tight">
            {holders === 'counting' ? 'Counting' : 'Not read'}
          </p>
        )}
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

/**
 * The CID of an `ipfs://` link (before the first "/" after it), shortened: `bafybe…7xyz`. Any other link
 * (one set outside Cobweb, `https://` or `ar://`) is shortened whole, so its scheme never stands for it.
 */
function shortCid(uri: string): string {
  if (!uri.startsWith('ipfs://')) return uri.length > 24 ? `${uri.slice(0, 16)}…${uri.slice(-6)}` : uri
  const cid = uri.slice('ipfs://'.length).split('/')[0] ?? ''
  return cid.length > 14 ? `${cid.slice(0, 6)}…${cid.slice(-4)}` : cid
}

/**
 * What the contract's base URI points at (docs/specs/2026-10-15-airdrop-settings.md, section 7.5): the rendered
 * metadata, the placeholder or a custom link, from the settings view. Reveal opens the same dialog as Settings;
 * it is off while the real set is not rendered or the contract cannot be read.
 */
function ContractPointer({
  settings,
  chain,
  blocked,
  confirm,
  onConfirmed,
}: { settings: SettingsView; chain: SupportedChain } & RevealProps) {
  // `at` freezes the view the dialog was opened with, so its text does not flip once it lands.
  const [dialog, setDialog] = useState<{ id: number; at: SettingsView } | null>(null)
  const [open, setOpen] = useState(false)
  // The id of the dialog on screen, if any: a failure that reaches a closed or replaced dialog is toasted.
  const shownId = useRef<number | null>(null)
  shownId.current = dialog && open ? dialog.id : null
  const failedFor = (id: number) => (message: string) => {
    if (shownId.current !== id) toast.error(message)
  }
  const off = !settings.realArtRendered
    ? 'The real art is not rendered yet. Reveal opens once it is on IPFS.'
    : settings.chainReachable
      ? null
      : UNREADABLE_REASON

  return (
    <Fact label="Points at">
      <div className="flex items-center gap-3">
        <p className="text-sm" title={settings.baseUri}>
          {settings.pointer === 'placeholder' ? (
            'Placeholder (unrevealed)'
          ) : (
            <>
              {settings.pointer === 'revealed' ? 'Revealed' : 'Custom'},{' '}
              <span className="numeric">{shortCid(settings.baseUri)}</span>
            </>
          )}
        </p>
        <Button
          variant="secondary"
          size="xs"
          disabled={off !== null}
          title={off ?? undefined}
          onClick={() => {
            setDialog({ id: Date.now(), at: settings })
            setOpen(true)
          }}
        >
          <EyeIcon aria-hidden="true" />
          {settings.pointer === 'placeholder' ? 'Reveal' : 'Change'}
        </Button>
      </div>
      {dialog !== null && (
        <RevealDialog
          key={dialog.id}
          open={open}
          onOpenChange={setOpen}
          chain={chain}
          blocked={blocked}
          confirm={confirm}
          onConfirmed={onConfirmed}
          onFailed={failedFor(dialog.id)}
          current={dialog.at.baseUri}
          targets={dialog.at.targets}
          pointer={dialog.at.pointer}
        />
      )}
    </Fact>
  )
}

/**
 * The mint page link as a plain input with a check/save button, the public/private switch beside
 * it, and a way to open the page. With no link yet the switch is off and disabled; with the row unread
 * (`initialPublished` null) it is off and disabled with a sentence, since its state is not known. The switch
 * writes the mint page's row (sample mode only waits).
 */
export function MintPageLinkBar({
  collection,
  initialPublished,
  sample,
}: {
  collection: AddressCollection
  initialPublished: boolean | null
  sample: boolean
}) {
  const id = useId()
  const [slug, setSlug] = useState(collection.slug)
  const unread = initialPublished === null
  const [published, setPublished] = useState(initialPublished ?? false)
  const [saving, setSaving] = useState(false)

  async function toggle(next: boolean) {
    setPublished(next)
    setSaving(true)
    try {
      if (sample) await saveOffChain()
      else {
        const result = await setMintPagePublished(collection.id, next)
        if (!result.ok) {
          setPublished(!next)
          toast.error(result.error)
          return
        }
      }
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
            checked={!!slug && !unread && published}
            onCheckedChange={toggle}
            disabled={!slug || unread || saving}
            aria-describedby={`${id}-public-help`}
          />
          <div className="grid">
            <label htmlFor={`${id}-public`} className="text-sm font-medium">
              {unread ? 'Public or private' : slug && published ? 'Public' : 'Private'}
            </label>
            <span id={`${id}-public-help`} className="text-muted-foreground text-xs">
              {unread
                ? 'The mint page could not be read. Reload to change it.'
                : !slug
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
