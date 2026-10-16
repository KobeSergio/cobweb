import { collectionAbi } from '@cobweb/shared/collection-abi'
import {
  ChainMismatchError,
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  encodeErrorResult,
  HttpRequestError,
  UserRejectedRequestError,
  WaitForTransactionReceiptTimeoutError,
  type Address,
  type Hex,
} from 'viem'
import { anvil } from 'viem/chains'
import { describe, expect, it } from 'vitest'
import {
  failureActions,
  failureCopy,
  MintFailure,
  mintFailureOf,
  revertNameOf,
  type MintFailureKind,
} from './mint-failure'

const CONTRACT: Address = '0x0409454C375c8a6aB05383bFB6D9FcDe9ebB8F85'
const ACCOUNT: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const HASH: Hex = `0x${'ab'.repeat(32)}`

/** A failed simulation as viem throws it: the custom error decoded inside the execution error. */
function reverted(errorName: string, args: readonly unknown[]): ContractFunctionExecutionError {
  const data = encodeErrorResult({ abi: collectionAbi, errorName, args } as Parameters<
    typeof encodeErrorResult
  >[0])
  const revert = new ContractFunctionRevertedError({ abi: collectionAbi, data, functionName: 'batchMint' })
  return new ContractFunctionExecutionError(revert, {
    abi: collectionAbi,
    functionName: 'batchMint',
    args: [1n, 0n],
    contractAddress: CONTRACT,
  })
}
const sentence = (error: unknown, at: 'checking' | 'wallet' | 'confirming' = 'checking') => {
  const failure = mintFailureOf(error, at)
  return { kind: failure.kind, ...failureCopy(failure, 'Base') }
}

