import { LOCKED, SAVE_INCOMPLETE, fail, type ActionResult } from '@/lib/art/result'
import { chunkRowsByBytes, TOKEN_CHUNK } from '@/lib/art/token-ops'
import type { GeneratedToken } from '@/lib/demo'

export type TokenSaveDeps = {
  saveTokens: (rows: GeneratedToken[], seed: number) => Promise<ActionResult>
  appendTokens: (rows: GeneratedToken[]) => Promise<ActionResult>
  clearTokens: () => Promise<ActionResult>
  /** The row as it is sent, for sizing a chunk; the store token itself when absent. */
  wire?: (row: GeneratedToken) => unknown
}

/** A failed save says whether the stored set was cleared (a later chunk failed) or left as it was. */
export type SaveSetResult = ActionResult | { ok: false; error: string; cleared: true }

/**
 * Saves a generated set in chunks of at most `CHUNK_BUDGET_BYTES` of JSON (and `TOKEN_CHUNK` rows): the first replaces the stored set (and sets the
 * seed), the rest append in order. If a later chunk fails, `clearTokens` is attempted; if it also
 * fails, a partial set may remain and the next Generate replaces it. A failure after the first
 * chunk comes back with `cleared: true`, so the screen shows no tokens, as the stored set has none.
 * A lock refusal keeps its sentence so the queue turns the screens read only.
 */
export async function saveTokenSet(
  tokens: GeneratedToken[],
  seed: number,
  deps: TokenSaveDeps,
): Promise<SaveSetResult> {
  const [head = [], ...rest] = chunkRowsByBytes(tokens, undefined, deps.wire)
  const first = await deps.saveTokens(head, seed)
  if (!first.ok) return first
  for (const chunk of rest) {
    let result: ActionResult
    try {
      result = await deps.appendTokens(chunk)
    } catch {
      result = fail(SAVE_INCOMPLETE)
    }
    if (!result.ok) {
      try {
        await deps.clearTokens()
      } catch {
        // The sentence below already tells the creator to generate again.
      }
      return { ...(result.error === LOCKED ? result : fail(SAVE_INCOMPLETE)), cleared: true }
    }
  }
  return first
}

/**
 * Deletes token ids in chunks of `chunk`, highest id first: the database renumbers every later
 * token after each call, so deleting from the top leaves the lower ids in a later chunk unchanged.
 * Stops at the first failure.
 */
export async function deleteInChunks(
  ids: Iterable<number>,
  remove: (chunk: number[]) => Promise<ActionResult<unknown>>,
  chunk: number = TOKEN_CHUNK,
): Promise<ActionResult<unknown>> {
  const sorted = [...ids].sort((a, b) => b - a)
  for (let at = 0; at < sorted.length; at += chunk) {
    const result = await remove(sorted.slice(at, at + chunk))
    if (!result.ok) return result
  }
  return { ok: true, data: undefined }
}
