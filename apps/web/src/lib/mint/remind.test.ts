import { describe, expect, it } from 'vitest'
import {
  calendarTime,
  googleCalendarUrl,
  icsFileName,
  icsOf,
  REMINDER_MAX_SECONDS,
  reminderAllowed,
  type Reminder,
} from './remind'

const reminder: Reminder = {
  collection: 'Night Owls, Vol. 1; the "first" run',
  phase: 'Public',
  chainId: 8453,
  contract: '0x4f2A9C7E1B3d5F6A8C0E2b4D6f8A1C3e5B7D9f0a',
  groupId: 0,
  start: 1_791_212_400,
  url: 'https://cobweb.app/night-owls',
}

describe('icsOf (docs/specs/2026-10-16-mint-page-live-data.md, section 7.8)', () => {
  const ics = icsOf(reminder, 1_791_039_600)
  const lines = ics.split('\r\n')

  it('writes one event at the start in UTC for 30 minutes, with CRLF lines and the UID', () => {
    expect(ics.endsWith('\r\n')).toBe(true)
    expect(ics.replace(/\r\n/g, '')).not.toContain('\n')
    expect(lines).toContain('DTSTART:20261005T150000Z')
    expect(lines).toContain('DTEND:20261005T153000Z')
    expect(lines).toContain('DTSTAMP:20261003T150000Z')
    expect(lines).toContain('UID:8453-0x4f2a9c7e1b3d5f6a8c0e2b4d6f8a1c3e5b7d9f0a-0-1791212400@cobweb')
    expect(lines.filter((line) => line === 'BEGIN:VEVENT')).toHaveLength(1)
  })

  it('escapes commas, semicolons and line breaks in the text', () => {
    const unfolded = ics.replace(/\r\n /g, '')
    expect(unfolded).toContain('SUMMARY:Night Owls\\, Vol. 1\\; the "first" run: Public opens')
    expect(unfolded).toContain(
      'DESCRIPTION:Minting opens when the chain reaches this time.\\nhttps://cobweb.app/night-owls',
    )
  })

  it('folds lines over 75 octets, the continuation starting with a space, never inside a character', () => {
    const long = icsOf({ ...reminder, collection: 'Ö'.repeat(60) }, 0).split('\r\n')
    for (const line of long) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
    const summary = long.findIndex((line) => line.startsWith('SUMMARY:'))
    expect(long[summary + 1]?.startsWith(' ')).toBe(true)
    expect(long.join('\r\n').replace(/\r\n /g, '')).toContain(`SUMMARY:${'Ö'.repeat(60)}: Public opens`)
  })

  it('escapes a backslash before the other characters, so the backslash it adds is not doubled', () => {
    const unfolded = icsOf({ ...reminder, collection: 'Owls\\Co;1' }, 0).replace(/\r\n /g, '')
    expect(unfolded).toContain('SUMMARY:Owls\\\\Co\\;1: Public opens')
  })

  it('never folds inside a code point above the BMP, which is two UTF-16 units and four octets', () => {
    const owl = '\u{1F989}'
    const lines = icsOf({ ...reminder, collection: owl.repeat(40) }, 0).split('\r\n')
    const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
    for (const line of lines) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
      expect(lone.test(line)).toBe(false)
    }
    // "SUMMARY:" is 8 octets and 16 owls make 72; a 17th would make 76, so the line ends after the 16th.
    expect(lines.find((line) => line.startsWith('SUMMARY:'))).toBe(`SUMMARY:${owl.repeat(16)}`)
    expect(lines.join('\r\n').replace(/\r\n /g, '')).toContain(`SUMMARY:${owl.repeat(40)}: Public opens`)
  })

  it('names the file after the link and the phase', () => {
    expect(icsFileName('night-owls', 2)).toBe('night-owls-phase-2.ics')
  })
})

describe('googleCalendarUrl', () => {
  it("fills the event's dates as start/end and its text, encoded", () => {
    const url = new URL(googleCalendarUrl(reminder))
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render')
    expect(url.searchParams.get('action')).toBe('TEMPLATE')
    expect(url.searchParams.get('dates')).toBe('20261005T150000Z/20261005T153000Z')
    expect(url.searchParams.get('text')).toBe('Night Owls, Vol. 1; the "first" run: Public opens')
    expect(url.searchParams.get('details')).toBe(
      'Minting opens when the chain reaches this time.\nhttps://cobweb.app/night-owls',
    )
    expect(googleCalendarUrl(reminder)).not.toContain(' ')
    expect(calendarTime(0)).toBe('19700101T000000Z')
  })
})

describe('a start the chain can set that no calendar can name (fix round 1)', () => {
  it('formats the last second of the year 9999 and offers a reminder up to it, never past it', () => {
    expect(REMINDER_MAX_SECONDS).toBe(253_402_300_799)
    expect(calendarTime(REMINDER_MAX_SECONDS)).toBe('99991231T235959Z')
    expect(reminderAllowed(REMINDER_MAX_SECONDS)).toBe(true)
    expect(reminderAllowed(REMINDER_MAX_SECONDS + 1)).toBe(false)
  })

  it('offers none for a start that is not set, not a number, or far past what a Date can hold', () => {
    // The chain's start is a uint256 read through Number(): 0 is unset, and a creator can type microseconds
    // or the maximum.
    const starts = [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 8.64e12 + 1, 1_791_212_400_000_000]
    for (const start of [...starts, Number(2n ** 256n - 1n)]) expect(reminderAllowed(start)).toBe(false)
    expect(reminderAllowed(1_791_212_400)).toBe(true)
  })

  it('ends an event close to the bound at the bound, so no stamp has a five-digit year', () => {
    const near = icsOf({ ...reminder, start: REMINDER_MAX_SECONDS - 600 }, 0).split('\r\n')
    expect(near).toContain('DTSTART:99991231T234959Z')
    expect(near).toContain('DTEND:99991231T235959Z')
    const last = new URL(googleCalendarUrl({ ...reminder, start: REMINDER_MAX_SECONDS }))
    expect(last.searchParams.get('dates')).toBe('99991231T235959Z/99991231T235959Z')
  })
})
