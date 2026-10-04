'use client'

import { useState } from 'react'
import type { Collection } from '@/lib/demo'
import type { ConfirmRequest } from '../confirm-dialog'
import type { NameRequest } from '../name-dialog'
import { useArtProject, type ArtSeed } from '../state/art-store'
import { addCollection, renameCollection, rulesOf } from '../state/collection-edits'
import { layersOf, pruneRules } from '../state/layer-edits'
import { deleteTokens } from '../state/token-logic'

function plural(count: number, one: string, many = `${one}s`) {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`
}

/**
 * The project's collections and the one Layers and Rules are showing. Adding, renaming and
 * deleting a collection ask first; deleting removes its layers, its rules and its generated tokens
 * (the later ids move up, so ids stay 1 to N).
 *
 * `projectKey` is the Cobweb collection id the art belongs to; `tokenName` names the tokens.
 */
export function useCollections(projectKey: string, tokenName: string, seed: ArtSeed) {
  const [project, update] = useArtProject(projectKey, seed)
  const collections: Collection[] = project.collections ?? seed.collections ?? []
  const activeId = collections.some((c) => c.id === project.activeCollectionId)
    ? project.activeCollectionId!
    : (collections[0]?.id ?? '')
  const active = collections.find((c) => c.id === activeId) ?? null
  // Until the project has layers, the folder upload decides its collections; no switcher yet.
  const hasLayers = (project.layers ?? seed.layers ?? []).length > 0
  const [naming, setNaming] = useState<NameRequest | null>(null)
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)

  const select = (id: string) => update((p) => ({ ...p, activeCollectionId: id }))

  /** The shown collection's id, creating one named after the project when there is none yet. */
  const ensureOne = (name: string): string => {
    if (activeId) return activeId
    let id = ''
    update((p) => {
      const result = addCollection(p.collections ?? collections, name)
      id = result.id
      return { ...p, collections: result.collections, activeCollectionId: result.id }
    })
    return id
  }

  return {
    collections,
    activeId,
    active,
    hasLayers,
    select,
    ensureOne,
    naming,
    closeNaming: () => setNaming(null),
    confirm,
    closeConfirm: () => setConfirm(null),

    askAdd: () =>
      setNaming({
        title: 'Add a collection',
        description:
          'A collection has its own layers, rules and size, for example male and female. Token ids run on from one collection to the next.',
        label: 'Collection name',
        initial: '',
        confirmLabel: 'Add collection',
        taken: collections.map((c) => c.name),
        onSubmit: (name) =>
          update((p) => {
            const result = addCollection(p.collections ?? collections, name)
            return { ...p, collections: result.collections, activeCollectionId: result.id }
          }),
      }),

    askRename: (collection: Collection) =>
      setNaming({
        title: 'Rename collection',
        label: 'Collection name',
        initial: collection.name,
        confirmLabel: 'Save name',
        taken: collections.filter((c) => c.id !== collection.id).map((c) => c.name),
        onSubmit: (name) =>
          update((p) => ({
            ...p,
            collections: renameCollection(p.collections ?? collections, collection.id, name),
          })),
      }),

    askDelete: (collection: Collection) => {
      const layers = layersOf(project.layers ?? seed.layers ?? [], collection.id)
      const rules = rulesOf(
        project.rules ?? seed.rules ?? [],
        project.layers ?? seed.layers ?? [],
        collection.id,
      )
      const tokens = (project.tokens === undefined ? seed.tokens : project.tokens) ?? []
      const own = tokens.filter((t) => t.collectionId === collection.id).length
      setConfirm({
        title: `Delete ${collection.name}?`,
        body: [
          `${collection.name} and its ${plural(layers.length, 'layer')} are removed from the project. This cannot be undone.`,
          ...(rules.length ? [`Its ${plural(rules.length, 'rule')} will be removed.`] : []),
          ...(own
            ? [
                `Its ${plural(own, 'generated token')} will be removed, and later token ids move up to close the gap.`,
              ]
            : []),
        ],
        confirmLabel: 'Delete collection',
        destructive: true,
        onConfirm: () =>
          update((p) => {
            const allLayers = p.layers ?? seed.layers ?? []
            const keptLayers = allLayers.filter((layer) => layer.collectionId !== collection.id)
            const keptIds = new Set(keptLayers.flatMap((layer) => layer.traits.map((trait) => trait.id)))
            const current = p.tokens === undefined ? seed.tokens : p.tokens
            const drop = new Set(
              (current ?? []).filter((t) => t.collectionId === collection.id).map((t) => t.id),
            )
            const nextCollections = (p.collections ?? collections).filter((c) => c.id !== collection.id)
            return {
              ...p,
              collections: nextCollections,
              activeCollectionId: nextCollections[0]?.id,
              layers: keptLayers,
              rules: pruneRules(p.rules ?? seed.rules ?? [], keptIds),
              tokens: current ? deleteTokens(current, drop, tokenName) : current,
            }
          }),
      })
    },
  }
}

export type CollectionsControl = ReturnType<typeof useCollections>
