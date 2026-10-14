import { getAbiItem, toEventSelector, toFunctionSelector } from 'viem'
import { describe, expect, it } from 'vitest'
import { factoryAbi } from './factory-abi.ts'

describe('factoryAbi', () => {
  it('holds the ten entries the app uses, in order: five for the pay flow, five for the deploy flow', () => {
    expect(factoryAbi.map((entry) => `${entry.type} ${entry.name}`)).toEqual([
      'function payForArt',
      'function artFeePerToken',
      'function jobPayment',
      'function treasury',
      'event ArtPaid',
      'function deployCollection',
      'function predictCollectionAddress',
      'function collectionFees',
      'function isCollection',
      'event CollectionDeployed',
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

  it('matches the deploy signatures and the CollectionDeployed event', () => {
    expect(toFunctionSelector(getAbiItem({ abi: factoryAbi, name: 'deployCollection' }))).toBe(
      toFunctionSelector('deployCollection(bytes,bytes,bytes32)'),
    )
    expect(toFunctionSelector(getAbiItem({ abi: factoryAbi, name: 'predictCollectionAddress' }))).toBe(
      toFunctionSelector('predictCollectionAddress(address,bytes,bytes,bytes32)'),
    )
    expect(toFunctionSelector(getAbiItem({ abi: factoryAbi, name: 'collectionFees' }))).toBe(
      toFunctionSelector('collectionFees()'),
    )
    expect(toFunctionSelector(getAbiItem({ abi: factoryAbi, name: 'isCollection' }))).toBe(
      toFunctionSelector('isCollection(address)'),
    )
    expect(toEventSelector(getAbiItem({ abi: factoryAbi, name: 'CollectionDeployed' }))).toBe(
      toEventSelector('CollectionDeployed(address,bytes32,address,bytes32)'),
    )
    // The three indexed topics the confirming core filters on, then the salt in the data.
    const event = getAbiItem({ abi: factoryAbi, name: 'CollectionDeployed' })
    expect(event.inputs.map((input) => `${input.name}:${input.indexed ? 'indexed' : 'data'}`)).toEqual([
      'collection:indexed',
      'codeHash:indexed',
      'deployer:indexed',
      'salt:data',
    ])
  })
})
