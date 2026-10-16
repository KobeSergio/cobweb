import { z } from 'zod'
import type { DbError } from '@/lib/art/db-error'
import { errorSummary } from '@/lib/art/lock-core'
import {
  NOT_DEPLOYED,
  PAGE_CHANGED_ELSEWHERE,
  PAGE_FIELDS,
  PAGE_FILE_MISMATCH,
  PAGE_FILE_MISSING,
  PAGE_LINK_FIRST,
  PAGE_NOT_PUBLIC,
  UNSAVED,
} from '@/lib/art/result'
import type { Tables, TablesUpdate } from '@/lib/database.types'
import { doneJobRow, type DeployOutcome } from '@/lib/deploy/deploy-core'
import type { Socials } from '@/lib/demo/types'
import type { PhasesContext } from '@/lib/manage/phases-core'
import { mintPageBucket } from '@/lib/storage/config'
import { deleteObjects, headObject, presignPut } from '@/lib/storage/objects'
import { PAGE_LINK_MAX, PAGE_LINK_PATTERNS } from './links'
import {
  keyBelongs,
  MEDIA_SLOTS,
  mimeOfKey,
  mintPageKey,
  mintPageMediaProblem,
  type MediaSlot,
} from './media'
import {
  sectionsSchema,
  storedSectionsOf,
  type MintPageStatic,
  type StoredMember,
  type StoredSections,
  type StoredTokenSlide,
  type StoredUploadSlide,
} from './page-doc'
import { mediaUrl } from './page-urls'
import { ensureTokenRanksCore } from './ranks-core'

/**
 * The Mint page tab on the server (docs/specs/2026-10-16-mint-page-live-data.md, section 6.2): the tab's view
 * of the `mint_pages` row, the presigned PUTs a save needs on the mint-page bucket, the save of the whole draft
 * and the Overview's public switch, on a Supabase client acting as the signed-in creator. The actions
 * (app/actions/mint-page.ts) call these after the session and ownership check; verify:mint-page calls them
 * with a signed-in script client. No `server-only` marker, so the script can import it; the browser imports
 * its types only.
 */

/** A file the browser asks to upload: its slot, its facts and its SHA-256. */
export type MediaAsk = {
  slot: MediaSlot
  mime: string
  bytes: number
  width: number | null
  height: number | null
  contentHash: string
}

/** A stored file as the tab edits it: its key and where it reads. */
export type MediaRef = { key: string; url: string }

/** The sections as the tab edits them: keys and URLs side by side. */
export type EditableMember = StoredMember & { imageUrl: string | null }
export type EditableSlide = (StoredUploadSlide & { url: string }) | StoredTokenSlide
export type EditableSections = {
  team: { enabled: boolean; members: EditableMember[] }
  roadmap: StoredSections['roadmap']
  faq: StoredSections['faq']
  music: StoredSections['music'] & { url: string | null }
  carousel: { enabled: boolean; items: EditableSlide[] }
}

/** What the Mint page tab shows and saves. `art` tells it which tokens it can feature and where their metadata is. */
export type MintPageSettingsView = {
  published: boolean
  description: string
  media: Record<'banner' | 'avatar' | 'about', MediaRef | null>
  socials: Socials
  featuredTokenIds: number[]
  sections: EditableSections
  art: { realBaseUri: string | null; supply: number; projectType: MintPageStatic['projectType'] }
  /** The row's `updated_at` as read (the guard stamps it on every write); null without a row. */
  updatedAt: string | null
}

/** The row's editable fields as a save sends them: keys, not URLs. */
export type MintPageInput = {
  published: boolean
  description: string
  media: Record<'banner' | 'avatar' | 'about', string | null>
  socials: { website: string | null; x: string | null; discord: string | null; telegram: string | null }
  featuredTokenIds: number[]
  sections: StoredSections
  /** The `updatedAt` of the view the draft was made from: a save lands only on the row as that view read it. */
  updatedAt: string | null
}

