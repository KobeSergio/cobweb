// Checks the freshness server against a LOCAL Anvil chain (docs/specs/2026-10-16-freshness-server.md, section
// 10): the server runs in process from @cobweb/freshness/server, reading the chain through an RPC switch (an
// HTTP server on 127.0.0.1 that forwards each request to Anvil, answers 503 while failing and counts what it
// carries), and two collections deployed straight through the factory (each deploy simulated, then the
// simulated request sent), recording nothing, are polled every 100 ms: the refusals, the first read, the
// tier, the ETag, a phase scheduled at T read inactive at T-1 and active within one tick of the first block
// at T, the wallet endpoint and its windows, the extras on their logs, a first read pending, degraded,
// /health and the stop. Sixteen PASS lines. Needs Anvil with the factory and nothing else.
//
//   pnpm --filter @cobweb/web chain:local    (then copy its two lines into apps/web/.env.local)
//   pnpm --filter @cobweb/web verify:freshness
//
// The chain fixture (scripts/chain-fixture.ts) reads the settings from the environment and
// apps/web/.env.local and refuses a non-local endpoint. Never prints a key. The two collections stay on
// Anvil, and the chain's clock ends about 600 s ahead of where it was. Runs under `node
// --conditions=react-server --import ./scripts/resolve-ts.mjs`.

import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { getAddress, isAddressEqual, keccak256, parseEther, toHex, zeroAddress, type Address } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { chainStateOf, DEFAULT_TRANSFER_VALIDATOR } from '@cobweb/shared'
import { collectionAbi } from '@cobweb/shared/collection-abi'
import {
  startFreshness,
  TIER_MS,
  type Freshness,
  type HealthBody,
  type StateBody,
  type WalletBody,
} from '@cobweb/freshness/server'
import {
  chain,
  chainReady,
  check,
  CID,
  collectionSalt,
  COLLECTION_CREATION_CODE,
  encodeCollectionArgs,
  factory,
  factoryAbi,
  predictCollectionAddress,
  rpc,
  runChecks,
  sendCall,
  sendRequest,
} from './chain-fixture.ts'

const { phaseCalls, settingsCalls } = await import('../src/lib/manage/phase-calls.ts')

/** The launch groups each collection deploys with: Public (id 0) and Holders (id 1). */
const PUBLIC = 0
const HOLDERS = 1
const STATE_CACHE = 'public, max-age=0, s-maxage=1, stale-while-revalidate=1, stale-if-error=60'
/** The headers every answer with CORS lets a page's script read. */
const EXPOSED = 'ETag, Retry-After'
/** The time the slowest RPC retry in flight may add to a tick: viem's three, at 150, 300 and 600 ms. */
const RETRY_SLACK_MS = 1_200

const creatorKey = privateKeyToAccount(generatePrivateKey())
const holderKey = privateKeyToAccount(generatePrivateKey())
const strangerKey = privateKeyToAccount(generatePrivateKey())

type Answer = { status: number; headers: Headers; text: string }

/**
 * An HTTP server on 127.0.0.1 that forwards each request to Anvil, answers 503 while failing, and counts
 * them.
 */
async function rpcSwitch(target: string) {
  let failing = false
  let carried = 0
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      carried++
      if (failing) {
        response.writeHead(503, { 'Content-Type': 'text/plain' }).end('failing')
        return
      }
      fetch(target, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: Buffer.concat(chunks),
      })
        .then(async (answer) => {
          const body = Buffer.from(await answer.arrayBuffer())
          response.writeHead(answer.status, { 'Content-Type': 'application/json' }).end(body)
        })
        .catch(() => response.writeHead(502).end())
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    fail: (on: boolean) => {
      failing = on
    },
    carried: () => carried,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      }),
  }
}

let rpcSwitchOn: Awaited<ReturnType<typeof rpcSwitch>> | null = null
let freshness: Freshness | null = null

