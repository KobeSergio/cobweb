# Render core: specification

Phase 4, first sub-project of four (render core, job state, worker and local runner, screen wiring).
Product decisions: [../MASTER_PLAN.md](../MASTER_PLAN.md#decisions) (media, render output, compositor,
placeholder fee) and the Phase 4 section of the same file. Legacy reference:
[../legacy/artgen-lambda.md](../legacy/artgen-lambda.md) sections 3, 4, 7 and 9. Rows:
[2026-10-08-art-tables.md](2026-10-08-art-tables.md) section 4.8 (`render_jobs`, `render_batches`). Token
lists: [2026-10-09-lock-and-pay.md](2026-10-09-lock-and-pay.md) section 5. Contract:
`contracts/src/CobwebCollection.sol` (`tokenURI`, `baseURI`).

## 1. Goal

Build the part of the render pipeline that turns a locked token list and its layer images into the
bytes that get pinned: composited PNGs, metadata JSON, content archives (CARs) with their content ids
(CIDs) computed locally, and a preview collage. The library is pure: it takes plain data and bytes and
returns bytes and CIDs, with no AWS, Supabase, network, clock or environment access. The worker
(third sub-project) feeds it images from storage and uploads what it returns.

The same input must give the same bytes and the same CIDs on every run, on every machine. That is what
lets a retried batch be safe and a re-run be verifiable (MASTER_PLAN "Done when" for Phase 4).

## 2. Decisions taken in the design conversation

- Phase 4 is four sub-projects, the core first, each with its own spec, plan and merge.
- Per-layer opacity and extra metadata fields are supported by the library and its tests now. The
  columns, the lock-time freeze and the Layers and Details controls are owed to a follow-up after the
  pipeline runs end to end. Until then every layer renders at full opacity and no extra field is
  written.
- One image CID per batch and one metadata CID, as MASTER_PLAN decides. Single asset and the
  placeholder use a base URI with no trailing slash, so the contract returns the same JSON for every
  token without a contract change.
- Layer images are not resized. A layer whose size differs from the canvas is refused by name. Uploads
  already enforce one size per project.
- Any failure inside a batch fails the batch. The legacy Lambda swallowed per-image errors; this
  library never does.
- No `date` or any other clock value in metadata.

## 3. Scope

In:

- `@cobweb/render` in `services/render`: types, compositing, metadata, CAR packing, batch and
  metadata set rendering, passthrough for 1/1, single asset and the placeholder, the preview collage,
  and named problems.
- Unit tests and one end-to-end library test on a 300 token mini project.
- The dependency pins that determinism relies on.

Out (later sub-projects):

- Reading `render_jobs`, `tokens`, `layers`, `traits` or `uploads`; claiming a job; writing CIDs or
  batch states (second sub-project).
- Queues, Lambda handlers, S3 reads, Filebase uploads, the on-chain payment re-check, the local
  runner and the benchmark that sets memory and batch size (third sub-project).
- Replacing `components/upload/render-sim.ts` on the screen (fourth sub-project).
- Opacity and extra-field columns and controls (follow-up).

## 4. Package

`services/render/package.json` becomes a real package:

- `name` `@cobweb/render`, ESM, `exports` `"."` to `./src/index.ts` like `@cobweb/dna`.
- `dependencies`: `sharp` pinned exactly to `0.35.5` (the version already in the lockfile),
  `@ipld/unixfs`, `@ipld/car`, `multiformats`, and `@cobweb/dna` (workspace) for `tokenAttributes` and
  the token types. Exact pins, no caret, for `sharp`, `@ipld/unixfs` and `@ipld/car`: their output is
  the CID.
- `devDependencies`: `vitest` as the other packages, `@types/node`.
- Scripts `typecheck`, `lint`, `test` as today; `test` drops `--passWithNoTests`.
- `tsconfig.json` keeps `../../tsconfig.base.json` and adds `"types": ["node"]`.

Node 22 or later (the Lambda runtime is Node 22; the repo runs Node 26).

## 5. Input model (`src/types.ts`)

Plain data, no classes, mirroring what the database stores so the worker's mapping is a projection.

```ts
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

`canvas` is `collections.canvas_width` (square by constraint). `batchSize` is `render_jobs.batch_size`
(100). The generative token shape is the `tokens` row plus the hashed triple of lock section 5; the asset
shape is the `render_jobs.token_list` entry with its `uploadId` resolved to an `ImageRef` by the worker.

## 6. Compositing (`src/composite.ts`)

```ts
export async function compositeToken(
  canvas: number,
  layers: { bytes: Uint8Array; opacity: number }[],
): Promise<Uint8Array>
```

- The base is a transparent RGBA canvas of `canvas` by `canvas`.
- Each layer is decoded, checked to be exactly `canvas` by `canvas` (else `RenderProblem` code
  `layer-size` naming the width and height found), given an alpha channel, multiplied by its opacity
  when below 1 (a `dest-in` composite with a tiled 1 by 1 pixel of alpha `round(opacity * 255)`), then
  composited `over` in order.
- Output is PNG: `compressionLevel: 9`, `adaptiveFiltering: false`, `palette: false`, `effort` left at
  the default, no metadata (`withMetadata` is not called, so no EXIF, ICC or timestamps are written).
- `sharp.cache(false)` and `sharp.concurrency(1)` are set once at module load, so results do not depend
  on thread scheduling. The benchmark (third sub-project) may raise concurrency after proving CIDs stay
  identical; the library exposes `setConcurrency(n)` for that and nothing else about sharp.
- A blank trait contributes no layer. The caller (section 9) resolves DNA to layers; this function only
  stacks bytes.

Why not resize: one size per project is enforced at upload (CLAUDE.md conventions), and a silent
`contain` fit would hide a wrong upload behind a blurred render.

## 7. Metadata (`src/metadata.ts`)

```ts
export const RESERVED_KEYS = ['name', 'description', 'image', 'attributes'] as const

