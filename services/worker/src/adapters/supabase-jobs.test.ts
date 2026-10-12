import { describe, expect, it } from 'vitest'
import { COLLECTION_ID, JOB_ID, jobRecord } from '../testing/fixtures.ts'
import { opOf, stubClient } from '../testing/stub-client.ts'
import type { StubAnswer, StubCall } from '../testing/stub-client.ts'
import {
  JOB_COLUMNS,
  parseTokenList,
  readPages,
  STUCK_LIMIT,
  supabaseJobs,
  toBatchRecord,
  toJobRecord,
} from './supabase-jobs.ts'
import type { JobRow } from './supabase-jobs.ts'

const row = (over: Partial<JobRow> = {}): JobRow => ({
  id: JOB_ID,
  collection_id: COLLECTION_ID,
  kind: 'real',
  state: 'paid',
  token_count: 5,
  batch_size: 2,
  batches_total: 3,
  batches_done: 0,
  quote_total_wei: '125',
  quote_chain_id: 31337,
  quote_payer: '0x00000000000000000000000000000000000000aa',
  quote_factory: '0x00000000000000000000000000000000000000fa',
  onchain_job_id: `0x3f0c2f5e8a514c0e9d7b0d0f5a3b9c11${'0'.repeat(32)}`,
  placeholder_upload_id: null,
  retries: 0,
  error_code: null,
  waived_by: null,
  payment_tx_hash: `0x${'ab'.repeat(32)}`,
  ...over,
})

const collectionRow = (projectType: string) => ({
  id: COLLECTION_ID,
  name: 'Night Owls',
  description: 'Owls that stay up.',
  project_type: projectType,
  canvas_width: 64,
  token_name: null,
  token_description: '',
  show_blank_traits: false,
})

/** Answers a paged read once and then with an empty page. */
const firstPage = (call: StubCall, rows: unknown[]): StubAnswer => ({
  data: (opOf(call, 'range')?.[0] ?? 0) === 0 ? rows : [],
})

const caught = async (
  run: () => Promise<unknown>,
): Promise<{ name?: string; code?: string; message?: string }> => {
  try {
    await run()
  } catch (error) {
    return error as { name?: string; code?: string; message?: string }
  }
  return {}
}

describe('row mappers', () => {
  it('reads the quote as a bigint, exactly', () => {
    const record = toJobRecord(row({ quote_total_wei: '123456789012345678901234567890' }))
    expect(record.quoteTotalWei).toBe(123456789012345678901234567890n)
    expect(record).toMatchObject(jobRecord({ quoteTotalWei: 123456789012345678901234567890n }))
  })

  it('throws a plain error for a quote that is not a string of digits, never reading a JSON number', () => {
    for (const bad of [9007199254740992, null, '', '12.5', '-1', '1e21', '0x10', ' 5']) {
      expect(() => toJobRecord(row({ quote_total_wei: bad as unknown as string }))).toThrow(
        'The job quote is not a string of digits.',
      )
    }
  })

  it('maps a batch row', () => {
    expect(
      toBatchRecord({
        index: 2,
        state: 'done',
        attempts: 1,
        first_token_id: 5,
        last_token_id: 5,
        images_cid: 'x',
      }),
    ).toEqual({ index: 2, state: 'done', attempts: 1, firstTokenId: 5, lastTokenId: 5, imagesCid: 'x' })
  })

  it('reads the wei column as text in the job select, and the waiver column, never the file list', () => {
    expect(JOB_COLUMNS).toContain('quote_total_wei::text')
    expect(JOB_COLUMNS).toContain('waived_by')
    expect(JOB_COLUMNS).not.toContain('token_list')
  })

  it('is waived when the state is waived or a waiver is recorded, and not otherwise', () => {
    expect(toJobRecord(row()).waived).toBe(false)
    expect(toJobRecord(row({ state: 'waived' })).waived).toBe(true)
    expect(
      toJobRecord(row({ state: 'paid', waived_by: '11111111-2222-4333-8444-555555555555' })).waived,
    ).toBe(true)
    expect(
      toJobRecord(row({ state: 'rendering', waived_by: '11111111-2222-4333-8444-555555555555' })).waived,
    ).toBe(true)
  })

  it('reads the payment transaction hash, null when none is recorded', () => {
    expect(JOB_COLUMNS).toContain('payment_tx_hash')
    expect(toJobRecord(row({ payment_tx_hash: null })).paymentTxHash).toBeNull()
    const hash = `0x${'ab'.repeat(32)}`
    expect(toJobRecord(row({ payment_tx_hash: hash })).paymentTxHash).toBe(hash)
  })

  it('maps a null on-chain job id to an empty string rather than casting it', () => {
    expect(toJobRecord(row({ onchain_job_id: null })).onchainJobId).toBe('')
  })
})

