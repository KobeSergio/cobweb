import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // The workspace packages ship TypeScript source, so Next compiles them with the app. The worker and
  // the render library run in the render queue consumer and the sweep cron.
  transpilePackages: ['@cobweb/ui', '@cobweb/dna', '@cobweb/shared', '@cobweb/worker', '@cobweb/render'],
  // sharp is a native module: loaded from node_modules at run time, never bundled.
  serverExternalPackages: ['sharp'],
  poweredByHeader: false,
  // The test-chain switch (docs/specs/2026-10-16-freshness-server.md, section 7.2): Next replaces
  // process.env.COBWEB_TEST_CHAINS with the build's value, so the browser's chain list matches the server's.
  env: { COBWEB_TEST_CHAINS: process.env.COBWEB_TEST_CHAINS ?? '' },
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
          // The app asks wallets for signatures and transactions. It must never be shown inside
          // another site's frame, where a click could be disguised. In enforce and off modes the
          // proxy's Content-Security-Policy says `frame-ancestors 'none'` on every page, and on API
          // routes in every mode; in report-only mode a page carries no enforced policy (an
          // enforced one would hide the nonce from Next, see `cspHeaders`), so this header is the
          // framing block there. On the paths the proxy's matcher skips (the files in public/, the
          // icon, the favicon and the report endpoint) this header is the only block in every mode.
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
