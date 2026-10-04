import { describe, expect, it } from 'vitest'
import type { Layer } from '@/lib/demo'
import { roundWeight, weightsValid, weightTotal } from '../lib/trait-index'
import { addTraits, evenOut, evenWeights, setBlank } from './layer-edits'

function layer(weights: number[], extra: Partial<Layer> = {}): Layer {
  return {
    id: 'eyes',
    collectionId: 'c',
    name: 'Eyes',
    position: 0,
    traits: weights.map((weight, i) => ({
      id: `eyes-${i}`,
      layerId: 'eyes',
      name: `Trait ${i}`,
      weight,
      blank: false,
      imageUrl: `/t${i}.png`,
    })),
    ...extra,
  }
}

const sum = (values: number[]) => Math.round(values.reduce((a, b) => a + b, 0) * 100) / 100

describe('even split (legacy "Even rarity")', () => {
  it('adds up to exactly 100 where the legacy two-decimal split gave 99.99', () => {
    expect(evenWeights(3)).toEqual([33.34, 33.33, 33.33])
    expect(sum(evenWeights(3))).toBe(100)
    expect(sum(evenWeights(9))).toBe(100)
  })

  it('gives every trait a share past 100 traits (whole percents would leave 0%)', () => {
    const shares = evenWeights(150)
    expect(sum(shares)).toBe(100)
    expect(Math.min(...shares)).toBeGreaterThan(0)
  })

  it('leaves fixed-quantity traits alone', () => {
    const base = layer([10, 10, 0])
    base.traits[2] = { ...base.traits[2]!, constant: 5 }
    const [after] = evenOut([base], 'eyes')
    expect(after!.traits.map((t) => t.weight)).toEqual([50, 50, 0])
    expect(after!.traits[2]!.constant).toBe(5)
  })
})

describe('weights', () => {
  it('stores two decimals, clamped to 0 to 100', () => {
    expect(roundWeight(33.33333)).toBe(33.33)
    expect(roundWeight(140)).toBe(100)
    expect(roundWeight(-2)).toBe(0)
    expect(roundWeight(Number.NaN)).toBe(0)
  })

  it('accepts a total from 100.00 to 100.05, as the legacy check did', () => {
    expect(weightsValid(layer([33.34, 33.34, 33.34]))).toBe(true) // 100.02
    expect(weightsValid(layer([50, 50.05]))).toBe(true)
    expect(weightsValid(layer([50, 50.06]))).toBe(false)
    expect(weightsValid(layer([33.33, 33.33, 33.33]))).toBe(false) // 99.99
    expect(weightTotal(layer([33.34, 33.34, 33.34]))).toBe(100.02)
  })
})

describe('adding a trait (legacy bug: it reset every weight, turning the blank on)', () => {
  it('adds at 0% and leaves the other weights and the blank as they were', () => {
    const withBlank = setBlank([layer([60, 40])], 'eyes', true)
    const { layers } = addTraits(withBlank, 'eyes', [{ name: 'Laser', imageUrl: '/laser.png' }])
    const traits = layers[0]!.traits
    expect(traits.find((t) => t.blank)!.weight).toBe(0)
    expect(traits.find((t) => t.name === 'Laser')!.weight).toBe(0)
    expect(traits.filter((t) => !t.blank && t.name !== 'Laser').map((t) => t.weight)).toEqual([60, 40])
  })
})
