'use client'

import { ClockIcon } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@cobweb/ui/components/alert'
import { Button } from '@cobweb/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@cobweb/ui/components/dialog'
import { collectionHref } from '@/lib/steps'

const STEPS = [
  {
    title: 'Deploy on a placeholder now',
    text: 'Lock and upload one placeholder image, GIF or MP4. Every token shows it until the reveal, and the contract starts on it.',
  },
  {
    title: 'Finish the art afterwards',
    text: 'Art stays open after the deploy. Phases, the whitelist and the mint page work as usual meanwhile.',
  },
  {
    title: 'Lock and upload the real set later',
    text: 'When the art is done, lock it and pay the generation fee. It is rendered to its own CID.',
  },
  {
    title: 'Then reveal',
    text: 'Manage drop, Settings, Reveal points the contract at the real art in one transaction.',
  },
]

/**
 * "Finish the art later" (decision D25): a secondary action in the Art footer. Confirming marks the
 * art as deferred and opens Lock and upload with "Reveal later" on and the real set's lock off.
 *
 * Seam: the deferred flag is the sample scenario in the URL (`?art=deferred`) until Phase 3 adds
 * the collection's column; then confirming calls a server action that sets it.
 */
export function FinishLaterAction({ collectionId }: { collectionId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        <ClockIcon />
        Finish the art later
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Finish the art later?</DialogTitle>
            <DialogDescription>
              You can deploy before the art is finished. Collectors see a placeholder until you reveal.
            </DialogDescription>
          </DialogHeader>
          <ol className="space-y-4">
            {STEPS.map((step, index) => (
              <li key={step.title} className="flex gap-3">
                <span
                  aria-hidden="true"
                  className="border-border-strong numeric flex size-6 shrink-0 items-center justify-center rounded-full border text-xs"
                >
                  {index + 1}
                </span>
                <span className="min-w-0 space-y-0.5">
                  <span className="block text-sm font-medium">{step.title}</span>
                  <span className="text-muted-foreground block text-[0.8125rem] leading-snug">
                    {step.text}
                  </span>
                </span>
              </li>
            ))}
          </ol>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Keep working
            </Button>
            <Button
              onClick={() => {
                setOpen(false)
                router.push(`${collectionHref(collectionId, 'upload')}?art=deferred`)
              }}
            >
              Finish later
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** At the top of an Art screen while the art is deferred: what is left to do, and where. */
export function DeferredArtNotice({ collectionId }: { collectionId: string }) {
  return (
    <Alert>
      <ClockIcon aria-hidden="true" />
      <AlertTitle>You are finishing the art later</AlertTitle>
      <AlertDescription>
        <p>
          The contract starts on the placeholder, and the art stays open until you lock the real set. When the
          set is complete, continue from Generate to lock and upload it, then reveal it from Manage drop,
          Settings.
        </p>
        <Link
          href={`${collectionHref(collectionId, 'upload')}?art=deferred`}
          className="text-foreground underline underline-offset-4"
        >
          View the placeholder upload
        </Link>
      </AlertDescription>
    </Alert>
  )
}
