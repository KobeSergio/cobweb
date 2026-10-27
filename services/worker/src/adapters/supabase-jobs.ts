/**
 * The `Jobs` port on Supabase (docs/specs/2026-10-12-render-worker.md, section 5): the only code in
 * the worker that talks to the database. It takes a service-role client built by the worker. Every
 * read is bounded: PostgREST returns at most 1,000 rows a request, so lists are read a page at a
 * time, tokens are read one batch at a time (a batch is at most 1,000 tokens by constraint), and the
 * 100,000 rows of `tokens` are never loaded by one call.
 */
import { RenderProblem } from '@cobweb/render'
import type { SupabaseClient } from '@supabase/supabase-js'
// A type-only import of the generated types: it is erased, so the worker never loads the web app.
import type { Database } from '../../../../apps/web/src/lib/database.types.ts'
import { maskedLine } from '../log.ts'
import type { Log } from '../log.ts'
import { refusalOf } from '../ports.ts'
import type { BatchRecord, JobRecord, Jobs, RenderData, RenderState, TokenRows } from '../ports.ts'

export type WorkerClient = SupabaseClient<Database>

/** The most rows PostgREST returns for one request (`max_rows` in supabase/config.toml). */
export const PAGE_SIZE = 1000
/** The most jobs one sweep looks at, oldest first. */
export const STUCK_LIMIT = 100

/**
 * `quote_total_wei` is read as text: a numeric read as a JSON number loses wei above 2^53. The
 * rows the job state functions return are read as numbers, so the worker never builds a job from
 * them: it reads the job again with this select.
 */
export const JOB_COLUMNS =
  'id, collection_id, kind, state, token_count, batch_size, batches_total, batches_done, quote_total_wei::text, quote_chain_id, quote_payer, quote_factory, onchain_job_id, placeholder_upload_id, retries, error_code, waived_by, payment_tx_hash'

export const BATCH_COLUMNS = 'index, state, attempts, first_token_id, last_token_id, images_cid'

export type JobRow = {
  id: string
  collection_id: string
  kind: 'real' | 'placeholder'
  state: RenderState
  token_count: number
  batch_size: number
  batches_total: number
  batches_done: number
  quote_total_wei: string
  quote_chain_id: number | null
  quote_payer: string | null
  quote_factory: string | null
  onchain_job_id: string | null
  placeholder_upload_id: string | null
  retries: number
  error_code: string | null
  waived_by: string | null
  payment_tx_hash: string | null
}

export type BatchRow = {
  index: number
  state: BatchRecord['state']
  attempts: number
  first_token_id: number
  last_token_id: number
  images_cid: string | null
}

/** The quote in wei: only a string of digits, since a JSON number above 2^53 has already lost wei. */
function weiOf(value: unknown): bigint {
  if (typeof value !== 'string' || !/^[0-9]+$/.test(value))
    throw new Error('The job quote is not a string of digits.')
  return BigInt(value)
}

export function toJobRecord(row: JobRow): JobRecord {
  return {
    id: row.id,
    collectionId: row.collection_id,
    kind: row.kind,
    state: row.state,
    tokenCount: row.token_count,
    batchSize: row.batch_size,
    batchesTotal: row.batches_total,
    batchesDone: row.batches_done,
    quoteTotalWei: weiOf(row.quote_total_wei),
    quoteChainId: row.quote_chain_id,
    quotePayer: row.quote_payer,
    quoteFactory: row.quote_factory,
    // A job with no on-chain id has no payment to find; the chain adapter answers 0 for ''.
    onchainJobId: row.onchain_job_id ?? '',
    placeholderUploadId: row.placeholder_upload_id,
    retries: row.retries,
    errorCode: row.error_code,
    waived: row.state === 'waived' || row.waived_by !== null,
    paymentTxHash: row.payment_tx_hash,
  }
}

export function toBatchRecord(row: BatchRow): BatchRecord {
  return {
    index: row.index,
    state: row.state,
    attempts: row.attempts,
    firstTokenId: row.first_token_id,
    lastTokenId: row.last_token_id,
    imagesCid: row.images_cid,
  }
}

type DbError = { code?: string; message: string }
type Answer<T> = PromiseLike<{ data: T | null; error: DbError | null }>

