import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PAGE_CHANGED_ELSEWHERE } from '@/lib/art/result'
import type { Tables } from '@/lib/database.types'
import type { PhasesContext } from '@/lib/manage/phases-core'
import { saveMintPageCore, type MintPageInput } from './settings-core'

const storage = vi.hoisted(() => ({
  headObject: vi.fn(async (): Promise<{ bytes: number; mime: string | null } | null> => null),
  presignPut: vi.fn(async (): Promise<string> => 'https://bucket.example/put'),
  deleteObjects: vi.fn(async (): Promise<void> => {}),
}))
// The core's storage, job and ranks modules load the server's clients; these paths need only fakes of them.
vi.mock('@/lib/storage/config', () => ({ mintPageBucket: () => 'mint-page' }))
vi.mock('@/lib/storage/objects', () => storage)
vi.mock('@/lib/deploy/deploy-core', () => ({ doneJobRow: vi.fn(async () => null) }))
vi.mock('@/lib/art/lock-core', () => ({ errorSummary: (error: unknown) => String(error) }))
vi.mock('./ranks-core', () => ({ ensureTokenRanksCore: vi.fn(async () => 'skipped') }))

const COLLECTION = '0a977c0b-7e53-476b-8c08-6c685315c3af'
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
