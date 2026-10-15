# Freshness Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the service mint pages poll instead of an RPC (CLAUDE.md rule 3). `apps/freshness` runs on Railway as one Node process started from its TypeScript source. A collection joins an in-memory hot set on its first request, once its chain's factory confirms it with `isCollection`, and leaves after 10 minutes without one. For each chain with a hot collection, a tick reads the head, scans the logs since the last tick once for the events that change what a mint page shows, and reads every hot collection's `collectionState()` at the head in one multicall: every 1 s around a scheduled start, 2 s while a phase is live, 20 s otherwise. `GET /v1/state/{chainId}/{address}` answers the last read with the owner, royalty, base URI, transfer validator and level, a weak ETag that unchanged ticks keep, edge cache headers and a `degraded` flag; `GET /v1/wallet/{chainId}/{address}/{wallet}` answers a wallet's quotas and up to 10 delegated vaults, read in 200 ms windows; `/health` reports each chain's lag. Liveness is always the contract's `active`. Phase 5's pure readers move into `@cobweb/shared` for the server and the web app, and `verify:freshness` proves on Anvil that the endpoint reports a scheduled phase inactive one second before its start and active within one tick of the first block at it.

**Architecture:** The shared package gains the five readers (`readEach` with `revertedRead`, `chainStateOf`, `levelOf` with `TRANSFER_LEVELS`, `pointerOf`) in its browser entry, the delegate registry's hand-written ABI, a `clients` entry for `src/clients.ts` (the `server` entry keeps the `server-only` marker), and the `COBWEB_TEST_CHAINS` switch with Robinhood Chain Testnet; the web app imports the readers from there and a lint rule keeps it on `@cobweb/shared/server`. `apps/freshness` is a `node:http` server run by `node src/index.ts` with no build step: `config.ts` (the served chains), `collection-check.ts` and `hot-set.ts` (who is hot), `tiers.ts` (when to read, and `degraded`), `logs.ts` (the one `eth_getLogs` and its marks), `chain-reader.ts` (the tick), `state-body.ts` (the body and its weak ETag), `delegations.ts` and `wallet.ts` (the vault filter and the 200 ms windows), `health.ts`, `routes.ts` (paths, refusals and headers), `server.ts` (`startFreshness`) and `index.ts` (PORT and SIGTERM). The fixture's chain half moves to `apps/web/scripts/chain-fixture.ts`, so `verify:freshness` runs the server in process against Anvil alone through an RPC switch it can fail.

**Tech Stack:** TypeScript 6 strict (ESM, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, and `erasableSyntaxOnly` in `apps/freshness`) consumed as source; Node 26 locally and Node 24 on Railway and in CI, running the server's TypeScript through type stripping; `node:http` and `node:crypto`; viem 2.57 (public clients over HTTP, `readEach` over `multicall3` or parallel reads); Vitest 5 (Node environment, fake timers, fake clients); Next 16.3 for the web app's build; Anvil through `chain:local`; Prettier 3.

**Spec:** [../specs/2026-10-16-freshness-server.md](../specs/2026-10-16-freshness-server.md)

## Global Constraints

- The spec is the binding authority, its section 14 reconciliations included. Where this plan decides a detail the spec leaves open, the line starts with "Decision:" and the decisions that shape more than one task are collected in the next section.
- Node 26 locally, Node 24 on Railway and in CI. ESM everywhere. Inside `packages/shared` and `apps/freshness`, relative imports carry the `.ts` extension (`./chains.ts`, `./hot-set.ts`). The freshness server runs under plain Node, which strips the types: no `--conditions=react-server`, no loader, no build step. Its source is erasable TypeScript only (no enums, namespaces or parameter properties, which `erasableSyntaxOnly` refuses at typecheck). Inside `apps/web/src`, imports are extensionless and use the `@/` alias, as the existing files do. Inside `apps/web/scripts`, relative imports carry the `.ts` extension and the app's modules are imported as `../src/...`; the scripts run under `node --conditions=react-server --import ./scripts/resolve-ts.mjs`, which maps `@/` and adds `.ts`. Types are imported with `import type` or an inline `type` specifier.
- Vitest 5, Node environment. One file: `pnpm --filter <package> exec vitest run <file>`, for example `pnpm --filter @cobweb/freshness exec vitest run src/tiers.test.ts`. No HTTP test of the server runs in vitest (spec decision 23): its rules are unit tested on fakes, and `verify:freshness` runs it end to end on Anvil.
- Test fixtures: annotate every fixture constant with its type (`const A: Address = ...`, `const read: CollectionRead = ...`), since an unannotated literal widens and fails `tsc`. A fake client is a plain object cast `as unknown as PublicClient` with `chain: { contracts: {} }` (no `multicall3`), so `readEach` reads each call with `readContract`, as it does on Anvil. Under fake timers, let promises run with `vi.advanceTimersByTimeAsync`, never by awaiting a sleeping call.
- Prettier: no semicolons, single quotes, trailing commas, 110 columns. Before each commit run `pnpm exec prettier --write <the files you changed>` from the repo root. Never run `pnpm format` or Prettier on `.`. CI runs `pnpm format:check`, so every file you touch outside `docs/` must be formatted (`docs/`, `contracts/out/` and `packages/ui/src/components/` are in `.prettierignore`). The code blocks in this plan are already formatted; Prettier leaves them as they are. Comments wrap at 110 columns, like the code.
- typescript-eslint's recommended rules and ESLint's `preserve-caught-error` apply. Do not write `throw new X(...)` directly inside a `catch` block.
- Copy: plain sentences. No em or en dashes anywhere, code, comments, commit messages and docs included. The product is Cobweb; never Kingdomly.
- CLAUDE.md rules 1, 2 and 3 bind this sub-project. Liveness is the contract's `active` and nothing else: the server never computes it, and its tiers only decide when to read (rule 1). The verify script simulates every transaction it sends and sends the simulated request (rule 2). The server exists so a mint page never calls an RPC for shared state (rule 3); the dashboard keeps its own reads.
- Security: no secret value is printed, logged or committed. An RPC URL carries the provider's key: the server logs a failure as its error's name and viem's short message (`errorLine`), never an error's `message` or a URL; `/health` names an error, never a URL; the start's log line names the chains, never their URLs. `apps/freshness/.env` is ignored by the root `.gitignore`; only `.env.example` files are committed. No env name starts with `NEXT_PUBLIC_`.
- Never deploy to any remote chain or service: the Railway service, its settings and variables are the owner's (spec section 12) and no step touches them. Never pass `--prod` or `--target production` to any command. The only chain any step touches is the local Anvil on port 8545; every script refuses an endpoint that is not localhost. `verify:freshness` never restarts Anvil; its two collections stay there, and the chain's clock ends about 600 s further ahead each run.
- The repository is linked to a hosted Supabase project (`supabase/.temp`). Never run `supabase db push`, never pass `--linked` or `--project-ref` to any command, never run `supabase db reset` or `supabase stop`. This sub-project adds no migration; the only Supabase command any step runs is `supabase status`, through the fixture.
- `docs/PLAN.md` must not change. `legacy/` is never read into, copied from, imported or committed.
- Docs keep their history: add dated notes and status sentences; never rewrite or delete earlier statements in `docs/MASTER_PLAN.md` or in specs.
- Local services: `pnpm --filter @cobweb/web chain:local` is running on port 8545 with its two printed lines (`RPC_URL_31337` and `FACTORY_ADDRESS_31337`, the factory at `0x5FbDB2315678afecb367f032d93F642f64180aa3`) in `apps/web/.env.local`, and the factory approves the shipped creation code. Tasks 1 to 7 need nothing running. Task 8's fixture checks and Task 9's check list also need `supabase start` at the repo root (and, for `verify:render`, `supabase seed buckets`); `verify:freshness` needs Anvil alone.
- Dependencies install from the local store: `pnpm install --offline`, so the lockfile resolves exactly as this plan was checked.
- Implementers never use `git commit --amend` or `git stash`. `git mv` is used only where a step says so. To fix a commit, make a new one.
- Before every commit, at the repo root: `pnpm exec prettier --write <the files you changed>`, then `pnpm typecheck && pnpm lint && pnpm test`.
- Commit messages are one plain imperative sentence with no prefix, then a blank line, and end with exactly these two lines:

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
```

## Decisions

1. Decision (spec sections 5 to 11): nine tasks. The readers into the shared package with the `clients` entry and the web app's imports and lint rule (1); the test-chain switch with Robinhood Chain Testnet (2); the freshness package and its configuration (3); the hot set, the collection check and the tiers (4); the log scan, the health helpers and the chain reader (5); the delegate registry's ABI, the vault filter and the wallet windows (6); the state body and its ETag, the routes and answers, the server and its start (7); the fixture's chain half and `verify:freshness` with `CLAUDE.md` (8); the whole check list, the start as Railway runs it, MASTER_PLAN and the landing note (9, the controller's).
2. Decision (section 6.3): `HotEntry` carries `joinedAt` beside the spec's fields. A request waits for a first read until `JOIN_WAIT_MS` after the join, and `requestedAt` moves with every request, so the join's own time is kept (Tasks 4 and 7).
3. Decision (sections 6.4 and 6.8): `chainReader(...).stop()` and `walletWindows(...).stop()` answer a promise that settles once the tick or the windows in flight have ended, so `close()` resolves only after the last RPC call it caused (`verify:freshness` check 16). The spec writes `stop(): void` (Tasks 5, 6 and 7).
4. Decision (section 6.4): `FeeWei`, `Extras` and `CollectionRead` live in `chain-reader.ts` as the spec places them. Task 4 creates the file with those three types for `hot-set.ts`; Task 5 replaces it whole with the reader.
5. Decision (sections 6.1 and 6.9): `health.ts` also holds `errorName(error)` (the innermost viem error's name, what `/health`'s `lastError` shows) and `errorLine(error)` (that name and viem's `shortMessage`, what the log writes), used by the log scan, the reader, the windows and the server. Neither ever reads an error's `message`, which carries the request's URL.
6. Decision (sections 6.6 and 6.9): the tier a request's `degraded` uses and the one `/health` reports are computed from the chain's entries at that moment (`reader.health().tier`); a tick computes its own for the next delay. `lagSeconds` is counted from the newest block time among the chain's reads and is 0 when the chain's clock is ahead of the server's (as on Anvil after a verify run).
7. Decision (section 6.5): `logs.ts` reads logs as `LogLike = { address: Address; topics: readonly Hex[] }`, which every viem log and every node's `eth_getLogs` answer fit (viem's `Log['topics']` is a tuple a plain array does not satisfy), and `scanLogs(getLogs, scanned, head, hot, validators)` holds the 500-block guard and the failure rule, answering `{ marks, gap, failure }`; the reader passes it a raw `eth_getLogs` so one call carries both ABIs' topics.
8. Decision (section 6.7): a method other than GET, HEAD and OPTIONS answers 405 on any path; OPTIONS on a known path (the state, wallet and health paths) answers the preflight, on any other path 404; the query string is ignored; an address in one case (lowercase or uppercase) is accepted and answered checksummed; an unexpected exception (a bug) answers 500 `{ "error": "internal" }` with `no-store`, which the spec's table does not list.
9. Decision (section 7.3): `server.ts` re-exports `HealthBody`, `StateBody`, `WalletBody` and `TIER_MS`, so `verify:freshness` reads typed answers and the tier intervals through `@cobweb/freshness/server` alone (Tasks 7 and 8).
10. Decision (section 7.3): `chain-fixture.ts` exports `localChainConfig()` and `refuseRemote(url)`, and `render-deps.ts` imports both, so `loadChainEnv` goes; `render:local` and `verify:render` load the chain fixture with their settings.
11. Decision (section 10): two test files beyond the spec's list. `config.test.ts` pins `servedChains` (Task 3); `chain-reader.test.ts` drives the tick on a fake chain under fake timers for three Review Focus items (Task 5).
12. Decision (sections 6.1 and 7.3): `pnpm install --offline` adds the `apps/freshness` importer (Task 3) and the `@cobweb/freshness` link (Task 8) to `pnpm-lock.yaml`. In Task 3 pnpm also points `@scure/bip32@1.7.0` at the `@noble/curves@1.9.7` the lockfile already holds for viem, in place of 1.9.1; nothing else moves.
13. Decision (section 10): `verify:freshness` measures "within one tick" as the tier `/health` reports at that moment plus 500 ms for the read, and adds 1.2 s where the switch has just passed again, since viem's three retries (150, 300 and 600 ms) may still be in flight. Check 8 keeps the spec's 1.5 s.

## Review Focus

Inputs and failure modes the spec implies but its own test list would not exercise, most likely to bite on mint day first. Each is pinned to a test in the task that owns the code.

1. A load-balanced RPC answers an older head than the one the last read used. Reading again at it would move `block` back and show an older state; the spec says an entry read at the head or later counts as read now and `block` never goes back. Pinned by "counts a head older than the last read as a read now, and never moves the block back (Review Focus 1)" (Task 5, `chain-reader.test.ts`).
2. One collection's view reverts while a tick reads many (a collection deployed with a broken validator, or a view a future contract drops). The spec says a call answering null leaves its entry as it was, its mark included; a reader that dropped the whole tick would freeze every other collection on the chain. Pinned by "leaves a collection whose call answers null as it was, mark included, and reads the others (Review Focus 2)" (Task 5, `chain-reader.test.ts`).
3. A provider refuses `eth_getLogs` (a range limit below 500 blocks, or a transient error). The spec's test covers the range guard only; a failed call must also mark every hot collection for a full read and count a gap, never fail the tick, or a refused scan would hide a reveal or a schedule change. Pinned by "marks every hot collection as a gap when the scan fails, naming the failure (Review Focus 3)" (Task 5, `logs.test.ts`).
4. One wallet asks about two collections in one window (a collector with two mint pages open). The listing is read once per wallet, and each pair keeps only the CONTRACT delegations for its own collection; per-pair listings would double the registry's calls, and a shared filter would list a vault whose mint reverts `NotDelegate`. Pinned by "reads one listing per wallet for two collections, each pair keeping only its own contract delegations (Review Focus 4)" (Task 6, `wallet.test.ts`).
5. A collection joins while a tick is running (the first minutes of a mint, when every page joins at once). The spec says ticks never overlap; a second tick beside the first would double the reads and could apply an older head after a newer one. The wake runs one more tick right after the running one. Pinned by "runs one more tick after a wake during a tick, never beside it (Review Focus 5)" (Task 5, `chain-reader.test.ts`).

## File map

| Path | Task | Responsibility |
| --- | --- | --- |
| `packages/shared/src/read-each.ts`, `read-each.test.ts` (moved from `apps/web/src/lib/chain`) | 1 | `readEach`, `revertedRead`, the group sizes |
| `packages/shared/src/collection-state.ts`, `collection-state.test.ts` | 1 | `ChainGroup`, `ChainState`, `CollectionStateResult`, `chainStateOf` |
| `packages/shared/src/transfer-level.ts`, `transfer-level.test.ts`, `reveal-pointer.ts`, `reveal-pointer.test.ts` | 1 | `TRANSFER_LEVELS`, `TransferLevelState`, `levelOf`; `RevealPointer`, `RevealTargets`, `pointerOf` |
| `packages/shared/src/entries.test.ts`, `packages/shared/package.json`, `packages/shared/src/index.ts` | 1, 6 | The `./clients` export; the browser entry's new modules |
| `apps/web/src/lib/manage/phases-core.ts`, `phases-types.ts`, `airdrop-core.ts`, `settings-core.ts`, `snapshot-core.ts`, `whitelist-core.ts`, `settings-view.ts`, `settings-types.ts`, `settings-view.test.ts`, `phase-calls.ts`, `apps/web/src/components/manage/tradability.tsx`, `settings-sim.ts` | 1 | The moved readers imported from `@cobweb/shared` |
| `eslint.config.mjs` | 1 | `@cobweb/shared/clients` refused in `apps/web` |
| `packages/shared/src/chains.ts`, `rpc.ts`, `chains.test.ts` | 2 | `hidesTestChains`, Robinhood Chain Testnet |
| `apps/web/next.config.ts`, `apps/web/src/lib/wagmi.ts`, `apps/web/.env.example` | 2 | The switch in the browser bundle and the wallet's chains |
| `apps/freshness/package.json`, `tsconfig.json`, `.env.example`, `src/config.ts`, `src/config.test.ts`, `pnpm-lock.yaml` | 3 | The package, its start, the served chains |
| `apps/freshness/src/hot-set.ts`, `collection-check.ts`, `tiers.ts` and their tests, `chain-reader.ts` (types) | 4 | Who is hot, who is a collection, when to read, `degraded` |
| `apps/freshness/src/logs.ts`, `logs.test.ts`, `health.ts`, `chain-reader.ts`, `chain-reader.test.ts` | 5 | The log scan, the health shapes and error names, the tick |
| `packages/shared/src/delegate-registry-abi.ts`, `delegate-registry-abi.test.ts` | 6 | `DELEGATE_REGISTRY`, `DELEGATION_TYPE`, `delegateRegistryAbi` |
| `apps/freshness/src/delegations.ts`, `wallet.ts` and their tests | 6 | The vault filter, the 200 ms windows |
| `apps/freshness/src/state-body.ts`, `routes.ts` and their tests, `server.ts`, `index.ts` | 7 | The body and its ETag, the routes and answers, `startFreshness`, the start |
| `apps/web/scripts/chain-fixture.ts`, `deploy-fixture.ts`, `render-deps.ts` | 8 | The fixture's chain half, re-exported; the render settings on it |
| `apps/web/scripts/verify-freshness.ts`, `apps/web/package.json`, `pnpm-lock.yaml`, `CLAUDE.md` | 8 | `verify:freshness` (16 checks), its script and dev dependency, the layout lines and commands |
| `docs/MASTER_PLAN.md`, `docs/specs/2026-10-16-freshness-server.md` | 9 | The Hosting decision, the Phase 6 status line, the acceptance boxes and the landing note |

---

### Task 1: The pure chain readers move into the shared package with the `clients` entry, and the web app imports them under a lint rule

**Files:**

- Move (`git mv`): `apps/web/src/lib/chain/read-each.ts` and `read-each.test.ts` to `packages/shared/src/read-each.ts` and `read-each.test.ts` (the test's import gains `.ts`; nothing else changes)
- Create: `packages/shared/src/collection-state.ts`, `transfer-level.ts`, `reveal-pointer.ts`, and the tests `collection-state.test.ts`, `transfer-level.test.ts`, `reveal-pointer.test.ts`, `entries.test.ts`
- Modify: `packages/shared/src/index.ts` (whole file), `packages/shared/package.json` (one export)
- Modify: `apps/web/src/lib/manage/phases-core.ts`, `phases-types.ts`, `airdrop-core.ts`, `settings-core.ts`, `snapshot-core.ts`, `whitelist-core.ts`, `settings-view.ts`, `settings-types.ts`, `settings-view.test.ts`, `phase-calls.ts`, `apps/web/src/components/manage/tradability.tsx`, `apps/web/src/components/manage/settings-sim.ts`
- Modify: `eslint.config.mjs` (whole file: one block added)
- Test: the five shared test files; `apps/web/src/lib/manage/settings-view.test.ts` (loses the cases that moved)

**Interfaces:**

- Consumes: the web app's `readEach`, `revertedRead`, `MULTICALL_GROUP`, `PARALLEL_GROUP` (`apps/web/src/lib/chain/read-each.ts`), `chainStateOf` and `CollectionStateResult` (`phases-core.ts`), `ChainGroup` and `ChainState` (`phases-types.ts`), `TRANSFER_LEVELS`, `TransferLevelValue`, `levelOf` and `pointerOf` (`settings-view.ts`), `TransferLevelState`, `RevealPointer` and `RevealTargets` (`settings-types.ts`), all moved unchanged; `collectionAbi` as a type only from `./collection-abi.ts`; `src/clients.ts` (`publicClientFor`) and `src/server.ts` (the marker), both unchanged.
- Produces:
  - in `@cobweb/shared` (the browser entry): `MULTICALL_GROUP = 500`, `PARALLEL_GROUP = 50`, `revertedRead(error: unknown): boolean`, `readEach<T>(client: PublicClient, calls: readonly ContractFunctionParameters[], options?: { blockNumber?: bigint }): Promise<(T | null)[]>`; `ChainGroup = { id; priceWei; maxSupply; minted; startTimestamp; flag; active }`, `ChainState = { block: bigint; blockTimestamp; maxSupply; totalMinted; publicMaxMintPerWallet; mintOnBehalfActive; groups: ChainGroup[] }`, `CollectionStateResult`, `chainStateOf(state: CollectionStateResult, block: bigint): ChainState`; `TRANSFER_LEVELS = { enforced: 0, open: 1, locked: 9 }`, `TransferLevelValue`, `TransferLevelState = { kind: 'none'; reason: 'zero' | 'no-code' } | { kind: 'unread' } | { kind: 'level'; level: number }`, `levelOf(validator: Address, hasCode: boolean, policyLevel: number | null): TransferLevelState`; `RevealPointer`, `RevealTargets`, `pointerOf(baseUri: string, targets: RevealTargets): RevealPointer`
  - `@cobweb/shared/clients`: `src/clients.ts` (`publicClientFor(chainId: number): PublicClient`, one cached client per chain over `RPC_URL_<id>`)
  - `phases-types.ts` re-exports `ChainGroup` and `ChainState`; `settings-types.ts` re-exports `TransferLevelState`, `RevealPointer` and `RevealTargets`, so every other importer keeps its import
  - under `apps/web/**`, `no-restricted-imports` refuses `@cobweb/shared/clients` with "Import @cobweb/shared/server in the web app: it keeps the server-only marker."

- [ ] **Step 1: Move the readEach test and write the failing shared tests**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
git mv apps/web/src/lib/chain/read-each.test.ts packages/shared/src/read-each.test.ts
```

In `packages/shared/src/read-each.test.ts`, replace:

```ts
import { readEach } from './read-each'
```

with:

```ts
import { readEach } from './read-each.ts'
```

Create `packages/shared/src/collection-state.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { chainStateOf, type ChainState, type CollectionStateResult } from './collection-state.ts'

/** A `collectionState()` answer as viem decodes it: Public scheduled, Holders open with one minted. */
const answer: CollectionStateResult = {
  maxSupply: 5n,
  totalMinted: 1n,
  publicMaxMintPerWallet: 2n,
  mintFeeFlat: 10_000_000_000_000n,
  mintFeeBps: 250n,
  airdropFeePerToken: 100_000_000_000_000n,
  mintOnBehalfActive: true,
  blockTimestamp: 1_791_039_600n,
  groups: [
    {
      id: 0n,
      price: 0n,
      maxSupply: 3n,
      minted: 0n,
      startTimestamp: 1_791_040_200n,
      activeFlag: false,
      active: false,
    },
    {
      id: 1n,
      price: 1_000_000_000_000_000n,
      maxSupply: 2n,
      minted: 1n,
      startTimestamp: 0n,
      activeFlag: true,
      active: true,
    },
  ],
}

describe('chainStateOf (docs/specs/2026-10-16-freshness-server.md, section 5.1)', () => {
  it('maps a collectionState() answer at its block: counts as numbers, prices as decimal strings', () => {
    expect(chainStateOf(answer, 120n)).toEqual<ChainState>({
      block: 120n,
      blockTimestamp: 1_791_039_600,
      maxSupply: 5,
      totalMinted: 1,
      publicMaxMintPerWallet: 2,
      mintOnBehalfActive: true,
      groups: [
        {
          id: 0,
          priceWei: '0',
          maxSupply: 3,
          minted: 0,
          startTimestamp: 1_791_040_200,
          flag: false,
          active: false,
        },
        {
          id: 1,
          priceWei: '1000000000000000',
          maxSupply: 2,
          minted: 1,
          startTimestamp: 0,
          flag: true,
          active: true,
        },
      ],
    })
  })

  it("keeps the contract's group order and a price above 2^53 whole", () => {
    const price = 123_456_789_012_345_678_901n
    const state = chainStateOf(
      { ...answer, groups: [...answer.groups].reverse().map((group) => ({ ...group, price })) },
      7n,
    )
    expect(state.groups.map((group) => [group.id, group.priceWei])).toEqual([
      [1, '123456789012345678901'],
      [0, '123456789012345678901'],
    ])
  })
})
```

The `levelOf` case moves from `settings-view.test.ts` as it is, beside a pin of `TRANSFER_LEVELS`' values.

Create `packages/shared/src/transfer-level.test.ts`:

```ts
import { zeroAddress, type Address } from 'viem'
import { describe, expect, it } from 'vitest'
import { levelOf, TRANSFER_LEVELS } from './transfer-level.ts'

const VALIDATOR: Address = '0x721C008fdff27BF06E7E123956E2Fe03B63342e3'

describe('TRANSFER_LEVELS (docs/specs/2026-10-16-freshness-server.md, section 5.1)', () => {
  it('names the three levels Cobweb sends: royalties enforced, royalties not enforced, and locked', () => {
    expect(TRANSFER_LEVELS).toEqual({ enforced: 0, open: 1, locked: 9 })
  })
})

describe('levelOf', () => {
  it('reads no validator, no code, a validator that did not answer, and a level', () => {
    expect(levelOf(zeroAddress, false, null)).toEqual({ kind: 'none', reason: 'zero' })
    expect(levelOf(VALIDATOR, false, null)).toEqual({ kind: 'none', reason: 'no-code' })
    expect(levelOf(VALIDATOR, true, null)).toEqual({ kind: 'unread' })
    expect(levelOf(VALIDATOR, true, 9)).toEqual({ kind: 'level', level: 9 })
    // Level 0 is the default (royalties enforced): a level, not a validator that did not answer.
    expect(levelOf(VALIDATOR, true, 0)).toEqual({ kind: 'level', level: 0 })
  })
})
```

The `pointerOf` cases move from `settings-view.test.ts` as they are.

Create `packages/shared/src/reveal-pointer.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { pointerOf, type RevealTargets } from './reveal-pointer.ts'

const CID = (letter: string) => `bafybei${letter.repeat(52)}`
const REAL = `ipfs://${CID('e')}/`
const PLACEHOLDER = `ipfs://${CID('q')}/metadata.json`
const targets: RevealTargets = { real: REAL, placeholder: PLACEHOLDER, start: PLACEHOLDER }

describe('pointerOf (docs/specs/2026-10-16-freshness-server.md, section 5.1)', () => {
  it('reads revealed for the real job first, so a collection deployed on its real job reads revealed', () => {
    expect(pointerOf(REAL, { real: REAL, placeholder: null, start: REAL })).toBe('revealed')
    expect(pointerOf(REAL, targets)).toBe('revealed')
  })

  it('reads the placeholder for the placeholder job or the deploy-time link, and custom otherwise, exactly', () => {
    expect(pointerOf(PLACEHOLDER, targets)).toBe('placeholder')
    // Deployed on its real job, then pointed at the placeholder job's link: the placeholder, not custom.
    expect(pointerOf(PLACEHOLDER, { real: REAL, placeholder: PLACEHOLDER, start: REAL })).toBe('placeholder')
    expect(
      pointerOf(`ipfs://${CID('s')}`, { real: null, placeholder: null, start: `ipfs://${CID('s')}` }),
    ).toBe('placeholder')
    expect(pointerOf(`ipfs://${CID('f')}/`, targets)).toBe('custom')
    expect(pointerOf(REAL.slice(0, -1), targets)).toBe('custom')
    expect(pointerOf(REAL, { real: null, placeholder: PLACEHOLDER, start: PLACEHOLDER })).toBe('custom')
  })
})
```

Create `packages/shared/src/entries.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** The package's manifest, for its exports map. */
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  exports: Record<string, string>
}

