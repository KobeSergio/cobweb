import { collectionAbi } from '@cobweb/shared/collection-abi'
import {
  encodeEventTopics,
  encodeFunctionData,
  parseAbi,
  zeroAddress,
  type Address,
  type TransactionReceipt,
} from 'viem'
import { describe, expect, it } from 'vitest'
import { mintCallOf, mintedTokenIds, quoteOf, type MintParams } from './mint-call'

const CONTRACT: Address = '0x0409454C375c8a6aB05383bFB6D9FcDe9ebB8F85'
const ACCOUNT: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const VAULT: Address = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
const OTHER: Address = '0x90F79bf6EB2c4f870365E785982E1f101E93b906'
/** The two mint functions as the contract declares them, written by hand. */
const signatures = parseAbi([
  'function batchMint(uint256 amount, uint256 mintGroup) payable returns (uint256 totalCost)',
  'function delegateMint(uint256 amount, uint256 mintGroup, address vault) payable returns (uint256 totalCost)',
])
const params: MintParams = {
  contract: CONTRACT,
  chainId: 31337,
  groupId: 1,
  amount: 3,
  vault: null,
  valueWei: 3_030_000_000_000_000n,
  account: ACCOUNT,
}

describe('mintCallOf (docs/specs/2026-10-16-mint-page-live-data.md, section 7.5)', () => {
  it('calls batchMint(amount, group) from the account with the quoted value', () => {
    const call = mintCallOf(params)
    expect([call.address, call.functionName, call.args, call.value, call.chainId, call.account]).toEqual([
      CONTRACT,
      'batchMint',
      [3n, 1n],
      3_030_000_000_000_000n,
      31337,
      ACCOUNT,
    ])
    expect(encodeFunctionData({ abi: call.abi, functionName: 'batchMint', args: [3n, 1n] })).toBe(
      encodeFunctionData({ abi: signatures, functionName: 'batchMint', args: [3n, 1n] }),
    )
  })

  it("calls delegateMint(amount, group, vault) with a vault, the tokens landing in the caller's wallet", () => {
    const call = mintCallOf({ ...params, vault: VAULT })
    expect([call.functionName, call.args]).toEqual(['delegateMint', [3n, 1n, VAULT]])
    expect(encodeFunctionData({ abi: call.abi, functionName: 'delegateMint', args: [3n, 1n, VAULT] })).toBe(
      encodeFunctionData({ abi: signatures, functionName: 'delegateMint', args: [3n, 1n, VAULT] }),
    )
  })
})

describe("quoteOf: the contract's quoteBatchMint", () => {
  /** quoteBatchMint as the contract computes it. */
  const contract = (price: bigint, flat: bigint, bps: bigint, amount: bigint) => {
    const platformFee = (flat + (price * bps) / 10_000n) * amount
    return price * amount + platformFee
  }

  it('equals it for prices and fees whose basis points leave a remainder', () => {
    const cases: [bigint, bigint, bigint, bigint][] = [
      [1_000_000_000_000_000n, 10_000_000_000_000n, 250n, 3n],
      [333n, 7n, 125n, 2n],
      [0n, 100_000_000_000_000n, 100n, 5n],
      [999_999n, 0n, 9_999n, 1n],
      [123_456_789_012_345_678_901n, 1n, 1n, 4n],
    ]
    for (const [price, flat, bps, amount] of cases) {
      const quote = quoteOf(
        { mintFeeFlatWei: String(flat), mintFeeBps: Number(bps) },
        String(price),
        Number(amount),
      )
      expect(quote.totalWei).toBe(contract(price, flat, bps, amount))
      expect(quote.priceWei + quote.feeWei).toBe(quote.totalWei)
    }
  })
})

describe('mintedTokenIds', () => {
  type ReceiptLog = TransactionReceipt['logs'][number]
  const transfer = (address: Address, from: Address, to: Address, tokenId: bigint) =>
    ({
      address,
      data: '0x',
      topics: encodeEventTopics({ abi: collectionAbi, eventName: 'Transfer', args: { from, to, tokenId } }),
    }) as unknown as ReceiptLog

  it("keeps the collection's mints to the receiver, sorted, and drops other contracts, receivers and transfers", () => {
    const logs = [
      transfer(CONTRACT, zeroAddress, ACCOUNT, 7n),
      transfer(OTHER, zeroAddress, ACCOUNT, 1n),
      transfer(CONTRACT, zeroAddress, VAULT, 8n),
      transfer(CONTRACT, ACCOUNT, VAULT, 7n),
      transfer(CONTRACT.toLowerCase() as Address, zeroAddress, ACCOUNT.toLowerCase() as Address, 5n),
      { address: CONTRACT, data: '0x1234', topics: ['0x' + '0'.repeat(64)] } as unknown as ReceiptLog,
    ]
    expect(mintedTokenIds({ logs }, CONTRACT, ACCOUNT)).toEqual([5, 7])
  })
})
