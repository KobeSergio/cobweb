import { formatBytes } from '../lib/image-checks'
import { ASSET_MAX_BYTES, type Attribute } from './types'

/** The strict rules a metadata project's JSON must pass, in the order the checklist shows them. */
export type RuleId = 'required' | 'name' | 'keys' | 'attributes' | 'pairs' | 'sequence' | 'size'

export const METADATA_RULES: { id: RuleId; label: string }[] = [
  { id: 'required', label: 'Every JSON file has a name and attributes' },
  { id: 'name', label: 'Names read "Name #N" and N is the file number' },
  { id: 'keys', label: 'Only name, attributes, description, date, tokenId and id are used' },
  { id: 'attributes', label: 'Each attribute is a trait_type and a value, both text, nothing else' },
  { id: 'pairs', label: 'Images and JSON files match in count and pair by number' },
  { id: 'sequence', label: 'Numbering runs 1 to N with no gaps' },
  { id: 'size', label: 'Every file is 20 MB or smaller, and images are PNG, JPG or WebP' },
]

export type Issue = { rule: RuleId; message: string }

export type StagedJson = {
  key: string
  fileName: string
  number: number | null
  attributes: Attribute[]
  name: string | null
  issues: Issue[]
}

export type StagedImage = {
  key: string
  fileName: string
  number: number | null
  url: string
  bytes: number
  issues: Issue[]
}

const ALLOWED_KEYS = new Set(['name', 'attributes', 'description', 'date', 'tokenId', 'id'])
const NAME_PATTERN = /^(.+) #(\d+)$/

/** `12.png` gives 12; anything else gives null. */
export function fileNumber(fileName: string): number | null {
  const match = /^(\d+)\.[a-z0-9]+$/i.exec(fileName)
  return match ? Number(match[1]) : null
}

export function isJsonFile(file: File): boolean {
  return file.type === 'application/json' || /\.json$/i.test(file.name)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Parses one JSON file's text and records every rule it breaks. */
export function checkJson(key: string, fileName: string, text: string, bytes: number): StagedJson {
  const number = fileNumber(fileName)
  const issues: Issue[] = []
  const entry: StagedJson = { key, fileName, number, attributes: [], name: null, issues }
  if (bytes > ASSET_MAX_BYTES)
    issues.push({ rule: 'size', message: `${formatBytes(bytes)} is over the 20 MB limit.` })

  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    issues.push({ rule: 'required', message: 'This is not valid JSON.' })
    return entry
  }
  if (!isPlainObject(data)) {
    issues.push({ rule: 'required', message: 'The file must hold one JSON object.' })
    return entry
  }

  if (typeof data.name !== 'string' || data.name.trim() === '')
    issues.push({ rule: 'required', message: 'Missing name.' })
  if (!('attributes' in data)) issues.push({ rule: 'required', message: 'Missing attributes.' })

  if (typeof data.name === 'string' && data.name.trim() !== '') {
    entry.name = data.name
    const match = NAME_PATTERN.exec(data.name)
    if (!match) issues.push({ rule: 'name', message: `"${data.name}" does not read "Name #N".` })
    else if (number !== null && Number(match[2]) !== number)
      issues.push({
        rule: 'name',
        message: `The name ends in #${match[2]} but the file number is ${number}.`,
      })
  }

  const extra = Object.keys(data).filter((name) => !ALLOWED_KEYS.has(name))
  if (extra.length > 0) issues.push({ rule: 'keys', message: `Not allowed: ${extra.join(', ')}.` })

  if ('attributes' in data) {
    if (!Array.isArray(data.attributes)) {
      issues.push({ rule: 'attributes', message: 'attributes must be a list.' })
    } else {
      data.attributes.forEach((attribute, index) => {
        const at = `Attribute ${index + 1}`
        if (!isPlainObject(attribute)) {
          issues.push({ rule: 'attributes', message: `${at} must be an object.` })
          return
        }
        const { trait_type: traitType, value } = attribute
        if (typeof traitType !== 'string' || typeof value !== 'string')
          issues.push({ rule: 'attributes', message: `${at} needs a text trait_type and a text value.` })
        else entry.attributes.push({ traitType, value })
        const unknown = Object.keys(attribute).filter((name) => name !== 'trait_type' && name !== 'value')
        if (unknown.length > 0)
          issues.push({ rule: 'attributes', message: `${at} has extra keys: ${unknown.join(', ')}.` })
      })
    }
  }
  return entry
}

