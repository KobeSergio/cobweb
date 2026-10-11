/**
 * Test helpers: images drawn with sharp (no binary fixtures are committed), an in-memory loader, a
 * PNG chunk reader and a CAR reader. Not exported from the package.
 */
import { CarReader } from '@ipld/car'
import * as UnixFS from '@ipld/unixfs'
import { CID } from 'multiformats/cid'
import { sharp, TRANSPARENT } from './png'
import type { GenerativeSpec, ImageRef, LoadImage, MetadataText } from './types'

export type Rgba = { r: number; g: number; b: number; alpha: number }

/** A flat colour PNG, `width` by `height` (square by default). */
export async function flatPng(colour: Rgba, width = 64, height = width): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({ create: { width, height, channels: 4, background: colour } })
      .png()
      .toBuffer(),
  )
}

/** A transparent PNG with a centred square of `colour`, half the size, at half alpha. */
export async function halfAlphaSquarePng(colour: Omit<Rgba, 'alpha'>, size = 64): Promise<Uint8Array> {
  const square = await flatPng({ ...colour, alpha: 0.5 }, size / 2)
  return new Uint8Array(
    await sharp({ create: { width: size, height: size, channels: 4, background: TRANSPARENT } })
      .composite([{ input: Buffer.from(square), left: size / 4, top: size / 4 }])
      .png()
      .toBuffer(),
  )
}

/** The RGBA of one pixel. */
export async function pixel(png: Uint8Array, x: number, y: number): Promise<number[]> {
  const { data, info } = await sharp(png)
    .toColourspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const at = (y * info.width + x) * 4
  return [...data.subarray(at, at + 4)]
}

export async function sizeOf(png: Uint8Array): Promise<{ width: number; height: number; format: string }> {
  const { width, height, format } = await sharp(png).metadata()
  return { width, height, format }
}

/** Chunk types of a PNG, in file order. */
export function pngChunks(png: Uint8Array): string[] {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  const types: string[] = []
  for (let at = 8; at < png.byteLength;) {
    const length = view.getUint32(at)
    types.push(String.fromCharCode(...png.subarray(at + 4, at + 8)))
    at += 12 + length
  }
  return types
}

/** A loader over a key to bytes map. Throws for an unknown key and counts every call by key. */
export function memoryLoader(images: Record<string, Uint8Array>): LoadImage & { calls: Map<string, number> } {
  const calls = new Map<string, number>()
  const load = async (ref: ImageRef) => {
    calls.set(ref.key, (calls.get(ref.key) ?? 0) + 1)
    const bytes = images[ref.key]
    if (!bytes) throw new Error(`No object at ${ref.key}`)
    return bytes
  }
  return Object.assign(load, { calls })
}

const RAW_CODE = 0x55

/**
 * Every file in a CAR's root directory, plain or HAMT-sharded, by name. Reads single-block (raw
 * leaf) files only, which is every file the tests write.
 */
export async function readCarFiles(car: Uint8Array): Promise<{
  root: string
  files: Map<string, Uint8Array>
  shard: { fanout: number; hashType: number } | null
}> {
  const reader = await CarReader.fromBytes(car)
  const [root] = await reader.getRoots()
  if (!root) throw new Error('The CAR has no root.')
  const files = new Map<string, Uint8Array>()
  const blockOf = async (cid: CID) => {
    const block = await reader.get(cid)
    if (!block) throw new Error(`The CAR is missing block ${cid.toString()}.`)
    return block.bytes
  }
  const fileOf = async (cid: CID) => {
    if (cid.code !== RAW_CODE) throw new Error(`File ${cid.toString()} is not a single raw block.`)
    return blockOf(cid)
  }
  const rootNode = UnixFS.decode(await blockOf(root))
  const shard =
    rootNode.type === UnixFS.NodeType.HAMTShard
      ? { fanout: rootNode.fanout, hashType: rootNode.hashType }
      : null
  const walk = async (node: ReturnType<typeof UnixFS.decode>): Promise<void> => {
    if (node.type === UnixFS.NodeType.Directory) {
      for (const entry of node.entries) files.set(entry.name, await fileOf(CID.decode(entry.cid.bytes)))
      return
    }
    if (node.type !== UnixFS.NodeType.HAMTShard) throw new Error(`Unexpected node type ${node.type}.`)
    // In a HAMT shard a link named by its two hex digit prefix alone is a sub-shard; any longer
    // name is the prefix followed by the entry name.
    for (const entry of node.entries) {
      const cid = CID.decode(entry.cid.bytes)
      if (entry.name.length === 2) await walk(UnixFS.decode(await blockOf(cid)))
      else files.set(entry.name.slice(2), await fileOf(cid))
    }
  }
  await walk(rootNode)
  return { root: root.toString(), files, shard }
}

export const TEXT: MetadataText = {
  tokenName: 'Owl',
  tokenDescription: 'A night owl.',
  showBlankTraits: false,
  extraFields: {},
}

const ref = (key: string): ImageRef => ({ key, ext: 'png' })

/**
 * One collection, `owls`, three layers bottom first: Background shown as "Scene" (ink, dusk), Eyes
 * (wide, and sleepy which is left out of metadata) and Hat (a blank "None", and cap at `hatOpacity`).
 */
export function owlSpec(options: { hatOpacity?: number; showBlankTraits?: boolean } = {}): GenerativeSpec {
  return {
    kind: 'generative',
    canvas: 64,
    batchSize: 100,
    text: { ...TEXT, showBlankTraits: options.showBlankTraits ?? false },
    collections: [
      {
        id: 'owls',
        layers: [
          {
            id: 'background',
            name: 'Background',
            displayName: 'Scene',
            opacity: 1,
            traits: [
              { id: 'bg-ink', name: 'Ink', blank: false, inMetadata: true, image: ref('bg-ink.png') },
              { id: 'bg-dusk', name: 'Dusk', blank: false, inMetadata: true, image: ref('bg-dusk.png') },
            ],
          },
          {
            id: 'eyes',
            name: 'Eyes',
            displayName: null,
            opacity: 1,
            traits: [
              { id: 'eyes-wide', name: 'Wide', blank: false, inMetadata: true, image: ref('eyes-wide.png') },
              {
                id: 'eyes-sleepy',
                name: 'Sleepy',
                blank: false,
                inMetadata: false,
                image: ref('eyes-sleepy.png'),
              },
            ],
          },
          {
            id: 'hat',
            name: 'Hat',
            displayName: null,
            opacity: options.hatOpacity ?? 1,
            traits: [
              { id: 'hat-none', name: 'None', blank: true, inMetadata: true, image: null },
              { id: 'hat-cap', name: 'Cap', blank: false, inMetadata: true, image: ref('hat-cap.png') },
            ],
          },
        ],
      },
    ],
  }
}

/** Images for every key `owlSpec` names, 64 by 64. */
export async function owlImages(): Promise<Record<string, Uint8Array>> {
  return {
    'bg-ink.png': await flatPng({ r: 20, g: 20, b: 60, alpha: 1 }),
    'bg-dusk.png': await flatPng({ r: 200, g: 120, b: 60, alpha: 1 }),
    'eyes-wide.png': await halfAlphaSquarePng({ r: 255, g: 255, b: 0 }),
    'eyes-sleepy.png': await halfAlphaSquarePng({ r: 0, g: 255, b: 255 }),
    'hat-cap.png': await halfAlphaSquarePng({ r: 255, g: 0, b: 0 }),
  }
}
