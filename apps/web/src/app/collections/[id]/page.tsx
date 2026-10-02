import { redirect } from 'next/navigation'
import { requireOwnedCollection } from '@/lib/auth'
import { nextStep } from '@/lib/steps'

/** Opening a collection goes straight to the step the creator should do next. */
export default async function CollectionIndexPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const collection = await requireOwnedCollection(id)
  redirect(`/collections/${collection.id}/${nextStep(collection.status).slug}`)
}