export type RuleResult = {
  id: RuleId
  label: string
  status: 'idle' | 'pass' | 'fail'
  /** What broke, one line each. */
  problems: string[]
}

export type MetadataReport = {
  rules: RuleResult[]
  ok: boolean
  /** Numbers that have both an image and a JSON file, ascending. */
  pairs: number[]
}

function ranges(numbers: number[]): string {
  return numbers.length > 6
    ? `${numbers.slice(0, 6).join(', ')} and ${numbers.length - 6} more`
    : numbers.join(', ')
}

/** Runs every rule over everything dropped so far. Nothing dropped means every rule is idle. */
export function evaluate(images: StagedImage[], jsons: StagedJson[]): MetadataReport {
  const problems = new Map<RuleId, string[]>(METADATA_RULES.map((rule) => [rule.id, []]))
  const push = (rule: RuleId, message: string) => problems.get(rule)!.push(message)

  for (const json of jsons)
    for (const issue of json.issues) push(issue.rule, `${json.fileName}: ${issue.message}`)
  for (const image of images)
    for (const issue of image.issues) push(issue.rule, `${image.fileName}: ${issue.message}`)

  const imageNumbers = new Map<number, number>()
  const jsonNumbers = new Map<number, number>()
  for (const image of images) {
    if (image.number === null) push('pairs', `${image.fileName}: name the file with a number, like 1.png.`)
    else imageNumbers.set(image.number, (imageNumbers.get(image.number) ?? 0) + 1)
  }
  for (const json of jsons) {
    if (json.number === null) push('pairs', `${json.fileName}: name the file with a number, like 1.json.`)
    else jsonNumbers.set(json.number, (jsonNumbers.get(json.number) ?? 0) + 1)
  }
  if (images.length !== jsons.length)
    push(
      'pairs',
      `${images.length.toLocaleString('en-US')} images and ${jsons.length.toLocaleString('en-US')} JSON files.`,
    )
  const lonely = (from: Map<number, number>, other: Map<number, number>) =>
    [...from.keys()].filter((number) => !other.has(number)).sort((a, b) => a - b)
  const noJson = lonely(imageNumbers, jsonNumbers)
  const noImage = lonely(jsonNumbers, imageNumbers)
  if (noJson.length > 0) push('pairs', `No JSON file for ${ranges(noJson)}.`)
  if (noImage.length > 0) push('pairs', `No image for ${ranges(noImage)}.`)
  const repeated = [...imageNumbers, ...jsonNumbers]
    .filter(([, count]) => count > 1)
    .map(([number]) => number)
  if (repeated.length > 0) push('pairs', `Number used twice: ${ranges([...new Set(repeated)])}.`)

  const all = [...new Set([...imageNumbers.keys(), ...jsonNumbers.keys()])].sort((a, b) => a - b)
  const gaps: number[] = []
  if (all.length > 0) {
    const set = new Set(all)
    for (let n = 1; n <= all[all.length - 1]!; n++) if (!set.has(n)) gaps.push(n)
  }
  if (gaps.length > 0) push('sequence', `Missing ${ranges(gaps)}.`)

  const hasJson = jsons.length > 0
  const hasAny = hasJson || images.length > 0
  const idleWithoutJson: RuleId[] = ['required', 'name', 'keys', 'attributes']
  const rules = METADATA_RULES.map<RuleResult>((rule) => {
    const list = problems.get(rule.id)!
    const idle = idleWithoutJson.includes(rule.id) ? !hasJson : !hasAny
    return { ...rule, status: idle ? 'idle' : list.length > 0 ? 'fail' : 'pass', problems: list }
  })
  const pairs = [...imageNumbers.keys()].filter((number) => jsonNumbers.has(number)).sort((a, b) => a - b)
  return {
    rules,
    ok: hasAny && hasJson && images.length > 0 && rules.every((r) => r.status === 'pass'),
    pairs,
  }
}
