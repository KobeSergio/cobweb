/**
 * Browser-side checks for picked image files: type, size on disk, pixel size and squareness.
 * Files are read through object URLs and never leave the browser in this pass.
 *
 * Seam: when uploads go to storage (Phase 3), the server repeats these checks on the stored
 * object; this module stays as the fast first pass.
 */

export type ImageRules = {
  /** MIME types accepted, e.g. `image/png`. */
  types: readonly string[]
  /** How the types read in copy, e.g. "PNG". */
  typesLabel: string
  maxBytes: number
  /** Longest side in pixels, or null for no limit. */
  maxSide: number | null
  square: boolean
  /** Every image must match this size (the project's canvas), when known. */
  sameSizeAs?: { width: number; height: number } | null
}

export const MB = 1024 * 1024

/** The layer rules from the project brief: PNG, square, at most 2048 x 2048, 10 MB each, one size per project. */
export const LAYER_IMAGE_RULES: ImageRules = {
  types: ['image/png'],
  typesLabel: 'PNG',
  maxBytes: 10 * MB,
  maxSide: 2048,
  square: true,
}

export type CheckedFile = {
  /** Stable key for lists. */
  key: string
  file: File
  /** Object URL for previews. Revoke it with `releaseChecked` when the file is dropped. */
  url: string
  width: number | null
  height: number | null
  errors: string[]
}

export function formatBytes(bytes: number): string {
  if (bytes >= MB) return `${(bytes / MB).toLocaleString('en-US', { maximumFractionDigits: 1 })} MB`
  return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString('en-US')} KB`
}

function readSize(url: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => resolve(null)
    image.src = url
  })
}

let counter = 0

/**
 * Checks each file against the rules. The first valid file sets the size the rest must match
 * when `sameSizeAs` is not given, so a batch can never mix sizes.
 */
export async function checkImageFiles(files: File[], rules: ImageRules): Promise<CheckedFile[]> {
  let canvas = rules.sameSizeAs ?? null
  const results: CheckedFile[] = []
  for (const file of files) {
    const url = URL.createObjectURL(file)
    const errors: string[] = []
    if (!rules.types.includes(file.type)) errors.push(`Not a ${rules.typesLabel} file.`)
    if (file.size > rules.maxBytes)
      errors.push(`${formatBytes(file.size)} is over the ${formatBytes(rules.maxBytes)} limit.`)
    const size = errors.length === 0 || rules.types.includes(file.type) ? await readSize(url) : null
    if (!size && errors.length === 0) errors.push('This image could not be read. It may be damaged.')
    if (size) {
      if (rules.square && size.width !== size.height)
        errors.push(`${size.width} x ${size.height} is not square.`)
      if (rules.maxSide && Math.max(size.width, size.height) > rules.maxSide)
        errors.push(`Larger than ${rules.maxSide} x ${rules.maxSide}.`)
      if (canvas && (size.width !== canvas.width || size.height !== canvas.height))
        errors.push(
          `${size.width} x ${size.height} does not match the project size, ${canvas.width} x ${canvas.height}.`,
        )
      if (errors.length === 0 && !canvas) canvas = size
    }
    results.push({
      key: `file-${++counter}`,
      file,
      url,
      width: size?.width ?? null,
      height: size?.height ?? null,
      errors,
    })
  }
  return results
}

/** Frees the object URLs of files that were rejected or removed. */
export function releaseChecked(files: CheckedFile[]) {
  for (const entry of files) URL.revokeObjectURL(entry.url)
}

/** A display name from a file name: `wizard_hat.png` to `Wizard hat`. */
export function nameFromFile(fileName: string): string {
  const base = fileName
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .trim()
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : 'Untitled'
}
