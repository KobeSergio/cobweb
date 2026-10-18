import { consoleLog, errorSummary } from '@cobweb/worker'
import { cronAuthorized } from '@/lib/render/env'
import { sweepUploads, uploadSweepDryRun, type SweepOutcome } from '@/lib/storage/sweep'
import { uploadSweepDeps } from '@/lib/storage/upload-sweep-deps'

/** Each bucket is listed whole, a page of 1,000 keys at a time. */
export const maxDuration = 800

/** A bucket's outcome as one log field: its counts, or its masked failure. */
const outcomeField = (outcome: SweepOutcome): string =>
  'failed' in outcome
    ? `failed: ${outcome.failed}`
    : `${outcome.listed} listed, ${outcome.old} old, ${outcome.orphaned} orphaned, ${outcome.deleted} deleted`

/**
 * The upload sweep, run by Vercel Cron every day at 07:00 UTC (docs/specs/2026-10-17-production-hardening.md,
 * section 14, point 8): deletes the art files no upload row records and the mint page files no page names, each
 * over a day old, dry until UPLOAD_SWEEP_DELETE is 1, and answers the counts. Vercel sends `Authorization: Bearer
 * <CRON_SECRET>`; any other caller gets a 404, as the render sweep answers. A bucket that fails does not stop the
 * other: the run is logged with both outcomes, the failure masked, and answered 500 with the report. Any other
 * failure is logged masked and answered with an empty 500.
 */
export async function GET(request: Request): Promise<Response> {
  if (!cronAuthorized(request.headers.get('authorization'), process.env.CRON_SECRET))
    return new Response(null, { status: 404 })
  try {
    const report = await sweepUploads(uploadSweepDeps(), {
      dryRun: uploadSweepDryRun(process.env),
      now: Date.now(),
      describe: errorSummary,
    })
    if ('failed' in report.art || 'failed' in report.media) {
      consoleLog('upload sweep failed', { art: outcomeField(report.art), media: outcomeField(report.media) })
      return Response.json(report, { status: 500 })
    }
    return Response.json(report)
  } catch (error) {
    consoleLog('upload sweep failed', { error: errorSummary(error) })
    return new Response(null, { status: 500 })
  }
}
