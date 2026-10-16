import type { Socials } from '@/lib/demo/types'
import { MEMBER_LINK_MAX, MEMBER_LINK_PATTERN, PAGE_LINK_MAX, PAGE_LINK_PATTERNS } from '@/lib/mint/links'
import { MEDIA_SLOTS, mintPageMediaProblem, type MediaSlot } from '@/lib/mint/media'
import type {
  StoredFaqItem,
  StoredMember,
  StoredRoadmapItem,
  StoredSections,
  StoredTokenSlide,
} from '@/lib/mint/page-doc'
import type { MediaAsk, MintPageInput, MintPageSettingsView } from '@/lib/mint/settings-core'
import type { FileFacts } from '@/lib/storage/admission'

/**
 * The Mint page tab's draft (docs/specs/2026-10-16-mint-page-live-data.md, section 7.9), pure: the row's fields and
 * the sections in one value, each file either stored (its key and URL) or picked in this browser and kept there
 * until Save. A save uploads the picked files, then sends the draft with every file as its key. The checks here are
 * the save's own (the link patterns, the slots' rules, the section counts), so the tab never offers what it refuses.
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
  /** The saved row's stamp the draft was made from, sent back with the save (settings-core.ts). */
  updatedAt: string | null
}
/** A picked file with its slot: what a save hashes, signs and uploads. */
export type PickedEntry = { slot: MediaSlot; file: File; width: number | null; height: number | null }

/**
 * Legacy's limits for each section (docs/specs/2026-10-16-mint-page-live-data.md, section 4.1), as the save's schema
 * checks them (page-doc.ts): each text's length, and how many members, milestones, questions and slides it holds.
 */
export const LIMITS = {
  name: 20,
  role: 20,
  handle: MEMBER_LINK_MAX,
  text: 500,
  date: 20,
  title: 20,
  question: 40,
  members: 12,
  milestones: 12,
  questions: 20,
  slides: 5,
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
    updatedAt: view.updatedAt,
  }
}

/**
 * The sections with a team member's photo set, or removed with null. A picked photo lands once the browser
 * has read the file, so it applies to the sections as they are by then: an edit made meanwhile stays, and a
 * member removed meanwhile stays removed.
 */
export function withMemberImage(
  sections: DraftSections,
  memberId: string,
  image: DraftFile | null,
): DraftSections {
  const { team } = sections
  if (!team.members.some((member) => member.id === memberId)) return sections
  return {
    ...sections,
    team: {
      ...team,
      members: team.members.map((member) => (member.id === memberId ? { ...member, image } : member)),
    },
  }
}

/**
 * The sections with an uploaded slide added after the others, as they are once its file has been read. A
 * carousel filled meanwhile goes over its count, which `draftInvalid` refuses until a slide is removed.
 */
export function withUploadSlide(sections: DraftSections, slide: DraftUploadSlide): DraftSections {
  const { carousel } = sections
  return { ...sections, carousel: { ...carousel, items: [...carousel.items, slide] } }
}

/**
 * The draft with its sections updated, or the same draft when the update changes nothing, such as a photo
 * that lands for a member removed meanwhile: a save in flight then still finds the draft it sent.
 */
export function updateSections(
  draft: MintPageDraft,
  update: (current: DraftSections) => DraftSections,
): MintPageDraft {
  const sections = update(draft.sections)
  return sections === draft.sections ? draft : { ...draft, sections }
}

/** Every file of the draft with its slot, in the page's order: the three page images, the team, the slides, the track. */
function filesOf(draft: MintPageDraft): { slot: MediaSlot; media: DraftFile }[] {
  const { team, carousel, music } = draft.sections
  const files: { slot: MediaSlot; media: DraftFile | null }[] = [
    { slot: 'banner', media: draft.media.banner },
    { slot: 'avatar', media: draft.media.avatar },
    { slot: 'about', media: draft.media.about },
    ...team.members.map((member) => ({ slot: 'team' as const, media: member.image })),
    ...carousel.items.flatMap((slide) =>
      slide.kind === 'upload' ? [{ slot: 'slide' as const, media: slide.media }] : [],
    ),
    { slot: 'music', media: music.track },
  ]
  return files.flatMap(({ slot, media }) => (media ? [{ slot, media }] : []))
}

/** Every picked file of the draft with its slot, each once: what a save must upload first. */
export function pickedFiles(draft: MintPageDraft): PickedEntry[] {
  const found = new Map<File, PickedEntry>()
  for (const { slot, media } of filesOf(draft))
    if (media.kind === 'picked' && !found.has(media.file))
      found.set(media.file, { slot, file: media.file, width: media.width, height: media.height })
  return [...found.values()]
}

/** The object URLs of the draft's picked files: the tab keeps each while a draft shows it, then revokes it. */
export function pickedUrls(draft: MintPageDraft): string[] {
  return filesOf(draft).flatMap(({ media }) => (media.kind === 'picked' ? [media.url] : []))
}

/**
 * The tracked object URLs to revoke: those neither the draft nor the saved draft shows. The tab tracks each
 * picked file's URL from the moment its pick lands, so one the draft never took, such as a photo for a member
 * removed while it was read, is revoked as well.
 */
