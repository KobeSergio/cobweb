import { ArrowUpRightIcon, EyeIcon } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@cobweb/ui/components/button'

/** Above the owner's preview: who can see it, and the way back to the Mint page tab. */
export function PreviewBanner({ published, tabHref }: { published: boolean; tabHref: string }) {
  return (
    <div role="note" className="border-b border-primary-line bg-primary-soft">
      <div className="mx-auto flex max-w-[90rem] flex-wrap items-center justify-between gap-3 px-4 py-2.5 sm:px-8">
        <p className="flex items-center gap-2 text-[0.8125rem]">
          <EyeIcon aria-hidden="true" className="size-4 shrink-0 text-primary" />
          {published
            ? 'Preview of your public page.'
            : 'Preview. Only you can see this page; it is not public yet.'}
        </p>
        <Button asChild variant="ghost" size="sm">
          <Link href={tabHref}>
            Edit in the Mint page tab
            <ArrowUpRightIcon aria-hidden="true" />
          </Link>
        </Button>
      </div>
    </div>
  )
}
