import type { UploadKind } from './keys'

/**
 * Whether a file may be stored for a project, in the creator's words or null. The browser runs
 * this before it starts an upload; the server runs it again before signing one. The database
 * repeats the structural parts (square layer images, size ceiling) in `uploads` checks.
 */

export type FileFacts = { mime: string; bytes: number; width: number | null; height: number | null }
export type Canvas = { width: number; height: number } | null

const MB = 1024 * 1024
/** 5 GB of files per project (MASTER_PLAN, Art: storage limits). */
export const PROJECT_CAP_BYTES = 5 * 1024 * MB

const mb = (bytes: number) => `${Math.ceil(bytes / MB)} MB`

function sizeProblem(bytes: number, limit: number, what = ''): string | null {
  return bytes > limit ? `${mb(bytes)} is over the ${mb(limit)} limit${what}.` : null
}

export function admissionProblem(kind: UploadKind, file: FileFacts, canvas: Canvas): string | null {
  const { mime, bytes, width, height } = file
  if (kind === 'layer_image') {
    if (mime !== 'image/png') return 'Not a PNG file.'
    const size = sizeProblem(bytes, 10 * MB)
    if (size) return size
    if (width === null || height === null) return 'This image could not be read. It may be damaged.'
    if (width !== height) return `Must be square: ${width} x ${height}.`
    if (width > 2048) return `At most 2048 x 2048: ${width} x ${height}.`
    if (canvas && (width !== canvas.width || height !== canvas.height))
      return `Every layer image must be ${canvas.width} x ${canvas.height} in this project.`
    return null
  }
  if (kind === 'thumbnail') {
    if (mime !== 'image/webp') return 'Not a WebP file.'
    const size = sizeProblem(bytes, 1 * MB)
    if (size) return size
    if (width === null || height === null) return 'This image could not be read. It may be damaged.'
    if (width > 256 || height > 256) return `At most 256 x 256: ${width} x ${height}.`
    return null
  }
  // asset and placeholder
  if (mime === 'video/mp4') return sizeProblem(bytes, 50 * MB, ' for an MP4 video')
  if (mime === 'image/gif') return sizeProblem(bytes, 10 * MB, ' for a GIF')
  if (mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/webp') {
    const size = sizeProblem(bytes, 20 * MB)
    if (size) return size
    if (width === null || height === null) return 'This image could not be read. It may be damaged.'
    return null
  }
  return 'Not a PNG, JPG, WebP, GIF or MP4 file.'
}

export function capProblem(usedBytes: number, newBytes: number): string | null {
  return usedBytes + newBytes > PROJECT_CAP_BYTES
    ? 'This project has reached its 5 GB of files. Delete some files to upload more.'
    : null
}
