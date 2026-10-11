import sharp from 'sharp'

// Determinism (spec section 12): no operation cache and one libvips thread, so output never
// depends on thread scheduling. Set once, when the module loads.
sharp.cache(false)
sharp.concurrency(1)

/** PNG settings for every image the library writes. `withMetadata` is never called: no EXIF, ICC or time chunk. */
export const PNG_OPTIONS = { compressionLevel: 9, adaptiveFiltering: false, palette: false } as const

/** A fully transparent pixel, for canvases and letterboxing. */
export const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 }

/**
 * libvips threads per image. The benchmark (third sub-project) may raise it after proving CIDs stay
 * identical; nothing else about sharp is exposed.
 */
export function setConcurrency(threads: number): void {
  sharp.concurrency(Math.max(1, Math.floor(threads)))
}

/** A Buffer as a plain Uint8Array over the same memory. */
export function bytesOf(buffer: Buffer): Uint8Array {
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
}

export { sharp }
