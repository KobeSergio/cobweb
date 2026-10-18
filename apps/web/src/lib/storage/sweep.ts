/**
 * The sweep of unrecorded uploads (docs/specs/2026-10-09-lock-and-pay.md, section 9): an object in
 * the art bucket older than the minimum age with no `uploads.storage_key` row was uploaded but never
 * recorded (the browser closed between the PUT and the confirm). The project cap counts rows only,
 * so these would take storage for good. The same core sweeps the mint page's files no page names. Pure:
 * the script and the daily cron wire S3 and the service role in.
 */
export type StoredObject = { key: string; lastModified: Date }

export type SweepDeps = {
  /** The bucket's objects under a prefix, a page at a time. */
  list(prefix: string): AsyncIterable<StoredObject[]>
  /** Which of these keys have an `uploads` row. */
  recorded(keys: string[]): Promise<Set<string>>
  remove(keys: string[]): Promise<void>
}

export type SweepReport = {
  listed: number
  old: number
  recorded: number
  orphaned: string[]
  deleted: number
}

export async function sweepOrphans(
  deps: SweepDeps,
  options: {
    prefix: string
    minAgeMs: number
    now: number
    dryRun: boolean
    /** Called after each page, with that page's counts, its orphan keys and the totals so far. */
    onPage?: (page: { listed: number; old: number; orphaned: string[] }, totals: SweepReport) => void
  },
): Promise<SweepReport> {
  const report: SweepReport = { listed: 0, old: 0, recorded: 0, orphaned: [], deleted: 0 }
  for await (const page of deps.list(options.prefix)) {
    report.listed += page.length
    const old = page.filter((entry) => options.now - entry.lastModified.getTime() >= options.minAgeMs)
    report.old += old.length
    let orphans: string[] = []
    if (old.length > 0) {
      const known = await deps.recorded(old.map((entry) => entry.key))
      orphans = old.map((entry) => entry.key).filter((key) => !known.has(key))
      report.recorded += old.length - orphans.length
      report.orphaned.push(...orphans)
      if (!options.dryRun && orphans.length > 0) {
        await deps.remove(orphans)
        report.deleted += orphans.length
      }
    }
    options.onPage?.({ listed: page.length, old: old.length, orphaned: orphans }, report)
  }
  return report
}

/** A day: an object this young may be between its PUT and its record, or its page's save. */
export const UPLOAD_SWEEP_MIN_AGE_MS = 86_400_000

/** True unless UPLOAD_SWEEP_DELETE is 1: the daily upload sweep logs what it would delete and deletes nothing. */
export function uploadSweepDryRun(env: Record<string, string | undefined>): boolean {
  return env.UPLOAD_SWEEP_DELETE !== '1'
}

export type SweepCounts = { listed: number; old: number; orphaned: number; deleted: number }
export type UploadSweepReport = { dryRun: boolean; art: SweepCounts; media: SweepCounts }

/**
 * The daily upload sweep (docs/specs/2026-10-17-production-hardening.md, section 14, point 8): the art bucket's
 * objects no `uploads` row records, and the mint-page bucket's files no page names, each over a day old. One line
 * per bucket; the report counts, and names no key.
 */
export async function sweepUploads(
  deps: { art: SweepDeps; media: SweepDeps },
  options: { dryRun: boolean; now: number; log?: (line: string) => void },
): Promise<UploadSweepReport> {
  const log = options.log ?? ((line: string) => console.log(line))
  const swept = async (port: SweepDeps, what: string): Promise<SweepCounts> => {
    const report = await sweepOrphans(port, {
      prefix: '',
      minAgeMs: UPLOAD_SWEEP_MIN_AGE_MS,
      now: options.now,
      dryRun: options.dryRun,
    })
    log(
      options.dryRun
        ? `Upload sweep (dry run): ${report.orphaned.length} ${what} over a day old would be deleted, of ${report.listed} listed; nothing was deleted.`
        : `Upload sweep: deleted ${report.deleted} ${what} over a day old, of ${report.listed} listed.`,
    )
    return {
      listed: report.listed,
      old: report.old,
      orphaned: report.orphaned.length,
      deleted: report.deleted,
    }
  }
  return {
    dryRun: options.dryRun,
    art: await swept(deps.art, 'unrecorded art files'),
    media: await swept(deps.media, 'mint page files no page names'),
  }
}

export type SweepArgs = { dryRun: boolean; allowRemote: boolean; minAgeHours: number; prefix: string }

/** The sweep script's options. A literal `--` (which pnpm may pass on) is ignored. */
export function parseSweepArgs(argv: string[]): SweepArgs {
  const args: SweepArgs = { dryRun: false, allowRemote: false, minAgeHours: 24, prefix: '' }
  for (let at = 0; at < argv.length; at++) {
    const arg = argv[at]
    if (arg === '--') continue
    else if (arg === '--dry-run') args.dryRun = true
    else if (arg === '--allow-remote') args.allowRemote = true
    else if (arg === '--min-age-hours') {
      const value = argv[++at]
      if (value === undefined || !/^\d+(\.\d+)?$/.test(value))
        throw new Error('The minimum age is a number of hours, 0 or more.')
      args.minAgeHours = Number(value)
    } else if (arg === '--prefix') {
      const value = argv[++at]
      if (value === undefined || value.startsWith('--'))
        throw new Error('The prefix option needs a key prefix, such as c1/.')
      args.prefix = value
    } else throw new Error(`Unknown option: ${arg}`)
  }
  return args
}
