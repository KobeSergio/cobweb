'use client'

import dynamic from 'next/dynamic'
import { MintPageSkeleton } from './mint-page-skeleton'

/**
 * The sample page on a chunk of its own (sample-page.tsx), for the two routes that render it: a route that imported
 * it directly would ship `lib/demo`'s data in every live visitor's download. It renders only in the browser, as the
 * sample page reads its switches from the location there anyway; the skeleton shows until it loads. `ssr: false`
 * needs a client module, which is why this one exists.
 */
export const LazySampleMintPage = dynamic(
  () => import('./sample-page').then((loaded) => loaded.SampleMintPage),
  {
    ssr: false,
    loading: () => <MintPageSkeleton />,
  },
)
