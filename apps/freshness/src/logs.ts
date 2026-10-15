import { validatorAbi } from '@cobweb/shared'
import { collectionAbi } from '@cobweb/shared/collection-abi'
import { getAbiItem, toEventSelector, type Address, type Hex } from 'viem'
import { errorName } from './health.ts'

/**
 * The log scan (docs/specs/2026-10-16-freshness-server.md, section 6.5): one `eth_getLogs` per chain and tick
 * over the hot collections and their validators with code, for the events that change what a mint page shows.
 * A matching log marks its collection for a full read in the same tick. Topics come from the ABIs.
 */

/** A scan whose range would pass 500 blocks is not sent: every hot collection is read in full instead. */
export const MAX_LOG_RANGE = 500n

/** The events that change `collectionState()`, with the fees. */
export const STATE_EVENTS = [
  'MintGroupStatusChanged',
  'AllMintGroupsStatusChanged',
  'MintGroupStartTimestampChanged',
  'MintGroupRegistered',
  'SalePriceChanged',
  'MintGroupMaxSupplyUpdated',
  'PublicMaxMintPerWalletChanged',
  'MintOnBehalfUpdated',
  'FeesUpdated',
] as const

/** The events that change the extras: the base URI, the owner, the royalty and the validator. */
export const EXTRAS_EVENTS = [
  'BatchMetadataUpdate',
  'OwnershipTransferred',
  'DefaultRoyaltyUpdated',
  'TokenRoyaltyUpdated',
  'TransferValidatorUpdated',
] as const

const COLLECTION_TOPICS: readonly Hex[] = [...STATE_EVENTS, ...EXTRAS_EVENTS].map((name) =>
  toEventSelector(getAbiItem({ abi: collectionAbi, name })),
)
const LEVEL_TOPIC: Hex = toEventSelector(getAbiItem({ abi: validatorAbi, name: 'SetTransferSecurityLevel' }))

/** The 15 topics the scan asks for: the 14 collection events, then the validator's level event. */
export function watchedTopics(): Hex[] {
  return [...COLLECTION_TOPICS, LEVEL_TOPIC]
}

/** A log as the scan reads it: any viem log, or a node's answer to `eth_getLogs`, has this shape. */
export type LogLike = { address: Address; topics: readonly Hex[] }

/** A hot collection as the scan sees it: its address and the validator of its last extras, if any. */
export type ScanTarget = { address: Address; validator: Address | null }

/**
 * The lowercase addresses of the collections to read in full: a hot collection with a watched log of its own,
 * and the collection a validator's `SetTransferSecurityLevel` names in its topic1 when that collection uses
 * that validator. Anything else is ignored.
 */
export function marksOf(logs: readonly LogLike[], hot: readonly ScanTarget[]): Set<string> {
  const targets = new Map(hot.map((target) => [target.address.toLowerCase(), target]))
  const collectionTopics = new Set(COLLECTION_TOPICS)
  const marks = new Set<string>()
  for (const log of logs) {
    const from = log.address.toLowerCase()
    const topic = log.topics[0]?.toLowerCase() as Hex | undefined
    if (!topic) continue
    if (targets.has(from) && collectionTopics.has(topic)) {
      marks.add(from)
      continue
    }
    const named = log.topics[1]
    if (topic !== LEVEL_TOPIC || !named) continue
    const collection = `0x${named.slice(26)}`.toLowerCase()
    const validator = targets.get(collection)?.validator
    if (validator && validator.toLowerCase() === from) marks.add(collection)
  }
  return marks
}

/** One `eth_getLogs` as the scan sends it: raw topics, so one call covers both ABIs. */
export type GetLogs = (filter: {
  address: Address[]
  topics: [Hex[]]
  fromBlock: bigint
  toBlock: bigint
}) => Promise<readonly LogLike[]>

/** What a scan found: the collections to read in full, and whether it was a gap (skipped or failed). */
export type Scan = { marks: Set<string>; gap: boolean; failure: string | null }

/**
 * Scans the blocks after `scanned` up to `head`: one `eth_getLogs` over the hot collections and `validators`
 * (the distinct validators of their extras that have code). A range over 500 blocks is not sent, and a failed
 * call is not tried again: either way every hot collection is marked, as a gap.
 */
export async function scanLogs(
  getLogs: GetLogs,
  scanned: bigint,
  head: bigint,
  hot: readonly ScanTarget[],
  validators: readonly Address[],
): Promise<Scan> {
  const everyHot = new Set(hot.map((target) => target.address.toLowerCase()))
  if (head - scanned > MAX_LOG_RANGE) return { marks: everyHot, gap: true, failure: null }
  try {
    const logs = await getLogs({
      address: [...hot.map((target) => target.address), ...validators],
      topics: [watchedTopics()],
      fromBlock: scanned + 1n,
      toBlock: head,
    })
    return { marks: marksOf(logs, hot), gap: false, failure: null }
  } catch (error) {
    return { marks: everyHot, gap: true, failure: errorName(error) }
  }
}
