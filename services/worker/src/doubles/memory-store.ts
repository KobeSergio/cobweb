import { MissingObject } from '../ports.ts'
import type { Store } from '../ports.ts'

export type MemoryStore = Store & {
  /** Every key loaded, in order, repeats included. */
  loads: string[]
  /** Collages written, by key. */
  collages: Map<string, Uint8Array>
  /** Makes the next `times` loads of a key throw a transient error (not a `MissingObject`). */
  failTransiently(key: string, times: number): void
  /** Deletes a key, so it is missing from then on. */
  remove(key: string): void
}

/** A store over a key to bytes map. A missing key throws `MissingObject`, as a missing object does in storage. */
export function memoryStore(images: Record<string, Uint8Array>): MemoryStore {
  const loads: string[] = []
  const collages = new Map<string, Uint8Array>()
  const held = new Map(Object.entries(images))
  const transient = new Map<string, number>()
  return {
    loads,
    collages,
    failTransiently(key, times) {
      transient.set(key, times)
    },
    remove(key) {
      held.delete(key)
    },
    async load(ref) {
      loads.push(ref.key)
      const left = transient.get(ref.key) ?? 0
      if (left > 0) {
        transient.set(ref.key, left - 1)
        throw new Error('The storage is not answering.')
      }
      const bytes = held.get(ref.key)
      if (!bytes) throw new MissingObject(ref.key)
      return bytes
    },
    async putCollage(key, png) {
      collages.set(key, png)
    },
  }
}
