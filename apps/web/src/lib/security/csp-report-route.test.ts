import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** The route with a fresh limiter. */
async function route() {
  vi.resetModules()
  return (await import('@/app/api/csp-report/route')).POST
}

const post = (body: string | ReadableStream<Uint8Array>, type: string, length?: number) =>
  new Request('https://cobweb.test/api/csp-report', {
    method: 'POST',
    body,
    headers: { 'content-type': type, ...(length === undefined ? {} : { 'content-length': String(length) }) },
    ...(typeof body === 'string' ? {} : { duplex: 'half' }),
  } as RequestInit)

const legacy = (fields: Record<string, unknown>) =>
  JSON.stringify({
    'csp-report': {
      'document-uri': 'https://cobweb.test/night-owls?ref=1',
      'effective-directive': 'script-src-elem',
      'blocked-uri': 'https://evil.example/x.js',
      disposition: 'enforce',
      ...fields,
    },
  })
const report = legacy({})
const LINE =
  '{"csp":"enforce","directive":"script-src-elem","blocked":"https://evil.example","page":"/night-owls","source":null,"line":null,"column":null}'

/** How many line breaks of any kind a string holds: a logged line must hold none. */
const lineBreaks = (text: string) =>
  [...text].filter((char) => [0x0a, 0x0d, 0x2028, 0x2029].includes(char.codePointAt(0)!)).length

describe('POST /api/csp-report (docs/specs/2026-10-17-production-hardening.md, section 5.5)', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  beforeEach(() => warn.mockClear())
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('answers 204 and logs one JSON line per violation', async () => {
    const POST = await route()
    const response = await POST(post(report, 'application/csp-report'))
    expect(response.status).toBe(204)
    expect(warn.mock.calls).toEqual([[LINE]])
  })

  it('logs a report carrying newlines and a 10 KB field as one bounded JSON line (Review Focus 1)', async () => {
    const POST = await route()
    const body = legacy({
      'blocked-uri': `inline\n${'c'.repeat(10_240)}`,
      'document-uri': 'https://cobweb.test/a\r\nCSP enforce: forged blocked x on /b',
    })
    expect((await POST(post(body, 'application/csp-report'))).status).toBe(204)
    expect(warn).toHaveBeenCalledTimes(1)
    const line = String(warn.mock.calls[0]![0])
    expect(lineBreaks(line)).toBe(0)
    expect(line.length).toBeLessThan(2_048)
    expect(JSON.parse(line)).toMatchObject({
      csp: 'enforce',
      page: '/aCSP%20enforce:%20forged%20blocked%20x%20on%20/b',
    })
  })

  it('answers 415 for another type and logs nothing', async () => {
    const POST = await route()
    expect((await POST(post(report, 'application/json'))).status).toBe(415)
    expect(warn).not.toHaveBeenCalled()
  })

  it('answers 400 for a body that does not parse or fails the schema, logs nothing of it, and counts it', async () => {
    vi.useFakeTimers({ now: 1_000_000 })
    const POST = await route()
    expect((await POST(post('{"csp-report":', 'application/csp-report'))).status).toBe(400)
    expect((await POST(post(legacy({ 'blocked-uri': 42 }), 'application/csp-report'))).status).toBe(400)
    expect(warn).not.toHaveBeenCalled()
    vi.setSystemTime(1_060_000)
    await POST(post(report, 'application/csp-report'))
    expect(warn.mock.calls).toEqual([[LINE], ['CSP: 2 more reports in the last minute were not logged.']])
  })

  it('answers 413 above 16 KB, whether or not the length is declared', async () => {
    const POST = await route()
    const large = legacy({ 'blocked-uri': 'a'.repeat(17_000) })
    expect((await POST(post(large, 'application/csp-report', large.length))).status).toBe(413)
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let n = 0; n < 17; n++) controller.enqueue(new Uint8Array(1_024).fill(32))
        controller.close()
      },
    })
    expect((await POST(post(stream, 'application/csp-report'))).status).toBe(413)
    expect(warn).not.toHaveBeenCalled()
  })

  it('answers 413 from a declared length over 16 KB alone, before it reads a small body', async () => {
    const POST = await route()
    expect(report.length).toBeLessThan(1_024)
    expect((await POST(post(report, 'application/csp-report', 16_385))).status).toBe(413)
    expect(warn).not.toHaveBeenCalled()
  })

  it("logs a report that names no disposition under the deploy's own mode", async () => {
    const unnamed = legacy({ disposition: undefined })
    /** CSP_MODE and VERCEL: report-only named, enforce named on Vercel, then unset on Vercel and off it. */
    const deploys: [string, string][] = [
      ['report-only', ''],
      ['enforce', '1'],
      ['', '1'],
      ['', ''],
    ]
    const POST = await route()
    for (const [mode, vercel] of deploys) {
      vi.stubEnv('CSP_MODE', mode)
      vi.stubEnv('VERCEL', vercel)
      expect((await POST(post(unnamed, 'application/csp-report'))).status).toBe(204)
    }
    expect(warn.mock.calls.map(([line]) => (JSON.parse(String(line)) as { csp: string }).csp)).toEqual([
      'report',
      'enforce',
      'report',
      'enforce',
    ])
  })

  it('logs 100 lines a minute, then the count it held back once the minute is over', async () => {
    vi.useFakeTimers({ now: 1_000_000 })
    const POST = await route()
    const many = JSON.stringify(
      Array.from({ length: 101 }, () => ({
        type: 'csp-violation',
        body: { documentURL: 'https://cobweb.test/', effectiveDirective: 'img-src', blockedURL: 'data' },
      })),
    )
    expect((await POST(post(many, 'application/reports+json'))).status).toBe(204)
    expect(warn).toHaveBeenCalledTimes(100)
    vi.setSystemTime(1_060_000)
    await POST(post(report, 'application/csp-report'))
    expect(warn.mock.calls.slice(100)).toEqual([
      [LINE],
      ['CSP: 1 more reports in the last minute were not logged.'],
    ])
  })
})
