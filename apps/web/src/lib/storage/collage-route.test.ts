import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    maybeSingle: vi.fn<() => Promise<{ data: { collage_key: string | null } | null; error: null }>>(),
  }
  chain.select.mockReturnValue(chain)
  chain.eq.mockReturnValue(chain)
  chain.order.mockReturnValue(chain)
  chain.limit.mockReturnValue(chain)
  return {
    chain,
    user: null as { id: string; walletAddress: string } | null,
    getSessionUser: vi.fn(async () => mocks.user),
    presignGet: vi.fn<(key: string, expires: number, options: { bucket?: string }) => Promise<string>>(),
  }
})
vi.mock('@/lib/auth', () => ({ getSessionUser: mocks.getSessionUser }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ from: () => mocks.chain }) }))
vi.mock('@/lib/storage/config', () => ({ renderBucket: () => 'render' }))
vi.mock('@/lib/storage/objects', () => ({ presignGet: mocks.presignGet }))

import { GET } from '@/app/api/collections/[id]/collage/route'

const COLLECTION = '1f4a0f3e-2f5e-4e3a-9d1c-1b2c3d4e5f61'
const KEY = `${COLLECTION}/collage/0f4a0f3e-2f5e-4e3a-9d1c-1b2c3d4e5f60.png`
const get = (id: string) =>
  GET(new NextRequest(`https://cobweb.test/api/collections/${id}/collage`), {
    params: Promise.resolve({ id }),
  })

describe('GET /api/collections/[id]/collage', () => {
  beforeEach(() => {
    mocks.user = { id: 'u-1', walletAddress: '0xabc' }
    mocks.chain.maybeSingle.mockResolvedValue({ data: { collage_key: KEY }, error: null })
    mocks.getSessionUser.mockClear()
    mocks.chain.select.mockClear()
    mocks.chain.eq.mockClear()
    mocks.chain.order.mockClear()
    mocks.chain.limit.mockClear()
    mocks.presignGet.mockReset()
    mocks.presignGet.mockResolvedValue('https://storage.local/signed')
  })

  it('answers 404 for an id that is not a uuid, before any session check', async () => {
    expect((await get('nope')).status).toBe(404)
    expect(mocks.getSessionUser).not.toHaveBeenCalled()
  })

  it('answers 404 when signed out, without reading a job', async () => {
    mocks.user = null
    expect((await get(COLLECTION)).status).toBe(404)
    expect(mocks.chain.select).not.toHaveBeenCalled()
    expect(mocks.presignGet).not.toHaveBeenCalled()
  })

  it('answers 404 when the latest done job has no collage key, and when there is no done job', async () => {
    mocks.chain.maybeSingle.mockResolvedValue({ data: { collage_key: null }, error: null })
    expect((await get(COLLECTION)).status).toBe(404)
    mocks.chain.maybeSingle.mockResolvedValue({ data: null, error: null })
    expect((await get(COLLECTION)).status).toBe(404)
    expect(mocks.presignGet).not.toHaveBeenCalled()
  })

  it('redirects the owner to a presigned GET on the render bucket, good for an hour and cached privately', async () => {
    const response = await get(COLLECTION)
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://storage.local/signed')
    expect(response.headers.get('cache-control')).toBe('private, max-age=3000')
    expect(mocks.presignGet).toHaveBeenCalledWith(KEY, 3600, { bucket: 'render' })
    // The latest real job in state done, under the creator's client.
    expect(mocks.chain.select).toHaveBeenCalledWith('collage_key')
    expect(mocks.chain.eq).toHaveBeenCalledWith('collection_id', COLLECTION)
    expect(mocks.chain.eq).toHaveBeenCalledWith('kind', 'real')
    expect(mocks.chain.eq).toHaveBeenCalledWith('state', 'done')
    expect(mocks.chain.order).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(mocks.chain.limit).toHaveBeenCalledWith(1)
  })
})