/** The most files one save can name: three page images, twelve team photos, five slides and the music. */
export const MEDIA_ASKS_MAX = 21

/**
 * The asks a presign takes. The tab only sends files `mintPageMediaProblem` passed (an empty one among them is
 * refused when picked), so anything else is a client that skipped it: every field reads UNSAVED, never zod's English.
 */
export const mediaAsksSchema: z.ZodType<MediaAsk[]> = z
  .array(
    z.object(
      {
        slot: z.enum(['banner', 'avatar', 'about', 'team', 'slide', 'music'], { error: UNSAVED }),
        mime: z.string({ error: UNSAVED }).max(64),
        bytes: z.number({ error: UNSAVED }).int().min(1),
        width: z.number({ error: UNSAVED }).int().min(1).nullable(),
        height: z.number({ error: UNSAVED }).int().min(1).nullable(),
        contentHash: z.string({ error: UNSAVED }).regex(/^[0-9a-f]{64}$/),
      },
      { error: UNSAVED },
    ),
    { error: UNSAVED },
  )
  .min(1, UNSAVED)
  .max(MEDIA_ASKS_MAX, UNSAVED)

/** A page link: https, up to 200 characters, on the hosts the database's checks name (links.ts, shared with the tab). */
const pageLink = (pattern: RegExp) => z.string().max(PAGE_LINK_MAX).regex(pattern).nullable()

export const mintPageInputSchema: z.ZodType<MintPageInput> = z.object({
  published: z.boolean(),
  description: z.string().max(2000),
  media: z.object({
    banner: z.string().nullable(),
    avatar: z.string().nullable(),
    about: z.string().nullable(),
  }),
  socials: z.object({
    website: pageLink(PAGE_LINK_PATTERNS.website),
    x: pageLink(PAGE_LINK_PATTERNS.x),
    discord: pageLink(PAGE_LINK_PATTERNS.discord),
    telegram: pageLink(PAGE_LINK_PATTERNS.telegram),
  }),
  featuredTokenIds: z
    .array(z.number().int().min(1))
    .max(6)
    .refine((ids) => new Set(ids).size === ids.length),
  sections: sectionsSchema,
  updatedAt: z.string().max(64).nullable(),
})

const ROW_COLUMNS =
  'published, description, banner_key, avatar_key, about_banner_key, website_url, x_url, discord_url, telegram_url, featured_token_ids, sections, updated_at'
type PageRow = Pick<
  Tables<'mint_pages'>,
  | 'published'
  | 'description'
  | 'banner_key'
  | 'avatar_key'
  | 'about_banner_key'
  | 'website_url'
  | 'x_url'
  | 'discord_url'
  | 'telegram_url'
  | 'featured_token_ids'
  | 'sections'
  | 'updated_at'
>

/** The sections with each stored key's URL beside it. */
export function editableSectionsOf(stored: StoredSections, url: (key: string) => string): EditableSections {
  return {
    team: {
      enabled: stored.team.enabled,
      members: stored.team.members.map((member) => ({
        ...member,
        imageUrl: member.imageKey === null ? null : url(member.imageKey),
      })),
    },
    roadmap: stored.roadmap,
    faq: stored.faq,
    music: { ...stored.music, url: stored.music.key === null ? null : url(stored.music.key) },
    carousel: {
      enabled: stored.carousel.enabled,
      items: stored.carousel.items.map((slide) =>
        slide.kind === 'token' ? slide : { ...slide, url: url(slide.key) },
      ),
    },
  }
}

/** Every media key a row, or a save, names, with its slot. */
function keysOf(fields: {
  banner: string | null
  avatar: string | null
  about: string | null
  sections: StoredSections
}): { key: string; slot: MediaSlot }[] {
  const keys: { key: string; slot: MediaSlot }[] = []
  const add = (key: string | null, slot: MediaSlot) => {
    if (key !== null) keys.push({ key, slot })
  }
  add(fields.banner, 'banner')
  add(fields.avatar, 'avatar')
  add(fields.about, 'about')
  for (const member of fields.sections.team.members) add(member.imageKey, 'team')
  for (const slide of fields.sections.carousel.items) if (slide.kind === 'upload') add(slide.key, 'slide')
  add(fields.sections.music.key, 'music')
  return keys
}

