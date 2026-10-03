'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ArtRule, GeneratedToken, Layer } from '@/lib/demo'
import { buildTraitIndex } from '../lib/trait-index'
import { useArtProject } from '../state/art-store'
import { pruneRules } from '../state/layer-edits'
import { activeRules, analyseRules } from '../state/rule-logic'
import {
  changeTrait,
  countTraits,
  deleteTokens,
  fillTo,
  generateSet,
  newSeed,
  regenerate,
  shuffleIds,
  swapIds,
  tokensBreakingRules,
} from '../state/token-logic'

/** Long enough to read as work being done, short enough not to be in the way. */
const MIN_GENERATE_MS = 900

/**
 * The generated set and every curation action on it. Actions apply at once; a refused trait
 * change comes back as `{ ok: false, reason }`, and a bulk re-roll that cannot finish returns false.
 *
 * Seam: generation moves to `packages/dna` (Phase 3), possibly in a worker; the screen only
 * needs `generate`, the curation calls and `tokens`.
 */
export function useGenerator(
  collectionId: string,
  collectionName: string,
  supply: number,
  seed: { layers: Layer[]; rules: ArtRule[]; tokens: GeneratedToken[] },
) {
  const [project, update] = useArtProject(collectionId, seed)
  const layers = project.layers ?? seed.layers
  const index = useMemo(() => buildTraitIndex(layers), [layers])
  const rules = useMemo(
    () => pruneRules(project.rules ?? seed.rules, new Set(index.keys())),
    [project.rules, seed.rules, index],
  )
  const conflicts = useMemo(() => analyseRules(layers, rules, index), [layers, rules, index])
  const active = useMemo(() => activeRules(rules, conflicts), [rules, conflicts])
  const tokens = project.tokens === undefined ? seed.tokens : project.tokens
  const counts = useMemo(() => (tokens ? countTraits(tokens) : {}), [tokens])
  const breaking = useMemo(() => (tokens ? tokensBreakingRules(tokens, active) : []), [tokens, active])

  const [generating, setGenerating] = useState(false)
  const [progress, setProgress] = useState(0)
  const [problems, setProblems] = useState<string[]>([])
  const timers = useRef<number[]>([])
  useEffect(() => () => timers.current.forEach((id) => window.clearTimeout(id)), [])

  const setTokens = (next: GeneratedToken[] | null, clearStale = false) =>
    update((p) => ({ ...p, tokens: next, staleNote: clearStale ? null : p.staleNote }))

  const generate = () => {
    setGenerating(true)
    setProblems([])
    setProgress(8)
    const started = performance.now()
    // Let the progress state paint before the synchronous generator runs.
    timers.current.push(
      window.setTimeout(() => {
        setProgress(35)
        const outcome = generateSet(layers, active, supply, newSeed(), collectionName)
        const wait = Math.max(0, MIN_GENERATE_MS - (performance.now() - started))
        timers.current.push(window.setTimeout(() => setProgress(80), wait / 2))
        timers.current.push(
          window.setTimeout(() => {
            setProgress(100)
            if (outcome.ok) setTokens(outcome.tokens, true)
            else setProblems(outcome.problems)
            setGenerating(false)
          }, wait),
        )
      }, 60),
    )
  }

  return {
    layers,
    index,
    rules,
    active,
    conflicts,
    tokens,
    counts,
    breaking,
    staleNote: project.staleNote,
    generating,
    progress,
    problems,
    dismissProblems: () => setProblems([]),
    generate,

    regenerate: (ids: ReadonlySet<number>) => {
      if (!tokens) return false
      const next = regenerate(tokens, ids, layers, active, collectionName)
      if (next) setTokens(next)
      return !!next
    },
    fill: () => {
      if (!tokens) return false
      const next = fillTo(tokens, supply, layers, active, collectionName)
      if (next) setTokens(next)
      return !!next
    },
    remove: (ids: ReadonlySet<number>) => tokens && setTokens(deleteTokens(tokens, ids, collectionName)),
    shuffle: (ids: ReadonlySet<number>) => tokens && setTokens(shuffleIds(tokens, ids, collectionName)),
    swap: (a: number, b: number) => tokens && setTokens(swapIds(tokens, a, b, collectionName)),
    change: (tokenId: number, layerIndex: number, traitId: string) => {
      if (!tokens) return { ok: false as const, reason: 'Nothing is generated yet.' }
      const outcome = changeTrait(tokens, tokenId, layerIndex, traitId, active, index, collectionName)
      if (outcome.ok) setTokens(outcome.tokens)
      return outcome
    },
  }
}

export type Generator = ReturnType<typeof useGenerator>
