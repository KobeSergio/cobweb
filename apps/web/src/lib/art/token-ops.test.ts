import { describe, expect, it } from 'vitest'
import type { GeneratedToken } from '@/lib/demo'
import { TOKEN_CHUNK, appendedTokens, changedTokens, saveLimitProblem, tokenInputs } from './token-ops'

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
})
