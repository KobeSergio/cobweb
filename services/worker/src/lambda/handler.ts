import { parseRenderMessage } from '@cobweb/shared/render-queue'
import type { RenderMessage } from '@cobweb/shared/render-queue'
import type { SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from 'aws-lambda'
import { consoleLog, errorSummary } from '../log.ts'
import type { Log } from '../log.ts'
import type { Deps } from '../steps.ts'

/**
 * An SQS handler around one of the worker's entry points. A body that is not a render message is
 * logged and acknowledged, never retried. A message whose run throws is reported as a partial batch
 * failure, so SQS redelivers that message alone.
 */
export function sqsHandler(
  getDeps: () => Promise<Deps>,
  run: (message: RenderMessage, deps: Deps) => Promise<void>,
  log: Log = consoleLog,
): (event: SQSEvent) => Promise<SQSBatchResponse> {
  return async (event) => {
    const batchItemFailures: SQSBatchItemFailure[] = []
    for (const record of event.Records) {
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
        batchItemFailures.push({ itemIdentifier: record.messageId })
      }
    }
    return { batchItemFailures }
  }
}
