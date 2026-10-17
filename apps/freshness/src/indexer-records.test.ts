import { collectionAbi } from '@cobweb/shared/collection-abi'
import {
  encodeAbiParameters,
  encodeEventTopics,
  parseAbiParameters,
  parseEventLogs,
  zeroAddress,
  type Address,
  type Hex,
  type Log,
} from 'viem'
import { describe, expect, it } from 'vitest'
import { DEAD_ADDRESS, eventBlocksOf, INDEX_EVENTS, recordsOf, type IndexLog } from './indexer-records.ts'

const COLLECTION: Address = '0x0409454C375c8a6aB05383bFB6D9FcDe9ebB8F85'
const SECOND: Address = '0x5FbDB2315678afecb367f032d93F642f64180aa3'
const OTHER: Address = '0x721C008fdff27BF06E7E123956E2Fe03B63342e3'
const ID = '0a977c0b-7e53-476b-8c08-6c685315c3af'
const SECOND_ID = '7d2c9e10-5b44-4a6f-9c3e-2f1b8a7d6e5c'
const A: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const B: Address = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
const C: Address = '0x90F79bf6EB2c4f870365E785982E1f101E93b906'
const VAULT: Address = '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65'
const DEAD: Address = '0x000000000000000000000000000000000000dEaD'
const BLOCK_HASH: Hex = `0x${'b1'.repeat(32)}`
const COLLECTIONS: ReadonlyMap<string, string> = new Map([
  [COLLECTION.toLowerCase(), ID],
  [SECOND.toLowerCase(), SECOND_ID],
])
/** Each test block's time: 1,800,000,000 plus the block. */
const TIMES: ReadonlyMap<bigint, number> = new Map(
  [100n, 101n, 102n, 103n].map((block) => [block, 1_800_000_000 + Number(block)]),
)

const TX = (n: number): Hex => `0x${n.toString(16).padStart(64, '0')}`
const lower = (address: Address) => address.toLowerCase()

/**
 * An event as the contract emits it: its topics and data, from the collection unless another address is
 * given.
 */
type Emitted = { address: Address; topics: Hex[]; data: Hex }
const transfer = (from: Address, to: Address, tokenId: bigint, address: Address = COLLECTION): Emitted => ({
  address,
  topics: encodeEventTopics({
    abi: INDEX_EVENTS,
    eventName: 'Transfer',
    args: { from, to, tokenId },
  }) as Hex[],
  data: '0x',
})
const minted = (
  recipient: Address,
  amount: bigint,
  mintGroup: bigint,
  address: Address = COLLECTION,
): Emitted => ({
  address,
  topics: encodeEventTopics({ abi: INDEX_EVENTS, eventName: 'TokensMinted', args: { recipient } }) as Hex[],
  data: encodeAbiParameters(parseAbiParameters('uint256, uint256'), [amount, mintGroup]),
})
const delegateMinted = (vault: Address, recipient: Address, amount: bigint, mintGroup: bigint): Emitted => ({
  address: COLLECTION,
  topics: encodeEventTopics({
    abi: INDEX_EVENTS,
    eventName: 'TokensDelegateMinted',
    args: { vault, recipient },
  }) as Hex[],
  data: encodeAbiParameters(parseAbiParameters('uint256, uint256'), [amount, mintGroup]),
})
const airdropped = (recipients: bigint, amount: bigint, feePaid: bigint): Emitted => ({
  address: COLLECTION,
  topics: encodeEventTopics({ abi: INDEX_EVENTS, eventName: 'NFTsAirdropped' }) as Hex[],
  data: encodeAbiParameters(parseAbiParameters('uint256, uint256, uint256'), [recipients, amount, feePaid]),
})
const withdrawn = (payoutAddress: Address, amount: bigint): Emitted => ({
  address: COLLECTION,
  topics: encodeEventTopics({
    abi: INDEX_EVENTS,
    eventName: 'MintFundsWithdrawn',
    args: { payoutAddress },
  }) as Hex[],
  data: encodeAbiParameters(parseAbiParameters('uint256'), [amount]),
})
/** Transfers from the zero address to one wallet, one per id. */
const mintedTo = (to: Address, ...ids: bigint[]) => ids.map((id) => transfer(zeroAddress, to, id))

