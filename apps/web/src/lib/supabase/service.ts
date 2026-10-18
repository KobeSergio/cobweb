import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'

/**
 * The service-role client, server only; no session is kept. Never use it for a read or a write a creator's session
 * can do. Its callers:
 * - `lockWrite`, `deployWrite` and `phasesWrite` (lib/art/lock-write.ts, lib/deploy/deploy-write.ts and
 *   lib/manage/phases-write.ts) hand it out only after the session and ownership checks, for the functions whose
 *   arguments come from the chain, a verified receipt or the server's own chain read, each called with the verified
 *   user's id as `p_owner`: `art_lock`, `art_requote` and `art_record_payment` (lib/art/lock-core.ts);
 *   `collection_record_deploy` (lib/deploy/deploy-core.ts); and `mint_group_record`, `mint_groups_refresh`,
 *   `whitelist_chunk_record`, `airdrop_record`, `settings_refresh`, `withdrawal_record` and `token_ranks_record`
 *   (the cores under lib/manage and lib/mint/ranks-core.ts);
 * - `confirmUpload` (app/actions/uploads.ts) calls `record_upload` with it for the owner it checked, with the size it
 *   read from storage;
 * - the daily source sweep's port (lib/storage/source-sweep-deps.ts) calls `collections_sources_due` and
 *   `collection_sources_deleted` with it, for no creator (docs/specs/2026-10-17-production-hardening.md,
 *   section 7.2);
 * - the daily upload sweep's port (lib/storage/upload-sweep-deps.ts) reads which keys are recorded or saved.
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
