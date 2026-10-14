'use client'

import { useQuery } from '@tanstack/react-query'
import { ExternalLinkIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { StatusBadge } from '@cobweb/ui/components/status-badge'
import { ChainName } from '@/components/chains/chain-icon'
import { StageFooter } from '@/components/shell/stage-footer'
import type { ReviewData } from '@/lib/art/lock-review'
import { THROWN } from '@/lib/art/result'
import { chainView } from '@/lib/chain/chain-view'
import { explorerTxUrl, formatNative, formatUtc, shortAddress } from '@/lib/demo/helpers'
import type { RenderJob } from '@/lib/demo/types'
import type { FlowLink } from '@/lib/steps'
import { DoneStep } from './done-step'
import { PayStep } from './pay-step'
import { Dot, ProgressionItem, type ProgressionState } from './progression'
import { follows, pollInterval, renderView } from './render-follow'
import { RenderStep } from './render-step'
import type { RevealLaterState } from './reveal-later'
import { ReviewStep } from './review-step'
import { realActions } from './upload-actions'
import { resultOf } from './upload-shared'
import { sampleActions, type LockOptions, type UploadOutcome } from './upload-sim'

type Stage = 'review' | 'pay' | 'render' | 'done'

const ORDER: Stage[] = ['review', 'pay', 'render', 'done']

const STAGE_FOR_JOB: Record<RenderJob['state'], Stage> = {
  locked: 'review',
  payment_due: 'pay',
  paid: 'render',
  waived: 'render',
  rendering: 'render',
  finalizing: 'render',
  failed: 'render',
  done: 'done',
}

/** The static collage sample mode shows on the done step. */
const SAMPLE_COLLAGE = '/demo/collage.svg'

export type UploadFlowProps = {
  collectionId: string
  /** `collections.chain_id`: the quote is on it when set, otherwise on the chain the wallet is on at lock. */
  collectionChainId: number | null
  job: RenderJob
  /** The job to fall back to after an unlock: nothing locked yet. */
  pending: RenderJob
  review: ReviewData
  sample: boolean
  /** Sample mode: the done job the scripted render ends on. Null in real mode. */
  sampleDone: Extract<RenderJob, { state: 'done' }> | null
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

/**
 * The four states of Lock and upload as one vertical progression. The job from the server sets where
 * it starts; review, lock, pay, unlock and retry run through `realActions` (sample mode:
 * `sampleActions`). While a job renders the flow polls `reload` through React Query
 * (docs/specs/2026-10-14-render-screen-wiring.md, section 9), 3 seconds apart for two minutes and 15
 * after, and settles each job it gets; the stage always comes from the job.
 */
export function UploadFlow({
  collectionId,
  collectionChainId,
  job: initialJob,
  pending,
  review,
  sample,
  sampleDone,
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
    () =>
      sample && sampleDone
        ? sampleActions(initialJob, { outcome, done: sampleDone })
        : realActions(collectionId),
    [sample, sampleDone, initialJob, outcome, collectionId],
  )
  const [job, setJob] = useState(initialJob)
  const [stage, setStage] = useState<Stage>(STAGE_FOR_JOB[initialJob.state])
  // The stage as a ref too, so settle can tell a change from an unchanged poll inside an effect.
  const stageRef = useRef(stage)
  // When the render stage was entered (or the last retry made), for the poll's slow-down after two minutes.
  const since = useRef(Date.now())
  // "Reveal later": forced on for deferred art, and on whenever the job already has a placeholder.
  const [reveal, setReveal] = useState<RevealLaterState>(() =>
    revealFrom(initialJob, deferred, placeholderDescription),
  )
  const placeholderOn = reveal.on && reveal.file !== null
  const [lockOptions, setLockOptions] = useState<LockOptions>(initialJob.lockOptions)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  // Sample mode: an unlock after a failed render shows the review's credit line, as the server would.
  const [creditAfterUnlock, setCreditAfterUnlock] = useState(false)
  const chain = chainView(job.quote.chainId)
  const paymentTx = 'payment' in job ? (job.payment?.txHash ?? null) : null
  const free = job.quote.totalWei === '0'
  const view = renderView(job, Math.floor(Date.now() / 1000))
  const collageUrl =
    job.state === 'done' && job.collageKey
      ? sample
        ? SAMPLE_COLLAGE
        : `/api/collections/${collectionId}/collage`
      : null
  const result = job.state === 'done' ? resultOf(job, { collageUrl }) : null
  const total = formatNative(job.quote.totalWei, chain.nativeSymbol, 8)
  const current = ORDER.indexOf(stage)
  const stateOf = (item: Stage): ProgressionState => {
    const index = ORDER.indexOf(item)
    return index < current ? 'done' : index === current ? 'current' : 'pending'
  }
  // The last state shows its body while it is the current one, and stays open once done.
  const doneState: ProgressionState = stage === 'done' ? 'current' : 'pending'

  /**
   * A job from the server: show the step its state belongs to. The server page (the stepper, the Art
   * screens) is refreshed when the stage changes or the job ends, never on an ordinary poll.
   */
  function settle(nextJob: RenderJob) {
    const nextStage = STAGE_FOR_JOB[nextJob.state]
    const changed = nextStage !== stageRef.current
    if (changed && nextStage === 'render') since.current = Date.now()
    stageRef.current = nextStage
    setJob(nextJob)
    setStage(nextStage)
    if (!sample && (changed || nextJob.state === 'done' || nextJob.state === 'failed')) router.refresh()
  }

  function unlocked() {
    stageRef.current = 'review'
    setJob(pending)
    setStage('review')
    setActionError(null)
    if (!sample) router.refresh()
  }

  const poll = useQuery({
    queryKey: ['render-job', collectionId],
    queryFn: async () => {
      const answer = await actions.reload()
      if (!answer.ok) throw new Error(answer.error)
      return answer.data
    },
    enabled: follows(job.state),
    refetchInterval: () => pollInterval(job.state, Date.now() - since.current),
    staleTime: 0,
    // The interval is the retry, and a job cached from an earlier mount must not settle over this one.
    retry: false,
    gcTime: 0,
  })
  const polled = poll.data
  // React Query keeps an unchanged job the same reference, so an unchanged poll settles nothing.
  useEffect(() => {
    if (polled) settle(polled)
  }, [polled])

  async function retry() {
    setBusy(true)
    setActionError(null)
    try {
      const answer = await actions.retry()
      if (answer.ok) {
        since.current = Date.now()
        settle(answer.data)
      } else {
        setActionError(answer.error)
      }
    } catch {
      setActionError(THROWN)
    } finally {
      setBusy(false)
    }
  }

  async function unlockFailed() {
    setBusy(true)
    setActionError(null)
    try {
      const answer = await actions.unlock()
      if (answer.ok) {
        if (sample) setCreditAfterUnlock(true)
        unlocked()
      } else {
        setActionError(answer.error)
      }
    } catch {
      setActionError(THROWN)
    } finally {
      setBusy(false)
    }
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
            review={sample && creditAfterUnlock ? { ...review, credit: true } : review}
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
            job.credited ? (
              'No fee: covered by the credit from the render that failed'
            ) : free ? (
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
                <span className="numeric">{view.total}</span> batches
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
            view={view}
            readOnly={readOnly}
            placeholder={placeholderOn}
            placeholderOnly={deferred}
            busy={busy}
            actionError={actionError}
            connectionLost={poll.isError}
            onRetry={retry}
            onUnlock={unlockFailed}
          />
        </ProgressionItem>

        <ProgressionItem
          index={4}
          title="Ready to deploy"
          state={doneState}
          status={<StatusBadge status="done">Uploaded</StatusBadge>}
          last
        >
          {result && <DoneStep result={result} tokenCount={job.tokenCount} />}
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
