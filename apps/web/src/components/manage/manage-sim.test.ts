import type { Address, Hex } from 'viem'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { classifyError } from '@/components/deploy/tx-errors'
import { DEMO_COLLECTION, DEMO_MINT_GROUPS, DEMO_NOW, DEMO_TOTAL_MINTED } from '@/lib/demo'
import { airdropCalls, phaseCalls, settingsCalls, type ManageCall } from '@/lib/manage/phase-calls'
import type { PhasesView } from '@/lib/manage/phases-types'
import {
  sampleApply,
  sampleManageActions,
  samplePhasesServer,
  samplePhasesView,
  sampleRevert,
} from './manage-sim'
import { sampleSettingsView } from './settings-sim'

const view: PhasesView = samplePhasesView({ max_supply: DEMO_COLLECTION.maxSupply })

describe('samplePhasesView', () => {
  it("builds today's sample at the sample supply, and the copy for ?chain=unreachable", () => {
    expect(view).toMatchObject({
      groups: DEMO_MINT_GROUPS,
      totalMinted: DEMO_TOTAL_MINTED,
      maxSupply: DEMO_COLLECTION.maxSupply,
      blockTimestamp: DEMO_NOW,
      readAt: DEMO_NOW,
      chainReachable: true,
    })
    const copy = samplePhasesView({ max_supply: DEMO_COLLECTION.maxSupply }, false)
    expect(copy.chainReachable).toBe(false)
    expect(copy.totalMinted).toBe(0)
    expect(copy.groups.every((group) => !group.active && !group.flag && group.minted === 0)).toBe(true)
  })
})

describe('sampleRevert', () => {
  const sentence = (call: ManageCall) => {
    const refused = sampleRevert(call, view)
    return refused ? classifyError(refused, 'simulating', 'manage').message : null
  }

  it('refuses as the contract would, decoded into the same sentences', () => {
    // Owl List (1) has minted 186 of 250; Public (0) holds 477 and Team (2) 50 of the 777.
    expect(sentence(phaseCalls.allocation(1, 100))).toBe(
      'It cannot go below 186, the tokens this phase has already minted. Nothing was sent.',
    )
    expect(sentence(phaseCalls.allocation(1, 251))).toBe(
      "The phases' allocations together would be more than the collection's supply. Lower another phase first. Nothing was sent.",
    )
    expect(sentence(phaseCalls.register(1, '0', 0, 0))).toBe(
      'Phase 1 is already on the contract. Read the contract again, then add the phase. Nothing was sent.',
    )
    expect(sentence(phaseCalls.open(9))).toBe(
      'Phase 9 is not on the contract. Read the contract again. Nothing was sent.',
    )
    expect(sentence(phaseCalls.price(9, '1'))).toBe(
      'Phase 9 is not on the contract. Read the contract again. Nothing was sent.',
    )
  })

  it('lets through what the contract would accept', () => {
    expect(sampleRevert(phaseCalls.allocation(1, 250), view)).toBeNull()
    expect(sampleRevert(phaseCalls.register(3, '0', 0, 0), view)).toBeNull()
    expect(sampleRevert(phaseCalls.closeAll(), view)).toBeNull()
    expect(sampleRevert(phaseCalls.publicCap(9), view)).toBeNull()
  })
})

describe('sampleApply', () => {
  it("applies each change and takes live from the sample chain's clock", () => {
    const scheduled = sampleApply(phaseCalls.schedule(2, DEMO_NOW - 60), view)
    expect(scheduled.groups.find((group) => group.id === 2)).toMatchObject({
      scheduledStart: DEMO_NOW - 60,
      flag: false,
      active: true,
    })
    const closed = sampleApply(phaseCalls.close(1), view)
    expect(closed.groups.find((group) => group.id === 1)).toMatchObject({ flag: false, active: false })
    const all = sampleApply(phaseCalls.closeAll(), view)
    expect(all.groups.every((group) => !group.flag && group.scheduledStart === 0 && !group.active)).toBe(true)
    expect(sampleApply(phaseCalls.price(1, '5'), view).groups.find((group) => group.id === 1)?.priceWei).toBe(
      '5',
    )
    expect(sampleApply(phaseCalls.publicCap(9), view).publicMaxPerWallet).toBe(9)
    const added = sampleApply(phaseCalls.register(3, '0', 10, 0), view, {
      onchainId: 3,
      name: 'Holders',
      description: 'Holders of the first collection.',
      visible: false,
    })
    expect(added.groups.at(-1)).toMatchObject({
      id: 3,
      name: 'Holders',
      visible: false,
      named: true,
      maxSupply: 10,
    })
  })
})

