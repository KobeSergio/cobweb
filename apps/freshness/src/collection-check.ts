import type { Address } from 'viem'

/**
 * The collection check (docs/specs/2026-10-16-freshness-server.md, section 6.3): whether an address is a
 * Cobweb collection, as its chain's factory says through `isCollection`. True is kept for the life of the
 * process (the factory only ever sets it), false for 60 s, at most 10,000 of them with the oldest forgotten
 * first. Asks for one address in flight share one read, and a failed read is kept nowhere: the ask fails and
 * the next one reads again.
 */

/** How long a false answer is kept. */
export const NEGATIVE_TTL_MS = 60_000
/** The most false answers kept. */
export const NEGATIVE_MAX = 10_000

export function collectionCheck(
  read: (chainId: number, address: Address) => Promise<boolean>,
  now: () => number = Date.now,
): (chainId: number, address: Address) => Promise<boolean> {
  const collections = new Set<string>()
  /** False answers by key with their time, oldest first (a Map keeps insertion order). */
  const strangers = new Map<string, number>()
  const inFlight = new Map<string, Promise<boolean>>()
  return (chainId, address) => {
    const key = `${chainId}:${address.toLowerCase()}`
    if (collections.has(key)) return Promise.resolve(true)
    const refusedAt = strangers.get(key)
    if (refusedAt !== undefined) {
      if (now() - refusedAt < NEGATIVE_TTL_MS) return Promise.resolve(false)
      strangers.delete(key)
    }
    const pending = inFlight.get(key)
    if (pending) return pending
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
      .finally(() => inFlight.delete(key))
    inFlight.set(key, asking)
    return asking
  }
}
