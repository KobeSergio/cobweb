/**
 * The local runner (docs/specs/2026-10-12-render-worker.md, section 8): drains an in-memory queue
 * the way SQS and the Lambdas would, so the whole pipeline runs without AWS. Also the entry
 * (`@cobweb/worker/local`) that hands the doubles to scripts.
 */
import type { MemoryQueue } from './doubles/memory-queue.ts'
import { errorSummary } from './log.ts'
import { handle, handleDead } from './steps.ts'
import type { Deps } from './steps.ts'

export { flatPng, sizeOf } from './doubles/draw.ts'
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
  const run: LocalRun = { handled: 0, thrown: 0, dead: 0 }
  for (;;) {
    const entry = deps.queue.take()
    if (!entry) {
      const message = deps.queue.takeDead()
      if (!message) return run
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
