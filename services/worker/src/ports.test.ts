import { readFileSync } from 'node:fs'
import { RenderProblem } from '@cobweb/render'
import { describe, expect, it } from 'vitest'
import { errorSummary } from './log.ts'
import {
  isJobRefusal,
  isMissingObject,
  isRenderProblem,
  JobRefusal,
  MissingObject,
  refusalOf,
  SENTENCES,
} from './ports.ts'

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

  it('masks key-like runs and leaves ids, CIDs and sentences readable', () => {
    const hex = 'ab12cd34'.repeat(8)
    expect(errorSummary(new Error(`bad key ${hex} here`))).toBe('Error: bad key [key] here')
    const jwt = `${'a-b_c'.repeat(4)}.${'d-e_f'.repeat(4)}.${'g-h_i'.repeat(4)}`
    expect(errorSummary(new Error(`token ${jwt} rejected`))).toBe('Error: token [key] rejected')
    expect(errorSummary(new Error(`key sb_secret_${'x'.repeat(40)} rejected`))).toBe(
      'Error: key [key] rejected',
    )
    expect(errorSummary(new Error(`failed ?apikey=${'k'.repeat(40)}`))).toBe('Error: failed ?[key]')
    expect(errorSummary(new Error('see https://rpc.example/v1/abc'))).toBe('Error: see [url]')
    const readable = 'job 3f0c2f5e-8a51-4c0e-9d7b-0d0f5a3b9c11 timed out'
    expect(errorSummary(new Error(readable))).toBe(`Error: ${readable}`)
    const cid = `bafybei${'a'.repeat(52)}`
    expect(errorSummary(new Error(`pinned ${cid} twice`))).toBe(`Error: pinned ${cid} twice`)
    expect(errorSummary(new Error('short'))).toBe('Error: short')
  })

  it('keeps a uuid or a CID that ends a sentence readable', () => {
    const id = '3f0c2f5e-8a51-4c0e-9d7b-0d0f5a3b9c11'
    expect(errorSummary(new Error(`gave up on job ${id}.`))).toBe(`Error: gave up on job ${id}.`)
    const cid = `bafybei${'a'.repeat(52)}`
    expect(errorSummary(new Error(`pinned ${cid}...`))).toBe(`Error: pinned ${cid}...`)
    // A key with a trailing dot is still a key.
    expect(errorSummary(new Error(`bad key ${'ab12cd34'.repeat(8)}.`))).toBe('Error: bad key [key]')
  })
})

describe('MissingObject', () => {
  it('is recognised by name, and no other error is', () => {
    const error = new MissingObject('art/x.png')
    expect(error.name).toBe('MissingObject')
    expect(isMissingObject(error)).toBe(true)
    expect(isMissingObject(Object.assign(new Error('gone'), { name: 'MissingObject' }))).toBe(true)
    expect(isMissingObject(new Error('No such key'))).toBe(false)
    expect(isMissingObject('MissingObject')).toBe(false)
  })
})
