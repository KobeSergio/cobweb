/**
 * What every Art server action returns, and the sentences the Art screens show when a write fails
 * (docs/specs/2026-10-08-art-wiring.md, sections 5 to 7). Pure, so the browser, the actions and the
 * tests share it.
 */
export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string }

export const done: ActionResult = { ok: true, data: undefined }

export function fail(error: string): { ok: false; error: string } {
  return { ok: false, error }
}

export const SIGNED_OUT = 'Your session has ended. Sign in again to continue.'
export const NOT_FOUND = 'This collection could not be found.'
export const LOCKED = 'The art is locked and cannot change.'
export const UNSAVED = 'That change could not be saved. Reload the page and try again.'
export const THROWN = 'That change could not be saved. Try again.'
export const CLEAR_FIRST = 'Clear the generated tokens first, then change the layers.'
export const IMPORT_REFUSED = 'This collection already has layers. Start over to replace them.'
export const TRAIT_CAP = 'A layer can have at most 500 traits.'
export const DNA_MISMATCH = 'Token DNA does not match the layers.'
export const SAVE_CAP = 'A project can have at most 100,000 tokens. Lower the collection sizes.'
export const UPLOAD_CAP = 'This project has reached its 5 GB of files. Delete some files to upload more.'
export const SAVE_INCOMPLETE = 'The set did not save in full. Generate again.'
export const CHANGED_ELSEWHERE = 'Some tokens were changed elsewhere. Reload the page.'
export const EMPTY_SET = 'The set is empty.'

// Lock and pay (docs/specs/2026-10-09-lock-and-pay.md). The database raises these as they are.
export const ALREADY_LOCKED = 'The art is already locked.'
export const ART_CHANGED = 'The art changed while locking. Review it again.'
export const NOTHING_TO_LOCK = 'There is nothing to lock yet.'
export const PAYER_NOT_YOU = 'The quote must be issued to your sign-in wallet.'
export const FEE_NOT_WHOLE = 'The fee must be a whole number of wei.'
export const HASH_INVALID = 'The token list hash is not valid.'
export const NO_CHAIN = 'Choose the network the fee is paid on.'
export const NOT_LOCKED = 'The art is not locked.'
export const PAID_STAYS_LOCKED = 'The art is paid for and stays locked.'
export const NOT_DEFERRED = 'Only a collection that finishes its art later locks a placeholder alone.'
export const NO_PLACEHOLDER = 'Choose a placeholder file first.'
export const PLACEHOLDER_LOCKED = 'The placeholder is already locked.'
export const NO_PAYMENT_DUE = 'There is no payment waiting for this collection.'
export const QUOTE_NOT_EXPIRED = 'The quote has not expired yet.'
export const NO_PAYMENT_FOR_JOB = 'There is no payment waiting for this job.'
export const NOT_THIS_JOB = 'The transaction did not pay for this job.'
export const OTHER_WALLET = 'The payment came from a different wallet than the quote.'
export const SUPPLY_MISMATCH = 'The supply does not match the tokens. Generate again.'
export const PAYMENT_RECORDED = 'A payment is recorded on this lock, so it stays.'
export const QUOTE_FROZEN = 'A payment is already recorded, so the quote cannot change.'
export const PAYMENT_USED_FOR_JOB = 'A payment is already recorded for this job.'
export const PAYMENT_AMOUNT_INVALID = 'The payment amount is invalid.'
export const PAYMENT_USED = 'This payment was already used.'
// Said by the server or the screen (the database does not raise these).
export const PAYMENT_ON_CHAIN = 'A payment for this job is on chain. Enter its transaction hash to record it.'
export const QUOTE_EXPIRED = 'The quote expired. Get a new quote.'
export const SHORT_PAYMENT = 'The payment was less than the quote.'
export const CHAIN_NOT_READY = 'This chain is not ready for payments yet.'
export const NOT_CONFIRMED = 'The payment has not been confirmed on chain yet.'
export const TIMED_OUT = 'The payment is not confirmed yet. Try again in a minute; you will not pay twice.'
export const NOT_A_HASH = 'That is not a transaction hash.'

// Render job state (docs/specs/2026-10-12-render-job-state.md, section 8). The database raises these as they are.
export const JOB_NOT_READY = 'This job is not ready to render.'
export const BATCH_COUNT_MISMATCH = 'The batch count does not match the token count.'
export const JOB_NOT_RENDERING = 'This job is not rendering.'
export const NO_SUCH_BATCH = 'There is no such batch.'
export const BATCH_RESULT_DIFFERS = 'This batch was already recorded with a different result.'
export const BATCH_ALREADY_DONE = 'This batch is already done.'
export const JOB_RESULT_DIFFERS = 'This job was already finished with a different result.'
export const BATCHES_STILL_RENDERING = 'This job has batches still rendering.'
export const JOB_NOT_FAILED = 'This job has not failed.'
export const JOB_UNLOCKED = 'This job was unlocked. Lock the art again to render it.'
// Ruling on spec section 4: a job-level failure (art_batch_failed with no batch) is final only.
export const JOB_FAILURE_NEEDS_FINAL = 'A job-level failure must be final.'
// Ruling: the creator may retry a failed job five times (render_jobs.retries).
export const RETRY_LIMIT = 'This job has been retried too many times. Tell support about it.'
// Ruling: a job the worker failed for a payment it could not verify is not retried by the creator.
export const PAYMENT_UNVERIFIED = 'The payment for this job could not be verified. Tell support about it.'
// Ruling: a collection may lock its placeholder ten times, in any state of the earlier jobs.
export const PLACEHOLDER_LIMIT = 'The placeholder has been locked too many times. Tell support about it.'
