// The `@cobweb/worker/queue` entry: the SQS adapter alone, for the web app's retry action. Nothing
// here imports sharp, the render library, Supabase or viem.
export { SQS_BATCH, sqsRenderQueue } from './adapters/sqs.ts'
