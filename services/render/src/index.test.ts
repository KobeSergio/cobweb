import { describe, expect, it } from 'vitest'
import * as render from './index'

describe('the package entry', () => {
  it('exports the batch helpers the worker splits tokens with', () => {
    expect(render.batchOf(100, 100)).toBe(0)
    expect(render.batchOf(101, 100)).toBe(1)
    expect(render.isGenerativeToken({ id: 1, collectionId: 'a', dna: [], description: null })).toBe(true)
  })
})