describe('the clients and server entries (docs/specs/2026-10-16-freshness-server.md, section 5.2)', () => {
  it('exports src/clients.ts as the clients entry, beside the server entry', () => {
    expect(manifest.exports['./clients']).toBe('./src/clients.ts')
    expect(manifest.exports['./server']).toBe('./src/server.ts')
  })

  it('loads the clients entry in plain Node: nothing it imports is server-only', async () => {
    const clients = await import('./clients.ts')
    expect(typeof clients.publicClientFor).toBe('function')
  })

  it('keeps the server-only marker on the server entry, which plain Node refuses to load', async () => {
    await expect(import('./server.ts')).rejects.toThrow(
      'This module cannot be imported from a Client Component module.',
    )
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @cobweb/shared exec vitest run src/read-each.test.ts src/collection-state.test.ts src/transfer-level.test.ts src/reveal-pointer.test.ts src/entries.test.ts`
Expected: FAIL. `read-each.test.ts`, `collection-state.test.ts`, `transfer-level.test.ts` and `reveal-pointer.test.ts` fail to load (`Cannot find module './read-each.ts'`, and likewise for the other three); in `entries.test.ts` "exports src/clients.ts as the clients entry, beside the server entry" fails with `expected undefined to be './src/clients.ts'`, while the two load checks pass (the clients entry already has no marker, and plain Node already refuses the server entry). The run ends `Test Files  5 failed (5)` and `Tests  1 failed | 2 passed (3)`.

- [ ] **Step 3: The readers in the shared package, and the clients entry**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
git mv apps/web/src/lib/chain/read-each.ts packages/shared/src/read-each.ts
```

`read-each.ts` moves as it is: it has no relative import to rewrite.

The types come from `phases-types.ts` and the mapping from `phases-core.ts`, unchanged; the ABI is imported as a type only, so the browser entry gains no ABI at run time.

Create `packages/shared/src/collection-state.ts`:

```ts
import type { ContractFunctionReturnType } from 'viem'
import type { collectionAbi } from './collection-abi.ts'

/**
 * `collectionState()` as Cobweb reads it (docs/specs/2026-10-16-freshness-server.md, section 5.1): the shapes
 * and the mapping the web app's Phases, Airdrop and Settings readers and the freshness server share. Pure.
 * The ABI is imported as a type only, so the browser entry carries no ABI at run time.
 */

/** One group of `collectionState()`, as the screens read it. */
export type ChainGroup = {
  id: number
  priceWei: string
  maxSupply: number
  minted: number
  startTimestamp: number
  /** The raw open flag. */
  flag: boolean
  /** The contract's `mintGroupActive`: the only source of "live". */
  active: boolean
}

/** `collectionState()` as the screens read it: counts as numbers, prices as decimal strings. */
export type ChainState = {
  /** The block the state was read at. */
  block: bigint
  /** The chain's time at that block (Unix seconds). */
  blockTimestamp: number
  maxSupply: number
  totalMinted: number
  publicMaxMintPerWallet: number
  mintOnBehalfActive: boolean
  groups: ChainGroup[]
}

/** What viem answers for `collectionState()`. */
export type CollectionStateResult = ContractFunctionReturnType<
  typeof collectionAbi,
  'view',
  'collectionState'
>

/**
 * `collectionState()` as the screens read it, at the block it was read at: the mapping the Phases, Airdrop
 * and Settings readers share (docs/specs/2026-10-15-airdrop-settings.md, section 6.2).
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
```

The levels, their state and `levelOf` come from `settings-view.ts` and `settings-types.ts`, unchanged.

Create `packages/shared/src/transfer-level.ts`:

```ts
import { zeroAddress, type Address } from 'viem'

/**
 * The collection's transfer level as Cobweb reads it (docs/specs/2026-10-16-freshness-server.md, section
 * 5.1), shared by Settings and the freshness server. Pure.
 */

/** The validator's levels Cobweb sends: royalties enforced, royalties not enforced, and locked. */
export const TRANSFER_LEVELS = { enforced: 0, open: 1, locked: 9 } as const
export type TransferLevelValue = (typeof TRANSFER_LEVELS)[keyof typeof TRANSFER_LEVELS]

/**
 * The collection's transfer level on its validator: none (no validator, or no code at its address), not read
 * (the validator did not answer), or the level the validator holds.
 */
export type TransferLevelState =
  { kind: 'none'; reason: 'zero' | 'no-code' } | { kind: 'unread' } | { kind: 'level'; level: number }

/**
 * The level a read gives: none for the zero address or a validator without code, unread when it did not
 * answer.
 */
export function levelOf(
  validator: Address,
  hasCode: boolean,
  policyLevel: number | null,
): TransferLevelState {
  if (validator.toLowerCase() === zeroAddress) return { kind: 'none', reason: 'zero' }
  if (!hasCode) return { kind: 'none', reason: 'no-code' }
  return policyLevel === null ? { kind: 'unread' } : { kind: 'level', level: policyLevel }
}
```

The pointer, its targets and `pointerOf` come from `settings-view.ts` and `settings-types.ts`, unchanged.

Create `packages/shared/src/reveal-pointer.ts`:

```ts
/**
 * What a collection's base URI points at (docs/specs/2026-10-16-freshness-server.md, section 5.1), shared by
 * Settings, the Overview and the mint page. Pure.
 */

/** What the base URI points at: the rendered metadata, the placeholder, or a link set some other way. */
export type RevealPointer = 'revealed' | 'placeholder' | 'custom'

/**
 * The base URIs Reveal offers: the latest done real job's, the latest done placeholder job's, and the
 * deploy-time one.
 */
export type RevealTargets = { real: string | null; placeholder: string | null; start: string }

/**
 * What the base URI points at, compared exactly: the real job's (checked first, so a collection deployed on
 * its real job reads revealed), the placeholder job's or the deploy-time one, else a custom link.
 */
export function pointerOf(baseUri: string, targets: RevealTargets): RevealPointer {
  if (targets.real !== null && baseUri === targets.real) return 'revealed'
  if (baseUri === targets.placeholder || baseUri === targets.start) return 'placeholder'
  return 'custom'
}
```

Replace the whole of `packages/shared/src/index.ts` with:

```ts
// Browser-safe entry: the chain list, the factory ABI, the job ids, the render queue contract, the deploy
// address helpers, the transfer validator's ABI and the pure chain readers the web app and the freshness server
// share. Nothing here reads a server-only variable.
// Client code must never import `@cobweb/shared/server` (RPC URLs and viem public clients).
export * from './chains.ts'
export * from './collection-state.ts'
export * from './deploy-address.ts'
export * from './factory-abi.ts'
export * from './job-id.ts'
export * from './read-each.ts'
export * from './render-queue.ts'
export * from './reveal-pointer.ts'
export * from './transfer-level.ts'
export * from './validator-abi.ts'
```

In `packages/shared/package.json`, replace:

```json
    "./server": "./src/server.ts",
```

with:

```json
    "./server": "./src/server.ts",
    "./clients": "./src/clients.ts",
```

`src/clients.ts` and `src/server.ts` do not change: `clients.ts` has never carried the marker, and `server.ts` goes on importing `server-only` and re-exporting `clients.ts` and `rpc.ts`.

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm --filter @cobweb/shared exec vitest run src/read-each.test.ts src/collection-state.test.ts src/transfer-level.test.ts src/reveal-pointer.test.ts src/entries.test.ts`
Expected: PASS, 5 files and 15 tests.

- [ ] **Step 5: The web app imports the readers from the shared package**

Behaviour is unchanged (spec section 7.1). `phases-types.ts` and `settings-types.ts` re-export the moved types, so `phases-view.ts`, `phases-view.test.ts`, `settings-dialogs.tsx` and the other type importers keep their imports.

In `apps/web/src/lib/manage/phases-core.ts`, replace:

```ts
import { collectionAbi } from '@cobweb/shared/collection-abi'
import { publicClientFor } from '@cobweb/shared/server'
import {
  getAddress,
  TransactionReceiptNotFoundError,
  type Address,
  type ContractFunctionReturnType,
  type Hex,
  type PublicClient,
} from 'viem'
```

with:

```ts
import { chainStateOf } from '@cobweb/shared'
import { collectionAbi } from '@cobweb/shared/collection-abi'
import { publicClientFor } from '@cobweb/shared/server'
import { getAddress, TransactionReceiptNotFoundError, type Address, type Hex, type PublicClient } from 'viem'
```

In `apps/web/src/lib/manage/phases-core.ts`, replace:

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
```

with:

```ts
export type PhasesContext = DeployContext
```

In `apps/web/src/lib/manage/phases-types.ts`, replace:

```ts
import type { Address } from 'viem'
import type { MintGroup } from '@/lib/demo/types'
```

with:

```ts
import type { ChainState } from '@cobweb/shared'
import type { Address } from 'viem'
import type { MintGroup } from '@/lib/demo/types'
```

In `apps/web/src/lib/manage/phases-types.ts`, replace:

```ts
/** One group of `collectionState()`, as the screens read it. */
export type ChainGroup = {
  id: number
  priceWei: string
  maxSupply: number
  minted: number
  startTimestamp: number
  /** The raw open flag. */
  flag: boolean
  /** The contract's `mintGroupActive`: the only source of "live". */
  active: boolean
}

/** `collectionState()` as the screens read it: counts as numbers, prices as decimal strings. */
export type ChainState = {
  /** The block the state was read at. */
  block: bigint
  /** The chain's time at that block (Unix seconds). */
  blockTimestamp: number
  maxSupply: number
  totalMinted: number
  publicMaxMintPerWallet: number
  mintOnBehalfActive: boolean
  groups: ChainGroup[]
}
```

with:

```ts
/**
 * `collectionState()` as the screens read it: the shapes live in the shared package with their mapping
 * (docs/specs/2026-10-16-freshness-server.md, section 5.1), re-exported so the screens keep their imports.
 */
export type { ChainGroup, ChainState } from '@cobweb/shared'
```

In `apps/web/src/lib/manage/airdrop-core.ts`, replace:

```ts
import { confirmationsFor, hasConfirmations } from '@cobweb/shared'
```

with:

```ts
import {
  chainStateOf,
  confirmationsFor,
  hasConfirmations,
  readEach,
  type CollectionStateResult,
} from '@cobweb/shared'
```

In `apps/web/src/lib/manage/airdrop-core.ts`, replace:

```ts
import { proveAirdrop } from '@/lib/chain/airdrop-batch'
import { readEach } from '@/lib/chain/read-each'
```

with:

```ts
import { proveAirdrop } from '@/lib/chain/airdrop-batch'
```

In `apps/web/src/lib/manage/airdrop-core.ts`, replace:

```ts
import { chainStateOf, phaseBase, type CollectionStateResult, type PhasesContext } from './phases-core'
```

with:

```ts
import { phaseBase, type PhasesContext } from './phases-core'
```

In `apps/web/src/lib/manage/settings-core.ts`, replace:

```ts
import { confirmationsFor, hasConfirmations, validatorAbi } from '@cobweb/shared'
```

with:

```ts
import {
  chainStateOf,
  confirmationsFor,
  hasConfirmations,
  levelOf,
  readEach,
  revertedRead,
  validatorAbi,
  type CollectionStateResult,
} from '@cobweb/shared'
```

In `apps/web/src/lib/manage/settings-core.ts`, replace:

```ts
import { matchPhaseEvent, type PhaseEventMatch } from '@/lib/chain/phase-events'
import { readEach, revertedRead } from '@/lib/chain/read-each'
```

with:

```ts
import { matchPhaseEvent, type PhaseEventMatch } from '@/lib/chain/phase-events'
```

In `apps/web/src/lib/manage/settings-core.ts`, replace:

```ts
import {
  chainStateOf,
  phaseBase,
  refreshPhaseCopies,
  type CollectionStateResult,
  type PhasesContext,
} from './phases-core'
```

with:

```ts
import { phaseBase, refreshPhaseCopies, type PhasesContext } from './phases-core'
```

In `apps/web/src/lib/manage/settings-core.ts`, replace:

```ts
import { levelOf, settingsPayload, settingsViewOf } from './settings-view'
```

with:

```ts
import { settingsPayload, settingsViewOf } from './settings-view'
```

In `apps/web/src/lib/manage/snapshot-core.ts`, replace:

```ts
import { availableChains, chainById } from '@cobweb/shared'
```

with:

```ts
import { availableChains, chainById, readEach, revertedRead } from '@cobweb/shared'
```

In `apps/web/src/lib/manage/snapshot-core.ts`, replace:

```ts
import { readEach, revertedRead } from '@/lib/chain/read-each'
import { holdersOf, SNAPSHOT_MAX_SUPPLY, snapshotIds, type HolderSnapshot } from './holders'
```

with:

```ts
import { holdersOf, SNAPSHOT_MAX_SUPPLY, snapshotIds, type HolderSnapshot } from './holders'
```

In `apps/web/src/lib/manage/whitelist-core.ts`, replace:

```ts
import { confirmationsFor, hasConfirmations } from '@cobweb/shared'
```

with:

```ts
import { confirmationsFor, hasConfirmations, readEach } from '@cobweb/shared'
```

In `apps/web/src/lib/manage/whitelist-core.ts`, replace:

```ts
import { proveQuotaChunk } from '@/lib/chain/quota-chunk'
import { readEach } from '@/lib/chain/read-each'
```

with:

```ts
import { proveQuotaChunk } from '@/lib/chain/quota-chunk'
```

In `apps/web/src/lib/manage/settings-view.ts`, replace:

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
```

with:

```ts
import { pointerOf } from '@cobweb/shared'
import { getAddress, type Address } from 'viem'
import type { RevealTargets, SettingsCopyRow, SettingsState, SettingsView } from './settings-types'

/**
 * The Settings view, pure (docs/specs/2026-10-15-airdrop-settings.md, section 6.1), for the browser and the
 * server: the IPFS links Reveal takes, token 1's URI by the contract's rule, and the view from a read or the
 * copies. The transfer levels, `levelOf` and `pointerOf` live in the shared package
 * (docs/specs/2026-10-16-freshness-server.md, section 5.1).
 */
```

In `apps/web/src/lib/manage/settings-view.ts`, replace:

```ts
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
```

with:

```ts
  return `${base}1`
}
```

In `apps/web/src/lib/manage/settings-types.ts`, replace:

```ts
import type { Address } from 'viem'
import type { PreparedArgs } from '@/lib/deploy/deploy-types'
```

with:

```ts
import type { RevealPointer, RevealTargets, TransferLevelState } from '@cobweb/shared'
import type { Address } from 'viem'
import type { PreparedArgs } from '@/lib/deploy/deploy-types'
```

In `apps/web/src/lib/manage/settings-types.ts`, replace:

```ts
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
```

with:

```ts
/**
 * The transfer level and what the base URI points at: the shapes live in the shared package with `levelOf` and
 * `pointerOf` (docs/specs/2026-10-16-freshness-server.md, section 5.1), re-exported so the screens keep their
 * imports.
 */
export type { RevealPointer, RevealTargets, TransferLevelState } from '@cobweb/shared'
```

In `apps/web/src/lib/manage/settings-view.test.ts`, replace:

```ts
import {
  ipfsUriValid,
  levelOf,
  pointerOf,
  settingsPayload,
  settingsViewOf,
  tokenUriOf,
} from './settings-view'
```

with:

```ts
import { ipfsUriValid, settingsPayload, settingsViewOf, tokenUriOf } from './settings-view'
```

In `apps/web/src/lib/manage/settings-view.test.ts`, replace:

```ts
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
    // Deployed on its real job, then pointed at the placeholder job's link: the placeholder, not custom.
    expect(pointerOf(PLACEHOLDER, { real: REAL, placeholder: PLACEHOLDER, start: REAL })).toBe('placeholder')
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
    // Level 0 is the default (royalties enforced): a level, not a validator that did not answer.
    expect(levelOf(VALIDATOR, true, 0)).toEqual({ kind: 'level', level: 0 })
  })
})
```

with:

```ts
    expect(tokenUriOf('')).toBe('')
  })
})
```

In `apps/web/src/lib/manage/phase-calls.ts`, replace:

```ts
import { validatorAbi } from '@cobweb/shared'
```

with:

```ts
import { TRANSFER_LEVELS, validatorAbi, type TransferLevelValue } from '@cobweb/shared'
```

In `apps/web/src/lib/manage/phase-calls.ts`, replace:

```ts
import { BURN_ADDRESS, tokensOf } from './airdrop-view'
import { TRANSFER_LEVELS, type TransferLevelValue } from './settings-view'
```

with:

```ts
import { BURN_ADDRESS, tokensOf } from './airdrop-view'
```

In `apps/web/src/components/manage/tradability.tsx`, replace:

```ts
import { DEFAULT_TRANSFER_VALIDATOR } from '@cobweb/shared'
```

with:

```ts
import { DEFAULT_TRANSFER_VALIDATOR, TRANSFER_LEVELS, type TransferLevelValue } from '@cobweb/shared'
```

In `apps/web/src/components/manage/tradability.tsx`, replace:

```ts
import type { SettingsView, TransferLevelState } from '@/lib/manage/settings-types'
import { TRANSFER_LEVELS, type TransferLevelValue } from '@/lib/manage/settings-view'
```

with:

```ts
import type { SettingsView, TransferLevelState } from '@/lib/manage/settings-types'
```

In `apps/web/src/components/manage/settings-sim.ts`, replace:

```ts
import { DEFAULT_TRANSFER_VALIDATOR } from '@cobweb/shared'
```

with:

```ts
import { DEFAULT_TRANSFER_VALIDATOR, pointerOf, TRANSFER_LEVELS } from '@cobweb/shared'
```

In `apps/web/src/components/manage/settings-sim.ts`, replace:

```ts
import { pointerOf, settingsViewOf, TRANSFER_LEVELS } from '@/lib/manage/settings-view'
```

with:

```ts
import { settingsViewOf } from '@/lib/manage/settings-view'
```

- [ ] **Step 6: The lint rule**

Run: `printf "import { publicClientFor } from '@cobweb/shared/clients'\n\nexport const probe = publicClientFor\n" | pnpm exec eslint --stdin --stdin-filename apps/web/src/lint-probe.ts`
Expected: no output and exit code 0: nothing refuses the import yet. The probe is read from stdin, so no file is written.

Replace the whole of `eslint.config.mjs` with:

```js
import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/.turbo/**', 'legacy/**', 'contracts/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // The web app reads chains through @cobweb/shared/server, whose server-only marker keeps the RPC URLs out
    // of the browser bundle. The clients entry is the freshness server's
    // (docs/specs/2026-10-16-freshness-server.md, section 7.3).
    files: ['apps/web/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@cobweb/shared/clients',
              message: 'Import @cobweb/shared/server in the web app: it keeps the server-only marker.',
            },
          ],
        },
      ],
    },
  },
)
```

Run: `printf "import { publicClientFor } from '@cobweb/shared/clients'\n\nexport const probe = publicClientFor\n" | pnpm exec eslint --stdin --stdin-filename apps/web/src/lint-probe.ts`
Expected: exit code 1 with `1:1  error  '@cobweb/shared/clients' import is restricted from being used. Import @cobweb/shared/server in the web app: it keeps the server-only marker  no-restricted-imports` (the formatter drops the message's final period). The same probe named `apps/freshness/src/lint-probe.ts` passes: the rule is the web app's only.

- [ ] **Step 7: Run the web app's tests and typecheck**

Run: `pnpm --filter @cobweb/web test`
Expected: PASS, 696 tests in 73 files (705 in 74 before: `read-each.test.ts`'s six tests moved to the shared package, and the three `pointerOf` and `levelOf` cases left `settings-view.test.ts`).

Run: `pnpm --filter @cobweb/web typecheck && pnpm --filter @cobweb/shared typecheck`
Expected: no errors.

- [ ] **Step 8: Format, run the root checks and commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
pnpm exec prettier --write packages/shared/src/read-each.ts packages/shared/src/read-each.test.ts packages/shared/src/collection-state.ts packages/shared/src/collection-state.test.ts packages/shared/src/transfer-level.ts packages/shared/src/transfer-level.test.ts packages/shared/src/reveal-pointer.ts packages/shared/src/reveal-pointer.test.ts packages/shared/src/entries.test.ts packages/shared/src/index.ts packages/shared/package.json apps/web/src/lib/manage/phases-core.ts apps/web/src/lib/manage/phases-types.ts apps/web/src/lib/manage/airdrop-core.ts apps/web/src/lib/manage/settings-core.ts apps/web/src/lib/manage/snapshot-core.ts apps/web/src/lib/manage/whitelist-core.ts apps/web/src/lib/manage/settings-view.ts apps/web/src/lib/manage/settings-types.ts apps/web/src/lib/manage/settings-view.test.ts apps/web/src/lib/manage/phase-calls.ts apps/web/src/components/manage/tradability.tsx apps/web/src/components/manage/settings-sim.ts eslint.config.mjs
pnpm typecheck && pnpm lint && pnpm test
git add packages/shared/src/read-each.ts packages/shared/src/read-each.test.ts packages/shared/src/collection-state.ts packages/shared/src/collection-state.test.ts packages/shared/src/transfer-level.ts packages/shared/src/transfer-level.test.ts packages/shared/src/reveal-pointer.ts packages/shared/src/reveal-pointer.test.ts packages/shared/src/entries.test.ts packages/shared/src/index.ts packages/shared/package.json apps/web/src/lib/manage/phases-core.ts apps/web/src/lib/manage/phases-types.ts apps/web/src/lib/manage/airdrop-core.ts apps/web/src/lib/manage/settings-core.ts apps/web/src/lib/manage/snapshot-core.ts apps/web/src/lib/manage/whitelist-core.ts apps/web/src/lib/manage/settings-view.ts apps/web/src/lib/manage/settings-types.ts apps/web/src/lib/manage/settings-view.test.ts apps/web/src/lib/manage/phase-calls.ts apps/web/src/components/manage/tradability.tsx apps/web/src/components/manage/settings-sim.ts eslint.config.mjs
git commit -m "$(cat <<'EOF'
Move the pure chain readers into the shared package with their tests, export the client factory as its clients entry, and point the web app at the shared readers with a lint rule that keeps it on the server entry

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: the shared package reports 95 tests in 12 files (80 in 7 before); the web package 696 in 73 (705 in 74 before); `git show --stat HEAD` lists the two renames.

---

### Task 2: `COBWEB_TEST_CHAINS` and Robinhood Chain Testnet in the shared chain list, the browser bundle and the wallet's chains

**Files:**

- Modify: `packages/shared/src/chains.ts` (whole file), `packages/shared/src/rpc.ts` (whole file), `packages/shared/src/chains.test.ts`
- Modify: `apps/web/next.config.ts` (the `env` key), `apps/web/src/lib/wagmi.ts` (whole file), `apps/web/.env.example` (the variable documented)
- Test: `packages/shared/src/chains.test.ts`

**Interfaces:**

- Consumes: viem's `robinhoodTestnet` (`viem/chains`, and `wagmi/chains`, which re-exports viem's: id 46630, "Robinhood Chain Testnet", Blockscout, `multicall3`); the existing `availableChains`, `chainById`, `confirmationsFor`, `factoryAddress` and `rpcUrl`, whose callers all take the default.
- Produces: in `@cobweb/shared`, `TEST_CHAINS` = Sepolia (2 confirmations), Robinhood Chain Testnet (46630, 3), Anvil (1); `hidesTestChains(): boolean` = `process.env.NODE_ENV === 'production' && process.env.COBWEB_TEST_CHAINS !== '1'`, in place of `isProduction`, which nothing else read; `availableChains(hideTestChains = hidesTestChains())`, and `chainById`, `confirmationsFor`, `factoryAddress` and `rpcUrl` with the same default. In the web app: `next.config.ts` `env: { COBWEB_TEST_CHAINS: process.env.COBWEB_TEST_CHAINS ?? '' }`; `wagmi.ts`'s `chains` adds Sepolia, Robinhood Chain Testnet and Anvil unless `hidesTestChains()`.

- [ ] **Step 1: Write the failing tests**

In `packages/shared/src/chains.test.ts`, replace:

```ts
import { describe, expect, it } from 'vitest'
import {
  availableChains,
  chainById,
  confirmationsFor,
  factoryAddress,
  hasConfirmations,
  isLocalUrl,
  LAUNCH_CHAINS,
} from './chains.ts'
```

with:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  availableChains,
  chainById,
  confirmationsFor,
  factoryAddress,
  hasConfirmations,
  hidesTestChains,
  isLocalUrl,
  LAUNCH_CHAINS,
  TEST_CHAINS,
} from './chains.ts'
```

In `packages/shared/src/chains.test.ts`, replace:

```ts
  it('names the six launch chains and adds Sepolia and Anvil outside production', () => {
    expect(LAUNCH_CHAINS.map((chain) => chain.id)).toEqual(LAUNCH_IDS)
    expect(availableChains(true).map((chain) => chain.id)).toEqual(LAUNCH_IDS)
    expect(availableChains(false).map((chain) => chain.id)).toEqual([...LAUNCH_IDS, 11155111, 31337])
```

with:

```ts
  it('names the six launch chains and adds Sepolia, Robinhood Chain Testnet and Anvil outside production', () => {
    expect(LAUNCH_CHAINS.map((chain) => chain.id)).toEqual(LAUNCH_IDS)
    expect(availableChains(true).map((chain) => chain.id)).toEqual(LAUNCH_IDS)
    expect(availableChains(false).map((chain) => chain.id)).toEqual([...LAUNCH_IDS, 11155111, 46630, 31337])
```

In `packages/shared/src/chains.test.ts`, replace:

```ts
    expect(chainById(80094, true)?.nativeSymbol).toBe('BERA')
    expect(chainById(31337, false)).toMatchObject({ explorerUrl: '', testnet: true })
  })
})
```

with:

```ts
    expect(chainById(80094, true)?.nativeSymbol).toBe('BERA')
    expect(chainById(31337, false)).toMatchObject({ explorerUrl: '', testnet: true })
  })

  it("lists Robinhood Chain Testnet among the test chains, with Robinhood Chain's 3 confirmations", () => {
    expect(TEST_CHAINS.map((chain) => chain.id)).toEqual([11155111, 46630, 31337])
    expect(chainById(46630, false)).toMatchObject({
      name: 'Robinhood Chain Testnet',
      nativeSymbol: 'ETH',
      explorerUrl: 'https://explorer.testnet.chain.robinhood.com',
      rpcEnv: 'RPC_URL_46630',
      factoryEnv: 'FACTORY_ADDRESS_46630',
      testnet: true,
      confirmations: 3,
    })
    expect(chainById(46630, false)?.viem.contracts?.multicall3).toBeDefined()
    expect(chainById(46630, true)).toBeUndefined()
  })
})
```

At the end of `packages/shared/src/chains.test.ts`, append:

```ts

describe('the test-chain switch (docs/specs/2026-10-16-freshness-server.md, section 5.4)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  const ids = () => availableChains().map((chain) => chain.id)
  const env = {
    RPC_URL_46630: 'https://rpc.example',
    FACTORY_ADDRESS_46630: '0x5fbdb2315678afecb367f032d93f642f64180aa3',
  }

  it('hides the test chains in production, and shows them anywhere else', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('COBWEB_TEST_CHAINS', undefined)
    expect(hidesTestChains()).toBe(true)
    expect(ids()).toEqual(LAUNCH_IDS)
    vi.stubEnv('NODE_ENV', 'development')
    expect(hidesTestChains()).toBe(false)
    expect(ids()).toEqual([...LAUNCH_IDS, 11155111, 46630, 31337])
  })

  it('shows them in production with COBWEB_TEST_CHAINS=1, to every reader that takes the default', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('COBWEB_TEST_CHAINS', '1')
    expect(hidesTestChains()).toBe(false)
    expect(ids()).toEqual([...LAUNCH_IDS, 11155111, 46630, 31337])
    expect(chainById(46630)?.name).toBe('Robinhood Chain Testnet')
    expect(confirmationsFor(31337)).toBe(1)
    expect(factoryAddress(46630, env)).toBe('0x5FbDB2315678afecb367f032d93F642f64180aa3')
    expect(rpcUrl(46630, env)).toBe('https://rpc.example')
  })

  it('takes no value but 1', () => {
    vi.stubEnv('NODE_ENV', 'production')
    for (const value of ['', '0', 'true', 'yes', ' 1', '01']) {
      vi.stubEnv('COBWEB_TEST_CHAINS', value)
      expect(hidesTestChains()).toBe(true)
      expect(chainById(31337)).toBeUndefined()
      expect(() => rpcUrl(46630, env)).toThrow('The RPC URL for chain 46630 is not configured.')
    }
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @cobweb/shared exec vitest run src/chains.test.ts`
Expected: FAIL. The first test fails on the list (`expected [ 1, 42161, 8453, 80094, 143, …(3) ] to deeply equal [ 1, 42161, 8453, 80094, 143, …(4) ]`), the Robinhood Chain Testnet test on `TEST_CHAINS` (`expected [ 11155111, 31337 ] to deeply equal [ 11155111, 46630, 31337 ]`), and the three switch tests with `TypeError: hidesTestChains is not a function`. The run ends `Tests  5 failed | 6 passed (11)`.

- [ ] **Step 3: The switch and the chain**

Replace the whole of `packages/shared/src/chains.ts` with:

```ts
import { getAddress, isAddress, type Address } from 'viem'
import {
  anvil,
  arbitrum,
  base,
  berachain,
  mainnet,
  monad,
  robinhood,
  robinhoodTestnet,
  sepolia,
  type Chain,
} from 'viem/chains'

/**
 * The chains Cobweb runs on (CLAUDE.md, launch chains) plus the test chains: Sepolia, Robinhood Chain Testnet
 * and a local Anvil chain, shown outside production and, with COBWEB_TEST_CHAINS=1, in a hosted test
 * environment (docs/specs/2026-10-16-freshness-server.md, section 5.4). Each names the environment variables
 * that configure it: `RPC_URL_<id>` (server only) and `FACTORY_ADDRESS_<id>`. A chain is ready for payments
 * when both are set.
 */
export type ChainConfig = {
  id: number
  name: string
  nativeSymbol: string
  /** Block explorer root, or '' where there is none (Anvil). */
  explorerUrl: string
  rpcEnv: string
  factoryEnv: string
  testnet: boolean
  /** Blocks (the receipt's own included) a payment must be buried under before it is recorded. */
  confirmations: number
  viem: Chain
}

export type Env = Record<string, string | undefined>

function entry(chain: Chain, name: string, testnet: boolean, confirmations: number): ChainConfig {
  return {
    id: chain.id,
    name,
    nativeSymbol: chain.nativeCurrency.symbol,
    explorerUrl: chain.blockExplorers?.default.url ?? '',
    rpcEnv: `RPC_URL_${chain.id}`,
    factoryEnv: `FACTORY_ADDRESS_${chain.id}`,
    testnet,
    confirmations,
    viem: chain,
  }
}

export const LAUNCH_CHAINS: readonly ChainConfig[] = [
  entry(mainnet, 'Ethereum', false, 5),
  entry(arbitrum, 'Arbitrum', false, 3),
  entry(base, 'Base', false, 3),
  entry(berachain, 'Berachain', false, 3),
  entry(monad, 'Monad', false, 3),
  entry(robinhood, 'Robinhood Chain', false, 3),
]

/** Robinhood Chain Testnet rehearses Robinhood Chain, so it asks for the same 3 confirmations. */
export const TEST_CHAINS: readonly ChainConfig[] = [
  entry(sepolia, 'Sepolia', true, 2),
  entry(robinhoodTestnet, 'Robinhood Chain Testnet', true, 3),
  entry(anvil, 'Anvil', true, 1),
]

/**
 * Whether the test chains are hidden: in production, unless COBWEB_TEST_CHAINS is 1 (a hosted test
 * environment). Both variables are read as literal `process.env.NAME` expressions, which Next replaces in the
 * browser bundle.
 */
export const hidesTestChains = () =>
  process.env.NODE_ENV === 'production' && process.env.COBWEB_TEST_CHAINS !== '1'

export function availableChains(hideTestChains = hidesTestChains()): readonly ChainConfig[] {
  return hideTestChains ? LAUNCH_CHAINS : [...LAUNCH_CHAINS, ...TEST_CHAINS]
}

export function chainById(id: number, hideTestChains = hidesTestChains()): ChainConfig | undefined {
  return availableChains(hideTestChains).find((chain) => chain.id === id)
}

/** How many blocks deep a payment must be on a chain. Throws a sentence for a chain that is not offered. */
export function confirmationsFor(id: number, hideTestChains = hidesTestChains()): number {
  const chain = chainById(id, hideTestChains)
  if (!chain) throw new Error(`Chain ${id} is not configured.`)
  return chain.confirmations
}

/** Whether a receipt mined in `receiptBlock` is buried under `required` blocks (itself counted) at `latest`. */
export function hasConfirmations(receiptBlock: bigint, latest: bigint, required: number): boolean {
  return latest - receiptBlock + 1n >= BigInt(required)
}

/** The factory on a chain, checksummed. Throws a sentence when the chain or its variable is not set. */
export function factoryAddress(
  id: number,
  env: Env = process.env,
  hideTestChains = hidesTestChains(),
): Address {
  const chain = chainById(id, hideTestChains)
  const value = chain ? env[chain.factoryEnv] : undefined
  if (!value || !isAddress(value, { strict: false }))
    throw new Error(`The factory address for chain ${id} is not configured.`)
  return getAddress(value)
}

/** Whether a URL points at this machine. The scripts refuse anything else. */
export function isLocalUrl(url: string): boolean {
  try {
    return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(new URL(url).hostname)
  } catch {
    return false
  }
}
```

Replace the whole of `packages/shared/src/rpc.ts` with:

```ts
import { chainById, hidesTestChains, type Env } from './chains.ts'

/** The chain's RPC URL, for server code. Throws a sentence when the chain or its variable is not set. */
export function rpcUrl(id: number, env: Env = process.env, hideTestChains = hidesTestChains()): string {
  const chain = chainById(id, hideTestChains)
  const value = chain ? env[chain.rpcEnv] : undefined
  if (!value) throw new Error(`The RPC URL for chain ${id} is not configured.`)
  return value
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm --filter @cobweb/shared exec vitest run src/chains.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: The switch in the browser bundle and the wallet's chains**

Next replaces `process.env.COBWEB_TEST_CHAINS` with the build's value wherever it is written as that literal expression (`next.config.ts`'s `env`, spec section 7.2), so the browser's chain names and the wallet's chains agree with the server's on a hosted test environment.

In `apps/web/next.config.ts`, replace:

```ts
  poweredByHeader: false,
```

with:

```ts
  poweredByHeader: false,
  // The test-chain switch (docs/specs/2026-10-16-freshness-server.md, section 7.2): Next replaces
  // process.env.COBWEB_TEST_CHAINS with the build's value, so the browser's chain list matches the server's.
  env: { COBWEB_TEST_CHAINS: process.env.COBWEB_TEST_CHAINS ?? '' },
```

In `apps/web/.env.example`, replace:

```
RPC_URL_31337=
FACTORY_ADDRESS_31337=
```

with:

```
RPC_URL_31337=
FACTORY_ADDRESS_31337=

# 1 shows Sepolia, Robinhood Chain Testnet and Anvil where NODE_ENV=production hides them. A hosted test
# environment only.
COBWEB_TEST_CHAINS=
```

Replace the whole of `apps/web/src/lib/wagmi.ts` with:

```ts
import { hidesTestChains } from '@cobweb/shared'
import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import {
  anvil,
  arbitrum,
  base,
  berachain,
  mainnet,
  monad,
  robinhood,
  robinhoodTestnet,
  sepolia,
} from 'wagmi/chains'

/**
 * The chains Cobweb launches on, plus Sepolia, Robinhood Chain Testnet and a local Anvil chain for testing,
 * unless the shared rule hides them: production without COBWEB_TEST_CHAINS=1
 * (docs/specs/2026-10-16-freshness-server.md, section 7.2).
 */
const launchChains = [mainnet, arbitrum, base, berachain, monad, robinhood] as const

export const chains = hidesTestChains()
  ? launchChains
  : ([...launchChains, sepolia, robinhoodTestnet, anvil] as const)

export const wagmiConfig = getDefaultConfig({
  appName: 'Cobweb',
  // Without a real id, WalletConnect (QR and mobile wallets) will not connect. Browser-extension
  // wallets still work.
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'missing-walletconnect-project-id',
  chains,
  ssr: true,
})
```

- [ ] **Step 6: Typecheck and build**

Run: `pnpm --filter @cobweb/web typecheck && pnpm --filter @cobweb/web build`
Expected: no type error; the build passes.

Run: `grep -rl COBWEB_TEST_CHAINS apps/web/.next/static | wc -l`
Expected: `0`: no browser chunk names the variable, since Next replaced it with the build's value.

- [ ] **Step 7: Format, run the root checks and commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
pnpm exec prettier --write packages/shared/src/chains.ts packages/shared/src/rpc.ts packages/shared/src/chains.test.ts apps/web/next.config.ts apps/web/src/lib/wagmi.ts
pnpm typecheck && pnpm lint && pnpm test
git add packages/shared/src/chains.ts packages/shared/src/rpc.ts packages/shared/src/chains.test.ts apps/web/next.config.ts apps/web/src/lib/wagmi.ts apps/web/.env.example
git commit -m "$(cat <<'EOF'
Show Sepolia, Robinhood Chain Testnet and Anvil under production when COBWEB_TEST_CHAINS is 1, in the shared chain list, the browser bundle and the wallet's chains

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: the shared package reports 99 tests (95 before, plus 4); the web package is unchanged at 696.

---

### Task 3: The freshness server's package: its start from source on Node 24, and the chains it serves

**Files:**

- Modify: `apps/freshness/package.json` (whole file), `apps/freshness/tsconfig.json` (whole file), `pnpm-lock.yaml` (by `pnpm install --offline`)
- Create: `apps/freshness/src/config.ts`, `apps/freshness/src/config.test.ts`, `apps/freshness/.env.example`
- Test: `apps/freshness/src/config.test.ts`

**Interfaces:**

- Consumes: `availableChains` and `ChainConfig` from `@cobweb/shared` (Task 2's switch included); viem `^2.57.2`, the version the workspace already uses.
- Produces: the package `@cobweb/freshness` with `"engines": { "node": ">=24" }`, `"exports": { "./server": "./src/server.ts" }` (Task 7 writes the file), the scripts `start` (`node src/index.ts`), `dev` (`node --watch --env-file-if-exists=.env src/index.ts`), `typecheck`, `lint` and `test` (`vitest run`), and the dependencies `@cobweb/shared` and `viem`; its `tsconfig.json` with `"types": ["node"]`, `allowImportingTsExtensions` and `erasableSyntaxOnly`. In `apps/freshness/src/config.ts`: `DEFAULT_PORT = 3100`; `servedChains(chainIds?: number[]): ChainConfig[]`, each of `availableChains()` whose `RPC_URL_<id>` and `FACTORY_ADDRESS_<id>` are both set, in the list's order, limited to `chainIds` when given.

- [ ] **Step 1: The package and its install**

Replace the whole of `apps/freshness/package.json` with:

```json
{
  "name": "@cobweb/freshness",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=24"
  },
  "exports": {
    "./server": "./src/server.ts"
  },
  "scripts": {
    "start": "node src/index.ts",
    "dev": "node --watch --env-file-if-exists=.env src/index.ts",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "test": "vitest run"
  },
  "dependencies": {
    "@cobweb/shared": "workspace:^",
    "viem": "^2.57.2"
  }
}
```

Replace the whole of `apps/freshness/tsconfig.json` with:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["node"], "allowImportingTsExtensions": true, "erasableSyntaxOnly": true },
  "include": ["src"]
}
```

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
pnpm install --offline
git diff --stat pnpm-lock.yaml
```

Expected: `pnpm-lock.yaml | 11 +++++++++--`: the `apps/freshness` importer gains `@cobweb/shared` (`link:../../packages/shared`) and `viem` 2.57.2, and `@scure/bip32@1.7.0` now points at `@noble/curves` 1.9.7, the version viem already brings, in place of 1.9.1. `apps/freshness/node_modules` links both. `src/index.ts` stays `export {}` until Task 7.

- [ ] **Step 2: Write the failing test**

Create `apps/freshness/src/config.test.ts`:

```ts
import { availableChains } from '@cobweb/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PORT, servedChains } from './config.ts'

const FACTORY = '0x5FbDB2315678afecb367f032d93F642f64180aa3'

describe('servedChains (docs/specs/2026-10-16-freshness-server.md, section 6.2)', () => {
  beforeEach(() => {
    // No chain variable from the shell leaks in: every chain starts unset.
    for (const chain of availableChains(false)) {
      vi.stubEnv(chain.rpcEnv, undefined)
      vi.stubEnv(chain.factoryEnv, undefined)
    }
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('serves each available chain whose RPC URL and factory are both set, in the list order', () => {
    vi.stubEnv('RPC_URL_31337', 'http://127.0.0.1:8545')
    vi.stubEnv('FACTORY_ADDRESS_31337', FACTORY)
    vi.stubEnv('RPC_URL_8453', 'https://base.example')
    vi.stubEnv('FACTORY_ADDRESS_1', FACTORY)
    vi.stubEnv('RPC_URL_46630', 'https://robinhood-testnet.example')
    vi.stubEnv('FACTORY_ADDRESS_46630', FACTORY)
    expect(servedChains().map((chain) => chain.id)).toEqual([46630, 31337])
  })

  it('limits the chains to the ids given', () => {
    vi.stubEnv('RPC_URL_31337', 'http://127.0.0.1:8545')
    vi.stubEnv('FACTORY_ADDRESS_31337', FACTORY)
    vi.stubEnv('RPC_URL_46630', 'https://robinhood-testnet.example')
    vi.stubEnv('FACTORY_ADDRESS_46630', FACTORY)
    expect(servedChains([31337]).map((chain) => chain.id)).toEqual([31337])
    expect(servedChains([999])).toEqual([])
  })

  it('serves a test chain under production only with COBWEB_TEST_CHAINS=1', () => {
    vi.stubEnv('RPC_URL_31337', 'http://127.0.0.1:8545')
    vi.stubEnv('FACTORY_ADDRESS_31337', FACTORY)
    vi.stubEnv('NODE_ENV', 'production')
    expect(servedChains()).toEqual([])
    vi.stubEnv('COBWEB_TEST_CHAINS', '1')
    expect(servedChains().map((chain) => chain.name)).toEqual(['Anvil'])
  })

  it('listens on 3100 when PORT is unset', () => {
    expect(DEFAULT_PORT).toBe(3100)
  })
})
```

