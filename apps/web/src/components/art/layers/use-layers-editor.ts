'use client'

import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { countTraits } from '@cobweb/dna'
import {
  addLayer as saveNewLayer,
  deleteLayer as saveLayerDelete,
  moveLayer as saveLayerMove,
  renameLayer as saveLayerName,
} from '@/app/actions/art/layers'
import { updateArtSettings } from '@/app/actions/art/settings'
import { clearTokens } from '@/app/actions/art/tokens'
import {
  addTraits as saveNewTraits,
  deleteTrait as saveTraitDelete,
  renameTrait as saveTraitName,
  setBlank as saveBlank,
  setLayerWeights,
} from '@/app/actions/art/traits'
import { done, type ActionResult } from '@/lib/art/result'
import { weightRows } from '@/lib/art/rows'
import type { Layer, Trait, TraitCounts } from '@/lib/demo'
import type { ConfirmRequest } from '../confirm-dialog'
import { formatPercent, roundWeight } from '../lib/trait-index'
import type { NameRequest } from '../name-dialog'
import { useArtProject, type ArtProject } from '../state/art-store'
import { useArtSync } from '../state/art-sync'
import {
  addLayer,
  addTraits,
  deleteLayer,
  deleteTrait,
  evenOut,
  layerOfTrait,
  layersOf,
  moveLayer,
  pruneGroups,
  pruneRules,
  renameLayer,
  restoreWeights,
  rulesTouching,
  setBlank,
  setConstant,
  updateTrait,
} from '../state/layer-edits'
import { createUploader } from '../uploads/create-uploader'
import { uploadAll } from '../uploads/upload-once'
import type { NewTrait } from './add-traits-dialog'

const STALE_NOTE = 'Rarity changed after this set was generated. Regenerate to apply the new weights.'

