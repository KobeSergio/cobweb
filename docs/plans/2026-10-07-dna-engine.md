# DNA Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@cobweb/dna`, a pure, seeded trait engine with a lock validator and token list hash, and re-point the web app at it.

**Architecture:** The generator, rule check, pairing repair, conflict analyser, caps, ranking and curation already exist in `apps/web` (`lib/demo/art.ts`, `components/art/state/*`, `components/art/lib/trait-index.ts`). They move into `packages/dna` as framework-free modules generic over a token core, gaining explicit seeds, the active-rules computation, the at-least-one constraint, `bypassDna` uniqueness, the sum-based rank, and two new modules: `lock` (validate and hash) and `metadata`. The web app keeps its import paths through thin re-export modules that add the app-side wording and naming.

**Tech Stack:** TypeScript 6 (strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`), Vitest 5, pnpm workspace, Next 16 `transpilePackages`, Web Crypto `crypto.subtle` for SHA-256.

**Spec:** [../specs/2026-10-07-dna-engine.md](../specs/2026-10-07-dna-engine.md)

## Global Constraints

- `@cobweb/dna` has no runtime dependencies and imports nothing from `react`, `next`, `node:*` or the DOM; only the `crypto` and `TextEncoder` globals.
- Every exported function is pure: never mutate an argument; return new arrays and objects. The only `Math.random()` is inside `newSeed()`.
- Rule kinds are exactly `"doesn't mix with" | 'always pairs with' | 'must pair with'`; the wording stays.
- A fixed quantity (`constant`) is a cap, never an exact count.
- Uniqueness is within a collection, under `uniqueKey` (layers with `bypassDna` replaced by `*`).
- `MAX_ATTEMPTS` is 10,000 rolls per token; `MAX_COLLECTION_SIZE` is 10,000.
- The sample set's DNA must not change: keep the generator's sequence of `random()` calls identical to the current web code (constants placed first, one weighted pick per unfixed layer, then `repairPairs`). The at-least-one repair and the bypass key call `random()` only when a constraint or a bypass layer exists.
- Prettier: no semicolons, single quotes, 110 columns. Files under roughly 300 lines. No em or en dashes in copy.
- Creator-facing strings keep the current wording where the code moves; new strings follow the same voice (plain sentences, "Whitelist" never "Allowlist").

## Review Focus

Inputs the spec implies but no task's tests exercise. Each is pinned to the task that owns it.

1. A token list where a trait id belongs to the right layer but to another collection's copy of that layer (same layer name, different collection): the validator must report `trait`, not accept it (Task 8, step 1).
2. A `bypassDna` layer on every layer of a collection: `uniqueKey` collapses to all stars, so only one token can ever be unique; `generateProject` must report `made: 1` rather than loop 10,000 times per slot forever (Task 5, step 1).
3. `rankTokens` on tokens of mixed DNA length after a layer is deleted from one collection: no crash, blanks and missing keys count as their own attribute (Task 7, step 1).
4. `changeTrait` to a trait of a `bypassDna` layer that makes two tokens identical except in that layer: must be accepted, since the key ignores that layer (Task 6, step 1).
5. `hashTokenList` of an empty list and of a list whose DNA contains `|`, `,` or quotes: the canonical form is JSON, so no delimiter collision and a stable hash (Task 8, step 5).

---

### Task 1: Package scaffold, types, randomness and the fixture

**Files:**

- Modify: `packages/dna/package.json`
- Modify: `packages/dna/tsconfig.json`
- Create: `packages/dna/src/index.ts` (replace the empty `export {}`)
- Create: `packages/dna/src/types.ts`
- Create: `packages/dna/src/random.ts`
- Create: `packages/dna/src/fixture.ts`
- Test: `packages/dna/src/random.test.ts`, `packages/dna/src/purity.test.ts`

**Interfaces:**

- Produces: every type in `types.ts` below; `seededRandom(seed: number): () => number`, `shuffle<T>(items: readonly T[], random: () => number): T[]`, `newSeed(): number`, `collectionSeed(seed: number, position: number): number`; `fixture(): Project` (deep-frozen, two collections) and `deepFreeze<T>(value: T): T`.

- [ ] **Step 1: Package manifest and tsconfig**

Replace `packages/dna/package.json` with:

```json
{
  "name": "@cobweb/dna",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "test": "vitest run --passWithNoTests"
  }
}
```

`packages/dna/tsconfig.json` stays `{ "extends": "../../tsconfig.base.json", "include": ["src"] }`. The root `@types/node` is picked up automatically, which types the `crypto` and `TextEncoder` globals; the purity test below is what keeps `node:*` imports out.

- [ ] **Step 2: Types**

`packages/dna/src/types.ts`:

```ts
/**
 * The shapes the trait engine works on. The web app re-exports them from `@/lib/demo`, so the
 * creator screens render these same types. Weights are percents; ids are strings unique within a
 * project; token ids are numbers from 1.
 */

/** One trait of a layer. */
export type Trait = {
  /** Unique within the project, e.g. `eyes-starry`. DNA and rules refer to traits by this id. */
  id: string
  layerId: string
  name: string
  /** Chance in percent among the layer's weighted traits. 0 for a constant. Weights sum to 100 per layer. */
  weight: number
  /** A fixed-quantity trait: on at most this many tokens. A cap, not an exact count. */
  constant?: number
  /** The empty trait: the layer is left out of a token. Has no image. */
  blank: boolean
  /** Full-size layer image, or null for a blank. */
  imageUrl: string | null
  /** `false` leaves this trait out of the token's metadata attributes. */
  metadata?: false
}

/** One collection of a project (for example male and female). Each has its own layers and size. */
export type Collection = {
  id: string
  name: string
  /** Tokens to generate for this collection. The supply is the sum of the sizes. */
  size: number
}

/** A layer, bottom first. */
export type Layer = {
  id: string
  collectionId: string
  name: string
  /** 0 is the bottom of the collection's stack. */
  position: number
  traits: Trait[]
  /** The `trait_type` written to metadata instead of `name`. */
  displayName?: string
  /** Left out of the uniqueness key, so two tokens that differ only here count as the same (HashLips bypassDNA). */
  bypassDna?: boolean
}

/** The three rule kinds, worded as the creator sees them. */
export type RuleKind = "doesn't mix with" | 'always pairs with' | 'must pair with'

/**
 * A trait-pairing rule, stored on its source trait.
 *  - doesn't mix with: never in the same token as any related trait (both directions).
 *  - always pairs with: appears only with one of the related traits, and they only with it (both directions).
 *  - must pair with: whenever this trait appears, one of the related traits does too (one direction).
 */
export type ArtRule = {
  id: string
  kind: RuleKind
  traitId: string
  relatedTraitIds: string[]
  bidirectional: boolean
}

/** Every token of the collection carries at least one of these traits. */
export type AtLeastOne = { id: string; collectionId: string; traitIds: string[] }

/** Everything generation and validation need to know about a project's art. */
export type Project = {
  layers: Layer[]
  rules: ArtRule[]
  collections: Collection[]
  atLeastOne?: AtLeastOne[]
}

/** A contradiction between rules that the Rules screen surfaces and generation works around. */
export type RuleConflict = {
  kind: 'isolated' | 'mixing' | 'circular'
  ruleIds: string[]
  message: string
  /** The rules generation skips to get round the conflict. Unset: every rule but the first. */
  skip?: string[]
}

/** What the engine needs of a token. Callers keep their extra fields (name, description). */
export type TokenCore = {
  /** From 1, running on across collections. */
  id: number
  collectionId: string
  /** The chosen trait id for each of its collection's layers, in layer order. */
  dna: string[]
}

export type Ranked<T extends TokenCore> = T & { rank: number }

/** How often each trait occurs in a set, by trait id. */
export type TraitCounts = Record<string, number>

/** A fixed-quantity trait that came out below its cap. */
export type Shortfall = { trait: Trait; cap: number; actual: number }

/** How far a collection's generation got. */
export type Made = { collectionId: string; wanted: number; made: number }
```

- [ ] **Step 3: Failing tests for randomness**

`packages/dna/src/random.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { collectionSeed, seededRandom, shuffle } from './random'

describe('seededRandom', () => {
  it('gives the same sequence for the same seed, in [0, 1)', () => {
    const a = seededRandom(42)
    const b = seededRandom(42)
    const first = Array.from({ length: 5 }, () => a())
    expect(Array.from({ length: 5 }, () => b())).toEqual(first)
    expect(first.every((n) => n >= 0 && n < 1)).toBe(true)
    expect(seededRandom(43)()).not.toBe(first[0])
  })
})

describe('shuffle', () => {
  it('returns a permutation and leaves its input alone', () => {
    const input = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8])
    const out = shuffle(input, seededRandom(7))
    expect([...out].sort((x, y) => x - y)).toEqual([...input])
    expect(out).not.toEqual([...input])
    expect(shuffle(input, seededRandom(7))).toEqual(out)
  })
})

describe('collectionSeed', () => {
  it('is the project seed for the first collection and different for the next', () => {
    expect(collectionSeed(5, 0)).toBe(5)
    expect(collectionSeed(5, 1)).not.toBe(5)
  })
})
```

- [ ] **Step 4: Run, expect failure**

Run: `pnpm --filter @cobweb/dna test`
Expected: FAIL, `Cannot find module './random'`.

- [ ] **Step 5: Implement randomness**

`packages/dna/src/random.ts`:

```ts
/** A small seeded PRNG (mulberry32). Same seed, same sequence, on the server and in the browser. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Fisher-Yates on a copy. */
export function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    const a = out[i]!
    out[i] = out[j]!
    out[j] = a
  }
  return out
}

/** A fresh 32-bit seed. The only `Math.random()` in the package. */
export function newSeed(): number {
  return Math.floor(Math.random() * 0xffffffff)
}

/** The seed for the collection at `position`. The first collection uses the project seed itself. */
export function collectionSeed(seed: number, position: number): number {
  return (seed + position * 0x9e3779b9) >>> 0
}
```

- [ ] **Step 6: The fixture (test-only)**

`packages/dna/src/fixture.ts`:

```ts
import type { Layer, Project, Trait } from './types'

/** Freezes an object graph so a test fails if the engine mutates its input. */
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const key of Object.keys(value as object))
      deepFreeze((value as Record<string, unknown>)[key])
  }
  return value
}

type TraitSpec = Omit<Trait, 'layerId' | 'imageUrl' | 'blank'> & { blank?: boolean }

function layer(
  collectionId: string,
  id: string,
  position: number,
  traits: TraitSpec[],
  extra: Partial<Pick<Layer, 'bypassDna' | 'displayName'>> = {},
): Layer {
  return {
    id,
    collectionId,
    name: id.charAt(0).toUpperCase() + id.slice(1),
    position,
    ...extra,
    traits: traits.map((t) => ({
      ...t,
      layerId: id,
      blank: t.blank ?? false,
      imageUrl: t.blank ? null : `/${id}/${t.id}.png`,
    })),
  }
}

/**
 * Two collections. "owls": four layers, Background bypasses uniqueness, Eyes has a capped trait,
 * Accessory has a blank, and one rule of each kind. "owlets": two plain layers. Sizes 12 and 4.
 * Unique owls under the key (Background ignored): Scarf and Snow go only with each other, so a Snow
 * owl is 3 eyes x Scarf = 3; a Barn or Gray owl is 3 eyes x {None, Hat, Monocle} = 9 minus the
 * Hat-with-Sleepy pair = 8 each. 19 in all, so 12 is reachable and 30 is not.
 */
export function fixture(): Project {
  return deepFreeze({
    collections: [
      { id: 'owls', name: 'Owls', size: 12 },
      { id: 'owlets', name: 'Owlets', size: 4 },
    ],
    layers: [
      layer('owls', 'background', 0, [
        { id: 'bg-ink', name: 'Ink', weight: 50 },
        { id: 'bg-sand', name: 'Sand', weight: 50 },
      ], { bypassDna: true }),
      layer('owls', 'body', 1, [
        { id: 'body-barn', name: 'Barn', weight: 40 },
        { id: 'body-snow', name: 'Snow', weight: 30 },
        { id: 'body-gray', name: 'Gray', weight: 30 },
      ]),
      layer('owls', 'eyes', 2, [
        { id: 'eyes-wide', name: 'Wide', weight: 50 },
        { id: 'eyes-sleepy', name: 'Sleepy', weight: 50 },
        { id: 'eyes-gold', name: 'Gold', weight: 0, constant: 3 },
      ]),
      layer('owls', 'accessory', 3, [
        { id: 'acc-none', name: 'None', weight: 40, blank: true },
        { id: 'acc-hat', name: 'Hat', weight: 20 },
        { id: 'acc-scarf', name: 'Scarf', weight: 20 },
        { id: 'acc-monocle', name: 'Monocle', weight: 20 },
      ]),
      layer('owlets', 'o-body', 0, [
        { id: 'ob-1', name: 'Barn', weight: 50 },
        { id: 'ob-2', name: 'Snow', weight: 50 },
      ]),
      layer('owlets', 'o-eyes', 1, [
        { id: 'oe-1', name: 'Wide', weight: 50 },
        { id: 'oe-2', name: 'Sleepy', weight: 50 },
      ]),
    ],
    rules: [
      { id: 'r-hat-sleepy', kind: "doesn't mix with", traitId: 'acc-hat', relatedTraitIds: ['eyes-sleepy'], bidirectional: true },
      { id: 'r-scarf-snow', kind: 'always pairs with', traitId: 'acc-scarf', relatedTraitIds: ['body-snow'], bidirectional: true },
      { id: 'r-gold-ink', kind: 'must pair with', traitId: 'eyes-gold', relatedTraitIds: ['bg-ink'], bidirectional: false },
    ],
  })
}

/** The fixture with one constraint: every owl wears a hat or a scarf. */
export function fixtureWithAtLeastOne(): Project {
  const base = fixture()
  return deepFreeze({
    ...base,
    atLeastOne: [{ id: 'c-acc', collectionId: 'owls', traitIds: ['acc-hat', 'acc-scarf'] }],
  })
}
```

- [ ] **Step 7: Purity test and the index**

`packages/dna/src/purity.test.ts` (tests may use `node:*`; the engine may not):

```ts
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(import.meta.dirname, '.')
const engineFiles = readdirSync(SRC).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'fixture.ts')

