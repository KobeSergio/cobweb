import { zeroAddress, type Address } from 'viem'
import { describe, expect, it } from 'vitest'
import type { PreparedArgs } from '@/lib/deploy/deploy-types'
import type { ChainState } from './phases-types'
import type { RevealTargets, SettingsCopyRow, SettingsState, SettingsView } from './settings-types'
import {
  ipfsUriValid,
  levelOf,
  pointerOf,
  settingsPayload,
  settingsViewOf,
  tokenUriOf,
} from './settings-view'

const CONTRACT: Address = '0x0409454C375c8a6aB05383bFB6D9FcDe9ebB8F85'
const OWNER: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const PAYOUT: Address = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
const VALIDATOR: Address = '0x721C008fdff27BF06E7E123956E2Fe03B63342e3'
const CID = (letter: string) => `bafybei${letter.repeat(52)}`
const REAL = `ipfs://${CID('e')}/`
const PLACEHOLDER = `ipfs://${CID('q')}/metadata.json`
const targets: RevealTargets = { real: REAL, placeholder: PLACEHOLDER, start: PLACEHOLDER }

describe('ipfsUriValid', () => {
  it('takes a full ipfs:// link with a CID, a folder or a single file', () => {
    for (const uri of [
      REAL,
      PLACEHOLDER,
      `ipfs://${CID('f')}`,
      `ipfs://Qm${'1'.repeat(44)}/`,
      `ipfs://${CID('a')}/${'x'.repeat(512 - 67)}`,
    ])
      expect(ipfsUriValid(uri)).toBe(true)
  })

  it('refuses a CID without the scheme, a malformed CID, a space, or more than 512 characters', () => {
    for (const uri of [
      CID('e'),
      `https://${CID('e')}/`,
      'ipfs://bafy/',
      `ipfs://${CID('e')}/a b`,
      `ipfs://${CID('a')}/${'x'.repeat(512 - 66)}`,
    ])
      expect(ipfsUriValid(uri)).toBe(false)
  })
})

describe('tokenUriOf', () => {
  it("follows the contract's rule: a folder gets the id, a single file and an empty base stay as they are", () => {
    expect(tokenUriOf(REAL)).toBe(`${REAL}1`)
    expect(tokenUriOf(PLACEHOLDER)).toBe(PLACEHOLDER)
    expect(tokenUriOf('')).toBe('')
  })
})

describe('pointerOf', () => {
  it('reads revealed for the real job first, so a collection deployed on its real job reads revealed (Review Focus 4)', () => {
    expect(pointerOf(REAL, { real: REAL, placeholder: null, start: REAL })).toBe('revealed')
    expect(pointerOf(REAL, targets)).toBe('revealed')
  })

  it('reads the placeholder for the placeholder job or the deploy-time link, and custom otherwise, exactly', () => {
    expect(pointerOf(PLACEHOLDER, targets)).toBe('placeholder')
    expect(
      pointerOf(`ipfs://${CID('s')}`, { real: null, placeholder: null, start: `ipfs://${CID('s')}` }),
    ).toBe('placeholder')
    expect(pointerOf(`ipfs://${CID('f')}/`, targets)).toBe('custom')
    expect(pointerOf(REAL.slice(0, -1), targets)).toBe('custom')
    expect(pointerOf(REAL, { real: null, placeholder: PLACEHOLDER, start: PLACEHOLDER })).toBe('custom')
  })
})

describe('levelOf', () => {
  it('reads no validator, no code, a validator that did not answer, and a level', () => {
    expect(levelOf(zeroAddress, false, null)).toEqual({ kind: 'none', reason: 'zero' })
    expect(levelOf(VALIDATOR, false, null)).toEqual({ kind: 'none', reason: 'no-code' })
    expect(levelOf(VALIDATOR, true, null)).toEqual({ kind: 'unread' })
    expect(levelOf(VALIDATOR, true, 9)).toEqual({ kind: 'level', level: 9 })
  })
})

