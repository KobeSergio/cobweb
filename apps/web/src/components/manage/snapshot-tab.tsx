'use client'

import { CameraIcon } from 'lucide-react'
import { useId, useState } from 'react'
import { Button } from '@cobweb/ui/components/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@cobweb/ui/components/field'
import { Input } from '@cobweb/ui/components/input'
import { RadioGroup, RadioGroupItem } from '@cobweb/ui/components/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cobweb/ui/components/select'
import { Spinner } from '@cobweb/ui/components/spinner'
import { ChainName } from '@/components/chains/chain-icon'
import { NO_HOLDERS, SNAPSHOT_FAILED, type ActionResult } from '@/lib/art/result'
import { shortAddress, type SupportedChain } from '@/lib/demo'
import type { HolderSnapshot } from '@/lib/manage/holders'
import { count } from './format'
import { holdersToText, snapshotAddressError, type SnapshotAmount } from './snapshot'

/**
 * Where a snapshot reads (docs/specs/2026-10-15-whitelist.md, section 7.2): the chains offered, the one selected
 * first, and the read itself, the `fetchHolders` action or the sample's.
 */
export type SnapshotSource = {
  chains: SupportedChain[]
  chainId: number
  fetch(chainId: number, contract: string): Promise<ActionResult<HolderSnapshot>>
}

/**
 * "Snapshot holders of a contract": every current holder of another collection becomes a line,
 * with the tokens they hold or one fixed amount (legacy's "Address Token Balance" and "User Set").
 * The lines join the same text the other tabs edit, so the preview and checks apply as usual.
 */
export function SnapshotTab({
  source,
  amountName,
  maxAmount,
  onLoaded,
}: {
  source: SnapshotSource
  amountName: string
  maxAmount: number
  onLoaded: (lines: string, summary: string) => void
}) {
  const id = useId()
  const [chainId, setChainId] = useState(String(source.chainId))
  const [contract, setContract] = useState('')
  const [touched, setTouched] = useState(false)
  const [mode, setMode] = useState<SnapshotAmount['kind']>('balance')
  const [fixed, setFixed] = useState('1')
  const [loading, setLoading] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const addressError = snapshotAddressError(contract)
  const fixedValue = Number(fixed)
  const fixedError =
    mode === 'fixed' && (!/^\d+$/.test(fixed) || fixedValue < 1 || fixedValue > maxAmount)
      ? `Enter a whole number from 1 to ${count(maxAmount)}.`
      : null
  const chain = source.chains.find((entry) => String(entry.id) === chainId)

  async function take() {
    setTouched(true)
    if (addressError || fixedError || !chain) return
    setLoading(true)
    setFailure(null)
    try {
      const result = await source.fetch(chain.id, contract.trim())
      if (!result.ok) {
        setFailure(result.error)
        return
      }
      const { holders, block } = result.data
      if (holders.length === 0) {
        setFailure(NO_HOLDERS)
        return
      }
      const amount: SnapshotAmount =
        mode === 'fixed' ? { kind: 'fixed', amount: fixedValue } : { kind: 'balance' }
      onLoaded(
        holdersToText(holders, amount, maxAmount),
        `${count(holders.length)} holders of ${shortAddress(contract.trim(), 4)} on ${chain.name} at block ${block}`,
      )
    } catch {
      setFailure(SNAPSHOT_FAILED)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="grid gap-4">
      <p className="text-muted-foreground text-[0.8125rem]">
        Adds every current holder of another collection. Large collections take a minute: each token&apos;s
        owner is read from the chain.
      </p>
      <div className="grid gap-3 sm:grid-cols-[11rem_1fr]">
        <Field>
          <FieldLabel htmlFor={`${id}-chain`}>Chain</FieldLabel>
          <Select value={chainId} onValueChange={setChainId}>
            <SelectTrigger id={`${id}-chain`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {source.chains.map((entry) => (
                <SelectItem key={entry.id} value={String(entry.id)}>
                  <ChainName chain={entry} iconClassName="size-3.5" />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field data-invalid={touched && !!addressError}>
          <FieldLabel htmlFor={`${id}-contract`}>Contract address</FieldLabel>
          <Input
            id={`${id}-contract`}
            value={contract}
            onChange={(event) => setContract(event.target.value)}
            onBlur={() => setTouched(true)}
            placeholder="0x..."
            autoComplete="off"
            spellCheck={false}
            className="numeric"
            aria-invalid={touched && !!addressError}
          />
          {touched && addressError && <FieldError>{addressError}</FieldError>}
        </Field>
      </div>
      <Field>
        <FieldLabel>{amountName === 'quota' ? 'Quota for each holder' : 'Tokens for each holder'}</FieldLabel>
        <RadioGroup value={mode} onValueChange={(value) => setMode(value as SnapshotAmount['kind'])}>
          <label htmlFor={`${id}-balance`} className="flex items-start gap-3 text-sm">
            <RadioGroupItem id={`${id}-balance`} value="balance" className="mt-0.5" />
            <span>
              The tokens they hold
              <span className="text-muted-foreground block text-[0.8125rem]">
                A holder of 3 gets 3, up to {count(maxAmount)}.
              </span>
            </span>
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <label htmlFor={`${id}-fixed`} className="flex items-center gap-3 text-sm">
              <RadioGroupItem id={`${id}-fixed`} value="fixed" />
              The same for everyone
            </label>
            {mode === 'fixed' && (
              <Input
                aria-label={`${amountName} for every holder`}
                type="number"
                min={1}
                max={maxAmount}
                value={fixed}
                onChange={(event) => setFixed(event.target.value)}
                className="numeric w-24"
                aria-invalid={!!fixedError}
              />
            )}
          </div>
        </RadioGroup>
        {fixedError && <FieldError>{fixedError}</FieldError>}
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" onClick={take} disabled={loading}>
          {loading ? <Spinner /> : <CameraIcon aria-hidden="true" />}
          {loading ? 'Taking snapshot' : 'Take snapshot'}
        </Button>
        {chain && (
          <FieldDescription className="text-[0.8125rem]">
            Reads <ChainName chain={chain} className="text-foreground" iconClassName="size-3" /> now. Holders
            who buy later are not added.
          </FieldDescription>
        )}
      </div>
      {failure && <FieldError>{failure}</FieldError>}
    </div>
  )
}
