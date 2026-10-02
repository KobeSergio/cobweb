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

/** The dashboard sidebar. Collapses to an icon rail, as the legacy creator sidebar did. */
export function AppSidebar() {
  const pathname = usePathname()

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="h-[4.57rem] flex-row items-center justify-between border-b px-4 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
        <Link href="/collections" className="flex items-center gap-2 text-xl font-bold tracking-tight">
          <LogoMark />
          <span className="group-data-[collapsible=icon]:hidden">Cobweb</span>
        </Link>
        <SidebarTrigger className="text-muted-foreground group-data-[collapsible=icon]:hidden" />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup className="p-4 group-data-[collapsible=icon]:p-2">
          <SidebarMenu className="gap-2.5">
            {NAV_ITEMS.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
              return (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    asChild
                    isActive={active}
                    tooltip={item.name}
                    className="text-muted-foreground data-[active=true]:bg-primary data-[active=true]:text-primary-foreground ring-offset-sidebar h-11 focus-visible:ring-offset-2 gap-2 px-3 font-medium"
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
