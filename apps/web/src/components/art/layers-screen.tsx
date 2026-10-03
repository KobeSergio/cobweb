'use client'

import { LayersIcon, PlusIcon, RefreshCwIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@cobweb/ui/components/alert'
import { Button } from '@cobweb/ui/components/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@cobweb/ui/components/empty'
import type { Tables } from '@/lib/database.types'
import { satisfiesRules, seededRandom } from '@/lib/demo/art'
import type { Layer, TraitCounts } from '@/lib/demo'
import { flowNeighbours } from '@/lib/steps'
import { StageFooter } from '@/components/shell/stage-footer'
import { ConfirmDialog } from './confirm-dialog'
import { DeferredArtNotice, FinishLaterAction } from './finish-later'
import { AddTraitsDialog } from './layers/add-traits-dialog'
import { LayerList } from './layers/layer-list'
import { LayerPreview } from './layers/layer-preview'
import { TraitPanel } from './layers/trait-panel'
import { useLayersEditor } from './layers/use-layers-editor'
import { buildTraitIndex, compositeUrls, weightedTraits } from './lib/trait-index'
import { NameDialog } from './name-dialog'
import { ReadOnlyNotice } from './read-only-notice'
import { newSeed } from './state/token-logic'

export type LayersScreenProps = {
  collection: Tables<'collections'>
  /** Layers bottom first, each with its traits, weights, constants and blank. */
  layers: Layer[]
  /** How many generated tokens carry each trait, for "expected vs actual". */
  traitCounts: TraitCounts
  /** Art is locked: show, do not edit. */
  readOnly: boolean
  /** "Finish the art later" is on (MASTER_PLAN, Flow: pre-reveal): the contract starts on a placeholder. */
  artDeferred?: boolean
  /** Offer "Finish the art later". Sample mode only until Phase 3 stores the deferred flag. */
  canDefer?: boolean
}

/** One weighted pick per layer. Seeded, so the first preview is the same on the server and in the browser. */
function rollPreview(layers: Layer[], seed: number, rules: Parameters<typeof satisfiesRules>[1]) {
  const random = seededRandom(seed)
  let picks: Record<string, string> = {}
  for (let attempt = 0; attempt < 60; attempt++) {
    picks = {}
    for (const layer of layers) {
      const options = weightedTraits(layer)
      const total = options.reduce((sum, trait) => sum + trait.weight, 0)
      let roll = random() * total
      const chosen = options.find((trait) => (roll -= trait.weight) < 0) ?? options[0] ?? layer.traits[0]
      if (chosen) picks[layer.id] = chosen.id
    }
    if (satisfiesRules(new Set(Object.values(picks)), rules)) break
  }
  return picks
}

/**
 * Art, step 1 (generative): the stack. A layer panel on the left with a live preview, the selected
 * layer's traits on the right: rarity, constants, the blank trait, adding and removing traits.
 */
export function LayersScreen({
  collection,
  layers: seedLayers,
  traitCounts,
  readOnly,
  artDeferred = false,
  canDefer = false,
}: LayersScreenProps) {
  const editor = useLayersEditor(collection.id, seedLayers, traitCounts)
  const { layers } = editor
  const [selectedId, setSelectedId] = useState<string | null>(layers[layers.length - 1]?.id ?? null)
  const [preview, setPreview] = useState<Record<string, string>>(() => rollPreview(seedLayers, 7, []))
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [upload, setUpload] = useState<{ layerId: string; files: File[] } | null>(null)
  const { previous, next } = flowNeighbours(collection.id, collection.project_type, 'art/layers')

  const index = useMemo(() => buildTraitIndex(layers), [layers])
  const selected = layers.find((layer) => layer.id === selectedId) ?? layers[layers.length - 1] ?? null
  const position = selected ? layers.indexOf(selected) : -1

  // The preview's trait per layer, falling back when a chosen trait was deleted.
  const shownDna = layers.map((layer) => {
    const chosen = preview[layer.id]
    return layer.traits.some((trait) => trait.id === chosen)
      ? chosen!
      : ((weightedTraits(layer)[0] ?? layer.traits[0])?.id ?? '')
  })
  const previewNames = Object.fromEntries(
    layers.map((layer, i) => [layer.id, index.get(shownDna[i] ?? '')?.trait.name ?? '']),
  )
  const description = `Preview: ${layers
    .filter((layer) => !hidden.has(layer.id))
    .map((layer) => `${previewNames[layer.id] || 'nothing'} ${layer.name.toLowerCase()}`)
    .join(', ')}`

  const toggleHidden = (id: string) =>
    setHidden((current) => {
      const nextSet = new Set(current)
      if (nextSet.has(id)) nextSet.delete(id)
      else nextSet.add(id)
      return nextSet
    })

  return (
    <div className="flex flex-1 flex-col gap-6">
      {readOnly && <ReadOnlyNotice what="the layers and their rarity" />}
      {artDeferred && <DeferredArtNotice collectionId={collection.id} />}
      {!readOnly && editor.staleNote && (
        <Alert variant="warning">
          <RefreshCwIcon aria-hidden="true" />
          <AlertTitle>The generated set is out of date</AlertTitle>
          <AlertDescription>{editor.staleNote}</AlertDescription>
        </Alert>
      )}

      {layers.length === 0 ? (
        <Empty className="bg-card border py-16">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LayersIcon />
            </EmptyMedia>
            <EmptyTitle>Start with your first layer</EmptyTitle>
            <EmptyDescription>
              A layer is one part of the art, like a background, a body or a hat. Each token takes one trait
              from every layer, stacked from the bottom up.
            </EmptyDescription>
          </EmptyHeader>
          {!readOnly && (
            <EmptyContent>
              <Button variant="secondary" onClick={() => editor.askAddLayer(setSelectedId)}>
                <PlusIcon />
                Add layer
              </Button>
            </EmptyContent>
          )}
        </Empty>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[17rem_minmax(0,1fr)] xl:grid-cols-[19rem_minmax(0,1fr)]">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-1">
            <LayerPreview
              urls={compositeUrls(shownDna, index, hidden)}
              description={description}
              hiddenCount={hidden.size}
              onShowAll={() => setHidden(new Set())}
              onRandomise={() => setPreview(rollPreview(layers, newSeed(), editor.rules))}
              seed={collection.id}
            />
            <LayerList
              layers={layers}
              selectedId={selected?.id ?? null}
              onSelect={setSelectedId}
              previewNames={previewNames}
              hidden={hidden}
              onToggleHidden={toggleHidden}
              onMove={editor.moveLayer}
              onAdd={() => editor.askAddLayer(setSelectedId)}
              onRename={editor.askRenameLayer}
              onDelete={(layer) => editor.askDeleteLayer(layer, () => setSelectedId(null))}
              readOnly={readOnly}
            />
          </div>
          {selected && (
            <TraitPanel
              layer={selected}
              position={position}
              layerCount={layers.length}
              supply={collection.max_supply}
              counts={editor.counts}
              generated={editor.generated}
              previewTraitId={shownDna[position]}
              onPreview={(traitId) => {
                setPreview((current) => ({ ...current, [selected.id]: traitId }))
                setHidden((current) => {
                  if (!current.has(selected.id)) return current
                  const nextSet = new Set(current)
                  nextSet.delete(selected.id)
                  return nextSet
                })
              }}
              onAddFiles={(files) => setUpload({ layerId: selected.id, files })}
              editor={editor}
              readOnly={readOnly}
            />
          )}
        </div>
      )}

      <AddTraitsDialog
        open={!!upload}
        onOpenChange={(open) => !open && setUpload(null)}
        layer={layers.find((layer) => layer.id === upload?.layerId) ?? null}
        initialFiles={upload?.files ?? []}
        canvas={editor.canvas}
        onAdd={(items, canvas) => upload && editor.addTraits(upload.layerId, items, canvas)}
      />
      <ConfirmDialog request={editor.confirm} onClose={editor.closeConfirm} />
      <NameDialog request={editor.naming} onClose={editor.closeNaming} />
      <StageFooter
        previous={previous}
        next={artDeferred && next ? { ...next, href: `${next.href}?art=deferred` } : next}
        extra={
          canDefer && !readOnly && !artDeferred ? (
            <FinishLaterAction collectionId={collection.id} />
          ) : undefined
        }
      />
    </div>
  )
}
