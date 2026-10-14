import { collectionAbi } from '@cobweb/shared/collection-abi'
import {
  encodeAbiParameters,
  encodeEventTopics,
  getAbiItem,
  type AbiEvent,
  type Address,
  type Hex,
} from 'viem'
import { describe, expect, it } from 'vitest'
import { NOT_FROM_WALLET, NOT_THIS_CHANGE, NOT_THIS_CONTRACT } from '@/lib/art/result'
import { expectedEvent, phaseCalls, type ManageCall } from '@/lib/manage/phase-calls'
import { matchPhaseEvent, type PhaseReceipt } from './phase-events'

const CONTRACT: Address = '0x0409454C375c8a6aB05383bFB6D9FcDe9ebB8F85'
const ELSEWHERE: Address = '0x2073D2716161E2Fa4eBcB3BA42348dE8f98A3dDd'
const WALLET: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const STRANGER: Address = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'

type ReceiptLog = PhaseReceipt['logs'][number]
type EventName = Extract<(typeof collectionAbi)[number], { type: 'event' }>['name']

/** A log of a collection event, encoded as the contract emits it: indexed arguments in topics, the rest in data. */
function logOf(address: Address, eventName: EventName, args: Record<string, bigint | boolean>): ReceiptLog {
  const item = getAbiItem({ abi: collectionAbi, name: eventName }) as AbiEvent
  const indexed = Object.fromEntries(
    item.inputs.filter((input) => input.indexed).map((input) => [input.name ?? '', args[input.name ?? '']]),
  )
  const data = item.inputs.filter((input) => !input.indexed)
  return {
    address,
    topics: encodeEventTopics({
      abi: [item],
      eventName: item.name,
      args: indexed,
    } as never) as ReceiptLog['topics'],
    data: encodeAbiParameters(data, data.map((input) => args[input.name ?? '']) as never) as Hex,
  }
}

const receipt = (logs: ReceiptLog[], patch: Partial<PhaseReceipt> = {}): PhaseReceipt => ({
  status: 'success',
  from: WALLET,
  to: CONTRACT,
  logs,
  ...patch,
})

const expect_ = (call: ManageCall) => ({
  contract: CONTRACT,
  from: WALLET.toLowerCase(),
  event: expectedEvent(call),
})

