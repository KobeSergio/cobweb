import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { MintPage } from '@/components/mint/mint-page'
import { LazySampleMintPage } from '@/components/mint/sample-page-lazy'
import { RESERVED_SLUGS } from '@/lib/collections'
import type { MintPageStatic } from '@/lib/mint/page-doc'
import { readMintPage } from '@/lib/mint/page-read'
import { isDemoMode } from '@/lib/steps'
import { hasSampleCollection, samplePageStatic } from './sample-data'

/*
 * A collection's public mint page, at /<slug> (docs/specs/2026-10-16-mint-page-live-data.md, section 6.4). Public:
 * no session is needed. The page renders per request, so its scripts carry the response's nonce
 * (docs/specs/2026-10-17-production-hardening.md, decision 9); its content is the published page's document, read
 * through `readMintPage`'s 60 s cache under the link's tag `mint-page:<slug>`, which the Mint page tab's actions
 * expire, so the database still sees one read per link a minute. The chain's state comes from the browser's polls
 * of the freshness server, never from the HTML. Sample mode's switches are read by the browser.
 */

/** The page's content at a link, or null: a reserved word, an unknown or unpublished page, a chain not listed. */
async function pageAt(slug: string): Promise<MintPageStatic | null> {
  if (RESERVED_SLUGS.includes(slug)) return null
  if (isDemoMode()) return hasSampleCollection(slug) ? samplePageStatic(slug) : null
  return readMintPage(slug)
}

export async function generateMetadata(props: PageProps<'/[slug]'>): Promise<Metadata> {
  const { slug } = await props.params
  const page = await pageAt(slug)
  if (!page) return {}
  const title = `Mint ${page.name}`
  const description = page.description.slice(0, 200)
  const images = page.bannerUrl ? [{ url: page.bannerUrl, alt: page.name }] : undefined
  return {
    title,
    description,
    openGraph: { title, description, type: 'website', images },
    twitter: { card: page.bannerUrl ? 'summary_large_image' : 'summary', title, description, images },
  }
}

export default async function Page(props: PageProps<'/[slug]'>) {
  const { slug } = await props.params
  const page = await pageAt(slug)
  if (!page) notFound()
  // The sample page is loaded on its own chunk, so a live visitor never downloads the sample data.
  return isDemoMode() ? <LazySampleMintPage page={page} /> : <MintPage page={page} sample={null} />
}
