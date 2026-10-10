import {
  ALREADY_LOCKED,
  ART_CHANGED,
  CHAIN_NOT_READY,
  CHANGED_ELSEWHERE,
  CLEAR_FIRST,
  DNA_MISMATCH,
  EMPTY_SET,
  FEE_NOT_WHOLE,
  HASH_INVALID,
  IMPORT_REFUSED,
  LOCKED,
  NO_CHAIN,
  NO_PAYMENT_DUE,
  NO_PAYMENT_FOR_JOB,
  NO_PLACEHOLDER,
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
  SAVE_CAP,
  SHORT_PAYMENT,
  SUPPLY_MISMATCH,
  TRAIT_CAP,
  UNSAVED,
  UPLOAD_CAP,
} from './result'

export type DbError = { code?: string; message: string } | null

/** Sentences the database raises that the creator reads as they are (spec section 7). */
const PASS_THROUGH = new Set([
  LOCKED,
  TRAIT_CAP,
  DNA_MISMATCH,
  IMPORT_REFUSED,
  UPLOAD_CAP,
  CHANGED_ELSEWHERE,
  EMPTY_SET,
])
/** The database's token cap sentence, shown as the longer one the browser shows before a save. */
const DB_SAVE_CAP = 'A project can have at most 100,000 tokens.'
const CANVAS = /^Every layer image must be \d+ x \d+ in this project\.$/

/** A failed art write, by SQLSTATE, in the creator's words (spec section 6). */
export function artWriteError(error: DbError): string {
  if (!error) return UNSAVED
  if (error.code === '42501') return error.message === 'collection not found' ? NOT_FOUND : LOCKED
  if (error.code === '23514' || error.code === '23505') {
    // layers_guard_tokens ends "Clear the tokens first."; the screens that offer to clear never hit it.
    if (error.message.endsWith('Clear the tokens first.')) return CLEAR_FIRST
    if (error.message === DB_SAVE_CAP) return SAVE_CAP
    if (PASS_THROUGH.has(error.message) || CANVAS.test(error.message)) return error.message
  }
  return UNSAVED
}

/** Sentences the lock and pay functions raise (supabase/migrations/20261009020000_lock_and_pay.sql). */
const LOCK_SENTENCES = new Set([
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

/** A failed lock or payment write, by SQLSTATE, in the creator's words (docs/specs/2026-10-09-lock-and-pay.md). */
export function lockWriteError(error: DbError): string {
  if (!error) return UNSAVED
  if (error.code === '42501') return error.message === 'collection not found' ? NOT_FOUND : UNSAVED
  // Two unique indexes: one open job per kind (a second lock at once), one job per payment.
  if (error.code === '23505')
    return error.message.includes('render_jobs_one_open_per_kind') ? ALREADY_LOCKED : PAYMENT_USED
  if (error.code === '23514' && LOCK_SENTENCES.has(error.message)) return error.message
  return UNSAVED
}
