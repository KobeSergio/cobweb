import { admissionProblem } from '@/lib/storage/admission'
import type { AdmitInput, AdmitResult, ConfirmInput, UploadRecord } from '@/lib/storage/uploads-service'
import type { Inspected } from './thumbnail'

/**
 * One file's upload: progress as a stream, and pause, resume and retry.
 *
 * A file goes up in one PUT to a presigned URL (docs/specs/2026-10-08-art-upload.md, section 8):
 * hash and inspect, ask the server to admit it, PUT the file and its thumbnail, then ask the server
 * to confirm and record it. Pause aborts the PUT; resume and retry start the PUT again from zero.
 * The hash and thumbnail are computed once per file and reused across retries.
 *
 * `uploaderWith` takes its dependencies so the state machine can be tested without a browser;
 * `createUploader` (create-uploader.ts) wires the real ones.
 */

export type { UploadRecord }

export type UploadState = 'uploading' | 'paused' | 'done' | 'failed'

export type UploadProgress = {
  state: UploadState
  /** Bytes of the file sent so far. Back to 0 whenever the PUT restarts. */
  sentBytes: number
  totalBytes: number
  /** Why it failed, in words the creator can act on. */
  error?: string
  /** Where the stored file is served from, once done. */
  url?: string
  /** The `uploads` row, once done. */
  uploadId?: string
  record?: UploadRecord
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

export type Put = (
  url: string,
  body: Blob,
  mime: string,
  onProgress: (sent: number) => void,
  signal: AbortSignal,
) => Promise<void>

export type UploaderDeps = {
  admit: (input: AdmitInput) => Promise<AdmitResult | { error: string }>
  confirm: (input: ConfirmInput) => Promise<{ upload: UploadRecord } | { error: string }>
  hash: (blob: Blob) => Promise<string>
  inspect: (file: File) => Promise<Inspected>
  put: Put
}

export type UploaderOptions = { collectionId: string; kind: 'layer_image' | 'asset' | 'placeholder' }

export const STOPPED = 'The upload stopped. Retry to upload it again.'

type Prepared = { input: AdmitInput; thumbnailBlob: Blob | null }

export function uploaderWith(options: UploaderOptions, deps: UploaderDeps): StartUpload {
  const { collectionId, kind } = options
  return (file) => {
    const listeners = new Set<(value: UploadProgress) => void>()
    let progress: UploadProgress = { state: 'uploading', sentBytes: 0, totalBytes: file.size }
    let controller: AbortController | null = null
    // Each run has a number; a pause, cancel or restart raises it, and the old run's results are dropped.
    let generation = 0
    let prepared: Promise<Prepared> | null = null

    const emit = (patch: Partial<UploadProgress>) => {
      progress = { ...progress, ...patch }
      for (const listener of listeners) listener(progress)
    }

    const prepare = () =>
      (prepared ??= (async () => {
        const seen = await deps.inspect(file)
        const contentHash = await deps.hash(file)
        const thumbnail = seen.thumbnail
          ? {
              mime: 'image/webp' as const,
              bytes: seen.thumbnail.blob.size,
              width: seen.thumbnail.width,
              height: seen.thumbnail.height,
              contentHash: await deps.hash(seen.thumbnail.blob),
            }
          : null
        const input: AdmitInput = {
          collectionId,
          kind,
          fileName: file.name,
          mime: file.type,
          bytes: file.size,
          width: seen.width,
          height: seen.height,
          contentHash,
          thumbnail,
        }
        return { input, thumbnailBlob: seen.thumbnail?.blob ?? null }
      })().catch((e) => {
        // A failed read is not kept, so retry reads the file again.
        prepared = null
        throw e
      }))

    const run = async () => {
      const mine = ++generation
      const live = () => mine === generation
      controller = new AbortController()
      const { signal } = controller
      emit({ state: 'uploading', sentBytes: 0, error: undefined })
      try {
        const { input, thumbnailBlob } = await prepare()
        if (!live()) return
        const problem = admissionProblem(kind, input, null)
        if (problem) return emit({ state: 'failed', error: problem })
        const admitted = await deps.admit(input)
        if (!live()) return
        if ('error' in admitted) return emit({ state: 'failed', error: admitted.error })
        if (admitted.existing) return finish(admitted.upload)
        await deps.put(
          admitted.putUrl,
          file,
          input.mime,
          (sent) => {
            if (live()) emit({ sentBytes: Math.min(sent, file.size) })
          },
          signal,
        )
        if (!live()) return
        if (admitted.thumbnail && thumbnailBlob)
          await deps.put(admitted.thumbnail.putUrl, thumbnailBlob, 'image/webp', () => {}, signal)
        if (!live()) return
        const confirmed = await deps.confirm({
          ...input,
          key: admitted.key,
          thumbnailKey: admitted.thumbnail?.key ?? null,
        })
        if (!live()) return
        if ('error' in confirmed) return emit({ state: 'failed', sentBytes: 0, error: confirmed.error })
        finish(confirmed.upload)
      } catch {
        // A paused or cancelled run was aborted on purpose and has already said so.
        if (live()) emit({ state: 'failed', sentBytes: 0, error: STOPPED })
      }
    }

    const finish = (record: UploadRecord) =>
      emit({ state: 'done', sentBytes: file.size, url: record.url, uploadId: record.id, record })

    const stop = () => {
      generation++
      controller?.abort()
      controller = null
    }

    void run()

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
        emit({ state: 'paused', sentBytes: 0 })
      },
      resume() {
        if (progress.state === 'paused') void run()
      },
      retry() {
        if (progress.state === 'failed') void run()
      },
      cancel() {
        stop()
        listeners.clear()
      },
    }
  }
}
