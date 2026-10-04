'use client'

import { RadioIcon } from 'lucide-react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { manageTabHref } from '@/lib/steps'

/**
 * Above the Art screens of a deployed collection whose art is deferred: the drop is already live
 * on the placeholder, and the art is finished here and revealed from Settings. One line, no
 * stepper. Renders nothing otherwise. Sample mode reads the `?art=deferred` scenario.
 */
export function ArtLiveNotice({
  collectionId,
  deployed,
  demo,
  artDeferred = false,
}: {
  collectionId: string
  deployed: boolean
  demo: boolean
  artDeferred?: boolean
}) {
  const searchParams = useSearchParams()
  const sampleDeferred = demo && searchParams.get('art') === 'deferred'
  if (!deployed || !(artDeferred || sampleDeferred)) return null
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
