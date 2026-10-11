import { describe, expect, it } from 'vitest'
import { owlSpec, TEXT } from './fixtures'
import { attributesFor } from './generative'
import { placeholderMetadataJson, tokenMetadataJson } from './metadata'

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
const image = 'ipfs://bafyimages/7.png'

describe('tokenMetadataJson', () => {
  it('writes the fixed key order with two space indent and no trailing newline', () => {
    const json = decode(
      tokenMetadataJson({
        id: 7,
        text: TEXT,
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
        text: { ...TEXT, extraFields: { artist: 'Kim', edition: 2 } },
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
    const json = decode(tokenMetadataJson({ id: 3, text: TEXT, description: null, image, attributes: [] }))
    expect(json.endsWith('  "attributes": []\n}')).toBe(true)
    expect(JSON.parse(json)).toEqual({ name: 'Owl #3', description: 'A night owl.', image, attributes: [] })
  })

  it("prefers the token's own description", () => {
    const json = decode(tokenMetadataJson({ id: 2, text: TEXT, description: 'Mine.', image, attributes: [] }))
    expect(json).toBe(
      [
        '{',
        '  "name": "Owl #2",',
        '  "description": "Mine.",',
        '  "image": "ipfs://bafyimages/7.png",',
        '  "attributes": []',
        '}',
      ].join('\n'),
    )
  })

  it('appends extra fields in the order given, after attributes', () => {
    const json = decode(
      tokenMetadataJson({
        id: 1,
        text: { ...TEXT, extraFields: { zeta: true, artist: 'Kim', edition: 2 } },
        description: null,
        image,
        attributes: [],
      }),
    )
    expect(json).toBe(
      [
        '{',
        '  "name": "Owl #1",',
        '  "description": "A night owl.",',
        '  "image": "ipfs://bafyimages/7.png",',
        '  "attributes": [],',
        '  "zeta": true,',
        '  "artist": "Kim",',
        '  "edition": 2',
        '}',
      ].join('\n'),
    )
  })

  it('keeps an integer-like extra key after attributes', () => {
    const json = decode(
      tokenMetadataJson({
        id: 1,
        text: { ...TEXT, extraFields: { '2024': 'drop' } },
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
          text: { ...TEXT, extraFields: { [key]: 'x' } },
          description: null,
          image,
          attributes: [],
        }),
      ).toThrow(expect.objectContaining({ code: 'reserved-key', detail: { key } }))
  })

  it('writes no date or other clock value', () => {
    const json = decode(tokenMetadataJson({ id: 1, text: TEXT, description: null, image, attributes: [] }))
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
    const json = decode(
      tokenMetadataJson({
        id: 12,
        text: TEXT,
        description: null,
        image: 'ipfs://bafyimages/12.mp4',
        attributes,
      }),
    )
    expect(json).toBe(
      [
        '{',
        '  "name": "Owl #12",',
        '  "description": "A night owl.",',
        '  "image": "ipfs://bafyimages/12.mp4",',
        '  "attributes": [',
        '    {',
        '      "trait_type": "Edition",',
        '      "value": "Gold"',
        '    },',
        '    {',
        '      "trait_type": "Artist",',
        '      "value": "Kim"',
        '    }',
        '  ]',
        '}',
      ].join('\n'),
    )
  })
})
