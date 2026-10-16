import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { MintPage } from '@/components/mint/mint-page'
import { PreviewBanner } from '@/components/mint/preview-banner'
import { SampleMintPage } from '@/components/mint/sample-page'
import { RESERVED_SLUGS } from '@/lib/collections'
import { readMintPagePreview } from '@/lib/mint/page-read'
import { isDemoMode, manageTabHref } from '@/lib/steps'
import { hasSampleCollection, samplePageStatic } from '../sample-data'

/*
 * The owner's preview of a mint page, at /<slug>/preview (docs/specs/2026-10-16-mint-page-live-data.md,
 * decision 6): the same page for the signed-in owner of the deployed collection with that link, published or
 * not, under a banner saying who can see it. Anyone else gets the not-found page. Never cached, never indexed.
 */
export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Mint page preview', robots: { index: false, follow: false } }

export default async function Page(props: PageProps<'/[slug]/preview'>) {
  const { slug } = await props.params
  if (RESERVED_SLUGS.includes(slug)) notFound()
  if (isDemoMode()) {
    if (!hasSampleCollection(slug)) notFound()
    return (
      <>
        <PreviewBanner published tabHref="/collections" />
        <SampleMintPage page={samplePageStatic(slug)} />
      </>
    )
  }
  const preview = await readMintPagePreview(slug)
  if (!preview) notFound()
  const { published, collectionId, ...page } = preview
  return (
    <>
      <PreviewBanner published={published} tabHref={manageTabHref(collectionId, 'mint-page')} />
      <MintPage page={page} sample={null} />
    </>
  )
}
