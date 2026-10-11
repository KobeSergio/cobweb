import { packDirectory } from './car'
import type { PackedDirectory } from './car'
import { compositeToken } from './composite'
import { batchOf, isGenerativeToken, resolveTraits } from './generative'
import { assertExtraFields } from './metadata'
import { mapLimit } from './pool'
import { forToken, reasonOf, RenderProblem } from './problems'
import { sniffExt } from './sniff'
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
    } catch (error) {
      throw new RenderProblem(
        'missing-image',
        `Token ${tokenId}: The image ${ref.key} could not be loaded.`,
        {
          tokenId,
          detail: { key: ref.key, reason: reasonOf(error) },
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
  const names: string[] = []
  for (const { layer, trait } of resolveTraits(spec, token).picks) {
    if (trait.blank) continue
    if (!trait.image)
      throw new RenderProblem('missing-image', `Trait ${trait.name} on token ${token.id} has no image.`, {
        tokenId: token.id,
        detail: { trait: trait.id },
      })
    layers.push({ bytes: await load(trait.image, token.id), opacity: layer.opacity })
    names.push(layer.name)
  }
  try {
    return { name: `${token.id}.png`, bytes: await compositeToken(spec.canvas, layers) }
  } catch (error) {
    if (!(error instanceof RenderProblem)) throw error
    const position = error.detail?.position
    const layerName = typeof position === 'number' ? names[position] : undefined
    const tagged = forToken(error, token.id)
    if (layerName === undefined) throw tagged
    // The position counts the non-blank layers of the stack, so it indexes `names` directly.
    throw new RenderProblem(tagged.code, tagged.message, {
      tokenId: token.id,
      detail: { ...tagged.detail, layer: layerName },
    })
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
  const { ext } = token.image
  const bytes = await load(token.image, token.id)
  const found = sniffExt(bytes)
  if (found !== ext)
    throw new RenderProblem('decode', `Token ${token.id}: the file is not a ${ext}.`, {
      tokenId: token.id,
      detail: { expected: ext, found: found ?? 'unknown' },
    })
  return { name: `${token.id}.${ext}`, bytes }
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
  const seen = new Set<number>()
  for (const { id } of tokens) {
    if (seen.has(id))
      throw new RenderProblem('duplicate-name', `Token ${id} is listed more than once in batch ${batchNo}.`, {
        tokenId: id,
        detail: { batchNo },
      })
    seen.add(id)
  }
  const load = cachedLoader(loadImage)
  const ordered = [...tokens].sort((a, b) => a.id - b.id)
  const files = await mapLimit(ordered, options.concurrency ?? 4, (token) =>
    spec.kind === 'generative' ? renderGenerative(spec, token, load) : passThrough(spec, token, load),
  )
  return { ...(await packDirectory(files)), batchNo, files }
}
