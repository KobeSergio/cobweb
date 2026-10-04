import { describe, expect, it } from 'vitest'
import {
  attributeRowsError,
  attributesForReplacement,
  buildOneOfOneTokens,
  fileBaseName,
  fileNameAttribute,
  formatIds,
  idsByItem,
  inBatches,
  isHiddenFile,
  matchesTraitFilter,
  rankItems,
  sortIncoming,
  summarizeTraits,
  tokenIds,
  tokenNameError,
  traitKey,
  visibleItems,
  withAttribute,
  type TokenDetails,
  type TokenSource,
} from './token-list'

const details: TokenDetails = { name: 'Night Owl', description: ' A bird. ', order: 'upload', seed: 7 }

const item = (key: string, quantity: number, attributes: [string, string][] = []): TokenSource => ({
  key,
  fileName: `${key}.png`,
  quantity,
  attributes: attributes.map(([traitType, value]) => ({ traitType, value })),
})

describe('file names', () => {
  it('strips the extension, as legacy <file_name>', () => {
    expect(fileBaseName('golden-owl.final.png')).toBe('golden-owl.final')
    expect(fileBaseName('noext')).toBe('noext')
    expect(fileNameAttribute('Owl 1.jpg')).toEqual({ traitType: 'Name', value: 'Owl 1' })
  })

  it('skips hidden files', () => {
    expect(isHiddenFile('.DS_Store')).toBe(true)
    expect(isHiddenFile('art/._owl.png')).toBe(true)
    expect(isHiddenFile('owl.png')).toBe(false)
  })

  it('separates repeats of a file already added, and repeats within the drop', () => {
    const files = [
      { name: 'a.png', size: 10 },
      { name: '.DS_Store', size: 1 },
      { name: 'b.png', size: 20 },
      { name: 'b.png', size: 20 },
      { name: 'b.png', size: 21 },
    ]
    const result = sortIncoming(files, [{ fileName: 'a.png', bytes: 10 }])
    expect(result.fresh.map((f) => `${f.name}:${f.size}`)).toEqual(['b.png:20', 'b.png:21'])
    expect(result.hidden).toHaveLength(1)
    expect(result.repeated.map((f) => f.name)).toEqual(['a.png', 'b.png'])
  })

  it('splits into batches of 25', () => {
    const batches = inBatches(Array.from({ length: 60 }, (_, i) => i))
    expect(batches.map((b) => b.length)).toEqual([25, 25, 10])
  })
})

