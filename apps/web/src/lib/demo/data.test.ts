import { hashTokenList, validateTokenList } from '@cobweb/dna'
import { describe, expect, it } from 'vitest'
import {
  DEMO_AIRDROPS,
  DEMO_COLLECTION,
  DEMO_COLLECTIONS,
  DEMO_DEFERRED_RENDER_JOBS,
  DEMO_LAYERS,
  DEMO_MINT_GROUPS,
  DEMO_RENDER_JOBS,
  DEMO_RULES,
  DEMO_TOKENS,
  DEMO_TOTAL_MINTED,
  getRenderJob,
  scaleSampleToSupply,
} from '@/lib/demo'

describe('sample supply accounting', () => {
  it('never shows more minted than the supply', () => {
    const minted = DEMO_MINT_GROUPS.reduce((sum, g) => sum + g.minted, 0)
    const airdropped = DEMO_AIRDROPS.reduce((sum, a) => sum + a.tokens, 0)
    expect(minted + airdropped).toBe(DEMO_TOTAL_MINTED)
    expect(DEMO_TOTAL_MINTED).toBeLessThanOrEqual(DEMO_COLLECTION.maxSupply)
  })

  it('allocates no more than the supply across groups', () => {
    const allocated = DEMO_MINT_GROUPS.reduce((sum, g) => sum + g.maxSupply, 0)
    expect(allocated).toBeLessThanOrEqual(DEMO_COLLECTION.maxSupply)
  })
})

describe('scaleSampleToSupply', () => {
  it('is the sample itself at the sample supply', () => {
    const view = scaleSampleToSupply(DEMO_COLLECTION.maxSupply)
    expect(view.groups).toBe(DEMO_MINT_GROUPS)
    expect(view.totalMinted).toBe(DEMO_TOTAL_MINTED)
  })

  it('never shows a figure above a real supply of 100', () => {
    const view = scaleSampleToSupply(100)
    expect(view.totalMinted).toBeLessThanOrEqual(100)
    expect(view.groups.reduce((sum, g) => sum + g.maxSupply, 0)).toBeLessThanOrEqual(100)
    for (const group of view.groups) {
      expect(group.maxSupply).toBeLessThanOrEqual(100)
      expect(group.minted).toBeLessThanOrEqual(group.maxSupply)
    }
    expect(view.groups.reduce((sum, g) => sum + g.minted, 0)).toBeLessThanOrEqual(view.totalMinted)
  })

  it('keeps the phases in proportion and every phase present', () => {
    const view = scaleSampleToSupply(100)
    expect(view.groups.map((g) => g.id)).toEqual(DEMO_MINT_GROUPS.map((g) => g.id))
    expect(view.groups.map((g) => g.maxSupply)).toEqual([61, 32, 6])
  })

  it('gives a tiny supply to the public phase and no more', () => {
    const view = scaleSampleToSupply(1)
    expect(view.groups.reduce((sum, g) => sum + g.maxSupply, 0)).toBeLessThanOrEqual(1)
    expect(view.totalMinted).toBeLessThanOrEqual(1)
  })
})

describe('sample tokens', () => {
  it('roll the same DNA as the pre-rendered art (tokens 1 and 601)', () => {
    expect(DEMO_TOKENS[0]!.dna).toEqual([
      'background-moss',
      'body-barn',
      'belly-speckled',
      'eyes-glance',
      'beak-tiny',
      'headwear-sprout',
      'accessory-none',
    ])
    expect(DEMO_TOKENS[600]!.dna).toEqual([
      'owlets-background-sand',
      'owlets-body-tawny',
      'owlets-belly-speckled',
      'owlets-eyes-sleepy',
      'owlets-beak-rose',
      'owlets-headwear-none',
      'owlets-accessory-scarf',
    ])
    expect(DEMO_TOKENS).toHaveLength(777)
  })

  it('hash to the value the pre-rendered art was drawn from', async () => {
    // Every token's id, collection and DNA, so a change anywhere in the 777 fails here, not in the pictures.
    expect(await hashTokenList(DEMO_TOKENS)).toBe(
      '0xe426358adc8cfd2d378fe39124544b0eb728507e3dbe4de1258dd04c991685b4',
    )
  })

  it('pass the lock validator as the sample project stands', () => {
    const project = { layers: DEMO_LAYERS, rules: DEMO_RULES, collections: DEMO_COLLECTIONS }
    expect(validateTokenList(project, DEMO_TOKENS, { allowDuplicates: false })).toEqual({ ok: true })
  })
})

describe('sample render jobs', () => {
  it('have a finalizing job with every batch in, in both scenarios', () => {
    for (const artDeferred of [false, true]) {
      const job = getRenderJob('finalizing', { artDeferred })
      expect(job.state).toBe('finalizing')
      if (job.state === 'finalizing') expect(job.batches.done).toBe(job.batches.total)
    }
  })

  it('mark the deferred run as the placeholder alone and the real run as the real set', () => {
    expect(DEMO_DEFERRED_RENDER_JOBS.done.placeholderImageCid).not.toBeNull()
    expect(DEMO_RENDER_JOBS.done.placeholderImageCid).toBeNull()
    expect(DEMO_RENDER_JOBS.done.batchCids).toEqual([DEMO_RENDER_JOBS.done.imagesCid])
  })
})
