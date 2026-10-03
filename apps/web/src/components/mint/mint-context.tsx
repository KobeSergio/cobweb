'use client'

import { useConnectModal } from '@rainbow-me/rainbowkit'
import { createContext, use, useCallback, useMemo, useState } from 'react'
import { useAccount, useSwitchChain } from 'wagmi'
import type { Address, MintPageData, WalletState } from '@/lib/demo'
import {
  defaultPhaseId,
  deriveAction,
  derivePhases,
  localKey,
  maxQuantity,
  totalMinted,
  type LocalMints,
  type MintAction,
  type Phase,
} from './model'
import type { MintParams } from './mint-transaction'
import type { MintPageProps, TokenPreview } from './types'
import { useChainClock } from './use-chain-clock'
import { useMintFlow, type FlowState } from './use-mint-flow'

type MintContextValue = {
  data: MintPageData
  extras: MintPageProps['extras']
  chainNow: number
  wallet: WalletState | null
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
  previewFor: (tokenId: number) => TokenPreview
}

const MintContext = createContext<MintContextValue | null>(null)

export function useMint(): MintContextValue {
  const value = use(MintContext)
  if (!value) throw new Error('useMint must be used inside MintProvider')
  return value
}

export function MintProvider({
  data,
  extras,
  sampleWallet,
  sample,
  children,
}: MintPageProps & { children: React.ReactNode }) {
  const chainNow = useChainClock(data.blockTimestamp)
  const account = useAccount()
  const { switchChain, isPending: switchingReal } = useSwitchChain()
  const { openConnectModal } = useConnectModal()

  // The wallet: a forced sample wallet, or the real connected one with the sample allowances.
  const forced = sample?.forcedWallet ?? null
  const [forcedWrongChain, setForcedWrongChain] = useState(sample?.wrongChain ?? false)
  const [forcedSwitching, setForcedSwitching] = useState(false)
  const real = account.isConnected && account.address ? account.address : null
  const wallet: WalletState | null = forced
    ? forced
    : real
      ? { ...(sampleWallet ?? emptyWallet(real)), address: real }
      : null
  const wrongChain = forced ? forcedWrongChain : !!real && account.chainId !== data.collection.chain.id

  const [local, setLocal] = useState<LocalMints>({})
  const minted = totalMinted(data, local)
  const soldOut = minted >= data.supply.max
  const phases = useMemo(() => derivePhases(data, wallet, chainNow, local), [data, wallet, chainNow, local])

  const [chosenPhase, setChosenPhase] = useState<number | null>(null)
  const phaseId = phases.some((entry) => entry.group.id === chosenPhase)
    ? chosenPhase
    : defaultPhaseId(phases)
  const phase = phases.find((entry) => entry.group.id === phaseId) ?? null

  const [chosenVault, setChosenVault] = useState<Address | null>(null)
  const vault = phase?.vaults.some((entry) => entry.vault === chosenVault) ? chosenVault : null
  const max = phase ? maxQuantity(phase, vault) : 0
  const [rawQuantity, setRawQuantity] = useState(1)
  const quantity = Math.max(1, Math.min(rawQuantity, Math.max(1, max)))

  const action = deriveAction({
    data,
    phase,
    connected: !!wallet,
    wrongChain,
    quantity,
    vault,
    soldOut,
  })

  const onMinted = useCallback((params: MintParams, tokenIds: number[]) => {
    const key = localKey(params.groupId, params.vault ?? params.account)
    setLocal((current) => ({ ...current, [key]: (current[key] ?? 0) + tokenIds.length }))
    setRawQuantity(1)
  }, [])
  const flowApi = useMintFlow({ failure: sample?.failure ?? null, onMinted })

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
      return switchChain({ chainId: data.collection.chain.id })
    }
    if (action.kind !== 'mint' || !phase || !wallet) return
    void flowApi.start(
      {
        contract: data.collection.contractAddress,
        chainId: data.collection.chain.id,
        groupId: phase.group.id,
        amount: quantity,
        vault,
        valueWei: action.quote.totalWei,
        account: wallet.address,
      },
      minted + 1,
    )
  }

  const previews = extras.tokenPreviews
  const previewFor = useCallback(
    (tokenId: number): TokenPreview =>
      previews.find((entry) => entry.id === tokenId) ?? {
        id: tokenId,
        layers: [`/demo/tokens/${((tokenId - 1) % 24) + 1}.svg`],
      },
    [previews],
  )

  const value: MintContextValue = {
    data,
    extras,
    chainNow,
    wallet,
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
    previewFor,
  }

  return <MintContext value={value}>{children}</MintContext>
}

function emptyWallet(address: Address): WalletState {
  return { address, publicMinted: 0, groups: [], delegatedVaults: [] }
}
