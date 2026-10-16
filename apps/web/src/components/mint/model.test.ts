import type { Address } from 'viem'
import { describe, expect, it } from 'vitest'
import type { MintGroup } from '@/lib/demo/types'
import type { LocalMint, MintLive, WalletView } from '@/lib/mint/live-data'
import type { MintPageStatic } from '@/lib/mint/page-doc'
import { defaultPhaseId, deriveAction, derivePhases, sortPhases, totalMinted, type Phase } from './model'

const WALLET: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const VAULT: Address = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
const NOW = 1_791_039_600
const page: Pick<MintPageStatic, 'chain'> = {
  chain: { id: 31337, name: 'Anvil', nativeSymbol: 'ETH', explorerUrl: '', transferLock: false },
}

const group = (id: number, overrides: Partial<MintGroup> = {}): MintGroup => ({
  id,
  name: id === 0 ? 'Public' : `Group ${id}`,
  kind: id === 0 ? 'public' : 'whitelist',
  priceWei: '1000000000000000',
  maxSupply: 10,
  minted: 0,
  flag: false,
  scheduledStart: 0,
  active: false,
  visible: true,
  ...overrides,
})
const live = (groups: MintGroup[], overrides: Partial<MintLive> = {}): MintLive => ({
  block: 100,
  blockTimestamp: NOW,
  readAt: NOW,
  degraded: false,
  supply: { max: 20, minted: 0 },
  publicMaxMintPerWallet: 2,
  fees: { mintFeeFlatWei: '0', mintFeeBps: 0, airdropFeePerTokenWei: '0' },
  groups,
  creator: WALLET,
  royaltyBps: 500,
  baseUri: '',
  revealed: false,
  mintOnBehalfActive: false,
  transfers: null,
  royaltyEnforced: false,
  ...overrides,
})
const wallet = (overrides: Partial<WalletView> = {}): WalletView => ({
  address: WALLET,
  publicMinted: 0,
  groups: [
    { groupId: 0, quota: 0, used: 0, eligible: true },
    { groupId: 1, quota: 2, used: 0, eligible: true },
    { groupId: 2, quota: 0, used: 0, eligible: false },
  ],
  delegatedVaults: [],
  block: 100,
  ...overrides,
})

/** The action for the one phase of a state, connected with the wallet answer unless told otherwise. */
function actionFor(
  state: MintLive,
  options: {
    chainNow?: number
    view?: WalletView | null
    connected?: boolean
    vault?: Address | null
    wrongChain?: boolean
  } = {},
) {
  const view = options.view === undefined ? wallet() : options.view
  const phases = derivePhases(state, view, options.chainNow ?? NOW)
  const phase = phases.find((entry) => entry.group.id === defaultPhaseId(phases)) ?? null
  return deriveAction({
    page,
    live: state,
    phase,
    connected: options.connected ?? true,
    walletRead: view !== null,
    wrongChain: options.wrongChain ?? false,
    quantity: 1,
    vault: options.vault ?? null,
    soldOut: totalMinted(state) >= state.supply.max,
  })
}

describe('deriveAction (docs/specs/2026-10-16-mint-page-live-data.md, section 7.4)', () => {
  it('reads "Starts in 00:00:01" one second before the start, blocked', () => {
    const action = actionFor(live([group(0, { scheduledStart: NOW + 1 })]))
    expect(action).toEqual({ kind: 'blocked', label: 'Starts in 00:00:01' })
  })

  it('stays blocked past the start by the clock while the chain does not report the phase live', () => {
    const action = actionFor(live([group(0, { scheduledStart: NOW - 5 })]))
    expect(action).toEqual({ kind: 'blocked', label: 'Starting, waiting for the chain' })
  })

  it('offers the mint with its total only when the group is active', () => {
    const action = actionFor(live([group(0, { active: true, flag: true })]))
    expect(action.kind).toBe('mint')
    expect(action.label).toBe('Mint 1 for 0.001 ETH')
  })

  it('reads "Reading the chain" before the first answer and "Checking this wallet" before the wallet answer', () => {
    expect(
      deriveAction({
        page,
        live: null,
        phase: null,
        connected: true,
        walletRead: false,
        wrongChain: false,
        quantity: 1,
        vault: null,
        soldOut: false,
      }),
    ).toEqual({ kind: 'blocked', label: 'Reading the chain' })
    expect(actionFor(live([group(0, { active: true })]), { view: null })).toEqual({
      kind: 'blocked',
      label: 'Checking this wallet',
    })
  })

  it('asks to connect a visitor without a wallet', () => {
    expect(actionFor(live([group(0, { active: true })]), { connected: false, view: null }).kind).toBe(
      'connect',
    )
  })

  it('blocks a wallet that is not listed, including one whose quota is not on chain yet', () => {
    expect(actionFor(live([group(2, { active: true })])).label).toBe('Not on the whitelist for this phase')
  })

  it("reads the wallet's limit and a vault's limit", () => {
    expect(actionFor(live([group(0, { active: true })]), { view: wallet({ publicMinted: 2 }) }).label).toBe(
      'Wallet limit reached',
    )
    const vaulted = wallet({
      delegatedVaults: [{ vault: VAULT, groups: [{ groupId: 1, quota: 1, used: 1 }] }],
    })
    expect(actionFor(live([group(1, { active: true })]), { view: vaulted, vault: VAULT }).label).toBe(
      'Vault limit reached',
    )
  })

  it('reads a phase sold out when it is chosen, the collection sold out and the switch to the chain', () => {
    const soldOutPhase = live([
      group(0, { active: true, minted: 10, maxSupply: 10 }),
      group(1, { active: true }),
    ])
    const [chosen] = derivePhases(soldOutPhase, wallet(), NOW)
    expect(chosen?.status).toBe('soldout')
    expect(
      deriveAction({
        page,
        live: soldOutPhase,
        phase: chosen ?? null,
        connected: true,
        walletRead: true,
        wrongChain: false,
        quantity: 1,
        vault: null,
        soldOut: false,
      }).label,
    ).toBe('Phase sold out')
    expect(actionFor(live([group(0, { active: true })], { supply: { max: 20, minted: 20 } })).label).toBe(
      'Sold out',
    )
    expect(actionFor(live([group(0, { active: true })]), { wrongChain: true })).toEqual({
      kind: 'switch',
      label: 'Switch to Anvil',
    })
  })
})