export function tokenMetadataJson(input: {
  id: number
  text: MetadataText
  description: string | null
  image: string
  attributes: { trait_type: string; value: string }[]
}): Uint8Array

export function placeholderMetadataJson(input: {
  name: string
  description: string
  image: string
}): Uint8Array
```

- Key order is fixed: `name`, `description`, `image`, `attributes`, then the extra fields in the order
  given. `JSON.stringify(value, null, 2)` once, UTF-8, no trailing newline.
- `name` is `` `${text.tokenName} #${id}` ``. `description` is the token's own when not null, else
  `text.tokenDescription`.
- `attributes` for a generative token come from `tokenAttributes` in `@cobweb/dna` (blank left out
  unless `showBlankTraits`, `inMetadata` false left out, `displayName` over `name`); for an asset token
  they are the list stored at lock, unchanged.
- An extra field whose key is in `RESERVED_KEYS` is refused with `RenderProblem` code `reserved-key`.
  The check runs once per spec, before any token is rendered.
- The placeholder JSON has `name`, `description` and `image` only.

## 8. Content archives (`src/car.ts`)

```ts
export type PackedDirectory = { car: Uint8Array; cid: string; size: number }

export async function packDirectory(files: { name: string; bytes: Uint8Array }[]): Promise<PackedDirectory>
```

- UnixFS, CIDv1, sha2-256, raw leaves, fixed-size chunks of 1,048,576 bytes, files sorted by name in
  byte order, duplicate names refused (`RenderProblem` code `duplicate-name`).
- A directory is a plain UnixFS directory unless its encoded block would exceed 262,144 bytes; then it
  is a HAMT-sharded directory with the standard fanout (256, murmur3), the same rule and parameters
  Kubo applies, so a 100,000 entry metadata set still packs and a gateway still resolves it.
- The CAR has the directory as its single root. `cid` is the root as a base32 string. `size` is the
  CAR length in bytes.
- `cid` is computed locally and is what the worker asserts against the pinning service's answer; a
  mismatch is the worker's failure, never silently accepted.

## 9. Batches and sets (`src/batch.ts`, `src/metadata-set.ts`, `src/placeholder.ts`)

```ts
export type RenderedBatch = PackedDirectory & {
  batchNo: number
  files: { name: string; bytes: Uint8Array }[]
}

export async function renderBatch(
  spec: GenerativeSpec | AssetSpec,
  batchNo: number,
  tokens: (GenerativeToken | AssetToken)[],
  loadImage: LoadImage,
  options?: { concurrency?: number },
): Promise<RenderedBatch>
```

- `batchNo` is 0-based; the tokens must be exactly those with
  `floor((id - 1) / spec.batchSize) === batchNo`, else `RenderProblem` code `batch-range`.
- Generative: for each token, the collection's layers bottom first; for layer `i` the trait with id
  `dna[i]`; an unknown trait id is `RenderProblem` code `bad-dna` naming the token; a non-blank trait
  loads its image through `loadImage` (a thrown load is `missing-image` naming the key and the token).
  The file is `<id>.png`. Images are loaded once per distinct key within the batch.
- 1/1 and single asset: the token's image bytes pass through unchanged, named `<id>.<ext>`.
- `concurrency` defaults to 4 tokens in flight. A failure in any token rejects the whole call; no
  partial output.

```ts
export type RenderedMetadata = PackedDirectory & { baseUri: string }

export async function renderMetadataSet(
  spec: GenerativeSpec | AssetSpec,
  tokens: (GenerativeToken | AssetToken)[],
  imageCids: Map<number, string>,
): Promise<RenderedMetadata>
```

- Every token's batch must have a CID in `imageCids` (`RenderProblem` code `missing-batch`).
- `image` is `` `ipfs://${imageCids.get(batchNo)}/${id}.${ext}` `` with `ext` `png` for generative
  and the asset's own extension otherwise.
- Generative and 1/1: files named by bare id (`1`, `2`, ...), `baseUri` `` `ipfs://${cid}/` ``, so
  the contract's `tokenURI` is `baseUri + id`.
- Single asset: one file `metadata.json` describing token 1 (every token shares it), `baseUri`
  `` `ipfs://${cid}/metadata.json` ``; with no trailing slash the contract returns it for every token.

