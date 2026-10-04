'use client'

import { PlusIcon, Trash2Icon } from 'lucide-react'
import { Button } from '@cobweb/ui/components/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@cobweb/ui/components/field'
import { Input } from '@cobweb/ui/components/input'
import { Panel } from '@cobweb/ui/components/panel'
import { Progress } from '@cobweb/ui/components/progress'
import { cn } from '@cobweb/ui/lib/utils'
import { phaseNameError, PHASE_NAME_MAX, priceError, supplySplit } from '@/components/manage/phase-rules'
import { PriceInput } from '@/components/manage/price-input'
import type { SupportedChain } from '@/lib/demo/types'

/** A phase the contract starts with. Group ids follow the list order; the first is the public sale. */
export type DraftPhase = { key: string; name: string; price: string; supply: string }

/** Most phases at launch; more are added after deploy with `registerMintGroup`. */
export const MAX_LAUNCH_PHASES = 10

export function defaultPhases(maxSupply: number): DraftPhase[] {
  return [{ key: 'public', name: 'Public', price: '0', supply: String(maxSupply) }]
}

/** Each phase's problems, and the split's, for the given chain symbol. */
export function phaseErrors(phases: DraftPhase[], maxSupply: number, symbol: string) {
  const rows = phases.map((phase, index) => ({
    name: phaseNameError(
      phase.name,
      phases.filter((_, other) => other !== index).map((other) => other.name),
    ),
    price: priceError(phase.price, symbol),
    supply: /^\d+$/.test(phase.supply.trim()) ? null : 'Enter a whole number, 0 or more.',
  }))
  const split = supplySplit(
    phases.map((phase, index) => ({ id: index, maxSupply: Number(phase.supply) || 0 })),
    maxSupply,
  )
  const total =
    split.over > 0
      ? `The phases hold ${split.allocated.toLocaleString('en-US')} tokens, ${split.over.toLocaleString('en-US')} more than the supply of ${maxSupply.toLocaleString('en-US')}. Lower one.`
      : null
  return { rows, total, split, ok: !total && rows.every((row) => !row.name && !row.price && !row.supply) }
}

/**
 * The phases written into the constructor (`mintGroupMaxSupplies_`, `mintPrice_`), all closed:
 * legacy's "Supply and price" step, with its rule that allocations add up to at most the supply.
 * Opening, scheduling, the whitelist and new phases come after deploy, in Manage drop.
 */
export function DeployPhases({
  phases,
  onChange,
  maxSupply,
  chain,
  readOnly,
  showErrors,
}: {
  phases: DraftPhase[]
  onChange: (phases: DraftPhase[]) => void
  maxSupply: number
  chain: SupportedChain | null
  readOnly: boolean
  showErrors: boolean
}) {
  const symbol = chain?.nativeSymbol ?? 'ETH'
  const { rows, total, split } = phaseErrors(phases, maxSupply, symbol)
  const set = (index: number, patch: Partial<DraftPhase>) =>
    onChange(phases.map((phase, at) => (at === index ? { ...phase, ...patch } : phase)))

  return (
    <Panel
      id="deploy-phases"
      tabIndex={-1}
      title="Phases at launch"
      description="The contract starts with these, all closed. The first is the public sale; the rest are whitelist phases with quotas per address. Open, schedule and add phases in Manage drop."
    >
      <div className="grid gap-5">
        <ol className="grid gap-4">
          {phases.map((phase, index) => {
            const errors = rows[index]!
            const show = (error: string | null) => (showErrors ? error : null)
            return (
              <li key={phase.key} className="bg-surface-2/40 grid gap-4 rounded-lg border p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-muted-foreground text-[0.8125rem]">
                    {index === 0 ? 'Public' : 'Whitelist'} <span className="numeric">· Group {index}</span>
                  </p>
                  {index > 0 && !readOnly && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${phase.name || `phase ${index}`}`}
                      onClick={() => onChange(phases.filter((_, at) => at !== index))}
                    >
                      <Trash2Icon />
                    </Button>
                  )}
                </div>
                <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem_8rem]">
                  <Field data-invalid={!!show(errors.name)}>
                    <FieldLabel htmlFor={`deploy-phase-${phase.key}-name`}>Name</FieldLabel>
                    <Input
                      id={`deploy-phase-${phase.key}-name`}
                      value={phase.name}
                      maxLength={PHASE_NAME_MAX}
                      readOnly={readOnly}
                      onChange={(event) => set(index, { name: event.target.value })}
                      aria-invalid={!!show(errors.name)}
                    />
                    {show(errors.name) && <FieldError>{errors.name}</FieldError>}
                  </Field>
                  {chain ? (
                    <PriceInput
                      id={`deploy-phase-${phase.key}-price`}
                      label="Price"
                      value={phase.price}
                      onChange={(price) => set(index, { price })}
                      chain={chain}
                      error={show(errors.price)}
                      hint="0 is a free mint."
                      readOnly={readOnly}
                    />
                  ) : (
                    <Field>
                      <FieldLabel htmlFor={`deploy-phase-${phase.key}-price`}>Price</FieldLabel>
                      <Input id={`deploy-phase-${phase.key}-price`} disabled placeholder="Pick a chain" />
                    </Field>
                  )}
                  <Field data-invalid={!!show(errors.supply)}>
                    <FieldLabel htmlFor={`deploy-phase-${phase.key}-supply`}>Allocation</FieldLabel>
                    <Input
                      id={`deploy-phase-${phase.key}-supply`}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={maxSupply}
                      value={phase.supply}
                      readOnly={readOnly}
                      onChange={(event) => set(index, { supply: event.target.value })}
                      aria-invalid={!!show(errors.supply)}
                      className="numeric"
                    />
                    {show(errors.supply) && <FieldError>{errors.supply}</FieldError>}
                  </Field>
                </div>
              </li>
            )
          })}
        </ol>

        <div className="grid gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-[0.8125rem]">
            <span className="text-muted-foreground">Allocated to phases</span>
            <span className={cn('numeric', total && 'text-destructive-foreground')}>
              {split.allocated.toLocaleString('en-US')} / {maxSupply.toLocaleString('en-US')}
            </span>
          </div>
          <Progress
            size="sm"
            value={maxSupply > 0 ? Math.min(100, (split.allocated / maxSupply) * 100) : 0}
            aria-label={`${split.allocated} of ${maxSupply} allocated`}
          />
          {total ? (
            <FieldError>{total}</FieldError>
          ) : (
            <FieldDescription>
              {split.unallocated > 0
                ? `${split.unallocated.toLocaleString('en-US')} not in any phase: kept for airdrops, or given to a phase later.`
                : 'Every token is in a phase.'}
            </FieldDescription>
          )}
        </div>

        {!readOnly && (
          <Button
            type="button"
            variant="secondary"
            className="w-fit"
            disabled={phases.length >= MAX_LAUNCH_PHASES}
            onClick={() =>
              onChange([
                ...phases,
                { key: `wl-${Date.now()}`, name: '', price: '0', supply: String(split.unallocated) },
              ])
            }
          >
            <PlusIcon aria-hidden="true" />
            Add a whitelist phase
          </Button>
        )}
      </div>
    </Panel>
  )
}
