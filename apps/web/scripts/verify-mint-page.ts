// Checks the public mint page against LOCAL Supabase, LOCAL storage, a LOCAL Anvil chain and the freshness server
// in process (docs/specs/2026-10-16-mint-page-live-data.md, section 10): a creator deploys a collection of three
// tokens through the cores with Public (0.001 ETH, 2, 1 per wallet) and Holders (free, 1); the Mint page tab's
// cores sign, upload, save and publish its media and sections; then the page's own modules read it as the browser
// does: the document through its builder, the live source's polls at the page's cadence folded into the track, the
// labels at T-1, at a clock reading T while the state is still at T-1, and at T, a mint through runMint and
// wagmiMintChain (the mock connector on the impersonated holder), the local mint, the wallet answers, two
// failed checks, the tiers and the refusals. Seventeen PASS lines with the cleanup.
//
//   supabase start && supabase seed buckets
//   pnpm --filter @cobweb/web chain:local    (then copy its two lines into apps/web/.env.local)
//   pnpm --filter @cobweb/web verify:mint-page
//
// The fixture (scripts/deploy-fixture.ts) reads the settings from the environment, `supabase status -o env` and
// apps/web/.env.local, and refuses non-local endpoints. Never prints a key or a URL: the first line names the
// chain and the two hosts. The cleanup runs every step whatever failed before it: it stops the page's polls
// and the server, releases both wallets (each disconnected and no longer impersonated) and deletes every row
// and object the run created. What stays is on Anvil: the collection with its one mint, the three fresh
// accounts with their balances, and the chain's clock about 600 s ahead of where it was. Runs under `node
// --conditions=react-server --import ./scripts/resolve-ts.mjs`.

import { createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { encodeFunctionData, isAddressEqual, parseEther, type Address } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import type { StateBody } from '@cobweb/shared'
import { collectionAbi } from '@cobweb/shared/collection-abi'
import { startFreshness, TIER_MS, type Freshness, type HealthBody } from '@cobweb/freshness/server'
import type { Database } from '../src/lib/database.types.ts'
import {
  admin,
  chain,
  chainReady,
  check,
  CID,
  deployedCollection,
  factory,
  HEX64,
  readLockCollection,
  refusal,
  removeFixtures,
  rpc,
  runChecks,
  sendCall,
  settings,
  signIn,
  slugFor,
  wagmiWallet,
  type Creator,
  type Deployed,
  type DeployForm,
} from './deploy-fixture.ts'
import { clientOptions } from './render-deps.ts'

// The media URLs are Supabase Storage's public ones for the bucket, as the app's are without MINT_PAGE_MEDIA_URL.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= settings.url

const { mintPageSettingsCore, presignMintPageMediaCore, saveMintPageCore, setMintPagePublishedCore } =
  await import('../src/lib/mint/settings-core.ts')
const { ipfsGateway, mediaUrl } = await import('../src/lib/mint/page-urls.ts')
const { pageDocSchema, pageStaticOf } = await import('../src/lib/mint/page-doc.ts')
const { ranksOf } = await import('../src/lib/mint/ranks-core.ts')
const { liveMintSource } = await import('../src/lib/mint/live-source.ts')
const { cadenceMs, chainNowOf, EMPTY_TRACK, foldState, NEXT_ANSWER_MAX_MS, pollState } =
  await import('../src/lib/mint/fresh-client.ts')
const { liveOf, walletViewOf } = await import('../src/lib/mint/live-data.ts')
const { runMint } = await import('../src/lib/mint/mint-run.ts')
const { MintFailure } = await import('../src/lib/mint/mint-failure.ts')
const { wagmiMintChain } = await import('../src/lib/mint/wagmi-chain.ts')
const { defaultPhaseId, deriveAction, derivePhases, localMintOf, quote, totalMinted } =
  await import('../src/components/mint/model.ts')
const { formatNative } = await import('../src/lib/demo/helpers.ts')
const { phaseCalls } = await import('../src/lib/manage/phase-calls.ts')
const { readArtRows } = await import('../src/lib/art/read-rows.ts')
const { toProject } = await import('../src/lib/art/rows.ts')
const { mintPageBucket } = await import('../src/lib/storage/config.ts')
const { deleteObjects, headObject } = await import('../src/lib/storage/objects.ts')
const { NOT_DEPLOYED, NOT_FOUND, PAGE_CHANGED_ELSEWHERE, PAGE_FILE_MISSING } =
  await import('../src/lib/art/result.ts')
type MediaAsk = import('../src/lib/mint/settings-core.ts').MediaAsk
type MintPageInput = import('../src/lib/mint/settings-core.ts').MintPageInput
type MediaSlot = import('../src/lib/mint/media.ts').MediaSlot
type MintPageStatic = import('../src/lib/mint/page-doc.ts').MintPageStatic
type MintSource = import('../src/lib/mint/live-source.ts').MintSource
type MintChain = import('../src/lib/mint/mint-run.ts').MintChain
type MintResult = import('../src/lib/mint/mint-run.ts').MintResult
type MintCall = import('../src/lib/mint/mint-call.ts').MintCall
type MintParams = import('../src/lib/mint/mint-call.ts').MintParams
type MintFailureInstance = import('../src/lib/mint/mint-failure.ts').MintFailure
type FreshTrack = import('../src/lib/mint/fresh-client.ts').FreshTrack
type MintLive = import('../src/lib/mint/live-data.ts').MintLive
type WalletView = import('../src/lib/mint/live-data.ts').WalletView
type LocalMint = import('../src/lib/mint/live-data.ts').LocalMint
type PhasesContext = import('../src/lib/manage/phases-core.ts').PhasesContext

/** The launch groups: Public (id 0) and Holders (id 1). */
const PUBLIC = 0
const HOLDERS = 1
const PUBLIC_PRICE = 1_000_000_000_000_000n
const REAL = `ipfs://${CID('e')}/`
const DESCRIPTION = 'Three owls on a local chain.'
/** How long the page may take to read a block at T: one 1 s tick of the server, one 1 s poll and the reads. */
const LIVE_WITHIN_MS = 2_500
/**
 * How long the page may take to read the block at T-1: nothing is live and the start is 600 s away, so the chain
 * ticks at the idle tier until the server reads that block (then the start's window is open and it ticks every
 * second), and the page polls every 3 s until it reads it; then the reads.
 */
const START_WITHIN_MS = TIER_MS.idle + 3_000 + 2_000
/** How long the page may take to read a change: one 2 s tick of a live chain, one 3 s poll and the reads. */
const CHANGE_WITHIN_MS = TIER_MS.live + 3_000 + 3_000
/** How long one request to the bucket, a media URL or the server's /health may take. */
const REQUEST_TIMEOUT_MS = 5_000
/** The fields of `public.mint_page`'s document, and nothing else. */
const DOC_KEYS = [
  'slug',
  'name',
  'symbol',
  'projectType',
  'chainId',
  'contract',
  'description',
  'media',
  'socials',
  'featuredTokenIds',
  'sections',
  'phases',
  'placeholders',
  'published',
]
  .sort()
  .join(' ')

const creatorKey = privateKeyToAccount(generatePrivateKey())
const holderKey = privateKeyToAccount(generatePrivateKey())
const strangerKey = privateKeyToAccount(generatePrivateKey())
/** The publishable key's client with no session: what a visitor reads with. */
const anon = createClient<Database>(settings.url, settings.publishableKey, clientOptions)
const bucket = mintPageBucket()
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// A 1 x 1 transparent PNG; each file appends its own label after the image's end, so each has its own hash.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)
/** An MPEG audio frame header. */
const MP3 = Buffer.from([0xff, 0xfb, 0x90, 0x64])

/** A file the run uploads: its slot, type, bytes and the dimensions the browser would measure. */
type Upload = { slot: MediaSlot; mime: string; body: Buffer; width: number | null; height: number | null }
const image = (slot: MediaSlot, label: string): Upload => ({
  slot,
  mime: 'image/png',
  body: Buffer.concat([PNG, Buffer.from(label)]),
  width: 1500,
  height: 1500,
})
const askOf = (file: Upload): MediaAsk => ({
  slot: file.slot,
  mime: file.mime,
  bytes: file.body.byteLength,
  width: file.width,
  height: file.height,
  contentHash: createHash('sha256').update(file.body).digest('hex'),
})

/** Every key the run signed in the bucket, so the cleanup deletes whatever a PUT stored. */
const storedKeys = new Set<string>()

const put = (url: string, mime: string, body: Buffer) =>
  fetch(url, {
    method: 'PUT',
    body: new Uint8Array(body),
    headers: { 'Content-Type': mime },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

/**
 * Signs the files through the core, PUTs each one the bucket does not hold yet, and answers their keys in
 * order. Each key is tracked once signed, so the cleanup deletes what a PUT stored if a later one fails.
 */
async function upload(ctx: PhasesContext, files: Upload[]): Promise<string[]> {
  const signed = await presignMintPageMediaCore(ctx, files.map(askOf))
  if (!('data' in signed)) throw new Error(`presign: ${refusal(signed)}`)
  for (const { key } of signed.data) storedKeys.add(key)
  for (const [index, { key, putUrl }] of signed.data.entries()) {
    const file = files[index]!
    if (!putUrl) continue
    const stored = await put(putUrl, file.mime, file.body)
    if (!stored.ok) throw new Error(`PUT ${key}: ${stored.status}`)
  }
  return signed.data.map(({ key }) => key)
}

/** A media URL read with no session: its status, type and bytes. */
async function readMedia(key: string): Promise<{ status: number; mime: string | null; body: Buffer }> {
  const response = await fetch(mediaUrl(key), { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  return {
    status: response.status,
    mime: response.headers.get('content-type'),
    body: Buffer.from(await response.arrayBuffer()),
  }
}

/** The owner check the Mint page tab's actions run first (`ownedCollection`): the collection's owner, else not found. */
async function ownership(creator: Creator, cid: string): Promise<string> {
  const collection = await readLockCollection(creator.client, cid)
  return collection && collection.owner_id === creator.userId ? 'owned' : NOT_FOUND
}

/**
 * The real job's id and its ranks as `ranksOf` computes them over the stored list (a generative job's is the
 * collection's `tokens` rows, which the lock keeps) and the collection's layers.
 */
async function expectedRanks(
  creator: Creator,
  deployed: Deployed,
): Promise<{ jobId: string; ranks: number[] }> {
  const job = await admin
    .from('render_jobs')
    .select('id')
    .eq('collection_id', deployed.cid)
    .eq('kind', 'real')
    .eq('state', 'done')
    .single()
  if (job.error) throw new Error(`the real job: ${job.error.message}`)
  const rows = await readArtRows(creator.client, deployed.cid)
  const tokens = rows.tokens.map((row) => ({ id: row.token_id, dna: row.dna }))
  const layers = toProject({ collection: deployed.ctx.collection, ...rows, tokens: [] }).layers ?? []
  return { jobId: job.data.id, ranks: ranksOf(tokens, layers) }
}

/**
 * An answer the page accepted, when it folded it, the chain clock then, and the wait it set before the next
 * poll (`cadenceMs`; null after a final refusal).
 */
type Seen = { body: StateBody; at: number; chainNow: number | null; ms: number | null }

/**
 * The page's state loop without React, as useLiveState runs it: the live source's polls at the page's cadence
 * (`cadenceMs` over `derivePhases`), each folded into the track at `performance.now()`; a mint waiting for the
 * next answer polls at once. Each accepted answer is kept with the chain clock and the wait at its fold.
 */
function startPage(built: MintPageStatic, source: MintSource) {
  let track: FreshTrack = EMPTY_TRACK
  let running = true
  let wake = () => {}
  const seen: Seen[] = []
  const waiters: (() => void)[] = []
  const loop = (async () => {
    while (running) {
      const poll = await source.pollState()
      const now = performance.now()
      track = foldState(track, poll, now)
      const phases = track.body ? derivePhases(liveOf(built, track.body), null, chainNowOf(track, now)) : []
      const ms = cadenceMs(track, phases)
      if (poll.kind === 'body' && track.body === poll.body) {
        seen.push({ body: poll.body, at: now, chainNow: chainNowOf(track, now), ms })
        for (const resolve of waiters.splice(0)) resolve()
      }
      if (ms === null) return
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, ms)
        wake = () => {
          clearTimeout(timer)
          resolve()
        }
      })
    }
  })()
  return {
    seen,
    track: () => track,
    live: (): MintLive | null => (track.body ? liveOf(built, track.body) : null),
    isLive: (groupId: number) => !!track.body?.groups.some((group) => group.id === groupId && group.active),
    /** Polls at once, as the page does after a mint. */
    refresh: () => wake(),
    /** Resolves on the next accepted answer, or after 2 s, and polls at once (useLiveState's `nextAnswer`). */
    nextAnswer: () =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, NEXT_ANSWER_MAX_MS)
        waiters.push(() => {
          clearTimeout(timer)
          resolve()
        })
        wake()
      }),
    /** The first answer accepted from index `from` on (by default, from now) that passes `test`, or null after `ms`. */
    async until(test: (entry: Seen) => boolean, ms: number, from = seen.length): Promise<Seen | null> {
      const end = performance.now() + ms
      for (;;) {
        const hit = seen.slice(from).find(test)
        if (hit) return hit
        if (performance.now() >= end) return null
        await wait(25)
      }
    },
    async stop() {
      running = false
      wake()
      await loop
    },
  }
}
type Page = ReturnType<typeof startPage>

