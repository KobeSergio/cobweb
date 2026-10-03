'use client'

import { ChevronDownIcon, CopyIcon, LayoutGridIcon, LogOutIcon } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { useDisconnect } from 'wagmi'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@cobweb/ui/components/dropdown-menu'

function truncate(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

/** The signed-in wallet, with the account actions behind it. */
export function WalletMenu({ address }: { address: string }) {
  const { disconnect } = useDisconnect()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="group flex h-10 cursor-pointer items-center gap-2.5 rounded-md border bg-surface-2 pr-2.5 pl-3 text-sm font-medium shadow-raised transition-colors outline-none hover:bg-surface-3 focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-surface-3">
        {/* Connected: the session is tied to this wallet. */}
        <span aria-hidden="true" className="size-2 rounded-full bg-success ring-3 ring-success-soft" />
        <span className="numeric text-[0.8125rem]">{truncate(address)}</span>
        <ChevronDownIcon className="size-4 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Signed in wallet</DropdownMenuLabel>
        <p className="numeric truncate px-2.5 pb-2 text-xs text-foreground/85">{address}</p>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            navigator.clipboard.writeText(address).then(() => toast.success('Address copied.'))
          }}
        >
          <CopyIcon />
          Copy address
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/collections">
            <LayoutGridIcon />
            Collections
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {/* Disconnecting is enough: the session guard signs out when the wallet goes away. */}
        <DropdownMenuItem onSelect={() => disconnect()}>
          <LogOutIcon />
          Disconnect
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