describe('the engine stays framework-free', () => {
  it('imports nothing from react, next, node or the DOM, and rolls no dice of its own', () => {
    for (const file of engineFiles) {
      const text = readFileSync(join(SRC, file), 'utf8')
      expect(text, file).not.toMatch(/from ['"](react|next|node:)/)
      expect(text, file).not.toMatch(/\b(document|window|localStorage)\b/)
      if (file !== 'random.ts') expect(text, file).not.toMatch(/Math\.random/)
    }
  })
})
```

`packages/dna/src/index.ts` for now:

```ts
export * from './types'
export * from './random'
```

- [ ] **Step 8: Run, expect pass; typecheck and lint**

Run: `pnpm --filter @cobweb/dna test && pnpm --filter @cobweb/dna typecheck && pnpm --filter @cobweb/dna lint`
Expected: 2 test files pass; no type or lint errors. If `import.meta.dirname` is not typed, use `fileURLToPath(new URL('.', import.meta.url))` from `node:url` in the test.

- [ ] **Step 9: Commit**

```bash
git add packages/dna
git commit -m "Scaffold the DNA engine package with its types, seeded randomness and fixture"
```

### Task 2: Trait index

**Files:**

- Create: `packages/dna/src/index-of.ts` (named so it does not collide with `index.ts`)
- Modify: `packages/dna/src/index.ts`
- Test: `packages/dna/src/index-of.test.ts`

**Interfaces:**

- Consumes: `Layer`, `Trait` from Task 1.
- Produces: `TraitEntry = { trait: Trait; layer: Layer; layerIndex: number }`, `TraitIndex = Map<string, TraitEntry>`, `buildTraitIndex(layers: Layer[]): TraitIndex`, `layersOf(layers: Layer[], collectionId: string): Layer[]` (filtered, sorted by `position`), `traitName(index, traitId): string`, `joinOr(names: string[]): string`, `weightedTraits(layer): Trait[]`, `roundWeight(value): number`, `WEIGHT_TOTAL_MAX = 100.05`, `weightTotal(layer): number`, `weightsValid(layer): boolean`, `constantTotal(layer): number`, `expectedCount(layer, trait, supply): number`, `attributeKey(layerName, traitName): string`, `attributeKeyOf(index): (traitId: string) => string`, `attributeCounts(tokens: { dna: string[] }[], index): Map<string, number>`.

- [ ] **Step 1: Failing tests**

`packages/dna/src/index-of.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { fixture } from './fixture'
import {
  attributeCounts,
  attributeKey,
  attributeKeyOf,
  buildTraitIndex,
  constantTotal,
  expectedCount,
  joinOr,
  layersOf,
  roundWeight,
  traitName,
  weightedTraits,
  weightsValid,
  weightTotal,
} from './index-of'

const project = fixture()
const index = buildTraitIndex(project.layers)

describe('trait index', () => {
  it('finds a trait with its layer and the layer position within the project list', () => {
    const entry = index.get('eyes-gold')!
    expect(entry.layer.id).toBe('eyes')
    expect(entry.trait.constant).toBe(3)
    expect(entry.layerIndex).toBe(2)
    expect(traitName(index, 'eyes-gold')).toBe('Gold')
    expect(traitName(index, 'gone')).toBe('Removed trait')
  })

  it('lists one collection\'s layers bottom first', () => {
    const shuffled = [...project.layers].reverse()
    expect(layersOf(shuffled, 'owls').map((l) => l.id)).toEqual(['background', 'body', 'eyes', 'accessory'])
  })

  it('joins names as "A, B or C"', () => {
    expect(joinOr([])).toBe('')
    expect(joinOr(['A'])).toBe('A')
    expect(joinOr(['A', 'B', 'C'])).toBe('A, B or C')
  })
})

describe('weights', () => {
  const eyes = project.layers[2]!
  it('picks by weight only among non-constant traits with a share', () => {
    expect(weightedTraits(eyes).map((t) => t.id)).toEqual(['eyes-wide', 'eyes-sleepy'])
  })
  it('stores two decimals clamped to 0 to 100, and accepts totals from 100 to 100.05', () => {
    expect(roundWeight(33.33333)).toBe(33.33)
    expect(roundWeight(140)).toBe(100)
    expect(roundWeight(Number.NaN)).toBe(0)
    expect(weightTotal(eyes)).toBe(100)
    expect(weightsValid(eyes)).toBe(true)
    expect(weightsValid({ ...eyes, traits: eyes.traits.map((t) => ({ ...t, weight: t.weight ? 50.06 : 0 })) })).toBe(false)
  })
  it('counts constants and expected counts for a supply', () => {
    expect(constantTotal(eyes)).toBe(3)
    expect(expectedCount(eyes, eyes.traits[2]!, 100)).toBe(3)
    expect(expectedCount(eyes, eyes.traits[0]!, 103)).toBe(50)
  })
})

describe('attributes', () => {
  it('keys an attribute by layer and trait name, the same in two collections', () => {
    const keyOf = attributeKeyOf(index)
    expect(keyOf('body-barn')).toBe(attributeKey('Body', 'Barn'))
    expect(keyOf('ob-1')).toBe(attributeKey('O-body', 'Barn'))
    expect(keyOf('unknown')).toBe('unknown')
    const counts = attributeCounts([{ dna: ['body-barn'] }, { dna: ['body-barn', 'eyes-wide'] }], index)
    expect(counts.get(attributeKey('Body', 'Barn'))).toBe(2)
  })
})
```

- [ ] **Step 2: Run, expect failure**

Run: `pnpm --filter @cobweb/dna test`
Expected: FAIL, `Cannot find module './index-of'`.

- [ ] **Step 3: Implement**

`packages/dna/src/index-of.ts` (the body of `apps/web/src/components/art/lib/trait-index.ts` without `compositeUrls`, `formatPercent`, `formatCount`, plus `attributeKey` and `layersOf`):

```ts
import type { Layer, Trait } from './types'

/** Lookups over a project's layers: trait by id with its layer and that layer's index in the list. */
export type TraitEntry = { trait: Trait; layer: Layer; layerIndex: number }
export type TraitIndex = Map<string, TraitEntry>

export function buildTraitIndex(layers: Layer[]): TraitIndex {
  const index: TraitIndex = new Map()
  layers.forEach((layer, layerIndex) => {
    for (const trait of layer.traits) index.set(trait.id, { trait, layer, layerIndex })
  })
  return index
}

/** One collection's layers, bottom first. */
export function layersOf(layers: Layer[], collectionId: string): Layer[] {
  return layers.filter((layer) => layer.collectionId === collectionId).sort((a, b) => a.position - b.position)
}

export function traitName(index: TraitIndex, traitId: string): string {
  return index.get(traitId)?.trait.name ?? 'Removed trait'
}

/** Joins names as "A, B or C". */
export function joinOr(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`
}

/** Traits that can be picked by weight: not constant and with a share above zero. */
export function weightedTraits(layer: Layer): Trait[] {
  return layer.traits.filter((trait) => !trait.constant && trait.weight > 0)
}

/** A weight as stored: a percent from 0 to 100 with at most two decimals. */
export function roundWeight(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(Math.min(100, Math.max(0, value)) * 100) / 100
}

/** The highest total accepted as 100%: shares typed to two decimals (three at 33.34%) pass. */
export const WEIGHT_TOTAL_MAX = 100.05

/** The sum of the weights of the layer's non-constant traits, rounded to two places. */
export function weightTotal(layer: Layer): number {
  const sum = layer.traits.reduce((total, trait) => total + (trait.constant ? 0 : trait.weight), 0)
  return Math.round(sum * 100) / 100
}

/** Whether a layer's weights add up: from 100.00 to 100.05, or every trait has a maximum count. */
export function weightsValid(layer: Layer): boolean {
  const hasWeighted = layer.traits.some((trait) => !trait.constant)
  const total = weightTotal(layer)
  return !hasWeighted || (total >= 100 && total <= WEIGHT_TOTAL_MAX)
}

export function constantTotal(layer: Layer): number {
  return layer.traits.reduce((total, trait) => total + (trait.constant ?? 0), 0)
}

/** Tokens expected to carry a trait for a given supply. */
export function expectedCount(layer: Layer, trait: Trait, supply: number): number {
  if (trait.constant) return trait.constant
  const total = weightTotal(layer)
  if (total <= 0) return 0
  return ((supply - constantTotal(layer)) * trait.weight) / 100
}

/**
 * The key a trait is counted under for rarity: its layer name and its own name, as they appear in
 * the metadata (`trait_type`, `value`). The same pair in two collections is one attribute.
 */
export function attributeKey(layerName: string, traitName: string): string {
  return JSON.stringify([layerName, traitName])
}

/** `attributeKey` for the traits of these layers; an unknown id counts as an attribute of its own. */
export function attributeKeyOf(index: TraitIndex): (traitId: string) => string {
  return (traitId) => {
    const entry = index.get(traitId)
    return entry ? attributeKey(entry.layer.name, entry.trait.name) : traitId
  }
}

/** How many tokens carry each attribute (layer and trait name), every collection together. */
export function attributeCounts(tokens: { dna: string[] }[], index: TraitIndex): Map<string, number> {
  const keyOf = attributeKeyOf(index)
  const counts = new Map<string, number>()
  for (const token of tokens)
    for (const traitId of token.dna) counts.set(keyOf(traitId), (counts.get(keyOf(traitId)) ?? 0) + 1)
  return counts
}
```

Add `export * from './index-of'` to `packages/dna/src/index.ts`.

- [ ] **Step 4: Run, expect pass**

Run: `pnpm --filter @cobweb/dna test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/dna
git commit -m "Add the trait index to the DNA engine"
```

### Task 3: Rules, duplicates and the conflict analyser

**Files:**

- Create: `packages/dna/src/rules.ts`
- Modify: `packages/dna/src/index.ts`
- Test: `packages/dna/src/rules.test.ts`

**Interfaces:**

- Consumes: `TraitIndex`, `traitName`, `joinOr` from Task 2; types from Task 1.
- Produces: `isBidirectional(kind): boolean`, `constraintsOf(atLeastOne: AtLeastOne[] | undefined, collectionId): AtLeastOne[]`, `satisfiesRules(traitIds: ReadonlySet<string>, rules: ArtRule[], atLeastOne?: AtLeastOne[]): boolean`, `brokenRule(traitIds: string[], rules, index, atLeastOne?): string | null`, `findDuplicate(candidate: Omit<ArtRule, 'id'>, rules, ignoreId?): ArtRule | undefined`, `analyseRules(layers, rules, index): RuleConflict[]`, `activeRules(rules, conflicts): ArtRule[]`, `activeProjectRules(project: Pick<Project, 'layers' | 'rules'>, index?: TraitIndex): ArtRule[]`, `pruneRules(rules, keptTraitIds: ReadonlySet<string>): ArtRule[]`, `rulesTouching(rules, traitIds: ReadonlySet<string>): number`.

- [ ] **Step 1: Failing tests**

`packages/dna/src/rules.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { fixture, fixtureWithAtLeastOne } from './fixture'
import { buildTraitIndex, layersOf } from './index-of'
import {
  activeProjectRules,
  activeRules,
  analyseRules,
  brokenRule,
  constraintsOf,
  findDuplicate,
  pruneRules,
  rulesTouching,
  satisfiesRules,
} from './rules'
import type { ArtRule } from './types'

const project = fixture()
const index = buildTraitIndex(project.layers)
const owls = layersOf(project.layers, 'owls')
const rule = (id: string, kind: ArtRule['kind'], traitId: string, related: string[]): ArtRule => ({
  id,
  kind,
  traitId,
  relatedTraitIds: related,
  bidirectional: kind !== 'must pair with',
})

describe('satisfiesRules', () => {
  it('checks each kind on the finished token', () => {
    const r = project.rules
    expect(satisfiesRules(new Set(['bg-ink', 'body-barn', 'eyes-wide', 'acc-hat']), r)).toBe(true)
    expect(satisfiesRules(new Set(['bg-ink', 'body-barn', 'eyes-sleepy', 'acc-hat']), r)).toBe(false) // doesn't mix
    expect(satisfiesRules(new Set(['bg-ink', 'body-barn', 'eyes-wide', 'acc-scarf']), r)).toBe(false) // scarf without snow
    expect(satisfiesRules(new Set(['bg-ink', 'body-snow', 'eyes-wide', 'acc-none']), r)).toBe(false) // snow without scarf
    expect(satisfiesRules(new Set(['bg-sand', 'body-barn', 'eyes-gold', 'acc-none']), r)).toBe(false) // gold without ink
    expect(satisfiesRules(new Set(['bg-ink', 'body-barn', 'eyes-gold', 'acc-none']), r)).toBe(true)
  })

  it('applies an at-least-one constraint', () => {
    const constraints = constraintsOf(fixtureWithAtLeastOne().atLeastOne, 'owls')
    expect(constraintsOf(fixtureWithAtLeastOne().atLeastOne, 'owlets')).toEqual([])
    expect(satisfiesRules(new Set(['bg-ink', 'body-barn', 'eyes-wide', 'acc-none']), [], constraints)).toBe(false)
    expect(satisfiesRules(new Set(['bg-ink', 'body-barn', 'eyes-wide', 'acc-hat']), [], constraints)).toBe(true)
  })
})

describe('brokenRule', () => {
  it('words the first broken rule for the creator', () => {
    expect(brokenRule(['body-barn', 'eyes-sleepy', 'acc-hat'], project.rules, index)).toBe("Hat doesn't mix with Sleepy.")
    expect(brokenRule(['body-barn', 'eyes-wide', 'acc-scarf'], project.rules, index)).toBe('Scarf always pairs with Snow.')
    expect(brokenRule(['body-snow', 'eyes-wide', 'acc-none'], project.rules, index)).toBe('Snow only appears with Scarf.')
    expect(brokenRule(['bg-sand', 'eyes-gold'], project.rules, index)).toBe('Gold must pair with Ink.')
    expect(brokenRule(['bg-ink', 'body-barn', 'eyes-wide', 'acc-hat'], project.rules, index)).toBeNull()
    const constraints = constraintsOf(fixtureWithAtLeastOne().atLeastOne, 'owls')
    expect(brokenRule(['acc-none'], [], index, constraints)).toBe('Every token needs one of Hat or Scarf.')
  })
})

describe('duplicate rules', () => {
  it('catches the same two-way rule written from the other side, not a reversed one-way rule', () => {
    const existing = [rule('a', "doesn't mix with", 'body-barn', ['bg-ink'])]
    expect(findDuplicate(rule('b', "doesn't mix with", 'bg-ink', ['body-barn']), existing)?.id).toBe('a')
    expect(findDuplicate(rule('b', "doesn't mix with", 'body-barn', ['bg-ink', 'bg-sand']), existing, 'a')).toBeUndefined()
    const oneWay = [rule('m', 'must pair with', 'body-barn', ['bg-ink'])]
    expect(findDuplicate(rule('n', 'must pair with', 'bg-ink', ['body-barn']), oneWay)).toBeUndefined()
  })
})

describe('conflict analyser', () => {
  it('finds no conflict in the fixture', () => {
    expect(analyseRules(owls, project.rules, index)).toEqual([])
  })

  it('reports a pairing rule whose partners are all kept apart, once, and skips the blocker', () => {
    const rules = [
      rule('pair', 'always pairs with', 'acc-hat', ['eyes-sleepy']),
      rule('block', "doesn't mix with", 'eyes-sleepy', ['acc-hat']),
    ]
    const conflicts = analyseRules(owls, rules, index)
    expect(conflicts.map((c) => c.kind)).toEqual(['mixing'])
    expect(conflicts[0]!.ruleIds).toEqual(['pair', 'block'])
    expect(activeRules(rules, conflicts).map((r) => r.id)).toEqual(['pair'])
  })

  it('follows a chain of pairing rules and skips only the rule that keeps the ends apart', () => {
    const rules = [
      rule('a', 'must pair with', 'acc-hat', ['eyes-wide']),
      rule('b', 'always pairs with', 'eyes-wide', ['bg-ink']),
      rule('c', "doesn't mix with", 'acc-hat', ['bg-ink']),
    ]
    const conflicts = analyseRules(owls, rules, index)
    const chain = conflicts.find((c) => c.kind === 'mixing')
    expect([...chain!.ruleIds].sort()).toEqual(['a', 'b', 'c'])
    expect(activeRules(rules, conflicts).map((r) => r.id)).toEqual(['a', 'b'])
  })

  it('finds a trait forced into two traits of one layer through a chain', () => {
    const rules = [
      rule('a', 'must pair with', 'acc-hat', ['eyes-wide']),
      rule('b', 'must pair with', 'eyes-wide', ['body-barn']),
      rule('c', 'must pair with', 'acc-hat', ['body-snow']),
    ]
    const conflicts = analyseRules(owls, rules, index)
    expect(conflicts.some((c) => c.kind === 'circular' && c.ruleIds.includes('b'))).toBe(true)
  })

  it('reports a trait that does not mix with any usable trait of a layer', () => {
    const bodies = ['body-barn', 'body-snow', 'body-gray']
    const conflicts = analyseRules(owls, [rule('x', "doesn't mix with", 'acc-hat', bodies)], index)
    expect(conflicts.map((c) => c.kind)).toEqual(['isolated'])
  })

  it('gives the active rules of a project in one call', () => {
    expect(activeProjectRules(project)).toEqual(project.rules)
    const conflicted = { ...project, rules: [...project.rules, rule('block', "doesn't mix with", 'body-snow', ['acc-scarf'])] }
    expect(activeProjectRules(conflicted).map((r) => r.id)).toEqual(project.rules.map((r) => r.id))
  })
})

describe('pruneRules', () => {
  it('drops a deleted trait from rules and removes rules left with nothing to pair', () => {
    const kept = new Set(project.layers.flatMap((l) => l.traits.map((t) => t.id)))
    kept.delete('eyes-sleepy')
    const pruned = pruneRules(project.rules, kept)
    expect(pruned.map((r) => r.id)).toEqual(['r-scarf-snow', 'r-gold-ink'])
    expect(rulesTouching(project.rules, new Set(['eyes-sleepy']))).toBe(1)
    const trimmed = pruneRules([rule('t', "doesn't mix with", 'acc-hat', ['eyes-sleepy', 'eyes-wide'])], kept)
    expect(trimmed[0]!.relatedTraitIds).toEqual(['eyes-wide'])
    expect(pruneRules(project.rules, new Set(kept).add('eyes-sleepy'))).toBe(project.rules)
  })
})
```

- [ ] **Step 2: Run, expect failure**

Run: `pnpm --filter @cobweb/dna test`
Expected: FAIL, `Cannot find module './rules'`.

- [ ] **Step 3: Implement**

`packages/dna/src/rules.ts`. The analyser body (`analyseRules`, `chainConflicts`, `mixBlocker`, `conflictKey`) is copied verbatim from `apps/web/src/components/art/state/rule-logic.ts` with imports changed to `./index-of` and `./types`; `pruneRules` and `rulesTouching` are copied from `apps/web/src/components/art/state/layer-edits.ts`. The new parts are shown in full:

```ts
import { joinOr, traitName, type TraitIndex } from './index-of'
import type { ArtRule, AtLeastOne, Layer, Project, RuleConflict, RuleKind } from './types'

export function isBidirectional(kind: RuleKind): boolean {
  return kind !== 'must pair with'
}

/** The at-least-one constraints that apply to one collection's tokens. */
export function constraintsOf(atLeastOne: AtLeastOne[] | undefined, collectionId: string): AtLeastOne[] {
  return (atLeastOne ?? []).filter((constraint) => constraint.collectionId === collectionId)
}

/** Whether a set of trait ids satisfies the rules and the collection's constraints. */
export function satisfiesRules(
  traitIds: ReadonlySet<string>,
  rules: ArtRule[],
  atLeastOne: AtLeastOne[] = [],
): boolean {
  for (const rule of rules) {
    const hasTrait = traitIds.has(rule.traitId)
    const hasRelated = rule.relatedTraitIds.some((id) => traitIds.has(id))
    if (rule.kind === "doesn't mix with" && hasTrait && hasRelated) return false
    if (rule.kind === 'must pair with' && hasTrait && !hasRelated) return false
    if (rule.kind === 'always pairs with' && hasTrait !== hasRelated) return false
  }
  for (const constraint of atLeastOne)
    if (!constraint.traitIds.some((id) => traitIds.has(id))) return false
  return true
}

/** The first rule a set of traits breaks, worded for the creator, or null when it breaks none. */
export function brokenRule(
  traitIds: string[],
  rules: ArtRule[],
  index: TraitIndex,
  atLeastOne: AtLeastOne[] = [],
): string | null {
  const has = new Set(traitIds)
  for (const rule of rules) {
    const hasTrait = has.has(rule.traitId)
    const present = rule.relatedTraitIds.filter((id) => has.has(id))
    const source = traitName(index, rule.traitId)
    const related = joinOr(rule.relatedTraitIds.map((id) => traitName(index, id)))
    if (rule.kind === "doesn't mix with" && hasTrait && present.length > 0)
      return `${source} doesn't mix with ${traitName(index, present[0]!)}.`
    if (rule.kind === 'must pair with' && hasTrait && present.length === 0)
      return `${source} must pair with ${related}.`
    if (rule.kind === 'always pairs with' && hasTrait && present.length === 0)
      return `${source} always pairs with ${related}.`
    if (rule.kind === 'always pairs with' && !hasTrait && present.length > 0)
      return `${traitName(index, present[0]!)} only appears with ${source}.`
  }
  for (const constraint of atLeastOne)
    if (!constraint.traitIds.some((id) => has.has(id)))
      return `Every token needs one of ${joinOr(constraint.traitIds.map((id) => traitName(index, id)))}.`
  return null
}

function overlaps(a: string[], b: string[]): boolean {
  return a.some((id) => b.includes(id))
}

/** An existing rule that says the same thing (same kind and source with overlapping related traits, or the two-way pairing written from the other side). */
export function findDuplicate(candidate: Omit<ArtRule, 'id'>, rules: ArtRule[], ignoreId?: string) {
  return rules.find((rule) => {
    if (rule.id === ignoreId || rule.kind !== candidate.kind) return false
    if (rule.traitId === candidate.traitId && overlaps(rule.relatedTraitIds, candidate.relatedTraitIds))
      return true
    return (
      isBidirectional(candidate.kind) &&
      candidate.relatedTraitIds.includes(rule.traitId) &&
      rule.relatedTraitIds.includes(candidate.traitId)
    )
  })
}

// mixBlocker, analyseRules, conflictKey, chainConflicts: copied verbatim from rule-logic.ts.

/** The rules generation applies: for each conflict, the rules it names to skip, or every rule but the first. */
export function activeRules(rules: ArtRule[], conflicts: RuleConflict[]): ArtRule[] {
  const skipped = new Set(conflicts.flatMap((conflict) => conflict.skip ?? conflict.ruleIds.slice(1)))
  return rules.filter((rule) => !skipped.has(rule.id))
}

/** The rules a project generates and validates with: every rule not skipped because of a conflict. */
export function activeProjectRules(project: Pick<Project, 'layers' | 'rules'>, index?: TraitIndex): ArtRule[] {
  const idx = index ?? buildTraitIndex(project.layers)
  return activeRules(project.rules, analyseRules(project.layers, project.rules, idx))
}

// pruneRules, rulesTouching: copied verbatim from layer-edits.ts.
```

Import `buildTraitIndex` from `./index-of` for `activeProjectRules`. Add `export * from './rules'` to `index.ts`. If `rules.ts` passes 300 lines, move `analyseRules` and `chainConflicts` to `analyse.ts` and re-export them from `rules.ts`.

- [ ] **Step 4: Run, expect pass**

Run: `pnpm --filter @cobweb/dna test`
Expected: PASS. If the chain test's `ruleIds` order differs, compare sorted, as the test does.

- [ ] **Step 5: Commit**

```bash
git add packages/dna
git commit -m "Add rules, duplicates and the conflict analyser to the DNA engine"
```

### Task 4: Keys and counts

**Files:**

- Create: `packages/dna/src/curate.ts` (the editing operations join it in Task 6)
- Modify: `packages/dna/src/index.ts`
- Test: `packages/dna/src/curate.test.ts`

**Interfaces:**

- Consumes: `Layer`, `TokenCore`, `TraitCounts`, `Shortfall`, `ArtRule`, `AtLeastOne` from Task 1; `satisfiesRules` from Task 3.
- Produces: `dnaKey(token: Pick<TokenCore, 'collectionId' | 'dna'>): string` (`"<collection>:<dna joined by |>"`), `uniqueKey(dna: readonly string[], layers: Layer[]): string` (DNA with each `bypassDna` layer's entry replaced by `*`, joined by `|`), `countTraits(tokens: Pick<TokenCore, 'dna'>[]): TraitCounts`, `cappedShortfalls(layers, counts): Shortfall[]`, `tokensBreakingRules(tokens: TokenCore[], rules, atLeastOne?: AtLeastOne[]): number[]`, `countByCollection(tokens): Map<string, number>`.

- [ ] **Step 1: Failing tests**

`packages/dna/src/curate.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { cappedShortfalls, countByCollection, countTraits, dnaKey, tokensBreakingRules, uniqueKey } from './curate'
import { fixture } from './fixture'
import { layersOf } from './index-of'

const project = fixture()
const owls = layersOf(project.layers, 'owls')

describe('keys', () => {
  it('ignores bypassed layers in the uniqueness key but not in the DNA key', () => {
    const a = { id: 1, collectionId: 'owls', dna: ['bg-ink', 'body-barn', 'eyes-wide', 'acc-none'] }
    const b = { id: 2, collectionId: 'owls', dna: ['bg-sand', 'body-barn', 'eyes-wide', 'acc-none'] }
    expect(uniqueKey(a.dna, owls)).toBe('*|body-barn|eyes-wide|acc-none')
    expect(uniqueKey(a.dna, owls)).toBe(uniqueKey(b.dna, owls))
    expect(dnaKey(a)).toBe('owls:bg-ink|body-barn|eyes-wide|acc-none')
    expect(dnaKey(a)).not.toBe(dnaKey(b))
  })
})

describe('counts', () => {
  const tokens = [
    { id: 1, collectionId: 'owls', dna: ['bg-ink', 'body-barn', 'eyes-gold', 'acc-none'] },
    { id: 2, collectionId: 'owls', dna: ['bg-sand', 'body-barn', 'eyes-wide', 'acc-hat'] },
    { id: 3, collectionId: 'owlets', dna: ['ob-1', 'oe-1'] },
  ]
  it('counts traits, tokens per collection and capped traits below their cap', () => {
    expect(countTraits(tokens)).toMatchObject({ 'body-barn': 2, 'eyes-gold': 1, 'ob-1': 1 })
    expect([...countByCollection(tokens)]).toEqual([['owls', 2], ['owlets', 1]])
    expect(cappedShortfalls(project.layers, countTraits(tokens))).toEqual([
      { trait: project.layers[2]!.traits[2], cap: 3, actual: 1 },
    ])
  })
  it('lists the tokens that break a rule', () => {
    const bad = { id: 4, collectionId: 'owls', dna: ['bg-sand', 'body-barn', 'eyes-sleepy', 'acc-hat'] }
    expect(tokensBreakingRules([...tokens, bad], project.rules)).toEqual([4])
  })
})
```

- [ ] **Step 2: Run, expect failure**

Run: `pnpm --filter @cobweb/dna test`
Expected: FAIL, `Cannot find module './curate'`.

- [ ] **Step 3: Implement**

`packages/dna/src/curate.ts`:

```ts
import { satisfiesRules } from './rules'
import type { ArtRule, AtLeastOne, Layer, Shortfall, TokenCore, TraitCounts } from './types'

/** The full DNA within its collection: finds a token with exactly these traits. */
export function dnaKey(token: Pick<TokenCore, 'collectionId' | 'dna'>): string {
  return `${token.collectionId}:${token.dna.join('|')}`
}

/** The key a token is unique under: its DNA with every `bypassDna` layer's entry replaced by `*`. */
export function uniqueKey(dna: readonly string[], layers: Layer[]): string {
  return dna.map((traitId, i) => (layers[i]?.bypassDna ? '*' : traitId)).join('|')
}

export function countTraits(tokens: Pick<TokenCore, 'dna'>[]): TraitCounts {
  const counts: TraitCounts = {}
  for (const token of tokens) for (const traitId of token.dna) counts[traitId] = (counts[traitId] ?? 0) + 1
  return counts
}

/** Fixed-quantity traits that came out below their cap, with the count reached. */
export function cappedShortfalls(layers: Layer[], counts: TraitCounts): Shortfall[] {
  return layers.flatMap((layer) =>
    layer.traits.flatMap((trait) => {
      const actual = counts[trait.id] ?? 0
      return trait.constant && actual < trait.constant ? [{ trait, cap: trait.constant, actual }] : []
    }),
  )
}

export function tokensBreakingRules(tokens: TokenCore[], rules: ArtRule[], atLeastOne: AtLeastOne[] = []): number[] {
  return tokens
    .filter((t) => !satisfiesRules(new Set(t.dna), rules, atLeastOne.filter((c) => c.collectionId === t.collectionId)))
    .map((t) => t.id)
}

/** How many tokens each collection has, by collection id, in first-seen order. */
export function countByCollection(tokens: TokenCore[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const token of tokens) counts.set(token.collectionId, (counts.get(token.collectionId) ?? 0) + 1)
  return counts
}
```

Add `export * from './curate'` to `index.ts`.

- [ ] **Step 4: Run, expect pass; commit**

Run: `pnpm --filter @cobweb/dna test`
Expected: PASS.

```bash
git add packages/dna
git commit -m "Add DNA keys and counts to the engine"
```

### Task 5: Generation

**Files:**

- Create: `packages/dna/src/generate.ts`
- Modify: `packages/dna/src/index.ts`
- Test: `packages/dna/src/generate.test.ts`

**Interfaces:**

- Consumes: `seededRandom`, `collectionSeed` (Task 1); `buildTraitIndex`, `layersOf`, `weightsValid`, `constantTotal` (Task 2); `satisfiesRules`, `constraintsOf`, `activeProjectRules` (Task 3); `uniqueKey`, `countTraits`, `cappedShortfalls` (Task 4).
- Produces: `MAX_ATTEMPTS = 10_000`, `MAX_COLLECTION_SIZE = 10_000`, `generationProblems(project: Project): string[]`, `repairPairs(dna: string[], layers: Layer[], rules: ArtRule[], random): string[]`, `repairAtLeastOne(dna, layers, constraints: AtLeastOne[], random): string[]`, `generateCollection(layers: Layer[], rules: ArtRule[], atLeastOne: AtLeastOne[], count: number, seed: number, firstId?: number): TokenCore[]` (expects the active rules), `generateProject(project: Project, seed: number): { tokens: TokenCore[]; made: Made[]; shortfalls: Shortfall[] }`, `regenerate<T extends TokenCore>(tokens: T[], ids: ReadonlySet<number>, project: Pick<Project, 'layers' | 'rules' | 'atLeastOne'>, seed: number): T[] | null`, `fillTo<T extends TokenCore>(tokens: T[], project: Project, seed: number, make: (id: number, collectionId: string, dna: string[]) => T): T[] | null`.

- [ ] **Step 1: Failing tests**

`packages/dna/src/generate.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { countTraits, uniqueKey } from './curate'
import { deepFreeze, fixture, fixtureWithAtLeastOne } from './fixture'
import { fillTo, generateProject, generationProblems, regenerate } from './generate'
import { layersOf } from './index-of'
import { constraintsOf, satisfiesRules } from './rules'
import type { Project } from './types'

const project = fixture()
const owls = layersOf(project.layers, 'owls')
const sized = (p: Project, owlsSize: number): Project =>
  deepFreeze({ ...p, collections: p.collections.map((c) => (c.id === 'owls' ? { ...c, size: owlsSize } : c)) })

describe('generateProject', () => {
  it('is deterministic and numbers tokens 1 to N across collections', () => {
    const a = generateProject(project, 1)
    const b = generateProject(project, 1)
    expect(a).toEqual(b)
    expect(a.tokens.map((t) => t.id)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1))
    expect(a.made).toEqual([
      { collectionId: 'owls', wanted: 12, made: 12 },
      { collectionId: 'owlets', wanted: 4, made: 4 },
    ])
    expect(a.tokens.slice(12).every((t) => t.collectionId === 'owlets' && t.dna.length === 2)).toBe(true)
    expect(generateProject(project, 2).tokens).not.toEqual(a.tokens)
  })

  it('keeps every token within the rules, unique under the key, and every cap', () => {
    const { tokens, shortfalls } = generateProject(project, 3)
    const owlTokens = tokens.filter((t) => t.collectionId === 'owls')
    expect(owlTokens.every((t) => satisfiesRules(new Set(t.dna), project.rules))).toBe(true)
    expect(new Set(owlTokens.map((t) => uniqueKey(t.dna, owls))).size).toBe(owlTokens.length)
    expect(countTraits(tokens)['eyes-gold'] ?? 0).toBeLessThanOrEqual(3)
    if ((countTraits(tokens)['eyes-gold'] ?? 0) === 3) expect(shortfalls).toEqual([])
  })

  it('stops short and says how far it got when the unique combinations run out', () => {
    // Background is bypassed and the rules bind, so owls have 19 unique keys (see the fixture).
    const { made, tokens } = generateProject(sized(project, 30), 4)
    expect(made[0]!.made).toBeLessThanOrEqual(19)
    expect(made[0]!.made).toBeLessThan(30)
    expect(made[0]!.wanted).toBe(30)
    // The owlets still follow, numbered after the owls that were made.
    expect(tokens.filter((t) => t.collectionId === 'owlets')).toHaveLength(4)
    expect(tokens[tokens.length - 1]!.id).toBe(tokens.length)
  })

  it('reports a capped trait that a rule starves (a cap is a cap)', () => {
    const starved: Project = deepFreeze({
      ...project,
      layers: project.layers.map((layer) =>
        layer.id === 'body'
          ? { ...layer, traits: [{ ...layer.traits[0]!, weight: 100 }, { ...layer.traits[1]!, weight: 0, constant: 1 }] }
          : layer,
      ),
      rules: [{ id: 'gold-snow', kind: 'must pair with', traitId: 'eyes-gold', relatedTraitIds: ['body-snow'], bidirectional: false }],
    })
    const { tokens, shortfalls } = generateProject(starved, 5)
    expect(tokens.every((t) => t.collectionId !== 'owls' || satisfiesRules(new Set(t.dna), starved.rules))).toBe(true)
    const gold = countTraits(tokens)['eyes-gold'] ?? 0
    expect(gold).toBeLessThanOrEqual(1)
    expect(shortfalls.map((s) => [s.trait.id, s.cap, s.actual])).toContainEqual(['eyes-gold', 3, gold])
  })

  it('honours an at-least-one constraint', () => {
    const { tokens } = generateProject(fixtureWithAtLeastOne(), 6)
    const constraints = constraintsOf(fixtureWithAtLeastOne().atLeastOne, 'owls')
    expect(tokens.filter((t) => t.collectionId === 'owls').every((t) => satisfiesRules(new Set(t.dna), [], constraints))).toBe(true)
  })

  it('makes one token when every layer bypasses uniqueness, and returns quickly', () => {
    const allBypass: Project = deepFreeze({
      ...project,
      collections: [project.collections[0]!],
      layers: owls.map((layer) => ({ ...layer, bypassDna: true })),
      rules: [],
    })
    const started = Date.now()
    expect(generateProject(allBypass, 7).made).toEqual([{ collectionId: 'owls', wanted: 12, made: 1 }])
    expect(Date.now() - started).toBeLessThan(5000)
  })
})

