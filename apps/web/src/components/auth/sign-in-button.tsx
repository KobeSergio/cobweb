'use client'

import { useConnectModal } from '@rainbow-me/rainbowkit'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { getAddress } from 'viem'
import { createSiweMessage, generateSiweNonce } from 'viem/siwe'
import { useAccount, useDisconnect, useSignMessage } from 'wagmi'
import { Button } from '@cobweb/ui/components/button'
import { Spinner } from '@cobweb/ui/components/spinner'
import { createClient } from '@/lib/supabase/client'
import { turnstileSiteKey } from '@/lib/turnstile'
import { signInFailureOf } from './sign-in-failure'
import { useTurnstile } from './use-turnstile'

function truncate(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

/** What each failure says, in the toast (docs/specs/2026-10-17-production-hardening.md, section 9.3). */
const FAILURE_SENTENCE = {
  rejected: 'Signature request cancelled.',
  captcha: 'The browser check did not pass. Try again.',
  other: 'Sign-in failed. Try again.',
} as const

/**
 * Two steps, one button: connect a wallet, then sign a message to prove it is yours. The signed
 * message is verified by Supabase, which starts the session. Signing costs nothing and sends no
 * transaction. With a Turnstile site key, a browser check runs above the button once the wallet is
 * connected, and its token travels with the signature; Supabase Auth verifies it before the signature
 * (docs/specs/2026-10-17-production-hardening.md, section 6.2).
 */
export function SignInButton() {
  const router = useRouter()
  const { address, chainId, isConnected, isConnecting } = useAccount()
  const { openConnectModal } = useConnectModal()
  const { signMessageAsync } = useSignMessage()
  const { disconnect } = useDisconnect()
  const [signingIn, setSigningIn] = useState(false)
  const siteKey = turnstileSiteKey()
  const check = useTurnstile(siteKey)

  async function signIn() {
    if (!address) return
    setSigningIn(true)
    try {
      const issuedAt = new Date()
      const message = createSiweMessage({
        // Always the checksummed form: the auth server treats differently-cased addresses as
        // different identities.
        address: getAddress(address),
        chainId: chainId ?? 1,
        domain: window.location.host,
        uri: window.location.origin,
        nonce: generateSiweNonce(),
        version: '1',
        statement: 'Sign in to Cobweb.',
        issuedAt,
        // The signed message is only useful for a couple of minutes.
        expirationTime: new Date(issuedAt.getTime() + 2 * 60_000),
      })
      const signature = await signMessageAsync({ message })

      // Read when the signature returns: the token can refresh while the wallet is open.
      const captchaToken = check.token()
      const { error } = await createClient().auth.signInWithWeb3({
        chain: 'ethereum',
        message,
        signature,
        ...(captchaToken ? { options: { captchaToken } } : {}),
      })
      if (error) throw error

      router.replace('/collections')
      router.refresh()
    } catch (error) {
      toast.error(FAILURE_SENTENCE[signInFailureOf(error)])
      // Supabase spends a token once it is sent, so the next attempt asks for a new one.
      check.reset()
      setSigningIn(false)
    }
  }

  if (!isConnected || !address) {
    return (
      <Button
        size="lg"
        className="w-full"
        onClick={openConnectModal}
        disabled={isConnecting || !openConnectModal}
      >
        {isConnecting && <Spinner />}
        Connect wallet
      </Button>
    )
  }

  const checking = !check.ready
  return (
    <div className="flex w-full flex-col items-center gap-3">
      {siteKey && <div ref={check.container} className="w-full empty:hidden" />}
      <Button size="lg" className="w-full" onClick={signIn} disabled={signingIn || checking}>
        {(signingIn || (checking && !check.failed)) && <Spinner />}
        {signingIn
          ? 'Check your wallet…'
          : checking
            ? 'Checking your browser…'
            : `Sign in as ${truncate(address)}`}
      </Button>
      {check.failed && (
        <p role="alert" className="text-destructive-foreground text-center text-sm">
          The browser check could not run. Reload the page and try again.
        </p>
      )}
      <button
        type="button"
        onClick={() => disconnect()}
        disabled={signingIn}
        className="text-muted-foreground hover:text-foreground text-sm underline-offset-4 hover:underline"
      >
        Use a different wallet
      </button>
    </div>
  )
}
