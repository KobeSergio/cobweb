import type { Hex } from 'viem'
import {
  confirmPhaseTx,
  getPhases,
  movePhase,
  recordPhase,
  renamePhase,
  setPhaseVisibility,
} from '@/app/actions/phases'
import type { ActionResult } from '@/lib/art/result'
import { sentOf, type ManageCall } from '@/lib/manage/phase-calls'
import type { PhaseAdd, PhasesView } from '@/lib/manage/phases-types'

/**
 * Phases' server, bound to one collection (docs/specs/2026-10-15-phases.md, section 7.3): the six actions
 * in one object, which `samplePhasesServer` (manage-sim.ts) mirrors in sample mode.
 */
export type PhasesServer = {
  read(): Promise<ActionResult<PhasesView>>
  confirm(hash: Hex, call: ManageCall): Promise<ActionResult<PhasesView>>
  record(hash: Hex, add: PhaseAdd): Promise<ActionResult<PhasesView>>
  rename(onchainId: number, details: { name: string; description: string }): Promise<ActionResult>
  setVisibility(onchainId: number, visible: boolean): Promise<ActionResult>
  move(onchainId: number, direction: 'up' | 'down'): Promise<ActionResult>
}

export function phasesServer(collectionId: string): PhasesServer {
  return {
    read: () => getPhases(collectionId),
    confirm: (hash, call) => confirmPhaseTx(collectionId, hash, sentOf(call)),
    record: (hash, add) => recordPhase(collectionId, hash, add),
    rename: (onchainId, details) => renamePhase(collectionId, onchainId, details),
    setVisibility: (onchainId, visible) => setPhaseVisibility(collectionId, onchainId, visible),
    move: (onchainId, direction) => movePhase(collectionId, onchainId, direction),
  }
}
