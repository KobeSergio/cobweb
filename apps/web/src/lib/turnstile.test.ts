import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  loadTurnstile,
  TURNSTILE_LOAD_MS,
  TURNSTILE_SCRIPT_URL,
  turnstileSiteKey,
  type TurnstileApi,
} from './turnstile'

type FakeScript = { src: string; async: boolean; onload: (() => void) | null; onerror: (() => void) | null }

/** A document that records the scripts appended to its head, and the window its loaded script fills. */
function fakeDocument() {
  const appended: FakeScript[] = []
  const view: { turnstile?: TurnstileApi } = {}
  const doc = {
    createElement: (): FakeScript => ({ src: '', async: false, onload: null, onerror: null }),
    head: { appendChild: (script: FakeScript) => appended.push(script) },
    defaultView: view,
  }
  return { doc: doc as unknown as Document, appended, view }
}

const API: TurnstileApi = { render: () => 'widget-1', reset: () => {}, remove: () => {} }

/** What a promise settles to: its value, or the error it rejected with. */
const settled = <T>(promise: Promise<T>) =>
  promise.then(
    (value) => value,
    (error: unknown) => error,
  )

describe('turnstileSiteKey (docs/specs/2026-10-17-production-hardening.md, section 6.1)', () => {
  it('reads a blank key as null and trims a set one', () => {
    expect([turnstileSiteKey(undefined), turnstileSiteKey(''), turnstileSiteKey('   ')]).toEqual([
      null,
      null,
      null,
    ])
    expect(turnstileSiteKey(' 1x00000000000000000000AA ')).toBe('1x00000000000000000000AA')
  })
})

describe('loadTurnstile', () => {
  afterEach(() => vi.useRealTimers())

  it('appends one script for two loads and resolves both with window.turnstile once it loads', async () => {
    const { doc, appended, view } = fakeDocument()
    const first = loadTurnstile(doc)
    const second = loadTurnstile(doc)
    expect(appended).toHaveLength(1)
    expect(appended[0]).toMatchObject({ src: TURNSTILE_SCRIPT_URL, async: true })
    view.turnstile = API
    appended[0]!.onload!()
    expect(await first).toBe(API)
    expect(await second).toBe(API)
  })

  it('rejects when the script fails to load, or loads without its interface', async () => {
    const failing = fakeDocument()
    const failed = loadTurnstile(failing.doc)
    failing.appended[0]!.onerror!()
    expect(String(await settled(failed))).toContain('could not load')
    const empty = fakeDocument()
    const bare = loadTurnstile(empty.doc)
    empty.appended[0]!.onload!()
    expect(String(await settled(bare))).toContain('without its interface')
  })

  it('rejects after 15 s without a load', async () => {
    vi.useFakeTimers()
    const { doc } = fakeDocument()
    const loading = settled(loadTurnstile(doc))
    await vi.advanceTimersByTimeAsync(TURNSTILE_LOAD_MS - 1)
    expect(await Promise.race([loading, Promise.resolve('pending')])).toBe('pending')
    await vi.advanceTimersByTimeAsync(1)
    expect(String(await loading)).toContain('did not load in time')
  })
})
