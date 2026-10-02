'use server'

import { redirect } from 'next/navigation'
import { getVerifiedUser } from '@/lib/auth'
import { createCollectionSchema } from '@/lib/collections'
import { createClient } from '@/lib/supabase/server'

export type CreateCollectionState = {
  /** A message for the whole form, when the problem is not one field's. */
  formError?: string
  fieldErrors?: Partial<Record<'name' | 'symbol' | 'slug' | 'projectType' | 'maxSupply', string>>
}

/** A form field as text. A missing field becomes '', so validation gives its own message. */
function text(formData: FormData, name: string): string {
  const value = formData.get(name)
  return typeof value === 'string' ? value : ''
}

/**
 * Creates a draft collection for the signed-in creator and opens it.
 * The owner is set by the database from the session, never taken from the form.
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
    slug: text(formData, 'slug'),
    projectType: text(formData, 'projectType'),
    maxSupply: text(formData, 'maxSupply'),
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
  const { data, error } = await supabase
    .from('collections')
    .insert({
      name: parsed.data.name,
      symbol: parsed.data.symbol,
      slug: parsed.data.slug,
      project_type: parsed.data.projectType,
      max_supply: parsed.data.maxSupply,
    })
    .select('id')
    .single()

  if (error) {
    // 23505 is a unique violation; the only unique column a creator sets is the slug.
    if (error.code === '23505') {
      return { fieldErrors: { slug: 'That address is already taken. Choose another.' } }
    }
    return { formError: 'The collection could not be created. Try again.' }
  }

  redirect(`/collections/${data.id}/art`)
}
