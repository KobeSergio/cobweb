/**
 * A stand-in for an S3 client in adapter tests: it records each command (its class name and
 * input) and answers with whatever the test's `answer` returns. Not exported from the package.
 */
import type { S3Like } from '../adapters/s3-store.ts'

export type SentCommand = { name: string; input: Record<string, unknown> }

export function stubS3<Client = S3Like>(
  answer: (name: string, input: Record<string, unknown>) => unknown = () => ({}),
): { client: Client; sent: SentCommand[] } {
  const sent: SentCommand[] = []
  const client = {
    send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      sent.push({ name: command.constructor.name, input: command.input })
      return answer(command.constructor.name, command.input)
    },
  }
  return { client: client as unknown as Client, sent }
}

export const bytes = (text: string): Uint8Array => new TextEncoder().encode(text)
