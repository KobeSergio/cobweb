# Whitelist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a creator with a deployed collection keep one whitelist per whitelist phase in Manage drop, Whitelist: addresses and quotas from a CSV, pasted text, one at a time or a holder snapshot, edited or removed, then written on chain in chunks of 500 addresses per `setMintQuota` transaction from the sign-in wallet through the manage machine. The server builds each chunk from the entries not yet written, proves each confirmed chunk from its receipt and its calldata, and keeps on each entry a copy of what the chain was last proven to hold, so a failed or lost chunk is resumed by writing the next one. Quota used comes from the chain. The holder snapshot is a server action reading another ERC-721 contract at one block, for Whitelist and Airdrop alike.

**Architecture:** A migration lets `whitelist_entries.quota` be 0 (a removal staged on a written address), adds the copies `written_quota`, `written_tx` and `written_at` (set together), narrows the owner's grants to inserting the list's four columns and updating `quota`, and adds two functions: `whitelist_entries_add` (a security invoker for the owner's adds and quota changes, capped at 10,000 rows per group under a lock on the group) and `whitelist_chunk_record` (the service role writes the copies of the pairs a proven transaction carried). The web app gains pure modules for the types and the view (`whitelist-types.ts`, `whitelist-view.ts`: the entries, the chunks the rows still name, a group's counts, the next chunk), the input shapes (`whitelist-schemas.ts`), the chunk proof from the calldata (`quota-chunk.ts`), the holder list (`holders.ts`) and the batched reads (`read-each.ts`); `setMintQuota` joins the manage calls with arrays; the server cores (`whitelist-core.ts`, `snapshot-core.ts`) behind `phasesWrite` and nine server actions; the manage machine polls the chunk's "not confirmed yet" and keeps a sent chunk in localStorage; `verify:whitelist` on the deploy fixture; sample mode on the same code (`whitelist-sim.ts`); and the screens: the Whitelist tab on the view under its own `ManageActionsProvider`, the chunk dialog on `TransactionDialog`, the waiting chunk with "Check again", Minted per page through React Query, and the snapshot tab on the real action for Whitelist and Airdrop.

**Tech Stack:** TypeScript 6 strict (ESM, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`) consumed as source; Node 26 locally; Next 16.3 (App Router, Turbopack) with React 19; wagmi 2.19 and viem 2.57 (RainbowKit for the wallet); React Query 5; zod 4.6; Vitest 5 (Node environment, no component tests); Supabase local (CLI 2.116) with Postgres; Anvil through `chain:local`; Prettier 3; `@cobweb/shared` consumed as workspace source and transpiled by Next.

**Spec:** [../specs/2026-10-15-whitelist.md](../specs/2026-10-15-whitelist.md)

## Global Constraints

- The spec is the binding authority. Where this plan decides a detail the spec leaves open, the line starts with "Decision:" and the decisions that shape more than one task are collected in the next section.
- Node 26 locally. ESM everywhere. Inside `packages/shared`, relative imports carry the `.ts` extension (`./chains.ts`). Inside `apps/web/src`, imports are extensionless and use the `@/` alias, as the existing files do. Inside `apps/web/scripts`, relative imports carry the `.ts` extension and the app's modules are imported as `../src/...` (the scripts run under `--import ./scripts/resolve-ts.mjs`, which maps `@/` and adds `.ts`; a script never imports a value from a `.tsx` module). `verify-local.ts` runs without that hook and imports nothing from the app. Types are imported with `import type` or an inline `type` specifier.
- Vitest 5, Node environment. One file: `pnpm --filter <package> exec vitest run <file>`, for example `pnpm --filter @cobweb/web exec vitest run src/lib/manage/whitelist-view.test.ts`. No component test exists and none is added: pure modules are unit tested, components are checked by typecheck, lint, build and the browser walk.
- Test fixtures: annotate every fixture constant with its type (`const HASH: Hex = ...`, `const view: WhitelistView = ...`, `const list: GroupList = ...`), since an unannotated literal widens and fails `tsc`. Never await a sleeping sample call under fake timers without advancing them (`vi.advanceTimersByTimeAsync`); attach a `rejects` expectation before advancing the timers that settle it.
- Prettier: no semicolons, single quotes, trailing commas, 110 columns. Before each commit run `pnpm exec prettier --write <the files you changed>` from the repo root. Never run `pnpm format` or Prettier on `.`. CI runs `pnpm format:check`, so every file you touch outside `docs/` must be formatted (`docs/`, `contracts/out/` and `packages/ui/src/components/` are in `.prettierignore`). The code blocks in this plan are already formatted; Prettier leaves them as they are.
- typescript-eslint's recommended rules and ESLint's `preserve-caught-error` apply. Do not write `throw new X(...)` directly inside a `catch` block. There is no react-hooks lint plugin; write hook dependencies correctly all the same.
- Copy: plain sentences. No em or en dashes anywhere, code, comments, commit messages and docs included. The product is Cobweb; never Kingdomly. "Whitelist" is the term.
- CLAUDE.md rules 1 to 4 bind this sub-project. Liveness comes only from the contract's `active` field (rule 1): the Whitelist's status badge reads it and nothing else. The wallet signs exactly the request the simulation passed (rule 2): every chunk goes through the manage machine, whose `simulate` returns the only way to send. Every server action checks the session and the ownership (rule 4): the eight Whitelist actions through `phasesWrite`, `fetchHolders` through `ownedCollection`. The server writes the copies of what the chain holds (`written_quota`, `written_tx`, `written_at`) only through `whitelist_chunk_record`, from the pairs a proven receipt and its calldata carried, never from a browser value.
- Security: no env name starts with `NEXT_PUBLIC_` except the ones that already do. No secret value is printed, logged or committed. An error is logged through `errorSummary` (name and one line) or as its code and message, never as the error object.
- Never deploy to any remote chain or service. Never pass `--prod` or `--target production` to any command. The only chain any step touches is the local Anvil on port 8545; every script refuses an endpoint that is not localhost.
- The repository is linked to a hosted Supabase project (`supabase/.temp`). Never run `supabase db push`, never pass `--linked` or `--project-ref` to any command, never run `supabase db reset` or `supabase stop`. The only Supabase commands a step runs are `supabase migration up --local` and `supabase status`.
- `docs/PLAN.md` must not change. `legacy/` is never read into, copied from, imported or committed.
- Docs keep their history: add dated notes and status sentences; never rewrite or delete earlier statements in `docs/MASTER_PLAN.md`, in specs or in `contracts/README.md`.
- Local services, for Tasks 2, 7 and 10: `supabase start` at the repo root has run (the migrations up to `20261015000000_phases.sql` are applied; Task 2 applies the new one with `supabase migration up --local`, which keeps the local data), `supabase seed buckets` has run (it creates the local `art` and `render` buckets; a restart alone does not), and `pnpm --filter @cobweb/web chain:local` is running in the background on port 8545 with its two printed lines (`RPC_URL_31337` and `FACTORY_ADDRESS_31337`) in `apps/web/.env.local`. The local factory approved the shipped creation code at its deploy. Nothing needs Foundry.
- `verify:local` totals drift as sections are added: this plan states a count as "the previous total plus N", N being the number of `check(` calls a step adds (the previous total is 326).
- Implementers never use `git commit --amend` or `git stash`. To fix a commit, make a new one.
- Before every commit, at the repo root: `pnpm exec prettier --write <the files you changed>`, then `pnpm typecheck && pnpm lint && pnpm test`.
- Commit messages are one plain imperative sentence with no prefix, then a blank line, and end with exactly these two lines:

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
```

## Decisions

1. Decision (spec sections 6.5 and 10): ten tasks. The input shapes live in `lib/manage/whitelist-schemas.ts` as the spec names them; only the chunk's arm of `sentCallShape` joins `phase-schemas.ts`. The old whitelist screen keeps working until Task 9 rewrites it: Task 8 gives it the sample snapshot read in one line.
2. Decision (section 4.2): `whitelist_entries_add` refuses a missing quota as `QUOTA_RANGE` too, and tells inserted from changed rows with `RETURNING (xmax = 0)`; it locks the group `for no key update` under the owner's update grant on `mint_groups`' four columns, as `mint_group_move` does. The migration was checked statement by statement in a transaction rolled back on the local database, then applied, run through `verify:local` (342) and `verify:whitelist` (18), and reversed to the catalog it found.
3. Decision (section 4.2): `whitelist_chunk_record` checks the hash after `NOT_DEPLOYED` and before the group, raising `NOT_THIS_CHANGE`'s sentence with `23514` as `art_record_payment` does for its hash; `whitelistWriteError` reads it as UNSAVED, since the server never sends a malformed hash. "Where they differ" means `written_quota` or `written_tx` differs, so a second record of a hash answers 0 and keeps `written_at`.
4. Decision (section 6.1): `WrittenChunk.writtenAt` is in Unix milliseconds, so chunks recorded within one second keep their order. `listOf` counts each chunk again from the entries that name it and leaves out a chunk no entry names, so a patch (or the sample's record) keeps the counts right. `whitelist-view.ts` also exports `byAddress` (lowercase address order) for the model and the sample.
5. Decision (sections 6.2 and 6.3): every list core starts with `groupFor`, which refuses group 0 as `WRONG_GROUP`, then `NOT_DEPLOYED`, then `NAME_FIRST`. `quotaUsageCore` refuses only `NOT_DEPLOYED`: it reads the chain, not a row. `removeEntryCore` deletes with a filter on the copy and counts what it deleted before it stages a zero, so a chunk confirmed in between makes it a staged removal; it and `setQuotaForAllCore` count with `count: 'exact'`, since PostgREST returns at most 1,000 rows.
6. Decision (section 6.3): `readEach` reads a multicall failure whose error names `aggregate3` as the request failing as a whole (viem reports that as the failure of every call) and throws it; any other failed call is null. Without multicall3, a revert or an empty answer is null and anything else is thrown. `revertedRead` is exported for the snapshot's ERC-165 and `totalSupply` reads.
7. Decision (section 6.4): `holdersOf` sorts by balance, most first, then by lowercase address. `snapshotIds(supply)` answers 0 to the supply inclusive (Review Focus 5). The snapshot's contract goes through `addressShape`, so the zero address reads `ZERO_ADDRESS`. `fetchHolders` turns a throw into `SNAPSHOT_FAILED`, the snapshot's own sentence.
8. Decision (section 7.1): the machine keeps one map of "not confirmed yet" answers (`PHASE_NOT_CONFIRMED` to `PHASE_TIMED_OUT`, `WHITELIST_NOT_CONFIRMED` to `WHITELIST_TIMED_OUT`). A stored chunk reads as none unless its hash is 32 bytes of hex and its group an integer of 1 or more.
9. Decision (section 7.2): `snapshotSource` lives in `components/manage/snapshot-source.ts`. The snapshot summary prints the block as the chain reports it, without separators (an identifier, as explorers show it). The Airdrop page exports `maxDuration = 300` and branches on sample mode only for the snapshot's chains and read.
10. Decision (section 7.3): `PendingChunkPanel` lives in `whitelist-chunks.tsx`. An unnamed group's tab is an Empty titled "Not named yet". A tab's dot reads "<N> chunks not written" from its unwritten count. The write button is hidden when every address is written. "Keep" sends `setEntryQuota` with the written quota. Undo puts a staged removal back as it was and a deleted entry back as a new row without copies. A refused add reads the view again, since earlier pages may have landed. The export's minted column reads React Query's cache by the key's start.
11. Decision (section 7.4): `capRoom(existing, rows)` in `whitelist-model.ts` gives the add dialog its room under the cap, counting staged removals as rows (Review Focus 3). The add and quota dialogs cannot be closed while their action runs.
12. Decision (section 8): `sampleSentChunk` names `sampleTxHash(41)` on the first list with an address not written. The sample's written chunks are an hour apart before the sample's clock; a chunk the sample records lands a second after the last. `sampleFetchHolders` sorts its 24 holders as `holdersOf` does.
13. Decision (section 10): `verify:local` section 9l (`artWhitelist`, after `artPhases`, fixture tag 161, record salt 12) records a third group through `mint_group_record` for the cap check and adds sixteen checks; the written-zero check also covers an address re-added while its zero was in flight (Review Focus 4). The total grows by sixteen (326 to 342).
14. Decision (section 10): `verify:whitelist` makes its addresses from the keccak of an index (so address order is not list order), deploys with a public limit of 2, keeps the stranger's own row out of the raise and the removal, and proves "its record 0" by calling `whitelist_chunk_record` with the service role.
15. Decision (section 11): the Phases sentence in MASTER_PLAN's status line stays as it is (docs keep their history); the Whitelist landing sentence appended after it says that the Airdrop and Settings dialogs run on the sample actions until the fourth sub-project, which is what the spec's "becomes" asks for.

## Review Focus

Inputs and failure modes the spec implies but its own test list would not exercise, most likely to bite a creator first. Each is pinned to a test in the task that owns the code.

1. An address pasted twice in different cases (a checksummed copy from an explorer and a lowercase one from a spreadsheet) must reach the database as one row with the last quota: the database keys rows by the lowercase address, and one page holding the same key twice makes the upsert refuse the whole add as UNSAVED. Pinned by "merges an address repeated in another case into one row, the last quota winning (Review Focus 1)" (Task 4, `whitelist-schemas.test.ts`).
2. A creator who removes a written address by mistake and adds it back from a CSV at the same quota must see it read written again, with no chunk to send; a model that kept it waiting would send a pointless transaction. Pinned by "re-adding a staged removal at its written quota reads it written again, with no chunk waiting (Review Focus 2)" (Task 9, `whitelist-model.test.ts`).
3. The 10,000 cap counts rows, and a staged removal stays a row until its zero is written: an add dialog that counted only live addresses would let a full list through and the database would refuse it. Pinned by "counts a staged removal as a listed row against the cap (Review Focus 3)" (Task 9, `whitelist-model.test.ts`).
4. A removal's zero that lands after the creator added the address back must keep the row (its quota above 0, "0 on chain") so the next chunk writes the quota again; deleting it would silently drop the creator's add. Pinned by the `verify:local` check "whitelist_chunk_record: a written zero deletes its staged removal, keeps an address re-added meanwhile, and creates nothing for an unlisted zero" (Task 2, `verify-local.ts`).
5. A snapshot must read ids 0 to `totalSupply()` inclusive: Cobweb's own collections (and most others) start at 1, so reading 0 to the supply minus one would miss the last token's holder. Pinned by "reads ids 0 to the supply inclusive, so a collection starting at 1 keeps its last token (Review Focus 5)" (Task 3, `holders.test.ts`).

## File map

| Path | Task | Responsibility |
| --- | --- | --- |
| `packages/shared/src/collection.test.ts` | 1 | Pins `setMintQuota`, the quota and ERC-721 views, `MintQuotasAdded` and the quota errors |
| `supabase/migrations/20261015100000_whitelist.sql` | 2 | `whitelist_entries` quota 0, the copies and their checks, the grants; `whitelist_entries_add`, `whitelist_chunk_record` |
| `apps/web/src/lib/database.types.ts` | 2 | The copies and the two functions, by hand |
| `apps/web/scripts/verify-local.ts` | 2 | Section 9l; section 7's negative quota |
| `apps/web/src/lib/art/result.ts`, `db-error.ts`, `db-error.test.ts` | 3 | The Whitelist sentences; `whitelistWriteError` |
| `apps/web/src/lib/manage/whitelist-types.ts` | 3 | `ListEntry`, `WrittenChunk`, `GroupList`, `WhitelistView`, `ChunkEntry`, `ChunkPlan`, `SentChunk` |
| `apps/web/src/lib/manage/whitelist-view.ts`, `whitelist-view.test.ts` | 3 | The constants, `isWritten`, `byAddress`, `entriesOf`, `writtenChunksOf`, `listOf`, `chunkPlanOf`, `whitelistGroups` |
| `apps/web/src/lib/manage/holders.ts`, `holders.test.ts` | 3 | `Holder`, `HolderSnapshot`, `snapshotIds`, `holdersOf` |
| `apps/web/src/lib/chain/read-each.ts`, `read-each.test.ts` | 3 | `readEach`, `revertedRead` |
| `apps/web/src/lib/manage/phase-calls.ts`, `phase-calls.test.ts` | 4 | `setMintQuota` in the manage calls, arrays in `SentCall`, `MintQuotasAdded`, counts in `reviewOf` |
| `apps/web/src/lib/manage/phase-schemas.ts`, `phase-schemas.test.ts` | 4 | The chunk's arm of `sentCallShape` |
| `apps/web/src/lib/manage/whitelist-schemas.ts`, `whitelist-schemas.test.ts` | 4 | `groupIdShape`, `quotaShape`, `addressShape`, `addEntriesShape`, `usageShape`, `snapshotShape` |
| `apps/web/src/lib/chain/quota-chunk.ts`, `quota-chunk.test.ts` | 4 | `proveQuotaChunk` |
| `apps/web/src/components/deploy/tx-errors.ts`, `tx-errors.test.ts` | 4 | The four quota errors in the creator's words |
| `apps/web/src/components/manage/recipients.ts`, `recipients.test.ts` | 4 | The zero address refused with its line |
| `apps/web/src/lib/manage/phases-core.ts`, `phases-write.ts` | 5 | `phaseBase` exported; `phasesWrite`'s error map parameter |
| `apps/web/src/lib/manage/whitelist-core.ts` | 5 | The view, the next chunk, the confirm, the list edits, the usage read |
| `apps/web/src/lib/manage/snapshot-core.ts` | 5 | `snapshotChains`, `fetchHoldersCore` |
| `apps/web/src/app/actions/whitelist.ts`, `snapshot.ts` | 5 | The eight Whitelist actions; `fetchHolders` |
| `apps/web/src/components/manage/manage-machine.ts`, `manage-machine.test.ts`, `manage-actions.ts` | 6 | Polling a chunk; the sent chunk store |
| `apps/web/src/components/manage/whitelist-server.ts` | 6 | `WhitelistServer`, `whitelistServer` |
| `apps/web/src/components/manage/whitelist-sim.ts`, `whitelist-sim.test.ts` | 6 | The sample view, server, record and waiting chunk |
| `apps/web/src/components/manage/manage-sim.ts`, `manage-sim.test.ts` | 6 | `setMintQuota` in the sample revert and apply; `SAMPLE.whitelists` gone |
| `apps/web/scripts/deploy-fixture.ts`, `verify-whitelist.ts` | 7 | No whitelist entry left; `verify:whitelist` |
| `apps/web/package.json`, `CLAUDE.md` | 7 | `verify:whitelist` |
| `apps/web/src/components/manage/snapshot.ts`, `snapshot.test.ts`, `snapshot-source.ts`, `snapshot-tab.tsx` | 8 | `sampleFetchHolders`; the snapshot source; the tab on the read |
| `apps/web/src/components/manage/airdrop-screen.tsx`, `apps/web/src/app/collections/[id]/manage/airdrop/page.tsx` | 8 | Airdrop's snapshot on the real action |
| `apps/web/src/components/manage/whitelist-model.ts`, `whitelist-model.test.ts` | 9 | The local patches, `capRoom`, `chunkRows` |
| `apps/web/src/components/manage/whitelist-dialogs.tsx`, `whitelist-chunks.tsx`, `whitelist-table.tsx`, `whitelist-screen.tsx` | 9 | The Whitelist tab on the view |
| `apps/web/src/app/collections/[id]/manage/whitelist/page.tsx`, `apps/web/src/components/manage/manage-context.tsx` | 9 | The page on real data; the provider's comment |
| `docs/MASTER_PLAN.md`, `docs/specs/2026-10-03-creator-flow-ui.md`, `docs/specs/2026-10-15-phases.md`, `docs/specs/2026-10-15-whitelist.md` | 10 | The status line, the dated notes, the acceptance boxes and the landing note |

---

### Task 1: The shared package pins what Whitelist relies on

**Files:**

- Modify: `packages/shared/src/collection.test.ts` (one `describe` appended)
- Test: `packages/shared/src/collection.test.ts`

**Interfaces:**

- Consumes: in `collection.test.ts`, `abiOnly` (the ABI-only entry), `namesOf(item)` and `signatureOf(item)` (both defined above the new block), and viem's `getAbiItem`, `toFunctionSelector`, `toEventSelector` (already imported). No generated file changes: `collection-abi.ts` already carries every entry below.
- Produces: nothing new. The test pins `setMintQuota(address[],uint256,uint256[])` with the argument names `['addressesToAdd', 'mintGroup', 'mintQuotas_']` (Task 4's `reviewOf` reads them), `mintQuotas(uint256,address)`, `quotaClaimed(uint256,address)` (Task 5's usage read), `walletState(address)`, `ownerOf(uint256)` and `totalSupply()` (the snapshot), `supportsInterface(bytes4)`, the event `MintQuotasAdded(uint256,uint256)` (Task 4's proof) and the errors `ArrayLengthMismatch()`, `PublicGroupHasNoQuota()`, `NotInWhitelist(address,uint256)`, `ExceedsMintQuota(uint256,uint256)` (Task 4's sentences), so a contract change that drops or reorders one fails CI.

- [ ] **Step 1: Write the pinning test**

At the end of `packages/shared/src/collection.test.ts`, append:

```ts

describe('what Whitelist relies on (docs/specs/2026-10-15-whitelist.md, section 5)', () => {
  it('carries setMintQuota with its argument names, and the quota and ERC-721 views the server reads', () => {
    const quotas = getAbiItem({ abi: abiOnly, name: 'setMintQuota' })
    expect(toFunctionSelector(quotas)).toBe(toFunctionSelector('setMintQuota(address[],uint256,uint256[])'))
    expect(namesOf(quotas)).toEqual(['addressesToAdd', 'mintGroup', 'mintQuotas_'])
    for (const [name, signature] of [
      ['mintQuotas', 'mintQuotas(uint256,address)'],
      ['quotaClaimed', 'quotaClaimed(uint256,address)'],
      ['walletState', 'walletState(address)'],
      ['ownerOf', 'ownerOf(uint256)'],
      ['totalSupply', 'totalSupply()'],
      ['supportsInterface', 'supportsInterface(bytes4)'],
    ] as const) {
      expect(toFunctionSelector(getAbiItem({ abi: abiOnly, name }))).toBe(toFunctionSelector(signature))
    }
  })

  it('carries the event a chunk leaves and the errors the quota sentences decode', () => {
    expect(toEventSelector(getAbiItem({ abi: abiOnly, name: 'MintQuotasAdded' }))).toBe(
      toEventSelector('MintQuotasAdded(uint256,uint256)'),
    )
    for (const [name, signature] of [
      ['ArrayLengthMismatch', 'ArrayLengthMismatch()'],
      ['PublicGroupHasNoQuota', 'PublicGroupHasNoQuota()'],
      ['NotInWhitelist', 'NotInWhitelist(address,uint256)'],
      ['ExceedsMintQuota', 'ExceedsMintQuota(uint256,uint256)'],
    ] as const) {
      expect(signatureOf(getAbiItem({ abi: abiOnly, name }))).toBe(signature)
    }
  })
})
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter @cobweb/shared exec vitest run src/collection.test.ts`
Expected: PASS, 10 tests (8 before). The entries already exist, so these pass at once: they pin, they do not drive new code.

- [ ] **Step 3: Format, run the root checks and commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
pnpm exec prettier --write packages/shared/src/collection.test.ts
pnpm typecheck && pnpm lint && pnpm test
git add packages/shared/src/collection.test.ts
git commit -m "$(cat <<'EOF'
Pin the quota call, the quota and ERC-721 views, MintQuotasAdded and the quota errors Whitelist relies on

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: the shared package reports 72 tests (70 before); the web package is unchanged at 500.

---

### Task 2: The whitelist migration, the types by hand and the verify:local section

**Files:**

- Create: `supabase/migrations/20261015100000_whitelist.sql`
- Modify: `apps/web/src/lib/database.types.ts` (`whitelist_entries` Row, Insert and Update; two functions after `swap_token_ids_for_check`)
- Modify: `apps/web/scripts/verify-local.ts` (section 7's quota check, the call list at the end of `main`, the new section 9l before `10. Cleanup`)
- Test: `apps/web/scripts/verify-local.ts` (`pnpm --filter @cobweb/web verify:local`)

**Interfaces:**

- Consumes: `private.lock_owned_collection(p_collection_id uuid, p_owner uuid)` (`20261009020000_lock_and_pay.sql`; raises 'collection not found' `42501`), `public.deployments` (one row per deployed collection), `public.mint_groups` (unique `(collection_id, onchain_id)`), the owner's policy "whitelist_entries: owner all" (`20261002155132_init.sql`, kept as it is). In `verify-local.ts`, already defined: `renderedFixture(A, payer, tag)`, `recordArgs(owner, cid, payer, n, overrides?)`, `phaseRecordArgs(owner, cid, id, name, description?, visible?)`, `callArt(client, fn, args)`, `expectError(error, codes, data?)`, `expectSentence(error, codes, sentence)`, `countRows(table, column, value)`, `insertCollection(client)`, `describe(error)`, `admin`, `anon`, `CHECK`, `PERMISSION`, `ADDRESS40(n)`, `HEX64(n)`, `NOT_DEPLOYED_SENTENCE`, the types `Creator`, `DbError` and `SupabaseClient`.
- Produces (database):
  - `whitelist_entries.quota` is 0 or more (0 is a removal staged on a written address); `written_quota integer` (0 or more), `written_tx text` (`^0x[0-9a-f]{64}$`), `written_at timestamptz`, all null or all set (`whitelist_entries_written_together`); `authenticated` keeps `select` and `delete`, and gets `insert (mint_group_id, collection_id, wallet_address, quota)` and `update (quota)` only.
  - `public.whitelist_entries_add(p_collection_id uuid, p_onchain_id integer, p_rows jsonb) returns table (added integer, updated integer)`: security invoker, `authenticated` only; `p_rows` is `[{ address, quota }]`, addresses lowercase; raises 'phase not found' (`42501`), and with `23514` 'The public sale has no whitelist.', 'The contract is not deployed yet.', 'The quota must be 1 to 10,000.' and 'A whitelist holds up to 10,000 addresses.' (keeping nothing).
  - `public.whitelist_chunk_record(p_collection_id uuid, p_owner uuid, p_onchain_id integer, p_tx text, p_rows jsonb) returns integer`: security definer, `service_role` only; raises 'collection not found' and 'phase not found' (`42501`), 'The contract is not deployed yet.' and 'The transaction did not make this change.' (`23514`); answers how many entries' copies it wrote.
- Produces (types): `Database['public']['Tables']['whitelist_entries']['Row']` gains `written_at: string | null`, `written_quota: number | null`, `written_tx: string | null` (optional in Insert and Update); `Functions` gains `whitelist_chunk_record` (`Returns: number`) and `whitelist_entries_add` (`Returns: { added: number; updated: number }[]`).

- [ ] **Step 1: Write the failing checks**

Section 7 keeps its checks, except that a quota of 0 is now allowed: its "quota 0 rejected" becomes "a negative quota is refused". The call list at the end of `main` runs the new section after Phases'. The new section 9l goes just before `10. Cleanup`: sixteen checks on a collection recorded as deployed, as 9k records one (fixture tag 161, record salt 12), with a third group recorded for the cap, and a draft with a group the service role seeds.

In `apps/web/scripts/verify-local.ts`, replace:

```ts
    return expectError(error, CHECK, data)
  })
  await check('whitelist_entries: quota 0 rejected', async () => {
    if (!groupA) return 'no group'
    const { data, error } = await A.client
```

with:

```ts
    return expectError(error, CHECK, data)
  })
  await check('whitelist_entries: a negative quota is refused', async () => {
    if (!groupA) return 'no group'
    const { data, error } = await A.client
```

In `apps/web/scripts/verify-local.ts`, replace:

```ts
        collection_id: colA.id,
        wallet_address: '0x' + 'd'.repeat(40),
        quota: 0,
      })
      .select()
```

with:

```ts
        collection_id: colA.id,
        wallet_address: '0x' + 'd'.repeat(40),
        quota: -1,
      })
      .select()
```

In `apps/web/scripts/verify-local.ts`, replace:

```ts
  await artDeploy(A, B)
  await artPhases(A, B)
}

```

with:

```ts
  await artDeploy(A, B)
  await artPhases(A, B)
  await artWhitelist(A, B)
}

```

In `apps/web/scripts/verify-local.ts`, replace:

```ts

// ---------------------------------------------------------------------------------------------
// 10. Cleanup
// ---------------------------------------------------------------------------------------------
```

with:

```ts

// ---------------------------------------------------------------------------------------------
// 9l. Whitelist: a quota of 0, the owner's column grants, the copies and their checks,
// whitelist_entries_add and whitelist_chunk_record (docs/specs/2026-10-15-whitelist.md, section 4)
// ---------------------------------------------------------------------------------------------
type EntryCheckRow = {
  wallet_address: string
  quota: number
  written_quota: number | null
  written_tx: string | null
  written_at: string | null
}

/** A group's entries in address order, as the service role reads them. */
async function entryRows(groupId: string): Promise<EntryCheckRow[]> {
  const { data, error } = await admin
    .from('whitelist_entries')
    .select('wallet_address, quota, written_quota, written_tx, written_at')
    .eq('mint_group_id', groupId)
    .order('wallet_address')
  if (error) throw new Error(`entries: ${describe(error as DbError)}`)
  return data as EntryCheckRow[]
}

/** The row id of a collection's group, as the service role reads it. */
async function groupRowId(cid: string, onchainId: number): Promise<string> {
  const { data, error } = await admin
    .from('mint_groups')
    .select('id')
    .eq('collection_id', cid)
    .eq('onchain_id', onchainId)
    .single()
  if (error) throw new Error(`group ${onchainId}: ${describe(error as DbError)}`)
  return (data as { id: string }).id
}

type Pair = { address: string; quota: number }

/** A whitelist address no other section uses: lowercase, 40 hex digits. */
const WL = (n: number) => ADDRESS40(0x5000_0000 + n)
/** The hash of a chunk the checks record. */
const CHUNK_TX = (n: number) => `0x${HEX64(0xc0de_0000 + n)}`
const QUOTA_SENTENCE = 'The quota must be 1 to 10,000.'
const PUBLIC_SALE_SENTENCE = 'The public sale has no whitelist.'
const FULL_SENTENCE = 'A whitelist holds up to 10,000 addresses.'
const NOT_THIS_CHANGE_SENTENCE = 'The transaction did not make this change.'

const addArgs = (cid: string, onchainId: number, rows: Pair[]) => ({
  p_collection_id: cid,
  p_onchain_id: onchainId,
  p_rows: rows,
})

const chunkArgs = (owner: string, cid: string, onchainId: number, tx: string, rows: Pair[]) => ({
  p_collection_id: cid,
  p_owner: owner,
  p_onchain_id: onchainId,
  p_tx: tx,
  p_rows: rows,
})

async function artWhitelist(A: Creator, B: Creator): Promise<void> {
  const payer = A.account.address.toLowerCase()
  // Rendered and recorded as deployed with Public (0) and Holders (1), as 9k records one, and a third group
  // recorded for the cap.
  const { cid } = await renderedFixture(A, payer, 161)
  const recorded = await callArt(admin, 'collection_record_deploy', recordArgs(A.userId, cid, payer, 12))
  if (recorded.error) throw new Error(`setup: record: ${describe(recorded.error)}`)
  const third = await callArt(admin, 'mint_group_record', phaseRecordArgs(A.userId, cid, 2, 'Full list'))
  if (third.error) throw new Error(`setup: group 2: ${describe(third.error)}`)
  const holders = await groupRowId(cid, 1)
  const full = await groupRowId(cid, 2)
  // A draft with a group the service role seeds: both functions refuse it as not deployed.
  const draft = await insertCollection(A.client)
  if (!draft.row) throw new Error(`setup: ${describe(draft.error)}`)
  const draftId = draft.row.id
  const draftGroup = await admin
    .from('mint_groups')
    .insert({ collection_id: draftId, onchain_id: 1, name: 'Early' })
  if (draftGroup.error) throw new Error(`setup: draft group: ${describe(draftGroup.error as DbError)}`)

  const entry = (address: string, quota: number, extra: Record<string, unknown> = {}) => ({
    mint_group_id: holders,
    collection_id: cid,
    wallet_address: address,
    quota,
    ...extra,
  })
  const add = (client: SupabaseClient, onchainId: number, rows: Pair[], collection = cid) =>
    callArt(client, 'whitelist_entries_add', addArgs(collection, onchainId, rows))
  const record = (onchainId: number, tx: string, rows: Pair[], owner = A.userId, collection = cid) =>
    callArt(admin, 'whitelist_chunk_record', chunkArgs(owner, collection, onchainId, tx, rows))
  const rowOf = async (address: string) =>
    (await entryRows(holders)).find((row) => row.wallet_address === address)
  const nowhere = async (address: string) =>
    (await countRows('whitelist_entries', 'wallet_address', address)) === 0

  await check(
    'whitelist_entries: the owner inserts an entry with a quota of 0 (a staged removal)',
    async () => {
      const { data, error } = await A.client
        .from('whitelist_entries')
        .insert(entry(WL(1), 0))
        .select()
      if (error) return describe(error as DbError)
      return data.length === 1 ? null : `${data.length} row(s)`
    },
  )

  await check('whitelist_entries: an owner insert carrying a copy is refused', async () => {
    const problems: string[] = []
    for (const copy of [
      { written_quota: 1 },
      { written_tx: CHUNK_TX(1) },
      { written_at: new Date().toISOString() },
    ]) {
      const { data, error } = await A.client
        .from('whitelist_entries')
        .insert(entry(WL(2), 1, copy))
        .select()
      const problem = expectError(error as DbError, PERMISSION, data)
      if (problem) problems.push(`${Object.keys(copy)[0]}: ${problem}`)
    }
    if (problems.length) return problems.join('; ')
    return (await nowhere(WL(2))) ? null : 'a row was written'
  })

  await check(
    'whitelist_entries: the owner updates quota and is refused the copies, wallet_address and mint_group_id',
    async () => {
      const quota = await A.client
        .from('whitelist_entries')
        .update({ quota: 3 })
        .eq('mint_group_id', holders)
        .eq('wallet_address', WL(1))
        .select()
      if (quota.error) return `quota: ${describe(quota.error as DbError)}`
      if (quota.data.length !== 1) return `quota: ${quota.data.length} row(s)`
      const problems: string[] = []
      for (const patch of [
        { written_quota: 3 },
        { written_tx: CHUNK_TX(1) },
        { written_at: new Date().toISOString() },
        { wallet_address: WL(3) },
        { mint_group_id: full },
      ]) {
        const { data, error } = await A.client
          .from('whitelist_entries')
          .update(patch)
          .eq('mint_group_id', holders)
          .eq('wallet_address', WL(1))
          .select()
        const problem = expectError(error as DbError, PERMISSION, data)
        if (problem) problems.push(`${Object.keys(patch)[0]}: ${problem}`)
      }
      if (problems.length) return problems.join('; ')
      const row = await rowOf(WL(1))
      return row?.quota === 3 && row.written_quota === null ? null : JSON.stringify(row)
    },
  )

  await check('whitelist_entries: a negative, malformed or partial copy is refused', async () => {
    const at = new Date().toISOString()
    const problems: string[] = []
    for (const [label, copy] of [
      ['negative', { written_quota: -1, written_tx: CHUNK_TX(1), written_at: at }],
      ['malformed', { written_quota: 1, written_tx: `0x${'AB'.repeat(32)}`, written_at: at }],
      ['partial', { written_quota: 1 }],
    ] as const) {
      const { data, error } = await admin
        .from('whitelist_entries')
        .update(copy)
        .eq('mint_group_id', holders)
        .eq('wallet_address', WL(1))
        .select()
      const problem = expectError(error as DbError, CHECK, data)
      if (problem) problems.push(`${label}: ${problem}`)
    }
    if (problems.length) return problems.join('; ')
    return (await rowOf(WL(1)))?.written_quota === null ? null : 'a copy was written'
  })

  await check('whitelist_entries_add: a signed-out caller cannot execute it', async () => {
    const { error } = await add(anon, 1, [{ address: WL(4), quota: 1 }])
    const problem = expectSentence(error, PERMISSION, 'permission denied')
    if (problem) return problem
    return (await nowhere(WL(4))) ? null : 'a row was written'
  })

  await check('whitelist_entries_add: a draft is refused as not deployed', async () => {
    const { error } = await add(A.client, 1, [{ address: WL(4), quota: 1 }], draftId)
    const problem = expectSentence(error, CHECK, NOT_DEPLOYED_SENTENCE)
    if (problem) return problem
    return (await nowhere(WL(4))) ? null : 'a row was written'
  })

  await check("whitelist_entries_add: B's session on A's group is refused as not found", async () => {
    const { error } = await add(B.client, 1, [{ address: WL(4), quota: 1 }])
    const problem = expectSentence(error, PERMISSION, 'phase not found')
    if (problem) return problem
    return (await nowhere(WL(4))) ? null : 'a row was written'
  })

  await check('whitelist_entries_add: a quota of 0 or 10,001 is refused', async () => {
    const problems: string[] = []
    for (const quota of [0, 10_001]) {
      const { error } = await add(A.client, 1, [{ address: WL(4), quota }])
      const problem = expectSentence(error, CHECK, QUOTA_SENTENCE)
      if (problem) problems.push(`${quota}: ${problem}`)
    }
    if (problems.length) return problems.join('; ')
    return (await nowhere(WL(4))) ? null : 'a row was written'
  })

  await check('whitelist_entries_add: the public sale is refused', async () => {
    const { error } = await add(A.client, 0, [{ address: WL(4), quota: 1 }])
    const problem = expectSentence(error, CHECK, PUBLIC_SALE_SENTENCE)
    if (problem) return problem
    return (await nowhere(WL(4))) ? null : 'a row was written'
  })

  await check(
    'whitelist_entries_add: the 10,001st address is refused and nothing of that add is kept',
    async () => {
      const rows = (from: number, count: number): Pair[] =>
        Array.from({ length: count }, (_, index) => ({ address: WL(10_000 + from + index), quota: 1 }))
      const filled = await add(A.client, 2, rows(0, 9_999))
      if (filled.error) return `9,999: ${describe(filled.error)}`
      const over = await add(A.client, 2, rows(9_999, 2))
      const problem = expectSentence(over.error, CHECK, FULL_SENTENCE)
      if (problem) return problem
      const kept = await countRows('whitelist_entries', 'mint_group_id', full)
      return kept === 9_999 ? null : `${kept} rows`
    },
  )

  await check(
    'whitelist_entries_add: answers the rows it added and changed; a listed quota changes, its copies do not',
    async () => {
      const first = await add(A.client, 1, [
        { address: WL(5), quota: 2 },
        { address: WL(6), quota: 3 },
      ])
      if (first.error) return `first: ${describe(first.error)}`
      const copy = await admin
        .from('whitelist_entries')
        .update({ written_quota: 2, written_tx: CHUNK_TX(2), written_at: new Date().toISOString() })
        .eq('mint_group_id', holders)
        .eq('wallet_address', WL(5))
      if (copy.error) return `copy: ${describe(copy.error as DbError)}`
      const second = await add(A.client, 1, [
        { address: WL(5), quota: 5 },
        { address: WL(6), quota: 3 },
        { address: WL(7), quota: 1 },
      ])
      if (second.error) return `second: ${describe(second.error)}`
      const counts = `${JSON.stringify(first.data)} ${JSON.stringify(second.data)}`
      const five = await rowOf(WL(5))
      return counts === '[{"added":2,"updated":0}] [{"added":1,"updated":1}]' &&
        five?.quota === 5 &&
        five.written_quota === 2 &&
        five.written_tx === CHUNK_TX(2)
        ? null
        : `${counts} ${JSON.stringify(five)}`
    },
  )

  await check(
    "whitelist_chunk_record: the owner's session, a signed-out caller, a draft, another owner, an unknown group and a malformed hash are refused",
    async () => {
      const pair: Pair[] = [{ address: WL(8), quota: 1 }]
      const problems: string[] = []
      for (const [who, client] of [
        ['owner session', A.client],
        ['signed out', anon],
      ] as const) {
        const { error } = await callArt(
          client,
          'whitelist_chunk_record',
          chunkArgs(A.userId, cid, 1, CHUNK_TX(3), pair),
        )
        const problem = expectSentence(error, PERMISSION, 'permission denied')
        if (problem) problems.push(`${who}: ${problem}`)
      }
      const refusals: [string, DbError, string[], string][] = [
        [
          'draft',
          (await record(1, CHUNK_TX(3), pair, A.userId, draftId)).error,
          CHECK,
          NOT_DEPLOYED_SENTENCE,
        ],
        [
          'another owner',
          (await record(1, CHUNK_TX(3), pair, B.userId)).error,
          PERMISSION,
          'collection not found',
        ],
        ['unknown group', (await record(9, CHUNK_TX(3), pair)).error, PERMISSION, 'phase not found'],
        [
          'malformed hash',
          (await record(1, `0x${'AB'.repeat(32)}`, pair)).error,
          CHECK,
          NOT_THIS_CHANGE_SENTENCE,
        ],
      ]
      for (const [label, error, codes, sentence] of refusals) {
        const problem = expectSentence(error, codes, sentence)
        if (problem) problems.push(`${label}: ${problem}`)
      }
      if (problems.length) return problems.join('; ')
      return (await nowhere(WL(8))) ? null : 'a row was written'
    },
  )

  await check(
    'whitelist_chunk_record: writes the three copies of each pair above 0 and answers how many',
    async () => {
      const { data, error } = await record(1, CHUNK_TX(4), [
        { address: WL(5), quota: 5 },
        { address: WL(6), quota: 3 },
      ])
      if (error) return describe(error)
      const five = await rowOf(WL(5))
      const six = await rowOf(WL(6))
      return data === 2 &&
        five?.written_quota === 5 &&
        five.written_tx === CHUNK_TX(4) &&
        five.written_at !== null &&
        six?.written_quota === 3 &&
        six.written_tx === CHUNK_TX(4)
        ? null
        : `${JSON.stringify(data)} ${JSON.stringify([five, six])}`
    },
  )

  await check(
    'whitelist_chunk_record: a pair for an address Cobweb does not list creates its row, written',
    async () => {
      const { data, error } = await record(1, CHUNK_TX(5), [{ address: WL(9), quota: 4 }])
      if (error) return describe(error)
      const row = await rowOf(WL(9))
      return data === 1 && row?.quota === 4 && row.written_quota === 4 && row.written_tx === CHUNK_TX(5)
        ? null
        : `${JSON.stringify(data)} ${JSON.stringify(row)}`
    },
  )

  await check(
    'whitelist_chunk_record: a written zero deletes its staged removal, keeps an address re-added meanwhile, and creates nothing for an unlisted zero',
    async () => {
      const staged = await A.client
        .from('whitelist_entries')
        .update({ quota: 0 })
        .eq('mint_group_id', holders)
        .in('wallet_address', [WL(5), WL(6)])
      if (staged.error) return `stage: ${describe(staged.error as DbError)}`
      const readded = await add(A.client, 1, [{ address: WL(6), quota: 2 }])
      if (readded.error) return `re-add: ${describe(readded.error)}`
      const { data, error } = await record(1, CHUNK_TX(6), [
        { address: WL(5), quota: 0 },
        { address: WL(6), quota: 0 },
        { address: WL(10), quota: 0 },
      ])
      if (error) return describe(error)
      const six = await rowOf(WL(6))
      return data === 2 &&
        (await nowhere(WL(5))) &&
        (await nowhere(WL(10))) &&
        six?.quota === 2 &&
        six.written_quota === 0 &&
        six.written_tx === CHUNK_TX(6)
        ? null
        : `${JSON.stringify(data)} ${JSON.stringify(await entryRows(holders))}`
    },
  )

  await check(
    'whitelist_chunk_record: the same transaction recorded twice answers 0 and keeps written_at',
    async () => {
      const before = await rowOf(WL(9))
      const { data, error } = await record(1, CHUNK_TX(5), [{ address: WL(9), quota: 4 }])
      if (error) return describe(error)
      const after = await rowOf(WL(9))
      return data === 0 && before?.written_at !== null && after?.written_at === before?.written_at
        ? null
        : `${JSON.stringify(data)} ${JSON.stringify([before, after])}`
    },
  )
}

// ---------------------------------------------------------------------------------------------
// 10. Cleanup
// ---------------------------------------------------------------------------------------------
```

- [ ] **Step 2: Run the checks to see them fail**

Run: `pnpm --filter @cobweb/web verify:local`
Expected: the run ends `326 passed, 16 failed`. The sixteen FAIL lines are the section 9l checks (the copies and the two functions do not exist yet: PostgREST answers `PGRST204` or `PGRST202`, and a quota of 0 is refused by the old check); section 7's "a negative quota is refused" passes.

- [ ] **Step 3: The migration**

Create `supabase/migrations/20261015100000_whitelist.sql`:

```sql
-- Whitelist (docs/specs/2026-10-15-whitelist.md, section 4): whitelist_entries keeps the creator's list (the
-- address and its quota, 0 for a removal staged on a written address) and a copy of what the chain was last
-- proven to hold (written_quota, written_tx, written_at), set together and written only by
-- whitelist_chunk_record after a receipt and its calldata prove the chunk. The owner's client inserts the
-- list's four columns, updates quota alone and deletes; adds go through whitelist_entries_add, which locks the
-- group for the 10,000 cap.

-- ---------------------------------------------------------------------------------------------
-- whitelist_entries: a quota of 0, the copies and their checks, the narrowed grants
-- ---------------------------------------------------------------------------------------------
alter table public.whitelist_entries drop constraint whitelist_entries_quota_check;
alter table public.whitelist_entries
  add constraint whitelist_entries_quota_check check (quota >= 0),
  add column written_quota integer check (written_quota >= 0),
  add column written_tx text check (written_tx ~ '^0x[0-9a-f]{64}$'),
  add column written_at timestamptz,
  add constraint whitelist_entries_written_together check (
    (written_quota is null) = (written_tx is null) and (written_tx is null) = (written_at is null));

comment on table public.whitelist_entries is
  'One row per address on a whitelist phase. The list, changed by the owner: mint_group_id, collection_id, wallet_address and quota (1 to 10,000, or 0 for a removal staged on a written address). A copy of the chain, written only by whitelist_chunk_record after a receipt and its calldata prove the chunk: written_quota, written_tx and written_at, set together. An entry is written when written_quota equals quota.';

-- The owner reads and deletes as before, inserts the list's four columns and updates quota alone. The policy
-- "whitelist_entries: owner all" stays: it scopes what the grants allow to the owner's rows.
revoke insert, update on public.whitelist_entries from authenticated;
grant insert (mint_group_id, collection_id, wallet_address, quota) on public.whitelist_entries to authenticated;
grant update (quota) on public.whitelist_entries to authenticated;

-- ---------------------------------------------------------------------------------------------
-- whitelist_entries_add: the owner's adds and quota changes, at most 10,000 rows per group
-- ---------------------------------------------------------------------------------------------
-- Security invoker for authenticated only, as mint_group_move: the owner's policy and column grants apply, so
-- another creator's group is not found. p_rows is [{ address, quota }], addresses lowercase. A listed
-- address takes the new quota where it differs (a staged removal re-added gets its quota back); the copies
-- never change here. The group row is locked, so two adds to one group never pass the cap together; past
-- 10,000 rows nothing is kept. Answers the rows it inserted and the rows whose quota it changed.
create function public.whitelist_entries_add(p_collection_id uuid, p_onchain_id integer, p_rows jsonb)
returns table (added integer, updated integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_group public.mint_groups;
begin
  select g.* into v_group
  from public.mint_groups g
  where g.collection_id = p_collection_id and g.onchain_id = p_onchain_id
  for no key update;
  if not found then
    raise exception 'phase not found' using errcode = '42501';
  end if;
  if v_group.onchain_id = 0 then
    raise exception 'The public sale has no whitelist.' using errcode = '23514';
  end if;
  if not exists (select 1 from public.deployments d where d.collection_id = p_collection_id) then
    raise exception 'The contract is not deployed yet.' using errcode = '23514';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_rows) as r(address text, quota integer)
    where r.quota is null or r.quota < 1 or r.quota > 10000
  ) then
    raise exception 'The quota must be 1 to 10,000.' using errcode = '23514';
  end if;
  with upserted as (
    insert into public.whitelist_entries as e (mint_group_id, collection_id, wallet_address, quota)
    select v_group.id, p_collection_id, r.address, r.quota
    from jsonb_to_recordset(p_rows) as r(address text, quota integer)
    on conflict (mint_group_id, wallet_address) do update
      set quota = excluded.quota
      where e.quota is distinct from excluded.quota
    returning (xmax = 0) as inserted
  )
  select (count(*) filter (where u.inserted))::integer, (count(*) filter (where not u.inserted))::integer
  into added, updated
  from upserted u;
  if (select count(*) from public.whitelist_entries e where e.mint_group_id = v_group.id) > 10000 then
    raise exception 'A whitelist holds up to 10,000 addresses.' using errcode = '23514';
  end if;
  return next;
end;
$$;

revoke all on function public.whitelist_entries_add(uuid, integer, jsonb) from public, anon, service_role;
grant execute on function public.whitelist_entries_add(uuid, integer, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- whitelist_chunk_record: the copies of a chunk the server proved from its receipt and calldata
-- ---------------------------------------------------------------------------------------------
-- Service role only. p_rows is [{ address, quota }], the pairs decoded from a transaction whose receipt the
-- server proved, addresses lowercase; p_owner must equal collections.owner_id. A pair above 0 writes its
-- copies, creating the row with that quota when Cobweb lists none (a chunk sent outside Cobweb); a pair of 0
-- writes the copies of a listed row only; then a row of p_rows whose written and listed quotas are both 0 is
-- deleted (its removal is done). Copies are written only where they differ, so a second record of the same
-- transaction answers 0 and keeps written_at. Answers how many entries' copies it wrote.
create function public.whitelist_chunk_record(
  p_collection_id uuid,
  p_owner uuid,
  p_onchain_id integer,
  p_tx text,
  p_rows jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_collection public.collections;
  v_group_id uuid;
  v_set integer;
  v_zeroed integer;
begin
  v_collection := private.lock_owned_collection(p_collection_id, p_owner);
  if not exists (select 1 from public.deployments d where d.collection_id = v_collection.id) then
    raise exception 'The contract is not deployed yet.' using errcode = '23514';
  end if;
  if p_tx is null or p_tx !~ '^0x[0-9a-f]{64}$' then
    raise exception 'The transaction did not make this change.' using errcode = '23514';
  end if;
  select g.id into v_group_id
  from public.mint_groups g
  where g.collection_id = v_collection.id and g.onchain_id = p_onchain_id;
  if not found then
    raise exception 'phase not found' using errcode = '42501';
  end if;
  with written as (
    insert into public.whitelist_entries as e
      (mint_group_id, collection_id, wallet_address, quota, written_quota, written_tx, written_at)
    select v_group_id, v_collection.id, r.address, r.quota, r.quota, p_tx, now()
    from jsonb_to_recordset(p_rows) as r(address text, quota integer)
    where r.quota > 0
    on conflict (mint_group_id, wallet_address) do update
      set written_quota = excluded.written_quota,
          written_tx = excluded.written_tx,
          written_at = excluded.written_at
      where e.written_quota is distinct from excluded.written_quota
        or e.written_tx is distinct from excluded.written_tx
    returning 1
  )
  select count(*)::integer into v_set from written;
  update public.whitelist_entries e
  set written_quota = 0, written_tx = p_tx, written_at = now()
  from jsonb_to_recordset(p_rows) as r(address text, quota integer)
  where r.quota = 0
    and e.mint_group_id = v_group_id
    and e.wallet_address = r.address
    and (e.written_quota is distinct from 0 or e.written_tx is distinct from p_tx);
  get diagnostics v_zeroed = row_count;
  delete from public.whitelist_entries e
  using jsonb_to_recordset(p_rows) as r(address text, quota integer)
  where e.mint_group_id = v_group_id
    and e.wallet_address = r.address
    and e.written_quota = 0
    and e.quota = 0;
  return v_set + v_zeroed;
end;
$$;

revoke all on function public.whitelist_chunk_record(uuid, uuid, integer, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.whitelist_chunk_record(uuid, uuid, integer, text, jsonb) to service_role;
```

- [ ] **Step 4: The types, by hand**

Decision (section 4.3): written as the generator writes them (keys in alphabetical order, the copies nullable, the table function's rows as an array), in the same commit as the migration.

In `apps/web/src/lib/database.types.ts`, replace:

```ts
          quota: number
          wallet_address: string
        }
        Insert: {
```

with:

```ts
          quota: number
          wallet_address: string
          written_at: string | null
          written_quota: number | null
          written_tx: string | null
        }
        Insert: {
```

In `apps/web/src/lib/database.types.ts`, replace:

```ts
          quota: number
          wallet_address: string
        }
        Update: {
```

with:

```ts
          quota: number
          wallet_address: string
          written_at?: string | null
          written_quota?: number | null
          written_tx?: string | null
        }
        Update: {
```

In `apps/web/src/lib/database.types.ts`, replace:

```ts
          quota?: number
          wallet_address?: string
        }
        Relationships: [
```

with:

```ts
          quota?: number
          wallet_address?: string
          written_at?: string | null
          written_quota?: number | null
          written_tx?: string | null
        }
        Relationships: [
```

In `apps/web/src/lib/database.types.ts`, replace:

```ts
        Returns: undefined
      }
    }
    Enums: {
```

with:

```ts
        Returns: undefined
      }
      whitelist_chunk_record: {
        Args: {
          p_collection_id: string
          p_onchain_id: number
          p_owner: string
          p_rows: Json
          p_tx: string
        }
        Returns: number
      }
      whitelist_entries_add: {
        Args: { p_collection_id: string; p_onchain_id: number; p_rows: Json }
        Returns: {
          added: number
          updated: number
        }[]
      }
    }
    Enums: {
```

- [ ] **Step 5: Apply the migration and run the checks to see them pass**

Run: `supabase migration up --local`
Expected: `Applying migration 20261015100000_whitelist.sql...` then `Local database is up to date.`

Run: `pnpm --filter @cobweb/web verify:local`
Expected: `342 passed, 0 failed` (the previous total plus 16), with these lines among them:

```
PASS whitelist_entries: a negative quota is refused
PASS whitelist_entries: the owner inserts an entry with a quota of 0 (a staged removal)
PASS whitelist_entries: an owner insert carrying a copy is refused
PASS whitelist_entries: the owner updates quota and is refused the copies, wallet_address and mint_group_id
PASS whitelist_entries: a negative, malformed or partial copy is refused
PASS whitelist_entries_add: a signed-out caller cannot execute it
PASS whitelist_entries_add: a draft is refused as not deployed
PASS whitelist_entries_add: B's session on A's group is refused as not found
PASS whitelist_entries_add: a quota of 0 or 10,001 is refused
PASS whitelist_entries_add: the public sale is refused
PASS whitelist_entries_add: the 10,001st address is refused and nothing of that add is kept
PASS whitelist_entries_add: answers the rows it added and changed; a listed quota changes, its copies do not
PASS whitelist_chunk_record: the owner's session, a signed-out caller, a draft, another owner, an unknown group and a malformed hash are refused
PASS whitelist_chunk_record: writes the three copies of each pair above 0 and answers how many
PASS whitelist_chunk_record: a pair for an address Cobweb does not list creates its row, written
PASS whitelist_chunk_record: a written zero deletes its staged removal, keeps an address re-added meanwhile, and creates nothing for an unlisted zero
PASS whitelist_chunk_record: the same transaction recorded twice answers 0 and keeps written_at
```

A FAIL line names what it found instead; report it to the controller with the line.

- [ ] **Step 6: Format, run the root checks and commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
pnpm exec prettier --write apps/web/src/lib/database.types.ts apps/web/scripts/verify-local.ts
pnpm typecheck && pnpm lint && pnpm test
git add supabase/migrations/20261015100000_whitelist.sql apps/web/src/lib/database.types.ts apps/web/scripts/verify-local.ts
git commit -m "$(cat <<'EOF'
Add the whitelist migration: a quota of 0 for a staged removal, the copies of what the chain holds, the owner's narrowed grants, whitelist_entries_add and whitelist_chunk_record, with their verify:local checks

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: test counts unchanged (shared 72, web 500).

---

### Task 3: The Whitelist sentences, the types, the pure view, the holder list and the batched reads

**Files:**

- Modify: `apps/web/src/lib/art/result.ts` (the Whitelist block appended)
- Modify: `apps/web/src/lib/art/db-error.ts` (three imports; `whitelistWriteError` appended), `apps/web/src/lib/art/db-error.test.ts` (imports; a `describe` appended)
- Create: `apps/web/src/lib/manage/whitelist-types.ts`
- Create: `apps/web/src/lib/manage/whitelist-view.ts`, `apps/web/src/lib/manage/whitelist-view.test.ts`
- Create: `apps/web/src/lib/manage/holders.ts`, `apps/web/src/lib/manage/holders.test.ts`
- Create: `apps/web/src/lib/chain/read-each.ts`, `apps/web/src/lib/chain/read-each.test.ts`
- Test: the four test files above

**Interfaces:**

- Consumes: in `@/lib/art/result`, `NAME_FIRST`, `NOT_DEPLOYED`, `NOT_FOUND`, `UNSAVED` (already there); `DbError = { code?: string; message: string } | null` in `@/lib/art/db-error`; `MintGroup` from `@/lib/demo/types`; `PhasesView` (`{ chainId; contract; groups: MintGroup[]; publicMaxPerWallet; totalMinted; maxSupply; blockTimestamp; readAt; chainReachable }`) from `@/lib/manage/phases-types`; viem's `getAddress`, `zeroAddress`, `BaseError`, `ContractFunctionExecutionError`, `ContractFunctionRevertedError`, `ContractFunctionZeroDataError`, `ContractFunctionParameters`, `PublicClient`.
- Produces:
  - in `@/lib/art/result`: `WHITELIST_FULL`, `QUOTA_RANGE`, `WRONG_GROUP` (the database raises these three as they are), `ZERO_ADDRESS`, `WHITELIST_NOT_CONFIRMED`, `WHITELIST_TIMED_OUT`, `NOT_A_CONTRACT(chain: string): string`, `NOT_ERC721(chain: string): string`, `NO_TOTAL_SUPPLY`, `SNAPSHOT_TOO_LARGE`, `NO_HOLDERS`, `SNAPSHOT_CHAIN`, `SNAPSHOT_FAILED`
  - `whitelistWriteError(error: DbError): string` in `@/lib/art/db-error`
  - in `@/lib/manage/whitelist-types` (types only): `ListEntry = { address: Address; quota: number; writtenQuota: number | null; writtenTx: Hex | null }`, `WrittenChunk = { txHash: Hex; addresses: number; writtenAt: number }` (Unix milliseconds), `GroupList = { onchainId; entries: ListEntry[]; total; written; unwritten; totalQuota; quotaUsed; chunks: WrittenChunk[] }`, `WhitelistView = { chainId; contract: Address; groups: MintGroup[]; lists: GroupList[]; chunkSize: 500; blockTimestamp; readAt; chainReachable: boolean }`, `ChunkEntry = { address: Address; quota: number }`, `ChunkPlan = { onchainId; number; of; entries: ChunkEntry[] }`, `SentChunk = { hash: Hex; onchainId: number }`
  - in `@/lib/manage/whitelist-view`: `WHITELIST_CHUNK = 500`, `WHITELIST_MAX = 10_000`, `QUOTA_MAX = 10_000`, `USAGE_PAGE = 25`, `EntryRow = { wallet_address: string; quota: number; written_quota: number | null; written_tx: string | null; written_at: string | null }`, `isWritten(entry: Pick<ListEntry, 'quota' | 'writtenQuota'>): boolean`, `byAddress(a: { address: string }, b: { address: string }): number`, `entriesOf(rows: EntryRow[]): ListEntry[]`, `writtenChunksOf(rows: EntryRow[]): WrittenChunk[]`, `listOf(onchainId: number, entries: ListEntry[], quotaUsed: number, chunks: WrittenChunk[]): GroupList`, `chunkPlanOf(list: GroupList, size?: number): ChunkPlan | null`, `whitelistGroups(view: PhasesView): MintGroup[]`
  - in `@/lib/manage/holders`: `Holder = { address: Address; balance: number }`, `HolderSnapshot = { holders: Holder[]; block: number; supply: number }`, `SNAPSHOT_MAX_SUPPLY = 20_000`, `snapshotIds(supply: bigint): bigint[]`, `holdersOf(owners: readonly (string | null)[]): Holder[]`
  - in `@/lib/chain/read-each`: `MULTICALL_GROUP = 500`, `PARALLEL_GROUP = 50`, `revertedRead(error: unknown): boolean`, `readEach<T>(client: PublicClient, calls: readonly ContractFunctionParameters[], options?: { blockNumber?: bigint }): Promise<(T | null)[]>`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/lib/manage/whitelist-view.test.ts`:

```ts
import type { Address, Hex } from 'viem'
import { describe, expect, it } from 'vitest'
import type { MintGroup } from '@/lib/demo/types'
import type { PhasesView } from './phases-types'
import type { ListEntry, WrittenChunk } from './whitelist-types'
import {
  chunkPlanOf,
  entriesOf,
  isWritten,
  listOf,
  whitelistGroups,
  writtenChunksOf,
  type EntryRow,
} from './whitelist-view'

// In lowercase address order: 0x15d3, 0x3c44, 0x7099, 0x90f7.
const FIRST: Address = '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65'
const SECOND: Address = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
const THIRD: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const FOURTH: Address = '0x90F79bf6EB2c4f870365E785982E1f101E93b906'
const TX_A: Hex = `0x${'a1'.repeat(32)}`
const TX_B: Hex = `0x${'b2'.repeat(32)}`
const TX_GONE: Hex = `0x${'c3'.repeat(32)}`

const row = (
  wallet: Address,
  quota: number,
  written: number | null = null,
  tx: Hex | null = null,
  at: string | null = null,
): EntryRow => ({
  wallet_address: wallet.toLowerCase(),
  quota,
  written_quota: written,
  written_tx: tx,
  written_at: at,
})

const entry = (
  address: Address,
  quota: number,
  writtenQuota: number | null = null,
  writtenTx: Hex | null = null,
): ListEntry => ({
  address,
  quota,
  writtenQuota,
  writtenTx,
})

describe('entriesOf and writtenChunksOf', () => {
  it('reads the rows as checksummed entries in lowercase address order', () => {
    const entries = entriesOf([
      row(THIRD, 2, 2, TX_A, '2026-10-15T08:00:00Z'),
      row(FIRST, 1),
      row(SECOND, 0, 3, TX_A, '2026-10-15T08:00:00Z'),
    ])
    expect(entries).toEqual<ListEntry[]>([
      entry(FIRST, 1),
      entry(SECOND, 0, 3, TX_A),
      entry(THIRD, 2, 2, TX_A),
    ])
  })

  it('counts each chunk by the rows that name it, in the order they were recorded, to the millisecond', () => {
    const chunks = writtenChunksOf([
      row(FIRST, 2, 2, TX_B, '2026-10-15T08:00:00.700Z'),
      row(SECOND, 1, 1, TX_A, '2026-10-15T08:00:00.200Z'),
      row(THIRD, 1, 1, TX_A, '2026-10-15T08:00:00.200Z'),
      row(FOURTH, 1),
    ])
    expect(chunks).toEqual<WrittenChunk[]>([
      { txHash: TX_A, addresses: 2, writtenAt: Date.parse('2026-10-15T08:00:00.200Z') },
      { txHash: TX_B, addresses: 1, writtenAt: Date.parse('2026-10-15T08:00:00.700Z') },
    ])
  })
})

describe('listOf', () => {
  const chunks: WrittenChunk[] = [
    { txHash: TX_A, addresses: 9, writtenAt: 1 },
    { txHash: TX_GONE, addresses: 4, writtenAt: 2 },
    { txHash: TX_B, addresses: 9, writtenAt: 3 },
  ]

  it('counts a staged removal as unwritten but not listed, and sums the quotas', () => {
    const list = listOf(
      1,
      [entry(FIRST, 2, 2, TX_A), entry(SECOND, 0, 3, TX_A), entry(THIRD, 5, 1, TX_B), entry(FOURTH, 1)],
      7,
      chunks,
    )
    expect(list).toMatchObject({
      onchainId: 1,
      total: 3,
      written: 1,
      unwritten: 3,
      totalQuota: 8,
      quotaUsed: 7,
    })
  })

  it('counts each chunk again from the entries and leaves out a chunk no entry names', () => {
    const list = listOf(
      1,
      [entry(FIRST, 2, 2, TX_A), entry(SECOND, 0, 3, TX_A), entry(THIRD, 5, 1, TX_B)],
      0,
      chunks,
    )
    expect(list.chunks).toEqual<WrittenChunk[]>([
      { txHash: TX_A, addresses: 2, writtenAt: 1 },
      { txHash: TX_B, addresses: 1, writtenAt: 3 },
    ])
  })

  it('reads an entry as written only when the chain holds its quota', () => {
    expect(isWritten({ quota: 2, writtenQuota: 2 })).toBe(true)
    expect(isWritten({ quota: 2, writtenQuota: 1 })).toBe(false)
    expect(isWritten({ quota: 1, writtenQuota: null })).toBe(false)
    expect(isWritten({ quota: 0, writtenQuota: 3 })).toBe(false)
  })
})

describe('chunkPlanOf', () => {
  it('takes the first entries not written in address order, a removal sending 0, numbered after the written chunks', () => {
    const list = listOf(
      2,
      [entry(FIRST, 2, 2, TX_A), entry(SECOND, 0, 3, TX_A), entry(THIRD, 5, 1, TX_B), entry(FOURTH, 1)],
      0,
      [
        { txHash: TX_A, addresses: 2, writtenAt: 1 },
        { txHash: TX_B, addresses: 1, writtenAt: 2 },
      ],
    )
    expect(chunkPlanOf(list)).toEqual({
      onchainId: 2,
      number: 3,
      of: 3,
      entries: [
        { address: SECOND, quota: 0 },
        { address: THIRD, quota: 5 },
        { address: FOURTH, quota: 1 },
      ],
    })
    expect(chunkPlanOf(list, 2)).toEqual({
      onchainId: 2,
      number: 3,
      of: 4,
      entries: [
        { address: SECOND, quota: 0 },
        { address: THIRD, quota: 5 },
      ],
    })
  })

  it('answers null when every entry is written', () => {
    expect(chunkPlanOf(listOf(1, [entry(FIRST, 2, 2, TX_A)], 0, []))).toBeNull()
    expect(chunkPlanOf(listOf(1, [], 0, []))).toBeNull()
  })
})

describe('whitelistGroups', () => {
  it("keeps the phases view's whitelist groups in its order", () => {
    const group = (id: number, name: string): MintGroup => ({
      id,
      name,
      kind: id === 0 ? 'public' : 'whitelist',
      priceWei: '0',
      maxSupply: 1,
      minted: 0,
      flag: false,
      scheduledStart: 0,
      active: false,
    })
    const view: PhasesView = {
      chainId: 31337,
      contract: THIRD,
      groups: [group(2, 'Team'), group(0, 'Public'), group(1, 'Holders')],
      publicMaxPerWallet: 1,
      totalMinted: 0,
      maxSupply: 3,
      blockTimestamp: 0,
      readAt: 0,
      chainReachable: true,
    }
    expect(whitelistGroups(view).map((candidate) => candidate.name)).toEqual(['Team', 'Holders'])
  })
})
```

Create `apps/web/src/lib/manage/holders.test.ts`:

```ts
import { getAddress, zeroAddress, type Address } from 'viem'
import { describe, expect, it } from 'vitest'
import { holdersOf, snapshotIds, type Holder } from './holders'

const A: Address = '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65'
const B: Address = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
const C: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const DEAD: Address = '0x000000000000000000000000000000000000dEaD'

describe('holdersOf', () => {
  it('sums a balance per owner whatever the case, most tokens first, then by lowercase address', () => {
    expect(
      holdersOf([C, A.toLowerCase(), B, A, C.toLowerCase(), B.toUpperCase().replace('0X', '0x')]),
    ).toEqual<Holder[]>([
      { address: A, balance: 2 },
      { address: B, balance: 2 },
      { address: C, balance: 2 },
    ])
    expect(holdersOf([A, C, C])).toEqual<Holder[]>([
      { address: C, balance: 2 },
      { address: A, balance: 1 },
    ])
  })

  it('leaves out failed reads, the zero address and the dead address', () => {
    expect(holdersOf([null, zeroAddress, DEAD, DEAD.toLowerCase(), A, null])).toEqual<Holder[]>([
      { address: getAddress(A), balance: 1 },
    ])
    expect(holdersOf([null, zeroAddress])).toEqual([])
  })
})

describe('snapshotIds', () => {
  it('reads ids 0 to the supply inclusive, so a collection starting at 1 keeps its last token (Review Focus 5)', () => {
    expect(snapshotIds(2n)).toEqual([0n, 1n, 2n])
    expect(snapshotIds(0n)).toEqual([0n])
    expect(snapshotIds(20_000n)).toHaveLength(20_001)
  })
})
```

A fake client stands in for viem's: with `multicall3` it answers each call of a `multicall`; without it each `readContract` waits a tick, so the reads in flight can be counted.

Create `apps/web/src/lib/chain/read-each.test.ts`:

```ts
import {
  BaseError,
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  erc721Abi,
  multicall3Abi,
  type Address,
  type ContractFunctionParameters,
  type PublicClient,
} from 'viem'
import { describe, expect, it } from 'vitest'
import { readEach } from './read-each'

const CONTRACT: Address = '0x0409454C375c8a6aB05383bFB6D9FcDe9ebB8F85'
const MULTICALL3: Address = '0xcA11bde05977b3631167028862bE2a173976CA11'
const BLOCK = 120n

const call = (id: number): ContractFunctionParameters => ({
  address: CONTRACT,
  abi: erc721Abi,
  functionName: 'ownerOf',
  args: [BigInt(id)],
})
const calls = (count: number) => Array.from({ length: count }, (_, id) => call(id))
const idOf = (parameters: { args?: readonly unknown[] }) => Number(parameters.args?.[0])
/** The ids the fakes revert: every seventh, from 3. */
const reverts = (id: number) => id % 7 === 3

/** A revert as viem reports it for one call. */
const reverted = (id: number) =>
  new ContractFunctionExecutionError(
    new ContractFunctionRevertedError({ abi: erc721Abi, functionName: 'ownerOf' }),
    {
      abi: erc721Abi,
      args: [BigInt(id)],
      contractAddress: CONTRACT,
      functionName: 'ownerOf',
    },
  )
/** A request that never reached the node: the multicall as a whole, or one call. */
const unreachable = (whole: boolean) =>
  whole
    ? new ContractFunctionExecutionError(new BaseError('fetch failed'), {
        abi: multicall3Abi,
        args: [[]],
        contractAddress: MULTICALL3,
        functionName: 'aggregate3',
      })
    : new ContractFunctionExecutionError(new BaseError('fetch failed'), {
        abi: erc721Abi,
        args: [60n],
        contractAddress: CONTRACT,
        functionName: 'ownerOf',
      })

type Answer = { status: 'success'; result: number } | { status: 'failure'; error: Error; result: undefined }

/** A chain with multicall3: each multicall answers id * 2, or a revert for the ids `reverts` names. */
function multicallClient(answer?: (contracts: readonly ContractFunctionParameters[]) => Answer[]) {
  const groups: number[] = []
  const blocks: (bigint | undefined)[] = []
  const client = {
    chain: { contracts: { multicall3: { address: MULTICALL3 } } },
    multicall: async (parameters: {
      contracts: readonly ContractFunctionParameters[]
      allowFailure: boolean
      batchSize: number
      blockNumber?: bigint
    }) => {
      groups.push(parameters.contracts.length)
      blocks.push(parameters.blockNumber)
      expect(parameters.allowFailure).toBe(true)
      expect(parameters.batchSize).toBe(0)
      if (answer) return answer(parameters.contracts)
      return parameters.contracts.map((contract): Answer =>
        reverts(idOf(contract))
          ? { status: 'failure', error: reverted(idOf(contract)), result: undefined }
          : { status: 'success', result: idOf(contract) * 2 },
      )
    },
  } as unknown as PublicClient
  return { client, groups, blocks }
}

/** A chain without multicall3 (Anvil): each read waits a tick, so the reads in flight can be counted. */
function parallelClient(fail?: (id: number) => Error | null) {
  let inFlight = 0
  let most = 0
  const blocks: (bigint | undefined)[] = []
  const client = {
    chain: { contracts: {} },
    readContract: async (parameters: { args?: readonly unknown[]; blockNumber?: bigint }) => {
      inFlight++
      most = Math.max(most, inFlight)
      blocks.push(parameters.blockNumber)
      await new Promise((resolve) => setTimeout(resolve, 0))
      inFlight--
      const id = idOf(parameters)
      const error = fail?.(id) ?? (reverts(id) ? reverted(id) : null)
      if (error) throw error
      return id * 2
    },
  } as unknown as PublicClient
  return { client, most: () => most, blocks }
}

const expected = (count: number) => Array.from({ length: count }, (_, id) => (reverts(id) ? null : id * 2))

describe('readEach', () => {
  it('reads groups of 500 as one multicall each, in turn, a reverted read as null, at the block given', async () => {
    const { client, groups, blocks } = multicallClient()
    expect(await readEach<number>(client, calls(1_001), { blockNumber: BLOCK })).toEqual(expected(1_001))
    expect(groups).toEqual([500, 500, 1])
    expect(blocks).toEqual([BLOCK, BLOCK, BLOCK])
  })

  it('reads groups of 50 side by side without multicall3, a reverted read as null, at the block given', async () => {
    const { client, most, blocks } = parallelClient()
    expect(await readEach<number>(client, calls(120), { blockNumber: BLOCK })).toEqual(expected(120))
    expect(most()).toBe(50)
    expect(blocks.every((block) => block === BLOCK)).toBe(true)
  })

  it('answers nothing for no calls', async () => {
    expect(await readEach<number>(multicallClient().client, [])).toEqual([])
  })

  it('throws a request that failed as a whole, with multicall3 or without', async () => {
    const whole = unreachable(true)
    const failedMulticall = multicallClient((contracts) =>
      contracts.map((): Answer => ({ status: 'failure', error: whole, result: undefined })),
    )
    await expect(readEach<number>(failedMulticall.client, calls(3))).rejects.toBe(whole)
    const thrown = new Error('fetch failed')
    const throwing = multicallClient(() => {
      throw thrown
    })
    await expect(readEach<number>(throwing.client, calls(3))).rejects.toBe(thrown)
    const network = unreachable(false)
    const parallel = parallelClient((id) => (id === 60 ? network : null))
    await expect(readEach<number>(parallel.client, calls(120))).rejects.toBe(network)
  })
})
```

Then the error map's tests: the imports, and a `describe` at the end of `apps/web/src/lib/art/db-error.test.ts`.

In `apps/web/src/lib/art/db-error.test.ts`, replace:

```ts
import { describe, expect, it } from 'vitest'
import { artWriteError, lockWriteError, phasesWriteError } from './db-error'
import {
  ALREADY_LOCKED,
```

with:

```ts
import { describe, expect, it } from 'vitest'
import { artWriteError, lockWriteError, phasesWriteError, whitelistWriteError } from './db-error'
import {
  ALREADY_LOCKED,
```

In `apps/web/src/lib/art/db-error.test.ts`, replace:

```ts
  PUBLIC_SHOWN,
  UNSAVED,
} from './result'

```

with:

```ts
  PUBLIC_SHOWN,
  UNSAVED,
  NAME_FIRST,
  QUOTA_RANGE,
  WHITELIST_FULL,
  WRONG_GROUP,
} from './result'

```

In `apps/web/src/lib/art/db-error.test.ts`, replace:

```ts
    expect(phasesWriteError(null)).toBe(UNSAVED)
  })
})

```

with:

```ts
    expect(phasesWriteError(null)).toBe(UNSAVED)
  })
})

describe('whitelistWriteError', () => {
  it('names the phase first for a group without a row, and reads any other refused owner check as not found', () => {
    expect(whitelistWriteError({ code: '42501', message: 'phase not found' })).toBe(NAME_FIRST)
    expect(whitelistWriteError({ code: '42501', message: 'collection not found' })).toBe(NOT_FOUND)
    expect(
      whitelistWriteError({ code: '42501', message: 'permission denied for function whitelist_entries_add' }),
    ).toBe(NOT_FOUND)
  })

  it('passes the whitelist sentences through', () => {
    for (const sentence of [NOT_DEPLOYED, WHITELIST_FULL, QUOTA_RANGE, WRONG_GROUP])
      expect(whitelistWriteError({ code: '23514', message: sentence })).toBe(sentence)
  })

  it('says "reload" for anything else', () => {
    expect(
      whitelistWriteError({
        code: '23514',
        message:
          'new row for relation "whitelist_entries" violates check constraint "whitelist_entries_wallet_address_check"',
      }),
    ).toBe(UNSAVED)
    expect(
      whitelistWriteError({
        code: '21000',
        message: 'ON CONFLICT DO UPDATE command cannot affect row a second time',
      }),
    ).toBe(UNSAVED)
    expect(whitelistWriteError({ code: '23514', message: 'The transaction did not make this change.' })).toBe(
      UNSAVED,
    )
    expect(whitelistWriteError(null)).toBe(UNSAVED)
  })
})

```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @cobweb/web exec vitest run src/lib/manage/whitelist-view.test.ts src/lib/manage/holders.test.ts src/lib/chain/read-each.test.ts src/lib/art/db-error.test.ts`
Expected: FAIL. The three new files fail to load (`Cannot find module './whitelist-view'`, `./holders`, `./read-each`, or Vitest's `Failed to load url`: the modules do not exist); `db-error.test.ts` fails three tests with `TypeError: whitelistWriteError is not a function`.

- [ ] **Step 3: The sentences and the error map**

At the end of `apps/web/src/lib/art/result.ts`, append:

```ts

// Whitelist (docs/specs/2026-10-15-whitelist.md, section 6.6). The database raises the first three as they are.
export const WHITELIST_FULL = 'A whitelist holds up to 10,000 addresses.'
export const QUOTA_RANGE = 'The quota must be 1 to 10,000.'
export const WRONG_GROUP = 'The public sale has no whitelist.'
// Said by the server or the screen (the database does not raise these).
export const ZERO_ADDRESS = 'The zero address cannot mint or receive tokens.'
export const WHITELIST_NOT_CONFIRMED = 'The chunk has not been confirmed on chain yet.'
export const WHITELIST_TIMED_OUT =
  'The chunk is not confirmed yet. Check again in a minute; sending it again is safe.'
export const NOT_A_CONTRACT = (chain: string) => `There is no contract at this address on ${chain}.`
export const NOT_ERC721 = (chain: string) => `This address is not an ERC-721 contract on ${chain}.`
export const NO_TOTAL_SUPPLY = 'This contract does not report its total supply.'
export const SNAPSHOT_TOO_LARGE = 'Snapshots cover collections up to 20,000 tokens for now.'
export const NO_HOLDERS = 'No holders found. Check the address and the chain.'
export const SNAPSHOT_CHAIN = 'Cobweb cannot read this chain yet. Choose another chain.'
export const SNAPSHOT_FAILED = 'The snapshot could not be taken. Try again in a moment.'
```

In `apps/web/src/lib/art/db-error.ts`, the import list from `./result` (the first statement of the file) gains `NAME_FIRST`, `QUOTA_RANGE`, `WHITELIST_FULL` and `WRONG_GROUP`, and the map is appended at the end of the file:

In `apps/web/src/lib/art/db-error.ts`, replace:

```ts
  LOCKED,
  LINK_REQUIRED,
  NO_CHAIN,
  NO_PAYMENT_DUE,
```

with:

```ts
  LOCKED,
  LINK_REQUIRED,
  NAME_FIRST,
  NO_CHAIN,
  NO_PAYMENT_DUE,
```

In `apps/web/src/lib/art/db-error.ts`, replace:

```ts
  PLACEHOLDER_LOCKED,
  PUBLIC_SHOWN,
  QUOTE_EXPIRED,
  QUOTE_FROZEN,
```

with:

```ts
  PLACEHOLDER_LOCKED,
  PUBLIC_SHOWN,
  QUOTA_RANGE,
  QUOTE_EXPIRED,
  QUOTE_FROZEN,
```

In `apps/web/src/lib/art/db-error.ts`, replace:

```ts
  UNSAVED,
  UPLOAD_CAP,
} from './result'

```

with:

```ts
  UNSAVED,
  UPLOAD_CAP,
  WHITELIST_FULL,
  WRONG_GROUP,
} from './result'

```

In `apps/web/src/lib/art/db-error.ts`, replace:

```ts
    if (PHASES_SENTENCES.has(error.message)) return error.message
  }
  return UNSAVED
}

```

with:

```ts
    if (PHASES_SENTENCES.has(error.message)) return error.message
  }
  return UNSAVED
}

/** Sentences the whitelist functions raise (supabase/migrations/20261015100000_whitelist.sql). */
const WHITELIST_SENTENCES = new Set([NOT_DEPLOYED, WHITELIST_FULL, QUOTA_RANGE, WRONG_GROUP])

/**
 * A failed whitelist write, by SQLSTATE, in the creator's words (docs/specs/2026-10-15-whitelist.md, section
 * 6.6): a group Cobweb has no row for is named first, any other refused owner check reads as not found, and
 * the functions' own sentences pass through.
 */
export function whitelistWriteError(error: DbError): string {
  if (!error) return UNSAVED
  if (error.code === '42501') return error.message === 'phase not found' ? NAME_FIRST : NOT_FOUND
  if (error.code === '23514' && WHITELIST_SENTENCES.has(error.message)) return error.message
  return UNSAVED
}

```

- [ ] **Step 4: The types, the view, the holder list and the batched reads**

Create `apps/web/src/lib/manage/whitelist-types.ts`:

```ts
import type { Address, Hex } from 'viem'
import type { MintGroup } from '@/lib/demo/types'

/**
 * The shapes the Whitelist tab moves between the database, the server and the screen
 * (docs/specs/2026-10-15-whitelist.md, section 6.1). Types only, so the browser imports them without the
 * server module (whitelist-core.ts).
 */

/** One address on a group's list: the creator's quota and what the chain was last proven to hold. */
export type ListEntry = {
  /** Checksummed. */
  address: Address
  /** 1 to 10,000, or 0 for a removal staged on a written address. */
  quota: number
  /** The quota the last proven chunk carrying the address wrote, or null while none has. */
  writtenQuota: number | null
  /** That chunk's transaction (lowercase), or null. */
  writtenTx: Hex | null
}

/** A chunk on chain, counted by the entries that still name its transaction. */
export type WrittenChunk = {
  txHash: Hex
  addresses: number
  /** When the server recorded it, in Unix milliseconds, so chunks recorded in the same second keep their order. */
  writtenAt: number
}

/** One whitelist group's list and its counts. */
export type GroupList = {
  onchainId: number
  /** In lowercase address order. */
  entries: ListEntry[]
  /** Entries above 0. */
  total: number
  /** Entries whose written quota equals their quota. */
  written: number
  /** The rest, staged removals included. */
  unwritten: number
  /** The sum of the quotas. */
  totalQuota: number
  /** The group's minted count from the chain (each whitelist mint claims one quota); 0 when the chain did not answer. */
  quotaUsed: number
  /** In the order they were written. */
  chunks: WrittenChunk[]
}

/** What the Whitelist tab shows: the phases view's whitelist groups and a list per named group. */
export type WhitelistView = {
  chainId: number
  contract: Address
  /** The whitelist groups (id 1 and up), in the phases view's order. */
  groups: MintGroup[]
  /** One per whitelist group Cobweb has a row for. */
  lists: GroupList[]
  chunkSize: 500
  /** The chain's time at the read, for relative labels only. */
  blockTimestamp: number
  readAt: number
  /** False: the groups are the copy; quota used and minted counts are unknown and chunks wait. */
  chainReachable: boolean
}

/** One address and quota as an add sends it or a chunk carries it. */
export type ChunkEntry = { address: Address; quota: number }

/** The next chunk the server built: chunk `number` of `of`, its entries in address order, a removal sending 0. */
export type ChunkPlan = { onchainId: number; number: number; of: number; entries: ChunkEntry[] }

/** A chunk this browser sent and the server has not confirmed yet. */
export type SentChunk = { hash: Hex; onchainId: number }
```

Create `apps/web/src/lib/manage/whitelist-view.ts`:

```ts
import { getAddress, type Hex } from 'viem'
import type { MintGroup } from '@/lib/demo/types'
import type { PhasesView } from './phases-types'
import type { ChunkPlan, GroupList, ListEntry, WrittenChunk } from './whitelist-types'

/**
 * The Whitelist view, pure (docs/specs/2026-10-15-whitelist.md, section 6.1), for the browser and the
 * server: the entries from their rows, the chunks the rows still name, a group's counts and the next chunk.
 * An entry is written when the chain was last proven to hold its quota.
 */

/** Addresses per `setMintQuota` transaction (MASTER_PLAN, whitelist quotas). */
export const WHITELIST_CHUNK = 500
/** Rows per group, the actions' and `whitelist_entries_add`'s cap. */
export const WHITELIST_MAX = 10_000
/** The largest quota the screens and the database take. */
export const QUOTA_MAX = 10_000
/** Addresses whose quota used one usage read covers: a page of the table. */
export const USAGE_PAGE = 25

/** A `whitelist_entries` row as the server reads it. */
export type EntryRow = {
  wallet_address: string
  quota: number
  written_quota: number | null
  written_tx: string | null
  written_at: string | null
}

export function isWritten(entry: Pick<ListEntry, 'quota' | 'writtenQuota'>): boolean {
  return entry.writtenQuota === entry.quota
}

/** Lowercase address order, the order of the database's key. */
export function byAddress(a: { address: string }, b: { address: string }): number {
  const left = a.address.toLowerCase()
  const right = b.address.toLowerCase()
  return left < right ? -1 : left > right ? 1 : 0
}

/** The rows as entries, checksummed, in lowercase address order. */
export function entriesOf(rows: EntryRow[]): ListEntry[] {
  return rows
    .map((row): ListEntry => ({
      address: getAddress(row.wallet_address),
      quota: row.quota,
      writtenQuota: row.written_quota,
      writtenTx: row.written_tx as Hex | null,
    }))
    .sort(byAddress)
}

/** The chunks the rows name, each counting its rows, in the order they were recorded. */
export function writtenChunksOf(rows: EntryRow[]): WrittenChunk[] {
  const chunks = new Map<string, WrittenChunk>()
  for (const row of rows) {
    if (!row.written_tx || !row.written_at) continue
    const at = Date.parse(row.written_at)
    const known = chunks.get(row.written_tx)
    if (known) {
      known.addresses++
      known.writtenAt = Math.min(known.writtenAt, at)
    } else chunks.set(row.written_tx, { txHash: row.written_tx as Hex, addresses: 1, writtenAt: at })
  }
  return [...chunks.values()].sort(
    (a, b) => a.writtenAt - b.writtenAt || (a.txHash < b.txHash ? -1 : a.txHash > b.txHash ? 1 : 0),
  )
}

/**
 * A group's list and its counts. Each chunk counts the entries that still name it, and a chunk no entry
 * names is left out, so a patch to the entries keeps the chunks right.
 */
export function listOf(
  onchainId: number,
  entries: ListEntry[],
  quotaUsed: number,
  chunks: WrittenChunk[],
): GroupList {
  const named = new Map<string, number>()
  let total = 0
  let written = 0
  let totalQuota = 0
  for (const entry of entries) {
    if (entry.quota > 0) total++
    if (isWritten(entry)) written++
    totalQuota += entry.quota
    if (entry.writtenTx) named.set(entry.writtenTx, (named.get(entry.writtenTx) ?? 0) + 1)
  }
  return {
    onchainId,
    entries,
    total,
    written,
    unwritten: entries.length - written,
    totalQuota,
    quotaUsed,
    chunks: chunks.flatMap((chunk) => {
      const addresses = named.get(chunk.txHash) ?? 0
      return addresses > 0 ? [{ ...chunk, addresses }] : []
    }),
  }
}

/**
 * The next chunk: the first `size` entries not written, in address order, a removal sending 0; null when
 * every entry is written. Its number follows the written chunks; `of` adds what the unwritten entries need.
 */
export function chunkPlanOf(list: GroupList, size = WHITELIST_CHUNK): ChunkPlan | null {
  const waiting = list.entries.filter((entry) => !isWritten(entry))
  if (waiting.length === 0) return null
  return {
    onchainId: list.onchainId,
    number: list.chunks.length + 1,
    of: list.chunks.length + Math.ceil(waiting.length / size),
    entries: waiting.slice(0, size).map((entry) => ({ address: entry.address, quota: entry.quota })),
  }
}

/** The phases view's whitelist groups (id 1 and up), in its order. */
export function whitelistGroups(view: PhasesView): MintGroup[] {
  return view.groups.filter((group) => group.kind === 'whitelist')
}
```

Create `apps/web/src/lib/manage/holders.ts`:

```ts
import { getAddress, zeroAddress, type Address } from 'viem'

/**
 * The holder snapshot's pure parts (docs/specs/2026-10-15-whitelist.md, section 6.4): which token ids to
 * read, and the owners read back as holders with their balances. The server reads the chain
 * (snapshot-core.ts); the browser shows the result.
 */

/** One holder of the snapshotted collection and how many of its tokens they hold. */
export type Holder = { address: Address; balance: number }

/** A snapshot at one block: the holders, the block, and the `totalSupply()` read there. */
export type HolderSnapshot = { holders: Holder[]; block: number; supply: number }

/** The largest `totalSupply()` a snapshot reads (one `ownerOf` per id, within a server action's 300 seconds). */
export const SNAPSHOT_MAX_SUPPLY = 20_000

const DEAD = '0x000000000000000000000000000000000000dead'

/**
 * The ids to read: 0 to the supply, both ends included, so a collection numbered from 0 and one numbered
 * from 1 are both read whole. An id that does not exist (the extra end, or a burned token) reads null.
 */
export function snapshotIds(supply: bigint): bigint[] {
  return Array.from({ length: Number(supply) + 1 }, (_, id) => BigInt(id))
}

/**
 * Owners as holders: failed reads, the zero address and the dead address left out, a balance summed per
 * owner, checksummed, the most tokens first, then by lowercase address.
 */
export function holdersOf(owners: readonly (string | null)[]): Holder[] {
  const balances = new Map<string, number>()
  for (const owner of owners) {
    if (!owner) continue
    const key = owner.toLowerCase()
    if (key === zeroAddress || key === DEAD) continue
    balances.set(key, (balances.get(key) ?? 0) + 1)
  }
  return [...balances]
    .sort(([a, left], [b, right]) => right - left || (a < b ? -1 : a > b ? 1 : 0))
    .map(([address, balance]) => ({ address: getAddress(address), balance }))
}
```

Create `apps/web/src/lib/chain/read-each.ts`:

```ts
import {
  BaseError,
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  type ContractFunctionParameters,
  type PublicClient,
} from 'viem'

/** Calls in one `multicall` where viem's chain has `multicall3`. */
export const MULTICALL_GROUP = 500
/** Calls read side by side where it has none (Anvil). */
export const PARALLEL_GROUP = 50

/** Whether a failed read is the call's own revert (or an empty answer), rather than the request failing. */
export function revertedRead(error: unknown): boolean {
  return (
    error instanceof BaseError &&
    error.walk(
      (cause) =>
        cause instanceof ContractFunctionRevertedError || cause instanceof ContractFunctionZeroDataError,
    ) !== null
  )
}

/** viem reports a multicall that failed as a whole as the failure of every call, its error naming `aggregate3`. */
const requestFailed = (error: unknown) =>
  error instanceof ContractFunctionExecutionError && error.functionName === 'aggregate3'

/**
 * One value per call, null where the call reverted (docs/specs/2026-10-15-whitelist.md, section 6.3): where
 * viem's chain has `multicall3`, groups of 500 as one `multicall`; otherwise (Anvil) groups of 50 calls side by
 * side. Groups run in turn, and a request that fails as a whole throws.
 */
export async function readEach<T>(
  client: PublicClient,
  calls: readonly ContractFunctionParameters[],
  options: { blockNumber?: bigint } = {},
): Promise<(T | null)[]> {
  const multicall = client.chain?.contracts?.multicall3 !== undefined
  const size = multicall ? MULTICALL_GROUP : PARALLEL_GROUP
  const answers: (T | null)[] = []
  for (let from = 0; from < calls.length; from += size) {
    const group = calls.slice(from, from + size)
    if (multicall) {
      const results = await client.multicall({
        contracts: group,
        allowFailure: true,
        batchSize: 0,
        blockNumber: options.blockNumber,
      })
      for (const result of results) {
        if (result.status === 'success') answers.push(result.result as T)
        else if (requestFailed(result.error)) throw result.error
        else answers.push(null)
      }
    } else {
      const settled = await Promise.allSettled(
        group.map((call) => client.readContract({ ...call, blockNumber: options.blockNumber })),
      )
      for (const result of settled) {
        if (result.status === 'fulfilled') answers.push(result.value as T)
        else if (revertedRead(result.reason)) answers.push(null)
        else throw result.reason
      }
    }
  }
  return answers
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `pnpm --filter @cobweb/web exec vitest run src/lib/manage/whitelist-view.test.ts src/lib/manage/holders.test.ts src/lib/chain/read-each.test.ts src/lib/art/db-error.test.ts`
Expected: PASS, 30 tests in 4 files (whitelist-view 8, holders 3, read-each 4, db-error 15).

- [ ] **Step 6: Format, run the root checks and commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
pnpm exec prettier --write apps/web/src/lib/art/result.ts apps/web/src/lib/art/db-error.ts apps/web/src/lib/art/db-error.test.ts apps/web/src/lib/manage/whitelist-types.ts apps/web/src/lib/manage/whitelist-view.ts apps/web/src/lib/manage/whitelist-view.test.ts apps/web/src/lib/manage/holders.ts apps/web/src/lib/manage/holders.test.ts apps/web/src/lib/chain/read-each.ts apps/web/src/lib/chain/read-each.test.ts
pnpm typecheck && pnpm lint && pnpm test
git add apps/web/src/lib/art/result.ts apps/web/src/lib/art/db-error.ts apps/web/src/lib/art/db-error.test.ts apps/web/src/lib/manage/whitelist-types.ts apps/web/src/lib/manage/whitelist-view.ts apps/web/src/lib/manage/whitelist-view.test.ts apps/web/src/lib/manage/holders.ts apps/web/src/lib/manage/holders.test.ts apps/web/src/lib/chain/read-each.ts apps/web/src/lib/chain/read-each.test.ts
git commit -m "$(cat <<'EOF'
Add the Whitelist sentences and error map, the list types and the pure view, the holder list and the batched chain reads

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: the web package reports 518 tests (500 before: 18 added).

---

### Task 4: The quota call, its shapes, the chunk proof, the quota errors in words and the zero address refused

**Files:**

- Modify: `apps/web/src/lib/manage/phase-calls.ts` (whole file), `apps/web/src/lib/manage/phase-calls.test.ts` (imports; a `describe` appended)
- Modify: `apps/web/src/lib/manage/phase-schemas.ts` (whole file), `apps/web/src/lib/manage/phase-schemas.test.ts` (one import; a `describe` appended)
- Create: `apps/web/src/lib/manage/whitelist-schemas.ts`, `apps/web/src/lib/manage/whitelist-schemas.test.ts`
- Create: `apps/web/src/lib/chain/quota-chunk.ts`, `apps/web/src/lib/chain/quota-chunk.test.ts`
- Modify: `apps/web/src/components/deploy/tx-errors.ts` (one import, the comment and four cases in `revertSentence`), `apps/web/src/components/deploy/tx-errors.test.ts` (four rows)
- Modify: `apps/web/src/components/manage/recipients.ts` (one import, the comment, the zero address check), `apps/web/src/components/manage/recipients.test.ts` (imports, one test)
- Test: the six test files above

**Interfaces:**

- Consumes: from Task 3, `ZERO_ADDRESS`, `QUOTA_RANGE`, `WHITELIST_FULL`, `WRONG_GROUP` (`@/lib/art/result`), `QUOTA_MAX`, `WHITELIST_CHUNK`, `WHITELIST_MAX`, `USAGE_PAGE` (`@/lib/manage/whitelist-view`), `ChunkEntry` (`@/lib/manage/whitelist-types`); already in the repo, `NOT_FROM_WALLET`, `NOT_THIS_CHANGE`, `NOT_THIS_CONTRACT`, `UNSAVED`, `DESCRIPTION_TOO_LONG` (`@/lib/art/result`), `matchPhaseEvent(receipt, { contract, from, event })` and `PhaseReceipt = ReceiptLike & { from: Address; to: Address | null }` (`@/lib/chain/phase-events`), `onchainIdShape` and `INT_MAX` (`@/lib/manage/phase-schemas`, `@/lib/manage/phases-view`), `formatNative`, `formatUtc` (`@/lib/demo/helpers`), `parse(schema, input)` (`@/lib/art/schemas`), `collectionAbi` (`@cobweb/shared/collection-abi`).
- Produces:
  - in `@/lib/manage/phase-calls`: `ManageFunction` gains `'setMintQuota'`; `ManageCall` gains `{ functionName: 'setMintQuota'; args: readonly [readonly Address[], bigint, readonly bigint[]] }`; `SentCall = { functionName: ManageFunction; args: (string | boolean | string[])[] }`; `ExpectedEvent` gains `{ eventName: 'MintQuotasAdded'; args: { mintGroup: bigint; numberOfAddresses: bigint } }`; `phaseCalls.quotas(id: number, addresses: Address[], quotas: number[]): ManageCall`; `expectedEvent`, `sentOf`, `callOf` and `reviewOf` handle it (`reviewOf` rows `addressesToAdd` "500 addresses", `mintGroup` "1", `mintQuotas` "500 quotas, 1,240 in total").
  - in `@/lib/manage/phase-schemas`: `sentCallShape` takes `{ functionName: 'setMintQuota', args: [string[], string, string[]] }` (1 to 500 checksummed addresses, as many quotas of 0 to 10,000 as decimal strings); `parseSentCall` unchanged.
  - in `@/lib/manage/whitelist-schemas`: `groupIdShape` (1 to 2,147,483,647; 0 is `WRONG_GROUP`), `quotaShape` (1 to 10,000, else `QUOTA_RANGE`), `addressShape: z.ZodType<Address>` (valid, not zero, answered checksummed), `addEntriesShape: z.ZodType<ChunkEntry[]>` (1 to 10,000 rows, more is `WHITELIST_FULL`; repeats in any case merged, the last quota winning), `usageShape: z.ZodType<Address[]>` (1 to 25), `snapshotShape: z.ZodType<{ chainId: number; contract: Address }>`
  - in `@/lib/chain/quota-chunk`: `ChunkProof = { ok: true; pairs: { address: string; quota: number }[] } | { ok: false; error: string }`, `proveQuotaChunk(receipt: PhaseReceipt, input: Hex, expected: { contract: Address; from: string; onchainId: number }): ChunkProof`
  - `revertSentence(errorName, args)` (`@/components/deploy/tx-errors`) words `ArrayLengthMismatch`, `PublicGroupHasNoQuota`, `NotInWhitelist` and `ExceedsMintQuota`
  - `parseRecipients` (`@/components/manage/recipients`) refuses the zero address with `ZERO_ADDRESS` and its line number

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/lib/manage/phase-calls.test.ts`, the viem import grows and a `describe` for the quota call is appended:

In `apps/web/src/lib/manage/phase-calls.test.ts`, replace:

```ts
import { collectionAbi } from '@cobweb/shared/collection-abi'
import { concat, encodeAbiParameters, encodeFunctionData, toFunctionSelector, type Hex } from 'viem'
import { describe, expect, it } from 'vitest'
import type { SupportedChain } from '@/lib/demo/types'
```

with:

```ts
import { collectionAbi } from '@cobweb/shared/collection-abi'
import {
  concat,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  pad,
  toFunctionSelector,
  toHex,
  type Address,
  type Hex,
} from 'viem'
import { describe, expect, it } from 'vitest'
import type { SupportedChain } from '@/lib/demo/types'
```

In `apps/web/src/lib/manage/phase-calls.test.ts`, replace:

```ts
      args: { mintGroup: 3n, newPrice: 1_000_000_000_000_000_000_000_001n },
    })
  })
})

```

with:

```ts
      args: { mintGroup: 3n, newPrice: 1_000_000_000_000_000_000_000_001n },
    })
  })
})

describe('the quota call (docs/specs/2026-10-15-whitelist.md, section 7.1)', () => {
  const A: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
  const B: Address = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
  const CHUNK: ManageCall = phaseCalls.quotas(1, [A, B], [1_240, 0])

  it('encodes setMintQuota with the addresses first, as the hand-written signature does', () => {
    expect(encoded(CHUNK)).toBe(
      handEncoded(
        'setMintQuota(address[],uint256,uint256[])',
        [{ type: 'address[]' }, UINT, { type: 'uint256[]' }],
        [[A, B], 1n, [1_240n, 0n]],
      ),
    )
  })

  it('expects MintQuotasAdded for the group and the number of addresses', () => {
    expect(expectedEvent(CHUNK)).toEqual({
      eventName: 'MintQuotasAdded',
      args: { mintGroup: 1n, numberOfAddresses: 2n },
    })
  })

  it('round trips the arrays through decimal strings', () => {
    expect(sentOf(CHUNK)).toEqual({ functionName: 'setMintQuota', args: [[A, B], '1', ['1240', '0']] })
    expect(callOf(sentOf(CHUNK))).toEqual(CHUNK)
  })

  it('reviews a chunk as counts: its addresses, the group, its quotas and their total', () => {
    const addresses = Array.from({ length: 500 }, (_, index) =>
      getAddress(pad(toHex(index + 1), { size: 20 })),
    )
    const quotas = addresses.map((_, index) => (index < 240 ? 3 : 2))
    expect(reviewOf(phaseCalls.quotas(1, addresses, quotas), BASE)).toEqual([
      { name: 'addressesToAdd', value: '500 addresses' },
      { name: 'mintGroup', value: '1' },
      { name: 'mintQuotas', value: '500 quotas, 1,240 in total' },
    ])
    expect(reviewOf(phaseCalls.quotas(3, [A], [2]), BASE)).toEqual([
      { name: 'addressesToAdd', value: '1 address' },
      { name: 'mintGroup', value: '3' },
      { name: 'mintQuotas', value: '1 quota, 2 in total' },
    ])
  })
})

```

In `apps/web/src/lib/manage/phase-schemas.test.ts`, add the `Address` type and append the chunk's cases:

In `apps/web/src/lib/manage/phase-schemas.test.ts`, replace:

```ts
import { describe, expect, it } from 'vitest'
import { PHASE_NAME_EMPTY, PHASE_NAME_LONG } from '@/components/manage/phase-rules'
```

with:

```ts
import type { Address } from 'viem'
import { describe, expect, it } from 'vitest'
import { PHASE_NAME_EMPTY, PHASE_NAME_LONG } from '@/components/manage/phase-rules'
```

In `apps/web/src/lib/manage/phase-schemas.test.ts`, replace:

```ts
    expect(parse(directionShape, 'left')).toEqual({ ok: false, error: UNSAVED })
  })
})

```

with:

```ts
    expect(parse(directionShape, 'left')).toEqual({ ok: false, error: UNSAVED })
  })
})

describe('parseSentCall for a chunk (docs/specs/2026-10-15-whitelist.md, section 7.1)', () => {
  const A: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
  const B: Address = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'

  it('accepts checksummed addresses with as many quotas of 0 to 10,000, and answers the chunk unchanged', () => {
    const call = phaseCalls.quotas(2, [A, B], [10_000, 0])
    const parsed = parseSentCall(sentOf(call))
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(callOf(parsed.data)).toEqual(call)
  })

  it.each<[string, unknown]>([
    ['a lowercase address', { functionName: 'setMintQuota', args: [[A.toLowerCase()], '1', ['1']] }],
    [
      'a broken checksum',
      { functionName: 'setMintQuota', args: [['0x70997970c51812dc3A010C7d01b50e0d17dc79C8'], '1', ['1']] },
    ],
    [
      'addresses and quotas of different lengths',
      { functionName: 'setMintQuota', args: [[A, B], '1', ['1']] },
    ],
    ['an empty chunk', { functionName: 'setMintQuota', args: [[], '1', []] }],
    [
      '501 addresses',
      { functionName: 'setMintQuota', args: [Array(501).fill(A), '1', Array(501).fill('1')] },
    ],
    ['a quota of 10,001', { functionName: 'setMintQuota', args: [[A], '1', ['10001']] }],
    ['a quota as a number', { functionName: 'setMintQuota', args: [[A], '1', [1]] }],
    ['a group above 2,147,483,647', { functionName: 'setMintQuota', args: [[A], '2147483648', ['1']] }],
  ])('refuses %s as UNSAVED', (_label, input) => {
    expect(parseSentCall(input)).toEqual({ ok: false, error: UNSAVED })
  })
})

```

Create `apps/web/src/lib/manage/whitelist-schemas.test.ts`:

```ts
import { zeroAddress, type Address } from 'viem'
import { describe, expect, it } from 'vitest'
import { QUOTA_RANGE, UNSAVED, WHITELIST_FULL, WRONG_GROUP, ZERO_ADDRESS } from '@/lib/art/result'
import { parse } from '@/lib/art/schemas'
import {
  addEntriesShape,
  addressShape,
  groupIdShape,
  quotaShape,
  snapshotShape,
  usageShape,
} from './whitelist-schemas'

const A: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const B: Address = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'

/** Distinct lowercase addresses, none of them zero. */
const rows = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    address: `0x${(index + 1).toString(16).padStart(40, '0')}`,
    quota: 1,
  }))

describe('groupIdShape and quotaShape', () => {
  it('takes a whitelist group of 1 or more; the public sale has no whitelist', () => {
    expect(parse(groupIdShape, 1)).toEqual({ ok: true, data: 1 })
    expect(parse(groupIdShape, 0)).toEqual({ ok: false, error: WRONG_GROUP })
    expect(parse(groupIdShape, -1)).toEqual({ ok: false, error: UNSAVED })
    expect(parse(groupIdShape, 1.5)).toEqual({ ok: false, error: UNSAVED })
    expect(parse(groupIdShape, 2_147_483_648)).toEqual({ ok: false, error: UNSAVED })
  })

  it('takes a whole quota from 1 to 10,000', () => {
    expect(parse(quotaShape, 1)).toEqual({ ok: true, data: 1 })
    expect(parse(quotaShape, 10_000)).toEqual({ ok: true, data: 10_000 })
    for (const quota of [0, 10_001, 2.5, '2', null])
      expect(parse(quotaShape, quota)).toEqual({ ok: false, error: QUOTA_RANGE })
  })
})

describe('addressShape', () => {
  it('answers a valid address checksummed, whatever its case', () => {
    expect(parse(addressShape, A.toLowerCase())).toEqual({ ok: true, data: A })
    expect(parse(addressShape, A)).toEqual({ ok: true, data: A })
  })

  it('refuses the zero address with its sentence, and anything malformed as UNSAVED', () => {
    expect(parse(addressShape, zeroAddress)).toEqual({ ok: false, error: ZERO_ADDRESS })
    for (const value of ['0x70997970c51812dc3A010C7d01b50e0d17dc79C8', '0x123', 'not an address', 5, null])
      expect(parse(addressShape, value)).toEqual({ ok: false, error: UNSAVED })
  })
})

describe('addEntriesShape', () => {
  it('merges an address repeated in another case into one row, the last quota winning (Review Focus 1)', () => {
    expect(
      parse(addEntriesShape, [
        { address: A, quota: 2 },
        { address: B, quota: 1 },
        { address: A.toLowerCase(), quota: 5 },
      ]),
    ).toEqual({
      ok: true,
      data: [
        { address: A, quota: 5 },
        { address: B, quota: 1 },
      ],
    })
  })

  it('takes 1 to 10,000 rows; more is a full whitelist', () => {
    expect(parse(addEntriesShape, [])).toEqual({ ok: false, error: UNSAVED })
    const full = parse(addEntriesShape, rows(10_000))
    expect(full.ok && full.data.length).toBe(10_000)
    expect(parse(addEntriesShape, rows(10_001))).toEqual({ ok: false, error: WHITELIST_FULL })
  })

  it('refuses the zero address and a quota out of range with their sentences, anything else as UNSAVED', () => {
    expect(parse(addEntriesShape, [{ address: zeroAddress, quota: 1 }])).toEqual({
      ok: false,
      error: ZERO_ADDRESS,
    })
    expect(parse(addEntriesShape, [{ address: A, quota: 0 }])).toEqual({ ok: false, error: QUOTA_RANGE })
    expect(parse(addEntriesShape, [{ address: A }])).toEqual({ ok: false, error: QUOTA_RANGE })
    expect(parse(addEntriesShape, 'rows')).toEqual({ ok: false, error: UNSAVED })
  })
})

describe('usageShape and snapshotShape', () => {
  it('takes 1 to 25 addresses for a usage read', () => {
    expect(parse(usageShape, [A.toLowerCase()])).toEqual({ ok: true, data: [A] })
    expect(parse(usageShape, [])).toEqual({ ok: false, error: UNSAVED })
    expect(parse(usageShape, Array(26).fill(A))).toEqual({ ok: false, error: UNSAVED })
  })

  it('takes a chain id and a contract address for a snapshot', () => {
    expect(parse(snapshotShape, { chainId: 8453, contract: A.toLowerCase() })).toEqual({
      ok: true,
      data: { chainId: 8453, contract: A },
    })
    expect(parse(snapshotShape, { chainId: 0, contract: A })).toEqual({ ok: false, error: UNSAVED })
    expect(parse(snapshotShape, { chainId: 8453, contract: 'nope' })).toEqual({ ok: false, error: UNSAVED })
  })
})
```

Create `apps/web/src/lib/chain/quota-chunk.test.ts`:

```ts
import { collectionAbi } from '@cobweb/shared/collection-abi'
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  getAbiItem,
  type AbiEvent,
  type Address,
  type Hex,
} from 'viem'
import { describe, expect, it } from 'vitest'
import { NOT_FROM_WALLET, NOT_THIS_CHANGE, NOT_THIS_CONTRACT } from '@/lib/art/result'
import { phaseCalls, type ManageCall } from '@/lib/manage/phase-calls'
import type { PhaseReceipt } from './phase-events'
import { proveQuotaChunk, type ChunkProof } from './quota-chunk'

const CONTRACT: Address = '0x0409454C375c8a6aB05383bFB6D9FcDe9ebB8F85'
const ELSEWHERE: Address = '0x2073D2716161E2Fa4eBcB3BA42348dE8f98A3dDd'
const WALLET: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const STRANGER: Address = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
const A: Address = '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65'
const B: Address = '0x90F79bf6EB2c4f870365E785982E1f101E93b906'

type ReceiptLog = PhaseReceipt['logs'][number]

/** The calldata the wallet sends for a call. */
const inputOf = (call: ManageCall): Hex =>
  encodeFunctionData({ abi: collectionAbi, functionName: call.functionName, args: call.args })

/** `MintQuotasAdded` as the contract emits it: neither argument is indexed, so both sit in data. */
function quotasAdded(group: bigint, count: bigint, address: Address = CONTRACT): ReceiptLog {
  const item = getAbiItem({ abi: collectionAbi, name: 'MintQuotasAdded' }) as AbiEvent
  return {
    address,
    topics: encodeEventTopics({ abi: [item], eventName: item.name } as never) as ReceiptLog['topics'],
    data: encodeAbiParameters(item.inputs, [group, count]),
  }
}

const receipt = (logs: ReceiptLog[], patch: Partial<PhaseReceipt> = {}): PhaseReceipt => ({
  status: 'success',
  from: WALLET,
  to: CONTRACT,
  logs,
  ...patch,
})

const expected = { contract: CONTRACT, from: WALLET.toLowerCase(), onchainId: 1 }
const CHUNK: ManageCall = phaseCalls.quotas(1, [A, B], [2, 0])

describe('proveQuotaChunk', () => {
  it('answers the pairs the calldata carries, lowercased, for a chunk sent from the wallet to the collection', () => {
    expect(proveQuotaChunk(receipt([quotasAdded(1n, 2n)]), inputOf(CHUNK), expected)).toEqual<ChunkProof>({
      ok: true,
      pairs: [
        { address: A.toLowerCase(), quota: 2 },
        { address: B.toLowerCase(), quota: 0 },
      ],
    })
  })

  it("keeps an address's last quota when the calldata repeats it, in any case, as the contract does", () => {
    const repeated = phaseCalls.quotas(1, [A, B, A.toLowerCase() as Address], [1, 2, 3])
    expect(proveQuotaChunk(receipt([quotasAdded(1n, 3n)]), inputOf(repeated), expected)).toEqual<ChunkProof>({
      ok: true,
      pairs: [
        { address: A.toLowerCase(), quota: 3 },
        { address: B.toLowerCase(), quota: 2 },
      ],
    })
  })

  it('matches the contract and the wallet whatever their case', () => {
    const proof = proveQuotaChunk(
      receipt([quotasAdded(1n, 2n, CONTRACT.toLowerCase() as Address)], { from: WALLET }),
      inputOf(CHUNK),
      { contract: CONTRACT.toLowerCase() as Address, from: WALLET.toLowerCase(), onchainId: 1 },
    )
    expect(proof.ok).toBe(true)
  })

  it.each<[string, PhaseReceipt, Hex, number, string]>([
    [
      'another contract',
      receipt([quotasAdded(1n, 2n)], { to: ELSEWHERE }),
      inputOf(CHUNK),
      1,
      NOT_THIS_CONTRACT,
    ],
    [
      'a contract creation',
      receipt([quotasAdded(1n, 2n)], { to: null }),
      inputOf(CHUNK),
      1,
      NOT_THIS_CONTRACT,
    ],
    [
      'another sender',
      receipt([quotasAdded(1n, 2n)], { from: STRANGER }),
      inputOf(CHUNK),
      1,
      NOT_FROM_WALLET,
    ],
    ['a reverted receipt', receipt([], { status: 'reverted' }), inputOf(CHUNK), 1, NOT_THIS_CHANGE],
    ['an input the ABI does not decode', receipt([quotasAdded(1n, 2n)]), '0xdeadbeef', 1, NOT_THIS_CHANGE],
    ['another function', receipt([quotasAdded(1n, 2n)]), inputOf(phaseCalls.open(1)), 1, NOT_THIS_CHANGE],
    ['another group', receipt([quotasAdded(1n, 2n)]), inputOf(CHUNK), 2, NOT_THIS_CHANGE],
    [
      'a quota above 10,000',
      receipt([quotasAdded(1n, 1n)]),
      inputOf(phaseCalls.quotas(1, [A], [10_001])),
      1,
      NOT_THIS_CHANGE,
    ],
    ['no MintQuotasAdded', receipt([]), inputOf(CHUNK), 1, NOT_THIS_CHANGE],
    [
      'MintQuotasAdded with another count',
      receipt([quotasAdded(1n, 3n)]),
      inputOf(CHUNK),
      1,
      NOT_THIS_CHANGE,
    ],
    [
      'MintQuotasAdded from another contract',
      receipt([quotasAdded(1n, 2n, ELSEWHERE)]),
      inputOf(CHUNK),
      1,
      NOT_THIS_CHANGE,
    ],
  ])('refuses %s', (_label, proven, input, onchainId, error) => {
    expect(proveQuotaChunk(proven, input, { ...expected, onchainId })).toEqual<ChunkProof>({
      ok: false,
      error,
    })
  })
})
```

In `apps/web/src/components/deploy/tx-errors.test.ts`, the table of decoded reverts gains four rows:

In `apps/web/src/components/deploy/tx-errors.test.ts`, replace:

```ts
      `Only the contract's owner can make this change, and ${STRANGER} is not the owner.`,
    ],
  ])('words %s (%s) from the decoded revert, ending "Nothing was sent."', (errorName, args, sentence) => {
    expect(classifyError(simulationRevert(errorName, args), 'simulating', 'manage')).toEqual({
```

with:

```ts
      `Only the contract's owner can make this change, and ${STRANGER} is not the owner.`,
    ],
    ['ArrayLengthMismatch', [], 'The addresses and quotas do not line up. Reload and try again.'],
    ['PublicGroupHasNoQuota', [], 'The public sale has no whitelist.'],
    ['NotInWhitelist', [STRANGER, 2n], `${STRANGER} is not on the whitelist of phase 2.`],
    ['ExceedsMintQuota', [1_500n, 1_200n], 'This wallet can mint 1,200 more in this phase, not 1,500.'],
  ])('words %s (%s) from the decoded revert, ending "Nothing was sent."', (errorName, args, sentence) => {
    expect(classifyError(simulationRevert(errorName, args), 'simulating', 'manage')).toEqual({
```

In `apps/web/src/components/manage/recipients.test.ts`, import `ZERO_ADDRESS` and `InvalidRow`, and add a test after the repeated-address test:

In `apps/web/src/components/manage/recipients.test.ts`, replace:

```ts
import { getAddress } from 'viem'
import { describe, expect, it } from 'vitest'
import { parseRecipients, toCsv, type ParseOptions } from './recipients'

const WHITELIST: ParseOptions = {
```

with:

```ts
import { getAddress } from 'viem'
import { describe, expect, it } from 'vitest'
import { ZERO_ADDRESS } from '@/lib/art/result'
import { parseRecipients, toCsv, type InvalidRow, type ParseOptions } from './recipients'

const WHITELIST: ParseOptions = {
```

In `apps/web/src/components/manage/recipients.test.ts`, replace:

```ts
  })

  it('takes semicolons, tabs and spaces, and the default amount', () => {
    const result = parseRecipients(`${A};4\n${B}\t2\n0x9c8b7a6f5e4d3c2b1a09f8e7d6c5b4a392817065`, WHITELIST)
```

with:

```ts
  })

  it('refuses the zero address with its line number, for a whitelist and an airdrop alike', () => {
    const zero = '0x0000000000000000000000000000000000000000'
    for (const options of [WHITELIST, AIRDROP]) {
      const result = parseRecipients(`${A},2\n${zero},1\n${B}`, options)
      expect(result.invalid).toEqual<InvalidRow[]>([{ line: 2, text: `${zero},1`, reason: ZERO_ADDRESS }])
      expect(result.rows.map((row) => row.line)).toEqual([1, 3])
    }
  })

  it('takes semicolons, tabs and spaces, and the default amount', () => {
    const result = parseRecipients(`${A};4\n${B}\t2\n0x9c8b7a6f5e4d3c2b1a09f8e7d6c5b4a392817065`, WHITELIST)
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @cobweb/web exec vitest run src/lib/manage/phase-calls.test.ts src/lib/manage/phase-schemas.test.ts src/lib/manage/whitelist-schemas.test.ts src/lib/chain/quota-chunk.test.ts src/components/deploy/tx-errors.test.ts src/components/manage/recipients.test.ts`
Expected: FAIL. `whitelist-schemas.test.ts` and `quota-chunk.test.ts` fail to load (the modules do not exist); `phase-calls.test.ts` and `phase-schemas.test.ts` fail with `TypeError: phaseCalls.quotas is not a function` (the chunk's eight refusals in `phase-schemas.test.ts` already pass: today every unknown call is UNSAVED); `tx-errors.test.ts` fails the four new rows (the message falls back to "The check against the contract failed: ..."); `recipients.test.ts` fails the zero address test (the zero address is accepted).

- [ ] **Step 3: The quota call and the chunk's shape**

Replace the whole of `apps/web/src/lib/manage/phase-calls.ts` with:

```ts
import { collectionAbi } from '@cobweb/shared/collection-abi'
import { getAbiItem, type AbiFunction, type Address, type ContractFunctionArgs } from 'viem'
import { formatNative, formatUtc } from '@/lib/demo/helpers'
import type { SupportedChain } from '@/lib/demo/types'

/**
 * The collection calls Manage drop sends (docs/specs/2026-10-15-phases.md, section 7.1), built in one
 * place for the browser, the server and the verify scripts. Pure. Whitelist adds `setMintQuota`
 * (docs/specs/2026-10-15-whitelist.md, section 7.1); Airdrop and Settings add theirs.
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

/** A call as viem takes it: the function name and its arguments typed from the collection's ABI. */
export type ManageCall = {
  [F in ManageFunction]: {
    functionName: F
    args: ContractFunctionArgs<typeof collectionAbi, 'nonpayable', F>
  }
}[ManageFunction]

/**
 * A call as it crosses the server action boundary: every uint256 as a decimal string, booleans as they are,
 * an array as an array of strings.
 */
export type SentCall = { functionName: ManageFunction; args: (string | boolean | string[])[] }

/**
 * The collection event a call must leave in its receipt, with viem's argument names (section 6.3). Close
 * all names only its status: any number of groups may have changed.
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
  }
}

/** One argument of a call, whatever the function. */
type CallArg = bigint | boolean | readonly (bigint | Address)[]

const sentArg = (arg: CallArg): string | boolean | string[] =>
  typeof arg === 'boolean'
    ? arg
    : typeof arg === 'bigint'
      ? arg.toString()
      : arg.map((item) => item.toString())

/** A call as the browser sends it to the confirm action. */
export function sentOf(call: ManageCall): SentCall {
  return { functionName: call.functionName, args: call.args.map(sentArg) }
}

/** A sent call back as viem takes it. The shape is checked first (`parseSentCall`), so every value converts. */
export function callOf(sent: SentCall): ManageCall {
  const uint = (index: number) => BigInt(sent.args[index] as string)
  const bool = (index: number) => sent.args[index] === true
  const list = (index: number) => sent.args[index] as string[]
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
  }
}

const PRICE_INPUTS = new Set(['price', 'newMintPrice'])

/** `1 address`, `500 addresses`, with thousands separators. */
const counted = (value: number | bigint, one: string, many: string) =>
  `${value.toLocaleString('en-US')} ${value === 1 || value === 1n ? one : many}`

/** An array argument as counts: the addresses, or the quotas with their total. */
function listValue(name: string, values: readonly (bigint | Address)[]): string {
  if (name !== 'mintQuotas') return counted(values.length, 'address', 'addresses')
  const total = values.reduce<bigint>((sum, value) => sum + (typeof value === 'bigint' ? value : 0n), 0n)
  return `${counted(values.length, 'quota', 'quotas')}, ${total.toLocaleString('en-US')} in total`
}

/**
 * The rows the dialog shows before signing: the ABI's argument names (a trailing underscore dropped) with
 * readable values, a price as the native amount and its wei, a start as UTC and its Unix value, an array as
 * counts (a chunk's addresses, its quotas and their total).
 */
export function reviewOf(call: ManageCall, chain: SupportedChain): { name: string; value: string }[] {
  const item = getAbiItem({ abi: collectionAbi, name: call.functionName }) as AbiFunction
  return call.args.map((arg: CallArg, index) => {
    const name = (item.inputs[index]?.name ?? `argument ${index + 1}`).replace(/_$/, '')
    if (typeof arg === 'boolean') return { name, value: String(arg) }
    if (typeof arg !== 'bigint') return { name, value: listValue(name, arg) }
    if (PRICE_INPUTS.has(name))
      return { name, value: `${formatNative(arg, chain.nativeSymbol, 18)} (${arg} wei)` }
    if (name === 'startTimestamp')
      return { name, value: arg === 0n ? '0 (no scheduled start)' : `${formatUtc(Number(arg))} (${arg})` }
    return { name, value: arg.toString() }
  })
}
```

Replace the whole of `apps/web/src/lib/manage/phase-schemas.ts` with:

```ts
import { getAddress, isAddress } from 'viem'
import { z } from 'zod'
import {
  PHASE_DESCRIPTION_MAX,
  PHASE_NAME_EMPTY,
  PHASE_NAME_LONG,
  PHASE_NAME_MAX,
} from '@/components/manage/phase-rules'
import { DESCRIPTION_TOO_LONG, UNSAVED } from '@/lib/art/result'
import type { SentCall } from './phase-calls'
import { INT_MAX } from './phases-view'
import { QUOTA_MAX, WHITELIST_CHUNK } from './whitelist-view'

/**
 * What the Phases actions accept from the browser (docs/specs/2026-10-15-phases.md, section 6.4), checked
 * before the session and owner read. A malformed value means the page is out of date (UNSAVED); a name or
 * a description reads as the screen's own sentences.
 */

const UINT256_MAX = 2n ** 256n - 1n

/** A group id as a number: the copy's integer column holds 0 to 2,147,483,647. */
export const onchainIdShape = z.number({ error: UNSAVED }).int(UNSAVED).min(0, UNSAVED).max(INT_MAX, UNSAVED)
export const directionShape = z.enum(['up', 'down'], { error: UNSAVED })
export const visibleShape = z.boolean({ error: UNSAVED })

const nameShape = z
  .string({ error: PHASE_NAME_EMPTY })
  .trim()
  .min(1, PHASE_NAME_EMPTY)
  .max(PHASE_NAME_MAX, PHASE_NAME_LONG)
const descriptionShape = z.string({ error: UNSAVED }).trim().max(PHASE_DESCRIPTION_MAX, DESCRIPTION_TOO_LONG)

/** Edit details: the name trimmed with the screen's sentences, the description at most 500 characters. */
export const phaseDetailsShape = z.object(
  { name: nameShape, description: descriptionShape },
  { error: UNSAVED },
)

/** Add phase's off-chain fields: the id is 1 or more, since 0 is always the public sale. */
export const phaseAddShape = z.object(
  {
    onchainId: onchainIdShape.min(1, UNSAVED),
    name: nameShape,
    description: descriptionShape,
    visible: visibleShape,
  },
  { error: UNSAVED },
)

// One refine each: zod runs every check of a string, so a separate regex would not stop BigInt('1.5').
const idText = z.string().refine((value) => /^\d{1,10}$/.test(value) && Number(value) <= INT_MAX)
const uintText = z.string().refine((value) => /^\d{1,78}$/.test(value) && BigInt(value) <= UINT256_MAX)
// A chunk's parts (docs/specs/2026-10-15-whitelist.md, section 7.1): checksummed addresses and quotas of 0 to 10,000.
const checksummed = z.string().refine((value) => isAddress(value) && value === getAddress(value))
const quotaText = z.string().refine((value) => /^\d{1,5}$/.test(value) && Number(value) <= QUOTA_MAX)

/**
 * A sent call: ids 0 to 2,147,483,647, every uint256 a decimal string, in each function's argument order; a
 * chunk is 1 to 500 checksummed addresses with as many quotas.
 */
export const sentCallShape = z.discriminatedUnion('functionName', [
  z.object({
    functionName: z.literal('registerMintGroup'),
    args: z.tuple([idText, uintText, uintText, uintText]),
  }),
  z.object({ functionName: z.literal('setMintGroupStatus'), args: z.tuple([idText, z.boolean()]) }),
  z.object({ functionName: z.literal('scheduleMintGroupStart'), args: z.tuple([idText, uintText]) }),
  z.object({ functionName: z.literal('changeSalePrice'), args: z.tuple([uintText, idText]) }),
  z.object({ functionName: z.literal('setMintGroupMaxSupply'), args: z.tuple([idText, uintText]) }),
  z.object({ functionName: z.literal('setPublicMaxMintPerWallet'), args: z.tuple([uintText]) }),
  z.object({ functionName: z.literal('stopOrStartAllMintGroups'), args: z.tuple([z.boolean()]) }),
  z.object({
    functionName: z.literal('setMintQuota'),
    args: z
      .tuple([
        z.array(checksummed).min(1).max(WHITELIST_CHUNK),
        idText,
        z.array(quotaText).min(1).max(WHITELIST_CHUNK),
      ])
      .refine(([addresses, , quotas]) => addresses.length === quotas.length),
  }),
])

/** A sent call from the browser, or UNSAVED whatever is wrong with it. */
export function parseSentCall(input: unknown): { ok: true; data: SentCall } | { ok: false; error: string } {
  const result = sentCallShape.safeParse(input)
  return result.success ? { ok: true, data: result.data } : { ok: false, error: UNSAVED }
}
```

- [ ] **Step 4: The input shapes and the chunk proof**

Create `apps/web/src/lib/manage/whitelist-schemas.ts`:

```ts
import { getAddress, isAddress, zeroAddress, type Address } from 'viem'
import { z } from 'zod'
import { QUOTA_RANGE, UNSAVED, WHITELIST_FULL, WRONG_GROUP, ZERO_ADDRESS } from '@/lib/art/result'
import { onchainIdShape } from './phase-schemas'
import type { ChunkEntry } from './whitelist-types'
import { QUOTA_MAX, USAGE_PAGE, WHITELIST_MAX } from './whitelist-view'

/**
 * What the Whitelist actions accept from the browser (docs/specs/2026-10-15-whitelist.md, section 6.5),
 * checked before the session and owner read (CLAUDE.md rule 4). A malformed value means the page is out of
 * date (UNSAVED) unless a sentence is named.
 */

/** A whitelist group: 1 or more, since 0 is the public sale. */
export const groupIdShape = onchainIdShape.min(1, WRONG_GROUP)

/** A quota: a whole number from 1 to 10,000. */
export const quotaShape = z
  .number({ error: QUOTA_RANGE })
  .int(QUOTA_RANGE)
  .min(1, QUOTA_RANGE)
  .max(QUOTA_MAX, QUOTA_RANGE)

/** A valid address (mixed case must pass its checksum), not the zero address, answered checksummed. */
export const addressShape: z.ZodType<Address> = z
  .string({ error: UNSAVED })
  .refine((value) => isAddress(value), UNSAVED)
  .refine((value) => value.toLowerCase() !== zeroAddress, ZERO_ADDRESS)
  .transform((value) => getAddress(value))

const entryShape = z.object({ address: addressShape, quota: quotaShape }, { error: UNSAVED })

/**
 * An add: 1 to 10,000 rows (more is a full whitelist), an address repeated in any case merged into one row
 * with its last quota, since the database keys rows by the lowercase address.
 */
export const addEntriesShape: z.ZodType<ChunkEntry[]> = z
  .array(entryShape, { error: UNSAVED })
  .min(1, UNSAVED)
  .max(WHITELIST_MAX, WHITELIST_FULL)
  .transform((rows) => {
    const merged = new Map<string, ChunkEntry>()
    for (const row of rows) merged.set(row.address.toLowerCase(), row)
    return [...merged.values()]
  })

/** A page of the table's addresses for the usage read: 1 to 25. */
export const usageShape: z.ZodType<Address[]> = z
  .array(addressShape, { error: UNSAVED })
  .min(1, UNSAVED)
  .max(USAGE_PAGE, UNSAVED)

/** A holder snapshot's chain and contract. */
export const snapshotShape: z.ZodType<{ chainId: number; contract: Address }> = z.object(
  { chainId: z.number({ error: UNSAVED }).int(UNSAVED).positive(UNSAVED), contract: addressShape },
  { error: UNSAVED },
)
```

Create `apps/web/src/lib/chain/quota-chunk.ts`:

```ts
import { collectionAbi } from '@cobweb/shared/collection-abi'
import { decodeFunctionData, type Address, type Hex } from 'viem'
import { NOT_FROM_WALLET, NOT_THIS_CHANGE, NOT_THIS_CONTRACT } from '@/lib/art/result'
import { QUOTA_MAX } from '@/lib/manage/whitelist-view'
import { matchPhaseEvent, type PhaseReceipt } from './phase-events'

/** The pairs a proven chunk wrote, addresses lowercase, or why the transaction is not that chunk. */
export type ChunkProof =
  { ok: true; pairs: { address: string; quota: number }[] } | { ok: false; error: string }

/** The arguments of a `setMintQuota` call, or null for any other input. */
function quotaArgs(input: Hex) {
  try {
    const call = decodeFunctionData({ abi: collectionAbi, data: input })
    return call.functionName === 'setMintQuota' ? call.args : null
  } catch {
    // Not a call of the collection's ABI.
    return null
  }
}

/**
 * Proves a chunk from its receipt and the transaction's input (docs/specs/2026-10-15-whitelist.md, section
 * 6.2): sent to the collection (`NOT_THIS_CONTRACT`) from the sign-in wallet (`NOT_FROM_WALLET`), as
 * `matchPhaseEvent` checks; then succeeded, decoded as `setMintQuota` for this group with quotas of at most
 * 10,000, and carrying `MintQuotasAdded(group, n)` for the decoded count (`NOT_THIS_CHANGE`). The pairs come
 * from the calldata, lowercased, a repeated address keeping its last quota as the contract does.
 */
export function proveQuotaChunk(
  receipt: PhaseReceipt,
  input: Hex,
  expected: { contract: Address; from: string; onchainId: number },
): ChunkProof {
  if (receipt.to?.toLowerCase() !== expected.contract.toLowerCase())
    return { ok: false, error: NOT_THIS_CONTRACT }
  if (receipt.from.toLowerCase() !== expected.from.toLowerCase()) return { ok: false, error: NOT_FROM_WALLET }
  if (receipt.status !== 'success') return { ok: false, error: NOT_THIS_CHANGE }
  const args = quotaArgs(input)
  if (!args) return { ok: false, error: NOT_THIS_CHANGE }
  const [addresses, group, quotas] = args
  if (group !== BigInt(expected.onchainId) || addresses.length !== quotas.length)
    return { ok: false, error: NOT_THIS_CHANGE }
  if (quotas.some((quota) => quota > BigInt(QUOTA_MAX))) return { ok: false, error: NOT_THIS_CHANGE }
  const event = matchPhaseEvent(receipt, {
    contract: expected.contract,
    from: expected.from,
    event: {
      eventName: 'MintQuotasAdded',
      args: { mintGroup: group, numberOfAddresses: BigInt(addresses.length) },
    },
  })
  if (!event.ok) return event
  const pairs = new Map<string, number>()
  addresses.forEach((address, index) => pairs.set(address.toLowerCase(), Number(quotas[index])))
  return { ok: true, pairs: [...pairs].map(([address, quota]) => ({ address, quota })) }
}
```

- [ ] **Step 5: The quota errors in words and the zero address refused**

In `apps/web/src/components/deploy/tx-errors.ts`, replace:

```ts
import type { TxFailure } from './tx-progress'

```

with:

```ts
import { WRONG_GROUP } from '@/lib/art/result'
import type { TxFailure } from './tx-progress'

```

In `apps/web/src/components/deploy/tx-errors.ts`, replace:

```ts

/**
 * The collection's custom errors in the creator's words (docs/specs/2026-10-15-phases.md, section 7.2), or
 * null for any other. Phases' owner check is OpenZeppelin's `OwnableUnauthorizedAccount`, read as `Unauthorized`.
 */
export function revertSentence(errorName: string, args: readonly unknown[]): string | null {
```

with:

```ts

/**
 * The collection's custom errors in the creator's words (docs/specs/2026-10-15-phases.md, section 7.2; the
 * quota errors from docs/specs/2026-10-15-whitelist.md, section 6.6), or null for any other. Phases' owner
 * check is OpenZeppelin's `OwnableUnauthorizedAccount`, read as `Unauthorized`.
 */
export function revertSentence(errorName: string, args: readonly unknown[]): string | null {
```

In `apps/web/src/components/deploy/tx-errors.ts`, replace:

```ts
    case 'OwnableUnauthorizedAccount':
      return `Only the contract's owner can make this change, and ${String(args[0])} is not the owner.`
    default:
      return null
```

with:

```ts
    case 'OwnableUnauthorizedAccount':
      return `Only the contract's owner can make this change, and ${String(args[0])} is not the owner.`
    case 'ArrayLengthMismatch':
      return 'The addresses and quotas do not line up. Reload and try again.'
    case 'PublicGroupHasNoQuota':
      return WRONG_GROUP
    case 'NotInWhitelist':
      return `${String(args[0])} is not on the whitelist of phase ${String(args[1])}.`
    case 'ExceedsMintQuota':
      return `This wallet can mint ${count(args[1])} more in this phase, not ${count(args[0])}.`
    default:
      return null
```

In `apps/web/src/components/manage/recipients.ts`, replace:

```ts
import { getAddress, isAddress } from 'viem'
import type { Address } from '@/lib/demo'

```

with:

```ts
import { getAddress, isAddress } from 'viem'
import { ZERO_ADDRESS } from '@/lib/art/result'
import type { Address } from '@/lib/demo'

```

In `apps/web/src/components/manage/recipients.ts`, replace:

```ts
 * Parses pasted or uploaded text, one recipient per line: `address` or `address,amount`.
 * Separators may be commas, semicolons, tabs or spaces. A first line without an address is
 * treated as a header. Addresses are validated with viem, normalised to their checksum, and
 * deduplicated; every rejected line is reported with its line number.
 */
export function parseRecipients(text: string, options: ParseOptions): ParseResult {
```

with:

```ts
 * Parses pasted or uploaded text, one recipient per line: `address` or `address,amount`.
 * Separators may be commas, semicolons, tabs or spaces. A first line without an address is
 * treated as a header. Addresses are validated with viem, the zero address refused, normalised to their
 * checksum, and deduplicated; every rejected line is reported with its line number.
 */
export function parseRecipients(text: string, options: ParseOptions): ParseResult {
```

In `apps/web/src/components/manage/recipients.ts`, replace:

```ts
        : 'Not a valid address.'
      invalid.push({ line, text: trimmed, reason })
      return
    }
```

with:

```ts
        : 'Not a valid address.'
      invalid.push({ line, text: trimmed, reason })
      return
    }
    // The zero address can neither mint nor receive a token (docs/specs/2026-10-15-whitelist.md, section 7.4).
    if (/^0x0{40}$/i.test(first)) {
      invalid.push({ line, text: trimmed, reason: ZERO_ADDRESS })
      return
    }
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `pnpm --filter @cobweb/web exec vitest run src/lib/manage/phase-calls.test.ts src/lib/manage/phase-schemas.test.ts src/lib/manage/whitelist-schemas.test.ts src/lib/chain/quota-chunk.test.ts src/components/deploy/tx-errors.test.ts src/components/manage/recipients.test.ts`
Expected: PASS, 81 tests in 6 files (phase-calls 9, phase-schemas 22, whitelist-schemas 9, quota-chunk 14, tx-errors 16, recipients 11).

- [ ] **Step 7: Format, run the root checks and commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
pnpm exec prettier --write apps/web/src/lib/manage/phase-calls.ts apps/web/src/lib/manage/phase-calls.test.ts apps/web/src/lib/manage/phase-schemas.ts apps/web/src/lib/manage/phase-schemas.test.ts apps/web/src/lib/manage/whitelist-schemas.ts apps/web/src/lib/manage/whitelist-schemas.test.ts apps/web/src/lib/chain/quota-chunk.ts apps/web/src/lib/chain/quota-chunk.test.ts apps/web/src/components/deploy/tx-errors.ts apps/web/src/components/deploy/tx-errors.test.ts apps/web/src/components/manage/recipients.ts apps/web/src/components/manage/recipients.test.ts
pnpm typecheck && pnpm lint && pnpm test
git add apps/web/src/lib/manage/phase-calls.ts apps/web/src/lib/manage/phase-calls.test.ts apps/web/src/lib/manage/phase-schemas.ts apps/web/src/lib/manage/phase-schemas.test.ts apps/web/src/lib/manage/whitelist-schemas.ts apps/web/src/lib/manage/whitelist-schemas.test.ts apps/web/src/lib/chain/quota-chunk.ts apps/web/src/lib/chain/quota-chunk.test.ts apps/web/src/components/deploy/tx-errors.ts apps/web/src/components/deploy/tx-errors.test.ts apps/web/src/components/manage/recipients.ts apps/web/src/components/manage/recipients.test.ts
git commit -m "$(cat <<'EOF'
Add setMintQuota to the manage calls with arrays and counts, the Whitelist input shapes, the chunk proof from the calldata, the quota errors in words and the zero address refused by the parser

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: the web package reports 559 tests (518 before: 41 added).

---

### Task 5: The Whitelist and snapshot cores on the server, and the nine actions

**Files:**

- Modify: `apps/web/src/lib/manage/phases-core.ts` (`PhaseBase` and `phaseBase` exported)
- Modify: `apps/web/src/lib/manage/phases-write.ts` (whole file: the error map becomes a parameter)
- Create: `apps/web/src/lib/manage/whitelist-core.ts`
- Create: `apps/web/src/lib/manage/snapshot-core.ts`
- Create: `apps/web/src/app/actions/whitelist.ts`
- Create: `apps/web/src/app/actions/snapshot.ts`
- Test: typecheck and lint here; the cores end to end in Task 7's `verify:whitelist` (no unit test reaches a database or a chain)

**Interfaces:**

- Consumes: from Task 2, the functions `whitelist_entries_add` and `whitelist_chunk_record` and their types; from Task 3, the sentences (`CHAIN_NOT_READY`, `NAME_FIRST`, `NOT_DEPLOYED`, `PHASE_REVERTED` already there; `WHITELIST_FULL`, `WHITELIST_NOT_CONFIRMED`, `WRONG_GROUP`, `NO_HOLDERS`, `NO_TOTAL_SUPPLY`, `NOT_A_CONTRACT`, `NOT_ERC721`, `SNAPSHOT_CHAIN`, `SNAPSHOT_FAILED`, `SNAPSHOT_TOO_LARGE`), `whitelistWriteError`, `chunkPlanOf`, `entriesOf`, `listOf`, `whitelistGroups`, `writtenChunksOf`, `WHITELIST_CHUNK`, `WHITELIST_MAX`, `EntryRow`, the types of `whitelist-types.ts`, `holdersOf`, `snapshotIds`, `SNAPSHOT_MAX_SUPPLY`, `HolderSnapshot`, `readEach`, `revertedRead`; from Task 4, `proveQuotaChunk`, `groupIdShape`, `quotaShape`, `addressShape`, `addEntriesShape`, `usageShape`, `snapshotShape`. Already in the repo: `phasesViewCore(ctx, read?)`, `readCollectionState: StateReader`, `PhasesContext` (`@/lib/manage/phases-core`), `StateReader = (chainId: number, address: Address, atLeast?: bigint) => Promise<ChainState | null>` (`@/lib/manage/phases-types`), `DeployOutcome<T> = { data: T } | { error: DbError } | { refused: string }` (`@/lib/deploy/deploy-core`), `readAll(page, size?)` (`@/lib/art/read-all`), `errorSummary(error)` (`@/lib/art/lock-core`), `ownedCollection(collectionId)` (`@/lib/art/owned`), `createServiceClient` (`@/lib/supabase/service`), `fail`, `THROWN`, `ActionResult` (`@/lib/art/result`), `parse` (`@/lib/art/schemas`), `txHash` (`@/lib/art/lock-schemas`), `publicClientFor(chainId)` (`@cobweb/shared/server`), `availableChains()` and `chainById(id)` (`@cobweb/shared`), `collectionAbi` (`@cobweb/shared/collection-abi`).
- Produces:
  - in `@/lib/manage/phases-core`: `PhaseBase = { chainId: number; contract: Address; publicMaxPerWallet: number; readAt: number; rows: PhaseRowCopy[] }` and `phaseBase(ctx: PhasesContext): Promise<PhaseBase | null>`, now exported
  - `phasesWrite<T>(collectionId: string, run: (ctx: PhasesContext) => Promise<DeployOutcome<T>>, writeError?: (error: DbError) => string): Promise<ActionResult<T>>` (`writeError` defaults to `phasesWriteError`)
  - in `@/lib/manage/whitelist-core` (no `server-only` marker, so `verify:whitelist` imports it): `WhitelistContext = PhasesContext`, `whitelistViewCore(ctx: WhitelistContext, read?: StateReader): Promise<DeployOutcome<WhitelistView>>`, `nextChunkCore(ctx: WhitelistContext, onchainId: number): Promise<DeployOutcome<ChunkPlan | null>>`, `confirmWhitelistChunkCore(ctx: WhitelistContext, txHash: Hex, onchainId: number, read?: StateReader): Promise<DeployOutcome<WhitelistView>>`, `addEntriesCore(ctx: WhitelistContext, onchainId: number, rows: ChunkEntry[]): Promise<DeployOutcome<{ added: number; updated: number }>>`, `setEntryQuotaCore(ctx: WhitelistContext, onchainId: number, address: Address, quota: number): Promise<DeployOutcome<undefined>>`, `setQuotaForAllCore(ctx: WhitelistContext, onchainId: number, quota: number): Promise<DeployOutcome<{ changed: number }>>`, `removeEntryCore(ctx: WhitelistContext, onchainId: number, address: Address): Promise<DeployOutcome<{ staged: boolean }>>`, `quotaUsageCore(ctx: WhitelistContext, onchainId: number, addresses: Address[]): Promise<DeployOutcome<(number | null)[]>>`
  - in `@/lib/manage/snapshot-core` (no `server-only` marker): `snapshotChains(): number[]`, `fetchHoldersCore(chainId: number, contract: Address): Promise<{ data: HolderSnapshot } | { refused: string }>`
  - in `@/app/actions/whitelist` (`'use server'`): `getWhitelist(collectionId: string): Promise<ActionResult<WhitelistView>>`, `nextChunk(collectionId: string, onchainId: number): Promise<ActionResult<ChunkPlan | null>>`, `confirmWhitelistChunk(collectionId: string, txHash: string, onchainId: number): Promise<ActionResult<WhitelistView>>`, `addEntries(collectionId: string, onchainId: number, rows: { address: string; quota: number }[]): Promise<ActionResult<{ added: number; updated: number }>>`, `setEntryQuota(collectionId: string, onchainId: number, address: string, quota: number): Promise<ActionResult>`, `setQuotaForAll(collectionId: string, onchainId: number, quota: number): Promise<ActionResult<{ changed: number }>>`, `removeEntry(collectionId: string, onchainId: number, address: string): Promise<ActionResult<{ staged: boolean }>>`, `quotaUsage(collectionId: string, onchainId: number, addresses: string[]): Promise<ActionResult<(number | null)[]>>`
  - in `@/app/actions/snapshot` (`'use server'`): `fetchHolders(collectionId: string, chainId: number, contract: string): Promise<ActionResult<HolderSnapshot>>`

- [ ] **Step 1: The deployment read, exported**

The list cores start from the same deployment read as Phases (spec section 6.2: "`phaseBase`, now exported").

In `apps/web/src/lib/manage/phases-core.ts`, replace:

```ts
  'onchain_id, name, description, visible, position, price_wei::text, max_supply, start_at'

/** What every Phases step starts from: the deployment and the rows, under the creator's client. */
type PhaseBase = {
  chainId: number
  contract: Address
```

with:

```ts
  'onchain_id, name, description, visible, position, price_wei::text, max_supply, start_at'

/** What every Phases and Whitelist step starts from: the deployment and the rows, under the creator's client. */
export type PhaseBase = {
  chainId: number
  contract: Address
```

In `apps/web/src/lib/manage/phases-core.ts`, replace:

```ts

/** The collection's deployment and its rows, or null before deploy (and for a stranger, under the row policies). */
async function phaseBase(ctx: PhasesContext): Promise<PhaseBase | null> {
  const { data, error } = await ctx.supabase
    .from('deployments')
```

with:

```ts

/** The collection's deployment and its rows, or null before deploy (and for a stranger, under the row policies). */
export async function phaseBase(ctx: PhasesContext): Promise<PhaseBase | null> {
  const { data, error } = await ctx.supabase
    .from('deployments')
```

- [ ] **Step 2: The write helper takes its error map**

Replace the whole of `apps/web/src/lib/manage/phases-write.ts` with:

```ts
import 'server-only'
import { phasesWriteError, type DbError } from '@/lib/art/db-error'
import { errorSummary } from '@/lib/art/lock-core'
import { ownedCollection } from '@/lib/art/owned'
import { fail, THROWN, type ActionResult } from '@/lib/art/result'
import type { DeployOutcome } from '@/lib/deploy/deploy-core'
import { createServiceClient } from '@/lib/supabase/service'
import type { PhasesContext } from './phases-core'

/**
 * Runs a Phases step for the signed-in owner of a collection (deployWrite's counterpart for Phases;
 * docs/specs/2026-10-15-phases.md, section 6.4). Two clients: the creator's RLS client for the session
 * check, the owner read, every read and the off-chain edits, and the service client for
 * `mint_group_record` and `mint_groups_refresh`, whose arguments come from a verified receipt or the
 * server's own chain read, called with the verified user's id as `p_owner`. The service client is built
 * on first use, after the ownership check. A refusal is returned as its sentence; a database error becomes
 * the creator's sentence (`writeError`: `phasesWriteError` for Phases, `whitelistWriteError` for the Whitelist
 * actions, docs/specs/2026-10-15-whitelist.md, section 6.5); anything thrown is logged and reads "Try again".
 */
export async function phasesWrite<T>(
  collectionId: string,
  run: (ctx: PhasesContext) => Promise<DeployOutcome<T>>,
  writeError: (error: DbError) => string = phasesWriteError,
): Promise<ActionResult<T>> {
  try {
    const owned = await ownedCollection(collectionId)
    if (owned.error !== undefined) return fail(owned.error)
    const outcome = await run({
      supabase: owned.supabase,
      service: createServiceClient,
      owner: owned.user.id,
      wallet: owned.user.walletAddress,
      collection: owned.collection,
    })
    if ('refused' in outcome) return fail(outcome.refused)
    if ('error' in outcome) return fail(writeError(outcome.error))
    return { ok: true, data: outcome.data }
  } catch (error) {
    console.error(`A phases step threw. ${errorSummary(error)}`)
    return fail(THROWN)
  }
}
```

- [ ] **Step 3: The Whitelist core**

Create `apps/web/src/lib/manage/whitelist-core.ts`:

```ts
import { collectionAbi } from '@cobweb/shared/collection-abi'
import { publicClientFor } from '@cobweb/shared/server'
import {
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem'
import { errorSummary } from '@/lib/art/lock-core'
import { readAll } from '@/lib/art/read-all'
import {
  CHAIN_NOT_READY,
  NAME_FIRST,
  NOT_DEPLOYED,
  PHASE_REVERTED,
  WHITELIST_FULL,
  WHITELIST_NOT_CONFIRMED,
  WRONG_GROUP,
} from '@/lib/art/result'
import { proveQuotaChunk } from '@/lib/chain/quota-chunk'
import { readEach } from '@/lib/chain/read-each'
import type { Json } from '@/lib/database.types'
import type { DeployOutcome } from '@/lib/deploy/deploy-core'
import {
  phaseBase,
  phasesViewCore,
  readCollectionState,
  type PhaseBase,
  type PhasesContext,
} from './phases-core'
import type { StateReader } from './phases-types'
import type { ChunkEntry, ChunkPlan, GroupList, WhitelistView } from './whitelist-types'
import {
  chunkPlanOf,
  entriesOf,
  listOf,
  whitelistGroups,
  WHITELIST_CHUNK,
  WHITELIST_MAX,
  writtenChunksOf,
  type EntryRow,
} from './whitelist-view'

/**
 * The Whitelist on the server (docs/specs/2026-10-15-whitelist.md, section 6): the view, the next chunk, the
 * confirm of a chunk from its receipt and calldata, the list edits and the usage read, on a Supabase client
 * acting as the signed-in creator. The actions (app/actions/whitelist.ts) call these after the session and
 * ownership check; verify:whitelist calls them with a signed-in script client. No `server-only` marker, so the
 * script can import it; the browser never does. The copies of what the chain holds are written only by
 * `whitelist_chunk_record`, from pairs a proven transaction carried, never from browser values.
 */
export type WhitelistContext = PhasesContext

/** The entry columns the view reads. */
const ENTRY_COLUMNS = 'wallet_address, quota, written_quota, written_tx, written_at'

/** Rows per `whitelist_entries_add` call, as many as PostgREST returns in one page. */
const ADD_PAGE = 1_000

/** The row id of each of the collection's groups, by on-chain id, under the creator's client. */
async function groupRowIds(ctx: WhitelistContext): Promise<Map<number, string>> {
  const { data, error } = await ctx.supabase
    .from('mint_groups')
    .select('id, onchain_id')
    .eq('collection_id', ctx.collection.id)
  if (error) throw new Error(`The phases could not be read: ${error.message}`)
  return new Map(data.map((row) => [row.onchain_id, row.id]))
}

/** Every entry of a group, a page of 1,000 at a time in address order. */
function entryRows(ctx: WhitelistContext, groupId: string): Promise<EntryRow[]> {
  return readAll((from, to) =>
    ctx.supabase
      .from('whitelist_entries')
      .select(ENTRY_COLUMNS)
      .eq('mint_group_id', groupId)
      .order('wallet_address')
      .range(from, to),
  )
}

/**
 * A list edit's starting point: the deployment (NOT_DEPLOYED before deploy, and for a stranger under the row
 * policies) and the group's row (NAME_FIRST for a group the chain lists without one). The public sale has no
 * whitelist.
 */
async function groupFor(
  ctx: WhitelistContext,
  onchainId: number,
): Promise<{ base: PhaseBase; id: string } | { refused: string }> {
  if (onchainId === 0) return { refused: WRONG_GROUP }
  const base = await phaseBase(ctx)
  if (!base) return { refused: NOT_DEPLOYED }
  const id = (await groupRowIds(ctx)).get(onchainId)
  return id ? { base, id } : { refused: NAME_FIRST }
}

/**
 * What the Whitelist tab shows (section 6.2): the phases view (its refusal, its refresh of the copies, its copy
 * when the chain does not answer), its whitelist groups, and the entries of each group Cobweb has a row for.
 * Quota used is the group's minted count from the chain, 0 when the chain did not answer.
 */
export async function whitelistViewCore(
  ctx: WhitelistContext,
  read: StateReader = readCollectionState,
): Promise<DeployOutcome<WhitelistView>> {
  const phases = await phasesViewCore(ctx, read)
  if (!('data' in phases)) return phases
  const view = phases.data
  const groups = whitelistGroups(view)
  const ids = await groupRowIds(ctx)
  const lists: GroupList[] = []
  for (const group of groups) {
    const id = ids.get(group.id)
    if (!id) continue
    const rows = await entryRows(ctx, id)
    lists.push(
      listOf(group.id, entriesOf(rows), view.chainReachable ? group.minted : 0, writtenChunksOf(rows)),
    )
  }
  return {
    data: {
      chainId: view.chainId,
      contract: view.contract,
      groups,
      lists,
      chunkSize: WHITELIST_CHUNK,
      blockTimestamp: view.blockTimestamp,
      readAt: view.readAt,
      chainReachable: view.chainReachable,
    },
  }
}

/** The next chunk of a group, built from what the database holds now; null when every entry is written. */
export async function nextChunkCore(
  ctx: WhitelistContext,
  onchainId: number,
): Promise<DeployOutcome<ChunkPlan | null>> {
  const group = await groupFor(ctx, onchainId)
  if ('refused' in group) return group
  const rows = await entryRows(ctx, group.id)
  return { data: chunkPlanOf(listOf(onchainId, entriesOf(rows), 0, writtenChunksOf(rows))) }
}

/**
 * Confirms a chunk (section 6.2): the receipt (not found yet is WHITELIST_NOT_CONFIRMED, which the machine
 * polls; reverted is PHASE_REVERTED), the transaction's input (not found yet, the same), the proof from the
 * calldata, then the copies through `whitelist_chunk_record` and the view read at the receipt's block or later.
 * The browser sends only the hash and the group. A second confirm of the same hash answers the view again.
 */
export async function confirmWhitelistChunkCore(
  ctx: WhitelistContext,
  txHash: Hex,
  onchainId: number,
  read: StateReader = readCollectionState,
): Promise<DeployOutcome<WhitelistView>> {
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
    return { refused: WHITELIST_NOT_CONFIRMED }
  }
  // sic: viem types the receipt as always present; a node can still answer with nothing.
  if (!receipt) return { refused: WHITELIST_NOT_CONFIRMED }
  if (receipt.status === 'reverted') return { refused: PHASE_REVERTED }
  let input: Hex
  try {
    input = (await client.getTransaction({ hash })).input
  } catch (error) {
    if (!(error instanceof TransactionNotFoundError))
      console.error(`The transaction could not be read: ${errorSummary(error)}`)
    return { refused: WHITELIST_NOT_CONFIRMED }
  }
  const proof = proveQuotaChunk(receipt, input, { contract: base.contract, from: ctx.wallet, onchainId })
  if (!proof.ok) return { refused: proof.error }
  const recorded = await ctx.service().rpc('whitelist_chunk_record', {
    p_collection_id: ctx.collection.id,
    p_owner: ctx.owner,
    p_onchain_id: onchainId,
    p_tx: hash,
    p_rows: proof.pairs as unknown as Json,
  })
  if (recorded.error) return { error: recorded.error }
  const block = receipt.blockNumber
  return whitelistViewCore(ctx, (chainId, address) => read(chainId, address, block))
}

/**
 * Adds rows and changes listed quotas (section 6.3), under the creator's client: WHITELIST_FULL when the new
 * addresses would pass 10,000 (nothing written), then pages of 1,000 to `whitelist_entries_add` in turn, the
 * answers summed. A page refused after others landed answers its sentence; the screen reads the view again.
 */
export async function addEntriesCore(
  ctx: WhitelistContext,
  onchainId: number,
  rows: ChunkEntry[],
): Promise<DeployOutcome<{ added: number; updated: number }>> {
  const group = await groupFor(ctx, onchainId)
  if ('refused' in group) return group
  const listed = await readAll<{ wallet_address: string }>((from, to) =>
    ctx.supabase
      .from('whitelist_entries')
      .select('wallet_address')
      .eq('mint_group_id', group.id)
      .order('wallet_address')
      .range(from, to),
  )
  const known = new Set(listed.map((row) => row.wallet_address))
  const fresh = rows.filter((row) => !known.has(row.address.toLowerCase())).length
  if (known.size + fresh > WHITELIST_MAX) return { refused: WHITELIST_FULL }
  let added = 0
  let updated = 0
  for (let from = 0; from < rows.length; from += ADD_PAGE) {
    const page = rows
      .slice(from, from + ADD_PAGE)
      .map((row) => ({ address: row.address.toLowerCase(), quota: row.quota }))
    const { data, error } = await ctx.supabase.rpc('whitelist_entries_add', {
      p_collection_id: ctx.collection.id,
      p_onchain_id: onchainId,
      p_rows: page as unknown as Json,
    })
    if (error) return { error }
    added += data[0]?.added ?? 0
    updated += data[0]?.updated ?? 0
  }
  return { data: { added, updated } }
}

/** One address's quota, through `whitelist_entries_add`, so it also puts back a row a removal deleted (Undo). */
export async function setEntryQuotaCore(
  ctx: WhitelistContext,
  onchainId: number,
  address: Address,
  quota: number,
): Promise<DeployOutcome<undefined>> {
  const group = await groupFor(ctx, onchainId)
  if ('refused' in group) return group
  const { error } = await ctx.supabase.rpc('whitelist_entries_add', {
    p_collection_id: ctx.collection.id,
    p_onchain_id: onchainId,
    p_rows: [{ address: address.toLowerCase(), quota }] as unknown as Json,
  })
  return error ? { error } : { data: undefined }
}

/** Set quota for all: every row above 0 whose quota differs, counted; staged removals stay at 0. */
export async function setQuotaForAllCore(
  ctx: WhitelistContext,
  onchainId: number,
  quota: number,
): Promise<DeployOutcome<{ changed: number }>> {
  const group = await groupFor(ctx, onchainId)
  if ('refused' in group) return group
  const { count, error } = await ctx.supabase
    .from('whitelist_entries')
    .update({ quota }, { count: 'exact' })
    .eq('mint_group_id', group.id)
    .gt('quota', 0)
    .neq('quota', quota)
  return error ? { error } : { data: { changed: count ?? 0 } }
}

/**
 * Remove: a row the chain was never proven to hold (or holds at 0) is deleted (`staged: false`); a written one
 * keeps its row at quota 0 until a chunk writes the zero (`staged: true`). The delete is filtered on the copy,
 * so a chunk confirmed in between turns it into a staged removal.
 */
export async function removeEntryCore(
  ctx: WhitelistContext,
  onchainId: number,
  address: Address,
): Promise<DeployOutcome<{ staged: boolean }>> {
  const group = await groupFor(ctx, onchainId)
  if ('refused' in group) return group
  const wallet = address.toLowerCase()
  const removed = await ctx.supabase
    .from('whitelist_entries')
    .delete({ count: 'exact' })
    .eq('mint_group_id', group.id)
    .eq('wallet_address', wallet)
    .or('written_quota.is.null,written_quota.eq.0')
  if (removed.error) return { error: removed.error }
  if (removed.count) return { data: { staged: false } }
  const staged = await ctx.supabase
    .from('whitelist_entries')
    .update({ quota: 0 }, { count: 'exact' })
    .eq('mint_group_id', group.id)
    .eq('wallet_address', wallet)
  if (staged.error) return { error: staged.error }
  return { data: { staged: (staged.count ?? 0) > 0 } }
}

/**
 * Quota used per address (section 6.3): `quotaClaimed(group, address)` for a page of the table through
 * `readEach`, all null when the chain does not answer.
 */
export async function quotaUsageCore(
  ctx: WhitelistContext,
  onchainId: number,
  addresses: Address[],
): Promise<DeployOutcome<(number | null)[]>> {
  const base = await phaseBase(ctx)
  if (!base) return { refused: NOT_DEPLOYED }
  try {
    const claimed = await readEach<bigint>(
      publicClientFor(base.chainId),
      addresses.map((address) => ({
        address: base.contract,
        abi: collectionAbi,
        functionName: 'quotaClaimed',
        args: [BigInt(onchainId), address],
      })),
    )
    return { data: claimed.map((value) => (value === null ? null : Number(value))) }
  } catch (error) {
    console.error(`The quota used could not be read on chain ${base.chainId}: ${errorSummary(error)}`)
    return { data: addresses.map(() => null) }
  }
}
```

- [ ] **Step 4: The snapshot core**

Create `apps/web/src/lib/manage/snapshot-core.ts`:

```ts
import { availableChains, chainById } from '@cobweb/shared'
import { publicClientFor } from '@cobweb/shared/server'
import { erc721Abi, parseAbi, type Address, type PublicClient } from 'viem'
import { errorSummary } from '@/lib/art/lock-core'
import {
  NO_HOLDERS,
  NO_TOTAL_SUPPLY,
  NOT_A_CONTRACT,
  NOT_ERC721,
  SNAPSHOT_CHAIN,
  SNAPSHOT_FAILED,
  SNAPSHOT_TOO_LARGE,
} from '@/lib/art/result'
import { readEach, revertedRead } from '@/lib/chain/read-each'
import { holdersOf, SNAPSHOT_MAX_SUPPLY, snapshotIds, type HolderSnapshot } from './holders'

/**
 * The holder snapshot on the server (docs/specs/2026-10-15-whitelist.md, section 6.4): another collection's
 * holders read at one block over the server's RPC for the chain, for Whitelist and Airdrop alike. No indexer:
 * `totalSupply()`, then `ownerOf` for every id. No `server-only` marker, so verify:whitelist can import it; the
 * browser never does (the RPC URLs are secrets).
 */

/** viem's `erc721Abi` has no `supportsInterface`, so ERC-165 has its own one-function ABI. */
const erc165Abi = parseAbi(['function supportsInterface(bytes4 interfaceId) view returns (bool)'])
/** ERC-721's interface id. */
const ERC721_INTERFACE = '0x80ac58cd'

/** The chains a snapshot can read: the available chains whose `RPC_URL_<id>` is set. */
export function snapshotChains(): number[] {
  return availableChains()
    .filter((chain) => Boolean(process.env[chain.rpcEnv]))
    .map((chain) => chain.id)
}

/** Whether the contract says it is an ERC-721; a contract without ERC-165 reverts, which reads as no. */
async function isErc721(client: PublicClient, contract: Address, blockNumber: bigint): Promise<boolean> {
  try {
    return await client.readContract({
      address: contract,
      abi: erc165Abi,
      functionName: 'supportsInterface',
      args: [ERC721_INTERFACE],
      blockNumber,
    })
  } catch (error) {
    if (revertedRead(error)) return false
    throw error
  }
}

/** `totalSupply()`, or null when the contract does not answer it. */
async function totalSupplyOf(
  client: PublicClient,
  contract: Address,
  blockNumber: bigint,
): Promise<bigint | null> {
  try {
    return await client.readContract({
      address: contract,
      abi: erc721Abi,
      functionName: 'totalSupply',
      blockNumber,
    })
  } catch (error) {
    if (revertedRead(error)) return null
    throw error
  }
}

/**
 * The holders of an ERC-721 contract at the latest block: SNAPSHOT_CHAIN for a chain Cobweb cannot read,
 * NOT_A_CONTRACT for an address without code, NOT_ERC721 when ERC-165 says no or is missing, NO_TOTAL_SUPPLY,
 * SNAPSHOT_TOO_LARGE above 20,000 tokens, NO_HOLDERS when no owner is left. A read that throws is logged and
 * answers SNAPSHOT_FAILED.
 */
export async function fetchHoldersCore(
  chainId: number,
  contract: Address,
): Promise<{ data: HolderSnapshot } | { refused: string }> {
  const chain = chainById(chainId)
  if (!chain || !snapshotChains().includes(chainId)) return { refused: SNAPSHOT_CHAIN }
  try {
    const client = publicClientFor(chainId)
    // cacheTime 0: one pinned block, read now, so every read below agrees.
    const blockNumber = await client.getBlockNumber({ cacheTime: 0 })
    const code = await client.getCode({ address: contract, blockNumber })
    if (!code || code === '0x') return { refused: NOT_A_CONTRACT(chain.name) }
    if (!(await isErc721(client, contract, blockNumber))) return { refused: NOT_ERC721(chain.name) }
    const supply = await totalSupplyOf(client, contract, blockNumber)
    if (supply === null) return { refused: NO_TOTAL_SUPPLY }
    if (supply > BigInt(SNAPSHOT_MAX_SUPPLY)) return { refused: SNAPSHOT_TOO_LARGE }
    const owners = await readEach<Address>(
      client,
      snapshotIds(supply).map((id) => ({
        address: contract,
        abi: erc721Abi,
        functionName: 'ownerOf',
        args: [id],
      })),
      { blockNumber },
    )
    const holders = holdersOf(owners)
    if (holders.length === 0) return { refused: NO_HOLDERS }
    return { data: { holders, block: Number(blockNumber), supply: Number(supply) } }
  } catch (error) {
    console.error(`The holders of ${contract} could not be read on chain ${chainId}: ${errorSummary(error)}`)
    return { refused: SNAPSHOT_FAILED }
  }
}
```

- [ ] **Step 5: The actions**

Create `apps/web/src/app/actions/whitelist.ts`:

```ts
'use server'

import { cache } from 'react'
import { whitelistWriteError } from '@/lib/art/db-error'
import { txHash as txHashSchema } from '@/lib/art/lock-schemas'
import type { ActionResult } from '@/lib/art/result'
import { parse } from '@/lib/art/schemas'
import { readCollectionState } from '@/lib/manage/phases-core'
import { phasesWrite } from '@/lib/manage/phases-write'
import {
  addEntriesCore,
  confirmWhitelistChunkCore,
  nextChunkCore,
  quotaUsageCore,
  removeEntryCore,
  setEntryQuotaCore,
  setQuotaForAllCore,
  whitelistViewCore,
} from '@/lib/manage/whitelist-core'
import {
  addEntriesShape,
  addressShape,
  groupIdShape,
  quotaShape,
  usageShape,
} from '@/lib/manage/whitelist-schemas'
import type { ChunkPlan, WhitelistView } from '@/lib/manage/whitelist-types'

/**
 * The Whitelist's server actions (docs/specs/2026-10-15-whitelist.md, section 6.5). Each checks its input first,
 * then runs through `phasesWrite`, which checks the session and the ownership (CLAUDE.md rule 4), with the
 * whitelist's sentences for a database refusal. The browser never writes what the chain holds: a confirm proves
 * the chunk from its receipt and calldata and answers the view the server read.
 */

/** One chain read per request, however many times a page asks (React's cache). */
const readOnce = cache(readCollectionState)

/** The whitelist groups and their lists, read on the server. */
export async function getWhitelist(collectionId: string): Promise<ActionResult<WhitelistView>> {
  return phasesWrite(collectionId, (ctx) => whitelistViewCore(ctx, readOnce), whitelistWriteError)
}

/** The next chunk of a group, built from what the database holds now; null when every address is written. */
export async function nextChunk(
  collectionId: string,
  onchainId: number,
): Promise<ActionResult<ChunkPlan | null>> {
  const id = parse(groupIdShape, onchainId)
  if (!id.ok) return id
  return phasesWrite(collectionId, (ctx) => nextChunkCore(ctx, id.data), whitelistWriteError)
}

/** Confirms a chunk from its receipt and calldata, records what it wrote, then answers the fresh view. */
export async function confirmWhitelistChunk(
  collectionId: string,
  txHash: string,
  onchainId: number,
): Promise<ActionResult<WhitelistView>> {
  const hash = parse(txHashSchema, txHash)
  if (!hash.ok) return hash
  const id = parse(groupIdShape, onchainId)
  if (!id.ok) return id
  return phasesWrite(
    collectionId,
    (ctx) => confirmWhitelistChunkCore(ctx, hash.data, id.data),
    whitelistWriteError,
  )
}

/** Adds addresses and changes listed quotas; the next chunks write them. */
export async function addEntries(
  collectionId: string,
  onchainId: number,
  rows: { address: string; quota: number }[],
): Promise<ActionResult<{ added: number; updated: number }>> {
  const id = parse(groupIdShape, onchainId)
  if (!id.ok) return id
  const input = parse(addEntriesShape, rows)
  if (!input.ok) return input
  return phasesWrite(collectionId, (ctx) => addEntriesCore(ctx, id.data, input.data), whitelistWriteError)
}

/** One address's quota, or an address put back after a removal (Undo). */
export async function setEntryQuota(
  collectionId: string,
  onchainId: number,
  address: string,
  quota: number,
): Promise<ActionResult> {
  const id = parse(groupIdShape, onchainId)
  if (!id.ok) return id
  const wallet = parse(addressShape, address)
  if (!wallet.ok) return wallet
  const value = parse(quotaShape, quota)
  if (!value.ok) return value
  return phasesWrite(
    collectionId,
    (ctx) => setEntryQuotaCore(ctx, id.data, wallet.data, value.data),
    whitelistWriteError,
  )
}

/** Set quota for all: every listed address above 0 gets the quota. */
export async function setQuotaForAll(
  collectionId: string,
  onchainId: number,
  quota: number,
): Promise<ActionResult<{ changed: number }>> {
  const id = parse(groupIdShape, onchainId)
  if (!id.ok) return id
  const value = parse(quotaShape, quota)
  if (!value.ok) return value
  return phasesWrite(collectionId, (ctx) => setQuotaForAllCore(ctx, id.data, value.data), whitelistWriteError)
}

/** Removes an address: at once when the chain never held it, else staged as a zero for the next chunk. */
export async function removeEntry(
  collectionId: string,
  onchainId: number,
  address: string,
): Promise<ActionResult<{ staged: boolean }>> {
  const id = parse(groupIdShape, onchainId)
  if (!id.ok) return id
  const wallet = parse(addressShape, address)
  if (!wallet.ok) return wallet
  return phasesWrite(collectionId, (ctx) => removeEntryCore(ctx, id.data, wallet.data), whitelistWriteError)
}

/** Quota used per address for a page of the table, from the chain; null where it did not answer. */
export async function quotaUsage(
  collectionId: string,
  onchainId: number,
  addresses: string[],
): Promise<ActionResult<(number | null)[]>> {
  const id = parse(groupIdShape, onchainId)
  if (!id.ok) return id
  const page = parse(usageShape, addresses)
  if (!page.ok) return page
  return phasesWrite(collectionId, (ctx) => quotaUsageCore(ctx, id.data, page.data), whitelistWriteError)
}
```

Create `apps/web/src/app/actions/snapshot.ts`:

```ts
'use server'

import { errorSummary } from '@/lib/art/lock-core'
import { ownedCollection } from '@/lib/art/owned'
import { fail, SNAPSHOT_FAILED, type ActionResult } from '@/lib/art/result'
import { parse } from '@/lib/art/schemas'
import type { HolderSnapshot } from '@/lib/manage/holders'
import { fetchHoldersCore } from '@/lib/manage/snapshot-core'
import { snapshotShape } from '@/lib/manage/whitelist-schemas'

/**
 * The holder snapshot behind the shared recipients input of Whitelist and Airdrop
 * (docs/specs/2026-10-15-whitelist.md, section 6.4): the input is checked first, then the session and the
 * ownership of the collection the creator is editing (CLAUDE.md rule 4), then the chain is read on the server.
 * The pages that offer it export `maxDuration = 300`.
 */
export async function fetchHolders(
  collectionId: string,
  chainId: number,
  contract: string,
): Promise<ActionResult<HolderSnapshot>> {
  const input = parse(snapshotShape, { chainId, contract })
  if (!input.ok) return input
  try {
    const owned = await ownedCollection(collectionId)
    if (owned.error !== undefined) return fail(owned.error)
    const outcome = await fetchHoldersCore(input.data.chainId, input.data.contract)
    return 'refused' in outcome ? fail(outcome.refused) : { ok: true, data: outcome.data }
  } catch (error) {
    console.error(`A snapshot threw. ${errorSummary(error)}`)
    return fail(SNAPSHOT_FAILED)
  }
}
```

- [ ] **Step 6: Typecheck and lint**

Run: `pnpm --filter @cobweb/web typecheck && pnpm --filter @cobweb/web lint`
Expected: no output from `tsc`, no problem from ESLint. (`data[0]?.added` reads the table function's one row: supabase-js types it as an array, `Returns: { added: number; updated: number }[]`.)

- [ ] **Step 7: Format, run the root checks and commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
pnpm exec prettier --write apps/web/src/lib/manage/phases-core.ts apps/web/src/lib/manage/phases-write.ts apps/web/src/lib/manage/whitelist-core.ts apps/web/src/lib/manage/snapshot-core.ts apps/web/src/app/actions/whitelist.ts apps/web/src/app/actions/snapshot.ts
pnpm typecheck && pnpm lint && pnpm test
git add apps/web/src/lib/manage/phases-core.ts apps/web/src/lib/manage/phases-write.ts apps/web/src/lib/manage/whitelist-core.ts apps/web/src/lib/manage/snapshot-core.ts apps/web/src/app/actions/whitelist.ts apps/web/src/app/actions/snapshot.ts
git commit -m "$(cat <<'EOF'
Add the Whitelist cores (the view, the next chunk, the confirm from the receipt and calldata, the list edits, the usage read), the holder snapshot core and their actions

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: test counts unchanged (web 559).

---

### Task 6: The machine's chunk polling and sent-chunk store, the bound server and sample mode

**Files:**

- Modify: `apps/web/src/components/manage/manage-machine.ts` (imports, the `remember` comment, `verifyManage`, the sent-chunk store appended), `apps/web/src/components/manage/manage-machine.test.ts` (imports; two `describe` blocks appended)
- Modify: `apps/web/src/components/manage/manage-actions.ts` (the `pending` comment)
- Create: `apps/web/src/components/manage/whitelist-server.ts`
- Create: `apps/web/src/components/manage/whitelist-sim.ts`, `apps/web/src/components/manage/whitelist-sim.test.ts`
- Modify: `apps/web/src/components/manage/manage-sim.ts` (one import, `SAMPLE.whitelists` removed, `setMintQuota` in `sampleRevert` and `sampleApply`), `apps/web/src/components/manage/manage-sim.test.ts` (one import; a `describe` appended)
- Test: `manage-machine.test.ts`, `manage-sim.test.ts`, `whitelist-sim.test.ts`

**Interfaces:**

- Consumes: from Task 3, `WHITELIST_NOT_CONFIRMED`, `WHITELIST_TIMED_OUT` (`@/lib/art/result`), `SentChunk`, `GroupList`, `ListEntry`, `WhitelistView`, `WrittenChunk`, `ChunkEntry`, `ChunkPlan` (`@/lib/manage/whitelist-types`), `byAddress`, `chunkPlanOf`, `listOf`, `whitelistGroups`, `WHITELIST_CHUNK` (`@/lib/manage/whitelist-view`); from Task 4, `phaseCalls.quotas(id, addresses, quotas)` and `ManageCall` (`@/lib/manage/phase-calls`); from Task 5, the eight actions in `@/app/actions/whitelist`. Already in the repo: `KeyStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>`, `CONFIRM_INTERVAL_MS` (3,000), `CONFIRM_TIMEOUT_MS` (120,000), `retryHash(phase)`, `deployReducer` (`@/components/deploy/deploy-machine`); `runManage`, `ManageDeps`, `ManageInput` (`./manage-machine`); `samplePhasesView(collection, chainReachable?)`, `sampleApply`, `sampleRevert`, `sampleManageActions` (`./manage-sim`); `DEMO_COLLECTION`, `DEMO_MINTER`, `DEMO_NOW`, `DEMO_WHITELISTS` (the Owl List, group 1, 620 entries with its first chunk of 500 written; Team, group 2, 12 entries written), `sampleTxHash(seed)`, `GroupWhitelist` (`@/lib/demo`); `ActionResult` (`@/lib/art/result`).
- Produces:
  - in `./manage-machine`: `verifyManage` polls while the server answers `PHASE_NOT_CONFIRMED` or `WHITELIST_NOT_CONFIRMED`, and times out with `PHASE_TIMED_OUT` or `WHITELIST_TIMED_OUT` after the one it last saw; `rememberChunk(store: KeyStore | null, collectionId: string, sent: SentChunk): void`, `sentChunk(store: KeyStore | null, collectionId: string): SentChunk | null`, `forgetChunk(store: KeyStore | null, collectionId: string): void` (key `cobweb-whitelist:<collectionId>`)
  - in `./whitelist-server`: `WhitelistServer = { read(); nextChunk(onchainId); confirmChunk(hash: Hex, onchainId); addEntries(onchainId, rows: ChunkEntry[]); setEntryQuota(onchainId, address: Address, quota); setQuotaForAll(onchainId, quota); removeEntry(onchainId, address: Address); quotaUsage(onchainId, addresses: Address[]) }` (each answers the matching action's `ActionResult`), `whitelistServer(collectionId: string): WhitelistServer`
  - in `./whitelist-sim`: `sampleWhitelistView(collection: { max_supply: number | null }, chainReachable?: boolean): WhitelistView`, `sampleApplyQuotas(call: ManageCall, view: WhitelistView, hash: Hex): WhitelistView`, `sampleWhitelistServer(current: () => WhitelistView, sent?: Map<Hex, ManageCall>): WhitelistServer`, `sampleSentChunk(view: WhitelistView): SentChunk | null`
  - in `./manage-sim`: `sampleRevert` refuses a `setMintQuota` with unequal lengths (`ArrayLengthMismatch`), on the public sale (`PublicGroupHasNoQuota`) and on an unknown group (`MintGroupDoesNotExist`); `sampleApply` lists `setMintQuota` and changes no group; `SAMPLE` no longer has `whitelists`

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/components/manage/manage-machine.test.ts`, import the chunk's sentences, its type and its store, and append the chunk's tests:

In `apps/web/src/components/manage/manage-machine.test.ts`, replace:

```ts
  THROWN,
  UNSAVED,
  type ActionResult,
} from '@/lib/art/result'
import { phaseCalls, type ManageCall } from '@/lib/manage/phase-calls'
import {
  forgetAdd,
  pendingAdd,
  rememberAdd,
  runManage,
  type ManageDeps,
  type ManageInput,
```

with:

```ts
  THROWN,
  UNSAVED,
  WHITELIST_NOT_CONFIRMED,
  WHITELIST_TIMED_OUT,
  type ActionResult,
} from '@/lib/art/result'
import { phaseCalls, type ManageCall } from '@/lib/manage/phase-calls'
import type { SentChunk } from '@/lib/manage/whitelist-types'
import {
  forgetAdd,
  forgetChunk,
  pendingAdd,
  rememberAdd,
  rememberChunk,
  runManage,
  sentChunk,
  type ManageDeps,
  type ManageInput,
```

In `apps/web/src/components/manage/manage-machine.test.ts`, replace:

```ts
    expect(() => forgetAdd(null, 'col-1')).not.toThrow()
  })
})

```

with:

```ts
    expect(() => forgetAdd(null, 'col-1')).not.toThrow()
  })
})

describe('a whitelist chunk (docs/specs/2026-10-15-whitelist.md, section 7.1)', () => {
  const CHUNK_NOT_YET: ActionResult<string> = { ok: false, error: WHITELIST_NOT_CONFIRMED }
  const chunk: ManageInput = { ...input, call: phaseCalls.quotas(1, [WALLET], [2]) }

  it('polls every 3 seconds while the chunk is not confirmed yet, then answers the view and forgets the hash', async () => {
    const { deps, calls } = fakeDeps([CHUNK_NOT_YET, CHUNK_NOT_YET, { ok: true, data: VIEW }])
    const { result } = await run(deps, chunk)
    expect(calls.confirm).toBe(3)
    expect(calls.sleeps).toEqual([3_000, 3_000])
    expect(calls.remember).toEqual([HASH])
    expect(calls.forget).toBe(1)
    expect(result).toBe(VIEW)
  })

  it('stops after 2 minutes with the chunk sentence and keeps the hash to check again', async () => {
    const { deps, calls } = fakeDeps(Array<ActionResult<string>>(50).fill(CHUNK_NOT_YET))
    const { last, phase } = await run(deps, chunk)
    expect(calls.confirm).toBe(41)
    expect(last).toEqual({
      type: 'failed',
      failure: { kind: 'unconfirmed', title: 'Change not confirmed yet', message: WHITELIST_TIMED_OUT },
    })
    expect(calls.forget).toBe(0)
    expect(retryHash(phase)).toBe(HASH)
  })
})

describe('the sent chunk kept in the browser', () => {
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
  const sent: SentChunk = { hash: HASH, onchainId: 2 }

  it('remembers the hash and the group per collection, apart from a pending add, until they are forgotten', () => {
    const store = memory()
    rememberChunk(store, 'col-1', sent)
    expect(sentChunk(store, 'col-1')).toEqual(sent)
    expect(sentChunk(store, 'col-2')).toBeNull()
    expect(store.getItem('cobweb-whitelist:col-1')).toContain(HASH)
    expect(pendingAdd(store, 'col-1')).toBeNull()
    forgetChunk(store, 'col-1')
    expect(sentChunk(store, 'col-1')).toBeNull()
  })

  it('reads as none a value without a 32-byte hash and a group of 1 or more, and a store that throws', () => {
    const store = memory()
    for (const value of [
      'nonsense',
      'null',
      JSON.stringify({ hash: 'not-a-hash', onchainId: 2 }),
      JSON.stringify({ hash: `0x${'ab'.repeat(31)}`, onchainId: 2 }),
      JSON.stringify({ hash: HASH }),
      JSON.stringify({ hash: HASH, onchainId: 0 }),
      JSON.stringify({ hash: HASH, onchainId: 1.5 }),
      JSON.stringify({ hash: HASH, onchainId: '2' }),
    ]) {
      store.setItem('cobweb-whitelist:col-1', value)
      expect(sentChunk(store, 'col-1')).toBeNull()
    }
    expect(() => rememberChunk(failing, 'col-1', sent)).not.toThrow()
    expect(sentChunk(failing, 'col-1')).toBeNull()
    expect(sentChunk(null, 'col-1')).toBeNull()
    expect(() => forgetChunk(null, 'col-1')).not.toThrow()
  })
})

```

In `apps/web/src/components/manage/manage-sim.test.ts`, import the `Address` type and append the quota call's sample tests:

In `apps/web/src/components/manage/manage-sim.test.ts`, replace:

```ts
import type { Hex } from 'viem'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { classifyError } from '@/components/deploy/tx-errors'
```

with:

```ts
import type { Address, Hex } from 'viem'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { classifyError } from '@/components/deploy/tx-errors'
```

In `apps/web/src/components/manage/manage-sim.test.ts`, replace:

```ts
    expect(await request.confirm(hash)).toEqual({ ok: true, data: hash })
  })
})

```

with:

```ts
    expect(await request.confirm(hash)).toEqual({ ok: true, data: hash })
  })
})

describe('the quota call on the sample (docs/specs/2026-10-15-whitelist.md, section 8)', () => {
  const A: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
  const sentence = (call: ManageCall) => {
    const refused = sampleRevert(call, view)
    return refused ? classifyError(refused, 'simulating', 'manage').message : null
  }

  it('refuses unequal lengths, the public sale and an unknown group as the contract would', () => {
    expect(sentence({ functionName: 'setMintQuota', args: [[A], 1n, [1n, 2n]] })).toBe(
      'The addresses and quotas do not line up. Reload and try again. Nothing was sent.',
    )
    expect(sentence(phaseCalls.quotas(0, [A], [1]))).toBe(
      'The public sale has no whitelist. Nothing was sent.',
    )
    expect(sentence(phaseCalls.quotas(9, [A], [1]))).toBe(
      'Phase 9 is not on the contract. Read the contract again. Nothing was sent.',
    )
    expect(sampleRevert(phaseCalls.quotas(1, [A], [1]), view)).toBeNull()
  })

  it('changes no group of the phases view', () => {
    expect(sampleApply(phaseCalls.quotas(1, [A], [1]), view)).toEqual(view)
  })
})

```

Create `apps/web/src/components/manage/whitelist-sim.test.ts`:

```ts
import { getAddress, type Address, type Hex } from 'viem'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEMO_COLLECTION, DEMO_MINTER, sampleTxHash } from '@/lib/demo'
import { phaseCalls, type ManageCall } from '@/lib/manage/phase-calls'
import type { GroupList, ListEntry, WhitelistView } from '@/lib/manage/whitelist-types'
import { chunkPlanOf, listOf } from '@/lib/manage/whitelist-view'
import {
  sampleApplyQuotas,
  sampleSentChunk,
  sampleWhitelistServer,
  sampleWhitelistView,
} from './whitelist-sim'

const view: WhitelistView = sampleWhitelistView({ max_supply: DEMO_COLLECTION.maxSupply })
const HASH: Hex = `0x${'cd'.repeat(32)}`
const NEW: Address = '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65'
const UNLISTED: Address = '0x90F79bf6EB2c4f870365E785982E1f101E93b906'

const listIn = (current: WhitelistView, onchainId: number): GroupList => {
  const list = current.lists.find((candidate) => candidate.onchainId === onchainId)
  if (!list) throw new Error(`no list ${onchainId}`)
  return list
}
/** The view with one list's entries replaced, counted again. */
const withEntries = (current: WhitelistView, onchainId: number, entries: ListEntry[]): WhitelistView => ({
  ...current,
  lists: current.lists.map((list) =>
    list.onchainId === onchainId ? listOf(onchainId, entries, list.quotaUsed, list.chunks) : list,
  ),
})
/** The call that writes a plan, as the dialog builds it. */
const callFor = (current: WhitelistView, onchainId: number): ManageCall => {
  const plan = chunkPlanOf(listIn(current, onchainId))
  if (!plan) throw new Error('nothing to write')
  return phaseCalls.quotas(
    onchainId,
    plan.entries.map((entry) => entry.address),
    plan.entries.map((entry) => entry.quota),
  )
}

describe('sampleWhitelistView', () => {
  it('shows the Owl List with 500 addresses written and 120 waiting and Team written, checksummed, in address order', () => {
    expect(view.groups.map((group) => group.name)).toEqual(['Owl List', 'Team'])
    const owl = listIn(view, 1)
    expect(owl).toMatchObject({ total: 620, written: 500, unwritten: 120, quotaUsed: 186 })
    expect(owl.chunks.map((chunk) => chunk.addresses)).toEqual([500])
    expect(listIn(view, 2)).toMatchObject({ total: 12, written: 12, unwritten: 0, quotaUsed: 40 })
    const lowercase = owl.entries.map((entry) => entry.address.toLowerCase())
    expect(lowercase).toEqual([...lowercase].sort())
    expect(owl.entries.every((entry) => entry.address === getAddress(entry.address))).toBe(true)
  })

  it('reads no quota used from the copy (?chain=unreachable)', () => {
    const copy = sampleWhitelistView({ max_supply: DEMO_COLLECTION.maxSupply }, false)
    expect(copy.chainReachable).toBe(false)
    expect(copy.lists.map((list) => list.quotaUsed)).toEqual([0, 0])
  })
})

describe('sampleApplyQuotas', () => {
  it('writes the copies of the pairs a chunk carried and counts the chunk', () => {
    const next = sampleApplyQuotas(callFor(view, 1), view, HASH)
    expect(listIn(next, 1)).toMatchObject({ written: 620, unwritten: 0 })
    expect(listIn(next, 1).chunks.map((chunk) => [chunk.txHash, chunk.addresses])).toEqual([
      [listIn(view, 1).chunks[0]?.txHash, 500],
      [HASH, 120],
    ])
    expect(chunkPlanOf(listIn(next, 1))).toBeNull()
  })

  it('creates an address it wrote above 0, deletes a written zero, and creates nothing for an unlisted zero', () => {
    const [first, second] = listIn(view, 2).entries
    if (!first || !second) throw new Error('the sample has two entries')
    const staged = withEntries(
      view,
      2,
      listIn(view, 2).entries.map((entry) =>
        entry.address === first.address ? { ...entry, quota: 0 } : entry,
      ),
    )
    const next = sampleApplyQuotas(
      phaseCalls.quotas(2, [first.address, NEW, UNLISTED], [0, 5, 0]),
      staged,
      HASH,
    )
    const entries = listIn(next, 2).entries
    expect(entries.some((entry) => entry.address === first.address)).toBe(false)
    expect(entries.some((entry) => entry.address === UNLISTED)).toBe(false)
    expect(entries.find((entry) => entry.address === NEW)).toEqual<ListEntry>({
      address: NEW,
      quota: 5,
      writtenQuota: 5,
      writtenTx: HASH,
    })
    expect(entries.find((entry) => entry.address === second.address)).toEqual(second)
  })

  it('leaves the view as it is for any other call', () => {
    expect(sampleApplyQuotas(phaseCalls.open(1), view, HASH)).toBe(view)
  })
})

describe('sampleSentChunk', () => {
  it('waits on the first list with an address not written, and on none when every address is written', () => {
    expect(sampleSentChunk(view)).toEqual({ hash: sampleTxHash(41), onchainId: 1 })
    expect(sampleSentChunk(sampleApplyQuotas(callFor(view, 1), view, HASH))).toBeNull()
  })
})

describe('sampleWhitelistServer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  /** A server call, settled after the sample's 900 ms. */
  async function settle<T>(call: Promise<T>): Promise<T> {
    await vi.advanceTimersByTimeAsync(900)
    return call
  }

  it('confirms the call the simulated wallet sent with the hash, or the next chunk for a hash it never sent', async () => {
    const sent = new Map<Hex, ManageCall>()
    let current = view
    const server = sampleWhitelistServer(() => current, sent)
    const nextChunk = await settle(server.nextChunk(1))
    expect(nextChunk.ok && nextChunk.data).toMatchObject({ onchainId: 1, number: 2, of: 2 })
    sent.set(HASH, phaseCalls.quotas(1, [NEW], [3]))
    const confirmed = await settle(server.confirmChunk(HASH, 1))
    if (!confirmed.ok) throw new Error(confirmed.error)
    expect(listIn(confirmed.data, 1).entries.find((entry) => entry.address === NEW)?.writtenQuota).toBe(3)
    current = confirmed.data
    const unknown = await settle(server.confirmChunk(sampleTxHash(41), 1))
    expect(unknown.ok && listIn(unknown.data, 1).unwritten).toBe(0)
  })

  it('answers the counts the screen patches produce', async () => {
    const server = sampleWhitelistServer(() => view)
    const owl = listIn(view, 1)
    const [written] = owl.entries.filter((entry) => entry.writtenQuota !== null)
    const [waiting] = owl.entries.filter((entry) => entry.writtenQuota === null)
    if (!written || !waiting) throw new Error('the sample has written and waiting entries')
    expect(
      await settle(
        server.addEntries(1, [
          { address: NEW, quota: 1 },
          { address: written.address, quota: written.quota },
          { address: waiting.address, quota: waiting.quota + 1 },
        ]),
      ),
    ).toEqual({ ok: true, data: { added: 1, updated: 1 } })
    const changed = owl.entries.filter((entry) => entry.quota > 0 && entry.quota !== 2).length
    expect(await settle(server.setQuotaForAll(1, 2))).toEqual({ ok: true, data: { changed } })
    expect(await settle(server.removeEntry(1, written.address))).toEqual({ ok: true, data: { staged: true } })
    expect(await settle(server.removeEntry(1, waiting.address))).toEqual({
      ok: true,
      data: { staged: false },
    })
  })

  it("reads the sample's minted count, 0 for an address added in the visit, null while the chain cannot be read", async () => {
    const server = sampleWhitelistServer(() => view)
    expect(await settle(server.quotaUsage(1, [getAddress(DEMO_MINTER), NEW]))).toEqual({
      ok: true,
      data: [1, 0],
    })
    const copy = sampleWhitelistView({ max_supply: DEMO_COLLECTION.maxSupply }, false)
    const unread = sampleWhitelistServer(() => copy)
    expect(await settle(unread.quotaUsage(1, [NEW]))).toEqual({ ok: true, data: [null] })
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @cobweb/web exec vitest run src/components/manage/manage-machine.test.ts src/components/manage/manage-sim.test.ts src/components/manage/whitelist-sim.test.ts`
Expected: FAIL. `whitelist-sim.test.ts` fails to load (the module does not exist); `manage-machine.test.ts` fails the four new tests (the chunk's "not confirmed yet" ends the poll at once, and `rememberChunk` is not a function); `manage-sim.test.ts` fails "refuses unequal lengths, the public sale and an unknown group as the contract would" (`sampleRevert` lets every `setMintQuota` through); "changes no group of the phases view" already passes.

- [ ] **Step 3: The machine**

In `apps/web/src/components/manage/manage-machine.ts`, replace:

```ts
  PHASE_TIMED_OUT,
  THROWN,
  type ActionResult,
} from '@/lib/art/result'
import type { ManageCall } from '@/lib/manage/phase-calls'
import type { PhaseAdd } from '@/lib/manage/phases-types'

/**
```

with:

```ts
  PHASE_TIMED_OUT,
  THROWN,
  WHITELIST_NOT_CONFIRMED,
  WHITELIST_TIMED_OUT,
  type ActionResult,
} from '@/lib/art/result'
import type { ManageCall } from '@/lib/manage/phase-calls'
import type { PhaseAdd } from '@/lib/manage/phases-types'
import type { SentChunk } from '@/lib/manage/whitelist-types'

/**
```

In `apps/web/src/components/manage/manage-machine.ts`, replace:

```ts
  wait(hash: Hex): Promise<'success' | 'reverted'>
  confirm(hash: Hex): Promise<ActionResult<T>>
  /** Add phase only: keeps the sent hash until the server records the phase. */
  remember?(hash: Hex): void
  forget?(): void
```

with:

```ts
  wait(hash: Hex): Promise<'success' | 'reverted'>
  confirm(hash: Hex): Promise<ActionResult<T>>
  /** Add phase and the chunk write: keep the sent hash until the server confirms it. */
  remember?(hash: Hex): void
  forget?(): void
```

In `apps/web/src/components/manage/manage-machine.ts`, replace:

```ts

/**
 * Asks the server to confirm a change every 3 seconds while it answers "not confirmed yet", for up to 2
 * minutes. A confirm that throws is a transient failure.
```

with:

```ts

/**
 * The answers that mean "not confirmed yet", each with what the machine says when the wait runs out: a phase
 * change's, and a whitelist chunk's (docs/specs/2026-10-15-whitelist.md, section 7.1).
 */
const NOT_CONFIRMED_YET = new Map([
  [PHASE_NOT_CONFIRMED, PHASE_TIMED_OUT],
  [WHITELIST_NOT_CONFIRMED, WHITELIST_TIMED_OUT],
])

/**
 * Asks the server to confirm a change every 3 seconds while it answers "not confirmed yet", for up to 2
 * minutes. A confirm that throws is a transient failure.
```

In `apps/web/src/components/manage/manage-machine.ts`, replace:

```ts
    }
    if (answer.ok) return { result: answer.data }
    if (answer.error !== PHASE_NOT_CONFIRMED) return { error: answer.error }
    if (deps.now() - started + CONFIRM_INTERVAL_MS > CONFIRM_TIMEOUT_MS) return { error: PHASE_TIMED_OUT }
    await deps.sleep(CONFIRM_INTERVAL_MS)
  }
```

with:

```ts
    }
    if (answer.ok) return { result: answer.data }
    const timedOut = NOT_CONFIRMED_YET.get(answer.error)
    if (!timedOut) return { error: answer.error }
    if (deps.now() - started + CONFIRM_INTERVAL_MS > CONFIRM_TIMEOUT_MS) return { error: timedOut }
    await deps.sleep(CONFIRM_INTERVAL_MS)
  }
```

In `apps/web/src/components/manage/manage-machine.ts`, replace:

```ts
    // Storage blocked: nothing was kept.
  }
}

```

with:

```ts
    // Storage blocked: nothing was kept.
  }
}

const chunkKeyFor = (collectionId: string) => `cobweb-whitelist:${collectionId}`

/** Keeps a chunk this browser sent until the server confirms it: one per collection. */
export function rememberChunk(store: KeyStore | null, collectionId: string, sent: SentChunk): void {
  try {
    store?.setItem(chunkKeyFor(collectionId), JSON.stringify(sent))
  } catch {
    // Storage blocked: the chunk is still checked in this visit.
  }
}

/** A chunk this browser sent for the collection and the server has not confirmed yet, or null. */
export function sentChunk(store: KeyStore | null, collectionId: string): SentChunk | null {
  try {
    const value = store?.getItem(chunkKeyFor(collectionId)) ?? null
    if (!value) return null
    const parsed = JSON.parse(value) as { hash?: unknown; onchainId?: unknown }
    if (typeof parsed.hash !== 'string' || !HASH_RE.test(parsed.hash)) return null
    if (typeof parsed.onchainId !== 'number' || !Number.isInteger(parsed.onchainId) || parsed.onchainId < 1)
      return null
    return { hash: parsed.hash as Hex, onchainId: parsed.onchainId }
  } catch {
    return null
  }
}

export function forgetChunk(store: KeyStore | null, collectionId: string): void {
  try {
    store?.removeItem(chunkKeyFor(collectionId))
  } catch {
    // Storage blocked: nothing was kept.
  }
}

```

In `apps/web/src/components/manage/manage-actions.ts`, the request's `pending` now serves the chunk write too:

In `apps/web/src/components/manage/manage-actions.ts`, replace:

```ts
  review: TxRequest
  confirm(hash: Hex): Promise<ActionResult<T>>
  /** Add phase only: keeps the sent hash until the server records the phase. */
  pending?: { remember(hash: Hex): void; forget(): void }
}
```

with:

```ts
  review: TxRequest
  confirm(hash: Hex): Promise<ActionResult<T>>
  /** Add phase and the chunk write: keep the sent hash until the server confirms it. */
  pending?: { remember(hash: Hex): void; forget(): void }
}
```

- [ ] **Step 4: The bound server and sample mode**

Create `apps/web/src/components/manage/whitelist-server.ts`:

```ts
import type { Address, Hex } from 'viem'
import {
  addEntries,
  confirmWhitelistChunk,
  getWhitelist,
  nextChunk,
  quotaUsage,
  removeEntry,
  setEntryQuota,
  setQuotaForAll,
} from '@/app/actions/whitelist'
import type { ActionResult } from '@/lib/art/result'
import type { ChunkEntry, ChunkPlan, WhitelistView } from '@/lib/manage/whitelist-types'

/**
 * The Whitelist's server, bound to one collection (docs/specs/2026-10-15-whitelist.md, section 7.2): the eight
 * actions in one object, which `sampleWhitelistServer` (whitelist-sim.ts) mirrors in sample mode.
 */
export type WhitelistServer = {
  read(): Promise<ActionResult<WhitelistView>>
  nextChunk(onchainId: number): Promise<ActionResult<ChunkPlan | null>>
  confirmChunk(hash: Hex, onchainId: number): Promise<ActionResult<WhitelistView>>
  addEntries(onchainId: number, rows: ChunkEntry[]): Promise<ActionResult<{ added: number; updated: number }>>
  setEntryQuota(onchainId: number, address: Address, quota: number): Promise<ActionResult>
  setQuotaForAll(onchainId: number, quota: number): Promise<ActionResult<{ changed: number }>>
  removeEntry(onchainId: number, address: Address): Promise<ActionResult<{ staged: boolean }>>
  quotaUsage(onchainId: number, addresses: Address[]): Promise<ActionResult<(number | null)[]>>
}

export function whitelistServer(collectionId: string): WhitelistServer {
  return {
    read: () => getWhitelist(collectionId),
    nextChunk: (onchainId) => nextChunk(collectionId, onchainId),
    confirmChunk: (hash, onchainId) => confirmWhitelistChunk(collectionId, hash, onchainId),
    addEntries: (onchainId, rows) => addEntries(collectionId, onchainId, rows),
    setEntryQuota: (onchainId, address, quota) => setEntryQuota(collectionId, onchainId, address, quota),
    setQuotaForAll: (onchainId, quota) => setQuotaForAll(collectionId, onchainId, quota),
    removeEntry: (onchainId, address) => removeEntry(collectionId, onchainId, address),
    quotaUsage: (onchainId, addresses) => quotaUsage(collectionId, onchainId, addresses),
  }
}
```

Create `apps/web/src/components/manage/whitelist-sim.ts`:

```ts
/**
 * Sample mode for the Whitelist tab (docs/specs/2026-10-15-whitelist.md, section 8). Nothing here talks to a
 * wallet, an RPC or the database: `sampleWhitelistServer` has the shape of `whitelistServer`
 * (whitelist-server.ts), and its confirm applies exactly the call the simulated wallet sent, as
 * `whitelist_chunk_record` would, so the screen runs the same code in both modes.
 */
import { getAddress, type Hex } from 'viem'
import type { ActionResult } from '@/lib/art/result'
import { DEMO_NOW, DEMO_WHITELISTS, sampleTxHash, type GroupWhitelist } from '@/lib/demo'
import { phaseCalls, type ManageCall } from '@/lib/manage/phase-calls'
import type {
  GroupList,
  ListEntry,
  SentChunk,
  WhitelistView,
  WrittenChunk,
} from '@/lib/manage/whitelist-types'
import { byAddress, chunkPlanOf, listOf, whitelistGroups, WHITELIST_CHUNK } from '@/lib/manage/whitelist-view'
import { samplePhasesView } from './manage-sim'
import type { WhitelistServer } from './whitelist-server'

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** A sample list as the server would read it: an entry in a written sample chunk carries its quota and that chunk's hash. */
function sampleList(sample: GroupWhitelist, quotaUsed: number): GroupList {
  const written = sample.chunks.filter((chunk) => chunk.status === 'written')
  const hashOf = (index: number) => written[index]?.txHash ?? sampleTxHash(sample.groupId * 100 + index)
  const entries = sample.entries
    .map((entry, position): ListEntry => {
      const index = written.findIndex((chunk) => position >= chunk.from && position < chunk.to)
      return {
        address: getAddress(entry.address),
        quota: entry.quota,
        writtenQuota: index < 0 ? null : entry.quota,
        writtenTx: index < 0 ? null : hashOf(index),
      }
    })
    .sort(byAddress)
  const chunks = written.map((chunk, index): WrittenChunk => ({
    txHash: hashOf(index),
    addresses: chunk.to - chunk.from,
    // An hour apart, ending an hour before the sample's clock.
    writtenAt: (DEMO_NOW - (written.length - index) * 3_600) * 1_000,
  }))
  return listOf(sample.groupId, entries, quotaUsed, chunks)
}

/**
 * The sample's whitelists on the whitelist groups of `samplePhasesView` (scaled as Phases scales them): the Owl
 * List with 500 addresses written and 120 waiting, Team written. With `chainReachable` false, the copy:
 * quota used is not read (`?chain=unreachable`).
 */
export function sampleWhitelistView(
  collection: { max_supply: number | null },
  chainReachable = true,
): WhitelistView {
  const phases = samplePhasesView(collection, chainReachable)
  const groups = whitelistGroups(phases)
  const lists = groups.flatMap((group) => {
    const sample = DEMO_WHITELISTS.find((list) => list.groupId === group.id)
    return sample ? [sampleList(sample, chainReachable ? group.minted : 0)] : []
  })
  return {
    chainId: phases.chainId,
    contract: phases.contract,
    groups,
    lists,
    chunkSize: WHITELIST_CHUNK,
    blockTimestamp: phases.blockTimestamp,
    readAt: phases.readAt,
    chainReachable: phases.chainReachable,
  }
}

/**
 * The view after a `setMintQuota` lands, as `whitelist_chunk_record` writes it: each pair's copies on its
 * entry (an address above 0 the list does not hold becomes an entry, written), a written zero's entry deleted
 * once its listed quota is 0 too, and the chunk counted by the entries that name it.
 */
export function sampleApplyQuotas(call: ManageCall, view: WhitelistView, hash: Hex): WhitelistView {
  if (call.functionName !== 'setMintQuota') return view
  const [addresses, group, quotas] = call.args
  const onchainId = Number(group)
  const list = view.lists.find((candidate) => candidate.onchainId === onchainId)
  if (!list) return view
  const tx = hash.toLowerCase() as Hex
  const pairs = new Map<string, number>()
  addresses.forEach((address, index) => pairs.set(address.toLowerCase(), Number(quotas[index] ?? 0n)))
  const listed = new Set(list.entries.map((entry) => entry.address.toLowerCase()))
  const entries = list.entries.flatMap((entry): ListEntry[] => {
    const written = pairs.get(entry.address.toLowerCase())
    if (written === undefined) return [entry]
    return written === 0 && entry.quota === 0 ? [] : [{ ...entry, writtenQuota: written, writtenTx: tx }]
  })
  for (const [address, quota] of pairs)
    if (quota > 0 && !listed.has(address))
      entries.push({ address: getAddress(address), quota, writtenQuota: quota, writtenTx: tx })
  entries.sort(byAddress)
  const chunks = list.chunks.some((chunk) => chunk.txHash === tx)
    ? list.chunks
    : [
        ...list.chunks,
        {
          txHash: tx,
          addresses: 0,
          writtenAt: Math.max(0, ...list.chunks.map((chunk) => chunk.writtenAt)) + 1_000,
        },
      ]
  const next = listOf(onchainId, entries, list.quotaUsed, chunks)
  return { ...view, lists: view.lists.map((candidate) => (candidate === list ? next : candidate)) }
}

/**
 * The sample server: every answer takes 900 ms. A confirm applies the call the simulated wallet sent with that
 * hash, or the group's next chunk for a hash it never sent (`?chunk=pending`); the edits answer the counts the
 * screen's patches produce; quota used is the sample's minted count (0 for an address added in the visit, null
 * while the chain cannot be read).
 */
export function sampleWhitelistServer(
  current: () => WhitelistView,
  sent: Map<Hex, ManageCall> = new Map(),
): WhitelistServer {
  const answer = async <T>(data: () => T): Promise<ActionResult<T>> => {
    await wait(900)
    return { ok: true, data: data() }
  }
  const listFor = (onchainId: number) => current().lists.find((list) => list.onchainId === onchainId)
  const entryOf = (onchainId: number, address: string) =>
    listFor(onchainId)?.entries.find((entry) => entry.address.toLowerCase() === address.toLowerCase())
  const minted = new Map(
    DEMO_WHITELISTS.flatMap((list) =>
      list.entries.map((entry) => [`${list.groupId}:${entry.address.toLowerCase()}`, entry.minted] as const),
    ),
  )
  return {
    read: () => answer(current),
    nextChunk: (onchainId) =>
      answer(() => {
        const list = listFor(onchainId)
        return list ? chunkPlanOf(list) : null
      }),
    confirmChunk: (hash, onchainId) =>
      answer(() => {
        const view = current()
        const list = view.lists.find((candidate) => candidate.onchainId === onchainId)
        const plan = list ? chunkPlanOf(list) : null
        const call =
          sent.get(hash) ??
          (plan
            ? phaseCalls.quotas(
                onchainId,
                plan.entries.map((entry) => entry.address),
                plan.entries.map((entry) => entry.quota),
              )
            : null)
        return call ? sampleApplyQuotas(call, view, hash) : view
      }),
    addEntries: (onchainId, rows) =>
      answer(() => {
        let added = 0
        let updated = 0
        for (const row of rows) {
          const entry = entryOf(onchainId, row.address)
          if (!entry) added++
          else if (entry.quota !== row.quota) updated++
        }
        return { added, updated }
      }),
    setEntryQuota: () => answer(() => undefined),
    setQuotaForAll: (onchainId, quota) =>
      answer(() => ({
        changed:
          listFor(onchainId)?.entries.filter((entry) => entry.quota > 0 && entry.quota !== quota).length ?? 0,
      })),
    removeEntry: (onchainId, address) =>
      answer(() => ({ staged: Boolean(entryOf(onchainId, address)?.writtenQuota) })),
    quotaUsage: (onchainId, addresses) =>
      answer(() =>
        addresses.map((address) =>
          current().chainReachable ? (minted.get(`${onchainId}:${address.toLowerCase()}`) ?? 0) : null,
        ),
      ),
  }
}

/** The chunk `?chunk=pending` shows waiting to be confirmed: on the first list with an address not written. */
export function sampleSentChunk(view: WhitelistView): SentChunk | null {
  const list = view.lists.find((candidate) => candidate.unwritten > 0)
  return list ? { hash: sampleTxHash(41), onchainId: list.onchainId } : null
}
```

In `apps/web/src/components/manage/manage-sim.ts`, `SAMPLE.whitelists` goes (nothing reads it; the sample lists now come from `whitelist-sim.ts`), and the quota call joins the sample's revert and apply:

In `apps/web/src/components/manage/manage-sim.ts`, replace:

```ts
  DEMO_PUBLIC_MAX_PER_WALLET,
  DEMO_RENDER_JOBS,
  DEMO_WHITELISTS,
  sampleSupply,
  sampleTxHash,
```

with:

```ts
  DEMO_PUBLIC_MAX_PER_WALLET,
  DEMO_RENDER_JOBS,
  sampleSupply,
  sampleTxHash,
```

In `apps/web/src/components/manage/manage-sim.ts`, replace:

```ts
  /** SEAM: the freshness server's `readAt` / block timestamp for the collection. */
  readAt: DEMO_NOW,
  /** SEAM: whitelist entries and the chunk table. */
  whitelists: DEMO_WHITELISTS,
  /** SEAM: the mint page settings row (avatar and the public switch on the overview). */
  mintPage: DEMO_MINT_PAGE_SETTINGS,
```

with:

```ts
  /** SEAM: the freshness server's `readAt` / block timestamp for the collection. */
  readAt: DEMO_NOW,
  /** SEAM: the mint page settings row (avatar and the public switch on the overview). */
  mintPage: DEMO_MINT_PAGE_SETTINGS,
```

In `apps/web/src/components/manage/manage-sim.ts`, replace:

```ts
/**
 * How the contract would refuse a call on the sample view, or null when it would pass: the mirror of the
 * collection's group checks (an unknown group, an id taken, below minted, the allocations over the supply).
 */
export function sampleRevert(call: ManageCall, view: PhasesView): ContractFunctionRevertedError | null {
```

with:

```ts
/**
 * How the contract would refuse a call on the sample view, or null when it would pass: the mirror of the
 * collection's group checks (an unknown group, an id taken, below minted, the allocations over the supply) and
 * of `setMintQuota`'s (unequal lengths, the public sale, an unknown group).
 */
export function sampleRevert(call: ManageCall, view: PhasesView): ContractFunctionRevertedError | null {
```

In `apps/web/src/components/manage/manage-sim.ts`, replace:

```ts
    case 'changeSalePrice':
      return find(call.args[1]) ? null : missing(call.args[1])
    default:
      return null
```

with:

```ts
    case 'changeSalePrice':
      return find(call.args[1]) ? null : missing(call.args[1])
    case 'setMintQuota': {
      const [addresses, id, quotas] = call.args
      if (addresses.length !== quotas.length)
        return revert(
          call.functionName,
          encodeErrorResult({ abi: collectionAbi, errorName: 'ArrayLengthMismatch' }),
        )
      if (id === 0n)
        return revert(
          call.functionName,
          encodeErrorResult({ abi: collectionAbi, errorName: 'PublicGroupHasNoQuota' }),
        )
      return find(id) ? null : missing(id)
    }
    default:
      return null
```

In `apps/web/src/components/manage/manage-sim.ts`, replace:

```ts
    case 'setPublicMaxMintPerWallet':
      publicMaxPerWallet = Number(call.args[0])
      break
  }
```

with:

```ts
    case 'setPublicMaxMintPerWallet':
      publicMaxPerWallet = Number(call.args[0])
      break
    case 'setMintQuota':
      // A phases view holds no quotas: the Whitelist's sample server applies them (whitelist-sim.ts).
      break
  }
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `pnpm --filter @cobweb/web exec vitest run src/components/manage/manage-machine.test.ts src/components/manage/manage-sim.test.ts src/components/manage/whitelist-sim.test.ts`
Expected: PASS, 48 tests in 3 files (manage-machine 29, manage-sim 10, whitelist-sim 9).

- [ ] **Step 6: Format, run the root checks and commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
pnpm exec prettier --write apps/web/src/components/manage/manage-machine.ts apps/web/src/components/manage/manage-machine.test.ts apps/web/src/components/manage/manage-actions.ts apps/web/src/components/manage/whitelist-server.ts apps/web/src/components/manage/whitelist-sim.ts apps/web/src/components/manage/whitelist-sim.test.ts apps/web/src/components/manage/manage-sim.ts apps/web/src/components/manage/manage-sim.test.ts
pnpm typecheck && pnpm lint && pnpm test
git add apps/web/src/components/manage/manage-machine.ts apps/web/src/components/manage/manage-machine.test.ts apps/web/src/components/manage/manage-actions.ts apps/web/src/components/manage/whitelist-server.ts apps/web/src/components/manage/whitelist-sim.ts apps/web/src/components/manage/whitelist-sim.test.ts apps/web/src/components/manage/manage-sim.ts apps/web/src/components/manage/manage-sim.test.ts
git commit -m "$(cat <<'EOF'
Poll a chunk until it is confirmed, keep a sent chunk in the browser, bind the Whitelist actions and add its sample server, view and record

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: the web package reports 574 tests (559 before: 15 added).

---

### Task 7: verify:whitelist on the deploy fixture

**Files:**

- Modify: `apps/web/scripts/deploy-fixture.ts` (the header comment; `removeFixtures` also checks that no whitelist entry is left)
- Create: `apps/web/scripts/verify-whitelist.ts`
- Modify: `apps/web/package.json` (the `verify:whitelist` script)
- Modify: `CLAUDE.md` (one line in Commands)
- Test: `pnpm --filter @cobweb/web verify:whitelist`; `verify:phases` and `verify:deploy` still pass on the shared fixture

**Interfaces:**

- Consumes: from `./deploy-fixture.ts`, `admin` (the service-role client), `chain` (the Anvil test client with public actions), `chainReady()`, `check(name, fn)`, `deployedCollection(creator, form, name?): Promise<Deployed>`, `factory`, `refusal(outcome)`, `removeFixtures()`, `rpc`, `runChecks(main, cleanup)`, `settings`, `signIn(account): Promise<Creator>`, the types `Deployed = { cid; ctx: DeployContext; prepared; record: DeployRecord; hash }` and `DeployForm`; from Task 5, every core of `../src/lib/manage/whitelist-core.ts` and `fetchHoldersCore` of `../src/lib/manage/snapshot-core.ts`; from Task 4, `phaseCalls` (`../src/lib/manage/phase-calls.ts`) and `addEntriesShape` (`../src/lib/manage/whitelist-schemas.ts`); from Task 3, the sentences (`../src/lib/art/result.ts`) and the types of `whitelist-types.ts`; from Task 2, `whitelist_chunk_record` (called once directly, with the service role).
- Produces: `pnpm --filter @cobweb/web verify:whitelist`, eighteen checks; `removeFixtures` answers "N whitelist entries left" when a run leaves one.

- [ ] **Step 1: The fixture checks that no entry is left**

Entries cascade from their collection and group; the fixture now says so and checks it, for every script that uses it.

In `apps/web/scripts/deploy-fixture.ts`, replace:

```ts
// The local deploy fixture verify:deploy and verify:phases share (docs/specs/2026-10-15-phases.md, section
// 10), so the two cannot drift: the local settings with non-local endpoints refused, the service client
// and the Anvil client, the PASS and FAIL lines, the SIWE sign-in, a seeded generative collection, the
// lock and deploy contexts the write helpers build, the payment, the render functions, the factory call,
```

with:

```ts
// The local deploy fixture verify:deploy, verify:phases and verify:whitelist share (docs/specs/2026-10-15-phases.md,
// section 10), so they cannot drift: the local settings with non-local endpoints refused, the service client
// and the Anvil client, the PASS and FAIL lines, the SIWE sign-in, a seeded generative collection, the
// lock and deploy contexts the write helpers build, the payment, the render functions, the factory call,
```

In `apps/web/scripts/deploy-fixture.ts`, replace:

```ts
}

/** Deletes every job, collection (its deployment and phases cascade) and user the run created, or says what is left. */
export async function removeFixtures(): Promise<string | null> {
  if (collectionIds.length) {
```

with:

```ts
}

/**
 * Deletes every job, collection (its deployment, phases and whitelist entries cascade) and user the run created,
 * or says what is left.
 */
export async function removeFixtures(): Promise<string | null> {
  if (collectionIds.length) {
```

In `apps/web/scripts/deploy-fixture.ts`, replace:

```ts
    if (groups.error) return `mint_groups: ${groups.error.message}`
    if (groups.data.length) return `${groups.data.length} mint group(s) left`
  }
  for (const id of userIds) {
```

with:

```ts
    if (groups.error) return `mint_groups: ${groups.error.message}`
    if (groups.data.length) return `${groups.data.length} mint group(s) left`
    const entries = await admin
      .from('whitelist_entries')
      .select('wallet_address')
      .in('collection_id', collectionIds)
    if (entries.error) return `whitelist_entries: ${entries.error.message}`
    if (entries.data.length) return `${entries.data.length} whitelist entries left`
  }
  for (const id of userIds) {
```

- [ ] **Step 2: verify:whitelist**

Decision (section 10): the addresses come from the keccak of an index, so their lowercase order is not the order they were added in; the deploy form gives Public (free, 1 token) and Holders (0.001 ETH, 2 tokens) on the fixture's collection of three tokens, with a public limit of 2; the raise and the removal take entries other than the stranger's, who must still hold a quota to mint in check 11.

Create `apps/web/scripts/verify-whitelist.ts`:

```ts
// Checks the Whitelist against a LOCAL Anvil chain and LOCAL Supabase (docs/specs/2026-10-15-whitelist.md,
// section 10): a collection deployed through the factory with Public (free, 1) and Holders (0.001 ETH, 2) of
// three tokens; 1,100 addresses added in two pages, Set quota for all, 20 re-added; the cap and the zero address
// refused; three chunks built by the server with nextChunkCore, simulated as wagmi does, sent from the creator's
// key (the contract's owner) and confirmed from their receipts and calldata; the copies against mintQuotas; a
// chunk confirmed twice; a raised quota and two removals; quota used from the chain; the confirm's refusals; a
// stranger's session; a chunk sent outside the flow; the holder snapshot and its refusals; the copy when the
// chain does not answer. Eighteen PASS lines with the cleanup.
//
//   supabase start
//   pnpm --filter @cobweb/web chain:local    (then copy its two lines into apps/web/.env.local)
//   pnpm --filter @cobweb/web verify:whitelist
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
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'
import { anvil } from 'viem/chains'
import { collectionAbi } from '@cobweb/shared/collection-abi'
import {
  admin,
  chain,
  chainReady,
  check,
  deployedCollection,
  factory,
  refusal,
  removeFixtures,
  rpc,
  runChecks,
  settings,
  signIn,
  type Deployed,
  type DeployForm,
} from './deploy-fixture.ts'

const {
  addEntriesCore,
  confirmWhitelistChunkCore,
  nextChunkCore,
  quotaUsageCore,
  removeEntryCore,
  setEntryQuotaCore,
  setQuotaForAllCore,
  whitelistViewCore,
} = await import('../src/lib/manage/whitelist-core.ts')
const { fetchHoldersCore } = await import('../src/lib/manage/snapshot-core.ts')
const { phaseCalls } = await import('../src/lib/manage/phase-calls.ts')
const { addEntriesShape } = await import('../src/lib/manage/whitelist-schemas.ts')
const {
  NOT_A_CONTRACT,
  NOT_DEPLOYED,
  NOT_ERC721,
  NOT_FROM_WALLET,
  NOT_THIS_CHANGE,
  NOT_THIS_CONTRACT,
  SNAPSHOT_CHAIN,
  WHITELIST_FULL,
  ZERO_ADDRESS,
} = await import('../src/lib/art/result.ts')
type ManageCall = import('../src/lib/manage/phase-calls.ts').ManageCall
type WhitelistContext = import('../src/lib/manage/whitelist-core.ts').WhitelistContext
type ChunkEntry = import('../src/lib/manage/whitelist-types.ts').ChunkEntry
type ChunkPlan = import('../src/lib/manage/whitelist-types.ts').ChunkPlan
type GroupList = import('../src/lib/manage/whitelist-types.ts').GroupList
type WhitelistView = import('../src/lib/manage/whitelist-types.ts').WhitelistView

const HOLDERS_PRICE = '1000000000000000'

/** An address of its own for each index, from the keccak of the index, so address order is not list order. */
const addressAt = (index: number): Address => getAddress(`0x${keccak256(toHex(index)).slice(26)}`)

type EntryRow = {
  wallet_address: string
  quota: number
  written_quota: number | null
  written_tx: string | null
  written_at: string | null
}

/** A group's entries as the service role reads them, every page, in lowercase address order. */
async function entryRows(groupId: string): Promise<EntryRow[]> {
  const rows: EntryRow[] = []
  for (let from = 0; ; from += 1_000) {
    const { data, error } = await admin
      .from('whitelist_entries')
      .select('wallet_address, quota, written_quota, written_tx, written_at')
      .eq('mint_group_id', groupId)
      .order('wallet_address')
      .range(from, from + 999)
    if (error) throw new Error(`entries: ${error.message}`)
    rows.push(...data)
    if (data.length < 1_000) break
  }
  return rows.sort((a, b) =>
    a.wallet_address < b.wallet_address ? -1 : a.wallet_address > b.wallet_address ? 1 : 0,
  )
}

/** The row id of a collection's group, as the service role reads it. */
async function groupRowId(cid: string, onchainId: number): Promise<string> {
  const { data, error } = await admin
    .from('mint_groups')
    .select('id')
    .eq('collection_id', cid)
    .eq('onchain_id', onchainId)
    .single()
  if (error) throw new Error(`group ${onchainId}: ${error.message}`)
  return data.id
}

/** Simulates the call as wagmi does, sends exactly the simulated request from the account and waits. */
async function send(account: PrivateKeyAccount, address: Address, call: ManageCall): Promise<Hex> {
  const { request } = await chain.simulateContract({
    address,
    abi: collectionAbi,
    functionName: call.functionName,
    args: call.args,
    account,
  })
  const wallet = createWalletClient({ account, chain: anvil, transport: http(rpc) })
  const hash = await wallet.writeContract(request)
  const receipt = await chain.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`${call.functionName} reverted: ${hash}`)
  return hash
}

/** The rows an add sends, after the shape the action parses them with. */
function shaped(rows: ChunkEntry[]): ChunkEntry[] {
  const parsed = addEntriesShape.safeParse(rows)
  if (!parsed.success) throw new Error(`the rows are refused: ${parsed.error.issues[0]?.message}`)
  return parsed.data
}

/** The view's list for Holders (group 1). */
const holdersList = (view: WhitelistView): GroupList | undefined =>
  view.lists.find((list) => list.onchainId === 1)

async function main(): Promise<void> {
  console.log(`Verifying the whitelist on ${rpc} against ${settings.url}`)
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
  const strangerWallet = strangerKey.address.toLowerCase()

  const form: DeployForm = {
    chainId: 31337,
    payout: creatorKey.address,
    royaltyBps: 500,
    royaltyReceiver: creatorKey.address,
    publicMaxPerWallet: 2,
    groups: [
      { name: 'Public', priceWei: '0', maxSupply: 1 },
      { name: 'Holders', priceWei: HOLDERS_PRICE, maxSupply: 2 },
    ],
  }
  let deployed: Deployed | null = null
  let holdersId = ''
  /** The collection check 2 deploys; every later check runs on it. */
  const subject = (): Deployed => {
    if (!deployed) throw new Error('the collection of check 2 is not deployed')
    return deployed
  }
  /** The 1,100 addresses check 3 adds, the stranger's first. */
  const listed: Address[] = [
    strangerKey.address,
    ...Array.from({ length: 1_099 }, (_, index) => addressAt(index)),
  ]
  /** Holders' entries other than the stranger's, in address order. */
  const others = async () =>
    (await entryRows(holdersId)).filter((row) => row.wallet_address !== strangerWallet)
  /** What the contract issued an address in Holders. */
  const quotaOn = (address: Address) =>
    chain.readContract({
      address: subject().record.contractAddress,
      abi: collectionAbi,
      functionName: 'mintQuotas',
      args: [1n, address],
    })
  /** Builds Holders' next chunk on the server, sends it from the creator and confirms it, as the dialog and the action do. */
  const writeNext = async (): Promise<{ view: WhitelistView; hash: Hex; plan: ChunkPlan }> => {
    const { ctx, record } = subject()
    const next = await nextChunkCore(ctx, 1)
    if (!('data' in next)) throw new Error(`next chunk: ${refusal(next)}`)
    if (!next.data) throw new Error('next chunk: every address is written')
    const plan = next.data
    const call = phaseCalls.quotas(
      1,
      plan.entries.map((entry) => entry.address),
      plan.entries.map((entry) => entry.quota),
    )
    const hash = await send(creatorKey, record.contractAddress, call)
    const confirmed = await confirmWhitelistChunkCore(ctx, hash, 1)
    if (!('data' in confirmed)) throw new Error(`confirm: ${refusal(confirmed)}`)
    return { view: confirmed.data, hash, plan }
  }

  await check(
    '2. read: a collection deployed with Public (free, 1) and Holders (0.001 ETH, 2) of three tokens reads Holders, named, as its one whitelist group, with an empty list',
    async () => {
      deployed = await deployedCollection(creator, form, 'whitelist')
      holdersId = await groupRowId(deployed.cid, 1)
      const outcome = await whitelistViewCore(deployed.ctx)
      if (!('data' in outcome)) return refusal(outcome)
      const view = outcome.data
      const groups = view.groups.map((group) => `${group.id}:${group.name}:${group.named}`).join(' ')
      const list = holdersList(view)
      return view.chainReachable &&
        view.chunkSize === 500 &&
        groups === '1:Holders:true' &&
        view.lists.length === 1 &&
        list?.total === 0 &&
        list.chunks.length === 0
        ? null
        : `${groups} ${JSON.stringify(view.lists)}`
    },
  )

  await check(
    '3. add: 1,100 addresses, the stranger first, answer 1,100 added in two pages; Set quota for all to 2 changes 1,100; 20 others re-added at 1 answer 20 updated',
    async () => {
      const { ctx } = subject()
      const added = await addEntriesCore(ctx, 1, shaped(listed.map((address) => ({ address, quota: 1 }))))
      if (!('data' in added)) return `add: ${refusal(added)}`
      const all = await setQuotaForAllCore(ctx, 1, 2)
      if (!('data' in all)) return `all: ${refusal(all)}`
      const again = await addEntriesCore(
        ctx,
        1,
        shaped(listed.slice(1_000, 1_020).map((address) => ({ address, quota: 1 }))),
      )
      if (!('data' in again)) return `again: ${refusal(again)}`
      const rows = await entryRows(holdersId)
      const ones = rows.filter((row) => row.quota === 1).length
      return added.data.added === 1_100 &&
        added.data.updated === 0 &&
        all.data.changed === 1_100 &&
        again.data.added === 0 &&
        again.data.updated === 20 &&
        rows.length === 1_100 &&
        ones === 20
        ? null
        : `${JSON.stringify([added.data, all.data, again.data])}, ${rows.length} rows, ${ones} at 1`
    },
  )

  await check(
    '4. limits: 8,901 more are refused as a full whitelist and nothing is written; the zero address is refused by the shape',
    async () => {
      const { ctx } = subject()
      const more = shaped(
        Array.from({ length: 8_901 }, (_, index) => ({ address: addressAt(10_000 + index), quota: 1 })),
      )
      const full = await addEntriesCore(ctx, 1, more)
      if (refusal(full) !== WHITELIST_FULL) return `full: ${refusal(full)}`
      const zero = addEntriesShape.safeParse([{ address: zeroAddress, quota: 1 }])
      const sentence = zero.success ? 'accepted' : zero.error.issues[0]?.message
      if (sentence !== ZERO_ADDRESS) return `zero: ${sentence}`
      return (await entryRows(holdersId)).length === 1_100 ? null : 'rows were written'
    },
  )

  await check(
    '5. next chunk: chunk 1 of 3 is the first 500 addresses in lowercase address order, with their quotas',
    async () => {
      const { ctx } = subject()
      const next = await nextChunkCore(ctx, 1)
      if (!('data' in next)) return refusal(next)
      if (!next.data) return 'no chunk'
      const first = (await entryRows(holdersId))
        .slice(0, 500)
        .map((row) => `${row.wallet_address}:${row.quota}`)
        .join(' ')
      const planned = next.data.entries
        .map((entry) => `${entry.address.toLowerCase()}:${entry.quota}`)
        .join(' ')
      return next.data.number === 1 &&
        next.data.of === 3 &&
        next.data.entries.length === 500 &&
        planned === first
        ? null
        : `chunk ${next.data.number} of ${next.data.of}, ${next.data.entries.length} entries, in order: ${planned === first}`
    },
  )

  const chunkHashes: Hex[] = []
  await check(
    "6. write: three chunks confirmed leave 500, 1,000 and 1,100 written, each copy its quota with its chunk's hash, chunks of 500, 500 and 100, and no next chunk",
    async () => {
      const { ctx } = subject()
      const written: number[] = []
      const chunkOf = new Map<string, Hex>()
      for (let index = 0; index < 3; index++) {
        const { view, hash, plan } = await writeNext()
        chunkHashes.push(hash)
        for (const entry of plan.entries) chunkOf.set(entry.address.toLowerCase(), hash)
        written.push(holdersList(view)?.written ?? -1)
      }
      const wrong = (await entryRows(holdersId)).filter(
        (row) => row.written_quota !== row.quota || row.written_tx !== chunkOf.get(row.wallet_address),
      )
      const view = await whitelistViewCore(ctx)
      if (!('data' in view)) return refusal(view)
      const sizes = (holdersList(view.data)?.chunks ?? []).map((chunk) => chunk.addresses).join(' ')
      const next = await nextChunkCore(ctx, 1)
      return written.join(' ') === '500 1000 1100' &&
        wrong.length === 0 &&
        sizes === '500 500 100' &&
        'data' in next &&
        next.data === null
        ? null
        : `written ${written.join(' ')}, ${wrong.length} wrong copies, chunks ${sizes}`
    },
  )

  await check(
    '7. chain: mintQuotas(1, address) equals the listed quota for the first, 500th, 501st and last address and the stranger',
    async () => {
      const rows = await entryRows(holdersId)
      const picks = [
        rows[0],
        rows[499],
        rows[500],
        rows[rows.length - 1],
        rows.find((row) => row.wallet_address === strangerWallet),
      ]
      const problems: string[] = []
      for (const row of picks) {
        if (!row) {
          problems.push('a row is missing')
          continue
        }
        const onChain = await quotaOn(getAddress(row.wallet_address))
        if (onChain !== BigInt(row.quota))
          problems.push(`${row.wallet_address}: ${onChain} on chain, ${row.quota} listed`)
      }
      return problems.length ? problems.join('; ') : null
    },
  )

  await check(
    '8. again: chunk 2 confirmed a second time answers the same counts and keeps written_at; recording it once more writes nothing',
    async () => {
      const { cid, ctx } = subject()
      const hash = chunkHashes[1]
      if (!hash) return 'no chunk 2'
      const before = JSON.stringify(await entryRows(holdersId))
      const again = await confirmWhitelistChunkCore(ctx, hash, 1)
      if (!('data' in again)) return refusal(again)
      const rows = await entryRows(holdersId)
      const same = before === JSON.stringify(rows)
      const recorded = await admin.rpc('whitelist_chunk_record', {
        p_collection_id: cid,
        p_owner: creator.userId,
        p_onchain_id: 1,
        p_tx: hash,
        p_rows: rows
          .filter((row) => row.written_tx === hash)
          .map((row) => ({ address: row.wallet_address, quota: row.quota })),
      })
      const list = holdersList(again.data)
      return same && list?.written === 1_100 && list.chunks.length === 3 && recorded.data === 0
        ? null
        : `same rows ${same}, written ${list?.written}, chunks ${list?.chunks.length}, record ${JSON.stringify(recorded.data ?? recorded.error)}`
    },
  )

  await check(
    '9. raise: a quota raised to 3 re-queues only that address; its chunk writes 3 on chain',
    async () => {
      const { ctx } = subject()
      const [first] = await others()
      if (!first) return 'no entry'
      const target = getAddress(first.wallet_address)
      const raised = await setEntryQuotaCore(ctx, 1, target, 3)
      if (!('data' in raised)) return refusal(raised)
      const next = await nextChunkCore(ctx, 1)
      if (!('data' in next)) return refusal(next)
      const queued = next.data?.entries.map((entry) => `${entry.address}:${entry.quota}`).join(' ')
      if (queued !== `${target}:3`) return `queued ${queued}`
      await writeNext()
      const onChain = await quotaOn(target)
      return onChain === 3n ? null : `mintQuotas ${onChain}`
    },
  )

  await check(
    '10. remove: a written address is staged at 0, its zero written, its row deleted and mintQuotas 0; a new one is deleted at once and Undo puts it back',
    async () => {
      const { ctx } = subject()
      const [, second] = await others()
      if (!second) return 'no entry'
      const written = getAddress(second.wallet_address)
      const staged = await removeEntryCore(ctx, 1, written)
      if (!('data' in staged)) return `stage: ${refusal(staged)}`
      const zero = (await entryRows(holdersId)).find((row) => row.wallet_address === second.wallet_address)
      if (!staged.data.staged || zero?.quota !== 0)
        return `staged ${staged.data.staged}, quota ${zero?.quota}`
      await writeNext()
      const gone = !(await entryRows(holdersId)).some((row) => row.wallet_address === second.wallet_address)
      const onChain = await quotaOn(written)
      const fresh = addressAt(50_000)
      const added = await addEntriesCore(ctx, 1, [{ address: fresh, quota: 4 }])
      if (!('data' in added)) return `add: ${refusal(added)}`
      const removed = await removeEntryCore(ctx, 1, fresh)
      if (!('data' in removed)) return `remove: ${refusal(removed)}`
      const deleted = !(await entryRows(holdersId)).some((row) => row.wallet_address === fresh.toLowerCase())
      const undo = await setEntryQuotaCore(ctx, 1, fresh, 4)
      if (!('data' in undo)) return `undo: ${refusal(undo)}`
      const back = (await entryRows(holdersId)).find((row) => row.wallet_address === fresh.toLowerCase())
      return gone &&
        onChain === 0n &&
        !removed.data.staged &&
        deleted &&
        back?.quota === 4 &&
        back.written_quota === null
        ? null
        : `gone ${gone}, mintQuotas ${onChain}, new staged ${removed.data.staged}, deleted ${deleted}, back ${JSON.stringify(back)}`
    },
  )

  let openHash: Hex | null = null
  let mintHash: Hex | null = null
  await check(
    "11. used: with Holders open, quotaUsageCore reads 0 for the stranger, then 1 once the stranger mints one, and the view's quota used 1",
    async () => {
      const { ctx, record } = subject()
      const address = record.contractAddress
      openHash = await send(creatorKey, address, phaseCalls.open(1))
      const before = await quotaUsageCore(ctx, 1, [strangerKey.address])
      if (!('data' in before)) return refusal(before)
      const [cost] = await chain.readContract({
        address,
        abi: collectionAbi,
        functionName: 'quoteBatchMint',
        args: [1n, 1n],
      })
      const minter = createWalletClient({ account: strangerKey, chain: anvil, transport: http(rpc) })
      mintHash = await minter.writeContract({
        address,
        abi: collectionAbi,
        functionName: 'batchMint',
        args: [1n, 1n],
        value: cost,
      })
      await chain.waitForTransactionReceipt({ hash: mintHash })
      const after = await quotaUsageCore(ctx, 1, [strangerKey.address])
      if (!('data' in after)) return refusal(after)
      const view = await whitelistViewCore(ctx)
      if (!('data' in view)) return refusal(view)
      const used = holdersList(view.data)?.quotaUsed
      return before.data[0] === 0 && after.data[0] === 1 && used === 1
        ? null
        : `${JSON.stringify([before.data, after.data])}, quota used ${used}`
    },
  )

  await check(
    "12. refusals: the stranger's mint is not from the wallet, the Open hash and chunk 3 for group 2 are not this change, a chunk to another collection is not this contract; nothing is recorded",
    async () => {
      const { ctx } = subject()
      const third = chunkHashes[2]
      if (!mintHash || !openHash || !third) return 'a hash is missing'
      const before = JSON.stringify(await entryRows(holdersId))
      const fromStranger = await confirmWhitelistChunkCore(ctx, mintHash, 1)
      const asOpen = await confirmWhitelistChunkCore(ctx, openHash, 1)
      const otherGroup = await confirmWhitelistChunkCore(ctx, third, 2)
      const other = await deployedCollection(creator, form, 'other')
      const elsewhere = await send(
        creatorKey,
        other.record.contractAddress,
        phaseCalls.quotas(1, [strangerKey.address], [1]),
      )
      const toOther = await confirmWhitelistChunkCore(ctx, elsewhere, 1)
      const after = JSON.stringify(await entryRows(holdersId))
      const answers = [refusal(fromStranger), refusal(asOpen), refusal(otherGroup), refusal(toOther)].join(
        ' | ',
      )
      const wanted = [NOT_FROM_WALLET, NOT_THIS_CHANGE, NOT_THIS_CHANGE, NOT_THIS_CONTRACT].join(' | ')
      return answers === wanted && before === after ? null : `${answers}; rows changed: ${before !== after}`
    },
  )

  await check(
    "13. stranger: the stranger's session reads no entries, its view and its add are refused as not deployed, and its raw add is refused",
    async () => {
      const { cid, ctx } = subject()
      const strangerCtx: WhitelistContext = {
        supabase: stranger.client,
        service: () => admin,
        owner: stranger.userId,
        wallet: strangerWallet,
        collection: ctx.collection,
      }
      const rows = await stranger.client
        .from('whitelist_entries')
        .select('wallet_address')
        .eq('collection_id', cid)
      if (rows.error) return `rows: ${rows.error.message}`
      if (rows.data.length) return `the stranger reads ${rows.data.length} row(s)`
      const view = await whitelistViewCore(strangerCtx)
      if (refusal(view) !== NOT_DEPLOYED) return `view: ${refusal(view)}`
      const add = await addEntriesCore(strangerCtx, 1, [{ address: strangerKey.address, quota: 9 }])
      if (refusal(add) !== NOT_DEPLOYED) return `add: ${refusal(add)}`
      const raw = await stranger.client.rpc('whitelist_entries_add', {
        p_collection_id: cid,
        p_onchain_id: 1,
        p_rows: [{ address: strangerWallet, quota: 9 }],
      })
      if (raw.error?.code !== '42501') return `raw add: ${raw.error?.code ?? 'accepted'}`
      const own = (await entryRows(holdersId)).find((row) => row.wallet_address === strangerWallet)
      return own?.quota === 2 ? null : `the stranger's quota is ${own?.quota}`
    },
  )

  await check(
    '14. outside: a chunk sent without Cobweb for an unlisted address at 5 creates its row, written at 5',
    async () => {
      const { ctx, record } = subject()
      const outsider = addressAt(60_000)
      const hash = await send(creatorKey, record.contractAddress, phaseCalls.quotas(1, [outsider], [5]))
      const confirmed = await confirmWhitelistChunkCore(ctx, hash, 1)
      if (!('data' in confirmed)) return refusal(confirmed)
      const row = (await entryRows(holdersId)).find(
        (entry) => entry.wallet_address === outsider.toLowerCase(),
      )
      return row?.quota === 5 && row.written_quota === 5 && row.written_tx === hash
        ? null
        : JSON.stringify(row)
    },
  )

  await check(
    '15. snapshot: after the creator opens Public and mints one, the holders are the creator and the stranger with one token each, supply 2, at a block no earlier than the mint',
    async () => {
      const address = subject().record.contractAddress
      await send(creatorKey, address, phaseCalls.open(0))
      const [cost] = await chain.readContract({
        address,
        abi: collectionAbi,
        functionName: 'quoteBatchMint',
        args: [0n, 1n],
      })
      const own = createWalletClient({ account: creatorKey, chain: anvil, transport: http(rpc) })
      const minted = await own.writeContract({
        address,
        abi: collectionAbi,
        functionName: 'batchMint',
        args: [1n, 0n],
        value: cost,
      })
      const receipt = await chain.waitForTransactionReceipt({ hash: minted })
      const snapshot = await fetchHoldersCore(31337, address)
      if ('refused' in snapshot) return snapshot.refused
      const holders = snapshot.data.holders
        .map((holder) => `${holder.address}:${holder.balance}`)
        .sort()
        .join(' ')
      const wanted = [creatorKey.address, strangerKey.address]
        .map((holder) => `${holder}:1`)
        .sort()
        .join(' ')
      return holders === wanted &&
        snapshot.data.supply === 2 &&
        BigInt(snapshot.data.block) >= receipt.blockNumber
        ? null
        : `${holders}, supply ${snapshot.data.supply}, block ${snapshot.data.block}`
    },
  )

  await check(
    "16. snapshot refusals: the stranger's wallet has no contract, the factory is not an ERC-721, and chain 999 cannot be read",
    async () => {
      const answers = [
        await fetchHoldersCore(31337, strangerKey.address),
        await fetchHoldersCore(31337, factory),
        await fetchHoldersCore(999, subject().record.contractAddress),
      ]
        .map((outcome) => ('refused' in outcome ? outcome.refused : 'answered'))
        .join(' | ')
      const wanted = [NOT_A_CONTRACT('Anvil'), NOT_ERC721('Anvil'), SNAPSHOT_CHAIN].join(' | ')
      return answers === wanted ? null : answers
    },
  )

  await check(
    '17. failure path: a read that does not answer gives the same lists, unreachable, with no quota used',
    async () => {
      const { ctx } = subject()
      const live = await whitelistViewCore(ctx)
      const copy = await whitelistViewCore(ctx, async () => null)
      if (!('data' in live) || !('data' in copy)) return `${refusal(live)} ${refusal(copy)}`
      const lists = (view: WhitelistView) =>
        JSON.stringify(view.lists.map((list) => ({ ...list, quotaUsed: 0 })))
      return !copy.data.chainReachable &&
        copy.data.lists.every((list) => list.quotaUsed === 0) &&
        lists(copy.data) === lists(live.data)
        ? null
        : `reachable ${copy.data.chainReachable}, same lists ${lists(copy.data) === lists(live.data)}`
    },
  )
}

async function cleanup(): Promise<void> {
  await check(
    '18. cleanup: the run leaves no job, deployment, phase, whitelist entry, collection or user behind',
    removeFixtures,
  )
}

await runChecks(main, cleanup)
```

In `apps/web/package.json`, add the script after `verify:phases`:

In `apps/web/package.json`, replace:

```json
    "render:local": "node --conditions=react-server --import ./scripts/resolve-ts.mjs scripts/render-local.ts",
    "verify:deploy": "node --conditions=react-server --import ./scripts/resolve-ts.mjs scripts/verify-deploy.ts",
    "verify:phases": "node --conditions=react-server --import ./scripts/resolve-ts.mjs scripts/verify-phases.ts"
  },
  "devDependencies": {
```

with:

```json
    "render:local": "node --conditions=react-server --import ./scripts/resolve-ts.mjs scripts/render-local.ts",
    "verify:deploy": "node --conditions=react-server --import ./scripts/resolve-ts.mjs scripts/verify-deploy.ts",
    "verify:phases": "node --conditions=react-server --import ./scripts/resolve-ts.mjs scripts/verify-phases.ts",
    "verify:whitelist": "node --conditions=react-server --import ./scripts/resolve-ts.mjs scripts/verify-whitelist.ts"
  },
  "devDependencies": {
```

- [ ] **Step 3: Run verify:whitelist**

Run: `pnpm --filter @cobweb/web typecheck`, then `pnpm --filter @cobweb/web verify:whitelist`
Expected: eighteen PASS lines, then `18 passed, 0 failed`:

```
PASS 1. chain: Anvil answers as 31337 and the factory approves the shipped creation code hash
PASS 2. read: a collection deployed with Public (free, 1) and Holders (0.001 ETH, 2) of three tokens reads Holders, named, as its one whitelist group, with an empty list
PASS 3. add: 1,100 addresses, the stranger first, answer 1,100 added in two pages; Set quota for all to 2 changes 1,100; 20 others re-added at 1 answer 20 updated
PASS 4. limits: 8,901 more are refused as a full whitelist and nothing is written; the zero address is refused by the shape
PASS 5. next chunk: chunk 1 of 3 is the first 500 addresses in lowercase address order, with their quotas
PASS 6. write: three chunks confirmed leave 500, 1,000 and 1,100 written, each copy its quota with its chunk's hash, chunks of 500, 500 and 100, and no next chunk
PASS 7. chain: mintQuotas(1, address) equals the listed quota for the first, 500th, 501st and last address and the stranger
PASS 8. again: chunk 2 confirmed a second time answers the same counts and keeps written_at; recording it once more writes nothing
PASS 9. raise: a quota raised to 3 re-queues only that address; its chunk writes 3 on chain
PASS 10. remove: a written address is staged at 0, its zero written, its row deleted and mintQuotas 0; a new one is deleted at once and Undo puts it back
PASS 11. used: with Holders open, quotaUsageCore reads 0 for the stranger, then 1 once the stranger mints one, and the view's quota used 1
PASS 12. refusals: the stranger's mint is not from the wallet, the Open hash and chunk 3 for group 2 are not this change, a chunk to another collection is not this contract; nothing is recorded
PASS 13. stranger: the stranger's session reads no entries, its view and its add are refused as not deployed, and its raw add is refused
PASS 14. outside: a chunk sent without Cobweb for an unlisted address at 5 creates its row, written at 5
PASS 15. snapshot: after the creator opens Public and mints one, the holders are the creator and the stranger with one token each, supply 2, at a block no earlier than the mint
PASS 16. snapshot refusals: the stranger's wallet has no contract, the factory is not an ERC-721, and chain 999 cannot be read
PASS 17. failure path: a read that does not answer gives the same lists, unreachable, with no quota used
PASS 18. cleanup: the run leaves no job, deployment, phase, whitelist entry, collection or user behind

18 passed, 0 failed
```

A FAIL line names what it found instead; report it to the controller with the line. (A 500-address chunk uses about 11.6M gas on Anvil, under its 30M block limit.)

- [ ] **Step 4: The other scripts on the shared fixture**

Run: `pnpm --filter @cobweb/web verify:phases`, then `pnpm --filter @cobweb/web verify:deploy`
Expected: `20 passed, 0 failed`, then `15 passed, 0 failed` (their cleanup now also finds no whitelist entry).

- [ ] **Step 5: CLAUDE.md**

In `CLAUDE.md`, under `## Commands`, add the line after `verify:phases`:

In `CLAUDE.md`, replace:

````markdown
pnpm --filter @cobweb/web verify:deploy   # prepare, deploy through the factory, confirm from the event, the refusals, against local Supabase and Anvil
pnpm --filter @cobweb/web verify:phases   # the chain read, each phase change sent and confirmed from its receipt, the refusals and the copy, against local Supabase and Anvil
pnpm --filter @cobweb/web render:local <collectionId>   # renders the collection's paid jobs on the laptop against local Supabase, local storage and Anvil; CARs go to a temp folder
```
````

with:

````markdown
pnpm --filter @cobweb/web verify:deploy   # prepare, deploy through the factory, confirm from the event, the refusals, against local Supabase and Anvil
pnpm --filter @cobweb/web verify:phases   # the chain read, each phase change sent and confirmed from its receipt, the refusals and the copy, against local Supabase and Anvil
pnpm --filter @cobweb/web verify:whitelist   # the list, each chunk sent and confirmed from its receipt and calldata, the refusals and the snapshot, against local Supabase and Anvil
pnpm --filter @cobweb/web render:local <collectionId>   # renders the collection's paid jobs on the laptop against local Supabase, local storage and Anvil; CARs go to a temp folder
```
````

- [ ] **Step 6: Format, run the root checks and commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
pnpm exec prettier --write apps/web/scripts/deploy-fixture.ts apps/web/scripts/verify-whitelist.ts apps/web/package.json
pnpm typecheck && pnpm lint && pnpm test
git add apps/web/scripts/deploy-fixture.ts apps/web/scripts/verify-whitelist.ts apps/web/package.json CLAUDE.md
git commit -m "$(cat <<'EOF'
Add verify:whitelist on the deploy fixture: the list in pages, three chunks built by the server and confirmed from their receipts and calldata, the refusals, the holder snapshot and the copy

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: test counts unchanged (web 574).

---

### Task 8: The snapshot input on the real action, for Airdrop and Whitelist

**Files:**

- Modify: `apps/web/src/components/manage/snapshot.ts` (whole file: `fetchHolders` becomes `sampleFetchHolders`, answering a snapshot; `Holder` comes from `holders.ts`)
- Modify: `apps/web/src/components/manage/snapshot.test.ts` (imports; a `describe` appended)
- Create: `apps/web/src/components/manage/snapshot-source.ts`
- Modify: `apps/web/src/components/manage/snapshot-tab.tsx` (whole file: `SnapshotSource` gains `fetch`; the tab shows a refusal's sentence and the block)
- Modify: `apps/web/src/components/manage/airdrop-screen.tsx` (two props; the source built from them)
- Modify: `apps/web/src/app/collections/[id]/manage/airdrop/page.tsx` (whole file: `maxDuration`, the snapshot's chains and sample flag)
- Modify: `apps/web/src/components/manage/whitelist-screen.tsx` (two lines, until Task 9 rewrites it: the sample read)
- Test: `apps/web/src/components/manage/snapshot.test.ts`; typecheck, lint

**Interfaces:**

- Consumes: from Task 3, `Holder`, `HolderSnapshot` (`@/lib/manage/holders`), `NO_HOLDERS`, `SNAPSHOT_FAILED` (`@/lib/art/result`); from Task 5, `fetchHolders(collectionId, chainId, contract)` (`@/app/actions/snapshot`) and `snapshotChains()` (`@/lib/manage/snapshot-core`). Already in the repo: `chainView(chainId): SupportedChain` (`@/lib/chain/chain-view`), `sampleAddress(seed)`, `SUPPORTED_CHAINS`, `shortAddress`, `SupportedChain` (`@/lib/demo`), `ActionResult` (`@/lib/art/result`), `RecipientsInput` (which passes its `snapshot` prop to `SnapshotTab` unchanged), `stageContext(collection, stage, path)` with its `demo` flag.
- Produces:
  - in `./snapshot`: `sampleFetchHolders(chainId: number, contract: string): Promise<ActionResult<HolderSnapshot>>` (900 ms, 24 holders, the most tokens first, block 21,500,000, their tokens as the supply), `SAMPLE_SNAPSHOT_BLOCK = 21_500_000`; `Holder` re-exported from `@/lib/manage/holders`; `holdersToText` and `snapshotAddressError` unchanged
  - in `./snapshot-tab`: `SnapshotSource = { chains: SupportedChain[]; chainId: number; fetch(chainId: number, contract: string): Promise<ActionResult<HolderSnapshot>> }`
  - in `./snapshot-source`: `snapshotSource(input: { collectionId: string; sample: boolean; chainIds: number[]; preferred: number }): SnapshotSource | undefined` (undefined without a chain: no Snapshot tab)
  - `AirdropScreenProps` gains `snapshotChainIds: number[]` and `sample: boolean`; the Airdrop page exports `maxDuration = 300`

- [ ] **Step 1: Write the failing test**

In `apps/web/src/components/manage/snapshot.test.ts`, replace:

```ts
import { describe, expect, it } from 'vitest'
import { holdersToText, snapshotAddressError } from './snapshot'

const A = '0x5e1f0c9b8a7d6e5f4c3b2a1908f7e6d5c4b3a291' as const
```

with:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { holdersToText, sampleFetchHolders, snapshotAddressError } from './snapshot'

const A = '0x5e1f0c9b8a7d6e5f4c3b2a1908f7e6d5c4b3a291' as const
```

In `apps/web/src/components/manage/snapshot.test.ts`, replace:

```ts
    expect(snapshotAddressError('0x5E1F0c9b8a7d6e5f4c3b2a1908f7e6d5c4b3a291')).toMatch(/checksum/)
  })
})

```

with:

```ts
    expect(snapshotAddressError('0x5E1F0c9b8a7d6e5f4c3b2a1908f7e6d5c4b3a291')).toMatch(/checksum/)
  })
})

describe('sampleFetchHolders', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('answers 24 holders after 900 ms, the most tokens first, at block 21,500,000, their tokens as the supply', async () => {
    const pending = sampleFetchHolders(8453, A)
    await vi.advanceTimersByTimeAsync(900)
    const result = await pending
    if (!result.ok) throw new Error(result.error)
    expect(result.data.holders).toHaveLength(24)
    expect(result.data.block).toBe(21_500_000)
    expect(result.data.supply).toBe(result.data.holders.reduce((sum, holder) => sum + holder.balance, 0))
    const balances = result.data.holders.map((holder) => holder.balance)
    expect(balances).toEqual([...balances].sort((a, b) => b - a))
  })
})

```

- [ ] **Step 2: Run the test to see it fail**

Run: `pnpm --filter @cobweb/web exec vitest run src/components/manage/snapshot.test.ts`
Expected: FAIL, one test, with `TypeError: sampleFetchHolders is not a function`.

- [ ] **Step 3: The sample read, the shared source and the tab**

Replace the whole of `apps/web/src/components/manage/snapshot.ts` with:

```ts
import { getAddress, isAddress } from 'viem'
import type { ActionResult } from '@/lib/art/result'
import { sampleAddress } from '@/lib/demo'
import type { Holder, HolderSnapshot } from '@/lib/manage/holders'

export type { Holder } from '@/lib/manage/holders'

/** Each holder's amount: the tokens they hold (legacy's default), or one number for everyone. */
export type SnapshotAmount = { kind: 'balance' } | { kind: 'fixed'; amount: number }

/**
 * Holders as recipient lines (`address,amount`), the most tokens first, as legacy listed them.
 * Holders with a zero balance are left out; balances above `maxAmount` are capped to it.
 */
export function holdersToText(holders: Holder[], amount: SnapshotAmount, maxAmount: number): string {
  return [...holders]
    .filter((holder) => holder.balance > 0)
    .sort((a, b) => b.balance - a.balance || a.address.localeCompare(b.address))
    .map((holder) => {
      const value = amount.kind === 'fixed' ? amount.amount : Math.min(holder.balance, maxAmount)
      return `${holder.address},${value}`
    })
    .join('\n')
}

/** Why a contract address cannot be snapshotted, or null. */
export function snapshotAddressError(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return 'Enter the address of the collection to snapshot.'
  if (!isAddress(trimmed))
    return /^0x[0-9a-fA-F]{40}$/.test(trimmed)
      ? 'The checksum does not match. Check the address for a typo.'
      : 'Enter a full 0x address, 42 characters.'
  return null
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** The block sample mode's snapshot reads at. */
export const SAMPLE_SNAPSHOT_BLOCK = 21_500_000

/**
 * Sample mode's holder snapshot (docs/specs/2026-10-15-whitelist.md, section 8): after 900 ms, a stable list of
 * 24 holders for the address and chain, the most tokens first, at block 21,500,000, their tokens together as the
 * supply. The real one is the `fetchHolders` action (app/actions/snapshot.ts), which reads the chain at one block.
 */
export async function sampleFetchHolders(
  chainId: number,
  contract: string,
): Promise<ActionResult<HolderSnapshot>> {
  await wait(900)
  const seed = Number.parseInt(getAddress(contract).slice(2, 10), 16) + chainId
  const holders: Holder[] = []
  for (let index = 0; index < 24; index++) {
    const balance = 1 + ((seed + index * 7) % 5 === 0 ? 4 : (seed + index) % 3)
    holders.push({ address: getAddress(sampleAddress(seed + index)), balance })
  }
  holders.sort(
    (a, b) => b.balance - a.balance || a.address.toLowerCase().localeCompare(b.address.toLowerCase()),
  )
  return {
    ok: true,
    data: {
      holders,
      block: SAMPLE_SNAPSHOT_BLOCK,
      supply: holders.reduce((sum, holder) => sum + holder.balance, 0),
    },
  }
}
```

Create `apps/web/src/components/manage/snapshot-source.ts`:

```ts
import { fetchHolders } from '@/app/actions/snapshot'
import { chainView } from '@/lib/chain/chain-view'
import { sampleFetchHolders } from './snapshot'
import type { SnapshotSource } from './snapshot-tab'

/**
 * The holder snapshot the shared recipients input offers on Whitelist and Airdrop
 * (docs/specs/2026-10-15-whitelist.md, section 7.2): the chains the server can read, the preferred one first
 * selected when offered (else the first), and the `fetchHolders` action bound to the collection, or the sample's
 * snapshot in sample mode. Without a chain to read there is no Snapshot tab.
 */
export function snapshotSource(input: {
  collectionId: string
  sample: boolean
  chainIds: number[]
  preferred: number
}): SnapshotSource | undefined {
  const [first] = input.chainIds
  if (first === undefined) return undefined
  return {
    chains: input.chainIds.map(chainView),
    chainId: input.chainIds.includes(input.preferred) ? input.preferred : first,
    fetch: input.sample
      ? sampleFetchHolders
      : (chainId, contract) => fetchHolders(input.collectionId, chainId, contract),
  }
}
```

Replace the whole of `apps/web/src/components/manage/snapshot-tab.tsx` with:

```tsx
'use client'

import { CameraIcon } from 'lucide-react'
import { useId, useState } from 'react'
import { Button } from '@cobweb/ui/components/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@cobweb/ui/components/field'
import { Input } from '@cobweb/ui/components/input'
import { RadioGroup, RadioGroupItem } from '@cobweb/ui/components/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cobweb/ui/components/select'
import { Spinner } from '@cobweb/ui/components/spinner'
import { ChainName } from '@/components/chains/chain-icon'
import { NO_HOLDERS, SNAPSHOT_FAILED, type ActionResult } from '@/lib/art/result'
import { shortAddress, type SupportedChain } from '@/lib/demo'
import type { HolderSnapshot } from '@/lib/manage/holders'
import { count } from './format'
import { holdersToText, snapshotAddressError, type SnapshotAmount } from './snapshot'

/**
 * Where a snapshot reads (docs/specs/2026-10-15-whitelist.md, section 7.2): the chains offered, the one selected
 * first, and the read itself, the `fetchHolders` action or the sample's.
 */
export type SnapshotSource = {
  chains: SupportedChain[]
  chainId: number
  fetch(chainId: number, contract: string): Promise<ActionResult<HolderSnapshot>>
}

/**
 * "Snapshot holders of a contract": every current holder of another collection becomes a line,
 * with the tokens they hold or one fixed amount (legacy's "Address Token Balance" and "User Set").
 * The lines join the same text the other tabs edit, so the preview and checks apply as usual.
 */
export function SnapshotTab({
  source,
  amountName,
  maxAmount,
  onLoaded,
}: {
  source: SnapshotSource
  amountName: string
  maxAmount: number
  onLoaded: (lines: string, summary: string) => void
}) {
  const id = useId()
  const [chainId, setChainId] = useState(String(source.chainId))
  const [contract, setContract] = useState('')
  const [touched, setTouched] = useState(false)
  const [mode, setMode] = useState<SnapshotAmount['kind']>('balance')
  const [fixed, setFixed] = useState('1')
  const [loading, setLoading] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const addressError = snapshotAddressError(contract)
  const fixedValue = Number(fixed)
  const fixedError =
    mode === 'fixed' && (!/^\d+$/.test(fixed) || fixedValue < 1 || fixedValue > maxAmount)
      ? `Enter a whole number from 1 to ${count(maxAmount)}.`
      : null
  const chain = source.chains.find((entry) => String(entry.id) === chainId)

  async function take() {
    setTouched(true)
    if (addressError || fixedError || !chain) return
    setLoading(true)
    setFailure(null)
    try {
      const result = await source.fetch(chain.id, contract.trim())
      if (!result.ok) {
        setFailure(result.error)
        return
      }
      const { holders, block } = result.data
      if (holders.length === 0) {
        setFailure(NO_HOLDERS)
        return
      }
      const amount: SnapshotAmount =
        mode === 'fixed' ? { kind: 'fixed', amount: fixedValue } : { kind: 'balance' }
      onLoaded(
        holdersToText(holders, amount, maxAmount),
        `${count(holders.length)} holders of ${shortAddress(contract.trim(), 4)} on ${chain.name} at block ${block}`,
      )
    } catch {
      setFailure(SNAPSHOT_FAILED)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="grid gap-4">
      <p className="text-muted-foreground text-[0.8125rem]">
        Adds every current holder of another collection. Large collections take a minute: each token&apos;s
        owner is read from the chain.
      </p>
      <div className="grid gap-3 sm:grid-cols-[11rem_1fr]">
        <Field>
          <FieldLabel htmlFor={`${id}-chain`}>Chain</FieldLabel>
          <Select value={chainId} onValueChange={setChainId}>
            <SelectTrigger id={`${id}-chain`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {source.chains.map((entry) => (
                <SelectItem key={entry.id} value={String(entry.id)}>
                  <ChainName chain={entry} iconClassName="size-3.5" />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field data-invalid={touched && !!addressError}>
          <FieldLabel htmlFor={`${id}-contract`}>Contract address</FieldLabel>
          <Input
            id={`${id}-contract`}
            value={contract}
            onChange={(event) => setContract(event.target.value)}
            onBlur={() => setTouched(true)}
            placeholder="0x..."
            autoComplete="off"
            spellCheck={false}
            className="numeric"
            aria-invalid={touched && !!addressError}
          />
          {touched && addressError && <FieldError>{addressError}</FieldError>}
        </Field>
      </div>
      <Field>
        <FieldLabel>{amountName === 'quota' ? 'Quota for each holder' : 'Tokens for each holder'}</FieldLabel>
        <RadioGroup value={mode} onValueChange={(value) => setMode(value as SnapshotAmount['kind'])}>
          <label htmlFor={`${id}-balance`} className="flex items-start gap-3 text-sm">
            <RadioGroupItem id={`${id}-balance`} value="balance" className="mt-0.5" />
            <span>
              The tokens they hold
              <span className="text-muted-foreground block text-[0.8125rem]">
                A holder of 3 gets 3, up to {count(maxAmount)}.
              </span>
            </span>
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <label htmlFor={`${id}-fixed`} className="flex items-center gap-3 text-sm">
              <RadioGroupItem id={`${id}-fixed`} value="fixed" />
              The same for everyone
            </label>
            {mode === 'fixed' && (
              <Input
                aria-label={`${amountName} for every holder`}
                type="number"
                min={1}
                max={maxAmount}
                value={fixed}
                onChange={(event) => setFixed(event.target.value)}
                className="numeric w-24"
                aria-invalid={!!fixedError}
              />
            )}
          </div>
        </RadioGroup>
        {fixedError && <FieldError>{fixedError}</FieldError>}
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" onClick={take} disabled={loading}>
          {loading ? <Spinner /> : <CameraIcon aria-hidden="true" />}
          {loading ? 'Taking snapshot' : 'Take snapshot'}
        </Button>
        {chain && (
          <FieldDescription className="text-[0.8125rem]">
            Reads <ChainName chain={chain} className="text-foreground" iconClassName="size-3" /> now. Holders
            who buy later are not added.
          </FieldDescription>
        )}
      </div>
      {failure && <FieldError>{failure}</FieldError>}
    </div>
  )
}
```

- [ ] **Step 4: Airdrop's snapshot on the real action**

`AirdropScreen` builds its source from the server's chains (its preferred chain is its own); nothing else in Airdrop changes, and the seam comment over `SUPPORTED_CHAINS` goes with the import.

In `apps/web/src/components/manage/airdrop-screen.tsx`, replace:

```tsx
  sampleSupply,
  DEMO_COLLECTION,
  // Seam: the launch chains come from `packages/shared` chain config in Phase 5.
  SUPPORTED_CHAINS,
} from '@/lib/demo'
import {
```

with:

```tsx
  sampleSupply,
  DEMO_COLLECTION,
} from '@/lib/demo'
import {
```

In `apps/web/src/components/manage/airdrop-screen.tsx`, replace:

```tsx
import { ParsePreview, RecipientsInput } from './recipients-input'
import { SAMPLE, sampleRequest } from './manage-sim'
import { TransactionDialog } from './transaction-dialog'

```

with:

```tsx
import { ParsePreview, RecipientsInput } from './recipients-input'
import { SAMPLE, sampleRequest } from './manage-sim'
import { snapshotSource } from './snapshot-source'
import { TransactionDialog } from './transaction-dialog'

```

In `apps/web/src/components/manage/airdrop-screen.tsx`, replace:

```tsx
  airdrops: AirdropRecord[]
  totalMinted: number
}

```

with:

```tsx
  airdrops: AirdropRecord[]
  totalMinted: number
  /** The chains the holder snapshot can read (the server's `snapshotChains()`, every sample chain in sample mode). */
  snapshotChainIds: number[]
  /** Sample mode: the snapshot answers the sample's holders. */
  sample: boolean
}

```

In `apps/web/src/components/manage/airdrop-screen.tsx`, replace:

```tsx
  collection,
  chain,
}: AirdropScreenProps) {
  const [text, setText] = useState('')
```

with:

```tsx
  collection,
  chain,
  snapshotChainIds,
  sample,
}: AirdropScreenProps) {
  const [text, setText] = useState('')
```

In `apps/web/src/components/manage/airdrop-screen.tsx`, replace:

```tsx
  const [burnDialog, setBurnDialog] = useState<{ key: number; amount: number } | null>(null)
  const [burnOpen, setBurnOpen] = useState(false)

  const symbol = chain.nativeSymbol
```

with:

```tsx
  const [burnDialog, setBurnDialog] = useState<{ key: number; amount: number } | null>(null)
  const [burnOpen, setBurnOpen] = useState(false)
  const snapshot = useMemo(
    () =>
      snapshotSource({
        collectionId: collection.id,
        sample,
        chainIds: snapshotChainIds,
        preferred: chain.id,
      }),
    [collection.id, sample, snapshotChainIds, chain.id],
  )

  const symbol = chain.nativeSymbol
```

In `apps/web/src/components/manage/airdrop-screen.tsx`, replace:

```tsx
                options={PARSE}
                template={TEMPLATE}
                snapshot={{ chains: SUPPORTED_CHAINS, chainId: chain.id }}
              />
              <ParsePreview result={result} amountName="tokens" />
```

with:

```tsx
                options={PARSE}
                template={TEMPLATE}
                snapshot={snapshot}
              />
              <ParsePreview result={result} amountName="tokens" />
```

Replace the whole of `apps/web/src/app/collections/[id]/manage/airdrop/page.tsx` with:

```tsx
import { AirdropScreen } from '@/components/manage/airdrop-screen'
import { StagePage } from '@/components/shell/stage-page'
import { requireOwnedCollection } from '@/lib/auth'
import {
  DEMO_AIRDROPS,
  DEMO_COLLECTION,
  DEMO_DEPLOYMENT,
  getChain,
  sampleSupply,
  scaleSampleToSupply,
  SUPPORTED_CHAINS,
} from '@/lib/demo'
import { snapshotChains } from '@/lib/manage/snapshot-core'
import { LockedStagePage, stageContext, type CollectionParams } from '../../_lib/stage'

/** The holder snapshot runs as a server action from this page: up to 20,000 `ownerOf` reads. */
export const maxDuration = 300

/**
 * Manage drop, airdrop. Sample data until the contract reads and writes are wired (the fourth sub-project); the
 * holder snapshot reads the chain (docs/specs/2026-10-15-whitelist.md, section 7.2), or the sample in sample mode.
 */
export default async function Page({ params }: { params: CollectionParams }) {
  const { id } = await params
  const collection = await requireOwnedCollection(id)
  const ctx = stageContext(collection, 'manage', 'manage')
  if (ctx.access === 'locked') return <LockedStagePage collection={collection} stage="manage" />
  const chain = getChain(DEMO_DEPLOYMENT.chainId)!

  return (
    <StagePage
      title="Airdrop"
      description="Send tokens straight to wallets, or burn some. Each token costs the airdrop fee and uses collection supply."
      width="default"
    >
      <AirdropScreen
        collection={collection}
        deployment={DEMO_DEPLOYMENT}
        chain={chain}
        airdrops={DEMO_AIRDROPS}
        // Seam: the minted total comes from the freshness server once Phase 6 lands.
        totalMinted={
          scaleSampleToSupply(sampleSupply(collection.max_supply, DEMO_COLLECTION.maxSupply)).totalMinted
        }
        snapshotChainIds={ctx.demo ? SUPPORTED_CHAINS.map((entry) => entry.id) : snapshotChains()}
        sample={ctx.demo}
      />
    </StagePage>
  )
}
```

- [ ] **Step 5: The Whitelist screen until Task 9**

The current Whitelist screen builds its own snapshot source; it reads the sample until Task 9 puts the screen on the view.

In `apps/web/src/components/manage/whitelist-screen.tsx`, replace:

```tsx
import { count, downloadText } from './format'
import { toCsv } from './recipients'
import { AddAddressesDialog, QuotaForAllDialog, WriteChunkDialog } from './whitelist-dialogs'
import { WhitelistChunks } from './whitelist-chunks'
```

with:

```tsx
import { count, downloadText } from './format'
import { toCsv } from './recipients'
import { sampleFetchHolders } from './snapshot'
import { AddAddressesDialog, QuotaForAllDialog, WriteChunkDialog } from './whitelist-dialogs'
import { WhitelistChunks } from './whitelist-chunks'
```

In `apps/web/src/components/manage/whitelist-screen.tsx`, replace:

```tsx
        group={group}
        existing={new Set(list.entries.map((entry) => entry.address.toLowerCase()))}
        snapshot={{ chains: SUPPORTED_CHAINS, chainId: chain.id }}
        onAdd={(rows) => {
          // SEAM: the rows are saved to `whitelist_entries` by a server action before the chunk write.
```

with:

```tsx
        group={group}
        existing={new Set(list.entries.map((entry) => entry.address.toLowerCase()))}
        snapshot={{ chains: SUPPORTED_CHAINS, chainId: chain.id, fetch: sampleFetchHolders }}
        onAdd={(rows) => {
          // SEAM: the rows are saved to `whitelist_entries` by a server action before the chunk write.
```

- [ ] **Step 6: Run the test, typecheck and lint**

Run: `pnpm --filter @cobweb/web exec vitest run src/components/manage/snapshot.test.ts`
Expected: PASS, 5 tests.

Run: `pnpm --filter @cobweb/web typecheck && pnpm --filter @cobweb/web lint`
Expected: no output from `tsc`, no problem from ESLint.

- [ ] **Step 7: Format, run the root checks and commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
pnpm exec prettier --write apps/web/src/components/manage/snapshot.ts apps/web/src/components/manage/snapshot.test.ts apps/web/src/components/manage/snapshot-source.ts apps/web/src/components/manage/snapshot-tab.tsx apps/web/src/components/manage/airdrop-screen.tsx "apps/web/src/app/collections/[id]/manage/airdrop/page.tsx" apps/web/src/components/manage/whitelist-screen.tsx
pnpm typecheck && pnpm lint && pnpm test
git add apps/web/src/components/manage/snapshot.ts apps/web/src/components/manage/snapshot.test.ts apps/web/src/components/manage/snapshot-source.ts apps/web/src/components/manage/snapshot-tab.tsx apps/web/src/components/manage/airdrop-screen.tsx "apps/web/src/app/collections/[id]/manage/airdrop/page.tsx" apps/web/src/components/manage/whitelist-screen.tsx
git commit -m "$(cat <<'EOF'
Put the holder snapshot input on the server action, with the chains the server can read, for Airdrop now and Whitelist next

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: the web package reports 575 tests (574 before: 1 added).

---

### Task 9: The Whitelist tab on the view: the local model, the dialogs, the chunks, the table, the screen and the page

**Files:**

- Modify: `apps/web/src/components/manage/whitelist-model.ts` (whole file, rewritten on `GroupList`)
- Create: `apps/web/src/components/manage/whitelist-model.test.ts`
- Modify: `apps/web/src/components/manage/whitelist-dialogs.tsx` (whole file)
- Modify: `apps/web/src/components/manage/whitelist-chunks.tsx` (whole file: `WhitelistChunks` on chunk rows, `PendingChunkPanel`)
- Modify: `apps/web/src/components/manage/whitelist-table.tsx` (whole file)
- Modify: `apps/web/src/components/manage/whitelist-screen.tsx` (whole file)
- Modify: `apps/web/src/app/collections/[id]/manage/whitelist/page.tsx` (whole file)
- Modify: `apps/web/src/components/manage/manage-context.tsx` (the comment: Whitelist provides its own actions)
- Test: `apps/web/src/components/manage/whitelist-model.test.ts`; typecheck, lint, test and build

**Interfaces:**

- Consumes: from Task 3, the types of `whitelist-types.ts`, `byAddress`, `isWritten`, `listOf`, `chunkPlanOf`, `WHITELIST_CHUNK`, `WHITELIST_MAX`, `QUOTA_MAX`, `USAGE_PAGE` (`@/lib/manage/whitelist-view`), `THROWN`; from Task 4, `phaseCalls.quotas` and `reviewOf(call, chain)` (`@/lib/manage/phase-calls`); from Task 5, `getWhitelist(collectionId)` (`@/app/actions/whitelist`) and `snapshotChains()` (`@/lib/manage/snapshot-core`); from Task 6, `rememberChunk`, `sentChunk`, `forgetChunk`, `runManage` (`./manage-machine`), `WhitelistServer` and `whitelistServer(collectionId)` (`./whitelist-server`), `sampleWhitelistView`, `sampleWhitelistServer`, `sampleSentChunk` (`./whitelist-sim`); from Task 8, `SnapshotSource` (`./snapshot-tab`) and `snapshotSource(input)` (`./snapshot-source`). Already in the repo: `TransactionDialog` (`./transaction-dialog`; `request`, `onConfirmed` and `onFailed`, which fire even after the dialog closed), `ManageRequest<T>` and `realManageActions(config, target)` (`./manage-actions`), `ManageActionsProvider`, `ManageTarget`, `useManageActions()` (`./manage-context`), `sampleManageActions(current, sent)` and `samplePhasesView(collection)` (`./manage-sim`), `UNREADABLE_REASON` (`./phase-row`), `parseRecipients`, `toCsv`, `Recipient`, `ParseOptions` (`./recipients`), `RecipientsInput`, `ParsePreview` (`./recipients-input`), `CopyButton`, `Pager` (`./bits`), `count`, `downloadText`, `relativeTo` (`./format`), `browserStore()`, `deployReducer`, `DeployEvent` (`@/components/deploy/deploy-machine`), `classifyError` (`@/components/deploy/tx-errors`), `TxProgress`, `TX_IDLE`, `isTxRunning`, `TxFailure` (`@/components/deploy/tx-progress`), `useChainClock(blockTimestamp)` (`@/components/mint/use-chain-clock`), `chainView` (`@/lib/chain/chain-view`), `manageTabHref(collectionId, tab)` (`@/lib/steps`), `explorerTxUrl`, `shortAddress`, `MintGroup`, `SupportedChain`, `SUPPORTED_CHAINS` (`@/lib/demo`), `ManageUnavailable`, `StagePage`, `requireOwnedCollection`, `requireUser`, `stageContext`, `searchParam`, `LockedStagePage`, and the `@cobweb/ui` components the old screen used.
- Produces:
  - in `./whitelist-model`: `EntryState = 'written' | 'pending' | 'removing'`, `entryState(entry: ListEntry): EntryState`, `withAdded(list: GroupList, rows: ChunkEntry[]): GroupList`, `withQuota(list: GroupList, address: Address, quota: number): GroupList`, `withQuotaForAll(list: GroupList, quota: number): GroupList`, `withRemoved(list: GroupList, address: Address): GroupList`, `withRestored(list: GroupList, entry: ListEntry): GroupList`, `capRoom(existing: Set<string>, rows: { address: string }[]): { fresh: number; room: number }`, `ChunkRow = { number: number; addresses: number; status: 'written' | 'next' | 'failed' | 'waiting'; txHash?: Hex; error?: string }`, `chunkRows(list: GroupList, size: number, failure: string | null): ChunkRow[]`
  - in `./whitelist-dialogs`: `WHITELIST_PARSE`, `WHITELIST_TEMPLATE`, `chunkRequest(plan: ChunkPlan, chain: SupportedChain, confirm: (hash: Hex) => Promise<ActionResult<WhitelistView>>, pending: { remember(hash: Hex): void; forget(): void }): ManageRequest<WhitelistView>`, `AddAddressesDialog(props: { open; onOpenChange; group: MintGroup; existing: Set<string>; snapshot: SnapshotSource | undefined; onAdd(rows: Recipient[]): Promise<string | null> })`, `QuotaForAllDialog(props: { open; onOpenChange; total: number; onApply(quota: number): Promise<string | null> })`, `WriteChunkDialog(props: { open; onOpenChange; chain: SupportedChain; group: MintGroup; plan: ChunkPlan; retry: boolean; request: ManageRequest<WhitelistView>; onConfirmed(view: WhitelistView): void; onFailed(message: string): void })`
  - in `./whitelist-chunks`: `WhitelistChunks(props: { rows: ChunkRow[]; list: GroupList; chain: SupportedChain; write: { label: string; off: string | null; busy: boolean } | null; onWrite(): void })`, `PendingChunkPanel(props: { sent: SentChunk; group: MintGroup | undefined; chain: SupportedChain; server: WhitelistServer; onView(view: WhitelistView): void; onForget(): void })`
  - in `./whitelist-table`: `WhitelistTable(props: { entries: ListEntry[]; usage: { key: readonly unknown[]; on: boolean; read(addresses: Address[]): Promise<(number | null)[]> }; onQuota(address: Address, quota: number): void; onRemove(address: Address): void; onRestore(entry: ListEntry): void; toolbar?: React.ReactNode })`
  - in `./whitelist-screen`: `WhitelistScreenProps = { collection: Tables<'collections'>; view: WhitelistView; wallet: Address; sample: boolean; samplePending?: boolean; snapshotChainIds: number[] }`, `WhitelistScreen(props: WhitelistScreenProps)`
  - the Whitelist page on real data: `maxDuration = 300`; the sample view in sample mode (`?chain=unreachable`, `?chunk=pending`)

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/manage/whitelist-model.test.ts`:

```ts
import type { Address, Hex } from 'viem'
import { describe, expect, it } from 'vitest'
import type { GroupList, ListEntry, WrittenChunk } from '@/lib/manage/whitelist-types'
import { chunkPlanOf, listOf } from '@/lib/manage/whitelist-view'
import {
  capRoom,
  chunkRows,
  entryState,
  withAdded,
  withQuota,
  withQuotaForAll,
  withRemoved,
  withRestored,
  type ChunkRow,
} from './whitelist-model'

// In lowercase address order: 0x15d3, 0x3c44, 0x7099, 0x90f7.
const FIRST: Address = '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65'
const SECOND: Address = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
const THIRD: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const FOURTH: Address = '0x90F79bf6EB2c4f870365E785982E1f101E93b906'
const TX: Hex = `0x${'a1'.repeat(32)}`
const LATER: Hex = `0x${'b2'.repeat(32)}`

const entry = (
  address: Address,
  quota: number,
  writtenQuota: number | null = null,
  writtenTx: Hex | null = null,
): ListEntry => ({
  address,
  quota,
  writtenQuota,
  writtenTx,
})
const chunks: WrittenChunk[] = [
  { txHash: TX, addresses: 2, writtenAt: 1 },
  { txHash: LATER, addresses: 1, writtenAt: 2 },
]
/** SECOND written at 2, THIRD written at 1 and listed at 3 now, FOURTH never written. */
const list: GroupList = listOf(
  1,
  [entry(SECOND, 2, 2, TX), entry(THIRD, 3, 1, LATER), entry(FOURTH, 1)],
  4,
  chunks,
)

describe('entryState', () => {
  it('reads written, waiting or a removal waiting for its zero', () => {
    expect(entryState(entry(FIRST, 2, 2, TX))).toBe('written')
    expect(entryState(entry(FIRST, 2, 1, TX))).toBe('pending')
    expect(entryState(entry(FIRST, 2))).toBe('pending')
    expect(entryState(entry(FIRST, 0, 2, TX))).toBe('removing')
  })
})

describe('the patches', () => {
  it('adds a new address in address order and changes a listed quota, keeping the copies, whatever the case', () => {
    const next = withAdded(list, [
      { address: FIRST, quota: 5 },
      { address: SECOND.toLowerCase() as Address, quota: 4 },
    ])
    expect(next.entries).toEqual<ListEntry[]>([
      entry(FIRST, 5),
      entry(SECOND, 4, 2, TX),
      entry(THIRD, 3, 1, LATER),
      entry(FOURTH, 1),
    ])
    expect(next).toMatchObject({ total: 4, written: 0, unwritten: 4, totalQuota: 13, quotaUsed: 4 })
  })

  it('re-adding a staged removal at its written quota reads it written again, with no chunk waiting (Review Focus 2)', () => {
    const staged = withRemoved(listOf(1, [entry(SECOND, 2, 2, TX)], 0, chunks), SECOND)
    expect(entryState(staged.entries[0]!)).toBe('removing')
    expect(chunkPlanOf(staged)?.entries).toEqual([{ address: SECOND, quota: 0 }])
    const back = withAdded(staged, [{ address: SECOND, quota: 2 }])
    expect(entryState(back.entries[0]!)).toBe('written')
    expect(back.unwritten).toBe(0)
    expect(chunkPlanOf(back)).toBeNull()
  })

  it('sets one quota, and reads it written again when it goes back to what the chain holds', () => {
    expect(withQuota(list, THIRD, 7).entries[1]).toEqual(entry(THIRD, 7, 1, LATER))
    const back = withQuota(list, THIRD, 1)
    expect(entryState(back.entries[1]!)).toBe('written')
    expect(back.written).toBe(2)
  })

  it('sets one quota for every entry above 0 and leaves a staged removal at 0', () => {
    const staged = withRemoved(list, SECOND)
    expect(withQuotaForAll(staged, 2).entries.map((candidate) => candidate.quota)).toEqual([0, 2, 2])
  })

  it('stages a written removal at 0 and drops a never-written one, recounting the chunks', () => {
    const staged = withRemoved(list, SECOND)
    expect(staged.entries[0]).toEqual(entry(SECOND, 0, 2, TX))
    expect(staged).toMatchObject({ total: 2, unwritten: 3 })
    const dropped = withRemoved(list, FOURTH)
    expect(dropped.entries.map((candidate) => candidate.address)).toEqual([SECOND, THIRD])
    const zeroWritten = listOf(1, [entry(SECOND, 2, 0, TX), entry(THIRD, 1, 1, TX)], 0, chunks)
    expect(withRemoved(zeroWritten, SECOND).chunks).toEqual<WrittenChunk[]>([
      { txHash: TX, addresses: 1, writtenAt: 1 },
    ])
  })

  it('puts an entry back in its place by address', () => {
    const dropped = withRemoved(list, FOURTH)
    expect(withRestored(dropped, entry(FOURTH, 1)).entries).toEqual(list.entries)
    const staged = withRemoved(list, SECOND)
    expect(withRestored(staged, entry(SECOND, 2, 2, TX)).entries).toEqual(list.entries)
  })
})

describe('capRoom', () => {
  it('counts a staged removal as a listed row against the cap (Review Focus 3)', () => {
    const existing = new Set([SECOND, THIRD].map((address) => address.toLowerCase()))
    expect(
      capRoom(existing, [{ address: FIRST }, { address: SECOND }, { address: FIRST.toLowerCase() }]),
    ).toEqual({
      fresh: 1,
      room: 9_998,
    })
    const staged = withRemoved(list, SECOND)
    expect(capRoom(new Set(staged.entries.map((candidate) => candidate.address.toLowerCase())), [])).toEqual({
      fresh: 0,
      room: 9_997,
    })
  })
})

describe('chunkRows', () => {
  it('lists the written chunks with their transactions, then the next and the waiting ones', () => {
    const waiting = listOf(
      1,
      Array.from({ length: 1_100 }, (_, index) =>
        entry(`0x${(index + 1).toString(16).padStart(40, '0')}`, 1),
      ),
      0,
      [],
    )
    expect(chunkRows(waiting, 500, null)).toEqual<ChunkRow[]>([
      { number: 1, addresses: 500, status: 'next' },
      { number: 2, addresses: 500, status: 'waiting' },
      { number: 3, addresses: 100, status: 'waiting' },
    ])
    expect(chunkRows(list, 500, null)).toEqual<ChunkRow[]>([
      { number: 1, addresses: 1, status: 'written', txHash: TX },
      { number: 2, addresses: 1, status: 'written', txHash: LATER },
      { number: 3, addresses: 2, status: 'next' },
    ])
  })

  it('marks the next chunk failed with its error after a failure in this visit', () => {
    expect(chunkRows(list, 500, 'Cancelled in your wallet')[2]).toEqual<ChunkRow>({
      number: 3,
      addresses: 2,
      status: 'failed',
      error: 'Cancelled in your wallet',
    })
    expect(chunkRows(listOf(1, [entry(SECOND, 2, 2, TX)], 0, chunks), 500, 'Failed')).toEqual<ChunkRow[]>([
      { number: 1, addresses: 1, status: 'written', txHash: TX },
    ])
  })
})
```

- [ ] **Step 2: Run the test to see it fail**

Run: `pnpm --filter @cobweb/web exec vitest run src/components/manage/whitelist-model.test.ts`
Expected: FAIL, 10 tests, each with a `TypeError` naming the new model's functions (`entryState is not a function`, `capRoom is not a function`, and so on): today's model exports none of them.

- [ ] **Step 3: The local model**

Replace the whole of `apps/web/src/components/manage/whitelist-model.ts` with:

```ts
import type { Address, Hex } from 'viem'
import type { ChunkEntry, GroupList, ListEntry } from '@/lib/manage/whitelist-types'
import { byAddress, isWritten, listOf, WHITELIST_MAX } from '@/lib/manage/whitelist-view'

/**
 * The Whitelist screen's local model (docs/specs/2026-10-15-whitelist.md, section 7.4): pure patches on a
 * group's list, applied once the server accepts an edit, each mirroring what the database did (section 4.2) and
 * counting again through `listOf`. Nothing here reaches the chain: an edit waits for the next chunk.
 */

/** How the table shows an entry: on chain as listed, waiting for a chunk, or a removal waiting for its zero. */
export type EntryState = 'written' | 'pending' | 'removing'

export function entryState(entry: ListEntry): EntryState {
  if (isWritten(entry)) return 'written'
  return entry.quota === 0 ? 'removing' : 'pending'
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** The list with new entries, counted again; entries stay in lowercase address order. */
function withEntries(list: GroupList, entries: ListEntry[]): GroupList {
  return listOf(list.onchainId, entries, list.quotaUsed, list.chunks)
}

/**
 * An add as `whitelist_entries_add` makes it: a new address joins with its quota and no copy; a listed one takes
 * the new quota (a staged removal gets its quota back) and keeps its copies.
 */
export function withAdded(list: GroupList, rows: ChunkEntry[]): GroupList {
  const entries = [...list.entries]
  for (const row of rows) {
    const at = entries.findIndex((entry) => same(entry.address, row.address))
    const listed = entries[at]
    if (listed) entries[at] = { ...listed, quota: row.quota }
    else entries.push({ address: row.address, quota: row.quota, writtenQuota: null, writtenTx: null })
  }
  return withEntries(list, entries.sort(byAddress))
}

/** One address's new quota. */
export function withQuota(list: GroupList, address: Address, quota: number): GroupList {
  return withEntries(
    list,
    list.entries.map((entry) => (same(entry.address, address) ? { ...entry, quota } : entry)),
  )
}

/** Set quota for all: every entry above 0 takes the quota; staged removals stay at 0. */
export function withQuotaForAll(list: GroupList, quota: number): GroupList {
  return withEntries(
    list,
    list.entries.map((entry) => (entry.quota > 0 ? { ...entry, quota } : entry)),
  )
}

/** A removal: an entry the chain never held (or holds at 0) leaves at once; a written one is staged at 0. */
export function withRemoved(list: GroupList, address: Address): GroupList {
  return withEntries(
    list,
    list.entries.flatMap((entry): ListEntry[] => {
      if (!same(entry.address, address)) return [entry]
      return entry.writtenQuota ? [{ ...entry, quota: 0 }] : []
    }),
  )
}

/** An entry put back as given (Undo, or Keep on a staged removal), in its place by address. */
export function withRestored(list: GroupList, entry: ListEntry): GroupList {
  const others = list.entries.filter((candidate) => !same(candidate.address, entry.address))
  return withEntries(list, [...others, entry].sort(byAddress))
}

/**
 * Room for an add under the 10,000 cap: the rows it would create (addresses not listed) and how many more the
 * list holds. A staged removal is still a row until its zero is written, so it counts.
 */
export function capRoom(existing: Set<string>, rows: { address: string }[]): { fresh: number; room: number } {
  const fresh = new Set(
    rows.map((row) => row.address.toLowerCase()).filter((address) => !existing.has(address)),
  ).size
  return { fresh, room: Math.max(0, WHITELIST_MAX - existing.size) }
}

/** One row of the On-chain write panel: a chunk written, the next one (or the one that failed), or one waiting. */
export type ChunkRow = {
  number: number
  addresses: number
  status: 'written' | 'next' | 'failed' | 'waiting'
  txHash?: Hex
  error?: string
}

/**
 * The chunks as the panel lists them: the written ones with their transactions, then what the unwritten entries
 * need, `size` at a time, the first marked failed with its error after a failure in this visit.
 */
export function chunkRows(list: GroupList, size: number, failure: string | null): ChunkRow[] {
  const rows: ChunkRow[] = list.chunks.map((chunk, index) => ({
    number: index + 1,
    addresses: chunk.addresses,
    status: 'written',
    txHash: chunk.txHash,
  }))
  const written = rows.length
  for (let from = 0; from < list.unwritten; from += size) {
    const first = from === 0
    rows.push({
      number: written + from / size + 1,
      addresses: Math.min(size, list.unwritten - from),
      status: first ? (failure ? 'failed' : 'next') : 'waiting',
      ...(first && failure ? { error: failure } : {}),
    })
  }
  return rows
}
```

Run: `pnpm --filter @cobweb/web exec vitest run src/components/manage/whitelist-model.test.ts`
Expected: PASS, 10 tests. (The typecheck fails until Step 5: today's dialogs, chunks, table and screen still import the old model.)

- [ ] **Step 4: The dialogs, the chunks panel and the table**

Replace the whole of `apps/web/src/components/manage/whitelist-dialogs.tsx` with:

```tsx
'use client'

import { useDeferredValue, useId, useMemo, useState } from 'react'
import type { Hex } from 'viem'
import { Button } from '@cobweb/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@cobweb/ui/components/dialog'
import { Field, FieldDescription, FieldError, FieldLabel } from '@cobweb/ui/components/field'
import { Input } from '@cobweb/ui/components/input'
import { Spinner } from '@cobweb/ui/components/spinner'
import type { ActionResult } from '@/lib/art/result'
import type { MintGroup, SupportedChain } from '@/lib/demo'
import { phaseCalls, reviewOf } from '@/lib/manage/phase-calls'
import type { ChunkPlan, WhitelistView } from '@/lib/manage/whitelist-types'
import { QUOTA_MAX, WHITELIST_MAX } from '@/lib/manage/whitelist-view'
import { count } from './format'
import type { ManageRequest } from './manage-actions'
import { parseRecipients, type ParseOptions, type Recipient } from './recipients'
import { ParsePreview, RecipientsInput } from './recipients-input'
import type { SnapshotSource } from './snapshot-tab'
import { TransactionDialog } from './transaction-dialog'
import { capRoom } from './whitelist-model'

export const WHITELIST_PARSE: ParseOptions = {
  defaultAmount: 1,
  maxAmount: QUOTA_MAX,
  onDuplicate: 'last',
  amountName: 'quota',
}

export const WHITELIST_TEMPLATE = {
  fileName: 'whitelist-template.csv',
  text: 'address,quota\n0x5e1f0c9b8a7d6e5f4c3b2a1908f7e6d5c4b3a291,2\n0x3b9d2c1a0f8e7d6c5b4a39281706f5e4d3c2b1a0,1\n',
}

const addressesWord = (value: number) => `${count(value)} ${value === 1 ? 'address' : 'addresses'}`

/**
 * Add addresses from a CSV, pasted text, one at a time or a holder snapshot, with a preview before anything
 * changes (docs/specs/2026-10-15-whitelist.md, section 7.4). It waits for the server, shows a refusal under the
 * form, and closes once the rows are saved; the cap is checked before anything is sent.
 */
export function AddAddressesDialog({
  open,
  onOpenChange,
  group,
  existing,
  snapshot,
  onAdd,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  group: MintGroup
  /** Addresses already listed, lowercased, staged removals included: to say how many are updates, and the room left. */
  existing: Set<string>
  /** Where the Snapshot tab reads; none hides the tab. */
  snapshot: SnapshotSource | undefined
  /** Saves the rows; answers the refusal's sentence, or null once they are saved. */
  onAdd: (rows: Recipient[]) => Promise<string | null>
}) {
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const deferred = useDeferredValue(text)
  const result = useMemo(() => parseRecipients(deferred, WHITELIST_PARSE), [deferred])
  const updates = result.rows.filter((row) => existing.has(row.address.toLowerCase())).length
  const { fresh, room } = capRoom(existing, result.rows)
  const full = fresh > room
  const stale = deferred !== text

  function close(next: boolean) {
    if (saving) return
    if (!next) {
      setText('')
      setFailure(null)
    }
    onOpenChange(next)
  }

  async function add() {
    setSaving(true)
    setFailure(null)
    const refused = await onAdd(result.rows)
    setSaving(false)
    if (refused) return setFailure(refused)
    setText('')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add to {group.name}</DialogTitle>
          <DialogDescription>
            Addresses are checked and saved here first. They can mint once their chunk is written on chain.
          </DialogDescription>
        </DialogHeader>
        <RecipientsInput
          text={text}
          onTextChange={setText}
          options={WHITELIST_PARSE}
          template={WHITELIST_TEMPLATE}
          snapshot={snapshot}
        />
        <ParsePreview result={result} amountName="quota" />
        {updates > 0 && (
          <p className="text-muted-foreground text-[0.8125rem]">
            {count(updates)} {updates === 1 ? 'address is' : 'addresses are'} already listed;{' '}
            {updates === 1 ? 'its' : 'their'} quota will be replaced. Quota already used is kept by the
            contract.
          </p>
        )}
        {full && (
          <FieldError>
            A whitelist holds up to {count(WHITELIST_MAX)} addresses. This one has room for {count(room)}{' '}
            more.
          </FieldError>
        )}
        {failure && <FieldError>{failure}</FieldError>}
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)} disabled={saving}>
            Cancel
          </Button>
          <Button disabled={result.rows.length === 0 || stale || full || saving} onClick={() => void add()}>
            {saving && <Spinner />}
            {saving
              ? `Adding ${addressesWord(result.rows.length)}`
              : result.rows.length === 0
                ? 'Add addresses'
                : `Add ${addressesWord(result.rows.length)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** One quota for every address on the list, saved by Cobweb and written by the next chunks. */
export function QuotaForAllDialog({
  open,
  onOpenChange,
  total,
  onApply,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The addresses listed, staged removals left out. */
  total: number
  /** Saves the quota; answers the refusal's sentence, or null once it is saved. */
  onApply: (quota: number) => Promise<string | null>
}) {
  const id = useId()
  const [value, setValue] = useState('1')
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const quota = Number(value)
  const valid = /^\d+$/.test(value) && quota >= 1 && quota <= QUOTA_MAX

  function close(next: boolean) {
    if (saving) return
    if (!next) setFailure(null)
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <form
          className="grid gap-5"
          onSubmit={async (event) => {
            event.preventDefault()
            if (!valid || saving) return
            setSaving(true)
            setFailure(null)
            const refused = await onApply(quota)
            setSaving(false)
            if (refused) return setFailure(refused)
            onOpenChange(false)
          }}
        >
          <DialogHeader>
            <DialogTitle>Set one quota for all</DialogTitle>
            <DialogDescription>
              Every one of the {count(total)} addresses gets the same quota. Changed addresses are written
              again in the next chunks.
            </DialogDescription>
          </DialogHeader>
          <Field data-invalid={!valid}>
            <FieldLabel htmlFor={`${id}-quota`}>Quota</FieldLabel>
            <Input
              id={`${id}-quota`}
              type="number"
              min={1}
              max={QUOTA_MAX}
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
            {valid ? (
              <FieldDescription>
                Wallets that minted more than this keep their tokens and have nothing left.
              </FieldDescription>
            ) : (
              <FieldError>Enter a whole number from 1 to {count(QUOTA_MAX)}.</FieldError>
            )}
          </Field>
          {failure && <FieldError>{failure}</FieldError>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => close(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || saving}>
              {saving && <Spinner />}
              {saving ? 'Setting quota' : 'Set quota'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * A chunk as the dialog sends it (docs/specs/2026-10-15-whitelist.md, section 7.4): the server's plan as one
 * `setMintQuota` call, its review in counts, the server's confirm from the receipt and calldata, and the sent hash
 * kept until that confirm answers.
 */
export function chunkRequest(
  plan: ChunkPlan,
  chain: SupportedChain,
  confirm: (hash: Hex) => Promise<ActionResult<WhitelistView>>,
  pending: { remember(hash: Hex): void; forget(): void },
): ManageRequest<WhitelistView> {
  const call = phaseCalls.quotas(
    plan.onchainId,
    plan.entries.map((entry) => entry.address),
    plan.entries.map((entry) => entry.quota),
  )
  return {
    call,
    review: { contract: 'Collection', functionName: 'setMintQuota', args: reviewOf(call, chain) },
    confirm,
    pending,
  }
}

/** One `setMintQuota` transaction for the chunk the server built, on the manage machine. */
export function WriteChunkDialog({
  open,
  onOpenChange,
  chain,
  group,
  plan,
  retry,
  request,
  onConfirmed,
  onFailed,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  chain: SupportedChain
  group: MintGroup
  plan: ChunkPlan
  /** The last write of this group failed in this visit. */
  retry: boolean
  request: ManageRequest<WhitelistView>
  onConfirmed: (view: WhitelistView) => void
  onFailed: (message: string) => void
}) {
  const removals = plan.entries.filter((entry) => entry.quota === 0).length
  return (
    <TransactionDialog
      open={open}
      onOpenChange={onOpenChange}
      chain={chain}
      title={`Write chunk ${plan.number} of ${plan.of}`}
      description={`Sets the quota of ${addressesWord(plan.entries.length)} in ${group.name}. Sending a chunk twice is safe: quota already used is never granted again.`}
      actionLabel={retry ? 'Retry chunk' : 'Write chunk'}
      successMessage={`Chunk ${plan.number} is on chain`}
      request={request}
      onConfirmed={onConfirmed}
      onFailed={onFailed}
    >
      {removals > 0 && (
        <p className="text-muted-foreground text-sm">
          {count(removals)} {removals === 1 ? 'address is' : 'addresses are'} removed by setting the quota to
          0.
        </p>
      )}
    </TransactionDialog>
  )
}
```

Replace the whole of `apps/web/src/components/manage/whitelist-chunks.tsx` with:

```tsx
'use client'

import { ExternalLinkIcon, InfoIcon, RotateCwIcon, UploadIcon } from 'lucide-react'
import { useReducer } from 'react'
import { toast } from 'sonner'
import type { Hex } from 'viem'
import { Alert, AlertDescription, AlertTitle } from '@cobweb/ui/components/alert'
import { Button } from '@cobweb/ui/components/button'
import { Spinner } from '@cobweb/ui/components/spinner'
import { StatusBadge } from '@cobweb/ui/components/status-badge'
import { cn } from '@cobweb/ui/lib/utils'
import { deployReducer, type DeployEvent } from '@/components/deploy/deploy-machine'
import { classifyError } from '@/components/deploy/tx-errors'
import { isTxRunning, TX_IDLE, TxProgress, type TxFailure } from '@/components/deploy/tx-progress'
import { explorerTxUrl, shortAddress, type MintGroup, type SupportedChain } from '@/lib/demo'
import type { GroupList, SentChunk, WhitelistView } from '@/lib/manage/whitelist-types'
import { WHITELIST_CHUNK } from '@/lib/manage/whitelist-view'
import { count } from './format'
import { useManageActions } from './manage-context'
import { runManage } from './manage-machine'
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
 * The on-chain write (docs/specs/2026-10-15-whitelist.md, section 7.3): one block per `setMintQuota`
 * transaction, written with its transaction, the next one (or the one that failed, with its error), and the ones
 * waiting. The server builds each chunk from the entries not written, so a failure is resumed by writing again.
 */
export function WhitelistChunks({
  rows,
  list,
  chain,
  write,
  onWrite,
}: {
  rows: ChunkRow[]
  list: GroupList
  chain: SupportedChain
  /** The write button: its label, why it is off (or null), and whether it is asking for the chunk; null hides it. */
  write: { label: string; off: string | null; busy: boolean } | null
  onWrite: () => void
}) {
  const written = rows.filter((row) => row.status === 'written').length
  const failed = rows.some((row) => row.status === 'failed')
  const waiting = list.unwritten

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-sm">
            <span className="numeric text-lg">{count(written)}</span>
            <span className="text-muted-foreground"> of </span>
            <span className="numeric text-lg">{count(rows.length)}</span>
            <span className="text-muted-foreground"> chunks written</span>
          </p>
          <p className="text-muted-foreground text-[0.8125rem]">
            {waiting > 0
              ? `${count(waiting)} ${waiting === 1 ? 'address waits' : 'addresses wait'} for a chunk. Until it is written, the chain keeps the quota it had, or none.`
              : 'Every address is on chain.'}{' '}
            Up to {count(WHITELIST_CHUNK)} addresses go in each transaction.
          </p>
        </div>
        {write && (
          <Button
            onClick={onWrite}
            disabled={write.off !== null || write.busy}
            title={write.off ?? undefined}
          >
            {write.busy ? (
              <Spinner />
            ) : failed ? (
              <RotateCwIcon aria-hidden="true" />
            ) : (
              <UploadIcon aria-hidden="true" />
            )}
            {write.label}
          </Button>
        )}
      </div>
      {write?.off && <p className="text-muted-foreground -mt-3 text-[0.8125rem]">{write.off}</p>}

      {rows.length > 0 && (
        <ol aria-label="Chunks" className="flex gap-1">
          {rows.map((row) => (
            <li
              key={row.number}
              className={cn(
                'h-2 min-w-1 rounded-full',
                row.status === 'written'
                  ? 'bg-primary'
                  : row.status === 'failed'
                    ? 'bg-destructive'
                    : 'bg-well shadow-inset border border-dashed',
              )}
              style={{ flexGrow: row.addresses, flexBasis: 0 }}
            >
              <span className="sr-only">
                Chunk {row.number}, {row.addresses} addresses,{' '}
                {row.status === 'written' ? 'written' : row.status === 'failed' ? 'failed' : 'not written'}
              </span>
            </li>
          ))}
        </ol>
      )}

      {rows.length > 0 && (
        <ul className="divide-y rounded-lg border text-sm">
          {rows.map((row) => (
            <li key={row.number} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
              <span className="w-20 font-medium">Chunk {row.number}</span>
              <span className="numeric text-muted-foreground w-28">{count(row.addresses)} addresses</span>
              {row.status === 'written' ? (
                <StatusBadge status="done">Written</StatusBadge>
              ) : row.status === 'failed' ? (
                <StatusBadge status="error">Failed</StatusBadge>
              ) : (
                <StatusBadge status="draft">{row.status === 'next' ? 'Next' : 'Waiting'}</StatusBadge>
              )}
              {row.txHash && (
                <span className="ml-auto">
                  <TxLink chain={chain} hash={row.txHash} />
                </span>
              )}
              {row.error && (
                <span className="text-destructive-foreground basis-full text-[0.8125rem]">{row.error}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * A chunk this browser sent and Cobweb has not confirmed (section 7.3): "Check again" runs the manage machine
 * from its last step, which reads the receipt and the calldata on the server; "Discard" forgets it. A terminal
 * answer forgets it too, which closes this panel, so its sentence goes to a toast.
 */
export function PendingChunkPanel({
  sent,
  group,
  chain,
  server,
  onView,
  onForget,
}: {
  sent: SentChunk
  group: MintGroup | undefined
  chain: SupportedChain
  server: WhitelistServer
  onView: (view: WhitelistView) => void
  onForget: () => void
}) {
  const { chainId, wallet } = useManageActions()
  const [phase, dispatch] = useReducer(deployReducer, TX_IDLE)
  const running = isTxRunning(phase)

  async function check() {
    const last: { failure: TxFailure | null } = { failure: null }
    const report = (event: DeployEvent) => {
      if (event.type === 'failed') last.failure = event.failure
      dispatch(event)
    }
    let view: WhitelistView | null = null
    try {
      view = await runManage<WhitelistView>(
        { call: null, account: wallet, wallet, chainId, connectedChainId: chainId, sentHash: sent.hash },
        {
          switchChain: async () => {},
          simulate: () => Promise.reject(new Error('A sent chunk is checked, never sent again.')),
          wait: async () => 'success',
          confirm: (hash) => server.confirmChunk(hash, sent.onchainId),
          forget: onForget,
          sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
          now: () => Date.now(),
        },
        report,
      )
    } catch (error) {
      report({ type: 'failed', failure: classifyError(error, 'confirming', 'manage') })
    }
    if (view) {
      onView(view)
      toast.success('The chunk is on chain')
      return
    }
    if (last.failure?.kind === 'refused') toast.error(last.failure.message)
  }

  return (
    <Alert>
      <InfoIcon aria-hidden="true" />
      <AlertTitle>A chunk is waiting to be confirmed</AlertTitle>
      <AlertDescription>
        <p>
          This browser sent a chunk of the{' '}
          <span className="text-foreground">{group?.name ?? `Group ${sent.onchainId}`}</span> whitelist.
          Cobweb marks its addresses written once the receipt and the transaction show them on the contract.
        </p>
        <TxLink chain={chain} hash={sent.hash} label="Transaction" />
        {phase.step !== 'idle' && (
          <TxProgress
            phase={phase}
            steps={[
              {
                step: 'verifying',
                label: 'Reading the chunk',
                detail:
                  'Cobweb checks the receipt and the addresses the transaction carried, then reads the contract again.',
              },
            ]}
          />
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => void check()} disabled={running}>
            {running && <Spinner />}
            Check again
          </Button>
          <Button variant="ghost" size="sm" onClick={onForget} disabled={running}>
            Discard
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  )
}
```

Replace the whole of `apps/web/src/components/manage/whitelist-table.tsx` with:

```tsx
'use client'

import { useQuery } from '@tanstack/react-query'
import { PencilIcon, SearchIcon, Trash2Icon, Undo2Icon } from 'lucide-react'
import { useDeferredValue, useId, useState } from 'react'
import type { Address } from 'viem'
import { Button } from '@cobweb/ui/components/button'
import { Input } from '@cobweb/ui/components/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@cobweb/ui/components/input-group'
import { Popover, PopoverContent, PopoverTrigger } from '@cobweb/ui/components/popover'
import { StatusBadge } from '@cobweb/ui/components/status-badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@cobweb/ui/components/table'
import { ToggleGroup, ToggleGroupItem } from '@cobweb/ui/components/toggle-group'
import { cn } from '@cobweb/ui/lib/utils'
import type { ListEntry } from '@/lib/manage/whitelist-types'
import { QUOTA_MAX, USAGE_PAGE } from '@/lib/manage/whitelist-view'
import { CopyButton, Pager } from './bits'
import { count } from './format'
import { entryState } from './whitelist-model'

/** How long a page's minted counts stay fresh before the table asks the chain again. */
const USAGE_STALE_MS = 30_000

/**
 * A whitelist's addresses (docs/specs/2026-10-15-whitelist.md, section 7.3): search, All or Not written, 25 a
 * page, and per row the quota edit, the removal and Keep for a staged removal. Minted and Left are read from the
 * chain for the page on screen; until that read answers, Minted reads "Not read" and Left is blank.
 */
export function WhitelistTable({
  entries,
  usage,
  onQuota,
  onRemove,
  onRestore,
  toolbar,
}: {
  entries: ListEntry[]
  /** The page's minted counts: the query key's start, whether to read them (off while the chain cannot be read), and the read. */
  usage: { key: readonly unknown[]; on: boolean; read(addresses: Address[]): Promise<(number | null)[]> }
  onQuota: (address: Address, quota: number) => void
  onRemove: (address: Address) => void
  /** Keep: a staged removal goes back to the quota the chain holds. */
  onRestore: (entry: ListEntry) => void
  /** Actions shown at the right of the search row. */
  toolbar?: React.ReactNode
}) {
  const id = useId()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'waiting'>('all')
  const [page, setPage] = useState(0)
  const deferredQuery = useDeferredValue(query.trim().toLowerCase())

  const filtered = entries.filter(
    (entry) =>
      (filter === 'all' || entryState(entry) !== 'written') &&
      (!deferredQuery || entry.address.toLowerCase().includes(deferredQuery)),
  )
  const pages = Math.max(1, Math.ceil(filtered.length / USAGE_PAGE))
  const current = Math.min(page, pages - 1)
  const rows = filtered.slice(current * USAGE_PAGE, (current + 1) * USAGE_PAGE)
  const waiting = entries.filter((entry) => entryState(entry) !== 'written').length
  const addresses = rows.map((entry) => entry.address)
  const minted = useQuery({
    queryKey: [...usage.key, ...addresses],
    queryFn: () => usage.read(addresses),
    enabled: usage.on && addresses.length > 0,
    staleTime: USAGE_STALE_MS,
    retry: false,
  })

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3 px-5 pt-5 lg:px-6">
        <InputGroup className="w-full sm:w-72">
          <InputGroupAddon>
            <SearchIcon aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            id={`${id}-search`}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setPage(0)
            }}
            placeholder="Search addresses"
            aria-label="Search addresses"
            className="numeric"
            spellCheck={false}
          />
        </InputGroup>
        <ToggleGroup
          type="single"
          variant="outline"
          value={filter}
          onValueChange={(value) => {
            if (value) setFilter(value as 'all' | 'waiting')
            setPage(0)
          }}
          aria-label="Show"
        >
          <ToggleGroupItem value="all" className="px-3">
            All
          </ToggleGroupItem>
          <ToggleGroupItem value="waiting" className="px-3">
            Not written <span className="numeric text-muted-foreground ml-1">{count(waiting)}</span>
          </ToggleGroupItem>
        </ToggleGroup>
        <div className="ml-auto flex flex-wrap items-center gap-2">{toolbar}</div>
      </div>

      {rows.length === 0 ? (
        <p className="text-muted-foreground px-6 py-12 text-center text-sm">
          {entries.length === 0
            ? 'No addresses yet. Add them from a CSV, by pasting, or one at a time.'
            : deferredQuery
              ? 'No address matches that search.'
              : 'Every address is on chain.'}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-5 lg:pl-6">Address</TableHead>
              <TableHead className="text-right">Quota</TableHead>
              <TableHead className="text-right">Minted</TableHead>
              <TableHead className="text-right">Left</TableHead>
              <TableHead>On chain</TableHead>
              <TableHead className="pr-5 text-right lg:pr-6">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((entry, index) => {
              const state = entryState(entry)
              const used = minted.data?.[index]
              const known = typeof used === 'number'
              return (
                <TableRow key={entry.address} className={cn(state === 'removing' && 'text-muted-foreground')}>
                  <TableCell className="pl-5 lg:pl-6">
                    <span className="inline-flex items-center gap-1">
                      <span className={cn('numeric', state === 'removing' && 'line-through')}>
                        {entry.address}
                      </span>
                      <CopyButton value={entry.address} label="Copy address" />
                    </span>
                  </TableCell>
                  <TableCell className="numeric text-right">{count(entry.quota)}</TableCell>
                  <TableCell className="numeric text-muted-foreground text-right">
                    {known ? count(used) : 'Not read'}
                  </TableCell>
                  <TableCell className="numeric text-right">
                    {known ? count(Math.max(0, entry.quota - used)) : ''}
                  </TableCell>
                  <TableCell>
                    {state === 'written' ? (
                      <span className="text-muted-foreground text-[0.8125rem]">Written</span>
                    ) : (
                      <span className="grid justify-items-start gap-0.5">
                        <StatusBadge status="pending">
                          {state === 'removing' ? 'Removal not written' : 'Not written'}
                        </StatusBadge>
                        {state === 'pending' && entry.writtenQuota !== null && (
                          <span className="numeric text-muted-foreground text-xs">
                            {count(entry.writtenQuota)} on chain
                          </span>
                        )}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="pr-5 text-right lg:pr-6">
                    {state === 'removing' ? (
                      <Button variant="ghost" size="xs" onClick={() => onRestore(entry)}>
                        <Undo2Icon aria-hidden="true" />
                        Keep
                      </Button>
                    ) : (
                      <span className="inline-flex gap-1">
                        <QuotaEditor
                          entry={entry}
                          minted={known ? used : null}
                          onSave={(quota) => onQuota(entry.address, quota)}
                        />
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => onRemove(entry.address)}
                          aria-label={`Remove ${entry.address}`}
                        >
                          <Trash2Icon />
                        </Button>
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}

      <div className="border-t px-5 py-3 lg:px-6">
        <Pager
          page={current}
          pages={pages}
          total={filtered.length}
          pageSize={USAGE_PAGE}
          onPage={setPage}
          noun="addresses"
        />
      </div>
    </div>
  )
}

function QuotaEditor({
  entry,
  minted,
  onSave,
}: {
  entry: ListEntry
  /** Quota used, as the chain answered for this page, or null when it was not read. */
  minted: number | null
  onSave: (quota: number) => void
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(String(entry.quota))
  const quota = Number(value)
  const valid = /^\d+$/.test(value) && quota >= 1 && quota <= QUOTA_MAX
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) setValue(String(entry.quota))
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label={`Edit quota for ${entry.address}`}>
          <PencilIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (!valid) return
            onSave(quota)
            setOpen(false)
          }}
        >
          <label htmlFor={`${id}-quota`} className="text-sm font-medium">
            Quota
          </label>
          <Input
            id={`${id}-quota`}
            type="number"
            min={1}
            max={QUOTA_MAX}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            aria-invalid={!valid}
            aria-describedby={`${id}-quota-help`}
            autoFocus
          />
          <p id={`${id}-quota-help`} className="text-muted-foreground text-[0.8125rem]">
            {minted !== null && minted > 0 && quota < minted
              ? `Below the ${count(minted)} already minted: this wallet will have nothing left.`
              : 'Total this wallet may mint in the phase.'}
          </p>
          <Button type="submit" size="sm" variant="secondary" disabled={!valid}>
            Save quota
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  )
}
```

- [ ] **Step 5: The screen, the page and the provider's comment**

Replace the whole of `apps/web/src/components/manage/whitelist-screen.tsx` with:

```tsx
'use client'

import { useQueryClient } from '@tanstack/react-query'
import { DownloadIcon, ListChecksIcon, PlusIcon, RefreshCwIcon, TriangleAlertIcon } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { Address, Hex } from 'viem'
import { useConfig } from 'wagmi'
import { Alert, AlertDescription, AlertTitle } from '@cobweb/ui/components/alert'
import { Button } from '@cobweb/ui/components/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@cobweb/ui/components/empty'
import { Panel } from '@cobweb/ui/components/panel'
import { Spinner } from '@cobweb/ui/components/spinner'
import { Stat, StatGroup } from '@cobweb/ui/components/stat'
import { StatusBadge } from '@cobweb/ui/components/status-badge'
import { Tabs, TabsList, TabsTrigger } from '@cobweb/ui/components/tabs'
import { browserStore } from '@/components/deploy/deploy-machine'
import { useChainClock } from '@/components/mint/use-chain-clock'
import { THROWN, type ActionResult } from '@/lib/art/result'
import { chainView } from '@/lib/chain/chain-view'
import type { Tables } from '@/lib/database.types'
import type { MintGroup, SupportedChain } from '@/lib/demo'
import type { ManageCall } from '@/lib/manage/phase-calls'
import type {
  ChunkEntry,
  ChunkPlan,
  GroupList,
  ListEntry,
  SentChunk,
  WhitelistView,
} from '@/lib/manage/whitelist-types'
import { manageTabHref } from '@/lib/steps'
import { count, downloadText, relativeTo } from './format'
import { realManageActions } from './manage-actions'
import { ManageActionsProvider, type ManageTarget } from './manage-context'
import { forgetChunk, rememberChunk, sentChunk } from './manage-machine'
import { sampleManageActions, samplePhasesView } from './manage-sim'
import { UNREADABLE_REASON } from './phase-row'
import { toCsv, type Recipient } from './recipients'
import { snapshotSource } from './snapshot-source'
import type { SnapshotSource } from './snapshot-tab'
import { PendingChunkPanel, WhitelistChunks } from './whitelist-chunks'
import { AddAddressesDialog, chunkRequest, QuotaForAllDialog, WriteChunkDialog } from './whitelist-dialogs'
import {
  chunkRows,
  entryState,
  withAdded,
  withQuota,
  withQuotaForAll,
  withRemoved,
  withRestored,
} from './whitelist-model'
import { whitelistServer, type WhitelistServer } from './whitelist-server'
import { sampleSentChunk, sampleWhitelistServer } from './whitelist-sim'
import { WhitelistTable } from './whitelist-table'

export type WhitelistScreenProps = {
  collection: Tables<'collections'>
  /** The whitelist groups and their lists, read on the server (or the copy, or the sample). */
  view: WhitelistView
  /** The sign-in wallet, which every chunk must be sent from. */
  wallet: Address
  sample: boolean
  /** Sample mode only (`?chunk=pending`): a chunk waiting to be confirmed. */
  samplePending?: boolean
  /** The chains the holder snapshot can read. */
  snapshotChainIds: number[]
}

const PENDING_REASON = 'Confirm or discard the waiting chunk first.'

/** A server answer, or "Try again" when the action itself threw. */
async function settled<T>(call: Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await call
  } catch {
    return { ok: false, error: THROWN }
  }
}

/**
 * Manage drop, Whitelist (docs/specs/2026-10-15-whitelist.md, section 7.3): one list per whitelist phase, kept
 * by Cobweb, written on chain in chunks of 500 the server builds from the entries not written. Each chunk runs
 * the manage machine from the sign-in wallet and answers the fresh view, which replaces this one; edits are saved
 * by Cobweb and wait for the next chunk. Sample mode runs the same code on the sample actions and server.
 */
export function WhitelistScreen({
  collection,
  view: initial,
  wallet,
  sample,
  samplePending = false,
  snapshotChainIds,
}: WhitelistScreenProps) {
  const config = useConfig()
  const queryClient = useQueryClient()
  const [view, setView] = useState(initial)
  const viewRef = useRef(view)
  viewRef.current = view
  const [selected, setSelected] = useState(String(initial.groups[0]?.id ?? ''))
  const [pending, setPending] = useState<SentChunk | null>(null)
  const [reading, setReading] = useState(false)
  const [asking, setAsking] = useState(false)
  // The dialog stays mounted after it closes, so a chunk still confirming can finish.
  const [writing, setWriting] = useState<{ plan: ChunkPlan; key: number } | null>(null)
  const [writeOpen, setWriteOpen] = useState(false)
  // The key of the dialog on screen, if any: a failure that reaches a closed dialog is toasted.
  const shownKey = useRef<number | null>(null)
  shownKey.current = writing && writeOpen ? writing.key : null
  /** The last failed write of each group in this visit, until a chunk of it is confirmed. */
  const [failures, setFailures] = useState<Record<number, string>>({})
  // Sample mode: what the simulated wallet sent, by hash, so the sample server applies exactly that call.
  const [sampleSent] = useState(() => new Map<Hex, ManageCall>())
  const chain = chainView(view.chainId)
  const now = useChainClock(view.blockTimestamp)
  const reachable = view.chainReachable
  const maxSupply = collection.max_supply

  const server = useMemo<WhitelistServer>(
    () =>
      sample ? sampleWhitelistServer(() => viewRef.current, sampleSent) : whitelistServer(collection.id),
    [sample, sampleSent, collection.id],
  )
  const target = useMemo<ManageTarget>(
    () => ({
      actions: sample
        ? sampleManageActions(() => samplePhasesView({ max_supply: maxSupply }), sampleSent)
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

  // A chunk sent before a reload waits to be confirmed: it is checked, never sent again.
  useEffect(() => {
    setPending(
      sample
        ? samplePending
          ? sampleSentChunk(viewRef.current)
          : null
        : sentChunk(browserStore(), collection.id),
    )
  }, [sample, samplePending, collection.id])

  function rememberPending(sent: SentChunk) {
    if (!sample) rememberChunk(browserStore(), collection.id, sent)
    setPending(sent)
  }

  function forgetPending() {
    if (!sample) forgetChunk(browserStore(), collection.id)
    setPending(null)
  }

  /** A fresh view from the server replaces this one, and the minted counts on screen are read again. */
  function replace(next: WhitelistView) {
    setView(next)
    void queryClient.invalidateQueries({ queryKey: ['whitelist-minted', collection.id] })
  }

  async function readAgain() {
    setReading(true)
    const result = await settled(server.read())
    setReading(false)
    if (result.ok) replace(result.data)
    else toast.error(result.error)
  }

  /** A patch to one group's list, applied once the server accepted the edit. */
  function patch(onchainId: number, change: (list: GroupList) => GroupList) {
    setView((current) => ({
      ...current,
      lists: current.lists.map((list) => (list.onchainId === onchainId ? change(list) : list)),
    }))
  }

  /** "Write chunk": the server builds the group's next chunk from what it holds now. */
  async function write(groupId: number) {
    setAsking(true)
    const answer = await settled(server.nextChunk(groupId))
    setAsking(false)
    if (!answer.ok) return void toast.error(answer.error)
    if (!answer.data) {
      toast.success('Every address is on chain.')
      return void readAgain()
    }
    setWriting({ plan: answer.data, key: Date.now() })
    setWriteOpen(true)
  }

  if (view.groups.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ListChecksIcon />
          </EmptyMedia>
          <EmptyTitle>No whitelist phases</EmptyTitle>
          <EmptyDescription>
            Add a whitelist phase on the Phases tab, then give its addresses a quota here.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="secondary" asChild>
            <Link href={manageTabHref(collection.id, 'phases')}>Go to phases</Link>
          </Button>
        </EmptyContent>
      </Empty>
    )
  }

  const group = view.groups.find((candidate) => String(candidate.id) === selected) ?? view.groups[0]!
  const list = view.lists.find((candidate) => candidate.onchainId === group.id)
  const writingGroup = writing
    ? view.groups.find((candidate) => candidate.id === writing.plan.onchainId)
    : undefined
  const off = !reachable ? UNREADABLE_REASON : pending ? PENDING_REASON : null

  return (
    <ManageActionsProvider value={target}>
      <div className="grid gap-6">
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
                The lists below are Cobweb&apos;s, with what each chunk wrote. Quota used and minted counts
                are not shown, and chunks wait until the contract can be read.
              </p>
              <Button variant="secondary" size="sm" onClick={() => void readAgain()} disabled={reading}>
                {reading ? <Spinner /> : <RefreshCwIcon aria-hidden="true" />}
                Read again
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {pending && !writeOpen && (
          <PendingChunkPanel
            sent={pending}
            group={view.groups.find((candidate) => candidate.id === pending.onchainId)}
            chain={chain}
            server={server}
            onView={replace}
            onForget={forgetPending}
          />
        )}

        {view.groups.length > 1 && (
          <Tabs value={String(group.id)} onValueChange={setSelected}>
            <TabsList aria-label="Whitelist phase">
              {view.groups.map((candidate) => {
                const waiting = view.lists.find((entry) => entry.onchainId === candidate.id)?.unwritten ?? 0
                const chunks = Math.ceil(waiting / view.chunkSize)
                return (
                  <TabsTrigger key={candidate.id} value={String(candidate.id)} className="gap-2 px-4">
                    {candidate.name}
                    {chunks > 0 && (
                      <span
                        className="bg-warning size-1.5 rounded-full"
                        aria-label={`${chunks} ${chunks === 1 ? 'chunk' : 'chunks'} not written`}
                      />
                    )}
                  </TabsTrigger>
                )
              })}
            </TabsList>
          </Tabs>
        )}

        {list ? (
          <GroupWhitelist
            key={group.id}
            collectionId={collection.id}
            group={group}
            list={list}
            chain={chain}
            reachable={reachable}
            chunkSize={view.chunkSize}
            server={server}
            snapshot={snapshot}
            failure={failures[group.id] ?? null}
            write={{ off, busy: asking, onWrite: () => void write(group.id) }}
            onPatch={(change) => patch(group.id, change)}
            onReadAgain={() => void readAgain()}
          />
        ) : (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ListChecksIcon />
              </EmptyMedia>
              <EmptyTitle>Not named yet</EmptyTitle>
              <EmptyDescription>
                {group.name} is not named. Name it on the Phases tab to add its whitelist.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button variant="secondary" asChild>
                <Link href={manageTabHref(collection.id, 'phases')}>Go to phases</Link>
              </Button>
            </EmptyContent>
          </Empty>
        )}

        {writing && writingGroup && (
          <WriteChunkDialog
            key={writing.key}
            open={writeOpen}
            onOpenChange={setWriteOpen}
            chain={chain}
            group={writingGroup}
            plan={writing.plan}
            retry={failures[writing.plan.onchainId] !== undefined}
            request={chunkRequest(
              writing.plan,
              chain,
              (hash) => server.confirmChunk(hash, writing.plan.onchainId),
              {
                remember: (hash) => rememberPending({ hash, onchainId: writing.plan.onchainId }),
                forget: forgetPending,
              },
            )}
            onConfirmed={(next) => {
              setFailures((current) => {
                const left = { ...current }
                delete left[writing.plan.onchainId]
                return left
              })
              replace(next)
            }}
            onFailed={(message) => {
              setFailures((current) => ({ ...current, [writing.plan.onchainId]: message }))
              // The dialog on screen shows its own failure; one closed since says it in a toast.
              if (shownKey.current !== writing.key) toast.error(message)
            }}
          />
        )}
      </div>
    </ManageActionsProvider>
  )
}

/** One whitelist group's stats, its on-chain write panel, its table and its add and quota dialogs. */
function GroupWhitelist({
  collectionId,
  group,
  list,
  chain,
  reachable,
  chunkSize,
  server,
  snapshot,
  failure,
  write,
  onPatch,
  onReadAgain,
}: {
  collectionId: string
  group: MintGroup
  list: GroupList
  chain: SupportedChain
  reachable: boolean
  chunkSize: number
  server: WhitelistServer
  snapshot: SnapshotSource | undefined
  /** The last write's failure in this visit, or null. */
  failure: string | null
  /** Why writing is off (or null), whether the next chunk is being asked for, and the ask. */
  write: { off: string | null; busy: boolean; onWrite: () => void }
  onPatch: (change: (list: GroupList) => GroupList) => void
  onReadAgain: () => void
}) {
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [settingAll, setSettingAll] = useState(false)
  const usageKey = useMemo(
    () => ['whitelist-minted', collectionId, group.id] as const,
    [collectionId, group.id],
  )
  const existing = useMemo(
    () => new Set(list.entries.map((entry) => entry.address.toLowerCase())),
    [list.entries],
  )
  const rows = chunkRows(list, chunkSize, failure)
  const next = list.chunks.length + 1
  const of = list.chunks.length + Math.ceil(list.unwritten / chunkSize)

  async function setQuota(address: Address, quota: number) {
    const answer = await settled(server.setEntryQuota(group.id, address, quota))
    if (!answer.ok) return void toast.error(answer.error)
    const writtenQuota = list.entries.find((entry) => entry.address === address)?.writtenQuota
    onPatch((current) => withQuota(current, address, quota))
    toast.success(
      writtenQuota === quota ? 'Quota saved.' : 'Quota saved. Write the next chunk to put it on chain.',
    )
  }

  async function restore(entry: ListEntry) {
    const answer = await settled(server.setEntryQuota(group.id, entry.address, entry.quota))
    if (!answer.ok) return void toast.error(answer.error)
    onPatch((current) => withRestored(current, entry))
  }

  async function remove(address: Address) {
    const before = list.entries.find((entry) => entry.address === address)
    const answer = await settled(server.removeEntry(group.id, address))
    if (!answer.ok) return void toast.error(answer.error)
    onPatch((current) => withRemoved(current, address))
    if (!before) return
    // Undo: a staged removal gets its quota back; a deleted entry comes back as a new row, without copies.
    const back: ListEntry = answer.data.staged ? before : { ...before, writtenQuota: null, writtenTx: null }
    toast(answer.data.staged ? 'Removal staged. Write the next chunk to apply it.' : 'Address removed.', {
      action: { label: 'Undo', onClick: () => void restore(back) },
    })
  }

  async function setAll(quota: number): Promise<string | null> {
    const answer = await settled(server.setQuotaForAll(group.id, quota))
    if (!answer.ok) return answer.error
    onPatch((current) => withQuotaForAll(current, quota))
    const { changed } = answer.data
    toast.success(
      changed === 0
        ? 'Every address already has that quota.'
        : changed === 1
          ? '1 quota changed. Write the next chunk to put it on chain.'
          : `${count(changed)} quotas changed. Write the next chunk to put them on chain.`,
    )
    return null
  }

  async function add(recipients: Recipient[]): Promise<string | null> {
    const entries: ChunkEntry[] = recipients.map((row) => ({ address: row.address, quota: row.amount }))
    const answer = await settled(server.addEntries(group.id, entries))
    if (!answer.ok) {
      // Pages of an add may have landed before a refusal: the list is read again.
      onReadAgain()
      return answer.error
    }
    onPatch((current) => withAdded(current, entries))
    const { added, updated } = answer.data
    toast.success(
      added === 0 && updated === 0
        ? 'Every address was already listed with that quota.'
        : `${count(added)} added${updated > 0 ? `, ${count(updated)} updated` : ''}. Write the next chunk to put them on chain.`,
    )
    return null
  }

  function exportCsv() {
    // Minted as read in this visit: the pages the table asked the chain for.
    const minted = new Map<string, number>()
    for (const [key, data] of queryClient.getQueriesData<(number | null)[]>({ queryKey: usageKey })) {
      key.slice(usageKey.length).forEach((address, index) => {
        const value = data?.[index]
        if (typeof address === 'string' && typeof value === 'number') minted.set(address.toLowerCase(), value)
      })
    }
    downloadText(
      `${group.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-whitelist.csv`,
      toCsv([
        ['address', 'quota', 'minted', 'on_chain'],
        ...list.entries.map((entry) => [
          entry.address,
          entry.quota,
          minted.get(entry.address.toLowerCase()) ?? '',
          entryState(entry) === 'written' ? 'yes' : 'no',
        ]),
      ]),
    )
  }

  return (
    <div className="grid gap-6">
      <section
        aria-label={`${group.name} summary`}
        className="flex flex-wrap items-end justify-between gap-6"
      >
        <div className="grid gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-heading">{group.name}</h2>
            {reachable && (
              <StatusBadge
                status={group.active ? 'live' : group.scheduledStart > 0 ? 'scheduled' : 'closed'}
              />
            )}
          </div>
          <StatGroup>
            <Stat label="Addresses" value={count(list.total)} />
            <Stat label="Total quota" value={count(list.totalQuota)} />
            <Stat label="Quota used" value={reachable ? count(list.quotaUsed) : 'Not read'} />
            <Stat
              label="Phase supply"
              value={count(group.maxSupply)}
              hint={
                list.totalQuota > group.maxSupply
                  ? 'Less than the quota issued: first come, first served.'
                  : undefined
              }
            />
          </StatGroup>
        </div>
      </section>

      <Panel
        title="On-chain write"
        description="Addresses can mint only after their chunk is written."
        bodyClassName="p-5 lg:p-6"
      >
        <WhitelistChunks
          rows={rows}
          list={list}
          chain={chain}
          write={
            list.unwritten === 0
              ? null
              : {
                  label: failure ? `Retry chunk ${next}` : `Write chunk ${next} of ${of}`,
                  off: write.off,
                  busy: write.busy,
                }
          }
          onWrite={write.onWrite}
        />
      </Panel>

      <Panel title="Addresses" bodyClassName="p-0">
        <WhitelistTable
          entries={list.entries}
          usage={{
            key: usageKey,
            on: reachable,
            read: async (addresses) => {
              const answer = await server.quotaUsage(group.id, addresses)
              if (!answer.ok) throw new Error(answer.error)
              return answer.data
            },
          }}
          onQuota={(address, quota) => void setQuota(address, quota)}
          onRemove={(address) => void remove(address)}
          onRestore={(entry) => void restore({ ...entry, quota: entry.writtenQuota ?? entry.quota })}
          toolbar={
            <>
              <Button variant="ghost" size="sm" onClick={exportCsv} disabled={list.entries.length === 0}>
                <DownloadIcon aria-hidden="true" />
                Export CSV
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSettingAll(true)}
                disabled={list.total === 0}
              >
                Set quota for all
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
                <PlusIcon aria-hidden="true" />
                Add addresses
              </Button>
            </>
          }
        />
      </Panel>

      <AddAddressesDialog
        open={adding}
        onOpenChange={setAdding}
        group={group}
        existing={existing}
        snapshot={snapshot}
        onAdd={add}
      />
      <QuotaForAllDialog open={settingAll} onOpenChange={setSettingAll} total={list.total} onApply={setAll} />
    </div>
  )
}
```

Replace the whole of `apps/web/src/app/collections/[id]/manage/whitelist/page.tsx` with:

```tsx
import { getAddress } from 'viem'
import { getWhitelist } from '@/app/actions/whitelist'
import { ManageUnavailable } from '@/components/manage/manage-unavailable'
import { WhitelistScreen } from '@/components/manage/whitelist-screen'
import { sampleWhitelistView } from '@/components/manage/whitelist-sim'
import { StagePage } from '@/components/shell/stage-page'
import { requireOwnedCollection, requireUser } from '@/lib/auth'
import { SUPPORTED_CHAINS } from '@/lib/demo'
import { snapshotChains } from '@/lib/manage/snapshot-core'
import type { WhitelistView } from '@/lib/manage/whitelist-types'
import {
  LockedStagePage,
  searchParam,
  stageContext,
  type CollectionParams,
  type SearchParams,
} from '../../_lib/stage'

/** The holder snapshot runs as a server action from this page: up to 20,000 `ownerOf` reads. */
export const maxDuration = 300

const TITLE = 'Whitelist'
const DESCRIPTION =
  'Wallet addresses and how many each may mint, per phase. Lists are written on-chain in batches.'

/**
 * Manage drop, Whitelist (docs/specs/2026-10-15-whitelist.md, section 7.3): the whitelist groups and their lists,
 * read on the server with the contract's state. Sample mode only (`NEXT_PUBLIC_DEMO_DATA=1`): the sample lists on
 * any collection, `?chain=unreachable` shows the copy with its alert, `?chunk=pending` a chunk waiting to be
 * confirmed.
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

  let view: WhitelistView
  if (ctx.demo) {
    view = sampleWhitelistView(collection, (await searchParam(searchParams, 'chain')) !== 'unreachable')
  } else {
    const result = await getWhitelist(collection.id)
    if (!result.ok)
      return (
        <StagePage title={TITLE} description={DESCRIPTION} width="wide">
          <ManageUnavailable title="The whitelist could not be read" message={result.error} />
        </StagePage>
      )
    view = result.data
  }

  return (
    <StagePage title={TITLE} description={DESCRIPTION} width="wide">
      <WhitelistScreen
        collection={collection}
        view={view}
        wallet={getAddress(user.walletAddress)}
        sample={ctx.demo}
        samplePending={ctx.demo && (await searchParam(searchParams, 'chunk')) === 'pending'}
        snapshotChainIds={ctx.demo ? SUPPORTED_CHAINS.map((chain) => chain.id) : snapshotChains()}
      />
    </StagePage>
  )
}
```

In `apps/web/src/components/manage/manage-context.tsx`, replace:

```tsx
/**
 * The actions every `TransactionDialog` in Manage drop runs on (docs/specs/2026-10-15-phases.md, section
 * 7.3), with the collection's chain and the sign-in wallet the machine checks against. Phases provides the
 * real or the sample ones; the tabs still on sample data (Whitelist, Airdrop, Settings, the Overview's
 * Reveal) run on one shared sample target until their sub-projects.
 */
export type ManageTarget = { actions: ManageActions; chainId: number; wallet: Address }
```

with:

```tsx
/**
 * The actions every `TransactionDialog` in Manage drop runs on (docs/specs/2026-10-15-phases.md, section
 * 7.3), with the collection's chain and the sign-in wallet the machine checks against. Phases and Whitelist
 * provide the real or the sample ones; the tabs still on sample data (Airdrop, Settings, the Overview's Reveal)
 * run on one shared sample target until their sub-project.
 */
export type ManageTarget = { actions: ManageActions; chainId: number; wallet: Address }
```

- [ ] **Step 6: Typecheck, lint, test and build**

Run at the repo root: `pnpm typecheck && pnpm lint && pnpm test`
Expected: everything passes; the web package reports 585 tests in 68 files (575 before: 10 added).

Run at the repo root: `pnpm build`
Expected: the build succeeds and its route list includes `/collections/[id]/manage/whitelist` and `/collections/[id]/manage/airdrop` as dynamic routes. A build error naming `server-only` means a client file imported a server module: only the pages may import `@/lib/manage/snapshot-core`, and the browser reaches the server through `@/app/actions/*` alone.

The controller walks the screens in Task 10. What each screen must show is spelled out there; nothing in this task needs a browser.

- [ ] **Step 7: Format, run the root checks and commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
pnpm exec prettier --write apps/web/src/components/manage/whitelist-model.ts apps/web/src/components/manage/whitelist-model.test.ts apps/web/src/components/manage/whitelist-dialogs.tsx apps/web/src/components/manage/whitelist-chunks.tsx apps/web/src/components/manage/whitelist-table.tsx apps/web/src/components/manage/whitelist-screen.tsx "apps/web/src/app/collections/[id]/manage/whitelist/page.tsx" apps/web/src/components/manage/manage-context.tsx
pnpm typecheck && pnpm lint && pnpm test
git add apps/web/src/components/manage/whitelist-model.ts apps/web/src/components/manage/whitelist-model.test.ts apps/web/src/components/manage/whitelist-dialogs.tsx apps/web/src/components/manage/whitelist-chunks.tsx apps/web/src/components/manage/whitelist-table.tsx apps/web/src/components/manage/whitelist-screen.tsx "apps/web/src/app/collections/[id]/manage/whitelist/page.tsx" apps/web/src/components/manage/manage-context.tsx
git commit -m "$(cat <<'EOF'
Put the Whitelist tab on the server's view: chunks the server builds sent through the manage machine, the waiting chunk with Check again, edits saved and patched locally, Minted per page from the chain, and the snapshot on the real action

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: the web package reports 585 tests.

---

### Task 10: The docs, the whole check list, the browser walk and the landing note

This task is the controller's: it runs every check, walks the screens in a browser with the dev wallet, and records what it saw. The doc edits add dated sentences; nothing earlier is rewritten or deleted.

**Files:**

- Modify: `docs/MASTER_PLAN.md` (the Phase 5 status line)
- Modify: `docs/specs/2026-10-03-creator-flow-ui.md` (a dated note at the end of section 4.6)
- Modify: `docs/specs/2026-10-15-phases.md` (a dated note at the end of section 12)
- Modify: `docs/specs/2026-10-15-whitelist.md` (the acceptance boxes; the landing note)

**Interfaces:**

- Consumes: everything Tasks 1 to 9 produce, the local services (`supabase start`, `supabase seed buckets`, `pnpm --filter @cobweb/web chain:local` with its two lines in `apps/web/.env.local`) and the dev wallet extension in `apps/web/scripts/dev-wallet` (the one the earlier walks used).
- Produces: the docs.

In every sentence below, `<date>` is the day the work lands, written as `date '+%-d %B %Y'` prints it (for example `15 October 2026`).

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
```

Expected: tests pass (shared 72, web 585, the other packages unchanged); the format check and the build pass; `verify:local` 342 (326 plus 16), `verify:chain` 12, `verify:storage` 15, `verify:sweep` 8, `verify:render` 22, `verify:deploy` 15, `verify:phases` 20 and `verify:whitelist` 18, each with `0 failed`.

- [ ] **Step 2: The browser walk**

Make the CSV for step 2 of the walk (2,000 distinct checksummed addresses with quotas 1 to 3, then a repeat of the first, the second with one letter's case flipped so its checksum breaks, and the zero address):

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad/apps/web
node --input-type=module -e "
import { getAddress, keccak256, toHex } from 'viem'
const rows = ['address,quota']
for (let i = 0; i < 2000; i++) rows.push(getAddress('0x' + keccak256(toHex('walk ' + i)).slice(26)) + ',' + (1 + (i % 3)))
rows.push(rows[1], rows[2].replace(/[a-f]/, (letter) => letter.toUpperCase()), '0x0000000000000000000000000000000000000000,1')
process.stdout.write(rows.join('\n') + '\n')
" > "$TMPDIR/whitelist-walk.csv"
```

With the dev server (`pnpm --filter @cobweb/web dev`) on local Supabase and Anvil and the dev wallet signed in, walk these and note what each screen showed:

1. A collection deployed on the current Anvil with a whitelist phase (if Anvil restarted since it was deployed, deploy a fresh one: lock and pay in Lock and upload, `pnpm --filter @cobweb/web render:local <collectionId>`, then Deploy; add a whitelist phase on Phases if it has none). Whitelist reads "Read from the chain under a minute ago" with "Read again"; the phase shows its status badge, Addresses 0, Total quota 0, Quota used 0 and its Phase supply; the table reads "No addresses yet. Add them from a CSV, by pasting, or one at a time."
2. Add addresses, Upload CSV with `$TMPDIR/whitelist-walk.csv`: the preview reads the header skipped, one repeat merged and two rejected lines with their numbers ("The checksum does not match. Check the address for a typo." and "The zero address cannot mint or receive tokens."); "Add 2,000 addresses" shows "Adding 2,000 addresses" with a spinner, the dialog closes and the toast reads "2,000 added. Write the next chunk to put them on chain."; the panel reads "0 of 4 chunks written" and "2,000 addresses wait for a chunk. Until it is written, the chain keeps the quota it had, or none.", the button "Write chunk 1 of 4".
3. Paste: two listed addresses at new quotas (toast "0 added, 2 updated. Write the next chunk to put them on chain."); Add one: a listed address at a new quota (toast "0 added, 1 updated. ..."). The list stays at 2,000 addresses.
4. "Write chunk 1 of 4": the review lists `addressesToAdd` "500 addresses", `mintGroup` with the phase's id and `mintQuotas` "500 quotas, <N> in total"; the dialog runs "Checking the change", "Confirm in your wallet" (sign in the dev wallet), "Confirming on Anvil" and "Reading the contract", then the toast "Chunk 1 is on chain"; the panel reads "1 of 4 chunks written" and chunk 1 "Written" with its hash as text (Anvil has no explorer).
5. "Write chunk 2 of 4", then Reject in the wallet: "Cancelled in your wallet"; the panel marks chunk 2 Failed with that error and the button reads "Retry chunk 2"; "Retry chunk 2" writes it.
6. Start chunk 3 and reload while the dialog shows "Confirming" or "Reading the contract": after the reload the panel "A chunk is waiting to be confirmed" names the phase and the transaction, and the write button is off with "Confirm or discard the waiting chunk first."; "Check again" runs "Reading the chunk" and toasts "The chunk is on chain". If Anvil confirms before the reload can catch it, plant the last chunk's hash in the browser's localStorage as `cobweb-whitelist:<collectionId>` = `{"hash":"<hash>","onchainId":<id>}` and reload: "Check again" answers the view again (a second confirm of a hash is safe). Plant it once more and use "Discard": the panel goes.
7. Write chunk 4: "4 of 4 chunks written", "Every address is on chain."; the Not written filter reads 0.
8. Edits: a quota edit (toast "Quota saved. Write the next chunk to put it on chain."; the row reads "Not written" with "<n> on chain" beneath); set it back to the written quota ("Quota saved.", the row reads Written again); remove a written address ("Removal staged. Write the next chunk to apply it." with Undo; the row reads "Removal not written" with Keep, and Keep puts it back); remove an address added since the last chunk ("Address removed." with Undo, which puts it back); Set quota for all ("<N> quotas changed. Write the next chunk to put them on chain."); write the chunk the edits need; Export CSV saves `<phase slug>-whitelist.csv` with `address,quota,minted,on_chain`, minted filled for the pages read.
9. Another wallet's mint: put one of the dev wallet's other accounts on the list and write its chunk, open the phase on Phases, and mint one token from that account. "Read again": Quota used reads 1 more, and on the table page holding that address Minted reads 1 and Left the quota minus 1.
10. Snapshots, in Add addresses: the chain menu offers Anvil only (the chains with an RPC); the collection's own contract adds its holders with the note "Added <N> holders of 0x12..34 on Anvil at block <block>. Review them below before you continue."; a wallet address reads "There is no contract at this address on Anvil."; the factory reads "This address is not an ERC-721 contract on Anvil.".
11. Stop Anvil (end `chain:local`) and reload Whitelist: the alert "The contract could not be read" with "The lists below are Cobweb's, with what each chunk wrote. Quota used and minted counts are not shown, and chunks wait until the contract can be read." and "Read again"; no status badge; Quota used and Minted read "Not read"; the write button is off with "The contract could not be read, so changes on chain wait until it can be."; a quota edit still saves. Start `chain:local` again afterwards (the earlier contracts are gone from the fresh chain; their pages keep showing the copy).
12. A group registered outside Cobweb (a `registerMintGroup` sent from the creator's wallet outside the flow, as the Phases walk did for "Group 5"): its tab is an Empty "Not named yet", "Group N is not named. Name it on the Phases tab to add its whitelist." with "Go to phases".
13. Airdrop: the Snapshot tab of the recipients input reads the collection's holders on Anvil, with the same note.
14. Sample mode (`NEXT_PUBLIC_DEMO_DATA=1` in `apps/web/.env.local`, then restart the dev server): Whitelist shows the Owl List with "1 of 2 chunks written" and 120 addresses waiting, and Team written; "Write chunk 2 of 2" runs on the simulated wallet (Approve: "Chunk 2 is on chain"; Reject: "Cancelled in your wallet" and "Retry chunk 2"; "Approve, then revert": "The change failed on chain"); Minted reads the sample's counts; the Snapshot tab answers 24 holders at block 21500000; `?chain=unreachable` shows the alert and "Not read"; `?chunk=pending` shows the waiting panel and "Check again" writes the Owl List's next chunk; Airdrop's Snapshot tab answers the sample's holders. Remove `NEXT_PUBLIC_DEMO_DATA` afterwards.

A step that does not behave as written is a defect: fix it in a new commit (or send it back to the task that owns it) before recording the landing.

- [ ] **Step 3: MASTER_PLAN**

In `docs/MASTER_PLAN.md`, Phase 5's status line ends with the Phases landing's `Known:` sentence, whose last item is "the Whitelist, Airdrop and Settings dialogs run on the sample actions until their sub-projects." That sentence stays as it is (docs keep their history); the Whitelist landing is appended to the same line.

In `docs/MASTER_PLAN.md`, replace:

```markdown
the Whitelist, Airdrop and Settings dialogs run on the sample actions until their sub-projects.
```

with:

```markdown
the Whitelist, Airdrop and Settings dialogs run on the sample actions until their sub-projects. Whitelist (third sub-project of four) landed on <date>; see [specs/2026-10-15-whitelist.md](specs/2026-10-15-whitelist.md). What exists: the whitelist migration (`whitelist_entries.quota` of 0 for a removal staged on a written address, the copies `written_quota`, `written_tx` and `written_at` of what the chain was last proven to hold, the owner's grants narrowed to the list's columns, `whitelist_entries_add` for the owner's adds under a cap of 10,000 per group, and `whitelist_chunk_record`, which only the service role calls); `setMintQuota` in the manage calls, with arrays in `SentCall` and counts in the review; chunks of 500 built by the server from the entries not written (`nextChunk`), sent from the sign-in wallet by the manage machine and proven by `confirmWhitelistChunk` from the receipt and the transaction's calldata; a chunk sent but not confirmed kept in the browser with "Check again" and "Discard"; quota used from `collectionState()` and Minted for the 25 addresses on screen from `quotaClaimed`; the holder snapshot as a server action (`fetchHolders`: ERC-721 checked through ERC-165, one block, at most 20,000 tokens, the chains with an RPC) behind the recipients input of Whitelist and Airdrop; sample mode on the same code; `pnpm --filter @cobweb/web verify:whitelist` (18 checks against local Supabase and Anvil). Next: airdrop and settings (the fourth sub-project). Known: the mint page (Phase 6) reads eligibility from `walletState` through the freshness server, and a quota set outside Cobweb is known only once a chunk carrying it is confirmed through Cobweb; per-chain chunk sizes stay out (500 fresh entries cost about 11.6M gas), and Monad and Berachain are measured on testnet before launch; records are not ordered by block, so "Check again" on an older chunk can write an older copy back until the next chunk; the 10,000 cap is the actions' and `whitelist_entries_add`'s, not the owner's direct insert grant; the snapshot misses holders of ids above `totalSupply()` after burns, reads no ERC-1155 and has no rate limit; the page ships every entry of each group; the Airdrop and Settings dialogs run on the sample actions until the fourth sub-project.
```

- [ ] **Step 4: The dated notes in the earlier specs**

In `docs/specs/2026-10-03-creator-flow-ui.md`, the note goes at the end of section 4.6, after the Phases note.

In `docs/specs/2026-10-03-creator-flow-ui.md`, replace:

```markdown
### 4.7 Public mint page (`/[slug]`)
```

with:

```markdown
> **<date>:** The Whitelist tab runs on real data ([2026-10-15-whitelist.md](2026-10-15-whitelist.md)). What changed from the sample: there is no chunk table; each entry keeps a copy of what the chain was last proven to hold (`written_quota`, `written_tx`, `written_at`), and an entry is written when that copy equals its quota; the server builds the next chunk from the first 500 entries not written in address order, so a failed or lost chunk is resumed by writing the next one; a chunk is proven from its receipt and the transaction's calldata, never from the browser's list; a chunk sent but not confirmed waits above the tabs with "Check again" and "Discard"; Minted and Left are read from the contract for the 25 addresses on screen; the holder snapshot is a server action that reads an ERC-721 contract (checked through ERC-165) at one block, up to 20,000 tokens, on the chains Cobweb has an RPC for, and the same input serves Airdrop.

### 4.7 Public mint page (`/[slug]`)
```

In `docs/specs/2026-10-15-phases.md`, the note closes section 12's "The Whitelist tab (the next sub-project), Airdrop and Settings still run on sample data" for the Whitelist.

In `docs/specs/2026-10-15-phases.md`, replace:

```markdown
## 13. Acceptance criteria
```

with:

```markdown
> **<date>:** The Whitelist tab now runs on real data ([2026-10-15-whitelist.md](2026-10-15-whitelist.md)), its chunks on the manage actions, and an unnamed group's tab sends the creator to Phases to name it. Airdrop and Settings still run on sample data, their dialogs on the sample actions, until the fourth sub-project.

## 13. Acceptance criteria
```

- [ ] **Step 5: The landing note in the Whitelist spec**

In `docs/specs/2026-10-15-whitelist.md`, section 13, change each `- [ ]` to `- [x]` whose criterion Steps 1 and 2 confirmed (all six when everything passed). Then, after the list, add a blank line and one paragraph that starts `Checked on <date> on local Supabase, local storage and Anvil:` and records: the root checks with the shared and web test counts; the build; each verify script with its count (verify:local, verify:chain, verify:storage, verify:sweep, verify:render, verify:deploy, verify:phases, verify:whitelist); then the browser walk, step by step as Step 2 lists it, with what each screen showed (the preview's counts and rejected lines, the toasts, the review's rows, the four chunks with their hashes' first characters, the failed and retried chunk, the waiting panel after the reload, the edits, the export's columns, the other wallet's mint in Quota used and Minted, each snapshot's answer, the alert with Anvil stopped, the unnamed group, Airdrop's snapshot, the sample states), and any defect found and the commit that fixed it.

- [ ] **Step 6: Commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
git add docs/MASTER_PLAN.md docs/specs/2026-10-03-creator-flow-ui.md docs/specs/2026-10-15-phases.md docs/specs/2026-10-15-whitelist.md
git commit -m "$(cat <<'EOF'
Record the Whitelist landing in MASTER_PLAN and its spec, with the notes the earlier specs owe it

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: `git show --stat HEAD` lists the four docs only; `git diff HEAD~1 -- docs/PLAN.md` prints nothing.
