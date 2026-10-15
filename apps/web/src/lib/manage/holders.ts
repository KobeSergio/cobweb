import { getAddress, zeroAddress, type Address } from 'viem'

/**
 * The holder snapshot's pure parts (docs/specs/2026-10-15-whitelist.md, section 6.4): which token ids to
 * read, and the owners read back as holders with their balances. The server reads the chain
 * (snapshot-core.ts); the browser shows the result.
 */

/** One holder of the snapshotted collection and how many of its tokens they hold. */
export type Holder = { address: Address; balance: number }

/** A snapshot at one block: the holders, the block, and the `totalSupply()` read there. */
export type HolderSnapshot = { holders: Holder[]; block: number; supply: number }

/** The largest `totalSupply()` a snapshot reads (one `ownerOf` per id, within a server action's 300 seconds). */
export const SNAPSHOT_MAX_SUPPLY = 20_000

const DEAD = '0x000000000000000000000000000000000000dead'

/**
 * The ids to read: 0 to the supply, both ends included, so a collection numbered from 0 and one numbered
 * from 1 are both read whole. An id that does not exist (the extra end, or a burned token) reads null.
 */
export function snapshotIds(supply: bigint): bigint[] {
  return Array.from({ length: Number(supply) + 1 }, (_, id) => BigInt(id))
}

/**
 * Owners as holders: failed reads, the zero address and the dead address left out, a balance summed per
 * owner, checksummed, the most tokens first, then by lowercase address.
 */
export function holdersOf(owners: readonly (string | null)[]): Holder[] {
  const balances = new Map<string, number>()
  for (const owner of owners) {
    if (!owner) continue
    const key = owner.toLowerCase()
    if (key === zeroAddress || key === DEAD) continue
    balances.set(key, (balances.get(key) ?? 0) + 1)
  }
  return [...balances]
    .sort(([a, left], [b, right]) => right - left || (a < b ? -1 : a > b ? 1 : 0))
    .map(([address, balance]) => ({ address: getAddress(address), balance }))
}
