'use client'

import { useMemo, useSyncExternalStore } from 'react'
import { DEMO_MINTER } from '@/lib/demo'
import type { MintPageStatic } from '@/lib/mint/page-doc'
import { MintPage } from './mint-page'
import { MintPageSkeleton } from './mint-page-skeleton'
import { sampleMintSource, sampleSwitchesOf } from './sample-source'
import type { SampleMode } from './types'

const subscribe = () => () => {}

/**
 * The sample page: its switches come from the browser's own location, read once it has hydrated, so the route
 * renders the same HTML for every query and stays cached by link. The page's skeleton shows until then. The
 * sample source and its stand-in wallet are built here, so `lib/demo` runs in sample mode only.
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
  // `?type=` shows the page as another project type, to the source and the page alike.
  const shown = useMemo(
    () => (switches?.type ? { ...page, projectType: switches.type } : page),
    [page, switches],
  )
  const sample = useMemo<SampleMode | null>(
    () =>
      switches && {
        source: sampleMintSource(shown, switches),
        wallet: switches.wallet
          ? { address: DEMO_MINTER, wrongChain: switches.wallet === 'wrong-chain' }
          : null,
      },
    [shown, switches],
  )
  if (!sample) return <MintPageSkeleton />
  return <MintPage page={shown} sample={sample} />
}
