import type { Config } from 'wagmi'
import { getPublicClient, simulateContract, writeContract } from 'wagmi/actions'
import type { MintCall } from './mint-call'
import type { MintChain } from './mint-run'

/**
 * The live chain for the page's mints (docs/specs/2026-10-16-mint-page-live-data.md, section 7.5): wagmi
 * simulates the call through the chain's public transport and sends the simulated request through the connected
 * wallet; the receipt is read through the same transport for up to three minutes, as the manage actions read
 * theirs. Both concern the visitor's own transaction, not shared state (CLAUDE.md rule 3).
 */
export function wagmiMintChain(config: Config): MintChain {
  return {
    simulate: async (call: MintCall) => {
      const simulated = await simulateContract(config, { ...call })
      // CLAUDE.md rule 2: the wallet gets exactly the request the simulation passed.
      return () => writeContract(config, simulated.request)
    },
    receipt: async (hash, chainId) => {
      const client = getPublicClient(config, { chainId })
      if (!client) throw new Error('No RPC for this chain')
      return client.waitForTransactionReceipt({ hash, timeout: 180_000 })
    },
  }
}
