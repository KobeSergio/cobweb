import { DEFAULT_TRANSFER_VALIDATOR } from '@cobweb/shared'
import { zeroAddress, type Address } from 'viem'
import { describe, expect, it } from 'vitest'
import { PHASE_NAME_EMPTY, PHASE_NAME_LONG } from '@/components/manage/phase-rules'
import { DESCRIPTION_TOO_LONG, UNSAVED } from '@/lib/art/result'
import { parse } from '@/lib/art/schemas'
import {
  airdropCalls,
  callOf,
  PHASE_FUNCTIONS,
  phaseCalls,
  sentOf,
  SETTINGS_FUNCTIONS,
  settingsCalls,
  type ManageCall,
} from './phase-calls'
import {
  directionShape,
  onchainIdShape,
  parseSentCall,
  phaseAddShape,
  phaseDetailsShape,
} from './phase-schemas'

describe('parseSentCall', () => {
  it('accepts every call the dialogs build, and answers it unchanged', () => {
    const calls: ManageCall[] = [
      phaseCalls.register(2, '1500000000000000', 100, 1_791_039_600),
      phaseCalls.open(1),
      phaseCalls.close(0),
      phaseCalls.closeAll(),
      phaseCalls.publicCap(5),
      phaseCalls.schedule(1, 1_791_039_600),
      phaseCalls.clearSchedule(1),
      phaseCalls.price(2_147_483_647, '1000000000000000000000001'),
      phaseCalls.allocation(1, 0),
    ]
    for (const call of calls) {
      const parsed = parseSentCall(sentOf(call))
      expect(parsed.ok).toBe(true)
      if (parsed.ok) expect(callOf(parsed.data)).toEqual(call)
    }
  })

  it.each<[string, unknown]>([
    ['an unknown function', { functionName: 'renounceOwnership', args: [] }],
    ['a missing argument', { functionName: 'changeSalePrice', args: ['1000'] }],
    ['an extra argument', { functionName: 'setPublicMaxMintPerWallet', args: ['5', '6'] }],
    ['an id above 2,147,483,647', { functionName: 'setMintGroupStatus', args: ['2147483648', true] }],
    ['a negative value', { functionName: 'changeSalePrice', args: ['-1', '1'] }],
    ['a fraction', { functionName: 'setMintGroupMaxSupply', args: ['1', '1.5'] }],
    ['a value above 2^256 - 1', { functionName: 'changeSalePrice', args: ['9'.repeat(78), '1'] }],
    ['a boolean as text', { functionName: 'stopOrStartAllMintGroups', args: ['false'] }],
    ['nothing at all', null],
  ])('refuses %s as UNSAVED', (_label, input) => {
    expect(parseSentCall(input)).toEqual({ ok: false, error: UNSAVED })
  })
})

describe('phaseAddShape and phaseDetailsShape', () => {
  it("accepts an add and trims the name and the description; refuses with the screen's sentences", () => {
    expect(
      parse(phaseAddShape, {
        onchainId: 2,
        name: ' Holders ',
        description: ' For holders. ',
        visible: false,
      }),
    ).toEqual({
      ok: true,
      data: { onchainId: 2, name: 'Holders', description: 'For holders.', visible: false },
    })
    expect(parse(phaseAddShape, { onchainId: 0, name: 'Public', description: '', visible: true })).toEqual({
      ok: false,
      error: UNSAVED,
    })
    expect(parse(phaseAddShape, { onchainId: 2, name: '   ', description: '', visible: true })).toEqual({
      ok: false,
      error: PHASE_NAME_EMPTY,
    })
    expect(
      parse(phaseAddShape, { onchainId: 2, name: 'x'.repeat(41), description: '', visible: true }),
    ).toEqual({
      ok: false,
      error: PHASE_NAME_LONG,
    })
    expect(parse(phaseDetailsShape, { name: 'Holders', description: 'd'.repeat(501) })).toEqual({
      ok: false,
      error: DESCRIPTION_TOO_LONG,
    })
    expect(parse(phaseAddShape, { onchainId: 2, name: 'Holders', description: '', visible: 'yes' })).toEqual({
      ok: false,
      error: UNSAVED,
    })
  })

  it('trims a name with outer spaces before its checks, so 40 characters inside spaces pass and the database gets the trimmed name (Review Focus 4)', () => {
    const name = 'x'.repeat(40)
    expect(parse(phaseDetailsShape, { name: `  ${name}  `, description: '' })).toEqual({
      ok: true,
      data: { name, description: '' },
    })
  })

  it('checks a group id and a direction', () => {
    expect(parse(onchainIdShape, 0)).toEqual({ ok: true, data: 0 })
    expect(parse(onchainIdShape, 2_147_483_648)).toEqual({ ok: false, error: UNSAVED })
    expect(parse(onchainIdShape, 1.5)).toEqual({ ok: false, error: UNSAVED })
    expect(parse(directionShape, 'up')).toEqual({ ok: true, data: 'up' })
    expect(parse(directionShape, 'left')).toEqual({ ok: false, error: UNSAVED })
  })
})

