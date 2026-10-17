import { REPORT_MAX_BYTES, reportLimiter, violationLine, violationsOf } from '@/lib/security/csp-report'

/**
 * Where browsers post the policy's violations (docs/specs/2026-10-17-production-hardening.md, section 5.5), in
 * either report format, up to 16 KB: one JSON line per violation, at most 100 a minute per instance, then the
 * count held back. A body that does not parse or fails the report schema is counted with those and never logged.
 * No session, no database: the proxy's matcher skips this route. 415 for another type, 413 above 16 KB, 400 for
 * a body that is not a report, 204 otherwise.
 */

const TYPES = ['application/csp-report', 'application/reports+json']
const limiter = reportLimiter()

/** The body as text, or null once it passes `max` bytes, read no further than that. */
async function bodyText(request: Request, max: number): Promise<string | null> {
  if (Number(request.headers.get('content-length') ?? 0) > max) return null
  const reader = request.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}

/** Logs the count held back in the minute just over, once. */
function logDropped(now: number): void {
  const dropped = limiter.dropped(now)
  if (dropped !== null) console.warn(`CSP: ${dropped} more reports in the last minute were not logged.`)
}

export async function POST(request: Request): Promise<Response> {
  const type = (request.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
  if (!TYPES.includes(type)) return new Response(null, { status: 415 })
  const raw = await bodyText(request, REPORT_MAX_BYTES)
  if (raw === null) return new Response(null, { status: 413 })
  const now = Date.now()
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    limiter.drop(now)
    logDropped(now)
    return new Response(null, { status: 400 })
  }
  const { violations, malformed } = violationsOf(type, body)
  for (const violation of violations) if (limiter.allow(now)) console.warn(violationLine(violation))
  for (let count = 0; count < malformed; count++) limiter.drop(now)
  logDropped(now)
  return new Response(null, { status: violations.length === 0 && malformed > 0 ? 400 : 204 })
}
