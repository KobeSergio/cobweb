'use client'

import { sampleSupply, toWei, DEMO_COLLECTION } from '@/lib/demo'
import { RocketIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { isAddress } from 'viem'
import { Button } from '@cobweb/ui/components/button'
import { slugState } from '@/lib/collections'
import type { Tables } from '@/lib/database.types'
import type { Address, DeployDraft, Deployment, FeeSnapshot, SupportedChain } from '@/lib/demo/types'
import type { FlowLink } from '@/lib/steps'
import { StageFooter } from '@/components/shell/stage-footer'
import { DeployDialog, type FinalCheck } from './deploy-dialog'
import { DeployForm, royaltyBps, validateDeploy, type DeployFormValues } from './deploy-form'
import { defaultPhases, DeployPhases, phaseErrors, type DraftPhase } from './deploy-phases'
import {
  DEPLOY_OUTCOMES,
  deployCollection,
  predictAddress,
  useCreatorWallet,
  useFactoryRead,
  type DeployOutcome,
} from './deploy-sim'
import { DeploySummary } from './deploy-summary'
import { DeployedView, OpenMintPageButton } from './deployed-view'
import { TX_IDLE, type TxPhase } from './tx-progress'

export type DeployFlowProps = {
  collection: Tables<'collections'>
  chains: SupportedChain[]
  factoryFees: Record<number, FeeSnapshot>
  deployCost: Record<number, string>
  draft: DeployDraft
  deployment: Deployment | null
  readOnly: boolean
  previous?: FlowLink
  next?: FlowLink
  sampleOutcome?: string
  /** Used as the creator's wallet when none is connected. */
  sampleWallet: Address
  artSrc: string
  metadataCid: string
}

const FIELD_IDS = {
  chainId: '',
  payout: 'deploy-payout',
  royalty: 'deploy-royalty',
  royaltyReceiver: 'deploy-royalty-receiver',
  publicCap: 'deploy-cap',
  phases: 'deploy-phases',
}

/** Deploy: the form and live summary, the final check and transaction, then the deployed result. */
export function DeployFlow(props: DeployFlowProps) {
  const { collection, chains, factoryFees, deployCost, draft, readOnly, previous, next } = props
  const outcome = DEPLOY_OUTCOMES.find((entry) => entry === props.sampleOutcome) as DeployOutcome | undefined
  const wallet = useCreatorWallet(props.sampleWallet)

  // Payout and royalty recipient follow the connected wallet until the creator types their own.
  const [payout, setPayout] = useState<string | null>(null)
  const [form, setForm] = useState({
    chainId: draft.chainId,
    royalty: String(draft.royaltyBps / 100),
    sameReceiver: true,
    royaltyReceiver: draft.royaltyReceiver as string,
    publicCap: String(draft.publicMaxMintPerWallet),
  })
  const values: DeployFormValues = { ...form, payout: payout ?? wallet.address }
  // Supply is set in Art (at Generate, or by the file count); a collection without it cannot deploy.
  const maxSupply = sampleSupply(collection.max_supply, DEMO_COLLECTION.maxSupply)
  const [phases, setPhases] = useState<DraftPhase[]>(() => defaultPhases(maxSupply))
  const [touched, setTouched] = useState<Set<string>>(new Set())
  const [showAll, setShowAll] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [phase, setPhase] = useState<TxPhase>(TX_IDLE)
  const [attempt, setAttempt] = useState(0)
  const [deployment, setDeployment] = useState<Deployment | null>(props.deployment)
  const [justDeployed, setJustDeployed] = useState(false)
  // The mint page link as last reserved on this screen, for the summary and the deploy gate.
  const [address, setAddress] = useState({
    slug: collection.slug,
    slug_reserved_at: collection.slug_reserved_at,
  })
  const current = { ...collection, ...address }
  const link = slugState(current)
  // Required before deploying: a live reservation (or, for a deployed collection, its link).
  const linkSlug = link.kind === 'reserved' || link.kind === 'permanent' ? link.slug : null
  const controller = useRef<AbortController | null>(null)
  const factory = useFactoryRead(values.chainId, outcome)

  useEffect(() => () => controller.current?.abort(), [])

  const chain = chains.find((entry) => entry.id === values.chainId) ?? null
  const phaseCheck = phaseErrors(phases, maxSupply, chain?.nativeSymbol ?? 'ETH')
  const allErrors = validateDeploy(values, maxSupply)
  if (!phaseCheck.ok) allErrors.phases = phaseCheck.total ?? 'Check the phases.'
  const errors = Object.fromEntries(
    Object.entries(allErrors).filter(([key]) => showAll || touched.has(key)),
  ) as typeof allErrors
  const valid = Object.keys(allErrors).length === 0

  const fees = chain ? factoryFees[chain.id] : undefined
  const bps = royaltyBps(values.royalty)
  const payoutAddress = isAddress(values.payout) ? (values.payout as Address) : null
  const receiver = values.sameReceiver
    ? payoutAddress
    : isAddress(values.royaltyReceiver)
      ? (values.royaltyReceiver as Address)
      : null
  const args =
    payoutAddress && receiver && bps !== null && !allErrors.publicCap && phaseCheck.ok
      ? {
          name: collection.name,
          symbol: collection.symbol,
          maxSupply,
          payout: payoutAddress,
          initialBaseUri: draft.initialBaseUri,
          publicMaxMintPerWallet: Number(values.publicCap),
          royaltyBps: bps,
          owner: wallet.address,
          royaltyReceiver: receiver,
          mintGroups: phases.map((phase) => ({
            name: phase.name.trim(),
            priceWei: toWei(phase.price.trim()),
            maxSupply: Number(phase.supply),
          })),
        }
      : null
  const predicted = args ? predictAddress(collection.id, args) : null
  const ready =
    valid &&
    maxSupply > 0 &&
    !!linkSlug &&
    !!args &&
    !!predicted &&
    !!chain &&
    !!fees &&
    factory.status === 'ready'

  function change(patch: Partial<DeployFormValues>) {
    const { payout: nextPayout, ...rest } = patch
    if (nextPayout !== undefined) setPayout(nextPayout)
    setForm((current) => ({ ...current, ...rest }))
    setTouched((current) => new Set([...current, ...Object.keys(patch)]))
    if (patch.chainId !== undefined) setPhase(TX_IDLE)
  }

  function openFinalCheck() {
    if (!valid) {
      setShowAll(true)
      // Take the creator to the first field that needs attention.
      const first = Object.keys(allErrors)[0] as keyof typeof FIELD_IDS
      const target =
        first === 'chainId'
          ? document.querySelector<HTMLElement>('[data-slot="choice-card"]')
          : document.getElementById(FIELD_IDS[first])
      target?.focus()
      return
    }
    if (phase.step === 'failed') setPhase(TX_IDLE)
    setDialogOpen(true)
  }

  async function deploy() {
    if (!ready || !args || !predicted || !chain || !fees) return
    controller.current = new AbortController()
    try {
      const txHash = await deployCollection(setPhase, {
        needsSwitch: wallet.chainId !== chain.id,
        outcome: attempt === 0 ? outcome : undefined,
        signal: controller.current.signal,
      })
      setAttempt((count) => count + 1)
      if (!txHash) return
      setDeployment({
        chainId: chain.id,
        contractAddress: predicted,
        txHash,
        deployer: wallet.address,
        deployedAt: Math.floor(Date.now() / 1000),
        fees,
        royaltyBps: args.royaltyBps,
        royaltyReceiver: args.royaltyReceiver,
        payoutAddress: args.payout,
        baseUri: args.initialBaseUri,
        revealed: false,
        transfersLocked: false,
        mintOnBehalfActive: false,
      })
      setJustDeployed(true)
      setDialogOpen(false)
    } catch {
      // Unmounted mid-deploy.
    }
  }

  const deployedChain = deployment ? chains.find((entry) => entry.id === deployment.chainId) : undefined
  if (deployment && deployedChain) {
    return (
      <div className="flex flex-1 flex-col">
        <div className="pb-10">
          <DeployedView
            collection={current}
            deployment={deployment}
            chain={deployedChain}
            artSrc={props.artSrc}
            focusOnMount={justDeployed}
          />
        </div>
        <StageFooter previous={previous} next={next}>
          <OpenMintPageButton collection={current} />
        </StageFooter>
      </div>
    )
  }

  const check: FinalCheck | null =
    ready && args && predicted && chain && fees && linkSlug
      ? {
          name: collection.name,
          mintPageLink: `cobweb.app/${linkSlug}`,
          symbol: collection.symbol,
          maxSupply,
          chain,
          walletChain: chains.find((entry) => entry.id === wallet.chainId),
          predicted,
          payout: args.payout,
          royaltyBps: args.royaltyBps,
          royaltyReceiver: args.royaltyReceiver,
          publicCap: args.publicMaxMintPerWallet,
          phases: args.mintGroups,
          fees,
          deployCostWei: deployCost[chain.id],
        }
      : null

  const hint =
    maxSupply === 0
      ? 'Set the supply in Art first.'
      : !linkSlug
        ? 'Reserve your mint page link first.'
        : !chain
          ? 'Choose a chain to deploy on.'
          : factory.status === 'loading'
            ? 'Reading fees from the factory.'
            : factory.status === 'error'
              ? 'Fees could not be read.'
              : null

  return (
    <div className="flex flex-1 flex-col">
      <div className="grid items-start gap-8 pb-10 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_25rem]">
        <div className="space-y-8">
          <DeployForm
            collection={collection}
            chains={chains}
            deployCost={deployCost}
            walletAddress={wallet.address}
            walletChainId={wallet.chainId}
            values={values}
            errors={errors}
            readOnly={readOnly}
            onChange={change}
            onAddressSaved={setAddress}
          />
          <DeployPhases
            phases={phases}
            onChange={(next) => {
              setPhases(next)
              setTouched((current) => new Set([...current, 'phases']))
            }}
            maxSupply={maxSupply}
            chain={chain}
            readOnly={readOnly}
            showErrors={showAll || touched.has('phases')}
          />
        </div>
        <aside aria-label="Deploy summary" className="lg:sticky lg:top-6">
          <DeploySummary
            collection={current}
            chain={chain}
            fees={fees}
            deployCostWei={chain ? deployCost[chain.id] : undefined}
            factory={factory}
            predicted={predicted}
            payout={payoutAddress}
            royaltyBps={bps}
            royaltyReceiver={receiver}
            baseUri={draft.initialBaseUri}
            metadataCid={props.metadataCid}
            artSrc={props.artSrc}
          />
        </aside>
      </div>

      <StageFooter previous={previous}>
        {hint && <p className="text-muted-foreground text-sm">{hint}</p>}
        {!readOnly && (
          <Button
            onClick={openFinalCheck}
            disabled={maxSupply === 0 || !linkSlug || (!!chain && (factory.status !== 'ready' || !fees))}
          >
            <RocketIcon />
            Deploy contract
          </Button>
        )}
      </StageFooter>

      <DeployDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        check={check}
        phase={phase}
        onDeploy={deploy}
      />
    </div>
  )
}
