'use client'

import { useCallback, useMemo, useSyncExternalStore } from 'react'
import type { ArtRule, Collection, GeneratedToken, Layer } from '@/lib/demo'
import { buildTraitIndex } from '../lib/trait-index'
import { remapDna } from './layer-edits'
import { deleteTokens } from './token-logic'

/**
 * The art project as the Art screens edit it: layers, rules and the generated set, held in the
 * browser for the session and shared between Layers, Rules and Generate so an edit on one shows
 * on the others.
 *
 * Seam: this whole module is replaced by the art tables and server actions (Phase 3). Each
 * `update` call below becomes a server action; the screens already treat it as the only writer.
 */
export type ArtProject = {
  /** The project's collections, in order (token ids run on across them). Undefined until seeded. */
  collections?: Collection[]
  /** The collection Layers and Rules show, shared so switching on one carries to the other. */
  activeCollectionId?: string
  /** Every collection's layers, grouped by collection. Undefined until a screen that has them mounts. */
  layers?: Layer[]
  rules?: ArtRule[]
  /** Undefined until seeded; null once cleared by a structural change ("generate again"). */
  tokens?: GeneratedToken[] | null
  /** The pixel size every layer image must match, set by the first upload. */
  canvas: { width: number; height: number } | null
  /** Seed of the last full generation. */
  seed: number
  /** Why the generated set no longer reflects the layers (weights changed), or null. */
  staleNote: string | null
  /**
   * The token name and description chosen at Generate (legacy auto-populate asked for both).
   * Tokens are named "<token name> #<id>". Undefined until the creator sets them: Generate then
   * offers the project's name and description.
   */
  tokenName?: string
  tokenDescription?: string
  /**
   * Whether blank traits are written into the metadata (legacy `show_blank_traits`, off by
   * default): on, a token without a hat says "Headwear: None"; off, the attribute is left out.
   * Seam: stored on the project and read by the render job at lock (Phase 4).
   */
  showBlankTraits: boolean
}

export type ArtSeed = Pick<ArtProject, 'collections' | 'layers' | 'rules' | 'tokens'>

const projects = new Map<string, ArtProject>()
const listeners = new Map<string, Set<() => void>>()

function fromSeed(seed: ArtSeed): ArtProject {
  return { ...seed, canvas: null, seed: 0x0a7115, staleNote: null, showBlankTraits: false }
}

/** Fills in the slices this screen knows about that the shared project does not have yet. */
function ensure(key: string, seed: ArtSeed): ArtProject {
  const current = projects.get(key)
  if (!current) {
    const created = fromSeed(seed)
    projects.set(key, created)
    return created
  }
  const missing =
    (current.collections === undefined && seed.collections !== undefined) ||
    (current.layers === undefined && seed.layers !== undefined) ||
    (current.rules === undefined && seed.rules !== undefined) ||
    (current.tokens === undefined && seed.tokens !== undefined)
  if (!missing) return current
  // Tokens arriving after the layers were reordered follow the new order.
  const remapped =
    seed.tokens && seed.layers && current.layers
      ? remapDna(seed.tokens, seed.layers, current.layers)
      : seed.tokens
  // Tokens of a collection deleted before they arrived are dropped, and the later ids move up.
  const known = current.collections && new Set(current.collections.map((c) => c.id))
  const orphans = new Set(
    (known && remapped ? remapped.filter((t) => !known.has(t.collectionId)) : []).map((t) => t.id),
  )
  const seededTokens =
    remapped && orphans.size
      ? deleteTokens(remapped, orphans, {
          tokenName: current.tokenName ?? remapped[0]!.name.replace(/ #\d+$/, ''),
          index: buildTraitIndex(current.layers ?? seed.layers ?? []),
        })
      : remapped
  const merged: ArtProject = {
    ...current,
    collections: current.collections ?? seed.collections,
    layers: current.layers ?? seed.layers,
    rules: current.rules ?? seed.rules,
    tokens: current.tokens === undefined ? seededTokens : current.tokens,
  }
  projects.set(key, merged)
  return merged
}

export function useArtProject(key: string, seed: ArtSeed) {
  // The props are fixed for the life of the screen, so the first seed is the one that counts.
  const fallback = useMemo(() => fromSeed(seed), [key])

  const subscribe = useCallback(
    (listener: () => void) => {
      const set = listeners.get(key) ?? new Set()
      set.add(listener)
      listeners.set(key, set)
      return () => set.delete(listener)
    },
    [key],
  )

  const project = useSyncExternalStore(
    subscribe,
    () => ensure(key, seed),
    () => fallback,
  )

  const update = useCallback(
    (change: (project: ArtProject) => ArtProject) => {
      const next = change(projects.get(key) ?? fallback)
      projects.set(key, next)
      listeners.get(key)?.forEach((listener) => listener())
    },
    [key, fallback],
  )

  return [project, update] as const
}
