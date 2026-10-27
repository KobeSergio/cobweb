import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  owned: vi.fn(),
  rpc: vi.fn(),
  core: vi.fn(),
}))
vi.mock('@/lib/art/owned', () => ({ ownedCollection: mocks.owned }))
vi.mock('@/lib/manage/snapshot-core', () => ({ fetchHoldersCore: mocks.core }))
vi.mock('@/lib/art/lock-core', () => ({ errorSummary: () => 'Error: masked' }))

import { fetchHolders } from '@/app/actions/snapshot'
import {
  NOT_FOUND,
  SIGNED_OUT,
  SNAPSHOT_FAILED,
  SNAPSHOT_NOT_DEPLOYED,
  SNAPSHOT_RATE,
} from '@/lib/art/result'

const ID = '11111111-2222-4333-8444-555555555555'
const CONTRACT = '0x00000000000000000000000000000000000000aa'
const SNAPSHOT = { holders: [{ address: CONTRACT, count: 1 }], block: 7, supply: 1 }

const ownedWith = (status: string) => ({
  supabase: { rpc: mocks.rpc },
  user: { id: 'u' },
  collection: { id: ID, status },
})

describe('fetchHolders', () => {
  beforeEach(() => {
    mocks.owned.mockReset()
    mocks.rpc.mockReset()
    mocks.core.mockReset()
    mocks.core.mockResolvedValue({ data: SNAPSHOT })
    mocks.rpc.mockResolvedValue({ data: true, error: null })
  })

  it('reads the chain for a deployed collection the caller owns, after counting the run', async () => {
    mocks.owned.mockResolvedValue(ownedWith('deployed'))
    expect(await fetchHolders(ID, 1, CONTRACT)).toEqual({ ok: true, data: SNAPSHOT })
    expect(mocks.rpc).toHaveBeenCalledWith('snapshot_take', { p_collection_id: ID })
    expect(mocks.core).toHaveBeenCalledTimes(1)
  })

  it.each(['draft', 'art_locked', 'rendering', 'rendered'])(
    'refuses a collection that is %s, without counting a run or reading the chain',
    async (status) => {
      mocks.owned.mockResolvedValue(ownedWith(status))
      expect(await fetchHolders(ID, 1, CONTRACT)).toEqual({ ok: false, error: SNAPSHOT_NOT_DEPLOYED })
      expect(mocks.rpc).not.toHaveBeenCalled()
      expect(mocks.core).not.toHaveBeenCalled()
    },
  )

  it('refuses a signed-out caller and a collection the caller does not own, before anything else', async () => {
    mocks.owned.mockResolvedValueOnce({ error: SIGNED_OUT }).mockResolvedValueOnce({ error: NOT_FOUND })
    expect(await fetchHolders(ID, 1, CONTRACT)).toEqual({ ok: false, error: SIGNED_OUT })
    expect(await fetchHolders(ID, 1, CONTRACT)).toEqual({ ok: false, error: NOT_FOUND })
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.core).not.toHaveBeenCalled()
  })

  it('refuses with the rate sentence when the database says the owner is over the limit, and reads nothing', async () => {
    mocks.owned.mockResolvedValue(ownedWith('deployed'))
    mocks.rpc.mockResolvedValue({ data: false, error: null })
    expect(await fetchHolders(ID, 1, CONTRACT)).toEqual({ ok: false, error: SNAPSHOT_RATE })
    expect(mocks.core).not.toHaveBeenCalled()
  })

  it('fails closed when the run cannot be counted', async () => {
    mocks.owned.mockResolvedValue(ownedWith('deployed'))
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'boom' } })
    expect(await fetchHolders(ID, 1, CONTRACT)).toEqual({ ok: false, error: SNAPSHOT_FAILED })
    expect(mocks.core).not.toHaveBeenCalled()
  })

  it('checks the input first, so a bad address costs nothing', async () => {
    const result = await fetchHolders(ID, 1, 'not-an-address')
    expect(result.ok).toBe(false)
    expect(mocks.owned).not.toHaveBeenCalled()
  })
})
