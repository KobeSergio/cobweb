import { DeployScreen } from '@/components/deploy/deploy-screen'
import { StagePage } from '@/components/shell/stage-page'
import { requireOwnedCollection } from '@/lib/auth'
import {
  DEMO_DEPLOY_COST_ESTIMATE,
  DEMO_DEPLOY_DRAFT,
  DEMO_DEPLOYMENT,
  DEMO_FACTORY_FEES,
  SUPPORTED_CHAINS,
} from '@/lib/demo'
import {
  LockedStagePage,
  searchParam,
  stageContext,
  type CollectionParams,
  type SearchParams,
} from '../_lib/stage'

/**
 * Stage 4, Deploy. Sample data until deployment is wired. In sample-data mode `?state=deployed`
 * shows the deployed result instead of the form, and
 * `?outcome=rejected|reverted|balance|switch-rejected|fees-error` makes the first attempt fail, and
 * `?art=deferred` deploys on the placeholder of the deferred-art scenario (decision D25).
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
  const ctx = stageContext(collection, 'deploy', 'deploy', { art: await searchParam(searchParams, 'art') })
  if (ctx.access === 'locked') return <LockedStagePage collection={collection} stage="deploy" />

  const deployed = ctx.demo
    ? (await searchParam(searchParams, 'state')) === 'deployed'
    : collection.status === 'deployed'

  return (
    <StagePage
      eyebrow={ctx.eyebrow}
      title="Deploy"
      description="Choose a chain, set royalties and the payout address, and deploy the contract from your wallet."
      sampleNotice={ctx.sampleNotice}
      width="wide"
      bodyHasFooter
    >
      {/* The screen renders the footer: Deploy is its action, and Continue unlocks once deployed. */}
      <DeployScreen
        collection={collection}
        chains={SUPPORTED_CHAINS}
        factoryFees={DEMO_FACTORY_FEES}
        deployCost={DEMO_DEPLOY_COST_ESTIMATE}
        draft={DEMO_DEPLOY_DRAFT}
        deployment={deployed ? DEMO_DEPLOYMENT : null}
        readOnly={ctx.readOnly}
        artDeferred={ctx.artDeferred}
        previous={ctx.previous}
        next={ctx.next}
        sampleOutcome={ctx.demo ? await searchParam(searchParams, 'outcome') : undefined}
      />
    </StagePage>
  )
}
