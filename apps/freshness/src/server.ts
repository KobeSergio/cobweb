import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { factoryAbi, factoryAddress } from '@cobweb/shared'
import { publicClientFor } from '@cobweb/shared/clients'
import type { Address } from 'viem'
import { chainReader } from './chain-reader.ts'
import { collectionCheck } from './collection-check.ts'
import { servedChains } from './config.ts'
import { errorLine, type HealthBody } from './health.ts'
import { hotSet, JOIN_WAIT_MS, type HotEntry } from './hot-set.ts'
import {
  healthAnswer,
  PREFLIGHT,
  refusal,
  routeOf,
  stateAnswer,
  walletAnswer,
  type Answer,
} from './routes.ts'
import { etagMatches, etagOf, stateBody } from './state-body.ts'
import { isDegraded } from './tiers.ts'
import { walletWindows } from './wallet.ts'

export type { HealthBody } from './health.ts'
export type { StateBody } from './state-body.ts'
export { TIER_MS } from './tiers.ts'
export type { WalletBody } from './wallet.ts'

/**
 * The freshness server (docs/specs/2026-10-16-freshness-server.md, section 6): one `node:http` server over
 * the chains whose two variables are set. It makes no call until a request arrives, reads no database, and
 * never computes liveness. `index.ts` starts it on Railway; `verify:freshness` starts it in process.
 */

export type FreshnessOptions = {
  port: number
  host?: string
  /** Limits the chains served; the verify serves Anvil alone. */
  chainIds?: number[]
}

export type Freshness = { url: string; close(): Promise<void> }

/** How often a request waiting on a joining collection looks for its first read. */
const JOIN_POLL_MS = 25

export async function startFreshness(options: FreshnessOptions): Promise<Freshness> {
  const startedAt = new Date().toISOString()
  const hot = hotSet()
  const served = new Map(
    servedChains(options.chainIds).map((chain) => {
      const client = publicClientFor(chain.id)
      return [
        chain.id,
        { chain, client, reader: chainReader(chain, hot, client), windows: walletWindows(chain, client) },
      ]
    }),
  )
  const isCollection = collectionCheck(async (chainId, address) => {
    const chain = served.get(chainId)
    if (!chain) return false
    return chain.client.readContract({
      address: factoryAddress(chainId),
      abi: factoryAbi,
      functionName: 'isCollection',
      args: [address],
    })
  })

  /**
   * The collection check of both routes: 404 for a chain not served or an address not a collection, 503 when
   * the factory cannot be read.
   */
  async function refused(chainId: number, address: Address): Promise<Answer | null> {
    if (!served.has(chainId)) return refusal(404, 'chain-not-served')
    try {
      return (await isCollection(chainId, address)) ? null : refusal(404, 'not-a-collection')
    } catch (error) {
      console.error(`The factory on chain ${chainId} could not be read: ${errorLine(error)}`)
      return refusal(503, 'chain-unreadable')
    }
  }

  /** Waits for an entry's first read until the join wait ends; after that, at once. */
  async function firstRead(entry: HotEntry): Promise<void> {
    const until = entry.joinedAt + JOIN_WAIT_MS
    while (entry.read === null && Date.now() < until)
      await new Promise((resolve) => setTimeout(resolve, Math.min(JOIN_POLL_MS, until - Date.now())))
  }

  async function state(chainId: number, address: Address, ifNoneMatch: string | undefined): Promise<Answer> {
    const refusedAnswer = await refused(chainId, address)
    if (refusedAnswer) return refusedAnswer
    const { reader } = served.get(chainId)!
    const { entry, joined } = hot.join(chainId, address, Date.now())
    if (joined) reader.wake()
    await firstRead(entry)
    if (entry.read === null || entry.readAt === null) return refusal(503, 'not-read-yet')
    const degraded = isDegraded(entry.readAt, Date.now(), reader.health().tier ?? 'live')
    const body = stateBody(chainId, entry, degraded)
    const etag = etagOf(body)
    return stateAnswer(body, etag, etagMatches(ifNoneMatch, etag))
  }

  async function wallet(chainId: number, address: Address, holder: Address): Promise<Answer> {
    const refusedAnswer = await refused(chainId, address)
    if (refusedAnswer) return refusedAnswer
    const answer = await served.get(chainId)!.windows.ask(address, holder)
    if (answer === 'busy') return refusal(503, 'busy')
    if (answer === 'unreadable') return refusal(503, 'wallet-unreadable')
    return walletAnswer(answer)
  }

  function health(): HealthBody {
    const chains = [...served.values()]
    const stats = chains.map(({ windows }) => windows.stats())
    const total = (key: 'windows' | 'answered' | 'waiting') => stats.reduce((sum, stat) => sum + stat[key], 0)
    return {
      status: 'ok',
      startedAt,
      hot: hot.size(),
      chains: chains.map(({ reader }) => reader.health()),
      wallet: { windows: total('windows'), answered: total('answered'), waiting: total('waiting') },
    }
  }

  async function answerOf(request: IncomingMessage): Promise<Answer> {
    const route = routeOf(request.method, request.url)
    if (route.kind === 'refused') return refusal(route.status, route.error)
    if (route.kind === 'preflight') return PREFLIGHT
    if (route.kind === 'health') return healthAnswer(health())
    if (route.kind === 'state') return state(route.chainId, route.address, request.headers['if-none-match'])
    return wallet(route.chainId, route.address, route.wallet)
  }

  /** Writes an answer; HEAD gets the headers alone, with the length the body would have. */
  function send(response: ServerResponse, head: boolean, answer: Answer): void {
    const headers =
      answer.body === null
        ? answer.headers
        : { ...answer.headers, 'Content-Length': String(Buffer.byteLength(answer.body)) }
    response.writeHead(answer.status, headers)
    response.end(head || answer.body === null ? undefined : answer.body)
  }

  // Requests are not logged; a failure is, as its name and viem's short message.
  const server = createServer((request, response) => {
    answerOf(request).then(
      (answer) => send(response, request.method === 'HEAD', answer),
      (error: unknown) => {
        console.error(`A request failed: ${errorLine(error)}`)
        send(response, request.method === 'HEAD', refusal(500, 'internal'))
      },
    )
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port, options.host, () => {
      server.off('error', reject)
      resolve()
    })
  })
  const { port } = server.address() as AddressInfo
  const names = [...served.values()].map(({ chain }) => `${chain.name} (${chain.id})`)
  console.log(
    `The freshness server listens on port ${port}, serving ${names.length ? names.join(', ') : 'no chain'}.`,
  )

  return {
    url: `http://${options.host ?? 'localhost'}:${port}`,
    async close() {
      await Promise.all(
        [...served.values()].flatMap(({ reader, windows }) => [reader.stop(), windows.stop()]),
      )
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
        server.closeAllConnections()
      })
    },
  }
}
