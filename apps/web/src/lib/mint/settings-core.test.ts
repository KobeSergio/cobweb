import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PAGE_CHANGED_ELSEWHERE,
  PAGE_FIELDS,
  PAGE_FILE_MISMATCH,
  PAGE_FILE_MISSING,
  PAGE_NOT_PUBLIC,
  UNSAVED,
} from '@/lib/art/result'
import { parse } from '@/lib/art/schemas'
import type { Tables } from '@/lib/database.types'
import type { PhasesContext } from '@/lib/manage/phases-core'
import { MEDIA_SLOTS, mediaKeysOf, type MintPageMediaRow } from './media'
import type { StoredSections } from './page-doc'
import {
  keysOf,
  mediaAsksSchema,
  presignMintPageMediaCore,
  saveMintPageCore,
  setMintPagePublishedCore,
  type MediaAsk,
  type MintPageInput,
} from './settings-core'

const storage = vi.hoisted(() => ({
  headObject: vi.fn<(key: string) => Promise<{ bytes: number; mime: string | null } | null>>(
    async () => null,
  ),
  presignPut: vi.fn(async (): Promise<string> => 'https://bucket.example/put'),
  deleteObjects: vi.fn(async (): Promise<void> => {}),
}))
const jobs = vi.hoisted(() => ({ doneJobRow: vi.fn(async (): Promise<null> => null) }))
// The core's storage, job and ranks modules load the server's clients; these paths need only fakes of them.
vi.mock('@/lib/storage/config', () => ({ mintPageBucket: () => 'mint-page' }))
vi.mock('@/lib/storage/objects', () => storage)
vi.mock('@/lib/deploy/deploy-core', () => jobs)
vi.mock('@/lib/art/lock-core', () => ({ errorSummary: (error: unknown) => String(error) }))
vi.mock('./ranks-core', () => ({ recordTokenRanks: vi.fn(async () => {}) }))

const COLLECTION = '0a977c0b-7e53-476b-8c08-6c685315c3af'
const MB = 1024 * 1024
const HASH = 'ab'.repeat(32)
const BANNER = `${COLLECTION}/${HASH}.png`
/** The stamp the tab's view read, and the one another tab's save or the Overview's switch left since. */
const READ = '2026-10-16T07:42:17.123456+00:00'
const MOVED = '2026-10-16T07:45:03.9+00:00'

type Request = { table: string; calls: { name: string; args: unknown[] }[] }
type Answer = { data: unknown; error: { code?: string; message: string } | null }

