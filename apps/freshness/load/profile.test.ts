import { describe, expect, it } from 'vitest'
import {
  EDGE_COUNTERS,
  edgeOf,
  headerOf,
  livenessOf,
  notOkSentenceOf,
  optionsOf,
  parametersOf,
  PROFILES,
  statePathOf,
  summaryLines,
  walletOf,
  walletPathOf,
} from './profile.js'

const ADDRESS = '0x5FbDB2315678afecb367f032d93F642f64180aa3'
const LOCAL = { PROFILE: 'local', BASE: 'http://127.0.0.1:53247', COLLECTIONS: `31337/${ADDRESS}` }
const HOSTED = { PROFILE: 'hosted', BASE: 'https://fresh.example.com', COLLECTIONS: `11155111/${ADDRESS}` }

/** k6's JSON summary of a local run of verify:load on Anvil, trimmed to the metrics the summary lines read. */
const RECORDED = {
  metrics: {
    'http_req_duration{route:state}': {
      values: { 'p(95)': 1.043, count: 2001 },
      thresholds: { 'p(95)<200': { ok: true } },
    },
    'http_req_duration{route:wallet}': {
      values: { 'p(95)': 211.945, count: 501 },
      thresholds: { 'p(95)<400': { ok: true } },
    },
    state_not_modified: {
      values: { rate: 0.9899040888440181, passes: 1961, fails: 20 },
      thresholds: { 'rate>0.9': { ok: true } },
    },
    http_req_failed: {
      values: { rate: 0, passes: 0, fails: 2507 },
      thresholds: { 'rate<0.01': { ok: true } },
    },
    dropped_iterations: { values: { count: 0, rate: 0 }, thresholds: { 'count<=25': { ok: true } } },
    edge_none: { values: { count: 2506 } },
    origin_busiest_per_s: { values: { max: 25.033333333333335, count: 4 } },
    origin_wallet_windows_per_min: { values: { max: 263.9472105578884, count: 3 } },
  },
}

describe('parametersOf (docs/specs/2026-10-18-load-run-contract-review-and-cloudflare.md, section 5.1)', () => {
  it("reads each profile's defaults", () => {
    expect(parametersOf(LOCAL)).toEqual({
      profile: 'local',
      base: 'http://127.0.0.1:53247',
      collections: [{ chainId: 31337, address: ADDRESS }],
      pollers: 100,
      intervalS: 1,
      wallets: 1500,
      summaryFile: null,
    })
    expect(parametersOf(HOSTED)).toMatchObject({
      profile: 'hosted',
      pollers: 20000,
      intervalS: 3,
      wallets: 5000,
    })
    expect(PROFILES).toEqual({
      local: { pollers: 100, intervalS: 1, wallets: 1500 },
      hosted: { pollers: 20000, intervalS: 3, wallets: 5000 },
    })
  })

  it('takes the overrides, a trailing slash on BASE and several collections', () => {
    const second = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512'
    expect(
      parametersOf({
        ...HOSTED,
        BASE: 'https://fresh.example.com/',
        COLLECTIONS: `11155111/${ADDRESS}, 84532/${second}`,
        POLLERS: '2000',
        INTERVAL_S: '2',
        WALLETS: '500',
        SUMMARY_FILE: '/tmp/k6-hosted.json',
      }),
    ).toEqual({
      profile: 'hosted',
      base: 'https://fresh.example.com',
      collections: [
        { chainId: 11155111, address: ADDRESS },
        { chainId: 84532, address: second },
      ],
      pollers: 2000,
      intervalS: 2,
      wallets: 500,
      summaryFile: '/tmp/k6-hosted.json',
    })
  })

  it("refuses each value it cannot use with section 10's sentence", () => {
    const refusals: [Record<string, string>, string][] = [
      [{ ...LOCAL, PROFILE: '' }, 'PROFILE must be local or hosted.'],
      [{ ...LOCAL, PROFILE: 'remote' }, 'PROFILE must be local or hosted.'],
      [
        { ...LOCAL, BASE: '' },
        "BASE must be the freshness server's origin, such as https://fresh.example.com.",
      ],
      [
        { ...LOCAL, BASE: 'fresh.example.com' },
        "BASE must be the freshness server's origin, such as https://fresh.example.com.",
      ],
      [
        { ...LOCAL, BASE: 'ftp://fresh.example.com' },
        "BASE must be the freshness server's origin, such as https://fresh.example.com.",
      ],
      [
        { ...LOCAL, BASE: 'https://fresh.example.com/v1' },
        "BASE must be the freshness server's origin, such as https://fresh.example.com.",
      ],
      [
        { ...LOCAL, COLLECTIONS: '' },
        'COLLECTIONS must list one or more <chain id>/<address>, separated by commas.',
      ],
      [
        { ...LOCAL, COLLECTIONS: '31337' },
        'COLLECTIONS must list one or more <chain id>/<address>, separated by commas.',
      ],
      [
        { ...LOCAL, COLLECTIONS: '31337/0x5fbdb2315678' },
        'COLLECTIONS must list one or more <chain id>/<address>, separated by commas.',
      ],
      [
        { ...LOCAL, COLLECTIONS: `31337/${ADDRESS},` },
        'COLLECTIONS must list one or more <chain id>/<address>, separated by commas.',
      ],
      [{ ...LOCAL, POLLERS: '0' }, 'POLLERS, INTERVAL_S and WALLETS must be whole numbers above 0.'],
      [{ ...LOCAL, INTERVAL_S: '1.5' }, 'POLLERS, INTERVAL_S and WALLETS must be whole numbers above 0.'],
      [{ ...LOCAL, WALLETS: 'many' }, 'POLLERS, INTERVAL_S and WALLETS must be whole numbers above 0.'],
    ]
    for (const [env, sentence] of refusals)
      expect(() => parametersOf(env), JSON.stringify(env)).toThrow(sentence)
  })
})

