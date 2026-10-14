import { factoryAbi } from '@cobweb/shared'
import { decodeEventLog, getAddress, type Address, type Hex } from 'viem'
import { NOT_THIS_DEPLOY, OTHER_CODE, OTHER_CONTRACT } from '@/lib/art/result'
import type { ReceiptLike } from './art-paid'

export type CollectionDeployedMatch = { ok: true; collection: Address } | { ok: false; error: string }

/**
 * Finds the factory's `CollectionDeployed` log for this deployer and salt in a receipt and checks it
 * against what the server prepared (docs/specs/2026-10-14-deploy.md, section 6.2): the log must come
 * from the factory's address and name the deployer and the salt (`NOT_THIS_DEPLOY` otherwise), carry
 * the shipped code hash (`OTHER_CODE`), and its address must equal the prediction (`OTHER_CONTRACT`:
 * the arguments on chain are not the ones prepared). The address comes from the log, never from the browser.
 */
export function matchCollectionDeployed(
  receipt: ReceiptLike,
  expected: { factory: Address; deployer: Address; salt: Hex; codeHash: Hex; predicted: Address },
): CollectionDeployedMatch {
  if (receipt.status !== 'success') return { ok: false, error: NOT_THIS_DEPLOY }
  const deployed: { collection: Address; codeHash: Hex }[] = []
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== expected.factory.toLowerCase()) continue
    try {
      const event = decodeEventLog({
        abi: factoryAbi,
        eventName: 'CollectionDeployed',
        data: log.data,
        topics: log.topics,
      })
      // viem decodes any event of the ABI by its topic, whatever `eventName` says: the factory's other
      // events (ArtPaid) are skipped here by name.
      if (event.eventName !== 'CollectionDeployed') continue
      if (
        event.args.deployer.toLowerCase() === expected.deployer.toLowerCase() &&
        event.args.salt.toLowerCase() === expected.salt.toLowerCase()
      )
        deployed.push({ collection: event.args.collection, codeHash: event.args.codeHash })
    } catch {
      // A log the factory's ABI does not decode.
    }
  }
  if (deployed.length === 0) return { ok: false, error: NOT_THIS_DEPLOY }
  const sameCode = deployed.filter(
    (entry) => entry.codeHash.toLowerCase() === expected.codeHash.toLowerCase(),
  )
  if (sameCode.length === 0) return { ok: false, error: OTHER_CODE }
  const match = sameCode.find((entry) => entry.collection.toLowerCase() === expected.predicted.toLowerCase())
  if (!match) return { ok: false, error: OTHER_CONTRACT }
  return { ok: true, collection: getAddress(match.collection) }
}