/** A request to the server, failed after 5 s so a hung answer fails its check instead of stalling it. */
async function get(path: string, init?: RequestInit): Promise<Answer> {
  if (!freshness) throw new Error('the server is not running')
  const response = await fetch(`${freshness.url}${path}`, { ...init, signal: AbortSignal.timeout(5_000) })
  return { status: response.status, headers: response.headers, text: await response.text() }
}
const stateOf = (address: Address, init?: RequestInit) =>
  get(`/v1/state/31337/${address.toLowerCase()}`, init)
const walletOf = (address: Address, wallet: Address) =>
  get(`/v1/wallet/31337/${address.toLowerCase()}/${wallet.toLowerCase()}`)
const healthOf = async () => JSON.parse((await get('/health')).text) as HealthBody
const bodyOf = (answer: Answer) => JSON.parse(answer.text) as StateBody
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Polls every 100 ms until `fn` answers something other than null, or answers null after `ms`. */
async function poll<T>(fn: () => Promise<T | null>, ms: number): Promise<T | null> {
  const until = Date.now() + ms
  for (;;) {
    const value = await fn()
    if (value !== null || Date.now() >= until) return value
    await wait(100)
  }
}

/** One tick of the chain at its tier now, plus the read: how long a change may take to show. */
async function oneTick(): Promise<number> {
  const tier = (await healthOf()).chains[0]?.tier ?? 'live'
  return TIER_MS[tier] + 500
}

/**
 * A collection deployed straight through the factory from the creator, recording nothing: the deploy is
 * simulated, the factory's answer must be the predicted address, and the simulated request is sent as it is.
 */
async function deployCollection(name: string): Promise<Address> {
  const args = encodeCollectionArgs({
    name,
    symbol: 'FRESH',
    payout: creatorKey.address,
    baseUri: `ipfs://${CID('e')}/`,
    maxSupply: 5n,
    groupSupplies: [3n, 2n],
    groupPrices: [0n, 0n],
    publicMaxPerWallet: 2n,
    royaltyBps: 500,
    owner: creatorKey.address,
    royaltyReceiver: creatorKey.address,
  })
  const salt = collectionSalt(randomUUID())
  const address = predictCollectionAddress({
    factory,
    deployer: creatorKey.address,
    salt,
    creationCode: COLLECTION_CREATION_CODE,
    args,
  })
  const { request, result } = await chain.simulateContract({
    account: creatorKey,
    address: factory,
    abi: factoryAbi,
    functionName: 'deployCollection',
    args: [COLLECTION_CREATION_CODE, args, salt],
  })
  if (!isAddressEqual(result, address)) throw new Error(`${name} would deploy at ${result}, not ${address}`)
  await sendRequest(creatorKey, request)
  return address
}

