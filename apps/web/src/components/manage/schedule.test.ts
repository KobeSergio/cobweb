import { describe, expect, it } from 'vitest'
import { defaultStart, unixToZoned, zonedToUnix } from './schedule'

describe('zonedToUnix', () => {
  it('reads the time in UTC', () => {
    expect(zonedToUnix({ date: '2026-10-05', time: '17:00' }, 'UTC')).toBe(Date.UTC(2026, 9, 5, 17) / 1000)
  })

  it('reads the time in the creator zone, not the machine zone', () => {
    // Manila is UTC+8 all year: 01:00 there is 17:00 UTC the day before.
    expect(zonedToUnix({ date: '2026-10-06', time: '01:00' }, 'Asia/Manila')).toBe(
      Date.UTC(2026, 9, 5, 17) / 1000,
    )
    // New York in October is on daylight time, UTC-4.
    expect(zonedToUnix({ date: '2026-10-05', time: '13:00' }, 'America/New_York')).toBe(
      Date.UTC(2026, 9, 5, 17) / 1000,
    )
    // In December it is on standard time, UTC-5.
    expect(zonedToUnix({ date: '2026-12-05', time: '12:00' }, 'America/New_York')).toBe(
      Date.UTC(2026, 11, 5, 17) / 1000,
    )
  })

  it('refuses a time the clocks skip', () => {
    // 2026-03-08 02:30 does not exist in New York: clocks go from 02:00 to 03:00.
    expect(zonedToUnix({ date: '2026-03-08', time: '02:30' }, 'America/New_York')).toBeNull()
  })

  it('takes the first of a repeated hour', () => {
    // 2026-11-01 01:30 happens twice in New York; the first is still daylight time (UTC-4).
    expect(zonedToUnix({ date: '2026-11-01', time: '01:30' }, 'America/New_York')).toBe(
      Date.UTC(2026, 10, 1, 5, 30) / 1000,
    )
  })

  it('refuses incomplete or impossible input', () => {
    expect(zonedToUnix({ date: '', time: '10:00' }, 'UTC')).toBeNull()
    expect(zonedToUnix({ date: '2026-10-05', time: '' }, 'UTC')).toBeNull()
    expect(zonedToUnix({ date: '2026-02-30', time: '10:00' }, 'UTC')).toBeNull()
    expect(zonedToUnix({ date: '2026-10-05', time: '24:00' }, 'UTC')).toBeNull()
  })
})

describe('unixToZoned', () => {
  it('is the inverse of zonedToUnix', () => {
    const seconds = Date.UTC(2026, 9, 5, 17) / 1000
    for (const zone of ['UTC', 'Asia/Manila', 'America/New_York', 'Europe/Berlin', 'Asia/Kolkata']) {
      expect(zonedToUnix(unixToZoned(seconds, zone), zone)).toBe(seconds)
    }
    expect(unixToZoned(seconds, 'Asia/Kolkata')).toEqual({ date: '2026-10-05', time: '22:30' })
  })
})

describe('defaultStart', () => {
  it('is a day after the chain time, rounded up to the hour', () => {
    const block = Date.UTC(2026, 9, 3, 14, 20) / 1000
    expect(defaultStart(block, 'UTC')).toEqual({ date: '2026-10-04', time: '15:00' })
  })
})
