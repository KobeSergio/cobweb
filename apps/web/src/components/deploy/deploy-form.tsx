'use client'

import { sampleSupply, DEMO_COLLECTION } from '@/lib/demo'
import { LockIcon, WalletIcon } from 'lucide-react'
import { isAddress } from 'viem'
import { Badge } from '@cobweb/ui/components/badge'
import { ChoiceCard, ChoiceCards } from '@cobweb/ui/components/choice-cards'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@cobweb/ui/components/field'
import { Input } from '@cobweb/ui/components/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from '@cobweb/ui/components/input-group'
import { Panel } from '@cobweb/ui/components/panel'
import { Slider } from '@cobweb/ui/components/slider'
import { Switch } from '@cobweb/ui/components/switch'
import { ChainIcon, ChainName } from '@/components/chains/chain-icon'
import { MintPageAddressField } from '@/components/collections/mint-page-address-field'
import type { Tables } from '@/lib/database.types'
import type { Address } from '@/lib/demo/types'
import type { DeployChain } from '@/lib/deploy/deploy-types'

export type DeployFormValues = {
  chainId: number | null
  payout: string
  /** Percent as typed, 0 to 10. */
  royalty: string
  sameReceiver: boolean
  royaltyReceiver: string
  publicCap: string
}

export type DeployFormErrors = Partial<
  Record<'chainId' | 'payout' | 'royalty' | 'royaltyReceiver' | 'publicCap' | 'phases', string>
>

export const MAX_ROYALTY_PERCENT = 10

/**
 * Percent text to basis points, or null when it is not a number in range. At most two decimals:
 * the contract takes whole basis points, so 2.555% would be silently rounded.
 */
export function royaltyBps(royalty: string): number | null {
  const trimmed = royalty.trim()
  const value = Number(trimmed)
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed) || value > MAX_ROYALTY_PERCENT) return null
  return Math.round(value * 100)
}

const ZERO_ADDRESS = /^0x0{40}$/i

export function validateDeploy(values: DeployFormValues, maxSupply: number): DeployFormErrors {
  const errors: DeployFormErrors = {}
  if (values.chainId === null) errors.chainId = 'Choose a chain to deploy on.'
  if (!isAddress(values.payout))
    errors.payout = 'Enter a valid wallet address (0x followed by 40 characters).'
  else if (ZERO_ADDRESS.test(values.payout)) errors.payout = 'The zero address cannot receive proceeds.'
  if (royaltyBps(values.royalty) === null)
    errors.royalty = `Enter a royalty from 0 to ${MAX_ROYALTY_PERCENT}%, with up to two decimals.`
  if (!values.sameReceiver && !isAddress(values.royaltyReceiver))
    errors.royaltyReceiver = 'Enter a valid wallet address for royalties.'
  else if (!values.sameReceiver && ZERO_ADDRESS.test(values.royaltyReceiver))
    errors.royaltyReceiver = 'The zero address cannot receive royalties.'
  const cap = Number(values.publicCap)
  if (!Number.isInteger(cap) || cap < 1 || cap > maxSupply)
    errors.publicCap = `Enter a whole number from 1 to ${maxSupply.toLocaleString('en-US')}.`
  return errors
}