describe('local mints', () => {
  const mint = (overrides: Partial<LocalMint> = {}): LocalMint => ({
    groupId: 0,
    holder: WALLET,
    count: 1,
    block: 105,
    ...overrides,
  })

  it('count toward supply while the state is older than the receipt, and not once it has read it', () => {
    const before = live([group(0, { active: true })], { block: 104 })
    expect(totalMinted(before, [mint()])).toBe(1)
    expect(derivePhases(before, null, NOW, [mint()])[0]?.remainingSupply).toBe(9)
    const after = live([group(0, { active: true, minted: 1 })], {
      block: 105,
      supply: { max: 20, minted: 1 },
    })
    expect(totalMinted(after, [mint()])).toBe(1)
    expect(derivePhases(after, null, NOW, [mint()])[0]?.remainingSupply).toBe(9)
  })

  it("count toward the wallet's allowance while its answer is older than the receipt, never twice", () => {
    const state = live([group(0, { active: true })])
    const older = derivePhases(state, wallet({ block: 104 }), NOW, [mint()])[0]
    expect(older?.wallet).toMatchObject({ used: 1, remaining: 1 })
    const newer = derivePhases(state, wallet({ block: 105, publicMinted: 1 }), NOW, [mint()])[0]
    expect(newer?.wallet).toMatchObject({ used: 1, remaining: 1 })
  })

  it("count a vault's mint toward the vault's allowance, not the wallet's (Review Focus 4)", () => {
    const view = wallet({
      block: 100,
      delegatedVaults: [{ vault: VAULT, groups: [{ groupId: 1, quota: 3, used: 0 }] }],
    })
    const [phase] = derivePhases(live([group(1, { active: true })]), view, NOW, [
      mint({ groupId: 1, holder: VAULT, count: 2 }),
    ])
    expect(phase?.vaults[0]).toMatchObject({ vault: VAULT, used: 2, remaining: 1 })
    expect(phase?.wallet).toMatchObject({ used: 0, remaining: 2 })
  })
})

describe('the phases', () => {
  it('offer vaults on whitelist phases only, and leave hidden phases off', () => {
    const view = wallet({ delegatedVaults: [{ vault: VAULT, groups: [{ groupId: 1, quota: 3, used: 0 }] }] })
    const phases = derivePhases(
      live([group(0, { active: true }), group(1, { active: true }), group(3, { visible: false })]),
      view,
      NOW,
    )
    expect(phases.map((phase) => [phase.group.id, phase.vaults.length])).toEqual([
      [0, 0],
      [1, 1],
    ])
  })

  it("keep the join's order within each section: open now, coming up, finished", () => {
    const groups = [
      group(4, { scheduledStart: NOW + 500 }),
      group(1, { minted: 3 }),
      group(3, { active: true }),
      group(2, { scheduledStart: NOW + 100 }),
      group(0, { active: true }),
    ]
    const sorted = sortPhases(derivePhases(live(groups), null, NOW)).map((phase: Phase) => phase.group.id)
    expect(sorted).toEqual([3, 0, 4, 2, 1])
  })

  it('open the panel on the cheapest live phase the wallet can mint, else the next start', () => {
    const groups = [group(0, { active: true, priceWei: '5' }), group(1, { active: true, priceWei: '2' })]
    expect(defaultPhaseId(derivePhases(live(groups), wallet(), NOW))).toBe(1)
    const upcoming = [group(4, { scheduledStart: NOW + 500 }), group(2, { scheduledStart: NOW + 100 })]
    expect(defaultPhaseId(derivePhases(live(upcoming), null, NOW))).toBe(2)
  })
})
