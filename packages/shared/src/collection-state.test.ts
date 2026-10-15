import { describe, expect, it } from 'vitest'
import { chainStateOf, type ChainState, type CollectionStateResult } from './collection-state.ts'

/** A `collectionState()` answer as viem decodes it: Public scheduled, Holders open with one minted. */
const answer: CollectionStateResult = {
  maxSupply: 5n,
  totalMinted: 1n,
  publicMaxMintPerWallet: 2n,
  mintFeeFlat: 10_000_000_000_000n,
  mintFeeBps: 250n,
  airdropFeePerToken: 100_000_000_000_000n,
  mintOnBehalfActive: true,
  blockTimestamp: 1_791_039_600n,
  groups: [
    {
      id: 0n,
      price: 0n,
      maxSupply: 3n,
      minted: 0n,
      startTimestamp: 1_791_040_200n,
      activeFlag: false,
      active: false,
    },
    {
      id: 1n,
      price: 1_000_000_000_000_000n,
      maxSupply: 2n,
      minted: 1n,
      startTimestamp: 0n,
      activeFlag: true,
      active: true,
    },
  ],
}

describe('chainStateOf (docs/specs/2026-10-16-freshness-server.md, section 5.1)', () => {
  it('maps a collectionState() answer at its block: counts as numbers, prices as decimal strings', () => {
    expect(chainStateOf(answer, 120n)).toEqual<ChainState>({
      block: 120n,
      blockTimestamp: 1_791_039_600,
      maxSupply: 5,
      totalMinted: 1,
      publicMaxMintPerWallet: 2,
      mintOnBehalfActive: true,
      groups: [
        {
          id: 0,
          priceWei: '0',
          maxSupply: 3,
          minted: 0,
          startTimestamp: 1_791_040_200,
          flag: false,
          active: false,
        },
        {
          id: 1,
          priceWei: '1000000000000000',
          maxSupply: 2,
          minted: 1,
          startTimestamp: 0,
          flag: true,
          active: true,
        },
      ],
    })
  })

  it("keeps the contract's group order and a price above 2^53 whole", () => {
    const price = 123_456_789_012_345_678_901n
    const state = chainStateOf(
      { ...answer, groups: [...answer.groups].reverse().map((group) => ({ ...group, price })) },
      7n,
    )
    expect(state.groups.map((group) => [group.id, group.priceWei])).toEqual([
      [1, '123456789012345678901'],
      [0, '123456789012345678901'],
    ])
  })
})
