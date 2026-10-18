import { failureName } from './sweep'

/**
 * The layer sources' lifecycle (docs/specs/2026-10-17-production-hardening.md, section 7.1), pure: a daily sweep
 * deletes a collection's original files, the `layers`, `assets` and `placeholders` folders under its id in the art
 * bucket, once it was deployed at least 90 days ago and its last real render finished at least 90 days ago. The
 * thumbnails, the rendered output on IPFS, the metadata and every row stay. The database decides what is due
 * (`collections_sources_due`) and marks a collection once its folders list empty (`collection_sources_deleted`),
 * so a failed run leaves no mark and the next one resumes. It runs dry until SOURCE_SWEEP_DELETE is 1.
 */

/** The database's two functions write 90 days once each, naming this constant. */
export const SOURCE_RETENTION_DAYS = 90
export const SOURCES_PER_RUN = 20
export const SOURCE_FOLDERS = ['layers', 'assets', 'placeholders'] as const

export type DueCollection = { collectionId: string; objects: number; bytes: number }

/** An object as the art bucket lists it: its key and its size in bytes. */
export type ListedObject = { key: string; bytes: number }

export type SourceSweepDeps = {
  /** The due collections, oldest deploy first, at most `limit`. */
  due(limit: number): Promise<DueCollection[]>
  /** The art bucket's objects under a prefix with their sizes, a page at a time. */
  list(prefix: string): AsyncIterable<ListedObject[]>
  remove(keys: string[]): Promise<void>
  /** Marks the collection's originals deleted: true when this call set the mark. */
  mark(collectionId: string): Promise<boolean>
}

export type SourceSweepReport = {
  dryRun: boolean
  due: number
  deleted: number
  marked: number
  failed: string[]
}

/** A collection's three source folders. Never its thumbnails. */
export function sourcePrefixes(collectionId: string): string[] {
  return SOURCE_FOLDERS.map((folder) => `${collectionId}/${folder}/`)
}

/** True unless SOURCE_SWEEP_DELETE is 1: the sweep logs what it would delete and deletes nothing. */
export function sourceSweepDryRun(env: Record<string, string | undefined>): boolean {
  return env.SOURCE_SWEEP_DELETE !== '1'
}

const KB = 1024
/** A size as the log writes it: 512 B, 3.4 KB, 12.5 MB, 1.2 GB. */
export function sizeText(bytes: number): string {
  if (bytes < KB) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / KB
  let unit = 0
  while (value >= KB && unit < units.length - 1) {
    value /= KB
    unit++
  }
  return `${value.toFixed(1)} ${units[unit]}`
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** The total size of listed objects. */
const sizeOf = (page: readonly ListedObject[]) => page.reduce((sum, entry) => sum + entry.bytes, 0)

/**
 * The objects under a collection's three folders, a page at a time. A key a store lists outside the folder asked for
 * is left out, so nothing outside the collection's three folders is ever deleted, whatever the store answers.
 */
async function* sourcePages(deps: SourceSweepDeps, collectionId: string): AsyncGenerator<ListedObject[]> {
  for (const prefix of sourcePrefixes(collectionId))
    for await (const page of deps.list(prefix)) yield page.filter((entry) => entry.key.startsWith(prefix))
}

/**
 * One run: the due collections (20 by default), each listed folder by folder; an id that is not a UUID is refused
 * before any listing. A dry run logs each one's files and their listed size and deletes nothing. Otherwise the keys
 * are removed a page at a time, the folders listed again to confirm none is left, and the collection marked; the
 * line pairs the files deleted with their size. A failure for one collection is logged with the files deleted before
 * it, worded by `describe` (the cron passes its masked summary; by default the error's name alone), and listed; it
 * leaves no mark, and the run goes on to the next. The report counts every file deleted, a failed collection's too.
 */
export async function sweepSources(
  deps: SourceSweepDeps,
  options: {
    dryRun: boolean
    limit?: number
    log?: (line: string) => void
    describe?: (error: unknown) => string
  },
): Promise<SourceSweepReport> {
  const log = options.log ?? ((line: string) => console.log(line))
  const describe = options.describe ?? failureName
  const due = await deps.due(options.limit ?? SOURCES_PER_RUN)
  const report: SourceSweepReport = {
    dryRun: options.dryRun,
    due: due.length,
    deleted: 0,
    marked: 0,
    failed: [],
  }
  for (const entry of due) {
    let deleted = 0
    let bytes = 0
    try {
      if (!UUID.test(entry.collectionId)) throw new Error('The due collection id is not a UUID.')
      if (options.dryRun) {
        let found = 0
        let size = 0
        for await (const page of sourcePages(deps, entry.collectionId)) {
          found += page.length
          size += sizeOf(page)
        }
        log(
          `Source sweep (dry run): ${entry.collectionId} has ${found} original files (${sizeText(size)}) due; nothing was deleted.`,
        )
        continue
      }
      for await (const page of sourcePages(deps, entry.collectionId)) {
        if (!page.length) continue
        await deps.remove(page.map((object) => object.key))
        deleted += page.length
        bytes += sizeOf(page)
      }
      for await (const page of sourcePages(deps, entry.collectionId))
        if (page.length) throw new Error(`${page.length} original files are still stored.`)
      if (await deps.mark(entry.collectionId)) report.marked++
      log(`Source sweep: deleted ${deleted} original files (${sizeText(bytes)}) of ${entry.collectionId}.`)
    } catch (error) {
      report.failed.push(entry.collectionId)
      log(
        options.dryRun
          ? `Source sweep: ${entry.collectionId} failed and is tried again tomorrow: ${describe(error)}`
          : `Source sweep: ${entry.collectionId} failed after deleting ${deleted} original files (${sizeText(bytes)}) and is tried again tomorrow: ${describe(error)}`,
      )
    } finally {
      report.deleted += deleted
    }
  }
  return report
}
