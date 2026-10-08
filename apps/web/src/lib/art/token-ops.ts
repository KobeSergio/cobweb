import { MAX_SUPPLY } from '@/lib/collections'
import type { GeneratedToken } from '@/lib/demo'
import { SAVE_CAP } from './result'

/**
 * How the Generate screen's edits on the set become token rows (spec section 8). Names and ranks
 * are computed, never stored, so only ids, art collections, DNA and descriptions travel.
 */
/** Most rows one token action carries; a larger set is saved in chunks. */
export const TOKEN_CHUNK = 10_000

export type TokenInput = {
  tokenId: number
  artCollectionId: string
  dna: string[]
  description: string | null
}
export type TokenPatch = { tokenId: number; dna?: string[]; description?: string | null }

export function tokenInputs(tokens: GeneratedToken[]): TokenInput[] {
  return tokens.map((token) => ({
    tokenId: token.id,
    artCollectionId: token.collectionId,
    dna: token.dna,
    description: token.description ?? null,
  }))
}

const sameDna = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i])

/** The rows whose DNA or description changed between two versions of the set with the same ids. */
export function changedTokens(before: GeneratedToken[], after: GeneratedToken[]): TokenPatch[] {
  const old = new Map(before.map((token) => [token.id, token]))
  const patches: TokenPatch[] = []
  for (const token of after) {
    const was = old.get(token.id)
    if (!was) continue
    const patch: TokenPatch = { tokenId: token.id }
    if (!sameDna(was.dna, token.dna)) patch.dna = token.dna
    if ((was.description ?? null) !== (token.description ?? null))
      patch.description = token.description ?? null
    if (patch.dna !== undefined || patch.description !== undefined) patches.push(patch)
  }
  return patches
}

/** The tokens added after the last id of the set before (Fill to size). */
export function appendedTokens(before: GeneratedToken[], after: GeneratedToken[]): TokenInput[] {
  const last = before.reduce((max, token) => Math.max(max, token.id), 0)
  return tokenInputs(after.filter((token) => token.id > last))
}

/** Why a set of this many tokens cannot be saved, worded for the creator, or null. */
export function saveLimitProblem(count: number): string | null {
  if (count <= MAX_SUPPLY) return null
  return SAVE_CAP
}
