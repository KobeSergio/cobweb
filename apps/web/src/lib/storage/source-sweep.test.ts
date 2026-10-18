import { describe, expect, it } from 'vitest'
import {
  sizeText,
  SOURCE_FOLDERS,
  sourcePrefixes,
  sourceSweepDryRun,
  sweepSources,
  type DueCollection,
  type SourceSweepDeps,
  type SourceSweepReport,
} from './source-sweep'

const A = '0a977c0b-7e53-476b-8c08-6c685315c3af'
const B = '5b2c1d3e-4f50-4617-8829-3a4b5c6d7e8f'
/** Each stored object's size unless a test gives another. */
const SIZE = 1_024

/**
 * A bucket in memory: the keys it holds with their sizes, listed a page of `pageSize` at a time, with `extra` keys
 * that a store answering outside the prefix adds to every page; the calls the sweep made; and a removal that fails
 * for the collections named in `failing`, or from the call numbered `failFrom` on.
 */
function fakeDeps(
  keys: string[],
  due: DueCollection[],
  options: { pageSize?: number; failing?: string[]; failFrom?: number; extra?: string[]; size?: number } = {},
) {
  const stored = new Set(keys)
  const calls: string[] = []
  let removals = 0
  const deps: SourceSweepDeps = {
    async due(limit) {
      calls.push(`due ${limit}`)
      return due.slice(0, limit)
    },
    async *list(prefix) {
      calls.push(`list ${prefix}`)
      const matching = [...stored].filter((key) => key.startsWith(prefix)).sort()
      const size = options.pageSize ?? 1000
      const listed = (page: string[]) =>
        [...page, ...(options.extra ?? [])].map((key) => ({ key, bytes: options.size ?? SIZE }))
      for (let at = 0; at < matching.length; at += size) yield listed(matching.slice(at, at + size))
      if (!matching.length) yield listed([])
    },
    async remove(removed) {
      calls.push(`remove ${removed.join(' ')}`)
      removals++
      if (
        options.failing?.some((id) => removed[0]!.startsWith(id)) ||
        (options.failFrom !== undefined && removals >= options.failFrom)
      )
        throw new Error('Storage refused: http://s3.test/x')
      for (const key of removed) stored.delete(key)
    },
    async mark(collectionId) {
      calls.push(`mark ${collectionId}`)
      return true
    },
  }
  return { deps, stored, calls }
}

/** A collection's originals and thumbnails, two of each kind. */
const filesOf = (id: string) => [
  ...SOURCE_FOLDERS.flatMap((folder) => [`${id}/${folder}/1.png`, `${id}/${folder}/2.png`]),
  `${id}/thumbnails/1.webp`,
  `${id}/thumbnails/2.webp`,
]

const removals = (calls: string[]) => calls.filter((call) => call.startsWith('remove'))

describe('sourcePrefixes and sourceSweepDryRun (docs/specs/2026-10-17-production-hardening.md, section 7.1)', () => {
  it("names a collection's three source folders and never its thumbnails", () => {
    expect(sourcePrefixes(A)).toEqual([`${A}/layers/`, `${A}/assets/`, `${A}/placeholders/`])
  })

  it('runs dry unless SOURCE_SWEEP_DELETE is 1', () => {
    expect([{}, { SOURCE_SWEEP_DELETE: '' }, { SOURCE_SWEEP_DELETE: 'true' }].map(sourceSweepDryRun)).toEqual(
      [true, true, true],
    )
    expect(sourceSweepDryRun({ SOURCE_SWEEP_DELETE: '1' })).toBe(false)
  })

  it('writes a size in the units the log reads', () => {
    expect([512, 3_500, 13_107_200, 1_288_490_189].map(sizeText)).toEqual([
      '512 B',
      '3.4 KB',
      '12.5 MB',
      '1.2 GB',
    ])
  })
})

