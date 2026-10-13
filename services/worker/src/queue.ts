// The `@cobweb/worker/queue` entry: the Vercel Queues adapter alone, for the web app's queue module and
// the retry action. Nothing here imports sharp, the render library, Supabase, viem or the queue SDK.
export { vercelRenderQueue } from './adapters/vercel-queue.ts'
export type { QueueSender } from './adapters/vercel-queue.ts'
