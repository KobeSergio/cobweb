import { CarReader } from '@ipld/car'
import type { CID } from 'multiformats/cid'
import { exporter } from 'ipfs-unixfs-exporter'
import { describe, expect, it } from 'vitest'
import { needsShard, packDirectory, SHARD_THRESHOLD } from './car'
import { readCarFiles } from './fixtures'
import { RenderProblem } from './problems'

const text = (value: string) => new TextEncoder().encode(value)

/** 3 MiB and 5 bytes, byte i = (i * 31 + 7) mod 256: four 1 MiB chunks. */
function bigFile(): Uint8Array {
  const bytes = new Uint8Array(3 * 1_048_576 + 5)
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + 7) & 255
  return bytes
}

const entries = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ name: String(i + 1), bytes: text(`{"n":${i}}`) }))

describe('packDirectory', () => {
  it('gives the well-known empty directory CID', async () => {
    const packed = await packDirectory([])
    expect(packed.cid).toBe('bafybeiczsscdsbs7ffqz55asqdf3smv6klcw3gofszvwlyarci47bgf354')
    expect(packed.size).toBe(packed.car.byteLength)
  })

  it('matches ipfs-car for one small file', async () => {
    // printf 'hello world\n' > hello.txt && npx -y ipfs-car@3.1.0 pack hello.txt --output hello.car
    const packed = await packDirectory([{ name: 'hello.txt', bytes: text('hello world\n') }])
    expect(packed.cid).toBe('bafybeidhkumeonuwkebh2i4fc7o7lguehauradvlk57gzake6ggjsy372a')
  })

  it('matches ipfs-car for a file of several 1 MiB chunks', async () => {
    // node -e "const b=Buffer.alloc(3*1048576+5);for(let i=0;i<b.length;i++)b[i]=(i*31+7)&255;require('fs').writeFileSync('big.bin',b)"
    // npx -y ipfs-car@3.1.0 pack big.bin --output big.car
    const packed = await packDirectory([{ name: 'big.bin', bytes: bigFile() }])
    expect(packed.cid).toBe('bafybeibsypx75covabyts42kbx5yq2xiasowldpx4qekkzg2zphsoithva')
  })

  it('gives identical CAR bytes whatever order the files come in', async () => {
    const files = [
      { name: 'b.png', bytes: text('b') },
      { name: 'a.png', bytes: text('a') },
      { name: '10.png', bytes: text('10') },
      { name: '9.png', bytes: text('9') },
      { name: '\u{1F600}', bytes: text('smile') },
      { name: '\u{FFFD}', bytes: text('replacement') },
    ]
    const one = await packDirectory(files)
    const two = await packDirectory([...files].reverse())
    expect(two.cid).toBe(one.cid)
    expect(two.car).toEqual(one.car)
    // UTF-8 byte order puts U+FFFD (EF BF BD) before U+1F600 (F0 9F 98 80); UTF-16 order would not.
    const { files: read } = await readCarFiles(one.car)
    expect([...read.keys()].slice(-2)).toEqual(['\u{FFFD}', '\u{1F600}'])
  })

  it('writes a block shared by identical files once and reads both back', async () => {
    const packed = await packDirectory([
      { name: '1.png', bytes: text('same') },
      { name: '2.png', bytes: text('same') },
    ])
    const { files } = await readCarFiles(packed.car)
    expect([...files.keys()]).toEqual(['1.png', '2.png'])
    expect(files.get('2.png')).toEqual(text('same'))
    // Two files, one shared raw leaf, one directory: two blocks, not three.
    const cids: string[] = []
    for await (const cid of (await CarReader.fromBytes(packed.car)).cids()) cids.push(cid.toString())
    expect(cids).toHaveLength(2)
    expect(new Set(cids).size).toBe(2)
    expect(cids).toContain(packed.cid)
  })

  it('refuses two files with the same name', async () => {
    const error = await packDirectory([
      { name: '1.png', bytes: text('a') },
      { name: '1.png', bytes: text('b') },
    ]).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(RenderProblem)
    expect(error).toMatchObject({ code: 'duplicate-name', detail: { name: '1.png' } })
  })

  it('shards only above 262,144 bytes', () => {
    expect(SHARD_THRESHOLD).toBe(262_144)
    expect(needsShard(262_144)).toBe(false)
    expect(needsShard(262_145)).toBe(true)
  })

  it('keeps 4,000 entries in a plain directory', async () => {
    const { shard, files } = await readCarFiles((await packDirectory(entries(4000))).car)
    expect(shard).toBeNull()
    expect(files.size).toBe(4000)
  })

  it('shards a directory past the threshold and still lists every entry', async () => {
    const packed = await packDirectory(entries(6000))
    const { shard, files, root } = await readCarFiles(packed.car)
    // Kubo's HAMT: fanout 256, murmur3-x64-64 (multicodec 0x22).
    expect(shard).toEqual({ fanout: 256, hashType: 0x22 })
    expect(root).toBe(packed.cid)
    expect(files.size).toBe(6000)
    expect(new TextDecoder().decode(files.get('4321'))).toBe('{"n":4320}')
  })

  it('resolves names in a sharded directory by hash path, the way a gateway does', async () => {
    const packed = await packDirectory(entries(6000))
    const reader = await CarReader.fromBytes(packed.car)
    const blockstore = {
      get: async (cid: CID) => {
        const block = await reader.get(cid)
        if (!block) throw new Error(`Missing block ${cid.toString()}`)
        return block.bytes
      },
    } as unknown as Parameters<typeof exporter>[1]
    // First, middle and last by name (names sort as UTF-8 bytes, so "1" comes first and "999" last).
    const names = Object.keys(Object.fromEntries(entries(6000).map((e) => [e.name, 1]))).sort()
    for (const name of [names[0]!, names[3000]!, names.at(-1)!, '4321', '6000']) {
      const entry = await exporter(`${packed.cid}/${name}`, blockstore)
      const chunks: Uint8Array[] = []
      for await (const chunk of entry.content()) chunks.push(chunk)
      expect(new TextDecoder().decode(chunks[0]), name).toBe(`{"n":${Number(name) - 1}}`)
    }
    await expect(exporter(`${packed.cid}/6001`, blockstore)).rejects.toThrow()
    await expect(exporter(`${packed.cid}/0`, blockstore)).rejects.toThrow()
  })
})
