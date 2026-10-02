'use client'

import { SidebarTrigger, useSidebar } from '@cobweb/ui/components/sidebar'
import { WalletMenu } from '@/components/auth/wallet-menu'

/** Top bar for the dashboard's index pages. */
export function DashboardTopbar({
  title,
  walletAddress,
  children,
}: {
  title: string
  walletAddress: string
  /** Page actions, shown before the wallet. */
  children?: React.ReactNode
}) {
  const { state, isMobile } = useSidebar()

  return (
    <header className="bg-background sticky top-0 z-40 flex h-[4.57rem] shrink-0 items-center justify-between gap-4 border-b px-6">
      <div className="flex items-center gap-3">
        {/* With the sidebar collapsed, or shown as a drawer on narrow screens, its own toggle is out of
            reach, so offer one here. */}
        {(isMobile || state === 'collapsed') && <SidebarTrigger className="text-muted-foreground" />}
        <h1 className="text-lg font-semibold">{title}</h1>
      </div>
      <div className="flex items-center gap-3">
        {children}
        <WalletMenu address={walletAddress} />
      </div>
    </header>
  )
}