describe('generationProblems', () => {
  it('explains what stops a generation', () => {
    expect(generationProblems(project)).toEqual([])
    expect(generationProblems({ ...project, collections: [] })).toEqual(['Add a collection on the Layers step.'])
    expect(generationProblems(sized(project, 10_001))[0]).toMatch(/at most 10,000 tokens/)
    const noTraits = { ...project, layers: project.layers.map((l) => (l.id === 'eyes' ? { ...l, traits: [] } : l)) }
    expect(generationProblems(noTraits)).toEqual(['Eyes in Owls has no traits yet.'])
    const bad = { ...project, layers: project.layers.map((l) => (l.id === 'body' ? { ...l, traits: l.traits.map((t) => ({ ...t, weight: 10 })) } : l)) }
    expect(generationProblems(bad)).toEqual(['The weights in Body in Owls do not add up to 100%.'])
    expect(generationProblems(sized(project, 2))).toEqual(['The fixed quantities in Eyes in Owls add up to more than its size.'])
  })
})

describe('regenerate and fillTo', () => {
  const start = generateProject(project, 8).tokens.map((t) => ({ ...t, name: `Owl #${t.id}` }))

  it('re-rolls only the chosen tokens, keeping their ids and extra fields, all or nothing', () => {
    const next = regenerate(start, new Set([1, 2]), project, 9)!
    expect(next).not.toBeNull()
    expect(next.map((t) => t.id)).toEqual(start.map((t) => t.id))
    expect(next.slice(2)).toEqual(start.slice(2))
    expect(next[0]!.name).toBe('Owl #1')
    const owlTokens = next.filter((t) => t.collectionId === 'owls')
    expect(new Set(owlTokens.map((t) => uniqueKey(t.dna, owls))).size).toBe(owlTokens.length)
    expect(owlTokens.every((t) => satisfiesRules(new Set(t.dna), project.rules))).toBe(true)
    expect(regenerate(start, new Set([1, 2]), project, 9)).toEqual(next)
  })

  it('fills a collection up to its size with ids after the last, or returns null when it cannot', () => {
    const ten = generateProject(sized(project, 10), 8).tokens.map((t) => ({ ...t, name: '' }))
    const filled = fillTo(ten, sized(project, 12), 10, (id, collectionId, dna) => ({ id, collectionId, dna, name: 'new' }))!
    expect(filled).toHaveLength(16)
    expect(filled.slice(14).map((t) => [t.id, t.collectionId, t.name])).toEqual([[15, 'owls', 'new'], [16, 'owls', 'new']])
    const owlTokens = filled.filter((t) => t.collectionId === 'owls')
    expect(new Set(owlTokens.map((t) => uniqueKey(t.dna, owls))).size).toBe(12)
    const allBypass: Project = { ...project, collections: [{ ...project.collections[0]!, size: 2 }], layers: owls.map((l) => ({ ...l, bypassDna: true })), rules: [] }
    const one = generateProject(allBypass, 1).tokens
    expect(fillTo(one, allBypass, 2, (id, collectionId, dna) => ({ id, collectionId, dna }))).toBeNull()
  })
})
```

- [ ] **Step 2: Run, expect failure**

Run: `pnpm --filter @cobweb/dna test`
Expected: FAIL, `Cannot find module './generate'`.

- [ ] **Step 3: Implement**

`packages/dna/src/generate.ts`:

```ts
import { cappedShortfalls, countTraits, uniqueKey } from './curate'
import { buildTraitIndex, constantTotal, layersOf, weightedTraits, weightsValid } from './index-of'
import { collectionSeed, seededRandom } from './random'
import { activeProjectRules, constraintsOf, satisfiesRules } from './rules'
import type { ArtRule, AtLeastOne, Layer, Made, Project, Shortfall, TokenCore, Trait } from './types'

