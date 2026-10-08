import { describe, expect, it } from 'vitest'
import {
  artName,
  assetOrder,
  assetPatch,
  artSettings,
  groupTraits,
  newTraits,
  importPayload,
  parse,
  ruleInput,
  tokenSet,
  traitName,
  weightTable,
} from './schemas'
import { TOKEN_CHUNK } from './token-ops'

const UNSAVED = 'That change could not be saved. Reload the page and try again.'
const id = '0f4a0f3e-2f5e-4e3a-9d1c-1b2c3d4e5f60'
const other = '1f4a0f3e-2f5e-4e3a-9d1c-1b2c3d4e5f61'
const error = (result: { ok: boolean; error?: string }) => (result.ok ? null : result.error)

describe('the input rules of spec section 6, one failing row each', () => {
  it('a weight is 0 to 100 with two decimals', () => {
    expect(error(parse(weightTable, [{ traitId: id, weight: 33.33, constant: null }]))).toBeNull()
    expect(error(parse(weightTable, [{ traitId: id, weight: 100.5, constant: null }]))).toBe(
      'A weight is a percent from 0 to 100.',
    )
    expect(error(parse(weightTable, [{ traitId: id, weight: -1, constant: null }]))).toBe(
      'A weight is a percent from 0 to 100.',
    )
    expect(error(parse(weightTable, [{ traitId: id, weight: 12.345, constant: null }]))).toBe(
      'A weight has at most two decimals.',
    )
  })

  it('a constant is 1 to 10,000 and forces the weight to 0', () => {
    expect(error(parse(weightTable, [{ traitId: id, weight: 0, constant: 0 }]))).toBe(
      'A fixed quantity is a whole number from 1 to 10,000.',
    )
    expect(error(parse(weightTable, [{ traitId: id, weight: 0, constant: 10_001 }]))).toBe(
      'A fixed quantity is a whole number from 1 to 10,000.',
    )
    const parsed = parse(weightTable, [{ traitId: id, weight: 20, constant: 5 }])
    expect(parsed.ok && parsed.data[0]).toEqual({ traitId: id, weight: 0, constant: 5 })
  })

  it('names are 1 to 48 characters, trait names 1 to 64', () => {
    expect(error(parse(artName, 'Eyes'))).toBeNull()
    expect(error(parse(artName, '   '))).toBe('A name needs 1 to 48 characters.')
    expect(error(parse(artName, 'x'.repeat(49)))).toBe('A name needs 1 to 48 characters.')
    expect(error(parse(traitName, 'x'.repeat(64)))).toBeNull()
    expect(error(parse(traitName, 'x'.repeat(65)))).toBe('A trait name needs 1 to 64 characters.')
  })

  it("a rule's related traits are at least one", () => {
    expect(
      error(parse(ruleInput, { kind: 'must pair with', traitId: id, relatedTraitIds: [other] })),
    ).toBeNull()
    expect(error(parse(ruleInput, { kind: 'must pair with', traitId: id, relatedTraitIds: [] }))).toBe(
      'A rule needs at least one related trait.',
    )
  })

  it('an "at least one" group has at least two traits', () => {
    expect(error(parse(groupTraits, [id, other]))).toBeNull()
    expect(error(parse(groupTraits, [id]))).toBe('An "at least one" group needs at least two traits.')
  })

  it('the token name follows tokenNameProblem, the description is at most 500 characters', () => {
    expect(error(parse(artSettings, { tokenName: 'Night Owl' }))).toBeNull()
    expect(error(parse(artSettings, { tokenName: 'Owl #1' }))).toBe(
      'A token name cannot contain #, quotes or backticks.',
    )
    expect(error(parse(artSettings, { tokenName: '  ' }))).toBe('Enter a token name.')
    expect(error(parse(artSettings, { tokenName: 'x'.repeat(65) }))).toBe(
      'A token name has at most 64 characters.',
    )
    expect(error(parse(artSettings, { tokenDescription: 'x'.repeat(501) }))).toBe(
      'A description has at most 500 characters.',
    )
  })

  it('a save carries at most one chunk of tokens', () => {
    const token = (tokenId: number) => ({ tokenId, artCollectionId: id, dna: [other], description: null })
    expect(error(parse(tokenSet, [token(1)]))).toBeNull()
    expect(
      error(
        parse(
          tokenSet,
          Array.from({ length: TOKEN_CHUNK + 1 }, (_, i) => token(i + 1)),
        ),
      ),
    ).toBe(UNSAVED)
  })

  it('an import needs at least one collection and a stored image per trait', () => {
    expect(error(parse(importPayload, { collections: [], activeCollectionId: null }))).toBe(
      'The folder has no layers to import.',
    )
    const payload = {
      collections: [
        { name: 'Owls', layers: [{ name: 'Eyes', traits: [{ name: 'Wide', uploadId: 'blob:x' }] }] },
      ],
      activeCollectionId: null,
    }
    expect(error(parse(importPayload, payload))).toBe(
      'That change could not be saved. Reload the page and try again.',
    )
  })

  it('every array input has a count cap that reads the reload sentence', () => {
    const ids = (n: number) => Array.from({ length: n }, () => id)
    expect(
      error(
        parse(
          newTraits,
          Array.from({ length: 501 }, () => ({ name: 'A', uploadId: id })),
        ),
      ),
    ).toBe(UNSAVED)
    expect(error(parse(ruleInput, { kind: 'must pair with', traitId: id, relatedTraitIds: ids(501) }))).toBe(
      UNSAVED,
    )
    expect(error(parse(groupTraits, ids(501)))).toBe(UNSAVED)
    expect(
      error(
        parse(
          weightTable,
          Array.from({ length: 502 }, () => ({ traitId: id, weight: 0, constant: null })),
        ),
      ),
    ).toBe(UNSAVED)
    expect(
      error(
        parse(
          weightTable,
          Array.from({ length: 501 }, () => ({ traitId: id, weight: 0, constant: null })),
        ),
      ),
    ).toBeNull()
    const row = { uploadId: id, position: 0 }
    expect(
      error(
        parse(
          assetOrder,
          Array.from({ length: 10_001 }, () => row),
        ),
      ),
    ).toBe(UNSAVED)
    expect(
      error(
        parse(
          assetOrder,
          Array.from({ length: 10_000 }, () => row),
        ),
      ),
    ).toBeNull()
    const trait = { name: 'A', uploadId: id }
    const layer = (n: number) => ({ name: 'L', traits: Array.from({ length: n }, () => trait) })
    const collection = (layers: number, traits = 1) => ({
      name: 'C',
      layers: Array.from({ length: layers }, () => layer(traits)),
    })
    const payload = (collections: unknown[]) => ({ collections, activeCollectionId: null })
    expect(error(parse(importPayload, payload(Array.from({ length: 21 }, () => collection(1)))))).toBe(
      UNSAVED,
    )
    expect(error(parse(importPayload, payload([collection(51)])))).toBe(UNSAVED)
    expect(error(parse(importPayload, payload([collection(1, 501)])))).toBe(UNSAVED)
    expect(error(parse(importPayload, payload([collection(50, 500)])))).toBeNull()
  })
})

