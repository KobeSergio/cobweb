import { createHash } from 'node:crypto'
import type { StateActivity, StateBody } from '@cobweb/shared'
import type { HotEntry } from './hot-set.ts'

/**
 * The state endpoint's body and its tag (docs/specs/2026-10-16-freshness-server.md, sections 6.7 and 6.10),
 * pure. Liveness is each group's `active`, the contract's own; the times only label countdowns. The body's
 * type lives in the shared package with the paths, so the mint page reads what this writes.
 */
export type { StateBody }

/**
 * The body of an entry with a read, keys in this order and the groups in the contract's, with the indexer's
 * activity last (docs/specs/2026-10-16-indexer-overview.md, section 6.6).
 */
export function stateBody(
  chainId: number,
  entry: HotEntry,
  degraded: boolean,
  activity: StateActivity | null,
): StateBody {
  const { read, readAt } = entry
  if (!read || readAt === null) throw new Error('A state body needs a read.')
  const { state, fees, extras } = read
  const level = extras.transferLevel
  return {
    chainId,
    address: entry.address,
    block: Number(state.block),
    blockTimestamp: state.blockTimestamp,
    readAt: Math.floor(readAt / 1_000),
    degraded,
    maxSupply: state.maxSupply,
    totalMinted: state.totalMinted,
    publicMaxMintPerWallet: state.publicMaxMintPerWallet,
    mintFeeFlatWei: fees.mintFeeFlatWei,
    mintFeeBps: fees.mintFeeBps,
    airdropFeePerTokenWei: fees.airdropFeePerTokenWei,
    mintOnBehalfActive: state.mintOnBehalfActive,
    groups: state.groups.map((group) => ({
      id: group.id,
      priceWei: group.priceWei,
      maxSupply: group.maxSupply,
      minted: group.minted,
      startTimestamp: group.startTimestamp,
      flag: group.flag,
      active: group.active,
    })),
    owner: extras.owner,
    royalty: { receiver: extras.royalty.receiver, bps: extras.royalty.bps },
    baseUri: extras.baseUri,
    transferValidator: extras.transferValidator,
    transferLevel: level.kind === 'level' ? level.level : level.kind,
    activity,
  }
}

/** What the tag leaves out: the read's time, block and block time, which change on every tick. */
const UNTAGGED: ReadonlySet<string> = new Set(['readAt', 'block', 'blockTimestamp'])

/**
 * A weak tag over the body without `readAt`, `block` and `blockTimestamp`: a tick that changes nothing else
 * keeps it, so a poll with `If-None-Match` answers 304. `degraded` and `activity` are inside it: a new mint,
 * a new holder count or a flip to or from null answers 200, a pass that only moves cursors keeps the tag.
 */
export function etagOf(body: StateBody): string {
  const tagged = Object.fromEntries(Object.entries(body).filter(([key]) => !UNTAGGED.has(key)))
  return `W/"${createHash('sha256').update(JSON.stringify(tagged)).digest('hex').slice(0, 32)}"`
}

/** Whether `If-None-Match` matches: weak comparison with each tag it lists, and `*` matches anything. */
export function etagMatches(ifNoneMatch: string | undefined, etag: string): boolean {
  if (!ifNoneMatch) return false
  const opaque = (tag: string) => tag.trim().replace(/^W\//, '')
  return ifNoneMatch.split(',').some((tag) => tag.trim() === '*' || opaque(tag) === opaque(etag))
}
