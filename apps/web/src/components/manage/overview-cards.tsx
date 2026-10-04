'use client'

import { ArrowUpRightIcon, EyeIcon } from 'lucide-react'
import Link from 'next/link'
import { useId, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@cobweb/ui/components/button'
import { Panel } from '@cobweb/ui/components/panel'
import { StatusBadge } from '@cobweb/ui/components/status-badge'
import { Switch } from '@cobweb/ui/components/switch'
import type { Deployment, SupportedChain } from '@/lib/demo'
import { RevealDialog } from './settings-dialogs'
import { saveOffChain, SAMPLE } from './simulate'

/**
 * The mint page's link with the public/private switch beside it, and the way to the page. With no
 * link yet the switch is off and disabled, and the action sets the link instead.
 */
export function MintPageLinkRow({
  slug,
  initialPublished,
  setLinkHref,
}: {
  slug: string | null
  initialPublished: boolean
  setLinkHref: string
}) {
  const id = useId()
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
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
      <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2">
        <div className="grid min-w-0 gap-0.5">
          <p className="text-muted-foreground text-xs font-medium">Mint page link</p>
          {slug ? (
            <p className="numeric truncate text-sm">cobweb.app/{slug}</p>
          ) : (
            <p className="text-muted-foreground text-sm">No link yet</p>
          )}
        </div>
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
                ? 'Set a link first to make the page public.'
                : published
                  ? 'Anyone with the link can mint.'
                  : 'Visitors see that the page is not available.'}
            </span>
          </div>
        </div>
      </div>
      {slug ? (
        <Button asChild>
          <Link href={`/${slug}`} target="_blank">
            View mint page
            <ArrowUpRightIcon aria-hidden="true" />
          </Link>
        </Button>
      ) : (
        <Button asChild>
          <Link href={setLinkHref}>Set link</Link>
        </Button>
      )}
    </div>
  )
}

/** Reveal from the overview: the same dialog as Settings, with the current state beside it. */
export function RevealCard({
  deployment,
  chain,
  singleAsset,
  realArtRendered,
  className,
}: {
  deployment: Deployment
  chain: SupportedChain
  singleAsset: boolean
  realArtRendered: boolean
  className?: string
}) {
  const [state, setState] = useState({ baseUri: deployment.baseUri, revealed: deployment.revealed })
  const [dialog, setDialog] = useState<number | null>(null)
  const [open, setOpen] = useState(false)

  return (
    <Panel title="Reveal" className={className} bodyClassName="grid gap-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {state.revealed ? (
          <StatusBadge status="done">Revealed</StatusBadge>
        ) : (
          <StatusBadge status="draft">Not revealed</StatusBadge>
        )}
        <Button
          variant="secondary"
          size="sm"
          disabled={!realArtRendered}
          onClick={() => {
            setDialog(Date.now())
            setOpen(true)
          }}
        >
          <EyeIcon aria-hidden="true" />
          {state.revealed ? 'Change metadata' : 'Reveal'}
        </Button>
      </div>
      <p className="text-muted-foreground text-[0.8125rem]">
        {realArtRendered
          ? state.revealed
            ? 'Every token shows its own art and traits.'
            : 'Every token shows the placeholder until you reveal.'
          : 'The real art is not rendered yet. Reveal opens once it is on IPFS.'}
      </p>
      <p className="text-muted-foreground text-[0.8125rem]">
        Base URI <span className="numeric text-foreground break-all">{state.baseUri}</span>
      </p>
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
    </Panel>
  )
}
