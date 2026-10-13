import type { RenderQueue } from '@cobweb/shared/render-queue'
import { vercelRenderQueue } from '@cobweb/worker/queue'
import { send } from '@vercel/queue'

/**
 * The queue the web app sends render messages to (docs/specs/2026-10-13-render-worker-vercel.md,
 * section 7). On Vercel, the `render` topic through the SDK's `send`, whose default client reads its
 * credentials from the Vercel environment. Anywhere else (local development, the verify scripts, which
 * drive the local runner themselves) a queue that logs and sends nothing, so nothing ever reaches Vercel.
 */
export function renderQueue(
  env: Record<string, string | undefined> = process.env,
  log: (line: string) => void = console.log,
): RenderQueue {
  if (env.VERCEL) return vercelRenderQueue({ send })
  return {
    async send(messages) {
      for (const message of messages) log(`render not queued (no queue here): job ${message.jobId}`)
    },
  }
}
