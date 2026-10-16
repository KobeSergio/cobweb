import type { Address } from 'viem'
import type { MintSource } from '@/lib/mint/live-source'
import type { MintPageStatic } from '@/lib/mint/page-doc'

/**
 * What the public mint page renders (docs/specs/2026-10-16-mint-page-live-data.md, decision 27): the page's
 * content, read on the server, and in sample mode the source and wallet the browser built from the query
 * (components/mint/sample-page.tsx), so the live page runs none of the sample's code. The chain's state is never
 * in the HTML: the browser's first poll brings it.
 */
export type MintPageProps = {
  page: MintPageStatic
  /** Sample mode; null on live data. */
  sample: SampleMode | null
}

/** Sample mode as the page runs it: the sample source, and the stand-in wallet a `?wallet=` switch connects. */
export type SampleMode = {
  source: MintSource
  /**
   * Connected without a real wallet, starting on another network with `?wallet=wrong-chain`; null follows a real
   * connection.
   */
  wallet: { address: Address; wrongChain: boolean } | null
}
