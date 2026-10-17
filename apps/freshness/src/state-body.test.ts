import type { StateActivity } from '@cobweb/shared'
import type { Address, Hex } from 'viem'
import { describe, expect, it } from 'vitest'
import type { CollectionRead } from './chain-reader.ts'
import type { HotEntry } from './hot-set.ts'
import { etagMatches, etagOf, stateBody, type StateBody } from './state-body.ts'

const A: Address = '0x0409454C375c8a6aB05383bFB6D9FcDe9ebB8F85'
const OWNER: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const VALIDATOR: Address = '0x721C008fdff27BF06E7E123956E2Fe03B63342e3'
const MINT_TX: Hex = `0x${'0b'.repeat(32)}`
/** Two holders and their one mint, as the indexer's memory answers them. */
const ACTIVITY: StateActivity = {
  holders: 2,
  recentMints: [
    {
      txHash: MINT_TX,
      recipient: OWNER,
      groupId: 1,
      amount: 1,
      firstTokenId: 1,
      blockTimestamp: 1_799_999_990,
    },
  ],
}

const read: CollectionRead = {
  state: {
    block: 120n,
    blockTimestamp: 1_800_000_000,
    maxSupply: 5,
    totalMinted: 1,
    publicMaxMintPerWallet: 2,
    mintOnBehalfActive: false,
    groups: [
      {
        id: 0,
        priceWei: '0',
        maxSupply: 3,
        minted: 0,
        startTimestamp: 1_800_000_600,
        flag: false,
        active: false,
      },
      { id: 1, priceWei: '1000', maxSupply: 2, minted: 1, startTimestamp: 0, flag: true, active: true },
    ],
  },
  fees: { mintFeeFlatWei: '10', mintFeeBps: 250, airdropFeePerTokenWei: '100000000000000' },
  extras: {
    owner: OWNER,
    royalty: { receiver: OWNER, bps: 500 },
    baseUri: 'ipfs://first/',
    transferValidator: VALIDATOR,
    transferLevel: { kind: 'none', reason: 'no-code' },
  },
}

const entry = (overrides: Partial<CollectionRead> = {}, readAt = 1_800_000_001_500): HotEntry => ({
  chainId: 31337,
  address: A,
  joinedAt: 0,
  requestedAt: 0,
  read: { ...read, ...overrides },
  readAt,
  extrasReadAt: readAt,
  marked: false,
})

describe('stateBody (docs/specs/2026-10-16-freshness-server.md, section 6.7)', () => {
  it('answers every field from a read, in order, readAt in Unix seconds, the activity last', () => {
    const body = stateBody(31337, entry(), false, ACTIVITY)
    expect(body).toEqual<StateBody>({
      chainId: 31337,
      address: A,
      block: 120,
      blockTimestamp: 1_800_000_000,
      readAt: 1_800_000_001,
      degraded: false,
      maxSupply: 5,
      totalMinted: 1,
      publicMaxMintPerWallet: 2,
      mintFeeFlatWei: '10',
      mintFeeBps: 250,
      airdropFeePerTokenWei: '100000000000000',
      mintOnBehalfActive: false,
      groups: read.state.groups,
      owner: OWNER,
      royalty: { receiver: OWNER, bps: 500 },
      baseUri: 'ipfs://first/',
      transferValidator: VALIDATOR,
      transferLevel: 'none',
      activity: ACTIVITY,
    })
    expect(Object.keys(body)).toEqual([
      'chainId',
      'address',
      'block',
      'blockTimestamp',
      'readAt',
      'degraded',
      'maxSupply',
      'totalMinted',
      'publicMaxMintPerWallet',
      'mintFeeFlatWei',
      'mintFeeBps',
      'airdropFeePerTokenWei',
      'mintOnBehalfActive',
      'groups',
      'owner',
      'royalty',
      'baseUri',
      'transferValidator',
      'transferLevel',
      'activity',
    ])
    expect(Object.keys(body.groups[0]!)).toEqual([
      'id',
      'priceWei',
      'maxSupply',
      'minted',
      'startTimestamp',
      'flag',
      'active',
    ])
  })

  it('answers the transfer level as none, unread or its number', () => {
    const level = (transferLevel: CollectionRead['extras']['transferLevel']) =>
      stateBody(31337, entry({ extras: { ...read.extras, transferLevel } }), false, null).transferLevel
    expect(level({ kind: 'none', reason: 'zero' })).toBe('none')
    expect(level({ kind: 'unread' })).toBe('unread')
    expect(level({ kind: 'level', level: 0 })).toBe(0)
    expect(level({ kind: 'level', level: 9 })).toBe(9)
  })
})

