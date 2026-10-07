import type { Layer, Project, Trait } from './types'

/** Freezes an object graph so a test fails if the engine mutates its input. */
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const key of Object.keys(value as object)) deepFreeze((value as Record<string, unknown>)[key])
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
      layer(
        'owls',
        'background',
        0,
        [
          { id: 'bg-ink', name: 'Ink', weight: 50 },
          { id: 'bg-sand', name: 'Sand', weight: 50 },
        ],
        { bypassDna: true },
      ),
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
      {
        id: 'r-hat-sleepy',
        kind: "doesn't mix with",
        traitId: 'acc-hat',
        relatedTraitIds: ['eyes-sleepy'],
        bidirectional: true,
      },
      {
        id: 'r-scarf-snow',
        kind: 'always pairs with',
        traitId: 'acc-scarf',
        relatedTraitIds: ['body-snow'],
        bidirectional: true,
      },
      {
        id: 'r-gold-ink',
        kind: 'must pair with',
        traitId: 'eyes-gold',
        relatedTraitIds: ['bg-ink'],
        bidirectional: false,
      },
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
