'use client'

import {
  CheckIcon,
  LayersIcon,
  ListChecksIcon,
  SparklesIcon,
  UploadIcon,
  type LucideIcon,
} from 'lucide-react'
import Link from 'next/link'
import { useSearchParams, useSelectedLayoutSegment } from 'next/navigation'
import { Step } from '@cobweb/ui/components/step'
import { cn } from '@cobweb/ui/lib/utils'
import {
  artSubStepHref,
  artSubSteps,
  isStageDone,
  type ArtSubStepSlug,
  type CollectionStatus,
  type ProjectType,
} from '@/lib/steps'

type Props = {
  collectionId: string
  status: CollectionStatus
  projectType: ProjectType
  /** Sample-data mode: keeps the `?art=deferred` scenario on the links. */
  demo: boolean
  /** "Finish the art later" is on: the Art stage is not done, whatever the status says. */
  artDeferred?: boolean
}

const ICONS: Record<ArtSubStepSlug, LucideIcon> = {
  layers: LayersIcon,
  rules: ListChecksIcon,
  generate: SparklesIcon,
  'upload-assets': UploadIcon,
}

const focusRing = 'outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]'

/**
 * The Art stage's sub-steps (Layers, Rules, Generate). From 1024px a narrow vertical rail on the
 * left of the Art screens; below that a compact segmented control above them. Numbered, the one
 * being viewed highlighted, done ones ticked. A sub-step counts as done once the Art stage is
 * done, or when the creator has moved past it (the sub-steps are taken in order). Rendered by the
 * Art layout, only for project types with more than one sub-step.
 */
export function ArtRail({ collectionId, status, projectType, demo, artDeferred = false }: Props) {
  const selected = useSelectedLayoutSegment()
  const searchParams = useSearchParams()
  const sampleDeferred = demo && searchParams.get('art') === 'deferred'
  const sampleDeployed = demo && searchParams.get('state') === 'deployed'
  const scenario = [sampleDeferred && 'art=deferred', sampleDeployed && 'state=deployed']
    .filter(Boolean)
    .join('&')
  const withScenario = (href: string) => (scenario ? `${href}?${scenario}` : href)

  const subs = artSubSteps(projectType)
  if (subs.length < 2) return null
  const artDone = isStageDone('art', status) && !artDeferred && !sampleDeferred
  const currentIndex = subs.findIndex((sub) => sub.slug === selected)
  const items = subs.map((sub, index) => ({
    ...sub,
    number: index + 1,
    icon: ICONS[sub.slug],
    href: withScenario(artSubStepHref(collectionId, sub.slug)),
    current: index === currentIndex,
    done: artDone || (currentIndex !== -1 && index < currentIndex),
  }))

  return (
    <>
      {/* 1024px and up: the rail. */}
      <nav aria-label="Art steps" className="hidden w-52 shrink-0 border-r lg:block">
        <ol className="sticky top-[var(--workspace-header)] flex flex-col gap-1 px-3 pt-8 pb-6">
          {items.map((item) => (
            <li key={item.slug}>
              <Link
                href={item.href}
                aria-current={item.current ? 'step' : undefined}
                className={cn('hover:bg-accent block rounded-lg', focusRing, item.current && 'bg-accent')}
              >
                <Step
                  state={item.current ? 'current' : item.done ? 'done' : 'pending'}
                  completed={item.done}
                  index={item.number}
                  className="flex w-full"
                >
                  <item.icon
                    aria-hidden="true"
                    className={cn('size-4 shrink-0', item.current ? 'text-foreground' : 'text-faint')}
                  />
                  {item.name}
                  {item.done && <span className="sr-only"> (done)</span>}
                </Step>
              </Link>
            </li>
          ))}
        </ol>
      </nav>

      {/* Below 1024px: a segmented control above the screen. */}
      <nav aria-label="Art steps" className="px-6 pt-6 lg:hidden">
        <ol className="bg-well shadow-inset inline-flex h-10 items-center gap-0.5 rounded-md border p-1">
          {items.map((item) => (
            <li key={item.slug} className="h-full">
              <Link
                href={item.href}
                aria-current={item.current ? 'step' : undefined}
                className={cn(
                  'text-muted-foreground hover:text-foreground flex h-full items-center gap-1.5 rounded-sm px-3 text-sm font-medium whitespace-nowrap transition-[color,background-color,box-shadow] duration-150',
                  focusRing,
                  item.current && 'bg-surface-2 text-foreground shadow-raised',
                )}
              >
                {item.done ? (
                  <CheckIcon aria-hidden="true" className="text-primary size-3.5" strokeWidth={3} />
                ) : (
                  <span aria-hidden="true" className="numeric text-xs">
                    {item.number}
                  </span>
                )}
                {item.name}
                {item.done && <span className="sr-only"> (done)</span>}
              </Link>
            </li>
          ))}
        </ol>
      </nav>
    </>
  )
}
