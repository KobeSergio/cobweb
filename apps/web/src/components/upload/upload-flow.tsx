'use client'

import { ExternalLinkIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { StatusBadge } from '@cobweb/ui/components/status-badge'
import { ChainName } from '@/components/chains/chain-icon'
import { StageFooter } from '@/components/shell/stage-footer'
import type { ReviewData } from '@/lib/art/lock-review'
import { chainView } from '@/lib/chain/chain-view'
import { explorerTxUrl, formatNative, formatUtc, shortAddress } from '@/lib/demo/helpers'
import type { RenderJob } from '@/lib/demo/types'
import type { FlowLink } from '@/lib/steps'
import { DoneStep } from './done-step'
import { PayStep } from './pay-step'
import { Dot, ProgressionItem, type ProgressionState } from './progression'
import { RENDER_BATCH_SIZE, type RenderProgress } from './render-sim'
import { RenderStep } from './render-step'
import type { RevealLaterState } from './reveal-later'
import { ReviewStep } from './review-step'
import { realActions } from './upload-actions'
import type { RenderResult } from './upload-shared'
import { sampleActions, type LockOptions, type UploadOutcome } from './upload-sim'

type Stage = 'review' | 'pay' | 'render' | 'done'

const ORDER: Stage[] = ['review', 'pay', 'render', 'done']

const STAGE_FOR_JOB: Record<RenderJob['state'], Stage> = {
  locked: 'review',
  payment_due: 'pay',
  paid: 'render',
  waived: 'render',
  rendering: 'render',
  failed: 'render',
  done: 'done',
}

export type UploadFlowProps = {
  collectionId: string
  /** `collections.chain_id`: the quote is on it when set, otherwise on the chain the wallet is on at lock. */
  collectionChainId: number | null
  job: RenderJob
  /** The job to fall back to after an unlock: nothing locked yet. */
  pending: RenderJob
  review: ReviewData
  sample: boolean
  /** CIDs to finish on when the simulated render completes. Its placeholder CID stands in for any file picked. */
  sampleResult: RenderResult
  /** The description saved with the job's placeholder, when it has one. */
  placeholderDescription: string
  /** "Finish the art later" (MASTER_PLAN, Flow: pre-reveal): this run locks and renders the placeholder alone. */
  deferred: boolean
  /** A 1/1 or single asset project (no Generate step). */
  assetsFlow: boolean
  readOnly: boolean
  previous?: FlowLink
  next?: FlowLink
  outcome?: UploadOutcome
}

function revealFrom(job: RenderJob, deferred: boolean, description: string): RevealLaterState {
  const placeholder = job.placeholder
  const extension =
    placeholder?.mediaType === 'video' ? 'mp4' : placeholder?.mediaType === 'gif' ? 'gif' : 'png'
  return {
    on: deferred || placeholder !== null,
    forced: deferred,
    file: placeholder
      ? {
          url: placeholder.imageUrl,
          fileName: `placeholder.${extension}`,
          mediaType: placeholder.mediaType,
          bytes: null,
          owned: false,
          ...(placeholder.uploadId ? { uploadId: placeholder.uploadId } : {}),
        }
      : null,
    description: placeholder ? description : '',
  }
}

function renderStartOf(job: RenderJob): RenderProgress {
  return 'batches' in job
    ? { phase: 'images', ...job.batches }
    : {
        phase: 'images',
        total: Math.max(1, Math.ceil(job.tokenCount / RENDER_BATCH_SIZE)),
        done: 0,
        size: RENDER_BATCH_SIZE,
      }
}

/**
 * The four states of Lock and upload as one vertical progression. The job from the server sets
 * where it starts; review, lock, pay and unlock then run through `realActions` (sample mode:
 * `sampleActions`), and rendering is simulated until Phase 4 (render-sim.ts).
 */
export function UploadFlow({
  collectionId,
  collectionChainId,
  job: initialJob,
  pending,
  review,
  sample,
  sampleResult,
  placeholderDescription,
  deferred,
  assetsFlow,
  readOnly,
  previous,
  next,
  outcome,
}: UploadFlowProps) {
  const router = useRouter()
  const actions = useMemo(
    () => (sample ? sampleActions(initialJob) : realActions(collectionId)),
    [sample, initialJob, collectionId],
  )
  const [job, setJob] = useState(initialJob)
  const [stage, setStage] = useState<Stage>(STAGE_FOR_JOB[initialJob.state])
  // "Reveal later": forced on for deferred art, and on whenever the job already has a placeholder.
  const [reveal, setReveal] = useState<RevealLaterState>(() =>
    revealFrom(initialJob, deferred, placeholderDescription),
  )
  const placeholderOn = reveal.on && reveal.file !== null
  const [lockOptions, setLockOptions] = useState<LockOptions>(initialJob.lockOptions)
  const chain = chainView(job.quote.chainId)
  const paymentTx = 'payment' in job ? (job.payment?.txHash ?? null) : null
  const free = job.quote.totalWei === '0'
  const renderStart = renderStartOf(job)
  const result: RenderResult =
    job.state === 'done'
      ? job
      : {
          imagesCid: deferred ? null : sampleResult.imagesCid,
          metadataCid: deferred ? null : sampleResult.metadataCid,
          placeholder:
            placeholderOn && reveal.file
              ? {
                  cid: sampleResult.placeholder?.cid ?? '',
                  mediaType: reveal.file.mediaType,
                  imageUrl: reveal.file.url,
                }
              : null,
        }
  const total = formatNative(job.quote.totalWei, chain.nativeSymbol, 8)
  const current = ORDER.indexOf(stage)
  const stateOf = (item: Stage): ProgressionState => {
    const index = ORDER.indexOf(item)
    return index < current ? 'done' : index === current ? 'current' : 'pending'
  }
  // The last state shows its body while it is the current one, and stays open once done.
  const doneState: ProgressionState = stage === 'done' ? 'current' : 'pending'

  /** A job from the server: show the step its state belongs to, and refresh the stepper and the Art screens. */
  function settle(nextJob: RenderJob) {
    setJob(nextJob)
    setStage(STAGE_FOR_JOB[nextJob.state])
    if (!sample) router.refresh()
  }

  function unlocked() {
    setJob(pending)
    setStage('review')
    if (!sample) router.refresh()
  }

  return (
    <div className="flex flex-1 flex-col">
      <ol aria-label="Lock and upload progress" className="pb-10">
        <ProgressionItem
          index={1}
          title="Review and lock"
          state={stateOf('review')}
          receipt={
            <>
              {deferred ? 'Placeholder locked' : 'Locked'}{' '}
              <span className="numeric">{formatUtc(job.lockedAt)}</span>
              <Dot />
              {deferred ? (
                'Real art later, from Art'
              ) : (
                <>
                  Token list hash{' '}
                  <span className="numeric" title={job.tokenListHash}>
                    {shortAddress(job.tokenListHash, 6)}
                  </span>
                </>
              )}
              {!deferred && (
                <>
                  <Dot />
                  {placeholderOn ? 'Reveal later' : 'Reveal at mint'}
                </>
              )}
              {!deferred && lockOptions.allowDuplicates && (
                <>
                  <Dot />
                  Identical tokens allowed
                </>
              )}
            </>
          }
        >
          <ReviewStep
            review={review}
            previews={sample}
            readOnly={readOnly}
            previous={previous}
            deferred={deferred}
            reveal={reveal}
            onReveal={setReveal}
            lockOptions={lockOptions}
            onLockOptions={setLockOptions}
            actions={actions}
            collectionChainId={collectionChainId}
            sample={sample}
            assetsFlow={assetsFlow}
            onLocked={settle}
          />
        </ProgressionItem>

        <ProgressionItem
          index={2}
          title={deferred ? 'Placeholder fee' : 'Pay the generation fee'}
          state={stateOf('pay')}
          status={<StatusBadge status="draft">Payment due</StatusBadge>}
          receipt={
            free ? (
              deferred ? (
                'No fee for the placeholder'
              ) : (
                'No fee'
              )
            ) : (
              <>
                Paid <span className="numeric text-foreground/85">{total}</span> on{' '}
                <ChainName chain={chain} iconClassName="size-3.5" />
                {paymentTx && chain.explorerUrl && (
                  <>
                    <Dot />
                    <a
                      href={explorerTxUrl(chain, paymentTx)}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:text-foreground inline-flex items-center gap-1 underline-offset-4 hover:underline"
                    >
                      <span className="numeric">{shortAddress(paymentTx, 6)}</span>
                      <ExternalLinkIcon aria-hidden="true" className="size-3" />
                      <span className="sr-only">View payment on the explorer (new tab)</span>
                    </a>
                  </>
                )}
              </>
            )
          }
        >
          <PayStep
            job={job}
            chain={chain}
            readOnly={readOnly}
            sample={sample}
            outcome={outcome}
            actions={actions}
            onPaid={settle}
            onUnlocked={unlocked}
            onRequoted={setJob}
          />
        </ProgressionItem>

        <ProgressionItem
          index={3}
          title={deferred ? 'Render the placeholder' : 'Render and upload'}
          state={stateOf('render')}
          status={<StatusBadge status="pending">Rendering</StatusBadge>}
          receipt={
            deferred ? (
              'Placeholder pinned to IPFS'
            ) : (
              <>
                <span className="numeric">{job.tokenCount.toLocaleString('en-US')}</span> images and metadata
                pinned to IPFS
                <Dot />
                <span className="numeric">{renderStart.total}</span> batches
                {placeholderOn && (
                  <>
                    <Dot />
                    Placeholder pinned
                  </>
                )}
              </>
            )
          }
        >
          <RenderStep
            tokenCount={job.tokenCount}
            start={renderStart}
            readOnly={readOnly}
            outcome={outcome}
            placeholder={placeholderOn}
            placeholderOnly={deferred}
            onDone={() => setStage('done')}
          />
        </ProgressionItem>

        <ProgressionItem
          index={4}
          title="Ready to deploy"
          state={doneState}
          status={<StatusBadge status="done">Uploaded</StatusBadge>}
          last
        >
          <DoneStep result={result} tokenCount={job.tokenCount} />
        </ProgressionItem>
      </ol>

      <StageFooter previous={previous} next={stage === 'done' ? next : undefined}>
        {stage !== 'done' && (
          <p className="text-muted-foreground text-sm">Deploy opens once the upload finishes.</p>
        )}
      </StageFooter>
    </div>
  )
}
