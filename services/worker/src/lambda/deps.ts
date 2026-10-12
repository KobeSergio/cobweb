/**
 * The Lambda side of configuration: the stack sets plain values as environment variables and the
 * ARN of the Secrets Manager secret the function may read, read once per container at cold start. The secret is a JSON
 * object of text values (infra/README.md lists its keys); it is merged over the environment and
 * never logged.
 */
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager'
import { productionDeps } from '../env.ts'
import type { DepsKind } from '../env.ts'
import type { Deps } from '../steps.ts'

export function parseSecret(text: string | undefined): Record<string, string> {
  const unreadable = () => new Error('The render secret is not a JSON object of text values.')
  let value: unknown
  try {
    value = JSON.parse(text ?? '')
  } catch {
    throw unreadable()
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw unreadable()
  const entries = Object.entries(value)
  if (entries.some(([, entry]) => typeof entry !== 'string')) throw unreadable()
  return Object.fromEntries(entries) as Record<string, string>
}

/** The environment name that holds the ARN of the secret each entry point reads. */
const SECRET_ARN: Record<DepsKind, string> = { render: 'RENDER_SECRET_ARN', jobs: 'JOBS_SECRET_ARN' }

async function build(kind: DepsKind): Promise<Deps> {
  const arn = process.env[SECRET_ARN[kind]]
  if (!arn) throw new Error(`${SECRET_ARN[kind]} is not set.`)
  const found = await new SecretsManagerClient({}).send(new GetSecretValueCommand({ SecretId: arn }))
  return productionDeps({ ...process.env, ...parseSecret(found.SecretString) }, undefined, kind)
}

const cached = new Map<DepsKind, Promise<Deps>>()

/**
 * The production ports, built once per container. The render function reads RenderSecrets ("render");
 * the dead-letter and sweep functions read JobsSecrets ("jobs"), which holds the Supabase key only.
 * A failed build is tried again on the next message.
 */
export function loadDeps(kind: DepsKind = 'render'): Promise<Deps> {
  let pending = cached.get(kind)
  if (!pending) {
    pending = build(kind).catch((error: unknown) => {
      cached.delete(kind)
      throw error
    })
    cached.set(kind, pending)
  }
  return pending
}
