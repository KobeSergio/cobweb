import type { Address } from 'viem'
import { describe, expect, it } from 'vitest'
import { PHASE_NAME_EMPTY, PHASE_NAME_LONG } from '@/components/manage/phase-rules'
import { DESCRIPTION_TOO_LONG, UNSAVED } from '@/lib/art/result'
import { parse } from '@/lib/art/schemas'
import { callOf, phaseCalls, sentOf, type ManageCall } from './phase-calls'
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
    ['an unknown function', { functionName: 'withdrawMintFunds', args: [] }],
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