describe('attributes', () => {
  it('replaces an attribute of the same trait type, case-insensitively', () => {
    const next = withAttribute([{ traitType: 'Background', value: 'Red' }], {
      traitType: 'background',
      value: 'Blue',
    })
    expect(next).toEqual([{ traitType: 'background', value: 'Blue' }])
    expect(withAttribute([], { traitType: 'Eyes', value: 'Laser' })).toHaveLength(1)
  })

  it('moves the Name attribute to the new file on replace, keeping the rest', () => {
    const before = [
      { traitType: 'Name', value: 'old' },
      { traitType: 'Edition', value: 'Gold' },
    ]
    expect(attributesForReplacement(before, 'old.png', 'new.mp4')).toEqual([
      { traitType: 'Name', value: 'new' },
      { traitType: 'Edition', value: 'Gold' },
    ])
    const custom = [{ traitType: 'Name', value: 'Hand typed' }]
    expect(attributesForReplacement(custom, 'old.png', 'new.png')).toEqual(custom)
  })

  it('refuses half-filled rows and a trait type used twice', () => {
    expect(attributeRowsError([{ traitType: 'Eyes', value: '' }])).toMatch(/both/)
    expect(
      attributeRowsError([
        { traitType: 'Eyes', value: 'Blue' },
        { traitType: 'eyes ', value: 'Red' },
      ]),
    ).toMatch(/twice/)
    expect(attributeRowsError([{ traitType: '', value: '' }])).toBeNull()
  })

  it('checks the token name as legacy did, without the character whitelist', () => {
    expect(tokenNameError('  ')).toMatch(/Enter/)
    expect(tokenNameError('x'.repeat(41))).toMatch(/40/)
    expect(tokenNameError('Owl #')).toMatch(/#/)
    expect(tokenNameError("Night Owl's")).toBeNull()
  })
})

describe('token list', () => {
  it('numbers every edition 1 to N in upload order, named "<name> #<id>"', () => {
    const tokens = buildOneOfOneTokens([item('a', 2), item('b', 1)], details)
    expect(tokens.map((t) => [t.id, t.name, t.itemKey, t.edition])).toEqual([
      [1, 'Night Owl #1', 'a', 1],
      [2, 'Night Owl #2', 'a', 2],
      [3, 'Night Owl #3', 'b', 1],
    ])
    expect(tokens[0]!.description).toBe('A bird.')
  })

  it('renumbers with no gaps when a file is removed or its editions lowered', () => {
    const before = buildOneOfOneTokens([item('a', 1), item('b', 3), item('c', 1)], details)
    expect(before.at(-1)!.id).toBe(5)
    const removed = buildOneOfOneTokens([item('a', 1), item('c', 1)], details)
    expect(removed.map((t) => t.name)).toEqual(['Night Owl #1', 'Night Owl #2'])
    const lowered = buildOneOfOneTokens([item('a', 1), item('b', 1), item('c', 1)], details)
    expect(lowered.map((t) => t.id)).toEqual([1, 2, 3])
  })

  it('shuffles ids as a permutation, repeatable from the seed', () => {
    const shuffled = tokenIds(50, 'shuffled', 42)
    expect([...shuffled].sort((a, b) => a - b)).toEqual(tokenIds(50, 'upload', 0))
    expect(shuffled).toEqual(tokenIds(50, 'shuffled', 42))
    expect(shuffled).not.toEqual(tokenIds(50, 'upload', 0))
  })

  it('groups ids by file and formats them', () => {
    const tokens = buildOneOfOneTokens([item('a', 3), item('b', 1)], details)
    const ids = idsByItem(tokens)
    expect(formatIds(ids.get('a')!)).toBe('#1 to #3')
    expect(formatIds(ids.get('b')!)).toBe('#4')
    expect(formatIds([2, 9, 14, 20, 31])).toBe('#2, #9, #14 and 2 more')
  })
})

describe('rarity and traits', () => {
  const items = [
    item('common', 3, [['Background', 'Blue']]),
    item('rare', 1, [['Background', 'Gold']]),
    item('plain', 1),
  ]

  it('ranks the rarest first, editions holding consecutive ranks', () => {
    const ranks = rankItems(items)
    expect(ranks.get('rare')).toMatchObject({ firstRank: 1, lastRank: 1 })
    expect(ranks.get('common')).toMatchObject({ firstRank: 2, lastRank: 4 })
    expect(ranks.get('plain')).toMatchObject({ firstRank: 5, lastRank: 5, score: 0 })
    // score = sum(N / freq) / traits / N; N = 5, freq(Gold) = 1.
    expect(ranks.get('rare')!.score).toBeCloseTo(1)
  })

  it('counts editions per trait value, case-insensitively', () => {
    const summary = summarizeTraits([...items, item('dup', 2, [['background', 'blue']])])
    expect(summary).toHaveLength(1)
    expect(summary[0]!.values.map((v) => [v.value, v.count])).toEqual([
      ['Blue', 5],
      ['Gold', 1],
    ])
    expect(summary[0]!.values[0]!.share).toBeCloseTo(5 / 7)
  })

  it('filters with any value within a type and every type', () => {
    const owl = item('owl', 1, [
      ['Background', 'Blue'],
      ['Eyes', 'Laser'],
    ])
    const blue = traitKey({ traitType: 'Background', value: 'Blue' })
    const gold = traitKey({ traitType: 'Background', value: 'Gold' })
    const laser = traitKey({ traitType: 'Eyes', value: 'Laser' })
    const sleepy = traitKey({ traitType: 'Eyes', value: 'Sleepy' })
    expect(matchesTraitFilter(owl, new Set([blue, gold]))).toBe(true)
    expect(matchesTraitFilter(owl, new Set([blue, laser]))).toBe(true)
    expect(matchesTraitFilter(owl, new Set([blue, sleepy]))).toBe(false)
  })

  it('searches, filters and sorts the files in view', () => {
    const ranks = rankItems(items)
    const base = { search: '', filters: new Set<string>(), ranks }
    expect(visibleItems(items, { ...base, sort: 'rarity' }).map((i) => i.key)).toEqual([
      'rare',
      'common',
      'plain',
    ])
    expect(visibleItems(items, { ...base, sort: 'name' }).map((i) => i.key)).toEqual([
      'common',
      'plain',
      'rare',
    ])
    expect(visibleItems(items, { ...base, sort: 'upload', search: 'RA' }).map((i) => i.key)).toEqual(['rare'])
  })
})
