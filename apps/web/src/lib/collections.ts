import { z } from 'zod'
import type { Enums } from '@/lib/database.types'

export type ProjectType = Enums<'project_type'>

export const PROJECT_TYPES: { value: ProjectType; name: string; description: string }[] = [
  {
    value: 'generative',
    name: 'Generative',
    description: 'Upload trait layers and generate thousands of unique combinations.',
  },
  {
    value: 'one_of_one',
    name: '1/1s',
    description: 'Upload finished artworks. Each becomes its own token, or an edition if you set a quantity.',
  },
  {
    value: 'metadata',
    name: 'Metadata',
    description: 'You already have the images and metadata files. Upload them as they are.',
  },
  {
    value: 'single_asset',
    name: 'Single asset',
    description: 'Every token shares one image and one set of metadata. Up to 4,000 tokens.',
  },
]

export const SINGLE_ASSET_MAX_SUPPLY = 4000
export const MAX_SUPPLY = 100_000

/** Routes the app owns. A collection's mint page lives at /<slug>, so these cannot be slugs. */
export const RESERVED_SLUGS = [
  'collections',
  'api',
  'admin',
  'create',
  'assets',
  'auth',
  'help',
  'docs',
  'terms',
  'privacy',
]

/** Turns a collection name into a slug suggestion. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

/** A mint page address: the same rules the database enforces in `reserve_slug`. */
export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/, 'Use 3 to 48 lowercase letters, numbers or hyphens.')
  .refine((slug) => !RESERVED_SLUGS.includes(slug), 'That address is reserved. Choose another.')

/** How long a mint page address stays reserved before the contract must be deployed. */
export const RESERVATION_DAYS = 3

export type SlugState =
  | { kind: 'none' }
  | { kind: 'reserved'; slug: string; until: Date }
  | { kind: 'lapsed'; slug: string }
  | { kind: 'permanent'; slug: string }

/**
 * Where a collection's mint page address stands. A deployed collection's address is permanent;
 * before that it is a reservation that lapses `RESERVATION_DAYS` after it was made.
 */
export function slugState(
  collection: { slug: string | null; slug_reserved_at: string | null; status: string },
  now: number = Date.now(),
): SlugState {
  const { slug } = collection
  if (!slug) return { kind: 'none' }
  if (collection.status === 'deployed') return { kind: 'permanent', slug }
  const reservedAt = collection.slug_reserved_at ? Date.parse(collection.slug_reserved_at) : NaN
  const until = new Date(reservedAt + RESERVATION_DAYS * 24 * 3600 * 1000)
  if (Number.isNaN(reservedAt) || until.getTime() <= now) return { kind: 'lapsed', slug }
  return { kind: 'reserved', slug, until }
}

/** A reservation's end, e.g. "Oct 6, 2026, 14:05 UTC". */
export function formatReservedUntil(until: Date): string {
  return `${until.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'UTC',
  })} UTC`
}

/** The same rules the database enforces, checked first so the creator gets a clear message. */
export const createCollectionSchema = z
  .object({
    name: z.string().trim().min(1, 'Enter a name.').max(64, 'Keep the name under 64 characters.'),
    symbol: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{1,12}$/, 'Use 1 to 12 letters or numbers.'),
    projectType: z.enum(['generative', 'one_of_one', 'metadata', 'single_asset'], {
      error: 'Choose a collection type.',
    }),
    maxSupply: z.coerce
      .number({ error: 'Enter the supply.' })
      .int('Use a whole number.')
      .min(1, 'A collection needs at least 1 token.')
      .max(MAX_SUPPLY, `The most a collection can have is ${MAX_SUPPLY.toLocaleString('en-US')}.`),
  })
  .refine((value) => value.projectType !== 'single_asset' || value.maxSupply <= SINGLE_ASSET_MAX_SUPPLY, {
    path: ['maxSupply'],
    message: `Single asset collections can have at most ${SINGLE_ASSET_MAX_SUPPLY.toLocaleString('en-US')} tokens.`,
  })

export type CreateCollectionInput = z.infer<typeof createCollectionSchema>
