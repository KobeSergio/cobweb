import { z } from 'zod'
import type { Enums } from '@/lib/database.types'

export type ProjectType = Enums<'project_type'>

/**
 * The three kinds of project, as in the legacy app. Each lands on its own Art screen after creation
 * (`stageHref(id, 'art', type)`), and each sets its supply in a different place (`SUPPLY_SOURCE`).
 */
export const PROJECT_TYPES: { value: ProjectType; name: string; description: string }[] = [
  {
    value: 'generative',
    name: 'Generative',
    description: 'Upload a folder of trait layers and generate unique combinations from them.',
  },
  {
    value: 'one_of_one',
    name: '1/1s',
    description: 'Upload finished artworks. Each becomes its own token, or several editions.',
  },
  {
    value: 'single_asset',
    name: 'Single asset',
    description: 'One image, GIF or video shared by every token. Up to 4,000 tokens.',
  },
]

/** Where the supply of each project type is set, as the Details screen explains it. */
export const SUPPLY_SOURCE: Record<ProjectType, string> = {
  generative: 'Set when you generate',
  one_of_one: 'Set from your uploads',
  single_asset: 'Set from your uploads',
}

export const SINGLE_ASSET_MAX_SUPPLY = 4000
export const MAX_SUPPLY = 100_000

/**
 * Routes the app owns, and `demo`, the folder of the sample art (public/demo). A collection's mint page lives at
 * /<slug>, so these cannot be slugs; the database's check and `reserve_slug` list the same.
 */
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
  'demo',
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

/** A mint page link: the same rules the database enforces in `reserve_slug`. */
export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/, 'Use 3 to 48 lowercase letters, numbers or hyphens.')
  .refine((slug) => !RESERVED_SLUGS.includes(slug), 'That link is reserved. Choose another.')

/** How long a mint page link stays reserved before the contract must be deployed. */
export const RESERVATION_DAYS = 3

/**
 * The most collections that are not deployed a wallet holds unless support raised its `profiles.draft_cap`
 * (docs/specs/2026-10-17-production-hardening.md, section 6.4), so mint page links cannot be squatted in bulk.
 */
export const DRAFT_CAP_DEFAULT = 20

/** The database's refusal of an insert past the cap, its `detail` the cap. */
export const DRAFT_CAP_REFUSAL = 'This wallet holds its limit of collections that are not deployed.'

/**
 * What the Create collection dialog says at the cap: in the singular for a cap of 1, and for a cap of 0, which
 * support sets, that the wallet can hold none at all.
 */
export function draftCapSentence(cap: number): string {
  if (cap < 1)
    return 'This wallet cannot hold a collection that is not deployed. Ask support to raise its limit.'
  const held = cap === 1 ? '1 collection that is not deployed' : `${cap} collections that are not deployed`
  return `This wallet already has ${held}, the most it can hold. Delete a draft or deploy one, then create this one.`
}

/**
 * The cap an insert refusal names: the trigger's 23514 with its message, its `details` the cap when it is digits
 * alone (the default otherwise: `Number` reads a blank detail as 0); null for any other error.
 */
export function draftCapOf(
  error: { code?: string; message?: string; details?: string } | null,
): number | null {
  if (error?.code !== '23514' || error.message !== DRAFT_CAP_REFUSAL) return null
  return /^\d+$/.test(error.details ?? '') ? Number(error.details) : DRAFT_CAP_DEFAULT
}

export type SlugState =
  | { kind: 'none' }
  | { kind: 'reserved'; slug: string; until: Date }
  | { kind: 'lapsed'; slug: string }
  | { kind: 'permanent'; slug: string }

/**
 * Where a collection's mint page link stands. A deployed collection's link is permanent;
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

/** The highest supply a project type allows (the database's `single_asset_supply_cap` and range check). */
export function supplyLimit(projectType: ProjectType): number {
  return projectType === 'single_asset' ? SINGLE_ASSET_MAX_SUPPLY : MAX_SUPPLY
}

/**
 * Creating a collection: the type, then the name and symbol. No supply: it is set later, at Generate
 * or from the uploads (`supplySchema`). The same rules the database enforces, checked first so the
 * creator gets a clear message.
 */
export const createCollectionSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name.').max(64, 'Keep the name under 64 characters.'),
  symbol: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{1,12}$/, 'Use 1 to 12 letters or numbers.'),
  projectType: z.enum(['generative', 'one_of_one', 'single_asset'], {
    error: 'Choose a collection type.',
  }),
})

export type CreateCollectionInput = z.infer<typeof createCollectionSchema>

/** A supply, before the project type's own limit is applied (`supplyLimit`). */
export const supplySchema = z
  .number({ error: 'Enter the supply.' })
  .int('Use a whole number.')
  .min(1, 'A collection needs at least 1 token.')
  .max(MAX_SUPPLY, `The most a collection can have is ${MAX_SUPPLY.toLocaleString('en-US')}.`)

/** The message for a supply over the project type's limit, or null when it fits. */
export function supplyLimitError(projectType: ProjectType, supply: number): string | null {
  const limit = supplyLimit(projectType)
  if (supply <= limit) return null
  return projectType === 'single_asset'
    ? `Single asset collections can have at most ${limit.toLocaleString('en-US')} tokens.`
    : `The most a collection can have is ${limit.toLocaleString('en-US')}.`
}
