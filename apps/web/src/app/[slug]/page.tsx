import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { MintPage } from '@/components/mint/mint-page'
import { RESERVED_SLUGS } from '@/lib/collections'
import { isDemoMode } from '@/lib/steps'
import { hasSampleCollection, sampleMintPage, sampleVariant } from './sample-data'
import { getMintPageData } from '@/lib/demo'

/*
 * A collection's public mint page, at /<slug>. Public: no session is needed. Until the freshness
 * server exists, only sample mode has a data source; otherwise every slug is not found.
 */

function available(slug: string): boolean {
  return isDemoMode() && !RESERVED_SLUGS.includes(slug) && hasSampleCollection(slug)
}

export async function generateMetadata(props: PageProps<'/[slug]'>): Promise<Metadata> {
  const { slug } = await props.params
  if (!available(slug)) return {}
  const data = getMintPageData(slug, sampleVariant(await props.searchParams), { connected: false })
  const { collection } = data
  const title = `Mint ${collection.name}`
  const description = collection.description
  const image = collection.featured[0]?.imageUrl ?? collection.bannerUrl
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'website',
      images: [{ url: collection.bannerUrl, width: 1500, height: 500, alt: collection.name }],
    },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
  }
}

export default async function Page(props: PageProps<'/[slug]'>) {
  const { slug } = await props.params
  if (!available(slug)) notFound()
  return <MintPage {...sampleMintPage(slug, await props.searchParams)} />
}
