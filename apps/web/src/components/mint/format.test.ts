import { describe, expect, it } from 'vitest'
import { REMINDER_MAX_SECONDS } from '@/lib/mint/remind'
import { formatLocalTime, formatUtcTime, NOT_SCHEDULED, shownStart } from './format'

/** Past this many seconds a JavaScript date is invalid. */
const DATE_MAX_SECONDS = 8.64e12
/** The largest uint256 as a number, a start some contracts read as "never". */
const UINT256_MAX = 2 ** 256 - 1

describe('the start labels at the end of the year 9999 (final fix wave M4)', () => {
  it('name the last second a date can name, in UTC and in the visitor zone', () => {
    expect(formatUtcTime(REMINDER_MAX_SECONDS)).toBe('Fri 31 Dec, 23:59 UTC')
    const local = formatLocalTime(REMINDER_MAX_SECONDS)
    expect(local).not.toBe(NOT_SCHEDULED)
    expect(local).not.toMatch(/Invalid/)
    expect(shownStart(REMINDER_MAX_SECONDS)).toBe(REMINDER_MAX_SECONDS)
  })

  it('read "Not scheduled" past it, where a date would read Invalid Date, and give no start to count down to', () => {
    for (const start of [REMINDER_MAX_SECONDS + 1, DATE_MAX_SECONDS + 1, UINT256_MAX]) {
      expect(formatUtcTime(start)).toBe('Not scheduled')
      expect(formatLocalTime(start)).toBe('Not scheduled')
      expect(shownStart(start)).toBe(0)
    }
  })
})