/**
 * Transactions as a node answers their logs (each one's at its block, log indexes counted per block), decoded
 * as `getLogs` decodes them for `INDEX_EVENTS` with `strict: true`.
 */
function logsOf(...transactions: [block: bigint, tx: number, events: Emitted[]][]): IndexLog[] {
  const indexes = new Map<bigint, number>()
  const logs: Log[] = transactions.flatMap(([block, tx, events]) =>
    events.map((event): Log => {
      const logIndex = indexes.get(block) ?? 0
      indexes.set(block, logIndex + 1)
      return {
        address: event.address,
        topics: event.topics as [Hex, ...Hex[]],
        data: event.data,
        blockNumber: block,
        blockHash: BLOCK_HASH,
        logIndex,
        transactionHash: TX(tx),
        transactionIndex: 0,
        removed: false,
      }
    }),
  )
  return parseEventLogs({ abi: INDEX_EVENTS, logs, strict: true }) as unknown as IndexLog[]
}

const recordsFor = (logs: IndexLog[]) => recordsOf(logs, COLLECTIONS, TIMES)

describe('INDEX_EVENTS (docs/specs/2026-10-16-indexer-overview.md, section 6.4)', () => {
  it("are the collection ABI's five events the indexer reads", () => {
    expect(INDEX_EVENTS.map((event) => event.name)).toEqual([
      'Transfer',
      'TokensMinted',
      'TokensDelegateMinted',
      'NFTsAirdropped',
      'MintFundsWithdrawn',
    ])
    for (const event of INDEX_EVENTS)
      expect(event).toEqual(collectionAbi.find((item) => item.type === 'event' && item.name === event.name))
  })
})

describe('eventBlocksOf', () => {
  it('names each block with a mint or an airdrop event once, ascending, and no block of transfers or withdrawals alone', () => {
    const logs = logsOf(
      [102n, 3, [...mintedTo(A, 3n), minted(A, 1n, 0n)]],
      [100n, 1, [...mintedTo(B, 1n), airdropped(1n, 1n, 0n)]],
      [101n, 2, [transfer(B, C, 1n), withdrawn(A, 5n)]],
      [102n, 4, [...mintedTo(A, 4n), minted(A, 1n, 0n)]],
    )
    expect(eventBlocksOf(logs)).toEqual([100n, 102n])
  })

  it('names no block for no log', () => {
    expect(eventBlocksOf([])).toEqual([])
  })
})

