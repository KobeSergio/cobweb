import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderQueue } from './queue'

const sdk = vi.hoisted(() => ({
  send: vi.fn<(topic: string, body: unknown, options: unknown) => Promise<{ messageId: string }>>(
    async () => ({ messageId: 'm-1' }),
  ),
}))
vi.mock('@vercel/queue', () => ({ send: sdk.send }))

const JOB = '3f0c2f5e-8a51-4c0e-9d7b-0d0f5a3b9c11'
const start = { jobId: JOB, step: 'start', retries: 0 } as const

describe('renderQueue', () => {
  beforeEach(() => sdk.send.mockClear())

  it('on Vercel, sends through the SDK to the render topic with the key and seven days of retention', async () => {
    await renderQueue({ VERCEL: '1' }, () => {}).send([start])
    expect(sdk.send).toHaveBeenCalledTimes(1)
    expect(sdk.send).toHaveBeenCalledWith('render', start, {
      idempotencyKey: `${JOB}:start:0`,
      retentionSeconds: 604_800,
    })
  })

  it('anywhere else, logs that the render was not queued and sends nothing', async () => {
    const lines: string[] = []
    await renderQueue({}, (line) => lines.push(line)).send([start])
    expect(lines).toEqual([`render not queued (no queue here): job ${JOB}`])
    expect(sdk.send).not.toHaveBeenCalled()
  })

  it('treats an empty VERCEL as not on Vercel', async () => {
    const lines: string[] = []
    await renderQueue({ VERCEL: '' }, (line) => lines.push(line)).send([start])
    expect(lines).toHaveLength(1)
    expect(sdk.send).not.toHaveBeenCalled()
  })
})
