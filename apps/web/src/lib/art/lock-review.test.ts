import type { Project, TokenCore } from '@cobweb/dna'
import { describe, expect, it } from 'vitest'
import { EMPTY_REVIEW, lockRefusal, reviewChecks, reviewData, type LockList } from './lock-review'

const project: Project = {
  collections: [{ id: 'c1', name: 'Owls', size: 2 }],
  layers: [
    {
      id: 'l1',
      collectionId: 'c1',
      name: 'Eyes',
      position: 0,
      traits: [
        { id: 'none', layerId: 'l1', name: 'None', weight: 0, blank: true, imageUrl: null },
        { id: 'wide', layerId: 'l1', name: 'Wide', weight: 50, constant: 1, blank: false, imageUrl: null },
        { id: 'sleepy', layerId: 'l1', name: 'Sleepy', weight: 50, blank: false, imageUrl: null },
      ],
    },
  ],
  rules: [],
  atLeastOne: [],
}

const generative = (tokens: TokenCore[]): LockList => ({ kind: 'generative', project, tokens })

describe('reviewData for a generative project', () => {
  it('passes a valid set and counts what will be locked', () => {
    const review = reviewData(
      generative([
        { id: 1, collectionId: 'c1', dna: ['wide'] },
        { id: 2, collectionId: 'c1', dna: ['sleepy'] },
      ]),
      'generative',
    )
    expect(review).toEqual({
      problems: [],
      tokenCount: 2,
      supply: 2,
      allowDuplicatesNeeded: false,
      counts: { collections: 1, layers: 1, traits: 2, rules: 0 },
      constants: [{ name: 'Wide', count: 1 }],
      credit: false,
    })
    expect(lockRefusal(review, false)).toBeNull()
  })

  it('offers "Allow identical tokens" only when duplicates are the only problem', () => {
    const review = reviewData(
      generative([
        { id: 1, collectionId: 'c1', dna: ['sleepy'] },
        { id: 2, collectionId: 'c1', dna: ['sleepy'] },
      ]),
      'generative',
    )
    expect(review.problems.map((p) => p.code)).toEqual(['duplicate'])
    expect(review.allowDuplicatesNeeded).toBe(true)
    expect(lockRefusal(review, false)).toMatch(/have the same traits as another token/)
    expect(lockRefusal(review, true)).toBeNull()
  })

  it('keeps refusing a set with other problems even when identical tokens are allowed', () => {
    const review = reviewData(
      generative([
        { id: 1, collectionId: 'c1', dna: ['wide'] },
        { id: 2, collectionId: 'c1', dna: ['wide'] },
      ]),
      'generative',
    )
    expect(review.problems.map((p) => p.code)).toEqual(['cap', 'duplicate'])
    expect(review.allowDuplicatesNeeded).toBe(false)
    expect(lockRefusal(review, true)).toMatch(/more than its cap of 1/)
  })

  it('asks for the set to be generated when there are no tokens', () => {
    const review = reviewData(generative([]), 'generative')
    expect(review.problems[0]).toEqual({ code: 'size', message: 'Generate the set before locking.' })
    expect(lockRefusal(review, true)).toBe('Generate the set before locking.')
  })

  it('never claims a credit on its own: the database decides that', () => {
    const review = reviewData(generative([{ id: 1, collectionId: 'c1', dna: ['wide'] }]), 'generative')
    expect(review.credit).toBe(false)
    expect(EMPTY_REVIEW.credit).toBe(false)
  })
})

describe('reviewData for assets', () => {
  it('uses the asset checks and the token count as the supply', () => {
    const list: LockList = {
      kind: 'assets',
      tokens: [1, 2, 3].map((id) => ({ id, uploadId: 'u1', attributes: [] })),
    }
    expect(reviewData(list, 'single_asset')).toMatchObject({ problems: [], tokenCount: 3, supply: 3 })
    expect(reviewData({ kind: 'assets', tokens: [] }, 'one_of_one').problems).toEqual([
      { code: 'files', message: 'Add at least one file before locking.' },
    ])
  })
})

describe('reviewChecks', () => {
  it('sorts the problems into the four checks of the review step', () => {
    const review = reviewData(
      generative([
        { id: 1, collectionId: 'c1', dna: ['wide'] },
        { id: 2, collectionId: 'c1', dna: ['wide'] },
        { id: 3, collectionId: 'c1', dna: ['nope'] },
      ]),
      'generative',
    )
    const checks = reviewChecks(review, false)
    expect(checks.map((c) => [c.key, c.problems.length])).toEqual([
      ['supply', 1],
      ['duplicates', 1],
      ['rules', 1],
      ['caps', 1],
    ])
    expect(reviewChecks(review, true)[1]).toEqual({
      key: 'duplicates',
      label: 'Identical tokens are allowed',
      problems: [],
    })
  })
})
