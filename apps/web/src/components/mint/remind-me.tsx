'use client'

import { BellIcon, CalendarPlusIcon, DownloadIcon } from 'lucide-react'
import { Button } from '@cobweb/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@cobweb/ui/components/dropdown-menu'
import { cn } from '@cobweb/ui/lib/utils'
import { googleCalendarUrl, icsFileName, icsOf, reminderAllowed, type Reminder } from '@/lib/mint/remind'
import { useMint } from './mint-context'
import type { Phase } from './model'

/** How long the calendar file's object URL lives after the click, so the browser has started reading it. */
const REVOKE_AFTER_MS = 5_000

/**
 * "Remind me" for a phase scheduled ahead on the chain clock (docs/specs/2026-10-16-mint-page-live-data.md,
 * decision 25): a Google Calendar link and a calendar file built in the browser, at the group's start in UTC.
 * Nothing is stored. A start no calendar can name (past the end of the year 9999, which the chain's
 * `uint256` allows) offers nothing. Both items are built when chosen, never while rendering: the link needs
 * the browser's origin, and the dates are formatted only for a start that passed the guard.
 */
export function RemindMe({ phase, className }: { phase: Phase; className?: string }) {
  const { page } = useMint()
  if (phase.status !== 'scheduled' || !reminderAllowed(phase.group.scheduledStart)) return null
  const reminder = (): Reminder => ({
    collection: page.name,
    phase: phase.group.name,
    chainId: page.chain.id,
    contract: page.contract,
    groupId: phase.group.id,
    start: phase.group.scheduledStart,
    url: `${window.location.origin}/${page.slug}`,
  })
  const openGoogle = () => {
    window.open(googleCalendarUrl(reminder()), '_blank', 'noreferrer')
  }
  const download = () => {
    const file = new Blob([icsOf(reminder(), Math.floor(Date.now() / 1_000))], { type: 'text/calendar' })
    const url = URL.createObjectURL(file)
    const link = document.createElement('a')
    link.href = url
    link.download = icsFileName(page.slug, phase.group.id)
    link.click()
    // Not in the same tick: the browser reads the object URL after the click returns.
    window.setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS)
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className={cn('w-fit', className)}>
          <BellIcon />
          Remind me
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onSelect={openGoogle}>
          <CalendarPlusIcon />
          Google Calendar
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={download}>
          <DownloadIcon />
          Download a calendar file
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
