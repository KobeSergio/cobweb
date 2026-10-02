'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { useAccount } from 'wagmi'
import { createClient } from '@/lib/supabase/client'

/**
 * Ends the session when the wallet in the browser stops matching the wallet that signed in:
 * either it was disconnected, or the creator switched accounts. Without this, the dashboard would
 * show one wallet's collections while transactions were sent from another.
 */
export function SessionGuard({ sessionAddress }: { sessionAddress: string }) {
  const router = useRouter()
  const { address, status } = useAccount()
  const signingOut = useRef(false)
  // On a fresh page load the wallet reports 'disconnected' until it starts reconnecting, so that
  // first 'disconnected' means nothing. Only one seen after the wallet has been active is real.
  const walletSettled = useRef(false)

  const [, recheck] = useState(0)

  // If the wallet never even tries to reconnect (no wallet in this browser), stop waiting.
  useEffect(() => {
    const timer = setTimeout(() => {
      walletSettled.current = true
      recheck((count) => count + 1)
    }, 4000)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (status !== 'disconnected') walletSettled.current = true

    const mismatch =
      (status === 'disconnected' && walletSettled.current) ||
      (status === 'connected' && address?.toLowerCase() !== sessionAddress)
    if (!mismatch || signingOut.current) return

    signingOut.current = true
    createClient()
      // This browser only. Signing out everywhere would log the creator out of their other devices.
      .auth.signOut({ scope: 'local' })
      .finally(() => {
        router.replace('/')
        router.refresh()
      })
  }, [address, status, sessionAddress, router])

  return null
}
