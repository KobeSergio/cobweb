import { LockIcon } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@cobweb/ui/components/alert'

/** Shown at the top of an Art screen once the art is locked: everything below is view-only. */
export function ReadOnlyNotice({ what }: { what: string }) {
  return (
    <Alert>
      <LockIcon aria-hidden="true" />
      <AlertTitle>The art is locked</AlertTitle>
      <AlertDescription>
        It was locked for rendering, so {what} can no longer be changed. You can still look through everything
        here.
      </AlertDescription>
    </Alert>
  )
}
