import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { factoryAbi, factoryAddress } from '@cobweb/shared'
import { publicClientFor } from '@cobweb/shared/clients'
import type { Address } from 'viem'
import { chainReader } from './chain-reader.ts'
import { collectionCheck } from './collection-check.ts'
import { servedChains, type IndexerOptions } from './config.ts'
import { chainHealth, failureLine, type HealthBody } from './health.ts'
import { hotSet, JOIN_WAIT_MS, type HotEntry } from './hot-set.ts'
import { chainIndexer, type ChainIndexer } from './indexer.ts'
import { supabaseIndexerDb } from './indexer-db.ts'
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

export type { IndexerOptions } from './config.ts'
export type { HealthBody } from './health.ts'
export type { StateBody } from './state-body.ts'
export { TIER_MS } from './tiers.ts'
export type { WalletBody } from './wallet.ts'

/**
 * The freshness server (docs/specs/2026-10-16-freshness-server.md, section 6): one `node:http` server over
 * the chains whose two variables are set. Without the indexer it makes no call until a request arrives; with
 * it, each served chain's indexer reads the chain's collections into the database from the start
 * (docs/specs/2026-10-16-indexer-overview.md, section 6.1), while the request path still reads no database.
 * It never computes liveness. `index.ts` starts it on Railway; `verify:freshness` and `verify:indexer` start
 * it in process.
 */

export type FreshnessOptions = {
  port: number
  host?: string
  /** Limits the chains served; the verify serves Anvil alone. */
  chainIds?: number[]
  /**
   * The indexer's database and pace; without them the indexer is off and the state body's activity is null.
   */
  indexer?: IndexerOptions | null
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
        {
          chain,
          client,
          reader: chainReader(chain, hot, client),
          windows: walletWindows(chain, client),
          // Started once the server listens, so a start that fails leaves no indexer running.
          indexer: null as ChainIndexer | null,
        },
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
   * The collection check of both routes: 404 for a chain not served or an address not a collection, 503 busy
   * when the chain already has 50 factory reads in flight, and 503 when the factory cannot be read, counted
   * on the chain's /health and logged by its reader.
   */
  async function refused(chainId: number, address: Address): Promise<Answer | null> {
    const chain = served.get(chainId)
    if (!chain) return refusal(404, 'chain-not-served')
    try {
      const answer = await isCollection(chainId, address)
      if (answer === 'busy') return refusal(503, 'busy')
      return answer === true ? null : refusal(404, 'not-a-collection')
    } catch (error) {
      chain.reader.noteFailure(error)
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
    const { reader, indexer } = served.get(chainId)!
    const { entry, joined } = hot.join(chainId, address, Date.now())
    if (joined) reader.wake()
    await firstRead(entry)
    if (entry.read === null || entry.readAt === null) return refusal(503, 'not-read-yet')
    const degraded = isDegraded(entry.readAt, Date.now(), reader.health().tier ?? 'live')
    const activity = indexer?.activityOf(entry.address, entry.read.state.blockTimestamp) ?? null
    const body = stateBody(chainId, entry, degraded, activity)
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
      chains: chains.map(({ reader, indexer }) => chainHealth(reader.health(), indexer?.health() ?? null)),
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

  /** The requests being answered; each leaves once its answer is written, and `close()` waits for them. */
  const answering = new Set<Promise<void>>()

  // Requests are not logged; a failure is, as its name, viem's short message and its code, never its message.
  const server = createServer((request, response) => {
    const head = request.method === 'HEAD'
    const answered: Promise<void> = answerOf(request)
      .catch((error: unknown) => {
        console.error(`A request failed: ${failureLine(error)}`)
        return refusal(500, 'internal')
      })
      .then((answer) => send(response, head, answer))
      .finally(() => answering.delete(answered))
    answering.add(answered)
  })
  // Idle connections outlive the 60 s a proxy may keep one, so a proxy never reuses a socket Node closed.
  server.keepAliveTimeout = 65_000
  server.headersTimeout = 66_000
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port, options.host, () => {
      server.off('error', reject)
      resolve()
    })
  })
  const { port } = server.address() as AddressInfo
  const indexing = options.indexer ?? null
  if (indexing) {
    const db = supabaseIndexerDb(indexing)
    for (const entry of served.values())
      entry.indexer = chainIndexer(entry.chain, entry.client, db, {
        tier: () => entry.reader.health().tier,
        passMs: indexing.passMs,
        targetsEveryMs: indexing.targetsEveryMs,
      })
  }
  const names = [...served.values()].map(({ chain }) => `${chain.name} (${chain.id})`)
  const listed = names.length ? names.join(', ') : 'no chain'
  console.log(
    `The freshness server listens on port ${port}, serving ${listed}. ${
      indexing
        ? `The indexer runs on ${listed}.`
        : 'The indexer is off: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to run it.'
    }`,
  )

  /**
   * Stops accepting connections, waits for every reader, window, indexer and request in flight, then closes
   * the connections left and waits for any request a kept-alive connection carried meanwhile, so the server
   * makes no call once it resolves (Decision 3). The first failure is thrown once everything has settled.
   */
  async function shutDown(): Promise<void> {
    const closed = new Promise<Error | undefined>((resolve) => server.close((error) => resolve(error)))
    const settled = await Promise.allSettled([
      ...[...served.values()].flatMap(({ reader, windows, indexer }) => [
        reader.stop(),
        windows.stop(),
        ...(indexer ? [indexer.stop()] : []),
      ]),
      ...answering,
    ])
    server.closeAllConnections()
    settled.push(...(await Promise.allSettled([...answering])))
    const closeError = await closed
    const failure = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failure) throw failure.reason
    if (closeError) throw closeError
  }

  let closing: Promise<void> | null = null
  const host = options.host ?? 'localhost'

  return {
    url: `http://${host.includes(':') ? `[${host}]` : host}:${port}`,
    close() {
      // A second call waits for the first and resolves; only the first answers a failure.
      if (closing) return closing.catch(() => {})
      closing = shutDown()
      return closing
    },
  }
}
