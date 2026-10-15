import { DEFAULT_PORT } from './config.ts'
import { errorLine } from './health.ts'
import { startFreshness } from './server.ts'

// The freshness server as Railway runs it (docs/specs/2026-10-16-freshness-server.md, section 6.1): Node runs
// this TypeScript source as it is, on PORT. On SIGTERM it stops its ticks and windows, closes the server and
// exits.

const freshness = await startFreshness({ port: Number(process.env.PORT || DEFAULT_PORT) })

process.once('SIGTERM', () => {
  freshness.close().then(
    () => process.exit(0),
    (error: unknown) => {
      console.error(`The freshness server did not close cleanly: ${errorLine(error)}`)
      process.exit(1)
    },
  )
})