/** A Supabase client that records each request's calls and answers it, once awaited, from `answer`. */
function fakeSupabase(answer: (request: Request) => Answer) {
  const requests: Request[] = []
  const from = (table: string) => {
    const request: Request = { table, calls: [] }
    requests.push(request)
    const chain: Record<string, unknown> = {
      then: (resolve: (value: Answer) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve()
          .then(() => answer(request))
          .then(resolve, reject),
    }
    for (const name of ['select', 'eq', 'maybeSingle', 'single', 'upsert', 'update', 'order', 'limit'])
      chain[name] = (...args: unknown[]) => {
        request.calls.push({ name, args })
        return chain
      }
    return chain
  }
  return { client: { from } as unknown as PhasesContext['supabase'], requests }
}

/** What a request is: its table and its first call (`select` for a read, `upsert` for the insert, `update`). */
const kindOf = (request: Request) => `${request.table} ${request.calls[0]?.name}`
const found = (data: unknown): Answer => ({ data, error: null })

/** The stored row, as `readRow` and the update select it. */
const rowOf = (updatedAt: string): Partial<Tables<'mint_pages'>> => ({
  published: false,
  description: 'Owls.',
  banner_key: null,
  avatar_key: null,
  about_banner_key: null,
  website_url: null,
  x_url: null,
  discord_url: null,
  telegram_url: null,
  featured_token_ids: [],
  sections: {},
  updated_at: updatedAt,
})

const inputOf = (updatedAt: string | null): MintPageInput => ({
  published: false,
  description: 'Owls at dusk.',
  media: { banner: null, avatar: null, about: null },
  socials: { website: null, x: null, discord: null, telegram: null },
  featuredTokenIds: [],
  sections: {
    team: { enabled: false, members: [] },
    roadmap: { enabled: false, items: [] },
    faq: { enabled: false, items: [] },
    music: { enabled: false, key: null, fileName: null },
    carousel: { enabled: false, items: [] },
  },
  updatedAt,
})

const ctxOf = (supabase: PhasesContext['supabase']): PhasesContext => ({
  supabase,
  service: () => {
    throw new Error('a save needs no service client')
  },
  owner: 'owner',
  wallet: '0x70997970c51812dc3a010c7d01b50e0d17dc79c8',
  collection: {
    id: COLLECTION,
    slug: 'night-owls',
    max_supply: 10,
    project_type: 'generative',
  } as PhasesContext['collection'],
})

/** Answers the deployment read, then each mint_pages request from `pages` by its kind. */
const answers =
  (pages: Partial<Record<'select' | 'upsert' | 'update', Answer>>) =>
  (request: Request): Answer => {
    if (request.table === 'deployments') return found({ collection_id: COLLECTION })
    const kind = request.calls[0]?.name as 'select' | 'upsert' | 'update'
    const answer = request.table === 'mint_pages' ? pages[kind] : undefined
    if (!answer) throw new Error(`unexpected request: ${kindOf(request)}`)
    return answer
  }

const eqs = (request: Request | undefined) =>
  (request?.calls ?? []).filter((call) => call.name === 'eq').map((call) => call.args)

describe('saveMintPageCore and a stale tab (final fix wave M2)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('refuses a draft whose view read another updated_at, before any upload check or write', async () => {
    for (const [stored, sent] of [
      [rowOf(MOVED), READ],
      // Read without a row, while another tab or the Overview's switch has made one since.
      [rowOf(MOVED), null],
    ] as const) {
      const { client, requests } = fakeSupabase(answers({ select: found(stored) }))
      expect(await saveMintPageCore(ctxOf(client), inputOf(sent))).toEqual({
        refused: PAGE_CHANGED_ELSEWHERE,
      })
      expect(requests.map(kindOf)).toEqual(['deployments select', 'mint_pages select'])
      expect(storage.headObject).not.toHaveBeenCalled()
    }
  })

  it('refuses when the update matches no row, its stamp moved after the read, and deletes nothing', async () => {
    const { client, requests } = fakeSupabase(
      answers({ select: found(rowOf(READ)), upsert: found([]), update: found(null) }),
    )
    expect(await saveMintPageCore(ctxOf(client), inputOf(READ))).toEqual({ refused: PAGE_CHANGED_ELSEWHERE })
    const update = requests.find((request) => kindOf(request) === 'mint_pages update')
    expect(eqs(update)).toEqual([
      ['collection_id', COLLECTION],
      ['updated_at', READ],
    ])
    expect(storage.deleteObjects).not.toHaveBeenCalled()
  })

  it('refuses a first save whose insert made no row: another write made it after the read', async () => {
    const { client, requests } = fakeSupabase(answers({ select: found(null), upsert: found([]) }))
    expect(await saveMintPageCore(ctxOf(client), inputOf(null))).toEqual({ refused: PAGE_CHANGED_ELSEWHERE })
    expect(requests.map(kindOf)).not.toContain('mint_pages update')
  })

  it('lands on the stamp it read, or on the one its own insert made, and answers the new one', async () => {
    const landed = fakeSupabase(
      answers({ select: found(rowOf(READ)), upsert: found([]), update: found(rowOf(MOVED)) }),
    )
    const saved = await saveMintPageCore(ctxOf(landed.client), inputOf(READ))
    expect('data' in saved && saved.data.updatedAt).toBe(MOVED)
    const update = landed.requests.find((request) => kindOf(request) === 'mint_pages update')
    expect(eqs(update)).toEqual([
      ['collection_id', COLLECTION],
      ['updated_at', READ],
    ])
    const first = fakeSupabase(
      answers({ select: found(null), upsert: found([{ updated_at: READ }]), update: found(rowOf(MOVED)) }),
    )
    const created = await saveMintPageCore(ctxOf(first.client), inputOf(null))
    expect('data' in created && created.data.updatedAt).toBe(MOVED)
    expect(eqs(first.requests.find((request) => kindOf(request) === 'mint_pages update'))).toContainEqual([
      'updated_at',
      READ,
    ])
  })
})

