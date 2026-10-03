import { getAddress, isAddress } from 'viem'
import type { Address } from '@/lib/demo'

/** One valid row: a checksummed address and its amount (a quota or a token quantity). */
export type Recipient = { address: Address; amount: number; line: number }
export type InvalidRow = { line: number; text: string; reason: string }

export type ParseResult = {
  rows: Recipient[]
  invalid: InvalidRow[]
  /** Rows dropped because the address appeared earlier in the same input. */
  duplicates: number
  /** The first line was a header and was skipped. */
  header: boolean
}

export type ParseOptions = {
  /** Used when a row has an address only. */
  defaultAmount: number
  maxAmount: number
  /** What a repeated address does: keep the last amount (whitelist) or add them up (airdrop). */
  onDuplicate: 'last' | 'sum'
  /** "quota" or "quantity", for error text. */
  amountName: string
}

const SPLIT = /[,;\t]|\s+/

/**
 * Parses pasted or uploaded text, one recipient per line: `address` or `address,amount`.
 * Separators may be commas, semicolons, tabs or spaces. A first line without an address is
 * treated as a header. Addresses are validated with viem, normalised to their checksum, and
 * deduplicated; every rejected line is reported with its line number.
 */
export function parseRecipients(text: string, options: ParseOptions): ParseResult {
  const lines = text.split(/\r?\n/)
  const byAddress = new Map<string, Recipient>()
  const invalid: InvalidRow[] = []
  let duplicates = 0
  let header = false

  lines.forEach((raw, index) => {
    const line = index + 1
    const trimmed = raw.trim()
    if (!trimmed || trimmed.startsWith('#')) return
    const cells = trimmed
      .split(SPLIT)
      .map((cell) => cell.trim().replace(/^"|"$/g, ''))
      .filter(Boolean)
    const [first = '', second, ...rest] = cells

    if (byAddress.size === 0 && invalid.length === 0 && !header && !first.toLowerCase().startsWith('0x')) {
      header = true
      return
    }
    if (rest.length > 0) {
      invalid.push({ line, text: trimmed, reason: 'Too many columns. Use address, then amount.' })
      return
    }
    if (!isAddress(first)) {
      const reason = /^0x[0-9a-fA-F]{40}$/.test(first)
        ? 'The checksum does not match. Check the address for a typo.'
        : 'Not a valid address.'
      invalid.push({ line, text: trimmed, reason })
      return
    }
    let amount = options.defaultAmount
    if (second !== undefined) {
      if (!/^\d+$/.test(second)) {
        invalid.push({ line, text: trimmed, reason: `The ${options.amountName} must be a whole number.` })
        return
      }
      amount = Number(second)
      if (amount < 1 || amount > options.maxAmount) {
        invalid.push({
          line,
          text: trimmed,
          reason: `The ${options.amountName} must be 1 to ${options.maxAmount.toLocaleString('en-US')}.`,
        })
        return
      }
    }
    const address = getAddress(first)
    const key = address.toLowerCase()
    const existing = byAddress.get(key)
    if (existing) {
      duplicates++
      existing.amount = options.onDuplicate === 'sum' ? existing.amount + amount : amount
      return
    }
    byAddress.set(key, { address, amount, line })
  })

  return { rows: [...byAddress.values()], invalid, duplicates, header }
}

/** Reads an uploaded file as text, rejecting anything that is clearly not a small CSV. */
export async function readCsvFile(file: File): Promise<string> {
  if (file.size > 5 * 1024 * 1024)
    throw new Error('The file is larger than 5 MB. Split it into smaller files.')
  if (!/\.(csv|txt)$/i.test(file.name) && file.type && !file.type.startsWith('text/')) {
    throw new Error('Choose a CSV or plain text file.')
  }
  return file.text()
}

/** Quote a cell if needed and join rows into CSV text. */
export function toCsv(rows: (string | number)[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => (/[",\n]/.test(String(cell)) ? `"${String(cell).replace(/"/g, '""')}"` : cell))
        .join(','),
    )
    .join('\n')
}
