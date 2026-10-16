import { tokenUriOf } from '@/lib/manage/settings-view'

/**
 * A token's art on the mint page (docs/specs/2026-10-16-mint-page-live-data.md, section 7.7): the `image` of its
 * metadata, read in the browser through the IPFS gateway at the URI the contract's rule gives. Before the reveal
 * the base URI is the placeholder's, so every token shows the placeholder's image; nothing reads a CID the chain
 * does not point at.
 */

/**
 * How long a metadata read may take: a gateway can need seconds to find a CID, more than a poll's 5 s, and a
 * read stuck past this answers null rather than holding the art.
 */
export const METADATA_TIMEOUT_MS = 10_000

/** A token drawn from its images, bottom first (one for metadata art), and whether it plays as a video. */
export type TokenArt = { layers: string[]; video: boolean }

/** An `ipfs://` URI as the gateway's path (`<gateway>/<cid>/<path>`), an https URL kept, anything else refused. */
export function gatewayUrlOf(uri: string, gateway: string): string | null {
  if (uri.startsWith('ipfs://')) {
    const path = uri.slice('ipfs://'.length).replace(/^ipfs\//, '')
    return path ? `${gateway}/${path}` : null
  }
  return uri.startsWith('https://') ? uri : null
}

/** A token's art from its metadata, or null when the metadata or its image cannot be read in time. */
export async function tokenArtOf(
  baseUri: string,
  id: number,
  gateway: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TokenArt | null> {
  const metadataUrl = gatewayUrlOf(tokenUriOf(baseUri, id), gateway)
  if (!metadataUrl) return null
  try {
    const response = await fetchImpl(metadataUrl, { signal: AbortSignal.timeout(METADATA_TIMEOUT_MS) })
    if (!response.ok) return null
    const metadata = (await response.json()) as { image?: unknown }
    if (typeof metadata.image !== 'string') return null
    const image = gatewayUrlOf(metadata.image, gateway)
    if (!image) return null
    return { layers: [image], video: /\.mp4($|[?#])/i.test(image) }
  } catch {
    return null
  }
}