- [ ] **Step 3: Run the test to see it fail**

Run: `pnpm --filter @cobweb/freshness exec vitest run src/config.test.ts`
Expected: FAIL. The file fails to load with `Error: Cannot find module './config.ts'`. The run ends `Test Files  1 failed (1)` and `Tests  no tests`.

- [ ] **Step 4: The configuration**

Create `apps/freshness/src/config.ts`:

```ts
import { availableChains, type ChainConfig } from '@cobweb/shared'

/**
 * The freshness server's settings (docs/specs/2026-10-16-freshness-server.md, section 6.2): `PORT` (Railway
 * sets it), `NODE_ENV` and `COBWEB_TEST_CHAINS` (which chains are available), and per chain `RPC_URL_<id>`
 * and `FACTORY_ADDRESS_<id>`, the names the web app uses.
 */

/** The port the server listens on when PORT is unset. */
export const DEFAULT_PORT = 3100

/**
 * The chains the server reads: each of `availableChains()` whose `RPC_URL_<id>` and `FACTORY_ADDRESS_<id>`
 * are both set, limited to `chainIds` when given. The server reads them once, at start.
 */
export function servedChains(chainIds?: number[]): ChainConfig[] {
  return availableChains().filter(
    (chain) =>
      Boolean(process.env[chain.rpcEnv]) &&
      Boolean(process.env[chain.factoryEnv]) &&
      (chainIds === undefined || chainIds.includes(chain.id)),
  )
}
```

The example holds the names only; `dev` reads `apps/freshness/.env` when it exists, which the root `.gitignore` already ignores.

Create `apps/freshness/.env.example`:

```
# The freshness server's settings (docs/specs/2026-10-16-freshness-server.md, section 6.2). Copy to
# apps/freshness/.env for `pnpm --filter @cobweb/freshness dev`, which reads it when it exists. Never commit it.
# On Railway these are the service's variables.

# The port to listen on. Railway sets it; 3100 when unset.
PORT=

# production hides Sepolia, Robinhood Chain Testnet and Anvil.
NODE_ENV=
# 1 shows Sepolia, Robinhood Chain Testnet and Anvil where NODE_ENV=production hides them. A hosted test
# environment only.
COBWEB_TEST_CHAINS=

# Per chain: the server reads a chain when both of its variables are set. RPC_URL_<id> is a secret (the URL
# carries the provider's key) and never leaves the server; FACTORY_ADDRESS_<id> is the Cobweb factory there.
# For a local chain run `pnpm --filter @cobweb/web chain:local` and copy the two lines it prints.
# Ethereum
RPC_URL_1=
FACTORY_ADDRESS_1=
# Arbitrum
RPC_URL_42161=
FACTORY_ADDRESS_42161=
# Base
RPC_URL_8453=
FACTORY_ADDRESS_8453=
# Berachain
RPC_URL_80094=
FACTORY_ADDRESS_80094=
# Monad
RPC_URL_143=
FACTORY_ADDRESS_143=
# Robinhood Chain
RPC_URL_4663=
FACTORY_ADDRESS_4663=
# Sepolia (a test chain)
RPC_URL_11155111=
FACTORY_ADDRESS_11155111=
# Robinhood Chain Testnet (a test chain)
RPC_URL_46630=
FACTORY_ADDRESS_46630=
# Anvil (a test chain)
RPC_URL_31337=
FACTORY_ADDRESS_31337=
```

- [ ] **Step 5: Run the test to see it pass, then typecheck and lint the package**

Run: `pnpm --filter @cobweb/freshness exec vitest run src/config.test.ts`
Expected: PASS, 4 tests.

Run: `pnpm --filter @cobweb/freshness typecheck && pnpm --filter @cobweb/freshness lint`
Expected: no errors and no warnings.

- [ ] **Step 6: Format, run the root checks and commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
pnpm exec prettier --write apps/freshness/package.json apps/freshness/tsconfig.json apps/freshness/src/config.ts apps/freshness/src/config.test.ts
pnpm typecheck && pnpm lint && pnpm test
git add apps/freshness/package.json apps/freshness/tsconfig.json apps/freshness/src/config.ts apps/freshness/src/config.test.ts apps/freshness/.env.example pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
Set up the freshness server's package to run its TypeScript source on Node 24 with the shared package and viem, and read the chains it serves from their two variables

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: the freshness package reports 4 tests in 1 file; the shared (99) and web (696) packages are unchanged.

---

### Task 4: The hot set, the collection check and the tiers with `degraded`

**Files:**

