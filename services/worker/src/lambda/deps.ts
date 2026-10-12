/**
 * The Lambda side of configuration: the stack sets plain values as environment variables and the
 * ARN of one Secrets Manager secret, read once per container at cold start. The secret is a JSON
 * object of text values (infra/README.md lists its keys); it is merged over the environment and
 * never logged.
 */
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager'
import { productionDeps } from '../env.ts'
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

async function build(): Promise<Deps> {
  const arn = process.env.RENDER_SECRET_ARN
  if (!arn) throw new Error('RENDER_SECRET_ARN is not set.')
  const found = await new SecretsManagerClient({}).send(new GetSecretValueCommand({ SecretId: arn }))
  return productionDeps({ ...process.env, ...parseSecret(found.SecretString) })
}

let cached: Promise<Deps> | null = null

/** The production ports, built once per container. A failed build is tried again on the next message. */
export function loadDeps(): Promise<Deps> {
  cached ??= build().catch((error: unknown) => {
    cached = null
    throw error
  })
  return cached
}
