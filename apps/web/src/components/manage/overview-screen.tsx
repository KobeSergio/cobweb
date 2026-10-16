'use client'

import Link from 'next/link'
import { useMemo, useRef, useState } from 'react'
import type { Address, Hex } from 'viem'
import { useConfig } from 'wagmi'
import { Button } from '@cobweb/ui/components/button'
import { Panel } from '@cobweb/ui/components/panel'
import { cn } from '@cobweb/ui/lib/utils'
import { NOT_OWNER } from '@/lib/art/result'
import type { Tables } from '@/lib/database.types'
import { formatNative, type DropActivity, type MintGroup, type SupportedChain } from '@/lib/demo'
import type { ManageCall } from '@/lib/manage/phase-calls'
import type { SettingsView } from '@/lib/manage/settings-types'
import { manageTabHref } from '@/lib/steps'
import { Row } from './bits'
import { realManageActions } from './manage-actions'
import { ManageActionsProvider, type ManageTarget } from './manage-context'
import { sampleManageActions, samplePhasesView } from './manage-sim'
import { MintPageLinkBar, OverviewHeader } from './overview-cards'
import { LiveNow, RecentMints } from './overview-parts'
import { settingsServer, type SettingsServer } from './settings-server'
import { sampleSettingsServer } from './settings-sim'

export type OverviewScreenProps = {
  collection: Tables<'collections'>
  /** The deployed contract and when it was deployed (Unix seconds), from the deployment record. */
  contract: Address
  deployedAt: number
  chain: SupportedChain
  /** Phases as the chain reports them; `active` comes from `mintGroupActive`. */
  groups: MintGroup[]
  /** Holders and recent mints: the sample's, on real data too, until the indexer. */
  activity: DropActivity
  /** Everything minted, from the chain read; null while the contract cannot be read. */
  totalMinted: number | null
  maxSupply: number
  /** The read's time (the chain's, or the copy's): relative labels only, never liveness. */
  readAt: number
  /** False while the view is the copy: minted and live phases are not shown. */
  chainReachable: boolean
  /** The collection's mint page link (`/night-owls` without the slash), or null while it has none. */
  slug: string | null
  /** The contract's settings and balances (or the copies): what the base URI points at, Reveal and proceeds. */
  settings: SettingsView
  /** The sign-in wallet: Reveal is sent from it, and the owner check compares it with the contract's owner. */
  wallet: Address
  sample: boolean
  /** "Paid by minters": the sample's in sample mode, null on real data until the indexer. */
  paidByMintersWei: string | null
  /**
   * The mint page's row: its avatar and whether it is public; null when it could not be read, so the header shows
   * the artwork pattern and the switch waits for a reload.
   */
  mintPage: { avatarUrl: string | null; published: boolean } | null
}

/**
 * Manage drop, overview (docs/specs/2026-10-15-airdrop-settings.md, section 7.5): a compact header (art, minted of
 * supply, the contract, what it points at with Reveal, holders), the mint page link, then live phases, proceeds
 * and recent mints. Reveal runs on its own manage actions and answers a fresh settings view. Tradability lives in
 * Settings, Advanced.
 */
export function OverviewScreen({
  collection,
  contract,
  deployedAt,
  chain,
  groups,
  activity,
  totalMinted,
  maxSupply,
  readAt,
  chainReachable,
  slug,
  settings: initial,
  wallet,
  sample,
  paidByMintersWei,
  mintPage,
}: OverviewScreenProps) {
  const config = useConfig()
  const [settings, setSettings] = useState(initial)
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  // Sample mode: what the simulated wallet sent, by hash.
  const [sampleSent] = useState(() => new Map<Hex, ManageCall>())
  const href = (tab: Parameters<typeof manageTabHref>[1]) => manageTabHref(collection.id, tab)
  const symbol = chain.nativeSymbol
  const collectionSupply = collection.max_supply

  const server = useMemo<SettingsServer>(
    () => (sample ? sampleSettingsServer(() => settingsRef.current) : settingsServer(collection.id)),
    [sample, collection.id],
  )
  const target = useMemo<ManageTarget>(
    () => ({
      actions: sample
        ? sampleManageActions(
            () => samplePhasesView({ max_supply: collectionSupply }),
            sampleSent,
            () => settingsRef.current,
          )
        : realManageActions(config, { chainId: settings.chainId, contract: settings.contract, wallet }),
      chainId: settings.chainId,
      wallet,
    }),
    [sample, sampleSent, collectionSupply, config, settings.chainId, settings.contract, wallet],
  )
  const owner = settings.owner
  const blocked = owner !== null && owner.toLowerCase() !== wallet.toLowerCase() ? NOT_OWNER(owner) : null

  return (
    <ManageActionsProvider value={target}>
      <div className="grid gap-5">
        <OverviewHeader
          collectionId={collection.id}
          avatarUrl={mintPage?.avatarUrl ?? null}
          name={collection.name}
          contract={contract}
          deployedAt={deployedAt}
          chain={chain}
          totalMinted={totalMinted}
          maxSupply={maxSupply}
          readAt={readAt}
          holders={activity.holders}
          settings={settings}
          blocked={blocked}
          confirm={(hash, call) => server.confirm(hash, call)}
          onConfirmed={setSettings}
        />
        <MintPageLinkBar
          collection={{ ...collection, slug }}
          initialPublished={mintPage?.published ?? null}
          sample={sample}
        />

        <div className="mt-3 grid gap-5 lg:grid-cols-3">
          {/* Live phases and proceeds on the right from 1024px, first on narrow screens. */}
          <div className="grid content-start gap-5 lg:order-last">
            <Panel
              title="Live now"
              className={cn(groups.some((group) => group.active) && 'border-primary-line')}
              bodyClassName="p-5"
            >
              <LiveNow
                groups={groups}
                chain={chain}
                readAt={readAt}
                phasesHref={href('phases')}
                reachable={chainReachable}
              />
            </Panel>

            <Panel title="Proceeds" bodyClassName="grid gap-4 p-5">
              <div>
                <p className="text-muted-foreground text-xs font-medium">Withdrawable now</p>
                <p className="numeric mt-1 text-[2rem] leading-tight">
                  {settings.creatorBalanceWei === null
                    ? 'Not read'
                    : formatNative(settings.creatorBalanceWei, symbol)}
                </p>
              </div>
              <dl className="divide-y border-t">
                {paidByMintersWei !== null && (
                  <Row label="Paid by minters">{formatNative(paidByMintersWei, symbol)}</Row>
                )}
                <Row label="Already withdrawn">{formatNative(settings.withdrawnWei, symbol)}</Row>
              </dl>
              <Button variant="secondary" asChild className="w-full">
                <Link href={href('settings')}>Withdraw proceeds</Link>
              </Button>
            </Panel>
          </div>

          <Panel title="Recent mints" className="lg:col-span-2" bodyClassName="p-0 pb-2">
            <RecentMints mints={activity.recentMints} groups={groups} chain={chain} readAt={readAt} />
          </Panel>
        </div>
      </div>
    </ManageActionsProvider>
  )
}
