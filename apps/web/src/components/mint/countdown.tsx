'use client'

import { cn } from '@cobweb/ui/lib/utils'
import { countdownParts } from './format'

const pad = (value: number) => value.toString().padStart(2, '0')

/**
 * The big countdown for an upcoming phase. Digits are tabular so nothing shifts as they tick.
 * The live region is off: a screen reader is told the start time once, not every second.
 */
export function Countdown({ seconds, className }: { seconds: number; className?: string }) {
  const { days, hours, minutes, seconds: secs } = countdownParts(seconds)
  const units = [
    ...(days > 0 ? [{ value: days.toString(), label: days === 1 ? 'day' : 'days' }] : []),
    { value: pad(hours), label: 'hours' },
    { value: pad(minutes), label: 'min' },
    { value: pad(secs), label: 'sec' },
  ]
  return (
    <div className={cn('flex items-start gap-1.5 sm:gap-2', className)} aria-hidden="true">
      {units.map((unit, index) => (
        <div key={unit.label} className="flex items-start gap-1.5 sm:gap-2">
          {index > 0 && <span className="numeric pt-1 text-[2rem] leading-none text-faint">:</span>}
          <div className="flex flex-col items-center">
            <span className="numeric min-w-[2.4ch] rounded-lg bg-well px-2 py-2.5 text-center text-[2.25rem] leading-none font-medium text-foreground shadow-inset sm:text-[2.5rem]">
              {unit.value}
            </span>
            <span className="mt-1.5 text-xs text-muted-foreground">{unit.label}</span>
          </div>
        </div>
      ))}
    </div>
  )
}
