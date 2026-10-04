'use client'

import { ConnectButton } from '@rainbow-me/rainbowkit'
import { ChevronDownIcon, TriangleAlertIcon } from 'lucide-react'
import { Button } from '@cobweb/ui/components/button'
import { ChainIcon } from '@/components/chains/chain-icon'
import { shortAddress } from '@/lib/demo/helpers'
import { useMint } from './mint-context'

const pill =
  'flex h-10 cursor-pointer items-center gap-2.5 rounded-md border bg-surface-2 pr-2.5 pl-3 text-sm font-medium shadow-raised outline-none transition-colors hover:bg-surface-3 focus-visible:ring-2 focus-visible:ring-ring'

/**
 * The wallet in the top bar. RainbowKit's modals, in the page's own controls. A forced sample
 * wallet shows as the same pill, without a menu. The chain's mark sits beside the address.
 */
export function WalletButton() {
  const { wallet, sampleWallet, wrongChain, data } = useMint()

  if (sampleWallet && wallet) {
    return (
      <div className={pill + ' cursor-default hover:bg-surface-2'}>
        <ChainIcon chainId={data.collection.chain.id} className="size-4 text-muted-foreground" />
        <span className="sr-only">
          {wrongChain ? 'On another network, ' : `On ${data.collection.chain.name}, `}
        </span>
        <span className="numeric text-[0.8125rem]">{shortAddress(wallet.address)}</span>
      </div>
    )
  }

  return (
    <ConnectButton.Custom>
      {({ account, chain, mounted, openAccountModal, openChainModal, openConnectModal }) => {
        if (!mounted) return <div aria-hidden="true" className="h-10 w-36 rounded-md bg-surface-2" />
        if (!account) {
          return (
            <Button variant="secondary" onClick={openConnectModal}>
              Connect wallet
            </Button>
          )
        }
        if (chain?.unsupported || chain?.id !== data.collection.chain.id) {
          return (
            <button type="button" onClick={openChainModal} className={pill}>
              <TriangleAlertIcon aria-hidden="true" className="size-4 text-warning-foreground" />
              <span className="text-[0.8125rem]">Wrong network</span>
              <ChevronDownIcon aria-hidden="true" className="size-4 text-muted-foreground" />
            </button>
          )
        }
        return (
          <button type="button" onClick={openAccountModal} className={pill}>
            <ChainIcon chainId={data.collection.chain.id} className="size-4 text-muted-foreground" />
            <span className="sr-only">On {data.collection.chain.name}, </span>
            <span className="numeric text-[0.8125rem]">{shortAddress(account.address)}</span>
            <ChevronDownIcon aria-hidden="true" className="size-4 text-muted-foreground" />
          </button>
        )
      }}
    </ConnectButton.Custom>
  )
}
