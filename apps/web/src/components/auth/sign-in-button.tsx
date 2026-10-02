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

function truncate(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

/**
 * Two steps, one button: connect a wallet, then sign a message to prove it is yours. The signed
 * message is verified by Supabase, which starts the session. Signing costs nothing and sends no
 * transaction.
 */
export function SignInButton() {
  const router = useRouter()
  const { address, chainId, isConnected, isConnecting } = useAccount()
  const { openConnectModal } = useConnectModal()
  const { signMessageAsync } = useSignMessage()
  const { disconnect } = useDisconnect()
  const [signingIn, setSigningIn] = useState(false)

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

      const { error } = await createClient().auth.signInWithWeb3({ chain: 'ethereum', message, signature })
      if (error) throw error

      router.replace('/collections')
      router.refresh()
    } catch (error) {
      const rejected = error instanceof Error && /reject|denied/i.test(error.message)
      toast.error(rejected ? 'Signature request cancelled.' : 'Sign-in failed. Try again.')
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

  return (
    <div className="flex w-full flex-col items-center gap-3">
      <Button size="lg" className="w-full" onClick={signIn} disabled={signingIn}>
        {signingIn && <Spinner />}
        {signingIn ? 'Check your wallet…' : `Sign in as ${truncate(address)}`}
      </Button>
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
