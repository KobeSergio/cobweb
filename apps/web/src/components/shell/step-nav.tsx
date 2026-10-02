'use client'

import Link from 'next/link'
import { useSelectedLayoutSegment } from 'next/navigation'
import { Fragment, useEffect, useRef } from 'react'
import { Step, StepSeparator, type StepState } from '@cobweb/ui/components/step'
import { cn } from '@cobweb/ui/lib/utils'
import { isStepDone, nextStep, STEPS, type CollectionStatus } from '@/lib/steps'

/**
 * The launch flow as a row of steps. Finished steps are ticked, the step to work on is outlined
 * in the accent colour, and the step being viewed is filled.
 */
export function StepNav({ collectionId, status }: { collectionId: string; status: CollectionStatus }) {
  const selected = useSelectedLayoutSegment()
  const upNext = nextStep(status).slug
  const currentRef = useRef<HTMLAnchorElement>(null)

  // On narrow screens the row scrolls; keep the step being viewed in sight.
  useEffect(() => {
    currentRef.current?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  }, [selected])

  return (
    <nav
      aria-label="Launch steps"
      className="scrollbar-hide flex h-14 items-center gap-1 overflow-x-auto border-b px-6"
    >
      {STEPS.map((step, index) => {
        const done = isStepDone(step.slug, status)
        const current = step.slug === selected
        const state: StepState = current
          ? 'current'
          : done
            ? 'done'
            : step.slug === upNext
              ? 'next'
              : 'pending'
        return (
          <Fragment key={step.slug}>
            <Link
              ref={current ? currentRef : undefined}
              href={`/collections/${collectionId}/${step.slug}`}
              aria-current={current ? 'step' : undefined}
              className={cn(
                'hover:bg-accent focus-visible:ring-ring/50 shrink-0 rounded-lg outline-none focus-visible:ring-[3px]',
                current && 'bg-accent',
              )}
            >
              <Step state={state} completed={done}>
                {step.name}
                {done && <span className="sr-only"> (done)</span>}
                {state === 'next' && <span className="sr-only"> (next)</span>}
              </Step>
            </Link>
            {index < STEPS.length - 1 && <StepSeparator />}
          </Fragment>
        )
      })}
    </nav>
  )
}
