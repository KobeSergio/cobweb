# Lock and pay: specification

Companion plan: [../plans/2026-10-09-lock-and-pay.md](../plans/2026-10-09-lock-and-pay.md).
Product decisions: [../MASTER_PLAN.md](../MASTER_PLAN.md#decisions) (art fee, placeholder, integrity at
lock) and [PLAN.md](../PLAN.md) decision 10. Rows: [2026-10-08-art-tables.md](2026-10-08-art-tables.md)
section 4.8 (`render_jobs`, `render_batches`). Screens: [2026-10-03-creator-flow-ui.md](2026-10-03-creator-flow-ui.md)
section 4.4 and section 7. Contract: `contracts/src/CobwebFactory.sol` (`payForArt`, `ArtPaid`,
`artFeePerToken`, `jobPayment`).

## 1. Goal

Make the Lock and upload step real up to the point where rendering starts. A creator reviews the
generated set, locks the art (which freezes every art table), receives a quote in the chain's native
coin, pays it from their wallet, and the server verifies the payment from the transaction receipt and
marks the render job paid. Until payment the creator can unlock for free. A deferred-art collection
locks only its placeholder, at no cost. Rendering itself (batches, images, metadata, CIDs) is Phase 4;
this sub-project leaves it a paid job row with a stored, hashed token list, which is Phase 3's exit.

Fifth and last of Phase 3's sub-projects.

## 2. Decisions taken in the design conversation

- **Local Anvil first.** The factory is deployed to a local Anvil chain by a Foundry script; the web
  app, `verify:chain` and the browser walk pay against it. Real factory addresses per chain are
  configuration, filled in when the contracts are deployed.
- **The fee rate comes from the factory.** `artFeePerToken()` (wei per token, set by the factory
  admin to match $0.11) is read at lock and stored on the job as the quote. No price feed, no
  oracle, one source of truth. The server verifies the payment against the stored quote.
- **Scope includes the screen and the sweep.** Review and lock, quote, pay, verified payment,
  unlock while unpaid and reveal later are wired; render progress and the done step stay simulated
  behind one named seam until Phase 4; the owed sweep of uploaded-but-unrecorded objects lands as a
  service-role script.
- **Approach A.** Lock, unlock, placeholder lock, requote and payment recording are security-definer
  database functions; the server verifies the receipt with viem. The app holds the service-role key
  server-side for the three writes whose arguments come from the chain or a verified receipt; every
  other write stays under the creator's session.
- The quote is valid 24 hours and re-quotes without unlocking. The payer is the creator's sign-in
  wallet.

## 3. Scope

### In scope

- `packages/shared`: chain config, factory ABI and addresses, viem public clients (section 4).
- A Foundry deploy script for Anvil and the `chain:local` command (section 4).
- Migration: `render_jobs.onchain_job_id`, `render_jobs.token_list`, the functions `art_lock`,
  `art_unlock`, `art_lock_placeholder`, `art_record_payment`, `art_requote` (section 6).
- Server actions `reviewArt`, `lockArt`, `unlockArt`, `lockPlaceholder`, `quoteArt`,
  `confirmArtPayment`, `getRenderJob` (section 7), with the receipt check in a pure module.
- The 1/1 and single-asset token list builder (section 5).
- The Lock and upload screen on real data, with the render seam (section 8).
- The sweep script (section 9).
- Tests: unit, `verify:local` 9g, `verify:chain`, browser walk (section 10).

### Out of scope

- Rendering: SQS, Lambdas, batch progress, images and metadata CIDs, `collections.status` moving
  to `rendering` or `rendered` (Phase 4). The job stays `paid` with `batches_total` set.
- Waivers: `waived` is set by SQL as the factory admin; no screen.
- Deploy, mint page, and anything after rendering.
- A price feed or any USD conversion in code; the admin sets the rate.
- Watching chain events; verification is by receipt on demand.
- Multi-wallet payment: only the quote's payer counts.
- Locking the real set of a deferred-art collection after its placeholder lock is wired with the reveal
  flow in a later phase.

