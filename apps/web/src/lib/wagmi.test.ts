import { availableChains } from '@cobweb/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'

// RainbowKit builds its config when the module loads; this test reads what it is given.
vi.mock('@rainbow-me/rainbowkit', () => ({ getDefaultConfig: (parameters: unknown) => parameters }))

describe('the wallet chains (docs/specs/2026-10-16-freshness-server.md, section 7.2)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it("are the shared list's chains in its order, with the test chains and without them", async () => {
    for (const nodeEnv of ['test', 'production']) {
      vi.stubEnv('NODE_ENV', nodeEnv)
      vi.stubEnv('COBWEB_TEST_CHAINS', undefined)
      vi.resetModules()
      const { chains } = await import('./wagmi')
      expect(chains.map((chain) => chain.id)).toEqual(availableChains().map((chain) => chain.id))
    }
  })

  it('name a transport for each chain (docs/specs/2026-10-16-mint-page-live-data.md, decision 16)', async () => {
    const { chains, transports, wagmiConfig } = await import('./wagmi')
    const ids = (list: number[]) => [...list].sort((a, b) => a - b)
    expect(ids(Object.keys(transports).map(Number))).toEqual(ids(chains.map((chain) => chain.id)))
    expect((wagmiConfig as unknown as { transports: unknown }).transports).toBe(transports)
  })
})
