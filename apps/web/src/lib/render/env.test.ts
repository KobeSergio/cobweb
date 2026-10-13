import { describe, expect, it } from 'vitest'
import { cronAuthorized, workerEnv } from './env'

describe('workerEnv', () => {
  it('passes the public Supabase URL to the worker as SUPABASE_URL when that is not set', () => {
    const env = workerEnv({ NEXT_PUBLIC_SUPABASE_URL: 'https://p.supabase.co', OTHER: 'x' })
    expect(env.SUPABASE_URL).toBe('https://p.supabase.co')
    expect(env.OTHER).toBe('x')
  })

  it('keeps SUPABASE_URL when it is set', () => {
    const env = workerEnv({ SUPABASE_URL: 'https://a.supabase.co', NEXT_PUBLIC_SUPABASE_URL: 'https://b' })
    expect(env.SUPABASE_URL).toBe('https://a.supabase.co')
  })
})

describe('cronAuthorized', () => {
  const SECRET = 'cron-secret-value'

  it('accepts exactly Bearer and the secret', () => {
    expect(cronAuthorized(`Bearer ${SECRET}`, SECRET)).toBe(true)
  })

  it('refuses no header, another secret, another scheme and a longer value', () => {
    expect(cronAuthorized(null, SECRET)).toBe(false)
    expect(cronAuthorized('Bearer other-secret-value', SECRET)).toBe(false)
    expect(cronAuthorized(`Basic ${SECRET}`, SECRET)).toBe(false)
    expect(cronAuthorized(`Bearer ${SECRET}x`, SECRET)).toBe(false)
  })

  it('refuses everything when the secret is not set', () => {
    expect(cronAuthorized('Bearer ', undefined)).toBe(false)
    expect(cronAuthorized('Bearer ', '')).toBe(false)
  })
})
