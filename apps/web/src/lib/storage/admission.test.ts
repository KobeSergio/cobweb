import { describe, expect, it } from 'vitest'
import { admissionProblem, capProblem, PROJECT_CAP_BYTES } from './admission'

const MB = 1024 * 1024
const png = (bytes: number, width: number, height: number) => ({ mime: 'image/png', bytes, width, height })

describe('admissionProblem', () => {
  it('accepts a square PNG layer image within the limits and the canvas', () => {
    expect(admissionProblem('layer_image', png(5 * MB, 1000, 1000), null)).toBeNull()
    expect(admissionProblem('layer_image', png(5 * MB, 1000, 1000), { width: 1000, height: 1000 })).toBeNull()
  })
  it('refuses layer images that are not PNG, too big, not square, over 2048 or off canvas', () => {
    expect(admissionProblem('layer_image', { ...png(1, 100, 100), mime: 'image/jpeg' }, null)).toBe(
      'Not a PNG file.',
    )
    expect(admissionProblem('layer_image', png(11 * MB, 100, 100), null)).toBe(
      '11 MB is over the 10 MB limit.',
    )
    expect(admissionProblem('layer_image', png(1, 1000, 900), null)).toBe('Must be square: 1000 x 900.')
    expect(admissionProblem('layer_image', png(1, 4096, 4096), null)).toBe(
      'At most 2048 x 2048: 4096 x 4096.',
    )
    expect(admissionProblem('layer_image', png(1, 1000, 1000), { width: 800, height: 800 })).toBe(
      'Every layer image must be 800 x 800 in this project.',
    )
    expect(
      admissionProblem('layer_image', { mime: 'image/png', bytes: 1, width: null, height: null }, null),
    ).toBe('This image could not be read. It may be damaged.')
  })
  it('applies the asset rules by type', () => {
    expect(
      admissionProblem('asset', { mime: 'image/jpeg', bytes: 20 * MB, width: 10, height: 20 }, null),
    ).toBeNull()
    expect(
      admissionProblem('asset', { mime: 'image/webp', bytes: 21 * MB, width: 10, height: 20 }, null),
    ).toBe('21 MB is over the 20 MB limit.')
    expect(
      admissionProblem('asset', { mime: 'image/gif', bytes: 11 * MB, width: 10, height: 20 }, null),
    ).toBe('11 MB is over the 10 MB limit for a GIF.')
    expect(
      admissionProblem('asset', { mime: 'video/mp4', bytes: 50 * MB, width: null, height: null }, null),
    ).toBeNull()
    expect(
      admissionProblem('asset', { mime: 'video/mp4', bytes: 51 * MB, width: null, height: null }, null),
    ).toBe('51 MB is over the 50 MB limit for an MP4 video.')
    expect(admissionProblem('asset', { mime: 'text/plain', bytes: 1, width: null, height: null }, null)).toBe(
      'Not a PNG, JPG, WebP, GIF or MP4 file.',
    )
    expect(
      admissionProblem('placeholder', { mime: 'image/gif', bytes: 1 * MB, width: 10, height: 10 }, null),
    ).toBeNull()
  })
  it('limits thumbnails to small WebP files', () => {
    expect(
      admissionProblem('thumbnail', { mime: 'image/webp', bytes: 200_000, width: 256, height: 180 }, null),
    ).toBeNull()
    expect(admissionProblem('thumbnail', { mime: 'image/png', bytes: 1, width: 10, height: 10 }, null)).toBe(
      'Not a WebP file.',
    )
    expect(
      admissionProblem('thumbnail', { mime: 'image/webp', bytes: 1, width: 300, height: 10 }, null),
    ).toBe('At most 256 x 256: 300 x 10.')
  })
})

describe('capProblem', () => {
  it('allows up to the cap and refuses past it', () => {
    expect(capProblem(PROJECT_CAP_BYTES - 10, 10)).toBeNull()
    expect(capProblem(PROJECT_CAP_BYTES - 10, 11)).toBe(
      'This project has reached its 5 GB of files. Delete some files to upload more.',
    )
  })
})
