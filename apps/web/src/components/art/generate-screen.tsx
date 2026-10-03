'use client'

import { CircleAlertIcon, RefreshCwIcon, SparklesIcon, TriangleAlertIcon } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@cobweb/ui/components/alert'
import { Button } from '@cobweb/ui/components/button'
import { Progress } from '@cobweb/ui/components/progress'
import { Stat, StatGroup } from '@cobweb/ui/components/stat'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@cobweb/ui/components/tabs'
import type { Tables } from '@/lib/database.types'
import type { ArtRule, GeneratedToken, Layer, TraitCounts } from '@/lib/demo'
import { artSubStepHref, flowNeighbours } from '@/lib/steps'
import { ConfirmDialog, type ConfirmRequest } from './confirm-dialog'
import { DeferredArtNotice, FinishLaterAction } from './finish-later'
import { Composite } from './composite'
import { GenerateFooter } from './generate/generate-footer'
import { StatsView } from './generate/stats-view'
import { TokenGallery } from './generate/token-gallery'
import { useGenerator } from './generate/use-generator'
import { ReadOnlyNotice } from './read-only-notice'
import { compositeUrls } from './lib/trait-index'

export type GenerateScreenProps = {
  collection: Tables<'collections'>
  layers: Layer[]
  rules: ArtRule[]
  /** The generated set, ranked (1 is rarest). Tokens 1 to 24 have `previewUrl`; stack `tokenLayerUrls(dna)` for others. */
  tokens: GeneratedToken[]
  traitCounts: TraitCounts
  readOnly: boolean
  /** "Finish the art later" is on (MASTER_PLAN, Flow: pre-reveal): the contract starts on a placeholder. */
  artDeferred?: boolean
  /** Offer "Finish the art later". Sample mode only until Phase 3 stores the deferred flag. */
  canDefer?: boolean
}

const n = (value: number) => value.toLocaleString('en-US')

/**
 * Art, step 3 (generative): generate the set, then review and curate it: a paged gallery with
 * rarity rank, trait filters, token detail with trait changes checked against the rules, select
 * mode for regenerate, shuffle and delete, and a statistics view.
 */
