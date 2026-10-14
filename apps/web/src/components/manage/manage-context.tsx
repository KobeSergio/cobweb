'use client'

import { createContext, useContext } from 'react'
import type { Address } from 'viem'
import { DEMO_CREATOR, DEMO_DEPLOYMENT } from '@/lib/demo'
import type { ManageActions } from './manage-actions'
import { sampleManageActions, samplePhasesView } from './manage-sim'

/**
 * The actions every `TransactionDialog` in Manage drop runs on (docs/specs/2026-10-15-phases.md, section
 * 7.3), with the collection's chain and the sign-in wallet the machine checks against. Phases provides the
 * real or the sample ones; the tabs still on sample data (Whitelist, Airdrop, Settings, the Overview's
 * Reveal) run on one shared sample target until their sub-projects.
 */
export type ManageTarget = { actions: ManageActions; chainId: number; wallet: Address }

const ManageContext = createContext<ManageTarget | null>(null)

let sampleTarget: ManageTarget | null = null

/** The shared sample target, made on first use. */
function sampleFallback(): ManageTarget {
  sampleTarget ??= {
    actions: sampleManageActions(() => samplePhasesView({ max_supply: null })),
    chainId: DEMO_DEPLOYMENT.chainId,
    wallet: DEMO_CREATOR,
  }
  return sampleTarget
}

export function ManageActionsProvider({
  value,
  children,
}: {
  value: ManageTarget
  children: React.ReactNode
}) {
  return <ManageContext.Provider value={value}>{children}</ManageContext.Provider>
}

export function useManageActions(): ManageTarget {
  return useContext(ManageContext) ?? sampleFallback()
}
