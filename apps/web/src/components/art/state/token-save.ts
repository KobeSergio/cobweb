import { SAVE_INCOMPLETE, fail, type ActionResult } from '@/lib/art/result'
import { TOKEN_CHUNK } from '@/lib/art/token-ops'
import type { GeneratedToken } from '@/lib/demo'

export type TokenSaveDeps = {
  saveTokens: (rows: GeneratedToken[], seed: number) => Promise<ActionResult>
  appendTokens: (rows: GeneratedToken[]) => Promise<ActionResult>
  clearTokens: () => Promise<ActionResult>
}

/**
 * Saves a generated set in chunks of `TOKEN_CHUNK`: the first replaces the stored set (and sets the
 * seed), the rest append in order. If a later chunk fails the partial set is cleared, so the
 * database never holds half a generation.
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
      return fail(SAVE_INCOMPLETE)
    }
  }
  return first
}
