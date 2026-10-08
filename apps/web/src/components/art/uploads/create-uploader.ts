'use client'

import { admitUpload, confirmUpload } from '@/app/actions/uploads'
import { sha256Hex } from './hash'
import { inspectFile } from './thumbnail'
import { uploaderWith, type Put, type StartUpload, type UploaderOptions } from './uploader'

/** A PUT by XMLHttpRequest, because fetch reports no upload progress. Aborts with the signal. */
export const xhrPut: Put = (url, body, mime, onProgress, signal) =>
  new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.setRequestHeader('Content-Type', mime)
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded)
    }
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`PUT failed with ${xhr.status}`))
    xhr.onerror = () => reject(new Error('PUT failed'))
    xhr.onabort = () => reject(new DOMException('aborted', 'AbortError'))
    signal.addEventListener('abort', () => xhr.abort())
    xhr.send(body)
  })

/** The uploader the screens use: server actions, Web Crypto, canvas thumbnails and XHR. */
export function createUploader(options: UploaderOptions): StartUpload {
  return uploaderWith(options, {
    admit: admitUpload,
    confirm: confirmUpload,
    hash: sha256Hex,
    inspect: inspectFile,
    put: xhrPut,
  })
}
