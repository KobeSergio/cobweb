'use client'

import { useQuery } from '@tanstack/react-query'
import { useCallback, useRef } from 'react'
import type { Address } from 'viem'
import { RETRY_MAX_MS } from '@/lib/mint/fresh-client'
import { walletViewOf, type WalletView } from '@/lib/mint/live-data'
import type { MintSource } from '@/lib/mint/live-source'
import type { MintPageStatic } from '@/lib/mint/page-doc'

/** A wallet answer to try again, after its `Retry-After`. */
class WalletRetry extends Error {
  constructor(readonly afterMs: number) {
    super('retry')
  }
}

/**
 * The connected wallet's answer (docs/specs/2026-10-16-mint-page-live-data.md, decision 14): read when a wallet
 * connects or changes account or chain, on return to the tab, when a phase turns live (`liveKey`), after each of
 * this wallet's mints and from "Check again" (`refresh`); never on a timer. A failed read is tried again after
 * its `Retry-After`, doubling up to 8 s, and the answer is kept meanwhile for the same wallet.
 */
export function useWalletView(
  source: MintSource,
  page: MintPageStatic,
  wallet: Address | null,
  liveKey: string,
): { view: WalletView | null; final: boolean; refresh(): void } {
  const holder = wallet?.toLowerCase() ?? null
  const query = useQuery({
    queryKey: ['mint-wallet', page.chain.id, page.contract.toLowerCase(), holder, liveKey],
    enabled: wallet !== null,
    queryFn: async (): Promise<WalletView | 'final'> => {
      const poll = await source.pollWallet(wallet!)
      if (poll.kind === 'retry') throw new WalletRetry(poll.afterMs)
      return poll.kind === 'body' ? walletViewOf(poll.body) : 'final'
    },
    retry: (_count, error) => error instanceof WalletRetry,
    retryDelay: (attempt, error) =>
      Math.min(RETRY_MAX_MS, (error instanceof WalletRetry ? error.afterMs : 1_000) * 2 ** attempt),
    // The last answer stays while the same wallet is read again; another wallet starts from nothing.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[3] === holder ? previous : undefined,
    refetchOnWindowFocus: true,
    staleTime: 0,
  })
  const refetch = useRef(query.refetch)
  refetch.current = query.refetch
  const refresh = useCallback(() => void refetch.current(), [])
  const data = wallet === null ? undefined : query.data
  return {
    view: data && data !== 'final' && data.address.toLowerCase() === holder ? data : null,
    final: data === 'final',
    refresh,
  }
}
