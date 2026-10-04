import { StagePage } from '@/components/shell/stage-page'
import { UploadScreen } from '@/components/upload/upload-screen'
import { requireOwnedCollection } from '@/lib/auth'
import { getChain, getRenderJob, type RenderJobState } from '@/lib/demo'
import { getStage, type CollectionStatus, type FlowLink } from '@/lib/steps'
import {
  LockedStagePage,
  searchParam,
  stageContext,
  type CollectionParams,
  type SearchParams,
} from '../_lib/stage'

const JOB_STATES: RenderJobState[] = ['locked', 'payment_due', 'rendering', 'done']

/** The render job state that matches the collection's status, until real jobs exist. */
const STATE_FOR_STATUS: Record<CollectionStatus, RenderJobState> = {
  draft: 'locked',
  art_locked: 'payment_due',
  rendering: 'rendering',
  rendered: 'done',
  deployed: 'done',
}

/**
 * Stage 3, Lock and upload. Sample data until the render pipeline exists. In sample-data mode,
 * `?job=locked|payment_due|rendering|done` picks the state to show,
 * `?outcome=rejected|reverted|balance|check-failed|batch-failed` makes the first attempt fail, and
 * `?art=deferred` shows the deferred-art scenario (the placeholder run, MASTER_PLAN, Flow: pre-reveal).
 */
export default async function UploadPage({
  params,
  searchParams,
}: {
  params: CollectionParams
  searchParams: SearchParams
}) {
  const { id } = await params
  const collection = await requireOwnedCollection(id)
  const ctx = stageContext(collection, 'upload', 'upload', { art: await searchParam(searchParams, 'art') })
  if (ctx.access === 'locked') return <LockedStagePage collection={collection} stage="upload" />

  const requested = (await searchParam(searchParams, 'job')) as RenderJobState | undefined
  const state = ctx.demo
    ? requested && JOB_STATES.includes(requested)
      ? requested
      : ctx.artDeferred
        ? 'locked' // "Finish the art later" lands here, on the review with "Reveal later" on
        : 'payment_due'
    : STATE_FOR_STATUS[collection.status]
  const job = getRenderJob(state, { artDeferred: ctx.artDeferred })
  // Keep the sample scenario on the flow links while the art is deferred.
  const scenario = (link?: FlowLink) =>
    ctx.demo && ctx.artDeferred && link ? { ...link, href: `${link.href}?art=deferred` } : link

  return (
    <StagePage
      eyebrow={ctx.eyebrow}
      title="Lock and upload"
      description={
        ctx.artDeferred
          ? 'You are finishing the art later. Lock a placeholder now, render it to IPFS, and deploy on it.'
          : getStage('upload')!.summary
      }
      bodyHasFooter
    >
      {/* The screen renders the footer: Continue unlocks when the upload finishes in client state. */}
      <UploadScreen
        collection={collection}
        job={job}
        chain={getChain(job.quote.chainId)!}
        readOnly={ctx.readOnly}
        artDeferred={ctx.artDeferred}
        previous={scenario(ctx.previous)}
        next={scenario(ctx.next)}
        sampleOutcome={ctx.demo ? await searchParam(searchParams, 'outcome') : undefined}
      />
    </StagePage>
  )
}
