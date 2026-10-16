import type { MintPageStatic } from '@/lib/mint/page-doc'
import type { SampleSwitches } from './sample-source'

/**
 * What the public mint page renders (docs/specs/2026-10-16-mint-page-live-data.md, decision 27): the page's
 * content, read on the server, and in sample mode the query switches, from which the browser builds the sample
 * source. The chain's state is never in the HTML: the browser's first poll brings it.
 */
export type MintPageProps = {
  page: MintPageStatic
  /** Sample mode's switches; null on live data. */
  sample: SampleSwitches | null
}
