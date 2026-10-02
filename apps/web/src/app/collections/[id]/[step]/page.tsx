import { ArrowLeftIcon, ArrowRightIcon } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Button } from '@cobweb/ui/components/button'
import { requireOwnedCollection } from '@/lib/auth'
import { PROJECT_TYPES } from '@/lib/collections'
import { getStep, STEPS } from '@/lib/steps'

type Props = { params: Promise<{ id: string; step: string }> }

/**
 * One step of the launch flow. Every step is a placeholder for now: it says what the step is for
 * and what will be built here, so the whole flow can be walked end to end.
 */
export default async function StepPage({ params }: Props) {
  const { id, step: stepSlug } = await params
  const collection = await requireOwnedCollection(id)
  const step = getStep(stepSlug)
  if (!step) notFound()

  const index = STEPS.findIndex((entry) => entry.slug === step.slug)
  const previous = STEPS[index - 1]
  const next = STEPS[index + 1]
  const type = PROJECT_TYPES.find((entry) => entry.value === collection.project_type)

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 p-6 py-10">
      <header className="space-y-2">
        <p className="text-muted-foreground text-sm font-medium tabular-nums">
          Step {index + 1} of {STEPS.length}
        </p>
        <h2 className="text-2xl font-semibold">{step.name}</h2>
        <p className="text-muted-foreground text-base text-pretty">{step.summary}</p>
      </header>

      {step.slug === 'details' && (
        <dl className="bg-card grid grid-cols-[10rem_1fr] gap-x-6 gap-y-3 rounded-lg border p-5 text-sm">
          <dt className="text-muted-foreground">Name</dt>
          <dd>{collection.name}</dd>
          <dt className="text-muted-foreground">Symbol</dt>
          <dd className="font-mono text-[0.8125rem]">{collection.symbol}</dd>
          <dt className="text-muted-foreground">Type</dt>
          <dd>{type?.name}</dd>
          <dt className="text-muted-foreground">Supply</dt>
          <dd className="tabular-nums">{collection.max_supply.toLocaleString('en-US')}</dd>
          <dt className="text-muted-foreground">Mint page address</dt>
          <dd className="font-mono text-[0.8125rem]">cobweb.app/{collection.slug}</dd>
        </dl>
      )}

      <section className="rounded-lg border border-dashed p-5">
        <h3 className="text-sm font-medium">Not built yet</h3>
        <p className="text-muted-foreground mt-1 text-sm text-pretty">Coming here: {step.upcoming}</p>
      </section>

      <footer className="mt-auto flex items-center justify-between border-t pt-6">
        {previous ? (
          <Button asChild variant="ghost">
            <Link href={`/collections/${collection.id}/${previous.slug}`}>
              <ArrowLeftIcon />
              {previous.name}
            </Link>
          </Button>
        ) : (
          <span />
        )}
        {next && (
          <Button asChild variant="secondary">
            <Link href={`/collections/${collection.id}/${next.slug}`}>
              {next.name}
              <ArrowRightIcon />
            </Link>
          </Button>
        )}
      </footer>
    </div>
  )
}