/**
 * What to throw for a database error: the refusal when a job state function said no with a known
 * sentence, else a new error naming the call, with the code and one masked line of the message. The
 * database error itself is never attached or logged whole.
 */
function failure(what: string, error: DbError): Error {
  return (
    refusalOf(error) ?? new Error(`${what} failed: ${error.code ?? 'no code'} ${maskedLine(error.message)}`)
  )
}

/**
 * Reads every row of a query a page at a time. A short page is not the last one (the server may cap
 * a page below the size asked for); only an empty page ends the read.
 */
export async function readPages<T>(
  what: string,
  page: (from: number, to: number) => Answer<T[]>,
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ;) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1)
    if (error) throw failure(what, error)
    if (!data || data.length === 0) return rows
    rows.push(...data)
    from += data.length
  }
}

type ListEntry = { id: number; uploadId: string; attributes: unknown }

/** The stored 1/1 or single asset list, checked entry by entry. */
export function parseTokenList(value: unknown): ListEntry[] {
  const unreadable = () =>
    new RenderProblem('batch-range', 'The file list stored for this job cannot be read.')
  if (!Array.isArray(value)) throw unreadable()
  return value.map((entry: unknown) => {
    const { id, uploadId, attributes } = (entry ?? {}) as {
      id?: unknown
      uploadId?: unknown
      attributes?: unknown
    }
    if (typeof id !== 'number' || !Number.isInteger(id) || typeof uploadId !== 'string') throw unreadable()
    return { id, uploadId, attributes }
  })
}

/** The states `stuck` looks at: open jobs (judged with their batches) and jobs never claimed. */
const OPEN_STATES = ['rendering', 'finalizing'] as const
const UNCLAIMED_STATES = ['paid', 'waived'] as const

