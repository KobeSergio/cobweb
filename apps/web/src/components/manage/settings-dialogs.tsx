'use client'

import { TriangleAlertIcon } from 'lucide-react'
import { useId, useState } from 'react'
import { getAddress, isAddress, type Hex } from 'viem'
import { Alert, AlertDescription, AlertTitle } from '@cobweb/ui/components/alert'
import { Field, FieldDescription, FieldError, FieldLabel } from '@cobweb/ui/components/field'
import { Input } from '@cobweb/ui/components/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '@cobweb/ui/components/input-group'
import { RadioGroup, RadioGroupItem } from '@cobweb/ui/components/radio-group'
// Royalty limits are Deploy's: 0 to 10%, in whole basis points, as in legacy.
import { MAX_ROYALTY_PERCENT, royaltyBps as royaltyPercentToBps } from '@/components/deploy/deploy-form'
import { IPFS_LINK_INVALID, type ActionResult } from '@/lib/art/result'
import type { Address, SupportedChain } from '@/lib/demo'
import { reviewOf, settingsCalls, type ManageCall } from '@/lib/manage/phase-calls'
import type { RevealPointer, RevealTargets, SettingsView } from '@/lib/manage/settings-types'
import { ipfsUriValid, tokenUriOf } from '@/lib/manage/settings-view'
import type { ManageRequest } from './manage-actions'
import { TransactionDialog } from './transaction-dialog'

/** What every Settings dialog takes: the dialog, the chain, the owner check, and the server's confirm. */
export type SettingsDialogBase = {
  open: boolean
  onOpenChange: (open: boolean) => void
  chain: SupportedChain
  /** The owner check's sentence: the dialog opens for reading, its action off. */
  blocked: string | null
  confirm: (hash: Hex, call: ManageCall) => Promise<ActionResult<SettingsView>>
  onConfirmed: (view: SettingsView) => void
}

/**
 * A Settings change as its dialog sends it (docs/specs/2026-10-15-airdrop-settings.md, section 7.4): the call, its
 * review from the ABI on its contract (the transfer validator for the level, else the collection), and the
 * server's confirm of the hash with the call.
 */
export function settingsRequest(
  call: ManageCall,
  chain: SupportedChain,
  confirm: SettingsDialogBase['confirm'],
): ManageRequest<SettingsView> {
  return {
    call,
    review: {
      contract: call.target ? 'Transfer validator' : 'Collection',
      functionName: call.functionName,
      args: reviewOf(call, chain),
    },
    confirm: (hash) => confirm(hash, call),
  }
}

/** The address a typed value resolves to, or why it does not. */
function readAddress(value: string): { address: Address | null; error: string | null } {
  const trimmed = value.trim()
  if (!trimmed) return { address: null, error: null }
  if (!isAddress(trimmed)) {
    return {
      address: null,
      error: /^0x[0-9a-fA-F]{40}$/.test(trimmed)
        ? 'The checksum does not match. Check the address for a typo.'
        : 'Enter a full 0x address, 42 characters.',
    }
  }
  if (/^0x0{40}$/i.test(trimmed))
    return { address: null, error: 'The zero address cannot receive anything. The contract refuses it.' }
  return { address: getAddress(trimmed), error: null }
}

/** Change where withdrawn proceeds are paid. */
export function PayoutDialog({
  current,
  confirm,
  onConfirmed,
  ...base
}: SettingsDialogBase & { current: Address }) {
  const id = useId()
  const [value, setValue] = useState('')
  const { address, error } = readAddress(value)
  const same = address?.toLowerCase() === current.toLowerCase()
  return (
    <TransactionDialog
      {...base}
      title="Change payout address"
      description="Every withdrawal from now on is paid here. Use an address you control; a wrong one cannot be reversed once funds are sent."
      actionLabel="Change address"
      successMessage="Payout address changed"
      request={address && !same ? settingsRequest(settingsCalls.payout(address), base.chain, confirm) : null}
      onConfirmed={onConfirmed}
    >
      <Field data-invalid={!!error || same}>
        <FieldLabel htmlFor={`${id}-address`}>New payout address</FieldLabel>
        <Input
          id={`${id}-address`}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="0x..."
          autoComplete="off"
          spellCheck={false}
          className="numeric"
          aria-invalid={!!error || same}
          aria-describedby={`${id}-address-help`}
        />
        {error || same ? (
          <FieldError id={`${id}-address-help`}>{error ?? 'That is the current payout address.'}</FieldError>
        ) : (
          <FieldDescription id={`${id}-address-help`} className="numeric break-all">
            {address ? `Checksummed: ${address}` : `Now ${current}`}
          </FieldDescription>
        )}
      </Field>
    </TransactionDialog>
  )
}

