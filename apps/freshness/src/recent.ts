/**
 * Failures counted over the last 5 minutes for /health's thresholds (docs/specs/2026-10-17-production-hardening.md,
 * section 8.2), pure: a cumulative counter only grows, so an alert on it would never clear.
 */

export const RECENT_WINDOW_MS = 300_000
/** At most this many failure times are kept: more than any threshold needs. */
const RECENT_CAP = 1_000

/** Notes failure times and counts those inside the window, keeping at most `cap` of the latest. */
export function recentCounter(
  windowMs: number = RECENT_WINDOW_MS,
  cap: number = RECENT_CAP,
): { note(now: number): void; count(now: number): number } {
  const times: number[] = []
  return {
    note(now) {
      times.push(now)
      if (times.length > cap) times.splice(0, times.length - cap)
    },
    count(now) {
      while (times.length && now - times[0]! >= windowMs) times.shift()
      return times.length
    },
  }
}
