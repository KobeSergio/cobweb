import { describe, expect, it } from 'vitest'
import { parseSweepArgs, sweepOrphans, type StoredObject, type SweepDeps } from './sweep'

const HOUR = 3_600_000
const NOW = Date.parse('2026-10-09T12:00:00Z')
const object = (key: string, hoursAgo: number): StoredObject => ({
  key,
  lastModified: new Date(NOW - hoursAgo * HOUR),
})

function fake(pages: StoredObject[][], recordedKeys: string[]) {
  const removed: string[][] = []
  const prefixes: string[] = []
  const deps: SweepDeps = {
    list: async function* (prefix) {
      prefixes.push(prefix)
      for (const page of pages) yield page.filter((entry) => entry.key.startsWith(prefix))
    },
    recorded: async (keys) => new Set(keys.filter((key) => recordedKeys.includes(key))),
    remove: async (keys) => {
      removed.push(keys)
    },
  }
  return { deps, removed, prefixes }
}

const pages = [
  [object('c1/assets/a.png', 30), object('c1/assets/b.png', 30), object('c1/assets/c.png', 2)],
  [object('c2/layers/d.png', 48)],
]
const options = { prefix: '', minAgeMs: 24 * HOUR, now: NOW, dryRun: false }

describe('sweepOrphans', () => {
  it('deletes objects older than a day with no row, keeping recorded and recent ones', async () => {
    const { deps, removed } = fake(pages, ['c1/assets/a.png'])
    expect(await sweepOrphans(deps, options)).toEqual({
      listed: 4,
      old: 3,
      recorded: 1,
      orphaned: ['c1/assets/b.png', 'c2/layers/d.png'],
      deleted: 2,
    })
    expect(removed).toEqual([['c1/assets/b.png'], ['c2/layers/d.png']])
  })

  it('lists only in a dry run', async () => {
    const { deps, removed } = fake(pages, ['c1/assets/a.png'])
    const report = await sweepOrphans(deps, { ...options, dryRun: true })
    expect(report.orphaned).toEqual(['c1/assets/b.png', 'c2/layers/d.png'])
    expect(report.deleted).toBe(0)
    expect(removed).toEqual([])
  })

  it('counts an object exactly a day old as old, and passes the prefix to the listing', async () => {
    const { deps, prefixes } = fake([[object('c1/x.png', 24), object('c1/y.png', 23.9)]], [])
    const report = await sweepOrphans(deps, { ...options, prefix: 'c1/' })
    expect(report.orphaned).toEqual(['c1/x.png'])
    expect(prefixes).toEqual(['c1/'])
  })
})

describe('sweepOrphans progress', () => {
  it('reports each page with the totals so far', async () => {
    const { deps } = fake(pages, ['c1/assets/a.png'])
    const seen: [number, string[], number][] = []
    await sweepOrphans(deps, {
      ...options,
      onPage: (page, totals) => seen.push([page.listed, page.orphaned, totals.deleted]),
    })
    expect(seen).toEqual([
      [3, ['c1/assets/b.png'], 1],
      [1, ['c2/layers/d.png'], 2],
    ])
  })
})

describe('parseSweepArgs', () => {
  it('defaults to a real run, a day, the whole bucket and local only', () => {
    expect(parseSweepArgs([])).toEqual({ dryRun: false, allowRemote: false, minAgeHours: 24, prefix: '' })
  })

  it('reads the options and ignores the separator pnpm may pass on', () => {
    expect(
      parseSweepArgs(['--', '--dry-run', '--min-age-hours', '0', '--prefix', 'c1/', '--allow-remote']),
    ).toEqual({ dryRun: true, allowRemote: true, minAgeHours: 0, prefix: 'c1/' })
  })

  it('refuses a minimum age that is not a number of hours, and unknown options', () => {
    expect(() => parseSweepArgs(['--min-age-hours', 'soon'])).toThrow(
      'The minimum age is a number of hours, 0 or more.',
    )
    expect(() => parseSweepArgs(['--min-age-hours', '-1'])).toThrow(
      'The minimum age is a number of hours, 0 or more.',
    )
    for (const bad of [[], [''], [' ']])
      expect(() => parseSweepArgs(['--min-age-hours', ...bad])).toThrow(
        'The minimum age is a number of hours, 0 or more.',
      )
    expect(() => parseSweepArgs(['--prefix'])).toThrow('The prefix option needs a key prefix')
    expect(() => parseSweepArgs(['--prefix', '--dry-run'])).toThrow('The prefix option needs a key prefix')
    expect(() => parseSweepArgs(['--everything'])).toThrow('Unknown option: --everything')
  })
})
