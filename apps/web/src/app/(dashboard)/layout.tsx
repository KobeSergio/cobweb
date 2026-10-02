import { SidebarInset, SidebarProvider } from '@cobweb/ui/components/sidebar'
import { SessionGuard } from '@/components/auth/session-guard'
import { AppSidebar } from '@/components/shell/app-sidebar'
import { SmallScreen } from '@/components/shell/small-screen'
import { requireUser } from '@/lib/auth'

/** The dashboard's index pages: sidebar on the left, page on the right. Signed-in creators only. */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser()

  return (
    <>
      <SessionGuard sessionAddress={user.walletAddress} />
      <SmallScreen />
      <SidebarProvider
        className="hidden sm:flex"
        // The legacy sidebar's widths: 18.75rem open, 4rem as an icon rail.
        style={{ '--sidebar-width': '18.75rem', '--sidebar-width-icon': '4rem' } as React.CSSProperties}
      >
        <AppSidebar />
        <SidebarInset>{children}</SidebarInset>
      </SidebarProvider>
    </>
  )
}
