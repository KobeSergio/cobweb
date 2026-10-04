/**
 * A phase start as the creator enters it (a date and a time in their time zone) and the unix
 * seconds `scheduleMintGroupStart` receives. Legacy built the timestamp with `new Date(input)` on a
 * datetime-local string, so it silently used whatever zone the browser was in; here the zone is
 * explicit, shown next to the field, and the conversion is testable.
 */

/** `date` is `YYYY-MM-DD`, `time` is `HH:MM`, both in `timeZone`. */
export type ZonedStart = { date: string; time: string }

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/

/** The wall-clock parts of an instant in a time zone. */
function wallClock(ms: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(ms))
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0)
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  }
}

/** Milliseconds `timeZone` is ahead of UTC at the instant `ms`. */
function offsetAt(ms: number, timeZone: string): number {
  const w = wallClock(ms, timeZone)
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - Math.floor(ms / 1000) * 1000
}

/**
 * A date and time in `timeZone` to unix seconds, or null when the input is incomplete or the
 * time does not exist there (skipped by a daylight-saving change). A time that occurs twice (the
 * hour repeated when clocks go back) resolves to the first, earlier occurrence.
 */
export function zonedToUnix(start: ZonedStart, timeZone: string): number | null {
  const d = DATE.exec(start.date)
  const t = TIME.exec(start.time)
  if (!d || !t) return null
  const [year, month, day] = [Number(d[1]), Number(d[2]), Number(d[3])]
  const [hour, minute] = [Number(t[1]), Number(t[2])]
  const asUtc = Date.UTC(year, month - 1, day, hour, minute)
  if (new Date(asUtc).getUTCDate() !== day) return null
  // Try the offsets in force a day either side; keep the earliest that lands on the wall time.
  const candidates = [offsetAt(asUtc - 86_400_000, timeZone), offsetAt(asUtc + 86_400_000, timeZone)]
    .map((offset) => asUtc - offset)
    .sort((a, b) => a - b)
  for (const ms of candidates) {
    const w = wallClock(ms, timeZone)
    if (w.year === year && w.month === month && w.day === day && w.hour === hour && w.minute === minute)
      return ms / 1000
  }
  return null
}

/** Unix seconds as a date and time in `timeZone`, the inverse of `zonedToUnix`. */
export function unixToZoned(seconds: number, timeZone: string): ZonedStart {
  const w = wallClock(seconds * 1000, timeZone)
  const pad = (n: number, width = 2) => String(n).padStart(width, '0')
  return { date: `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}`, time: `${pad(w.hour)}:${pad(w.minute)}` }
}

/** The default start: a day after the chain's time, rounded up to the hour. */
export function defaultStart(blockTimestamp: number, timeZone: string): ZonedStart {
  return unixToZoned(Math.ceil((blockTimestamp + 86_400) / 3600) * 3600, timeZone)
}
