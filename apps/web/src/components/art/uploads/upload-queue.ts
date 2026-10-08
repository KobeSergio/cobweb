'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import type { StartUpload, UploadHandle, UploadRecord, UploadState } from './uploader'

/** A file in the queue. `queued` has not started; a paused file that never started has no handle. */
export type QueueItem = {
  id: string
  file: File
  /** What the row shows, e.g. `male/eyes/starry.png`. */
  label: string
  state: 'queued' | UploadState
  sentBytes: number
  totalBytes: number
  error?: string
  url?: string
  uploadId?: string
  record?: UploadRecord
}

export type QueueTotals = {
  files: number
  done: number
  failed: number
  paused: number
  active: number
  sentBytes: number
  totalBytes: number
  /** Every file is uploaded. */
  complete: boolean
}

/**
 * Uploads files a few at a time, each through `startUpload` (see `uploader.ts`). Held
 * outside React so a file's progress can change many times a second without re-running effects;
 * screens read it with `useUploadQueue`.
 */
export class UploadQueue {
  private items: QueueItem[] = []
  private readonly handles = new Map<string, { handle: UploadHandle; unsubscribe: () => void }>()
  private readonly listeners = new Set<() => void>()

  constructor(
    private readonly concurrency: number,
    private readonly start: StartUpload,
  ) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = () => this.items

  add(entries: { id: string; file: File; label: string }[]) {
    const known = new Set(this.items.map((item) => item.id))
    const fresh = entries
      .filter((entry) => !known.has(entry.id))
      .map((entry): QueueItem => ({ ...entry, state: 'queued', sentBytes: 0, totalBytes: entry.file.size }))
    this.items = [...this.items, ...fresh]
    this.emit()
    this.pump()
  }

  pause(id: string) {
    const item = this.items.find((entry) => entry.id === id)
    if (!item) return
    if (item.state === 'queued') this.patch(id, { state: 'paused' })
    else this.handles.get(id)?.handle.pause()
  }

  resume(id: string) {
    const item = this.items.find((entry) => entry.id === id)
    if (item?.state !== 'paused') return
    const started = this.handles.get(id)
    if (started) started.handle.resume()
    else this.patch(id, { state: 'queued' })
    this.pump()
  }

  retry(id: string) {
    this.handles.get(id)?.handle.retry()
  }

  pauseAll() {
    for (const item of this.items)
      if (item.state === 'queued' || item.state === 'uploading') this.pause(item.id)
  }

  resumeAll() {
    // Files that had started continue first; files that never started wait for a free slot.
    for (const item of this.items)
      if (item.state === 'paused' && this.handles.has(item.id)) this.resume(item.id)
    for (const item of this.items) if (item.state === 'paused') this.resume(item.id)
  }

  retryFailed() {
    for (const item of this.items) if (item.state === 'failed') this.retry(item.id)
  }

  remove(id: string) {
    this.drop(id)
    this.items = this.items.filter((item) => item.id !== id)
    this.emit()
    this.pump()
  }

  /** Stops every upload. Call when the screen goes away. */
  dispose() {
    for (const id of [...this.handles.keys()]) this.drop(id)
  }

  private drop(id: string) {
    const started = this.handles.get(id)
    if (!started) return
    started.unsubscribe()
    started.handle.cancel()
    this.handles.delete(id)
  }

  private pump() {
    let active = this.items.filter((item) => item.state === 'uploading').length
    for (const item of this.items) {
      if (active >= this.concurrency) break
      if (item.state !== 'queued') continue
      active++
      const handle = this.start(item.file)
      const unsubscribe = handle.progress$.subscribe((progress) => {
        const before = this.items.find((entry) => entry.id === item.id)?.state
        this.patch(item.id, progress)
        // A slot opened: start the next file.
        if (before === 'uploading' && progress.state !== 'uploading') this.pump()
      })
      this.handles.set(item.id, { handle, unsubscribe })
    }
  }

  private patch(id: string, patch: Partial<QueueItem>) {
    this.items = this.items.map((item) => (item.id === id ? { ...item, ...patch } : item))
    this.emit()
  }

  private emit() {
    for (const listener of this.listeners) listener()
  }
}

export function queueTotals(items: QueueItem[]): QueueTotals {
  const totals: QueueTotals = {
    files: items.length,
    done: 0,
    failed: 0,
    paused: 0,
    active: 0,
    sentBytes: 0,
    totalBytes: 0,
    complete: false,
  }
  for (const item of items) {
    if (item.state === 'done') totals.done++
    else if (item.state === 'failed') totals.failed++
    else if (item.state === 'paused') totals.paused++
    else if (item.state === 'uploading') totals.active++
    totals.sentBytes += item.sentBytes
    totals.totalBytes += item.totalBytes
  }
  totals.complete = items.length > 0 && totals.done === items.length
  return totals
}

const EMPTY: QueueItem[] = []

/** A queue for the life of the screen, and its items. Uploads stop when the screen unmounts. */
export function useUploadQueue(concurrency: number, start: StartUpload) {
  const [queue] = useState(() => new UploadQueue(concurrency, start))
  useEffect(() => () => queue.dispose(), [queue])
  const items = useSyncExternalStore(queue.subscribe, queue.getSnapshot, () => EMPTY)
  return { queue, items }
}