/** Chain picker and contract settings, the left column of Deploy. */
export function DeployForm({
  collection,
  chains,
  fixedChainId,
  walletAddress,
  walletChainId,
  values,
  errors,
  readOnly,
  onChange,
  onAddressSaved,
}: {
  collection: Tables<'collections'>
  chains: DeployChain[]
  /** The chain the fee was paid on: one card, no picker (docs/specs/2026-10-14-deploy.md, section 7.2). */
  fixedChainId: number | null
  walletAddress: Address
  walletChainId: number | undefined
  values: DeployFormValues
  /** Only the errors to show now (after the field was touched or a deploy was attempted). */
  errors: DeployFormErrors
  readOnly: boolean
  onChange: (patch: Partial<DeployFormValues>) => void
  onAddressSaved: (value: { slug: string; slug_reserved_at: string | null }) => void
}) {
  const walletChain = chains.find((chain) => chain.id === walletChainId)
  const fixedChain =
    fixedChainId === null ? null : (chains.find((chain) => chain.id === fixedChainId) ?? null)

  return (
    <div className="space-y-8">
      {fixedChain ? (
        <Panel
          title="Chain"
          description="The art fee was paid on this chain, so the contract goes here. Your wallet switches to it when you deploy."
        >
          <div className="bg-surface-2/40 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
            <span className="flex items-center gap-3">
              <ChainIcon chainId={fixedChain.id} className="size-6" />
              <span className="font-medium">{fixedChain.name}</span>
              <span className="text-muted-foreground text-[0.8125rem]">
                Pays in <span className="numeric">{fixedChain.nativeSymbol}</span>
              </span>
            </span>
            {walletChainId === fixedChain.id ? (
              <Badge variant="secondary" className="font-medium">
                Connected
              </Badge>
            ) : (
              <span className="text-muted-foreground text-[0.8125rem]">Switch to {fixedChain.name}</span>
            )}
          </div>
        </Panel>
      ) : (
        <Panel
          title="Chain"
          description={
            walletChain ? (
              <>
                Your wallet is on{' '}
                <ChainName chain={walletChain} className="text-foreground" iconClassName="size-3.5" />. If you
                pick another chain, it asks to switch when you deploy.
              </>
            ) : (
              'Your wallet asks to switch to the chain you pick when you deploy.'
            )
          }
        >
          <ChoiceCards
            aria-label="Chain"
            aria-invalid={!!errors.chainId}
            aria-describedby={errors.chainId ? 'deploy-chain-error' : undefined}
            value={values.chainId === null ? '' : String(values.chainId)}
            onValueChange={(value) => onChange({ chainId: Number(value) })}
            disabled={readOnly}
            className="sm:grid-cols-2 xl:grid-cols-3"
          >
            {chains.map((chain) => (
              <ChoiceCard
                key={chain.id}
                value={String(chain.id)}
                icon={<ChainIcon chainId={chain.id} className="size-5" />}
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    {chain.name}
                    {chain.id === walletChainId && (
                      <Badge variant="secondary" className="font-medium">
                        Connected
                      </Badge>
                    )}
                  </span>
                }
                description={
                  <>
                    Pays in <span className="numeric">{chain.nativeSymbol}</span>
                  </>
                }
              />
            ))}
          </ChoiceCards>
          <FieldError id="deploy-chain-error" className="mt-3">
            {errors.chainId}
          </FieldError>
        </Panel>
      )}

      <Panel title="Contract settings" description="Written into the contract when it is created.">
        <FieldGroup className="gap-7">
          <div className="grid gap-4 sm:grid-cols-[1fr_10rem_10rem]">
            <ReadOnlyField id="deploy-name" label="Name" value={collection.name} />
            <ReadOnlyField id="deploy-symbol" label="Symbol" value={collection.symbol} mono />
            <ReadOnlyField
              id="deploy-supply"
              label="Max supply"
              value={sampleSupply(collection.max_supply, DEMO_COLLECTION.maxSupply).toLocaleString('en-US')}
              mono
            />
          </div>
          <FieldDescription className="-mt-4 flex items-center gap-1.5">
            <LockIcon aria-hidden="true" className="size-3.5 shrink-0" />
            Name and symbol were fixed when the art was locked, and the supply comes from the art. The
            contract takes them as they are.
          </FieldDescription>

          <AddressField
            id="deploy-payout"
            label="Payout address"
            help="Mint proceeds are withdrawn to this address. Defaults to your wallet; you can change it later."
            value={values.payout}
            error={errors.payout}
            readOnly={readOnly}
            onChange={(payout) => onChange({ payout })}
            onUseWallet={() => onChange({ payout: walletAddress })}
            isWallet={values.payout.toLowerCase() === walletAddress.toLowerCase()}
          />

          <Field data-invalid={!!errors.royalty}>
            <FieldLabel htmlFor="deploy-royalty">Royalty</FieldLabel>
            <div className="flex items-center gap-5">
              <Slider
                aria-label="Royalty percentage"
                min={0}
                max={MAX_ROYALTY_PERCENT}
                step={0.5}
                value={[Math.min(MAX_ROYALTY_PERCENT, Math.max(0, Number(values.royalty) || 0))]}
                onValueChange={([value]) => onChange({ royalty: String(value) })}
                disabled={readOnly}
                className="flex-1"
              />
              <InputGroup className="w-28 shrink-0">
                <InputGroupInput
                  id="deploy-royalty"
                  inputMode="decimal"
                  value={values.royalty}
                  onChange={(event) => onChange({ royalty: event.target.value.replace(/[^0-9.]/g, '') })}
                  readOnly={readOnly}
                  aria-invalid={!!errors.royalty}
                  aria-describedby={errors.royalty ? 'deploy-royalty-error' : 'deploy-royalty-help'}
                  className="numeric text-right"
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupText>%</InputGroupText>
                </InputGroupAddon>
              </InputGroup>
            </div>
            {errors.royalty ? (
              <FieldError id="deploy-royalty-error">{errors.royalty}</FieldError>
            ) : (
              <FieldDescription id="deploy-royalty-help">
                Of each resale, enforced on secondary sales through the transfer validator. 0 to{' '}
                {MAX_ROYALTY_PERCENT}%. That is{' '}
                <span className="numeric text-foreground/85">
                  {(royaltyBps(values.royalty) ?? 0).toLocaleString('en-US')} bps
                </span>{' '}
                on chain.
              </FieldDescription>
            )}
          </Field>

          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <label htmlFor="deploy-same-receiver" className="text-sm font-medium">
                Send royalties to the payout address
              </label>
              <Switch
                id="deploy-same-receiver"
                checked={values.sameReceiver}
                onCheckedChange={(sameReceiver) => onChange({ sameReceiver })}
                disabled={readOnly}
              />
            </div>
            {!values.sameReceiver && (
              <AddressField
                id="deploy-royalty-receiver"
                label="Royalty recipient"
                help="Marketplaces pay royalties to this address."
                value={values.royaltyReceiver}
                error={errors.royaltyReceiver}
                readOnly={readOnly}
                onChange={(royaltyReceiver) => onChange({ royaltyReceiver })}
                onUseWallet={() => onChange({ royaltyReceiver: walletAddress })}
                isWallet={values.royaltyReceiver.toLowerCase() === walletAddress.toLowerCase()}
              />
            )}
          </div>

          <Field data-invalid={!!errors.publicCap} className="sm:max-w-56">
            <FieldLabel htmlFor="deploy-cap">Public mint limit per wallet</FieldLabel>
            <Input
              id="deploy-cap"
              type="number"
              inputMode="numeric"
              min={1}
              max={sampleSupply(collection.max_supply, DEMO_COLLECTION.maxSupply) || undefined}
              value={values.publicCap}
              onChange={(event) => onChange({ publicCap: event.target.value })}
              readOnly={readOnly}
              aria-invalid={!!errors.publicCap}
              aria-describedby={errors.publicCap ? 'deploy-cap-error' : 'deploy-cap-help'}
            />
            {errors.publicCap ? (
              <FieldError id="deploy-cap-error">{errors.publicCap}</FieldError>
            ) : (
              <FieldDescription id="deploy-cap-help">
                For the public sale. You can change it later.
              </FieldDescription>
            )}
          </Field>
        </FieldGroup>
      </Panel>

      <Panel
        title="Mint page link"
        description="Required. Collectors mint at this link. Reserve it before you deploy."
      >
        <MintPageAddressField collection={collection} readOnly={readOnly} onSaved={onAddressSaved} />
      </Panel>
    </div>
  )
}

