'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { setCollectionSupply } from '@/app/actions/collection-supply'
import type { ArtRule, Collection, GeneratedToken, Layer } from '@/lib/demo'
import { attributeCounts, attributeKeyOf, buildTraitIndex } from '../lib/trait-index'
import { useArtProject } from '../state/art-store'
import { setCollectionSize, supplyOf } from '../state/collection-edits'
import { layersOf, pruneRules } from '../state/layer-edits'
import { activeRules, analyseRules } from '../state/rule-logic'
import { fillTo, generateSet, newSeed, regenerate, tokenNameProblem } from '../state/generation'
import {
  changeTrait,
  countByCollection,
  countTraits,
  deleteTokens,
  renameTokens,
  setDescription,
  shuffleIds,
  swapIds,
  tokensBreakingRules,
  type SetContext,
} from '../state/token-logic'

/** Long enough to read as work being done, short enough not to be in the way. */
const MIN_GENERATE_MS = 900

/**
 * The generated set and every curation action on it. Actions apply at once; a refused trait
 * change comes back as `{ ok: false, reason }`, and a bulk re-roll that cannot finish returns false.
 * The supply is the sum of the collections' sizes; a successful generation saves it as the
 * collection's supply.
 *
 * Seam: generation moves to `packages/dna` (Phase 3), possibly in a worker; the screen only
 * needs `generate`, the curation calls and `tokens`.
 */
