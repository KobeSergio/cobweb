import { describe, expect, it } from 'vitest'
import { RECENT_WINDOW_MS, recentCounter } from './recent.ts'

describe('recentCounter (docs/specs/2026-10-17-production-hardening.md, section 8.2)', () => {
  it('counts the failures inside the last 5 minutes and drops the older ones', () => {
    const counter = recentCounter()
    counter.note(1_000)
    counter.note(2_000)
    counter.note(250_000)
    expect(counter.count(250_000)).toBe(3)
    expect(counter.count(1_000 + RECENT_WINDOW_MS - 1)).toBe(3)
    expect(counter.count(1_000 + RECENT_WINDOW_MS)).toBe(2)
    expect(counter.count(250_000 + RECENT_WINDOW_MS)).toBe(0)
  })

  it('keeps the latest at most, as many as its cap', () => {
    const counter = recentCounter(RECENT_WINDOW_MS, 3)
    for (let at = 1; at <= 5; at++) counter.note(at)
    expect(counter.count(10)).toBe(3)
    expect(recentCounter(1_000).count(0)).toBe(0)
  })
})
