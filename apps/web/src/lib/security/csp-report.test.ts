import { describe, expect, it } from 'vitest'
import {
  cleanField,
  REPORT_FIELD_MAX,
  REPORT_LINES_PER_MINUTE,
  reportLimiter,
  violationLine,
  violationsOf,
  type Violation,
} from './csp-report'

/** A report-uri body, as browsers post it with `application/csp-report`. */
const legacy = (report: Record<string, unknown>) => ({
  'csp-report': {
    'document-uri': 'https://cobweb.example/night-owls?ref=x#mint',
    'violated-directive': "script-src-elem 'self'",
    'effective-directive': 'script-src-elem',
    'blocked-uri': 'https://evil.example/x.js?token=secret',
    'original-policy': "default-src 'self'; script-src 'nonce-abc'",
    disposition: 'enforce',
    ...report,
  },
})

/** A Reporting API report, as browsers post a list of them with `application/reports+json`. */
const reporting = (body: Record<string, unknown>, type = 'csp-violation') => ({
  type,
  url: 'https://cobweb.example/collections?tab=1',
  body: {
    documentURL: 'https://cobweb.example/collections?tab=1',
    effectiveDirective: 'connect-src',
    blockedURL: 'wss://relay.example/socket?key=secret',
    sourceFile: 'https://cobweb.example/_next/static/chunks/app.js?v=2',
    lineNumber: 12,
    columnNumber: 4,
    disposition: 'report',
    ...body,
  },
})

/** How many line breaks of any kind a string holds: a logged line must hold none. */
const lineBreaks = (text: string) =>
  [...text].filter((char) => [0x0a, 0x0d, 0x2028, 0x2029].includes(char.codePointAt(0)!)).length

/** The characters a logged field never carries: controls, the C1 range and the line and paragraph separators. */
const CONTROLS = String.fromCharCode(0x0a, 0x0d, 0x09, 0x00, 0x1b, 0x7f, 0x85, 0x2028, 0x2029)

/** 256 lone high surrogates: no two of them make a pair, and JSON escapes each as `\ud800`. */
const LONE = String.fromCharCode(0xd800).repeat(256)

const first = (contentType: string, body: unknown) => violationsOf(contentType, body).violations[0]!

describe('violationsOf (docs/specs/2026-10-17-production-hardening.md, section 5.5)', () => {
  it('reads a report-uri body: the directive, the blocked origin and the path without query or fragment', () => {
    expect(violationsOf('application/csp-report', legacy({}))).toEqual({
      violations: [
        {
          disposition: 'enforce',
          directive: 'script-src-elem',
          blocked: 'https://evil.example',
          page: '/night-owls',
          source: null,
          line: null,
          column: null,
        },
      ],
      malformed: 0,
    })
    // Without an effective directive, the violated one's first word.
    const withoutEffective = legacy({ 'effective-directive': undefined })
    expect(first('application/csp-report; charset=utf-8', withoutEffective).directive).toBe('script-src-elem')
  })

  it('reads every csp-violation of a Reporting API list, its source as an origin, and skips the other reports', () => {
    const data = {
      effectiveDirective: 'img-src',
      blockedURL: 'data',
      disposition: 'enforce',
      sourceFile: undefined,
    }
    expect(
      violationsOf('application/reports+json', [
        reporting({}),
        reporting({}, 'deprecation'),
        reporting(data),
      ]),
    ).toEqual({
      violations: [
        {
          disposition: 'report',
          directive: 'connect-src',
          blocked: 'wss://relay.example',
          page: '/collections',
          source: 'https://cobweb.example',
          line: 12,
          column: 4,
        },
        {
          disposition: 'enforce',
          directive: 'img-src',
          blocked: 'data',
          page: '/collections',
          source: null,
          line: 12,
          column: 4,
        },
      ],
      malformed: 0,
    })
  })

  it('names a blocked keyword, a data URL and a blob URL by their word, never their content', () => {
    const blocked = (value: string) =>
      first('application/csp-report', legacy({ 'blocked-uri': value })).blocked
    expect(['inline', 'eval', 'data', 'blob'].map(blocked)).toEqual(['inline', 'eval', 'data', 'blob'])
    expect(blocked('data:image/png;base64,iVBORw0KGgo=')).toBe('data')
    expect(blocked('blob:https://cobweb.example/4b1f6c2e-0000-4000-8000-000000000000')).toBe('blob')
    expect(blocked('')).toBe('unknown')
  })

  it('cuts each field to 256 characters before it is read', () => {
    const long = 'a'.repeat(300)
    const violation = first(
      'application/csp-report',
      legacy({
        'effective-directive': long,
        'blocked-uri': long,
        'document-uri': `https://cobweb.example/${long}`,
      }),
    )
    expect(REPORT_FIELD_MAX).toBe(256)
    expect([violation.directive.length, violation.blocked.length]).toEqual([256, 256])
    // The document's address is cut first, so its path keeps what fits after the origin.
    expect(violation.page).toBe(`/${long}`.slice(0, 256 - 'https://cobweb.example'.length))
  })

  it('counts a body that fails the schema as malformed and reads nothing from it', () => {
    for (const body of [
      legacy({ 'blocked-uri': 42 }),
      legacy({ 'line-number': -1 }),
      legacy({ disposition: 'observe' }),
      { report: {} },
      null,
      [legacy({})],
    ])
      expect(violationsOf('application/csp-report', body)).toEqual({ violations: [], malformed: 1 })
    expect(violationsOf('application/reports+json', legacy({}))).toEqual({ violations: [], malformed: 1 })
    expect(
      violationsOf('application/reports+json', [reporting({ blockedURL: { url: 'x' } }), reporting({})]),
    ).toMatchObject({ violations: [{ directive: 'connect-src' }], malformed: 1 })
  })

  it('holds no violation for another content type', () => {
    expect(violationsOf('application/json', legacy({}))).toEqual({ violations: [], malformed: 0 })
    expect(violationsOf('text/plain', [reporting({})])).toEqual({ violations: [], malformed: 0 })
  })

  it("reads a report that names no disposition as the fallback, the deploy's own mode, and enforce without one", () => {
    const unnamed = legacy({ disposition: undefined })
    expect(first('application/csp-report', unnamed).disposition).toBe('enforce')
    expect(violationsOf('application/csp-report', unnamed, 'report').violations[0]!.disposition).toBe(
      'report',
    )
    expect(
      violationsOf('application/reports+json', [reporting({ disposition: undefined })], 'report')
        .violations[0]!.disposition,
    ).toBe('report')
    // A disposition the browser names is kept, whatever the fallback.
    expect(violationsOf('application/csp-report', legacy({}), 'report').violations[0]!.disposition).toBe(
      'enforce',
    )
  })

  it('takes null for the blocked URL, the source file and its position in either format, read as absent (CSP3)', () => {
    const absent = { blocked: 'unknown', source: null, line: null, column: null }
    expect(
      violationsOf(
        'application/csp-report',
        legacy({ 'blocked-uri': null, 'source-file': null, 'line-number': null, 'column-number': null }),
      ),
    ).toEqual({ violations: [{ ...first('application/csp-report', legacy({})), ...absent }], malformed: 0 })
    expect(
      violationsOf('application/reports+json', [
        reporting({ blockedURL: null, sourceFile: null, lineNumber: null, columnNumber: null }),
      ]),
    ).toEqual({
      violations: [{ disposition: 'report', directive: 'connect-src', page: '/collections', ...absent }],
      malformed: 0,
    })
  })
})

