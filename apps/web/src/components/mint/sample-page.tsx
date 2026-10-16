'use client'

import { useMemo, useSyncExternalStore } from 'react'
import type { MintPageStatic } from '@/lib/mint/page-doc'
import { MintPage } from './mint-page'
import { MintPageSkeleton } from './mint-page-skeleton'
import { sampleSwitchesOf } from './sample-source'

const subscribe = () => () => {}

/**
 * The sample page: its switches come from the browser's own location, read once it has hydrated, so the route
 * renders the same HTML for every query and stays cached by link. The page's skeleton shows until then.
 */
export function SampleMintPage({ page }: { page: MintPageStatic }) {
  const search = useSyncExternalStore(
    subscribe,
    () => window.location.search,
    () => null,
  )
  const switches = useMemo(
    () => (search === null ? null : sampleSwitchesOf(new URLSearchParams(search))),
    [search],
  )
  if (!switches) return <MintPageSkeleton />
  return <MintPage page={page} sample={switches} />
}
