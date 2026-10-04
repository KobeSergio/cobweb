'use client'

import { ArrowRightIcon, TriangleAlertIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Badge } from '@cobweb/ui/components/badge'
import { Button } from '@cobweb/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@cobweb/ui/components/dialog'
import type { RuleConflict } from '@/lib/demo'
import type { FlowLink } from '@/lib/steps'

const KIND_LABEL: Record<RuleConflict['kind'], string> = {
  mixing: 'Pairs with something it cannot mix with',
  isolated: 'Shut out of a whole layer',
  circular: 'Needs two traits from one layer',
}

function conflictCount(count: number) {
  return count === 1 ? '1 conflict' : `${count.toLocaleString('en-US')} conflicts`
}

/**
 * The rules conflict warning for the Rules footer: a red chip beside "Continue to Generate" that
 * opens a small dialog listing each conflict, and a Continue that opens the same dialog first.
 * Continuing from the dialog goes on anyway, since generation skips the conflicting rule.
 *
 * Renders only while there are conflicts; the footer shows its plain Continue otherwise.
 */
export function ConflictWarning({
  conflicts,
  next,
  whereOf,
  onShow,
}: {
  conflicts: RuleConflict[]
  next?: FlowLink
  /** The collection a conflict is in, when the project has several; shown before its message. */
  whereOf: (conflict: RuleConflict) => string | undefined
  /** Shows the rules of a conflict in the list. */
  onShow: (ruleIds: string[]) => void
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  if (conflicts.length === 0) return null
  const label = conflictCount(conflicts.length)

  return (
    <>
      <Badge
        variant="destructive"
        asChild
        className="hover:bg-destructive/25 h-8 cursor-pointer px-3 text-[0.8125rem]"
      >
        <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog">
          <TriangleAlertIcon aria-hidden="true" className="size-3.5!" />
          {label}
        </button>
      </Badge>
      {next && (
        <Button onClick={() => setOpen(true)} aria-haspopup="dialog">
          Continue to {next.name}
          <ArrowRightIcon />
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{label} in your rules</DialogTitle>
            <DialogDescription>
              These rules contradict each other. Generation keeps the first rule of each conflict and skips
              the others, so you can continue, but the skipped rules will not apply.
            </DialogDescription>
          </DialogHeader>
          <ol className="space-y-3">
            {conflicts.map((conflict, i) => {
              const where = whereOf(conflict)
              return (
                <li
                  key={`${conflict.kind}-${conflict.ruleIds.join('-')}-${i}`}
                  className="bg-destructive-soft space-y-2 rounded-lg p-4"
                >
                  <p className="text-destructive-foreground text-xs font-medium">
                    {where ? `${where}: ` : ''}
                    {KIND_LABEL[conflict.kind]}
                  </p>
                  <p className="text-sm leading-relaxed text-pretty">{conflict.message}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setOpen(false)
                      onShow(conflict.ruleIds)
                    }}
                  >
                    Show {conflict.ruleIds.length === 1 ? 'the rule' : `the ${conflict.ruleIds.length} rules`}
                  </Button>
                </li>
              )
            })}
          </ol>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Keep editing
            </Button>
            {next && (
              <Button
                onClick={() => {
                  setOpen(false)
                  router.push(next.href)
                }}
              >
                Continue anyway
                <ArrowRightIcon />
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