- Create: `apps/freshness/src/hot-set.ts`, `collection-check.ts`, `tiers.ts`, `chain-reader.ts` (the read's types; Task 5 writes the reader), and the tests `hot-set.test.ts`, `collection-check.test.ts`, `tiers.test.ts`
- Test: the three test files

**Interfaces:**

- Consumes: `ChainState`, `ChainGroup` and `TransferLevelState` from `@cobweb/shared` (Task 1); viem's `getAddress`.
- Produces:
  - `chain-reader.ts`: `FeeWei = { mintFeeFlatWei: string; mintFeeBps: number; airdropFeePerTokenWei: string }`, `Extras = { owner: Address; royalty: { receiver: Address; bps: number }; baseUri: string; transferValidator: Address; transferLevel: TransferLevelState }`, `CollectionRead = { state: ChainState; fees: FeeWei; extras: Extras }`
  - `hot-set.ts`: `HOT_TTL_MS = 600_000`, `JOIN_WAIT_MS = 2_000`; `HotEntry = { chainId; address: Address (checksummed); joinedAt; requestedAt; read: CollectionRead | null; readAt: number | null; extrasReadAt: number | null; marked: boolean }` (times in milliseconds); `hotSet(): { join(chainId, address, now): { entry: HotEntry; joined: boolean }; onChain(chainId): HotEntry[]; expire(now): HotEntry[]; size(chainId?): number }`, keyed by the chain and the lowercase address, a new entry marked and unread, `join` refreshing `requestedAt`, `expire` dropping every entry with no request for 10 minutes or more; `HotSet = ReturnType<typeof hotSet>`
  - `collection-check.ts`: `NEGATIVE_TTL_MS = 60_000`, `NEGATIVE_MAX = 10_000`; `collectionCheck(read: (chainId, address) => Promise<boolean>, now?: () => number): (chainId, address) => Promise<boolean>`
  - `tiers.ts`: `TIER_MS = { fast: 1_000, live: 2_000, idle: 20_000 }`, `Tier`, `FAST_BEFORE_S = 15`, `FAST_AFTER_S = 30`, `DEGRADED_FLOOR_MS = 10_000`; `tierOf(state | null): Tier`, `chainTier(states): Tier`, `nextDelayMs(tier, reads: { state; readAt }[], startedAt, now): number`, `degradedAfterMs(tier): number`, `isDegraded(readAt, now, tier): boolean`

- [ ] **Step 1: Write the failing tests**

Create `apps/freshness/src/hot-set.test.ts`:

```ts
import type { Address } from 'viem'
import { describe, expect, it } from 'vitest'
import { HOT_TTL_MS, hotSet } from './hot-set.ts'

const A: Address = '0x0409454C375c8a6aB05383bFB6D9FcDe9ebB8F85'
const B: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'

describe('hotSet (docs/specs/2026-10-16-freshness-server.md, section 6.3)', () => {
  it('answers joined once per chain and address, whatever the case, with a new entry marked and unread', () => {
    const hot = hotSet()
    const first = hot.join(31337, A.toLowerCase() as Address, 1_000)
    expect(first.joined).toBe(true)
    expect(first.entry).toMatchObject({
      chainId: 31337,
      address: A,
      joinedAt: 1_000,
      requestedAt: 1_000,
      read: null,
      readAt: null,
      extrasReadAt: null,
      marked: true,
    })
    const again = hot.join(31337, A, 2_000)
    expect(again.joined).toBe(false)
    expect(again.entry).toBe(first.entry)
    expect(hot.join(1, A, 3_000).joined).toBe(true)
    expect(hot.size()).toBe(2)
    expect(hot.size(31337)).toBe(1)
  })

  it('refreshes requestedAt on each request and keeps the join time', () => {
    const hot = hotSet()
    hot.join(31337, A, 1_000)
    const { entry } = hot.join(31337, A, 9_000)
    expect([entry.joinedAt, entry.requestedAt]).toEqual([1_000, 9_000])
  })

  it('lets an entry go after 10 minutes without a request and keeps one requested 9 minutes 59 seconds ago', () => {
    const hot = hotSet()
    hot.join(31337, A, 0)
    hot.join(31337, B, 1_000)
    const gone = hot.expire(HOT_TTL_MS)
    expect(gone.map((entry) => entry.address)).toEqual([A])
    expect(hot.onChain(31337).map((entry) => entry.address)).toEqual([B])
  })

  it("empties a chain's list when its last entry leaves, and leaves the other chains", () => {
    const hot = hotSet()
    hot.join(31337, A, 0)
    hot.join(1, A, 500_000)
    hot.expire(600_000)
    expect(hot.onChain(31337)).toEqual([])
    expect(hot.size(31337)).toBe(0)
    expect(hot.onChain(1).map((entry) => entry.chainId)).toEqual([1])
  })
})
```

Create `apps/freshness/src/collection-check.test.ts`:

```ts
import type { Address } from 'viem'
import { describe, expect, it } from 'vitest'
import { collectionCheck, NEGATIVE_MAX, NEGATIVE_TTL_MS } from './collection-check.ts'

const A: Address = '0x0409454C375c8a6aB05383bFB6D9FcDe9ebB8F85'

/** A fake factory read that counts its asks and answers what `answer` says. */
function counted(answer: (address: Address) => Promise<boolean>) {
  const asked: string[] = []
  const read = async (chainId: number, address: Address) => {
    asked.push(`${chainId}:${address}`)
    return answer(address)
  }
  return { read, asked }
}

/** The address of index `n`, distinct for every n. */
const address = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as Address

describe('collectionCheck (docs/specs/2026-10-16-freshness-server.md, section 6.3)', () => {
  it('keeps a true answer for the life of the process, whatever the case', async () => {
    const { read, asked } = counted(async () => true)
    let now = 0
    const check = collectionCheck(read, () => now)
    expect(await check(31337, A)).toBe(true)
    now = 365 * 86_400_000
    expect(await check(31337, A.toLowerCase() as Address)).toBe(true)
    expect(asked).toEqual([`31337:${A}`])
  })

  it('keeps a false answer for 60 s, then asks again', async () => {
    const { read, asked } = counted(async () => false)
    let now = 0
    const check = collectionCheck(read, () => now)
    expect(await check(31337, A)).toBe(false)
    now = NEGATIVE_TTL_MS - 1
    expect(await check(31337, A)).toBe(false)
    expect(asked).toHaveLength(1)
    now = NEGATIVE_TTL_MS
    expect(await check(31337, A)).toBe(false)
    expect(asked).toHaveLength(2)
  })

  it('keys by chain: the same address on another chain is asked there', async () => {
    const { read, asked } = counted(async () => true)
    const check = collectionCheck(read, () => 0)
    await check(31337, A)
    await check(1, A)
    expect(asked).toEqual([`31337:${A}`, `1:${A}`])
  })

  it('keeps at most 10,000 false answers, forgetting the oldest first', async () => {
    const { read, asked } = counted(async () => false)
    const check = collectionCheck(read, () => 0)
    for (let n = 0; n <= NEGATIVE_MAX; n++) await check(31337, address(n))
    expect(asked).toHaveLength(NEGATIVE_MAX + 1)
    await check(31337, address(1))
    expect(asked).toHaveLength(NEGATIVE_MAX + 1)
    await check(31337, address(0))
    expect(asked).toHaveLength(NEGATIVE_MAX + 2)
  })

  it('shares one read between two asks of one address in flight', async () => {
    let settle: (answer: boolean) => void = () => {}
    const { read, asked } = counted(() => new Promise<boolean>((resolve) => (settle = resolve)))
    const check = collectionCheck(read, () => 0)
    const first = check(31337, A)
    const second = check(31337, A.toLowerCase() as Address)
    settle(true)
    expect(await Promise.all([first, second])).toEqual([true, true])
    expect(asked).toHaveLength(1)
  })

  it('keeps nothing from a failed read: the ask fails and the next one reads again', async () => {
    let fail = true
    const { read, asked } = counted(async () => {
      if (fail) throw new Error('fetch failed')
      return true
    })
    const check = collectionCheck(read, () => 0)
    await expect(check(31337, A)).rejects.toThrow('fetch failed')
    fail = false
    expect(await check(31337, A)).toBe(true)
    expect(asked).toHaveLength(2)
  })
})
```

Create `apps/freshness/src/tiers.test.ts`:

```ts
import type { ChainGroup, ChainState } from '@cobweb/shared'
import { describe, expect, it } from 'vitest'
import { chainTier, degradedAfterMs, isDegraded, nextDelayMs, tierOf } from './tiers.ts'

/** The chain's time at the read. */
const NOW_S = 1_800_000_000

const group = (overrides: Partial<ChainGroup>): ChainGroup => ({
  id: 0,
  priceWei: '0',
  maxSupply: 3,
  minted: 0,
  startTimestamp: 0,
  flag: false,
  active: false,
  ...overrides,
})

const state = (groups: ChainGroup[], overrides: Partial<ChainState> = {}): ChainState => ({
  block: 100n,
  blockTimestamp: NOW_S,
  maxSupply: 5,
  totalMinted: 0,
  publicMaxMintPerWallet: 2,
  mintOnBehalfActive: false,
  groups,
  ...overrides,
})

/** A collection whose only group is scheduled `offset` seconds from the read. */
const scheduled = (offset: number) => state([group({ startTimestamp: NOW_S + offset })])

describe('tierOf (docs/specs/2026-10-16-freshness-server.md, section 6.6)', () => {
  it('reads fast from 15 s before a scheduled start to 30 s after it, both ends included', () => {
    expect(tierOf(scheduled(16))).toBe('idle')
    expect(tierOf(scheduled(15))).toBe('fast')
    expect(tierOf(scheduled(-30))).toBe('fast')
    expect(tierOf(scheduled(-31))).toBe('idle')
  })

  it('never reads a start of 0 as fast', () => {
    expect(tierOf(state([group({ startTimestamp: 0 })], { blockTimestamp: 10 }))).toBe('idle')
  })

  it('reads live while a group is active with allocation left, and idle once it is sold out either way', () => {
    expect(tierOf(state([group({ flag: true, active: true, minted: 2 })]))).toBe('live')
    expect(tierOf(state([group({ flag: true, active: true, minted: 3 })]))).toBe('idle')
    expect(tierOf(state([group({ flag: true, active: true, minted: 1 })], { totalMinted: 5 }))).toBe('idle')
    expect(tierOf(state([group({ flag: true, active: false })]))).toBe('idle')
  })

  it('reads a collection with no read as live', () => {
    expect(tierOf(null)).toBe('live')
  })
})

describe('chainTier', () => {
  it('takes the fastest of its collections, and is idle with none', () => {
    const live = state([group({ active: true })])
    expect(chainTier([state([]), live])).toBe('live')
    expect(chainTier([live, scheduled(0), null])).toBe('fast')
    expect(chainTier([state([]), null])).toBe('live')
    expect(chainTier([])).toBe('idle')
  })
})

describe('degraded', () => {
  it('is 10 s at the fast and live tiers and 60 s at idle', () => {
    expect([degradedAfterMs('fast'), degradedAfterMs('live'), degradedAfterMs('idle')]).toEqual([
      10_000, 10_000, 60_000,
    ])
  })

  it('is false at exactly the limit and true 1 ms later', () => {
    expect(isDegraded(1_000, 11_000, 'live')).toBe(false)
    expect(isDegraded(1_000, 11_001, 'live')).toBe(true)
    expect(isDegraded(1_000, 61_000, 'idle')).toBe(false)
    expect(isDegraded(1_000, 61_001, 'idle')).toBe(true)
  })
})

describe('nextDelayMs', () => {
  it("counts the tier's interval from the tick's start, and runs at once after a tick that ran longer", () => {
    expect(nextDelayMs('live', [], 10_000, 10_500)).toBe(1_500)
    expect(nextDelayMs('fast', [], 10_000, 12_000)).toBe(0)
    expect(nextDelayMs('idle', [], 10_000, 10_000)).toBe(20_000)
  })

  it("wakes an idle chain when the nearest start's window opens, estimated from the read's block time", () => {
    // Read at 10 s (server time) with the chain at NOW_S: a start 23 s ahead opens its window 8 s later.
    const reads = [
      { state: scheduled(40), readAt: 10_000 },
      { state: scheduled(23), readAt: 10_000 },
    ]
    expect(nextDelayMs('idle', reads, 10_000, 10_000)).toBe(8_000)
    expect(nextDelayMs('idle', reads, 10_000, 12_000)).toBe(6_000)
  })

  it('does not shorten a fast tick for an open window', () => {
    expect(nextDelayMs('fast', [{ state: scheduled(-5), readAt: 10_000 }], 10_000, 10_000)).toBe(1_000)
    expect(nextDelayMs('fast', [{ state: scheduled(15.5), readAt: 10_000 }], 10_000, 10_000)).toBe(1_000)
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @cobweb/freshness exec vitest run src/hot-set.test.ts src/collection-check.test.ts src/tiers.test.ts`
Expected: FAIL. The three files fail to load (`Cannot find module './hot-set.ts'`, `'./collection-check.ts'` and `'./tiers.ts'`). The run ends `Test Files  3 failed (3)` and `Tests  no tests`.

- [ ] **Step 3: The read's types, the hot set, the collection check and the tiers**

Decision (section 6.3): `HotEntry` carries `joinedAt`, since the join wait is counted from the join and `requestedAt` moves with every request (Decision 2). Decision (section 6.4): the read's three types live in `chain-reader.ts`, where the spec puts them; Task 5 replaces the file whole with the reader (Decision 4).

Create `apps/freshness/src/chain-reader.ts`:

```ts
import type { ChainState, TransferLevelState } from '@cobweb/shared'
import type { Address } from 'viem'

/** The fees `collectionState()` carries, wei as decimal strings. */
export type FeeWei = { mintFeeFlatWei: string; mintFeeBps: number; airdropFeePerTokenWei: string }

/** What a mint page shows beside the state, read on their logs and every 60 s. */
export type Extras = {
  owner: Address
  royalty: { receiver: Address; bps: number }
  baseUri: string
  transferValidator: Address
  transferLevel: TransferLevelState
}

/** A collection's last read: the state at its block, the fees and the extras. */
export type CollectionRead = { state: ChainState; fees: FeeWei; extras: Extras }
```

Create `apps/freshness/src/hot-set.ts`:

```ts
import { getAddress, type Address } from 'viem'
import type { CollectionRead } from './chain-reader.ts'

/**
 * The hot set (docs/specs/2026-10-16-freshness-server.md, section 6.3): the collections mint pages asked for
 * in the last 10 minutes, per chain, each with its last read. Pure: every time is passed in, in milliseconds.
 */

/** An entry leaves after 10 minutes without a request. */
export const HOT_TTL_MS = 600_000
/** A request for an entry without a read waits up to 2 s after the join for its first read. */
export const JOIN_WAIT_MS = 2_000

export type HotEntry = {
  chainId: number
  /** Checksummed. */
  address: Address
  /** When the entry joined, for the join wait. */
  joinedAt: number
  /** The last state request. */
  requestedAt: number
  /** The last successful read, or null before the first. */
  read: CollectionRead | null
  /** When the last read landed, or was counted at an unchanged head; null before the first. */
  readAt: number | null
  /** When the extras were last read; null before the first. */
  extrasReadAt: number | null
  /** To read in full (the state and the extras) at the next tick: a new entry, or one a log named. */
  marked: boolean
}

const keyOf = (chainId: number, address: Address) => `${chainId}:${address.toLowerCase()}`

/** The hot set, keyed by the chain and the lowercase address. */
export function hotSet(): {
  join(chainId: number, address: Address, now: number): { entry: HotEntry; joined: boolean }
  onChain(chainId: number): HotEntry[]
  expire(now: number): HotEntry[]
  size(chainId?: number): number
} {
  const entries = new Map<string, HotEntry>()
  const onChain = (chainId: number) => [...entries.values()].filter((entry) => entry.chainId === chainId)
  return {
    join(chainId, address, now) {
      const key = keyOf(chainId, address)
      const known = entries.get(key)
      if (known) {
        known.requestedAt = now
        return { entry: known, joined: false }
      }
      const entry: HotEntry = {
        chainId,
        address: getAddress(address),
        joinedAt: now,
        requestedAt: now,
        read: null,
        readAt: null,
        extrasReadAt: null,
        marked: true,
      }
      entries.set(key, entry)
      return { entry, joined: true }
    },
    onChain,
    expire(now) {
      const gone: HotEntry[] = []
      for (const [key, entry] of entries)
        if (now - entry.requestedAt >= HOT_TTL_MS) {
          entries.delete(key)
          gone.push(entry)
        }
      return gone
    },
    size(chainId) {
      return chainId === undefined ? entries.size : onChain(chainId).length
    },
  }
}

export type HotSet = ReturnType<typeof hotSet>
```

Create `apps/freshness/src/collection-check.ts`:

```ts
import type { Address } from 'viem'

/**
 * The collection check (docs/specs/2026-10-16-freshness-server.md, section 6.3): whether an address is a
 * Cobweb collection, as its chain's factory says through `isCollection`. True is kept for the life of the
 * process (the factory only ever sets it), false for 60 s, at most 10,000 of them with the oldest forgotten
 * first. Asks for one address in flight share one read, and a failed read is kept nowhere: the ask fails and
 * the next one reads again.
 */

/** How long a false answer is kept. */
export const NEGATIVE_TTL_MS = 60_000
/** The most false answers kept. */
export const NEGATIVE_MAX = 10_000

export function collectionCheck(
  read: (chainId: number, address: Address) => Promise<boolean>,
  now: () => number = Date.now,
): (chainId: number, address: Address) => Promise<boolean> {
  const collections = new Set<string>()
  /** False answers by key with their time, oldest first (a Map keeps insertion order). */
  const strangers = new Map<string, number>()
  const inFlight = new Map<string, Promise<boolean>>()
  return (chainId, address) => {
    const key = `${chainId}:${address.toLowerCase()}`
    if (collections.has(key)) return Promise.resolve(true)
    const refusedAt = strangers.get(key)
    if (refusedAt !== undefined) {
      if (now() - refusedAt < NEGATIVE_TTL_MS) return Promise.resolve(false)
      strangers.delete(key)
    }
    const pending = inFlight.get(key)
    if (pending) return pending
    const asking = read(chainId, address)
      .then((answer) => {
        if (answer) collections.add(key)
        else {
          strangers.set(key, now())
          if (strangers.size > NEGATIVE_MAX) {
            const oldest = strangers.keys().next().value
            if (oldest !== undefined) strangers.delete(oldest)
          }
        }
        return answer
      })
      .finally(() => inFlight.delete(key))
    inFlight.set(key, asking)
    return asking
  }
}
```

Create `apps/freshness/src/tiers.ts`:

```ts
import type { ChainState } from '@cobweb/shared'

/**
 * The tiers and `degraded` (docs/specs/2026-10-16-freshness-server.md, section 6.6), pure. The tiers only
 * decide when to read the chain: liveness is always the contract's `active`, never computed here.
 */

/** A chain's tick interval: around a scheduled start, while a phase is live, otherwise. */
export const TIER_MS = { fast: 1_000, live: 2_000, idle: 20_000 } as const
export type Tier = keyof typeof TIER_MS

/** The fast tier runs from 15 s before a scheduled start to 30 s after it, on the chain's time. */
export const FAST_BEFORE_S = 15
export const FAST_AFTER_S = 30
/** A collection never reads degraded sooner than 10 s after its last read. */
export const DEGRADED_FLOOR_MS = 10_000

/** Fastest first. */
const ORDER: readonly Tier[] = ['fast', 'live', 'idle']

/**
 * A collection's tier from its last read: fast when the read's block time lies from 15 s before to 30 s after
 * any scheduled start, both ends included; else live when any group is active and not sold out (by its
 * allocation or by the collection's supply); else idle. A collection with no read yet is live, so a failed
 * first read is tried again every 2 s.
 */
export function tierOf(
  state: Pick<ChainState, 'blockTimestamp' | 'maxSupply' | 'totalMinted' | 'groups'> | null,
): Tier {
  if (!state) return 'live'
  const nearStart = state.groups.some(
    (group) =>
      group.startTimestamp !== 0 &&
      state.blockTimestamp >= group.startTimestamp - FAST_BEFORE_S &&
      state.blockTimestamp <= group.startTimestamp + FAST_AFTER_S,
  )
  if (nearStart) return 'fast'
  const supplyLeft = state.totalMinted < state.maxSupply
  const live = state.groups.some((group) => group.active && group.minted < group.maxSupply && supplyLeft)
  return live ? 'live' : 'idle'
}

/** A chain ticks at the fastest tier any of its collections needs; idle with none. */
export function chainTier(states: readonly (ChainState | null)[]): Tier {
  let tier: Tier = 'idle'
  for (const state of states) {
    const own = tierOf(state)
    if (ORDER.indexOf(own) < ORDER.indexOf(tier)) tier = own
  }
  return tier
}

/**
 * The delay to the next tick: the tier's interval counted from this tick's start (0 when the tick ran
 * longer), shortened on an idle chain to the moment the nearest start's window opens, estimated as that
 * read's `readAt` plus the seconds from its block time to the start less 15.
 */
export function nextDelayMs(
  tier: Tier,
  reads: readonly { state: ChainState; readAt: number }[],
  startedAt: number,
  now: number,
): number {
  let next = startedAt + TIER_MS[tier]
  if (tier === 'idle')
    for (const { state, readAt } of reads)
      for (const group of state.groups) {
        if (group.startTimestamp === 0) continue
        const opensIn = group.startTimestamp - FAST_BEFORE_S - state.blockTimestamp
        if (opensIn > 0) next = Math.min(next, readAt + opensIn * 1_000)
      }
  return Math.max(0, next - now)
}

/** How old a last read may be before it reads degraded: the larger of three ticks of the tier and 10 s. */
export function degradedAfterMs(tier: Tier): number {
  return Math.max(3 * TIER_MS[tier], DEGRADED_FLOOR_MS)
}

/** Whether a collection read at `readAt` reads degraded at `now` on a chain at `tier`. */
export function isDegraded(readAt: number, now: number, tier: Tier): boolean {
  return now - readAt > degradedAfterMs(tier)
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm --filter @cobweb/freshness exec vitest run src/hot-set.test.ts src/collection-check.test.ts src/tiers.test.ts`
Expected: PASS, 3 files and 20 tests.

- [ ] **Step 5: Format, run the root checks and commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
pnpm exec prettier --write apps/freshness/src/chain-reader.ts apps/freshness/src/hot-set.ts apps/freshness/src/hot-set.test.ts apps/freshness/src/collection-check.ts apps/freshness/src/collection-check.test.ts apps/freshness/src/tiers.ts apps/freshness/src/tiers.test.ts
pnpm typecheck && pnpm lint && pnpm test
git add apps/freshness/src/chain-reader.ts apps/freshness/src/hot-set.ts apps/freshness/src/hot-set.test.ts apps/freshness/src/collection-check.ts apps/freshness/src/collection-check.test.ts apps/freshness/src/tiers.ts apps/freshness/src/tiers.test.ts
git commit -m "$(cat <<'EOF'
Add the freshness server's hot set, its collection check with the false answers bounded, and the tiers with degraded, with the read's types

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: the freshness package reports 24 tests in 4 files (4 before, plus 20).

---

### Task 5: The log scan, the health shapes and the chain reader's tick

**Files:**

- Create: `apps/freshness/src/logs.ts`, `logs.test.ts`, `health.ts`, `chain-reader.test.ts`
- Modify: `apps/freshness/src/chain-reader.ts` (whole file: the reader, the three types kept)
- Test: `apps/freshness/src/logs.test.ts`, `apps/freshness/src/chain-reader.test.ts`

**Interfaces:**

- Consumes: `chainStateOf`, `levelOf`, `readEach`, `validatorAbi`, `ChainConfig`, `ChainState`, `CollectionStateResult`, `TransferLevelState` from `@cobweb/shared`; `collectionAbi` from `@cobweb/shared/collection-abi`; `HotEntry`, `HotSet` (Task 4); `chainTier`, `nextDelayMs`, `Tier` (Task 4).
- Produces:
  - `logs.ts`: `MAX_LOG_RANGE = 500n`; `STATE_EVENTS` (9 names) and `EXTRAS_EVENTS` (5 names) `as const`; `watchedTopics(): Hex[]` (the 14 collection events from `collectionAbi`, then `SetTransferSecurityLevel` from `validatorAbi`); `LogLike = { address: Address; topics: readonly Hex[] }`; `ScanTarget = { address: Address; validator: Address | null }`; `marksOf(logs: readonly LogLike[], hot: readonly ScanTarget[]): Set<string>` (lowercase addresses); `GetLogs = (filter: { address: Address[]; topics: [Hex[]]; fromBlock: bigint; toBlock: bigint }) => Promise<readonly LogLike[]>`; `Scan = { marks: Set<string>; gap: boolean; failure: string | null }`; `scanLogs(getLogs, scanned: bigint, head: bigint, hot, validators: readonly Address[]): Promise<Scan>`
  - `health.ts`: `ChainHealth = { chainId; name; hot; tier: Tier | null; block: number | null; lagSeconds: number | null; lastGoodTickAt: string | null; failedTicks; lastError: string | null; logGaps }`, `HealthBody = { status: 'ok'; startedAt: string; hot: number; chains: ChainHealth[]; wallet: { windows; answered; waiting } }`, `errorName(error: unknown): string`, `errorLine(error: unknown): string`
  - `chain-reader.ts`: `FeeWei`, `Extras`, `CollectionRead` as Task 4 wrote them; `EXTRAS_EVERY_MS = 60_000`; `chainReader(chain: ChainConfig, hot: HotSet, client: PublicClient): { wake(): void; stop(): Promise<void>; health(): ChainHealth }`

- [ ] **Step 1: Write the failing tests**

Create `apps/freshness/src/logs.test.ts`:

```ts
import { validatorAbi } from '@cobweb/shared'
import { collectionAbi } from '@cobweb/shared/collection-abi'
import { encodeEventTopics, toEventSelector, type Address, type Hex } from 'viem'
import { describe, expect, it } from 'vitest'
import { marksOf, MAX_LOG_RANGE, scanLogs, watchedTopics, type GetLogs, type ScanTarget } from './logs.ts'

const A: Address = '0x0409454C375c8a6aB05383bFB6D9FcDe9ebB8F85'
const B: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const STRANGER: Address = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
const VALIDATOR: Address = '0x721C008fdff27BF06E7E123956E2Fe03B63342e3'
const OTHER_VALIDATOR: Address = '0x90F79bf6EB2c4f870365E785982E1f101E93b906'

/** A uses the validator; B has none read yet. */
const hot: ScanTarget[] = [
  { address: A, validator: VALIDATOR },
  { address: B, validator: null },
]

/** A collection's log of `eventName`, its topics as the node answers them. */
const collectionLog = (address: Address, topics: Hex[]) => ({ address, topics })
const statusTopics = encodeEventTopics({
  abi: collectionAbi,
  eventName: 'MintGroupStatusChanged',
  args: { mintGroup: 1n },
}) as Hex[]
const levelLog = (from: Address, collection: Address) => ({
  address: from,
  topics: encodeEventTopics({
    abi: validatorAbi,
    eventName: 'SetTransferSecurityLevel',
    args: { collection },
  }) as Hex[],
})

describe('watchedTopics (docs/specs/2026-10-16-freshness-server.md, section 6.5)', () => {
  it("is the 14 collection events and the validator's SetTransferSecurityLevel, as their signatures give them", () => {
    expect(watchedTopics()).toEqual(
      [
        'MintGroupStatusChanged(uint256,bool)',
        'AllMintGroupsStatusChanged(bool,uint256)',
        'MintGroupStartTimestampChanged(uint256,uint256)',
        'MintGroupRegistered(uint256)',
        'SalePriceChanged(uint256,uint256)',
        'MintGroupMaxSupplyUpdated(uint256,uint256)',
        'PublicMaxMintPerWalletChanged(uint256)',
        'MintOnBehalfUpdated(bool)',
        'FeesUpdated(uint256,uint256,uint256)',
        'BatchMetadataUpdate(uint256,uint256)',
        'OwnershipTransferred(address,address)',
        'DefaultRoyaltyUpdated(address,uint96)',
        'TokenRoyaltyUpdated(uint256,address,uint96)',
        'TransferValidatorUpdated(address,address)',
        'SetTransferSecurityLevel(address,uint8)',
      ].map((signature) => toEventSelector(signature)),
    )
  })
})

describe('marksOf', () => {
  it('marks a hot collection for a watched log of its own', () => {
    expect(marksOf([collectionLog(A, statusTopics)], hot)).toEqual(new Set([A.toLowerCase()]))
  })

  it("marks the collection a validator's level event names, only when that collection uses that validator", () => {
    expect(marksOf([levelLog(VALIDATOR, A)], hot)).toEqual(new Set([A.toLowerCase()]))
    expect(marksOf([levelLog(OTHER_VALIDATOR, A)], hot)).toEqual(new Set())
    expect(marksOf([levelLog(VALIDATOR, B)], hot)).toEqual(new Set())
  })

  it('marks nothing for a log of another address, another topic, or a collection not in the set', () => {
    const transfer = encodeEventTopics({
      abi: collectionAbi,
      eventName: 'Transfer',
      args: { from: B, to: A, tokenId: 1n },
    }) as Hex[]
    expect(
      marksOf(
        [
          collectionLog(STRANGER, statusTopics),
          collectionLog(A, transfer),
          levelLog(VALIDATOR, STRANGER),
          collectionLog(VALIDATOR, statusTopics),
          { address: A, topics: [] },
        ],
        hot,
      ),
    ).toEqual(new Set())
  })
})

describe('scanLogs', () => {
  /** A fake eth_getLogs that records its filters and answers `logs`, or fails. */
  function fakeGetLogs(logs: { address: Address; topics: Hex[] }[] | Error) {
    const filters: Parameters<GetLogs>[0][] = []
    const getLogs: GetLogs = async (filter) => {
      filters.push(filter)
      if (logs instanceof Error) throw logs
      return logs
    }
    return { getLogs, filters }
  }

  it('sends one eth_getLogs from the block after the last scanned to the head, over the hot collections and the validators with code', async () => {
    const { getLogs, filters } = fakeGetLogs([collectionLog(B, statusTopics)])
    const scan = await scanLogs(getLogs, 100n, 100n + MAX_LOG_RANGE, hot, [VALIDATOR])
    expect(scan).toEqual({ marks: new Set([B.toLowerCase()]), gap: false, failure: null })
    expect(filters).toEqual([
      { address: [A, B, VALIDATOR], topics: [watchedTopics()], fromBlock: 101n, toBlock: 600n },
    ])
  })

  it('sends nothing for a range over 500 blocks and marks every hot collection as a gap', async () => {
    const { getLogs, filters } = fakeGetLogs([])
    const scan = await scanLogs(getLogs, 100n, 101n + MAX_LOG_RANGE, hot, [VALIDATOR])
    expect(scan).toEqual({ marks: new Set([A.toLowerCase(), B.toLowerCase()]), gap: true, failure: null })
    expect(filters).toEqual([])
  })

  it('marks every hot collection as a gap when the scan fails, naming the failure (Review Focus 3)', async () => {
    const { getLogs } = fakeGetLogs(new RangeError('query exceeds max block range'))
    expect(await scanLogs(getLogs, 100n, 110n, hot, [])).toEqual({
      marks: new Set([A.toLowerCase(), B.toLowerCase()]),
      gap: true,
      failure: 'RangeError',
    })
  })
})
```

Create `apps/freshness/src/chain-reader.test.ts`:

```ts
import { chainById, type CollectionStateResult } from '@cobweb/shared'
import { collectionAbi } from '@cobweb/shared/collection-abi'
import {
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  encodeEventTopics,
  HttpRequestError,
  maxUint256,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chainReader } from './chain-reader.ts'
import { hotSet } from './hot-set.ts'

const ANVIL = chainById(31337, false)!
const A: Address = '0x0409454C375c8a6aB05383bFB6D9FcDe9ebB8F85'
const B: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const OWNER: Address = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
const VALIDATOR: Address = '0x721C008fdff27BF06E7E123956E2Fe03B63342e3'

/**
 * `collectionState()` at a block: one open group with allocation left, so the chain ticks at the 2 s tier.
 */
const stateAt = (block: bigint): CollectionStateResult => ({
  maxSupply: 5n,
  totalMinted: 1n,
  publicMaxMintPerWallet: 2n,
  mintFeeFlat: 0n,
  mintFeeBps: 0n,
  airdropFeePerToken: 100_000_000_000_000n,
  mintOnBehalfActive: false,
  blockTimestamp: 1_800_000_000n + block,
  groups: [
    { id: 0n, price: 0n, maxSupply: 3n, minted: 1n, startTimestamp: 0n, activeFlag: true, active: true },
  ],
})

/** A revert as viem reports it for one call. */
const reverted = (functionName: string) =>
  new ContractFunctionExecutionError(
    new ContractFunctionRevertedError({ abi: collectionAbi, functionName }),
    {
      abi: collectionAbi,
      contractAddress: A,
      functionName,
    },
  )

/** The base URI's log, as `setBaseURI` leaves it. */
const metadataLog = (address: Address) => ({
  address,
  topics: encodeEventTopics({
    abi: collectionAbi,
    eventName: 'BatchMetadataUpdate',
    args: { fromTokenId: 1n, toTokenId: maxUint256 },
  }) as Hex[],
})

/**
 * A fake chain without multicall3 (so `readEach` reads each call), recording every call as `head`, `logs
 * <from>-<to>`, `code <address>` or `<function> <address> @<block>`.
 */
function fakeChain() {
  const chain = {
    head: 100n,
    /** Mine a block after each head read, as a busy chain does. */
    autoMine: false,
    calls: [] as string[],
    logs: [] as { address: Address; topics: Hex[] }[],
    /** `<function> <address>` pairs that revert. */
    reverts: new Set<string>(),
    baseUris: new Map<string, string>(),
    validatorHasCode: false,
    /** When set, every head read waits for it. */
    gate: null as Promise<void> | null,
    failure: null as Error | null,
    headsInFlight: 0,
    mostHeadsInFlight: 0,
  }
  const client = {
    chain: { contracts: {} },
    async getBlockNumber() {
      chain.calls.push('head')
      chain.headsInFlight++
      chain.mostHeadsInFlight = Math.max(chain.mostHeadsInFlight, chain.headsInFlight)
      try {
        if (chain.gate) await chain.gate
        if (chain.failure) throw chain.failure
        return chain.autoMine ? chain.head++ : chain.head
      } finally {
        chain.headsInFlight--
      }
    },
    async request({ params }: { params: [{ fromBlock: Hex; toBlock: Hex }] }) {
      chain.calls.push(`logs ${BigInt(params[0].fromBlock)}-${BigInt(params[0].toBlock)}`)
      return chain.logs
    },
    async getCode({ address }: { address: Address }) {
      chain.calls.push(`code ${address}`)
      return chain.validatorHasCode ? '0x6080' : undefined
    },
    async readContract({
      address,
      functionName,
      blockNumber,
    }: {
      address: Address
      functionName: string
      blockNumber: bigint
    }) {
      chain.calls.push(`${functionName} ${address} @${blockNumber}`)
      if (chain.reverts.has(`${functionName} ${address}`)) throw reverted(functionName)
      if (functionName === 'collectionState') return stateAt(blockNumber)
      if (functionName === 'owner') return OWNER
      if (functionName === 'royaltyInfo') return [OWNER, 500n]
      if (functionName === 'baseURI') return chain.baseUris.get(address) ?? 'ipfs://first/'
      if (functionName === 'getTransferValidator') return VALIDATOR
      if (functionName === 'getCollectionSecurityPolicy') return { transferSecurityLevel: 9 }
      throw new Error(`unexpected ${functionName}`)
    },
  } as unknown as PublicClient
  return { chain, client }
}

/** Lets the reader's promises run, at the fake clock's current time. */
const settle = () => vi.advanceTimersByTimeAsync(0)

describe('chainReader (docs/specs/2026-10-16-freshness-server.md, section 6.4)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('reads a new collection in full at the head on its first tick, with no log scan', async () => {
    const { chain, client } = fakeChain()
    const hot = hotSet()
    const reader = chainReader(ANVIL, hot, client)
    const { entry } = hot.join(31337, A, Date.now())
    reader.wake()
    await settle()
    expect(chain.calls).toEqual([
      'head',
      `collectionState ${A} @100`,
      `owner ${A} @100`,
      `royaltyInfo ${A} @100`,
      `baseURI ${A} @100`,
      `getTransferValidator ${A} @100`,
      `code ${VALIDATOR}`,
    ])
    expect(entry.read).toEqual({
      state: {
        block: 100n,
        blockTimestamp: 1_800_000_100,
        maxSupply: 5,
        totalMinted: 1,
        publicMaxMintPerWallet: 2,
        mintOnBehalfActive: false,
        groups: [
          { id: 0, priceWei: '0', maxSupply: 3, minted: 1, startTimestamp: 0, flag: true, active: true },
        ],
      },
      fees: { mintFeeFlatWei: '0', mintFeeBps: 0, airdropFeePerTokenWei: '100000000000000' },
      extras: {
        owner: OWNER,
        royalty: { receiver: OWNER, bps: 500 },
        baseUri: 'ipfs://first/',
        transferValidator: VALIDATOR,
        transferLevel: { kind: 'none', reason: 'no-code' },
      },
    })
    expect([entry.readAt, entry.extrasReadAt, entry.marked]).toEqual([1_000_000, 1_000_000, false])
    expect(reader.health()).toMatchObject({ hot: 1, tier: 'live', block: 100, failedTicks: 0, logGaps: 0 })
    await reader.stop()
  })

  it('counts a head older than the last read as a read now, and never moves the block back (Review Focus 1)', async () => {
    const { chain, client } = fakeChain()
    const hot = hotSet()
    const reader = chainReader(ANVIL, hot, client)
    const { entry } = hot.join(31337, A, Date.now())
    reader.wake()
    await settle()
    chain.head = 99n
    chain.calls.length = 0
    await vi.advanceTimersByTimeAsync(2_000)
    expect(chain.calls).toEqual(['head'])
    expect([entry.read?.state.block, entry.readAt]).toEqual([100n, 1_002_000])
    expect(reader.health().block).toBe(100)
    chain.head = 101n
    chain.calls.length = 0
    await vi.advanceTimersByTimeAsync(2_000)
    expect(chain.calls).toEqual(['head', 'logs 101-101', `collectionState ${A} @101`])
    expect(entry.read?.state.block).toBe(101n)
    await reader.stop()
  })

  it('leaves a collection whose call answers null as it was, mark included, and reads the others (Review Focus 2)', async () => {
    const { chain, client } = fakeChain()
    const hot = hotSet()
    const reader = chainReader(ANVIL, hot, client)
    const a = hot.join(31337, A, Date.now()).entry
    const b = hot.join(31337, B, Date.now()).entry
    reader.wake()
    await settle()
    chain.head = 101n
    chain.logs = [metadataLog(A), metadataLog(B)]
    chain.reverts.add(`baseURI ${A}`)
    chain.baseUris.set(B, 'ipfs://second/')
    await vi.advanceTimersByTimeAsync(2_000)
    expect([a.read?.state.block, a.read?.extras.baseUri, a.marked]).toEqual([100n, 'ipfs://first/', true])
    expect([b.read?.state.block, b.read?.extras.baseUri, b.marked]).toEqual([101n, 'ipfs://second/', false])
    chain.head = 102n
    chain.logs = []
    chain.reverts.clear()
    chain.baseUris.set(A, 'ipfs://second/')
    await vi.advanceTimersByTimeAsync(2_000)
    expect([a.read?.state.block, a.read?.extras.baseUri, a.marked]).toEqual([102n, 'ipfs://second/', false])
    await reader.stop()
  })

  it('runs one more tick after a wake during a tick, never beside it (Review Focus 5)', async () => {
    const { chain, client } = fakeChain()
    const hot = hotSet()
    const reader = chainReader(ANVIL, hot, client)
    let release = () => {}
    chain.gate = new Promise<void>((resolve) => (release = resolve))
    hot.join(31337, A, Date.now())
    reader.wake()
    await settle()
    const b = hot.join(31337, B, Date.now()).entry
    reader.wake()
    reader.wake()
    await settle()
    expect(chain.calls).toEqual(['head'])
    chain.gate = null
    release()
    await settle()
    expect(chain.calls.filter((call) => call === 'head')).toHaveLength(2)
    expect(chain.mostHeadsInFlight).toBe(1)
    expect(b.read?.state.block).toBe(100n)
    await vi.advanceTimersByTimeAsync(1_999)
    expect(chain.calls.filter((call) => call === 'head')).toHaveLength(2)
    await reader.stop()
  })

  it('reads the extras again once they are 60 s old, and only the state in between', async () => {
    const { chain, client } = fakeChain()
    chain.autoMine = true
    const hot = hotSet()
    const reader = chainReader(ANVIL, hot, client)
    const { entry } = hot.join(31337, A, Date.now())
    reader.wake()
    await settle()
    chain.calls.length = 0
    await vi.advanceTimersByTimeAsync(58_000)
    expect(chain.calls.filter((call) => call.startsWith('collectionState'))).toHaveLength(29)
    expect(chain.calls.filter((call) => call.startsWith('owner'))).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(chain.calls.filter((call) => call.startsWith('owner'))).toEqual([`owner ${A} @130`])
    expect(entry.extrasReadAt).toBe(1_060_000)
    await reader.stop()
  })

  it('reads the level on a validator with code, asking for its code once a chain, and unread when it does not answer', async () => {
    const { chain, client } = fakeChain()
    chain.validatorHasCode = true
    const hot = hotSet()
    const reader = chainReader(ANVIL, hot, client)
    const a = hot.join(31337, A, Date.now()).entry
    reader.wake()
    await settle()
    expect(a.read?.extras.transferLevel).toEqual({ kind: 'level', level: 9 })
    chain.reverts.add(`getCollectionSecurityPolicy ${VALIDATOR}`)
    const b = hot.join(31337, B, Date.now()).entry
    reader.wake()
    await settle()
    expect(b.read?.extras.transferLevel).toEqual({ kind: 'unread' })
    expect(chain.calls.filter((call) => call.startsWith('code'))).toEqual([`code ${VALIDATOR}`])
    await reader.stop()
  })

  it("fails a tick whose head does not answer, keeping every read and logging the error's name, never the RPC URL", async () => {
    const { chain, client } = fakeChain()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const hot = hotSet()
    const reader = chainReader(ANVIL, hot, client)
    const { entry } = hot.join(31337, A, Date.now())
    reader.wake()
    await settle()
    chain.failure = new HttpRequestError({ url: 'https://rpc.example/v2/secret-key', status: 503 })
    await vi.advanceTimersByTimeAsync(2_000)
    expect([entry.read?.state.block, entry.readAt]).toEqual([100n, 1_000_000])
    expect(reader.health()).toMatchObject({ failedTicks: 1, lastError: 'HttpRequestError', block: 100 })
    expect(errors.mock.calls.map((call) => String(call[0]))).toEqual([
      'A tick on Anvil failed: HttpRequestError: HTTP request failed.',
    ])
    chain.failure = null
    chain.head = 101n
    await vi.advanceTimersByTimeAsync(2_000)
    expect(entry.read?.state.block).toBe(101n)
    await reader.stop()
  })

  it('stops ticking once its last collection leaves, and scans nothing on its next first tick', async () => {
    const { chain, client } = fakeChain()
    const hot = hotSet()
    const reader = chainReader(ANVIL, hot, client)
    hot.join(31337, A, Date.now())
    reader.wake()
    await settle()
    await vi.advanceTimersByTimeAsync(600_000)
    const heads = chain.calls.filter((call) => call === 'head').length
    await vi.advanceTimersByTimeAsync(60_000)
    expect(chain.calls.filter((call) => call === 'head')).toHaveLength(heads)
    expect(reader.health()).toMatchObject({ hot: 0, tier: null })
    chain.head = 150n
    chain.calls.length = 0
    hot.join(31337, A, Date.now())
    reader.wake()
    await settle()
    expect(chain.calls.slice(0, 2)).toEqual(['head', `collectionState ${A} @150`])
    await reader.stop()
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @cobweb/freshness exec vitest run src/logs.test.ts src/chain-reader.test.ts`
Expected: FAIL. `logs.test.ts` fails to load (`Cannot find module './logs.ts'`); in `chain-reader.test.ts` all eight tests fail with `TypeError: chainReader is not a function` (Task 4's file holds the types only). The run ends `Test Files  2 failed (2)` and `Tests  8 failed (8)`.

- [ ] **Step 3: The health shapes and the log scan**

Decision (sections 6.1 and 6.9): `errorName` reports the innermost viem error's name (viem wraps an `HttpRequestError` in a `ContractFunctionExecutionError` when a read fails), and `errorLine` adds viem's `shortMessage` for the log; neither ever reads an error's `message`, which carries the request's URL (Decision 5).

Create `apps/freshness/src/health.ts`:

```ts
import { BaseError } from 'viem'
import type { Tier } from './tiers.ts'

/**
 * `/health` (docs/specs/2026-10-16-freshness-server.md, section 6.9), pure: what it reports per served chain
 * and for the server, and how a failure is named. It never carries an RPC URL or an error's message.
 */

export type ChainHealth = {
  chainId: number
  name: string
  hot: number
  /** Null while the chain has no hot collection. */
  tier: Tier | null
  /** The head the last good tick read; null before one. */
  block: number | null
  /**
   * Seconds since the block time of that head (0 when the chain's clock is ahead); null before a good tick.
   */
  lagSeconds: number | null
  /** The last good tick's time (ISO); null before one. */
  lastGoodTickAt: string | null
  failedTicks: number
  /** The last failure's error name, never its message. */
  lastError: string | null
  /** Log scans skipped or failed, whose collections were read in full instead. */
  logGaps: number
}

export type HealthBody = {
  status: 'ok'
  startedAt: string
  hot: number
  chains: ChainHealth[]
  wallet: { windows: number; answered: number; waiting: number }
}

/** The innermost viem error, where viem wraps one in another. */
function innermost(error: unknown): unknown {
  let current = error
  while (current instanceof BaseError && current.cause instanceof BaseError) current = current.cause
  return current
}

/** A failure's name as /health reports it: the innermost viem error's (HttpRequestError, for example). */
export function errorName(error: unknown): string {
  const inner = innermost(error)
  return inner instanceof Error ? inner.name : 'Error'
}

/**
 * A failure as the log writes it: the innermost viem error's name and short message, or a name alone for
 * anything else. Never a full message: viem's carries the request's URL, and an RPC URL carries the
 * provider's key.
 */
export function errorLine(error: unknown): string {
  const inner = innermost(error)
  return inner instanceof BaseError ? `${inner.name}: ${inner.shortMessage}` : errorName(error)
}
```

Decision (section 6.5): a log is read as `LogLike`, which any viem log and any node's answer fit, and `scanLogs` holds the 500-block guard and the failure rule (Decision 7).

Create `apps/freshness/src/logs.ts`:

```ts
import { validatorAbi } from '@cobweb/shared'
import { collectionAbi } from '@cobweb/shared/collection-abi'
import { getAbiItem, toEventSelector, type Address, type Hex } from 'viem'
import { errorName } from './health.ts'

/**
 * The log scan (docs/specs/2026-10-16-freshness-server.md, section 6.5): one `eth_getLogs` per chain and tick
 * over the hot collections and their validators with code, for the events that change what a mint page shows.
 * A matching log marks its collection for a full read in the same tick. Topics come from the ABIs.
 */

/** A scan whose range would pass 500 blocks is not sent: every hot collection is read in full instead. */
export const MAX_LOG_RANGE = 500n

/** The events that change `collectionState()`, with the fees. */
export const STATE_EVENTS = [
  'MintGroupStatusChanged',
  'AllMintGroupsStatusChanged',
  'MintGroupStartTimestampChanged',
  'MintGroupRegistered',
  'SalePriceChanged',
  'MintGroupMaxSupplyUpdated',
  'PublicMaxMintPerWalletChanged',
  'MintOnBehalfUpdated',
  'FeesUpdated',
] as const

/** The events that change the extras: the base URI, the owner, the royalty and the validator. */
export const EXTRAS_EVENTS = [
  'BatchMetadataUpdate',
  'OwnershipTransferred',
  'DefaultRoyaltyUpdated',
  'TokenRoyaltyUpdated',
  'TransferValidatorUpdated',
] as const

const COLLECTION_TOPICS: readonly Hex[] = [...STATE_EVENTS, ...EXTRAS_EVENTS].map((name) =>
  toEventSelector(getAbiItem({ abi: collectionAbi, name })),
)
const LEVEL_TOPIC: Hex = toEventSelector(getAbiItem({ abi: validatorAbi, name: 'SetTransferSecurityLevel' }))

/** The 15 topics the scan asks for: the 14 collection events, then the validator's level event. */
export function watchedTopics(): Hex[] {
  return [...COLLECTION_TOPICS, LEVEL_TOPIC]
}

/** A log as the scan reads it: any viem log, or a node's answer to `eth_getLogs`, has this shape. */
export type LogLike = { address: Address; topics: readonly Hex[] }

/** A hot collection as the scan sees it: its address and the validator of its last extras, if any. */
export type ScanTarget = { address: Address; validator: Address | null }

/**
 * The lowercase addresses of the collections to read in full: a hot collection with a watched log of its own,
 * and the collection a validator's `SetTransferSecurityLevel` names in its topic1 when that collection uses
 * that validator. Anything else is ignored.
 */
export function marksOf(logs: readonly LogLike[], hot: readonly ScanTarget[]): Set<string> {
  const targets = new Map(hot.map((target) => [target.address.toLowerCase(), target]))
  const collectionTopics = new Set(COLLECTION_TOPICS)
  const marks = new Set<string>()
  for (const log of logs) {
    const from = log.address.toLowerCase()
    const topic = log.topics[0]?.toLowerCase() as Hex | undefined
    if (!topic) continue
    if (targets.has(from) && collectionTopics.has(topic)) {
      marks.add(from)
      continue
    }
    const named = log.topics[1]
    if (topic !== LEVEL_TOPIC || !named) continue
    const collection = `0x${named.slice(26)}`.toLowerCase()
    const validator = targets.get(collection)?.validator
    if (validator && validator.toLowerCase() === from) marks.add(collection)
  }
  return marks
}

/** One `eth_getLogs` as the scan sends it: raw topics, so one call covers both ABIs. */
export type GetLogs = (filter: {
  address: Address[]
  topics: [Hex[]]
  fromBlock: bigint
  toBlock: bigint
}) => Promise<readonly LogLike[]>

/** What a scan found: the collections to read in full, and whether it was a gap (skipped or failed). */
export type Scan = { marks: Set<string>; gap: boolean; failure: string | null }

/**
 * Scans the blocks after `scanned` up to `head`: one `eth_getLogs` over the hot collections and `validators`
 * (the distinct validators of their extras that have code). A range over 500 blocks is not sent, and a failed
 * call is not tried again: either way every hot collection is marked, as a gap.
 */
export async function scanLogs(
  getLogs: GetLogs,
  scanned: bigint,
  head: bigint,
  hot: readonly ScanTarget[],
  validators: readonly Address[],
): Promise<Scan> {
  const everyHot = new Set(hot.map((target) => target.address.toLowerCase()))
  if (head - scanned > MAX_LOG_RANGE) return { marks: everyHot, gap: true, failure: null }
  try {
    const logs = await getLogs({
      address: [...hot.map((target) => target.address), ...validators],
      topics: [watchedTopics()],
      fromBlock: scanned + 1n,
      toBlock: head,
    })
    return { marks: marksOf(logs, hot), gap: false, failure: null }
  } catch (error) {
    return { marks: everyHot, gap: true, failure: errorName(error) }
  }
}
```

- [ ] **Step 4: The reader**

Decision (section 6.4): `stop()` answers a promise that settles once the tick in flight has ended (Decision 3); the level read asks `getCode` once for each distinct validator not yet known to have code and keeps the code it finds for the chain, and the log scan's address list carries only those validators; `/health`'s tier is computed from the chain's entries when asked, and `lagSeconds` from the newest block time among its reads, never below 0 (Decision 6).

Replace the whole of `apps/freshness/src/chain-reader.ts` with:

```ts
import {
  chainStateOf,
  levelOf,
  readEach,
  validatorAbi,
  type ChainConfig,
  type ChainState,
  type CollectionStateResult,
  type TransferLevelState,
} from '@cobweb/shared'
import { collectionAbi } from '@cobweb/shared/collection-abi'
import {
  getAddress,
  numberToHex,
  zeroAddress,
  type Address,
  type ContractFunctionParameters,
  type PublicClient,
} from 'viem'
import { errorLine, errorName, type ChainHealth } from './health.ts'
import type { HotEntry, HotSet } from './hot-set.ts'
import { scanLogs, type GetLogs } from './logs.ts'
import { chainTier, nextDelayMs } from './tiers.ts'

/** The fees `collectionState()` carries, wei as decimal strings. */
export type FeeWei = { mintFeeFlatWei: string; mintFeeBps: number; airdropFeePerTokenWei: string }

/** What a mint page shows beside the state, read on their logs and every 60 s. */
export type Extras = {
  owner: Address
  royalty: { receiver: Address; bps: number }
  baseUri: string
  transferValidator: Address
  transferLevel: TransferLevelState
}

/** A collection's last read: the state at its block, the fees and the extras. */
export type CollectionRead = { state: ChainState; fees: FeeWei; extras: Extras }

/** Besides on their logs, the extras are read again once 60 s old. */
export const EXTRAS_EVERY_MS = 60_000

/** The four extras calls, in the order the tick reads them. */
const extrasCalls = (address: Address): ContractFunctionParameters[] => [
  { address, abi: collectionAbi, functionName: 'owner' },
  // Settings reads the royalty the same way: token 1 at a price of 10,000, so the amount is the basis points.
  { address, abi: collectionAbi, functionName: 'royaltyInfo', args: [1n, 10_000n] },
  { address, abi: collectionAbi, functionName: 'baseURI' },
  { address, abi: collectionAbi, functionName: 'getTransferValidator' },
]

/**
 * The reader of one chain (docs/specs/2026-10-16-freshness-server.md, section 6.4). A tick expires the
 * chain's entries (with none left the reader stops and forgets its scanned block), reads the head, counts an
 * entry read at the head or later as read now, scans the logs since the last scanned block, then reads every
 * other entry's `collectionState()` at the head in one `readEach`, with the extras where they are due, and
 * the levels after it. Ticks never overlap: a wake during a tick runs one more tick after it. The next tick
 * starts one interval after this one started, or at once when it ran longer.
 */
export function chainReader(
  chain: ChainConfig,
  hot: HotSet,
  client: PublicClient,
): { wake(): void; stop(): Promise<void>; health(): ChainHealth } {
  /** The last block the logs were scanned to; null before the chain's first tick. */
  let scanned: bigint | null = null
  /** Validators found with code on this chain, lowercase. */
  const withCode = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | null = null
  let running: Promise<void> | null = null
  let again = false
  let stopped = false
  let block: bigint | null = null
  let headTime: number | null = null
  let lastGoodTickAt: number | null = null
  let failedTicks = 0
  let lastError: string | null = null
  let logGaps = 0

  const getLogs: GetLogs = (filter) =>
    client.request({
      method: 'eth_getLogs',
      params: [
        {
          address: filter.address,
          topics: filter.topics,
          fromBlock: numberToHex(filter.fromBlock),
          toBlock: numberToHex(filter.toBlock),
        },
      ],
    })

  /**
   * Each collection's level on its validator at the head, as Settings reads it: none for the zero validator
   * or one without code, the policy's level, or unread when the validator does not answer. A failed request
   * reads unread for all of them, without failing the tick.
   */
  async function levelsAt(
    head: bigint,
    asks: readonly { collection: Address; validator: Address }[],
  ): Promise<TransferLevelState[]> {
    const isZero = (validator: Address) => validator.toLowerCase() === zeroAddress
    try {
      // Each distinct validator not yet known to have code is asked once, at the head.
      const unknown = new Map<string, Address>()
      for (const { validator } of asks)
        if (!isZero(validator) && !withCode.has(validator.toLowerCase()))
          unknown.set(validator.toLowerCase(), validator)
      await Promise.all(
        [...unknown].map(async ([key, validator]) => {
          const code = await client.getCode({ address: validator, blockNumber: head })
          if (code && code !== '0x') withCode.add(key)
        }),
      )
      const hasCode = (validator: Address) => withCode.has(validator.toLowerCase())
      const policed = asks.filter((ask) => !isZero(ask.validator) && hasCode(ask.validator))
      const policies = await readEach<{ transferSecurityLevel: number }>(
        client,
        policed.map((ask) => ({
          address: ask.validator,
          abi: validatorAbi,
          functionName: 'getCollectionSecurityPolicy',
          args: [ask.collection],
        })),
        { blockNumber: head },
      )
      return asks.map((ask): TransferLevelState => {
        if (isZero(ask.validator) || !hasCode(ask.validator)) return levelOf(ask.validator, false, null)
        const policy = policies[policed.indexOf(ask)]
        return levelOf(ask.validator, true, policy ? policy.transferSecurityLevel : null)
      })
    } catch (error) {
      console.error(`The transfer levels on ${chain.name} could not be read: ${errorLine(error)}`)
      return asks.map((ask) =>
        isZero(ask.validator) ? levelOf(ask.validator, false, null) : { kind: 'unread' },
      )
    }
  }

  /**
   * Steps 5 to 7: one `readEach` at the head for `entries`, the levels after it, then each entry's new read.
   */
  async function readAt(head: bigint, entries: readonly HotEntry[], now: number): Promise<void> {
    const calls: ContractFunctionParameters[] = []
    const plans = entries.map((entry) => {
      const extras =
        entry.read === null ||
        entry.marked ||
        entry.extrasReadAt === null ||
        now - entry.extrasReadAt >= EXTRAS_EVERY_MS
      const at = calls.length
      calls.push({ address: entry.address, abi: collectionAbi, functionName: 'collectionState' })
      if (extras) calls.push(...extrasCalls(entry.address))
      return { entry, at, extras }
    })
    if (!calls.length) return
    const answers = await readEach<unknown>(client, calls, { blockNumber: head })
    // A call answering null leaves its entry as it was, its mark included.
    const answered = plans.filter(({ at, extras }) =>
      answers.slice(at, at + (extras ? 5 : 1)).every((answer) => answer !== null),
    )
    const levelAsks = answered
      .filter((plan) => plan.extras)
      .map(({ entry, at }) => ({
        collection: entry.address,
        validator: getAddress(answers[at + 4] as Address),
      }))
    const levels = await levelsAt(head, levelAsks)
    const doneAt = Date.now()
    for (const { entry, at, extras } of answered) {
      const raw = answers[at] as CollectionStateResult
      const previous = entry.read
      let read: Extras
      if (extras) {
        const [receiver, bps] = answers[at + 2] as readonly [Address, bigint]
        const asked = levelAsks.findIndex((ask) => ask.collection === entry.address)
        read = {
          owner: getAddress(answers[at + 1] as Address),
          royalty: { receiver: getAddress(receiver), bps: Number(bps) },
          baseUri: answers[at + 3] as string,
          transferValidator: levelAsks[asked]!.validator,
          transferLevel: levels[asked]!,
        }
      } else if (previous) read = previous.extras
      else continue
      entry.read = {
        state: chainStateOf(raw, head),
        fees: {
          mintFeeFlatWei: raw.mintFeeFlat.toString(),
          mintFeeBps: Number(raw.mintFeeBps),
          airdropFeePerTokenWei: raw.airdropFeePerToken.toString(),
        },
        extras: read,
      }
      entry.readAt = doneAt
      if (extras) {
        entry.extrasReadAt = doneAt
        entry.marked = false
      }
    }
  }

  /** One tick; answers the delay to the next, or null when the chain has no hot entry left. */
  async function tick(): Promise<number | null> {
    const startedAt = Date.now()
    hot.expire(startedAt)
    const entries = hot.onChain(chain.id)
    if (!entries.length) {
      scanned = null
      return null
    }
    try {
      // cacheTime 0: viem would otherwise reuse a recent head for its polling interval.
      const head = await client.getBlockNumber({ cacheTime: 0 })
      const now = Date.now()
      const stale: HotEntry[] = []
      for (const entry of entries) {
        // A load-balanced RPC can answer an older head: an entry read at the head or later is current.
        if (entry.read && entry.read.state.block >= head) entry.readAt = now
        else stale.push(entry)
      }
      if (scanned === null) scanned = head
      else if (head > scanned) {
        const validators = [
          ...new Set(
            entries
              .map((entry) => entry.read?.extras.transferValidator)
              .filter(
                (validator): validator is Address => !!validator && withCode.has(validator.toLowerCase()),
              ),
          ),
        ]
        const targets = entries.map((entry) => ({
          address: entry.address,
          validator: entry.read?.extras.transferValidator ?? null,
        }))
        const scan = await scanLogs(getLogs, scanned, head, targets, validators)
        if (scan.gap) logGaps++
        if (scan.failure)
          console.error(
            `The log scan on ${chain.name} failed (${scan.failure}); every hot collection is read in full.`,
          )
        for (const entry of entries) if (scan.marks.has(entry.address.toLowerCase())) entry.marked = true
        scanned = head
      }
      await readAt(head, stale, now)
      block = block !== null && block > head ? block : head
      const times = entries.flatMap((entry) => (entry.read ? [entry.read.state.blockTimestamp] : []))
      if (times.length) headTime = Math.max(...times)
      lastGoodTickAt = Date.now()
    } catch (error) {
      failedTicks++
      lastError = errorName(error)
      console.error(`A tick on ${chain.name} failed: ${errorLine(error)}`)
    }
    const current = hot.onChain(chain.id)
    const reads = current.flatMap((entry) =>
      entry.read && entry.readAt !== null ? [{ state: entry.read.state, readAt: entry.readAt }] : [],
    )
    const tier = chainTier(current.map((entry) => entry.read?.state ?? null))
    return nextDelayMs(tier, reads, startedAt, Date.now())
  }

  function start(): void {
    if (stopped || running) return
    if (timer) clearTimeout(timer)
    timer = null
    running = tick().then((delay) => {
      running = null
      if (stopped) return
      if (again) {
        again = false
        start()
      } else if (delay !== null) timer = setTimeout(start, delay)
    })
  }

  return {
    wake() {
      if (stopped) return
      if (running) again = true
      else start()
    },
    async stop() {
      stopped = true
      if (timer) clearTimeout(timer)
      timer = null
      await running
    },
    health() {
      const entries = hot.onChain(chain.id)
      return {
        chainId: chain.id,
        name: chain.name,
        hot: entries.length,
        tier: entries.length ? chainTier(entries.map((entry) => entry.read?.state ?? null)) : null,
        block: block === null ? null : Number(block),
        lagSeconds: headTime === null ? null : Math.max(0, Math.round(Date.now() / 1_000 - headTime)),
        lastGoodTickAt: lastGoodTickAt === null ? null : new Date(lastGoodTickAt).toISOString(),
        failedTicks,
        lastError,
        logGaps,
      }
    },
  }
}
```

- [ ] **Step 5: Run the tests to see them pass, then typecheck and lint the package**

Run: `pnpm --filter @cobweb/freshness exec vitest run src/logs.test.ts src/chain-reader.test.ts`
Expected: PASS, 2 files and 15 tests.

Run: `pnpm --filter @cobweb/freshness typecheck && pnpm --filter @cobweb/freshness lint`
Expected: no errors and no warnings.

- [ ] **Step 6: Format, run the root checks and commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
pnpm exec prettier --write apps/freshness/src/health.ts apps/freshness/src/logs.ts apps/freshness/src/logs.test.ts apps/freshness/src/chain-reader.ts apps/freshness/src/chain-reader.test.ts
pnpm typecheck && pnpm lint && pnpm test
git add apps/freshness/src/health.ts apps/freshness/src/logs.ts apps/freshness/src/logs.test.ts apps/freshness/src/chain-reader.ts apps/freshness/src/chain-reader.test.ts
git commit -m "$(cat <<'EOF'
Add the freshness server's chain reader: one head, one log scan and one readEach per tick at the tier's interval, the extras on their logs and every 60 s, the levels, and the health it reports

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: the freshness package reports 39 tests in 6 files (24 before, plus 15).

---

### Task 6: The delegate registry's ABI, the vault filter and the wallet windows

**Files:**

- Create: `packages/shared/src/delegate-registry-abi.ts`, `delegate-registry-abi.test.ts`
- Modify: `packages/shared/src/index.ts` (the header comment; one export)
- Create: `apps/freshness/src/delegations.ts`, `delegations.test.ts`, `wallet.ts`, `wallet.test.ts`
- Test: the three test files

**Interfaces:**

- Consumes: `readEach`, `ChainConfig` from `@cobweb/shared`; `collectionAbi` (`walletState(wallet)` answers `publicMinted, groupIds, quotaIssued, quotaClaimed_`); `errorLine` (Task 5). The registry's ABI is written by hand from its published source (`src/IDelegateRegistry.sol`, `@custom:version 2.0`), as the spec section 5.3 confirmed on 16 October 2026; the address is the one `contracts/src/CobwebCollection.sol` holds at line 119.
- Produces:
  - in `@cobweb/shared`: `DELEGATE_REGISTRY: Address = '0x00000000000000447e69651d841bD8D104Bed493'`, `DELEGATION_TYPE = { none: 0, all: 1, contract: 2, erc721: 3, erc20: 4, erc1155: 5 }`, `delegateRegistryAbi` (`getIncomingDelegations(address to)`, selector `0x42f87c25`, answering `(uint8 type_, address to, address from, bytes32 rights, address contract_, uint256 tokenId, uint256 amount)[]`)
  - `delegations.ts`: `MAX_VAULTS = 10`; `Delegation = { type_: number; to: Address; from: Address; rights: Hex; contract_: Address; tokenId: bigint; amount: bigint }`; `vaultsOf(delegations, collection: Address, wallet: Address): Address[]`
  - `wallet.ts`: `WINDOW_MS = 200`, `WINDOW_MAX = 200`, `QUEUE_MAX = 5_000`, `REGISTRY_RECHECK_MS = 3_600_000`; `QuotaBody = { id: number; quota: number; claimed: number }`; `WalletBody = { chainId; address; wallet; block; publicMinted; groups: QuotaBody[]; vaults: { vault; publicMinted; groups }[] }`; `walletWindows(chain: ChainConfig, client: PublicClient): { ask(address, wallet): Promise<WalletBody | 'busy' | 'unreadable'>; stats(): { windows; answered; waiting }; stop(): Promise<void> }`

- [ ] **Step 1: Write the failing tests**

Create `packages/shared/src/delegate-registry-abi.test.ts`:

```ts
import { getAbiItem, getAddress, toFunctionSelector } from 'viem'
import { describe, expect, it } from 'vitest'
import { DELEGATE_REGISTRY, delegateRegistryAbi, DELEGATION_TYPE } from './delegate-registry-abi.ts'

describe('delegateRegistryAbi (docs/specs/2026-10-16-freshness-server.md, section 5.3)', () => {
  it("holds getIncomingDelegations(address) alone, as the registry's source declares it", () => {
    expect(delegateRegistryAbi.map((entry) => `${entry.type} ${entry.name}`)).toEqual([
      'function getIncomingDelegations',
    ])
    const listing = getAbiItem({ abi: delegateRegistryAbi, name: 'getIncomingDelegations' })
    expect(toFunctionSelector(listing)).toBe('0x42f87c25')
    expect(listing.stateMutability).toBe('view')
    expect(listing.inputs.map((input) => [input.name, input.type])).toEqual([['to', 'address']])
  })

  it('answers the seven fields of a Delegation, in order, with their types', () => {
    const [output] = getAbiItem({ abi: delegateRegistryAbi, name: 'getIncomingDelegations' }).outputs
    expect(output.type).toBe('tuple[]')
    expect(output.components.map((field) => [field.name, field.type])).toEqual([
      ['type_', 'uint8'],
      ['to', 'address'],
      ['from', 'address'],
      ['rights', 'bytes32'],
      ['contract_', 'address'],
      ['tokenId', 'uint256'],
      ['amount', 'uint256'],
    ])
  })

  it('ships the address the collection holds, checksummed, and the DelegationType values', () => {
    expect(DELEGATE_REGISTRY).toBe('0x00000000000000447e69651d841bD8D104Bed493')
    expect(getAddress(DELEGATE_REGISTRY)).toBe(DELEGATE_REGISTRY)
    expect(DELEGATION_TYPE).toEqual({ none: 0, all: 1, contract: 2, erc721: 3, erc20: 4, erc1155: 5 })
  })
})
```

Create `apps/freshness/src/delegations.test.ts`:

```ts
import { DELEGATION_TYPE } from '@cobweb/shared'
import { getAddress, zeroAddress, zeroHash, type Address, type Hex } from 'viem'
import { describe, expect, it } from 'vitest'
import { MAX_VAULTS, vaultsOf, type Delegation } from './delegations.ts'

const COLLECTION: Address = '0x0409454C375c8a6aB05383bFB6D9FcDe9ebB8F85'
const OTHER_CONTRACT: Address = '0x5FbDB2315678afecb367f032d93F642f64180aa3'
const WALLET: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const RIGHTS: Hex = `0x${'61'.repeat(32)}`

/** The vault of index `n`, checksummed, distinct for every n. */
const vault = (n: number) => getAddress(`0x${(n + 1).toString(16).padStart(40, '0')}`)

/**
 * A delegation to the wallet, as the registry lists it: ALL from `from` unless the overrides say otherwise.
 */
const delegation = (from: Address, overrides: Partial<Delegation> = {}): Delegation => ({
  type_: DELEGATION_TYPE.all,
  to: WALLET,
  from,
  rights: zeroHash,
  contract_: zeroAddress,
  tokenId: 0n,
  amount: 0n,
  ...overrides,
})

describe('vaultsOf (docs/specs/2026-10-16-freshness-server.md, section 6.8)', () => {
  it('keeps ALL, and CONTRACT for this collection in any case, with empty rights', () => {
    expect(
      vaultsOf(
        [
          delegation(vault(0)),
          delegation(vault(1), { type_: DELEGATION_TYPE.contract, contract_: COLLECTION }),
          delegation(vault(2), {
            type_: DELEGATION_TYPE.contract,
            contract_: COLLECTION.toLowerCase() as Address,
          }),
        ],
        COLLECTION,
        WALLET,
      ),
    ).toEqual([vault(0), vault(1), vault(2)])
  })

  it('drops CONTRACT for another contract, the token-scoped types, rights, the wallet itself and the zero address', () => {
    expect(
      vaultsOf(
        [
          delegation(vault(0), { type_: DELEGATION_TYPE.contract, contract_: OTHER_CONTRACT }),
          delegation(vault(1), { type_: DELEGATION_TYPE.erc721, contract_: COLLECTION, tokenId: 1n }),
          delegation(vault(2), { type_: DELEGATION_TYPE.erc20, contract_: COLLECTION, amount: 5n }),
          delegation(vault(3), { type_: DELEGATION_TYPE.erc1155, contract_: COLLECTION, tokenId: 1n }),
          delegation(vault(4), { type_: DELEGATION_TYPE.none }),
          delegation(vault(5), { rights: RIGHTS }),
          delegation(WALLET),
          delegation(WALLET.toLowerCase() as Address),
          delegation(zeroAddress),
        ],
        COLLECTION,
        WALLET,
      ),
    ).toEqual([])
  })

  it("keeps a vault that delegates twice once, in the registry's order", () => {
    expect(
      vaultsOf(
        [
          delegation(vault(2)),
          delegation(vault(1), { type_: DELEGATION_TYPE.contract, contract_: COLLECTION }),
          delegation(vault(2), { type_: DELEGATION_TYPE.contract, contract_: COLLECTION }),
          delegation(vault(0)),
        ],
        COLLECTION,
        WALLET,
      ),
    ).toEqual([vault(2), vault(1), vault(0)])
  })

  it('stops at 10 vaults', () => {
    const many = Array.from({ length: 12 }, (_, n) => delegation(vault(n)))
    expect(MAX_VAULTS).toBe(10)
    expect(vaultsOf(many, COLLECTION, WALLET)).toEqual(Array.from({ length: 10 }, (_, n) => vault(n)))
  })
})
```

Create `apps/freshness/src/wallet.test.ts`:

```ts
import { chainById, DELEGATE_REGISTRY, DELEGATION_TYPE } from '@cobweb/shared'
import { collectionAbi } from '@cobweb/shared/collection-abi'
import {
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  getAddress,
  HttpRequestError,
  zeroAddress,
  zeroHash,
  type Address,
  type PublicClient,
} from 'viem'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Delegation } from './delegations.ts'
import {
  QUEUE_MAX,
  REGISTRY_RECHECK_MS,
  WINDOW_MAX,
  WINDOW_MS,
  walletWindows,
  type WalletBody,
} from './wallet.ts'

const ANVIL = chainById(31337, false)!
const A: Address = '0x0409454C375c8a6aB05383bFB6D9FcDe9ebB8F85'
const B: Address = '0x5FbDB2315678afecb367f032d93F642f64180aa3'
const WALLET: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const V1: Address = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
const V2: Address = '0x90F79bf6EB2c4f870365E785982E1f101E93b906'
const V3: Address = '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65'

/** The wallet of index `n`, checksummed, distinct for every n. */
const walletOf = (n: number) => getAddress(`0x${(n + 1).toString(16).padStart(40, '0')}`)

const delegation = (from: Address, overrides: Partial<Delegation> = {}): Delegation => ({
  type_: DELEGATION_TYPE.all,
  to: WALLET,
  from,
  rights: zeroHash,
  contract_: zeroAddress,
  tokenId: 0n,
  amount: 0n,
  ...overrides,
})

/**
 * A fake reader on a chain without multicall3 (so `readEach` reads each call), recording `head`, `code`,
 * `walletState <collection> <wallet> @<block>` and `listing <wallet> @<block>`. Each wallet's `walletState`
 * is public 1, Holders (id 1) quota 2 and claimed 1.
 */
function fakeReader() {
  const reader = {
    head: 100n,
    registryHasCode: true,
    failHead: false,
    calls: [] as string[],
    /** `<collection> <wallet>` pairs whose walletState reverts. */
    reverts: new Set<string>(),
    listings: new Map<string, Delegation[]>(),
  }
  const client = {
    chain: { contracts: {} },
    async getBlockNumber() {
      reader.calls.push('head')
      if (reader.failHead)
        throw new HttpRequestError({ url: 'https://rpc.example/v2/secret-key', status: 503 })
      return reader.head
    },
    async getCode({ address }: { address: Address }) {
      reader.calls.push(`code ${address}`)
      return reader.registryHasCode ? '0x6080' : undefined
    },
    async readContract({
      address,
      functionName,
      args,
      blockNumber,
    }: {
      address: Address
      functionName: string
      args: [Address]
      blockNumber: bigint
    }) {
      if (functionName === 'getIncomingDelegations') {
        reader.calls.push(`listing ${args[0]} @${blockNumber}`)
        return reader.listings.get(args[0]) ?? []
      }
      reader.calls.push(`walletState ${address} ${args[0]} @${blockNumber}`)
      if (reader.reverts.has(`${address} ${args[0]}`))
        throw new ContractFunctionExecutionError(
          new ContractFunctionRevertedError({ abi: collectionAbi, functionName: 'walletState' }),
          { abi: collectionAbi, args, contractAddress: address, functionName: 'walletState' },
        )
      return [1n, [0n, 1n], [0n, 2n], [0n, 1n]]
    },
  } as unknown as PublicClient
  return { reader, client }
}

const quotas = {
  publicMinted: 1,
  groups: [
    { id: 0, quota: 0, claimed: 0 },
    { id: 1, quota: 2, claimed: 1 },
  ],
}

describe('walletWindows (docs/specs/2026-10-16-freshness-server.md, section 6.8)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('answers the asks made within 200 ms from one window, at one head', async () => {
    const { reader, client } = fakeReader()
    reader.registryHasCode = false
    const windows = walletWindows(ANVIL, client)
    const first = windows.ask(A, WALLET)
    await vi.advanceTimersByTimeAsync(150)
    const second = windows.ask(A, V1)
    expect(windows.stats()).toEqual({ windows: 0, answered: 0, waiting: 2 })
    await vi.advanceTimersByTimeAsync(WINDOW_MS - 150)
    expect(await first).toEqual<WalletBody>({
      chainId: 31337,
      address: A,
      wallet: WALLET,
      block: 100,
      ...quotas,
      vaults: [],
    })
    expect(await second).toMatchObject({ wallet: V1, block: 100 })
    expect(reader.calls.filter((call) => call === 'head')).toHaveLength(1)
    expect(windows.stats()).toEqual({ windows: 1, answered: 2, waiting: 0 })
    await windows.stop()
  })

  it('reads a pair asked twice in a window once, whatever the case', async () => {
    const { reader, client } = fakeReader()
    reader.registryHasCode = false
    const windows = walletWindows(ANVIL, client)
    const asks = [windows.ask(A, WALLET), windows.ask(A, WALLET.toLowerCase() as Address)]
    await vi.advanceTimersByTimeAsync(WINDOW_MS)
    expect((await Promise.all(asks)).map((body) => typeof body === 'object' && body.wallet)).toEqual([
      WALLET,
      WALLET,
    ])
    expect(reader.calls.filter((call) => call.startsWith('walletState'))).toEqual([
      `walletState ${A} ${WALLET} @100`,
    ])
    await windows.stop()
  })

  it('takes at most 200 pairs a window, and opens the next at once for the rest', async () => {
    const { reader, client } = fakeReader()
    reader.registryHasCode = false
    const windows = walletWindows(ANVIL, client)
    const asks = Array.from({ length: 250 }, (_, n) => windows.ask(A, walletOf(n)))
    const states = () => reader.calls.filter((call) => call.startsWith('walletState')).length
    await vi.advanceTimersByTimeAsync(WINDOW_MS)
    expect(states()).toBe(WINDOW_MAX)
    await vi.advanceTimersByTimeAsync(WINDOW_MS - 1)
    expect(states()).toBe(WINDOW_MAX)
    await vi.advanceTimersByTimeAsync(1)
    expect(states()).toBe(250)
    expect((await Promise.all(asks)).every((body) => typeof body === 'object')).toBe(true)
    expect(windows.stats()).toEqual({ windows: 2, answered: 250, waiting: 0 })
    await windows.stop()
  })

  it('answers busy to the ask past 5,000 waiting', async () => {
    const { reader, client } = fakeReader()
    reader.registryHasCode = false
    const windows = walletWindows(ANVIL, client)
    const asks = Array.from({ length: QUEUE_MAX }, (_, n) => windows.ask(A, walletOf(n % 300)))
    expect(await windows.ask(B, WALLET)).toBe('busy')
    expect(windows.stats().waiting).toBe(QUEUE_MAX)
    await vi.advanceTimersByTimeAsync(WINDOW_MS * 2)
    await Promise.all(asks)
    expect(windows.stats().waiting).toBe(0)
    await windows.stop()
  })

  it("fails a window's asks when its head fails, and only its pair when one walletState answers null", async () => {
    const { reader, client } = fakeReader()
    reader.registryHasCode = false
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const windows = walletWindows(ANVIL, client)
    reader.failHead = true
    const failed = [windows.ask(A, WALLET), windows.ask(B, WALLET)]
    await vi.advanceTimersByTimeAsync(WINDOW_MS)
    expect(await Promise.all(failed)).toEqual(['unreadable', 'unreadable'])
    reader.failHead = false
    reader.reverts.add(`${B} ${WALLET}`)
    const mixed = [windows.ask(A, WALLET), windows.ask(B, WALLET)]
    await vi.advanceTimersByTimeAsync(WINDOW_MS)
    const [own, other] = await Promise.all(mixed)
    expect(own).toMatchObject({ address: A, block: 100 })
    expect(other).toBe('unreadable')
    await windows.stop()
  })

  it("reads the vaults' walletState at the window's head, after the listing", async () => {
    const { reader, client } = fakeReader()
    reader.listings.set(WALLET, [
      delegation(V1),
      delegation(V2, { type_: DELEGATION_TYPE.contract, contract_: A }),
    ])
    const windows = walletWindows(ANVIL, client)
    const ask = windows.ask(A, WALLET)
    await vi.advanceTimersByTimeAsync(WINDOW_MS)
    expect(await ask).toEqual<WalletBody>({
      chainId: 31337,
      address: A,
      wallet: WALLET,
      block: 100,
      ...quotas,
      vaults: [
        { vault: V1, ...quotas },
        { vault: V2, ...quotas },
      ],
    })
    expect(reader.calls).toEqual([
      'head',
      `code ${DELEGATE_REGISTRY}`,
      `walletState ${A} ${WALLET} @100`,
      `listing ${WALLET} @100`,
      `walletState ${A} ${V1} @100`,
      `walletState ${A} ${V2} @100`,
    ])
    await windows.stop()
  })

  it('lists nothing where the registry has no code, and asks for its code again only after an hour', async () => {
    const { reader, client } = fakeReader()
    reader.registryHasCode = false
    reader.listings.set(WALLET, [delegation(V1)])
    const windows = walletWindows(ANVIL, client)
    const first = windows.ask(A, WALLET)
    await vi.advanceTimersByTimeAsync(WINDOW_MS)
    expect(await first).toMatchObject({ vaults: [] })
    const second = windows.ask(A, WALLET)
    await vi.advanceTimersByTimeAsync(WINDOW_MS)
    await second
    expect(reader.calls.filter((call) => call.startsWith('code') || call.startsWith('listing'))).toEqual([
      `code ${DELEGATE_REGISTRY}`,
    ])
    await vi.advanceTimersByTimeAsync(REGISTRY_RECHECK_MS)
    reader.registryHasCode = true
    const third = windows.ask(A, WALLET)
    await vi.advanceTimersByTimeAsync(WINDOW_MS)
    expect(await third).toMatchObject({ vaults: [{ vault: V1 }] })
    expect(reader.calls.filter((call) => call.startsWith('code'))).toHaveLength(2)
    await windows.stop()
  })

  it('reads one listing per wallet for two collections, each pair keeping only its own contract delegations (Review Focus 4)', async () => {
    const { reader, client } = fakeReader()
    reader.listings.set(WALLET, [
      delegation(V1, { type_: DELEGATION_TYPE.contract, contract_: A }),
      delegation(V2, { type_: DELEGATION_TYPE.contract, contract_: B }),
      delegation(V3),
    ])
    const windows = walletWindows(ANVIL, client)
    const asks = [windows.ask(A, WALLET), windows.ask(B, WALLET)]
    await vi.advanceTimersByTimeAsync(WINDOW_MS)
    const [onA, onB] = await Promise.all(asks)
    const vaults = (body: unknown) => (body as WalletBody).vaults.map((entry) => entry.vault)
    expect([vaults(onA), vaults(onB)]).toEqual([
      [V1, V3],
      [V2, V3],
    ])
    expect(reader.calls.filter((call) => call.startsWith('listing'))).toEqual([`listing ${WALLET} @100`])
    expect(reader.calls.filter((call) => call.startsWith('walletState') && call.includes(V3))).toEqual([
      `walletState ${A} ${V3} @100`,
      `walletState ${B} ${V3} @100`,
    ])
    await windows.stop()
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @cobweb/shared exec vitest run src/delegate-registry-abi.test.ts`
Expected: FAIL. The file fails to load with `Cannot find module './delegate-registry-abi.ts'`. The run ends `Test Files  1 failed (1)` and `Tests  no tests`.

Run: `pnpm --filter @cobweb/freshness exec vitest run src/delegations.test.ts src/wallet.test.ts`
Expected: FAIL. Both files fail to load: `delegations.test.ts` with `Cannot find module './delegations.ts'` and `wallet.test.ts` with `Cannot find module './wallet.ts'`. The run ends `Test Files  2 failed (2)` and `Tests  no tests`.

- [ ] **Step 3: The registry's ABI**

Create `packages/shared/src/delegate-registry-abi.ts`:

```ts
import type { Address } from 'viem'

// Written by hand from the delegate.xyz v2 registry's published source
// (github.com/delegatexyz/delegate-registry, src/IDelegateRegistry.sol, `@custom:version 2.0`): the
// `Delegation` struct, its `DelegationType` enum (NONE, ALL, CONTRACT, ERC721, ERC20, ERC1155) encoded as
// uint8, and `getIncomingDelegations(address)`. Confirmed on 16 October 2026 with the two rules of its
// implementation the freshness server relies on: getIncomingDelegations leaves out revoked delegations, and
// checkDelegateForContract(to, from, contract_, "") accepts only an ALL or a CONTRACT delegation with empty
// rights. The address is the one the collection holds (contracts/src/CobwebCollection.sol, line 119) and the
// one the registry's README lists for its EVM chains. Change it only with the registry
// (docs/specs/2026-10-16-freshness-server.md, section 5.3).

/** The delegate.xyz v2 registry: the same address on every EVM chain it is deployed to. */
export const DELEGATE_REGISTRY: Address = '0x00000000000000447e69651d841bD8D104Bed493'

/** The registry's `DelegationType`, as the uint8 it encodes. */
export const DELEGATION_TYPE = { none: 0, all: 1, contract: 2, erc721: 3, erc20: 4, erc1155: 5 } as const

/** The one entry the freshness server reads: a wallet's incoming delegations, the revoked ones left out. */
export const delegateRegistryAbi = [
  {
    type: 'function',
    name: 'getIncomingDelegations',
    inputs: [{ name: 'to', type: 'address', internalType: 'address' }],
    outputs: [
      {
        name: 'delegations',
        type: 'tuple[]',
        internalType: 'struct IDelegateRegistry.Delegation[]',
        components: [
          { name: 'type_', type: 'uint8', internalType: 'enum IDelegateRegistry.DelegationType' },
          { name: 'to', type: 'address', internalType: 'address' },
          { name: 'from', type: 'address', internalType: 'address' },
          { name: 'rights', type: 'bytes32', internalType: 'bytes32' },
          { name: 'contract_', type: 'address', internalType: 'address' },
          { name: 'tokenId', type: 'uint256', internalType: 'uint256' },
          { name: 'amount', type: 'uint256', internalType: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
] as const
```

In `packages/shared/src/index.ts`, replace:

```ts
// Browser-safe entry: the chain list, the factory ABI, the job ids, the render queue contract, the deploy
// address helpers, the transfer validator's ABI and the pure chain readers the web app and the freshness server
// share. Nothing here reads a server-only variable.
```

with:

```ts
// Browser-safe entry: the chain list, the factory ABI, the job ids, the render queue contract, the deploy
// address helpers, the transfer validator's and the delegate registry's ABIs, and the pure chain readers the web
// app and the freshness server share. Nothing here reads a server-only variable.
```

In `packages/shared/src/index.ts`, replace:

```ts
export * from './collection-state.ts'
```

with:

```ts
export * from './collection-state.ts'
export * from './delegate-registry-abi.ts'
```

- [ ] **Step 4: The vault filter and the windows**

Decision (section 6.8): a failed `getCode` of the registry fails its window as a failed head does; a vault whose `walletState` answers null fails its pair, as the wallet's own does; `answered` counts every ask a window answered, `unreadable` included; `stop()` answers the waiting asks `unreadable` and settles once the windows in flight have ended (Decision 3).

Create `apps/freshness/src/delegations.ts`:

```ts
import { DELEGATION_TYPE } from '@cobweb/shared'
import { getAddress, zeroAddress, zeroHash, type Address, type Hex } from 'viem'

/**
 * The vault filter (docs/specs/2026-10-16-freshness-server.md, section 6.8), pure: which of a wallet's
 * incoming delegations name a vault it may mint for on this collection. The collection asks
 * `checkDelegateForContract(caller, vault, this, "")`, which accepts only a whole-wallet (ALL) or a contract
 * (CONTRACT) delegation with empty rights.
 */

/** The most vaults a wallet answer lists. */
export const MAX_VAULTS = 10

/** One delegation as the registry's `getIncomingDelegations` answers it. */
export type Delegation = {
  type_: number
  to: Address
  from: Address
  rights: Hex
  contract_: Address
  tokenId: bigint
  amount: bigint
}

/**
 * The vaults: the `from` of each ALL delegation, or CONTRACT one for this collection (compared without case),
 * with empty rights; never the wallet itself or the zero address; each once, in the registry's order, at most
 * 10.
 */
export function vaultsOf(
  delegations: readonly Delegation[],
  collection: Address,
  wallet: Address,
): Address[] {
  const vaults: Address[] = []
  const seen = new Set<string>([wallet.toLowerCase(), zeroAddress])
  for (const delegation of delegations) {
    if (vaults.length === MAX_VAULTS) break
    const scoped =
      delegation.type_ === DELEGATION_TYPE.all ||
      (delegation.type_ === DELEGATION_TYPE.contract &&
        delegation.contract_.toLowerCase() === collection.toLowerCase())
    const from = delegation.from.toLowerCase()
    if (!scoped || delegation.rights.toLowerCase() !== zeroHash || seen.has(from)) continue
    seen.add(from)
    vaults.push(getAddress(delegation.from))
  }
  return vaults
}
```

Create `apps/freshness/src/wallet.ts`:

```ts
import { DELEGATE_REGISTRY, delegateRegistryAbi, readEach, type ChainConfig } from '@cobweb/shared'
import { collectionAbi } from '@cobweb/shared/collection-abi'
import type { Address, ContractFunctionParameters, PublicClient } from 'viem'
import { vaultsOf, type Delegation } from './delegations.ts'
import { errorLine } from './health.ts'

/**
 * The wallet endpoint's reads (docs/specs/2026-10-16-freshness-server.md, section 6.8): asks are gathered per
 * chain into 200 ms windows of at most 200 distinct (collection, wallet) pairs. A window reads the head, then
 * one `readEach` at it of each pair's `walletState(wallet)` and, where the registry has code, each distinct
 * wallet's `getIncomingDelegations`, then the vaults' `walletState` at the same block. There is no cache: the
 * edge holds each answer 5 s.
 */

/** A window closes 200 ms after it opens. */
export const WINDOW_MS = 200
/** The most pairs one window reads; the rest wait for the next window, which opens at once. */
export const WINDOW_MAX = 200
/** The most asks that may wait on one chain; the next answers busy. */
export const QUEUE_MAX = 5_000
/** Where the registry has no code, it is asked again after an hour. */
export const REGISTRY_RECHECK_MS = 3_600_000

/** One registered group of `walletState`: the quota issued and claimed, both 0 for the public group. */
export type QuotaBody = { id: number; quota: number; claimed: number }

export type WalletBody = {
  chainId: number
  /** The collection, checksummed. */
  address: Address
  /** Checksummed. */
  wallet: Address
  /** The block the window read at. */
  block: number
  publicMinted: number
  groups: QuotaBody[]
  vaults: { vault: Address; publicMinted: number; groups: QuotaBody[] }[]
}

type Answer = WalletBody | 'busy' | 'unreadable'
type Pair = { address: Address; wallet: Address; waiters: ((answer: Answer) => void)[] }
type WalletState = readonly [bigint, readonly bigint[], readonly bigint[], readonly bigint[]]

/** A `walletState` answer as the body carries it. */
function quotasOf(state: WalletState): { publicMinted: number; groups: QuotaBody[] } {
  const [publicMinted, ids, issued, claimed] = state
  return {
    publicMinted: Number(publicMinted),
    groups: ids.map((id, index) => ({
      id: Number(id),
      quota: Number(issued[index] ?? 0n),
      claimed: Number(claimed[index] ?? 0n),
    })),
  }
}

export function walletWindows(
  chain: ChainConfig,
  client: PublicClient,
): {
  ask(address: Address, wallet: Address): Promise<Answer>
  stats(): { windows: number; answered: number; waiting: number }
  stop(): Promise<void>
} {
  /** The pairs waiting for the next window to close, in the order they were first asked. */
  const queue = new Map<string, Pair>()
  const reads = new Set<Promise<void>>()
  let timer: ReturnType<typeof setTimeout> | null = null
  let registry: { hasCode: boolean; askedAt: number } | null = null
  let windows = 0
  let answered = 0
  let waiting = 0
  let stopped = false

  function answer(pair: Pair, value: Answer): void {
    for (const resolve of pair.waiters) resolve(value)
    waiting -= pair.waiters.length
    answered += pair.waiters.length
  }

  /**
   * Whether the registry has code on the chain: code found is kept, and none is asked again after an hour.
   */
  async function listed(head: bigint): Promise<boolean> {
    if (registry && (registry.hasCode || Date.now() - registry.askedAt < REGISTRY_RECHECK_MS))
      return registry.hasCode
    const code = await client.getCode({ address: DELEGATE_REGISTRY, blockNumber: head })
    registry = { hasCode: !!code && code !== '0x', askedAt: Date.now() }
    return registry.hasCode
  }

  async function read(pairs: readonly Pair[]): Promise<void> {
    try {
      const head = await client.getBlockNumber({ cacheTime: 0 })
      const withRegistry = await listed(head)
      const wallets = [...new Map(pairs.map((pair) => [pair.wallet.toLowerCase(), pair.wallet])).values()]
      const calls: ContractFunctionParameters[] = pairs.map((pair) => ({
        address: pair.address,
        abi: collectionAbi,
        functionName: 'walletState',
        args: [pair.wallet],
      }))
      if (withRegistry)
        for (const wallet of wallets)
          calls.push({
            address: DELEGATE_REGISTRY,
            abi: delegateRegistryAbi,
            functionName: 'getIncomingDelegations',
            args: [wallet],
          })
      const answers = await readEach<unknown>(client, calls, { blockNumber: head })
      // A null listing reads as no vaults.
      const listings = new Map(
        wallets.map((wallet, index) => [
          wallet.toLowerCase(),
          (answers[pairs.length + index] ?? []) as readonly Delegation[],
        ]),
      )
      const vaults = pairs.map((pair) =>
        vaultsOf(listings.get(pair.wallet.toLowerCase()) ?? [], pair.address, pair.wallet),
      )
      const vaultStates = await readEach<WalletState>(
        client,
        pairs.flatMap((pair, index) =>
          vaults[index]!.map((vault) => ({
            address: pair.address,
            abi: collectionAbi,
            functionName: 'walletState',
            args: [vault],
          })),
        ),
        { blockNumber: head },
      )
      let next = 0
      pairs.forEach((pair, index) => {
        const own = answers[index] as WalletState | null
        const theirs = vaults[index]!.map((vault) => ({ vault, state: vaultStates[next++] ?? null }))
        // A null walletState, the wallet's or a vault's, fails its pair.
        if (own === null || theirs.some(({ state }) => state === null)) return answer(pair, 'unreadable')
        answer(pair, {
          chainId: chain.id,
          address: pair.address,
          wallet: pair.wallet,
          block: Number(head),
          ...quotasOf(own),
          vaults: theirs.map(({ vault, state }) => ({ vault, ...quotasOf(state!) })),
        })
      })
    } catch (error) {
      console.error(`A wallet window on ${chain.name} failed: ${errorLine(error)}`)
      for (const pair of pairs) answer(pair, 'unreadable')
    }
  }

  /** Closes the open window: takes up to 200 pairs, opens the next window at once for the rest, reads. */
  function close(): void {
    timer = null
    const pairs: Pair[] = []
    for (const [key, pair] of queue) {
      if (pairs.length === WINDOW_MAX) break
      queue.delete(key)
      pairs.push(pair)
    }
    if (queue.size) timer = setTimeout(close, WINDOW_MS)
    windows++
    const reading = read(pairs).finally(() => reads.delete(reading))
    reads.add(reading)
  }

  return {
    ask(address, wallet) {
      if (stopped) return Promise.resolve('unreadable')
      if (waiting >= QUEUE_MAX) return Promise.resolve('busy')
      waiting++
      return new Promise<Answer>((resolve) => {
        const key = `${address.toLowerCase()}:${wallet.toLowerCase()}`
        const pair = queue.get(key)
        if (pair) pair.waiters.push(resolve)
        else queue.set(key, { address, wallet, waiters: [resolve] })
        timer ??= setTimeout(close, WINDOW_MS)
      })
    },
    stats() {
      return { windows, answered, waiting }
    },
    async stop() {
      stopped = true
      if (timer) clearTimeout(timer)
      timer = null
      for (const pair of queue.values()) answer(pair, 'unreadable')
      queue.clear()
      await Promise.all(reads)
    },
  }
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `pnpm --filter @cobweb/shared exec vitest run src/delegate-registry-abi.test.ts`
Expected: PASS, 3 tests.

Run: `pnpm --filter @cobweb/freshness exec vitest run src/delegations.test.ts src/wallet.test.ts`
Expected: PASS, 2 files and 12 tests.

- [ ] **Step 6: Format, run the root checks and commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
pnpm exec prettier --write packages/shared/src/delegate-registry-abi.ts packages/shared/src/delegate-registry-abi.test.ts packages/shared/src/index.ts apps/freshness/src/delegations.ts apps/freshness/src/delegations.test.ts apps/freshness/src/wallet.ts apps/freshness/src/wallet.test.ts
pnpm typecheck && pnpm lint && pnpm test
git add packages/shared/src/delegate-registry-abi.ts packages/shared/src/delegate-registry-abi.test.ts packages/shared/src/index.ts apps/freshness/src/delegations.ts apps/freshness/src/delegations.test.ts apps/freshness/src/wallet.ts apps/freshness/src/wallet.test.ts
git commit -m "$(cat <<'EOF'
Pin the delegate.xyz registry's listing in the shared package, and add the freshness server's wallet windows with the vault filter

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: the shared package reports 102 tests (99 before, plus 3); the freshness package 51 in 8 files (39 before, plus 12).

---

### Task 7: The state body and its ETag, the routes and answers, the server and its start

**Files:**

- Create: `apps/freshness/src/state-body.ts`, `state-body.test.ts`, `routes.ts`, `routes.test.ts`, `server.ts`
- Modify: `apps/freshness/src/index.ts` (whole file)
- Test: `apps/freshness/src/state-body.test.ts`, `apps/freshness/src/routes.test.ts`

**Interfaces:**

- Consumes: `factoryAbi`, `factoryAddress`, `ChainGroup` from `@cobweb/shared`; `publicClientFor` from `@cobweb/shared/clients` (Task 1); `servedChains`, `DEFAULT_PORT` (Task 3); `hotSet`, `JOIN_WAIT_MS`, `HotEntry`, `collectionCheck`, `isDegraded`, `TIER_MS` (Task 4); `chainReader`, `CollectionRead`, `errorLine`, `HealthBody` (Task 5); `walletWindows`, `WalletBody` (Task 6).
- Produces:
  - `state-body.ts`: `StateBody` (the spec's keys in its order: `chainId`, `address`, `block`, `blockTimestamp`, `readAt` in Unix seconds, `degraded`, `maxSupply`, `totalMinted`, `publicMaxMintPerWallet`, `mintFeeFlatWei`, `mintFeeBps`, `airdropFeePerTokenWei`, `mintOnBehalfActive`, `groups`, `owner`, `royalty`, `baseUri`, `transferValidator`, `transferLevel: 'none' | 'unread' | number`); `stateBody(chainId, entry: HotEntry, degraded: boolean): StateBody`; `etagOf(body): string` (`W/"<32 hex digits>"`, SHA-256 of the body without `readAt`, `block` and `blockTimestamp`); `etagMatches(ifNoneMatch: string | undefined, etag: string): boolean`
  - `routes.ts`: `RefusalCode` (the spec's nine codes and `internal`); `Route = { kind: 'state'; chainId; address } | { kind: 'wallet'; chainId; address; wallet } | { kind: 'health' } | { kind: 'preflight' } | { kind: 'refused'; status: 400 | 404 | 405; error: RefusalCode }`; `Answer = { status; headers: Record<string, string>; body: string | null }`; `STATE_CACHE`, `WALLET_CACHE`, `REFUSAL_CACHE`; `routeOf(method, url): Route`; `refusal(status: 400 | 404 | 405 | 500 | 503, error): Answer`; `stateAnswer(body, etag, notModified): Answer`; `walletAnswer(body): Answer`; `healthAnswer(body): Answer`; `PREFLIGHT: Answer`
  - `server.ts`: `FreshnessOptions = { port: number; host?: string; chainIds?: number[] }`, `Freshness = { url: string; close(): Promise<void> }`, `startFreshness(options): Promise<Freshness>`; re-exports `HealthBody`, `StateBody`, `WalletBody` and `TIER_MS` for the verify (Decision 9)
  - `index.ts`: `startFreshness({ port: Number(process.env.PORT ?? DEFAULT_PORT) })`, closed on SIGTERM before the process exits

- [ ] **Step 1: Write the failing tests**

Create `apps/freshness/src/state-body.test.ts`:

```ts
import type { Address } from 'viem'
import { describe, expect, it } from 'vitest'
import type { CollectionRead } from './chain-reader.ts'
import type { HotEntry } from './hot-set.ts'
import { etagMatches, etagOf, stateBody, type StateBody } from './state-body.ts'

const A: Address = '0x0409454C375c8a6aB05383bFB6D9FcDe9ebB8F85'
const OWNER: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const VALIDATOR: Address = '0x721C008fdff27BF06E7E123956E2Fe03B63342e3'

const read: CollectionRead = {
  state: {
    block: 120n,
    blockTimestamp: 1_800_000_000,
    maxSupply: 5,
    totalMinted: 1,
    publicMaxMintPerWallet: 2,
    mintOnBehalfActive: false,
    groups: [
      {
        id: 0,
        priceWei: '0',
        maxSupply: 3,
        minted: 0,
        startTimestamp: 1_800_000_600,
        flag: false,
        active: false,
      },
      { id: 1, priceWei: '1000', maxSupply: 2, minted: 1, startTimestamp: 0, flag: true, active: true },
    ],
  },
  fees: { mintFeeFlatWei: '10', mintFeeBps: 250, airdropFeePerTokenWei: '100000000000000' },
  extras: {
    owner: OWNER,
    royalty: { receiver: OWNER, bps: 500 },
    baseUri: 'ipfs://first/',
    transferValidator: VALIDATOR,
    transferLevel: { kind: 'none', reason: 'no-code' },
  },
}

const entry = (overrides: Partial<CollectionRead> = {}, readAt = 1_800_000_001_500): HotEntry => ({
  chainId: 31337,
  address: A,
  joinedAt: 0,
  requestedAt: 0,
  read: { ...read, ...overrides },
  readAt,
  extrasReadAt: readAt,
  marked: false,
})

describe('stateBody (docs/specs/2026-10-16-freshness-server.md, section 6.7)', () => {
  it('answers every field from a read, in order, readAt in Unix seconds', () => {
    const body = stateBody(31337, entry(), false)
    expect(body).toEqual<StateBody>({
      chainId: 31337,
      address: A,
      block: 120,
      blockTimestamp: 1_800_000_000,
      readAt: 1_800_000_001,
      degraded: false,
      maxSupply: 5,
      totalMinted: 1,
      publicMaxMintPerWallet: 2,
      mintFeeFlatWei: '10',
      mintFeeBps: 250,
      airdropFeePerTokenWei: '100000000000000',
      mintOnBehalfActive: false,
      groups: read.state.groups,
      owner: OWNER,
      royalty: { receiver: OWNER, bps: 500 },
      baseUri: 'ipfs://first/',
      transferValidator: VALIDATOR,
      transferLevel: 'none',
    })
    expect(Object.keys(body)).toEqual([
      'chainId',
      'address',
      'block',
      'blockTimestamp',
      'readAt',
      'degraded',
      'maxSupply',
      'totalMinted',
      'publicMaxMintPerWallet',
      'mintFeeFlatWei',
      'mintFeeBps',
      'airdropFeePerTokenWei',
      'mintOnBehalfActive',
      'groups',
      'owner',
      'royalty',
      'baseUri',
      'transferValidator',
      'transferLevel',
    ])
    expect(Object.keys(body.groups[0]!)).toEqual([
      'id',
      'priceWei',
      'maxSupply',
      'minted',
      'startTimestamp',
      'flag',
      'active',
    ])
  })

  it('answers the transfer level as none, unread or its number', () => {
    const level = (transferLevel: CollectionRead['extras']['transferLevel']) =>
      stateBody(31337, entry({ extras: { ...read.extras, transferLevel } }), false).transferLevel
    expect(level({ kind: 'none', reason: 'zero' })).toBe('none')
    expect(level({ kind: 'unread' })).toBe('unread')
    expect(level({ kind: 'level', level: 0 })).toBe(0)
    expect(level({ kind: 'level', level: 9 })).toBe(9)
  })
})

describe('etagOf', () => {
  const tag = (body: StateBody) => etagOf(body)
  const base = stateBody(31337, entry(), false)

  it('is weak, 32 hex digits, and equal for equal reads', () => {
    expect(tag(base)).toMatch(/^W\/"[0-9a-f]{32}"$/)
    expect(tag(stateBody(31337, entry(), false))).toBe(tag(base))
  })

  it('leaves out readAt, block and blockTimestamp', () => {
    expect(tag({ ...base, readAt: base.readAt + 60, block: 999, blockTimestamp: 1_900_000_000 })).toBe(
      tag(base),
    )
  })

  it("changes with degraded, a group's active and the base URI", () => {
    const groups = base.groups.map((group) => (group.id === 0 ? { ...group, active: true } : group))
    for (const changed of [
      { ...base, degraded: true },
      { ...base, groups },
      { ...base, baseUri: 'ipfs://second/' },
    ])
      expect(tag(changed)).not.toBe(tag(base))
  })
})

describe('etagMatches', () => {
  const etag = 'W/"0123456789abcdef0123456789abcdef"'

  it('matches the tag in weak and strong form, inside a list, and as *', () => {
    expect(etagMatches(etag, etag)).toBe(true)
    expect(etagMatches('"0123456789abcdef0123456789abcdef"', etag)).toBe(true)
    expect(etagMatches(`"other", ${etag}`, etag)).toBe(true)
    expect(etagMatches('*', etag)).toBe(true)
  })

  it('matches nothing else', () => {
    expect(etagMatches(undefined, etag)).toBe(false)
    expect(etagMatches('', etag)).toBe(false)
    expect(etagMatches('W/"0123456789abcdef0123456789abcdee"', etag)).toBe(false)
    expect(etagMatches('0123456789abcdef0123456789abcdef', etag)).toBe(false)
    expect(etagMatches('"other", W/"another"', etag)).toBe(false)
  })
})
```

Create `apps/freshness/src/routes.test.ts`:

```ts
import type { Address } from 'viem'
import { describe, expect, it } from 'vitest'
import type { HealthBody } from './health.ts'
import { healthAnswer, PREFLIGHT, refusal, routeOf, stateAnswer, walletAnswer, type Route } from './routes.ts'
import type { StateBody } from './state-body.ts'
import type { WalletBody } from './wallet.ts'

const A: Address = '0x0409454C375c8a6aB05383bFB6D9FcDe9ebB8F85'
const W: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const lower = (address: Address) => address.toLowerCase()

describe('routeOf (docs/specs/2026-10-16-freshness-server.md, section 6.7)', () => {
  it('routes the state, wallet and health paths, HEAD as GET, and the preflight', () => {
    expect(routeOf('GET', `/v1/state/31337/${lower(A)}`)).toEqual<Route>({
      kind: 'state',
      chainId: 31337,
      address: A,
    })
    expect(routeOf('HEAD', `/v1/state/1/${A}?poll=1`)).toEqual<Route>({
      kind: 'state',
      chainId: 1,
      address: A,
    })
    expect(routeOf('GET', `/v1/wallet/8453/${lower(A)}/${lower(W)}`)).toEqual<Route>({
      kind: 'wallet',
      chainId: 8453,
      address: A,
      wallet: W,
    })
    expect(routeOf('GET', '/health')).toEqual<Route>({ kind: 'health' })
    expect(routeOf('HEAD', '/health')).toEqual<Route>({ kind: 'health' })
    expect(routeOf('OPTIONS', `/v1/state/31337/${lower(A)}`)).toEqual<Route>({ kind: 'preflight' })
    expect(routeOf('OPTIONS', `/v1/wallet/31337/${lower(A)}/${lower(W)}`)).toEqual<Route>({
      kind: 'preflight',
    })
  })

  it('refuses chain ids 0, -1, 1.5, 01 and letters', () => {
    for (const chainId of ['0', '-1', '1.5', '01', 'base', '1e3', '99999999999999999999'])
      expect(routeOf('GET', `/v1/state/${chainId}/${lower(A)}`)).toEqual<Route>({
        kind: 'refused',
        status: 400,
        error: 'bad-request',
      })
  })

  it('accepts a lowercase, uppercase or correctly checksummed address, and answers it checksummed', () => {
    const upper = `0x${A.slice(2).toUpperCase()}` as Address
    for (const address of [lower(A), A, upper])
      expect(routeOf('GET', `/v1/wallet/31337/${address}/${lower(W)}`)).toMatchObject({
        address: A,
        wallet: W,
      })
  })

  it('refuses a wrong checksum and 39 or 41 digits, in the collection or the wallet', () => {
    // One letter's case flipped: mixed case with a wrong checksum.
    const wrongChecksum = A.replace('C375', 'c375')
    for (const path of [
      `/v1/state/31337/${wrongChecksum}`,
      `/v1/state/31337/${lower(A).slice(0, -1)}`,
      `/v1/state/31337/${lower(A)}0`,
      `/v1/state/31337/${lower(A).slice(2)}`,
      `/v1/wallet/31337/${lower(A)}/${W.replace('70997970C5', '70997970c5')}`,
      `/v1/wallet/31337/${lower(A)}/${lower(W)}0`,
    ])
      expect(routeOf('GET', path)).toEqual<Route>({ kind: 'refused', status: 400, error: 'bad-request' })
  })

  it('answers 404 for any other path, / included, and 405 for other methods', () => {
    for (const path of [
      '/',
      '/v1',
      '/v1/state/31337',
      `/v1/state/31337/${lower(A)}/`,
      `/v1/collection/31337/${lower(A)}`,
      `/v2/state/31337/${lower(A)}`,
      '/health/',
    ])
      expect(routeOf('GET', path)).toEqual<Route>({ kind: 'refused', status: 404, error: 'not-found' })
    expect(routeOf('OPTIONS', '/nowhere')).toEqual<Route>({
      kind: 'refused',
      status: 404,
      error: 'not-found',
    })
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', undefined])
      expect(routeOf(method, `/v1/state/31337/${lower(A)}`)).toEqual<Route>({
        kind: 'refused',
        status: 405,
        error: 'method-not-allowed',
      })
  })
})

describe('the answers', () => {
  it('give each refusal its code, CORS, and the 4xx edge cache or a 503 retry', () => {
    expect(refusal(404, 'not-a-collection')).toEqual({
      status: 404,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=0, s-maxage=10',
      },
      body: '{"error":"not-a-collection"}',
    })
    expect(refusal(405, 'method-not-allowed').headers).toMatchObject({ Allow: 'GET, HEAD, OPTIONS' })
    expect(refusal(503, 'not-read-yet')).toEqual({
      status: 503,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Retry-After': '1',
      },
      body: '{"error":"not-read-yet"}',
    })
  })

  it('give the state its tag and edge cache, with the body on a 200 and none on a 304', () => {
    const body = { chainId: 31337 } as StateBody
    const headers = {
      ETag: 'W/"tag"',
      'Cache-Control': 'public, max-age=0, s-maxage=1, stale-while-revalidate=1, stale-if-error=60',
      'Access-Control-Allow-Origin': '*',
    }
    expect(stateAnswer(body, 'W/"tag"', false)).toEqual({
      status: 200,
      headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
      body: '{"chainId":31337}',
    })
    expect(stateAnswer(body, 'W/"tag"', true)).toEqual({ status: 304, headers, body: null })
  })

  it('give a wallet 5 s at the edge, /health no-store, and the preflight its CORS headers', () => {
    expect(walletAnswer({ chainId: 31337 } as WalletBody).headers).toEqual({
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=0, s-maxage=5',
    })
    expect(healthAnswer({ status: 'ok' } as HealthBody)).toEqual({
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      body: '{"status":"ok"}',
    })
    expect(PREFLIGHT).toEqual({
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD',
        'Access-Control-Allow-Headers': 'If-None-Match',
        'Access-Control-Max-Age': '86400',
      },
      body: null,
    })
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @cobweb/freshness exec vitest run src/state-body.test.ts src/routes.test.ts`
Expected: FAIL. Both files fail to load (`Cannot find module './state-body.ts'` and `'./routes.ts'`). The run ends `Test Files  2 failed (2)` and `Tests  no tests`.

- [ ] **Step 3: The body, its tag, and the routes with their answers**

Decision (section 6.7): a method other than GET, HEAD and OPTIONS answers 405 on any path; OPTIONS on a known path answers the preflight, on any other path 404; the query string is ignored; an address in one case is accepted and answered checksummed; an unexpected exception answers 500 `internal` with `no-store` (Decision 8).

Create `apps/freshness/src/state-body.ts`:

```ts
import { createHash } from 'node:crypto'
import type { ChainGroup } from '@cobweb/shared'
import type { Address } from 'viem'
import type { HotEntry } from './hot-set.ts'

/**
 * The state endpoint's body and its tag (docs/specs/2026-10-16-freshness-server.md, sections 6.7 and 6.10),
 * pure. Liveness is each group's `active`, the contract's own; the times only label countdowns.
 */
export type StateBody = {
  chainId: number
  /** Checksummed. */
  address: Address
  /** The block of the last read; it never goes back. */
  block: number
  blockTimestamp: number
  /** Unix seconds of the last successful read, on the server's clock. */
  readAt: number
  degraded: boolean
  maxSupply: number
  totalMinted: number
  publicMaxMintPerWallet: number
  mintFeeFlatWei: string
  mintFeeBps: number
  airdropFeePerTokenWei: string
  mintOnBehalfActive: boolean
  /** In the contract's order. */
  groups: ChainGroup[]
  owner: Address
  royalty: { receiver: Address; bps: number }
  baseUri: string
  transferValidator: Address
  transferLevel: 'none' | 'unread' | number
}

/** The body of an entry with a read, keys in this order and the groups in the contract's. */
export function stateBody(chainId: number, entry: HotEntry, degraded: boolean): StateBody {
  const { read, readAt } = entry
  if (!read || readAt === null) throw new Error('A state body needs a read.')
  const { state, fees, extras } = read
  const level = extras.transferLevel
  return {
    chainId,
    address: entry.address,
    block: Number(state.block),
    blockTimestamp: state.blockTimestamp,
    readAt: Math.floor(readAt / 1_000),
    degraded,
    maxSupply: state.maxSupply,
    totalMinted: state.totalMinted,
    publicMaxMintPerWallet: state.publicMaxMintPerWallet,
    mintFeeFlatWei: fees.mintFeeFlatWei,
    mintFeeBps: fees.mintFeeBps,
    airdropFeePerTokenWei: fees.airdropFeePerTokenWei,
    mintOnBehalfActive: state.mintOnBehalfActive,
    groups: state.groups.map((group) => ({
      id: group.id,
      priceWei: group.priceWei,
      maxSupply: group.maxSupply,
      minted: group.minted,
      startTimestamp: group.startTimestamp,
      flag: group.flag,
      active: group.active,
    })),
    owner: extras.owner,
    royalty: { receiver: extras.royalty.receiver, bps: extras.royalty.bps },
    baseUri: extras.baseUri,
    transferValidator: extras.transferValidator,
    transferLevel: level.kind === 'level' ? level.level : level.kind,
  }
}

/** What the tag leaves out: the read's time, block and block time, which change on every tick. */
const UNTAGGED: ReadonlySet<string> = new Set(['readAt', 'block', 'blockTimestamp'])

/**
 * A weak tag over the body without `readAt`, `block` and `blockTimestamp`: a tick that changes nothing else
 * keeps it, so a poll with `If-None-Match` answers 304. `degraded` is inside it.
 */
export function etagOf(body: StateBody): string {
  const tagged = Object.fromEntries(Object.entries(body).filter(([key]) => !UNTAGGED.has(key)))
  return `W/"${createHash('sha256').update(JSON.stringify(tagged)).digest('hex').slice(0, 32)}"`
}

/** Whether `If-None-Match` matches: weak comparison with each tag it lists, and `*` matches anything. */
export function etagMatches(ifNoneMatch: string | undefined, etag: string): boolean {
  if (!ifNoneMatch) return false
  const opaque = (tag: string) => tag.trim().replace(/^W\//, '')
  return ifNoneMatch.split(',').some((tag) => tag.trim() === '*' || opaque(tag) === opaque(etag))
}
```

Create `apps/freshness/src/routes.ts`:

```ts
import { getAddress, type Address } from 'viem'
import type { HealthBody } from './health.ts'
import type { StateBody } from './state-body.ts'
import type { WalletBody } from './wallet.ts'

/**
 * The routes and the answers (docs/specs/2026-10-16-freshness-server.md, section 6.7), pure: which path a
 * request names, the refusals as `{ "error": "<code>" }`, and every answer's headers.
 */

export type RefusalCode =
  | 'bad-request'
  | 'not-found'
  | 'chain-not-served'
  | 'not-a-collection'
  | 'method-not-allowed'
  | 'chain-unreadable'
  | 'not-read-yet'
  | 'wallet-unreadable'
  | 'busy'
  | 'internal'

export type Route =
  | { kind: 'state'; chainId: number; address: Address }
  | { kind: 'wallet'; chainId: number; address: Address; wallet: Address }
  | { kind: 'health' }
  | { kind: 'preflight' }
  | { kind: 'refused'; status: 400 | 404 | 405; error: RefusalCode }

/** An answer as the server writes it: no body for a 204, a 304, and HEAD. */
export type Answer = { status: number; headers: Record<string, string>; body: string | null }

export const STATE_CACHE = 'public, max-age=0, s-maxage=1, stale-while-revalidate=1, stale-if-error=60'
export const WALLET_CACHE = 'public, max-age=0, s-maxage=5'
export const REFUSAL_CACHE = 'public, max-age=0, s-maxage=10'
const JSON_TYPE = 'application/json; charset=utf-8'
const METHODS = ['GET', 'HEAD', 'OPTIONS']

/** A positive whole number without leading zeros, within the safe integers. */
function chainIdOf(text: string): number | null {
  if (!/^[1-9][0-9]*$/.test(text)) return null
  const id = Number(text)
  return Number.isSafeInteger(id) ? id : null
}

/** `0x` and 40 hex digits, refused in mixed case with a wrong checksum; answered checksummed. */
function addressOf(text: string): Address | null {
  if (!/^0x[0-9a-fA-F]{40}$/.test(text)) return null
  const digits = text.slice(2)
  const checksummed = getAddress(text)
  const mixed = digits !== digits.toLowerCase() && digits !== digits.toUpperCase()
  return mixed && checksummed !== text ? null : checksummed
}

const BAD_REQUEST: Route = { kind: 'refused', status: 400, error: 'bad-request' }
const NOT_FOUND: Route = { kind: 'refused', status: 404, error: 'not-found' }

/**
 * The route a request names: `GET /v1/state/{chainId}/{address}`, `GET
 * /v1/wallet/{chainId}/{address}/{wallet}` and `GET /health`, HEAD as GET, OPTIONS as the preflight of a
 * known path; a method other than GET, HEAD and OPTIONS is refused first, then any other path. The query
 * string is ignored.
 */
export function routeOf(method: string | undefined, url: string | undefined): Route {
  if (!method || !METHODS.includes(method))
    return { kind: 'refused', status: 405, error: 'method-not-allowed' }
  const path = new URL(url ?? '/', 'http://freshness.invalid').pathname.split('/').slice(1)
  const preflight = method === 'OPTIONS'
  if (path.length === 1 && path[0] === 'health') return preflight ? { kind: 'preflight' } : { kind: 'health' }
  const [version, kind, chain, address, wallet] = path
  const state = kind === 'state' && path.length === 4
  const walletPath = kind === 'wallet' && path.length === 5
  if (version !== 'v1' || !(state || walletPath)) return NOT_FOUND
  if (preflight) return { kind: 'preflight' }
  const chainId = chainIdOf(chain ?? '')
  const collection = addressOf(address ?? '')
  if (chainId === null || collection === null) return BAD_REQUEST
  if (state) return { kind: 'state', chainId, address: collection }
  const holder = addressOf(wallet ?? '')
  return holder === null ? BAD_REQUEST : { kind: 'wallet', chainId, address: collection, wallet: holder }
}

/**
 * A refusal: `{ "error": "<code>" }` with `Access-Control-Allow-Origin: *`; a 4xx also 10 s at the edge (405
 * with `Allow`), a 503 (or a 500) `Retry-After: 1` and `no-store`.
 */
export function refusal(status: 400 | 404 | 405 | 500 | 503, error: RefusalCode): Answer {
  const headers: Record<string, string> = { 'Access-Control-Allow-Origin': '*', 'Content-Type': JSON_TYPE }
  if (status >= 500) {
    headers['Cache-Control'] = 'no-store'
    headers['Retry-After'] = '1'
  } else headers['Cache-Control'] = REFUSAL_CACHE
  if (status === 405) headers.Allow = 'GET, HEAD, OPTIONS'
  return { status, headers, body: JSON.stringify({ error }) }
}

/** The state: 200 with the body, or 304 without one when `If-None-Match` matched, both with the tag. */
export function stateAnswer(body: StateBody, etag: string, notModified: boolean): Answer {
  const headers = { ETag: etag, 'Cache-Control': STATE_CACHE, 'Access-Control-Allow-Origin': '*' }
  if (notModified) return { status: 304, headers, body: null }
  return { status: 200, headers: { ...headers, 'Content-Type': JSON_TYPE }, body: JSON.stringify(body) }
}

/** A wallet's quotas and vaults: 5 s at the edge, no tag. */
export function walletAnswer(body: WalletBody): Answer {
  return {
    status: 200,
    headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': JSON_TYPE, 'Cache-Control': WALLET_CACHE },
    body: JSON.stringify(body),
  }
}

/** `/health`: always 200, never cached. */
export function healthAnswer(body: HealthBody): Answer {
  return {
    status: 200,
    headers: { 'Content-Type': JSON_TYPE, 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  }
}

/** The CORS preflight a page's own `If-None-Match` makes. */
export const PREFLIGHT: Answer = {
  status: 204,
  headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD',
    'Access-Control-Allow-Headers': 'If-None-Match',
    'Access-Control-Max-Age': '86400',
  },
  body: null,
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm --filter @cobweb/freshness exec vitest run src/state-body.test.ts src/routes.test.ts`
Expected: PASS, 2 files and 15 tests.

- [ ] **Step 5: The server and its start**

A request for a collection without a read waits for it until `JOIN_WAIT_MS` after the join, looking every 25 ms, then answers 503 `not-read-yet` at once until a read lands. `close()` stops every reader and window, waiting for those in flight, then closes the server and its connections, so the server makes no call once it resolves (Decision 3). HEAD writes the headers alone, with the length the body would have.

Create `apps/freshness/src/server.ts`:

```ts
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { factoryAbi, factoryAddress } from '@cobweb/shared'
import { publicClientFor } from '@cobweb/shared/clients'
import type { Address } from 'viem'
import { chainReader } from './chain-reader.ts'
import { collectionCheck } from './collection-check.ts'
import { servedChains } from './config.ts'
import { errorLine, type HealthBody } from './health.ts'
import { hotSet, JOIN_WAIT_MS, type HotEntry } from './hot-set.ts'
import {
  healthAnswer,
  PREFLIGHT,
  refusal,
  routeOf,
  stateAnswer,
  walletAnswer,
  type Answer,
} from './routes.ts'
import { etagMatches, etagOf, stateBody } from './state-body.ts'
import { isDegraded } from './tiers.ts'
import { walletWindows } from './wallet.ts'

export type { HealthBody } from './health.ts'
export type { StateBody } from './state-body.ts'
export { TIER_MS } from './tiers.ts'
export type { WalletBody } from './wallet.ts'

/**
 * The freshness server (docs/specs/2026-10-16-freshness-server.md, section 6): one `node:http` server over
 * the chains whose two variables are set. It makes no call until a request arrives, reads no database, and
 * never computes liveness. `index.ts` starts it on Railway; `verify:freshness` starts it in process.
 */

export type FreshnessOptions = {
  port: number
  host?: string
  /** Limits the chains served; the verify serves Anvil alone. */
  chainIds?: number[]
}

export type Freshness = { url: string; close(): Promise<void> }

/** How often a request waiting on a joining collection looks for its first read. */
const JOIN_POLL_MS = 25

export async function startFreshness(options: FreshnessOptions): Promise<Freshness> {
  const startedAt = new Date().toISOString()
  const hot = hotSet()
  const served = new Map(
    servedChains(options.chainIds).map((chain) => {
      const client = publicClientFor(chain.id)
      return [
        chain.id,
        { chain, client, reader: chainReader(chain, hot, client), windows: walletWindows(chain, client) },
      ]
    }),
  )
  const isCollection = collectionCheck(async (chainId, address) => {
    const chain = served.get(chainId)
    if (!chain) return false
    return chain.client.readContract({
      address: factoryAddress(chainId),
      abi: factoryAbi,
      functionName: 'isCollection',
      args: [address],
    })
  })

  /**
   * The collection check of both routes: 404 for a chain not served or an address not a collection, 503 when
   * the factory cannot be read.
   */
  async function refused(chainId: number, address: Address): Promise<Answer | null> {
    if (!served.has(chainId)) return refusal(404, 'chain-not-served')
    try {
      return (await isCollection(chainId, address)) ? null : refusal(404, 'not-a-collection')
    } catch (error) {
      console.error(`The factory on chain ${chainId} could not be read: ${errorLine(error)}`)
      return refusal(503, 'chain-unreadable')
    }
  }

  /** Waits for an entry's first read until the join wait ends; after that, at once. */
  async function firstRead(entry: HotEntry): Promise<void> {
    const until = entry.joinedAt + JOIN_WAIT_MS
    while (entry.read === null && Date.now() < until)
      await new Promise((resolve) => setTimeout(resolve, Math.min(JOIN_POLL_MS, until - Date.now())))
  }

  async function state(chainId: number, address: Address, ifNoneMatch: string | undefined): Promise<Answer> {
    const refusedAnswer = await refused(chainId, address)
    if (refusedAnswer) return refusedAnswer
    const { reader } = served.get(chainId)!
    const { entry, joined } = hot.join(chainId, address, Date.now())
    if (joined) reader.wake()
    await firstRead(entry)
    if (entry.read === null || entry.readAt === null) return refusal(503, 'not-read-yet')
    const degraded = isDegraded(entry.readAt, Date.now(), reader.health().tier ?? 'live')
    const body = stateBody(chainId, entry, degraded)
    const etag = etagOf(body)
    return stateAnswer(body, etag, etagMatches(ifNoneMatch, etag))
  }

  async function wallet(chainId: number, address: Address, holder: Address): Promise<Answer> {
    const refusedAnswer = await refused(chainId, address)
    if (refusedAnswer) return refusedAnswer
    const answer = await served.get(chainId)!.windows.ask(address, holder)
    if (answer === 'busy') return refusal(503, 'busy')
    if (answer === 'unreadable') return refusal(503, 'wallet-unreadable')
    return walletAnswer(answer)
  }

  function health(): HealthBody {
    const chains = [...served.values()]
    const stats = chains.map(({ windows }) => windows.stats())
    const total = (key: 'windows' | 'answered' | 'waiting') => stats.reduce((sum, stat) => sum + stat[key], 0)
    return {
      status: 'ok',
      startedAt,
      hot: hot.size(),
      chains: chains.map(({ reader }) => reader.health()),
      wallet: { windows: total('windows'), answered: total('answered'), waiting: total('waiting') },
    }
  }

  async function answerOf(request: IncomingMessage): Promise<Answer> {
    const route = routeOf(request.method, request.url)
    if (route.kind === 'refused') return refusal(route.status, route.error)
    if (route.kind === 'preflight') return PREFLIGHT
    if (route.kind === 'health') return healthAnswer(health())
    if (route.kind === 'state') return state(route.chainId, route.address, request.headers['if-none-match'])
    return wallet(route.chainId, route.address, route.wallet)
  }

  /** Writes an answer; HEAD gets the headers alone, with the length the body would have. */
  function send(response: ServerResponse, head: boolean, answer: Answer): void {
    const headers =
      answer.body === null
        ? answer.headers
        : { ...answer.headers, 'Content-Length': String(Buffer.byteLength(answer.body)) }
    response.writeHead(answer.status, headers)
    response.end(head || answer.body === null ? undefined : answer.body)
  }

  // Requests are not logged; a failure is, as its name and viem's short message.
  const server = createServer((request, response) => {
    answerOf(request).then(
      (answer) => send(response, request.method === 'HEAD', answer),
      (error: unknown) => {
        console.error(`A request failed: ${errorLine(error)}`)
        send(response, request.method === 'HEAD', refusal(500, 'internal'))
      },
    )
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port, options.host, () => {
      server.off('error', reject)
      resolve()
    })
  })
  const { port } = server.address() as AddressInfo
  const names = [...served.values()].map(({ chain }) => `${chain.name} (${chain.id})`)
  console.log(
    `The freshness server listens on port ${port}, serving ${names.length ? names.join(', ') : 'no chain'}.`,
  )

  return {
    url: `http://${options.host ?? 'localhost'}:${port}`,
    async close() {
      await Promise.all(
        [...served.values()].flatMap(({ reader, windows }) => [reader.stop(), windows.stop()]),
      )
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
        server.closeAllConnections()
      })
    },
  }
}
```

Replace the whole of `apps/freshness/src/index.ts` with:

```ts
import { DEFAULT_PORT } from './config.ts'
import { errorLine } from './health.ts'
import { startFreshness } from './server.ts'

// The freshness server as Railway runs it (docs/specs/2026-10-16-freshness-server.md, section 6.1): Node runs
// this TypeScript source as it is, on PORT. On SIGTERM it stops its ticks and windows, closes the server and
// exits.

const freshness = await startFreshness({ port: Number(process.env.PORT ?? DEFAULT_PORT) })

process.once('SIGTERM', () => {
  freshness.close().then(
    () => process.exit(0),
    (error: unknown) => {
      console.error(`The freshness server did not close cleanly: ${errorLine(error)}`)
      process.exit(1)
    },
  )
})
```

- [ ] **Step 6: Typecheck, lint and test the package**

Run: `pnpm --filter @cobweb/freshness typecheck && pnpm --filter @cobweb/freshness lint && pnpm --filter @cobweb/freshness test`
Expected: no type error and no lint problem (`erasableSyntaxOnly` holds: Node runs this source as it is); 66 tests in 10 files. `verify:freshness` (Task 8) runs the server end to end, and Task 9 starts it as Railway does.

- [ ] **Step 7: Format, run the root checks and commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
pnpm exec prettier --write apps/freshness/src/state-body.ts apps/freshness/src/state-body.test.ts apps/freshness/src/routes.ts apps/freshness/src/routes.test.ts apps/freshness/src/server.ts apps/freshness/src/index.ts
pnpm typecheck && pnpm lint && pnpm test
git add apps/freshness/src/state-body.ts apps/freshness/src/state-body.test.ts apps/freshness/src/routes.ts apps/freshness/src/routes.test.ts apps/freshness/src/server.ts apps/freshness/src/index.ts
git commit -m "$(cat <<'EOF'
Serve the state, wallet and health endpoints from the freshness server, with the weak ETag, the cache and CORS headers, the refusals and the join wait, and start it from its source on PORT

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: the freshness package reports 66 tests in 10 files (51 before, plus 15).

---

### Task 8: The fixture's chain half in `chain-fixture.ts`, and `verify:freshness` on it

**Files:**

- Create: `apps/web/scripts/chain-fixture.ts`
- Modify: `apps/web/scripts/deploy-fixture.ts` (the chain half removed and re-exported), `apps/web/scripts/render-deps.ts` (its chain settings from the chain fixture)
- Create: `apps/web/scripts/verify-freshness.ts`
- Modify: `apps/web/package.json` (the script and the dev dependency), `pnpm-lock.yaml` (by `pnpm install --offline`), `CLAUDE.md` (two layout lines, three commands)

**Interfaces:**

- Consumes: the fixture's chain half as `deploy-fixture.ts` holds it today (`chain`, `check`, `runChecks`, `chainReady`, `CID`, `HEX64`, `pay`, `deploy`, `sendCall`, `simulationSentence`, `handOver`, `rpc`, `factory`, `collectionSalt`, `encodeCollectionArgs`, `factoryAbi`, `predictCollectionAddress`, `COLLECTION_CODE_HASH`, `COLLECTION_CREATION_CODE`, `ManageCall`); `phaseCalls` and `settingsCalls` (`apps/web/src/lib/manage/phase-calls.ts`); `startFreshness`, `TIER_MS`, `Freshness`, `HealthBody`, `StateBody`, `WalletBody` from `@cobweb/freshness/server` (Task 7); `chainStateOf` and `DEFAULT_TRANSFER_VALIDATOR` from `@cobweb/shared`.
- Produces:
  - `apps/web/scripts/chain-fixture.ts`: `refuseRemote(url: string): void` (exit code 2 for a host that is not local, naming the host only); `localChainConfig(): { rpc: string; factory: Address }` (the two variables from the environment or `apps/web/.env.local`, exit code 2 without them, a non-local RPC refused); and the names moved from `deploy-fixture.ts`, unchanged
  - `deploy-fixture.ts` re-exports the chain fixture (`export * from './chain-fixture.ts'`) and keeps the Supabase half, so `verify-deploy.ts`, `verify-phases.ts`, `verify-whitelist.ts`, `verify-airdrop.ts` and `verify-settings.ts` keep their imports; `render-deps.ts`'s `localConfig()` takes `rpc` and `factory` from `localChainConfig()` and refuses through `refuseRemote` (Decision 10)
  - `pnpm --filter @cobweb/web verify:freshness`: sixteen PASS lines on Anvil alone

- [ ] **Step 1: The chain half of the fixture**

The chain half moves out of `deploy-fixture.ts` unchanged, with the chain settings `render-deps.ts` read: `localChainConfig()` loads `RPC_URL_31337` and `FACTORY_ADDRESS_31337` as `loadChainEnv()` did and refuses a non-local RPC URL with exit code 2, as `localConfig()` did.

Create `apps/web/scripts/chain-fixture.ts`:

```ts
// The chain half of the local fixture (docs/specs/2026-10-16-freshness-server.md, section 7.3), so the
// scripts that send to Anvil cannot drift: the local chain settings with a non-local endpoint refused, the
// Anvil client, the PASS and FAIL lines, the payment and the factory call, and a manage call simulated and
// sent as the manage machine does. deploy-fixture.ts re-exports it with the Supabase half; verify:freshness
// imports it alone, so it needs Anvil and nothing else. Never prints a key.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createTestClient,
  createWalletClient,
  getAddress,
  http,
  parseAbi,
  publicActions,
  type Abi,
  type Address,
  type Hex,
} from 'viem'
import type { PrivateKeyAccount } from 'viem/accounts'
import { anvil } from 'viem/chains'
import { isLocalUrl } from '@cobweb/shared'
import { collectionAbi } from '@cobweb/shared/collection-abi'

/**
 * Exits with code 2 unless `url` points at this machine, naming its host only: a hosted RPC URL carries its
 * key.
 */
export function refuseRemote(url: string): void {
  if (isLocalUrl(url)) return
  let host = 'an unreadable address'
  try {
    host = new URL(url).host
  } catch {
    // Keep the placeholder.
  }
  console.error(`Refusing to run: ${host} is not local (expected localhost or 127.0.0.1).`)
  process.exit(2)
}

/**
 * The local chain's settings: RPC_URL_31337 and FACTORY_ADDRESS_31337 from the environment, or from
 * apps/web/.env.local when the environment does not set them (filling the environment the shared clients
 * read), or an explanation on stderr and exit code 2. Refuses an RPC URL that is not local.
 */
export function localChainConfig(): { rpc: string; factory: Address } {
  const envFile = resolve(dirname(fileURLToPath(import.meta.url)), '../.env.local')
  if (existsSync(envFile))
    for (const line of readFileSync(envFile, 'utf8').split('\n')) {
      const [, name, value] = line.match(/^(RPC_URL_31337|FACTORY_ADDRESS_31337)=(.*)$/) ?? []
      if (name && value && process.env[name] === undefined) process.env[name] = value.trim()
    }
  const rpc = process.env.RPC_URL_31337
  const factory = process.env.FACTORY_ADDRESS_31337
  if (!rpc || !factory) {
    console.error(
      'Set RPC_URL_31337 and FACTORY_ADDRESS_31337: run `pnpm --filter @cobweb/web chain:local` and copy its two lines into apps/web/.env.local.',
    )
    process.exit(2)
  }
  refuseRemote(rpc)
  return { rpc, factory: getAddress(factory) }
}

const chainSettings = localChainConfig()
export const rpc: string = chainSettings.rpc
export const factory: Address = chainSettings.factory

// Imported after the environment is set, so the shared clients read the local chain settings.
export const { collectionSalt, encodeCollectionArgs, factoryAbi, predictCollectionAddress } =
  await import('@cobweb/shared')
export const { COLLECTION_CODE_HASH, COLLECTION_CREATION_CODE } = await import('@cobweb/shared/collection')
const { abiOf } = await import('../src/lib/manage/phase-calls.ts')
const { classifyError } = await import('../src/components/deploy/tx-errors.ts')
export type ManageCall = import('../src/lib/manage/phase-calls.ts').ManageCall

export const chain = createTestClient({ chain: anvil, mode: 'anvil', transport: http(rpc) }).extend(
  publicActions,
)
export const CID = (letter: string) => `bafybei${letter.repeat(52)}`
export const HEX64 = (n: number) => n.toString(16).padStart(64, '0')
/** The factory's approval view, which the shipped ABI leaves out (the app never asks it). */
const approvalAbi = parseAbi(['function isCreationCodeApproved(bytes32 codeHash) view returns (bool)'])

let passed = 0
const failed: string[] = []

/** A check returns null on success, or a description of what happened instead. */
export async function check(name: string, fn: () => Promise<string | null>): Promise<void> {
  let problem: string | null
  try {
    problem = await fn()
  } catch (e) {
    problem = `threw ${e instanceof Error ? e.message : String(e)}`
  }
  if (problem === null) {
    passed++
    console.log(`PASS ${name}`)
  } else {
    failed.push(name)
    console.log(`FAIL ${name}: ${problem}`)
  }
}

/**
 * Runs the checks, then the cleanup whatever happened, prints the totals and exits non-zero on any failure.
 */
export async function runChecks(main: () => Promise<void>, cleanup: () => Promise<void>): Promise<never> {
  try {
    await main()
  } catch (e) {
    failed.push('run')
    console.log(`FAIL run: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    await cleanup()
  }
  console.log(`\n${passed} passed, ${failed.length} failed`)
  process.exit(failed.length ? 1 : 0)
}

/** Pays for a job from the account through the factory and waits for the receipt. */
export async function pay(account: PrivateKeyAccount, jobId: Hex, value: bigint): Promise<Hex> {
  const wallet = createWalletClient({ account, chain: anvil, transport: http(rpc) })
  const hash = await wallet.writeContract({
    address: factory,
    abi: factoryAbi,
    functionName: 'payForArt',
    args: [jobId],
    value,
  })
  const receipt = await chain.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`payForArt reverted: ${hash}`)
  return hash
}

/**
 * Sends deployCollection with the shipped creation code, the given arguments and salt, and waits for the
 * receipt.
 */
export async function deploy(account: PrivateKeyAccount, encodedArgs: Hex, salt: Hex): Promise<Hex> {
  const wallet = createWalletClient({ account, chain: anvil, transport: http(rpc) })
  const hash = await wallet.writeContract({
    address: factory,
    abi: factoryAbi,
    functionName: 'deployCollection',
    args: [COLLECTION_CREATION_CODE, encodedArgs, salt],
  })
  const receipt = await chain.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`deployCollection reverted: ${hash}`)
  return hash
}

/**
 * The simulation the manage machine runs for a call (docs/specs/2026-10-15-airdrop-settings.md, section 7.1):
 * on the call's contract (the collection, or the validator for the level call), with its ABI and its value.
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

/**
 * How the simulation refuses a manage call, in the creator's words with the chain's symbol, or that it
 * passed.
 */
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

/** Anvil answers as 31337 and the factory approves the shipped creation code hash, or why not. */
export async function chainReady(): Promise<string | null> {
  if ((await chain.getChainId()) !== 31337) return 'not chain 31337'
  const code = await chain.getCode({ address: factory })
  if (!code || code === '0x') return `no contract at ${factory}; run chain:local again`
  const approved = await chain.readContract({
    address: factory,
    abi: approvalAbi,
    functionName: 'isCreationCodeApproved',
    args: [COLLECTION_CODE_HASH],
  })
  return approved
    ? null
    : `the factory does not approve ${COLLECTION_CODE_HASH}; run forge build, the copy script and chain:local again`
}
```

- [ ] **Step 2: The Supabase half re-exports it**

In `apps/web/scripts/deploy-fixture.ts`, replace:

```ts
// The local deploy fixture verify:deploy, verify:phases, verify:whitelist, verify:airdrop and verify:settings share
// (docs/specs/2026-10-15-phases.md, section 10), so they cannot drift: the local settings with non-local endpoints
// refused, the service client and the Anvil client, the PASS and FAIL lines, the SIWE sign-in, a seeded generative
// collection, the lock and deploy contexts the write helpers build, the payment, the render functions, the factory
// call, `deployedCollection`, which locks, pays, renders, links, prepares, deploys and confirms through the cores,
// and a manage call simulated and sent as the manage machine does. Every row it creates is tracked, and
// `removeFixtures` deletes them. Never prints a key.

import { createClient } from '@supabase/supabase-js'
import {
  createTestClient,
  createWalletClient,
  http,
  parseAbi,
  publicActions,
  type Abi,
  type Address,
  type Hex,
} from 'viem'
import type { PrivateKeyAccount } from 'viem/accounts'
import { anvil } from 'viem/chains'
import { createSiweMessage, generateSiweNonce } from 'viem/siwe'
import { collectionAbi } from '@cobweb/shared/collection-abi'
import type { RenderQueue } from '@cobweb/shared/render-queue'
import type { Database } from '../src/lib/database.types.ts'
import { adminClient, clientOptions, localConfig, type LocalClient } from './render-deps.ts'

// Every local setting, with non-local endpoints refused (scripts/render-deps.ts). It also fills the
// environment the shared chain clients read (RPC_URL_31337, FACTORY_ADDRESS_31337).
export const settings = localConfig()
export const rpc: string = settings.rpc
export const factory: Address = settings.factory

// Imported after the environment is set, so the shared clients read the local chain settings.
export const { collectionSalt, encodeCollectionArgs, factoryAbi, predictCollectionAddress } =
  await import('@cobweb/shared')
export const { COLLECTION_CODE_HASH, COLLECTION_CREATION_CODE } = await import('@cobweb/shared/collection')
export const { confirmCore, lockCore } = await import('../src/lib/art/lock-core.ts')
export const { readLockCollection } = await import('../src/lib/art/lock-collection.ts')
export const { confirmDeployCore, prepareCore, readDeployment } =
  await import('../src/lib/deploy/deploy-core.ts')
export const { collectionArgsOf } = await import('../src/lib/deploy/deploy-args.ts')
const { abiOf } = await import('../src/lib/manage/phase-calls.ts')
const { classifyError } = await import('../src/components/deploy/tx-errors.ts')
export type LockContext = import('../src/lib/art/lock-core.ts').LockContext
export type DeployContext = import('../src/lib/deploy/deploy-core.ts').DeployContext
export type DeployOutcome<T> = import('../src/lib/deploy/deploy-core.ts').DeployOutcome<T>
export type DeployForm = import('../src/lib/deploy/deploy-types.ts').DeployForm
export type Prepared = import('../src/lib/deploy/deploy-types.ts').Prepared
export type DeployRecord = import('../src/lib/deploy/deploy-types.ts').DeployRecord
export type ManageCall = import('../src/lib/manage/phase-calls.ts').ManageCall

export const admin: LocalClient = adminClient(settings)
export const chain = createTestClient({ chain: anvil, mode: 'anvil', transport: http(rpc) }).extend(
  publicActions,
)
/** A queue that sends nothing: the render is driven by hand, not by a worker. */
const silentQueue: RenderQueue = { send: async () => {} }
export const CID = (letter: string) => `bafybei${letter.repeat(52)}`
export const HEX64 = (n: number) => n.toString(16).padStart(64, '0')
/** The factory's approval view, which the shipped ABI leaves out (the app never asks it). */
const approvalAbi = parseAbi(['function isCreationCodeApproved(bytes32 codeHash) view returns (bool)'])

let passed = 0
const failed: string[] = []

/** A check returns null on success, or a description of what happened instead. */
export async function check(name: string, fn: () => Promise<string | null>): Promise<void> {
  let problem: string | null
  try {
    problem = await fn()
  } catch (e) {
    problem = `threw ${e instanceof Error ? e.message : String(e)}`
  }
  if (problem === null) {
    passed++
    console.log(`PASS ${name}`)
  } else {
    failed.push(name)
    console.log(`FAIL ${name}: ${problem}`)
  }
}

/** Runs the checks, then the cleanup whatever happened, prints the totals and exits non-zero on any failure. */
export async function runChecks(main: () => Promise<void>, cleanup: () => Promise<void>): Promise<never> {
  try {
    await main()
  } catch (e) {
    failed.push('run')
    console.log(`FAIL run: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    await cleanup()
  }
  console.log(`\n${passed} passed, ${failed.length} failed`)
  process.exit(failed.length ? 1 : 0)
}

const userIds: string[] = []
```

with:

```ts
// The local deploy fixture verify:deploy, verify:phases, verify:whitelist, verify:airdrop and verify:settings
// share (docs/specs/2026-10-15-phases.md, section 10), so they cannot drift: the Supabase half (the local
// settings with non-local endpoints refused, the service client, the SIWE sign-in, a seeded generative
// collection, the lock and deploy contexts the write helpers build, the render functions, and
// `deployedCollection`, which locks, pays, renders, links, prepares, deploys and confirms through the cores)
// over the chain half in chain-fixture.ts, which it re-exports (docs/specs/2026-10-16-freshness-server.md,
// section 7.3). Every row it creates is tracked, and `removeFixtures` deletes them. Never prints a key.

import { createClient } from '@supabase/supabase-js'
import type { Hex } from 'viem'
import type { PrivateKeyAccount } from 'viem/accounts'
import { createSiweMessage, generateSiweNonce } from 'viem/siwe'
import type { RenderQueue } from '@cobweb/shared/render-queue'
import type { Database } from '../src/lib/database.types.ts'
import { CID, deploy, HEX64, pay } from './chain-fixture.ts'
import { adminClient, clientOptions, localConfig, type LocalClient } from './render-deps.ts'

export * from './chain-fixture.ts'

// Every local setting, with non-local endpoints refused (scripts/render-deps.ts, whose chain part is
// chain-fixture.ts's).
export const settings = localConfig()

// Imported after the environment is set, so the cores read the local settings.
export const { confirmCore, lockCore } = await import('../src/lib/art/lock-core.ts')
export const { readLockCollection } = await import('../src/lib/art/lock-collection.ts')
export const { confirmDeployCore, prepareCore, readDeployment } =
  await import('../src/lib/deploy/deploy-core.ts')
export const { collectionArgsOf } = await import('../src/lib/deploy/deploy-args.ts')
export type LockContext = import('../src/lib/art/lock-core.ts').LockContext
export type DeployContext = import('../src/lib/deploy/deploy-core.ts').DeployContext
export type DeployOutcome<T> = import('../src/lib/deploy/deploy-core.ts').DeployOutcome<T>
export type DeployForm = import('../src/lib/deploy/deploy-types.ts').DeployForm
export type Prepared = import('../src/lib/deploy/deploy-types.ts').Prepared
export type DeployRecord = import('../src/lib/deploy/deploy-types.ts').DeployRecord

export const admin: LocalClient = adminClient(settings)
/** A queue that sends nothing: the render is driven by hand, not by a worker. */
const silentQueue: RenderQueue = { send: async () => {} }

const userIds: string[] = []
```

In `apps/web/scripts/deploy-fixture.ts`, replace:

```ts
/** Pays for a job from the account through the factory and waits for the receipt. */
export async function pay(account: PrivateKeyAccount, jobId: Hex, value: bigint): Promise<Hex> {
  const wallet = createWalletClient({ account, chain: anvil, transport: http(rpc) })
  const hash = await wallet.writeContract({
    address: factory,
    abi: factoryAbi,
    functionName: 'payForArt',
    args: [jobId],
    value,
  })
  const receipt = await chain.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`payForArt reverted: ${hash}`)
  return hash
}

/** The render functions with the service role, from a paid (or placeholder) job to done, as the worker would. */
```

with:

```ts
/** The render functions with the service role, from a paid (or placeholder) job to done, as the worker would. */
```

In `apps/web/scripts/deploy-fixture.ts`, replace:

```ts
/** Sends deployCollection with the shipped creation code, the given arguments and salt, and waits for the receipt. */
export async function deploy(account: PrivateKeyAccount, encodedArgs: Hex, salt: Hex): Promise<Hex> {
  const wallet = createWalletClient({ account, chain: anvil, transport: http(rpc) })
  const hash = await wallet.writeContract({
    address: factory,
    abi: factoryAbi,
    functionName: 'deployCollection',
    args: [COLLECTION_CREATION_CODE, encodedArgs, salt],
  })
  const receipt = await chain.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`deployCollection reverted: ${hash}`)
  return hash
}

