import { getAddress } from 'viem'
import { describe, expect, it } from 'vitest'
import { ZERO_ADDRESS } from '@/lib/art/result'
import { parseRecipients, toCsv, type InvalidRow, type ParseOptions } from './recipients'

const WHITELIST: ParseOptions = {
  defaultAmount: 1,
  maxAmount: 10_000,
  onDuplicate: 'last',
  amountName: 'quota',
}
const AIRDROP: ParseOptions = {
  defaultAmount: 1,
  maxAmount: 1000,
  onDuplicate: 'sum',
  amountName: 'quantity',
}

const A = '0x5e1f0c9b8a7d6e5f4c3b2a1908f7e6d5c4b3a291'
const B = '0x3b9d2c1a0f8e7d6c5b4a39281706f5e4d3c2b1a0'

describe('parseRecipients', () => {
  it('reads legacy files: address,quota with no header', () => {
    const result = parseRecipients(`${A},2\n${B},1\n`, WHITELIST)
    expect(result.header).toBe(false)
    expect(result.rows.map((row) => row.amount)).toEqual([2, 1])
    expect(result.invalid).toEqual([])
  })

  it('skips a header row (legacy rejected the whole file)', () => {
    const result = parseRecipients(`Wallet Address,Mint Quota\n${A},3`, WHITELIST)
    expect(result.header).toBe(true)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]!.amount).toBe(3)
  })

  it('normalises to the checksum and reports a broken checksum', () => {
    const result = parseRecipients(`${A}\n0x5E1F0c9b8a7d6e5f4c3b2a1908f7e6d5c4b3a291`, WHITELIST)
    expect(result.rows[0]!.address).toBe(getAddress(A))
    expect(result.invalid[0]?.line).toBe(2)
    expect(result.invalid[0]?.reason).toMatch(/checksum/)
  })

  it('reports each bad line with its number', () => {
    const result = parseRecipients(`${A},2\nnot-an-address,1\n${B},0\n${B},1.5\n${B},2,3`, WHITELIST)
    expect(result.invalid.map((row) => row.line)).toEqual([2, 3, 4, 5])
    expect(result.rows).toHaveLength(1)
  })

  it('keeps the last quota for a repeated address, and sums airdrop quantities', () => {
    expect(parseRecipients(`${A},2\n${A},5`, WHITELIST).rows[0]!.amount).toBe(5)
    const airdrop = parseRecipients(`${A},2\n${A},5`, AIRDROP)
    expect(airdrop.rows[0]!.amount).toBe(7)
    expect(airdrop.duplicates).toBe(1)
  })

  it('leaves out the repeat that takes an address past 1,000 tokens, with its line, keeping the earlier sum (Review Focus 1)', () => {
    const result = parseRecipients(`${A},2\n${B},1\n${A},999\n${A},998`, AIRDROP)
    expect(result.rows.map((row) => [row.address, row.amount])).toEqual([
      [getAddress(A), 1000],
      [getAddress(B), 1],
    ])
    expect(result.invalid).toEqual<InvalidRow[]>([
      {
        line: 3,
        text: `${A},999`,
        reason: 'With its earlier lines, the quantity for this address passes 1,000.',
      },
    ])
    expect(result.duplicates).toBe(1)
    expect(parseRecipients(`${A},10000\n${A},10000`, WHITELIST).invalid).toEqual([])
  })

  it('refuses the zero address with its line number, for a whitelist and an airdrop alike', () => {
    const zero = '0x0000000000000000000000000000000000000000'
    for (const options of [WHITELIST, AIRDROP]) {
      const result = parseRecipients(`${A},2\n${zero},1\n${B}`, options)
      expect(result.invalid).toEqual<InvalidRow[]>([{ line: 2, text: `${zero},1`, reason: ZERO_ADDRESS }])
      expect(result.rows.map((row) => row.line)).toEqual([1, 3])
    }
  })

  it('takes semicolons, tabs and spaces, and the default amount', () => {
    const result = parseRecipients(`${A};4\n${B}\t2\n0x9c8b7a6f5e4d3c2b1a09f8e7d6c5b4a392817065`, WHITELIST)
    expect(result.rows.map((row) => row.amount)).toEqual([4, 2, 1])
  })
})

describe('toCsv', () => {
  it('quotes cells that need it', () => {
    expect(
      toCsv([
        ['a', 'b,c'],
        [1, 'say "hi"'],
      ]),
    ).toBe('a,"b,c"\n1,"say ""hi"""')
  })
})

describe('parseRecipients with files from other tools', () => {
  it('reads Windows line endings, a BOM, quoted fields and a header row', () => {
    const text = `\uFEFFaddress,quota\r\n"${A}",2\r\n${B},1\r\n`
    const result = parseRecipients(text, WHITELIST)
    expect(result.header).toBe(true)
    expect(result.rows.map((row) => row.amount)).toEqual([2, 1])
    expect(result.invalid).toEqual([])
  })

  it('reports a bad address by its line number', () => {
    const result = parseRecipients(`${A},1\nnot-an-address,1\n`, WHITELIST)
    expect(result.rows).toHaveLength(1)
    expect(result.invalid[0]?.line).toBe(2)
  })
})

describe('parseRecipients with a byte order mark and no header', () => {
  it('still reads the first address', () => {
    const result = parseRecipients(`\uFEFF${A},2\n${B},1\n`, WHITELIST)
    expect(result.header).toBe(false)
    expect(result.rows).toHaveLength(2)
    expect(result.invalid).toEqual([])
  })
})
