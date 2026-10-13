import { GetQueueAttributesCommand, SendMessageBatchCommand } from '@aws-sdk/client-sqs'
import type { SQSClient } from '@aws-sdk/client-sqs'
import { parseRenderMessage } from '@cobweb/shared/render-queue'
import type { RenderMessage } from '@cobweb/shared/render-queue'
import { describe, expect, it } from 'vitest'
import { JOB_ID } from '../testing/fixtures.ts'
import { stubAws } from '../testing/stub-aws.ts'
import { sqsRenderQueue } from './sqs.ts'

describe('sqsRenderQueue', () => {
  type Sqs = Pick<SQSClient, 'send'>
  const messages = (count: number): RenderMessage[] =>
    Array.from({ length: count }, (_, index) => ({
      jobId: JOB_ID,
      step: 'batch' as const,
      index,
      retries: 1,
    }))

  it('sends at most ten entries a call, each a message the parser reads back', async () => {
    const { client, sent } = stubAws<Sqs>()
    await sqsRenderQueue(client, 'https://sqs.example/queue').send(messages(23))
    expect(sent.map((call) => call.name)).toEqual(Array(3).fill(SendMessageBatchCommand.name))
    const entries = sent.map((call) => call.input.Entries as { Id: string; MessageBody: string }[])
    expect(entries.map((batch) => batch.length)).toEqual([10, 10, 3])
    expect(sent[0]?.input.QueueUrl).toBe('https://sqs.example/queue')
    expect(new Set(entries[0]!.map((entry) => entry.Id)).size).toBe(10)
    expect(entries.flat().map((entry) => parseRenderMessage(entry.MessageBody))).toEqual(messages(23))
  })

  it('sends nothing for an empty list', async () => {
    const { client, sent } = stubAws<Sqs>()
    await sqsRenderQueue(client, 'q').send([])
    expect(sent).toEqual([])
  })

  it('throws when SQS refuses some entries', async () => {
    const { client } = stubAws<Sqs>(() => ({ Failed: [{ Id: '0' }, { Id: '4' }] }))
    await expect(sqsRenderQueue(client, 'q').send(messages(5))).rejects.toThrow(
      'The queue refused 2 message(s).',
    )
  })

  it('stops at the first call that reports a failure', async () => {
    let calls = 0
    const { client, sent } = stubAws<Sqs>(() => {
      calls += 1
      return calls === 2 ? { Failed: [{ Id: '3' }] } : {}
    })
    await expect(sqsRenderQueue(client, 'q').send(messages(23))).rejects.toThrow(
      'The queue refused 1 message(s).',
    )
    expect(sent).toHaveLength(2)
  })

  it('reads the backlog as the approximate number of visible messages', async () => {
    const { client, sent } = stubAws<Sqs>(() => ({ Attributes: { ApproximateNumberOfMessages: '7' } }))
    expect(await sqsRenderQueue(client, 'https://sqs.example/queue').backlog?.()).toBe(7)
    expect(sent).toEqual([
      {
        name: GetQueueAttributesCommand.name,
        input: { QueueUrl: 'https://sqs.example/queue', AttributeNames: ['ApproximateNumberOfMessages'] },
      },
    ])
  })

  it('throws when the queue does not report a number, rather than guess an empty queue', async () => {
    for (const answer of [{}, { Attributes: {} }, { Attributes: { ApproximateNumberOfMessages: 'many' } }]) {
      const { client } = stubAws<Sqs>(() => answer)
      await expect(sqsRenderQueue(client, 'q').backlog?.()).rejects.toThrow('The queue did not report')
    }
  })
})
