# Render Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `services/render` into `@cobweb/render`, a pure library that turns a locked token list and its layer images into the bytes that get pinned: composited PNGs, metadata JSON, CARs with their CIDs computed locally, the placeholder pair and a preview collage, giving the same bytes and CIDs on every run.

**Architecture:** Plain data in, bytes and CIDs out; no AWS, Supabase, network, clock or environment access. `png.ts` pins sharp (no cache, one thread, fixed PNG settings) and `composite.ts` stacks raw sRGBA layers with sharp; `metadata.ts` writes JSON in a fixed key order, using `tokenAttributes` from `@cobweb/dna` through `generative.ts`; `car.ts` packs a UnixFS directory with `@ipld/unixfs` (raw leaves, 1 MiB chunks, HAMT above 262,144 bytes) into a CARv1 with `@ipld/car`. `batch.ts`, `metadata-set.ts`, `placeholder.ts` and `collage.ts` compose those pieces into the five calls the worker (third sub-project) makes, and every refusal is a thrown `RenderProblem`.

**Tech Stack:** Node 22 or later (the repo runs Node 26), ESM, TypeScript strict, sharp 0.35.5 (libvips 8.18.7), @ipld/unixfs 3.0.0, @ipld/car 5.4.7, multiformats 14.0.5, `@cobweb/dna` (workspace), Vitest 5 in the Node environment.

**Spec:** [../specs/2026-10-11-render-core.md](../specs/2026-10-11-render-core.md)

## Global Constraints

- The spec is the binding authority. Where this plan decides a detail the spec leaves open, the task says so in a line that starts with "Decision:".
- The library is pure: no `Date`, `process.env`, `fetch`, `fs` (or any other file, network, clock or environment access) anywhere in `services/render/src` outside test files. Task 8 adds a test that enforces it.
- Exact pins, no caret: `sharp` `0.35.5`, `@ipld/unixfs` `3.0.0`, `@ipld/car` `5.4.7`, and `multiformats` `14.0.5`; `@cobweb/dna` is `workspace:*`. A version bump is a deliberate change: old CIDs stay valid, new jobs get new CIDs.
- `sharp.cache(false)` and `sharp.concurrency(1)` at module load (in `png.ts`); PNG output is always `{ compressionLevel: 9, adaptiveFiltering: false, palette: false }` with `effort` at the default; `withMetadata` is never called.
- Metadata JSON: key order `name`, `description`, `image`, `attributes`, then extra fields in the order given; two space indent, UTF-8, no trailing newline; no date or other clock value.
- CARs: UnixFS, CIDv1, sha2-256, raw leaves, fixed 1,048,576 byte chunks, files sorted by name bytes, duplicate names refused, plain directory unless its block would exceed 262,144 bytes, then HAMT (fanout 256, murmur3-x64-64). One root per CAR; `cid` is base32; `size` is the CAR length.
- Every refusal is a thrown `RenderProblem` with one of the nine codes of spec section 11; messages are plain sentences. Any failure inside a batch rejects the whole call; no partial output, and no per-image error is swallowed.
- Node environment, no jsdom. Fixtures are drawn in the tests with sharp; no binary fixture is committed.
- Code style: Prettier (no semicolons, single quotes, trailing commas, 110 columns), TypeScript strict with `noUncheckedIndexedAccess` and `verbatimModuleSyntax` (type-only imports use `import type`), ESM. No em or en dashes anywhere, code comments included. Copy is plain sentences; "Whitelist" never "Allowlist"; the product is Cobweb.
- `legacy/` is reference only: never import from it.
- Implementers never use `rm` and never use `git commit --amend`. To fix a commit, make a new one.
- Commit messages are one imperative sentence with no prefix, and end with exactly these two lines:

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bcHX4HZG5YGWhxjGuiWos
```

- Tests: `pnpm --filter @cobweb/render exec vitest run src/<file>.test.ts` for one file; `pnpm typecheck && pnpm lint && pnpm test` at the root before every commit.

## Review Focus

Inputs the spec implies but its test list would not exercise, most likely to bite first. Each is pinned to the task that owns it, with its test written there.

1. A layer opacity outside 0 to 1 (a percent stored by mistake, a bad migration default, NaN): `Math.round(1.5 * 255)` is 382, which a byte array silently wraps to 126, so the layer renders half transparent. Expected: values above 1 render fully opaque, below 0 fully transparent, NaN fully opaque. Pinned by "clamps an opacity outside 0 to 1" in Task 2, step 1.
2. Layer PNGs that are greyscale, 16-bit or palette based (all common exports from art tools): composited as raw buffers they could carry 2 channels or 16-bit samples and scramble the image. Expected: each renders its true colour. Pinned by "composites greyscale, 16-bit and palette PNG layers" in Task 2, step 1.
3. An extra metadata field whose key looks like a number (`"2024"`): an object literal puts integer-like keys first, so `JSON.stringify` would write it before `name` and break the fixed order. Expected: it comes after `attributes`. Pinned by "keeps an integer-like extra key after attributes" in Task 3, step 1.
4. A DNA that names a trait from another layer, has the wrong length, or names a collection the job lacks: `tokenAttributes` alone silently drops an unknown id, so the metadata set would publish short attributes for a token the batch refuses. Expected: `bad-dna` naming the token in both places. Pinned by the `resolveTraits` test in Task 3, step 1 and "refuses a DNA naming an unknown trait instead of writing short attributes" in Task 6, step 1.
5. One token failing while others are still compositing, and a token list with the same id twice: an early rejection would leave sharp work running after the call settled, and a repeated id would pack two files under one name. Expected: the call waits for in-flight work, starts nothing new, then rejects with the first failure; a repeated id is `duplicate-name`. Pinned by the `mapLimit` failure test and "refuses two tokens with the same id" in Task 5, step 1.

## File map

| Path                                                            | Task | Responsibility                                                                        |
| --------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------- |
| `services/render/package.json`, `tsconfig.json`                 | 1    | The `@cobweb/render` package, exact pins, Node types                                  |
| `services/render/src/types.ts`                                  | 1    | The input model of spec section 5, verbatim                                           |
| `services/render/src/problems.ts`                               | 1    | `RenderProblem`, `RenderProblemCode`, `forToken`, `reasonOf`                          |
| `services/render/src/index.ts`                                  | 1-7  | The public surface, grown task by task                                                |
| `services/render/src/png.ts`                                    | 2    | sharp pinned at load, `PNG_OPTIONS`, `TRANSPARENT`, `setConcurrency`, `bytesOf`       |
| `services/render/src/composite.ts`                              | 2    | `compositeToken`                                                                      |
| `services/render/src/fixtures.ts`                               | 2-5  | Test helpers: drawn images, pixel and chunk readers, the owl spec, CAR reader, loader |
| `services/render/src/metadata.ts`                               | 3    | `RESERVED_KEYS`, `SHARED_METADATA_FILE`, `assertExtraFields`, the two JSON writers    |
| `services/render/src/generative.ts`                             | 3    | `isGenerativeToken`, `batchOf`, `resolveTraits`, `attributesFor`                      |
| `services/render/src/car.ts`                                    | 4    | `PackedDirectory`, `SHARD_THRESHOLD`, `needsShard`, `packDirectory`                   |
| `services/render/src/pool.ts`                                   | 5    | `mapLimit`                                                                            |
| `services/render/src/batch.ts`                                  | 5    | `RenderedBatch`, `renderBatch`                                                        |
| `services/render/src/metadata-set.ts`                           | 6    | `RenderedMetadata`, `renderMetadataSet`                                               |
| `services/render/src/placeholder.ts`                            | 6    | `renderPlaceholder`                                                                   |
| `services/render/src/collage.ts`                                | 7    | `previewCollage`                                                                      |
| `services/render/src/render.e2e.test.ts`, `purity.test.ts`      | 8    | The 300 token run twice in fresh module instances; the purity check                   |
| `docs/MASTER_PLAN.md`, `CLAUDE.md`, the spec's acceptance boxes | 8    | Phase 4 status line appended, the test command, ticks                                 |

---

### Task 1: The package, the input types and `RenderProblem`

**Files:**

- Modify: `services/render/package.json`, `services/render/tsconfig.json`, `services/render/src/index.ts`, `pnpm-lock.yaml` (by `pnpm install`)
- Create: `services/render/src/types.ts`, `services/render/src/problems.ts`
- Test: `services/render/src/problems.test.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: every type of spec section 5 (`ProjectKind`, `ImageRef`, `RenderTrait`, `RenderLayer`, `RenderArtCollection`, `GenerativeToken`, `AssetToken`, `MetadataText`, `GenerativeSpec`, `AssetSpec`, `PlaceholderSpec`, `RenderSpec`, `LoadImage`) from `./types`; from `./problems`: `type RenderProblemCode`, `class RenderProblem extends Error { code; tokenId?; detail? }` constructed as `new RenderProblem(code, message, { tokenId?, detail? })`, `forToken(problem: RenderProblem, tokenId: number): RenderProblem` (prefixes `Token <id>: ` and sets `tokenId` unless one is set) and `reasonOf(error: unknown): string`.

Decision: `multiformats` is pinned exactly too (spec section 4 only requires it as a dependency); the CID string encoding comes from it. `@ipld/unixfs` 3.0.0 brings its own `multiformats` 13 underneath; that is expected, and Task 4 converts CIDs between the two by their bytes.

Decision: spec section 4 says `vitest` "as the other packages"; no package declares it today (the root has `vitest` `^5.0.3` and `@types/node` `^26.6.4`), so this package declares both with the root's specifiers, which pnpm resolves to the same copies.

- [ ] **Step 1: Make the package real and install**

Replace `services/render/package.json` with:

```json
{
  "name": "@cobweb/render",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "test": "vitest run"
  },
  "dependencies": {
    "@cobweb/dna": "workspace:*",
    "@ipld/car": "5.4.7",
    "@ipld/unixfs": "3.0.0",
    "multiformats": "14.0.5",
    "sharp": "0.35.5"
  },
  "devDependencies": {
    "@types/node": "^26.6.4",
    "vitest": "^5.0.3"
  }
}
```

Replace `services/render/tsconfig.json` with:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["src"]
}
```

Run:

```bash
pnpm install
grep -n -A16 '^  services/render:' pnpm-lock.yaml
pnpm --filter @cobweb/render exec node -e "import('sharp').then((m) => console.log(m.default.versions.sharp, m.default.versions.vips))"
```

Expected: the install finishes (a note that the build script of `protobufjs` was ignored is expected and harmless; do not add it to `onlyBuiltDependencies`). The lockfile block for `services/render` lists the specifiers `0.35.5`, `3.0.0`, `5.4.7` and `14.0.5` with no caret, and `@cobweb/dna` as `link:../../packages/dna`. The node line prints `0.35.5 8.18.7`.

- [ ] **Step 2: Write the failing test**

Create `services/render/src/problems.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { forToken, reasonOf, RenderProblem } from './problems'