describe('etagOf', () => {
  const tag = (body: StateBody) => etagOf(body)
  const base = stateBody(31337, entry(), false, ACTIVITY)

  it('is weak, 32 hex digits, and equal for equal reads', () => {
    expect(tag(base)).toMatch(/^W\/"[0-9a-f]{32}"$/)
    expect(tag(stateBody(31337, entry(), false, ACTIVITY))).toBe(tag(base))
  })

  it('leaves out readAt, block and blockTimestamp, each in turn and together', () => {
    const untagged: Partial<StateBody>[] = [
      { readAt: base.readAt + 60 },
      { block: 999 },
      { blockTimestamp: 1_900_000_000 },
      { readAt: base.readAt + 60, block: 999, blockTimestamp: 1_900_000_000 },
    ]
    for (const changed of untagged) expect(tag({ ...base, ...changed })).toBe(tag(base))
  })

  it('changes with every other key, each in turn', () => {
    // Omit keeps every other key required, so a key added to the body without a change here fails to compile.
    const tagged: Omit<StateBody, 'readAt' | 'block' | 'blockTimestamp'> = {
      chainId: 1,
      address: OWNER,
      degraded: true,
      maxSupply: 6,
      totalMinted: 2,
      publicMaxMintPerWallet: 3,
      mintFeeFlatWei: '11',
      mintFeeBps: 251,
      airdropFeePerTokenWei: '1',
      mintOnBehalfActive: true,
      groups: base.groups.map((group) => (group.id === 0 ? { ...group, active: true } : group)),
      owner: A,
      royalty: { receiver: OWNER, bps: 501 },
      baseUri: 'ipfs://second/',
      transferValidator: OWNER,
      transferLevel: 'unread',
      activity: null,
    }
    const untagged: string[] = ['readAt', 'block', 'blockTimestamp']
    expect(Object.keys(tagged).sort()).toEqual(
      Object.keys(base)
        .filter((key) => !untagged.includes(key))
        .sort(),
    )
    for (const [key, value] of Object.entries(tagged))
      expect(tag({ ...base, [key]: value }), key).not.toBe(tag(base))
  })

  it('changes with the holders, a new mint and a flip to or from null, and not when only a cursor moved (docs/specs/2026-10-16-indexer-overview.md, section 6.6)', () => {
    const newer = { ...ACTIVITY.recentMints[0]!, txHash: `0x${'0c'.repeat(32)}` as Hex, firstTokenId: 2 }
    const changed: (StateActivity | null)[] = [
      { ...ACTIVITY, holders: 3 },
      { ...ACTIVITY, recentMints: [newer, ...ACTIVITY.recentMints] },
      null,
    ]
    for (const activity of changed) expect(tag({ ...base, activity })).not.toBe(tag(base))
    expect(tag({ ...base, activity: null })).not.toBe(
      tag({ ...base, activity: { holders: 0, recentMints: [] } }),
    )
    // A pass that only moved the cursors: a later block with the same activity.
    const later = {
      ...base,
      block: base.block + 5,
      blockTimestamp: base.blockTimestamp + 5,
      readAt: base.readAt + 5,
    }
    expect(tag({ ...later, activity: structuredClone(ACTIVITY) })).toBe(tag(base))
  })
})

describe('etagMatches', () => {
  const etag = 'W/"0123456789abcdef0123456789abcdef"'

  it('matches the tag in weak and strong form, inside a list, and as *', () => {
    expect(etagMatches(etag, etag)).toBe(true)
    expect(etagMatches('"0123456789abcdef0123456789abcdef"', etag)).toBe(true)
    expect(etagMatches(`"other", ${etag}`, etag)).toBe(true)
    expect(etagMatches('*', etag)).toBe(true)
  })

  it('matches nothing else', () => {
    expect(etagMatches(undefined, etag)).toBe(false)
    expect(etagMatches('', etag)).toBe(false)
    expect(etagMatches('W/"0123456789abcdef0123456789abcdee"', etag)).toBe(false)
    expect(etagMatches('0123456789abcdef0123456789abcdef', etag)).toBe(false)
    expect(etagMatches('"other", W/"another"', etag)).toBe(false)
  })
})
