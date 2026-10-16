import type { Socials } from '@/lib/demo/types'
import type { MediaSlot } from '@/lib/mint/media'
import type {
  StoredFaqItem,
  StoredMember,
  StoredRoadmapItem,
  StoredSections,
  StoredTokenSlide,
} from '@/lib/mint/page-doc'
import type { MediaAsk, MintPageInput, MintPageSettingsView } from '@/lib/mint/settings-core'

/**
 * The Mint page tab's draft (docs/specs/2026-10-16-mint-page-live-data.md, section 7.9), pure: the row's fields and
 * the sections in one value, each file either stored (its key and URL) or picked in this browser and kept there
 * until Save. A save uploads the picked files, then sends the draft with every file as its key.
 */

/** A file of the draft: stored in the bucket, or picked and not uploaded yet. */
export type DraftFile =
  | { kind: 'stored'; key: string; url: string }
  | { kind: 'picked'; file: File; url: string; width: number | null; height: number | null }

export type DraftMember = Omit<StoredMember, 'imageKey'> & { image: DraftFile | null }
export type DraftUploadSlide = {
  id: string
  kind: 'upload'
  fileName: string
  mediaType: 'image' | 'video'
  media: DraftFile
}
export type DraftSlide = DraftUploadSlide | StoredTokenSlide
export type DraftSections = {
  team: { enabled: boolean; members: DraftMember[] }
  roadmap: { enabled: boolean; items: StoredRoadmapItem[] }
  faq: { enabled: boolean; items: StoredFaqItem[] }
  music: { enabled: boolean; track: DraftFile | null; fileName: string | null }
  carousel: { enabled: boolean; items: DraftSlide[] }
}
export type MintPageDraft = {
  published: boolean
  description: string
  media: Record<'banner' | 'avatar' | 'about', DraftFile | null>
  socials: Socials
  featuredTokenIds: number[]
  sections: DraftSections
}

const stored = (key: string | null, url: string | null): DraftFile | null =>
  key !== null && url !== null ? { kind: 'stored', key, url } : null

/** The draft of a saved view. */
export function draftOf(view: MintPageSettingsView): MintPageDraft {
  const { team, roadmap, faq, music, carousel } = view.sections
  return {
    published: view.published,
    description: view.description,
    media: {
      banner: view.media.banner && stored(view.media.banner.key, view.media.banner.url),
      avatar: view.media.avatar && stored(view.media.avatar.key, view.media.avatar.url),
      about: view.media.about && stored(view.media.about.key, view.media.about.url),
    },
    socials: view.socials,
    featuredTokenIds: view.featuredTokenIds,
    sections: {
      team: {
        enabled: team.enabled,
        members: team.members.map(({ imageKey, imageUrl, ...member }) => ({
          ...member,
          image: stored(imageKey, imageUrl),
        })),
      },
      roadmap,
      faq,
      music: { enabled: music.enabled, track: stored(music.key, music.url), fileName: music.fileName },
      carousel: {
        enabled: carousel.enabled,
        items: carousel.items.map((slide) =>
          slide.kind === 'token'
            ? slide
            : {
                id: slide.id,
                kind: 'upload',
                fileName: slide.fileName,
                mediaType: slide.mediaType,
                media: { kind: 'stored', key: slide.key, url: slide.url },
              },
        ),
      },
    },
  }
}

/** Every picked file of the draft with its slot, each once: what a save must upload first. */
export function pickedFiles(draft: MintPageDraft): {
  slot: MediaSlot
  file: File
  width: number | null
  height: number | null
}[] {
  const found = new Map<File, { slot: MediaSlot; file: File; width: number | null; height: number | null }>()
  const add = (media: DraftFile | null, slot: MediaSlot) => {
    if (media?.kind === 'picked' && !found.has(media.file))
      found.set(media.file, { slot, file: media.file, width: media.width, height: media.height })
  }
  add(draft.media.banner, 'banner')
  add(draft.media.avatar, 'avatar')
  add(draft.media.about, 'about')
  for (const member of draft.sections.team.members) add(member.image, 'team')
  for (const slide of draft.sections.carousel.items) if (slide.kind === 'upload') add(slide.media, 'slide')
  add(draft.sections.music.track, 'music')
  return [...found.values()]
}

/** What the browser asks the server to sign for a picked file, with its content hash. */
export function mediaAskOf(
  entry: { slot: MediaSlot; file: File; width: number | null; height: number | null },
  contentHash: string,
): MediaAsk {
  return {
    slot: entry.slot,
    mime: entry.file.type,
    bytes: entry.file.size,
    width: entry.width,
    height: entry.height,
    contentHash,
  }
}

