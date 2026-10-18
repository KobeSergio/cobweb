import { describe, expect, it } from 'vitest'
import { REQUEST_WINDOW_S, requestCounts, type RequestsHealth } from './requests.ts'

const A = '31337:0x5fbdb2315678afecb367f032d93f642f64180aa3'
const B = '31337:0xe7f1725e7734ce288f8367e1bb143e90bb3f0512'
/** A moment inside second 1,000 of the clock. */
const T = 1_000_000

const EMPTY: RequestsHealth = {
  windowS: REQUEST_WINDOW_S,
  state: 0,
  notModified: 0,
  wallet: 0,
  refused: 0,
  collections: 0,
  busiest: 0,
}

describe('requestCounts (docs/specs/2026-10-18-load-run-contract-review-and-cloudflare.md, section 4.1)', () => {
  it('answers zeros over a 60 s window before any answer', () => {
    expect(requestCounts().health(T)).toEqual(EMPTY)
    expect(requestCounts(10).health(T)).toEqual({ ...EMPTY, windowS: 10 })
  })

  it("sums one second's answers and keeps the 304s within the state answers", () => {
    const counts = requestCounts()
    counts.state(T, A, false)
    counts.state(T + 10, A, true)
    counts.state(T + 999, A, true)
    expect(counts.health(T + 999)).toEqual({ ...EMPTY, state: 3, notModified: 2, collections: 1, busiest: 3 })
  })

  it('counts an answer while its second is among the last 60, the current one included, and drops it after', () => {
    const counts = requestCounts()
    counts.state(T, A, false)
    counts.wallet(T)
    counts.refused(T)
    const last = T + (REQUEST_WINDOW_S - 1) * 1_000
    expect(counts.health(last + 999)).toEqual({
      ...EMPTY,
      state: 1,
      wallet: 1,
      refused: 1,
      collections: 1,
      busiest: 1,
    })
    expect(counts.health(last + 1_000)).toEqual(EMPTY)
  })

  it("counts two collections and names the busiest one's count", () => {
    const counts = requestCounts()
    for (let second = 0; second < 5; second++) counts.state(T + second * 1_000, A, second > 0)
    counts.state(T + 2_000, B, false)
    counts.state(T + 3_000, B, true)
    expect(counts.health(T + 4_000)).toEqual({
      ...EMPTY,
      state: 7,
      notModified: 5,
      collections: 2,
      busiest: 5,
    })
  })

  it('drops a collection once its last second leaves the window', () => {
    const counts = requestCounts()
    counts.state(T, A, false)
    counts.state(T + 30_000, B, false)
    expect(counts.health(T + 59_000)).toMatchObject({ collections: 2, busiest: 1 })
    expect(counts.health(T + 60_000)).toMatchObject({ state: 1, collections: 1, busiest: 1 })
    expect(counts.health(T + 90_000)).toEqual(EMPTY)
  })

  it('counts wallet answers and refusals apart from the state answers', () => {
    const counts = requestCounts()
    counts.wallet(T)
    counts.wallet(T + 1_500)
    counts.refused(T + 2_000)
    expect(counts.health(T + 2_000)).toEqual({ ...EMPTY, wallet: 2, refused: 1 })
  })
})