/** Rolls one token gets before the generator gives up on it (legacy: 10,000 failed attempts in a row). */
export const MAX_ATTEMPTS = 10_000
/** Legacy limit on one collection's size. */
export const MAX_COLLECTION_SIZE = 10_000

/** Problems that stop a full generation, worded for the creator. */
export function generationProblems(project: Project): string[] {
  const { layers, collections } = project
  const problems: string[] = []
  const several = collections.length > 1
  if (collections.length === 0) problems.push('Add a collection on the Layers step.')
  else if (collections.every((collection) => collection.size < 1))
    problems.push(several ? 'Set a size for at least one collection.' : `Set a size for ${collections[0]!.name}.`)
  for (const collection of collections) {
    const own = layersOf(layers, collection.id)
    const where = several ? ` in ${collection.name}` : ''
    if (collection.size < 1) continue
    if (collection.size > MAX_COLLECTION_SIZE)
      problems.push(`${collection.name} can have at most ${MAX_COLLECTION_SIZE.toLocaleString('en-US')} tokens.`)
    if (own.length === 0) {
      problems.push(`Add at least one layer${where} on the Layers step.`)
      continue
    }
    const before = problems.length
    for (const layer of own) {
      if (layer.traits.length === 0) problems.push(`${layer.name}${where} has no traits yet.`)
      else if (!weightsValid(layer)) problems.push(`The weights in ${layer.name}${where} do not add up to 100%.`)
      if (constantTotal(layer) > collection.size)
        problems.push(`The fixed quantities in ${layer.name}${where} add up to more than its size.`)
    }
    if (problems.length > before) continue
    const combinations = own.reduce(
      (product, layer) => product * layer.traits.filter((t) => t.constant || t.weight > 0).length,
      1,
    )
    if (combinations < collection.size)
      problems.push(
        `The layers${where} make at most ${combinations.toLocaleString('en-US')} different tokens, fewer than the size of ${collection.size.toLocaleString('en-US')}. Add traits or lower the size.`,
      )
  }
  return problems
}

/** A weighted pick with `random() * 100` over the layer's weighted traits, as the legacy generator rolled. */
function pickWeighted(traits: Trait[], random: () => number): Trait | undefined {
  const weighted = traits.filter((trait) => !trait.constant && trait.weight > 0)
  let roll = random() * 100
  for (const trait of weighted) {
    roll -= trait.weight
    if (roll < 0) return trait
  }
  return weighted[weighted.length - 1]
}

function layerIndexOf(layers: Layer[], traitId: string): number {
  return layers.findIndex((layer) => layer.traits.some((t) => t.id === traitId))
}

function isCapped(layers: Layer[], traitId: string): boolean {
  return layers.some((layer) => layer.traits.some((t) => t.id === traitId && t.constant))
}

/**
 * Pairing rules would reject most rolls if left to chance, so a trait that needs a partner gets one:
 * the partner's layer is switched to one of the related traits (and, for "always pairs with", a
 * related trait that appears alone pulls in its source trait). A capped trait is never pulled in.
 */
export function repairPairs(dna: string[], layers: Layer[], rules: ArtRule[], random: () => number): string[] {
  const next = [...dna]
  const place = (traitId: string) => {
    const index = layerIndexOf(layers, traitId)
    if (index !== -1 && !isCapped(layers, traitId)) next[index] = traitId
  }
  for (const rule of rules) {
    if (rule.kind === "doesn't mix with") continue
    const hasTrait = next.includes(rule.traitId)
    const hasRelated = rule.relatedTraitIds.some((id) => next.includes(id))
    if (hasTrait && !hasRelated) place(rule.relatedTraitIds[Math.floor(random() * rule.relatedTraitIds.length)]!)
    else if (rule.kind === 'always pairs with' && hasRelated && !hasTrait) place(rule.traitId)
  }
  return next
}

/** Pulls one of a constraint's traits into a token that has none of them (never a capped trait). */
export function repairAtLeastOne(dna: string[], layers: Layer[], constraints: AtLeastOne[], random: () => number): string[] {
  const next = [...dna]
  for (const constraint of constraints) {
    if (constraint.traitIds.some((id) => next.includes(id))) continue
    const options = constraint.traitIds.filter((id) => layerIndexOf(layers, id) !== -1 && !isCapped(layers, id))
    if (options.length === 0) continue
    const chosen = options[Math.floor(random() * options.length)]!
    next[layerIndexOf(layers, chosen)] = chosen
  }
  return next
}

/**
 * Generates `count` tokens of one collection, unique under `uniqueKey` and within `rules` (pass the
 * active rules) and `atLeastOne`, deterministically from `seed`. Capped traits are handed out up
 * front as caps: when a slot cannot carry its capped traits, it is rolled without them. Stops at the
 * first slot that fails `MAX_ATTEMPTS` rolls and returns what it made.
 */
export function generateCollection(
  layers: Layer[],
  rules: ArtRule[],
  atLeastOne: AtLeastOne[],
  count: number,
  seed: number,
  firstId = 1,
): TokenCore[] {
  if (layers.length === 0 || count < 1) return []
  const random = seededRandom(seed)
  const collectionId = layers[0]!.collectionId

  const forced = new Map<number, Trait[]>()
  for (const layer of layers) {
    for (const trait of layer.traits) {
      if (!trait.constant) continue
      let placed = 0
      let tries = 0
      while (placed < trait.constant && tries < count * 50) {
        tries++
        const index = Math.floor(random() * count)
        const existing = forced.get(index) ?? []
        if (existing.some((other) => other.layerId === trait.layerId)) continue
        forced.set(index, [...existing, trait])
        placed++
      }
    }
  }

  const seen = new Set<string>()
  const roll = (fixed: Trait[]): string[] | null => {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const picks: string[] = []
      for (const layer of layers) {
        const trait = fixed.find((t) => t.layerId === layer.id) ?? pickWeighted(layer.traits, random)
        if (!trait) return null
        picks.push(trait.id)
      }
      let dna = repairPairs(picks, layers, rules, random)
      if (atLeastOne.length > 0) dna = repairAtLeastOne(dna, layers, atLeastOne, random)
      if (!seen.has(uniqueKey(dna, layers)) && satisfiesRules(new Set(dna), rules, atLeastOne)) return dna
    }
    return null
  }

  const tokens: TokenCore[] = []
  for (let index = 0; index < count; index++) {
    const fixed = forced.get(index) ?? []
    const dna = roll(fixed) ?? (fixed.length ? roll([]) : null)
    if (!dna) break
    seen.add(uniqueKey(dna, layers))
    tokens.push({ id: firstId + index, collectionId, dna })
  }
  return tokens
}

/**
 * Generates every collection with a size, in order, ids running on across them. Rules named in a
 * conflict are skipped, as the Rules screen shows. `made` says how far each collection got;
 * `shortfalls` lists capped traits below their cap.
 */
export function generateProject(project: Project, seed: number): { tokens: TokenCore[]; made: Made[]; shortfalls: Shortfall[] } {
  const index = buildTraitIndex(project.layers)
  const rules = activeProjectRules(project, index)
  const tokens: TokenCore[] = []
  const made: Made[] = []
  project.collections
    .filter((collection) => collection.size > 0)
    .forEach((collection, position) => {
      const got = generateCollection(
        layersOf(project.layers, collection.id),
        rules,
        constraintsOf(project.atLeastOne, collection.id),
        collection.size,
        collectionSeed(seed, position),
        tokens.length + 1,
      )
      tokens.push(...got)
      made.push({ collectionId: collection.id, wanted: collection.size, made: got.length })
    })
  return { tokens, made, shortfalls: cappedShortfalls(project.layers, countTraits(tokens)) }
}

/** A pick by relative weight over already-filtered traits (curation re-rolls). */
function pick(traits: Trait[], random: () => number): Trait | undefined {
  const total = traits.reduce((sum, trait) => sum + trait.weight, 0)
  let roll = random() * total
  for (const trait of traits) {
    roll -= trait.weight
    if (roll < 0) return trait
  }
  return traits[traits.length - 1]
}

/** A new DNA for one token: its capped traits stay where they are, the rest is rolled until valid and free. */
function reroll(
  current: string[] | null,
  layers: Layer[],
  rules: ArtRule[],
  atLeastOne: AtLeastOne[],
  isTaken: (key: string) => boolean,
  random: () => number,
): string[] | null {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const picks: string[] = []
    for (const [i, layer] of layers.entries()) {
      const kept = layer.traits.find((trait) => trait.id === current?.[i] && trait.constant)
      const trait = kept ?? pick(weightedTraits(layer), random)
      if (!trait) return null
      picks.push(trait.id)
    }
    let dna = repairPairs(picks, layers, rules, random)
    if (atLeastOne.length > 0) dna = repairAtLeastOne(dna, layers, atLeastOne, random)
    if (!isTaken(uniqueKey(dna, layers)) && satisfiesRules(new Set(dna), rules, atLeastOne)) return dna
  }
  return null
}

type Scoped = Pick<Project, 'layers' | 'rules' | 'atLeastOne'>

function scope(project: Scoped) {
  const index = buildTraitIndex(project.layers)
  const rules = activeProjectRules(project, index)
  const layersFor = new Map<string, Layer[]>()
  const of = (collectionId: string) => {
    let own = layersFor.get(collectionId)
    if (!own) layersFor.set(collectionId, (own = layersOf(project.layers, collectionId)))
    return own
  }
  const key = (token: TokenCore) => `${token.collectionId}:${uniqueKey(token.dna, of(token.collectionId))}`
  return { rules, of, key, constraints: (collectionId: string) => constraintsOf(project.atLeastOne, collectionId) }
}

/** Re-rolls the chosen tokens, keeping their ids and other fields. All or nothing: null if one cannot be made. */
export function regenerate<T extends TokenCore>(tokens: T[], ids: ReadonlySet<number>, project: Scoped, seed: number): T[] | null {
  const random = seededRandom(seed)
  const { rules, of, key, constraints } = scope(project)
  const taken = new Set(tokens.filter((t) => !ids.has(t.id)).map(key))
  const next: T[] = []
  for (const token of tokens) {
    if (!ids.has(token.id)) {
      next.push(token)
      continue
    }
    const own = of(token.collectionId)
    const dna = reroll(token.dna, own, rules, constraints(token.collectionId), (k) => taken.has(`${token.collectionId}:${k}`), random)
    if (!dna) return null
    taken.add(`${token.collectionId}:${uniqueKey(dna, own)}`)
    next.push({ ...token, dna })
  }
  return next
}