/** The default royalty (ERC-2981), enforced on secondary sales through the transfer validator. */
export function RoyaltyDialog({
  receiver,
  bps,
  confirm,
  onConfirmed,
  ...base
}: SettingsDialogBase & { receiver: Address; bps: number }) {
  const id = useId()
  const [percentValue, setPercent] = useState(String(bps / 100))
  const [receiverValue, setReceiver] = useState<string>(receiver)
  const { address, error: receiverError } = readAddress(receiverValue)
  const nextBps = royaltyPercentToBps(percentValue)
  const valid = nextBps !== null
  const unchanged = nextBps === bps && address?.toLowerCase() === receiver.toLowerCase()
  return (
    <TransactionDialog
      {...base}
      title="Royalties"
      description="The share of each resale paid to the recipient. Enforced on secondary sales through the transfer validator."
      actionLabel="Save royalties"
      successMessage="Royalties updated"
      request={
        nextBps !== null && address && !unchanged
          ? settingsRequest(settingsCalls.royalty(address, nextBps), base.chain, confirm)
          : null
      }
      onConfirmed={onConfirmed}
    >
      <div className="grid gap-5">
        <Field data-invalid={!valid} className="max-w-48">
          <FieldLabel htmlFor={`${id}-percent`}>Royalty</FieldLabel>
          <InputGroup>
            <InputGroupInput
              id={`${id}-percent`}
              value={percentValue}
              onChange={(event) => setPercent(event.target.value)}
              inputMode="decimal"
              className="numeric"
              aria-invalid={!valid}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupText>%</InputGroupText>
            </InputGroupAddon>
          </InputGroup>
          {!valid ? (
            <FieldError>Enter 0 to {MAX_ROYALTY_PERCENT}, with up to two decimals.</FieldError>
          ) : (
            <FieldDescription>
              <span className="numeric">{nextBps.toLocaleString('en-US')}</span> bps on chain. 0 to{' '}
              {MAX_ROYALTY_PERCENT}%.
            </FieldDescription>
          )}
        </Field>
        <Field data-invalid={!!receiverError}>
          <FieldLabel htmlFor={`${id}-receiver`}>Recipient</FieldLabel>
          <Input
            id={`${id}-receiver`}
            value={receiverValue}
            onChange={(event) => setReceiver(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            className="numeric"
            aria-invalid={!!receiverError}
          />
          {receiverError && <FieldError>{receiverError}</FieldError>}
        </Field>
      </div>
    </TransactionDialog>
  )
}

type Source = 'rendered' | 'placeholder' | 'custom'

/** Each source Reveal offers: its label, what it is, the action and the toast. */
const SOURCES: Record<Source, { label: string; description: string; action: string; success: string }> = {
  rendered: {
    label: 'Rendered metadata',
    description: 'From the art you locked and rendered on Cobweb.',
    action: 'Reveal',
    success: 'Metadata updated. The collection is revealed.',
  },
  placeholder: {
    label: 'Placeholder',
    description: 'The placeholder every token showed before the reveal.',
    action: 'Use the placeholder',
    success: 'Metadata updated. Every token shows the placeholder.',
  },
  custom: {
    label: 'Another IPFS link',
    description:
      'A metadata link you pinned yourself: a folder ending in / gives each token its own file, and a single file is shown for every token.',
    action: 'Use this link',
    success: 'Metadata updated. The collection points at your link.',
  },
}

/**
 * Reveal and change the metadata (docs/specs/2026-10-15-airdrop-settings.md, section 7.4): the base URI to the
 * rendered metadata (the real job's, exactly), back to the placeholder, or to another IPFS link, with what token 1
 * resolves to now and after by the contract's rule. It opens on the first source that would change something.
 */
export function RevealDialog({
  current,
  targets,
  pointer,
  confirm,
  onConfirmed,
  ...base
}: SettingsDialogBase & { current: string; targets: RevealTargets; pointer: RevealPointer }) {
  const id = useId()
  const uriOf = (source: Source) =>
    source === 'rendered' ? targets.real : source === 'placeholder' ? targets.placeholder : null
  const offered = (['rendered', 'placeholder', 'custom'] as const).filter(
    (source) => source === 'custom' || uriOf(source) !== null,
  )
  const [source, setSource] = useState<Source>(
    () => offered.find((candidate) => candidate === 'custom' || uriOf(candidate) !== current) ?? 'custom',
  )
  const [link, setLink] = useState('')
  const typed = link.trim()
  const linkValid = ipfsUriValid(typed)
  const target = source === 'custom' ? (linkValid ? typed : null) : uriOf(source)
  const words = SOURCES[source]

  return (
    <TransactionDialog
      {...base}
      className="sm:max-w-xl"
      destructive={source === 'custom'}
      title={pointer === 'placeholder' ? 'Reveal the art' : 'Change the metadata'}
      description={
        pointer === 'placeholder'
          ? 'Holders and marketplaces see the real tokens once this confirms. Marketplaces refresh on the metadata update event, which can take a few minutes.'
          : 'Holders and marketplaces see the new metadata once this confirms. Marketplaces refresh on the metadata update event, which can take a few minutes.'
      }
      actionLabel={words.action}
      successMessage={words.success}
      request={
        target && target !== current
          ? settingsRequest(settingsCalls.baseUri(target), base.chain, confirm)
          : null
      }
      onConfirmed={onConfirmed}
    >
      <div className="grid gap-5">
        <RadioGroup value={source} onValueChange={(value) => setSource(value as Source)} className="gap-3">
          {offered.map((option) => (
            <label key={option} htmlFor={`${id}-${option}`} className="flex items-start gap-3 text-sm">
              <RadioGroupItem id={`${id}-${option}`} value={option} className="mt-0.5" />
              <span>
                <span className="font-medium">
                  {SOURCES[option].label}
                  {uriOf(option) === current && (
                    <span className="text-muted-foreground font-normal"> (now)</span>
                  )}
                </span>
                <span className="text-muted-foreground block text-[0.8125rem]">
                  {SOURCES[option].description}
                </span>
              </span>
            </label>
          ))}
        </RadioGroup>
        {source === 'custom' && (
          <Alert variant="destructive">
            <TriangleAlertIcon aria-hidden="true" />
            <AlertTitle>Check the link before you confirm</AlertTitle>
            <AlertDescription>
              Pointing the collection at the wrong IPFS link breaks the art and metadata of every token
              already minted. Check the CID before you confirm.
            </AlertDescription>
          </Alert>
        )}
        {source === 'custom' && (
          <Field data-invalid={!!typed && !linkValid}>
            <FieldLabel htmlFor={`${id}-link`}>IPFS link</FieldLabel>
            <Input
              id={`${id}-link`}
              value={link}
              onChange={(event) => setLink(event.target.value)}
              placeholder="ipfs://bafy.../"
              className="numeric"
              autoComplete="off"
              spellCheck={false}
            />
            {typed && !linkValid && <FieldError>{IPFS_LINK_INVALID}</FieldError>}
          </Field>
        )}
        <dl className="grid gap-3 text-[0.8125rem] sm:grid-cols-2">
          <div className="bg-well shadow-inset grid gap-1 rounded-lg border p-3">
            <dt className="text-muted-foreground">Token 1 now</dt>
            <dd className="numeric break-all">{tokenUriOf(current)}</dd>
          </div>
          <div className="grid gap-1 rounded-lg border border-border-strong p-3">
            <dt className="text-muted-foreground">Token 1 after</dt>
            <dd className="numeric break-all">{target ? tokenUriOf(target) : 'Enter a link'}</dd>
          </div>
        </dl>
      </div>
    </TransactionDialog>
  )
}
