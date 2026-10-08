import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // The UI and DNA packages ship TypeScript source, so Next compiles it with the app.
  transpilePackages: ['@cobweb/ui', '@cobweb/dna'],
  poweredByHeader: false,
  experimental: {
    // A token action carries one chunk of at most CHUNK_BUDGET_BYTES (3.5 MB of JSON, and at most
    // TOKEN_CHUNK, 10,000 rows) in the token-ops module. Vercel caps a request body at 4.5 MB, so
    // that is the real limit; this 8 MB is only headroom over the 1 MB default for the action
    // framing and a few large non-token payloads.
    serverActions: { bodySizeLimit: '8mb' },
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
