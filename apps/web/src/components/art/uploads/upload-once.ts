import { STOPPED, type StartUpload, type UploadRecord } from './uploader'

export type Uploaded = { record: UploadRecord } | { error: string }

/** Uploads one file and settles when it is stored or has failed (no pause or retry here). */
export function uploadOnce(start: StartUpload, file: File): Promise<Uploaded> {
  return new Promise((resolve) => {
    let settled = false
    let unsubscribe: (() => void) | null = null
    const finish = (result: Uploaded) => {
      if (settled) return
      settled = true
      unsubscribe?.()
      resolve(result)
    }
    const handle = start(file)
    unsubscribe = handle.progress$.subscribe((progress) => {
      if (progress.state === 'done' && progress.record) finish({ record: progress.record })
      else if (progress.state === 'failed') finish({ error: progress.error ?? STOPPED })
    })
    // The listener may have settled during subscribe, before `unsubscribe` existed.
    if (settled) unsubscribe()
  })
}

/** Uploads files `concurrency` at a time; the results keep the files' order. */
export async function uploadAll(start: StartUpload, files: File[], concurrency = 4): Promise<Uploaded[]> {
  const results: Uploaded[] = []
  let next = 0
  const worker = async () => {
    while (next < files.length) {
      const at = next++
      results[at] = await uploadOnce(start, files[at]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker))
  return results
}
