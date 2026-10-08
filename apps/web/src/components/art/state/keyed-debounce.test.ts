import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EDIT_DEBOUNCE_MS, KeyedDebounce } from './keyed-debounce'

describe('KeyedDebounce', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('sends one call per layer, with the last values, 250 ms after the last edit', () => {
    const debounce = new KeyedDebounce(EDIT_DEBOUNCE_MS)
    const sent: string[] = []
    for (const weight of [10, 20, 30]) debounce.schedule('weights:eyes', () => sent.push(`eyes ${weight}`))
    debounce.schedule('weights:hats', () => sent.push('hats 50'))
    vi.advanceTimersByTime(249)
    expect(sent).toEqual([])
    vi.advanceTimersByTime(1)
    expect(sent).toEqual(['eyes 30', 'hats 50'])
    vi.advanceTimersByTime(1000)
    expect(sent).toHaveLength(2)
  })

  it('flush sends what is waiting at once, and only once (leaving the screen keeps the last edit)', () => {
    const debounce = new KeyedDebounce(EDIT_DEBOUNCE_MS)
    const sent: string[] = []
    debounce.schedule('size:owls', () => sent.push('owls 500'))
    debounce.flushAll()
    expect(sent).toEqual(['owls 500'])
    vi.advanceTimersByTime(1000)
    expect(sent).toEqual(['owls 500'])
  })

  it('flush(key) sends only that key, once', () => {
    const debounce = new KeyedDebounce(EDIT_DEBOUNCE_MS)
    const sent: string[] = []
    debounce.schedule('weights:eyes', () => sent.push('eyes'))
    debounce.schedule('weights:hats', () => sent.push('hats'))
    debounce.flush('weights:eyes')
    debounce.flush('weights:eyes')
    expect(sent).toEqual(['eyes'])
    vi.advanceTimersByTime(250)
    expect(sent).toEqual(['eyes', 'hats'])
  })
})
