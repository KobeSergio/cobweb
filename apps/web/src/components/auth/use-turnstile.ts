'use client'

import { useCallback, useEffect, useRef, useState, type RefCallback } from 'react'
import { loadTurnstile, type TurnstileApi } from '@/lib/turnstile'

/**
 * The browser check on the sign-in button (docs/specs/2026-10-17-production-hardening.md, section 6.1). With a site
 * key it renders Turnstile's widget into its container and keeps the latest token, read through `token()` when the
 * signature returns, since a token can refresh while the wallet is open; `ready` while one is held, `failed` once
 * the check errs or its script cannot load; `reset()` asks for a new token. Without a site key it renders nothing
 * and is ready.
 */
export function useTurnstile(siteKey: string | null): {
  container: RefCallback<HTMLDivElement>
  token(): string | null
  ready: boolean
  failed: boolean
  reset(): void
} {
  const [element, setElement] = useState<HTMLDivElement | null>(null)
  const [held, setHeld] = useState(false)
  const [failed, setFailed] = useState(false)
  const latest = useRef<string | null>(null)
  const widget = useRef<{ api: TurnstileApi; id: string } | null>(null)

  useEffect(() => {
    if (!siteKey || !element) return
    let gone = false
    loadTurnstile().then(
      (api) => {
        if (gone) return
        const id = api.render(element, {
          sitekey: siteKey,
          action: 'sign-in',
          appearance: 'interaction-only',
          size: 'flexible',
          theme: 'dark',
          'refresh-expired': 'auto',
          callback: (token: string) => {
            latest.current = token
            setHeld(true)
            setFailed(false)
          },
          'expired-callback': () => {
            latest.current = null
            setHeld(false)
          },
          'error-callback': () => {
            latest.current = null
            setHeld(false)
            setFailed(true)
          },
        })
        widget.current = { api, id }
      },
      () => {
        if (!gone) setFailed(true)
      },
    )
    return () => {
      gone = true
      latest.current = null
      if (widget.current) widget.current.api.remove(widget.current.id)
      widget.current = null
    }
  }, [siteKey, element])

  const token = useCallback(() => latest.current, [])
  const reset = useCallback(() => {
    if (!widget.current) return
    latest.current = null
    setHeld(false)
    widget.current.api.reset(widget.current.id)
  }, [])

  return { container: setElement, token, ready: siteKey === null || held, failed, reset }
}
