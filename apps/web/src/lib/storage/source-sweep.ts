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

export type SourceSweepDeps = {
  /** The due collections, oldest deploy first, at most `limit`. */
  due(limit: number): Promise<DueCollection[]>
  /** The art bucket's objects under a prefix, a page at a time. */
  list(prefix: string): AsyncIterable<{ key: string }[]>
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

/** A failure as the log writes it: its name and its first line, any URL replaced, cut at 200 characters. */
function failureText(error: unknown): string {
  if (!(error instanceof Error)) return 'Unknown error'
  const line = (error.message.split('\n')[0] ?? '').replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[url]')
  return `${error.name}: ${line}`.slice(0, 200)
}

/** The keys under a collection's three folders, a page at a time. */
async function* sourcePages(deps: SourceSweepDeps, collectionId: string): AsyncGenerator<string[]> {
  for (const prefix of sourcePrefixes(collectionId))
    for await (const page of deps.list(prefix)) yield page.map((entry) => entry.key)
}

/**
 * One run: the due collections (20 by default), each listed folder by folder. A dry run logs each one's files and
 * recorded size and deletes nothing. Otherwise the keys are removed a page at a time, the folders listed again to
 * confirm none is left, and the collection marked. A failure for one collection is logged and listed, leaves no
 * mark, and the run goes on to the next.
 */
export async function sweepSources(
  deps: SourceSweepDeps,
  options: { dryRun: boolean; limit?: number; log?: (line: string) => void },
): Promise<SourceSweepReport> {
  const log = options.log ?? ((line: string) => console.log(line))
  const due = await deps.due(options.limit ?? SOURCES_PER_RUN)
  const report: SourceSweepReport = {
    dryRun: options.dryRun,
    due: due.length,
    deleted: 0,
    marked: 0,
    failed: [],
  }
  for (const entry of due) {
    try {
      if (options.dryRun) {
        let found = 0
        for await (const keys of sourcePages(deps, entry.collectionId)) found += keys.length
        log(
          `Source sweep (dry run): ${entry.collectionId} has ${found} original files (${sizeText(entry.bytes)}) due; nothing was deleted.`,
        )
        continue
      }
      let deleted = 0
      for await (const keys of sourcePages(deps, entry.collectionId)) {
        if (!keys.length) continue
        await deps.remove(keys)
        deleted += keys.length
      }
      for await (const keys of sourcePages(deps, entry.collectionId))
        if (keys.length) throw new Error(`${keys.length} original files are still stored.`)
      if (await deps.mark(entry.collectionId)) report.marked++
      report.deleted += deleted
      log(
        `Source sweep: deleted ${deleted} original files (${sizeText(entry.bytes)}) of ${entry.collectionId}.`,
      )
    } catch (error) {
      report.failed.push(entry.collectionId)
      log(`Source sweep: ${entry.collectionId} failed and is tried again tomorrow: ${failureText(error)}`)
    }
  }
  return report
}
