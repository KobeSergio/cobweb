'use client'

import { CircleCheckIcon, CircleMinusIcon, MinusIcon, PlusIcon, UsersIcon } from 'lucide-react'
import { Button } from '@cobweb/ui/components/button'
import { ChoiceCard, ChoiceCards } from '@cobweb/ui/components/choice-cards'
import { cn } from '@cobweb/ui/lib/utils'
import { formatNative, shortAddress } from '@/lib/demo/helpers'
import { useMint } from './mint-context'
import { quote, type Phase } from './model'

/** Compact cards: two side by side inside the panel. */
const card = 'rounded-lg px-3.5 py-3 [&>span:first-child]:top-3.5 [&>span:first-child]:right-3.5'

/** When phases overlap, the visitor picks which one to mint from. */
export function PhasePicker({ live }: { live: Phase[] }) {
  const { phase, selectPhase, data } = useMint()
  const symbol = data.collection.chain.nativeSymbol
  return (
    <div>
      <p id="phase-picker-label" className="mb-2.5 text-[0.8125rem] text-muted-foreground">
        {live.length} phases are open at once. Mint from:
      </p>
      <ChoiceCards
        aria-labelledby="phase-picker-label"
        value={phase ? String(phase.group.id) : undefined}
        onValueChange={(value: string) => selectPhase(Number(value))}
        className="grid-cols-2 gap-2.5"
      >
        {live.map((entry) => {
          const canMint = entry.wallet ? entry.wallet.eligible && entry.wallet.remaining > 0 : null
          return (
            <ChoiceCard
              key={entry.group.id}
              value={String(entry.group.id)}
              className={card}
              title={entry.group.name}
              description={
                <>
                  <span className="numeric block">{formatNative(entry.group.priceWei, symbol)}</span>
                  {canMint !== null && (
                    <span className="mt-0.5 block text-xs">
                      {canMint
                        ? `${entry.wallet!.remaining} left for you`
                        : entry.wallet!.eligible
                          ? 'Limit reached'
                          : 'Not on the list'}
                    </span>
                  )}
                </>
              }
            />
          )
        })}
      </ChoiceCards>
    </div>
  )
}

/** The connected wallet's standing in the chosen phase, in one plain sentence and a count. */
export function Eligibility({ phase }: { phase: Phase }) {
  const own = phase.wallet
  if (!own) return null
  const isPublic = phase.group.kind === 'public'
  const ok = own.eligible && own.remaining > 0
  const Icon = ok ? CircleCheckIcon : CircleMinusIcon
  const sentence = isPublic
    ? `Open to everyone, up to ${own.quota} per wallet`
    : own.eligible
      ? `You are on the ${phase.group.name}`
      : `This wallet is not on the ${phase.group.name}`
  return (
    <div className="flex items-center gap-3 rounded-lg bg-surface-2 px-3.5 py-3">
      <Icon
        aria-hidden="true"
        className={cn('size-[1.125rem] shrink-0', ok ? 'text-success-foreground' : 'text-muted-foreground')}
      />
      <p className="min-w-0 flex-1 text-sm">{sentence}</p>
      {own.eligible && (
        <p className="numeric shrink-0 text-[0.8125rem] text-muted-foreground">
          <span className="text-foreground">{own.remaining}</span> of {own.quota} left
        </p>
      )}
    </div>
  )
}

