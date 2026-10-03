import Image from 'next/image'
import { cn } from '@cobweb/ui/lib/utils'

/** The mark. The Kingdomly crown is kept for now; the product name is Cobweb. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <Image
      src="/assets/icon.svg"
      alt=""
      width={36}
      height={36}
      className={cn('size-6 shrink-0', className)}
    />
  )
}

export function Logo({ className, markClassName }: { className?: string; markClassName?: string }) {
  return (
    <span className={cn('flex items-center gap-2.5 text-xl font-semibold tracking-[-0.02em]', className)}>
      <LogoMark className={markClassName} />
      Cobweb
    </span>
  )
}
