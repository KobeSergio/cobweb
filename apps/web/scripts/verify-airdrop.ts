// Checks Airdrop against a LOCAL Anvil chain and LOCAL Supabase (docs/specs/2026-10-15-airdrop-settings.md,
// section 10): a collection deployed through the factory with Public (free, 3) of three tokens; the platform
// admin (Anvil's first account, unlocked on the node) sets the airdrop fee; batches are built with airdropCalls,
// simulated as wagmi does, sent from the creator's key (the contract's owner) and confirmed through the core from
// their receipts and calldata: a short value, two wallets, the same hash again, over supply, a contract recipient,
// a burn; the confirm's refusals, a stranger's session, the owner check and the copy when the chain does not
// answer; then the gas of a full batch (500 wallets, 1,000 tokens) on a collection of 1,000 deployed straight
// through the factory. Fifteen PASS lines with the cleanup.
//
//   supabase start
//   pnpm --filter @cobweb/web chain:local    (then copy its two lines into apps/web/.env.local)
//   pnpm --filter @cobweb/web verify:airdrop
//
// The fixture (scripts/deploy-fixture.ts) reads the settings from the environment, `supabase status -o env`
// and apps/web/.env.local, and refuses non-local endpoints. Never prints a key. Deletes every row it
// creates. Runs under `node --conditions=react-server --import ./scripts/resolve-ts.mjs`.