export type CollectionRow = {
```

with:

```ts
export type CollectionRow = {
```

In `apps/web/scripts/deploy-fixture.ts`, replace:

```ts
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

with:

```ts
/** The collection's row as the service role reads it. */
```

In `apps/web/scripts/deploy-fixture.ts`, replace:

```ts
/** Anvil answers as 31337 and the factory approves the shipped creation code hash, or why not. */
export async function chainReady(): Promise<string | null> {
  if ((await chain.getChainId()) !== 31337) return 'not chain 31337'
  const code = await chain.getCode({ address: factory })
  if (!code || code === '0x') return `no contract at ${factory}; run chain:local again`
  const approved = await chain.readContract({
    address: factory,
    abi: approvalAbi,
    functionName: 'isCreationCodeApproved',
    args: [COLLECTION_CODE_HASH],
  })
  return approved
    ? null
    : `the factory does not approve ${COLLECTION_CODE_HASH}; run forge build, the copy script and chain:local again`
}

/**
 * Locks a seeded collection, pays for it from the creator's wallet, renders it to done and reserves its
```

with:

```ts
/**
 * Locks a seeded collection, pays for it from the creator's wallet, renders it to done and reserves its
```

- [ ] **Step 3: The render settings take their chain part from it**

In `apps/web/scripts/render-deps.ts`, replace:

```ts
// The local render dependencies that verify:render and render:local share
// (docs/specs/2026-10-14-render-screen-wiring.md, section 12), so the two cannot drift: the local
// Supabase, storage and Anvil settings (from the environment, `supabase status -o env` and
// apps/web/.env.local), the refusal of any endpoint that is not local, the service and storage clients,
// and the worker's ports on the production adapters for the database, storage and the chain, around a
// pinner and a queue the caller picks. Never prints a key.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { S3Client } from '@aws-sdk/client-s3'
import { isLocalUrl } from '@cobweb/shared'
import { artS3Options, consoleLog, s3Store, supabaseJobs, viemChain } from '@cobweb/worker'
import type { Chain, Deps, Log, Pinner } from '@cobweb/worker'
import type { MemoryQueue } from '@cobweb/worker/local'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getAddress, type Address } from 'viem'
import type { Database } from '../src/lib/database.types.ts'

const here = dirname(fileURLToPath(import.meta.url))
export const repoRoot = resolve(here, '../../..')

/** Reads RPC_URL_31337 and FACTORY_ADDRESS_31337 from apps/web/.env.local when the environment does not set them. */
export function loadChainEnv(): void {
  const envFile = resolve(here, '../.env.local')
  if (!existsSync(envFile)) return
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const [, name, value] = line.match(/^(RPC_URL_31337|FACTORY_ADDRESS_31337)=(.*)$/) ?? []
    if (name && value && process.env[name] === undefined) process.env[name] = value.trim()
  }
}
```

with:

```ts
// The local render dependencies that verify:render and render:local share
// (docs/specs/2026-10-14-render-screen-wiring.md, section 12), so the two cannot drift: the local Supabase,
// storage and Anvil settings (from the environment, `supabase status -o env` and apps/web/.env.local, the
// chain's through chain-fixture.ts), the refusal of any endpoint that is not local, the service and storage
// clients, and the worker's ports on the production adapters for the database, storage and the chain, around
// a pinner and a queue the caller picks. Never prints a key.

import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { S3Client } from '@aws-sdk/client-s3'
import { artS3Options, consoleLog, s3Store, supabaseJobs, viemChain } from '@cobweb/worker'
import type { Chain, Deps, Log, Pinner } from '@cobweb/worker'
import type { MemoryQueue } from '@cobweb/worker/local'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Address } from 'viem'
import type { Database } from '../src/lib/database.types.ts'
import { localChainConfig, refuseRemote } from './chain-fixture.ts'

const here = dirname(fileURLToPath(import.meta.url))
export const repoRoot = resolve(here, '../../..')
```

In `apps/web/scripts/render-deps.ts`, replace:

```ts
/**
 * Every local setting, or an explanation on stderr and exit code 2. Refuses any endpoint that is not
 * local. Also fills the environment the web app's storage module and the worker's chain adapter read
 * (ART_S3_*, RENDER_S3_BUCKET, RPC_URL_31337, FACTORY_ADDRESS_31337) when it is not set already.
 */
export function localConfig(): LocalConfig {
  loadChainEnv()
  const url = config('NEXT_PUBLIC_SUPABASE_URL', ['API_URL'])
```

with:

```ts
/**
 * Every local setting, or an explanation on stderr and exit code 2. Refuses any endpoint that is not
 * local. The chain's come from chain-fixture.ts's `localChainConfig()`, which fills the environment the
 * worker's chain adapter reads (RPC_URL_31337, FACTORY_ADDRESS_31337); this also fills the one the web app's
 * storage module reads (ART_S3_*, RENDER_S3_BUCKET) when it is not set already.
 */
export function localConfig(): LocalConfig {
  const { rpc, factory } = localChainConfig()
  const url = config('NEXT_PUBLIC_SUPABASE_URL', ['API_URL'])
```

In `apps/web/scripts/render-deps.ts`, replace:

```ts
  const renderBucket = config('RENDER_S3_BUCKET', [], 'render')
  const rpc = process.env.RPC_URL_31337
  const factoryEnv = process.env.FACTORY_ADDRESS_31337
  if (!rpc || !factoryEnv) {
    console.error(
      'Set RPC_URL_31337 and FACTORY_ADDRESS_31337: run `pnpm --filter @cobweb/web chain:local` and copy its two lines into apps/web/.env.local.',
    )
    process.exit(2)
  }
  for (const endpoint of [url, rpc, storage.ART_S3_ENDPOINT])
    if (!isLocalUrl(endpoint)) {
      // The host only: a hosted RPC URL carries its key in the path.
      let host = 'an unreadable address'
      try {
        host = new URL(endpoint).host
      } catch {
        // Keep the placeholder.
      }
      console.error(`Refusing to run: ${host} is not local (expected localhost or 127.0.0.1).`)
      process.exit(2)
    }
  for (const [name, value] of Object.entries(storage)) process.env[name] ??= value
```

with:

```ts
  const renderBucket = config('RENDER_S3_BUCKET', [], 'render')
  for (const endpoint of [url, storage.ART_S3_ENDPOINT]) refuseRemote(endpoint)
  for (const [name, value] of Object.entries(storage)) process.env[name] ??= value
```

In `apps/web/scripts/render-deps.ts`, replace:

```ts
    rpc,
    factory: getAddress(factoryEnv),
  }
```

with:

```ts
    rpc,
    factory,
  }
```

- [ ] **Step 4: Run the scripts on the split fixture**

Run: `pnpm --filter @cobweb/web typecheck && pnpm --filter @cobweb/web lint`
Expected: no errors and no warnings.

Run: `pnpm --filter @cobweb/web verify:deploy`, then `verify:phases`, `verify:whitelist`, `verify:airdrop`, `verify:settings` and `verify:render`
Expected: `15 passed, 0 failed`, `20 passed, 0 failed`, `18 passed, 0 failed`, `15 passed, 0 failed` (with the gas line), `17 passed, 0 failed` and `22 passed, 0 failed`: the split changes no check.

- [ ] **Step 5: The script and its dev dependency**

In `apps/web/package.json`, replace:

```json
    "verify:settings": "node --conditions=react-server --import ./scripts/resolve-ts.mjs scripts/verify-settings.ts"
  },
  "devDependencies": {
    "@ipld/car": "5.4.7",
```

with:

```json
    "verify:settings": "node --conditions=react-server --import ./scripts/resolve-ts.mjs scripts/verify-settings.ts",
    "verify:freshness": "node --conditions=react-server --import ./scripts/resolve-ts.mjs scripts/verify-freshness.ts"
  },
  "devDependencies": {
    "@cobweb/freshness": "workspace:^",
    "@ipld/car": "5.4.7",
```

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
pnpm install --offline
git diff --stat pnpm-lock.yaml
```

Expected: `pnpm-lock.yaml | 3 +++`: the `@cobweb/freshness` link (`link:../freshness`) among the web app's dev dependencies.

- [ ] **Step 6: verify:freshness**

Decision (section 10): "within one tick" is the tier `/health` reports at that moment plus 500 ms for the read, and 1.2 s more where the switch has just passed again (Decision 13). The switch counts every request it receives, failing or not, so check 2 and check 16 see any call the server makes. `RPC_URL_31337` points at the switch before `startFreshness`, and the server's client is the first `publicClientFor(31337)` the process makes; the fixture's own client talks to Anvil directly.

Create `apps/web/scripts/verify-freshness.ts`:

```ts
// Checks the freshness server against a LOCAL Anvil chain (docs/specs/2026-10-16-freshness-server.md, section
// 10): the server runs in process from @cobweb/freshness/server, reading the chain through an RPC switch (an
// HTTP server on 127.0.0.1 that forwards each request to Anvil, answers 503 while failing and counts what it
// carries), and two collections deployed straight through the factory, recording nothing, are polled every
// 100 ms: the refusals, the first read, the tier, the ETag, a phase scheduled at T read inactive at T-1 and
// active within one tick of the first block at T, the wallet endpoint and its windows, the extras on their
// logs, a first read pending, degraded, /health and the stop. Sixteen PASS lines. Needs Anvil with the
// factory and nothing else.
//
//   pnpm --filter @cobweb/web chain:local    (then copy its two lines into apps/web/.env.local)
//   pnpm --filter @cobweb/web verify:freshness
//
// The chain fixture (scripts/chain-fixture.ts) reads the settings from the environment and
// apps/web/.env.local and refuses a non-local endpoint. Never prints a key. The two collections stay on
// Anvil, and the chain's clock ends about 600 s ahead of where it was. Runs under `node
// --conditions=react-server --import ./scripts/resolve-ts.mjs`.

import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  createWalletClient,
  getAddress,
  http,
  keccak256,
  parseEther,
  toHex,
  zeroAddress,
  type Address,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { anvil } from 'viem/chains'
import { chainStateOf, DEFAULT_TRANSFER_VALIDATOR } from '@cobweb/shared'
import { collectionAbi } from '@cobweb/shared/collection-abi'
import {
  startFreshness,
  TIER_MS,
  type Freshness,
  type HealthBody,
  type StateBody,
  type WalletBody,
} from '@cobweb/freshness/server'
import {
  chain,
  chainReady,
  check,
  CID,
  collectionSalt,
  COLLECTION_CREATION_CODE,
  deploy,
  encodeCollectionArgs,
  factory,
  predictCollectionAddress,
  rpc,
  runChecks,
  sendCall,
} from './chain-fixture.ts'

const { phaseCalls, settingsCalls } = await import('../src/lib/manage/phase-calls.ts')

/** The launch groups each collection deploys with: Public (id 0) and Holders (id 1). */
const PUBLIC = 0
const HOLDERS = 1
const STATE_CACHE = 'public, max-age=0, s-maxage=1, stale-while-revalidate=1, stale-if-error=60'
/** The time the slowest RPC retry in flight may add to a tick: viem's three, at 150, 300 and 600 ms. */
const RETRY_SLACK_MS = 1_200

const creatorKey = privateKeyToAccount(generatePrivateKey())
const holderKey = privateKeyToAccount(generatePrivateKey())
const strangerKey = privateKeyToAccount(generatePrivateKey())

type Answer = { status: number; headers: Headers; text: string }

/**
 * An HTTP server on 127.0.0.1 that forwards each request to Anvil, answers 503 while failing, and counts
 * them.
 */
async function rpcSwitch(target: string) {
  let failing = false
  let carried = 0
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      carried++
      if (failing) {
        response.writeHead(503, { 'Content-Type': 'text/plain' }).end('failing')
        return
      }
      fetch(target, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: Buffer.concat(chunks),
      })
        .then(async (answer) => {
          const body = Buffer.from(await answer.arrayBuffer())
          response.writeHead(answer.status, { 'Content-Type': 'application/json' }).end(body)
        })
        .catch(() => response.writeHead(502).end())
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    fail: (on: boolean) => {
      failing = on
    },
    carried: () => carried,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      }),
  }
}

