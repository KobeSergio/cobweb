import { getAbiItem, toEventSelector, toFunctionSelector } from 'viem'
import { describe, expect, it } from 'vitest'
import { factoryAbi } from './factory-abi.ts'

describe('factoryAbi', () => {
  it('holds the five entries the app uses, in order', () => {
    expect(factoryAbi.map((entry) => `${entry.type} ${entry.name}`)).toEqual([
      'function payForArt',
      'function artFeePerToken',
      'function jobPayment',
      'function treasury',
      'event ArtPaid',
    ])
  })

  it('matches the contract signatures', () => {
    expect(toFunctionSelector(getAbiItem({ abi: factoryAbi, name: 'payForArt' }))).toBe(
      toFunctionSelector('payForArt(bytes32)'),
    )
    expect(toFunctionSelector(getAbiItem({ abi: factoryAbi, name: 'jobPayment' }))).toBe(
      toFunctionSelector('jobPayment(bytes32,address)'),
    )
    expect(toEventSelector(getAbiItem({ abi: factoryAbi, name: 'ArtPaid' }))).toBe(
      toEventSelector('ArtPaid(bytes32,address,uint256)'),
    )
  })
})
