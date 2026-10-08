/**
 * The token list a 1/1 or single asset project makes, worked out from its files: names and ids,
 * attributes taken from file names, rarity ranks and trait counts. Pure functions, so they can be
 * tested and later run on the server at lock.
 *
 * Legacy parity (docs/specs/2026-10-03-creator-flow-ui.md, section 12):
 *   - Each 1/1 token is named "<name> #<id>", ids 1 to N with no gaps, every edition its own id.
 *     Legacy stored the id in the name and renumbered every later token on delete; here ids are
 *     derived from the files, so removing a file or lowering its editions renumbers by construction.
 *   - The default attribute is "Name" with the file name (no extension), as legacy's `<file_name>`.
 *   - Rarity is legacy's `recalculateAllRarities` for 1/1s: score = sum(N / freq(trait)) / traits / N,
 *     ranked descending, rank 1 the rarest, ties in token order.
 *
 * Seam: at lock (Phase 3) the browser submits `buildOneOfOneTokens` output plus the files; the server
 * validates it and stores it (MASTER_PLAN, Art: assignment integrity at lock).
 */

import { MAX_ATTRIBUTES } from '@/lib/art/limits'

export type Attribute = { traitType: string; value: string }

/** What these functions need from an artwork. */
export type TokenSource = { key: string; fileName: string; quantity: number; attributes: Attribute[] }

/** Upload order, or ids shuffled across every edition (legacy "Shuffle Index"). */
export type TokenOrder = 'upload' | 'shuffled'

export type TokenDetails = {
  /** The token name before " #<id>". Legacy: required, at most 40 characters. */
  name: string
  description: string
  order: TokenOrder
  /** Seeds the shuffle, so the same seed gives the same ids. Kept with the token list. */
  seed: number
}

export type OneOfOneToken = {
  id: number
  name: string
  description: string
  /** The file this edition shows. Editions of one file share it. */
  itemKey: string
  /** 1 to the file's quantity. */
  edition: number
  attributes: Attribute[]
}

export const TOKEN_NAME_MAX = 40
export const TOKEN_DESCRIPTION_MAX = 500
export const ATTRIBUTE_TEXT_MAX = 60
export { MAX_ATTRIBUTES }
/** The legacy default attribute: the file name, under this trait type. */
export const FILE_NAME_TRAIT = 'Name'
/** Files are checked and added this many at a time, as legacy uploaded metadata images. */
export const ADD_BATCH_SIZE = 25

/** The file name without its extension, as legacy's `<file_name>` value. */
export function fileBaseName(fileName: string): string {
  const base = fileName.replace(/\.[^/.]+$/, '').trim()
  return base || fileName
}

export function fileNameAttribute(fileName: string): Attribute {
  return { traitType: FILE_NAME_TRAIT, value: fileBaseName(fileName).slice(0, ATTRIBUTE_TEXT_MAX) }
}

/** Hidden files a folder drop brings along (`.DS_Store`, `._x.png`). Legacy skipped them silently. */
export function isHiddenFile(fileName: string): boolean {
  const base = fileName.split('/').pop() ?? fileName
  return base.startsWith('.') || base === 'Thumbs.db' || base === 'desktop.ini'
}

/** Splits files into what to check, hidden files to skip, and repeats of a file already added. */
export function sortIncoming<F extends { name: string; size: number }>(
  files: F[],
  existing: { fileName: string; bytes: number | null }[],
) {
  const seen = new Set(existing.map((item) => `${item.fileName}\u0000${item.bytes ?? -1}`))
  const fresh: F[] = []
  const hidden: F[] = []
  const repeated: F[] = []
  for (const file of files) {
    if (isHiddenFile(file.name)) {
      hidden.push(file)
      continue
    }
    const id = `${file.name}\u0000${file.size}`
    if (seen.has(id)) repeated.push(file)
    else {
      seen.add(id)
      fresh.push(file)
    }
  }
  return { fresh, hidden, repeated }
}

export function inBatches<T>(list: T[], size = ADD_BATCH_SIZE): T[][] {
  const batches: T[][] = []
  for (let at = 0; at < list.length; at += size) batches.push(list.slice(at, at + size))
  return batches
}

/** Case-insensitive identity of a trait, as legacy merged `layers_dir` rows. */
export function traitKey(attribute: Attribute): string {
  return `${attribute.traitType.trim().toLowerCase()}\u0000${attribute.value.trim().toLowerCase()}`
}

