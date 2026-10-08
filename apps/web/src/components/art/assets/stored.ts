import type { QueueItem } from '../uploads/upload-queue'
import type { AssetItem } from './types'

/**
 * Moves finished uploads into the asset list: the item takes the served URL, the upload id and
 * the stored size, and gives up its object URL (returned for the caller to revoke). Null when no
 * item changed, so the screen keeps its state.
 */
export function adoptRecords(
  items: AssetItem[],
  queue: readonly QueueItem[],
): { items: AssetItem[]; revoke: string[] } | null {
  const finished = new Map(
    queue.filter((entry) => entry.state === 'done' && entry.record).map((entry) => [entry.id, entry.record!]),
  )
  const revoke: string[] = []
  let changed = false
  const next = items.map((item) => {
    const record = item.uploadId ? undefined : finished.get(item.key)
    if (!record) return item
    changed = true
    if (item.owned) revoke.push(item.url)
    return { ...item, url: record.url, uploadId: record.id, bytes: record.bytes, owned: false }
  })
  return changed ? { items: next, revoke } : null
}
