import { z } from 'zod'

/**
 * The policy's violation reports (docs/specs/2026-10-17-production-hardening.md, section 5.5), pure. A report is
 * attacker-controlled input bound for the log, so nothing of it is written as it arrives: each format is read
 * through a schema of allow-listed fields (any other, the original policy among them, is dropped), every string
 * loses its control characters and is cut to 256 characters, the document is kept as its path without query or
 * fragment and a blocked or source URL as its origin or keyword, and the line is one JSON object. A body that
 * fails the schema is counted and dropped unread. The limiter keeps one instance to 100 lines a minute.
 */

export const REPORT_MAX_BYTES = 16_384
export const REPORT_LINES_PER_MINUTE = 100
/** The longest a logged string may be. */
export const REPORT_FIELD_MAX = 256

export type Violation = {
  disposition: 'enforce' | 'report'
  /** The effective directive, else the violated one's first word. */
  directive: string
  /** The blocked URL's origin, or its keyword (`inline`, `eval`, `data`, `blob`). */
  blocked: string
  /** The document's path, without its query or fragment. */
  page: string
  /** The origin (or keyword) of the file the violation came from, when the browser names one. */
  source: string | null
  line: number | null
  column: number | null
}

const MINUTE_MS = 60_000

const optionalText = z.string().optional()
const position = z.number().int().nonnegative().optional()
const disposition = z.enum(['enforce', 'report']).optional()

/** The report-uri format (`application/csp-report`): the fields Cobweb reads, every other one dropped. */
const legacyReport = z.object({
  'csp-report': z.object({
    'document-uri': optionalText,
    'violated-directive': optionalText,
    'effective-directive': optionalText,
    'blocked-uri': optionalText,
    'source-file': optionalText,
    'line-number': position,
    'column-number': position,
    disposition,
  }),
})

/** A Reporting API csp-violation's body (`application/reports+json`): the same fields under its names. */
const reportingBody = z.object({
  documentURL: optionalText,
  effectiveDirective: optionalText,
  blockedURL: optionalText,
  sourceFile: optionalText,
  lineNumber: position,
  columnNumber: position,
  disposition,
})

/** Every code point below 0x20, 0x7f, the C1 range and the line and paragraph separators. */
const isControl = (code: number) =>
  code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029

/** A string without control characters, so nothing in it can start a log line, trimmed and cut to 256. */
export function cleanField(value: string | undefined): string {
  return [...(value ?? '')]
    .filter((char) => !isControl(char.codePointAt(0)!))
    .join('')
    .trim()
    .slice(0, REPORT_FIELD_MAX)
}

/** A URL as its origin, a data or blob URL as its scheme, anything else as its first word: a keyword. */
function originOrKeyword(value: string | undefined): string | null {
  const raw = cleanField(value)
  if (!raw) return null
  try {
    const url = new URL(raw)
    // A blob URL's origin is its page's, so it is named by its scheme, as a data URL is.
    if (url.protocol === 'blob:' || url.origin === 'null') return url.protocol.replace(/:$/, '')
    return url.origin.slice(0, REPORT_FIELD_MAX)
  } catch {
    return raw.split(' ')[0]!
  }
}

/** The document's path, without its query or fragment. */
function pathOf(value: string | undefined): string {
  try {
    return new URL(cleanField(value)).pathname.slice(0, REPORT_FIELD_MAX)
  } catch {
    return 'unknown'
  }
}

function violationOf(fields: {
  disposition?: 'enforce' | 'report'
  effective?: string
  violated?: string
  blocked?: string
  document?: string
  source?: string
  line?: number
  column?: number
}): Violation {
  return {
    disposition: fields.disposition ?? 'enforce',
    directive: cleanField(fields.effective) || cleanField(fields.violated).split(' ')[0] || 'unknown',
    blocked: originOrKeyword(fields.blocked) ?? 'unknown',
    page: pathOf(fields.document),
    source: originOrKeyword(fields.source),
    line: fields.line ?? null,
    column: fields.column ?? null,
  }
}

/**
 * The violations of a report body, and how many reports in it failed the schema (counted, never logged). The
 * report-uri format holds one; a Reporting API list holds one per `csp-violation` report, other report types
 * skipped. Another content type holds none.
 */
export function violationsOf(
  contentType: string,
  body: unknown,
): { violations: Violation[]; malformed: number } {
  const type = contentType.split(';')[0]!.trim().toLowerCase()
  if (type === 'application/csp-report') {
    const parsed = legacyReport.safeParse(body)
    if (!parsed.success) return { violations: [], malformed: 1 }
    const report = parsed.data['csp-report']
    return {
      violations: [
        violationOf({
          disposition: report.disposition,
          effective: report['effective-directive'],
          violated: report['violated-directive'],
          blocked: report['blocked-uri'],
          document: report['document-uri'],
          source: report['source-file'],
          line: report['line-number'],
          column: report['column-number'],
        }),
      ],
      malformed: 0,
    }
  }
  if (type !== 'application/reports+json') return { violations: [], malformed: 0 }
  if (!Array.isArray(body)) return { violations: [], malformed: 1 }
  const violations: Violation[] = []
  let malformed = 0
  for (const report of body as unknown[]) {
    if (
      typeof report !== 'object' ||
      report === null ||
      (report as { type?: unknown }).type !== 'csp-violation'
    )
      continue
    const parsed = reportingBody.safeParse((report as { body?: unknown }).body)
    if (!parsed.success) {
      malformed++
      continue
    }
    violations.push(
      violationOf({
        disposition: parsed.data.disposition,
        effective: parsed.data.effectiveDirective,
        blocked: parsed.data.blockedURL,
        document: parsed.data.documentURL,
        source: parsed.data.sourceFile,
        line: parsed.data.lineNumber,
        column: parsed.data.columnNumber,
      }),
    )
  }
  return { violations, malformed }
}

/** One violation as the log writes it: one JSON object on one line, its first key `csp`. */
export function violationLine(violation: Violation): string {
  return JSON.stringify({
    csp: violation.disposition,
    directive: violation.directive,
    blocked: violation.blocked,
    page: violation.page,
    source: violation.source,
    line: violation.line,
    column: violation.column,
  })
}

/**
 * At most `perMinute` lines in each minute from the first one; `drop` counts a report not logged for another
 * reason (one that failed the schema); `dropped` answers how many the last minute held back once that minute is
 * over, then null until another is.
 */
export function reportLimiter(perMinute = REPORT_LINES_PER_MINUTE): {
  allow(now: number): boolean
  drop(now: number): void
  dropped(now: number): number | null
} {
  let windowStart = Number.NEGATIVE_INFINITY
  let used = 0
  let held = 0
  let owed = 0
  const roll = (now: number) => {
    if (now - windowStart < MINUTE_MS) return
    owed += held
    held = 0
    used = 0
    windowStart = now
  }
  return {
    allow(now) {
      roll(now)
      if (used < perMinute) {
        used++
        return true
      }
      held++
      return false
    },
    drop(now) {
      roll(now)
      held++
    },
    dropped(now) {
      roll(now)
      if (owed === 0) return null
      const count = owed
      owed = 0
      return count
    },
  }
}
