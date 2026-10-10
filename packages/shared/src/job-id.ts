import type { Hex } from 'viem'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ONCHAIN = /^0x[0-9a-f]{32}0{32}$/

/**
 * The factory's `bytes32` job id for a render job: the 16 bytes of the row's uuid, left-aligned in
 * 32 bytes. The database derives the same value (`render_jobs.onchain_job_id`).
 */
export function onchainJobId(uuid: string): Hex {
  if (!UUID.test(uuid)) throw new Error('A job id is a uuid.')
  return `0x${uuid.replace(/-/g, '').toLowerCase()}${'0'.repeat(32)}`
}

/** The render job's uuid from its on-chain id. */
export function jobIdFromOnchain(hex: string): string {
  const value = hex.toLowerCase()
  if (!ONCHAIN.test(value)) throw new Error('Not a Cobweb job id.')
  const h = value.slice(2, 34)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
