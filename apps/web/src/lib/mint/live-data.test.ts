import type { MintBody, StateBody, WalletBody } from '@cobweb/shared'
import type { Address, Hex } from 'viem'
import { describe, expect, it } from 'vitest'
import { activityOfBody, liveOf, revealedOf, transfersOf, walletViewOf } from './live-data'
import type { MintPageStatic } from './page-doc'

const COLLECTION: Address = '0x0409454C375c8a6aB05383bFB6D9FcDe9ebB8F85'
const OWNER: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const VAULT: Address = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
const PLACEHOLDER = 'ipfs://bafybeiplaceholder/metadata.json'
const REAL = 'ipfs://bafybeireal/'

const page: MintPageStatic = {
  slug: 'night-owls',
  name: 'Night Owls',
  symbol: 'OWLS',
  projectType: 'generative',
  chain: { id: 31337, name: 'Anvil', nativeSymbol: 'ETH', explorerUrl: '', transferLock: false },
  contract: COLLECTION,
  description: '',
  bannerUrl: null,
  avatarUrl: null,
  aboutBannerUrl: null,
  socials: {},
  featuredTokenIds: [],
  sections: {},
  phases: [
    { onchain_id: 1, name: 'Holders', description: 'For holders.', visible: true, position: 0 },
    { onchain_id: 0, name: 'Public', description: '', visible: true, position: 1 },
    { onchain_id: 2, name: 'Team', description: '', visible: false, position: 2 },
  ],
  placeholders: [PLACEHOLDER],
  gateway: 'https://ipfs.io/ipfs',
}

const group = (id: number, active = false) => ({
  id,
  priceWei: '1000',
  maxSupply: 2,
  minted: 0,
  startTimestamp: 0,
  flag: active,
  active,
})
const body: StateBody = {
  chainId: 31337,
  address: COLLECTION,
  block: 50,
  blockTimestamp: 1_000,
  readAt: 1_002,
  degraded: false,
  maxSupply: 5,
  totalMinted: 1,
  publicMaxMintPerWallet: 2,
  mintFeeFlatWei: '7',
  mintFeeBps: 250,
  airdropFeePerTokenWei: '3',
  mintOnBehalfActive: true,
  groups: [group(0, true), group(1), group(2), group(3)],
  owner: OWNER,
  royalty: { receiver: VAULT, bps: 500 },
  baseUri: REAL,
  transferValidator: '0x721C008fdff27BF06E7E123956E2Fe03B63342e3',
  transferLevel: 0,
  activity: null,
}

describe('liveOf (docs/specs/2026-10-16-mint-page-live-data.md, section 7.4)', () => {
  it('joins the groups by position, puts "Group N" after them and keeps the hidden ones for the model to drop', () => {
    const live = liveOf(page, body)
    expect(live.groups.map((entry) => [entry.id, entry.name, entry.visible])).toEqual([
      [1, 'Holders', true],
      [0, 'Public', true],
      [2, 'Team', false],
      [3, 'Group 3', true],
    ])
    expect(live.groups[0]?.description).toBe('For holders.')
  })

  it('takes the fees as wei strings, the owner as the creator and the royalty in basis points', () => {
    const live = liveOf(page, body)
    expect(live.fees).toEqual({ mintFeeFlatWei: '7', mintFeeBps: 250, airdropFeePerTokenWei: '3' })
    expect([live.creator, live.royaltyBps, live.block, live.readAt]).toEqual([OWNER, 500, 50, 1_002])
    expect(live.supply).toEqual({ max: 5, minted: 1 })
  })

  it('reads the royalty sentence only at level 0', () => {
    expect(liveOf(page, body).royaltyEnforced).toBe(true)
    for (const level of [1, 9, 'none', 'unread'] as const)
      expect(liveOf(page, { ...body, transferLevel: level }).royaltyEnforced).toBe(false)
  })
})

