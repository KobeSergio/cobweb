import { timingSafeEqual } from 'node:crypto'
import type { Env } from '@cobweb/shared'

/**
 * The web app's environment as the worker reads it. The app keeps its Supabase URL under
 * NEXT_PUBLIC_SUPABASE_URL; the worker reads SUPABASE_URL.
 */
export function workerEnv(env: Env): Env {
  return { ...env, SUPABASE_URL: env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL }
}

/**
 * True when a cron request carries `Authorization: Bearer <CRON_SECRET>`, compared in constant time.
 * False for everything when the secret is not set, so a project without one never runs the sweep.
 */
export function cronAuthorized(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false
  const want = Buffer.from(`Bearer ${secret}`)
  const got = Buffer.from(header)
  return got.length === want.length && timingSafeEqual(got, want)
}