```ts
export async function renderPlaceholder(
  spec: PlaceholderSpec,
  loadImage: LoadImage,
): Promise<{ image: PackedDirectory; metadata: RenderedMetadata }>
```

- The placeholder passes through as `placeholder.<ext>` in its own directory; the metadata is one
  `metadata.json` with `image` `` `ipfs://${image.cid}/placeholder.${ext}` `` and `baseUri`
  `` `ipfs://${metadata.cid}/metadata.json` ``.

## 10. Preview collage (`src/collage.ts`)

```ts
export async function previewCollage(
  images: Uint8Array[],
  options?: { columns?: number; cell?: number },
): Promise<Uint8Array>
```

A grid of the images given (the worker passes the first 16 rendered tokens), 4 columns by default,
each resized to `cell` (256) pixels with `fit: 'contain'` on a transparent background, PNG with the
same pinned settings as section 6. Fewer images than cells leaves the rest transparent. Zero images is
`RenderProblem` code `empty-collage`.

## 11. Problems (`src/problems.ts`)

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

export class RenderProblem extends Error {
  code: RenderProblemCode
  tokenId?: number
  detail?: Record<string, string | number>
}
```

Every refusal above is a thrown `RenderProblem`. A sharp decode failure is wrapped as `decode` with the
token id. Messages are plain sentences; the worker stores `code` and `message` on the batch row.

## 12. Determinism rules

- Exact pins for `sharp`, `@ipld/unixfs`, `@ipld/car` (section 4). A version bump is a deliberate
  change that re-renders nothing already pinned (old CIDs stay valid; new jobs get new CIDs).
- `sharp.cache(false)`, `sharp.concurrency(1)` by default, no metadata written, no clock read.
- JSON serialized by one function with a fixed key order.
- Directory entries sorted by name bytes; chunking, hashing and sharding parameters fixed.
- The end-to-end test (section 13) renders the same project twice in separate module instances and
  compares every CID and every byte.

## 13. Testing

Vitest, Node environment, fixtures drawn in the test with sharp (64 by 64, flat colours and a half
alpha square), no binary fixtures committed.

- `composite.test.ts`: order (top layer's pixel wins), opacity 0.5 halves alpha within 1 unit, a blank
  contributes nothing, a 32 by 32 layer on a 64 canvas is `layer-size`, output is PNG with no EXIF or
  time chunk, two runs give identical bytes.
- `metadata.test.ts`: exact JSON string goldens for a generative token (with and without blanks shown,
  with `displayName`, with `inMetadata` false), an asset token, a token with its own description, extra
  fields appended in order, a reserved key refused, the placeholder shape.
- `car.test.ts`: the empty directory CID equals the well-known
  `bafybeiczsscdsbs7ffqz55asqdf3smv6klcw3gofszvwlyarci47bgf354`; one small file's directory CID equals
  the value computed once with the `ipfs-car` CLI and recorded in the test with the command used; two
  packs of the same files in different order give identical CAR bytes; duplicate names refused; a
  directory built to exceed 262,144 bytes is sharded and still lists every entry when read back with
  `@ipld/car` and `@ipld/unixfs`.
- `batch.test.ts`: file names, `batch-range`, `bad-dna`, `missing-image` (the loader throws), one
  load per distinct key, passthrough keeps bytes and extension, a failing token rejects the whole batch.
- `metadata-set.test.ts`: `image` points into the right batch for ids 1, 100, 101 and 300; bare id file
  names; `baseUri` with the trailing slash; single asset's one `metadata.json` and slash-less
  `baseUri`; `missing-batch`.
- `placeholder.test.ts`: GIF and MP4 bytes pass through unchanged with their extension; the two URIs.
- `collage.test.ts`: 16 images give a 1024 by 1024 PNG; 3 images leave the rest transparent; empty is
  refused.
- `render.e2e.test.ts`: a 300 token project with 2 collections, 3 layers each, one blank, one layer at
  opacity 0.5, batch size 100: three batches plus the metadata set rendered twice; every CID equal
  across runs; every `image` resolves to a file present in its batch; total under 20 seconds.

Commands: `pnpm --filter @cobweb/render test`, `pnpm typecheck`, `pnpm lint`.

## 14. Acceptance criteria

- [ ] `services/render` is a package with the exact pins of section 4 and passes `typecheck`, `lint`
      and `test` through Turborepo.
- [ ] Every function of sections 6 to 10 exists with the signatures given and every refusal of
      section 11 is thrown as a `RenderProblem` with its code.
- [ ] The end-to-end test renders 300 tokens twice with identical CIDs.
- [ ] No clock, environment, network or file-system access anywhere in `src/` (grep for `Date`,
      `process.env`, `fetch`, `fs`).
- [ ] MASTER_PLAN's Phase 4 status line records the first sub-project landing and the interfaces the
      second and third consume: `LoadImage`, `renderBatch`, `renderMetadataSet`, `renderPlaceholder`,
      `previewCollage`, `PackedDirectory.cid`.
