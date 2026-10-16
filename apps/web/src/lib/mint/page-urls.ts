import { mintPageBucket } from '@/lib/storage/config'

/**
 * Where the public page's files are read (docs/specs/2026-10-16-mint-page-live-data.md, sections 6.1 and 7.7),
 * and the tag its cached document is kept under. Server only (the storage config carries the marker); free of
 * Next's modules, so the settings core and verify:mint-page use it outside a request. page-read.ts re-exports it.
 */

/** The tag the Mint page tab's actions expire on save. */
export const mintPageTag = (slug: string) => `mint-page:${slug}`

const trimSlash = (url: string) => url.replace(/\/+$/, '')

/** The public base of the mint-page bucket: `MINT_PAGE_MEDIA_URL`, else Supabase Storage's public URL for it. */
export function mediaBase(): string {
  const base = process.env.MINT_PAGE_MEDIA_URL
  if (base) return trimSlash(base)
  return `${trimSlash(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')}/storage/v1/object/public/${mintPageBucket()}`
}

/** An object's public URL. */
export const mediaUrl = (key: string) => `${mediaBase()}/${key}`

/** The IPFS gateway token art is read through: `IPFS_GATEWAY_URL`, else https://ipfs.io/ipfs. */
export function ipfsGateway(): string {
  return trimSlash(process.env.IPFS_GATEWAY_URL || 'https://ipfs.io/ipfs')
}
