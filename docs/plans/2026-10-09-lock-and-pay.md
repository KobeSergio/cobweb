# Lock and Pay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Lock and upload real up to the point where rendering starts: review the stored art, lock it, quote the fee from the factory's rate, pay `payForArt` from the creator's wallet, verify the payment from the receipt on the server and mark the job paid; unlock while unpaid; lock a deferred collection's placeholder at no cost; sweep unrecorded uploads.

**Architecture:** `packages/shared` gains the chain list, the factory ABI copied from the Foundry build, the on-chain job id and viem public clients. One migration adds `render_jobs.onchain_job_id` and `token_list` and five `security definer` functions (`art_lock`, `art_unlock`, `art_lock_placeholder`, `art_requote`, `art_record_payment`), checked by `verify:local` section 9g. A lock core in `apps/web/src/lib/art/lock-core.ts` composes the pure pieces (`buildAssetTokenList`, `matchArtPaid`, `toRenderJob`, the review) with Supabase and viem; the server actions in `apps/web/src/app/actions/lock.ts` wrap it with the session and ownership check (the three chain-derived writes go through a server-only service client), and `verify:chain` runs the same core against Anvil. The screen keeps its look: the review, lock, pay (wagmi simulate, write, wait, then the server's confirmation polled) and unlock are real, rendering stays simulated behind `render-sim.ts`, and sample mode keeps its simulated actions.

**Tech Stack:** Next 16 app router (server components, server actions), React 19 client components, wagmi 2 actions with RainbowKit, viem 2.57, Supabase Postgres 15 with PL/pgSQL `security definer` functions, `supabase gen types typescript --local`, zod 4, Foundry (`forge script`, Anvil), the AWS S3 SDK against local Supabase storage, Vitest 5 in the Node environment (no jsdom; React is never rendered in a test), node 26 type stripping for scripts.

**Spec:** [../specs/2026-10-09-lock-and-pay.md](../specs/2026-10-09-lock-and-pay.md)

## Global Constraints

- The spec is the binding authority. Where this plan decides a detail the spec leaves open, the task says so in a line that starts with "Decision:".
- Approach A (spec section 2): lock, unlock, placeholder lock, requote and payment recording are `security definer` functions; the server verifies the receipt with viem before calling `art_record_payment`.
- The three functions whose arguments come from the chain or a verified receipt, `art_lock` (fee, chain, payer), `art_requote` (fee) and `art_record_payment` (tx hash, payer, amount), are executable by `service_role` only (`revoke all ... from public, anon, authenticated`, `grant execute ... to service_role`) and take `p_owner uuid`, which must equal `collections.owner_id` ("collection not found", 42501, otherwise). `art_unlock` and `art_lock_placeholder` take no chain-derived arguments and stay granted to `authenticated`, locking on `owner_id = (select auth.uid())`.
- The app holds the service-role key server-side only: `SUPABASE_SERVICE_ROLE_KEY` (never `NEXT_PUBLIC_`), read by `apps/web/src/lib/supabase/service.ts` (`import 'server-only'`, no session persistence), which is used by exactly those three calls. The actions still check the session and read the collection with the creator's RLS client first, and pass `user.id` as `p_owner`. Every other read and write stays under the creator's session.
- Every definer function: `language plpgsql`, `security definer`, `set search_path = ''`; it first locks the owner's collections row through `private.lock_owned_collection(p_collection_id, owner)` (`for no key update`), raises `collection not found` with errcode `42501` when nothing matched, and filters every later statement on that collection id.
- Database sentences are raised exactly as written in Task 2 with the SQLSTATE given there; `lockWriteError` (Task 4) passes them through and maps everything else to "That change could not be saved. Reload the page and try again."
- Wei never passes through a JS number: reads cast numeric columns with `::text`, writes send decimal strings (cast `as unknown as number` because the generated types call numeric `number`), and the browser and server compute with `bigint`.
- Every lock action calls `ownedCollection(collectionId)` (which calls `getVerifiedUser`), validates input with zod, returns `ActionResult<T>` (`{ ok: true; data: T } | { ok: false; error: string }`) and never calls `revalidatePath`; the screen calls `router.refresh()` itself.
- The pay step follows CLAUDE.md rule 2: `simulateContract`, then `writeContract(simulated.request)` with the request unchanged, then `waitForTransactionReceipt`, then `confirmArtPayment` every 3 seconds for up to 2 minutes while the server answers "The payment has not been confirmed on chain yet." The wallet opens only after the simulation passed.
- The payer and the amount are never taken from the browser: `confirmArtPayment` reads both from the receipt's `ArtPaid` log, decoded with viem against the factory ABI, filtered on the factory address and the job id topic.
- Scripts are standalone: Supabase config from the environment or `supabase status -o env`; `RPC_URL_31337` and `FACTORY_ADDRESS_31337` from the environment or `apps/web/.env.local`; they refuse non-local endpoints, never print a key, run under `node --conditions=react-server`, and import with relative paths that carry `.ts` extensions.
- After adding or changing a migration: `supabase db reset`, then `supabase seed buckets`, then regenerate `apps/web/src/lib/database.types.ts`, then `pnpm --filter @cobweb/web verify:local`. Never run any of this against anything but localhost.
- Anything that depends on a deployed public chain is configuration only (`RPC_URL_<id>`, `FACTORY_ADDRESS_<id>`); everything is proven on Anvil (31337).
- Implementers never use `rm` and never use `git commit --amend`. To drop a tracked file use `git rm`; to fix a commit, make a new one.
- Code style: Prettier (no semicolons, single quotes, 110 columns), TypeScript strict with `noUncheckedIndexedAccess` and `verbatimModuleSyntax` (type-only imports use `import type`). SQL is hand-formatted, two-space indent. Solidity follows `forge fmt`.
- Copy: plain sentences, no em or en dashes, "Whitelist" never "Allowlist", the product is Cobweb. UI from `@cobweb/ui` components only; colours from tokens. Wallet and chain stack: RainbowKit, wagmi in components, viem for every chain call; no ethers.
- `'use server'` files export async functions only; types, schemas and constants live in `apps/web/src/lib/`.
- `legacy/` is reference only: never import from it, never copy its ABIs. The factory ABI comes from `contracts/out` through `pnpm --filter @cobweb/shared abi`.
- Commit messages are one imperative sentence with no prefix, and end with exactly these two lines:

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bcHX4HZG5YGWhxjGuiWos
```

- Tests: `pnpm --filter @cobweb/web exec vitest run <file>` or `pnpm --filter @cobweb/shared exec vitest run <file>` for one file; `pnpm typecheck && pnpm lint && pnpm test` at the root before every commit.

## Review Focus

Inputs the spec implies but no task's tests would otherwise exercise, most likely to bite first. Each is pinned to the task that owns it, with its test written there.

1. A payment that was sent and mined, but the tab closed or the RPC failed before the server recorded it: the job stays `payment_due`, and paying again reverts in the simulation with `JobAlreadyPaid`, so the creator is stuck. Expected: the browser keeps the sent hash per job, and the pay step offers "Check the payment" on the next visit instead of a second payment; "Try again" after a timeout re-checks the same hash. Pinned by the `pendingPayment` and `retryHash` tests in Task 6, step 1.
2. A payment mined minutes before the quote's 24 hours run out and confirmed after: a strict expiry would refuse a payment that matched the quote. Expected: it is recorded within an hour after expiry, and refused after that. Pinned by the grace checks in `verify:local` 9g, Task 2, step 1.
3. Wei amounts above 2^53 (10,000 tokens at 0.000025 ETH is 2.5 x 10^17 wei): PostgREST returns numeric as a JSON number, so a plain read rounds the quote and a correct payment can read as short. Expected: every amount survives to the last wei. Pinned by the `toRenderJob` test with `250000000000000001` and the `JOB_COLUMNS` cast test in Task 3, step 1.
4. The same confirmation answered twice (the browser polled, the first call recorded the payment, its response was lost): the second call says "This payment was already used." Expected: the screen reloads the job, sees its own hash and shows success. Pinned by the `verifyPayment` test in Task 6, step 1.
5. Locking from a wallet on a chain with no factory configured (for example Base before deploy), or a factory whose rate is still 0: a zero quote would make a free `paid` job. Expected: "This chain is not ready for payments yet." and nothing locked. Pinned by the `feeReady` test in Task 3, step 1 and its use in `lockCore` in Task 4, step 3.

## File map

| Path                                                                                    | Task | Responsibility                                                                      |
| --------------------------------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------- |
| `packages/shared/src/chains.ts`                                                         | 1    | Launch and test chains, env variable names, `chainById`, `factoryAddress`, `rpcUrl` |
| `packages/shared/src/job-id.ts`                                                         | 1    | `onchainJobId`, `jobIdFromOnchain`                                                  |
| `packages/shared/src/factory-abi.ts`                                                    | 1    | Generated: the five factory entries the app uses                                    |
| `packages/shared/src/clients.ts`                                                        | 1    | `publicClientFor(chainId)` (server code only)                                       |
| `packages/shared/scripts/copy-abi.ts`                                                   | 1    | Copies the ABI entries from `contracts/out`                                         |
| `contracts/script/DeployLocal.s.sol`                                                    | 1    | Deploys the factory to Anvil with a known art fee                                   |
| `apps/web/scripts/chain-local.ts`                                                       | 1    | `chain:local`: Anvil, deploy, fund the dev wallet, print the env lines              |
| `apps/web/scripts/dev-wallet/{signer.mjs,inject.js}`                                    | 1    | The dev wallet sends transactions and forwards reads on 31337 only                  |
| `supabase/migrations/20261009020000_lock_and_pay.sql`                                   | 2    | The columns, the payment index, the five definer functions                          |
| `apps/web/scripts/verify-local.ts`                                                      | 2    | Section 9g                                                                          |
| `apps/web/src/lib/art/asset-tokens.ts`                                                  | 3    | `buildAssetTokenList`, `hashAssetTokenList`, `assetListProblems`                    |
| `apps/web/src/lib/art/quote.ts`                                                         | 3    | `quoteTotalWei`, `quoteExpired`, `feeReady`                                         |
| `apps/web/src/lib/chain/art-paid.ts`                                                    | 3    | `matchArtPaid`                                                                      |
| `apps/web/src/lib/art/render-job.ts`                                                    | 3    | `JobRow`, `JOB_COLUMNS`, `toRenderJob`, `pendingJob`, `jobBase`                     |
| `apps/web/src/lib/art/lock-collection.ts`                                               | 3    | `readLockCollection`, `LockCollection`, `LockClient`                                |
| `apps/web/src/lib/art/owned.ts`                                                         | 3    | gains `ownedCollection`                                                             |
| `apps/web/src/lib/art/read-rows.ts`                                                     | 4    | `readArtRows(supabase, id)`, shared by the Art pages and the lock                   |
| `apps/web/src/lib/art/lock-review.ts`                                                   | 4    | `LockList`, `ReviewData`, `reviewData`, `lockRefusal`, `reviewChecks`               |
| `apps/web/src/lib/art/lock-core.ts`                                                     | 4    | The lock, quote, confirm and read cores, used by the actions and `verify:chain`     |
| `apps/web/src/lib/art/lock-schemas.ts`, `lock-write.ts`                                 | 4    | Input rules; `lockWrite`                                                            |
| `apps/web/src/app/actions/lock.ts`                                                      | 4    | The seven server actions                                                            |
| `apps/web/scripts/resolve-ts.mjs`, `verify-chain.ts`                                    | 5    | The resolve hook; `verify:chain`                                                    |
| `apps/web/src/components/upload/*`                                                      | 6    | The screen on real data; `pay-machine.ts`, `upload-actions.ts`, `render-sim.ts`     |
| `apps/web/src/lib/chain/chain-view.ts`, `apps/web/src/lib/steps.ts`                     | 6    | Chain display data; Lock and upload opens on a draft                                |
| `apps/web/src/lib/storage/sweep.ts`, `apps/web/scripts/{sweep-uploads,verify-sweep}.ts` | 7    | The sweep and its check                                                             |
| `docs/MASTER_PLAN.md`, `CLAUDE.md`, specs                                               | 8    | Phase 3 complete, Phase 4 next, commands, seams, acceptance ticks                   |

---

### Task 1: Chain plumbing in `packages/shared`, the Anvil deploy and the dev wallet's transactions

**Files:**

- Modify: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/src/index.ts`
- Create: `packages/shared/src/chains.ts`, `packages/shared/src/job-id.ts`, `packages/shared/src/clients.ts`, `packages/shared/scripts/copy-abi.ts`
- Create (generated): `packages/shared/src/factory-abi.ts`
- Test: `packages/shared/src/chains.test.ts`, `packages/shared/src/job-id.test.ts`, `packages/shared/src/factory-abi.test.ts`
- Create: `contracts/script/DeployLocal.s.sol`, `apps/web/scripts/chain-local.ts`
- Modify: `apps/web/package.json` (dependency on `@cobweb/shared`, script `chain:local`), `apps/web/next.config.ts:5` (transpile `@cobweb/shared`), `apps/web/src/lib/wagmi.ts`, `apps/web/.env.example`, `.gitignore`
- Modify: `apps/web/scripts/dev-wallet/signer.mjs`, `apps/web/scripts/dev-wallet/inject.js`, `apps/web/scripts/dev-wallet/README.md`

**Interfaces:**

- Consumes: `CobwebFactory` (`payForArt(bytes32)`, `artFeePerToken()`, `jobPayment(bytes32,address)`, `treasury()`, `setArtFeePerToken(uint256)`, `approveCreationCode(bytes32)`, event `ArtPaid(bytes32 indexed jobId, address indexed payer, uint256 amount)`); viem chains `mainnet`, `arbitrum`, `base`, `berachain`, `monad`, `robinhood` (4663), `sepolia`, `anvil`.
- Produces (all exported from `@cobweb/shared`):
  - `type ChainConfig = { id: number; name: string; nativeSymbol: string; explorerUrl: string; rpcEnv: string; factoryEnv: string; testnet: boolean; viem: Chain }`
  - `LAUNCH_CHAINS: readonly ChainConfig[]`, `TEST_CHAINS: readonly ChainConfig[]`
  - `availableChains(production?: boolean): readonly ChainConfig[]`
  - `chainById(id: number, production?: boolean): ChainConfig | undefined`
  - `factoryAddress(id: number, env?: Record<string, string | undefined>, production?: boolean): Address` (throws "The factory address for chain <id> is not configured.")
  - `rpcUrl(id: number, env?: Record<string, string | undefined>, production?: boolean): string` (throws "The RPC URL for chain <id> is not configured.")
  - `isLocalUrl(url: string): boolean`
  - `onchainJobId(uuid: string): Hex`, `jobIdFromOnchain(hex: string): string`
  - `factoryAbi` (`as const`: `payForArt`, `artFeePerToken`, `jobPayment`, `treasury`, `ArtPaid`)
  - `publicClientFor(chainId: number): PublicClient`
  - Commands `pnpm --filter @cobweb/shared abi` and `pnpm --filter @cobweb/web chain:local`
  - Dev wallet signer: `POST /send { chainId, tx }` returns `{ hash }`; `POST /rpc { chainId, method, params }` returns `{ result }`; both refuse any chain but 31337.

Decision: each chain entry also carries `nativeSymbol`, `explorerUrl`, `testnet` and the viem chain beside the spec's `{ id, name, rpcEnv, factoryEnv }`, so the clients and the screen read one list. Anvil has no explorer, so its `explorerUrl` is `''` and the screen shows no explorer link there.

Decision: `factoryAddress` and `rpcUrl` take the environment and the production flag as optional parameters (defaulting to `process.env` and `NODE_ENV === 'production'`), so they are tested without touching the real environment.

Decision: `DeployLocal.s.sol` broadcasts from Anvil's first account unlocked (`--unlocked --sender`), so no private key is passed, stored or printed; `chain:local` reads the factory address from Foundry's broadcast file. The script also approves the collection's creation code, as `Deploy.s.sol` does, so Phase 5 can deploy on the same chain.

Decision: the dev wallet sends transactions and forwards reads only on chain 31337, through two new signer endpoints; on any other chain it refuses with code 4200 as before. `chain:local` funds the signer's address with 100 ETH when the signer is running.

- [ ] **Step 1: Write the failing tests**

`packages/shared/src/chains.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { availableChains, chainById, factoryAddress, isLocalUrl, LAUNCH_CHAINS, rpcUrl } from './chains.ts'

const LAUNCH_IDS = [1, 42161, 8453, 80094, 143, 4663]

describe('the chain list', () => {
  it('names the six launch chains and adds Sepolia and Anvil outside production', () => {
    expect(LAUNCH_CHAINS.map((chain) => chain.id)).toEqual(LAUNCH_IDS)
    expect(availableChains(true).map((chain) => chain.id)).toEqual(LAUNCH_IDS)
    expect(availableChains(false).map((chain) => chain.id)).toEqual([...LAUNCH_IDS, 11155111, 31337])
    expect(chainById(31337, true)).toBeUndefined()
    expect(chainById(31337, false)?.name).toBe('Anvil')
    expect(chainById(10, false)).toBeUndefined()
  })

  it('names the environment variables of each chain', () => {
    expect(chainById(8453, true)).toMatchObject({
      name: 'Base',
      nativeSymbol: 'ETH',
      rpcEnv: 'RPC_URL_8453',
      factoryEnv: 'FACTORY_ADDRESS_8453',
      testnet: false,
    })
    expect(chainById(80094, true)?.nativeSymbol).toBe('BERA')
    expect(chainById(31337, false)).toMatchObject({ explorerUrl: '', testnet: true })
  })
})

describe('factoryAddress and rpcUrl', () => {
  const env = {
    FACTORY_ADDRESS_31337: '0x5fbdb2315678afecb367f032d93f642f64180aa3',
    RPC_URL_31337: 'http://127.0.0.1:8545',
  }

  it('reads the variables and checksums the address', () => {
    expect(factoryAddress(31337, env, false)).toBe('0x5FbDB2315678afecb367f032d93F642f64180aa3')
    expect(rpcUrl(31337, env, false)).toBe('http://127.0.0.1:8545')
  })

  it('throws a sentence when a variable is unset, malformed, or the chain is not available', () => {
    expect(() => factoryAddress(8453, env, false)).toThrow(
      'The factory address for chain 8453 is not configured.',
    )
    expect(() => factoryAddress(31337, { FACTORY_ADDRESS_31337: 'nope' }, false)).toThrow(
      'The factory address for chain 31337 is not configured.',
    )
    expect(() => factoryAddress(31337, env, true)).toThrow(
      'The factory address for chain 31337 is not configured.',
    )
    expect(() => rpcUrl(10, env, false)).toThrow('The RPC URL for chain 10 is not configured.')
  })
})

describe('isLocalUrl', () => {
  it('accepts loopback hosts only', () => {
    expect(isLocalUrl('http://127.0.0.1:8545')).toBe(true)
    expect(isLocalUrl('http://localhost:54321')).toBe(true)
    expect(isLocalUrl('http://[::1]:8545')).toBe(true)
    expect(isLocalUrl('https://mainnet.example.com')).toBe(false)
    expect(isLocalUrl('not a url')).toBe(false)
  })
})
```

`packages/shared/src/job-id.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { jobIdFromOnchain, onchainJobId } from './job-id.ts'

const JOB = '0f4a0f3e-2f5e-4e3a-9d1c-1b2c3d4e5f60'

describe('onchainJobId', () => {
  it('puts the 16 uuid bytes first and pads with 16 zero bytes, as art_lock stores it', () => {
    expect(onchainJobId(JOB)).toBe(`0x0f4a0f3e2f5e4e3a9d1c1b2c3d4e5f60${'0'.repeat(32)}`)
    expect(onchainJobId(JOB.toUpperCase())).toBe(onchainJobId(JOB))
  })

  it('round-trips, whatever the case of the hex', () => {
    expect(jobIdFromOnchain(onchainJobId(JOB))).toBe(JOB)
    expect(jobIdFromOnchain(`0x${onchainJobId(JOB).slice(2).toUpperCase()}`)).toBe(JOB)
  })

  it('refuses what is not a uuid or not a Cobweb job id', () => {
    expect(() => onchainJobId('job-1')).toThrow('A job id is a uuid.')
    expect(() => jobIdFromOnchain(`0x${'1'.repeat(64)}`)).toThrow('Not a Cobweb job id.')
    expect(() => jobIdFromOnchain('0x1234')).toThrow('Not a Cobweb job id.')
  })
})
```

`packages/shared/src/factory-abi.test.ts`:

```ts
import { getAbiItem, toEventSelector, toFunctionSelector } from 'viem'
import { describe, expect, it } from 'vitest'
import { factoryAbi } from './factory-abi.ts'

describe('factoryAbi', () => {
  it('holds the five entries the app uses, in order', () => {
    expect(factoryAbi.map((entry) => `${entry.type} ${entry.name}`)).toEqual([
      'function payForArt',
      'function artFeePerToken',
      'function jobPayment',
      'function treasury',
      'event ArtPaid',
    ])
  })

  it('matches the contract signatures', () => {
    expect(toFunctionSelector(getAbiItem({ abi: factoryAbi, name: 'payForArt' }))).toBe(
      toFunctionSelector('payForArt(bytes32)'),
    )
    expect(toFunctionSelector(getAbiItem({ abi: factoryAbi, name: 'jobPayment' }))).toBe(
      toFunctionSelector('jobPayment(bytes32,address)'),
    )
    expect(toEventSelector(getAbiItem({ abi: factoryAbi, name: 'ArtPaid' }))).toBe(
      toEventSelector('ArtPaid(bytes32,address,uint256)'),
    )
  })
})
```

`packages/shared/package.json` (whole file):

```json
{
  "name": "@cobweb/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "abi": "node scripts/copy-abi.ts",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "test": "vitest run --passWithNoTests"
  },
  "dependencies": {
    "viem": "^2.57.2"
  }
}
```

`packages/shared/tsconfig.json` (whole file):

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["node"], "allowImportingTsExtensions": true },
  "include": ["src"]
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm install && pnpm --filter @cobweb/shared exec vitest run`
Expected: FAIL in all three files: the modules `./chains.ts`, `./job-id.ts` and `./factory-abi.ts` do not exist yet.

- [ ] **Step 3: Implement the shared modules and generate the ABI**

`packages/shared/src/chains.ts`:

```ts
import { getAddress, isAddress, type Address } from 'viem'
import { anvil, arbitrum, base, berachain, mainnet, monad, robinhood, sepolia, type Chain } from 'viem/chains'

/**
 * The chains Cobweb runs on (CLAUDE.md, launch chains) plus Sepolia and a local Anvil chain outside
 * production. Each names the environment variables that configure it: `RPC_URL_<id>` (server only)
 * and `FACTORY_ADDRESS_<id>`. A chain is ready for payments when both are set.
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
  viem: Chain
}

type Env = Record<string, string | undefined>

function entry(chain: Chain, name: string, testnet: boolean): ChainConfig {
  return {
    id: chain.id,
    name,
    nativeSymbol: chain.nativeCurrency.symbol,
    explorerUrl: chain.blockExplorers?.default.url ?? '',
    rpcEnv: `RPC_URL_${chain.id}`,
    factoryEnv: `FACTORY_ADDRESS_${chain.id}`,
    testnet,
    viem: chain,
  }
}

export const LAUNCH_CHAINS: readonly ChainConfig[] = [
  entry(mainnet, 'Ethereum', false),
  entry(arbitrum, 'Arbitrum', false),
  entry(base, 'Base', false),
  entry(berachain, 'Berachain', false),
  entry(monad, 'Monad', false),
  entry(robinhood, 'Robinhood Chain', false),
]

export const TEST_CHAINS: readonly ChainConfig[] = [
  entry(sepolia, 'Sepolia', true),
  entry(anvil, 'Anvil', true),
]

const isProduction = () => process.env.NODE_ENV === 'production'

export function availableChains(production = isProduction()): readonly ChainConfig[] {
  return production ? LAUNCH_CHAINS : [...LAUNCH_CHAINS, ...TEST_CHAINS]
}

export function chainById(id: number, production = isProduction()): ChainConfig | undefined {
  return availableChains(production).find((chain) => chain.id === id)
}

/** The factory on a chain, checksummed. Throws a sentence when the chain or its variable is not set. */
export function factoryAddress(id: number, env: Env = process.env, production = isProduction()): Address {
  const chain = chainById(id, production)
  const value = chain ? env[chain.factoryEnv] : undefined
  if (!value || !isAddress(value, { strict: false }))
    throw new Error(`The factory address for chain ${id} is not configured.`)
  return getAddress(value)
}

/** The chain's RPC URL, for server code. Throws a sentence when the chain or its variable is not set. */
export function rpcUrl(id: number, env: Env = process.env, production = isProduction()): string {
  const chain = chainById(id, production)
  const value = chain ? env[chain.rpcEnv] : undefined
  if (!value) throw new Error(`The RPC URL for chain ${id} is not configured.`)
  return value
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

`packages/shared/src/job-id.ts`:

```ts
import type { Hex } from 'viem'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ONCHAIN = /^0x[0-9a-f]{32}0{32}$/

/**
 * The factory's `bytes32` job id for a render job: the 16 bytes of the row's uuid, left-aligned in
 * 32 bytes. The database derives the same value (`render_jobs.onchain_job_id`).
 */
export function onchainJobId(uuid: string): Hex {
  if (!UUID.test(uuid)) throw new Error('A job id is a uuid.')
  return `0x${uuid.replace(/-/g, '').toLowerCase()}${'0'.repeat(32)}`
}

/** The render job's uuid from its on-chain id. */
export function jobIdFromOnchain(hex: string): string {
  const value = hex.toLowerCase()
  if (!ONCHAIN.test(value)) throw new Error('Not a Cobweb job id.')
  const h = value.slice(2, 34)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
```

`packages/shared/src/clients.ts`:

```ts
import { createPublicClient, http, type PublicClient } from 'viem'
import { chainById, rpcUrl } from './chains.ts'

const clients = new Map<number, PublicClient>()

/** A viem public client for a chain over its configured RPC URL. Server code only: the URL is a secret. */
export function publicClientFor(chainId: number): PublicClient {
  const known = clients.get(chainId)
  if (known) return known
  const chain = chainById(chainId)
  if (!chain) throw new Error(`Chain ${chainId} is not supported.`)
  const client = createPublicClient({ chain: chain.viem, transport: http(rpcUrl(chainId)) })
  clients.set(chainId, client)
  return client
}
```

`packages/shared/src/index.ts` (whole file):

```ts
export * from './chains.ts'
export * from './clients.ts'
export * from './factory-abi.ts'
export * from './job-id.ts'
```

`packages/shared/scripts/copy-abi.ts`:

```ts
// Copies the factory ABI entries the app uses from the Foundry build into src/factory-abi.ts, so
// the app's ABI always comes from contracts/out (never from legacy/). Run `forge build` in
// contracts/ first.
//
//   pnpm --filter @cobweb/shared abi

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../../..')
const artifact = resolve(repoRoot, 'contracts/out/CobwebFactory.sol/CobwebFactory.json')
const out = resolve(here, '../src/factory-abi.ts')
const WANTED = ['payForArt', 'artFeePerToken', 'jobPayment', 'treasury', 'ArtPaid']

type AbiEntry = { type: string; name?: string }
const { abi } = JSON.parse(readFileSync(artifact, 'utf8')) as { abi: AbiEntry[] }
const entries = WANTED.map((name) => {
  const found = abi.find(
    (entry) => entry.name === name && (entry.type === 'function' || entry.type === 'event'),
  )
  if (!found) throw new Error(`${name} is not in the factory's ABI. Run forge build in contracts/ first.`)
  return found
})

writeFileSync(
  out,
  [
    '// Generated by `pnpm --filter @cobweb/shared abi` from contracts/out/CobwebFactory.sol/CobwebFactory.json.',
    '// Do not edit by hand: change the contract, run forge build, then run the script again.',
    `export const factoryAbi = ${JSON.stringify(entries, null, 2)} as const`,
    '',
  ].join('\n'),
)
execFileSync('pnpm', ['exec', 'prettier', '--write', out], { cwd: repoRoot, stdio: 'ignore' })
console.log(`Wrote ${entries.length} entries to packages/shared/src/factory-abi.ts`)
```

Generate the ABI file:

```bash
cd contracts && forge build && cd ..
pnpm --filter @cobweb/shared abi
```

Expected: `Wrote 5 entries to packages/shared/src/factory-abi.ts`; the file starts with the two generated comment lines and `export const factoryAbi = [`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @cobweb/shared exec vitest run && pnpm --filter @cobweb/shared typecheck`
Expected: PASS, 3 files; typecheck clean.

- [ ] **Step 5: The Anvil deploy script, `chain:local` and the Anvil chain in wagmi**

`contracts/script/DeployLocal.s.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {CobwebFactory} from "../src/CobwebFactory.sol";
import {CobwebCollection} from "../src/CobwebCollection.sol";

/**
 * @notice Deploys the factory to a local Anvil chain for development, verify:chain and the browser walk.
 * @dev The broadcasting account (Anvil's first account, unlocked) is admin and treasury. The art fee
 *      stands in for $0.11 per token. `pnpm --filter @cobweb/web chain:local` runs:
 *      forge script script/DeployLocal.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --unlocked --sender <first account>
 */
contract DeployLocal is Script {
    uint256 internal constant ART_FEE_PER_TOKEN = 25_000_000_000_000;

    function run() external returns (CobwebFactory factory) {
        require(block.chainid == 31337, "DeployLocal runs on Anvil (31337) only");
        vm.startBroadcast();
        (VmSafe.CallerMode mode, address deployer,) = vm.readCallers();
        require(mode == VmSafe.CallerMode.RecurrentBroadcast, "Run with --broadcast");
        factory = new CobwebFactory(deployer, deployer);
        factory.approveCreationCode(keccak256(type(CobwebCollection).creationCode));
        factory.setArtFeePerToken(ART_FEE_PER_TOKEN);
        vm.stopBroadcast();
        console2.log("CobwebFactory:", address(factory));
    }
}
```

`apps/web/scripts/chain-local.ts`:

```ts
// Starts a local Anvil chain on 127.0.0.1:8545 if none is running, deploys the Cobweb factory to it
// (contracts/script/DeployLocal.s.sol), funds the dev wallet signer when it is running, and prints
// the two lines for apps/web/.env.local. Development only. Uses Anvil's first account unlocked, so
// no private key is passed or printed.
//
//   pnpm --filter @cobweb/web chain:local

import { execFileSync, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createTestClient, getAddress, http, isAddress, parseEther, publicActions } from 'viem'
import { anvil } from 'viem/chains'

const RPC = 'http://127.0.0.1:8545'
/** Anvil's first default account (a public address; the chain unlocks it). */
const FIRST_ACCOUNT = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const SIGNER = 'http://127.0.0.1:8787/address'

const contracts = resolve(dirname(fileURLToPath(import.meta.url)), '../../../contracts')
const client = createTestClient({ chain: anvil, mode: 'anvil', transport: http(RPC) }).extend(publicActions)

async function running(): Promise<boolean> {
  try {
    return (await client.getChainId()) === 31337
  } catch {
    return false
  }
}

if (await running()) {
  console.log('Anvil is already running on 127.0.0.1:8545.')
} else {
  const child = spawn('anvil', ['--port', '8545', '--chain-id', '31337', '--silent'], {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
  for (let attempt = 0; attempt < 50 && !(await running()); attempt++)
    await new Promise((done) => setTimeout(done, 200))
  if (!(await running())) {
    console.error('Anvil did not start on port 8545. Install Foundry (foundryup) and try again.')
    process.exit(1)
  }
  console.log('Started Anvil on 127.0.0.1:8545.')
}

execFileSync(
  'forge',
  [
    'script',
    'script/DeployLocal.s.sol',
    '--rpc-url',
    RPC,
    '--broadcast',
    '--unlocked',
    '--sender',
    FIRST_ACCOUNT,
  ],
  { cwd: contracts, stdio: ['ignore', 'ignore', 'inherit'] },
)

type Broadcast = {
  transactions: { transactionType: string; contractName: string | null; contractAddress: string | null }[]
}
const broadcast = JSON.parse(
  readFileSync(resolve(contracts, 'broadcast/DeployLocal.s.sol/31337/run-latest.json'), 'utf8'),
) as Broadcast
const factory = broadcast.transactions.find(
  (tx) => tx.transactionType === 'CREATE' && tx.contractName === 'CobwebFactory',
)?.contractAddress
if (!factory || !isAddress(factory, { strict: false })) {
  console.error('The deploy ran but the factory address was not in the broadcast file.')
  process.exit(1)
}

try {
  const response = await fetch(SIGNER)
  const { address } = (await response.json()) as { address: string }
  await client.setBalance({ address: getAddress(address), value: parseEther('100') })
  console.log(`Funded the dev wallet ${address} with 100 ETH.`)
} catch {
  console.log('The dev wallet signer is not running. Start it, then run chain:local again to fund it.')
}

console.log('\nAdd these lines to apps/web/.env.local, then restart the dev server:\n')
console.log(`RPC_URL_31337=${RPC}`)
console.log(`FACTORY_ADDRESS_31337=${getAddress(factory)}`)
```

In `apps/web/package.json`, add to `scripts` after `"verify:storage"` (add a comma to the line before):

```json
    "chain:local": "node scripts/chain-local.ts"
```

and to `dependencies` after `"@cobweb/dna": "workspace:^",`:

```json
    "@cobweb/shared": "workspace:^",
```

In `apps/web/next.config.ts`, replace:

```ts
  transpilePackages: ['@cobweb/ui', '@cobweb/dna'],
```

with:

```ts
  transpilePackages: ['@cobweb/ui', '@cobweb/dna', '@cobweb/shared'],
```

In `.gitignore`, after the `cache/` line under "Dependencies and build output", add:

```
contracts/broadcast/
```

In `apps/web/.env.example`, append:

```
# Chains for the art fee (server only; never NEXT_PUBLIC_). A chain is ready for payments when both
# RPC_URL_<chain id> and FACTORY_ADDRESS_<chain id> are set. For local development run
# `pnpm --filter @cobweb/web chain:local` and copy the two lines it prints.
RPC_URL_31337=
FACTORY_ADDRESS_31337=
```

`apps/web/src/lib/wagmi.ts` (whole file):

```ts
import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import { anvil, arbitrum, base, berachain, mainnet, monad, robinhood, sepolia } from 'wagmi/chains'

/** The chains Cobweb launches on, plus Sepolia and a local Anvil chain outside production for testing. */
const launchChains = [mainnet, arbitrum, base, berachain, monad, robinhood] as const

export const chains =
  process.env.NODE_ENV === 'production' ? launchChains : ([...launchChains, sepolia, anvil] as const)

export const wagmiConfig = getDefaultConfig({
  appName: 'Cobweb',
  // Without a real id, WalletConnect (QR and mobile wallets) will not connect. Browser-extension
  // wallets still work.
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'missing-walletconnect-project-id',
  chains,
  ssr: true,
})
```

Run:

```bash
pnpm install
pnpm --filter @cobweb/web chain:local
```

Expected: "Started Anvil on 127.0.0.1:8545." (or "already running"), then the funding line or the "signer is not running" line, then `RPC_URL_31337=http://127.0.0.1:8545` and `FACTORY_ADDRESS_31337=0x...`. Copy the two lines into `apps/web/.env.local`. Then confirm the rate:

```bash
cast call "$(grep FACTORY_ADDRESS_31337 apps/web/.env.local | cut -d= -f2)" 'artFeePerToken()(uint256)' --rpc-url http://127.0.0.1:8545
```

Expected: `25000000000000 [2.5e13]`.

- [ ] **Step 6: The dev wallet pays on Anvil**

`apps/web/scripts/dev-wallet/signer.mjs` (whole file):

```js
/* global process, console, fetch */
// Local signing server for the dev wallet. Holds a throwaway private key in memory, signs
// personal_sign requests for the page at localhost:3000, and on the local Anvil chain (31337) only,
// sends transactions and forwards reads. Development only.
//
//   node apps/web/scripts/dev-wallet/signer.mjs
//
// A fresh key is generated on every start. To keep the same wallet (and so the same collections)
// across runs, set DEV_WALLET_KEY to a 0x-prefixed private key. The key is never printed.
// RPC_URL_31337 overrides the Anvil URL (default http://127.0.0.1:8545); it must be local.

import { createServer } from 'node:http'
import { createWalletClient, http, isAddress, isHex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { anvil } from 'viem/chains'

const HOST = '127.0.0.1'
const PORT = Number(process.env.DEV_WALLET_PORT ?? 8787)
const ALLOWED_ORIGINS = new Set(['http://localhost:3000', 'http://127.0.0.1:3000'])
const ANVIL = 31337
const ANVIL_RPC = process.env.RPC_URL_31337 ?? 'http://127.0.0.1:8545'
if (!['127.0.0.1', 'localhost'].includes(new URL(ANVIL_RPC).hostname)) {
  console.error(`Refusing to run: RPC_URL_31337 is "${ANVIL_RPC}", not a local Anvil.`)
  process.exit(2)
}
// Reads a wallet client may ask its provider for while it prepares and sends a transaction.
const READS = new Set([
  'eth_blockNumber',
  'eth_call',
  'eth_chainId',
  'eth_estimateGas',
  'eth_feeHistory',
  'eth_gasPrice',
  'eth_getBalance',
  'eth_getBlockByNumber',
  'eth_getCode',
  'eth_getTransactionByHash',
  'eth_getTransactionCount',
  'eth_getTransactionReceipt',
  'eth_maxPriorityFeePerGas',
])
const ONLY_ANVIL = 'The dev wallet sends and reads on Anvil (31337) only.'

const account = privateKeyToAccount(process.env.DEV_WALLET_KEY ?? generatePrivateKey())
const wallet = createWalletClient({ account, chain: anvil, transport: http(ANVIL_RPC) })

function send(res, origin, status, body) {
  const headers = { 'content-type': 'application/json' }
  if (ALLOWED_ORIGINS.has(origin)) {
    headers['access-control-allow-origin'] = origin
    headers['access-control-allow-methods'] = 'GET, POST, OPTIONS'
    headers['access-control-allow-headers'] = 'content-type'
    headers['vary'] = 'origin'
  }
  res.writeHead(status, headers)
  res.end(body === undefined ? '' : JSON.stringify(body))
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
      if (raw.length > 256_000) reject(new Error('Body too large'))
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

const server = createServer(async (req, res) => {
  const origin = req.headers.origin ?? ''
  // Browsers send an Origin; refuse other web pages. Tools without an Origin (curl) may read the address.
  if (origin && !ALLOWED_ORIGINS.has(origin)) return send(res, origin, 403, { error: 'Origin not allowed' })
  if (req.method === 'OPTIONS') return send(res, origin, 204)

  if (req.method === 'GET' && req.url === '/address') {
    return send(res, origin, 200, { address: account.address })
  }

  if (req.method === 'POST' && req.url === '/sign') {
    try {
      const { message, address } = await readJson(req)
      if (typeof message !== 'string') return send(res, origin, 400, { error: 'message must be a string' })
      if (address && address.toLowerCase() !== account.address.toLowerCase()) {
        return send(res, origin, 400, { error: 'Unknown address' })
      }
      // personal_sign sends the message hex-encoded; plain strings are signed as they are.
      const signature = await account.signMessage({ message: isHex(message) ? { raw: message } : message })
      return send(res, origin, 200, { signature })
    } catch {
      return send(res, origin, 400, { error: 'Could not sign' })
    }
  }

  if (req.method === 'POST' && req.url === '/send') {
    try {
      const { chainId, tx } = await readJson(req)
      if (chainId !== ANVIL) return send(res, origin, 400, { error: ONLY_ANVIL })
      if (!tx || !isAddress(tx.to ?? '')) return send(res, origin, 400, { error: 'tx.to must be an address' })
      if (tx.from && tx.from.toLowerCase() !== account.address.toLowerCase()) {
        return send(res, origin, 400, { error: 'Unknown address' })
      }
      const hash = await wallet.sendTransaction({
        to: tx.to,
        data: tx.data,
        value: tx.value ? BigInt(tx.value) : undefined,
        gas: tx.gas ? BigInt(tx.gas) : undefined,
      })
      return send(res, origin, 200, { hash })
    } catch (error) {
      return send(res, origin, 400, { error: error?.shortMessage ?? 'Could not send' })
    }
  }

  if (req.method === 'POST' && req.url === '/rpc') {
    try {
      const { chainId, method, params } = await readJson(req)
      if (chainId !== ANVIL) return send(res, origin, 400, { error: ONLY_ANVIL })
      if (!READS.has(method)) return send(res, origin, 400, { error: `Not forwarded: ${method}` })
      const upstream = await fetch(ANVIL_RPC, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params ?? [] }),
      })
      const body = await upstream.json()
      if (body.error) return send(res, origin, 400, { error: body.error.message ?? 'RPC error' })
      return send(res, origin, 200, { result: body.result })
    } catch {
      return send(res, origin, 400, { error: 'Anvil did not answer' })
    }
  }

  send(res, origin, 404, { error: 'Not found' })
})

server.listen(PORT, HOST, () => {
  console.log(`Dev wallet signer on http://${HOST}:${PORT} for ${account.address}`)
})
```

In `apps/web/scripts/dev-wallet/inject.js`, after the `sign` function add:

```js
const ANVIL = '0x7a69'

