import { fetchHolders } from '@/app/actions/snapshot'
import { chainView } from '@/lib/chain/chain-view'
import { sampleFetchHolders } from './snapshot'
import type { SnapshotSource } from './snapshot-tab'

/**
 * The holder snapshot the shared recipients input offers on Whitelist and Airdrop
 * (docs/specs/2026-10-15-whitelist.md, section 7.2): the chains the server can read, the preferred one first
 * selected when offered (else the first), and the `fetchHolders` action bound to the collection, or the sample's
 * snapshot in sample mode. Without a chain to read there is no Snapshot tab.
 */
export function snapshotSource(input: {
  collectionId: string
  sample: boolean
  chainIds: number[]
  preferred: number
}): SnapshotSource | undefined {
  const [first] = input.chainIds
  if (first === undefined) return undefined
  return {
    chains: input.chainIds.map(chainView),
    chainId: input.chainIds.includes(input.preferred) ? input.preferred : first,
    fetch: input.sample
      ? sampleFetchHolders
      : (chainId, contract) => fetchHolders(input.collectionId, chainId, contract),
  }
}
