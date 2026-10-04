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
import type { ArtRule, Collection, GeneratedToken, Layer, TraitCounts } from '@/lib/demo'
import { artSubStepHref, flowNeighbours } from '@/lib/steps'
import { ConfirmDialog, type ConfirmRequest } from './confirm-dialog'
import { DeferredArtNotice } from './finish-later'
import { Composite } from './composite'
import { CollectionSizes } from './generate/collection-sizes'
import { GenerateFooter } from './generate/generate-footer'
import { StatsView } from './generate/stats-view'
import { TokenGallery } from './generate/token-gallery'
import { TokenNaming } from './generate/token-naming'
import { useGenerator } from './generate/use-generator'
import { ReadOnlyNotice } from './read-only-notice'
import { compositeUrls } from './lib/trait-index'

export type GenerateScreenProps = {
  collection: Tables<'collections'>
  /** The project's collections, in order. Each gets a size here; the supply is their sum. */
  collections: Collection[]
  /** Every collection's layers. */
  layers: Layer[]
  rules: ArtRule[]
  /** The generated set, ranked (1 is rarest). Tokens 1 to 24 have `previewUrl`; stack `tokenLayerUrls(dna)` for others. */
  tokens: GeneratedToken[]
  traitCounts: TraitCounts
  readOnly: boolean
  /** "Finish the art later" is on (MASTER_PLAN, Flow: pre-reveal): the contract starts on a placeholder. */
  artDeferred?: boolean
}

const n = (value: number) => value.toLocaleString('en-US')

/**
 * Art, step 3 (generative): set a size per collection, generate the set, then review and curate
 * it: a paged gallery with rarity rank, collection and trait filters, a token detail panel with
 * trait changes checked against the rules, select mode for regenerate, shuffle and delete, and a
 * statistics view.
 */
export function GenerateScreen({
  collection,
  collections,
  layers,
  rules,
  tokens: seedTokens,
  readOnly,
  artDeferred = false,
}: GenerateScreenProps) {
  const generator = useGenerator(collection.id, collection, {
    collections,
    layers,
    rules,
    tokens: seedTokens,
  })
  const { tokens, generating, progress, problems, supply } = generator
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const { previous, next } = flowNeighbours(collection.id, collection.project_type, 'art/generate')
  const skipped = generator.rules.length - generator.active.length
  const count = tokens?.length ?? 0
  // Each collection must have exactly its size. Those that do not, worded for the creator.
  const offSize = generator.collections
    .map((c) => ({ collection: c, have: generator.perCollection.get(c.id) ?? 0 }))
    .filter(({ collection: c, have }) => have !== c.size)
  const several = generator.collections.length > 1
  const sizeLine = ({ collection: c, have }: (typeof offSize)[number]) =>
    several
      ? `${c.name} has ${n(have)} of ${n(c.size)} tokens.`
      : `The set has ${n(have)} tokens; the supply is ${n(c.size)}.`
  const canFill = offSize.some(({ collection: c, have }) => have < c.size)

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
      : offSize.length > 0
        ? `${sizeLine(offSize[0]!)} Fill it or change the size first.`
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
            <Button
              variant="secondary"
              onClick={askRegenerate}
              disabled={generating || !!generator.nameProblem}
            >
              <RefreshCwIcon />
              Regenerate all
            </Button>
          )}
        </div>
        <div className="border-t px-5 py-4 sm:px-6">
          <CollectionSizes generator={generator} readOnly={readOnly || generating} />
        </div>
        <div className="border-t px-5 py-4 sm:px-6">
          <TokenNaming generator={generator} readOnly={readOnly || generating} />
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

      {skipped > 0 && !readOnly && (
        // One line: the sentence and its link are separate items that never wrap apart.
        <p className="text-muted-foreground flex min-w-0 items-center gap-2 text-sm whitespace-nowrap">
          <TriangleAlertIcon aria-hidden="true" className="text-warning size-4 shrink-0" />
          <span className="min-w-0 truncate">
            {skipped === 1 ? '1 rule is' : `${n(skipped)} rules are`} skipped because of a conflict
          </span>
          <Link
            className="text-foreground shrink-0 underline underline-offset-2"
            href={artSubStepHref(collection.id, 'rules')}
          >
            Review on Rules
          </Link>
        </p>
      )}

      {!readOnly &&
        tokens &&
        count > 0 &&
        (generator.staleNote || generator.breaking.length > 0 || offSize.length > 0) && (
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
                {offSize.map((entry) => (
                  <li key={entry.collection.id}>{sizeLine(entry)}</li>
                ))}
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
                {canFill && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      toast(
                        generator.fill()
                          ? 'Every collection is filled to its size'
                          : 'Not enough unique combinations are left. Add traits or loosen a rule.',
                      )
                    }
                  >
                    {several ? 'Fill to the sizes' : `Fill to ${n(supply)}`}
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
            <Button size="lg" onClick={generator.generate} disabled={generating || !!generator.nameProblem}>
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
              collections={generator.collections}
              perCollection={generator.perCollection}
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
      />
    </div>
  )
}
