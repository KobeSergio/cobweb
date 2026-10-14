'use client'

import { RefreshCwIcon, TriangleAlertIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@cobweb/ui/components/alert'
import { Button } from '@cobweb/ui/components/button'
import { Spinner } from '@cobweb/ui/components/spinner'

/**
 * A Manage page whose server read was refused (docs/specs/2026-10-15-phases.md, section 7.4): the
 * sentence, and "Try again", which renders the page again on the server.
 */
export function ManageUnavailable({ title, message }: { title: string; message: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  return (
    <Alert variant="destructive">
      <TriangleAlertIcon aria-hidden="true" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <p>{message}</p>
        <Button
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() => startTransition(() => router.refresh())}
        >
          {pending ? <Spinner /> : <RefreshCwIcon aria-hidden="true" />}
          Try again
        </Button>
      </AlertDescription>
    </Alert>
  )
}
