import type { Store } from '../ports.ts'

export type MemoryStore = Store & {
  /** Every key loaded, in order, repeats included. */
  loads: string[]
  /** Collages written, by key. */
  collages: Map<string, Uint8Array>
}

/** A store over a key to bytes map. A missing key throws, as a missing object does in storage. */
export function memoryStore(images: Record<string, Uint8Array>): MemoryStore {
  const loads: string[] = []
  const collages = new Map<string, Uint8Array>()
  return {
    loads,
    collages,
    async load(ref) {
      loads.push(ref.key)
      const bytes = images[ref.key]
      if (!bytes) throw new Error(`No object at ${ref.key}`)
      return bytes
    },
    async putCollage(key, png) {
      collages.set(key, png)
    },
  }
}