## 4. Chain plumbing

`packages/shared/src/`:

- `chains.ts`: `LAUNCH_CHAINS` (Ethereum 1, Arbitrum 42161, Base 8453, Berachain 80094, Monad 143,
  Robinhood Chain) plus `sepolia` (11155111) and `anvil` (31337) outside production; each entry
  `{ id, name, rpcEnv, factoryEnv }` naming the environment variables `RPC_URL_<ID>` and
  `FACTORY_ADDRESS_<ID>`; `chainById(id)`; `factoryAddress(id)` and `rpcUrl(id)` read the variables
  and throw a sentence when unset ("The factory address for chain <id> is not configured.").
- `factory-abi.ts`: the ABI entries for `payForArt(bytes32)`, `artFeePerToken()`,
  `jobPayment(bytes32,address)`, `treasury()` and the `ArtPaid(bytes32 indexed jobId, address indexed payer, uint256 amount)`
  event, copied from `contracts/out/CobwebFactory.sol/CobwebFactory.json` by a script
  (`pnpm --filter @cobweb/shared abi`) so the source is the Foundry build, never `legacy/`.
- `job-id.ts`: `onchainJobId(uuid): Hex` (the 16 uuid bytes left-aligned in 32 bytes, which is what
  `art_lock` stores) and `jobIdFromOnchain(hex): string`; pure, round-trip tested, and `verify:local`
  9g checks the SQL derivation equals it.
- `clients.ts`: `publicClientFor(chainId)` (viem `createPublicClient` over `rpcUrl`), used from
  server code only.

`@cobweb/shared` has a browser entry and a `@cobweb/shared/server` entry (the viem clients and the
environment reads live behind the server one). The dev wallet sends transactions on Anvil only.

`contracts/script/DeployLocal.s.sol` deploys `CobwebFactory` with the first Anvil account as admin and
treasury and sets `artFeePerToken` to a known rate (`25000000000000` wei, 0.000025 ETH, standing in for
$0.11). `pnpm --filter @cobweb/web chain:local` starts Anvil if it is not running (port 8545), runs
the script, and prints the two lines to put in `.env.local`: `RPC_URL_31337=http://127.0.0.1:8545`
and `FACTORY_ADDRESS_31337=<address>`. The web app's wagmi config adds the Anvil chain outside
production so the dev wallet can pay on it.

The collection's chain for the quote is `collections.chain_id` when set, otherwise the chain the
creator's wallet is connected to at lock, passed by the screen and stored on the job
(`quote_chain_id`). Deploy (Phase 5) must use the same chain; it is recorded here so the fee and the
contract live on one chain.

## 5. The token list at lock

- Generative: the stored `tokens` rows (`token_id`, `art_collection_id`, `dna`) are the list. The
  action loads them with the project and runs `validateTokenList(project, tokens, { allowDuplicates })`
  from `@cobweb/dna`; the problems become the review step's checks (ids, size, collection,
  dna-length, trait, rule, cap, duplicate). The hash is `hashTokenList(tokens)`.
- 1/1 and single asset: there are no `tokens` rows. `buildAssetTokenList(uploads)` (pure, in
  `apps/web/src/lib/art/asset-tokens.ts`, built on the existing `buildOneOfOneTokens`) turns the
  `kind = 'asset'` upload rows (position, quantity, attributes, upload id) into
  `[{ id, uploadId, attributes }]` with ids 1 to supply; single asset is one upload with `quantity`
  tokens. The list is stored on the job as `token_list` jsonb and hashed with the same canonical
  routine over `[id, uploadId, attributes]`. `validateTokenList` does not apply; the checks are:
  at least one file, ids contiguous, supply within the project type's cap.
