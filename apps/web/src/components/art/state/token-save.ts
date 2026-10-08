import { LOCKED, SAVE_INCOMPLETE, fail, type ActionResult } from '@/lib/art/result'
import { TOKEN_CHUNK } from '@/lib/art/token-ops'
import type { GeneratedToken } from '@/lib/demo'

export type TokenSaveDeps = {
  saveTokens: (rows: GeneratedToken[], seed: number) => Promise<ActionResult>
  appendTokens: (rows: GeneratedToken[]) => Promise<ActionResult>
  clearTokens: () => Promise<ActionResult>
}

/**
 * Saves a generated set in chunks of `TOKEN_CHUNK`: the first replaces the stored set (and sets the
 * seed), the rest append in order. If a later chunk fails, `clearTokens` is attempted; if it also
 * fails, a partial set may remain and the next Generate replaces it. A lock refusal is returned
 * unchanged so the queue turns the screens read only.
 */
export async function saveTokenSet(
  tokens: GeneratedToken[],
  seed: number,
  deps: TokenSaveDeps,
): Promise<ActionResult> {
  const first = await deps.saveTokens(tokens.slice(0, TOKEN_CHUNK), seed)
  if (!first.ok) return first
  for (let at = TOKEN_CHUNK; at < tokens.length; at += TOKEN_CHUNK) {
    let result: ActionResult
    try {
      result = await deps.appendTokens(tokens.slice(at, at + TOKEN_CHUNK))
    } catch {
      result = fail(SAVE_INCOMPLETE)
    }
    if (!result.ok) {
      try {
        await deps.clearTokens()
      } catch {
        // The sentence below already tells the creator to generate again.
      }
      return !result.ok && result.error === LOCKED ? result : fail(SAVE_INCOMPLETE)
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