/** Brings every collection up to its size; new tokens take ids after the last. Null if one cannot be made. */
export function fillTo<T extends TokenCore>(
  tokens: T[],
  project: Project,
  seed: number,
  make: (id: number, collectionId: string, dna: string[]) => T,
): T[] | null {
  const random = seededRandom(seed)
  const { rules, of, key, constraints } = scope(project)
  const taken = new Set(tokens.map(key))
  const next: T[] = [...tokens]
  let id = tokens.reduce((max, t) => Math.max(max, t.id), 0)
  for (const collection of project.collections) {
    const own = of(collection.id)
    const have = tokens.filter((t) => t.collectionId === collection.id).length
    for (let i = have; i < collection.size; i++) {
      const dna = reroll(null, own, rules, constraints(collection.id), (k) => taken.has(`${collection.id}:${k}`), random)
      if (!dna) return null
      taken.add(`${collection.id}:${uniqueKey(dna, own)}`)
      next.push(make(++id, collection.id, dna))
    }
  }
  return next
}
```

Add `export * from './generate'` to `index.ts`. If the file passes 300 lines, move `regenerate`, `fillTo`, `reroll`, `pick` and `scope` to `reroll.ts` and re-export.

- [ ] **Step 4: Run, expect pass**

Run: `pnpm --filter @cobweb/dna test`
Expected: PASS. If the all-bypass test takes long, lower nothing: 10,000 rolls for one slot then `break` is the contract; it should finish well under a second.

- [ ] **Step 5: Commit**

```bash
git add packages/dna
git commit -m "Add seeded generation, re-rolls and fill to the DNA engine"
```

### Task 6: Curation operations

**Files:**

- Modify: `packages/dna/src/curate.ts`
- Test: `packages/dna/src/curate.test.ts` (append)

**Interfaces:**

- Consumes: `brokenRule`, `activeProjectRules`, `constraintsOf` (Task 3); `TraitIndex`, `layersOf` (Task 2); `seededRandom`, `shuffle` (Task 1).
- Produces: `ChangeOutcome<T> = { ok: true; tokens: T[] } | { ok: false; reason: string }`, `changeTrait<T extends TokenCore>(tokens: T[], tokenId: number, layerIndex: number, traitId: string, project: Pick<Project, 'layers' | 'rules' | 'atLeastOne'>, index: TraitIndex): ChangeOutcome<T>` (refuses a trait that is not in the collection's layer at `layerIndex`, which also covers an out-of-range index), `swapIds<T>(tokens: T[], a: number, b: number): T[]`, `deleteTokens<T>(tokens: T[], ids: ReadonlySet<number>): T[]` (closes the gaps so ids stay 1 to N), `shuffleIds<T>(tokens: T[], ids: ReadonlySet<number>, seed: number): T[]`.

- [ ] **Step 1: Failing tests** (append to `curate.test.ts`; put the two new `import` lines in the import block at the top, not mid-file)

```ts
import { changeTrait, deleteTokens, shuffleIds, swapIds } from './curate'
import { buildTraitIndex } from './index-of'

const index = buildTraitIndex(project.layers)
const owl = (id: number, dna: string[]) => ({ id, collectionId: 'owls', dna, name: `Owl #${id}` })
const hand = [
  owl(1, ['bg-ink', 'body-barn', 'eyes-wide', 'acc-none']),
  owl(2, ['bg-sand', 'body-barn', 'eyes-wide', 'acc-hat']),
  owl(3, ['bg-ink', 'body-snow', 'eyes-wide', 'acc-scarf']),
  owl(4, ['bg-ink', 'body-barn', 'eyes-sleepy', 'acc-none']),
]

describe('changeTrait', () => {
  it('accepts a change within the cap, the rules and uniqueness, keeping other fields', () => {
    const result = changeTrait(hand, 1, 2, 'eyes-gold', project, index)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.tokens[0]!.dna).toEqual(['bg-ink', 'body-barn', 'eyes-gold', 'acc-none'])
    expect(result.tokens[0]!.name).toBe('Owl #1')
    expect(result.tokens.slice(1)).toEqual(hand.slice(1))
  })
  it('refuses a change past a cap', () => {
    const golden = [1, 2, 3].map((id) => owl(id, ['bg-ink', 'body-barn', 'eyes-gold', `acc-${['none', 'hat', 'scarf'][id - 1]}`]))
    const result = changeTrait([...golden, hand[3]!], 4, 2, 'eyes-gold', project, index)
    expect(result).toEqual({ ok: false, reason: 'Gold can appear on up to 3 tokens, and 3 already have it.' })
  })
  it('refuses a change that breaks a rule, with the rule', () => {
    expect(changeTrait(hand, 4, 3, 'acc-hat', project, index)).toEqual({
      ok: false,
      reason: "That breaks a rule: Hat doesn't mix with Sleepy.",
    })
  })
  it('refuses a change that makes two tokens the same under the key, ignoring a bypassed layer', () => {
    const result = changeTrait(hand, 2, 3, 'acc-none', project, index)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('Token #1 already has exactly these traits. Every token must be unique.')
    // Changing only the bypassed layer is always fine: the key does not see it.
    expect(changeTrait(hand, 1, 0, 'bg-sand', project, index).ok).toBe(true)
  })
  it('explains a missing token or trait, and refuses a trait from another layer or collection', () => {
    expect(changeTrait(hand, 99, 0, 'bg-sand', project, index)).toEqual({ ok: false, reason: 'This token no longer exists.' })
    expect(changeTrait(hand, 1, 0, 'nope', project, index)).toEqual({ ok: false, reason: 'That trait no longer exists.' })
    const elsewhere = { ok: false, reason: 'That trait belongs to another layer.' }
    expect(changeTrait(hand, 1, 0, 'acc-monocle', project, index)).toEqual(elsewhere) // accessory trait into Background
    expect(changeTrait(hand, 1, 1, 'ob-1', project, index)).toEqual(elsewhere) // an owlet trait into an owl
    expect(changeTrait(hand, 1, 9, 'eyes-gold', project, index)).toEqual(elsewhere) // no such layer
  })
})

describe('ids', () => {
  it('swaps two ids, deletes and closes the gaps, and shuffles chosen ids deterministically', () => {
    const swapped = swapIds(hand, 1, 3)
    expect(swapped.map((t) => t.id)).toEqual([3, 2, 1, 4])
    expect(swapped[0]!.dna).toBe(hand[0]!.dna)
    const deleted = deleteTokens(hand, new Set([2]))
    expect(deleted.map((t) => [t.id, t.dna[3]])).toEqual([[1, 'acc-none'], [2, 'acc-scarf'], [3, 'acc-none']])
    // Pick a seed whose permutation of {1, 2, 3} is not the identity, so a no-op shuffle fails this test.
    const seed = [1, 2, 3, 4, 5, 6, 7, 8].find((s) => shuffleIds(hand, new Set([1, 2, 3]), s).map((t) => t.id).join() !== '1,2,3,4')!
    const shuffled = shuffleIds(hand, new Set([1, 2, 3]), seed)
    expect(shuffled.map((t) => t.id)).not.toEqual([1, 2, 3, 4])
    expect([...shuffled.map((t) => t.id)].sort()).toEqual([1, 2, 3, 4])
    expect(shuffled.find((t) => t.dna === hand[3]!.dna)!.id).toBe(4)
    expect(shuffleIds(hand, new Set([1, 2, 3]), seed)).toEqual(shuffled)
    expect(hand.map((t) => t.id)).toEqual([1, 2, 3, 4])
  })
})
```

- [ ] **Step 2: Run, expect failure**

Run: `pnpm --filter @cobweb/dna test`
Expected: FAIL, `changeTrait` is not exported.

- [ ] **Step 3: Implement** (append to `curate.ts`; add the imports at the top)

```ts
import { buildTraitIndex, layersOf, type TraitIndex } from './index-of'
import { seededRandom, shuffle } from './random'
import { activeProjectRules, brokenRule, constraintsOf } from './rules'
import type { Project } from './types'

export type ChangeOutcome<T extends TokenCore> = { ok: true; tokens: T[] } | { ok: false; reason: string }

/**
 * Sets one layer of one token to another trait, if the result is allowed: within the trait's cap,
 * within the active rules and constraints, and unique in its collection. `layerIndex` is in the
 * token's collection. Ranks and names are not touched; the caller re-ranks.
 */
export function changeTrait<T extends TokenCore>(
  tokens: T[],
  tokenId: number,
  layerIndex: number,
  traitId: string,
  project: Pick<Project, 'layers' | 'rules' | 'atLeastOne'>,
  index: TraitIndex = buildTraitIndex(project.layers),
): ChangeOutcome<T> {
  const token = tokens.find((t) => t.id === tokenId)
  if (!token) return { ok: false, reason: 'This token no longer exists.' }
  const from = index.get(token.dna[layerIndex] ?? '')?.trait
  const to = index.get(traitId)?.trait
  if (!to) return { ok: false, reason: 'That trait no longer exists.' }
  const own = layersOf(project.layers, token.collectionId)
  if (own[layerIndex]?.id !== to.layerId) return { ok: false, reason: 'That trait belongs to another layer.' }
  if (to.constant && from?.id !== to.id) {
    const carrying = tokens.filter((t) => t.dna.includes(to.id)).length
    if (carrying >= to.constant)
      return {
        ok: false,
        reason: `${to.name} can appear on up to ${to.constant.toLocaleString('en-US')} tokens, and ${carrying.toLocaleString('en-US')} already have it.`,
      }
  }
  const dna = token.dna.map((id, i) => (i === layerIndex ? traitId : id))
  const broken = brokenRule(dna, activeProjectRules(project, index), index, constraintsOf(project.atLeastOne, token.collectionId))
  if (broken) return { ok: false, reason: `That breaks a rule: ${broken}` }
  const key = uniqueKey(dna, own)
  const twin = tokens.find((t) => t.id !== tokenId && t.collectionId === token.collectionId && uniqueKey(t.dna, own) === key)
  if (twin) return { ok: false, reason: `Token #${twin.id} already has exactly these traits. Every token must be unique.` }
  return { ok: true, tokens: tokens.map((t) => (t.id === tokenId ? { ...t, dna } : t)) }
}

/** Swaps the ids of two tokens. Their traits stay with them. */
export function swapIds<T extends TokenCore>(tokens: T[], a: number, b: number): T[] {
  return tokens.map((t) => (t.id === a ? { ...t, id: b } : t.id === b ? { ...t, id: a } : t))
}

/** Deletes tokens and closes the gaps, so ids stay 1 to N. */
export function deleteTokens<T extends TokenCore>(tokens: T[], ids: ReadonlySet<number>): T[] {
  return tokens
    .filter((t) => !ids.has(t.id))
    .sort((a, b) => a.id - b.id)
    .map((t, i) => ({ ...t, id: i + 1 }))
}

/** Shuffles the ids among the chosen tokens, deterministically from the seed. */
export function shuffleIds<T extends TokenCore>(tokens: T[], ids: ReadonlySet<number>, seed: number): T[] {
  const slots = tokens.filter((t) => ids.has(t.id)).map((t) => t.id)
  const order = shuffle(slots, seededRandom(seed))
  const moved = new Map(slots.map((id, i) => [id, order[i]!]))
  return tokens.map((t) => ({ ...t, id: moved.get(t.id) ?? t.id }))
}
```

Mind the import cycle: `generate.ts` imports `curate.ts`, so `curate.ts` must not import `generate.ts`. It does not.

- [ ] **Step 4: Run, expect pass; commit**

Run: `pnpm --filter @cobweb/dna test`
Expected: PASS.

```bash
git add packages/dna
git commit -m "Add trait changes, id swaps, deletes and shuffles to the DNA engine"
```

### Task 7: Rank, tiers and metadata attributes

**Files:**

- Create: `packages/dna/src/rank.ts`, `packages/dna/src/metadata.ts`
- Modify: `packages/dna/src/index.ts`
- Test: `packages/dna/src/rank.test.ts`, `packages/dna/src/metadata.test.ts`

**Interfaces:**

- Consumes: `TokenCore`, `Ranked`, `Layer` (Task 1); `TraitIndex`, `attributeKeyOf` (Task 2).
- Produces: `rankTokens<T extends TokenCore>(tokens: T[], keyOf: (traitId: string) => string): Ranked<T>[]` (same order as the input, `rank` 1 is rarest), `RarityTier = { key: 'legendary' | 'epic' | 'rare' | 'uncommon' | 'common'; label: string }`, `rarityTier(rank: number, total: number): RarityTier`, `TIER_RANGES: Record<RarityTier['key'], string>`, `tokenAttributes(token: Pick<TokenCore, 'dna'>, layers: Layer[], index: TraitIndex, options: { showBlankTraits: boolean }): { trait_type: string; value: string }[]`.

- [ ] **Step 1: Failing tests**

`packages/dna/src/rank.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { fixture } from './fixture'
import { attributeKey, attributeKeyOf, buildTraitIndex } from './index-of'
import { rankTokens, rarityTier } from './rank'

/** Trait ids `<collection>:<layer>:<trait>`; the key is layer and trait name, as in the metadata. */
const keyOf = (id: string) => {
  const [, layer, trait] = id.split(':')
  return attributeKey(layer!, trait!)
}
const token = (id: number, dna: string[]) => ({ id, collectionId: 'a', dna, name: `#${id}` })

describe('rankTokens (sum of supply over attribute count)', () => {
  it('ranks a hand-computed set, ties to the lower id, and keeps order and fields', () => {
    // counts: a1 3, a2 1, b1 3, b2 1; total 4. Scores: t1 2.67, t2 5.33, t3 5.33, t4 2.67.
    const tokens = [token(1, ['L1:a1', 'L2:b1']), token(2, ['L1:a1', 'L2:b2']), token(3, ['L1:a2', 'L2:b1']), token(4, ['L1:a1', 'L2:b1'])]
      .map((t) => ({ ...t, dna: t.dna.map((d) => `a:${d}`) }))
    const ranked = rankTokens(tokens, keyOf)
    expect(ranked.map((t) => [t.id, t.rank])).toEqual([[1, 3], [2, 1], [3, 2], [4, 4]])
    expect(ranked[0]!.name).toBe('#1')
  })

  it('counts the same attribute in two collections once', () => {
    const tokens = [
      { id: 1, collectionId: 'a', dna: ['a:Background:Dusk'] },
      { id: 2, collectionId: 'a', dna: ['a:Background:Ink'] },
      { id: 3, collectionId: 'b', dna: ['b:Background:Dusk'] },
      { id: 4, collectionId: 'b', dna: ['b:Background:Dusk'] },
    ]
    const ranked = rankTokens(tokens, keyOf)
    expect(ranked.find((t) => t.id === 2)!.rank).toBe(1)
    expect(ranked.find((t) => t.id === 1)!.rank).toBeGreaterThan(1)
  })

  it('adds, so a token with more attributes scores higher than one with fewer, equally rare ones', () => {
    // Tokens 1 and 3: three attributes, each on two of three tokens (score 3 x 1.5 = 4.5). Token 2: one
    // unique attribute (score 3). The sum puts 1 and 3 above 2; the old mean would have put 2 first.
    const tokens = [
      token(1, ['a:Body:Barn', 'a:Eyes:Wide', 'a:Acc:Hat']),
      token(2, ['b:Hat:Crown']),
      token(3, ['a:Body:Barn', 'a:Eyes:Wide', 'a:Acc:Hat']),
    ]
    const ranked = rankTokens(tokens, keyOf)
    expect(ranked.find((t) => t.id === 1)!.rank).toBe(1)
    expect(ranked.find((t) => t.id === 2)!.rank).toBe(3)
  })

  it('treats the same attributes in a different layer order as a tie, whatever the float drift', () => {
    // A baseline with no ties, to show the sum still orders distinct scores.
    const tokens = [
      token(1, ['a:L1:x', 'a:L2:y', 'a:L3:common']),
      token(2, ['a:L1:common', 'a:L2:z', 'a:L3:w']),
      token(3, ['a:L1:common', 'a:L2:q', 'a:L3:common']),
      token(4, ['a:L1:p', 'a:L2:q', 'a:L3:common']),
    ]
    // common on L1: tokens 2 and 3 (2); common on L3: tokens 1, 3, 4 (3); q on L2: 3 and 4 (2); the rest 1.
    // Token 1: 4 + 4 + 4/3. Token 2: 2 + 4 + 4. Token 4: 4 + 2 + 4/3. Token 3: 2 + 2 + 4/3.
    const ranked = rankTokens(tokens, keyOf)
    expect(ranked.map((t) => [t.id, t.rank])).toEqual([[1, 2], [2, 1], [3, 4], [4, 3]])
    // Tokens 1, 2 and 3 each carry one attribute on three tokens (common) and two on one token, in
    // different layer orders. Summed in DNA order, [4/3, 4, 4] and [4, 4, 4/3] differ by one ulp, so the
    // old comparator put token 2 ahead of token 1; sorted first they tie and the ids decide.
    const twins = [
      token(1, ['a:L1:common', 'a:L2:v', 'a:L3:u']),
      token(2, ['a:L1:w', 'a:L2:x', 'a:L3:common']),
      token(3, ['a:L1:common', 'a:L2:y', 'a:L3:z']),
      token(4, ['a:L1:p', 'a:L2:q', 'a:L3:r']),
    ]
    expect(rankTokens(twins, (id) => id.split(':')[2]!).map((t) => [t.id, t.rank])).toEqual([[1, 2], [2, 3], [3, 4], [4, 1]])
  })

  it('copes with mixed DNA lengths and unknown ids after a layer is deleted', () => {
    const project = fixture()
    const keyOfIndex = attributeKeyOf(buildTraitIndex(project.layers))
    const tokens = [
      { id: 1, collectionId: 'owls', dna: ['bg-ink', 'body-barn', 'eyes-wide'] },
      { id: 2, collectionId: 'owls', dna: ['bg-ink', 'body-barn', 'eyes-wide', 'gone-trait'] },
      { id: 3, collectionId: 'owlets', dna: ['ob-1', 'oe-1'] },
    ]
    const ranked = rankTokens(tokens, keyOfIndex)
    expect(ranked.map((t) => t.rank).sort()).toEqual([1, 2, 3])
    expect(ranked.find((t) => t.id === 2)!.rank).toBe(1)
  })
})