export function supabaseJobs(client: WorkerClient, options: { now?: () => number; log?: Log } = {}): Jobs {
  const now = options.now ?? Date.now
  const log = options.log ?? (() => undefined)
  // Art is frozen while its job is open (the lock), and a list is frozen at lock, so one job's data
  // and list are read once and kept while the same container works through that job's batches. The
  // collection's name and description are not frozen, so the metadata step reads them fresh.
  let dataCache: { jobId: string; data: RenderData } | null = null
  let listCache: { jobId: string; list: ListEntry[] } | null = null

  async function job(jobId: string): Promise<JobRecord | null> {
    const { data, error } = await client.from('render_jobs').select(JOB_COLUMNS).eq('id', jobId).maybeSingle()
    if (error) throw failure('Reading the job', error)
    return data ? toJobRecord(data as unknown as JobRow) : null
  }

  async function jobAfter(jobId: string): Promise<JobRecord> {
    const record = await job(jobId)
    if (!record) throw new Error('The job disappeared after it was written.')
    return record
  }

  async function renderData(record: JobRecord, options: { fresh?: boolean } = {}): Promise<RenderData> {
    if (!options.fresh && dataCache?.jobId === record.id) return { ...dataCache.data, job: record }
    const collectionId = record.collectionId
    const found = await client
      .from('collections')
      .select(
        'id, name, description, project_type, canvas_width, token_name, token_description, show_blank_traits',
      )
      .eq('id', collectionId)
      .maybeSingle()
    if (found.error) throw failure('Reading the collection', found.error)
    if (!found.data) throw new Error('The job has no collection.')
    const collection: RenderData['collection'] = {
      id: found.data.id,
      name: found.data.name,
      description: found.data.description,
      projectType: found.data.project_type,
      canvasWidth: found.data.canvas_width,
      tokenName: found.data.token_name,
      tokenDescription: found.data.token_description,
      showBlankTraits: found.data.show_blank_traits,
    }
    const data: RenderData = {
      job: record,
      collection,
      artCollections: [],
      layers: [],
      traits: [],
      uploads: [],
    }

    if (record.kind === 'placeholder') {
      // A placeholder job needs its one file and nothing else; the art may not exist yet.
      if (record.placeholderUploadId) {
        const upload = await client
          .from('uploads')
          .select('id, storage_key')
          .eq('id', record.placeholderUploadId)
          .eq('collection_id', collectionId)
          .maybeSingle()
        if (upload.error) throw failure('Reading the placeholder', upload.error)
        if (upload.data) data.uploads = [{ id: upload.data.id, storageKey: upload.data.storage_key }]
      }
    } else {
      const generative = collection.projectType === 'generative'
      if (generative) {
        const arts = await readPages('Reading the art collections', (from, to) =>
          client
            .from('art_collections')
            .select('id, position')
            .eq('collection_id', collectionId)
            .order('id')
            .range(from, to),
        )
        data.artCollections = arts.map((row) => ({ id: row.id, position: row.position }))
        const layers = await readPages('Reading the layers', (from, to) =>
          client
            .from('layers')
            .select('id, art_collection_id, name, display_name, position')
            .eq('collection_id', collectionId)
            .order('id')
            .range(from, to),
        )
        data.layers = layers.map((row) => ({
          id: row.id,
          artCollectionId: row.art_collection_id,
          name: row.name,
          displayName: row.display_name,
          position: row.position,
        }))
        const traits = await readPages('Reading the traits', (from, to) =>
          client
            .from('traits')
            .select('id, layer_id, name, blank, in_metadata, upload_id, position')
            .eq('collection_id', collectionId)
            .order('id')
            .range(from, to),
        )
        data.traits = traits.map((row) => ({
          id: row.id,
          layerId: row.layer_id,
          name: row.name,
          blank: row.blank,
          inMetadata: row.in_metadata,
          uploadId: row.upload_id,
          position: row.position,
        }))
      }
      const uploads = await readPages('Reading the uploads', (from, to) =>
        client
          .from('uploads')
          .select('id, storage_key')
          .eq('collection_id', collectionId)
          .eq('kind', generative ? 'layer_image' : 'asset')
          .order('id')
          .range(from, to),
      )
      data.uploads = uploads.map((row) => ({ id: row.id, storageKey: row.storage_key }))
    }
    dataCache = { jobId: record.id, data }
    return data
  }

  async function tokenList(jobId: string): Promise<ListEntry[]> {
    if (listCache?.jobId === jobId) return listCache.list
    const { data, error } = await client
      .from('render_jobs')
      .select('token_list')
      .eq('id', jobId)
      .maybeSingle()
    if (error) throw failure('Reading the file list', error)
    const list = parseTokenList(data?.token_list)
    listCache = { jobId, list }
    return list
  }

  async function tokens(record: JobRecord, index: number): Promise<TokenRows> {
    const first = index * record.batchSize + 1
    const last = Math.min((index + 1) * record.batchSize, record.tokenCount)
    const expected = last - first + 1
    // A batch with fewer tokens than its range would render and pin a short directory without any
    // error, so the count is checked here, where the rows are read.
    const short = (stored: number) =>
      new RenderProblem(
        'batch-range',
        `Batch ${index} has ${stored} of its ${Math.max(expected, 0)} tokens stored.`,
        { detail: { batchNo: index } },
      )
    if (!Number.isInteger(index) || index < 0 || expected < 1) throw short(0)
    const data = await renderData(record)
    if (data.collection.projectType === 'generative') {
      const rows = await readPages('Reading the tokens', (from, to) =>
        client
          .from('tokens')
          .select('token_id, art_collection_id, dna, description')
          .eq('collection_id', record.collectionId)
          .gte('token_id', first)
          .lte('token_id', last)
          .order('token_id')
          .range(from, to),
      )
      if (rows.length !== expected) throw short(rows.length)
      return {
        kind: 'generative',
        rows: rows.map((row) => ({
          tokenId: row.token_id,
          artCollectionId: row.art_collection_id,
          dna: row.dna,
          description: row.description,
        })),
      }
    }
    const rows = (await tokenList(record.id))
      .filter((entry) => entry.id >= first && entry.id <= last)
      .sort((a, b) => a.id - b.id)
    if (rows.length !== expected) throw short(rows.length)
    return { kind: 'assets', rows }
  }

  return {
    job,
    renderData,
    tokens,

    async batches(jobId) {
      const rows = await readPages('Reading the batches', (from, to) =>
        client
          .from('render_batches')
          .select(BATCH_COLUMNS)
          .eq('job_id', jobId)
          .order('index')
          .range(from, to),
      )
      return rows.map(toBatchRecord)
    },

    async claim(jobId) {
      const { error } = await client.rpc('art_claim_render', { p_job_id: jobId })
      if (error) throw failure('Claiming the job', error)
      return jobAfter(jobId)
    },

    async batchStart(jobId, index) {
      const { data, error } = await client.rpc('art_batch_start', { p_job_id: jobId, p_index: index })
      if (error) throw failure('Starting the batch', error)
      return toBatchRecord(data as BatchRow)
    },

    async batchDone(jobId, index, cid, size) {
      const { data, error } = await client.rpc('art_batch_done', {
        p_job_id: jobId,
        p_index: index,
        p_images_cid: cid,
        p_images_size: size,
      })
      if (error) throw failure('Recording the batch', error)
      const [row] = data ?? []
      if (!row) throw new Error('Recording the batch returned no row.')
      return { batchesDone: row.batches_done, last: row.last }
    },

    async fail(jobId, index, code, message, final, retries) {
      const { error } = await client.rpc('art_batch_failed', {
        p_job_id: jobId,
        // A job-level failure has no batch. The generated type has no null for the argument.
        p_index: index as unknown as number,
        p_code: code,
        p_message: message,
        p_final: final,
        p_retries: retries,
      })
      if (error) throw failure('Recording the failure', error)
      return jobAfter(jobId)
    },

    async finish(jobId, result) {
      const { error } = await client.rpc('art_render_finish', {
        p_job_id: jobId,
        p_metadata_cid: result.metadataCid,
        p_base_uri: result.baseUri,
        // Passed as null when absent, never left out: the function has one signature with both
        // optional arguments, and PostgREST resolves a call by the names it is given.
        p_placeholder_image_cid: result.placeholderImageCid as string,
        p_collage_key: result.collageKey as string,
      })
      if (error) throw failure('Finishing the job', error)
      return jobAfter(jobId)
    },

    async touch(jobId) {
      // Explicit, though the set_updated_at trigger would set it too: no business column changes, and
      // the state and frozen-art guards only look at those.
      const { error } = await client
        .from('render_jobs')
        .update({ updated_at: new Date(now()).toISOString() })
        .eq('id', jobId)
      if (error) throw failure('Touching the job', error)
    },

    async deliveryFailed(jobId, messageKey) {
      const { data, error } = await client.rpc('art_render_delivery_failed', {
        p_job_id: jobId,
        p_message_key: messageKey,
      })
      if (error) throw failure('Counting the failed delivery', error)
      return typeof data === 'number' ? data : null
    },

    async deliveryFailures(jobId, messageKey) {
      const { data, error } = await client.rpc('art_render_delivery_failures', {
        p_job_id: jobId,
        p_message_key: messageKey,
      })
      if (error) throw failure('Reading the failed deliveries', error)
      return typeof data === 'number' ? data : 0
    },

    async stuck(olderThanMinutes, onlyJobId) {
      const cutoff = new Date(now() - olderThanMinutes * 60_000).toISOString()
      let query = client
        .from('render_jobs')
        .select('id, retries, state')
        .in('state', [...OPEN_STATES, ...UNCLAIMED_STATES])
        .lt('updated_at', cutoff)
      // Applied in the query, before the limit, so the one job cannot be pushed out by older ones.
      if (onlyJobId !== undefined) query = query.eq('id', onlyJobId)
      const { data, error } = await query.order('updated_at').limit(STUCK_LIMIT)
      if (error) throw failure('Reading stuck jobs', error)
      // Oldest first, so a full page means younger stuck jobs may wait for the next sweep.
      if ((data ?? []).length >= STUCK_LIMIT) log('stuck-limit-reached', { limit: STUCK_LIMIT })
      const stuck: { id: string; retries: number }[] = []
      for (const row of data ?? []) {
        // A paid or waived job has no batch rows: its own age is all there is to judge.
        if ((UNCLAIMED_STATES as readonly string[]).includes(row.state)) {
          stuck.push({ id: row.id, retries: row.retries })
          continue
        }
        // One bounded read a job: is any of its batches newer than the cutoff?
        const recent = await client
          .from('render_batches')
          .select('index')
          .eq('job_id', row.id)
          .gte('updated_at', cutoff)
          .limit(1)
        if (recent.error) throw failure('Reading stuck batches', recent.error)
        if ((recent.data ?? []).length === 0) stuck.push({ id: row.id, retries: row.retries })
      }
      return stuck
    },
  }
}
