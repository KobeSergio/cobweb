/**
 * A hand-written fake of the `Jobs` port for the step tests: one job in memory that follows the
 * job state functions' rules (docs/specs/2026-10-12-render-job-state.md, section 6) closely enough
 * to exercise the steps. The database itself is exercised by verify:render. Not exported from the
 * package.
 */
import { JobRefusal } from '../ports.ts'
import type { BatchRecord, FinishResult, JobRecord, Jobs, RenderData, TokenRows } from '../ports.ts'
import { seedBatches } from './fixtures.ts'

export type Failure = { index: number | null; code: string; message: string; final: boolean; retries: number }

export type FakeJobs = Jobs & {
  /** The job row as it stands. */
  record: JobRecord
  rows: BatchRecord[]
  /** Every failure report, accepted or not. */
  failures: Failure[]
  finished: FinishResult | null
  /** Method names in call order. */
  calls: string[]
  stuckJobs: { id: string; retries: number }[]
}

export function fakeJobs(
  data: RenderData,
  rowsOf: (first: number, last: number) => TokenRows,
  options: { claimed?: boolean } = {},
): FakeJobs {
  const record: JobRecord = { ...data.job }
  const fake: FakeJobs = {
    record,
    rows: [],
    failures: [],
    finished: null,
    calls: [],
    stuckJobs: [],

    async job(jobId) {
      fake.calls.push('job')
      return jobId === record.id ? { ...record } : null
    },

    async renderData(job) {
      fake.calls.push('renderData')
      return { ...data, job }
    },

    async tokens(job, index) {
      fake.calls.push(`tokens:${index}`)
      return rowsOf(index * job.batchSize + 1, Math.min((index + 1) * job.batchSize, job.tokenCount))
    },

    async batches(jobId) {
      fake.calls.push('batches')
      return jobId === record.id ? fake.rows.map((row) => ({ ...row })) : []
    },

    async claim(jobId) {
      fake.calls.push('claim')
      if (jobId !== record.id) throw new JobRefusal('JOB_NOT_READY')
      if (record.state === 'paid' || record.state === 'waived') {
        record.state = 'rendering'
        record.batchesDone = 0
        fake.rows = seedBatches(record)
      } else if (!['rendering', 'finalizing', 'done'].includes(record.state)) {
        throw new JobRefusal('JOB_NOT_READY')
      }
      return { ...record }
    },

    async batchStart(jobId, index) {
      fake.calls.push(`batchStart:${index}`)
      const row = jobId === record.id ? fake.rows.find((batch) => batch.index === index) : undefined
      if (row?.state === 'done') return { ...row }
      if (jobId !== record.id || record.state !== 'rendering') throw new JobRefusal('JOB_NOT_RENDERING')
      if (!row) throw new JobRefusal('NO_SUCH_BATCH')
      row.state = 'running'
      row.attempts += 1
      return { ...row }
    },

    async batchDone(jobId, index, cid) {
      fake.calls.push(`batchDone:${index}`)
      const open = record.state === 'rendering' || record.state === 'finalizing'
      const failedWithBatches = record.state === 'failed' && fake.rows.length > 0
      if (jobId !== record.id || !(open || failedWithBatches)) throw new JobRefusal('JOB_NOT_RENDERING')
      const row = fake.rows.find((batch) => batch.index === index)
      if (!row) throw new JobRefusal('NO_SUCH_BATCH')
      if (row.state === 'done') {
        if (row.imagesCid !== cid) throw new JobRefusal('BATCH_RESULT_DIFFERS')
        return { batchesDone: record.batchesDone, last: false }
      }
      row.state = 'done'
      row.imagesCid = cid
      record.batchesDone = fake.rows.filter((batch) => batch.state === 'done').length
      const last = record.state === 'rendering' && record.batchesDone === record.batchesTotal
      if (last) record.state = 'finalizing'
      return { batchesDone: record.batchesDone, last }
    },

    async fail(jobId, index, code, message, final, retries) {
      fake.calls.push('fail')
      fake.failures.push({ index, code, message, final, retries })
      if (index === null && !final) throw new JobRefusal('JOB_FAILURE_NEEDS_FINAL')
      if (jobId !== record.id) throw new JobRefusal('JOB_NOT_RENDERING')
      const mismatch = code === 'payment-mismatch'
      if (retries < record.retries && !mismatch) return { ...record }
      if (record.state === 'failed') {
        if (mismatch) record.errorCode = code
        return { ...record }
      }
      const open = record.state === 'rendering' || record.state === 'finalizing'
      const unclaimed = record.state === 'paid' || record.state === 'waived'
      if (!(open || (mismatch && unclaimed))) throw new JobRefusal('JOB_NOT_RENDERING')
      if (index !== null && !mismatch) {
        const row = fake.rows.find((batch) => batch.index === index)
        if (!row) throw new JobRefusal('NO_SUCH_BATCH')
        if (row.state === 'done') throw new JobRefusal('BATCH_ALREADY_DONE')
        row.state = 'failed'
      }
      if (final) {
        record.state = 'failed'
        record.errorCode = code
      }
      return { ...record }
    },

    async finish(jobId, result) {
      fake.calls.push('finish')
      const same = JSON.stringify(fake.finished) === JSON.stringify(result)
      if (jobId === record.id && record.state === 'done') {
        if (same) return { ...record }
        throw new JobRefusal('JOB_RESULT_DIFFERS')
      }
      if (
        jobId !== record.id ||
        record.state !== 'finalizing' ||
        fake.rows.some((row) => row.state !== 'done')
      )
        throw new JobRefusal('BATCHES_STILL_RENDERING')
      record.state = 'done'
      fake.finished = result
      return { ...record }
    },

    async stuck() {
      fake.calls.push('stuck')
      return fake.stuckJobs
    },
  }
  if (options.claimed) {
    record.state = 'rendering'
    fake.rows = seedBatches(record)
  }
  return fake
}
