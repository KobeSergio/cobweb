import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { packDirectory } from '@cobweb/render'
import type { RenderMessage } from '@cobweb/shared/render-queue'
import { describe, expect, it } from 'vitest'
import { flatPng, rgbaAt, sizeOf } from './draw.ts'
import { memoryQueue } from './memory-queue.ts'
import { isMissingObject } from '../ports.ts'
import { memoryStore } from './memory-store.ts'
import { carRoot, failingPinner, folderPinner, WRONG_CID, wrongCidPinner } from './pinners.ts'

const JOB = '3f0c2f5e-8a51-4c0e-9d7b-0d0f5a3b9c11'
const start: RenderMessage = { jobId: JOB, step: 'start', retries: 0 }
const batch = (index: number): RenderMessage => ({ jobId: JOB, step: 'batch', index, retries: 0 })
const text = (value: string) => new TextEncoder().encode(value)

describe('memoryQueue', () => {
  it('delivers in order and counts each receive', async () => {
    const queue = memoryQueue()
    await queue.send([start, batch(0)])
    expect(queue.size()).toBe(2)
    expect(queue.take()).toEqual({ message: start, receives: 1 })
    expect(queue.take()).toEqual({ message: batch(0), receives: 1 })
    expect(queue.take()).toBeNull()
    expect(queue.sent).toEqual([start, batch(0)])
  })

  it('redelivers a released message after the ones already waiting', async () => {
    const queue = memoryQueue()
    await queue.send([batch(0), batch(1)])
    const first = queue.take()!
    queue.release(first, 3)
    expect(queue.take()?.message).toEqual(batch(1))
    expect(queue.take()).toEqual({ message: batch(0), receives: 2 })
  })

  it('moves a message to the dead-letter list after three receives', async () => {
    const queue = memoryQueue()
    await queue.send([batch(4)])
    for (let receive = 1; receive <= 3; receive++) {
      const entry = queue.take()!
      expect(entry.receives).toBe(receive)
      queue.release(entry, 3)
    }
    expect(queue.take()).toBeNull()
    expect(queue.dead).toEqual([batch(4)])
    expect(queue.takeDead()).toEqual(batch(4))
    expect(queue.takeDead()).toBeNull()
  })

  it('delivers every message twice when asked for two copies', async () => {
    const queue = memoryQueue({ copies: 2 })
    await queue.send([start])
    expect(queue.size()).toBe(2)
    const first = queue.take()
    const second = queue.take()
    expect(first?.message).toEqual(start)
    expect(second?.message).toEqual(start)
    expect(first?.receives).toBe(1)
    expect(second?.receives).toBe(1)
    expect(first).not.toBe(second)
    expect(queue.sent).toEqual([start])
  })

  it('treats a copies value that is not a positive integer as 1', async () => {
    for (const copies of [Number.NaN, 0, -2, 0.5, 1.5]) {
      const queue = memoryQueue({ copies })
      await queue.send([start])
      expect(queue.size()).toBe(1)
    }
  })

  it('loses the messages the drop option picks', async () => {
    const queue = memoryQueue({ drop: (message) => message.step === 'batch' })
    await queue.send([start, batch(0)])
    expect(queue.size()).toBe(1)
    expect(queue.dropped).toEqual([batch(0)])
    expect(queue.sent).toEqual([start, batch(0)])
  })
})

describe('memoryStore', () => {
  it('loads by key, records the loads and throws for a missing key', async () => {
    const store = memoryStore({ 'a.png': text('a') })
    expect(await store.load({ key: 'a.png', ext: 'png' })).toEqual(text('a'))
    await expect(store.load({ key: 'b.png', ext: 'png' })).rejects.toThrow('No object at b.png')
    expect(store.loads).toEqual(['a.png', 'b.png'])
  })

  it('throws a MissingObject for an unknown key and a transient error the chosen number of times', async () => {
    const store = memoryStore({ 'a.png': text('a') })
    const missing = await store.load({ key: 'b.png', ext: 'png' }).catch((error: unknown) => error)
    expect(isMissingObject(missing)).toBe(true)
    store.failTransiently('a.png', 2)
    for (let time = 0; time < 2; time++) {
      const error = await store.load({ key: 'a.png', ext: 'png' }).catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(Error)
      expect(isMissingObject(error)).toBe(false)
    }
    expect(await store.load({ key: 'a.png', ext: 'png' })).toEqual(text('a'))
  })

  it('removes a key, so it is missing afterwards', async () => {
    const store = memoryStore({ 'a.png': text('a') })
    store.remove('a.png')
    expect(isMissingObject(await store.load({ key: 'a.png', ext: 'png' }).catch((e: unknown) => e))).toBe(
      true,
    )
  })

  it('keeps collages by key', async () => {
    const store = memoryStore({})
    await store.putCollage('c/collage/j.png', text('png'))
    expect(store.collages.get('c/collage/j.png')).toEqual(text('png'))
  })
})

