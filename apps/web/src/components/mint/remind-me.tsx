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
import { googleCalendarUrl, icsFileName, icsOf, type Reminder } from '@/lib/mint/remind'
import { useMint } from './mint-context'
import type { Phase } from './model'

/**
 * "Remind me" for a phase scheduled ahead on the chain clock (docs/specs/2026-10-16-mint-page-live-data.md,
 * decision 25): a Google Calendar link and a calendar file built in the browser, at the group's start in UTC.
 * Nothing is stored.
 */
export function RemindMe({ phase, className }: { phase: Phase; className?: string }) {
  const { page } = useMint()
  if (phase.status !== 'scheduled' || phase.group.scheduledStart <= 0) return null
  const reminder = (): Reminder => ({
    collection: page.name,
    phase: phase.group.name,
    chainId: page.chain.id,
    contract: page.contract,
    groupId: phase.group.id,
    start: phase.group.scheduledStart,
    url: `${window.location.origin}/${page.slug}`,
  })
  const download = () => {
    const file = new Blob([icsOf(reminder(), Math.floor(Date.now() / 1_000))], { type: 'text/calendar' })
    const url = URL.createObjectURL(file)
    const link = document.createElement('a')
    link.href = url
    link.download = icsFileName(page.slug, phase.group.id)
    link.click()
    URL.revokeObjectURL(url)
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
        <DropdownMenuItem asChild>
          <a href={googleCalendarUrl(reminder())} target="_blank" rel="noreferrer">
            <CalendarPlusIcon />
            Google Calendar
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={download}>
          <DownloadIcon />
          Download a calendar file
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