describe('recordsOf (docs/specs/2026-10-16-indexer-overview.md, section 6.4)', () => {
  it('records a mint of 3 as one mint with its first id, its group and its block time, and the three owners', () => {
    const { records, unpaired } = recordsFor(
      logsOf([100n, 1, [...mintedTo(A, 5n, 6n, 7n), minted(A, 3n, 0n)]]),
    )
    expect(records.mints).toEqual([
      {
        collectionId: ID,
        tx: TX(1),
        logIndex: 3,
        block: 100,
        blockTime: 1_800_000_100,
        recipient: lower(A),
        vault: null,
        groupId: 0,
        amount: 3,
        firstTokenId: 5,
      },
    ])
    expect(records.owners).toEqual(
      [5, 6, 7].map((tokenId, logIndex) => ({
        collectionId: ID,
        tokenId,
        owner: lower(A),
        block: 100,
        logIndex,
      })),
    )
    expect([records.airdrops, records.withdrawals, unpaired]).toEqual([[], [], []])
  })

  it('keeps the vault and the hot wallet as recipient for a delegated mint', () => {
    const { records } = recordsFor(
      logsOf([100n, 1, [...mintedTo(A, 8n, 9n), delegateMinted(VAULT, A, 2n, 1n)]]),
    )
    expect(records.mints).toMatchObject([
      { recipient: lower(A), vault: lower(VAULT), groupId: 1, amount: 2, firstTokenId: 8 },
    ])
  })

  it('names the receiver of a mint on behalf, whose tokens it holds, not the caller who paid', () => {
    // mintOnBehalf mints to the receiver and emits TokensMinted for it; the caller appears in no log.
    const { records } = recordsFor(logsOf([100n, 1, [...mintedTo(B, 10n), minted(B, 1n, 0n)]]))
    expect(records.mints).toMatchObject([{ recipient: lower(B), vault: null, firstTokenId: 10 }])
  })

  it('pairs two mints in one transaction in order, each with the transfers before it', () => {
    const { records, unpaired } = recordsFor(
      logsOf([100n, 1, [...mintedTo(A, 1n), minted(A, 1n, 0n), ...mintedTo(B, 2n, 3n), minted(B, 2n, 1n)]]),
    )
    expect(
      records.mints.map((mint) => [mint.recipient, mint.amount, mint.firstTokenId, mint.groupId]),
    ).toEqual([
      [lower(A), 1, 1, 0],
      [lower(B), 2, 2, 1],
    ])
    expect(unpaired).toEqual([])
  })

  it('does not record a mint with fewer transfers than its amount, or with one to another address, and names it unpaired', () => {
    const { records, unpaired } = recordsFor(
      logsOf(
        [100n, 1, [...mintedTo(A, 1n), minted(A, 2n, 0n)]],
        [101n, 2, [transfer(zeroAddress, A, 2n), transfer(zeroAddress, B, 3n), minted(A, 2n, 0n)]],
      ),
    )
    expect(records.mints).toEqual([])
    expect(unpaired).toEqual([TX(1), TX(2)])
    // Their transfers still move owners.
    expect(records.owners.map((owner) => [owner.tokenId, owner.owner])).toEqual([
      [1, lower(A)],
      [2, lower(A)],
      [3, lower(B)],
    ])
  })

  it('pairs a mint made from inside another collection mint with its own transfers (Review Focus 5)', () => {
    // A receiver contract mints the second collection from its onERC721Received hook, between the first
    // collection's transfer and its TokensMinted: each collection keeps its own pending transfers.
    const { records, unpaired } = recordsFor(
      logsOf([
        100n,
        1,
        [
          transfer(zeroAddress, A, 1n),
          transfer(zeroAddress, A, 1n, SECOND),
          minted(A, 1n, 0n, SECOND),
          minted(A, 1n, 0n),
        ],
      ]),
    )
    expect(records.mints.map((mint) => [mint.collectionId, mint.amount, mint.firstTokenId])).toEqual([
      [SECOND_ID, 1, 1],
      [ID, 1, 1],
    ])
    expect(unpaired).toEqual([])
  })

  it('records an airdrop of A 2, B 1 and A 1 as three runs in order, with its counts and fee', () => {
    // The call names three recipients, A twice, and the event counts them as the call does.
    const { records } = recordsFor(
      logsOf([
        101n,
        2,
        [
          ...mintedTo(A, 11n, 12n),
          transfer(zeroAddress, B, 13n),
          transfer(zeroAddress, A, 14n),
          airdropped(3n, 4n, 400_000_000_000_000n),
        ],
      ]),
    )
    expect(records.airdrops).toEqual([
      {
        collectionId: ID,
        tx: TX(2),
        block: 101,
        blockTime: 1_800_000_101,
        kind: 'airdrop',
        recipients: 3,
        tokens: 4,
        feePaidWei: '400000000000000',
        firstTokenId: 11,
        lastTokenId: 14,
        runs: [
          { recipient: lower(A), tokens: 2, firstTokenId: 11 },
          { recipient: lower(B), tokens: 1, firstTokenId: 13 },
          { recipient: lower(A), tokens: 1, firstTokenId: 14 },
        ],
      },
    ])
  })

  it('records the dead address alone with 2 tokens as a burn, and nothing for an airdrop of 0 tokens', () => {
    const { records, unpaired } = recordsFor(
      logsOf(
        [101n, 2, [...mintedTo(DEAD, 15n, 16n), airdropped(1n, 2n, 200n)]],
        [102n, 3, [airdropped(1n, 0n, 0n)]],
      ),
    )
    expect(records.airdrops).toMatchObject([
      {
        kind: 'burn',
        recipients: 1,
        tokens: 2,
        firstTokenId: 15,
        lastTokenId: 16,
        runs: [{ recipient: DEAD_ADDRESS, tokens: 2, firstTokenId: 15 }],
      },
    ])
    expect(unpaired).toEqual([])
  })

  it('does not record an airdrop whose count does not match its transfers, and names it unpaired', () => {
    const { records, unpaired } = recordsFor(logsOf([101n, 2, [...mintedTo(A, 1n), airdropped(1n, 2n, 0n)]]))
    expect(records.airdrops).toEqual([])
    expect(unpaired).toEqual([TX(2)])
  })

  it('names an airdrop of 0 tokens after transfers from the zero address unpaired once, and records nothing for it', () => {
    const { records, unpaired } = recordsFor(
      logsOf([101n, 2, [...mintedTo(A, 1n, 2n), airdropped(1n, 0n, 0n)]]),
    )
    expect(records.airdrops).toEqual([])
    // The event takes the transfers, so the end of the transaction names nothing more; they still move owners.
    expect(unpaired).toEqual([TX(2)])
    expect(records.owners.map((owner) => [owner.tokenId, owner.owner])).toEqual([
      [1, lower(A)],
      [2, lower(A)],
    ])
  })

  it('does not record a delegated mint with fewer transfers than its amount, and names it unpaired', () => {
    const { records, unpaired } = recordsFor(
      logsOf([100n, 1, [...mintedTo(A, 8n), delegateMinted(VAULT, A, 2n, 1n)]]),
    )
    expect(records.mints).toEqual([])
    expect(unpaired).toEqual([TX(1)])
    expect(records.owners).toMatchObject([{ tokenId: 8, owner: lower(A) }])
  })

  it('throws when the time of a block with a mint or an airdrop was not read', () => {
    expect(() => recordsFor(logsOf([104n, 5, [...mintedTo(A, 1n), minted(A, 1n, 0n)]]))).toThrow(
      'The time of block 104 was not read.',
    )
    // A block of transfers and withdrawals alone needs no time.
    const { records } = recordsFor(logsOf([104n, 5, [transfer(A, B, 1n), withdrawn(A, 5n)]]))
    expect([records.owners.length, records.withdrawals.length]).toEqual([1, 1])
  })

  it('answers nothing for no log', () => {
    expect(recordsOf([], COLLECTIONS, TIMES)).toEqual({
      records: { mints: [], owners: [], airdrops: [], withdrawals: [] },
      unpaired: [],
    })
    expect(recordsOf([], new Map(), new Map())).toEqual({
      records: { mints: [], owners: [], airdrops: [], withdrawals: [] },
      unpaired: [],
    })
  })

  it("keeps a withdrawal's amount and payout address", () => {
    const { records } = recordsFor(logsOf([103n, 4, [withdrawn(B, 2_000_000_000_000_000n)]]))
    expect(records.withdrawals).toEqual([
      { collectionId: ID, tx: TX(4), block: 103, payoutAddress: lower(B), amountWei: '2000000000000000' },
    ])
  })

  it('moves owners on transfers between holders and keeps only the latest per token, whatever order the logs come in', () => {
    const logs = logsOf(
      [100n, 1, [...mintedTo(A, 1n), minted(A, 1n, 0n)]],
      [101n, 2, [transfer(A, B, 1n)]],
      [102n, 3, [transfer(B, C, 1n)]],
    )
    const { records, unpaired } = recordsFor([...logs].reverse())
    expect(records.owners).toEqual([
      { collectionId: ID, tokenId: 1, owner: lower(C), block: 102, logIndex: 0 },
    ])
    expect(records.mints).toHaveLength(1)
    expect(unpaired).toEqual([])
  })

  it('does not record a mint whose group id is above 2^53 - 1, while its transfers move owners', () => {
    const { records, unpaired } = recordsFor(
      logsOf([100n, 1, [...mintedTo(A, 1n), minted(A, 1n, 2n ** 53n)]]),
    )
    expect(records.mints).toEqual([])
    expect(records.owners).toMatchObject([{ tokenId: 1, owner: lower(A) }])
    expect(unpaired).toEqual([TX(1)])
  })

  it('names transfers from the zero address left at the end of a transaction as one unpaired mint', () => {
    const { records, unpaired } = recordsFor(
      logsOf([100n, 1, mintedTo(A, 1n, 2n)], [101n, 2, mintedTo(B, 3n)]),
    )
    expect(records.mints).toEqual([])
    expect(unpaired).toEqual([TX(1), TX(2)])
  })

  it('ignores a log of another address', () => {
    const { records, unpaired } = recordsFor(
      logsOf([100n, 1, [transfer(zeroAddress, A, 1n, OTHER), minted(A, 1n, 0n, OTHER)]]),
    )
    expect(records).toEqual({ mints: [], owners: [], airdrops: [], withdrawals: [] })
    expect(unpaired).toEqual([])
  })
})
