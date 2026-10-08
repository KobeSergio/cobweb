'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { setArtCollectionSize } from '@/app/actions/art/art-collections'
import { updateArtSettings } from '@/app/actions/art/settings'
import {
  appendTokens,
  clearTokens,
  deleteTokens as saveDeleted,
  saveTokens,
  swapTokens,
  updateTokens,
} from '@/app/actions/art/tokens'
import { setCollectionSupply } from '@/app/actions/collection-supply'
import { done, type ActionResult } from '@/lib/art/result'
import {
  appendedTokens,
  changedTokens,
  saveLimitProblem,
  TOKEN_CHUNK,
  tokenInputs,
} from '@/lib/art/token-ops'
import type { ArtRule, Collection, GeneratedToken, Layer } from '@/lib/demo'
import { attributeCounts, attributeKeyOf, buildTraitIndex } from '../lib/trait-index'
import { useArtProject, type ArtProject } from '../state/art-store'
import { useArtSync } from '../state/art-sync'
import { setCollectionSize, supplyOf } from '../state/collection-edits'
import { fillTo, generateSet, newSeed, regenerate, tokenNameProblem } from '../state/generation'
import { layersOf, pruneRules } from '../state/layer-edits'
import { activeRules, analyseRules } from '../state/rule-logic'
import { saveTokenSet } from '../state/token-save'
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

type Save = () => Promise<ActionResult<unknown>>

/** Saves `rows` in order in chunks of `TOKEN_CHUNK` (the most one token action takes), stopping at the first failure. */
function inChunks<T>(rows: T[], step: (chunk: T[]) => Promise<ActionResult<unknown>>): Save {
  return async () => {
    for (let at = 0; at < rows.length; at += TOKEN_CHUNK) {
      const result = await step(rows.slice(at, at + TOKEN_CHUNK))
      if (!result.ok) return result
    }
    return done
  }
}

/**
 * The generated set and every curation action on it. Actions apply at once and are saved through
 * `useArtSync()` as spec section 8 maps them; a refused trait change comes back as
 * `{ ok: false, reason }`, and a bulk re-roll that cannot finish returns false. The supply is the
 * sum of the collections' sizes; a successful generation saves the set with its seed (in chunks), then
 * the supply.
 */