- The list the action validated is passed to `art_lock`, which refuses when it no longer matches the
  stored rows (generative) or the stored asset uploads (1/1 and single asset): "The art changed
  while locking. Review it again."

## 6. Database

Migration `supabase/migrations/20261009020000_lock_and_pay.sql`:

- `render_jobs` gains `onchain_job_id text not null` (`^0x[0-9a-f]{64}$`, unique) and
  `token_list jsonb` (null for generative jobs, which read `tokens`) and `quote_factory text`
  (`^0x[0-9a-f]{40}$`, null on older rows; the factory the rate was read from and the payment goes to,
  set by `art_lock` from `p_factory`). `quote_expires_at` is set to
  `now() + interval '24 hours'` by `art_lock`. A unique index on `payment_tx_hash` where not null.
- Every function below is `security definer`, `set search_path = ''`, and starts by locking the
  owner's `collections` row (`for no key update`), raising 'collection not found' (42501) otherwise.
  Running as the definer, the art lock trigger does not apply to them, which is how they write
  `art_locked_at`.
- `art_lock` (fee, chain, payer), `art_requote` (fee) and `art_record_payment` (tx hash, payer,
  amount) take arguments that come from the chain or a verified receipt, so they are executable by
  `service_role` only (revoked from `public`, `anon` and `authenticated`) and take `p_owner uuid`,
  which must equal `collections.owner_id`. The server action passes the verified user's id after its
  own session check and owner read. `art_unlock` and `art_lock_placeholder` take nothing from the
  chain; they are granted to `authenticated` only and lock on `owner_id = (select auth.uid())`.

| Function                                                                                                                                                                                                | Behaviour in one transaction                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `art_lock(collection, p_owner uuid, kind text, token_list jsonb, token_list_hash text, allow_duplicates bool, fee_per_token_wei numeric, chain_id int, payer text, factory text)` (`service_role` only) | Refuses when `art_locked_at` is set ("The art is already locked.") or an open `real` job exists. For a generative project compares `token_list` with the `tokens` rows (same ids, art collections and DNA, no more, no less); for others compares it with the asset uploads (ids, upload ids, quantities, attributes); a mismatch raises 23514 'The art changed while locking. Review it again.' Sets `art_locked_at = now()`, `status = 'art_locked'`, inserts the job: `state = payment_due` (or `paid` when the total is 0), `token_count`, hash, `allow_duplicates`, quote fields (including `quote_factory`), `quote_expires_at`, `batch_size 100`, `batches_total = ceil(count / 100)`, `token_list` for non-generative projects, and `onchain_job_id` derived in SQL from the new row's id (the 32 uuid hex characters followed by 32 zeros, prefixed `0x`, the same bytes `onchainJobId` produces). Returns the job row. |
| `art_unlock(collection)` (`authenticated`)                                                                                                                                                              | Requires the open `real` job to be `payment_due`; cancels it (`state = 'failed'`, `error = 'unlocked'`, `finished_at = now()`; the row is kept, so a payment that mined and was never recorded can still be matched to its job id), clears `art_locked_at`, sets `status = 'draft'`. Any other state raises 23514 'The art is paid for and stays locked.'                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `art_lock_placeholder(collection, placeholder_upload_id)` (`authenticated`)                                                                                                                             | Requires `art_deferred`, the upload to be a `placeholder` of this collection, and no open `placeholder` job; inserts a `kind = placeholder` job with `token_count 1`, zero quote, `state = paid`, `batches_total 1`; does not touch `art_locked_at` or `status`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `art_requote(collection, p_owner uuid, fee_per_token_wei numeric)` (`service_role` only)                                                                                                                | Requires the open `real` job in `payment_due` with `quote_expires_at < now()`; rewrites the quote total and expiry. Returns the job.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `art_record_payment(collection, p_owner uuid, job, tx_hash text, payer text, amount_wei numeric)` (`service_role` only)                                                                                 | Requires the job `payment_due` and unexpired; requires `payer = quote_payer` and `amount_wei >= quote_total_wei` (the action already checked both; the function repeats them as 23514 guards); refuses a `tx_hash` already recorded on any job (unique index); sets `state = paid`, `payment_tx_hash`, `paid_at = now()`, `paid_amount_wei`. Returns the job.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

