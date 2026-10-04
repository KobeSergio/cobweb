import { getAddress } from 'viem'
import { describe, expect, it } from 'vitest'
import { parseRecipients, toCsv, type ParseOptions } from './recipients'

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