/** The page's action for a wallet as the mint context derives it: the default phase, one token, no vault. */
function actionOf(
  built: MintPageStatic,
  live: MintLive,
  wallet: WalletView | null,
  chainNow: number | null,
  local: LocalMint[] = [],
) {
  const phases = derivePhases(live, wallet, chainNow, local)
  const id = defaultPhaseId(phases)
  const phase = phases.find((entry) => entry.group.id === id) ?? null
  const action = deriveAction({
    page: built,
    live,
    phase,
    connected: true,
    walletRead: wallet !== null,
    wrongChain: false,
    quantity: 1,
    vault: null,
    soldOut: totalMinted(live, local) >= live.supply.max,
  })
  return { phase, action }
}

/** A wallet's answer through the live source, as allowances. */
async function walletOf(source: MintSource, address: Address): Promise<WalletView> {
  const poll = await source.pollWallet(address)
  if (poll.kind !== 'body') throw new Error(`the wallet answer for ${address}: ${poll.kind}`)
  return walletViewOf(poll.body)
}

/** A mint the page starts, run to its end: the result or the failure, and whether the wallet opened. */
async function tryMint(
  page: Page,
  mintChain: MintChain,
  params: MintParams,
): Promise<{ result?: MintResult; failure?: MintFailureInstance; walletOpened: boolean }> {
  const opened = { wallet: false }
  try {
    const result = await runMint(mintChain, params, page, {
      wallet: () => {
        opened.wallet = true
      },
      sent: () => {},
    })
    return { result, walletOpened: opened.wallet }
  } catch (error) {
    if (error instanceof MintFailure) return { failure: error, walletOpened: opened.wallet }
    throw error
  }
}

const publicLive = (body: StateBody) => body.groups.some((group) => group.id === PUBLIC && group.active)

let freshness: Freshness | null = null
let page: Page | null = null
/** Each wallet's release, which the cleanup runs. */
const releases: (() => Promise<void>)[] = []
/** What main set up, for the cleanup's check. */
let subject: { creator: Creator; deployed: Deployed; slug: string; jobId: string | null } | null = null