async function post(path, body, code) {
  const response = await fetch(`${SIGNER}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await response.json()
  if (!response.ok) throw rpcError(code, payload.error ?? 'Dev wallet request failed')
  return payload
}
```

and replace the `default:` branch of `request`:

```js
        default:
          throw rpcError(4200, `Dev wallet does not support ${method}`)
```

with:

```js
        case 'eth_sendTransaction': {
          if (chainId !== ANVIL) throw rpcError(4200, 'The dev wallet sends transactions on Anvil (31337) only')
          const { hash } = await post('/send', { chainId: 31337, tx: params[0] }, -32603)
          return hash
        }
        default:
          if (chainId === ANVIL) return (await post('/rpc', { chainId: 31337, method, params }, -32603)).result
          throw rpcError(4200, `Dev wallet does not support ${method}`)
```

In `apps/web/scripts/dev-wallet/README.md`, replace the last paragraph (it starts "Supported methods:") with:

```
Supported methods: `eth_requestAccounts`, `eth_accounts`, `eth_chainId`, `net_version`, `personal_sign`, `wallet_switchEthereumChain`, `wallet_addEthereumChain`, `wallet_getPermissions`, `wallet_requestPermissions`, `wallet_revokePermissions`. On the local Anvil chain (31337, after switching to it in the app) it also sends transactions (`eth_sendTransaction`, signed by the signer) and forwards reads such as `eth_estimateGas` to Anvil. On any other chain, transactions and reads are refused with code 4200.

To pay on Anvil: start the signer, run `pnpm --filter @cobweb/web chain:local` (it funds the signer's address with 100 ETH), copy its two lines into `apps/web/.env.local`, restart the app, and switch the network to Anvil in the account menu.
```

Run (the signer in one terminal, the rest in another):

```bash
node apps/web/scripts/dev-wallet/signer.mjs
pnpm --filter @cobweb/web chain:local
curl -s -X POST http://127.0.0.1:8787/rpc -d '{"chainId":31337,"method":"eth_chainId"}'
curl -s -X POST http://127.0.0.1:8787/rpc -d '{"chainId":1,"method":"eth_chainId"}'
curl -s -X POST http://127.0.0.1:8787/send -d '{"chainId":31337,"tx":{"to":"0x70997970C51812dc3A010C7d01b50e0d17dc79C8","value":"0x1"}}'
```

Expected: `chain:local` prints "Funded the dev wallet 0x... with 100 ETH."; the first curl prints `{"result":"0x7a69"}`; the second `{"error":"The dev wallet sends and reads on Anvil (31337) only."}`; the third `{"hash":"0x..."}`.

- [ ] **Step 7: Root checks and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: clean.

```bash
git add packages/shared contracts/script/DeployLocal.s.sol apps/web/scripts/chain-local.ts apps/web/package.json apps/web/next.config.ts apps/web/src/lib/wagmi.ts apps/web/.env.example apps/web/scripts/dev-wallet .gitignore pnpm-lock.yaml
git commit -F - <<'MSG'
Add the shared chain config, factory ABI, job ids and an Anvil deploy, and let the dev wallet pay on Anvil

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bcHX4HZG5YGWhxjGuiWos
MSG
```

---

### Task 2: The lock and pay functions and `verify:local` section 9g

**Files:**

- Create: `supabase/migrations/20261009020000_lock_and_pay.sql`
- Modify: `apps/web/scripts/verify-local.ts` (an import; new section 9g after 9f and before "// 10. Cleanup"; one call at the end of `main()`)
- Modify: `apps/web/src/lib/database.types.ts` (regenerated)

**Interfaces:**

- Consumes: `render_jobs`, `uploads`, `tokens`, `collections`, `profiles` and the `render_jobs_one_open_per_kind` index from `supabase/migrations/20261008010000_art_tables.sql`; `onchainJobId` from `packages/shared/src/job-id.ts` (Task 1); verify-local helpers `check`, `describe`, `expectError`, `PERMISSION`, `CHECK`, `UNIQUE`, `insertCollection`, `insertArtCollection`, `insertLayer`, `insertUploadRow`, `insertTrait`, `recordUpload`, `HEX64`, `admin`, `anon`, `createdJobIds`, `type Creator`, `type DbError`, and from 9f `callArt`, `expectSentence`, `tokenRow`.
- Produces:
  - `render_jobs.onchain_job_id text not null unique`, always `'0x' || replace(id::text, '-', '') || repeat('0', 32)` (set by the `render_jobs_set_onchain_job_id` trigger, pinned by a check).
  - `render_jobs.token_list jsonb` (an array, or null for generative jobs).
  - `render_jobs_payment_tx_hash_once`: unique index on `payment_tx_hash` where not null.
  - `private.lock_owned_collection(p_collection_id uuid, p_owner uuid) returns public.collections` (definer; no client grant).
  - `public.art_lock(p_collection_id uuid, p_owner uuid, p_kind text, p_token_list jsonb, p_token_list_hash text, p_allow_duplicates boolean, p_fee_per_token_wei numeric, p_chain_id integer, p_payer text) returns public.render_jobs` (`service_role` only); `p_kind` is the project type (`generative`, `one_of_one`, `single_asset`); `p_token_list` is `[{ id, collectionId, dna }]` for generative, `[{ id, uploadId, attributes }]` otherwise.
  - `public.art_unlock(p_collection_id uuid) returns void` (`authenticated`)
  - `public.art_lock_placeholder(p_collection_id uuid, p_placeholder_upload_id uuid) returns public.render_jobs` (`authenticated`)
  - `public.art_requote(p_collection_id uuid, p_owner uuid, p_fee_per_token_wei numeric) returns public.render_jobs` (`service_role` only)
  - `public.art_record_payment(p_collection_id uuid, p_owner uuid, p_job_id uuid, p_tx_hash text, p_payer text, p_amount_wei numeric) returns public.render_jobs` (`service_role` only)
  - The sentences (errcode in brackets): "The art is already locked." (23514), "The art changed while locking. Review it again." (23514), "There is nothing to lock yet." (23514), "The quote must be issued to your sign-in wallet." (23514), "The fee must be a whole number of wei." (23514), "The token list hash is not valid." (23514), "Choose the network the fee is paid on." (23514), "The art is not locked." (23514), "The art is paid for and stays locked." (23514), "Only a collection that finishes its art later locks a placeholder alone." (23514), "Choose a placeholder file first." (23514), "The placeholder is already locked." (23514), "There is no payment waiting for this collection." (23514), "The quote has not expired yet." (23514), "There is no payment waiting for this job." (23514), "The quote expired. Get a new quote." (23514), "The transaction did not pay for this job." (23514), "The payment came from a different wallet than the quote." (23514), "The payment was less than the quote." (23514), "This payment was already used." (23505), "collection not found" (42501).

Decision: `onchain_job_id` is set by a `before insert` trigger from the new row's id and pinned by a check constraint, so every insert path (the definer functions, and the service role in 9d) derives it the same way and nobody can write another value.

Decision: the owner lock lives in one definer helper, `private.lock_owned_collection(collection, owner)`, which is granted to no client role; the five functions call it first (the two session functions with `(select auth.uid())`, the three service functions with `p_owner`), and it returns the locked row so each function reads `art_locked_at`, `art_deferred`, `project_type`, `status` and `chain_id` from it.

Decision: `p_kind` is the collection's project type as the action read it; when it no longer matches the row (the type cannot change after creation, so only a forged call differs) `art_lock` answers "The art changed while locking. Review it again."

Decision: `art_lock` checks that `p_payer` is the owner's own `profiles.wallet_address` (the profile of `p_owner`) ("The quote must be issued to your sign-in wallet."), so the quote payer is always the sign-in wallet whoever calls the function.

Decision: a single asset's lock stores a fee and total of 0 and goes straight to `paid` (MASTER_PLAN: single asset pays nothing); 1/1s pay per token, every edition counted.

Decision: `art_lock` moves `status` from `draft` to `art_locked` only when it is `draft`, and `art_unlock` moves it back only from `art_locked`, so a deferred-art collection that is already deployed keeps `deployed` when its real set is locked later.

Decision: `art_record_payment` treats a quote as unexpired until one hour after `quote_expires_at`, so a payment mined just before expiry and confirmed after is still recorded (Review Focus 2); after that hour it answers "The quote expired. Get a new quote."

Decision: `art_record_payment` checks for the hash on any job first and raises "This payment was already used." with errcode 23505; the unique index stays as the guard against two calls at once.

Decision: the sentences the spec does not name (no job, nothing to lock, not deferred, and the rest in the list above) are written here once and passed through by `lockWriteError` in Task 4.

- [ ] **Step 1: Write the failing checks**

At the top of `apps/web/scripts/verify-local.ts`, after the `viem/siwe` import, add:

```ts
import { onchainJobId } from '../../../packages/shared/src/job-id.ts'
```

At the end of `main()`, after `await artEdits(A, B)`, add:

```ts
await artLockAndPay(A, B)
```

Add this section after the end of `artEdits` and before the "// 10. Cleanup" banner:

```ts
// ---------------------------------------------------------------------------------------------
// 9g. Lock and pay: the definer functions behind Lock and upload (docs/specs/2026-10-09-lock-and-pay.md)
// ---------------------------------------------------------------------------------------------
const FEE = '25000000000000'
const txHash = (n: number) => `0x${HEX64(9_000_000 + n)}`

type JobCheckRow = {
  id: string
  kind: string
  state: string
  onchain_job_id: string
  token_count: number
  fee_per_token_wei: string
  quote_total_wei: string
  quote_payer: string | null
  quote_expires_at: string | null
  batches_total: number
  token_list: unknown
  payment_tx_hash: string | null
  paid_amount_wei: string | null
}

async function jobFor(id: string): Promise<JobCheckRow | null> {
  const { data } = await admin
    .from('render_jobs')
    .select(
      'id, kind, state, onchain_job_id, token_count, fee_per_token_wei::text, quote_total_wei::text, quote_payer, quote_expires_at, batches_total, token_list, payment_tx_hash, paid_amount_wei::text',
    )
    .eq('id', id)
    .maybeSingle()
  return data as JobCheckRow | null
}

async function lockState(cid: string): Promise<{ art_locked_at: string | null; status: string }> {
  const { data, error } = await admin
    .from('collections')
    .select('art_locked_at, status')
    .eq('id', cid)
    .single()
  if (error) throw new Error(`lock state: ${describe(error as DbError)}`)
  return data as { art_locked_at: string | null; status: string }
}

/** A generative project with one art collection of two tokens, ready to lock. */
async function lockableProject(client: SupabaseClient) {
  const col = await insertCollection(client)
  if (!col.row) throw new Error(`setup: ${describe(col.error)}`)
  const cid = col.row.id
  const art = (await insertArtCollection(client, cid, { size: 2 })).row!.id
  const uploadId = await insertUploadRow(client, cid)
  const layer = (await insertLayer(client, cid, art)).row!.id
  const wide = (await insertTrait(client, cid, layer, { name: 'Wide', upload_id: uploadId })).row!.id
  const sleepy = (await insertTrait(client, cid, layer, { name: 'Sleepy', upload_id: uploadId })).row!.id
  const list = [
    { id: 1, collectionId: art, dna: [wide] },
    { id: 2, collectionId: art, dna: [sleepy] },
  ]
  const { error } = await client.from('tokens').insert(list.map((t) => tokenRow(cid, art, t.id, t.dna)))
  if (error) throw new Error(`setup: ${describe(error as DbError)}`)
  return { cid, art, wide, sleepy, uploadId, list }
}

// art_lock, art_requote and art_record_payment are service-role only: the checks call them with the
// admin client and the owner's id, as the server actions do with the service client.
const lockArgs = (
  owner: string,
  cid: string,
  list: unknown,
  payer: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  p_collection_id: cid,
  p_owner: owner,
  p_kind: 'generative',
  p_token_list: list,
  p_token_list_hash: `0x${HEX64(42)}`,
  p_allow_duplicates: false,
  p_fee_per_token_wei: FEE,
  p_chain_id: 31337,
  p_payer: payer,
  ...overrides,
})

const payArgs = (owner: string, cid: string, jobId: string, hash: string, payer: string, amount: string) => ({
  p_collection_id: cid,
  p_owner: owner,
  p_job_id: jobId,
  p_tx_hash: hash,
  p_payer: payer,
  p_amount_wei: amount,
})

const idOf = (data: unknown) => {
  const id = (data as { id?: string } | null)?.id ?? ''
  if (id) createdJobIds.add(id)
  return id
}

async function backdateQuote(jobId: string, minutesAgo: number): Promise<string | null> {
  const { error } = await admin
    .from('render_jobs')
    .update({ quote_expires_at: new Date(Date.now() - minutesAgo * 60_000).toISOString() })
    .eq('id', jobId)
  return error ? `setup: ${describe(error as DbError)}` : null
}

async function artLockAndPay(A: Creator, B: Creator): Promise<void> {
  const payer = A.account.address.toLowerCase()
  const g = await lockableProject(A.client)
  let job1 = ''

  await check(
    'art_lock: a list that differs from the stored tokens is refused and nothing locks',
    async () => {
      const changed = [g.list[0]!, { ...g.list[1]!, dna: [g.wide] }]
      const { error } = await callArt(admin, 'art_lock', lockArgs(A.userId, g.cid, changed, payer))
      const problem = expectSentence(error, CHECK, 'The art changed while locking. Review it again.')
      if (problem) return problem
      const state = await lockState(g.cid)
      return state.art_locked_at === null && state.status === 'draft' ? null : JSON.stringify(state)
    },
  )

  await check('art_lock: a list with one token fewer than stored is refused', async () => {
    const { error } = await callArt(admin, 'art_lock', lockArgs(A.userId, g.cid, [g.list[0]], payer))
    return expectSentence(error, CHECK, 'The art changed while locking. Review it again.')
  })

  await check('art_lock: a quote for another wallet than the sign-in wallet is refused', async () => {
    const other = B.account.address.toLowerCase()
    const { error } = await callArt(admin, 'art_lock', lockArgs(A.userId, g.cid, g.list, other))
    return expectSentence(error, CHECK, 'The quote must be issued to your sign-in wallet.')
  })

  await check(
    'art_lock: the matching list locks the art, quotes fee x count for 24 hours and derives the on-chain id',
    async () => {
      const { data, error } = await callArt(admin, 'art_lock', lockArgs(A.userId, g.cid, g.list, payer))
      if (error) return describe(error)
      job1 = idOf(data)
      const job = await jobFor(job1)
      const state = await lockState(g.cid)
      if (!job) return 'no job row'
      const hours = (Date.parse(job.quote_expires_at ?? '') - Date.now()) / 3_600_000
      const problems = [
        job.state === 'payment_due' ? null : `state ${job.state}`,
        job.kind === 'real' ? null : `kind ${job.kind}`,
        job.onchain_job_id === onchainJobId(job.id) ? null : `onchain id ${job.onchain_job_id}`,
        job.token_count === 2 ? null : `token_count ${job.token_count}`,
        job.fee_per_token_wei === FEE ? null : `fee ${job.fee_per_token_wei}`,
        job.quote_total_wei === '50000000000000' ? null : `total ${job.quote_total_wei}`,
        job.quote_payer === payer ? null : `payer ${job.quote_payer}`,
        hours > 23.9 && hours < 24.1 ? null : `expires in ${hours} hours`,
        job.batches_total === 1 ? null : `batches ${job.batches_total}`,
        job.token_list === null ? null : 'a generative job stored a token list',
        state.art_locked_at !== null && state.status === 'art_locked' ? null : JSON.stringify(state),
      ].filter(Boolean)
      return problems.length ? problems.join('; ') : null
    },
  )

  await check('art_lock: locking twice is refused', async () => {
    const { error } = await callArt(admin, 'art_lock', lockArgs(A.userId, g.cid, g.list, payer))
    return expectSentence(error, CHECK, 'The art is already locked.')
  })

  await check('art_unlock: while payment is due, the job goes and the art opens again', async () => {
    const { error } = await callArt(A.client, 'art_unlock', { p_collection_id: g.cid })
    if (error) return describe(error)
    const state = await lockState(g.cid)
    if (state.art_locked_at !== null || state.status !== 'draft') return JSON.stringify(state)
    if (await jobFor(job1)) return 'the job is still there'
    // The lock gate is open again: the creator can edit a token.
    const edit = await A.client
      .from('tokens')
      .update({ description: 'Edited after unlock.' })
      .eq('collection_id', g.cid)
      .eq('token_id', 1)
      .select('token_id')
    return edit.error ? `token edit refused: ${describe(edit.error as DbError)}` : null
  })

  await check('art_unlock: with nothing locked is refused', async () => {
    const { error } = await callArt(A.client, 'art_unlock', { p_collection_id: g.cid })
    return expectSentence(error, CHECK, 'The art is not locked.')
  })

  await check('art_record_payment: the right payer and amount mark the job paid', async () => {
    const { data, error } = await callArt(admin, 'art_lock', lockArgs(A.userId, g.cid, g.list, payer))
    if (error) return `relock: ${describe(error)}`
    job1 = idOf(data)
    const paid = await callArt(
      admin,
      'art_record_payment',
      payArgs(A.userId, g.cid, job1, txHash(1), payer, '50000000000000'),
    )
    if (paid.error) return describe(paid.error)
    const job = await jobFor(job1)
    return job?.state === 'paid' &&
      job.payment_tx_hash === txHash(1) &&
      job.paid_amount_wei === '50000000000000'
      ? null
      : JSON.stringify(job)
  })

  await check('art_unlock: after payment is refused and the art stays locked', async () => {
    const { error } = await callArt(A.client, 'art_unlock', { p_collection_id: g.cid })
    const problem = expectSentence(error, CHECK, 'The art is paid for and stays locked.')
    if (problem) return problem
    return (await lockState(g.cid)).art_locked_at !== null ? null : 'the lock was cleared'
  })

  // A second project for the refusals, the requote and the grace hour.
  const h = await lockableProject(A.client)
  let job2 = ''
  await check('art_record_payment: another payer, a short amount and a reused hash are refused', async () => {
    const { data, error } = await callArt(admin, 'art_lock', lockArgs(A.userId, h.cid, h.list, payer))
    if (error) return `lock: ${describe(error)}`
    job2 = idOf(data)
    const other = B.account.address.toLowerCase()
    const wrongPayer = await callArt(
      admin,
      'art_record_payment',
      payArgs(A.userId, h.cid, job2, txHash(2), other, '50000000000000'),
    )
    const short = await callArt(
      admin,
      'art_record_payment',
      payArgs(A.userId, h.cid, job2, txHash(3), payer, '49999999999999'),
    )
    const reused = await callArt(
      admin,
      'art_record_payment',
      payArgs(A.userId, h.cid, job2, txHash(1), payer, '50000000000000'),
    )
    const problem =
      expectSentence(wrongPayer.error, CHECK, 'The payment came from a different wallet than the quote.') ??
      expectSentence(short.error, CHECK, 'The payment was less than the quote.') ??
      expectSentence(reused.error, UNIQUE, 'This payment was already used.')
    if (problem) return problem
    return (await jobFor(job2))?.state === 'payment_due' ? null : 'the job changed'
  })

  await check('art_requote: refused while the quote is still valid', async () => {
    const { error } = await callArt(admin, 'art_requote', {
      p_collection_id: h.cid,
      p_owner: A.userId,
      p_fee_per_token_wei: '30000000000000',
    })
    return expectSentence(error, CHECK, 'The quote has not expired yet.')
  })

  await check('art_record_payment: refused more than an hour after the quote expired', async () => {
    const setup = await backdateQuote(job2, 61)
    if (setup) return setup
    const { error } = await callArt(
      admin,
      'art_record_payment',
      payArgs(A.userId, h.cid, job2, txHash(4), payer, '50000000000000'),
    )
    return expectSentence(error, CHECK, 'The quote expired. Get a new quote.')
  })

  await check('art_requote: an expired quote takes the new rate and runs 24 hours again', async () => {
    const { error } = await callArt(admin, 'art_requote', {
      p_collection_id: h.cid,
      p_owner: A.userId,
      p_fee_per_token_wei: '30000000000000',
    })
    if (error) return describe(error)
    const job = await jobFor(job2)
    const hours = (Date.parse(job?.quote_expires_at ?? '') - Date.now()) / 3_600_000
    return job?.state === 'payment_due' &&
      job.fee_per_token_wei === '30000000000000' &&
      job.quote_total_wei === '60000000000000' &&
      hours > 23.9
      ? null
      : JSON.stringify(job)
  })

  await check('art_record_payment: recorded within the hour after the quote expired', async () => {
    const setup = await backdateQuote(job2, 30)
    if (setup) return setup
    const { error } = await callArt(
      admin,
      'art_record_payment',
      payArgs(A.userId, h.cid, job2, txHash(5), payer, '60000000000000'),
    )
    if (error) return describe(error)
    return (await jobFor(job2))?.state === 'paid' ? null : 'not paid'
  })

  // Deferred art: the placeholder alone, at no cost, without locking the art.
  const d = (await insertCollection(A.client)).row!.id
  const deferred = await A.client.from('collections').update({ art_deferred: true }).eq('id', d)
  if (deferred.error) throw new Error(`setup: ${describe(deferred.error as DbError)}`)
  const layerImage = await insertUploadRow(A.client, d)
  const placeholder = await recordUpload(A.client, d, { kind: 'placeholder' })
  if (!placeholder.id) throw new Error(`setup: ${describe(placeholder.error)}`)

  await check('art_lock_placeholder: refused on a collection that does not defer its art', async () => {
    const { error } = await callArt(A.client, 'art_lock_placeholder', {
      p_collection_id: h.cid,
      p_placeholder_upload_id: h.uploadId,
    })
    return expectSentence(
      error,
      CHECK,
      'Only a collection that finishes its art later locks a placeholder alone.',
    )
  })

  await check('art_lock_placeholder: refused for an upload that is not a placeholder', async () => {
    const { error } = await callArt(A.client, 'art_lock_placeholder', {
      p_collection_id: d,
      p_placeholder_upload_id: layerImage,
    })
    return expectSentence(error, CHECK, 'Choose a placeholder file first.')
  })

  await check('art_lock_placeholder: a paid job of one token at no cost, the art left open', async () => {
    const { data, error } = await callArt(A.client, 'art_lock_placeholder', {
      p_collection_id: d,
      p_placeholder_upload_id: placeholder.id,
    })
    if (error) return describe(error)
    const job = await jobFor(idOf(data))
    const state = await lockState(d)
    return job?.kind === 'placeholder' &&
      job.state === 'paid' &&
      job.token_count === 1 &&
      job.quote_total_wei === '0' &&
      state.art_locked_at === null &&
      state.status === 'draft'
      ? null
      : `${JSON.stringify(job)} ${JSON.stringify(state)}`
  })

  await check('art_lock_placeholder: twice is refused', async () => {
    const { error } = await callArt(A.client, 'art_lock_placeholder', {
      p_collection_id: d,
      p_placeholder_upload_id: placeholder.id,
    })
    return expectSentence(error, CHECK, 'The placeholder is already locked.')
  })

  // A single asset: one file, three tokens, no fee.
  const s = (await insertCollection(A.client, { project_type: 'single_asset', max_supply: 3 })).row!.id
  const asset = await recordUpload(A.client, s, { kind: 'asset' })
  if (!asset.id) throw new Error(`setup: ${describe(asset.error)}`)
  const quantity = await A.client.from('uploads').update({ quantity: 3 }).eq('id', asset.id)
  if (quantity.error) throw new Error(`setup: ${describe(quantity.error as DbError)}`)
  const assetList = [1, 2, 3].map((id) => ({ id, uploadId: asset.id, attributes: [] }))

  await check(
    'art_lock: a single asset locks at no cost, goes straight to paid and stores its list',
    async () => {
      const { data, error } = await callArt(
        admin,
        'art_lock',
        lockArgs(A.userId, s, assetList, payer, { p_kind: 'single_asset' }),
      )
      if (error) return describe(error)
      const job = await jobFor(idOf(data))
      return job?.state === 'paid' &&
        job.quote_total_wei === '0' &&
        job.fee_per_token_wei === '0' &&
        Array.isArray(job.token_list) &&
        job.token_list.length === 3
        ? null
        : JSON.stringify(job)
    },
  )

  // Nobody else, and nobody signed out, can run any of them; the creator's own session cannot run the
  // three service functions at all.
  const serviceCalls = (owner: string): [string, Record<string, unknown>][] => [
    ['art_lock', lockArgs(owner, h.cid, h.list, payer)],
    ['art_requote', { p_collection_id: h.cid, p_owner: owner, p_fee_per_token_wei: FEE }],
    ['art_record_payment', payArgs(owner, h.cid, job2, txHash(6), payer, '1')],
  ]
  const sessionCalls: [string, Record<string, unknown>][] = [
    ['art_unlock', { p_collection_id: h.cid }],
    ['art_lock_placeholder', { p_collection_id: d, p_placeholder_upload_id: placeholder.id }],
  ]
  await check(
    "lock functions: B's session calling unlock or the placeholder lock on A's collections is refused",
    async () => {
      const problems: string[] = []
      for (const [fn, args] of sessionCalls) {
        const { error } = await callArt(B.client, fn, args)
        const problem = expectSentence(error, PERMISSION, 'collection not found')
        if (problem) problems.push(`${fn}: ${problem}`)
      }
      return problems.length ? problems.join('; ') : null
    },
  )
  await check(
    "lock functions: the service functions with B's owner id on A's collections are refused",
    async () => {
      const problems: string[] = []
      for (const [fn, args] of serviceCalls(B.userId)) {
        const { error } = await callArt(admin, fn, args)
        const problem = expectSentence(error, PERMISSION, 'collection not found')
        if (problem) problems.push(`${fn}: ${problem}`)
      }
      return problems.length ? problems.join('; ') : null
    },
  )
  await check(
    "lock functions: the owner's own session cannot execute the three service functions",
    async () => {
      const problems: string[] = []
      for (const [fn, args] of serviceCalls(A.userId)) {
        const { error } = await callArt(A.client, fn, args)
        const problem = expectSentence(error, PERMISSION, 'permission denied')
        if (problem) problems.push(`${fn}: ${problem}`)
      }
      return problems.length ? problems.join('; ') : null
    },
  )
  await check('lock functions: a signed-out caller cannot execute any of them', async () => {
    const problems: string[] = []
    for (const [fn, args] of [...serviceCalls(A.userId), ...sessionCalls]) {
      const { error } = await callArt(anon, fn, args)
      const problem = expectError(error, PERMISSION)
      if (problem) problems.push(`${fn}: ${problem}`)
    }
    return problems.length ? problems.join('; ') : null
  })

  // Every job of these collections goes in cleanup, before the collections it restricts.
  const { data: jobs } = await admin
    .from('render_jobs')
    .select('id')
    .in('collection_id', [g.cid, h.cid, d, s])
  for (const job of (jobs ?? []) as { id: string }[]) createdJobIds.add(job.id)
}
```

- [ ] **Step 2: Run the checks to verify they fail**

Run: `pnpm --filter @cobweb/web verify:local 2>&1 | grep -E '^(FAIL|[0-9]+ passed)'`
Expected: the 9g checks FAIL with "Could not find the function public.art_lock" (and the same for the other four functions; the service-role calls fail the same way); every earlier section passes.

- [ ] **Step 3: Write the migration**

`supabase/migrations/20261009020000_lock_and_pay.sql`:

```sql
-- Lock and pay (docs/specs/2026-10-09-lock-and-pay.md, section 6): the art lock, the quote, the
-- payment record, the requote and the placeholder lock, each in one transaction. These functions
-- are security definer: they write render_jobs and collections.art_locked_at, which no client role
-- may write, so each one checks what a policy would. It first locks the owner's collections row
-- (any other owner reads as "collection not found") and filters every later statement on that id.
-- Running as the definer, the art lock trigger does not apply to them. art_lock, art_requote and
-- art_record_payment take arguments read from the chain or a verified receipt (fee, chain, payer,
-- tx hash, amount), so only the service role runs them, for the owner the server action names in
-- p_owner after its own session check. art_unlock and art_lock_placeholder take nothing from the
-- chain and run as the signed-in creator.

-- ---------------------------------------------------------------------------------------------
-- render_jobs: the factory's job id, the stored asset token list, one use per payment
-- ---------------------------------------------------------------------------------------------
alter table public.render_jobs
  add column onchain_job_id text check (onchain_job_id is null or onchain_job_id ~ '^0x[0-9a-f]{64}$'),
  add column token_list jsonb check (token_list is null or jsonb_typeof(token_list) = 'array');

-- The bytes32 the factory's payForArt takes: the row's 16 uuid bytes left-aligned in 32 bytes, as
-- onchainJobId in packages/shared/src/job-id.ts. Derived from the id on every insert; nobody writes it.
create function public.render_jobs_set_onchain_job_id()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.onchain_job_id := '0x' || replace(new.id::text, '-', '') || repeat('0', 32);
  return new;
end;
$$;

revoke all on function public.render_jobs_set_onchain_job_id() from public, anon, authenticated;

create trigger render_jobs_set_onchain_job_id
before insert or update of id, onchain_job_id on public.render_jobs
for each row execute function public.render_jobs_set_onchain_job_id();

update public.render_jobs set onchain_job_id = '0x' || replace(id::text, '-', '') || repeat('0', 32);

alter table public.render_jobs
  alter column onchain_job_id set not null,
  add constraint render_jobs_onchain_job_id_from_id
    check (onchain_job_id = '0x' || replace(id::text, '-', '') || repeat('0', 32)),
  add constraint render_jobs_onchain_job_id_unique unique (onchain_job_id);

-- A payment pays for one job only.
create unique index render_jobs_payment_tx_hash_once on public.render_jobs (payment_tx_hash)
  where payment_tx_hash is not null;

-- ---------------------------------------------------------------------------------------------
-- The owner lock every function below starts with
-- ---------------------------------------------------------------------------------------------

-- Locks the owner's collections row `for no key update` (the functions then write it or rows that
-- point at it) and returns it. The session functions pass (select auth.uid()); the service functions
-- pass their p_owner. A null owner matches nothing. Called only from the definer functions below.
create function private.lock_owned_collection(p_collection_id uuid, p_owner uuid)
returns public.collections
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.collections;
begin
  select c.* into v_row
  from public.collections c
  where c.id = p_collection_id and c.owner_id = p_owner
  for no key update;
  if not found then
    raise exception 'collection not found' using errcode = '42501';
  end if;
  return v_row;
end;
$$;

revoke all on function private.lock_owned_collection(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- art_lock: the token list the server validated, checked against the stored rows, then the lock
-- and the job with its quote
-- ---------------------------------------------------------------------------------------------
create function public.art_lock(
  p_collection_id uuid,
  p_owner uuid,
  p_kind text,
  p_token_list jsonb,
  p_token_list_hash text,
  p_allow_duplicates boolean,
  p_fee_per_token_wei numeric,
  p_chain_id integer,
  p_payer text
)
returns public.render_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_collection public.collections;
  v_wallet text;
  v_count integer;
  v_mismatch boolean;
  v_fee numeric(78, 0);
  v_total numeric(78, 0);
  v_job public.render_jobs;
begin
  v_collection := private.lock_owned_collection(p_collection_id, p_owner);
  if v_collection.art_locked_at is not null or exists (
    select 1 from public.render_jobs j
    where j.collection_id = p_collection_id and j.kind = 'real' and j.state not in ('done', 'failed')
  ) then
    raise exception 'The art is already locked.' using errcode = '23514';
  end if;
  select p.wallet_address into v_wallet from public.profiles p where p.id = p_owner;
  if v_wallet is null or p_payer is distinct from v_wallet then
    raise exception 'The quote must be issued to your sign-in wallet.' using errcode = '23514';
  end if;
  if p_chain_id is null or p_chain_id <= 0 then
    raise exception 'Choose the network the fee is paid on.' using errcode = '23514';
  end if;
  if p_fee_per_token_wei is null or p_fee_per_token_wei < 0 or p_fee_per_token_wei <> trunc(p_fee_per_token_wei) then
    raise exception 'The fee must be a whole number of wei.' using errcode = '23514';
  end if;
  if p_token_list_hash is null or p_token_list_hash !~ '^0x[0-9a-f]{64}$' then
    raise exception 'The token list hash is not valid.' using errcode = '23514';
  end if;
  if p_token_list is null or jsonb_typeof(p_token_list) <> 'array' or jsonb_array_length(p_token_list) = 0 then
    raise exception 'There is nothing to lock yet.' using errcode = '23514';
  end if;
  if p_kind is distinct from v_collection.project_type::text then
    raise exception 'The art changed while locking. Review it again.' using errcode = '23514';
  end if;

  v_count := jsonb_array_length(p_token_list);
  if v_collection.project_type = 'generative' then
    -- Same ids, art collections and DNA as the stored tokens, no more, no less.
    with given as (
      select x.id, x."collectionId" as art_collection_id, x.dna
      from jsonb_to_recordset(p_token_list) as x(id integer, "collectionId" uuid, dna uuid[])
    ),
    stored as (
      select t.token_id as id, t.art_collection_id, t.dna
      from public.tokens t
      where t.collection_id = p_collection_id
    )
    select (select count(*) from stored) <> v_count
      or exists (select * from given except select * from stored)
      or exists (select * from stored except select * from given)
    into v_mismatch;
  else
    -- Every edition of every asset file, ids 1 to N in file order (position, upload time, id), as
    -- buildAssetTokenList in apps/web/src/lib/art/asset-tokens.ts makes them.
    with ordered as (
      select u.id, u.quantity, u.attributes,
        coalesce(sum(u.quantity) over (
          order by u.position nulls last, u.created_at, u.id
          rows between unbounded preceding and 1 preceding
        ), 0)::integer as before
      from public.uploads u
      where u.collection_id = p_collection_id and u.kind = 'asset'
    ),
    expected as (
      select o.before + g.n as id, o.id as upload_id, o.attributes
      from ordered o
      cross join lateral generate_series(1, o.quantity) as g(n)
    ),
    given as (
      select x.id, x."uploadId" as upload_id, x.attributes
      from jsonb_to_recordset(p_token_list) as x(id integer, "uploadId" uuid, attributes jsonb)
    )
    select (select count(*) from expected) <> v_count
      or exists (select * from given except select * from expected)
      or exists (select * from expected except select * from given)
    into v_mismatch;
  end if;
  if v_mismatch then
    raise exception 'The art changed while locking. Review it again.' using errcode = '23514';
  end if;

  -- A single asset pays nothing (MASTER_PLAN, Decisions: art fee).
  v_fee := case when v_collection.project_type = 'single_asset' then 0 else p_fee_per_token_wei end;
  v_total := v_fee * v_count;

  -- The collections row first, as the lock trigger's note in the art tables migration asks.
  update public.collections c
  set art_locked_at = now(),
      status = case when c.status = 'draft' then 'art_locked'::public.collection_status else c.status end
  where c.id = p_collection_id;

  insert into public.render_jobs (
    collection_id, kind, state, token_count, token_list_hash, allow_duplicates,
    fee_per_token_wei, quote_total_wei, quote_chain_id, quote_payer, quote_expires_at,
    paid_at, batch_size, batches_total, token_list
  )
  values (
    p_collection_id,
    'real',
    case when v_total = 0 then 'paid'::public.render_state else 'payment_due'::public.render_state end,
    v_count,
    p_token_list_hash,
    coalesce(p_allow_duplicates, false),
    v_fee,
    v_total,
    p_chain_id,
    v_wallet,
    now() + interval '24 hours',
    case when v_total = 0 then now() end,
    100,
    ceil(v_count / 100.0)::integer,
    case when v_collection.project_type = 'generative' then null else p_token_list end
  )
  returning * into v_job;
  return v_job;
end;
$$;

revoke all on function public.art_lock(uuid, uuid, text, jsonb, text, boolean, numeric, integer, text)
  from public, anon, authenticated;
grant execute on function public.art_lock(uuid, uuid, text, jsonb, text, boolean, numeric, integer, text)
  to service_role;

-- ---------------------------------------------------------------------------------------------
-- art_unlock: free while the payment is due, never after
-- ---------------------------------------------------------------------------------------------
create function public.art_unlock(p_collection_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_collection public.collections;
  v_job public.render_jobs;
begin
  v_collection := private.lock_owned_collection(p_collection_id, (select auth.uid()));
  select j.* into v_job
  from public.render_jobs j
  where j.collection_id = p_collection_id and j.kind = 'real' and j.state not in ('done', 'failed')
  for update;
  if not found then
    raise exception 'The art is not locked.' using errcode = '23514';
  end if;
  if v_job.state <> 'payment_due' then
    raise exception 'The art is paid for and stays locked.' using errcode = '23514';
  end if;
  update public.collections c
  set art_locked_at = null,
      status = case when c.status = 'art_locked' then 'draft'::public.collection_status else c.status end
  where c.id = v_collection.id;
  delete from public.render_jobs j where j.id = v_job.id and j.collection_id = p_collection_id;
end;
$$;

revoke all on function public.art_unlock(uuid) from public, anon;
grant execute on function public.art_unlock(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- art_lock_placeholder: deferred art renders its placeholder alone, at no cost, art left open
-- ---------------------------------------------------------------------------------------------
create function public.art_lock_placeholder(p_collection_id uuid, p_placeholder_upload_id uuid)
returns public.render_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_collection public.collections;
  v_wallet text;
  v_job public.render_jobs;
begin
  v_collection := private.lock_owned_collection(p_collection_id, (select auth.uid()));
  if not v_collection.art_deferred then
    raise exception 'Only a collection that finishes its art later locks a placeholder alone.'
      using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.uploads u
    where u.id = p_placeholder_upload_id and u.collection_id = p_collection_id and u.kind = 'placeholder'
  ) then
    raise exception 'Choose a placeholder file first.' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.render_jobs j
    where j.collection_id = p_collection_id and j.kind = 'placeholder' and j.state not in ('done', 'failed')
  ) then
    raise exception 'The placeholder is already locked.' using errcode = '23514';
  end if;
  select p.wallet_address into v_wallet from public.profiles p where p.id = (select auth.uid());
  insert into public.render_jobs (
    collection_id, kind, state, token_count, fee_per_token_wei, quote_total_wei, quote_chain_id,
    quote_payer, placeholder_upload_id, paid_at, batch_size, batches_total
  )
  values (
    p_collection_id, 'placeholder', 'paid', 1, 0, 0, v_collection.chain_id,
    v_wallet, p_placeholder_upload_id, now(), 1, 1
  )
  returning * into v_job;
  return v_job;
end;
$$;

revoke all on function public.art_lock_placeholder(uuid, uuid) from public, anon;
grant execute on function public.art_lock_placeholder(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- art_requote: an expired quote takes the factory's current rate, without unlocking
-- ---------------------------------------------------------------------------------------------
create function public.art_requote(p_collection_id uuid, p_owner uuid, p_fee_per_token_wei numeric)
returns public.render_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_collection public.collections;
  v_job public.render_jobs;
begin
  v_collection := private.lock_owned_collection(p_collection_id, p_owner);
  if p_fee_per_token_wei is null or p_fee_per_token_wei < 0 or p_fee_per_token_wei <> trunc(p_fee_per_token_wei) then
    raise exception 'The fee must be a whole number of wei.' using errcode = '23514';
  end if;
  select j.* into v_job
  from public.render_jobs j
  where j.collection_id = v_collection.id and j.kind = 'real' and j.state not in ('done', 'failed')
  for update;
  if not found or v_job.state <> 'payment_due' then
    raise exception 'There is no payment waiting for this collection.' using errcode = '23514';
  end if;
  if v_job.quote_expires_at >= now() then
    raise exception 'The quote has not expired yet.' using errcode = '23514';
  end if;
  update public.render_jobs j
  set fee_per_token_wei = p_fee_per_token_wei,
      quote_total_wei = p_fee_per_token_wei * j.token_count,
      quote_expires_at = now() + interval '24 hours'
  where j.id = v_job.id and j.collection_id = p_collection_id
  returning * into v_job;
  return v_job;
end;
$$;

revoke all on function public.art_requote(uuid, uuid, numeric) from public, anon, authenticated;
grant execute on function public.art_requote(uuid, uuid, numeric) to service_role;

-- ---------------------------------------------------------------------------------------------
-- art_record_payment: the payment the server read from the receipt's ArtPaid log
-- ---------------------------------------------------------------------------------------------
create function public.art_record_payment(
  p_collection_id uuid,
  p_owner uuid,
  p_job_id uuid,
  p_tx_hash text,
  p_payer text,
  p_amount_wei numeric
)
returns public.render_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_collection public.collections;
  v_job public.render_jobs;
begin
  v_collection := private.lock_owned_collection(p_collection_id, p_owner);
  select j.* into v_job
  from public.render_jobs j
  where j.id = p_job_id and j.collection_id = v_collection.id
  for update;
  if not found or v_job.state <> 'payment_due' then
    raise exception 'There is no payment waiting for this job.' using errcode = '23514';
  end if;
  -- A payment mined just before the quote ran out is still the quoted payment: an hour of grace.
  if v_job.quote_expires_at + interval '1 hour' < now() then
    raise exception 'The quote expired. Get a new quote.' using errcode = '23514';
  end if;
  if p_tx_hash is null or p_tx_hash !~ '^0x[0-9a-f]{64}$' then
    raise exception 'The transaction did not pay for this job.' using errcode = '23514';
  end if;
  if exists (select 1 from public.render_jobs j where j.payment_tx_hash = p_tx_hash) then
    raise exception 'This payment was already used.' using errcode = '23505';
  end if;
  -- The action checked both against the receipt already; these are the database's own guards.
  if p_payer is distinct from v_job.quote_payer then
    raise exception 'The payment came from a different wallet than the quote.' using errcode = '23514';
  end if;
  if p_amount_wei is null or p_amount_wei < v_job.quote_total_wei then
    raise exception 'The payment was less than the quote.' using errcode = '23514';
  end if;
  update public.render_jobs j
  set state = 'paid',
      payment_tx_hash = p_tx_hash,
      paid_at = now(),
      paid_amount_wei = p_amount_wei
  where j.id = v_job.id and j.collection_id = p_collection_id
  returning * into v_job;
  return v_job;
end;
$$;

revoke all on function public.art_record_payment(uuid, uuid, uuid, text, text, numeric)
  from public, anon, authenticated;
grant execute on function public.art_record_payment(uuid, uuid, uuid, text, text, numeric) to service_role;
```

- [ ] **Step 4: Reset, run, expect pass**

Run:

```bash
supabase db reset 2>&1 | tail -3
supabase seed buckets
pnpm --filter @cobweb/web verify:local 2>&1 | grep -E '^(FAIL|[0-9]+ passed)'
```

Expected: no `FAIL` lines; the summary ends `0 failed`. If the reset prints an error, fix the SQL and run the three commands again.

- [ ] **Step 5: Regenerate the types; root checks**

Run:

```bash
supabase gen types typescript --local > apps/web/src/lib/database.types.ts
pnpm exec prettier --write apps/web/src/lib/database.types.ts
pnpm typecheck && pnpm lint && pnpm test
```

Expected: `Database['public']['Tables']['render_jobs']['Row']` gains `onchain_job_id: string` and `token_list: Json | null`; `Database['public']['Functions']` lists `art_lock`, `art_lock_placeholder`, `art_record_payment`, `art_requote` (each returning the `render_jobs` row type; `art_lock`, `art_requote` and `art_record_payment` take `p_owner: string`) and `art_unlock` (Returns `undefined`); root checks pass.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261009020000_lock_and_pay.sql apps/web/scripts/verify-local.ts apps/web/src/lib/database.types.ts
git commit -F - <<'MSG'
Add the lock, unlock, placeholder, requote and payment functions and check them in verify:local section 9g

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bcHX4HZG5YGWhxjGuiWos
MSG
```

---

### Task 3: The pure pieces: asset token lists, the quote, the receipt match, the job mapping and the owner read

**Files:**

- Create: `apps/web/src/lib/art/asset-tokens.ts`, `apps/web/src/lib/art/quote.ts`, `apps/web/src/lib/chain/art-paid.ts`, `apps/web/src/lib/art/render-job.ts`, `apps/web/src/lib/art/lock-collection.ts`
- Test: `apps/web/src/lib/art/asset-tokens.test.ts`, `apps/web/src/lib/art/quote.test.ts`, `apps/web/src/lib/chain/art-paid.test.ts`, `apps/web/src/lib/art/render-job.test.ts`
- Modify: `apps/web/src/lib/art/result.ts` (the lock and pay sentences), `apps/web/src/lib/art/owned.ts` (`ownedCollection`)
- Modify: `apps/web/src/lib/demo/types.ts:66-145` (`RenderJobState`, `ArtFeeQuote.factory`, `RenderPlaceholder.uploadId`, the `RenderJob` union), `apps/web/src/lib/demo/data.ts` (`SampleJobState`), `apps/web/src/app/collections/[id]/upload/page.tsx` and `apps/web/src/components/upload/upload-flow.tsx` (compile against the wider union)

**Interfaces:**

- Consumes: `buildOneOfOneTokens(items: TokenSource[], details: TokenDetails): OneOfOneToken[]` from `@/components/art/assets/token-list`; `supplyLimit(projectType: ProjectType): number` and `type ProjectType` from `@/lib/collections`; `servedUrl(id: string, variant?: 'thumb'): string` from `@/lib/storage/uploads-service`; `factoryAbi` from `@cobweb/shared` (Task 1); `getVerifiedUser` and `type SessionUser` from `@/lib/auth`; `createClient` from `@/lib/supabase/server`; `render_jobs.onchain_job_id` (Task 2).
- Produces:
  - `result.ts`: sentences `ALREADY_LOCKED`, `ART_CHANGED`, `NOTHING_TO_LOCK`, `PAYER_NOT_YOU`, `FEE_NOT_WHOLE`, `HASH_INVALID`, `NO_CHAIN`, `NOT_LOCKED`, `PAID_STAYS_LOCKED`, `NOT_DEFERRED`, `NO_PLACEHOLDER`, `PLACEHOLDER_LOCKED`, `NO_PAYMENT_DUE`, `QUOTE_NOT_EXPIRED`, `NO_PAYMENT_FOR_JOB`, `QUOTE_EXPIRED`, `NOT_THIS_JOB`, `OTHER_WALLET`, `SHORT_PAYMENT`, `PAYMENT_USED`, `CHAIN_NOT_READY`, `NOT_CONFIRMED`, `TIMED_OUT`, `NOT_A_HASH`.
  - `asset-tokens.ts`: `type AssetUploadRow = { id: string; quantity: number; attributes: Json; position: number | null; created_at: string }`; `type AssetToken = { id: number; uploadId: string; attributes: Json }`; `type AssetProblem = { code: 'files' | 'ids' | 'size'; message: string }`; `orderAssetRows(rows: AssetUploadRow[]): AssetUploadRow[]`; `buildAssetTokenList(rows: AssetUploadRow[]): AssetToken[]`; `canonicalAssetList(tokens: AssetToken[]): string`; `hashAssetTokenList(tokens: AssetToken[]): Promise<Hex>`; `assetListProblems(tokens: AssetToken[], projectType: ProjectType): AssetProblem[]`.
  - `quote.ts`: `quoteTotalWei(projectType: ProjectType, feePerTokenWei: bigint, tokenCount: number): bigint`; `quoteExpired(expiresAt: number, now: number): boolean`; `feeReady(fee: bigint | null): fee is bigint`.
  - `art-paid.ts`: `type ReceiptLike = { status: 'success' | 'reverted'; logs: readonly Pick<Log, 'address' | 'data' | 'topics'>[] }`; `type ArtPaidMatch = { ok: true; payer: Address; amount: bigint } | { ok: false; error: string }`; `matchArtPaid(receipt: ReceiptLike, expected: { factory: Address; jobId: Hex; payer: string; minAmount: bigint }): ArtPaidMatch`.
  - `render-job.ts`: `type JobRow`; `JOB_COLUMNS`; `type JobPlaceholder = { uploadId: string; mediaType: MediaType } | null`; `ZERO_HASH`, `ZERO_ADDRESS`; `toRenderJob(row: JobRow, extra: { factory: Address | null; placeholder: JobPlaceholder }): RenderJob`; `pendingJob(chainId: number | null, placeholder: JobPlaceholder): RenderJob`; `jobBase(job: RenderJob): RenderJobBase`.
  - `lock-collection.ts`: `type LockClient = SupabaseClient<Database>`; `LOCK_COLLECTION_COLUMNS`; `type LockCollection` (collections `id, owner_id, name, project_type, status, art_deferred, art_locked_at, chain_id, max_supply, token_name, token_description, show_blank_traits, generation_seed, canvas_width, canvas_height`); `readLockCollection(supabase: LockClient, collectionId: string): Promise<LockCollection | null>`.
  - `owned.ts`: `type OwnedAny = { error: string } | { error?: undefined; supabase: ArtClient; user: SessionUser; collection: LockCollection }`; `ownedCollection(collectionId: string): Promise<OwnedAny>`.
  - `lib/demo/types.ts`: `RenderJobState = 'locked' | 'payment_due' | 'paid' | 'waived' | 'rendering' | 'done' | 'failed'`; exported `RenderJobBase`, `RenderPayment`, `RenderBatches`; `ArtFeeQuote.factory?: Address | null`; `RenderPlaceholder.uploadId?: string`; post-payment states carry `payment: RenderPayment | null` and `batches`; `failed` carries `error: string | null`.
  - `lib/demo/data.ts`: `type SampleJobState = 'locked' | 'payment_due' | 'rendering' | 'done'`; `getRenderJob(state: SampleJobState, options?): RenderJob`.

Decision: a 1/1's ids follow the stored file order (position, then upload time, then id) with each file's editions in a row; the Assets screen's "Shuffled" order already writes `position`, so it carries into the lock. The lock reads the rows in that order and so does `art_lock`.

Decision: the asset list carries each file's `attributes` exactly as stored (raw jsonb), so `art_lock` compares them with jsonb equality and the hash covers what was locked.

Decision: `ArtFeeQuote` gains `factory`, filled by the server from `FACTORY_ADDRESS_<chainId>`, because the browser has no access to server environment variables and the pay step needs the address to simulate `payForArt`.

Decision: every state after payment carries `payment: RenderPayment | null`, because a single asset and a placeholder are `paid` with no transaction; the sample data keeps its payments.

Decision: a real job's `placeholder` is the collection's latest `placeholder` upload ("Reveal later" stores its file before the lock); a placeholder job's is its own `placeholder_upload_id`. The CID stays `''` until Phase 4 pins it.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/lib/art/asset-tokens.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  assetListProblems,
  buildAssetTokenList,
  hashAssetTokenList,
  orderAssetRows,
  type AssetToken,
  type AssetUploadRow,
} from './asset-tokens'

const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const C = '00000000-0000-4000-8000-00000000000c'
const T1 = '2026-10-09T10:00:00.1+00:00'
const T2 = '2026-10-09T10:00:00.25+00:00'
const MOON = [{ value: 'Moon', traitType: 'Name' }]

const row = (
  id: string,
  quantity: number,
  position: number | null,
  created_at: string,
  attributes: AssetUploadRow['attributes'] = [],
): AssetUploadRow => ({ id, quantity, position, created_at, attributes })

describe('buildAssetTokenList', () => {
  it('expands editions to contiguous ids in file order, carrying each file attributes as stored', () => {
    expect(buildAssetTokenList([row(B, 1, 1, T1, MOON), row(A, 2, 0, T2)])).toEqual([
      { id: 1, uploadId: A, attributes: [] },
      { id: 2, uploadId: A, attributes: [] },
      { id: 3, uploadId: B, attributes: MOON },
    ])
  })

  it('puts files without a position last, then orders by upload time and id, as art_lock does', () => {
    const ordered = orderAssetRows([row(C, 1, null, T1), row(B, 1, null, T1), row(A, 1, 0, T2)])
    expect(ordered.map((r) => r.id)).toEqual([A, B, C])
    expect(orderAssetRows([row(B, 1, null, T2), row(A, 1, null, T1)]).map((r) => r.id)).toEqual([A, B])
  })

  it('makes a single asset one file with quantity tokens', () => {
    expect(buildAssetTokenList([row(A, 4, null, T1)]).map((t) => [t.id, t.uploadId])).toEqual([
      [1, A],
      [2, A],
      [3, A],
      [4, A],
    ])
  })
})

describe('hashAssetTokenList', () => {
  it('gives the same hash for the same list in any order, and for the rows in any order', async () => {
    const rows = [row(A, 2, 0, T1), row(B, 1, 1, T2, MOON)]
    const list = buildAssetTokenList(rows)
    const hash = await hashAssetTokenList(list)
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/)
    expect(await hashAssetTokenList([...list].reverse())).toBe(hash)
    expect(await hashAssetTokenList(buildAssetTokenList([...rows].reverse()))).toBe(hash)
  })

  it('changes when an attribute changes', async () => {
    const list = buildAssetTokenList([row(A, 1, 0, T1, MOON)])
    const changed = buildAssetTokenList([row(A, 1, 0, T1, [{ value: 'Sun', traitType: 'Name' }])])
    expect(await hashAssetTokenList(changed)).not.toBe(await hashAssetTokenList(list))
  })
})

describe('assetListProblems', () => {
  it('passes a list of contiguous ids within the cap', () => {
    expect(assetListProblems(buildAssetTokenList([row(A, 3, 0, T1)]), 'one_of_one')).toEqual([])
  })

  it('asks for a file when there is none', () => {
    expect(assetListProblems([], 'single_asset')).toEqual([
      { code: 'files', message: 'Add at least one file before locking.' },
    ])
  })

  it('refuses gaps in the ids', () => {
    const gappy: AssetToken[] = [
      { id: 1, uploadId: A, attributes: [] },
      { id: 3, uploadId: A, attributes: [] },
    ]
    expect(assetListProblems(gappy, 'one_of_one')).toEqual([
      { code: 'ids', message: 'Token ids must run from 1 to 2 with no gaps or repeats.' },
    ])
  })

  it("refuses more tokens than the project type's cap", () => {
    const list = buildAssetTokenList([row(A, 4_001, 0, T1)])
    expect(assetListProblems(list, 'single_asset')).toEqual([
      { code: 'size', message: 'The files make 4,001 tokens. This project can have at most 4,000.' },
    ])
  })
})
```

`apps/web/src/lib/art/quote.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { feeReady, quoteExpired, quoteTotalWei } from './quote'

describe('quoteTotalWei', () => {
  it('is the rate times the tokens, exactly, past 2^53', () => {
    expect(quoteTotalWei('generative', 25_000_000_000_000n, 10_000)).toBe(250_000_000_000_000_000n)
    expect(quoteTotalWei('one_of_one', 3n, 7)).toBe(21n)
  })

  it('is zero for a single asset', () => {
    expect(quoteTotalWei('single_asset', 25_000_000_000_000n, 4_000)).toBe(0n)
  })
})

describe('quoteExpired', () => {
  it('expires after the last second, not at it', () => {
    expect(quoteExpired(100, 99)).toBe(false)
    expect(quoteExpired(100, 100)).toBe(false)
    expect(quoteExpired(100, 101)).toBe(true)
  })
})

describe('feeReady (Review Focus 5)', () => {
  it('refuses an unconfigured chain and a zero rate, which would make a free job', () => {
    expect(feeReady(null)).toBe(false)
    expect(feeReady(0n)).toBe(false)
    expect(feeReady(1n)).toBe(true)
  })
})
```

`apps/web/src/lib/chain/art-paid.test.ts`:

```ts
import { factoryAbi } from '@cobweb/shared'
import { encodeAbiParameters, encodeEventTopics, type Address, type Hex } from 'viem'
import { describe, expect, it } from 'vitest'
import { NOT_THIS_JOB, OTHER_WALLET, SHORT_PAYMENT } from '@/lib/art/result'
import { matchArtPaid, type ReceiptLike } from './art-paid'

const FACTORY: Address = '0x5FbDB2315678afecb367f032d93F642f64180aa3'
const ELSEWHERE: Address = '0x0000000000000000000000000000000000000AbC'
const JOB: Hex = `0x0f4a0f3e2f5e4e3a9d1c1b2c3d4e5f60${'0'.repeat(32)}`
const OTHER_JOB: Hex = `0x1f4a0f3e2f5e4e3a9d1c1b2c3d4e5f61${'0'.repeat(32)}`
const PAYER: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const STRANGER: Address = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'

type ReceiptLog = ReceiptLike['logs'][number]

function artPaid(address: Address, jobId: Hex, payer: Address, amount: bigint): ReceiptLog {
  const topics = encodeEventTopics({ abi: factoryAbi, eventName: 'ArtPaid', args: { jobId, payer } })
  return {
    address,
    topics: topics as ReceiptLog['topics'],
    data: encodeAbiParameters([{ type: 'uint256' }], [amount]),
  }
}

const receipt = (...logs: ReceiptLog[]): ReceiptLike => ({ status: 'success', logs })
const expected = { factory: FACTORY, jobId: JOB, payer: PAYER.toLowerCase(), minAmount: 100n }

describe('matchArtPaid', () => {
  it("matches the factory's ArtPaid log for this job from the quote's wallet with at least the quote", () => {
    expect(matchArtPaid(receipt(artPaid(FACTORY, JOB, PAYER, 100n)), expected)).toEqual({
      ok: true,
      payer: PAYER,
      amount: 100n,
    })
    expect(matchArtPaid(receipt(artPaid(FACTORY, JOB, PAYER, 150n)), expected)).toEqual({
      ok: true,
      payer: PAYER,
      amount: 150n,
    })
  })

  it('refuses a payment for another job', () => {
    expect(matchArtPaid(receipt(artPaid(FACTORY, OTHER_JOB, PAYER, 100n)), expected)).toEqual({
      ok: false,
      error: NOT_THIS_JOB,
    })
  })

  it('refuses a payment from another wallet', () => {
    expect(matchArtPaid(receipt(artPaid(FACTORY, JOB, STRANGER, 100n)), expected)).toEqual({
      ok: false,
      error: OTHER_WALLET,
    })
  })

  it('refuses a payment short of the quote', () => {
    expect(matchArtPaid(receipt(artPaid(FACTORY, JOB, PAYER, 99n)), expected)).toEqual({
      ok: false,
      error: SHORT_PAYMENT,
    })
  })

  it('refuses a receipt with no ArtPaid log, and one that reverted', () => {
    expect(matchArtPaid(receipt(), expected)).toEqual({ ok: false, error: NOT_THIS_JOB })
    expect(
      matchArtPaid({ status: 'reverted', logs: [artPaid(FACTORY, JOB, PAYER, 100n)] }, expected),
    ).toEqual({ ok: false, error: NOT_THIS_JOB })
  })

  it('ignores an ArtPaid log emitted by any other contract', () => {
    expect(matchArtPaid(receipt(artPaid(ELSEWHERE, JOB, PAYER, 100n)), expected)).toEqual({
      ok: false,
      error: NOT_THIS_JOB,
    })
  })

  it("skips the factory's other logs and finds the matching one among several", () => {
    const unrelated: ReceiptLog = { address: FACTORY, topics: [`0x${'12'.repeat(32)}`], data: '0x' }
    expect(
      matchArtPaid(
        receipt(unrelated, artPaid(FACTORY, JOB, PAYER, 10n), artPaid(FACTORY, JOB, PAYER, 100n)),
        expected,
      ),
    ).toEqual({ ok: true, payer: PAYER, amount: 100n })
  })
})
```

`apps/web/src/lib/art/render-job.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { JOB_COLUMNS, pendingJob, toRenderJob, ZERO_ADDRESS, type JobRow } from './render-job'

const JOB = '0f4a0f3e-2f5e-4e3a-9d1c-1b2c3d4e5f60'
const ONCHAIN = `0x0f4a0f3e2f5e4e3a9d1c1b2c3d4e5f60${'0'.repeat(32)}`
const FACTORY = '0x5FbDB2315678afecb367f032d93F642f64180aa3'
const PAYER = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8'
const TX = `0x${'ab'.repeat(32)}`
const at = (iso: string) => Date.parse(iso) / 1000

const row = (overrides: Partial<JobRow> = {}): JobRow => ({
  id: JOB,
  collection_id: '1f4a0f3e-2f5e-4e3a-9d1c-1b2c3d4e5f61',
  kind: 'real',
  state: 'payment_due',
  token_count: 3,
  token_list_hash: `0x${'cd'.repeat(32)}`,
  allow_duplicates: true,
  fee_per_token_wei: '83333333333333334',
  quote_total_wei: '250000000000000001',
  quote_chain_id: 31337,
  quote_payer: PAYER,
  quote_expires_at: '2026-10-10T10:00:00+00:00',
  payment_tx_hash: null,
  paid_at: null,
  paid_amount_wei: null,
  batch_size: 100,
  batches_total: 1,
  batches_done: 0,
  images_cid: null,
  metadata_cid: null,
  placeholder_upload_id: null,
  onchain_job_id: ONCHAIN,
  error: null,
  created_at: '2026-10-09T10:00:00+00:00',
  started_at: null,
  finished_at: null,
  ...overrides,
})

const extra = { factory: FACTORY, placeholder: null } as const

describe('toRenderJob', () => {
  it('maps a job waiting for payment, every wei kept exact (Review Focus 3)', () => {
    const job = toRenderJob(row(), extra)
    expect(job).toMatchObject({
      id: JOB,
      state: 'payment_due',
      jobId: ONCHAIN,
      tokenCount: 3,
      lockedAt: at('2026-10-09T10:00:00Z'),
      lockOptions: { allowDuplicates: true },
      placeholder: null,
      quote: {
        chainId: 31337,
        perTokenWei: '83333333333333334',
        tokenCount: 3,
        totalWei: '250000000000000001',
        payer: PAYER,
        expiresAt: at('2026-10-10T10:00:00Z'),
        factory: FACTORY,
      },
    })
  })

  it('reads every numeric wei column as text', () => {
    for (const column of ['fee_per_token_wei::text', 'quote_total_wei::text', 'paid_amount_wei::text'])
      expect(JOB_COLUMNS).toContain(column)
  })

  it('maps paid with its payment, and waived or zero-quote paid without one', () => {
    const paid = toRenderJob(
      row({
        state: 'paid',
        payment_tx_hash: TX,
        paid_at: '2026-10-09T11:00:00+00:00',
        paid_amount_wei: '250000000000000001',
      }),
      extra,
    )
    expect(paid).toMatchObject({
      state: 'paid',
      payment: { txHash: TX, paidAt: at('2026-10-09T11:00:00Z'), amountWei: '250000000000000001' },
      batches: { total: 1, done: 0, size: 100 },
    })
    expect(toRenderJob(row({ state: 'waived' }), extra)).toMatchObject({ state: 'waived', payment: null })
    expect(toRenderJob(row({ state: 'paid', quote_total_wei: '0' }), extra)).toMatchObject({
      state: 'paid',
      payment: null,
    })
  })

  it('maps failed with its error, rendering with its start, done with its CIDs', () => {
    expect(toRenderJob(row({ state: 'failed', error: 'Batch 3 failed.' }), extra)).toMatchObject({
      state: 'failed',
      error: 'Batch 3 failed.',
    })
    expect(
      toRenderJob(row({ state: 'rendering', paid_at: '2026-10-09T11:00:00+00:00', batches_done: 1 }), extra),
    ).toMatchObject({ state: 'rendering', startedAt: at('2026-10-09T11:00:00Z'), batches: { done: 1 } })
    expect(
      toRenderJob(
        row({
          state: 'done',
          started_at: '2026-10-09T11:00:00+00:00',
          finished_at: '2026-10-09T11:30:00+00:00',
          images_cid: 'bafyimages',
          metadata_cid: 'bafymeta',
        }),
        extra,
      ),
    ).toMatchObject({
      state: 'done',
      finishedAt: at('2026-10-09T11:30:00Z'),
      imagesCid: 'bafyimages',
      metadataCid: 'bafymeta',
    })
  })

  it('serves the placeholder file through the app and keeps its upload id', () => {
    const job = toRenderJob(row({ kind: 'placeholder', state: 'paid' }), {
      factory: null,
      placeholder: { uploadId: 'u-1', mediaType: 'gif' },
    })
    expect(job.placeholder).toEqual({
      cid: '',
      mediaType: 'gif',
      imageUrl: '/api/uploads/u-1',
      uploadId: 'u-1',
    })
    expect(job.quote.factory).toBeNull()
  })
})

describe('pendingJob', () => {
  it('is a job with nothing locked yet, on the collection chain', () => {
    expect(pendingJob(8453, null)).toMatchObject({
      state: 'locked',
      tokenCount: 0,
      quote: { chainId: 8453, totalWei: '0', payer: ZERO_ADDRESS, factory: null },
      placeholder: null,
    })
    expect(pendingJob(null, null).quote.chainId).toBe(0)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @cobweb/web exec vitest run src/lib/art/asset-tokens.test.ts src/lib/art/quote.test.ts src/lib/chain/art-paid.test.ts src/lib/art/render-job.test.ts`
Expected: FAIL in all four files: the modules do not exist yet.

- [ ] **Step 3: Implement**

Append to `apps/web/src/lib/art/result.ts`:

```ts
// Lock and pay (docs/specs/2026-10-09-lock-and-pay.md). The database raises these as they are.
export const ALREADY_LOCKED = 'The art is already locked.'
export const ART_CHANGED = 'The art changed while locking. Review it again.'
export const NOTHING_TO_LOCK = 'There is nothing to lock yet.'
export const PAYER_NOT_YOU = 'The quote must be issued to your sign-in wallet.'
export const FEE_NOT_WHOLE = 'The fee must be a whole number of wei.'
export const HASH_INVALID = 'The token list hash is not valid.'
export const NO_CHAIN = 'Choose the network the fee is paid on.'
export const NOT_LOCKED = 'The art is not locked.'
export const PAID_STAYS_LOCKED = 'The art is paid for and stays locked.'
export const NOT_DEFERRED = 'Only a collection that finishes its art later locks a placeholder alone.'
export const NO_PLACEHOLDER = 'Choose a placeholder file first.'
export const PLACEHOLDER_LOCKED = 'The placeholder is already locked.'
export const NO_PAYMENT_DUE = 'There is no payment waiting for this collection.'
export const QUOTE_NOT_EXPIRED = 'The quote has not expired yet.'
export const NO_PAYMENT_FOR_JOB = 'There is no payment waiting for this job.'
export const QUOTE_EXPIRED = 'The quote expired. Get a new quote.'
export const NOT_THIS_JOB = 'The transaction did not pay for this job.'
export const OTHER_WALLET = 'The payment came from a different wallet than the quote.'
export const SHORT_PAYMENT = 'The payment was less than the quote.'
export const PAYMENT_USED = 'This payment was already used.'
// Said by the server or the screen.
export const CHAIN_NOT_READY = 'This chain is not ready for payments yet.'
export const NOT_CONFIRMED = 'The payment has not been confirmed on chain yet.'
export const TIMED_OUT = 'The payment is not confirmed yet. Try again in a minute; you will not pay twice.'
export const NOT_A_HASH = 'That is not a transaction hash.'
```

`apps/web/src/lib/art/asset-tokens.ts`:

```ts
import { buildOneOfOneTokens } from '@/components/art/assets/token-list'
import { supplyLimit, type ProjectType } from '@/lib/collections'
import type { Json } from '@/lib/database.types'

/** An `uploads` row of kind asset, as the lock reads it. */
export type AssetUploadRow = {
  id: string
  quantity: number
  attributes: Json
  position: number | null
  created_at: string
}

/** One token of a 1/1 or single asset list: what `art_lock` checks and `render_jobs.token_list` stores. */
export type AssetToken = { id: number; uploadId: string; attributes: Json }

export type AssetProblem = { code: 'files' | 'ids' | 'size'; message: string }

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/**
 * File order as `art_lock` reads it: position (unset last), then upload time, then id. PostgREST
 * writes every `created_at` with the same offset, so the strings compare as the times do.
 */
export function orderAssetRows(rows: AssetUploadRow[]): AssetUploadRow[] {
  const unplaced = Number.MAX_SAFE_INTEGER
  return [...rows].sort(
    (a, b) =>
      (a.position ?? unplaced) - (b.position ?? unplaced) ||
      compare(a.created_at, b.created_at) ||
      compare(a.id, b.id),
  )
}

/**
 * The token list of a 1/1 or single asset project (spec section 5): every edition of every file, ids
 * 1 to N in file order with each file's editions in a row, each carrying its file's attributes as
 * stored. A single asset is one file with `quantity` tokens.
 */
export function buildAssetTokenList(rows: AssetUploadRow[]): AssetToken[] {
  const ordered = orderAssetRows(rows)
  const attributes = new Map(ordered.map((row) => [row.id, row.attributes]))
  const tokens = buildOneOfOneTokens(
    ordered.map((row) => ({ key: row.id, fileName: row.id, quantity: row.quantity, attributes: [] })),
    { name: 'Token', description: '', order: 'upload', seed: 0 },
  )
  return tokens.map((token) => ({
    id: token.id,
    uploadId: token.itemKey,
    attributes: attributes.get(token.itemKey) ?? [],
  }))
}

/** The form that is hashed: `[id, uploadId, attributes]` sorted by id, as compact JSON. */
export function canonicalAssetList(tokens: AssetToken[]): string {
  return JSON.stringify(
    [...tokens].sort((a, b) => a.id - b.id).map((token) => [token.id, token.uploadId, token.attributes]),
  )
}

/** SHA-256 of the canonical form, as `0x` and 64 lowercase hex characters, like `hashTokenList` in @cobweb/dna. */
export async function hashAssetTokenList(tokens: AssetToken[]): Promise<`0x${string}`> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalAssetList(tokens)))
  return `0x${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

/** The checks for an asset list (spec section 5): at least one file, contiguous ids, within the type's cap. */
export function assetListProblems(tokens: AssetToken[], projectType: ProjectType): AssetProblem[] {
  if (tokens.length === 0) return [{ code: 'files', message: 'Add at least one file before locking.' }]
  const problems: AssetProblem[] = []
  const ids = tokens.map((token) => token.id).sort((a, b) => a - b)
  if (ids.some((id, index) => id !== index + 1))
    problems.push({
      code: 'ids',
      message: `Token ids must run from 1 to ${tokens.length.toLocaleString('en-US')} with no gaps or repeats.`,
    })
  const limit = supplyLimit(projectType)
  if (tokens.length > limit)
    problems.push({
      code: 'size',
      message: `The files make ${tokens.length.toLocaleString('en-US')} tokens. This project can have at most ${limit.toLocaleString('en-US')}.`,
    })
  return problems
}
```

`apps/web/src/lib/art/quote.ts`:

```ts
import type { ProjectType } from '@/lib/collections'

/** The quote in wei: the factory's rate times the tokens. A single asset pays nothing (MASTER_PLAN, art fee). */
export function quoteTotalWei(projectType: ProjectType, feePerTokenWei: bigint, tokenCount: number): bigint {
  return projectType === 'single_asset' ? 0n : feePerTokenWei * BigInt(tokenCount)
}

/** Whether a quote that runs until `expiresAt` (unix seconds) has expired at `now` (unix seconds). */
export function quoteExpired(expiresAt: number, now: number): boolean {
  return expiresAt < now
}

/** A rate the lock can quote from: read from a configured factory, and above zero (zero would be a free job). */
export function feeReady(fee: bigint | null): fee is bigint {
  return fee !== null && fee > 0n
}
```

`apps/web/src/lib/chain/art-paid.ts`:

```ts
import { factoryAbi } from '@cobweb/shared'
import { decodeEventLog, type Address, type Hex, type Log } from 'viem'
import { NOT_THIS_JOB, OTHER_WALLET, SHORT_PAYMENT } from '@/lib/art/result'

/** What `matchArtPaid` reads of a transaction receipt. viem's `TransactionReceipt` fits it. */
export type ReceiptLike = {
  status: 'success' | 'reverted'
  logs: readonly Pick<Log, 'address' | 'data' | 'topics'>[]
}

export type ArtPaidMatch = { ok: true; payer: Address; amount: bigint } | { ok: false; error: string }

/**
 * Finds the factory's `ArtPaid` log for a job in a receipt and checks it against the quote (spec
 * section 7): the log must come from the factory's address and carry the job's id; the payer must
 * be the quote's wallet and the amount at least the quote. The payer and amount come from the log,
 * never from the browser.
 */
export function matchArtPaid(
  receipt: ReceiptLike,
  expected: { factory: Address; jobId: Hex; payer: string; minAmount: bigint },
): ArtPaidMatch {
  if (receipt.status !== 'success') return { ok: false, error: NOT_THIS_JOB }
  const paid: { payer: Address; amount: bigint }[] = []
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== expected.factory.toLowerCase()) continue
    try {
      const event = decodeEventLog({
        abi: factoryAbi,
        eventName: 'ArtPaid',
        data: log.data,
        topics: log.topics,
      })
      if (event.args.jobId.toLowerCase() === expected.jobId.toLowerCase())
        paid.push({ payer: event.args.payer, amount: event.args.amount })
    } catch {
      // Another event of the factory.
    }
  }
  if (paid.length === 0) return { ok: false, error: NOT_THIS_JOB }
  const fromPayer = paid.filter((entry) => entry.payer.toLowerCase() === expected.payer.toLowerCase())
  if (fromPayer.length === 0) return { ok: false, error: OTHER_WALLET }
  const enough = fromPayer.find((entry) => entry.amount >= expected.minAmount)
  if (!enough) return { ok: false, error: SHORT_PAYMENT }
  return { ok: true, payer: enough.payer, amount: enough.amount }
}
```

In `apps/web/src/lib/demo/types.ts`, replace everything from the line `/** A render job's state. Replaced by: \`render_jobs.state\` (Phase 4). */`down to the end of the`RenderJob`type (the line before the`// Deploy (Phase 5)` banner block) with:

```ts
/** A render job's state: `render_jobs.state`. */
export type RenderJobState = 'locked' | 'payment_due' | 'paid' | 'waived' | 'rendering' | 'done' | 'failed'

/** The art-fee quote issued at lock, from the factory's `artFeePerToken()` (render_jobs quote columns). */
export type ArtFeeQuote = {
  chainId: number
  /** `artFeePerToken` at the time of the quote. */
  perTokenWei: string
  tokenCount: number
  totalWei: string
  /** The wallet the quote was issued to; only its payment counts. */
  payer: Address
  /** Quote expiry, unix seconds. */
  expiresAt: number
  /**
   * The factory `payForArt` is paid to, filled in by the server from `FACTORY_ADDRESS_<chainId>`;
   * null when the chain is not configured. Sample data has none.
   */
  factory?: Address | null
}

/**
 * The pre-reveal placeholder (MASTER_PLAN, Flow: pre-reveal): one file every token shows until the
 * reveal, pinned to its own small CID in Phase 4 (`cid` is '' until then).
 */
export type RenderPlaceholder = {
  cid: string
  mediaType: MediaType
  /** A preview of the file. For a video this is the MP4. */
  imageUrl: string
  /** The `uploads` row behind the file. Sample data has none. */
  uploadId?: string
}

export type RenderJobBase = {
  id: string
  /** The factory job id passed to `payForArt(jobId)` (`render_jobs.onchain_job_id`). */
  jobId: Hex
  tokenCount: number
  lockedAt: number
  /** Hash of the token list stored at lock (MASTER_PLAN, Art: lock check). */
  tokenListHash: Hex
  quote: ArtFeeQuote
  /** What the creator chose under "Lock options". `allowDuplicates`: identical trait combinations are accepted. */
  lockOptions: { allowDuplicates: boolean }
  /**
   * Set when the creator chose "Reveal later": the contract starts on this placeholder and reveals
   * to the real metadata from Settings. Null when the contract starts on the real art.
   */
  placeholder: RenderPlaceholder | null
}

/** The payment recorded from the factory's `ArtPaid` event. */
export type RenderPayment = { txHash: Hex; paidAt: number; amountWei: string }

/** Coarse progress: batches done of total. There is no per-image status. */
export type RenderBatches = { total: number; done: number; size: number }

/**
 * A render job in one of its states (`render_jobs`). Every state after payment carries the payment,
 * or null when nothing was owed (a single asset, a placeholder) or the job was waived.
 */
export type RenderJob =
  | (RenderJobBase & { state: 'locked' })
  | (RenderJobBase & { state: 'payment_due' })
  | (RenderJobBase & { state: 'paid' | 'waived'; payment: RenderPayment | null; batches: RenderBatches })
  | (RenderJobBase & {
      state: 'failed'
      payment: RenderPayment | null
      batches: RenderBatches
      error: string | null
    })
  | (RenderJobBase & {
      state: 'rendering'
      payment: RenderPayment | null
      batches: RenderBatches
      startedAt: number
    })
  | (RenderJobBase & {
      state: 'done'
      payment: RenderPayment | null
      batches: RenderBatches
      startedAt: number
      finishedAt: number
      /**
       * The real set. Null when the art is deferred (MASTER_PLAN, Flow: pre-reveal) and this run rendered only the
       * placeholder; the real set is locked and rendered in a second run once the art is finished.
       */
      imagesCid: string | null
      metadataCid: string | null
    })
```

In `apps/web/src/lib/demo/data.ts`, replace:

```ts
type RenderJobsByState = {
  [S in RenderJobState]: Extract<RenderJob, { state: S }>
}
```

with:

```ts
/** The states the sample shows on Lock and upload (`?job=`). */
export type SampleJobState = Extract<RenderJobState, 'locked' | 'payment_due' | 'rendering' | 'done'>

type RenderJobsByState = {
  [S in SampleJobState]: Extract<RenderJob, { state: S }>
}
```

and replace:

```ts
export function getRenderJob(state: RenderJobState, options: { artDeferred?: boolean } = {}): RenderJob {
```

with:

```ts
export function getRenderJob(state: SampleJobState, options: { artDeferred?: boolean } = {}): RenderJob {
```

In `apps/web/src/app/collections/[id]/upload/page.tsx`, replace `import { getChain, getRenderJob, type RenderJobState } from '@/lib/demo'` with `import { getChain, getRenderJob, type SampleJobState } from '@/lib/demo'`, and every other `RenderJobState` in the file (`JOB_STATES`, `STATE_FOR_STATUS` and the `requested` cast) with `SampleJobState`. Task 6 rewrites this page; this keeps it compiling until then.

In `apps/web/src/components/upload/upload-flow.tsx`, replace the `STAGE_FOR_JOB` constant with:

```ts
const STAGE_FOR_JOB: Record<RenderJob['state'], Stage> = {
  locked: 'review',
  payment_due: 'pay',
  paid: 'render',
  waived: 'render',
  rendering: 'render',
  failed: 'render',
  done: 'done',
}
```

and replace:

```ts
const [paymentTx, setPaymentTx] = useState<Hex | null>('payment' in job ? job.payment.txHash : null)
```

with:

```ts
const [paymentTx, setPaymentTx] = useState<Hex | null>(
  'payment' in job ? (job.payment?.txHash ?? null) : null,
)
```

`apps/web/src/lib/art/render-job.ts`:

```ts
import type { Address, Hex } from 'viem'
import type { Enums } from '@/lib/database.types'
import type { MediaType, RenderJob, RenderJobBase, RenderPlaceholder } from '@/lib/demo/types'
import { servedUrl } from '@/lib/storage/uploads-service'

/** A render_jobs row as the lock core reads it (`JOB_COLUMNS`): the wei columns arrive as text. */
export type JobRow = {
  id: string
  collection_id: string
  kind: Enums<'render_kind'>
  state: Enums<'render_state'>
  token_count: number
  token_list_hash: string | null
  allow_duplicates: boolean
  fee_per_token_wei: string
  quote_total_wei: string
  quote_chain_id: number | null
  quote_payer: string | null
  quote_expires_at: string | null
  payment_tx_hash: string | null
  paid_at: string | null
  paid_amount_wei: string | null
  batch_size: number
  batches_total: number
  batches_done: number
  images_cid: string | null
  metadata_cid: string | null
  placeholder_upload_id: string | null
  onchain_job_id: string
  error: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
}

/**
 * The select for a `JobRow`. PostgREST returns numeric as a JSON number, which rounds anything past
 * 2^53 wei; the casts keep every wei (Review Focus 3).
 */
export const JOB_COLUMNS =
  'id, collection_id, kind, state, token_count, token_list_hash, allow_duplicates, fee_per_token_wei::text, quote_total_wei::text, quote_chain_id, quote_payer, quote_expires_at, payment_tx_hash, paid_at, paid_amount_wei::text, batch_size, batches_total, batches_done, images_cid, metadata_cid, placeholder_upload_id, onchain_job_id, error, created_at, started_at, finished_at'

/** The placeholder file a job shows: its own for a placeholder job, the collection's latest for a real one. */
export type JobPlaceholder = { uploadId: string; mediaType: MediaType } | null

export const ZERO_HASH: Hex = `0x${'0'.repeat(64)}`
export const ZERO_ADDRESS: Address = `0x${'0'.repeat(40)}`

const seconds = (iso: string | null) => (iso ? Math.floor(Date.parse(iso) / 1000) : 0)

function placeholderOf(placeholder: JobPlaceholder): RenderPlaceholder | null {
  return placeholder
    ? {
        cid: '',
        mediaType: placeholder.mediaType,
        imageUrl: servedUrl(placeholder.uploadId),
        uploadId: placeholder.uploadId,
      }
    : null
}

/** A render_jobs row as the Lock and upload screen's `RenderJob` (spec section 7). */
export function toRenderJob(
  row: JobRow,
  extra: { factory: Address | null; placeholder: JobPlaceholder },
): RenderJob {
  const base: RenderJobBase = {
    id: row.id,
    jobId: row.onchain_job_id as Hex,
    tokenCount: row.token_count,
    lockedAt: seconds(row.created_at),
    tokenListHash: (row.token_list_hash ?? ZERO_HASH) as Hex,
    quote: {
      chainId: row.quote_chain_id ?? 0,
      perTokenWei: row.fee_per_token_wei,
      tokenCount: row.token_count,
      totalWei: row.quote_total_wei,
      payer: (row.quote_payer ?? ZERO_ADDRESS) as Address,
      expiresAt: seconds(row.quote_expires_at),
      factory: extra.factory,
    },
    lockOptions: { allowDuplicates: row.allow_duplicates },
    placeholder: placeholderOf(extra.placeholder),
  }
  const payment = row.payment_tx_hash
    ? {
        txHash: row.payment_tx_hash as Hex,
        paidAt: seconds(row.paid_at),
        amountWei: row.paid_amount_wei ?? '0',
      }
    : null
  const batches = { total: row.batches_total, done: row.batches_done, size: row.batch_size }
  const startedAt = seconds(row.started_at ?? row.paid_at)
  switch (row.state) {
    case 'locked':
      return { ...base, state: 'locked' }
    case 'payment_due':
      return { ...base, state: 'payment_due' }
    case 'paid':
    case 'waived':
      return { ...base, state: row.state, payment, batches }
    case 'failed':
      return { ...base, state: 'failed', payment, batches, error: row.error }
    case 'rendering':
      return { ...base, state: 'rendering', payment, batches, startedAt }
    case 'done':
      return {
        ...base,
        state: 'done',
        payment,
        batches,
        startedAt,
        finishedAt: seconds(row.finished_at),
        imagesCid: row.images_cid,
        metadataCid: row.metadata_cid,
      }
  }
}

/** The screen's job before anything is locked: the review step, no quote yet. */
export function pendingJob(chainId: number | null, placeholder: JobPlaceholder): RenderJob {
  return {
    id: '',
    jobId: ZERO_HASH,
    tokenCount: 0,
    lockedAt: 0,
    tokenListHash: ZERO_HASH,
    quote: {
      chainId: chainId ?? 0,
      perTokenWei: '0',
      tokenCount: 0,
      totalWei: '0',
      payer: ZERO_ADDRESS,
      expiresAt: 0,
      factory: null,
    },
    lockOptions: { allowDuplicates: false },
    placeholder: placeholderOf(placeholder),
    state: 'locked',
  }
}

/** The fields every state shares, to build a job in another state from it (sample mode). */
export function jobBase(job: RenderJob): RenderJobBase {
  const { id, jobId, tokenCount, lockedAt, tokenListHash, quote, lockOptions, placeholder } = job
  return { id, jobId, tokenCount, lockedAt, tokenListHash, quote, lockOptions, placeholder }
}
```

`apps/web/src/lib/art/lock-collection.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Tables } from '@/lib/database.types'

/**
 * The Supabase client the lock code runs on: the signed-in creator's, so row-level security applies.
 * The server actions pass their session client; `verify:chain` passes a signed-in script client.
 */
export type LockClient = SupabaseClient<Database>

export const LOCK_COLLECTION_COLUMNS =
  'id, owner_id, name, project_type, status, art_deferred, art_locked_at, chain_id, max_supply, token_name, token_description, show_blank_traits, generation_seed, canvas_width, canvas_height'

/** The collection columns the lock and pay code reads. */
export type LockCollection = Pick<
  Tables<'collections'>,
  | 'id'
  | 'owner_id'
  | 'name'
  | 'project_type'
  | 'status'
  | 'art_deferred'
  | 'art_locked_at'
  | 'chain_id'
  | 'max_supply'
  | 'token_name'
  | 'token_description'
  | 'show_blank_traits'
  | 'generation_seed'
  | 'canvas_width'
  | 'canvas_height'
>

/** The collection under row-level security, or null when the caller cannot see it. */
export async function readLockCollection(
  supabase: LockClient,
  collectionId: string,
): Promise<LockCollection | null> {
  const { data, error } = await supabase
    .from('collections')
    .select(LOCK_COLLECTION_COLUMNS)
    .eq('id', collectionId)
    .maybeSingle()
  if (error) throw new Error(`The collection could not be read: ${error.message}`)
  return data
}
```

In `apps/web/src/lib/art/owned.ts`, replace the import block at the top with:

```ts
import 'server-only'
import { getVerifiedUser, type SessionUser } from '@/lib/auth'
import type { Tables } from '@/lib/database.types'
import type { Canvas } from '@/lib/storage/admission'
import { createClient } from '@/lib/supabase/server'
import { readLockCollection, type LockCollection } from './lock-collection'
import { LOCKED, NOT_FOUND, SIGNED_OUT } from './result'
```

and append:

```ts
export type OwnedAny =
  | { error: string }
  | { error?: undefined; supabase: ArtClient; user: SessionUser; collection: LockCollection }

/**
 * The collection, only if the signed-in creator owns it, locked or not: the lock and pay actions
 * (docs/specs/2026-10-09-lock-and-pay.md, section 7) run on a locked collection. The same checks as
 * `ownedUnlocked` otherwise; the database checks ownership again in every function.
 */
export async function ownedCollection(collectionId: string): Promise<OwnedAny> {
  const user = await getVerifiedUser()
  if (!user) return { error: SIGNED_OUT }
  if (!UUID.test(collectionId)) return { error: NOT_FOUND }
  const supabase = await createClient()
  const collection = await readLockCollection(supabase, collectionId)
  if (!collection || collection.owner_id !== user.id) return { error: NOT_FOUND }
  return { supabase, user, collection }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @cobweb/web exec vitest run src/lib/art/asset-tokens.test.ts src/lib/art/quote.test.ts src/lib/chain/art-paid.test.ts src/lib/art/render-job.test.ts`
Expected: PASS, 4 files.

- [ ] **Step 5: Root checks and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: clean (the sample Lock and upload screen still compiles against the wider `RenderJob`).

```bash
git add apps/web/src/lib/art apps/web/src/lib/chain apps/web/src/lib/demo/types.ts apps/web/src/lib/demo/data.ts 'apps/web/src/app/collections/[id]/upload/page.tsx' apps/web/src/components/upload/upload-flow.tsx
git commit -F - <<'MSG'
Add the asset token list, the quote, the ArtPaid receipt match, the job mapping and the owner read for locked collections

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bcHX4HZG5YGWhxjGuiWos
MSG
```

---

### Task 4: The lock core, the review, the error mapping and the server actions

**Files:**

- Create: `apps/web/src/lib/supabase/service.ts`, `apps/web/src/lib/art/read-rows.ts`, `apps/web/src/lib/art/lock-review.ts`, `apps/web/src/lib/art/lock-core.ts`, `apps/web/src/lib/art/lock-schemas.ts`, `apps/web/src/lib/art/lock-write.ts`, `apps/web/src/app/actions/lock.ts`
- Test: `apps/web/src/lib/art/lock-review.test.ts`, `apps/web/src/lib/art/lock-schemas.test.ts`
- Modify: `apps/web/src/lib/art/db-error.ts` (`lockWriteError`), `apps/web/src/lib/art/db-error.test.ts`, `apps/web/src/lib/art/load.ts` (uses `readArtRows`; gains `loadPlaceholder`), `apps/web/.env.example` (`SUPABASE_SERVICE_ROLE_KEY`)

**Interfaces:**

- Consumes: Task 1's `chainById`, `factoryAbi`, `factoryAddress`, `publicClientFor` from `@cobweb/shared`; Task 2's five functions through `supabase.rpc`; Task 3's `buildAssetTokenList`, `hashAssetTokenList`, `assetListProblems`, `type AssetToken`, `type AssetUploadRow`, `feeReady`, `matchArtPaid`, `JOB_COLUMNS`, `toRenderJob`, `type JobRow`, `type JobPlaceholder`, `type LockClient`, `type LockCollection`, `ownedCollection`, and the sentences in `result.ts`; `validateTokenList`, `hashTokenList`, `type LockProblem`, `type Project`, `type TokenCore` from `@cobweb/dna`; `toProject(rows: ArtRows): ArtProject` and `type ArtRows` from `./rows`; `readAll` from `./read-all`; `parse`, `uuid` from `./schemas`.
- Produces:
  - `read-rows.ts`: `readArtRows(supabase: LockClient, collectionId: string): Promise<Omit<ArtRows, 'collection'>>`.
  - `lock-review.ts` (pure): `type LockList = { kind: 'generative'; project: Project; tokens: TokenCore[] } | { kind: 'assets'; tokens: AssetToken[] }`; `type ReviewProblem = { code: LockProblem['code'] | 'files'; message: string }`; `type ReviewData = { problems: ReviewProblem[]; tokenCount: number; supply: number; allowDuplicatesNeeded: boolean; counts: { collections: number; layers: number; traits: number; rules: number }; constants: { name: string; count: number }[] }`; `EMPTY_REVIEW: ReviewData`; `reviewData(list: LockList, projectType: ProjectType): ReviewData`; `lockRefusal(review: ReviewData, allowDuplicates: boolean): string | null`; `type ReviewCheck = { key: 'supply' | 'duplicates' | 'rules' | 'caps'; label: string; problems: string[] }`; `reviewChecks(review: ReviewData, allowDuplicates: boolean): ReviewCheck[]`.
  - `lock-core.ts` (no `server-only`, so `verify:chain` imports it): `type LockContext = { supabase: LockClient; service: LockClient; owner: string; wallet: string; collection: LockCollection }` (`supabase` is the creator's RLS client for every read and for `art_unlock` and `art_lock_placeholder`; `service` is the service-role client for `art_lock`, `art_requote` and `art_record_payment`, always with `p_owner: owner`); `type LockOutcome<T> = { data: T } | { error: DbError } | { refused: string }`; `readLockList(supabase, collection): Promise<LockList>`; `reviewLock(ctx): Promise<ReviewData>`; `readArtFee(chainId: number): Promise<bigint | null>`; `latestPlaceholder(supabase, collectionId): Promise<JobPlaceholder>`; `loadJob(supabase, jobId): Promise<RenderJob>`; `lockCore(ctx, input: { allowDuplicates: boolean; chainId: number }): Promise<LockOutcome<RenderJob>>`; `unlockCore(ctx): Promise<LockOutcome<null>>`; `lockPlaceholderCore(ctx, uploadId: string): Promise<LockOutcome<RenderJob>>`; `quoteCore(ctx): Promise<LockOutcome<RenderJob>>`; `confirmCore(ctx, jobId: string, txHash: Hex): Promise<LockOutcome<RenderJob>>`; `renderJobCore(ctx): Promise<LockOutcome<RenderJob | null>>`.
  - `lock-schemas.ts`: `lockArtInput` (`{ allowDuplicates: boolean; chainId: positive integer }`), `type LockArtInput`, `txHash` (lowercased `0x` and 64 hex).
  - `db-error.ts`: `lockWriteError(error: DbError): string`.
  - `supabase/service.ts` (server only): `createServiceClient(): SupabaseClient<Database>` (reads `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; throws "SUPABASE_SERVICE_ROLE_KEY is not set." when missing; no session persistence).
  - `lock-write.ts` (server only): `lockWrite<T>(collectionId: string, run: (ctx: LockContext) => Promise<LockOutcome<T>>): Promise<ActionResult<T>>`.
  - `load.ts`: `loadPlaceholder(collectionId: string): Promise<JobPlaceholder>` (cached per request).
  - Actions in `app/actions/lock.ts`: `reviewArt(collectionId): ActionResult<ReviewData>`; `lockArt(collectionId, { allowDuplicates, chainId }): ActionResult<RenderJob>`; `unlockArt(collectionId): ActionResult<null>`; `lockPlaceholder(collectionId, uploadId): ActionResult<RenderJob>`; `quoteArt(collectionId): ActionResult<RenderJob>`; `confirmArtPayment(collectionId, jobId, txHash): ActionResult<RenderJob>`; `getRenderJob(collectionId): ActionResult<RenderJob | null>` (all `Promise<...>`).

Decision: `reviewArt` also returns the counts and the capped traits the review step's figures show (collections, layers, traits, rules), so the page reads the art once; the spec's four fields are there as named.

Decision: the generative list is the stored `tokens` rows, read by the server; the screen sends no list, so the action validates and hashes exactly what `art_lock` then compares against.

Decision: `lockArt` refuses with the first problem left once identical tokens are allowed (`lockRefusal`), the same sentence the review step shows.

Decision: an unreachable chain, a missing `RPC_URL_<id>` or `FACTORY_ADDRESS_<id>`, or a factory rate of 0 all refuse with "This chain is not ready for payments yet." (Review Focus 5). A single asset does not read the factory at all: it owes nothing.

Decision: the definer functions return the job row, but PostgREST would send its numerics as JSON numbers, so the actions take only the id from it and read the job again with `JOB_COLUMNS`.

Decision: `confirmArtPayment` first looks for the hash on the creator's own jobs and answers "This payment was already used." even for the job's own hash; the screen then reloads the job and treats its own recorded payment as success (Review Focus 4, Task 6).

Decision: `lockWrite` builds the service client only after `ownedCollection` passed (session verified with the auth server, collection read under RLS, owner checked), and hands it to the cores beside the RLS client; the cores use it for nothing but the three service functions, with `p_owner` set to the verified user's id.

Decision: `getRenderJob` returns the collection's placeholder job when `art_deferred` is set and its real job otherwise: the open one, or the latest done or failed one, or null.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/lib/art/lock-review.test.ts`:

```ts
import type { Project, TokenCore } from '@cobweb/dna'
import { describe, expect, it } from 'vitest'
import { lockRefusal, reviewChecks, reviewData, type LockList } from './lock-review'

const project: Project = {
  collections: [{ id: 'c1', name: 'Owls', size: 2 }],
  layers: [
    {
      id: 'l1',
      collectionId: 'c1',
      name: 'Eyes',
      position: 0,
      traits: [
        { id: 'none', layerId: 'l1', name: 'None', weight: 0, blank: true, imageUrl: null },
        { id: 'wide', layerId: 'l1', name: 'Wide', weight: 50, constant: 1, blank: false, imageUrl: null },
        { id: 'sleepy', layerId: 'l1', name: 'Sleepy', weight: 50, blank: false, imageUrl: null },
      ],
    },
  ],
  rules: [],
  atLeastOne: [],
}

const generative = (tokens: TokenCore[]): LockList => ({ kind: 'generative', project, tokens })

describe('reviewData for a generative project', () => {
  it('passes a valid set and counts what will be locked', () => {
    const review = reviewData(
      generative([
        { id: 1, collectionId: 'c1', dna: ['wide'] },
        { id: 2, collectionId: 'c1', dna: ['sleepy'] },
      ]),
      'generative',
    )
    expect(review).toEqual({
      problems: [],
      tokenCount: 2,
      supply: 2,
      allowDuplicatesNeeded: false,
      counts: { collections: 1, layers: 1, traits: 2, rules: 0 },
      constants: [{ name: 'Wide', count: 1 }],
    })
    expect(lockRefusal(review, false)).toBeNull()
  })

  it('offers "Allow identical tokens" only when duplicates are the only problem', () => {
    const review = reviewData(
      generative([
        { id: 1, collectionId: 'c1', dna: ['sleepy'] },
        { id: 2, collectionId: 'c1', dna: ['sleepy'] },
      ]),
      'generative',
    )
    expect(review.problems.map((p) => p.code)).toEqual(['duplicate'])
    expect(review.allowDuplicatesNeeded).toBe(true)
    expect(lockRefusal(review, false)).toMatch(/have the same traits as another token/)
    expect(lockRefusal(review, true)).toBeNull()
  })

  it('keeps refusing a set with other problems even when identical tokens are allowed', () => {
    const review = reviewData(
      generative([
        { id: 1, collectionId: 'c1', dna: ['wide'] },
        { id: 2, collectionId: 'c1', dna: ['wide'] },
      ]),
      'generative',
    )
    expect(review.problems.map((p) => p.code)).toEqual(['cap', 'duplicate'])
    expect(review.allowDuplicatesNeeded).toBe(false)
    expect(lockRefusal(review, true)).toMatch(/more than its cap of 1/)
  })

  it('asks for the set to be generated when there are no tokens', () => {
    const review = reviewData(generative([]), 'generative')
    expect(review.problems[0]).toEqual({ code: 'size', message: 'Generate the set before locking.' })
    expect(lockRefusal(review, true)).toBe('Generate the set before locking.')
  })
})

describe('reviewData for assets', () => {
  it('uses the asset checks and the token count as the supply', () => {
    const list: LockList = {
      kind: 'assets',
      tokens: [1, 2, 3].map((id) => ({ id, uploadId: 'u1', attributes: [] })),
    }
    expect(reviewData(list, 'single_asset')).toMatchObject({ problems: [], tokenCount: 3, supply: 3 })
    expect(reviewData({ kind: 'assets', tokens: [] }, 'one_of_one').problems).toEqual([
      { code: 'files', message: 'Add at least one file before locking.' },
    ])
  })
})

describe('reviewChecks', () => {
  it('sorts the problems into the four checks of the review step', () => {
    const review = reviewData(
      generative([
        { id: 1, collectionId: 'c1', dna: ['wide'] },
        { id: 2, collectionId: 'c1', dna: ['wide'] },
        { id: 3, collectionId: 'c1', dna: ['nope'] },
      ]),
      'generative',
    )
    const checks = reviewChecks(review, false)
    expect(checks.map((c) => [c.key, c.problems.length])).toEqual([
      ['supply', 1],
      ['duplicates', 1],
      ['rules', 1],
      ['caps', 1],
    ])
    expect(reviewChecks(review, true)[1]).toEqual({
      key: 'duplicates',
      label: 'Identical tokens are allowed',
      problems: [],
    })
  })
})
```

`apps/web/src/lib/art/lock-schemas.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { lockArtInput, txHash } from './lock-schemas'
import { NO_CHAIN, NOT_A_HASH } from './result'
import { parse } from './schemas'

describe('lockArtInput', () => {
  it('takes the duplicates choice and a chain id', () => {
    expect(parse(lockArtInput, { allowDuplicates: true, chainId: 31337 })).toEqual({
      ok: true,
      data: { allowDuplicates: true, chainId: 31337 },
    })
  })

  it('refuses a missing or invalid chain', () => {
    expect(parse(lockArtInput, { allowDuplicates: false, chainId: 0 })).toEqual({
      ok: false,
      error: NO_CHAIN,
    })
    expect(parse(lockArtInput, { allowDuplicates: false, chainId: 1.5 })).toEqual({
      ok: false,
      error: NO_CHAIN,
    })
    expect(parse(lockArtInput, { chainId: 1 }).ok).toBe(false)
  })
})

describe('txHash', () => {
  it('lowercases a hash and refuses anything else', () => {
    expect(parse(txHash, `0x${'AB'.repeat(32)}`)).toEqual({ ok: true, data: `0x${'ab'.repeat(32)}` })
    expect(parse(txHash, '0x1234')).toEqual({ ok: false, error: NOT_A_HASH })
  })
})
```

Append to `apps/web/src/lib/art/db-error.test.ts`:

```ts
describe('lockWriteError', () => {
  it('passes the lock and pay sentences through', () => {
    for (const sentence of [
      ALREADY_LOCKED,
      ART_CHANGED,
      NOTHING_TO_LOCK,
      PAYER_NOT_YOU,
      FEE_NOT_WHOLE,
      HASH_INVALID,
      NO_CHAIN,
      NOT_LOCKED,
      PAID_STAYS_LOCKED,
      NOT_DEFERRED,
      NO_PLACEHOLDER,
      PLACEHOLDER_LOCKED,
      NO_PAYMENT_DUE,
      QUOTE_NOT_EXPIRED,
      NO_PAYMENT_FOR_JOB,
      QUOTE_EXPIRED,
      NOT_THIS_JOB,
      OTHER_WALLET,
      SHORT_PAYMENT,
    ])
      expect(lockWriteError({ code: '23514', message: sentence })).toBe(sentence)
  })

  it('maps the owner check and the two unique indexes', () => {
    expect(lockWriteError({ code: '42501', message: 'collection not found' })).toBe(NOT_FOUND)
    expect(lockWriteError({ code: '23505', message: PAYMENT_USED })).toBe(PAYMENT_USED)
    expect(
      lockWriteError({
        code: '23505',
        message: 'duplicate key value violates unique constraint "render_jobs_payment_tx_hash_once"',
      }),
    ).toBe(PAYMENT_USED)
    expect(
      lockWriteError({
        code: '23505',
        message: 'duplicate key value violates unique constraint "render_jobs_one_open_per_kind"',
      }),
    ).toBe(ALREADY_LOCKED)
  })

  it('says "reload" for anything else', () => {
    expect(lockWriteError({ code: '23514', message: 'new row violates check constraint "x"' })).toBe(UNSAVED)
    expect(lockWriteError({ code: '42501', message: 'permission denied for function art_lock' })).toBe(
      UNSAVED,
    )
    expect(lockWriteError(null)).toBe(UNSAVED)
  })
})
```

and replace the imports at the top of `apps/web/src/lib/art/db-error.test.ts` with:

```ts
import { describe, expect, it } from 'vitest'
import { artWriteError, lockWriteError } from './db-error'
import {
  ALREADY_LOCKED,
  ART_CHANGED,
  CLEAR_FIRST,
  FEE_NOT_WHOLE,
  HASH_INVALID,
  LOCKED,
  NO_CHAIN,
  NO_PAYMENT_DUE,
  NO_PAYMENT_FOR_JOB,
  NO_PLACEHOLDER,
  NOT_DEFERRED,
  NOT_FOUND,
  NOT_LOCKED,
  NOT_THIS_JOB,
  NOTHING_TO_LOCK,
  OTHER_WALLET,
  PAID_STAYS_LOCKED,
  PAYER_NOT_YOU,
  PAYMENT_USED,
  PLACEHOLDER_LOCKED,
  QUOTE_EXPIRED,
  QUOTE_NOT_EXPIRED,
  SAVE_CAP,
  SHORT_PAYMENT,
  UNSAVED,
} from './result'
```

This keeps the names the existing `artWriteError` tests use (`CLEAR_FIRST`, `LOCKED`, `NOT_FOUND`, `SAVE_CAP`, `UNSAVED`).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @cobweb/web exec vitest run src/lib/art/lock-review.test.ts src/lib/art/lock-schemas.test.ts src/lib/art/db-error.test.ts`
Expected: FAIL: `./lock-review` and `./lock-schemas` do not exist, and `lockWriteError` is not exported.

- [ ] **Step 3: Implement**

`apps/web/src/lib/art/read-rows.ts`:

```ts
import type { LockClient } from './lock-collection'
import { readAll } from './read-all'
import type { ArtRows } from './rows'

/**
 * Every art row of a project, read a page at a time under the caller's row-level security. The Art
 * pages (load.ts) and the lock (lock-core.ts) share it, so the lock validates what the screens show.
 */
export async function readArtRows(
  supabase: LockClient,
  collectionId: string,
): Promise<Omit<ArtRows, 'collection'>> {
  const [artCollections, layers, traits, rules, atLeastOne, tokens] = await Promise.all([
    readAll((from, to) =>
      supabase
        .from('art_collections')
        .select('id, name, size, position')
        .eq('collection_id', collectionId)
        .order('position')
        .range(from, to),
    ),
    readAll((from, to) =>
      supabase
        .from('layers')
        .select('id, art_collection_id, name, display_name, position, bypass_dna')
        .eq('collection_id', collectionId)
        .order('id')
        .range(from, to),
    ),
    readAll((from, to) =>
      supabase
        .from('traits')
        .select('id, layer_id, name, weight, constant, blank, in_metadata, upload_id, position')
        .eq('collection_id', collectionId)
        .order('id')
        .range(from, to),
    ),
    readAll((from, to) =>
      supabase
        .from('rules')
        .select('id, kind, trait_id, related_trait_ids, bidirectional')
        .eq('collection_id', collectionId)
        .order('id')
        .range(from, to),
    ),
    readAll((from, to) =>
      supabase
        .from('at_least_one')
        .select('id, art_collection_id, trait_ids')
        .eq('collection_id', collectionId)
        .order('id')
        .range(from, to),
    ),
    readAll((from, to) =>
      supabase
        .from('tokens')
        .select('token_id, art_collection_id, dna, description')
        .eq('collection_id', collectionId)
        .order('token_id')
        .range(from, to),
    ),
  ])
  return { artCollections, layers, traits, rules, atLeastOne, tokens }
}
```

`apps/web/src/lib/art/load.ts` (whole file):

```ts
import 'server-only'
import { cache } from 'react'
import type { ArtProject } from '@/components/art/state/art-store'
import type { Tables } from '@/lib/database.types'
import type { UploadedAsset } from '@/lib/demo'
import { createClient } from '@/lib/supabase/server'
import { latestPlaceholder } from './lock-core'
import { readAll } from './read-all'
import { readArtRows } from './read-rows'
import type { JobPlaceholder } from './render-job'
import { toAssets, toProject } from './rows'

/** Every art row of a project, read under row-level security as the signed-in creator; once per request. */
const artRows = cache(async (collectionId: string) => readArtRows(await createClient(), collectionId))

/** A generative project's art as the Art screens' store holds it. */
export async function loadArtProject(collection: Tables<'collections'>): Promise<ArtProject> {
  return toProject({ collection, ...(await artRows(collection.id)) })
}

/** A 1/1 or single asset project's files, in their saved order. */
export async function loadAssets(collectionId: string): Promise<UploadedAsset[]> {
  const supabase = await createClient()
  const rows = await readAll((from, to) =>
    supabase
      .from('uploads')
      .select('id, file_name, media_type, quantity, attributes, position, created_at')
      .eq('collection_id', collectionId)
      .eq('kind', 'asset')
      .order('position', { nullsFirst: false })
      .order('created_at')
      .order('id')
      .range(from, to),
  )
  return toAssets(rows)
}

/** The collection's latest placeholder file, for Lock and upload before anything is locked; once per request. */
export const loadPlaceholder = cache(async (collectionId: string): Promise<JobPlaceholder> =>
  latestPlaceholder(await createClient(), collectionId),
)
```

`apps/web/src/lib/art/lock-review.ts`:

```ts
import { validateTokenList, type LockProblem, type Project, type TokenCore } from '@cobweb/dna'
import type { ProjectType } from '@/lib/collections'
import { assetListProblems, type AssetToken } from './asset-tokens'

/** The list a lock validates: a generative project's stored tokens with its art, or an asset list. */
export type LockList =
  { kind: 'generative'; project: Project; tokens: TokenCore[] } | { kind: 'assets'; tokens: AssetToken[] }

export type ReviewProblem = { code: LockProblem['code'] | 'files'; message: string }

/** What the review step shows (spec sections 7 and 8), from `reviewArt`. */
export type ReviewData = {
  problems: ReviewProblem[]
  tokenCount: number
  supply: number
  /** The only problems are identical tokens, so "Allow identical tokens" is offered. */
  allowDuplicatesNeeded: boolean
  counts: { collections: number; layers: number; traits: number; rules: number }
  /** Traits with a maximum count, and that maximum. */
  constants: { name: string; count: number }[]
}

export const EMPTY_REVIEW: ReviewData = {
  problems: [],
  tokenCount: 0,
  supply: 0,
  allowDuplicatesNeeded: false,
  counts: { collections: 0, layers: 0, traits: 0, rules: 0 },
  constants: [],
}

/**
 * Runs the lock's checks over a list: `validateTokenList` for a generative project (ids, sizes,
 * collections, DNA, traits, rules, caps, duplicates; identical tokens always reported here and
 * forgiven by `lockRefusal`), the asset checks otherwise.
 */
export function reviewData(list: LockList, projectType: ProjectType): ReviewData {
  if (list.kind === 'assets')
    return {
      problems: assetListProblems(list.tokens, projectType),
      tokenCount: list.tokens.length,
      supply: list.tokens.length,
      allowDuplicatesNeeded: false,
      counts: { collections: 1, layers: 0, traits: 0, rules: 0 },
      constants: [],
    }
  const { project, tokens } = list
  const result = validateTokenList(project, tokens, { allowDuplicates: false })
  const problems: ReviewProblem[] = result.ok
    ? []
    : result.problems.map(({ code, message }) => ({ code, message }))
  if (tokens.length === 0) problems.unshift({ code: 'size', message: 'Generate the set before locking.' })
  const traits = project.layers.flatMap((layer) => layer.traits)
  return {
    problems,
    tokenCount: tokens.length,
    supply: project.collections.reduce((sum, collection) => sum + collection.size, 0),
    allowDuplicatesNeeded: problems.length > 0 && problems.every((problem) => problem.code === 'duplicate'),
    counts: {
      collections: project.collections.length,
      layers: project.layers.length,
      traits: traits.filter((trait) => !trait.blank).length,
      rules: project.rules.length,
    },
    constants: traits.flatMap((trait) =>
      trait.constant ? [{ name: trait.name, count: trait.constant }] : [],
    ),
  }
}

/** Why the lock is refused, or null: the first problem left once identical tokens are allowed. */
export function lockRefusal(review: ReviewData, allowDuplicates: boolean): string | null {
  return (
    review.problems.find((problem) => !(allowDuplicates && problem.code === 'duplicate'))?.message ?? null
  )
}

export type ReviewCheck = {
  key: 'supply' | 'duplicates' | 'rules' | 'caps'
  label: string
  problems: string[]
}

const CHECK_FOR: Record<ReviewProblem['code'], ReviewCheck['key']> = {
  ids: 'supply',
  size: 'supply',
  files: 'supply',
  duplicate: 'duplicates',
  collection: 'rules',
  'dna-length': 'rules',
  trait: 'rules',
  rule: 'rules',
  cap: 'caps',
}

/** The four checks of the review step (creator flow spec, 4.4): supply, unique tokens, rules, maximum counts. */
export function reviewChecks(review: ReviewData, allowDuplicates: boolean): ReviewCheck[] {
  const of = (key: ReviewCheck['key']) =>
    review.problems.filter((problem) => CHECK_FOR[problem.code] === key).map((problem) => problem.message)
  return [
    { key: 'supply', label: 'The set matches the supply', problems: of('supply') },
    allowDuplicates
      ? { key: 'duplicates', label: 'Identical tokens are allowed', problems: [] }
      : { key: 'duplicates', label: 'Every token is unique', problems: of('duplicates') },
    { key: 'rules', label: 'Every token follows the rules', problems: of('rules') },
    { key: 'caps', label: 'Traits stay within their maximum counts', problems: of('caps') },
  ]
}
```

`apps/web/src/lib/art/lock-core.ts`:

```ts
import { hashTokenList } from '@cobweb/dna'
import { chainById, factoryAbi, factoryAddress, publicClientFor } from '@cobweb/shared'
import type { Address, Hex, PublicClient } from 'viem'
import type { Json } from '@/lib/database.types'
import { matchArtPaid } from '@/lib/chain/art-paid'
import type { RenderJob } from '@/lib/demo/types'
import { buildAssetTokenList, hashAssetTokenList, type AssetUploadRow } from './asset-tokens'
import type { DbError } from './db-error'
import type { LockClient, LockCollection } from './lock-collection'
import { lockRefusal, reviewData, type LockList, type ReviewData } from './lock-review'
import { feeReady } from './quote'
import { readAll } from './read-all'
import { readArtRows } from './read-rows'
import { JOB_COLUMNS, toRenderJob, type JobPlaceholder, type JobRow } from './render-job'
import { CHAIN_NOT_READY, NO_PAYMENT_DUE, NO_PAYMENT_FOR_JOB, NOT_CONFIRMED, PAYMENT_USED } from './result'
import { toProject } from './rows'

/**
 * The lock and pay steps (docs/specs/2026-10-09-lock-and-pay.md, sections 5 to 7) on a Supabase
 * client acting as the signed-in creator. The server actions (app/actions/lock.ts) call these after
 * the session and ownership check; verify:chain calls them with a signed-in script client. No
 * `server-only` marker, so the script can import it; the browser never does.
 */
export type LockContext = {
  /** The creator's client under row-level security: every read, `art_unlock`, `art_lock_placeholder`. */
  supabase: LockClient
  /** The service-role client, only for `art_lock`, `art_requote` and `art_record_payment`. */
  service: LockClient
  /** The verified creator's user id, passed as `p_owner` to the three service functions. */
  owner: string
  wallet: string
  collection: LockCollection
}

/** A step's outcome: its data, a database error for `lockWriteError`, or a sentence the creator reads. */
export type LockOutcome<T> = { data: T } | { error: DbError } | { refused: string }

const asJson = (value: unknown) => value as Json

/** The list a lock validates, read from the stored rows (spec section 5). */
export async function readLockList(supabase: LockClient, collection: LockCollection): Promise<LockList> {
  if (collection.project_type === 'generative') {
    const rows = await readArtRows(supabase, collection.id)
    const art = toProject({ collection, ...rows, tokens: [] })
    return {
      kind: 'generative',
      project: {
        collections: art.collections ?? [],
        layers: art.layers ?? [],
        rules: art.rules ?? [],
        atLeastOne: art.atLeastOne ?? [],
      },
      tokens: rows.tokens.map((row) => ({
        id: row.token_id,
        collectionId: row.art_collection_id,
        dna: row.dna,
      })),
    }
  }
  const uploads = await readAll<AssetUploadRow>((from, to) =>
    supabase
      .from('uploads')
      .select('id, quantity, attributes, position, created_at')
      .eq('collection_id', collection.id)
      .eq('kind', 'asset')
      .order('position', { nullsFirst: false })
      .order('created_at')
      .order('id')
      .range(from, to),
  )
  return { kind: 'assets', tokens: buildAssetTokenList(uploads) }
}

export async function reviewLock(ctx: LockContext): Promise<ReviewData> {
  return reviewData(await readLockList(ctx.supabase, ctx.collection), ctx.collection.project_type)
}

/** The factory's published rate on a chain, or null when the chain, its RPC or its factory is not there. */
export async function readArtFee(chainId: number): Promise<bigint | null> {
  try {
    return await publicClientFor(chainId).readContract({
      address: factoryAddress(chainId),
      abi: factoryAbi,
      functionName: 'artFeePerToken',
    })
  } catch (error) {
    console.error(`The art fee could not be read on chain ${chainId}.`, error)
    return null
  }
}

function factoryOn(chainId: number | null): Address | null {
  if (chainId === null) return null
  try {
    return factoryAddress(chainId)
  } catch {
    return null
  }
}

/** The collection's latest placeholder file, or null. */
export async function latestPlaceholder(supabase: LockClient, collectionId: string): Promise<JobPlaceholder> {
  const { data, error } = await supabase
    .from('uploads')
    .select('id, media_type')
    .eq('collection_id', collectionId)
    .eq('kind', 'placeholder')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`The placeholder could not be read: ${error.message}`)
  return data ? { uploadId: data.id, mediaType: data.media_type } : null
}

async function jobFromRow(supabase: LockClient, row: JobRow): Promise<RenderJob> {
  let placeholder: JobPlaceholder = null
  if (row.placeholder_upload_id) {
    const { data } = await supabase
      .from('uploads')
      .select('id, media_type')
      .eq('id', row.placeholder_upload_id)
      .maybeSingle()
    placeholder = data ? { uploadId: data.id, mediaType: data.media_type } : null
  } else {
    placeholder = await latestPlaceholder(supabase, row.collection_id)
  }
  return toRenderJob(row, { factory: factoryOn(row.quote_chain_id), placeholder })
}

/** A job by id as the screen's RenderJob, every wei read as text. */
export async function loadJob(supabase: LockClient, jobId: string): Promise<RenderJob> {
  const { data, error } = await supabase.from('render_jobs').select(JOB_COLUMNS).eq('id', jobId).single()
  if (error) throw new Error(`The render job could not be read: ${error.message}`)
  return jobFromRow(supabase, data as unknown as JobRow)
}

async function openJobRow(
  supabase: LockClient,
  collectionId: string,
  kind: 'real' | 'placeholder',
): Promise<JobRow | null> {
  const { data, error } = await supabase
    .from('render_jobs')
    .select(JOB_COLUMNS)
    .eq('collection_id', collectionId)
    .eq('kind', kind)
    .not('state', 'in', '(done,failed)')
    .maybeSingle()
  if (error) throw new Error(`The render job could not be read: ${error.message}`)
  return data as unknown as JobRow | null
}

async function latestJobRow(
  supabase: LockClient,
  collectionId: string,
  kind: 'real' | 'placeholder',
): Promise<JobRow | null> {
  const { data, error } = await supabase
    .from('render_jobs')
    .select(JOB_COLUMNS)
    .eq('collection_id', collectionId)
    .eq('kind', kind)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`The render job could not be read: ${error.message}`)
  return data as unknown as JobRow | null
}

/**
 * Locks the art (spec section 7, lockArt): validates the stored list, hashes it, reads the factory's
 * rate on the collection's chain (or the one the creator's wallet is on), and calls `art_lock`.
 */
export async function lockCore(
  ctx: LockContext,
  input: { allowDuplicates: boolean; chainId: number },
): Promise<LockOutcome<RenderJob>> {
  const { supabase, collection } = ctx
  const chainId = collection.chain_id ?? input.chainId
  if (!chainById(chainId)) return { refused: CHAIN_NOT_READY }
  const list = await readLockList(supabase, collection)
  const refusal = lockRefusal(reviewData(list, collection.project_type), input.allowDuplicates)
  if (refusal) return { refused: refusal }
  let fee = 0n
  if (collection.project_type !== 'single_asset') {
    const rate = await readArtFee(chainId)
    if (!feeReady(rate)) return { refused: CHAIN_NOT_READY }
    fee = rate
  }
  const hash =
    list.kind === 'generative' ? await hashTokenList(list.tokens) : await hashAssetTokenList(list.tokens)
  const { data, error } = await ctx.service.rpc('art_lock', {
    p_collection_id: collection.id,
    p_owner: ctx.owner,
    p_kind: collection.project_type,
    p_token_list: asJson(list.tokens),
    p_token_list_hash: hash,
    p_allow_duplicates: input.allowDuplicates,
    // numeric: a decimal string, so no wei is lost; the generated types call numeric `number`.
    p_fee_per_token_wei: fee.toString() as unknown as number,
    p_chain_id: chainId,
    p_payer: ctx.wallet,
  })
  if (error) return { error }
  return { data: await loadJob(supabase, (data as { id: string }).id) }
}

export async function unlockCore(ctx: LockContext): Promise<LockOutcome<null>> {
  const { error } = await ctx.supabase.rpc('art_unlock', { p_collection_id: ctx.collection.id })
  return error ? { error } : { data: null }
}

export async function lockPlaceholderCore(
  ctx: LockContext,
  uploadId: string,
): Promise<LockOutcome<RenderJob>> {
  const { data, error } = await ctx.supabase.rpc('art_lock_placeholder', {
    p_collection_id: ctx.collection.id,
    p_placeholder_upload_id: uploadId,
  })
  if (error) return { error }
  return { data: await loadJob(ctx.supabase, (data as { id: string }).id) }
}

/** The open job, quoted again from the current rate when its quote expired (spec section 7, quoteArt). */
export async function quoteCore(ctx: LockContext): Promise<LockOutcome<RenderJob>> {
  const row = await openJobRow(ctx.supabase, ctx.collection.id, 'real')
  if (!row || row.state !== 'payment_due') return { refused: NO_PAYMENT_DUE }
  const expired = row.quote_expires_at !== null && Date.parse(row.quote_expires_at) < Date.now()
  if (!expired || row.quote_chain_id === null) return { data: await jobFromRow(ctx.supabase, row) }
  const rate = await readArtFee(row.quote_chain_id)
  if (!feeReady(rate)) return { refused: CHAIN_NOT_READY }
  const { error } = await ctx.service.rpc('art_requote', {
    p_collection_id: ctx.collection.id,
    p_owner: ctx.owner,
    p_fee_per_token_wei: rate.toString() as unknown as number,
  })
  if (error) return { error }
  return { data: await loadJob(ctx.supabase, row.id) }
}

/**
 * Verifies a payment from its receipt and records it (spec section 7, confirmArtPayment). The payer
 * and the amount come from the factory's ArtPaid log, never from the browser.
 */
export async function confirmCore(
  ctx: LockContext,
  jobId: string,
  txHash: Hex,
): Promise<LockOutcome<RenderJob>> {
  const { supabase, collection } = ctx
  const hash = txHash.toLowerCase() as Hex
  const used = await supabase.from('render_jobs').select('id').eq('payment_tx_hash', hash).limit(1)
  if (used.error) return { error: used.error }
  if (used.data.length > 0) return { refused: PAYMENT_USED }

  const { data, error } = await supabase
    .from('render_jobs')
    .select(JOB_COLUMNS)
    .eq('id', jobId)
    .eq('collection_id', collection.id)
    .maybeSingle()
  if (error) return { error }
  const row = data as unknown as JobRow | null
  if (!row || row.state !== 'payment_due' || row.quote_chain_id === null || row.quote_payer === null)
    return { refused: NO_PAYMENT_FOR_JOB }

  const factory = factoryOn(row.quote_chain_id)
  let client: PublicClient
  try {
    client = publicClientFor(row.quote_chain_id)
  } catch {
    return { refused: CHAIN_NOT_READY }
  }
  if (!factory) return { refused: CHAIN_NOT_READY }

  let receipt: Awaited<ReturnType<PublicClient['getTransactionReceipt']>>
  try {
    receipt = await client.getTransactionReceipt({ hash })
  } catch {
    // Not mined yet, or not visible to this node yet: the screen asks again in 3 seconds.
    return { refused: NOT_CONFIRMED }
  }
  const match = matchArtPaid(receipt, {
    factory,
    jobId: row.onchain_job_id as Hex,
    payer: row.quote_payer,
    minAmount: BigInt(row.quote_total_wei),
  })
  if (!match.ok) return { refused: match.error }

  const recorded = await ctx.service.rpc('art_record_payment', {
    p_collection_id: collection.id,
    p_owner: ctx.owner,
    p_job_id: row.id,
    p_tx_hash: hash,
    p_payer: match.payer.toLowerCase(),
    p_amount_wei: match.amount.toString() as unknown as number,
  })
  if (recorded.error) return { error: recorded.error }
  return { data: await loadJob(supabase, row.id) }
}

/** The job the screen shows: the placeholder job for deferred art, the real job otherwise; open first, then the latest. */
export async function renderJobCore(ctx: LockContext): Promise<LockOutcome<RenderJob | null>> {
  const kind = ctx.collection.art_deferred ? 'placeholder' : 'real'
  const row =
    (await openJobRow(ctx.supabase, ctx.collection.id, kind)) ??
    (await latestJobRow(ctx.supabase, ctx.collection.id, kind))
  return { data: row ? await jobFromRow(ctx.supabase, row) : null }
}
```

`apps/web/src/lib/art/lock-schemas.ts`:

```ts
import { z } from 'zod'
import { NO_CHAIN, NOT_A_HASH } from './result'

/** lockArt's options: the duplicates choice and the chain the creator's wallet is on (spec section 7). */
export const lockArtInput = z.object({
  allowDuplicates: z.boolean(),
  chainId: z.number().int(NO_CHAIN).positive(NO_CHAIN),
})
export type LockArtInput = z.input<typeof lockArtInput>

/** A transaction hash, lowercased as the database stores it. */
export const txHash = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, NOT_A_HASH)
  .transform((value) => value.toLowerCase() as `0x${string}`)
