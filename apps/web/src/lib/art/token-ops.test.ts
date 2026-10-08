import { describe, expect, it } from 'vitest'
import type { GeneratedToken } from '@/lib/demo'
import {
  CHUNK_BUDGET_BYTES,
  TOKEN_CHUNK,
  appendedTokens,
  changedTokens,
  chunkRowsByBytes,
  saveLimitProblem,
  tokenInput,
  tokenInputs,
} from './token-ops'

const token = (id: number, dna: string[], description?: string): GeneratedToken => ({
  id,
  collectionId: 'art-1',
  dna,
  name: `Owl #${id}`,
  rank: id,
  previewUrl: null,
  ...(description === undefined ? {} : { description }),
})

describe('token operations', () => {
  it('turns the store tokens into saved rows; names and ranks are not sent', () => {
    expect(tokenInputs([token(1, ['a', 'b'], 'Hi'), token(2, ['a', 'c'])])).toEqual([
      { tokenId: 1, artCollectionId: 'art-1', dna: ['a', 'b'], description: 'Hi' },
      { tokenId: 2, artCollectionId: 'art-1', dna: ['a', 'c'], description: null },
    ])
  })

  it('sends only the rows whose DNA or description changed (re-roll, change one trait, describe)', () => {
    const before = [token(1, ['a', 'b'], 'x'), token(2, ['a', 'c'], 'x'), token(3, ['b', 'c'], 'x')]
    const after = [token(1, ['a', 'b'], 'x'), token(2, ['b', 'b'], 'x'), token(3, ['b', 'c'], 'y')]
    expect(changedTokens(before, after)).toEqual([
      { tokenId: 2, dna: ['b', 'b'] },
      { tokenId: 3, description: 'y' },
    ])
  })

  it('appends only the tokens past the last id (fill to size)', () => {
    const before = [token(1, ['a']), token(2, ['b'])]
    const after = [...before, token(3, ['c'])]
    expect(appendedTokens(before, after)).toEqual([
      { tokenId: 3, artCollectionId: 'art-1', dna: ['c'], description: null },
    ])
  })

  it('has a chunk of 10,000 rows per call', () => {
    expect(TOKEN_CHUNK).toBe(10_000)
  })

  it('refuses more than 100,000 tokens before anything is generated', () => {
    expect(saveLimitProblem(100_000)).toBeNull()
    expect(saveLimitProblem(100_001)).toBe(
      'A project can have at most 100,000 tokens. Lower the collection sizes.',
    )
  })

  it('sends a null description when it equals the project description', () => {
    expect(tokenInput(token(1, ['a'], 'Same'), 'Same').description).toBeNull()
    expect(tokenInput(token(1, ['a'], 'Other'), 'Same').description).toBe('Other')
    // Only the exact stored value stands for null.
    expect(tokenInput(token(1, ['a'], 'Same'), 'Same ').description).toBe('Same')
    expect(tokenInputs([token(1, ['a'], 'Same')], 'Same')[0]!.description).toBeNull()
    expect(appendedTokens([], [token(1, ['a'], 'Same')], 'Same')[0]!.description).toBeNull()
  })

  it('patches a description that equals the project description as null', () => {
    expect(changedTokens([token(1, ['a'], 'x')], [token(1, ['a'], 'Same')], 'Same')).toEqual([
      { tokenId: 1, description: null },
    ])
  })
})

describe('chunkRowsByBytes', () => {
  const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

  it('keeps every chunk of the worst case (50 layers, 500 character descriptions) under the budget', () => {
    const rows = Array.from({ length: 10_000 }, (_, i) => ({
      tokenId: i + 1,
      artCollectionId: uuid(1),
      dna: Array.from({ length: 50 }, (_, l) => uuid(l * 7 + (i % 5))),
      description: 'd'.repeat(500),
    }))
    const chunks = chunkRowsByBytes(rows, CHUNK_BUDGET_BYTES)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.flat()).toEqual(rows)
    for (const chunk of chunks) {
      expect(JSON.stringify(chunk).length).toBeLessThan(CHUNK_BUDGET_BYTES)
      expect(chunk.length).toBeLessThanOrEqual(TOKEN_CHUNK)
    }
  })

  it('measures UTF-8 bytes: 500 character CJK descriptions stay under the budget in bytes', () => {
    const rows = Array.from({ length: 10_000 }, (_, i) => ({
      tokenId: i + 1,
      artCollectionId: uuid(1),
      dna: Array.from({ length: 10 }, (_, l) => uuid(l * 7 + (i % 5))),
      description: '字'.repeat(500),
    }))
    const encoder = new TextEncoder()
    const chunks = chunkRowsByBytes(rows, CHUNK_BUDGET_BYTES)
    expect(chunks.flat()).toEqual(rows)
    for (const chunk of chunks)
      expect(encoder.encode(JSON.stringify(chunk)).length).toBeLessThan(CHUNK_BUDGET_BYTES)
  })

  it('splits at TOKEN_CHUNK rows however small the rows are', () => {
    const chunks = chunkRowsByBytes(Array.from({ length: TOKEN_CHUNK + 1 }, (_, i) => i))
    expect(chunks.map((chunk) => chunk.length)).toEqual([TOKEN_CHUNK, 1])
  })

  it('puts a row bigger than the budget in a chunk of its own, and returns no chunk for no rows', () => {
    expect(chunkRowsByBytes(['aaaa', 'b', 'c'], 10)).toEqual([['aaaa'], ['b', 'c']])
    expect(chunkRowsByBytes([], 5)).toEqual([])
  })

  it('measures the rows as they are sent when a wire shape is given', () => {
    const chunks = chunkRowsByBytes([{ big: 'x'.repeat(100) }, { big: 'y'.repeat(100) }], 30, () => 'a')
    expect(chunks).toHaveLength(1)
  })
})