async function main(): Promise<void> {
  console.log(
    `Verifying the mint page on chain 31337 at ${new URL(rpc).host} against Supabase at ${new URL(settings.url).host}`,
  )
  await check(
    '1. setup: Anvil answers as 31337 with the factory approving the shipped code hash, Supabase and the mint-page bucket answer, and the freshness server serves 31337 on a free port',
    async () => {
      const unready = await chainReady()
      if (unready) return unready
      const { data, error } = await admin.storage.getBucket(bucket)
      if (error || !data)
        return `the ${bucket} bucket: ${error?.message ?? 'missing'}; run supabase seed buckets`
      if (!data.public) return `the ${bucket} bucket is not public`
      const server = await startFreshness({ port: 0, host: '127.0.0.1', chainIds: [31337] })
      freshness = server
      const answer = await fetch(`${server.url}/health`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
      const health = (await answer.json()) as HealthBody
      const served = health.chains.map((entry) => entry.chainId).join(' ')
      return Number(new URL(server.url).port) > 0 && served === '31337'
        ? null
        : `the freshness server at ${new URL(server.url).host} serves ${served}`
    },
  )
  const server = freshness as Freshness | null
  if (!server) throw new Error('the freshness server did not start')

  for (const key of [creatorKey, holderKey, strangerKey])
    await chain.setBalance({ address: key.address, value: parseEther('10') })
  const creator = await signIn(creatorKey)
  const stranger = await signIn(strangerKey)
  const form: DeployForm = {
    chainId: 31337,
    payout: creatorKey.address,
    royaltyBps: 500,
    royaltyReceiver: creatorKey.address,
    publicMaxPerWallet: 1,
    groups: [
      { name: 'Public', priceWei: PUBLIC_PRICE.toString(), maxSupply: 2 },
      { name: 'Holders', priceWei: '0', maxSupply: 1 },
    ],
  }
  const deployed = await deployedCollection(creator, form, 'mint page')
  const { cid, ctx } = deployed
  const contract = deployed.record.contractAddress
  const slug = slugFor(cid)
  const run = { creator, deployed, slug, jobId: null as string | null }
  subject = run

  await check(
    "2. unpublished: the link reads null from mint_page as anon, and the owner's preview reads it with published false",
    async () => {
      const read = await anon.rpc('mint_page', { p_slug: slug })
      if (read.error || read.data !== null) return `anon: ${read.error?.message ?? JSON.stringify(read.data)}`
      const preview = await creator.client.rpc('mint_page_preview', { p_slug: slug })
      if (preview.error) return `preview: ${preview.error.message}`
      const doc = pageDocSchema.safeParse(preview.data)
      return doc.success && doc.data.slug === slug && !doc.data.published
        ? null
        : `preview ${JSON.stringify(preview.data)}`
    },
  )

  let bannerKey = ''
  let avatarKey = ''
  await check(
    '3. media: a banner and an avatar are signed bound to type and length, put, and read without a session at their media URLs with their types; a 6 MB banner, an SVG and a WAV for the music are refused before signing',
    async () => {
      const banner = image('banner', 'banner one')
      const avatar = image('avatar', 'avatar')
      const signed = await presignMintPageMediaCore(ctx, [askOf(banner), askOf(avatar)])
      if (!('data' in signed)) return `presign: ${refusal(signed)}`
      // Tracked once signed, so the cleanup deletes an object a PUT stored even when the check stops early.
      for (const { key } of signed.data) storedKeys.add(key)
      const [forBanner, forAvatar] = signed.data
      if (!forBanner?.putUrl || !forAvatar?.putUrl) {
        const answers = signed.data.map(({ key, putUrl }) => `${key} ${putUrl ? 'signed' : 'not signed'}`)
        return `no PUT URL: ${answers.join(', ')}`
      }
      const otherType = await put(forBanner.putUrl, 'image/jpeg', banner.body)
      const longer = await put(forBanner.putUrl, banner.mime, Buffer.concat([banner.body, Buffer.from('!')]))
      if (otherType.ok || longer.ok)
        return `the URL took another type (${otherType.status}) or length (${longer.status})`
      for (const [entry, file] of [
        [forBanner, banner],
        [forAvatar, avatar],
      ] as const) {
        const stored = await put(entry.putUrl!, file.mime, file.body)
        if (!stored.ok) return `PUT ${entry.key}: ${stored.status}`
        const read = await readMedia(entry.key)
        if (read.status !== 200 || read.mime !== file.mime || !read.body.equals(file.body))
          return `${entry.key} reads ${read.status} ${read.mime}`
      }
      bannerKey = forBanner.key
      avatarKey = forAvatar.key
      const refused: [MediaAsk, string][] = [
        [{ ...askOf(banner), bytes: 6 * 1024 * 1024 }, '6 MB is over the 5 MB limit.'],
        [{ ...askOf(banner), mime: 'image/svg+xml' }, 'Use a PNG, JPG, WebP or GIF image.'],
        [{ ...askOf(banner), slot: 'music', mime: 'audio/wav' }, 'Use an MP3 file.'],
      ]
      for (const [ask, sentence] of refused) {
        const outcome = await presignMintPageMediaCore(ctx, [ask])
        if (refusal(outcome) !== sentence) return `${ask.slot} ${ask.mime} ${ask.bytes}: ${refusal(outcome)}`
      }
      return null
    },
  )

  let draft: MintPageInput | null = null
  /** The draft check 4 saved, with the changes since. */
  const saved = (): MintPageInput => {
    if (!draft) throw new Error('nothing was saved in check 4')
    return draft
  }

  await check(
    "4. save: the description, the four links, featured tokens 1 and 2 and the five sections with a team photo and an MP3 are saved; another creator's save is refused as not found; a key never uploaded is refused",
    async () => {
      const [teamKey, musicKey] = await upload(ctx, [
        image('team', 'team photo'),
        {
          slot: 'music',
          mime: 'audio/mpeg',
          body: Buffer.concat([MP3, Buffer.from('theme')]),
          width: null,
          height: null,
        },
      ])
      // The tab's view first, as the tab reads it: a save carries the row's stamp it was read on.
      const current = await mintPageSettingsCore(ctx)
      if (!('data' in current)) return `the view: ${refusal(current)}`
      const input: MintPageInput = {
        published: false,
        description: DESCRIPTION,
        media: { banner: bannerKey, avatar: avatarKey, about: null },
        socials: {
          website: 'https://owls.example',
          x: 'https://x.com/owls',
          discord: 'https://discord.gg/owls',
          telegram: 'https://t.me/owls',
        },
        featuredTokenIds: [1, 2],
        sections: {
          team: {
            enabled: true,
            members: [{ id: 'ada', name: 'Ada', role: 'Artist', bio: 'Draws owls.', imageKey: teamKey! }],
          },
          roadmap: {
            enabled: true,
            items: [{ id: 'mint', date: 'October', title: 'The mint', description: 'Three owls.' }],
          },
          faq: { enabled: true, items: [{ id: 'chain', question: 'Which chain?', answer: 'A local one.' }] },
          music: { enabled: true, key: musicKey!, fileName: 'theme.mp3' },
          carousel: { enabled: true, items: [{ id: 'first', kind: 'token', tokenId: 1 }] },
        },
        updatedAt: current.data.updatedAt,
      }
      const outcome = await saveMintPageCore(ctx, input)
      if (!('data' in outcome)) return `save: ${refusal(outcome)}`
      const view = outcome.data
      const { sections } = view
      const read = [
        view.description,
        JSON.stringify(view.socials),
        view.featuredTokenIds.join(' '),
        view.media.banner?.key,
        view.media.avatar?.key,
        sections.team.members[0]?.imageUrl,
        sections.music.url,
        [sections.team, sections.roadmap, sections.faq, sections.music, sections.carousel]
          .map((section) => section.enabled)
          .join(' '),
        [sections.roadmap.items, sections.faq.items, sections.carousel.items]
          .map((items) => items.length)
          .join(' '),
      ]
      const want = [
        DESCRIPTION,
        JSON.stringify(input.socials),
        '1 2',
        bannerKey,
        avatarKey,
        mediaUrl(teamKey!),
        mediaUrl(musicKey!),
        'true true true true true',
        '1 1 1',
      ]
      // Named, not printed: two of the fields are media URLs, which carry the Supabase host.
      const fields = ['description', 'links', 'featured', 'banner', 'avatar', 'team', 'music', 'on', 'items']
      const differ = fields.filter((_, index) => JSON.stringify(read[index]) !== JSON.stringify(want[index]))
      if (differ.length) return `saved another ${differ.join(', ')}`
      draft = { ...input, updatedAt: view.updatedAt }
      if ((await ownership(stranger, cid)) !== NOT_FOUND) return "the stranger's owner check passed"
      const forged: PhasesContext = {
        supabase: stranger.client,
        service: () => admin,
        owner: stranger.userId,
        wallet: strangerKey.address.toLowerCase(),
        collection: ctx.collection,
      }
      const taken = await saveMintPageCore(forged, { ...input, description: 'Taken.' })
      if (refusal(taken) !== NOT_DEPLOYED) return `the stranger's save through the core: ${refusal(taken)}`
      await stranger.client.from('mint_pages').update({ description: 'Taken.' }).eq('collection_id', cid)
      const missing = await saveMintPageCore(ctx, {
        ...saved(),
        media: { ...input.media, about: `${cid}/${HEX64(4242)}.png` },
      })
      if (refusal(missing) !== PAGE_FILE_MISSING) return `a key never uploaded: ${refusal(missing)}`
      const row = await admin
        .from('mint_pages')
        .select('description, about_banner_key')
        .eq('collection_id', cid)
        .single()
      return row.data?.description === DESCRIPTION && row.data.about_banner_key === null
        ? null
        : `the row reads ${JSON.stringify(row.data)}`
    },
  )

  await check(
    "5. publish: anon reads the document, readMintPage's builder turns keys into media URLs, the phases read Public then Holders, placeholders is empty (deployed on the real set), no private field is present, and the ranks are recorded",
    async () => {
      const published = await setMintPagePublishedCore(ctx, true)
      if (!('data' in published)) return `publish: ${refusal(published)}`
      const read = await anon.rpc('mint_page', { p_slug: slug })
      if (read.error || read.data === null) return `anon: ${read.error?.message ?? 'null'}`
      const doc = pageDocSchema.parse(read.data)
      const built = pageStaticOf(doc, { media: mediaUrl, gateway: ipfsGateway() })
      if (!built) return 'the builder does not list chain 31337'
      const input = saved()
      const urls = [
        built.bannerUrl,
        built.avatarUrl,
        built.sections.team?.[0]?.imageUrl,
        built.sections.music?.url,
      ]
      const wantUrls = [
        bannerKey,
        avatarKey,
        input.sections.team.members[0]!.imageKey!,
        input.sections.music.key!,
      ].map(mediaUrl)
      const wrong = ['banner', 'avatar', 'team', 'music'].filter(
        (_, index) => urls[index] !== wantUrls[index],
      )
      if (wrong.length) return `the media URLs of ${wrong.join(', ')} are not the keys' URLs`
      const phases = [...built.phases]
        .sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity))
        .map((phase) => `${phase.onchain_id}:${phase.name}`)
        .join(' ')
      if (phases !== '0:Public 1:Holders') return `phases ${phases}`
      if (doc.placeholders.length) return `placeholders ${doc.placeholders.join(' ')}`
      const keys = Object.keys(read.data as object)
        .sort()
        .join(' ')
      if (keys !== DOC_KEYS) return `the document's fields: ${keys}`
      const text = JSON.stringify(read.data).toLowerCase()
      const kept = [creator.userId, creatorKey.address, deployed.hash, CID('d'), CID('e')].filter((value) =>
        text.includes(value.toLowerCase()),
      )
      if (kept.length) return `the document holds ${kept.length} private value(s)`
      const { jobId, ranks } = await expectedRanks(creator, deployed)
      run.jobId = jobId
      const recorded = await admin.from('token_ranks').select('ranks').eq('job_id', jobId).maybeSingle()
      if (recorded.error) return `token_ranks: ${recorded.error.message}`
      return JSON.stringify(recorded.data?.ranks) === JSON.stringify(ranks)
        ? null
        : `ranks ${JSON.stringify(recorded.data?.ranks)}, expected ${JSON.stringify(ranks)}`
    },
  )

  await check(
    '6. replaced media: a save with a new banner deletes the old object, which no longer reads; the new one reads',
    async () => {
      const [newKey] = await upload(ctx, [image('banner', 'banner two')])
      const next: MintPageInput = {
        ...saved(),
        published: true,
        media: { ...saved().media, banner: newKey! },
      }
      // Check 5's publish (the Overview's switch) stamped the row after check 4's view, so that draft is stale: it
      // is refused and deletes nothing; the save on the view read again lands (final fix wave M2).
      const stale = await saveMintPageCore(ctx, next)
      if (refusal(stale) !== PAGE_CHANGED_ELSEWHERE)
        return `a save from before the publish: ${refusal(stale)}`
      if ((await readMedia(bannerKey)).status !== 200) return 'the refused save deleted the old banner'
      const current = await mintPageSettingsCore(ctx)
      if (!('data' in current)) return `the view: ${refusal(current)}`
      const reread: MintPageInput = { ...next, updatedAt: current.data.updatedAt }
      const outcome = await saveMintPageCore(ctx, reread)
      if (!('data' in outcome)) return `save: ${refusal(outcome)}`
      draft = { ...reread, updatedAt: outcome.data.updatedAt }
      const old = await readMedia(bannerKey)
      const head = await headObject(bannerKey, { bucket })
      if (head || old.status === 200) return `the old banner reads ${old.status}`
      storedKeys.delete(bannerKey)
      bannerKey = newKey!
      const fresh = await readMedia(bannerKey)
      return fresh.status === 200 ? null : `the new banner reads ${fresh.status}`
    },
  )

  const doc = await anon.rpc('mint_page', { p_slug: slug })
  if (doc.error || doc.data === null) throw new Error(`the published page: ${doc.error?.message ?? 'null'}`)
  const built = pageStaticOf(pageDocSchema.parse(doc.data), { media: mediaUrl, gateway: ipfsGateway() })
  if (!built) throw new Error('the page does not list chain 31337')
  const holderWallet = await wagmiWallet(holderKey.address)
  releases.push(holderWallet.release)
  const strangerWallet = await wagmiWallet(strangerKey.address)
  releases.push(strangerWallet.release)
  const holderChain = wagmiMintChain(holderWallet.config)
  const strangerChain = wagmiMintChain(strangerWallet.config)
  /** Every URL the live source fetched, in order. */
  const urls: string[] = []
  const source = liveMintSource(built, {
    freshnessUrl: server.url,
    chain: holderChain,
    supabase: anon,
    fetchImpl: (input, init) => {
      urls.push(String(input))
      return fetch(input, init)
    },
  })
  const view = startPage(built, source)
  page = view
  const mintOf = (groupId: number, amount: number, valueWei: bigint, account: Address): MintParams => ({
    contract,
    chainId: 31337,
    groupId,
    amount,
    vault: null,
    valueWei,
    account,
  })

  await check(
    "7. state: the live source reads the state at a lowercase URL; liveOf shows Public and Holders by name and position, the owner as the creator, 500 bps, revealed, no Transfers row (Anvil has no validator) and Public's quote",
    async () => {
      const first = await view.until(() => true, 5_000, 0)
      if (!first) return 'no state within 5 s'
      const stateUrl = `${server.url}/v1/state/31337/${contract.toLowerCase()}`
      if (urls[0] !== stateUrl)
        return `the first request asked ${urls[0] === undefined ? 'nothing' : new URL(urls[0]).pathname}`
      const live = liveOf(built, first.body)
      const groups = live.groups.map((group) => `${group.id}:${group.name}`).join(' ')
      const [quoted] = await chain.readContract({
        address: contract,
        abi: collectionAbi,
        functionName: 'quoteBatchMint',
        args: [BigInt(PUBLIC), 1n],
        blockNumber: BigInt(first.body.block),
      })
      // The page quotes the state's price, as deriveAction does.
      const publicQuote = quote(live, live.groups.find((group) => group.id === PUBLIC)!.priceWei, 1).totalWei
      return groups === '0:Public 1:Holders' &&
        isAddressEqual(live.creator, creatorKey.address) &&
        live.royaltyBps === 500 &&
        live.revealed &&
        live.transfers === null &&
        publicQuote === quoted
        ? null
        : `${groups} ${live.creator} ${live.royaltyBps} ${live.revealed} ${live.transfers} ${publicQuote} ${quoted}`
    },
  )

  const T = Number((await chain.getBlock()).timestamp) + 600
  await sendCall(creatorKey, contract, phaseCalls.schedule(PUBLIC, T))
  const holderBefore = await walletOf(source, holderKey.address)

  /** The first answer that read the block at T-1, found by check 8; check 9's cadence counts from it. */
  let atStart: Seen | null = null
  await check(
    "8. T-1: with Public scheduled at T and a block mined at T-1, the page's action reads 'Starts in 00:00:01', blocked, and nothing is sent",
    async () => {
      // "Nothing is sent" is carried by the blocked kind: the mint context runs a mint only for a `mint`
      // action (mint-context.tsx, `act`), so a blocked button opens no wallet. Nothing here tries to send;
      // the two nonce reads only confirm that no transaction left the holder meanwhile.
      const nonce = await chain.getTransactionCount({ address: holderKey.address })
      await chain.setNextBlockTimestamp({ timestamp: BigInt(T - 1) })
      await chain.mine({ blocks: 1 })
      atStart = await view.until((entry) => entry.body.blockTimestamp === T - 1, START_WITHIN_MS)
      if (!atStart) return `the block at T-1 was not read within ${START_WITHIN_MS} ms`
      const { phase, action } = actionOf(built, liveOf(built, atStart.body), holderBefore, atStart.chainNow)
      if (phase?.group.id !== PUBLIC || action.kind !== 'blocked' || action.label !== 'Starts in 00:00:01')
        return `${phase?.group.name}: ${action.kind} ${action.label}`
      const after = await chain.getTransactionCount({ address: holderKey.address })
      return after === nonce ? null : `the holder sent ${after - nonce} transaction(s)`
    },
  )

  await check(
    "9. T: a block mined at T is read by the page's 1 s polls with Public live within 2.5 s, the action reads 'Mint 1 for <total>', and no body with a block time below T read Public live",
    async () => {
      // Beyond section 10's sentence: before the block at T, the page's clock reads T on the block at T-1,
      // and the button only turns to waiting. Liveness is the state's `active` (CLAUDE.md rule 1); at the
      // reads of T-1 and of T the clock agrees with it, so only here would a page that took liveness from the
      // clock offer the mint.
      const track = view.track()
      if (!atStart || !track.body || !track.anchor || track.body.blockTimestamp !== T - 1)
        return `the page's state is not the block at T-1 (${track.body?.blockTimestamp ?? 'none'})`
      const clockAtT = chainNowOf(track, track.anchor.at + 1_000)
      const starting = actionOf(built, liveOf(built, track.body), holderBefore, clockAtT).action
      if (
        clockAtT === null ||
        clockAtT < T ||
        starting.kind !== 'blocked' ||
        starting.label !== 'Starting, waiting for the chain'
      )
        return `with the clock at ${clockAtT} on the block at T-1 the action reads ${starting.kind} ${starting.label}`
      await chain.setNextBlockTimestamp({ timestamp: BigInt(T) })
      await chain.mine({ blocks: 1 })
      const minedAt = performance.now()
      const atT = await view.until(
        (entry) => entry.body.blockTimestamp >= T && publicLive(entry.body),
        LIVE_WITHIN_MS,
      )
      if (!atT || atT.at - minedAt > LIVE_WITHIN_MS)
        return `Public did not read live within ${LIVE_WITHIN_MS} ms of the block at T`
      // Each answer from the read of T-1 up to the read of T set the 1 s cadence for the poll after it.
      const waits = view.seen
        .slice(view.seen.indexOf(atStart), view.seen.indexOf(atT))
        .map((entry) => entry.ms)
      if (!waits.length || waits.some((ms) => ms !== 1_000))
        return `the polls between the reads of T-1 and T waited ${waits.join(' ')} ms`
      const live = liveOf(built, atT.body)
      const { action } = actionOf(built, live, await walletOf(source, holderKey.address), atT.chainNow)
      const label = `Mint 1 for ${formatNative(quote(live, PUBLIC_PRICE.toString(), 1).totalWei, built.chain.nativeSymbol)}`
      if (action.kind !== 'mint' || action.label !== label) return `${action.label}, expected ${label}`
      const early = view.seen.filter((entry) => entry.body.blockTimestamp < T && publicLive(entry.body))
      return early.length === 0 ? null : `${early.length} answer(s) below T read Public live`
    },
  )

  await check(
    "10. price changed: the stranger's 1 from Public with one wei under the quote fails the check as price-changed and sends nothing (its nonce unchanged)",
    async () => {
      const live = view.live()
      if (!live) return 'no state'
      const total = quote(live, PUBLIC_PRICE.toString(), 1).totalWei
      const nonce = await chain.getTransactionCount({ address: strangerKey.address })
      const outcome = await tryMint(view, strangerChain, mintOf(PUBLIC, 1, total - 1n, strangerKey.address))
      const after = await chain.getTransactionCount({ address: strangerKey.address })
      return outcome.failure?.kind === 'price-changed' && !outcome.walletOpened && after === nonce
        ? null
        : `${outcome.failure?.kind ?? 'minted'}, wallet opened ${outcome.walletOpened}, nonce ${nonce} then ${after}`
    },
  )

  let minted: { params: MintParams; result: MintResult; before: StateBody } | null = null
  await check(
    "11. mint: runMint through wagmiMintChain (the mock connector, the holder impersonated) mints 1 from Public; the sent transaction's calldata and value are the simulated request's, the value is the page's quote, and the id is 1",
    async () => {
      const before = view.track().body
      const live = view.live()
      if (!before || !live) return 'no state'
      const wallet = await walletOf(source, holderKey.address)
      const { action } = actionOf(built, live, wallet, chainNowOf(view.track(), performance.now()))
      if (action.kind !== 'mint') return `the action reads ${action.label}`
      const simulated: MintCall[] = []
      const watched: MintChain = {
        ...holderChain,
        simulate: (call) => {
          simulated.push(call)
          return holderChain.simulate(call)
        },
      }
      const params = mintOf(PUBLIC, 1, action.quote.totalWei, holderKey.address)
      const outcome = await tryMint(view, watched, params)
      if (!outcome.result) return `the mint failed: ${outcome.failure?.kind}`
      const [call] = simulated
      if (simulated.length !== 1 || call?.functionName !== 'batchMint')
        return `${simulated.length} simulation(s)`
      const sent = await chain.getTransaction({ hash: outcome.result.hash })
      const data = encodeFunctionData({
        abi: collectionAbi,
        functionName: 'batchMint',
        args: call.args as readonly [bigint, bigint],
      })
      view.refresh()
      minted = { params, result: outcome.result, before }
      return sent.input === data &&
        sent.value === call.value &&
        call.value === action.quote.totalWei &&
        isAddressEqual(sent.from, holderKey.address) &&
        sent.to !== null &&
        isAddressEqual(sent.to, contract) &&
        outcome.result.tokenIds.join(' ') === '1'
        ? null
        : `sent ${sent.input} ${sent.value} for ${call.value}, ids ${outcome.result.tokenIds.join(' ')}`
    },
  )

  await check(
    "12. after the mint: the local mint counts while the state's block is below the receipt's and not after, so minted reads 1 once; the holder's wallet answer reads publicMinted 1 and the action 'Wallet limit reached'",
    async () => {
      const mint = minted as { params: MintParams; result: MintResult; before: StateBody } | null
      if (!mint) return 'no mint'
      // The local mint as the mint context records it when a mint lands (localMintOf).
      const landed = localMintOf(mint.params, mint.result)
      if (!landed) return `the mint's ids ${mint.result.tokenIds.join(' ')} count no local mint`
      const local: LocalMint[] = [landed]
      const older = liveOf(built, mint.before)
      if (older.block >= mint.result.block) return `the state before the mint is at block ${older.block}`
      const caught = await view.until((entry) => entry.body.block >= mint.result.block, CHANGE_WITHIN_MS, 0)
      if (!caught) return `the receipt's block was not read within ${CHANGE_WITHIN_MS} ms`
      const newer = liveOf(built, caught.body)
      const counts = [totalMinted(older, local), newer.supply.minted, totalMinted(newer, local)].join(' ')
      if (counts !== '1 1 1') return `minted reads ${counts}`
      const wallet = await walletOf(source, holderKey.address)
      if (wallet.publicMinted !== 1) return `publicMinted ${wallet.publicMinted}`
      const { action } = actionOf(built, newer, wallet, caught.chainNow, local)
      return action.label === 'Wallet limit reached' ? null : `the action reads ${action.label}`
    },
  )

  await check(
    "13. whitelist: after the creator opens Holders and writes a quota of 2 for the holder, the holder's Holders phase reads eligible with 2 left and the stranger's not eligible, both with no vaults (Anvil has no registry)",
    async () => {
      await sendCall(creatorKey, contract, phaseCalls.open(HOLDERS))
      await sendCall(creatorKey, contract, phaseCalls.quotas(HOLDERS, [holderKey.address], [2]))
      const opened = await view.until(
        (entry) => entry.body.groups.some((group) => group.id === HOLDERS && group.active),
        CHANGE_WITHIN_MS,
        0,
      )
      if (!opened) return `Holders did not read live within ${CHANGE_WITHIN_MS} ms`
      const live = liveOf(built, opened.body)
      const holderView = await walletOf(source, holderKey.address)
      const strangerView = await walletOf(source, strangerKey.address)
      const holdersOf = (wallet: WalletView) =>
        derivePhases(live, wallet, opened.chainNow).find((phase) => phase.group.id === HOLDERS)
      const own = holdersOf(holderView)
      const other = holdersOf(strangerView)
      return own?.wallet?.eligible === true &&
        own.wallet.remaining === 2 &&
        own.vaults.length === 0 &&
        other?.wallet?.eligible === false &&
        other.vaults.length === 0 &&
        holderView.delegatedVaults.length === 0 &&
        strangerView.delegatedVaults.length === 0
        ? null
        : `${JSON.stringify(own?.wallet)} ${JSON.stringify(other?.wallet)}`
    },
  )

  await check(
    '14. over quota: 3 from Holders fails the check as quota-exceeded and sends nothing',
    async () => {
      const live = view.live()
      if (!live) return 'no state'
      const nonce = await chain.getTransactionCount({ address: holderKey.address })
      const outcome = await tryMint(
        view,
        holderChain,
        mintOf(HOLDERS, 3, quote(live, '0', 3).totalWei, holderKey.address),
      )
      const after = await chain.getTransactionCount({ address: holderKey.address })
      return outcome.failure?.kind === 'quota-exceeded' &&
        outcome.failure.detail.allowed === 2 &&
        !outcome.walletOpened &&
        after === nonce
        ? null
        : `${outcome.failure?.kind ?? 'minted'} ${JSON.stringify(outcome.failure?.detail)}, nonce ${nonce} then ${after}`
    },
  )

  await check(
    "15. tiers: the tiers read answers ids 1 and 2 at the real base URI with ranksOf's ranks over the stored list, and null at any other base URI",
    async () => {
      const { ranks } = await expectedRanks(creator, deployed)
      // The page asks at the state's base URI, which is the real job's on this revealed collection.
      const baseUri = view.live()?.baseUri
      if (baseUri !== REAL) return "the state's base URI is not the real job's"
      const tiers = await source.tiers(baseUri, [1, 2])
      const other = await source.tiers(`ipfs://${CID('f')}/`, [1, 2])
      const want = { total: ranks.length, ranks: { 1: ranks[0], 2: ranks[1] } }
      return ranks.length === 3 && JSON.stringify(tiers) === JSON.stringify(want) && other === null
        ? null
        : `${JSON.stringify(tiers)} ${JSON.stringify(other)}, expected ${JSON.stringify(want)}`
    },
  )

  await check(
    "16. refusals: the factory's address reads final not-a-collection, and with the server closed a poll reads a retry after 1 s",
    async () => {
      const factoryPoll = await pollState(server.url, 31337, factory)
      if (factoryPoll.kind !== 'final' || factoryPoll.reason !== 'not-a-collection')
        return `the factory: ${JSON.stringify(factoryPoll)}`
      await view.stop()
      await server.close()
      freshness = null
      const closed = await pollState(server.url, 31337, contract)
      return closed.kind === 'retry' && closed.afterMs === 1_000 ? null : `closed: ${JSON.stringify(closed)}`
    },
  )
}

