'use client'

import { ArchiveIcon, RadioIcon } from 'lucide-react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { manageTabHref } from '@/lib/steps'

/**
 * Above the Art screens of a deployed collection whose art is deferred: the drop is already live
 * on the placeholder, and the art is finished here and revealed from Settings. One line, no
 * stepper. Above those of a deployed collection whose original files the source sweep deleted, the
 * line says so (docs/specs/2026-10-17-production-hardening.md, section 7.3). Renders nothing
 * otherwise. Sample mode reads `?art=deferred&state=deployed`, and `?sources=deleted` for the second.
 */
export function ArtLiveNotice({
  collectionId,
  deployed,
  demo,
  artDeferred = false,
  sourcesDeleted,
}: {
  collectionId: string
  deployed: boolean
  demo: boolean
  artDeferred?: boolean
  sourcesDeleted: boolean
}) {
  const searchParams = useSearchParams()
  if ((deployed && sourcesDeleted) || (demo && searchParams.get('sources') === 'deleted'))
    return (
      <p
        role="note"
        className="text-muted-foreground flex min-h-10 items-center gap-2 border-b px-6 py-2 text-[0.8125rem]"
      >
        <ArchiveIcon aria-hidden="true" className="text-faint size-4 shrink-0" />
        <span className="min-w-0">
          The original art files were deleted 90 days after the deploy. The rendered art and its metadata stay
          on IPFS.
        </span>
      </p>
    )
  const sampleDeferred = demo && searchParams.get('art') === 'deferred'
  const sampleDeployed = demo && searchParams.get('state') === 'deployed'
  if (!(deployed || sampleDeployed) || !(artDeferred || sampleDeferred)) return null
  const settings = manageTabHref(collectionId, 'settings')

  return (
    <p
      role="note"
      className="text-muted-foreground flex min-h-10 items-center gap-2 border-b px-6 py-2 text-[0.8125rem]"
    >
      <RadioIcon aria-hidden="true" className="text-faint size-4 shrink-0" />
      <span className="min-w-0">
        Your drop is live on the placeholder. Finish the art here, then reveal it from{' '}
        <Link
          href={sampleDeferred ? `${settings}?art=deferred` : settings}
          className="text-foreground focus-visible:ring-ring/50 rounded-sm underline underline-offset-4 outline-none focus-visible:ring-[3px]"
        >
          Settings
        </Link>
        .
      </span>
    </p>
  )
}
