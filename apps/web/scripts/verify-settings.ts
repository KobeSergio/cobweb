// Checks Settings against a LOCAL Anvil chain and LOCAL Supabase (docs/specs/2026-10-15-airdrop-settings.md,
// section 10): a collection deployed through the factory with Public (0.001 ETH, 3, 2 per wallet) of three tokens,
// a royalty of 5% to the creator and another address as payout; the read at one block and its copies; every change
// built with settingsCalls (Open with phaseCalls), simulated as wagmi does, sent from the creator's key (the
// contract's owner) and confirmed through the core from its receipt: nothing to withdraw, a withdrawal, the same
// hash again, the payout, the royalty, a custom link and back to the real job, mint on behalf, the validator;
// an older read, the confirm's refusals, a stranger's session, the owner check and the copy when the chain does
// not answer. Seventeen PASS lines with the cleanup.
//
//   supabase start
//   pnpm --filter @cobweb/web chain:local    (then copy its two lines into apps/web/.env.local)
//   pnpm --filter @cobweb/web verify:settings
//
// The fixture (scripts/deploy-fixture.ts) reads the settings from the environment, `supabase status -o env`
// and apps/web/.env.local, and refuses non-local endpoints. Never prints a key. Deletes every row it
// creates. Runs under `node --conditions=react-server --import ./scripts/resolve-ts.mjs`.

