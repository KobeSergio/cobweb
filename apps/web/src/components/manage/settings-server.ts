import type { Hex } from 'viem'
import { confirmSettingsTx, getSettings } from '@/app/actions/settings'
import type { ActionResult } from '@/lib/art/result'
import { sentOf, type ManageCall } from '@/lib/manage/phase-calls'
import type { SettingsView } from '@/lib/manage/settings-types'

/**
 * Settings' server, bound to one collection (docs/specs/2026-10-15-airdrop-settings.md, section 7.2): the two
 * actions in one object, which `sampleSettingsServer` (settings-sim.ts) mirrors in sample mode. A confirm sends
 * the hash and the call as `sentOf` writes it.
 */
export type SettingsServer = {
  read(): Promise<ActionResult<SettingsView>>
  confirm(hash: Hex, call: ManageCall): Promise<ActionResult<SettingsView>>
}

export function settingsServer(collectionId: string): SettingsServer {
  return {
    read: () => getSettings(collectionId),
    confirm: (hash, call) => confirmSettingsTx(collectionId, hash, sentOf(call)),
  }
}
