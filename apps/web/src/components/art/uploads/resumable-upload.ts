/**
 * One file's resumable upload: progress as a stream, and pause, resume and retry.
 *
 * Seam: storage is Phase 3. `startUpload` simulates the transfer in the browser so the queue, the
 * progress and the controls can be built and tried now. Replace its body with a real resumable
 * upload (for example tus to Supabase Storage: create the upload, PATCH chunks from `offset`,
 * HEAD to find the offset again after a pause or a failure) and keep this shape:
 *
 *   startUpload(file) -> { progress$, pause(), resume(), retry(), cancel() }
 *
 * `progress$` emits the current state on subscribe and after every change. `retry()` continues
 * from the last confirmed byte, not from zero; that is what makes it resumable.
 */

export type UploadState = 'uploading' | 'paused' | 'done' | 'failed'

export type UploadProgress = {
  state: UploadState
  /** Bytes the server has confirmed. */
  sentBytes: number
  totalBytes: number
  /** Why it failed, in words the creator can act on. */
  error?: string
  /** Where the stored object lives, once done. */
  url?: string
}

/** A minimal observable: `subscribe` returns the unsubscribe. */
export type Observable<T> = { subscribe(listener: (value: T) => void): () => void }

export type UploadHandle = {
  progress$: Observable<UploadProgress>
  pause(): void
  resume(): void
  retry(): void
  /** Stops for good and frees what the upload holds. */
  cancel(): void
}

export type StartUpload = (file: File) => UploadHandle

/** Simulated transfer speed and chunking: a 1 MB layer takes about a quarter of a second. */
const TICK_MS = 80
const BYTES_PER_TICK = 320 * 1024
/** Share of uploads that drop once part way, so retry can be seen working. */
const FAILURE_RATE = 0.03

export const startUpload: StartUpload = (file) => {
  const listeners = new Set<(value: UploadProgress) => void>()
  let progress: UploadProgress = { state: 'uploading', sentBytes: 0, totalBytes: file.size }
  let timer: ReturnType<typeof setInterval> | null = null
  // Where this upload will drop, if it is one of the unlucky ones. It drops only once.
  let failAt = Math.random() < FAILURE_RATE ? Math.floor(file.size * (0.2 + Math.random() * 0.6)) : -1

  const emit = (patch: Partial<UploadProgress>) => {
    progress = { ...progress, ...patch }
    for (const listener of listeners) listener(progress)
  }
  const stop = () => {
    if (timer) clearInterval(timer)
    timer = null
  }
  const run = () => {
    stop()
    emit({ state: 'uploading', error: undefined })
    timer = setInterval(() => {
      const sent = Math.min(progress.totalBytes, progress.sentBytes + BYTES_PER_TICK)
      if (failAt >= 0 && sent >= failAt) {
        failAt = -1
        stop()
        emit({ state: 'failed', error: 'The connection dropped. Retry to continue where it stopped.' })
        return
      }
      if (sent >= progress.totalBytes) {
        stop()
        emit({
          state: 'done',
          sentBytes: progress.totalBytes,
          url: `simulated://uploads/${encodeURIComponent(file.name)}`,
        })
        return
      }
      emit({ sentBytes: sent })
    }, TICK_MS)
  }

  run()

  return {
    progress$: {
      subscribe(listener) {
        listeners.add(listener)
        listener(progress)
        return () => listeners.delete(listener)
      },
    },
    pause() {
      if (progress.state !== 'uploading') return
      stop()
      emit({ state: 'paused' })
    },
    resume() {
      if (progress.state === 'paused') run()
    },
    retry() {
      if (progress.state === 'failed') run()
    },
    cancel() {
      stop()
      listeners.clear()
    },
  }
}
