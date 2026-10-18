import { beforeEach, describe, expect, it, vi } from 'vitest'
import { uploadSweepDeps } from './upload-sweep-deps'

type Read = { table: string; column: string; values: string[] }
type Answer = { data: object[] | null; error: { code?: string; message: string } | null; status: number }

// The ports read through the service client: this fake records each read's table, column and values, and answers
// what the test sets.
const db = vi.hoisted(() => {
  const state: { reads: Read[]; answer: (read: Read) => Answer } = {
    reads: [],
    answer: () => ({ data: [], error: null, status: 200 }),
  }
  return state
})
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => ({
      select: () => ({
        in: async (column: string, values: string[]) => {
          const read: Read = { table, column, values }
          db.reads.push(read)
          return db.answer(read)
        },
      }),
    }),
  }),
}))

const COLLECTION: string = '0a977c0b-7e53-476b-8c08-6c685315c3af'
const hex = (n: number): string => n.toString(16).padStart(64, '0')
/** An art key under the longest folder name the bucket holds. */
const artKey = (n: number): string => `${COLLECTION}/placeholders/${hex(n)}.webp`
const shapeOf = (reads: Read[]) => reads.map((read) => [read.table, read.column, read.values.length])

describe('uploadSweepDeps (docs/specs/2026-10-17-production-hardening.md, section 14, point 8)', () => {
  beforeEach(() => {
    db.reads.length = 0
  })

  it("reads at most 50 keys at a time, so no query string passes the gateway's 8 KB line, and answers the recorded ones", async () => {
    const keys: string[] = Array.from({ length: 130 }, (_, n) => artKey(n))
    const recorded: string[] = [keys[0]!, keys[49]!, keys[50]!, keys[129]!]
    db.answer = (read) => ({
      data: read.values.filter((key) => recorded.includes(key)).map((storage_key) => ({ storage_key })),
      error: null,
      status: 200,
    })
    const found = await uploadSweepDeps().art.recorded(keys)
    expect(shapeOf(db.reads)).toEqual([
      ['uploads', 'storage_key', 50],
      ['uploads', 'storage_key', 50],
      ['uploads', 'storage_key', 30],
    ])
    expect(db.reads.flatMap((read) => read.values)).toEqual(keys)
    expect([...found].sort()).toEqual([...recorded].sort())
  })

  it("reads at most 50 collections' pages at a time and keeps only the keys a page names", async () => {
    const collections: string[] = Array.from(
      { length: 60 },
      (_, n) => `${hex(n).slice(-8)}-7e53-476b-8c08-6c685315c3af`,
    )
    const media = (collection: string, n: number): string => `${collection}/${hex(n)}.png`
    const keys: string[] = [
      ...collections.map((id) => media(id, 1)),
      media(collections[0]!, 2),
      'loose/file.png',
    ]
    db.answer = (read) => ({
      data: read.values.map((id) => ({
        banner_key: media(id, 1),
        avatar_key: null,
        about_banner_key: null,
        sections: {},
      })),
      error: null,
      status: 200,
    })
    const named = await uploadSweepDeps().media.recorded(keys)
    expect(shapeOf(db.reads)).toEqual([
      ['mint_pages', 'collection_id', 50],
      ['mint_pages', 'collection_id', 10],
    ])
    expect([...named].sort()).toEqual(collections.map((id) => media(id, 1)).sort())
  })

  it('names the HTTP status when the gateway refuses a read, and the Postgres code otherwise', async () => {
    db.answer = () => ({ data: null, error: { message: 'URI too long' }, status: 414 })
    await expect(uploadSweepDeps().art.recorded([artKey(1)])).rejects.toThrow(
      'The uploads could not be read (HTTP 414).',
    )
    await expect(uploadSweepDeps().media.recorded([artKey(1)])).rejects.toThrow(
      'The mint pages could not be read (HTTP 414).',
    )
    db.answer = () => ({ data: null, error: { code: '42501', message: 'permission denied' }, status: 401 })
    await expect(uploadSweepDeps().art.recorded([artKey(1)])).rejects.toThrow(
      'The uploads could not be read (42501).',
    )
  })
})
