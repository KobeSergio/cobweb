import { describe, expect, it } from 'vitest'
import { scheduleWarning } from './schedule-logic'

describe('scheduleWarning', () => {
  it('warns from chain time, not the browser clock', () => {
    const blockTimestamp = 1_790_000_000
    expect(scheduleWarning(blockTimestamp - 60, blockTimestamp)).toMatch(/already passed/i)
    expect(scheduleWarning(blockTimestamp + 60, blockTimestamp)).toBeNull()
    expect(scheduleWarning(null, blockTimestamp)).toBeNull()
  })
})
