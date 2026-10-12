/**
 * A stand-in for the Supabase client in adapter tests: it records every query (the table or
 * function, and each builder call in order) and answers with whatever the test's `answer` returns.
 * Not exported from the package.
 */
import type { WorkerClient } from '../adapters/supabase-jobs.ts'

export type StubCall = {
  table?: string
  fn?: string
  args?: Record<string, unknown>
  /** Builder calls in order: `['eq', 'id', '...']`, `['range', 0, 999]`. */
  ops: unknown[][]
}

export type StubAnswer = { data?: unknown; error?: { code?: string; message: string } | null }

export function stubClient(answer: (call: StubCall) => StubAnswer): {
  client: WorkerClient
  calls: StubCall[]
} {
  const calls: StubCall[] = []
  const builder = (call: StubCall): unknown => {
    const proxy: unknown = new Proxy(
      {},
      {
        get(_target, name) {
          if (name === 'then')
            return (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
              Promise.resolve()
                .then(() => ({ data: null, error: null, ...answer(call) }))
                .then(resolve, reject)
          return (...args: unknown[]) => {
            call.ops.push([String(name), ...args])
            return proxy
          }
        },
      },
    )
    return proxy
  }
  const track = (call: StubCall) => {
    calls.push(call)
    return builder(call)
  }
  const client = {
    from: (table: string) => track({ table, ops: [] }),
    rpc: (fn: string, args: Record<string, unknown>) => track({ fn, args, ops: [] }),
  }
  return { client: client as unknown as WorkerClient, calls }
}

/** The arguments of the first builder call with this name, or undefined. */
export function opOf(call: StubCall, name: string): unknown[] | undefined {
  return call.ops.find((op) => op[0] === name)?.slice(1)
}