function ReadOnlyField({
  id,
  label,
  value,
  mono,
}: {
  id: string
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <Field data-disabled>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input id={id} value={value} readOnly className={mono ? 'numeric' : undefined} />
    </Field>
  )
}

function AddressField({
  id,
  label,
  help,
  value,
  error,
  readOnly,
  isWallet,
  onChange,
  onUseWallet,
}: {
  id: string
  label: string
  help: string
  value: string
  error?: string
  readOnly: boolean
  isWallet: boolean
  onChange: (value: string) => void
  onUseWallet: () => void
}) {
  return (
    <Field data-invalid={!!error}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <InputGroup>
        <InputGroupInput
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value.trim())}
          placeholder="0x..."
          spellCheck={false}
          autoComplete="off"
          readOnly={readOnly}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : `${id}-help`}
          className="numeric"
        />
        {!readOnly && !isWallet && (
          <InputGroupAddon align="inline-end">
            <InputGroupButton onClick={onUseWallet}>
              <WalletIcon />
              Use my wallet
            </InputGroupButton>
          </InputGroupAddon>
        )}
      </InputGroup>
      {error ? (
        <FieldError id={`${id}-error`}>{error}</FieldError>
      ) : (
        <FieldDescription id={`${id}-help`}>
          {isWallet ? `${help} This is your wallet.` : help}
        </FieldDescription>
      )}
    </Field>
  )
}
