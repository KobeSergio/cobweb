import { ChevronLeftIcon } from 'lucide-react'
import Link from 'next/link'
import { Badge } from '@cobweb/ui/components/badge'
import { WalletMenu } from '@/components/auth/wallet-menu'
import { LogoMark } from '@/components/shell/logo'
import { STATUS_LABELS } from '@/components/collections/collection-card'
import type { CollectionStatus } from '@/lib/steps'

/**
 * Top bar while working on one collection: the way back, the collection and its status, and the
 * wallet. What sits under it (the stepper or the Manage tabs) is `WorkspaceNav`.
 */
export function CollectionTopbar({
  name,
  status,
  walletAddress,
}: {
  name: string
  status: CollectionStatus
  walletAddress: string
}) {
  return (
    <header className="bg-background flex h-[4.57rem] shrink-0 items-center justify-between gap-4 border-b px-6">
      <div className="flex min-w-0 items-center gap-4">
        <Link
          href="/collections"
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 flex shrink-0 items-center gap-2 rounded-md py-1 pr-2 text-sm font-medium outline-none focus-visible:ring-[3px]"
        >
          <ChevronLeftIcon className="size-4" />
          <LogoMark className="size-6" />
          Collections
        </Link>
        <div className="flex min-w-0 items-center gap-3 border-l pl-4">
          <h1 className="truncate text-base font-medium">{name}</h1>
          <Badge variant="secondary" className="shrink-0">
            {STATUS_LABELS[status]}
          </Badge>
        </div>
      </div>
      <WalletMenu address={walletAddress} />
    </header>
  )
}