/** Unpublishes the page and reads it as anon and as the owner's preview, or says what happened instead. */
async function unpublished(run: NonNullable<typeof subject>): Promise<string | null> {
  const outcome = await setMintPagePublishedCore(run.deployed.ctx, false)
  if (!('data' in outcome)) return `unpublish: ${refusal(outcome)}`
  const read = await anon.rpc('mint_page', { p_slug: run.slug })
  if (read.error || read.data !== null) return `anon: ${read.error?.message ?? 'the document'}`
  const preview = await run.creator.client.rpc('mint_page_preview', { p_slug: run.slug })
  const doc = pageDocSchema.safeParse(preview.data)
  return doc.success && !doc.data.published && doc.data.description === DESCRIPTION
    ? null
    : `preview ${preview.error?.message ?? JSON.stringify(preview.data)}`
}

/** A thrown error in one line: viem's short message, since its full message names the request's URL. */
function messageOf(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const short = (error as { shortMessage?: unknown }).shortMessage
  return typeof short === 'string' ? short : error.message
}

/** Runs a cleanup step whatever failed before it: its problem (a string it answers or a throw), or null. */
async function attempt(label: string, fn: () => Promise<unknown>): Promise<string | null> {
  try {
    const problem = await fn()
    return typeof problem === 'string' ? problem : null
  } catch (error) {
    return `${label} threw ${messageOf(error)}`
  }
}

