import { readFileSync } from 'node:fs'
import { RenderProblem } from '@cobweb/render'
import { describe, expect, it } from 'vitest'
import { errorSummary } from './log.ts'
import { isJobRefusal, isRenderProblem, JobRefusal, refusalOf, SENTENCES } from './ports.ts'

describe('SENTENCES', () => {
  it('are raised, character for character, by the job state migration', () => {
    const sql = readFileSync(
      new URL('../../../supabase/migrations/20261012010000_render_job_state.sql', import.meta.url),
      'utf8',
    )
    for (const sentence of Object.values(SENTENCES))
      expect(sql, sentence).toContain(`raise exception '${sentence}'`)
  })
})

describe('refusalOf', () => {
  it('maps a check violation with a known sentence to its refusal', () => {
    const refusal = refusalOf({ code: '23514', message: 'This job is not rendering.' })
    expect(refusal).toBeInstanceOf(JobRefusal)
    expect(refusal?.code).toBe('JOB_NOT_RENDERING')
    expect(refusal?.message).toBe('This job is not rendering.')
    expect(refusal?.name).toBe('JobRefusal')
  })

  it('maps every sentence', () => {
    for (const [code, message] of Object.entries(SENTENCES))
      expect(refusalOf({ code: '23514', message })?.code).toBe(code)
  })

  it('is null for another errcode, an unknown sentence and no error', () => {
    expect(refusalOf({ code: '42501', message: 'This job is not rendering.' })).toBeNull()
    expect(refusalOf({ code: '23514', message: 'new row violates check constraint' })).toBeNull()
    expect(refusalOf({ message: 'This job is not rendering.' })).toBeNull()
    expect(refusalOf(null)).toBeNull()
  })
})

describe('the name checks', () => {
  it('tell a refusal and a render problem from any other error', () => {
    expect(isJobRefusal(new JobRefusal('NO_SUCH_BATCH'))).toBe(true)
    expect(isJobRefusal(new Error('This job is not rendering.'))).toBe(false)
    expect(isRenderProblem(new RenderProblem('layer-size', 'Too small.'))).toBe(true)
    expect(isRenderProblem(new Error('layer-size'))).toBe(false)
    expect(isRenderProblem('layer-size')).toBe(false)
  })
})

describe('errorSummary', () => {
  it('keeps the name and one short line, and never a URL', () => {
    const error = new Error('HTTP request failed.\nURL: https://rpc.example/v2/secret-key\nDetails: none')
    expect(errorSummary(error)).toBe('Error: HTTP request failed.')
    const inline = new TypeError('fetch failed for https://rpc.example/v2/secret-key today')
    expect(errorSummary(inline)).toBe('TypeError: fetch failed for [url] today')
  })

  it('prefers the short message viem errors carry', () => {
    const error = Object.assign(new Error('long text with https://rpc.example/key'), {
      shortMessage: 'The contract function "jobPayment" reverted.',
    })
    expect(errorSummary(error)).toBe('Error: The contract function "jobPayment" reverted.')
  })

  it('cuts a long message and names a thrown value that is not an error', () => {
    expect(errorSummary(new Error('word '.repeat(100))).length).toBe('Error: '.length + 200)
    expect(errorSummary('boom')).toBe('Unknown error')
  })

  it('masks key-like runs and leaves ids and sentences readable', () => {
    const hex = 'ab12cd34'.repeat(8)
    expect(errorSummary(new Error(`bad key ${hex} here`))).toBe('Error: bad key [url] here')
    const jwt = `${'a'.repeat(20)}.${'b'.repeat(20)}.${'c'.repeat(20)}`
    expect(errorSummary(new Error(`token ${jwt} rejected`))).toBe('Error: token [url] rejected')
    expect(errorSummary(new Error(`failed ?apikey=${'k'.repeat(40)}`))).toBe('Error: failed ?[url]')
    const readable = 'job 3f0c2f5e-8a51-4c0e-9d7b-0d0f5a3b9c11 timed out'
    expect(errorSummary(new Error(readable))).toBe(`Error: ${readable}`)
    expect(errorSummary(new Error('short'))).toBe('Error: short')
  })
})
