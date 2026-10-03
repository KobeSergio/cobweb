'use client'

import { ChevronRightIcon, LockIcon } from 'lucide-react'
import Link from 'next/link'
import { useSearchParams, useSelectedLayoutSegments } from 'next/navigation'
import { Fragment, useEffect, useRef } from 'react'
import { Step, StepSeparator, type StepState } from '@cobweb/ui/components/step'
import { cn } from '@cobweb/ui/lib/utils'
import { ManageNav } from '@/components/shell/manage-nav'
import {
  artSubStepHref,
  artSubSteps,
  isStageDone,
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
   * "Finish the art later" is on (decision D25): Art carries a "deferred" marker, stays open, and
   * Lock and upload opens without finished art. In sample mode `?art=deferred` also turns it on.
   */
  artDeferred?: boolean
}

const focusRing = 'outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]'

/**
 * The launch flow for one collection. The top row is the five stages: done stages are ticked,
 * the stage to work on is outlined, the stage being viewed is filled, and stages that cannot be
 * opened yet carry a lock. Inside Art a second row shows its sub-steps; inside Manage drop, its tabs.
 */
export function StageNav({ collectionId, status, projectType, demo, artDeferred = false }: Props) {
  const segments = useSelectedLayoutSegments()
  const [selectedStage, selectedSub] = segments
  const upNext = nextStage(status).slug
  // Sample mode carries the deferred scenario in the URL; keep it on the stage links.
  const searchParams = useSearchParams()
  const sampleDeferred = demo && searchParams.get('art') === 'deferred'
  const deferred = artDeferred || sampleDeferred
  const withScenario = (href: string) => (sampleDeferred ? `${href}?art=deferred` : href)
  const currentRef = useRef<HTMLAnchorElement>(null)

  // On narrow screens the row scrolls; keep the stage being viewed in sight.
  useEffect(() => {
    currentRef.current?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  }, [selectedStage])

  return (
    <div className="border-b">
      <nav
        aria-label="Launch stages"
        className="scrollbar-hide flex h-14 items-center gap-1 overflow-x-auto px-6"
      >
        {STAGES.map((stage, index) => {
          const artDeferredHere = deferred && stage.slug === 'art'
          // Deferred art is not done, whatever the status says, until the real set is locked.
          const done = isStageDone(stage.slug, status) && !artDeferredHere
          const current = stage.slug === selectedStage
          const locked = stageAccess(status, stage.slug, { demo, artDeferred: deferred }) === 'locked'
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
              {index < STAGES.length - 1 && <StepSeparator />}
            </Fragment>
          )
        })}
      </nav>

      {selectedStage === 'art' && (
        <ArtSubNav
          collectionId={collectionId}
          projectType={projectType}
          selected={selectedSub}
          withScenario={withScenario}
        />
      )}
      {selectedStage === 'manage' && <ManageNav collectionId={collectionId} />}
    </div>
  )
}

/** The Art stage's sub-steps, numbered, as a second row. One screen for non-generative projects. */
function ArtSubNav({
  collectionId,
  projectType,
  selected,
  withScenario,
}: {
  collectionId: string
  projectType: ProjectType
  selected: string | undefined
  withScenario: (href: string) => string
}) {
  const subs = artSubSteps(projectType)
  if (subs.length < 2) return null
  return (
    <nav
      aria-label="Art steps"
      className="bg-card/40 flex h-11 items-center gap-1 overflow-x-auto border-t px-6"
    >
      {subs.map((sub, index) => {
        const current = sub.slug === selected
        return (
          <Fragment key={sub.slug}>
            <Link
              href={withScenario(artSubStepHref(collectionId, sub.slug))}
              aria-current={current ? 'step' : undefined}
              className={cn(
                'text-muted-foreground hover:text-foreground hover:bg-accent flex h-8 shrink-0 items-center gap-2 rounded-md px-2.5 text-sm font-medium',
                focusRing,
                current && 'text-foreground bg-accent',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'flex size-5 items-center justify-center rounded-full border text-xs tabular-nums',
                  current ? 'border-primary text-primary' : 'border-border-strong',
                )}
              >
                {index + 1}
              </span>
              {sub.name}
            </Link>
            {index < subs.length - 1 && (
              <ChevronRightIcon aria-hidden="true" className="text-muted-foreground size-4 shrink-0" />
            )}
          </Fragment>
        )
      })}
    </nav>
  )
}

/** @deprecated Renamed to `StageNav`. */
export const StepNav = StageNav
