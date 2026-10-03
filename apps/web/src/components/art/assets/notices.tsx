'use client'

import { CircleAlertIcon, LockIcon, XIcon } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@cobweb/ui/components/alert'
import { Button } from '@cobweb/ui/components/button'
import { Spinner } from '@cobweb/ui/components/spinner'
import type { RejectedFile } from './types'

export function LockedNotice() {
  return (
    <Alert role="status">
      <LockIcon aria-hidden="true" />
      <AlertTitle>The art is locked</AlertTitle>
      <AlertDescription>This art can no longer be edited. You can look through it here.</AlertDescription>
    </Alert>
  )
}

export function CheckingNotice({ count }: { count: number }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3 text-sm shadow-raised">
      <Spinner aria-hidden="true" role="presentation" />
      <span>
        Checking <span className="numeric">{count.toLocaleString('en-US')}</span>{' '}
        {count === 1 ? 'file' : 'files'}
      </span>
    </div>
  )
}

/** Files that failed their checks, each with the reason. */
export function RejectedList({
  rejected,
  onDismiss,
}: {
  rejected: RejectedFile[]
  onDismiss: (key?: string) => void
}) {
  if (rejected.length === 0) return null
  return (
    <Alert variant="destructive">
      <CircleAlertIcon aria-hidden="true" />
      <AlertTitle className="flex items-center justify-between gap-3">
        <span>
          <span className="numeric">{rejected.length.toLocaleString('en-US')}</span>{' '}
          {rejected.length === 1 ? 'file was' : 'files were'} not added
        </span>
        <Button type="button" variant="ghost" size="xs" onClick={() => onDismiss()}>
          Dismiss all
        </Button>
      </AlertTitle>
      <AlertDescription>
        <ul className="mt-1 max-h-48 space-y-1.5 overflow-y-auto">
          {rejected.map((file) => (
            <li key={file.key} className="flex items-start justify-between gap-2">
              <span className="min-w-0">
                <span className="font-medium text-foreground">{file.fileName}</span>{' '}
                <span>{file.errors.join(' ')}</span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={`Dismiss the error for ${file.fileName}`}
                onClick={() => onDismiss(file.key)}
              >
                <XIcon aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  )
}
