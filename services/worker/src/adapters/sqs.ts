/** The `RenderQueue` port on SQS. Imports only the SQS client, so the web app can use it for retries. */
import { GetQueueAttributesCommand, SendMessageBatchCommand } from '@aws-sdk/client-sqs'
import type { SQSClient } from '@aws-sdk/client-sqs'
import type { RenderMessage, RenderQueue } from '@cobweb/shared/render-queue'

/** The most entries SQS takes in one SendMessageBatch call. */
export const SQS_BATCH = 10

export function sqsRenderQueue(client: Pick<SQSClient, 'send'>, queueUrl: string): RenderQueue {
  return {
    async send(messages: RenderMessage[]) {
      for (let at = 0; at < messages.length; at += SQS_BATCH) {
        const entries = messages.slice(at, at + SQS_BATCH)
        const result = await client.send(
          new SendMessageBatchCommand({
            QueueUrl: queueUrl,
            Entries: entries.map((message, index) => ({
              Id: String(index),
              MessageBody: JSON.stringify(message),
            })),
          }),
        )
        // A partial failure is a failure: the caller throws and the whole step is redelivered.
        if (result.Failed?.length) throw new Error(`The queue refused ${result.Failed.length} message(s).`)
      }
    },
    /** Messages waiting to be received, as SQS approximates them. The sweep skips while there are any. */
    async backlog() {
      const found = await client.send(
        new GetQueueAttributesCommand({
          QueueUrl: queueUrl,
          AttributeNames: ['ApproximateNumberOfMessages'],
        }),
      )
      const count = Number(found.Attributes?.ApproximateNumberOfMessages)
      if (!Number.isInteger(count) || count < 0) throw new Error('The queue did not report its backlog.')
      return count
    },
  }
}