export function useGenerator(
  collectionId: string,
  /** The project's name and description: what the token name and description start as. */
  project0: { name: string; description: string },
  start: { collections: Collection[]; layers: Layer[]; rules: ArtRule[]; tokens: GeneratedToken[] | null },
) {
  const sync = useArtSync()
  const [project] = useArtProject(collectionId, start)
  const collections = project.collections ?? start.collections
  const supply = supplyOf(collections)
  const layers = project.layers ?? start.layers
  const index = useMemo(() => buildTraitIndex(layers), [layers])
  const tokenName = project.tokenName ?? project0.name
  const tokenDescription = project.tokenDescription ?? project0.description
  // Both are required, as in the legacy auto-populate.
  const nameProblem = tokenNameProblem(tokenName)
  const ctx: SetContext = { tokenName, index, layers, atLeastOne: project.atLeastOne }
  const rules = useMemo(
    () => pruneRules(project.rules ?? start.rules, new Set(index.keys())),
    [project.rules, start.rules, index],
  )
  const conflicts = useMemo(() => analyseRules(layers, rules, index), [layers, rules, index])
  const active = useMemo(() => activeRules(rules, conflicts), [rules, conflicts])
  const tokens = project.tokens === undefined ? start.tokens : project.tokens
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
  /** The sizes, token name and description last saved, for a rollback when a debounced save fails. */
  const sizesBefore = useRef(new Map<string, number>())
  const savedName = useRef(tokenName)
  const savedDescription = useRef(tokenDescription)

  /** Shows a new set at once and saves it with `persist`, in order with every other edit. */
  const setTokens = (next: GeneratedToken[] | null, persist?: Save, extra: Partial<ArtProject> = {}) =>
    void sync.run({ apply: (p) => ({ ...p, tokens: next, ...extra }), persist })

  /** The supply is set at Generate: the sum of the collections' sizes. */
  const saveSupply = async (total: number) => {
    if (sync.demo) return
    try {
      const result = await setCollectionSupply(collectionId, total)
      if (!result.ok) toast.error(result.error)
    } catch {
      toast.error('The supply could not be saved. Generate again to retry.')
    }
  }

  /** Replaces the stored set (in chunks) and keeps the seed it came from. */
  const saveSet = (set: GeneratedToken[], seed: number) =>
    saveTokenSet(set, seed, {
      saveTokens: (rows, at) => saveTokens(collectionId, tokenInputs(rows), at),
      appendTokens: (rows) => appendTokens(collectionId, tokenInputs(rows)),
      clearTokens: () => clearTokens(collectionId),
    })

  const generate = () => {
    const problem = nameProblem ?? saveLimitProblem(supply)
    if (problem) {
      setProblems([problem])
      return
    }
    // Sizes and names still waiting go first, so the set is saved after what it was made from.
    sync.debounce.flushAll()
    setGenerating(true)
    setProblems([])
    setProgress(8)
    const started = performance.now()
    // Let the progress state paint before the synchronous generator runs.
    timers.current.push(
      window.setTimeout(() => {
        setProgress(35)
        const seed = newSeed()
        const outcome = generateSet(layers, active, collections, seed, ctx, tokenDescription.trim())
        const wait = Math.max(0, MIN_GENERATE_MS - (performance.now() - started))
        timers.current.push(window.setTimeout(() => setProgress(80), wait / 2))
        timers.current.push(
          window.setTimeout(() => {
            setProgress(100)
            if (outcome.ok) {
              setTokens(
                outcome.tokens,
                async () => {
                  const saved = await saveSet(outcome.tokens, seed)
                  if (saved.ok) await saveSupply(outcome.tokens.length)
                  return saved
                },
                { seed, staleNote: null },
              )
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
    /** Shows at once; saved 250 ms after the last change to that collection's size. */
    setSize: (id: string, size: number) => {
      const before = sync.read().collections?.find((c) => c.id === id)?.size
      if (before !== undefined && !sizesBefore.current.has(id)) sizesBefore.current.set(id, before)
      void sync.run({
        apply: (p) => ({ ...p, collections: setCollectionSize(p.collections ?? collections, id, size) }),
      })
      sync.debounce.schedule(`size:${id}`, () => {
        const saved = sizesBefore.current.get(id)
        sizesBefore.current.delete(id)
        const now = sync.read().collections?.find((c) => c.id === id)
        if (!now) return
        void sync.run({
          apply: (p) => p,
          persist: () => setArtCollectionSize(collectionId, id, now.size),
          undo: (p) =>
            saved === undefined
              ? p
              : { ...p, collections: setCollectionSize(p.collections ?? [], id, saved) },
        })
      })
    },
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
    /** The seed the set on screen was generated from, or null before the first generation. */
    generatedFrom: tokens && tokens.length > 0 ? project.seed : null,
    generating,
    progress,
    problems,
    dismissProblems: () => setProblems([]),
    generate,

    /** The token name ("<name> #<id>") and description; a valid new name renames the set at once. */
    tokenName,
    tokenDescription,
    nameProblem,
    setTokenName: (name: string) => {
      void sync.run({
        apply: (p) => {
          const next = { ...p, tokenName: name }
          if (tokenNameProblem(name) || !p.tokens) return next
          return { ...next, tokens: renameTokens(p.tokens, { tokenName: name, index }) }
        },
      })
      if (tokenNameProblem(name)) return
      sync.debounce.schedule('tokenName', () => {
        const previous = savedName.current
        void sync.run({
          apply: (p) => p,
          persist: async () => {
            const result = await updateArtSettings(collectionId, { tokenName: name })
            if (result.ok) savedName.current = name
            return result
          },
          undo: (p) => ({
            ...p,
            tokenName: previous,
            tokens: p.tokens ? renameTokens(p.tokens, { tokenName: previous, index }) : p.tokens,
          }),
        })
      })
    },
    /** The description new tokens get. Tokens already generated keep theirs; regenerate to apply it. */
    setTokenDescription: (description: string) => {
      void sync.run({ apply: (p) => ({ ...p, tokenDescription: description }) })
      sync.debounce.schedule('tokenDescription', () => {
        const previous = savedDescription.current
        void sync.run({
          apply: (p) => p,
          persist: async () => {
            const result = await updateArtSettings(collectionId, { tokenDescription: description })
            if (result.ok) savedDescription.current = description
            return result
          },
          undo: (p) => ({ ...p, tokenDescription: previous }),
        })
      })
    },
    /** Blank traits written into the metadata (legacy `show_blank_traits`). */
    showBlankTraits: project.showBlankTraits,
    describe: (tokenId: number, description: string) => {
      if (!tokens) return
      void sync.run({
        apply: (p) => ({ ...p, tokens: p.tokens && setDescription(p.tokens, tokenId, description) }),
      })
      sync.debounce.schedule(
        `describe:${tokenId}`,
        () =>
          void sync.run({
            apply: (p) => p,
            persist: () => updateTokens(collectionId, [{ tokenId, description }]),
          }),
      )
    },
    describeAll: () => {
      if (!tokens) return
      const next = tokens.map((token) => ({ ...token, description: tokenDescription.trim() }))
      sync.debounce.flushAll()
      setTokens(
        next,
        inChunks(changedTokens(tokens, next), (rows) => updateTokens(collectionId, rows)),
      )
    },

    regenerate: (ids: ReadonlySet<number>) => {
      if (!tokens) return false
      const next = regenerate(tokens, ids, layers, active, ctx)
      if (next) {
        sync.debounce.flushAll()
        setTokens(
          next,
          inChunks(changedTokens(tokens, next), (rows) => updateTokens(collectionId, rows)),
        )
      }
      return !!next
    },
    fill: () => {
      if (!tokens) return false
      const next = fillTo(tokens, collections, layers, active, ctx, tokenDescription.trim())
      if (next)
        setTokens(
          next,
          inChunks(appendedTokens(tokens, next), (rows) => appendTokens(collectionId, rows)),
        )
      return !!next
    },
    remove: (ids: ReadonlySet<number>) => {
      if (!tokens) return
      sync.debounce.flushAll()
      setTokens(
        deleteTokens(tokens, ids, ctx),
        inChunks([...ids], (chunk) => saveDeleted(collectionId, chunk)),
      )
    },
    shuffle: (ids: ReadonlySet<number>) => {
      if (!tokens) return
      const next = shuffleIds(tokens, ids, ctx)
      sync.debounce.flushAll()
      setTokens(next, () => saveSet(next, project.seed))
    },
    swap: (a: number, b: number) => {
      if (!tokens) return
      sync.debounce.flushAll()
      setTokens(swapIds(tokens, a, b, ctx), () => swapTokens(collectionId, a, b))
    },
    change: (tokenId: number, layerIndex: number, traitId: string) => {
      if (!tokens) return { ok: false as const, reason: 'Nothing is generated yet.' }
      const outcome = changeTrait(tokens, tokenId, layerIndex, traitId, active, ctx)
      if (outcome.ok)
        setTokens(outcome.tokens, () => updateTokens(collectionId, changedTokens(tokens, outcome.tokens)))
      return outcome
    },
  }
}

export type Generator = ReturnType<typeof useGenerator>
