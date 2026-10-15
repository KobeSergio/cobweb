'use client'

import { createContext, useContext } from 'react'
import type { Address } from 'viem'
import type { ManageActions } from './manage-actions'

/**
 * The actions every `TransactionDialog` in Manage drop runs on (docs/specs/2026-10-15-phases.md, section
 * 7.3), with the collection's chain and the sign-in wallet the machine checks against. Phases, Whitelist,
 * Airdrop, Settings and the Overview each provide the real or the sample ones
 * (docs/specs/2026-10-15-airdrop-settings.md, section 7.1).
 */
export type ManageTarget = { actions: ManageActions; chainId: number; wallet: Address }

const ManageContext = createContext<ManageTarget | null>(null)

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
  const target = useContext(ManageContext)
  if (!target) throw new Error('ManageActionsProvider is missing.')
  return target
}
