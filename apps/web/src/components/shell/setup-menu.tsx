'use client'

import { CheckIcon, ChevronDownIcon, HistoryIcon, LayoutDashboardIcon } from 'lucide-react'
import Link from 'next/link'
import { useSelectedLayoutSegments } from 'next/navigation'
import { Button } from '@cobweb/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@cobweb/ui/components/dropdown-menu'
import { cn } from '@cobweb/ui/lib/utils'
import {
  isDeployed,
  manageTabHref,
  stageHref,
  STAGES,
  type CollectionStatus,
  type ProjectType,
} from '@/lib/steps'

type Props = {
  collectionId: string
  status: CollectionStatus
  projectType: ProjectType
  /** Sample-data mode: Manage drop is open before deploy, so the top bar links to it. */
  demo: boolean
}

/**
 * The top bar's way between Manage drop and Setup. A deployed collection has no stepper, so the
 * four build stages are reached from this menu, as read-only history. In sample mode a collection
 * that is not deployed gets a plain link to Manage drop instead, since every route is open.
 */
export function SetupMenu({ collectionId, status, projectType, demo }: Props) {
  const [segment] = useSelectedLayoutSegments()
  const onManage = segment === 'manage'

  if (!isDeployed(status)) {
    if (!demo || onManage) return null
    return (
      <Button asChild variant="ghost" size="sm">
        <Link href={manageTabHref(collectionId, 'overview')}>
          <LayoutDashboardIcon />
          Manage drop
        </Link>
      </Button>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={onManage ? 'ghost' : 'secondary'} size="sm">
          <HistoryIcon />
          Setup
          <ChevronDownIcon className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-muted-foreground text-xs font-medium">
          Setup, for reference
        </DropdownMenuLabel>
        {STAGES.map((stage) => {
          const current = stage.slug === segment
          return (
            <DropdownMenuItem key={stage.slug} asChild>
              <Link
                href={stageHref(collectionId, stage.slug, projectType)}
                aria-current={current ? 'page' : undefined}
                className={cn(current && 'bg-surface-3 text-foreground')}
              >
                <CheckIcon aria-hidden="true" className="text-primary" />
                {stage.name}
                <span className="sr-only"> (done)</span>
              </Link>
            </DropdownMenuItem>
          )
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={manageTabHref(collectionId, 'overview')} aria-current={onManage ? 'page' : undefined}>
            <LayoutDashboardIcon aria-hidden="true" />
            Manage drop
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
