import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ART_PROBLEM_CODES,
  collageKey,
  enqueueRender,
  parseRenderMessage,
  WORKER_FAILURE_CODES,
  type RenderMessage,
} from './render-queue.ts'

const JOB = '3f0c2f5e-8a51-4c0e-9d7b-0d0f5a3b9c11'
const body = (value: unknown) => JSON.stringify(value)

describe('parseRenderMessage', () => {
  it('reads each of the three shapes', () => {
    expect(parseRenderMessage(body({ jobId: JOB, step: 'start', retries: 0 }))).toEqual({
      jobId: JOB,
      step: 'start',
      retries: 0,
    })
    expect(parseRenderMessage(body({ jobId: JOB, step: 'batch', index: 7, retries: 2 }))).toEqual({
      jobId: JOB,
      step: 'batch',
      index: 7,
      retries: 2,
    })
    expect(parseRenderMessage(body({ jobId: JOB, step: 'metadata', retries: 5 }))).toEqual({
      jobId: JOB,
      step: 'metadata',
      retries: 5,
    })
  })

  it('round-trips what the worker sends', () => {
    const messages: RenderMessage[] = [
      { jobId: JOB, step: 'start', retries: 1 },
      { jobId: JOB, step: 'batch', index: 0, retries: 1 },
      { jobId: JOB, step: 'metadata', retries: 1 },
    ]
    for (const message of messages) expect(parseRenderMessage(JSON.stringify(message))).toEqual(message)
  })

  it.each([
    ['not JSON', '{'],
    ['an empty body', ''],
    ['null', 'null'],
    ['an array', body([{ jobId: JOB, step: 'start', retries: 0 }])],
    ['a string', body('start')],
    ['no job id', body({ step: 'start', retries: 0 })],
    ['a job id that is not a uuid', body({ jobId: 'job-1', step: 'start', retries: 0 })],
    ['an upper-case job id', body({ jobId: JOB.toUpperCase(), step: 'start', retries: 0 })],
    ['an unknown step', body({ jobId: JOB, step: 'collage', retries: 0 })],
    ['no retries', body({ jobId: JOB, step: 'start' })],
    ['negative retries', body({ jobId: JOB, step: 'start', retries: -1 })],
    ['fractional retries', body({ jobId: JOB, step: 'start', retries: 1.5 })],
    ['retries as text', body({ jobId: JOB, step: 'start', retries: '1' })],
    ['retries beyond the safe integers', body({ jobId: JOB, step: 'start', retries: 9007199254740992 })],
    ['a batch without an index', body({ jobId: JOB, step: 'batch', retries: 0 })],
    ['a batch with a negative index', body({ jobId: JOB, step: 'batch', index: -1, retries: 0 })],
    ['a batch with a fractional index', body({ jobId: JOB, step: 'batch', index: 0.5, retries: 0 })],
    [
      'a batch with an index beyond the safe integers',
      body({ jobId: JOB, step: 'batch', index: 9007199254740992, retries: 0 }),
    ],
    ['a metadata message with an index', body({ jobId: JOB, step: 'metadata', index: 0, retries: 0 })],
    ['a __proto__ key', `{"jobId":"${JOB}","step":"start","retries":0,"__proto__":{"x":1}}`],
    ['a start with an index', body({ jobId: JOB, step: 'start', index: 0, retries: 0 })],
    ['an extra key', body({ jobId: JOB, step: 'metadata', retries: 0, range: [1, 100] })],
    ['an extra key on a batch', body({ jobId: JOB, step: 'batch', index: 0, retries: 0, final: true })],
  ])('returns null for %s', (_name, text) => {
    expect(parseRenderMessage(text)).toBeNull()
  })
})

describe('enqueueRender', () => {
  it('sends one start message with the job retries', async () => {
    const sent: RenderMessage[][] = []
    await enqueueRender({ send: async (messages) => void sent.push(messages) }, { id: JOB, retries: 3 })
    expect(sent).toEqual([[{ jobId: JOB, step: 'start', retries: 3 }]])
  })

  it('passes a queue failure on to the caller', async () => {
    const queue = { send: () => Promise.reject(new Error('queue down')) }
    await expect(enqueueRender(queue, { id: JOB, retries: 0 })).rejects.toThrow('queue down')
  })
})

describe('the failure codes', () => {
  it('lists the four codes only the worker writes', () => {
    expect([...WORKER_FAILURE_CODES]).toEqual([
      'payment-mismatch',
      'cid-mismatch',
      'dead-letter',
      'batch-too-large',
    ])
  })

  it('fits every code in the 40 character column', () => {
    for (const code of [...WORKER_FAILURE_CODES, ...ART_PROBLEM_CODES])
      expect(code.length).toBeLessThanOrEqual(40)
  })

  it('lists the render problems a retry cannot fix, and the worker batch-too-large, none twice', () => {
    expect([...ART_PROBLEM_CODES].sort()).toEqual([
      'bad-dna',
      'batch-range',
      'batch-too-large',
      'decode',
      'duplicate-name',
      'layer-size',
      'missing-batch',
      'missing-image',
      'reserved-key',
    ])
    expect(new Set(ART_PROBLEM_CODES).size).toBe(ART_PROBLEM_CODES.length)
  })
})

describe('collageKey', () => {
  it('is <collection id>/collage/<job id>.png', () => {
    expect(collageKey('9a1b2c3d-0000-4000-8000-000000000001', JOB)).toBe(
      `9a1b2c3d-0000-4000-8000-000000000001/collage/${JOB}.png`,
    )
  })
})

describe('the module', () => {
  it('imports nothing, so the web app can use it without the worker or sharp', () => {
    const source = readFileSync(new URL('./render-queue.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/^\s*import\s/m)
    expect(source).not.toMatch(/\brequire\(/)
    expect(source).not.toMatch(/^\s*export\s+(type\s+)?(\*|\{[^}]*\})(\s+as\s+\w+)?\s*from\s/m)
    expect(source).not.toMatch(/\bimport\(/)
  })
})
