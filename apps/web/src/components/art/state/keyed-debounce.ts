/** How long weight, size, text and asset edits wait for the next keystroke before they are saved. */
export const EDIT_DEBOUNCE_MS = 250

/** Runs the last job given for a key once that key has been quiet for `ms`. One timer per key. */
export class KeyedDebounce {
  private readonly ms: number
  private readonly jobs = new Map<string, { timer: ReturnType<typeof setTimeout>; job: () => void }>()

  constructor(ms: number) {
    this.ms = ms
  }

  schedule(key: string, job: () => void): void {
    const current = this.jobs.get(key)
    if (current) clearTimeout(current.timer)
    const timer = setTimeout(() => {
      this.jobs.delete(key)
      job()
    }, this.ms)
    this.jobs.set(key, { timer, job })
  }

  /** Whether any job is still waiting for its timer. */
  pending(): boolean {
    return this.jobs.size > 0
  }

  /** Runs the job waiting for `key` now, if any (a create flushes the weights of its layer first). */
  flush(key: string): void {
    const current = this.jobs.get(key)
    if (!current) return
    this.jobs.delete(key)
    clearTimeout(current.timer)
    current.job()
  }

  /** Runs every waiting job now: leaving the screen must not lose the last edit. */
  flushAll(): void {
    const waiting = [...this.jobs.values()]
    this.jobs.clear()
    for (const { timer, job } of waiting) {
      clearTimeout(timer)
      job()
    }
  }
}
