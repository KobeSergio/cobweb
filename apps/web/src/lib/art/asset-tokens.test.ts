import { describe, expect, it } from 'vitest'
import {
  assetListProblems,
  buildAssetTokenList,
  hashAssetTokenList,
  orderAssetRows,
  type AssetToken,
  type AssetUploadRow,
} from './asset-tokens'

const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const C = '00000000-0000-4000-8000-00000000000c'
const T1 = '2026-10-09T10:00:00.1+00:00'
const T2 = '2026-10-09T10:00:00.25+00:00'
const MOON = [{ value: 'Moon', traitType: 'Name' }]

const row = (
  id: string,
  quantity: number,
  position: number | null,
  created_at: string,
  attributes: AssetUploadRow['attributes'] = [],
): AssetUploadRow => ({ id, quantity, position, created_at, attributes })

describe('buildAssetTokenList', () => {
  it('expands editions to contiguous ids in file order, carrying each file attributes as stored', () => {
    expect(buildAssetTokenList([row(B, 1, 1, T1, MOON), row(A, 2, 0, T2)])).toEqual([
      { id: 1, uploadId: A, attributes: [] },
      { id: 2, uploadId: A, attributes: [] },
      { id: 3, uploadId: B, attributes: MOON },
    ])
  })

  it('puts files without a position last, then orders by upload time and id, as art_lock does', () => {
    const ordered = orderAssetRows([row(C, 1, null, T1), row(B, 1, null, T1), row(A, 1, 0, T2)])
    expect(ordered.map((r) => r.id)).toEqual([A, B, C])
    expect(orderAssetRows([row(B, 1, null, T2), row(A, 1, null, T1)]).map((r) => r.id)).toEqual([A, B])
  })

  it('makes a single asset one file with quantity tokens', () => {
    expect(buildAssetTokenList([row(A, 4, null, T1)]).map((t) => [t.id, t.uploadId])).toEqual([
      [1, A],
      [2, A],
      [3, A],
      [4, A],
    ])
  })
})

describe('hashAssetTokenList', () => {
  it('gives the same hash for the same list in any order, and for the rows in any order', async () => {
    const rows = [row(A, 2, 0, T1), row(B, 1, 1, T2, MOON)]
    const list = buildAssetTokenList(rows)
    const hash = await hashAssetTokenList(list)
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/)
    expect(await hashAssetTokenList([...list].reverse())).toBe(hash)
    expect(await hashAssetTokenList(buildAssetTokenList([...rows].reverse()))).toBe(hash)
  })

  it('changes when an attribute changes', async () => {
    const list = buildAssetTokenList([row(A, 1, 0, T1, MOON)])
    const changed = buildAssetTokenList([row(A, 1, 0, T1, [{ value: 'Sun', traitType: 'Name' }])])
    expect(await hashAssetTokenList(changed)).not.toBe(await hashAssetTokenList(list))
  })
})

describe('assetListProblems', () => {
  it('passes a list of contiguous ids within the cap', () => {
    expect(assetListProblems(buildAssetTokenList([row(A, 3, 0, T1)]), 'one_of_one')).toEqual([])
  })

  it('asks for a file when there is none', () => {
    expect(assetListProblems([], 'single_asset')).toEqual([
      { code: 'files', message: 'Add at least one file before locking.' },
    ])
  })

  it('refuses gaps in the ids', () => {
    const gappy: AssetToken[] = [
      { id: 1, uploadId: A, attributes: [] },
      { id: 3, uploadId: A, attributes: [] },
    ]
    expect(assetListProblems(gappy, 'one_of_one')).toEqual([
      { code: 'ids', message: 'Token ids must run from 1 to 2 with no gaps or repeats.' },
    ])
  })

  it("refuses more tokens than the project type's cap", () => {
    const list = buildAssetTokenList([row(A, 4_001, 0, T1)])
    expect(assetListProblems(list, 'single_asset')).toEqual([
      { code: 'size', message: 'The files make 4,001 tokens. This project can have at most 4,000.' },
    ])
  })
})
