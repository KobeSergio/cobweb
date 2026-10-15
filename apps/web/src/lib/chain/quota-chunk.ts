import { collectionAbi } from '@cobweb/shared/collection-abi'
import { decodeFunctionData, type Address, type Hex } from 'viem'
import { NOT_FROM_WALLET, NOT_THIS_CHANGE, NOT_THIS_CONTRACT } from '@/lib/art/result'
import { QUOTA_MAX } from '@/lib/manage/whitelist-view'
import { matchPhaseEvent, type PhaseReceipt } from './phase-events'

/** The pairs a proven chunk wrote, addresses lowercase, or why the transaction is not that chunk. */
export type ChunkProof =
  { ok: true; pairs: { address: string; quota: number }[] } | { ok: false; error: string }

/** The arguments of a `setMintQuota` call, or null for any other input. */
function quotaArgs(input: Hex) {
  try {
    const call = decodeFunctionData({ abi: collectionAbi, data: input })
    return call.functionName === 'setMintQuota' ? call.args : null
  } catch {
    // Not a call of the collection's ABI.
    return null
  }
}

/**
 * Proves a chunk from its receipt and the transaction's input (docs/specs/2026-10-15-whitelist.md, section
 * 6.2): sent to the collection (`NOT_THIS_CONTRACT`) from the sign-in wallet (`NOT_FROM_WALLET`), as
 * `matchPhaseEvent` checks; then succeeded, decoded as `setMintQuota` for this group with quotas of at most
 * 10,000, and carrying `MintQuotasAdded(group, n)` for the decoded count (`NOT_THIS_CHANGE`). The pairs come
 * from the calldata, lowercased, a repeated address keeping its last quota as the contract does.
 */
export function proveQuotaChunk(
  receipt: PhaseReceipt,
  input: Hex,
  expected: { contract: Address; from: string; onchainId: number },
): ChunkProof {
  if (receipt.to?.toLowerCase() !== expected.contract.toLowerCase())
    return { ok: false, error: NOT_THIS_CONTRACT }
  if (receipt.from.toLowerCase() !== expected.from.toLowerCase()) return { ok: false, error: NOT_FROM_WALLET }
  if (receipt.status !== 'success') return { ok: false, error: NOT_THIS_CHANGE }
  const args = quotaArgs(input)
  if (!args) return { ok: false, error: NOT_THIS_CHANGE }
  const [addresses, group, quotas] = args
  if (group !== BigInt(expected.onchainId) || addresses.length !== quotas.length)
    return { ok: false, error: NOT_THIS_CHANGE }
  if (quotas.some((quota) => quota > BigInt(QUOTA_MAX))) return { ok: false, error: NOT_THIS_CHANGE }
  const event = matchPhaseEvent(receipt, {
    contract: expected.contract,
    from: expected.from,
    event: {
      eventName: 'MintQuotasAdded',
      args: { mintGroup: group, numberOfAddresses: BigInt(addresses.length) },
    },
  })
  if (!event.ok) return event
  const pairs = new Map<string, number>()
  addresses.forEach((address, index) => pairs.set(address.toLowerCase(), Number(quotas[index])))
  return { ok: true, pairs: [...pairs].map(([address, quota]) => ({ address, quota })) }
}
