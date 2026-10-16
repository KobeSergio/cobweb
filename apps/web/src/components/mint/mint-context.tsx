'use client'

import { useConnectModal } from '@rainbow-me/rainbowkit'
import { createContext, use, useCallback, useMemo, useRef, useState } from 'react'
import type { Address } from 'viem'
import { useAccount, useConfig, useSwitchChain } from 'wagmi'
import { DEMO_MINTER } from '@/lib/demo'
import type { FreshTrack } from '@/lib/mint/fresh-client'
import type { LocalMint, MintLive, WalletView } from '@/lib/mint/live-data'
import { liveMintSource, type MintSource } from '@/lib/mint/live-source'
import type { MintParams } from '@/lib/mint/mint-call'
import type { MintResult } from '@/lib/mint/mint-run'
import type { MintPageStatic } from '@/lib/mint/page-doc'
import { wagmiMintChain } from '@/lib/mint/wagmi-chain'
import { createClient } from '@/lib/supabase/client'
import {
  defaultPhaseId,
  deriveAction,
  derivePhases,
  maxQuantity,
  totalMinted,
  type MintAction,
  type Phase,
} from './model'
import { sampleMintSource } from './sample-source'
import type { MintPageProps } from './types'
import { useLiveState } from './use-live-state'
import { useMintFlow, type FlowState } from './use-mint-flow'
import { useWalletView } from './use-wallet-view'

type MintContextValue = {
  page: MintPageStatic
  source: MintSource
  /** The chain's state; null until the first answer. */
  live: MintLive | null
  track: FreshTrack
  chainNow: number | null
  /** Whole minutes since the chain was last read, when the page reads degraded; null when it does not. */
  degradedMinutes: number | null
  degraded: boolean
  /** No answer yet after 10 s. */
  waitingLong: boolean
  /** The connected wallet (or the sample's), whatever its answer. */
  walletAddress: Address | null
  /** The wallet's answer: its quotas and vaults. */
  wallet: WalletView | null
  /** Asks for the wallet's answer again ("Check again"). */
  checkWallet: () => void
  /** The wallet is a sample stand-in, not a real connection. */
  sampleWallet: boolean
  wrongChain: boolean
  switching: boolean
  phases: Phase[]
  phase: Phase | null
  selectPhase: (groupId: number) => void
  quantity: number
  setQuantity: (quantity: number) => void
  maxQuantity: number
  vault: Address | null
  setVault: (vault: Address | null) => void
  minted: number
  soldOut: boolean
  action: MintAction
  /** Runs the primary action: connect, switch chain, or start the mint. */
  act: () => void
  flow: FlowState
  closeFlow: () => void
}

const MintContext = createContext<MintContextValue | null>(null)

export function useMint(): MintContextValue {
  const value = use(MintContext)
  if (!value) throw new Error('useMint must be used inside MintProvider')
  return value
}

/** Whole minutes from a moment, by the browser's clock: labels only. */
const minutesSince = (fromMs: number, nowMs: number) => Math.max(0, Math.floor((nowMs - fromMs) / 60_000))

