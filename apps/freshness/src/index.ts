import { portOf } from './config.ts'
import { errorLine } from './health.ts'
import { startFreshness } from './server.ts'

// The freshness server as Railway runs it (docs/specs/2026-10-16-freshness-server.md, section 6.1): Node runs
// this TypeScript source as it is, on PORT. A start that fails (a served chain's factory that is not an
// address, for one) is logged and exits 1. On SIGTERM it stops its ticks and windows, closes the server and
// exits.

const freshness = await startFreshness({ port: portOf(process.env.PORT) }).catch((error: unknown) => {
  console.error(`The freshness server did not start: ${errorLine(error)}`)
  process.exit(1)
})

process.once('SIGTERM', () => {
  freshness.close().then(
    () => process.exit(0),
    (error: unknown) => {
      console.error(`The freshness server did not close cleanly: ${errorLine(error)}`)
      process.exit(1)
    },
  )
})