```

In `apps/web/src/lib/art/db-error.ts`, replace the import from `./result` with:

```ts
import {
  ALREADY_LOCKED,
  ART_CHANGED,
  CHANGED_ELSEWHERE,
  CLEAR_FIRST,
  DNA_MISMATCH,
  EMPTY_SET,
  FEE_NOT_WHOLE,
  HASH_INVALID,
  IMPORT_REFUSED,
  LOCKED,
  NO_CHAIN,
  NO_PAYMENT_DUE,
  NO_PAYMENT_FOR_JOB,
  NO_PLACEHOLDER,
  NOT_DEFERRED,
  NOT_FOUND,
  NOT_LOCKED,
  NOT_THIS_JOB,
  NOTHING_TO_LOCK,
  OTHER_WALLET,
  PAID_STAYS_LOCKED,
  PAYER_NOT_YOU,
  PAYMENT_USED,
  PLACEHOLDER_LOCKED,
  QUOTE_EXPIRED,
  QUOTE_NOT_EXPIRED,
  SAVE_CAP,
  SHORT_PAYMENT,
  TRAIT_CAP,
  UNSAVED,
  UPLOAD_CAP,
} from './result'
```

and append:

```ts
/** Sentences the lock and pay functions raise (supabase/migrations/20261009020000_lock_and_pay.sql). */
const LOCK_SENTENCES = new Set([
  ALREADY_LOCKED,
  ART_CHANGED,
  NOTHING_TO_LOCK,
  PAYER_NOT_YOU,
  FEE_NOT_WHOLE,
  HASH_INVALID,
  NO_CHAIN,
  NOT_LOCKED,
  PAID_STAYS_LOCKED,
  NOT_DEFERRED,
  NO_PLACEHOLDER,
  PLACEHOLDER_LOCKED,
  NO_PAYMENT_DUE,
  QUOTE_NOT_EXPIRED,
  NO_PAYMENT_FOR_JOB,
  QUOTE_EXPIRED,
  NOT_THIS_JOB,
  OTHER_WALLET,
  SHORT_PAYMENT,
])

