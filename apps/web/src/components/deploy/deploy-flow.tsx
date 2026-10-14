'use client'

import { DEMO_COLLECTION, DEMO_DEPLOY_DRAFT, sampleSupply, toWei } from '@/lib/demo'
import { InfoIcon, RocketIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { isAddress, type Address, type Hex } from 'viem'
import { useConfig } from 'wagmi'
import { Alert, AlertDescription, AlertTitle } from '@cobweb/ui/components/alert'
import { Button } from '@cobweb/ui/components/button'
import { Input } from '@cobweb/ui/components/input'
import { Label } from '@cobweb/ui/components/label'
import { Panel } from '@cobweb/ui/components/panel'
import { StageFooter } from '@/components/shell/stage-footer'
import { LINK_REQUIRED, NOT_A_HASH } from '@/lib/art/result'
import { chainView } from '@/lib/chain/chain-view'
import { slugState } from '@/lib/collections'
import type { Tables } from '@/lib/database.types'
import type { FeeSnapshot } from '@/lib/demo/types'
import type { DeployChain, DeployForm, DeployRecord, DoneJob, Prepared } from '@/lib/deploy/deploy-types'
import type { FlowLink } from '@/lib/steps'
import { realDeployActions, type DeployActions } from './deploy-actions'
import { DeployDialog, type FinalCheck } from './deploy-dialog'
import {
  DeployForm as DeployFormPanel,
  royaltyBps,
  validateDeploy,
  type DeployFormValues,
} from './deploy-form'
import {
  browserStore,
  deployReducer,
  forgetDeploy,
  pendingDeploy,
  rememberDeploy,
  retryHash,
  runDeploy,
  type PendingDeploy,
} from './deploy-machine'
import { defaultPhases, DeployPhases, phaseErrors, type DraftPhase } from './deploy-phases'
import { DEPLOY_OUTCOMES, sampleDeployActions, useCreatorWallet, type DeployOutcome } from './deploy-sim'
import { DeploySummary, type CostState, type FeesState } from './deploy-summary'
import { DeployedView, SetUpDropButton } from './deployed-view'
import { classifyError } from './tx-errors'
import { isTxRunning, TX_IDLE, TxProgress } from './tx-progress'

export type DeployFlowProps = {
  collection: Tables<'collections'>
  chains: DeployChain[]
  /** The chain the fee was paid on (the done real job's quote chain); null when the creator picks. */
  fixedChainId: number | null
  /** The factory's fees on that chain, read on the server; the screen reads again in the browser. */
  initialFees: FeeSnapshot | null
  /** The job the contract starts on (null before any finished render), and the real set's job. */
  startJob: DoneJob | null
  realJob: DoneJob | null
  record: DeployRecord | null
  readOnly: boolean
  sample: boolean
  sampleOutcome?: string
  /** The session's wallet: the payout default, and the deployer the server prepares for. */
  sessionWallet: Address
  artSrc: string | null
  previous?: FlowLink
  next?: FlowLink
}

const FIELD_IDS = {
  chainId: '',
  payout: 'deploy-payout',
  royalty: 'deploy-royalty',
  royaltyReceiver: 'deploy-royalty-receiver',
  publicCap: 'deploy-cap',
  phases: 'deploy-phases',
}
const PREDICT_DEBOUNCE_MS = 400
const HASH_RE = /^0x[0-9a-fA-F]{64}$/
const FORM_FIRST = 'Fill in the settings the contract was deployed with, then check the hash.'
const PREDICT_FAILED = 'The address could not be predicted. Reload the page and try again.'
const PREDICTING = 'Predicting the contract address.'

/** The machine's form from the screen's values, or null while anything is invalid. */
function toDeployForm(
  values: DeployFormValues,
  phases: DraftPhase[],
  chainId: number | null,
  maxSupply: number,
  symbol: string,
): DeployForm | null {
  if (chainId === null) return null
  const bps = royaltyBps(values.royalty)
  if (bps === null || !isAddress(values.payout)) return null
  const receiver = values.sameReceiver ? values.payout : values.royaltyReceiver
  if (!isAddress(receiver)) return null
  const cap = Number(values.publicCap)
  if (!Number.isInteger(cap) || cap < 1 || cap > maxSupply) return null
  if (!phaseErrors(phases, maxSupply, symbol).ok) return null
  return {
    chainId,
    payout: values.payout as Address,
    royaltyBps: bps,
    royaltyReceiver: receiver as Address,
    publicMaxPerWallet: cap,
    groups: phases.map((phase) => ({
      name: phase.name.trim(),
      priceWei: toWei(phase.price.trim()),
      maxSupply: Number(phase.supply),
    })),
  }
}

/**
 * Deploy (docs/specs/2026-10-14-deploy.md, section 7.2): the form and the live summary with the
 * server's prediction, the final check and the transaction through the deploy machine, then the
 * deployed view from the record the server answers. Sample mode runs the same code on
 * `sampleDeployActions`.
 */
export function DeployFlow(props: DeployFlowProps) {
  const { collection, chains, fixedChainId, startJob, realJob, readOnly, sample, previous } = props
  const router = useRouter()
  const config = useConfig()
  const outcome = DEPLOY_OUTCOMES.find((entry) => entry === props.sampleOutcome) as DeployOutcome | undefined
  const wallet = useCreatorWallet(props.sessionWallet, sample)
  const walletRef = useRef(wallet)
  walletRef.current = wallet

  // Supply is set in Art (at Generate, or by the file count); a collection without it cannot deploy.
  const maxSupply = sampleSupply(collection.max_supply, DEMO_COLLECTION.maxSupply)
  // What the contract starts on and, when that is a placeholder, what it reveals to.
  const startsOn = startJob?.baseUri ?? null
  const startsOnPlaceholder = startJob !== null && startJob.placeholderImageCid !== null
  const revealsTo = startJob && realJob && startJob.id !== realJob.id ? realJob.baseUri : null

  const actions = useMemo<DeployActions>(
    () =>
      sample
        ? sampleDeployActions({
            collectionId: collection.id,
            collection: { name: collection.name, symbol: collection.symbol, maxSupply },
            wallet: wallet.address,
            baseUri: startsOn ?? '',
            revealsTo,
            outcome,
          })
        : realDeployActions(config, collection.id, () =>
            walletRef.current.connected ? walletRef.current.address : undefined,
          ),
    [
      sample,
      collection.id,
      collection.name,
      collection.symbol,
      maxSupply,
      wallet.address,
      startsOn,
      revealsTo,
      outcome,
      config,
    ],
  )

  // Payout and royalty recipient follow the wallet until the creator types their own.
  const [payout, setPayout] = useState<string | null>(null)
  const [receiverText, setReceiverText] = useState<string | null>(null)
  const [form, setForm] = useState({
    chainId: fixedChainId,
    royalty: String(DEMO_DEPLOY_DRAFT.royaltyBps / 100),
    sameReceiver: true,
    publicCap: String(DEMO_DEPLOY_DRAFT.publicMaxMintPerWallet),
  })
  const values: DeployFormValues = {
    ...form,
    payout: payout ?? wallet.address,
    royaltyReceiver: receiverText ?? wallet.address,
  }
  const [phases, setPhases] = useState<DraftPhase[]>(() => defaultPhases(maxSupply))
  const [touched, setTouched] = useState<Set<string>>(new Set())
  const [showAll, setShowAll] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [phase, dispatch] = useReducer(deployReducer, TX_IDLE)
  const [record, setRecord] = useState<DeployRecord | null>(props.record)
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
  // The server's prediction for the current settings, refreshed 400 ms after the last change.
  const [prepared, setPrepared] = useState<Prepared | null>(null)
  const [predicting, setPredicting] = useState(false)
  // The server's refusal to prepare (the link, the chain, the factory), shown where the address would be.
  const [predictError, setPredictError] = useState<string | null>(null)
  const [fees, setFees] = useState<FeesState>(
    props.initialFees ? { status: 'ready', data: props.initialFees } : { status: 'loading', data: null },
  )
  const [feesAttempt, setFeesAttempt] = useState(0)
  const [cost, setCost] = useState<CostState>({ kind: 'none' })
  // A deploy this browser sent and the server has not recorded yet.
  const [resumable, setResumable] = useState<PendingDeploy | null>(null)
  const [hashOpen, setHashOpen] = useState(false)
  const [hashText, setHashText] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const running = isTxRunning(phase)

  const chainId = fixedChainId ?? values.chainId
  const chain = chains.find((entry) => entry.id === chainId) ?? null
  const symbol = chain?.nativeSymbol ?? 'ETH'
  const phaseCheck = phaseErrors(phases, maxSupply, symbol)
  const allErrors = validateDeploy(values, maxSupply)
  if (!phaseCheck.ok) allErrors.phases = phaseCheck.total ?? 'Check the phases.'
  const errors = Object.fromEntries(
    Object.entries(allErrors).filter(([key]) => showAll || touched.has(key)),
  ) as typeof allErrors
  const valid = Object.keys(allErrors).length === 0
  const deployForm = valid ? toDeployForm(values, phases, chainId, maxSupply, symbol) : null
  const formKey = deployForm ? JSON.stringify(deployForm) : null
  const bps = royaltyBps(values.royalty)
  const payoutAddress = isAddress(values.payout) ? (values.payout as Address) : null
  const receiver = values.sameReceiver
    ? payoutAddress
    : isAddress(values.royaltyReceiver)
      ? (values.royaltyReceiver as Address)
      : null
  const walletChain = wallet.chainId === undefined ? undefined : chainView(wallet.chainId)

  useEffect(() => {
    if (!sample) setResumable(pendingDeploy(browserStore(), collection.id))
  }, [sample, collection.id])

  // The fees on the deploy chain, read in the browser; the server's snapshot stays shown meanwhile.
  useEffect(() => {
    if (chainId === null || record) return
    let live = true
    setFees((state) => ({ status: 'loading', data: state.data }))
    actions.fees(chainId, chain?.factory ?? null).then(
      (data) => {
        if (live) setFees({ status: 'ready', data })
      },
      () => {
        if (live) setFees({ status: 'error', data: null })
      },
    )
    return () => {
      live = false
    }
  }, [actions, chainId, chain?.factory, feesAttempt, record])

  // The server's prediction follows the form, 400 ms after the last change: the same action the deploy runs first.
  // A refusal is kept and shown. The link is checked here first, so a reservation re-runs the prediction.
  useEffect(() => {
    if (readOnly || record || formKey === null) {
      setPrepared(null)
      setPredictError(null)
      setPredicting(false)
      return
    }
    if (!linkSlug) {
      setPrepared(null)
      setPredictError(LINK_REQUIRED)
      setPredicting(false)
      return
    }
    let live = true
    setPredicting(true)
    setPredictError(null)
    const timer = setTimeout(() => {
      actions.prepare(JSON.parse(formKey) as DeployForm).then(
        (result) => {
          if (!live) return
          setPrepared(result.ok ? result.data : null)
          setPredictError(result.ok ? null : result.error)
          setPredicting(false)
        },
        () => {
          if (!live) return
          setPrepared(null)
          setPredictError(PREDICT_FAILED)
          setPredicting(false)
        },
      )
    }, PREDICT_DEBOUNCE_MS)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [actions, readOnly, record, formKey, linkSlug])

  // The deploy cost, while the wallet is connected and on the deploy chain (sample mode always has one).
  useEffect(() => {
    if (!prepared) {
      // Without a prepared call there is nothing to estimate; after a refusal the row says so, not "fill in".
      setCost(predictError ? { kind: 'unknown' } : { kind: 'none' })
      return
    }
    if (!sample && !wallet.connected) {
      setCost({ kind: 'no-wallet' })
      return
    }
    if (!sample && wallet.chainId !== prepared.chainId) {
      setCost({ kind: 'other-chain', chainName: chainView(prepared.chainId).name })
      return
    }
    let live = true
    setCost({ kind: 'loading' })
    actions.estimateCost(prepared).then(
      (wei) => {
        if (live) setCost(wei ? { kind: 'ready', wei } : { kind: 'unknown' })
      },
      () => {
        if (live) setCost({ kind: 'unknown' })
      },
    )
    return () => {
      live = false
    }
  }, [actions, prepared, predictError, sample, wallet.connected, wallet.chainId])

  const ready =
    valid &&
    maxSupply > 0 &&
    !!linkSlug &&
    !!deployForm &&
    !!prepared &&
    !!chain &&
    fees.status === 'ready' &&
    !!fees.data &&
    (sample || wallet.connected)

  function change(patch: Partial<DeployFormValues>) {
    const { payout: nextPayout, royaltyReceiver: nextReceiver, ...rest } = patch
    if (nextPayout !== undefined) setPayout(nextPayout)
    if (nextReceiver !== undefined) setReceiverText(nextReceiver)
    setForm((state) => ({ ...state, ...rest }))
    setTouched((state) => new Set([...state, ...Object.keys(patch)]))
    if (patch.chainId !== undefined) dispatch({ type: 'set', phase: TX_IDLE })
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
    // The final check shows the server's prediction, so it waits for one; the button is disabled meanwhile.
    if (!prepared || predicting) return
    if (phase.step === 'failed') dispatch({ type: 'set', phase: TX_IDLE })
    setDialogOpen(true)
  }

  /** Deploys with the current form, or checks a deploy already sent (`sent`): the machine does the rest. */
  async function deploy(sent?: PendingDeploy) {
    const input = sent?.form ?? deployForm
    if (!input || (!sent && !ready)) return
    setNotice(null)
    const store = browserStore()
    const deployChainId = input.chainId
    let result: DeployRecord | null = null
    try {
      result = await runDeploy(
        {
          form: input,
          account: sample || wallet.connected ? wallet.address : undefined,
          connectedChainId: wallet.chainId,
          sentHash: sent?.hash,
        },
        {
          prepare: (form) => actions.prepare(form),
          switchChain: (id) => actions.switchChain(id),
          simulate: (ready) => actions.simulate(ready),
          wait: (hash) => actions.wait(hash, deployChainId),
          confirm: (hash, form) => actions.confirm(hash, form),
          remember: (hash, form) => {
            if (!sample) rememberDeploy(store, collection.id, { hash, form })
          },
          forget: () => {
            if (!sample) forgetDeploy(store, collection.id)
          },
          sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
          now: () => Date.now(),
        },
        dispatch,
      )
    } catch (error) {
      // The machine classifies every failure it expects; a throw it did not must not leave the dialog on a
      // spinner. A remembered hash stays in the store, so the recovery panel offers "Check again".
      dispatch({ type: 'failed', failure: classifyError(error, 'confirming', 'deploy') })
    }
    if (!sample) setResumable(pendingDeploy(store, collection.id))
    if (!result) return
    setRecord(result)
    setJustDeployed(true)
    setDialogOpen(false)
    // The collection is deployed: the stepper and Manage drop open on the next render.
    if (!sample) router.refresh()
  }

  /** "Try again" in the dialog: a deploy sent but not confirmed is checked, not sent again. */
  function tryAgain() {
    const hash = retryHash(phase)
    if (hash) {
      const pending = resumable?.hash === hash ? resumable : deployForm ? { hash, form: deployForm } : null
      if (pending) return deploy(pending)
    }
    return deploy()
  }

  function checkTyped() {
    const text = hashText.trim()
    if (!HASH_RE.test(text)) return setNotice(NOT_A_HASH)
    if (!deployForm) return setNotice(FORM_FIRST)
    const pending = { hash: text as Hex, form: deployForm }
    rememberDeploy(browserStore(), collection.id, pending)
    setResumable(pending)
    return deploy(pending)
  }

  function discard() {
    forgetDeploy(browserStore(), collection.id)
    setResumable(null)
    setNotice(null)
    dispatch({ type: 'set', phase: TX_IDLE })
  }

  if (record) {
    return (
      <div className="flex flex-1 flex-col">
        <div className="pb-10">
          <DeployedView
            collection={current}
            record={record}
            chain={chainView(record.chainId)}
            artSrc={props.artSrc}
            focusOnMount={justDeployed}
          />
        </div>
        {/* Continue and the primary action both lead to Manage drop: one button is enough. */}
        <StageFooter previous={previous}>
          <SetUpDropButton collectionId={collection.id} />
        </StageFooter>
      </div>
    )
  }

  const check: FinalCheck | null =
    ready && deployForm && prepared && chain && fees.data && linkSlug
      ? {
          name: collection.name,
          mintPageLink: `cobweb.app/${linkSlug}`,
          symbol: collection.symbol,
          maxSupply,
          chain,
          walletChain,
          predicted: prepared.predicted,
          payout: deployForm.payout,
          royaltyBps: deployForm.royaltyBps,
          royaltyReceiver: deployForm.royaltyReceiver,
          publicCap: deployForm.publicMaxPerWallet,
          phases: deployForm.groups,
          fees: fees.data,
          deployCostWei: cost.kind === 'ready' ? cost.wei : undefined,
        }
      : null

  const hint =
    maxSupply === 0
      ? 'Set the supply in Art first.'
      : !startsOn
        ? 'Render the art before deploying.'
        : !linkSlug
          ? 'Reserve your mint page link first.'
          : !chain
            ? 'Choose a chain to deploy on.'
            : fees.status === 'loading' && !fees.data
              ? 'Reading fees from the factory.'
              : fees.status === 'error'
                ? 'Fees could not be read.'
                : !sample && !wallet.connected
                  ? 'Connect your wallet to deploy.'
                  : !valid
                    ? null
                    : predictError
                      ? predictError
                      : predicting || !prepared
                        ? PREDICTING
                        : null
  const checking = !dialogOpen && phase.step !== 'idle'

  return (
    <div className="flex flex-1 flex-col">
      <div className="grid items-start gap-8 pb-10 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_25rem]">
        <div className="space-y-8">
          <DeployFormPanel
            collection={collection}
            chains={chains}
            fixedChainId={fixedChainId}
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
            onChange={(nextPhases) => {
              setPhases(nextPhases)
              setTouched((state) => new Set([...state, 'phases']))
            }}
            maxSupply={maxSupply}
            chain={chain}
            readOnly={readOnly}
            showErrors={showAll || touched.has('phases')}
          />
          {!readOnly && !sample && (
            <Panel
              title="Sent from elsewhere?"
              description="A deploy sent outside this page, or one this page lost, is recorded from its transaction hash. Cobweb checks it against the settings above."
            >
              <div className="space-y-4">
                {resumable && !running && (
                  <Alert>
                    <InfoIcon aria-hidden="true" />
                    <AlertTitle>A deploy is waiting to be checked</AlertTitle>
                    <AlertDescription>
                      <p>
                        This browser sent a deploy for this collection that Cobweb has not recorded yet. Check
                        it before you deploy again.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => void deploy(resumable)}
                          disabled={running}
                        >
                          {phase.step === 'failed' ? 'Check again' : 'Check the deploy'}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={discard} disabled={running}>
                          Discard this attempt
                        </Button>
                      </div>
                    </AlertDescription>
                  </Alert>
                )}
                {checking && (
                  <TxProgress
                    phase={phase}
                    txUrl={chain?.explorerUrl ? (hash) => `${chain.explorerUrl}/tx/${hash}` : undefined}
                    steps={[
                      {
                        step: 'verifying',
                        label: 'Recording the contract',
                        detail:
                          'Cobweb reads the factory event from the receipt and records the address once it equals the prediction.',
                      },
                    ]}
                  />
                )}
                {hashOpen ? (
                  <div className="space-y-2">
                    <Label htmlFor="deploy-hash">Transaction hash</Label>
                    <div className="flex flex-wrap gap-2">
                      <Input
                        id="deploy-hash"
                        value={hashText}
                        onChange={(event) => setHashText(event.target.value)}
                        placeholder="0x"
                        spellCheck={false}
                        className="numeric max-w-xl min-w-0 flex-1"
                        disabled={running}
                        aria-invalid={notice === NOT_A_HASH}
                        aria-describedby="deploy-hash-help"
                      />
                      <Button variant="secondary" onClick={checkTyped} disabled={running || !hashText.trim()}>
                        Check this hash
                      </Button>
                    </div>
                    <p id="deploy-hash-help" className="text-muted-foreground text-[0.8125rem] leading-snug">
                      Use this if you deployed and this page lost the transaction. The settings above must be
                      the ones the contract was deployed with.
                    </p>
                  </div>
                ) : (
                  <Button variant="link" className="h-auto p-0" onClick={() => setHashOpen(true)}>
                    I have a transaction hash
                  </Button>
                )}
                {notice && <p className="text-destructive-foreground text-[0.8125rem]">{notice}</p>}
              </div>
            </Panel>
          )}
        </div>
        <aside aria-label="Deploy summary" className="lg:sticky lg:top-6">
          <DeploySummary
            collection={current}
            chain={chain}
            fees={fees}
            onRetryFees={() => setFeesAttempt((count) => count + 1)}
            cost={cost}
            predicted={prepared?.predicted ?? null}
            predicting={predicting}
            predictError={predictError}
            payout={payoutAddress}
            royaltyBps={bps}
            royaltyReceiver={receiver}
            startsOn={startsOn}
            startsOnPlaceholder={startsOnPlaceholder}
            revealsTo={revealsTo}
            artSrc={props.artSrc}
          />
        </aside>
      </div>

      <StageFooter previous={previous}>
        {hint && <p className="text-muted-foreground text-sm">{hint}</p>}
        {!readOnly && (
          <Button
            onClick={openFinalCheck}
            disabled={
              maxSupply === 0 ||
              !startsOn ||
              !linkSlug ||
              !chain ||
              fees.status !== 'ready' ||
              (!sample && !wallet.connected) ||
              (valid && (!prepared || predicting))
            }
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
        onDeploy={() => void tryAgain()}
      />
    </div>
  )
}
