import {
  ALREADY_LOCKED,
  ALREADY_DEPLOYED,
  ART_CHANGED,
  BATCH_ALREADY_DONE,
  BATCH_COUNT_MISMATCH,
  BATCH_RESULT_DIFFERS,
  BATCHES_STILL_RENDERING,
  CHAIN_NOT_READY,
  CHANGED_ELSEWHERE,
  CLEAR_FIRST,
  DNA_MISMATCH,
  DEPLOY_USED,
  EMPTY_SET,
  FEE_NOT_WHOLE,
  HASH_INVALID,
  IMPORT_REFUSED,
  JOB_FAILURE_NEEDS_FINAL,
  JOB_NOT_FAILED,
  JOB_NOT_READY,
  JOB_NOT_RENDERING,
  JOB_RESULT_DIFFERS,
  JOB_UNLOCKED,
  LOCKED,
  LINK_REQUIRED,
  NAME_FIRST,
  NO_CHAIN,
  NO_PAYMENT_DUE,
  NO_PAYMENT_FOR_JOB,
  NO_PLACEHOLDER,
  NO_SUCH_BATCH,
  NOT_DEFERRED,
  NOT_DEPLOYED,
  NOT_FOUND,
  NOT_LOCKED,
  NOT_RENDERED,
  NOT_THIS_JOB,
  NOTHING_TO_LOCK,
  OTHER_WALLET,
  PAID_STAYS_LOCKED,
  PAYER_NOT_YOU,
  PHASE_NAME_TAKEN,
  PAYMENT_AMOUNT_INVALID,
  PAYMENT_RECORDED,
  PAYMENT_USED,
  PAYMENT_USED_FOR_JOB,
  PLACEHOLDER_LOCKED,
  PUBLIC_SHOWN,
  QUOTA_RANGE,
  QUOTE_EXPIRED,
  QUOTE_FROZEN,
  QUOTE_NOT_EXPIRED,
  RETRY_LIMIT,
  PAYMENT_UNVERIFIED,
  PLACEHOLDER_LIMIT,
  SAVE_CAP,
  SHORT_PAYMENT,
  SUPPLY_MISMATCH,
  SUPPLY_REQUIRED,
  TRAIT_CAP,
  UNSAVED,
  UPLOAD_CAP,
  WHITELIST_FULL,
  WRONG_GROUP,
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

/**
 * Sentences the lock, pay and render functions raise (supabase/migrations/20261009020000_lock_and_pay.sql,
 * 20261012010000_render_job_state.sql).
 */
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
  JOB_NOT_READY,
  BATCH_COUNT_MISMATCH,
  JOB_NOT_RENDERING,
  NO_SUCH_BATCH,
  BATCH_RESULT_DIFFERS,
  BATCH_ALREADY_DONE,
  JOB_RESULT_DIFFERS,
  BATCHES_STILL_RENDERING,
  JOB_NOT_FAILED,
  JOB_UNLOCKED,
  JOB_FAILURE_NEEDS_FINAL,
  RETRY_LIMIT,
  PAYMENT_UNVERIFIED,
  PLACEHOLDER_LIMIT,
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

/** Sentences collection_record_deploy raises (supabase/migrations/20261014100000_deploy.sql). */
const DEPLOY_SENTENCES = new Set([
  ALREADY_DEPLOYED,
  LINK_REQUIRED,
  SUPPLY_REQUIRED,
  NOT_RENDERED,
  DEPLOY_USED,
])

/** A failed deploy write, by SQLSTATE, in the creator's words (docs/specs/2026-10-14-deploy.md, section 6). */
export function deployWriteError(error: DbError): string {
  if (!error) return UNSAVED
  if (error.code === '42501') return error.message === 'collection not found' ? NOT_FOUND : UNSAVED
  // Two unique indexes: one deployment per transaction, one per collection (the primary key).
  if (error.code === '23505')
    return error.message.includes('deployments_tx_hash_key') ? DEPLOY_USED : ALREADY_DEPLOYED
  if (error.code === '23514' && DEPLOY_SENTENCES.has(error.message)) return error.message
  return UNSAVED
}

/** Sentences the phases functions raise (supabase/migrations/20261015000000_phases.sql). */
const PHASES_SENTENCES = new Set([NOT_DEPLOYED])

/**
 * A failed phases write, by SQLSTATE, in the creator's words (docs/specs/2026-10-15-phases.md, section
 * 6.4): the owner lock's 'collection not found', mint_group_move's 'phase not found' and a refused grant
 * all read as not found; the name index as a taken name; the public sale's check as always shown.
 */
export function phasesWriteError(error: DbError): string {
  if (!error) return UNSAVED
  if (error.code === '42501') return NOT_FOUND
  if (error.code === '23505' && error.message.includes('mint_groups_name_key')) return PHASE_NAME_TAKEN
  if (error.code === '23514') {
    if (error.message.includes('mint_groups_public_shown')) return PUBLIC_SHOWN
    if (PHASES_SENTENCES.has(error.message)) return error.message
  }
  return UNSAVED
}

/** Sentences the whitelist functions raise (supabase/migrations/20261015100000_whitelist.sql). */
const WHITELIST_SENTENCES = new Set([NOT_DEPLOYED, WHITELIST_FULL, QUOTA_RANGE, WRONG_GROUP])

/**
 * A failed whitelist write, by SQLSTATE, in the creator's words (docs/specs/2026-10-15-whitelist.md, section
 * 6.6): a group Cobweb has no row for is named first, any other refused owner check reads as not found, and
 * the functions' own sentences pass through.
 */
export function whitelistWriteError(error: DbError): string {
  if (!error) return UNSAVED
  if (error.code === '42501') return error.message === 'phase not found' ? NAME_FIRST : NOT_FOUND
  if (error.code === '23514' && WHITELIST_SENTENCES.has(error.message)) return error.message
  return UNSAVED
}