/** A failed lock or payment write, by SQLSTATE, in the creator's words (docs/specs/2026-10-09-lock-and-pay.md). */
export function lockWriteError(error: DbError): string {
  if (!error) return UNSAVED
  if (error.code === '42501') return error.message === 'collection not found' ? NOT_FOUND : UNSAVED
  // Two unique indexes: one open job per kind (a second lock at once), one job per payment.
  if (error.code === '23505')
    return error.message.includes('render_jobs_one_open_per_kind') ? ALREADY_LOCKED : PAYMENT_USED
  if (error.code === '23514' && LOCK_SENTENCES.has(error.message)) return error.message
  return UNSAVED
}
```

`apps/web/src/lib/supabase/service.ts`:

```ts
import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'

/**
 * The service-role client, server only. Used by exactly three calls, `art_lock`, `art_requote` and
 * `art_record_payment` (lib/art/lock-core.ts), whose arguments come from the chain or a verified
 * receipt; `lockWrite` hands it out only after the session and ownership checks. Never use it for a
 * read or a write a creator's session can do. No session is kept.
 */
export function createServiceClient(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set.')
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set.')
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}
```

In `apps/web/.env.example`, after the `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=` line, add:

```
# Service-role key, SERVER ONLY: never prefix it NEXT_PUBLIC_ and never import lib/supabase/service.ts
# from client code. Used only to record the lock, the requote and the verified payment. Local: the
# SERVICE_ROLE_KEY (or SECRET_KEY) from `supabase status -o env`.
SUPABASE_SERVICE_ROLE_KEY=
```

`apps/web/src/lib/art/lock-write.ts`:

```ts
import 'server-only'
import { createServiceClient } from '@/lib/supabase/service'
import { lockWriteError } from './db-error'
import type { LockContext, LockOutcome } from './lock-core'
import { ownedCollection } from './owned'
import { fail, THROWN, type ActionResult } from './result'

