import type { Metadata } from 'next'
import { Poppins } from 'next/font/google'
import '@cobweb/ui/globals.css'
import { Providers } from '@/components/providers'

const poppins = Poppins({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-poppins',
  display: 'swap',
})

export const metadata: Metadata = {
  title: { default: 'Cobweb', template: '%s · Cobweb' },
  description: 'Launch and manage an NFT collection without writing code.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${poppins.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
