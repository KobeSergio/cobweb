import 'server-only'
import { cache } from 'react'
import type { ArtProject } from '@/components/art/state/art-store'
import type { Tables } from '@/lib/database.types'
import type { UploadedAsset } from '@/lib/demo'
import { createClient } from '@/lib/supabase/server'
import { readAll } from './read-all'
import { toAssets, toProject, type ArtRows } from './rows'

/** Every art row of a project, read under row-level security as the signed-in creator; once per request. */
const artRows = cache(async (collectionId: string): Promise<Omit<ArtRows, 'collection'>> => {
  const supabase = await createClient()
  const [artCollections, layers, traits, rules, atLeastOne, tokens] = await Promise.all([
    readAll((from, to) =>
      supabase
        .from('art_collections')
        .select('id, name, size, position')
        .eq('collection_id', collectionId)
        .order('position')
        .range(from, to),
    ),
    readAll((from, to) =>
      supabase
        .from('layers')
        .select('id, art_collection_id, name, display_name, position, bypass_dna')
        .eq('collection_id', collectionId)
        .order('id')
        .range(from, to),
    ),
    readAll((from, to) =>
      supabase
        .from('traits')
        .select('id, layer_id, name, weight, constant, blank, in_metadata, upload_id, position')
        .eq('collection_id', collectionId)
        .order('id')
        .range(from, to),
    ),
    readAll((from, to) =>
      supabase
        .from('rules')
        .select('id, kind, trait_id, related_trait_ids, bidirectional')
        .eq('collection_id', collectionId)
        .order('id')
        .range(from, to),
    ),
    readAll((from, to) =>
      supabase
        .from('at_least_one')
        .select('id, art_collection_id, trait_ids')
        .eq('collection_id', collectionId)
        .order('id')
        .range(from, to),
    ),
    readAll((from, to) =>
      supabase
        .from('tokens')
        .select('token_id, art_collection_id, dna, description')
        .eq('collection_id', collectionId)
        .order('token_id')
        .range(from, to),
    ),
  ])
  return { artCollections, layers, traits, rules, atLeastOne, tokens }
})

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