/**
 * Runs a lock or payment step for the signed-in owner of a collection, locked or not (artWrite's
 * counterpart for Lock and upload). Two clients: the creator's RLS client for the session check, the
 * owner read and everything else, and the service client for the three functions whose arguments come
 * from the chain or a verified receipt, called with the verified user's id as `p_owner`. A refusal is
 * returned as its sentence; a database error becomes the creator's sentence (`lockWriteError`);
 * anything thrown is logged and reads "Try again".
 */
export async function lockWrite<T>(
  collectionId: string,
  run: (ctx: LockContext) => Promise<LockOutcome<T>>,
): Promise<ActionResult<T>> {
  const owned = await ownedCollection(collectionId)
  if (owned.error !== undefined) return fail(owned.error)
  try {
    const outcome = await run({
      supabase: owned.supabase,
      service: createServiceClient(),
      owner: owned.user.id,
      wallet: owned.user.walletAddress,
      collection: owned.collection,
    })
    if ('refused' in outcome) return fail(outcome.refused)
    if ('error' in outcome) return fail(lockWriteError(outcome.error))
    return { ok: true, data: outcome.data }
  } catch (error) {
    console.error('A lock or payment step threw.', error)
    return fail(THROWN)
  }
}
```

`apps/web/src/app/actions/lock.ts`:

```ts
'use server'

import {
  confirmCore,
  lockCore,
  lockPlaceholderCore,
  quoteCore,
  renderJobCore,
  reviewLock,
  unlockCore,
} from '@/lib/art/lock-core'
import type { ReviewData } from '@/lib/art/lock-review'
import { lockArtInput, txHash as txHashSchema, type LockArtInput } from '@/lib/art/lock-schemas'
import { lockWrite } from '@/lib/art/lock-write'
import type { ActionResult } from '@/lib/art/result'
import { parse, uuid } from '@/lib/art/schemas'
import type { RenderJob } from '@/lib/demo/types'

/** The review step's checks, counts and supply for the art as it is stored now. */
export async function reviewArt(collectionId: string): Promise<ActionResult<ReviewData>> {
  return lockWrite(collectionId, async (ctx) => ({ data: await reviewLock(ctx) }))
}

/** Locks the art and quotes the fee on the collection's chain, or the one the creator's wallet is on. */
export async function lockArt(collectionId: string, options: LockArtInput): Promise<ActionResult<RenderJob>> {
  const input = parse(lockArtInput, options)
  if (!input.ok) return input
  return lockWrite(collectionId, (ctx) => lockCore(ctx, input.data))
}

/** Unlocks the art while the fee is unpaid: the job and the quote go, the Art step opens again. */
export async function unlockArt(collectionId: string): Promise<ActionResult<null>> {
  return lockWrite(collectionId, (ctx) => unlockCore(ctx))
}

/** Deferred art: locks the placeholder alone, at no cost. */
export async function lockPlaceholder(
  collectionId: string,
  uploadId: string,
): Promise<ActionResult<RenderJob>> {
  const input = parse(uuid, uploadId)
  if (!input.ok) return input
  return lockWrite(collectionId, (ctx) => lockPlaceholderCore(ctx, input.data))
}

/** The open job, quoted again from the factory's current rate when its quote expired. */
export async function quoteArt(collectionId: string): Promise<ActionResult<RenderJob>> {
  return lockWrite(collectionId, (ctx) => quoteCore(ctx))
}

/** Checks a payment against its receipt's ArtPaid log and the quote, then marks the job paid. */
export async function confirmArtPayment(
  collectionId: string,
  jobId: string,
  txHash: string,
): Promise<ActionResult<RenderJob>> {
  const job = parse(uuid, jobId)
  if (!job.ok) return job
  const hash = parse(txHashSchema, txHash)
  if (!hash.ok) return hash
  return lockWrite(collectionId, (ctx) => confirmCore(ctx, job.data, hash.data))
}

/** The job Lock and upload shows, or null before anything is locked. */
export async function getRenderJob(collectionId: string): Promise<ActionResult<RenderJob | null>> {
  return lockWrite(collectionId, (ctx) => renderJobCore(ctx))
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @cobweb/web exec vitest run src/lib/art/lock-review.test.ts src/lib/art/lock-schemas.test.ts src/lib/art/db-error.test.ts`
Expected: PASS, 3 files.

- [ ] **Step 5: Root checks and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: clean. The Art pages still load (they now go through `readArtRows`); `verify:chain` in Task 5 runs these cores end to end. Add `SUPABASE_SERVICE_ROLE_KEY` (the local `SERVICE_ROLE_KEY` from `supabase status -o env`) to `apps/web/.env.local` before the browser walk, and check it is not readable in the browser: `grep -r SUPABASE_SERVICE_ROLE_KEY apps/web/.next/static` prints nothing after `pnpm --filter @cobweb/web build`.

```bash
git add apps/web/src/lib/art apps/web/src/lib/supabase/service.ts apps/web/src/app/actions/lock.ts apps/web/.env.example
git commit -F - <<'MSG'
Add the lock core, the review checks, the lock error sentences and the lock and pay server actions

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bcHX4HZG5YGWhxjGuiWos
MSG
```

---

### Task 5: `verify:chain` against Anvil

**Files:**

- Create: `apps/web/scripts/resolve-ts.mjs`, `apps/web/scripts/verify-chain.ts`
- Modify: `apps/web/package.json` (script `verify:chain`)

**Interfaces:**

- Consumes: Task 1's Anvil factory (`chain:local`, `RPC_URL_31337`, `FACTORY_ADDRESS_31337`), `factoryAbi`, `isLocalUrl`; Task 3's `quoteTotalWei`, `readLockCollection`, sentences `OTHER_WALLET`, `SHORT_PAYMENT`, `PAYMENT_USED`, `NOT_CONFIRMED`; Task 4's `lockCore`, `confirmCore`, `type LockContext` (with `service` and `owner`), `type LockOutcome`; Task 2's functions (through the cores; the three service functions through a typed service-role client, as `lockWrite` does).
- Produces: `pnpm --filter @cobweb/web verify:chain`; `apps/web/scripts/resolve-ts.mjs`, a node resolve hook that maps `@/` to `apps/web/src/` and adds `.ts` to extensionless relative imports, so a script can import the app's modules unchanged.

Decision: `verify:chain` imports the lock core itself (spec section 10: "the script imports the same modules the action uses with a session client"). The app's modules import with `@/` and `@cobweb/dna` imports its own files without extensions, which node does not resolve, so the script runs with `--import ./scripts/resolve-ts.mjs`, the same kind of hook `make-demo-art.mjs` already registers.

Decision: the creator and the second payer are fresh random wallets funded with `anvil_setBalance`, so the script holds no fixed key and prints none.

- [ ] **Step 1: Write the check script (it fails until it can run end to end)**

`apps/web/scripts/resolve-ts.mjs`:

```js
// A node resolve hook for scripts that import the app's TypeScript modules: `@/` maps to
// apps/web/src/ (the tsconfig path), and a relative or mapped import without an extension gets
// ".ts" when the bare path does not resolve (packages/dna imports its files that way).
//
//   node --import ./scripts/resolve-ts.mjs scripts/verify-chain.ts

import { registerHooks } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const src = resolve(dirname(fileURLToPath(import.meta.url)), '../src')
const HAS_EXTENSION = /\.(ts|tsx|js|mjs|cjs|json)$/

registerHooks({
  resolve(specifier, context, nextResolve) {
    const target = specifier.startsWith('@/')
      ? pathToFileURL(resolve(src, specifier.slice(2))).href
      : specifier
    try {
      return nextResolve(target, context)
    } catch (error) {
      const local = target.startsWith('.') || target.startsWith('file:')
      if (local && !HAS_EXTENSION.test(target)) return nextResolve(`${target}.ts`, context)
      throw error
    }
  },
})
```

`apps/web/scripts/verify-chain.ts`:

```ts
// Checks lock and pay against a LOCAL Anvil chain and LOCAL Supabase (docs/specs/2026-10-09-lock-and-pay.md,
// section 10): a signed-in creator locks a seeded generative collection through the same core the
// lockArt action runs, pays payForArt from the quote's wallet with the exact total, and the
// confirmArtPayment core marks the job paid; then the refusals: another wallet, a short payment,
// the same hash again, a hash that was never sent. Start the chain first:
//
//   pnpm --filter @cobweb/web chain:local    (then copy its two lines into apps/web/.env.local)
//   pnpm --filter @cobweb/web verify:chain
//
// Supabase settings come from the environment or `supabase status -o env`; RPC_URL_31337 and
// FACTORY_ADDRESS_31337 from the environment or apps/web/.env.local. Refuses non-local endpoints.
// Never prints a key. Runs under `node --conditions=react-server --import ./scripts/resolve-ts.mjs`.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import {
  createTestClient,
  createWalletClient,
  getAddress,
  http,
  parseEther,
  publicActions,
  type Hex,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'
import { anvil } from 'viem/chains'
import { createSiweMessage, generateSiweNonce } from 'viem/siwe'
import type { Database } from '../src/lib/database.types.ts'
import type { RenderJob } from '../src/lib/demo/types.ts'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../../..')

// The two chain settings from apps/web/.env.local when the environment does not set them.
const envFile = resolve(here, '../.env.local')
if (existsSync(envFile))
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const [, name, value] = line.match(/^(RPC_URL_31337|FACTORY_ADDRESS_31337)=(.*)$/) ?? []
    if (name && value && process.env[name] === undefined) process.env[name] = value.trim()
  }

