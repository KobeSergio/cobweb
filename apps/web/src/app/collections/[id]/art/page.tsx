import { redirect } from 'next/navigation'
import { requireOwnedCollection } from '@/lib/auth'
import { stageHref } from '@/lib/steps'

/** The Art stage opens on its first sub-step for the project type. */
export default async function ArtIndexPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const collection = await requireOwnedCollection(id)
  redirect(stageHref(collection.id, 'art', collection.project_type))
}