describe('optionsOf (section 5.2 and 5.4)', () => {
  it("runs the local profile's three scenarios for 20 s at 100 polls and 25 wallet reads a second", () => {
    expect(optionsOf(parametersOf(LOCAL)).scenarios).toEqual({
      pollers: {
        executor: 'constant-arrival-rate',
        exec: 'poll',
        rate: 100,
        timeUnit: '1s',
        duration: '20s',
        preAllocatedVUs: 20,
        maxVUs: 100,
      },
      wallets: {
        executor: 'constant-arrival-rate',
        exec: 'ask',
        rate: 1500,
        timeUnit: '1m',
        duration: '20s',
        preAllocatedVUs: 10,
        maxVUs: 50,
      },
      health: { executor: 'constant-vus', exec: 'watch', vus: 1, duration: '20s', gracefulStop: '0s' },
    })
  })

  it('ramps the hosted pollers to 6,667 a second over a minute and holds them for two, the wallets reading in the second', () => {
    expect(optionsOf(parametersOf(HOSTED)).scenarios).toEqual({
      pollers: {
        executor: 'ramping-arrival-rate',
        exec: 'poll',
        startRate: 0,
        timeUnit: '1s',
        stages: [
          { duration: '60s', target: 6667 },
          { duration: '120s', target: 6667 },
        ],
        preAllocatedVUs: 1000,
        maxVUs: 3000,
      },
      wallets: {
        executor: 'constant-arrival-rate',
        exec: 'ask',
        rate: 5000,
        timeUnit: '1m',
        duration: '60s',
        startTime: '60s',
        preAllocatedVUs: 100,
        maxVUs: 500,
      },
      health: { executor: 'constant-vus', exec: 'watch', vus: 1, duration: '180s', gracefulStop: '0s' },
    })
  })

  it('holds each profile to its thresholds, the dropped iterations to 1% of those planned', () => {
    const common = {
      http_req_failed: ['rate<0.01'],
      checks: ['rate>0.99'],
      state_not_modified: ['rate>0.9'],
      degraded_answers: ['count==0'],
      early_open: ['count==0'],
      health_problems: ['max==0'],
    }
    expect(optionsOf(parametersOf(LOCAL)).thresholds).toEqual({
      ...common,
      'http_req_duration{route:state}': ['p(95)<200'],
      'http_req_duration{route:wallet}': ['p(95)<400'],
      dropped_iterations: ['count<=25'],
    })
    expect(optionsOf(parametersOf(HOSTED)).thresholds).toEqual({
      ...common,
      'http_req_duration{route:state}': ['p(95)<500'],
      'http_req_duration{route:wallet}': ['p(95)<1000'],
      dropped_iterations: ['count<=10050'],
      state_age_s: ['max<=10'],
      edge_mitigated: ['count==0'],
      health_counts_missing: ['count==0'],
      origin_busiest_per_s: ['max<=2'],
    })
    const rehearsal = parametersOf({ ...HOSTED, POLLERS: '2000', WALLETS: '500' })
    expect(optionsOf(rehearsal).thresholds.dropped_iterations).toEqual(['count<=1005'])
    expect(optionsOf(parametersOf(LOCAL)).summaryTrendStats).toEqual([
      'avg',
      'min',
      'med',
      'max',
      'p(90)',
      'p(95)',
      'p(99)',
      'count',
    ])
  })
})

