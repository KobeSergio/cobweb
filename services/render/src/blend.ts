/** Opacity as stored is 0 to 1. Out of range values are clamped; NaN counts as fully opaque. */
export function alphaOf(opacity: number): number {
  const clamped = Number.isNaN(opacity) ? 1 : Math.min(1, Math.max(0, opacity))
  return Math.round(clamped * 255)
}

const div255 = (x: number): number => Math.trunc((x + 127) / 255)

/**
 * Composites `src` over `dst` in place. Both are raw 8-bit straight-alpha RGBA of equal length;
 * `alpha` (0 to 255) scales the source alpha. Integer arithmetic only, so the result is the same on
 * every CPU architecture (libvips blends in floats, which round differently on x64 and arm64).
 */
export function blendOver(dst: Uint8Array, src: Uint8Array, alpha: number): void {
  for (let i = 0; i < dst.length; i += 4) {
    const as = div255(src[i + 3]! * alpha)
    const wd = div255(dst[i + 3]! * (255 - as))
    const oa = as + wd
    for (let c = 0; c < 3; c++) {
      dst[i + c] = oa === 0 ? 0 : Math.trunc(((src[i + c]! * as + dst[i + c]! * wd) * 2 + oa) / (2 * oa))
    }
    dst[i + 3] = oa
  }
}