let statusCache: Record<string, string> | null = null
function supabaseStatus(): Record<string, string> {
  if (statusCache) return statusCache
  const out = execFileSync('supabase', ['status', '-o', 'env'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  statusCache = {}
  for (const line of out.split('\n')) {
    const [, name, value] = line.match(/^([A-Z0-9_]+)=(.*)$/) ?? []
    if (name && value !== undefined) statusCache[name] = value.replace(/^"(.*)"$/, '$1')
  }
  return statusCache
}

function config(envName: string, statusNames: string[]): string {
  const fromEnv = process.env[envName]
  if (fromEnv) return fromEnv
  const status = supabaseStatus()
  for (const name of statusNames) if (status[name]) return status[name]
  throw new Error(`${envName} is unset and \`supabase status\` did not report ${statusNames.join(' or ')}`)
}

const { factoryAbi, isLocalUrl } = await import('@cobweb/shared')

const url = config('NEXT_PUBLIC_SUPABASE_URL', ['API_URL'])
const publishableKey = config('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', ['PUBLISHABLE_KEY', 'ANON_KEY'])
const serviceKey = config('SUPABASE_SERVICE_ROLE_KEY', ['SERVICE_ROLE_KEY', 'SECRET_KEY'])
const rpc = process.env.RPC_URL_31337
const factoryEnv = process.env.FACTORY_ADDRESS_31337
if (!rpc || !factoryEnv) {
  console.error(
    'Set RPC_URL_31337 and FACTORY_ADDRESS_31337: run `pnpm --filter @cobweb/web chain:local` and copy its two lines into apps/web/.env.local.',
  )
  process.exit(2)
}
for (const endpoint of [url, rpc])
  if (!isLocalUrl(endpoint)) {
    console.error(`Refusing to run: ${endpoint} is not local (expected localhost or 127.0.0.1).`)
    process.exit(2)
  }
const factory = getAddress(factoryEnv)

// Imported after the environment is set, so the shared clients read the local chain settings.
const { confirmCore, lockCore } = await import('../src/lib/art/lock-core.ts')
const { readLockCollection } = await import('../src/lib/art/lock-collection.ts')
const { quoteTotalWei } = await import('../src/lib/art/quote.ts')
const { NOT_CONFIRMED, OTHER_WALLET, PAYMENT_USED, SHORT_PAYMENT } = await import('../src/lib/art/result.ts')
type LockContext = import('../src/lib/art/lock-core.ts').LockContext
type LockOutcome<T> = import('../src/lib/art/lock-core.ts').LockOutcome<T>

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
const admin = createClient<Database>(url, serviceKey, clientOptions)
const chain = createTestClient({ chain: anvil, mode: 'anvil', transport: http(rpc) }).extend(publicActions)

let passed = 0
const failed: string[] = []
async function check(name: string, fn: () => Promise<string | null>): Promise<void> {
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

const userIds: string[] = []
const collectionIds: string[] = []

async function signIn(account: PrivateKeyAccount) {
  const client = createClient<Database>(url, publishableKey, clientOptions)
  const message = createSiweMessage({
    address: account.address,
    chainId: 1,
    domain: 'localhost:3000',
    nonce: generateSiweNonce(),
    uri: 'http://localhost:3000',
    version: '1',
    statement: 'Sign in to Cobweb.',
    issuedAt: new Date(),
  })
  const signature = await account.signMessage({ message })
  const { data, error } = await client.auth.signInWithWeb3({ chain: 'ethereum', message, signature })
  if (error || !data.user) throw new Error(`sign-in failed: ${error?.message ?? 'no user'}`)
  userIds.push(data.user.id)
  return { client, userId: data.user.id }
}

const HEX64 = (n: number) => n.toString(16).padStart(64, '0')
let fileCount = 0

/** A generative collection of three tokens over two layers of two traits, owned by the client's creator. */
async function seededCollection(client: ReturnType<typeof createClient<Database>>): Promise<string> {
  const { data: col, error } = await client
    .from('collections')
    .insert({ name: `Chain check ${Date.now()} ${++fileCount}`, symbol: 'CHK', project_type: 'generative' })
    .select('id')
    .single()
  if (error || !col) throw new Error(`collection: ${error?.message ?? 'no row'}`)
  const cid = col.id
  collectionIds.push(cid)
  const art = await client
    .from('art_collections')
    .insert({ collection_id: cid, name: 'Owls', size: 3, position: 0 })
    .select('id')
    .single()
  if (art.error || !art.data) throw new Error(`art collection: ${art.error?.message ?? 'no row'}`)
  const artId = art.data.id
  const traits: string[][] = []
  for (const [position, name] of ['Background', 'Eyes'].entries()) {
    const layer = await client
      .from('layers')
      .insert({ collection_id: cid, art_collection_id: artId, name, position })
      .select('id')
      .single()
    if (layer.error || !layer.data) throw new Error(`layer: ${layer.error?.message ?? 'no row'}`)
    const ids: string[] = []
    for (const [index, traitName] of ['One', 'Two'].entries()) {
      const hash = HEX64(++fileCount)
      const upload = await client.rpc('record_upload', {
        p_collection_id: cid,
        p_kind: 'layer_image',
        p_storage_key: `${cid}/layers/${hash}.png`,
        p_content_hash: hash,
        p_mime: 'image/png',
        p_media_type: 'image',
        p_bytes: 1234,
        p_width: 1000,
        p_height: 1000,
        p_file_name: `${traitName}.png`,
      })
      if (upload.error) throw new Error(`upload: ${upload.error.message}`)
      const trait = await client
        .from('traits')
        .insert({
          collection_id: cid,
          layer_id: layer.data.id,
          name: traitName,
          weight: 50,
          position: index,
          upload_id: upload.data as string,
        })
        .select('id')
        .single()
      if (trait.error || !trait.data) throw new Error(`trait: ${trait.error?.message ?? 'no row'}`)
      ids.push(trait.data.id)
    }
    traits.push(ids)
  }
  const [background, eyes] = traits as [string[], string[]]
  const dna = [
    [background[0]!, eyes[0]!],
    [background[0]!, eyes[1]!],
    [background[1]!, eyes[0]!],
  ]
  const tokens = await client.from('tokens').insert(
    dna.map((traitIds, index) => ({
      collection_id: cid,
      token_id: index + 1,
      art_collection_id: artId,
      dna: traitIds,
    })),
  )
  if (tokens.error) throw new Error(`tokens: ${tokens.error.message}`)
  return cid
}

/** The context `lockWrite` builds: the creator's RLS client, the service client, the owner's id. */
async function contextFor(
  client: ReturnType<typeof createClient<Database>>,
  owner: string,
  wallet: string,
  cid: string,
): Promise<LockContext> {
  const collection = await readLockCollection(client, cid)
  if (!collection || collection.owner_id !== owner) throw new Error('the creator cannot read the collection')
  return { supabase: client, service: admin, owner, wallet: wallet.toLowerCase(), collection }
}

const refusal = <T>(outcome: LockOutcome<T>) =>
  'refused' in outcome ? outcome.refused : 'error' in outcome ? `db ${outcome.error?.code}` : 'accepted'

async function pay(account: PrivateKeyAccount, jobId: Hex, value: bigint): Promise<Hex> {
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

async function main(): Promise<void> {
  console.log(`Verifying lock and pay on ${rpc} against ${url}`)
  await check('chain: Anvil answers as 31337 and the factory has code and a rate', async () => {
    if ((await chain.getChainId()) !== 31337) return 'not chain 31337'
    const code = await chain.getCode({ address: factory })
    if (!code || code === '0x') return `no contract at ${factory}; run chain:local again`
    const rate = await chain.readContract({
      address: factory,
      abi: factoryAbi,
      functionName: 'artFeePerToken',
    })
    return rate > 0n ? null : 'the factory rate is 0'
  })

  const creator = privateKeyToAccount(generatePrivateKey())
  const stranger = privateKeyToAccount(generatePrivateKey())
  await chain.setBalance({ address: creator.address, value: parseEther('10') })
  await chain.setBalance({ address: stranger.address, value: parseEther('10') })
  const { client, userId } = await signIn(creator)

  const first = await contextFor(client, userId, creator.address, await seededCollection(client))
  let job1: RenderJob | null = null
  let paidHash: Hex | null = null

  await check('lockArt: the creator locks a three-token set, quoted from the factory rate', async () => {
    const outcome = await lockCore(first, { allowDuplicates: false, chainId: 31337 })
    if (!('data' in outcome)) return refusal(outcome)
    job1 = outcome.data
    const rate = await chain.readContract({
      address: factory,
      abi: factoryAbi,
      functionName: 'artFeePerToken',
    })
    const want = quoteTotalWei('generative', rate, 3).toString()
    return job1.state === 'payment_due' &&
      job1.quote.totalWei === want &&
      job1.quote.payer === creator.address.toLowerCase() &&
      job1.quote.factory === factory
      ? null
      : JSON.stringify({ state: job1.state, quote: job1.quote, want })
  })

  await check(
    'pay: payForArt from the quote wallet with the exact total; confirm marks the job paid',
    async () => {
      if (!job1) return 'no job'
      paidHash = await pay(creator, job1.jobId, BigInt(job1.quote.totalWei))
      const outcome = await confirmCore(first, job1.id, paidHash)
      if (!('data' in outcome)) return refusal(outcome)
      const job = outcome.data
      return job.state === 'paid' &&
        'payment' in job &&
        job.payment?.txHash === paidHash &&
        job.payment.amountWei === job1.quote.totalWei
        ? null
        : JSON.stringify(job)
    },
  )

  const second = await contextFor(client, userId, creator.address, await seededCollection(client))
  let job2: RenderJob | null = null
  await check('lockArt: a second collection locks for the refusals', async () => {
    const outcome = await lockCore(second, { allowDuplicates: false, chainId: 31337 })
    if (!('data' in outcome)) return refusal(outcome)
    job2 = outcome.data
    return job2.state === 'payment_due' ? null : job2.state
  })

  await check('confirm: a payment from another wallet is refused', async () => {
    if (!job2) return 'no job'
    const hash = await pay(stranger, job2.jobId, BigInt(job2.quote.totalWei))
    const outcome = await confirmCore(second, job2.id, hash)
    return refusal(outcome) === OTHER_WALLET ? null : refusal(outcome)
  })

  await check('confirm: a payment short of the quote is refused', async () => {
    if (!job2) return 'no job'
    const hash = await pay(creator, job2.jobId, BigInt(job2.quote.totalWei) - 1n)
    const outcome = await confirmCore(second, job2.id, hash)
    return refusal(outcome) === SHORT_PAYMENT ? null : refusal(outcome)
  })

  await check('confirm: the same hash a second time is refused', async () => {
    if (!job1 || !paidHash) return 'no payment'
    const outcome = await confirmCore(first, job1.id, paidHash)
    return refusal(outcome) === PAYMENT_USED ? null : refusal(outcome)
  })

  await check('confirm: a hash that was never sent is not confirmed', async () => {
    if (!job2) return 'no job'
    const outcome = await confirmCore(second, job2.id, `0x${'ab'.repeat(32)}`)
    return refusal(outcome) === NOT_CONFIRMED ? null : refusal(outcome)
  })
}

async function cleanup(): Promise<void> {
  await check('cleanup: the run leaves no job, collection or user behind', async () => {
    if (collectionIds.length) {
      const jobs = await admin.from('render_jobs').delete().in('collection_id', collectionIds)
      if (jobs.error) return `jobs: ${jobs.error.message}`
      const cols = await admin.from('collections').delete().in('id', collectionIds)
      if (cols.error) return `collections: ${cols.error.message}`
    }
    for (const id of userIds) {
      const { error } = await admin.auth.admin.deleteUser(id)
      if (error) return error.message
    }
    return null
  })
}

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
```

In `apps/web/package.json`, add to `scripts` after `"chain:local"` (add a comma to the line before):

```json
    "verify:chain": "node --conditions=react-server --import ./scripts/resolve-ts.mjs scripts/verify-chain.ts"
```

- [ ] **Step 2: Run it without a chain to see it refuse**

Run (with `RPC_URL_31337` and `FACTORY_ADDRESS_31337` not yet in `apps/web/.env.local`, or temporarily commented out):

```bash
pnpm --filter @cobweb/web verify:chain
```

Expected: exit code 2 with "Set RPC_URL_31337 and FACTORY_ADDRESS_31337: run `pnpm --filter @cobweb/web chain:local` ..."; then with `RPC_URL_31337=https://example.com pnpm --filter @cobweb/web verify:chain` it refuses with "Refusing to run: https://example.com is not local".

- [ ] **Step 3: Run it against Anvil and expect every check to pass**

Run:

```bash
supabase start
pnpm --filter @cobweb/web chain:local
pnpm --filter @cobweb/web verify:chain
```

Expected: 9 `PASS` lines (the chain, two locks, the payment, the four refusals, the cleanup) and `9 passed, 0 failed`. A `FAIL` here is a defect in Tasks 2 to 4: fix it there (new commit) and run again.

- [ ] **Step 4: Root checks and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: clean.

```bash
git add apps/web/scripts/resolve-ts.mjs apps/web/scripts/verify-chain.ts apps/web/package.json
git commit -F - <<'MSG'
Check lock, pay and the payment refusals against Anvil with verify:chain

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bcHX4HZG5YGWhxjGuiWos
MSG
```

---

### Task 6: Lock and upload on real data

**Files:**

- Create: `apps/web/src/components/upload/pay-machine.ts`, `apps/web/src/components/upload/render-sim.ts`, `apps/web/src/components/upload/upload-actions.ts`, `apps/web/src/lib/chain/chain-view.ts`
- Test: `apps/web/src/components/upload/pay-machine.test.ts`, `apps/web/src/lib/chain/chain-view.test.ts`, `apps/web/src/lib/steps.test.ts`
- Modify: `apps/web/src/lib/steps.ts:226` (Lock and upload opens on a draft), `apps/web/src/components/deploy/tx-progress.tsx:18-21` (two failure kinds)
- Modify (whole files): `apps/web/src/components/upload/upload-sim.ts`, `upload-shared.ts`, `upload-screen.tsx`, `upload-flow.tsx`, `review-step.tsx`, `pay-step.tsx`, `apps/web/src/app/collections/[id]/upload/page.tsx`
- Modify (edits): `apps/web/src/components/upload/render-step.tsx`, `apps/web/src/components/upload/reveal-later.tsx`

**Interfaces:**

- Consumes: Task 4's actions `reviewArt`, `lockArt`, `unlockArt`, `lockPlaceholder`, `quoteArt`, `confirmArtPayment`, `getRenderJob` from `@/app/actions/lock`, `loadPlaceholder` from `@/lib/art/load`, `lockRefusal`, `reviewChecks`, `EMPTY_REVIEW`, `type ReviewData`, `type ReviewProblem` from `@/lib/art/lock-review`; Task 3's `quoteExpired`, `pendingJob`, `jobBase`, the sentences; Task 1's `chainById`, `factoryAbi`; `deleteUpload` from `@/app/actions/uploads`; `createUploader` and `uploadOnce` from `@/components/art/uploads/`; wagmi `useAccount`, `useConfig`, and `simulateContract`, `writeContract`, `waitForTransactionReceipt` from `wagmi/actions`.
- Produces:
  - `pay-machine.ts` (pure): `CONFIRM_INTERVAL_MS = 3_000`, `CONFIRM_TIMEOUT_MS = 120_000`; `type PayEvent`; `payReducer(phase: TxPhase, event: PayEvent): TxPhase`; `type PayInput = { payer: string; account: string | undefined; chainId: number; connectedChainId: number | undefined; chainName: string; factory: string | null; sentHash?: Hex }`; `type PayDeps = { simulate(): Promise<() => Promise<Hex>>; wait(hash: Hex): Promise<'success' | 'reverted'>; confirm(hash: Hex): Promise<ActionResult<RenderJob>>; reload(): Promise<ActionResult<RenderJob | null>>; remember(hash: Hex): void; forget(): void; sleep(ms: number): Promise<void>; now(): number }`; `preflight(input: PayInput): TxFailure | null`; `classifyError(error: unknown, at: 'simulating' | 'wallet' | 'confirming'): TxFailure`; `verifyPayment(hash: Hex, deps): Promise<{ job: RenderJob } | { error: string }>`; `runPayment(input: PayInput, deps: PayDeps, dispatch: (event: PayEvent) => void): Promise<RenderJob | null>`; `retryHash(phase: TxPhase): Hex | undefined`; `type KeyStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>`; `browserStore(): KeyStore | null`; `rememberPayment(store, jobId, hash)`, `pendingPayment(store, jobId): Hex | null`, `forgetPayment(store, jobId)`.
  - `chain-view.ts`: `chainView(chainId: number): SupportedChain`.
  - `upload-shared.ts`: `type PlaceholderUpload = { uploadId: string; url: string } | { error: string }`; `type UploadActions = { lock(input: { allowDuplicates: boolean; chainId: number }): Promise<ActionResult<RenderJob>>; unlock(): Promise<ActionResult<null>>; requote(): Promise<ActionResult<RenderJob>>; confirm(jobId: string, txHash: Hex): Promise<ActionResult<RenderJob>>; reload(): Promise<ActionResult<RenderJob | null>>; lockPlaceholder(uploadId: string | null): Promise<ActionResult<RenderJob>>; uploadPlaceholder: ((file: File) => Promise<PlaceholderUpload>) | null; removePlaceholder(uploadId: string): Promise<ActionResult> }`.
  - `upload-actions.ts`: `realActions(collectionId: string): UploadActions`.
  - `upload-sim.ts` (sample mode only): `type UploadOutcome`, `UPLOAD_OUTCOMES`, `type LockOptions`, `sampleActions(initial: RenderJob): UploadActions`, `payArtFee(onPhase, options)`.
  - `render-sim.ts` (the Phase 4 seam): `RENDER_BATCH_SIZE`, `SECONDS_PER_BATCH`, `type RenderProgress`, `followRender(start, onProgress, options)`, `retryBatch(progress: RenderProgress): RenderProgress`.
  - `TxFailure.kind` gains `'refused' | 'unconfirmed'`.
  - `stageAccess(status, 'upload')` is `'open'` for a `draft`.

Decision: Lock and upload opens on a draft collection, because its review step is where the art is checked and locked; until now the stage stayed locked until `art_locked`, which nothing could reach. The review step says what blocks the lock.

Decision: before the lock, the quote's chain is `collections.chain_id` when set, otherwise the chain the creator's wallet is on (`useAccount().chainId`); with neither, the lock button waits with "Connect your wallet to choose the network the fee is paid on."

Decision: the hash of a sent payment is kept in `localStorage` per job until the server records it, so a later visit offers "Check the payment" instead of a second payment, and "Try again" after a timeout checks the same hash again (Review Focus 1). Unlocking is disabled while such a payment is waiting.

Decision: "Unlock the art" is offered on the pay step while the payment is due, behind a confirm; afterwards the screen returns to the review step and refreshes the route, so the stepper and the Art screens open again.

Decision: real mode hides the strip of sample token images on the review step; no real token has an image before Phase 4 renders it.

Decision: in real mode "Reveal later" stores the placeholder file as soon as it is picked (the uploads table refuses new files once the art is locked); Replace and Remove delete the stored file, and locking with "Reveal at mint" deletes a file stored earlier. The placeholder's description stays in the browser until Phase 4 gives it a column.

Decision: a job with nothing to pay (a placeholder, a single asset) skips the pay step; its receipt reads "No fee". Deferred art goes from the placeholder lock straight to the simulated render.

Decision: sample quotes are dated in the past, so only a real quote shows "The quote expired".

- [ ] **Step 1: Write the failing tests**

`apps/web/src/components/upload/pay-machine.test.ts`:

```ts
import type { Hex } from 'viem'
import { describe, expect, it } from 'vitest'
import type { TxPhase } from '@/components/deploy/tx-progress'
import {
  CHAIN_NOT_READY,
  NOT_CONFIRMED,
  OTHER_WALLET,
  PAYMENT_USED,
  TIMED_OUT,
  type ActionResult,
} from '@/lib/art/result'
import type { RenderJob } from '@/lib/demo/types'
import {
  classifyError,
  forgetPayment,
  payReducer,
  pendingPayment,
  rememberPayment,
  retryHash,
  runPayment,
  type KeyStore,
  type PayDeps,
  type PayEvent,
  type PayInput,
} from './pay-machine'

const PAYER = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8'
const FACTORY = '0x5FbDB2315678afecb367f032d93F642f64180aa3'
const HASH: Hex = `0x${'ab'.repeat(32)}`
const OTHER_HASH: Hex = `0x${'cd'.repeat(32)}`

const paidWith = (txHash: Hex): RenderJob => ({
  id: 'job-1',
  jobId: `0x${'11'.repeat(32)}`,
  tokenCount: 2,
  lockedAt: 0,
  tokenListHash: `0x${'22'.repeat(32)}`,
  quote: {
    chainId: 31337,
    perTokenWei: '1',
    tokenCount: 2,
    totalWei: '2',
    payer: PAYER,
    expiresAt: 0,
    factory: FACTORY,
  },
  lockOptions: { allowDuplicates: false },
  placeholder: null,
  state: 'paid',
  payment: { txHash, paidAt: 0, amountWei: '2' },
  batches: { total: 1, done: 0, size: 100 },
})

const input: PayInput = {
  payer: PAYER,
  account: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  chainId: 31337,
  connectedChainId: 31337,
  chainName: 'Anvil',
  factory: FACTORY,
}

function fakeDeps(confirms: ActionResult<RenderJob>[], overrides: Partial<PayDeps> = {}) {
  let clock = 0
  const calls = { simulate: 0, send: 0, confirm: 0, remember: [] as Hex[], forget: 0, sleeps: [] as number[] }
  const deps: PayDeps = {
    simulate: async () => {
      calls.simulate++
      return async () => {
        calls.send++
        return HASH
      }
    },
    wait: async () => 'success',
    confirm: async () => {
      calls.confirm++
      return confirms.shift() ?? { ok: false, error: NOT_CONFIRMED }
    },
    reload: async () => ({ ok: true, data: paidWith(HASH) }),
    remember: (hash) => {
      calls.remember.push(hash)
    },
    forget: () => {
      calls.forget++
    },
    sleep: async (ms) => {
      calls.sleeps.push(ms)
      clock += ms
    },
    now: () => clock,
    ...overrides,
  }
  return { deps, calls }
}

async function run(deps: PayDeps, payInput: PayInput = input) {
  const events: PayEvent[] = []
  const job = await runPayment(payInput, deps, (event) => events.push(event))
  return { job, events, last: events[events.length - 1] }
}

const NOT_YET: ActionResult<RenderJob> = { ok: false, error: NOT_CONFIRMED }

describe('runPayment', () => {
  it('simulates, sends, waits, then polls the server every 3 seconds until it confirms', async () => {
    const { deps, calls } = fakeDeps([NOT_YET, NOT_YET, { ok: true, data: paidWith(HASH) }])
    const { job, events } = await run(deps)
    expect(events.map((event) => event.type)).toEqual([
      'simulating',
      'wallet',
      'confirming',
      'verifying',
      'success',
    ])
    expect(calls.sleeps).toEqual([3_000, 3_000])
    expect(calls.remember).toEqual([HASH])
    expect(calls.forget).toBe(1)
    expect(job?.state).toBe('paid')
  })

  it('checks a payment already sent instead of paying again', async () => {
    const { deps, calls } = fakeDeps([{ ok: true, data: paidWith(HASH) }])
    const { events } = await run(deps, { ...input, sentHash: HASH })
    expect(calls.simulate).toBe(0)
    expect(events.map((event) => event.type)).toEqual(['verifying', 'success'])
  })

  it('never opens the wallet for the wrong wallet, the wrong chain, no wallet or no factory', async () => {
    const cases: [Partial<PayInput>, string][] = [
      [{ account: undefined }, 'Connect your wallet'],
      [{ account: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' }, 'Use the wallet the quote was issued to'],
      [{ connectedChainId: 1 }, 'Switch to Anvil'],
      [{ factory: null }, 'Payments are not open on this network'],
    ]
    for (const [change, title] of cases) {
      const { deps, calls } = fakeDeps([])
      const { last } = await run(deps, { ...input, ...change })
      expect(calls.simulate).toBe(0)
      expect(last).toMatchObject({ type: 'failed', failure: { title } })
    }
    const { deps } = fakeDeps([])
    const { last } = await run(deps, { ...input, factory: null })
    expect(last).toMatchObject({ failure: { message: CHAIN_NOT_READY } })
  })

  it('reports a transaction that reverted on chain and forgets its hash', async () => {
    const { deps, calls } = fakeDeps([], { wait: async () => 'reverted' })
    const { last, job } = await run(deps)
    expect(job).toBeNull()
    expect(last).toMatchObject({
      type: 'failed',
      failure: { kind: 'reverted', title: 'The payment failed on chain' },
    })
    expect(calls.forget).toBe(1)
  })

  it('stops after 2 minutes of "not confirmed yet" and keeps the hash to check again', async () => {
    const { deps, calls } = fakeDeps([])
    const { last } = await run(deps)
    expect(calls.confirm).toBe(41)
    expect(last).toMatchObject({ type: 'failed', failure: { kind: 'unconfirmed', message: TIMED_OUT } })
    expect(calls.forget).toBe(0)
  })

  it('shows a refusal as it is and forgets the hash', async () => {
    const { deps, calls } = fakeDeps([{ ok: false, error: OTHER_WALLET }])
    const { last } = await run(deps)
    expect(last).toMatchObject({ type: 'failed', failure: { kind: 'refused', message: OTHER_WALLET } })
    expect(calls.forget).toBe(1)
  })
})

describe('verifyPayment through runPayment (Review Focus 4)', () => {
  it('treats "already used" as success when the job was paid with this very hash', async () => {
    const { deps } = fakeDeps([{ ok: false, error: PAYMENT_USED }])
    const { last, job } = await run(deps, { ...input, sentHash: HASH })
    expect(last).toEqual({ type: 'success', txHash: HASH })
    expect(job?.state).toBe('paid')
  })

  it('refuses "already used" when the job was paid with another hash', async () => {
    const { deps } = fakeDeps([{ ok: false, error: PAYMENT_USED }], {
      reload: async () => ({ ok: true, data: paidWith(OTHER_HASH) }),
    })
    const { last } = await run(deps, { ...input, sentHash: HASH })
    expect(last).toMatchObject({ type: 'failed', failure: { message: PAYMENT_USED } })
  })
})

describe('classifyError', () => {
  it('reads a wallet rejection anywhere in the cause chain', () => {
    const error = Object.assign(new Error('Request failed'), { cause: { code: 4001 } })
    expect(classifyError(error, 'wallet').kind).toBe('rejected')
    expect(classifyError({ name: 'UserRejectedRequestError' }, 'wallet').kind).toBe('rejected')
  })

  it('reads a balance problem and otherwise names the simulation failure', () => {
    expect(classifyError(new Error('insufficient funds for gas * price + value'), 'simulating').kind).toBe(
      'balance',
    )
    const reverted = classifyError(
      { shortMessage: 'Execution reverted with reason: JobAlreadyPaid.' },
      'simulating',
    )
    expect(reverted.kind).toBe('reverted')
    expect(reverted.message).toContain('JobAlreadyPaid')
  })
})

describe('payReducer and retryHash', () => {
  it('fails at the step it was on and keeps the sent hash', () => {
    const failure = { kind: 'unconfirmed' as const, title: 't', message: 'm' }
    const confirming = payReducer({ step: 'idle' }, { type: 'confirming', txHash: HASH })
    const failed = payReducer(confirming, { type: 'failed', failure })
    expect(failed).toEqual({ step: 'failed', at: 'confirming', failure, txHash: HASH })
    expect(payReducer({ step: 'idle' }, { type: 'failed', failure })).toEqual({
      step: 'failed',
      at: 'simulating',
      failure,
    })
    expect(retryHash(failed)).toBe(HASH)
    const refused: TxPhase = {
      step: 'failed',
      at: 'verifying',
      failure: { ...failure, kind: 'refused' },
      txHash: HASH,
    }
    expect(retryHash(refused)).toBeUndefined()
    expect(retryHash({ step: 'idle' })).toBeUndefined()
  })
})

describe('the pending payment kept in the browser (Review Focus 1)', () => {
  function memoryStore(): KeyStore {
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
  const blocked: KeyStore = {
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

  it('remembers a sent hash per job until it is forgotten', () => {
    const store = memoryStore()
    rememberPayment(store, 'job-1', HASH)
    expect(pendingPayment(store, 'job-1')).toBe(HASH)
    expect(pendingPayment(store, 'job-2')).toBeNull()
    forgetPayment(store, 'job-1')
    expect(pendingPayment(store, 'job-1')).toBeNull()
  })

  it('ignores a value that is not a hash and a store that throws', () => {
    const store = memoryStore()
    store.setItem('cobweb-art-payment:job-1', 'nonsense')
    expect(pendingPayment(store, 'job-1')).toBeNull()
    expect(() => rememberPayment(blocked, 'job-1', HASH)).not.toThrow()
    expect(pendingPayment(blocked, 'job-1')).toBeNull()
    expect(pendingPayment(null, 'job-1')).toBeNull()
  })
})
```

`apps/web/src/lib/chain/chain-view.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { chainView } from './chain-view'

describe('chainView', () => {
  it('shows a launch chain with its symbol and explorer', () => {
    expect(chainView(8453)).toEqual({
      id: 8453,
      name: 'Base',
      nativeSymbol: 'ETH',
      explorerUrl: 'https://basescan.org',
      transferLock: true,
    })
  })

  it('shows Anvil outside production, with no explorer', () => {
    expect(chainView(31337)).toMatchObject({ name: 'Anvil', explorerUrl: '' })
  })

  it('still renders a chain it does not know, and no chain yet', () => {
    expect(chainView(10)).toMatchObject({ id: 10, name: 'Chain 10', explorerUrl: '' })
    expect(chainView(0).name).toBe('No network yet')
  })
})
```

`apps/web/src/lib/steps.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { stageAccess } from './steps'

describe('stageAccess for Lock and upload', () => {
  it('opens on a draft, where the review step locks the art', () => {
    expect(stageAccess('draft', 'upload', { demo: false })).toBe('open')
    expect(stageAccess('draft', 'upload', { demo: false, artDeferred: true })).toBe('open')
  })

  it('stays open once the art is locked, while Deploy waits for the render', () => {
    expect(stageAccess('art_locked', 'upload', { demo: false })).toBe('open')
    expect(stageAccess('art_locked', 'deploy', { demo: false })).toBe('locked')
    expect(stageAccess('draft', 'deploy', { demo: false })).toBe('locked')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @cobweb/web exec vitest run src/components/upload/pay-machine.test.ts src/lib/chain/chain-view.test.ts src/lib/steps.test.ts`
Expected: FAIL: `./pay-machine` and `./chain-view` do not exist; `stageAccess('draft', 'upload', ...)` is `'locked'`.

- [ ] **Step 3: Implement the pure pieces**

`apps/web/src/components/upload/pay-machine.ts`:

```ts
import type { TxFailure, TxPhase } from '@/components/deploy/tx-progress'
import { CHAIN_NOT_READY, NOT_CONFIRMED, PAYMENT_USED, TIMED_OUT, type ActionResult } from '@/lib/art/result'
import type { Hex, RenderJob } from '@/lib/demo/types'

/**
 * The pay step's payment as a pure machine (docs/specs/2026-10-09-lock-and-pay.md, section 8), so
 * every path is tested in Node: the checks before the wallet opens, simulate, the wallet, the
 * receipt, then the server's confirmation polled every 3 seconds for up to 2 minutes. `PayStep`
 * wires the wagmi actions in. CLAUDE.md rule 2 holds by construction: `simulate` returns the only
 * way to send, and it sends the simulated request.
 */
export const CONFIRM_INTERVAL_MS = 3_000
export const CONFIRM_TIMEOUT_MS = 120_000

export type PayEvent =
  | { type: 'set'; phase: TxPhase }
  | { type: 'simulating' }
  | { type: 'wallet' }
  | { type: 'confirming'; txHash: Hex }
  | { type: 'verifying'; txHash: Hex }
  | { type: 'success'; txHash: Hex }
  | { type: 'failed'; failure: TxFailure }

export function payReducer(phase: TxPhase, event: PayEvent): TxPhase {
  switch (event.type) {
    case 'set':
      return event.phase
    case 'simulating':
      return { step: 'simulating' }
    case 'wallet':
      return { step: 'wallet' }
    case 'confirming':
      return { step: 'confirming', txHash: event.txHash }
    case 'verifying':
      return { step: 'verifying', txHash: event.txHash }
    case 'success':
      return { step: 'success', txHash: event.txHash }
    case 'failed': {
      if (phase.step === 'idle' || phase.step === 'success')
        return { step: 'failed', at: 'simulating', failure: event.failure }
      const at = phase.step === 'failed' ? phase.at : phase.step
      return phase.txHash
        ? { step: 'failed', at, failure: event.failure, txHash: phase.txHash }
        : { step: 'failed', at, failure: event.failure }
    }
  }
}

export type PayInput = {
  /** The quote's wallet: only its payment counts. */
  payer: string
  /** The connected account, if any. */
  account: string | undefined
  /** The quote's chain. */
  chainId: number
  connectedChainId: number | undefined
  chainName: string
  factory: string | null
  /** A transaction already sent for this job: check it instead of paying again. */
  sentHash?: Hex
}

export type PayDeps = {
  /** Simulates `payForArt`; resolves with the function that sends the simulated request, unchanged. */
  simulate(): Promise<() => Promise<Hex>>
  wait(hash: Hex): Promise<'success' | 'reverted'>
  confirm(hash: Hex): Promise<ActionResult<RenderJob>>
  reload(): Promise<ActionResult<RenderJob | null>>
  remember(hash: Hex): void
  forget(): void
  sleep(ms: number): Promise<void>
  now(): number
}

const REJECTED: TxFailure = {
  kind: 'rejected',
  title: 'Payment cancelled in your wallet',
  message: 'Nothing was sent and nothing was charged. Try again when you are ready.',
}
const BALANCE: TxFailure = {
  kind: 'balance',
  title: 'Not enough funds in this wallet',
  message:
    'The fee and network gas are more than this wallet holds on the network. Add funds, then try again.',
}
const REVERTED_ON_CHAIN: TxFailure = {
  kind: 'reverted',
  title: 'The payment failed on chain',
  message: 'The transaction was included but reverted, so nothing was paid. Try again.',
}

/** Why the wallet must not open yet, or null. */
export function preflight(input: PayInput): TxFailure | null {
  if (!input.factory)
    return { kind: 'refused', title: 'Payments are not open on this network', message: CHAIN_NOT_READY }
  if (!input.account)
    return {
      kind: 'refused',
      title: 'Connect your wallet',
      message: 'Connect your wallet to pay. Nothing was sent.',
    }
  if (input.account.toLowerCase() !== input.payer.toLowerCase())
    return {
      kind: 'refused',
      title: 'Use the wallet the quote was issued to',
      message: `Only a payment from ${input.payer} counts for this job. Switch to that account in your wallet, then try again.`,
    }
  if (input.connectedChainId !== input.chainId)
    return {
      kind: 'switch',
      title: `Switch to ${input.chainName}`,
      message: `The quote is on ${input.chainName}. Switch your wallet to it, then try again.`,
    }
  return null
}

function causes(error: unknown): unknown[] {
  const list: unknown[] = []
  let current: unknown = error
  for (let depth = 0; current && depth < 10; depth++) {
    list.push(current)
    current = (current as { cause?: unknown }).cause
  }
  return list
}

/** A wallet or chain error as the creator reads it. */
export function classifyError(error: unknown, at: 'simulating' | 'wallet' | 'confirming'): TxFailure {
  const chain = causes(error)
  const rejected = chain.some(
    (entry) =>
      (entry as { name?: string }).name === 'UserRejectedRequestError' ||
      (entry as { code?: unknown }).code === 4001,
  )
  if (rejected) return REJECTED
  const text = chain.map((entry) => (entry instanceof Error ? entry.message : String(entry))).join(' ')
  if (/insufficient funds/i.test(text)) return BALANCE
  const short =
    (error as { shortMessage?: string }).shortMessage ??
    (error instanceof Error ? error.message : 'Unknown error.')
  if (at === 'simulating')
    return {
      kind: 'reverted',
      title: 'The payment would fail',
      message: `The check against the factory failed: ${short} Nothing was sent.`,
    }
  if (at === 'wallet')
    return {
      kind: 'rejected',
      title: 'The wallet did not send the payment',
      message: `${short} Nothing was charged.`,
    }
  return {
    kind: 'reverted',
    title: 'The payment could not be confirmed',
    message: `${short} Check your wallet's activity before you pay again.`,
  }
}

/**
 * Asks the server to confirm a payment every 3 seconds while it answers "not confirmed yet", for up
 * to 2 minutes. "Already used" for this job's own hash is a confirmation that arrived before.
 */
export async function verifyPayment(
  hash: Hex,
  deps: Pick<PayDeps, 'confirm' | 'reload' | 'sleep' | 'now'>,
): Promise<{ job: RenderJob } | { error: string }> {
  const started = deps.now()
  for (;;) {
    const result = await deps.confirm(hash)
    if (result.ok) return { job: result.data }
    if (result.error === PAYMENT_USED) {
      const current = await deps.reload()
      const job = current.ok ? current.data : null
      if (job && 'payment' in job && job.payment?.txHash.toLowerCase() === hash.toLowerCase()) return { job }
      return { error: PAYMENT_USED }
    }
    if (result.error !== NOT_CONFIRMED) return { error: result.error }
    if (deps.now() - started + CONFIRM_INTERVAL_MS > CONFIRM_TIMEOUT_MS) return { error: TIMED_OUT }
    await deps.sleep(CONFIRM_INTERVAL_MS)
  }
}

/** Pays the art fee, or checks a payment already sent, reporting each step through `dispatch`. */
export async function runPayment(
  input: PayInput,
  deps: PayDeps,
  dispatch: (event: PayEvent) => void,
): Promise<RenderJob | null> {
  let hash = input.sentHash
  if (!hash) {
    const blocked = preflight(input)
    if (blocked) {
      dispatch({ type: 'failed', failure: blocked })
      return null
    }
    dispatch({ type: 'simulating' })
    let send: () => Promise<Hex>
    try {
      send = await deps.simulate()
    } catch (error) {
      dispatch({ type: 'failed', failure: classifyError(error, 'simulating') })
      return null
    }
    dispatch({ type: 'wallet' })
    try {
      hash = await send()
    } catch (error) {
      dispatch({ type: 'failed', failure: classifyError(error, 'wallet') })
      return null
    }
    deps.remember(hash)
    dispatch({ type: 'confirming', txHash: hash })
    let status: 'success' | 'reverted'
    try {
      status = await deps.wait(hash)
    } catch (error) {
      dispatch({ type: 'failed', failure: classifyError(error, 'confirming') })
      return null
    }
    if (status === 'reverted') {
      deps.forget()
      dispatch({ type: 'failed', failure: REVERTED_ON_CHAIN })
      return null
    }
  }
  dispatch({ type: 'verifying', txHash: hash })
  const verified = await verifyPayment(hash, deps)
  if ('job' in verified) {
    deps.forget()
    dispatch({ type: 'success', txHash: hash })
    return verified.job
  }
  if (verified.error === TIMED_OUT) {
    dispatch({
      type: 'failed',
      failure: { kind: 'unconfirmed', title: 'Payment not confirmed yet', message: TIMED_OUT },
    })
  } else {
    deps.forget()
    dispatch({
      type: 'failed',
      failure: { kind: 'refused', title: 'Cobweb could not accept this payment', message: verified.error },
    })
  }
  return null
}

/** The hash "Try again" checks again instead of paying: a payment sent but not confirmed in time. */
export function retryHash(phase: TxPhase): Hex | undefined {
  return phase.step === 'failed' && phase.failure.kind === 'unconfirmed' ? phase.txHash : undefined
}

export type KeyStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const keyFor = (jobId: string) => `cobweb-art-payment:${jobId}`
const HASH_RE = /^0x[0-9a-fA-F]{64}$/

/** The browser's localStorage, or null where it is blocked or absent. */
export function browserStore(): KeyStore | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export function rememberPayment(store: KeyStore | null, jobId: string, hash: Hex): void {
  try {
    store?.setItem(keyFor(jobId), hash)
  } catch {
    // Storage blocked: the payment is still checked in this visit.
  }
}

/** A payment this browser sent for the job and the server has not recorded yet, or null. */
export function pendingPayment(store: KeyStore | null, jobId: string): Hex | null {
  try {
    const value = store?.getItem(keyFor(jobId)) ?? null
    return value && HASH_RE.test(value) ? (value as Hex) : null
  } catch {
    return null
  }
}

export function forgetPayment(store: KeyStore | null, jobId: string): void {
  try {
    store?.removeItem(keyFor(jobId))
  } catch {
    // Storage blocked: nothing was kept.
  }
}
```

`apps/web/src/lib/chain/chain-view.ts`:

```ts
import { chainById } from '@cobweb/shared'
import type { SupportedChain } from '@/lib/demo/types'

/** A chain as the screens show it (name, symbol, explorer), from the shared chain list. Any id renders. */
export function chainView(chainId: number): SupportedChain {
  const chain = chainById(chainId)
  if (!chain)
    return {
      id: chainId,
      name: chainId === 0 ? 'No network yet' : `Chain ${chainId}`,
      nativeSymbol: 'ETH',
      explorerUrl: '',
      transferLock: false,
    }
  return {
    id: chain.id,
    name: chain.name,
    nativeSymbol: chain.nativeSymbol,
    explorerUrl: chain.explorerUrl,
    transferLock: !chain.testnet,
  }
}
```

In `apps/web/src/lib/steps.ts`, replace:

```ts
if (stage === 'upload' && options.artDeferred) return 'open'
```

with:

```ts
// Lock and upload opens on a draft: its review step is where the art is checked and locked.
if (stage === 'upload' && (options.artDeferred || status === 'draft')) return 'open'
```

In `apps/web/src/components/deploy/tx-progress.tsx`, replace:

```ts
export type TxFailure = {
  /** rejected: cancelled in the wallet. reverted: the simulation failed. balance: not enough funds. */
  kind: 'rejected' | 'reverted' | 'balance' | 'switch'
```

with:

```ts
export type TxFailure = {
  /**
   * rejected: cancelled in the wallet. reverted: the simulation or the transaction failed. balance:
   * not enough funds. switch: the wallet is on another chain. refused: a check before the wallet, or
   * the server, refused it. unconfirmed: sent but not confirmed in time; trying again checks it again.
   */
  kind: 'rejected' | 'reverted' | 'balance' | 'switch' | 'refused' | 'unconfirmed'
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @cobweb/web exec vitest run src/components/upload/pay-machine.test.ts src/lib/chain/chain-view.test.ts src/lib/steps.test.ts`
Expected: PASS, 3 files.

- [ ] **Step 5: The render seam, the sample actions, the real actions and the shared types**

`apps/web/src/components/upload/render-sim.ts`:

```ts
/**
 * Seam: rendering stays simulated until Phase 4 (MASTER_PLAN, Phase 4: render pipeline).
 * `followRender` stands in for following the paid job's batches as the render Lambdas update
 * `render_jobs` and `render_batches`, and `retryBatch` for the action that re-queues a failed batch.
 * Review, lock, quote, payment and unlock are real (upload-actions.ts, pay-machine.ts).
 */
import type { UploadOutcome } from './upload-sim'

/** Tokens per render batch for a fresh job (`render_jobs.batch_size`). */
export const RENDER_BATCH_SIZE = 100

/** Rough real-world time per batch, for the estimate shown to the creator. */
export const SECONDS_PER_BATCH = 95

/** Coarse render progress: whole batches, then the metadata. Nothing is reported per image. */
export type RenderProgress = {
  phase: 'images' | 'metadata' | 'done'
  total: number
  done: number
  size: number
  /** The batch number (1-based) that failed, while it waits for a retry. */
  failedBatch?: number
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason)
    const timer = setTimeout(resolve, ms)
    const abort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    signal.addEventListener('abort', abort, { once: true })
  })
}

/**
 * Follows the render from `start` until the metadata is pinned. With the `batch-failed` sample
 * outcome, the batch after the starting point fails once and the run stops until `followRender` is
 * called again from `retryBatch`'s progress.
 */
export async function followRender(
  start: RenderProgress,
  onProgress: (progress: RenderProgress) => void,
  options: { outcome?: UploadOutcome; signal: AbortSignal },
): Promise<void> {
  const failAt = options.outcome === 'batch-failed' ? Math.min(start.done + 2, start.total) : null
  let progress = { ...start, failedBatch: undefined }
  while (progress.done < progress.total) {
    await sleep(750, options.signal)
    if (failAt !== null && progress.done + 1 === failAt) {
      onProgress({ ...progress, failedBatch: failAt })
      return
    }
    progress = { ...progress, done: progress.done + 1 }
    onProgress(progress)
  }
  progress = { ...progress, phase: 'metadata' }
  onProgress(progress)
  await sleep(2400, options.signal)
  onProgress({ ...progress, phase: 'done' })
}

/** Re-queues the failed batch: the run continues from where it stopped. */
export function retryBatch(progress: RenderProgress): RenderProgress {
  return { ...progress, failedBatch: undefined }
}
```

`apps/web/src/components/upload/upload-sim.ts` (whole file):

```ts
/**
 * Sample mode only (`NEXT_PUBLIC_DEMO_DATA=1`): the Lock and upload actions simulated in client
 * state, so every state can be reviewed without a wallet, a chain or a database, as the Art screens
 * do. Real mode uses `realActions` (upload-actions.ts) and pays through wagmi (pay-machine.ts);
 * rendering is simulated in both until Phase 4 (render-sim.ts).
 *
 * Failures are driven by `?outcome=` in sample mode, on the first attempt only, so every failure
 * state can be reviewed and "Try again" then succeeds. `check-failed` gives the sample set two
 * identical tokens, so the duplicates check on the Review step can be reviewed.
 */
import type { TxFailure, TxPhase } from '@/components/deploy/tx-progress'
import { jobBase } from '@/lib/art/render-job'
import { sampleTxHash } from '@/lib/demo/helpers'
import type { Hex, RenderJob } from '@/lib/demo/types'
import { RENDER_BATCH_SIZE } from './render-sim'
import type { UploadActions } from './upload-shared'

export type UploadOutcome = 'rejected' | 'reverted' | 'balance' | 'check-failed' | 'batch-failed'

export const UPLOAD_OUTCOMES: UploadOutcome[] = [
  'rejected',
  'reverted',
  'balance',
  'check-failed',
  'batch-failed',
]

/** The creator's choices under "Lock options", stored with the job (`RenderJob['lockOptions']`). */
export type LockOptions = {
  /** Accept identical trait combinations; the server honours it when it validates the list at lock. */
  allowDuplicates: boolean
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(signal.reason)
      },
      { once: true },
    )
  })
}

const DAY = 24 * 60 * 60
const nowSeconds = () => Math.floor(Date.now() / 1000)

/** The screen's actions in sample mode: they wait like the real ones and write nothing. */
export function sampleActions(initial: RenderJob): UploadActions {
  const base = jobBase(initial)
  const batches = {
    total: Math.max(1, Math.ceil(base.tokenCount / RENDER_BATCH_SIZE)),
    done: 0,
    size: RENDER_BATCH_SIZE,
  }
  const paid = (txHash: Hex | null): RenderJob => ({
    ...base,
    state: 'paid',
    payment: txHash ? { txHash, paidAt: nowSeconds(), amountWei: base.quote.totalWei } : null,
    batches,
  })
  return {
    lock: async () => {
      await sleep(1200)
      return {
        ok: true,
        data: {
          ...base,
          lockedAt: nowSeconds(),
          quote: { ...base.quote, expiresAt: nowSeconds() + DAY },
          state: 'payment_due',
        },
      }
    },
    unlock: async () => {
      await sleep(600)
      return { ok: true, data: null }
    },
    requote: async () => ({
      ok: true,
      data: { ...base, quote: { ...base.quote, expiresAt: nowSeconds() + DAY }, state: 'payment_due' },
    }),
    confirm: async (_jobId, txHash) => ({ ok: true, data: paid(txHash) }),
    reload: async () => ({ ok: true, data: initial }),
    lockPlaceholder: async () => {
      await sleep(1200)
      return { ok: true, data: { ...paid(null), lockedAt: nowSeconds() } }
    },
    uploadPlaceholder: null,
    removePlaceholder: async () => ({ ok: true, data: undefined }),
  }
}

const FAILURES: Record<
  'rejected' | 'reverted' | 'balance',
  { at: 'simulating' | 'wallet'; failure: TxFailure }
> = {
  rejected: {
    at: 'wallet',
    failure: {
      kind: 'rejected',
      title: 'Payment cancelled in your wallet',
      message: 'Nothing was sent and nothing was charged. Try again when you are ready.',
    },
  },
  reverted: {
    at: 'simulating',
    failure: {
      kind: 'reverted',
      title: 'The payment would fail',
      message:
        'The check against the factory reverted with JobAlreadyPaid: this wallet has a payment for this job already. Refresh the page; if the job still asks for payment, contact support.',
    },
  },
  balance: {
    at: 'simulating',
    failure: {
      kind: 'balance',
      title: 'Not enough funds in this wallet',
      message:
        'The fee and network gas are more than this wallet holds on the network. Add funds, then try again.',
    },
  },
}

/** Sample mode's payment: simulate, the wallet, the receipt and the server's check, with pauses. */
export async function payArtFee(
  onPhase: (phase: TxPhase) => void,
  options: { outcome?: UploadOutcome; signal: AbortSignal },
): Promise<Hex | null> {
  const { signal, outcome } = options
  const failure = outcome && outcome in FAILURES ? FAILURES[outcome as keyof typeof FAILURES] : null

  onPhase({ step: 'simulating' })
  await sleep(900, signal)
  if (failure?.at === 'simulating') {
    onPhase({ step: 'failed', ...failure })
    return null
  }

  onPhase({ step: 'wallet' })
  await sleep(1600, signal)
  if (failure?.at === 'wallet') {
    onPhase({ step: 'failed', ...failure })
    return null
  }

  const txHash = sampleTxHash(Math.floor(Date.now() / 1000) % 100_000)
  onPhase({ step: 'confirming', txHash })
  await sleep(1800, signal)
  onPhase({ step: 'verifying', txHash })
  await sleep(2000, signal)
  onPhase({ step: 'success', txHash })
  return txHash
}
```

`apps/web/src/components/upload/upload-shared.ts` (whole file):

```ts
import type { ActionResult } from '@/lib/art/result'
import type { Hex, RenderJob, RenderPlaceholder } from '@/lib/demo/types'

/** A placeholder file stored through the uploader, or why it was not. */
export type PlaceholderUpload = { uploadId: string; url: string } | { error: string }

/**
 * What the Lock and upload screen does, in one shape for both modes: `realActions`
 * (upload-actions.ts) calls the server, `sampleActions` (upload-sim.ts) simulates in the browser.
 */
export type UploadActions = {
  lock(input: { allowDuplicates: boolean; chainId: number }): Promise<ActionResult<RenderJob>>
  unlock(): Promise<ActionResult<null>>
  requote(): Promise<ActionResult<RenderJob>>
  confirm(jobId: string, txHash: Hex): Promise<ActionResult<RenderJob>>
  reload(): Promise<ActionResult<RenderJob | null>>
  lockPlaceholder(uploadId: string | null): Promise<ActionResult<RenderJob>>
  /** Stores a placeholder file (`uploads` kind placeholder). Null in sample mode, which keeps it in the browser. */
  uploadPlaceholder: ((file: File) => Promise<PlaceholderUpload>) | null
  removePlaceholder(uploadId: string): Promise<ActionResult>
}

/**
 * The IPFS result of a finished render. The real set's CIDs are null when the art is deferred and
 * only the placeholder was rendered; `placeholder` is null without "Reveal later".
 */
export type RenderResult = {
  imagesCid: string | null
  metadataCid: string | null
  placeholder: RenderPlaceholder | null
}

/** A public gateway for the "open" links next to CIDs. */
export const IPFS_GATEWAY = 'https://ipfs.io/ipfs/'

/**
 * The sample preview for a token id. Only 24 sample images exist, so ids past 24 reuse them.
 * Replaced by: the rendered image at `ipfs://<imagesCid>/<id>.png` through the gateway (Phase 4).
 */
export function tokenPreview(id: number): string {
  return `/demo/tokens/${((id - 1) % 24) + 1}.svg`
}

/** "about 12 minutes", "under a minute", "about 1 hour 5 minutes". */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return 'under a minute'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `about ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return `about ${hours} ${hours === 1 ? 'hour' : 'hours'}${rest ? ` ${rest} minutes` : ''}`
}
```

`apps/web/src/components/upload/upload-actions.ts`:

```ts
import {
  confirmArtPayment,
  getRenderJob,
  lockArt,
  lockPlaceholder,
  quoteArt,
  unlockArt,
} from '@/app/actions/lock'
import { deleteUpload } from '@/app/actions/uploads'
import { createUploader } from '@/components/art/uploads/create-uploader'
import { uploadOnce } from '@/components/art/uploads/upload-once'
import { done, fail, NO_PLACEHOLDER } from '@/lib/art/result'
import type { UploadActions } from './upload-shared'

/**
 * Lock and upload against the server (docs/specs/2026-10-09-lock-and-pay.md, section 8). The
 * payment itself runs in the pay step through wagmi (pay-machine.ts); sample mode uses
 * `sampleActions` (upload-sim.ts) instead.
 */
export function realActions(collectionId: string): UploadActions {
  const startPlaceholder = createUploader({ collectionId, kind: 'placeholder' })
  return {
    lock: (input) => lockArt(collectionId, input),
    unlock: () => unlockArt(collectionId),
    requote: () => quoteArt(collectionId),
    confirm: (jobId, txHash) => confirmArtPayment(collectionId, jobId, txHash),
    reload: () => getRenderJob(collectionId),
    lockPlaceholder: async (uploadId) =>
      uploadId ? lockPlaceholder(collectionId, uploadId) : fail(NO_PLACEHOLDER),
    uploadPlaceholder: async (file) => {
      const stored = await uploadOnce(startPlaceholder, file)
      return 'error' in stored ? stored : { uploadId: stored.record.id, url: stored.record.url }
    },
    removePlaceholder: async (uploadId) => {
      const result = await deleteUpload(uploadId)
      return 'error' in result ? fail(result.error) : done
    },
  }
}
```

In `apps/web/src/components/upload/render-step.tsx`, replace:

```ts
import { followRender, SECONDS_PER_BATCH, type RenderProgress, type UploadOutcome } from './upload-sim'
```

with:

```ts
import { followRender, retryBatch, SECONDS_PER_BATCH, type RenderProgress } from './render-sim'
import type { UploadOutcome } from './upload-sim'
```

and replace:

```ts
run({ ...progress, failedBatch: undefined })
```

with:

```ts
run(retryBatch(progress))
```

- [ ] **Step 6: The placeholder is stored through the uploader**

In `apps/web/src/components/upload/reveal-later.tsx`, replace the imports block's last line:

```ts
import { formatBytes } from '@/components/art/lib/image-checks'
```

with:

```ts
import { formatBytes } from '@/components/art/lib/image-checks'
import type { ActionResult } from '@/lib/art/result'
import type { PlaceholderUpload } from './upload-shared'
```

replace:

```ts
  /** The URL is an object URL made here, so it must be revoked when replaced. */
  owned: boolean
}
```

with:

