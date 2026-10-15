# Airdrop and Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a creator with a deployed collection airdrop and burn tokens and run the contract's settings from Manage drop, on the contract's state. Airdrop parses a list in the browser, freezes it into batches of at most 500 wallets and 1,000 tokens, and sends each batch as one `airdropNFTs` from the sign-in wallet through the manage machine, with the contract's airdrop fee for its tokens as the value; the server proves each batch from its receipt and calldata at the chain's confirmation depth and records it, so History lists what landed through Cobweb with its token ids and fee. Settings reads the balances, the payout address, the royalty, the base URI, mint on behalf, the transfer validator and its level at one block; every change is a transaction from the creator's wallet confirmed from its receipt, and Cobweb keeps copies of what it last read for when the chain does not answer. The Overview's pointer, Reveal and proceeds come from the same read. A wallet that is not the contract's owner reads everything and sends nothing.

**Architecture:** A migration adds `airdrops` and `withdrawals` (the owner reads; only `airdrop_record` and `withdrawal_record`, for the service role, write them after a proof), turns `deployments`' payout, royalty and base URI into copies refreshed only by `settings_refresh` with the new `transfer_validator` and `mint_on_behalf`, and widens the royalty copy to the contract's 0 to 10,000. The shared package ships the validator's ABI and its default address. The web app gains the pure modules (`airdrop-types.ts`, `airdrop-view.ts`, `settings-types.ts`, `settings-view.ts`), the payable and validator calls in `phase-calls.ts` (`value`, `target`, `abiOf`, `airdropCalls`, `settingsCalls`, a Value row in the review) with their shapes and event matches, the batch proof (`airdrop-batch.ts`) and the new revert sentences with the chain's symbol; the server cores (`airdrop-core.ts`, `settings-core.ts`: ten views at one block through `readEach`, the phase copies refreshed with that block before the settings copies) behind four actions through `phasesWrite`; the manage machine's two new "not confirmed yet" answers and the airdrop job kept in the browser; sample mode on the same code (`airdrop-sim.ts`, `settings-sim.ts`); `verify:airdrop` and `verify:settings` on the deploy fixture; and the screens: Airdrop on the view with History, the batch panel and the burn, Settings and the Overview on the settings view, each under its own `ManageActionsProvider`, with the owner check. The sample-only seams (`sampleRequest`, `TxRequest.check` and `valueWei`, `ManageActions.review`, the shared sample target) go once no tab uses them.

**Tech Stack:** TypeScript 6 strict (ESM, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`) consumed as source; Node 26 locally; Next 16.3 (App Router, Turbopack) with React 19; wagmi 2.19 and viem 2.57 (RainbowKit for the wallet); React Query 5; zod 4.6; Vitest 5 (Node environment, no component tests); Supabase local (CLI 2.116) with Postgres; Anvil through `chain:local`; Prettier 3; `@cobweb/shared` consumed as workspace source and transpiled by Next.

**Spec:** [../specs/2026-10-15-airdrop-settings.md](../specs/2026-10-15-airdrop-settings.md)

## Global Constraints

- The spec is the binding authority, its section 14 reconciliations included. Where this plan decides a detail the spec leaves open, the line starts with "Decision:" and the decisions that shape more than one task are collected in the next section.
- Node 26 locally. ESM everywhere. Inside `packages/shared`, relative imports carry the `.ts` extension (`./chains.ts`). Inside `apps/web/src`, imports are extensionless and use the `@/` alias, as the existing files do. Inside `apps/web/scripts`, relative imports carry the `.ts` extension and the app's modules are imported as `../src/...` (the scripts run under `--import ./scripts/resolve-ts.mjs`, which maps `@/` and adds `.ts`; a script never imports a value from a `.tsx` module). `verify-local.ts` runs without that hook and imports nothing from the app. Types are imported with `import type` or an inline `type` specifier.
- Vitest 5, Node environment. One file: `pnpm --filter <package> exec vitest run <file>`, for example `pnpm --filter @cobweb/web exec vitest run src/lib/manage/airdrop-view.test.ts`. No component test exists and none is added: pure modules are unit tested, components are checked by typecheck, lint, build and the browser walk.
- Test fixtures: annotate every fixture constant with its type (`const HASH: Hex = ...`, `const view: AirdropView = ...`), since an unannotated literal widens and fails `tsc`. Never await a sleeping sample call under fake timers without advancing them (`vi.advanceTimersByTimeAsync`); attach a `rejects` expectation before advancing the timers that settle it.
- Prettier: no semicolons, single quotes, trailing commas, 110 columns. Before each commit run `pnpm exec prettier --write <the files you changed>` from the repo root. Never run `pnpm format` or Prettier on `.`. CI runs `pnpm format:check`, so every file you touch outside `docs/` must be formatted (`docs/`, `contracts/out/` and `packages/ui/src/components/` are in `.prettierignore`). The code blocks in this plan are already formatted; Prettier leaves them as they are.
- typescript-eslint's recommended rules and ESLint's `preserve-caught-error` apply. Do not write `throw new X(...)` directly inside a `catch` block. There is no react-hooks lint plugin; write hook dependencies correctly all the same.
- Copy: plain sentences. No em or en dashes anywhere, code, comments, commit messages and docs included. The product is Cobweb; never Kingdomly.
- CLAUDE.md rules 2, 4 and 5 bind this sub-project. The wallet signs exactly the request the simulation passed (rule 2): every batch, burn and setting goes through the manage machine, whose `simulate` returns the only way to send, with the value and the contract the call carries. Every server action checks the session and the ownership (rule 4): the four new actions through `phasesWrite`, after their input is parsed. The airdrop fee is the contract's `fees().airdropFeePerToken`, read from the chain and sent exactly, never computed from an oracle (rule 5). The server writes `airdrops`, `withdrawals` and the `deployments` copies only through `airdrop_record`, `withdrawal_record` and `settings_refresh`, from a proven receipt or a server read, never from a browser value.
- Security: no env name starts with `NEXT_PUBLIC_` except the ones that already do. No secret value is printed, logged or committed: the platform admin's call in `verify:airdrop` goes through Anvil's unlocked account, with no key in the script. An error is logged through `errorSummary` (name and one line) or as its code and message, never as the error object.
- Never deploy to any remote chain or service. Never pass `--prod` or `--target production` to any command. The only chain any step touches is the local Anvil on port 8545; every script refuses an endpoint that is not localhost.
- The repository is linked to a hosted Supabase project (`supabase/.temp`). Never run `supabase db push`, never pass `--linked` or `--project-ref` to any command, never run `supabase db reset` or `supabase stop`. The only Supabase commands a step runs are `supabase migration up --local` and `supabase status`.
- `docs/PLAN.md` must not change. `legacy/` is never read into, copied from, imported or committed.
- Docs keep their history: add dated notes and status sentences; never rewrite or delete earlier statements in `docs/MASTER_PLAN.md`, in specs or in `contracts/README.md`.
- Local services, for Tasks 2, 8 and 11: `supabase start` at the repo root has run (the migrations up to `20261015100000_whitelist.sql` are applied; Task 2 applies the new one with `supabase migration up --local`, which keeps the local data), `supabase seed buckets` has run (it creates the local `art` and `render` buckets; a restart alone does not), and `pnpm --filter @cobweb/web chain:local` is running in the background on port 8545 with its two printed lines (`RPC_URL_31337` and `FACTORY_ADDRESS_31337`) in `apps/web/.env.local`. The local factory approved the shipped creation code at its deploy, and its admin and treasury is Anvil's first account. No step builds the contracts; Task 11's walk sends three calls with Foundry's `cast`, installed with Anvil.
- `verify:local` totals drift as sections are added: this plan states a count as "the previous total plus N", N being the number of `check(` calls a step adds (the previous total is 342).
- Implementers never use `git commit --amend` or `git stash`. To fix a commit, make a new one.
- Before every commit, at the repo root: `pnpm exec prettier --write <the files you changed>`, then `pnpm typecheck && pnpm lint && pnpm test`.
- Commit messages are one plain imperative sentence with no prefix, then a blank line, and end with exactly these two lines:

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
```

## Decisions

1. Decision (spec sections 7 and 10): eleven tasks. The shared package's pins (1), the migration (2), the sentences and the pure views (3), the calls with their shapes, event matches, batch proof and revert sentences (4), the server cores and actions (5), the machine, the job and the bound servers (6), sample mode (7), the two verify scripts on the cores (8), the Airdrop screens (9), then Settings and the Overview, with the sample-only seams removed once no tab uses them (10), and the docs with the walk (11).
2. Decision (section 4.3): `settings_refresh` answers false for an older block before it looks at the payload, then refuses a payload missing any of its six keys with `23502` 'Every setting is required.': `transfer_validator` takes null, so a column check alone would let a missing key through as null. The migration was checked statement by statement in a transaction rolled back on the local database, then applied, run through `verify:local` (363), `verify:airdrop` (15), `verify:settings` (17), `verify:deploy` (15), `verify:phases` (20) and `verify:whitelist` (18), and reversed to the catalog it found.
3. Decision (section 10): `verify:local` section 9m (`artAirdropSettings`, after `artWhitelist`, fixture tag 171, record salt 13) adds nineteen checks and the anon loop two, 342 to 363. Before the migration the two anon checks already pass (PostgREST answers a missing table with `PGRST205`, and the anon check reads any error as nothing read), so the failing run ends `344 passed, 19 failed`.
4. Decision (section 6.4): `matchPhaseEvent` reads the expected event through a local `wanted: { eventName: string; args: Record<string, unknown> }`, so the sixteen-variant union is not narrowed inside the loop, and answers the arguments it decoded; `sameArgs` compares two strings (addresses) without case and anything else (a bigint, a boolean, a number) exactly.
5. Decision (section 7.1): `sentCallShape`'s royalty cap is a local `ROYALTY_MAX_BPS = 1_000`, the deploy form's 10% (`deploy-form.tsx` is a client module the server does not import); the level is the text '0', '1' or '9'; the level call's three flags are `z.literal(false)`; a value or a target on another function is stripped, as zod strips unknown keys. `parseSentCall(input, functions?)` refuses a function outside the set as UNSAVED: Phases confirms with `PHASE_FUNCTIONS`, Settings with `SETTINGS_FUNCTIONS`.
6. Decision (section 7.1): `ManageCall` types the validator's call from `validatorAbi`, so a `ManageCall` no longer fits `collectionAbi` alone. The existing `verify-phases.ts` and `verify-whitelist.ts` simulate with `abi: collectionAbi as Abi` at their three sites, the narrowest change that typechecks, and the tests encode with `abiOf(call) as Abi`.
7. Decision (section 10): `deploy-fixture.ts` gains `simulateCall`, `sendCall`, `simulationSentence` and `handOver` (the ownership round trip), shared by `verify:airdrop` and `verify:settings`, and `removeFixtures` also checks that no `airdrops` or `withdrawals` row is left. The platform admin's `setFees` goes from Anvil's first account (`0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`) as an unlocked JSON-RPC account, so no key is written in a script.
8. Decision (section 7.3): `PendingBatchPanel` takes `onForget` beside `onDiscard`. A terminal answer to "Check again" (the hash is not a batch of this collection) forgets the hash through the machine's `forget` without marking the batch failed; "Discard" forgets it and marks the batch "Discarded before it was confirmed.", with "Retry batch <n>".
9. Decision (section 8): `sampleAirdropJob()` takes no view: the waiting batch is built from the sample's own wallets, and a parameter it never read would fail `no-unused-vars`.
10. Decision (section 7.3): `TxLink` moves from `whitelist-chunks.tsx` to `bits.tsx`, so History and the batch panel show a hash as the Whitelist does: a link where the chain has an explorer, the short hash as text on Anvil.
11. Decision (section 7.3): the reasons a send is off, first that applies: the chain not read (`UNREADABLE_REASON`), then the owner check (the dialogs open with their action off and the sentence; the list is neither frozen nor stored), then a hash waiting ("Confirm or discard the waiting transaction first."). While a hash waits, "Stop and drop the unsent batches" and "Edit the list" are off with the same sentence, so a batch that may have landed is never dropped unseen.
12. Decision (section 7.3): while the chain is not read, Tokens to burn's help reads "Up to 1,000 at a time." without a count left, and both Send and Burn are off.
13. Decision (section 7.5): the Overview's Reveal is off while the chain is not read (the Settings sentence), as well as while no real job is done.
14. Decision (section 8): `SAMPLE` in `manage-sim.ts` keeps only `mintPage`: `transferValidator`, `metadataCid` and `readAt` have no reader once Settings and the Overview read the settings view.
15. Decision (sections 7.4 and 7.5): the Custom pointer reads `<Badge variant="warning">Custom</Badge>`; a batch waiting for its confirm reads `<StatusBadge status="pending">Confirming</StatusBadge>`.
16. Decision (section 12): on Anvil, one batch of 500 fresh wallets with 2 tokens each used 26,880,045 gas, above the 16,777,216 per-transaction cap. `verify:airdrop` prints the figure and says it is above the cap; the landing note records it. The cap stays 500 here: section 12 drops it before launch, which is not this plan's decision.

## Review Focus

Inputs and failure modes the spec implies but its own test list would not exercise, most likely to bite a creator first. Each is pinned to a test in the task that owns the code.

1. A creator pastes the same wallet twice (a spreadsheet joined with another): summed, its tokens pass 1,000, and the batch would be refused on chain or, worse, mint more than one wallet should get. The line that takes the sum past 1,000 is left out with its number and the earlier sum stays. Pinned by "leaves out the repeat that takes an address past 1,000 tokens, with its line, keeping the earlier sum (Review Focus 1)" (Task 3, `recipients.test.ts`).
2. A list of 300 wallets with 5 tokens each is 1,500 tokens: batching by wallets alone would send it in one transaction of 1,500 tokens, which `sentCallShape` refuses and the chain may not fit. A new batch starts at 1,000 tokens under 500 wallets. Pinned by "starts a new batch at 1,000 tokens even under 500 wallets (Review Focus 2)" (Task 3, `airdrop-view.test.ts`).
3. A recipient that is a contract may move its token on inside the same transaction, so the receipt carries a second `Transfer` of that id from the recipient; the minted ids may also arrive out of order. The proof counts only `Transfer`s from the zero address and accepts consecutive ids in any order. Pinned by "accepts consecutive ids in any order, and leaves out a Transfer a recipient contract sends on (Review Focus 3)" (Task 4, `airdrop-batch.test.ts`).
4. A collection deployed on its real job starts with the real job's base URI, which is also its deploy-time URI: checking the placeholder first would call it unrevealed and offer Reveal. The pointer checks the real job first. Pinned by "reads revealed for the real job first, so a collection deployed on its real job reads revealed (Review Focus 4)" (Task 3, `settings-view.test.ts`).
5. `BatchMetadataUpdate` carries no URI, so a reveal confirmed from its event alone would accept any `setBaseURI` the wallet sent. The confirm also decodes the calldata and compares the URI. Pinned by `verify:settings` check "9. back to the real job: its base URI confirmed reads revealed; the custom change's hash confirmed as the real URI's call is not this change, and nothing changes" (Task 8).

## File map

| Path | Task | Responsibility |
| --- | --- | --- |
| `packages/shared/src/validator-abi.ts`, `validator-abi.test.ts`, `index.ts` | 1 | `validatorAbi`, `DEFAULT_TRANSFER_VALIDATOR`, exported from the browser entry |
| `packages/shared/src/collection.test.ts` | 1 | Pins the calls, views, events and errors Airdrop and Settings use |
| `supabase/migrations/20261016000000_airdrop_settings.sql` | 2 | `airdrops`, `withdrawals`, the `deployments` copies, `settings_refresh`, `airdrop_record`, `withdrawal_record` |
| `apps/web/src/lib/database.types.ts` | 2 | The two tables, the two columns and the three functions, by hand |
| `apps/web/scripts/verify-local.ts` | 2 | Two anon checks; section 9m |
| `apps/web/src/lib/art/result.ts`, `db-error.ts`, `db-error.test.ts` | 3 | The Airdrop and Settings sentences; `manageRecordError` |
| `apps/web/src/lib/manage/airdrop-types.ts`, `airdrop-view.ts`, `airdrop-view.test.ts` | 3 | The Airdrop types; the caps, `BURN_ADDRESS`, `tokensOf`, `batchesOf`, `airdropRowsOf`, `airdropViewOf` |
| `apps/web/src/lib/manage/settings-types.ts`, `settings-view.ts`, `settings-view.test.ts` | 3 | The Settings types; `TRANSFER_LEVELS`, `ipfsUriValid`, `tokenUriOf`, `pointerOf`, `levelOf`, `settingsViewOf`, `settingsPayload` |
| `apps/web/src/lib/manage/holders.ts`, `holders.test.ts` | 3 | The dead address from `BURN_ADDRESS` |
| `apps/web/src/components/manage/recipients.ts`, `recipients.test.ts` | 3 | A summed repeat past 1,000 left out with its line |
| `apps/web/src/lib/manage/phase-calls.ts`, `phase-calls.test.ts` | 4 | Payable and validator calls, `airdropCalls`, `settingsCalls`, `abiOf`, the new events, the Value row |
| `apps/web/src/lib/manage/phase-schemas.ts`, `phase-schemas.test.ts` | 4 | The new members of `sentCallShape`; `parseSentCall`'s function filter |
| `apps/web/src/lib/chain/phase-events.ts`, `phase-events.test.ts` | 4 | Any ABI, addresses without case, the decoded arguments answered |
| `apps/web/src/lib/chain/airdrop-batch.ts`, `airdrop-batch.test.ts` | 4 | `proveAirdrop` |
| `apps/web/src/components/deploy/tx-errors.ts`, `tx-errors.test.ts` | 4 | The new revert sentences, amounts with the chain's symbol |
| `apps/web/src/components/manage/manage-actions.ts`, `manage-actions.test.ts` | 4 | The simulation with the value, the contract and its ABI |
| `apps/web/src/lib/chain/quota-chunk.test.ts`, `apps/web/src/components/manage/manage-sim.test.ts`, `apps/web/scripts/verify-phases.ts`, `verify-whitelist.ts` | 4 | The wide ABI where a `ManageCall` is encoded; the new length mismatch sentence |
| `apps/web/src/lib/manage/phases-core.ts`, `apps/web/src/lib/deploy/deploy-core.ts` | 5 | `chainStateOf`, `refreshPhaseCopies`, `doneJobRow` exported; `readDeployment` from `args` |
| `apps/web/src/lib/manage/airdrop-core.ts`, `settings-core.ts` | 5 | The reads, the views and the confirms |
| `apps/web/src/app/actions/airdrop.ts`, `settings.ts`, `phases.ts` | 5 | `getAirdrop`, `confirmAirdrop`, `getSettings`, `confirmSettingsTx`; Phases confirms only its calls |
| `apps/web/src/components/manage/manage-machine.ts`, `manage-machine.test.ts` | 6 | The two new pending answers, the symbol, the airdrop job store |
| `apps/web/src/components/manage/airdrop-job.ts`, `airdrop-job.test.ts`, `airdrop-server.ts`, `settings-server.ts` | 6 | The job's steps; the bound servers |
| `apps/web/src/components/manage/transaction-dialog.tsx` | 6 | `blocked`, the symbol, the wallet step's value |
| `apps/web/src/components/manage/manage-sim.ts`, `manage-sim.test.ts` | 7 | The new calls in the sample revert and apply |
| `apps/web/src/components/manage/airdrop-sim.ts`, `airdrop-sim.test.ts`, `settings-sim.ts`, `settings-sim.test.ts` | 7 | The sample views, servers and waiting job |
| `apps/web/scripts/deploy-fixture.ts`, `verify-airdrop.ts`, `verify-settings.ts`, `apps/web/package.json`, `CLAUDE.md` | 8 | The shared send helpers; the two scripts |
| `apps/web/src/components/manage/bits.tsx`, `whitelist-chunks.tsx` | 9 | `TxLink` shared |
| `apps/web/src/components/manage/airdrop-dialogs.tsx`, `airdrop-parts.tsx`, `airdrop-screen.tsx`, `apps/web/src/app/collections/[id]/manage/airdrop/page.tsx`, `apps/web/src/lib/demo/data.ts` | 9 | The Airdrop tab on the view |
| `apps/web/src/components/manage/settings-dialogs.tsx`, `tradability.tsx`, `settings-screen.tsx`, `apps/web/src/app/collections/[id]/manage/settings/page.tsx` | 10 | The Settings tab on the view |
| `apps/web/src/components/manage/overview-cards.tsx`, `overview-screen.tsx`, `apps/web/src/app/collections/[id]/manage/page.tsx` | 10 | The Overview on the settings view |
| `apps/web/src/components/manage/manage-actions.ts`, `manage-context.tsx`, `manage-sim.ts`, `manage-sim.test.ts`, `manage-machine.ts`, `manage-machine.test.ts`, `transaction-dialog.tsx` | 10 | The sample-only seams removed |
| `docs/MASTER_PLAN.md`, `docs/specs/2026-10-03-creator-flow-ui.md`, `docs/specs/2026-10-14-deploy.md`, `docs/specs/2026-10-15-phases.md`, `docs/specs/2026-10-15-whitelist.md`, `docs/specs/2026-10-15-airdrop-settings.md` | 11 | The status line, the dated notes, the acceptance boxes and the landing note |

---
### Task 1: The shared package ships the validator's ABI and pins what Airdrop and Settings rely on

**Files:**

- Create: `packages/shared/src/validator-abi.ts`, `packages/shared/src/validator-abi.test.ts`
- Modify: `packages/shared/src/index.ts` (the header comment; one export)
- Modify: `packages/shared/src/collection.test.ts` (one helper and one `describe` appended)
- Test: `packages/shared/src/validator-abi.test.ts`, `packages/shared/src/collection.test.ts`

**Interfaces:**

- Consumes: in `collection.test.ts`, `abiOnly` (the ABI-only entry), `namesOf(item)` and `signatureOf(item)` (both defined above the new block), and viem's `getAbiItem`, `toFunctionSelector`, `toEventSelector` (already imported). No generated file changes: `collection-abi.ts` already carries every collection entry below. The validator's entries are written by hand from the pinned creator-token-standards at 980a63b (`contracts/lib/creator-token-standards`), which Foundry never compiles.
- Produces:
  - in `@cobweb/shared` (the browser entry): `validatorAbi` (`as const`, three entries in order: `setTransferSecurityLevelOfCollection(address collection, uint8 level, bool disableAuthorizationMode, bool disableWildcardOperators, bool enableAccountFreezingMode)`, selector `0x317e3e8d`; `getCollectionSecurityPolicy(address collection)`, selector `0xb9554552`, answering the struct `CollectionSecurityPolicyV3` whose third member is `transferSecurityLevel` (uint8); the event `SetTransferSecurityLevel(address indexed collection, uint8 level)`) and `DEFAULT_TRANSFER_VALIDATOR: Address = '0x721C008fdff27BF06E7E123956E2Fe03B63342e3'`
  - pins in `collection.test.ts`: `airdropNFTs(recipients, amounts)` payable, `withdrawMintFunds()`, `setOwnerPayoutAddress(newOwnerPayoutAddress)`, `setDefaultRoyalty(receiver, feeNumerator)`, `setBaseURI(newBaseURI)`, `setMintOnBehalfStatus(status)`, `setTransferValidator(transferValidator_)`, `setFees(mintFeeFlat, mintFeeBps, airdropFeePerToken)`, `transferOwnership(newOwner)`; the views `fees`, `creatorBalance`, `platformBalance`, `pendingBalance`, `ownerPayoutAddress`, `royaltyInfo`, `baseURI`, `getTransferValidator`, `DEFAULT_TRANSFER_VALIDATOR`, `owner`, `tokenURI`; the events `NFTsAirdropped(recipients, amount, feePaid)` (none indexed), `MintFundsWithdrawn(payoutAddress, amount)` (the payout indexed), `OwnerPayoutAddressUpdated`, `DefaultRoyaltyUpdated`, `MintOnBehalfUpdated`, `TransferValidatorUpdated`, `BatchMetadataUpdate` (both indexed) and `Transfer` (all indexed); the errors `ExceedsMaxSupply(requested, available)`, `InsufficientEther(required, provided)`, `TransferToNonERC721ReceiverImplementer()`, `NothingToWithdraw()`, `WithdrawFailed()`, `CreatorTokenBase__InvalidTransferValidatorContract()`, `ERC2981InvalidDefaultRoyalty(uint256,uint256)`, `ERC2981InvalidDefaultRoyaltyReceiver(address)` and `MintToZeroAddress()`. Tasks 4 and 5 read these by name, so a contract change that drops or reorders one fails CI.

- [ ] **Step 1: Write the failing tests**

Create `packages/shared/src/validator-abi.test.ts`:

```ts
import { getAbiItem, getAddress, toEventSelector, toFunctionSelector } from 'viem'
import { describe, expect, it } from 'vitest'
import { DEFAULT_TRANSFER_VALIDATOR, validatorAbi } from './validator-abi.ts'

describe('validatorAbi (docs/specs/2026-10-15-airdrop-settings.md, section 5)', () => {
  it('holds the three entries Settings uses, in order', () => {
    expect(validatorAbi.map((entry) => `${entry.type} ${entry.name}`)).toEqual([
      'function setTransferSecurityLevelOfCollection',
      'function getCollectionSecurityPolicy',
      'event SetTransferSecurityLevel',
    ])
  })

  it("matches the pinned library's signatures and argument names", () => {
    const setter = getAbiItem({ abi: validatorAbi, name: 'setTransferSecurityLevelOfCollection' })
    expect(toFunctionSelector(setter)).toBe(
      toFunctionSelector('setTransferSecurityLevelOfCollection(address,uint8,bool,bool,bool)'),
    )
    expect(toFunctionSelector(setter)).toBe('0x317e3e8d')
    expect(setter.inputs.map((input) => input.name)).toEqual([
      'collection',
      'level',
      'disableAuthorizationMode',
      'disableWildcardOperators',
      'enableAccountFreezingMode',
    ])
    const policy = getAbiItem({ abi: validatorAbi, name: 'getCollectionSecurityPolicy' })
    expect(toFunctionSelector(policy)).toBe('0xb9554552')
    expect(policy.outputs[0]?.components.map((component) => component.name)).toEqual([
      'disableAuthorizationMode',
      'authorizersCannotSetWildcardOperators',
      'transferSecurityLevel',
      'listId',
      'enableAccountFreezingMode',
      'tokenType',
    ])
  })

  it('carries the level event with the collection indexed and the level in data', () => {
    const event = getAbiItem({ abi: validatorAbi, name: 'SetTransferSecurityLevel' })
    expect(toEventSelector(event)).toBe(toEventSelector('SetTransferSecurityLevel(address,uint8)'))
    expect(event.inputs.map((input) => [input.name, input.indexed])).toEqual([
      ['collection', true],
      ['level', false],
    ])
  })

  it('ships the default validator checksummed', () => {
    expect(getAddress(DEFAULT_TRANSFER_VALIDATOR)).toBe(DEFAULT_TRANSFER_VALIDATOR)
    expect(DEFAULT_TRANSFER_VALIDATOR).toBe('0x721C008fdff27BF06E7E123956E2Fe03B63342e3')
  })
})
```

At the end of `packages/shared/src/collection.test.ts`, append:

```ts

/** Whether each input of an event is indexed, in order. */
const indexedOf = (item: { inputs: readonly { indexed?: boolean }[] }) =>
  item.inputs.map((input) => input.indexed === true)

describe('what Airdrop and Settings rely on (docs/specs/2026-10-15-airdrop-settings.md, section 5)', () => {
  it('carries the calls they send, with their selectors and argument names, airdropNFTs payable', () => {
    for (const [name, signature, inputs] of [
      ['airdropNFTs', 'airdropNFTs(address[],uint256[])', ['recipients', 'amounts']],
      ['withdrawMintFunds', 'withdrawMintFunds()', []],
      ['setOwnerPayoutAddress', 'setOwnerPayoutAddress(address)', ['newOwnerPayoutAddress']],
      ['setDefaultRoyalty', 'setDefaultRoyalty(address,uint96)', ['receiver', 'feeNumerator']],
      ['setBaseURI', 'setBaseURI(string)', ['newBaseURI']],
      ['setMintOnBehalfStatus', 'setMintOnBehalfStatus(bool)', ['status']],
      ['setTransferValidator', 'setTransferValidator(address)', ['transferValidator_']],
      ['setFees', 'setFees(uint256,uint256,uint256)', ['mintFeeFlat', 'mintFeeBps', 'airdropFeePerToken']],
      ['transferOwnership', 'transferOwnership(address)', ['newOwner']],
    ] as const) {
      const item = getAbiItem({ abi: abiOnly, name })
      expect(toFunctionSelector(item)).toBe(toFunctionSelector(signature))
      expect(namesOf(item)).toEqual(inputs)
    }
    expect(getAbiItem({ abi: abiOnly, name: 'airdropNFTs' }).stateMutability).toBe('payable')
  })

  it('carries the views the two reads make', () => {
    for (const [name, signature] of [
      ['fees', 'fees()'],
      ['creatorBalance', 'creatorBalance()'],
      ['platformBalance', 'platformBalance()'],
      ['pendingBalance', 'pendingBalance(address)'],
      ['ownerPayoutAddress', 'ownerPayoutAddress()'],
      ['royaltyInfo', 'royaltyInfo(uint256,uint256)'],
      ['baseURI', 'baseURI()'],
      ['getTransferValidator', 'getTransferValidator()'],
      ['DEFAULT_TRANSFER_VALIDATOR', 'DEFAULT_TRANSFER_VALIDATOR()'],
      ['owner', 'owner()'],
      ['tokenURI', 'tokenURI(uint256)'],
    ] as const) {
      expect(toFunctionSelector(getAbiItem({ abi: abiOnly, name }))).toBe(toFunctionSelector(signature))
    }
  })

  it('carries the events the proofs match, with the inputs the proofs read from topics indexed', () => {
    for (const [name, signature, indexed] of [
      ['NFTsAirdropped', 'NFTsAirdropped(uint256,uint256,uint256)', [false, false, false]],
      ['MintFundsWithdrawn', 'MintFundsWithdrawn(address,uint256)', [true, false]],
      ['OwnerPayoutAddressUpdated', 'OwnerPayoutAddressUpdated(address)', [false]],
      ['DefaultRoyaltyUpdated', 'DefaultRoyaltyUpdated(address,uint96)', [false, false]],
      ['MintOnBehalfUpdated', 'MintOnBehalfUpdated(bool)', [false]],
      ['TransferValidatorUpdated', 'TransferValidatorUpdated(address,address)', [false, false]],
      ['BatchMetadataUpdate', 'BatchMetadataUpdate(uint256,uint256)', [true, true]],
      ['Transfer', 'Transfer(address,address,uint256)', [true, true, true]],
    ] as const) {
      const item = getAbiItem({ abi: abiOnly, name })
      expect(toEventSelector(item)).toBe(toEventSelector(signature))
      expect(indexedOf(item)).toEqual(indexed)
    }
    expect(namesOf(getAbiItem({ abi: abiOnly, name: 'NFTsAirdropped' }))).toEqual([
      'recipients',
      'amount',
      'feePaid',
    ])
    expect(namesOf(getAbiItem({ abi: abiOnly, name: 'MintFundsWithdrawn' }))).toEqual([
      'payoutAddress',
      'amount',
    ])
  })

  it('carries the errors the new sentences decode', () => {
    for (const [name, signature] of [
      ['ExceedsMaxSupply', 'ExceedsMaxSupply(uint256,uint256)'],
      ['InsufficientEther', 'InsufficientEther(uint256,uint256)'],
      ['TransferToNonERC721ReceiverImplementer', 'TransferToNonERC721ReceiverImplementer()'],
      ['NothingToWithdraw', 'NothingToWithdraw()'],
      ['WithdrawFailed', 'WithdrawFailed()'],
      [
        'CreatorTokenBase__InvalidTransferValidatorContract',
        'CreatorTokenBase__InvalidTransferValidatorContract()',
      ],
      ['ERC2981InvalidDefaultRoyalty', 'ERC2981InvalidDefaultRoyalty(uint256,uint256)'],
      ['ERC2981InvalidDefaultRoyaltyReceiver', 'ERC2981InvalidDefaultRoyaltyReceiver(address)'],
      ['MintToZeroAddress', 'MintToZeroAddress()'],
    ] as const) {
      expect(signatureOf(getAbiItem({ abi: abiOnly, name }))).toBe(signature)
    }
    expect(namesOf(getAbiItem({ abi: abiOnly, name: 'ExceedsMaxSupply' }))).toEqual([
      'requested',
      'available',
    ])
    expect(namesOf(getAbiItem({ abi: abiOnly, name: 'InsufficientEther' }))).toEqual(['required', 'provided'])
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @cobweb/shared exec vitest run src/validator-abi.test.ts src/collection.test.ts`
Expected: FAIL. `src/validator-abi.test.ts` fails to load with `Error: Cannot find module './validator-abi.ts'`; `src/collection.test.ts` passes its 14 tests (the four new ones pin entries `collection-abi.ts` already carries). The run ends `Test Files  1 failed | 1 passed (2)` and `Tests  14 passed (14)`.

- [ ] **Step 3: The validator's ABI**

Create `packages/shared/src/validator-abi.ts`:

```ts
import type { Address } from 'viem'

// Written by hand from the pinned creator-token-standards (contracts/lib/creator-token-standards at 980a63b):
// src/utils/CreatorTokenTransferValidator.sol lines 809 to 828 (the level setter), 945 to 949 (the policy
// getter) and 179 (the event), the struct in src/utils/TransferPolicy.sol lines 25 to 32, and the address in
// src/utils/CreatorTokenBase.sol line 43. Foundry never compiles the validator, and scripts/copy-abi.ts copies
// only what contracts/out holds, so this file is not generated. Change it only with the pinned library
// (docs/specs/2026-10-15-airdrop-settings.md, section 5).

/** The transfer validator's three entries Settings uses: the level setter, the policy getter and its event. */
export const validatorAbi = [
  {
    type: 'function',
    name: 'setTransferSecurityLevelOfCollection',
    inputs: [
      { name: 'collection', type: 'address', internalType: 'address' },
      { name: 'level', type: 'uint8', internalType: 'uint8' },
      { name: 'disableAuthorizationMode', type: 'bool', internalType: 'bool' },
      { name: 'disableWildcardOperators', type: 'bool', internalType: 'bool' },
      { name: 'enableAccountFreezingMode', type: 'bool', internalType: 'bool' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getCollectionSecurityPolicy',
    inputs: [{ name: 'collection', type: 'address', internalType: 'address' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        internalType: 'struct CollectionSecurityPolicyV3',
        components: [
          { name: 'disableAuthorizationMode', type: 'bool', internalType: 'bool' },
          { name: 'authorizersCannotSetWildcardOperators', type: 'bool', internalType: 'bool' },
          { name: 'transferSecurityLevel', type: 'uint8', internalType: 'uint8' },
          { name: 'listId', type: 'uint120', internalType: 'uint120' },
          { name: 'enableAccountFreezingMode', type: 'bool', internalType: 'bool' },
          { name: 'tokenType', type: 'uint16', internalType: 'uint16' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'event',
    name: 'SetTransferSecurityLevel',
    inputs: [
      { name: 'collection', type: 'address', indexed: true, internalType: 'address' },
      { name: 'level', type: 'uint8', indexed: false, internalType: 'uint8' },
    ],
    anonymous: false,
  },
] as const

/**
 * Limit Break's default transfer validator: what `getTransferValidator()` answers until the owner sets one, the
 * same address on every chain (CreatorTokenBase's `DEFAULT_TRANSFER_VALIDATOR`).
 */
export const DEFAULT_TRANSFER_VALIDATOR: Address = '0x721C008fdff27BF06E7E123956E2Fe03B63342e3'
```

In `packages/shared/src/index.ts`, replace:

```ts
// Browser-safe entry: the chain list, the factory ABI, the job ids, the render queue contract and the deploy
// address helpers. Nothing here reads a server-only variable.
```

with:

```ts
// Browser-safe entry: the chain list, the factory ABI, the job ids, the render queue contract, the deploy
// address helpers and the transfer validator's ABI. Nothing here reads a server-only variable.
```

At the end of `packages/shared/src/index.ts`, append:

```ts
export * from './validator-abi.ts'
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm --filter @cobweb/shared exec vitest run src/validator-abi.test.ts src/collection.test.ts`
Expected: PASS, 2 files and 18 tests.

- [ ] **Step 5: Format, run the root checks and commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
pnpm exec prettier --write packages/shared/src/validator-abi.ts packages/shared/src/validator-abi.test.ts packages/shared/src/index.ts packages/shared/src/collection.test.ts
pnpm typecheck && pnpm lint && pnpm test
git add packages/shared/src/validator-abi.ts packages/shared/src/validator-abi.test.ts packages/shared/src/index.ts packages/shared/src/collection.test.ts
git commit -m "$(cat <<'EOF'
Ship the transfer validator's level call, policy view and event with the default validator in the shared package, and pin the calls, views, events and errors Airdrop and Settings rely on

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: the shared package reports 80 tests (72 before); the web package is unchanged at 588.

---

### Task 2: The airdrop and settings migration, the types by hand and the verify:local section

**Files:**

- Create: `supabase/migrations/20261016000000_airdrop_settings.sql`
- Modify: `apps/web/src/lib/database.types.ts` (`airdrops` and `withdrawals`; `deployments` Row, Insert and Update; three functions; `collection_record_deploy`'s returned row)
- Modify: `apps/web/scripts/verify-local.ts` (the anon loop, the call list at the end of `main`, the new section 9m before `10. Cleanup`)
- Test: `apps/web/scripts/verify-local.ts` (`pnpm --filter @cobweb/web verify:local`)

**Interfaces:**

- Consumes: `private.lock_owned_collection(p_collection_id uuid, p_owner uuid)` (`20261009020000_lock_and_pay.sql`; raises 'collection not found' `42501`), `private.collection_owned(collection_id uuid)` (the owner check every owner policy uses), `public.collections`, `public.deployments` (one row per deployed collection; `state_block` and `state_read_at` are written by `mint_groups_refresh` since `20261015000000_phases.sql`). In `verify-local.ts`, already defined: `renderedFixture(A, payer, tag)`, `recordArgs(owner, cid, payer, n)`, `callArt(client, fn, args)`, `expectError(error, codes, data?)`, `expectSentence(error, codes, sentence)`, `expectNothing(error, data)`, `countRows(table, column, value)`, `insertCollection(client)`, `describe(error)`, `admin`, `anon`, `CHECK`, `PERMISSION`, `ADDRESS40(n)`, `HEX64(n)`, `CID(letter)`, `blockTime(block)`, `NOT_DEPLOYED_SENTENCE`, `NOT_THIS_CHANGE_SENTENCE`, the types `Creator`, `DbError` and `SupabaseClient`.
- Produces (database):
  - `public.airdrops` (`tx_hash` primary key, `^0x[0-9a-f]{64}$`; `collection_id` cascading; `kind` 'airdrop' or 'burn'; `recipients` and `tokens` 1 or more; `fee_paid_wei numeric(78,0)` 0 or more; `first_token_id` 1 or more and `last_token_id` with `last_token_id - first_token_id + 1 = tokens` (`airdrops_token_range`); `block` 0 or more; `sent_by` `^0x[0-9a-f]{40}$`; `confirmed_at` default now(); a burn has one recipient (`airdrops_burn_one_recipient`)) and `public.withdrawals` (`tx_hash` primary key; `collection_id`; `amount_wei numeric(78,0)` above 0; `payout_address` lowercase; `block`; `confirmed_at`). Both: row-level security with "airdrops: owner reads" and "withdrawals: owner reads" through `private.collection_owned`, `authenticated` holding `select` only, `anon` nothing.
  - `deployments`: `royalty_bps` 0 to 10,000 (`deployments_royalty_bps_check`, the contract's range), `transfer_validator text` (null or `^0x[0-9a-f]{40}$`), `mint_on_behalf boolean not null default false`, and comments naming `payout_address`, `royalty_bps`, `royalty_receiver`, `base_uri`, `transfer_validator` and `mint_on_behalf` as copies refreshed by `settings_refresh` alone.
  - `public.settings_refresh(p_collection_id uuid, p_owner uuid, p_block bigint, p_block_time timestamptz, p_settings jsonb) returns boolean`: security definer, `service_role` only; `p_settings` is `{ payout_address, royalty_bps, royalty_receiver, base_uri, transfer_validator, mint_on_behalf }`, addresses lowercase; raises 'collection not found' (`42501`), 'The contract is not deployed yet.' (`23514`) and 'Every setting is required.' (`23502`); answers false for a block older than `state_block` and writes nothing, true when it wrote the six copies, `state_block` and `state_read_at`.
  - `public.airdrop_record(p_collection_id uuid, p_owner uuid, p_tx text, p_kind text, p_recipients integer, p_tokens integer, p_fee_paid_wei numeric, p_first_token_id bigint, p_last_token_id bigint, p_block bigint, p_sent_by text) returns boolean` and `public.withdrawal_record(p_collection_id uuid, p_owner uuid, p_tx text, p_amount_wei numeric, p_payout_address text, p_block bigint) returns boolean`: security definer, `service_role` only; raise 'collection not found' (`42501`), 'The contract is not deployed yet.' and 'The transaction did not make this change.' (`23514`, for a malformed hash, sender, kind or payout address); answer whether they inserted the row (a hash recorded already is left as it is).
- Produces (types): `Database['public']['Tables']` gains `airdrops` and `withdrawals` (numeric columns typed `number`, as the generator writes them; the server reads them `::text`); `deployments` gains `mint_on_behalf: boolean` and `transfer_validator: string | null` (optional in Insert and Update, and in `collection_record_deploy`'s returned row); `Functions` gains `airdrop_record` and `withdrawal_record` (`Returns: boolean`) and `settings_refresh` (`p_settings: Json`, `Returns: boolean`).

- [ ] **Step 1: Write the failing checks**

Section 9m runs on a collection rendered and recorded as deployed as 9k records one (fixture tag 171, record salt 13), beside a draft. The anon loop gains the two tables.

In `apps/web/scripts/verify-local.ts`, replace:

```ts
  for (const table of ['profiles', 'collections', 'mint_groups', 'whitelist_entries']) {
```

with:

```ts
  for (const table of [
    'profiles',
    'collections',
    'mint_groups',
    'whitelist_entries',
    'airdrops',
    'withdrawals',
  ]) {
```

In `apps/web/scripts/verify-local.ts`, replace:

```ts
  await artWhitelist(A, B)
}
```

with:

```ts
  await artWhitelist(A, B)
  await artAirdropSettings(A, B)
}
```

In `apps/web/scripts/verify-local.ts`, replace:

```ts
// ---------------------------------------------------------------------------------------------
// 10. Cleanup
```

with:

```ts
// ---------------------------------------------------------------------------------------------
// 9m. Airdrop and Settings: the deployments copies, airdrops and withdrawals with airdrop_record and
// withdrawal_record, and settings_refresh (docs/specs/2026-10-15-airdrop-settings.md, section 4)
// ---------------------------------------------------------------------------------------------
type AirdropCheckRow = {
  tx_hash: string
  kind: string
  recipients: number
  tokens: number
  fee_paid_wei: string
  first_token_id: number
  last_token_id: number
  block: number
  sent_by: string
}

/** A collection's airdrop rows, as the service role reads them. */
async function airdropRows(cid: string): Promise<AirdropCheckRow[]> {
  const { data, error } = await admin
    .from('airdrops')
    .select(
      'tx_hash, kind, recipients, tokens, fee_paid_wei::text, first_token_id, last_token_id, block, sent_by',
    )
    .eq('collection_id', cid)
  if (error) throw new Error(`airdrops: ${describe(error as DbError)}`)
  return data as unknown as AirdropCheckRow[]
}

type WithdrawalCheckRow = { tx_hash: string; amount_wei: string; payout_address: string; block: number }

/** A collection's withdrawal rows, as the service role reads them. */
async function withdrawalRows(cid: string): Promise<WithdrawalCheckRow[]> {
  const { data, error } = await admin
    .from('withdrawals')
    .select('tx_hash, amount_wei::text, payout_address, block')
    .eq('collection_id', cid)
  if (error) throw new Error(`withdrawals: ${describe(error as DbError)}`)
  return data as unknown as WithdrawalCheckRow[]
}

type SettingsCopyRow = {
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
async function settingsCopy(cid: string): Promise<SettingsCopyRow> {
  const { data, error } = await admin
    .from('deployments')
    .select(
      'payout_address, royalty_bps, royalty_receiver, base_uri, transfer_validator, mint_on_behalf, state_block, state_read_at',
    )
    .eq('collection_id', cid)
    .single()
  if (error) throw new Error(`settings copy: ${describe(error as DbError)}`)
  return data as SettingsCopyRow
}

/** Each refusal as [label, error, codes, words]: null when every one was refused with its code and words. */
function refusedAll(cases: [string, DbError, string[], string][]): string | null {
  const problems = cases.flatMap(([label, error, codes, words]) => {
    const problem = expectSentence(error, codes, words)
    return problem ? [`${label}: ${problem}`] : []
  })
  return problems.length ? problems.join('; ') : null
}

/** An airdrop's hash for the checks. */
const DROP_TX = (n: number) => `0x${HEX64(0xd209_0000 + n)}`
/** A withdrawal's hash for the checks. */
const WITHDRAW_TX = (n: number) => `0x${HEX64(0x3170_0000 + n)}`
/** Limit Break's default validator, lowercase as the copy holds it. */
const VALIDATOR = '0x721c008fdff27bf06e7e123956e2fe03b63342e3'

const dropArgs = (
  owner: string,
  cid: string,
  tx: string,
  sentBy: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  p_collection_id: cid,
  p_owner: owner,
  p_tx: tx,
  p_kind: 'airdrop',
  p_recipients: 2,
  p_tokens: 3,
  p_fee_paid_wei: '300000000000000',
  p_first_token_id: 1,
  p_last_token_id: 3,
  p_block: 40,
  p_sent_by: sentBy,
  ...overrides,
})

const withdrawArgs = (
  owner: string,
  cid: string,
  tx: string,
  payout: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  p_collection_id: cid,
  p_owner: owner,
  p_tx: tx,
  p_amount_wei: '1000000000000000',
  p_payout_address: payout,
  p_block: 41,
  ...overrides,
})

const settingsArgs = (
  owner: string,
  cid: string,
  block: number,
  settings: Record<string, unknown> = {},
): Record<string, unknown> => ({
  p_collection_id: cid,
  p_owner: owner,
  p_block: block,
  p_block_time: blockTime(block),
  p_settings: {
    payout_address: ADDRESS40(0x5e77_0001),
    royalty_bps: 750,
    royalty_receiver: ADDRESS40(0x5e77_0002),
    base_uri: `ipfs://${CID('f')}/`,
    transfer_validator: VALIDATOR,
    mint_on_behalf: true,
    ...settings,
  },
})

async function artAirdropSettings(A: Creator, B: Creator): Promise<void> {
  const payer = A.account.address.toLowerCase()
  // Rendered and recorded as deployed, as 9k records one.
  const { cid } = await renderedFixture(A, payer, 171)
  const recorded = await callArt(admin, 'collection_record_deploy', recordArgs(A.userId, cid, payer, 13))
  if (recorded.error) throw new Error(`setup: record: ${describe(recorded.error)}`)
  // A draft without a deployment: the three functions refuse it.
  const draft = await insertCollection(A.client)
  if (!draft.row) throw new Error(`setup: ${describe(draft.error)}`)
  const draftId = draft.row.id
  const drop = (
    client: SupabaseClient,
    overrides: Record<string, unknown> = {},
    owner = A.userId,
    at = cid,
  ) => callArt(client, 'airdrop_record', dropArgs(owner, at, DROP_TX(2), payer, overrides))
  const withdraw = (
    client: SupabaseClient,
    overrides: Record<string, unknown> = {},
    owner = A.userId,
    at = cid,
  ) => callArt(client, 'withdrawal_record', withdrawArgs(owner, at, WITHDRAW_TX(2), payer, overrides))
  const refresh = (
    client: SupabaseClient,
    block: number,
    settings: Record<string, unknown> = {},
    owner = A.userId,
    at = cid,
  ) => callArt(client, 'settings_refresh', settingsArgs(owner, at, block, settings))
  const recordedRows = async () =>
    (await countRows('airdrops', 'collection_id', cid)) +
    (await countRows('withdrawals', 'collection_id', cid))
  /** The owner's insert (when a row is given), update and delete on a table, each refused for want of a grant. */
  const writesRefused = async (table: string, row: Record<string, unknown> | null) => {
    const results: [string, { data: unknown; error: unknown }][] = []
    if (row) results.push(['insert', await A.client.from(table).insert(row).select()])
    results.push([
      'update',
      await A.client.from(table).update({ block: 99 }).eq('collection_id', cid).select(),
    ])
    results.push(['delete', await A.client.from(table).delete().eq('collection_id', cid).select()])
    return results.flatMap(([label, result]) => {
      const problem = expectError(result.error as DbError, PERMISSION, result.data)
      return problem ? [`${table} ${label}: ${problem}`] : []
    })
  }
  const ownerReads = async (client: SupabaseClient, table: string) => {
    const { data, error } = await client.from(table).select('tx_hash').eq('collection_id', cid)
    if (error) throw new Error(`${table}: ${describe(error as DbError)}`)
    return data.length
  }

  await check(
    'deployments: a new deployment reads transfer_validator null and mint_on_behalf false',
    async () => {
      const { data, error } = await A.client
        .from('deployments')
        .select('transfer_validator, mint_on_behalf')
        .eq('collection_id', cid)
        .single()
      if (error) return describe(error as DbError)
      return data.transfer_validator === null && data.mint_on_behalf === false ? null : JSON.stringify(data)
    },
  )

  await check(
    'airdrops and withdrawals: the owner reads nothing before a record, and a client insert, update or delete is refused',
    async () => {
      if ((await ownerReads(A.client, 'airdrops')) + (await ownerReads(A.client, 'withdrawals')) > 0)
        return 'the owner read a row'
      const problems = [
        ...(await writesRefused('airdrops', {
          tx_hash: DROP_TX(1),
          collection_id: cid,
          kind: 'airdrop',
          recipients: 1,
          tokens: 1,
          fee_paid_wei: 0,
          first_token_id: 1,
          last_token_id: 1,
          block: 1,
          sent_by: payer,
        })),
        ...(await writesRefused('withdrawals', {
          tx_hash: WITHDRAW_TX(1),
          collection_id: cid,
          amount_wei: 1,
          payout_address: payer,
          block: 1,
        })),
      ]
      if (problems.length) return problems.join('; ')
      return (await recordedRows()) === 0 ? null : 'a row was written'
    },
  )

  await check("airdrop_record: a signed-out caller and the owner's session cannot execute it", async () => {
    const problem = refusedAll([
      ['signed out', (await drop(anon)).error, PERMISSION, 'permission denied'],
      ['owner session', (await drop(A.client)).error, PERMISSION, 'permission denied'],
    ])
    if (problem) return problem
    return (await recordedRows()) === 0 ? null : 'a row was written'
  })

  await check('airdrop_record: a draft is refused as not deployed, another owner as not found', async () => {
    const problem = refusedAll([
      ['draft', (await drop(admin, {}, A.userId, draftId)).error, CHECK, NOT_DEPLOYED_SENTENCE],
      ['another owner', (await drop(admin, {}, B.userId)).error, PERMISSION, 'collection not found'],
    ])
    if (problem) return problem
    return (await recordedRows()) === 0 ? null : 'a row was written'
  })

  await check('airdrop_record: a malformed hash, sender or kind is refused as not this change', async () => {
    const problem = refusedAll([
      ['hash', (await drop(admin, { p_tx: `0x${'AB'.repeat(32)}` })).error, CHECK, NOT_THIS_CHANGE_SENTENCE],
      [
        'sender',
        (await drop(admin, { p_sent_by: `0x${'AB'.repeat(20)}` })).error,
        CHECK,
        NOT_THIS_CHANGE_SENTENCE,
      ],
      ['kind', (await drop(admin, { p_kind: 'mint' })).error, CHECK, NOT_THIS_CHANGE_SENTENCE],
    ])
    if (problem) return problem
    return (await recordedRows()) === 0 ? null : 'a row was written'
  })

  await check(
    'airdrop_record: a burn to two recipients, an id range that does not match the tokens, or a negative fee is refused',
    async () => {
      const problem = refusedAll([
        ['burn', (await drop(admin, { p_kind: 'burn' })).error, CHECK, 'airdrops_burn_one_recipient'],
        ['range', (await drop(admin, { p_last_token_id: 4 })).error, CHECK, 'airdrops_token_range'],
        ['fee', (await drop(admin, { p_fee_paid_wei: '-1' })).error, CHECK, 'airdrops_fee_paid_wei_check'],
      ])
      if (problem) return problem
      return (await recordedRows()) === 0 ? null : 'a row was written'
    },
  )

  await check(
    'airdrop_record: records the batch and answers true; the owner reads it and B reads nothing',
    async () => {
      const { data, error } = await drop(admin)
      if (error) return describe(error)
      const rows = await airdropRows(cid)
      const expected: AirdropCheckRow = {
        tx_hash: DROP_TX(2),
        kind: 'airdrop',
        recipients: 2,
        tokens: 3,
        fee_paid_wei: '300000000000000',
        first_token_id: 1,
        last_token_id: 3,
        block: 40,
        sent_by: payer,
      }
      return data === true &&
        JSON.stringify(rows) === JSON.stringify([expected]) &&
        (await ownerReads(A.client, 'airdrops')) === 1 &&
        (await ownerReads(B.client, 'airdrops')) === 0
        ? null
        : `${JSON.stringify(data)} ${JSON.stringify(rows)}`
    },
  )

  await check('airdrop_record: a second record of the hash answers false and changes nothing', async () => {
    const { data, error } = await drop(admin, { p_block: 99, p_tokens: 1, p_last_token_id: 1 })
    if (error) return describe(error)
    const rows = await airdropRows(cid)
    return data === false && rows.length === 1 && rows[0]?.block === 40 && rows[0].tokens === 3
      ? null
      : `${JSON.stringify(data)} ${JSON.stringify(rows)}`
  })

  await check('airdrops: the owner cannot update or delete a recorded row', async () => {
    const problems = await writesRefused('airdrops', null)
    if (problems.length) return problems.join('; ')
    const rows = await airdropRows(cid)
    return rows.length === 1 && rows[0]?.block === 40 ? null : JSON.stringify(rows)
  })

  await check(
    "withdrawal_record: a signed-out caller and the owner's session cannot execute it",
    async () => {
      const problem = refusedAll([
        ['signed out', (await withdraw(anon)).error, PERMISSION, 'permission denied'],
        ['owner session', (await withdraw(A.client)).error, PERMISSION, 'permission denied'],
      ])
      if (problem) return problem
      return (await countRows('withdrawals', 'collection_id', cid)) === 0 ? null : 'a row was written'
    },
  )

  await check(
    'withdrawal_record: a draft is refused as not deployed, another owner as not found, a malformed hash or payout address as not this change',
    async () => {
      const problem = refusedAll([
        ['draft', (await withdraw(admin, {}, A.userId, draftId)).error, CHECK, NOT_DEPLOYED_SENTENCE],
        ['another owner', (await withdraw(admin, {}, B.userId)).error, PERMISSION, 'collection not found'],
        [
          'hash',
          (await withdraw(admin, { p_tx: `0x${'AB'.repeat(32)}` })).error,
          CHECK,
          NOT_THIS_CHANGE_SENTENCE,
        ],
        [
          'payout address',
          (await withdraw(admin, { p_payout_address: `0x${'AB'.repeat(20)}` })).error,
          CHECK,
          NOT_THIS_CHANGE_SENTENCE,
        ],
      ])
      if (problem) return problem
      return (await countRows('withdrawals', 'collection_id', cid)) === 0 ? null : 'a row was written'
    },
  )

  await check('withdrawal_record: an amount of 0 is refused', async () => {
    const problem = expectSentence(
      (await withdraw(admin, { p_amount_wei: '0' })).error,
      CHECK,
      'withdrawals_amount_wei_check',
    )
    if (problem) return problem
    return (await countRows('withdrawals', 'collection_id', cid)) === 0 ? null : 'a row was written'
  })

  await check(
    'withdrawal_record: records the withdrawal and answers true; the owner reads it and B reads nothing',
    async () => {
      const { data, error } = await withdraw(admin)
      if (error) return describe(error)
      const rows = await withdrawalRows(cid)
      const expected: WithdrawalCheckRow = {
        tx_hash: WITHDRAW_TX(2),
        amount_wei: '1000000000000000',
        payout_address: payer,
        block: 41,
      }
      return data === true &&
        JSON.stringify(rows) === JSON.stringify([expected]) &&
        (await ownerReads(A.client, 'withdrawals')) === 1 &&
        (await ownerReads(B.client, 'withdrawals')) === 0
        ? null
        : `${JSON.stringify(data)} ${JSON.stringify(rows)}`
    },
  )

  await check(
    'withdrawal_record: a second record of the hash answers false and changes nothing; the owner cannot update or delete the row',
    async () => {
      const { data, error } = await withdraw(admin, { p_amount_wei: '5', p_block: 99 })
      if (error) return describe(error)
      const problems = await writesRefused('withdrawals', null)
      if (problems.length) return problems.join('; ')
      const rows = await withdrawalRows(cid)
      return data === false &&
        rows.length === 1 &&
        rows[0]?.amount_wei === '1000000000000000' &&
        rows[0].block === 41
        ? null
        : `${JSON.stringify(data)} ${JSON.stringify(rows)}`
    },
  )

  await check("settings_refresh: a signed-out caller and the owner's session cannot execute it", async () => {
    const problem = refusedAll([
      ['signed out', (await refresh(anon, 100)).error, PERMISSION, 'permission denied'],
      ['owner session', (await refresh(A.client, 100)).error, PERMISSION, 'permission denied'],
    ])
    if (problem) return problem
    return (await settingsCopy(cid)).state_block === null ? null : 'a copy was written'
  })

  await check(
    'settings_refresh: a draft is refused as not deployed, another owner as not found',
    async () => {
      const problem = refusedAll([
        ['draft', (await refresh(admin, 100, {}, A.userId, draftId)).error, CHECK, NOT_DEPLOYED_SENTENCE],
        [
          'another owner',
          (await refresh(admin, 100, {}, B.userId)).error,
          PERMISSION,
          'collection not found',
        ],
      ])
      if (problem) return problem
      return (await settingsCopy(cid)).state_block === null ? null : 'a copy was written'
    },
  )

  await check(
    'settings_refresh: writes the six copies, state_block and state_read_at, and answers true',
    async () => {
      const { data, error } = await refresh(admin, 100)
      if (error) return describe(error)
      const copy = await settingsCopy(cid)
      return data === true &&
        copy.payout_address === ADDRESS40(0x5e77_0001) &&
        copy.royalty_bps === 750 &&
        copy.royalty_receiver === ADDRESS40(0x5e77_0002) &&
        copy.base_uri === `ipfs://${CID('f')}/` &&
        copy.transfer_validator === VALIDATOR &&
        copy.mint_on_behalf === true &&
        copy.state_block === 100 &&
        copy.state_read_at !== null &&
        Date.parse(copy.state_read_at) === Date.parse(blockTime(100))
        ? null
        : `${JSON.stringify(data)} ${JSON.stringify(copy)}`
    },
  )

  await check(
    'settings_refresh: an older block answers false and writes nothing; the same block is accepted',
    async () => {
      const older = await refresh(admin, 99, { mint_on_behalf: false, base_uri: `ipfs://${CID('g')}/` })
      if (older.error) return `older: ${describe(older.error)}`
      const unchanged = await settingsCopy(cid)
      if (older.data !== false || unchanged.mint_on_behalf !== true || unchanged.state_block !== 100)
        return `the older block answered ${JSON.stringify(older.data)} and left ${JSON.stringify(unchanged)}`
      const same = await refresh(admin, 100, { mint_on_behalf: false })
      if (same.error) return `same block: ${describe(same.error)}`
      const after = await settingsCopy(cid)
      return same.data === true && after.mint_on_behalf === false && after.state_block === 100
        ? null
        : `${JSON.stringify(same.data)} ${JSON.stringify(after)}`
    },
  )

  await check(
    'settings_refresh: a royalty of 1,500 is copied; 10,001, a malformed address or a missing key is refused; the owner cannot update a copy',
    async () => {
      const copied = await refresh(admin, 101, { royalty_bps: 1500 })
      if (copied.error) return `1,500: ${describe(copied.error)}`
      if ((await settingsCopy(cid)).royalty_bps !== 1500) return 'a royalty of 1,500 was not copied'
      const problem = refusedAll([
        [
          '10,001',
          (await refresh(admin, 102, { royalty_bps: 10_001 })).error,
          CHECK,
          'deployments_royalty_bps_check',
        ],
        [
          'malformed address',
          (await refresh(admin, 102, { payout_address: `0x${'AB'.repeat(20)}` })).error,
          CHECK,
          'deployments_payout_address_check',
        ],
        [
          'missing key',
          (await refresh(admin, 102, { transfer_validator: undefined })).error,
          ['23502'],
          'Every setting is required.',
        ],
      ])
      if (problem) return problem
      const update = await A.client
        .from('deployments')
        .update({ royalty_bps: 100 })
        .eq('collection_id', cid)
        .select()
      const refused = expectError(update.error as DbError, PERMISSION, update.data)
      if (refused) return `owner update: ${refused}`
      const copy = await settingsCopy(cid)
      return copy.royalty_bps === 1500 && copy.state_block === 101 ? null : JSON.stringify(copy)
    },
  )
}

// ---------------------------------------------------------------------------------------------
// 10. Cleanup
```

- [ ] **Step 2: Run the checks to see them fail**

Run: `pnpm --filter @cobweb/web verify:local`
Expected: the run ends `344 passed, 19 failed`. The nineteen FAIL lines are section 9m's: the first reads `42703 column deployments.transfer_validator does not exist`, the others `PGRST205` (no table `airdrops`) or `PGRST202` (no function `airdrop_record`, `withdrawal_record` or `settings_refresh`). The two new anon checks, "anon: reads nothing from airdrops" and "anon: reads nothing from withdrawals", pass already: PostgREST answers a missing table with `PGRST205`, and the anon check reads any error as nothing read.

- [ ] **Step 3: The migration**

Create `supabase/migrations/20261016000000_airdrop_settings.sql`:

```sql
-- Airdrop and Settings (docs/specs/2026-10-15-airdrop-settings.md, section 4): airdrops and withdrawals, Cobweb's
-- records of the transactions it proved, read by the owner and written only by airdrop_record and
-- withdrawal_record; the deployments columns payout_address, royalty_bps, royalty_receiver and base_uri become
-- copies of the contract's values, with the new transfer_validator and mint_on_behalf, written only by
-- settings_refresh from a server read (the deploy-time values stay in args); the royalty copy takes the
-- contract's 0 to 10,000.

-- ---------------------------------------------------------------------------------------------
-- airdrops and withdrawals: one row per transaction Cobweb proved
-- ---------------------------------------------------------------------------------------------
create table public.airdrops (
  tx_hash text primary key check (tx_hash ~ '^0x[0-9a-f]{64}$'),
  collection_id uuid not null references public.collections (id) on delete cascade,
  kind text not null check (kind in ('airdrop', 'burn')),
  recipients integer not null check (recipients >= 1),
  tokens integer not null check (tokens >= 1),
  fee_paid_wei numeric(78, 0) not null check (fee_paid_wei >= 0),
  first_token_id bigint not null check (first_token_id >= 1),
  last_token_id bigint not null,
  block bigint not null check (block >= 0),
  sent_by text not null check (sent_by ~ '^0x[0-9a-f]{40}$'),
  confirmed_at timestamptz not null default now(),
  constraint airdrops_token_range check (last_token_id - first_token_id + 1 = tokens),
  constraint airdrops_burn_one_recipient check (kind <> 'burn' or recipients = 1)
);
create index airdrops_collection_id_block_idx on public.airdrops (collection_id, block desc);

comment on table public.airdrops is
  'One row per airdropNFTs transaction Cobweb proved from its receipt and calldata, written only by airdrop_record. kind is burn when the only recipient is the dead address. Airdrops sent outside Cobweb are not here.';

create table public.withdrawals (
  tx_hash text primary key check (tx_hash ~ '^0x[0-9a-f]{64}$'),
  collection_id uuid not null references public.collections (id) on delete cascade,
  amount_wei numeric(78, 0) not null check (amount_wei > 0),
  payout_address text not null check (payout_address ~ '^0x[0-9a-f]{40}$'),
  block bigint not null check (block >= 0),
  confirmed_at timestamptz not null default now()
);
create index withdrawals_collection_id_idx on public.withdrawals (collection_id);

comment on table public.withdrawals is
  'One row per withdrawMintFunds transaction Cobweb proved from its receipt, with the amount and payout address of its MintFundsWithdrawn event, written only by withdrawal_record. Withdrawals made outside Cobweb are not here.';

-- The owner reads. No client role writes (the revokes undo Supabase's default grants on a new table): the
-- record functions below are the only writers.
alter table public.airdrops enable row level security;
create policy "airdrops: owner reads" on public.airdrops
for select to authenticated
using ((select private.collection_owned(collection_id)));
revoke all on public.airdrops from anon, authenticated;
grant select on public.airdrops to authenticated;

alter table public.withdrawals enable row level security;
create policy "withdrawals: owner reads" on public.withdrawals
for select to authenticated
using ((select private.collection_owned(collection_id)));
revoke all on public.withdrawals from anon, authenticated;
grant select on public.withdrawals to authenticated;

-- ---------------------------------------------------------------------------------------------
-- deployments: the settings become copies of the contract's, the royalty copy takes the contract's range
-- ---------------------------------------------------------------------------------------------
alter table public.deployments drop constraint deployments_royalty_bps_check;
alter table public.deployments
  add constraint deployments_royalty_bps_check check (royalty_bps between 0 and 10000),
  add column transfer_validator text check (transfer_validator ~ '^0x[0-9a-f]{40}$'),
  add column mint_on_behalf boolean not null default false;

comment on column public.deployments.payout_address is
  'A copy of the contract''s ownerPayoutAddress(), refreshed by settings_refresh alone. The value at deploy stays in args.payout.';
comment on column public.deployments.royalty_bps is
  'A copy of the contract''s default royalty in basis points (royaltyInfo(1, 10000)), refreshed by settings_refresh alone. The contract allows up to 10,000; Cobweb sets at most 1,000. The value at deploy stays in args.royaltyBps.';
comment on column public.deployments.royalty_receiver is
  'A copy of the default royalty''s receiver (royaltyInfo(1, 10000)), refreshed by settings_refresh alone. The value at deploy stays in args.royaltyReceiver.';
comment on column public.deployments.base_uri is
  'A copy of the contract''s baseURI(), refreshed by settings_refresh alone. The value at deploy stays in args.baseUri.';
comment on column public.deployments.transfer_validator is
  'A copy of the contract''s getTransferValidator(), refreshed by settings_refresh alone: null until the first read, the zero address for no validator.';
comment on column public.deployments.mint_on_behalf is
  'A copy of collectionState().mintOnBehalfActive, refreshed by settings_refresh alone. False at deploy.';
comment on column public.deployments.state_block is
  'The block of the server read the copies were last refreshed from: mint_groups price_wei, max_supply and start_at and public_max_per_wallet by mint_groups_refresh; payout_address, royalty_bps, royalty_receiver, base_uri, transfer_validator and mint_on_behalf by settings_refresh.';

-- ---------------------------------------------------------------------------------------------
-- settings_refresh: the settings copies from a server read, at that read's block
-- ---------------------------------------------------------------------------------------------
-- Service role only. p_settings is { payout_address, royalty_bps, royalty_receiver, base_uri,
-- transfer_validator, mint_on_behalf }, addresses lowercase, every key required. A read older than the last
-- one writes nothing and answers false; the same block is accepted, since the server refreshes the phase
-- copies first with that block. The column checks raise as they are.
create function public.settings_refresh(
  p_collection_id uuid,
  p_owner uuid,
  p_block bigint,
  p_block_time timestamptz,
  p_settings jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_collection public.collections;
  v_deployment public.deployments;
begin
  v_collection := private.lock_owned_collection(p_collection_id, p_owner);
  select d.* into v_deployment
  from public.deployments d
  where d.collection_id = v_collection.id
  for update;
  if not found then
    raise exception 'The contract is not deployed yet.' using errcode = '23514';
  end if;
  -- A slower read never overwrites a newer one.
  if v_deployment.state_block is not null and p_block < v_deployment.state_block then
    return false;
  end if;
  -- transfer_validator takes null (not read yet), so a missing key is refused here rather than by a column.
  if p_settings is null or not (p_settings ?& array[
    'payout_address', 'royalty_bps', 'royalty_receiver', 'base_uri', 'transfer_validator', 'mint_on_behalf'
  ]) then
    raise exception 'Every setting is required.' using errcode = '23502';
  end if;
  update public.deployments d
  set payout_address = p_settings->>'payout_address',
      royalty_bps = (p_settings->>'royalty_bps')::integer,
      royalty_receiver = p_settings->>'royalty_receiver',
      base_uri = p_settings->>'base_uri',
      transfer_validator = p_settings->>'transfer_validator',
      mint_on_behalf = (p_settings->>'mint_on_behalf')::boolean,
      state_block = p_block,
      state_read_at = p_block_time
  where d.collection_id = v_collection.id;
  return true;
end;
$$;

revoke all on function public.settings_refresh(uuid, uuid, bigint, timestamptz, jsonb)
  from public, anon, authenticated;
grant execute on function public.settings_refresh(uuid, uuid, bigint, timestamptz, jsonb) to service_role;

-- ---------------------------------------------------------------------------------------------
-- airdrop_record: one airdropNFTs transaction the server proved from its receipt and calldata
-- ---------------------------------------------------------------------------------------------
-- Service role only; p_owner must equal collections.owner_id. A hash, sender or kind that is not well formed
-- is not this change. A hash already recorded is left as it is (the proofs tie a hash to one contract): the
-- function answers whether it inserted the row. The table's checks raise as they are.
create function public.airdrop_record(
  p_collection_id uuid,
  p_owner uuid,
  p_tx text,
  p_kind text,
  p_recipients integer,
  p_tokens integer,
  p_fee_paid_wei numeric,
  p_first_token_id bigint,
  p_last_token_id bigint,
  p_block bigint,
  p_sent_by text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_collection public.collections;
begin
  v_collection := private.lock_owned_collection(p_collection_id, p_owner);
  if not exists (select 1 from public.deployments d where d.collection_id = v_collection.id) then
    raise exception 'The contract is not deployed yet.' using errcode = '23514';
  end if;
  if p_tx is null or p_tx !~ '^0x[0-9a-f]{64}$'
    or p_sent_by is null or p_sent_by !~ '^0x[0-9a-f]{40}$'
    or p_kind is null or p_kind not in ('airdrop', 'burn') then
    raise exception 'The transaction did not make this change.' using errcode = '23514';
  end if;
  insert into public.airdrops (
    tx_hash, collection_id, kind, recipients, tokens, fee_paid_wei, first_token_id, last_token_id, block, sent_by
  )
  values (
    p_tx, v_collection.id, p_kind, p_recipients, p_tokens, p_fee_paid_wei, p_first_token_id, p_last_token_id,
    p_block, p_sent_by
  )
  on conflict (tx_hash) do nothing;
  return found;
end;
$$;

revoke all on function public.airdrop_record(uuid, uuid, text, text, integer, integer, numeric, bigint, bigint, bigint, text)
  from public, anon, authenticated;
grant execute on function public.airdrop_record(uuid, uuid, text, text, integer, integer, numeric, bigint, bigint, bigint, text)
  to service_role;

-- ---------------------------------------------------------------------------------------------
-- withdrawal_record: one withdrawMintFunds transaction the server proved from its receipt
-- ---------------------------------------------------------------------------------------------
-- Service role only, as airdrop_record: the amount and the payout address come from the receipt's
-- MintFundsWithdrawn event. Answers whether it inserted the row.
create function public.withdrawal_record(
  p_collection_id uuid,
  p_owner uuid,
  p_tx text,
  p_amount_wei numeric,
  p_payout_address text,
  p_block bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_collection public.collections;
begin
  v_collection := private.lock_owned_collection(p_collection_id, p_owner);
  if not exists (select 1 from public.deployments d where d.collection_id = v_collection.id) then
    raise exception 'The contract is not deployed yet.' using errcode = '23514';
  end if;
  if p_tx is null or p_tx !~ '^0x[0-9a-f]{64}$'
    or p_payout_address is null or p_payout_address !~ '^0x[0-9a-f]{40}$' then
    raise exception 'The transaction did not make this change.' using errcode = '23514';
  end if;
  insert into public.withdrawals (tx_hash, collection_id, amount_wei, payout_address, block)
  values (p_tx, v_collection.id, p_amount_wei, p_payout_address, p_block)
  on conflict (tx_hash) do nothing;
  return found;
end;
$$;

revoke all on function public.withdrawal_record(uuid, uuid, text, numeric, text, bigint)
  from public, anon, authenticated;
grant execute on function public.withdrawal_record(uuid, uuid, text, numeric, text, bigint) to service_role;
```

- [ ] **Step 4: The types, by hand**

Decision (section 4.4): written as the generator writes them (keys in alphabetical order, `numeric` as `number`, the new columns optional in Insert and Update), in the same commit as the migration.

In `apps/web/src/lib/database.types.ts`, replace:

```ts
    Tables: {
      art_collections: {
```

with:

```ts
    Tables: {
      airdrops: {
        Row: {
          block: number
          collection_id: string
          confirmed_at: string
          fee_paid_wei: number
          first_token_id: number
          kind: string
          last_token_id: number
          recipients: number
          sent_by: string
          tokens: number
          tx_hash: string
        }
        Insert: {
          block: number
          collection_id: string
          confirmed_at?: string
          fee_paid_wei: number
          first_token_id: number
          kind: string
          last_token_id: number
          recipients: number
          sent_by: string
          tokens: number
          tx_hash: string
        }
        Update: {
          block?: number
          collection_id?: string
          confirmed_at?: string
          fee_paid_wei?: number
          first_token_id?: number
          kind?: string
          last_token_id?: number
          recipients?: number
          sent_by?: string
          tokens?: number
          tx_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: 'airdrops_collection_id_fkey'
            columns: ['collection_id']
            isOneToOne: false
            referencedRelation: 'collections'
            referencedColumns: ['id']
          },
        ]
      }
      art_collections: {
```

In `apps/web/src/lib/database.types.ts`, replace:

```ts
          chain_id: number
          code_hash: string
          collection_id: string
          contract_address: string
          created_at: string
          deployed_at: string
          deployer: string
          factory: string
          mint_fee_bps: number
          mint_fee_flat_wei: number
          payout_address: string
          public_max_per_wallet: number
          royalty_bps: number
          royalty_receiver: string
          salt: string
          state_block: number | null
          state_read_at: string | null
          tx_hash: string
        }
        Insert: {
```

with:

```ts
          chain_id: number
          code_hash: string
          collection_id: string
          contract_address: string
          created_at: string
          deployed_at: string
          deployer: string
          factory: string
          mint_fee_bps: number
          mint_fee_flat_wei: number
          mint_on_behalf: boolean
          payout_address: string
          public_max_per_wallet: number
          royalty_bps: number
          royalty_receiver: string
          salt: string
          state_block: number | null
          state_read_at: string | null
          tx_hash: string
        }
        Insert: {
```

In `apps/web/src/lib/database.types.ts`, replace:

```ts
          salt: string
          state_block: number | null
          state_read_at: string | null
          tx_hash: string
        }
        Insert: {
```

with:

```ts
          salt: string
          state_block: number | null
          state_read_at: string | null
          transfer_validator: string | null
          tx_hash: string
        }
        Insert: {
```

In `apps/web/src/lib/database.types.ts`, replace:

```ts
          deployed_at?: string
          deployer: string
          factory: string
          mint_fee_bps: number
          mint_fee_flat_wei: number
          payout_address: string
          public_max_per_wallet: number
          royalty_bps: number
          royalty_receiver: string
```

with:

```ts
          deployed_at?: string
          deployer: string
          factory: string
          mint_fee_bps: number
          mint_fee_flat_wei: number
          mint_on_behalf?: boolean
          payout_address: string
          public_max_per_wallet: number
          royalty_bps: number
          royalty_receiver: string
```

In `apps/web/src/lib/database.types.ts`, replace:

```ts
          state_read_at?: string | null
          tx_hash: string
```

with:

```ts
          state_read_at?: string | null
          transfer_validator?: string | null
          tx_hash: string
```

In `apps/web/src/lib/database.types.ts`, replace:

```ts
          mint_fee_flat_wei?: number
          payout_address?: string
```

with:

```ts
          mint_fee_flat_wei?: number
          mint_on_behalf?: boolean
          payout_address?: string
```

In `apps/web/src/lib/database.types.ts`, replace:

```ts
          state_read_at?: string | null
          tx_hash?: string
```

with:

```ts
          state_read_at?: string | null
          transfer_validator?: string | null
          tx_hash?: string
```

In `apps/web/src/lib/database.types.ts`, replace:

```ts
        ]
      }
    }
```

with:

```ts
        ]
      }
      withdrawals: {
        Row: {
          amount_wei: number
          block: number
          collection_id: string
          confirmed_at: string
          payout_address: string
          tx_hash: string
        }
        Insert: {
          amount_wei: number
          block: number
          collection_id: string
          confirmed_at?: string
          payout_address: string
          tx_hash: string
        }
        Update: {
          amount_wei?: number
          block?: number
          collection_id?: string
          confirmed_at?: string
          payout_address?: string
          tx_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: 'withdrawals_collection_id_fkey'
            columns: ['collection_id']
            isOneToOne: false
            referencedRelation: 'collections'
            referencedColumns: ['id']
          },
        ]
      }
    }
```

In `apps/web/src/lib/database.types.ts`, replace:

```ts
    Functions: {
      art_batch_done: {
```

with:

```ts
    Functions: {
      airdrop_record: {
        Args: {
          p_block: number
          p_collection_id: string
          p_fee_paid_wei: number
          p_first_token_id: number
          p_kind: string
          p_last_token_id: number
          p_owner: string
          p_recipients: number
          p_sent_by: string
          p_tokens: number
          p_tx: string
        }
        Returns: boolean
      }
      art_batch_done: {
```

In `apps/web/src/lib/database.types.ts`, replace:

```ts
          mint_fee_flat_wei: number
          payout_address: string
```

with:

```ts
          mint_fee_flat_wei: number
          mint_on_behalf: boolean
          payout_address: string
```

In `apps/web/src/lib/database.types.ts`, replace:

```ts
          state_read_at: string | null
          tx_hash: string
```

with:

```ts
          state_read_at: string | null
          transfer_validator: string | null
          tx_hash: string
```

In `apps/web/src/lib/database.types.ts`, replace:

```ts
      }
      swap_token_ids_for_check: {
```

with:

```ts
      }
      settings_refresh: {
        Args: {
          p_block: number
          p_block_time: string
          p_collection_id: string
          p_owner: string
          p_settings: Json
        }
        Returns: boolean
      }
      swap_token_ids_for_check: {
```

In `apps/web/src/lib/database.types.ts`, replace:

```ts
          updated: number
        }[]
      }
```

with:

```ts
          updated: number
        }[]
      }
      withdrawal_record: {
        Args: {
          p_amount_wei: number
          p_block: number
          p_collection_id: string
          p_owner: string
          p_payout_address: string
          p_tx: string
        }
        Returns: boolean
      }
```

- [ ] **Step 5: Apply the migration and run the checks to see them pass**

Run: `supabase migration up --local`
Expected: `Applying migration 20261016000000_airdrop_settings.sql...`, then a line ending `"message":"Migrations applied"}`.

Run: `pnpm --filter @cobweb/web verify:local`
Expected: `363 passed, 0 failed` (the previous total plus 21), with these lines among them:

```
PASS anon: reads nothing from airdrops
PASS anon: reads nothing from withdrawals
PASS deployments: a new deployment reads transfer_validator null and mint_on_behalf false
PASS airdrops and withdrawals: the owner reads nothing before a record, and a client insert, update or delete is refused
PASS airdrop_record: a signed-out caller and the owner's session cannot execute it
PASS airdrop_record: a draft is refused as not deployed, another owner as not found
PASS airdrop_record: a malformed hash, sender or kind is refused as not this change
PASS airdrop_record: a burn to two recipients, an id range that does not match the tokens, or a negative fee is refused
PASS airdrop_record: records the batch and answers true; the owner reads it and B reads nothing
PASS airdrop_record: a second record of the hash answers false and changes nothing
PASS airdrops: the owner cannot update or delete a recorded row
PASS withdrawal_record: a signed-out caller and the owner's session cannot execute it
PASS withdrawal_record: a draft is refused as not deployed, another owner as not found, a malformed hash or payout address as not this change
PASS withdrawal_record: an amount of 0 is refused
PASS withdrawal_record: records the withdrawal and answers true; the owner reads it and B reads nothing
PASS withdrawal_record: a second record of the hash answers false and changes nothing; the owner cannot update or delete the row
PASS settings_refresh: a signed-out caller and the owner's session cannot execute it
PASS settings_refresh: a draft is refused as not deployed, another owner as not found
PASS settings_refresh: writes the six copies, state_block and state_read_at, and answers true
PASS settings_refresh: an older block answers false and writes nothing; the same block is accepted
PASS settings_refresh: a royalty of 1,500 is copied; 10,001, a malformed address or a missing key is refused; the owner cannot update a copy
```

A FAIL line names what it found instead; report it to the controller with the line.

- [ ] **Step 6: Format, run the root checks and commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
pnpm exec prettier --write apps/web/src/lib/database.types.ts apps/web/scripts/verify-local.ts
pnpm typecheck && pnpm lint && pnpm test
git add supabase/migrations/20261016000000_airdrop_settings.sql apps/web/src/lib/database.types.ts apps/web/scripts/verify-local.ts
git commit -m "$(cat <<'EOF'
Add the airdrop and settings migration: airdrops and withdrawals read by the owner and written by airdrop_record and withdrawal_record, the deployments settings as copies refreshed by settings_refresh with transfer_validator and mint_on_behalf, and the royalty copy on the contract's range, with their verify:local checks

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: test counts unchanged (shared 80, web 588).

---

### Task 3: The Airdrop and Settings sentences, the types, the pure views, the dead address shared and a summed repeat checked

**Files:**

- Modify: `apps/web/src/lib/art/result.ts` (the Airdrop and Settings block appended)
- Modify: `apps/web/src/lib/art/db-error.ts` (one import; `manageRecordError` appended), `apps/web/src/lib/art/db-error.test.ts` (imports; a `describe` appended)
- Create: `apps/web/src/lib/manage/airdrop-types.ts`, `apps/web/src/lib/manage/airdrop-view.ts`, `apps/web/src/lib/manage/airdrop-view.test.ts`
- Create: `apps/web/src/lib/manage/settings-types.ts`, `apps/web/src/lib/manage/settings-view.ts`, `apps/web/src/lib/manage/settings-view.test.ts`
- Modify: `apps/web/src/lib/manage/holders.ts`, `apps/web/src/lib/manage/holders.test.ts` (the dead address from `BURN_ADDRESS`)
- Modify: `apps/web/src/components/manage/recipients.ts`, `apps/web/src/components/manage/recipients.test.ts` (a summed repeat past the most an address may get)
- Test: the five test files above

**Interfaces:**

- Consumes: in `@/lib/art/result`, `NOT_DEPLOYED`, `NOT_FOUND`, `NOT_THIS_CHANGE`, `UNSAVED` (already there); `DbError = { code?: string; message: string } | null` in `@/lib/art/db-error`; `parseRecipients(text, options: ParseOptions)` in `@/components/manage/recipients` (`ParseOptions = { defaultAmount; maxAmount; onDuplicate: 'last' | 'sum'; amountName }`; Airdrop's options sum repeats with a maximum of 1,000 and the name "quantity"); `PreparedArgs` (`@/lib/deploy/deploy-types`: `payout`, `baseUri`, `royaltyBps`, `royaltyReceiver` among its keys), `FeeSnapshot` (`@/lib/demo/types`: `{ mintFeeFlatWei: string; mintFeeBps: number; airdropFeePerTokenWei: string }`), `ChainState` (`@/lib/manage/phases-types`, with `mintOnBehalfActive`); viem's `getAddress`, `zeroAddress`.
- Produces:
  - in `@/lib/art/result`: `AIRDROP_NOT_CONFIRMED`, `AIRDROP_TIMED_OUT`, `SETTINGS_NOT_CONFIRMED`, `SETTINGS_TIMED_OUT`, `NOT_OWNER(owner: string): string`, `IPFS_LINK_INVALID`
  - `manageRecordError(error: DbError): string` in `@/lib/art/db-error`: `42501` reads NOT_FOUND, `23514` with NOT_DEPLOYED or NOT_THIS_CHANGE passes through, anything else UNSAVED
  - in `@/lib/manage/airdrop-types` (types only): `AirdropKind = 'airdrop' | 'burn'`, `AirdropRow = { txHash: Hex; kind; recipients; tokens; feePaidWei: string; firstTokenId; lastTokenId; block; confirmedAt: number }` (Unix seconds), `AirdropView = { chainId; contract: Address; owner: Address | null; feePerTokenWei: string | null; maxSupply: number; totalMinted: number | null; left: number | null; history: AirdropRow[]; blockTimestamp; readAt; chainReachable: boolean }`, `BatchEntry = { address: Address; amount: number }`, `AirdropJob = { kind: AirdropKind; batches: BatchEntry[][]; sent: number; pending: Hex | null }`, `AirdropState = { block: bigint; blockTimestamp; maxSupply; totalMinted; feePerTokenWei: string; owner: Address }`, `AirdropReader = (chainId, address, atLeast?) => Promise<AirdropState | null>`
  - in `@/lib/manage/airdrop-view`: `AIRDROP_MAX_RECIPIENTS = 500`, `AIRDROP_MAX_TOKENS = 1_000`, `AIRDROP_MAX_PER_ADDRESS = 1_000`, `BURN_ADDRESS: Address = '0x000000000000000000000000000000000000dEaD'`, `AirdropDbRow` (the `airdrops` columns the server reads, the fee as text), `tokensOf(entries): number`, `batchesOf(entries): BatchEntry[][]`, `airdropRowsOf(rows: AirdropDbRow[]): AirdropRow[]`, `airdropViewOf(base: { chainId; contract; maxSupply; readAt }, history: AirdropRow[], state: AirdropState | null): AirdropView`
  - in `@/lib/manage/settings-types` (types only): `TransferLevelState = { kind: 'none'; reason: 'zero' | 'no-code' } | { kind: 'unread' } | { kind: 'level'; level: number }`, `RevealPointer = 'revealed' | 'placeholder' | 'custom'`, `RevealTargets = { real: string | null; placeholder: string | null; start: string }`, `SettingsView` (`chainId`, `contract`, `owner`, `creatorBalanceWei`, `platformBalanceWei`, `pendingBalanceWei`, `fees: FeeSnapshot | null` (each null while the chain does not answer), `withdrawnWei: string`, `payout`, `royaltyBps`, `royaltyReceiver`, `baseUri`, `transferValidator: Address | null`, `mintOnBehalf`, `level: TransferLevelState | null`, `targets`, `pointer`, `realArtRendered`, `blockTimestamp`, `readAt`, `chainReachable`), `SettingsState` (one read: `block`, `blockTimestamp`, `chain: ChainState`, the three balances, `payout`, `royaltyBps`, `royaltyReceiver`, `baseUri`, `validator`, `owner`, `fees`, `level`), `SettingsReader = (chainId, address, wallet, atLeast?) => Promise<SettingsState | null>`, `SettingsCopyRow` (the six copies and `args: PreparedArgs`)
  - in `@/lib/manage/settings-view`: `TRANSFER_LEVELS = { enforced: 0, open: 1, locked: 9 } as const`, `TransferLevelValue`, `BASE_URI_MAX = 512`, `ipfsUriValid(value): boolean`, `tokenUriOf(base): string`, `pointerOf(baseUri, targets): RevealPointer`, `levelOf(validator: Address, hasCode: boolean, policyLevel: number | null): TransferLevelState`, `settingsViewOf(base: { chainId; contract; readAt }, copies: SettingsCopyRow, targets: RevealTargets, withdrawnWei: string, state: SettingsState | null): SettingsView`, `settingsPayload(state: SettingsState)` (the six keys `settings_refresh` takes, addresses lowercase)
  - `holdersOf` leaves out `BURN_ADDRESS` in any case, as it left out the dead address before; `parseRecipients` with `onDuplicate: 'sum'` leaves out the line whose sum passes `maxAmount`, with the reason "With its earlier lines, the <amountName> for this address passes <maxAmount>." and the earlier sum kept

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/lib/manage/airdrop-view.test.ts`:

```ts
import { getAddress, pad, toHex, type Address, type Hex } from 'viem'
import { describe, expect, it } from 'vitest'
import type { AirdropRow, AirdropState, AirdropView, BatchEntry } from './airdrop-types'
import { airdropRowsOf, airdropViewOf, batchesOf, tokensOf, type AirdropDbRow } from './airdrop-view'

const CONTRACT: Address = '0x0409454C375c8a6aB05383bFB6D9FcDe9ebB8F85'
const OWNER: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const TX_A: Hex = `0x${'a1'.repeat(32)}`
const TX_B: Hex = `0x${'b2'.repeat(32)}`

/** A wallet of its own for each index. */
const wallet = (index: number): Address => getAddress(pad(toHex(index + 1), { size: 20 }))
const entries = (count: number, amount: number): BatchEntry[] =>
  Array.from({ length: count }, (_, index) => ({ address: wallet(index), amount }))
/** Each batch as "<wallets>:<tokens>". */
const sizes = (batches: BatchEntry[][]) => batches.map((batch) => `${batch.length}:${tokensOf(batch)}`)

describe('batchesOf', () => {
  it('splits 1,200 wallets of one token into batches of 500 wallets', () => {
    expect(sizes(batchesOf(entries(1_200, 1)))).toEqual(['500:500', '500:500', '200:200'])
  })

  it('starts a new batch at 1,000 tokens even under 500 wallets (Review Focus 2)', () => {
    expect(sizes(batchesOf(entries(600, 2)))).toEqual(['500:1000', '100:200'])
    expect(sizes(batchesOf(entries(300, 4)))).toEqual(['250:1000', '50:200'])
  })

  it("keeps the list's order: an entry that does not fit starts the next batch", () => {
    const list: BatchEntry[] = [
      { address: wallet(0), amount: 600 },
      { address: wallet(1), amount: 500 },
      { address: wallet(2), amount: 400 },
      { address: wallet(3), amount: 1000 },
    ]
    expect(batchesOf(list)).toEqual([[list[0]], [list[1], list[2]], [list[3]]])
  })

  it('copies only the address and the amount of each entry, and answers no batch for no entries', () => {
    const parsed = { address: wallet(0), amount: 2, line: 7 }
    expect(batchesOf([parsed])).toEqual([[{ address: wallet(0), amount: 2 }]])
    expect(batchesOf([])).toEqual([])
  })
})

const ROWS: AirdropDbRow[] = [
  {
    tx_hash: TX_B,
    kind: 'burn',
    recipients: 1,
    tokens: 2,
    fee_paid_wei: '100000000000000',
    first_token_id: 11,
    last_token_id: 12,
    block: 21_499_995,
    confirmed_at: '2026-10-13T15:00:00.400+00:00',
  },
  {
    tx_hash: TX_A,
    kind: 'airdrop',
    recipients: 4,
    tokens: 10,
    fee_paid_wei: '500000000000000',
    first_token_id: 1,
    last_token_id: 10,
    block: 21_499_990,
    confirmed_at: '2026-10-11T15:00:00+00:00',
  },
]

describe('airdropRowsOf', () => {
  it('keeps the order read and reads confirmed_at as Unix seconds', () => {
    expect(airdropRowsOf(ROWS)).toEqual<AirdropRow[]>([
      {
        txHash: TX_B,
        kind: 'burn',
        recipients: 1,
        tokens: 2,
        feePaidWei: '100000000000000',
        firstTokenId: 11,
        lastTokenId: 12,
        block: 21_499_995,
        confirmedAt: 1_791_903_600,
      },
      {
        txHash: TX_A,
        kind: 'airdrop',
        recipients: 4,
        tokens: 10,
        feePaidWei: '500000000000000',
        firstTokenId: 1,
        lastTokenId: 10,
        block: 21_499_990,
        confirmedAt: 1_791_730_800,
      },
    ])
  })
})

describe('airdropViewOf', () => {
  const base = { chainId: 31337, contract: CONTRACT, maxSupply: 3, readAt: 1_791_000_000 }
  const history = airdropRowsOf(ROWS)
  const state: AirdropState = {
    block: 120n,
    blockTimestamp: 1_791_039_600,
    maxSupply: 12,
    totalMinted: 4,
    feePerTokenWei: '100000000000000',
    owner: OWNER,
  }

  it("reads the fee, the owner, minted and left from a read, at the read's block time", () => {
    expect(airdropViewOf(base, history, state)).toEqual<AirdropView>({
      chainId: 31337,
      contract: CONTRACT,
      owner: OWNER,
      feePerTokenWei: '100000000000000',
      maxSupply: 12,
      totalMinted: 4,
      left: 8,
      history,
      blockTimestamp: 1_791_039_600,
      readAt: 1_791_039_600,
      chainReachable: true,
    })
    expect(airdropViewOf(base, history, { ...state, totalMinted: 13 }).left).toBe(0)
  })

  it("answers Cobweb's record alone when the chain does not answer", () => {
    expect(airdropViewOf(base, history, null)).toEqual<AirdropView>({
      chainId: 31337,
      contract: CONTRACT,
      owner: null,
      feePerTokenWei: null,
      maxSupply: 3,
      totalMinted: null,
      left: null,
      history,
      blockTimestamp: 1_791_000_000,
      readAt: 1_791_000_000,
      chainReachable: false,
    })
  })
})
```

Create `apps/web/src/lib/manage/settings-view.test.ts`:

```ts
import { zeroAddress, type Address } from 'viem'
import { describe, expect, it } from 'vitest'
import type { PreparedArgs } from '@/lib/deploy/deploy-types'
import type { ChainState } from './phases-types'
import type { RevealTargets, SettingsCopyRow, SettingsState, SettingsView } from './settings-types'
import {
  ipfsUriValid,
  levelOf,
  pointerOf,
  settingsPayload,
  settingsViewOf,
  tokenUriOf,
} from './settings-view'

const CONTRACT: Address = '0x0409454C375c8a6aB05383bFB6D9FcDe9ebB8F85'
const OWNER: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const PAYOUT: Address = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
const VALIDATOR: Address = '0x721C008fdff27BF06E7E123956E2Fe03B63342e3'
const CID = (letter: string) => `bafybei${letter.repeat(52)}`
const REAL = `ipfs://${CID('e')}/`
const PLACEHOLDER = `ipfs://${CID('q')}/metadata.json`
const targets: RevealTargets = { real: REAL, placeholder: PLACEHOLDER, start: PLACEHOLDER }

describe('ipfsUriValid', () => {
  it('takes a full ipfs:// link with a CID, a folder or a single file', () => {
    for (const uri of [
      REAL,
      PLACEHOLDER,
      `ipfs://${CID('f')}`,
      `ipfs://Qm${'1'.repeat(44)}/`,
      `ipfs://${CID('a')}/${'x'.repeat(512 - 67)}`,
    ])
      expect(ipfsUriValid(uri)).toBe(true)
  })

  it('refuses a CID without the scheme, a malformed CID, a space, or more than 512 characters', () => {
    for (const uri of [
      CID('e'),
      `https://${CID('e')}/`,
      'ipfs://bafy/',
      `ipfs://${CID('e')}/a b`,
      `ipfs://${CID('a')}/${'x'.repeat(512 - 66)}`,
    ])
      expect(ipfsUriValid(uri)).toBe(false)
  })
})

describe('tokenUriOf', () => {
  it("follows the contract's rule: a folder gets the id, a single file and an empty base stay as they are", () => {
    expect(tokenUriOf(REAL)).toBe(`${REAL}1`)
    expect(tokenUriOf(PLACEHOLDER)).toBe(PLACEHOLDER)
    expect(tokenUriOf('')).toBe('')
  })
})

describe('pointerOf', () => {
  it('reads revealed for the real job first, so a collection deployed on its real job reads revealed (Review Focus 4)', () => {
    expect(pointerOf(REAL, { real: REAL, placeholder: null, start: REAL })).toBe('revealed')
    expect(pointerOf(REAL, targets)).toBe('revealed')
  })

  it('reads the placeholder for the placeholder job or the deploy-time link, and custom otherwise, exactly', () => {
    expect(pointerOf(PLACEHOLDER, targets)).toBe('placeholder')
    expect(
      pointerOf(`ipfs://${CID('s')}`, { real: null, placeholder: null, start: `ipfs://${CID('s')}` }),
    ).toBe('placeholder')
    expect(pointerOf(`ipfs://${CID('f')}/`, targets)).toBe('custom')
    expect(pointerOf(REAL.slice(0, -1), targets)).toBe('custom')
    expect(pointerOf(REAL, { real: null, placeholder: PLACEHOLDER, start: PLACEHOLDER })).toBe('custom')
  })
})

describe('levelOf', () => {
  it('reads no validator, no code, a validator that did not answer, and a level', () => {
    expect(levelOf(zeroAddress, false, null)).toEqual({ kind: 'none', reason: 'zero' })
    expect(levelOf(VALIDATOR, false, null)).toEqual({ kind: 'none', reason: 'no-code' })
    expect(levelOf(VALIDATOR, true, null)).toEqual({ kind: 'unread' })
    expect(levelOf(VALIDATOR, true, 9)).toEqual({ kind: 'level', level: 9 })
  })
})

const args: PreparedArgs = {
  name: 'Night Owls',
  symbol: 'OWL',
  payout: OWNER,
  baseUri: PLACEHOLDER,
  maxSupply: '12',
  groupSupplies: ['12'],
  groupPrices: ['0'],
  publicMaxPerWallet: '2',
  royaltyBps: 500,
  owner: OWNER,
  royaltyReceiver: OWNER,
}
const copies: SettingsCopyRow = {
  payout_address: PAYOUT.toLowerCase(),
  royalty_bps: 1500,
  royalty_receiver: OWNER.toLowerCase(),
  base_uri: PLACEHOLDER,
  transfer_validator: null,
  mint_on_behalf: true,
  args,
}
const chain: ChainState = {
  block: 120n,
  blockTimestamp: 1_791_039_600,
  maxSupply: 12,
  totalMinted: 1,
  publicMaxMintPerWallet: 2,
  mintOnBehalfActive: false,
  groups: [],
}
const state: SettingsState = {
  block: 120n,
  blockTimestamp: 1_791_039_600,
  chain,
  creatorBalanceWei: '1000000000000000',
  platformBalanceWei: '800000000000000',
  pendingBalanceWei: '0',
  payout: OWNER,
  royaltyBps: 750,
  royaltyReceiver: PAYOUT,
  baseUri: REAL,
  validator: VALIDATOR,
  owner: OWNER,
  fees: { mintFeeFlatWei: '0', mintFeeBps: 0, airdropFeePerTokenWei: '100000000000000' },
  level: { kind: 'none', reason: 'no-code' },
}
const base = { chainId: 31337, contract: CONTRACT, readAt: 1_791_000_000 }

describe('settingsViewOf', () => {
  it("answers the chain's values from a read, the copied ones included, at the read's block time", () => {
    expect(settingsViewOf(base, copies, targets, '5', state)).toEqual<SettingsView>({
      chainId: 31337,
      contract: CONTRACT,
      owner: OWNER,
      creatorBalanceWei: '1000000000000000',
      platformBalanceWei: '800000000000000',
      pendingBalanceWei: '0',
      withdrawnWei: '5',
      fees: { mintFeeFlatWei: '0', mintFeeBps: 0, airdropFeePerTokenWei: '100000000000000' },
      payout: OWNER,
      royaltyBps: 750,
      royaltyReceiver: PAYOUT,
      baseUri: REAL,
      transferValidator: VALIDATOR,
      mintOnBehalf: false,
      level: { kind: 'none', reason: 'no-code' },
      targets,
      pointer: 'revealed',
      realArtRendered: true,
      blockTimestamp: 1_791_039_600,
      readAt: 1_791_039_600,
      chainReachable: true,
    })
  })

  it('answers the copies when the chain does not answer: no balance, fee, owner or level, the copy time', () => {
    const view = settingsViewOf(base, copies, { ...targets, real: null }, '5', null)
    expect(view).toEqual<SettingsView>({
      chainId: 31337,
      contract: CONTRACT,
      owner: null,
      creatorBalanceWei: null,
      platformBalanceWei: null,
      pendingBalanceWei: null,
      withdrawnWei: '5',
      fees: null,
      payout: PAYOUT,
      royaltyBps: 1500,
      royaltyReceiver: OWNER,
      baseUri: PLACEHOLDER,
      transferValidator: null,
      mintOnBehalf: true,
      level: null,
      targets: { ...targets, real: null },
      pointer: 'placeholder',
      realArtRendered: false,
      blockTimestamp: 1_791_000_000,
      readAt: 1_791_000_000,
      chainReachable: false,
    })
    expect(
      settingsViewOf(base, { ...copies, transfer_validator: zeroAddress }, targets, '0', null),
    ).toMatchObject({
      transferValidator: zeroAddress,
    })
  })
})

describe('settingsPayload', () => {
  it('copies the six settings from a read, addresses lowercase', () => {
    expect(settingsPayload(state)).toEqual({
      payout_address: OWNER.toLowerCase(),
      royalty_bps: 750,
      royalty_receiver: PAYOUT.toLowerCase(),
      base_uri: REAL,
      transfer_validator: VALIDATOR.toLowerCase(),
      mint_on_behalf: false,
    })
  })
})
```

In `apps/web/src/lib/art/db-error.test.ts`, replace:

```ts
import { artWriteError, lockWriteError, phasesWriteError, whitelistWriteError } from './db-error'
```

with:

```ts
import {
  artWriteError,
  lockWriteError,
  manageRecordError,
  phasesWriteError,
  whitelistWriteError,
} from './db-error'
```

In `apps/web/src/lib/art/db-error.test.ts`, replace:

```ts
  WRONG_GROUP,
} from './result'
```

with:

```ts
  WRONG_GROUP,
  NOT_THIS_CHANGE,
} from './result'
```

At the end of `apps/web/src/lib/art/db-error.test.ts`, append:

```ts

describe('manageRecordError', () => {
  it('reads a refused owner check or a refused execute as not found', () => {
    expect(manageRecordError({ code: '42501', message: 'collection not found' })).toBe(NOT_FOUND)
    expect(
      manageRecordError({ code: '42501', message: 'permission denied for function airdrop_record' }),
    ).toBe(NOT_FOUND)
  })

  it("passes the record functions' sentences through", () => {
    for (const sentence of [NOT_DEPLOYED, NOT_THIS_CHANGE])
      expect(manageRecordError({ code: '23514', message: sentence })).toBe(sentence)
  })

  it('says "reload" for anything else', () => {
    expect(
      manageRecordError({
        code: '23514',
        message: 'new row for relation "airdrops" violates check constraint "airdrops_token_range"',
      }),
    ).toBe(UNSAVED)
    expect(manageRecordError({ code: '23502', message: 'Every setting is required.' })).toBe(UNSAVED)
    expect(manageRecordError(null)).toBe(UNSAVED)
  })
})
```

In `apps/web/src/lib/manage/holders.test.ts`, replace:

```ts
import { describe, expect, it } from 'vitest'
import { holdersOf, snapshotIds, type Holder } from './holders'
```

with:

```ts
import { describe, expect, it } from 'vitest'
import { BURN_ADDRESS } from './airdrop-view'
import { holdersOf, snapshotIds, type Holder } from './holders'
```

In `apps/web/src/lib/manage/holders.test.ts`, replace:

```ts
const B: Address = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
const C: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const DEAD: Address = '0x000000000000000000000000000000000000dEaD'

describe('holdersOf', () => {
```

with:

```ts
const B: Address = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
const C: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'

describe('holdersOf', () => {
```

In `apps/web/src/lib/manage/holders.test.ts`, replace:

```ts
    expect(holdersOf([null, zeroAddress, DEAD, DEAD.toLowerCase(), A, null])).toEqual<Holder[]>([
      { address: getAddress(A), balance: 1 },
    ])
```

with:

```ts
    const owners = [null, zeroAddress, BURN_ADDRESS, BURN_ADDRESS.toLowerCase(), A, null]
    expect(holdersOf(owners)).toEqual<Holder[]>([{ address: getAddress(A), balance: 1 }])
```

In `apps/web/src/components/manage/recipients.test.ts`, replace:

```ts
  })

  it('refuses the zero address with its line number, for a whitelist and an airdrop alike', () => {
```

with:

```ts
  })

  it('leaves out the repeat that takes an address past 1,000 tokens, with its line, keeping the earlier sum (Review Focus 1)', () => {
    const result = parseRecipients(`${A},2\n${B},1\n${A},999\n${A},998`, AIRDROP)
    expect(result.rows.map((row) => [row.address, row.amount])).toEqual([
      [getAddress(A), 1000],
      [getAddress(B), 1],
    ])
    expect(result.invalid).toEqual<InvalidRow[]>([
      {
        line: 3,
        text: `${A},999`,
        reason: 'With its earlier lines, the quantity for this address passes 1,000.',
      },
    ])
    expect(result.duplicates).toBe(1)
    expect(parseRecipients(`${A},10000\n${A},10000`, WHITELIST).invalid).toEqual([])
  })

  it('refuses the zero address with its line number, for a whitelist and an airdrop alike', () => {
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @cobweb/web exec vitest run src/lib/manage/airdrop-view.test.ts src/lib/manage/settings-view.test.ts src/lib/art/db-error.test.ts src/lib/manage/holders.test.ts src/components/manage/recipients.test.ts`
Expected: FAIL. `airdrop-view.test.ts`, `settings-view.test.ts` and `holders.test.ts` fail to load (`Cannot find module './airdrop-view'` or `'./settings-view'`); in `db-error.test.ts` the three `manageRecordError` tests fail with `TypeError: manageRecordError is not a function`; in `recipients.test.ts` the Review Focus 1 test fails (the repeats are summed past 1,000 and no line is left out). The run ends `Test Files  5 failed (5)` and `Tests  4 failed | 26 passed (30)`.

- [ ] **Step 3: The sentences and the error map**

At the end of `apps/web/src/lib/art/result.ts`, append:

```ts

// Airdrop and Settings (docs/specs/2026-10-15-airdrop-settings.md, section 6.6). Said by the server or the screen
// (the database raises none of these).
export const AIRDROP_NOT_CONFIRMED = 'The tokens have not been confirmed on chain yet.'
export const AIRDROP_TIMED_OUT =
  'The tokens are not confirmed yet. Check again in a minute, and do not send the batch again: it would mint its tokens twice.'
export const SETTINGS_NOT_CONFIRMED = 'The setting has not been confirmed on chain yet.'
export const SETTINGS_TIMED_OUT =
  'The setting is not confirmed yet. Read the contract again in a minute to see it.'
export const NOT_OWNER = (owner: string) =>
  `This wallet is not the contract's owner. Changes on chain need ${owner}.`
export const IPFS_LINK_INVALID = 'Enter a full ipfs:// link with its CID.'
```

In `apps/web/src/lib/art/db-error.ts`, replace:

```ts
  NOT_RENDERED,
  NOT_THIS_JOB,
```

with:

```ts
  NOT_RENDERED,
  NOT_THIS_CHANGE,
  NOT_THIS_JOB,
```

At the end of `apps/web/src/lib/art/db-error.ts`, append:

```ts

/** Sentences the Airdrop and Settings functions raise (supabase/migrations/20261016000000_airdrop_settings.sql). */
const RECORD_SENTENCES = new Set([NOT_DEPLOYED, NOT_THIS_CHANGE])

/**
 * A failed Airdrop or Settings write, by SQLSTATE, in the creator's words
 * (docs/specs/2026-10-15-airdrop-settings.md, section 6.6): a refused owner check reads as not found, the
 * functions' own sentences pass through, and anything else says "reload".
 */
export function manageRecordError(error: DbError): string {
  if (!error) return UNSAVED
  if (error.code === '42501') return NOT_FOUND
  if (error.code === '23514' && RECORD_SENTENCES.has(error.message)) return error.message
  return UNSAVED
}
```

- [ ] **Step 4: The types and the views**

Create `apps/web/src/lib/manage/airdrop-types.ts`:

```ts
import type { Address, Hex } from 'viem'

/**
 * The shapes Airdrop moves between the chain, the database, the server and the screen
 * (docs/specs/2026-10-15-airdrop-settings.md, section 6.1). Types only, so the browser imports them without the
 * server module (airdrop-core.ts).
 */

/** Tokens sent to wallets, or a burn: tokens minted to the dead address. */
export type AirdropKind = 'airdrop' | 'burn'

/** One transaction Cobweb proved and recorded, as History shows it. */
export type AirdropRow = {
  txHash: Hex
  kind: AirdropKind
  recipients: number
  tokens: number
  /** The fee the transaction paid, wei as a decimal string. */
  feePaidWei: string
  firstTokenId: number
  lastTokenId: number
  block: number
  /** When Cobweb recorded it (Unix seconds): later than its block when "Check again" came late. */
  confirmedAt: number
}

/** What the Airdrop tab shows: the contract's fee, supply and owner from one read, and Cobweb's records. */
export type AirdropView = {
  chainId: number
  contract: Address
  /** The contract's `owner()`; null while the chain does not answer. */
  owner: Address | null
  /** The contract's airdrop fee per token, wei as a decimal string; null while the chain does not answer. */
  feePerTokenWei: string | null
  maxSupply: number
  /** Null while the chain does not answer. */
  totalMinted: number | null
  /** `maxSupply - totalMinted`, never below 0; null while the chain does not answer. */
  left: number | null
  /** Newest first. */
  history: AirdropRow[]
  /** The chain's time at the read, for relative labels only. */
  blockTimestamp: number
  readAt: number
  /** False: the history is Cobweb's record, and the fee, minted and left are not read. */
  chainReachable: boolean
}

/** One recipient of a batch: a checksummed address and its tokens (1 to 1,000). */
export type BatchEntry = { address: Address; amount: number }

/**
 * A list frozen at the first send, kept in the browser: its batches in the list's order, how many landed, and
 * the hash of the batch sent but not confirmed yet. A burn is one batch of one entry to the dead address, kept
 * only while its hash is pending.
 */
export type AirdropJob = { kind: AirdropKind; batches: BatchEntry[][]; sent: number; pending: Hex | null }

/** One server read of the contract for the Airdrop tab, at one block. */
export type AirdropState = {
  block: bigint
  blockTimestamp: number
  maxSupply: number
  totalMinted: number
  feePerTokenWei: string
  owner: Address
}

/** At the latest block, or at `atLeast` when the node is behind it; null when the chain, its RPC or the contract does not answer. */
export type AirdropReader = (
  chainId: number,
  address: Address,
  atLeast?: bigint,
) => Promise<AirdropState | null>
```

Create `apps/web/src/lib/manage/airdrop-view.ts`:

```ts
import type { Address, Hex } from 'viem'
import type { AirdropRow, AirdropState, AirdropView, BatchEntry } from './airdrop-types'

/**
 * The Airdrop view, pure (docs/specs/2026-10-15-airdrop-settings.md, section 6.1), for the browser and the
 * server: the batches a list is sent in, History's rows, and the view from a read or from Cobweb's record alone.
 */

/** Wallets in one `airdropNFTs` transaction (provisional until the gas measurement, section 12). */
export const AIRDROP_MAX_RECIPIENTS = 500
/** Tokens in one `airdropNFTs` transaction, a burn included. */
export const AIRDROP_MAX_TOKENS = 1_000
/** Tokens one address gets from one list, its repeated lines summed. */
export const AIRDROP_MAX_PER_ADDRESS = 1_000
/** Where a burn mints its tokens: the dead address, which nobody can use (MASTER_PLAN, Contracts: burn). */
export const BURN_ADDRESS: Address = '0x000000000000000000000000000000000000dEaD'

/** An `airdrops` row as the server reads it: the fee as text, so no wei is lost. */
export type AirdropDbRow = {
  tx_hash: string
  kind: string
  recipients: number
  tokens: number
  fee_paid_wei: string
  first_token_id: number
  last_token_id: number
  block: number
  confirmed_at: string
}

/** The tokens of some entries. */
export function tokensOf(entries: readonly BatchEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.amount, 0)
}

/**
 * The entries in batches, in the list's order: a new batch starts when the next entry would take the current
 * one past 500 wallets or 1,000 tokens. An entry carries 1 to 1,000 tokens, so each fits a batch.
 */
export function batchesOf(entries: readonly BatchEntry[]): BatchEntry[][] {
  const batches: BatchEntry[][] = []
  let current: BatchEntry[] = []
  let tokens = 0
  for (const entry of entries) {
    if (
      current.length > 0 &&
      (current.length === AIRDROP_MAX_RECIPIENTS || tokens + entry.amount > AIRDROP_MAX_TOKENS)
    ) {
      batches.push(current)
      current = []
      tokens = 0
    }
    current.push({ address: entry.address, amount: entry.amount })
    tokens += entry.amount
  }
  if (current.length > 0) batches.push(current)
  return batches
}

/** The rows as History shows them, in the order read (newest first), `confirmed_at` in Unix seconds. */
export function airdropRowsOf(rows: AirdropDbRow[]): AirdropRow[] {
  return rows.map((row) => ({
    txHash: row.tx_hash as Hex,
    kind: row.kind === 'burn' ? 'burn' : 'airdrop',
    recipients: row.recipients,
    tokens: row.tokens,
    feePaidWei: row.fee_paid_wei,
    firstTokenId: row.first_token_id,
    lastTokenId: row.last_token_id,
    block: row.block,
    confirmedAt: Math.floor(Date.parse(row.confirmed_at) / 1000),
  }))
}

/**
 * The view from a read: the fee, the owner, minted and left at the read's block, its time as `readAt`. Without
 * one (the chain did not answer), Cobweb's record alone: the history, the collection's supply and the copy's time.
 */
export function airdropViewOf(
  base: { chainId: number; contract: Address; maxSupply: number; readAt: number },
  history: AirdropRow[],
  state: AirdropState | null,
): AirdropView {
  if (!state)
    return {
      chainId: base.chainId,
      contract: base.contract,
      owner: null,
      feePerTokenWei: null,
      maxSupply: base.maxSupply,
      totalMinted: null,
      left: null,
      history,
      blockTimestamp: base.readAt,
      readAt: base.readAt,
      chainReachable: false,
    }
  return {
    chainId: base.chainId,
    contract: base.contract,
    owner: state.owner,
    feePerTokenWei: state.feePerTokenWei,
    maxSupply: state.maxSupply,
    totalMinted: state.totalMinted,
    left: Math.max(0, state.maxSupply - state.totalMinted),
    history,
    blockTimestamp: state.blockTimestamp,
    readAt: state.blockTimestamp,
    chainReachable: true,
  }
}
```

Create `apps/web/src/lib/manage/settings-types.ts`:

```ts
import type { Address } from 'viem'
import type { PreparedArgs } from '@/lib/deploy/deploy-types'
import type { FeeSnapshot } from '@/lib/demo/types'
import type { ChainState } from './phases-types'

/**
 * The shapes Settings moves between the chain, the database, the server and the screens
 * (docs/specs/2026-10-15-airdrop-settings.md, section 6.1). Types only, so the browser imports them without the
 * server module (settings-core.ts).
 */

/**
 * The collection's transfer level on its validator: none (no validator, or no code at its address), not read
 * (the validator did not answer), or the level the validator holds.
 */
export type TransferLevelState =
  { kind: 'none'; reason: 'zero' | 'no-code' } | { kind: 'unread' } | { kind: 'level'; level: number }

/** What the base URI points at: the rendered metadata, the placeholder, or a link set some other way. */
export type RevealPointer = 'revealed' | 'placeholder' | 'custom'

/** The base URIs Reveal offers: the latest done real job's, the latest done placeholder job's, and the deploy-time one. */
export type RevealTargets = { real: string | null; placeholder: string | null; start: string }

/** What Settings and the Overview show: the contract's settings and balances from one read, or Cobweb's copies. */
export type SettingsView = {
  chainId: number
  contract: Address
  /** The contract's `owner()`; null while the chain does not answer. */
  owner: Address | null
  /** `creatorBalance()`, wei as a decimal string; null while the chain does not answer. */
  creatorBalanceWei: string | null
  /** `platformBalance()`; null while the chain does not answer. */
  platformBalanceWei: string | null
  /** `pendingBalance(wallet)` for the session wallet; null while the chain does not answer. */
  pendingBalanceWei: string | null
  /** The sum of the withdrawals Cobweb confirmed. */
  withdrawnWei: string
  /** `fees()`; null while the chain does not answer. */
  fees: FeeSnapshot | null
  payout: Address
  royaltyBps: number
  royaltyReceiver: Address
  baseUri: string
  /** `getTransferValidator()`, or its copy; null until the first read. The zero address is no validator. */
  transferValidator: Address | null
  mintOnBehalf: boolean
  /** Null while the chain does not answer. */
  level: TransferLevelState | null
  targets: RevealTargets
  pointer: RevealPointer
  /** Whether a real job is done, so Reveal has something to point at. */
  realArtRendered: boolean
  /** The chain's time at the read, for relative labels only. */
  blockTimestamp: number
  readAt: number
  /** False: the settings are Cobweb's copies, and the balances, fees and level are not read. */
  chainReachable: boolean
}

/** One server read of the contract for Settings, at one block. */
export type SettingsState = {
  block: bigint
  blockTimestamp: number
  /** `collectionState()`, which also refreshes the phase copies. */
  chain: ChainState
  creatorBalanceWei: string
  platformBalanceWei: string
  pendingBalanceWei: string
  payout: Address
  royaltyBps: number
  royaltyReceiver: Address
  baseUri: string
  validator: Address
  owner: Address
  fees: FeeSnapshot
  level: TransferLevelState
}

/** At the latest block, or at `atLeast` when the node is behind it; null when the chain, its RPC or the contract does not answer. */
export type SettingsReader = (
  chainId: number,
  address: Address,
  wallet: Address,
  atLeast?: bigint,
) => Promise<SettingsState | null>

/** The deployments copies Settings shows while the chain does not answer, and the deploy-time arguments. */
export type SettingsCopyRow = {
  payout_address: string
  royalty_bps: number
  royalty_receiver: string
  base_uri: string
  transfer_validator: string | null
  mint_on_behalf: boolean
  args: PreparedArgs
}
```

Create `apps/web/src/lib/manage/settings-view.ts`:

```ts
import { getAddress, zeroAddress, type Address } from 'viem'
import type {
  RevealPointer,
  RevealTargets,
  SettingsCopyRow,
  SettingsState,
  SettingsView,
  TransferLevelState,
} from './settings-types'

/**
 * The Settings view, pure (docs/specs/2026-10-15-airdrop-settings.md, section 6.1), for the browser and the
 * server: the transfer levels Cobweb offers, the IPFS links Reveal takes, token 1's URI by the contract's rule,
 * what the base URI points at, the level from the validator, and the view from a read or the copies.
 */

/** The validator's levels Cobweb sends: royalties enforced, royalties not enforced, and locked. */
export const TRANSFER_LEVELS = { enforced: 0, open: 1, locked: 9 } as const
export type TransferLevelValue = (typeof TRANSFER_LEVELS)[keyof typeof TRANSFER_LEVELS]

/** The longest base URI Cobweb sends. */
export const BASE_URI_MAX = 512

const IPFS_URI = /^ipfs:\/\/(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{58,})(\/\S*)?$/

/** A full `ipfs://` link with a CID, a path after it allowed: a folder ending in "/" or a single file. */
export function ipfsUriValid(value: string): boolean {
  return value.length <= BASE_URI_MAX && IPFS_URI.test(value)
}

/** Token 1's URI by the contract's rule: an empty base stays empty, a base without "/" is every token's URI. */
export function tokenUriOf(base: string): string {
  if (!base || !base.endsWith('/')) return base
  return `${base}1`
}

/**
 * What the base URI points at, compared exactly: the real job's (checked first, so a collection deployed on its
 * real job reads revealed), the placeholder job's or the deploy-time one, else a custom link.
 */
export function pointerOf(baseUri: string, targets: RevealTargets): RevealPointer {
  if (targets.real !== null && baseUri === targets.real) return 'revealed'
  if (baseUri === targets.placeholder || baseUri === targets.start) return 'placeholder'
  return 'custom'
}

/** The level a read gives: none for the zero address or a validator without code, unread when it did not answer. */
export function levelOf(
  validator: Address,
  hasCode: boolean,
  policyLevel: number | null,
): TransferLevelState {
  if (validator.toLowerCase() === zeroAddress) return { kind: 'none', reason: 'zero' }
  if (!hasCode) return { kind: 'none', reason: 'no-code' }
  return policyLevel === null ? { kind: 'unread' } : { kind: 'level', level: policyLevel }
}

/**
 * The view from a read: the chain's values, the copied ones included, at the read's block time. Without one (the
 * chain did not answer), the copies, with the balances, fees, owner and level unknown and the copy's time.
 */
export function settingsViewOf(
  base: { chainId: number; contract: Address; readAt: number },
  copies: SettingsCopyRow,
  targets: RevealTargets,
  withdrawnWei: string,
  state: SettingsState | null,
): SettingsView {
  const shared = { chainId: base.chainId, contract: base.contract, withdrawnWei, targets }
  if (!state)
    return {
      ...shared,
      owner: null,
      creatorBalanceWei: null,
      platformBalanceWei: null,
      pendingBalanceWei: null,
      fees: null,
      payout: getAddress(copies.payout_address),
      royaltyBps: copies.royalty_bps,
      royaltyReceiver: getAddress(copies.royalty_receiver),
      baseUri: copies.base_uri,
      transferValidator: copies.transfer_validator === null ? null : getAddress(copies.transfer_validator),
      mintOnBehalf: copies.mint_on_behalf,
      level: null,
      pointer: pointerOf(copies.base_uri, targets),
      realArtRendered: targets.real !== null,
      blockTimestamp: base.readAt,
      readAt: base.readAt,
      chainReachable: false,
    }
  return {
    ...shared,
    owner: state.owner,
    creatorBalanceWei: state.creatorBalanceWei,
    platformBalanceWei: state.platformBalanceWei,
    pendingBalanceWei: state.pendingBalanceWei,
    fees: state.fees,
    payout: state.payout,
    royaltyBps: state.royaltyBps,
    royaltyReceiver: state.royaltyReceiver,
    baseUri: state.baseUri,
    transferValidator: state.validator,
    mintOnBehalf: state.chain.mintOnBehalfActive,
    level: state.level,
    pointer: pointerOf(state.baseUri, targets),
    realArtRendered: targets.real !== null,
    blockTimestamp: state.blockTimestamp,
    readAt: state.blockTimestamp,
    chainReachable: true,
  }
}

/** What `settings_refresh` copies from a read, addresses lowercase. */
export function settingsPayload(state: SettingsState): {
  payout_address: string
  royalty_bps: number
  royalty_receiver: string
  base_uri: string
  transfer_validator: string
  mint_on_behalf: boolean
} {
  return {
    payout_address: state.payout.toLowerCase(),
    royalty_bps: state.royaltyBps,
    royalty_receiver: state.royaltyReceiver.toLowerCase(),
    base_uri: state.baseUri,
    transfer_validator: state.validator.toLowerCase(),
    mint_on_behalf: state.chain.mintOnBehalfActive,
  }
}
```

In `apps/web/src/lib/manage/holders.ts`, replace:

```ts
import { getAddress, zeroAddress, type Address } from 'viem'

/**
```

with:

```ts
import { getAddress, zeroAddress, type Address } from 'viem'
import { BURN_ADDRESS } from './airdrop-view'

/**
```

In `apps/web/src/lib/manage/holders.ts`, replace:

```ts
const DEAD = '0x000000000000000000000000000000000000dead'
```

with:

```ts
const BURN = BURN_ADDRESS.toLowerCase()
```

In `apps/web/src/lib/manage/holders.ts`, replace:

```ts
    if (key === zeroAddress || key === DEAD) continue
```

with:

```ts
    if (key === zeroAddress || key === BURN) continue
```

- [ ] **Step 5: A summed repeat past the most an address may get**

In `apps/web/src/components/manage/recipients.ts`, replace:

```ts
    if (existing) {
      duplicates++
```

with:

```ts
    if (existing) {
      // A summed repeat is checked against the most an address may get: the line that passes it is left out, and
      // the earlier sum stays (docs/specs/2026-10-15-airdrop-settings.md, section 7.3).
      if (options.onDuplicate === 'sum' && existing.amount + amount > options.maxAmount) {
        invalid.push({
          line,
          text: trimmed,
          reason: `With its earlier lines, the ${options.amountName} for this address passes ${options.maxAmount.toLocaleString('en-US')}.`,
        })
        return
      }
      duplicates++
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `pnpm --filter @cobweb/web exec vitest run src/lib/manage/airdrop-view.test.ts src/lib/manage/settings-view.test.ts src/lib/art/db-error.test.ts src/lib/manage/holders.test.ts src/components/manage/recipients.test.ts`
Expected: PASS, 5 files and 49 tests.

- [ ] **Step 7: Format, run the root checks and commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
pnpm exec prettier --write apps/web/src/lib/art/result.ts apps/web/src/lib/art/db-error.ts apps/web/src/lib/art/db-error.test.ts apps/web/src/lib/manage/airdrop-types.ts apps/web/src/lib/manage/airdrop-view.ts apps/web/src/lib/manage/airdrop-view.test.ts apps/web/src/lib/manage/settings-types.ts apps/web/src/lib/manage/settings-view.ts apps/web/src/lib/manage/settings-view.test.ts apps/web/src/lib/manage/holders.ts apps/web/src/lib/manage/holders.test.ts apps/web/src/components/manage/recipients.ts apps/web/src/components/manage/recipients.test.ts
pnpm typecheck && pnpm lint && pnpm test
git add apps/web/src/lib/art/result.ts apps/web/src/lib/art/db-error.ts apps/web/src/lib/art/db-error.test.ts apps/web/src/lib/manage/airdrop-types.ts apps/web/src/lib/manage/airdrop-view.ts apps/web/src/lib/manage/airdrop-view.test.ts apps/web/src/lib/manage/settings-types.ts apps/web/src/lib/manage/settings-view.ts apps/web/src/lib/manage/settings-view.test.ts apps/web/src/lib/manage/holders.ts apps/web/src/lib/manage/holders.test.ts apps/web/src/components/manage/recipients.ts apps/web/src/components/manage/recipients.test.ts
git commit -m "$(cat <<'EOF'
Add the Airdrop and Settings sentences and error map, their types and pure views with the batches, History's rows, the reveal pointer, token 1's URI and the transfer level, the dead address shared with the snapshot, and a summed repeat past 1,000 left out with its line

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: the web package reports 608 tests in 70 files (588 before, plus 20); the shared package is unchanged at 80.

---

### Task 4: Payable and validator calls, their shapes and event matches, the batch proof and the new revert sentences

**Files:**

- Modify: `apps/web/src/lib/manage/phase-calls.ts` (whole file), `apps/web/src/lib/manage/phase-calls.test.ts`
- Modify: `apps/web/src/lib/manage/phase-schemas.ts`, `apps/web/src/lib/manage/phase-schemas.test.ts`
- Modify: `apps/web/src/lib/chain/phase-events.ts` (whole file), `apps/web/src/lib/chain/phase-events.test.ts`
- Create: `apps/web/src/lib/chain/airdrop-batch.ts`, `apps/web/src/lib/chain/airdrop-batch.test.ts`
- Modify: `apps/web/src/components/deploy/tx-errors.ts`, `apps/web/src/components/deploy/tx-errors.test.ts`
- Modify: `apps/web/src/components/manage/manage-actions.ts`, `apps/web/src/components/manage/manage-actions.test.ts`
- Modify: `apps/web/src/lib/chain/quota-chunk.test.ts` (encodes with `abiOf`), `apps/web/src/components/manage/manage-sim.test.ts` (the length mismatch sentence)
- Modify: `apps/web/scripts/verify-phases.ts`, `apps/web/scripts/verify-whitelist.ts` (the wide ABI where they simulate a `ManageCall`)
- Test: the eight test files above

**Interfaces:**

- Consumes: `validatorAbi` from `@cobweb/shared` (Task 1); `collectionAbi` from `@cobweb/shared/collection-abi`; from Task 3, `BatchEntry`, `AirdropKind` (`@/lib/manage/airdrop-types`), `BURN_ADDRESS`, `tokensOf`, `AIRDROP_MAX_RECIPIENTS`, `AIRDROP_MAX_TOKENS`, `AIRDROP_MAX_PER_ADDRESS` (`@/lib/manage/airdrop-view`), `TRANSFER_LEVELS`, `TransferLevelValue`, `ipfsUriValid` (`@/lib/manage/settings-view`); in `@/lib/art/result`, `NOT_FROM_WALLET`, `NOT_THIS_CHANGE`, `NOT_THIS_CONTRACT`, `WRONG_GROUP`, `ZERO_ADDRESS`, `UNSAVED`; `formatNative(wei, symbol, maxDecimals?)`, `formatBps(bps)`, `formatUtc(seconds)` in `@/lib/demo/helpers`; `ReceiptLike` in `./art-paid`; the existing `phaseCalls`, `expectedEvent`, `sentOf`, `callOf`, `reviewOf`, `sentCallShape`, `parseSentCall`, `matchPhaseEvent`, `revertSentence`, `classifyError` and `realManageActions`, which keep their names and their earlier behaviour.
- Produces:
  - in `@/lib/manage/phase-calls`: `ManageFunction` gains `airdropNFTs`, `withdrawMintFunds`, `setOwnerPayoutAddress`, `setDefaultRoyalty`, `setBaseURI`, `setMintOnBehalfStatus`, `setTransferValidator`; `ValidatorFunction = 'setTransferSecurityLevelOfCollection'`; `CallTarget = { contract: 'validator'; address: Address }`; `ManageCall` is a collection call (`{ functionName; args; value?: bigint; target?: undefined }`) or the validator's (`{ functionName: ValidatorFunction; args; value?: undefined; target: CallTarget }`); `SentCall = { functionName: ManageFunction | ValidatorFunction; args: (string | boolean | string[])[]; value?: string; target?: { contract: 'validator'; address: string } }`; `ExpectedEvent` gains `NFTsAirdropped { recipients; amount }`, `MintFundsWithdrawn {}`, `OwnerPayoutAddressUpdated { newOwnerPayoutAddress }`, `DefaultRoyaltyUpdated { receiver; feeNumerator }`, `MintOnBehalfUpdated { newStatus }`, `TransferValidatorUpdated { newValidator }`, `BatchMetadataUpdate { fromTokenId: 1n; toTokenId: 2n ** 256n - 1n }`, `SetTransferSecurityLevel { collection; level }`; `PHASE_FUNCTIONS` and `SETTINGS_FUNCTIONS` (`ReadonlySet<string>`); `airdropCalls.batch(entries: BatchEntry[], feePerTokenWei: string)` and `airdropCalls.burn(amount: number, feePerTokenWei: string)` (the value is the fee times the tokens); `settingsCalls.withdraw()`, `payout(address)`, `royalty(receiver, bps)`, `baseUri(uri)`, `mintOnBehalf(on)`, `validator(address)`, `level(validator, collection, level: TransferLevelValue)`; `abiOf(call): typeof collectionAbi | typeof validatorAbi`; `reviewOf` adds a "Value" row (`<native> (<wei> wei)`) for a call with a value, `amounts` as "<n> amounts, <t> tokens in total", `feeNumerator` as "750 (7.5%)", a level with its title and the zero validator with "(removes the check)"
  - in `@/lib/manage/phase-schemas`: `sentCallShape` takes `airdropNFTs` (1 to 500 checksummed recipients, as many amounts of 1 to 1,000, at most 1,000 tokens, and `value`), the six Settings functions (a payout and a royalty receiver not the zero address, a royalty of 0 to 1,000 bps, a full `ipfs://` URI of at most 512 characters) and the level call (level '0', '1' or '9', the flags false, a validator `target` not the zero address); `parseSentCall(input: unknown, functions?: ReadonlySet<string>)`
  - in `@/lib/chain/phase-events`: `PhaseEventMatch = { ok: true; args: Record<string, unknown> } | { ok: false; error: string }`; `matchPhaseEvent(receipt, expected: { contract; from; event; abi?: Abi })`
  - in `@/lib/chain/airdrop-batch`: `AirdropProof = { ok: true; batch: { kind: AirdropKind; recipients; tokens; feePaidWei: string; firstTokenId; lastTokenId } } | { ok: false; error: string }`, `proveAirdrop(receipt: PhaseReceipt, input: Hex, expected: { contract: Address; from: string }): AirdropProof`
  - in `@/components/deploy/tx-errors`: `revertSentence(errorName, args, symbol?: string)` with `ExceedsMaxSupply`, `InsufficientEther`, `TransferToNonERC721ReceiverImplementer`, `NothingToWithdraw`, `WithdrawFailed`, `CreatorTokenBase__InvalidTransferValidatorContract`, `ERC2981InvalidDefaultRoyalty`, `ERC2981InvalidDefaultRoyaltyReceiver`, `MintToZeroAddress`, and `ArrayLengthMismatch` now naming "addresses and amounts"; `classifyError(error, at, subject?, symbol?: string)`
  - `realManageActions(config, target).simulate(call)` simulates at `call.target?.address ?? target.contract` with `abiOf(call)` and `value: call.value`

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/lib/manage/phase-calls.test.ts`, replace:

```ts
import { collectionAbi } from '@cobweb/shared/collection-abi'
```

with:

```ts
import { validatorAbi } from '@cobweb/shared'
import { collectionAbi } from '@cobweb/shared/collection-abi'
```

In `apps/web/src/lib/manage/phase-calls.test.ts`, replace:

```ts
  toHex,
  type Address,
```

with:

```ts
  toHex,
  zeroAddress,
  type Abi,
  type Address,
```

In `apps/web/src/lib/manage/phase-calls.test.ts`, replace:

```ts
import { callOf, expectedEvent, phaseCalls, reviewOf, sentOf, type ManageCall } from './phase-calls'
```

with:

```ts
import { BURN_ADDRESS } from './airdrop-view'
import {
  abiOf,
  airdropCalls,
  callOf,
  expectedEvent,
  PHASE_FUNCTIONS,
  phaseCalls,
  reviewOf,
  sentOf,
  SETTINGS_FUNCTIONS,
  settingsCalls,
  type ManageCall,
} from './phase-calls'
```

In `apps/web/src/lib/manage/phase-calls.test.ts`, replace:

```ts
const UINT = { type: 'uint256' } as const
const BOOL = { type: 'bool' } as const

/** The calldata a hand-written signature gives for the same values. */
```

with:

```ts
const UINT = { type: 'uint256' } as const
const BOOL = { type: 'bool' } as const
const ADDRESS = { type: 'address' } as const

/** The calldata a hand-written signature gives for the same values. */
```

In `apps/web/src/lib/manage/phase-calls.test.ts`, replace:

```ts
  encodeFunctionData({ abi: collectionAbi, functionName: call.functionName, args: call.args })
```

with:

```ts
  encodeFunctionData({ abi: abiOf(call) as Abi, functionName: call.functionName, args: call.args })
```

At the end of `apps/web/src/lib/manage/phase-calls.test.ts`, append:

```ts

describe('the airdrop calls (docs/specs/2026-10-15-airdrop-settings.md, section 7.1)', () => {
  const A: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
  const B: Address = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
  const C: Address = '0x90F79bf6EB2c4f870365E785982E1f101E93b906'
  const FEE = '100000000000000'
  const BATCH: ManageCall = airdropCalls.batch(
    [
      { address: A, amount: 2 },
      { address: B, amount: 1 },
      { address: C, amount: 1 },
    ],
    FEE,
  )

  it("encodes airdropNFTs as the hand-written signature does, its value the fee times this batch's tokens", () => {
    expect(encoded(BATCH)).toBe(
      handEncoded(
        'airdropNFTs(address[],uint256[])',
        [{ type: 'address[]' }, { type: 'uint256[]' }],
        [
          [A, B, C],
          [2n, 1n, 1n],
        ],
      ),
    )
    expect(BATCH.value).toBe(400_000_000_000_000n)
    expect(abiOf(BATCH)).toBe(collectionAbi)
  })

  it('burns as one batch to the dead address, its value the fee for its tokens', () => {
    expect(airdropCalls.burn(2, FEE)).toEqual({
      functionName: 'airdropNFTs',
      args: [[BURN_ADDRESS], [2n]],
      value: 200_000_000_000_000n,
    })
  })

  it('expects NFTsAirdropped for the recipients and the tokens', () => {
    expect(expectedEvent(BATCH)).toEqual({
      eventName: 'NFTsAirdropped',
      args: { recipients: 3n, amount: 4n },
    })
  })

  it('round trips the value through a decimal string', () => {
    expect(sentOf(BATCH)).toEqual({
      functionName: 'airdropNFTs',
      args: [
        [A, B, C],
        ['2', '1', '1'],
      ],
      value: '400000000000000',
    })
    expect(callOf(sentOf(BATCH))).toEqual(BATCH)
  })

  it('reviews a batch as counts, then its value as the native amount and its wei', () => {
    expect(reviewOf(BATCH, BASE)).toEqual([
      { name: 'recipients', value: '3 addresses' },
      { name: 'amounts', value: '3 amounts, 4 tokens in total' },
      { name: 'Value', value: '0.0004 ETH (400000000000000 wei)' },
    ])
    expect(reviewOf(airdropCalls.burn(1, FEE), BASE)).toEqual([
      { name: 'recipients', value: '1 address' },
      { name: 'amounts', value: '1 amount, 1 token in total' },
      { name: 'Value', value: '0.0001 ETH (100000000000000 wei)' },
    ])
  })
})

describe('the Settings calls (docs/specs/2026-10-15-airdrop-settings.md, section 7.1)', () => {
  const A: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
  const COLLECTION: Address = '0x0409454C375c8a6aB05383bFB6D9FcDe9ebB8F85'
  const VALIDATOR: Address = '0x721C008fdff27BF06E7E123956E2Fe03B63342e3'
  const URI = `ipfs://bafybei${'e'.repeat(52)}/`
  const calls: ManageCall[] = [
    settingsCalls.withdraw(),
    settingsCalls.payout(A),
    settingsCalls.royalty(A, 750),
    settingsCalls.baseUri(URI),
    settingsCalls.mintOnBehalf(true),
    settingsCalls.validator(zeroAddress),
    settingsCalls.level(VALIDATOR, COLLECTION, 9),
  ]

  it('encodes each call as the hand-written signature does, the level call with the validator ABI', () => {
    expect(calls.map(encoded)).toEqual([
      toFunctionSelector('withdrawMintFunds()'),
      handEncoded('setOwnerPayoutAddress(address)', [ADDRESS], [A]),
      handEncoded('setDefaultRoyalty(address,uint96)', [ADDRESS, { type: 'uint96' }], [A, 750n]),
      handEncoded('setBaseURI(string)', [{ type: 'string' }], [URI]),
      handEncoded('setMintOnBehalfStatus(bool)', [BOOL], [true]),
      handEncoded('setTransferValidator(address)', [ADDRESS], [zeroAddress]),
      handEncoded(
        'setTransferSecurityLevelOfCollection(address,uint8,bool,bool,bool)',
        [ADDRESS, { type: 'uint8' }, BOOL, BOOL, BOOL],
        [COLLECTION, 9, false, false, false],
      ),
    ])
  })

  it('sends the level call to the validator with its ABI, and every other call to the collection', () => {
    const level = settingsCalls.level(VALIDATOR, COLLECTION, 0)
    expect(level.target).toEqual({ contract: 'validator', address: VALIDATOR })
    expect(abiOf(level)).toBe(validatorAbi)
    expect(calls.slice(0, 6).map((call) => [call.target, abiOf(call) === collectionAbi])).toEqual(
      Array(6).fill([undefined, true]),
    )
  })

  it('names the event each call leaves', () => {
    expect(calls.map(expectedEvent)).toEqual([
      { eventName: 'MintFundsWithdrawn', args: {} },
      { eventName: 'OwnerPayoutAddressUpdated', args: { newOwnerPayoutAddress: A } },
      { eventName: 'DefaultRoyaltyUpdated', args: { receiver: A, feeNumerator: 750n } },
      { eventName: 'BatchMetadataUpdate', args: { fromTokenId: 1n, toTokenId: 2n ** 256n - 1n } },
      { eventName: 'MintOnBehalfUpdated', args: { newStatus: true } },
      { eventName: 'TransferValidatorUpdated', args: { newValidator: zeroAddress } },
      { eventName: 'SetTransferSecurityLevel', args: { collection: COLLECTION, level: 9 } },
    ])
  })

  it('round trips each call, the level call with its target', () => {
    for (const call of calls) expect(callOf(sentOf(call))).toEqual(call)
    expect(sentOf(settingsCalls.level(VALIDATOR, COLLECTION, 9))).toEqual({
      functionName: 'setTransferSecurityLevelOfCollection',
      args: [COLLECTION, '9', false, false, false],
      target: { contract: 'validator', address: VALIDATOR },
    })
  })

  it("reviews each call with the ABI's names: a royalty in percent, a level with its title, no validator as removing the check", () => {
    expect(calls.map((call) => reviewOf(call, BASE))).toEqual([
      [],
      [{ name: 'newOwnerPayoutAddress', value: A }],
      [
        { name: 'receiver', value: A },
        { name: 'feeNumerator', value: '750 (7.5%)' },
      ],
      [{ name: 'newBaseURI', value: URI }],
      [{ name: 'status', value: 'true' }],
      [
        {
          name: 'transferValidator',
          value: '0x0000000000000000000000000000000000000000 (removes the check)',
        },
      ],
      [
        { name: 'collection', value: COLLECTION },
        { name: 'level', value: '9 (locked)' },
        { name: 'disableAuthorizationMode', value: 'false' },
        { name: 'disableWildcardOperators', value: 'false' },
        { name: 'enableAccountFreezingMode', value: 'false' },
      ],
    ])
    expect(reviewOf(settingsCalls.validator(VALIDATOR), BASE)).toEqual([
      { name: 'transferValidator', value: VALIDATOR },
    ])
    const levelRow = (level: number) =>
      reviewOf(
        {
          functionName: 'setTransferSecurityLevelOfCollection',
          args: [COLLECTION, level, false, false, false],
          target: { contract: 'validator', address: VALIDATOR },
        },
        BASE,
      )[1]
    expect([0, 1, 5].map(levelRow)).toEqual([
      { name: 'level', value: '0 (royalties enforced)' },
      { name: 'level', value: '1 (royalties not enforced)' },
      { name: 'level', value: '5' },
    ])
  })

  it('lists the functions each confirm accepts', () => {
    expect([...PHASE_FUNCTIONS]).toEqual([
      'registerMintGroup',
      'setMintGroupStatus',
      'scheduleMintGroupStart',
      'changeSalePrice',
      'setMintGroupMaxSupply',
      'setPublicMaxMintPerWallet',
      'stopOrStartAllMintGroups',
    ])
    expect([...SETTINGS_FUNCTIONS]).toEqual(calls.map((call) => call.functionName))
  })
})
```

In `apps/web/src/lib/manage/phase-schemas.test.ts`, replace:

```ts
import type { Address } from 'viem'
```

with:

```ts
import { DEFAULT_TRANSFER_VALIDATOR } from '@cobweb/shared'
import { zeroAddress, type Address } from 'viem'
```

In `apps/web/src/lib/manage/phase-schemas.test.ts`, replace:

```ts
import { callOf, phaseCalls, sentOf, type ManageCall } from './phase-calls'
```

with:

```ts
import {
  airdropCalls,
  callOf,
  PHASE_FUNCTIONS,
  phaseCalls,
  sentOf,
  SETTINGS_FUNCTIONS,
  settingsCalls,
  type ManageCall,
} from './phase-calls'
```

In `apps/web/src/lib/manage/phase-schemas.test.ts`, replace:

```ts
    ['an unknown function', { functionName: 'withdrawMintFunds', args: [] }],
```

with:

```ts
    ['an unknown function', { functionName: 'renounceOwnership', args: [] }],
```

At the end of `apps/web/src/lib/manage/phase-schemas.test.ts`, append:

```ts

describe('parseSentCall for Airdrop and Settings (docs/specs/2026-10-15-airdrop-settings.md, section 7.1)', () => {
  const A: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
  const COLLECTION: Address = '0x0409454C375c8a6aB05383bFB6D9FcDe9ebB8F85'
  const URI = `ipfs://bafybei${'e'.repeat(52)}/`
  const TARGET = { contract: 'validator', address: DEFAULT_TRANSFER_VALIDATOR }
  const level = (args: unknown[], target: unknown = TARGET) => ({
    functionName: 'setTransferSecurityLevelOfCollection',
    args,
    target,
  })
  const batch = (count: number, amount: string) => ({
    functionName: 'airdropNFTs',
    args: [Array(count).fill(A), Array(count).fill(amount)],
    value: '0',
  })

  it('accepts every call the screens build, with its value and target, and answers it unchanged', () => {
    const calls: ManageCall[] = [
      airdropCalls.batch([{ address: A, amount: 1000 }], '100'),
      airdropCalls.burn(2, '0'),
      settingsCalls.withdraw(),
      settingsCalls.payout(A),
      settingsCalls.royalty(A, 1000),
      settingsCalls.royalty(A, 0),
      settingsCalls.baseUri(URI),
      settingsCalls.mintOnBehalf(false),
      settingsCalls.validator(zeroAddress),
      settingsCalls.level(DEFAULT_TRANSFER_VALIDATOR, COLLECTION, 9),
    ]
    for (const call of calls) {
      const parsed = parseSentCall(sentOf(call))
      expect(parsed.ok).toBe(true)
      if (parsed.ok) expect(callOf(parsed.data)).toEqual(call)
    }
  })

  it('strips a value or a target sent with another function', () => {
    expect(parseSentCall({ ...sentOf(settingsCalls.payout(A)), value: '5', target: TARGET })).toEqual({
      ok: true,
      data: { functionName: 'setOwnerPayoutAddress', args: [A] },
    })
  })

  it.each<[string, unknown]>([
    ['a 501st recipient', batch(501, '1')],
    [
      'a 1,001st token',
      {
        functionName: 'airdropNFTs',
        args: [
          [A, A],
          ['1000', '1'],
        ],
        value: '0',
      },
    ],
    ['an amount of 0', batch(1, '0')],
    [
      'recipients and amounts of different lengths',
      { functionName: 'airdropNFTs', args: [[A, A], ['1']], value: '0' },
    ],
    ['a lowercase recipient', { functionName: 'airdropNFTs', args: [[A.toLowerCase()], ['1']], value: '0' }],
    ['an airdrop without its value', { functionName: 'airdropNFTs', args: [[A], ['1']] }],
    ['a withdrawal with an argument', { functionName: 'withdrawMintFunds', args: ['1'] }],
    ['the zero payout address', { functionName: 'setOwnerPayoutAddress', args: [zeroAddress] }],
    ['a royalty of 1,001', { functionName: 'setDefaultRoyalty', args: [A, '1001'] }],
    ['the zero royalty recipient', { functionName: 'setDefaultRoyalty', args: [zeroAddress, '500'] }],
    ['a link without ipfs://', { functionName: 'setBaseURI', args: [`bafybei${'e'.repeat(52)}`] }],
    ['a link past 512 characters', { functionName: 'setBaseURI', args: [`${URI}${'x'.repeat(512)}`] }],
    ['mint on behalf as text', { functionName: 'setMintOnBehalfStatus', args: ['true'] }],
    ['a level of 2', level([COLLECTION, '2', false, false, false])],
    ['a flag turned on', level([COLLECTION, '9', true, false, false])],
    [
      'a level call without its target',
      { functionName: 'setTransferSecurityLevelOfCollection', args: [COLLECTION, '9', false, false, false] },
    ],
    [
      'a level call to the zero address',
      level([COLLECTION, '9', false, false, false], { contract: 'validator', address: zeroAddress }),
    ],
  ])('refuses %s as UNSAVED', (_label, input) => {
    expect(parseSentCall(input)).toEqual({ ok: false, error: UNSAVED })
  })

  it("refuses a function outside the confirm's own: no airdrop, Settings or quota call on Phases, no Phases call on Settings", () => {
    for (const call of [
      airdropCalls.burn(1, '0'),
      settingsCalls.withdraw(),
      settingsCalls.level(DEFAULT_TRANSFER_VALIDATOR, COLLECTION, 0),
      phaseCalls.quotas(1, [A], [1]),
    ])
      expect(parseSentCall(sentOf(call), PHASE_FUNCTIONS)).toEqual({ ok: false, error: UNSAVED })
    for (const call of [phaseCalls.open(1), airdropCalls.burn(1, '0')])
      expect(parseSentCall(sentOf(call), SETTINGS_FUNCTIONS)).toEqual({ ok: false, error: UNSAVED })
    expect(parseSentCall(sentOf(phaseCalls.open(1)), PHASE_FUNCTIONS).ok).toBe(true)
    expect(parseSentCall(sentOf(settingsCalls.withdraw()), SETTINGS_FUNCTIONS).ok).toBe(true)
  })
})
```

In `apps/web/src/lib/chain/phase-events.test.ts`, replace:

```ts
import { collectionAbi } from '@cobweb/shared/collection-abi'
```

with:

```ts
import { validatorAbi } from '@cobweb/shared'
import { collectionAbi } from '@cobweb/shared/collection-abi'
```

In `apps/web/src/lib/chain/phase-events.test.ts`, replace:

```ts
  getAbiItem,
  type AbiEvent,
```

with:

```ts
  getAbiItem,
  zeroAddress,
  type AbiEvent,
```

In `apps/web/src/lib/chain/phase-events.test.ts`, replace:

```ts
import { expectedEvent, phaseCalls, type ManageCall } from '@/lib/manage/phase-calls'
```

with:

```ts
import { expectedEvent, phaseCalls, settingsCalls, type ManageCall } from '@/lib/manage/phase-calls'
```

In `apps/web/src/lib/chain/phase-events.test.ts`, replace:

```ts
function logOf(address: Address, eventName: EventName, args: Record<string, bigint | boolean>): ReceiptLog {
```

with:

```ts
function logOf(
  address: Address,
  eventName: EventName,
  args: Record<string, bigint | boolean | string>,
): ReceiptLog {
```

In `apps/web/src/lib/chain/phase-events.test.ts`, replace:

```ts
    expect(matchPhaseEvent(receipt([logOf(CONTRACT, eventName, args)]), expect_(call))).toEqual({ ok: true })
```

with:

```ts
    expect(matchPhaseEvent(receipt([logOf(CONTRACT, eventName, args)]), expect_(call))).toMatchObject({
      ok: true,
    })
```

In `apps/web/src/lib/chain/phase-events.test.ts`, replace:

```ts
      }),
    ).toEqual({ ok: true })
```

with:

```ts
      }),
    ).toMatchObject({ ok: true })
```

In `apps/web/src/lib/chain/phase-events.test.ts`, replace:

```ts
      ).toEqual({ ok: true })
  })
})
```

with:

```ts
      ).toMatchObject({ ok: true })
  })
})

describe('matchPhaseEvent for Airdrop and Settings (docs/specs/2026-10-15-airdrop-settings.md, section 6.4)', () => {
  const PAYOUT: Address = '0x90F79bf6EB2c4f870365E785982E1f101E93b906'
  const VALIDATOR: Address = '0x721C008fdff27BF06E7E123956E2Fe03B63342e3'

  /** The validator's level event: the collection indexed, the level in data. */
  function levelLog(level: number, address: Address = VALIDATOR): ReceiptLog {
    return {
      address,
      topics: encodeEventTopics({
        abi: validatorAbi,
        eventName: 'SetTransferSecurityLevel',
        args: { collection: CONTRACT },
      }) as ReceiptLog['topics'],
      data: encodeAbiParameters([{ type: 'uint8' }], [level]),
    }
  }

  it.each<[string, ManageCall, EventName, Record<string, bigint | boolean | string>]>([
    [
      'a payout',
      settingsCalls.payout(PAYOUT),
      'OwnerPayoutAddressUpdated',
      { newOwnerPayoutAddress: PAYOUT },
    ],
    [
      'a royalty',
      settingsCalls.royalty(PAYOUT, 750),
      'DefaultRoyaltyUpdated',
      { receiver: PAYOUT, feeNumerator: 750n },
    ],
    ['mint on behalf', settingsCalls.mintOnBehalf(true), 'MintOnBehalfUpdated', { newStatus: true }],
    [
      'a validator, whatever the old one was',
      settingsCalls.validator(zeroAddress),
      'TransferValidatorUpdated',
      { oldValidator: VALIDATOR, newValidator: zeroAddress },
    ],
    [
      'a base URI',
      settingsCalls.baseUri(`ipfs://bafybei${'e'.repeat(52)}/`),
      'BatchMetadataUpdate',
      { fromTokenId: 1n, toTokenId: 2n ** 256n - 1n },
    ],
  ])('matches %s by its event and arguments', (_label, call, eventName, args) => {
    expect(matchPhaseEvent(receipt([logOf(CONTRACT, eventName, args)]), expect_(call))).toMatchObject({
      ok: true,
    })
  })

  it('compares an address argument without case, and refuses another address', () => {
    const lower = logOf(CONTRACT, 'OwnerPayoutAddressUpdated', {
      newOwnerPayoutAddress: PAYOUT.toLowerCase(),
    })
    expect(matchPhaseEvent(receipt([lower]), expect_(settingsCalls.payout(PAYOUT)))).toMatchObject({
      ok: true,
    })
    expect(matchPhaseEvent(receipt([lower]), expect_(settingsCalls.payout(STRANGER)))).toEqual({
      ok: false,
      error: NOT_THIS_CHANGE,
    })
  })

  it('answers the decoded arguments: a withdrawal its amount and payout address, an airdrop its fee', () => {
    const withdrawn = matchPhaseEvent(
      receipt([logOf(CONTRACT, 'MintFundsWithdrawn', { payoutAddress: PAYOUT, amount: 1_000n })]),
      expect_(settingsCalls.withdraw()),
    )
    expect(withdrawn).toEqual({ ok: true, args: { payoutAddress: PAYOUT, amount: 1_000n } })
    const airdropped = matchPhaseEvent(
      receipt([logOf(CONTRACT, 'NFTsAirdropped', { recipients: 2n, amount: 3n, feePaid: 300n })]),
      {
        contract: CONTRACT,
        from: WALLET,
        event: { eventName: 'NFTsAirdropped', args: { recipients: 2n, amount: 3n } },
      },
    )
    expect(airdropped).toEqual({ ok: true, args: { recipients: 2n, amount: 3n, feePaid: 300n } })
  })

  it("matches the level on the validator with the validator's ABI, the level a number", () => {
    const expected = {
      contract: VALIDATOR,
      from: WALLET,
      event: expectedEvent(settingsCalls.level(VALIDATOR, CONTRACT, 9)),
      abi: validatorAbi,
    }
    const sent = { to: VALIDATOR }
    expect(matchPhaseEvent(receipt([levelLog(9)], sent), expected)).toEqual({
      ok: true,
      args: { collection: CONTRACT, level: 9 },
    })
    expect(matchPhaseEvent(receipt([levelLog(1)], sent), expected)).toEqual({
      ok: false,
      error: NOT_THIS_CHANGE,
    })
    expect(matchPhaseEvent(receipt([levelLog(9, ELSEWHERE)], sent), expected)).toEqual({
      ok: false,
      error: NOT_THIS_CHANGE,
    })
    expect(matchPhaseEvent(receipt([levelLog(9)], sent), { ...expected, abi: undefined })).toEqual({
      ok: false,
      error: NOT_THIS_CHANGE,
    })
  })
})
```

Create `apps/web/src/lib/chain/airdrop-batch.test.ts`:

```ts
import { collectionAbi } from '@cobweb/shared/collection-abi'
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  getAbiItem,
  zeroAddress,
  type Abi,
  type AbiEvent,
  type Address,
  type Hex,
} from 'viem'
import { describe, expect, it } from 'vitest'
import { NOT_FROM_WALLET, NOT_THIS_CHANGE, NOT_THIS_CONTRACT } from '@/lib/art/result'
import { BURN_ADDRESS } from '@/lib/manage/airdrop-view'
import { abiOf, airdropCalls, phaseCalls, type ManageCall } from '@/lib/manage/phase-calls'
import { proveAirdrop, type AirdropProof } from './airdrop-batch'
import type { PhaseReceipt } from './phase-events'

const CONTRACT: Address = '0x0409454C375c8a6aB05383bFB6D9FcDe9ebB8F85'
const ELSEWHERE: Address = '0x2073D2716161E2Fa4eBcB3BA42348dE8f98A3dDd'
const WALLET: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const STRANGER: Address = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
const A: Address = '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65'
const B: Address = '0x90F79bf6EB2c4f870365E785982E1f101E93b906'
const FEE = 100_000_000_000_000n

type ReceiptLog = PhaseReceipt['logs'][number]

/** The calldata the wallet sends for a call. */
const inputOf = (call: ManageCall): Hex =>
  encodeFunctionData({ abi: abiOf(call) as Abi, functionName: call.functionName, args: call.args })

/** `NFTsAirdropped` as the contract emits it: nothing indexed, so all three sit in data. */
function airdropped(
  recipients: bigint,
  amount: bigint,
  feePaid: bigint,
  address: Address = CONTRACT,
): ReceiptLog {
  const item = getAbiItem({ abi: collectionAbi, name: 'NFTsAirdropped' }) as AbiEvent
  return {
    address,
    topics: encodeEventTopics({ abi: [item], eventName: item.name } as never) as ReceiptLog['topics'],
    data: encodeAbiParameters(item.inputs, [recipients, amount, feePaid]),
  }
}

/** `Transfer` as ERC721A emits it: from, to and the id all indexed. */
function transfer(from: Address, to: Address, tokenId: bigint, address: Address = CONTRACT): ReceiptLog {
  return {
    address,
    topics: encodeEventTopics({
      abi: collectionAbi,
      eventName: 'Transfer',
      args: { from, to, tokenId },
    }) as ReceiptLog['topics'],
    data: '0x',
  }
}

/** One mint per recipient, ids running on from `first`. */
const mints = (recipients: Address[], first: bigint, address: Address = CONTRACT) =>
  recipients.map((recipient, index) => transfer(zeroAddress, recipient, first + BigInt(index), address))

const receipt = (logs: ReceiptLog[], patch: Partial<PhaseReceipt> = {}): PhaseReceipt => ({
  status: 'success',
  from: WALLET,
  to: CONTRACT,
  logs,
  ...patch,
})

const expected = { contract: CONTRACT, from: WALLET.toLowerCase() }
const BATCH: ManageCall = airdropCalls.batch(
  [
    { address: A, amount: 2 },
    { address: B, amount: 1 },
  ],
  FEE.toString(),
)
const LOGS = [...mints([A, A, B], 5n), airdropped(2n, 3n, 3n * FEE)]

describe('proveAirdrop', () => {
  it('answers the batch from the calldata, the fee its event carries and the ids it minted', () => {
    expect(proveAirdrop(receipt(LOGS), inputOf(BATCH), expected)).toEqual<AirdropProof>({
      ok: true,
      batch: {
        kind: 'airdrop',
        recipients: 2,
        tokens: 3,
        feePaidWei: '300000000000000',
        firstTokenId: 5,
        lastTokenId: 7,
      },
    })
  })

  it('accepts consecutive ids in any order, and leaves out a Transfer a recipient contract sends on (Review Focus 3)', () => {
    const logs = [
      transfer(zeroAddress, B, 7n),
      transfer(zeroAddress, A, 5n),
      transfer(A, STRANGER, 5n),
      transfer(zeroAddress, A, 6n),
      airdropped(2n, 3n, 3n * FEE),
    ]
    expect(proveAirdrop(receipt(logs), inputOf(BATCH), expected)).toMatchObject({
      ok: true,
      batch: { tokens: 3, firstTokenId: 5, lastTokenId: 7 },
    })
  })

  it('reads a burn from its only recipient, the dead address, in any case', () => {
    const logs = [...mints([BURN_ADDRESS, BURN_ADDRESS], 11n), airdropped(1n, 2n, 2n * FEE)]
    const lowercase: ManageCall = {
      functionName: 'airdropNFTs',
      args: [[BURN_ADDRESS.toLowerCase() as Address], [2n]],
      value: 2n * FEE,
    }
    for (const call of [airdropCalls.burn(2, FEE.toString()), lowercase])
      expect(proveAirdrop(receipt(logs), inputOf(call), expected)).toEqual<AirdropProof>({
        ok: true,
        batch: {
          kind: 'burn',
          recipients: 1,
          tokens: 2,
          feePaidWei: '200000000000000',
          firstTokenId: 11,
          lastTokenId: 12,
        },
      })
  })

  it('reads one recipient that is not the dead address as an airdrop', () => {
    const one = airdropCalls.batch([{ address: A, amount: 1 }], FEE.toString())
    const proof = proveAirdrop(receipt([...mints([A], 1n), airdropped(1n, 1n, FEE)]), inputOf(one), expected)
    expect(proof).toMatchObject({ ok: true, batch: { kind: 'airdrop', recipients: 1, tokens: 1 } })
  })

  it.each<[string, PhaseReceipt, Hex, string]>([
    ['another contract', receipt(LOGS, { to: ELSEWHERE }), inputOf(BATCH), NOT_THIS_CONTRACT],
    ['a contract creation', receipt(LOGS, { to: null }), inputOf(BATCH), NOT_THIS_CONTRACT],
    ['another sender', receipt(LOGS, { from: STRANGER }), inputOf(BATCH), NOT_FROM_WALLET],
    ['a reverted receipt', receipt([], { status: 'reverted' }), inputOf(BATCH), NOT_THIS_CHANGE],
    ['an input the ABI does not decode', receipt(LOGS), '0xdeadbeef', NOT_THIS_CHANGE],
    ['another function', receipt(LOGS), inputOf(phaseCalls.open(1)), NOT_THIS_CHANGE],
    [
      'recipients and amounts of different lengths',
      receipt(LOGS),
      encodeFunctionData({ abi: collectionAbi, functionName: 'airdropNFTs', args: [[A, B], [3n]] }),
      NOT_THIS_CHANGE,
    ],
    [
      'no token at all',
      receipt([airdropped(1n, 0n, 0n)]),
      inputOf(airdropCalls.batch([{ address: A, amount: 0 }], '0')),
      NOT_THIS_CHANGE,
    ],
    ['no NFTsAirdropped', receipt(mints([A, A, B], 5n)), inputOf(BATCH), NOT_THIS_CHANGE],
    [
      'NFTsAirdropped with other counts',
      receipt([...mints([A, A, B], 5n), airdropped(3n, 3n, 3n * FEE)]),
      inputOf(BATCH),
      NOT_THIS_CHANGE,
    ],
    [
      'NFTsAirdropped from another contract',
      receipt([...mints([A, A, B], 5n), airdropped(2n, 3n, 3n * FEE, ELSEWHERE)]),
      inputOf(BATCH),
      NOT_THIS_CHANGE,
    ],
    [
      'fewer mints than tokens',
      receipt([...mints([A, A], 5n), airdropped(2n, 3n, 3n * FEE)]),
      inputOf(BATCH),
      NOT_THIS_CHANGE,
    ],
    [
      'mints from another contract',
      receipt([...mints([A, A, B], 5n, ELSEWHERE), airdropped(2n, 3n, 3n * FEE)]),
      inputOf(BATCH),
      NOT_THIS_CHANGE,
    ],
    [
      'ids that do not run on',
      receipt([...mints([A, A], 5n), transfer(zeroAddress, B, 8n), airdropped(2n, 3n, 3n * FEE)]),
      inputOf(BATCH),
      NOT_THIS_CHANGE,
    ],
  ])('refuses %s', (_label, proven, input, error) => {
    expect(proveAirdrop(proven, input, expected)).toEqual<AirdropProof>({ ok: false, error })
  })
})
```

In `apps/web/src/components/deploy/tx-errors.test.ts`, replace:

```ts
  type Address,
} from 'viem'
import { describe, expect, it } from 'vitest'
```

with:

```ts
  zeroAddress,
  type Address,
} from 'viem'
import { describe, expect, it } from 'vitest'
import { ZERO_ADDRESS } from '@/lib/art/result'
```

In `apps/web/src/components/deploy/tx-errors.test.ts`, replace:

```ts
    ['ArrayLengthMismatch', [], 'The addresses and quotas do not line up. Reload and try again.'],
    ['PublicGroupHasNoQuota', [], 'The public sale has no whitelist.'],
    ['NotInWhitelist', [STRANGER, 2n], `${STRANGER} is not on the whitelist of phase 2.`],
    ['ExceedsMintQuota', [1_500n, 1_200n], 'This wallet can mint 1,200 more in this phase, not 1,500.'],
```

with:

```ts
    ['ArrayLengthMismatch', [], 'The addresses and amounts do not line up. Reload and try again.'],
    ['PublicGroupHasNoQuota', [], 'The public sale has no whitelist.'],
    ['NotInWhitelist', [STRANGER, 2n], `${STRANGER} is not on the whitelist of phase 2.`],
    ['ExceedsMintQuota', [1_500n, 1_200n], 'This wallet can mint 1,200 more in this phase, not 1,500.'],
    ['ExceedsMaxSupply', [1_500n, 1_204n], 'Only 1,204 tokens are left to mint, not 1,500.'],
    ['ExceedsMaxSupply', [2n, 1n], 'Only 1 token is left to mint, not 2.'],
    ['ExceedsMaxSupply', [3n, 0n], 'No tokens are left to mint.'],
    [
      'TransferToNonERC721ReceiverImplementer',
      [],
      'One recipient is a contract that cannot receive ERC-721 tokens. Send to wallets only.',
    ],
    ['NothingToWithdraw', [], 'There is nothing to withdraw: the balance is 0.'],
    [
      'WithdrawFailed',
      [],
      'The payout address did not accept the funds. Change the payout address, then withdraw again.',
    ],
    [
      'CreatorTokenBase__InvalidTransferValidatorContract',
      [],
      'There is no contract at that address on this chain. A validator must be a contract, or the zero address to remove the check.',
    ],
    ['ERC2981InvalidDefaultRoyalty', [10_001n, 10_000n], 'The royalty cannot be more than 100%.'],
    [
      'ERC2981InvalidDefaultRoyaltyReceiver',
      [zeroAddress],
      'The royalty recipient cannot be the zero address.',
    ],
    ['MintToZeroAddress', [], ZERO_ADDRESS],
```

In `apps/web/src/components/deploy/tx-errors.test.ts`, replace:

```ts
  it('falls back to the short message for any other revert, and keeps the factory wording for payment and deploy', () => {
    expect(
      classifyError(simulationRevert('ExceedsMaxSupply', [5n, 1n]), 'simulating', 'manage').message,
    ).toBe(
```

with:

```ts
  it('reads the airdrop fee as a native amount with the chain symbol, and in wei without one', () => {
    const short = simulationRevert('InsufficientEther', [100_000_000_000_000n, 99_999_999_999_999n])
    expect(classifyError(short, 'simulating', 'manage', 'ETH').message).toBe(
      'The airdrop fee is 0.0001 ETH and 0.000099999999999999 ETH was sent. Read again for the current fee. Nothing was sent.',
    )
    expect(classifyError(short, 'simulating', 'manage').message).toBe(
      'The airdrop fee is 100000000000000 wei and 99999999999999 wei was sent. Read again for the current fee. Nothing was sent.',
    )
  })

  it('falls back to the short message for any other revert, and keeps the factory wording for payment and deploy', () => {
    expect(classifyError(simulationRevert('FeeBpsTooHigh', [10_001n]), 'simulating', 'manage').message).toBe(
```

In `apps/web/src/components/manage/manage-actions.test.ts`, replace:

```ts
import type { Address, Hex } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Config } from 'wagmi'
```

with:

```ts
import { DEFAULT_TRANSFER_VALIDATOR, validatorAbi } from '@cobweb/shared'
import { collectionAbi } from '@cobweb/shared/collection-abi'
import type { Address, Hex } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Config } from 'wagmi'
import { airdropCalls, settingsCalls } from '@/lib/manage/phase-calls'
```

In `apps/web/src/components/manage/manage-actions.test.ts`, replace:

```ts
  return { waitForTransactionReceipt, getPublicClient }
})
vi.mock('wagmi/actions', () => ({ getPublicClient: wagmi.getPublicClient }))
```

with:

```ts
  const simulateContract = vi.fn<(config: Config, parameters: unknown) => Promise<{ request: unknown }>>()
  const writeContract = vi.fn<(config: Config, request: unknown) => Promise<Hex>>()
  return { waitForTransactionReceipt, getPublicClient, simulateContract, writeContract }
})
vi.mock('wagmi/actions', () => ({
  getPublicClient: wagmi.getPublicClient,
  simulateContract: wagmi.simulateContract,
  writeContract: wagmi.writeContract,
}))
```

At the end of `apps/web/src/components/manage/manage-actions.test.ts`, append:

```ts

describe('realManageActions simulate (docs/specs/2026-10-15-airdrop-settings.md, section 7.1)', () => {
  const request = { simulated: true }

  beforeEach(() => {
    wagmi.simulateContract.mockReset()
    wagmi.writeContract.mockReset()
    wagmi.simulateContract.mockResolvedValue({ request })
    wagmi.writeContract.mockResolvedValue(HASH)
  })

  it('simulates a batch on the collection with its value, then sends the simulated request unchanged', async () => {
    const call = airdropCalls.batch([{ address: target.wallet, amount: 2 }], '100')
    const send = await realManageActions(config, target).simulate(call)
    expect(wagmi.simulateContract).toHaveBeenCalledWith(config, {
      address: target.contract,
      abi: collectionAbi,
      functionName: 'airdropNFTs',
      args: call.args,
      value: 200n,
      chainId: 31337,
      account: target.wallet,
    })
    expect(await send()).toBe(HASH)
    expect(wagmi.writeContract).toHaveBeenCalledWith(config, request)
  })

  it("simulates the level call on the validator's address with the validator's ABI and no value", async () => {
    const call = settingsCalls.level(DEFAULT_TRANSFER_VALIDATOR, target.contract, 9)
    await realManageActions(config, target).simulate(call)
    expect(wagmi.simulateContract).toHaveBeenCalledWith(config, {
      address: DEFAULT_TRANSFER_VALIDATOR,
      abi: validatorAbi,
      functionName: 'setTransferSecurityLevelOfCollection',
      args: [target.contract, 9, false, false, false],
      value: undefined,
      chainId: 31337,
      account: target.wallet,
    })
  })
})
```

In `apps/web/src/lib/chain/quota-chunk.test.ts`, replace:

```ts
  getAbiItem,
  type AbiEvent,
```

with:

```ts
  getAbiItem,
  type Abi,
  type AbiEvent,
```

In `apps/web/src/lib/chain/quota-chunk.test.ts`, replace:

```ts
import { phaseCalls, type ManageCall } from '@/lib/manage/phase-calls'
```

with:

```ts
import { abiOf, phaseCalls, type ManageCall } from '@/lib/manage/phase-calls'
```

In `apps/web/src/lib/chain/quota-chunk.test.ts`, replace:

```ts
  encodeFunctionData({ abi: collectionAbi, functionName: call.functionName, args: call.args })
```

with:

```ts
  encodeFunctionData({ abi: abiOf(call) as Abi, functionName: call.functionName, args: call.args })
```

In `apps/web/src/components/manage/manage-sim.test.ts`, replace:

```ts
      'The addresses and quotas do not line up. Reload and try again. Nothing was sent.',
```

with:

```ts
      'The addresses and amounts do not line up. Reload and try again. Nothing was sent.',
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @cobweb/web exec vitest run src/lib/manage/phase-calls.test.ts src/lib/manage/phase-schemas.test.ts src/lib/chain/phase-events.test.ts src/lib/chain/airdrop-batch.test.ts src/components/deploy/tx-errors.test.ts src/components/manage/manage-actions.test.ts src/lib/chain/quota-chunk.test.ts src/components/manage/manage-sim.test.ts`
Expected: FAIL. `airdrop-batch.test.ts` fails to load (`Cannot find module './airdrop-batch'`); `phase-calls.test.ts`, `phase-events.test.ts` and `quota-chunk.test.ts` fail while their tests are collected (`Cannot read properties of undefined (reading 'batch')`, `(reading 'payout')` and `abiOf is not a function`: `airdropCalls`, `settingsCalls` and `abiOf` do not exist yet); in the other four files 18 tests fail: twelve in `tx-errors.test.ts` (the new errors read "The check against the contract failed: ..." and the length mismatch still names quotas), three in `phase-schemas.test.ts` and two in `manage-actions.test.ts` (the builders are undefined), and one in `manage-sim.test.ts` (the length mismatch sentence). The run ends `Test Files  8 failed (8)` and `Tests  18 failed | 67 passed (85)`.

- [ ] **Step 3: The calls and their shapes**

Decision (section 7.1): the royalty cap in the shape is a local `ROYALTY_MAX_BPS = 1_000`, the deploy form's 10%, since `deploy-form.tsx` is a client module; a value or a target on another function is stripped, as zod strips unknown keys.

Replace the whole of `apps/web/src/lib/manage/phase-calls.ts` with:

```ts
import { validatorAbi } from '@cobweb/shared'
import { collectionAbi } from '@cobweb/shared/collection-abi'
import {
  getAbiItem,
  zeroAddress,
  type Abi,
  type AbiFunction,
  type Address,
  type ContractFunctionArgs,
} from 'viem'
import { formatBps, formatNative, formatUtc } from '@/lib/demo/helpers'
import type { SupportedChain } from '@/lib/demo/types'
import type { BatchEntry } from './airdrop-types'
import { BURN_ADDRESS, tokensOf } from './airdrop-view'
import { TRANSFER_LEVELS, type TransferLevelValue } from './settings-view'

/**
 * The calls Manage drop sends (docs/specs/2026-10-15-phases.md, section 7.1), built in one place for the
 * browser, the server and the verify scripts. Pure. Whitelist adds `setMintQuota`
 * (docs/specs/2026-10-15-whitelist.md, section 7.1); Airdrop and Settings add theirs, a payable call with its
 * value and the validator's level call with its target (docs/specs/2026-10-15-airdrop-settings.md, section 7.1).
 */
export type ManageFunction =
  | 'registerMintGroup'
  | 'setMintGroupStatus'
  | 'scheduleMintGroupStart'
  | 'changeSalePrice'
  | 'setMintGroupMaxSupply'
  | 'setPublicMaxMintPerWallet'
  | 'stopOrStartAllMintGroups'
  | 'setMintQuota'
  | 'airdropNFTs'
  | 'withdrawMintFunds'
  | 'setOwnerPayoutAddress'
  | 'setDefaultRoyalty'
  | 'setBaseURI'
  | 'setMintOnBehalfStatus'
  | 'setTransferValidator'

/** The call Settings sends to the transfer validator rather than the collection. */
export type ValidatorFunction = 'setTransferSecurityLevelOfCollection'

/** Where a call goes when it is not the collection: the validator, at its address. */
export type CallTarget = { contract: 'validator'; address: Address }

/**
 * A call as viem takes it: the function name and its arguments typed from its contract's ABI, the native value
 * sent with a payable call, and the target for the validator's call (absent for the collection).
 */
export type ManageCall =
  | {
      [F in ManageFunction]: {
        functionName: F
        args: ContractFunctionArgs<typeof collectionAbi, 'nonpayable' | 'payable', F>
        value?: bigint
        target?: undefined
      }
    }[ManageFunction]
  | {
      functionName: ValidatorFunction
      args: ContractFunctionArgs<typeof validatorAbi, 'nonpayable', ValidatorFunction>
      value?: undefined
      target: CallTarget
    }

/**
 * A call as it crosses the server action boundary: every uint256 as a decimal string, booleans as they are, an
 * array as an array of strings, the value as a decimal string and the target with its address.
 */
export type SentCall = {
  functionName: ManageFunction | ValidatorFunction
  args: (string | boolean | string[])[]
  value?: string
  target?: { contract: 'validator'; address: string }
}

/**
 * The event a call must leave in its receipt, with viem's argument names (docs/specs/2026-10-15-phases.md,
 * section 6.3). Close all names only its status: any number of groups may have changed. A withdrawal names no
 * argument: the confirm reads the amount and the payout address from the event it matched.
 */
export type ExpectedEvent =
  | { eventName: 'MintGroupRegistered'; args: { mintGroup: bigint } }
  | { eventName: 'MintGroupStatusChanged'; args: { mintGroup: bigint; status: boolean } }
  | { eventName: 'AllMintGroupsStatusChanged'; args: { status: boolean } }
  | { eventName: 'MintGroupStartTimestampChanged'; args: { mintGroup: bigint; timestamp: bigint } }
  | { eventName: 'SalePriceChanged'; args: { mintGroup: bigint; newPrice: bigint } }
  | { eventName: 'MintGroupMaxSupplyUpdated'; args: { mintGroup: bigint; newMaxSupply: bigint } }
  | { eventName: 'PublicMaxMintPerWalletChanged'; args: { newMaxMintPerWallet: bigint } }
  | { eventName: 'MintQuotasAdded'; args: { mintGroup: bigint; numberOfAddresses: bigint } }
  | { eventName: 'NFTsAirdropped'; args: { recipients: bigint; amount: bigint } }
  | { eventName: 'MintFundsWithdrawn'; args: Record<string, never> }
  | { eventName: 'OwnerPayoutAddressUpdated'; args: { newOwnerPayoutAddress: Address } }
  | { eventName: 'DefaultRoyaltyUpdated'; args: { receiver: Address; feeNumerator: bigint } }
  | { eventName: 'MintOnBehalfUpdated'; args: { newStatus: boolean } }
  | { eventName: 'TransferValidatorUpdated'; args: { newValidator: Address } }
  | { eventName: 'BatchMetadataUpdate'; args: { fromTokenId: bigint; toTokenId: bigint } }
  | { eventName: 'SetTransferSecurityLevel'; args: { collection: Address; level: number } }

/** The functions a Phases confirm accepts. */
export const PHASE_FUNCTIONS: ReadonlySet<string> = new Set<ManageFunction>([
  'registerMintGroup',
  'setMintGroupStatus',
  'scheduleMintGroupStart',
  'changeSalePrice',
  'setMintGroupMaxSupply',
  'setPublicMaxMintPerWallet',
  'stopOrStartAllMintGroups',
])

/** The functions a Settings confirm accepts: six on the collection and the validator's level call. */
export const SETTINGS_FUNCTIONS: ReadonlySet<string> = new Set<ManageFunction | ValidatorFunction>([
  'withdrawMintFunds',
  'setOwnerPayoutAddress',
  'setDefaultRoyalty',
  'setBaseURI',
  'setMintOnBehalfStatus',
  'setTransferValidator',
  'setTransferSecurityLevelOfCollection',
])

/** The builders the Phases and Whitelist dialogs use. Prices are wei as decimal strings, so no wei is lost. */
export const phaseCalls: {
  register(id: number, priceWei: string, maxSupply: number, startUnix: number): ManageCall
  open(id: number): ManageCall
  close(id: number): ManageCall
  closeAll(): ManageCall
  publicCap(cap: number): ManageCall
  schedule(id: number, startUnix: number): ManageCall
  clearSchedule(id: number): ManageCall
  price(id: number, priceWei: string): ManageCall
  allocation(id: number, maxSupply: number): ManageCall
  quotas(id: number, addresses: Address[], quotas: number[]): ManageCall
} = {
  register: (id, priceWei, maxSupply, startUnix) => ({
    functionName: 'registerMintGroup',
    args: [BigInt(id), BigInt(priceWei), BigInt(maxSupply), BigInt(startUnix)],
  }),
  open: (id) => ({ functionName: 'setMintGroupStatus', args: [BigInt(id), true] }),
  close: (id) => ({ functionName: 'setMintGroupStatus', args: [BigInt(id), false] }),
  closeAll: () => ({ functionName: 'stopOrStartAllMintGroups', args: [false] }),
  publicCap: (cap) => ({ functionName: 'setPublicMaxMintPerWallet', args: [BigInt(cap)] }),
  schedule: (id, startUnix) => ({
    functionName: 'scheduleMintGroupStart',
    args: [BigInt(id), BigInt(startUnix)],
  }),
  clearSchedule: (id) => ({ functionName: 'scheduleMintGroupStart', args: [BigInt(id), 0n] }),
  // The contract takes the price first: changeSalePrice(newMintPrice, mintGroup).
  price: (id, priceWei) => ({ functionName: 'changeSalePrice', args: [BigInt(priceWei), BigInt(id)] }),
  allocation: (id, maxSupply) => ({
    functionName: 'setMintGroupMaxSupply',
    args: [BigInt(id), BigInt(maxSupply)],
  }),
  // The contract takes the addresses first: setMintQuota(addressesToAdd, mintGroup, mintQuotas_).
  quotas: (id, addresses, quotas) => ({
    functionName: 'setMintQuota',
    args: [addresses, BigInt(id), quotas.map((quota) => BigInt(quota))],
  }),
}

/** One batch as `airdropNFTs`: the value is exactly the contract's fee per token times the batch's tokens. */
function airdropCall(entries: BatchEntry[], feePerTokenWei: string): ManageCall {
  return {
    functionName: 'airdropNFTs',
    args: [entries.map((entry) => entry.address), entries.map((entry) => BigInt(entry.amount))],
    value: BigInt(feePerTokenWei) * BigInt(tokensOf(entries)),
  }
}

/** The builders Airdrop uses: a batch to wallets, or a burn, which is one batch to the dead address. */
export const airdropCalls: {
  batch(entries: BatchEntry[], feePerTokenWei: string): ManageCall
  burn(amount: number, feePerTokenWei: string): ManageCall
} = {
  batch: airdropCall,
  burn: (amount, feePerTokenWei) => airdropCall([{ address: BURN_ADDRESS, amount }], feePerTokenWei),
}

/** The builders Settings and the Overview use. The level call goes to the validator, with the three flags off. */
export const settingsCalls: {
  withdraw(): ManageCall
  payout(address: Address): ManageCall
  royalty(receiver: Address, bps: number): ManageCall
  baseUri(uri: string): ManageCall
  mintOnBehalf(on: boolean): ManageCall
  validator(address: Address): ManageCall
  level(validator: Address, collection: Address, level: TransferLevelValue): ManageCall
} = {
  withdraw: () => ({ functionName: 'withdrawMintFunds', args: [] }),
  payout: (address) => ({ functionName: 'setOwnerPayoutAddress', args: [address] }),
  royalty: (receiver, bps) => ({ functionName: 'setDefaultRoyalty', args: [receiver, BigInt(bps)] }),
  baseUri: (uri) => ({ functionName: 'setBaseURI', args: [uri] }),
  mintOnBehalf: (on) => ({ functionName: 'setMintOnBehalfStatus', args: [on] }),
  validator: (address) => ({ functionName: 'setTransferValidator', args: [address] }),
  level: (validator, collection, level) => ({
    functionName: 'setTransferSecurityLevelOfCollection',
    args: [collection, level, false, false, false],
    target: { contract: 'validator', address: validator },
  }),
}

/** The ABI a call is encoded with: the validator's for its level call, else the collection's. */
export function abiOf(call: ManageCall): typeof collectionAbi | typeof validatorAbi {
  return call.target ? validatorAbi : collectionAbi
}

/** The event the confirm looks for in the receipt (section 6.3). */
export function expectedEvent(call: ManageCall): ExpectedEvent {
  switch (call.functionName) {
    case 'registerMintGroup':
      return { eventName: 'MintGroupRegistered', args: { mintGroup: call.args[0] } }
    case 'setMintGroupStatus':
      return { eventName: 'MintGroupStatusChanged', args: { mintGroup: call.args[0], status: call.args[1] } }
    case 'stopOrStartAllMintGroups':
      return { eventName: 'AllMintGroupsStatusChanged', args: { status: call.args[0] } }
    case 'scheduleMintGroupStart':
      return {
        eventName: 'MintGroupStartTimestampChanged',
        args: { mintGroup: call.args[0], timestamp: call.args[1] },
      }
    case 'changeSalePrice':
      return { eventName: 'SalePriceChanged', args: { mintGroup: call.args[1], newPrice: call.args[0] } }
    case 'setMintGroupMaxSupply':
      return {
        eventName: 'MintGroupMaxSupplyUpdated',
        args: { mintGroup: call.args[0], newMaxSupply: call.args[1] },
      }
    case 'setPublicMaxMintPerWallet':
      return { eventName: 'PublicMaxMintPerWalletChanged', args: { newMaxMintPerWallet: call.args[0] } }
    case 'setMintQuota':
      return {
        eventName: 'MintQuotasAdded',
        args: { mintGroup: call.args[1], numberOfAddresses: BigInt(call.args[0].length) },
      }
    case 'airdropNFTs':
      // The fee is not compared: the proof reads what the event says was paid.
      return {
        eventName: 'NFTsAirdropped',
        args: {
          recipients: BigInt(call.args[0].length),
          amount: call.args[1].reduce((sum, amount) => sum + amount, 0n),
        },
      }
    case 'withdrawMintFunds':
      return { eventName: 'MintFundsWithdrawn', args: {} }
    case 'setOwnerPayoutAddress':
      return { eventName: 'OwnerPayoutAddressUpdated', args: { newOwnerPayoutAddress: call.args[0] } }
    case 'setDefaultRoyalty':
      return {
        eventName: 'DefaultRoyaltyUpdated',
        args: { receiver: call.args[0], feeNumerator: call.args[1] },
      }
    case 'setBaseURI':
      // The event carries no URI: the confirm also reads the URI from the transaction's calldata.
      return { eventName: 'BatchMetadataUpdate', args: { fromTokenId: 1n, toTokenId: 2n ** 256n - 1n } }
    case 'setMintOnBehalfStatus':
      return { eventName: 'MintOnBehalfUpdated', args: { newStatus: call.args[0] } }
    case 'setTransferValidator':
      // The old validator is not compared: a change made outside Cobweb in between still confirms this one.
      return { eventName: 'TransferValidatorUpdated', args: { newValidator: call.args[0] } }
    case 'setTransferSecurityLevelOfCollection':
      return {
        eventName: 'SetTransferSecurityLevel',
        args: { collection: call.args[0], level: call.args[1] },
      }
  }
}

/** One argument of a call, whatever the function. */
type CallArg = bigint | boolean | number | string | readonly (bigint | Address)[]

const sentArg = (arg: CallArg): string | boolean | string[] =>
  typeof arg === 'boolean'
    ? arg
    : typeof arg === 'object'
      ? arg.map((item) => item.toString())
      : arg.toString()

/** A call as the browser sends it to a confirm action. */
export function sentOf(call: ManageCall): SentCall {
  const sent: SentCall = {
    functionName: call.functionName,
    args: (call.args as readonly CallArg[]).map(sentArg),
  }
  if (call.value !== undefined) sent.value = call.value.toString()
  if (call.target) sent.target = { contract: 'validator', address: call.target.address }
  return sent
}

/** A sent call back as viem takes it. The shape is checked first (`parseSentCall`), so every value converts. */
export function callOf(sent: SentCall): ManageCall {
  const uint = (index: number) => BigInt(sent.args[index] as string)
  const bool = (index: number) => sent.args[index] === true
  const list = (index: number) => sent.args[index] as string[]
  const text = (index: number) => sent.args[index] as string
  const address = (index: number) => sent.args[index] as Address
  switch (sent.functionName) {
    case 'registerMintGroup':
      return { functionName: 'registerMintGroup', args: [uint(0), uint(1), uint(2), uint(3)] }
    case 'setMintGroupStatus':
      return { functionName: 'setMintGroupStatus', args: [uint(0), bool(1)] }
    case 'scheduleMintGroupStart':
      return { functionName: 'scheduleMintGroupStart', args: [uint(0), uint(1)] }
    case 'changeSalePrice':
      return { functionName: 'changeSalePrice', args: [uint(0), uint(1)] }
    case 'setMintGroupMaxSupply':
      return { functionName: 'setMintGroupMaxSupply', args: [uint(0), uint(1)] }
    case 'setPublicMaxMintPerWallet':
      return { functionName: 'setPublicMaxMintPerWallet', args: [uint(0)] }
    case 'stopOrStartAllMintGroups':
      return { functionName: 'stopOrStartAllMintGroups', args: [bool(0)] }
    case 'setMintQuota':
      return {
        functionName: 'setMintQuota',
        args: [list(0).map((address) => address as Address), uint(1), list(2).map((quota) => BigInt(quota))],
      }
    case 'airdropNFTs':
      return {
        functionName: 'airdropNFTs',
        args: [list(0).map((recipient) => recipient as Address), list(1).map((amount) => BigInt(amount))],
        value: BigInt(sent.value ?? '0'),
      }
    case 'withdrawMintFunds':
      return { functionName: 'withdrawMintFunds', args: [] }
    case 'setOwnerPayoutAddress':
      return { functionName: 'setOwnerPayoutAddress', args: [address(0)] }
    case 'setDefaultRoyalty':
      return { functionName: 'setDefaultRoyalty', args: [address(0), uint(1)] }
    case 'setBaseURI':
      return { functionName: 'setBaseURI', args: [text(0)] }
    case 'setMintOnBehalfStatus':
      return { functionName: 'setMintOnBehalfStatus', args: [bool(0)] }
    case 'setTransferValidator':
      return { functionName: 'setTransferValidator', args: [address(0)] }
    case 'setTransferSecurityLevelOfCollection':
      return {
        functionName: 'setTransferSecurityLevelOfCollection',
        args: [address(0), Number(text(1)), bool(2), bool(3), bool(4)],
        target: { contract: 'validator', address: (sent.target?.address ?? zeroAddress) as Address },
      }
  }
}

const PRICE_INPUTS = new Set(['price', 'newMintPrice'])

/** The validator's levels Cobweb offers, in the review's words. */
const LEVEL_TITLES = new Map<number, string>([
  [TRANSFER_LEVELS.enforced, 'royalties enforced'],
  [TRANSFER_LEVELS.open, 'royalties not enforced'],
  [TRANSFER_LEVELS.locked, 'locked'],
])

/** `1 address`, `500 addresses`, with thousands separators. */
const counted = (value: number | bigint, one: string, many: string) =>
  `${value.toLocaleString('en-US')} ${value === 1 || value === 1n ? one : many}`

/** An array argument as counts: the addresses, the quotas with their total, or the amounts with their tokens. */
function listValue(name: string, values: readonly (bigint | Address)[]): string {
  const total = values.reduce<bigint>((sum, value) => sum + (typeof value === 'bigint' ? value : 0n), 0n)
  if (name === 'mintQuotas')
    return `${counted(values.length, 'quota', 'quotas')}, ${total.toLocaleString('en-US')} in total`
  if (name === 'amounts')
    return `${counted(values.length, 'amount', 'amounts')}, ${counted(total, 'token', 'tokens')} in total`
  return counted(values.length, 'address', 'addresses')
}

/** One argument in the creator's words. */
function argValue(name: string, arg: CallArg, chain: SupportedChain): string {
  if (typeof arg === 'boolean') return String(arg)
  if (typeof arg === 'object') return listValue(name, arg)
  if (typeof arg === 'number') {
    const title = name === 'level' ? LEVEL_TITLES.get(arg) : undefined
    return title ? `${arg} (${title})` : String(arg)
  }
  if (typeof arg === 'string')
    return name === 'transferValidator' && arg.toLowerCase() === zeroAddress
      ? `${arg} (removes the check)`
      : arg
  if (PRICE_INPUTS.has(name)) return `${formatNative(arg, chain.nativeSymbol, 18)} (${arg} wei)`
  if (name === 'startTimestamp')
    return arg === 0n ? '0 (no scheduled start)' : `${formatUtc(Number(arg))} (${arg})`
  if (name === 'feeNumerator') return `${arg} (${formatBps(Number(arg))})`
  return arg.toString()
}

/**
 * The rows the dialog shows before signing: the ABI's argument names (a trailing underscore dropped) with
 * readable values, a price as the native amount and its wei, a start as UTC and its Unix value, an array as
 * counts, a royalty in basis points and percent, a level with its title; then, for a call with a value, the
 * value as the native amount and its wei.
 */
export function reviewOf(call: ManageCall, chain: SupportedChain): { name: string; value: string }[] {
  const item = getAbiItem({ abi: abiOf(call) as Abi, name: call.functionName }) as AbiFunction
  const rows = (call.args as readonly CallArg[]).map((arg, index) => {
    const name = (item.inputs[index]?.name ?? `argument ${index + 1}`).replace(/_$/, '')
    return { name, value: argValue(name, arg, chain) }
  })
  if (call.value !== undefined)
    rows.push({
      name: 'Value',
      value: `${formatNative(call.value, chain.nativeSymbol, 18)} (${call.value} wei)`,
    })
  return rows
}
```

In `apps/web/src/lib/manage/phase-schemas.ts`, replace:

```ts
import { getAddress, isAddress } from 'viem'
```

with:

```ts
import { getAddress, isAddress, zeroAddress } from 'viem'
```

In `apps/web/src/lib/manage/phase-schemas.ts`, replace:

```ts
import type { SentCall } from './phase-calls'
import { INT_MAX } from './phases-view'
```

with:

```ts
import { AIRDROP_MAX_PER_ADDRESS, AIRDROP_MAX_RECIPIENTS, AIRDROP_MAX_TOKENS } from './airdrop-view'
import type { SentCall } from './phase-calls'
import { INT_MAX } from './phases-view'
import { ipfsUriValid } from './settings-view'
```

In `apps/web/src/lib/manage/phase-schemas.ts`, replace:

```ts
const quotaText = z.string().refine((value) => /^\d{1,5}$/.test(value) && Number(value) <= QUOTA_MAX)

/**
 * A sent call: ids 0 to 2,147,483,647, every uint256 a decimal string, in each function's argument order; a
 * chunk is 1 to 500 checksummed addresses with as many quotas.
```

with:

```ts
const quotaText = z.string().refine((value) => /^\d{1,5}$/.test(value) && Number(value) <= QUOTA_MAX)
// Airdrop and Settings (docs/specs/2026-10-15-airdrop-settings.md, section 7.1): an airdrop's amounts of 1 to
// 1,000, an address that is not the zero address, a royalty within the app's 10% and the levels Cobweb sends.
/** The app's royalty cap in basis points: the deploy form's 10%. */
const ROYALTY_MAX_BPS = 1_000
const amountText = z
  .string()
  .refine(
    (value) => /^\d{1,4}$/.test(value) && Number(value) >= 1 && Number(value) <= AIRDROP_MAX_PER_ADDRESS,
  )
const notZero = checksummed.refine((value) => value !== zeroAddress)
const bpsText = z.string().refine((value) => /^\d{1,4}$/.test(value) && Number(value) <= ROYALTY_MAX_BPS)

/**
 * A sent call: ids 0 to 2,147,483,647, every uint256 a decimal string, in each function's argument order; a
 * chunk is 1 to 500 checksummed addresses with as many quotas; an airdrop is 1 to 500 checksummed recipients
 * with as many amounts, 1,000 tokens at most, and its value; the level call carries its target. A value or a
 * target on another function is stripped.
```

In `apps/web/src/lib/manage/phase-schemas.ts`, replace:

```ts
])

/** A sent call from the browser, or UNSAVED whatever is wrong with it. */
export function parseSentCall(input: unknown): { ok: true; data: SentCall } | { ok: false; error: string } {
  const result = sentCallShape.safeParse(input)
  return result.success ? { ok: true, data: result.data } : { ok: false, error: UNSAVED }
```

with:

```ts
  z.object({
    functionName: z.literal('airdropNFTs'),
    args: z
      .tuple([
        z.array(checksummed).min(1).max(AIRDROP_MAX_RECIPIENTS),
        z.array(amountText).min(1).max(AIRDROP_MAX_RECIPIENTS),
      ])
      .refine(
        ([recipients, amounts]) =>
          recipients.length === amounts.length &&
          amounts.reduce((sum, amount) => sum + Number(amount), 0) <= AIRDROP_MAX_TOKENS,
      ),
    value: uintText,
  }),
  z.object({ functionName: z.literal('withdrawMintFunds'), args: z.tuple([]) }),
  z.object({ functionName: z.literal('setOwnerPayoutAddress'), args: z.tuple([notZero]) }),
  z.object({ functionName: z.literal('setDefaultRoyalty'), args: z.tuple([notZero, bpsText]) }),
  z.object({ functionName: z.literal('setBaseURI'), args: z.tuple([z.string().refine(ipfsUriValid)]) }),
  z.object({ functionName: z.literal('setMintOnBehalfStatus'), args: z.tuple([z.boolean()]) }),
  z.object({ functionName: z.literal('setTransferValidator'), args: z.tuple([checksummed]) }),
  z.object({
    functionName: z.literal('setTransferSecurityLevelOfCollection'),
    args: z.tuple([
      checksummed,
      z.enum(['0', '1', '9']),
      z.literal(false),
      z.literal(false),
      z.literal(false),
    ]),
    target: z.object({ contract: z.literal('validator'), address: notZero }),
  }),
])

/**
 * A sent call from the browser, or UNSAVED whatever is wrong with it; with `functions`, also UNSAVED for any
 * other function, so a Phases confirm never accepts an airdrop or a Settings call (PHASE_FUNCTIONS,
 * SETTINGS_FUNCTIONS).
 */
export function parseSentCall(
  input: unknown,
  functions?: ReadonlySet<string>,
): { ok: true; data: SentCall } | { ok: false; error: string } {
  const result = sentCallShape.safeParse(input)
  if (!result.success || (functions && !functions.has(result.data.functionName)))
    return { ok: false, error: UNSAVED }
  return { ok: true, data: result.data }
```

- [ ] **Step 4: The event match on any ABI, and the batch proof**

Decision (section 6.4): the expected event is read through a local `wanted` of `{ eventName: string; args: Record<string, unknown> }`, so the union of sixteen variants is not narrowed inside the loop.

Replace the whole of `apps/web/src/lib/chain/phase-events.ts` with:

```ts
import { collectionAbi } from '@cobweb/shared/collection-abi'
import { decodeEventLog, type Abi, type Address } from 'viem'
import { NOT_FROM_WALLET, NOT_THIS_CHANGE, NOT_THIS_CONTRACT } from '@/lib/art/result'
import type { ExpectedEvent } from '@/lib/manage/phase-calls'
import type { ReceiptLike } from './art-paid'

/** What `matchPhaseEvent` reads of a transaction receipt. viem's `TransactionReceipt` fits it. */
export type PhaseReceipt = ReceiptLike & { from: Address; to: Address | null }

/** A match answers the event's decoded arguments, so a confirm can read what the event carried. */
export type PhaseEventMatch = { ok: true; args: Record<string, unknown> } | { ok: false; error: string }

/**
 * Whether every wanted argument equals the decoded one: a string (an address) without case, anything else (a
 * bigint, a boolean, a number) exactly. Close all names only its status; a withdrawal names nothing.
 */
function sameArgs(decoded: Record<string, unknown>, wanted: Record<string, unknown>): boolean {
  return Object.entries(wanted).every(([name, value]) => {
    const got = decoded[name]
    return typeof value === 'string' && typeof got === 'string'
      ? got.toLowerCase() === value.toLowerCase()
      : got === value
  })
}

/**
 * Checks that a receipt made the change the creator asked for (docs/specs/2026-10-15-phases.md, section
 * 6.3): sent to the contract (`NOT_THIS_CONTRACT`), from the sign-in wallet (`NOT_FROM_WALLET`), and
 * carrying, among the logs that contract emitted, the expected event with the expected arguments
 * (`NOT_THIS_CHANGE`), decoded with `abi` (the collection's unless given: the validator's for the level call,
 * docs/specs/2026-10-15-airdrop-settings.md, section 6.4). Addresses compare without case. The confirm checks a
 * reverted receipt first.
 */
export function matchPhaseEvent(
  receipt: PhaseReceipt,
  expected: { contract: Address; from: string; event: ExpectedEvent; abi?: Abi },
): PhaseEventMatch {
  const contract = expected.contract.toLowerCase()
  if (receipt.to?.toLowerCase() !== contract) return { ok: false, error: NOT_THIS_CONTRACT }
  if (receipt.from.toLowerCase() !== expected.from.toLowerCase()) return { ok: false, error: NOT_FROM_WALLET }
  if (receipt.status !== 'success') return { ok: false, error: NOT_THIS_CHANGE }
  const wanted: { eventName: string; args: Record<string, unknown> } = expected.event
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== contract) continue
    try {
      const event = decodeEventLog({ abi: expected.abi ?? collectionAbi, data: log.data, topics: log.topics })
      // viem decodes any event of the ABI by its topic, so the name is compared here.
      if (event.eventName !== wanted.eventName) continue
      const args = event.args as unknown as Record<string, unknown>
      if (sameArgs(args, wanted.args)) return { ok: true, args }
    } catch {
      // A log the ABI does not decode.
    }
  }
  return { ok: false, error: NOT_THIS_CHANGE }
}
```

Create `apps/web/src/lib/chain/airdrop-batch.ts`:

```ts
import { collectionAbi } from '@cobweb/shared/collection-abi'
import { decodeEventLog, decodeFunctionData, zeroAddress, type Address, type Hex } from 'viem'
import { NOT_FROM_WALLET, NOT_THIS_CHANGE, NOT_THIS_CONTRACT } from '@/lib/art/result'
import type { AirdropKind } from '@/lib/manage/airdrop-types'
import { BURN_ADDRESS } from '@/lib/manage/airdrop-view'
import { matchPhaseEvent, type PhaseReceipt } from './phase-events'

/** What a proven batch did, from its calldata and its logs, or why the transaction is not a batch of this collection. */
export type AirdropProof =
  | {
      ok: true
      batch: {
        kind: AirdropKind
        recipients: number
        tokens: number
        feePaidWei: string
        firstTokenId: number
        lastTokenId: number
      }
    }
  | { ok: false; error: string }

const REFUSED: AirdropProof = { ok: false, error: NOT_THIS_CHANGE }

/** The arguments of an `airdropNFTs` call, or null for any other input. */
function airdropArgs(input: Hex) {
  try {
    const call = decodeFunctionData({ abi: collectionAbi, data: input })
    return call.functionName === 'airdropNFTs' ? call.args : null
  } catch {
    // Not a call of the collection's ABI.
    return null
  }
}

/**
 * The ids the collection minted in the receipt, in order: its `Transfer` logs from the zero address. A token a
 * recipient contract passes on in `onERC721Received` adds a `Transfer` from that contract, which is not a mint.
 */
function mintedIds(receipt: PhaseReceipt, contract: string): bigint[] {
  const ids: bigint[] = []
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== contract) continue
    try {
      const event = decodeEventLog({
        abi: collectionAbi,
        eventName: 'Transfer',
        data: log.data,
        topics: log.topics,
      })
      if (event.args.from.toLowerCase() === zeroAddress) ids.push(event.args.tokenId)
    } catch {
      // Another event of the collection.
    }
  }
  return ids.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

/**
 * Proves a batch from its receipt and the transaction's input (docs/specs/2026-10-15-airdrop-settings.md, section
 * 6.3): sent to the collection (`NOT_THIS_CONTRACT`) from the sign-in wallet (`NOT_FROM_WALLET`), as
 * `matchPhaseEvent` checks; then succeeded, decoded as `airdropNFTs` with as many amounts as recipients and at
 * least one token, carrying `NFTsAirdropped` for the decoded counts (its fee is what was paid), and minting
 * exactly that many consecutive ids (`NOT_THIS_CHANGE`). The kind is a burn when the only recipient is the dead
 * address, compared without case.
 */
export function proveAirdrop(
  receipt: PhaseReceipt,
  input: Hex,
  expected: { contract: Address; from: string },
): AirdropProof {
  const contract = expected.contract.toLowerCase()
  if (receipt.to?.toLowerCase() !== contract) return { ok: false, error: NOT_THIS_CONTRACT }
  if (receipt.from.toLowerCase() !== expected.from.toLowerCase()) return { ok: false, error: NOT_FROM_WALLET }
  if (receipt.status !== 'success') return REFUSED
  const args = airdropArgs(input)
  if (!args) return REFUSED
  const [recipients, amounts] = args
  const tokens = amounts.reduce((sum, amount) => sum + amount, 0n)
  if (recipients.length !== amounts.length || tokens === 0n) return REFUSED
  const event = matchPhaseEvent(receipt, {
    contract: expected.contract,
    from: expected.from,
    event: { eventName: 'NFTsAirdropped', args: { recipients: BigInt(recipients.length), amount: tokens } },
  })
  if (!event.ok) return event
  const ids = mintedIds(receipt, contract)
  const [first] = ids
  const last = ids.at(-1)
  if (first === undefined || last === undefined || BigInt(ids.length) !== tokens) return REFUSED
  if (ids.some((id, index) => id !== first + BigInt(index))) return REFUSED
  const [only] = recipients
  const burn = recipients.length === 1 && only?.toLowerCase() === BURN_ADDRESS.toLowerCase()
  return {
    ok: true,
    batch: {
      kind: burn ? 'burn' : 'airdrop',
      recipients: recipients.length,
      tokens: Number(tokens),
      feePaidWei: String(event.args.feePaid),
      firstTokenId: Number(first),
      lastTokenId: Number(last),
    },
  }
}
```

- [ ] **Step 5: The revert sentences and the simulation on the call's contract**

In `apps/web/src/components/deploy/tx-errors.ts`, replace:

```ts
import { WRONG_GROUP } from '@/lib/art/result'
```

with:

```ts
import { WRONG_GROUP, ZERO_ADDRESS } from '@/lib/art/result'
import { formatNative } from '@/lib/demo/helpers'
```

In `apps/web/src/components/deploy/tx-errors.ts`, replace:

```ts
 * quota errors from docs/specs/2026-10-15-whitelist.md, section 6.6), or null for any other. Phases' owner
 * check is OpenZeppelin's `OwnableUnauthorizedAccount`, read as `Unauthorized`.
 */
export function revertSentence(errorName: string, args: readonly unknown[]): string | null {
  const count = (value: unknown) => Number(value).toLocaleString('en-US')
```

with:

```ts
 * quota errors from docs/specs/2026-10-15-whitelist.md, section 6.6; the airdrop, withdrawal, validator and
 * royalty errors from docs/specs/2026-10-15-airdrop-settings.md, section 6.6), or null for any other. Phases'
 * owner check is OpenZeppelin's `OwnableUnauthorizedAccount`, read as `Unauthorized`. Counts carry separators;
 * an amount reads in the chain's native unit with `symbol`, or in wei without one.
 */
export function revertSentence(errorName: string, args: readonly unknown[], symbol?: string): string | null {
  const count = (value: unknown) => Number(value).toLocaleString('en-US')
  const amount = (value: unknown) =>
    symbol ? formatNative(BigInt(value as bigint), symbol, 18) : `${BigInt(value as bigint)} wei`
```

In `apps/web/src/components/deploy/tx-errors.ts`, replace:

```ts
      return 'The addresses and quotas do not line up. Reload and try again.'
```

with:

```ts
      return 'The addresses and amounts do not line up. Reload and try again.'
```

In `apps/web/src/components/deploy/tx-errors.ts`, replace:

```ts
      return `This wallet can mint ${count(args[1])} more in this phase, not ${count(args[0])}.`
    default:
```

with:

```ts
      return `This wallet can mint ${count(args[1])} more in this phase, not ${count(args[0])}.`
    case 'ExceedsMaxSupply': {
      const left = Number(args[1])
      if (left === 0) return 'No tokens are left to mint.'
      if (left === 1) return `Only 1 token is left to mint, not ${count(args[0])}.`
      return `Only ${count(args[1])} tokens are left to mint, not ${count(args[0])}.`
    }
    case 'InsufficientEther':
      return `The airdrop fee is ${amount(args[0])} and ${amount(args[1])} was sent. Read again for the current fee.`
    case 'TransferToNonERC721ReceiverImplementer':
      return 'One recipient is a contract that cannot receive ERC-721 tokens. Send to wallets only.'
    case 'NothingToWithdraw':
      return 'There is nothing to withdraw: the balance is 0.'
    case 'WithdrawFailed':
      return 'The payout address did not accept the funds. Change the payout address, then withdraw again.'
    case 'CreatorTokenBase__InvalidTransferValidatorContract':
      return 'There is no contract at that address on this chain. A validator must be a contract, or the zero address to remove the check.'
    case 'ERC2981InvalidDefaultRoyalty':
      return 'The royalty cannot be more than 100%.'
    case 'ERC2981InvalidDefaultRoyaltyReceiver':
      return 'The royalty recipient cannot be the zero address.'
    case 'MintToZeroAddress':
      return ZERO_ADDRESS
    default:
```

In `apps/web/src/components/deploy/tx-errors.ts`, replace:

```ts
/** A wallet or chain error as the creator reads it, for the step it happened at. */
export function classifyError(error: unknown, at: TxErrorStep, subject: TxSubject = 'payment'): TxFailure {
```

with:

```ts
/**
 * A wallet or chain error as the creator reads it, for the step it happened at. `symbol` is the chain's native
 * symbol, for the amounts a change's revert names.
 */
export function classifyError(
  error: unknown,
  at: TxErrorStep,
  subject: TxSubject = 'payment',
  symbol?: string,
): TxFailure {
```

In `apps/web/src/components/deploy/tx-errors.ts`, replace:

```ts
        (revert && revertSentence(revert.errorName, revert.args)) ??
```

with:

```ts
        (revert && revertSentence(revert.errorName, revert.args, symbol)) ??
```

In `apps/web/src/components/manage/manage-actions.ts`, replace:

```ts
import type { Address, Hex } from 'viem'
import type { Config } from 'wagmi'
import { getPublicClient, readContract, simulateContract, switchChain, writeContract } from 'wagmi/actions'
import type { ActionResult } from '@/lib/art/result'
import type { ManageCall } from '@/lib/manage/phase-calls'
```

with:

```ts
import type { Abi, Address, Hex } from 'viem'
import type { Config } from 'wagmi'
import { getPublicClient, readContract, simulateContract, switchChain, writeContract } from 'wagmi/actions'
import type { ActionResult } from '@/lib/art/result'
import { abiOf, type ManageCall } from '@/lib/manage/phase-calls'
```

In `apps/web/src/components/manage/manage-actions.ts`, replace:

```ts
  /** Simulates the call on the collection; resolves with the function that sends the simulated request, unchanged. */
```

with:

```ts
  /**
   * Simulates the call on its contract (the collection, or the validator for the level call) with its value;
   * resolves with the function that sends the simulated request, unchanged.
   */
```

In `apps/web/src/components/manage/manage-actions.ts`, replace:

```ts
/** The real actions: wagmi switches, simulates on the collection, sends the simulated request and waits. */
```

with:

```ts
/** The real actions: wagmi switches, simulates on the call's contract, sends the simulated request and waits. */
```

In `apps/web/src/components/manage/manage-actions.ts`, replace:

```ts
      const simulated = await simulateContract(config, {
        address: target.contract,
        abi: collectionAbi,
        functionName: call.functionName,
        args: call.args,
```

with:

```ts
      // A payable call carries its value, and the level call goes to the validator with the validator's ABI.
      const simulated = await simulateContract(config, {
        address: call.target?.address ?? target.contract,
        abi: abiOf(call) as Abi,
        functionName: call.functionName,
        args: call.args,
        value: call.value,
```

- [ ] **Step 6: The scripts' wide ABI**

`ManageCall` now types the validator's call from `validatorAbi`, so `verify-phases.ts` and `verify-whitelist.ts`, which simulate a `ManageCall` on `collectionAbi`, no longer typecheck. Decision (section 7.1): they take `collectionAbi as Abi` at their three sites, the narrowest change; they never send the validator's call.

In `apps/web/scripts/verify-phases.ts`, replace:

```ts
import { createWalletClient, http, parseEther, type Address, type Hex } from 'viem'
```

with:

```ts
import { createWalletClient, http, parseEther, type Abi, type Address, type Hex } from 'viem'
```

In `apps/web/scripts/verify-phases.ts`, replace:

```ts
  const { request } = await chain.simulateContract({
    address,
    abi: collectionAbi,
```

with:

```ts
  // The wide ABI type: a ManageCall may name the validator's call too, which this script never sends.
  const { request } = await chain.simulateContract({
    address,
    abi: collectionAbi as Abi,
```

In `apps/web/scripts/verify-phases.ts`, replace:

```ts
          abi: collectionAbi,
```

with:

```ts
          abi: collectionAbi as Abi,
```

In `apps/web/scripts/verify-whitelist.ts`, replace:

```ts
  zeroAddress,
  type Address,
```

with:

```ts
  zeroAddress,
  type Abi,
  type Address,
```

In `apps/web/scripts/verify-whitelist.ts`, replace:

```ts
  const { request } = await chain.simulateContract({
    address,
    abi: collectionAbi,
```

with:

```ts
  // The wide ABI type: a ManageCall may name the validator's call too, which this script never sends.
  const { request } = await chain.simulateContract({
    address,
    abi: collectionAbi as Abi,
```

- [ ] **Step 7: Run the tests to see them pass, then typecheck**

Run: `pnpm --filter @cobweb/web exec vitest run src/lib/manage/phase-calls.test.ts src/lib/manage/phase-schemas.test.ts src/lib/chain/phase-events.test.ts src/lib/chain/airdrop-batch.test.ts src/components/deploy/tx-errors.test.ts src/components/manage/manage-actions.test.ts src/lib/chain/quota-chunk.test.ts src/components/manage/manage-sim.test.ts`
Expected: PASS, 8 files and 161 tests.

Run: `pnpm --filter @cobweb/web typecheck`
Expected: no errors.

- [ ] **Step 8: Format, run the root checks and commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
pnpm exec prettier --write apps/web/src/lib/manage/phase-calls.ts apps/web/src/lib/manage/phase-calls.test.ts apps/web/src/lib/manage/phase-schemas.ts apps/web/src/lib/manage/phase-schemas.test.ts apps/web/src/lib/chain/phase-events.ts apps/web/src/lib/chain/phase-events.test.ts apps/web/src/lib/chain/airdrop-batch.ts apps/web/src/lib/chain/airdrop-batch.test.ts apps/web/src/components/deploy/tx-errors.ts apps/web/src/components/deploy/tx-errors.test.ts apps/web/src/components/manage/manage-actions.ts apps/web/src/components/manage/manage-actions.test.ts apps/web/src/lib/chain/quota-chunk.test.ts apps/web/src/components/manage/manage-sim.test.ts apps/web/scripts/verify-phases.ts apps/web/scripts/verify-whitelist.ts
pnpm typecheck && pnpm lint && pnpm test
git add apps/web/src/lib/manage/phase-calls.ts apps/web/src/lib/manage/phase-calls.test.ts apps/web/src/lib/manage/phase-schemas.ts apps/web/src/lib/manage/phase-schemas.test.ts apps/web/src/lib/chain/phase-events.ts apps/web/src/lib/chain/phase-events.test.ts apps/web/src/lib/chain/airdrop-batch.ts apps/web/src/lib/chain/airdrop-batch.test.ts apps/web/src/components/deploy/tx-errors.ts apps/web/src/components/deploy/tx-errors.test.ts apps/web/src/components/manage/manage-actions.ts apps/web/src/components/manage/manage-actions.test.ts apps/web/src/lib/chain/quota-chunk.test.ts apps/web/src/components/manage/manage-sim.test.ts apps/web/scripts/verify-phases.ts apps/web/scripts/verify-whitelist.ts
git commit -m "$(cat <<'EOF'
Add payable and validator calls to the manage calls with their shapes, event matches on any ABI with the decoded arguments, the airdrop batch proof from calldata and logs, the new revert sentences with amounts in the chain's unit, and the simulation on the call's contract with its value

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: the web package reports 678 tests in 71 files (608 before, plus 70).

---

### Task 5: The Airdrop and Settings cores on the server, and the four actions

No unit test drives this task: the cores read the chain and the database, and `verify:airdrop` and `verify:settings` (Task 8) check them end to end against local Supabase and Anvil. The task ends on typecheck and lint.

**Files:**

- Modify: `apps/web/src/lib/manage/phases-core.ts` (`CollectionStateResult` and `chainStateOf` exported; `refreshCopies` exported as `refreshPhaseCopies`)
- Modify: `apps/web/src/lib/deploy/deploy-core.ts` (`doneJobRow` exported; `readDeployment` reads the base URI, the payout and the royalty from `args`)
- Create: `apps/web/src/lib/manage/airdrop-core.ts`, `apps/web/src/lib/manage/settings-core.ts`
- Create: `apps/web/src/app/actions/airdrop.ts`, `apps/web/src/app/actions/settings.ts`
- Modify: `apps/web/src/app/actions/phases.ts` (a Phases confirm takes only a Phases call)

**Interfaces:**

- Consumes: `confirmationsFor(chainId)`, `hasConfirmations(receiptBlock, latest, required)`, `validatorAbi` from `@cobweb/shared`; `publicClientFor(chainId)` from `@cobweb/shared/server`; `phaseBase(ctx: PhasesContext): Promise<PhaseBase | null>` (`{ chainId; contract; publicMaxPerWallet; readAt; rows }`), `PhasesContext` (= `DeployContext`: `supabase`, `service`, `owner`, `wallet`, `collection`), `readCollectionState` and its private `refreshCopies` in `@/lib/manage/phases-core`; `phasesWrite(collectionId, run, writeError?)` in `@/lib/manage/phases-write`; `DeployOutcome<T>` and the private `doneJobRow(supabase, collectionId, kind)` in `@/lib/deploy/deploy-core`; `readAll(page)` in `@/lib/art/read-all`; `readEach(client, calls, { blockNumber })` and `revertedRead(error)` in `@/lib/chain/read-each`; `errorSummary(error)` in `@/lib/art/lock-core`; `txHash` in `@/lib/art/lock-schemas`; `parse(schema, value)` in `@/lib/art/schemas`; from Task 3, `manageRecordError`, the Airdrop and Settings types, `airdropRowsOf`, `airdropViewOf`, `levelOf`, `settingsPayload`, `settingsViewOf`, `AIRDROP_NOT_CONFIRMED`, `SETTINGS_NOT_CONFIRMED`; from Task 4, `proveAirdrop`, `matchPhaseEvent` (with `abi`), `expectedEvent`, `callOf`, `parseSentCall(input, functions)`, `PHASE_FUNCTIONS`, `SETTINGS_FUNCTIONS`.
- Produces:
  - in `@/lib/manage/phases-core`: `CollectionStateResult` (viem's return type of `collectionState()`), `chainStateOf(state: CollectionStateResult, block: bigint): ChainState`, `refreshPhaseCopies(ctx, state: ChainState): Promise<void>`
  - in `@/lib/deploy/deploy-core`: `doneJobRow` exported; `readDeployment` answers `baseUri`, `payout`, `royaltyBps` and `royaltyReceiver` from `deployments.args` (the columns are copies now)
  - in `@/lib/manage/airdrop-core`: `AirdropContext = PhasesContext`, `readAirdropState: AirdropReader` (`collectionState()`, `fees()` and `owner()` at one block through `readEach`), `airdropViewCore(ctx, read?): Promise<DeployOutcome<AirdropView>>` (NOT_DEPLOYED refused; the history newest block first), `confirmAirdropCore(ctx, txHash: Hex, read?): Promise<DeployOutcome<AirdropView>>` (AIRDROP_NOT_CONFIRMED while the receipt is missing or the chain's depth is not reached, PHASE_REVERTED, the proof's refusals, then `airdrop_record` and the view read at the receipt's block or later)
  - in `@/lib/manage/settings-core`: `SettingsContext = PhasesContext`, `readSettingsState: SettingsReader` (ten views at one block: `collectionState()`, `creatorBalance()`, `platformBalance()`, `pendingBalance(wallet)`, `ownerPayoutAddress()`, `royaltyInfo(1, 10000)`, `baseURI()`, `getTransferValidator()`, `owner()`, `fees()`, then the validator's code and level at that block), `settingsViewCore(ctx, read?)` (the phase copies refreshed first with the read's block, then `settings_refresh`), `confirmSettingsTxCore(ctx, txHash: Hex, call: ManageCall, read?)` (SETTINGS_NOT_CONFIRMED, PHASE_REVERTED, the level only to the collection's own validator with the validator's ABI, a reveal also from its calldata, a withdrawal at the chain's depth recorded through `withdrawal_record` from its event)
  - server actions: `getAirdrop(collectionId): Promise<ActionResult<AirdropView>>`, `confirmAirdrop(collectionId, txHash: string)`, `getSettings(collectionId): Promise<ActionResult<SettingsView>>`, `confirmSettingsTx(collectionId, txHash: string, sent: SentCall)`; `confirmPhaseTx` refuses a call outside `PHASE_FUNCTIONS` as UNSAVED

- [ ] **Step 1: The phase read shared, and the deployed view from its arguments**

Decision (section 6.2): `collectionState()`'s mapping moves into `chainStateOf`, which the Phases, Airdrop and Settings readers share, and Settings refreshes the phase copies through the same function Phases uses.

In `apps/web/src/lib/manage/phases-core.ts`, replace:

```ts
import { getAddress, TransactionReceiptNotFoundError, type Address, type Hex, type PublicClient } from 'viem'
```

with:

```ts
import {
  getAddress,
  TransactionReceiptNotFoundError,
  type Address,
  type ContractFunctionReturnType,
  type Hex,
  type PublicClient,
} from 'viem'
```

In `apps/web/src/lib/manage/phases-core.ts`, replace:

```ts
export type PhasesContext = DeployContext

/**
```

with:

```ts
export type PhasesContext = DeployContext

/** What viem answers for `collectionState()`. */
export type CollectionStateResult = ContractFunctionReturnType<
  typeof collectionAbi,
  'view',
  'collectionState'
>

/**
 * `collectionState()` as the screens read it, at the block it was read at: the mapping the Phases, Airdrop and
 * Settings readers share (docs/specs/2026-10-15-airdrop-settings.md, section 6.2).
 */
export function chainStateOf(state: CollectionStateResult, block: bigint): ChainState {
  return {
    block,
    blockTimestamp: Number(state.blockTimestamp),
    maxSupply: Number(state.maxSupply),
    totalMinted: Number(state.totalMinted),
    publicMaxMintPerWallet: Number(state.publicMaxMintPerWallet),
    mintOnBehalfActive: state.mintOnBehalfActive,
    groups: state.groups.map((group) => ({
      id: Number(group.id),
      priceWei: group.price.toString(),
      maxSupply: Number(group.maxSupply),
      minted: Number(group.minted),
      startTimestamp: Number(group.startTimestamp),
      flag: group.activeFlag,
      active: group.active,
    })),
  }
}

/**
```

In `apps/web/src/lib/manage/phases-core.ts`, replace:

```ts
    return {
      block,
      blockTimestamp: Number(state.blockTimestamp),
      maxSupply: Number(state.maxSupply),
      totalMinted: Number(state.totalMinted),
      publicMaxMintPerWallet: Number(state.publicMaxMintPerWallet),
      mintOnBehalfActive: state.mintOnBehalfActive,
      groups: state.groups.map((group) => ({
        id: Number(group.id),
        priceWei: group.price.toString(),
        maxSupply: Number(group.maxSupply),
        minted: Number(group.minted),
        startTimestamp: Number(group.startTimestamp),
        flag: group.activeFlag,
        active: group.active,
      })),
    }
```

with:

```ts
    return chainStateOf(state, block)
```

In `apps/web/src/lib/manage/phases-core.ts`, replace:

```ts
 * and never fails the view.
 */
async function refreshCopies(ctx: PhasesContext, state: ChainState): Promise<void> {
```

with:

```ts
 * and never fails the view. Settings refreshes them too, with its own read's block, before its settings
 * copies (docs/specs/2026-10-15-airdrop-settings.md, section 6.4).
 */
export async function refreshPhaseCopies(ctx: PhasesContext, state: ChainState): Promise<void> {
```

In `apps/web/src/lib/manage/phases-core.ts`, replace:

```ts
  await refreshCopies(ctx, state)
```

with:

```ts
  await refreshPhaseCopies(ctx, state)
```

In `apps/web/src/lib/deploy/deploy-core.ts`, replace:

```ts
/** The collection's latest done job of a kind, or null. */
async function doneJobRow(
```

with:

```ts
/** The collection's latest done job of a kind, or null. Settings reads its base URI as a reveal target. */
export async function doneJobRow(
```

In `apps/web/src/lib/deploy/deploy-core.ts`, replace:

```ts
 */
const DEPLOYMENT_COLUMNS =
  'collection_id, chain_id, contract_address, tx_hash, deployer, deployed_at, base_uri, payout_address, royalty_bps, royalty_receiver, args, mint_fee_flat_wei::text, mint_fee_bps, airdrop_fee_per_token_wei::text'
```

with:

```ts
 * So do the base URI, the payout address and the royalty: their columns are the copies Settings refreshes
 * (docs/specs/2026-10-15-airdrop-settings.md, section 6.4), and the deployed view shows what landed.
 */
const DEPLOYMENT_COLUMNS =
  'collection_id, chain_id, contract_address, tx_hash, deployer, deployed_at, args, mint_fee_flat_wei::text, mint_fee_bps, airdrop_fee_per_token_wei::text'
```

In `apps/web/src/lib/deploy/deploy-core.ts`, replace:

```ts
  deployed_at: string
  base_uri: string
  payout_address: string
  royalty_bps: number
  royalty_receiver: string
  args: PreparedArgs
```

with:

```ts
  deployed_at: string
  args: PreparedArgs
```

In `apps/web/src/lib/deploy/deploy-core.ts`, replace:

```ts
    baseUri: row.base_uri,
    payout: getAddress(row.payout_address),
    royaltyBps: row.royalty_bps,
    royaltyReceiver: getAddress(row.royalty_receiver),
```

with:

```ts
    baseUri: row.args.baseUri,
    payout: getAddress(row.args.payout),
    royaltyBps: row.args.royaltyBps,
    royaltyReceiver: getAddress(row.args.royaltyReceiver),
```

- [ ] **Step 2: The Airdrop core**

Create `apps/web/src/lib/manage/airdrop-core.ts`:

```ts
import { confirmationsFor, hasConfirmations } from '@cobweb/shared'
import { collectionAbi } from '@cobweb/shared/collection-abi'
import { publicClientFor } from '@cobweb/shared/server'
import {
  getAddress,
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem'
import { errorSummary } from '@/lib/art/lock-core'
import { readAll } from '@/lib/art/read-all'
import { AIRDROP_NOT_CONFIRMED, CHAIN_NOT_READY, NOT_DEPLOYED, PHASE_REVERTED } from '@/lib/art/result'
import { proveAirdrop } from '@/lib/chain/airdrop-batch'
import { readEach } from '@/lib/chain/read-each'
import type { DeployOutcome } from '@/lib/deploy/deploy-core'
import type { AirdropReader, AirdropView } from './airdrop-types'
import { airdropRowsOf, airdropViewOf, type AirdropDbRow } from './airdrop-view'
import { chainStateOf, phaseBase, type CollectionStateResult, type PhasesContext } from './phases-core'

/**
 * Airdrop on the server (docs/specs/2026-10-15-airdrop-settings.md, section 6.3): the read of the contract's
 * fee, supply and owner, the view with Cobweb's records, and the confirm of a batch from its receipt and calldata,
 * on a Supabase client acting as the signed-in creator. The actions (app/actions/airdrop.ts) call these after the
 * session and ownership check; verify:airdrop calls them with a signed-in script client. No `server-only` marker,
 * so the script can import it; the browser never does. Records are written only by `airdrop_record`, from what a
 * proven transaction carried, never from browser values.
 */
export type AirdropContext = PhasesContext

/** The `airdrops` columns the view reads, the fee as text. */
const AIRDROP_COLUMNS =
  'tx_hash, kind, recipients, tokens, fee_paid_wei::text, first_token_id, last_token_id, block, confirmed_at'

/**
 * `collectionState()`, `fees()` and `owner()` at one block, the latest or `atLeast` when the node is behind it.
 * A request that fails, or a view that does not answer, is logged and answers null.
 */
export const readAirdropState: AirdropReader = async (chainId, address, atLeast) => {
  try {
    const client = publicClientFor(chainId)
    // cacheTime 0: viem reuses a block number for the poll interval, which can read older than a receipt.
    const latest = await client.getBlockNumber({ cacheTime: 0 })
    const block = atLeast !== undefined && atLeast > latest ? atLeast : latest
    const [state, fees, owner] = await readEach<unknown>(
      client,
      [
        { address, abi: collectionAbi, functionName: 'collectionState' },
        { address, abi: collectionAbi, functionName: 'fees' },
        { address, abi: collectionAbi, functionName: 'owner' },
      ],
      { blockNumber: block },
    )
    if (!state || !fees || !owner) {
      console.error(`The airdrop state could not be read on chain ${chainId}: a view did not answer.`)
      return null
    }
    const chain = chainStateOf(state as CollectionStateResult, block)
    const [, , airdropFeePerToken] = fees as readonly [bigint, bigint, bigint]
    return {
      block,
      blockTimestamp: chain.blockTimestamp,
      maxSupply: chain.maxSupply,
      totalMinted: chain.totalMinted,
      feePerTokenWei: airdropFeePerToken.toString(),
      owner: getAddress(owner as Address),
    }
  } catch (error) {
    console.error(`The airdrop state could not be read on chain ${chainId}: ${errorSummary(error)}`)
    return null
  }
}

/**
 * What the Airdrop tab shows (section 6.3): Cobweb's records of the collection, newest block first, with the
 * contract's fee, supply and owner, or the records alone when the chain does not answer. It refreshes nothing.
 */
export async function airdropViewCore(
  ctx: AirdropContext,
  read: AirdropReader = readAirdropState,
): Promise<DeployOutcome<AirdropView>> {
  const base = await phaseBase(ctx)
  if (!base) return { refused: NOT_DEPLOYED }
  const rows = await readAll<AirdropDbRow>((from, to) =>
    ctx.supabase
      .from('airdrops')
      .select(AIRDROP_COLUMNS)
      .eq('collection_id', ctx.collection.id)
      .order('block', { ascending: false })
      .order('tx_hash')
      .range(from, to),
  )
  const state = await read(base.chainId, base.contract)
  return {
    data: airdropViewOf(
      {
        chainId: base.chainId,
        contract: base.contract,
        maxSupply: ctx.collection.max_supply ?? 0,
        readAt: base.readAt,
      },
      airdropRowsOf(rows),
      state,
    ),
  }
}

/**
 * Confirms a batch (section 6.3): the receipt (not found yet is AIRDROP_NOT_CONFIRMED, which the machine polls;
 * reverted is PHASE_REVERTED), the chain's confirmation depth, the transaction's input, the proof from the calldata
 * and the logs, then the record through `airdrop_record` and the view read at the receipt's block or later. The
 * browser sends only the hash. A second confirm of the same hash records nothing and answers the view again.
 */
export async function confirmAirdropCore(
  ctx: AirdropContext,
  txHash: Hex,
  read: AirdropReader = readAirdropState,
): Promise<DeployOutcome<AirdropView>> {
  const base = await phaseBase(ctx)
  if (!base) return { refused: NOT_DEPLOYED }
  const hash = txHash.toLowerCase() as Hex
  let client: PublicClient
  try {
    client = publicClientFor(base.chainId)
  } catch {
    return { refused: CHAIN_NOT_READY }
  }
  let receipt: Awaited<ReturnType<PublicClient['getTransactionReceipt']>>
  try {
    receipt = await client.getTransactionReceipt({ hash })
  } catch (error) {
    // Not mined yet, or not visible to this node yet: the machine asks again in 3 seconds.
    if (!(error instanceof TransactionReceiptNotFoundError))
      console.error(`The receipt could not be read: ${errorSummary(error)}`)
    return { refused: AIRDROP_NOT_CONFIRMED }
  }
  // sic: viem types the receipt as always present; a node can still answer with nothing.
  if (!receipt) return { refused: AIRDROP_NOT_CONFIRMED }
  if (receipt.status === 'reverted') return { refused: PHASE_REVERTED }
  // A receipt too shallow to survive a reorg is not recorded yet: nothing reads the batch from the chain again.
  try {
    const latest = await client.getBlockNumber({ cacheTime: 0 })
    if (!hasConfirmations(receipt.blockNumber, latest, confirmationsFor(base.chainId)))
      return { refused: AIRDROP_NOT_CONFIRMED }
  } catch (error) {
    console.error(`The latest block could not be read: ${errorSummary(error)}`)
    return { refused: AIRDROP_NOT_CONFIRMED }
  }
  let input: Hex
  try {
    input = (await client.getTransaction({ hash })).input
  } catch (error) {
    if (!(error instanceof TransactionNotFoundError))
      console.error(`The transaction could not be read: ${errorSummary(error)}`)
    return { refused: AIRDROP_NOT_CONFIRMED }
  }
  const proof = proveAirdrop(receipt, input, { contract: base.contract, from: ctx.wallet })
  if (!proof.ok) return { refused: proof.error }
  const recorded = await ctx.service().rpc('airdrop_record', {
    p_collection_id: ctx.collection.id,
    p_owner: ctx.owner,
    p_tx: hash,
    p_kind: proof.batch.kind,
    p_recipients: proof.batch.recipients,
    p_tokens: proof.batch.tokens,
    // Wei as a decimal string, so none is lost; PostgREST casts it to numeric.
    p_fee_paid_wei: proof.batch.feePaidWei as unknown as number,
    p_first_token_id: proof.batch.firstTokenId,
    p_last_token_id: proof.batch.lastTokenId,
    p_block: Number(receipt.blockNumber),
    p_sent_by: receipt.from.toLowerCase(),
  })
  if (recorded.error) return { error: recorded.error }
  const block = receipt.blockNumber
  return airdropViewCore(ctx, (chainId, address) => read(chainId, address, block))
}
```

- [ ] **Step 3: The Settings core**

Create `apps/web/src/lib/manage/settings-core.ts`:

```ts
import { confirmationsFor, hasConfirmations, validatorAbi } from '@cobweb/shared'
import { collectionAbi } from '@cobweb/shared/collection-abi'
import { publicClientFor } from '@cobweb/shared/server'
import {
  decodeFunctionData,
  getAddress,
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem'
import { errorSummary } from '@/lib/art/lock-core'
import { readAll } from '@/lib/art/read-all'
import {
  CHAIN_NOT_READY,
  NOT_DEPLOYED,
  NOT_THIS_CHANGE,
  NOT_THIS_CONTRACT,
  PHASE_REVERTED,
  SETTINGS_NOT_CONFIRMED,
} from '@/lib/art/result'
import { matchPhaseEvent, type PhaseEventMatch } from '@/lib/chain/phase-events'
import { readEach, revertedRead } from '@/lib/chain/read-each'
import type { Json } from '@/lib/database.types'
import { doneJobRow, type DeployOutcome } from '@/lib/deploy/deploy-core'
import { expectedEvent, type ManageCall } from './phase-calls'
import {
  chainStateOf,
  phaseBase,
  refreshPhaseCopies,
  type CollectionStateResult,
  type PhasesContext,
} from './phases-core'
import type {
  RevealTargets,
  SettingsCopyRow,
  SettingsReader,
  SettingsState,
  SettingsView,
  TransferLevelState,
} from './settings-types'
import { levelOf, settingsPayload, settingsViewOf } from './settings-view'

/**
 * Settings on the server (docs/specs/2026-10-15-airdrop-settings.md, section 6.4): the read of the contract's
 * settings and balances at one block, the view with the reveal targets and the withdrawals Cobweb confirmed, and
 * the confirm of a change from its receipt, on a Supabase client acting as the signed-in creator. The actions
 * (app/actions/settings.ts) call these after the session and ownership check; verify:settings calls them with a
 * signed-in script client. No `server-only` marker, so the script can import it; the browser never does. The
 * copies are written only by `settings_refresh` from the server's own read, and withdrawals only by
 * `withdrawal_record` from a proven receipt.
 */
export type SettingsContext = PhasesContext

/** The deployments copies Settings shows while the chain does not answer, and the deploy-time arguments. */
const COPY_COLUMNS =
  'payout_address, royalty_bps, royalty_receiver, base_uri, transfer_validator, mint_on_behalf, args'

/**
 * The collection's level on its validator at the block: none for the zero address or a validator without code,
 * unread when the validator reverts, answers nothing or cannot be asked. The validator never fails the read.
 */
async function levelAt(
  client: PublicClient,
  validator: Address,
  collection: Address,
  blockNumber: bigint,
): Promise<TransferLevelState> {
  if (validator.toLowerCase() === zeroAddress) return levelOf(validator, false, null)
  try {
    const code = await client.getCode({ address: validator, blockNumber })
    if (!code || code === '0x') return levelOf(validator, false, null)
    const policy = await client.readContract({
      address: validator,
      abi: validatorAbi,
      functionName: 'getCollectionSecurityPolicy',
      args: [collection],
      blockNumber,
    })
    return levelOf(validator, true, policy.transferSecurityLevel)
  } catch (error) {
    if (!revertedRead(error))
      console.error(`The transfer level could not be read from ${validator}: ${errorSummary(error)}`)
    return { kind: 'unread' }
  }
}

/**
 * Ten views at one block, the latest or `atLeast` when the node is behind it: `collectionState()`, the three
 * balances (the refunds held for `wallet`), the payout address, the default royalty (`royaltyInfo(1, 10000)`, its
 * amount being the basis points), the base URI, the transfer validator, the owner and the fees; then the level on
 * the validator. A request that fails, or a view that does not answer, is logged and answers null.
 */
export const readSettingsState: SettingsReader = async (chainId, address, wallet, atLeast) => {
  try {
    const client = publicClientFor(chainId)
    // cacheTime 0: viem reuses a block number for the poll interval, which can read older than a receipt.
    const latest = await client.getBlockNumber({ cacheTime: 0 })
    const block = atLeast !== undefined && atLeast > latest ? atLeast : latest
    const views = await readEach<unknown>(
      client,
      [
        { address, abi: collectionAbi, functionName: 'collectionState' },
        { address, abi: collectionAbi, functionName: 'creatorBalance' },
        { address, abi: collectionAbi, functionName: 'platformBalance' },
        { address, abi: collectionAbi, functionName: 'pendingBalance', args: [wallet] },
        { address, abi: collectionAbi, functionName: 'ownerPayoutAddress' },
        { address, abi: collectionAbi, functionName: 'royaltyInfo', args: [1n, 10_000n] },
        { address, abi: collectionAbi, functionName: 'baseURI' },
        { address, abi: collectionAbi, functionName: 'getTransferValidator' },
        { address, abi: collectionAbi, functionName: 'owner' },
        { address, abi: collectionAbi, functionName: 'fees' },
      ],
      { blockNumber: block },
    )
    if (views.some((view) => view === null)) {
      console.error(`The settings could not be read on chain ${chainId}: a view did not answer.`)
      return null
    }
    const [state, creator, platform, pending, payout, royalty, baseUri, validator, owner, fees] = views
    const chain = chainStateOf(state as CollectionStateResult, block)
    const [receiver, bps] = royalty as readonly [Address, bigint]
    const [mintFeeFlat, mintFeeBps, airdropFeePerToken] = fees as readonly [bigint, bigint, bigint]
    const current = getAddress(validator as Address)
    return {
      block,
      blockTimestamp: chain.blockTimestamp,
      chain,
      creatorBalanceWei: String(creator),
      platformBalanceWei: String(platform),
      pendingBalanceWei: String(pending),
      payout: getAddress(payout as Address),
      royaltyBps: Number(bps),
      royaltyReceiver: getAddress(receiver),
      baseUri: baseUri as string,
      validator: current,
      owner: getAddress(owner as Address),
      fees: {
        mintFeeFlatWei: mintFeeFlat.toString(),
        mintFeeBps: Number(mintFeeBps),
        airdropFeePerTokenWei: airdropFeePerToken.toString(),
      },
      level: await levelAt(client, current, address, block),
    }
  } catch (error) {
    console.error(`The settings could not be read on chain ${chainId}: ${errorSummary(error)}`)
    return null
  }
}

/** The sum of the withdrawals Cobweb confirmed for the collection, wei as a decimal string. */
async function withdrawnWei(ctx: SettingsContext): Promise<string> {
  const rows = await readAll<{ amount_wei: string }>((from, to) =>
    ctx.supabase
      .from('withdrawals')
      .select('amount_wei::text')
      .eq('collection_id', ctx.collection.id)
      .order('tx_hash')
      .range(from, to),
  )
  return rows.reduce((sum, row) => sum + BigInt(row.amount_wei), 0n).toString()
}

/**
 * Writes the copies from a read: the phase copies first, then the settings copies through `settings_refresh`,
 * both with the read's block, since they share `state_block`. A refresh that fails, or that a newer read beat,
 * is logged and never fails the view.
 */
async function refreshCopies(ctx: SettingsContext, state: SettingsState): Promise<void> {
  await refreshPhaseCopies(ctx, state.chain)
  try {
    const { data, error } = await ctx.service().rpc('settings_refresh', {
      p_collection_id: ctx.collection.id,
      p_owner: ctx.owner,
      p_block: Number(state.block),
      p_block_time: new Date(state.blockTimestamp * 1000).toISOString(),
      p_settings: settingsPayload(state) as unknown as Json,
    })
    if (error)
      console.error(
        `The settings copies could not be refreshed for ${ctx.collection.id}: ${error.code} ${error.message}`,
      )
    else if (data === false)
      console.error(
        `The settings copies of ${ctx.collection.id} hold a newer read than block ${state.block}.`,
      )
  } catch (error) {
    console.error(
      `The settings copies could not be refreshed for ${ctx.collection.id}: ${errorSummary(error)}`,
    )
  }
}

/**
 * What Settings and the Overview show (section 6.4): the contract's settings and balances read with the session
 * wallet, the copies refreshed from that read, the reveal targets (the latest done real and placeholder jobs'
 * base URIs and the deploy-time one) and the withdrawals Cobweb confirmed; the copies when the chain does not
 * answer.
 */
export async function settingsViewCore(
  ctx: SettingsContext,
  read: SettingsReader = readSettingsState,
): Promise<DeployOutcome<SettingsView>> {
  const base = await phaseBase(ctx)
  if (!base) return { refused: NOT_DEPLOYED }
  const { data, error } = await ctx.supabase
    .from('deployments')
    .select(COPY_COLUMNS)
    .eq('collection_id', ctx.collection.id)
    .single()
  if (error) throw new Error(`The settings could not be read: ${error.message}`)
  const copies = data as unknown as SettingsCopyRow
  const [real, placeholder] = await Promise.all([
    doneJobRow(ctx.supabase, ctx.collection.id, 'real'),
    doneJobRow(ctx.supabase, ctx.collection.id, 'placeholder'),
  ])
  const targets: RevealTargets = {
    real: real?.base_uri ?? null,
    placeholder: placeholder?.base_uri ?? null,
    start: copies.args.baseUri,
  }
  const withdrawn = await withdrawnWei(ctx)
  const state = await read(base.chainId, base.contract, getAddress(ctx.wallet))
  if (state) await refreshCopies(ctx, state)
  return {
    data: settingsViewOf(
      { chainId: base.chainId, contract: base.contract, readAt: base.readAt },
      copies,
      targets,
      withdrawn,
      state,
    ),
  }
}

/** Whether a transaction's input is `setBaseURI` with exactly this URI. */
function setsBaseUri(input: Hex, uri: string): boolean {
  try {
    const call = decodeFunctionData({ abi: collectionAbi, data: input })
    return call.functionName === 'setBaseURI' && call.args[0] === uri
  } catch {
    // Not a call of the collection's ABI.
    return false
  }
}

/**
 * Confirms a Settings change from its receipt (section 6.4): not found yet is SETTINGS_NOT_CONFIRMED, which the
 * machine polls; reverted is PHASE_REVERTED. The level call must have gone to the collection's own validator at
 * the receipt's block and carry the validator's event; any other call the collection's event for it. A reveal is
 * also proven from its calldata, the URI being exactly the one sent; a withdrawal waits for the chain's depth and
 * is recorded from its event. Then the view is read at the receipt's block or later, which refreshes the copies.
 * A second confirm of the same hash answers the view again; a withdrawal stays recorded once.
 */
export async function confirmSettingsTxCore(
  ctx: SettingsContext,
  txHash: Hex,
  call: ManageCall,
  read: SettingsReader = readSettingsState,
): Promise<DeployOutcome<SettingsView>> {
  const base = await phaseBase(ctx)
  if (!base) return { refused: NOT_DEPLOYED }
  const hash = txHash.toLowerCase() as Hex
  let client: PublicClient
  try {
    client = publicClientFor(base.chainId)
  } catch {
    return { refused: CHAIN_NOT_READY }
  }
  let receipt: Awaited<ReturnType<PublicClient['getTransactionReceipt']>>
  try {
    receipt = await client.getTransactionReceipt({ hash })
  } catch (error) {
    // Not mined yet, or not visible to this node yet: the machine asks again in 3 seconds.
    if (!(error instanceof TransactionReceiptNotFoundError))
      console.error(`The receipt could not be read: ${errorSummary(error)}`)
    return { refused: SETTINGS_NOT_CONFIRMED }
  }
  // sic: viem types the receipt as always present; a node can still answer with nothing.
  if (!receipt) return { refused: SETTINGS_NOT_CONFIRMED }
  if (receipt.status === 'reverted') return { refused: PHASE_REVERTED }
  if (call.functionName === 'withdrawMintFunds') {
    // A withdrawal is recorded and never read from the chain again, so it waits for the chain's depth.
    try {
      const latest = await client.getBlockNumber({ cacheTime: 0 })
      if (!hasConfirmations(receipt.blockNumber, latest, confirmationsFor(base.chainId)))
        return { refused: SETTINGS_NOT_CONFIRMED }
    } catch (error) {
      console.error(`The latest block could not be read: ${errorSummary(error)}`)
      return { refused: SETTINGS_NOT_CONFIRMED }
    }
  }
  let match: PhaseEventMatch
  if (call.target) {
    let validator: Address
    try {
      validator = await client.readContract({
        address: base.contract,
        abi: collectionAbi,
        functionName: 'getTransferValidator',
        blockNumber: receipt.blockNumber,
      })
    } catch (error) {
      console.error(`The transfer validator could not be read: ${errorSummary(error)}`)
      return { refused: SETTINGS_NOT_CONFIRMED }
    }
    if (validator.toLowerCase() !== call.target.address.toLowerCase()) return { refused: NOT_THIS_CONTRACT }
    match = matchPhaseEvent(receipt, {
      contract: call.target.address,
      from: ctx.wallet,
      event: expectedEvent(call),
      abi: validatorAbi,
    })
  } else {
    match = matchPhaseEvent(receipt, {
      contract: base.contract,
      from: ctx.wallet,
      event: expectedEvent(call),
    })
  }
  if (!match.ok) return { refused: match.error }
  if (call.functionName === 'setBaseURI') {
    let input: Hex
    try {
      input = (await client.getTransaction({ hash })).input
    } catch (error) {
      if (!(error instanceof TransactionNotFoundError))
        console.error(`The transaction could not be read: ${errorSummary(error)}`)
      return { refused: SETTINGS_NOT_CONFIRMED }
    }
    if (!setsBaseUri(input, call.args[0])) return { refused: NOT_THIS_CHANGE }
  }
  if (call.functionName === 'withdrawMintFunds') {
    const recorded = await ctx.service().rpc('withdrawal_record', {
      p_collection_id: ctx.collection.id,
      p_owner: ctx.owner,
      p_tx: hash,
      // Wei as a decimal string, so none is lost; PostgREST casts it to numeric.
      p_amount_wei: String(match.args.amount) as unknown as number,
      p_payout_address: String(match.args.payoutAddress).toLowerCase(),
      p_block: Number(receipt.blockNumber),
    })
    if (recorded.error) return { error: recorded.error }
  }
  const block = receipt.blockNumber
  return settingsViewCore(ctx, (chainId, address, wallet) => read(chainId, address, wallet, block))
}
```

- [ ] **Step 4: The actions**

Create `apps/web/src/app/actions/airdrop.ts`:

```ts
'use server'

import { cache } from 'react'
import { manageRecordError } from '@/lib/art/db-error'
import { txHash as txHashSchema } from '@/lib/art/lock-schemas'
import type { ActionResult } from '@/lib/art/result'
import { parse } from '@/lib/art/schemas'
import { airdropViewCore, confirmAirdropCore, readAirdropState } from '@/lib/manage/airdrop-core'
import type { AirdropView } from '@/lib/manage/airdrop-types'
import { phasesWrite } from '@/lib/manage/phases-write'

/**
 * Airdrop's server actions (docs/specs/2026-10-15-airdrop-settings.md, section 6.5). Each checks its input first,
 * then runs through `phasesWrite`, which checks the session and the ownership (CLAUDE.md rule 4), with the record
 * functions' sentences for a database refusal. The browser sends only a batch's hash: the server proves the batch
 * from its receipt and calldata and records what the chain says.
 */

/** One chain read per request, however many times a page asks (React's cache). */
const readOnce = cache(readAirdropState)

/** The contract's fee, supply and owner, with Cobweb's records of the batches it confirmed. */
export async function getAirdrop(collectionId: string): Promise<ActionResult<AirdropView>> {
  return phasesWrite(collectionId, (ctx) => airdropViewCore(ctx, readOnce), manageRecordError)
}

/** Confirms a batch or a burn from its receipt and calldata, records it, then answers the fresh view. */
export async function confirmAirdrop(
  collectionId: string,
  txHash: string,
): Promise<ActionResult<AirdropView>> {
  const hash = parse(txHashSchema, txHash)
  if (!hash.ok) return hash
  return phasesWrite(collectionId, (ctx) => confirmAirdropCore(ctx, hash.data), manageRecordError)
}
```

Create `apps/web/src/app/actions/settings.ts`:

```ts
'use server'

import { cache } from 'react'
import { manageRecordError } from '@/lib/art/db-error'
import { txHash as txHashSchema } from '@/lib/art/lock-schemas'
import type { ActionResult } from '@/lib/art/result'
import { parse } from '@/lib/art/schemas'
import { callOf, SETTINGS_FUNCTIONS, type SentCall } from '@/lib/manage/phase-calls'
import { parseSentCall } from '@/lib/manage/phase-schemas'
import { phasesWrite } from '@/lib/manage/phases-write'
import { confirmSettingsTxCore, readSettingsState, settingsViewCore } from '@/lib/manage/settings-core'
import type { SettingsView } from '@/lib/manage/settings-types'

/**
 * Settings' server actions (docs/specs/2026-10-15-airdrop-settings.md, section 6.5). Each checks its input first,
 * then runs through `phasesWrite`, which checks the session and the ownership (CLAUDE.md rule 4), with the record
 * functions' sentences for a database refusal. A confirm takes the hash and the call the browser sent, checked
 * against the Settings functions; the server proves the change from its receipt and reads the chain again.
 */

/** One chain read per request, however many times a page asks (React's cache). */
const readOnce = cache(readSettingsState)

/** The contract's settings and balances, read on the server with the session wallet, or the copies. */
export async function getSettings(collectionId: string): Promise<ActionResult<SettingsView>> {
  return phasesWrite(collectionId, (ctx) => settingsViewCore(ctx, readOnce), manageRecordError)
}

/** Confirms a Settings change from its receipt, then answers the fresh view. Only a Settings call is taken. */
export async function confirmSettingsTx(
  collectionId: string,
  txHash: string,
  sent: SentCall,
): Promise<ActionResult<SettingsView>> {
  const hash = parse(txHashSchema, txHash)
  if (!hash.ok) return hash
  const call = parseSentCall(sent, SETTINGS_FUNCTIONS)
  if (!call.ok) return call
  return phasesWrite(
    collectionId,
    (ctx) => confirmSettingsTxCore(ctx, hash.data, callOf(call.data)),
    manageRecordError,
  )
}
```

In `apps/web/src/app/actions/phases.ts`, replace:

```ts
import { callOf, expectedEvent, type SentCall } from '@/lib/manage/phase-calls'
```

with:

```ts
import { callOf, expectedEvent, PHASE_FUNCTIONS, type SentCall } from '@/lib/manage/phase-calls'
```

In `apps/web/src/app/actions/phases.ts`, replace:

```ts
/** Confirms an on-chain change from its receipt, then answers the fresh view. */
```

with:

```ts
/** Confirms an on-chain change from its receipt, then answers the fresh view. Only a Phases call is taken. */
```

In `apps/web/src/app/actions/phases.ts`, replace:

```ts
  const call = parseSentCall(sent)
```

with:

```ts
  const call = parseSentCall(sent, PHASE_FUNCTIONS)
```

- [ ] **Step 5: Typecheck and lint**

Run: `pnpm --filter @cobweb/web typecheck && pnpm --filter @cobweb/web lint`
Expected: no errors and no warnings.

- [ ] **Step 6: Format, run the root checks and commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
pnpm exec prettier --write apps/web/src/lib/manage/phases-core.ts apps/web/src/lib/deploy/deploy-core.ts apps/web/src/lib/manage/airdrop-core.ts apps/web/src/lib/manage/settings-core.ts apps/web/src/app/actions/airdrop.ts apps/web/src/app/actions/settings.ts apps/web/src/app/actions/phases.ts
pnpm typecheck && pnpm lint && pnpm test
git add apps/web/src/lib/manage/phases-core.ts apps/web/src/lib/deploy/deploy-core.ts apps/web/src/lib/manage/airdrop-core.ts apps/web/src/lib/manage/settings-core.ts apps/web/src/app/actions/airdrop.ts apps/web/src/app/actions/settings.ts apps/web/src/app/actions/phases.ts
git commit -m "$(cat <<'EOF'
Add the Airdrop and Settings cores and their four actions: the fee, supply and owner with Cobweb's records, the batch confirmed from its receipt and calldata at the chain's depth, ten views at one block with the phase and settings copies refreshed, each setting confirmed from its receipt and the withdrawals recorded

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: test counts unchanged (shared 80, web 678).

---

### Task 6: The machine's batch and setting answers, the airdrop job and its store, the bound servers and the dialog's owner check

**Files:**

- Modify: `apps/web/src/components/manage/manage-machine.ts`, `apps/web/src/components/manage/manage-machine.test.ts`
- Create: `apps/web/src/components/manage/airdrop-job.ts`, `apps/web/src/components/manage/airdrop-job.test.ts`
- Create: `apps/web/src/components/manage/airdrop-server.ts`, `apps/web/src/components/manage/settings-server.ts`
- Modify: `apps/web/src/components/manage/transaction-dialog.tsx` (`blocked`, the symbol, the wallet step's value)
- Test: `manage-machine.test.ts`, `airdrop-job.test.ts`

**Interfaces:**

- Consumes: in `manage-machine.ts`, `runManage(input, deps, dispatch)`, `ManageInput`, `ManageDeps`, `NOT_CONFIRMED_YET`, `KeyStore` (from `@/components/deploy/deploy-machine`), `HASH_RE` and the chunk store (`rememberChunk`, `sentChunk`, `forgetChunk`), all already there; `classifyError(error, at, subject, symbol?)` (Task 4); from Task 3, `AIRDROP_NOT_CONFIRMED`, `AIRDROP_TIMED_OUT`, `SETTINGS_NOT_CONFIRMED`, `SETTINGS_TIMED_OUT`, `AirdropJob`, `BatchEntry`, `AirdropView`, `SettingsView`, `AIRDROP_MAX_PER_ADDRESS`, `AIRDROP_MAX_RECIPIENTS`, `AIRDROP_MAX_TOKENS`, `BURN_ADDRESS`, `tokensOf`, `batchesOf`; `Recipient = { address: Address; amount: number; line: number }` in `./recipients`; the actions `getAirdrop`, `confirmAirdrop`, `getSettings`, `confirmSettingsTx` (Task 5); `sentOf` and `ManageCall` (Task 4); `formatNative` and `SupportedChain` (already imported by the dialog).
- Produces:
  - in `manage-machine.ts`: `ManageInput.nativeSymbol?: string`, passed to `classifyError` at its four steps; `NOT_CONFIRMED_YET` maps `AIRDROP_NOT_CONFIRMED` to `AIRDROP_TIMED_OUT` and `SETTINGS_NOT_CONFIRMED` to `SETTINGS_TIMED_OUT`; `rememberAirdropJob(store, collectionId, job: AirdropJob)`, `airdropJob(store, collectionId): AirdropJob | null` (under `cobweb-airdrop:<collectionId>`; a stored value reads as none unless every batch holds 1 to 500 checksummed recipients of 1 to 1,000 tokens and at most 1,000 tokens, `sent` names a batch, the pending hash is 32 bytes or null, and a burn is one entry to the dead address with its hash), `forgetAirdropJob(store, collectionId)`
  - in `airdrop-job.ts`: `frozenJob(rows: readonly Recipient[]): AirdropJob`, `burnJob(amount: number, hash: Hex): AirdropJob`, `withPending(job, hash: Hex | null): AirdropJob | null` (a burn without its hash is no job), `withConfirmed(job): AirdropJob | null` (no job after the last batch), `unsentTokens(job): number`
  - `AirdropServer = { read(): Promise<ActionResult<AirdropView>>; confirm(hash: Hex): Promise<ActionResult<AirdropView>> }` and `airdropServer(collectionId)`; `SettingsServer = { read(): Promise<ActionResult<SettingsView>>; confirm(hash: Hex, call: ManageCall): Promise<ActionResult<SettingsView>> }` and `settingsServer(collectionId)` (the call sent as `sentOf` writes it)
  - `TransactionDialog` takes `blocked?: string | null`: shown under the review with the action off, the dialog still opening; the wallet step names the value a call sends ("Your wallet shows a call to the collection contract, the 0.0004 ETH sent with it, and the gas for it.") or the review's contract; the machine gets the chain's native symbol

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/components/manage/manage-machine.test.ts`, replace:

```ts
import {
  CHAIN_NOT_READY,
```

with:

```ts
import {
  AIRDROP_NOT_CONFIRMED,
  AIRDROP_TIMED_OUT,
  CHAIN_NOT_READY,
```

In `apps/web/src/components/manage/manage-machine.test.ts`, replace:

```ts
  PHASE_TIMED_OUT,
  SIGNED_OUT,
```

with:

```ts
  PHASE_TIMED_OUT,
  SETTINGS_NOT_CONFIRMED,
  SETTINGS_TIMED_OUT,
  SIGNED_OUT,
```

In `apps/web/src/components/manage/manage-machine.test.ts`, replace:

```ts
import { phaseCalls, type ManageCall } from '@/lib/manage/phase-calls'
import type { SentChunk } from '@/lib/manage/whitelist-types'
import {
  forgetAdd,
  forgetChunk,
  pendingAdd,
  rememberAdd,
```

with:

```ts
import type { AirdropJob } from '@/lib/manage/airdrop-types'
import { BURN_ADDRESS } from '@/lib/manage/airdrop-view'
import { airdropCalls, phaseCalls, settingsCalls, type ManageCall } from '@/lib/manage/phase-calls'
import type { SentChunk } from '@/lib/manage/whitelist-types'
import {
  airdropJob,
  forgetAdd,
  forgetAirdropJob,
  forgetChunk,
  pendingAdd,
  rememberAdd,
  rememberAirdropJob,
```

At the end of `apps/web/src/components/manage/manage-machine.test.ts`, append:

```ts

describe('an airdrop batch and a Settings change (docs/specs/2026-10-15-airdrop-settings.md, section 7.1)', () => {
  const batch: ManageInput = {
    ...input,
    call: airdropCalls.batch([{ address: STRANGER, amount: 1 }], '100'),
    nativeSymbol: 'ETH',
  }

  it('polls while the batch is not confirmed yet, then stops after 2 minutes with the batch sentence and keeps the hash', async () => {
    const BATCH_NOT_YET: ActionResult<string> = { ok: false, error: AIRDROP_NOT_CONFIRMED }
    const { deps, calls } = fakeDeps(Array<ActionResult<string>>(50).fill(BATCH_NOT_YET))
    const { last, phase } = await run(deps, batch)
    expect(calls.confirm).toBe(41)
    expect(last).toEqual({
      type: 'failed',
      failure: { kind: 'unconfirmed', title: 'Change not confirmed yet', message: AIRDROP_TIMED_OUT },
    })
    expect(retryHash(phase)).toBe(HASH)
  })

  it('polls while the setting is not confirmed yet, then answers the view', async () => {
    const SETTING_NOT_YET: ActionResult<string> = { ok: false, error: SETTINGS_NOT_CONFIRMED }
    const { deps, calls } = fakeDeps([SETTING_NOT_YET, { ok: true, data: VIEW }])
    const { result } = await run(deps, { ...input, call: settingsCalls.withdraw() })
    expect(calls.sleeps).toEqual([3_000])
    expect(result).toBe(VIEW)
    const late = fakeDeps(Array<ActionResult<string>>(50).fill(SETTING_NOT_YET))
    const { last } = await run(late.deps, { ...input, call: settingsCalls.withdraw() })
    expect(last).toMatchObject({ failure: { message: SETTINGS_TIMED_OUT } })
  })

  it("names a refused fee in the chain's native unit", async () => {
    const { deps } = fakeDeps([], {
      simulate: async () => {
        throw new ContractFunctionRevertedError({
          abi: collectionAbi,
          data: encodeErrorResult({
            abi: collectionAbi,
            errorName: 'InsufficientEther',
            args: [100_000_000_000_000n, 0n],
          }),
          functionName: 'airdropNFTs',
        })
      },
    })
    const { last } = await run(deps, batch)
    expect(last).toMatchObject({
      failure: {
        message:
          'The airdrop fee is 0.0001 ETH and 0 ETH was sent. Read again for the current fee. Nothing was sent.',
      },
    })
  })
})

describe('the airdrop job kept in the browser', () => {
  const memory = (): KeyStore => {
    const map = new Map<string, string>()
    return {
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => {
        map.set(key, value)
      },
      removeItem: (key) => {
        map.delete(key)
      },
    }
  }
  const failing: KeyStore = {
    getItem: () => {
      throw new Error('blocked')
    },
    setItem: () => {
      throw new Error('blocked')
    },
    removeItem: () => {
      throw new Error('blocked')
    },
  }
  const job: AirdropJob = {
    kind: 'airdrop',
    batches: [[{ address: WALLET, amount: 3 }], [{ address: STRANGER, amount: 1 }]],
    sent: 1,
    pending: HASH,
  }
  const burn: AirdropJob = {
    kind: 'burn',
    batches: [[{ address: BURN_ADDRESS, amount: 2 }]],
    sent: 0,
    pending: HASH,
  }

  it('remembers the job per collection, apart from a chunk and an add, until it is forgotten', () => {
    const store = memory()
    rememberAirdropJob(store, 'col-1', job)
    expect(airdropJob(store, 'col-1')).toEqual(job)
    expect(airdropJob(store, 'col-2')).toBeNull()
    expect(store.getItem('cobweb-airdrop:col-1')).toContain(HASH)
    expect(sentChunk(store, 'col-1')).toBeNull()
    rememberAirdropJob(store, 'col-1', burn)
    expect(airdropJob(store, 'col-1')).toEqual(burn)
    forgetAirdropJob(store, 'col-1')
    expect(airdropJob(store, 'col-1')).toBeNull()
  })

  it('reads as none a value that is not a job it could send, and a store that throws', () => {
    const store = memory()
    const entries = (count: number, amount: number) =>
      Array.from({ length: count }, () => ({ address: WALLET, amount }))
    for (const value of [
      'nonsense',
      'null',
      JSON.stringify({ ...job, kind: 'mint' }),
      JSON.stringify({ ...job, batches: [] }),
      JSON.stringify({ ...job, batches: [[], [{ address: WALLET, amount: 1 }]] }),
      JSON.stringify({ ...job, batches: [[{ address: WALLET.toLowerCase(), amount: 1 }]], sent: 0 }),
      JSON.stringify({ ...job, batches: [entries(1, 0)], sent: 0 }),
      JSON.stringify({ ...job, batches: [entries(1, 1_001)], sent: 0 }),
      JSON.stringify({ ...job, batches: [entries(1, 1.5)], sent: 0 }),
      JSON.stringify({ ...job, batches: [entries(501, 1)], sent: 0 }),
      JSON.stringify({ ...job, batches: [entries(2, 600)], sent: 0 }),
      JSON.stringify({ ...job, sent: 2 }),
      JSON.stringify({ ...job, sent: -1 }),
      JSON.stringify({ ...job, pending: 'not-a-hash' }),
      JSON.stringify({ kind: 'airdrop', batches: job.batches, sent: 0 }),
      JSON.stringify({ ...burn, pending: null }),
      JSON.stringify({ ...burn, batches: [[{ address: WALLET, amount: 2 }]] }),
      JSON.stringify({
        ...burn,
        batches: [[{ address: BURN_ADDRESS, amount: 1 }], [{ address: BURN_ADDRESS, amount: 1 }]],
      }),
    ]) {
      store.setItem('cobweb-airdrop:col-1', value)
      expect(airdropJob(store, 'col-1')).toBeNull()
    }
    expect(() => rememberAirdropJob(failing, 'col-1', job)).not.toThrow()
    expect(airdropJob(failing, 'col-1')).toBeNull()
    expect(airdropJob(null, 'col-1')).toBeNull()
    expect(() => forgetAirdropJob(null, 'col-1')).not.toThrow()
  })
})
```

Create `apps/web/src/components/manage/airdrop-job.test.ts`:

```ts
import { getAddress, pad, toHex, type Address, type Hex } from 'viem'
import { describe, expect, it } from 'vitest'
import type { AirdropJob } from '@/lib/manage/airdrop-types'
import { BURN_ADDRESS } from '@/lib/manage/airdrop-view'
import { burnJob, frozenJob, unsentTokens, withConfirmed, withPending } from './airdrop-job'
import type { Recipient } from './recipients'

const HASH: Hex = `0x${'ab'.repeat(32)}`
const wallet = (index: number): Address => getAddress(pad(toHex(index + 1), { size: 20 }))
const rows = (count: number, amount: number): Recipient[] =>
  Array.from({ length: count }, (_, index) => ({ address: wallet(index), amount, line: index + 1 }))

describe('frozenJob', () => {
  it("freezes the list into its batches in the list's order, none sent, without the parser's line numbers", () => {
    const job = frozenJob(rows(1_200, 1))
    expect(job.batches.map((batch) => batch.length)).toEqual([500, 500, 200])
    expect(job).toMatchObject({ kind: 'airdrop', sent: 0, pending: null })
    expect(job.batches[0]?.[0]).toEqual({ address: wallet(0), amount: 1 })
  })
})

describe('burnJob and withPending', () => {
  it('keeps a burn as one entry to the dead address while its hash is pending, and no job without it', () => {
    const burn = burnJob(2, HASH)
    expect(burn).toEqual<AirdropJob>({
      kind: 'burn',
      batches: [[{ address: BURN_ADDRESS, amount: 2 }]],
      sent: 0,
      pending: HASH,
    })
    expect(withPending(burn, null)).toBeNull()
  })

  it("sets and forgets a batch's hash", () => {
    const job = frozenJob(rows(3, 1))
    expect(withPending(job, HASH)).toEqual({ ...job, pending: HASH })
    expect(withPending({ ...job, pending: HASH }, null)).toEqual(job)
  })
})

describe('withConfirmed and unsentTokens', () => {
  it('moves on to the next batch without a hash, and ends after the last', () => {
    const job: AirdropJob = { ...frozenJob(rows(600, 2)), pending: HASH }
    expect(unsentTokens(job)).toBe(1_200)
    const next = withConfirmed(job)
    expect(next).toMatchObject({ sent: 1, pending: null })
    expect(next && unsentTokens(next)).toBe(200)
    expect(next && withConfirmed(next)).toBeNull()
    expect(withConfirmed(burnJob(2, HASH))).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @cobweb/web exec vitest run src/components/manage/manage-machine.test.ts src/components/manage/airdrop-job.test.ts`
Expected: FAIL. `airdrop-job.test.ts` fails to load (`Cannot find module './airdrop-job'`); in `manage-machine.test.ts` five tests fail: the batch's wait stops at the first answer (`expected 1 to be 41`: `AIRDROP_NOT_CONFIRMED` is not a pending answer yet), the setting's wait never sleeps (`expected [] to deeply equal [ 3000 ]`), the refused fee is not named in ETH, and `rememberAirdropJob` and `airdropJob` are not functions. The run ends `Test Files  2 failed (2)` and `Tests  5 failed | 29 passed (34)`.

- [ ] **Step 3: The machine**

Decision (section 7.1): the machine keeps one map of "not confirmed yet" answers, keyed by the sentence, so each kind of change times out with its own words.

In `apps/web/src/components/manage/manage-machine.ts`, replace:

```ts
import type { Address, Hex } from 'viem'
```

with:

```ts
import { getAddress, isAddress, type Address, type Hex } from 'viem'
```

In `apps/web/src/components/manage/manage-machine.ts`, replace:

```ts
import {
  NOT_FROM_WALLET,
```

with:

```ts
import {
  AIRDROP_NOT_CONFIRMED,
  AIRDROP_TIMED_OUT,
  NOT_FROM_WALLET,
```

In `apps/web/src/components/manage/manage-machine.ts`, replace:

```ts
  PHASE_TIMED_OUT,
  THROWN,
```

with:

```ts
  PHASE_TIMED_OUT,
  SETTINGS_NOT_CONFIRMED,
  SETTINGS_TIMED_OUT,
  THROWN,
```

In `apps/web/src/components/manage/manage-machine.ts`, replace:

```ts
} from '@/lib/art/result'
import type { ManageCall } from '@/lib/manage/phase-calls'
```

with:

```ts
} from '@/lib/art/result'
import type { AirdropJob, BatchEntry } from '@/lib/manage/airdrop-types'
import {
  AIRDROP_MAX_PER_ADDRESS,
  AIRDROP_MAX_RECIPIENTS,
  AIRDROP_MAX_TOKENS,
  BURN_ADDRESS,
  tokensOf,
} from '@/lib/manage/airdrop-view'
import type { ManageCall } from '@/lib/manage/phase-calls'
```

In `apps/web/src/components/manage/manage-machine.ts`, replace:

```ts
  addId?: number
}
```

with:

```ts
  addId?: number
  /** The chain's native symbol, so a refused change names its amounts in it (an airdrop's fee). */
  nativeSymbol?: string
}
```

In `apps/web/src/components/manage/manage-machine.ts`, replace:

```ts
 * change's, and a whitelist chunk's (docs/specs/2026-10-15-whitelist.md, section 7.1).
```

with:

```ts
 * change's, a whitelist chunk's (docs/specs/2026-10-15-whitelist.md, section 7.1), an airdrop batch's and a
 * Settings change's (docs/specs/2026-10-15-airdrop-settings.md, section 7.1).
```

In `apps/web/src/components/manage/manage-machine.ts`, replace:

```ts
  [WHITELIST_NOT_CONFIRMED, WHITELIST_TIMED_OUT],
])
```

with:

```ts
  [WHITELIST_NOT_CONFIRMED, WHITELIST_TIMED_OUT],
  [AIRDROP_NOT_CONFIRMED, AIRDROP_TIMED_OUT],
  [SETTINGS_NOT_CONFIRMED, SETTINGS_TIMED_OUT],
])
```

In `apps/web/src/components/manage/manage-machine.ts`, replace:

```ts
        dispatch({ type: 'failed', failure: classifyError(error, 'switching', 'manage') })
```

with:

```ts
        dispatch({ type: 'failed', failure: classifyError(error, 'switching', 'manage', input.nativeSymbol) })
```

In `apps/web/src/components/manage/manage-machine.ts`, replace:

```ts
      dispatch({ type: 'failed', failure: classifyError(error, 'simulating', 'manage') })
```

with:

```ts
      dispatch({ type: 'failed', failure: classifyError(error, 'simulating', 'manage', input.nativeSymbol) })
```

In `apps/web/src/components/manage/manage-machine.ts`, replace:

```ts
      dispatch({ type: 'failed', failure: classifyError(error, 'wallet', 'manage') })
```

with:

```ts
      dispatch({ type: 'failed', failure: classifyError(error, 'wallet', 'manage', input.nativeSymbol) })
```

In `apps/web/src/components/manage/manage-machine.ts`, replace:

```ts
        failure: { ...classifyError(error, 'confirming', 'manage'), kind: 'unconfirmed' },
```

with:

```ts
        failure: { ...classifyError(error, 'confirming', 'manage', input.nativeSymbol), kind: 'unconfirmed' },
```

At the end of `apps/web/src/components/manage/manage-machine.ts`, append:

```ts

const airdropKeyFor = (collectionId: string) => `cobweb-airdrop:${collectionId}`

/**
 * Keeps the airdrop or burn in progress for the collection, one job per collection
 * (docs/specs/2026-10-15-airdrop-settings.md, section 7.1): the frozen batches, how many landed, and the hash of
 * the one sent but not confirmed.
 */
export function rememberAirdropJob(store: KeyStore | null, collectionId: string, job: AirdropJob): void {
  try {
    store?.setItem(airdropKeyFor(collectionId), JSON.stringify(job))
  } catch {
    // Storage blocked or full: the job is kept for this visit only.
  }
}

/** A stored recipient: a checksummed address with 1 to 1,000 tokens, or null. */
function batchEntryOf(value: unknown): BatchEntry | null {
  const entry = value as { address?: unknown; amount?: unknown } | null
  if (typeof entry?.address !== 'string' || !isAddress(entry.address)) return null
  if (entry.address !== getAddress(entry.address)) return null
  const amount = entry.amount
  if (
    typeof amount !== 'number' ||
    !Number.isInteger(amount) ||
    amount < 1 ||
    amount > AIRDROP_MAX_PER_ADDRESS
  )
    return null
  return { address: entry.address, amount }
}

/**
 * The airdrop or burn this browser has in progress for the collection, or null. A stored value reads as none
 * unless every batch holds 1 to 500 recipients and at most 1,000 tokens, `sent` names a batch, the pending hash
 * is 32 bytes, and a burn is one batch of one entry to the dead address with its hash.
 */
export function airdropJob(store: KeyStore | null, collectionId: string): AirdropJob | null {
  try {
    const value = store?.getItem(airdropKeyFor(collectionId)) ?? null
    if (!value) return null
    const parsed = JSON.parse(value) as {
      kind?: unknown
      batches?: unknown
      sent?: unknown
      pending?: unknown
    }
    if (parsed.kind !== 'airdrop' && parsed.kind !== 'burn') return null
    if (!Array.isArray(parsed.batches) || parsed.batches.length === 0) return null
    const batches: BatchEntry[][] = []
    for (const stored of parsed.batches as unknown[]) {
      if (!Array.isArray(stored) || stored.length === 0 || stored.length > AIRDROP_MAX_RECIPIENTS) return null
      const entries = stored.map(batchEntryOf)
      if (entries.some((entry) => entry === null)) return null
      const batch = entries as BatchEntry[]
      if (tokensOf(batch) > AIRDROP_MAX_TOKENS) return null
      batches.push(batch)
    }
    const { sent, pending } = parsed
    if (typeof sent !== 'number' || !Number.isInteger(sent) || sent < 0 || sent >= batches.length) return null
    if (pending !== null && (typeof pending !== 'string' || !HASH_RE.test(pending))) return null
    const [first] = batches
    if (
      parsed.kind === 'burn' &&
      (batches.length !== 1 || first?.length !== 1 || first[0]?.address !== BURN_ADDRESS || pending === null)
    )
      return null
    return { kind: parsed.kind, batches, sent, pending: pending as Hex | null }
  } catch {
    return null
  }
}

export function forgetAirdropJob(store: KeyStore | null, collectionId: string): void {
  try {
    store?.removeItem(airdropKeyFor(collectionId))
  } catch {
    // Storage blocked: nothing was kept.
  }
}
```

- [ ] **Step 4: The job, the bound servers and the dialog**

Create `apps/web/src/components/manage/airdrop-job.ts`:

```ts
import type { Hex } from 'viem'
import type { AirdropJob } from '@/lib/manage/airdrop-types'
import { batchesOf, BURN_ADDRESS, tokensOf } from '@/lib/manage/airdrop-view'
import type { Recipient } from './recipients'

/**
 * The airdrop in progress, pure (docs/specs/2026-10-15-airdrop-settings.md, section 7.2): the list frozen into its
 * batches at the first send, a burn kept only while its hash is pending, and the job after a batch is sent or
 * confirmed. The screen holds it and the store keeps it across a reload (manage-machine.ts).
 */

/** The list frozen into its batches, in its order, none sent yet. */
export function frozenJob(rows: readonly Recipient[]): AirdropJob {
  return { kind: 'airdrop', batches: batchesOf(rows), sent: 0, pending: null }
}

/** A burn sent and not confirmed yet: one batch of one entry to the dead address, with its hash. */
export function burnJob(amount: number, hash: Hex): AirdropJob {
  return { kind: 'burn', batches: [[{ address: BURN_ADDRESS, amount }]], sent: 0, pending: hash }
}

/** The job with the current batch's hash pending, or forgotten; a burn without its hash is no job. */
export function withPending(job: AirdropJob, hash: Hex | null): AirdropJob | null {
  if (job.kind === 'burn' && hash === null) return null
  return { ...job, pending: hash }
}

/** The job once its current batch is confirmed: on to the next, no hash; no job after the last batch. */
export function withConfirmed(job: AirdropJob): AirdropJob | null {
  const sent = job.sent + 1
  return sent >= job.batches.length ? null : { ...job, sent, pending: null }
}

/** The tokens of the batches not confirmed yet, the pending one included. */
export function unsentTokens(job: AirdropJob): number {
  return job.batches.slice(job.sent).reduce((sum, batch) => sum + tokensOf(batch), 0)
}
```

Create `apps/web/src/components/manage/airdrop-server.ts`:

```ts
import type { Hex } from 'viem'
import { confirmAirdrop, getAirdrop } from '@/app/actions/airdrop'
import type { ActionResult } from '@/lib/art/result'
import type { AirdropView } from '@/lib/manage/airdrop-types'

/**
 * Airdrop's server, bound to one collection (docs/specs/2026-10-15-airdrop-settings.md, section 7.2): the two
 * actions in one object, which `sampleAirdropServer` (airdrop-sim.ts) mirrors in sample mode. A confirm sends
 * the hash alone.
 */
export type AirdropServer = {
  read(): Promise<ActionResult<AirdropView>>
  confirm(hash: Hex): Promise<ActionResult<AirdropView>>
}

export function airdropServer(collectionId: string): AirdropServer {
  return {
    read: () => getAirdrop(collectionId),
    confirm: (hash) => confirmAirdrop(collectionId, hash),
  }
}
```

Create `apps/web/src/components/manage/settings-server.ts`:

```ts
import type { Hex } from 'viem'
import { confirmSettingsTx, getSettings } from '@/app/actions/settings'
import type { ActionResult } from '@/lib/art/result'
import { sentOf, type ManageCall } from '@/lib/manage/phase-calls'
import type { SettingsView } from '@/lib/manage/settings-types'

/**
 * Settings' server, bound to one collection (docs/specs/2026-10-15-airdrop-settings.md, section 7.2): the two
 * actions in one object, which `sampleSettingsServer` (settings-sim.ts) mirrors in sample mode. A confirm sends
 * the hash and the call as `sentOf` writes it.
 */
export type SettingsServer = {
  read(): Promise<ActionResult<SettingsView>>
  confirm(hash: Hex, call: ManageCall): Promise<ActionResult<SettingsView>>
}

export function settingsServer(collectionId: string): SettingsServer {
  return {
    read: () => getSettings(collectionId),
    confirm: (hash, call) => confirmSettingsTx(collectionId, hash, sentOf(call)),
  }
}
```

In `apps/web/src/components/manage/transaction-dialog.tsx`, replace:

```tsx
  destructive?: boolean
  chain: SupportedChain
```

with:

```tsx
  destructive?: boolean
  /**
   * Why nothing can be sent from this wallet (the owner check, docs/specs/2026-10-15-airdrop-settings.md, section
   * 7.1): shown under the review, with the action off. The dialog still opens, so the change can be read.
   */
  blocked?: string | null
  chain: SupportedChain
```

In `apps/web/src/components/manage/transaction-dialog.tsx`, replace:

```tsx
  destructive,
  chain,
```

with:

```tsx
  destructive,
  blocked = null,
  chain,
```

In `apps/web/src/components/manage/transaction-dialog.tsx`, replace:

```tsx
          addId: call?.functionName === 'registerMintGroup' ? Number(call.args[0]) : undefined,
        },
```

with:

```tsx
          addId: call?.functionName === 'registerMintGroup' ? Number(call.args[0]) : undefined,
          nativeSymbol: chain.nativeSymbol,
        },
```

In `apps/web/src/components/manage/transaction-dialog.tsx`, replace:

```tsx
    if (request && phase.step === 'idle') void start()
```

with:

```tsx
    if (request && !blocked && phase.step === 'idle') void start()
```

In `apps/web/src/components/manage/transaction-dialog.tsx`, replace:

```tsx
      detail: sample
        ? 'Answer for your wallet below.'
        : 'Your wallet shows a call to the collection contract and the gas for it.',
```

with:

```tsx
      detail: sample ? 'Answer for your wallet below.' : walletDetail(request, chain),
```

In `apps/web/src/components/manage/transaction-dialog.tsx`, replace:

```tsx
              {request && <CallReview request={request.review} chain={chain} />}
            </>
```

with:

```tsx
              {request && <CallReview request={request.review} chain={chain} />}
              {blocked && <p className="text-muted-foreground text-[0.8125rem]">{blocked}</p>}
            </>
```

In `apps/web/src/components/manage/transaction-dialog.tsx`, replace:

```tsx
                <Button type="submit" variant={destructive ? 'destructive' : 'default'} disabled={!request}>
```

with:

```tsx
                <Button
                  type="submit"
                  variant={destructive ? 'destructive' : 'default'}
                  disabled={!request || !!blocked}
                >
```

In `apps/web/src/components/manage/transaction-dialog.tsx`, replace:

```tsx
    </Dialog>
  )
}
```

with:

```tsx
    </Dialog>
  )
}

/**
 * What the wallet shows at its step: a call to the review's contract and the gas, or, for a call that sends a value
 * (an airdrop's fee), that value too.
 */
function walletDetail(request: ManageRequest<unknown> | null, chain: SupportedChain): string {
  const value = request?.call?.value
  if (value !== undefined)
    return `Your wallet shows a call to the collection contract, the ${formatNative(value, chain.nativeSymbol, 18)} sent with it, and the gas for it.`
  return `Your wallet shows a call to the ${(request?.review.contract ?? 'Collection').toLowerCase()} contract and the gas for it.`
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `pnpm --filter @cobweb/web exec vitest run src/components/manage/manage-machine.test.ts src/components/manage/airdrop-job.test.ts`
Expected: PASS, 2 files and 38 tests.

- [ ] **Step 6: Format, run the root checks and commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
pnpm exec prettier --write apps/web/src/components/manage/manage-machine.ts apps/web/src/components/manage/manage-machine.test.ts apps/web/src/components/manage/airdrop-job.ts apps/web/src/components/manage/airdrop-job.test.ts apps/web/src/components/manage/airdrop-server.ts apps/web/src/components/manage/settings-server.ts apps/web/src/components/manage/transaction-dialog.tsx
pnpm typecheck && pnpm lint && pnpm test
git add apps/web/src/components/manage/manage-machine.ts apps/web/src/components/manage/manage-machine.test.ts apps/web/src/components/manage/airdrop-job.ts apps/web/src/components/manage/airdrop-job.test.ts apps/web/src/components/manage/airdrop-server.ts apps/web/src/components/manage/settings-server.ts apps/web/src/components/manage/transaction-dialog.tsx
git commit -m "$(cat <<'EOF'
Teach the manage machine an airdrop batch's and a setting's pending answers and the chain's symbol, keep the airdrop job in the browser, bind the Airdrop and Settings servers, and let the dialog open blocked for a wallet that is not the owner

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: the web package reports 687 tests in 72 files (678 before, plus 9).

---

### Task 7: Sample mode on the same code: the Airdrop and Settings samples and the new calls on the sample actions

**Files:**

- Modify: `apps/web/src/components/manage/manage-sim.ts`, `apps/web/src/components/manage/manage-sim.test.ts`
- Create: `apps/web/src/components/manage/airdrop-sim.ts`, `apps/web/src/components/manage/airdrop-sim.test.ts`
- Create: `apps/web/src/components/manage/settings-sim.ts`, `apps/web/src/components/manage/settings-sim.test.ts`
- Test: the three test files above

**Interfaces:**

- Consumes: in `manage-sim.ts`, `sampleRevert(call, view)`, `sampleApply(call, view, add?)`, `sampleManageActions(current, sent?)`, `samplePhasesView(collection)`, `revert(functionName, data)` (all already there); from `@/lib/demo`, `DEMO_AIRDROPS`, `DEMO_ACTIVITY`, `DEMO_COLLECTION`, `DEMO_CREATOR`, `DEMO_DEPLOYMENT`, `DEMO_NOW`, `DEMO_PLACEHOLDER`, `DEMO_PUBLIC_MAX_PER_WALLET`, `DEMO_RENDER_JOBS`, `sampleAddress(seed)`, `sampleSupply(maxSupply, fallback)`, `sampleTxHash(seed)`, `scaleSampleToSupply`; `DEFAULT_TRANSFER_VALIDATOR` (Task 1); from Task 3, `airdropViewOf`, `BURN_ADDRESS`, `pointerOf`, `settingsViewOf`, `TRANSFER_LEVELS` and the types; `airdropCalls`, `ManageCall` (Task 4); `AirdropServer`, `SettingsServer` (Task 6); `airdropJob(store, id)` (Task 6, for the test that the store keeps the sample job).
- Produces:
  - in `manage-sim.ts`: `sampleRevert(call, view, settings?: SettingsView)` refuses `airdropNFTs` with unequal lengths (`ArrayLengthMismatch`) or more tokens than are left (`ExceedsMaxSupply(requested, available)`) and `withdrawMintFunds` at a balance of '0' (`NothingToWithdraw`); `sampleApply` leaves the phases view as it is for the new calls; `sampleManageActions(current, sent?, settings?: () => SettingsView)`
  - in `airdrop-sim.ts`: `sampleAirdropView(collection: { max_supply: number | null }, wallet: Address, options?: { chainReachable?: boolean; owner?: Address }): AirdropView` (Base, a fee of 0.00005 ETH a token, the two sample records newest first), `sampleApplyAirdrop(call, view, hash): AirdropView` (a batch recorded once after the minted ids, a burn as a burn), `sampleAirdropServer(current, sent?): AirdropServer` (900 ms; a hash it never sent confirms the first unsent batch of the sample job), `sampleAirdropJob(): AirdropJob` (two batches, the first pending with `sampleTxHash(40)`)
  - in `settings-sim.ts`: `sampleSettingsView(collection, wallet, options?: { chainReachable?: boolean; owner?: Address; art?: string }): SettingsView` (`art` 'deferred' has no real job, 'revealed' points at the rendered metadata), `sampleApplySettings(call, view): SettingsView`, `sampleSettingsServer(current): SettingsServer` (900 ms)

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/components/manage/manage-sim.test.ts`, replace:

```ts
import { phaseCalls, type ManageCall } from '@/lib/manage/phase-calls'
```

with:

```ts
import { airdropCalls, phaseCalls, settingsCalls, type ManageCall } from '@/lib/manage/phase-calls'
```

In `apps/web/src/components/manage/manage-sim.test.ts`, replace:

```ts
  sampleRevert,
} from './manage-sim'

const view: PhasesView = samplePhasesView({ max_supply: DEMO_COLLECTION.maxSupply })
```

with:

```ts
  sampleRevert,
} from './manage-sim'
import { sampleSettingsView } from './settings-sim'

const view: PhasesView = samplePhasesView({ max_supply: DEMO_COLLECTION.maxSupply })
```

At the end of `apps/web/src/components/manage/manage-sim.test.ts`, append:

```ts

describe('Airdrop and Settings on the sample (docs/specs/2026-10-15-airdrop-settings.md, section 8)', () => {
  const A: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
  const settings = sampleSettingsView({ max_supply: DEMO_COLLECTION.maxSupply }, A)
  const sentence = (call: ManageCall, settingsView?: typeof settings) => {
    const refused = sampleRevert(call, view, settingsView)
    return refused ? classifyError(refused, 'simulating', 'manage').message : null
  }

  it('refuses unequal lengths and more tokens than are left, as the contract would', () => {
    const left = view.maxSupply - view.totalMinted
    expect(sentence({ functionName: 'airdropNFTs', args: [[A], [1n, 2n]], value: 0n })).toBe(
      'The addresses and amounts do not line up. Reload and try again. Nothing was sent.',
    )
    expect(sentence(airdropCalls.batch([{ address: A, amount: left + 1 }], '0'))).toBe(
      `Only ${left.toLocaleString('en-US')} tokens are left to mint, not ${(left + 1).toLocaleString('en-US')}. Nothing was sent.`,
    )
    expect(sampleRevert(airdropCalls.batch([{ address: A, amount: left }], '0'), view)).toBeNull()
  })

  it('refuses a withdrawal at a balance of 0 on the Settings view, and lets it through with a balance', () => {
    expect(sentence(settingsCalls.withdraw(), { ...settings, creatorBalanceWei: '0' })).toBe(
      'There is nothing to withdraw: the balance is 0. Nothing was sent.',
    )
    expect(sentence(settingsCalls.withdraw(), settings)).toBeNull()
    expect(sentence(settingsCalls.withdraw())).toBeNull()
  })

  it('changes no group of the phases view', () => {
    for (const call of [
      airdropCalls.burn(1, '0'),
      settingsCalls.withdraw(),
      settingsCalls.mintOnBehalf(true),
    ])
      expect(sampleApply(call, view)).toEqual(view)
  })

  it('checks a withdrawal against the Settings view the actions are given', async () => {
    vi.useFakeTimers()
    const actions = sampleManageActions(
      () => view,
      new Map(),
      () => ({ ...settings, creatorBalanceWei: '0' }),
    )
    const refused = actions.simulate(settingsCalls.withdraw())
    const expectation = expect(refused).rejects.toMatchObject({ name: 'ContractFunctionRevertedError' })
    await vi.advanceTimersByTimeAsync(650)
    await expectation
    vi.useRealTimers()
  })
})
```

Create `apps/web/src/components/manage/airdrop-sim.test.ts`:

```ts
import { getAddress, type Address, type Hex } from 'viem'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KeyStore } from '@/components/deploy/deploy-machine'
import { DEMO_COLLECTION, DEMO_MINTER, DEMO_TOTAL_MINTED, sampleTxHash } from '@/lib/demo'
import type { AirdropView } from '@/lib/manage/airdrop-types'
import { tokensOf } from '@/lib/manage/airdrop-view'
import { airdropCalls, type ManageCall } from '@/lib/manage/phase-calls'
import { airdropJob, rememberAirdropJob } from './manage-machine'
import { sampleAirdropJob, sampleAirdropServer, sampleAirdropView, sampleApplyAirdrop } from './airdrop-sim'

const WALLET: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const A: Address = '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65'
const B: Address = '0x90F79bf6EB2c4f870365E785982E1f101E93b906'
const HASH: Hex = `0x${'cd'.repeat(32)}`
const view: AirdropView = sampleAirdropView({ max_supply: DEMO_COLLECTION.maxSupply }, WALLET)

describe('sampleAirdropView', () => {
  it("reads Base's sample: the fee of 0.00005 ETH, the sample's supply and minted, the two records newest first", () => {
    expect(view).toMatchObject({
      chainId: 8453,
      owner: WALLET,
      feePerTokenWei: '50000000000000',
      maxSupply: DEMO_COLLECTION.maxSupply,
      totalMinted: DEMO_TOTAL_MINTED,
      left: DEMO_COLLECTION.maxSupply - DEMO_TOTAL_MINTED,
      chainReachable: true,
    })
    expect(
      view.history.map((row) => [row.kind, row.recipients, row.tokens, row.firstTokenId, row.block]),
    ).toEqual([
      ['burn', 1, 2, 11, 21_499_995],
      ['airdrop', 4, 10, 1, 21_499_990],
    ])
  })

  it('names another owner for ?owner=other, and keeps the records alone for ?chain=unreachable', () => {
    expect(sampleAirdropView({ max_supply: 100 }, WALLET, { owner: DEMO_MINTER }).owner).toBe(DEMO_MINTER)
    const copy = sampleAirdropView({ max_supply: 100 }, WALLET, { chainReachable: false })
    expect(copy).toMatchObject({
      owner: null,
      feePerTokenWei: null,
      totalMinted: null,
      left: null,
      maxSupply: 100,
      chainReachable: false,
    })
    expect(copy.history).toHaveLength(2)
  })
})

describe('sampleApplyAirdrop', () => {
  it('records a batch after the minted ids with its fee, the next block and its kind, once', () => {
    const call = airdropCalls.batch(
      [
        { address: A, amount: 2 },
        { address: B, amount: 1 },
      ],
      view.feePerTokenWei ?? '0',
    )
    const after = sampleApplyAirdrop(call, view, HASH)
    expect(after.history[0]).toEqual({
      txHash: HASH,
      kind: 'airdrop',
      recipients: 2,
      tokens: 3,
      feePaidWei: '150000000000000',
      firstTokenId: DEMO_TOTAL_MINTED + 1,
      lastTokenId: DEMO_TOTAL_MINTED + 3,
      block: 21_499_996,
      confirmedAt: view.readAt,
    })
    expect(after).toMatchObject({ totalMinted: DEMO_TOTAL_MINTED + 3, left: (view.left ?? 0) - 3 })
    expect(sampleApplyAirdrop(call, after, HASH)).toBe(after)
  })

  it('records a burn to the dead address as a burn', () => {
    expect(sampleApplyAirdrop(airdropCalls.burn(2, '0'), view, HASH).history[0]).toMatchObject({
      kind: 'burn',
      recipients: 1,
      tokens: 2,
    })
  })
})

describe('sampleAirdropJob', () => {
  it('is two batches, 2 wallets with 3 tokens then 1 wallet with 1, the first pending, and a job the store keeps', () => {
    const job = sampleAirdropJob()
    expect(job.batches.map((batch) => [batch.length, tokensOf(batch)])).toEqual([
      [2, 3],
      [1, 1],
    ])
    expect(job).toMatchObject({ kind: 'airdrop', sent: 0, pending: sampleTxHash(40) })
    const map = new Map<string, string>()
    const store: KeyStore = {
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => {
        map.set(key, value)
      },
      removeItem: (key) => {
        map.delete(key)
      },
    }
    rememberAirdropJob(store, 'col-1', job)
    expect(airdropJob(store, 'col-1')).toEqual(job)
    expect(job.batches.flat().every((entry) => entry.address === getAddress(entry.address))).toBe(true)
  })
})

describe('sampleAirdropServer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('confirms the call the wallet sent after 900 ms, and the first unsent batch of the sample job for a hash it never sent', async () => {
    const sent = new Map<Hex, ManageCall>([[HASH, airdropCalls.burn(1, '0')]])
    const server = sampleAirdropServer(() => view, sent)
    const newest = async (answer: ReturnType<typeof server.confirm>) => {
      await vi.advanceTimersByTimeAsync(900)
      const result = await answer
      return result.ok ? result.data.history[0] : result.error
    }
    expect(await newest(server.confirm(HASH))).toMatchObject({ txHash: HASH, kind: 'burn', tokens: 1 })
    expect(await newest(server.confirm(sampleTxHash(40)))).toMatchObject({
      txHash: sampleTxHash(40),
      kind: 'airdrop',
      recipients: 2,
      tokens: 3,
    })
  })
})
```

Create `apps/web/src/components/manage/settings-sim.test.ts`:

```ts
import { DEFAULT_TRANSFER_VALIDATOR } from '@cobweb/shared'
import { getAddress, zeroAddress, type Address, type Hex } from 'viem'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEMO_ACTIVITY, DEMO_DEPLOYMENT, DEMO_MINTER, DEMO_PLACEHOLDER, DEMO_RENDER_JOBS } from '@/lib/demo'
import { settingsCalls } from '@/lib/manage/phase-calls'
import type { SettingsView } from '@/lib/manage/settings-types'
import { sampleApplySettings, sampleSettingsServer, sampleSettingsView } from './settings-sim'

const WALLET: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const A: Address = '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65'
const HASH: Hex = `0x${'cd'.repeat(32)}`
const REAL = `ipfs://${DEMO_RENDER_JOBS.done.metadataCid}/`
const PLACEHOLDER = `ipfs://${DEMO_PLACEHOLDER.cid}/metadata.json`
const view: SettingsView = sampleSettingsView({ max_supply: null }, WALLET)

describe('sampleSettingsView', () => {
  it("reads Base's sample: the proceeds, the fees, payout and royalty, the placeholder, the default validator", () => {
    expect(view).toMatchObject({
      chainId: 8453,
      owner: WALLET,
      creatorBalanceWei: DEMO_ACTIVITY.proceeds.withdrawableWei,
      platformBalanceWei: DEMO_ACTIVITY.proceeds.platformFeesWei,
      pendingBalanceWei: '0',
      withdrawnWei: DEMO_ACTIVITY.proceeds.withdrawnWei,
      fees: DEMO_DEPLOYMENT.fees,
      payout: getAddress(DEMO_DEPLOYMENT.payoutAddress),
      royaltyBps: 500,
      baseUri: PLACEHOLDER,
      pointer: 'placeholder',
      targets: { real: REAL, placeholder: PLACEHOLDER, start: PLACEHOLDER },
      realArtRendered: true,
      transferValidator: DEFAULT_TRANSFER_VALIDATOR,
      mintOnBehalf: false,
      level: { kind: 'level', level: 0 },
      chainReachable: true,
    })
  })

  it('has no real job for ?art=deferred, reads revealed for ?art=revealed, names ?owner=other, and the copies for ?chain=unreachable', () => {
    expect(sampleSettingsView({ max_supply: null }, WALLET, { art: 'deferred' })).toMatchObject({
      realArtRendered: false,
      pointer: 'placeholder',
    })
    expect(sampleSettingsView({ max_supply: null }, WALLET, { art: 'revealed' })).toMatchObject({
      baseUri: REAL,
      pointer: 'revealed',
    })
    expect(sampleSettingsView({ max_supply: null }, WALLET, { owner: DEMO_MINTER }).owner).toBe(DEMO_MINTER)
    expect(sampleSettingsView({ max_supply: null }, WALLET, { chainReachable: false })).toMatchObject({
      owner: null,
      creatorBalanceWei: null,
      platformBalanceWei: null,
      fees: null,
      level: null,
      payout: getAddress(DEMO_DEPLOYMENT.payoutAddress),
      transferValidator: DEFAULT_TRANSFER_VALIDATOR,
      chainReachable: false,
    })
  })
})

describe('sampleApplySettings', () => {
  it('applies each change as a read after it would show it', () => {
    expect(sampleApplySettings(settingsCalls.withdraw(), view)).toMatchObject({
      creatorBalanceWei: '0',
      withdrawnWei: (
        BigInt(DEMO_ACTIVITY.proceeds.withdrawnWei) + BigInt(DEMO_ACTIVITY.proceeds.withdrawableWei)
      ).toString(),
    })
    expect(sampleApplySettings(settingsCalls.payout(A), view).payout).toBe(A)
    expect(sampleApplySettings(settingsCalls.royalty(A, 750), view)).toMatchObject({
      royaltyReceiver: A,
      royaltyBps: 750,
    })
    expect(sampleApplySettings(settingsCalls.baseUri(REAL), view)).toMatchObject({
      baseUri: REAL,
      pointer: 'revealed',
    })
    expect(sampleApplySettings(settingsCalls.mintOnBehalf(true), view).mintOnBehalf).toBe(true)
    expect(sampleApplySettings(settingsCalls.validator(zeroAddress), view)).toMatchObject({
      transferValidator: zeroAddress,
      level: { kind: 'none', reason: 'zero' },
    })
    expect(sampleApplySettings(settingsCalls.validator(A), view).level).toEqual({ kind: 'level', level: 0 })
    expect(
      sampleApplySettings(settingsCalls.level(DEFAULT_TRANSFER_VALIDATOR, view.contract, 9), view).level,
    ).toEqual({ kind: 'level', level: 9 })
  })
})

describe('sampleSettingsServer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('answers after 900 ms with the call applied', async () => {
    const server = sampleSettingsServer(() => view)
    const confirming = server.confirm(HASH, settingsCalls.mintOnBehalf(true))
    await vi.advanceTimersByTimeAsync(900)
    expect(await confirming).toMatchObject({ ok: true, data: { mintOnBehalf: true } })
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @cobweb/web exec vitest run src/components/manage/manage-sim.test.ts src/components/manage/airdrop-sim.test.ts src/components/manage/settings-sim.test.ts`
Expected: FAIL. The three files fail to load: `airdrop-sim.test.ts` with `Cannot find module './airdrop-sim'`, `settings-sim.test.ts` and `manage-sim.test.ts` (which now imports the Settings sample) with `Cannot find module './settings-sim'`. The run ends `Test Files  3 failed (3)` with no tests run.

- [ ] **Step 3: The new calls on the sample actions**

In `apps/web/src/components/manage/manage-sim.ts`, replace:

```ts
import type { PhaseAdd, PhasesView } from '@/lib/manage/phases-types'
import type { ManageActions, ManageRequest, TxRequest } from './manage-actions'
```

with:

```ts
import type { PhaseAdd, PhasesView } from '@/lib/manage/phases-types'
import type { SettingsView } from '@/lib/manage/settings-types'
import type { ManageActions, ManageRequest, TxRequest } from './manage-actions'
```

In `apps/web/src/components/manage/manage-sim.ts`, replace:

```ts
 * collection's group checks (an unknown group, an id taken, below minted, the allocations over the supply) and
 * of `setMintQuota`'s (unequal lengths, the public sale, an unknown group).
 */
export function sampleRevert(call: ManageCall, view: PhasesView): ContractFunctionRevertedError | null {
```

with:

```ts
 * collection's group checks (an unknown group, an id taken, below minted, the allocations over the supply), of
 * `setMintQuota`'s (unequal lengths, the public sale, an unknown group), of `airdropNFTs`' (unequal lengths, more
 * tokens than are left) and of `withdrawMintFunds`' (nothing to withdraw, on the Settings view when given).
 */
export function sampleRevert(
  call: ManageCall,
  view: PhasesView,
  settings?: SettingsView,
): ContractFunctionRevertedError | null {
```

In `apps/web/src/components/manage/manage-sim.ts`, replace:

```ts
    }
    default:
```

with:

```ts
    }
    case 'airdropNFTs': {
      const [recipients, amounts] = call.args
      if (recipients.length !== amounts.length)
        return revert(
          call.functionName,
          encodeErrorResult({ abi: collectionAbi, errorName: 'ArrayLengthMismatch' }),
        )
      const total = amounts.reduce((sum, amount) => sum + amount, 0n)
      const available = BigInt(Math.max(0, view.maxSupply - view.totalMinted))
      return total > available
        ? revert(
            call.functionName,
            encodeErrorResult({
              abi: collectionAbi,
              errorName: 'ExceedsMaxSupply',
              args: [total, available],
            }),
          )
        : null
    }
    case 'withdrawMintFunds':
      return settings?.creatorBalanceWei === '0'
        ? revert(call.functionName, encodeErrorResult({ abi: collectionAbi, errorName: 'NothingToWithdraw' }))
        : null
    default:
```

In `apps/web/src/components/manage/manage-sim.ts`, replace:

```ts
      // A phases view holds no quotas: the Whitelist's sample server applies them (whitelist-sim.ts).
```

with:

```ts
    case 'airdropNFTs':
    case 'withdrawMintFunds':
    case 'setOwnerPayoutAddress':
    case 'setDefaultRoyalty':
    case 'setBaseURI':
    case 'setMintOnBehalfStatus':
    case 'setTransferValidator':
    case 'setTransferSecurityLevelOfCollection':
      // A phases view holds none of these: the Whitelist's, Airdrop's and Settings' sample servers apply them
      // (whitelist-sim.ts, airdrop-sim.ts, settings-sim.ts).
```

In `apps/web/src/components/manage/manage-sim.ts`, replace:

```ts
 * The sample actions. `simulate` waits 650 ms and refuses as the contract would on the current view;
 * the send waits for the simulated wallet's `answer`; `wait` takes 1.6 seconds. `sent` remembers each
 * sent call by its hash, so the sample server applies exactly what was signed.
```

with:

```ts
 * The sample actions. `simulate` waits 650 ms and refuses as the contract would on the current view (and, for a
 * withdrawal, the current Settings view when `settings` is given); the send waits for the simulated wallet's
 * `answer`; `wait` takes 1.6 seconds. `sent` remembers each sent call by its hash, so the sample server applies
 * exactly what was signed.
```

In `apps/web/src/components/manage/manage-sim.ts`, replace:

```ts
  sent: Map<Hex, ManageCall> = new Map(),
): ManageActions {
```

with:

```ts
  sent: Map<Hex, ManageCall> = new Map(),
  settings?: () => SettingsView,
): ManageActions {
```

In `apps/web/src/components/manage/manage-sim.ts`, replace:

```ts
      const refused = sampleRevert(call, current())
```

with:

```ts
      const refused = sampleRevert(call, current(), settings?.())
```

- [ ] **Step 4: The Airdrop and Settings samples**

Decision (section 8): `sampleAirdropJob()` takes no view: the waiting batch comes from the sample's own wallets, and a parameter it never read would fail `no-unused-vars`.

Create `apps/web/src/components/manage/airdrop-sim.ts`:

```ts
/**
 * Sample mode for Airdrop (docs/specs/2026-10-15-airdrop-settings.md, section 8). Nothing here talks to a wallet,
 * an RPC or the database: `sampleAirdropServer` has the shape of `airdropServer` (airdrop-server.ts), and its
 * confirm applies exactly the call the simulated wallet sent, as `airdrop_record` would record it, so the screen
 * runs the same code in both modes.
 */
import { getAddress, type Address, type Hex } from 'viem'
import type { ActionResult } from '@/lib/art/result'
import {
  DEMO_AIRDROPS,
  DEMO_COLLECTION,
  DEMO_DEPLOYMENT,
  DEMO_NOW,
  sampleAddress,
  sampleSupply,
  sampleTxHash,
  scaleSampleToSupply,
} from '@/lib/demo'
import type { AirdropJob, AirdropRow, AirdropView } from '@/lib/manage/airdrop-types'
import { airdropViewOf, BURN_ADDRESS } from '@/lib/manage/airdrop-view'
import { airdropCalls, type ManageCall } from '@/lib/manage/phase-calls'
import type { AirdropServer } from './airdrop-server'

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** The blocks the sample's two records landed in, in the order `DEMO_AIRDROPS` lists them. */
const SAMPLE_BLOCKS = [21_499_990, 21_499_995]

/** The sample's records as `airdropViewCore` reads them: newest first, ids from the first one on. */
function sampleHistory(): AirdropRow[] {
  return DEMO_AIRDROPS.map((record, index): AirdropRow => {
    const first = record.firstTokenId ?? 1
    return {
      txHash: record.txHash,
      kind: record.burn ? 'burn' : 'airdrop',
      recipients: record.recipients,
      tokens: record.tokens,
      feePaidWei: record.feePaidWei,
      firstTokenId: first,
      lastTokenId: first + record.tokens - 1,
      block: SAMPLE_BLOCKS[index] ?? 0,
      confirmedAt: record.at,
    }
  }).reverse()
}

/**
 * The Base sample: the contract's airdrop fee of 0.00005 ETH a token, the sample's supply and minted count scaled
 * to the collection's supply, the two sample records (10 tokens to 4 wallets, then a burn of 2), and the session
 * wallet as the owner unless `owner` names another (`?owner=other`). With `chainReachable` false, the record alone,
 * as the core builds it (`?chain=unreachable`).
 */
export function sampleAirdropView(
  collection: { max_supply: number | null },
  wallet: Address,
  options: { chainReachable?: boolean; owner?: Address } = {},
): AirdropView {
  const maxSupply = sampleSupply(collection.max_supply, DEMO_COLLECTION.maxSupply)
  const base = {
    chainId: DEMO_DEPLOYMENT.chainId,
    contract: DEMO_DEPLOYMENT.contractAddress,
    maxSupply,
    readAt: DEMO_NOW,
  }
  if (options.chainReachable === false) return airdropViewOf(base, sampleHistory(), null)
  return airdropViewOf(base, sampleHistory(), {
    block: 21_500_000n,
    blockTimestamp: DEMO_NOW,
    maxSupply,
    totalMinted: scaleSampleToSupply(maxSupply).totalMinted,
    feePerTokenWei: DEMO_DEPLOYMENT.fees.airdropFeePerTokenWei,
    owner: options.owner ?? wallet,
  })
}

/**
 * The view after an `airdropNFTs` lands, as `airdrop_record` records it: a row with ids after the minted total, the
 * fee times its tokens, the next block and its kind from the recipients, newest first, and its tokens minted. A hash
 * already listed changes nothing.
 */
export function sampleApplyAirdrop(call: ManageCall, view: AirdropView, hash: Hex): AirdropView {
  const txHash = hash.toLowerCase() as Hex
  if (call.functionName !== 'airdropNFTs' || view.history.some((row) => row.txHash === txHash)) return view
  const [recipients, amounts] = call.args
  const tokens = Number(amounts.reduce((sum, amount) => sum + amount, 0n))
  const minted = view.totalMinted ?? 0
  const [only] = recipients
  const row: AirdropRow = {
    txHash,
    kind: recipients.length === 1 && only?.toLowerCase() === BURN_ADDRESS.toLowerCase() ? 'burn' : 'airdrop',
    recipients: recipients.length,
    tokens,
    feePaidWei: (BigInt(view.feePerTokenWei ?? '0') * BigInt(tokens)).toString(),
    firstTokenId: minted + 1,
    lastTokenId: minted + tokens,
    block: Math.max(0, ...view.history.map((entry) => entry.block)) + 1,
    confirmedAt: view.readAt,
  }
  const totalMinted = minted + tokens
  return {
    ...view,
    history: [row, ...view.history],
    totalMinted,
    left: Math.max(0, view.maxSupply - totalMinted),
  }
}

/**
 * The sample server: every answer takes 900 ms. A confirm applies the call the simulated wallet sent with that
 * hash, or, for a hash it never sent (`?batch=pending`), the first unsent batch of `sampleAirdropJob`.
 */
export function sampleAirdropServer(
  current: () => AirdropView,
  sent: Map<Hex, ManageCall> = new Map(),
): AirdropServer {
  const answer = async <T>(data: () => T): Promise<ActionResult<T>> => {
    await wait(900)
    return { ok: true, data: data() }
  }
  return {
    read: () => answer(current),
    confirm: (hash) =>
      answer(() => {
        const view = current()
        const job = sampleAirdropJob()
        const call =
          sent.get(hash) ?? airdropCalls.batch(job.batches[job.sent] ?? [], view.feePerTokenWei ?? '0')
        return sampleApplyAirdrop(call, view, hash)
      }),
  }
}

/**
 * The job `?batch=pending` shows: two batches frozen from a sample list (2 wallets with 3 tokens, then 1 wallet with
 * 1 token), the first sent with `sampleTxHash(40)` and not confirmed yet.
 */
export function sampleAirdropJob(): AirdropJob {
  const wallet = (seed: number) => getAddress(sampleAddress(seed))
  const batches = [
    [
      { address: wallet(700), amount: 2 },
      { address: wallet(701), amount: 1 },
    ],
    [{ address: wallet(702), amount: 1 }],
  ]
  return { kind: 'airdrop', batches, sent: 0, pending: sampleTxHash(40) }
}
```

Create `apps/web/src/components/manage/settings-sim.ts`:

```ts
/**
 * Sample mode for Settings and the Overview's pointer and proceeds (docs/specs/2026-10-15-airdrop-settings.md,
 * section 8). Nothing here talks to a wallet, an RPC or the database: `sampleSettingsServer` has the shape of
 * `settingsServer` (settings-server.ts), and its confirm applies the call as the chain would and a read would show
 * it, so the screens run the same code in both modes.
 */
import { DEFAULT_TRANSFER_VALIDATOR } from '@cobweb/shared'
import { getAddress, zeroAddress, type Address } from 'viem'
import type { ActionResult } from '@/lib/art/result'
import type { PreparedArgs } from '@/lib/deploy/deploy-types'
import {
  DEMO_ACTIVITY,
  DEMO_COLLECTION,
  DEMO_CREATOR,
  DEMO_DEPLOYMENT,
  DEMO_NOW,
  DEMO_PLACEHOLDER,
  DEMO_PUBLIC_MAX_PER_WALLET,
  DEMO_RENDER_JOBS,
} from '@/lib/demo'
import type { ManageCall } from '@/lib/manage/phase-calls'
import type { RevealTargets, SettingsCopyRow, SettingsView } from '@/lib/manage/settings-types'
import { pointerOf, settingsViewOf, TRANSFER_LEVELS } from '@/lib/manage/settings-view'
import { samplePhasesView } from './manage-sim'
import type { SettingsServer } from './settings-server'

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** The sample's rendered metadata: a folder with a file per token. */
const SAMPLE_REAL_URI = `ipfs://${DEMO_RENDER_JOBS.done.metadataCid}/`
/** The sample's placeholder metadata: one file every token shows, and the base URI the sample deployed on. */
const SAMPLE_PLACEHOLDER_URI = `ipfs://${DEMO_PLACEHOLDER.cid}/metadata.json`

/** The constructor as the sample prepared it, which the copies carry. */
const SAMPLE_ARGS: PreparedArgs = {
  name: DEMO_COLLECTION.name,
  symbol: DEMO_COLLECTION.symbol,
  payout: DEMO_DEPLOYMENT.payoutAddress,
  baseUri: SAMPLE_PLACEHOLDER_URI,
  maxSupply: String(DEMO_COLLECTION.maxSupply),
  groupSupplies: [],
  groupPrices: [],
  publicMaxPerWallet: String(DEMO_PUBLIC_MAX_PER_WALLET),
  royaltyBps: DEMO_DEPLOYMENT.royaltyBps,
  owner: DEMO_CREATOR,
  royaltyReceiver: DEMO_DEPLOYMENT.royaltyReceiver,
}

/**
 * The Base sample's settings: the balances of `DEMO_ACTIVITY`'s proceeds and no refund held, the fees, payout and
 * royalty of `DEMO_DEPLOYMENT`, the placeholder as the base URI (the rendered metadata with `art` "revealed"), no
 * real job with `art` "deferred", mint on behalf off, Limit Break's default validator at the enforced level, and
 * the session wallet as the owner unless `owner` names another (`?owner=other`). With `chainReachable` false, the
 * copies, as the core builds them (`?chain=unreachable`).
 */
export function sampleSettingsView(
  collection: { max_supply: number | null },
  wallet: Address,
  options: { chainReachable?: boolean; owner?: Address; art?: string } = {},
): SettingsView {
  const phases = samplePhasesView(collection)
  const targets: RevealTargets = {
    real: options.art === 'deferred' ? null : SAMPLE_REAL_URI,
    placeholder: SAMPLE_PLACEHOLDER_URI,
    start: SAMPLE_PLACEHOLDER_URI,
  }
  const baseUri = options.art === 'revealed' ? SAMPLE_REAL_URI : SAMPLE_PLACEHOLDER_URI
  const base = { chainId: phases.chainId, contract: phases.contract, readAt: DEMO_NOW }
  const copies: SettingsCopyRow = {
    payout_address: DEMO_DEPLOYMENT.payoutAddress,
    royalty_bps: DEMO_DEPLOYMENT.royaltyBps,
    royalty_receiver: DEMO_DEPLOYMENT.royaltyReceiver,
    base_uri: baseUri,
    transfer_validator: DEFAULT_TRANSFER_VALIDATOR.toLowerCase(),
    mint_on_behalf: false,
    args: SAMPLE_ARGS,
  }
  const withdrawn = DEMO_ACTIVITY.proceeds.withdrawnWei
  if (options.chainReachable === false) return settingsViewOf(base, copies, targets, withdrawn, null)
  const block = 21_500_000n
  return settingsViewOf(base, copies, targets, withdrawn, {
    block,
    blockTimestamp: DEMO_NOW,
    chain: {
      block,
      blockTimestamp: DEMO_NOW,
      maxSupply: phases.maxSupply,
      totalMinted: phases.totalMinted,
      publicMaxMintPerWallet: phases.publicMaxPerWallet,
      mintOnBehalfActive: false,
      groups: [],
    },
    creatorBalanceWei: DEMO_ACTIVITY.proceeds.withdrawableWei,
    platformBalanceWei: DEMO_ACTIVITY.proceeds.platformFeesWei,
    pendingBalanceWei: '0',
    payout: getAddress(DEMO_DEPLOYMENT.payoutAddress),
    royaltyBps: DEMO_DEPLOYMENT.royaltyBps,
    royaltyReceiver: getAddress(DEMO_DEPLOYMENT.royaltyReceiver),
    baseUri,
    validator: DEFAULT_TRANSFER_VALIDATOR,
    owner: options.owner ?? wallet,
    fees: DEMO_DEPLOYMENT.fees,
    level: { kind: 'level', level: TRANSFER_LEVELS.enforced },
  })
}

/**
 * The view after a Settings change lands, as the chain would hold it and a read would show it: a withdrawal moves
 * the balance into the withdrawn sum; the payout, the royalty, the base URI (and its pointer), mint on behalf and
 * the validator take the call's values (no validator reads as none, any other at the enforced level); the level
 * call sets the level.
 */
export function sampleApplySettings(call: ManageCall, view: SettingsView): SettingsView {
  switch (call.functionName) {
    case 'withdrawMintFunds':
      return {
        ...view,
        withdrawnWei: (BigInt(view.withdrawnWei) + BigInt(view.creatorBalanceWei ?? '0')).toString(),
        creatorBalanceWei: '0',
      }
    case 'setOwnerPayoutAddress':
      return { ...view, payout: getAddress(call.args[0]) }
    case 'setDefaultRoyalty':
      return { ...view, royaltyReceiver: getAddress(call.args[0]), royaltyBps: Number(call.args[1]) }
    case 'setBaseURI':
      return { ...view, baseUri: call.args[0], pointer: pointerOf(call.args[0], view.targets) }
    case 'setMintOnBehalfStatus':
      return { ...view, mintOnBehalf: call.args[0] }
    case 'setTransferValidator': {
      const validator = getAddress(call.args[0])
      return {
        ...view,
        transferValidator: validator,
        level:
          validator === zeroAddress
            ? { kind: 'none', reason: 'zero' }
            : { kind: 'level', level: TRANSFER_LEVELS.enforced },
      }
    }
    case 'setTransferSecurityLevelOfCollection':
      return { ...view, level: { kind: 'level', level: call.args[1] } }
    default:
      return view
  }
}

/** The sample server: every answer takes 900 ms, and a confirm applies the call to the current view. */
export function sampleSettingsServer(current: () => SettingsView): SettingsServer {
  const answer = async <T>(data: () => T): Promise<ActionResult<T>> => {
    await wait(900)
    return { ok: true, data: data() }
  }
  return {
    read: () => answer(current),
    confirm: (_hash, call) => answer(() => sampleApplySettings(call, current())),
  }
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `pnpm --filter @cobweb/web exec vitest run src/components/manage/manage-sim.test.ts src/components/manage/airdrop-sim.test.ts src/components/manage/settings-sim.test.ts`
Expected: PASS, 3 files and 24 tests.

- [ ] **Step 6: Format, run the root checks and commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
pnpm exec prettier --write apps/web/src/components/manage/manage-sim.ts apps/web/src/components/manage/manage-sim.test.ts apps/web/src/components/manage/airdrop-sim.ts apps/web/src/components/manage/airdrop-sim.test.ts apps/web/src/components/manage/settings-sim.ts apps/web/src/components/manage/settings-sim.test.ts
pnpm typecheck && pnpm lint && pnpm test
git add apps/web/src/components/manage/manage-sim.ts apps/web/src/components/manage/manage-sim.test.ts apps/web/src/components/manage/airdrop-sim.ts apps/web/src/components/manage/airdrop-sim.test.ts apps/web/src/components/manage/settings-sim.ts apps/web/src/components/manage/settings-sim.test.ts
git commit -m "$(cat <<'EOF'
Add sample mode for Airdrop and Settings on the same code: the sample views, servers and waiting job, and the airdrop and withdrawal refusals on the sample actions

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: the web package reports 701 tests in 74 files (687 before, plus 14).

---

### Task 8: verify:airdrop and verify:settings on the deploy fixture

**Files:**

- Modify: `apps/web/scripts/deploy-fixture.ts` (the header comment; `simulateCall`, `sendCall`, `simulationSentence`, `handOver`; `removeFixtures` also checks `airdrops` and `withdrawals`)
- Create: `apps/web/scripts/verify-airdrop.ts`, `apps/web/scripts/verify-settings.ts`
- Modify: `apps/web/package.json` (the two scripts)
- Modify: `CLAUDE.md` (two lines in Commands)
- Test: `pnpm --filter @cobweb/web verify:airdrop` and `verify:settings`; `verify:deploy`, `verify:phases` and `verify:whitelist` still pass on the shared fixture

**Interfaces:**

- Consumes: from `./deploy-fixture.ts`, `admin` (the service-role client), `chain` (the Anvil test client with public actions), `chainReady()`, `check(name, fn)`, `CID(letter)`, `collectionSalt`, `COLLECTION_CREATION_CODE`, `deploy(account, encodedArgs, salt)`, `deployedCollection(creator, form, name?): Promise<Deployed>`, `encodeCollectionArgs`, `factory`, `predictCollectionAddress`, `readDeployment`, `refusal(outcome)`, `removeFixtures()`, `rpc`, `runChecks(main, cleanup)`, `settings`, `signIn(account): Promise<Creator>`, the types `Deployed` and `DeployForm`; from Task 5, `airdropViewCore`, `confirmAirdropCore`, `settingsViewCore`, `confirmSettingsTxCore` and `confirmPhaseTxCore`; from Task 4, `airdropCalls`, `settingsCalls`, `phaseCalls`, `abiOf`, `callOf`, `sentOf`, `expectedEvent`, `SETTINGS_FUNCTIONS`, `parseSentCall`, `proveAirdrop` and `classifyError(error, 'simulating', 'manage', 'ETH')`; from Task 3, `BURN_ADDRESS` and the sentences; from Task 2, `airdrop_record`, `withdrawal_record` and `settings_refresh` (called directly with the service role, and from the stranger's client); `DEFAULT_TRANSFER_VALIDATOR` (Task 1). The local factory's admin is Anvil's first account, unlocked on the node.
- Produces: in `deploy-fixture.ts`, `ManageCall` (the type), `sendCall(account, collection, call): Promise<Hex>` (simulated as wagmi does on the call's contract with its ABI and value, then exactly the simulated request sent and waited for), `simulationSentence(account, collection, call): Promise<string>` (the refusal in the creator's words with ETH, or 'the simulation passed'), `handOver(account, collection, to)` (`transferOwnership`, the scripts' owner check), and `removeFixtures` answering "N airdrops left" or "N withdrawals left"; `pnpm --filter @cobweb/web verify:airdrop` (fifteen checks) and `verify:settings` (seventeen).

- [ ] **Step 1: The fixture's send helpers and the records it cleans up**

Decision (section 10): the two scripts simulate and send through one helper, as the manage machine does, so their refusals read exactly as the dialog's; records cascade from their collection, and the fixture checks that none is left for every script that uses it.

In `apps/web/scripts/deploy-fixture.ts`, replace:

```ts
// The local deploy fixture verify:deploy, verify:phases and verify:whitelist share (docs/specs/2026-10-15-phases.md,
// section 10), so they cannot drift: the local settings with non-local endpoints refused, the service client
// and the Anvil client, the PASS and FAIL lines, the SIWE sign-in, a seeded generative collection, the
// lock and deploy contexts the write helpers build, the payment, the render functions, the factory call,
// and `deployedCollection`, which locks, pays, renders, links, prepares, deploys and confirms through the
// cores. Every row it creates is tracked, and `removeFixtures` deletes them. Never prints a key.
```

with:

```ts
// The local deploy fixture verify:deploy, verify:phases, verify:whitelist, verify:airdrop and verify:settings share
// (docs/specs/2026-10-15-phases.md, section 10), so they cannot drift: the local settings with non-local endpoints
// refused, the service client and the Anvil client, the PASS and FAIL lines, the SIWE sign-in, a seeded generative
// collection, the lock and deploy contexts the write helpers build, the payment, the render functions, the factory
// call, `deployedCollection`, which locks, pays, renders, links, prepares, deploys and confirms through the cores,
// and a manage call simulated and sent as the manage machine does. Every row it creates is tracked, and
// `removeFixtures` deletes them. Never prints a key.
```

In `apps/web/scripts/deploy-fixture.ts`, replace:

```ts
  publicActions,
  type Address,
```

with:

```ts
  publicActions,
  type Abi,
  type Address,
```

In `apps/web/scripts/deploy-fixture.ts`, replace:

```ts
import { createSiweMessage, generateSiweNonce } from 'viem/siwe'
import type { RenderQueue } from '@cobweb/shared/render-queue'
```

with:

```ts
import { createSiweMessage, generateSiweNonce } from 'viem/siwe'
import { collectionAbi } from '@cobweb/shared/collection-abi'
import type { RenderQueue } from '@cobweb/shared/render-queue'
```

In `apps/web/scripts/deploy-fixture.ts`, replace:

```ts
export const { collectionArgsOf } = await import('../src/lib/deploy/deploy-args.ts')
export type LockContext = import('../src/lib/art/lock-core.ts').LockContext
```

with:

```ts
export const { collectionArgsOf } = await import('../src/lib/deploy/deploy-args.ts')
const { abiOf } = await import('../src/lib/manage/phase-calls.ts')
const { classifyError } = await import('../src/components/deploy/tx-errors.ts')
export type LockContext = import('../src/lib/art/lock-core.ts').LockContext
```

In `apps/web/scripts/deploy-fixture.ts`, replace:

```ts
export type Prepared = import('../src/lib/deploy/deploy-types.ts').Prepared
export type DeployRecord = import('../src/lib/deploy/deploy-types.ts').DeployRecord

export const admin: LocalClient = adminClient(settings)
```

with:

```ts
export type Prepared = import('../src/lib/deploy/deploy-types.ts').Prepared
export type DeployRecord = import('../src/lib/deploy/deploy-types.ts').DeployRecord
export type ManageCall = import('../src/lib/manage/phase-calls.ts').ManageCall

export const admin: LocalClient = adminClient(settings)
```

In `apps/web/scripts/deploy-fixture.ts`, replace:

```ts
}

/** The collection's row as the service role reads it. */
```

with:

```ts
}

/**
 * The simulation the manage machine runs for a call (docs/specs/2026-10-15-airdrop-settings.md, section 7.1): on
 * the call's contract (the collection, or the validator for the level call), with its ABI and its value.
 */
function simulateCall(account: PrivateKeyAccount, collection: Address, call: ManageCall) {
  return chain.simulateContract({
    address: call.target?.address ?? collection,
    abi: abiOf(call) as Abi,
    functionName: call.functionName,
    args: call.args,
    value: call.value,
    account,
  })
}

/** Simulates a manage call as wagmi does, sends exactly the simulated request from the account and waits. */
export async function sendCall(
  account: PrivateKeyAccount,
  collection: Address,
  call: ManageCall,
): Promise<Hex> {
  const { request } = await simulateCall(account, collection, call)
  const wallet = createWalletClient({ account, chain: anvil, transport: http(rpc) })
  const hash = await wallet.writeContract(request)
  const receipt = await chain.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`${call.functionName} reverted: ${hash}`)
  return hash
}

/** How the simulation refuses a manage call, in the creator's words with the chain's symbol, or that it passed. */
export async function simulationSentence(
  account: PrivateKeyAccount,
  collection: Address,
  call: ManageCall,
): Promise<string> {
  try {
    await simulateCall(account, collection, call)
    return 'the simulation passed'
  } catch (error) {
    return classifyError(error, 'simulating', 'manage', 'ETH').message
  }
}

/** `transferOwnership(to)` from the account (the scripts' owner check; Cobweb never sends it), and waits. */
export async function handOver(account: PrivateKeyAccount, collection: Address, to: Address): Promise<void> {
  const owner = createWalletClient({ account, chain: anvil, transport: http(rpc) })
  const hash = await owner.writeContract({
    address: collection,
    abi: collectionAbi,
    functionName: 'transferOwnership',
    args: [to],
  })
  const receipt = await chain.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`transferOwnership reverted: ${hash}`)
}

/** The collection's row as the service role reads it. */
```

In `apps/web/scripts/deploy-fixture.ts`, replace:

```ts
 * Deletes every job, collection (its deployment, phases and whitelist entries cascade) and user the run created,
 * or says what is left.
```

with:

```ts
 * Deletes every job, collection (its deployment, phases, whitelist entries, airdrops and withdrawals cascade) and
 * user the run created, or says what is left.
```

In `apps/web/scripts/deploy-fixture.ts`, replace:

```ts
    if (entries.count) return `${entries.count} whitelist entries left`
  }
```

with:

```ts
    if (entries.count) return `${entries.count} whitelist entries left`
    for (const table of ['airdrops', 'withdrawals'] as const) {
      const records = await admin
        .from(table)
        .select('*', { count: 'exact', head: true })
        .in('collection_id', collectionIds)
      if (records.error) return `${table}: ${records.error.message}`
      if (records.count) return `${records.count} ${table} left`
    }
  }
```

- [ ] **Step 2: verify:airdrop**

Decision (section 10): the platform admin's `setFees` goes from Anvil's first account (`0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`) as an unlocked JSON-RPC account, so no key is written in the script. The gas measurement's collection of 1,000 is deployed straight through the factory with `encodeCollectionArgs` and the fixture's `deploy`, not recorded in Cobweb (spec section 14, item 7); the check fails only if the batch does not land.

Create `apps/web/scripts/verify-airdrop.ts`:

```ts
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
import {
  createWalletClient,
  getAddress,
  http,
  keccak256,
  parseEther,
  toHex,
  type Address,
  type Hex,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { anvil } from 'viem/chains'
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

/** Anvil's first account: the local factory's admin and treasury, unlocked on the node, so no key is needed. */
const PLATFORM_ADMIN: Address = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
/** The airdrop fee the admin sets: 0.0001 ETH a token. */
const FEE = 100_000_000_000_000n
/** The per-transaction gas cap some chains apply. */
const TX_GAS_CAP = 16_777_216n

/** A fresh wallet for each tag and index, from their keccak. */
const wallet = (tag: string, index: number): Address =>
  getAddress(`0x${keccak256(toHex(`${tag} ${index}`)).slice(26)}`)

/** Sets a collection's fees from the platform admin, sent as an unlocked JSON-RPC account, and waits. */
async function setFees(collection: Address, airdropFeePerToken: bigint): Promise<Hex> {
  const platform = createWalletClient({ account: PLATFORM_ADMIN, chain: anvil, transport: http(rpc) })
  const hash = await platform.writeContract({
    address: collection,
    abi: collectionAbi,
    functionName: 'setFees',
    args: [0n, 0n, airdropFeePerToken],
  })
  const receipt = await chain.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`setFees reverted: ${hash}`)
  return hash
}

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
      feesHash = await setFees(record.contractAddress, FEE)
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
    '9. burn: a burn of one is confirmed as a burn row with ids 3 to 3, the dead address holds token 3, left 0, the history newest first',
    async () => {
      const { cid, record } = subject()
      const { view } = await airdrop(airdropCalls.burn(1, FEE.toString()))
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
      await setFees(collection, FEE)
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
```

- [ ] **Step 3: verify:settings**

Create `apps/web/scripts/verify-settings.ts`:

```ts
// Checks Settings against a LOCAL Anvil chain and LOCAL Supabase (docs/specs/2026-10-15-airdrop-settings.md,
// section 10): a collection deployed through the factory with Public (0.001 ETH, 3, 2 per wallet) of three tokens,
// a royalty of 5% to the creator and the creator as payout; the read at one block and its copies; every change
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
    payout: creatorKey.address,
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
  let onBehalfHash: Hex | null = null

  await check(
    '2. read: the owner, balances of 0, nothing withdrawn, fees of 0, the payout and 5% to the creator, the real base URI revealed, mint on behalf off, the default validator without code; the copies equal the read',
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
        JSON.stringify([creatorKey.address, 500, creatorKey.address, REAL, DEFAULT_TRANSFER_VALIDATOR, false])
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
    "4. withdraw: with Public open and the stranger's mint for 0.001 ETH the balance reads 1000000000000000; the withdrawal confirmed records its amount, the creator and the receipt's block, and the view reads 0 and withdrawn 1000000000000000",
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
          payout_address: creatorKey.address.toLowerCase(),
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
        p_payout_address: creatorKey.address.toLowerCase(),
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
    '6. payout: a fresh address confirmed reads in the view and the copy, readDeployment still answers the creator, and the zero address is refused by the shape',
    async () => {
      const { cid } = subject()
      const payout = fresh('payout')
      const { view } = await change(settingsCalls.payout(payout))
      const copy = await copyOf(cid)
      const record = await readDeployment(creator.client, cid)
      const zero = parseSentCall(sentOf(settingsCalls.payout(zeroAddress)), SETTINGS_FUNCTIONS)
      return view.payout === payout &&
        getAddress(copy.payout_address) === payout &&
        record?.payout === creatorKey.address &&
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
      onBehalfHash = on.hash
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
    "13. refusals: the royalty's hash as a payout change, the stranger's mint, the deploy, and a level call aimed at the factory with mint on behalf's hash; nothing changes",
    async () => {
      const { cid, ctx, hash: deployHash } = subject()
      if (!royaltyHash || !mintHash || !onBehalfHash) return 'a hash is missing'
      const before = await copyOf(cid)
      const problems: string[] = []
      for (const [label, hash, call, sentence] of [
        ['royalty as payout', royaltyHash, settingsCalls.payout(fresh('payout')), NOT_THIS_CHANGE],
        ["stranger's mint", mintHash, settingsCalls.mintOnBehalf(true), NOT_FROM_WALLET],
        ['deploy', deployHash, settingsCalls.mintOnBehalf(true), NOT_THIS_CONTRACT],
        [
          'level at the factory',
          onBehalfHash,
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
```

- [ ] **Step 4: The commands**

In `apps/web/package.json`, replace:

```json
    "verify:whitelist": "node --conditions=react-server --import ./scripts/resolve-ts.mjs scripts/verify-whitelist.ts"
```

with:

```json
    "verify:whitelist": "node --conditions=react-server --import ./scripts/resolve-ts.mjs scripts/verify-whitelist.ts",
    "verify:airdrop": "node --conditions=react-server --import ./scripts/resolve-ts.mjs scripts/verify-airdrop.ts",
    "verify:settings": "node --conditions=react-server --import ./scripts/resolve-ts.mjs scripts/verify-settings.ts"
```

In `CLAUDE.md`, under `## Commands`, the two lines go after `verify:whitelist`:

In `CLAUDE.md`, replace:

```markdown
pnpm --filter @cobweb/web verify:whitelist   # the list, each chunk sent and confirmed from its receipt and calldata, the refusals and the snapshot, against local Supabase and Anvil
pnpm --filter @cobweb/web render:local <collectionId>   # renders the collection's paid jobs on the laptop against local Supabase, local storage and Anvil; CARs go to a temp folder
```

with:

```markdown
pnpm --filter @cobweb/web verify:whitelist   # the list, each chunk sent and confirmed from its receipt and calldata, the refusals and the snapshot, against local Supabase and Anvil
pnpm --filter @cobweb/web verify:airdrop    # each batch and burn sent and proven from its receipt and calldata, the fee, the refusals, the owner check and a 500-wallet batch's gas, against local Supabase and Anvil
pnpm --filter @cobweb/web verify:settings   # the read, each setting sent and confirmed from its receipt, the copies, the refusals and the owner check, against local Supabase and Anvil
pnpm --filter @cobweb/web render:local <collectionId>   # renders the collection's paid jobs on the laptop against local Supabase, local storage and Anvil; CARs go to a temp folder
```

- [ ] **Step 5: Run verify:airdrop**

Run: `pnpm --filter @cobweb/web typecheck`, then `pnpm --filter @cobweb/web verify:airdrop`
Expected: fifteen PASS lines, the gas line printed before check 14's, then `15 passed, 0 failed`:

```
PASS 1. chain: Anvil answers as 31337 and the factory approves the shipped creation code hash
PASS 2. read: a collection deployed with Public (free, 3) of three tokens reads max supply 3, minted 0, left 3, the fee 0, the owner the creator and no history
PASS 3. fee: the platform admin's setFees(0, 0, 100000000000000) lands and the view reads the fee as 100000000000000 wei
PASS 4. short value: a one-token batch simulated with 1 wei less is refused with the fee in ETH, and no row is written
PASS 5. batch: two fresh wallets with one token each (value 200000000000000) confirmed record one row with ids 1 to 2, the receipt's block and the creator; the wallets hold them, minted 2, left 1, the platform holds the fee
PASS 6. again: the same hash confirmed again answers the same view, and airdrop_record with the same arguments answers false
PASS 7. over supply: a two-token batch reads that only 1 token is left, and nothing is sent
PASS 8. contract recipient: a one-token batch to the factory reads that a recipient cannot receive ERC-721 tokens
PASS 9. burn: a burn of one is confirmed as a burn row with ids 3 to 3, the dead address holds token 3, left 0, the history newest first
PASS 10. refusals: the admin's setFees is not from the wallet, an Open of Public is not this change, the deploy is not this contract; nothing is recorded
PASS 11. stranger: the stranger's session reads no deployment and no rows, its confirm is refused as not deployed, and its raw record is refused
PASS 12. owner: once the creator hands the contract to the stranger the view's owner is the stranger and the creator's batch is refused as not the owner; ownership comes back
PASS 13. failure path: a read that does not answer gives both rows, unreachable, with no owner, fee, minted or left
  gas used by one batch of 500 wallets and 1,000 tokens: 26,880,045, above the 16,777,216 cap
PASS 14. gas: one batch of 500 fresh wallets with 2 tokens each lands on a collection of 1,000 deployed through the factory; its proof reads 500 recipients, 1,000 tokens and ids 1 to 1,000
PASS 15. cleanup: the run leaves no job, deployment, phase, whitelist entry, airdrop, withdrawal, collection or user behind

15 passed, 0 failed
```

A FAIL line names what it found instead; report it to the controller with the line. The gas is what Anvil measured when this plan was written; another figure is recorded as it is in Task 11, and check 14 fails only if the batch does not land.

- [ ] **Step 6: Run verify:settings**

Run: `pnpm --filter @cobweb/web verify:settings`
Expected: seventeen PASS lines, then `17 passed, 0 failed`:

```
PASS 1. chain: Anvil answers as 31337 and the factory approves the shipped creation code hash
PASS 2. read: the owner, balances of 0, nothing withdrawn, fees of 0, the payout and 5% to the creator, the real base URI revealed, mint on behalf off, the default validator without code; the copies equal the read
PASS 3. nothing to withdraw: withdrawMintFunds() at a balance of 0 reads that there is nothing to withdraw, and no row is written
PASS 4. withdraw: with Public open and the stranger's mint for 0.001 ETH the balance reads 1000000000000000; the withdrawal confirmed records its amount, the creator and the receipt's block, and the view reads 0 and withdrawn 1000000000000000
PASS 5. again: the withdrawal confirmed again answers the same view, and withdrawal_record answers false: one row still
PASS 6. payout: a fresh address confirmed reads in the view and the copy, readDeployment still answers the creator, and the zero address is refused by the shape
PASS 7. royalty: 750 bps to a fresh address confirmed reads in the view, in royaltyInfo(1, 10000) and in the copies; 1,001 bps is refused by the shape
PASS 8. custom link: setBaseURI to another CID confirmed reads the pointer custom, the copy, and token 1's URI with the id
PASS 9. back to the real job: its base URI confirmed reads revealed; the custom change's hash confirmed as the real URI's call is not this change, and nothing changes
PASS 10. mint on behalf: on, then off, each confirmed, reads in the view and the copy
PASS 11. validator: the zero address confirmed reads no validator in the view and the copy; the default, simulated, reads that there is no contract at that address
PASS 12. older read: settings_refresh at the block before the copies with other values answers false, and the copies keep the last read
PASS 13. refusals: the royalty's hash as a payout change, the stranger's mint, the deploy, and a level call aimed at the factory with mint on behalf's hash; nothing changes
PASS 14. stranger: the stranger's session reads no deployment and no withdrawals, its confirm is refused as not deployed, and its raw refresh is refused
PASS 15. owner: once the creator hands the contract to the stranger the view's owner is the stranger and mint on behalf from the creator is refused as not the owner; ownership comes back
PASS 16. failure path: a read that does not answer gives the copies and the withdrawn sum, no balance, fee, owner or level, unreachable, at the copy's time
PASS 17. cleanup: the run leaves no job, deployment, phase, whitelist entry, airdrop, withdrawal, collection or user behind

17 passed, 0 failed
```

A FAIL line names what it found instead; report it to the controller with the line. (Anvil has no code at the default validator, so check 11 reads the way back to it as its refusal in words, spec section 14, item 4.)

- [ ] **Step 7: The other scripts on the shared fixture**

Run: `pnpm --filter @cobweb/web verify:deploy`, then `pnpm --filter @cobweb/web verify:phases`, then `pnpm --filter @cobweb/web verify:whitelist`
Expected: `15 passed, 0 failed`, `20 passed, 0 failed` and `18 passed, 0 failed` (their cleanup now also finds no airdrop or withdrawal).

- [ ] **Step 8: Format, run the root checks and commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
pnpm exec prettier --write apps/web/scripts/deploy-fixture.ts apps/web/scripts/verify-airdrop.ts apps/web/scripts/verify-settings.ts apps/web/package.json
pnpm typecheck && pnpm lint && pnpm test
git add apps/web/scripts/deploy-fixture.ts apps/web/scripts/verify-airdrop.ts apps/web/scripts/verify-settings.ts apps/web/package.json CLAUDE.md
git commit -m "$(cat <<'EOF'
Add verify:airdrop and verify:settings on the deploy fixture: batches and a burn proven from their receipts and calldata with the fee, each setting confirmed from its receipt with the copies, the withdrawals recorded, the refusals, the owner check and a 500-wallet batch's gas

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: test counts unchanged (shared 80, web 701).

---

### Task 9: The Airdrop tab on the view: History, the batches, the waiting batch, the burn and the owner check

No unit test drives this task (no component tests): the pure parts it renders are tested in Tasks 3, 4, 6 and 7, and the screen is checked by typecheck, lint, the build and the browser walk (Task 11).

**Files:**

- Modify: `apps/web/src/components/manage/bits.tsx` (`TxLink`), `apps/web/src/components/manage/whitelist-chunks.tsx` (imports it)
- Create: `apps/web/src/components/manage/airdrop-dialogs.tsx`
- Modify: `apps/web/src/components/manage/airdrop-parts.tsx` (whole file), `apps/web/src/components/manage/airdrop-screen.tsx` (whole file)
- Modify: `apps/web/src/app/collections/[id]/manage/airdrop/page.tsx` (whole file)
- Modify: `apps/web/src/lib/demo/data.ts` (`DEAD_ADDRESS` removed: `BURN_ADDRESS` replaces it)

**Interfaces:**

- Consumes: `browserStore` (`@/components/deploy/deploy-machine`), `useChainClock` (`@/components/mint/use-chain-clock`), `chainView` (`@/lib/chain/chain-view`), `TransactionDialog` with `blocked` (Task 6), `ManageActionsProvider` and `useManageActions` (`./manage-context`), `realManageActions(config, target)` (Task 4), `sampleManageActions(current, sent?, settings?)` (Task 7), `runManage` with `nativeSymbol`, `rememberAirdropJob`, `airdropJob`, `forgetAirdropJob` (Task 6), `frozenJob`, `burnJob`, `withPending`, `withConfirmed`, `unsentTokens` (Task 6), `airdropServer(collectionId)` and `sampleAirdropServer(current, sent?)`, `sampleAirdropView`, `sampleAirdropJob` (Tasks 6 and 7), `getAirdrop` (Task 5), `airdropCalls` and `reviewOf` (Task 4), `batchesOf`, `tokensOf`, `BURN_ADDRESS`, the caps and the types (Task 3), `NOT_OWNER` (Task 3), `UNREADABLE_REASON` (`./phase-row`), `RecipientsInput` and `parseRecipients` (`./recipients-input`, `./recipients`), `snapshotSource` (`./snapshot-source`), `snapshotChains()` (`@/lib/manage/snapshot-core`), `requireOwnedCollection`, `requireUser` (`@/lib/auth`), `stageContext`, `searchParam`, `LockedStagePage` (`../../_lib/stage`), `StagePage`, `ManageUnavailable`, and the `@cobweb/ui` components.
- Produces:
  - in `bits.tsx`: `TxLink({ chain, hash, label? })`, moved from `whitelist-chunks.tsx`
  - in `airdrop-dialogs.tsx`: `tokensLabel(n)`, `walletsLabel(n)`, `batchRequest(entries, feePerTokenWei, chain, confirm, pending): ManageRequest<AirdropView>`, `burnRequest(amount, feePerTokenWei, chain, confirm, pending)`, `PendingBatchPanel({ job, chain, server, onView, onConfirmed, onForget, onDiscard })`
  - in `airdrop-parts.tsx`: `tokenRange(row)`, `airdropHistoryCsv(rows, chain)` (`date_utc,kind,recipients,tokens,token_ids,fee_eth,tx_hash`), `AirdropHistory`, `burnError(quantity, remaining)` (1 to 1,000 and at most what is left), `BurnQuantity`, `BurnDialog` (typed "burn N", `blocked`, the pending store), `SupplyNote` ("Not read" while the chain does not answer)
  - `AirdropScreen({ collection, view, wallet, sample, samplePending?, snapshotChainIds })` under its own `ManageActionsProvider`; the page reads `getAirdrop` with `requireUser`'s wallet, or the sample with `?chain=unreachable`, `?owner=other` and `?batch=pending`

- [ ] **Step 1: The transaction link, shared**

Decision (section 7.3): `TxLink` moves to `bits.tsx`, so History and the batch panel show a hash as the Whitelist does.

In `apps/web/src/components/manage/bits.tsx`, replace:

```tsx
import { explorerAddressUrl, shortAddress, type Address, type SupportedChain } from '@/lib/demo'
```

with:

```tsx
import {
  explorerAddressUrl,
  explorerTxUrl,
  shortAddress,
  type Address,
  type Hex,
  type SupportedChain,
} from '@/lib/demo'
```

In `apps/web/src/components/manage/bits.tsx`, replace:

```tsx
}

/** A label and value on one line, value right-aligned in mono. For summaries and receipts. */
```

with:

```tsx
}

/** A transaction: a link to the chain's explorer, or the hash as text where it has none (Anvil). */
export function TxLink({ chain, hash, label }: { chain: SupportedChain; hash: Hex; label?: string }) {
  if (!chain.explorerUrl)
    return <span className="numeric text-muted-foreground text-[0.8125rem] break-all">{hash}</span>
  return (
    <a
      href={explorerTxUrl(chain, hash)}
      target="_blank"
      rel="noreferrer"
      className="numeric text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex items-center gap-1 rounded-sm text-[0.8125rem] outline-none focus-visible:ring-2"
    >
      {label && <span className="font-sans">{label}</span>}
      {shortAddress(hash, 6)}
      <ExternalLinkIcon aria-hidden="true" className="size-3" />
      <span className="sr-only">(opens the block explorer)</span>
    </a>
  )
}

/** A label and value on one line, value right-aligned in mono. For summaries and receipts. */
```

In `apps/web/src/components/manage/whitelist-chunks.tsx`, replace:

```tsx
import { ExternalLinkIcon, InfoIcon, RotateCwIcon, UploadIcon } from 'lucide-react'
import { useReducer } from 'react'
import { toast } from 'sonner'
import type { Hex } from 'viem'
```

with:

```tsx
import { InfoIcon, RotateCwIcon, UploadIcon } from 'lucide-react'
import { useReducer } from 'react'
import { toast } from 'sonner'
```

In `apps/web/src/components/manage/whitelist-chunks.tsx`, replace:

```tsx
import { explorerTxUrl, shortAddress, type MintGroup, type SupportedChain } from '@/lib/demo'
import type { GroupList, SentChunk, WhitelistView } from '@/lib/manage/whitelist-types'
import { WHITELIST_CHUNK } from '@/lib/manage/whitelist-view'
```

with:

```tsx
import type { MintGroup, SupportedChain } from '@/lib/demo'
import type { GroupList, SentChunk, WhitelistView } from '@/lib/manage/whitelist-types'
import { WHITELIST_CHUNK } from '@/lib/manage/whitelist-view'
import { TxLink } from './bits'
```

In `apps/web/src/components/manage/whitelist-chunks.tsx`, replace:

```tsx
import type { ChunkRow } from './whitelist-model'
import type { WhitelistServer } from './whitelist-server'

/** A transaction: a link to the chain's explorer, or the hash as text where it has none (Anvil). */
function TxLink({ chain, hash, label }: { chain: SupportedChain; hash: Hex; label?: string }) {
  if (!chain.explorerUrl)
    return <span className="numeric text-muted-foreground text-[0.8125rem] break-all">{hash}</span>
  return (
    <a
      href={explorerTxUrl(chain, hash)}
      target="_blank"
      rel="noreferrer"
      className="numeric text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex items-center gap-1 rounded-sm text-[0.8125rem] outline-none focus-visible:ring-2"
    >
      {label && <span className="font-sans">{label}</span>}
      {shortAddress(hash, 6)}
      <ExternalLinkIcon aria-hidden="true" className="size-3" />
      <span className="sr-only">(opens the block explorer)</span>
    </a>
  )
}

/**
```

with:

```tsx
import type { ChunkRow } from './whitelist-model'
import type { WhitelistServer } from './whitelist-server'

/**
```

- [ ] **Step 2: The batch and burn requests, and the waiting batch**

Decision (section 7.3): `PendingBatchPanel` takes `onForget` beside `onDiscard`. A terminal answer to "Check again" forgets the hash through the machine's `forget` without marking the batch failed; "Discard" forgets it and marks the batch "Discarded before it was confirmed.".

Create `apps/web/src/components/manage/airdrop-dialogs.tsx`:

```tsx
'use client'

import { InfoIcon } from 'lucide-react'
import { useReducer } from 'react'
import { toast } from 'sonner'
import type { Hex } from 'viem'
import { Alert, AlertDescription, AlertTitle } from '@cobweb/ui/components/alert'
import { Button } from '@cobweb/ui/components/button'
import { Spinner } from '@cobweb/ui/components/spinner'
import { deployReducer, type DeployEvent } from '@/components/deploy/deploy-machine'
import { classifyError } from '@/components/deploy/tx-errors'
import { isTxRunning, TX_IDLE, TxProgress, type TxFailure } from '@/components/deploy/tx-progress'
import type { ActionResult } from '@/lib/art/result'
import type { SupportedChain } from '@/lib/demo'
import type { AirdropJob, AirdropView, BatchEntry } from '@/lib/manage/airdrop-types'
import { tokensOf } from '@/lib/manage/airdrop-view'
import { airdropCalls, reviewOf, type ManageCall } from '@/lib/manage/phase-calls'
import type { AirdropServer } from './airdrop-server'
import { TxLink } from './bits'
import { count } from './format'
import type { ManageRequest } from './manage-actions'
import { useManageActions } from './manage-context'
import { runManage } from './manage-machine'

/** Keeps a sent hash in the job until the server confirms it. */
type Pending = { remember(hash: Hex): void; forget(): void }

/** `1 token`, `4 tokens`; `1 wallet`, `3 wallets`. */
export const tokensLabel = (value: number) => `${count(value)} ${value === 1 ? 'token' : 'tokens'}`
export const walletsLabel = (value: number) => `${count(value)} ${value === 1 ? 'wallet' : 'wallets'}`

/** A call as the airdrop dialogs send it: the call, its review from the ABI, the server's confirm and the hash kept. */
function requestOf(
  call: ManageCall,
  chain: SupportedChain,
  confirm: (hash: Hex) => Promise<ActionResult<AirdropView>>,
  pending: Pending,
): ManageRequest<AirdropView> {
  return {
    call,
    review: { contract: 'Collection', functionName: 'airdropNFTs', args: reviewOf(call, chain) },
    confirm,
    pending,
  }
}

/**
 * One batch as the send dialog sends it (docs/specs/2026-10-15-airdrop-settings.md, section 7.3): `airdropNFTs`
 * with the contract's fee for its tokens as the value, the review in counts with the value, the server's confirm
 * from the receipt and calldata, and the hash kept in the job until then.
 */
export function batchRequest(
  entries: BatchEntry[],
  feePerTokenWei: string,
  chain: SupportedChain,
  confirm: (hash: Hex) => Promise<ActionResult<AirdropView>>,
  pending: Pending,
): ManageRequest<AirdropView> {
  return requestOf(airdropCalls.batch(entries, feePerTokenWei), chain, confirm, pending)
}

/** A burn as its dialog sends it: one batch of `amount` tokens to the dead address, the same way. */
export function burnRequest(
  amount: number,
  feePerTokenWei: string,
  chain: SupportedChain,
  confirm: (hash: Hex) => Promise<ActionResult<AirdropView>>,
  pending: Pending,
): ManageRequest<AirdropView> {
  return requestOf(airdropCalls.burn(amount, feePerTokenWei), chain, confirm, pending)
}

/**
 * A batch or a burn this browser sent and Cobweb has not confirmed (section 7.3): "Check again" runs the manage
 * machine from its last step, which reads the receipt and the calldata on the server; a terminal refusal is
 * toasted and forgets the hash (`onForget`). "Discard" forgets it and marks the batch failed (`onDiscard`), under
 * the warning that a landed batch sent again mints twice.
 */
export function PendingBatchPanel({
  job,
  chain,
  server,
  onView,
  onConfirmed,
  onForget,
  onDiscard,
}: {
  job: AirdropJob
  chain: SupportedChain
  server: AirdropServer
  onView: (view: AirdropView) => void
  onConfirmed: () => void
  onForget: () => void
  onDiscard: () => void
}) {
  const { chainId, wallet } = useManageActions()
  const [phase, dispatch] = useReducer(deployReducer, TX_IDLE)
  const running = isTxRunning(phase)
  const burn = job.kind === 'burn'
  const batch = job.batches[job.sent] ?? []
  const tokens = tokensOf(batch)

  async function check() {
    const hash = job.pending
    if (!hash) return
    const last: { failure: TxFailure | null } = { failure: null }
    const report = (event: DeployEvent) => {
      if (event.type === 'failed') last.failure = event.failure
      dispatch(event)
    }
    let view: AirdropView | null = null
    try {
      view = await runManage<AirdropView>(
        {
          call: null,
          account: wallet,
          wallet,
          chainId,
          connectedChainId: chainId,
          sentHash: hash,
          nativeSymbol: chain.nativeSymbol,
        },
        {
          switchChain: async () => {},
          simulate: () => Promise.reject(new Error('A sent batch is checked, never sent again.')),
          wait: async () => 'success',
          confirm: (sent) => server.confirm(sent),
          forget: onForget,
          sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
          now: () => Date.now(),
        },
        report,
      )
    } catch (error) {
      report({ type: 'failed', failure: classifyError(error, 'confirming', 'manage', chain.nativeSymbol) })
    }
    if (view) {
      onView(view)
      onConfirmed()
      toast.success(burn ? 'The burn is on chain' : 'The batch is on chain')
      return
    }
    if (last.failure?.kind === 'refused') toast.error(last.failure.message)
  }

  return (
    <Alert>
      <InfoIcon aria-hidden="true" />
      <AlertTitle>
        {burn ? 'A burn is waiting to be confirmed' : 'A batch is waiting to be confirmed'}
      </AlertTitle>
      <AlertDescription>
        <p>
          {burn
            ? `This browser sent a burn of ${tokensLabel(tokens)} to the dead address.`
            : `This browser sent batch ${job.sent + 1} of ${job.batches.length}: ${tokensLabel(tokens)} to ${walletsLabel(batch.length)}.`}{' '}
          Cobweb lists it in History once the receipt and the transaction show the tokens minted.
        </p>
        {job.pending && <TxLink chain={chain} hash={job.pending} label="Transaction" />}
        {phase.step !== 'idle' && (
          <TxProgress
            phase={phase}
            steps={[
              {
                step: 'verifying',
                label: 'Reading the batch',
                detail:
                  'Cobweb checks the receipt and the recipients and amounts the transaction carried, then reads the contract again.',
              },
            ]}
          />
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => void check()} disabled={running}>
            {running && <Spinner />}
            Check again
          </Button>
          <Button variant="ghost" size="sm" onClick={onDiscard} disabled={running}>
            Discard
          </Button>
        </div>
        <p className="text-muted-foreground text-[0.8125rem]">
          Discard only a transaction that failed or never left your wallet. If it landed, sending the batch
          again mints its tokens twice.
        </p>
      </AlertDescription>
    </Alert>
  )
}
```

- [ ] **Step 3: History and the burn**

Decision (section 7.3): while the chain is not read, Tokens to burn's help reads "Up to 1,000 at a time." without a count left.

Replace the whole of `apps/web/src/components/manage/airdrop-parts.tsx` with:

```tsx
'use client'

import { FlameIcon } from 'lucide-react'
import { useId, useState } from 'react'
import type { Hex } from 'viem'
import { Badge } from '@cobweb/ui/components/badge'
import { Field, FieldDescription, FieldError, FieldLabel } from '@cobweb/ui/components/field'
import { Input } from '@cobweb/ui/components/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@cobweb/ui/components/table'
import type { ActionResult } from '@/lib/art/result'
import { formatNative, mulWei, shortAddress, type SupportedChain } from '@/lib/demo'
import type { AirdropRow, AirdropView } from '@/lib/manage/airdrop-types'
import { AIRDROP_MAX_TOKENS, BURN_ADDRESS } from '@/lib/manage/airdrop-view'
import { burnRequest, tokensLabel } from './airdrop-dialogs'
import { Row, TxLink } from './bits'
import { count, relativeTo, shortUtc } from './format'
import { toCsv } from './recipients'
import { TransactionDialog } from './transaction-dialog'

/** Token ids a recorded airdrop minted: `#41 to #50`, or `#41` for one. */
export function tokenRange(airdrop: AirdropRow): string {
  return airdrop.firstTokenId === airdrop.lastTokenId
    ? `#${airdrop.firstTokenId}`
    : `#${airdrop.firstTokenId} to #${airdrop.lastTokenId}`
}

/** History as CSV, one row per transaction in History's order (newest first), as legacy's "Export CSV". */
export function airdropHistoryCsv(airdrops: AirdropRow[], chain: SupportedChain): string {
  return toCsv([
    [
      'date_utc',
      'kind',
      'recipients',
      'tokens',
      'token_ids',
      `fee_${chain.nativeSymbol.toLowerCase()}`,
      'tx_hash',
    ],
    ...airdrops.map((airdrop) => [
      new Date(airdrop.confirmedAt * 1000).toISOString(),
      airdrop.kind,
      airdrop.recipients,
      airdrop.tokens,
      tokenRange(airdrop),
      formatNative(airdrop.feePaidWei, '', 18).trim().replace(/,/g, ''),
      airdrop.txHash,
    ]),
  ])
}

/** The batches and burns Cobweb confirmed, newest first. When is when Cobweb recorded each. */
export function AirdropHistory({
  airdrops,
  chain,
  readAt,
}: {
  airdrops: AirdropRow[]
  chain: SupportedChain
  readAt: number
}) {
  if (airdrops.length === 0) {
    return (
      <p className="text-muted-foreground px-6 py-10 text-center text-sm">
        No airdrops yet. Each one you send is listed here.
      </p>
    )
  }
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="pl-6">When</TableHead>
          <TableHead>Kind</TableHead>
          <TableHead className="text-right">Recipients</TableHead>
          <TableHead className="text-right">Tokens</TableHead>
          <TableHead>Token ids</TableHead>
          <TableHead className="text-right">Fee paid</TableHead>
          <TableHead className="pr-6 text-right">Transaction</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {airdrops.map((airdrop) => (
          <TableRow key={airdrop.txHash}>
            <TableCell className="pl-6">
              <span className="numeric text-sm">{shortUtc(airdrop.confirmedAt)}</span>
              <span className="text-muted-foreground block text-[0.8125rem]">
                {relativeTo(airdrop.confirmedAt, readAt)}
              </span>
            </TableCell>
            <TableCell>
              {airdrop.kind === 'burn' ? (
                <Badge variant="destructive">
                  <FlameIcon aria-hidden="true" />
                  Burn
                </Badge>
              ) : (
                <Badge variant="secondary">Airdrop</Badge>
              )}
            </TableCell>
            <TableCell className="numeric text-right">{count(airdrop.recipients)}</TableCell>
            <TableCell className="numeric text-right">{count(airdrop.tokens)}</TableCell>
            <TableCell className="numeric text-muted-foreground text-[0.8125rem]">
              {tokenRange(airdrop)}
            </TableCell>
            <TableCell className="numeric text-right">
              {formatNative(airdrop.feePaidWei, chain.nativeSymbol)}
            </TableCell>
            <TableCell className="pr-6 text-right">
              <TxLink chain={chain} hash={airdrop.txHash} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

/** Why a burn quantity cannot be sent, or null: a whole number, no more than is left, 1,000 at most at a time. */
export function burnError(quantity: string, remaining: number): string | null {
  const amount = Number(quantity)
  if (!/^\d+$/.test(quantity) || amount < 1) return 'Enter a whole number of 1 or more.'
  if (amount > remaining) return `Only ${count(remaining)} tokens are left to mint.`
  if (amount > AIRDROP_MAX_TOKENS) return 'Burn up to 1,000 tokens at a time.'
  return null
}

/**
 * Burn mode's input, in place of the recipients: how many tokens to mint straight to the dead address
 * (MASTER_PLAN, Contracts: burn), where nobody can ever use them. `remaining` is null while the contract cannot
 * be read.
 */
export function BurnQuantity({
  quantity,
  onChange,
  error,
  remaining,
}: {
  quantity: string
  onChange: (value: string) => void
  error: string | null
  remaining: number | null
}) {
  const id = useId()
  return (
    <div className="grid gap-4">
      <p className="text-muted-foreground text-sm">
        Burning mints tokens to the dead address,{' '}
        <span className="numeric">{shortAddress(BURN_ADDRESS, 6)}</span>, where nobody can ever use them. Use
        it to shrink a drop that will not sell out. It cannot be undone, and it costs the airdrop fee per
        token.
      </p>
      <Field data-invalid={!!error} className="max-w-56">
        <FieldLabel htmlFor={`${id}-quantity`}>Tokens to burn</FieldLabel>
        <Input
          id={`${id}-quantity`}
          type="number"
          min={1}
          max={Math.min(remaining ?? AIRDROP_MAX_TOKENS, AIRDROP_MAX_TOKENS)}
          value={quantity}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={!!error}
          aria-describedby={`${id}-quantity-help`}
        />
        {error ? (
          <FieldError id={`${id}-quantity-help`}>{error}</FieldError>
        ) : remaining !== null && remaining <= AIRDROP_MAX_TOKENS ? (
          <FieldDescription id={`${id}-quantity-help`}>
            Up to <span className="numeric">{count(remaining)}</span>, the tokens left to mint.
          </FieldDescription>
        ) : (
          <FieldDescription id={`${id}-quantity-help`}>
            Up to 1,000 at a time.
            {remaining !== null && (
              <>
                {' '}
                <span className="numeric">{count(remaining)}</span> are left to mint.
              </>
            )}
          </FieldDescription>
        )}
      </Field>
    </div>
  )
}

/**
 * The burn's confirmation: what it leaves, its fee, and typing "burn N" to enable the send, which sends one
 * batch to the dead address (docs/specs/2026-10-15-airdrop-settings.md, section 7.3). With `blocked` (the owner
 * check) it opens for reading, its action off.
 */
export function BurnDialog({
  open,
  onOpenChange,
  chain,
  amount,
  remaining,
  feePerTokenWei,
  blocked,
  confirm,
  pending,
  onBurned,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  chain: SupportedChain
  amount: number
  remaining: number
  feePerTokenWei: string
  blocked: string | null
  confirm: (hash: Hex) => Promise<ActionResult<AirdropView>>
  pending: { remember(hash: Hex): void; forget(): void }
  onBurned: (view: AirdropView) => void
}) {
  const id = useId()
  const [typed, setTyped] = useState('')
  const fee = mulWei(feePerTokenWei, amount)
  const phrase = `burn ${amount}`
  const confirmed = typed.trim().toLowerCase() === phrase

  return (
    <TransactionDialog
      open={open}
      onOpenChange={onOpenChange}
      chain={chain}
      destructive
      blocked={blocked}
      title={`Burn ${tokensLabel(amount)}`}
      description="The tokens are minted to the dead address and counted against supply for good. This cannot be undone."
      actionLabel={`Burn ${tokensLabel(amount)}`}
      successMessage={`${tokensLabel(amount)} burned`}
      request={confirmed ? burnRequest(amount, feePerTokenWei, chain, confirm, pending) : null}
      onConfirmed={onBurned}
    >
      <dl className="divide-y rounded-lg border px-4">
        <Row label="Left to mint now">{count(remaining)}</Row>
        <Row label="Left after the burn">{count(remaining - amount)}</Row>
        <Row label="Fee">{formatNative(fee, chain.nativeSymbol)}</Row>
      </dl>
      <Field>
        <FieldLabel htmlFor={`${id}-confirm`}>
          Type <span className="numeric bg-surface-3 rounded-sm px-1.5">{phrase}</span> to confirm
        </FieldLabel>
        <Input
          id={`${id}-confirm`}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          className="numeric"
        />
      </Field>
    </TransactionDialog>
  )
}

/** Left to mint now and after the send: `after` null means the send is more than is left; `remaining` null, not read. */
export function SupplyNote({
  remaining,
  after,
  label,
}: {
  remaining: number | null
  after: number | null
  label: string
}) {
  return (
    <div className="bg-well shadow-inset rounded-lg px-3 py-2.5 text-[0.8125rem]">
      <p className="flex justify-between">
        <span className="text-muted-foreground">Left to mint</span>
        <span className={remaining === null ? 'text-muted-foreground' : 'numeric'}>
          {remaining === null ? 'Not read' : count(remaining)}
        </span>
      </p>
      <p className="flex justify-between">
        <span className="text-muted-foreground">{label}</span>
        <span
          className={
            remaining === null
              ? 'text-muted-foreground'
              : after === null
                ? 'numeric text-destructive-foreground'
                : 'numeric'
          }
        >
          {remaining === null ? 'Not read' : after === null ? 'Not enough' : count(after)}
        </span>
      </p>
    </div>
  )
}
```

- [ ] **Step 4: The screen**

Decision (section 7.3): a send is off for the first reason that applies: the chain not read (`UNREADABLE_REASON`), then the owner check (the dialogs open with their action off and the sentence; the list is neither frozen nor stored), then a hash waiting ("Confirm or discard the waiting transaction first."). While a hash waits, "Stop and drop the unsent batches" and "Edit the list" are off with the same sentence. A batch waiting for its confirm reads `<StatusBadge status="pending">Confirming</StatusBadge>`.

Replace the whole of `apps/web/src/components/manage/airdrop-screen.tsx` with:

```tsx
'use client'

import { DownloadIcon, FlameIcon, RefreshCwIcon, SendIcon, TriangleAlertIcon, UserXIcon } from 'lucide-react'
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { Address, Hex } from 'viem'
import { useConfig } from 'wagmi'
import { Alert, AlertDescription, AlertTitle } from '@cobweb/ui/components/alert'
import { Button } from '@cobweb/ui/components/button'
import { Panel } from '@cobweb/ui/components/panel'
import { Spinner } from '@cobweb/ui/components/spinner'
import { StatusBadge } from '@cobweb/ui/components/status-badge'
import { Switch } from '@cobweb/ui/components/switch'
import { browserStore } from '@/components/deploy/deploy-machine'
import { useChainClock } from '@/components/mint/use-chain-clock'
import { NOT_OWNER, THROWN, type ActionResult } from '@/lib/art/result'
import { chainView } from '@/lib/chain/chain-view'
import type { Tables } from '@/lib/database.types'
import { formatNative, mulWei, shortAddress } from '@/lib/demo'
import type { AirdropJob, AirdropKind, AirdropView, BatchEntry } from '@/lib/manage/airdrop-types'
import { AIRDROP_MAX_PER_ADDRESS, batchesOf, BURN_ADDRESS, tokensOf } from '@/lib/manage/airdrop-view'
import type { ManageCall } from '@/lib/manage/phase-calls'
import { batchRequest, PendingBatchPanel, tokensLabel, walletsLabel } from './airdrop-dialogs'
import { burnJob, frozenJob, unsentTokens, withConfirmed, withPending } from './airdrop-job'
import {
  AirdropHistory,
  airdropHistoryCsv,
  BurnDialog,
  burnError,
  BurnQuantity,
  SupplyNote,
} from './airdrop-parts'
import { airdropServer, type AirdropServer } from './airdrop-server'
import { sampleAirdropJob, sampleAirdropServer } from './airdrop-sim'
import { Row } from './bits'
import { count, downloadText, relativeTo } from './format'
import { realManageActions } from './manage-actions'
import { ManageActionsProvider, type ManageTarget } from './manage-context'
import { airdropJob, forgetAirdropJob, rememberAirdropJob } from './manage-machine'
import { sampleManageActions, samplePhasesView } from './manage-sim'
import { UNREADABLE_REASON } from './phase-row'
import { parseRecipients, type ParseOptions } from './recipients'
import { ParsePreview, RecipientsInput } from './recipients-input'
import { snapshotSource } from './snapshot-source'
import { TransactionDialog } from './transaction-dialog'

export type AirdropScreenProps = {
  collection: Tables<'collections'>
  /** The contract's fee, supply and owner with Cobweb's records, read on the server (or the record alone, or the sample). */
  view: AirdropView
  /** The sign-in wallet: every batch is sent from it, and the owner check compares it with the contract's owner. */
  wallet: Address
  sample: boolean
  /** Sample mode only (`?batch=pending`): a batch waiting to be confirmed. */
  samplePending?: boolean
  /** The chains the holder snapshot can read (the server's `snapshotChains()`, every sample chain in sample mode). */
  snapshotChainIds: number[]
}

const PARSE: ParseOptions = {
  defaultAmount: 1,
  maxAmount: AIRDROP_MAX_PER_ADDRESS,
  onDuplicate: 'sum',
  amountName: 'quantity',
}
const TEMPLATE = {
  fileName: 'airdrop-template.csv',
  text: 'address,quantity\n0x5e1f0c9b8a7d6e5f4c3b2a1908f7e6d5c4b3a291,2\n0x3b9d2c1a0f8e7d6c5b4a39281706f5e4d3c2b1a0,1\n',
}
const PENDING_REASON = 'Confirm or discard the waiting transaction first.'
const DISCARDED = 'Discarded before it was confirmed.'

/** A server answer, or "Try again" when the action itself threw. */
async function settled<T>(call: Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await call
  } catch {
    return { ok: false, error: THROWN }
  }
}

/**
 * Manage drop, Airdrop (docs/specs/2026-10-15-airdrop-settings.md, section 7.3): send tokens to a list of wallets
 * for the contract's airdrop fee or, with "Burn instead of sending" on, burn a quantity by airdrop to the dead
 * address; and History, Cobweb's record of the batches it confirmed. The list freezes into batches of at most 500
 * wallets and 1,000 tokens at the first send, and the job is kept in this browser until every batch is confirmed.
 * Each batch runs the manage machine from the sign-in wallet and answers the fresh view. Sample mode runs the same
 * code on the sample actions and server.
 */
export function AirdropScreen({
  collection,
  view: initial,
  wallet,
  sample,
  samplePending = false,
  snapshotChainIds,
}: AirdropScreenProps) {
  const config = useConfig()
  const [view, setView] = useState(initial)
  const viewRef = useRef(view)
  viewRef.current = view
  const [text, setText] = useState('')
  const deferred = useDeferredValue(text)
  const result = useMemo(() => parseRecipients(deferred, PARSE), [deferred])
  const [job, setJob] = useState<AirdropJob | null>(null)
  // The job as the last change left it, so the machine's forget and the confirm in one run see each other.
  const jobRef = useRef<AirdropJob | null>(null)
  /** The current batch's failure in this visit, until a batch is confirmed. */
  const [failure, setFailure] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  // The dialogs stay mounted after they close, so a batch still confirming can finish.
  const [dialog, setDialog] = useState<{
    entries: BatchEntry[]
    index: number
    total: number
    fee: string
    key: number
  } | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [burn, setBurn] = useState(false)
  const [burnQuantity, setBurnQuantity] = useState('1')
  const [burnDialog, setBurnDialog] = useState<{ key: number; amount: number; fee: string } | null>(null)
  const [burnOpen, setBurnOpen] = useState(false)
  // Sample mode: what the simulated wallet sent, by hash, so the sample server applies exactly that call.
  const [sampleSent] = useState(() => new Map<Hex, ManageCall>())
  const chain = chainView(view.chainId)
  const now = useChainClock(view.blockTimestamp)
  const reachable = view.chainReachable
  const maxSupply = collection.max_supply

  const server = useMemo<AirdropServer>(
    () => (sample ? sampleAirdropServer(() => viewRef.current, sampleSent) : airdropServer(collection.id)),
    [sample, sampleSent, collection.id],
  )
  const target = useMemo<ManageTarget>(
    () => ({
      actions: sample
        ? sampleManageActions(
            () => ({
              ...samplePhasesView({ max_supply: maxSupply }),
              maxSupply: viewRef.current.maxSupply,
              totalMinted: viewRef.current.totalMinted ?? 0,
            }),
            sampleSent,
          )
        : realManageActions(config, { chainId: view.chainId, contract: view.contract, wallet }),
      chainId: view.chainId,
      wallet,
    }),
    [sample, sampleSent, maxSupply, config, view.chainId, view.contract, wallet],
  )
  const snapshot = useMemo(
    () =>
      snapshotSource({
        collectionId: collection.id,
        sample,
        chainIds: snapshotChainIds,
        preferred: view.chainId,
      }),
    [collection.id, sample, snapshotChainIds, view.chainId],
  )

  // A job from before a reload: its unsent batches stay frozen, and a pending hash is checked, never sent again.
  useEffect(() => {
    const stored = sample
      ? samplePending
        ? sampleAirdropJob()
        : null
      : airdropJob(browserStore(), collection.id)
    jobRef.current = stored
    setJob(stored)
  }, [sample, samplePending, collection.id])

  /** The job in progress, in state and, outside sample mode, in the browser's store. */
  function commit(next: AirdropJob | null) {
    jobRef.current = next
    setJob(next)
    if (sample) return
    if (next) rememberAirdropJob(browserStore(), collection.id, next)
    else forgetAirdropJob(browserStore(), collection.id)
  }

  /** Keeps a batch's sent hash in the job until the server confirms it, or forgets it. */
  const pendingBatch = {
    remember: (hash: Hex) => {
      const current = jobRef.current
      if (current) commit(withPending(current, hash))
    },
    forget: () => {
      const current = jobRef.current
      if (current) commit(withPending(current, null))
    },
  }

  /** A batch or a burn confirmed, by its dialog or by "Check again" (which replaces the view first): the job moves on. */
  function advance(kind: AirdropKind) {
    setFailure(null)
    if (kind === 'burn') {
      commit(null)
      setBurnQuantity('1')
      return
    }
    const current = jobRef.current
    const after = current && withConfirmed(current)
    commit(after)
    // After the last batch the list goes too: its batches are on chain, and keeping them would send them twice.
    if (!after) setText('')
  }

  async function readAgain() {
    setReading(true)
    const answer = await settled(server.read())
    setReading(false)
    if (answer.ok) setView(answer.data)
    else toast.error(answer.error)
  }

  const symbol = chain.nativeSymbol
  const fee = view.feePerTokenWei
  const left = view.left
  const owner = view.owner
  const blocked = owner !== null && owner.toLowerCase() !== wallet.toLowerCase() ? NOT_OWNER(owner) : null
  // The first reason that applies: the chain unread, then the owner check (the dialogs open, their action off),
  // then a hash waiting to be confirmed.
  const off = !reachable ? UNREADABLE_REASON : !blocked && job?.pending ? PENDING_REASON : null
  const sending = job?.kind === 'airdrop' ? job : null
  const rows = sending ? sending.batches.flat() : result.rows
  const tokens = tokensOf(rows)
  const batches = sending ? sending.batches : batchesOf(rows)
  const unsent = sending ? unsentTokens(sending) : tokens
  const tooMany = left !== null && unsent > left
  const stale = deferred !== text
  const burnInvalid = left === null ? null : burnError(burnQuantity, left)
  const burnAmount = burnInvalid || left === null ? 0 : Number(burnQuantity)
  const burnLabel = `Burn ${tokensLabel(burnAmount)}`

  /** "Send airdrop" or "Send batch": freezes the list at the first send (not under the owner check) and opens batch `sent`. */
  function sendNext() {
    if (fee === null) return
    let active = sending
    if (!active) {
      active = frozenJob(result.rows)
      if (!blocked) commit(active)
    }
    setDialog({
      entries: active.batches[active.sent] ?? [],
      index: active.sent,
      total: active.batches.length,
      fee,
      key: Date.now(),
    })
    setDialogOpen(true)
  }

  const dialogTokens = dialog ? tokensOf(dialog.entries) : 0

  return (
    <ManageActionsProvider value={target}>
      <div className="grid gap-10">
        <div className="grid gap-4">
          {reachable ? (
            <div className="text-muted-foreground -mt-4 flex flex-wrap items-center gap-3 text-sm">
              <span>Read from the chain {relativeTo(view.readAt, now)}</span>
              <Button variant="ghost" size="sm" onClick={() => void readAgain()} disabled={reading}>
                {reading ? <Spinner /> : <RefreshCwIcon aria-hidden="true" />}
                Read again
              </Button>
            </div>
          ) : (
            <Alert variant="destructive">
              <TriangleAlertIcon aria-hidden="true" />
              <AlertTitle>The contract could not be read</AlertTitle>
              <AlertDescription>
                <p>
                  The history below is Cobweb&apos;s record of the batches it confirmed. The fee and the
                  tokens left to mint are not shown, and sending waits until the contract can be read.
                </p>
                <Button variant="secondary" size="sm" onClick={() => void readAgain()} disabled={reading}>
                  {reading ? <Spinner /> : <RefreshCwIcon aria-hidden="true" />}
                  Read again
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {blocked && owner && (
            <Alert>
              <UserXIcon aria-hidden="true" />
              <AlertTitle>This wallet is not the contract&apos;s owner</AlertTitle>
              <AlertDescription>
                <p>
                  Changes on chain need <span className="numeric break-all">{owner}</span>.
                </p>
              </AlertDescription>
            </Alert>
          )}
          {job?.pending && !dialogOpen && !burnOpen && (
            <PendingBatchPanel
              job={job}
              chain={chain}
              server={server}
              onView={setView}
              onConfirmed={() => advance(job.kind)}
              onForget={pendingBatch.forget}
              onDiscard={() => {
                pendingBatch.forget()
                setFailure(DISCARDED)
              }}
            />
          )}
        </div>

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <Panel
            title="Recipients"
            description={
              burn
                ? 'How many tokens to burn. They go to the dead address.'
                : 'Who gets tokens, and how many each.'
            }
            bodyClassName="grid gap-5 p-5 lg:p-6"
          >
            <div className="bg-surface-2/50 flex items-center justify-between gap-4 rounded-lg border px-4 py-3">
              <div className="grid gap-0.5">
                <label htmlFor="airdrop-burn" className="flex items-center gap-2 text-sm font-medium">
                  <FlameIcon aria-hidden="true" className="text-destructive-foreground size-4" />
                  Burn instead of sending
                </label>
                <p id="airdrop-burn-help" className="text-muted-foreground text-[0.8125rem]">
                  {job?.kind === 'burn'
                    ? 'Confirm or discard the waiting burn first.'
                    : job
                      ? 'Finish or stop the airdrop in progress first.'
                      : 'Mints a quantity to the dead address, shrinking what is left to sell.'}
                </p>
              </div>
              <Switch
                id="airdrop-burn"
                checked={burn}
                onCheckedChange={setBurn}
                disabled={!!job}
                aria-describedby="airdrop-burn-help"
              />
            </div>

            {burn ? (
              <BurnQuantity
                quantity={burnQuantity}
                onChange={setBurnQuantity}
                error={burnInvalid}
                remaining={left}
              />
            ) : sending ? (
              <div className="grid gap-2 text-sm">
                <p>
                  Sending to <span className="numeric">{count(rows.length)}</span> wallets in{' '}
                  <span className="numeric">{count(sending.batches.length)}</span>{' '}
                  {sending.batches.length === 1 ? 'transaction' : 'transactions'}. The list is locked until
                  every batch is sent.
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-fit"
                  disabled={!!sending.pending}
                  title={sending.pending ? PENDING_REASON : undefined}
                  onClick={() => {
                    // Batches already sent are on chain; keeping them in the list would send them twice.
                    if (sending.sent > 0) setText('')
                    commit(null)
                    setFailure(null)
                  }}
                >
                  {sending.sent > 0 ? 'Stop and drop the unsent batches' : 'Edit the list'}
                </Button>
              </div>
            ) : (
              <>
                <RecipientsInput
                  text={text}
                  onTextChange={setText}
                  options={PARSE}
                  template={TEMPLATE}
                  snapshot={snapshot}
                />
                <ParsePreview result={result} amountName="tokens" />
              </>
            )}
          </Panel>

          <aside
            aria-label="Quote"
            className="bg-card shadow-raised grid gap-4 rounded-xl border p-5 lg:sticky lg:top-6"
          >
            <h2 className="text-heading">Quote</h2>
            {burn ? (
              <>
                <p className="text-sm">
                  {burnLabel} to <span className="numeric">{shortAddress(BURN_ADDRESS, 6)}</span>
                </p>
                <dl className="divide-y">
                  <Row label="Tokens">{count(burnAmount)}</Row>
                  <Row label="Fee per token">{fee === null ? 'Not read' : formatNative(fee, symbol)}</Row>
                  <Row label="Transactions">1</Row>
                  <Row label="Total fee" strong>
                    {fee === null ? 'Not read' : formatNative(mulWei(fee, burnAmount), symbol)}
                  </Row>
                </dl>
                <SupplyNote
                  remaining={left}
                  after={left === null ? null : left - burnAmount}
                  label="After the burn"
                />
                <p className="text-muted-foreground text-[0.8125rem]">
                  Burned tokens use collection supply for good. This cannot be undone.
                </p>
                <Button
                  variant="destructive"
                  disabled={!!burnInvalid || !!off || fee === null || left === null}
                  title={off ?? undefined}
                  onClick={() => {
                    if (fee === null) return
                    setBurnDialog({ key: Date.now(), amount: burnAmount, fee })
                    setBurnOpen(true)
                  }}
                >
                  <FlameIcon aria-hidden="true" />
                  {burnLabel}
                </Button>
              </>
            ) : (
              <>
                <dl className="divide-y">
                  <Row label="Recipients">{count(rows.length)}</Row>
                  <Row label="Tokens">{count(tokens)}</Row>
                  <Row label="Fee per token">{fee === null ? 'Not read' : formatNative(fee, symbol)}</Row>
                  <Row label="Transactions">{count(batches.length)}</Row>
                  <Row label="Total fee" strong>
                    {fee === null ? 'Not read' : formatNative(mulWei(fee, tokens), symbol)}
                  </Row>
                </dl>
                <p className="text-muted-foreground text-[0.8125rem]">
                  Exact: the fee is a flat {symbol} amount held by the contract, so nothing is added for price
                  movement. If Cobweb changes it before you send, the check step shows the new fee.
                </p>
                <p className="text-muted-foreground text-[0.8125rem]">
                  Up to 500 wallets and 1,000 tokens go in each transaction.
                </p>
                <SupplyNote
                  remaining={left}
                  after={left === null || tooMany ? null : left - unsent}
                  label="After this airdrop"
                />
                <p className="text-muted-foreground text-[0.8125rem]">
                  Airdrops use collection supply but no phase&apos;s allocation, so they can leave the phases
                  less to sell.
                </p>
                {sending && (
                  <ol className="grid gap-1.5" aria-label="Batches">
                    {sending.batches.map((items, index) => {
                      const current = index === sending.sent
                      return (
                        <li key={index} className="grid gap-0.5 text-sm">
                          <div className="flex items-center justify-between">
                            <span>
                              Batch {index + 1}{' '}
                              <span className="numeric text-muted-foreground">({count(items.length)})</span>
                            </span>
                            {index < sending.sent ? (
                              <StatusBadge status="done">Sent</StatusBadge>
                            ) : current && sending.pending ? (
                              <StatusBadge status="pending">Confirming</StatusBadge>
                            ) : current && failure ? (
                              <StatusBadge status="error">Failed</StatusBadge>
                            ) : (
                              <StatusBadge status="draft">{current ? 'Next' : 'Waiting'}</StatusBadge>
                            )}
                          </div>
                          {current && !sending.pending && failure && (
                            <p className="text-destructive-foreground text-[0.8125rem]">{failure}</p>
                          )}
                        </li>
                      )
                    })}
                  </ol>
                )}
                {tooMany && left !== null && (
                  <p role="alert" className="text-destructive-foreground text-sm">
                    {count(unsent)} tokens is more than the {count(left)} left. Remove some recipients.
                  </p>
                )}
                <Button
                  onClick={sendNext}
                  disabled={rows.length === 0 || tooMany || stale || !!off || fee === null}
                  title={off ?? undefined}
                >
                  <SendIcon aria-hidden="true" />
                  {sending
                    ? failure
                      ? `Retry batch ${sending.sent + 1}`
                      : `Send batch ${sending.sent + 1} of ${sending.batches.length}`
                    : batches.length > 1
                      ? `Send batch 1 of ${batches.length}`
                      : 'Send airdrop'}
                </Button>
              </>
            )}
          </aside>
        </div>

        <Panel
          title="History"
          description="Batches Cobweb confirmed. Airdrops sent from outside Cobweb are not listed."
          bodyClassName="p-0 pb-2"
          action={
            <Button
              variant="ghost"
              size="sm"
              disabled={view.history.length === 0}
              onClick={() => downloadText('airdrop-history.csv', airdropHistoryCsv(view.history, chain))}
            >
              <DownloadIcon aria-hidden="true" />
              Export CSV
            </Button>
          }
        >
          <AirdropHistory airdrops={view.history} chain={chain} readAt={view.readAt} />
        </Panel>

        {burnDialog && left !== null && (
          <BurnDialog
            key={burnDialog.key}
            open={burnOpen}
            onOpenChange={setBurnOpen}
            chain={chain}
            amount={burnDialog.amount}
            remaining={left}
            feePerTokenWei={burnDialog.fee}
            blocked={blocked}
            confirm={(hash) => server.confirm(hash)}
            pending={{
              remember: (hash) => commit(burnJob(burnDialog.amount, hash)),
              forget: pendingBatch.forget,
            }}
            onBurned={(next) => {
              setView(next)
              advance('burn')
            }}
          />
        )}

        {dialog && (
          <TransactionDialog
            key={dialog.key}
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            chain={chain}
            blocked={blocked}
            title={dialog.total > 1 ? `Send batch ${dialog.index + 1} of ${dialog.total}` : 'Send airdrop'}
            description={`${tokensLabel(dialogTokens)} to ${walletsLabel(dialog.entries.length)}. ${dialogTokens === 1 ? 'It arrives' : 'They arrive'} as soon as the transaction confirms.`}
            actionLabel="Send airdrop"
            successMessage={`${tokensLabel(dialogTokens)} airdropped`}
            request={batchRequest(
              dialog.entries,
              dialog.fee,
              chain,
              (hash) => server.confirm(hash),
              pendingBatch,
            )}
            onConfirmed={(next) => {
              setView(next)
              advance('airdrop')
            }}
            onFailed={setFailure}
          />
        )}
      </div>
    </ManageActionsProvider>
  )
}
```

- [ ] **Step 5: The page, and the sample's dead address**

Replace the whole of `apps/web/src/app/collections/[id]/manage/airdrop/page.tsx` with:

```tsx
import { getAddress } from 'viem'
import { getAirdrop } from '@/app/actions/airdrop'
import { AirdropScreen } from '@/components/manage/airdrop-screen'
import { sampleAirdropView } from '@/components/manage/airdrop-sim'
import { ManageUnavailable } from '@/components/manage/manage-unavailable'
import { StagePage } from '@/components/shell/stage-page'
import { requireOwnedCollection, requireUser } from '@/lib/auth'
import { DEMO_MINTER, SUPPORTED_CHAINS } from '@/lib/demo'
import type { AirdropView } from '@/lib/manage/airdrop-types'
import { snapshotChains } from '@/lib/manage/snapshot-core'
import {
  LockedStagePage,
  searchParam,
  stageContext,
  type CollectionParams,
  type SearchParams,
} from '../../_lib/stage'

/** The holder snapshot runs as a server action from this page: up to 20,000 `ownerOf` reads. */
export const maxDuration = 300

const TITLE = 'Airdrop'
const DESCRIPTION =
  'Send tokens straight to wallets, or burn some. Each token costs the airdrop fee and uses collection supply.'

/**
 * Manage drop, Airdrop (docs/specs/2026-10-15-airdrop-settings.md, section 7.3): the contract's fee, supply and
 * owner read on the server, with Cobweb's records of the batches it confirmed. Sample mode only
 * (`NEXT_PUBLIC_DEMO_DATA=1`): the sample on any collection, `?chain=unreachable` shows the record alone with its
 * alert, `?owner=other` the owner check, `?batch=pending` a batch waiting to be confirmed.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: CollectionParams
  searchParams: SearchParams
}) {
  const { id } = await params
  const collection = await requireOwnedCollection(id)
  const user = await requireUser()
  const ctx = stageContext(collection, 'manage', 'manage')
  if (ctx.access === 'locked') return <LockedStagePage collection={collection} stage="manage" />
  const wallet = getAddress(user.walletAddress)

  let view: AirdropView
  if (ctx.demo) {
    view = sampleAirdropView(collection, wallet, {
      chainReachable: (await searchParam(searchParams, 'chain')) !== 'unreachable',
      owner: (await searchParam(searchParams, 'owner')) === 'other' ? getAddress(DEMO_MINTER) : undefined,
    })
  } else {
    const result = await getAirdrop(collection.id)
    if (!result.ok)
      return (
        <StagePage title={TITLE} description={DESCRIPTION} width="default">
          <ManageUnavailable title="The airdrop could not be read" message={result.error} />
        </StagePage>
      )
    view = result.data
  }

  return (
    <StagePage title={TITLE} description={DESCRIPTION} width="default">
      <AirdropScreen
        collection={collection}
        view={view}
        wallet={wallet}
        sample={ctx.demo}
        samplePending={ctx.demo && (await searchParam(searchParams, 'batch')) === 'pending'}
        snapshotChainIds={ctx.demo ? SUPPORTED_CHAINS.map((entry) => entry.id) : snapshotChains()}
      />
    </StagePage>
  )
}
```

In `apps/web/src/lib/demo/data.ts`, replace:

```ts
export const DEMO_MINTER: Address = '0x3b9d2c1a0f8e7d6c5b4a39281706f5e4d3c2b1a0'
export const DEMO_VAULT: Address = '0x9c8b7a6f5e4d3c2b1a09f8e7d6c5b4a392817065'
export const DEAD_ADDRESS: Address = '0x000000000000000000000000000000000000dead'

// ---------------------------------------------------------------------------------------------
```

with:

```ts
export const DEMO_MINTER: Address = '0x3b9d2c1a0f8e7d6c5b4a39281706f5e4d3c2b1a0'
export const DEMO_VAULT: Address = '0x9c8b7a6f5e4d3c2b1a09f8e7d6c5b4a392817065'

// ---------------------------------------------------------------------------------------------
```

- [ ] **Step 6: Typecheck, lint, test and build**

Run: `pnpm --filter @cobweb/web typecheck && pnpm --filter @cobweb/web lint && pnpm --filter @cobweb/web test && pnpm --filter @cobweb/web build`
Expected: no type or lint error; the web tests pass unchanged (701 in 74 files); the build lists `/collections/[id]/manage/airdrop` among its routes.

- [ ] **Step 7: Format, run the root checks and commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
pnpm exec prettier --write apps/web/src/components/manage/bits.tsx apps/web/src/components/manage/whitelist-chunks.tsx apps/web/src/components/manage/airdrop-dialogs.tsx apps/web/src/components/manage/airdrop-parts.tsx apps/web/src/components/manage/airdrop-screen.tsx "apps/web/src/app/collections/[id]/manage/airdrop/page.tsx" apps/web/src/lib/demo/data.ts
pnpm typecheck && pnpm lint && pnpm test
git add apps/web/src/components/manage/bits.tsx apps/web/src/components/manage/whitelist-chunks.tsx apps/web/src/components/manage/airdrop-dialogs.tsx apps/web/src/components/manage/airdrop-parts.tsx apps/web/src/components/manage/airdrop-screen.tsx "apps/web/src/app/collections/[id]/manage/airdrop/page.tsx" apps/web/src/lib/demo/data.ts
git commit -m "$(cat <<'EOF'
Put the Airdrop tab on the contract's state: the list frozen into batches sent through the manage machine with the fee, the waiting batch with Check again and Discard, the burn to the dead address behind its typed confirmation, History from Cobweb's records and the owner check

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: test counts unchanged (shared 80, web 701).

---

### Task 10: Settings and the Overview on the settings view, and the sample-only seams removed

No unit test drives the screens (no component tests): their pure parts are tested in Tasks 3, 4, 6 and 7, and the screens are checked by typecheck, lint, the build and the browser walk (Task 11). Once Settings and the Overview's Reveal run on their own actions, nothing uses the seams that served a tab still on sample data, and Step 4 removes them with the one test that read them.

**Files:**

- Modify: `apps/web/src/components/manage/settings-dialogs.tsx`, `apps/web/src/components/manage/tradability.tsx`, `apps/web/src/components/manage/settings-screen.tsx` (whole files)
- Modify: `apps/web/src/app/collections/[id]/manage/settings/page.tsx` (whole file)
- Modify: `apps/web/src/components/manage/overview-cards.tsx`, `apps/web/src/components/manage/overview-screen.tsx` (whole files)
- Modify: `apps/web/src/app/collections/[id]/manage/page.tsx` (whole file)
- Modify: `apps/web/src/components/manage/manage-actions.ts`, `manage-context.tsx`, `manage-sim.ts`, `manage-sim.test.ts`, `manage-machine.ts`, `manage-machine.test.ts`, `transaction-dialog.tsx` (the seams)

**Interfaces:**

- Consumes: `getSettings` (Task 5) with `getDeployment` and `getPhases` (already there); `settingsServer(collectionId)` (Task 6), `sampleSettingsView(collection, wallet, options)` and `sampleSettingsServer(current)` (Task 7); `settingsCalls`, `reviewOf`, `ManageCall` (Task 4); `TRANSFER_LEVELS`, `TransferLevelValue`, `ipfsUriValid`, `tokenUriOf`, `SettingsView`, `RevealPointer`, `RevealTargets` (Task 3); `NOT_OWNER`, `IPFS_LINK_INVALID` (Task 3); `DEFAULT_TRANSFER_VALIDATOR` (Task 1); `TransactionDialog` with `blocked` (Task 6); `realManageActions` and `sampleManageActions(current, sent?, settings?)` (Tasks 4 and 7); `ManageActionsProvider`; `UNREADABLE_REASON` (`./phase-row`); `Setting` (`./settings-parts`), `AddressLine`, `Row` (`./bits`); `requireOwnedCollection`, `requireUser`, `stageContext`, `searchParam`, `LockedStagePage`; the demo values the Overview still reads until Phase 6 (`DEMO_ACTIVITY`).
- Produces:
  - in `settings-dialogs.tsx`: `SettingsDialogBase = { open; onOpenChange; chain; blocked: string | null; confirm(hash, call); onConfirmed(view) }`, `settingsRequest(call, chain, confirm): ManageRequest<SettingsView>` (the review's contract is the transfer validator for the level call), `PayoutDialog`, `RoyaltyDialog` (0 to 10% with up to two decimals), `RevealDialog` (three sources: "Rendered metadata", "Placeholder" whenever a placeholder job exists, "Another IPFS link" under the red warning; token 1's URI now and after)
  - in `tradability.tsx`: `TradabilitySettings({ view, chain, off, blocked, confirm, onConfirmed })` (the validator with "Change validator", the level control only when the validator has code)
  - `SettingsScreen({ collection, view, wallet, sample })` and `OverviewScreen({ collection, contract, deployedAt, chain, groups, activity, totalMinted, maxSupply, readAt, chainReachable, slug, settings, wallet, sample, paidByMintersWei })`, each under its own `ManageActionsProvider`; `OverviewHeader` reads the pointer (Revealed, Placeholder or Custom) and Reveal from the settings view
  - the seams: `TxRequest = { contract; functionName; args }` (no `valueWei`, no `check`); `ManageActions` without `review`; `ManageRequest.call: ManageCall`; `useManageActions()` throws 'ManageActionsProvider is missing.' outside a provider; `SAMPLE = { mintPage }`; `sampleRequest` gone

- [ ] **Step 1: The Settings dialogs and tradability**

Decision (sections 7.4 and 7.5): the Custom pointer reads `<Badge variant="warning">Custom</Badge>`.

Replace the whole of `apps/web/src/components/manage/settings-dialogs.tsx` with:

```tsx
'use client'

import { TriangleAlertIcon } from 'lucide-react'
import { useId, useState } from 'react'
import { getAddress, isAddress, type Hex } from 'viem'
import { Alert, AlertDescription, AlertTitle } from '@cobweb/ui/components/alert'
import { Field, FieldDescription, FieldError, FieldLabel } from '@cobweb/ui/components/field'
import { Input } from '@cobweb/ui/components/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '@cobweb/ui/components/input-group'
import { RadioGroup, RadioGroupItem } from '@cobweb/ui/components/radio-group'
// Royalty limits are Deploy's: 0 to 10%, in whole basis points, as in legacy.
import { MAX_ROYALTY_PERCENT, royaltyBps as royaltyPercentToBps } from '@/components/deploy/deploy-form'
import { IPFS_LINK_INVALID, type ActionResult } from '@/lib/art/result'
import type { Address, SupportedChain } from '@/lib/demo'
import { reviewOf, settingsCalls, type ManageCall } from '@/lib/manage/phase-calls'
import type { RevealPointer, RevealTargets, SettingsView } from '@/lib/manage/settings-types'
import { ipfsUriValid, tokenUriOf } from '@/lib/manage/settings-view'
import type { ManageRequest } from './manage-actions'
import { TransactionDialog } from './transaction-dialog'

/** What every Settings dialog takes: the dialog, the chain, the owner check, and the server's confirm. */
export type SettingsDialogBase = {
  open: boolean
  onOpenChange: (open: boolean) => void
  chain: SupportedChain
  /** The owner check's sentence: the dialog opens for reading, its action off. */
  blocked: string | null
  confirm: (hash: Hex, call: ManageCall) => Promise<ActionResult<SettingsView>>
  onConfirmed: (view: SettingsView) => void
}

/**
 * A Settings change as its dialog sends it (docs/specs/2026-10-15-airdrop-settings.md, section 7.4): the call, its
 * review from the ABI on its contract (the transfer validator for the level, else the collection), and the
 * server's confirm of the hash with the call.
 */
export function settingsRequest(
  call: ManageCall,
  chain: SupportedChain,
  confirm: SettingsDialogBase['confirm'],
): ManageRequest<SettingsView> {
  return {
    call,
    review: {
      contract: call.target ? 'Transfer validator' : 'Collection',
      functionName: call.functionName,
      args: reviewOf(call, chain),
    },
    confirm: (hash) => confirm(hash, call),
  }
}

/** The address a typed value resolves to, or why it does not. */
function readAddress(value: string): { address: Address | null; error: string | null } {
  const trimmed = value.trim()
  if (!trimmed) return { address: null, error: null }
  if (!isAddress(trimmed)) {
    return {
      address: null,
      error: /^0x[0-9a-fA-F]{40}$/.test(trimmed)
        ? 'The checksum does not match. Check the address for a typo.'
        : 'Enter a full 0x address, 42 characters.',
    }
  }
  if (/^0x0{40}$/i.test(trimmed))
    return { address: null, error: 'The zero address cannot receive anything. The contract refuses it.' }
  return { address: getAddress(trimmed), error: null }
}

/** Change where withdrawn proceeds are paid. */
export function PayoutDialog({
  current,
  confirm,
  onConfirmed,
  ...base
}: SettingsDialogBase & { current: Address }) {
  const id = useId()
  const [value, setValue] = useState('')
  const { address, error } = readAddress(value)
  const same = address?.toLowerCase() === current.toLowerCase()
  return (
    <TransactionDialog
      {...base}
      title="Change payout address"
      description="Every withdrawal from now on is paid here. Use an address you control; a wrong one cannot be reversed once funds are sent."
      actionLabel="Change address"
      successMessage="Payout address changed"
      request={address && !same ? settingsRequest(settingsCalls.payout(address), base.chain, confirm) : null}
      onConfirmed={onConfirmed}
    >
      <Field data-invalid={!!error || same}>
        <FieldLabel htmlFor={`${id}-address`}>New payout address</FieldLabel>
        <Input
          id={`${id}-address`}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="0x..."
          autoComplete="off"
          spellCheck={false}
          className="numeric"
          aria-invalid={!!error || same}
          aria-describedby={`${id}-address-help`}
        />
        {error || same ? (
          <FieldError id={`${id}-address-help`}>{error ?? 'That is the current payout address.'}</FieldError>
        ) : (
          <FieldDescription id={`${id}-address-help`} className="numeric break-all">
            {address ? `Checksummed: ${address}` : `Now ${current}`}
          </FieldDescription>
        )}
      </Field>
    </TransactionDialog>
  )
}

/** The default royalty (ERC-2981), enforced on secondary sales through the transfer validator. */
export function RoyaltyDialog({
  receiver,
  bps,
  confirm,
  onConfirmed,
  ...base
}: SettingsDialogBase & { receiver: Address; bps: number }) {
  const id = useId()
  const [percentValue, setPercent] = useState(String(bps / 100))
  const [receiverValue, setReceiver] = useState<string>(receiver)
  const { address, error: receiverError } = readAddress(receiverValue)
  const nextBps = royaltyPercentToBps(percentValue)
  const valid = nextBps !== null
  const unchanged = nextBps === bps && address?.toLowerCase() === receiver.toLowerCase()
  return (
    <TransactionDialog
      {...base}
      title="Royalties"
      description="The share of each resale paid to the recipient. Enforced on secondary sales through the transfer validator."
      actionLabel="Save royalties"
      successMessage="Royalties updated"
      request={
        nextBps !== null && address && !unchanged
          ? settingsRequest(settingsCalls.royalty(address, nextBps), base.chain, confirm)
          : null
      }
      onConfirmed={onConfirmed}
    >
      <div className="grid gap-5">
        <Field data-invalid={!valid} className="max-w-48">
          <FieldLabel htmlFor={`${id}-percent`}>Royalty</FieldLabel>
          <InputGroup>
            <InputGroupInput
              id={`${id}-percent`}
              value={percentValue}
              onChange={(event) => setPercent(event.target.value)}
              inputMode="decimal"
              className="numeric"
              aria-invalid={!valid}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupText>%</InputGroupText>
            </InputGroupAddon>
          </InputGroup>
          {!valid ? (
            <FieldError>Enter 0 to {MAX_ROYALTY_PERCENT}, with up to two decimals.</FieldError>
          ) : (
            <FieldDescription>
              <span className="numeric">{nextBps.toLocaleString('en-US')}</span> bps on chain. 0 to{' '}
              {MAX_ROYALTY_PERCENT}%.
            </FieldDescription>
          )}
        </Field>
        <Field data-invalid={!!receiverError}>
          <FieldLabel htmlFor={`${id}-receiver`}>Recipient</FieldLabel>
          <Input
            id={`${id}-receiver`}
            value={receiverValue}
            onChange={(event) => setReceiver(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            className="numeric"
            aria-invalid={!!receiverError}
          />
          {receiverError && <FieldError>{receiverError}</FieldError>}
        </Field>
      </div>
    </TransactionDialog>
  )
}

type Source = 'rendered' | 'placeholder' | 'custom'

/** Each source Reveal offers: its label, what it is, the action and the toast. */
const SOURCES: Record<Source, { label: string; description: string; action: string; success: string }> = {
  rendered: {
    label: 'Rendered metadata',
    description: 'From the art you locked and rendered on Cobweb.',
    action: 'Reveal',
    success: 'Metadata updated. The collection is revealed.',
  },
  placeholder: {
    label: 'Placeholder',
    description: 'The placeholder every token showed before the reveal.',
    action: 'Use the placeholder',
    success: 'Metadata updated. Every token shows the placeholder.',
  },
  custom: {
    label: 'Another IPFS link',
    description:
      'A metadata link you pinned yourself: a folder ending in / gives each token its own file, and a single file is shown for every token.',
    action: 'Use this link',
    success: 'Metadata updated. The collection points at your link.',
  },
}

/**
 * Reveal and change the metadata (docs/specs/2026-10-15-airdrop-settings.md, section 7.4): the base URI to the
 * rendered metadata (the real job's, exactly), back to the placeholder, or to another IPFS link, with what token 1
 * resolves to now and after by the contract's rule. It opens on the first source that would change something.
 */
export function RevealDialog({
  current,
  targets,
  pointer,
  confirm,
  onConfirmed,
  ...base
}: SettingsDialogBase & { current: string; targets: RevealTargets; pointer: RevealPointer }) {
  const id = useId()
  const uriOf = (source: Source) =>
    source === 'rendered' ? targets.real : source === 'placeholder' ? targets.placeholder : null
  const offered = (['rendered', 'placeholder', 'custom'] as const).filter(
    (source) => source === 'custom' || uriOf(source) !== null,
  )
  const [source, setSource] = useState<Source>(
    () => offered.find((candidate) => candidate === 'custom' || uriOf(candidate) !== current) ?? 'custom',
  )
  const [link, setLink] = useState('')
  const typed = link.trim()
  const linkValid = ipfsUriValid(typed)
  const target = source === 'custom' ? (linkValid ? typed : null) : uriOf(source)
  const words = SOURCES[source]

  return (
    <TransactionDialog
      {...base}
      className="sm:max-w-xl"
      destructive={source === 'custom'}
      title={pointer === 'placeholder' ? 'Reveal the art' : 'Change the metadata'}
      description={
        pointer === 'placeholder'
          ? 'Holders and marketplaces see the real tokens once this confirms. Marketplaces refresh on the metadata update event, which can take a few minutes.'
          : 'Holders and marketplaces see the new metadata once this confirms. Marketplaces refresh on the metadata update event, which can take a few minutes.'
      }
      actionLabel={words.action}
      successMessage={words.success}
      request={
        target && target !== current
          ? settingsRequest(settingsCalls.baseUri(target), base.chain, confirm)
          : null
      }
      onConfirmed={onConfirmed}
    >
      <div className="grid gap-5">
        <RadioGroup value={source} onValueChange={(value) => setSource(value as Source)} className="gap-3">
          {offered.map((option) => (
            <label key={option} htmlFor={`${id}-${option}`} className="flex items-start gap-3 text-sm">
              <RadioGroupItem id={`${id}-${option}`} value={option} className="mt-0.5" />
              <span>
                <span className="font-medium">
                  {SOURCES[option].label}
                  {uriOf(option) === current && (
                    <span className="text-muted-foreground font-normal"> (now)</span>
                  )}
                </span>
                <span className="text-muted-foreground block text-[0.8125rem]">
                  {SOURCES[option].description}
                </span>
              </span>
            </label>
          ))}
        </RadioGroup>
        {source === 'custom' && (
          <Alert variant="destructive">
            <TriangleAlertIcon aria-hidden="true" />
            <AlertTitle>Check the link before you confirm</AlertTitle>
            <AlertDescription>
              Pointing the collection at the wrong IPFS link breaks the art and metadata of every token
              already minted. Check the CID before you confirm.
            </AlertDescription>
          </Alert>
        )}
        {source === 'custom' && (
          <Field data-invalid={!!typed && !linkValid}>
            <FieldLabel htmlFor={`${id}-link`}>IPFS link</FieldLabel>
            <Input
              id={`${id}-link`}
              value={link}
              onChange={(event) => setLink(event.target.value)}
              placeholder="ipfs://bafy.../"
              className="numeric"
              autoComplete="off"
              spellCheck={false}
            />
            {typed && !linkValid && <FieldError>{IPFS_LINK_INVALID}</FieldError>}
          </Field>
        )}
        <dl className="grid gap-3 text-[0.8125rem] sm:grid-cols-2">
          <div className="bg-well shadow-inset grid gap-1 rounded-lg border p-3">
            <dt className="text-muted-foreground">Token 1 now</dt>
            <dd className="numeric break-all">{tokenUriOf(current)}</dd>
          </div>
          <div className="grid gap-1 rounded-lg border border-border-strong p-3">
            <dt className="text-muted-foreground">Token 1 after</dt>
            <dd className="numeric break-all">{target ? tokenUriOf(target) : 'Enter a link'}</dd>
          </div>
        </dl>
      </div>
    </TransactionDialog>
  )
}
```

Replace the whole of `apps/web/src/components/manage/tradability.tsx` with:

```tsx
'use client'

import { LockIcon, LockOpenIcon, ShieldAlertIcon } from 'lucide-react'
import { useId, useState } from 'react'
import { getAddress, isAddress, zeroAddress, type Hex } from 'viem'
import { DEFAULT_TRANSFER_VALIDATOR } from '@cobweb/shared'
import { Alert, AlertDescription } from '@cobweb/ui/components/alert'
import { Badge } from '@cobweb/ui/components/badge'
import { Button } from '@cobweb/ui/components/button'
import { Checkbox } from '@cobweb/ui/components/checkbox'
import { Field, FieldDescription, FieldError, FieldLabel } from '@cobweb/ui/components/field'
import { Input } from '@cobweb/ui/components/input'
import { RadioGroup, RadioGroupItem } from '@cobweb/ui/components/radio-group'
import { StatusBadge } from '@cobweb/ui/components/status-badge'
import { ChainName } from '@/components/chains/chain-icon'
import type { ActionResult } from '@/lib/art/result'
import type { Address, SupportedChain } from '@/lib/demo'
import { settingsCalls, type ManageCall } from '@/lib/manage/phase-calls'
import type { SettingsView, TransferLevelState } from '@/lib/manage/settings-types'
import { TRANSFER_LEVELS, type TransferLevelValue } from '@/lib/manage/settings-view'
import { AddressLine } from './bits'
import { settingsRequest, type SettingsDialogBase } from './settings-dialogs'
import { Setting } from './settings-parts'
import { TransactionDialog } from './transaction-dialog'

/**
 * Tradability, as two rows of Settings, Advanced (docs/specs/2026-10-15-airdrop-settings.md, section 7.4): the
 * collection's transfer validator and the level it holds for the collection. The validator decides whether and
 * where tokens can be traded, and it is what enforces royalties on secondary sales. `off` is why nothing can be
 * changed now (the chain unread); `blocked` the owner check, under which the dialogs open with their action off.
 */
export function TradabilitySettings({
  view,
  chain,
  off,
  blocked,
  confirm,
  onConfirmed,
}: {
  view: SettingsView
  chain: SupportedChain
  off: string | null
  blocked: string | null
  confirm(hash: Hex, call: ManageCall): Promise<ActionResult<SettingsView>>
  onConfirmed(view: SettingsView): void
}) {
  // One dialog at a time; `at` freezes the view it was opened with, so its text does not flip once it lands.
  const [dialog, setDialog] = useState<{ key: 'level' | 'validator'; id: number; at: SettingsView } | null>(
    null,
  )
  const [open, setOpen] = useState(false)
  const show = (key: 'level' | 'validator') => {
    setDialog({ key, id: Date.now(), at: view })
    setOpen(true)
  }
  const validator = view.transferValidator
  const level = view.level
  const base = { open, onOpenChange: setOpen, chain, blocked, confirm, onConfirmed }
  const atValidator = dialog?.at.transferValidator ?? null

  return (
    <>
      <Setting
        title="Transfer validator"
        description="Governs whether and where these tokens can be traded. Royalties are enforced on secondary sales through it."
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          {validator === null ? (
            <p className="text-muted-foreground text-sm">Not read</p>
          ) : (
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <AddressLine address={validator} chain={chain} />
              <Badge variant={validator === DEFAULT_TRANSFER_VALIDATOR ? 'secondary' : 'warning'}>
                {validator === DEFAULT_TRANSFER_VALIDATOR
                  ? 'Limit Break default'
                  : validator === zeroAddress
                    ? 'No validator'
                    : 'Custom'}
              </Badge>
            </div>
          )}
          <Button
            variant="destructive"
            size="sm"
            onClick={() => show('validator')}
            disabled={!!off || validator === null}
            title={off ?? undefined}
          >
            <ShieldAlertIcon aria-hidden="true" />
            Change validator
          </Button>
        </div>
      </Setting>

      <Setting
        title="Transfers"
        description="The validator's level for this collection: royalties enforced (the default), royalties not enforced, or locked. Mints and airdrops work at every level."
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <LevelState level={level} chain={chain} />
          {(level?.kind === 'unread' || level?.kind === 'level') && (
            <Button
              variant={
                level.kind === 'level' && level.level === TRANSFER_LEVELS.enforced
                  ? 'destructive'
                  : 'secondary'
              }
              size="sm"
              onClick={() => show('level')}
              disabled={!!off}
              title={off ?? undefined}
            >
              <ShieldAlertIcon aria-hidden="true" />
              Change level
            </Button>
          )}
        </div>
      </Setting>

      {dialog?.key === 'level' && atValidator && (
        <LevelDialog
          key={dialog.id}
          {...base}
          validator={atValidator}
          collection={dialog.at.contract}
          current={dialog.at.level?.kind === 'level' ? dialog.at.level.level : null}
        />
      )}
      {dialog?.key === 'validator' && atValidator && (
        <ValidatorDialog key={dialog.id} {...base} current={atValidator} />
      )}
    </>
  )
}

/** The level the validator holds for the collection, in the creator's words. */
function LevelState({ level, chain }: { level: TransferLevelState | null; chain: SupportedChain }) {
  if (level === null) return <p className="text-muted-foreground text-sm">Not read</p>
  if (level.kind === 'none')
    return level.reason === 'no-code' ? (
      <p className="text-muted-foreground text-sm">
        <ChainName chain={chain} className="text-foreground" iconClassName="size-3.5" /> has no transfer
        validator, so transfers cannot be locked there.
      </p>
    ) : (
      <p className="text-muted-foreground text-sm">No validator is set, so transfers are not checked.</p>
    )
  if (level.kind === 'unread')
    return (
      <p className="text-muted-foreground text-sm">
        The validator did not answer for this collection, so its level is not shown.
      </p>
    )
  if (level.level === TRANSFER_LEVELS.locked)
    return (
      <Badge variant="destructive" className="w-fit">
        <LockIcon aria-hidden="true" />
        Locked. Nobody can send, sell or list
      </Badge>
    )
  if (level.level === TRANSFER_LEVELS.open)
    return (
      <Badge variant="warning" className="w-fit">
        <LockOpenIcon aria-hidden="true" />
        Transferable, royalties not enforced
      </Badge>
    )
  if (level.level === TRANSFER_LEVELS.enforced)
    return <StatusBadge status="draft">Transferable, royalties enforced</StatusBadge>
  return <p className="text-sm">Level {level.level}, set outside Cobweb</p>
}

/** Legacy's three levels (OPEN_TO_ALL, FULLY_OPEN, SOULBOUND), in Cobweb's words, with the value the validator takes. */
const LEVELS: { value: TransferLevelValue; title: string; description: string }[] = [
  {
    value: TRANSFER_LEVELS.enforced,
    title: 'Royalties enforced',
    description: 'Holders can send and sell. Sales go through only where your royalty is paid. The default.',
  },
  {
    value: TRANSFER_LEVELS.open,
    title: 'Royalties not enforced',
    description:
      'Holders can send and sell anywhere, like a plain ERC-721. Royalties are up to the marketplace.',
  },
  {
    value: TRANSFER_LEVELS.locked,
    title: 'Locked',
    description: 'Nobody can send, sell or list until you change it back. Open listings stop working.',
  },
]

/** Change the collection's transfer level on its validator. Red for anything but the default. */
function LevelDialog({
  validator,
  collection,
  current,
  confirm,
  onConfirmed,
  ...base
}: SettingsDialogBase & { validator: Address; collection: Address; current: number | null }) {
  const id = useId()
  const [next, setNext] = useState<TransferLevelValue>(
    LEVELS.find((level) => level.value === current)?.value ?? TRANSFER_LEVELS.enforced,
  )
  const choice = LEVELS.find((level) => level.value === next) ?? LEVELS[0]!
  return (
    <TransactionDialog
      {...base}
      destructive={next !== TRANSFER_LEVELS.enforced}
      title="Transfer level"
      description="Applies to every token in the collection as soon as the transaction confirms. Mints and airdrops are not affected."
      actionLabel={`Set ${choice.title.toLowerCase()}`}
      successMessage={`Transfers: ${choice.title.toLowerCase()}`}
      request={
        next === current
          ? null
          : settingsRequest(settingsCalls.level(validator, collection, next), base.chain, confirm)
      }
      onConfirmed={onConfirmed}
    >
      <RadioGroup
        value={String(next)}
        onValueChange={(value) => setNext(Number(value) as TransferLevelValue)}
        className="gap-3"
      >
        {LEVELS.map((level) => (
          <label
            key={level.value}
            htmlFor={`${id}-${level.value}`}
            className="flex items-start gap-3 text-sm"
          >
            <RadioGroupItem id={`${id}-${level.value}`} value={String(level.value)} className="mt-0.5" />
            <span>
              <span className="font-medium">
                {level.title}
                {level.value === current && <span className="text-muted-foreground font-normal"> (now)</span>}
              </span>
              <span className="text-muted-foreground block text-[0.8125rem]">{level.description}</span>
            </span>
          </label>
        ))}
      </RadioGroup>
    </TransactionDialog>
  )
}

/** Point the collection at another transfer validator. Red, and confirmed with a tick box. */
function ValidatorDialog({
  current,
  confirm,
  onConfirmed,
  ...base
}: SettingsDialogBase & { current: Address }) {
  const id = useId()
  const [value, setValue] = useState('')
  const [understood, setUnderstood] = useState(false)
  const trimmed = value.trim()
  const address = isAddress(trimmed) ? getAddress(trimmed) : null
  const error = !trimmed
    ? null
    : !address
      ? 'Enter a full 0x address, 42 characters, with a matching checksum.'
      : address.toLowerCase() === current.toLowerCase()
        ? 'That is the current validator.'
        : null

  return (
    <TransactionDialog
      {...base}
      destructive
      title="Change the transfer validator"
      description="The validator decides whether and where every token in the collection can be traded, and it enforces your royalties on secondary sales."
      actionLabel="Change validator"
      successMessage="Transfer validator changed"
      request={
        address && !error && understood
          ? settingsRequest(settingsCalls.validator(address), base.chain, confirm)
          : null
      }
      onConfirmed={onConfirmed}
    >
      <div className="grid gap-5">
        <Alert variant="destructive">
          <ShieldAlertIcon aria-hidden="true" />
          <AlertDescription>
            A validator you have not checked can block every transfer or let tokens trade without paying
            royalties. Use only a validator you trust. The zero address removes the check entirely.
          </AlertDescription>
        </Alert>
        <Field data-invalid={!!error}>
          <FieldLabel htmlFor={`${id}-validator`}>New validator address</FieldLabel>
          <Input
            id={`${id}-validator`}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="0x..."
            autoComplete="off"
            spellCheck={false}
            className="numeric"
            aria-invalid={!!error}
            aria-describedby={`${id}-validator-help`}
          />
          {error ? (
            <FieldError id={`${id}-validator-help`}>{error}</FieldError>
          ) : (
            <FieldDescription id={`${id}-validator-help`} className="flex flex-wrap items-center gap-x-2">
              <span>
                Now <span className="numeric break-all">{current}</span>
              </span>
              {current !== DEFAULT_TRANSFER_VALIDATOR && (
                <Button
                  type="button"
                  variant="link"
                  size="xs"
                  className="h-auto px-0"
                  onClick={() => setValue(DEFAULT_TRANSFER_VALIDATOR)}
                >
                  Use the Limit Break default
                </Button>
              )}
            </FieldDescription>
          )}
        </Field>
        <label htmlFor={`${id}-understood`} className="flex items-start gap-3 text-sm">
          <Checkbox
            id={`${id}-understood`}
            checked={understood}
            onCheckedChange={(checked) => setUnderstood(checked === true)}
            className="mt-0.5"
          />
          I understand this changes where and whether holders can trade, and how royalties are enforced.
        </label>
      </div>
    </TransactionDialog>
  )
}
```

- [ ] **Step 2: The Settings screen and its page**

Replace the whole of `apps/web/src/components/manage/settings-screen.tsx` with:

```tsx
'use client'

import { RefreshCwIcon, TriangleAlertIcon, UserXIcon } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { Address, Hex } from 'viem'
import { useConfig } from 'wagmi'
import { Alert, AlertDescription, AlertTitle } from '@cobweb/ui/components/alert'
import { Badge } from '@cobweb/ui/components/badge'
import { Button } from '@cobweb/ui/components/button'
import { Spinner } from '@cobweb/ui/components/spinner'
import { StatusBadge } from '@cobweb/ui/components/status-badge'
import { Switch } from '@cobweb/ui/components/switch'
import { useChainClock } from '@/components/mint/use-chain-clock'
import { NOT_OWNER, THROWN, type ActionResult } from '@/lib/art/result'
import { chainView } from '@/lib/chain/chain-view'
import type { Tables } from '@/lib/database.types'
import { formatBps, formatNative, formatUtc } from '@/lib/demo'
import { settingsCalls, type ManageCall } from '@/lib/manage/phase-calls'
import type { SettingsView } from '@/lib/manage/settings-types'
import { AddressLine, Row } from './bits'
import { relativeTo } from './format'
import { realManageActions } from './manage-actions'
import { ManageActionsProvider, type ManageTarget } from './manage-context'
import { sampleManageActions, samplePhasesView } from './manage-sim'
import { UNREADABLE_REASON } from './phase-row'
import { PayoutDialog, RevealDialog, RoyaltyDialog, settingsRequest } from './settings-dialogs'
import { Setting, SettingsGroup as Group } from './settings-parts'
import { settingsServer, type SettingsServer } from './settings-server'
import { sampleSettingsServer } from './settings-sim'
import { TradabilitySettings } from './tradability'
import { TransactionDialog } from './transaction-dialog'

export type SettingsScreenProps = {
  collection: Tables<'collections'>
  /** The contract's settings and balances read on the server (or the copies, or the sample). */
  view: SettingsView
  /** The sign-in wallet: every change is sent from it, and the owner check compares it with the contract's owner. */
  wallet: Address
  sample: boolean
}

type DialogKey = 'withdraw' | 'payout' | 'royalty' | 'reveal' | 'onBehalf'

/** A server answer, or "Try again" when the action itself threw. */
async function settled<T>(call: Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await call
  } catch {
    return { ok: false, error: THROWN }
  }
}

/**
 * Manage drop, Settings (docs/specs/2026-10-15-airdrop-settings.md, section 7.4): Money (withdraw, payout address,
 * royalties), Metadata (reveal), and Advanced at the bottom (the transfer validator, the transfer level, mint on
 * behalf), all read from the contract at one block. Each change runs the manage machine from the sign-in wallet
 * and answers the fresh view, which replaces this one. Sample mode runs the same code on the sample actions and
 * server.
 */
export function SettingsScreen({ collection, view: initial, wallet, sample }: SettingsScreenProps) {
  const config = useConfig()
  const [view, setView] = useState(initial)
  const viewRef = useRef(view)
  viewRef.current = view
  const [reading, setReading] = useState(false)
  // One dialog at a time; it stays mounted after closing so a confirming transaction can finish.
  const [dialog, setDialog] = useState<{ key: DialogKey; id: number; at: SettingsView } | null>(null)
  const [open, setOpen] = useState(false)
  // Sample mode: what the simulated wallet sent, by hash.
  const [sampleSent] = useState(() => new Map<Hex, ManageCall>())
  const chain = chainView(view.chainId)
  const now = useChainClock(view.blockTimestamp)
  const reachable = view.chainReachable
  const maxSupply = collection.max_supply

  const server = useMemo<SettingsServer>(
    () => (sample ? sampleSettingsServer(() => viewRef.current) : settingsServer(collection.id)),
    [sample, collection.id],
  )
  const target = useMemo<ManageTarget>(
    () => ({
      actions: sample
        ? sampleManageActions(
            () => samplePhasesView({ max_supply: maxSupply }),
            sampleSent,
            () => viewRef.current,
          )
        : realManageActions(config, { chainId: view.chainId, contract: view.contract, wallet }),
      chainId: view.chainId,
      wallet,
    }),
    [sample, sampleSent, maxSupply, config, view.chainId, view.contract, wallet],
  )

  const show = (key: DialogKey) => {
    // `at` freezes the view the dialog was opened with, so its text does not flip once it lands.
    setDialog({ key, id: Date.now(), at: view })
    setOpen(true)
  }

  async function readAgain() {
    setReading(true)
    const answer = await settled(server.read())
    setReading(false)
    if (answer.ok) setView(answer.data)
    else toast.error(answer.error)
  }

  const symbol = chain.nativeSymbol
  const owner = view.owner
  const blocked = owner !== null && owner.toLowerCase() !== wallet.toLowerCase() ? NOT_OWNER(owner) : null
  const off = reachable ? null : UNREADABLE_REASON
  const balance = view.creatorBalanceWei
  const pending = view.pendingBalanceWei
  const confirm = (hash: Hex, call: ManageCall) => server.confirm(hash, call)
  const base = { open, onOpenChange: setOpen, chain, blocked, confirm, onConfirmed: setView }

  return (
    <ManageActionsProvider value={target}>
      <div className="grid gap-10">
        <div className="grid gap-4">
          {reachable ? (
            <div className="text-muted-foreground -mt-4 flex flex-wrap items-center gap-3 text-sm">
              <span>Read from the chain {relativeTo(view.readAt, now)}</span>
              <Button variant="ghost" size="sm" onClick={() => void readAgain()} disabled={reading}>
                {reading ? <Spinner /> : <RefreshCwIcon aria-hidden="true" />}
                Read again
              </Button>
            </div>
          ) : (
            <Alert variant="destructive">
              <TriangleAlertIcon aria-hidden="true" />
              <AlertTitle>The contract could not be read</AlertTitle>
              <AlertDescription>
                <p>
                  These are the payout address, royalties, metadata and transfer validator Cobweb last read,
                  on {formatUtc(view.readAt)}. Balances and the transfer level are not shown, and changes on
                  chain wait until it can be read.
                </p>
                <Button variant="secondary" size="sm" onClick={() => void readAgain()} disabled={reading}>
                  {reading ? <Spinner /> : <RefreshCwIcon aria-hidden="true" />}
                  Read again
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {blocked && owner && (
            <Alert>
              <UserXIcon aria-hidden="true" />
              <AlertTitle>This wallet is not the contract&apos;s owner</AlertTitle>
              <AlertDescription>
                <p>
                  Changes on chain need <span className="numeric break-all">{owner}</span>.
                </p>
              </AlertDescription>
            </Alert>
          )}
        </div>

        <Group title="Money">
          <Setting
            title="Withdraw proceeds"
            description="Sends your balance to the payout address. Platform fees are held apart and are not part of it."
          >
            <div className="grid gap-4">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="text-muted-foreground text-xs font-medium">Your balance</p>
                  <p className="numeric text-[2rem] leading-tight">
                    {balance === null ? 'Not read' : formatNative(balance, symbol)}
                  </p>
                </div>
                <Button
                  onClick={() => show('withdraw')}
                  disabled={!!off || balance === null || BigInt(balance) === 0n}
                  title={off ?? undefined}
                >
                  Withdraw
                </Button>
              </div>
              <dl className="divide-y border-t">
                <Row label="Withdrawn so far">{formatNative(view.withdrawnWei, symbol)}</Row>
                <Row label="Platform fees, paid to Cobweb">
                  {view.platformBalanceWei === null
                    ? 'Not read'
                    : formatNative(view.platformBalanceWei, symbol)}
                </Row>
                <Row label="Platform fees per token">
                  {view.fees === null
                    ? 'Not read'
                    : `${formatNative(view.fees.mintFeeFlatWei, symbol)} + ${formatBps(view.fees.mintFeeBps)} per mint, ${formatNative(view.fees.airdropFeePerTokenWei, symbol)} per airdrop`}
                </Row>
                {pending !== null && BigInt(pending) > 0n && (
                  <Row label="Refunds held for this wallet">{formatNative(pending, symbol)}</Row>
                )}
              </dl>
              {pending !== null && BigInt(pending) > 0n && (
                <p className="text-muted-foreground text-[0.8125rem]">
                  The contract could not send these back. This wallet can claim them from the contract.
                </p>
              )}
            </div>
          </Setting>

          <Setting
            title="Payout address"
            description="Where withdrawals are paid. Royalties have their own recipient below."
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <AddressLine address={view.payout} chain={chain} full className="max-w-full" />
              <Button
                variant="secondary"
                size="sm"
                onClick={() => show('payout')}
                disabled={!!off}
                title={off ?? undefined}
              >
                Change
              </Button>
            </div>
          </Setting>

          <Setting
            title="Royalties"
            description="Enforced on secondary sales through the transfer validator: a resale goes through only where the royalty is paid to the recipient."
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="grid gap-1">
                <p className="numeric text-2xl">{formatBps(view.royaltyBps)}</p>
                <p className="text-muted-foreground flex flex-wrap items-center gap-1 text-[0.8125rem]">
                  to <AddressLine address={view.royaltyReceiver} chain={chain} />
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => show('royalty')}
                disabled={!!off}
                title={off ?? undefined}
              >
                Edit
              </Button>
            </div>
          </Setting>
        </Group>

        <Group title="Metadata">
          <Setting
            title="Reveal"
            description="Before the reveal every token shows the placeholder. Revealing points the collection at the rendered metadata, so each token shows its own art and traits."
          >
            <div className="grid gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                {view.pointer === 'revealed' ? (
                  <StatusBadge status="done">Revealed</StatusBadge>
                ) : view.pointer === 'placeholder' ? (
                  <StatusBadge status="draft">Placeholder</StatusBadge>
                ) : (
                  <Badge variant="warning">Custom</Badge>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => show('reveal')}
                  disabled={!view.realArtRendered || !!off}
                  title={off ?? undefined}
                >
                  {view.pointer === 'placeholder' ? 'Reveal' : 'Change metadata'}
                </Button>
              </div>
              {!view.realArtRendered && (
                <p className="text-muted-foreground text-[0.8125rem]">
                  The real art is not rendered yet. Finish it in Art, then lock and upload it; Reveal opens
                  once it is on IPFS.
                </p>
              )}
              <p className="text-muted-foreground text-[0.8125rem]">
                Base URI <span className="numeric text-foreground break-all">{view.baseUri}</span>
              </p>
            </div>
          </Setting>
        </Group>

        <Group title="Advanced" id="advanced">
          <TradabilitySettings
            view={view}
            chain={chain}
            off={off}
            blocked={blocked}
            confirm={confirm}
            onConfirmed={setView}
          />
          <Setting
            title="Mint on behalf"
            description="Lets anyone pay to mint for another wallet, using that wallet's limit or quota; the tokens go to that wallet. Useful for card checkouts. Leave it off otherwise."
          >
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="mint-on-behalf" className="text-sm">
                {view.mintOnBehalf ? 'On' : 'Off'}
              </label>
              <Switch
                id="mint-on-behalf"
                aria-label="Mint on behalf"
                checked={view.mintOnBehalf}
                onCheckedChange={() => show('onBehalf')}
                disabled={!!off}
                title={off ?? undefined}
              />
            </div>
          </Setting>
        </Group>

        {dialog?.key === 'withdraw' && (
          <TransactionDialog
            key={dialog.id}
            open={open}
            onOpenChange={setOpen}
            chain={chain}
            blocked={blocked}
            title="Withdraw proceeds"
            description="The whole balance goes to the payout address in one transaction."
            actionLabel="Withdraw"
            successMessage="Proceeds withdrawn"
            request={settingsRequest(settingsCalls.withdraw(), chain, confirm)}
            onConfirmed={setView}
          >
            <dl className="divide-y rounded-lg border px-4">
              <Row label="Amount" strong>
                {formatNative(dialog.at.creatorBalanceWei ?? '0', symbol)}
              </Row>
              <Row label="To">
                <span className="break-all">{dialog.at.payout}</span>
              </Row>
            </dl>
          </TransactionDialog>
        )}
        {dialog?.key === 'payout' && <PayoutDialog key={dialog.id} {...base} current={dialog.at.payout} />}
        {dialog?.key === 'royalty' && (
          <RoyaltyDialog
            key={dialog.id}
            {...base}
            receiver={dialog.at.royaltyReceiver}
            bps={dialog.at.royaltyBps}
          />
        )}
        {dialog?.key === 'reveal' && (
          <RevealDialog
            key={dialog.id}
            {...base}
            current={dialog.at.baseUri}
            targets={dialog.at.targets}
            pointer={dialog.at.pointer}
          />
        )}
        {dialog?.key === 'onBehalf' && (
          <TransactionDialog
            key={dialog.id}
            open={open}
            onOpenChange={setOpen}
            chain={chain}
            blocked={blocked}
            title={dialog.at.mintOnBehalf ? 'Turn off mint on behalf' : 'Turn on mint on behalf'}
            description={
              dialog.at.mintOnBehalf
                ? 'Only wallets minting for themselves (or through a delegation) can mint.'
                : "Anyone can pay to mint for any wallet, which uses up that wallet's limit or quota. The wallet receives the tokens."
            }
            actionLabel={dialog.at.mintOnBehalf ? 'Turn off' : 'Turn on'}
            successMessage={dialog.at.mintOnBehalf ? 'Mint on behalf is off' : 'Mint on behalf is on'}
            request={settingsRequest(settingsCalls.mintOnBehalf(!dialog.at.mintOnBehalf), chain, confirm)}
            onConfirmed={setView}
          />
        )}
      </div>
    </ManageActionsProvider>
  )
}
```

Replace the whole of `apps/web/src/app/collections/[id]/manage/settings/page.tsx` with:

```tsx
import { getAddress } from 'viem'
import { getSettings } from '@/app/actions/settings'
import { ManageUnavailable } from '@/components/manage/manage-unavailable'
import { SettingsScreen } from '@/components/manage/settings-screen'
import { sampleSettingsView } from '@/components/manage/settings-sim'
import { StagePage } from '@/components/shell/stage-page'
import { requireOwnedCollection, requireUser } from '@/lib/auth'
import { DEMO_MINTER } from '@/lib/demo'
import type { SettingsView } from '@/lib/manage/settings-types'
import {
  LockedStagePage,
  searchParam,
  stageContext,
  type CollectionParams,
  type SearchParams,
} from '../../_lib/stage'

const TITLE = 'Settings'
const DESCRIPTION =
  'Withdraw proceeds, the payout address, royalties and reveal. Advanced holds tradability and mint on behalf.'

/**
 * Manage drop, Settings (docs/specs/2026-10-15-airdrop-settings.md, section 7.4): the contract's settings and
 * balances read on the server at one block, with the reveal targets and the withdrawals Cobweb confirmed. Sample
 * mode only (`NEXT_PUBLIC_DEMO_DATA=1`): the sample on any collection, `?chain=unreachable` shows the copies with
 * their alert, `?owner=other` the owner check, `?art=deferred` no real set to reveal to, `?art=revealed` a
 * collection already revealed.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: CollectionParams
  searchParams: SearchParams
}) {
  const { id } = await params
  const collection = await requireOwnedCollection(id)
  const user = await requireUser()
  const art = await searchParam(searchParams, 'art')
  const ctx = stageContext(collection, 'manage', 'manage', { art })
  if (ctx.access === 'locked') return <LockedStagePage collection={collection} stage="manage" />
  const wallet = getAddress(user.walletAddress)

  let view: SettingsView
  if (ctx.demo) {
    view = sampleSettingsView(collection, wallet, {
      chainReachable: (await searchParam(searchParams, 'chain')) !== 'unreachable',
      owner: (await searchParam(searchParams, 'owner')) === 'other' ? getAddress(DEMO_MINTER) : undefined,
      art,
    })
  } else {
    const result = await getSettings(collection.id)
    if (!result.ok)
      return (
        <StagePage title={TITLE} description={DESCRIPTION} width="default">
          <ManageUnavailable title="The settings could not be read" message={result.error} />
        </StagePage>
      )
    view = result.data
  }

  return (
    <StagePage title={TITLE} description={DESCRIPTION} width="default">
      <SettingsScreen collection={collection} view={view} wallet={wallet} sample={ctx.demo} />
    </StagePage>
  )
}
```

- [ ] **Step 3: The Overview**

Decision (section 7.5): the Overview's Reveal is off while the chain is not read (the Settings sentence), as well as while no real job is done; the Overview takes the contract and the deploy time from the record and no longer reads the sample `Deployment`.

Replace the whole of `apps/web/src/components/manage/overview-cards.tsx` with:

```tsx
'use client'

import { ArrowUpRightIcon, EyeIcon } from 'lucide-react'
import { useId, useState } from 'react'
import { toast } from 'sonner'
import type { Address, Hex } from 'viem'
import { Artwork } from '@cobweb/ui/components/artwork'
import { Badge } from '@cobweb/ui/components/badge'
import { Button } from '@cobweb/ui/components/button'
import { Progress } from '@cobweb/ui/components/progress'
import { Switch } from '@cobweb/ui/components/switch'
import { cn } from '@cobweb/ui/lib/utils'
import { ChainIcon } from '@/components/chains/chain-icon'
import {
  MintPageAddressField,
  type AddressCollection,
} from '@/components/collections/mint-page-address-field'
import type { ActionResult } from '@/lib/art/result'
import type { SupportedChain } from '@/lib/demo'
import type { ManageCall } from '@/lib/manage/phase-calls'
import type { SettingsView } from '@/lib/manage/settings-types'
import { AddressLine } from './bits'
import { count, percent, relativeTo } from './format'
import { saveOffChain, SAMPLE } from './manage-sim'
import { UNREADABLE_REASON } from './phase-row'
import { RevealDialog } from './settings-dialogs'

/** What the pointer's Reveal needs: the owner check, the server's confirm and where its fresh view goes. */
type RevealProps = {
  blocked: string | null
  confirm: (hash: Hex, call: ManageCall) => Promise<ActionResult<SettingsView>>
  onConfirmed: (view: SettingsView) => void
}

/**
 * The top of the overview, one compact row: the artwork, minted of supply, the contract, what the
 * contract points at right now (with Reveal), and holders. Minted reads "Not read" while the contract
 * cannot be read (`totalMinted` null); "deployed" is relative to the read's time (`readAt`).
 */
export function OverviewHeader({
  collectionId,
  name,
  contract,
  deployedAt,
  chain,
  totalMinted,
  maxSupply,
  readAt,
  holders,
  settings,
  ...reveal
}: {
  collectionId: string
  name: string
  contract: Address
  deployedAt: number
  chain: SupportedChain
  totalMinted: number | null
  maxSupply: number
  readAt: number
  holders: number
  settings: SettingsView
} & RevealProps) {
  return (
    <section
      aria-label="The drop at a glance"
      className="bg-card shadow-raised flex flex-wrap items-center gap-x-6 gap-y-4 rounded-xl border p-4"
    >
      <Artwork
        src={SAMPLE.mintPage.avatarUrl}
        alt={`${name} artwork`}
        seed={collectionId}
        className="size-14 shrink-0 rounded-lg border"
      />
      <Fact label="Minted" className="w-44 border-l-0 pl-0">
        {totalMinted === null ? (
          <p className="text-muted-foreground text-lg leading-tight">Not read</p>
        ) : (
          <>
            <p className="numeric flex items-center gap-2 text-lg leading-tight">
              <span>
                {count(totalMinted)}
                <span className="text-muted-foreground text-sm"> / {count(maxSupply)}</span>
              </span>
              {maxSupply > 0 && totalMinted >= maxSupply && (
                <Badge variant="success" className="h-5 font-sans">
                  Sold out
                </Badge>
              )}
            </p>
            <Progress
              size="sm"
              value={percent(totalMinted, maxSupply)}
              className="mt-1.5"
              aria-label={`${count(totalMinted)} of ${count(maxSupply)} minted`}
            />
          </>
        )}
      </Fact>
      <Fact
        label={
          <>
            <ChainIcon chainId={chain.id} className="size-3.5" />
            {chain.name}, deployed {relativeTo(deployedAt, readAt)}
          </>
        }
      >
        <AddressLine address={contract} chain={chain} />
      </Fact>
      <ContractPointer settings={settings} chain={chain} {...reveal} />
      <Fact label="Holders">
        <p className="numeric text-lg leading-tight">{count(holders)}</p>
      </Fact>
    </section>
  )
}

function Fact({
  label,
  className,
  children,
}: {
  label: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn('grid min-w-0 gap-1 border-l pl-6', className)}>
      <p className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">{label}</p>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

/** The CID of an `ipfs://` link (before the first "/" after it), shortened: `bafybe…7xyz`. */
function shortCid(uri: string): string {
  const cid = uri.replace(/^ipfs:\/\//, '').split('/')[0] ?? ''
  return cid.length > 14 ? `${cid.slice(0, 6)}…${cid.slice(-4)}` : cid
}

/**
 * What the contract's base URI points at (docs/specs/2026-10-15-airdrop-settings.md, section 7.5): the rendered
 * metadata, the placeholder or a custom link, from the settings view. Reveal opens the same dialog as Settings;
 * it is off while the real set is not rendered or the contract cannot be read.
 */
function ContractPointer({
  settings,
  chain,
  blocked,
  confirm,
  onConfirmed,
}: { settings: SettingsView; chain: SupportedChain } & RevealProps) {
  // `at` freezes the view the dialog was opened with, so its text does not flip once it lands.
  const [dialog, setDialog] = useState<{ id: number; at: SettingsView } | null>(null)
  const [open, setOpen] = useState(false)
  const off = !settings.realArtRendered
    ? 'The real art is not rendered yet. Reveal opens once it is on IPFS.'
    : settings.chainReachable
      ? null
      : UNREADABLE_REASON

  return (
    <Fact label="Points at">
      <div className="flex items-center gap-3">
        <p className="text-sm" title={settings.baseUri}>
          {settings.pointer === 'placeholder' ? (
            'Placeholder (unrevealed)'
          ) : (
            <>
              {settings.pointer === 'revealed' ? 'Revealed' : 'Custom'},{' '}
              <span className="numeric">{shortCid(settings.baseUri)}</span>
            </>
          )}
        </p>
        <Button
          variant="secondary"
          size="xs"
          disabled={off !== null}
          title={off ?? undefined}
          onClick={() => {
            setDialog({ id: Date.now(), at: settings })
            setOpen(true)
          }}
        >
          <EyeIcon aria-hidden="true" />
          {settings.pointer === 'placeholder' ? 'Reveal' : 'Change'}
        </Button>
      </div>
      {dialog !== null && (
        <RevealDialog
          key={dialog.id}
          open={open}
          onOpenChange={setOpen}
          chain={chain}
          blocked={blocked}
          confirm={confirm}
          onConfirmed={onConfirmed}
          current={dialog.at.baseUri}
          targets={dialog.at.targets}
          pointer={dialog.at.pointer}
        />
      )}
    </Fact>
  )
}

/**
 * The mint page link as a plain input with a check/save button, the public/private switch beside
 * it, and a way to open the page. With no link yet the switch is off and disabled.
 */
export function MintPageLinkBar({
  collection,
  initialPublished,
}: {
  collection: AddressCollection
  initialPublished: boolean
}) {
  const id = useId()
  const [slug, setSlug] = useState(collection.slug)
  const [published, setPublished] = useState(initialPublished)
  const [saving, setSaving] = useState(false)

  async function toggle(next: boolean) {
    setPublished(next)
    setSaving(true)
    try {
      // SEAM: the mint page settings server action (session and ownership checked) writes `published`.
      await saveOffChain()
      toast.success(next ? 'Mint page is public' : 'Mint page is private')
    } catch {
      setPublished(!next)
      toast.error('The mint page could not be updated. Try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section aria-label="Mint page" className="flex flex-wrap items-start gap-x-8 gap-y-4">
      <div className="min-w-0 flex-1 basis-96">
        <MintPageAddressField
          collection={{ ...collection, slug }}
          inline
          onSaved={(value) => setSlug(value.slug)}
        />
      </div>
      <div className="flex items-center gap-4 pt-7">
        <div className="flex items-center gap-2.5">
          <Switch
            id={`${id}-public`}
            checked={!!slug && published}
            onCheckedChange={toggle}
            disabled={!slug || saving}
            aria-describedby={`${id}-public-help`}
          />
          <div className="grid">
            <label htmlFor={`${id}-public`} className="text-sm font-medium">
              {slug && published ? 'Public' : 'Private'}
            </label>
            <span id={`${id}-public-help`} className="text-muted-foreground text-xs">
              {!slug
                ? 'Save a link first.'
                : published
                  ? 'Anyone with the link can mint.'
                  : 'Visitors see it is not available.'}
            </span>
          </div>
        </div>
        {slug && (
          <Button variant="ghost" size="sm" asChild>
            <a href={`/${slug}`} target="_blank" rel="noreferrer">
              Open mint page
              <ArrowUpRightIcon aria-hidden="true" />
            </a>
          </Button>
        )}
      </div>
    </section>
  )
}
```

Replace the whole of `apps/web/src/components/manage/overview-screen.tsx` with:

```tsx
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
import { SAMPLE, sampleManageActions, samplePhasesView } from './manage-sim'
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
  /** Holders and recent mints: sample until Phase 6. */
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
  /** "Paid by minters": the sample's in sample mode, null on real data until Phase 6. */
  paidByMintersWei: string | null
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
        <MintPageLinkBar collection={{ ...collection, slug }} initialPublished={SAMPLE.mintPage.published} />

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
```

Replace the whole of `apps/web/src/app/collections/[id]/manage/page.tsx` with:

```tsx
import { getAddress } from 'viem'
import { getDeployment } from '@/app/actions/deploy'
import { getPhases } from '@/app/actions/phases'
import { getSettings } from '@/app/actions/settings'
import { ManageUnavailable } from '@/components/manage/manage-unavailable'
import { OverviewScreen } from '@/components/manage/overview-screen'
import { sampleSettingsView } from '@/components/manage/settings-sim'
import { StagePage } from '@/components/shell/stage-page'
import { NOT_DEPLOYED } from '@/lib/art/result'
import { requireOwnedCollection, requireUser } from '@/lib/auth'
import { chainView } from '@/lib/chain/chain-view'
import {
  DEMO_ACTIVITY,
  DEMO_COLLECTION,
  DEMO_DEPLOYMENT,
  DEMO_NOW,
  getChain,
  sampleSupply,
  scaleSampleToSupply,
} from '@/lib/demo'
import {
  LockedStagePage,
  searchParam,
  stageContext,
  type CollectionParams,
  type SearchParams,
} from '../_lib/stage'

const TITLE = 'Overview'
const DESCRIPTION =
  'How the drop is doing: supply minted, the contract, the mint page, live phases and proceeds.'

/**
 * Manage drop, overview (docs/specs/2026-10-15-airdrop-settings.md, section 7.5). The header's chain, contract and
 * deploy time come from the deployment record; minted and the live phases from the server's read of the chain;
 * what the base URI points at, Reveal and proceeds from the settings read. Holders, the mint page bar's published
 * state and recent mints keep their sample values until Phase 6, and "Paid by minters" shows in sample mode only.
 * In sample mode `?art=deferred` shows the deferred-art scenario, whose real set is not rendered yet, and
 * `?art=revealed` a collection already revealed.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: CollectionParams
  searchParams: SearchParams
}) {
  const { id } = await params
  const collection = await requireOwnedCollection(id)
  const user = await requireUser()
  const art = await searchParam(searchParams, 'art')
  const ctx = stageContext(collection, 'manage', 'manage', { art })
  if (ctx.access === 'locked') return <LockedStagePage collection={collection} stage="manage" />
  const wallet = getAddress(user.walletAddress)

  if (ctx.demo) {
    const maxSupply = sampleSupply(collection.max_supply, DEMO_COLLECTION.maxSupply)
    const sample = scaleSampleToSupply(maxSupply)
    return (
      <StagePage title={TITLE} description={DESCRIPTION} width="wide">
        <OverviewScreen
          // Manage drop is the deployed collection's home; sample mode opens it before deploy, so the
          // mint page link reads as a deployed one there too (no reservation wording).
          collection={{ ...collection, status: 'deployed' }}
          contract={DEMO_DEPLOYMENT.contractAddress}
          deployedAt={DEMO_DEPLOYMENT.deployedAt}
          chain={getChain(DEMO_DEPLOYMENT.chainId)!}
          groups={sample.groups}
          activity={DEMO_ACTIVITY}
          totalMinted={sample.totalMinted}
          maxSupply={maxSupply}
          readAt={DEMO_NOW}
          chainReachable
          slug={collection.slug}
          settings={sampleSettingsView(collection, wallet, { art })}
          wallet={wallet}
          sample
          paidByMintersWei={DEMO_ACTIVITY.proceeds.grossWei}
        />
      </StagePage>
    )
  }

  const [record, phases, settings] = await Promise.all([
    getDeployment(collection.id),
    getPhases(collection.id),
    getSettings(collection.id),
  ])
  if (!record.ok || !record.data || !phases.ok || !settings.ok) {
    const message = !record.ok
      ? record.error
      : !phases.ok
        ? phases.error
        : !settings.ok
          ? settings.error
          : NOT_DEPLOYED
    return (
      <StagePage title={TITLE} description={DESCRIPTION} width="wide">
        <ManageUnavailable title="The drop could not be read" message={message} />
      </StagePage>
    )
  }
  const view = phases.data
  return (
    <StagePage title={TITLE} description={DESCRIPTION} width="wide">
      <OverviewScreen
        collection={collection}
        contract={record.data.contractAddress}
        deployedAt={record.data.deployedAt}
        chain={chainView(view.chainId)}
        groups={view.groups}
        activity={DEMO_ACTIVITY}
        totalMinted={view.chainReachable ? view.totalMinted : null}
        maxSupply={view.maxSupply}
        readAt={view.readAt}
        chainReachable={view.chainReachable}
        slug={collection.slug}
        settings={settings.data}
        wallet={wallet}
        sample={false}
        paidByMintersWei={null}
      />
    </StagePage>
  )
}
```

- [ ] **Step 4: The sample-only seams**

Decision (section 8): `SAMPLE` keeps only `mintPage`: `transferValidator`, `metadataCid` and `readAt` have no reader left.

In `apps/web/src/components/manage/manage-actions.ts`, replace:

```ts
 * (docs/specs/2026-10-15-phases.md, section 7.3): `realManageActions` runs wagmi on the collection,
```

with:

```ts
 * (docs/specs/2026-10-15-phases.md, section 7.3): `realManageActions` runs wagmi on the call's contract,
```

In `apps/web/src/components/manage/manage-actions.ts`, replace:

```ts
/** A contract call as the creator reviews it before signing. */
```

with:

```ts
/** A contract call as the creator reviews it before signing; a value sent with it is its last row. */
```

In `apps/web/src/components/manage/manage-actions.ts`, replace:

```ts
  /** Arguments in ABI order, already formatted for reading. */
  args: { name: string; value: string }[]
  /** Native amount sent with the call, in wei. */
  valueWei?: string
  /**
   * Tabs still on sample data only: the contract's own check mirrored in the browser, answering the
   * error's name or null. The sample actions run it at "Checking the change".
   */
  check?: () => string | null
```

with:

```ts
  /** Arguments in ABI order, already formatted for reading (`reviewOf`). */
  args: { name: string; value: string }[]
```

In `apps/web/src/components/manage/manage-actions.ts`, replace:

```ts
  answer?(choice: 'approve' | 'reject' | 'approve-revert'): void
  /** Sample only: a tab still on sample data has no call, so its review's `check` stands in for the simulation. */
  review?(review: TxRequest): Promise<() => Promise<Hex>>
}
```

with:

```ts
  answer?(choice: 'approve' | 'reject' | 'approve-revert'): void
}
```

In `apps/web/src/components/manage/manage-actions.ts`, replace:

```ts
  /** Null on a tab still on sample data. */
  call: ManageCall | null
  review: TxRequest
  confirm(hash: Hex): Promise<ActionResult<T>>
  /** Add phase and the chunk write: keep the sent hash until the server confirms it. */
```

with:

```ts
  call: ManageCall
  review: TxRequest
  confirm(hash: Hex): Promise<ActionResult<T>>
  /** Add phase, the chunk write and an airdrop batch: keep the sent hash until the server confirms it. */
```

In `apps/web/src/components/manage/manage-context.tsx`, replace:

```tsx
import { DEMO_CREATOR, DEMO_DEPLOYMENT } from '@/lib/demo'
import type { ManageActions } from './manage-actions'
import { sampleManageActions, samplePhasesView } from './manage-sim'

/**
 * The actions every `TransactionDialog` in Manage drop runs on (docs/specs/2026-10-15-phases.md, section
 * 7.3), with the collection's chain and the sign-in wallet the machine checks against. Phases and Whitelist
 * provide the real or the sample ones; the tabs still on sample data (Airdrop, Settings, the Overview's Reveal)
 * run on one shared sample target until their sub-project.
```

with:

```tsx
import type { ManageActions } from './manage-actions'

/**
 * The actions every `TransactionDialog` in Manage drop runs on (docs/specs/2026-10-15-phases.md, section
 * 7.3), with the collection's chain and the sign-in wallet the machine checks against. Phases, Whitelist,
 * Airdrop, Settings and the Overview each provide the real or the sample ones
 * (docs/specs/2026-10-15-airdrop-settings.md, section 7.1).
```

In `apps/web/src/components/manage/manage-context.tsx`, replace:

```tsx
export type ManageTarget = { actions: ManageActions; chainId: number; wallet: Address }

const ManageContext = createContext<ManageTarget | null>(null)

let sampleTarget: ManageTarget | null = null

/** The shared sample target, made on first use. */
function sampleFallback(): ManageTarget {
  sampleTarget ??= {
    actions: sampleManageActions(() => samplePhasesView({ max_supply: null })),
    chainId: DEMO_DEPLOYMENT.chainId,
    wallet: DEMO_CREATOR,
  }
  return sampleTarget
}

export function ManageActionsProvider({
```

with:

```tsx
export type ManageTarget = { actions: ManageActions; chainId: number; wallet: Address }

const ManageContext = createContext<ManageTarget | null>(null)

export function ManageActionsProvider({
```

In `apps/web/src/components/manage/manage-context.tsx`, replace:

```tsx
  return useContext(ManageContext) ?? sampleFallback()
```

with:

```tsx
  const target = useContext(ManageContext)
  if (!target) throw new Error('ManageActionsProvider is missing.')
  return target
```

In `apps/web/src/components/manage/manage-sim.ts`, replace:

```ts
 * Sample mode for Manage drop (docs/specs/2026-10-15-phases.md, section 8), and the sample values the tabs
 * still on sample data read. Nothing here talks to a wallet, an RPC or the database: `sampleManageActions`
 * and `samplePhasesServer` have the shape of `realManageActions` (manage-actions.ts) and `phasesServer`
 * (phases-server.ts), so Phases runs the same code in both modes. Every simulated change goes through
 * the manage machine and the same dialog.
```

with:

```ts
 * Sample mode for Manage drop (docs/specs/2026-10-15-phases.md, section 8), and the sample values the mint page
 * parts still read. Nothing here talks to a wallet, an RPC or the database: `sampleManageActions` and
 * `samplePhasesServer` have the shape of `realManageActions` (manage-actions.ts) and `phasesServer`
 * (phases-server.ts), so every tab runs the same code in both modes. Every simulated change goes through the
 * manage machine and the same dialog.
```

In `apps/web/src/components/manage/manage-sim.ts`, replace:

```ts
  DEMO_PUBLIC_MAX_PER_WALLET,
  DEMO_RENDER_JOBS,
  sampleSupply,
```

with:

```ts
  DEMO_PUBLIC_MAX_PER_WALLET,
  sampleSupply,
```

In `apps/web/src/components/manage/manage-sim.ts`, replace:

```ts
import type { Address, Hex, MintGroup } from '@/lib/demo'
```

with:

```ts
import type { Hex, MintGroup } from '@/lib/demo'
```

In `apps/web/src/components/manage/manage-sim.ts`, replace:

```ts
import type { ManageActions, ManageRequest, TxRequest } from './manage-actions'
```

with:

```ts
import type { ManageActions } from './manage-actions'
```

In `apps/web/src/components/manage/manage-sim.ts`, replace:

```ts
/** Sample values the tabs still on sample data read beyond their props. Each names the real source. */
export const SAMPLE = {
  /** SEAM: the freshness server's `readAt` / block timestamp for the collection. */
  readAt: DEMO_NOW,
  /** SEAM: the mint page settings row (avatar and the public switch on the overview). */
  mintPage: DEMO_MINT_PAGE_SETTINGS,
  /**
   * SEAM: the collection's `getTransferValidator()`. Limit Break's default validator, the
   * `DEFAULT_TRANSFER_VALIDATOR` constant of creator-token-standards, same address on every chain.
   */
  transferValidator: '0x721C008fdff27BF06E7E123956E2Fe03B63342e3' as Address,
  /** SEAM: `render_jobs.metadata_cid` of the finished render job, the reveal target. */
  metadataCid: DEMO_RENDER_JOBS.done.metadataCid,
```

with:

```ts
/** Sample values the Overview still reads beyond its props until Phase 6. Each names the real source. */
export const SAMPLE = {
  /** SEAM: the mint page settings row (avatar and the public switch on the overview). */
  mintPage: DEMO_MINT_PAGE_SETTINGS,
```

In `apps/web/src/components/manage/manage-sim.ts`, replace:

```ts
  const walletFor = (call: ManageCall | null) => () =>
```

with:

```ts
  const walletFor = (call: ManageCall) => () =>
```

In `apps/web/src/components/manage/manage-sim.ts`, replace:

```ts
        if (call) sent.set(hash, call)
```

with:

```ts
        sent.set(hash, call)
```

In `apps/web/src/components/manage/manage-sim.ts`, replace:

```ts
      return walletFor(call)
    },
    review: async (review: TxRequest) => {
      await wait(650)
      const reason = review.check?.() ?? null
      if (reason)
        throw Object.assign(new Error(reason), {
          shortMessage: `The contract would reject this with ${reason}.`,
        })
      return walletFor(null)
    },
```

with:

```ts
      return walletFor(call)
    },
```

In `apps/web/src/components/manage/manage-sim.ts`, replace:

```ts
}

/** A tab still on sample data: its review, simulated by the sample actions, and the hash as the answer. */
export function sampleRequest(review: TxRequest): ManageRequest<Hex> {
  return { call: null, review, confirm: async (hash) => ({ ok: true, data: hash }) }
}

/** The add `?pending=add` shows waiting to be recorded. */
```

with:

```ts
}

/** The add `?pending=add` shows waiting to be recorded. */
```

In `apps/web/src/components/manage/manage-sim.test.ts`, replace:

```ts
  samplePhasesView,
  sampleRequest,
  sampleRevert,
```

with:

```ts
  samplePhasesView,
  sampleRevert,
```

In `apps/web/src/components/manage/manage-sim.test.ts`, replace:

```ts
  it('refuses at the check what the contract would refuse, and checks a sample tab by its review', async () => {
```

with:

```ts
  it('refuses at the check what the contract would refuse', async () => {
```

In `apps/web/src/components/manage/manage-sim.test.ts`, replace:

```ts
    await expectation
    const review = actions.review?.({
      contract: 'Collection',
      functionName: 'airdropNFTs',
      args: [],
      check: () => 'ExceedsMaxSupply',
    })
    const reviewExpectation = expect(review).rejects.toMatchObject({
      shortMessage: 'The contract would reject this with ExceedsMaxSupply.',
    })
    await vi.advanceTimersByTimeAsync(650)
    await reviewExpectation
  })
```

with:

```ts
    await expectation
  })
```

In `apps/web/src/components/manage/manage-sim.test.ts`, replace:

```ts
    })
  })

  it('answers the hash for a tab still on sample data', async () => {
    const hash: Hex = `0x${'ef'.repeat(32)}`
    const request = sampleRequest({ contract: 'Collection', functionName: 'withdrawMintFunds', args: [] })
    expect(request.call).toBeNull()
    expect(await request.confirm(hash)).toEqual({ ok: true, data: hash })
  })
```

with:

```ts
    })
  })
```

In `apps/web/src/components/manage/manage-machine.ts`, replace:

```ts
  /**
   * The change. Null on a tab still on sample data, whose sample actions check its review instead, and
   * for "Check again", which never simulates (`sentHash` is set).
   */
```

with:

```ts
  /** The change. Null for "Check again", which never simulates (`sentHash` is set). */
```

In `apps/web/src/components/manage/manage-machine.ts`, replace:

```ts
  /** Simulates the call on the collection; resolves with the function that sends the simulated request, unchanged. */
```

with:

```ts
  /** Simulates the call on its contract; resolves with the function that sends the simulated request, unchanged. */
```

In `apps/web/src/components/manage/manage-machine.test.ts`, replace:

```ts
  it('passes a null call to the simulation (a tab still on sample data)', async () => {
```

with:

```ts
  it('passes the call to the simulation as it is, even a null one', async () => {
```

In `apps/web/src/components/manage/transaction-dialog.tsx`, replace:

```tsx
   * The server's answer once the change is confirmed: the fresh view on Phases, the hash on a tab still on
   * sample data. Called even when the run ends after the dialog closed or unmounted.
```

with:

```tsx
   * The server's answer once the change is confirmed: the fresh view it read. Called even when the run ends
   * after the dialog closed or unmounted.
```

In `apps/web/src/components/manage/transaction-dialog.tsx`, replace:

```tsx
          addId: call?.functionName === 'registerMintGroup' ? Number(call.args[0]) : undefined,
```

with:

```tsx
          addId: call.functionName === 'registerMintGroup' ? Number(call.args[0]) : undefined,
```

In `apps/web/src/components/manage/transaction-dialog.tsx`, replace:

```tsx
          simulate: (next) => {
            if (next) return actions.simulate(next)
            if (actions.review) return actions.review(current.review)
            return Promise.reject(new Error('This change runs on sample data only.'))
          },
```

with:

```tsx
          simulate: (next) =>
            next
              ? actions.simulate(next)
              : Promise.reject(new Error('A change sent is checked, never sent again.')),
```

In `apps/web/src/components/manage/transaction-dialog.tsx`, replace:

```tsx
  const value = request?.call?.value
```

with:

```tsx
  const value = request?.call.value
```

In `apps/web/src/components/manage/transaction-dialog.tsx`, replace:

```tsx
/** The call as it will be sent: contract, function, arguments, value. */
```

with:

```tsx
/** The call as it will be sent: contract, function, arguments, and the value with it as the last row. */
```

In `apps/web/src/components/manage/transaction-dialog.tsx`, replace:

```tsx
        ))}
        {request.valueWei && (
          <div className="contents">
            <dt className="text-muted-foreground">Value</dt>
            <dd className="numeric text-right">{formatNative(request.valueWei, chain.nativeSymbol)}</dd>
          </div>
        )}
      </dl>
```

with:

```tsx
        ))}
      </dl>
```

- [ ] **Step 5: Typecheck, lint, test and build**

Run: `pnpm --filter @cobweb/web typecheck && pnpm --filter @cobweb/web lint && pnpm --filter @cobweb/web test && pnpm --filter @cobweb/web build`
Expected: no type or lint error; the web tests pass, 700 in 74 files (the test "answers the hash for a tab still on sample data" goes with `sampleRequest`); the build lists `/collections/[id]/manage` and `/collections/[id]/manage/settings` among its routes.

- [ ] **Step 6: Format, run the root checks and commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
pnpm exec prettier --write apps/web/src/components/manage/settings-dialogs.tsx apps/web/src/components/manage/tradability.tsx apps/web/src/components/manage/settings-screen.tsx "apps/web/src/app/collections/[id]/manage/settings/page.tsx" apps/web/src/components/manage/overview-cards.tsx apps/web/src/components/manage/overview-screen.tsx "apps/web/src/app/collections/[id]/manage/page.tsx" apps/web/src/components/manage/manage-actions.ts apps/web/src/components/manage/manage-context.tsx apps/web/src/components/manage/manage-sim.ts apps/web/src/components/manage/manage-sim.test.ts apps/web/src/components/manage/manage-machine.ts apps/web/src/components/manage/manage-machine.test.ts apps/web/src/components/manage/transaction-dialog.tsx
pnpm typecheck && pnpm lint && pnpm test
git add apps/web/src/components/manage/settings-dialogs.tsx apps/web/src/components/manage/tradability.tsx apps/web/src/components/manage/settings-screen.tsx "apps/web/src/app/collections/[id]/manage/settings/page.tsx" apps/web/src/components/manage/overview-cards.tsx apps/web/src/components/manage/overview-screen.tsx "apps/web/src/app/collections/[id]/manage/page.tsx" apps/web/src/components/manage/manage-actions.ts apps/web/src/components/manage/manage-context.tsx apps/web/src/components/manage/manage-sim.ts apps/web/src/components/manage/manage-sim.test.ts apps/web/src/components/manage/manage-machine.ts apps/web/src/components/manage/manage-machine.test.ts apps/web/src/components/manage/transaction-dialog.tsx
git commit -m "$(cat <<'EOF'
Put Settings and the Overview on the settings view: withdraw, payout, royalty, reveal to the rendered metadata, the placeholder or another IPFS link, mint on behalf, the validator and its level, each sent through the manage machine with the owner check, and remove the seams that served tabs on sample data

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: the web package reports 700 tests in 74 files (701 before, minus the one test that read `sampleRequest`).

---

### Task 11: The docs, the whole check list, the browser walk and the landing note

This task is the controller's: it runs every check, walks the screens in a browser with the dev wallet, and records what it saw. The doc edits add dated sentences; nothing earlier is rewritten or deleted.

**Files:**

- Modify: `docs/MASTER_PLAN.md` (the Phase 5 status line)
- Modify: `docs/specs/2026-10-03-creator-flow-ui.md` (a dated note at the end of section 4.6 and one at the end of section 7)
- Modify: `docs/specs/2026-10-14-deploy.md` (a dated note at the end of section 6.3)
- Modify: `docs/specs/2026-10-15-phases.md` (a dated note at the end of section 12)
- Modify: `docs/specs/2026-10-15-whitelist.md` (a dated note at the end of section 12)
- Modify: `docs/specs/2026-10-15-airdrop-settings.md` (the acceptance boxes; the landing note)

**Interfaces:**

- Consumes: everything Tasks 1 to 10 produce, the local services (`supabase start`, `supabase seed buckets`, `pnpm --filter @cobweb/web chain:local` with its two lines in `apps/web/.env.local`), Foundry's `cast` (installed with Anvil) for the three calls Cobweb never sends (the platform admin's `setFees`, a mint from another account, the ownership hand-over), and the dev wallet extension in `apps/web/scripts/dev-wallet` (the one the earlier walks used).
- Produces: the docs.

In every sentence below, `<date>` is the day the work lands, written as `date '+%-d %B %Y'` prints it (for example `16 October 2026`), and `<gas>` is the gas `verify:airdrop` prints for its 500-wallet batch in Step 1, with thousands separators (26,880,045 when this plan was written).

- [ ] **Step 1: The whole check list**

Run at the repo root, one after another, and note each count:

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
pnpm typecheck && pnpm lint && pnpm test && pnpm format:check
pnpm build
pnpm --filter @cobweb/web verify:local
pnpm --filter @cobweb/web verify:chain
pnpm --filter @cobweb/web verify:storage
pnpm --filter @cobweb/web verify:sweep
pnpm --filter @cobweb/web verify:render
pnpm --filter @cobweb/web verify:deploy
pnpm --filter @cobweb/web verify:phases
pnpm --filter @cobweb/web verify:whitelist
pnpm --filter @cobweb/web verify:airdrop
pnpm --filter @cobweb/web verify:settings
```

Expected: tests pass (shared 80, web 700, the other packages unchanged: dna 60, render 117, worker 282); the format check and the build pass; `verify:local` 363 (342 plus 21), `verify:chain` 12, `verify:storage` 15, `verify:sweep` 8, `verify:render` 22, `verify:deploy` 15, `verify:phases` 20, `verify:whitelist` 18, `verify:airdrop` 15 (with the gas line) and `verify:settings` 17, each with `0 failed`.

- [ ] **Step 2: The browser walk**

With the dev server (`pnpm --filter @cobweb/web dev`) on local Supabase and Anvil and the dev wallet signed in, make two fresh collections, each locked and paid in Lock and upload, rendered with `pnpm --filter @cobweb/web render:local <collectionId>` and deployed: "Airdrop Walk 1" (12 tokens, deployed on its real job, Public at 0.001 ETH with an allocation of 12 and 2 per wallet) and "Reveal Walk 1" (4 tokens with "Reveal later", deployed on its placeholder). After each deploy, the platform admin (Anvil's first account, unlocked on the node) sets the airdrop fee:

```bash
cast send <collection address> "setFees(uint256,uint256,uint256)" 0 0 100000000000000 --from 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 --unlocked --rpc-url http://127.0.0.1:8545
```

Walk these and note what each screen showed:

1. Airdrop reads "Read from the chain under a minute ago" with "Read again", Fee per token "0.0001 ETH", Left to mint "12", and History "No airdrops yet. Each one you send is listed here." under "Batches Cobweb confirmed. Airdrops sent from outside Cobweb are not listed."
2. Paste three wallets (2, 1 and 1 tokens) and a fourth line repeating the first with 999: the preview reads Valid 3, Total tokens 4, Rejected 1, "1 line was left out" and Line 4 "With its earlier lines, the quantity for this address passes 1,000."; the quote reads Recipients 3, Tokens 4, Fee per token "0.0001 ETH", Transactions 1, Total fee "0.0004 ETH", "Up to 500 wallets and 1,000 tokens go in each transaction.", Left to mint 12 and After this airdrop 8.
3. "Send airdrop" opens "Send airdrop" with "4 tokens to 3 wallets. They arrive as soon as the transaction confirms." and the review "Sends to the collection on Anvil", `airdropNFTs`, recipients "3 addresses", amounts "3 amounts, 4 tokens in total", Value "0.0004 ETH (400000000000000 wei)". Reject in the wallet reads "Cancelled in your wallet" / "Nothing was sent and no gas was spent. Try again when you are ready.", and Batch 1 reads "Failed" with that sentence and "Retry batch 1". The retry runs "Checking the change", "Confirm in your wallet" ("Your wallet shows a call to the collection contract, the 0.0004 ETH sent with it, and the gas for it."), "Confirming on Anvil" and "Reading the contract" to the toast "4 tokens airdropped"; History lists Airdrop, 3, 4, "#1 to #4", "0.0004 ETH" and the hash as text; Left to mint reads 8, and the list is empty again.
4. A one-line list with the factory's address reads, at "Checking the change", "The change would fail" / "One recipient is a contract that cannot receive ERC-721 tokens. Send to wallets only. Nothing was sent."; "Back to edit", then "Edit the list", unfreezes it.
5. Two wallets with one token each, reloaded at "Confirming on Anvil": the panel "A batch is waiting to be confirmed" / "This browser sent batch 1 of 1: 2 tokens to 2 wallets. Cobweb lists it in History once the receipt and the transaction show the tokens minted.", the hash, "Check again", "Discard" and "Discard only a transaction that failed or never left your wallet. If it landed, sending the batch again mints its tokens twice."; the send button is off with "Confirm or discard the waiting transaction first."; "Check again" shows "Reading the batch" and toasts "The batch is on chain", and History gains "#5 to #6". If Anvil confirms before the reload can catch it, plant the job in the browser's localStorage as `cobweb-airdrop:<collectionId>` = `{"kind":"airdrop","batches":[[{"address":"<checksummed wallet>","amount":1}]],"sent":0,"pending":"<the batch's hash>"}` and reload. Then plant a job with an unknown hash (`0x` and 64 `a`s) and use "Discard": batch 1 reads "Failed" with "Discarded before it was confirmed." and "Retry batch 1"; "Edit the list" clears it.
6. Burn: "Burn instead of sending", Tokens to burn 2: "Burn 2 tokens to 0x000000…00dEaD", Tokens 2, Fee per token "0.0001 ETH", Transactions 1, Total fee "0.0002 ETH", Left to mint 6, After the burn 4. "Burn 2 tokens" opens the dialog with "Left to mint now" 6, "Left after the burn" 4, "Fee" "0.0002 ETH" and "Type burn 2 to confirm"; once typed, the review reads recipients "1 address", amounts "1 amount, 2 tokens in total" and Value "0.0002 ETH (200000000000000 wei)"; it lands with "2 tokens burned", and History lists Burn first: 1, 2, "#7 to #8", "0.0002 ETH".
7. Over supply: a list of 5 tokens reads "5 tokens is more than the 4 left. Remove some recipients." with the button off; Tokens to burn 5 reads "Only 4 tokens are left to mint."
8. "Export CSV" saves `airdrop-history.csv` with `date_utc,kind,recipients,tokens,token_ids,fee_eth,tx_hash`, the burn first. The Snapshot tab reads the collection's holders on Anvil.
9. The owner check: the dev wallet hands the contract to Anvil's second account (`cast rpc anvil_impersonateAccount <dev wallet> --rpc-url http://127.0.0.1:8545`, then `cast send <collection address> "transferOwnership(address)" 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 --from <dev wallet> --unlocked --rpc-url http://127.0.0.1:8545`); a reload shows "This wallet is not the contract's owner" / "Changes on chain need 0x70997970C51812dc3A010C7d01b50e0d17dc79C8."; "Send airdrop" and "Burn 2 tokens" open their dialogs with the action off and "This wallet is not the contract's owner. Changes on chain need 0x70997970C51812dc3A010C7d01b50e0d17dc79C8." under the review. Hand it back (`cast send <collection address> "transferOwnership(address)" <dev wallet> --from 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 --unlocked --rpc-url http://127.0.0.1:8545`) and "Read again" clears it.
10. Settings, after Public is opened on Phases and Anvil's first account mints one token for 0.001 ETH (`cast send <collection address> "batchMint(uint256,uint256)" 1 0 --value 0.001ether --from 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 --unlocked --rpc-url http://127.0.0.1:8545`): "Read from the chain under a minute ago", Your balance "0.001 ETH", Withdrawn so far "0 ETH", "Platform fees, paid to Cobweb" "0.0008 ETH", "Platform fees per token" "0 ETH + 0% per mint, 0.0001 ETH per airdrop", the payout and "5%" to the dev wallet, "Revealed" with "Change metadata" and "Base URI ipfs://<real CID>/", the validator with "Limit Break default", Transfers "Anvil has no transfer validator, so transfers cannot be locked there." without "Change level", and Mint on behalf "Off".
11. Withdraw: "Withdraw proceeds", "The whole balance goes to the payout address in one transaction.", Amount "0.001 ETH", To the payout, the review `withdrawMintFunds` with no argument rows; it lands with "Proceeds withdrawn"; Your balance "0 ETH" with Withdraw off, and Withdrawn so far "0.001 ETH".
12. Payout: the zero address reads "The zero address cannot receive anything. The contract refuses it.", the current one "That is the current payout address.", Anvil's third account (`0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC`) "Checksummed: 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"; the review `newOwnerPayoutAddress`; "Payout address changed".
13. Royalties: "10.5" reads "Enter 0 to 10, with up to two decimals."; "7.5" reads "750 bps on chain. 0 to 10%."; the review `receiver` and `feeNumerator` "750 (7.5%)"; "Royalties updated" and "7.5%".
14. Reveal, custom and back: "Change metadata" opens "Change the metadata" on "Another IPFS link", with "Rendered metadata (now)" and the red "Check the link before you confirm"; "bafy..." without the scheme reads "Enter a full ipfs:// link with its CID."; a full `ipfs://<CID>/` shows "Token 1 now" `ipfs://<real CID>/1` and "Token 1 after" `ipfs://<CID>/1`; "Use this link" reviews `newBaseURI` and lands with "Metadata updated. The collection points at your link." and the badge "Custom"; "Rendered metadata" and "Reveal" land with "Metadata updated. The collection is revealed." and "Revealed".
15. Reveal Walk 1: Settings reads "Placeholder" with "Reveal" and "Base URI ipfs://<placeholder CID>/metadata.json"; "Reveal the art" opens on "Rendered metadata" with "Placeholder (now)", "Token 1 now" `ipfs://<placeholder CID>/metadata.json` and "Token 1 after" `ipfs://<real CID>/1`; "Reveal" lands with "Metadata updated. The collection is revealed."; "Change metadata", "Placeholder" and "Use the placeholder" land with "Metadata updated. Every token shows the placeholder."; the Overview reads "Placeholder (unrevealed)" with "Reveal", which reveals from the Overview to "Revealed, <short cid>".
16. Mint on behalf: the switch opens "Turn on mint on behalf" with "Anyone can pay to mint for any wallet, which uses up that wallet's limit or quota. The wallet receives the tokens." and the review `status` "true"; "Mint on behalf is on" and "On"; then off with "Mint on behalf is off".
17. The validator: "Change validator" with the zero address and the tick reviews `transferValidator` "0x0000000000000000000000000000000000000000 (removes the check)" and lands with "Transfer validator changed"; "No validator" and "No validator is set, so transfers are not checked."; then "Use the Limit Break default" and the tick read "The change would fail" / "There is no contract at that address on this chain. A validator must be a contract, or the zero address to remove the check. Nothing was sent."
18. The owner check on Settings, as step 9: the alert, and every dialog opening with its action off and the sentence; the contract handed back.
19. The Overview of "Airdrop Walk 1": "Revealed, <short cid>" with "Change", "Withdrawable now" "0 ETH", "Already withdrawn" "0.001 ETH", and no "Paid by minters".
20. Stop Anvil (end `chain:local`): Airdrop shows "The contract could not be read" / "The history below is Cobweb's record of the batches it confirmed. The fee and the tokens left to mint are not shown, and sending waits until the contract can be read." with "Read again", "Not read" for the fee, the total fee and Left to mint, the buttons off with "The contract could not be read, so changes on chain wait until it can be.", and the history listed; Settings shows "The contract could not be read" / "These are the payout address, royalties, metadata and transfer validator Cobweb last read, on <UTC>. Balances and the transfer level are not shown, and changes on chain wait until it can be read.", Your balance and both platform fee rows "Not read", Withdrawn so far "0.001 ETH", the copies shown, Transfers "Not read" and every button off; the Overview's "Withdrawable now" reads "Not read". Start `chain:local` again afterwards (the earlier contracts are gone from the fresh chain; their pages keep showing the copies).
21. Sample mode (`NEXT_PUBLIC_DEMO_DATA=1` in `apps/web/.env.local`, then restart the dev server) on a draft with a supply of 5,000: 1,200 wallets with one token read Transactions 3 and 600 wallets with two tokens read Transactions 2; the simulated wallet's Reject, "Approve, then revert" ("The change failed on chain") and Approve run batch by batch, and "Stop and drop the unsent batches" after the first; `?batch=pending` shows the waiting batch and "Check again" lists it; `?chain=unreachable` and `?owner=other` show their alerts on Airdrop and Settings; `?art=deferred` turns Reveal off with "The real art is not rendered yet. Finish it in Art, then lock and upload it; Reveal opens once it is on IPFS."; `?art=revealed` reads "Revealed" on Settings and the Overview; every Settings dialog runs on the simulated wallet. Remove `NEXT_PUBLIC_DEMO_DATA` afterwards.

A step that does not behave as written is a defect: fix it in a new commit (or send it back to the task that owns it) before recording the landing.

- [ ] **Step 3: MASTER_PLAN**

In `docs/MASTER_PLAN.md`, Phase 5's status line ends with the Whitelist landing's `Known:` sentence, whose last item is "the Airdrop and Settings dialogs run on the sample actions until the fourth sub-project." That sentence stays as it is (docs keep their history), and the line keeps its opening "**Status:** in progress." until the done-when runs on a testnet; the Airdrop and Settings landing is appended to the same line.

In `docs/MASTER_PLAN.md`, replace:

```markdown
the Airdrop and Settings dialogs run on the sample actions until the fourth sub-project.
```

with:

```markdown
the Airdrop and Settings dialogs run on the sample actions until the fourth sub-project. Airdrop and Settings (fourth sub-project of four) landed on <date>; see [specs/2026-10-15-airdrop-settings.md](specs/2026-10-15-airdrop-settings.md). What exists: the migration (`airdrops` and `withdrawals`, read by the owner and written only by `airdrop_record` and `withdrawal_record` after a proof, and `deployments`' payout, royalty, base URI, `transfer_validator` and `mint_on_behalf` as copies refreshed by `settings_refresh`); `validatorAbi` and `DEFAULT_TRANSFER_VALIDATOR` in the shared package; payable and validator calls in the manage machine; airdrop batches of at most 500 wallets and 1,000 tokens built in the browser, sent with the contract's fee as the value, proven from the receipt and calldata at the chain's depth and listed with their token ids; the job kept in the browser with "Check again" and "Discard"; burn as a batch to the dead address; Settings read at one block, balances never copied, each change confirmed from its receipt, the reveal also from its calldata and the level from the validator's log; the withdrawals recorded; Reveal to the rendered metadata, the placeholder or another IPFS link; the owner check; the Overview's pointer, Reveal and proceeds; sample mode on the same code; `pnpm --filter @cobweb/web verify:airdrop` (15 checks) and `verify:settings` (17), and a batch of 500 fresh wallets with 2 tokens each measured at <gas> gas on Anvil. Phase 5 is complete locally; the done-when run on a testnet is owed. Known: Phase 6 brings holders, recent mints, "Paid by minters", per-recipient history and the mint page's reveal state and transfer level through the freshness server, and airdrops and withdrawals made outside Cobweb are neither listed nor counted until its indexer reads them; the batch caps are provisional, and the 500-wallet batch's <gas> gas is above the 16,777,216 per-transaction cap where one applies, so the wallet cap drops before launch, and Monad and Berachain are measured on testnet before launch; a discarded batch that landed is sent again by "Retry batch <n>" and mints twice (the waiting panel says so), a replaced transaction is never matched, a job too large for the browser's storage is kept for the visit only, and History's When is the time Cobweb recorded the batch; the default validator is the one legacy drove as V5 with `setRulesetOfCollection` while `validatorAbi` holds the pinned library's call, so the testnet check before launch covers the function and the levels 0, 1 and 9, levels 2 to 8 set outside Cobweb read "Level <n>, set outside Cobweb", and the validator's errors read generically; verify covers the validator address only, since Anvil has no validator code, so the level control, its confirm and the way back to the default are checked on a testnet; `royaltyInfo(1, 10000)` reads token 1's royalty, the payout address may withdraw on chain when it is not the owner, and refunds held for this wallet are shown, not claimed; a custom link is checked for its form, never fetched, and Reveal stays off until Cobweb has rendered the real set; `state_read_at` is the time of the last read of either kind; Phase 4 still owes the reveal flow owning a deployed collection's rendering status and the retry's job selection on a deferred collection that later holds a real job; a tab's server actions run one at a time, so an airdrop confirm's polls wait behind a running holder snapshot.
```

- [ ] **Step 4: The dated notes in the earlier specs**

In `docs/specs/2026-10-03-creator-flow-ui.md`, the first note goes at the end of section 4.6, after the Whitelist note.

In `docs/specs/2026-10-03-creator-flow-ui.md`, replace:

```markdown
### 4.7 Public mint page (`/[slug]`)
```

with:

```markdown
> **<date>:** Airdrop, Settings and the Overview's pointer, Reveal and proceeds run on real data ([2026-10-15-airdrop-settings.md](2026-10-15-airdrop-settings.md)). What changed from the sample: an airdrop goes in batches of at most 500 wallets and 1,000 tokens, each sent with exactly the contract's fee for its tokens as the value; the list is frozen at the first send and kept in the browser with "Check again" and "Discard", and a discarded batch that landed mints twice if it is sent again (the waiting panel says so); History is Cobweb's record of the batches it confirmed, with token ids from the receipt's `Transfer` logs, and airdrops sent outside Cobweb are not listed; a burn is at most 1,000 tokens a transaction; a repeated address's summed quantity is checked against 1,000; Settings reads the contract with copies for when it cannot be read; "Withdrawn so far" counts the withdrawals made through Cobweb; "Platform fees per token" comes from `fees()`; "Paid by minters" waits for Phase 6; Reveal offers the rendered metadata, the placeholder and another IPFS link; the level control follows the validator's code; a wallet that is not the contract's owner reads everything and sends nothing; the Overview's pointer also reads Custom, and its proceeds come from the contract.

### 4.7 Public mint page (`/[slug]`)
```

The second note closes section 7.

In `docs/specs/2026-10-03-creator-flow-ui.md`, replace:

```markdown
## 8. Acceptance criteria
```

with:

```markdown
> **<date>:** As built ([2026-10-15-airdrop-settings.md](2026-10-15-airdrop-settings.md), section 7.4): "revert to placeholder" is offered whenever a placeholder job exists, also after the reveal; the rendered metadata is the real job's `base_uri` exactly (a single asset's ends in `/metadata.json`, so a CID alone cannot rebuild it); a custom link is a full `ipfs://` URI; and Reveal opens once the real set is rendered.

## 8. Acceptance criteria
```

In `docs/specs/2026-10-14-deploy.md`, the note closes section 6.3.

In `docs/specs/2026-10-14-deploy.md`, replace:

```markdown
## 7. The screen
```

with:

```markdown
> **<date>:** `readDeployment` now reads the base URI, the payout address and the royalty from `deployments.args` ([2026-10-15-airdrop-settings.md](2026-10-15-airdrop-settings.md), section 6.4): their columns are copies of the contract's values, refreshed by Settings, so the deployed view keeps showing what landed.

## 7. The screen
```

In `docs/specs/2026-10-15-phases.md`, the note closes section 12's "Airdrop and Settings still run on sample data, their dialogs on the sample actions" for the fourth sub-project.

In `docs/specs/2026-10-15-phases.md`, replace:

```markdown
## 13. Acceptance criteria
```

with:

```markdown
> **<date>:** Airdrop and Settings now run on real data ([2026-10-15-airdrop-settings.md](2026-10-15-airdrop-settings.md)), their dialogs on the manage actions, and the Overview's proceeds come from the contract. Holders, recent mints and "Paid by minters" wait for Phase 6.

## 13. Acceptance criteria
```

In `docs/specs/2026-10-15-whitelist.md`, the note closes section 12's "The Airdrop and Settings dialogs keep `sampleRequest` until the fourth sub-project".

In `docs/specs/2026-10-15-whitelist.md`, replace:

```markdown
## 13. Acceptance criteria
```

with:

```markdown
> **<date>:** `sampleRequest` is gone: the Airdrop and Settings dialogs run on the manage actions ([2026-10-15-airdrop-settings.md](2026-10-15-airdrop-settings.md)), and Airdrop's holder snapshot now feeds real batches.

## 13. Acceptance criteria
```

- [ ] **Step 5: The landing note in the Airdrop and Settings spec**

In `docs/specs/2026-10-15-airdrop-settings.md`, section 13, change each `- [ ]` to `- [x]` whose criterion Steps 1 and 2 confirmed (all seven when everything passed). Then, after the list, add a blank line and one paragraph that starts `Checked on <date> on local Supabase, local storage and Anvil:` and records: the root checks with the shared and web test counts; the build; each verify script with its count (verify:local, verify:chain, verify:storage, verify:sweep, verify:render, verify:deploy, verify:phases, verify:whitelist, verify:airdrop, verify:settings); the 500-wallet batch's gas (<gas>, above the 16,777,216 per-transaction cap, so the wallet cap drops before launch as section 12 says); then the browser walk, step by step as Step 2 lists it, with what each screen showed (the preview's counts and the repeat left out, the quote, the review's rows and Value, the rejected and retried batch, the factory refused, the waiting batch after the reload and the discarded one, the burn, over supply, the export's columns, the owner check, the balances and the withdrawal, the payout, the royalty, the custom link and the way back, Reveal Walk 1 revealed and back to the placeholder and revealed from the Overview, mint on behalf, the validator removed and the default refused, the Overview's proceeds, the alerts with Anvil stopped, the sample states), and any defect found and the commit that fixed it.

- [ ] **Step 6: Commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
git add docs/MASTER_PLAN.md docs/specs/2026-10-03-creator-flow-ui.md docs/specs/2026-10-14-deploy.md docs/specs/2026-10-15-phases.md docs/specs/2026-10-15-whitelist.md docs/specs/2026-10-15-airdrop-settings.md
git commit -m "$(cat <<'EOF'
Record the Airdrop and Settings landing in MASTER_PLAN and its spec, with the notes the earlier specs owe it

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: `git show --stat HEAD` lists the six docs only; `git diff HEAD~1 -- docs/PLAN.md` prints nothing.

---

## Self-review

**Spec coverage.** Section 4 (the tables, the `deployments` copies and the royalty range, the three functions, the types by hand): Task 2. Section 5 (`validatorAbi`, `DEFAULT_TRANSFER_VALIDATOR`, the collection pins): Task 1. Section 6.1 (the types and the pure views): Task 3. Section 6.2 (the reads at one block through `readEach`, `chainStateOf`): Task 5. Section 6.3 (the Airdrop view and the batch proof): Tasks 4 (`proveAirdrop`) and 5. Section 6.4 (the Settings view and the change confirm, the phase copies refreshed first): Tasks 4 (`matchPhaseEvent` on any ABI) and 5. Section 6.5 (the actions and their shapes): Tasks 4 (`sentCallShape`, `parseSentCall`) and 5. Section 6.6 (the sentences and the error maps): Tasks 3 (`result.ts`, `manageRecordError`) and 4 (`revertSentence` with the symbol). Section 7.1 (the calls, the machine, the dialog, the seams removed): Tasks 4, 6 and 10. Section 7.2 (the bound servers and the job): Task 6. Section 7.3 (Airdrop): Task 9. Sections 7.4 and 7.5 (Settings and the Overview): Task 10. Section 8 (sample mode): Task 7, with the pages' sample branches in Tasks 9 and 10. Section 9 (stage rules): the three pages keep `stageContext` and `LockedStagePage` and branch on `ctx.demo` (Tasks 9 and 10). Section 10 (testing): the unit tests in Tasks 1, 3, 4, 6 and 7; `verify:local` in Task 2; `verify:airdrop` and `verify:settings` in Task 8; the whole check list and the walk in Task 11. Section 11 (documentation): `CLAUDE.md` in Task 8, the rest in Task 11. Section 12 (owed and known): the `Known:` list Task 11 appends to MASTER_PLAN. Section 13 (acceptance): Task 11. Section 14's reconciliations: 1 (the confirm takes the hash alone) Task 5; 2 and 3 ("Paid by minters" in sample mode only; the two platform fee rows) Task 10; 4 (the default validator refused on Anvil) Task 8, check 11; 5 and 6 (the flags) Task 11's Known list; 7 (the gas collection deployed through the factory) Task 8; 8 (the gas) Decision 16; 9 (the phase copies first) Task 5; 10 ("complete locally") and 11 (the deploy spec note) Task 11; 12 and 14 (`SentCall.value`, the target and `abiOf`) Task 4; 13 (a burn of at most 1,000) Tasks 3 and 9; 15 (`phaseBase` supplies the chain and the address) Task 5; 16 (the Overview without royalty or payout) Task 10; 17 (the 10% cap in the app, the copy on 0 to 10,000) Tasks 2 and 4.

**Where this plan departs from the spec's letter.** `sampleAirdropJob()` takes no view (spec section 8 names `sampleAirdropJob(view: AirdropView)`): the job is built from the sample's own wallets and an unread parameter fails lint (Decision 9). `PendingBatchPanel` takes `onForget` beside the `onDiscard` section 7.3 names (Decision 8). `SettingsDialogBase` is exported, since `tradability.tsx` builds its dialogs on it. `settings_refresh` checks its six keys itself, since `transfer_validator` takes null (Decision 2).

**Placeholder scan.** No step says "add error handling" or "similar to Task N"; every code step shows a whole file or an exact anchor with its replacement. The only values filled at landing are Task 11's `<date>`, `<gas>`, the walk's addresses, CIDs and hashes, and the landing paragraph, each defined where it is used.

**Type consistency.** `ManageCall` (with `value` and `target`), `SentCall`, `CallTarget`, `ValidatorFunction`, `ExpectedEvent`, `PHASE_FUNCTIONS`, `SETTINGS_FUNCTIONS`, `airdropCalls`, `settingsCalls`, `abiOf`, `parseSentCall(input, functions?)`, `matchPhaseEvent(receipt, { contract, from, event, abi? })`, `proveAirdrop`, `classifyError(error, at, subject, symbol?)`, `AirdropView`, `AirdropJob`, `BatchEntry`, `SettingsView`, `TransferLevelState`, `RevealTargets`, `airdropServer`, `settingsServer`, `rememberAirdropJob`, `airdropJob`, `forgetAirdropJob`, `frozenJob`, `burnJob`, `withPending`, `withConfirmed`, `unsentTokens`, `sendCall`, `simulationSentence` and `handOver` are spelled the same in every task that uses them.

**Review Focus.** Five lines, each with its test in the owning task: the summed repeat (Task 3, `recipients.test.ts`), the 1,000-token batch under 500 wallets (Task 3, `airdrop-view.test.ts`), the `Transfer` a recipient contract sends on and ids out of order (Task 4, `airdrop-batch.test.ts`), the real job checked first (Task 3, `settings-view.test.ts`) and the reveal proven from its calldata (Task 8, `verify:settings` check 9).

**Checked while planning.** The code was written first in a scratch copy of `69b0282` outside the repository (its own git, one commit per task), and every code block here is taken from those commits. The migration was checked statement by statement in a transaction rolled back on the local database, then applied with `supabase migration up --local`: `verify:local` read `344 passed, 19 failed` before it and `363 passed` after; `verify:airdrop` 15 (the 500-wallet batch at 26,880,045 gas), `verify:settings` 17, `verify:deploy` 15, `verify:phases` 20, `verify:whitelist` 18, `verify:chain` 12, `verify:storage` 15, `verify:sweep` 8 and `verify:render` 22, each with `0 failed`. Then the plan itself was applied to a fresh copy of `69b0282` by a script that performs each "Create", "Replace the whole of", "In ..., replace: ... with:" and "At the end of ..., append:" literally and refuses an anchor found other than once: every anchor was found exactly once, each "see it fail" step failed as its Expected line says, each task's commit block ran with Prettier changing nothing, typecheck, lint and tests green and `git status` clean afterwards, and after Task 10 the tree matched the scratch implementation file for file. The counts: shared 72 to 80 in Task 1; web 588, 608, 678, 678, 687, 701, 701, 701 and 700 after Tasks 2 to 10; `pnpm build` and `pnpm format:check` pass. Task 11's six doc anchors were each found once. Afterwards the migration was reversed on the local database (its three functions, two tables and two columns dropped, the royalty check and the column comments restored, its row deleted from `supabase_migrations.schema_migrations`), and `pg_dump --schema-only` of `public` and `private` and the migration list matched the snapshots taken before it, so the local database is at the Whitelist state the plan starts from. Not run while planning: the browser walk (Task 11, the controller's) and the level control against a deployed validator (a testnet check, spec section 12).
