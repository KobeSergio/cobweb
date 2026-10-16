'use server'

import { updateTag } from 'next/cache'
import { cache } from 'react'
import { txHash as txHashSchema } from '@/lib/art/lock-schemas'
import type { ActionResult } from '@/lib/art/result'
import { parse } from '@/lib/art/schemas'
import type { DeployOutcome } from '@/lib/deploy/deploy-core'
import { callOf, expectedEvent, PHASE_FUNCTIONS, type SentCall } from '@/lib/manage/phase-calls'
import {
  directionShape,
  onchainIdShape,
  parseSentCall,
  phaseAddShape,
  phaseDetailsShape,
  visibleShape,
} from '@/lib/manage/phase-schemas'
import {
  confirmPhaseTxCore,
  movePhaseCore,
  phasesViewCore,
  readCollectionState,
  renamePhaseCore,
  setPhaseVisibilityCore,
  type PhasesContext,
} from '@/lib/manage/phases-core'
import type { PhaseAdd, PhasesView } from '@/lib/manage/phases-types'
import { phasesWrite } from '@/lib/manage/phases-write'
import { mintPageTag } from '@/lib/mint/page-urls'

/**
 * Phases' server actions (docs/specs/2026-10-15-phases.md, section 6.4). Each checks its input first, then
 * runs through `phasesWrite`, which checks the session and the ownership (CLAUDE.md rule 4). The browser
 * never writes an on-chain value: a confirm answers the view the server read from the chain.
 */

/** One chain read per request, however many times a page asks (React's cache). */
const readOnce = cache(readCollectionState)

/**
 * Runs a step that writes a phase's row, then expires the mint page's cached document once it lands: the
 * document carries each phase's name, description, visibility and order (docs/specs/2026-10-16-mint-page-live-data.md,
 * section 4.3), so the page shows the change on its next visit rather than up to 60 s later.
 */
async function pageWrite<T>(
  collectionId: string,
  run: (ctx: PhasesContext) => Promise<DeployOutcome<T>>,
): Promise<ActionResult<T>> {
  let slug: string | null = null
  const result = await phasesWrite(collectionId, (ctx) => {
    slug = ctx.collection.slug
    return run(ctx)
  })
  if (result.ok) expirePage(slug)
  return result
}

const expirePage = (slug: string | null) => {
  if (slug) updateTag(mintPageTag(slug))
}

/** The contract's groups joined with their rows, read on the server. */
export async function getPhases(collectionId: string): Promise<ActionResult<PhasesView>> {
  return phasesWrite(collectionId, (ctx) => phasesViewCore(ctx, readOnce))
}

/** Confirms an on-chain change from its receipt, then answers the fresh view. Only a Phases call is taken. */
export async function confirmPhaseTx(
  collectionId: string,
  txHash: string,
  sent: SentCall,
): Promise<ActionResult<PhasesView>> {
  const hash = parse(txHashSchema, txHash)
  if (!hash.ok) return hash
  const call = parseSentCall(sent, PHASE_FUNCTIONS)
  if (!call.ok) return call
  return phasesWrite(collectionId, (ctx) =>
    confirmPhaseTxCore(ctx, hash.data, { event: expectedEvent(callOf(call.data)) }),
  )
}

/** Confirms Add phase from its receipt's MintGroupRegistered log, records the phase's row, then answers the view. */
export async function recordPhase(
  collectionId: string,
  txHash: string,
  add: PhaseAdd,
): Promise<ActionResult<PhasesView>> {
  const hash = parse(txHashSchema, txHash)
  if (!hash.ok) return hash
  const input = parse(phaseAddShape, add)
  if (!input.ok) return input
  // The new group's row gives the page its name and description in place of "Group N".
  return pageWrite(collectionId, (ctx) =>
    confirmPhaseTxCore(ctx, hash.data, {
      event: { eventName: 'MintGroupRegistered', args: { mintGroup: BigInt(input.data.onchainId) } },
      add: input.data,
    }),
  )
}

/** Edit details: the name and the description, or the first name of a group registered outside Cobweb. */
export async function renamePhase(
  collectionId: string,
  onchainId: number,
  details: { name: string; description: string },
): Promise<ActionResult> {
  const id = parse(onchainIdShape, onchainId)
  if (!id.ok) return id
  const input = parse(phaseDetailsShape, details)
  if (!input.ok) return input
  return pageWrite(collectionId, (ctx) => renamePhaseCore(ctx, id.data, input.data, readOnce))
}

/** Hide from or show on the mint page. */
export async function setPhaseVisibility(
  collectionId: string,
  onchainId: number,
  visible: boolean,
): Promise<ActionResult> {
  const id = parse(onchainIdShape, onchainId)
  if (!id.ok) return id
  const shown = parse(visibleShape, visible)
  if (!shown.ok) return shown
  return pageWrite(collectionId, (ctx) => setPhaseVisibilityCore(ctx, id.data, shown.data))
}

/** Move up or Move down in the creator's order, which the mint page follows. */
export async function movePhase(
  collectionId: string,
  onchainId: number,
  direction: 'up' | 'down',
): Promise<ActionResult> {
  const id = parse(onchainIdShape, onchainId)
  if (!id.ok) return id
  const towards = parse(directionShape, direction)
  if (!towards.ok) return towards
  return pageWrite(collectionId, (ctx) => movePhaseCore(ctx, id.data, towards.data))
}