/**
 * Deletes every object the run signed in the mint-page bucket, then its rows, each step whatever failed
 * before it, and answers each step's problem or null, in order.
 */
async function removeAll(run: typeof subject): Promise<(string | null)[]> {
  const keys = [...storedKeys]
  const problems = [await attempt('deleting the objects', () => deleteObjects(keys, { bucket }))]
  for (const key of keys)
    problems.push(
      await attempt(`reading ${key}`, async () =>
        (await headObject(key, { bucket })) ? `${key} is left in ${bucket}` : null,
      ),
    )
  problems.push(await attempt('removing the fixtures', removeFixtures))
  if (!run) return problems
  problems.push(
    await attempt('counting mint_pages', async () => {
      const pages = await admin
        .from('mint_pages')
        .select('*', { count: 'exact', head: true })
        .eq('collection_id', run.deployed.cid)
      return pages.error || pages.count
        ? `mint_pages: ${pages.error?.message ?? `${pages.count} left`}`
        : null
    }),
  )
  const { jobId } = run
  if (jobId)
    problems.push(
      await attempt('counting token_ranks', async () => {
        const ranks = await admin
          .from('token_ranks')
          .select('*', { count: 'exact', head: true })
          .eq('job_id', jobId)
        return ranks.error || ranks.count
          ? `token_ranks: ${ranks.error?.message ?? `${ranks.count} left`}`
          : null
      }),
    )
  return problems
}

async function cleanup(): Promise<void> {
  // Every step runs whatever failed before it, so a failed stop, close, release or delete never keeps the
  // rest from running; check 17 reports the first problem.
  const stopped = [
    await attempt('stopping the page', async () => {
      await page?.stop()
    }),
    await attempt('closing the freshness server', async () => {
      await freshness?.close()
    }),
  ]
  for (const release of releases) stopped.push(await attempt('releasing a wallet', release))
  await check(
    '17. unpublish: anon reads null again while the preview still reads the document; the fixtures are removed',
    async () => {
      const run = subject
      const problems = [
        ...stopped,
        run ? await attempt('unpublishing', () => unpublished(run)) : 'no collection was deployed',
        ...(await removeAll(run)),
      ]
      return problems.find((problem) => problem !== null) ?? null
    },
  )
}

await runChecks(main, cleanup)
