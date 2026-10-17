import type { Metadata } from 'next'
import { Geist_Mono, Poppins } from 'next/font/google'
import { connection } from 'next/server'
import '@cobweb/ui/globals.css'
import { Providers } from '@/components/providers'

const poppins = Poppins({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-poppins',
  display: 'swap',
})

// Numbers that are data (prices, supply, token ids, addresses, countdowns) use this through
// `font-mono` or the `numeric` utility.
const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: { default: 'Cobweb', template: '%s · Cobweb' },
  description: 'Launch and manage an NFT collection without writing code.',
}

/**
 * Every page renders for its request, so each response's scripts carry that response's nonce
 * (docs/specs/2026-10-17-production-hardening.md, decision 9); only Next's own `/_global-error` is prerendered.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await connection()
  return (
    <html lang="en" className={`dark ${poppins.variable} ${geistMono.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
