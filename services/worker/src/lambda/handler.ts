import { ChangeMessageVisibilityCommand, SQSClient } from '@aws-sdk/client-sqs'
import { parseRenderMessage } from '@cobweb/shared/render-queue'
import type { RenderMessage } from '@cobweb/shared/render-queue'
import type { SQSBatchItemFailure, SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda'
import { consoleLog, errorSummary } from '../log.ts'
import type { Log } from '../log.ts'
import type { Deps } from '../steps.ts'

/**
 * How long a message whose run threw for the first time stays invisible. The queue's own timeout is
 * six times the function's (an hour for the render queue), which would make every transient fault
 * wait that long. Only the first failure is shortened: a second failure means the fault outlasted a
 * quick retry (an outage, a bad secret), and three quick tries would dead-letter every message in
 * flight and spend a creator's retries, so later receives keep the queue's own long wait.
 */
export const FAILED_MESSAGE_VISIBILITY_SECONDS = 120

export type SqsLike = Pick<SQSClient, 'send'>

/** Where to shorten a failed message's wait: the queue the stack names in the environment. */
export type VisibilityOptions = { queueUrlEnv: string; client?: SqsLike }

let sharedClient: SqsLike | null = null

/**
 * Sets a record's visibility to 120 seconds after its first failed run. A failure of this call is logged (name and
 * masked line) and ignored: the record is reported as failed either way and returns after the
 * queue's own timeout.
 */
async function shortenWait(
  record: SQSRecord,
  options: VisibilityOptions | undefined,
  log: Log,
): Promise<void> {
  if (!options) return
  // A record without the attribute (a test event) counts as a first receive.
  const receives = Number(record.attributes?.ApproximateReceiveCount ?? '1')
  if (!(receives <= 1)) return
  try {
    const queueUrl = process.env[options.queueUrlEnv]
    if (!queueUrl) {
      log('visibility not changed', { messageId: record.messageId, env: options.queueUrlEnv })
      return
    }
    sharedClient ??= new SQSClient({})
    await (options.client ?? sharedClient).send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: record.receiptHandle,
        VisibilityTimeout: FAILED_MESSAGE_VISIBILITY_SECONDS,
      }),
    )
  } catch (error) {
    try {
      log('visibility not changed', { messageId: record.messageId, error: errorSummary(error) })
    } catch {
      // Nothing more can be said safely.
    }
  }
}

/**
 * An SQS handler around one of the worker's entry points. A body that is not a render message is
 * logged and acknowledged, never retried. A message whose run throws is reported as a partial batch
 * failure, so SQS redelivers that message alone, after 120 seconds when the stack names its queue. Anything unexpected outside a message's run marks
 * every record of the event as failed.
 */
export function sqsHandler(
  getDeps: () => Promise<Deps>,
  run: (message: RenderMessage, deps: Deps) => Promise<void>,
  log: Log = consoleLog,
  visibility?: VisibilityOptions,
): (event: SQSEvent) => Promise<SQSBatchResponse> {
  return async (event) => {
    const records = Array.isArray(event?.Records) ? event.Records : []
    try {
      const batchItemFailures: SQSBatchItemFailure[] = []
      for (const record of records) {
        const message = parseRenderMessage(record.body)
        if (!message) {
          log('message ignored', { messageId: record.messageId })
          continue
        }
        try {
          await run(message, await getDeps())
        } catch (error) {
          log('message failed', {
            messageId: record.messageId,
            jobId: message.jobId,
            step: message.step,
            error: errorSummary(error),
          })
          await shortenWait(record, visibility, log)
          batchItemFailures.push({ itemIdentifier: record.messageId })
        }
      }
      return { batchItemFailures }
    } catch (error) {
      // Anything unexpected outside the step: every record goes back to the queue. The logger may be
      // what threw, so it is guarded; the error object itself is never logged.
      try {
        log('handler failed', { error: errorSummary(error) })
      } catch {
        // Nothing more can be said safely.
      }
      return { batchItemFailures: records.map((record) => ({ itemIdentifier: record.messageId })) }
    }
  }
}
