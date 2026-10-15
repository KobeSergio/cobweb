import type { Hex } from 'viem'
import { confirmAirdrop, getAirdrop } from '@/app/actions/airdrop'
import type { ActionResult } from '@/lib/art/result'
import type { AirdropView } from '@/lib/manage/airdrop-types'

/**
 * Airdrop's server, bound to one collection (docs/specs/2026-10-15-airdrop-settings.md, section 7.2): the two
 * actions in one object, which `sampleAirdropServer` (airdrop-sim.ts) mirrors in sample mode. A confirm sends
 * the hash alone.
 */
export type AirdropServer = {
  read(): Promise<ActionResult<AirdropView>>
  confirm(hash: Hex): Promise<ActionResult<AirdropView>>
}

export function airdropServer(collectionId: string): AirdropServer {
  return {
    read: () => getAirdrop(collectionId),
    confirm: (hash) => confirmAirdrop(collectionId, hash),
  }
}