describe('mintFailureOf (docs/specs/2026-10-16-mint-page-live-data.md, section 7.6)', () => {
  it('reads each revert of the check as its kind, with the counts in the sentences', () => {
    const cases: [string, readonly unknown[], MintFailureKind, string][] = [
      ['MintGroupInactive', [0n], 'phase-closed', 'The check found the phase closed, so nothing was sent.'],
      ['ExceedsMintGroupMaxSupply', [3n, 2n], 'sold-out', 'Only 2 are left, so nothing was sent.'],
      ['ExceedsMaxSupply', [3n, 1n], 'sold-out', 'Only 1 is left, so nothing was sent.'],
      ['ExceedsMaxSupply', [3n, 0n], 'sold-out', 'Every token of this phase is minted. Nothing was sent.'],
      ['ExceedsPublicMaxPerWallet', [2n, 1n], 'quota-exceeded', 'This wallet can mint 1 more in this phase'],
      ['ExceedsMintQuota', [3n, 2n], 'quota-exceeded', 'This wallet can mint 2 more in this phase'],
      [
        'NotInWhitelist',
        [ACCOUNT, 1n],
        'not-listed',
        'The contract does not list this wallet for this phase.',
      ],
      [
        'NotDelegate',
        [ACCOUNT, CONTRACT],
        'not-delegate',
        'delegate.xyz shows no delegation from this vault',
      ],
      ['InsufficientEther', [10n, 9n], 'price-changed', 'The total changed after this page read it'],
      [
        'TransferToNonERC721ReceiverImplementer',
        [],
        'contract-wallet',
        'It is a contract that cannot receive',
      ],
    ]
    for (const [name, args, kind, words] of cases) {
      const read = sentence(reverted(name, args))
      expect(read.kind, name).toBe(kind)
      expect(read.sentence, name).toContain(words)
      expect(read.sentence, name).toMatch(/nothing was sent/i)
    }
    expect(mintFailureOf(reverted('ExceedsMaxSupply', [3n, 1n]), 'checking').detail.left).toBe(1)
    expect(mintFailureOf(reverted('ExceedsMintQuota', [3n, 2n]), 'checking').detail.allowed).toBe(2)
  })

  it('reads a rejection by its error or code 4001, at the check, in the wallet or at the switch', () => {
    expect(
      sentence(new UserRejectedRequestError(new Error('User rejected the request.')), 'wallet'),
    ).toMatchObject({
      kind: 'rejected',
      title: 'You cancelled in your wallet',
      sentence: 'Nothing was sent and nothing was charged. You can try again whenever you are ready.',
    })
    const coded = Object.assign(new Error('denied'), { code: 4001 })
    expect(mintFailureOf(new Error('wrapped', { cause: coded }), 'checking').kind).toBe('rejected')
  })

  it('reads "insufficient funds" anywhere as the balance, and a changed network as wrong-network', () => {
    const funds = new Error('outer', { cause: new Error('insufficient funds for gas * price + value') })
    expect(sentence(funds).kind).toBe('insufficient-balance')
    expect(sentence(funds, 'wallet').sentence).toBe(
      'The wallet cannot cover the total plus gas. Nothing was sent.',
    )
    const mismatch = new ChainMismatchError({ chain: anvil, currentChainId: 1 })
    expect(sentence(mismatch, 'wallet')).toMatchObject({
      kind: 'wrong-network',
      sentence: 'Switch back to Base, then try again. Nothing was sent.',
    })
  })

  it("reads a transport error at the check as check-failed, and the wallet's own error in its words", () => {
    const transport = new HttpRequestError({ url: 'https://rpc.example', body: {} })
    expect(sentence(transport)).toMatchObject({
      kind: 'check-failed',
      sentence:
        'The mint could not be checked against the contract. Nothing was sent. Try again in a moment.',
    })
    const wallet = sentence(
      Object.assign(new Error('raw'), { shortMessage: 'The wallet is locked.' }),
      'wallet',
    )
    expect(wallet).toMatchObject({
      kind: 'wallet-failed',
      title: 'Your wallet did not send it',
      sentence: 'The wallet is locked. Nothing was charged.',
    })
  })

  it('reads a receipt that did not come as unconfirmed, keeping the hash', () => {
    const failure = mintFailureOf(
      new WaitForTransactionReceiptTimeoutError({ hash: HASH }),
      'confirming',
      HASH,
    )
    expect([failure.kind, failure.detail.hash]).toEqual(['unconfirmed', HASH])
    expect(failureCopy(failure, 'Base').sentence).toContain('It may still land')
    expect(failureCopy(new MintFailure('reverted'), 'Base').sentence).toBe(
      'The network rejected it, usually because the phase closed or sold out while it waited. No tokens were minted; only gas was spent.',
    )
  })

  it('reads any failure after the send as unconfirmed, never as "Nothing was sent" (fix round 1, item 3)', () => {
    const afterSend: unknown[] = [
      new UserRejectedRequestError(new Error('User rejected the request.')),
      Object.assign(new Error('denied'), { code: 4001 }),
      new Error('outer', { cause: new Error('insufficient funds for gas * price + value') }),
      new ChainMismatchError({ chain: anvil, currentChainId: 1 }),
      reverted('MintGroupInactive', [0n]),
    ]
    for (const error of afterSend) {
      const failure = mintFailureOf(error, 'confirming', HASH)
      expect([failure.kind, failure.detail.hash]).toEqual(['unconfirmed', HASH])
      expect(failureCopy(failure, 'Base').sentence).not.toMatch(/nothing was sent/i)
    }
  })

  it('names the revert a simulation decoded, for the retry on MintGroupInactive', () => {
    expect(revertNameOf(reverted('MintGroupInactive', [0n]))).toBe('MintGroupInactive')
    expect(revertNameOf(new Error('no revert'))).toBeNull()
  })
})

describe('failureActions', () => {
  it("offers each kind's ways forward, Mint N with the count the revert named", () => {
    expect(failureActions(new MintFailure('sold-out', { left: 2 }))).toEqual([
      { kind: 'mint-count', count: 2 },
      { kind: 'close' },
    ])
    expect(failureActions(new MintFailure('sold-out', { left: 0 }))).toEqual([{ kind: 'close' }])
    expect(failureActions(new MintFailure('quota-exceeded', { allowed: 1 }))).toEqual([
      { kind: 'mint-fewer', count: 1 },
      { kind: 'retry' },
    ])
    expect(failureActions(new MintFailure('phase-closed'))).toEqual([{ kind: 'see-phases' }])
    expect(failureActions(new MintFailure('not-delegate'))).toEqual([
      { kind: 'use-wallet' },
      { kind: 'close' },
    ])
    expect(failureActions(new MintFailure('unconfirmed'))).toEqual([
      { kind: 'view-transaction' },
      { kind: 'close' },
    ])
    expect(failureActions(new MintFailure('price-changed'))).toEqual([{ kind: 'retry' }])
  })
})
