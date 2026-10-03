import { cn } from '@cobweb/ui/lib/utils'
import type { MintGroup } from '@/lib/demo'
import { count, percent } from './format'

/**
 * The collection's supply as one strip: each phase's allocation is a segment, filled as far as
 * it has minted; what no phase holds is left empty. Airdrops use collection supply outside any
 * phase, so they can leave less mintable than the allocations add up to.
 */
export function SupplyMap({
  groups,
  maxSupply,
  totalMinted,
}: {
  groups: MintGroup[]
  maxSupply: number
  totalMinted: number
}) {
  const allocated = groups.reduce((sum, group) => sum + group.maxSupply, 0)
  const phaseMinted = groups.reduce((sum, group) => sum + group.minted, 0)
  const airdropped = Math.max(0, totalMinted - phaseMinted)
  const unallocated = Math.max(0, maxSupply - allocated)
  const collectionLeft = Math.max(0, maxSupply - totalMinted)
  const phasesLeft = groups.reduce((sum, group) => sum + Math.max(0, group.maxSupply - group.minted), 0)
  const mintable = Math.min(collectionLeft, phasesLeft)

  return (
    <div className="grid gap-4">
      {/* The strip and its labels share one flex layout, so each label sits under its segment. */}
      <div className="grid gap-2">
        <div aria-hidden="true" className="flex h-9 gap-1">
          {groups.map((group) => (
            <div
              key={group.id}
              className={cn(
                'bg-well shadow-inset relative min-w-2 overflow-hidden rounded-md border',
                group.active ? 'border-primary-line' : 'border-border-strong',
              )}
              style={{ flexGrow: Math.max(1, group.maxSupply), flexBasis: 0 }}
            >
              <span
                className={cn('absolute inset-y-0 left-0', group.active ? 'bg-primary' : 'bg-primary/45')}
                style={{ width: `${percent(group.minted, group.maxSupply)}%` }}
              />
            </div>
          ))}
          {unallocated > 0 && (
            <div
              className="min-w-2 rounded-md border border-dashed"
              style={{ flexGrow: unallocated, flexBasis: 0 }}
            />
          )}
        </div>
        <ul aria-label="Supply by phase" className="flex gap-1">
          {groups.map((group) => (
            <li
              key={group.id}
              className="min-w-2 overflow-hidden"
              style={{ flexGrow: Math.max(1, group.maxSupply), flexBasis: 0 }}
              title={`${group.name}: ${count(group.minted)} of ${count(group.maxSupply)} minted`}
            >
              <p className="truncate text-[0.8125rem] font-medium">{group.name}</p>
              <p className="numeric text-muted-foreground truncate text-xs">
                <span className={cn(group.active && 'text-primary')}>{count(group.minted)}</span> /{' '}
                {count(group.maxSupply)}
                <span className="sr-only"> minted</span>
              </p>
            </li>
          ))}
          {unallocated > 0 && (
            <li
              className="min-w-2 overflow-hidden"
              style={{ flexGrow: unallocated, flexBasis: 0 }}
              title={`${count(unallocated)} not allocated`}
            >
              <p className="text-muted-foreground truncate text-[0.8125rem]">Not allocated</p>
              <p className="numeric text-muted-foreground truncate text-xs">{count(unallocated)}</p>
            </li>
          )}
        </ul>
      </div>

      <dl className="flex flex-wrap gap-x-8 gap-y-3 text-[0.8125rem]">
        <div>
          <dt className="text-muted-foreground">Allocated to phases</dt>
          <dd className="numeric text-base">
            {count(allocated)} <span className="text-muted-foreground text-sm">/ {count(maxSupply)}</span>
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Not allocated</dt>
          <dd className="numeric text-base">{count(unallocated)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Airdropped</dt>
          <dd className="numeric text-base">{count(airdropped)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Still mintable</dt>
          <dd className="numeric text-base">{count(mintable)}</dd>
        </div>
      </dl>
      {airdropped > 0 && mintable < phasesLeft && (
        <p className="text-muted-foreground text-[0.8125rem]">
          Airdrops used {count(airdropped)} tokens of collection supply, so the phases can mint{' '}
          <span className="numeric">{count(mintable)}</span> more, not the{' '}
          <span className="numeric">{count(phasesLeft)}</span> their allocations leave.
        </p>
      )}
    </div>
  )
}