describe('the sample actions and server', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('checks for 650 ms, sends on Approve, refuses on Reject, and reverts after Approve, then revert', async () => {
    const sent = new Map<Hex, ManageCall>()
    const actions = sampleManageActions(() => view, sent)

    const simulating = actions.simulate(phaseCalls.open(2))
    await vi.advanceTimersByTimeAsync(650)
    const send = await simulating
    const sending = send()
    actions.answer?.('approve')
    const hash = await sending
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/)
    expect(sent.get(hash)).toEqual(phaseCalls.open(2))
    const waiting = actions.wait(hash)
    await vi.advanceTimersByTimeAsync(1600)
    expect(await waiting).toBe('success')

    const again = actions.simulate(phaseCalls.open(2))
    await vi.advanceTimersByTimeAsync(650)
    const rejected = (await again)()
    actions.answer?.('reject')
    await expect(rejected).rejects.toMatchObject({ name: 'UserRejectedRequestError', code: 4001 })

    const third = actions.simulate(phaseCalls.open(2))
    await vi.advanceTimersByTimeAsync(650)
    const reverting = (await third)()
    actions.answer?.('approve-revert')
    const revertHash = await reverting
    const revertWait = actions.wait(revertHash)
    await vi.advanceTimersByTimeAsync(1600)
    expect(await revertWait).toBe('reverted')
  })

  it('refuses at the check what the contract would refuse', async () => {
    const actions = sampleManageActions(() => view)
    const refused = actions.simulate(phaseCalls.allocation(1, 100))
    const expectation = expect(refused).rejects.toMatchObject({ name: 'ContractFunctionRevertedError' })
    await vi.advanceTimersByTimeAsync(650)
    await expectation
  })

  it('answers the next free id, and records an add with the call the wallet sent', async () => {
    const sent = new Map<Hex, ManageCall>()
    const actions = sampleManageActions(() => view, sent)
    const server = samplePhasesServer(() => view, sent)
    expect(await actions.nextGroupId()).toBe(3)
    const hash: Hex = `0x${'cd'.repeat(32)}`
    sent.set(hash, phaseCalls.register(3, '1000', 20, 0))
    const recording = server.record(hash, { onchainId: 3, name: 'Holders', description: '', visible: true })
    await vi.advanceTimersByTimeAsync(900)
    const result = await recording
    expect(result.ok && result.data.groups.at(-1)).toMatchObject({
      id: 3,
      name: 'Holders',
      priceWei: '1000',
      maxSupply: 20,
    })
  })
})

describe('the quota call on the sample (docs/specs/2026-10-15-whitelist.md, section 8)', () => {
  const A: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
  const sentence = (call: ManageCall) => {
    const refused = sampleRevert(call, view)
    return refused ? classifyError(refused, 'simulating', 'manage').message : null
  }

  it('refuses unequal lengths, the public sale and an unknown group as the contract would', () => {
    expect(sentence({ functionName: 'setMintQuota', args: [[A], 1n, [1n, 2n]] })).toBe(
      'The addresses and amounts do not line up. Reload and try again. Nothing was sent.',
    )
    expect(sentence(phaseCalls.quotas(0, [A], [1]))).toBe(
      'The public sale has no whitelist. Nothing was sent.',
    )
    expect(sentence(phaseCalls.quotas(9, [A], [1]))).toBe(
      'Phase 9 is not on the contract. Read the contract again. Nothing was sent.',
    )
    expect(sampleRevert(phaseCalls.quotas(1, [A], [1]), view)).toBeNull()
  })

  it('changes no group of the phases view', () => {
    expect(sampleApply(phaseCalls.quotas(1, [A], [1]), view)).toEqual(view)
  })
})

describe('Airdrop and Settings on the sample (docs/specs/2026-10-15-airdrop-settings.md, section 8)', () => {
  const A: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
  const settings = sampleSettingsView({ max_supply: DEMO_COLLECTION.maxSupply }, A)
  const sentence = (call: ManageCall, settingsView?: typeof settings) => {
    const refused = sampleRevert(call, view, settingsView)
    return refused ? classifyError(refused, 'simulating', 'manage').message : null
  }

  it('refuses unequal lengths and more tokens than are left, as the contract would', () => {
    const left = view.maxSupply - view.totalMinted
    expect(sentence({ functionName: 'airdropNFTs', args: [[A], [1n, 2n]], value: 0n })).toBe(
      'The addresses and amounts do not line up. Reload and try again. Nothing was sent.',
    )
    expect(sentence(airdropCalls.batch([{ address: A, amount: left + 1 }], '0'))).toBe(
      `Only ${left.toLocaleString('en-US')} tokens are left to mint, not ${(left + 1).toLocaleString('en-US')}. Nothing was sent.`,
    )
    expect(sampleRevert(airdropCalls.batch([{ address: A, amount: left }], '0'), view)).toBeNull()
  })

  it('refuses a withdrawal at a balance of 0 on the Settings view, and lets it through with a balance', () => {
    expect(sentence(settingsCalls.withdraw(), { ...settings, creatorBalanceWei: '0' })).toBe(
      'There is nothing to withdraw: the balance is 0. Nothing was sent.',
    )
    expect(sentence(settingsCalls.withdraw(), settings)).toBeNull()
    expect(sentence(settingsCalls.withdraw())).toBeNull()
  })

  it('changes no group of the phases view', () => {
    for (const call of [
      airdropCalls.burn(1, '0'),
      settingsCalls.withdraw(),
      settingsCalls.mintOnBehalf(true),
    ])
      expect(sampleApply(call, view)).toEqual(view)
  })

  it('checks a withdrawal against the Settings view the actions are given', async () => {
    vi.useFakeTimers()
    const actions = sampleManageActions(
      () => view,
      new Map(),
      () => ({ ...settings, creatorBalanceWei: '0' }),
    )
    const refused = actions.simulate(settingsCalls.withdraw())
    const expectation = expect(refused).rejects.toMatchObject({ name: 'ContractFunctionRevertedError' })
    await vi.advanceTimersByTimeAsync(650)
    await expectation
    vi.useRealTimers()
  })
})
