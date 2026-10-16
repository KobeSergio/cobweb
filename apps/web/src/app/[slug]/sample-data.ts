import 'server-only'
import { getAddress } from 'viem'
import { SAMPLE_PLACEHOLDER_URI } from '@/components/mint/sample-source'
import { RESERVED_SLUGS } from '@/lib/collections'
import {
  DEMO_COLLECTION,
  DEMO_DEPLOYMENT,
  DEMO_MINT_GROUPS,
  DEMO_MINT_PAGE_SECTIONS,
  DEMO_MINT_PAGE_SETTINGS,
  getChain,
} from '@/lib/demo'
import type { MintPageSections, MintPageStatic } from '@/lib/mint/page-doc'

/*
 * The sample-mode page's content (docs/specs/2026-10-16-mint-page-live-data.md, section 8), built from the
 * sample collection at any link. The query switches are the browser's: components/mint/sample-source.ts reads
 * them, so the route stays cached by link in sample mode too.
 */

/**
 * In sample mode every creator's mint page link shows the sample collection, so "View mint page"
 * in Manage drop leads somewhere. Reserved words and malformed slugs are still not found.
 */
export function hasSampleCollection(slug: string): boolean {
  if (slug === DEMO_COLLECTION.slug) return true
  return (
    /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) && !RESERVED_SLUGS.includes(slug) && !slug.startsWith('no-such')
  )
}

/** The sample's sections as the page shows them: those that are on and have content. */
function sampleSections(): MintPageSections {
  const { team, roadmap, faq, music, carousel } = DEMO_MINT_PAGE_SECTIONS
  const sections: MintPageSections = {}
  if (team.enabled && team.members.length)
    sections.team = team.members.map(({ imageUrl, ...member }) => ({ ...member, imageUrl: imageUrl || null }))
  if (roadmap.enabled && roadmap.items.length) sections.roadmap = roadmap.items
  if (faq.enabled && faq.items.length) sections.faq = faq.items
  if (music.enabled && music.url && music.fileName)
    sections.music = { url: music.url, fileName: music.fileName }
  if (carousel.enabled && carousel.items.length) sections.carousel = carousel.items
  return sections
}

/** The sample collection's page at any link. */
export function samplePageStatic(slug: string): MintPageStatic {
  const settings = DEMO_MINT_PAGE_SETTINGS
  return {
    slug,
    name: DEMO_COLLECTION.name,
    symbol: DEMO_COLLECTION.symbol,
    projectType: 'generative',
    chain: getChain(DEMO_DEPLOYMENT.chainId)!,
    contract: getAddress(DEMO_DEPLOYMENT.contractAddress),
    description: settings.description,
    bannerUrl: settings.bannerUrl,
    avatarUrl: settings.avatarUrl,
    aboutBannerUrl: null,
    socials: settings.socials,
    featuredTokenIds: settings.featuredTokenIds,
    sections: sampleSections(),
    phases: DEMO_MINT_GROUPS.map((group, position) => ({
      onchain_id: group.id,
      name: group.name,
      description: group.description ?? '',
      visible: group.visible !== false,
      position,
    })),
    placeholders: [SAMPLE_PLACEHOLDER_URI],
    gateway: 'https://ipfs.io/ipfs',
  }
}
