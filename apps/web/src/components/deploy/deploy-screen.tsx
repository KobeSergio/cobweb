import type { Address } from 'viem'
import type { Tables } from '@/lib/database.types'
import {
  DEMO_CREATOR,
  DEMO_DEFERRED_RENDER_JOBS,
  DEMO_DEPLOYMENT,
  DEMO_MINT_GROUPS,
  DEMO_PUBLIC_MAX_PER_WALLET,
  DEMO_RENDER_JOBS,
} from '@/lib/demo'
import type { DeployChain, DeployRecord, DeployView } from '@/lib/deploy/deploy-types'
import type { FlowLink } from '@/lib/steps'
import { ArtDeferredProvider } from './art-deferred'
import { DeployFlow } from './deploy-flow'

export type DeployScreenProps = {
  collection: Tables<'collections'>
  chains: DeployChain[]
  /** Real mode: what the server read. Null in sample mode. */
  view: DeployView | null
  sample: boolean
  /** Sample mode: `?state=deployed` shows the deployed result instead of the form. */
  sampleDeployed: boolean
  readOnly: boolean
  /** The session's wallet, checksummed. */
  sessionWallet: Address
  /** The flow screens either side, for the footer the screen renders itself. */
  previous?: FlowLink
  next?: FlowLink
  /**
   * Sample mode only (`?outcome=`): makes the first attempt fail, so failure states can be
   * reviewed. rejected | reverted | balance | switch-rejected | fees-error.
   */
  sampleOutcome?: string
  /** "Finish the art later" (MASTER_PLAN, Flow: pre-reveal): the contract starts on the placeholder. */
  artDeferred?: boolean
  /** Whether the mint page is public, for the deployed view's link row; null when its row could not be read. */
  mintPagePublished: boolean | null
}

/** The sample's deployment record: the Night Owls deployment on Base, as `?state=deployed` shows it. */
export function sampleRecord(): DeployRecord {
  return {
    chainId: DEMO_DEPLOYMENT.chainId,
    contractAddress: DEMO_DEPLOYMENT.contractAddress,
    txHash: DEMO_DEPLOYMENT.txHash,
    deployer: DEMO_DEPLOYMENT.deployer,
    deployedAt: DEMO_DEPLOYMENT.deployedAt,
    baseUri: DEMO_DEPLOYMENT.baseUri,
    payout: DEMO_DEPLOYMENT.payoutAddress,
    royaltyBps: DEMO_DEPLOYMENT.royaltyBps,
    royaltyReceiver: DEMO_DEPLOYMENT.royaltyReceiver,
    publicMaxPerWallet: DEMO_PUBLIC_MAX_PER_WALLET,
    fees: DEMO_DEPLOYMENT.fees,
    groups: DEMO_MINT_GROUPS.map((group) => ({
      onchainId: group.id,
      name: group.name,
      priceWei: group.priceWei,
      maxSupply: group.maxSupply,
    })),
  }
}

/**
 * Deploy: the server part. In real mode it hands the flow what `getDeployView` read (the start and
 * real jobs, the paid chain, the fee snapshot, the record). In sample mode the contract starts on the
 * sample placeholder job ("Reveal later") and reveals to the real set, or, with deferred art, has
 * nothing to reveal to yet; `?state=deployed` shows the sample record.
 */
export function DeployScreen({ artDeferred = false, ...props }: DeployScreenProps) {
  const { collection, sample, view } = props
  if (sample) {
    const start = DEMO_DEFERRED_RENDER_JOBS.done
    const real = artDeferred ? null : DEMO_RENDER_JOBS.done
    return (
      <ArtDeferredProvider value={artDeferred}>
        <DeployFlow
          collection={collection}
          chains={props.chains}
          fixedChainId={null}
          initialFees={null}
          startJob={start}
          realJob={real}
          record={props.sampleDeployed ? sampleRecord() : null}
          readOnly={props.readOnly}
          sample
          sampleOutcome={props.sampleOutcome}
          sessionWallet={DEMO_CREATOR}
          artSrc={start.placeholder ? start.placeholder.imageUrl : '/demo/tokens/1.svg'}
          mintPagePublished={props.mintPagePublished}
          previous={props.previous}
          next={props.next}
        />
      </ArtDeferredProvider>
    )
  }
  if (!view) throw new Error('The deploy view is missing.')
  const start = view.jobs.start
  // The placeholder's served file when the contract starts on it, the collage when the real job has one.
  const artSrc =
    start && start.placeholderImageCid !== null && start.placeholder
      ? start.placeholder.imageUrl
      : view.jobs.real?.collageKey
        ? `/api/collections/${collection.id}/collage`
        : null
  return (
    <ArtDeferredProvider value={artDeferred}>
      <DeployFlow
        collection={collection}
        chains={props.chains}
        fixedChainId={view.chainId}
        initialFees={view.fees}
        startJob={start}
        realJob={view.jobs.real}
        record={view.record}
        readOnly={props.readOnly}
        sample={false}
        sessionWallet={props.sessionWallet}
        artSrc={artSrc}
        mintPagePublished={props.mintPagePublished}
        previous={props.previous}
        next={props.next}
      />
    </ArtDeferredProvider>
  )
}
