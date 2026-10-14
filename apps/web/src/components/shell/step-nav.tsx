'use client'

import { LockIcon } from 'lucide-react'
import Link from 'next/link'
import { useSearchParams, useSelectedLayoutSegments } from 'next/navigation'
import { Fragment, useEffect, useRef } from 'react'
import { Step, StepSeparator, type StepState } from '@cobweb/ui/components/step'
import { cn } from '@cobweb/ui/lib/utils'
import { FinishLaterAction } from '@/components/art/finish-later'
import {
  isStageDone,
  isStageReadOnly,
  nextStage,
  stageAccess,
  stageHref,
  STAGES,
  type CollectionStatus,
  type ProjectType,
} from '@/lib/steps'

type Props = {
  collectionId: string
  status: CollectionStatus
  projectType: ProjectType
  /** Sample-data mode: every stage is open. */
  demo: boolean
  /**
   * "Finish the art later" is on (MASTER_PLAN, Flow: pre-reveal): Art carries a "deferred" marker, stays open, and
   * Lock and upload opens without finished art. In sample mode `?art=deferred` also turns it on.
   */
  artDeferred?: boolean
  /** A deferred collection's placeholder job is done: Deploy is open on the draft (`stageAccess`). */
  placeholderReady?: boolean
}

const focusRing = 'outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]'

/**
 * The one stepper of a collection that is not deployed yet: the four build stages. Done stages
 * are ticked, the stage to work on is outlined, the stage being viewed is filled, and stages that
 * cannot be opened yet carry a lock. The Art sub-steps are a rail inside the Art stage
 * (`ArtRail`), not a second row here; Manage drop is not a stage. A deployed collection has no
 * stepper at all (see `WorkspaceNav`). While the Art stage is shown and the art is not deferred,
 * "Finish the art later" sits at the right end of the row.
 */
export function StageNav({
  collectionId,
  status,
  projectType,
  demo,
  artDeferred = false,
  placeholderReady = false,
}: Props) {
  const segments = useSelectedLayoutSegments()
  const [selectedStage] = segments
  const upNext = nextStage(status).slug
  // Sample mode carries the deferred scenario in the URL; keep it on the stage links.
  const searchParams = useSearchParams()
  const sampleDeferred = demo && searchParams.get('art') === 'deferred'
  const deferred = artDeferred || sampleDeferred
  const withScenario = (href: string) => (sampleDeferred ? `${href}?art=deferred` : href)
  const currentRef = useRef<HTMLAnchorElement>(null)
  // Shown while the Art stage is open for editing and the art is not deferred yet.
  const finishLater =
    selectedStage === 'art' && !deferred && !isStageReadOnly(status, 'art', { demo, artDeferred: deferred })

  // On narrow screens the row scrolls; keep the stage being viewed in sight.
  useEffect(() => {
    currentRef.current?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  }, [selectedStage])

  return (
    <div className="flex h-14 items-center gap-4 border-b px-6">
      <nav
        aria-label="Launch stages"
        className="scrollbar-hide flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
      >
        {STAGES.map((stage, index) => {
          const artDeferredHere = deferred && stage.slug === 'art'
          // Deferred art is not done, whatever the status says, until the real set is locked.
          const done = isStageDone(stage.slug, status) && !artDeferredHere
          const current = stage.slug === selectedStage
          const locked =
            stageAccess(status, stage.slug, { demo, artDeferred: deferred, placeholderReady }) === 'locked'
          const state: StepState = current
            ? 'current'
            : done
              ? 'done'
              : stage.slug === upNext
                ? 'next'
                : 'pending'
          return (
            <Fragment key={stage.slug}>
              <Link
                ref={current ? currentRef : undefined}
                href={withScenario(stageHref(collectionId, stage.slug, projectType))}
                aria-current={current ? 'step' : undefined}
                className={cn(
                  'hover:bg-accent shrink-0 rounded-lg',
                  focusRing,
                  current && 'bg-accent',
                  locked && !current && 'opacity-70',
                )}
              >
                <Step state={state} completed={done}>
                  {stage.name}
                  {artDeferredHere && (
                    <span className="text-muted-foreground border-border-strong rounded-full border px-1.5 text-[0.6875rem] leading-4 font-normal">
                      deferred
                    </span>
                  )}
                  {locked && <LockIcon aria-hidden="true" className="text-muted-foreground size-3.5" />}
                  {done && <span className="sr-only"> (done)</span>}
                  {state === 'next' && <span className="sr-only"> (next)</span>}
                  {locked && <span className="sr-only"> (locked)</span>}
                </Step>
              </Link>
              {index < STAGES.length - 1 && <StepSeparator done={done} />}
            </Fragment>
          )
        })}
      </nav>
      {finishLater && (
        <div className="shrink-0">
          <FinishLaterAction collectionId={collectionId} demo={demo} />
        </div>
      )}
    </div>
  )
}

/** @deprecated Renamed to `StageNav`. */
export const StepNav = StageNav
