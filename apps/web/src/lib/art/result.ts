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
