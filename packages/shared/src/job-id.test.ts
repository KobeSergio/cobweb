import { describe, expect, it } from 'vitest'
import { jobIdFromOnchain, onchainJobId } from './job-id.ts'

const JOB = '0f4a0f3e-2f5e-4e3a-9d1c-1b2c3d4e5f60'

describe('onchainJobId', () => {
  it('puts the 16 uuid bytes first and pads with 16 zero bytes, as art_lock stores it', () => {
    expect(onchainJobId(JOB)).toBe(`0x0f4a0f3e2f5e4e3a9d1c1b2c3d4e5f60${'0'.repeat(32)}`)
    expect(onchainJobId(JOB.toUpperCase())).toBe(onchainJobId(JOB))
  })

  it('round-trips, whatever the case of the hex', () => {
    expect(jobIdFromOnchain(onchainJobId(JOB))).toBe(JOB)
    expect(jobIdFromOnchain(`0x${onchainJobId(JOB).slice(2).toUpperCase()}`)).toBe(JOB)
  })

  it('refuses what is not a uuid or not a Cobweb job id', () => {
    expect(() => onchainJobId('job-1')).toThrow('A job id is a uuid.')
    expect(() => jobIdFromOnchain(`0x${'1'.repeat(64)}`)).toThrow('Not a Cobweb job id.')
    expect(() => jobIdFromOnchain('0x1234')).toThrow('Not a Cobweb job id.')
  })
})
