import { describe, expect, it, vi } from 'vitest'
import { TOKEN_CHUNK } from '@/lib/art/token-ops'
import { SAVE_INCOMPLETE, done, fail, type ActionResult } from '@/lib/art/result'
import type { GeneratedToken } from '@/lib/demo'
import { saveTokenSet } from './token-save'

const tokens = (count: number) =>
  Array.from({ length: count }, (_, id) => ({ id }) as unknown as GeneratedToken)

function deps(failAppendAt = -1) {
  let appends = 0
  return {
    saveTokens: vi.fn(async (): Promise<ActionResult> => done),
    appendTokens: vi.fn(async (): Promise<ActionResult> => {
      appends += 1
      return appends === failAppendAt ? fail('Nope.') : done
    }),
    clearTokens: vi.fn(async (): Promise<ActionResult> => done),
  }
}

describe('saveTokenSet', () => {
  it('saves a small set in one call with the seed', async () => {
    const d = deps()
    expect(await saveTokenSet(tokens(5), 7, d)).toEqual(done)
    expect(d.saveTokens).toHaveBeenCalledWith(tokens(5), 7)
    expect(d.appendTokens).not.toHaveBeenCalled()
  })

  it('saves three chunks in order', async () => {
    const d = deps()
    const all = tokens(TOKEN_CHUNK * 2 + 1)
    expect(await saveTokenSet(all, 7, d)).toEqual(done)
    expect(d.saveTokens.mock.calls[0]).toEqual([all.slice(0, TOKEN_CHUNK), 7])
    expect(d.appendTokens.mock.calls).toEqual([
      [all.slice(TOKEN_CHUNK, TOKEN_CHUNK * 2)],
      [all.slice(TOKEN_CHUNK * 2)],
    ])
    expect(d.clearTokens).not.toHaveBeenCalled()
  })

  it('clears the set when a later chunk fails', async () => {
    const d = deps(1)
    expect(await saveTokenSet(tokens(TOKEN_CHUNK * 3), 7, d)).toEqual(fail(SAVE_INCOMPLETE))
    expect(d.appendTokens).toHaveBeenCalledTimes(1)
    expect(d.clearTokens).toHaveBeenCalledTimes(1)
  })

  it('returns the first chunk error unchanged without clearing', async () => {
    const d = deps()
    d.saveTokens.mockResolvedValueOnce(fail('Locked.'))
    expect(await saveTokenSet(tokens(TOKEN_CHUNK * 2), 7, d)).toEqual(fail('Locked.'))
    expect(d.appendTokens).not.toHaveBeenCalled()
    expect(d.clearTokens).not.toHaveBeenCalled()
  })
})
