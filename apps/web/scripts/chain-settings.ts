// The local chain's settings with a non-local endpoint refused (docs/specs/2026-10-16-freshness-server.md,
// section 7.3), and nothing else: importing this module does no work, so render-deps.ts (render:local,
// verify:render) takes the chain's settings from here without the chain fixture's import-time work.
// chain-fixture.ts re-exports both functions. Never prints a key.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getAddress, type Address } from 'viem'
import { isLocalUrl } from '@cobweb/shared'

/**
 * Exits with code 2 unless `url` points at this machine, naming its host only: a hosted RPC URL carries its
 * key.
 */
export function refuseRemote(url: string): void {
  if (isLocalUrl(url)) return
  let host = 'an unreadable address'
  try {
    host = new URL(url).host
  } catch {
    // Keep the placeholder.
  }
  console.error(`Refusing to run: ${host} is not local (expected localhost or 127.0.0.1).`)
  process.exit(2)
}

/**
 * The local chain's settings: RPC_URL_31337 and FACTORY_ADDRESS_31337 from the environment, or from
 * apps/web/.env.local when the environment does not set them (filling the environment the shared clients
 * read), or an explanation on stderr and exit code 2. Refuses an RPC URL that is not local.
 */
export function localChainConfig(): { rpc: string; factory: Address } {
  const envFile = resolve(dirname(fileURLToPath(import.meta.url)), '../.env.local')
  if (existsSync(envFile))
    for (const line of readFileSync(envFile, 'utf8').split('\n')) {
      const [, name, value] = line.match(/^(RPC_URL_31337|FACTORY_ADDRESS_31337)=(.*)$/) ?? []
      if (name && value && process.env[name] === undefined) process.env[name] = value.trim()
    }
  const rpc = process.env.RPC_URL_31337
  const factory = process.env.FACTORY_ADDRESS_31337
  if (!rpc || !factory) {
    console.error(
      'Set RPC_URL_31337 and FACTORY_ADDRESS_31337: run `pnpm --filter @cobweb/web chain:local` and copy its two lines into apps/web/.env.local.',
    )
    process.exit(2)
  }
  refuseRemote(rpc)
  return { rpc, factory: getAddress(factory) }
}
