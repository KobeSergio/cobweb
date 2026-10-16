import { getAddress } from 'viem'
import { getDeployView } from '@/app/actions/deploy'
import { getMintPageSettings } from '@/app/actions/mint-page'
import { SAMPLE } from '@/components/manage/manage-sim'
import { DeployScreen } from '@/components/deploy/deploy-screen'
import { StagePage } from '@/components/shell/stage-page'
import { requireOwnedCollection, requireUser } from '@/lib/auth'
import { deployChains } from '@/lib/deploy/deploy-core'
import type { DeployView } from '@/lib/deploy/deploy-types'
import {
  LockedStagePage,
  placeholderReady,
  searchParam,
  stageContext,
  type CollectionParams,
  type SearchParams,
} from '../_lib/stage'

/**
 * Stage 4, Deploy (docs/specs/2026-10-14-deploy.md). The server prepares the constructor from the
 * collection and the finished render, the wallet deploys through the factory, and the server records
 * the contract from the factory's event. Sample mode only (`NEXT_PUBLIC_DEMO_DATA=1`):
 * `?state=deployed` shows the deployed result instead of the form,
 * `?outcome=rejected|reverted|balance|switch-rejected|fees-error` makes the first attempt fail, and
 * `?art=deferred` deploys on the placeholder of the deferred-art scenario (MASTER_PLAN, Flow: pre-reveal).
 */
export default async function DeployPage({
  params,
  searchParams,
}: {
  params: CollectionParams
  searchParams: SearchParams
}) {
  const { id } = await params
  const collection = await requireOwnedCollection(id)
  const user = await requireUser()
  // A deferred collection's Deploy opens once its placeholder job is done, with the collection still a draft.
  const ready = await placeholderReady(collection)
  const ctx = stageContext(
    collection,
    'deploy',
    'deploy',
    { art: await searchParam(searchParams, 'art') },
    { placeholderReady: ready },
  )
  if (ctx.access === 'locked') return <LockedStagePage collection={collection} stage="deploy" />

  const sampleDeployed = ctx.demo && (await searchParam(searchParams, 'state')) === 'deployed'
  let view: DeployView | null = null
  if (!ctx.demo) {
    const result = await getDeployView(collection.id)
    if (!result.ok) throw new Error(result.error)
    view = result.data
  }
  const deployed = ctx.demo ? sampleDeployed : view !== null && view.record !== null
  // The deployed view's link row opens the page once it is public.
  const mintPage = !ctx.demo && deployed ? await getMintPageSettings(collection.id) : null
  const mintPagePublished = ctx.demo ? SAMPLE.mintPage.published : !!(mintPage?.ok && mintPage.data.published)

  return (
    <StagePage
      // Once deployed there is no stepper, so no "Stage 4 of 4" either: this is the receipt.
      eyebrow={deployed ? undefined : ctx.eyebrow}
      title="Deploy"
      description={
        deployed
          ? 'The contract is live. Its receipt, and where to go next.'
          : 'Set royalties, the payout address and the launch phases, and deploy the contract from your wallet.'
      }
      width="wide"
      bodyHasFooter
    >
      {/* The screen renders the footer: Deploy is its action, and Manage drop opens once deployed. */}
      <DeployScreen
        collection={collection}
        chains={deployChains()}
        view={view}
        sample={ctx.demo}
        sampleDeployed={sampleDeployed}
        readOnly={ctx.readOnly}
        artDeferred={ctx.artDeferred}
        sessionWallet={getAddress(user.walletAddress)}
        previous={ctx.previous}
        next={ctx.next}
        sampleOutcome={ctx.demo ? await searchParam(searchParams, 'outcome') : undefined}
        mintPagePublished={mintPagePublished}
      />
    </StagePage>
  )
}
