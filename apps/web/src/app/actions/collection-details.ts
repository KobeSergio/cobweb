'use server'

import { revalidatePath } from 'next/cache'
import { getVerifiedUser } from '@/lib/auth'
import { updateDetailsSchema, type DetailsField } from '@/lib/collection-details'
import { frozenDetailFields } from '@/lib/steps'
import { createClient } from '@/lib/supabase/server'

export type UpdateDetailsState = {
  /** True after a successful save; cleared by the next submit. */
  saved?: boolean
  formError?: string
  fieldErrors?: Partial<Record<DetailsField, string>>
}

/** A form field as text. A missing field becomes '', so validation gives its own message. */
function text(formData: FormData, name: string): string {
  const value = formData.get(name)
  return typeof value === 'string' ? value : ''
}

const DEPLOYED_MESSAGE: Record<'name' | 'symbol' | 'description', string> = {
  name: 'The name cannot change after deployment.',
  symbol: 'The symbol cannot change after deployment.',
  description: 'The description cannot change after deployment.',
}
/** The database's own sentence (docs/specs/2026-10-14-deploy.md, section 4.3). */
const LOCKED_MESSAGE = 'The name, symbol and description cannot change while the art is locked.'

/**
 * Saves a collection's details (name, symbol, description). The supply is not set here: see
 * `setCollectionSupply`. Bind the collection id: `updateCollectionDetails.bind(null, id)`.
 * Checks the session with the auth server and that the signed-in creator owns the collection,
 * and only writes fields the row still allows (the database enforces the same rules in
 * `collections_guard_frozen_fields`: the three freeze while the art is locked, the name and symbol
 * once deployed).
 */
export async function updateCollectionDetails(
  collectionId: string,
  _previous: UpdateDetailsState,
  formData: FormData,
): Promise<UpdateDetailsState> {
  const user = await getVerifiedUser()
  if (!user) return { formError: 'Your session has ended. Sign in again to continue.' }
  if (!/^[0-9a-f-]{36}$/i.test(collectionId)) return { formError: 'This collection could not be found.' }

  const supabase = await createClient()
  const { data: current } = await supabase
    .from('collections')
    .select('id, owner_id, status, art_locked_at, name, symbol, description')
    .eq('id', collectionId)
    .maybeSingle()
  if (!current || current.owner_id !== user.id) return { formError: 'This collection could not be found.' }

  const parsed = updateDetailsSchema.safeParse({
    name: text(formData, 'name'),
    symbol: text(formData, 'symbol'),
    description: text(formData, 'description'),
  })
  if (!parsed.success) {
    const fieldErrors: NonNullable<UpdateDetailsState['fieldErrors']> = {}
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as DetailsField
      fieldErrors[field] ??= issue.message
    }
    return { fieldErrors }
  }
  const input = parsed.data

  // Frozen fields are not written. Asking to change one is an error, not a silent no-op.
  const frozen = frozenDetailFields(current)
  const stored = { name: current.name, symbol: current.symbol, description: current.description }
  const fieldErrors: NonNullable<UpdateDetailsState['fieldErrors']> = {}
  for (const field of ['name', 'symbol', 'description'] as const) {
    if (frozen.has(field) && input[field] !== stored[field])
      fieldErrors[field] = current.art_locked_at !== null ? LOCKED_MESSAGE : DEPLOYED_MESSAGE[field]
  }
  if (Object.keys(fieldErrors).length > 0) return { fieldErrors }

  const update: { name?: string; symbol?: string; description?: string } = {}
  if (!frozen.has('name')) update.name = input.name
  if (!frozen.has('symbol')) update.symbol = input.symbol
  if (!frozen.has('description')) update.description = input.description
  // Every field frozen and unchanged: nothing to write, and the trigger would refuse nothing either.
  if (Object.keys(update).length === 0) return { saved: true }

  const { error } = await supabase.from('collections').update(update).eq('id', collectionId)
  if (error) {
    // 23514 is a check violation, raised by the frozen-field trigger if the row changed meanwhile.
    if (error.code === '23514')
      return { formError: 'Some of these details can no longer change. Reload the page.' }
    return { formError: 'The details could not be saved. Try again.' }
  }

  // The workspace layout shows the name, so refresh it and every page under it.
  revalidatePath('/collections/[id]', 'layout')
  revalidatePath('/collections')
  return { saved: true }
}
