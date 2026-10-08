import 'server-only'
import { artWriteError } from './db-error'
import { ownedUnlocked, type ArtClient, type OwnedCollection } from './owned'
import { fail, THROWN, type ActionResult } from './result'

type WriteError = { code?: string; message: string }
export type Outcome<T> = { data: T } | { error: WriteError }
export type ArtContext = { supabase: ArtClient; collection: OwnedCollection; collectionId: string }

const MISSING: WriteError = { code: 'P0002', message: 'no row' }

/**
 * Runs an art write for the signed-in owner of an unlocked collection. A refusal before the write is
 * returned as it is; a database error becomes the creator's sentence (`artWriteError`).
 */
export async function artWrite<T>(
  collectionId: string,
  write: (ctx: ArtContext) => Promise<Outcome<T>>,
): Promise<ActionResult<T>> {
  const owned = await ownedUnlocked(collectionId)
  if (owned.error !== undefined) return fail(owned.error)
  try {
    const outcome = await write({ supabase: owned.supabase, collection: owned.collection, collectionId })
    return 'error' in outcome ? fail(artWriteError(outcome.error)) : { ok: true, data: outcome.data }
  } catch (error) {
    // The creator reads a plain sentence; the cause goes to the server log.
    console.error('An art write threw.', error)
    return fail(THROWN)
  }
}

/** A failed lookup before a write. It carries no SQLSTATE, so the creator reads the reload sentence. */
export function lookupFailed(error: { message: string }): { error: WriteError } {
  return { error: { message: error.message } }
}

/** The position after the last row of a lookup ordered by position, highest first, limited to one. */
export function nextPosition(rows: { position: number }[] | null): number {
  return (rows?.[0]?.position ?? -1) + 1
}

/** An insert that returns its new row (`.select(...).single()`). */
export async function created<T>(
  query: PromiseLike<{ data: T | null; error: WriteError | null }>,
): Promise<Outcome<T>> {
  const { data, error } = await query
  if (error) return { error }
  return data === null ? { error: MISSING } : { data }
}

/** An update or delete of one row, asked to return it (`.select('id')`): no row means it was not there. */
export async function one(
  query: PromiseLike<{ data: unknown[] | null; error: WriteError | null }>,
): Promise<Outcome<undefined>> {
  const { data, error } = await query
  if (error) return { error }
  return data && data.length > 0 ? { data: undefined } : { error: MISSING }
}

/** A write whose only result is its error: a function call, or a delete of any number of rows. */
export async function ran(query: PromiseLike<{ error: WriteError | null }>): Promise<Outcome<undefined>> {
  const { error } = await query
  return error ? { error } : { data: undefined }
}