describe('walletOf and the paths', () => {
  it('answers 40 lowercase hex digits, distinct for distinct asks and for distinct runs', () => {
    const start = 1_792_323_252_271
    expect(walletOf(start, 0)).toBe('0x01a14eca702f0000000000000000000000000000')
    expect(walletOf(start, 4999)).toBe('0x01a14eca702f0000000000000000000000001387')
    const asks = new Set(Array.from({ length: 5000 }, (_, n) => walletOf(start, n)))
    expect(asks.size).toBe(5000)
    expect(walletOf(start + 1, 7)).not.toBe(walletOf(start, 7))
  })

  it('lowercases the addresses', () => {
    const collection = { chainId: 31337, address: ADDRESS }
    expect(statePathOf(collection)).toBe(`/v1/state/31337/${ADDRESS.toLowerCase()}`)
    expect(walletPathOf(collection, '0xE7F1725E7734CE288F8367E1BB143E90BB3F0512')).toBe(
      `/v1/wallet/31337/${ADDRESS.toLowerCase()}/0xe7f1725e7734ce288f8367e1bb143e90bb3f0512`,
    )
  })
})

describe('livenessOf (section 5.3)', () => {
  const group = (id: number, flag: boolean, active: boolean, startTimestamp: number) => ({
    id,
    flag,
    active,
    startTimestamp,
  })

  it('counts a group open by its flag in none, a scheduled one before its start as waiting and at it as open', () => {
    expect(livenessOf({ blockTimestamp: 1_000, groups: [group(1, true, true, 0)] })).toEqual({
      early: 0,
      openBySchedule: 0,
      waiting: 0,
    })
    expect(livenessOf({ blockTimestamp: 999, groups: [group(0, false, false, 1_000)] })).toEqual({
      early: 0,
      openBySchedule: 0,
      waiting: 1,
    })
    expect(livenessOf({ blockTimestamp: 1_000, groups: [group(0, false, true, 1_000)] })).toEqual({
      early: 0,
      openBySchedule: 1,
      waiting: 0,
    })
  })

  it('counts a group active by neither its flag nor a reached start as early, and a closed unscheduled one in none', () => {
    expect(
      livenessOf({
        blockTimestamp: 999,
        groups: [group(0, false, true, 1_000), group(2, false, true, 0), group(3, false, false, 0)],
      }),
    ).toEqual({ early: 2, openBySchedule: 0, waiting: 0 })
  })
})

describe('edgeOf and headerOf', () => {
  it('reads a header in any case, as k6 hands them canonicalized', () => {
    expect(headerOf({ Etag: 'W/"1"', 'Cf-Cache-Status': 'HIT' }, 'etag')).toBe('W/"1"')
    expect(headerOf({ Etag: 'W/"1"' }, 'Age')).toBeNull()
    expect(headerOf(undefined, 'Age')).toBeNull()
  })

  it('counts each answer by its cf-cache-status, another value as other and none without one', () => {
    expect(EDGE_COUNTERS).toEqual([
      'edge_hit',
      'edge_miss',
      'edge_expired',
      'edge_revalidated',
      'edge_updating',
      'edge_stale',
      'edge_dynamic',
      'edge_bypass',
      'edge_other',
      'edge_none',
    ])
    expect(edgeOf(200, { 'Cf-Cache-Status': 'HIT', Age: '1' })).toEqual({
      cache: 'edge_hit',
      mitigated: false,
    })
    expect(edgeOf(304, { 'Cf-Cache-Status': 'revalidated' })).toEqual({
      cache: 'edge_revalidated',
      mitigated: false,
    })
    expect(edgeOf(200, { 'Cf-Cache-Status': 'NONE' })).toEqual({ cache: 'edge_other', mitigated: false })
    expect(edgeOf(200, { 'Content-Type': 'application/json' })).toEqual({
      cache: 'edge_none',
      mitigated: false,
    })
  })

  it("counts a challenge or a block from the edge in place of an answer as a mitigation, and an origin's JSON refusal as none", () => {
    const challenge = {
      'Cf-Mitigated': 'challenge',
      'Content-Type': 'text/html; charset=UTF-8',
      'Cf-Ray': '8f1a',
    }
    expect(edgeOf(403, challenge)).toEqual({ cache: 'edge_none', mitigated: true })
    expect(edgeOf(200, { 'Cf-Mitigated': 'challenge' })).toMatchObject({ mitigated: true })
    expect(edgeOf(403, { 'Content-Type': 'text/html' })).toMatchObject({ mitigated: true })
    expect(edgeOf(429, { 'Content-Type': 'text/html; charset=UTF-8' })).toMatchObject({ mitigated: true })
    const refusal = { 'Content-Type': 'application/json; charset=utf-8', 'Cf-Cache-Status': 'HIT' }
    expect(edgeOf(404, refusal)).toEqual({ cache: 'edge_hit', mitigated: false })
    expect(edgeOf(503, { 'Content-Type': 'application/json; charset=utf-8' })).toMatchObject({
      mitigated: false,
    })
  })
})

