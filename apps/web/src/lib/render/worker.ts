import 'server-only'
import type { Env } from '@cobweb/shared'
import { productionDeps, vercelRenderQueue, type Deps, type DepsKind } from '@cobweb/worker'
import { send } from '@vercel/queue'
import { workerEnv } from './env'

/**
 * The worker's production ports for the render routes, over the web app's environment, sending through
 * the `render` topic. "render" for the queue consumer, "jobs" for the sweep (no storage, pinning or
 * chain keys needed). Building them opens no connection.
 */
export function workerDeps(kind: DepsKind, env: Env = process.env): Deps {
  return productionDeps(workerEnv(env), { queue: vercelRenderQueue({ send }), kind })
}

/** The consumer's ports; `queueConsumer` calls this once per instance. */
export const renderDeps = async (): Promise<Deps> => workerDeps('render')
