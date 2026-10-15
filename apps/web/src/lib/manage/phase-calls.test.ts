import { collectionAbi } from '@cobweb/shared/collection-abi'
import {
  concat,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  pad,
  toFunctionSelector,
  toHex,
  type Address,
  type Hex,
} from 'viem'
import { describe, expect, it } from 'vitest'
import type { SupportedChain } from '@/lib/demo/types'
import { callOf, expectedEvent, phaseCalls, reviewOf, sentOf, type ManageCall } from './phase-calls'

const BASE: SupportedChain = {
  id: 8453,
  name: 'Base',
  nativeSymbol: 'ETH',
  explorerUrl: 'https://basescan.org',
  transferLock: true,
}
const UINT = { type: 'uint256' } as const
const BOOL = { type: 'bool' } as const

/** The calldata a hand-written signature gives for the same values. */
function handEncoded(signature: string, types: readonly { type: string }[], values: readonly unknown[]): Hex {
  return concat([toFunctionSelector(signature), encodeAbiParameters(types, values)])
}

const encoded = (call: ManageCall) =>
  encodeFunctionData({ abi: collectionAbi, functionName: call.functionName, args: call.args })

describe('phaseCalls', () => {
  it('encodes each call as the hand-written signature does, the price first in changeSalePrice', () => {
    expect(encoded(phaseCalls.register(2, '1500000000000000', 100, 1_791_039_600))).toBe(
      handEncoded(
        'registerMintGroup(uint256,uint256,uint256,uint256)',
        [UINT, UINT, UINT, UINT],
        [2n, 1_500_000_000_000_000n, 100n, 1_791_039_600n],
      ),
    )
    expect(encoded(phaseCalls.open(1))).toBe(
      handEncoded('setMintGroupStatus(uint256,bool)', [UINT, BOOL], [1n, true]),
    )
    expect(encoded(phaseCalls.close(1))).toBe(
      handEncoded('setMintGroupStatus(uint256,bool)', [UINT, BOOL], [1n, false]),
    )
    expect(encoded(phaseCalls.closeAll())).toBe(
      handEncoded('stopOrStartAllMintGroups(bool)', [BOOL], [false]),
    )
    expect(encoded(phaseCalls.publicCap(5))).toBe(
      handEncoded('setPublicMaxMintPerWallet(uint256)', [UINT], [5n]),
    )
    expect(encoded(phaseCalls.schedule(1, 1_791_039_600))).toBe(
      handEncoded('scheduleMintGroupStart(uint256,uint256)', [UINT, UINT], [1n, 1_791_039_600n]),
    )
    expect(encoded(phaseCalls.clearSchedule(1))).toBe(
      handEncoded('scheduleMintGroupStart(uint256,uint256)', [UINT, UINT], [1n, 0n]),
    )
    expect(encoded(phaseCalls.price(1, '2000000000000000'))).toBe(
      handEncoded('changeSalePrice(uint256,uint256)', [UINT, UINT], [2_000_000_000_000_000n, 1n]),
    )
    expect(encoded(phaseCalls.allocation(1, 0))).toBe(
      handEncoded('setMintGroupMaxSupply(uint256,uint256)', [UINT, UINT], [1n, 0n]),
    )
  })
})

describe('expectedEvent', () => {
  it('names the event each call leaves, with its arguments', () => {
    expect(expectedEvent(phaseCalls.register(2, '0', 1, 0))).toEqual({
      eventName: 'MintGroupRegistered',
      args: { mintGroup: 2n },
    })
    expect(expectedEvent(phaseCalls.open(1))).toEqual({
      eventName: 'MintGroupStatusChanged',
      args: { mintGroup: 1n, status: true },
    })
    expect(expectedEvent(phaseCalls.close(1))).toEqual({
      eventName: 'MintGroupStatusChanged',
      args: { mintGroup: 1n, status: false },
    })
    expect(expectedEvent(phaseCalls.closeAll())).toEqual({
      eventName: 'AllMintGroupsStatusChanged',
      args: { status: false },
    })
    expect(expectedEvent(phaseCalls.schedule(1, 1_791_039_600))).toEqual({
      eventName: 'MintGroupStartTimestampChanged',
      args: { mintGroup: 1n, timestamp: 1_791_039_600n },
    })
    expect(expectedEvent(phaseCalls.clearSchedule(1))).toEqual({
      eventName: 'MintGroupStartTimestampChanged',
      args: { mintGroup: 1n, timestamp: 0n },
    })
    expect(expectedEvent(phaseCalls.price(1, '2000'))).toEqual({
      eventName: 'SalePriceChanged',
      args: { mintGroup: 1n, newPrice: 2000n },
    })
    expect(expectedEvent(phaseCalls.allocation(1, 0))).toEqual({
      eventName: 'MintGroupMaxSupplyUpdated',
      args: { mintGroup: 1n, newMaxSupply: 0n },
    })
    expect(expectedEvent(phaseCalls.publicCap(5))).toEqual({
      eventName: 'PublicMaxMintPerWalletChanged',
      args: { newMaxMintPerWallet: 5n },
    })
  })
})

