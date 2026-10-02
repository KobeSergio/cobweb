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
      <DropdownMenuTrigger className="bg-card hover:bg-accent focus-visible:ring-ring/50 flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium outline-none focus-visible:ring-[3px]">
        <span className="font-mono text-[0.8125rem]">{truncate(address)}</span>
        <ChevronDownIcon className="text-muted-foreground size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
          Signed in wallet
        </DropdownMenuLabel>
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
