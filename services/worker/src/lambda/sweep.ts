// SweepFunction: every 15 minutes, re-enqueue jobs left rendering or finalizing with nothing moving.
import { sweep } from '../steps.ts'
import { loadDeps } from './deps.ts'

export async function handler(): Promise<void> {
  await sweep(await loadDeps())
}
