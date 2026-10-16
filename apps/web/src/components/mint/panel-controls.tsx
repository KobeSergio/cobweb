'use client'

import { CircleCheckIcon, CircleMinusIcon, MinusIcon, PlusIcon, RotateCwIcon, UsersIcon } from 'lucide-react'
import { Button } from '@cobweb/ui/components/button'
import { ChoiceCard, ChoiceCards } from '@cobweb/ui/components/choice-cards'
import { cn } from '@cobweb/ui/lib/utils'
import { formatNative, shortAddress } from '@/lib/demo/helpers'
import { useMint } from './mint-context'
import { offeredVaults, quote, type Phase } from './model'

/** Compact cards: two side by side inside the panel. */
const card = 'rounded-lg px-3.5 py-3 [&>span:first-child]:top-3.5 [&>span:first-child]:right-3.5'

/** What a phase means for this wallet, in a few words, and whether the wallet can mint from it. */
export function phaseStanding(phase: Phase, publicLimit: number): { text: string; usable: boolean | null } {
  const own = phase.wallet
  const isPublic = phase.group.kind === 'public'
  if (!own) {
    return { text: isPublic ? `Anyone, up to ${publicLimit}` : 'Whitelist, connect to check', usable: null }
  }
  const vaultLeft = phase.vaults.reduce((sum, entry) => sum + entry.remaining, 0)
  if (isPublic) {
    if (own.remaining > 0) return { text: `Anyone, up to ${own.remaining}`, usable: true }
    return vaultLeft > 0
      ? { text: `Wallet limit reached, ${vaultLeft} left through a vault`, usable: true }
      : { text: 'Wallet limit reached', usable: false }
  }
  if (own.eligible) {
    if (own.remaining > 0) return { text: `You are on this list, ${own.remaining} left`, usable: true }
    return vaultLeft > 0
      ? { text: `Your limit is used, ${vaultLeft} left through a vault`, usable: true }
      : { text: 'You are on this list, limit reached', usable: false }
  }
  if (vaultLeft > 0) return { text: `Through a vault, ${vaultLeft} left`, usable: true }
  return { text: 'Not on this list', usable: false }
}

/**
 * When phases overlap, the visitor picks which one to mint from: one card per open phase with its
 * price and what it means for this wallet. Phases the wallet cannot use stay visible, disabled,
 * with the reason. The panel opens on the cheapest phase the wallet can use (`defaultPhaseId`).
 */
export function PhasePicker({ live }: { live: Phase[] }) {
  const { phase, selectPhase, page, live: state } = useMint()
  const symbol = page.chain.nativeSymbol
  return (
    <fieldset>
      <legend className="text-sm font-semibold">Choose your phase</legend>
      <p id="phase-picker-help" className="mt-1 mb-3 text-[0.8125rem] text-muted-foreground">
        {live.length} phases are open at once. Mint from the one you belong to.
      </p>
      <ChoiceCards
        aria-describedby="phase-picker-help"
        value={phase ? String(phase.group.id) : undefined}
        onValueChange={(value: string) => selectPhase(Number(value))}
        className="gap-2"
      >
        {live.map((entry) => {
          const standing = phaseStanding(entry, state?.publicMaxMintPerWallet ?? 0)
          const Icon = standing.usable === false ? CircleMinusIcon : CircleCheckIcon
          const kind = entry.group.kind === 'public' ? 'Public sale' : 'Whitelist'
          return (
            <ChoiceCard
              key={entry.group.id}
              value={String(entry.group.id)}
              disabled={standing.usable === false}
              className={card}
              title={
                <span className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate">
                    {entry.group.name}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">{kind}</span>
                  </span>
                  <span className="numeric shrink-0 font-medium">
                    {entry.group.priceWei === '0' ? 'Free' : formatNative(entry.group.priceWei, symbol)}
                  </span>
                </span>
              }
              description={
                <span className="flex items-center gap-1.5">
                  {standing.usable !== null && (
                    <Icon
                      aria-hidden="true"
                      className={cn(
                        'size-3.5 shrink-0',
                        standing.usable ? 'text-success-foreground' : 'text-muted-foreground',
                      )}
                    />
                  )}
                  {standing.text}
                </span>
              }
            />
          )
        })}
      </ChoiceCards>
    </fieldset>
  )
}

/**
 * The connected wallet's standing in the chosen phase, in one plain sentence and a count. A wallet the list does
 * not name can ask again: its quota may have just been written on chain.
 */
export function Eligibility({ phase }: { phase: Phase }) {
  const { checkWallet } = useMint()
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
      {!isPublic && !own.eligible && (
        <Button variant="ghost" size="sm" className="shrink-0" onClick={checkWallet}>
          <RotateCwIcon />
          Check again
        </Button>
      )}
    </div>
  )
}

/**
 * Mint with a vault's allowance (delegate.xyz). The tokens still land in this wallet. A vault with nothing left in
 * this phase is not offered (`offeredVaults`); the model keeps it for its counts.
 */
export function VaultPicker({ phase }: { phase: Phase }) {
  const { vault, setVault } = useMint()
  const offered = offeredVaults(phase)
  if (offered.length === 0) return null
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
        {offered.map((entry) => (
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
  const { page, live } = useMint()
  if (!live) return null
  const symbol = page.chain.nativeSymbol
  const q = quote(live, phase.group.priceWei, quantity)
  const each = quote(live, phase.group.priceWei, 1)
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
