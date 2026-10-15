import { getAbiItem, getAddress, toEventSelector, toFunctionSelector } from 'viem'
import { describe, expect, it } from 'vitest'
import { DEFAULT_TRANSFER_VALIDATOR, validatorAbi } from './validator-abi.ts'

describe('validatorAbi (docs/specs/2026-10-15-airdrop-settings.md, section 5)', () => {
  it('holds the three entries Settings uses, in order', () => {
    expect(validatorAbi.map((entry) => `${entry.type} ${entry.name}`)).toEqual([
      'function setTransferSecurityLevelOfCollection',
      'function getCollectionSecurityPolicy',
      'event SetTransferSecurityLevel',
    ])
  })

  it("matches the pinned library's signatures and argument names", () => {
    const setter = getAbiItem({ abi: validatorAbi, name: 'setTransferSecurityLevelOfCollection' })
    expect(toFunctionSelector(setter)).toBe(
      toFunctionSelector('setTransferSecurityLevelOfCollection(address,uint8,bool,bool,bool)'),
    )
    expect(toFunctionSelector(setter)).toBe('0x317e3e8d')
    expect(setter.inputs.map((input) => input.name)).toEqual([
      'collection',
      'level',
      'disableAuthorizationMode',
      'disableWildcardOperators',
      'enableAccountFreezingMode',
    ])
    const policy = getAbiItem({ abi: validatorAbi, name: 'getCollectionSecurityPolicy' })
    expect(toFunctionSelector(policy)).toBe('0xb9554552')
    expect(policy.outputs[0]?.components.map((component) => component.name)).toEqual([
      'disableAuthorizationMode',
      'authorizersCannotSetWildcardOperators',
      'transferSecurityLevel',
      'listId',
      'enableAccountFreezingMode',
      'tokenType',
    ])
  })

  it('carries the level event with the collection indexed and the level in data', () => {
    const event = getAbiItem({ abi: validatorAbi, name: 'SetTransferSecurityLevel' })
    expect(toEventSelector(event)).toBe(toEventSelector('SetTransferSecurityLevel(address,uint8)'))
    expect(event.inputs.map((input) => [input.name, input.indexed])).toEqual([
      ['collection', true],
      ['level', false],
    ])
  })

  it('ships the default validator checksummed', () => {
    expect(getAddress(DEFAULT_TRANSFER_VALIDATOR)).toBe(DEFAULT_TRANSFER_VALIDATOR)
    expect(DEFAULT_TRANSFER_VALIDATOR).toBe('0x721C008fdff27BF06E7E123956E2Fe03B63342e3')
  })
})