/** Sets an attribute, replacing one of the same trait type (bulk edit, legacy "custom layers"). */
export function withAttribute(attributes: Attribute[], next: Attribute): Attribute[] {
  const type = next.traitType.trim().toLowerCase()
  const at = attributes.findIndex((attribute) => attribute.traitType.trim().toLowerCase() === type)
  if (at === -1) return [...attributes, next]
  return attributes.map((attribute, index) => (index === at ? next : attribute))
}

export function withoutTraitType(attributes: Attribute[], traitType: string): Attribute[] {
  const type = traitType.trim().toLowerCase()
  return attributes.filter((attribute) => attribute.traitType.trim().toLowerCase() !== type)
}

/** Replacing a single asset's file: the Name attribute follows the new file, the rest are kept. */
export function attributesForReplacement(
  attributes: Attribute[],
  oldFileName: string | null,
  newFileName: string,
): Attribute[] {
  const old = oldFileName ? fileNameAttribute(oldFileName) : null
  const hadName = attributes.some((attribute) => traitKey(attribute) === (old && traitKey(old)))
  const hasOtherName = attributes.some(
    (attribute) => attribute.traitType.trim().toLowerCase() === FILE_NAME_TRAIT.toLowerCase(),
  )
  if (hadName || !hasOtherName) return withAttribute(attributes, fileNameAttribute(newFileName))
  return attributes
}

/** Why a row set cannot be saved, or null. */
export function attributeRowsError(rows: Attribute[]): string | null {
  const filled = rows.filter((row) => row.traitType.trim() || row.value.trim())
  if (filled.some((row) => !row.traitType.trim() || !row.value.trim()))
    return 'Fill in both the trait type and the value, or remove the row.'
  if (filled.length > MAX_ATTRIBUTES) return `At most ${MAX_ATTRIBUTES} attributes.`
  const types = filled.map((row) => row.traitType.trim().toLowerCase())
  const repeated = filled.find((row, index) => types.indexOf(row.traitType.trim().toLowerCase()) !== index)
  if (repeated) return `"${repeated.traitType.trim()}" is used twice. Each trait type appears once.`
  return null
}

/** Why a token name cannot be used, or null. Legacy: required, 40 characters. */
export function tokenNameError(name: string): string | null {
  const trimmed = name.trim()
  if (!trimmed) return 'Enter a token name.'
  if (trimmed.length > TOKEN_NAME_MAX) return `At most ${TOKEN_NAME_MAX} characters.`
  // The id is appended after " #"; a "#" in the name would make it ambiguous.
  if (trimmed.includes('#')) return 'Leave out "#". The token id is added after the name.'
  return null
}

export function tokenDescriptionError(description: string): string | null {
  return description.length > TOKEN_DESCRIPTION_MAX ? `At most ${TOKEN_DESCRIPTION_MAX} characters.` : null
}

/** A small seeded generator (mulberry32), so a shuffle can be repeated from its seed. */
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

/** Ids 1 to `count`, in order or shuffled (Fisher-Yates, as legacy's shuffle). */
export function tokenIds(count: number, order: TokenOrder, seed: number): number[] {
  const ids = Array.from({ length: count }, (_, index) => index + 1)
  if (order === 'upload') return ids
  const random = seededRandom(seed)
  for (let at = ids.length - 1; at > 0; at--) {
    const swap = Math.floor(random() * (at + 1))
    ;[ids[at], ids[swap]] = [ids[swap]!, ids[at]!]
  }
  return ids
}

/** Every edition of every file as a token, in file order, with its id and name. */
export function buildOneOfOneTokens(items: TokenSource[], details: TokenDetails): OneOfOneToken[] {
  const total = items.reduce((sum, item) => sum + item.quantity, 0)
  const ids = tokenIds(total, details.order, details.seed)
  const name = details.name.trim()
  const tokens: OneOfOneToken[] = []
  for (const item of items)
    for (let edition = 1; edition <= item.quantity; edition++) {
      const id = ids[tokens.length]!
      tokens.push({
        id,
        name: `${name} #${id}`,
        description: details.description.trim(),
        itemKey: item.key,
        edition,
        attributes: item.attributes,
      })
    }
  return tokens
}

/** Each file's token ids, ascending. */
export function idsByItem(tokens: OneOfOneToken[]): Map<string, number[]> {
  const map = new Map<string, number[]>()
  for (const token of tokens) {
    const list = map.get(token.itemKey) ?? []
    list.push(token.id)
    map.set(token.itemKey, list)
  }
  for (const list of map.values()) list.sort((a, b) => a - b)
  return map
}

