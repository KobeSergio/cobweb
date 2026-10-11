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
  if (tokens.length === 0) throw new RenderProblem('batch-range', 'The token list is empty.')
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
