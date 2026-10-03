import { redirect } from 'next/navigation'
import { requireOwnedCollection } from '@/lib/auth'
import { nextStage, stageHref } from '@/lib/steps'

/** Opening a collection goes straight to the stage the creator should do next. */
export default async function CollectionIndexPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const collection = await requireOwnedCollection(id)
  redirect(stageHref(collection.id, nextStage(collection.status).slug, collection.project_type))
}
