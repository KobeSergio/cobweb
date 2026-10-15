import { availableChains } from '@cobweb/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'

// RainbowKit builds its config when the module loads; this test reads the chain list only.
vi.mock('@rainbow-me/rainbowkit', () => ({ getDefaultConfig: () => ({}) }))

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
})
