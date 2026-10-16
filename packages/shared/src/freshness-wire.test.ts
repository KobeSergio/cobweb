import type { Address } from 'viem'
import { describe, expect, it } from 'vitest'
import { statePath, walletPath } from './freshness-wire.ts'

const COLLECTION: Address = '0x0409454C375c8a6aB05383bFB6D9FcDe9ebB8F85'
const WALLET: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'

describe('the freshness paths (docs/specs/2026-10-16-mint-page-live-data.md, section 5)', () => {
  it('name the chain and the collection in lowercase', () => {
    expect(statePath(31337, COLLECTION)).toBe('/v1/state/31337/0x0409454c375c8a6ab05383bfb6d9fcde9ebb8f85')
  })

  it('name the wallet in lowercase too', () => {
    expect(walletPath(8453, COLLECTION, WALLET)).toBe(
      '/v1/wallet/8453/0x0409454c375c8a6ab05383bfb6d9fcde9ebb8f85/0x70997970c51812dc3a010c7d01b50e0d17dc79c8',
    )
  })
})