/** "#3", "#3 to #7", or "#2, #9, #14 and 4 more" for shuffled editions. */
export function formatIds(ids: number[]): string {
  if (ids.length === 0) return ''
  const n = (value: number) => `#${value.toLocaleString('en-US')}`
  if (ids.length === 1) return n(ids[0]!)
  const contiguous = ids.every((id, index) => index === 0 || id === ids[index - 1]! + 1)
  if (contiguous) return `${n(ids[0]!)} to ${n(ids[ids.length - 1]!)}`
  const shown = ids.slice(0, 3).map(n).join(', ')
  return ids.length > 3 ? `${shown} and ${(ids.length - 3).toLocaleString('en-US')} more` : shown
}

export type Rarity = {
  score: number
  /** Ranks of this file's editions: rank 1 is the rarest token in the collection. */
  firstRank: number
  lastRank: number
}

/**
 * Legacy 1/1 rarity. Every edition of a file has the same attributes, so the same score; ties keep
 * token order, so a file's editions hold consecutive ranks.
 */
export function rankItems(items: TokenSource[]): Map<string, Rarity> {
  const total = items.reduce((sum, item) => sum + item.quantity, 0)
  const frequency = new Map<string, number>()
  for (const item of items)
    for (const key of new Set(item.attributes.map(traitKey)))
      frequency.set(key, (frequency.get(key) ?? 0) + item.quantity)

  const scored = items.map((item, index) => {
    const keys = item.attributes.map(traitKey)
    const sum = keys.reduce((acc, key) => acc + total / (frequency.get(key) || 1), 0)
    return { item, index, score: keys.length === 0 || total === 0 ? 0 : sum / keys.length / total }
  })
  scored.sort((a, b) => b.score - a.score || a.index - b.index)

  const ranks = new Map<string, Rarity>()
  let next = 1
  for (const { item, score } of scored) {
    ranks.set(item.key, { score, firstRank: next, lastRank: next + item.quantity - 1 })
    next += item.quantity
  }
  return ranks
}

export type TraitValueCount = { key: string; value: string; count: number; share: number }
export type TraitTypeSummary = { traitType: string; values: TraitValueCount[] }

/** Tokens per trait value (editions counted), as legacy's metadata view built from `layers_dir`. */
export function summarizeTraits(items: TokenSource[]): TraitTypeSummary[] {
  const total = items.reduce((sum, item) => sum + item.quantity, 0)
  const types = new Map<string, { traitType: string; values: Map<string, TraitValueCount> }>()
  for (const item of items)
    for (const attribute of item.attributes) {
      const typeId = attribute.traitType.trim().toLowerCase()
      const type = types.get(typeId) ?? { traitType: attribute.traitType.trim(), values: new Map() }
      types.set(typeId, type)
      const key = traitKey(attribute)
      const entry = type.values.get(key) ?? { key, value: attribute.value.trim(), count: 0, share: 0 }
      entry.count += item.quantity
      type.values.set(key, entry)
    }
  return [...types.values()]
    .map(({ traitType, values }) => ({
      traitType,
      values: [...values.values()]
        .map((entry) => ({ ...entry, share: total === 0 ? 0 : entry.count / total }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)),
    }))
    .sort((a, b) => a.traitType.localeCompare(b.traitType))
}

/** Any ticked value within a trait type, every trait type with a tick (marketplace filtering). */
export function matchesTraitFilter(item: TokenSource, filters: ReadonlySet<string>): boolean {
  if (filters.size === 0) return true
  const byType = new Map<string, string[]>()
  for (const key of filters) {
    const type = key.split('\u0000')[0]!
    byType.set(type, [...(byType.get(type) ?? []), key])
  }
  const own = new Set(item.attributes.map(traitKey))
  return [...byType.values()].every((keys) => keys.some((key) => own.has(key)))
}

export type AssetSort = 'upload' | 'rarity' | 'name'

/** The files in view: search by file name, trait filter, then sort. */
export function visibleItems<T extends TokenSource>(
  items: T[],
  options: { search: string; filters: ReadonlySet<string>; sort: AssetSort; ranks: Map<string, Rarity> },
): T[] {
  const query = options.search.trim().toLowerCase()
  const list = items.filter(
    (item) =>
      (!query || item.fileName.toLowerCase().includes(query)) && matchesTraitFilter(item, options.filters),
  )
  if (options.sort === 'name')
    return [...list].sort((a, b) => a.fileName.localeCompare(b.fileName, 'en', { numeric: true }))
  if (options.sort === 'rarity')
    return [...list].sort(
      (a, b) => (options.ranks.get(a.key)?.firstRank ?? 0) - (options.ranks.get(b.key)?.firstRank ?? 0),
    )
  return list
}
