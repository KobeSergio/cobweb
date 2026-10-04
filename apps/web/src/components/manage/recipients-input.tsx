'use client'

import { AlertTriangleIcon, DownloadIcon, FileUpIcon, PlusIcon } from 'lucide-react'
import { useId, useState } from 'react'
import { Button } from '@cobweb/ui/components/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@cobweb/ui/components/field'
import { Input } from '@cobweb/ui/components/input'
import { Spinner } from '@cobweb/ui/components/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@cobweb/ui/components/tabs'
import { Textarea } from '@cobweb/ui/components/textarea'
import { cn } from '@cobweb/ui/lib/utils'
import { shortAddress } from '@/lib/demo'
import { count, downloadText } from './format'
import { parseRecipients, readCsvFile, type ParseOptions, type ParseResult } from './recipients'
import { SnapshotTab, type SnapshotSource } from './snapshot-tab'

/**
 * Where a list of recipients comes from: an uploaded CSV, pasted text, one at a time, or (with
 * `snapshot`) the holders of another collection. All of them edit the same text, which the parent
 * parses with `parseRecipients` and previews with `ParsePreview`.
 */
export function RecipientsInput({
  text,
  onTextChange,
  options,
  template,
  snapshot,
}: {
  text: string
  onTextChange: (text: string) => void
  options: ParseOptions
  template: { fileName: string; text: string }
  /** The chains a holder snapshot can read, and the one selected first. */
  snapshot?: SnapshotSource
}) {
  const [snapshotNote, setSnapshotNote] = useState<string | null>(null)
  const id = useId()
  const [fileName, setFileName] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [address, setAddress] = useState('')
  const [amount, setAmount] = useState(String(options.defaultAmount))
  const [manualError, setManualError] = useState<string | null>(null)

  async function takeFile(file: File | undefined) {
    if (!file) return
    setReading(true)
    setFileError(null)
    try {
      onTextChange(await readCsvFile(file))
      setFileName(file.name)
    } catch (error) {
      setFileError(error instanceof Error ? error.message : 'The file could not be read. Try again.')
    } finally {
      setReading(false)
    }
  }

  function addOne(event: { preventDefault: () => void }) {
    event.preventDefault()
    const line = `${address.trim()},${amount.trim()}`
    const result = parseRecipients(line, options)
    if (result.rows.length === 0) {
      setManualError(result.invalid[0]?.reason ?? 'Enter an address.')
      return
    }
    setManualError(null)
    onTextChange(text.trim() ? `${text.trimEnd()}\n${line}` : line)
    setAddress('')
  }

  return (
    <Tabs defaultValue="upload">
      <TabsList className="w-full">
        <TabsTrigger value="upload">Upload CSV</TabsTrigger>
        <TabsTrigger value="paste">Paste</TabsTrigger>
        <TabsTrigger value="manual">Add one</TabsTrigger>
        {snapshot && <TabsTrigger value="snapshot">Snapshot</TabsTrigger>}
      </TabsList>

      <TabsContent value="upload" className="grid gap-3">
        <label
          htmlFor={`${id}-file`}
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault()
            setDragging(false)
            void takeFile(event.dataTransfer.files[0])
          }}
          className={cn(
            'bg-well flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-8 text-center transition-colors',
            'has-[input:focus-visible]:ring-ring has-[input:focus-visible]:ring-2',
            dragging ? 'border-primary bg-primary-soft' : 'border-border-strong hover:border-input',
          )}
        >
          {reading ? (
            <Spinner className="size-5" />
          ) : (
            <FileUpIcon aria-hidden="true" className="text-muted-foreground size-5" />
          )}
          <span className="text-sm font-medium">
            {reading ? 'Reading file' : fileName ? `Loaded ${fileName}` : 'Choose a CSV file or drop it here'}
          </span>
          <span className="text-muted-foreground text-[0.8125rem]">
            One address per line, with an optional {options.amountName}. Up to 5 MB.
          </span>
          <input
            id={`${id}-file`}
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            className="sr-only"
            onChange={(event) => {
              void takeFile(event.target.files?.[0])
              event.target.value = ''
            }}
          />
        </label>
        {fileError && <FieldError>{fileError}</FieldError>}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-fit"
          onClick={() => downloadText(template.fileName, template.text)}
        >
          <DownloadIcon />
          Download template
        </Button>
      </TabsContent>

      <TabsContent value="paste">
        <Field>
          <FieldLabel htmlFor={`${id}-paste`}>Addresses</FieldLabel>
          <Textarea
            id={`${id}-paste`}
            value={text}
            onChange={(event) => onTextChange(event.target.value)}
            rows={7}
            spellCheck={false}
            placeholder={`0x5e1f0c9b8a7d6e5f4c3b2a1908f7e6d5c4b3a291,2\n0x3b9d2c1a0f8e7d6c5b4a39281706f5e4d3c2b1a0`}
            className="numeric text-[0.8125rem]"
            aria-describedby={`${id}-paste-help`}
          />
          <FieldDescription id={`${id}-paste-help`}>
            One per line: address, then {options.amountName}. Without a {options.amountName}, each gets{' '}
            {options.defaultAmount}.
          </FieldDescription>
        </Field>
      </TabsContent>

      <TabsContent value="manual">
        <div className="grid gap-3 sm:grid-cols-[1fr_7rem_auto] sm:items-end">
          <Field data-invalid={!!manualError}>
            <FieldLabel htmlFor={`${id}-address`}>Address</FieldLabel>
            <Input
              id={`${id}-address`}
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && addOne(event)}
              placeholder="0x..."
              autoComplete="off"
              spellCheck={false}
              className="numeric"
              aria-invalid={!!manualError}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-amount`} className="capitalize">
              {options.amountName}
            </FieldLabel>
            <Input
              id={`${id}-amount`}
              type="number"
              min={1}
              max={options.maxAmount}
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </Field>
          <Button type="button" variant="secondary" onClick={addOne}>
            <PlusIcon />
            Add
          </Button>
        </div>
        {manualError && <FieldError className="mt-2">{manualError}</FieldError>}
      </TabsContent>

      {snapshot && (
        <TabsContent value="snapshot" className="grid gap-3">
          <SnapshotTab
            source={snapshot}
            amountName={options.amountName}
            maxAmount={options.maxAmount}
            onLoaded={(lines, summary) => {
              onTextChange(text.trim() ? `${text.trimEnd()}\n${lines}` : lines)
              setSnapshotNote(`Added ${summary}. Review them below before you continue.`)
            }}
          />
          {snapshotNote && (
            <p className="text-success-foreground text-[0.8125rem]" aria-live="polite">
              {snapshotNote}
            </p>
          )}
        </TabsContent>
      )}
    </Tabs>
  )
}

/** Counts, the rejected lines with their line numbers, and the first valid rows. */
export function ParsePreview({ result, amountName }: { result: ParseResult; amountName: string }) {
  const { rows, invalid, duplicates, header } = result
  if (rows.length === 0 && invalid.length === 0) return null
  const total = rows.reduce((sum, row) => sum + row.amount, 0)
  return (
    <div className="grid gap-3" aria-live="polite">
      <dl className="bg-surface-2 grid grid-cols-3 divide-x rounded-lg">
        <PreviewStat label="Valid" value={rows.length} />
        <PreviewStat label={`Total ${amountName}`} value={total} />
        <PreviewStat label="Rejected" value={invalid.length} danger={invalid.length > 0} />
      </dl>
      {(duplicates > 0 || header) && (
        <p className="text-muted-foreground text-[0.8125rem]">
          {header && 'The first line was read as a header and skipped. '}
          {duplicates > 0 &&
            `${count(duplicates)} repeated ${duplicates === 1 ? 'address was' : 'addresses were'} merged.`}
        </p>
      )}
      {invalid.length > 0 && (
        <div className="bg-destructive-soft rounded-lg px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-medium">
            <AlertTriangleIcon aria-hidden="true" className="text-destructive-foreground size-4" />
            {count(invalid.length)} {invalid.length === 1 ? 'line was' : 'lines were'} left out
          </p>
          <ul className="mt-2 grid max-h-36 gap-1 overflow-y-auto text-[0.8125rem]">
            {invalid.slice(0, 100).map((row) => (
              <li key={row.line} className="grid grid-cols-[4.5rem_1fr] gap-2">
                <span className="numeric text-muted-foreground">Line {row.line}</span>
                <span>
                  {row.reason}{' '}
                  <span className="numeric text-muted-foreground break-all">{row.text.slice(0, 60)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {rows.length > 0 && (
        <ul className="divide-y rounded-lg border text-[0.8125rem]">
          {rows.slice(0, 5).map((row) => (
            <li key={row.address} className="flex justify-between gap-3 px-3 py-2">
              <span className="numeric truncate" title={row.address}>
                {shortAddress(row.address, 6)}
              </span>
              <span className="numeric text-muted-foreground">{count(row.amount)}</span>
            </li>
          ))}
          {rows.length > 5 && (
            <li className="text-muted-foreground px-3 py-2">and {count(rows.length - 5)} more</li>
          )}
        </ul>
      )}
    </div>
  )
}

function PreviewStat({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className="px-4 py-3">
      <dt className="text-muted-foreground text-xs font-medium">{label}</dt>
      <dd className={cn('numeric text-lg', danger && 'text-destructive-foreground')}>{count(value)}</dd>
    </div>
  )
}
