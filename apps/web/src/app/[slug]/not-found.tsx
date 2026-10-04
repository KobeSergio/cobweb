import Link from 'next/link'
import { CornerWeb } from '@cobweb/ui/components/artwork'
import { Button } from '@cobweb/ui/components/button'
import { Logo } from '@/components/shell/logo'

/** A mint page link with no collection behind it (or one that is not published). */
export default function MintPageNotFound() {
  return (
    <main className="relative isolate flex min-h-svh flex-col items-center justify-center overflow-hidden p-6 text-center sm:p-8">
      <div className="absolute top-6 left-6 sm:top-8 sm:left-8">
        <Logo />
      </div>
      <div
        aria-hidden="true"
        className="spotlight relative mb-10 aspect-square w-48 overflow-hidden rounded-xl border border-border-strong bg-card shadow-lifted"
      >
        <CornerWeb seed="mint-not-found" className="text-foreground/14" />
      </div>
      <h1 className="text-display">No collection here</h1>
      <p className="mt-3 max-w-md text-base leading-relaxed text-muted-foreground">
        This mint page does not exist or is not published yet. Check the link with whoever shared it.
      </p>
      <Button asChild size="lg" className="mt-8">
        <Link href="/">Go to Cobweb</Link>
      </Button>
    </main>
  )
}