Amendments as built:

- `art_record_payment` does not check the quote expiry. It records a short payment (hash and amount,
  the job stays `payment_due`) and refuses a second record, a requote or an unlock once a payment is
  recorded.
- `art_lock` refuses a zero fee for generative and 1/1 projects, and refuses when a set `max_supply`
  differs from the token count ('The supply does not match the tokens. Generate again.').
- `art_unlock` nulls a generative project's `max_supply`.
- `onchain_job_id` is derived by a trigger.

`render_jobs` select stays owner-only through RLS; nothing grants client writes. The functions are
checked in `verify:local` 9g (section 10).

## 7. Server actions

Under `apps/web/src/app/actions/lock.ts`, each: `getVerifiedUser`, an ownership read of the
collection under RLS (a new `ownedCollection(collectionId)` helper beside `ownedUnlocked`, because
the paid flow runs on a locked collection), zod input, `ActionResult<T>`, the shared SQLSTATE mapper.
A shared `lockWrite` helper runs these checks with the creator's RLS client, then hands the steps a
server-only service client (`apps/web/src/lib/supabase/service.ts`, `SUPABASE_SERVICE_ROLE_KEY`,
never `NEXT_PUBLIC_`, no session persistence) used for exactly the three calls `art_lock`,
`art_requote` and `art_record_payment`, with `p_owner` set to the verified user's id. Every other
read and write, `art_unlock` and `art_lock_placeholder` included, uses the creator's RLS client.