describe('readPages', () => {
  it('reads until an empty page, moving by the rows it got', async () => {
    const ranges: number[][] = []
    const pages = [[1, 2, 3], [4], []]
    const rows = await readPages('Reading', async (from, to) => {
      ranges.push([from, to])
      return { data: pages[ranges.length - 1] ?? [], error: null }
    })
    expect(rows).toEqual([1, 2, 3, 4])
    expect(ranges).toEqual([
      [0, 999],
      [3, 1002],
      [4, 1003],
    ])
  })

  it('throws on an error', async () => {
    await expect(
      readPages('Reading the traits', async () => ({
        data: null,
        error: { code: '57014', message: 'timeout' },
      })),
    ).rejects.toThrow('Reading the traits failed: 57014 timeout')
  })
})

describe('parseTokenList', () => {
  it('keeps well-formed entries and refuses anything else as a render problem', () => {
    expect(parseTokenList([{ id: 1, uploadId: 'u', attributes: [] }])).toEqual([
      { id: 1, uploadId: 'u', attributes: [] },
    ])
    for (const bad of [null, 'text', [{ id: '1', uploadId: 'u' }], [{ id: 1 }], [null]])
      expect(() => parseTokenList(bad)).toThrow('The file list stored for this job cannot be read.')
  })
})

