import { LOCKED, THROWN, type ActionResult } from '@/lib/art/result'
import type { ArtProject } from './art-store'

export type Persist<T = unknown> = () => Promise<ActionResult<T>>

/**
 * An edit shown at once and then saved. `undo` replaces the snapshot when the snapshot would be
 * stale; it also gets the snapshot, to choose between restoring it and something else.
 */
export type SyncEdit = {
  apply: (project: ArtProject) => ArtProject
  persist?: Persist
  undo?: (project: ArtProject, snapshot: ArtProject) => ArtProject
}

/** An edit that needs the id the server makes: applied once the action returns it (`data` is null in sample mode). */
export type SyncCreate<T> = {
  persist: Persist<T>
  apply: (project: ArtProject, data: T | null) => ArtProject
}

export type QueueOptions = {
  demo: boolean
  read: () => ArtProject
  write: (project: ArtProject) => void
  notify: (message: string) => void
  onLocked: () => void
}

type Entry = {
  /** The project when the edit joined the queue. */
  snapshot: ArtProject
  undo?: (project: ArtProject, snapshot: ArtProject) => ArtProject
  cancelled: boolean
}

/**
 * Mirrors the Art screens' edits to their server actions (docs/specs/2026-10-08-art-wiring.md,
 * section 5): one promise chain per collection, so saves happen in the order the creator made the
 * edits; optimistic on screen; a failed save rolls back and drops what was queued behind it. Pure
 * (no React), so it is tested under Node with fake actions.
 */
export class ArtSyncQueue {
  private options: QueueOptions
  private tail: Promise<unknown> = Promise.resolve()
  /** Edits not yet saved or rolled back, oldest first. */
  private waiting: Entry[] = []
  private locked = false

  constructor(options: QueueOptions) {
    this.options = options
  }

  /** A remounted provider points the shared queue at its own `demo` flag and lock callback. */
  configure(options: QueueOptions): void {
    this.options = options
  }

  isLocked(): boolean {
    return this.locked
  }

  run(edit: SyncEdit): Promise<boolean> {
    if (this.locked) return Promise.resolve(false)
    const snapshot = this.options.read()
    this.options.write(edit.apply(snapshot))
    const persist = edit.persist
    if (this.options.demo || !persist) return Promise.resolve(true)
    const entry: Entry = { snapshot, undo: edit.undo, cancelled: false }
    this.waiting.push(entry)
    return this.enqueue(async () => {
      if (entry.cancelled) return false
      const result = await this.call(persist)
      if (!result.ok) {
        this.rollBack(entry)
        return false
      }
      this.settle(entry)
      return true
    })
  }

  create<T>(edit: SyncCreate<T>): Promise<boolean> {
    if (this.locked) return Promise.resolve(false)
    if (this.options.demo) {
      this.options.write(edit.apply(this.options.read(), null))
      return Promise.resolve(true)
    }
    const entry: Entry = { snapshot: this.options.read(), cancelled: false }
    this.waiting.push(entry)
    return this.enqueue(async () => {
      if (entry.cancelled) return false
      const result = await this.call(edit.persist)
      if (!result.ok) {
        this.rollBack(entry)
        return false
      }
      this.settle(entry)
      // Edits made while the create was out keep the new row if one of them fails later.
      for (const later of this.waiting) later.snapshot = edit.apply(later.snapshot, result.data)
      this.options.write(edit.apply(this.options.read(), result.data))
      return true
    })
  }

  /** Anything queued or in flight: leaving the page now would lose an edit. */
  pending(): boolean {
    return this.waiting.length > 0
  }

  /** Resolves once every queued edit has been saved or rolled back. */
  idle(): Promise<void> {
    return this.tail.then(() => undefined)
  }

  private enqueue(task: () => Promise<boolean>): Promise<boolean> {
    const next = this.tail.then(task)
    this.tail = next.catch(() => undefined)
    return next
  }

  private settle(entry: Entry) {
    this.waiting = this.waiting.filter((other) => other !== entry)
  }

  /** Puts back what the screen showed before the failed edit and drops the edits queued behind it. */
  private rollBack(entry: Entry) {
    const at = this.waiting.indexOf(entry)
    const behind = at === -1 ? [] : this.waiting.slice(at + 1)
    for (const later of behind) later.cancelled = true
    if (at !== -1) this.waiting = this.waiting.slice(0, at)
    const base = behind[0]?.snapshot ?? this.options.read()
    this.options.write(entry.undo ? entry.undo(base, entry.snapshot) : entry.snapshot)
  }

  private async call<T>(persist: Persist<T>): Promise<ActionResult<T>> {
    let result: ActionResult<T>
    try {
      result = await persist()
    } catch {
      result = { ok: false, error: THROWN }
    }
    if (!result.ok) {
      if (result.error === LOCKED && !this.locked) {
        this.locked = true
        this.options.onLocked()
      }
      this.options.notify(result.error)
    }
    return result
  }
}

const queues = new Map<string, ArtSyncQueue>()

/**
 * The one queue of a collection, shared by every mount of the Art layout so a save still in flight
 * when the creator leaves and returns stays ahead of the new edits. Each call re-points it at the
 * caller's options.
 */
export function getQueue(collectionId: string, options: QueueOptions): ArtSyncQueue {
  const existing = queues.get(collectionId)
  if (existing) {
    existing.configure(options)
    return existing
  }
  const created = new ArtSyncQueue(options)
  queues.set(collectionId, created)
  return created
}