const rowKeys = (row: PageRow) =>
  keysOf({
    banner: row.banner_key,
    avatar: row.avatar_key,
    about: row.about_banner_key,
    sections: storedSectionsOf(row.sections),
  })

/** Whether the collection has a deployment, under the creator's client: every core needs one. */
async function deployed(ctx: PhasesContext): Promise<boolean> {
  const { data, error } = await ctx.supabase
    .from('deployments')
    .select('collection_id')
    .eq('collection_id', ctx.collection.id)
    .maybeSingle()
  if (error) throw new Error(`The deployment could not be read: ${error.message}`)
  return data !== null
}

async function readRow(ctx: PhasesContext): Promise<PageRow | null> {
  const { data, error } = await ctx.supabase
    .from('mint_pages')
    .select(ROW_COLUMNS)
    .eq('collection_id', ctx.collection.id)
    .maybeSingle()
  if (error) throw new Error(`The mint page could not be read: ${error.message}`)
  return data
}

/** The art the tab features from: the latest done real job's base URI, which only the owner's tab receives. */
async function artOf(ctx: PhasesContext): Promise<MintPageSettingsView['art']> {
  const real = await doneJobRow(ctx.supabase, ctx.collection.id, 'real')
  return {
    realBaseUri: real?.base_uri ?? null,
    supply: ctx.collection.max_supply ?? 0,
    projectType: ctx.collection.project_type,
  }
}

/**
 * The tab's view of a row, read nothing more: a save reads its art before the write, so once the row is written
 * nothing can throw before the action answers it and expires the page's tag.
 */
function viewOf(row: PageRow | null, art: MintPageSettingsView['art']): MintPageSettingsView {
  const ref = (key: string | null): MediaRef | null => (key === null ? null : { key, url: mediaUrl(key) })
  const socials: Socials = {}
  if (row?.website_url) socials.website = row.website_url
  if (row?.x_url) socials.x = row.x_url
  if (row?.discord_url) socials.discord = row.discord_url
  if (row?.telegram_url) socials.telegram = row.telegram_url
  return {
    published: row?.published ?? false,
    description: row?.description ?? '',
    media: {
      banner: ref(row?.banner_key ?? null),
      avatar: ref(row?.avatar_key ?? null),
      about: ref(row?.about_banner_key ?? null),
    },
    socials,
    featuredTokenIds: row?.featured_token_ids ?? [],
    sections: editableSectionsOf(storedSectionsOf(row?.sections), mediaUrl),
    art,
    updatedAt: row?.updated_at ?? null,
  }
}

/** A refused write in the creator's words: the trigger's own sentence, else a check's; anything else is an error. */
function refusalOf(error: NonNullable<DbError>): { refused: string } | { error: DbError } {
  if (error.code === '23514')
    return { refused: error.message === PAGE_NOT_PUBLIC ? PAGE_NOT_PUBLIC : PAGE_FIELDS }
  return { error }
}

/** A write of the row: the row as written, a refusal in the creator's words, or the database's error. */
type Written = { row: PageRow } | { refused: string } | { error: NonNullable<DbError> }

/**
 * Writes the row's fields: an insert that does nothing when the row exists, then the update, so the owner never
 * needs a right on `collection_id` beyond the insert's. A save passes the row it read (`old`, null without one):
 * its update lands only while `updated_at` holds that row's stamp, or without one the stamp of the row its own
 * insert made, so a write from another tab or the Overview's switch since the read is refused as
 * PAGE_CHANGED_ELSEWHERE rather than reverted. The switch passes no row and writes its one column, which the
 * guard stamps, so a tab that read the row before it is refused.
 */
