/**
 * The local runner (docs/specs/2026-10-12-render-worker.md, section 8): drains an in-memory queue
 * the way Vercel Queues and the queue consumer would, so the whole pipeline runs locally. Also the entry
 * (`@cobweb/worker/local`) that hands the doubles to scripts.
 */
import type { RenderMessage } from '@cobweb/shared/render-queue'
import type { MemoryQueue } from './doubles/memory-queue.ts'
import { errorSummary } from './log.ts'
import { handle, handleDead } from './steps.ts'
import type { Deps } from './steps.ts'

export { flatPng, rgbaAt, sizeOf } from './doubles/draw.ts'
export { memoryQueue } from './doubles/memory-queue.ts'
export type { MemoryQueue, QueueEntry } from './doubles/memory-queue.ts'
export { memoryStore } from './doubles/memory-store.ts'
export type { MemoryStore } from './doubles/memory-store.ts'
export { carRoot, failingPinner, folderPinner, WRONG_CID, wrongCidPinner } from './doubles/pinners.ts'
export type { FailingPinner, FolderPinner } from './doubles/pinners.ts'

export type LocalRun = {
  /** Deliveries that returned normally. */
  handled: number
  /** Deliveries that threw and were put back or dead-lettered. */
  thrown: number
  /** Messages handed to the dead-letter handler. */
  dead: number
  /** The messages handed to the dead-letter handler, in order. */
  deadMessages: RenderMessage[]
}

/**
 * Delivers messages until the queue is empty: a delivery that throws is redelivered, and after
 * `maxReceives` receives (3, the queue's redrive count) the message goes to `handleDead`. Stops with
 * an error after `maxDeliveries`, so a loop in a step cannot hang a script.
 */
export async function runLocal(
  deps: Deps & { queue: MemoryQueue },
  options: { maxReceives?: number; maxDeliveries?: number } = {},
): Promise<LocalRun> {
  const maxReceives = options.maxReceives ?? 3
  const maxDeliveries = options.maxDeliveries ?? 100_000
  const run: LocalRun = { handled: 0, thrown: 0, dead: 0, deadMessages: [] }
  for (;;) {
    const entry = deps.queue.take()
    if (!entry) {
      const message = deps.queue.takeDead()
      if (!message) return run
      // Recorded first, so the message is known even when the handler throws.
      run.deadMessages.push(message)
      await handleDead(message, deps)
      run.dead += 1
      continue
    }
    if (run.handled + run.thrown >= maxDeliveries)
      throw new Error(`The local runner stopped after ${maxDeliveries} deliveries.`)
    try {
      await handle(entry.message, deps)
      run.handled += 1
    } catch (error) {
      run.thrown += 1
      deps.log('delivery failed', {
        jobId: entry.message.jobId,
        step: entry.message.step,
        receives: entry.receives,
        error: errorSummary(error),
      })
      deps.queue.release(entry, maxReceives)
    }
  }
}
