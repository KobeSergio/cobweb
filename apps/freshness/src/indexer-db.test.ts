import type { Address, Hex } from 'viem'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { failureLine } from './health.ts'
import { DB_TIMEOUT_MS, IndexerWriteError, supabaseIndexerDb, type RecordWrite } from './indexer-db.ts'

const URL_BASE = 'http://127.0.0.1:54321'
const KEY = 'service-role-key-value'
const ID = '0a977c0b-7e53-476b-8c08-6c685315c3af'
const CONTRACT: Address = '0x0409454c375c8a6ab05383bfb6d9fcde9ebb8f85'
const MINTER: Address = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8'
const DEPLOY: Hex = `0x${'da'.repeat(32)}`
const MINT_TX: Hex = `0x${'0b'.repeat(32)}`

/** A JSON answer as PostgREST gives it. */
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
/** PostgREST's answer to a function that raised. */
const refusal = (code: string, message: string, status = 400) =>
  json({ code, message, details: null, hint: null }, status)

type Sent = { fn: string; args: Record<string, unknown>; apikey: string | null }

/**
 * A fetch answering each call with the next answer: a response, a network failure, or `hang`, which never
 * answers and fails only when its signal aborts. It records each function called, its arguments and the key.
 */
function fakeFetch(...answers: (Response | 'hang' | 'down')[]) {
  const sent: Sent[] = []
  const impl = ((input: string | URL, init?: RequestInit) => {
    sent.push({
      fn: new URL(String(input)).pathname.replace('/rest/v1/rpc/', ''),
      args: JSON.parse(String(init?.body)) as Record<string, unknown>,
      apikey: new Headers(init?.headers).get('apikey'),
    })
    const answer = answers.shift()
    if (answer === 'down') return Promise.reject(new TypeError('fetch failed'))
    if (answer === 'hang')
      return new Promise((_, reject) =>
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('This operation was aborted', 'AbortError')),
        ),
      )
    return Promise.resolve(answer ?? json(null))
  }) as typeof fetch
  return { sent, db: supabaseIndexerDb({ supabaseUrl: URL_BASE, serviceRoleKey: KEY }, impl) }
}

/** What a promise settles to: its value, or the error it rejected with. */
const settled = <T>(promise: Promise<T>) =>
  promise.then(
    (value) => value,
    (error: unknown) => error,
  )

