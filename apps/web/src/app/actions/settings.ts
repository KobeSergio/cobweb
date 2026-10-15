'use server'

import { cache } from 'react'
import { manageRecordError } from '@/lib/art/db-error'
import { txHash as txHashSchema } from '@/lib/art/lock-schemas'
import type { ActionResult } from '@/lib/art/result'
import { parse } from '@/lib/art/schemas'
import { callOf, SETTINGS_FUNCTIONS, type SentCall } from '@/lib/manage/phase-calls'
import { parseSentCall } from '@/lib/manage/phase-schemas'
import { phasesWrite } from '@/lib/manage/phases-write'
import { confirmSettingsTxCore, readSettingsState, settingsViewCore } from '@/lib/manage/settings-core'
import type { SettingsView } from '@/lib/manage/settings-types'

/**
 * Settings' server actions (docs/specs/2026-10-15-airdrop-settings.md, section 6.5). Each checks its input first,
 * then runs through `phasesWrite`, which checks the session and the ownership (CLAUDE.md rule 4), with the record
 * functions' sentences for a database refusal. A confirm takes the hash and the call the browser sent, checked
 * against the Settings functions; the server proves the change from its receipt and reads the chain again.
 */

/** One chain read per request, however many times a page asks (React's cache). */
const readOnce = cache(readSettingsState)

/** The contract's settings and balances, read on the server with the session wallet, or the copies. */
export async function getSettings(collectionId: string): Promise<ActionResult<SettingsView>> {
  return phasesWrite(collectionId, (ctx) => settingsViewCore(ctx, readOnce), manageRecordError)
}

/** Confirms a Settings change from its receipt, then answers the fresh view. Only a Settings call is taken. */
export async function confirmSettingsTx(
  collectionId: string,
  txHash: string,
  sent: SentCall,
): Promise<ActionResult<SettingsView>> {
  const hash = parse(txHashSchema, txHash)
  if (!hash.ok) return hash
  const call = parseSentCall(sent, SETTINGS_FUNCTIONS)
  if (!call.ok) return call
  return phasesWrite(
    collectionId,
    (ctx) => confirmSettingsTxCore(ctx, hash.data, callOf(call.data)),
    manageRecordError,
  )
}
