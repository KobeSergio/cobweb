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

// Deploy (docs/specs/2026-10-14-deploy.md, sections 4.2 and 6). The database raises the first five as they are.
export const ALREADY_DEPLOYED = 'The contract is already deployed.'
export const LINK_REQUIRED = 'Reserve your mint page link first.'
export const SUPPLY_REQUIRED = 'Set the supply in Art first.'
export const NOT_RENDERED = 'Render the art before deploying.'
export const DEPLOY_USED = 'This transaction was recorded for another collection.'
// Said by the server or the screen (the database does not raise these).
export const WRONG_CHAIN = 'The contract goes on the chain the fee was paid on.'
export const FACTORY_UNREADABLE = 'The factory could not be read.'
export const DEPLOY_NOT_CONFIRMED = 'The deployment has not been confirmed on chain yet.'
export const DEPLOY_REVERTED = 'The deployment reverted on chain.'
export const NOT_THIS_DEPLOY = 'The transaction did not deploy this collection.'
export const OTHER_CODE = 'The transaction deployed different contract code.'
export const OTHER_CONTRACT = 'The contract on chain was not built from the prepared settings.'
export const DEPLOY_TIMED_OUT =
  'The deployment is not confirmed yet. Try again in a minute; the contract is recorded once it is.'

// Phases (docs/specs/2026-10-15-phases.md, section 6.5). The database raises NOT_DEPLOYED as it is.
export const NOT_DEPLOYED = 'The contract is not deployed yet.'
// Said by the server or the screen (the database does not raise these).
export const PHASE_NAME_TAKEN = 'Another phase already has this name.'
export const PUBLIC_SHOWN = 'The public sale is always shown on the mint page.'
export const PHASE_NOT_CONFIRMED = 'The change has not been confirmed on chain yet.'
export const PHASE_REVERTED = 'The change reverted on chain.'
export const NOT_THIS_CONTRACT = "The transaction was not sent to this collection's contract."
export const NOT_FROM_WALLET = 'The transaction was not sent from your sign-in wallet.'
export const NOT_THIS_CHANGE = 'The transaction did not make this change.'
export const PHASE_NOT_ON_CHAIN = 'This phase is not on the contract.'
export const NAME_FIRST = 'Name the phase first.'
export const DESCRIPTION_TOO_LONG = 'Use at most 500 characters.'
export const PHASE_TIMED_OUT =
  'The change is not confirmed yet. Read the contract again in a minute to see it.'
// Naming a group that has no row reads the chain first; this is said when it does not answer.
export const CONTRACT_UNREADABLE = 'The contract could not be read. Try again in a minute.'

// Whitelist (docs/specs/2026-10-15-whitelist.md, section 6.6). The database raises the first three as they are.
export const WHITELIST_FULL = 'A whitelist holds up to 10,000 addresses.'
export const QUOTA_RANGE = 'The quota must be 1 to 10,000.'
export const WRONG_GROUP = 'The public sale has no whitelist.'
// Said by the server or the screen (the database does not raise these).
export const ZERO_ADDRESS = 'The zero address cannot mint or receive tokens.'
export const WHITELIST_NOT_CONFIRMED = 'The chunk has not been confirmed on chain yet.'
export const WHITELIST_TIMED_OUT =
  'The chunk is not confirmed yet. Check again in a minute; sending it again is safe.'
export const NOT_A_CONTRACT = (chain: string) => `There is no contract at this address on ${chain}.`
export const NOT_ERC721 = (chain: string) => `This address is not an ERC-721 contract on ${chain}.`
export const NO_TOTAL_SUPPLY = 'This contract does not report its total supply.'
export const SNAPSHOT_TOO_LARGE = 'Snapshots cover collections up to 20,000 tokens for now.'
export const NO_HOLDERS = 'No holders found. Check the address and the chain.'
export const SNAPSHOT_CHAIN = 'Cobweb cannot read this chain yet. Choose another chain.'
export const SNAPSHOT_FAILED = 'The snapshot could not be taken. Try again in a moment.'

// Airdrop and Settings (docs/specs/2026-10-15-airdrop-settings.md, section 6.6). Said by the server or the screen
// (the database raises none of these).
export const AIRDROP_NOT_CONFIRMED = 'The tokens have not been confirmed on chain yet.'
export const AIRDROP_TIMED_OUT =
  'The tokens are not confirmed yet. Check again in a minute, and do not send the batch again: it would mint its tokens twice.'
export const SETTINGS_NOT_CONFIRMED = 'The setting has not been confirmed on chain yet.'
export const SETTINGS_TIMED_OUT =
  'The setting is not confirmed yet. Read the contract again in a minute to see it.'
export const NOT_OWNER = (owner: string) =>
  `This wallet is not the contract's owner. Changes on chain need ${owner}.`
export const IPFS_LINK_INVALID = 'Enter a full ipfs:// link with its CID.'