import { randomUUID } from 'node:crypto'
import { getAddress, keccak256, parseEther, toHex, type Address, type Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { collectionAbi } from '@cobweb/shared/collection-abi'
import {
  admin,
  chain,
  chainReady,
  check,
  CID,
  collectionSalt,
  COLLECTION_CREATION_CODE,
  deploy,
  deployedCollection,
  encodeCollectionArgs,
  factory,
  handOver,
  predictCollectionAddress,
  refusal,
  removeFixtures,
  rpc,
  runChecks,
  sendCall,
  setAirdropFee,
  settings,
  signIn,
  simulationSentence,
  type Deployed,
  type DeployForm,
  type ManageCall,
} from './deploy-fixture.ts'

const { airdropViewCore, confirmAirdropCore } = await import('../src/lib/manage/airdrop-core.ts')
const { airdropCalls, phaseCalls } = await import('../src/lib/manage/phase-calls.ts')
const { BURN_ADDRESS } = await import('../src/lib/manage/airdrop-view.ts')
const { proveAirdrop } = await import('../src/lib/chain/airdrop-batch.ts')
const { NOT_DEPLOYED, NOT_FROM_WALLET, NOT_THIS_CHANGE, NOT_THIS_CONTRACT } =
  await import('../src/lib/art/result.ts')
type AirdropContext = import('../src/lib/manage/airdrop-core.ts').AirdropContext
type AirdropView = import('../src/lib/manage/airdrop-types.ts').AirdropView

/** The airdrop fee the platform admin sets (`setAirdropFee`): 0.0001 ETH a token. */
const FEE = 100_000_000_000_000n
/** The per-transaction gas cap some chains apply. */
const TX_GAS_CAP = 16_777_216n

/** A fresh wallet for each tag and index, from their keccak. */
const wallet = (tag: string, index: number): Address =>
  getAddress(`0x${keccak256(toHex(`${tag} ${index}`)).slice(26)}`)

/** The collection's airdrop rows, newest block first, as the service role reads them. */
async function airdropRows(cid: string) {
  const { data, error } = await admin
    .from('airdrops')
    .select(
      'tx_hash, kind, recipients, tokens, fee_paid_wei::text, first_token_id, last_token_id, block, sent_by',
    )
    .eq('collection_id', cid)
    .order('block', { ascending: false })
  if (error) throw new Error(`airdrops: ${error.message}`)
  return data
}

/** What a view says of the contract, for one comparison. */
const summary = (view: AirdropView) =>
  JSON.stringify([
    view.owner,
    view.feePerTokenWei,
    view.maxSupply,
    view.totalMinted,
    view.left,
    view.chainReachable,
  ])

async function main(): Promise<void> {
  console.log(`Verifying airdrop on ${rpc} against ${settings.url}`)
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
    payout: creatorKey.address,
    royaltyBps: 500,
    royaltyReceiver: creatorKey.address,
    publicMaxPerWallet: 1,
    groups: [{ name: 'Public', priceWei: '0', maxSupply: 3 }],
  }
  let deployed: Deployed | null = null
  /** The collection check 2 deploys; every later check runs on it. */
  const subject = (): Deployed => {
    if (!deployed) throw new Error('the collection of check 2 is not deployed')
    return deployed
  }
  /** Sends a batch from the creator and confirms it through the core, as the confirm action does. */
  const airdrop = async (call: ManageCall): Promise<{ view: AirdropView; hash: Hex }> => {
    const { ctx, record } = subject()
    const hash = await sendCall(creatorKey, record.contractAddress, call)
    const outcome = await confirmAirdropCore(ctx, hash)
    if (!('data' in outcome)) throw new Error(`confirm: ${refusal(outcome)}`)
    return { view: outcome.data, hash }
  }
  /** A batch of one token to one wallet at the fee. */
  const single = (address: Address) => airdropCalls.batch([{ address, amount: 1 }], FEE.toString())
  let feesHash: Hex | null = null
  let batchHash: Hex | null = null
  let batchView: AirdropView | null = null

  await check(
    '2. read: a collection deployed with Public (free, 3) of three tokens reads max supply 3, minted 0, left 3, the fee 0, the owner the creator and no history',
    async () => {
      deployed = await deployedCollection(creator, form, 'airdrop')
      const outcome = await airdropViewCore(deployed.ctx)
      if (!('data' in outcome)) return refusal(outcome)
      const view = outcome.data
      return summary(view) === JSON.stringify([creatorKey.address, '0', 3, 0, 3, true]) &&
        view.history.length === 0 &&
        view.contract === deployed.record.contractAddress
        ? null
        : JSON.stringify(view)
    },
  )

  await check(
    "3. fee: the platform admin's setFees(0, 0, 100000000000000) lands and the view reads the fee as 100000000000000 wei",
    async () => {
      const { ctx, record } = subject()
      feesHash = await setAirdropFee(record.contractAddress, FEE)
      const outcome = await airdropViewCore(ctx)
      if (!('data' in outcome)) return refusal(outcome)
      return outcome.data.feePerTokenWei === FEE.toString() ? null : JSON.stringify(outcome.data)
    },
  )

  await check(
    '4. short value: a one-token batch simulated with 1 wei less is refused with the fee in ETH, and no row is written',
    async () => {
      const { cid, record } = subject()
      const short: ManageCall = { ...single(wallet('short', 0)), value: FEE - 1n } as ManageCall
      const sentence = await simulationSentence(creatorKey, record.contractAddress, short)
      if (
        sentence !==
        'The airdrop fee is 0.0001 ETH and 0.000099999999999999 ETH was sent. Read again for the current fee. Nothing was sent.'
      )
        return sentence
      return (await airdropRows(cid)).length === 0 ? null : 'a row was written'
    },
  )

  await check(
    "5. batch: two fresh wallets with one token each (value 200000000000000) confirmed record one row with ids 1 to 2, the receipt's block and the creator; the wallets hold them, minted 2, left 1, the platform holds the fee",
    async () => {
      const { cid, record } = subject()
      const recipients = [wallet('batch', 0), wallet('batch', 1)]
      const call = airdropCalls.batch(
        recipients.map((address) => ({ address, amount: 1 })),
        FEE.toString(),
      )
      if (call.value !== 2n * FEE) return `value ${call.value}`
      const { view, hash } = await airdrop(call)
      batchHash = hash
      batchView = view
      const receipt = await chain.getTransactionReceipt({ hash })
      const owners = await Promise.all(
        [1n, 2n].map((id) =>
          chain.readContract({
            address: record.contractAddress,
            abi: collectionAbi,
            functionName: 'ownerOf',
            args: [id],
          }),
        ),
      )
      const platform = await chain.readContract({
        address: record.contractAddress,
        abi: collectionAbi,
        functionName: 'platformBalance',
      })
      const expected = {
        tx_hash: hash,
        kind: 'airdrop',
        recipients: 2,
        tokens: 2,
        fee_paid_wei: '200000000000000',
        first_token_id: 1,
        last_token_id: 2,
        block: Number(receipt.blockNumber),
        sent_by: creatorKey.address.toLowerCase(),
      }
      const rows = await airdropRows(cid)
      const problems = [
        JSON.stringify(rows) === JSON.stringify([expected]) ? null : `rows ${JSON.stringify(rows)}`,
        JSON.stringify(owners) === JSON.stringify(recipients) ? null : `owners ${JSON.stringify(owners)}`,
        view.totalMinted === 2 && view.left === 1 && view.history.length === 1 ? null : summary(view),
        platform === 2n * FEE ? null : `platform balance ${platform}`,
      ].filter(Boolean)
      return problems.length ? problems.join('; ') : null
    },
  )

  await check(
    '6. again: the same hash confirmed again answers the same view, and airdrop_record with the same arguments answers false',
    async () => {
      const { cid, ctx } = subject()
      if (!batchHash || !batchView) return 'no batch'
      const again = await confirmAirdropCore(ctx, batchHash)
      if (!('data' in again)) return refusal(again)
      const [row] = await airdropRows(cid)
      const recorded = await admin.rpc('airdrop_record', {
        p_collection_id: cid,
        p_owner: creator.userId,
        p_tx: batchHash,
        p_kind: 'airdrop',
        p_recipients: 2,
        p_tokens: 2,
        p_fee_paid_wei: 200_000_000_000_000,
        p_first_token_id: 1,
        p_last_token_id: 2,
        p_block: row?.block ?? 0,
        p_sent_by: creatorKey.address.toLowerCase(),
      })
      if (recorded.error) return `record: ${recorded.error.message}`
      return summary(again.data) === summary(batchView) &&
        JSON.stringify(again.data.history) === JSON.stringify(batchView.history) &&
        recorded.data === false &&
        (await airdropRows(cid)).length === 1
        ? null
        : `${JSON.stringify(recorded.data)} ${summary(again.data)}`
    },
  )

  await check(
    '7. over supply: a two-token batch reads that only 1 token is left, and nothing is sent',
    async () => {
      const { record } = subject()
      const nonce = await chain.getTransactionCount({ address: creatorKey.address })
      const call = airdropCalls.batch([{ address: wallet('over', 0), amount: 2 }], FEE.toString())
      const sentence = await simulationSentence(creatorKey, record.contractAddress, call)
      if (sentence !== 'Only 1 token is left to mint, not 2. Nothing was sent.') return sentence
      return (await chain.getTransactionCount({ address: creatorKey.address })) === nonce
        ? null
        : 'a transaction was sent'
    },
  )

  await check(
    '8. contract recipient: a one-token batch to the factory reads that a recipient cannot receive ERC-721 tokens',
    async () => {
      const { record } = subject()
      const sentence = await simulationSentence(creatorKey, record.contractAddress, single(factory))
      return sentence ===
        'One recipient is a contract that cannot receive ERC-721 tokens. Send to wallets only. Nothing was sent.'
        ? null
        : sentence
    },
  )

  await check(
    '9. burn: a burn of one is confirmed as a burn row with ids 3 to 3 and with the fee the event says was paid, the dead address holds token 3, left 0, the history newest first',
    async () => {
      const { cid, record } = subject()
      // One wei over the fee, as when the admin lowers the fee after the read: the contract refunds the excess,
      // and the row carries the fee the event says was paid.
      const burn = airdropCalls.burn(1, FEE.toString())
      const { view } = await airdrop({ ...burn, value: FEE + 1n } as ManageCall)
      const [latest] = await airdropRows(cid)
      const owner = await chain.readContract({
        address: record.contractAddress,
        abi: collectionAbi,
        functionName: 'ownerOf',
        args: [3n],
      })
      return latest?.kind === 'burn' &&
        latest.recipients === 1 &&
        latest.tokens === 1 &&
        latest.fee_paid_wei === FEE.toString() &&
        latest.first_token_id === 3 &&
        latest.last_token_id === 3 &&
        owner === BURN_ADDRESS &&
        view.left === 0 &&
        view.history.map((row) => row.kind).join(' ') === 'burn airdrop'
        ? null
        : `${JSON.stringify(latest)} ${owner} ${summary(view)}`
    },
  )

  await check(
    "10. refusals: the admin's setFees is not from the wallet, an Open of Public is not this change, the deploy is not this contract; nothing is recorded",
    async () => {
      const { cid, ctx, record, hash: deployHash } = subject()
      if (!feesHash) return 'no setFees'
      const openHash = await sendCall(creatorKey, record.contractAddress, phaseCalls.open(0))
      const problems: string[] = []
      for (const [label, hash, sentence] of [
        ['setFees', feesHash, NOT_FROM_WALLET],
        ['Open', openHash, NOT_THIS_CHANGE],
        ['deploy', deployHash, NOT_THIS_CONTRACT],
      ] as const) {
        const outcome = await confirmAirdropCore(ctx, hash)
        if (refusal(outcome) !== sentence) problems.push(`${label}: ${refusal(outcome)}`)
      }
      if (problems.length) return problems.join('; ')
      return (await airdropRows(cid)).length === 2 ? null : 'a row was recorded'
    },
  )

  await check(
    "11. stranger: the stranger's session reads no deployment and no rows, its confirm is refused as not deployed, and its raw record is refused",
    async () => {
      const { cid, ctx } = subject()
      if (!batchHash) return 'no batch'
      const strangerCtx: AirdropContext = {
        supabase: stranger.client,
        service: () => admin,
        owner: stranger.userId,
        wallet: strangerKey.address.toLowerCase(),
        collection: ctx.collection,
      }
      const read = await airdropViewCore(strangerCtx)
      if (refusal(read) !== NOT_DEPLOYED) return `read: ${refusal(read)}`
      const confirmed = await confirmAirdropCore(strangerCtx, batchHash)
      if (refusal(confirmed) !== NOT_DEPLOYED) return `confirm: ${refusal(confirmed)}`
      const rows = await stranger.client.from('airdrops').select('tx_hash').eq('collection_id', cid)
      if (rows.error) return `rows: ${rows.error.message}`
      if (rows.data.length) return `the stranger reads ${rows.data.length} row(s)`
      const raw = await stranger.client.rpc('airdrop_record', {
        p_collection_id: cid,
        p_owner: stranger.userId,
        p_tx: `0x${'ab'.repeat(32)}`,
        p_kind: 'airdrop',
        p_recipients: 1,
        p_tokens: 1,
        p_fee_paid_wei: 0,
        p_first_token_id: 1,
        p_last_token_id: 1,
        p_block: 1,
        p_sent_by: strangerKey.address.toLowerCase(),
      })
      return raw.error?.code === '42501' ? null : `raw record: ${raw.error?.code ?? 'accepted'}`
    },
  )

  await check(
    "12. owner: once the creator hands the contract to the stranger the view's owner is the stranger and the creator's batch is refused as not the owner; ownership comes back",
    async () => {
      const { ctx, record } = subject()
      const address = record.contractAddress
      await handOver(creatorKey, address, strangerKey.address)
      const handed = await airdropViewCore(ctx)
      const sentence = await simulationSentence(creatorKey, address, single(wallet('owner', 0)))
      await handOver(strangerKey, address, creatorKey.address)
      const back = await airdropViewCore(ctx)
      if (!('data' in handed) || !('data' in back)) return `${refusal(handed)} ${refusal(back)}`
      return handed.data.owner === strangerKey.address &&
        sentence ===
          `Only the contract's owner can make this change, and ${creatorKey.address} is not the owner. Nothing was sent.` &&
        back.data.owner === creatorKey.address
        ? null
        : `${handed.data.owner} ${sentence} ${back.data.owner}`
    },
  )

  await check(
    '13. failure path: a read that does not answer gives both rows, unreachable, with no owner, fee, minted or left',
    async () => {
      const { ctx } = subject()
      const outcome = await airdropViewCore(ctx, async () => null)
      if (!('data' in outcome)) return refusal(outcome)
      const view = outcome.data
      return summary(view) === JSON.stringify([null, null, 3, null, null, false]) && view.history.length === 2
        ? null
        : JSON.stringify(view)
    },
  )

  await check(
    '14. gas: one batch of 500 fresh wallets with 2 tokens each lands on a collection of 1,000 deployed through the factory; its proof reads 500 recipients, 1,000 tokens and ids 1 to 1,000',
    async () => {
      const encoded = encodeCollectionArgs({
        name: 'Gas check',
        symbol: 'GAS',
        payout: creatorKey.address,
        baseUri: `ipfs://${CID('g')}/`,
        maxSupply: 1_000n,
        groupSupplies: [1_000n],
        groupPrices: [0n],
        publicMaxPerWallet: 1n,
        royaltyBps: 0,
        owner: creatorKey.address,
        royaltyReceiver: creatorKey.address,
      })
      const salt = collectionSalt(randomUUID())
      const collection = predictCollectionAddress({
        factory,
        deployer: creatorKey.address,
        salt,
        creationCode: COLLECTION_CREATION_CODE,
        args: encoded,
      })
      await deploy(creatorKey, encoded, salt)
      await setAirdropFee(collection, FEE)
      const entries = Array.from({ length: 500 }, (_, index) => ({
        address: wallet('gas', index),
        amount: 2,
      }))
      const call = airdropCalls.batch(entries, FEE.toString())
      if (call.value !== 100_000_000_000_000_000n) return `value ${call.value}`
      const hash = await sendCall(creatorKey, collection, call)
      const receipt = await chain.getTransactionReceipt({ hash })
      const { input } = await chain.getTransaction({ hash })
      const proof = proveAirdrop(receipt, input, { contract: collection, from: creatorKey.address })
      const over = receipt.gasUsed > TX_GAS_CAP ? `, above the ${TX_GAS_CAP.toLocaleString('en-US')} cap` : ''
      console.log(
        `  gas used by one batch of 500 wallets and 1,000 tokens: ${receipt.gasUsed.toLocaleString('en-US')}${over}`,
      )
      return proof.ok &&
        proof.batch.recipients === 500 &&
        proof.batch.tokens === 1_000 &&
        proof.batch.firstTokenId === 1 &&
        proof.batch.lastTokenId === 1_000
        ? null
        : JSON.stringify(proof)
    },
  )
}

async function cleanup(): Promise<void> {
  await check(
    '15. cleanup: the run leaves no job, deployment, phase, whitelist entry, airdrop, withdrawal, collection or user behind',
    removeFixtures,
  )
}

await runChecks(main, cleanup)
