/** The step tests' wiring: fakes of every port around one fixture job. Not exported from the package. */
import type { RenderMessage } from '@cobweb/shared/render-queue'
import { memoryQueue } from '../doubles/memory-queue.ts'
import type { MemoryQueue } from '../doubles/memory-queue.ts'
import { memoryStore } from '../doubles/memory-store.ts'
import type { MemoryStore } from '../doubles/memory-store.ts'
import { carRoot } from '../doubles/pinners.ts'
import type { Chain, JobRecord, Pinner } from '../ports.ts'
import type { Deps } from '../steps.ts'
import { fakeJobs } from './fake-jobs.ts'
import type { FakeJobs } from './fake-jobs.ts'
import {
  assetData,
  assetImages,
  assetRows,
  generativeData,
  generativeImages,
  generativeRows,
  GIF_BYTES,
  JOB_ID,
  PLACEHOLDER_KEY,
  placeholderData,
} from './fixtures.ts'

export type Harness = {
  deps: Deps & { queue: MemoryQueue }
  jobs: FakeJobs
  store: MemoryStore
  queue: MemoryQueue
  /** CIDs pinned, in order. */
  pins: string[]
  /** Log lines as `event` or `event:refusal`. */
  lines: string[]
  /** Calls to the chain. */
  paymentReads: JobRecord[]
}

export const startMessage = (retries = 0): RenderMessage => ({ jobId: JOB_ID, step: 'start', retries })
export const batchMessage = (index: number, retries = 0): RenderMessage => ({
  jobId: JOB_ID,
  step: 'batch',
  index,
  retries,
})
export const metadataMessage = (retries = 0): RenderMessage => ({ jobId: JOB_ID, step: 'metadata', retries })

export async function harness(
  project: 'generative' | 'assets' | 'placeholder' = 'generative',
  options: { job?: Partial<JobRecord>; claimed?: boolean; paid?: bigint } = {},
): Promise<Harness> {
  const data =
    project === 'generative'
      ? generativeData(options.job)
      : project === 'assets'
        ? assetData(options.job)
        : placeholderData(options.job)
  const images =
    project === 'generative'
      ? await generativeImages()
      : project === 'assets'
        ? await assetImages()
        : { [PLACEHOLDER_KEY]: GIF_BYTES }
  const jobs = fakeJobs(data, project === 'generative' ? generativeRows : assetRows, {
    claimed: options.claimed,
  })
  const store = memoryStore(images)
  const queue = memoryQueue()
  const pins: string[] = []
  const lines: string[] = []
  const paymentReads: JobRecord[] = []
  const pinner: Pinner = {
    async pin(car) {
      const cid = await carRoot(car)
      pins.push(cid)
      return cid
    },
  }
  const chain: Chain = {
    async jobPayment(job) {
      paymentReads.push(job)
      return options.paid ?? job.quoteTotalWei
    },
  }
  const deps = {
    jobs,
    store,
    pinner,
    chain,
    queue,
    log: (event: string, fields: Record<string, string | number | boolean | null> = {}) => {
      lines.push(typeof fields.refusal === 'string' ? `${event}:${fields.refusal}` : event)
    },
  }
  return { deps, jobs, store, queue, pins, lines, paymentReads }
}
