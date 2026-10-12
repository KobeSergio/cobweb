// SweepFunction: every 15 minutes, re-enqueue jobs left rendering or finalizing with nothing moving.
import { consoleLog, errorSummary } from '../log.ts'
import { sweep } from '../steps.ts'
import { loadDeps } from './deps.ts'

export async function handler(): Promise<void> {
  try {
    await sweep(await loadDeps())
  } catch (error) {
    consoleLog('sweep failed', { error: errorSummary(error) })
    // The runtime prints a thrown error whole, and viem and AWS errors can carry a URL with a key.
    // eslint-disable-next-line preserve-caught-error -- a cause would carry the raw error to the runtime
    throw new Error('The sweep failed.')
  }
}
