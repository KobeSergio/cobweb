'use server'

import { cache } from 'react'
import { manageRecordError } from '@/lib/art/db-error'
import { txHash as txHashSchema } from '@/lib/art/lock-schemas'
import type { ActionResult } from '@/lib/art/result'
import { parse } from '@/lib/art/schemas'
import {
  airdropRecipientsAllCore,
  airdropRecipientsCore,
  airdropViewCore,
  confirmAirdropCore,
  readAirdropState,
} from '@/lib/manage/airdrop-core'
import type { AirdropView, RecipientPage, RecipientRow } from '@/lib/manage/airdrop-types'
import { phasesWrite } from '@/lib/manage/phases-write'

/**
 * Airdrop's server actions (docs/specs/2026-10-15-airdrop-settings.md, section 6.5). Each checks its input first,
 * then runs through `phasesWrite`, which checks the session and the ownership (CLAUDE.md rule 4), with the record
 * functions' sentences for a database refusal. The browser sends only a batch's hash: the server proves the batch
 * from its receipt and calldata and records what the chain says.
 */

/** One chain read per request, however many times a page asks (React's cache). */
const readOnce = cache(readAirdropState)

/** The contract's fee, supply and owner, with Cobweb's records of the batches it confirmed. */
export async function getAirdrop(collectionId: string): Promise<ActionResult<AirdropView>> {
  return phasesWrite(collectionId, (ctx) => airdropViewCore(ctx, readOnce), manageRecordError)
}

/** Confirms a batch or a burn from its receipt and calldata, records it, then answers the fresh view. */
export async function confirmAirdrop(
  collectionId: string,
  txHash: string,
): Promise<ActionResult<AirdropView>> {
  const hash = parse(txHashSchema, txHash)
  if (!hash.ok) return hash
  return phasesWrite(collectionId, (ctx) => confirmAirdropCore(ctx, hash.data), manageRecordError)
}

/**
 * One page of By recipient (docs/specs/2026-10-16-indexer-overview.md, section 7.3): 25 wallets an airdrop
 * reached, newest first, searched by any part of the address. The core reads the query; a query it cannot read
 * is refused.
 */
export async function getAirdropRecipients(
  collectionId: string,
  query: { search: string; page: number },
): Promise<ActionResult<RecipientPage>> {
  return phasesWrite(collectionId, (ctx) => airdropRecipientsCore(ctx, query), manageRecordError)
}

/** Every row of By recipient, for "Export CSV", which the browser builds from them. */
export async function exportAirdropRecipients(collectionId: string): Promise<ActionResult<RecipientRow[]>> {
  return phasesWrite(collectionId, airdropRecipientsAllCore, manageRecordError)
}