describe('activityOfBody (docs/specs/2026-10-16-indexer-overview.md, section 7.5)', () => {
  const mint = (groupId: number, firstTokenId: number): MintBody => ({
    txHash: `0x${firstTokenId.toString(16).padStart(64, '0')}` as Hex,
    recipient: OWNER,
    groupId,
    amount: 1,
    firstTokenId,
    blockTimestamp: 990,
  })

  it("names each mint's phase as the phase list does, Group N for a group registered outside Cobweb, none for a hidden one", () => {
    const live = liveOf(page, {
      ...body,
      activity: { holders: 4, recentMints: [mint(1, 4), mint(0, 3), mint(2, 2), mint(3, 1)] },
    })
    expect(live.activity?.holders).toBe(4)
    expect(live.activity?.recentMints.map((entry) => [entry.firstTokenId, entry.phase])).toEqual([
      [4, 'Holders'],
      [3, 'Public'],
      [2, null],
      [1, 'Group 3'],
    ])
  })

  it('carries no activity without one, at most 10 mints, and names a group the page does not list by its id', () => {
    expect(liveOf(page, body).activity).toBeNull()
    const many = Array.from({ length: 12 }, (_, index) => mint(0, index + 1))
    expect(activityOfBody({ holders: 1, recentMints: many }, [])?.recentMints).toHaveLength(10)
    expect(activityOfBody({ holders: 1, recentMints: [mint(7, 1)] }, [])?.recentMints[0]?.phase).toBe(
      'Group 7',
    )
  })
})

describe('revealedOf and transfersOf', () => {
  it('reads revealed for the real base and a custom link, not for an empty base or a placeholder', () => {
    expect(revealedOf('', [PLACEHOLDER])).toBe(false)
    expect(revealedOf(PLACEHOLDER, [PLACEHOLDER])).toBe(false)
    expect(revealedOf(REAL, [PLACEHOLDER])).toBe(true)
    expect(revealedOf('https://example.com/owls/', [PLACEHOLDER])).toBe(true)
  })

  it('reads levels 0 and 1 open, 9 locked, 2 to 8 restricted, and none or unread as nothing to show', () => {
    expect([transfersOf(0), transfersOf(1), transfersOf(9)]).toEqual(['open', 'open', 'locked'])
    for (let level = 2; level <= 8; level++) expect(transfersOf(level)).toBe('restricted')
    expect([transfersOf('none'), transfersOf('unread')]).toEqual([null, null])
  })
})

describe('walletViewOf', () => {
  const answer: WalletBody = {
    chainId: 31337,
    address: COLLECTION,
    wallet: OWNER,
    block: 52,
    publicMinted: 1,
    groups: [
      { id: 0, quota: 0, claimed: 0 },
      { id: 1, quota: 2, claimed: 1 },
      { id: 2, quota: 0, claimed: 0 },
    ],
    vaults: [
      {
        vault: VAULT,
        publicMinted: 0,
        groups: [
          { id: 0, quota: 0, claimed: 0 },
          { id: 1, quota: 3, claimed: 0 },
          { id: 2, quota: 0, claimed: 0 },
        ],
      },
      {
        vault: COLLECTION,
        publicMinted: 2,
        groups: [
          { id: 0, quota: 0, claimed: 0 },
          { id: 1, quota: 0, claimed: 0 },
        ],
      },
    ],
  }

  it('turns quotas into eligibility: the public group always, a whitelist group with a quota above 0', () => {
    const view = walletViewOf(answer)
    expect(view.groups).toEqual([
      { groupId: 0, quota: 0, used: 0, eligible: true },
      { groupId: 1, quota: 2, used: 1, eligible: true },
      { groupId: 2, quota: 0, used: 0, eligible: false },
    ])
    expect([view.address, view.publicMinted, view.block]).toEqual([OWNER, 1, 52])
  })

  it("keeps a vault's whitelist groups with quota, and leaves off a vault with none", () => {
    expect(walletViewOf(answer).delegatedVaults).toEqual([
      { vault: VAULT, groups: [{ groupId: 1, quota: 3, used: 0 }] },
    ])
  })
})
