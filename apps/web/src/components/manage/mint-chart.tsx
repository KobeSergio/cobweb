'use client'

import { useState } from 'react'
import { cn } from '@cobweb/ui/lib/utils'
import { count, shortUtc } from './format'

/**
 * Mints per hour as bars, oldest on the left. Hover or focus a bar to read it; the readout
 * above the chart otherwise shows the window's total and its busiest hour. A hidden table
 * carries the same numbers for screen readers.
 */
export function MintChart({
  buckets,
  live = false,
}: {
  buckets: { at: number; count: number }[]
  /** A phase is live now (from the chain), so the current hour is drawn in the accent. */
  live?: boolean
}) {
  const [active, setActive] = useState<number | null>(null)
  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0)
  const peakIndex = buckets.reduce(
    (best, bucket, index) => (bucket.count > buckets[best]!.count ? index : best),
    0,
  )
  const peak = buckets[peakIndex]?.count ?? 0
  // A rounded top for the scale, so the gridlines land on tidy numbers.
  const step = peak <= 10 ? 5 : peak <= 50 ? 10 : peak <= 200 ? 50 : 100
  const top = Math.max(step, Math.ceil(peak / step) * step)
  const shown = active !== null ? buckets[active] : null
  const hours = buckets.length

  if (total === 0) {
    return (
      <div className="bg-well text-muted-foreground flex h-48 items-center justify-center rounded-lg text-sm">
        No mints in the last {hours} hours.
      </div>
    )
  }

  return (
    <figure className="grid gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1" aria-live="polite">
        {shown ? (
          <>
            <p className="numeric text-2xl">
              {count(shown.count)}
              <span className="text-muted-foreground ml-1.5 text-sm">mints</span>
            </p>
            <p className="numeric text-muted-foreground text-sm">
              {shortUtc(shown.at)} to {shortUtc(shown.at + 3600).split(', ')[1]}
            </p>
          </>
        ) : (
          <>
            <p className="numeric text-2xl">
              {count(total)}
              <span className="text-muted-foreground ml-1.5 text-sm">mints in {hours} hours</span>
            </p>
            <p className="text-muted-foreground text-sm">
              Busiest hour <span className="numeric text-foreground">{count(peak)}</span> at{' '}
              <span className="numeric">{shortUtc(buckets[peakIndex]!.at)}</span>
            </p>
          </>
        )}
      </div>

      <div className="relative" aria-hidden="true">
        {/* Gridlines with their values on the right. */}
        <div className="pointer-events-none absolute inset-0 right-8 flex flex-col justify-between">
          {[top, top / 2, 0].map((value) => (
            <div key={value} className="relative border-t border-dashed first:border-solid last:border-solid">
              <span className="numeric text-muted-foreground absolute -top-2 -right-8 w-7 text-right text-[0.6875rem]">
                {value}
              </span>
            </div>
          ))}
        </div>
        <div className="relative mr-8 flex h-44 items-end gap-[2px]" onMouseLeave={() => setActive(null)}>
          {buckets.map((bucket, index) => {
            const isPeak = index === peakIndex
            const isNow = live && index === buckets.length - 1
            return (
              <div
                key={bucket.at}
                onMouseEnter={() => setActive(index)}
                className="group relative flex h-full flex-1 items-end"
              >
                {isPeak && (
                  <span
                    className="numeric text-foreground absolute left-1/2 -translate-x-1/2 text-[0.6875rem] whitespace-nowrap"
                    style={{ bottom: `calc(${Math.max(2, (bucket.count / top) * 100)}% + 4px)` }}
                  >
                    {count(bucket.count)}
                  </span>
                )}
                <div
                  className={cn(
                    'w-full rounded-t-[2px] transition-colors duration-150',
                    bucket.count === 0
                      ? 'bg-surface-3 h-px'
                      : isNow
                        ? 'bg-primary'
                        : isPeak
                          ? 'bg-foreground'
                          : 'bg-muted-foreground/35 group-hover:bg-muted-foreground',
                    active === index && !isNow && 'bg-foreground',
                  )}
                  style={
                    bucket.count === 0 ? undefined : { height: `${Math.max(2, (bucket.count / top) * 100)}%` }
                  }
                />
              </div>
            )
          })}
        </div>
      </div>

      <figcaption className="numeric text-muted-foreground mr-8 flex justify-between text-[0.6875rem]">
        <span>{hours}h ago</span>
        <span>{hours / 2}h ago</span>
        <span className="flex items-center gap-1.5">
          {live && <span aria-hidden="true" className="bg-primary size-1.5 rounded-full" />}
          {live ? 'This hour, live' : 'Now'}
        </span>
      </figcaption>

      <table className="sr-only">
        <caption>Mints per hour, last {hours} hours</caption>
        <thead>
          <tr>
            <th scope="col">Hour starting</th>
            <th scope="col">Mints</th>
          </tr>
        </thead>
        <tbody>
          {buckets
            .filter((bucket) => bucket.count > 0)
            .map((bucket) => (
              <tr key={bucket.at}>
                <td>{shortUtc(bucket.at)}</td>
                <td>{bucket.count}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </figure>
  )
}