```ts
  /** The URL is an object URL made here, so it must be revoked when replaced. */
  owned: boolean
  /** The stored `uploads` row (real mode). Unset in sample mode, which keeps the file in the browser. */
  uploadId?: string
}
```

replace:

```ts
 * forces Reveal later. Seam: the file goes to storage and is pinned to its own CID by the render
 * pipeline (Phase 4).
 */
export function RevealChoice({
  state,
  onChange,
  readOnly,
}: {
  state: RevealLaterState
  onChange: (next: RevealLaterState) => void
  readOnly: boolean
}) {
```

with:

```ts
 * forces Reveal later. In real mode the file is stored as soon as it is picked (`uploads` kind
 * placeholder), because no file can be added once the art is locked; Phase 4 pins it to its own CID.
 */
export function RevealChoice({
  state,
  onChange,
  readOnly,
  upload = null,
  remove = null,
}: {
  state: RevealLaterState
  onChange: (next: RevealLaterState) => void
  readOnly: boolean
  /** Stores the picked file (real mode). Null in sample mode. */
  upload?: ((file: File) => Promise<PlaceholderUpload>) | null
  /** Deletes a stored placeholder file (real mode). */
  remove?: ((uploadId: string) => Promise<ActionResult>) | null
}) {
```

replace:

```ts
if (state.file?.owned) URL.revokeObjectURL(state.file.url)
onChange({
  ...state,
  file: {
    url: checked.url,
    fileName: file.name,
    mediaType: checked.mediaType,
    bytes: file.size,
    owned: true,
  },
})
```

with:

```ts
if (upload) {
  // Real mode: store the file now and show it from storage.
  URL.revokeObjectURL(checked.url)
  const stored = await upload(file)
  if ('error' in stored) {
    setErrors([stored.error])
    return
  }
  if (state.file?.uploadId && remove) await remove(state.file.uploadId)
  onChange({
    ...state,
    file: {
      url: stored.url,
      fileName: file.name,
      mediaType: checked.mediaType,
      bytes: file.size,
      owned: false,
      uploadId: stored.uploadId,
    },
  })
  return
}
if (state.file?.owned) URL.revokeObjectURL(state.file.url)
onChange({
  ...state,
  file: {
    url: checked.url,
    fileName: file.name,
    mediaType: checked.mediaType,
    bytes: file.size,
    owned: true,
  },
})
```

replace:

```ts
function remove() {
  if (state.file?.owned) URL.revokeObjectURL(state.file.url)
  onChange({ ...state, file: null })
}
```

with:

```ts
async function removeFile() {
  if (state.file?.uploadId && remove) {
    setChecking(true)
    const result = await remove(state.file.uploadId)
    setChecking(false)
    if (!result.ok) {
      setErrors([result.error])
      return
    }
  }
  if (state.file?.owned) URL.revokeObjectURL(state.file.url)
  onChange({ ...state, file: null })
}
```

and replace:

```tsx
                      <Button variant="ghost" size="sm" onClick={remove} disabled={checking}>
```

with:

```tsx
                      <Button variant="ghost" size="sm" onClick={removeFile} disabled={checking}>
```

- [ ] **Step 7: The review step on `reviewArt`**

`apps/web/src/components/upload/review-step.tsx` (whole file):

```tsx
'use client'

import { CheckIcon, CircleAlertIcon, ClockIcon, InfoIcon, LockIcon, XIcon } from 'lucide-react'
import Link from 'next/link'
import { useId, useState } from 'react'
import { useAccount } from 'wagmi'
import { Alert, AlertDescription, AlertTitle } from '@cobweb/ui/components/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@cobweb/ui/components/alert-dialog'
import { Artwork } from '@cobweb/ui/components/artwork'
import { Button } from '@cobweb/ui/components/button'
import { Spinner } from '@cobweb/ui/components/spinner'
import { Stat, StatGroup } from '@cobweb/ui/components/stat'
import { Switch } from '@cobweb/ui/components/switch'
import { cn } from '@cobweb/ui/lib/utils'
import { lockRefusal, reviewChecks, type ReviewData } from '@/lib/art/lock-review'
import type { RenderJob } from '@/lib/demo/types'
import type { FlowLink } from '@/lib/steps'
import { RevealChoice, type RevealLaterState } from './reveal-later'
import { tokenPreview, type UploadActions } from './upload-shared'
import type { LockOptions } from './upload-sim'

const STRIP = 8
const CONNECT_TO_LOCK = 'Connect your wallet to choose the network the fee is paid on.'

const fmt = (value: number) => value.toLocaleString('en-US')

/**
 * Review and lock. Opens with the reveal choice (Reveal at mint or Reveal later, with the
 * placeholder), then what will be locked with the four checks from `reviewArt` (supply, unique
 * tokens, rules, maximum counts) and the lock options, then the lock itself. "Allow identical
 * tokens" is offered only when duplicates are the only problem. With deferred art (MASTER_PLAN,
 * Flow: pre-reveal) only the placeholder is locked, at no cost; the real set is locked later.
 */
export function ReviewStep({
  review,
  previews,
  readOnly,
  previous,
  deferred,
  reveal,
  onReveal,
  lockOptions,
  onLockOptions,
  actions,
  collectionChainId,
  sample,
  onLocked,
}: {
  review: ReviewData
  /** Show the strip of sample token images (sample mode; real tokens have no image before rendering). */
  previews: boolean
  readOnly: boolean
  /** The screen before this one, where the set is changed. */
  previous?: FlowLink
  /** The art is deferred: lock the placeholder alone. */
  deferred: boolean
  reveal: RevealLaterState
  onReveal: (next: RevealLaterState) => void
  lockOptions: LockOptions
  onLockOptions: (next: LockOptions) => void
  actions: UploadActions
  /** `collections.chain_id`, when the collection has one. */
  collectionChainId: number | null
  sample: boolean
  onLocked: (job: RenderJob) => void
}) {
  const id = useId()
  const { chainId } = useAccount()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [locking, setLocking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lockChain = collectionChainId ?? chainId

  async function lock() {
    setError(null)
    setLocking(true)
    try {
      if (deferred) {
        const result = await actions.lockPlaceholder(reveal.file?.uploadId ?? null)
        if (result.ok) onLocked(result.data)
        else setError(result.error)
        return
      }
      // Reveal at mint: a placeholder file stored earlier is not part of this lock.
      if (!reveal.on && reveal.file?.uploadId) {
        const removed = await actions.removePlaceholder(reveal.file.uploadId)
        if (!removed.ok) return setError(removed.error)
        onReveal({ ...reveal, file: null })
      }
      const result = await actions.lock({
        allowDuplicates: lockOptions.allowDuplicates,
        chainId: lockChain ?? 0,
      })
      if (result.ok) onLocked(result.data)
      else setError(result.error)
    } finally {
      setLocking(false)
    }
  }

  const refusal = deferred ? null : lockRefusal(review, lockOptions.allowDuplicates)
  const blocked = refusal ?? (!sample && !deferred && lockChain === undefined ? CONNECT_TO_LOCK : null)
  const needsPlaceholder = reveal.on && !reveal.file
  const offerDuplicates = review.allowDuplicatesNeeded || lockOptions.allowDuplicates
  const checks = reviewChecks(review, lockOptions.allowDuplicates)
  const hasLayers = review.counts.layers > 0
  const lockLabel = deferred ? 'Lock placeholder' : 'Lock art'

  return (
    <div className="divide-y">
      <RevealChoice
        state={reveal}
        onChange={onReveal}
        readOnly={readOnly || locking}
        upload={actions.uploadPlaceholder}
        remove={sample ? null : actions.removePlaceholder}
      />

      {deferred ? (
        <div className="p-6">
          <Alert>
            <ClockIcon aria-hidden="true" />
            <AlertTitle>Lock the real art later from Art</AlertTitle>
            <AlertDescription>
              <p>
                You are finishing the art later, so this run locks and renders only the placeholder, at no
                cost. When the set is complete, continue from Generate to lock it. It is rendered to its own
                CID, and you reveal to it from Manage drop, Settings.
              </p>
              {previous && <BackLink link={previous} />}
            </AlertDescription>
          </Alert>
        </div>
      ) : (
        <>
          <section aria-labelledby={`${id}-locked`} className="space-y-5 p-6">
            <h4 id={`${id}-locked`} className="text-sm font-medium">
              What will be locked
            </h4>
            {previews && (
              <ul aria-label="Sample tokens" className="grid grid-cols-4 gap-2 sm:grid-cols-8">
                {Array.from({ length: STRIP }, (_, index) => (
                  <li key={index} className={cn(index >= 4 && 'hidden sm:block')}>
                    <Artwork
                      src={tokenPreview(index + 1)}
                      alt={`Token ${index + 1}`}
                      seed={`token-${index + 1}`}
                      className="border-border-strong rounded-lg border"
                    >
                      {index === STRIP - 1 && review.tokenCount > STRIP && (
                        <span className="bg-background/75 absolute inset-0 flex items-center justify-center text-[0.8125rem] font-medium backdrop-blur-[2px]">
                          <span className="numeric">+{fmt(review.tokenCount - STRIP)}</span>
                        </span>
                      )}
                    </Artwork>
                  </li>
                ))}
              </ul>
            )}
            <StatGroup>
              <Stat label="Tokens" value={fmt(review.tokenCount)} />
              <Stat label="Collections" value={review.counts.collections} />
              {hasLayers && <Stat label="Layers" value={review.counts.layers} />}
              {hasLayers && <Stat label="Traits" value={review.counts.traits} />}
              {hasLayers && <Stat label="Rules" value={review.counts.rules} />}
            </StatGroup>
          </section>

          <section aria-labelledby={`${id}-checks`} className="space-y-3 p-6">
            <h4 id={`${id}-checks`} className="text-sm font-medium">
              Checks
            </h4>
            <ul className="space-y-2">
              {checks.map((entry) => (
                <li key={entry.key} className="flex items-start gap-3">
                  {entry.problems.length === 0 ? (
                    <CheckIcon
                      aria-hidden="true"
                      className="text-success-foreground mt-0.5 size-4 shrink-0"
                    />
                  ) : (
                    <CircleAlertIcon aria-hidden="true" className="text-warning mt-0.5 size-4 shrink-0" />
                  )}
                  <div className="space-y-1">
                    <p className="text-sm">
                      {entry.label}
                      <span className="sr-only">
                        {entry.problems.length === 0 ? ': passed' : ': needs a fix'}
                      </span>
                    </p>
                    {entry.problems.map((message) => (
                      <p key={message} className="text-muted-foreground text-[0.8125rem] leading-snug">
                        {message}
                      </p>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
            {refusal && previous && <BackLink link={previous} />}
          </section>

          <section aria-labelledby={`${id}-options`} className="space-y-4 p-6">
            <h4 id={`${id}-options`} className="text-sm font-medium">
              Lock options
            </h4>
            {offerDuplicates && (
              <div className="flex items-start justify-between gap-6">
                <div className="space-y-1">
                  <label htmlFor={`${id}-duplicates`} className="text-sm font-medium">
                    Allow identical tokens
                  </label>
                  <p className="text-muted-foreground max-w-xl text-[0.8125rem] leading-snug">
                    {lockOptions.allowDuplicates
                      ? 'Tokens with the same traits are locked as they are.'
                      : 'The only problem is tokens with the same traits. Turn this on if your project wants duplicates.'}
                  </p>
                </div>
                <Switch
                  id={`${id}-duplicates`}
                  checked={lockOptions.allowDuplicates}
                  disabled={readOnly || locking}
                  onCheckedChange={(allowDuplicates) => onLockOptions({ ...lockOptions, allowDuplicates })}
                />
              </div>
            )}

            <div className="flex items-start gap-3">
              <InfoIcon aria-hidden="true" className="text-muted-foreground mt-0.5 size-4 shrink-0" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Traits with a maximum count stay at or under it</p>
                <p className="text-muted-foreground text-[0.8125rem] leading-snug">
                  {review.constants.length
                    ? review.constants.map((entry, index) => (
                        <span key={entry.name}>
                          {index > 0 && ', '}
                          {entry.name} up to <span className="numeric">{entry.count}</span>
                        </span>
                      ))
                    : 'No trait in this set has a maximum count.'}
                </p>
              </div>
            </div>
          </section>
        </>
      )}

      {error && (
        <div className="p-6">
          <Alert variant="destructive">
            <XIcon aria-hidden="true" />
            <AlertTitle>{deferred ? 'The placeholder was not locked' : 'The art was not locked'}</AlertTitle>
            <AlertDescription>
              <p>{error}</p>
              {previous && <BackLink link={previous} />}
            </AlertDescription>
          </Alert>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4 p-6">
        <p
          className={cn(
            'flex max-w-md items-start gap-2 text-[0.8125rem] leading-snug',
            blocked ? 'text-foreground/90' : 'text-muted-foreground',
          )}
        >
          {blocked ? (
            <CircleAlertIcon aria-hidden="true" className="text-warning mt-0.5 size-3.5 shrink-0" />
          ) : (
            <LockIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          )}
          {blocked ??
            (needsPlaceholder
              ? 'Add a placeholder to lock with Reveal later, or choose Reveal at mint.'
              : deferred
                ? 'Locking the placeholder is final for this run. The art stays open until you lock the real set.'
                : 'Locking is final once the fee is paid. Until then you can unlock and edit again.')}
        </p>
        {!readOnly && (
          <Button onClick={() => setConfirmOpen(true)} disabled={locking || needsPlaceholder || !!blocked}>
            {locking ? <Spinner /> : <LockIcon />}
            {locking ? 'Locking' : error ? 'Lock again' : lockLabel}
          </Button>
        )}
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{deferred ? 'Lock the placeholder?' : 'Lock the art?'}</AlertDialogTitle>
            <AlertDialogDescription>
              {deferred
                ? 'Cobweb stores the placeholder, and the contract starts on it. There is no fee for the placeholder. The art stays open; you lock the real set later from Art.'
                : `Cobweb checks and stores these ${fmt(review.tokenCount)} tokens exactly as they are now, and quotes the fee from this supply. You cannot edit the layers, traits, rules or tokens afterwards, unless you unlock before paying.`}
              {!deferred && lockOptions.allowDuplicates && ' Identical tokens are allowed.'}
              {!deferred && reveal.on && ' The contract will start on the placeholder.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction onClick={lock}>
              <LockIcon />
              {lockLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function BackLink({ link }: { link: FlowLink }) {
  return (
    <Link href={link.href} className="text-foreground underline underline-offset-4">
      Go to {link.name}
    </Link>
  )
}
```

- [ ] **Step 8: The pay step through wagmi**

`apps/web/src/components/upload/pay-step.tsx` (whole file):

```tsx
'use client'

import { InfoIcon, LockOpenIcon, RefreshCwIcon, WalletIcon } from 'lucide-react'
import { useEffect, useReducer, useRef, useState } from 'react'
import type { Address, Hex } from 'viem'
import { useAccount, useConfig } from 'wagmi'
import { simulateContract, waitForTransactionReceipt, writeContract } from 'wagmi/actions'
import { factoryAbi } from '@cobweb/shared'
import { Alert, AlertDescription, AlertTitle } from '@cobweb/ui/components/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@cobweb/ui/components/alert-dialog'
import { Button } from '@cobweb/ui/components/button'
import { Spinner } from '@cobweb/ui/components/spinner'
import { ChainName } from '@/components/chains/chain-icon'
import { SummaryRow } from '@/components/deploy/copy-value'
import { isTxRunning, TX_IDLE, TxProgress } from '@/components/deploy/tx-progress'
import { quoteExpired } from '@/lib/art/quote'
import { explorerTxUrl, formatNative, shortAddress } from '@/lib/demo/helpers'
import type { RenderJob, SupportedChain } from '@/lib/demo/types'
import {
  browserStore,
  forgetPayment,
  payReducer,
  pendingPayment,
  rememberPayment,
  retryHash,
  runPayment,
} from './pay-machine'
import type { UploadActions } from './upload-shared'
import { payArtFee, type UploadOutcome } from './upload-sim'

/**
 * Pay the generation fee (docs/specs/2026-10-09-lock-and-pay.md, section 8): the quote, then
 * `payForArt(jobId)` simulated, sent from the quote's wallet, mined, and confirmed by the server from
 * the receipt. While the fee is unpaid the art can be unlocked, and an expired quote is renewed
 * without unlocking. Sample mode simulates the payment (upload-sim.ts).
 */
export function PayStep({
  job,
  chain,
  readOnly,
  sample,
  outcome,
  actions,
  onPaid,
  onUnlocked,
  onRequoted,
}: {
  job: RenderJob
  chain: SupportedChain
  readOnly: boolean
  sample: boolean
  outcome?: UploadOutcome
  actions: UploadActions
  onPaid: (job: RenderJob) => void
  onUnlocked: () => void
  onRequoted: (job: RenderJob) => void
}) {
  const quote = job.quote
  const config = useConfig()
  const { address, chainId } = useAccount()
  const [phase, dispatch] = useReducer(payReducer, TX_IDLE)
  const [attempt, setAttempt] = useState(0)
  const [now, setNow] = useState<number | null>(null)
  const [resumable, setResumable] = useState<Hex | null>(null)
  const [unlockOpen, setUnlockOpen] = useState(false)
  const [busy, setBusy] = useState<'unlock' | 'requote' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const controller = useRef<AbortController | null>(null)
  const running = isTxRunning(phase)
  const symbol = chain.nativeSymbol
  const total = formatNative(quote.totalWei, symbol, 8)
  const amount = total.slice(0, total.lastIndexOf(' '))
  // Sample quotes are dated in the past; only a real quote expires on screen.
  const expired = !sample && now !== null && quoteExpired(quote.expiresAt, now)
  // A payment was sent and is not recorded yet: unlocking now would strand it.
  const sent =
    resumable !== null || (phase.step !== 'idle' && phase.txHash !== undefined && phase.step !== 'success')
  const txUrl = chain.explorerUrl ? (hash: Hex) => explorerTxUrl(chain, hash) : undefined
  const waiting = resumable !== null && phase.step === 'idle'

  useEffect(() => () => controller.current?.abort(), [])
  useEffect(() => {
    const tick = () => setNow(Math.floor(Date.now() / 1000))
    tick()
    const timer = setInterval(tick, 30_000)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    if (!sample) setResumable(pendingPayment(browserStore(), job.id))
  }, [sample, job.id])

  async function paySample() {
    controller.current = new AbortController()
    try {
      const txHash = await payArtFee((next) => dispatch({ type: 'set', phase: next }), {
        outcome: attempt === 0 ? outcome : undefined,
        signal: controller.current.signal,
      })
      setAttempt((count) => count + 1)
      if (!txHash) return
      const result = await actions.confirm(job.id, txHash)
      if (result.ok) onPaid(result.data)
    } catch {
      // Unmounted mid-payment.
    }
  }

  async function payReal() {
    setNotice(null)
    const store = browserStore()
    const sentHash = retryHash(phase) ?? resumable ?? undefined
    const paid = await runPayment(
      {
        payer: quote.payer,
        account: address,
        chainId: quote.chainId,
        connectedChainId: chainId,
        chainName: chain.name,
        factory: quote.factory ?? null,
        sentHash,
      },
      {
        simulate: async () => {
          const simulated = await simulateContract(config, {
            address: quote.factory as Address,
            abi: factoryAbi,
            functionName: 'payForArt',
            args: [job.jobId],
            value: BigInt(quote.totalWei),
            chainId: quote.chainId,
            account: address as Address,
          })
          // CLAUDE.md rule 2: the wallet gets exactly the request the simulation passed.
          return () => writeContract(config, simulated.request)
        },
        wait: async (hash) =>
          (await waitForTransactionReceipt(config, { hash, chainId: quote.chainId })).status,
        confirm: (hash) => actions.confirm(job.id, hash),
        reload: () => actions.reload(),
        remember: (hash) => rememberPayment(store, job.id, hash),
        forget: () => forgetPayment(store, job.id),
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        now: () => Date.now(),
      },
      dispatch,
    )
    setResumable(pendingPayment(store, job.id))
    if (paid) onPaid(paid)
  }

  async function unlock() {
    setBusy('unlock')
    setNotice(null)
    const result = await actions.unlock()
    setBusy(null)
    if (result.ok) onUnlocked()
    else setNotice(result.error)
  }

  async function requote() {
    setBusy('requote')
    setNotice(null)
    const result = await actions.requote()
    setBusy(null)
    if (!result.ok) return setNotice(result.error)
    dispatch({ type: 'set', phase: TX_IDLE })
    onRequoted(result.data)
  }

  return (
    <div className="divide-y">
      <div className="grid gap-8 p-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="space-y-2">
          <p className="text-muted-foreground text-[0.8125rem]">Generation fee</p>
          <p className="flex items-baseline gap-2">
            <span className="numeric text-[2.5rem] leading-none font-medium tracking-tight">{amount}</span>
            <span className="numeric text-muted-foreground text-base">{symbol}</span>
          </p>
          <p className="text-muted-foreground text-[0.8125rem]">
            <span className="numeric text-foreground/85">{quote.tokenCount.toLocaleString('en-US')}</span>{' '}
            tokens ×{' '}
            <span className="numeric text-foreground/85">{formatNative(quote.perTokenWei, symbol, 8)}</span>{' '}
            per token
          </p>
        </div>
        <dl className="divide-y">
          <SummaryRow label="Network">
            <ChainName chain={chain} iconClassName="size-3.5" />
          </SummaryRow>
          <SummaryRow label="Paid to">Cobweb factory</SummaryRow>
          <SummaryRow label="From your wallet">
            <span className="numeric text-[0.8125rem]" title={quote.payer}>
              {shortAddress(quote.payer, 6)}
            </span>
          </SummaryRow>
          <SummaryRow label="Total">
            <span className="numeric font-medium">{total}</span>
          </SummaryRow>
        </dl>
      </div>

      {expired && !readOnly && (
        <div className="p-6">
          <Alert>
            <RefreshCwIcon aria-hidden="true" />
            <AlertTitle>The quote expired</AlertTitle>
            <AlertDescription>
              <p>A quote lasts 24 hours, so the fee follows the current rate. Get a new quote to pay.</p>
              <Button variant="secondary" size="sm" onClick={requote} disabled={busy !== null}>
                {busy === 'requote' ? <Spinner /> : <RefreshCwIcon />}
                Get a new quote
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      )}

      {waiting && (
        <div className="p-6">
          <Alert>
            <InfoIcon aria-hidden="true" />
            <AlertTitle>A payment is waiting to be checked</AlertTitle>
            <AlertDescription>
              This browser sent a payment for this job that Cobweb has not confirmed yet. Check it before you
              pay again.
            </AlertDescription>
          </Alert>
        </div>
      )}

      {phase.step !== 'idle' && (
        <div className="p-6">
          <TxProgress
            phase={phase}
            txUrl={txUrl}
            steps={[
              {
                step: 'simulating',
                label: 'Checking the payment',
                detail:
                  'A dry run against the factory, so the wallet only opens for a payment that will go through.',
              },
              {
                step: 'wallet',
                label: 'Confirm in your wallet',
                detail: `Your wallet shows ${total} to the Cobweb factory on ${chain.name}.`,
              },
              {
                step: 'confirming',
                label: `Confirming on ${chain.name}`,
                detail: 'Sent. Waiting for the transaction to be included in a block.',
              },
              {
                step: 'verifying',
                label: 'Waiting for confirmation',
                detail:
                  'Cobweb is checking the payment event against your quote. Rendering starts as soon as it matches.',
              },
            ]}
          />
        </div>
      )}

      {notice && (
        <div className="p-6">
          <Alert variant="destructive">
            <AlertTitle>That did not go through</AlertTitle>
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4 p-6">
        <p className="text-muted-foreground max-w-md text-[0.8125rem] leading-snug">
          Only a payment from <span className="numeric">{shortAddress(quote.payer)}</span> counts for this
          job. The job is marked paid once the payment is confirmed on chain, not when you sign.
        </p>
        {!readOnly && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              onClick={() => setUnlockOpen(true)}
              disabled={running || sent || busy !== null}
            >
              {busy === 'unlock' ? <Spinner /> : <LockOpenIcon />}
              Unlock the art
            </Button>
            <Button onClick={sample ? paySample : payReal} disabled={running || expired || busy !== null}>
              {running ? <Spinner /> : <WalletIcon />}
              {running
                ? 'Paying'
                : waiting
                  ? 'Check the payment'
                  : phase.step === 'failed'
                    ? 'Try again'
                    : `Pay ${total}`}
            </Button>
          </div>
        )}
      </div>

      <AlertDialog open={unlockOpen} onOpenChange={setUnlockOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unlock the art?</AlertDialogTitle>
            <AlertDialogDescription>
              The lock and the quote are discarded and the Art step opens again, so you can change the layers,
              rules or tokens and lock again. Nothing has been paid, so there is nothing to refund.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep the lock</AlertDialogCancel>
            <AlertDialogAction onClick={unlock}>
              <LockOpenIcon />
              Unlock the art
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
```

- [ ] **Step 9: The flow, the screen and the page on real data**

`apps/web/src/components/upload/upload-flow.tsx` (whole file):

```tsx
'use client'

import { ExternalLinkIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { StatusBadge } from '@cobweb/ui/components/status-badge'
import { ChainName } from '@/components/chains/chain-icon'
import { StageFooter } from '@/components/shell/stage-footer'
import type { ReviewData } from '@/lib/art/lock-review'
import { chainView } from '@/lib/chain/chain-view'
import { explorerTxUrl, formatNative, formatUtc, shortAddress } from '@/lib/demo/helpers'
import type { RenderJob } from '@/lib/demo/types'
import type { FlowLink } from '@/lib/steps'
import { DoneStep } from './done-step'
import { PayStep } from './pay-step'
import { Dot, ProgressionItem, type ProgressionState } from './progression'
import { RENDER_BATCH_SIZE, type RenderProgress } from './render-sim'
import { RenderStep } from './render-step'
import type { RevealLaterState } from './reveal-later'
import { ReviewStep } from './review-step'
import { realActions } from './upload-actions'
import type { RenderResult } from './upload-shared'
import { sampleActions, type LockOptions, type UploadOutcome } from './upload-sim'

type Stage = 'review' | 'pay' | 'render' | 'done'

const ORDER: Stage[] = ['review', 'pay', 'render', 'done']

const STAGE_FOR_JOB: Record<RenderJob['state'], Stage> = {
  locked: 'review',
  payment_due: 'pay',
  paid: 'render',
  waived: 'render',
  rendering: 'render',
  failed: 'render',
  done: 'done',
}

export type UploadFlowProps = {
  collectionId: string
  /** `collections.chain_id`: the quote is on it when set, otherwise on the chain the wallet is on at lock. */
  collectionChainId: number | null
  job: RenderJob
  /** The job to fall back to after an unlock: nothing locked yet. */
  pending: RenderJob
  review: ReviewData
  sample: boolean
  /** CIDs to finish on when the simulated render completes. Its placeholder CID stands in for any file picked. */
  sampleResult: RenderResult
  /** The description saved with the job's placeholder, when it has one. */
  placeholderDescription: string
  /** "Finish the art later" (MASTER_PLAN, Flow: pre-reveal): this run locks and renders the placeholder alone. */
  deferred: boolean
  readOnly: boolean
  previous?: FlowLink
  next?: FlowLink
  outcome?: UploadOutcome
}

function revealFrom(job: RenderJob, deferred: boolean, description: string): RevealLaterState {
  const placeholder = job.placeholder
  const extension =
    placeholder?.mediaType === 'video' ? 'mp4' : placeholder?.mediaType === 'gif' ? 'gif' : 'png'
  return {
    on: deferred || placeholder !== null,
    forced: deferred,
    file: placeholder
      ? {
          url: placeholder.imageUrl,
          fileName: `placeholder.${extension}`,
          mediaType: placeholder.mediaType,
          bytes: null,
          owned: false,
          ...(placeholder.uploadId ? { uploadId: placeholder.uploadId } : {}),
        }
      : null,
    description: placeholder ? description : '',
  }
}

function renderStartOf(job: RenderJob): RenderProgress {
  return 'batches' in job
    ? { phase: 'images', ...job.batches }
    : {
        phase: 'images',
        total: Math.max(1, Math.ceil(job.tokenCount / RENDER_BATCH_SIZE)),
        done: 0,
        size: RENDER_BATCH_SIZE,
      }
}

/**
 * The four states of Lock and upload as one vertical progression. The job from the server sets
 * where it starts; review, lock, pay and unlock then run through `realActions` (sample mode:
 * `sampleActions`), and rendering is simulated until Phase 4 (render-sim.ts).
 */
export function UploadFlow({
  collectionId,
  collectionChainId,
  job: initialJob,
  pending,
  review,
  sample,
  sampleResult,
  placeholderDescription,
  deferred,
  readOnly,
  previous,
  next,
  outcome,
}: UploadFlowProps) {
  const router = useRouter()
  const actions = useMemo(
    () => (sample ? sampleActions(initialJob) : realActions(collectionId)),
    [sample, initialJob, collectionId],
  )
  const [job, setJob] = useState(initialJob)
  const [stage, setStage] = useState<Stage>(STAGE_FOR_JOB[initialJob.state])
  // "Reveal later": forced on for deferred art, and on whenever the job already has a placeholder.
  const [reveal, setReveal] = useState<RevealLaterState>(() =>
    revealFrom(initialJob, deferred, placeholderDescription),
  )
  const placeholderOn = reveal.on && reveal.file !== null
  const [lockOptions, setLockOptions] = useState<LockOptions>(initialJob.lockOptions)
  const chain = chainView(job.quote.chainId)
  const paymentTx = 'payment' in job ? (job.payment?.txHash ?? null) : null
  const free = job.quote.totalWei === '0'
  const renderStart = renderStartOf(job)
  const result: RenderResult =
    job.state === 'done'
      ? job
      : {
          imagesCid: deferred ? null : sampleResult.imagesCid,
          metadataCid: deferred ? null : sampleResult.metadataCid,
          placeholder:
            placeholderOn && reveal.file
              ? {
                  cid: sampleResult.placeholder?.cid ?? '',
                  mediaType: reveal.file.mediaType,
                  imageUrl: reveal.file.url,
                }
              : null,
        }
  const total = formatNative(job.quote.totalWei, chain.nativeSymbol, 8)
  const current = ORDER.indexOf(stage)
  const stateOf = (item: Stage): ProgressionState => {
    const index = ORDER.indexOf(item)
    return index < current ? 'done' : index === current ? 'current' : 'pending'
  }
  // The last state shows its body while it is the current one, and stays open once done.
  const doneState: ProgressionState = stage === 'done' ? 'current' : 'pending'

  /** A job from the server: show the step its state belongs to, and refresh the stepper and the Art screens. */
  function settle(nextJob: RenderJob) {
    setJob(nextJob)
    setStage(STAGE_FOR_JOB[nextJob.state])
    if (!sample) router.refresh()
  }

  function unlocked() {
    setJob(pending)
    setStage('review')
    if (!sample) router.refresh()
  }

  return (
    <div className="flex flex-1 flex-col">
      <ol aria-label="Lock and upload progress" className="pb-10">
        <ProgressionItem
          index={1}
          title="Review and lock"
          state={stateOf('review')}
          receipt={
            <>
              {deferred ? 'Placeholder locked' : 'Locked'}{' '}
              <span className="numeric">{formatUtc(job.lockedAt)}</span>
              <Dot />
              {deferred ? (
                'Real art later, from Art'
              ) : (
                <>
                  Token list hash{' '}
                  <span className="numeric" title={job.tokenListHash}>
                    {shortAddress(job.tokenListHash, 6)}
                  </span>
                </>
              )}
              {!deferred && (
                <>
                  <Dot />
                  {placeholderOn ? 'Reveal later' : 'Reveal at mint'}
                </>
              )}
              {!deferred && lockOptions.allowDuplicates && (
                <>
                  <Dot />
                  Identical tokens allowed
                </>
              )}
            </>
          }
        >
          <ReviewStep
            review={review}
            previews={sample}
            readOnly={readOnly}
            previous={previous}
            deferred={deferred}
            reveal={reveal}
            onReveal={setReveal}
            lockOptions={lockOptions}
            onLockOptions={setLockOptions}
            actions={actions}
            collectionChainId={collectionChainId}
            sample={sample}
            onLocked={settle}
          />
        </ProgressionItem>

        <ProgressionItem
          index={2}
          title={deferred ? 'Placeholder fee' : 'Pay the generation fee'}
          state={stateOf('pay')}
          status={<StatusBadge status="draft">Payment due</StatusBadge>}
          receipt={
            free ? (
              deferred ? (
                'No fee for the placeholder'
              ) : (
                'No fee'
              )
            ) : (
              <>
                Paid <span className="numeric text-foreground/85">{total}</span> on{' '}
                <ChainName chain={chain} iconClassName="size-3.5" />
                {paymentTx && chain.explorerUrl && (
                  <>
                    <Dot />
                    <a
                      href={explorerTxUrl(chain, paymentTx)}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:text-foreground inline-flex items-center gap-1 underline-offset-4 hover:underline"
                    >
                      <span className="numeric">{shortAddress(paymentTx, 6)}</span>
                      <ExternalLinkIcon aria-hidden="true" className="size-3" />
                      <span className="sr-only">View payment on the explorer (new tab)</span>
                    </a>
                  </>
                )}
              </>
            )
          }
        >
          <PayStep
            job={job}
            chain={chain}
            readOnly={readOnly}
            sample={sample}
            outcome={outcome}
            actions={actions}
            onPaid={settle}
            onUnlocked={unlocked}
            onRequoted={setJob}
          />
        </ProgressionItem>

        <ProgressionItem
          index={3}
          title={deferred ? 'Render the placeholder' : 'Render and upload'}
          state={stateOf('render')}
          status={<StatusBadge status="pending">Rendering</StatusBadge>}
          receipt={
            deferred ? (
              'Placeholder pinned to IPFS'
            ) : (
              <>
                <span className="numeric">{job.tokenCount.toLocaleString('en-US')}</span> images and metadata
                pinned to IPFS
                <Dot />
                <span className="numeric">{renderStart.total}</span> batches
                {placeholderOn && (
                  <>
                    <Dot />
                    Placeholder pinned
                  </>
                )}
              </>
            )
          }
        >
          <RenderStep
            tokenCount={job.tokenCount}
            start={renderStart}
            readOnly={readOnly}
            outcome={outcome}
            placeholder={placeholderOn}
            placeholderOnly={deferred}
            onDone={() => setStage('done')}
          />
        </ProgressionItem>

        <ProgressionItem
          index={4}
          title="Ready to deploy"
          state={doneState}
          status={<StatusBadge status="done">Uploaded</StatusBadge>}
          last
        >
          <DoneStep result={result} tokenCount={job.tokenCount} />
        </ProgressionItem>
      </ol>

      <StageFooter previous={previous} next={stage === 'done' ? next : undefined}>
        {stage !== 'done' && (
          <p className="text-muted-foreground text-sm">Deploy opens once the upload finishes.</p>
        )}
      </StageFooter>
    </div>
  )
}
```

`apps/web/src/components/upload/upload-screen.tsx` (whole file):

```tsx
import { satisfiesRules } from '@cobweb/dna'
import { EMPTY_REVIEW, type ReviewData, type ReviewProblem } from '@/lib/art/lock-review'
import type { Tables } from '@/lib/database.types'
import {
  DEMO_COLLECTIONS,
  DEMO_LAYERS,
  DEMO_PLACEHOLDER_DESCRIPTION,
  DEMO_RENDER_JOBS,
  DEMO_RULE_CONFLICTS,
  DEMO_RULES,
  DEMO_TOKEN_COUNT,
  DEMO_TOKENS,
  type GeneratedToken,
  type RenderJob,
} from '@/lib/demo'
import type { FlowLink } from '@/lib/steps'
import { UploadFlow } from './upload-flow'
import { UPLOAD_OUTCOMES, type UploadOutcome } from './upload-sim'

export type UploadScreenProps = {
  collection: Tables<'collections'>
  /** The render job; its state picks the step the screen opens on. */
  job: RenderJob
  /** The job to fall back to after an unlock: nothing locked yet. */
  pending: RenderJob
  /** `reviewArt`'s result. Null for deferred art and in sample mode, which works it out from the sample. */
  review: ReviewData | null
  sample: boolean
  readOnly: boolean
  /** "Finish the art later" (MASTER_PLAN, Flow: pre-reveal): lock and render the placeholder alone. */
  artDeferred?: boolean
  /** The flow screens either side, for the footer the screen renders itself. */
  previous?: FlowLink
  next?: FlowLink
  /**
   * Sample mode only (`?outcome=`): makes the first attempt of an action fail, so failure states
   * can be reviewed. rejected | reverted | balance | check-failed | batch-failed.
   */
  sampleOutcome?: string
}

/**
 * Lock and upload: review and lock the art, pay the generation fee through the factory's
 * `payForArt(jobId)` (simulate first, then send), then follow the render in batches. Server part:
 * in sample mode it works out the sample's review here, so the client bundle does not carry the
 * sample art.
 */
export function UploadScreen({
  collection,
  job,
  pending,
  review,
  sample,
  readOnly,
  artDeferred = false,
  previous,
  next,
  sampleOutcome,
}: UploadScreenProps) {
  const outcome = UPLOAD_OUTCOMES.find((entry) => entry === sampleOutcome) as UploadOutcome | undefined
  const { imagesCid, metadataCid, placeholder } = DEMO_RENDER_JOBS.done

  return (
    <UploadFlow
      collectionId={collection.id}
      collectionChainId={collection.chain_id}
      job={job}
      pending={pending}
      review={sample ? sampleReview(outcome) : (review ?? EMPTY_REVIEW)}
      sample={sample}
      sampleResult={{ imagesCid, metadataCid, placeholder }}
      placeholderDescription={sample ? DEMO_PLACEHOLDER_DESCRIPTION : ''}
      deferred={artDeferred}
      readOnly={readOnly}
      previous={previous}
      next={next}
      outcome={outcome}
    />
  )
}

const fmt = (value: number) => value.toLocaleString('en-US')

/** The sample's review in the shape `reviewArt` returns. */
function sampleReview(outcome: UploadOutcome | undefined): ReviewData {
  const traits = DEMO_LAYERS.flatMap((layer) => layer.traits)
  // Rules named in a conflict are skipped by the generator, so they are not held against the set.
  const conflicted = new Set(DEMO_RULE_CONFLICTS.flatMap((conflict) => conflict.ruleIds.slice(1)))
  const rules = DEMO_RULES.filter((rule) => !conflicted.has(rule.id))
  const breaking = DEMO_TOKENS.filter((token) => !satisfiesRules(new Set(token.dna), rules)).length
  // `?outcome=check-failed` gives the sample two identical tokens to review the duplicates check.
  const duplicates = outcome === 'check-failed' ? [[118, 540]] : findDuplicates(DEMO_TOKENS)
  const problems: ReviewProblem[] = []
  if (DEMO_TOKENS.length !== DEMO_TOKEN_COUNT)
    problems.push({
      code: 'size',
      message: `The set has ${fmt(DEMO_TOKENS.length)} tokens and the supply is ${fmt(DEMO_TOKEN_COUNT)}. Match them in Generate first.`,
    })
  if (breaking > 0)
    problems.push({
      code: 'rule',
      message: `${fmt(breaking)} ${breaking === 1 ? 'token breaks' : 'tokens break'} the rules. Regenerate them in Generate first.`,
    })
  if (duplicates.length > 0)
    problems.push({
      code: 'duplicate',
      message: `${duplicates.map((group) => `Tokens ${group.map((id) => `#${id}`).join(' and ')}`).join(', ')} have the same traits. Change them in Generate, or allow identical tokens.`,
    })
  return {
    problems,
    tokenCount: DEMO_TOKENS.length,
    supply: DEMO_TOKEN_COUNT,
    allowDuplicatesNeeded: problems.length > 0 && problems.every((problem) => problem.code === 'duplicate'),
    counts: {
      collections: DEMO_COLLECTIONS.length,
      layers: DEMO_LAYERS.length,
      traits: traits.filter((trait) => !trait.blank).length,
      rules: DEMO_RULES.length,
    },
    constants: traits.flatMap((trait) =>
      trait.constant ? [{ name: trait.name, count: trait.constant }] : [],
    ),
  }
}

