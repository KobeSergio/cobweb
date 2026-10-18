/**
 * The origin's answers over the last minute for /health's `requests`
 * (docs/specs/2026-10-18-load-run-contract-review-and-cloudflare.md, section 4.1), pure: the hosted load run
 * reads them every 5 s to judge what reaches the origin behind the edge, and `verify:load` proves them against
 * k6's own counts. Counts are kept per whole second, so memory follows the collections asked for in the last
 * minute and no more; a key is `<chain id>:<lowercase address>` and never leaves this module.
 */

/** The window /health counts over, in seconds, the current second included. */
export const REQUEST_WINDOW_S = 60

/** /health's `requests`: the answers in the window by route, the collections asked for and the busiest one's. */
export type RequestsHealth = {
  windowS: number
  /** State answers of 200 or 304, HEAD as GET. */
  state: number
  /** The 304s among them. */
  notModified: number
  /** Wallet answers of 200. */
  wallet: number
  /** Answers of 400 or above on any route. */
  refused: number
  /** Collections with a state answer in the window. */
  collections: number
  /** The most state answers any one collection had in the window. */
  busiest: number
}

/** One second's answers. */
type Second = {
  state: number
  notModified: number
  wallet: number
  refused: number
  byKey: Map<string, number>
}

/** Counts answers per whole second and sums those of the last `windowS` seconds. */
export function requestCounts(windowS: number = REQUEST_WINDOW_S): {
  state(now: number, collection: string, notModified: boolean): void
  wallet(now: number): void
  refused(now: number): void
  health(now: number): RequestsHealth
} {
  const seconds = new Map<number, Second>()

  /** Drops the seconds that left the window by `second`. */
  function prune(second: number): void {
    for (const at of seconds.keys()) if (at <= second - windowS) seconds.delete(at)
  }

  /** The second `now` falls in, created when it has no answer yet, once the older ones are dropped. */
  function secondOf(now: number): Second {
    const at = Math.floor(now / 1_000)
    let second = seconds.get(at)
    if (!second) {
      prune(at)
      second = { state: 0, notModified: 0, wallet: 0, refused: 0, byKey: new Map() }
      seconds.set(at, second)
    }
    return second
  }

  return {
    state(now, collection, notModified) {
      const second = secondOf(now)
      second.state++
      if (notModified) second.notModified++
      second.byKey.set(collection, (second.byKey.get(collection) ?? 0) + 1)
    },
    wallet(now) {
      secondOf(now).wallet++
    },
    refused(now) {
      secondOf(now).refused++
    },
    health(now) {
      const current = Math.floor(now / 1_000)
      prune(current)
      const totals: RequestsHealth = {
        windowS,
        state: 0,
        notModified: 0,
        wallet: 0,
        refused: 0,
        collections: 0,
        busiest: 0,
      }
      const byKey = new Map<string, number>()
      for (const [at, second] of seconds) {
        if (at > current) continue
        totals.state += second.state
        totals.notModified += second.notModified
        totals.wallet += second.wallet
        totals.refused += second.refused
        for (const [key, count] of second.byKey) byKey.set(key, (byKey.get(key) ?? 0) + count)
      }
      totals.collections = byKey.size
      for (const count of byKey.values()) totals.busiest = Math.max(totals.busiest, count)
      return totals
    },
  }
}