/** Mint with a vault's allowance (delegate.xyz). The tokens still land in this wallet. */
export function VaultPicker({ phase }: { phase: Phase }) {
  const { vault, setVault } = useMint()
  if (phase.vaults.length === 0 || phase.status !== 'live') return null
  const own = phase.wallet
  return (
    <fieldset>
      <legend className="mb-2.5 flex items-center gap-2 text-[0.8125rem] text-muted-foreground">
        <UsersIcon aria-hidden="true" className="size-3.5" />
        Mint using the allowance of
      </legend>
      <ChoiceCards
        value={vault ?? 'self'}
        onValueChange={(value: string) => setVault(value === 'self' ? null : (value as `0x${string}`))}
        className="grid-cols-2 gap-2.5"
      >
        <ChoiceCard
          value="self"
          className={card}
          title="This wallet"
          description={
            <span className="numeric">{own?.eligible ? `${own.remaining} left` : 'Not on the list'}</span>
          }
        />
        {phase.vaults.map((entry) => (
          <ChoiceCard
            key={entry.vault}
            value={entry.vault}
            className={card}
            title={
              <>
                Vault <span className="numeric font-medium">{shortAddress(entry.vault)}</span>
              </>
            }
            description={<span className="numeric">{entry.remaining} left</span>}
          />
        ))}
      </ChoiceCards>
      {vault && (
        <p className="mt-2.5 text-[0.8125rem] leading-snug text-muted-foreground">
          The vault delegated to this wallet, so you can use its spots without connecting it. You pay, and the
          tokens land in this wallet.
        </p>
      )}
    </fieldset>
  )
}

export function QuantityStepper() {
  const { quantity, setQuantity, maxQuantity } = useMint()
  const max = Math.max(1, maxQuantity)
  return (
    <div className="flex items-center justify-between gap-4">
      <p id="quantity-label" className="text-sm font-medium">
        Quantity
        <span className="ml-2 text-[0.8125rem] font-normal text-muted-foreground">
          up to <span className="numeric">{maxQuantity}</span>
        </span>
      </p>
      <div
        role="group"
        aria-labelledby="quantity-label"
        className="flex items-center gap-1 rounded-md bg-well p-1 shadow-inset"
      >
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="One fewer"
          disabled={quantity <= 1}
          onClick={() => setQuantity(quantity - 1)}
        >
          <MinusIcon />
        </Button>
        <output
          aria-live="polite"
          aria-label={`Quantity ${quantity}`}
          className="numeric w-9 text-center text-lg font-medium"
        >
          {quantity}
        </output>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="One more"
          disabled={quantity >= max}
          onClick={() => setQuantity(quantity + 1)}
        >
          <PlusIcon />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="px-2.5"
          disabled={quantity >= max}
          onClick={() => setQuantity(max)}
        >
          Max
        </Button>
      </div>
    </div>
  )
}

/** Price and platform fee, itemised, so the total in the wallet is never a surprise. */
export function PriceBreakdown({ phase, quantity }: { phase: Phase; quantity: number }) {
  const { data } = useMint()
  const symbol = data.collection.chain.nativeSymbol
  const q = quote(data, phase.group.priceWei, quantity)
  const each = quote(data, phase.group.priceWei, 1)
  const rows = [
    {
      label: `${quantity} × ${formatNative(each.priceWei, symbol)}`,
      sub: phase.group.priceWei === '0' ? 'Free mint' : 'Mint price',
      value: formatNative(q.priceWei, symbol),
    },
    {
      label: `${quantity} × ${formatNative(each.feeWei, symbol)}`,
      sub: 'Platform fee',
      value: formatNative(q.feeWei, symbol),
    },
  ]
  return (
    <div className="text-[0.8125rem]">
      <dl className="space-y-1.5">
        {rows.map((row) => (
          <div key={row.sub} className="flex items-baseline justify-between gap-3">
            <dt className="text-muted-foreground">
              {row.sub} <span className="numeric ml-1 text-xs">{row.label}</span>
            </dt>
            <dd className="numeric text-foreground/90">{row.value}</dd>
          </div>
        ))}
        <div className="mt-2.5 flex items-baseline justify-between gap-3 border-t pt-2.5">
          <dt className="text-sm font-medium">
            Total <span className="ml-1 text-xs font-normal text-muted-foreground">plus network gas</span>
          </dt>
          <dd className="numeric text-lg font-medium">{formatNative(q.totalWei, symbol)}</dd>
        </div>
      </dl>
    </div>
  )
}
