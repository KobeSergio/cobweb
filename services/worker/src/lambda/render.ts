// RenderFunction: one message from RenderQueue a call (batch size 1).
import { consoleLog } from '../log.ts'
import { handle } from '../steps.ts'
import { loadDeps } from './deps.ts'
import { sqsHandler } from './handler.ts'

export const handler = sqsHandler(() => loadDeps('render'), handle, consoleLog, {
  queueUrlEnv: 'RENDER_QUEUE_URL',
})
