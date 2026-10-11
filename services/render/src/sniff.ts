import type { ImageRef } from './types'

const startsWith = (bytes: Uint8Array, at: number, signature: number[]): boolean =>
  signature.every((byte, i) => bytes[at + i] === byte)

const ascii = (text: string): number[] => [...text].map((char) => char.charCodeAt(0))

/**
 * The format a file's leading bytes declare, or null when they match none of the five accepted
 * formats (or the file is shorter than 12 bytes). Used to check passed-through files, which sharp
 * never reads.
 */
export function sniffExt(bytes: Uint8Array): ImageRef['ext'] | null {
  if (bytes.length < 12) return null
  if (startsWith(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png'
  if (startsWith(bytes, 0, [0xff, 0xd8, 0xff])) return 'jpg'
  if (startsWith(bytes, 0, ascii('RIFF')) && startsWith(bytes, 8, ascii('WEBP'))) return 'webp'
  if (startsWith(bytes, 0, ascii('GIF87a')) || startsWith(bytes, 0, ascii('GIF89a'))) return 'gif'
  if (startsWith(bytes, 4, ascii('ftyp'))) return 'mp4'
  return null
}
