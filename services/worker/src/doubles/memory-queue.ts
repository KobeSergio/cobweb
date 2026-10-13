import type { RenderMessage, RenderQueue } from '@cobweb/shared/render-queue'

export type QueueEntry = { message: RenderMessage; receives: number }

export type MemoryQueue = RenderQueue & {
  /** Every message ever sent, in order. */
  sent: RenderMessage[]
  /** Messages that were received `maxReceives` times without success. */
  dead: RenderMessage[]
  /** Messages the `drop` option kept from being delivered. */
  dropped: RenderMessage[]
  /** The next message, with its receive count already raised, or null when the queue is empty. */
  take(): QueueEntry | null
  /** Puts a message that failed back at the end, or on the dead-letter list after `maxReceives` receives. */
  release(entry: QueueEntry, maxReceives: number): void
  /** The next dead-letter message, removed from the list, or null. */
  takeDead(): RenderMessage | null
  size(): number
}

/**
 * A queue in memory with the delivery rules that matter to the worker: a message that fails
 * comes back, and after `maxReceives` receives it goes to the dead-letter list. `copies: 2` delivers
 * every message twice, which is how the checks exercise duplicate delivery. `drop` loses the
 * messages it picks, as a crash between a database write and a send would.
 */
export function memoryQueue(
  options: { copies?: number; drop?: (message: RenderMessage) => boolean } = {},
): MemoryQueue {
  const wanted = options.copies ?? 1
  const copies = Number.isInteger(wanted) && wanted > 0 ? wanted : 1
  const waiting: QueueEntry[] = []
  const sent: RenderMessage[] = []
  const dead: RenderMessage[] = []
  const dropped: RenderMessage[] = []
  return {
    sent,
    dead,
    dropped,
    async send(messages) {
      for (const message of messages) {
        sent.push(message)
        if (options.drop?.(message)) {
          dropped.push(message)
          continue
        }
        for (let copy = 0; copy < copies; copy++) waiting.push({ message: { ...message }, receives: 0 })
      }
    },
    take() {
      const entry = waiting.shift()
      if (!entry) return null
      entry.receives += 1
      return entry
    },
    release(entry, maxReceives) {
      if (entry.receives >= maxReceives) dead.push(entry.message)
      else waiting.push(entry)
    },
    takeDead() {
      return dead.shift() ?? null
    },
    size() {
      return waiting.length
    },
  }
}
