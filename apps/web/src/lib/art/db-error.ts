import {
  CHANGED_ELSEWHERE,
  CLEAR_FIRST,
  DNA_MISMATCH,
  EMPTY_SET,
  IMPORT_REFUSED,
  LOCKED,
  NOT_FOUND,
  SAVE_CAP,
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
