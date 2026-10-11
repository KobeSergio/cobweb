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
