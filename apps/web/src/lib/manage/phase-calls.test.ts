import { validatorAbi } from '@cobweb/shared'
import { collectionAbi } from '@cobweb/shared/collection-abi'
import {
  concat,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  pad,
  toFunctionSelector,
  toHex,
  zeroAddress,
  type Abi,
  type Address,
  type Hex,
} from 'viem'
import { describe, expect, it } from 'vitest'
import type { SupportedChain } from '@/lib/demo/types'
import { BURN_ADDRESS } from './airdrop-view'
import {
  abiOf,
  airdropCalls,
  callOf,
  expectedEvent,
  PHASE_FUNCTIONS,
  phaseCalls,
  reviewOf,
  sentOf,
  SETTINGS_FUNCTIONS,
  settingsCalls,
  type ManageCall,
} from './phase-calls'

const BASE: SupportedChain = {
  id: 8453,
  name: 'Base',
  nativeSymbol: 'ETH',
  explorerUrl: 'https://basescan.org',
  transferLock: true,
}
const UINT = { type: 'uint256' } as const
const BOOL = { type: 'bool' } as const
const ADDRESS = { type: 'address' } as const

/** The calldata a hand-written signature gives for the same values. */
function handEncoded(signature: string, types: readonly { type: string }[], values: readonly unknown[]): Hex {
  return concat([toFunctionSelector(signature), encodeAbiParameters(types, values)])
}

const encoded = (call: ManageCall) =>
  encodeFunctionData({ abi: abiOf(call) as Abi, functionName: call.functionName, args: call.args })

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

describe('the airdrop calls (docs/specs/2026-10-15-airdrop-settings.md, section 7.1)', () => {
  const A: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
  const B: Address = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
  const C: Address = '0x90F79bf6EB2c4f870365E785982E1f101E93b906'
  const FEE = '100000000000000'
  const BATCH: ManageCall = airdropCalls.batch(
    [
      { address: A, amount: 2 },
      { address: B, amount: 1 },
      { address: C, amount: 1 },
    ],
    FEE,
  )

  it("encodes airdropNFTs as the hand-written signature does, its value the fee times this batch's tokens", () => {
    expect(encoded(BATCH)).toBe(
      handEncoded(
        'airdropNFTs(address[],uint256[])',
        [{ type: 'address[]' }, { type: 'uint256[]' }],
        [
          [A, B, C],
          [2n, 1n, 1n],
        ],
      ),
    )
    expect(BATCH.value).toBe(400_000_000_000_000n)
    expect(abiOf(BATCH)).toBe(collectionAbi)
  })

  it('burns as one batch to the dead address, its value the fee for its tokens', () => {
    expect(airdropCalls.burn(2, FEE)).toEqual({
      functionName: 'airdropNFTs',
      args: [[BURN_ADDRESS], [2n]],
      value: 200_000_000_000_000n,
    })
  })

  it('expects NFTsAirdropped for the recipients and the tokens', () => {
    expect(expectedEvent(BATCH)).toEqual({
      eventName: 'NFTsAirdropped',
      args: { recipients: 3n, amount: 4n },
    })
  })

  it('round trips the value through a decimal string', () => {
    expect(sentOf(BATCH)).toEqual({
      functionName: 'airdropNFTs',
      args: [
        [A, B, C],
        ['2', '1', '1'],
      ],
      value: '400000000000000',
    })
    expect(callOf(sentOf(BATCH))).toEqual(BATCH)
  })

  it('reviews a batch as counts, then its value as the native amount and its wei', () => {
    expect(reviewOf(BATCH, BASE)).toEqual([
      { name: 'recipients', value: '3 addresses' },
      { name: 'amounts', value: '3 amounts, 4 tokens in total' },
      { name: 'Value', value: '0.0004 ETH (400000000000000 wei)' },
    ])
    expect(reviewOf(airdropCalls.burn(1, FEE), BASE)).toEqual([
      { name: 'recipients', value: '1 address' },
      { name: 'amounts', value: '1 amount, 1 token in total' },
      { name: 'Value', value: '0.0001 ETH (100000000000000 wei)' },
    ])
  })
})