describe('the asset rules of spec section 6', () => {
  it('editions are 1 to 10,000; attributes need a trait type and a value of 1 to 64 characters', () => {
    expect(
      error(parse(assetPatch, { quantity: 1, attributes: [{ traitType: 'Name', value: 'Moon' }] })),
    ).toBeNull()
    expect(error(parse(assetPatch, { quantity: 0 }))).toBe('Editions are a whole number from 1 to 10,000.')
    expect(error(parse(assetPatch, { quantity: 10_001 }))).toBe(
      'Editions are a whole number from 1 to 10,000.',
    )
    const sentence = 'An attribute needs a trait type and a value of 1 to 64 characters each.'
    expect(error(parse(assetPatch, { attributes: [{ traitType: ' ', value: 'Moon' }] }))).toBe(sentence)
    expect(error(parse(assetPatch, { attributes: [{ traitType: 'Name', value: 'x'.repeat(65) }] }))).toBe(
      sentence,
    )
  })

  it('at most 32 attributes', () => {
    const attribute = { traitType: 'Name', value: 'Moon' }
    expect(error(parse(assetPatch, { attributes: Array.from({ length: 32 }, () => attribute) }))).toBeNull()
    expect(error(parse(assetPatch, { attributes: Array.from({ length: 33 }, () => attribute) }))).toBe(
      UNSAVED,
    )
  })
})