describe('supabaseJobs: reads', () => {
  it('returns the job, or null when there is none', async () => {
    const found = stubClient(() => ({ data: row() }))
    expect(await supabaseJobs(found.client).job(JOB_ID)).toEqual(jobRecord())
    expect(found.calls[0]).toMatchObject({ table: 'render_jobs' })
    expect(opOf(found.calls[0]!, 'select')).toEqual([JOB_COLUMNS])
    expect(opOf(found.calls[0]!, 'eq')).toEqual(['id', JOB_ID])
    const missing = stubClient(() => ({ data: null }))
    expect(await supabaseJobs(missing.client).job(JOB_ID)).toBeNull()
  })

  it('reads a quote of 2^53 + 1 wei exactly', async () => {
    const { client } = stubClient(() => ({ data: row({ quote_total_wei: '9007199254740993' }) }))
    expect((await supabaseJobs(client).job(JOB_ID))?.quoteTotalWei).toBe(9007199254740993n)
  })

  it('reads the batches in index order, a page at a time', async () => {
    const { client, calls } = stubClient((call) =>
      firstPage(call, [
        { index: 0, state: 'done', attempts: 1, first_token_id: 1, last_token_id: 2, images_cid: 'c' },
      ]),
    )
    expect(await supabaseJobs(client).batches(JOB_ID)).toEqual([
      { index: 0, state: 'done', attempts: 1, firstTokenId: 1, lastTokenId: 2, imagesCid: 'c' },
    ])
    expect(calls).toHaveLength(2)
    expect(opOf(calls[0]!, 'order')).toEqual(['index'])
  })

  it('reads one batch of tokens by its id range and nothing wider', async () => {
    const { client, calls } = stubClient((call) => {
      if (call.table === 'collections') return { data: collectionRow('generative') }
      if (call.table === 'tokens')
        return firstPage(call, [
          { token_id: 3, art_collection_id: 'a', dna: ['t1'], description: null },
          { token_id: 4, art_collection_id: 'a', dna: ['t2'], description: 'Four' },
        ])
      return firstPage(call, [])
    })
    const rows = await supabaseJobs(client).tokens(jobRecord(), 1)
    expect(rows).toEqual({
      kind: 'generative',
      rows: [
        { tokenId: 3, artCollectionId: 'a', dna: ['t1'], description: null },
        { tokenId: 4, artCollectionId: 'a', dna: ['t2'], description: 'Four' },
      ],
    })
    const read = calls.find((call) => call.table === 'tokens')!
    expect(opOf(read, 'gte')).toEqual(['token_id', 3])
    expect(opOf(read, 'lte')).toEqual(['token_id', 4])
    expect(opOf(read, 'eq')).toEqual(['collection_id', COLLECTION_ID])
  })

  it('reads the short last batch by the token count', async () => {
    const { client, calls } = stubClient((call) => {
      if (call.table === 'collections') return { data: collectionRow('generative') }
      if (call.table === 'tokens')
        return firstPage(call, [{ token_id: 5, art_collection_id: 'a', dna: [], description: null }])
      return firstPage(call, [])
    })
    await supabaseJobs(client).tokens(jobRecord(), 2)
    const read = calls.find((call) => call.table === 'tokens')!
    expect([opOf(read, 'gte'), opOf(read, 'lte')]).toEqual([
      ['token_id', 5],
      ['token_id', 5],
    ])
  })

  it('refuses a batch with fewer tokens stored than its range as a render problem', async () => {
    const { client } = stubClient((call) => {
      if (call.table === 'collections') return { data: collectionRow('generative') }
      if (call.table === 'tokens')
        return firstPage(call, [{ token_id: 1, art_collection_id: 'a', dna: [], description: null }])
      return firstPage(call, [])
    })
    expect(await caught(() => supabaseJobs(client).tokens(jobRecord(), 0))).toMatchObject({
      name: 'RenderProblem',
      code: 'batch-range',
      message: 'Batch 0 has 1 of its 2 tokens stored.',
    })
  })

  it('refuses a stored file list that is short for the batch range as a render problem', async () => {
    const list = [1, 3].map((id) => ({ id, uploadId: `u${id}`, attributes: [] }))
    const { client } = stubClient((call) => {
      if (call.table === 'collections') return { data: collectionRow('one_of_one') }
      if (call.table === 'render_jobs') return { data: { token_list: list } }
      return firstPage(call, [])
    })
    expect(
      await caught(() => supabaseJobs(client).tokens(jobRecord({ tokenCount: 3, batchesTotal: 2 }), 0)),
    ).toMatchObject({
      name: 'RenderProblem',
      code: 'batch-range',
      message: 'Batch 0 has 1 of its 2 tokens stored.',
    })
  })

  it('refuses a batch index past the end of the job', async () => {
    const { client, calls } = stubClient(() => ({ data: null }))
    expect(await caught(() => supabaseJobs(client).tokens(jobRecord(), 3))).toMatchObject({
      name: 'RenderProblem',
      code: 'batch-range',
    })
    expect(calls).toEqual([])
  })

  it('slices the stored file list for a 1/1 job and reads the list once for the job', async () => {
    const list = [3, 1, 2].map((id) => ({ id, uploadId: `u${id}`, attributes: [] }))
    const { client, calls } = stubClient((call) => {
      if (call.table === 'collections') return { data: collectionRow('one_of_one') }
      if (call.table === 'render_jobs') return { data: { token_list: list } }
      return firstPage(call, [])
    })
    const jobs = supabaseJobs(client)
    const record = jobRecord({ tokenCount: 3, batchesTotal: 2 })
    expect(await jobs.tokens(record, 0)).toEqual({
      kind: 'assets',
      rows: [
        { id: 1, uploadId: 'u1', attributes: [] },
        { id: 2, uploadId: 'u2', attributes: [] },
      ],
    })
    expect(await jobs.tokens(record, 1)).toEqual({
      kind: 'assets',
      rows: [{ id: 3, uploadId: 'u3', attributes: [] }],
    })
    expect(calls.filter((call) => call.table === 'render_jobs')).toHaveLength(1)
    expect(calls.filter((call) => call.table === 'collections')).toHaveLength(1)
  })

  it('reads the art rows of a generative job a page at a time and keeps them for the job', async () => {
    const { client, calls } = stubClient((call) => {
      if (call.table === 'collections') return { data: collectionRow('generative') }
      if (call.table === 'art_collections') return firstPage(call, [{ id: 'a', position: 0 }])
      if (call.table === 'layers')
        return firstPage(call, [
          { id: 'l', art_collection_id: 'a', name: 'Eyes', display_name: null, position: 0 },
        ])
      if (call.table === 'traits')
        return firstPage(call, [
          {
            id: 't',
            layer_id: 'l',
            name: 'Wide',
            blank: false,
            in_metadata: true,
            upload_id: 'u',
            position: 0,
          },
        ])
      return firstPage(call, [{ id: 'u', storage_key: 'k.png' }])
    })
    const jobs = supabaseJobs(client)
    const data = await jobs.renderData(jobRecord())
    expect(data).toMatchObject({
      collection: { projectType: 'generative', canvasWidth: 64, tokenName: null },
      artCollections: [{ id: 'a', position: 0 }],
      layers: [{ id: 'l', artCollectionId: 'a', name: 'Eyes', displayName: null, position: 0 }],
      traits: [
        { id: 't', layerId: 'l', name: 'Wide', blank: false, inMetadata: true, uploadId: 'u', position: 0 },
      ],
      uploads: [{ id: 'u', storageKey: 'k.png' }],
    })
    const uploads = calls.find((call) => call.table === 'uploads')!
    expect(uploads.ops).toContainEqual(['eq', 'kind', 'layer_image'])
    const before = calls.length
    const again = await jobs.renderData(jobRecord({ state: 'rendering' }))
    expect(calls).toHaveLength(before)
    expect(again.job.state).toBe('rendering')
  })

  it('reads again for each fresh call, so two metadata steps in one process read twice', async () => {
    const { client, calls } = stubClient((call) => {
      if (call.table === 'collections') return { data: collectionRow('one_of_one') }
      return firstPage(call, [{ id: 'u', storage_key: 'k.png' }])
    })
    const jobs = supabaseJobs(client)
    await jobs.renderData(jobRecord(), { fresh: true })
    await jobs.renderData(jobRecord(), { fresh: true })
    expect(calls.filter((call) => call.table === 'collections')).toHaveLength(2)
    // A plain call after them still keeps what it read, for the batch steps.
    await jobs.renderData(jobRecord())
    await jobs.renderData(jobRecord())
    expect(calls.filter((call) => call.table === 'collections')).toHaveLength(2)
  })

  it('reads only the placeholder file for a placeholder job', async () => {
    const { client, calls } = stubClient((call) =>
      call.table === 'collections'
        ? { data: collectionRow('generative') }
        : { data: { id: 'u-hidden', storage_key: 'c/placeholders/h.gif' } },
    )
    const data = await supabaseJobs(client).renderData(
      jobRecord({ kind: 'placeholder', placeholderUploadId: 'u-hidden' }),
    )
    expect(data.uploads).toEqual([{ id: 'u-hidden', storageKey: 'c/placeholders/h.gif' }])
    expect(calls.map((call) => call.table)).toEqual(['collections', 'uploads'])
  })
})

