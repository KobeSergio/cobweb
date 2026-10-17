'use server'

import { redirect } from 'next/navigation'
import { getVerifiedUser } from '@/lib/auth'
import { createCollectionSchema, DRAFT_CAP_DEFAULT, draftCapOf, draftCapSentence } from '@/lib/collections'
import { stageHref } from '@/lib/steps'
import { createClient } from '@/lib/supabase/server'

export type CreateCollectionState = {
  /** A message for the whole form, when the problem is not one field's. */
  formError?: string
  fieldErrors?: Partial<Record<'name' | 'symbol' | 'projectType', string>>
}

/** A form field as text. A missing field becomes '', so validation gives its own message. */
function text(formData: FormData, name: string): string {
  const value = formData.get(name)
  return typeof value === 'string' ? value : ''
}

/**
 * Creates a draft collection for the signed-in creator and opens its art. The owner is set by the
 * database from the session, never taken from the form. There is no supply yet (`max_supply` is
 * null): it is set at Generate or from the uploads, through `setCollectionSupply`.
 *
 * Where each type lands (`stageHref(id, 'art', type)`): Generative on Layers, which opens as the
 * folder upload while there are no layers; 1/1s and Single asset on the asset upload.
 *
 * A wallet holds at most its `profiles.draft_cap` collections that are not deployed
 * (docs/specs/2026-10-17-production-hardening.md, section 6.4): the count is read first so the dialog
 * words the refusal, and the database's trigger refuses the same insert under a lock, worded the same.
 */
export async function createCollection(
  _previous: CreateCollectionState,
  formData: FormData,
): Promise<CreateCollectionState> {
  const user = await getVerifiedUser()
  if (!user) return { formError: 'Your session has ended. Sign in again to continue.' }

  const parsed = createCollectionSchema.safeParse({
    name: text(formData, 'name'),
    symbol: text(formData, 'symbol'),
    projectType: text(formData, 'projectType'),
  })
  if (!parsed.success) {
    // Keep the first message for each field.
    const fieldErrors: NonNullable<CreateCollectionState['fieldErrors']> = {}
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as keyof typeof fieldErrors
      fieldErrors[field] ??= issue.message
    }
    return { fieldErrors }
  }

  const supabase = await createClient()
  // Row-level security limits both reads to the creator's own rows.
  const [profile, held] = await Promise.all([
    supabase.from('profiles').select('draft_cap').eq('id', user.id).maybeSingle(),
    supabase
      .from('collections')
      .select('id', { count: 'exact', head: true })
      .eq('owner_id', user.id)
      .neq('status', 'deployed'),
  ])
  const cap = profile.data?.draft_cap ?? DRAFT_CAP_DEFAULT
  if ((held.count ?? 0) >= cap) return { formError: draftCapSentence(cap) }

  const { data, error } = await supabase
    .from('collections')
    .insert({
      name: parsed.data.name,
      symbol: parsed.data.symbol,
      project_type: parsed.data.projectType,
    })
    .select('id')
    .single()

  if (error) {
    const refusedAt = draftCapOf(error)
    return {
      formError:
        refusedAt === null ? 'The collection could not be created. Try again.' : draftCapSentence(refusedAt),
    }
  }

  redirect(stageHref(data.id, 'art', parsed.data.projectType))
}