let rpcSwitchOn: Awaited<ReturnType<typeof rpcSwitch>> | null = null
let freshness: Freshness | null = null

async function get(path: string, init?: RequestInit): Promise<Answer> {
  if (!freshness) throw new Error('the server is not running')
  const response = await fetch(`${freshness.url}${path}`, init)
  return { status: response.status, headers: response.headers, text: await response.text() }
}
const stateOf = (address: Address, init?: RequestInit) =>
  get(`/v1/state/31337/${address.toLowerCase()}`, init)
const walletOf = (address: Address, wallet: Address) =>
  get(`/v1/wallet/31337/${address.toLowerCase()}/${wallet.toLowerCase()}`)
const healthOf = async () => JSON.parse((await get('/health')).text) as HealthBody
const bodyOf = (answer: Answer) => JSON.parse(answer.text) as StateBody
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Polls every 100 ms until `fn` answers something other than null, or answers null after `ms`. */
async function poll<T>(fn: () => Promise<T | null>, ms: number): Promise<T | null> {
  const until = Date.now() + ms
  for (;;) {
    const value = await fn()
    if (value !== null || Date.now() >= until) return value
    await wait(100)
  }
}

/** One tick of the chain at its tier now, plus the read: how long a change may take to show. */
async function oneTick(): Promise<number> {
  const tier = (await healthOf()).chains[0]?.tier ?? 'live'
  return TIER_MS[tier] + 500
}

