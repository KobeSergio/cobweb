import { collectionAbi } from '@cobweb/shared/collection-abi'
import {
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  encodeErrorResult,
  type Address,
} from 'viem'
import { describe, expect, it } from 'vitest'
import { classifyError } from './tx-errors'

describe('classifyError', () => {
  it('answers a failure for a rejection that is not an error, instead of throwing inside a catch', () => {
    const failure = classifyError(undefined, 'wallet', 'deploy')
    expect(failure).toMatchObject({ kind: 'rejected', title: 'The wallet did not send the deploy' })
    expect(failure.message).toBe('Unknown error. No gas was spent.')
    expect(classifyError(null, 'switching', 'deploy')).toMatchObject({
      kind: 'switch',
      title: 'The network switch failed',
    })
    expect(classifyError(null, 'confirming', 'deploy').message).toBe(
      "Unknown error. Check your wallet's activity before you deploy again.",
    )
  })

  it('reads a message from a plain object as well as from an Error', () => {
    expect(classifyError({ message: 'Timed out.' }, 'confirming', 'deploy').message).toBe(
      "Timed out. Check your wallet's activity before you deploy again.",
    )
    expect(classifyError(new Error('Timed out.'), 'wallet', 'payment').message).toBe(
      'Timed out. Nothing was charged.',
    )
  })
})

const CONTRACT: Address = '0x0409454C375c8a6aB05383bFB6D9FcDe9ebB8F85'
const STRANGER: Address = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'

/** A simulation revert as wagmi throws it: the decoded custom error inside the call's execution error. */
function simulationRevert(errorName: string, args: readonly unknown[]): ContractFunctionExecutionError {
  const data = encodeErrorResult({ abi: collectionAbi, errorName, args } as never)
  const reverted = new ContractFunctionRevertedError({
    abi: collectionAbi,
    data,
    functionName: 'setMintGroupMaxSupply',
  })
  return new ContractFunctionExecutionError(reverted, {
    abi: collectionAbi,
    functionName: 'setMintGroupMaxSupply',
    args: [0n, 0n],
    contractAddress: CONTRACT,
  })
}

describe('classifyError for a change in Manage drop (docs/specs/2026-10-15-phases.md, section 7.2)', () => {
  it.each<[string, readonly unknown[], string]>([
    ['BelowMinted', [1n], 'It cannot go below 1, the tokens this phase has already minted.'],
    ['BelowMinted', [1234n], 'It cannot go below 1,234, the tokens this phase has already minted.'],
    [
      'AllocationsExceedMaxSupply',
      [],
      "The phases' allocations together would be more than the collection's supply. Lower another phase first.",
    ],
    [
      'MintGroupAlreadyExists',
      [2n],
      'Phase 2 is already on the contract. Read the contract again, then add the phase.',
    ],
    ['MintGroupDoesNotExist', [9n], 'Phase 9 is not on the contract. Read the contract again.'],
    ['AddressZero', [], 'The address cannot be the zero address.'],
    [
      'Unauthorized',
      [STRANGER],
      `Only the contract's owner can make this change, and ${STRANGER} is not the owner.`,
    ],
    [
      'OwnableUnauthorizedAccount',
      [STRANGER],
      `Only the contract's owner can make this change, and ${STRANGER} is not the owner.`,
    ],
    ['ArrayLengthMismatch', [], 'The addresses and quotas do not line up. Reload and try again.'],
    ['PublicGroupHasNoQuota', [], 'The public sale has no whitelist.'],
    ['NotInWhitelist', [STRANGER, 2n], `${STRANGER} is not on the whitelist of phase 2.`],
    ['ExceedsMintQuota', [1_500n, 1_200n], 'This wallet can mint 1,200 more in this phase, not 1,500.'],
  ])('words %s (%s) from the decoded revert, ending "Nothing was sent."', (errorName, args, sentence) => {
    expect(classifyError(simulationRevert(errorName, args), 'simulating', 'manage')).toEqual({
      kind: 'reverted',
      title: 'The change would fail',
      message: `${sentence} Nothing was sent.`,
    })
  })

  it('falls back to the short message for any other revert, and keeps the factory wording for payment and deploy', () => {
    expect(
      classifyError(simulationRevert('ExceedsMaxSupply', [5n, 1n]), 'simulating', 'manage').message,
    ).toBe(
      'The check against the contract failed: The contract function "setMintGroupMaxSupply" reverted. Nothing was sent.',
    )
    expect(classifyError(new Error('fetch failed'), 'simulating', 'manage').message).toBe(
      'The check against the contract failed: fetch failed Nothing was sent.',
    )
    expect(classifyError(simulationRevert('BelowMinted', [1n]), 'simulating', 'deploy').message).toMatch(
      /^The check against the factory failed: /,
    )
  })

  it('words the wallet steps for a change', () => {
    const rejection = Object.assign(new Error('User rejected the request.'), { code: 4001 })
    expect(classifyError(rejection, 'wallet', 'manage')).toEqual({
      kind: 'rejected',
      title: 'Cancelled in your wallet',
      message: 'Nothing was sent and no gas was spent. Try again when you are ready.',
    })
    expect(classifyError(rejection, 'switching', 'manage')).toEqual({
      kind: 'switch',
      title: 'Network switch cancelled',
      message:
        'Your wallet stayed on its current network, so nothing was sent. Try again and approve the switch.',
    })
    expect(
      classifyError(new Error('insufficient funds for gas * price + value'), 'simulating', 'manage'),
    ).toMatchObject({ kind: 'balance', title: 'Not enough funds for gas' })
    expect(classifyError(new Error('Timed out.'), 'wallet', 'manage')).toEqual({
      kind: 'rejected',
      title: 'The wallet did not send the change',
      message: 'Timed out. No gas was spent.',
    })
    expect(classifyError(new Error('Timed out.'), 'confirming', 'manage')).toEqual({
      kind: 'reverted',
      title: 'The change could not be confirmed',
      message: "Timed out. Check your wallet's activity before you send it again.",
    })
  })
})