async function writeRow(
  ctx: PhasesContext,
  fields: TablesUpdate<'mint_pages'>,
  read?: { old: PageRow | null },
): Promise<Written> {
  const ensured = await ctx.supabase
    .from('mint_pages')
    .upsert({ collection_id: ctx.collection.id }, { onConflict: 'collection_id', ignoreDuplicates: true })
    .select('updated_at')
  if (ensured.error) return { error: ensured.error }
  // Without a row read, the save's insert must be the one that made it: none means another write made it since.
  const stamp = read ? (read.old?.updated_at ?? ensured.data[0]?.updated_at ?? null) : undefined
  if (stamp === null) return { refused: PAGE_CHANGED_ELSEWHERE }
  const update = ctx.supabase.from('mint_pages').update(fields).eq('collection_id', ctx.collection.id)
  const saved = await (stamp === undefined ? update : update.eq('updated_at', stamp))
    .select(ROW_COLUMNS)
    .maybeSingle()
  if (saved.error) return { error: saved.error }
  if (saved.data) return { row: saved.data }
  // No row matched: its stamp moved after the read (the owner's row exists, and the ownership was checked).
  return { refused: read ? PAGE_CHANGED_ELSEWHERE : PAGE_FIELDS }
}

/** Records the ranks for a published page; a failure is logged and never fails the save. */
async function rank(ctx: PhasesContext): Promise<void> {
  try {
    await ensureTokenRanksCore(ctx)
  } catch (error) {
    console.error(`The ranks of ${ctx.collection.id} could not be recorded: ${errorSummary(error)}`)
  }
}

/** The tab's view: the row (the defaults without one), its keys with their URLs and the art the tab features from. */
export async function mintPageSettingsCore(ctx: PhasesContext): Promise<DeployOutcome<MintPageSettingsView>> {
  if (!(await deployed(ctx))) return { refused: NOT_DEPLOYED }
  const [row, art] = await Promise.all([readRow(ctx), artOf(ctx)])
  return { data: viewOf(row, art) }
}

/**
 * The PUT URLs a save needs, one per file: each file refused in its slot's words; an object already stored at its
 * key answering no URL, since a key names its bytes and an object is never written twice (spec section 4.4), and
 * refused as PAGE_FILE_MISMATCH when its length or type is not the file's; else a URL on the mint-page bucket bound
 * to the type and the length, valid 15 minutes.
 */
export async function presignMintPageMediaCore(
  ctx: PhasesContext,
  asks: MediaAsk[],
): Promise<DeployOutcome<{ key: string; putUrl: string | null }[]>> {
  if (!(await deployed(ctx))) return { refused: NOT_DEPLOYED }
  for (const ask of asks) {
    const problem = mintPageMediaProblem(ask.slot, ask)
    if (problem) return { refused: problem }
  }
  const bucket = mintPageBucket()
  const found = await Promise.all(
    asks.map(async (ask) => {
      const key = mintPageKey(ctx.collection.id, ask.contentHash, ask.mime)
      return { ask, key, head: await headObject(key, { bucket }) }
    }),
  )
  if (found.some(({ ask, head }) => head && (head.bytes !== ask.bytes || head.mime !== ask.mime)))
    return { refused: PAGE_FILE_MISMATCH }
  const signed = await Promise.all(
    found.map(async ({ ask, key, head }) => ({
      key,
      putUrl: head ? null : await presignPut(key, ask.mime, ask.bytes, 900, { bucket }),
    })),
  )
  return { data: signed }
}

/** Whether a stored object is of its slot's types, matches its key's extension and is within the slot's cap. */
function fits(slot: MediaSlot, key: string, head: { bytes: number; mime: string | null }): boolean {
  const rule = MEDIA_SLOTS[slot]
  if (head.mime === null || head.mime !== mimeOfKey(key) || !rule.types.includes(head.mime)) return false
  return head.bytes <= (rule.maxBytes[head.mime] ?? 0)
}

