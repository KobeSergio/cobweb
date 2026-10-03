'use client'

import { SidebarTrigger, useSidebar } from '@cobweb/ui/components/sidebar'
import { WalletMenu } from '@/components/auth/wallet-menu'

/**
 * Top bar for the dashboard's index pages. It stays put while the page scrolls, so it carries the
 * page name quietly as a place marker; the page's own header holds the h1.
 */
export function DashboardTopbar({
  title,
  walletAddress,
  children,
}: {
  title: string
  walletAddress: string
  /** Extra actions, shown before the wallet. Most pages put theirs in the PageHeader instead. */
  children?: React.ReactNode
}) {
  const { state, isMobile } = useSidebar()

  return (
    <header className="sticky top-0 z-40 flex h-[4.57rem] shrink-0 items-center justify-between gap-4 border-b bg-background/80 px-8 backdrop-blur-md">
      <div className="flex items-center gap-3">
        {/* With the sidebar collapsed, or shown as a drawer on narrow screens, its own toggle is out of
            reach, so offer one here. */}
        {(isMobile || state === 'collapsed') && <SidebarTrigger className="-ml-2 text-muted-foreground" />}
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
      </div>
      <div className="flex items-center gap-3">
        {children}
        <WalletMenu address={walletAddress} />
      </div>
    </header>
  )
}
