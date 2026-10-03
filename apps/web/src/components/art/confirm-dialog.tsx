'use client'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@cobweb/ui/components/alert-dialog'

export type ConfirmRequest = {
  title: string
  /** One or more short paragraphs: what happens, and what it costs. */
  body: string[]
  confirmLabel: string
  destructive?: boolean
  onConfirm: () => void
}

/** One confirmation at a time, driven by a `ConfirmRequest` (null when closed). */
export function ConfirmDialog({ request, onClose }: { request: ConfirmRequest | null; onClose: () => void }) {
  return (
    <AlertDialog open={!!request} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{request?.title}</AlertDialogTitle>
          {request?.body.map((paragraph, i) =>
            i === 0 ? (
              <AlertDialogDescription key={i}>{paragraph}</AlertDialogDescription>
            ) : (
              <p key={i} className="text-muted-foreground text-sm leading-relaxed">
                {paragraph}
              </p>
            ),
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant={request?.destructive ? 'destructive' : 'default'}
            onClick={() => {
              request?.onConfirm()
              onClose()
            }}
          >
            {request?.confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