function plural(count: number, one: string, many = `${one}s`) {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`
}

type Save = () => Promise<ActionResult<unknown>>

/** The debounce key of a layer's weight edits. */
const weightKey = (layerId: string) => `weights:${layerId}`

/**
 * Everything the Layers screen does to the project, on the layers of the collection being shown
 * (`activeCollectionId`). Each edit shows at once and is saved through `useArtSync()`; creates show
 * once the database has given the row its id. Edits that would invalidate the generated set (adding,
 * moving or deleting a layer, deleting a trait that tokens use) ask first and then clear the set.
 */
export function useLayersEditor(
  collectionId: string,
  seedLayers: Layer[],
  seedCounts: TraitCounts,
  activeCollectionId: string,
) {
  const sync = useArtSync()
  const [project] = useArtProject(collectionId, { layers: seedLayers })
  const allLayers = project.layers ?? seedLayers
  const layers = useMemo(() => layersOf(allLayers, activeCollectionId), [allLayers, activeCollectionId])
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const [naming, setNaming] = useState<NameRequest | null>(null)
  const uploader = useMemo(() => createUploader({ collectionId, kind: 'layer_image' }), [collectionId])
  /** Each layer's traits before the weight edits that are waiting to be saved, for a rollback. */
  const weightsBefore = useRef(new Map<string, Trait[]>())

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

  const edit = (apply: (p: ArtProject) => ArtProject, persist?: Save) => void sync.run({ apply, persist })
  const withLayers = (next: (layers: Layer[]) => Layer[], persist?: Save) =>
    edit((p) => ({ ...p, layers: next(p.layers ?? seedLayers) }), persist)
  /** Clears the generated set; queued before the structural edit that needs it. */
  const clearSet = () =>
    edit(
      (p) => ({ ...p, tokens: null, staleNote: null }),
      () => clearTokens(collectionId),
    )
  /** A structural edit: new layers, pruned rules and groups, and the generated set cleared when `clear`. */
  const structural = (next: (layers: Layer[]) => Layer[], clear: boolean, persist: Save) =>
    edit((p) => {
      const layersAfter = next(p.layers ?? seedLayers)
      const ids = new Set(layersAfter.flatMap((layer) => layer.traits.map((trait) => trait.id)))
      return {
        ...p,
        layers: layersAfter,
        rules: p.rules ? pruneRules(p.rules, ids) : p.rules,
        atLeastOne: p.atLeastOne ? pruneGroups(p.atLeastOne, ids) : p.atLeastOne,
        tokens: clear ? null : p.tokens,
        staleNote: clear ? null : p.staleNote,
      }
    }, persist)

  /** Weight edits show at once and are saved as the layer's whole table, 250 ms after the last one. */
  const editWeights = (layerId: string, change: (layers: Layer[]) => Layer[]) => {
    const before = sync.read().layers?.find((layer) => layer.id === layerId)
    if (before && !weightsBefore.current.has(layerId)) weightsBefore.current.set(layerId, before.traits)
    edit((p) => ({
      ...p,
      layers: change(p.layers ?? seedLayers),
      staleNote: generated > 0 ? STALE_NOTE : p.staleNote,
    }))
    sync.debounce.schedule(weightKey(layerId), () => {
      const saved = weightsBefore.current.get(layerId)
      weightsBefore.current.delete(layerId)
      void sync.run({
        apply: (p) => p,
        // The table is built when the save's turn comes, so a trait created meanwhile is in it.
        persist: async () => {
          const layer = sync.read().layers?.find((candidate) => candidate.id === layerId)
          return layer ? setLayerWeights(collectionId, layerId, weightRows(layer)) : done
        },
        undo: (p) => (saved ? { ...p, layers: restoreWeights(p.layers ?? [], layerId, saved) } : p),
      })
    })
  }
  const traitLayer = (traitId: string) => layerOfTrait(sync.read().layers ?? seedLayers, traitId)

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

    /**
     * Creator-visible change (spec section 8): a token's traits follow the layer order, so while
     * tokens exist a move asks to clear them first instead of remapping every token's DNA.
     */
    moveLayer: (from: number, to: number) => {
      const layer = layers[from]
      if (!layer || from === to) return
      const move = () =>
        edit(
          (p) => ({ ...p, layers: moveLayer(p.layers ?? seedLayers, activeCollectionId, from, to) }),
          () => saveLayerMove(collectionId, layer.id, to),
        )
      if (!clearsSet) return move()
      setConfirm({
        title: `Move ${layer.name}?`,
        body: [
          `Each token's traits follow the order of the layers, so the order can change only while there are no tokens. ${clearsSet}`,
        ],
        confirmLabel: 'Clear tokens and move',
        destructive: true,
        onConfirm: () => {
          clearSet()
          move()
        },
      })
    },

    /** `into` makes the collection first when the project has none (the first layer of a project). */
    askAddLayer: (onAdded: (id: string) => void, into?: () => Promise<string | null>) =>
      setNaming({
        title: 'Add a layer',
        description: 'New layers go on top of the stack. Drag them to change the order.',
        label: 'Layer name',
        initial: '',
        confirmLabel: 'Add layer',
        taken: layers.map((layer) => layer.name),
        warning: clearsSet ? `Every token needs a trait from each layer. ${clearsSet}` : undefined,
        onSubmit: (name) =>
          void (async () => {
            if (generated > 0) clearSet()
            const target = into ? await into() : activeCollectionId
            if (!target) return
            let id = ''
            const added = await sync.create<{ id: string }>({
              persist: () => saveNewLayer(collectionId, target, name),
              apply: (p, data) => {
                const result = addLayer(p.layers ?? seedLayers, target, name, data?.id)
                id = result.id
                return { ...p, layers: result.layers }
              },
            })
            if (added) onAdded(id)
          })(),
      }),

    askRenameLayer: (layer: Layer) =>
      setNaming({
        title: 'Rename layer',
        label: 'Layer name',
        initial: layer.name,
        confirmLabel: 'Save name',
        taken: layers.filter((other) => other.id !== layer.id).map((other) => other.name),
        onSubmit: (name) =>
          withLayers(
            (current) => renameLayer(current, layer.id, name),
            () => saveLayerName(collectionId, layer.id, name, layer.displayName ?? null),
          ),
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
          // The tokens go inside the same transaction (`art_delete_layer` with its flag).
          structural(
            (current) => deleteLayer(current, layer.id),
            generated > 0,
            () => saveLayerDelete(collectionId, layer.id, generated > 0),
          )
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
        onSubmit: (name) =>
          withLayers(
            (current) => updateTrait(current, trait.id, { name }),
            () => saveTraitName(collectionId, trait.id, name),
          ),
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
        onConfirm: () => {
          if (used > 0) clearSet()
          structural(
            (current) => deleteTrait(current, trait.id),
            used > 0,
            () => saveTraitDelete(collectionId, trait.id),
          )
        },
      })
    },

    /** Project-wide: blank traits written into the metadata (legacy `show_blank_traits`). */
    showBlankTraits: project.showBlankTraits,
    setShowBlankTraits: (on: boolean) =>
      edit(
        (p) => ({ ...p, showBlankTraits: on }),
        () => updateArtSettings(collectionId, { showBlankTraits: on }),
      ),

    /** Percent, 0 to 100, kept to two decimals as the legacy tool did. */
    setWeight: (traitId: string, weight: number) => {
      const layer = traitLayer(traitId)
      if (layer)
        editWeights(layer.id, (current) => updateTrait(current, traitId, { weight: roundWeight(weight) }))
    },
    setConstant: (traitId: string, count: number | null) => {
      const layer = traitLayer(traitId)
      if (layer) editWeights(layer.id, (current) => setConstant(current, traitId, count))
    },
    evenOut: (layerId: string) => editWeights(layerId, (current) => evenOut(current, layerId)),

    setBlank: (layer: Layer, on: boolean) => {
      const blank = layer.traits.find((trait) => trait.blank)
      if (on) {
        if (blank) return
        // Queue the layer's waiting weight save ahead of the create.
        sync.debounce.flush(weightKey(layer.id))
        void sync.create<{ id: string | null }>({
          persist: () => saveBlank(collectionId, layer.id, true),
          apply: (p, data) => ({
            ...p,
            layers: setBlank(p.layers ?? seedLayers, layer.id, true, data?.id ?? undefined),
          }),
        })
        return
      }
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
        onConfirm: () => {
          if (used > 0) clearSet()
          structural(
            (current) => setBlank(current, layer.id, false),
            used > 0,
            () => saveBlank(collectionId, layer.id, false),
          )
        },
      })
    },

    /** Uploads the picked images, then adds them at 0% with the ids the database gave them. */
    addTraits: async (layerId: string, items: NewTrait[], canvas: ArtProject['canvas']) => {
      const withCanvas = (p: ArtProject, layersAfter: Layer[]): ArtProject => ({
        ...p,
        layers: layersAfter,
        canvas: p.canvas ?? canvas,
      })
      // Sample mode keeps the picked files' previews and saves nothing.
      if (sync.demo) {
        edit((p) => withCanvas(p, addTraits(p.layers ?? seedLayers, layerId, items).layers))
        return
      }
      const uploading = toast.loading(
        items.length === 1 ? 'Uploading 1 image.' : `Uploading ${items.length} images.`,
      )
      const results = await uploadAll(
        uploader,
        items.map((item) => item.file),
      )
      toast.dismiss(uploading)
      for (const item of items) URL.revokeObjectURL(item.imageUrl)
      const stored = items.flatMap((item, i) => {
        const result = results[i]
        return result && 'record' in result ? [{ name: item.name, record: result.record }] : []
      })
      const failed = items.length - stored.length
      if (failed > 0)
        toast.error(
          failed === 1
            ? '1 image could not be uploaded. Add it again to retry.'
            : `${failed} images could not be uploaded. Add them again to retry.`,
        )
      if (stored.length === 0) return
      // Queue the layer's waiting weight save ahead of the create.
      sync.debounce.flush(weightKey(layerId))
      await sync.create<{ ids: string[] }>({
        persist: () =>
          saveNewTraits(
            collectionId,
            layerId,
            stored.map(({ name, record }) => ({ name, uploadId: record.id })),
          ),
        apply: (p, data) =>
          withCanvas(
            p,
            addTraits(
              p.layers ?? seedLayers,
              layerId,
              stored.map(({ name, record }) => ({
                name,
                imageUrl: record.url,
                uploadId: record.id,
                ...(record.thumbnailUrl ? { thumbnailUrl: record.thumbnailUrl } : {}),
              })),
              data?.ids,
            ).layers,
          ),
      })
    },
  }
}

export type LayersEditor = ReturnType<typeof useLayersEditor>