/** The save's input: every file as its key, a picked one as the key its upload was given. Empty links are left out. */
export function inputOf(draft: MintPageDraft, keys: ReadonlyMap<File, string>): MintPageInput {
  const keyOf = (media: DraftFile | null): string | null => {
    if (!media) return null
    if (media.kind === 'stored') return media.key
    const key = keys.get(media.file)
    if (!key) throw new Error('A picked file has no key: upload it first.')
    return key
  }
  const link = (value: string | undefined) => value?.trim() || null
  const memberLink = (value: string | undefined) => (value?.trim() ? value.trim() : undefined)
  const { team, roadmap, faq, music, carousel } = draft.sections
  const sections: StoredSections = {
    team: {
      enabled: team.enabled,
      members: team.members.map(({ image, x, discord, telegram, ...member }) => ({
        ...member,
        imageKey: keyOf(image),
        ...(memberLink(x) ? { x: memberLink(x) } : {}),
        ...(memberLink(discord) ? { discord: memberLink(discord) } : {}),
        ...(memberLink(telegram) ? { telegram: memberLink(telegram) } : {}),
      })),
    },
    roadmap,
    faq,
    music: { enabled: music.enabled, key: keyOf(music.track), fileName: music.track ? music.fileName : null },
    carousel: {
      enabled: carousel.enabled,
      items: carousel.items.map((slide) =>
        slide.kind === 'token'
          ? slide
          : {
              id: slide.id,
              kind: 'upload',
              key: keyOf(slide.media)!,
              fileName: slide.fileName,
              mediaType: slide.mediaType,
            },
      ),
    },
  }
  return {
    published: draft.published,
    description: draft.description,
    media: {
      banner: keyOf(draft.media.banner),
      avatar: keyOf(draft.media.avatar),
      about: keyOf(draft.media.about),
    },
    socials: {
      website: link(draft.socials.website),
      x: link(draft.socials.x),
      discord: link(draft.socials.discord),
      telegram: link(draft.socials.telegram),
    },
    featuredTokenIds: draft.featuredTokenIds,
    sections,
  }
}

/** The page's links, each with the hosts the database's checks allow. */
export const SOCIAL_FIELDS: { key: keyof Socials; label: string; placeholder: string; hosts: string[] }[] = [
  { key: 'website', label: 'Website', placeholder: 'https://', hosts: [] },
  { key: 'x', label: 'X', placeholder: 'https://x.com/yourname', hosts: ['x.com', 'twitter.com'] },
  {
    key: 'discord',
    label: 'Discord invite',
    placeholder: 'https://discord.gg/invite',
    hosts: ['discord.gg', 'discord.com'],
  },
  {
    key: 'telegram',
    label: 'Telegram',
    placeholder: 'https://t.me/yourgroup',
    hosts: ['t.me', 'telegram.me'],
  },
]

/** Longest link accepted, as in legacy. */
export const LINK_MAX = 200

/** Why a page link is not usable, or null. Empty is fine: the icon is left off the page. */
export function socialError(value: string | undefined, hosts: string[]): string | null {
  const text = value?.trim()
  if (!text) return null
  if (text.length > LINK_MAX) return `Use a link of at most ${LINK_MAX} characters.`
  try {
    const url = new URL(text)
    if (url.protocol !== 'https:') return 'Use a link that starts with https://.'
    const host = url.hostname.replace(/^www\./, '')
    if (hosts.length > 0 && !hosts.includes(host)) return `Use a ${hosts[0]} link.`
    if (hosts.length > 0 && url.pathname.length < 2) return `Use a ${hosts[0]} link with its path.`
    return null
  } catch {
    return 'Enter a full link, starting with https://.'
  }
}

/** Whether the draft cannot be saved yet: a field over its limit, a link the page would not take, a blank required text. */
export function draftInvalid(draft: MintPageDraft): boolean {
  if (draft.description.length > 2000) return true
  if (SOCIAL_FIELDS.some((field) => socialError(draft.socials[field.key], field.hosts))) return true
  const blank = (text: string) => !text.trim()
  const badLink = (value: string | undefined) => !!value?.trim() && !/^https:\/\/\S+$/.test(value.trim())
  const { team, roadmap, faq } = draft.sections
  return (
    team.members.some(
      (member) =>
        blank(member.name) ||
        blank(member.role) ||
        badLink(member.x) ||
        badLink(member.discord) ||
        badLink(member.telegram),
    ) ||
    roadmap.items.some((item) => blank(item.date) || blank(item.title)) ||
    faq.items.some((item) => blank(item.question) || blank(item.answer))
  )
}
