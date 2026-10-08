import { MAX_SUPPLY } from '@/lib/collections'
import type { GeneratedToken } from '@/lib/demo'
import { SAVE_CAP } from './result'

/**
 * How the Generate screen's edits on the set become token rows (spec section 8). Names and ranks
 * are computed, never stored, so only ids, art collections, DNA and descriptions travel.
 */
/** Most rows one token action carries; a larger set is saved in chunks. */
export const TOKEN_CHUNK = 10_000

/**
 * The most JSON a token chunk may serialize to. Server actions take 8 MB here (next.config.ts) but a
 * Vercel request is capped at 4.5 MB, so a chunk stays well under that. Row count alone is not a
 * bound: 10 layers of DNA with 500 character descriptions is about 9 MB at 10,000 rows.
 */
export const CHUNK_BUDGET_BYTES = 3_500_000

export type TokenInput = {
  tokenId: number
  artCollectionId: string
  dna: string[]
  description: string | null
}
export type TokenPatch = { tokenId: number; dna?: string[]; description?: string | null }

/**
 * The description to store: null when it is the project's own, since a null row reads back as the
 * project description (`toProject` in rows.ts) and 500 characters per token would otherwise travel.
 */
export function sentDescription(description: string | undefined | null, project: string | undefined) {
  if (description === undefined || description === null) return null
  if (project !== undefined && (description === project || description === project.trim())) return null
  return description
}

export function tokenInput(token: GeneratedToken, projectDescription?: string): TokenInput {
  return {
    tokenId: token.id,
    artCollectionId: token.collectionId,
    dna: token.dna,
    description: sentDescription(token.description, projectDescription),
  }
}

export function tokenInputs(tokens: GeneratedToken[], projectDescription?: string): TokenInput[] {
  return tokens.map((token) => tokenInput(token, projectDescription))
}

/**
 * Cuts rows into chunks whose `JSON.stringify` stays under `budget` characters and that never hold
 * more than `TOKEN_CHUNK` rows; every chunk has at least one row. `wire` maps a row to what is
 * sent, when that differs from the row.
 */
export function chunkRowsByBytes<T>(
  rows: readonly T[],
  budget: number = CHUNK_BUDGET_BYTES,
  wire: (row: T) => unknown = (row) => row,
): T[][] {
  const chunks: T[][] = []
  let current: T[] = []
  // Brackets, plus a comma between rows.
  let size = 2
  for (const row of rows) {
    const length = JSON.stringify(wire(row)).length
    const added = length + (current.length > 0 ? 1 : 0)
    if (current.length > 0 && (size + added >= budget || current.length >= TOKEN_CHUNK)) {
      chunks.push(current)
      current = []
      size = 2
    }
    size += length + (current.length > 0 ? 1 : 0)
    current.push(row)
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

const sameDna = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i])

/** The rows whose DNA or description changed between two versions of the set with the same ids. */
export function changedTokens(
  before: GeneratedToken[],
  after: GeneratedToken[],
  projectDescription?: string,
): TokenPatch[] {
  const old = new Map(before.map((token) => [token.id, token]))
  const patches: TokenPatch[] = []
  for (const token of after) {
    const was = old.get(token.id)
    if (!was) continue
    const patch: TokenPatch = { tokenId: token.id }
    if (!sameDna(was.dna, token.dna)) patch.dna = token.dna
    if ((was.description ?? null) !== (token.description ?? null))
      patch.description = sentDescription(token.description, projectDescription)
    if (patch.dna !== undefined || patch.description !== undefined) patches.push(patch)
  }
  return patches
}

/** The tokens added after the last id of the set before (Fill to size). */
export function appendedTokens(
  before: GeneratedToken[],
  after: GeneratedToken[],
  projectDescription?: string,
): TokenInput[] {
  const last = before.reduce((max, token) => Math.max(max, token.id), 0)
  return tokenInputs(
    after.filter((token) => token.id > last),
    projectDescription,
  )
}

/** Why a set of this many tokens cannot be saved, worded for the creator, or null. */
export function saveLimitProblem(count: number): string | null {
  if (count <= MAX_SUPPLY) return null
  return SAVE_CAP
}
