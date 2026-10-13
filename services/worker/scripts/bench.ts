// Renders one batch in process and prints wall time, peak resident memory and CAR size
// (docs/specs/2026-10-12-render-worker.md, section 8). The same batch on a Vercel Function took 187
// seconds at a 779 MB peak (docs/specs/2026-10-13-render-worker-vercel.md, section 2). Not a test:
// nothing asserts on its numbers.
//
//   pnpm --filter @cobweb/worker bench
//   options: --tokens <n> (default 100), --size <pixels> (default 2048), --layers <n> (default 7)
//
// Layer images are drawn here (no file is read or written): an opaque background layer and layers
// with a soft-edged disc on transparency, four traits a layer, so the PNGs compress about as real
// art does and every token composites every layer.

import { arch, cpus, platform } from 'node:os'
import { renderBatch } from '@cobweb/render'
import type { GenerativeSpec, GenerativeToken, ImageRef } from '@cobweb/render'
import sharp from 'sharp'

function option(name: string, fallback: number): number {
  const at = process.argv.indexOf(`--${name}`)
  const value = at === -1 ? fallback : Number(process.argv[at + 1])
  if (!Number.isInteger(value) || value < 1) {
    console.error(`--${name} takes a whole number above 0.`)
    process.exit(2)
  }
  return value
}

const TOKENS = option('tokens', 100)
const SIZE = option('size', 2048)
const LAYERS = option('layers', 7)
const TRAITS = 4

/** One layer image as PNG bytes: layer 0 is opaque, the others a disc that fades out at its edge. */
async function drawLayer(layer: number, trait: number): Promise<Uint8Array> {
  const pixels = new Uint8Array(SIZE * SIZE * 4)
  const centre = SIZE / 2
  const radius = (SIZE / 2) * (0.9 - layer * 0.08)
  const [r, g, b] = [
    (layer * 37 + trait * 61) % 256,
    (layer * 91 + trait * 17) % 256,
    (layer * 13 + trait * 113) % 256,
  ]
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const at = (y * SIZE + x) * 4
      const distance = Math.hypot(x - centre, y - centre)
      const shade = ((x >> 5) + (y >> 5)) % 2 ? 24 : 0
      pixels[at] = (r + shade) % 256
      pixels[at + 1] = (g + shade) % 256
      pixels[at + 2] = (b + shade) % 256
      pixels[at + 3] = layer === 0 ? 255 : Math.max(0, Math.min(255, Math.round((radius - distance) * 4)))
    }
  const png = await sharp(pixels, { raw: { width: SIZE, height: SIZE, channels: 4 } })
    .png()
    .toBuffer()
  return new Uint8Array(png)
}

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

console.log(`Drawing ${LAYERS} layers of ${TRAITS} traits at ${SIZE} by ${SIZE}...`)
const images = new Map<string, Uint8Array>()
const spec: GenerativeSpec = {
  kind: 'generative',
  canvas: SIZE,
  batchSize: TOKENS,
  text: { tokenName: 'Bench', tokenDescription: '', showBlankTraits: false, extraFields: {} },
  collections: [{ id: 'bench', layers: [] }],
}
let sourceBytes = 0
for (let layer = 0; layer < LAYERS; layer++) {
  const traits = []
  for (let trait = 0; trait < TRAITS; trait++) {
    const key = `bench/layers/${layer}-${trait}.png`
    const png = await drawLayer(layer, trait)
    images.set(key, png)
    sourceBytes += png.byteLength
    traits.push({
      id: `${layer}-${trait}`,
      name: `Trait ${trait}`,
      blank: false,
      inMetadata: true,
      image: { key, ext: 'png' as const },
    })
  }
  spec.collections[0]!.layers.push({
    id: `layer-${layer}`,
    name: `Layer ${layer}`,
    displayName: null,
    opacity: 1,
    traits,
  })
}
const tokens: GenerativeToken[] = Array.from({ length: TOKENS }, (_, n) => ({
  id: n + 1,
  collectionId: 'bench',
  dna: Array.from({ length: LAYERS }, (_, layer) => `${layer}-${(n + layer * 3 + (n >> layer)) % TRAITS}`),
  description: null,
}))
const load = async (ref: ImageRef): Promise<Uint8Array> => {
  const bytes = images.get(ref.key)
  if (!bytes) throw new Error(`No image at ${ref.key}`)
  return bytes
}

console.log(`Rendering one batch of ${TOKENS} tokens...`)
const started = performance.now()
const batch = await renderBatch(spec, 0, tokens, load)
const seconds = (performance.now() - started) / 1000

// Node reports the peak resident set size in kilobytes.
const peak = process.resourceUsage().maxRSS * 1024
console.log(`Machine:        ${platform()} ${arch()}, ${cpus().length} cores, Node ${process.version}`)
console.log(`Layer images:   ${LAYERS * TRAITS} files, ${megabytes(sourceBytes)}`)
console.log(`Wall time:      ${seconds.toFixed(1)} s (${(seconds / TOKENS).toFixed(2)} s a token)`)
console.log(`Peak memory:    ${megabytes(peak)} resident`)
console.log(`CAR size:       ${megabytes(batch.size)} for ${batch.files.length} files`)
console.log(`Batch CID:      ${batch.cid}`)