describe('rarityTier', () => {
  it('cuts at 5, 15, 30 and 50 percent of the supply', () => {
    expect(rarityTier(5, 100).key).toBe('legendary')
    expect(rarityTier(6, 100).key).toBe('epic')
    expect(rarityTier(15, 100).key).toBe('epic')
    expect(rarityTier(16, 100).key).toBe('rare')
    expect(rarityTier(30, 100).key).toBe('rare')
    expect(rarityTier(31, 100).key).toBe('uncommon')
    expect(rarityTier(50, 100).key).toBe('uncommon')
    expect(rarityTier(51, 100).key).toBe('common')
    expect(rarityTier(1, 0).label).toBe('Common')
  })
})
```

`packages/dna/src/metadata.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { deepFreeze, fixture } from './fixture'
import { buildTraitIndex, layersOf } from './index-of'
import { tokenAttributes } from './metadata'

const project = fixture()
const owls = layersOf(project.layers, 'owls')
const token = { dna: ['bg-ink', 'body-barn', 'eyes-wide', 'acc-none'] }

describe('tokenAttributes', () => {
  it('writes layer and trait names bottom first, leaving a blank out unless asked', () => {
    const index = buildTraitIndex(owls)
    expect(tokenAttributes(token, owls, index, { showBlankTraits: false })).toEqual([
      { trait_type: 'Background', value: 'Ink' },
      { trait_type: 'Body', value: 'Barn' },
      { trait_type: 'Eyes', value: 'Wide' },
    ])
    expect(tokenAttributes(token, owls, index, { showBlankTraits: true })[3]).toEqual({ trait_type: 'Accessory', value: 'None' })
  })

  it('honours a layer display name and a trait with metadata off', () => {
    const layers = deepFreeze(
      owls.map((layer) =>
        layer.id === 'background'
          ? { ...layer, displayName: 'Scene' }
          : layer.id === 'eyes'
            ? { ...layer, traits: layer.traits.map((t) => (t.id === 'eyes-wide' ? { ...t, metadata: false as const } : t)) }
            : layer,
      ),
    )
    expect(tokenAttributes(token, layers, buildTraitIndex(layers), { showBlankTraits: false })).toEqual([
      { trait_type: 'Scene', value: 'Ink' },
      { trait_type: 'Body', value: 'Barn' },
    ])
  })
})
```

- [ ] **Step 2: Run, expect failure**

Run: `pnpm --filter @cobweb/dna test`
Expected: FAIL, `Cannot find module './rank'` and `'./metadata'`.

- [ ] **Step 3: Implement**

`packages/dna/src/rank.ts`:

```ts
import type { Ranked, TokenCore } from './types'

/**
 * Ranks tokens by rarity, 1 the rarest: a token's score is the sum over its DNA of
 * (tokens / tokens with that attribute), attributes counted by `keyOf` (layer and trait name, so
 * the same attribute in two collections is one). Blanks and unknown ids count as attributes of their
 * own. No division by layer count, so it ranks like marketplaces do. Ties (scores within a relative
 * epsilon) go to the lower id. The result keeps the input order and every extra field.
 */
export function rankTokens<T extends TokenCore>(tokens: T[], keyOf: (traitId: string) => string): Ranked<T>[] {
  const counts = new Map<string, number>()
  for (const token of tokens)
    for (const traitId of token.dna) counts.set(keyOf(traitId), (counts.get(keyOf(traitId)) ?? 0) + 1)
  const total = tokens.length
  // Terms are summed smallest first so two tokens with the same attributes get the same float, and
  // scores within a relative epsilon count as tied; otherwise summation order could put tied tokens
  // one ulp apart and the id tie-break would never run.
  const scored = tokens.map((token) => ({
    token,
    score: token.dna
      .map((traitId) => total / (counts.get(keyOf(traitId)) ?? 1))
      .sort((a, b) => a - b)
      .reduce((sum, term) => sum + term, 0),
  }))
  const tied = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(Math.abs(a), Math.abs(b))
  const order = [...scored].sort((a, b) => (tied(a.score, b.score) ? a.token.id - b.token.id : b.score - a.score))
  const rankById = new Map(order.map((entry, i) => [entry.token.id, i + 1]))
  return tokens.map((token) => ({ ...token, rank: rankById.get(token.id)! }))
}

export type RarityTier = { key: 'legendary' | 'epic' | 'rare' | 'uncommon' | 'common'; label: string }

/** The legacy tiers by rank: top 5%, 15%, 30%, 50%, then the rest. */
export function rarityTier(rank: number, total: number): RarityTier {
  const share = rank / Math.max(1, total)
  if (share <= 0.05) return { key: 'legendary', label: 'Legendary' }
  if (share <= 0.15) return { key: 'epic', label: 'Epic' }
  if (share <= 0.3) return { key: 'rare', label: 'Rare' }
  if (share <= 0.5) return { key: 'uncommon', label: 'Uncommon' }
  return { key: 'common', label: 'Common' }
}

export const TIER_RANGES: Record<RarityTier['key'], string> = {
  legendary: 'Top 5%',
  epic: 'Top 15%',
  rare: 'Top 30%',
  uncommon: 'Top 50%',
  common: 'The rest',
}
```

`packages/dna/src/metadata.ts`:

```ts
import type { TraitIndex } from './index-of'
import type { Layer, TokenCore } from './types'

/**
 * A token's metadata attributes, bottom layer first, as the render pipeline writes them. A blank is
 * left out unless `showBlankTraits` (then written with the blank's name); a trait with `metadata`
 * off is left out; the layer's `displayName` stands in for its name when set.
 */
export function tokenAttributes(
  token: Pick<TokenCore, 'dna'>,
  layers: Layer[],
  index: TraitIndex,
  options: { showBlankTraits: boolean },
): { trait_type: string; value: string }[] {
  return layers.flatMap((layer, i) => {
    const trait = index.get(token.dna[i] ?? '')?.trait
    if (!trait || trait.metadata === false || (trait.blank && !options.showBlankTraits)) return []
    return [{ trait_type: layer.displayName ?? layer.name, value: trait.name }]
  })
}
```

Add `export * from './rank'` and `export * from './metadata'` to `index.ts`.

- [ ] **Step 4: Run, expect pass; commit**

Run: `pnpm --filter @cobweb/dna test`
Expected: PASS.

```bash
git add packages/dna
git commit -m "Add sum-based ranking, tiers and metadata attributes to the DNA engine"
```

### Task 8: Lock validation and the token list hash

**Files:**

- Create: `packages/dna/src/lock.ts`
- Modify: `packages/dna/src/index.ts`
- Test: `packages/dna/src/lock.test.ts`

**Interfaces:**

- Consumes: `buildTraitIndex`, `layersOf`, `traitName`, `joinOr` (Task 2); `activeProjectRules`, `constraintsOf`, `brokenRule` (Task 3); `uniqueKey`, `countTraits` (Task 4).
- Produces: `LockProblem = { code: 'ids' | 'size' | 'collection' | 'dna-length' | 'trait' | 'rule' | 'cap' | 'duplicate'; message: string; tokenIds?: number[] }`, `validateTokenList(project: Project, tokens: TokenCore[], options: { allowDuplicates: boolean }): { ok: true } | { ok: false; problems: LockProblem[] }`, `canonicalTokenList(tokens: TokenCore[]): string`, `hashTokenList(tokens: TokenCore[]): Promise<\`0x${string}\`>`.

- [ ] **Step 1: Failing tests**

`packages/dna/src/lock.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { deepFreeze, fixture, fixtureWithAtLeastOne } from './fixture'
import { generateProject } from './generate'
import { canonicalTokenList, hashTokenList, validateTokenList, type LockProblem } from './lock'
import type { TokenCore } from './types'

const project = fixture()
const good = generateProject(project, 1).tokens
const codes = (result: ReturnType<typeof validateTokenList>) => (result.ok ? [] : result.problems.map((p) => p.code))
const problem = (result: ReturnType<typeof validateTokenList>, code: LockProblem['code']) =>
  result.ok ? undefined : result.problems.find((p) => p.code === code)
const strict = { allowDuplicates: false }

describe('validateTokenList', () => {
  it('accepts a generated set', () => {
    expect(validateTokenList(project, good, strict)).toEqual({ ok: true })
  })

  it('reports ids that are not 1 to N', () => {
    const result = validateTokenList(project, good.map((t) => (t.id === 3 ? { ...t, id: 99 } : t)), strict)
    expect(codes(result)).toContain('ids')
    expect(problem(result, 'ids')!.message).toMatch(/1 to 16/)
  })

  it('reports a collection off its size', () => {
    const result = validateTokenList(project, good.slice(0, 15), strict)
    expect(codes(result)).toContain('size')
    expect(problem(result, 'size')!.message).toMatch(/Owlets has 3 tokens, not 4/)
  })

  it('reports an unknown collection, a wrong DNA length and a trait outside its layer', () => {
    const bad = good.map((t) =>
      t.id === 1 ? { ...t, collectionId: 'ghosts' } : t.id === 2 ? { ...t, dna: t.dna.slice(0, 2) } : t.id === 3 ? { ...t, dna: ['body-barn', ...t.dna.slice(1)] } : t,
    )
    const result = validateTokenList(project, bad, strict)
    expect(codes(result)).toEqual(expect.arrayContaining(['collection', 'dna-length', 'trait']))
    expect(problem(result, 'collection')!.tokenIds).toEqual([1])
    expect(problem(result, 'dna-length')!.tokenIds).toEqual([2])
    expect(problem(result, 'trait')!.tokenIds).toEqual([3])
  })

  it('reports a trait from another collection\'s copy of the same layer as a wrong trait', () => {
    // Owlets have a Body layer too; its trait ids are not the owls' trait ids.
    const result = validateTokenList(project, good.map((t) => (t.id === 1 ? { ...t, dna: [t.dna[0]!, 'ob-1', t.dna[2]!, t.dna[3]!] } : t)), strict)
    expect(codes(result)).toEqual(['trait'])
  })

  it('reports a token that breaks an active rule or a constraint', () => {
    const broken = good.map((t) => (t.id === 1 ? { ...t, dna: ['bg-ink', 'body-barn', 'eyes-sleepy', 'acc-hat'] } : t))
    const result = validateTokenList(project, broken, strict)
    expect(codes(result)).toContain('rule')
    expect(problem(result, 'rule')!.message).toMatch(/Hat doesn't mix with Sleepy/)
    const constrained = fixtureWithAtLeastOne()
    const bare = generateProject(constrained, 1).tokens.map((t) => (t.id === 1 ? { ...t, dna: [...t.dna.slice(0, 3), 'acc-none'] } : t))
    expect(codes(validateTokenList(constrained, bare, strict))).toContain('rule')
  })

  it('reports a cap exceeded', () => {
    const golden = good.map((t) => (t.collectionId === 'owls' ? { ...t, dna: ['bg-ink', t.dna[1]!, 'eyes-gold', t.dna[3]!] } : t))
    const result = validateTokenList(project, golden, { allowDuplicates: true })
    expect(codes(result)).toContain('cap')
    expect(problem(result, 'cap')!.message).toMatch(/Gold is on \d+ tokens, more than its cap of 3/)
  })

  it('reports duplicates unless identical tokens are allowed (the key test in curate.test.ts covers bypass)', () => {
    // Copy one owl's DNA onto another, both without the capped Gold eyes, so only uniqueness breaks.
    const [source, target] = good.filter((t) => t.collectionId === 'owls' && !t.dna.includes('eyes-gold'))
    const twin = good.map((t) => (t.id === target!.id ? { ...t, dna: [...source!.dna] } : t))
    const result = validateTokenList(project, twin, strict)
    expect(codes(result)).toEqual(['duplicate'])
    expect(problem(result, 'duplicate')!.tokenIds).toEqual([source!.id, target!.id])
    expect(validateTokenList(project, twin, { allowDuplicates: true })).toEqual({ ok: true })
  })

  it('lists at most 20 ids and says how many more', () => {
    // Thirty tokens of a collection the project does not have, numbered on from the good set.
    const ghosts = Array.from({ length: 30 }, (_, i) => ({ id: good.length + i + 1, collectionId: 'ghosts', dna: ['x'] }))
    const result = validateTokenList(project, [...good, ...ghosts], strict)
    const found = problem(result, 'collection')!
    expect(found.tokenIds).toHaveLength(20)
    expect(found.message).toMatch(/and 10 more/)
  })

  it('does not mutate its input', () => {
    const frozen = deepFreeze(good.map((t) => ({ ...t, dna: [...t.dna] })))
    expect(() => validateTokenList(project, frozen, strict)).not.toThrow()
  })
})

describe('canonicalTokenList and hashTokenList', () => {
  const list: TokenCore[] = [
    { id: 2, collectionId: 'a', dna: ['x', 'y'] },
    { id: 1, collectionId: 'a', dna: ['x', 'z'] },
  ]
  it('sorts by id, drops extra fields and ignores delimiters inside ids', () => {
    expect(canonicalTokenList(list)).toBe('[[1,"a",["x","z"]],[2,"a",["x","y"]]]')
    const extra = list.map((t) => ({ ...t, name: 'n', rank: 1 }))
    expect(canonicalTokenList(extra)).toBe(canonicalTokenList(list))
    expect(canonicalTokenList([])).toBe('[]')
    expect(canonicalTokenList([{ id: 1, collectionId: 'a|b', dna: ['x,"y'] }])).toBe('[[1,"a|b",["x,\\"y"]]]')
  })
  it('is SHA-256 of the canonical form as 0x hex, stable across order', async () => {
    const hash = await hashTokenList(list)
    expect(hash).toBe('0x4cbbf10c7093393a05d1ec49de09f8c9cf304ede5dc74e59f22c8357e01f8115')
    expect(await hashTokenList([...list].reverse())).toBe(hash)
    expect(await hashTokenList([])).toMatch(/^0x[0-9a-f]{64}$/)
  })
})
```

- [ ] **Step 2: Run, expect failure**

Run: `pnpm --filter @cobweb/dna test`
Expected: FAIL, `Cannot find module './lock'`.

- [ ] **Step 3: Implement**

`packages/dna/src/lock.ts`:

```ts
import { countTraits, uniqueKey } from './curate'
import { buildTraitIndex, layersOf, traitName } from './index-of'
import { activeProjectRules, brokenRule, constraintsOf } from './rules'
import type { Project, TokenCore } from './types'

export type LockProblem = {
  code: 'ids' | 'size' | 'collection' | 'dna-length' | 'trait' | 'rule' | 'cap' | 'duplicate'
  message: string
  tokenIds?: number[]
}

const LISTED = 20

/** "#3, #7 and 12 more" style, for problem messages. */
function listIds(ids: number[]): string {
  const shown = ids.slice(0, LISTED).map((id) => `#${id}`)
  const more = ids.length - shown.length
  return more > 0 ? `${shown.join(', ')} and ${more.toLocaleString('en-US')} more` : shown.join(', ')
}

