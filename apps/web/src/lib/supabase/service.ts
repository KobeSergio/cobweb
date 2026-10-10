import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'

/**
 * The service-role client, server only. Used by exactly three calls, `art_lock`, `art_requote` and
 * `art_record_payment` (lib/art/lock-core.ts), whose arguments come from the chain or a verified
 * receipt; `lockWrite` hands it out only after the session and ownership checks. Never use it for a
 * read or a write a creator's session can do. No session is kept.
 */
export function createServiceClient(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set.')
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set.')
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}
