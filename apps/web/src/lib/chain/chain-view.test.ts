import { describe, expect, it } from 'vitest'
import { chainView } from './chain-view'

describe('chainView', () => {
  it('shows a launch chain with its symbol and explorer', () => {
    expect(chainView(8453)).toEqual({
      id: 8453,
      name: 'Base',
      nativeSymbol: 'ETH',
      explorerUrl: 'https://basescan.org',
      transferLock: true,
    })
  })

  it('shows Anvil outside production, with no explorer', () => {
    expect(chainView(31337)).toMatchObject({ name: 'Anvil', explorerUrl: '' })
  })

  it('still renders a chain it does not know, and no chain yet', () => {
    expect(chainView(10)).toMatchObject({ id: 10, name: 'Chain 10', explorerUrl: '' })
    expect(chainView(0).name).toBe('No network yet')
  })
})
