import { consoleLog, errorSummary } from '@cobweb/worker'
import { cronAuthorized } from '@/lib/render/env'
import { sourceSweepDryRun, sweepSources } from '@/lib/storage/source-sweep'
import { sourceSweepDeps } from '@/lib/storage/source-sweep-deps'

/** Up to 20 collections a run, each a few list and delete calls. */
export const maxDuration = 300

/**
 * The source sweep, run by Vercel Cron every day at 07:30 UTC (docs/specs/2026-10-17-production-hardening.md,
 * section 7.2): deletes the original files of the collections due, dry until SOURCE_SWEEP_DELETE is 1, and answers
 * the run's report. Vercel sends `Authorization: Bearer <CRON_SECRET>`; any other caller gets a 404, as the render
 * sweep answers. A failure is logged masked and answered with an empty 500.
 */
export async function GET(request: Request): Promise<Response> {
  if (!cronAuthorized(request.headers.get('authorization'), process.env.CRON_SECRET))
    return new Response(null, { status: 404 })
  try {
    const report = await sweepSources(sourceSweepDeps(), { dryRun: sourceSweepDryRun(process.env) })
    return Response.json(report)
  } catch (error) {
    consoleLog('source sweep failed', { error: errorSummary(error) })
    return new Response(null, { status: 500 })
  }
}