export function MintProvider({ page, sample, children }: MintPageProps & { children: React.ReactNode }) {
  const config = useConfig()
  const source = useMemo<MintSource>(
    () =>
      sample
        ? sampleMintSource(page, sample)
        : liveMintSource(page, {
            freshnessUrl: process.env.NEXT_PUBLIC_FRESHNESS_URL,
            chain: wagmiMintChain(config),
            supabase: createClient(),
          }),
    [page, sample, config],
  )
  const state = useLiveState(source, page)
  const { live, track } = state
  const account = useAccount()
  const { switchChain, isPending: switchingReal } = useSwitchChain()
  const { openConnectModal } = useConnectModal()

  // The wallet: a forced sample wallet, or the real connected one.
  const forced = sample?.wallet ? DEMO_MINTER : null
  const [forcedWrongChain, setForcedWrongChain] = useState(sample?.wallet === 'wrong-chain')
  const [forcedSwitching, setForcedSwitching] = useState(false)
  const real = account.isConnected && account.address ? account.address : null
  const walletAddress = forced ?? real
  const wrongChain = forced ? forcedWrongChain : !!real && account.chainId !== page.chain.id
  // A phase turning live asks for the wallet's answer again; a change of account or chain does too.
  const liveKey = `${account.chainId ?? 0}:${
    live?.groups
      .filter((group) => group.active)
      .map((group) => group.id)
      .join(',') ?? ''
  }`
  const walletState = useWalletView(source, page, walletAddress, liveKey)

  const [local, setLocal] = useState<LocalMint[]>([])
  const minted = live ? totalMinted(live, local) : 0
  const soldOut = !!live && minted >= live.supply.max
  const phases = useMemo(
    () => (live ? derivePhases(live, walletState.view, state.chainNow, local) : []),
    [live, walletState.view, state.chainNow, local],
  )

  const [chosenPhase, setChosenPhase] = useState<number | null>(null)
  const phaseId = phases.some((entry) => entry.group.id === chosenPhase)
    ? chosenPhase
    : defaultPhaseId(phases)
  const phase = phases.find((entry) => entry.group.id === phaseId) ?? null

  const [chosenVault, setChosenVault] = useState<Address | null>(null)
  const vault =
    phase?.status === 'live' && phase.vaults.some((entry) => entry.vault === chosenVault) ? chosenVault : null
  const max = phase ? maxQuantity(phase, vault) : 0
  const [rawQuantity, setRawQuantity] = useState(1)
  const quantity = Math.max(1, Math.min(rawQuantity, Math.max(1, max)))

  const action = deriveAction({
    page,
    live,
    phase,
    connected: !!walletAddress,
    walletRead: walletState.view !== null,
    wrongChain,
    quantity,
    vault,
    soldOut,
  })

  // The mint reads the latest state through refs, so a check that waits for the next answer sees it.
  const liveRef = useRef(live)
  liveRef.current = live
  const { nextAnswer, refresh } = state
  const flowLive = useMemo(
    () => ({
      isLive: (groupId: number) =>
        !!liveRef.current?.groups.some((group) => group.id === groupId && group.active),
      nextAnswer,
    }),
    [nextAnswer],
  )
  const refreshWallet = walletState.refresh
  const onMinted = useCallback(
    (params: MintParams, result: MintResult) => {
      setLocal((current) => [
        ...current,
        {
          groupId: params.groupId,
          holder: params.vault ?? params.account,
          count: result.tokenIds.length || params.amount,
          block: result.block,
        },
      ])
      setRawQuantity(1)
      refreshWallet()
      refresh()
    },
    [refreshWallet, refresh],
  )
  const flowApi = useMintFlow({ chain: source.chain, live: flowLive, onMinted })

  const act = () => {
    if (action.kind === 'connect') return openConnectModal?.()
    if (action.kind === 'switch') {
      if (forced) {
        setForcedSwitching(true)
        window.setTimeout(() => {
          setForcedWrongChain(false)
          setForcedSwitching(false)
        }, 900)
        return
      }
      return switchChain({ chainId: page.chain.id })
    }
    if (action.kind !== 'mint' || !phase || !walletAddress) return
    void flowApi.start({
      contract: page.contract,
      chainId: page.chain.id,
      groupId: phase.group.id,
      amount: quantity,
      vault,
      valueWei: action.quote.totalWei,
      account: walletAddress,
    })
  }

  const degraded = !!live && (live.degraded || state.ownDegraded)
  const nowMs = Date.now()
  const degradedMinutes = !degraded
    ? null
    : live?.degraded
      ? minutesSince(live.readAt * 1_000, nowMs)
      : state.lastGoodAt === null
        ? 0
        : minutesSince(state.lastGoodAt, performance.now())

  const value: MintContextValue = {
    page,
    source,
    live,
    track,
    chainNow: state.chainNow,
    degraded,
    degradedMinutes,
    waitingLong: state.waitingLong,
    walletAddress,
    wallet: walletState.view,
    checkWallet: walletState.refresh,
    sampleWallet: !!forced,
    wrongChain,
    switching: forced ? forcedSwitching : switchingReal,
    phases,
    phase,
    selectPhase: (groupId) => {
      setChosenPhase(groupId)
      setChosenVault(null)
    },
    quantity,
    setQuantity: setRawQuantity,
    maxQuantity: max,
    vault,
    setVault: setChosenVault,
    minted,
    soldOut,
    action,
    act,
    flow: flowApi.state,
    closeFlow: flowApi.reset,
  }

  return <MintContext value={value}>{children}</MintContext>
}
