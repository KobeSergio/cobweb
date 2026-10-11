import type { ImageRef } from './types'

const startsWith = (bytes: Uint8Array, at: number, signature: number[]): boolean =>
  signature.every((byte, i) => bytes[at + i] === byte)

const ascii = (text: string): number[] => [...text].map((char) => char.charCodeAt(0))

const SKIPPABLE_BOXES = ['free', 'wide', 'skip'].map(ascii)

/** True when the first box is a free, wide or skip box and an `ftyp` box follows right after it. */
function ftypAfterLeadingBox(bytes: Uint8Array): boolean {
  const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0)
  if (size < 8 || size > bytes.length) return false
  return (
    SKIPPABLE_BOXES.some((type) => startsWith(bytes, 4, type)) && startsWith(bytes, size + 4, ascii('ftyp'))
  )
}

/**
 * The format a file's leading bytes declare, or null when they match none of the five accepted
 * formats (or the file is shorter than 12 bytes). An MP4 is `ftyp` at offset 4, or at offset size + 4 after a leading free, wide or skip box. Used to check passed-through files, which sharp
 * never reads.
 */
export function sniffExt(bytes: Uint8Array): ImageRef['ext'] | null {
  if (bytes.length < 12) return null
  if (startsWith(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png'
  if (startsWith(bytes, 0, [0xff, 0xd8, 0xff])) return 'jpg'
  if (startsWith(bytes, 0, ascii('RIFF')) && startsWith(bytes, 8, ascii('WEBP'))) return 'webp'
  if (startsWith(bytes, 0, ascii('GIF87a')) || startsWith(bytes, 0, ascii('GIF89a'))) return 'gif'
  if (startsWith(bytes, 4, ascii('ftyp'))) return 'mp4'
  if (ftypAfterLeadingBox(bytes)) return 'mp4'
  return null
}
