'use client'

import { useQueries } from '@tanstack/react-query'
import type { MintSource } from '@/lib/mint/live-source'
import type { TokenArt } from '@/lib/mint/token-art'

/**
 * Token art for some ids at a base URI (docs/specs/2026-10-16-mint-page-live-data.md, section 7.2), each kept for
 * the page's life: IPFS content does not change. Undefined while a token is read; null when it cannot be.
 */
export function useTokenArt(
  source: MintSource,
  baseUri: string | null,
  ids: readonly number[],
): Map<number, TokenArt | null | undefined> {
  const results = useQueries({
    queries: ids.map((id) => ({
      queryKey: ['token-art', baseUri, id],
      queryFn: () => source.tokenArt(baseUri ?? '', id),
      enabled: baseUri !== null && baseUri !== '',
      staleTime: Infinity,
      gcTime: Infinity,
      retry: false,
    })),
  })
  return new Map(ids.map((id, index) => [id, results[index]?.data]))
}
