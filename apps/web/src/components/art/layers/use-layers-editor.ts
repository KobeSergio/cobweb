'use client'

import { useMemo, useState } from 'react'
import { countTraits } from '@/lib/demo/art'
import type { Layer, Trait, TraitCounts } from '@/lib/demo'
import type { ConfirmRequest } from '../confirm-dialog'
import type { NameRequest } from '../name-dialog'
import { useArtProject, type ArtProject } from '../state/art-store'
import {
  addLayer,
  addTraits,
  deleteLayer,
  deleteTrait,
  evenOut,
  layersOf,
  moveLayer,
  pruneRules,
  remapDna,
  renameLayer,
  rulesTouching,
  setBlank,
  setConstant,
  updateTrait,
} from '../state/layer-edits'
import { formatPercent } from '../lib/trait-index'

const STALE_NOTE = 'Rarity changed after this set was generated. Regenerate to apply the new weights.'

function plural(count: number, one: string, many = `${one}s`) {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`
}

/**
 * Everything the Layers screen does to the project, on the layers of the collection being shown
 * (`activeCollectionId`). Edits that would invalidate the generated set (adding or deleting a
 * layer, deleting a trait that tokens use) ask first and then clear the set.
 */
export function useLayersEditor(
  collectionId: string,
  seedLayers: Layer[],
  seedCounts: TraitCounts,
  activeCollectionId: string,
) {
  const [project, update] = useArtProject(collectionId, { layers: seedLayers })
  const allLayers = project.layers ?? seedLayers
  const layers = useMemo(() => layersOf(allLayers, activeCollectionId), [allLayers, activeCollectionId])
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const [naming, setNaming] = useState<NameRequest | null>(null)

  // Generated counts: the shared set once it is loaded, else the counts this page was given.
  const counts = useMemo(
    () => (project.tokens === undefined ? seedCounts : project.tokens ? countTraits(project.tokens) : {}),
    [project.tokens, seedCounts],
  )
  // Tokens in the whole project: every token has one trait in each layer of its collection, so the
  // fullest layer of each collection counts that collection's tokens.
  const generated = useMemo(() => {
    if (project.tokens !== undefined) return project.tokens?.length ?? 0
    const perCollection = new Map<string, number>()
    for (const layer of seedLayers) {
      const used = layer.traits.reduce((n, t) => n + (counts[t.id] ?? 0), 0)
      perCollection.set(layer.collectionId, Math.max(perCollection.get(layer.collectionId) ?? 0, used))
    }
    return [...perCollection.values()].reduce((sum, n) => sum + n, 0)
  }, [project.tokens, seedLayers, counts])

  const clearsSet =
    generated > 0
      ? `The ${plural(generated, 'generated token')} will be cleared, and you generate again on the Generate step.`
      : null

  const apply = (change: (p: ArtProject) => ArtProject) => update(change)
  const withLayers = (next: (layers: Layer[]) => Layer[], stale = false) =>
    apply((p) => ({
      ...p,
      layers: next(p.layers ?? seedLayers),
      staleNote: stale && generated > 0 ? STALE_NOTE : p.staleNote,
    }))
  /** A structural edit: new layers, pruned rules, and the generated set cleared if there was one. */
  const structural = (next: (layers: Layer[]) => Layer[], clear: boolean) =>
    apply((p) => {
      const layersAfter = next(p.layers ?? seedLayers)
      const ids = new Set(layersAfter.flatMap((layer) => layer.traits.map((trait) => trait.id)))
      return {
        ...p,
        layers: layersAfter,
        rules: p.rules ? pruneRules(p.rules, ids) : p.rules,
        tokens: clear ? null : p.tokens,
        staleNote: clear ? null : p.staleNote,
      }
    })

  const rulesFor = (traitIds: string[]) =>
    project.rules ? rulesTouching(project.rules, new Set(traitIds)) : 0

  return {
    /** The shown collection's layers, bottom first. */
    layers,
    /** Known once the Rules or Generate screen has loaded them this session. */
    rules: project.rules ?? [],
    counts,
    generated,
    canvas: project.canvas,
    staleNote: project.staleNote,
    confirm,
    closeConfirm: () => setConfirm(null),
    naming,
    closeNaming: () => setNaming(null),

    moveLayer: (from: number, to: number) =>
      apply((p) => {
        const before = p.layers ?? seedLayers
        const after = moveLayer(before, activeCollectionId, from, to)
        return { ...p, layers: after, tokens: p.tokens ? remapDna(p.tokens, before, after) : p.tokens }
      }),

    askAddLayer: (onAdded: (id: string) => void) =>
      setNaming({
        title: 'Add a layer',
        description: 'New layers go on top of the stack. Drag them to change the order.',
        label: 'Layer name',
        initial: '',
        confirmLabel: 'Add layer',
        taken: layers.map((layer) => layer.name),
        warning: clearsSet ? `Every token needs a trait from each layer. ${clearsSet}` : undefined,
        onSubmit: (name) => {
          let id = ''
          structural((current) => {
            const result = addLayer(current, activeCollectionId, name)
            id = result.id
            return result.layers
          }, generated > 0)
          onAdded(id)
        },
      }),

    askRenameLayer: (layer: Layer) =>
      setNaming({
        title: 'Rename layer',
        label: 'Layer name',
        initial: layer.name,
        confirmLabel: 'Save name',
        taken: layers.filter((other) => other.id !== layer.id).map((other) => other.name),
        onSubmit: (name) => withLayers((current) => renameLayer(current, layer.id, name)),
      }),

    askDeleteLayer: (layer: Layer, onDeleted: () => void) => {
      const rules = rulesFor(layer.traits.map((trait) => trait.id))
      setConfirm({
        title: `Delete ${layer.name}?`,
        body: [
          `${layer.name} and its ${plural(layer.traits.length, 'trait')} are removed from the project.`,
          ...(rules ? [`${plural(rules, 'rule')} that use these traits will be removed or trimmed.`] : []),
          ...(clearsSet ? [clearsSet] : []),
        ],
        confirmLabel: 'Delete layer',
        destructive: true,
        onConfirm: () => {
          structural((current) => deleteLayer(current, layer.id), generated > 0)
          onDeleted()
        },
      })
    },

    askRenameTrait: (layer: Layer, trait: Trait) =>
      setNaming({
        title: 'Rename trait',
        description: 'Collectors see this name in the token metadata.',
        label: 'Trait name',
        initial: trait.name,
        confirmLabel: 'Save name',
        taken: layer.traits.filter((other) => other.id !== trait.id).map((other) => other.name),
        onSubmit: (name) => withLayers((current) => updateTrait(current, trait.id, { name })),
      }),

    askDeleteTrait: (layer: Layer, trait: Trait) => {
      const used = counts[trait.id] ?? 0
      const rules = rulesFor([trait.id])
      setConfirm({
        title: `Delete ${trait.name}?`,
        body: [
          trait.constant
            ? `${trait.name} is removed from ${layer.name}.`
            : `${trait.name} is removed from ${layer.name}. Its ${formatPercent(trait.weight)} share is left unassigned, so you decide where it goes. The other weights stay as they are.`,
          ...(rules ? [`${plural(rules, 'rule')} that use it will be removed or trimmed.`] : []),
          ...(used > 0 && clearsSet ? [`${plural(used, 'generated token')} use it. ${clearsSet}`] : []),
        ],
        confirmLabel: trait.blank ? 'Turn off blank' : 'Delete trait',
        destructive: true,
        onConfirm: () => structural((current) => deleteTrait(current, trait.id), used > 0),
      })
    },

    setWeight: (traitId: string, weight: number) =>
      withLayers((current) => updateTrait(current, traitId, { weight }), true),
    setConstant: (traitId: string, count: number | null) =>
      withLayers((current) => setConstant(current, traitId, count), true),
    evenOut: (layerId: string) => withLayers((current) => evenOut(current, layerId), true),

    setBlank: (layer: Layer, on: boolean) => {
      const blank = layer.traits.find((trait) => trait.blank)
      if (on) return withLayers((current) => setBlank(current, layer.id, true))
      if (!blank) return
      const used = counts[blank.id] ?? 0
      setConfirm({
        title: `Turn off the blank trait in ${layer.name}?`,
        body: [
          `Every token will then have a ${layer.name} trait. The blank's ${formatPercent(blank.weight)} share is left unassigned.`,
          ...(used > 0 && clearsSet
            ? [`${plural(used, 'generated token')} leave this layer out. ${clearsSet}`]
            : []),
        ],
        confirmLabel: 'Turn off blank',
        destructive: used > 0,
        onConfirm: () => structural((current) => setBlank(current, layer.id, false), used > 0),
      })
    },

    addTraits: (layerId: string, items: { name: string; imageUrl: string }[], canvas: ArtProject['canvas']) =>
      apply((p) => ({
        ...p,
        layers: addTraits(p.layers ?? seedLayers, layerId, items).layers,
        canvas: p.canvas ?? canvas,
      })),
  }
}

export type LayersEditor = ReturnType<typeof useLayersEditor>
