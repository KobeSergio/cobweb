# Cobweb Launchpad

A no-code NFT launchpad with one linear flow: create a collection, make its art, deploy, set phases and whitelist, run the mint page, manage it. It is a rebuild of Kingdomly.

## Read first

- `docs/MASTER_PLAN.md`: build order, exit criteria per phase, and the Decided table. The Decided table wins over `docs/PLAN.md` where they differ.
- `docs/PLAN.md`: the source plan (scope, costs, revenue). Kept verbatim; do not edit it.
- `docs/legacy/README.md`: index of the legacy context docs. Open the relevant one before porting anything.
- `docs/reference/the-suits-mint-analysis.md`: the model for mint groups, and the fixes to apply.

## Layout

```
apps/web           Next.js app: creator dashboard and mint page
apps/freshness     Railway service that reads chain state for mint pages
services/render    Render and metadata Lambdas
contracts/         Foundry: factory and collection
packages/dna       Trait assignment engine
packages/ui        Component library
packages/shared    Types, ABIs, chain config
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