export function urlsToRevoke(
  tracked: Iterable<string>,
  draft: MintPageDraft,
  saved: MintPageDraft,
): string[] {
  const shown = new Set([...pickedUrls(draft), ...pickedUrls(saved)])
  return [...tracked].filter((url) => !shown.has(url))
}

/** What the browser asks the server to sign for a picked file, with its content hash. */
export function mediaAskOf(entry: PickedEntry, contentHash: string): MediaAsk {
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
    updatedAt: draft.updatedAt,
  }
}

/** The page's links, each with the hosts its pattern names (links.ts); a field's message names the first. */
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

/** Longest page link accepted, as in legacy. */
export const LINK_MAX = PAGE_LINK_MAX

/**
 * What to change in a link its pattern refused, for the field's message. The pattern decides; this names the
 * likeliest fix: the scheme, a space, the host (the first of `hosts`), a port or the host's case, or the path
 * after it.
 */
function linkHint(text: string, hosts: readonly string[]): string {
  if (!text.startsWith('https://'))
    return /^[a-z][a-z\d+.-]*:/i.test(text)
      ? 'Use a link that starts with https://.'
      : 'Enter a full link, starting with https://.'
  if (/\s/.test(text)) return 'Remove the spaces from the link.'
  const authority = text.slice('https://'.length).split(/[/?#]/, 1)[0]!
  const host = authority.replace(/^www\./, '')
  if (hosts.length === 0 || !host) return 'Enter a full link, starting with https://.'
  if (hosts.includes(host)) return `Use a link on ${hosts[0]} with its path.`
  // The patterns take the host in lowercase and without a port, so a host that is one of `hosts` but for
  // those is told that fix, one at a time: the port first, then the case. The case hint names the host as
  // typed, `www.` included, so only it is lowercased: a path, such as a Discord invite code, can be
  // case-sensitive.
  const portless = authority.replace(/:\d*$/, '')
  const lower = portless.toLowerCase()
  if (!hosts.includes(lower.replace(/^www\./, ''))) return `Use a link on ${hosts[0]}.`
  return portless === authority ? `Write ${lower} in lowercase.` : 'Remove the port from the link.'
}

/** Why a page link is not usable, or null. Empty is fine: the icon is left off the page. The save checks the same. */
export function socialError(value: string | undefined, key: keyof Socials): string | null {
  const text = value?.trim()
  if (!text) return null
  if (text.length > PAGE_LINK_MAX) return `Use a link of at most ${PAGE_LINK_MAX} characters.`
  if (PAGE_LINK_PATTERNS[key].test(text)) return null
  return linkHint(text, SOCIAL_FIELDS.find((field) => field.key === key)?.hosts ?? [])
}

/** Why a team member's link is not usable, or null. Empty is fine: the link is left off. The save checks the same. */
export function memberLinkError(value: string | undefined): string | null {
  const text = value?.trim()
  if (!text) return null
  if (text.length > MEMBER_LINK_MAX) return `Use a link of at most ${MEMBER_LINK_MAX} characters.`
  return MEMBER_LINK_PATTERN.test(text) ? null : linkHint(text, [])
}

/** Why a picked image cannot be used when the browser could not draw it. */
export const IMAGE_UNREADABLE = 'The image could not be read. Try another file.'

/**
 * Why a picked file cannot go in its slot, or null: an image of a type the slot takes that the browser could not
 * draw (no width or height read), then the slot's types and caps as the signing action checks them.
 */
export function pickedFileProblem(slot: MediaSlot, file: FileFacts): string | null {
  const image = file.mime.startsWith('image/') && MEDIA_SLOTS[slot].types.includes(file.mime)
  if (image && (!file.width || !file.height)) return IMAGE_UNREADABLE
  return mintPageMediaProblem(slot, file)
}

/**
 * Whether the draft cannot be saved yet: a field over its limit, a section over its count, a link the save would
 * refuse, a blank required text.
 */
export function draftInvalid(draft: MintPageDraft): boolean {
  if (draft.description.length > 2000) return true
  if (SOCIAL_FIELDS.some((field) => socialError(draft.socials[field.key], field.key))) return true
  const { team, roadmap, faq, carousel } = draft.sections
  if (
    team.members.length > LIMITS.members ||
    roadmap.items.length > LIMITS.milestones ||
    faq.items.length > LIMITS.questions ||
    carousel.items.length > LIMITS.slides
  )
    return true
  const blank = (text: string) => !text.trim()
  return (
    team.members.some(
      (member) =>
        blank(member.name) ||
        blank(member.role) ||
        [member.x, member.discord, member.telegram].some((link) => memberLinkError(link) !== null),
    ) ||
    roadmap.items.some((item) => blank(item.date) || blank(item.title)) ||
    faq.items.some((item) => blank(item.question) || blank(item.answer))
  )
}

/**
 * Where the tab draws a token's art from: its metadata once the real job has a base URI, as the pickers'
 * thumbnails do, else the artwork pattern. The tab reads no metadata without a base, nor for a single asset
 * whose tokens share one image, so a token drawn from its metadata then would show an empty well for good.
 */
export function tokenArtSource(
  realBaseUri: string | null,
  projectType: MintPageSettingsView['art']['projectType'],
): 'pattern' | 'metadata' {
  return realBaseUri && projectType !== 'single_asset' ? 'metadata' : 'pattern'
}