describe('parseSentCall for a chunk (docs/specs/2026-10-15-whitelist.md, section 7.1)', () => {
  const A: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
  const B: Address = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'

  it('accepts checksummed addresses with as many quotas of 0 to 10,000, and answers the chunk unchanged', () => {
    const call = phaseCalls.quotas(2, [A, B], [10_000, 0])
    const parsed = parseSentCall(sentOf(call))
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(callOf(parsed.data)).toEqual(call)
  })

  it.each<[string, unknown]>([
    ['a lowercase address', { functionName: 'setMintQuota', args: [[A.toLowerCase()], '1', ['1']] }],
    [
      'a broken checksum',
      { functionName: 'setMintQuota', args: [['0x70997970c51812dc3A010C7d01b50e0d17dc79C8'], '1', ['1']] },
    ],
    [
      'addresses and quotas of different lengths',
      { functionName: 'setMintQuota', args: [[A, B], '1', ['1']] },
    ],
    ['an empty chunk', { functionName: 'setMintQuota', args: [[], '1', []] }],
    [
      '501 addresses',
      { functionName: 'setMintQuota', args: [Array(501).fill(A), '1', Array(501).fill('1')] },
    ],
    ['a quota of 10,001', { functionName: 'setMintQuota', args: [[A], '1', ['10001']] }],
    ['a quota as a number', { functionName: 'setMintQuota', args: [[A], '1', [1]] }],
    ['a group above 2,147,483,647', { functionName: 'setMintQuota', args: [[A], '2147483648', ['1']] }],
  ])('refuses %s as UNSAVED', (_label, input) => {
    expect(parseSentCall(input)).toEqual({ ok: false, error: UNSAVED })
  })
})