describe('matchPhaseEvent', () => {
  it.each<[string, ManageCall, EventName, Record<string, bigint | boolean>]>([
    ['Add phase', phaseCalls.register(2, '0', 1, 0), 'MintGroupRegistered', { mintGroup: 2n }],
    ['Open now', phaseCalls.open(1), 'MintGroupStatusChanged', { mintGroup: 1n, status: true }],
    ['Close', phaseCalls.close(1), 'MintGroupStatusChanged', { mintGroup: 1n, status: false }],
    ['Close all', phaseCalls.closeAll(), 'AllMintGroupsStatusChanged', { status: false, groupsAffected: 3n }],
    [
      'Schedule',
      phaseCalls.schedule(1, 1_791_039_600),
      'MintGroupStartTimestampChanged',
      { mintGroup: 1n, timestamp: 1_791_039_600n },
    ],
    [
      'Clear schedule',
      phaseCalls.clearSchedule(1),
      'MintGroupStartTimestampChanged',
      { mintGroup: 1n, timestamp: 0n },
    ],
    ['Edit price', phaseCalls.price(1, '2000'), 'SalePriceChanged', { mintGroup: 1n, newPrice: 2000n }],
    [
      'Edit max supply',
      phaseCalls.allocation(1, 0),
      'MintGroupMaxSupplyUpdated',
      { mintGroup: 1n, newMaxSupply: 0n },
    ],
    [
      'Edit per-wallet limit',
      phaseCalls.publicCap(5),
      'PublicMaxMintPerWalletChanged',
      { newMaxMintPerWallet: 5n },
    ],
  ])('matches %s by its event and arguments', (_label, call, eventName, args) => {
    expect(matchPhaseEvent(receipt([logOf(CONTRACT, eventName, args)]), expect_(call))).toEqual({ ok: true })
  })

  it('refuses a transaction sent to another contract, and a contract creation', () => {
    const log = logOf(CONTRACT, 'MintGroupStatusChanged', { mintGroup: 1n, status: true })
    expect(matchPhaseEvent(receipt([log], { to: ELSEWHERE }), expect_(phaseCalls.open(1)))).toEqual({
      ok: false,
      error: NOT_THIS_CONTRACT,
    })
    expect(matchPhaseEvent(receipt([log], { to: null }), expect_(phaseCalls.open(1)))).toEqual({
      ok: false,
      error: NOT_THIS_CONTRACT,
    })
  })

  it('refuses a transaction sent from another wallet', () => {
    const log = logOf(CONTRACT, 'MintGroupStatusChanged', { mintGroup: 1n, status: true })
    expect(matchPhaseEvent(receipt([log], { from: STRANGER }), expect_(phaseCalls.open(1)))).toEqual({
      ok: false,
      error: NOT_FROM_WALLET,
    })
  })

  it('refuses a receipt without the event, with other arguments, or with another event of the collection', () => {
    const refused = { ok: false, error: NOT_THIS_CHANGE }
    expect(matchPhaseEvent(receipt([]), expect_(phaseCalls.open(1)))).toEqual(refused)
    expect(
      matchPhaseEvent(
        receipt([logOf(CONTRACT, 'MintGroupStatusChanged', { mintGroup: 1n, status: false })]),
        expect_(phaseCalls.open(1)),
      ),
    ).toEqual(refused)
    expect(
      matchPhaseEvent(
        receipt([logOf(CONTRACT, 'SalePriceChanged', { mintGroup: 2n, newPrice: 2000n })]),
        expect_(phaseCalls.price(1, '2000')),
      ),
    ).toEqual(refused)
    expect(
      matchPhaseEvent(
        receipt([logOf(CONTRACT, 'SalePriceChanged', { mintGroup: 1n, newPrice: 2000n })]),
        expect_(phaseCalls.allocation(1, 2000)),
      ),
    ).toEqual(refused)
    const unrelated: ReceiptLog = { address: CONTRACT, topics: [`0x${'12'.repeat(32)}`], data: '0x' }
    expect(matchPhaseEvent(receipt([unrelated]), expect_(phaseCalls.open(1)))).toEqual(refused)
  })

  it('ignores the expected event when another contract logs it in the same receipt', () => {
    expect(
      matchPhaseEvent(
        receipt([logOf(ELSEWHERE, 'MintGroupStatusChanged', { mintGroup: 1n, status: true })]),
        expect_(phaseCalls.open(1)),
      ),
    ).toEqual({ ok: false, error: NOT_THIS_CHANGE })
  })

  it('never matches a reverted receipt', () => {
    expect(
      matchPhaseEvent(
        receipt([logOf(CONTRACT, 'MintGroupStatusChanged', { mintGroup: 1n, status: true })], {
          status: 'reverted',
        }),
        expect_(phaseCalls.open(1)),
      ),
    ).toEqual({ ok: false, error: NOT_THIS_CHANGE })
  })

  it('matches the contract and the sign-in wallet whatever their case (Review Focus 2)', () => {
    const log = logOf(CONTRACT.toLowerCase() as Address, 'MintGroupStatusChanged', {
      mintGroup: 1n,
      status: true,
    })
    // The session wallet is stored lowercase; the receipt carries it checksummed, the contract either way.
    expect(
      matchPhaseEvent(receipt([log], { from: WALLET, to: CONTRACT.toLowerCase() as Address }), {
        contract: CONTRACT,
        from: WALLET.toLowerCase(),
        event: expectedEvent(phaseCalls.open(1)),
      }),
    ).toEqual({ ok: true })
  })

  it('matches Close all whatever number of groups it closed (Review Focus 3)', () => {
    for (const groupsAffected of [1n, 3n, 10n])
      expect(
        matchPhaseEvent(
          receipt([
            logOf(CONTRACT, 'MintGroupStatusChanged', { mintGroup: 0n, status: false }),
            logOf(CONTRACT, 'AllMintGroupsStatusChanged', { status: false, groupsAffected }),
          ]),
          expect_(phaseCalls.closeAll()),
        ),
      ).toEqual({ ok: true })
  })
})