describe('supabaseIndexerDb (docs/specs/2026-10-16-indexer-overview.md, section 6.2)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('reads the targets with the service role key, blocks as bigints and null without a cursor', async () => {
    const { sent, db } = fakeFetch(
      json([
        {
          collectionId: ID,
          contract: CONTRACT,
          deployTx: DEPLOY,
          fromBlock: null,
          indexedBlock: null,
          syncedAt: null,
        },
        {
          collectionId: ID,
          contract: CONTRACT,
          deployTx: DEPLOY,
          fromBlock: 50,
          indexedBlock: 120,
          syncedAt: 1_800_000_120,
        },
      ]),
    )
    expect(await db.targets(31337)).toEqual([
      {
        collectionId: ID,
        contract: CONTRACT,
        deployTx: DEPLOY,
        fromBlock: null,
        indexedBlock: null,
        syncedAt: null,
      },
      {
        collectionId: ID,
        contract: CONTRACT,
        deployTx: DEPLOY,
        fromBlock: 50n,
        indexedBlock: 120n,
        syncedAt: 1_800_000_120,
      },
    ])
    expect(sent).toEqual([{ fn: 'indexer_targets', args: { p_chain_id: 31337 }, apikey: KEY }])
  })

  it('writes a segment with its blocks as numbers and its sync time as ISO, and answers whole summaries', async () => {
    const answer = {
      [ID]: {
        collectionId: ID,
        contract: CONTRACT,
        holders: 2,
        syncedAt: 1_800_000_100,
        recentMints: [
          {
            tx: MINT_TX,
            recipient: MINTER,
            groupId: 1,
            amount: 2,
            firstTokenId: 5,
            blockTime: 1_800_000_090,
          },
        ],
      },
    }
    const { sent, db } = fakeFetch(json(answer), json({}))
    const write: RecordWrite = {
      chainId: 31337,
      fromBlock: 91n,
      toBlock: 100n,
      syncedAt: 1_800_000_100,
      collections: [ID],
      records: { mints: [], owners: [], airdrops: [], withdrawals: [] },
    }
    expect(await db.record(write)).toEqual([
      {
        collectionId: ID,
        contract: CONTRACT,
        holders: 2,
        syncedAt: 1_800_000_100,
        recentMints: [
          {
            txHash: MINT_TX,
            recipient: MINTER,
            groupId: 1,
            amount: 2,
            firstTokenId: 5,
            blockTimestamp: 1_800_000_090,
          },
        ],
      },
    ])
    expect(sent[0]).toEqual({
      fn: 'indexer_record',
      args: {
        p_chain_id: 31337,
        p_from_block: 91,
        p_to_block: 100,
        p_synced_at: new Date(1_800_000_100_000).toISOString(),
        p_collections: [ID],
        p_records: { mints: [], owners: [], airdrops: [], withdrawals: [] },
      },
      apikey: KEY,
    })
    // A write that leaves the cursor unsynced sends no time, and a write naming no collection answers none.
    expect(await db.record({ ...write, syncedAt: null })).toEqual([])
    expect(sent[1]?.args.p_synced_at).toBeNull()
  })

  it('starts a cursor at its block, and loads the summaries', async () => {
    const { sent, db } = fakeFetch(json({}), json([]))
    await db.start(ID, 50n)
    expect(await db.summaries(31337)).toEqual([])
    expect(sent.map(({ fn, args }) => [fn, args])).toEqual([
      ['indexer_start', { p_collection_id: ID, p_from_block: 50 }],
      ['indexer_summaries', { p_chain_id: 31337 }],
    ])
  })

  it("names a refusal by its function and code, a gap for a skip and an unindexed collection, never the database's message", async () => {
    const { db } = fakeFetch(
      refusal('23514', 'The indexer would skip blocks.'),
      refusal('23514', 'A collection is not indexed on this chain.'),
      refusal('23514', 'A record names a collection outside this write.'),
      refusal(
        'PGRST202',
        'Could not find the function public.indexer_targets(p_chain_id) in the schema cache',
        404,
      ),
    )
    const write: RecordWrite = {
      chainId: 31337,
      fromBlock: 1n,
      toBlock: 2n,
      syncedAt: null,
      collections: [ID],
      records: { mints: [], owners: [], airdrops: [], withdrawals: [] },
    }
    const errors = [
      await settled(db.record(write)),
      await settled(db.record(write)),
      await settled(db.record(write)),
      await settled(db.targets(31337)),
    ]
    expect(errors.map((error) => error instanceof IndexerWriteError && [error.code, error.gap])).toEqual([
      ['23514', true],
      ['23514', true],
      ['23514', false],
      ['PGRST202', false],
    ])
    expect((errors[0] as Error).message).toBe("The indexer's indexer_record call failed (23514).")
    expect(errors.map((error) => failureLine(error))).toEqual([
      'IndexerWriteError (23514)',
      'IndexerWriteError (23514)',
      'IndexerWriteError (23514)',
      'IndexerWriteError (PGRST202)',
    ])
  })

  it('names a call no database answered NETWORK', async () => {
    const { db } = fakeFetch('down')
    const error = await settled(db.summaries(31337))
    expect(error instanceof IndexerWriteError && [error.code, error.gap]).toEqual(['NETWORK', false])
  })

  it("names an answer without a database code by its HTTP status, never the gateway's message", async () => {
    // The gateway's answer to a wrong service role key: a message and no code.
    const { db } = fakeFetch(json({ message: 'Invalid API key' }, 401))
    const error = await settled(db.targets(31337))
    expect(error instanceof IndexerWriteError && [error.code, error.gap, error.message]).toEqual([
      'HTTP_401',
      false,
      "The indexer's indexer_targets call failed (HTTP_401).",
    ])
    expect(failureLine(error)).toBe('IndexerWriteError (HTTP_401)')
  })

  it('names an answer with no data HTTP_204 in each function, as postgrest-js reads a 404 with an empty body', async () => {
    const empty = () => new Response('', { status: 404 })
    const { db } = fakeFetch(empty(), empty(), empty(), empty())
    const write: RecordWrite = {
      chainId: 31337,
      fromBlock: 1n,
      toBlock: 2n,
      syncedAt: null,
      collections: [ID],
      records: { mints: [], owners: [], airdrops: [], withdrawals: [] },
    }
    const errors = [
      await settled(db.targets(31337)),
      await settled(db.start(ID, 50n)),
      await settled(db.record(write)),
      await settled(db.summaries(31337)),
    ]
    expect(errors.map((error) => error instanceof IndexerWriteError && [error.code, error.message])).toEqual([
      ['HTTP_204', "The indexer's indexer_targets call failed (HTTP_204)."],
      ['HTTP_204', "The indexer's indexer_start call failed (HTTP_204)."],
      ['HTTP_204', "The indexer's indexer_record call failed (HTTP_204)."],
      ['HTTP_204', "The indexer's indexer_summaries call failed (HTTP_204)."],
    ])
  })

  it('abandons a call that has not answered after 10 s, so it cannot hold a pass (Review Focus 1)', async () => {
    vi.useFakeTimers()
    const { db } = fakeFetch('hang')
    let outcome: unknown = 'waiting'
    void settled(db.summaries(31337)).then((value) => {
      outcome = value
    })
    await vi.advanceTimersByTimeAsync(DB_TIMEOUT_MS - 1)
    expect(outcome).toBe('waiting')
    await vi.advanceTimersByTimeAsync(1)
    expect(outcome instanceof IndexerWriteError && [outcome.code, outcome.message]).toEqual([
      'TIMEOUT',
      "The indexer's indexer_summaries call failed (TIMEOUT).",
    ])
  })
})