| Action                                                | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reviewArt(collectionId)`                             | Loads the project and list, runs the validation, returns `{ problems, tokenCount, supply, allowDuplicatesNeeded }` for the review step.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `lockArt(collectionId, { allowDuplicates, chainId })` | Validation as above (refuses when problems remain unless they are duplicates and `allowDuplicates`), `hashTokenList`, reads `artFeePerToken()` on `chainId` (a sentence when the RPC or factory is not configured: "This chain is not ready for payments yet."), `art_lock(...)` with the quote (`fee x tokenCount`) and payer = the profile's wallet. Returns the job as `RenderJob`.                                                                                                                                                                                                                                                                                 |
| `unlockArt(collectionId)`                             | Reads `jobPayment(onchain_job_id, quote_payer)` on `quote_chain_id` through the public client and refuses with 'A payment for this job is on chain. Enter its transaction hash to record it.' when it is above zero or cannot be read; otherwise `art_unlock`, which cancels the job (state failed, error unlocked) rather than deleting it.                                                                                                                                                                                                                                                                                                                           |
| `lockPlaceholder(collectionId, uploadId)`             | `art_lock_placeholder`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `quoteArt(collectionId)`                              | When the open job's quote expired, first reads `jobPayment` the same way and refuses with the same sentence when a payment is on chain or the read fails, then reads the rate again and calls `art_requote`; otherwise returns the job.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `confirmArtPayment(collectionId, jobId, txHash)`      | Loads the job (owner read), `publicClientFor(quote_chain_id).getTransactionReceipt`; `matchArtPaid(receipt, { factory, jobId, payer, minAmount })` (pure, `apps/web/src/lib/chain/art-paid.ts`) finds the factory's `ArtPaid` log for the job and returns `{ ok }` or one sentence: "The payment has not been confirmed on chain yet." (no receipt or not yet mined), "The payment came from a different wallet than the quote." (payer mismatch), "The payment was less than the quote." (amount short), "The transaction did not pay for this job." (no matching log), "This payment was already used." (hash recorded); then `art_record_payment`. Returns the job. |
| `getRenderJob(collectionId)`                          | The open job (or the latest done or failed one) as `RenderJob`, for the page and for polling after payment.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

As built, `confirmArtPayment` requires a confirmation depth per chain (Anvil 1, Sepolia 2, Ethereum 5,
other launch chains 3) and treats a short payment as recorded-and-refused, with the job named for
support.

`RenderJob` (in `lib/demo/types.ts`, kept as the screen's shape) gains states `paid`, `waived`,
`failed`; `toRenderJob(row)` in `apps/web/src/lib/art/render-job.ts` maps the row: `jobId` from
`onchain_job_id`, `quote` from the quote columns (expiry as unix seconds), `payment` from the
payment columns, `batches` from `batches_total`, `batches_done`, `batch_size`, `placeholder` from
the placeholder upload's served URL and media type.

## 8. The screen

`apps/web/src/components/upload/`:

- `upload-sim.ts` is split: `lockArt`, `unlockArt`, `payArtFee` and `lockPlaceholder` become real
  (`upload-actions.ts`); `followRender` and `retryBatch` stay simulated in `render-sim.ts` with one
  `Seam:` comment naming Phase 4. The page (`app/collections/[id]/upload/page.tsx`) loads the real
  job through `getRenderJob` and the review data through `reviewArt`; the `?job=`, `?outcome=` and
  `?art=deferred` parameters stay only in sample mode.
- Review step: the four checks come from `reviewArt`; "Allow identical tokens" is offered only when
  the only problems are duplicates; the irreversible confirm leads to `lockArt`.
- Pay step: phases simulating (wagmi `simulateContract` for `payForArt(jobId)` with `value = totalWei`
  on `quote.chainId`; the wallet must be on that chain and be the payer, else a sentence and no wallet
  prompt), wallet (`writeContract(simulated.request)`), confirming (`waitForTransactionReceipt`),
  verifying (`confirmArtPayment`, retried every 3 seconds up to 2 minutes while the receipt is not
  yet visible to the server), success. Failure states: rejected in the wallet, failed on chain, and
  verification refused (with the sentence). A quote past its expiry shows "The quote expired" with a
  "Get a new quote" button (`quoteArt`). "Unlock the art" is available while `payment_due`, behind a
  confirm that says the lock and the quote are discarded and the Art step opens again.
- As built, the pay step reads `jobPayment` before simulating, remembers the sent hash per job, and
  offers "I have a transaction hash", "Check again" and "Discard this attempt". The sent-hash paths
  stay open after the quote expires. Unlock is disabled while a hash is pending or a short payment is
  recorded.
- Reveal later (`reveal-later.tsx`): the placeholder file is uploaded through the existing uploader
  (`kind placeholder`) and `lockPlaceholder` is called; the `?art=deferred` seam goes.
- Render and done steps: unchanged in look; they read the real job's `batches` and show the
  simulated progress until Phase 4; the seam comment says so.
- Sample mode: the page passes the sample job and the screen's actions are no-ops, as the Art
  screens do.

## 9. The sweep

`apps/web/scripts/sweep-uploads.ts` (`pnpm --filter @cobweb/web sweep:uploads`): with the service
role and the storage credentials, lists objects in the `art` bucket, and for each object older than
24 hours whose key has no `uploads.storage_key` row, deletes it; prints counts; `--dry-run` lists
only. Refuses to run against anything but localhost unless `--allow-remote` is passed, so it can be
scheduled later with care. Documented in CLAUDE.md commands.

## 10. Testing

- Unit (vitest): `onchainJobId` round trip; quote arithmetic (`fee x count`, zero for single
  asset); `matchArtPaid` with fake receipts (match, other job, other payer, short amount, no log,
  wrong factory address); `buildAssetTokenList` (editions expand to contiguous ids, attributes
  carried, single asset); the asset list hash is stable under reordering of the input rows;
  `toRenderJob` state mapping including `paid`, `waived`, `failed`; the pay step's phase reducer.
- `verify:local` section 9g: `art_lock`, `art_requote` and `art_record_payment` called with the
  service role and the owner's id, `art_unlock` and `art_lock_placeholder` as the owner. `art_lock` on a seeded generative collection with a
  matching list (job `payment_due`, `art_locked_at` set, status `art_locked`), with a changed list
  (refused with the sentence), twice (refused), `art_unlock` while `payment_due` (rows restored to
  draft and unlocked), `art_record_payment` with the right payer and amount (state `paid`), with a
  reused hash (refused), with a short amount (refused), `art_unlock` after payment (refused),
  `art_lock_placeholder` on a deferred collection (job `paid`, no art lock), `art_requote` only when
  expired (service role backdates `quote_expires_at`); the single-asset zero-quote lock goes straight
  to `paid`. Refusals: `art_unlock` and `art_lock_placeholder` as the other creator (42501,
  'collection not found'); the three service functions with the other creator's id as `p_owner`
  (42501, 'collection not found'); the three called with the owner's own session client (refused by
  the grant, 42501 permission denied); all five signed out (refused by the grant).
- `verify:chain` (`apps/web/scripts/verify-chain.ts`): requires Anvil with the factory deployed
  (`chain:local`); as a signed-in creator with a seeded generative collection: `lockArt` through the
  action's pure core (the script imports the same modules the action uses with a session client),
  pay `payForArt` from the Anvil account that is the quote payer with the exact total (viem wallet
  client), `confirmArtPayment` (job `paid`); then the negative cases: pay from another account
  (refused: different wallet), pay less (refused: less than the quote), confirm the same hash again
  (refused: already used), a random hash (refused: not confirmed). Refuses non-local RPC URLs.
- Browser: dev wallet on Anvil; review and lock a small generative collection, pay, see "Paid"; a
  second collection: lock, unlock, edit the art again; a deferred collection: reveal later with a
  GIF placeholder, see the placeholder job; sample mode still shows the four demo outcomes.

## 11. Acceptance criteria

- [x] A generative collection can be reviewed, locked, quoted from the factory rate, paid on Anvil
      and verified; the job row is `paid` with the token list hash, the quote and the payment.
- [x] An edit between review and lock is refused with "The art changed while locking. Review it
      again."; unlock while unpaid returns the collection to draft; unlock after payment is refused.
- [x] A deferred collection locks its placeholder at no cost without locking the art; a single-asset
      collection locks at no cost.
- [x] `verify:local` passes with section 9g; `verify:chain` passes against Anvil; `pnpm typecheck
&& pnpm lint && pnpm test` pass at the root; `pnpm --filter @cobweb/web build` passes. Counts measured: root tests 337; `verify:local` 203; `verify:storage` 15; `verify:chain` 12; `verify:sweep` 8.
- [x] The sweep removes an object older than a day with no row and keeps every recorded object, in
      a dry run and a real run against local storage.
- [x] `docs/MASTER_PLAN.md` marks Phase 3 complete and names Phase 4 next; the creator flow spec's
      seams list drops the upload entries that are now real; `packages/shared` is documented in
      CLAUDE.md's layout line.

Checked on 10 October 2026 on local Supabase and Anvil: root typecheck, lint and tests; verify:local 203 checks; verify:storage 15; verify:chain 12; verify:sweep 8; next build. Browser walk with Playwright and the dev wallet: review and lock (four checks, 3 tokens, 2 layers, 5 traits), pay 0.000075 ETH on Anvil through the wallet with the phases shown and the job recorded paid with its hashes; reload opened on the render step and the Art screens were read only; a second collection locked, unlocked, re-rolled and relocked at the same quote, then paid; a wallet on Ethereum was told to switch to Anvil with no prompt; a deferred collection locked a GIF placeholder at no fee without locking the art; in sample mode the rejected, reverted, balance and failed-check outcomes each showed and Try again succeeded with no request to a server action.