async function main(): Promise<void> {
  console.log(`Verifying the freshness server against ${rpc}`)
  await check(
    '1. chain: Anvil answers as 31337 and the factory approves the shipped creation code hash',
    chainReady,
  )
  for (const key of [creatorKey, holderKey, strangerKey])
    await chain.setBalance({ address: key.address, value: parseEther('10') })
  const A = await deployCollection('Freshness A')
  const B = await deployCollection('Freshness B')

  rpcSwitchOn = await rpcSwitch(rpc)
  const relay = rpcSwitchOn
  // The server reads through the switch only because startFreshness creates this process's first
  // publicClientFor(31337), which reads RPC_URL_31337 then and keeps its client: nothing before it may ask
  // for one (the fixture's Anvil client is its own).
  process.env.RPC_URL_31337 = relay.url
  freshness = await startFreshness({ port: 0, host: '127.0.0.1', chainIds: [31337] })

  await check(
    '2. at start: before any request, /health answers 200 with no-store, chain 31337 served with no hot collection and no block, and the switch has carried no request',
    async () => {
      const answer = await get('/health')
      const body = JSON.parse(answer.text) as HealthBody
      if (answer.status !== 200 || answer.headers.get('cache-control') !== 'no-store')
        return `${answer.status} ${answer.headers.get('cache-control')}`
      const [anvilHealth] = body.chains
      if (body.chains.length !== 1 || anvilHealth?.chainId !== 31337) return JSON.stringify(body.chains)
      if (anvilHealth.hot !== 0 || anvilHealth.tier !== null || anvilHealth.block !== null)
        return JSON.stringify(anvilHealth)
      return relay.carried() === 0 ? null : `the switch carried ${relay.carried()} requests`
    },
  )

  await check(
    "3. refusals: the stranger's wallet and the factory answer 404 not-a-collection, chain 999 answers 404 chain-not-served, a malformed address 400 and an unknown path 404, each with s-maxage=10; a POST answers 405 with Allow: GET, HEAD, OPTIONS",
    async () => {
      const cases: [Answer, number, string][] = [
        [await stateOf(strangerKey.address), 404, 'not-a-collection'],
        [await stateOf(factory), 404, 'not-a-collection'],
        [await get(`/v1/state/999/${A.toLowerCase()}`), 404, 'chain-not-served'],
        [await get(`/v1/state/31337/${A.toLowerCase().slice(0, -1)}`), 400, 'bad-request'],
        [await get('/v1/collections'), 404, 'not-found'],
      ]
      for (const [answer, status, error] of cases) {
        const cache = answer.headers.get('cache-control')
        if (
          answer.status !== status ||
          answer.text !== JSON.stringify({ error }) ||
          !cache?.includes('s-maxage=10')
        )
          return `${error}: ${answer.status} ${answer.text} ${cache}`
      }
      const post = await stateOf(A, { method: 'POST' })
      return post.status === 405 &&
        post.text === '{"error":"method-not-allowed"}' &&
        post.headers.get('allow') === 'GET, HEAD, OPTIONS'
        ? null
        : `POST: ${post.status} ${post.text} ${post.headers.get('allow')}`
    },
  )

  await sendCall(creatorKey, A, phaseCalls.open(HOLDERS))
  const T = Number((await chain.getBlock()).timestamp) + 600
  await sendCall(creatorKey, A, phaseCalls.schedule(PUBLIC, T))
  let etag = ''

  await check(
    "4. first read: with Holders open and Public scheduled at T, 600 s after the latest block, A's first request answers 200 within the join wait; its collectionState fields equal a direct read at its block; the owner, a royalty of 500 bps to the creator, the base URI and the default validator are A's; transferLevel is none, degraded false and readAt within 2 s; with the state's cache headers, a weak ETag and Access-Control-Allow-Origin *",
    async () => {
      const startedAt = Date.now()
      const answer = await stateOf(A)
      const took = Date.now() - startedAt
      if (answer.status !== 200 || took > 2_000) return `${answer.status} after ${took} ms: ${answer.text}`
      const body = bodyOf(answer)
      const direct = await chain.readContract({
        address: A,
        abi: collectionAbi,
        functionName: 'collectionState',
        blockNumber: BigInt(body.block),
      })
      const expected = chainStateOf(direct, BigInt(body.block))
      const read = {
        blockTimestamp: body.blockTimestamp,
        maxSupply: body.maxSupply,
        totalMinted: body.totalMinted,
        publicMaxMintPerWallet: body.publicMaxMintPerWallet,
        mintOnBehalfActive: body.mintOnBehalfActive,
        groups: body.groups,
        fees: [body.mintFeeFlatWei, body.mintFeeBps, body.airdropFeePerTokenWei],
      }
      const want = {
        blockTimestamp: expected.blockTimestamp,
        maxSupply: expected.maxSupply,
        totalMinted: expected.totalMinted,
        publicMaxMintPerWallet: expected.publicMaxMintPerWallet,
        mintOnBehalfActive: expected.mintOnBehalfActive,
        groups: expected.groups,
        fees: [
          direct.mintFeeFlat.toString(),
          Number(direct.mintFeeBps),
          direct.airdropFeePerToken.toString(),
        ],
      }
      if (JSON.stringify(read) !== JSON.stringify(want)) return `read ${JSON.stringify(read)}`
      const extras = [
        body.owner,
        body.royalty.receiver,
        body.royalty.bps,
        body.baseUri,
        body.transferValidator,
      ]
      const wantExtras = [
        creatorKey.address,
        creatorKey.address,
        500,
        `ipfs://${CID('e')}/`,
        DEFAULT_TRANSFER_VALIDATOR,
      ]
      if (JSON.stringify(extras) !== JSON.stringify(wantExtras)) return `extras ${JSON.stringify(extras)}`
      if (
        body.transferLevel !== 'none' ||
        body.degraded ||
        Math.abs(Date.now() - body.readAt * 1_000) > 2_000
      )
        return `level ${body.transferLevel}, degraded ${body.degraded}, readAt ${body.readAt}`
      etag = answer.headers.get('etag') ?? ''
      return answer.headers.get('cache-control') === STATE_CACHE &&
        /^W\/"[0-9a-f]{32}"$/.test(etag) &&
        answer.headers.get('access-control-allow-origin') === '*'
        ? null
        : `headers ${answer.headers.get('cache-control')} ${etag}`
    },
  )

  await check('5. tier: /health reports chain 31337 at the 2 s tier with one hot collection', async () => {
    const [anvilHealth] = (await healthOf()).chains
    return anvilHealth?.tier === 'live' && anvilHealth.hot === 1 ? null : JSON.stringify(anvilHealth)
  })

  await check(
    '6. ETag: an empty block is read under the same ETag; If-None-Match with it answers 304 with no body and the same headers, another tag answers 200; OPTIONS answers 204 with the CORS headers; each exposes ETag and Retry-After',
    async () => {
      const exposed = (answer: Answer) => answer.headers.get('access-control-expose-headers') === EXPOSED
      const block = bodyOf(await stateOf(A)).block
      await chain.mine({ blocks: 1 })
      const after = await poll(
        async () => {
          const answer = await stateOf(A)
          return bodyOf(answer).block > block ? answer : null
        },
        await oneTick(),
      )
      if (!after) return 'the empty block was not read'
      if (after.headers.get('etag') !== etag) return `the tag moved: ${after.headers.get('etag')}`
      if (!exposed(after)) return `exposed: ${after.headers.get('access-control-expose-headers')}`
      const same = await stateOf(A, { headers: { 'If-None-Match': etag } })
      if (
        same.status !== 304 ||
        same.text !== '' ||
        same.headers.get('etag') !== etag ||
        same.headers.get('cache-control') !== STATE_CACHE ||
        same.headers.get('access-control-allow-origin') !== '*' ||
        !exposed(same)
      )
        return `304: ${same.status} ${same.headers.get('etag')} ${same.headers.get('cache-control')}`
      const other = await stateOf(A, { headers: { 'If-None-Match': 'W/"0"' } })
      if (other.status !== 200 || !exposed(other)) return `another tag: ${other.status}`
      const preflight = await stateOf(A, { method: 'OPTIONS' })
      return preflight.status === 204 &&
        preflight.headers.get('access-control-allow-origin') === '*' &&
        preflight.headers.get('access-control-allow-methods') === 'GET, HEAD' &&
        preflight.headers.get('access-control-allow-headers') === 'If-None-Match' &&
        preflight.headers.get('access-control-max-age') === '86400' &&
        exposed(preflight)
        ? null
        : `OPTIONS: ${preflight.status}`
    },
  )

  /** Every answer polled from T-1 on, for check 8. */
  const sinceStart: StateBody[] = []
  let etagAtStart = ''

  await check(
    '7. at T-1: a block mined at T-1 with evm_setNextBlockTimestamp and evm_mine is read within one tick: blockTimestamp T-1, Public with flag false, startTimestamp T and active false; /health then reports the 1 s tier',
    async () => {
      const bound = await oneTick()
      await chain.setNextBlockTimestamp({ timestamp: BigInt(T - 1) })
      await chain.mine({ blocks: 1 })
      const seen = await poll(async () => {
        const answer = await stateOf(A)
        const body = bodyOf(answer)
        sinceStart.push(body)
        if (body.blockTimestamp !== T - 1) return null
        etagAtStart = answer.headers.get('etag') ?? ''
        return body
      }, bound)
      if (!seen) return `T-1 was not read within ${bound} ms`
      const publicGroup = seen.groups.find((group) => group.id === PUBLIC)
      if (publicGroup?.flag !== false || publicGroup.startTimestamp !== T || publicGroup.active !== false)
        return `Public at T-1: ${JSON.stringify(publicGroup)}`
      const tier = (await healthOf()).chains[0]?.tier
      return tier === 'fast' ? null : `tier ${tier}`
    },
  )

  await check(
    '8. at T: a block mined at T is read within 1.5 s (one 1 s tick and the read) with Public active true under a new ETag, and no answer polled since T-1 with a blockTimestamp below T read Public active',
    async () => {
      await chain.setNextBlockTimestamp({ timestamp: BigInt(T) })
      await chain.mine({ blocks: 1 })
      const live = await poll(async () => {
        const answer = await stateOf(A)
        const body = bodyOf(answer)
        sinceStart.push(body)
        const active = body.groups.find((group) => group.id === PUBLIC)?.active
        return body.blockTimestamp >= T && active ? answer : null
      }, 1_500)
      if (!live) return 'Public did not read active within 1.5 s of the block at T'
      if (live.headers.get('etag') === etagAtStart) return 'the tag did not change'
      const early = sinceStart.filter(
        (body) => body.blockTimestamp < T && body.groups.find((group) => group.id === PUBLIC)?.active,
      )
      return early.length === 0 ? null : `${early.length} answers read Public active before T`
    },
  )

  await sendCall(creatorKey, A, phaseCalls.quotas(HOLDERS, [holderKey.address], [2]))

  await check(
    "9. wallet: once the creator writes a quota of 2 for the holder in Holders, the holder's answer reads publicMinted 0, Holders quota 2 and claimed 0, and the stranger's Holders quota 0, both with no vaults (Anvil has no registry code) and s-maxage=5",
    async () => {
      const holder = await walletOf(A, holderKey.address)
      const stranger = await walletOf(A, strangerKey.address)
      for (const answer of [holder, stranger])
        if (answer.status !== 200 || answer.headers.get('cache-control') !== 'public, max-age=0, s-maxage=5')
          return `${answer.status} ${answer.headers.get('cache-control')} ${answer.text}`
      const own = JSON.parse(holder.text) as WalletBody
      const other = JSON.parse(stranger.text) as WalletBody
      const holders = (body: WalletBody) => body.groups.find((group) => group.id === HOLDERS)
      return own.wallet === holderKey.address &&
        own.publicMinted === 0 &&
        holders(own)?.quota === 2 &&
        holders(own)?.claimed === 0 &&
        holders(other)?.quota === 0 &&
        own.vaults.length === 0 &&
        other.vaults.length === 0
        ? null
        : `${holder.text} ${stranger.text}`
    },
  )

  await check(
    "10. a mint: the holder mints one from Holders with the value quoteBatchMint answers; its answer reads claimed 1 at once, and A's state reads Holders minted 1 and totalMinted 1 under a new ETag within one tick",
    async () => {
      const before = (await stateOf(A)).headers.get('etag')
      const [totalCost] = await chain.readContract({
        address: A,
        abi: collectionAbi,
        functionName: 'quoteBatchMint',
        args: [BigInt(HOLDERS), 1n],
      })
      const { request } = await chain.simulateContract({
        account: holderKey,
        address: A,
        abi: collectionAbi,
        functionName: 'batchMint',
        args: [1n, BigInt(HOLDERS)],
        value: totalCost,
      })
      await sendRequest(holderKey, request)
      // One tick counted from the receipt, so the wallet read's own window comes out of it.
      const receiptAt = Date.now()
      const bound = await oneTick()
      const answer = JSON.parse((await walletOf(A, holderKey.address)).text) as WalletBody
      if (answer.groups.find((group) => group.id === HOLDERS)?.claimed !== 1)
        return `wallet ${JSON.stringify(answer)}`
      const minted = await poll(
        async () => {
          const state = await stateOf(A)
          const body = bodyOf(state)
          return body.totalMinted === 1 && body.groups.find((group) => group.id === HOLDERS)?.minted === 1
            ? state
            : null
        },
        bound - (Date.now() - receiptAt),
      )
      if (!minted) return `the mint was not read within ${bound} ms of its receipt`
      return minted.headers.get('etag') !== before ? null : 'the tag did not change'
    },
  )

  await check(
    "11. windows: ten wallets asked together are answered from one 200 ms window: /health's wallet windows rise by one and answered by ten",
    async () => {
      const before = (await healthOf()).wallet
      const wallets = Array.from({ length: 10 }, (_, index) =>
        getAddress(`0x${keccak256(toHex(`freshness wallet ${index}`)).slice(26)}`),
      )
      const answers = await Promise.all(wallets.map((wallet) => walletOf(A, wallet)))
      if (answers.some((answer) => answer.status !== 200))
        return answers.map((answer) => answer.status).join(' ')
      const after = (await healthOf()).wallet
      return after.windows === before.windows + 1 && after.answered === before.answered + 10
        ? null
        : `${JSON.stringify(before)} then ${JSON.stringify(after)}`
    },
  )

  await check(
    "12. extras on their logs: setBaseURI to ipfs://<CID('f')>/, a royalty of 750 bps to the stranger and the validator set to the zero address each read within one tick of their receipt, the last with transferLevel none",
    async () => {
      const changes: [string, ReturnType<typeof settingsCalls.baseUri>, (body: StateBody) => boolean][] = [
        [
          'the base URI',
          settingsCalls.baseUri(`ipfs://${CID('f')}/`),
          (body) => body.baseUri === `ipfs://${CID('f')}/`,
        ],
        [
          'the royalty',
          settingsCalls.royalty(strangerKey.address, 750),
          (body) => body.royalty.receiver === strangerKey.address && body.royalty.bps === 750,
        ],
        [
          'the validator',
          settingsCalls.validator(zeroAddress),
          (body) => body.transferValidator === zeroAddress && body.transferLevel === 'none',
        ],
      ]
      for (const [label, call, done] of changes) {
        const bound = await oneTick()
        await sendCall(creatorKey, A, call)
        const read = await poll(async () => (done(bodyOf(await stateOf(A))) ? true : null), bound)
        if (!read) return `${label} was not read within ${bound} ms of its receipt`
      }
      return null
    },
  )

  await check(
    '13. first read pending: B, known as a collection from a wallet request, answers 503 not-read-yet with Retry-After 1 and no-store while the switch fails, then 200 within two ticks of it passing again',
    async () => {
      const known = await walletOf(B, holderKey.address)
      if (known.status !== 200) return `the wallet request: ${known.status} ${known.text}`
      if ((await healthOf()).hot !== 1) return 'the wallet request made B hot'
      relay.fail(true)
      let pending: Answer
      try {
        pending = await stateOf(B)
      } finally {
        relay.fail(false)
      }
      if (
        pending.status !== 503 ||
        pending.text !== '{"error":"not-read-yet"}' ||
        pending.headers.get('retry-after') !== '1' ||
        pending.headers.get('cache-control') !== 'no-store'
      )
        return `while failing: ${pending.status} ${pending.text} ${pending.headers.get('cache-control')}`
      const bound = 2 * TIER_MS.live + RETRY_SLACK_MS
      const read = await poll(async () => ((await stateOf(B)).status === 200 ? true : null), bound)
      return read ? null : `B was not read within ${bound} ms of the switch passing`
    },
  )

  await check(
    '14. degraded: with the switch failing, A answers its last state with degraded true under a new ETag once its last read is more than 10 s old, readAt unchanged, and /health names the failure; with the switch passing, degraded is false again within one tick',
    async () => {
      const failedBefore = (await healthOf()).chains[0]?.failedTicks ?? 0
      const firstFailure = (await oneTick()) + RETRY_SLACK_MS
      let fresh: Answer
      let stale: { answer: Answer; body: StateBody; at: number } | null
      let failing: HealthBody['chains'][number] | undefined
      relay.fail(true)
      try {
        // A tick in flight as the switch flips can still land, so the last read is taken once a tick failed.
        const failed = await poll(async () => {
          const failedTicks = (await healthOf()).chains[0]?.failedTicks ?? 0
          return failedTicks > failedBefore ? true : null
        }, firstFailure)
        if (!failed) return `no tick failed within ${firstFailure} ms of the switch failing`
        fresh = await stateOf(A)
        stale = await poll(async () => {
          const answer = await stateOf(A)
          const body = bodyOf(answer)
          if (!body.degraded) return null
          return { answer, body, at: Date.now() }
        }, 15_000)
        failing = (await healthOf()).chains[0]
      } finally {
        relay.fail(false)
      }
      const readAt = bodyOf(fresh).readAt
      if (!stale) return 'A never read degraded'
      if (stale.body.readAt !== readAt) return `readAt moved from ${readAt} to ${stale.body.readAt}`
      if (stale.at - readAt * 1_000 <= 10_000)
        return `degraded ${stale.at - readAt * 1_000} ms after the read`
      if (stale.answer.headers.get('etag') === fresh.headers.get('etag')) return 'the tag did not change'
      if (failing?.lastError !== 'HttpRequestError' || !failing.failedTicks) return JSON.stringify(failing)
      const bound = (await oneTick()) + RETRY_SLACK_MS
      const recovered = await poll(async () => (bodyOf(await stateOf(A)).degraded ? null : true), bound)
      return recovered ? null : `still degraded ${bound} ms after the switch passed`
    },
  )

  await check(
    "15. health: /health reports chain 31337 with two hot collections, its tier, block, lag and last good tick, and neither the switch's URL nor Anvil's",
    async () => {
      const answer = await get('/health')
      const [anvilHealth] = (JSON.parse(answer.text) as HealthBody).chains
      if (
        anvilHealth?.hot !== 2 ||
        anvilHealth.tier === null ||
        anvilHealth.block === null ||
        anvilHealth.lagSeconds === null ||
        anvilHealth.lastGoodTickAt === null
      )
        return JSON.stringify(anvilHealth)
      const hosts = [new URL(relay.url).host, new URL(rpc).host]
      return hosts.some((host) => answer.text.includes(host)) || /:\/\//.test(answer.text)
        ? `a URL is in ${answer.text}`
        : null
    },
  )

  await check(
    '16. stop: close() ends the server; its port refuses a connection and the switch carries no request for 3 s',
    async () => {
      const server = freshness
      if (!server) return 'the server is not running'
      await server.close()
      freshness = null
      const carried = relay.carried()
      let refused = false
      try {
        await fetch(`${server.url}/health`)
      } catch {
        refused = true
      }
      await wait(3_000)
      return refused && relay.carried() === carried
        ? null
        : `refused ${refused}, carried ${relay.carried() - carried}`
    },
  )
}

async function cleanup(): Promise<void> {
  await freshness?.close()
  await rpcSwitchOn?.close()
}

await runChecks(main, cleanup)