describe('RenderProblem', () => {
  it('is an Error carrying a code, a token id and a detail', () => {
    const problem = new RenderProblem('bad-dna', 'Token 4 names a trait its layer does not have.', {
      tokenId: 4,
      detail: { trait: 'eyes-x' },
    })
    expect(problem).toBeInstanceOf(Error)
    expect(problem.name).toBe('RenderProblem')
    expect(problem.code).toBe('bad-dna')
    expect(problem.message).toBe('Token 4 names a trait its layer does not have.')
    expect(problem.tokenId).toBe(4)
    expect(problem.detail).toEqual({ trait: 'eyes-x' })
  })

  it('leaves token id and detail unset when not given', () => {
    const problem = new RenderProblem('empty-collage', 'A preview collage needs at least one image.')
    expect(problem.tokenId).toBeUndefined()
    expect(problem.detail).toBeUndefined()
  })

  it('tags a problem with its token once', () => {
    const tagged = forToken(
      new RenderProblem('decode', 'Layer 2 could not be read.', { detail: { layer: 1 } }),
      9,
    )
    expect(tagged.code).toBe('decode')
    expect(tagged.tokenId).toBe(9)
    expect(tagged.message).toBe('Token 9: Layer 2 could not be read.')
    expect(tagged.detail).toEqual({ layer: 1 })
    expect(forToken(tagged, 10)).toBe(tagged)
  })

  it('reads the reason of anything thrown', () => {
    expect(reasonOf(new Error('boom'))).toBe('boom')
    expect(reasonOf('plain')).toBe('plain')
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter @cobweb/render exec vitest run src/problems.test.ts`
Expected: FAIL; the file cannot import `./problems` (Vitest reports `Failed to resolve import "./problems"` or `Cannot find module`).

- [ ] **Step 4: Write the types, the problem class and the index**

Create `services/render/src/types.ts` (spec section 5, verbatim, with a file comment):

```ts
/**
 * The render input: plain data, no classes, mirroring what the database stores so the worker's
 * mapping is a projection (spec section 5).
 */

export type ProjectKind = 'generative' | 'one_of_one' | 'single_asset'

/** Where an image lives, as the worker's loader understands it: the `uploads.storage_key`. */
export type ImageRef = { key: string; ext: 'png' | 'jpg' | 'webp' | 'gif' | 'mp4' }

export type RenderTrait = {
  id: string
  name: string
  blank: boolean
  /** `false` leaves the trait out of metadata (traits.in_metadata). */
  inMetadata: boolean
  /** null only for a blank. */
  image: ImageRef | null
}

export type RenderLayer = {
  id: string
  name: string
  displayName: string | null
  /** 0 to 1; 1 until the follow-up adds a column. */
  opacity: number
  traits: RenderTrait[]
}

/** One art collection of a generative project, layers bottom first. */
export type RenderArtCollection = { id: string; layers: RenderLayer[] }

export type GenerativeToken = { id: number; collectionId: string; dna: string[]; description: string | null }
export type AssetToken = { id: number; image: ImageRef; attributes: { trait_type: string; value: string }[] }

export type MetadataText = {
  /** Written as `<tokenName> #<id>`; the collection name when `collections.token_name` is null. */
  tokenName: string
  /** The project default; a generative token's own description wins when set. */
  tokenDescription: string
  showBlankTraits: boolean
  /** Extra top-level keys; the four reserved keys are refused (section 7). */
  extraFields: Record<string, string | number | boolean>
}

export type GenerativeSpec = {
  kind: 'generative'
  canvas: number
  collections: RenderArtCollection[]
  text: MetadataText
  batchSize: number
}

export type AssetSpec = {
  kind: 'one_of_one' | 'single_asset'
  text: MetadataText
  batchSize: number
}

export type PlaceholderSpec = {
  kind: 'placeholder'
  image: ImageRef
  /** The collection name and description, not per token. */
  name: string
  description: string
}

export type RenderSpec = GenerativeSpec | AssetSpec | PlaceholderSpec

/** The worker's loader: bytes for a storage key. Throws when the object is missing. */
export type LoadImage = (ref: ImageRef) => Promise<Uint8Array>
```

Create `services/render/src/problems.ts`:

```ts
export type RenderProblemCode =
  | 'layer-size'
  | 'bad-dna'
  | 'missing-image'
  | 'batch-range'
  | 'missing-batch'
  | 'reserved-key'
  | 'duplicate-name'
  | 'empty-collage'
  | 'decode'

/**
 * Every refusal the library makes. The worker stores `code` and `message` on the batch row, so
 * messages are plain sentences.
 */
export class RenderProblem extends Error {
  code: RenderProblemCode
  tokenId?: number
  detail?: Record<string, string | number>

  constructor(
    code: RenderProblemCode,
    message: string,
    options: { tokenId?: number; detail?: Record<string, string | number> } = {},
  ) {
    super(message)
    this.name = 'RenderProblem'
    this.code = code
    if (options.tokenId !== undefined) this.tokenId = options.tokenId
    if (options.detail !== undefined) this.detail = options.detail
  }
}

/** The same problem tagged with the token it happened on. A problem that already names one is kept. */
export function forToken(problem: RenderProblem, tokenId: number): RenderProblem {
  if (problem.tokenId !== undefined) return problem
  return new RenderProblem(problem.code, `Token ${tokenId}: ${problem.message}`, {
    tokenId,
    ...(problem.detail ? { detail: problem.detail } : {}),
  })
}

/** The reason text of anything thrown, for a problem's detail. */
export function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
```

Replace `services/render/src/index.ts` (today `export {}`) with:

```ts
export * from './types'
export { RenderProblem } from './problems'
export type { RenderProblemCode } from './problems'
```

- [ ] **Step 5: Run the tests and checks**

Run:

```bash
pnpm --filter @cobweb/render exec vitest run src/problems.test.ts
pnpm --filter @cobweb/render typecheck && pnpm --filter @cobweb/render lint
```

Expected: 4 tests pass; typecheck and lint clean.

- [ ] **Step 6: Commit**

```bash
pnpm exec prettier --write services/render
pnpm typecheck && pnpm lint && pnpm test
git add services/render/package.json services/render/tsconfig.json services/render/src pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
Make services/render the @cobweb/render package with its input types and RenderProblem

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bcHX4HZG5YGWhxjGuiWos
EOF
)"
```

---

### Task 2: Compositing

**Files:**

- Create: `services/render/src/png.ts`, `services/render/src/composite.ts`, `services/render/src/fixtures.ts`
- Modify: `services/render/src/index.ts`
- Test: `services/render/src/composite.test.ts`

**Interfaces:**

- Consumes: `RenderProblem`, `reasonOf` from `./problems` (Task 1).
- Produces: from `./png`: `sharp` (the configured default export, re-exported), `PNG_OPTIONS`, `TRANSPARENT` (`{ r: 0, g: 0, b: 0, alpha: 0 }`), `setConcurrency(threads: number): void`, `bytesOf(buffer: Buffer): Uint8Array`. From `./composite`: `compositeToken(canvas: number, layers: { bytes: Uint8Array; opacity: number }[]): Promise<Uint8Array>`. From `./fixtures` (test helpers, not exported by the package): `type Rgba`, `flatPng(colour: Rgba, width = 64, height = width): Promise<Uint8Array>`, `halfAlphaSquarePng(colour: Omit<Rgba, 'alpha'>, size = 64): Promise<Uint8Array>` (transparent, with a centred half-size square at alpha 0.5), `pixel(png, x, y): Promise<number[]>` (RGBA), `sizeOf(png): Promise<{ width; height; format }>`, `pngChunks(png): string[]`.

Decision: each layer is decoded to raw sRGBA (`toColourspace('srgb').ensureAlpha().raw()`) before compositing, so greyscale, 16-bit and palette PNGs all arrive as 8-bit RGBA at canvas size; opacity is applied to that layer with the `dest-in` composite of a tiled 1 by 1 pixel of alpha `round(opacity * 255)` that spec section 6 describes, after clamping the opacity to 0 to 1 (NaN counts as 1). Every sharp failure while reading a layer is `decode` with `detail.layer` (0-based) and `detail.reason`; `renderBatch` (Task 5) adds the token id.

Decision: sharp settings live in `png.ts` rather than `composite.ts` because the collage (Task 7) shares them; importing either module applies them once. `setConcurrency` floors its argument and never goes below 1 (`sharp.concurrency(0)` would mean "all cores").

- [ ] **Step 1: Write the failing test and the image helpers**

Create `services/render/src/fixtures.ts` (Tasks 3, 4 and 5 add to it):

```ts
/**
 * Test helpers: images drawn with sharp (no binary fixtures are committed), an in-memory loader, a
 * PNG chunk reader and a CAR reader. Not exported from the package.
 */
import { sharp } from './png'

export type Rgba = { r: number; g: number; b: number; alpha: number }

const CLEAR: Rgba = { r: 0, g: 0, b: 0, alpha: 0 }

/** A flat colour PNG, `width` by `height` (square by default). */
export async function flatPng(colour: Rgba, width = 64, height = width): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({ create: { width, height, channels: 4, background: colour } })
      .png()
      .toBuffer(),
  )
}

/** A transparent PNG with a centred square of `colour`, half the size, at half alpha. */
export async function halfAlphaSquarePng(colour: Omit<Rgba, 'alpha'>, size = 64): Promise<Uint8Array> {
  const square = await flatPng({ ...colour, alpha: 0.5 }, size / 2)
  return new Uint8Array(
    await sharp({ create: { width: size, height: size, channels: 4, background: CLEAR } })
      .composite([{ input: Buffer.from(square), left: size / 4, top: size / 4 }])
      .png()
      .toBuffer(),
  )
}

/** The RGBA of one pixel. */
export async function pixel(png: Uint8Array, x: number, y: number): Promise<number[]> {
  const { data, info } = await sharp(png)
    .toColourspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const at = (y * info.width + x) * 4
  return [...data.subarray(at, at + 4)]
}

export async function sizeOf(png: Uint8Array): Promise<{ width: number; height: number; format: string }> {
  const { width, height, format } = await sharp(png).metadata()
  return { width, height, format }
}

/** Chunk types of a PNG, in file order. */
export function pngChunks(png: Uint8Array): string[] {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  const types: string[] = []
  for (let at = 8; at < png.byteLength;) {
    const length = view.getUint32(at)
    types.push(String.fromCharCode(...png.subarray(at + 4, at + 8)))
    at += 12 + length
  }
  return types
}
```

Create `services/render/src/composite.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { compositeToken } from './composite'
import { flatPng, halfAlphaSquarePng, pixel, pngChunks, sizeOf } from './fixtures'
import { sharp } from './png'
import { RenderProblem } from './problems'

const RED = { r: 255, g: 0, b: 0, alpha: 1 }
const BLUE = { r: 0, g: 0, b: 255, alpha: 1 }

describe('compositeToken', () => {
  it('stacks bottom first, so the top layer wins where it is opaque', async () => {
    const png = await compositeToken(64, [
      { bytes: await flatPng(RED), opacity: 1 },
      { bytes: await halfAlphaSquarePng({ r: 0, g: 255, b: 0 }), opacity: 1 },
      { bytes: await flatPng(BLUE), opacity: 1 },
    ])
    expect(await sizeOf(png)).toEqual({ width: 64, height: 64, format: 'png' })
    expect(await pixel(png, 32, 32)).toEqual([0, 0, 255, 255])
  })

  it('blends a half alpha layer over the one below', async () => {
    const png = await compositeToken(64, [
      { bytes: await flatPng(RED), opacity: 1 },
      { bytes: await halfAlphaSquarePng({ r: 0, g: 0, b: 255 }), opacity: 1 },
    ])
    expect(await pixel(png, 2, 2)).toEqual([255, 0, 0, 255])
    const [r, g, b, a] = await pixel(png, 32, 32)
    expect(a).toBe(255)
    expect(g).toBe(0)
    expect(Math.abs(r! - 128)).toBeLessThanOrEqual(2)
    expect(Math.abs(b! - 128)).toBeLessThanOrEqual(2)
  })

  it('halves alpha at opacity 0.5, within 1 unit', async () => {
    const png = await compositeToken(64, [{ bytes: await flatPng(RED), opacity: 0.5 }])
    const [r, , , a] = await pixel(png, 10, 10)
    expect(r).toBe(255)
    expect(Math.abs(a! - 127.5)).toBeLessThanOrEqual(1)
  })

  it('treats no layers (every trait blank) as a transparent canvas', async () => {
    const png = await compositeToken(64, [])
    expect(await sizeOf(png)).toEqual({ width: 64, height: 64, format: 'png' })
    expect(await pixel(png, 0, 0)).toEqual([0, 0, 0, 0])
  })

  it('refuses a layer of another size, naming the size found', async () => {
    const small = await flatPng(RED, 32)
    const error = await compositeToken(64, [
      { bytes: await flatPng(BLUE), opacity: 1 },
      { bytes: small, opacity: 1 },
    ]).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(RenderProblem)
    expect(error).toMatchObject({ code: 'layer-size', detail: { layer: 1, width: 32, height: 32 } })
    expect((error as RenderProblem).message).toBe('Layer 2 is 32 by 32 pixels; the canvas is 64 by 64.')
  })

  it('wraps bytes that are not an image as decode', async () => {
    const error = await compositeToken(64, [{ bytes: new Uint8Array([1, 2, 3]), opacity: 1 }]).catch(
      (e: unknown) => e,
    )
    expect(error).toMatchObject({ code: 'decode', detail: { layer: 0 } })
  })

  it('writes a PNG with no EXIF, ICC, text or time chunk', async () => {
    const png = await compositeToken(64, [{ bytes: await flatPng(RED), opacity: 1 }])
    const chunks = pngChunks(png)
    expect(chunks[0]).toBe('IHDR')
    expect(chunks.at(-1)).toBe('IEND')
    for (const banned of ['tIME', 'eXIf', 'iCCP', 'tEXt', 'zTXt', 'iTXt'])
      expect(chunks).not.toContain(banned)
  })

  it('gives identical bytes on two runs', async () => {
    const layers = [
      { bytes: await flatPng(RED), opacity: 1 },
      { bytes: await halfAlphaSquarePng({ r: 0, g: 255, b: 0 }), opacity: 0.5 },
    ]
    expect(await compositeToken(64, layers)).toEqual(await compositeToken(64, layers))
  })

  it('clamps an opacity outside 0 to 1 and reads NaN as fully opaque', async () => {
    const red = await flatPng(RED)
    const at = async (opacity: number) => pixel(await compositeToken(64, [{ bytes: red, opacity }]), 10, 10)
    expect(await at(1.5)).toEqual([255, 0, 0, 255])
    expect(await at(50)).toEqual([255, 0, 0, 255])
    expect((await at(-0.2))[3]).toBe(0)
    expect(await at(Number.NaN)).toEqual([255, 0, 0, 255])
  })

  it('composites greyscale, 16-bit and palette PNG layers like any other', async () => {
    const grey = new Uint8Array(
      await sharp(await flatPng({ r: 128, g: 128, b: 128, alpha: 1 }))
        .toColourspace('b-w')
        .png()
        .toBuffer(),
    )
    const deep = new Uint8Array(
      await sharp(await flatPng({ r: 10, g: 200, b: 30, alpha: 1 }))
        .toColourspace('rgb16')
        .png()
        .toBuffer(),
    )
    const indexed = new Uint8Array(
      await sharp(await flatPng({ r: 0, g: 0, b: 255, alpha: 1 }))
        .png({ palette: true })
        .toBuffer(),
    )
    expect(await pixel(await compositeToken(64, [{ bytes: grey, opacity: 1 }]), 5, 5)).toEqual([
      128, 128, 128, 255,
    ])
    expect(await pixel(await compositeToken(64, [{ bytes: deep, opacity: 1 }]), 5, 5)).toEqual([
      10, 200, 30, 255,
    ])
    expect(await pixel(await compositeToken(64, [{ bytes: indexed, opacity: 1 }]), 5, 5)).toEqual([
      0, 0, 255, 255,
    ])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @cobweb/render exec vitest run src/composite.test.ts`
Expected: FAIL; the files cannot import `./png` or `./composite` (`Failed to resolve import` or `Cannot find module`).

- [ ] **Step 3: Write the sharp settings and the compositor**

Create `services/render/src/png.ts`:

```ts
import sharp from 'sharp'

// Determinism (spec section 12): no operation cache and one libvips thread, so output never
// depends on thread scheduling. Set once, when the module loads.
sharp.cache(false)
sharp.concurrency(1)

/** PNG settings for every image the library writes. `withMetadata` is never called: no EXIF, ICC or time chunk. */
export const PNG_OPTIONS = { compressionLevel: 9, adaptiveFiltering: false, palette: false } as const

/** A fully transparent pixel, for canvases and letterboxing. */
export const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 }

/**
 * libvips threads per image. The benchmark (third sub-project) may raise it after proving CIDs stay
 * identical; nothing else about sharp is exposed.
 */
export function setConcurrency(threads: number): void {
  sharp.concurrency(Math.max(1, Math.floor(threads)))
}

/** A Buffer as a plain Uint8Array over the same memory. */
export function bytesOf(buffer: Buffer): Uint8Array {
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
}

export { sharp }
```

Create `services/render/src/composite.ts`:

```ts
import { reasonOf, RenderProblem } from './problems'
import { PNG_OPTIONS, TRANSPARENT, bytesOf, sharp } from './png'

type RawInput = { input: Buffer; raw: { width: number; height: number; channels: 4 } }

/** Opacity as stored is 0 to 1. Out of range values are clamped; NaN counts as fully opaque. */
function alphaOf(opacity: number): number {
  const clamped = Number.isNaN(opacity) ? 1 : Math.min(1, Math.max(0, opacity))
  return Math.round(clamped * 255)
}

function decodeProblem(position: number, error: unknown): RenderProblem {
  return new RenderProblem('decode', `Layer ${position + 1} could not be read as an image.`, {
    detail: { layer: position, reason: reasonOf(error) },
  })
}

async function dimensionsOf(bytes: Uint8Array, position: number): Promise<{ width: number; height: number }> {
  try {
    const { width, height } = await sharp(bytes).metadata()
    return { width, height }
  } catch (error) {
    throw decodeProblem(position, error)
  }
}

/** One layer as raw sRGBA at canvas size, its alpha multiplied by the opacity. */
async function prepareLayer(
  canvas: number,
  bytes: Uint8Array,
  opacity: number,
  position: number,
): Promise<RawInput> {
  const { width, height } = await dimensionsOf(bytes, position)
  if (width !== canvas || height !== canvas)
    throw new RenderProblem(
      'layer-size',
      `Layer ${position + 1} is ${width} by ${height} pixels; the canvas is ${canvas} by ${canvas}.`,
      { detail: { layer: position, width, height } },
    )
  const alpha = alphaOf(opacity)
  let image = sharp(bytes).toColourspace('srgb').ensureAlpha()
  if (alpha < 255)
    image = image.composite([
      {
        input: Buffer.from([0, 0, 0, alpha]),
        raw: { width: 1, height: 1, channels: 4 },
        tile: true,
        blend: 'dest-in',
      },
    ])
  try {
    return { input: await image.raw().toBuffer(), raw: { width: canvas, height: canvas, channels: 4 } }
  } catch (error) {
    throw decodeProblem(position, error)
  }
}

/**
 * Stacks layer images bottom first on a transparent `canvas` by `canvas` RGBA base and returns the
 * PNG. Every layer must be exactly canvas sized; nothing is resized. A blank trait is simply not
 * passed in.
 */
export async function compositeToken(
  canvas: number,
  layers: { bytes: Uint8Array; opacity: number }[],
): Promise<Uint8Array> {
  const inputs: RawInput[] = []
  for (const [position, layer] of layers.entries())
    inputs.push(await prepareLayer(canvas, layer.bytes, layer.opacity, position))
  const png = await sharp({ create: { width: canvas, height: canvas, channels: 4, background: TRANSPARENT } })
    .composite(inputs)
    .png(PNG_OPTIONS)
    .toBuffer()
  return bytesOf(png)
}
```

Append to `services/render/src/index.ts`:

```ts
export { compositeToken } from './composite'
export { setConcurrency } from './png'
```

- [ ] **Step 4: Run the tests and checks**

Run:

```bash
pnpm --filter @cobweb/render exec vitest run src/composite.test.ts
pnpm --filter @cobweb/render typecheck && pnpm --filter @cobweb/render lint
```

Expected: 10 tests pass; typecheck and lint clean. If "clamps an opacity" fails with an alpha of 126 for 1.5, `alphaOf` is not clamping; if the greyscale case fails with a scrambled pixel, `toColourspace('srgb')` is missing before `ensureAlpha()`.

- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write services/render
pnpm typecheck && pnpm lint && pnpm test
git add services/render/src
git commit -m "$(cat <<'EOF'
Composite layers with pinned sharp settings and refuse wrong sizes and unreadable images

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bcHX4HZG5YGWhxjGuiWos
EOF
)"
```

---

### Task 3: Metadata JSON and DNA resolution

**Files:**

- Create: `services/render/src/metadata.ts`, `services/render/src/generative.ts`
- Modify: `services/render/src/fixtures.ts`, `services/render/src/index.ts`
- Test: `services/render/src/metadata.test.ts`, `services/render/src/generative.test.ts`

**Interfaces:**

- Consumes: `RenderProblem` (Task 1); the types of `./types` (Task 1); from `@cobweb/dna`: `buildTraitIndex(layers: Layer[]): TraitIndex`, `tokenAttributes(token: { dna: string[] }, layers: Layer[], index: TraitIndex, options: { showBlankTraits: boolean }): { trait_type: string; value: string }[]`, `type Layer`, `type TraitIndex`.
- Produces: from `./metadata`: `RESERVED_KEYS` (`['name', 'description', 'image', 'attributes'] as const`), `SHARED_METADATA_FILE` (`'metadata.json'`), `assertExtraFields(text: MetadataText): void`, `tokenMetadataJson(input: { id; text; description: string | null; image: string; attributes }): Uint8Array`, `placeholderMetadataJson(input: { name; description; image }): Uint8Array`. From `./generative`: `isGenerativeToken(token): token is GenerativeToken`, `batchOf(id: number, batchSize: number): number`, `resolveTraits(spec: GenerativeSpec, token: GenerativeToken): { collection: RenderArtCollection; picks: { layer: RenderLayer; trait: RenderTrait }[] }`, `attributesFor(spec: GenerativeSpec): (token: GenerativeToken) => { trait_type: string; value: string }[]`. From `./fixtures`: `TEXT: MetadataText`, `owlSpec(options?: { hatOpacity?: number; showBlankTraits?: boolean }): GenerativeSpec`, `owlImages(): Promise<Record<string, Uint8Array>>`.

Decision: the JSON is written entry by entry, each value through `JSON.stringify(value, null, 2)`, instead of one `JSON.stringify` of an object (spec section 7 says "once"). The bytes are identical for every ordinary key (a test proves it), and an integer-like extra key such as `"2024"` stays after `attributes`, which one object could not guarantee.

Decision: `assertExtraFields` runs at the start of `renderBatch` and `renderMetadataSet` (Tasks 5 and 6), before any token, as spec section 7 asks; `tokenMetadataJson` also calls it so the function is safe on its own. The check is four lookups.

Decision: `resolveTraits` refuses with `bad-dna` an unknown collection, a DNA whose length differs from the collection's layer count, and a trait id that is not on that layer (which covers a trait from another layer). `attributesFor` calls it first, so the metadata set refuses exactly what the batch refuses (Review Focus 4). The render layers are mapped to `@cobweb/dna` `Layer`s (`displayName` null becomes undefined, `inMetadata: false` becomes `metadata: false`, weight 0, `imageUrl` null) so its `tokenAttributes` is the one attribute writer.

- [ ] **Step 1: Write the failing tests and the spec fixture**

Append to `services/render/src/fixtures.ts`, and add `import type { GenerativeSpec, ImageRef, MetadataText } from './types'` after its `import { sharp } from './png'` line:

```ts
export const TEXT: MetadataText = {
  tokenName: 'Owl',
  tokenDescription: 'A night owl.',
  showBlankTraits: false,
  extraFields: {},
}

const ref = (key: string): ImageRef => ({ key, ext: 'png' })

/**
 * One collection, `owls`, three layers bottom first: Background shown as "Scene" (ink, dusk), Eyes
 * (wide, and sleepy which is left out of metadata) and Hat (a blank "None", and cap at `hatOpacity`).
 */
export function owlSpec(options: { hatOpacity?: number; showBlankTraits?: boolean } = {}): GenerativeSpec {
  return {
    kind: 'generative',
    canvas: 64,
    batchSize: 100,
    text: { ...TEXT, showBlankTraits: options.showBlankTraits ?? false },
    collections: [
      {
        id: 'owls',
        layers: [
          {
            id: 'background',
            name: 'Background',
            displayName: 'Scene',
            opacity: 1,
            traits: [
              { id: 'bg-ink', name: 'Ink', blank: false, inMetadata: true, image: ref('bg-ink.png') },
              { id: 'bg-dusk', name: 'Dusk', blank: false, inMetadata: true, image: ref('bg-dusk.png') },
            ],
          },
          {
            id: 'eyes',
            name: 'Eyes',
            displayName: null,
            opacity: 1,
            traits: [
              { id: 'eyes-wide', name: 'Wide', blank: false, inMetadata: true, image: ref('eyes-wide.png') },
              {
                id: 'eyes-sleepy',
                name: 'Sleepy',
                blank: false,
                inMetadata: false,
                image: ref('eyes-sleepy.png'),
              },
            ],
          },
          {
            id: 'hat',
            name: 'Hat',
            displayName: null,
            opacity: options.hatOpacity ?? 1,
            traits: [
              { id: 'hat-none', name: 'None', blank: true, inMetadata: true, image: null },
              { id: 'hat-cap', name: 'Cap', blank: false, inMetadata: true, image: ref('hat-cap.png') },
            ],
          },
        ],
      },
    ],
  }
}

/** Images for every key `owlSpec` names, 64 by 64. */
export async function owlImages(): Promise<Record<string, Uint8Array>> {
  return {
    'bg-ink.png': await flatPng({ r: 20, g: 20, b: 60, alpha: 1 }),
    'bg-dusk.png': await flatPng({ r: 200, g: 120, b: 60, alpha: 1 }),
    'eyes-wide.png': await halfAlphaSquarePng({ r: 255, g: 255, b: 0 }),
    'eyes-sleepy.png': await halfAlphaSquarePng({ r: 0, g: 255, b: 255 }),
    'hat-cap.png': await halfAlphaSquarePng({ r: 255, g: 0, b: 0 }),
  }
}
```

Create `services/render/src/metadata.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { owlSpec } from './fixtures'
import { attributesFor } from './generative'
import { placeholderMetadataJson, tokenMetadataJson } from './metadata'
import type { MetadataText } from './types'

const text: MetadataText = {
  tokenName: 'Owl',
  tokenDescription: 'A night owl.',
  showBlankTraits: false,
  extraFields: {},
}
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
const image = 'ipfs://bafyimages/7.png'

describe('tokenMetadataJson', () => {
  it('writes the fixed key order with two space indent and no trailing newline', () => {
    const json = decode(
      tokenMetadataJson({
        id: 7,
        text,
        description: null,
        image,
        attributes: [
          { trait_type: 'Background', value: 'Ink' },
          { trait_type: 'Eyes', value: 'Wide' },
        ],
      }),
    )
    expect(json).toBe(
      [
        '{',
        '  "name": "Owl #7",',
        '  "description": "A night owl.",',
        '  "image": "ipfs://bafyimages/7.png",',
        '  "attributes": [',
        '    {',
        '      "trait_type": "Background",',
        '      "value": "Ink"',
        '    },',
        '    {',
        '      "trait_type": "Eyes",',
        '      "value": "Wide"',
        '    }',
        '  ]',
        '}',
      ].join('\n'),
    )
  })

  it('matches JSON.stringify of the same object when no key is integer-like', () => {
    const attributes = [{ trait_type: 'Scene', value: 'Ink' }]
    const json = decode(
      tokenMetadataJson({
        id: 1,
        text: { ...text, extraFields: { artist: 'Kim', edition: 2 } },
        description: null,
        image,
        attributes,
      }),
    )
    expect(json).toBe(
      JSON.stringify(
        { name: 'Owl #1', description: 'A night owl.', image, attributes, artist: 'Kim', edition: 2 },
        null,
        2,
      ),
    )
  })

  it('writes an empty attribute list as []', () => {
    const json = decode(tokenMetadataJson({ id: 3, text, description: null, image, attributes: [] }))
    expect(json.endsWith('  "attributes": []\n}')).toBe(true)
    expect(JSON.parse(json)).toEqual({ name: 'Owl #3', description: 'A night owl.', image, attributes: [] })
  })

  it("prefers the token's own description", () => {
    const json = JSON.parse(
      decode(tokenMetadataJson({ id: 2, text, description: 'Mine.', image, attributes: [] })),
    )
    expect(json.description).toBe('Mine.')
  })

  it('appends extra fields in the order given, after attributes', () => {
    const json = decode(
      tokenMetadataJson({
        id: 1,
        text: { ...text, extraFields: { zeta: true, artist: 'Kim', edition: 2 } },
        description: null,
        image,
        attributes: [],
      }),
    )
    expect(Object.keys(JSON.parse(json))).toEqual([
      'name',
      'description',
      'image',
      'attributes',
      'zeta',
      'artist',
      'edition',
    ])
    expect(json.endsWith('  "edition": 2\n}')).toBe(true)
  })

  it('keeps an integer-like extra key after attributes', () => {
    const json = decode(
      tokenMetadataJson({
        id: 1,
        text: { ...text, extraFields: { '2024': 'drop' } },
        description: null,
        image,
        attributes: [],
      }),
    )
    expect(json.indexOf('"name"')).toBeLessThan(json.indexOf('"2024"'))
    expect(json.indexOf('"attributes"')).toBeLessThan(json.indexOf('"2024"'))
  })

  it('refuses a reserved key among the extra fields', () => {
    for (const key of ['name', 'description', 'image', 'attributes'])
      expect(() =>
        tokenMetadataJson({
          id: 1,
          text: { ...text, extraFields: { [key]: 'x' } },
          description: null,
          image,
          attributes: [],
        }),
      ).toThrow(expect.objectContaining({ code: 'reserved-key', detail: { key } }))
  })

  it('writes no date or other clock value', () => {
    const json = decode(tokenMetadataJson({ id: 1, text, description: null, image, attributes: [] }))
    expect(json).not.toMatch(/date|time/i)
  })
})

describe('placeholderMetadataJson', () => {
  it('writes name, description and image only', () => {
    expect(
      decode(
        placeholderMetadataJson({
          name: 'Owls',
          description: 'Soon.',
          image: 'ipfs://bafyp/placeholder.gif',
        }),
      ),
    ).toBe(
      [
        '{',
        '  "name": "Owls",',
        '  "description": "Soon.",',
        '  "image": "ipfs://bafyp/placeholder.gif"',
        '}',
      ].join('\n'),
    )
  })
})

describe('a generative token', () => {
  const json = (spec: ReturnType<typeof owlSpec>, dna: string[]) =>
    decode(
      tokenMetadataJson({
        id: 5,
        text: spec.text,
        description: null,
        image: 'ipfs://bafyimages/5.png',
        attributes: attributesFor(spec)({ id: 5, collectionId: 'owls', dna, description: null }),
      }),
    )

  it('leaves a blank out, uses the display name and drops a trait kept out of metadata', () => {
    expect(json(owlSpec(), ['bg-ink', 'eyes-sleepy', 'hat-none'])).toBe(
      [
        '{',
        '  "name": "Owl #5",',
        '  "description": "A night owl.",',
        '  "image": "ipfs://bafyimages/5.png",',
        '  "attributes": [',
        '    {',
        '      "trait_type": "Scene",',
        '      "value": "Ink"',
        '    }',
        '  ]',
        '}',
      ].join('\n'),
    )
  })

  it('writes the blank by name when blanks are shown', () => {
    expect(json(owlSpec({ showBlankTraits: true }), ['bg-dusk', 'eyes-wide', 'hat-none'])).toBe(
      [
        '{',
        '  "name": "Owl #5",',
        '  "description": "A night owl.",',
        '  "image": "ipfs://bafyimages/5.png",',
        '  "attributes": [',
        '    {',
        '      "trait_type": "Scene",',
        '      "value": "Dusk"',
        '    },',
        '    {',
        '      "trait_type": "Eyes",',
        '      "value": "Wide"',
        '    },',
        '    {',
        '      "trait_type": "Hat",',
        '      "value": "None"',
        '    }',
        '  ]',
        '}',
      ].join('\n'),
    )
  })
})

describe('an asset token', () => {
  it('writes the attributes stored at lock unchanged', () => {
    const attributes = [
      { trait_type: 'Edition', value: 'Gold' },
      { trait_type: 'Artist', value: 'Kim' },
    ]
    const parsed = JSON.parse(
      decode(
        tokenMetadataJson({ id: 12, text, description: null, image: 'ipfs://bafyimages/12.mp4', attributes }),
      ),
    )
    expect(parsed).toEqual({
      name: 'Owl #12',
      description: 'A night owl.',
      image: 'ipfs://bafyimages/12.mp4',
      attributes,
    })
  })
})
```

Create `services/render/src/generative.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { owlSpec } from './fixtures'
import { batchOf, isGenerativeToken, resolveTraits } from './generative'

const token = (dna: string[], collectionId = 'owls') => ({ id: 8, collectionId, dna, description: null })

describe('batchOf', () => {
  it('puts ids 1 to 100 in batch 0 and 101 in batch 1', () => {
    expect([1, 100, 101, 200, 201, 300].map((id) => batchOf(id, 100))).toEqual([0, 0, 1, 1, 2, 2])
  })
})

describe('isGenerativeToken', () => {
  it('tells a DNA token from an asset token', () => {
    expect(isGenerativeToken(token([]))).toBe(true)
    expect(isGenerativeToken({ id: 1, image: { key: 'a', ext: 'gif' }, attributes: [] })).toBe(false)
  })
})

describe('resolveTraits', () => {
  it('pairs every layer, bottom first, with the trait the DNA names', () => {
    const { picks } = resolveTraits(owlSpec(), token(['bg-ink', 'eyes-wide', 'hat-none']))
    expect(picks.map((p) => [p.layer.id, p.trait.id])).toEqual([
      ['background', 'bg-ink'],
      ['eyes', 'eyes-wide'],
      ['hat', 'hat-none'],
    ])
  })

  it('refuses an unknown collection, a DNA of the wrong length and a trait from another layer', () => {
    const cases = [
      token(['bg-ink', 'eyes-wide', 'hat-none'], 'bats'),
      token(['bg-ink', 'eyes-wide']),
      token(['bg-ink', 'eyes-wide', 'hat-none', 'bg-ink']),
      token(['eyes-wide', 'bg-ink', 'hat-none']),
      token(['bg-ink', 'eyes-gone', 'hat-none']),
    ]
    for (const bad of cases)
      expect(() => resolveTraits(owlSpec(), bad)).toThrow(
        expect.objectContaining({ code: 'bad-dna', tokenId: 8 }),
      )
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @cobweb/render exec vitest run src/metadata.test.ts src/generative.test.ts`
Expected: FAIL; the files cannot import `./metadata` or `./generative`.

- [ ] **Step 3: Write the metadata writers and the DNA resolution**

Create `services/render/src/metadata.ts`:

```ts
import { RenderProblem } from './problems'
import type { MetadataText } from './types'

export const RESERVED_KEYS = ['name', 'description', 'image', 'attributes'] as const

/** The one file a single asset's and the placeholder's metadata directory holds; every token shares it. */
export const SHARED_METADATA_FILE = 'metadata.json'

type Attribute = { trait_type: string; value: string }

const encoder = new TextEncoder()

/**
 * `JSON.stringify(value, null, 2)` of an object with exactly these keys in exactly this order. An
 * object literal would move an integer-like key (an extra field named "2024") ahead of `name`, so
 * the object is written entry by entry; each value is still serialized by `JSON.stringify`.
 */
function orderedJson(entries: [string, unknown][]): Uint8Array {
  const body = entries.map(
    ([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value, null, 2).replaceAll('\n', '\n  ')}`,
  )
  return encoder.encode(body.length === 0 ? '{}' : `{\n${body.join(',\n')}\n}`)
}

/** Refuses an extra field that would overwrite a key the library writes. Run once per spec, before any token. */
export function assertExtraFields(text: MetadataText): void {
  for (const key of Object.keys(text.extraFields))
    if ((RESERVED_KEYS as readonly string[]).includes(key))
      throw new RenderProblem(
        'reserved-key',
        `The extra metadata field "${key}" is reserved for the library. Rename it.`,
        { detail: { key } },
      )
}

/** One token's metadata: name, description, image, attributes, then the extra fields in the order given. */
export function tokenMetadataJson(input: {
  id: number
  text: MetadataText
  description: string | null
  image: string
  attributes: Attribute[]
}): Uint8Array {
  assertExtraFields(input.text)
  return orderedJson([
    ['name', `${input.text.tokenName} #${input.id}`],
    ['description', input.description ?? input.text.tokenDescription],
    ['image', input.image],
    ['attributes', input.attributes],
    ...Object.entries(input.text.extraFields),
  ])
}

/** The pre-reveal placeholder's metadata: name, description and image only. */
export function placeholderMetadataJson(input: {
  name: string
  description: string
  image: string
}): Uint8Array {
  return orderedJson([
    ['name', input.name],
    ['description', input.description],
    ['image', input.image],
  ])
}
```

Create `services/render/src/generative.ts`:

```ts
import { buildTraitIndex, tokenAttributes } from '@cobweb/dna'
import type { Layer, TraitIndex } from '@cobweb/dna'
import { RenderProblem } from './problems'
import type {
  AssetToken,
  GenerativeSpec,
  GenerativeToken,
  RenderArtCollection,
  RenderLayer,
  RenderTrait,
} from './types'

/** A generative token carries DNA; an asset token carries its image. */
export function isGenerativeToken(token: GenerativeToken | AssetToken): token is GenerativeToken {
  return 'dna' in token
}

/** The batch a token id falls in: 0-based, `batchSize` ids per batch, ids from 1. */
export function batchOf(id: number, batchSize: number): number {
  return Math.floor((id - 1) / batchSize)
}

/**
 * The token's collection and, for each of its layers bottom first, the trait its DNA names there.
 * Refuses an unknown collection, a DNA of the wrong length and a trait id the layer does not have.
 */
export function resolveTraits(
  spec: GenerativeSpec,
  token: GenerativeToken,
): { collection: RenderArtCollection; picks: { layer: RenderLayer; trait: RenderTrait }[] } {
  const collection = spec.collections.find((c) => c.id === token.collectionId)
  if (!collection)
    throw new RenderProblem(
      'bad-dna',
      `Token ${token.id} belongs to collection ${token.collectionId}, which the job does not have.`,
      {
        tokenId: token.id,
        detail: { collection: token.collectionId },
      },
    )
  if (token.dna.length !== collection.layers.length)
    throw new RenderProblem(
      'bad-dna',
      `Token ${token.id} has ${token.dna.length} traits for ${collection.layers.length} layers.`,
      { tokenId: token.id },
    )
  const picks = collection.layers.map((layer, i) => {
    const traitId = token.dna[i] ?? ''
    const trait = layer.traits.find((t) => t.id === traitId)
    if (!trait)
      throw new RenderProblem(
        'bad-dna',
        `Token ${token.id} names trait ${traitId}, which layer ${layer.name} does not have.`,
        {
          tokenId: token.id,
          detail: { layer: layer.id, trait: traitId },
        },
      )
    return { layer, trait }
  })
  return { collection, picks }
}

/** A render collection in the shape `@cobweb/dna` reads, so its `tokenAttributes` writes the attributes. */
function dnaLayers(collection: RenderArtCollection): Layer[] {
  return collection.layers.map((layer, position) => ({
    id: layer.id,
    collectionId: collection.id,
    name: layer.name,
    position,
    displayName: layer.displayName ?? undefined,
    traits: layer.traits.map((trait) => ({
      id: trait.id,
      layerId: layer.id,
      name: trait.name,
      weight: 0,
      blank: trait.blank,
      imageUrl: null,
      metadata: trait.inMetadata ? undefined : (false as const),
    })),
  }))
}

/**
 * The attribute writer for a generative spec: blank left out unless `showBlankTraits`, `inMetadata`
 * false left out, `displayName` over `name` (all by `tokenAttributes`). Checks the DNA first.
 */
export function attributesFor(
  spec: GenerativeSpec,
): (token: GenerativeToken) => { trait_type: string; value: string }[] {
  const byCollection = new Map<string, { layers: Layer[]; index: TraitIndex }>()
  for (const collection of spec.collections) {
    const layers = dnaLayers(collection)
    byCollection.set(collection.id, { layers, index: buildTraitIndex(layers) })
  }
  return (token) => {
    const { collection } = resolveTraits(spec, token)
    const { layers, index } = byCollection.get(collection.id)!
    return tokenAttributes(token, layers, index, { showBlankTraits: spec.text.showBlankTraits })
  }
}
```

Append to `services/render/src/index.ts`:

```ts
export { RESERVED_KEYS, placeholderMetadataJson, tokenMetadataJson } from './metadata'
```

- [ ] **Step 4: Run the tests and checks**

Run:

```bash
pnpm --filter @cobweb/render exec vitest run src/metadata.test.ts src/generative.test.ts
pnpm --filter @cobweb/render typecheck && pnpm --filter @cobweb/render lint
```

Expected: 16 tests pass (12 and 4); typecheck and lint clean.

- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write services/render
pnpm typecheck && pnpm lint && pnpm test
git add services/render/src
git commit -m "$(cat <<'EOF'
Write token and placeholder metadata JSON in a fixed key order and resolve DNA to layers

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bcHX4HZG5YGWhxjGuiWos
EOF
)"
```

---

### Task 4: Content archives

**Files:**

- Create: `services/render/src/car.ts`
- Modify: `services/render/src/fixtures.ts`, `services/render/src/index.ts`
- Test: `services/render/src/car.test.ts`

**Interfaces:**

- Consumes: `RenderProblem` (Task 1). From `@ipld/unixfs` (verified against 3.0.0's `dist/src/lib.d.ts`): `configure`, `createWriter({ writable, settings })`, `createFileWriter(view)` (`.write(bytes)`, `.close()` resolving to a `FileLink`), `createDirectoryWriter(view)` and `createShardedDirectoryWriter(view)` (`.set(name, link)`, `.close()` resolving to `{ cid, dagByteLength }`), `type Block`, `decode`, `NodeType`; `type FileLink` from `@ipld/unixfs/directory`; `withMaxChunkSize` from `@ipld/unixfs/file/chunker/fixed`; `withWidth` from `@ipld/unixfs/file/layout/balanced`. From `@ipld/car` 5.4.7: `CarWriter.create(roots)` returning `{ writer, out }` (`writer.put({ cid, bytes })`, `writer.close()`, `out` an async iterable of `Uint8Array`), `CarReader.fromBytes(bytes)` (`getRoots()`, `get(cid)`). From `multiformats` 14.0.5: `CID` (`CID.decode(bytes)`), `multiformats/codecs/raw`.
- Produces: from `./car`: `type PackedDirectory = { car: Uint8Array; cid: string; size: number }`, `SHARD_THRESHOLD` (262,144), `needsShard(plainBlockBytes: number): boolean`, `packDirectory(files: { name: string; bytes: Uint8Array }[]): Promise<PackedDirectory>`. From `./fixtures`: `readCarFiles(car: Uint8Array): Promise<{ root: string; files: Map<string, Uint8Array>; shard: { fanout: number; hashType: number } | null }>`.

Decision: the sharding rule (spec section 8) is measured, not estimated: the plain directory node is encoded into a throwaway stream with `createDirectoryWriter` and its block length read; above 262,144 bytes the real directory is written with `createShardedDirectoryWriter` instead (the library's HAMT is fanout 256 with murmur3-x64-64, multicodec `0x22`, as Kubo). Measured on these settings: 4,000 entries named `1` to `4000` give a 190,897 byte plain block (plain); 6,000 give 286,897 (sharded).

Decision: the file layout is balanced, 1024 links per node (`withWidth(1024)`), which is what `ipfs-car` uses; with 1 MiB chunks it only matters for files above 1 GiB. The settings were checked against `ipfs-car` 3.1.0 for a one-file directory and for a 3 MiB file of four chunks (vectors in the test, commands in step 3).

Decision: `@ipld/unixfs` 3.0.0 links against `multiformats` 13 and `@ipld/car` 5.4.7 against 14; their CID classes differ in type, so every CID crosses over as `CID.decode(link.cid.bytes)`. A block repeated by identical files (the same bytes under two names) is written to the CAR once.

Decision: reading a CAR back in tests uses `@ipld/car`'s `CarReader` and `@ipld/unixfs`'s `decode`, as spec section 13 says; no `ipfs-unixfs-exporter` dependency is added. In a HAMT node a link named by its two hex digit prefix alone is a sub-shard; a longer name is the prefix followed by the entry name.

- [ ] **Step 1: Write the failing test and the CAR reader**

In `services/render/src/fixtures.ts`, add these lines above `import { sharp } from './png'`:

```ts
import { CarReader } from '@ipld/car'
import * as UnixFS from '@ipld/unixfs'
import type { CID } from 'multiformats/cid'
```

and insert this after `pngChunks` (before `export const TEXT`):

```ts
const RAW_CODE = 0x55

/**
 * Every file in a CAR's root directory, plain or HAMT-sharded, by name. Reads single-block (raw
 * leaf) files only, which is every file the tests write.
 */
export async function readCarFiles(car: Uint8Array): Promise<{
  root: string
  files: Map<string, Uint8Array>
  shard: { fanout: number; hashType: number } | null
}> {
  const reader = await CarReader.fromBytes(car)
  const [root] = await reader.getRoots()
  if (!root) throw new Error('The CAR has no root.')
  const files = new Map<string, Uint8Array>()
  const blockOf = async (cid: CID) => {
    const block = await reader.get(cid)
    if (!block) throw new Error(`The CAR is missing block ${cid.toString()}.`)
    return block.bytes
  }
  const fileOf = async (cid: CID) => {
    if (cid.code !== RAW_CODE) throw new Error(`File ${cid.toString()} is not a single raw block.`)
    return blockOf(cid)
  }
  const rootNode = UnixFS.decode(await blockOf(root))
  const shard =
    rootNode.type === UnixFS.NodeType.HAMTShard
      ? { fanout: rootNode.fanout, hashType: rootNode.hashType }
      : null
  const walk = async (node: ReturnType<typeof UnixFS.decode>): Promise<void> => {
    if (node.type === UnixFS.NodeType.Directory) {
      for (const entry of node.entries) files.set(entry.name, await fileOf(entry.cid as unknown as CID))
      return
    }
    if (node.type !== UnixFS.NodeType.HAMTShard) throw new Error(`Unexpected node type ${node.type}.`)
    // In a HAMT shard a link named by its two hex digit prefix alone is a sub-shard; any longer
    // name is the prefix followed by the entry name.
    for (const entry of node.entries) {
      const cid = entry.cid as unknown as CID
      if (entry.name.length === 2) await walk(UnixFS.decode(await blockOf(cid)))
      else files.set(entry.name.slice(2), await fileOf(cid))
    }
  }
  await walk(rootNode)
  return { root: root.toString(), files, shard }
}
```

Create `services/render/src/car.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { needsShard, packDirectory, SHARD_THRESHOLD } from './car'
import { readCarFiles } from './fixtures'
import { RenderProblem } from './problems'

const text = (value: string) => new TextEncoder().encode(value)

/** 3 MiB and 5 bytes, byte i = (i * 31 + 7) mod 256: four 1 MiB chunks. */
function bigFile(): Uint8Array {
  const bytes = new Uint8Array(3 * 1_048_576 + 5)
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + 7) & 255
  return bytes
}

const entries = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ name: String(i + 1), bytes: text(`{"n":${i}}`) }))

describe('packDirectory', () => {
  it('gives the well-known empty directory CID', async () => {
    const packed = await packDirectory([])
    expect(packed.cid).toBe('bafybeiczsscdsbs7ffqz55asqdf3smv6klcw3gofszvwlyarci47bgf354')
    expect(packed.size).toBe(packed.car.byteLength)
  })

  it('matches ipfs-car for one small file', async () => {
    // printf 'hello world\n' > hello.txt && npx -y ipfs-car@3.1.0 pack hello.txt --output hello.car
    const packed = await packDirectory([{ name: 'hello.txt', bytes: text('hello world\n') }])
    expect(packed.cid).toBe('bafybeidhkumeonuwkebh2i4fc7o7lguehauradvlk57gzake6ggjsy372a')
  })

  it('matches ipfs-car for a file of several 1 MiB chunks', async () => {
    // node -e "const b=Buffer.alloc(3*1048576+5);for(let i=0;i<b.length;i++)b[i]=(i*31+7)&255;require('fs').writeFileSync('big.bin',b)"
    // npx -y ipfs-car@3.1.0 pack big.bin --output big.car
    const packed = await packDirectory([{ name: 'big.bin', bytes: bigFile() }])
    expect(packed.cid).toBe('bafybeibsypx75covabyts42kbx5yq2xiasowldpx4qekkzg2zphsoithva')
  })

  it('gives identical CAR bytes whatever order the files come in', async () => {
    const files = [
      { name: 'b.png', bytes: text('b') },
      { name: 'a.png', bytes: text('a') },
      { name: '10.png', bytes: text('10') },
      { name: '9.png', bytes: text('9') },
    ]
    const one = await packDirectory(files)
    const two = await packDirectory([...files].reverse())
    expect(two.cid).toBe(one.cid)
    expect(two.car).toEqual(one.car)
  })

  it('writes a block shared by identical files once and reads both back', async () => {
    const packed = await packDirectory([
      { name: '1.png', bytes: text('same') },
      { name: '2.png', bytes: text('same') },
    ])
    const { files } = await readCarFiles(packed.car)
    expect([...files.keys()]).toEqual(['1.png', '2.png'])
    expect(files.get('2.png')).toEqual(text('same'))
  })

  it('refuses two files with the same name', async () => {
    const error = await packDirectory([
      { name: '1.png', bytes: text('a') },
      { name: '1.png', bytes: text('b') },
    ]).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(RenderProblem)
    expect(error).toMatchObject({ code: 'duplicate-name', detail: { name: '1.png' } })
  })

  it('shards only above 262,144 bytes', () => {
    expect(SHARD_THRESHOLD).toBe(262_144)
    expect(needsShard(262_144)).toBe(false)
    expect(needsShard(262_145)).toBe(true)
  })

  it('keeps 4,000 entries in a plain directory', async () => {
    const { shard, files } = await readCarFiles((await packDirectory(entries(4000))).car)
    expect(shard).toBeNull()
    expect(files.size).toBe(4000)
  })

  it('shards a directory past the threshold and still lists every entry', async () => {
    const packed = await packDirectory(entries(6000))
    const { shard, files, root } = await readCarFiles(packed.car)
    // Kubo's HAMT: fanout 256, murmur3-x64-64 (multicodec 0x22).
    expect(shard).toEqual({ fanout: 256, hashType: 0x22 })
    expect(root).toBe(packed.cid)
    expect(files.size).toBe(6000)
    expect(new TextDecoder().decode(files.get('4321'))).toBe('{"n":4320}')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @cobweb/render exec vitest run src/car.test.ts`
Expected: FAIL; the file cannot import `./car`.

- [ ] **Step 3: Recompute the vectors independently**

The two `ipfs-car` vectors in the test were computed with the CLI; recompute them outside the repo before trusting them (the empty directory CID is the same one Kubo prints for `ipfs add -r --cid-version=1` of an empty folder):

```bash
cd "$(mktemp -d)"
mkdir empty && npx -y ipfs-car@3.1.0 pack empty --output empty.car
printf 'hello world\n' > hello.txt && npx -y ipfs-car@3.1.0 pack hello.txt --output hello.car
node -e "const b=Buffer.alloc(3*1048576+5);for(let i=0;i<b.length;i++)b[i]=(i*31+7)&255;require('fs').writeFileSync('big.bin',b)"
npx -y ipfs-car@3.1.0 pack big.bin --output big.car
cd -
```

Expected, one CID per `pack`, in order:

```
bafybeiczsscdsbs7ffqz55asqdf3smv6klcw3gofszvwlyarci47bgf354
bafybeidhkumeonuwkebh2i4fc7o7lguehauradvlk57gzake6ggjsy372a
bafybeibsypx75covabyts42kbx5yq2xiasowldpx4qekkzg2zphsoithva
```

If any line differs, stop and report it; do not edit the test to match the code.

- [ ] **Step 4: Write the packer**

Create `services/render/src/car.ts`:

```ts
import { CarWriter } from '@ipld/car'
import * as UnixFS from '@ipld/unixfs'
import type { FileLink } from '@ipld/unixfs/directory'
import { withWidth } from '@ipld/unixfs/file/layout/balanced'
import { withMaxChunkSize } from '@ipld/unixfs/file/chunker/fixed'
import { CID } from 'multiformats/cid'
import * as raw from 'multiformats/codecs/raw'
import { RenderProblem } from './problems'

export type PackedDirectory = { car: Uint8Array; cid: string; size: number }

/** Kubo's switch point: a directory whose plain block would exceed this many bytes is HAMT-sharded. */
export const SHARD_THRESHOLD = 262_144

/**
 * Fixed UnixFS settings (spec section 8): CIDv1 (the library default linker), sha2-256 (the default
 * hasher), raw leaves, 1,048,576 byte chunks, balanced layout 1024 links wide (as `ipfs-car`).
 * Sharded directories use the library's HAMT: fanout 256, murmur3-x64-64, as Kubo.
 */
const SETTINGS = UnixFS.configure({
  chunker: withMaxChunkSize(1_048_576),
  fileChunkEncoder: raw,
  smallFileEncoder: raw,
  fileLayout: withWidth(1024),
})

type Entry = { name: string; link: FileLink }

const encoder = new TextEncoder()

/** Byte order of two UTF-8 names. */
function compareNames(a: Uint8Array, b: Uint8Array): number {
  const length = Math.min(a.length, b.length)
  for (let i = 0; i < length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!
  return a.length - b.length
}

/** Whether a plain directory block of this many bytes must be sharded instead. */
export function needsShard(plainBlockBytes: number): boolean {
  return plainBlockBytes > SHARD_THRESHOLD
}

/** The encoded size of the plain directory block over these entries, written to a throwaway stream. */
async function plainDirectoryBytes(entries: Entry[]): Promise<number> {
  let size = 0
  const probe = UnixFS.createWriter({
    writable: new WritableStream<UnixFS.Block>({
      write(block) {
        size = block.bytes.byteLength
      },
    }),
    settings: SETTINGS,
  })
  const directory = UnixFS.createDirectoryWriter(probe)
  for (const { name, link } of entries) directory.set(name, link)
  await directory.close()
  await probe.close()
  return size
}

/** The blocks as one CARv1 with `root` as its single root; a block repeated by identical files is written once. */
async function encodeCar(root: CID, blocks: UnixFS.Block[]): Promise<Uint8Array> {
  const { writer, out } = CarWriter.create([root])
  const chunks: Uint8Array[] = []
  const drained = (async () => {
    for await (const chunk of out) chunks.push(chunk)
  })()
  const written = new Set<string>()
  for (const block of blocks) {
    const key = block.cid.toString()
    if (written.has(key)) continue
    written.add(key)
    // @ipld/unixfs and @ipld/car carry different multiformats majors; the CID bytes are the same.
    await writer.put({ cid: CID.decode(block.cid.bytes), bytes: block.bytes })
  }
  await writer.close()
  await drained
  const car = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0))
  let offset = 0
  for (const chunk of chunks) {
    car.set(chunk, offset)
    offset += chunk.byteLength
  }
  return car
}

/**
 * Packs files into one UnixFS directory inside a CAR and returns the CAR, the directory's CID as a
 * base32 string and the CAR length. Files are sorted by name bytes; a repeated name is refused.
 */
export async function packDirectory(files: { name: string; bytes: Uint8Array }[]): Promise<PackedDirectory> {
  const sorted = files
    .map((file) => ({ ...file, key: encoder.encode(file.name) }))
    .sort((a, b) => compareNames(a.key, b.key))
  for (let i = 1; i < sorted.length; i++)
    if (compareNames(sorted[i - 1]!.key, sorted[i]!.key) === 0)
      throw new RenderProblem('duplicate-name', `Two files are named ${sorted[i]!.name}.`, {
        detail: { name: sorted[i]!.name },
      })

  const blocks: UnixFS.Block[] = []
  const writer = UnixFS.createWriter({
    writable: new WritableStream<UnixFS.Block>({
      write(block) {
        blocks.push(block)
      },
    }),
    settings: SETTINGS,
  })
  const entries: Entry[] = []
  for (const file of sorted) {
    const fileWriter = UnixFS.createFileWriter(writer)
    await fileWriter.write(file.bytes)
    entries.push({ name: file.name, link: await fileWriter.close() })
  }
  const directory = needsShard(await plainDirectoryBytes(entries))
    ? UnixFS.createShardedDirectoryWriter(writer)
    : UnixFS.createDirectoryWriter(writer)
  for (const { name, link } of entries) directory.set(name, link)
  const root = await directory.close()
  await writer.close()

  const cid = CID.decode(root.cid.bytes)
  const car = await encodeCar(cid, blocks)
  return { car, cid: cid.toString(), size: car.byteLength }
}
```

Append to `services/render/src/index.ts`:

```ts
export { packDirectory } from './car'
export type { PackedDirectory } from './car'
```

- [ ] **Step 5: Run the tests and checks**

Run:

```bash
pnpm --filter @cobweb/render exec vitest run src/car.test.ts
pnpm --filter @cobweb/render typecheck && pnpm --filter @cobweb/render lint
```

Expected: 9 tests pass (about a second, most of it the 6,000 entry HAMT); typecheck and lint clean. If the two `ipfs-car` vectors fail while the empty directory passes, the leaf encoder or chunk size is wrong (`fileChunkEncoder` and `smallFileEncoder` must both be `raw`, the chunker `withMaxChunkSize(1_048_576)`).

- [ ] **Step 6: Commit**

```bash
pnpm exec prettier --write services/render
pnpm typecheck && pnpm lint && pnpm test
git add services/render/src
git commit -m "$(cat <<'EOF'
Pack files into a UnixFS directory CAR with a locally computed CID, sharding past 256 KiB

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bcHX4HZG5YGWhxjGuiWos
EOF
)"
```

---

### Task 5: Rendering a batch

**Files:**

- Create: `services/render/src/pool.ts`, `services/render/src/batch.ts`
- Modify: `services/render/src/fixtures.ts`, `services/render/src/index.ts`
- Test: `services/render/src/pool.test.ts`, `services/render/src/batch.test.ts`

**Interfaces:**

- Consumes: `RenderProblem`, `forToken` (Task 1); `compositeToken` (Task 2); `assertExtraFields` (Task 3); `isGenerativeToken`, `batchOf`, `resolveTraits` (Task 3); `packDirectory`, `PackedDirectory` (Task 4); fixtures `flatPng`, `pixel` (Task 2), `TEXT`, `owlSpec`, `owlImages` (Task 3), `readCarFiles` (Task 4).
- Produces: from `./pool`: `mapLimit<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]>`. From `./batch`: `type RenderedBatch = PackedDirectory & { batchNo: number; files: { name: string; bytes: Uint8Array }[] }` and `renderBatch(spec: GenerativeSpec | AssetSpec, batchNo: number, tokens: (GenerativeToken | AssetToken)[], loadImage: LoadImage, options?: { concurrency?: number }): Promise<RenderedBatch>`. From `./fixtures`: `memoryLoader(images: Record<string, Uint8Array>): LoadImage & { calls: Map<string, number> }`.

Decision: `batch-range` also refuses an empty token list and an id that is not an integer of at least 1. `files` come back in id order. A token of the wrong shape is refused: an asset token in a generative batch is `bad-dna` ("has no DNA"), a generative token in an asset batch is `missing-image` ("has no image"). A non-blank trait with a null image is `missing-image` naming the trait. A blank's image, if any, is ignored.

Decision: images are cached per batch as promises keyed by `ImageRef.key`, so two tokens in flight that need the same key share one load; a rejected load becomes `missing-image` for whichever token awaited it. A `layer-size` or `decode` problem from `compositeToken` is re-thrown through `forToken`, so its message starts "Token <id>: " and it carries the token id.

Decision: `mapLimit` never rejects early. After the first failure it starts no new token, waits for the tokens in flight, then rejects with that first failure (Review Focus 5); `concurrency` is floored and kept between 1 and the token count.

- [ ] **Step 1: Write the failing tests and the loader**

In `services/render/src/fixtures.ts`, change the types import to `import type { GenerativeSpec, ImageRef, LoadImage, MetadataText } from './types'` and insert this after `pngChunks` (before `const RAW_CODE`):

```ts
/** A loader over a key to bytes map. Throws for an unknown key and counts every call by key. */
export function memoryLoader(images: Record<string, Uint8Array>): LoadImage & { calls: Map<string, number> } {
  const calls = new Map<string, number>()
  const load = async (ref: ImageRef) => {
    calls.set(ref.key, (calls.get(ref.key) ?? 0) + 1)
    const bytes = images[ref.key]
    if (!bytes) throw new Error(`No object at ${ref.key}`)
    return bytes
  }
  return Object.assign(load, { calls })
}
```

Create `services/render/src/pool.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { mapLimit } from './pool'

const tick = () => new Promise((resolve) => setTimeout(resolve, 1))

describe('mapLimit', () => {
  it('keeps input order and never runs more than the limit at once', async () => {
    let running = 0
    let peak = 0
    const out = await mapLimit([5, 1, 4, 2, 3], 2, async (n) => {
      running++
      peak = Math.max(peak, running)
      await tick()
      running--
      return n * 10
    })
    expect(out).toEqual([50, 10, 40, 20, 30])
    expect(peak).toBe(2)
  })

  it('rejects with the first failure after the work in flight settles, and starts nothing new', async () => {
    const started: number[] = []
    let settled = 0
    const error = await mapLimit([1, 2, 3, 4, 5, 6], 2, async (n) => {
      started.push(n)
      await tick()
      settled++
      if (n === 2) throw new Error('two failed')
      return n
    }).catch((e: unknown) => e)
    expect((error as Error).message).toBe('two failed')
    expect(settled).toBe(started.length)
    expect(started.length).toBeLessThan(6)
  })

  it('handles an empty list', async () => {
    expect(await mapLimit([], 4, async (n: number) => n)).toEqual([])
  })
})
```

Create `services/render/src/batch.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { renderBatch } from './batch'
import { packDirectory } from './car'
import { flatPng, memoryLoader, owlImages, owlSpec, pixel, readCarFiles, TEXT } from './fixtures'
import type { AssetSpec, AssetToken, GenerativeToken } from './types'

const owl = (id: number, dna: string[]): GenerativeToken => ({
  id,
  collectionId: 'owls',
  dna,
  description: null,
})
const tokens = [
  owl(3, ['bg-ink', 'eyes-wide', 'hat-cap']),
  owl(1, ['bg-ink', 'eyes-wide', 'hat-none']),
  owl(2, ['bg-dusk', 'eyes-sleepy', 'hat-none']),
]

describe('renderBatch, generative', () => {
  it('names files by id, in id order, and packs exactly those files', async () => {
    const batch = await renderBatch(owlSpec(), 0, tokens, memoryLoader(await owlImages()))
    expect(batch.batchNo).toBe(0)
    expect(batch.files.map((f) => f.name)).toEqual(['1.png', '2.png', '3.png'])
    expect(batch.cid).toBe((await packDirectory(batch.files)).cid)
    const { files } = await readCarFiles(batch.car)
    expect(files.get('3.png')).toEqual(batch.files[2]!.bytes)
  })

  it('composites the layers: the cap covers the eyes, the ink background shows at the edge', async () => {
    const batch = await renderBatch(owlSpec(), 0, [tokens[0]!], memoryLoader(await owlImages()))
    const png = batch.files[0]!.bytes
    expect(await pixel(png, 1, 1)).toEqual([20, 20, 60, 255])
    expect((await pixel(png, 32, 32))[0]).toBeGreaterThan(150)
  })

  it('loads each distinct key once per batch', async () => {
    const loader = memoryLoader(await owlImages())
    await renderBatch(owlSpec(), 0, tokens, loader)
    expect(Object.fromEntries(loader.calls)).toEqual({
      'bg-ink.png': 1,
      'bg-dusk.png': 1,
      'eyes-wide.png': 1,
      'eyes-sleepy.png': 1,
      'hat-cap.png': 1,
    })
  })

  it('refuses a token from another batch, an empty batch and an id below 1', async () => {
    const loader = memoryLoader(await owlImages())
    await expect(
      renderBatch(owlSpec(), 0, [owl(101, ['bg-ink', 'eyes-wide', 'hat-none'])], loader),
    ).rejects.toMatchObject({
      code: 'batch-range',
      tokenId: 101,
    })
    await expect(renderBatch(owlSpec(), 1, [], loader)).rejects.toMatchObject({ code: 'batch-range' })
    await expect(
      renderBatch(owlSpec(), 0, [owl(0, ['bg-ink', 'eyes-wide', 'hat-none'])], loader),
    ).rejects.toMatchObject({
      code: 'batch-range',
      tokenId: 0,
    })
  })

  it('refuses a DNA naming an unknown trait, naming the token', async () => {
    await expect(
      renderBatch(
        owlSpec(),
        0,
        [owl(4, ['bg-ink', 'eyes-gone', 'hat-none'])],
        memoryLoader(await owlImages()),
      ),
    ).rejects.toMatchObject({ code: 'bad-dna', tokenId: 4 })
  })

  it('turns a thrown load into missing-image naming the key and the token', async () => {
    const images = await owlImages()
    delete images['eyes-sleepy.png']
    await expect(renderBatch(owlSpec(), 0, tokens, memoryLoader(images))).rejects.toMatchObject({
      code: 'missing-image',
      tokenId: 2,
      detail: { key: 'eyes-sleepy.png' },
    })
  })

  it('rejects the whole batch when one token fails, naming it', async () => {
    const images = {
      ...(await owlImages()),
      'hat-cap.png': await flatPng({ r: 1, g: 2, b: 3, alpha: 1 }, 32),
    }
    const error = await renderBatch(owlSpec(), 0, tokens, memoryLoader(images)).catch((e: unknown) => e)
    expect(error).toMatchObject({ code: 'layer-size', tokenId: 3 })
    expect((error as Error).message).toBe('Token 3: Layer 3 is 32 by 32 pixels; the canvas is 64 by 64.')
  })

  it('wraps an unreadable layer as decode naming the token', async () => {
    const images = { ...(await owlImages()), 'bg-dusk.png': new Uint8Array([9, 9, 9]) }
    await expect(renderBatch(owlSpec(), 0, tokens, memoryLoader(images))).rejects.toMatchObject({
      code: 'decode',
      tokenId: 2,
    })
  })

  it('refuses two tokens with the same id', async () => {
    await expect(
      renderBatch(owlSpec(), 0, [tokens[1]!, tokens[1]!], memoryLoader(await owlImages())),
    ).rejects.toMatchObject({ code: 'duplicate-name' })
  })

  it('gives the same CID at concurrency 1 and 4', async () => {
    const images = await owlImages()
    const one = await renderBatch(owlSpec(), 0, tokens, memoryLoader(images), { concurrency: 1 })
    const four = await renderBatch(owlSpec(), 0, tokens, memoryLoader(images), { concurrency: 4 })
    expect(four.cid).toBe(one.cid)
  })

  it('refuses a reserved extra field before rendering anything', async () => {
    const spec = { ...owlSpec(), text: { ...TEXT, extraFields: { image: 'x' } } }
    const loader = memoryLoader(await owlImages())
    await expect(renderBatch(spec, 0, tokens, loader)).rejects.toMatchObject({ code: 'reserved-key' })
    expect(loader.calls.size).toBe(0)
  })
})

describe('renderBatch, 1/1 and single asset', () => {
  const gif = new TextEncoder().encode('GIF89a not decoded')
  const mp4 = new TextEncoder().encode('....ftypisom not decoded')
  const assets: AssetToken[] = [
    { id: 2, image: { key: 'two.mp4', ext: 'mp4' }, attributes: [] },
    { id: 1, image: { key: 'one.gif', ext: 'gif' }, attributes: [] },
  ]
  const spec: AssetSpec = { kind: 'one_of_one', text: TEXT, batchSize: 100 }

  it('passes the bytes through unchanged with their extension', async () => {
    const batch = await renderBatch(spec, 0, assets, memoryLoader({ 'one.gif': gif, 'two.mp4': mp4 }))
    expect(batch.files).toEqual([
      { name: '1.gif', bytes: gif },
      { name: '2.mp4', bytes: mp4 },
    ])
  })

  it('reads a single asset shared by every token once', async () => {
    const shared: AssetToken[] = [1, 2, 3].map((id) => ({
      id,
      image: { key: 'art.gif', ext: 'gif' },
      attributes: [],
    }))
    const loader = memoryLoader({ 'art.gif': gif })
    const batch = await renderBatch({ ...spec, kind: 'single_asset' }, 0, shared, loader)
    expect(batch.files.map((f) => f.name)).toEqual(['1.gif', '2.gif', '3.gif'])
    expect(loader.calls.get('art.gif')).toBe(1)
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @cobweb/render exec vitest run src/pool.test.ts src/batch.test.ts`
Expected: FAIL; the files cannot import `./pool` or `./batch`.

- [ ] **Step 3: Write the pool and the batch renderer**

Create `services/render/src/pool.ts`:

```ts
/**
 * Runs `work` over `items` with at most `limit` in flight and returns the results in input order.
 * After the first failure no new item starts; the call waits for the ones in flight, then rejects
 * with that first failure, so nothing keeps running once it has settled.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  const failures: unknown[] = []
  let next = 0
  const worker = async () => {
    while (failures.length === 0 && next < items.length) {
      const index = next++
      try {
        results[index] = await work(items[index]!)
      } catch (error) {
        failures.push(error)
      }
    }
  }
  const width = Math.max(1, Math.min(Math.floor(limit) || 1, items.length))
  await Promise.all(Array.from({ length: width }, () => worker()))
  if (failures.length > 0) throw failures[0]
  return results
}
```

Create `services/render/src/batch.ts`:

```ts
import { packDirectory } from './car'
import type { PackedDirectory } from './car'
import { compositeToken } from './composite'
import { batchOf, isGenerativeToken, resolveTraits } from './generative'
import { assertExtraFields } from './metadata'
import { mapLimit } from './pool'
import { forToken, RenderProblem } from './problems'
import type { AssetSpec, AssetToken, GenerativeSpec, GenerativeToken, ImageRef, LoadImage } from './types'

export type RenderedBatch = PackedDirectory & {
  batchNo: number
  files: { name: string; bytes: Uint8Array }[]
}

type CachedLoad = (ref: ImageRef, tokenId: number) => Promise<Uint8Array>

/** Loads each distinct key once per batch; a failed load is `missing-image` naming the key and the token. */
function cachedLoader(loadImage: LoadImage): CachedLoad {
  const cache = new Map<string, Promise<Uint8Array>>()
  return async (ref, tokenId) => {
    let pending = cache.get(ref.key)
    if (!pending) {
      pending = Promise.resolve().then(() => loadImage(ref))
      cache.set(ref.key, pending)
    }
    try {
      return await pending
    } catch {
      throw new RenderProblem(
        'missing-image',
        `The image ${ref.key} for token ${tokenId} could not be loaded.`,
        {
          tokenId,
          detail: { key: ref.key },
        },
      )
    }
  }
}

/** Every token must fall in this batch; an empty batch or an id below 1 is refused too. */
function checkRange(batchSize: number, batchNo: number, tokens: { id: number }[]): void {
  if (tokens.length === 0)
    throw new RenderProblem('batch-range', `Batch ${batchNo} has no tokens.`, { detail: { batchNo } })
  for (const { id } of tokens)
    if (!Number.isInteger(id) || id < 1 || batchOf(id, batchSize) !== batchNo)
      throw new RenderProblem(
        'batch-range',
        `Token ${id} is not in batch ${batchNo} of ${batchSize} tokens each.`,
        {
          tokenId: id,
          detail: { batchNo, batchSize },
        },
      )
}

async function renderGenerative(
  spec: GenerativeSpec,
  token: GenerativeToken | AssetToken,
  load: CachedLoad,
): Promise<{ name: string; bytes: Uint8Array }> {
  if (!isGenerativeToken(token))
    throw new RenderProblem('bad-dna', `Token ${token.id} has no DNA; a generative batch needs it.`, {
      tokenId: token.id,
    })
  const layers: { bytes: Uint8Array; opacity: number }[] = []
  for (const { layer, trait } of resolveTraits(spec, token).picks) {
    if (trait.blank) continue
    if (!trait.image)
      throw new RenderProblem('missing-image', `Trait ${trait.name} on token ${token.id} has no image.`, {
        tokenId: token.id,
        detail: { trait: trait.id },
      })
    layers.push({ bytes: await load(trait.image, token.id), opacity: layer.opacity })
  }
  try {
    return { name: `${token.id}.png`, bytes: await compositeToken(spec.canvas, layers) }
  } catch (error) {
    throw error instanceof RenderProblem ? forToken(error, token.id) : error
  }
}

async function passThrough(
  spec: AssetSpec,
  token: GenerativeToken | AssetToken,
  load: CachedLoad,
): Promise<{ name: string; bytes: Uint8Array }> {
  if (isGenerativeToken(token))
    throw new RenderProblem(
      'missing-image',
      `Token ${token.id} has no image; a ${spec.kind} batch needs one per token.`,
      {
        tokenId: token.id,
      },
    )
  return { name: `${token.id}.${token.image.ext}`, bytes: await load(token.image, token.id) }
}

/**
 * Renders one batch: composited PNGs for a generative spec, the stored bytes unchanged for 1/1 and
 * single asset, packed into one CAR. Any failure rejects the whole call; there is no partial output.
 */
export async function renderBatch(
  spec: GenerativeSpec | AssetSpec,
  batchNo: number,
  tokens: (GenerativeToken | AssetToken)[],
  loadImage: LoadImage,
  options: { concurrency?: number } = {},
): Promise<RenderedBatch> {
  assertExtraFields(spec.text)
  checkRange(spec.batchSize, batchNo, tokens)
  const load = cachedLoader(loadImage)
  const ordered = [...tokens].sort((a, b) => a.id - b.id)
  const files = await mapLimit(ordered, options.concurrency ?? 4, (token) =>
    spec.kind === 'generative' ? renderGenerative(spec, token, load) : passThrough(spec, token, load),
  )
  return { ...(await packDirectory(files)), batchNo, files }
}
```

Append to `services/render/src/index.ts`:

```ts
export { renderBatch } from './batch'
export type { RenderedBatch } from './batch'
```

- [ ] **Step 4: Run the tests and checks**

Run:

```bash
pnpm --filter @cobweb/render exec vitest run src/pool.test.ts src/batch.test.ts
pnpm --filter @cobweb/render typecheck && pnpm --filter @cobweb/render lint
```

Expected: 16 tests pass (3 and 13); typecheck and lint clean.

- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write services/render
pnpm typecheck && pnpm lint && pnpm test
git add services/render/src
git commit -m "$(cat <<'EOF'
Render a batch of tokens into one CAR, loading each image once and failing the batch as a whole

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bcHX4HZG5YGWhxjGuiWos
EOF
)"
```

---

### Task 6: The metadata set and the placeholder

**Files:**

- Create: `services/render/src/metadata-set.ts`, `services/render/src/placeholder.ts`
- Modify: `services/render/src/index.ts`
- Test: `services/render/src/metadata-set.test.ts`, `services/render/src/placeholder.test.ts`

**Interfaces:**

- Consumes: `RenderProblem` (Task 1); `assertExtraFields`, `tokenMetadataJson`, `placeholderMetadataJson`, `SHARED_METADATA_FILE` (Task 3); `attributesFor`, `batchOf`, `isGenerativeToken` (Task 3); `packDirectory`, `PackedDirectory` (Task 4); fixtures `TEXT`, `owlSpec` (Task 3), `readCarFiles` (Task 4), `memoryLoader` (Task 5).
- Produces: from `./metadata-set`: `type RenderedMetadata = PackedDirectory & { baseUri: string }` and `renderMetadataSet(spec: GenerativeSpec | AssetSpec, tokens: (GenerativeToken | AssetToken)[], imageCids: Map<number, string>): Promise<RenderedMetadata>`. From `./placeholder`: `renderPlaceholder(spec: PlaceholderSpec, loadImage: LoadImage): Promise<{ image: PackedDirectory; metadata: RenderedMetadata }>`.

Decision: `missing-batch` is checked for every token before any JSON is written, single asset included (spec section 9: "every token's batch must have a CID"). A single asset's one `metadata.json` describes token 1 as the spec says; when token 1 is not in the list the call is refused with `batch-range` ("Single asset metadata describes token 1, which is not in the list."), since the spec names no code for it.

Decision: the generative attributes go through `attributesFor` (Task 3), which checks the DNA first, so a token the batch would refuse with `bad-dna` is refused here too instead of getting short attributes.

- [ ] **Step 1: Write the failing tests**

Create `services/render/src/metadata-set.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { owlSpec, readCarFiles, TEXT } from './fixtures'
import { renderMetadataSet } from './metadata-set'
import type { AssetSpec, AssetToken, GenerativeToken } from './types'

const owls: GenerativeToken[] = Array.from({ length: 300 }, (_, i) => ({
  id: i + 1,
  collectionId: 'owls',
  dna: [i % 2 ? 'bg-dusk' : 'bg-ink', 'eyes-wide', i % 3 ? 'hat-none' : 'hat-cap'],
  description: i === 99 ? 'The hundredth owl.' : null,
}))
const imageCids = new Map([
  [0, 'bafyzero'],
  [1, 'bafyone'],
  [2, 'bafytwo'],
])
const parse = (bytes: Uint8Array | undefined) => JSON.parse(new TextDecoder().decode(bytes))

describe('renderMetadataSet, generative', () => {
  it('points each image into its own batch, for ids 1, 100, 101 and 300', async () => {
    const set = await renderMetadataSet(owlSpec(), owls, imageCids)
    const { files } = await readCarFiles(set.car)
    expect(parse(files.get('1')).image).toBe('ipfs://bafyzero/1.png')
    expect(parse(files.get('100')).image).toBe('ipfs://bafyzero/100.png')
    expect(parse(files.get('101')).image).toBe('ipfs://bafyone/101.png')
    expect(parse(files.get('300')).image).toBe('ipfs://bafytwo/300.png')
    expect(parse(files.get('100')).description).toBe('The hundredth owl.')
  })

  it('names files by bare id and ends the base URI with a slash', async () => {
    const set = await renderMetadataSet(owlSpec(), owls, imageCids)
    const { files, root } = await readCarFiles(set.car)
    expect(files.size).toBe(300)
    expect([...files.keys()].every((name) => /^[1-9][0-9]*$/.test(name))).toBe(true)
    expect(root).toBe(set.cid)
    expect(set.baseUri).toBe(`ipfs://${set.cid}/`)
  })

  it('refuses a token whose batch has no image CID', async () => {
    await expect(renderMetadataSet(owlSpec(), owls, new Map([[0, 'bafyzero']]))).rejects.toMatchObject({
      code: 'missing-batch',
      tokenId: 101,
      detail: { batchNo: 1 },
    })
  })

  it('refuses a DNA naming an unknown trait instead of writing short attributes', async () => {
    const bad = [{ ...owls[0]!, dna: ['bg-ink', 'eyes-gone', 'hat-none'] }]
    await expect(renderMetadataSet(owlSpec(), bad, imageCids)).rejects.toMatchObject({
      code: 'bad-dna',
      tokenId: 1,
    })
  })
})

describe('renderMetadataSet, 1/1', () => {
  it("uses each asset's own extension and stored attributes", async () => {
    const spec: AssetSpec = { kind: 'one_of_one', text: TEXT, batchSize: 100 }
    const tokens: AssetToken[] = [
      { id: 1, image: { key: 'a', ext: 'gif' }, attributes: [{ trait_type: 'Mood', value: 'Calm' }] },
      { id: 2, image: { key: 'b', ext: 'mp4' }, attributes: [] },
    ]
    const set = await renderMetadataSet(spec, tokens, imageCids)
    const { files } = await readCarFiles(set.car)
    expect(parse(files.get('1'))).toEqual({
      name: 'Owl #1',
      description: 'A night owl.',
      image: 'ipfs://bafyzero/1.gif',
      attributes: [{ trait_type: 'Mood', value: 'Calm' }],
    })
    expect(parse(files.get('2')).image).toBe('ipfs://bafyzero/2.mp4')
    expect(set.baseUri).toBe(`ipfs://${set.cid}/`)
  })
})

describe('renderMetadataSet, single asset', () => {
  const spec: AssetSpec = { kind: 'single_asset', text: TEXT, batchSize: 100 }
  const tokens: AssetToken[] = Array.from({ length: 150 }, (_, i) => ({
    id: i + 1,
    image: { key: 'art', ext: 'gif' },
    attributes: [],
  }))

  it('writes one metadata.json for token 1 and a base URI with no trailing slash', async () => {
    const set = await renderMetadataSet(spec, tokens, imageCids)
    const { files } = await readCarFiles(set.car)
    expect([...files.keys()]).toEqual(['metadata.json'])
    expect(parse(files.get('metadata.json')).image).toBe('ipfs://bafyzero/1.gif')
    expect(set.baseUri).toBe(`ipfs://${set.cid}/metadata.json`)
  })

  it('still requires every batch to have a CID', async () => {
    await expect(renderMetadataSet(spec, tokens, new Map([[0, 'bafyzero']]))).rejects.toMatchObject({
      code: 'missing-batch',
      tokenId: 101,
    })
  })
})
```

Create `services/render/src/placeholder.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { memoryLoader, readCarFiles } from './fixtures'
import { renderPlaceholder } from './placeholder'
import type { PlaceholderSpec } from './types'

const gif = new TextEncoder().encode('GIF89a placeholder bytes')
const mp4 = new TextEncoder().encode('....ftypisom placeholder bytes')
const spec = (ext: 'gif' | 'mp4'): PlaceholderSpec => ({
  kind: 'placeholder',
  image: { key: `soon.${ext}`, ext },
  name: 'Owls',
  description: 'Revealed soon.',
})

describe('renderPlaceholder', () => {
  for (const [ext, bytes] of [
    ['gif', gif],
    ['mp4', mp4],
  ] as const)
    it(`passes ${ext.toUpperCase()} bytes through with their extension`, async () => {
      const { image } = await renderPlaceholder(spec(ext), memoryLoader({ [`soon.${ext}`]: bytes }))
      const { files } = await readCarFiles(image.car)
      expect([...files.keys()]).toEqual([`placeholder.${ext}`])
      expect(files.get(`placeholder.${ext}`)).toEqual(bytes)
    })

  it('writes one metadata.json pointing at the image, with a slash-less base URI', async () => {
    const { image, metadata } = await renderPlaceholder(spec('gif'), memoryLoader({ 'soon.gif': gif }))
    const { files } = await readCarFiles(metadata.car)
    expect(JSON.parse(new TextDecoder().decode(files.get('metadata.json')))).toEqual({
      name: 'Owls',
      description: 'Revealed soon.',
      image: `ipfs://${image.cid}/placeholder.gif`,
    })
    expect(metadata.baseUri).toBe(`ipfs://${metadata.cid}/metadata.json`)
  })

  it('turns a failed load into missing-image naming the key', async () => {
    await expect(renderPlaceholder(spec('gif'), memoryLoader({}))).rejects.toMatchObject({
      code: 'missing-image',
      detail: { key: 'soon.gif' },
    })
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @cobweb/render exec vitest run src/metadata-set.test.ts src/placeholder.test.ts`
Expected: FAIL; the files cannot import `./metadata-set` or `./placeholder`.

- [ ] **Step 3: Write the metadata set and the placeholder**

Create `services/render/src/metadata-set.ts`:

```ts
import { packDirectory } from './car'
import type { PackedDirectory } from './car'
import { attributesFor, batchOf, isGenerativeToken } from './generative'
import { assertExtraFields, SHARED_METADATA_FILE, tokenMetadataJson } from './metadata'
import { RenderProblem } from './problems'
import type { AssetSpec, AssetToken, GenerativeSpec, GenerativeToken } from './types'

export type RenderedMetadata = PackedDirectory & { baseUri: string }

function imageCidOf(imageCids: Map<number, string>, batchSize: number, tokenId: number): string {
  const batchNo = batchOf(tokenId, batchSize)
  const cid = imageCids.get(batchNo)
  if (cid === undefined)
    throw new RenderProblem(
      'missing-batch',
      `Token ${tokenId} is in batch ${batchNo}, which has no image CID.`,
      {
        tokenId,
        detail: { batchNo },
      },
    )
  return cid
}

/**
 * Writes every token's metadata JSON, its `image` pointing into its batch's image CID, and packs
 * the set into one CAR. Generative and 1/1 files are named by bare id with a trailing-slash base
 * URI; a single asset writes one `metadata.json` (token 1) with a slash-less base URI.
 */
export async function renderMetadataSet(
  spec: GenerativeSpec | AssetSpec,
  tokens: (GenerativeToken | AssetToken)[],
  imageCids: Map<number, string>,
): Promise<RenderedMetadata> {
  assertExtraFields(spec.text)
  const cids = new Map(tokens.map((token) => [token.id, imageCidOf(imageCids, spec.batchSize, token.id)]))
  const attributesOf = spec.kind === 'generative' ? attributesFor(spec) : null

  const jsonOf = (token: GenerativeToken | AssetToken): Uint8Array => {
    const cid = cids.get(token.id)!
    if (attributesOf) {
      if (!isGenerativeToken(token))
        throw new RenderProblem('bad-dna', `Token ${token.id} has no DNA; generative metadata needs it.`, {
          tokenId: token.id,
        })
      return tokenMetadataJson({
        id: token.id,
        text: spec.text,
        description: token.description,
        image: `ipfs://${cid}/${token.id}.png`,
        attributes: attributesOf(token),
      })
    }
    if (isGenerativeToken(token))
      throw new RenderProblem(
        'missing-image',
        `Token ${token.id} has no image; ${spec.kind} metadata needs one.`,
        {
          tokenId: token.id,
        },
      )
    return tokenMetadataJson({
      id: token.id,
      text: spec.text,
      description: null,
      image: `ipfs://${cid}/${token.id}.${token.image.ext}`,
      attributes: token.attributes,
    })
  }

  if (spec.kind === 'single_asset') {
    const first = tokens.find((token) => token.id === 1)
    if (!first)
      throw new RenderProblem(
        'batch-range',
        'Single asset metadata describes token 1, which is not in the list.',
        {
          detail: { tokenId: 1 },
        },
      )
    const packed = await packDirectory([{ name: SHARED_METADATA_FILE, bytes: jsonOf(first) }])
    return { ...packed, baseUri: `ipfs://${packed.cid}/${SHARED_METADATA_FILE}` }
  }

  const packed = await packDirectory(
    tokens.map((token) => ({ name: String(token.id), bytes: jsonOf(token) })),
  )
  return { ...packed, baseUri: `ipfs://${packed.cid}/` }
}
```

Create `services/render/src/placeholder.ts`:

```ts
import { packDirectory } from './car'
import type { PackedDirectory } from './car'
import { placeholderMetadataJson, SHARED_METADATA_FILE } from './metadata'
import type { RenderedMetadata } from './metadata-set'
import { RenderProblem } from './problems'
import type { LoadImage, PlaceholderSpec } from './types'

/**
 * The pre-reveal placeholder: its image passed through as `placeholder.<ext>` in its own directory,
 * and one `metadata.json` pointing at it, with a slash-less base URI so every token returns it.
 */
export async function renderPlaceholder(
  spec: PlaceholderSpec,
  loadImage: LoadImage,
): Promise<{ image: PackedDirectory; metadata: RenderedMetadata }> {
  let bytes: Uint8Array
  try {
    bytes = await loadImage(spec.image)
  } catch {
    throw new RenderProblem('missing-image', `The placeholder image ${spec.image.key} could not be loaded.`, {
      detail: { key: spec.image.key },
    })
  }
  const fileName = `placeholder.${spec.image.ext}`
  const image = await packDirectory([{ name: fileName, bytes }])
  const json = placeholderMetadataJson({
    name: spec.name,
    description: spec.description,
    image: `ipfs://${image.cid}/${fileName}`,
  })
  const packed = await packDirectory([{ name: SHARED_METADATA_FILE, bytes: json }])
  return { image, metadata: { ...packed, baseUri: `ipfs://${packed.cid}/${SHARED_METADATA_FILE}` } }
}
```

Append to `services/render/src/index.ts`:

```ts
export { renderMetadataSet } from './metadata-set'
export type { RenderedMetadata } from './metadata-set'
export { renderPlaceholder } from './placeholder'
```

- [ ] **Step 4: Run the tests and checks**

Run:

```bash
pnpm --filter @cobweb/render exec vitest run src/metadata-set.test.ts src/placeholder.test.ts
pnpm --filter @cobweb/render typecheck && pnpm --filter @cobweb/render lint
```

Expected: 11 tests pass (7 and 4); typecheck and lint clean.

- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write services/render
pnpm typecheck && pnpm lint && pnpm test
git add services/render/src
git commit -m "$(cat <<'EOF'
Render the metadata set and the placeholder pair with their base URIs

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bcHX4HZG5YGWhxjGuiWos
EOF
)"
```

---

### Task 7: The preview collage

**Files:**

- Create: `services/render/src/collage.ts`
- Modify: `services/render/src/index.ts`
- Test: `services/render/src/collage.test.ts`

**Interfaces:**

- Consumes: `RenderProblem`, `reasonOf` (Task 1); `PNG_OPTIONS`, `TRANSPARENT`, `bytesOf`, `sharp` (Task 2); fixtures `flatPng`, `pixel`, `sizeOf` (Task 2).
- Produces: from `./collage`: `previewCollage(images: Uint8Array[], options?: { columns?: number; cell?: number }): Promise<Uint8Array>`.

Decision: the grid is `columns` wide and `ceil(images / columns)` rows tall, so 16 images at the defaults give 1024 by 1024 and 3 images give 1024 by 256 with the fourth cell transparent ("fewer images than cells leaves the rest transparent", spec section 10). Each image is resized with `fit: 'contain'` on a transparent background, then made 8-bit sRGBA. An image sharp cannot read is `decode` with `detail.index` (0-based) and `detail.reason`.

- [ ] **Step 1: Write the failing test**

Create `services/render/src/collage.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { previewCollage } from './collage'
import { flatPng, pixel, sizeOf } from './fixtures'

const colours = (count: number) =>
  Promise.all(Array.from({ length: count }, (_, i) => flatPng({ r: i * 15, g: 100, b: 200, alpha: 1 })))

describe('previewCollage', () => {
  it('lays 16 images out as a 1024 by 1024 PNG, 4 across', async () => {
    const png = await previewCollage(await colours(16))
    expect(await sizeOf(png)).toEqual({ width: 1024, height: 1024, format: 'png' })
    expect(await pixel(png, 128, 128)).toEqual([0, 100, 200, 255])
    expect(await pixel(png, 3 * 256 + 128, 3 * 256 + 128)).toEqual([225, 100, 200, 255])
  })

  it('leaves the cells past the last image transparent', async () => {
    const png = await previewCollage(await colours(3))
    expect(await sizeOf(png)).toEqual({ width: 1024, height: 256, format: 'png' })
    expect(await pixel(png, 2 * 256 + 128, 128)).toEqual([30, 100, 200, 255])
    expect((await pixel(png, 3 * 256 + 128, 128))[3]).toBe(0)
  })

  it('fits a non-square image inside its cell on transparency', async () => {
    const wide = await flatPng({ r: 255, g: 0, b: 0, alpha: 1 }, 128, 64)
    const png = await previewCollage([wide], { columns: 1, cell: 256 })
    expect((await pixel(png, 128, 10))[3]).toBe(0)
    expect(await pixel(png, 128, 128)).toEqual([255, 0, 0, 255])
  })

  it('refuses an empty list', async () => {
    await expect(previewCollage([])).rejects.toMatchObject({ code: 'empty-collage' })
  })

  it('wraps bytes that are not an image as decode, naming the position', async () => {
    await expect(previewCollage([new Uint8Array([1, 2, 3])])).rejects.toMatchObject({
      code: 'decode',
      detail: { index: 0 },
    })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @cobweb/render exec vitest run src/collage.test.ts`
Expected: FAIL; the file cannot import `./collage`.

- [ ] **Step 3: Write the collage**

Create `services/render/src/collage.ts`:

```ts
import { reasonOf, RenderProblem } from './problems'
import { PNG_OPTIONS, TRANSPARENT, bytesOf, sharp } from './png'

/**
 * A preview grid of the images given (the worker passes the first 16 rendered tokens): `columns`
 * across (4), as many rows as needed, each image fitted inside a `cell` (256) pixel square on
 * transparency. Cells past the last image stay transparent.
 */
export async function previewCollage(
  images: Uint8Array[],
  options: { columns?: number; cell?: number } = {},
): Promise<Uint8Array> {
  if (images.length === 0)
    throw new RenderProblem('empty-collage', 'A preview collage needs at least one image.')
  const columns = Math.max(1, Math.floor(options.columns ?? 4))
  const cell = Math.max(1, Math.floor(options.cell ?? 256))
  const rows = Math.ceil(images.length / columns)
  const tiles: {
    input: Buffer
    raw: { width: number; height: number; channels: 4 }
    left: number
    top: number
  }[] = []
  for (const [index, bytes] of images.entries()) {
    let input: Buffer
    try {
      input = await sharp(bytes)
        .resize(cell, cell, { fit: 'contain', background: TRANSPARENT })
        .toColourspace('srgb')
        .ensureAlpha()
        .raw()
        .toBuffer()
    } catch (error) {
      throw new RenderProblem('decode', `Collage image ${index + 1} could not be read as an image.`, {
        detail: { index, reason: reasonOf(error) },
      })
    }
    tiles.push({
      input,
      raw: { width: cell, height: cell, channels: 4 },
      left: (index % columns) * cell,
      top: Math.floor(index / columns) * cell,
    })
  }
  const png = await sharp({
    create: { width: columns * cell, height: rows * cell, channels: 4, background: TRANSPARENT },
  })
    .composite(tiles)
    .png(PNG_OPTIONS)
    .toBuffer()
  return bytesOf(png)
}
```

Append to `services/render/src/index.ts`:

```ts
export { previewCollage } from './collage'
```

- [ ] **Step 4: Run the tests and checks**

Run:

```bash
pnpm --filter @cobweb/render exec vitest run src/collage.test.ts
pnpm --filter @cobweb/render typecheck && pnpm --filter @cobweb/render lint
```

Expected: 5 tests pass; typecheck and lint clean.

- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write services/render
pnpm typecheck && pnpm lint && pnpm test
git add services/render/src
git commit -m "$(cat <<'EOF'
Build the preview collage as a transparent grid of fitted cells

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bcHX4HZG5YGWhxjGuiWos
EOF
)"
```

---

### Task 8: End to end, purity, and the documents

**Files:**

- Create: `services/render/src/render.e2e.test.ts`, `services/render/src/purity.test.ts`
- Modify: `docs/MASTER_PLAN.md` (the Phase 4 `**Status:**` line, appended), `CLAUDE.md` (one commands line), `docs/specs/2026-10-11-render-core.md` (section 14 boxes ticked)

**Interfaces:**

- Consumes: the package surface from `./index` (Tasks 1 to 7): `renderBatch`, `renderMetadataSet`; fixtures `flatPng`, `halfAlphaSquarePng` (Task 2), `owlSpec`, `owlImages` (Task 3), `readCarFiles` (Task 4).
- Produces: the proof of spec sections 12 and 14 (same CIDs and bytes across two fresh module instances; no clock, environment, network or file-system access in `src/`), and the documents that record the sub-project and the interfaces the second and third sub-projects consume.

Decision: the two runs use `vi.resetModules()` then a dynamic `import('./index')`, so each run loads its own instance of every module in `src/` (and so applies the sharp settings afresh); the native sharp binding is shared by the process either way. The 20 second limit is the test's timeout.

Decision: the acceptance grep is kept as a test (`purity.test.ts`, modelled on `packages/dna/src/purity.test.ts`) so it holds after this sub-project; test files are exempt because they may read files (this one does).

- [ ] **Step 1: Write the end-to-end and purity tests**

Create `services/render/src/render.e2e.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { flatPng, halfAlphaSquarePng, owlImages, owlSpec, readCarFiles } from './fixtures'
import type { GenerativeSpec, GenerativeToken } from './types'

const png = (key: string) => ({ key, ext: 'png' as const })

/**
 * 300 tokens over 2 collections of 3 layers each: owls (ids 1 to 150; a blank hat and the hat layer
 * at opacity 0.5) and bats (ids 151 to 300), batch size 100.
 */
function miniProject(): { spec: GenerativeSpec; tokens: GenerativeToken[] } {
  const owls = owlSpec({ hatOpacity: 0.5 }).collections[0]!
  const bats = {
    id: 'bats',
    layers: [
      {
        id: 'sky',
        name: 'Sky',
        displayName: null,
        opacity: 1,
        traits: [
          { id: 'sky-night', name: 'Night', blank: false, inMetadata: true, image: png('sky-night.png') },
          { id: 'sky-moon', name: 'Moon', blank: false, inMetadata: true, image: png('sky-moon.png') },
        ],
      },
      {
        id: 'wings',
        name: 'Wings',
        displayName: null,
        opacity: 1,
        traits: [
          { id: 'wings-open', name: 'Open', blank: false, inMetadata: true, image: png('wings-open.png') },
          { id: 'wings-shut', name: 'Shut', blank: false, inMetadata: true, image: png('wings-shut.png') },
        ],
      },
      {
        id: 'mouth',
        name: 'Mouth',
        displayName: null,
        opacity: 1,
        traits: [
          { id: 'mouth-fang', name: 'Fang', blank: false, inMetadata: true, image: png('mouth-fang.png') },
          { id: 'mouth-grin', name: 'Grin', blank: false, inMetadata: true, image: png('mouth-grin.png') },
        ],
      },
    ],
  }
  const spec: GenerativeSpec = { ...owlSpec(), collections: [owls, bats] }
  const pick = (layer: { traits: { id: string }[] }, n: number) => layer.traits[n % layer.traits.length]!.id
  const tokens: GenerativeToken[] = Array.from({ length: 300 }, (_, i) => {
    const id = i + 1
    const collection = id <= 150 ? owls : bats
    return {
      id,
      collectionId: collection.id,
      dna: collection.layers.map((layer, depth) => pick(layer, Math.floor(id / (depth + 1)))),
      description: null,
    }
  })
  return { spec, tokens }
}

async function images(): Promise<Record<string, Uint8Array>> {
  return {
    ...(await owlImages()),
    'sky-night.png': await flatPng({ r: 5, g: 5, b: 30, alpha: 1 }),
    'sky-moon.png': await flatPng({ r: 60, g: 60, b: 90, alpha: 1 }),
    'wings-open.png': await halfAlphaSquarePng({ r: 90, g: 0, b: 90 }),
    'wings-shut.png': await halfAlphaSquarePng({ r: 40, g: 0, b: 40 }),
    'mouth-fang.png': await halfAlphaSquarePng({ r: 255, g: 255, b: 255 }),
    'mouth-grin.png': await halfAlphaSquarePng({ r: 200, g: 0, b: 0 }),
  }
}

/** Renders the project in a fresh module instance: three image batches, then the metadata set. */
async function renderAll() {
  vi.resetModules()
  const render = await import('./index')
  const { spec, tokens } = miniProject()
  const library = await images()
  const loadImage = async (ref: { key: string }) => {
    const bytes = library[ref.key]
    if (!bytes) throw new Error(`No object at ${ref.key}`)
    return bytes
  }
  const batches = []
  for (const batchNo of [0, 1, 2])
    batches.push(
      await render.renderBatch(
        spec,
        batchNo,
        tokens.filter((t) => Math.floor((t.id - 1) / spec.batchSize) === batchNo),
        loadImage,
      ),
    )
  const metadata = await render.renderMetadataSet(
    spec,
    tokens,
    new Map(batches.map((b) => [b.batchNo, b.cid])),
  )
  return { batches, metadata }
}

describe('the render core, end to end', () => {
  it('renders 300 tokens twice with identical CIDs and bytes, and every image resolves', async () => {
    const first = await renderAll()
    const second = await renderAll()

    expect(second.batches.map((b) => b.cid)).toEqual(first.batches.map((b) => b.cid))
    expect(second.metadata.cid).toBe(first.metadata.cid)
    for (const [i, batch] of first.batches.entries()) expect(second.batches[i]!.car).toEqual(batch.car)
    expect(second.metadata.car).toEqual(first.metadata.car)

    expect(first.batches.map((b) => b.files.length)).toEqual([100, 100, 100])
    const batchByCid = new Map(first.batches.map((b) => [b.cid, new Set(b.files.map((f) => f.name))]))
    const { files } = await readCarFiles(first.metadata.car)
    expect(files.size).toBe(300)
    for (const [name, bytes] of files) {
      const match = /^ipfs:\/\/([a-z0-9]+)\/(\d+\.png)$/.exec(
        JSON.parse(new TextDecoder().decode(bytes)).image,
      )
      expect(match, name).not.toBeNull()
      expect(match![2]).toBe(`${name}.png`)
      expect(batchByCid.get(match![1]!)?.has(match![2]!), name).toBe(true)
    }
  }, 20_000)
})
```

Create `services/render/src/purity.test.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = import.meta.dirname
const libraryFiles = readdirSync(SRC).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))

describe('the render core stays pure', () => {
  it('reads no clock, environment, network or file system', () => {
    expect(libraryFiles.length).toBeGreaterThan(5)
    for (const file of libraryFiles) {
      const text = readFileSync(join(SRC, file), 'utf8')
      expect(text, file).not.toMatch(/\bDate\b/)
      expect(text, file).not.toMatch(/process\.env/)
      expect(text, file).not.toMatch(/\bfetch\b/)
      expect(text, file).not.toMatch(/\bfs\b/)
      expect(text, file).not.toMatch(/\b(performance|hrtime|Math\.random)\b/)
    }
  })
})
```

- [ ] **Step 2: Run them**

Run: `pnpm --filter @cobweb/render exec vitest run src/render.e2e.test.ts src/purity.test.ts`
Expected: 2 tests pass, the end-to-end one in a few seconds (well under its 20 second timeout). These tests prove properties of the code from Tasks 1 to 7 rather than drive new code, so they pass on their first run. Check that the purity test can fail: add the line `// Date` at the end of `services/render/src/types.ts`, run `pnpm --filter @cobweb/render exec vitest run src/purity.test.ts` (Expected: FAIL naming `types.ts`), then delete that line with your editor and run it again (Expected: PASS).

- [ ] **Step 3: The acceptance grep and the full suite**

Run:

```bash
grep -rnE '\bDate\b|process\.env|\bfetch\b|\bfs\b' services/render/src --include='*.ts' | grep -v '\.test\.ts:'
pnpm --filter @cobweb/render test
pnpm typecheck && pnpm lint && pnpm test
```

Expected: the grep prints nothing; the render suite reports 12 files and 73 tests passed; the root checks are clean.

- [ ] **Step 4: Documentation**

In `docs/MASTER_PLAN.md`, Phase 4, the `**Status:**` line ends with "the seam this phase replaces." Do not change any of its sentences; append one space and this text to the end of that same line (use the date the sub-project lands, written in words like the other entries):

```
Render core (first sub-project of four: render core, job state, worker and local runner, screen wiring) landed on 11 October 2026; see [specs/2026-10-11-render-core.md](specs/2026-10-11-render-core.md). `@cobweb/render` in `services/render` is a pure library (no clock, environment, network or file-system access) with sharp, `@ipld/unixfs` and `@ipld/car` pinned exactly. The second and third sub-projects consume `LoadImage` (the worker's loader: bytes for an `ImageRef`, throwing when the object is missing), `renderBatch`, `renderMetadataSet`, `renderPlaceholder`, `previewCollage` and `PackedDirectory.cid`, the CID computed locally that the worker asserts against the pinning service's answer. Per-layer opacity and extra metadata fields are supported by the library; their columns and controls are owed to a follow-up. Next: job state (second sub-project).
```

In `CLAUDE.md`, under `## Commands`, add this line after the `sweep:uploads --dry-run` line, inside the same code block:

```
pnpm --filter @cobweb/render test         # render core: compositing, metadata JSON, CARs and local CIDs
```

In `docs/specs/2026-10-11-render-core.md`, section 14, change each of the five `- [ ]` boxes to `- [x]`; change nothing else in the spec.

Run:

```bash
pnpm exec prettier --ignore-path /dev/null --write docs/MASTER_PLAN.md docs/specs/2026-10-11-render-core.md
pnpm exec prettier --write CLAUDE.md
git diff --stat
grep -nP '[\x{2013}\x{2014}]' docs/MASTER_PLAN.md CLAUDE.md docs/specs/2026-10-11-render-core.md services/render/src/*.ts
```

Expected: `git diff --stat` lists only the two new test files and the three documents (prettier may rewrap the appended line; it must not change other lines; if it does, restore them with `git checkout -p` on those hunks); the dash grep prints nothing.

- [ ] **Step 5: Commit**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add services/render/src/render.e2e.test.ts services/render/src/purity.test.ts docs/MASTER_PLAN.md CLAUDE.md docs/specs/2026-10-11-render-core.md
git commit -m "$(cat <<'EOF'
Prove the render core renders 300 tokens identically twice and record it in the master plan

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bcHX4HZG5YGWhxjGuiWos
EOF
)"
```