/** A collection deployed straight through the factory from the creator, recording nothing. */
async function deployCollection(name: string): Promise<Address> {
  const args = encodeCollectionArgs({
    name,
    symbol: 'FRESH',
    payout: creatorKey.address,
    baseUri: `ipfs://${CID('e')}/`,
    maxSupply: 5n,
    groupSupplies: [3n, 2n],
    groupPrices: [0n, 0n],
    publicMaxPerWallet: 2n,
    royaltyBps: 500,
    owner: creatorKey.address,
    royaltyReceiver: creatorKey.address,
  })
  const salt = collectionSalt(randomUUID())
  const address = predictCollectionAddress({
    factory,
    deployer: creatorKey.address,
    salt,
    creationCode: COLLECTION_CREATION_CODE,
    args,
  })
  await deploy(creatorKey, args, salt)
  return address
}

async function main(): Promise<void> {
  console.log(`Verifying the freshness server against ${rpc}`)
  await check(
    '1. chain: Anvil answers as 31337 and the factory approves the shipped creation code hash',
    chainReady,
  )
  for (const key of [creatorKey, holderKey, strangerKey])
    await chain.setBalance({ address: key.address, value: parseEther('10') })
  const A = await deployCollection('Freshness A')
  const B = await deployCollection('Freshness B')

  rpcSwitchOn = await rpcSwitch(rpc)
  const relay = rpcSwitchOn
  process.env.RPC_URL_31337 = relay.url
  freshness = await startFreshness({ port: 0, host: '127.0.0.1', chainIds: [31337] })

  await check(
    '2. at start: before any request, /health answers 200 with no-store, chain 31337 served with no hot collection and no block, and the switch has carried no request',
    async () => {
      const answer = await get('/health')
      const body = JSON.parse(answer.text) as HealthBody
      if (answer.status !== 200 || answer.headers.get('cache-control') !== 'no-store')
        return `${answer.status} ${answer.headers.get('cache-control')}`
      const [anvilHealth] = body.chains
      if (body.chains.length !== 1 || anvilHealth?.chainId !== 31337) return JSON.stringify(body.chains)
      if (anvilHealth.hot !== 0 || anvilHealth.tier !== null || anvilHealth.block !== null)
        return JSON.stringify(anvilHealth)
      return relay.carried() === 0 ? null : `the switch carried ${relay.carried()} requests`
    },
  )

  await check(
    "3. refusals: the stranger's wallet and the factory answer 404 not-a-collection, chain 999 answers 404 chain-not-served, a malformed address 400 and an unknown path 404, each with s-maxage=10; a POST answers 405",
    async () => {
      const cases: [Answer, number, string][] = [
        [await stateOf(strangerKey.address), 404, 'not-a-collection'],
        [await stateOf(factory), 404, 'not-a-collection'],
        [await get(`/v1/state/999/${A.toLowerCase()}`), 404, 'chain-not-served'],
        [await get(`/v1/state/31337/${A.toLowerCase().slice(0, -1)}`), 400, 'bad-request'],
        [await get('/v1/collections'), 404, 'not-found'],
      ]
      for (const [answer, status, error] of cases) {
        const cache = answer.headers.get('cache-control')
        if (
          answer.status !== status ||
          answer.text !== JSON.stringify({ error }) ||
          !cache?.includes('s-maxage=10')
        )
          return `${error}: ${answer.status} ${answer.text} ${cache}`
      }
      const post = await stateOf(A, { method: 'POST' })
      return post.status === 405 && post.text === '{"error":"method-not-allowed"}'
        ? null
        : `POST: ${post.status} ${post.text}`
    },
  )

  await sendCall(creatorKey, A, phaseCalls.open(HOLDERS))
  const T = Number((await chain.getBlock()).timestamp) + 600
  await sendCall(creatorKey, A, phaseCalls.schedule(PUBLIC, T))
  let etag = ''

  await check(
    "4. first read: with Holders open and Public scheduled at T, 600 s after the latest block, A's first request answers 200 within the join wait; its collectionState fields equal a direct read at its block; the owner, a royalty of 500 bps to the creator, the base URI and the default validator are A's; transferLevel is none, degraded false and readAt within 2 s; with the state's cache headers, a weak ETag and Access-Control-Allow-Origin *",
    async () => {
      const startedAt = Date.now()
      const answer = await stateOf(A)
      const took = Date.now() - startedAt
      if (answer.status !== 200 || took > 2_000) return `${answer.status} after ${took} ms: ${answer.text}`
      const body = bodyOf(answer)
      const direct = await chain.readContract({
        address: A,
        abi: collectionAbi,
        functionName: 'collectionState',
        blockNumber: BigInt(body.block),
      })
      const expected = chainStateOf(direct, BigInt(body.block))
      const read = {
        blockTimestamp: body.blockTimestamp,
        maxSupply: body.maxSupply,
        totalMinted: body.totalMinted,
        publicMaxMintPerWallet: body.publicMaxMintPerWallet,
        mintOnBehalfActive: body.mintOnBehalfActive,
        groups: body.groups,
        fees: [body.mintFeeFlatWei, body.mintFeeBps, body.airdropFeePerTokenWei],
      }
      const want = {
        blockTimestamp: expected.blockTimestamp,
        maxSupply: expected.maxSupply,
        totalMinted: expected.totalMinted,
        publicMaxMintPerWallet: expected.publicMaxMintPerWallet,
        mintOnBehalfActive: expected.mintOnBehalfActive,
        groups: expected.groups,
        fees: [
          direct.mintFeeFlat.toString(),
          Number(direct.mintFeeBps),
          direct.airdropFeePerToken.toString(),
        ],
      }
      if (JSON.stringify(read) !== JSON.stringify(want)) return `read ${JSON.stringify(read)}`
      const extras = [
        body.owner,
        body.royalty.receiver,
        body.royalty.bps,
        body.baseUri,
        body.transferValidator,
      ]
      const wantExtras = [
        creatorKey.address,
        creatorKey.address,
        500,
        `ipfs://${CID('e')}/`,
        DEFAULT_TRANSFER_VALIDATOR,
      ]
      if (JSON.stringify(extras) !== JSON.stringify(wantExtras)) return `extras ${JSON.stringify(extras)}`
      if (
        body.transferLevel !== 'none' ||
        body.degraded ||
        Math.abs(Date.now() - body.readAt * 1_000) > 2_000
      )
        return `level ${body.transferLevel}, degraded ${body.degraded}, readAt ${body.readAt}`
      etag = answer.headers.get('etag') ?? ''
      return answer.headers.get('cache-control') === STATE_CACHE &&
        /^W\/"[0-9a-f]{32}"$/.test(etag) &&
        answer.headers.get('access-control-allow-origin') === '*'
        ? null
        : `headers ${answer.headers.get('cache-control')} ${etag}`
    },
  )

  await check('5. tier: /health reports chain 31337 at the 2 s tier with one hot collection', async () => {
    const [anvilHealth] = (await healthOf()).chains
    return anvilHealth?.tier === 'live' && anvilHealth.hot === 1 ? null : JSON.stringify(anvilHealth)
  })

  await check(
    '6. ETag: an empty block is read under the same ETag; If-None-Match with it answers 304 with no body and the same headers, another tag answers 200; OPTIONS answers 204 with the CORS headers',
    async () => {
      const block = bodyOf(await stateOf(A)).block
      await chain.mine({ blocks: 1 })
      const after = await poll(
        async () => {
          const answer = await stateOf(A)
          return bodyOf(answer).block > block ? answer : null
        },
        await oneTick(),
      )
      if (!after) return 'the empty block was not read'
      if (after.headers.get('etag') !== etag) return `the tag moved: ${after.headers.get('etag')}`
      const same = await stateOf(A, { headers: { 'If-None-Match': etag } })
      if (
        same.status !== 304 ||
        same.text !== '' ||
        same.headers.get('etag') !== etag ||
        same.headers.get('cache-control') !== STATE_CACHE ||
        same.headers.get('access-control-allow-origin') !== '*'
      )
        return `304: ${same.status} ${same.headers.get('etag')} ${same.headers.get('cache-control')}`
      const other = await stateOf(A, { headers: { 'If-None-Match': 'W/"0"' } })
      if (other.status !== 200) return `another tag: ${other.status}`
      const preflight = await stateOf(A, { method: 'OPTIONS' })
      return preflight.status === 204 &&
        preflight.headers.get('access-control-allow-origin') === '*' &&
        preflight.headers.get('access-control-allow-methods') === 'GET, HEAD' &&
        preflight.headers.get('access-control-allow-headers') === 'If-None-Match' &&
        preflight.headers.get('access-control-max-age') === '86400'
        ? null
        : `OPTIONS: ${preflight.status}`
    },
  )

  /** Every answer polled from T-1 on, for check 8. */
  const sinceStart: StateBody[] = []
  let etagAtStart = ''

  await check(
    '7. at T-1: a block mined at T-1 with evm_setNextBlockTimestamp and evm_mine is read within one tick: blockTimestamp T-1, Public with flag false, startTimestamp T and active false; /health then reports the 1 s tier',
    async () => {
      const bound = await oneTick()
      await chain.setNextBlockTimestamp({ timestamp: BigInt(T - 1) })
      await chain.mine({ blocks: 1 })
      const seen = await poll(async () => {
        const answer = await stateOf(A)
        const body = bodyOf(answer)
        sinceStart.push(body)
        if (body.blockTimestamp !== T - 1) return null
        etagAtStart = answer.headers.get('etag') ?? ''
        return body
      }, bound)
      if (!seen) return `T-1 was not read within ${bound} ms`
      const publicGroup = seen.groups.find((group) => group.id === PUBLIC)
      if (publicGroup?.flag !== false || publicGroup.startTimestamp !== T || publicGroup.active !== false)
        return `Public at T-1: ${JSON.stringify(publicGroup)}`
      const tier = (await healthOf()).chains[0]?.tier
      return tier === 'fast' ? null : `tier ${tier}`
    },
  )

  await check(
    '8. at T: a block mined at T is read within 1.5 s (one 1 s tick and the read) with Public active true under a new ETag, and no answer polled since T-1 with a blockTimestamp below T read Public active',
    async () => {
      await chain.setNextBlockTimestamp({ timestamp: BigInt(T) })
      await chain.mine({ blocks: 1 })
      const live = await poll(async () => {
        const answer = await stateOf(A)
        const body = bodyOf(answer)
        sinceStart.push(body)
        const active = body.groups.find((group) => group.id === PUBLIC)?.active
        return body.blockTimestamp >= T && active ? answer : null
      }, 1_500)
      if (!live) return 'Public did not read active within 1.5 s of the block at T'
      if (live.headers.get('etag') === etagAtStart) return 'the tag did not change'
      const early = sinceStart.filter(
        (body) => body.blockTimestamp < T && body.groups.find((group) => group.id === PUBLIC)?.active,
      )
      return early.length === 0 ? null : `${early.length} answers read Public active before T`
    },
  )

  await sendCall(creatorKey, A, phaseCalls.quotas(HOLDERS, [holderKey.address], [2]))

  await check(
    "9. wallet: once the creator writes a quota of 2 for the holder in Holders, the holder's answer reads publicMinted 0, Holders quota 2 and claimed 0, and the stranger's Holders quota 0, both with no vaults (Anvil has no registry code) and s-maxage=5",
    async () => {
      const holder = await walletOf(A, holderKey.address)
      const stranger = await walletOf(A, strangerKey.address)
      for (const answer of [holder, stranger])
        if (answer.status !== 200 || answer.headers.get('cache-control') !== 'public, max-age=0, s-maxage=5')
          return `${answer.status} ${answer.headers.get('cache-control')} ${answer.text}`
      const own = JSON.parse(holder.text) as WalletBody
      const other = JSON.parse(stranger.text) as WalletBody
      const holders = (body: WalletBody) => body.groups.find((group) => group.id === HOLDERS)
      return own.wallet === holderKey.address &&
        own.publicMinted === 0 &&
        holders(own)?.quota === 2 &&
        holders(own)?.claimed === 0 &&
        holders(other)?.quota === 0 &&
        own.vaults.length === 0 &&
        other.vaults.length === 0
        ? null
        : `${holder.text} ${stranger.text}`
    },
  )

  await check(
    "10. a mint: the holder mints one from Holders with the value quoteBatchMint answers; its answer reads claimed 1 at once, and A's state reads Holders minted 1 and totalMinted 1 under a new ETag within one tick",
    async () => {
      const before = (await stateOf(A)).headers.get('etag')
      const [totalCost] = await chain.readContract({
        address: A,
        abi: collectionAbi,
        functionName: 'quoteBatchMint',
        args: [BigInt(HOLDERS), 1n],
      })
      const { request } = await chain.simulateContract({
        account: holderKey,
        address: A,
        abi: collectionAbi,
        functionName: 'batchMint',
        args: [1n, BigInt(HOLDERS)],
        value: totalCost,
      })
      const hash = await createWalletClient({
        account: holderKey,
        chain: anvil,
        transport: http(rpc),
      }).writeContract(request)
      if ((await chain.waitForTransactionReceipt({ hash })).status !== 'success')
        return `the mint reverted: ${hash}`
      const bound = await oneTick()
      const answer = JSON.parse((await walletOf(A, holderKey.address)).text) as WalletBody
      if (answer.groups.find((group) => group.id === HOLDERS)?.claimed !== 1)
        return `wallet ${JSON.stringify(answer)}`
      const minted = await poll(async () => {
        const state = await stateOf(A)
        const body = bodyOf(state)
        return body.totalMinted === 1 && body.groups.find((group) => group.id === HOLDERS)?.minted === 1
          ? state
          : null
      }, bound)
      if (!minted) return `the mint was not read within ${bound} ms`
      return minted.headers.get('etag') !== before ? null : 'the tag did not change'
    },
  )

  await check(
    "11. windows: ten wallets asked together are answered from one 200 ms window: /health's wallet windows rise by one and answered by ten",
    async () => {
      const before = (await healthOf()).wallet
      const wallets = Array.from({ length: 10 }, (_, index) =>
        getAddress(`0x${keccak256(toHex(`freshness wallet ${index}`)).slice(26)}`),
      )
      const answers = await Promise.all(wallets.map((wallet) => walletOf(A, wallet)))
      if (answers.some((answer) => answer.status !== 200))
        return answers.map((answer) => answer.status).join(' ')
      const after = (await healthOf()).wallet
      return after.windows === before.windows + 1 && after.answered === before.answered + 10
        ? null
        : `${JSON.stringify(before)} then ${JSON.stringify(after)}`
    },
  )

  await check(
    "12. extras on their logs: setBaseURI to ipfs://<CID('f')>/, a royalty of 750 bps to the stranger and the validator set to the zero address each read within one tick of their receipt, the last with transferLevel none",
    async () => {
      const changes: [string, ReturnType<typeof settingsCalls.baseUri>, (body: StateBody) => boolean][] = [
        [
          'the base URI',
          settingsCalls.baseUri(`ipfs://${CID('f')}/`),
          (body) => body.baseUri === `ipfs://${CID('f')}/`,
        ],
        [
          'the royalty',
          settingsCalls.royalty(strangerKey.address, 750),
          (body) => body.royalty.receiver === strangerKey.address && body.royalty.bps === 750,
        ],
        [
          'the validator',
          settingsCalls.validator(zeroAddress),
          (body) => body.transferValidator === zeroAddress && body.transferLevel === 'none',
        ],
      ]
      for (const [label, call, done] of changes) {
        const bound = await oneTick()
        await sendCall(creatorKey, A, call)
        const read = await poll(async () => (done(bodyOf(await stateOf(A))) ? true : null), bound)
        if (!read) return `${label} was not read within ${bound} ms of its receipt`
      }
      return null
    },
  )

  await check(
    '13. first read pending: B, known as a collection from a wallet request, answers 503 not-read-yet with Retry-After 1 and no-store while the switch fails, then 200 within two ticks of it passing again',
    async () => {
      const known = await walletOf(B, holderKey.address)
      if (known.status !== 200) return `the wallet request: ${known.status} ${known.text}`
      if ((await healthOf()).hot !== 1) return 'the wallet request made B hot'
      relay.fail(true)
      const pending = await stateOf(B)
      relay.fail(false)
      if (
        pending.status !== 503 ||
        pending.text !== '{"error":"not-read-yet"}' ||
        pending.headers.get('retry-after') !== '1' ||
        pending.headers.get('cache-control') !== 'no-store'
      )
        return `while failing: ${pending.status} ${pending.text} ${pending.headers.get('cache-control')}`
      const bound = 2 * TIER_MS.live + RETRY_SLACK_MS
      const read = await poll(async () => ((await stateOf(B)).status === 200 ? true : null), bound)
      return read ? null : `B was not read within ${bound} ms of the switch passing`
    },
  )

  await check(
    '14. degraded: with the switch failing, A answers its last state with degraded true under a new ETag once its last read is more than 10 s old, readAt unchanged, and /health names the failure; with the switch passing, degraded is false again within one tick',
    async () => {
      const fresh = await stateOf(A)
      const readAt = bodyOf(fresh).readAt
      relay.fail(true)
      const stale = await poll(async () => {
        const answer = await stateOf(A)
        const body = bodyOf(answer)
        if (!body.degraded) return null
        return { answer, body, at: Date.now() }
      }, 15_000)
      const failing = (await healthOf()).chains[0]
      relay.fail(false)
      if (!stale) return 'A never read degraded'
      if (stale.body.readAt !== readAt) return `readAt moved from ${readAt} to ${stale.body.readAt}`
      if (stale.at - readAt * 1_000 <= 10_000)
        return `degraded ${stale.at - readAt * 1_000} ms after the read`
      if (stale.answer.headers.get('etag') === fresh.headers.get('etag')) return 'the tag did not change'
      if (failing?.lastError !== 'HttpRequestError' || !failing.failedTicks) return JSON.stringify(failing)
      const bound = (await oneTick()) + RETRY_SLACK_MS
      const recovered = await poll(async () => (bodyOf(await stateOf(A)).degraded ? null : true), bound)
      return recovered ? null : `still degraded ${bound} ms after the switch passed`
    },
  )

  await check(
    "15. health: /health reports chain 31337 with two hot collections, its tier, block, lag and last good tick, and neither the switch's URL nor Anvil's",
    async () => {
      const answer = await get('/health')
      const [anvilHealth] = (JSON.parse(answer.text) as HealthBody).chains
      if (
        anvilHealth?.hot !== 2 ||
        anvilHealth.tier === null ||
        anvilHealth.block === null ||
        anvilHealth.lagSeconds === null ||
        anvilHealth.lastGoodTickAt === null
      )
        return JSON.stringify(anvilHealth)
      const hosts = [new URL(relay.url).host, new URL(rpc).host]
      return hosts.some((host) => answer.text.includes(host)) ? `a URL is in ${answer.text}` : null
    },
  )

  await check(
    '16. stop: close() ends the server; its port refuses a connection and the switch carries no request for 3 s',
    async () => {
      const server = freshness
      if (!server) return 'the server is not running'
      await server.close()
      freshness = null
      const carried = relay.carried()
      let refused = false
      try {
        await fetch(`${server.url}/health`)
      } catch {
        refused = true
      }
      await wait(3_000)
      return refused && relay.carried() === carried
        ? null
        : `refused ${refused}, carried ${relay.carried() - carried}`
    },
  )
}

