'use client'

import { CircleHelpIcon, LayoutGridIcon } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
} from '@cobweb/ui/components/sidebar'
import { LogoMark } from '@/components/shell/logo'

const NAV_ITEMS = [
  { name: 'Collections', href: '/collections', icon: LayoutGridIcon },
  { name: 'Help', href: '/help', icon: CircleHelpIcon },
]

/**
 * The dashboard sidebar: the deepest layer of the chrome. Collapses to an icon rail, as the legacy
 * creator sidebar did. The active item is the yellow pill.
 */
export function AppSidebar() {
  const pathname = usePathname()

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="h-[4.57rem] flex-row items-center justify-between border-b border-sidebar-border px-5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
        <Link
          href="/collections"
          className="flex items-center gap-2.5 rounded-md text-xl font-semibold tracking-[-0.02em] outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <LogoMark className="size-7" />
          <span className="group-data-[collapsible=icon]:hidden">Cobweb</span>
        </Link>
        <SidebarTrigger className="text-muted-foreground group-data-[collapsible=icon]:hidden" />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup className="px-4 py-5 group-data-[collapsible=icon]:px-2">
          <SidebarMenu className="gap-1.5">
            {NAV_ITEMS.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
              return (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    asChild
                    isActive={active}
                    tooltip={item.name}
                    className="h-11 cursor-pointer gap-3 rounded-md px-3 font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[active=true]:bg-primary data-[active=true]:font-semibold data-[active=true]:text-primary-foreground data-[active=true]:shadow-button [&>svg]:size-[1.125rem]"
                  >
                    <Link href={item.href}>
                      <item.icon />
                      <span>{item.name}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  )
}
