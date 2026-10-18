import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createCollection } from '@/app/actions/collections'
import { DRAFT_CAP_REFUSAL, draftCapSentence } from '@/lib/collections'
import { stageHref } from '@/lib/steps'

type Request = { table: string; calls: { name: string; args: unknown[] }[] }
type Answer = {
  data?: unknown
  count?: number | null
  error: { code?: string; message: string; details?: string } | null
}

const mocks = vi.hoisted(() => ({
  owner: '5b0f1d4e-7a2c-4c1e-9f3a-2d6b8e0c4a17',
  supabase: null as unknown,
  redirect: vi.fn<(href: string) => void>(),
}))
vi.mock('@/lib/auth', () => ({
  getVerifiedUser: async () => ({
    id: mocks.owner,
    walletAddress: '0x00000000000000000000000000000000000000aa',
  }),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => mocks.supabase }))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))

const CREATED = '9e2d7c41-3b5a-4f60-8a1e-c7d2b4f9e035'

/** A Supabase client that records each request's calls and answers it, once awaited, from `answer`. */
function fakeSupabase(answer: (request: Request) => Answer): Request[] {
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
    for (const name of ['select', 'eq', 'neq', 'maybeSingle', 'single', 'insert'])
      chain[name] = (...args: unknown[]) => {
        request.calls.push({ name, args })
        return chain
      }
    return chain
  }
  mocks.supabase = { from }
  return requests
}

/** The profile read, the count read and the insert, each answered as given. */
function answering(profile: Answer, held: Answer, insert: Answer): Request[] {
  return fakeSupabase((request) => {
    if (request.table === 'profiles') return profile
    return request.calls.some(({ name }) => name === 'insert') ? insert : held
  })
}

const form = () => {
  const data = new FormData()
  data.set('name', 'Night Owls')
  data.set('symbol', 'OWL')
  data.set('projectType', 'generative')
  return data
}

const inserted = (requests: Request[]) =>
  requests.some(({ calls }) => calls.some(({ name }) => name === 'insert'))

const CREATED_ROW: Answer = { data: { id: CREATED }, error: null }
const TRIGGER_AT_20: Answer = {
  data: null,
  error: { code: '23514', message: DRAFT_CAP_REFUSAL, details: '20' },
}

describe('createCollection at the draft cap (docs/specs/2026-10-17-production-hardening.md, section 6.4)', () => {
  beforeEach(() => mocks.redirect.mockClear())

  it("refuses at the wallet's cap with no insert when both reads answer", async () => {
    const requests = answering(
      { data: { draft_cap: 2 }, error: null },
      { data: null, count: 2, error: null },
      CREATED_ROW,
    )
    expect(await createCollection({}, form())).toEqual({ formError: draftCapSentence(2) })
    expect(inserted(requests)).toBe(false)
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it('refuses at the default cap of 20 when the wallet has no profile row', async () => {
    const requests = answering(
      { data: null, error: null },
      { data: null, count: 20, error: null },
      CREATED_ROW,
    )
    expect(await createCollection({}, form())).toEqual({ formError: draftCapSentence(20) })
    expect(inserted(requests)).toBe(false)
  })

  it('leaves the cap to the trigger when the profile read fails, so a raised cap is never read as 20', async () => {
    const requests = answering(
      { data: null, error: { message: 'canceling statement due to statement timeout' } },
      { data: null, count: 25, error: null },
      CREATED_ROW,
    )
    await createCollection({}, form())
    expect(inserted(requests)).toBe(true)
    expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith(stageHref(CREATED, 'art', 'generative'))
  })

  it("leaves the cap to the trigger when the count read fails, and words the trigger's refusal the same", async () => {
    const requests = answering(
      { data: { draft_cap: 20 }, error: null },
      { data: null, count: null, error: { message: 'fetch failed' } },
      TRIGGER_AT_20,
    )
    expect(await createCollection({}, form())).toEqual({ formError: draftCapSentence(20) })
    expect(inserted(requests)).toBe(true)
  })
})