export function GenerateScreen({
  collection,
  layers,
  rules,
  tokens: seedTokens,
  readOnly,
  artDeferred = false,
  canDefer = false,
}: GenerateScreenProps) {
  const supply = collection.max_supply
  const generator = useGenerator(collection.id, collection.name, supply, {
    layers,
    rules,
    tokens: seedTokens,
  })
  const { tokens, generating, progress, problems, conflicts } = generator
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const { previous, next } = flowNeighbours(collection.id, collection.project_type, 'art/generate')
  const skipped = generator.rules.length - generator.active.length
  const count = tokens?.length ?? 0

  const askRegenerate = () =>
    setConfirm({
      title: `Regenerate all ${n(supply)} tokens?`,
      body: ['A new set replaces this one. Trait changes, swaps and deletions you made are not kept.'],
      confirmLabel: 'Regenerate all',
      onConfirm: generator.generate,
    })

  const blockedReason =
    !tokens || count === 0
      ? 'Generate the collection before locking it.'
      : count !== supply
        ? `The set has ${n(count)} of ${n(supply)} tokens. Fill it to the supply first.`
        : generator.breaking.length > 0
          ? 'Some tokens break the rules. Regenerate them first.'
          : null

  const sample = tokens?.[0]

  return (
    <div className="flex flex-1 flex-col gap-6">
      {readOnly && <ReadOnlyNotice what="the generated tokens" />}
      {artDeferred && <DeferredArtNotice collectionId={collection.id} />}

      {/* The control strip: where the set stands, and the one generate action. */}
      <section aria-label="Generation" className="bg-card overflow-hidden rounded-xl border shadow-raised">
        <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:gap-6 sm:p-6">
          <Composite
            urls={sample ? compositeUrls(sample.dna, generator.index) : []}
            alt={sample ? `${sample.name}, the first token` : 'No tokens yet'}
            seed={collection.id}
            className="hidden size-20 shrink-0 rounded-lg border sm:block"
          />
          <StatGroup className="flex-1 gap-x-8">
            <Stat label="Tokens" value={n(count)} suffix={`/ ${n(supply)}`} />
            <Stat label="Layers" value={n(generator.layers.length)} />
            <Stat
              label="Rules applied"
              value={n(generator.active.length)}
              suffix={`/ ${n(generator.rules.length)}`}
              hint={skipped ? `${n(skipped)} skipped for a conflict` : undefined}
            />
          </StatGroup>
          {!readOnly && tokens && count > 0 && (
            <Button variant="secondary" onClick={askRegenerate} disabled={generating}>
              <RefreshCwIcon />
              Regenerate all
            </Button>
          )}
        </div>
        {generating && (
          <div className="space-y-2 border-t px-6 py-4" role="status">
            <p className="text-sm">
              Generating <span className="numeric">{n(supply)}</span> tokens
            </p>
            <Progress value={progress} aria-label="Generation progress" />
          </div>
        )}
      </section>

      {problems.length > 0 && (
        <Alert variant="destructive">
          <CircleAlertIcon aria-hidden="true" />
          <AlertTitle>The set could not be generated</AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-1 pl-4">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
            <p className="mt-2">
              Fix it on{' '}
              <Link
                className="text-foreground underline underline-offset-2"
                href={artSubStepHref(collection.id, 'layers')}
              >
                Layers
              </Link>{' '}
              or{' '}
              <Link
                className="text-foreground underline underline-offset-2"
                href={artSubStepHref(collection.id, 'rules')}
              >
                Rules
              </Link>
              , then generate again.
            </p>
          </AlertDescription>
        </Alert>
      )}

      {conflicts.length > 0 && !readOnly && (
        <Alert variant="warning">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertTitle>
            {skipped === 1 ? '1 rule is' : `${n(skipped)} rules are`} skipped because of a conflict
          </AlertTitle>
          <AlertDescription>
            Generation keeps the first rule of each conflict.{' '}
            <Link
              className="text-foreground underline underline-offset-2"
              href={artSubStepHref(collection.id, 'rules')}
            >
              Review the conflicts on Rules
            </Link>
            .
          </AlertDescription>
        </Alert>
      )}

      {!readOnly &&
        tokens &&
        count > 0 &&
        (generator.staleNote || generator.breaking.length > 0 || count !== supply) && (
          <Alert variant="warning">
            <RefreshCwIcon aria-hidden="true" />
            <AlertTitle>The set needs attention</AlertTitle>
            <AlertDescription className="space-y-3">
              <ul className="list-disc space-y-1 pl-4">
                {generator.staleNote && <li>{generator.staleNote}</li>}
                {generator.breaking.length > 0 && (
                  <li>
                    <span className="numeric">{n(generator.breaking.length)}</span> tokens break the current
                    rules. They are marked in the grid.
                  </li>
                )}
                {count !== supply && (
                  <li>
                    The set has <span className="numeric">{n(count)}</span> tokens; the supply is{' '}
                    <span className="numeric">{n(supply)}</span>.
                  </li>
                )}
              </ul>
              <div className="flex flex-wrap gap-2">
                {generator.breaking.length > 0 && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      const ok = generator.regenerate(new Set(generator.breaking))
                      toast(
                        ok
                          ? 'Those tokens now follow the rules'
                          : 'Not all of them could be fixed. Try regenerating the set.',
                      )
                    }}
                  >
                    Regenerate those tokens
                  </Button>
                )}
                {count < supply && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      toast(
                        generator.fill()
                          ? `The set is back to ${n(supply)} tokens`
                          : 'Not enough unique combinations are left. Add traits or loosen a rule.',
                      )
                    }
                  >
                    Fill to {n(supply)}
                  </Button>
                )}
                {generator.staleNote && (
                  <Button variant="secondary" size="sm" onClick={askRegenerate}>
                    Regenerate all
                  </Button>
                )}
              </div>
            </AlertDescription>
          </Alert>
        )}

      {!tokens || count === 0 ? (
        <section className="bg-card flex flex-1 flex-col items-center justify-center gap-6 rounded-xl border px-6 py-16 text-center shadow-raised">
          <span className="bg-surface-2 border-border-strong flex size-14 items-center justify-center rounded-xl border shadow-lifted">
            <SparklesIcon aria-hidden="true" className="size-6" />
          </span>
          <div className="max-w-md space-y-2">
            <h3 className="text-title">Generate your collection</h3>
            <p className="text-muted-foreground text-sm leading-relaxed">
              Every token gets one trait from each layer, picked by your weights and checked against your
              rules. No two tokens are the same. You can change any token afterwards.
            </p>
          </div>
          {!readOnly && (
            <Button size="lg" onClick={generator.generate} disabled={generating}>
              <SparklesIcon />
              Generate {n(supply)} tokens
            </Button>
          )}
        </section>
      ) : (
        <Tabs defaultValue="tokens" className="gap-6">
          <TabsList variant="line">
            <TabsTrigger value="tokens">Tokens</TabsTrigger>
            <TabsTrigger value="stats">Statistics</TabsTrigger>
          </TabsList>
          <TabsContent value="tokens">
            <TokenGallery generator={generator} readOnly={readOnly} />
          </TabsContent>
          <TabsContent value="stats">
            <StatsView
              layers={generator.layers}
              tokens={tokens}
              counts={generator.counts}
              ruleCount={generator.rules.length}
              skippedRules={skipped}
            />
          </TabsContent>
        </Tabs>
      )}

      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
      <GenerateFooter
        previous={artDeferred && previous ? { ...previous, href: `${previous.href}?art=deferred` } : previous}
        // Deferred: continuing locks the real set, the second Lock and upload run.
        next={next}
        blockedReason={readOnly ? null : blockedReason}
        locked={readOnly}
        lockNote={
          artDeferred
            ? 'When the set is complete, lock and upload it. The contract stays on the placeholder until you reveal.'
            : undefined
        }
        extra={
          canDefer && !readOnly && !artDeferred ? (
            <FinishLaterAction collectionId={collection.id} />
          ) : undefined
        }
      />
    </div>
  )
}