const args: PreparedArgs = {
  name: 'Night Owls',
  symbol: 'OWL',
  payout: OWNER,
  baseUri: PLACEHOLDER,
  maxSupply: '12',
  groupSupplies: ['12'],
  groupPrices: ['0'],
  publicMaxPerWallet: '2',
  royaltyBps: 500,
  owner: OWNER,
  royaltyReceiver: OWNER,
}
const copies: SettingsCopyRow = {
  payout_address: PAYOUT.toLowerCase(),
  royalty_bps: 1500,
  royalty_receiver: OWNER.toLowerCase(),
  base_uri: PLACEHOLDER,
  transfer_validator: null,
  mint_on_behalf: true,
  args,
}
const chain: ChainState = {
  block: 120n,
  blockTimestamp: 1_791_039_600,
  maxSupply: 12,
  totalMinted: 1,
  publicMaxMintPerWallet: 2,
  mintOnBehalfActive: false,
  groups: [],
}
const state: SettingsState = {
  block: 120n,
  blockTimestamp: 1_791_039_600,
  chain,
  creatorBalanceWei: '1000000000000000',
  platformBalanceWei: '800000000000000',
  pendingBalanceWei: '0',
  payout: OWNER,
  royaltyBps: 750,
  royaltyReceiver: PAYOUT,
  baseUri: REAL,
  validator: VALIDATOR,
  owner: OWNER,
  fees: { mintFeeFlatWei: '0', mintFeeBps: 0, airdropFeePerTokenWei: '100000000000000' },
  level: { kind: 'none', reason: 'no-code' },
}
const base = { chainId: 31337, contract: CONTRACT, readAt: 1_791_000_000 }

describe('settingsViewOf', () => {
  it("answers the chain's values from a read, the copied ones included, at the read's block time", () => {
    expect(settingsViewOf(base, copies, targets, '5', state)).toEqual<SettingsView>({
      chainId: 31337,
      contract: CONTRACT,
      owner: OWNER,
      creatorBalanceWei: '1000000000000000',
      platformBalanceWei: '800000000000000',
      pendingBalanceWei: '0',
      withdrawnWei: '5',
      fees: { mintFeeFlatWei: '0', mintFeeBps: 0, airdropFeePerTokenWei: '100000000000000' },
      payout: OWNER,
      royaltyBps: 750,
      royaltyReceiver: PAYOUT,
      baseUri: REAL,
      transferValidator: VALIDATOR,
      mintOnBehalf: false,
      level: { kind: 'none', reason: 'no-code' },
      targets,
      pointer: 'revealed',
      realArtRendered: true,
      blockTimestamp: 1_791_039_600,
      readAt: 1_791_039_600,
      chainReachable: true,
    })
  })

  it('answers the copies when the chain does not answer: no balance, fee, owner or level, the copy time', () => {
    const view = settingsViewOf(base, copies, { ...targets, real: null }, '5', null)
    expect(view).toEqual<SettingsView>({
      chainId: 31337,
      contract: CONTRACT,
      owner: null,
      creatorBalanceWei: null,
      platformBalanceWei: null,
      pendingBalanceWei: null,
      withdrawnWei: '5',
      fees: null,
      payout: PAYOUT,
      royaltyBps: 1500,
      royaltyReceiver: OWNER,
      baseUri: PLACEHOLDER,
      transferValidator: null,
      mintOnBehalf: true,
      level: null,
      targets: { ...targets, real: null },
      pointer: 'placeholder',
      realArtRendered: false,
      blockTimestamp: 1_791_000_000,
      readAt: 1_791_000_000,
      chainReachable: false,
    })
    expect(
      settingsViewOf(base, { ...copies, transfer_validator: zeroAddress }, targets, '0', null),
    ).toMatchObject({
      transferValidator: zeroAddress,
    })
  })
})

describe('settingsPayload', () => {
  it('copies the six settings from a read, addresses lowercase', () => {
    expect(settingsPayload(state)).toEqual({
      payout_address: OWNER.toLowerCase(),
      royalty_bps: 750,
      royalty_receiver: PAYOUT.toLowerCase(),
      base_uri: REAL,
      transfer_validator: VALIDATOR.toLowerCase(),
      mint_on_behalf: false,
    })
  })
})
