import type { Address } from 'viem'

/**
 * "Remind me" for a scheduled phase (docs/specs/2026-10-16-mint-page-live-data.md, decision 25 and section 7.8),
 * pure: one calendar event at the group's start on the chain, in UTC, for 30 minutes, as an `.ics` file built in
 * the browser and as a Google Calendar link. Nothing is stored.
 */
export type Reminder = {
  collection: string
  phase: string
  chainId: number
  contract: Address
  groupId: number
  /** The group's `startTimestamp`, Unix seconds. */
  start: number
  /** The page's link. */
  url: string
}

/** How long the event lasts. */
export const REMINDER_SECONDS = 30 * 60
export const REMINDER_SENTENCE = 'Minting opens when the chain reaches this time.'

/** A time as iCalendar and Google write it in UTC: `YYYYMMDDTHHMMSSZ`. */
export function calendarTime(seconds: number): string {
  return new Date(seconds * 1_000)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')
}

const titleOf = (reminder: Reminder) => `${reminder.collection}: ${reminder.phase} opens`

/** Text as iCalendar escapes it: backslashes, semicolons, commas and line breaks. */
function escapeText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

/** A content line folded at 75 octets, the continuation lines starting with a space, never inside a character. */
function fold(line: string): string {
  const encoder = new TextEncoder()
  const parts: string[] = []
  let current = ''
  let size = 0
  for (const character of line) {
    const bytes = encoder.encode(character).length
    const limit = parts.length === 0 ? 75 : 74
    if (size + bytes > limit) {
      parts.push(current)
      current = ''
      size = 0
    }
    current += character
    size += bytes
  }
  parts.push(current)
  return parts.join('\r\n ')
}

/** The `.ics` file of one reminder; `stampSeconds` dates the file (the browser's clock). */
export function icsOf(reminder: Reminder, stampSeconds: number): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Cobweb//Mint page//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${reminder.chainId}-${reminder.contract.toLowerCase()}-${reminder.groupId}-${reminder.start}@cobweb`,
    `DTSTAMP:${calendarTime(stampSeconds)}`,
    `DTSTART:${calendarTime(reminder.start)}`,
    `DTEND:${calendarTime(reminder.start + REMINDER_SECONDS)}`,
    `SUMMARY:${escapeText(titleOf(reminder))}`,
    `DESCRIPTION:${escapeText(`${REMINDER_SENTENCE}\n${reminder.url}`)}`,
    `URL:${reminder.url}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return `${lines.map(fold).join('\r\n')}\r\n`
}

/** The Google Calendar link that fills in the same event. */
export function googleCalendarUrl(reminder: Reminder): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: titleOf(reminder),
    dates: `${calendarTime(reminder.start)}/${calendarTime(reminder.start + REMINDER_SECONDS)}`,
    details: `${REMINDER_SENTENCE}\n${reminder.url}`,
  })
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

/** The file name the reminder is saved as. */
export const icsFileName = (slug: string, groupId: number) => `${slug}-phase-${groupId}.ics`