describe('reviewOf', () => {
  it("shows the ABI's argument names with readable values", () => {
    expect(reviewOf(phaseCalls.price(1, '1500000000000000'), BASE)).toEqual([
      { name: 'newMintPrice', value: '0.0015 ETH (1500000000000000 wei)' },
      { name: 'mintGroup', value: '1' },
    ])
    expect(reviewOf(phaseCalls.register(2, '0', 100, 1_791_039_600), BASE)).toEqual([
      { name: 'mintGroup', value: '2' },
      { name: 'price', value: '0 ETH (0 wei)' },
      { name: 'maxSupply', value: '100' },
      { name: 'startTimestamp', value: '2026-10-03 15:00 UTC (1791039600)' },
    ])
    expect(reviewOf(phaseCalls.clearSchedule(1), BASE)).toEqual([
      { name: 'mintGroup', value: '1' },
      { name: 'startTimestamp', value: '0 (no scheduled start)' },
    ])
    expect(reviewOf(phaseCalls.open(1), BASE)).toEqual([
      { name: 'mintGroup', value: '1' },
      { name: 'status', value: 'true' },
    ])
    expect(reviewOf(phaseCalls.closeAll(), BASE)).toEqual([{ name: 'status', value: 'false' }])
    expect(reviewOf(phaseCalls.publicCap(5), BASE)).toEqual([
      { name: 'newPublicMaxMintPerWallet', value: '5' },
    ])
  })
})

describe('sentOf and callOf', () => {
  it('round trip every call through decimal strings', () => {
    const calls: ManageCall[] = [
      phaseCalls.register(2, '1500000000000000', 100, 1_791_039_600),
      phaseCalls.open(1),
      phaseCalls.close(0),
      phaseCalls.closeAll(),
      phaseCalls.publicCap(5),
      phaseCalls.schedule(1, 1_791_039_600),
      phaseCalls.clearSchedule(1),
      phaseCalls.price(1, '2000'),
      phaseCalls.allocation(1, 0),
    ]
    for (const call of calls) expect(callOf(sentOf(call))).toEqual(call)
    expect(sentOf(phaseCalls.price(1, '2000'))).toEqual({
      functionName: 'changeSalePrice',
      args: ['2000', '1'],
    })
    expect(sentOf(phaseCalls.open(1))).toEqual({ functionName: 'setMintGroupStatus', args: ['1', true] })
  })

  it('keeps every wei of a price above 2^53 through sentOf, callOf and the expected event (Review Focus 1)', () => {
    // 1,000,000 MON is 10^24 wei: far above what a JavaScript number holds exactly.
    const priceWei = '1000000000000000000000001'
    const sent = sentOf(phaseCalls.price(3, priceWei))
    expect(sent.args[0]).toBe(priceWei)
    expect(expectedEvent(callOf(sent))).toEqual({
      eventName: 'SalePriceChanged',
      args: { mintGroup: 3n, newPrice: 1_000_000_000_000_000_000_000_001n },
    })
  })
})

describe('the quota call (docs/specs/2026-10-15-whitelist.md, section 7.1)', () => {
  const A: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
  const B: Address = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
  const CHUNK: ManageCall = phaseCalls.quotas(1, [A, B], [1_240, 0])

  it('encodes setMintQuota with the addresses first, as the hand-written signature does', () => {
    expect(encoded(CHUNK)).toBe(
      handEncoded(
        'setMintQuota(address[],uint256,uint256[])',
        [{ type: 'address[]' }, UINT, { type: 'uint256[]' }],
        [[A, B], 1n, [1_240n, 0n]],
      ),
    )
  })

  it('expects MintQuotasAdded for the group and the number of addresses', () => {
    expect(expectedEvent(CHUNK)).toEqual({
      eventName: 'MintQuotasAdded',
      args: { mintGroup: 1n, numberOfAddresses: 2n },
    })
  })

  it('round trips the arrays through decimal strings', () => {
    expect(sentOf(CHUNK)).toEqual({ functionName: 'setMintQuota', args: [[A, B], '1', ['1240', '0']] })
    expect(callOf(sentOf(CHUNK))).toEqual(CHUNK)
  })

  it('reviews a chunk as counts: its addresses, the group, its quotas and their total', () => {
    const addresses = Array.from({ length: 500 }, (_, index) =>
      getAddress(pad(toHex(index + 1), { size: 20 })),
    )
    const quotas = addresses.map((_, index) => (index < 240 ? 3 : 2))
    expect(reviewOf(phaseCalls.quotas(1, addresses, quotas), BASE)).toEqual([
      { name: 'addressesToAdd', value: '500 addresses' },
      { name: 'mintGroup', value: '1' },
      { name: 'mintQuotas', value: '500 quotas, 1,240 in total' },
    ])
    expect(reviewOf(phaseCalls.quotas(3, [A], [2]), BASE)).toEqual([
      { name: 'addressesToAdd', value: '1 address' },
      { name: 'mintGroup', value: '3' },
      { name: 'mintQuotas', value: '1 quota, 2 in total' },
    ])
  })
})
