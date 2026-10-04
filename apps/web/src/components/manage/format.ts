'use client'

import { useSyncExternalStore } from 'react'

/** `1,204`. */
export const count = (value: number) => value.toLocaleString('en-US')

/** Whole percent, clamped, for progress values. */
export const percent = (part: number, whole: number) =>
  whole <= 0 ? 0 : Math.min(100, Math.max(0, (part / whole) * 100))

/** A span of seconds in words: `2 days 2 hours`, `35 minutes`, `under a minute`. */
export function duration(seconds: number): string {
  const s = Math.abs(seconds)
  const days = Math.floor(s / 86_400)
  const hours = Math.floor((s % 86_400) / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`
  if (days > 0) return hours > 0 ? `${plural(days, 'day')} ${plural(hours, 'hour')}` : plural(days, 'day')
  if (hours > 0)
    return minutes > 0 ? `${plural(hours, 'hour')} ${plural(minutes, 'minute')}` : plural(hours, 'hour')
  if (minutes > 0) return plural(minutes, 'minute')
  return 'under a minute'
}

/** `in 2 days 2 hours` or `4 minutes ago`, against the chain's time (never the browser clock). */
export function relativeTo(at: number, now: number): string {
  return at >= now ? `in ${duration(at - now)}` : `${duration(now - at)} ago`
}

/** `Oct 5, 17:00 UTC`: short, and the same on server and browser. */
export function shortUtc(seconds: number): string {
  const date = new Date(seconds * 1000)
  const month = date.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })
  const time = date.toISOString().slice(11, 16)
  return `${month} ${date.getUTCDate()}, ${time} UTC`
}

const noopSubscribe = () => () => {}

/**
 * The creator's time zone from the browser. `UTC` during server render, so the first paint
 * matches; the real zone arrives on hydration.
 */
export function useTimeZone(): string {
  return useSyncExternalStore(
    noopSubscribe,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    () => 'UTC',
  )
}

/** A unix time in the creator's zone, e.g. `Mon, Oct 5, 7:00 PM`. Client only. */
export function localDateTime(seconds: number, timeZone: string): string {
  return new Date(seconds * 1000).toLocaleString('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** Saves text as a file. */
export function downloadText(fileName: string, text: string, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
