'use client'

import { useQueries } from '@tanstack/react-query'
import type { MintSource } from '@/lib/mint/live-source'
import type { TokenArt } from '@/lib/mint/token-art'

/** How many times a failed art read is tried again before the token shows the pattern. */
export const ART_RETRIES = 2

/**
 * Token art for some ids at a base URI (docs/specs/2026-10-16-mint-page-live-data.md, section 7.2), each kept for
 * the page's life once read: IPFS content does not change. A read that throws is tried ART_RETRIES more times, 1 s
 * then 2 s apart, then shows the pattern, and is read again on the next focus or mount (a failed query holds no
 * data, so it reads as stale). Undefined while a token is read or the state has not answered; null when there is
 * no art to show, as with an empty base URI or metadata without an image, or once the retries failed.
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
      retry: ART_RETRIES,
      retryDelay: (attempt: number) => 1_000 * 2 ** attempt,
    })),
  })
  // An empty base URI points at no metadata, and a read that failed has none yet: each token shows the pattern,
  // not a well that never fills.
  return new Map(
    ids.map((id, index) => {
      const result = results[index]
      return [id, baseUri === '' || result?.isError ? null : result?.data]
    }),
  )
}
