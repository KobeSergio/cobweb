import { chainById } from '@cobweb/shared'
import { getAddress, type Address } from 'viem'
import { z } from 'zod'
import { chainView } from '@/lib/chain/chain-view'
import type { Socials, SupportedChain } from '@/lib/demo/types'
import type { PhaseRow } from '@/lib/manage/phases-types'
import { MEMBER_LINK_MAX, MEMBER_LINK_PATTERN } from './links'

/**
 * The public mint page's document (docs/specs/2026-10-16-mint-page-live-data.md, sections 4.1, 4.3 and 6.1),
 * pure: the sections as `mint_pages.sections` stores them (media keys, not URLs) with legacy's limits, the
 * document `public.mint_page` answers, and what the page renders from it, keys turned into URLs. A section the
 * page cannot parse, or whose switch is off, is left off.
 */

/** An item's id, for the editor's order: 1 to 40 of `[a-z0-9-]`. */
const itemId = z.string().regex(/^[a-z0-9-]{1,40}$/)
/** Text of 1 to `max` characters that is not only spaces. */
const required = (max: number) => z.string().max(max).regex(/\S/)
const optional = (max: number) => z.string().max(max)
/** A team member's link: https, up to 40 characters (links.ts, shared with the tab). */
const memberLink = z.string().max(MEMBER_LINK_MAX).regex(MEMBER_LINK_PATTERN)
/** Every item of a list has its own id. */
const distinctIds = (items: readonly { id: string }[]) =>
  new Set(items.map((item) => item.id)).size === items.length

export type StoredMember = {
  id: string
  name: string
  role: string
  bio: string
  /** A team photo's key in the mint-page bucket, or null for none. */
  imageKey: string | null
  x?: string
  discord?: string
  telegram?: string
}
export type StoredRoadmapItem = { id: string; date: string; title: string; description: string }
export type StoredFaqItem = { id: string; question: string; answer: string }
export type StoredUploadSlide = {
  id: string
  kind: 'upload'
  key: string
  fileName: string
  mediaType: 'image' | 'video'
}
export type StoredTokenSlide = { id: string; kind: 'token'; tokenId: number }
export type StoredSlide = StoredUploadSlide | StoredTokenSlide

/** The five sections as `mint_pages.sections` stores them, each with its switch. */
export type StoredSections = {
  team: { enabled: boolean; members: StoredMember[] }
  roadmap: { enabled: boolean; items: StoredRoadmapItem[] }
  faq: { enabled: boolean; items: StoredFaqItem[] }
  /** One track: its key and file name, both or neither. */
  music: { enabled: boolean; key: string | null; fileName: string | null }
  carousel: { enabled: boolean; items: StoredSlide[] }
}

/** Each section's schema, so the page keeps the sections that parse and leaves the rest off. */
export const SECTION_SCHEMAS: { [K in keyof StoredSections]: z.ZodType<StoredSections[K]> } = {
  team: z.object({
    enabled: z.boolean(),
    members: z
      .array(
        z.object({
          id: itemId,
          name: required(20),
          role: required(20),
          bio: optional(500),
          imageKey: z.string().nullable(),
          x: memberLink.optional(),
          discord: memberLink.optional(),
          telegram: memberLink.optional(),
        }),
      )
      .max(12)
      .refine(distinctIds),
  }),
  roadmap: z.object({
    enabled: z.boolean(),
    items: z
      .array(z.object({ id: itemId, date: required(20), title: required(20), description: optional(500) }))
      .max(12)
      .refine(distinctIds),
  }),
  faq: z.object({
    enabled: z.boolean(),
    items: z
      .array(z.object({ id: itemId, question: required(40), answer: required(500) }))
      .max(20)
      .refine(distinctIds),
  }),
  music: z
    .object({ enabled: z.boolean(), key: z.string().nullable(), fileName: required(100).nullable() })
    .refine((music) => (music.key === null) === (music.fileName === null)),
  carousel: z.object({
    enabled: z.boolean(),
    items: z
      .array(
        z.discriminatedUnion('kind', [
          z
            .object({
              id: itemId,
              kind: z.literal('upload'),
              key: z.string(),
              fileName: required(100),
              mediaType: z.enum(['image', 'video']),
            })
            .refine((slide) => (slide.mediaType === 'video') === slide.key.endsWith('.mp4')),
          z.object({ id: itemId, kind: z.literal('token'), tokenId: z.number().int().min(1) }),
        ]),
      )
      .max(5)
      .refine(distinctIds),
  }),
}

/** The sections a save writes: all five, each within its limits. The save also checks every key is the collection's. */
export const sectionsSchema: z.ZodType<StoredSections> = z.object(SECTION_SCHEMAS)

/** The sections a row holds before its first save. */
export function emptySections(): StoredSections {
  return {
    team: { enabled: false, members: [] },
    roadmap: { enabled: false, items: [] },
    faq: { enabled: false, items: [] },
    music: { enabled: false, key: null, fileName: null },
    carousel: { enabled: false, items: [] },
  }
}

/** A stored value read section by section: a section that does not parse reads as empty. */
export function storedSectionsOf(raw: unknown): StoredSections {
  const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const empty = emptySections()
  const read = <K extends keyof StoredSections>(key: K): StoredSections[K] => {
    const parsed = SECTION_SCHEMAS[key].safeParse(value[key])
    return parsed.success ? parsed.data : empty[key]
  }
  return {
    team: read('team'),
    roadmap: read('roadmap'),
    faq: read('faq'),
    music: read('music'),
    carousel: read('carousel'),
  }
}

