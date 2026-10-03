'use client'

import { ArrowDownIcon, CheckIcon, TriangleAlertIcon } from 'lucide-react'
import { Button } from '@cobweb/ui/components/button'
import type { RuleConflict } from '@/lib/demo'

const KIND_LABEL: Record<RuleConflict['kind'], string> = {
  mixing: 'Pairs with something it cannot mix with',
  isolated: 'Shut out of a whole layer',
  circular: 'Needs two traits from one layer',
}

/** The analyser's findings, above the rules, each with a way to the rules involved. */
export function ConflictsPanel({
  conflicts,
  ruleCount,
  onShow,
}: {
  conflicts: RuleConflict[]
  ruleCount: number
  onShow: (ruleIds: string[]) => void
}) {
  if (conflicts.length === 0) {
    if (ruleCount === 0) return null
    return (
      <p className="text-success-foreground flex items-center gap-2 text-sm" role="status">
        <CheckIcon aria-hidden="true" className="size-4" />
        No conflicts. Every rule can be met.
      </p>
    )
  }

  return (
    <section aria-labelledby="conflicts-heading" className="bg-destructive-soft rounded-xl p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="bg-destructive/25 text-destructive-foreground flex size-9 shrink-0 items-center justify-center rounded-md">
          <TriangleAlertIcon aria-hidden="true" className="size-[1.125rem]" />
        </span>
        <div className="min-w-0 space-y-1">
          <h3 id="conflicts-heading" className="text-heading">
            {conflicts.length === 1 ? '1 conflict' : `${conflicts.length} conflicts`} to fix before you
            generate
          </h3>
          <p className="text-foreground/80 text-sm">
            Some rules contradict each other. Until you fix them, generation keeps the first rule of each
            conflict and skips the others.
          </p>
        </div>
      </div>
      <ol className="mt-5 space-y-3">
        {conflicts.map((conflict, i) => (
          <li
            key={`${conflict.kind}-${conflict.ruleIds.join('-')}-${i}`}
            className="bg-background/40 flex flex-col gap-3 rounded-lg p-4 sm:flex-row sm:items-start sm:justify-between"
          >
            <div className="min-w-0 space-y-1">
              <p className="text-destructive-foreground text-xs font-medium">{KIND_LABEL[conflict.kind]}</p>
              <p className="text-sm leading-relaxed text-pretty">{conflict.message}</p>
            </div>
            <Button variant="outline" size="sm" className="shrink-0" onClick={() => onShow(conflict.ruleIds)}>
              <ArrowDownIcon />
              Show {conflict.ruleIds.length === 1 ? 'the rule' : `${conflict.ruleIds.length} rules`}
            </Button>
          </li>
        ))}
      </ol>
    </section>
  )
}
