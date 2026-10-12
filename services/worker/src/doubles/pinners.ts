import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CarReader } from '@ipld/car'
import type { Pinner } from '../ports.ts'

/** The root CID a CAR declares, as a base32 string. Throws when the bytes are not a CAR with one root. */
export async function carRoot(car: Uint8Array): Promise<string> {
  const reader = await CarReader.fromBytes(car)
  const roots = await reader.getRoots()
  const [root] = roots
  if (!root || roots.length !== 1) throw new Error('The CAR does not have exactly one root.')
  return root.toString()
}

export type FolderPinner = Pinner & {
  /** Every CID pinned, in order, repeats included. */
  pinned: string[]
}

/**
 * The local stand-in for the pinning service: writes `<cid>.car` under `dir` and answers with the
 * CID read from the CAR's own root, never the one the caller expected, so a wrong expectation shows.
 */
export function folderPinner(dir: string): FolderPinner {
  const pinned: string[] = []
  return {
    pinned,
    async pin(car) {
      const cid = await carRoot(car)
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, `${cid}.car`), car)
      pinned.push(cid)
      return cid
    },
  }
}

/** A well-formed CID that no render produces. */
export const WRONG_CID = `bafybei${'a'.repeat(52)}`

/** A pinning service that answers with a different CID every time. */
export function wrongCidPinner(): Pinner {
  return { pin: async () => WRONG_CID }
}

export type FailingPinner = Pinner & {
  /** How many times it has failed so far. */
  failures: number
}

/**
 * Fails one upload a chosen number of times, then passes everything to `inner`. The upload is
 * chosen by the order in which distinct CIDs first arrive: `nth: 1` is the second distinct CAR,
 * which is batch 1 when the local runner works through the batches in order. `times: Infinity`
 * never lets it through.
 */
export function failingPinner(inner: Pinner, options: { nth: number; times: number }): FailingPinner {
  const seen: string[] = []
  const pinner: FailingPinner = {
    failures: 0,
    async pin(car, expectedCid) {
      if (!seen.includes(expectedCid)) seen.push(expectedCid)
      if (seen.indexOf(expectedCid) === options.nth && pinner.failures < options.times) {
        pinner.failures += 1
        throw new Error('The pinning service is not answering.')
      }
      return inner.pin(car, expectedCid)
    },
  }
  return pinner
}
