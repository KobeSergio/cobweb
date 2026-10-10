import { buildOneOfOneTokens } from '@/components/art/assets/token-list'
import { supplyLimit, type ProjectType } from '@/lib/collections'
import type { Json } from '@/lib/database.types'

/** An `uploads` row of kind asset, as the lock reads it. */
export type AssetUploadRow = {
  id: string
  quantity: number
  attributes: Json
  position: number | null
  created_at: string
}

/** One token of a 1/1 or single asset list: what `art_lock` checks and `render_jobs.token_list` stores. */
export type AssetToken = { id: number; uploadId: string; attributes: Json }

export type AssetProblem = { code: 'files' | 'ids' | 'size'; message: string }

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/**
 * File order as `art_lock` reads it: position (unset last), then upload time, then id. PostgREST
 * writes every `created_at` with the same offset, so the strings compare as the times do.
 */
export function orderAssetRows(rows: AssetUploadRow[]): AssetUploadRow[] {
  const unplaced = Number.MAX_SAFE_INTEGER
  return [...rows].sort(
    (a, b) =>
      (a.position ?? unplaced) - (b.position ?? unplaced) ||
      compare(a.created_at, b.created_at) ||
      compare(a.id, b.id),
  )
}

/**
 * The token list of a 1/1 or single asset project (spec section 5): every edition of every file, ids
 * 1 to N in file order with each file's editions in a row, each carrying its file's attributes as
 * stored. A single asset is one file with `quantity` tokens.
 */
export function buildAssetTokenList(rows: AssetUploadRow[]): AssetToken[] {
  const ordered = orderAssetRows(rows)
  const attributes = new Map(ordered.map((row) => [row.id, row.attributes]))
  const tokens = buildOneOfOneTokens(
    ordered.map((row) => ({ key: row.id, fileName: row.id, quantity: row.quantity, attributes: [] })),
    { name: 'Token', description: '', order: 'upload', seed: 0 },
  )
  return tokens.map((token) => ({
    id: token.id,
    uploadId: token.itemKey,
    attributes: attributes.get(token.itemKey) ?? [],
  }))
}

/** The form that is hashed: `[id, uploadId, attributes]` sorted by id, as compact JSON. */
export function canonicalAssetList(tokens: AssetToken[]): string {
  return JSON.stringify(
    [...tokens].sort((a, b) => a.id - b.id).map((token) => [token.id, token.uploadId, token.attributes]),
  )
}

/** SHA-256 of the canonical form, as `0x` and 64 lowercase hex characters, like `hashTokenList` in @cobweb/dna. */
export async function hashAssetTokenList(tokens: AssetToken[]): Promise<`0x${string}`> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalAssetList(tokens)))
  return `0x${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

/** The checks for an asset list (spec section 5): at least one file, contiguous ids, within the type's cap. */
export function assetListProblems(tokens: AssetToken[], projectType: ProjectType): AssetProblem[] {
  if (tokens.length === 0) return [{ code: 'files', message: 'Add at least one file before locking.' }]
  const problems: AssetProblem[] = []
  const ids = tokens.map((token) => token.id).sort((a, b) => a - b)
  if (ids.some((id, index) => id !== index + 1))
    problems.push({
      code: 'ids',
      message: `Token ids must run from 1 to ${tokens.length.toLocaleString('en-US')} with no gaps or repeats.`,
    })
  const limit = supplyLimit(projectType)
  if (tokens.length > limit)
    problems.push({
      code: 'size',
      message: `The files make ${tokens.length.toLocaleString('en-US')} tokens. This project can have at most ${limit.toLocaleString('en-US')}.`,
    })
  return problems
}