/** `public.mint_page`'s document (section 4.3). */
export type PageDoc = {
  slug: string
  name: string
  symbol: string
  projectType: 'generative' | 'one_of_one' | 'single_asset'
  chainId: number
  /** Lowercase, as stored. */
  contract: string
  /** The page's, else the collection's. */
  description: string
  media: { banner: string | null; avatar: string | null; aboutBanner: string | null }
  socials: { website: string | null; x: string | null; discord: string | null; telegram: string | null }
  featuredTokenIds: number[]
  /** As saved, `{}` without a row; parsed section by section. */
  sections: unknown
  phases: { id: number; name: string; description: string; visible: boolean; position: number | null }[]
  /** The placeholder base URIs: none of them is the real job's. */
  placeholders: string[]
  published: boolean
}

const nullableText = z.string().nullable()

export const pageDocSchema: z.ZodType<PageDoc> = z.object({
  slug: z.string(),
  name: z.string(),
  symbol: z.string(),
  projectType: z.enum(['generative', 'one_of_one', 'single_asset']),
  chainId: z.number().int(),
  contract: z.string().regex(/^0x[0-9a-f]{40}$/),
  description: z.string(),
  media: z.object({ banner: nullableText, avatar: nullableText, aboutBanner: nullableText }),
  socials: z.object({
    website: nullableText,
    x: nullableText,
    discord: nullableText,
    telegram: nullableText,
  }),
  featuredTokenIds: z.array(z.number().int()),
  sections: z.unknown(),
  phases: z.array(
    z.object({
      id: z.number().int(),
      name: z.string(),
      description: z.string(),
      visible: z.boolean(),
      position: z.number().int().nullable(),
    }),
  ),
  placeholders: z.array(z.string()),
  published: z.boolean(),
})

/** A team member on the page: the photo as a URL, or null for the artwork pattern. */
export type PageMember = Omit<StoredMember, 'imageKey'> & { imageUrl: string | null }
export type PageSlide = (Omit<StoredUploadSlide, 'key'> & { url: string }) | StoredTokenSlide

/** The sections the page shows: each one present is on and has content. */
export type MintPageSections = {
  team?: PageMember[]
  roadmap?: StoredRoadmapItem[]
  faq?: StoredFaqItem[]
  music?: { url: string; fileName: string }
  carousel?: PageSlide[]
}

/** What the page renders that is not chain state, read on the server and cached by its tag. */
export type MintPageStatic = {
  slug: string
  name: string
  symbol: string
  projectType: PageDoc['projectType']
  chain: SupportedChain
  contract: Address
  description: string
  bannerUrl: string | null
  avatarUrl: string | null
  aboutBannerUrl: string | null
  socials: Socials
  featuredTokenIds: number[]
  sections: MintPageSections
  phases: PhaseRow[]
  placeholders: string[]
  /** The IPFS gateway token art is read through. */
  gateway: string
}

/** The sections that are on and have content, keys turned into URLs. */
export function pageSectionsOf(raw: unknown, media: (key: string) => string): MintPageSections {
  const stored = storedSectionsOf(raw)
  const sections: MintPageSections = {}
  if (stored.team.enabled && stored.team.members.length)
    sections.team = stored.team.members.map(({ imageKey, ...member }) => ({
      ...member,
      imageUrl: imageKey === null ? null : media(imageKey),
    }))
  if (stored.roadmap.enabled && stored.roadmap.items.length) sections.roadmap = stored.roadmap.items
  if (stored.faq.enabled && stored.faq.items.length) sections.faq = stored.faq.items
  if (stored.music.enabled && stored.music.key !== null && stored.music.fileName !== null)
    sections.music = { url: media(stored.music.key), fileName: stored.music.fileName }
  if (stored.carousel.enabled && stored.carousel.items.length)
    sections.carousel = stored.carousel.items.map((slide) => {
      if (slide.kind === 'token') return slide
      const { key, ...rest } = slide
      return { ...rest, url: media(key) }
    })
  return sections
}

/** The links that are set, for the page's buttons. */
function socialsOf(socials: PageDoc['socials']): Socials {
  return Object.fromEntries(Object.entries(socials).filter(([, value]) => value)) as Socials
}

/**
 * What the page renders from a document, or null for a chain this build does not list. Keys become URLs
 * through `urls.media`; the gateway is passed on for token art.
 */
export function pageStaticOf(
  doc: PageDoc,
  urls: { media(key: string): string; gateway: string },
): MintPageStatic | null {
  if (!chainById(doc.chainId)) return null
  const url = (key: string | null) => (key === null ? null : urls.media(key))
  return {
    slug: doc.slug,
    name: doc.name,
    symbol: doc.symbol,
    projectType: doc.projectType,
    chain: chainView(doc.chainId),
    contract: getAddress(doc.contract),
    description: doc.description,
    bannerUrl: url(doc.media.banner),
    avatarUrl: url(doc.media.avatar),
    aboutBannerUrl: url(doc.media.aboutBanner),
    socials: socialsOf(doc.socials),
    featuredTokenIds: doc.featuredTokenIds,
    sections: pageSectionsOf(doc.sections, urls.media),
    phases: doc.phases.map((phase) => ({
      onchain_id: phase.id,
      name: phase.name,
      description: phase.description,
      visible: phase.visible,
      position: phase.position,
    })),
    placeholders: doc.placeholders,
    gateway: urls.gateway,
  }
}
