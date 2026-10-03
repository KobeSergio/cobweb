'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { formatLocalTime, formatUtcTime } from './format'

/**
 * An estimate of the chain's current time: the block timestamp of the last read plus the time
 * since the page loaded. It drives countdown labels only. It never makes a phase live; that comes
 * from the data's `active` field.
 *
 * The server and the first client render both use the block timestamp as is, so they match.
 */
export function useChainClock(blockTimestamp: number): number {
  const [now, setNow] = useState(blockTimestamp)
  useEffect(() => {
    const started = performance.now()
    const tick = () => setNow(blockTimestamp + Math.floor((performance.now() - started) / 1000))
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [blockTimestamp])
  return now
}

const subscribe = () => () => {}

/** True once the page has hydrated, so browser-only values (the visitor's time zone) can render. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  )
}

/** A time in the visitor's zone once hydrated, in UTC before that. */
export function useLocalTime(seconds: number): string {
  const hydrated = useHydrated()
  return hydrated ? formatLocalTime(seconds) : formatUtcTime(seconds)
}