describe('parseSentCall for Airdrop and Settings (docs/specs/2026-10-15-airdrop-settings.md, section 7.1)', () => {
  const A: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
  const COLLECTION: Address = '0x0409454C375c8a6aB05383bFB6D9FcDe9ebB8F85'
  const URI = `ipfs://bafybei${'e'.repeat(52)}/`
  const TARGET = { contract: 'validator', address: DEFAULT_TRANSFER_VALIDATOR }
  const level = (args: unknown[], target: unknown = TARGET) => ({
    functionName: 'setTransferSecurityLevelOfCollection',
    args,
    target,
  })
  const batch = (count: number, amount: string) => ({
    functionName: 'airdropNFTs',
    args: [Array(count).fill(A), Array(count).fill(amount)],
    value: '0',
  })

  it('accepts every call the screens build, with its value and target, and answers it unchanged', () => {
    const calls: ManageCall[] = [
      airdropCalls.batch([{ address: A, amount: 1000 }], '100'),
      airdropCalls.burn(2, '0'),
      settingsCalls.withdraw(),
      settingsCalls.payout(A),
      settingsCalls.royalty(A, 1000),
      settingsCalls.royalty(A, 0),
      settingsCalls.baseUri(URI),
      settingsCalls.mintOnBehalf(false),
      settingsCalls.validator(zeroAddress),
      settingsCalls.level(DEFAULT_TRANSFER_VALIDATOR, COLLECTION, 9),
    ]
    for (const call of calls) {
      const parsed = parseSentCall(sentOf(call))
      expect(parsed.ok).toBe(true)
      if (parsed.ok) expect(callOf(parsed.data)).toEqual(call)
    }
  })

  it('strips a value or a target sent with another function', () => {
    expect(parseSentCall({ ...sentOf(settingsCalls.payout(A)), value: '5', target: TARGET })).toEqual({
      ok: true,
      data: { functionName: 'setOwnerPayoutAddress', args: [A] },
    })
  })

  it.each<[string, unknown]>([
    ['a 501st recipient', batch(501, '1')],
    [
      'a 1,001st token',
      {
        functionName: 'airdropNFTs',
        args: [
          [A, A],
          ['1000', '1'],
        ],
        value: '0',
      },
    ],
    ['an amount of 0', batch(1, '0')],
    [
      'recipients and amounts of different lengths',
      { functionName: 'airdropNFTs', args: [[A, A], ['1']], value: '0' },
    ],
    ['a lowercase recipient', { functionName: 'airdropNFTs', args: [[A.toLowerCase()], ['1']], value: '0' }],
    ['an airdrop without its value', { functionName: 'airdropNFTs', args: [[A], ['1']] }],
    ['a withdrawal with an argument', { functionName: 'withdrawMintFunds', args: ['1'] }],
    ['the zero payout address', { functionName: 'setOwnerPayoutAddress', args: [zeroAddress] }],
    ['a royalty of 1,001', { functionName: 'setDefaultRoyalty', args: [A, '1001'] }],
    ['the zero royalty recipient', { functionName: 'setDefaultRoyalty', args: [zeroAddress, '500'] }],
    ['a link without ipfs://', { functionName: 'setBaseURI', args: [`bafybei${'e'.repeat(52)}`] }],
    ['a link past 512 characters', { functionName: 'setBaseURI', args: [`${URI}${'x'.repeat(512)}`] }],
    ['mint on behalf as text', { functionName: 'setMintOnBehalfStatus', args: ['true'] }],
    ['a level of 2', level([COLLECTION, '2', false, false, false])],
    ['a flag turned on', level([COLLECTION, '9', true, false, false])],
    [
      'a level call without its target',
      { functionName: 'setTransferSecurityLevelOfCollection', args: [COLLECTION, '9', false, false, false] },
    ],
    [
      'a level call to the zero address',
      level([COLLECTION, '9', false, false, false], { contract: 'validator', address: zeroAddress }),
    ],
  ])('refuses %s as UNSAVED', (_label, input) => {
    expect(parseSentCall(input)).toEqual({ ok: false, error: UNSAVED })
  })

  it("refuses a function outside the confirm's own: no airdrop, Settings or quota call on Phases, no Phases call on Settings", () => {
    for (const call of [
      airdropCalls.burn(1, '0'),
      settingsCalls.withdraw(),
      settingsCalls.level(DEFAULT_TRANSFER_VALIDATOR, COLLECTION, 0),
      phaseCalls.quotas(1, [A], [1]),
    ])
      expect(parseSentCall(sentOf(call), PHASE_FUNCTIONS)).toEqual({ ok: false, error: UNSAVED })
    for (const call of [phaseCalls.open(1), airdropCalls.burn(1, '0')])
      expect(parseSentCall(sentOf(call), SETTINGS_FUNCTIONS)).toEqual({ ok: false, error: UNSAVED })
    expect(parseSentCall(sentOf(phaseCalls.open(1)), PHASE_FUNCTIONS).ok).toBe(true)
    expect(parseSentCall(sentOf(settingsCalls.withdraw()), SETTINGS_FUNCTIONS).ok).toBe(true)
  })
})