describe("notOkSentenceOf (section 10's setup sentence)", () => {
  it('answers null for an ok /health and the sentence with its problems otherwise', () => {
    expect(notOkSentenceOf(200, { status: 'ok', problems: [] })).toBeNull()
    expect(
      notOkSentenceOf(200, {
        status: 'degraded',
        problems: [
          'Anvil: no good read for 61 s (limit 60 s).',
          'Base: 11 failed reads in 5 minutes (limit 10).',
        ],
      }),
    ).toBe(
      'The freshness server is not ok before the run: Anvil: no good read for 61 s (limit 60 s). Base: 11 failed reads in 5 minutes (limit 10). Fix it, then run again.',
    )
    expect(notOkSentenceOf(0, null)).toBe(
      'The freshness server is not ok before the run: /health did not answer. Fix it, then run again.',
    )
    expect(notOkSentenceOf(200, { hot: 0 })).toBe(
      'The freshness server is not ok before the run: /health answered 200 without status ok. Fix it, then run again.',
    )
  })
})

describe("summaryLines (section 10's summary)", () => {
  const parameters = parametersOf(LOCAL)

  it('writes each line from a recorded local summary', () => {
    expect(summaryLines(RECORDED, parameters)).toEqual([
      'k6-freshness, local profile, against http://127.0.0.1:53247.',
      'State: 2,001 polls, 1,961 of the 1,981 that carried an ETag answered 304, p95 1.0 ms.',
      'Wallet: 501 reads, p95 211.9 ms.',
      'Failed: 0.00% of all requests. Dropped iterations: 0. Edge mitigations: 0.',
      'Edge cache: no answer came through Cloudflare.',
      'Origin: the busiest collection drew at most 25.0 state requests a second; the wallet windows peaked at 264 a minute.',
      'Thresholds: every one passed.',
    ])
  })

  it("lists the edge's statuses largest first, and says when /health carries no counts", () => {
    const behindTheEdge = {
      metrics: {
        ...RECORDED.metrics,
        edge_hit: { values: { count: 1_002_310 } },
        edge_revalidated: { values: { count: 1_204 } },
        edge_dynamic: { values: { count: 36 } },
        edge_expired: { values: { count: 36 } },
        edge_mitigated: { values: { count: 0 } },
        origin_busiest_per_s: { values: { count: 0 } },
        health_counts_missing: { values: { count: 36 } },
      },
    }
    const lines = summaryLines(behindTheEdge, parametersOf(HOSTED))
    expect(lines[0]).toBe('k6-freshness, hosted profile, against https://fresh.example.com.')
    expect(lines[4]).toBe('Edge cache: HIT 1,002,310, REVALIDATED 1,204, DYNAMIC 36, EXPIRED 36.')
    expect(lines[5]).toBe(
      "Origin: /health carries no request counts; deploy this sub-project's freshness server first.",
    )
  })

  it('names each failed threshold, and reads an aborted run as zeros', () => {
    const failing = {
      metrics: {
        ...RECORDED.metrics,
        state_not_modified: {
          ...RECORDED.metrics.state_not_modified,
          thresholds: { 'rate>0.9': { ok: false } },
        },
        origin_busiest_per_s: { values: { max: 3.2, count: 36 }, thresholds: { 'max<=2': { ok: false } } },
      },
    }
    expect(summaryLines(failing, parameters)[6]).toBe(
      'Thresholds failed: origin_busiest_per_s max<=2, state_not_modified rate>0.9.',
    )
    expect(summaryLines({ metrics: {} }, parameters).slice(1, 4)).toEqual([
      'State: 0 polls, 0 of the 0 that carried an ETag answered 304, p95 0.0 ms.',
      'Wallet: 0 reads, p95 0.0 ms.',
      'Failed: 0.00% of all requests. Dropped iterations: 0. Edge mitigations: 0.',
    ])
  })
})
