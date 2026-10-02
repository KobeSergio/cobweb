'use client'

import '@rainbow-me/rainbowkit/styles.css'

import { darkTheme, RainbowKitProvider } from '@rainbow-me/rainbowkit'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { WagmiProvider } from 'wagmi'
import { Toaster } from '@cobweb/ui/components/sonner'
import { TooltipProvider } from '@cobweb/ui/components/tooltip'
import { wagmiConfig } from '@/lib/wagmi'

// RainbowKit's theme takes CSS values, so it reads the same tokens as everything else.
const rainbowKitTheme = {
  ...darkTheme({ borderRadius: 'medium', overlayBlur: 'small' }),
  fonts: { body: 'var(--font-sans)' },
}
rainbowKitTheme.colors.accentColor = 'var(--primary)'
rainbowKitTheme.colors.accentColorForeground = 'var(--primary-foreground)'
rainbowKitTheme.colors.modalBackground = 'var(--popover)'
rainbowKitTheme.colors.modalBorder = 'var(--border)'
rainbowKitTheme.colors.modalText = 'var(--foreground)'
rainbowKitTheme.colors.modalTextSecondary = 'var(--muted-foreground)'

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } }),
  )

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={rainbowKitTheme} modalSize="compact">
          <TooltipProvider>{children}</TooltipProvider>
          <Toaster position="bottom-right" />
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}