describe('supabaseJobs: the job state functions', () => {
  /** After the RPC, the job select answers; the RPC itself returns a row whose number is already rounded. */
  const afterRpc = (call: StubCall, over: Partial<JobRow> = {}): StubAnswer =>
    call.fn
      ? { data: { ...row(), quote_total_wei: 9007199254740992 } }
      : { data: row({ state: 'rendering', quote_total_wei: '9007199254740993', ...over }) }

  it('claims and then reads the job again, so the quote keeps every wei', async () => {
    const { client, calls } = stubClient((call) => afterRpc(call))
    const record = await supabaseJobs(client).claim(JOB_ID)
    expect(record.state).toBe('rendering')
    expect(record.quoteTotalWei).toBe(9007199254740993n)
    expect(calls[0]).toMatchObject({ fn: 'art_claim_render', args: { p_job_id: JOB_ID } })
    expect(calls[1]).toMatchObject({ table: 'render_jobs' })
    expect(opOf(calls[1]!, 'select')).toEqual([JOB_COLUMNS])
  })

  it('fails a job and then reads it again, so the quote keeps every wei', async () => {
    const { client, calls } = stubClient((call) => afterRpc(call, { state: 'failed' }))
    const record = await supabaseJobs(client).fail(JOB_ID, null, 'dead-letter', 'x', true, 0)
    expect(record).toMatchObject({ state: 'failed', quoteTotalWei: 9007199254740993n })
    expect(calls.map((call) => call.fn ?? call.table)).toEqual(['art_batch_failed', 'render_jobs'])
  })

  it('finishes a job and then reads it again, so the quote keeps every wei', async () => {
    const { client, calls } = stubClient((call) => afterRpc(call, { state: 'done' }))
    const record = await supabaseJobs(client).finish(JOB_ID, {
      metadataCid: 'm',
      baseUri: 'ipfs://m/',
      placeholderImageCid: null,
      collageKey: null,
    })
    expect(record).toMatchObject({ state: 'done', quoteTotalWei: 9007199254740993n })
    expect(calls.map((call) => call.fn ?? call.table)).toEqual(['art_render_finish', 'render_jobs'])
  })

  it('throws a refusal for a check violation with a known sentence', async () => {
    const { client } = stubClient(() => ({
      error: { code: '23514', message: 'This job is not ready to render.' },
    }))
    expect(await caught(() => supabaseJobs(client).claim(JOB_ID))).toMatchObject({
      name: 'JobRefusal',
      code: 'JOB_NOT_READY',
    })
  })

  it('throws a plain error for anything else, so the message is redelivered', async () => {
    const { client } = stubClient(() => ({ error: { code: '57014', message: 'canceling statement' } }))
    const error = await caught(() => supabaseJobs(client).batchStart(JOB_ID, 0))
    expect(error.name).toBe('Error')
    expect(error.message).toBe('Starting the batch failed: 57014 canceling statement')
    const unknown = stubClient(() => ({ error: { code: '23514', message: 'violates check constraint "x"' } }))
    expect((await caught(() => supabaseJobs(unknown.client).batchStart(JOB_ID, 0))).name).toBe('Error')
  })

  it('does not carry the database error whole: one short masked line and nothing attached', async () => {
    const secret = 'k'.repeat(40)
    const detailed = {
      code: '08006',
      message: `connection to https://db.example/rest?apikey=${secret} lost\nsecond line ${secret}`,
      details: 'rows',
      hint: secret,
    }
    const { client } = stubClient(() => ({ error: detailed }))
    const error = (await caught(() => supabaseJobs(client).batchStart(JOB_ID, 0))) as Error
    expect(error.message).toBe('Starting the batch failed: 08006 connection to [url] lost')
    expect(Object.keys(error)).toEqual([])
    expect(error.cause).toBeUndefined()
    expect(JSON.stringify(error)).not.toContain(secret)
  })

  it('starts a batch and maps the row', async () => {
    const { client, calls } = stubClient(() => ({
      data: {
        index: 1,
        state: 'running',
        attempts: 2,
        first_token_id: 3,
        last_token_id: 4,
        images_cid: null,
      },
    }))
    expect(await supabaseJobs(client).batchStart(JOB_ID, 1)).toMatchObject({
      index: 1,
      state: 'running',
      attempts: 2,
    })
    expect(calls[0]).toMatchObject({ fn: 'art_batch_start', args: { p_job_id: JOB_ID, p_index: 1 } })
  })

  it('records a batch and returns the count and the flip', async () => {
    const { client, calls } = stubClient(() => ({ data: [{ batches_done: 3, last: true }] }))
    expect(await supabaseJobs(client).batchDone(JOB_ID, 2, 'cid', 4096)).toEqual({
      batchesDone: 3,
      last: true,
    })
    expect(calls[0]?.args).toEqual({ p_job_id: JOB_ID, p_index: 2, p_images_cid: 'cid', p_images_size: 4096 })
  })

  it('passes a null index for a job-level failure, and the retries', async () => {
    const { client, calls } = stubClient((call) => afterRpc(call))
    await supabaseJobs(client).fail(JOB_ID, null, 'dead-letter', 'The render did not finish.', true, 2)
    expect(calls[0]).toMatchObject({
      fn: 'art_batch_failed',
      args: {
        p_job_id: JOB_ID,
        p_index: null,
        p_code: 'dead-letter',
        p_message: 'The render did not finish.',
        p_final: true,
        p_retries: 2,
      },
    })
    await supabaseJobs(client).fail(JOB_ID, 4, 'layer-size', 'Too small.', true, 0)
    expect(calls[2]?.args).toMatchObject({ p_index: 4, p_retries: 0 })
  })

  it('passes the optional finish arguments as explicit nulls when they are absent', async () => {
    const { client, calls } = stubClient((call) => afterRpc(call))
    const jobs = supabaseJobs(client)
    await jobs.finish(JOB_ID, {
      metadataCid: 'm',
      baseUri: 'ipfs://m/',
      placeholderImageCid: null,
      collageKey: null,
    })
    expect(calls[0]?.args).toEqual({
      p_job_id: JOB_ID,
      p_metadata_cid: 'm',
      p_base_uri: 'ipfs://m/',
      p_placeholder_image_cid: null,
      p_collage_key: null,
    })
    await jobs.finish(JOB_ID, {
      metadataCid: 'm',
      baseUri: 'ipfs://m/',
      placeholderImageCid: 'p',
      collageKey: 'k',
    })
    expect(calls[2]?.args).toEqual({
      p_job_id: JOB_ID,
      p_metadata_cid: 'm',
      p_base_uri: 'ipfs://m/',
      p_placeholder_image_cid: 'p',
      p_collage_key: 'k',
    })
  })
})