/**
 * Checks a token list the browser submits at lock against the project: ids 1 to N, every collection
 * at its size, every DNA well formed, every token within the active rules and constraints, no cap
 * exceeded, and unique within its collection unless identical tokens are allowed. Returns every
 * problem found, so the creator sees the whole picture.
 */
export function validateTokenList(
  project: Project,
  tokens: TokenCore[],
  options: { allowDuplicates: boolean },
): { ok: true } | { ok: false; problems: LockProblem[] } {
  const problems: LockProblem[] = []
  const index = buildTraitIndex(project.layers)
  const rules = activeProjectRules(project, index)
  const layersFor = new Map(project.collections.map((c) => [c.id, layersOf(project.layers, c.id)]))

  const sortedIds = tokens.map((t) => t.id).sort((a, b) => a - b)
  const offIds = sortedIds.filter((id, i) => id !== i + 1)
  if (offIds.length > 0)
    problems.push({
      code: 'ids',
      message: `Token ids must run from 1 to ${tokens.length.toLocaleString('en-US')} with no gaps or repeats. Off: ${listIds(offIds)}.`,
      tokenIds: offIds.slice(0, LISTED),
    })

  for (const collection of project.collections) {
    const have = tokens.filter((t) => t.collectionId === collection.id).length
    if (have !== collection.size)
      problems.push({
        code: 'size',
        message: `${collection.name} has ${have.toLocaleString('en-US')} tokens, not ${collection.size.toLocaleString('en-US')}.`,
      })
  }

  const unknownCollection: number[] = []
  const wrongLength: number[] = []
  const wrongTrait: number[] = []
  const breaking: { id: number; why: string }[] = []
  const wellFormed: TokenCore[] = []
  for (const token of tokens) {
    const own = layersFor.get(token.collectionId)
    if (!own) {
      unknownCollection.push(token.id)
      continue
    }
    if (token.dna.length !== own.length) {
      wrongLength.push(token.id)
      continue
    }
    if (!token.dna.every((traitId, i) => own[i]!.traits.some((t) => t.id === traitId))) {
      wrongTrait.push(token.id)
      continue
    }
    wellFormed.push(token)
    const why = brokenRule(token.dna, rules, index, constraintsOf(project.atLeastOne, token.collectionId))
    if (why) breaking.push({ id: token.id, why })
  }
  if (unknownCollection.length)
    problems.push({ code: 'collection', message: `${listIds(unknownCollection)} belong to a collection this project does not have.`, tokenIds: unknownCollection.slice(0, LISTED) })
  if (wrongLength.length)
    problems.push({ code: 'dna-length', message: `${listIds(wrongLength)} do not have one trait per layer of their collection.`, tokenIds: wrongLength.slice(0, LISTED) })
  if (wrongTrait.length)
    problems.push({ code: 'trait', message: `${listIds(wrongTrait)} name a trait that is not in the layer it stands for.`, tokenIds: wrongTrait.slice(0, LISTED) })
  if (breaking.length)
    problems.push({
      code: 'rule',
      message: `${listIds(breaking.map((b) => b.id))} break a rule. First: #${breaking[0]!.id}: ${breaking[0]!.why}`,
      tokenIds: breaking.map((b) => b.id).slice(0, LISTED),
    })

  const counts = countTraits(wellFormed)
  for (const layer of project.layers)
    for (const trait of layer.traits) {
      const actual = counts[trait.id] ?? 0
      if (trait.constant && actual > trait.constant)
        problems.push({
          code: 'cap',
          message: `${traitName(index, trait.id)} is on ${actual.toLocaleString('en-US')} tokens, more than its cap of ${trait.constant.toLocaleString('en-US')}.`,
        })
    }

  if (!options.allowDuplicates) {
    const seen = new Map<string, number>()
    const dupes: number[] = []
    for (const token of wellFormed) {
      const key = `${token.collectionId}:${uniqueKey(token.dna, layersFor.get(token.collectionId)!)}`
      const first = seen.get(key)
      if (first === undefined) seen.set(key, token.id)
      else dupes.push(first, token.id)
    }
    const ids = [...new Set(dupes)].sort((a, b) => a - b)
    if (ids.length)
      problems.push({
        code: 'duplicate',
        message: `${listIds(ids)} have the same traits as another token. Every token must be unique, or allow identical tokens at lock.`,
        tokenIds: ids.slice(0, LISTED),
      })
  }

  return problems.length ? { ok: false, problems } : { ok: true }
}

/** The form that is hashed: `[id, collection, dna]` triples sorted by id, as compact JSON. Names and ranks are not part of it. */
export function canonicalTokenList(tokens: TokenCore[]): string {
  const triples = [...tokens].sort((a, b) => a.id - b.id).map((t) => [t.id, t.collectionId, [...t.dna]])
  return JSON.stringify(triples)
}

/** SHA-256 of the canonical form, as `0x` plus 64 lowercase hex characters. Same list in any order, same hash. */
export async function hashTokenList(tokens: TokenCore[]): Promise<`0x${string}`> {
  const bytes = new TextEncoder().encode(canonicalTokenList(tokens))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
  return `0x${hex}`
}
```

Add `export * from './lock'` to `index.ts`.

- [ ] **Step 4: Run, expect pass; typecheck and lint the package**

Run: `pnpm --filter @cobweb/dna test && pnpm --filter @cobweb/dna typecheck && pnpm --filter @cobweb/dna lint`
Expected: PASS, no errors. If `crypto` is untyped, the root `@types/node` is not being picked up: add `"types": ["node"]` to the package tsconfig `compilerOptions`.

- [ ] **Step 5: Commit**

```bash
git add packages/dna
git commit -m "Add the lock validator and token list hash to the DNA engine"
```

### Task 9: Point the web app's data layer at the engine

**Files:**

- Modify: `apps/web/package.json` (dependencies), `apps/web/next.config.ts` (`transpilePackages`)
- Modify: `apps/web/src/lib/demo/types.ts` (art block becomes re-exports)
- Modify: `apps/web/src/lib/demo/art.ts` (generator functions removed, `DEMO_SEED` exported)
- Modify: `apps/web/src/lib/demo/data.ts` (`DEMO_TOKENS` built from the engine)
- Modify: `apps/web/src/lib/demo/index.ts`
- Modify: `apps/web/scripts/make-demo-art.mjs` (imports the engine)
- Modify: `apps/web/src/components/art/generate/stats-view.tsx`, `apps/web/src/components/art/layers-screen.tsx`, `apps/web/src/components/art/layers/use-layers-editor.ts`, `apps/web/src/components/upload/upload-screen.tsx` (imports)
- Delete: `apps/web/src/lib/demo/art.test.ts` (its cases moved to `rank.test.ts` in Task 7)
- Test: `apps/web/src/lib/demo/data.test.ts` (append a pin of the sample DNA)

**Interfaces:**

- Consumes: the whole package through `@cobweb/dna`.
- Produces: `GeneratedToken = Ranked<TokenCore> & { name: string; description?: string; previewUrl: string | null }` in `types.ts`; `DEMO_SEED` from `art.ts`; `DEMO_TOKENS`, `DEMO_TRAIT_COUNTS` unchanged in shape. The web still exports `tokenLayerUrls`, `getTrait`, `slugify`, `DEMO_RULE_CONFLICTS`, `DEMO_PREVIEW_COUNT` from `@/lib/demo`.

- [ ] **Step 1: Pin the sample DNA before anything moves**

The sample art (24 pre-rendered token SVGs) depends on the exact DNA the generator rolls. Record it first. Append to `apps/web/src/lib/demo/data.test.ts`:

```ts
import { DEMO_TOKENS } from '@/lib/demo'

describe('sample tokens', () => {
  it('roll the same DNA as the pre-rendered art (tokens 1 and 601)', () => {
    expect(DEMO_TOKENS[0]!.dna).toEqual(['REPLACE'])
    expect(DEMO_TOKENS[600]!.dna).toEqual(['REPLACE'])
    expect(DEMO_TOKENS).toHaveLength(777)
  })
})
```

Run: `pnpm --filter @cobweb/web test -- data.test.ts`
Expected: FAIL; the assertion output prints the actual arrays. Paste them over `['REPLACE']`, re-run, expect PASS. Commit this pin on its own:

```bash
git add apps/web/src/lib/demo/data.test.ts
git commit -m "Pin the sample tokens' DNA before the engine moves"
```

- [ ] **Step 2: Add the dependency**

In `apps/web/package.json` dependencies add `"@cobweb/dna": "workspace:^"` next to `@cobweb/ui`. In `apps/web/next.config.ts` change `transpilePackages: ['@cobweb/ui']` to `transpilePackages: ['@cobweb/ui', '@cobweb/dna']` and update the comment to "The UI and DNA packages ship TypeScript source". Run `pnpm install`.

- [ ] **Step 3: Re-export the art types**

In `apps/web/src/lib/demo/types.ts`, replace everything from the `// Art (Phase 3: art generator)` banner down to and including the `TraitCounts` type with:

```ts
// ---------------------------------------------------------------------------------------------
// Art (Phase 3: art generator). The shapes live in `@cobweb/dna`; the screens import them from here.
// ---------------------------------------------------------------------------------------------

export type {
  ArtRule,
  AtLeastOne,
  Collection,
  Layer,
  Project,
  Ranked,
  RuleConflict,
  RuleKind,
  TokenCore,
  Trait,
  TraitCounts,
} from '@cobweb/dna'
import type { Ranked, TokenCore } from '@cobweb/dna'

/**
 * One generated token as the screens show it: the engine's core (id, collection, DNA) with its rank,
 * plus the name chosen at Generate, an optional description and a pre-rendered preview for the
 * first sample tokens (null: stack `tokenLayerUrls` instead).
 */
export type GeneratedToken = Ranked<TokenCore> & {
  /** "<token name> #<id>", the token name chosen at Generate (legacy auto-populate). */
  name: string
  /** The metadata description: the one chosen at Generate, or this token's own after an edit. */
  description?: string
  previewUrl: string | null
}
```

Keep `MediaType` and `UploadedAsset` and everything after them as they are.

- [ ] **Step 4: Trim `art.ts` to data**

In `apps/web/src/lib/demo/art.ts`:

- Change `const SEED = 0x0a7115` to `export const DEMO_SEED = 0x0a7115`.
- Delete `seededRandom`, `pickWeighted`, `satisfiesRules`, `MAX_ATTEMPTS`, `repairPairs`, `generateTokens`, `collectionSeed`, `generateCollections`, `countTraits`, `cappedShortfalls`, `attributeKey`, `rankTokens` and `demoAttributeKey` (everything from the `seededRandom` doc comment through the end of `rankTokens`, and the `demoAttributeKey` function below `LAYER_NAMES`).
- Keep `DEMO_COLLECTIONS`, `DEMO_TOKEN_COUNT`, `DEMO_PREVIEW_COUNT`, the specs, `slugify`, `buildLayers`, `DEMO_LAYERS`, `DEMO_RULES`, `DEMO_RULE_CONFLICTS`, `TRAITS_BY_ID`, `LAYER_NAMES` (delete it too if nothing uses it), `getTrait`, `tokenLayerUrls`.
- Fix the type import to only what remains: `import type { ArtRule, Collection, Layer, RuleConflict, Trait } from './types'`.
- The file still has no runtime imports; keep the header comment's promise true.

- [ ] **Step 5: Build the sample tokens from the engine**

In `apps/web/src/lib/demo/data.ts`, change the imports from `./art` to drop `countTraits, generateCollections, rankTokens, seededRandom` and add `DEMO_SEED`; add

```ts
import { attributeKeyOf, buildTraitIndex, countTraits, generateProject, rankTokens, seededRandom } from '@cobweb/dna'
```

Replace the `DEMO_TOKENS` definition with:

```ts
/**
 * The generated set, ranked: the owls are 1 to 600, the owlets 601 to 777. Tokens 1 to 24 have a
 * `previewUrl`; stack `tokenLayerUrls(dna)` for the rest. Same seed as `scripts/make-demo-art.mjs`.
 */
export const DEMO_TOKENS: GeneratedToken[] = rankTokens(
  generateProject({ layers: DEMO_LAYERS, rules: DEMO_RULES, collections: DEMO_COLLECTIONS }, DEMO_SEED).tokens.map(
    (token) => ({ ...token, name: `${DEMO_COLLECTION.name} #${token.id}` }),
  ),
  attributeKeyOf(buildTraitIndex(DEMO_LAYERS)),
).map((token) => ({ ...token, previewUrl: token.id <= DEMO_PREVIEW_COUNT ? `/demo/tokens/${token.id}.svg` : null }))
```

`DEMO_COLLECTION.name` is "Night Owls", which is what `generateTokens` hard-coded before. Import `DEMO_PREVIEW_COUNT` from `./art`. Everywhere else in `data.ts` that used `seededRandom` keeps working through the new import.

In `apps/web/src/lib/demo/index.ts` nothing changes: `export * from './art'` no longer carries the generator functions, which is the point.

- [ ] **Step 6: Re-point the other consumers**

- `apps/web/src/components/art/generate/stats-view.tsx`: `import { cappedShortfalls } from '@cobweb/dna'`.
- `apps/web/src/components/art/layers-screen.tsx`: `import { satisfiesRules, seededRandom } from '@cobweb/dna'`.
- `apps/web/src/components/art/layers/use-layers-editor.ts`: `import { countTraits } from '@cobweb/dna'`.
- `apps/web/src/components/upload/upload-screen.tsx`: remove `satisfiesRules` from the `@/lib/demo` import and add `import { satisfiesRules } from '@cobweb/dna'`.
- `apps/web/scripts/make-demo-art.mjs`: replace `generateCollections` in the import list with `DEMO_SEED`; add `import { generateProject } from '../../../packages/dna/src/index.ts'`; change line 400 to `const tokens = generateProject({ layers: DEMO_LAYERS, rules: DEMO_RULES, collections: DEMO_COLLECTIONS }, DEMO_SEED).tokens`. Run `node apps/web/scripts/make-demo-art.mjs` and check `git status` shows no change under `apps/web/public/demo/` (same DNA, same pictures). If it does show changes, the generator's `random()` call order drifted: fix the engine, never the pictures.
- Delete `apps/web/src/lib/demo/art.test.ts`.

- [ ] **Step 7: Typecheck the web app**

Run: `pnpm --filter @cobweb/web typecheck`
Expected: errors only in `components/art/state/*.ts` and `components/art/lib/trait-index.ts`, which still import the deleted functions from `@/lib/demo/art`. Task 10 fixes those. If anything else fails, fix it here.

- [ ] **Step 8: Commit**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "Build the sample tokens with the DNA engine"
```

### Task 10: Keep the Art state modules as thin wrappers

**Files:**

- Modify: `apps/web/src/components/art/lib/trait-index.ts`
- Modify: `apps/web/src/components/art/state/rule-logic.ts`
- Modify: `apps/web/src/components/art/state/generation.ts`
- Modify: `apps/web/src/components/art/state/token-logic.ts`
- Modify: `apps/web/src/components/art/state/layer-edits.ts` (`pruneRules`, `rulesTouching` become re-exports)
- Modify: `apps/web/src/components/art/generate/use-generator.ts` (one line: the set context carries `layers`)
- Modify: `apps/web/src/components/art/state/generation.test.ts` (trimmed to the app-side cases)
- Create: `apps/web/src/components/art/state/token-logic.test.ts`
- Delete: `apps/web/src/components/art/state/rule-logic.test.ts` (covered by the package tests from Task 3)

**Interfaces:**

- Consumes: everything the package exports.
- Produces: the same export names and signatures the screens import today, so no screen file changes. Key ones: `generateSet(layers, rules, collections, seed, ctx, description): GenerateOutcome`, `regenerate(tokens, ids, layers, rules, ctx): GeneratedToken[] | null`, `fillTo(tokens, collections, layers, rules, ctx, description): GeneratedToken[] | null`, `changeTrait(tokens, tokenId, layerIndex, traitId, rules, ctx): ChangeOutcome`, `swapIds(tokens, a, b, ctx)`, `deleteTokens(tokens, ids, ctx)`, `shuffleIds(tokens, ids, ctx)`, `tokenAttributes(token, layers, index, showBlankTraits)`.

- [ ] **Step 1: `trait-index.ts`**

Replace the file's body with the app-side helpers plus re-exports:

```ts
import type { TraitIndex } from '@cobweb/dna'

export {
  attributeCounts,
  attributeKeyOf,
  buildTraitIndex,
  constantTotal,
  expectedCount,
  joinOr,
  roundWeight,
  traitName,
  WEIGHT_TOTAL_MAX,
  weightedTraits,
  weightsValid,
  weightTotal,
  type TraitEntry,
  type TraitIndex,
} from '@cobweb/dna'

/** The images to stack for a DNA, bottom first. Blanks, hidden layers and unknown ids are left out. */
export function compositeUrls(dna: string[], index: TraitIndex, hiddenLayers?: ReadonlySet<string>): string[] {
  return dna.flatMap((traitId) => {
    const entry = index.get(traitId)
    if (!entry || !entry.trait.imageUrl) return []
    if (hiddenLayers?.has(entry.layer.id)) return []
    return [entry.trait.imageUrl]
  })
}

