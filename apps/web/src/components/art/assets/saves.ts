import { seededRandom } from './token-list'
import type { AssetItem } from './types'

/**
 * How the Assets screen's list becomes saved rows (spec section 9): positions in list order, and
 * the edits a new `uploads` row is still missing. Pure, so the tests run without a screen.
 */
export function orderRows(items: AssetItem[]): { uploadId: string; position: number }[] {
  return items.flatMap((item, position) => (item.uploadId ? [{ uploadId: item.uploadId, position }] : []))
}

/** Whether an item carries edits its new row lacks: a new row has 1 edition and no attributes. */
export function needsDetails(item: Pick<AssetItem, 'quantity' | 'attributes'>): boolean {
  return item.quantity !== 1 || item.attributes.length > 0
}

/** The list in a shuffled order, the same for the same seed (Fisher-Yates, as legacy's shuffle). */
export function shuffledOrder<T>(items: T[], seed: number): T[] {
  const next = [...items]
  const random = seededRandom(seed)
  for (let at = next.length - 1; at > 0; at--) {
    const swap = Math.floor(random() * (at + 1))
    ;[next[at], next[swap]] = [next[swap]!, next[at]!]
  }
  return next
}

/** The list in the order the files were added ("In file order"). */
export function addedOrder<T extends { addedAt: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.addedAt - b.addedAt)
}

export function inAddedOrder(items: { addedAt: number }[]): boolean {
  return items.every((item, i) => i === 0 || items[i - 1]!.addedAt <= item.addedAt)
}
