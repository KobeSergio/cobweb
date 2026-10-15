import { DEFAULT_TRANSFER_VALIDATOR } from '@cobweb/shared'
import { getAddress, zeroAddress, type Address, type Hex } from 'viem'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEMO_ACTIVITY, DEMO_DEPLOYMENT, DEMO_MINTER, DEMO_PLACEHOLDER, DEMO_RENDER_JOBS } from '@/lib/demo'
import { settingsCalls } from '@/lib/manage/phase-calls'
import type { SettingsView } from '@/lib/manage/settings-types'
import { sampleApplySettings, sampleSettingsServer, sampleSettingsView } from './settings-sim'

const WALLET: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const A: Address = '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65'
const HASH: Hex = `0x${'cd'.repeat(32)}`
const REAL = `ipfs://${DEMO_RENDER_JOBS.done.metadataCid}/`
const PLACEHOLDER = `ipfs://${DEMO_PLACEHOLDER.cid}/metadata.json`
const view: SettingsView = sampleSettingsView({ max_supply: null }, WALLET)

describe('sampleSettingsView', () => {
  it("reads Base's sample: the proceeds, the fees, payout and royalty, the placeholder, the default validator", () => {
    expect(view).toMatchObject({
      chainId: 8453,
      owner: WALLET,
      creatorBalanceWei: DEMO_ACTIVITY.proceeds.withdrawableWei,
      platformBalanceWei: DEMO_ACTIVITY.proceeds.platformFeesWei,
      pendingBalanceWei: '0',
      withdrawnWei: DEMO_ACTIVITY.proceeds.withdrawnWei,
      fees: DEMO_DEPLOYMENT.fees,
      payout: getAddress(DEMO_DEPLOYMENT.payoutAddress),
      royaltyBps: 500,
      baseUri: PLACEHOLDER,
      pointer: 'placeholder',
      targets: { real: REAL, placeholder: PLACEHOLDER, start: PLACEHOLDER },
      realArtRendered: true,
      transferValidator: DEFAULT_TRANSFER_VALIDATOR,
      mintOnBehalf: false,
      level: { kind: 'level', level: 0 },
      chainReachable: true,
    })
  })

  it('has no real job for ?art=deferred, reads revealed for ?art=revealed, names ?owner=other, and the copies for ?chain=unreachable', () => {
    expect(sampleSettingsView({ max_supply: null }, WALLET, { art: 'deferred' })).toMatchObject({
      realArtRendered: false,
      pointer: 'placeholder',
    })
    expect(sampleSettingsView({ max_supply: null }, WALLET, { art: 'revealed' })).toMatchObject({
      baseUri: REAL,
      pointer: 'revealed',
    })
    expect(sampleSettingsView({ max_supply: null }, WALLET, { owner: DEMO_MINTER }).owner).toBe(DEMO_MINTER)
    expect(sampleSettingsView({ max_supply: null }, WALLET, { chainReachable: false })).toMatchObject({
      owner: null,
      creatorBalanceWei: null,
      platformBalanceWei: null,
      fees: null,
      level: null,
      payout: getAddress(DEMO_DEPLOYMENT.payoutAddress),
      transferValidator: DEFAULT_TRANSFER_VALIDATOR,
      chainReachable: false,
    })
  })
})

describe('sampleApplySettings', () => {
  it('applies each change as a read after it would show it', () => {
    expect(sampleApplySettings(settingsCalls.withdraw(), view)).toMatchObject({
      creatorBalanceWei: '0',
      withdrawnWei: (
        BigInt(DEMO_ACTIVITY.proceeds.withdrawnWei) + BigInt(DEMO_ACTIVITY.proceeds.withdrawableWei)
      ).toString(),
      // The contract keeps the platform's balance apart: a withdrawal leaves it.
      platformBalanceWei: DEMO_ACTIVITY.proceeds.platformFeesWei,
    })
    expect(sampleApplySettings(settingsCalls.payout(A), view).payout).toBe(A)
    expect(sampleApplySettings(settingsCalls.royalty(A, 750), view)).toMatchObject({
      royaltyReceiver: A,
      royaltyBps: 750,
    })
    expect(sampleApplySettings(settingsCalls.baseUri(REAL), view)).toMatchObject({
      baseUri: REAL,
      pointer: 'revealed',
    })
    expect(sampleApplySettings(settingsCalls.mintOnBehalf(true), view).mintOnBehalf).toBe(true)
    expect(sampleApplySettings(settingsCalls.validator(zeroAddress), view)).toMatchObject({
      transferValidator: zeroAddress,
      level: { kind: 'none', reason: 'zero' },
    })
    expect(sampleApplySettings(settingsCalls.validator(A), view).level).toEqual({ kind: 'level', level: 0 })
    expect(
      sampleApplySettings(settingsCalls.level(DEFAULT_TRANSFER_VALIDATOR, view.contract, 9), view).level,
    ).toEqual({ kind: 'level', level: 9 })
    // A new validator reads at the enforced level whatever the view held before (here, no validator).
    const cleared = sampleApplySettings(settingsCalls.validator(zeroAddress), view)
    expect(sampleApplySettings(settingsCalls.validator(A), cleared).level).toEqual({
      kind: 'level',
      level: 0,
    })
    // The level call sets the level it names.
    expect(
      sampleApplySettings(settingsCalls.level(DEFAULT_TRANSFER_VALIDATOR, view.contract, 1), view).level,
    ).toEqual({ kind: 'level', level: 1 })
  })
})

describe('sampleSettingsServer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('answers after 900 ms with the call applied', async () => {
    const server = sampleSettingsServer(() => view)
    const confirming = server.confirm(HASH, settingsCalls.mintOnBehalf(true))
    await vi.advanceTimersByTimeAsync(900)
    expect(await confirming).toMatchObject({ ok: true, data: { mintOnBehalf: true } })
  })
})