/** Groups of token ids whose collection and traits are identical. */
function findDuplicates(tokens: GeneratedToken[]): number[][] {
  const byTraits = new Map<string, number[]>()
  for (const token of tokens) {
    const key = `${token.collectionId}:${token.dna.join(',')}`
    byTraits.set(key, [...(byTraits.get(key) ?? []), token.id])
  }
  return [...byTraits.values()].filter((ids) => ids.length > 1).map((ids) => ids.sort((a, b) => a - b))
}
```

`apps/web/src/app/collections/[id]/upload/page.tsx` (whole file):

```tsx
import { getRenderJob, reviewArt } from '@/app/actions/lock'
import { StagePage } from '@/components/shell/stage-page'
import { UploadScreen } from '@/components/upload/upload-screen'
import { loadPlaceholder } from '@/lib/art/load'
import type { ReviewData } from '@/lib/art/lock-review'
import { pendingJob } from '@/lib/art/render-job'
import { requireOwnedCollection } from '@/lib/auth'
import type { Tables } from '@/lib/database.types'
import { getRenderJob as sampleRenderJob, type RenderJob, type SampleJobState } from '@/lib/demo'
import { getStage, type FlowLink } from '@/lib/steps'
import {
  LockedStagePage,
  searchParam,
  stageContext,
  type CollectionParams,
  type SearchParams,
} from '../_lib/stage'

const SAMPLE_STATES: SampleJobState[] = ['locked', 'payment_due', 'rendering', 'done']

type View = { job: RenderJob; pending: RenderJob; review: ReviewData | null }

/** Sample mode: `?job=` picks the state; deferred art opens on the review with Reveal later on. */
async function sampleView(searchParams: SearchParams, artDeferred: boolean): Promise<View> {
  const requested = (await searchParam(searchParams, 'job')) as SampleJobState | undefined
  const state: SampleJobState =
    requested && SAMPLE_STATES.includes(requested) ? requested : artDeferred ? 'locked' : 'payment_due'
  return {
    job: sampleRenderJob(state, { artDeferred }),
    pending: sampleRenderJob('locked', { artDeferred }),
    review: null,
  }
}

/** Real mode: the job (or nothing locked yet) and the review of the stored art. */
async function realView(collection: Tables<'collections'>, artDeferred: boolean): Promise<View> {
  const [jobResult, reviewResult, placeholder] = await Promise.all([
    getRenderJob(collection.id),
    artDeferred ? Promise.resolve(null) : reviewArt(collection.id),
    loadPlaceholder(collection.id),
  ])
  if (!jobResult.ok) throw new Error(jobResult.error)
  if (reviewResult && !reviewResult.ok) throw new Error(reviewResult.error)
  const pending = pendingJob(collection.chain_id, placeholder)
  return { job: jobResult.data ?? pending, pending, review: reviewResult ? reviewResult.data : null }
}

/**
 * Stage 3, Lock and upload (docs/specs/2026-10-09-lock-and-pay.md, section 8). Review, lock, pay and
 * unlock are real; rendering is simulated until Phase 4. Sample mode only (`NEXT_PUBLIC_DEMO_DATA=1`):
 * `?job=locked|payment_due|rendering|done` picks the state,
 * `?outcome=rejected|reverted|balance|check-failed|batch-failed` makes the first attempt fail, and
 * `?art=deferred` shows the deferred-art scenario (the placeholder run, MASTER_PLAN, Flow: pre-reveal).
 */
export default async function UploadPage({
  params,
  searchParams,
}: {
  params: CollectionParams
  searchParams: SearchParams
}) {
  const { id } = await params
  const collection = await requireOwnedCollection(id)
  const ctx = stageContext(collection, 'upload', 'upload', { art: await searchParam(searchParams, 'art') })
  if (ctx.access === 'locked') return <LockedStagePage collection={collection} stage="upload" />

  const view = ctx.demo
    ? await sampleView(searchParams, ctx.artDeferred)
    : await realView(collection, ctx.artDeferred)
  // Keep the sample scenario on the flow links while the art is deferred.
  const scenario = (link?: FlowLink) =>
    ctx.demo && ctx.artDeferred && link ? { ...link, href: `${link.href}?art=deferred` } : link

  return (
    <StagePage
      eyebrow={ctx.eyebrow}
      title="Lock and upload"
      description={
        ctx.artDeferred
          ? 'You are finishing the art later. Lock a placeholder now, at no cost, render it to IPFS, and deploy on it.'
          : getStage('upload')!.summary
      }
      bodyHasFooter
    >
      {/* The screen renders the footer: Continue unlocks when the upload finishes in client state. */}
      <UploadScreen
        collection={collection}
        job={view.job}
        pending={view.pending}
        review={view.review}
        sample={ctx.demo}
        readOnly={ctx.readOnly}
        artDeferred={ctx.artDeferred}
        previous={scenario(ctx.previous)}
        next={scenario(ctx.next)}
        sampleOutcome={ctx.demo ? await searchParam(searchParams, 'outcome') : undefined}
      />
    </StagePage>
  )
}
```

- [ ] **Step 10: Root checks, build and commit**

Run:

```bash
pnpm typecheck && pnpm lint && pnpm test
pnpm --filter @cobweb/web build
```

Expected: clean; the build lists `/collections/[id]/upload` as a dynamic route. A sample-mode smoke check (`NEXT_PUBLIC_DEMO_DATA=1`, `pnpm --filter @cobweb/web dev`, open `/collections/<id>/upload?job=payment_due` and pay) still walks simulating, wallet, confirming, verifying and the render; the full walk is Task 8.

```bash
git add apps/web/src/components/upload apps/web/src/components/deploy/tx-progress.tsx apps/web/src/lib/chain apps/web/src/lib/steps.ts apps/web/src/lib/steps.test.ts 'apps/web/src/app/collections/[id]/upload/page.tsx'
git commit -F - <<'MSG'
Run Lock and upload on the real job: review, lock, pay through the wallet, confirm, unlock and the placeholder lock

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bcHX4HZG5YGWhxjGuiWos
MSG
```

---

### Task 7: The sweep of unrecorded uploads

**Files:**

- Create: `apps/web/src/lib/storage/sweep.ts`, `apps/web/scripts/sweep-uploads.ts`, `apps/web/scripts/verify-sweep.ts`
- Test: `apps/web/src/lib/storage/sweep.test.ts`
- Modify: `apps/web/src/lib/storage/objects.ts` (`listObjectPages`), `apps/web/package.json` (scripts `sweep:uploads`, `verify:sweep`)

**Interfaces:**

- Consumes: `storageConfig`, `s3` from `apps/web/src/lib/storage/config.ts`; `deleteObjects`, `headObject`, `presignPut` from `objects.ts`; `storageKey` from `keys.ts`; `record_upload`; the `uploads.storage_key` column.
- Produces:
  - `sweep.ts` (pure): `type StoredObject = { key: string; lastModified: Date }`; `type SweepDeps = { list(prefix: string): AsyncIterable<StoredObject[]>; recorded(keys: string[]): Promise<Set<string>>; remove(keys: string[]): Promise<void> }`; `type SweepReport = { listed: number; old: number; recorded: number; orphaned: string[]; deleted: number }`; `sweepOrphans(deps: SweepDeps, options: { prefix: string; minAgeMs: number; now: number; dryRun: boolean }): Promise<SweepReport>`; `type SweepArgs = { dryRun: boolean; allowRemote: boolean; minAgeHours: number; prefix: string }`; `parseSweepArgs(argv: string[]): SweepArgs`.
  - `objects.ts`: `listObjectPages(prefix: string): AsyncGenerator<StoredObject[]>`.
  - `pnpm --filter @cobweb/web sweep:uploads [--dry-run] [--min-age-hours <n>] [--prefix <p>] [--allow-remote]`; `pnpm --filter @cobweb/web verify:sweep`.

Decision: the sweep takes `--min-age-hours` (default 24) and `--prefix`, because an object cannot be aged in local storage: the check runs the real script with 0 hours on its own scratch collection's prefix, and the unit test proves the 24-hour boundary with fixed dates.

Decision: `verify:sweep` runs the sweep script itself as a child process (a dry run, then a real run), so the check covers the script's own configuration, guard and output, not a copy of its wiring.

- [ ] **Step 1: Write the failing test**

`apps/web/src/lib/storage/sweep.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseSweepArgs, sweepOrphans, type StoredObject, type SweepDeps } from './sweep'

const HOUR = 3_600_000
const NOW = Date.parse('2026-10-09T12:00:00Z')
const object = (key: string, hoursAgo: number): StoredObject => ({
  key,
  lastModified: new Date(NOW - hoursAgo * HOUR),
})

function fake(pages: StoredObject[][], recordedKeys: string[]) {
  const removed: string[][] = []
  const prefixes: string[] = []
  const deps: SweepDeps = {
    list: async function* (prefix) {
      prefixes.push(prefix)
      for (const page of pages) yield page.filter((entry) => entry.key.startsWith(prefix))
    },
    recorded: async (keys) => new Set(keys.filter((key) => recordedKeys.includes(key))),
    remove: async (keys) => {
      removed.push(keys)
    },
  }
  return { deps, removed, prefixes }
}

const pages = [
  [object('c1/assets/a.png', 30), object('c1/assets/b.png', 30), object('c1/assets/c.png', 2)],
  [object('c2/layers/d.png', 48)],
]
const options = { prefix: '', minAgeMs: 24 * HOUR, now: NOW, dryRun: false }

describe('sweepOrphans', () => {
  it('deletes objects older than a day with no row, keeping recorded and recent ones', async () => {
    const { deps, removed } = fake(pages, ['c1/assets/a.png'])
    expect(await sweepOrphans(deps, options)).toEqual({
      listed: 4,
      old: 3,
      recorded: 1,
      orphaned: ['c1/assets/b.png', 'c2/layers/d.png'],
      deleted: 2,
    })
    expect(removed).toEqual([['c1/assets/b.png'], ['c2/layers/d.png']])
  })

  it('lists only in a dry run', async () => {
    const { deps, removed } = fake(pages, ['c1/assets/a.png'])
    const report = await sweepOrphans(deps, { ...options, dryRun: true })
    expect(report.orphaned).toEqual(['c1/assets/b.png', 'c2/layers/d.png'])
    expect(report.deleted).toBe(0)
    expect(removed).toEqual([])
  })

  it('counts an object exactly a day old as old, and passes the prefix to the listing', async () => {
    const { deps, prefixes } = fake([[object('c1/x.png', 24), object('c1/y.png', 23.9)]], [])
    const report = await sweepOrphans(deps, { ...options, prefix: 'c1/' })
    expect(report.orphaned).toEqual(['c1/x.png'])
    expect(prefixes).toEqual(['c1/'])
  })
})

describe('parseSweepArgs', () => {
  it('defaults to a real run, a day, the whole bucket and local only', () => {
    expect(parseSweepArgs([])).toEqual({ dryRun: false, allowRemote: false, minAgeHours: 24, prefix: '' })
  })

  it('reads the options and ignores the separator pnpm may pass on', () => {
    expect(
      parseSweepArgs(['--', '--dry-run', '--min-age-hours', '0', '--prefix', 'c1/', '--allow-remote']),
    ).toEqual({ dryRun: true, allowRemote: true, minAgeHours: 0, prefix: 'c1/' })
  })

  it('refuses a minimum age that is not a number of hours, and unknown options', () => {
    expect(() => parseSweepArgs(['--min-age-hours', 'soon'])).toThrow(
      'The minimum age is a number of hours, 0 or more.',
    )
    expect(() => parseSweepArgs(['--min-age-hours', '-1'])).toThrow(
      'The minimum age is a number of hours, 0 or more.',
    )
    expect(() => parseSweepArgs(['--everything'])).toThrow('Unknown option: --everything')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @cobweb/web exec vitest run src/lib/storage/sweep.test.ts`
Expected: FAIL: `./sweep` does not exist.

- [ ] **Step 3: Implement**

`apps/web/src/lib/storage/sweep.ts`:

```ts
/**
 * The sweep of unrecorded uploads (docs/specs/2026-10-09-lock-and-pay.md, section 9): an object in
 * the art bucket older than the minimum age with no `uploads.storage_key` row was uploaded but never
 * recorded (the browser closed between the PUT and the confirm). The project cap counts rows only,
 * so these would take storage for good. Pure: the script wires S3 and the service role in.
 */
export type StoredObject = { key: string; lastModified: Date }

export type SweepDeps = {
  /** The bucket's objects under a prefix, a page at a time. */
  list(prefix: string): AsyncIterable<StoredObject[]>
  /** Which of these keys have an `uploads` row. */
  recorded(keys: string[]): Promise<Set<string>>
  remove(keys: string[]): Promise<void>
}

export type SweepReport = {
  listed: number
  old: number
  recorded: number
  orphaned: string[]
  deleted: number
}

export async function sweepOrphans(
  deps: SweepDeps,
  options: { prefix: string; minAgeMs: number; now: number; dryRun: boolean },
): Promise<SweepReport> {
  const report: SweepReport = { listed: 0, old: 0, recorded: 0, orphaned: [], deleted: 0 }
  for await (const page of deps.list(options.prefix)) {
    report.listed += page.length
    const old = page.filter((entry) => options.now - entry.lastModified.getTime() >= options.minAgeMs)
    report.old += old.length
    if (old.length === 0) continue
    const known = await deps.recorded(old.map((entry) => entry.key))
    const orphans = old.map((entry) => entry.key).filter((key) => !known.has(key))
    report.recorded += old.length - orphans.length
    report.orphaned.push(...orphans)
    if (!options.dryRun && orphans.length > 0) {
      await deps.remove(orphans)
      report.deleted += orphans.length
    }
  }
  return report
}

export type SweepArgs = { dryRun: boolean; allowRemote: boolean; minAgeHours: number; prefix: string }

/** The sweep script's options. A literal `--` (which pnpm may pass on) is ignored. */
export function parseSweepArgs(argv: string[]): SweepArgs {
  const args: SweepArgs = { dryRun: false, allowRemote: false, minAgeHours: 24, prefix: '' }
  for (let at = 0; at < argv.length; at++) {
    const arg = argv[at]
    if (arg === '--') continue
    else if (arg === '--dry-run') args.dryRun = true
    else if (arg === '--allow-remote') args.allowRemote = true
    else if (arg === '--min-age-hours') {
      const hours = Number(argv[++at])
      if (!Number.isFinite(hours) || hours < 0)
        throw new Error('The minimum age is a number of hours, 0 or more.')
      args.minAgeHours = hours
    } else if (arg === '--prefix') args.prefix = argv[++at] ?? ''
    else throw new Error(`Unknown option: ${arg}`)
  }
  return args
}
```

In `apps/web/src/lib/storage/objects.ts`, replace:

```ts
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3'
```

with:

```ts
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3'
```

and append:

```ts
/** The bucket's objects under a prefix with their last-modified time, a page of up to 1,000 at a time. */
export async function* listObjectPages(
  prefix: string,
): AsyncGenerator<{ key: string; lastModified: Date }[]> {
  const { bucket } = storageConfig()
  let token: string | undefined
  do {
    const page = await s3().send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix || undefined, ContinuationToken: token }),
    )
    yield (page.Contents ?? []).flatMap((entry) =>
      entry.Key && entry.LastModified ? [{ key: entry.Key, lastModified: entry.LastModified }] : [],
    )
    token = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (token)
}
```

`apps/web/scripts/sweep-uploads.ts`:

```ts
// Deletes objects in the art bucket that were uploaded but never recorded: older than a day (by
// default) with no uploads.storage_key row (docs/specs/2026-10-09-lock-and-pay.md, section 9). The
// project's 5 GB cap counts recorded rows only, so these would otherwise take storage for good.
// Uses the service role and the storage credentials. Refuses anything but local endpoints unless
// --allow-remote is passed, so it can be scheduled later with care. Never prints a key.
//
//   pnpm --filter @cobweb/web sweep:uploads --dry-run
//   options: --dry-run, --min-age-hours <n> (default 24), --prefix <key prefix>, --allow-remote
//
// Runs under `node --conditions=react-server` so the `server-only` marker the storage module
// imports resolves to its empty build. Locally, anything unset comes from `supabase status -o env`.

import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { parseSweepArgs, sweepOrphans, type SweepArgs } from '../src/lib/storage/sweep.ts'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

let options: SweepArgs
try {
  options = parseSweepArgs(process.argv.slice(2))
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(2)
}

let statusCache: Record<string, string> | null = null
function supabaseStatus(): Record<string, string> {
  if (statusCache) return statusCache
  statusCache = {}
  try {
    const out = execFileSync('supabase', ['status', '-o', 'env'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    for (const line of out.split('\n')) {
      const [, name, value] = line.match(/^([A-Z0-9_]+)=(.*)$/) ?? []
      if (name && value !== undefined) statusCache[name] = value.replace(/^"(.*)"$/, '$1')
    }
  } catch {
    // No local Supabase: everything must come from the environment.
  }
  return statusCache
}

function config(envName: string, statusNames: string[], fallback?: string): string {
  const fromEnv = process.env[envName]
  if (fromEnv) return fromEnv
  const status = supabaseStatus()
  for (const name of statusNames) if (status[name]) return status[name]
  if (fallback !== undefined) return fallback
  throw new Error(`${envName} is unset and \`supabase status\` did not report ${statusNames.join(' or ')}`)
}

const local = (value: string | undefined) => {
  try {
    return !!value && ['localhost', '127.0.0.1', '[::1]', '::1'].includes(new URL(value).hostname)
  } catch {
    return false
  }
}

if (!options.allowRemote) {
  // The storage module reads ART_S3_* from the environment; fill them from the local status first.
  process.env.ART_S3_ENDPOINT = config('ART_S3_ENDPOINT', ['STORAGE_S3_URL'])
  process.env.ART_S3_REGION = config('ART_S3_REGION', ['S3_PROTOCOL_REGION'], 'local')
  process.env.ART_S3_BUCKET = config('ART_S3_BUCKET', [], 'art')
  process.env.ART_S3_ACCESS_KEY_ID = config('ART_S3_ACCESS_KEY_ID', ['S3_PROTOCOL_ACCESS_KEY_ID'])
  process.env.ART_S3_SECRET_ACCESS_KEY = config('ART_S3_SECRET_ACCESS_KEY', ['S3_PROTOCOL_ACCESS_KEY_SECRET'])
  process.env.ART_S3_FORCE_PATH_STYLE = '1'
}
const url = config('NEXT_PUBLIC_SUPABASE_URL', ['API_URL'])
const serviceKey = config('SUPABASE_SERVICE_ROLE_KEY', ['SERVICE_ROLE_KEY', 'SECRET_KEY'])
if (!options.allowRemote && (!local(url) || !local(process.env.ART_S3_ENDPOINT))) {
  console.error(
    `Refusing to run: ${url} and the storage endpoint must both be local. Pass --allow-remote to sweep a remote project, with care.`,
  )
  process.exit(2)
}

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})
// Imported after the environment is set, so the storage client sees these values.
const { deleteObjects, listObjectPages } = await import('../src/lib/storage/objects.ts')

/** Keys per uploads lookup, so the query string stays short. */
const RECORDED_CHUNK = 100

const report = await sweepOrphans(
  {
    list: listObjectPages,
    recorded: async (keys) => {
      const found = new Set<string>()
      for (let at = 0; at < keys.length; at += RECORDED_CHUNK) {
        const { data, error } = await admin
          .from('uploads')
          .select('storage_key')
          .in('storage_key', keys.slice(at, at + RECORDED_CHUNK))
        if (error) throw new Error(`The uploads could not be read: ${error.message}`)
        for (const row of data as { storage_key: string }[]) found.add(row.storage_key)
      }
      return found
    },
    remove: deleteObjects,
  },
  {
    prefix: options.prefix,
    minAgeMs: options.minAgeHours * 3_600_000,
    now: Date.now(),
    dryRun: options.dryRun,
  },
)

console.log(
  `${report.listed} objects listed, ${report.old} older than ${options.minAgeHours} hours, ${report.recorded} of those recorded.`,
)
for (const key of report.orphaned) console.log(`${options.dryRun ? 'Would delete' : 'Deleted'} ${key}`)
console.log(
  options.dryRun
    ? `${report.orphaned.length} unrecorded objects would be deleted (dry run).`
    : `${report.deleted} unrecorded objects deleted.`,
)
```

`apps/web/scripts/verify-sweep.ts`:

```ts
// Checks the sweep against LOCAL Supabase storage: a recorded object and an unrecorded one under a
// scratch collection; the sweep script, run as a child process on that collection's prefix, lists
// only the unrecorded one in a dry run, keeps it while it is younger than the minimum age, deletes
// it with a minimum age of 0, and never touches the recorded one. Also checks the script refuses a
// remote Supabase. Anything unset is discovered with `supabase status -o env`. Never prints a key.
//
//   pnpm --filter @cobweb/web verify:sweep

import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { createSiweMessage, generateSiweNonce } from 'viem/siwe'
import { storageKey } from '../src/lib/storage/keys.ts'

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(here, '..')
const repoRoot = resolve(here, '../../..')

let statusCache: Record<string, string> | null = null
function supabaseStatus(): Record<string, string> {
  if (statusCache) return statusCache
  const out = execFileSync('supabase', ['status', '-o', 'env'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  statusCache = {}
  for (const line of out.split('\n')) {
    const [, name, value] = line.match(/^([A-Z0-9_]+)=(.*)$/) ?? []
    if (name && value !== undefined) statusCache[name] = value.replace(/^"(.*)"$/, '$1')
  }
  return statusCache
}

function config(envName: string, statusNames: string[], fallback?: string): string {
  const fromEnv = process.env[envName]
  if (fromEnv) return fromEnv
  const status = supabaseStatus()
  for (const name of statusNames) if (status[name]) return status[name]
  if (fallback !== undefined) return fallback
  throw new Error(`${envName} is unset and \`supabase status\` did not report ${statusNames.join(' or ')}`)
}

process.env.ART_S3_ENDPOINT = config('ART_S3_ENDPOINT', ['STORAGE_S3_URL'])
process.env.ART_S3_REGION = config('ART_S3_REGION', ['S3_PROTOCOL_REGION'], 'local')
process.env.ART_S3_BUCKET = config('ART_S3_BUCKET', [], 'art')
process.env.ART_S3_ACCESS_KEY_ID = config('ART_S3_ACCESS_KEY_ID', ['S3_PROTOCOL_ACCESS_KEY_ID'])
process.env.ART_S3_SECRET_ACCESS_KEY = config('ART_S3_SECRET_ACCESS_KEY', ['S3_PROTOCOL_ACCESS_KEY_SECRET'])
process.env.ART_S3_FORCE_PATH_STYLE = '1'
const url = config('NEXT_PUBLIC_SUPABASE_URL', ['API_URL'])
const publishableKey = config('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', ['PUBLISHABLE_KEY', 'ANON_KEY'])
const serviceKey = config('SUPABASE_SERVICE_ROLE_KEY', ['SERVICE_ROLE_KEY', 'SECRET_KEY'])
process.env.NEXT_PUBLIC_SUPABASE_URL = url
process.env.SUPABASE_SERVICE_ROLE_KEY = serviceKey
for (const endpoint of [url, process.env.ART_S3_ENDPOINT])
  if (!['localhost', '127.0.0.1'].includes(new URL(endpoint).hostname)) {
    console.error(`Refusing to run: ${endpoint} is not local.`)
    process.exit(2)
  }

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
const admin = createClient(url, serviceKey, clientOptions)
const { deleteObjects, headObject, presignPut } = await import('../src/lib/storage/objects.ts')

let passed = 0
const failed: string[] = []
async function check(name: string, fn: () => Promise<string | null>) {
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

/** Runs the sweep script as `pnpm sweep:uploads` would, with these options and this environment. */
function sweep(args: string[], env: NodeJS.ProcessEnv = process.env) {
  const run = spawnSync('node', ['--conditions=react-server', 'scripts/sweep-uploads.ts', ...args], {
    cwd: appRoot,
    encoding: 'utf8',
    env,
  })
  return { status: run.status, out: `${run.stdout}${run.stderr}` }
}

// A 1 x 1 transparent PNG, and a second file that differs by one byte.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)
const OTHER = Buffer.concat([PNG, Buffer.from([0])])
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

async function put(key: string, body: Buffer): Promise<void> {
  const res = await fetch(await presignPut(key, 'image/png', body.byteLength), {
    method: 'PUT',
    body,
    headers: { 'Content-Type': 'image/png' },
  })
  if (!res.ok) throw new Error(`PUT ${res.status}`)
}

type Hex = `0x${string}`
const account = privateKeyToAccount(generatePrivateKey())
const creator = createClient(url, publishableKey, clientOptions)
let userId: string | null = null
let collectionId: string | null = null
let recordedKey = ''
let orphanKey = ''

await check('setup: a creator, a collection, a recorded object and an unrecorded one', async () => {
  const message = createSiweMessage({
    address: account.address,
    chainId: 1,
    domain: 'localhost:3000',
    nonce: generateSiweNonce(),
    uri: 'http://localhost:3000',
    version: '1',
    statement: 'Sign in to Cobweb.',
    issuedAt: new Date(),
  })
  const signature: Hex = await account.signMessage({ message })
  const { data, error } = await creator.auth.signInWithWeb3({ chain: 'ethereum', message, signature })
  userId = data?.user?.id ?? null
  if (error || !userId) return `sign-in failed: ${error?.message ?? 'no user'}`
  const col = await creator
    .from('collections')
    .insert({ name: `Sweep ${Date.now()}`, symbol: 'SWP', project_type: 'one_of_one' })
    .select('id')
    .single()
  collectionId = (col.data as { id: string } | null)?.id ?? null
  if (col.error || !collectionId) return `collection: ${col.error?.message ?? 'no row'}`
  recordedKey = storageKey(collectionId, 'asset', sha(PNG), 'image/png')
  orphanKey = storageKey(collectionId, 'asset', sha(OTHER), 'image/png')
  await put(recordedKey, PNG)
  await put(orphanKey, OTHER)
  const recorded = await creator.rpc('record_upload', {
    p_collection_id: collectionId,
    p_kind: 'asset',
    p_storage_key: recordedKey,
    p_content_hash: sha(PNG),
    p_mime: 'image/png',
    p_media_type: 'image',
    p_bytes: PNG.byteLength,
    p_width: 1,
    p_height: 1,
    p_file_name: 'dot.png',
  })
  return recorded.error ? `record_upload: ${recorded.error.message}` : null
})

await check('sweep --dry-run: lists only the unrecorded object and deletes nothing', async () => {
  const { status, out } = sweep(['--dry-run', '--min-age-hours', '0', '--prefix', `${collectionId}/`])
  if (status !== 0) return `exit ${status}: ${out}`
  if (!out.includes(`Would delete ${orphanKey}`) || out.includes(`Would delete ${recordedKey}`)) return out
  return (await headObject(orphanKey)) ? null : 'the dry run deleted the object'
})

await check('sweep: an unrecorded object younger than a day stays', async () => {
  const { status, out } = sweep(['--prefix', `${collectionId}/`])
  if (status !== 0) return `exit ${status}: ${out}`
  if (!out.includes('0 unrecorded objects deleted.')) return out
  return (await headObject(orphanKey)) ? null : 'a recent object was deleted'
})

await check('sweep: past the minimum age the unrecorded object goes and the recorded one stays', async () => {
  const { status, out } = sweep(['--min-age-hours', '0', '--prefix', `${collectionId}/`])
  if (status !== 0) return `exit ${status}: ${out}`
  if (!out.includes(`Deleted ${orphanKey}`) || !out.includes('1 unrecorded objects deleted.')) return out
  if ((await headObject(orphanKey)) !== null) return 'the unrecorded object is still there'
  return (await headObject(recordedKey)) ? null : 'the recorded object was deleted'
})

await check('sweep: refuses a remote Supabase without --allow-remote', async () => {
  const { status, out } = sweep(['--dry-run'], {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  })
  return status === 2 && out.includes('Refusing to run') ? null : `exit ${status}: ${out}`
})

await check('cleanup: the run leaves no object, row or user behind', async () => {
  await deleteObjects([recordedKey, orphanKey].filter(Boolean))
  if (collectionId) {
    const { error } = await admin.from('collections').delete().eq('id', collectionId)
    if (error) return `collection: ${error.message}`
  }
  if (userId) {
    const { error } = await admin.auth.admin.deleteUser(userId)
    if (error) return error.message
  }
  return null
})

console.log(`\n${passed} passed, ${failed.length} failed`)
process.exit(failed.length ? 1 : 0)
```

In `apps/web/package.json`, add to `scripts` after `"verify:chain"` (add a comma to the line before):

```json
    "sweep:uploads": "node --conditions=react-server scripts/sweep-uploads.ts",
    "verify:sweep": "node --conditions=react-server scripts/verify-sweep.ts"
```

- [ ] **Step 4: Run the unit test and the local check**

Run:

```bash
pnpm --filter @cobweb/web exec vitest run src/lib/storage/sweep.test.ts
supabase start && supabase seed buckets
pnpm --filter @cobweb/web verify:sweep
pnpm --filter @cobweb/web sweep:uploads --dry-run
```

Expected: the unit test passes; `verify:sweep` prints 6 `PASS` lines and `6 passed, 0 failed`; the plain dry run prints the counts line and "... unrecorded objects would be deleted (dry run)." without deleting anything.

- [ ] **Step 5: Root checks and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: clean.

```bash
git add apps/web/src/lib/storage apps/web/scripts/sweep-uploads.ts apps/web/scripts/verify-sweep.ts apps/web/package.json
git commit -F - <<'MSG'
Sweep uploaded objects that were never recorded, with a dry run and a local-only guard

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bcHX4HZG5YGWhxjGuiWos
MSG
```

---

### Task 8: Full checks, the browser walk and the documents

**Files:**

- Modify: `docs/MASTER_PLAN.md` (Phase 3 status and done line, Phase 4 status and one bullet), `docs/specs/2026-10-03-creator-flow-ui.md:297-301` (seams), `docs/specs/2026-10-09-lock-and-pay.md` (section 11 ticks), `CLAUDE.md` (layout line, commands)

**Interfaces:**

- Consumes: everything above, running against local Supabase and Anvil.
- Produces: the recorded outcome of the walk and the documents that name Phase 3 complete and Phase 4 next.

- [ ] **Step 1: Full checks**

Run:

```bash
supabase db reset 2>&1 | tail -3
supabase seed buckets
pnpm typecheck && pnpm lint && pnpm test
pnpm --filter @cobweb/web build
cd contracts && forge test && cd ..
pnpm --filter @cobweb/web verify:local 2>&1 | grep -E '^(FAIL|[0-9]+ passed)'
pnpm --filter @cobweb/web verify:storage 2>&1 | tail -1
pnpm --filter @cobweb/web chain:local
pnpm --filter @cobweb/web verify:chain 2>&1 | tail -1
pnpm --filter @cobweb/web verify:sweep 2>&1 | tail -1
```

Expected: root checks and the build clean; `forge test` passes; `verify:local`, `verify:storage`, `verify:chain` and `verify:sweep` each end `0 failed`.

- [ ] **Step 2: Browser walk (run by the controller with the browser, not by the implementer)**

Setup: `supabase start`; `NEXT_PUBLIC_DEMO_DATA` unset in `apps/web/.env.local`; the local `ART_S3_*` values filled in; `node apps/web/scripts/dev-wallet/signer.mjs` running; `pnpm --filter @cobweb/web chain:local` run after the signer (it funds the signer's address) and its two lines in `apps/web/.env.local`; `pnpm --filter @cobweb/web dev` started after that. Load `apps/web/scripts/dev-wallet/inject.js` as an init script, sign in with "Dev Wallet", and switch the network to Anvil in the account menu.

1. Create a generative collection; upload two layers of two square PNGs each, generate 3 tokens, then open Lock and upload (the stepper link is open on a draft). The four checks show as passed; "Allow identical tokens" is not offered; the stats read 3 tokens, 1 collection, 2 layers, 4 traits.
2. Press "Lock art" and confirm. The pay step shows `0.000075 ETH` (3 x 0.000025) on Anvil from the dev wallet's address. Press "Pay": the steps tick through Checking, Confirm in your wallet, Confirming on Anvil and Waiting for confirmation, and the render step starts (simulated). The pay receipt reads "Paid 0.000075 ETH on Anvil". In SQL, `select state, payment_tx_hash, token_list_hash from render_jobs where collection_id = '<id>'` shows `paid`, the hash and the token list hash.
3. Reload the page: it opens on the render step; the Art screens are read only.
4. A second generative collection: generate, lock, then on the pay step choose "Unlock the art" and confirm. The screen returns to the review step; the Art screens are editable again; regenerate one token and lock again: the new quote shows.
5. Before paying the second collection, edit nothing and switch the wallet to Ethereum in the account menu, press "Pay": "Switch to Anvil" appears and no wallet prompt opens. Switch back and pay to finish it.
6. A third collection with "Finish the art later" chosen on Art: open Lock and upload, choose a GIF as the placeholder (it uploads; the request to `/api/uploads/<id>` shows it), press "Lock placeholder" and confirm: no pay step ("No fee for the placeholder"), the render step shows the placeholder phase. In SQL the collection has a `placeholder` job in state `paid` and `art_locked_at` is null.
7. Turn on `NEXT_PUBLIC_DEMO_DATA=1`, restart, and open Lock and upload with `?job=payment_due&outcome=rejected`, `?outcome=reverted`, `?outcome=balance` and `?job=locked&outcome=check-failed`: each shows its failure on the first attempt (the last one as the duplicates check with "Allow identical tokens" offered), and "Try again" succeeds; no request reaches `lockArt` or `confirmArtPayment`.

Record the outcome of each numbered check in the plan ledger. Anything that fails is a finding for a fix dispatch, not a reason to edit these steps.

- [ ] **Step 3: Documentation**

In `docs/MASTER_PLAN.md`, Phase 3, replace the `**Status:**` line (it starts "**Status:** in progress. The DNA engine") with:

```
**Status:** complete. The DNA engine (first sub-project) landed on 7 October 2026; see its spec. The art tables (second sub-project) landed on 8 October 2026; see [specs/2026-10-08-art-tables.md](specs/2026-10-08-art-tables.md). Layer and asset upload (third sub-project) landed on 8 October 2026; see [specs/2026-10-08-art-upload.md](specs/2026-10-08-art-upload.md). Wiring the Art screens to the art tables (fourth sub-project) landed on 8 October 2026; see [specs/2026-10-08-art-wiring.md](specs/2026-10-08-art-wiring.md). Lock and pay (fifth sub-project) landed on <today's date in words>; see [specs/2026-10-09-lock-and-pay.md](specs/2026-10-09-lock-and-pay.md): review, lock, quote from the factory's rate, payment verified from the receipt, unlock while unpaid, the placeholder lock, and the sweep of unrecorded uploads, proven on a local Anvil chain. Next: Phase 4.
```

In the same section, replace the line that starts "**Done when:** a creator can upload layers, generate and curate 10,000 tokens, lock, and pay on testnet" with:

```
**Done when:** a creator can upload layers, generate and curate 10,000 tokens, lock, and pay on testnet, leaving a `paid` job row with a stored assignment. Proven on a local Anvil chain (`verify:chain` and the browser walk); a public testnet needs only `RPC_URL_<id>` and `FACTORY_ADDRESS_<id>` once the factory is deployed there.
```

In Phase 4, replace `**Status:** not started.` with:

```
**Status:** next. It starts from a `paid` (or `waived`) render job: `render_jobs.token_list_hash`, `batch_size` and `batches_total` are set at lock, the generative list is the `tokens` rows and the 1/1 and single asset list is `render_jobs.token_list`. The screen's render and done steps run on `components/upload/render-sim.ts`, the seam this phase replaces.
```

and add this bullet as the first in Phase 4's list:

```
- Before rendering a `paid` job, the worker re-checks the payment on chain as defense in depth: `jobPayment(onchain_job_id, quote_payer) >= quote_total_wei` on the factory. The lock, requote and payment record are already service-role only (Phase 3), so this guards against a server bug, not a creator.
```

In `docs/specs/2026-10-03-creator-flow-ui.md`, replace the paragraph that starts "Seams: every place a real backend plugs in" (lines 297 to 301) with:

```
Seams: every place a real backend plugs in is marked with a `Seam:` or `SEAM:` comment
(`components/upload/render-sim.ts`, `components/deploy/deploy-sim.ts`, `components/manage/simulate.ts`,
`components/mint/mint-transaction.ts`, `app/[slug]/sample-data.ts`). The Art screens read and write the
art tables since the wiring sub-project (specs/2026-10-08-art-wiring.md), and Lock and upload reviews,
locks, quotes, takes the payment and unlocks for real since the lock and pay sub-project
(specs/2026-10-09-lock-and-pay.md); its render and done steps stay simulated until Phase 4. Sample-data
mode still runs all of them on `lib/demo`.
```

In `CLAUDE.md`, replace the layout line:

```
packages/shared    Types, ABIs, chain config
```

with:

```
packages/shared    Chain config, factory ABI (copied from the Foundry build), job ids, viem clients
```

and in the commands block, after the `supabase seed buckets` line, add:

```
pnpm --filter @cobweb/web chain:local     # Anvil on 8545 with the factory deployed; funds the dev wallet; prints the .env.local lines
pnpm --filter @cobweb/web verify:chain    # lock, pay and confirm against Anvil, with the payment refusals
pnpm --filter @cobweb/web sweep:uploads --dry-run   # unrecorded uploads older than a day; local only unless --allow-remote
pnpm --filter @cobweb/web verify:sweep    # the sweep against local storage
pnpm --filter @cobweb/shared abi          # copy the factory ABI from contracts/out after forge build
```

In `docs/specs/2026-10-09-lock-and-pay.md`, section 11: tick each criterion the checks and the walk proved. Leave a box unticked if its check failed and say why in the ledger.

Run `pnpm exec prettier --write --ignore-path /dev/null docs/MASTER_PLAN.md docs/specs/2026-10-03-creator-flow-ui.md docs/specs/2026-10-09-lock-and-pay.md CLAUDE.md`.

- [ ] **Step 4: Commit**

```bash
git add docs CLAUDE.md
git commit -F - <<'MSG'
Record lock and pay as landed, Phase 3 as complete and Phase 4 as next

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bcHX4HZG5YGWhxjGuiWos
MSG
```
