import { cn } from '@cobweb/ui/lib/utils'
import { clampToSupply, type MintGroup } from '@/lib/demo'
import { count, percent } from './format'

/**
 * The collection's supply as one strip: each phase's allocation is a segment in one neutral
 * colour, filled with the accent as far as it has minted; what no phase holds is a dashed outline.
 * Every segment is labelled underneath, and a live phase says so in its label. No other shades. Airdrops use collection supply outside any
 * phase, so they can leave less mintable than the allocations add up to. With `onEdit`, each
 * phase's label opens its allocation (max supply) dialog.
 */
export function SupplyMap({
  groups,
  maxSupply,
  totalMinted,
  onEdit,
}: {
  groups: MintGroup[]
  maxSupply: number
  totalMinted: number
  onEdit?: (groupId: number) => void
}) {
  const allocated = clampToSupply(
    groups.reduce((sum, group) => sum + group.maxSupply, 0),
    maxSupply,
  )
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
              className="bg-surface-3 relative min-w-2 overflow-hidden rounded-md"
              style={{ flexGrow: Math.max(1, group.maxSupply), flexBasis: 0 }}
            >
              <span
                className="bg-primary absolute inset-y-0 left-0"
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
              {onEdit ? (
                <button
                  type="button"
                  onClick={() => onEdit(group.id)}
                  className="group/label focus-visible:ring-ring/50 block w-full min-w-0 rounded-sm text-left outline-none focus-visible:ring-[3px]"
                >
                  <SupplyLabel group={group} editable />
                </button>
              ) : (
                <SupplyLabel group={group} />
              )}
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

      <ul aria-hidden="true" className="text-muted-foreground flex flex-wrap gap-x-5 gap-y-1 text-xs">
        <li className="flex items-center gap-1.5">
          <span className="bg-primary size-2.5 rounded-xs" />
          Minted
        </li>
        <li className="flex items-center gap-1.5">
          <span className="bg-surface-3 size-2.5 rounded-xs" />
          Allocated, not minted yet
        </li>
        {unallocated > 0 && (
          <li className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-xs border border-dashed" />
            Not allocated
          </li>
        )}
      </ul>

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

/** A phase's name and minted of allocation under its segment; underlined when it opens the dialog. */
function SupplyLabel({ group, editable }: { group: MintGroup; editable?: boolean }) {
  return (
    <>
      <span
        className={cn(
          'block truncate text-[0.8125rem] font-medium',
          editable &&
            'decoration-border-strong underline underline-offset-4 group-hover/label:decoration-current',
        )}
      >
        {group.name}
      </span>
      {group.active && (
        <span className="text-muted-foreground flex items-center gap-1 text-xs">
          <span aria-hidden="true" className="bg-primary size-1.5 rounded-full" />
          Live
        </span>
      )}
      <span className="numeric text-muted-foreground block truncate text-xs">
        {count(group.minted)} / {count(group.maxSupply)}
        <span className="sr-only"> minted{editable && ', change allocation'}</span>
      </span>
    </>
  )
}
