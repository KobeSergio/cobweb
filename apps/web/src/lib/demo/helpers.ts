import type { Address, Hex, SupportedChain } from './types'

/** Parses a decimal amount ("0.0015") into wei as a decimal string. */
export function toWei(amount: string, decimals = 18): string {
  const [whole = '0', fraction = ''] = amount.split('.')
  const padded = (fraction + '0'.repeat(decimals)).slice(0, decimals)
  return (BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded || '0')).toString()
}

/**
 * Formats wei as a native amount, e.g. `0.0015 ETH`. Trailing zeros are dropped; at most
 * `maxDecimals` places are shown.
 */
export function formatNative(wei: string | bigint, symbol: string, maxDecimals = 6): string {
  const value = BigInt(wei)
  const base = 10n ** 18n
  const whole = value / base
  const fraction = (value % base).toString().padStart(18, '0').slice(0, maxDecimals).replace(/0+$/, '')
  const wholeText = whole.toLocaleString('en-US')
  return `${fraction ? `${wholeText}.${fraction}` : wholeText} ${symbol}`
}

/** Adds wei amounts. */
export function sumWei(...amounts: (string | bigint)[]): string {
  return amounts.reduce<bigint>((sum, amount) => sum + BigInt(amount), 0n).toString()
}

/** Multiplies a wei amount by a whole number. */
export function mulWei(amount: string | bigint, times: number | bigint): string {
  return (BigInt(amount) * BigInt(times)).toString()
}

/** Basis points as a percentage, e.g. 500 to `5%`, 250 to `2.5%`. */
export function formatBps(bps: number): string {
  return `${(bps / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`
}

/** `0x1234…abcd`. */
export function shortAddress(address: string, chars = 4): string {
  return `${address.slice(0, 2 + chars)}…${address.slice(-chars)}`
}

export function explorerAddressUrl(chain: SupportedChain, address: Address): string {
  return `${chain.explorerUrl}/address/${address}`
}

export function explorerTxUrl(chain: SupportedChain, hash: Hex): string {
  return `${chain.explorerUrl}/tx/${hash}`
}

/** A unix timestamp (seconds) as a UTC date and time, so server and browser render the same text. */
export function formatUtc(seconds: number): string {
  return `${new Date(seconds * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

/**
 * A deterministic hex string from a seed, for sample addresses and hashes. Not random: the same
 * seed always gives the same value, so server and client render match.
 */
export function sampleHex(seed: number, bytes: number): `0x${string}` {
  let state = (seed * 2654435761) >>> 0
  let out = ''
  while (out.length < bytes * 2) {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    out += ((t ^ (t >>> 14)) >>> 0).toString(16).padStart(8, '0')
  }
  return `0x${out.slice(0, bytes * 2)}`
}

export const sampleAddress = (seed: number): Address => sampleHex(seed, 20)
export const sampleTxHash = (seed: number): Hex => sampleHex(seed + 100_000, 32)

/**
 * The supply a sample-backed screen should draw against. A real collection has no supply until
 * its art sets one; in sample mode the sample collection's supply stands in so counts stay sane.
 */
export function sampleSupply(maxSupply: number | null, fallback: number): number {
  return maxSupply ?? (process.env.NEXT_PUBLIC_DEMO_DATA === '1' ? fallback : 0)
}

/**
 * A sample count drawn against a real collection's supply. Sample mint groups mint 238 of the
 * sample's 777; a real row with `max_supply` 100 must never read "238 of 100".
 */
export function clampToSupply(count: number, maxSupply: number): number {
  return Math.min(count, maxSupply)
}
