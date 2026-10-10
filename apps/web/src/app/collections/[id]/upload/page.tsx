import { getRenderJob, reviewArt } from '@/app/actions/lock'
import { StagePage } from '@/components/shell/stage-page'
import { UploadScreen } from '@/components/upload/upload-screen'
import { loadPlaceholder } from '@/lib/art/load'
import type { ReviewData } from '@/lib/art/lock-review'
import { pendingJob } from '@/lib/art/render-job'
import { requireOwnedCollection } from '@/lib/auth'
import type { Tables } from '@/lib/database.types'
import { getRenderJob as sampleRenderJob, type RenderJob, type SampleJobState } from '@/lib/demo'
import { getStage, type FlowLink } from '@/lib/steps'
import {
  LockedStagePage,
  searchParam,
  stageContext,
  type CollectionParams,
  type SearchParams,
} from '../_lib/stage'

const SAMPLE_STATES: SampleJobState[] = ['locked', 'payment_due', 'rendering', 'done']

type View = { job: RenderJob; pending: RenderJob; review: ReviewData | null }

/** Sample mode: `?job=` picks the state; deferred art opens on the review with Reveal later on. */
async function sampleView(searchParams: SearchParams, artDeferred: boolean): Promise<View> {
  const requested = (await searchParam(searchParams, 'job')) as SampleJobState | undefined
  const state: SampleJobState =
    requested && SAMPLE_STATES.includes(requested) ? requested : artDeferred ? 'locked' : 'payment_due'
  return {
    job: sampleRenderJob(state, { artDeferred }),
    pending: sampleRenderJob('locked', { artDeferred }),
    review: null,
  }
}

/** Real mode: the job (or nothing locked yet) and the review of the stored art. */
async function realView(collection: Tables<'collections'>, artDeferred: boolean): Promise<View> {
  const [jobResult, reviewResult, placeholder] = await Promise.all([
    getRenderJob(collection.id),
    artDeferred ? Promise.resolve(null) : reviewArt(collection.id),
    loadPlaceholder(collection.id),
  ])
  if (!jobResult.ok) throw new Error(jobResult.error)
  if (reviewResult && !reviewResult.ok) throw new Error(reviewResult.error)
  const pending = pendingJob(collection.chain_id, placeholder)
  return { job: jobResult.data ?? pending, pending, review: reviewResult ? reviewResult.data : null }
}

/**
 * Stage 3, Lock and upload (docs/specs/2026-10-09-lock-and-pay.md, section 8). Review, lock, pay and
 * unlock are real; rendering is simulated until Phase 4. Sample mode only (`NEXT_PUBLIC_DEMO_DATA=1`):
 * `?job=locked|payment_due|rendering|done` picks the state,
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

  const view = ctx.demo
    ? await sampleView(searchParams, ctx.artDeferred)
    : await realView(collection, ctx.artDeferred)
  // Keep the sample scenario on the flow links while the art is deferred.
  const scenario = (link?: FlowLink) =>
    ctx.demo && ctx.artDeferred && link ? { ...link, href: `${link.href}?art=deferred` } : link

  return (
    <StagePage
      eyebrow={ctx.eyebrow}
      title="Lock and upload"
      description={
        ctx.artDeferred
          ? 'You are finishing the art later. Lock a placeholder now, at no cost, render it to IPFS, and deploy on it.'
          : getStage('upload')!.summary
      }
      bodyHasFooter
    >
      {/* The screen renders the footer: Continue unlocks when the upload finishes in client state. */}
      <UploadScreen
        collection={collection}
        job={view.job}
        pending={view.pending}
        review={view.review}
        sample={ctx.demo}
        readOnly={ctx.readOnly}
        artDeferred={ctx.artDeferred}
        previous={scenario(ctx.previous)}
        next={scenario(ctx.next)}
        sampleOutcome={ctx.demo ? await searchParam(searchParams, 'outcome') : undefined}
      />
    </StagePage>
  )
}
