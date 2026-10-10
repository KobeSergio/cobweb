import 'server-only'
import { cache } from 'react'
import type { ArtProject } from '@/components/art/state/art-store'
import type { Tables } from '@/lib/database.types'
import type { UploadedAsset } from '@/lib/demo'
import { createClient } from '@/lib/supabase/server'
import { latestPlaceholder } from './lock-core'
import { readAll } from './read-all'
import { readArtRows } from './read-rows'
import type { JobPlaceholder } from './render-job'
import { toAssets, toProject } from './rows'

/** Every art row of a project, read under row-level security as the signed-in creator; once per request. */
const artRows = cache(async (collectionId: string) => readArtRows(await createClient(), collectionId))

/** A generative project's art as the Art screens' store holds it. */
export async function loadArtProject(collection: Tables<'collections'>): Promise<ArtProject> {
  return toProject({ collection, ...(await artRows(collection.id)) })
}

/** A 1/1 or single asset project's files, in their saved order. */
export async function loadAssets(collectionId: string): Promise<UploadedAsset[]> {
  const supabase = await createClient()
  const rows = await readAll((from, to) =>
    supabase
      .from('uploads')
      .select('id, file_name, media_type, quantity, attributes, position, created_at')
      .eq('collection_id', collectionId)
      .eq('kind', 'asset')
      .order('position', { nullsFirst: false })
      .order('created_at')
      .order('id')
      .range(from, to),
  )
  return toAssets(rows)
}

/** The collection's latest placeholder file, for Lock and upload before anything is locked; once per request. */
export const loadPlaceholder = cache(async (collectionId: string): Promise<JobPlaceholder> =>
  latestPlaceholder(await createClient(), collectionId),
)