describe('the Settings calls (docs/specs/2026-10-15-airdrop-settings.md, section 7.1)', () => {
  const A: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
  const COLLECTION: Address = '0x0409454C375c8a6aB05383bFB6D9FcDe9ebB8F85'
  const VALIDATOR: Address = '0x721C008fdff27BF06E7E123956E2Fe03B63342e3'
  const URI = `ipfs://bafybei${'e'.repeat(52)}/`
  const calls: ManageCall[] = [
    settingsCalls.withdraw(),
    settingsCalls.payout(A),
    settingsCalls.royalty(A, 750),
    settingsCalls.baseUri(URI),
    settingsCalls.mintOnBehalf(true),
    settingsCalls.validator(zeroAddress),
    settingsCalls.level(VALIDATOR, COLLECTION, 9),
  ]

  it('encodes each call as the hand-written signature does, the level call with the validator ABI', () => {
    expect(calls.map(encoded)).toEqual([
      toFunctionSelector('withdrawMintFunds()'),
      handEncoded('setOwnerPayoutAddress(address)', [ADDRESS], [A]),
      handEncoded('setDefaultRoyalty(address,uint96)', [ADDRESS, { type: 'uint96' }], [A, 750n]),
      handEncoded('setBaseURI(string)', [{ type: 'string' }], [URI]),
      handEncoded('setMintOnBehalfStatus(bool)', [BOOL], [true]),
      handEncoded('setTransferValidator(address)', [ADDRESS], [zeroAddress]),
      handEncoded(
        'setTransferSecurityLevelOfCollection(address,uint8,bool,bool,bool)',
        [ADDRESS, { type: 'uint8' }, BOOL, BOOL, BOOL],
        [COLLECTION, 9, false, false, false],
      ),
    ])
  })

  it('sends the level call to the validator with its ABI, and every other call to the collection', () => {
    const level = settingsCalls.level(VALIDATOR, COLLECTION, 0)
    expect(level.target).toEqual({ contract: 'validator', address: VALIDATOR })
    expect(abiOf(level)).toBe(validatorAbi)
    expect(calls.slice(0, 6).map((call) => [call.target, abiOf(call) === collectionAbi])).toEqual(
      Array(6).fill([undefined, true]),
    )
  })

  it('names the event each call leaves', () => {
    expect(calls.map(expectedEvent)).toEqual([
      { eventName: 'MintFundsWithdrawn', args: {} },
      { eventName: 'OwnerPayoutAddressUpdated', args: { newOwnerPayoutAddress: A } },
      { eventName: 'DefaultRoyaltyUpdated', args: { receiver: A, feeNumerator: 750n } },
      { eventName: 'BatchMetadataUpdate', args: { fromTokenId: 1n, toTokenId: 2n ** 256n - 1n } },
      { eventName: 'MintOnBehalfUpdated', args: { newStatus: true } },
      { eventName: 'TransferValidatorUpdated', args: { newValidator: zeroAddress } },
      { eventName: 'SetTransferSecurityLevel', args: { collection: COLLECTION, level: 9 } },
    ])
  })

  it('round trips each call, the level call with its target', () => {
    for (const call of calls) expect(callOf(sentOf(call))).toEqual(call)
    expect(sentOf(settingsCalls.level(VALIDATOR, COLLECTION, 9))).toEqual({
      functionName: 'setTransferSecurityLevelOfCollection',
      args: [COLLECTION, '9', false, false, false],
      target: { contract: 'validator', address: VALIDATOR },
    })
  })

  it("reviews each call with the ABI's names: a royalty in percent, a level with its title, no validator as removing the check", () => {
    expect(calls.map((call) => reviewOf(call, BASE))).toEqual([
      [],
      [{ name: 'newOwnerPayoutAddress', value: A }],
      [
        { name: 'receiver', value: A },
        { name: 'feeNumerator', value: '750 (7.5%)' },
      ],
      [{ name: 'newBaseURI', value: URI }],
      [{ name: 'status', value: 'true' }],
      [
        {
          name: 'transferValidator',
          value: '0x0000000000000000000000000000000000000000 (removes the check)',
        },
      ],
      [
        { name: 'collection', value: COLLECTION },
        { name: 'level', value: '9 (locked)' },
        { name: 'disableAuthorizationMode', value: 'false' },
        { name: 'disableWildcardOperators', value: 'false' },
        { name: 'enableAccountFreezingMode', value: 'false' },
      ],
    ])
    expect(reviewOf(settingsCalls.validator(VALIDATOR), BASE)).toEqual([
      { name: 'transferValidator', value: VALIDATOR },
    ])
    const levelRow = (level: number) =>
      reviewOf(
        {
          functionName: 'setTransferSecurityLevelOfCollection',
          args: [COLLECTION, level, false, false, false],
          target: { contract: 'validator', address: VALIDATOR },
        },
        BASE,
      )[1]
    expect([0, 1, 5].map(levelRow)).toEqual([
      { name: 'level', value: '0 (royalties enforced)' },
      { name: 'level', value: '1 (royalties not enforced)' },
      { name: 'level', value: '5' },
    ])
  })

  it('lists the functions each confirm accepts', () => {
    expect([...PHASE_FUNCTIONS]).toEqual([
      'registerMintGroup',
      'setMintGroupStatus',
      'scheduleMintGroupStart',
      'changeSalePrice',
      'setMintGroupMaxSupply',
      'setPublicMaxMintPerWallet',
      'stopOrStartAllMintGroups',
    ])
    expect([...SETTINGS_FUNCTIONS]).toEqual(calls.map((call) => call.functionName))
  })
})
