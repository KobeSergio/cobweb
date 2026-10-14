import { describe, expect, it } from 'vitest'
import {
  CAP_RANGE,
  CHAIN_REQUIRED,
  collectionArgsOf,
  deployArgs,
  GROUP_COUNT,
  GROUP_NAME,
  GROUP_NAMES_UNIQUE,
  GROUP_PRICE,
  GROUP_SUPPLY,
  GROUPS_OVER_SUPPLY,
  PAYOUT_INVALID,
  PAYOUT_ZERO,
  placeholderPending,
  RECEIVER_INVALID,
  RECEIVER_ZERO,
  resolveDeployChain,
  revealsToOf,
  ROYALTY_RANGE,
  startJobOf,
  validateDeployForm,
} from './deploy-args'
import type { DeployForm } from './deploy-types'

const PAYOUT = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const RECEIVER = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
const ZERO = `0x${'0'.repeat(40)}`

const form: DeployForm = {
  chainId: 8453,
  payout: PAYOUT,
  royaltyBps: 500,
  royaltyReceiver: RECEIVER,
  publicMaxPerWallet: 3,
  groups: [
    { name: 'Public', priceWei: '0', maxSupply: 600 },
    { name: 'Holders', priceWei: '3000000000000000', maxSupply: 177 },
  ],
}

describe('validateDeployForm', () => {
  it('accepts a whole form, checksums the addresses and trims the phase names', () => {
    const result = validateDeployForm(
      {
        ...form,
        payout: PAYOUT.toLowerCase(),
        royaltyReceiver: RECEIVER.toLowerCase(),
        groups: [{ name: '  Public ', priceWei: '0', maxSupply: 777 }],
      },
      777,
    )
    expect(result).toEqual({
      ok: true,
      data: {
        ...form,
        payout: PAYOUT,
        royaltyReceiver: RECEIVER,
        groups: [{ name: 'Public', priceWei: '0', maxSupply: 777 }],
      },
    })
  })

  it.each<[string, Partial<DeployForm> | Record<string, unknown>, string]>([
    ['a missing chain', { chainId: 0 }, CHAIN_REQUIRED],
    ['a payout that is not an address', { payout: 'night-owls' }, PAYOUT_INVALID],
    ['the zero address as payout', { payout: ZERO }, PAYOUT_ZERO],
    ['a receiver that is not an address', { royaltyReceiver: '0x1234' }, RECEIVER_INVALID],
    ['the zero address as receiver', { royaltyReceiver: ZERO }, RECEIVER_ZERO],
    ['a royalty above 1,000 bps', { royaltyBps: 1001 }, ROYALTY_RANGE],
    ['a royalty that is not whole', { royaltyBps: 2.5 }, ROYALTY_RANGE],
    ['a public limit of 0', { publicMaxPerWallet: 0 }, CAP_RANGE],
    ['a public limit above the supply', { publicMaxPerWallet: 778 }, CAP_RANGE],
    ['no phases', { groups: [] }, GROUP_COUNT],
    [
      'eleven phases',
      { groups: Array.from({ length: 11 }, (_, i) => ({ name: `Phase ${i}`, priceWei: '0', maxSupply: 1 })) },
      GROUP_COUNT,
    ],
    ['an empty phase name', { groups: [{ name: '  ', priceWei: '0', maxSupply: 1 }] }, GROUP_NAME],
    [
      'a phase name over 40 characters',
      { groups: [{ name: 'x'.repeat(41), priceWei: '0', maxSupply: 1 }] },
      GROUP_NAME,
    ],
    [
      'two phases with the same name, whatever the case',
      {
        groups: [
          { name: 'Public', priceWei: '0', maxSupply: 1 },
          { name: 'public', priceWei: '0', maxSupply: 1 },
        ],
      },
      GROUP_NAMES_UNIQUE,
    ],
    [
      'a price that is not whole wei',
      { groups: [{ name: 'Public', priceWei: '1.5', maxSupply: 1 }] },
      GROUP_PRICE,
    ],
    ['a negative allocation', { groups: [{ name: 'Public', priceWei: '0', maxSupply: -1 }] }, GROUP_SUPPLY],
    [
      'allocations over the supply',
      {
        groups: [
          { name: 'Public', priceWei: '0', maxSupply: 600 },
          { name: 'Holders', priceWei: '0', maxSupply: 200 },
        ],
      },
      GROUPS_OVER_SUPPLY,
    ],
  ])('refuses %s', (_name, patch, sentence) => {
    expect(validateDeployForm({ ...form, ...patch }, 777)).toEqual({ ok: false, error: sentence })
  })

  it('refuses what is not a form at all', () => {
    expect(validateDeployForm(null, 777).ok).toBe(false)
    expect(validateDeployForm({ chainId: 1 }, 777).ok).toBe(false)
  })
})

