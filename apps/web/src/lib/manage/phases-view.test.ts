import type { Address } from 'viem'
import { describe, expect, it } from 'vitest'
import type { MintGroup } from '@/lib/demo/types'
import type { ChainGroup, ChainState, PhaseRowCopy } from './phases-types'
import { copyView, joinPhases, liveView, moveGroup, refreshPayload, type ViewBase } from './phases-view'

const CONTRACT: Address = '0x0409454C375c8a6aB05383bFB6D9FcDe9ebB8F85'
const START = 1_791_039_600

const chainGroup = (id: number, patch: Partial<ChainGroup> = {}): ChainGroup => ({
  id,
  priceWei: '0',
  maxSupply: 1,
  minted: 0,
  startTimestamp: 0,
  flag: false,
  active: false,
  ...patch,
})

const row = (id: number, position: number | null, patch: Partial<PhaseRowCopy> = {}): PhaseRowCopy => ({
  onchain_id: id,
  name: id === 0 ? 'Public' : `Phase ${id}`,
  description: '',
  visible: true,
  position,
  price_wei: '0',
  max_supply: 1,
  start_at: null,
  ...patch,
})

const state = (groups: ChainGroup[], patch: Partial<ChainState> = {}): ChainState => ({
  block: 120n,
  blockTimestamp: START + 60,
  maxSupply: 3,
  totalMinted: 1,
  publicMaxMintPerWallet: 2,
  mintOnBehalfActive: false,
  groups,
  ...patch,
})

const base: ViewBase = { chainId: 31337, contract: CONTRACT, rows: [] }

describe('joinPhases', () => {
  it("orders the groups by the rows' positions, then the groups without a row by id as Group N", () => {
    const groups = joinPhases(state([chainGroup(0), chainGroup(1), chainGroup(7), chainGroup(3)]), [
      row(0, 1),
      row(1, 0),
    ])
    expect(groups.map((group) => [group.id, group.name, group.named])).toEqual([
      [1, 'Phase 1', true],
      [0, 'Public', true],
      [3, 'Group 3', false],
      [7, 'Group 7', false],
    ])
    expect(groups.find((group) => group.id === 3)).toMatchObject({
      description: '',
      visible: true,
      kind: 'whitelist',
    })
    expect(groups.find((group) => group.id === 0)?.kind).toBe('public')
  })

  it('takes price, allocation, minted, the flag, the start and live from the chain, and the off-chain fields from the row', () => {
    const [group] = joinPhases(
      state([
        chainGroup(1, {
          priceWei: '2000',
          maxSupply: 5,
          minted: 4,
          startTimestamp: START,
          flag: false,
          active: true,
        }),
      ]),
      [row(1, 0, { price_wei: '1', max_supply: 9, description: 'For holders.', visible: false })],
    )
    expect(group).toEqual<MintGroup>({
      id: 1,
      name: 'Phase 1',
      kind: 'whitelist',
      priceWei: '2000',
      maxSupply: 5,
      minted: 4,
      flag: false,
      scheduledStart: START,
      active: true,
      description: 'For holders.',
      visible: false,
      named: true,
    })
  })

  it('leaves out a row the chain does not list, and sorts a row parked at a null position last', () => {
    const groups = joinPhases(state([chainGroup(0), chainGroup(1), chainGroup(2)]), [
      row(2, null),
      row(0, 0),
      row(5, 1),
      row(1, 2),
    ])
    expect(groups.map((group) => group.id)).toEqual([0, 1, 2])
  })
})

describe('liveView and copyView', () => {
  it('answers the totals, the limit and the time of a read that reached the chain', () => {
    const view = liveView({ ...base, rows: [row(0, 0)] }, state([chainGroup(0)]))
    expect(view).toMatchObject({
      chainId: 31337,
      contract: CONTRACT,
      publicMaxPerWallet: 2,
      totalMinted: 1,
      maxSupply: 3,
      blockTimestamp: START + 60,
      readAt: START + 60,
      chainReachable: true,
    })
    expect(view.groups.map((group) => group.name)).toEqual(['Public'])
  })

  it('answers the copy in order, never minted or live, the start from start_at and the read time as the clock', () => {
    const view = copyView({
      ...base,
      rows: [
        row(1, 1, { price_wei: '1000000000000000', start_at: new Date((START - 600) * 1000).toISOString() }),
        row(0, 0),
      ],
      publicMaxPerWallet: 5,
      maxSupply: 3,
      readAt: START,
    })
    expect(view.chainReachable).toBe(false)
    expect(view.blockTimestamp).toBe(START)
    expect(view.readAt).toBe(START)
    expect(view.totalMinted).toBe(0)
    expect(view.publicMaxPerWallet).toBe(5)
    expect(view.groups.map((group) => [group.id, group.minted, group.flag, group.active])).toEqual([
      [0, 0, false, false],
      [1, 0, false, false],
    ])
    // A start that has passed is shown as a time, never as live.
    expect(view.groups[1]).toMatchObject({ scheduledStart: START - 600, priceWei: '1000000000000000' })
  })
})

describe('refreshPayload', () => {
  it('copies each group as mint_groups_refresh takes it', () => {
    expect(refreshPayload(state([chainGroup(0, { priceWei: '2000', startTimestamp: START })]))).toEqual({
      publicMaxPerWallet: 2,
      groups: [{ onchain_id: 0, price_wei: '2000', max_supply: 1, start: START }],
    })
  })

  it('copies nothing when an id, an allocation or the public limit is above 2,147,483,647, or a start is past 9999-12-31 (Review Focus 5)', () => {
    expect(refreshPayload(state([chainGroup(0), chainGroup(2_147_483_648)]))).toBeNull()
    expect(refreshPayload(state([chainGroup(1, { maxSupply: 2_147_483_648 })]))).toBeNull()
    expect(refreshPayload(state([chainGroup(0)], { publicMaxMintPerWallet: 2 ** 60 }))).toBeNull()
    expect(refreshPayload(state([chainGroup(2_147_483_647)]))).not.toBeNull()
    expect(refreshPayload(state([chainGroup(0, { startTimestamp: 253_402_300_800 })]))).toBeNull()
    expect(refreshPayload(state([chainGroup(0, { startTimestamp: 253_402_300_799 })]))).not.toBeNull()
  })
})

describe('moveGroup', () => {
  const groups: MintGroup[] = joinPhases(
    state([chainGroup(0), chainGroup(1), chainGroup(2), chainGroup(9)]),
    [row(0, 0), row(1, 1), row(2, 2)],
  )

  it('swaps a named phase with its named neighbour and keeps the unnamed last', () => {
    expect(moveGroup(groups, 2, 'up').map((group) => group.id)).toEqual([0, 2, 1, 9])
    expect(moveGroup(groups, 0, 'down').map((group) => group.id)).toEqual([1, 0, 2, 9])
  })

  it('changes nothing past either end, for a group without a row, or for an unknown id', () => {
    expect(moveGroup(groups, 0, 'up')).toBe(groups)
    expect(moveGroup(groups, 2, 'down')).toBe(groups)
    expect(moveGroup(groups, 9, 'up')).toBe(groups)
    expect(moveGroup(groups, 4, 'up')).toBe(groups)
  })
})
