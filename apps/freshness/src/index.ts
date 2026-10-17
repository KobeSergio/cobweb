import { indexerOptionsOf, portOf } from './config.ts'
import { failureLine } from './health.ts'
import { startFreshness } from './server.ts'

// The freshness server as Railway runs it (docs/specs/2026-10-16-freshness-server.md, section 6.1): Node runs
// this TypeScript source as it is, on PORT, with the indexer when SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
// are set (docs/specs/2026-10-16-indexer-overview.md, section 6.1). A start that fails (a served chain's
// factory that is not an address, one of the two database variables set alone, or a port already in use) is
// logged through `failureLine`, which names the error and its code and never prints a full message, and exits
// 1. On SIGTERM it stops its ticks, windows and indexers, closes the server and exits.

/** The start, its options read inside it, so a refused option fails it as a failed start. */
async function start() {
  return startFreshness({ port: portOf(process.env.PORT), indexer: indexerOptionsOf(process.env) })
}

const freshness = await start().catch((error: unknown) => {
  console.error(`The freshness server did not start: ${failureLine(error)}`)
  process.exit(1)
})

process.once('SIGTERM', () => {
  freshness.close().then(
    () => process.exit(0),
    (error: unknown) => {
      console.error(`The freshness server did not close cleanly: ${failureLine(error)}`)
      process.exit(1)
    },
  )
})
