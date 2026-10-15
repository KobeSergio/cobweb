import { validatorAbi } from '@cobweb/shared'
import { collectionAbi } from '@cobweb/shared/collection-abi'
import { encodeEventTopics, HttpRequestError, toEventSelector, type Address, type Hex } from 'viem'
import { describe, expect, it } from 'vitest'
import { marksOf, MAX_LOG_RANGE, scanLogs, watchedTopics, type GetLogs, type ScanTarget } from './logs.ts'

const A: Address = '0x0409454C375c8a6aB05383bFB6D9FcDe9ebB8F85'
const B: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const STRANGER: Address = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
const VALIDATOR: Address = '0x721C008fdff27BF06E7E123956E2Fe03B63342e3'
const OTHER_VALIDATOR: Address = '0x90F79bf6EB2c4f870365E785982E1f101E93b906'

/** A uses the validator; B has none read yet. */
const hot: ScanTarget[] = [
  { address: A, validator: VALIDATOR },
  { address: B, validator: null },
]

/** A collection's log of `eventName`, its topics as the node answers them. */
const collectionLog = (address: Address, topics: Hex[]) => ({ address, topics })
const statusTopics: Hex[] = encodeEventTopics({
  abi: collectionAbi,
  eventName: 'MintGroupStatusChanged',
  args: { mintGroup: 1n },
}) as Hex[]
const levelLog = (from: Address, collection: Address) => ({
  address: from,
  topics: encodeEventTopics({
    abi: validatorAbi,
    eventName: 'SetTransferSecurityLevel',
    args: { collection },
  }) as Hex[],
})

describe('watchedTopics (docs/specs/2026-10-16-freshness-server.md, section 6.5)', () => {
  it("is the 14 collection events and the validator's SetTransferSecurityLevel, as their signatures give them", () => {
    expect(watchedTopics()).toEqual(
      [
        'MintGroupStatusChanged(uint256,bool)',
        'AllMintGroupsStatusChanged(bool,uint256)',
        'MintGroupStartTimestampChanged(uint256,uint256)',
        'MintGroupRegistered(uint256)',
        'SalePriceChanged(uint256,uint256)',
        'MintGroupMaxSupplyUpdated(uint256,uint256)',
        'PublicMaxMintPerWalletChanged(uint256)',
        'MintOnBehalfUpdated(bool)',
        'FeesUpdated(uint256,uint256,uint256)',
        'BatchMetadataUpdate(uint256,uint256)',
        'OwnershipTransferred(address,address)',
        'DefaultRoyaltyUpdated(address,uint96)',
        'TokenRoyaltyUpdated(uint256,address,uint96)',
        'TransferValidatorUpdated(address,address)',
        'SetTransferSecurityLevel(address,uint8)',
      ].map((signature) => toEventSelector(signature)),
    )
  })
})

describe('marksOf', () => {
  it('marks a hot collection for a watched log of its own', () => {
    expect(marksOf([collectionLog(A, statusTopics)], hot)).toEqual(new Set([A.toLowerCase()]))
  })

  it("marks the collection a validator's level event names, only when that collection uses that validator", () => {
    expect(marksOf([levelLog(VALIDATOR, A)], hot)).toEqual(new Set([A.toLowerCase()]))
    expect(marksOf([levelLog(OTHER_VALIDATOR, A)], hot)).toEqual(new Set())
    expect(marksOf([levelLog(VALIDATOR, B)], hot)).toEqual(new Set())
  })

  it('marks nothing for a log of another address, another topic, or a collection not in the set', () => {
    const transfer = encodeEventTopics({
      abi: collectionAbi,
      eventName: 'Transfer',
      args: { from: B, to: A, tokenId: 1n },
    }) as Hex[]
    expect(
      marksOf(
        [
          collectionLog(STRANGER, statusTopics),
          collectionLog(A, transfer),
          levelLog(VALIDATOR, STRANGER),
          collectionLog(VALIDATOR, statusTopics),
          { address: A, topics: [] },
        ],
        hot,
      ),
    ).toEqual(new Set())
  })
})

describe('scanLogs', () => {
  /** A fake eth_getLogs that records its filters and answers `logs`, or fails. */
  function fakeGetLogs(logs: { address: Address; topics: Hex[] }[] | Error) {
    const filters: Parameters<GetLogs>[0][] = []
    const getLogs: GetLogs = async (filter) => {
      filters.push(filter)
      if (logs instanceof Error) throw logs
      return logs
    }
    return { getLogs, filters }
  }

  it('sends one eth_getLogs from the block after the last scanned to the head, over the hot collections and the validators with code', async () => {
    const { getLogs, filters } = fakeGetLogs([collectionLog(B, statusTopics)])
    const scan = await scanLogs(getLogs, 100n, 100n + MAX_LOG_RANGE, hot, [VALIDATOR])
    expect(scan).toEqual({ marks: new Set([B.toLowerCase()]), gap: false, failure: null })
    expect(filters).toEqual([
      { address: [A, B, VALIDATOR], topics: [watchedTopics()], fromBlock: 101n, toBlock: 600n },
    ])
  })

  it('sends nothing for a range over 500 blocks and marks every hot collection as a gap', async () => {
    const { getLogs, filters } = fakeGetLogs([])
    const scan = await scanLogs(getLogs, 100n, 101n + MAX_LOG_RANGE, hot, [VALIDATOR])
    expect(scan).toEqual({ marks: new Set([A.toLowerCase(), B.toLowerCase()]), gap: true, failure: null })
    expect(filters).toEqual([])
  })

  it('marks every hot collection as a gap when the scan fails, naming the failure (Review Focus 3)', async () => {
    const { getLogs } = fakeGetLogs(new RangeError('query exceeds max block range'))
    expect(await scanLogs(getLogs, 100n, 110n, hot, [])).toEqual({
      marks: new Set([A.toLowerCase(), B.toLowerCase()]),
      gap: true,
      failure: 'RangeError',
    })
  })

  it('names a viem failure by its name and short message, never by its message, which carries the URL', async () => {
    const { getLogs } = fakeGetLogs(
      new HttpRequestError({ url: 'https://rpc.example/v2/secret-key', status: 429 }),
    )
    expect(await scanLogs(getLogs, 100n, 110n, hot, [])).toEqual({
      marks: new Set([A.toLowerCase(), B.toLowerCase()]),
      gap: true,
      failure: 'HttpRequestError: HTTP request failed.',
    })
  })
})