const ask = (overrides: Partial<MediaAsk> = {}): MediaAsk => ({
  slot: 'banner',
  mime: 'image/png',
  bytes: MB,
  width: 1500,
  height: 500,
  contentHash: HASH,
  ...overrides,
})

describe('presignMintPageMediaCore and an object already stored (final fix wave M5)', () => {
  beforeEach(() => vi.clearAllMocks())
  const presign = (asks: MediaAsk[]) =>
    presignMintPageMediaCore(ctxOf(fakeSupabase(answers({})).client), asks)

  it("answers no PUT for an object at the key with the file's length and type, and signs only the missing", async () => {
    storage.headObject.mockImplementation(async (key: string) =>
      key === BANNER ? { bytes: MB, mime: 'image/png' } : null,
    )
    const other = ask({ slot: 'about', contentHash: 'cd'.repeat(32) })
    expect(await presign([ask(), other])).toEqual({
      data: [
        { key: BANNER, putUrl: null },
        { key: `${COLLECTION}/${'cd'.repeat(32)}.png`, putUrl: 'https://bucket.example/put' },
      ],
    })
    expect(storage.presignPut).toHaveBeenCalledTimes(1)
  })

  it('refuses, and signs nothing, when the object at the key has another length or type: it is never rewritten', async () => {
    for (const head of [
      { bytes: MB + 1, mime: 'image/png' },
      { bytes: MB, mime: 'image/jpeg' },
    ]) {
      storage.headObject.mockImplementation(async () => head)
      expect(await presign([ask(), ask({ slot: 'about', contentHash: 'cd'.repeat(32) })])).toEqual({
        refused: PAGE_FILE_MISMATCH,
      })
      expect(storage.presignPut).not.toHaveBeenCalled()
    }
  })

  it("reads an ask the tab would never send in words, never zod's English", () => {
    for (const asks of [
      [ask({ bytes: 0 })],
      [ask({ slot: 'poster' as MediaAsk['slot'] })],
      [{ ...ask(), width: 'x' }],
    ])
      expect(parse(mediaAsksSchema, asks)).toEqual({ ok: false, error: UNSAVED })
  })
})

describe('saveMintPageCore and a key moved to another slot (final fix wave M5)', () => {
  beforeEach(() => vi.clearAllMocks())
  /** The stored row names the banner; the save moves the same key to the avatar or keeps it. */
  const stored = { ...rowOf(READ), banner_key: BANNER }
  const moved = (media: MintPageInput['media']) => ({ ...inputOf(READ), media })

  it("checks a key moved to the avatar against the avatar's cap, and skips one kept where the row names it", async () => {
    storage.headObject.mockImplementation(async () => ({ bytes: 3 * MB, mime: 'image/png' }))
    const toAvatar = fakeSupabase(answers({ select: found(stored) }))
    expect(
      await saveMintPageCore(ctxOf(toAvatar.client), moved({ banner: null, avatar: BANNER, about: null })),
    ).toEqual({ refused: PAGE_FILE_MISSING })
    expect(storage.headObject).toHaveBeenCalledWith(BANNER, { bucket: 'mint-page' })
    expect(toAvatar.requests.map(kindOf)).not.toContain('mint_pages update')
    vi.clearAllMocks()
    const kept = fakeSupabase(
      answers({ select: found(stored), upsert: found([]), update: found({ ...stored, updated_at: MOVED }) }),
    )
    const saved = await saveMintPageCore(
      ctxOf(kept.client),
      moved({ banner: BANNER, avatar: null, about: null }),
    )
    expect('data' in saved && saved.data.media.banner?.key).toBe(BANNER)
    expect(storage.headObject).not.toHaveBeenCalled()
    expect(storage.deleteObjects).toHaveBeenCalledWith([], { bucket: 'mint-page' })
  })

  it('reads the art before the write, so a failed read writes nothing and a landed write always answers', async () => {
    jobs.doneJobRow.mockRejectedValueOnce(new Error('The render job could not be read: offline'))
    const { client, requests } = fakeSupabase(answers({ select: found(rowOf(READ)) }))
    await expect(saveMintPageCore(ctxOf(client), inputOf(READ))).rejects.toThrow('offline')
    expect(requests.map(kindOf)).toEqual(['deployments select', 'mint_pages select'])
  })
})