async function cleanup(): Promise<void> {
  await freshness?.close()
  await rpcSwitchOn?.close()
}

await runChecks(main, cleanup)
```

Run: `pnpm --filter @cobweb/web typecheck`, then `pnpm --filter @cobweb/web verify:freshness`
Expected: the server's start line (`The freshness server listens on port <n>, serving Anvil (31337).`), sixteen PASS lines, some `A tick on Anvil failed: HttpRequestError: HTTP request failed.` lines while the switch fails in checks 13 and 14 (never a URL), then `16 passed, 0 failed`, in about 40 s:

```
PASS 1. chain: Anvil answers as 31337 and the factory approves the shipped creation code hash
PASS 2. at start: before any request, /health answers 200 with no-store, chain 31337 served with no hot collection and no block, and the switch has carried no request
PASS 3. refusals: the stranger's wallet and the factory answer 404 not-a-collection, chain 999 answers 404 chain-not-served, a malformed address 400 and an unknown path 404, each with s-maxage=10; a POST answers 405
PASS 4. first read: with Holders open and Public scheduled at T, 600 s after the latest block, A's first request answers 200 within the join wait; its collectionState fields equal a direct read at its block; the owner, a royalty of 500 bps to the creator, the base URI and the default validator are A's; transferLevel is none, degraded false and readAt within 2 s; with the state's cache headers, a weak ETag and Access-Control-Allow-Origin *
PASS 5. tier: /health reports chain 31337 at the 2 s tier with one hot collection
PASS 6. ETag: an empty block is read under the same ETag; If-None-Match with it answers 304 with no body and the same headers, another tag answers 200; OPTIONS answers 204 with the CORS headers
PASS 7. at T-1: a block mined at T-1 with evm_setNextBlockTimestamp and evm_mine is read within one tick: blockTimestamp T-1, Public with flag false, startTimestamp T and active false; /health then reports the 1 s tier
PASS 8. at T: a block mined at T is read within 1.5 s (one 1 s tick and the read) with Public active true under a new ETag, and no answer polled since T-1 with a blockTimestamp below T read Public active
PASS 9. wallet: once the creator writes a quota of 2 for the holder in Holders, the holder's answer reads publicMinted 0, Holders quota 2 and claimed 0, and the stranger's Holders quota 0, both with no vaults (Anvil has no registry code) and s-maxage=5
PASS 10. a mint: the holder mints one from Holders with the value quoteBatchMint answers; its answer reads claimed 1 at once, and A's state reads Holders minted 1 and totalMinted 1 under a new ETag within one tick
PASS 11. windows: ten wallets asked together are answered from one 200 ms window: /health's wallet windows rise by one and answered by ten
PASS 12. extras on their logs: setBaseURI to ipfs://<CID('f')>/, a royalty of 750 bps to the stranger and the validator set to the zero address each read within one tick of their receipt, the last with transferLevel none
PASS 13. first read pending: B, known as a collection from a wallet request, answers 503 not-read-yet with Retry-After 1 and no-store while the switch fails, then 200 within two ticks of it passing again
PASS 14. degraded: with the switch failing, A answers its last state with degraded true under a new ETag once its last read is more than 10 s old, readAt unchanged, and /health names the failure; with the switch passing, degraded is false again within one tick
PASS 15. health: /health reports chain 31337 with two hot collections, its tier, block, lag and last good tick, and neither the switch's URL nor Anvil's
PASS 16. stop: close() ends the server; its port refuses a connection and the switch carries no request for 3 s

16 passed, 0 failed
```

Checks 7 and 8 are the server half of Phase 6's exit criterion: never active before the chain's time reaches the start, and active within one tick of the first block at it.

- [ ] **Step 7: CLAUDE.md**

In `CLAUDE.md`, replace:

```
apps/freshness     Railway service that reads chain state for mint pages
```

with:

```
apps/freshness     Railway service that reads chain state for mint pages: the state and wallet endpoints, run from source on Node 24
```

In `CLAUDE.md`, replace:

```
packages/shared    Chain config, factory ABI and addresses, job ids, the render queue contract (browser entry) and viem clients (server entry)
```

with:

```
packages/shared    Chain config, factory ABI and addresses, job ids, the render queue contract and the pure chain readers (browser entry), viem clients (server entry, and the clients entry the freshness server imports)
```

In `CLAUDE.md`, replace:

```
pnpm --filter @cobweb/web verify:settings   # the read, each setting sent and confirmed from its receipt, the copies, the refusals and the owner check, against local Supabase and Anvil
```

with:

```
pnpm --filter @cobweb/web verify:settings   # the read, each setting sent and confirmed from its receipt, the copies, the refusals and the owner check, against local Supabase and Anvil
pnpm --filter @cobweb/freshness dev       # the freshness server on port 3100 against the chains in apps/freshness/.env
pnpm --filter @cobweb/freshness test      # the freshness server: tiers, the hot set, the ETag, degraded, the delegation filter, the wallet windows
pnpm --filter @cobweb/web verify:freshness   # the freshness server in process against Anvil: liveness at T-1 and at T, the ETag, the refusals, the wallet endpoint and degraded
```

- [ ] **Step 8: Format, run the root checks and commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
pnpm exec prettier --write apps/web/scripts/chain-fixture.ts apps/web/scripts/deploy-fixture.ts apps/web/scripts/render-deps.ts apps/web/scripts/verify-freshness.ts apps/web/package.json CLAUDE.md
pnpm typecheck && pnpm lint && pnpm test
git add apps/web/scripts/chain-fixture.ts apps/web/scripts/deploy-fixture.ts apps/web/scripts/render-deps.ts apps/web/scripts/verify-freshness.ts apps/web/package.json pnpm-lock.yaml CLAUDE.md
git commit -m "$(cat <<'EOF'
Move the fixture's chain half to chain-fixture.ts, which deploy-fixture.ts re-exports and render-deps.ts takes its chain settings from, and add verify:freshness on it with the RPC switch and sixteen checks

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: test counts unchanged (shared 102, freshness 66, web 696).

---

### Task 9: The whole check list, the start as Railway runs it, MASTER_PLAN and the landing note

This task is the controller's: it runs every check, starts the server as Railway will, and records what it saw. The doc edits add dated sentences; nothing earlier is rewritten or deleted. There is no browser walk: the mint page moves to live data in the second sub-project.

**Files:**

- Modify: `docs/MASTER_PLAN.md` (a dated Hosting decision; the Phase 6 status line)
- Modify: `docs/specs/2026-10-16-freshness-server.md` (the acceptance boxes; the landing note)

**Interfaces:**

- Consumes: everything Tasks 1 to 8 produce, the local services (`supabase start`, `supabase seed buckets`, `pnpm --filter @cobweb/web chain:local` with its two lines in `apps/web/.env.local`), and `curl`.
- Produces: the docs.

In every sentence below, `<date>` is the day the work lands, written as `date '+%-d %B %Y'` prints it (for example `16 October 2026`).

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
pnpm --filter @cobweb/web verify:freshness
```

Expected: tests pass (shared 102, freshness 66, web 696, the other packages unchanged: dna 60, render 117, worker 282); the format check and the build pass; `verify:local` 365, `verify:chain` 12, `verify:storage` 15, `verify:sweep` 8, `verify:render` 22, `verify:deploy` 15, `verify:phases` 20, `verify:whitelist` 18, `verify:airdrop` 15 (with the gas line), `verify:settings` 17 and `verify:freshness` 16, each with `0 failed`.

- [ ] **Step 2: The start as Railway runs it**

The spec's section 10 start check: with Anvil's two variables, `NODE_ENV=production` and `COBWEB_TEST_CHAINS=1`, `/health` lists Anvil; without `COBWEB_TEST_CHAINS` it lists no chain. Each start ends with SIGTERM, which pnpm passes on to the server.

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
export $(grep -E '^(RPC_URL_31337|FACTORY_ADDRESS_31337)=' apps/web/.env.local | xargs)
NODE_ENV=production COBWEB_TEST_CHAINS=1 PORT=3100 pnpm --filter @cobweb/freshness start & pid=$!
for attempt in $(seq 1 50); do curl -s http://127.0.0.1:3100/health && break; sleep 0.2; done; echo
kill $pid; wait $pid
NODE_ENV=production PORT=3100 pnpm --filter @cobweb/freshness start & pid=$!
for attempt in $(seq 1 50); do curl -s http://127.0.0.1:3100/health && break; sleep 0.2; done; echo
kill $pid; wait $pid
```

Expected: the first start logs `The freshness server listens on port 3100, serving Anvil (31337).` and `/health` answers `{"status":"ok",...,"hot":0,"chains":[{"chainId":31337,"name":"Anvil","hot":0,"tier":null,"block":null,...}],"wallet":{"windows":0,"answered":0,"waiting":0}}`; the second logs `serving no chain.` and answers `"chains":[]`. Each `wait` returns 0 and port 3100 is free afterwards.

A step that does not behave as written is a defect: fix it in a new commit (or send it back to the task that owns it) before recording the landing.

- [ ] **Step 3: MASTER_PLAN**

Under Hosting, the decision follows the render pipeline's bullet. Phase 6's status line was "**Status:** not started."; the Phase 6 bullets and the Mint groups line "The freshness server may replace the read in Phase 6." stay as written.

In `docs/MASTER_PLAN.md`, replace:

```markdown
Railway stays for the freshness server.

## Open decisions
```

with:

```markdown
Railway stays for the freshness server.
- **The freshness server** (decided 16 October 2026; [specs/2026-10-16-freshness-server.md](specs/2026-10-16-freshness-server.md)). One Node service on Railway, run from its TypeScript source by Node 24, reads every chain whose `RPC_URL_<id>` and `FACTORY_ADDRESS_<id>` are set, over HTTP only: per chain and tick, one `eth_getLogs` and one multicall at one block over the collections requested in the last 10 minutes, every 1 s around a scheduled start, 2 s while a phase is live and 20 s otherwise. It serves the state and wallet endpoints with ETag and cache headers and a `degraded` flag, reads no database and never computes liveness. Its Railway settings live on the service, since Railway deprecated config as code. Manage keeps its own reads.

## Open decisions
```

In `docs/MASTER_PLAN.md`, replace:

```markdown
### Phase 6: Freshness server and mint page

**Status:** not started.
```

with:

```markdown
### Phase 6: Freshness server and mint page

**Status:** in progress. Freshness server (first sub-project of three: the freshness server; the mint page on live data; the indexer and the Overview, each with its own spec, plan and run) landed on <date>; see [specs/2026-10-16-freshness-server.md](specs/2026-10-16-freshness-server.md). What exists: `apps/freshness` run from its TypeScript source with no build step (`pnpm --filter @cobweb/freshness start`, on `PORT`, reading each chain whose `RPC_URL_<id>` and `FACTORY_ADDRESS_<id>` are set); the hot set (a collection joins on its first request once its chain's factory confirms it with `isCollection`, and leaves after 10 minutes without one); per chain and tick one `eth_getLogs` and one multicall at one block, at 1 s around a scheduled start, 2 s while a phase is live and 20 s otherwise; the extras (owner, royalty, base URI, transfer validator and level) on their logs and every 60 s; the state endpoint with a weak ETag that unchanged ticks keep, the cache headers and `degraded`; the wallet endpoint in 200 ms windows with up to 10 delegated vaults; `/health`; the readers in `@cobweb/shared` with the `clients` entry and the delegate registry's ABI; `COBWEB_TEST_CHAINS` with Robinhood Chain Testnet; `pnpm --filter @cobweb/web verify:freshness` with 16 checks. Known: the Railway service, its settings and variables are the owner's to set (the spec's section 12), and until the mainnet factories (Phase 7) it can serve only the test chains, while Phase 1 still owes the testnet factory deploy; Cloudflare in front (a 1 s edge TTL, `stale-while-revalidate`, `stale-if-error`, the weak ETags and 304s, a rate limit), the k6 run, alerts on `/health`, the second replica and the freshness origin in the CSP's `connect-src` are Phase 7's; on a testnet before launch: a wallet with whole-wallet and contract delegations reading its vaults, the registry's code on Berachain and Monad mainnet, `getCollectionSecurityPolicy` on the default validator, and each provider's `eth_getLogs` range limit and head behind a load balancer; Anvil has no `multicall3`, validator code or registry, so the verify reads in parallel, reads every level `none` and every wallet without vaults, and it moves Anvil's clock about 600 s ahead each run; one replica, so a restart empties the hot set and each collection's first poll waits for its first read (up to 2 s, then 503); a start scheduled less than one idle interval (20 s) ahead can be read up to that late; a node that keeps answering an old head reads as fresh, and `/health`'s lag shows it; reads are at the head, so a reorg can show a state and take it back; viem's HTTP transport waits up to 10 s and retries three times, so one slow RPC can stretch a tick, which `degraded` shows; there is no origin rate limit; the extras can be older than `block`; `royaltyInfo(1, 10000)` reads token 1's royalty, and levels 2 to 8 are answered as numbers. Next: the mint page on live data.
```

- [ ] **Step 4: The acceptance boxes and the landing note**

In section 13 of `docs/specs/2026-10-16-freshness-server.md`, change each `- [ ]` to `- [x]` whose criterion Steps 1 and 2 confirmed (all seven when everything passed). Then, after the list and before `## 14. Reconciliations with the rulings`, add one paragraph that starts `Checked on <date> on Anvil and local Supabase:` and records: the root checks with the shared, freshness and web test counts; the build; each verify script with its count (`verify:local`, `verify:chain`, `verify:storage`, `verify:sweep`, `verify:render`, `verify:deploy`, `verify:phases`, `verify:whitelist`, `verify:airdrop`, `verify:settings`, `verify:freshness`); the start as Railway runs it, with and without `COBWEB_TEST_CHAINS`, and its SIGTERM; the hosted steps still owed (the Railway service with its build command, start command, watch paths, health check, one replica and variables, `RAILPACK_NODE_VERSION=24`, and the Cloudflare rule in Phase 7, as section 12 lists them); and any defect found with the commit that fixed it.

- [ ] **Step 5: Commit**

```bash
cd /Users/kobs/Desktop/CobwebLaunchpad
git add docs/MASTER_PLAN.md docs/specs/2026-10-16-freshness-server.md
git commit -m "$(cat <<'EOF'
Record the freshness server's landing in MASTER_PLAN, with its Hosting decision, and in its spec

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012fcPR3AxkRXdB2iBkge8S6
EOF
)"
```

Expected: `git show --stat HEAD` lists the two docs only; `git diff HEAD~1 -- docs/PLAN.md` prints nothing.

---

## Self-review

**Spec coverage.** Sections 1 to 3 (the goal, the 23 decisions, the scope): Tasks 1 to 9 as Decision 1 orders them. Section 4 (no database): no task adds a migration, a type or a policy, and the server opens no connection. Section 5.1 (the five readers with their types and tests): Task 1. Section 5.2 (the `clients` entry): Task 1. Section 5.3 (the delegate registry's ABI): Task 6. Section 5.4 (the test chains and the switch): Task 2. Section 6.1 (the package and its start): Tasks 3 and 7. Section 6.2 (configuration): Task 3. Section 6.3 (the collection check and the hot set): Task 4, with the join wait in Task 7. Section 6.4 (the tick): Task 5. Section 6.5 (the log scan): Task 5. Section 6.6 (the tiers and `degraded`): Task 4 (the rules), Task 5 (the delay to the next tick) and Task 7 (`degraded` at the request). Section 6.7 (the state endpoint and the refusals): Task 7. Section 6.8 (the wallet endpoint and the vaults): Task 6, with its route in Task 7. Section 6.9 (`/health`): Tasks 5 and 7. Section 6.10 (what the mint page relies on): the answers Task 7 writes, proven by Task 8's checks. Section 7.1 (the moved imports): Task 1. Section 7.2 (the switch in the web app): Task 2. Section 7.3 (the scripts and the lint rule): Tasks 1 (the rule) and 8. Sections 8 and 9 (sample mode, stage rules): unchanged; no task touches them. Section 10 (testing): the unit tests in Tasks 1 to 7, `verify:freshness` in Task 8, the start as Railway runs it and the whole check list in Task 9. Section 11 (documentation): `CLAUDE.md` in Task 8, the two `.env.example` files in Tasks 2 and 3, MASTER_PLAN and the landing note in Task 9. Section 12 (owed and known): the `Known:` list Task 9 writes into MASTER_PLAN, and the hosted steps the landing note lists. Section 13 (acceptance): Task 9. Section 14's reconciliations: 1 (no `railway.json`; the settings on the service) Task 9's landing note; 2 (the `./clients` export over an unchanged `clients.ts`) Task 1; 3 (five readers move, `mintedIds` and `joinPhases` stay) Task 1; 4 (the tag without `readAt`, `block` and `blockTimestamp`, `degraded` inside) Task 7; 5 (the larger of three ticks and 10 s) Task 4; 6 (one `eth_getLogs`, the validator's event kept for the collection that uses it) Task 5; 7 (the state events with `FeesUpdated`, `MintQuotasAdded` left out) Task 5; 8 (one multicall is one `readEach`) Task 5; 9 (the join wait) Tasks 4 and 7; 10 (an unchanged head counts as a read) Task 5, Review Focus 1; 11 (no read is live; the idle chain's early wake) Task 4; 12 (the switch in the browser bundle and the wallet) Task 2; 13 (the collections deployed through the factory; the fixture's chain half) Task 8; 14 (empty rights) Task 6; 15 (the registry on Berachain and Monad) Task 9's `Known:` list; 16 (`/health` always 200; the lag) Tasks 5 and 7.

**Where this plan departs from the spec's letter.** `HotEntry` carries `joinedAt` beside the spec's fields (Decision 2). `chainReader(...).stop()` and `walletWindows(...).stop()` answer a promise rather than `void` (Decision 3). `marksOf` takes `readonly LogLike[]` rather than `Pick<Log, 'address' | 'topics'>[]`, which viem's tuple type for `topics` makes unusable with a node's plain array, and `logs.ts` adds `scanLogs` (Decision 7). `RefusalCode` adds `internal` for a 500 the spec's table does not list, and OPTIONS on `/health` answers the preflight as the `/v1` paths do (Decision 8). `server.ts` re-exports four names for the verify (Decision 9). `config.test.ts` and `chain-reader.test.ts` join the spec's list of tests (Decision 11). `render-deps.ts` loads the chain fixture for its settings (Decision 10).

**Placeholder scan.** No step says "add error handling" or "similar to Task N"; every code step shows a whole file or an exact anchor with its replacement. The only values filled at landing are Task 9's `<date>` and its landing paragraph, each defined where it is used.

**Type consistency.** `ChainGroup`, `ChainState`, `CollectionStateResult`, `chainStateOf`, `readEach`, `revertedRead`, `TRANSFER_LEVELS`, `TransferLevelValue`, `TransferLevelState`, `levelOf`, `RevealPointer`, `RevealTargets`, `pointerOf`, `hidesTestChains`, `DELEGATE_REGISTRY`, `DELEGATION_TYPE`, `delegateRegistryAbi`, `DEFAULT_PORT`, `servedChains`, `HOT_TTL_MS`, `JOIN_WAIT_MS`, `HotEntry`, `hotSet`, `HotSet`, `NEGATIVE_TTL_MS`, `NEGATIVE_MAX`, `collectionCheck`, `TIER_MS`, `Tier`, `tierOf`, `chainTier`, `nextDelayMs`, `degradedAfterMs`, `isDegraded`, `FeeWei`, `Extras`, `CollectionRead`, `EXTRAS_EVERY_MS`, `chainReader`, `MAX_LOG_RANGE`, `STATE_EVENTS`, `EXTRAS_EVENTS`, `watchedTopics`, `LogLike`, `ScanTarget`, `marksOf`, `GetLogs`, `Scan`, `scanLogs`, `ChainHealth`, `HealthBody`, `errorName`, `errorLine`, `MAX_VAULTS`, `Delegation`, `vaultsOf`, `WINDOW_MS`, `WINDOW_MAX`, `QUEUE_MAX`, `REGISTRY_RECHECK_MS`, `QuotaBody`, `WalletBody`, `walletWindows`, `StateBody`, `stateBody`, `etagOf`, `etagMatches`, `RefusalCode`, `Route`, `Answer`, `routeOf`, `refusal`, `stateAnswer`, `walletAnswer`, `healthAnswer`, `PREFLIGHT`, `FreshnessOptions`, `Freshness`, `startFreshness`, `refuseRemote` and `localChainConfig` are spelled the same in every task that uses them.

**Review Focus.** Five lines, each with its test in the owning task: an older head (Task 5, `chain-reader.test.ts`), a null call among several collections (Task 5, `chain-reader.test.ts`), a failed `eth_getLogs` (Task 5, `logs.test.ts`), one wallet across two collections (Task 6, `wallet.test.ts`) and a wake during a tick (Task 5, `chain-reader.test.ts`). Each was checked against a mutation of the rule it guards (the head guard turned off, the null check narrowed to the state call, the scan's failure rethrown, the listing read per pair, the running guard dropped): each mutation failed exactly its own test and no other.

**Checked while planning.** The code was written first in a scratch copy of `c29217a` outside the repository (its own git, one commit per task), and every code block here is taken from those commits by a script; the anchored edits were applied to that copy first and checked against its commits. The counts: the shared package 80 tests in 7 files before, 95 in 12 after Task 1, 99 after Task 2, 102 after Task 6; the web app 705 in 74 before, 696 in 73 from Task 1 on; the freshness package 4 tests after Task 3, 24 after Task 4, 39 after Task 5, 51 after Task 6 and 66 in 10 files after Task 7; dna 60, render 117 and worker 282 unchanged; `pnpm typecheck`, `lint`, `test`, `format:check` and `build` pass. `verify:freshness` passed its 16 checks in about 36 s, and with it `verify:local` 365, `verify:chain` 12, `verify:storage` 15, `verify:sweep` 8, `verify:render` 22, `verify:deploy` 15, `verify:phases` 20, `verify:whitelist` 18, `verify:airdrop` 15 (the 500-wallet batch at 26,880,045 gas) and `verify:settings` 17, each with `0 failed`. The start as Railway runs it served Anvil with `NODE_ENV=production COBWEB_TEST_CHAINS=1` and no chain without the switch, and pnpm passed SIGTERM on to a clean close; `dev` read an `apps/freshness/.env` that git ignored. Then the plan itself was applied to a second fresh copy of `c29217a` by a script that performs each "Create", "Replace the whole of", "In ..., replace: ... with:" and "At the end of ..., append:" literally, refuses an anchor found other than once, runs each "Run:" line and bash block through zsh (the shell these steps run in), and checks that Prettier changes none of a commit's files: every anchor was found exactly once, each "see it fail" step failed as its Expected line says, each commit block ran green with Prettier changing nothing, and after each of Tasks 1 to 8 the tree matched the scratch commit file for file. Task 9's check list and start ran there with the counts above, and its two MASTER_PLAN anchors were each found once. The local database ends as it was found: the rows of `collections`, `deployments`, `mint_groups`, `whitelist_entries`, `airdrops`, `withdrawals`, `render_jobs`, `tokens`, `uploads` and the users (9, 6, 12, 2,002, 3, 1, 7, 41, 128 and 6) matched a snapshot taken before the first script. Anvil keeps running on port 8545 with its factory; the planning runs left their verify collections on it (block 109 then, above 400 now), and since each `verify:freshness` run mines blocks at T-1 and T, 600 s after the latest block, its clock now runs about 40 minutes ahead of the wall clock, which the other scripts, reading chain time, do not mind. Not run while planning: anything hosted (Railway, Cloudflare, a testnet), so the delegations of a real registry, the default validator's level getter and the providers' log limits stay owed (spec section 12).
