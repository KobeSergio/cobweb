import type { Address } from 'viem'

/**
 * The collection check (docs/specs/2026-10-16-freshness-server.md, section 6.3): whether an address is a
 * Cobweb collection, as its chain's factory says through `isCollection`. True is kept for the life of the
 * process (the factory only ever sets it), false for 60 s, at most 10,000 of them with the oldest forgotten
 * first. Asks for one address in flight share one read, and a failed read is kept nowhere: the ask fails and
 * the next one reads again. At most 50 reads are in flight on a chain: an ask that would start another
 * answers busy without reading, so a spray of unknown addresses cannot spend the chain's provider quota.
 */

/** How long a false answer is kept. */
export const NEGATIVE_TTL_MS = 60_000
/** The most false answers kept. */
export const NEGATIVE_MAX = 10_000
/** The most reads in flight on one chain; an ask that would start another answers busy. */
export const CHECK_MAX = 50

/** Whether the address is a collection, or busy when its chain already has 50 reads in flight. */
export type CheckAnswer = boolean | 'busy'

export type CollectionCheck = {
  (chainId: number, address: Address): Promise<CheckAnswer>
  /** The reads in flight on a chain. */
  pending(chainId: number): number
}

export function collectionCheck(
  read: (chainId: number, address: Address) => Promise<boolean>,
  now: () => number = Date.now,
): CollectionCheck {
  const collections = new Set<string>()
  /** False answers by key with their time, oldest first (a Map keeps insertion order). */
  const strangers = new Map<string, number>()
  const inFlight = new Map<string, Promise<boolean>>()
  /** The reads in flight, by chain. */
  const reading = new Map<number, number>()
  const pending = (chainId: number) => reading.get(chainId) ?? 0
  const check = (chainId: number, address: Address): Promise<CheckAnswer> => {
    const key = `${chainId}:${address.toLowerCase()}`
    if (collections.has(key)) return Promise.resolve(true)
    const refusedAt = strangers.get(key)
    if (refusedAt !== undefined) {
      if (now() - refusedAt < NEGATIVE_TTL_MS) return Promise.resolve(false)
      strangers.delete(key)
    }
    const shared = inFlight.get(key)
    if (shared) return shared
    if (pending(chainId) >= CHECK_MAX) return Promise.resolve('busy')
    const asking = read(chainId, address)
      .then((answer) => {
        if (answer) collections.add(key)
        else {
          strangers.set(key, now())
          if (strangers.size > NEGATIVE_MAX) {
            const oldest = strangers.keys().next().value
            if (oldest !== undefined) strangers.delete(oldest)
          }
        }
        return answer
      })
      .finally(() => {
        inFlight.delete(key)
        reading.set(chainId, pending(chainId) - 1)
      })
    inFlight.set(key, asking)
    reading.set(chainId, pending(chainId) + 1)
    return asking
  }
  return Object.assign(check, { pending })
}
