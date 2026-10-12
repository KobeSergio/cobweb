// DeadLetterFunction: a message RenderQueue gave up on after three receives fails its job.
import { handleDead } from '../steps.ts'
import { loadDeps } from './deps.ts'
import { sqsHandler } from './handler.ts'

export const handler = sqsHandler(loadDeps, handleDead)
