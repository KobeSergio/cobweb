import type { StateBody } from '@cobweb/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEMO_MINTER, DEMO_NOW, DEMO_TOKENS } from '@/lib/demo'
import { mintCallOf } from '@/lib/mint/mint-call'
import type { MintPageStatic } from '@/lib/mint/page-doc'
import {
  sampleMintSource,
  sampleSwitchesOf,
  SAMPLE_PLACEHOLDER_URI,
  SAMPLE_REVEALED_URI,
  type SampleSwitches,
} from './sample-source'

const page = {
  slug: 'night-owls',
  chain: {
    id: 8453,
    name: 'Base',
    nativeSymbol: 'ETH',
    explorerUrl: 'https://basescan.org',
    transferLock: true,
  },
  contract: '0x4f2A9C7E1B3d5F6A8C0E2b4D6f8A1C3e5B7D9f0a',
} as unknown as MintPageStatic
const switches = (overrides: Partial<SampleSwitches> = {}): SampleSwitches => ({
  ...sampleSwitchesOf(new URLSearchParams()),
  ...overrides,
})

describe('sampleMintSource (docs/specs/2026-10-16-mint-page-live-data.md, section 8)', () => {
  let now = 0
  const clock = () => now
  beforeEach(() => {
    vi.useFakeTimers()
    now = 1_000_000
  })
  afterEach(() => vi.useRealTimers())

  /** The next state answer, its pauses run on the fake timers. */
  async function state(source: ReturnType<typeof sampleMintSource>): Promise<StateBody> {
    const answer = source.pollState()
    await vi.runAllTimersAsync()
    const poll = await answer
    if (poll.kind !== 'body') throw new Error(`no body: ${poll.kind}`)
    return poll.body
  }

  it('flips a scheduled group active 2 s after its start on its clock, which advances in real seconds', async () => {
    const source = sampleMintSource(page, switches({ variant: 'upcoming', start: 5 }), clock)
    const group = (body: StateBody) => body.groups.find((entry) => entry.startTimestamp === DEMO_NOW + 5)
    expect(group(await state(source))?.active).toBe(false)
    now += 6_000
    const atStart = await state(source)
    expect([atStart.blockTimestamp, group(atStart)?.active]).toEqual([DEMO_NOW + 6, false])
    now += 1_000
    expect(group(await state(source))?.active).toBe(true)
  })

  it('reads the placeholder before the reveal and counts a confirmed mint from its block on', async () => {
    const source = sampleMintSource(page, switches(), clock)
    const before = await state(source)
    expect(before.baseUri).toBe(SAMPLE_PLACEHOLDER_URI)
    const call = mintCallOf({
      contract: page.contract,
      chainId: page.chain.id,
      groupId: 1,
      amount: 1,
      vault: null,
      valueWei: 0n,
      account: DEMO_MINTER,
    })
    const sending = source.chain.simulate(call)
    await vi.runAllTimersAsync()
    const hashing = (await sending)()
    await vi.runAllTimersAsync()
    const receiving = source.chain.receipt(await hashing, page.chain.id)
    await vi.runAllTimersAsync()
    const receipt = await receiving
    expect(receipt.status).toBe('success')
    now += 2_000
    const after = await state(source)
    expect(after.totalMinted).toBe(before.totalMinted + 1)
    expect(after.groups.find((group) => group.id === 1)?.minted).toBe(
      (before.groups.find((group) => group.id === 1)?.minted ?? 0) + 1,
    )
  })
})

describe('sampleMintSource tiers (docs/specs/2026-10-16-mint-page-live-data.md, sections 7.7 and 8)', () => {
  const sample = () => sampleMintSource(page, switches())

  it("answers the demo set's size and each id's rank at the revealed base URI", async () => {
    const ids = [1, 2, 3]
    expect(await sample().tiers(SAMPLE_REVEALED_URI, ids)).toEqual({
      total: DEMO_TOKENS.length,
      ranks: Object.fromEntries(ids.map((id) => [id, DEMO_TOKENS[id - 1]!.rank])),
    })
  })

  it('reads the first 20 ids only and leaves out an id the set does not have', async () => {
    const ids = Array.from({ length: 25 }, (_, index) => index + 1)
    const capped = await sample().tiers(SAMPLE_REVEALED_URI, ids)
    expect(Object.keys(capped?.ranks ?? {}).map(Number)).toEqual(ids.slice(0, 20))
    const unknown = await sample().tiers(SAMPLE_REVEALED_URI, [0, DEMO_TOKENS.length + 1])
    expect(unknown).toEqual({ total: DEMO_TOKENS.length, ranks: {} })
  })

  it('answers null before the reveal and for any other base URI', async () => {
    expect(await sample().tiers(SAMPLE_PLACEHOLDER_URI, [1])).toBeNull()
    expect(await sample().tiers('ipfs://elsewhere/', [1])).toBeNull()
  })
})