describe('supabaseJobs: touch', () => {
  const NOW = Date.parse('2026-10-12T12:00:00.000Z')

  it('sets updated_at on that one job row and changes nothing else', async () => {
    const { client, calls } = stubClient(() => ({ data: null }))
    await supabaseJobs(client, { now: () => NOW }).touch(JOB_ID)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.table).toBe('render_jobs')
    expect(opOf(calls[0]!, 'update')).toEqual([{ updated_at: '2026-10-12T12:00:00.000Z' }])
    expect(opOf(calls[0]!, 'eq')).toEqual(['id', JOB_ID])
  })

  it('throws when the update fails, naming the call and not the database error', async () => {
    const { client } = stubClient(() => ({ error: { code: 'XX000', message: 'boom' } }))
    await expect(supabaseJobs(client).touch(JOB_ID)).rejects.toThrow('Touching the job failed: XX000 boom')
  })
})

describe('supabaseJobs: stuck', () => {
  const NOW = Date.parse('2026-10-12T12:00:00.000Z')
  const CUTOFF = '2026-10-12T11:45:00.000Z'
  const quiet = '11111111-2222-4333-8444-555555555555'

  it('reads the four open states older than the cutoff, oldest first, with the row limit', async () => {
    const { client, calls } = stubClient(() => ({ data: [] }))
    expect(await supabaseJobs(client, { now: () => NOW }).stuck(15)).toEqual([])
    const read = calls[0]!
    expect(read.table).toBe('render_jobs')
    expect(opOf(read, 'in')).toEqual(['state', ['rendering', 'finalizing', 'paid', 'waived']])
    expect(opOf(read, 'lt')).toEqual(['updated_at', CUTOFF])
    expect(opOf(read, 'order')).toEqual(['updated_at'])
    expect(opOf(read, 'limit')).toEqual([STUCK_LIMIT])
    expect(opOf(read, 'eq')).toBeUndefined()
  })

  it('returns open jobs older than the cutoff whose batches are all older too', async () => {
    const { client, calls } = stubClient((call) => {
      if (call.table === 'render_jobs')
        return {
          data: [
            { id: JOB_ID, retries: 1, state: 'rendering' },
            { id: quiet, retries: 0, state: 'finalizing' },
          ],
        }
      // The first job has a batch touched after the cutoff; the second has none.
      return { data: opOf(call, 'eq')?.[1] === JOB_ID ? [{ index: 0 }] : [] }
    })
    expect(await supabaseJobs(client, { now: () => NOW }).stuck(15)).toEqual([{ id: quiet, retries: 0 }])
    expect(opOf(calls[1]!, 'gte')).toEqual(['updated_at', CUTOFF])
    expect(opOf(calls[1]!, 'limit')).toEqual([1])
  })

  it('returns a paid or waived job on its own row age and reads no batches for it', async () => {
    const { client, calls } = stubClient(() => ({
      data: [
        { id: JOB_ID, retries: 2, state: 'paid' },
        { id: quiet, retries: 0, state: 'waived' },
      ],
    }))
    expect(await supabaseJobs(client, { now: () => NOW }).stuck(15)).toEqual([
      { id: JOB_ID, retries: 2 },
      { id: quiet, retries: 0 },
    ])
    expect(calls).toHaveLength(1)
  })

  it('narrows the query to one job id before the limit', async () => {
    const { client, calls } = stubClient(() => ({ data: [] }))
    await supabaseJobs(client, { now: () => NOW }).stuck(15, quiet)
    const read = calls[0]!
    expect(opOf(read, 'eq')).toEqual(['id', quiet])
    const names = read.ops.map((op) => op[0])
    expect(names.indexOf('eq')).toBeLessThan(names.indexOf('limit'))
  })

  it('logs one line when the query returns as many rows as its limit, and none below it', async () => {
    const lines: [string, unknown][] = []
    const log = (event: string, fields?: unknown) => void lines.push([event, fields])
    const full = Array.from({ length: STUCK_LIMIT }, () => ({ id: JOB_ID, retries: 0, state: 'paid' }))
    const { client } = stubClient(() => ({ data: full }))
    await supabaseJobs(client, { now: () => NOW, log }).stuck(15)
    expect(lines).toEqual([['stuck-limit-reached', { limit: STUCK_LIMIT }]])
    lines.length = 0
    const { client: short } = stubClient(() => ({ data: full.slice(1) }))
    await supabaseJobs(short, { now: () => NOW, log }).stuck(15)
    expect(lines).toEqual([])
  })

  it('throws on a database error', async () => {
    const { client } = stubClient(() => ({ error: { code: '57014', message: 'timeout' } }))
    await expect(supabaseJobs(client).stuck(15)).rejects.toThrow('Reading stuck jobs failed: 57014 timeout')
  })
})
