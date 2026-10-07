import { describe, expect, it } from 'vitest'
import { fixture } from './fixture'
import {
  attributeCounts,
  attributeKey,
  attributeKeyOf,
  buildTraitIndex,
  constantTotal,
  expectedCount,
  joinOr,
  layersOf,
  roundWeight,
  traitName,
  weightedTraits,
  weightsValid,
  weightTotal,
} from './index-of'

const project = fixture()
const index = buildTraitIndex(project.layers)

describe('trait index', () => {
  it('finds a trait with its layer and the layer position within the project list', () => {
    const entry = index.get('eyes-gold')!
    expect(entry.layer.id).toBe('eyes')
    expect(entry.trait.constant).toBe(3)
    expect(entry.layerIndex).toBe(2)
    expect(traitName(index, 'eyes-gold')).toBe('Gold')
    expect(traitName(index, 'gone')).toBe('Removed trait')
  })

  it("lists one collection's layers bottom first", () => {
    const shuffled = [...project.layers].reverse()
    expect(layersOf(shuffled, 'owls').map((l) => l.id)).toEqual(['background', 'body', 'eyes', 'accessory'])
  })

  it('joins names as "A, B or C"', () => {
    expect(joinOr([])).toBe('')
    expect(joinOr(['A'])).toBe('A')
    expect(joinOr(['A', 'B', 'C'])).toBe('A, B or C')
  })
})

describe('weights', () => {
  const eyes = project.layers[2]!
  it('picks by weight only among non-constant traits with a share', () => {
    expect(weightedTraits(eyes).map((t) => t.id)).toEqual(['eyes-wide', 'eyes-sleepy'])
  })
  it('stores two decimals clamped to 0 to 100, and accepts totals from 100 to 100.05', () => {
    expect(roundWeight(33.33333)).toBe(33.33)
    expect(roundWeight(140)).toBe(100)
    expect(roundWeight(Number.NaN)).toBe(0)
    expect(weightTotal(eyes)).toBe(100)
    expect(weightsValid(eyes)).toBe(true)
    expect(
      weightsValid({ ...eyes, traits: eyes.traits.map((t) => ({ ...t, weight: t.weight ? 50.06 : 0 })) }),
    ).toBe(false)
  })
  it('counts constants and expected counts for a supply', () => {
    expect(constantTotal(eyes)).toBe(3)
    expect(expectedCount(eyes, eyes.traits[2]!, 100)).toBe(3)
    expect(expectedCount(eyes, eyes.traits[0]!, 103)).toBe(50)
  })
})

describe('attributes', () => {
  it('keys an attribute by layer and trait name, the same in two collections', () => {
    const keyOf = attributeKeyOf(index)
    expect(keyOf('body-barn')).toBe(attributeKey('Body', 'Barn'))
    expect(keyOf('ob-1')).toBe(attributeKey('O-body', 'Barn'))
    expect(keyOf('unknown')).toBe('unknown')
    const counts = attributeCounts([{ dna: ['body-barn'] }, { dna: ['body-barn', 'eyes-wide'] }], index)
    expect(counts.get(attributeKey('Body', 'Barn'))).toBe(2)
  })
})
