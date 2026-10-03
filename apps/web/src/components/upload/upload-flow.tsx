'use client'

import { ExternalLinkIcon } from 'lucide-react'
import { useState } from 'react'
import { StatusBadge } from '@cobweb/ui/components/status-badge'
import { explorerTxUrl, formatNative, formatUtc, shortAddress } from '@/lib/demo/helpers'
import type { Hex, RenderJob, SupportedChain } from '@/lib/demo/types'
import type { FlowLink } from '@/lib/steps'
import { StageFooter } from '@/components/shell/stage-footer'
import { DoneStep } from './done-step'
import { PayStep } from './pay-step'
import { Dot, ProgressionItem, type ProgressionState } from './progression'
import { RenderStep } from './render-step'
import type { RevealLaterState } from './reveal-later'
import { ReviewStep } from './review-step'
import { RENDER_BATCH_SIZE, type RenderProgress, type UploadOutcome } from './upload-sim'
import type { ArtSummary, RenderResult } from './upload-shared'

type Stage = 'review' | 'pay' | 'render' | 'done'

const ORDER: Stage[] = ['review', 'pay', 'render', 'done']

const STAGE_FOR_JOB: Record<RenderJob['state'], Stage> = {
  locked: 'review',
  payment_due: 'pay',
  rendering: 'render',
  done: 'done',
}

export type UploadFlowProps = {
  job: RenderJob
  chain: SupportedChain
  art: ArtSummary
  /** CIDs to finish on when the simulated render completes. Its placeholder CID stands in for any file picked. */
  sampleResult: RenderResult
  /** The description saved with the job's placeholder, when it has one. */
  placeholderDescription: string
  /** "Finish the art later" (decision D25): this run locks and renders the placeholder alone. */
  deferred: boolean
  readOnly: boolean
  previous?: FlowLink
  next?: FlowLink
  outcome?: UploadOutcome
}

/**
 * The four states of Lock and upload as one vertical progression. The job from the server sets
 * where it starts; from there the transitions run in client state through `upload-sim`.
 */
export function UploadFlow({
  job,
  chain,
  art,
  sampleResult,
  placeholderDescription,
  deferred,
  readOnly,
  previous,
  next,
  outcome,
}: UploadFlowProps) {
  const [stage, setStage] = useState<Stage>(STAGE_FOR_JOB[job.state])
  // "Reveal later": forced on for deferred art, and on whenever the job already has a placeholder.
  const [reveal, setReveal] = useState<RevealLaterState>(() => ({
    on: deferred || job.placeholder !== null,
    forced: deferred,
    file: job.placeholder
      ? {
          url: job.placeholder.imageUrl,
          fileName: `placeholder.${job.placeholder.mediaType === 'video' ? 'mp4' : job.placeholder.mediaType === 'gif' ? 'gif' : 'svg'}`,
          mediaType: job.placeholder.mediaType,
          bytes: null,
          owned: false,
        }
      : null,
    description: job.placeholder ? placeholderDescription : '',
  }))
  const placeholderOn = reveal.on && reveal.file !== null
  const [lockedAt, setLockedAt] = useState(job.lockedAt)
  const [paymentTx, setPaymentTx] = useState<Hex | null>('payment' in job ? job.payment.txHash : null)
  const [renderStart] = useState<RenderProgress>(() =>
    'batches' in job
      ? { phase: 'images', ...job.batches }
      : {
          phase: 'images',
          total: Math.ceil(job.tokenCount / RENDER_BATCH_SIZE),
          done: 0,
          size: RENDER_BATCH_SIZE,
        },
  )
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
              <span className="numeric">{formatUtc(lockedAt)}</span>
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
              {!deferred && placeholderOn && (
                <>
                  <Dot />
                  Reveal later
                </>
              )}
            </>
          }
        >
          <ReviewStep
            tokenCount={job.tokenCount}
            art={art}
            readOnly={readOnly}
            previous={previous}
            outcome={outcome}
            deferred={deferred}
            reveal={reveal}
            onReveal={setReveal}
            onLocked={(at) => {
              setLockedAt(at)
              setStage('pay')
            }}
          />
        </ProgressionItem>

        <ProgressionItem
          index={2}
          title={deferred ? 'Pay for the placeholder' : 'Pay the generation fee'}
          state={stateOf('pay')}
          status={<StatusBadge status="draft">Payment due</StatusBadge>}
          receipt={
            <>
              Paid <span className="numeric text-foreground/85">{total}</span> on {chain.name}
              {paymentTx && (
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
          }
        >
          <PayStep
            quote={job.quote}
            chain={chain}
            readOnly={readOnly}
            outcome={outcome}
            deferred={deferred}
            onPaid={(txHash) => {
              setPaymentTx(txHash)
              setStage('render')
            }}
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