describe('sweepSources', () => {
  it('lists and logs a dry run with the size of the files it lists, deleting and marking nothing', async () => {
    const lines: string[] = []
    const { deps, stored, calls } = fakeDeps(filesOf(A), [{ collectionId: A, objects: 6, bytes: 100 }], {
      size: 2_184_533,
    })
    const report = await sweepSources(deps, { dryRun: true, log: (line) => lines.push(line) })
    const want: SourceSweepReport = { dryRun: true, due: 1, deleted: 0, marked: 0, failed: [] }
    expect(report).toEqual(want)
    expect(stored.size).toBe(8)
    expect(calls.some((call) => call.startsWith('remove') || call.startsWith('mark'))).toBe(false)
    expect(lines).toEqual([
      `Source sweep (dry run): ${A} has 6 original files (12.5 MB) due; nothing was deleted.`,
    ])
  })

  it('deletes the three folders a page at a time, keeps the thumbnails, and marks after an empty list', async () => {
    const lines: string[] = []
    const { deps, stored, calls } = fakeDeps(filesOf(A), [{ collectionId: A, objects: 6, bytes: 100 }], {
      pageSize: 1,
    })
    const report = await sweepSources(deps, { dryRun: false, log: (line) => lines.push(line) })
    expect(report).toEqual({ dryRun: false, due: 1, deleted: 6, marked: 1, failed: [] })
    expect([...stored].sort()).toEqual([`${A}/thumbnails/1.webp`, `${A}/thumbnails/2.webp`])
    expect(removals(calls)).toHaveLength(6)
    // The mark comes after the second listing of all three folders.
    expect(calls.at(-1)).toBe(`mark ${A}`)
    expect(calls.slice(-4, -1)).toEqual(sourcePrefixes(A).map((prefix) => `list ${prefix}`))
    expect(lines).toEqual([`Source sweep: deleted 6 original files (6.0 KB) of ${A}.`])
  })

  it('pairs the count of a resumed run with the size of the files it deleted, not the size the database recorded', async () => {
    const lines: string[] = []
    // A run that failed earlier left one of the six originals.
    const { deps } = fakeDeps([`${A}/layers/2.png`], [{ collectionId: A, objects: 6, bytes: 13_107_200 }])
    const report = await sweepSources(deps, { dryRun: false, log: (line) => lines.push(line) })
    expect(report).toMatchObject({ deleted: 1, marked: 1, failed: [] })
    expect(lines).toEqual([`Source sweep: deleted 1 original files (1.0 KB) of ${A}.`])
  })

  it('leaves a failed collection unmarked, logs it as the cron describes errors, and goes on to the next', async () => {
    const lines: string[] = []
    const due: DueCollection[] = [
      { collectionId: A, objects: 6, bytes: 100 },
      { collectionId: B, objects: 6, bytes: 100 },
    ]
    const { deps, stored, calls } = fakeDeps([...filesOf(A), ...filesOf(B)], due, { failing: [A] })
    const report = await sweepSources(deps, {
      dryRun: false,
      log: (line) => lines.push(line),
      describe: (error) => `masked ${(error as Error).name}`,
    })
    expect(report).toEqual({ dryRun: false, due: 2, deleted: 6, marked: 1, failed: [A] })
    expect(calls).not.toContain(`mark ${A}`)
    expect(calls).toContain(`mark ${B}`)
    expect([...stored].filter((key) => key.startsWith(A))).toHaveLength(8)
    expect(lines[0]).toBe(
      `Source sweep: ${A} failed after deleting 0 original files (0 B) and is tried again tomorrow: masked Error`,
    )
  })

  it('words a failure by its name alone unless told how, so no message reaches the log', async () => {
    const lines: string[] = []
    const { deps } = fakeDeps(filesOf(A), [{ collectionId: A, objects: 6, bytes: 100 }], { failing: [A] })
    await sweepSources(deps, { dryRun: false, log: (line) => lines.push(line) })
    expect(lines).toEqual([
      `Source sweep: ${A} failed after deleting 0 original files (0 B) and is tried again tomorrow: Error`,
    ])
  })

  it('says how many files a failing run deleted before the page that failed, and counts them in the report', async () => {
    const lines: string[] = []
    const { deps, stored } = fakeDeps(filesOf(A), [{ collectionId: A, objects: 6, bytes: 100 }], {
      pageSize: 1,
      failFrom: 3,
    })
    const report = await sweepSources(deps, { dryRun: false, log: (line) => lines.push(line) })
    expect(report).toEqual({ dryRun: false, due: 1, deleted: 2, marked: 0, failed: [A] })
    expect(stored.size).toBe(6)
    expect(lines).toEqual([
      `Source sweep: ${A} failed after deleting 2 original files (2.0 KB) and is tried again tomorrow: Error`,
    ])
  })

  it('refuses to mark a collection whose folders still list files after the removal', async () => {
    const { deps, calls } = fakeDeps(filesOf(A), [{ collectionId: A, objects: 6, bytes: 100 }])
    const removeNothing: SourceSweepDeps = { ...deps, remove: async () => {} }
    const report = await sweepSources(removeNothing, { dryRun: false, log: () => {} })
    expect(report).toMatchObject({ deleted: 6, marked: 0, failed: [A] })
    expect(calls).not.toContain(`mark ${A}`)
  })

  it('never lists or deletes for a due id that is not a UUID', async () => {
    const lines: string[] = []
    const { deps, calls } = fakeDeps(filesOf(A), [{ collectionId: '../', objects: 6, bytes: 100 }])
    const report = await sweepSources(deps, { dryRun: false, log: (line) => lines.push(line) })
    expect(report).toEqual({ dryRun: false, due: 1, deleted: 0, marked: 0, failed: ['../'] })
    expect(calls).toEqual(['due 20'])
    expect(lines).toEqual([
      'Source sweep: ../ failed after deleting 0 original files (0 B) and is tried again tomorrow: Error',
    ])
  })

  it("deletes only the keys under a folder's prefix, whatever else a store lists", async () => {
    // A store that adds keys outside the prefix to every page it lists: A's thumbnail and B's layer image.
    const { deps, stored, calls } = fakeDeps(
      [...filesOf(A), `${B}/layers/1.png`],
      [{ collectionId: A, objects: 6, bytes: 100 }],
      { extra: [`${A}/thumbnails/1.webp`, `${B}/layers/1.png`] },
    )
    const report = await sweepSources(deps, { dryRun: false, log: () => {} })
    expect(report).toEqual({ dryRun: false, due: 1, deleted: 6, marked: 1, failed: [] })
    expect(removals(calls).join(' ')).not.toMatch(new RegExp(`thumbnails|${B}`))
    expect([...stored].sort()).toEqual([
      `${A}/thumbnails/1.webp`,
      `${A}/thumbnails/2.webp`,
      `${B}/layers/1.png`,
    ])
    expect(calls.at(-1)).toBe(`mark ${A}`)
  })

  it('asks for 20 collections a run unless told another limit', async () => {
    const { deps, calls } = fakeDeps([], [])
    await sweepSources(deps, { dryRun: true, log: () => {} })
    await sweepSources(deps, { dryRun: true, limit: 3, log: () => {} })
    expect(calls).toEqual(['due 20', 'due 3'])
  })
})
