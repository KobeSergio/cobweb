import 'server-only'
import { mediaKeysOf } from '@/lib/mint/media'
import { createServiceClient } from '@/lib/supabase/service'
import { mintPageBucket } from './config'
import { deleteObjects, listObjectPages } from './objects'
import type { SweepDeps } from './sweep'

/**
 * Keys or collections per database read. A read is a GET whose query string names each one: 50 keys of the longest
 * shape make about 6,400 characters, under the API gateway's 8 KB request line, which refuses a longer one with
 * 414 (100 keys made about 12,700).
 */
const CHUNK = 50
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Why a read failed: its Postgres code, or the HTTP status when the gateway refused it with none (a 414). */
const failure = (error: { code?: string }, status: number): string => error.code || `HTTP ${status}`

/**
 * The daily upload sweep's ports (docs/specs/2026-10-17-production-hardening.md, section 14, point 8): the art
 * bucket against `uploads.storage_key`, and the mint-page bucket against the keys each collection's `mint_pages`
 * row names, through the service client. Server only; the cron builds them, with no session.
 */
export function uploadSweepDeps(): { art: SweepDeps; media: SweepDeps } {
  const supabase = createServiceClient()
  const mediaBucket = mintPageBucket()
  return {
    art: {
      list: (prefix) => listObjectPages(prefix),
      async recorded(keys) {
        const found = new Set<string>()
        for (let at = 0; at < keys.length; at += CHUNK) {
          const { data, error, status } = await supabase
            .from('uploads')
            .select('storage_key')
            .in('storage_key', keys.slice(at, at + CHUNK))
          if (error) throw new Error(`The uploads could not be read (${failure(error, status)}).`)
          for (const row of data) found.add(row.storage_key)
        }
        return found
      },
      remove: (keys) => deleteObjects(keys),
    },
    media: {
      list: (prefix) => listObjectPages(prefix, { bucket: mediaBucket }),
      async recorded(keys) {
        // A key's first segment is its collection's id; a key without one is named by no page.
        const collections = [...new Set(keys.map((key) => key.split('/')[0]!))].filter((id) => UUID.test(id))
        const named = new Set<string>()
        for (let at = 0; at < collections.length; at += CHUNK) {
          const { data, error, status } = await supabase
            .from('mint_pages')
            .select('banner_key, avatar_key, about_banner_key, sections')
            .in('collection_id', collections.slice(at, at + CHUNK))
          if (error) throw new Error(`The mint pages could not be read (${failure(error, status)}).`)
          for (const row of data) for (const key of mediaKeysOf(row)) named.add(key)
        }
        return new Set(keys.filter((key) => named.has(key)))
      },
      remove: (keys) => deleteObjects(keys, { bucket: mediaBucket }),
    },
  }
}
