'use client'

import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  cadenceMs,
  chainNowOf,
  EMPTY_TRACK,
  foldState,
  NEXT_ANSWER_MAX_MS,
  OWN_DEGRADED_MS,
  ownDegraded,
  type FreshTrack,
} from '@/lib/mint/fresh-client'
import { liveOf, type MintLive } from '@/lib/mint/live-data'
import type { MintSource } from '@/lib/mint/live-source'
import type { MintPageStatic } from '@/lib/mint/page-doc'
import { derivePhases } from './model'

/**
 * The collection's state from the source (docs/specs/2026-10-16-mint-page-live-data.md, section 7.2): polled at
 * the cadence the answers and the phases set (1 s before the first answer and around a start, 3 s otherwise, the
 * retry's wait after a failure, none after a final refusal), not while the tab is hidden and at once on its
 * return, each answer folded into the track. The chain clock ticks each second from the last anchor.
 */
export function useLiveState(source: MintSource, page: MintPageStatic) {
  const trackRef = useRef<FreshTrack>(EMPTY_TRACK)
  const [track, setTrack] = useState<FreshTrack>(EMPTY_TRACK)
  /** Mints waiting for the next accepted answer. */
  const waiters = useRef<(() => void)[]>([])
  const [startedAt] = useState(() => performance.now())
  const [now, setNow] = useState<number | null>(null)

  const query = useQuery({
    queryKey: ['mint-state', page.chain.id, page.contract.toLowerCase()],
    queryFn: async () => {
      const poll = await source.pollState()
      const next = foldState(trackRef.current, poll, performance.now())
      trackRef.current = next
      setTrack(next)
      if (poll.kind === 'body' && next.body === poll.body)
        for (const resolve of waiters.current.splice(0)) resolve()
      return next
    },
    enabled: track.final === null,
    refetchInterval: () => {
      const current = trackRef.current
      const phases = current.body
        ? derivePhases(liveOf(page, current.body), null, chainNowOf(current, performance.now()))
        : []
      return cadenceMs(current, phases) ?? false
    },
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: false,
    structuralSharing: false,
    gcTime: 0,
  })
  const refetch = useRef(query.refetch)
  refetch.current = query.refetch

  useEffect(() => {
    const tick = () => setNow(performance.now())
    tick()
    const id = window.setInterval(tick, 1_000)
    return () => window.clearInterval(id)
  }, [])

  /** Polls at once, after a mint. */
  const refresh = useCallback(() => void refetch.current(), [])

  /** Resolves on the next accepted answer, or after 2 s; asks for it at once. */
  const nextAnswer = useCallback(
    () =>
      new Promise<void>((resolve) => {
        const done = () => {
          window.clearTimeout(timer)
          waiters.current = waiters.current.filter((waiter) => waiter !== done)
          resolve()
        }
        const timer = window.setTimeout(done, NEXT_ANSWER_MAX_MS)
        waiters.current.push(done)
        void refetch.current()
      }),
    [],
  )

  const live: MintLive | null = useMemo(
    () => (track.body ? liveOf(page, track.body) : null),
    [page, track.body],
  )
  const at = now === null ? null : Math.max(now, track.anchor?.at ?? now)
  return {
    track,
    live,
    /** The chain's time by the anchor, ticking each second; labels only. */
    chainNow: at === null ? null : chainNowOf(track, at),
    /** No answer was accepted for 10 s while a body is shown. */
    ownDegraded: at !== null && ownDegraded(track, at),
    /** Since when the page has had no accepted answer (`performance.now()`), for the banner's minutes. */
    lastGoodAt: track.lastGoodAt,
    /** No body yet after 10 s. */
    waitingLong: !track.body && now !== null && now - startedAt >= OWN_DEGRADED_MS,
    nextAnswer,
    refresh,
  }
}
