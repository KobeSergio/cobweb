import { describe, expect, it, vi } from 'vitest'
import { CHUNK_BUDGET_BYTES, TOKEN_CHUNK } from '@/lib/art/token-ops'
import { LOCKED, SAVE_INCOMPLETE, done, fail, type ActionResult } from '@/lib/art/result'
import type { GeneratedToken } from '@/lib/demo'
import { deleteInChunks, saveTokenSet } from './token-save'

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
    expect(await saveTokenSet(tokens(TOKEN_CHUNK * 3), 7, d)).toEqual({
      ...fail(SAVE_INCOMPLETE),
      cleared: true,
    })
    expect(d.appendTokens).toHaveBeenCalledTimes(1)
    expect(d.clearTokens).toHaveBeenCalledTimes(1)
  })

  it('returns the first chunk error unchanged without clearing, and not as cleared', async () => {
    const d = deps()
    d.saveTokens.mockResolvedValueOnce(fail('Locked.'))
    expect(await saveTokenSet(tokens(TOKEN_CHUNK * 2), 7, d)).toEqual(fail('Locked.'))
    expect(d.appendTokens).not.toHaveBeenCalled()
    expect(d.clearTokens).not.toHaveBeenCalled()
  })

  it('treats a thrown append as a failed chunk and clears', async () => {
    const d = deps()
    d.appendTokens.mockRejectedValueOnce(new Error('offline'))
    expect(await saveTokenSet(tokens(TOKEN_CHUNK + 1), 7, d)).toEqual({
      ...fail(SAVE_INCOMPLETE),
      cleared: true,
    })
    expect(d.clearTokens).toHaveBeenCalledTimes(1)
  })

  it('still reports the incomplete set when clearTokens throws', async () => {
    const d = deps(1)
    d.clearTokens.mockRejectedValueOnce(new Error('offline'))
    expect(await saveTokenSet(tokens(TOKEN_CHUNK + 1), 7, d)).toEqual({
      ...fail(SAVE_INCOMPLETE),
      cleared: true,
    })
  })

  it('returns the lock sentence from a later chunk unchanged, after trying to clear', async () => {
    const d = deps()
    d.appendTokens.mockResolvedValueOnce(fail(LOCKED))
    expect(await saveTokenSet(tokens(TOKEN_CHUNK + 1), 7, d)).toEqual({ ...fail(LOCKED), cleared: true })
    expect(d.clearTokens).toHaveBeenCalledTimes(1)
  })
})

describe('saveTokenSet by bytes', () => {
  it('cuts chunks by their serialized size when the rows are large', async () => {
    const d = deps()
    const big = Array.from({ length: 10 }, (_, id) => ({ id, text: 'x'.repeat(1_000_000) }) as never)
    expect(await saveTokenSet(big, 7, d)).toEqual(done)
    // 1 MB rows under a 3.5 MB budget: three rows, three rows, three rows, one row.
    expect(d.saveTokens.mock.calls[0]).toEqual([big.slice(0, 3), 7])
    expect(d.appendTokens).toHaveBeenCalledTimes(3)
    expect(CHUNK_BUDGET_BYTES).toBe(3_500_000)
  })
})

describe('deleteInChunks', () => {
  it('ends with the same set as one delete, over three chunks, when the database renumbers', async () => {
    const labels = Array.from({ length: 12 }, (_, i) => `t${i + 1}`)
    const model = [...labels]
    const ids = new Set([2, 11, 5, 7, 3, 9, 1])
    const calls: number[][] = []
    const result = await deleteInChunks(
      ids,
      async (chunk) => {
        calls.push(chunk)
        // The database removes these ids and renumbers the later tokens.
        for (const id of [...chunk].sort((a, b) => b - a)) model.splice(id - 1, 1)
        return { ok: true, data: undefined }
      },
      3,
    )
    expect(result.ok).toBe(true)
    expect(calls).toHaveLength(3)
    expect(model).toEqual(labels.filter((_, i) => !ids.has(i + 1)))
  })

  it('stops at the first failure', async () => {
    let calls = 0
    const result = await deleteInChunks(
      [1, 2, 3, 4],
      async () => (++calls === 1 ? { ok: false, error: 'no' } : { ok: true, data: undefined }),
      2,
    )
    expect(result.ok).toBe(false)
    expect(calls).toBe(1)
  })
})
