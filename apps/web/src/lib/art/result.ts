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
export const QUOTE_EXPIRED = 'The quote expired. Get a new quote.'
export const NOT_THIS_JOB = 'The transaction did not pay for this job.'
export const OTHER_WALLET = 'The payment came from a different wallet than the quote.'
export const SHORT_PAYMENT = 'The payment was less than the quote.'
export const PAYMENT_USED = 'This payment was already used.'
// Said by the server or the screen.
export const CHAIN_NOT_READY = 'This chain is not ready for payments yet.'
export const NOT_CONFIRMED = 'The payment has not been confirmed on chain yet.'
export const TIMED_OUT = 'The payment is not confirmed yet. Try again in a minute; you will not pay twice.'
export const NOT_A_HASH = 'That is not a transaction hash.'