describe('resolveDeployChain (Review Focus 2)', () => {
  it('keeps the paid chain and refuses another', () => {
    expect(resolveDeployChain(8453, 8453)).toBe(8453)
    expect(resolveDeployChain(8453, 1)).toBeNull()
  })

  it("takes the form's chain when nothing was paid yet", () => {
    expect(resolveDeployChain(null, 31337)).toBe(31337)
  })
})

describe('startJobOf', () => {
  type Row = { id: string; placeholder_upload_id: string | null }
  const real: Row = { id: 'real', placeholder_upload_id: null }
  const revealLater: Row = { id: 'real', placeholder_upload_id: 'upload-1' }
  const placeholder: Row = { id: 'placeholder', placeholder_upload_id: 'upload-1' }

  it('starts a deferred collection on its placeholder job, and on the real job when there is no placeholder job', () => {
    expect(startJobOf({ artDeferred: true, real: null, placeholder })).toBe(placeholder)
    expect(startJobOf({ artDeferred: true, real, placeholder })).toBe(placeholder)
    expect(startJobOf({ artDeferred: true, real, placeholder: null })).toBe(real)
  })

  it('starts a real job with "Reveal later" on the placeholder job', () => {
    expect(startJobOf({ artDeferred: false, real: revealLater, placeholder })).toBe(placeholder)
    expect(startJobOf({ artDeferred: false, real: revealLater, placeholder: null })).toBe(revealLater)
  })

  it('starts a plain collection on its real job, and nothing on nothing', () => {
    expect(startJobOf({ artDeferred: false, real, placeholder })).toBe(real)
    expect(startJobOf({ artDeferred: false, real: null, placeholder: null })).toBeNull()
  })
})

describe('placeholderPending (ruling on Task 3: a placeholder relocked after a finish)', () => {
  it('is pending while the latest placeholder job of a deferred collection is neither done nor failed', () => {
    for (const state of ['locked', 'payment_due', 'paid', 'waived', 'rendering', 'finalizing'] as const)
      expect(placeholderPending({ artDeferred: true, latestPlaceholderState: state })).toBe(true)
    expect(placeholderPending({ artDeferred: true, latestPlaceholderState: 'done' })).toBe(false)
    expect(placeholderPending({ artDeferred: true, latestPlaceholderState: 'failed' })).toBe(false)
    expect(placeholderPending({ artDeferred: true, latestPlaceholderState: null })).toBe(false)
    expect(placeholderPending({ artDeferred: false, latestPlaceholderState: 'rendering' })).toBe(false)
  })
})

describe('revealsToOf', () => {
  it("names the real set's base URI only when the contract starts somewhere else", () => {
    const real = { id: 'real', base_uri: 'ipfs://real/' }
    expect(revealsToOf({ id: 'placeholder' }, real)).toBe('ipfs://real/')
    expect(revealsToOf({ id: 'real' }, real)).toBeNull()
    expect(revealsToOf({ id: 'placeholder' }, null)).toBeNull()
    expect(revealsToOf(null, real)).toBeNull()
  })
})

describe('deployArgs and collectionArgsOf', () => {
  it('builds the constructor from the row, the start job, the form and the wallet, every uint a string', () => {
    const args = deployArgs(
      { name: 'Night Owls', symbol: 'OWLS', max_supply: 777 },
      { base_uri: 'ipfs://start/' },
      form,
      PAYOUT,
    )
    expect(args).toEqual({
      name: 'Night Owls',
      symbol: 'OWLS',
      payout: PAYOUT,
      baseUri: 'ipfs://start/',
      maxSupply: '777',
      groupSupplies: ['600', '177'],
      groupPrices: ['0', '3000000000000000'],
      publicMaxPerWallet: '3',
      royaltyBps: 500,
      owner: PAYOUT,
      royaltyReceiver: RECEIVER,
    })
    expect(collectionArgsOf(args)).toEqual({
      name: 'Night Owls',
      symbol: 'OWLS',
      payout: PAYOUT,
      baseUri: 'ipfs://start/',
      maxSupply: 777n,
      groupSupplies: [600n, 177n],
      groupPrices: [0n, 3_000_000_000_000_000n],
      publicMaxPerWallet: 3n,
      royaltyBps: 500,
      owner: PAYOUT,
      royaltyReceiver: RECEIVER,
    })
  })
})
