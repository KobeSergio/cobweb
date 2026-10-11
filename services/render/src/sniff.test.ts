import { describe, expect, it } from 'vitest'
import { sniffExt } from './sniff'

const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0))
const pad = (head: number[], length = 16) =>
  new Uint8Array([...head, ...new Array(length - head.length).fill(0)])

describe('sniffExt', () => {
  it('recognises a PNG', () => {
    expect(sniffExt(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('png')
  })

  it('recognises a JPG', () => {
    expect(sniffExt(pad([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpg')
  })

  it('recognises a WebP', () => {
    expect(sniffExt(pad([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP')]))).toBe('webp')
  })

  it('recognises both GIF versions', () => {
    expect(sniffExt(pad(ascii('GIF87a')))).toBe('gif')
    expect(sniffExt(pad(ascii('GIF89a')))).toBe('gif')
  })

  it('recognises an MP4 by ftyp at offset 4', () => {
    expect(sniffExt(pad([0, 0, 0, 0x18, ...ascii('ftypisom')]))).toBe('mp4')
  })

  it('returns null for random bytes and for fewer than 12 bytes', () => {
    expect(sniffExt(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]))).toBeNull()
    expect(sniffExt(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBeNull()
  })

  it('returns null for a RIFF container that is not WebP', () => {
    expect(sniffExt(pad([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WAVE')]))).toBeNull()
  })

  it('recognises a PNG head of exactly 12 bytes', () => {
    expect(sniffExt(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 12))).toBe('png')
  })
})
