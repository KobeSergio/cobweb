'use client'

import { TriangleAlertIcon } from 'lucide-react'
import { useId, useState } from 'react'
import { getAddress, isAddress } from 'viem'
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
import { formatBps, type Address, type SupportedChain } from '@/lib/demo'
import { TransactionDialog } from './transaction-dialog'

type Base = { open: boolean; onOpenChange: (open: boolean) => void; chain: SupportedChain }

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
  onApply,
  ...base
}: Base & { current: Address; onApply: (address: Address) => void }) {
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
      request={
        address && !same
          ? {
              contract: 'Collection',
              functionName: 'setOwnerPayoutAddress',
              args: [{ name: 'address', value: address }],
            }
          : null
      }
      onConfirmed={() => address && onApply(address)}
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
  onApply,
  ...base
}: Base & { receiver: Address; bps: number; onApply: (receiver: Address, bps: number) => void }) {
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
          ? {
              contract: 'Collection',
              functionName: 'setDefaultRoyalty',
              args: [
                { name: 'receiver', value: address },
                { name: 'feeNumerator', value: `${nextBps} (${formatBps(nextBps)})` },
              ],
            }
          : null
      }
      onConfirmed={() => address && nextBps !== null && onApply(address, nextBps)}
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

/**
 * Reveal: point the base URI at the rendered metadata. Shows what token 1 resolves to before
 * and after, and allows another CID for a collection whose metadata lives elsewhere.
 */
export function RevealDialog({
  currentUri,
  metadataCid,
  singleAsset,
  onApply,
  ...base
}: Base & { currentUri: string; metadataCid: string; singleAsset: boolean; onApply: (uri: string) => void }) {
  const id = useId()
  const [source, setSource] = useState<'rendered' | 'custom'>('rendered')
  const [custom, setCustom] = useState('')
  // Single Asset: no trailing slash, so every token returns the base as-is (MASTER_PLAN, Contracts: single asset tokenURI).
  const withSlash = (cid: string) => `ipfs://${cid}${singleAsset ? '' : '/'}`
  const customCid = custom
    .trim()
    .replace(/^ipfs:\/\//, '')
    .replace(/\/$/, '')
  const customValid = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{58,})$/.test(customCid)
  const uri = source === 'rendered' ? withSlash(metadataCid) : customValid ? withSlash(customCid) : null
  const tokenUri = (value: string) => (value.endsWith('/') ? `${value}1` : value)

  return (
    <TransactionDialog
      {...base}
      className="sm:max-w-xl"
      destructive={source === 'custom'}
      title="Reveal the art"
      description="Holders and marketplaces see the real tokens once this confirms. Marketplaces refresh on the metadata update event, which can take a few minutes."
      actionLabel="Reveal"
      successMessage="Metadata updated. The collection is revealed."
      request={
        uri && uri !== currentUri
          ? { contract: 'Collection', functionName: 'setBaseURI', args: [{ name: 'uri', value: uri }] }
          : null
      }
      onConfirmed={() => uri && onApply(uri)}
    >
      <div className="grid gap-5">
        <RadioGroup
          value={source}
          onValueChange={(value) => setSource(value as 'rendered' | 'custom')}
          className="gap-3"
        >
          <label htmlFor={`${id}-rendered`} className="flex items-start gap-3 text-sm">
            <RadioGroupItem id={`${id}-rendered`} value="rendered" className="mt-0.5" />
            <span>
              <span className="font-medium">Rendered metadata</span>
              <span className="text-muted-foreground block text-[0.8125rem]">
                From the art you locked and rendered on Cobweb.
              </span>
            </span>
          </label>
          <label htmlFor={`${id}-custom`} className="flex items-start gap-3 text-sm">
            <RadioGroupItem id={`${id}-custom`} value="custom" className="mt-0.5" />
            <span>
              <span className="font-medium">Another IPFS folder</span>
              <span className="text-muted-foreground block text-[0.8125rem]">
                A metadata CID you pinned yourself.
              </span>
            </span>
          </label>
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
          <Field data-invalid={!!custom && !customValid}>
            <FieldLabel htmlFor={`${id}-cid`}>Metadata CID</FieldLabel>
            <Input
              id={`${id}-cid`}
              value={custom}
              onChange={(event) => setCustom(event.target.value)}
              placeholder="bafy..."
              className="numeric"
              autoComplete="off"
              spellCheck={false}
            />
            {custom && !customValid && <FieldError>That does not look like an IPFS CID.</FieldError>}
          </Field>
        )}
        <dl className="grid gap-3 text-[0.8125rem] sm:grid-cols-2">
          <div className="bg-well shadow-inset grid gap-1 rounded-lg border p-3">
            <dt className="text-muted-foreground">Token 1 now</dt>
            <dd className="numeric break-all">{tokenUri(currentUri)}</dd>
          </div>
          <div className="grid gap-1 rounded-lg border border-border-strong p-3">
            <dt className="text-muted-foreground">Token 1 after</dt>
            <dd className="numeric break-all">{uri ? tokenUri(uri) : 'Enter a CID'}</dd>
          </div>
        </dl>
      </div>
    </TransactionDialog>
  )
}
