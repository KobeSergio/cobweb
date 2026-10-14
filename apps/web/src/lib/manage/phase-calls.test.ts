import { collectionAbi } from '@cobweb/shared/collection-abi'
import { concat, encodeAbiParameters, encodeFunctionData, toFunctionSelector, type Hex } from 'viem'
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