/** "12.5%" style, at most two decimals. */
export function formatPercent(value: number): string {
  return `${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}%`
}

export function formatCount(value: number): string {
  return Math.round(value).toLocaleString('en-US')
}
```

- [ ] **Step 2: `rule-logic.ts`**

Keep `RULE_KINDS` and `ruleSentence` (they import `joinOr`, `traitName` and `TraitIndex` from `../lib/trait-index`, unchanged). Delete `isBidirectional`, `overlaps`, `findDuplicate`, `mixBlocker`, `analyseRules`, `conflictKey`, `chainConflicts`, `activeRules`, `brokenRule`, and add:

```ts
export { activeRules, analyseRules, brokenRule, findDuplicate, isBidirectional } from '@cobweb/dna'
```

- [ ] **Step 3: `layer-edits.ts`**

Delete `pruneRules` and `rulesTouching` and add `export { pruneRules, rulesTouching } from '@cobweb/dna'`. Keep `layersOf` and every editing function.

- [ ] **Step 4: `generation.ts`**

Replace the file with:

```ts
import {
  fillTo as fillToWith,
  generateProject,
  generationProblems as projectProblems,
  MAX_ATTEMPTS,
  newSeed,
  rankTokens,
  regenerate as regenerateWith,
  type Project,
} from '@cobweb/dna'
import type { ArtRule, Collection, GeneratedToken, Layer } from '@/lib/demo'
import { attributeKeyOf, type TraitIndex } from '../lib/trait-index'

/**
 * Generating the set the way the legacy auto-populate did, on the engine in `@cobweb/dna`: one size
 * per collection, a token name and description, ids running on across collections, and a clear
 * "can only generate X" when the rules and traits run out. This module adds the naming and ranking
 * the screens expect; the engine does the rolling.
 */

export { dnaKey, MAX_COLLECTION_SIZE, newSeed } from '@cobweb/dna'

export type Draft = Omit<GeneratedToken, 'rank' | 'previewUrl'>

/**
 * What names and ranks depend on: the token name chosen at Generate and the current layers. `layers`
 * is the project's layer list; when given, trait changes check layer membership against it rather
 * than rebuilding it from the index (which cannot see a layer with no traits).
 */
export type SetContext = { tokenName: string; index: TraitIndex; layers?: Layer[] }

/** Characters the legacy tool refused in a token name: `#` marks the id, quotes broke its metadata. */
const NAME_FORBIDDEN = /[#'"`]/

/** Why a token name cannot be used, worded for the creator, or null. */
export function tokenNameProblem(name: string): string | null {
  if (!name.trim()) return 'Enter a token name.'
  if (NAME_FORBIDDEN.test(name)) return 'A token name cannot contain #, quotes or backticks.'
  return null
}

/** Ranks the set (1 is rarest) and names every token "<token name> #<id>". */
export function finalise(tokens: Draft[], ctx: SetContext): GeneratedToken[] {
  const sorted = [...tokens].sort((a, b) => a.id - b.id)
  return rankTokens(sorted, attributeKeyOf(ctx.index)).map((token) => ({
    ...token,
    name: `${ctx.tokenName.trim()} #${token.id}`,
    previewUrl: null,
  }))
}

/** Problems that stop a full generation, worded for the creator. */
export function generationProblems(layers: Layer[], collections: Collection[]): string[] {
  return projectProblems({ layers, rules: [], collections })
}

export type GenerateOutcome = { ok: true; tokens: GeneratedToken[] } | { ok: false; problems: string[] }

/**
 * Generates every collection to its size. A collection that runs out of unique combinations within
 * the rules stops, and the creator is told how many it can make. Nothing is replaced unless every
 * collection is full.
 */
export function generateSet(
  layers: Layer[],
  rules: ArtRule[],
  collections: Collection[],
  seed: number,
  ctx: SetContext,
  description: string,
): GenerateOutcome {
  const problems = generationProblems(layers, collections)
  if (problems.length) return { ok: false, problems }
  const project: Project = { layers, rules, collections }
  const { tokens, made } = generateProject(project, seed)
  const short = made
    .filter((m) => m.made < m.wanted)
    .map((m) => {
      const name = collections.find((c) => c.id === m.collectionId)?.name ?? m.collectionId
      return `${collections.length > 1 ? `${name}: only` : 'Only'} ${m.made.toLocaleString('en-US')} of ${m.wanted.toLocaleString('en-US')} tokens can be made unique within the rules (no new combination after ${MAX_ATTEMPTS.toLocaleString('en-US')} tries). Lower the size to ${m.made.toLocaleString('en-US')}, add traits, or loosen a rule.`
    })
  if (short.length) return { ok: false, problems: short }
  return { ok: true, tokens: finalise(tokens.map((token) => ({ ...token, name: '', description })), ctx) }
}

/** Re-rolls the chosen tokens, keeping ids, names, descriptions and collections. All or nothing. */
export function regenerate(
  tokens: GeneratedToken[],
  ids: ReadonlySet<number>,
  layers: Layer[],
  rules: ArtRule[],
  ctx: SetContext,
): GeneratedToken[] | null {
  const next = regenerateWith(tokens, ids, { layers, rules }, newSeed())
  return next && finalise(next, ctx)
}

/** Brings every collection up to its size; new tokens go after the last id. */
export function fillTo(
  tokens: GeneratedToken[],
  collections: Collection[],
  layers: Layer[],
  rules: ArtRule[],
  ctx: SetContext,
  description: string,
): GeneratedToken[] | null {
  const next = fillToWith(tokens, { layers, rules, collections }, newSeed(), (id, collectionId, dna) => ({
    id,
    collectionId,
    dna,
    name: '',
    description,
    rank: 0,
    previewUrl: null,
  }))
  return next && finalise(next, ctx)
}
```

`MAX_COLLECTION_SIZE` and `dnaKey` are re-exported without being imported, which is what the screens need.

- [ ] **Step 5: `token-logic.ts`**

Replace the file with:

```ts
import {
  changeTrait as changeTraitWith,
  deleteTokens as deleteTokensWith,
  newSeed,
  shuffleIds as shuffleIdsWith,
  swapIds as swapIdsWith,
  tokenAttributes as attributesWith,
  type Layer as EngineLayer,
} from '@cobweb/dna'
import type { ArtRule, GeneratedToken, Layer } from '@/lib/demo'
import { finalise, type SetContext } from './generation'

/**
 * Curation of the generated set on the engine in `@cobweb/dna`: changing a token's trait, its
 * description, swapping, deleting and shuffling ids, and a token's metadata attributes. This module
 * re-ranks and renames after each change; the engine does the checks.
 */

export { finalise, newSeed, type SetContext }
export {
  countByCollection,
  countTraits,
  rarityTier,
  TIER_RANGES,
  tokensBreakingRules,
  type RarityTier,
} from '@cobweb/dna'

export type ChangeOutcome = { ok: true; tokens: GeneratedToken[] } | { ok: false; reason: string }

/** The layers behind an index, in list order. A fallback: a layer with no traits is not in the index. */
function layersOfIndex(index: SetContext['index']): EngineLayer[] {
  const byId = new Map<string, { layer: EngineLayer; at: number }>()
  for (const entry of index.values()) byId.set(entry.layer.id, { layer: entry.layer, at: entry.layerIndex })
  return [...byId.values()].sort((a, b) => a.at - b.at).map((e) => e.layer)
}

/**
 * Sets one layer of one token to another trait, if the result is allowed: within its maximum count,
 * within the rules and unique in its collection. `layerIndex` is in the token's collection.
 */
export function changeTrait(
  tokens: GeneratedToken[],
  tokenId: number,
  layerIndex: number,
  traitId: string,
  rules: ArtRule[],
  ctx: SetContext,
): ChangeOutcome {
  const layers = ctx.layers ?? layersOfIndex(ctx.index)
  const result = changeTraitWith(tokens, tokenId, layerIndex, traitId, { layers, rules }, ctx.index)
  return result.ok ? { ok: true, tokens: finalise(result.tokens, ctx) } : result
}

/** Sets one token's metadata description. Ranks and names do not change. */
export function setDescription(tokens: GeneratedToken[], tokenId: number, description: string) {
  return tokens.map((t) => (t.id === tokenId ? { ...t, description } : t))
}

/** Renames every token "<token name> #<id>" and re-ranks against the current layers. */
export function renameTokens(tokens: GeneratedToken[], ctx: SetContext) {
  return finalise(tokens, ctx)
}

/** Swaps the ids of two tokens. Their traits stay with them. */
export function swapIds(tokens: GeneratedToken[], a: number, b: number, ctx: SetContext) {
  return finalise(swapIdsWith(tokens, a, b), ctx)
}

/** Deletes tokens and closes the gaps, so ids stay 1 to N. */
export function deleteTokens(tokens: GeneratedToken[], ids: ReadonlySet<number>, ctx: SetContext) {
  return finalise(deleteTokensWith(tokens, ids), ctx)
}

/** Shuffles the ids among the chosen tokens. */
export function shuffleIds(tokens: GeneratedToken[], ids: ReadonlySet<number>, ctx: SetContext) {
  return finalise(shuffleIdsWith(tokens, ids, newSeed()), ctx)
}

/** A token's metadata attributes, bottom layer first; blanks only when the project option is on. */
export function tokenAttributes(
  token: Pick<GeneratedToken, 'dna'>,
  layers: Layer[],
  index: SetContext['index'],
  showBlankTraits: boolean,
): { trait_type: string; value: string }[] {
  return attributesWith(token, layers, index, { showBlankTraits })
}

/**
 * Whether a token matches the gallery search: a number matches ids that start with it, and text
 * matches a layer or trait name of the token, ignoring case.
 */
export function matchesSearch(token: GeneratedToken, search: string, index: SetContext['index']): boolean {
  const query = search.trim().toLowerCase()
  if (!query) return true
  if (/^#?\d+$/.test(query)) return String(token.id).startsWith(query.replace('#', ''))
  return token.dna.some((traitId) => {
    const entry = index.get(traitId)
    return (
      !!entry &&
      (entry.trait.name.toLowerCase().includes(query) || entry.layer.name.toLowerCase().includes(query))
    )
  })
}
```

- [ ] **Step 6: Trim the moved tests, keep the app-side ones, run everything**

Delete `rule-logic.test.ts` under `components/art/state/` (the analyser tests live in the package now). Replace `generation.test.ts` with only the three app-side cases, taken from its current content: the token naming across collections ("Night Owls #1", "#601" in the owlets collection, the description on every token), `tokenNameProblem` refusing `#`, quotes and backticks, and the short-set wording (`/Only 3 of 4 tokens/` and `/10,000 tries/`) on the two-layer tiny project. Drop the cap and deleted-layer cases, which the package covers.

In `apps/web/src/components/art/generate/use-generator.ts` change `const ctx: SetContext = { tokenName, index }` to `const ctx: SetContext = { tokenName, index, layers }` (the hook already holds `layers`). Add `apps/web/src/components/art/state/token-logic.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { DEMO_LAYERS } from '@/lib/demo'
import type { Layer } from '@/lib/demo'
import { buildTraitIndex } from '../lib/trait-index'
import { layersOf } from './layer-edits'
import { changeTrait } from './token-logic'

describe('changeTrait with an empty layer in the stack', () => {
  const owls = layersOf(DEMO_LAYERS, 'owls')
  // An empty layer under the top one: it has no traits, so the trait index knows nothing about it.
  const empty: Layer = { id: 'empty', collectionId: 'owls', name: 'Empty', position: owls.length - 1, traits: [] }
  const layers = [...owls.slice(0, -1), empty, { ...owls[owls.length - 1]!, position: owls.length }]
  const top = layers[layers.length - 1]!
  const token = {
    id: 1,
    collectionId: 'owls',
    dna: layers.map((layer) => layer.traits[0]?.id ?? ''),
    name: 'Owl #1',
    rank: 1,
    previewUrl: null,
  }
  const other = top.traits.find((t) => t.id !== token.dna[layers.length - 1])!

  it('still accepts a change on the top layer when the context carries the real layers', () => {
    const ctx = { tokenName: 'Owl', index: buildTraitIndex(layers), layers }
    const result = changeTrait([token], 1, layers.length - 1, other.id, [], ctx)
    expect(result.ok).toBe(true)
  })

  it('cannot tell without them: the rebuilt list skips the empty layer', () => {
    const ctx = { tokenName: 'Owl', index: buildTraitIndex(layers) }
    expect(changeTrait([token], 1, layers.length - 1, other.id, [], ctx)).toEqual({
      ok: false,
      reason: 'That trait belongs to another layer.',
    })
  })
})
```

The second case documents the fallback's limit; the first is the behaviour the screens get, since the hook passes `layers`. Then:

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS at the root (web, dna, ui, shared). The pin from Task 9 step 1 passes, proving the sample DNA did not move. If `layer-edits.test.ts` fails on `pruneRules`, the re-export is wrong; fix the export, not the test.

- [ ] **Step 7: Walk the screens once**

Run `supabase start`, `node apps/web/scripts/dev-wallet/signer.mjs` and `pnpm --filter @cobweb/web dev`; sign in with the dev wallet, create a generative collection and open Layers, Rules and Generate. Generate the set, change a trait to break a rule (expect the refusal), swap two ids, regenerate a selection, open the statistics tab. Everything reads as before; only tier badges may differ. Stop the services.

- [ ] **Step 8: Commit**

```bash
git add apps/web
git commit -m "Run the Art screens on the DNA engine"
```

### Task 11: Documents and acceptance

**Files:**

- Modify: `docs/specs/2026-10-03-creator-flow-ui.md` (section 5 table)
- Modify: `docs/MASTER_PLAN.md` (Phase 3 status)
- Modify: `docs/specs/2026-10-07-dna-engine.md` (acceptance ticks)

- [ ] **Step 1: Creator flow spec, section 5**

In the table, change the Phase 3 row's "Replaced by" cell to: `` `@cobweb/dna` types and analyser (done); the art tables and the token list submitted and validated at lock with `validateTokenList` and hashed with `hashTokenList` ``. In the `RenderJob` row, after "the quote written at lock from `artFeePerToken()`", add ", the token list hash from `hashTokenList`".

- [ ] **Step 2: Master plan**

Under Phase 3, change `**Status:** not started.` to `**Status:** in progress. The DNA engine (first sub-project) landed on <date>; see its spec. Next: the art tables.` Replace `<date>` with today's date in words.

- [ ] **Step 3: Tick the acceptance criteria**

In `docs/specs/2026-10-07-dna-engine.md` section 6, tick each line you verified: the purity test (dependencies), the determinism test and the hash test (same value in Node; the browser value was checked by running `pnpm --filter @cobweb/web test`, whose vitest environment is Node too, so note "browser check deferred to the screen wiring sub-project" on that line if no browser run was done), the deep-frozen fixture, the screen walk, the eight codes, the root commands, and the spec update.

- [ ] **Step 4: Format and commit**

```bash
pnpm exec prettier --write docs/specs/2026-10-03-creator-flow-ui.md docs/MASTER_PLAN.md docs/specs/2026-10-07-dna-engine.md
git add docs
git commit -m "Record the DNA engine in the specs and the master plan"
```
