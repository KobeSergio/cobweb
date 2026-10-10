import { chainById, isProduction, type Env } from './chains.ts'

/** The chain's RPC URL, for server code. Throws a sentence when the chain or its variable is not set. */
export function rpcUrl(id: number, env: Env = process.env, production = isProduction()): string {
  const chain = chainById(id, production)
  const value = chain ? env[chain.rpcEnv] : undefined
  if (!value) throw new Error(`The RPC URL for chain ${id} is not configured.`)
  return value
}
