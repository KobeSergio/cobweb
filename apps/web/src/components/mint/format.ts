import { REMINDER_MAX_SECONDS } from '@/lib/mint/remind'

const pad = (value: number) => value.toString().padStart(2, '0')

/** What a start past the last second a date can name reads as: no start a visitor can wait for. */
export const NOT_SCHEDULED = 'Not scheduled'

/**
 * A group's start as the page names it: the start itself, or 0 (none) past `REMINDER_MAX_SECONDS`, the end of the
 * year 9999 (lib/mint/remind.ts). The chain's start is a uint256, and past 8.64e12 s a date is invalid, so such a
 * start gets no date and no countdown (a 1e72-day one, else).
 */
export function shownStart(start: number): number {
  return start > REMINDER_MAX_SECONDS ? 0 : start
}

export type CountdownParts = { days: number; hours: number; minutes: number; seconds: number }

export function countdownParts(totalSeconds: number): CountdownParts {
  const s = Math.max(0, Math.floor(totalSeconds))
  return {
    days: Math.floor(s / 86_400),
    hours: Math.floor((s % 86_400) / 3600),
    minutes: Math.floor((s % 3600) / 60),
    seconds: s % 60,
  }
}

/** `02:14:09`, or `2d 02:14:09` past a day. */
export function formatCountdown(totalSeconds: number): string {
  const { days, hours, minutes, seconds } = countdownParts(totalSeconds)
  const clock = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
  return days > 0 ? `${days}d ${clock}` : clock
}

/** A short, human distance: `2d 2h`, `4h 59m`, `12m`, `under a minute`. */
export function formatDistance(totalSeconds: number): string {
  const { days, hours, minutes } = countdownParts(totalSeconds)
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m`
  return 'under a minute'
}

/**
 * A unix time in the visitor's own time zone, e.g. `Mon 5 Oct, 19:00`, or NOT_SCHEDULED past
 * `REMINDER_MAX_SECONDS`. Only call it in the browser (after mount); the server does not know the
 * visitor's zone.
 */
export function formatLocalTime(seconds: number): string {
  if (seconds > REMINDER_MAX_SECONDS) return NOT_SCHEDULED
  const date = new Date(seconds * 1000)
  const day = date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return `${day}, ${time}`
}

/** The same moment in UTC, for the server render before the browser takes over; NOT_SCHEDULED past the bound. */
export function formatUtcTime(seconds: number): string {
  if (seconds > REMINDER_MAX_SECONDS) return NOT_SCHEDULED
  const date = new Date(seconds * 1000)
  const day = date.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
  const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
  return `${day}, ${time} UTC`
}