describe('cleanField', () => {
  it('drops every control character, the C1 range and the line separators, then trims and cuts', () => {
    expect(cleanField(`a${CONTROLS}b${CONTROLS}c`)).toBe('abc')
    expect(cleanField('  \n kept \n ')).toBe('kept')
    expect(cleanField(undefined)).toBe('')
    expect(cleanField('x'.repeat(10_000))).toHaveLength(256)
  })

  it('drops a lone surrogate, which JSON writes as six characters, and keeps a pair', () => {
    const pair = String.fromCodePoint(0x1f578)
    expect(cleanField(`a${LONE.slice(0, 3)}b${String.fromCharCode(0xdc00)}c`)).toBe('abc')
    expect(cleanField(`a${pair}b`)).toBe(`a${pair}b`)
  })
})

describe('violationLine', () => {
  it('writes one JSON object, its first key csp', () => {
    const violation: Violation = {
      disposition: 'report',
      directive: 'connect-src',
      blocked: 'wss://relay.example',
      page: '/collections',
      source: null,
      line: 3,
      column: null,
    }
    expect(violationLine(violation)).toBe(
      '{"csp":"report","directive":"connect-src","blocked":"wss://relay.example","page":"/collections","source":null,"line":3,"column":null}',
    )
  })

  it('keeps a report carrying newlines and a 10 KB field to one bounded JSON line (Review Focus 1)', () => {
    const forged = 'inline\n{"csp":"enforce","directive":"forged"}\r\n'
    const huge = 'b'.repeat(10_240)
    const [violation] = violationsOf(
      'application/csp-report',
      legacy({
        'effective-directive': `script-src\n${huge}`,
        'blocked-uri': forged,
        'document-uri': `https://cobweb.example/x\n\r${huge}?q=1`,
        'source-file': `https://cobweb.example/${CONTROLS}${huge}`,
      }),
    ).violations
    const line = violationLine(violation!)
    expect(lineBreaks(line)).toBe(0)
    expect(line.length).toBeLessThan(2_048)
    expect(JSON.parse(line)).toMatchObject({
      csp: 'enforce',
      blocked: 'inline{"csp":"enforce","directive":"forged"}',
    })
    expect(line).not.toContain('original-policy')
  })

  it('keeps a report whose every field is 256 lone surrogates to one line near 2 KB', () => {
    const line = violationLine(
      first(
        'application/csp-report',
        legacy({
          'effective-directive': LONE,
          'blocked-uri': LONE,
          'source-file': LONE,
          'document-uri': `https://cobweb.example/${LONE}`,
        }),
      ),
    )
    expect(line.length).toBeLessThan(2_048)
    expect(line).not.toContain('\\ud')
  })
})

describe('reportLimiter', () => {
  it('allows 100 lines a minute, then counts what it held back once the minute is over', () => {
    const limiter = reportLimiter()
    const start = 1_000_000
    const allowed = Array.from({ length: REPORT_LINES_PER_MINUTE + 7 }, () => limiter.allow(start))
    expect(allowed.filter(Boolean)).toHaveLength(100)
    expect(limiter.dropped(start + 59_999)).toBeNull()
    expect(limiter.dropped(start + 60_000)).toBe(7)
    expect(limiter.dropped(start + 60_001)).toBeNull()
    expect(limiter.allow(start + 60_002)).toBe(true)
  })

  it('counts a dropped report with those held back, without using the allowance', () => {
    const limiter = reportLimiter(2)
    limiter.drop(0)
    expect([limiter.allow(1), limiter.allow(2), limiter.allow(3)]).toEqual([true, true, false])
    expect(limiter.dropped(60_000)).toBe(2)
  })
})