export function useGenerator(
  collectionId: string,
  /** The project's name and description: what the token name and description start as. */
  project0: { name: string; description: string },
  seed: { collections: Collection[]; layers: Layer[]; rules: ArtRule[]; tokens: GeneratedToken[] },
) {
  const [project, update] = useArtProject(collectionId, seed)
  const collections = project.collections ?? seed.collections
  const supply = supplyOf(collections)
  const layers = project.layers ?? seed.layers
  const index = useMemo(() => buildTraitIndex(layers), [layers])
  const tokenName = project.tokenName ?? project0.name
  const tokenDescription = project.tokenDescription ?? project0.description
  // Both are required, as in the legacy auto-populate.
  const nameProblem = tokenNameProblem(tokenName)
  const ctx: SetContext = { tokenName, index }
  const rules = useMemo(
    () => pruneRules(project.rules ?? seed.rules, new Set(index.keys())),
    [project.rules, seed.rules, index],
  )
  const conflicts = useMemo(() => analyseRules(layers, rules, index), [layers, rules, index])
  const active = useMemo(() => activeRules(rules, conflicts), [rules, conflicts])
  const tokens = project.tokens === undefined ? seed.tokens : project.tokens
  const counts = useMemo(() => (tokens ? countTraits(tokens) : {}), [tokens])
  // By layer and trait name, every collection together: what a marketplace counts (legacy token details).
  const attributes = useMemo(() => attributeCounts(tokens ?? [], index), [tokens, index])
  const keyOf = useMemo(() => attributeKeyOf(index), [index])
  const perCollection = useMemo(() => countByCollection(tokens ?? []), [tokens])
  const breaking = useMemo(() => (tokens ? tokensBreakingRules(tokens, active) : []), [tokens, active])

  const [generating, setGenerating] = useState(false)
  const [progress, setProgress] = useState(0)
  const [problems, setProblems] = useState<string[]>([])
  const timers = useRef<number[]>([])
  useEffect(() => () => timers.current.forEach((id) => window.clearTimeout(id)), [])

  const setTokens = (next: GeneratedToken[] | null, clearStale = false) =>
    update((p) => ({ ...p, tokens: next, staleNote: clearStale ? null : p.staleNote }))

  /** The supply is set at Generate: the sum of the collections' sizes. */
  const saveSupply = async (total: number) => {
    try {
      const result = await setCollectionSupply(collectionId, total)
      if (!result.ok) toast.error(result.error)
    } catch {
      toast.error('The supply could not be saved. Generate again to retry.')
    }
  }

  const generate = () => {
    if (nameProblem) {
      setProblems([nameProblem])
      return
    }
    setGenerating(true)
    setProblems([])
    setProgress(8)
    const started = performance.now()
    // Let the progress state paint before the synchronous generator runs.
    timers.current.push(
      window.setTimeout(() => {
        setProgress(35)
        const outcome = generateSet(layers, active, collections, newSeed(), ctx, tokenDescription.trim())
        const wait = Math.max(0, MIN_GENERATE_MS - (performance.now() - started))
        timers.current.push(window.setTimeout(() => setProgress(80), wait / 2))
        timers.current.push(
          window.setTimeout(() => {
            setProgress(100)
            if (outcome.ok) {
              setTokens(outcome.tokens, true)
              void saveSupply(outcome.tokens.length)
            } else setProblems(outcome.problems)
            setGenerating(false)
          }, wait),
        )
      }, 60),
    )
  }

  return {
    collections,
    supply,
    /** Tokens generated per collection, by collection id. */
    perCollection,
    /** One collection's layers; a token's DNA follows its collection's. */
    layersOf: (id: string) => layersOf(layers, id),
    setSize: (id: string, size: number) =>
      update((p) => ({ ...p, collections: setCollectionSize(p.collections ?? collections, id, size) })),
    layers,
    index,
    rules,
    active,
    conflicts,
    tokens,
    counts,
    /** Tokens with the same attribute (layer and trait name) as this trait, every collection together. */
    attributeCount: (traitId: string) => attributes.get(keyOf(traitId)) ?? 0,
    breaking,
    staleNote: project.staleNote,
    generating,
    progress,
    problems,
    dismissProblems: () => setProblems([]),
    generate,

    /** The token name ("<name> #<id>") and description; a valid new name renames the set at once. */
    tokenName,
    tokenDescription,
    nameProblem,
    setTokenName: (name: string) =>
      update((p) => {
        const next = { ...p, tokenName: name }
        if (tokenNameProblem(name) || !p.tokens) return next
        return { ...next, tokens: renameTokens(p.tokens, { tokenName: name, index }) }
      }),
    /** The description new tokens get. Tokens already generated keep theirs; regenerate to apply it. */
    setTokenDescription: (description: string) => update((p) => ({ ...p, tokenDescription: description })),
    /** Blank traits written into the metadata (legacy `show_blank_traits`). */
    showBlankTraits: project.showBlankTraits,
    describe: (tokenId: number, description: string) =>
      tokens && setTokens(setDescription(tokens, tokenId, description)),
    describeAll: () =>
      tokens && setTokens(tokens.map((token) => ({ ...token, description: tokenDescription.trim() }))),

    regenerate: (ids: ReadonlySet<number>) => {
      if (!tokens) return false
      const next = regenerate(tokens, ids, layers, active, ctx)
      if (next) setTokens(next)
      return !!next
    },
    fill: () => {
      if (!tokens) return false
      const next = fillTo(tokens, collections, layers, active, ctx, tokenDescription.trim())
      if (next) setTokens(next)
      return !!next
    },
    remove: (ids: ReadonlySet<number>) => tokens && setTokens(deleteTokens(tokens, ids, ctx)),
    shuffle: (ids: ReadonlySet<number>) => tokens && setTokens(shuffleIds(tokens, ids, ctx)),
    swap: (a: number, b: number) => tokens && setTokens(swapIds(tokens, a, b, ctx)),
    change: (tokenId: number, layerIndex: number, traitId: string) => {
      if (!tokens) return { ok: false as const, reason: 'Nothing is generated yet.' }
      const outcome = changeTrait(tokens, tokenId, layerIndex, traitId, active, ctx)
      if (outcome.ok) setTokens(outcome.tokens)
      return outcome
    },
  }
}

export type Generator = ReturnType<typeof useGenerator>
