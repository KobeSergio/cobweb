import type { LockClient } from './lock-collection'
import { readAll } from './read-all'
import type { ArtRows } from './rows'

/**
 * Every art row of a project, read a page at a time under the caller's row-level security. The Art
 * pages (load.ts) and the lock (lock-core.ts) share it, so the lock validates what the screens show.
 */
export async function readArtRows(
  supabase: LockClient,
  collectionId: string,
): Promise<Omit<ArtRows, 'collection'>> {
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
}
