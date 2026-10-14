// Runs the render worker on a laptop for one collection (docs/specs/2026-10-14-render-screen-wiring.md,
// section 12): the dev app's queue only logs, so a job paid in the browser against local Supabase and
// Anvil is rendered here, on the worker's production adapters for the database, storage and the chain,
// with a folder under the system temp directory standing in for the pinning service and a queue in
// memory. Every job of the collection that is paid, waived, rendering or finalizing (real and
// placeholder) gets a start message with its retries, and the runner drains the queue. Prints each
// job's final state, its CIDs and the pinner's folder; exits 0 only when every job ended done. Refuses
// non-local endpoints. Never prints a key. Deletes nothing.
//
//   supabase start && supabase seed buckets
//   pnpm --filter @cobweb/web chain:local    (then copy its two lines into apps/web/.env.local)
//   pnpm --filter @cobweb/web render:local <collectionId>
//
// Runs under `node --conditions=react-server --import ./scripts/resolve-ts.mjs`.

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { enqueueRender } from '@cobweb/shared'
import { consoleLog } from '@cobweb/worker'
import { folderPinner, memoryQueue, runLocal } from '@cobweb/worker/local'
import { adminClient, localConfig, localDeps, storageClient } from './render-deps.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const collectionId = process.argv[2]
if (!collectionId || !UUID.test(collectionId)) {
  console.error('Usage: pnpm --filter @cobweb/web render:local <collectionId>')
  process.exit(2)
}

const settings = localConfig()
const admin = adminClient(settings)

const found = await admin
  .from('render_jobs')
  .select('id, kind, state, retries')
  .eq('collection_id', collectionId)
  .in('state', ['paid', 'waived', 'rendering', 'finalizing'])
  .order('created_at')
if (found.error) {
  console.error(`The jobs could not be read: ${found.error.message}`)
  process.exit(1)
}
const jobs = found.data
if (jobs.length === 0) {
  console.log(`Collection ${collectionId} has no job that is paid, waived, rendering or finalizing.`)
  process.exit(0)
}

const pins = mkdtempSync(join(tmpdir(), 'cobweb-render-local-'))
const queue = memoryQueue()
const deps = localDeps(settings, {
  admin,
  s3: storageClient(settings),
  queue,
  pinner: folderPinner(pins),
  log: consoleLog,
})

console.log(
  `Rendering ${jobs.length} job(s) of collection ${collectionId} on ${settings.rpc} against ${settings.url}`,
)
for (const job of jobs) {
  console.log(`  start: ${job.kind} job ${job.id} (${job.state}, retries ${job.retries})`)
  await enqueueRender(queue, { id: job.id, retries: job.retries })
}
const run = await runLocal(deps)
console.log(`Deliveries: ${run.handled} handled, ${run.thrown} thrown, ${run.dead} dead-lettered`)

let allDone = true
for (const job of jobs) {
  const { data: row, error } = await admin
    .from('render_jobs')
    .select('state, error_code, error, metadata_cid, base_uri, collage_key')
    .eq('id', job.id)
    .single()
  if (error) {
    console.error(`  ${job.id}: could not be read: ${error.message}`)
    allDone = false
    continue
  }
  const batches = await admin
    .from('render_batches')
    .select('index, images_cid')
    .eq('job_id', job.id)
    .order('index')
  const failure = row.error_code ? ` (${row.error_code}: ${row.error})` : ''
  console.log(`  ${job.kind} job ${job.id}: ${row.state}${failure}`)
  for (const batch of batches.data ?? [])
    console.log(`    batch ${batch.index + 1}: ${batch.images_cid ?? 'not pinned'}`)
  if (row.metadata_cid) console.log(`    metadata: ${row.metadata_cid}`)
  if (row.base_uri) console.log(`    base URI: ${row.base_uri}`)
  if (row.collage_key) console.log(`    collage: ${row.collage_key} (bucket ${settings.renderBucket})`)
  if (row.state !== 'done') allDone = false
}
console.log(`Pinned CARs are in ${pins}`)
process.exit(allDone ? 0 : 1)
