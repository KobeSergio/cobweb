'use server'

import { revalidatePath, updateTag } from 'next/cache'
import { z } from 'zod'
import { fail, PAGE_FIELDS, UNSAVED, type ActionResult } from '@/lib/art/result'
import { parse } from '@/lib/art/schemas'
import { phasesWrite } from '@/lib/manage/phases-write'
import { mintPageTag } from '@/lib/mint/page-urls'
import {
  mediaAsksSchema,
  mintPageInputSchema,
  mintPageSettingsCore,
  presignMintPageMediaCore,
  saveMintPageCore,
  setMintPagePublishedCore,
  type MediaAsk,
  type MintPageInput,
  type MintPageSettingsView,
} from '@/lib/mint/settings-core'

/**
 * The Mint page tab's server actions (docs/specs/2026-10-16-mint-page-live-data.md, section 6.2). Each checks
 * its input first, then runs through `phasesWrite`, which checks the session and the ownership (CLAUDE.md rule
 * 4). A save or a switch that lands expires the page's cached document, so the public page shows it on its next
 * visit, and the workspace's pages.
 */

/** Expires the public page's tag and the workspace's pages after a write. */
function expire(slug: string | null): void {
  if (slug) updateTag(mintPageTag(slug))
  revalidatePath('/collections/[id]', 'layout')
}

/** The tab's row with its media, sections and the art it can feature. */
export async function getMintPageSettings(collectionId: string): Promise<ActionResult<MintPageSettingsView>> {
  return phasesWrite(collectionId, (ctx) => mintPageSettingsCore(ctx))
}

/** The PUT URLs for the files a save needs, each checked against its slot first. */
export async function presignMintPageMedia(
  collectionId: string,
  asks: MediaAsk[],
): Promise<ActionResult<{ key: string; putUrl: string | null }[]>> {
  const input = parse(mediaAsksSchema, asks)
  if (!input.ok) return input
  return phasesWrite(collectionId, (ctx) => presignMintPageMediaCore(ctx, input.data))
}

/** Saves the whole draft once its files are uploaded, then answers the saved view. */
export async function saveMintPage(
  collectionId: string,
  input: MintPageInput,
): Promise<ActionResult<MintPageSettingsView>> {
  const draft = mintPageInputSchema.safeParse(input)
  if (!draft.success) return fail(PAGE_FIELDS)
  let slug: string | null = null
  const result = await phasesWrite(collectionId, (ctx) => {
    slug = ctx.collection.slug
    return saveMintPageCore(ctx, draft.data)
  })
  if (result.ok) expire(slug)
  return result
}

/** The Overview's public switch. */
export async function setMintPagePublished(
  collectionId: string,
  published: boolean,
): Promise<ActionResult<{ published: boolean }>> {
  const value = parse(z.boolean({ error: UNSAVED }), published)
  if (!value.ok) return value
  let slug: string | null = null
  const result = await phasesWrite(collectionId, (ctx) => {
    slug = ctx.collection.slug
    return setMintPagePublishedCore(ctx, value.data)
  })
  if (result.ok) expire(slug)
  return result
}
