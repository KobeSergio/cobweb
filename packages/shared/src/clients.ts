import { createPublicClient, http, type PublicClient } from 'viem'
import { chainById } from './chains.ts'
import { rpcUrl } from './rpc.ts'

const clients = new Map<number, PublicClient>()

/** A viem public client for a chain over its configured RPC URL. Server code only: the URL is a secret. */
export function publicClientFor(chainId: number): PublicClient {
  const known = clients.get(chainId)
  if (known) return known
  const chain = chainById(chainId)
  if (!chain) throw new Error(`Chain ${chainId} is not supported.`)
  const client = createPublicClient({ chain: chain.viem, transport: http(rpcUrl(chainId)) })
  clients.set(chainId, client)
  return client
}
