'use client'

import { XIcon } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Button } from '@cobweb/ui/components/button'
import { Sheet, SheetContent, SheetTitle } from '@cobweb/ui/components/sheet'
import type { GeneratedToken } from '@/lib/demo'
import { useMediaQuery } from '../lib/use-media-query'
import { TokenDetail, type TokenDetailProps } from './token-detail'

/** At and above this width the detail docks beside the gallery; below it, it is a bottom sheet. */
export const DOCKED_QUERY = '(min-width: 1024px)'

type Props = Omit<TokenDetailProps, 'token' | 'Heading'> & { token: GeneratedToken | null }

function PlainHeading(props: { id?: string; className?: string; children?: React.ReactNode }) {
  return <h3 {...props} />
}

/**
 * The token detail as a side panel, not a centred modal. On wide screens it is docked to the right
 * of the gallery (the gallery stays visible and clickable: clicking another token shows it here);
 * below 1024px it is a bottom sheet. Escape or the close button closes it.
 */
export function TokenPanel(props: Props) {
  const docked = useMediaQuery(DOCKED_QUERY)
  const { token, onOpen } = props

  if (docked) return token ? <DockedPanel {...props} token={token} /> : null

  return (
    <Sheet open={!!token} onOpenChange={(open) => !open && onOpen(null)}>
      <SheetContent
        side="bottom"
        aria-describedby={undefined}
        className="max-h-[88dvh] overflow-y-auto rounded-t-xl p-5 sm:p-6"
      >
        {token && <TokenDetail key={token.id} {...props} token={token} Heading={SheetTitle} />}
      </SheetContent>
    </Sheet>
  )
}

function DockedPanel(props: Props & { token: GeneratedToken }) {
  const { token, onOpen } = props
  const ref = useRef<HTMLElement>(null)
  // Move focus into the panel when it opens, not on every token: walking the gallery keeps focus there.
  useEffect(() => {
    ref.current?.focus({ preventScroll: true })
  }, [])

  return (
    <aside
      ref={ref}
      tabIndex={-1}
      aria-labelledby="token-detail-title"
      onKeyDown={(event) => {
        // React events bubble out of portals: ignore Escape from an open select's list.
        if (event.key === 'Escape' && ref.current?.contains(event.target as Node)) onOpen(null)
      }}
      className="bg-card sticky top-4 max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-xl border p-5 shadow-raised outline-none"
    >
      <Button
        variant="ghost"
        size="icon-sm"
        className="absolute top-4 right-4"
        onClick={() => onOpen(null)}
        aria-label="Close token detail"
      >
        <XIcon />
      </Button>
      <TokenDetail key={token.id} {...props} Heading={PlainHeading} />
    </aside>
  )
}
