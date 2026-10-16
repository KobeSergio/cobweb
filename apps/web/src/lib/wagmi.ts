import { hidesTestChains } from '@cobweb/shared'
import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import type { Transport } from 'viem'
import { http } from 'wagmi'
import {
  anvil,
  arbitrum,
  base,
  berachain,
  mainnet,
  monad,
  robinhood,
  robinhoodTestnet,
  sepolia,
} from 'wagmi/chains'

/**
 * The chains Cobweb launches on, plus Sepolia, Robinhood Chain Testnet and a local Anvil chain for testing,
 * unless the shared rule hides them: production without COBWEB_TEST_CHAINS=1
 * (docs/specs/2026-10-16-freshness-server.md, section 7.2).
 */
const launchChains = [mainnet, arbitrum, base, berachain, monad, robinhood] as const

export const chains = hidesTestChains()
  ? launchChains
  : ([...launchChains, sepolia, robinhoodTestnet, anvil] as const)

/**
 * One transport per chain, `http()` on viem's public endpoint for it, with no key in the bundle: the mint page's
 * check and receipt go through it and the send through the wallet. Both concern the visitor's own transaction,
 * not shared state (docs/specs/2026-10-16-mint-page-live-data.md, decision 16).
 */
export const transports = Object.fromEntries(chains.map((chain) => [chain.id, http()])) as Record<
  (typeof chains)[number]['id'],
  Transport
>

export const wagmiConfig = getDefaultConfig({
  appName: 'Cobweb',
  // Without a real id, WalletConnect (QR and mobile wallets) will not connect. Browser-extension
  // wallets still work.
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'missing-walletconnect-project-id',
  chains,
  transports,
  ssr: true,
})
