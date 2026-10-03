const pad = (value: number) => value.toString().padStart(2, '0')

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
 * A unix time in the visitor's own time zone, e.g. `Mon 5 Oct, 19:00`. Only call it in the
 * browser (after mount); the server does not know the visitor's zone.
 */
export function formatLocalTime(seconds: number): string {
  const date = new Date(seconds * 1000)
  const day = date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return `${day}, ${time}`
}

/** The same moment in UTC, for the server render before the browser takes over. */
export function formatUtcTime(seconds: number): string {
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
