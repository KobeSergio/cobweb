import Link from 'next/link'
import { Button } from '@cobweb/ui/components/button'
import { Logo } from '@/components/shell/logo'

export default function NotFound() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 p-8 text-center">
      <Logo />
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">Page not found</h1>
        <p className="text-muted-foreground text-base">
          The page does not exist, or it belongs to a collection you do not own.
        </p>
      </div>
      <Button asChild>
        <Link href="/collections">Back to collections</Link>
      </Button>
    </main>
  )
}
