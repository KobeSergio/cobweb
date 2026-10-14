import { describe, expect, it } from 'vitest'
import { artWriteError, lockWriteError, phasesWriteError } from './db-error'
import {
  ALREADY_LOCKED,
  ART_CHANGED,
  BATCH_ALREADY_DONE,
  BATCH_COUNT_MISMATCH,
  BATCH_RESULT_DIFFERS,
  BATCHES_STILL_RENDERING,
  CHAIN_NOT_READY,
  CLEAR_FIRST,
  FEE_NOT_WHOLE,
  HASH_INVALID,
  JOB_FAILURE_NEEDS_FINAL,
  JOB_NOT_FAILED,
  JOB_NOT_READY,
  JOB_NOT_RENDERING,
  JOB_RESULT_DIFFERS,
  JOB_UNLOCKED,
  LOCKED,
  NO_CHAIN,
  NO_PAYMENT_DUE,
  NO_PAYMENT_FOR_JOB,
  NO_PLACEHOLDER,
  NO_SUCH_BATCH,
  NOT_DEFERRED,
  NOT_FOUND,
  NOT_LOCKED,
  NOT_THIS_JOB,
  NOTHING_TO_LOCK,
  OTHER_WALLET,
  PAID_STAYS_LOCKED,
  PAYER_NOT_YOU,
  PAYMENT_AMOUNT_INVALID,
  PAYMENT_RECORDED,
  PAYMENT_USED,
  PAYMENT_USED_FOR_JOB,
  PLACEHOLDER_LOCKED,
  QUOTE_EXPIRED,
  QUOTE_FROZEN,
  QUOTE_NOT_EXPIRED,
  RETRY_LIMIT,
  PAYMENT_UNVERIFIED,
  PLACEHOLDER_LIMIT,
  SAVE_CAP,
  SHORT_PAYMENT,
  SUPPLY_MISMATCH,
  NOT_DEPLOYED,
  PHASE_NAME_TAKEN,
  PUBLIC_SHOWN,
  UNSAVED,
} from './result'

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

describe('lockWriteError', () => {
  it('passes the lock and pay sentences through', () => {
    for (const sentence of [
      ALREADY_LOCKED,
      ART_CHANGED,
      CHAIN_NOT_READY,
      NOTHING_TO_LOCK,
      PAYER_NOT_YOU,
      FEE_NOT_WHOLE,
      HASH_INVALID,
      NO_CHAIN,
      NOT_LOCKED,
      PAID_STAYS_LOCKED,
      NOT_DEFERRED,
      NO_PLACEHOLDER,
      PLACEHOLDER_LOCKED,
      NO_PAYMENT_DUE,
      QUOTE_NOT_EXPIRED,
      NO_PAYMENT_FOR_JOB,
      QUOTE_EXPIRED,
      NOT_THIS_JOB,
      OTHER_WALLET,
      SHORT_PAYMENT,
      SUPPLY_MISMATCH,
      PAYMENT_RECORDED,
      QUOTE_FROZEN,
      PAYMENT_USED_FOR_JOB,
      PAYMENT_AMOUNT_INVALID,
    ])
      expect(lockWriteError({ code: '23514', message: sentence })).toBe(sentence)
  })

  it('passes the render job sentences through, word for word', () => {
    const sentences = {
      [JOB_NOT_READY]: 'This job is not ready to render.',
      [BATCH_COUNT_MISMATCH]: 'The batch count does not match the token count.',
      [JOB_NOT_RENDERING]: 'This job is not rendering.',
      [NO_SUCH_BATCH]: 'There is no such batch.',
      [BATCH_RESULT_DIFFERS]: 'This batch was already recorded with a different result.',
      [BATCH_ALREADY_DONE]: 'This batch is already done.',
      [JOB_RESULT_DIFFERS]: 'This job was already finished with a different result.',
      [BATCHES_STILL_RENDERING]: 'This job has batches still rendering.',
      [JOB_NOT_FAILED]: 'This job has not failed.',
      [JOB_UNLOCKED]: 'This job was unlocked. Lock the art again to render it.',
      [JOB_FAILURE_NEEDS_FINAL]: 'A job-level failure must be final.',
      [RETRY_LIMIT]: 'This job has been retried too many times. Tell support about it.',
      [PAYMENT_UNVERIFIED]: 'The payment for this job could not be verified. Tell support about it.',
      [PLACEHOLDER_LIMIT]: 'The placeholder has been locked too many times. Tell support about it.',
    }
    expect(Object.keys(sentences)).toHaveLength(14)
    for (const [constant, sentence] of Object.entries(sentences)) {
      expect(constant).toBe(sentence)
      expect(lockWriteError({ code: '23514', message: sentence })).toBe(sentence)
    }
  })

  it('maps the owner check and the two unique indexes', () => {
    expect(lockWriteError({ code: '42501', message: 'collection not found' })).toBe(NOT_FOUND)
    expect(lockWriteError({ code: '23505', message: PAYMENT_USED })).toBe(PAYMENT_USED)
    expect(
      lockWriteError({
        code: '23505',
        message: 'duplicate key value violates unique constraint "render_jobs_payment_tx_hash_once"',
      }),
    ).toBe(PAYMENT_USED)
    expect(
      lockWriteError({
        code: '23505',
        message: 'duplicate key value violates unique constraint "render_jobs_one_open_per_kind"',
      }),
    ).toBe(ALREADY_LOCKED)
  })

  it('says "reload" for anything else', () => {
    expect(lockWriteError({ code: '23514', message: 'new row violates check constraint "x"' })).toBe(UNSAVED)
    expect(lockWriteError({ code: '42501', message: 'permission denied for function art_lock' })).toBe(
      UNSAVED,
    )
    expect(lockWriteError(null)).toBe(UNSAVED)
  })
})

describe('phasesWriteError', () => {
  it('reads every refusal of the owner check as not found', () => {
    expect(phasesWriteError({ code: '42501', message: 'collection not found' })).toBe(NOT_FOUND)
    expect(phasesWriteError({ code: '42501', message: 'phase not found' })).toBe(NOT_FOUND)
    expect(phasesWriteError({ code: '42501', message: 'permission denied for table mint_groups' })).toBe(
      NOT_FOUND,
    )
  })

  it('maps the name index and the public sale check, and passes the not-deployed sentence through', () => {
    expect(
      phasesWriteError({
        code: '23505',
        message: 'duplicate key value violates unique constraint "mint_groups_name_key"',
      }),
    ).toBe(PHASE_NAME_TAKEN)
    expect(
      phasesWriteError({
        code: '23514',
        message: 'new row for relation "mint_groups" violates check constraint "mint_groups_public_shown"',
      }),
    ).toBe(PUBLIC_SHOWN)
    expect(phasesWriteError({ code: '23514', message: NOT_DEPLOYED })).toBe(NOT_DEPLOYED)
  })

  it('says "reload" for anything else', () => {
    expect(
      phasesWriteError({
        code: '23505',
        message: 'duplicate key value violates unique constraint "mint_groups_position_key"',
      }),
    ).toBe(UNSAVED)
    expect(
      phasesWriteError({
        code: '23514',
        message: 'new row for relation "mint_groups" violates check constraint "mint_groups_name_check"',
      }),
    ).toBe(UNSAVED)
    expect(phasesWriteError(null)).toBe(UNSAVED)
  })
})
