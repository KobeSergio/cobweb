import { describe, expect, it } from 'vitest'
import { artWriteError } from './db-error'
import { CLEAR_FIRST, LOCKED, NOT_FOUND, SAVE_CAP, UNSAVED } from './result'

describe('artWriteError', () => {
  it('maps 42501 to not found or locked', () => {
    expect(artWriteError({ code: '42501', message: 'collection not found' })).toBe(NOT_FOUND)
    expect(artWriteError({ code: '42501', message: LOCKED })).toBe(LOCKED)
    expect(artWriteError({ code: '42501', message: 'new row violates row-level security policy' })).toBe(
      LOCKED,
    )
  })

  it('passes the guard sentences through', () => {
    for (const sentence of [
      'A layer can have at most 500 traits.',
      'Token DNA does not match the layers.',
      'This collection already has layers. Start over to replace them.',
      'This project has reached its 5 GB of files. Delete some files to upload more.',
      'Every layer image must be 1000 x 1000 in this project.',
      'Some tokens were changed elsewhere. Reload the page.',
      'The set is empty.',
    ])
      expect(artWriteError({ code: '23514', message: sentence })).toBe(sentence)
  })

  it('words the database token cap as the save cap sentence', () => {
    expect(artWriteError({ code: '23514', message: 'A project can have at most 100,000 tokens.' })).toBe(
      SAVE_CAP,
    )
  })

  it('rewords the layer guard for a screen that did not offer to clear the tokens', () => {
    const message =
      'The layers cannot be added, reordered or removed while the collection has tokens. Clear the tokens first.'
    expect(artWriteError({ code: '23514', message })).toBe(CLEAR_FIRST)
  })

  it('says "reload" for anything else, constraint names included', () => {
    expect(
      artWriteError({ code: '23514', message: 'new row violates check constraint "traits_weight_check"' }),
    ).toBe(UNSAVED)
    expect(artWriteError({ code: '23505', message: 'duplicate key value violates unique constraint' })).toBe(
      UNSAVED,
    )
    expect(artWriteError({ code: 'P0002', message: 'layer not found' })).toBe(UNSAVED)
    expect(artWriteError(null)).toBe(UNSAVED)
  })
})
