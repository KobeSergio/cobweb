import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import { anvil, arbitrum, base, berachain, mainnet, monad, robinhood, sepolia } from 'wagmi/chains'

/** The chains Cobweb launches on, plus Sepolia and a local Anvil chain outside production for testing. */
const launchChains = [mainnet, arbitrum, base, berachain, monad, robinhood] as const

export const chains =
  process.env.NODE_ENV === 'production' ? launchChains : ([...launchChains, sepolia, anvil] as const)

export const wagmiConfig = getDefaultConfig({
  appName: 'Cobweb',
  // Without a real id, WalletConnect (QR and mobile wallets) will not connect. Browser-extension
  // wallets still work.
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'missing-walletconnect-project-id',
  chains,
  ssr: true,
})
