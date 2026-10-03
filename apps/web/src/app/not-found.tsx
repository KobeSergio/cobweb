import Link from 'next/link'
import { CornerWeb } from '@cobweb/ui/components/artwork'
import { Button } from '@cobweb/ui/components/button'
import { Logo } from '@/components/shell/logo'

export default function NotFound() {
  return (
    <main className="relative isolate flex min-h-svh flex-col items-center justify-center overflow-hidden p-8 text-center">
      <div className="absolute top-8 left-8">
        <Logo />
      </div>
      {/* An empty frame: nothing hangs here. */}
      <div
        aria-hidden="true"
        className="spotlight relative mb-10 aspect-[4/5] w-52 overflow-hidden rounded-xl border border-border-strong bg-card shadow-lifted"
      >
        <CornerWeb seed="not-found" className="text-foreground/14" />
        <span className="numeric absolute inset-x-0 bottom-5 text-sm text-muted-foreground">404</span>
      </div>
      <h1 className="text-display">Page not found</h1>
      <p className="mt-3 max-w-md text-base leading-relaxed text-muted-foreground">
        The page does not exist, or it belongs to a collection you do not own.
      </p>
      <Button asChild size="lg" className="mt-8">
        <Link href="/collections">Back to collections</Link>
      </Button>
    </main>
  )
}