describe('folderPinner', () => {
  it('writes <cid>.car and answers with the CID read from the CAR root', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'cobweb-pins-')), 'nested')
    const packed = await packDirectory([{ name: '1.png', bytes: text('one') }])
    const pinner = folderPinner(dir)
    expect(await pinner.pin(packed.car, 'not-what-the-car-says')).toBe(packed.cid)
    expect(readdirSync(dir)).toEqual([`${packed.cid}.car`])
    expect(new Uint8Array(readFileSync(join(dir, `${packed.cid}.car`)))).toEqual(packed.car)
    expect(pinner.pinned).toEqual([packed.cid])
    expect(await carRoot(packed.car)).toBe(packed.cid)
  })

  it('refuses bytes that are not a CAR', async () => {
    const pinner = folderPinner(mkdtempSync(join(tmpdir(), 'cobweb-pins-')))
    await expect(pinner.pin(text('not a car'), 'x')).rejects.toThrow()
  })
})

describe('wrongCidPinner and failingPinner', () => {
  it('answers with a well-formed CID that is not the expected one', async () => {
    expect(WRONG_CID).toMatch(/^[a-z2-7]{59}$/)
    expect(await wrongCidPinner().pin(text('car'), 'bafyexpected')).toBe(WRONG_CID)
  })

  it('fails the chosen upload the chosen number of times, then lets it through', async () => {
    const inner = { pin: async (_car: Uint8Array, cid: string) => cid }
    const pinner = failingPinner(inner, { nth: 1, times: 2 })
    expect(await pinner.pin(text('a'), 'cid-a')).toBe('cid-a')
    await expect(pinner.pin(text('b'), 'cid-b')).rejects.toThrow('The pinning service is not answering.')
    expect(await pinner.pin(text('c'), 'cid-c')).toBe('cid-c')
    await expect(pinner.pin(text('b'), 'cid-b')).rejects.toThrow()
    expect(await pinner.pin(text('b'), 'cid-b')).toBe('cid-b')
    expect(pinner.failures).toBe(2)
  })

  it('never lets the chosen upload through with times Infinity', async () => {
    const pinner = failingPinner({ pin: async (_car, cid) => cid }, { nth: 0, times: Infinity })
    for (let attempt = 0; attempt < 5; attempt++)
      await expect(pinner.pin(text('a'), 'cid-a')).rejects.toThrow()
    expect(await pinner.pin(text('b'), 'cid-b')).toBe('cid-b')
  })
})

describe('flatPng', () => {
  it('draws a square PNG of the size asked for', async () => {
    const png = await flatPng({ r: 10, g: 20, b: 30, alpha: 1 }, 32)
    expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
    expect(await sizeOf(png)).toEqual({ width: 32, height: 32 })
  })
})

describe('rgbaAt', () => {
  it('reads a pixel of a PNG as four channels, and the image size', async () => {
    const png = await flatPng({ r: 10, g: 20, b: 30, alpha: 1 }, 8)
    expect(await rgbaAt(png, 3, 5)).toEqual({ width: 8, height: 8, pixel: [10, 20, 30, 255] })
  })

  it('refuses a pixel outside the image', async () => {
    await expect(rgbaAt(await flatPng({ r: 0, g: 0, b: 0, alpha: 1 }, 8), 8, 0)).rejects.toThrow(
      'The pixel is outside the image.',
    )
  })
})
