import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** The package's manifest, for its exports map. */
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  exports: Record<string, string>
}

describe('the clients and server entries (docs/specs/2026-10-16-freshness-server.md, section 5.2)', () => {
  it('exports src/clients.ts as the clients entry, beside the server entry', () => {
    expect(manifest.exports['./clients']).toBe('./src/clients.ts')
    expect(manifest.exports['./server']).toBe('./src/server.ts')
  })

  it('loads the clients entry in plain Node: nothing it imports is server-only', async () => {
    const clients = await import('./clients.ts')
    expect(typeof clients.publicClientFor).toBe('function')
  })

  it('keeps the server-only marker on the server entry, which plain Node refuses to load', async () => {
    await expect(import('./server.ts')).rejects.toThrow(
      'This module cannot be imported from a Client Component module.',
    )
  })
})
