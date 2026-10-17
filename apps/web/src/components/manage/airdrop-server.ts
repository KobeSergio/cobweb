import type { Hex } from 'viem'
import {
  confirmAirdrop,
  exportAirdropRecipients,
  getAirdrop,
  getAirdropRecipients,
} from '@/app/actions/airdrop'
import type { ActionResult } from '@/lib/art/result'
import type { AirdropView, RecipientPage, RecipientRow } from '@/lib/manage/airdrop-types'

/**
 * Airdrop's server, bound to one collection (docs/specs/2026-10-15-airdrop-settings.md, section 7.2): the
 * actions in one object, which `sampleAirdropServer` (airdrop-sim.ts) mirrors in sample mode. A confirm sends
 * the hash alone; By recipient asks for a page by its search and number, and for every row to export
 * (docs/specs/2026-10-16-indexer-overview.md, section 7.3).
 */
export type AirdropServer = {
  read(): Promise<ActionResult<AirdropView>>
  confirm(hash: Hex): Promise<ActionResult<AirdropView>>
  recipients(query: { search: string; page: number }): Promise<ActionResult<RecipientPage>>
  exportRecipients(): Promise<ActionResult<RecipientRow[]>>
}

export function airdropServer(collectionId: string): AirdropServer {
  return {
    read: () => getAirdrop(collectionId),
    confirm: (hash) => confirmAirdrop(collectionId, hash),
    recipients: (query) => getAirdropRecipients(collectionId, query),
    exportRecipients: () => exportAirdropRecipients(collectionId),
  }
}
