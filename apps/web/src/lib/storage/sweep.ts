/**
 * The sweep of unrecorded uploads (docs/specs/2026-10-09-lock-and-pay.md, section 9): an object in
 * the art bucket older than the minimum age with no `uploads.storage_key` row was uploaded but never
 * recorded (the browser closed between the PUT and the confirm). The project cap counts rows only,
 * so these would take storage for good. Pure: the script wires S3 and the service role in.
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
  options: { prefix: string; minAgeMs: number; now: number; dryRun: boolean },
): Promise<SweepReport> {
  const report: SweepReport = { listed: 0, old: 0, recorded: 0, orphaned: [], deleted: 0 }
  for await (const page of deps.list(options.prefix)) {
    report.listed += page.length
    const old = page.filter((entry) => options.now - entry.lastModified.getTime() >= options.minAgeMs)
    report.old += old.length
    if (old.length === 0) continue
    const known = await deps.recorded(old.map((entry) => entry.key))
    const orphans = old.map((entry) => entry.key).filter((key) => !known.has(key))
    report.recorded += old.length - orphans.length
    report.orphaned.push(...orphans)
    if (!options.dryRun && orphans.length > 0) {
      await deps.remove(orphans)
      report.deleted += orphans.length
    }
  }
  return report
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
      const hours = Number(argv[++at])
      if (!Number.isFinite(hours) || hours < 0)
        throw new Error('The minimum age is a number of hours, 0 or more.')
      args.minAgeHours = hours
    } else if (arg === '--prefix') args.prefix = argv[++at] ?? ''
    else throw new Error(`Unknown option: ${arg}`)
  }
  return args
}
