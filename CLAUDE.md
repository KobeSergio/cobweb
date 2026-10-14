# Cobweb Launchpad

A no-code NFT launchpad with one linear flow: Details, Art (Layers, Rules, Generate), Lock and upload, Deploy, then Manage drop (phases, whitelist, mint page, airdrop, settings as tabs). It is a rebuild of Kingdomly.

## Read first

- `docs/MASTER_PLAN.md`: build order, exit criteria per phase, and the Decisions section. It wins over `docs/PLAN.md` where they differ.
- `docs/PLAN.md`: the source plan (scope, costs, revenue). Kept verbatim; do not edit it.
- `docs/legacy/README.md`: index of the legacy context docs. Open the relevant one before porting anything.
- `docs/reference/the-suits-mint-analysis.md`: the model for mint groups, and the fixes to apply.

## Layout

```
apps/web           Next.js app: creator dashboard, mint page, and the render queue consumer and sweep cron (Vercel)
apps/freshness     Railway service that reads chain state for mint pages
services/render    Render library: layers to images, CARs and CIDs (pure; no network)
services/worker    Render worker: ports, steps, adapters, queue consumer, local runner. Runs inside apps/web on Vercel
contracts/         Foundry: factory and collection
packages/dna       Trait assignment engine
packages/ui        Component library
packages/shared    Chain config, factory ABI and addresses, job ids, the render queue contract (browser entry) and viem clients (server entry)
supabase/          Migrations and policies
legacy/            Old Kingdomly repos. Not in git. Read-only
```

## Commands

```
pnpm install
pnpm typecheck | lint | test | build     # all packages, through Turborepo
pnpm format                               # Prettier
cd contracts && forge test                # contracts
supabase start && pnpm --filter @cobweb/web dev      # web app against local Supabase
pnpm --filter @cobweb/web verify:local    # sign-in and access-rule checks; run after any migration change
pnpm --filter @cobweb/web verify:storage  # presigned PUT, HEAD, signed GET, delete, the 5 GB cap and the canvas, against local storage
supabase seed buckets                     # creates the local `art` and `render` buckets from config.toml (a restart alone does not)
pnpm --filter @cobweb/web chain:local     # Anvil with the factory deployed; prints the .env.local lines
pnpm --filter @cobweb/web verify:chain    # lock, pay and the refusals against Anvil
pnpm --filter @cobweb/web verify:sweep    # the upload sweep against local storage
pnpm --filter @cobweb/web sweep:uploads --dry-run   # unrecorded objects older than a day; drop --dry-run to delete
pnpm --filter @cobweb/render test         # render core: compositing, metadata JSON, CARs and local CIDs
pnpm --filter @cobweb/web verify:render   # the render worker end to end against local Supabase, local storage and Anvil
pnpm --filter @cobweb/worker test         # the render worker: steps, adapters, the queue consumer
pnpm --filter @cobweb/worker bench        # one batch of 100 tokens at 2048 x 2048: time, memory, CAR size
pnpm --filter @cobweb/web verify:deploy   # prepare, deploy through the factory, confirm from the event, the refusals, against local Supabase and Anvil
pnpm --filter @cobweb/web verify:phases   # the chain read, each phase change sent and confirmed from its receipt, the refusals and the copy, against local Supabase and Anvil
pnpm --filter @cobweb/web render:local <collectionId>   # renders the collection's paid jobs on the laptop against local Supabase, local storage and Anvil; CARs go to a temp folder
```

## Rules

1. **Liveness comes from the chain.** A phase is live when the contract's `mintGroupActive` view says so. Never the browser clock, never an event.
2. **Simulate, then send the simulated request.** The wallet opens only after `simulateContract` passes.
3. **Mint pages never call an RPC for shared state.** They poll the freshness server.
4. **Every server action checks the session and ownership.** Every table has row-level security.
5. **Fees are flat native amounts snapshotted at deploy,** read from the factory in the collection constructor. No oracle. Only the factory admin can change a deployed collection's fee, up or down.
6. **Render jobs run only when `paid` or `waived`.**
7. **`legacy/` is reference only.** Never import from it, never commit it, never copy its secrets or its ABIs (`lib/contracts` there is stale).
8. **Contracts keep identical runtime bytecode across deploys.** No per-collection immutables, no hard-coded per-chain addresses.

## Conventions

- Product name is Cobweb. No "Kingdomly" or "realm" wording in user-facing copy; the Kingdomly logo is the only exception.
- Colours come from tokens, never hard-coded hex values.
- All UI is built from shadcn components in `packages/ui`. Legacy hand-rolled components are not copied; a lifted screen keeps the legacy layout and structure, rebuilt on shadcn. Respect what the legacy screen could do, but prefer a better or simpler way where one exists, and note what changed. Never drop a function by accident.
- Layer images are square, at most 2048 x 2048, the same size across a project, 10 MB per file.
- Launch chains: Ethereum, Arbitrum, Base, Berachain, Monad, Robinhood Chain.
- Wallet and chain stack: RainbowKit for wallet connection (as on TheSuits), wagmi hooks in components, viem for every chain call, ABI encoding and address check. No ethers, no web3.js.
- Shared client state uses React Context (plus React Query for server data). No Zustand, Jotai, Redux or similar.