import {
  createWalletClient,
  getAddress,
  http,
  keccak256,
  parseEther,
  toHex,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { anvil } from 'viem/chains'
import { DEFAULT_TRANSFER_VALIDATOR } from '@cobweb/shared'
import { collectionAbi } from '@cobweb/shared/collection-abi'
import {
  admin,
  chain,
  chainReady,
  check,
  CID,
  deployedCollection,
  factory,
  handOver,
  readDeployment,
  refusal,
  removeFixtures,
  rpc,
  runChecks,
  sendCall,
  settings,
  signIn,
  simulationSentence,
  type Deployed,
  type DeployForm,
  type ManageCall,
} from './deploy-fixture.ts'

const { confirmSettingsTxCore, settingsViewCore } = await import('../src/lib/manage/settings-core.ts')
const { confirmPhaseTxCore } = await import('../src/lib/manage/phases-core.ts')
const { callOf, expectedEvent, phaseCalls, sentOf, SETTINGS_FUNCTIONS, settingsCalls } =
  await import('../src/lib/manage/phase-calls.ts')
const { parseSentCall } = await import('../src/lib/manage/phase-schemas.ts')
const { NOT_DEPLOYED, NOT_FROM_WALLET, NOT_THIS_CHANGE, NOT_THIS_CONTRACT, UNSAVED } =
  await import('../src/lib/art/result.ts')
type SettingsContext = import('../src/lib/manage/settings-core.ts').SettingsContext
type SettingsView = import('../src/lib/manage/settings-types.ts').SettingsView

const PUBLIC_PRICE = 1_000_000_000_000_000n
const REAL = `ipfs://${CID('e')}/`
const CUSTOM = `ipfs://${CID('f')}/`

/** A fresh address for each tag, from its keccak. */
const fresh = (tag: string): Address => getAddress(`0x${keccak256(toHex(tag)).slice(26)}`)
/** The payout the collection is deployed with: not the creator, so a withdrawal's payout comes from its event. */
const DEPLOY_PAYOUT = fresh('deploy payout')

type CopyRow = {
  payout_address: string
  royalty_bps: number
  royalty_receiver: string
  base_uri: string
  transfer_validator: string | null
  mint_on_behalf: boolean
  state_block: number | null
  state_read_at: string | null
}

/** The deployment's settings copies and the read they came from, as the service role reads them. */
async function copyOf(cid: string): Promise<CopyRow> {
  const { data, error } = await admin
    .from('deployments')
    .select(
      'payout_address, royalty_bps, royalty_receiver, base_uri, transfer_validator, mint_on_behalf, state_block, state_read_at',
    )
    .eq('collection_id', cid)
    .single()
  if (error) throw new Error(`copy: ${error.message}`)
  return data
}

/** The collection's withdrawal rows, as the service role reads them. */
async function withdrawalRows(cid: string) {
  const { data, error } = await admin
    .from('withdrawals')
    .select('tx_hash, amount_wei::text, payout_address, block')
    .eq('collection_id', cid)
  if (error) throw new Error(`withdrawals: ${error.message}`)
  return data
}

/** The settings a view shows and the copies hold alike, for one comparison. */
const settingsOf = (view: SettingsView) =>
  JSON.stringify([
    view.payout,
    view.royaltyBps,
    view.royaltyReceiver,
    view.baseUri,
    view.transferValidator,
    view.mintOnBehalf,
  ])
const copiedOf = (copy: CopyRow) =>
  JSON.stringify([
    getAddress(copy.payout_address),
    copy.royalty_bps,
    getAddress(copy.royalty_receiver),
    copy.base_uri,
    copy.transfer_validator === null ? null : getAddress(copy.transfer_validator),
    copy.mint_on_behalf,
  ])

async function main(): Promise<void> {
  console.log(`Verifying settings on ${rpc} against ${settings.url}`)
  await check(
    '1. chain: Anvil answers as 31337 and the factory approves the shipped creation code hash',
    chainReady,
  )

  const creatorKey = privateKeyToAccount(generatePrivateKey())
  const strangerKey = privateKeyToAccount(generatePrivateKey())
  await chain.setBalance({ address: creatorKey.address, value: parseEther('10') })
  await chain.setBalance({ address: strangerKey.address, value: parseEther('10') })
  const creator = await signIn(creatorKey)
  const stranger = await signIn(strangerKey)

  const form: DeployForm = {
    chainId: 31337,
    payout: DEPLOY_PAYOUT,
    royaltyBps: 500,
    royaltyReceiver: creatorKey.address,
    publicMaxPerWallet: 2,
    groups: [{ name: 'Public', priceWei: PUBLIC_PRICE.toString(), maxSupply: 3 }],
  }
  let deployed: Deployed | null = null
  /** The collection check 2 deploys; every later check runs on it. */
  const subject = (): Deployed => {
    if (!deployed) throw new Error('the collection of check 2 is not deployed')
    return deployed
  }
  /** Sends a change from the creator and confirms it through the core, as the confirm action does. */
  const change = async (call: ManageCall): Promise<{ view: SettingsView; hash: Hex }> => {
    const { ctx, record } = subject()
    const hash = await sendCall(creatorKey, record.contractAddress, call)
    const outcome = await confirmSettingsTxCore(ctx, hash, sentThrough(call))
    if (!('data' in outcome)) throw new Error(`confirm ${call.functionName}: ${refusal(outcome)}`)
    return { view: outcome.data, hash }
  }
  /** The call after its trip through SentCall and the Settings shape, as the confirm action takes it. */
  const sentThrough = (call: ManageCall): ManageCall => {
    const sent = parseSentCall(sentOf(call), SETTINGS_FUNCTIONS)
    if (!sent.ok) throw new Error(`the sent call is refused: ${sent.error}`)
    return callOf(sent.data)
  }
  const read = async (): Promise<SettingsView> => {
    const outcome = await settingsViewCore(subject().ctx)
    if (!('data' in outcome)) throw new Error(`read: ${refusal(outcome)}`)
    return outcome.data
  }
  let withdrawHash: Hex | null = null
  let withdrawView: SettingsView | null = null
  let mintHash: Hex | null = null
  let royaltyHash: Hex | null = null
  let customHash: Hex | null = null

  await check(
    '2. read: the owner, balances of 0, nothing withdrawn, fees of 0, the deploy-time payout and 5% to the creator, the real base URI revealed, mint on behalf off, the default validator without code; the copies equal the read',
    async () => {
      deployed = await deployedCollection(creator, form, 'settings')
      const view = await read()
      const onChain = await chain.readContract({
        address: deployed.record.contractAddress,
        abi: collectionAbi,
        functionName: 'DEFAULT_TRANSFER_VALIDATOR',
      })
      const copy = await copyOf(deployed.cid)
      const problems = [
        view.owner === creatorKey.address &&
        view.creatorBalanceWei === '0' &&
        view.platformBalanceWei === '0' &&
        view.pendingBalanceWei === '0' &&
        view.withdrawnWei === '0' &&
        JSON.stringify(view.fees) ===
          JSON.stringify({ mintFeeFlatWei: '0', mintFeeBps: 0, airdropFeePerTokenWei: '0' })
          ? null
          : `money ${JSON.stringify(view)}`,
        settingsOf(view) ===
        JSON.stringify([DEPLOY_PAYOUT, 500, creatorKey.address, REAL, DEFAULT_TRANSFER_VALIDATOR, false])
          ? null
          : `settings ${settingsOf(view)}`,
        view.pointer === 'revealed' &&
        view.realArtRendered &&
        view.targets.placeholder === null &&
        JSON.stringify(view.level) === JSON.stringify({ kind: 'none', reason: 'no-code' })
          ? null
          : `reveal ${JSON.stringify([view.pointer, view.targets, view.level])}`,
        onChain === DEFAULT_TRANSFER_VALIDATOR ? null : `DEFAULT_TRANSFER_VALIDATOR() ${onChain}`,
        copiedOf(copy) === settingsOf(view) &&
        copy.state_block !== null &&
        copy.state_read_at !== null &&
        Date.parse(copy.state_read_at) / 1000 === view.readAt
          ? null
          : `copy ${JSON.stringify(copy)}`,
      ].filter(Boolean)
      return problems.length ? problems.join('; ') : null
    },
  )

  await check(
    '3. nothing to withdraw: withdrawMintFunds() at a balance of 0 reads that there is nothing to withdraw, and no row is written',
    async () => {
      const { cid, record } = subject()
      const sentence = await simulationSentence(creatorKey, record.contractAddress, settingsCalls.withdraw())
      if (sentence !== 'There is nothing to withdraw: the balance is 0. Nothing was sent.') return sentence
      return (await withdrawalRows(cid)).length === 0 ? null : 'a row was written'
    },
  )

  await check(
    "4. withdraw: with Public open and the stranger's mint for 0.001 ETH the balance reads 1000000000000000; the withdrawal confirmed records its amount, the deploy-time payout and the receipt's block, and the view reads 0 and withdrawn 1000000000000000",
    async () => {
      const { cid, ctx, record } = subject()
      const address = record.contractAddress
      const open = phaseCalls.open(0)
      const opened = await confirmPhaseTxCore(ctx, await sendCall(creatorKey, address, open), {
        event: expectedEvent(open),
      })
      if (!('data' in opened)) return `open: ${refusal(opened)}`
      const minter = createWalletClient({ account: strangerKey, chain: anvil, transport: http(rpc) })
      mintHash = await minter.writeContract({
        address,
        abi: collectionAbi,
        functionName: 'batchMint',
        args: [1n, 0n],
        value: PUBLIC_PRICE,
      })
      await chain.waitForTransactionReceipt({ hash: mintHash })
      const before = await read()
      if (before.creatorBalanceWei !== PUBLIC_PRICE.toString()) return `balance ${before.creatorBalanceWei}`
      const { view, hash } = await change(settingsCalls.withdraw())
      withdrawHash = hash
      withdrawView = view
      const receipt = await chain.getTransactionReceipt({ hash })
      const rows = await withdrawalRows(cid)
      const expected = [
        {
          tx_hash: hash,
          amount_wei: PUBLIC_PRICE.toString(),
          payout_address: DEPLOY_PAYOUT.toLowerCase(),
          block: Number(receipt.blockNumber),
        },
      ]
      return JSON.stringify(rows) === JSON.stringify(expected) &&
        view.creatorBalanceWei === '0' &&
        view.withdrawnWei === PUBLIC_PRICE.toString()
        ? null
        : `${JSON.stringify(rows)} ${view.creatorBalanceWei} ${view.withdrawnWei}`
    },
  )

  await check(
    '5. again: the withdrawal confirmed again answers the same view, and withdrawal_record answers false: one row still',
    async () => {
      const { cid, ctx } = subject()
      if (!withdrawHash || !withdrawView) return 'no withdrawal'
      const again = await confirmSettingsTxCore(ctx, withdrawHash, settingsCalls.withdraw())
      if (!('data' in again)) return refusal(again)
      const [row] = await withdrawalRows(cid)
      const recorded = await admin.rpc('withdrawal_record', {
        p_collection_id: cid,
        p_owner: creator.userId,
        p_tx: withdrawHash,
        p_amount_wei: 1_000_000_000_000_000,
        p_payout_address: DEPLOY_PAYOUT.toLowerCase(),
        p_block: row?.block ?? 0,
      })
      if (recorded.error) return `record: ${recorded.error.message}`
      return again.data.withdrawnWei === withdrawView.withdrawnWei &&
        settingsOf(again.data) === settingsOf(withdrawView) &&
        recorded.data === false &&
        (await withdrawalRows(cid)).length === 1
        ? null
        : `${JSON.stringify(recorded.data)} ${again.data.withdrawnWei}`
    },
  )

  await check(
    '6. payout: a fresh address confirmed reads in the view and the copy, readDeployment still answers the deploy-time payout, and the zero address is refused by the shape',
    async () => {
      const { cid } = subject()
      const payout = fresh('payout')
      const { view } = await change(settingsCalls.payout(payout))
      const copy = await copyOf(cid)
      const record = await readDeployment(creator.client, cid)
      const zero = parseSentCall(sentOf(settingsCalls.payout(zeroAddress)), SETTINGS_FUNCTIONS)
      return view.payout === payout &&
        getAddress(copy.payout_address) === payout &&
        record?.payout === DEPLOY_PAYOUT &&
        !zero.ok &&
        zero.error === UNSAVED
        ? null
        : `${view.payout} ${copy.payout_address} ${record?.payout} ${JSON.stringify(zero)}`
    },
  )

  await check(
    '7. royalty: 750 bps to a fresh address confirmed reads in the view, in royaltyInfo(1, 10000) and in the copies; 1,001 bps is refused by the shape',
    async () => {
      const { cid, record } = subject()
      const receiver = fresh('royalty')
      const { view, hash } = await change(settingsCalls.royalty(receiver, 750))
      royaltyHash = hash
      const [onChainReceiver, amount] = await chain.readContract({
        address: record.contractAddress,
        abi: collectionAbi,
        functionName: 'royaltyInfo',
        args: [1n, 10_000n],
      })
      const copy = await copyOf(cid)
      const over = parseSentCall(
        { functionName: 'setDefaultRoyalty', args: [receiver, '1001'] },
        SETTINGS_FUNCTIONS,
      )
      return view.royaltyBps === 750 &&
        view.royaltyReceiver === receiver &&
        onChainReceiver === receiver &&
        amount === 750n &&
        copy.royalty_bps === 750 &&
        getAddress(copy.royalty_receiver) === receiver &&
        !over.ok
        ? null
        : `${settingsOf(view)} ${onChainReceiver} ${amount} ${JSON.stringify(copy)}`
    },
  )

  await check(
    "8. custom link: setBaseURI to another CID confirmed reads the pointer custom, the copy, and token 1's URI with the id",
    async () => {
      const { cid, record } = subject()
      const { view, hash } = await change(settingsCalls.baseUri(CUSTOM))
      customHash = hash
      const tokenUri = await chain.readContract({
        address: record.contractAddress,
        abi: collectionAbi,
        functionName: 'tokenURI',
        args: [1n],
      })
      const copy = await copyOf(cid)
      return view.pointer === 'custom' &&
        view.baseUri === CUSTOM &&
        copy.base_uri === CUSTOM &&
        tokenUri === `${CUSTOM}1`
        ? null
        : `${view.pointer} ${view.baseUri} ${copy.base_uri} ${tokenUri}`
    },
  )

  await check(
    "9. back to the real job: its base URI confirmed reads revealed; the custom change's hash confirmed as the real URI's call is not this change, and nothing changes",
    async () => {
      const { cid, ctx } = subject()
      if (!customHash) return 'no custom change'
      const { view } = await change(settingsCalls.baseUri(REAL))
      if (view.pointer !== 'revealed' || view.baseUri !== REAL) return `${view.pointer} ${view.baseUri}`
      const wrong = await confirmSettingsTxCore(ctx, customHash, settingsCalls.baseUri(REAL))
      if (refusal(wrong) !== NOT_THIS_CHANGE) return `custom hash as the real URI: ${refusal(wrong)}`
      return (await copyOf(cid)).base_uri === REAL ? null : 'the copy changed'
    },
  )

  await check(
    '10. mint on behalf: on, then off, each confirmed, reads in the view and the copy',
    async () => {
      const { cid } = subject()
      const on = await change(settingsCalls.mintOnBehalf(true))
      const copyOn = await copyOf(cid)
      const off = await change(settingsCalls.mintOnBehalf(false))
      const copyOff = await copyOf(cid)
      return on.view.mintOnBehalf &&
        copyOn.mint_on_behalf &&
        !off.view.mintOnBehalf &&
        !copyOff.mint_on_behalf
        ? null
        : `${on.view.mintOnBehalf} ${copyOn.mint_on_behalf} ${off.view.mintOnBehalf} ${copyOff.mint_on_behalf}`
    },
  )

  await check(
    '11. validator: the zero address confirmed reads no validator in the view and the copy; the default, simulated, reads that there is no contract at that address',
    async () => {
      const { cid, record } = subject()
      const { view } = await change(settingsCalls.validator(zeroAddress))
      const copy = await copyOf(cid)
      const sentence = await simulationSentence(
        creatorKey,
        record.contractAddress,
        settingsCalls.validator(DEFAULT_TRANSFER_VALIDATOR),
      )
      return view.transferValidator === zeroAddress &&
        JSON.stringify(view.level) === JSON.stringify({ kind: 'none', reason: 'zero' }) &&
        copy.transfer_validator === zeroAddress &&
        sentence ===
          'There is no contract at that address on this chain. A validator must be a contract, or the zero address to remove the check. Nothing was sent.'
        ? null
        : `${view.transferValidator} ${JSON.stringify(view.level)} ${copy.transfer_validator} ${sentence}`
    },
  )

  await check(
    '12. older read: settings_refresh at the block before the copies with other values answers false, and the copies keep the last read',
    async () => {
      const { cid } = subject()
      const before = await copyOf(cid)
      if (before.state_block === null) return 'no state_block'
      const { data, error } = await admin.rpc('settings_refresh', {
        p_collection_id: cid,
        p_owner: creator.userId,
        p_block: before.state_block - 1,
        p_block_time: new Date().toISOString(),
        p_settings: {
          payout_address: fresh('older').toLowerCase(),
          royalty_bps: 100,
          royalty_receiver: fresh('older').toLowerCase(),
          base_uri: CUSTOM,
          transfer_validator: DEFAULT_TRANSFER_VALIDATOR.toLowerCase(),
          mint_on_behalf: true,
        },
      })
      if (error) return error.message
      const after = await copyOf(cid)
      return data === false && JSON.stringify(after) === JSON.stringify(before)
        ? null
        : `${JSON.stringify(data)} ${JSON.stringify(after)}`
    },
  )

  await check(
    "13. refusals: the royalty's hash as a payout change, the stranger's mint, the deploy, and a level call aimed at the factory with the deploy's hash; nothing changes",
    async () => {
      const { cid, ctx, hash: deployHash } = subject()
      if (!royaltyHash || !mintHash) return 'a hash is missing'
      const before = await copyOf(cid)
      const problems: string[] = []
      for (const [label, hash, call, sentence] of [
        ['royalty as payout', royaltyHash, settingsCalls.payout(fresh('payout')), NOT_THIS_CHANGE],
        ["stranger's mint", mintHash, settingsCalls.mintOnBehalf(true), NOT_FROM_WALLET],
        ['deploy', deployHash, settingsCalls.mintOnBehalf(true), NOT_THIS_CONTRACT],
        [
          'level at the factory',
          deployHash,
          settingsCalls.level(factory, subject().record.contractAddress, 9),
          NOT_THIS_CONTRACT,
        ],
      ] as const) {
        const outcome = await confirmSettingsTxCore(ctx, hash, call)
        if (refusal(outcome) !== sentence) problems.push(`${label}: ${refusal(outcome)}`)
      }
      if (problems.length) return problems.join('; ')
      const after = await copyOf(cid)
      return copiedOf(after) === copiedOf(before) ? null : `${JSON.stringify(after)}`
    },
  )

  await check(
    "14. stranger: the stranger's session reads no deployment and no withdrawals, its confirm is refused as not deployed, and its raw refresh is refused",
    async () => {
      const { cid, ctx } = subject()
      if (!withdrawHash) return 'no withdrawal'
      const strangerCtx: SettingsContext = {
        supabase: stranger.client,
        service: () => admin,
        owner: stranger.userId,
        wallet: strangerKey.address.toLowerCase(),
        collection: ctx.collection,
      }
      const view = await settingsViewCore(strangerCtx)
      if (refusal(view) !== NOT_DEPLOYED) return `read: ${refusal(view)}`
      const confirmed = await confirmSettingsTxCore(strangerCtx, withdrawHash, settingsCalls.withdraw())
      if (refusal(confirmed) !== NOT_DEPLOYED) return `confirm: ${refusal(confirmed)}`
      const rows = await stranger.client.from('withdrawals').select('tx_hash').eq('collection_id', cid)
      if (rows.error) return `rows: ${rows.error.message}`
      if (rows.data.length) return `the stranger reads ${rows.data.length} row(s)`
      const raw = await stranger.client.rpc('settings_refresh', {
        p_collection_id: cid,
        p_owner: stranger.userId,
        p_block: 1,
        p_block_time: new Date().toISOString(),
        p_settings: {},
      })
      return raw.error?.code === '42501' ? null : `raw refresh: ${raw.error?.code ?? 'accepted'}`
    },
  )

  await check(
    "15. owner: once the creator hands the contract to the stranger the view's owner is the stranger and mint on behalf from the creator is refused as not the owner; ownership comes back",
    async () => {
      const { record } = subject()
      const address = record.contractAddress
      await handOver(creatorKey, address, strangerKey.address)
      const handed = await read()
      const sentence = await simulationSentence(creatorKey, address, settingsCalls.mintOnBehalf(true))
      await handOver(strangerKey, address, creatorKey.address)
      const back = await read()
      return handed.owner === strangerKey.address &&
        sentence ===
          `Only the contract's owner can make this change, and ${creatorKey.address} is not the owner. Nothing was sent.` &&
        back.owner === creatorKey.address
        ? null
        : `${handed.owner} ${sentence} ${back.owner}`
    },
  )

  await check(
    "16. failure path: a read that does not answer gives the copies and the withdrawn sum, no balance, fee, owner or level, unreachable, at the copy's time",
    async () => {
      const { cid, ctx } = subject()
      const outcome = await settingsViewCore(ctx, async () => null)
      if (!('data' in outcome)) return refusal(outcome)
      const view = outcome.data
      const copy = await copyOf(cid)
      const readAt = copy.state_read_at === null ? null : Date.parse(copy.state_read_at) / 1000
      return !view.chainReachable &&
        settingsOf(view) === copiedOf(copy) &&
        view.withdrawnWei === PUBLIC_PRICE.toString() &&
        view.owner === null &&
        view.creatorBalanceWei === null &&
        view.platformBalanceWei === null &&
        view.pendingBalanceWei === null &&
        view.fees === null &&
        view.level === null &&
        view.readAt === readAt &&
        view.pointer === 'revealed'
        ? null
        : `${JSON.stringify(view)} ${JSON.stringify(copy)}`
    },
  )
}

async function cleanup(): Promise<void> {
  await check(
    '17. cleanup: the run leaves no job, deployment, phase, whitelist entry, airdrop, withdrawal, collection or user behind',
    removeFixtures,
  )
}

await runChecks(main, cleanup)
