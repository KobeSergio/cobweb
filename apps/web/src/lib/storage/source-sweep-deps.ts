import 'server-only'
import { createServiceClient } from '@/lib/supabase/service'
import { deleteObjects, listObjectPages } from './objects'
import type { DueCollection, SourceSweepDeps } from './source-sweep'

/**
 * The source sweep's port (docs/specs/2026-10-17-production-hardening.md, section 7.2): the art bucket through the
 * storage module, and the two service-role functions through the service client. Server only; the daily cron
 * builds it, with no session.
 */
export function sourceSweepDeps(): SourceSweepDeps {
  const supabase = createServiceClient()
  return {
    async due(limit) {
      const { data, error } = await supabase.rpc('collections_sources_due', { p_limit: limit })
      if (error) throw new Error(`The due collections could not be read (${error.code}).`)
      return data as DueCollection[]
    },
    list: (prefix) => listObjectPages(prefix),
    remove: (keys) => deleteObjects(keys),
    async mark(collectionId) {
      const { data, error } = await supabase.rpc('collection_sources_deleted', {
        p_collection_id: collectionId,
      })
      if (error) throw new Error(`The collection could not be marked (${error.code}): ${error.message}`)
      return data === true
    },
  }
}
