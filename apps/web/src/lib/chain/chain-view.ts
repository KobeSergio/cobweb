import { chainById } from '@cobweb/shared'
import type { SupportedChain } from '@/lib/demo/types'

/** A chain as the screens show it (name, symbol, explorer), from the shared chain list. Any id renders. */
export function chainView(chainId: number): SupportedChain {
  const chain = chainById(chainId)
  if (!chain)
    return {
      id: chainId,
      name: chainId === 0 ? 'No network yet' : `Chain ${chainId}`,
      nativeSymbol: 'ETH',
      explorerUrl: '',
      transferLock: false,
    }
  return {
    id: chain.id,
    name: chain.name,
    nativeSymbol: chain.nativeSymbol,
    explorerUrl: chain.explorerUrl,
    transferLock: !chain.testnet,
  }
}
