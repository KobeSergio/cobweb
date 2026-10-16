'use client'

import { useQueries } from '@tanstack/react-query'
import type { MintSource } from '@/lib/mint/live-source'
import type { TokenArt } from '@/lib/mint/token-art'

/**
 * Token art for some ids at a base URI (docs/specs/2026-10-16-mint-page-live-data.md, section 7.2), each kept for
 * the page's life: IPFS content does not change. Undefined while a token is read or the state has not answered;
 * null when it cannot be read, as with an empty base URI.
 */
export function useTokenArt(
  source: Pick<MintSource, 'tokenArt'>,
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
  // An empty base URI points at no metadata: each token shows the pattern, not a well that never fills.
  return new Map(ids.map((id, index) => [id, baseUri === '' ? null : results[index]?.data]))
}
