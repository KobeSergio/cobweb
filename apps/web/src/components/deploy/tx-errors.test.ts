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
