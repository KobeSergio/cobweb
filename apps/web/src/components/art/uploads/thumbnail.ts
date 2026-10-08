/**
 * Reads an image's pixel size and draws its 256 px WebP thumbnail in the browser, so the Layers
 * and Assets screens never load a full-size file for a grid. Videos and unreadable files report
 * nulls; the server then stores no thumbnail row and the route falls back to the original.
 */

export type Inspected = {
  width: number | null
  height: number | null
  thumbnail: { blob: Blob; width: number; height: number } | null
}

export const THUMBNAIL_SIDE = 256
const THUMBNAIL_MAX_BYTES = 1024 * 1024

/** The size an image gets when its long side is scaled down to `side`; small images stay as they are. */
export function fitWithin(width: number, height: number, side: number): { width: number; height: number } {
  const scale = Math.min(1, side / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

const NOTHING: Inspected = { width: null, height: null, thumbnail: null }

export async function inspectFile(file: File): Promise<Inspected> {
  if (!file.type.startsWith('image/')) return NOTHING
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return NOTHING
  }
  try {
    const size = fitWithin(bitmap.width, bitmap.height, THUMBNAIL_SIDE)
    const canvas = new OffscreenCanvas(size.width, size.height)
    const context = canvas.getContext('2d')
    if (!context) return { width: bitmap.width, height: bitmap.height, thumbnail: null }
    context.drawImage(bitmap, 0, 0, size.width, size.height)
    const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.8 })
    const usable = blob.type === 'image/webp' && blob.size <= THUMBNAIL_MAX_BYTES
    return { width: bitmap.width, height: bitmap.height, thumbnail: usable ? { blob, ...size } : null }
  } catch {
    return { width: bitmap.width, height: bitmap.height, thumbnail: null }
  } finally {
    bitmap.close()
  }
}
