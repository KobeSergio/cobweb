import type { SQSEvent, SQSRecord } from 'aws-lambda'
import { describe, expect, it } from 'vitest'
import type { Deps } from '../steps.ts'
import { JOB_ID } from '../testing/fixtures.ts'
import { parseSecret } from './deps.ts'
import { sqsHandler } from './handler.ts'

const record = (messageId: string, body: unknown): SQSRecord =>
  ({ messageId, body: typeof body === 'string' ? body : JSON.stringify(body) }) as SQSRecord
const event = (...records: SQSRecord[]): SQSEvent => ({ Records: records })
const deps = {} as Deps
const start = { jobId: JOB_ID, step: 'start', retries: 0 }

describe('sqsHandler', () => {
  it('runs each message and reports no failure when all return', async () => {
    const ran: unknown[] = []
    const handler = sqsHandler(
      async () => deps,
      async (message) => void ran.push(message),
      () => {},
    )
    const batch = { jobId: JOB_ID, step: 'batch', index: 2, retries: 1 }
    expect(await handler(event(record('m1', start), record('m2', batch)))).toEqual({ batchItemFailures: [] })
    expect(ran).toEqual([start, batch])
  })

  it('reports only the message whose run threw', async () => {
    const lines: string[] = []
    const handler = sqsHandler(
      async () => deps,
      async (message) => {
        if (message.step === 'metadata') throw new Error('pin down at https://s3.example/key')
      },
      (name, fields) => lines.push(`${name} ${String(fields?.error ?? '')}`.trim()),
    )
    const response = await handler(
      event(record('m1', start), record('m2', { jobId: JOB_ID, step: 'metadata', retries: 0 })),
    )
    expect(response).toEqual({ batchItemFailures: [{ itemIdentifier: 'm2' }] })
    expect(lines).toEqual(['message failed Error: pin down at [url]'])
  })

  it('acknowledges and logs a body that is not a render message, without building the ports', async () => {
    const lines: string[] = []
    let built = 0
    const handler = sqsHandler(
      async () => {
        built += 1
        return deps
      },
      async () => {
        throw new Error('must not run')
      },
      (name) => lines.push(name),
    )
    const response = await handler(
      event(record('m1', 'not json'), record('m2', { jobId: 'x', step: 'start' })),
    )
    expect(response).toEqual({ batchItemFailures: [] })
    expect(lines).toEqual(['message ignored', 'message ignored'])
    expect(built).toBe(0)
  })

  it('reports every message when the ports cannot be built, so nothing is lost', async () => {
    const handler = sqsHandler(
      () => Promise.reject(new Error('RENDER_SECRET_ARN is not set.')),
      async () => {},
      () => {},
    )
    expect(await handler(event(record('m1', start), record('m2', start)))).toEqual({
      batchItemFailures: [{ itemIdentifier: 'm1' }, { itemIdentifier: 'm2' }],
    })
  })

  it('answers an empty event with no failures', async () => {
    const handler = sqsHandler(
      async () => deps,
      async () => {},
      () => {},
    )
    expect(await handler(event())).toEqual({ batchItemFailures: [] })
  })
})

describe('parseSecret', () => {
  it('reads a JSON object of text values', () => {
    expect(parseSecret('{"SUPABASE_SERVICE_ROLE_KEY":"k","RPC_URL_1":"https://rpc"}')).toEqual({
      SUPABASE_SERVICE_ROLE_KEY: 'k',
      RPC_URL_1: 'https://rpc',
    })
  })

  it('refuses anything else without echoing it', () => {
    for (const text of [undefined, '', 'generated-password', '[]', '{"A":1}', 'null']) {
      let message = ''
      try {
        parseSecret(text)
      } catch (error) {
        message = (error as Error).message
      }
      expect(message).toBe('The render secret is not a JSON object of text values.')
    }
  })
})

describe('sqsHandler logging', () => {
  it('logs an ignored body by message id alone, never the body', async () => {
    const calls: unknown[][] = []
    const handler = sqsHandler(
      async () => deps,
      async () => {},
      (...args) => void calls.push(args),
    )
    await handler(event(record('m1', 'secret-body https://rpc.example/key-1234567890')))
    expect(calls).toEqual([['message ignored', { messageId: 'm1' }]])
  })

  it('logs a failed run with ids, step and the masked summary only', async () => {
    const calls: unknown[][] = []
    const handler = sqsHandler(
      async () => deps,
      async () => {
        throw new Error('rpc https://rpc.example/key-1234567890 down')
      },
      (...args) => void calls.push(args),
    )
    await handler(event(record('m1', start)))
    expect(calls).toEqual([
      ['message failed', { messageId: 'm1', jobId: JOB_ID, step: 'start', error: 'Error: rpc [url] down' }],
    ])
  })

  it('keeps going after a failure, so later messages still run', async () => {
    const ran: string[] = []
    const handler = sqsHandler(
      async () => deps,
      async (message) => {
        ran.push(message.step)
        if (message.step === 'start') throw new Error('x')
      },
      () => {},
    )
    const response = await handler(
      event(record('m1', start), record('m2', { jobId: JOB_ID, step: 'metadata', retries: 0 })),
    )
    expect(ran).toEqual(['start', 'metadata'])
    expect(response.batchItemFailures).toEqual([{ itemIdentifier: 'm1' }])
  })
})
