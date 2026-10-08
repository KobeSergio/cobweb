import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // The UI and DNA packages ship TypeScript source, so Next compiles it with the app.
  transpilePackages: ['@cobweb/ui', '@cobweb/dna'],
  poweredByHeader: false,
  experimental: {
    // A save is about 400 bytes per token, so 100,000 tokens (MAX_SUPPLY) is about 40 MB; the default is 1 MB.
    serverActions: { bodySizeLimit: '64mb' },
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // The app asks wallets for signatures and, later, transactions. It must never be shown
          // inside another site's frame, where a click could be disguised.
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ]
  },
  turbopack: {
    resolveAlias: {
      // RainbowKit's wallet list includes the Base Account connector, whose SDK pulls in optional
      // packages that are not installed. Cobweb does not offer that wallet, so its SDK is replaced
      // with an empty module. The connector only loads the SDK if someone connects with it.
      '@base-org/account': './src/lib/empty-module.ts',
    },
  },
}

export default nextConfig
