'use client'

import { ClockIcon } from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
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
    text: 'When the art is done, lock it and render it. It is stored under its own CID.',
  },
  {
    title: 'Then reveal',
    text: 'Manage drop, Settings, Reveal points the contract at the real art in one transaction.',
  },
]

/**
 * "Finish the art later" (MASTER_PLAN, Flow: pre-reveal): a secondary button at the right end of the stepper row
 * (`StageNav`), only while the Art stage is shown and the art is not deferred; nowhere else. Confirming marks the
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
      <Button variant="secondary" onClick={() => setOpen(true)}>
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

/**
 * At the top of an Art screen while the art is deferred and the contract is not deployed yet: what
 * is left to do, and where. Once deployed the Art layout's one-line `ArtLiveNotice` says it instead,
 * so this stays away (sample mode: `?state=deployed`).
 *
 * Seam: a deployed row with deferred art also hides it once Phase 3 adds the deferred-art column.
 */
export function DeferredArtNotice({ collectionId }: { collectionId: string }) {
  const searchParams = useSearchParams()
  if (searchParams.get('state') === 'deployed') return null
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
