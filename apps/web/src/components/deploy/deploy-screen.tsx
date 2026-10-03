import type { Tables } from '@/lib/database.types'
import {
  DEMO_CREATOR,
  DEMO_DEFERRED_RENDER_JOBS,
  DEMO_RENDER_JOBS,
  type DeployDraft,
  type Deployment,
  type FeeSnapshot,
  type SupportedChain,
} from '@/lib/demo'
import type { FlowLink } from '@/lib/steps'
import { ArtDeferredProvider } from './art-deferred'
import { DeployFlow } from './deploy-flow'

export type DeployScreenProps = {
  collection: Tables<'collections'>
  chains: SupportedChain[]
  /** The factory's `collectionFees()` per chain id: the snapshot a deploy now would take. */
  factoryFees: Record<number, FeeSnapshot>
  /** Rough deploy cost in wei per chain id. */
  deployCost: Record<number, string>
  /** Starting values for the form. */
  draft: DeployDraft
  /** Set once deployed: show the result instead of the form. */
  deployment: Deployment | null
  readOnly: boolean
  /** The flow screens either side, for the footer the screen renders itself. */
  previous?: FlowLink
  next?: FlowLink
  /**
   * Sample mode only (`?outcome=`): makes the first attempt fail, so failure states can be
   * reviewed. rejected | reverted | balance | switch-rejected | fees-error.
   */
  sampleOutcome?: string
  /**
   * "Finish the art later" (decision D25): the contract starts on the placeholder and the real set
   * is not rendered yet.
   */
  artDeferred?: boolean
}

/**
 * Deploy: choose the chain, set payout, royalties and the public per-wallet cap, review the fee
 * snapshot, then deploy through the factory (simulate first, then send) and show the result.
 *
 * Server part: picks the sample wallet and the rendered art the contract will point at. The
 * contract starts on the placeholder when the render job has one ("Reveal later" or deferred art),
 * else on the real metadata; with deferred art there is no real metadata to reveal to yet.
 * Replaced by: the session's wallet and the collection's finished render job.
 */
export function DeployScreen({ artDeferred = false, ...props }: DeployScreenProps) {
  const job = (artDeferred ? DEMO_DEFERRED_RENDER_JOBS : DEMO_RENDER_JOBS).done
  const startsOn = job.placeholder?.cid ?? job.metadataCid
  return (
    <ArtDeferredProvider value={artDeferred}>
      <DeployFlow
        {...props}
        draft={startsOn ? { ...props.draft, initialBaseUri: `ipfs://${startsOn}` } : props.draft}
        sampleWallet={DEMO_CREATOR}
        artSrc={artDeferred && job.placeholder ? job.placeholder.imageUrl : '/demo/tokens/1.svg'}
        // Empty: the real set is not rendered yet, and the summary says so.
        metadataCid={job.metadataCid ?? ''}
      />
    </ArtDeferredProvider>
  )
}