/**
 * Saves the whole draft (the action parsed it with `mintPageInputSchema`): featured tokens and token slides
 * within the supply, every key the collection's, the row unchanged since the draft's view read it (else
 * PAGE_CHANGED_ELSEWHERE, so a stale tab never reverts another save or the Overview's switch, nor deletes the
 * media they keep), each key the stored row does not name in the same slot already uploaded within that slot's
 * cap (a key moved to another slot is checked against the new one's), then the row; then the objects the old row
 * named and the new one does not are deleted, and a published page has its ranks recorded (both logged on
 * failure, never the save's). The art is read before the write, so a write that lands always answers its view.
 */
export async function saveMintPageCore(
  ctx: PhasesContext,
  input: MintPageInput,
): Promise<DeployOutcome<MintPageSettingsView>> {
  if (!(await deployed(ctx))) return { refused: NOT_DEPLOYED }
  const { collection } = ctx
  const supply = collection.max_supply ?? 0
  const tokenSlides = input.sections.carousel.items.flatMap((slide) =>
    slide.kind === 'token' ? [slide.tokenId] : [],
  )
  if ([...input.featuredTokenIds, ...tokenSlides].some((id) => id > supply)) return { refused: PAGE_FIELDS }
  if (input.published && !collection.slug) return { refused: PAGE_LINK_FIRST }
  const keys = keysOf({ ...input.media, sections: input.sections })
  if (keys.some(({ key, slot }) => !keyBelongs(collection.id, key, slot))) return { refused: PAGE_FIELDS }
  const old = await readRow(ctx)
  if ((old?.updated_at ?? null) !== input.updatedAt) return { refused: PAGE_CHANGED_ELSEWHERE }
  const storedKeys = old ? rowKeys(old) : []
  const inSlot = new Set(storedKeys.map(({ key, slot }) => `${slot} ${key}`))
  const bucket = mintPageBucket()
  for (const { key, slot } of keys) {
    if (inSlot.has(`${slot} ${key}`)) continue
    const head = await headObject(key, { bucket })
    if (!head || !fits(slot, key, head)) return { refused: PAGE_FILE_MISSING }
  }
  const art = await artOf(ctx)
  const saved = await writeRow(
    ctx,
    {
      published: input.published,
      description: input.description,
      banner_key: input.media.banner,
      avatar_key: input.media.avatar,
      about_banner_key: input.media.about,
      website_url: input.socials.website,
      x_url: input.socials.x,
      discord_url: input.socials.discord,
      telegram_url: input.socials.telegram,
      featured_token_ids: input.featuredTokenIds,
      sections: input.sections,
    },
    { old },
  )
  if ('refused' in saved) return saved
  if ('error' in saved) return refusalOf(saved.error)
  const { row } = saved
  const kept = new Set(keys.map(({ key }) => key))
  const replaced = [...new Set(storedKeys.map(({ key }) => key))].filter((key) => !kept.has(key))
  try {
    await deleteObjects(replaced, { bucket })
  } catch (error) {
    console.error(`The replaced media of ${collection.id} could not be deleted: ${errorSummary(error)}`)
  }
  if (row.published) await rank(ctx)
  return { data: viewOf(row, art) }
}

/** The Overview's public switch: a page goes public only with a link, and the trigger checks the deployment again. */
export async function setMintPagePublishedCore(
  ctx: PhasesContext,
  published: boolean,
): Promise<DeployOutcome<{ published: boolean }>> {
  if (!(await deployed(ctx))) return { refused: NOT_DEPLOYED }
  if (published && !ctx.collection.slug) return { refused: PAGE_LINK_FIRST }
  const saved = await writeRow(ctx, { published })
  if ('refused' in saved) return saved
  // The trigger's sentence reads as it is; any other check's reads as the fields' sentence, never raw.
  if ('error' in saved) return refusalOf(saved.error)
  if (published) await rank(ctx)
  return { data: { published } }
}