describe("setMintPagePublishedCore and the database's refusals (final fix wave M5)", () => {
  it("reads the trigger's sentence as it is and any other check's as the fields' sentence, never raw", async () => {
    for (const [message, refused] of [
      [PAGE_NOT_PUBLIC, PAGE_NOT_PUBLIC],
      ['new row for relation "mint_pages" violates check constraint "mint_pages_links_length"', PAGE_FIELDS],
    ] as const) {
      // The trigger raises on the update that turns the page public; the insert before it writes the defaults.
      const { client } = fakeSupabase(
        answers({ upsert: found([]), update: { data: null, error: { code: '23514', message } } }),
      )
      expect(await setMintPagePublishedCore(ctxOf(client), true)).toEqual({ refused })
    }
  })
})

describe('the upload sweep beside the save (docs/specs/2026-10-17-production-hardening.md, section 14, point 8)', () => {
  it('keeps every key a page names with each media slot filled, as the save reads them', () => {
    const key = (n: number, extension = 'png') =>
      `${COLLECTION}/${n.toString(16).padStart(64, '0')}.${extension}`
    const member = (n: number, imageKey: string | null): StoredSections['team']['members'][number] => ({
      id: `member-${n}`,
      name: `Member ${n}`,
      role: 'Artist',
      bio: '',
      imageKey,
    })
    const sections: StoredSections = {
      team: { enabled: true, members: [member(1, key(4)), member(2, null), member(3, key(5, 'webp'))] },
      roadmap: { enabled: true, items: [{ id: 'r1', date: 'Q4', title: 'Mint', description: '' }] },
      faq: { enabled: true, items: [{ id: 'f1', question: 'When?', answer: 'Soon.' }] },
      music: { enabled: true, key: key(7, 'mp3'), fileName: 'theme.mp3' },
      carousel: {
        enabled: true,
        items: [
          { id: 's1', kind: 'upload', key: key(6, 'mp4'), fileName: 'clip.mp4', mediaType: 'video' },
          { id: 's2', kind: 'token', tokenId: 3 },
          { id: 's3', kind: 'upload', key: key(8, 'gif'), fileName: 'loop.gif', mediaType: 'image' },
        ],
      },
    }
    const row: MintPageMediaRow = {
      banner_key: key(1),
      avatar_key: key(2, 'jpg'),
      about_banner_key: key(3, 'webp'),
      sections,
    }
    const saved = keysOf({
      banner: row.banner_key,
      avatar: row.avatar_key,
      about: row.about_banner_key,
      sections,
    })
    // Every slot holds a file here, so a slot added to MediaSlot fails this line until the row fills it.
    expect(new Set(saved.map(({ slot }) => slot))).toEqual(new Set(Object.keys(MEDIA_SLOTS)))
    expect(new Set(mediaKeysOf(row))).toEqual(new Set(saved.map(({ key }) => key)))
  })
})
