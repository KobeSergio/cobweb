import { consoleLog, errorSummary, sweep } from '@cobweb/worker'
import { cronAuthorized } from '@/lib/render/env'
import { workerDeps } from '@/lib/render/worker'

/**
 * The render sweep, run by Vercel Cron every 15 minutes (docs/specs/2026-10-13-render-worker-vercel.md,
 * section 7): sends a start message again for each job nothing has touched for 15 minutes. Vercel sends
 * `Authorization: Bearer <CRON_SECRET>`; any other caller gets a 404, as the other routes answer the
 * unknown. A failure is logged masked and answered with an empty 500.
 */
export async function GET(request: Request): Promise<Response> {
  if (!cronAuthorized(request.headers.get('authorization'), process.env.CRON_SECRET))
    return new Response(null, { status: 404 })
  try {
    const requeued = await sweep(workerDeps('jobs'))
    return Response.json({ requeued })
  } catch (error) {
    consoleLog('sweep failed', { error: errorSummary(error) })
    return new Response(null, { status: 500 })
  }
}
