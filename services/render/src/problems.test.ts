import { describe, expect, it } from 'vitest'
import { forToken, reasonOf, RenderProblem } from './problems'

describe('RenderProblem', () => {
  it('is an Error carrying a code, a token id and a detail', () => {
    const problem = new RenderProblem('bad-dna', 'Token 4 names a trait its layer does not have.', {
      tokenId: 4,
      detail: { trait: 'eyes-x' },
    })
    expect(problem).toBeInstanceOf(Error)
    expect(problem.name).toBe('RenderProblem')
    expect(problem.code).toBe('bad-dna')
    expect(problem.message).toBe('Token 4 names a trait its layer does not have.')
    expect(problem.tokenId).toBe(4)
    expect(problem.detail).toEqual({ trait: 'eyes-x' })
  })

  it('leaves token id and detail unset when not given', () => {
    const problem = new RenderProblem('empty-collage', 'A preview collage needs at least one image.')
    expect(problem.tokenId).toBeUndefined()
    expect(problem.detail).toBeUndefined()
  })

  it('tags a problem with its token once', () => {
    const tagged = forToken(
      new RenderProblem('decode', 'Layer 2 could not be read.', { detail: { layer: 1 } }),
      9,
    )
    expect(tagged.code).toBe('decode')
    expect(tagged.tokenId).toBe(9)
    expect(tagged.message).toBe('Token 9: Layer 2 could not be read.')
    expect(tagged.detail).toEqual({ layer: 1 })
    expect(forToken(tagged, 10)).toBe(tagged)
  })

  it('reads the reason of anything thrown', () => {
    expect(reasonOf(new Error('boom'))).toBe('boom')
    expect(reasonOf('plain')).toBe('plain')
  })
})
