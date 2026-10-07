# DNA engine: specification

Companion plan: [../plans/2026-10-07-dna-engine.md](../plans/2026-10-07-dna-engine.md).
Product decisions: [../MASTER_PLAN.md](../MASTER_PLAN.md#decisions). Parent phase:
[MASTER_PLAN, Phase 3](../MASTER_PLAN.md#phase-3-art-generator). Screens that consume the engine:
[2026-10-03-creator-flow-ui.md](2026-10-03-creator-flow-ui.md) sections 4.3 and 5.

## 1. Goal

One trait engine, `@cobweb/dna`, that the browser runs for free generation and curation and the
server runs at lock to validate and hash the submitted token list. Same input and seed, same
output, in both places.

Phase 3 is built as five sub-projects: this engine, the art tables, layer and asset upload, wiring
the Art screens to real rows, and lock and pay. This specification covers the engine only. It is
first because it is the riskiest logic and depends on nothing else.

## 2. Scope

### In scope

- `packages/dna`: types, seeded randomness, trait index, rules and conflict analyser, generation,
  curation, ranking and tiers, metadata attributes, the lock validator and the token list hash.
- The engine-side competitor features from [PLAN.md](../PLAN.md#art-generator-plan): sum-based
  rarity (Switch), the "appears with at least one" constraint (Add), `bypassDna` per layer (Add),
  per-trait metadata off and a layer display name in the attribute writer (Add).
- Re-pointing the web app at the package: the demo types become re-exports, the Art state modules
  keep their import paths, the existing engine tests move into the package.

### Out of scope (later sub-projects)

- Art tables and row-level security; the uploads table.
- Layer and asset upload, including `Name#weight.png` parsing.
- Wiring the Art screens to real rows; the Rules screen row for the at-least-one constraint; the
  `bypassDna` checkbox; the metadata options in the Layers screen.
- The lock server action, the render job row, the quote and payment. The server action will call
  `validateTokenList` and `hashTokenList`; this spec only defines them.
- Rendering, extra metadata key and values, per-layer opacity, "save token as 1/1" and "create rule
  from token".

### Decisions carried in

- A fixed quantity is a cap, not an exact count (MASTER_PLAN, Art: maximum counts).
- Rules are checked on the finished token, never layer by layer, so there is no layer-order trap.
  The "must pair with" wording stays (decided 7 October 2026); "only mixes with" is not adopted.
- The browser submits the final token list and the server validates and hashes it. The engine is
  not re-run at lock (MASTER_PLAN, Art: assignment integrity).

## 3. The package

### 3.1 Shape

- Name `@cobweb/dna`, private, ESM, TypeScript source exported directly, as `@cobweb/ui` does:
  `"exports": { ".": "./src/index.ts" }`. The web app lists it as `"@cobweb/dna": "workspace:^"`
  and adds it to `transpilePackages` in `next.config.ts`.
- No runtime dependencies. No React, Next, Node or DOM imports. `lib` is `ES2022` only, plus the
  `crypto` global for the hash (Web Crypto exists in Node 20 and later and in every browser).
- Every exported function is pure: it never mutates an argument and returns new arrays and
  objects. Anything random takes a `random: () => number` or a `seed: number` parameter. There is
  no `Math.random()` in the package except inside `newSeed()`.
- Files under roughly 300 lines, one module per concern, each with its own test file. Prettier and
  ESLint as in the rest of the repo.

### 3.2 Modules

| Module     | Exports                                                                                                                                                                                                                                                          |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types`    | `Trait`, `Layer`, `Collection`, `RuleKind`, `ArtRule`, `AtLeastOne`, `Project`, `RuleConflict`, `TokenCore`, `Ranked`, `TraitCounts`                                                                                                                           |
| `random`   | `seededRandom`, `shuffle`, `newSeed`, `collectionSeed`                                                                                                                                                                                                          |
| `index`    | `buildTraitIndex`, `TraitIndex`, `TraitEntry`, `traitName`, `joinOr`, `weightedTraits`, `roundWeight`, `weightTotal`, `weightsValid`, `WEIGHT_TOTAL_MAX`, `constantTotal`, `expectedCount`, `attributeKey`, `attributeKeyOf`, `attributeCounts`, `layersOf` |
| `rules`    | `isBidirectional`, `satisfiesRules`, `brokenRule`, `findDuplicate`, `analyseRules`, `activeRules`, `pruneRules`, `rulesTouching`                                                                                                                                |
| `generate` | `MAX_ATTEMPTS`, `MAX_COLLECTION_SIZE`, `generationProblems`, `generateProject`, `generateCollection`, `repairPairs`, `regenerate`, `fillTo`                                                                                                                      |
| `curate`   | `dnaKey`, `uniqueKey`, `countTraits`, `cappedShortfalls`, `tokensBreakingRules`, `changeTrait`, `swapIds`, `deleteTokens`, `shuffleIds`, `countByCollection`                                                                                                   |
| `rank`     | `rankTokens`, `rarityTier`, `TIER_RANGES`, `RarityTier`                                                                                                                                                                                                         |
| `metadata` | `tokenAttributes`                                                                                                                                                                                                                                               |
| `lock`     | `validateTokenList`, `LockProblem`, `canonicalTokenList`, `hashTokenList`                                                                                                                                                                                       |

`index.ts` re-exports everything.

### 3.3 Types

The types are the ones in `apps/web/src/lib/demo/types.ts` today, moved, with four additions
marked **new**. The web file re-exports them so the screens keep compiling.

```ts
export type Trait = {
  id: string
  layerId: string
  name: string
  weight: number // percent among the layer's weighted traits; 0 for a constant
  constant?: number // a cap: on at most this many tokens
  blank: boolean // the layer is left out of the token; no image
  imageUrl: string | null
  metadata?: false // new: leave this trait out of the token's attributes
}

export type Layer = {
  id: string
  collectionId: string
  name: string
  position: number // 0 is the bottom of the stack
  traits: Trait[]
  displayName?: string // new: the trait_type written to metadata instead of `name`
  bypassDna?: boolean // new: left out of the uniqueness key (HashLips bypassDNA)
}

export type Collection = { id: string; name: string; size: number }

export type RuleKind = "doesn't mix with" | 'always pairs with' | 'must pair with'

export type ArtRule = {
  id: string
  kind: RuleKind
  traitId: string
  relatedTraitIds: string[]
  bidirectional: boolean
}

/** new: every token of the collection carries at least one of these traits. */
export type AtLeastOne = { id: string; collectionId: string; traitIds: string[] }

export type Project = {
  layers: Layer[]
  rules: ArtRule[]
  collections: Collection[]
  atLeastOne?: AtLeastOne[]
}

export type RuleConflict = {
  kind: 'isolated' | 'mixing' | 'circular'
  ruleIds: string[]
  message: string
  skip?: string[]
}

/** What the engine needs of a token. Callers keep their extra fields (name, description). */
export type TokenCore = { id: number; collectionId: string; dna: string[] }

export type Ranked<T extends TokenCore> = T & { rank: number }

export type TraitCounts = Record<string, number>
```

Engine functions are generic over `T extends TokenCore` and return the same `T` with its extra
fields untouched. Naming ("<token name> #<id>") and `previewUrl` stay in the web app, where the
token name lives.

### 3.4 Randomness

- `seededRandom(seed)`: mulberry32, as today. `seed` is a 32-bit unsigned integer.
- `shuffle(items, random)`: Fisher-Yates, returns a new array.
- `newSeed()`: a random 32-bit seed. The only `Math.random()` in the package.
- `collectionSeed(seed, position)`: the seed for the collection at `position`, as today.

### 3.5 Rules

Semantics, unchanged, checked on the finished token:

- doesn't mix with: the source and any related trait never share a token (both ways).
- always pairs with: the source appears if and only if one of the related traits does (both ways).
- must pair with: whenever the source appears, one of the related traits does (one way).
- at least one of (constraint, **new**): every token in the collection carries at least one of
  the listed traits. Fails when none is present. Has no source trait, so it is not an `ArtRule`
  and does not take part in duplicate detection or the conflict analyser.

`satisfiesRules(traitIds, rules, atLeastOne?)` returns true when every rule and constraint holds.
`brokenRule(traitIds, rules, index, atLeastOne?)` returns the first broken one worded for the
creator, or null; the at-least-one wording is "Every token needs one of A, B or C."

`analyseRules`, `activeRules`, `findDuplicate`, `pruneRules` and `rulesTouching` move unchanged
from the web app. The analyser's messages stay creator-facing sentences, built from the index.

### 3.6 Generation

`generateProject(project, seed)` returns

```ts
{
  tokens: TokenCore[] // ids 1 to N across collections, in collection order
  made: { collectionId: string; wanted: number; made: number }[] // one per generated collection
  shortfalls: { trait: Trait; cap: number; actual: number }[] // capped traits below their cap
}
```

Algorithm per collection, as today, with the two changes noted:

1. The active rules are `activeRules(project.rules, analyseRules(...))`, computed inside
   `generateProject`. The current web code reads the sample conflict list instead; that is removed.
2. Capped traits are handed out up front: for each, `constant` token slots are drawn at random,
   never two traits of one layer on one slot.
3. For each slot, up to `MAX_ATTEMPTS` (10,000) rolls: the slot's capped traits where it has them,
   a weighted pick for every other layer (`weight > 0`, not constant; a blank with weight 0 is
   never picked), then `repairPairs`, then the at-least-one repair (pull one listed trait in,
   chosen at random, if none is present and the trait is not capped), then uniqueness and
   `satisfiesRules`. A slot whose capped traits cannot be placed is rolled again without them, so
   the trait ends below its cap.
4. The collection stops at the first slot that fails every roll. `made` records how far it got.
   Nothing is rolled back; the caller decides whether a short set is acceptable (the Generate
   screen refuses it, as today).
5. Uniqueness is within a collection, on `uniqueKey(token, layers)`: the DNA with every
   `bypassDna` layer's entry replaced by `*`. `dnaKey` (the full DNA, used by curation to find an
   identical token) is unchanged.

`generateCollection(layers, rules, atLeastOne, count, seed, firstId)` is the per-collection
function the above calls, exported for tests and for the browser's "regenerate one collection".

`generationProblems(project)` returns the creator-facing problems that stop a generation, as today
(no collections, no size, no layers, no traits, weights not 100, caps above size, too few
combinations). It moves without change beyond the new `Project` argument.

`regenerate(tokens, ids, project, seed)` and `fillTo(tokens, project, seed)` move from the web
app with a seed parameter in place of the internal `newSeed()` call. Both are all or nothing and
return null when a token cannot be made.

### 3.7 Curation

`changeTrait`, `swapIds`, `deleteTokens`, `shuffleIds(tokens, ids, seed)`, `countTraits`,
`cappedShortfalls`, `tokensBreakingRules` and `countByCollection` move from the web app.
`changeTrait` takes the project and the index and returns `{ ok: true, tokens } | { ok: false,
reason }` as today; it checks the cap, the rules (including at-least-one), and uniqueness under
`uniqueKey`. None of them rank or rename; the web app's `finalise` does that after each operation,
as it does now.

### 3.8 Rank and tiers

`rankTokens(tokens, keyOf)` switches to the sum-based score (PLAN.md, competitor table, "Switch"):

- Attributes are counted by `keyOf(traitId)`, the layer and trait name as written to metadata, so
  the same attribute in two collections is one attribute. Blanks count as an attribute. A trait
  with `metadata: false` still counts, since rarity is about the art, not the JSON.
- A token's score is the sum over its DNA of `total / count(attribute)`. No division by layer
  count. This ranks like marketplaces do, and a token with more layers scores higher, as it
  should.
- Rank 1 is the highest score; ties go to the lower id.

`rarityTier(rank, total)` and `TIER_RANGES` move unchanged: top 5%, 15%, 30%, 50%, the rest.

### 3.9 Metadata attributes

`tokenAttributes(token, layers, index, options)` returns `{ trait_type, value }[]`, bottom layer
first, with `options: { showBlankTraits: boolean }`:

- a blank is left out unless `showBlankTraits`, then written with the blank's name;
- a trait with `metadata: false` is left out;
- `trait_type` is the layer's `displayName` when set, else its `name`.

The render pipeline (Phase 4) writes the same list from the same function.

### 3.10 Lock: validation and hash

```ts
export type LockProblem = {
  code:
    | 'ids' // ids are not exactly 1 to N
    | 'size' // a collection has more or fewer tokens than its size
    | 'collection' // a token names a collection the project does not have
    | 'dna-length' // a token's DNA has the wrong number of entries for its collection
    | 'trait' // dna[i] is not a trait of the collection's layer i
    | 'rule' // a token breaks an active rule or an at-least-one constraint
    | 'cap' // a capped trait appears on more tokens than its cap
    | 'duplicate' // two tokens of one collection share a uniqueKey
  message: string // worded for the creator
  tokenIds?: number[] // the tokens involved, when it is about tokens
}

export function validateTokenList(
  project: Project,
  tokens: TokenCore[],
  options: { allowDuplicates: boolean },
): { ok: true } | { ok: false; problems: LockProblem[] }
```

- Runs every check and returns every problem, so the creator sees the whole picture. Problems
  that name tokens list at most 20 ids each; the message says how many more.
- Rules are the active rules after the analyser, as in generation, plus every at-least-one
  constraint. Weights are not checked: they shape generation, not the finished list.
- `allowDuplicates` is the creator's "Allow identical tokens" choice at lock (MASTER_PLAN, Art:
  assignment integrity). With it, the `duplicate` check is skipped and nothing else changes.
- The server action (lock and pay sub-project) calls this on the submitted list and refuses the
  lock on any problem. The Generate screen's footer may call it too, so what the creator sees
  before locking is what the server will say.

```ts
export function canonicalTokenList(tokens: TokenCore[]): string
export function hashTokenList(tokens: TokenCore[]): Promise<`0x${string}`>
```

- The canonical form is the JSON of `[id, collectionId, dna]` triples, tokens sorted by id, no
  whitespace. Names, descriptions and ranks are not part of it, so renaming never changes the
  hash and the render pipeline can be checked against it.
- The hash is SHA-256 of the UTF-8 canonical form through `crypto.subtle.digest`, returned as
  `0x` plus 64 lowercase hex characters. It is what the render job stores and the Lock screen
  shows ("Token list hash").

## 4. Web app migration

- `apps/web/package.json` adds `@cobweb/dna`; `next.config.ts` adds it to `transpilePackages`.
- `apps/web/src/lib/demo/types.ts`: the art types in the "Art (Phase 3)" block become
  `export type { ... } from '@cobweb/dna'`. `GeneratedToken` stays in the web app as
  `Ranked<TokenCore> & { name; description?; previewUrl }`. `UploadedAsset` and `MediaType` stay.
- `apps/web/src/lib/demo/art.ts` keeps the sample layers, rules, conflicts and the SVG preview
  helpers, and imports `seededRandom`, `generateCollection`, `rankTokens`, `countTraits`,
  `cappedShortfalls`, `attributeKey`, `satisfiesRules`, `repairPairs` from the package. Its own
  copies are deleted. The sample conflict list is no longer read by the generator.
- `apps/web/src/components/art/state/generation.ts`, `token-logic.ts`, `rule-logic.ts` and
  `apps/web/src/components/art/lib/trait-index.ts` keep their paths and their export names.
  Each becomes a re-export of the package plus what stays app-side: `tokenNameProblem`,
  `finalise`, `renameTokens`, `setDescription`, `matchesSearch`, `compositeUrls`, `formatPercent`,
  `formatCount`, `RULE_KINDS`, `ruleSentence`. Where a moved function gained a seed parameter
  (`regenerate`, `fillTo`, `shuffleIds`), the app-side wrapper supplies `newSeed()`, so the
  screens do not change.
- `generation.test.ts`, `rule-logic.test.ts` and the pruning tests in `layer-edits.test.ts` move
  into the package against the package fixture. The web keeps `layer-edits.test.ts` for the
  weight and trait editing functions, which stay app-side in `layer-edits.ts`.
- Rank order on the sample set changes with the sum-based score. The sample `rank` values are
  computed, not stored, so nothing in the sample data needs editing; the screenshots in
  `.playwright-mcp/` will show different tier badges and that is expected.

## 5. Testing

Vitest in `packages/dna`, no DOM. A fixture project in `src/fixture.ts` (test-only): two
collections; the first with four layers including a blank-able Accessory layer, a capped trait, a
`bypassDna` Background and one rule of each kind; the second with two layers; one at-least-one
constraint over the Accessory layer's non-blank traits.

| Area     | Tests                                                                                                                                                                                                                                                                                                                                         |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| random   | same seed, same sequence; `shuffle` is a permutation and leaves its input alone                                                                                                                                                                                                                                                               |
| rules    | each kind satisfied and broken; at-least-one; `brokenRule` wording; duplicates both ways; analyser cases from the current web tests; `pruneRules` trim and remove                                                                                                                                                                             |
| generate | determinism (two runs, deep equal); every token unique under `uniqueKey` with a `bypassDna` layer; every token satisfies the active rules; caps never exceeded and a shortfall reported when a rule starves a cap; "made" below "wanted" when combinations run out; ids 1 to N across collections; inputs not mutated (deep-frozen fixture) |
| curate   | `changeTrait` refuses over cap, rule break and duplicate, accepts a valid change; `swapIds`, `deleteTokens` renumbering, `shuffleIds` with a seed is deterministic and a permutation                                                                                                                                                          |
| rank     | a hand-computed four-token set ranks as expected under the sum score; the same attribute in two collections is one count; ties go to the lower id; tier boundaries at 5, 15, 30, 50 percent                                                                                                                                                  |
| metadata | blank out and in, `metadata: false` out, `displayName` used                                                                                                                                                                                                                                                                                   |
| lock     | one failing test per `code`; a valid list returns ok; `allowDuplicates` skips only duplicates; `canonicalTokenList` ignores token order and extra fields; `hashTokenList` is stable and matches a precomputed digest                                                                                                                          |

`pnpm --filter @cobweb/dna test`, `typecheck` and `lint` pass; `pnpm test` at the root passes with
the web suite re-pointed.

## 6. Acceptance criteria

- [ ] `@cobweb/dna` has no runtime dependencies and imports nothing from `react`, `next`, `node:*`
      or the DOM.
- [ ] `generateProject` on the fixture with seed 1 returns the same tokens on two runs, and the
      same when run under Node and in the browser (checked by running the package test in the web
      app's vitest environment once).
- [ ] Every function leaves its arguments unchanged (fixture deep-frozen in tests).
- [ ] The Generate, Rules and Layers screens behave as before on the sample project: same copy,
      same refusals, same conflict messages; only tier badges may move.
- [ ] `validateTokenList` reports each of the eight problem codes on a crafted list and accepts
      the sample set.
- [ ] `hashTokenList` of the sample set is the same value from Node and from the browser.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` pass at the root.
- [ ] Section 5 of the creator flow spec is updated: the Phase 3 row names `@cobweb/dna` for the
      art types and the analyser, and the lock row names `validateTokenList` and `hashTokenList`.
