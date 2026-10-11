import { CarWriter } from '@ipld/car'
import * as UnixFS from '@ipld/unixfs'
import type { FileLink } from '@ipld/unixfs/directory'
import { withWidth } from '@ipld/unixfs/file/layout/balanced'
import { withMaxChunkSize } from '@ipld/unixfs/file/chunker/fixed'
import { CID } from 'multiformats/cid'
import * as raw from 'multiformats/codecs/raw'
import { RenderProblem } from './problems'

export type PackedDirectory = { car: Uint8Array; cid: string; size: number }

/** Kubo's switch point: a directory whose plain block would exceed this many bytes is HAMT-sharded. */
export const SHARD_THRESHOLD = 262_144

/**
 * Fixed UnixFS settings (spec section 8): CIDv1 (the library default linker), sha2-256 (the default
 * hasher), raw leaves, 1,048,576 byte chunks, balanced layout 1024 links wide (as `ipfs-car`).
 * Sharded directories use the library's HAMT: fanout 256, murmur3-x64-64, as Kubo.
 */
const SETTINGS = UnixFS.configure({
  chunker: withMaxChunkSize(1_048_576),
  fileChunkEncoder: raw,
  smallFileEncoder: raw,
  fileLayout: withWidth(1024),
})

type Entry = { name: string; link: FileLink }

const encoder = new TextEncoder()

/** Byte order of two UTF-8 names. */
function compareNames(a: Uint8Array, b: Uint8Array): number {
  const length = Math.min(a.length, b.length)
  for (let i = 0; i < length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!
  return a.length - b.length
}

/** Whether a plain directory block of this many bytes must be sharded instead. */
export function needsShard(plainBlockBytes: number): boolean {
  return plainBlockBytes > SHARD_THRESHOLD
}

/** The encoded size of the plain directory block over these entries, written to a throwaway stream. */
async function plainDirectoryBytes(entries: Entry[]): Promise<number> {
  let size = 0
  const probe = UnixFS.createWriter({
    writable: new WritableStream<UnixFS.Block>({
      write(block) {
        size = block.bytes.byteLength
      },
    }),
    settings: SETTINGS,
  })
  const directory = UnixFS.createDirectoryWriter(probe)
  for (const { name, link } of entries) directory.set(name, link)
  await directory.close()
  await probe.close()
  return size
}

/** The blocks as one CARv1 with `root` as its single root; a block repeated by identical files is written once. */
async function encodeCar(root: CID, blocks: UnixFS.Block[]): Promise<Uint8Array> {
  const { writer, out } = CarWriter.create([root])
  const chunks: Uint8Array[] = []
  const drained = (async () => {
    for await (const chunk of out) chunks.push(chunk)
  })()
  const written = new Set<string>()
  for (const block of blocks) {
    const key = block.cid.toString()
    if (written.has(key)) continue
    written.add(key)
    // @ipld/unixfs and @ipld/car carry different multiformats majors; the CID bytes are the same.
    await writer.put({ cid: CID.decode(block.cid.bytes), bytes: block.bytes })
  }
  await writer.close()
  await drained
  const car = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0))
  let offset = 0
  for (const chunk of chunks) {
    car.set(chunk, offset)
    offset += chunk.byteLength
  }
  return car
}

/**
 * Packs files into one UnixFS directory inside a CAR and returns the CAR, the directory's CID as a
 * base32 string and the CAR length. Files are sorted by name bytes; a repeated name is refused.
 */
export async function packDirectory(files: { name: string; bytes: Uint8Array }[]): Promise<PackedDirectory> {
  const sorted = files
    .map((file) => ({ ...file, key: encoder.encode(file.name) }))
    .sort((a, b) => compareNames(a.key, b.key))
  for (let i = 1; i < sorted.length; i++)
    if (compareNames(sorted[i - 1]!.key, sorted[i]!.key) === 0)
      throw new RenderProblem('duplicate-name', `Two files are named ${sorted[i]!.name}.`, {
        detail: { name: sorted[i]!.name },
      })

  const blocks: UnixFS.Block[] = []
  const writer = UnixFS.createWriter({
    writable: new WritableStream<UnixFS.Block>({
      write(block) {
        blocks.push(block)
      },
    }),
    settings: SETTINGS,
  })
  const entries: Entry[] = []
  for (const file of sorted) {
    const fileWriter = UnixFS.createFileWriter(writer)
    await fileWriter.write(file.bytes)
    entries.push({ name: file.name, link: await fileWriter.close() })
  }
  const directory = needsShard(await plainDirectoryBytes(entries))
    ? UnixFS.createShardedDirectoryWriter(writer)
    : UnixFS.createDirectoryWriter(writer)
  for (const { name, link } of entries) directory.set(name, link)
  const root = await directory.close()
  await writer.close()

  const cid = CID.decode(root.cid.bytes)
  const car = await encodeCar(cid, blocks)
  return { car, cid: cid.toString(), size: car.byteLength }
}
