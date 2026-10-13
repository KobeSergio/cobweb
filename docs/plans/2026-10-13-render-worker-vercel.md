# Render Worker on Vercel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the render worker with no AWS account: a Vercel Queues consumer and a sweep cron inside `apps/web`, the start message sent when a payment is recorded, layers and collages in Cloudflare R2, and the `infra` package, the Lambda entry points, the SQS adapter and the Secrets Manager loader deleted.

**Architecture:** The worker's ports, steps, local runner, render library and database functions stay. The queue contract in `packages/shared` loses `backlog` and gains `messageKey`, `RENDER_TOPIC` and `RENDER_RETENTION_SECONDS`. `@cobweb/worker` gains a Vercel queue adapter that takes the SDK's `send` by injection, and a consumer that dead-letters on the third delivery; `productionDeps` takes its queue from the caller. `apps/web` gets a queue module and the start send in the pay flow, the consumer route `/api/queues/render`, the cron route `/api/cron/render-sweep`, `vercel.json`, and the Next config that transpiles the worker and keeps sharp external. Asset batches target 500 MB at lock (a new migration) and the worker's ceiling is 600 MB.

**Tech Stack:** TypeScript strict (ESM, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`) consumed as source; Node 26 locally, Node 24.x on Vercel; Next 16 (App Router, Turbopack); Vitest 5; `@vercel/queue` 0.8.0 (exact); AWS SDK v3 `client-s3` 3.1147.0 (Supabase Storage, R2 and Filebase all speak S3); Supabase local; Anvil; Vercel CLI 62.7.0.

**Spec:** [../specs/2026-10-13-render-worker-vercel.md](../specs/2026-10-13-render-worker-vercel.md). It supersedes section 9 and the AWS lines of sections 4, 8, 10 and 11 of [../specs/2026-10-12-render-worker.md](../specs/2026-10-12-render-worker.md); everything else in that spec stands.

## Global Constraints

- The spec is the binding authority. Where this plan decides a detail the spec leaves open, the line starts with "Decision:" and the decisions that shape more than one task are collected in the next section.
- Node 26 locally. ESM everywhere. Inside `services/worker` and `packages/shared`, relative imports carry the `.ts` extension (`./ports.ts`). Inside `apps/web/src`, imports are extensionless and use the `@/` alias, as the existing files do. Types are imported with `import type`.
- Vitest 5, Node environment. One file: `pnpm --filter <package> exec vitest run <file>`, for example `pnpm --filter @cobweb/worker exec vitest run src/vercel/consumer.test.ts`.
- Prettier: no semicolons, single quotes, trailing commas, 110 columns. Before each commit run `pnpm exec prettier --write <the files you changed>` from the repo root. Never run `pnpm format` or Prettier on `.`. CI runs `pnpm format:check`, so every file you touch outside `docs/` must be formatted.
- typescript-eslint's recommended rules and ESLint's `preserve-caught-error` apply. Do not write `throw new X(...)` directly inside a `catch` block; use a factory (`MessageFailed.from(error)`) as the code below does.
- Copy: plain sentences. No em or en dashes anywhere, code comments and docs included. The product is Cobweb; never Kingdomly.
- Security: no env name starts with `NEXT_PUBLIC_` except the ones that already do. No secret value is printed, logged, committed or set on Vercel. An error is logged as `errorSummary(error)` (name and one masked line), never as the error object. **The executor must not set any real secret on the Vercel project.** The only env values the executor may add on Vercel are the non-secret placeholders listed in Task 12, and only for the `preview` environment.
- Never deploy to production. Never pass `--prod` or `--target production` to any `vercel` command.
- `@vercel/queue` is pinned exactly to `0.8.0` and is a dependency of `apps/web` only. `services/worker` imports nothing from it.
- `docs/PLAN.md` must not change. `legacy/` is never read into, copied from, imported or committed.
- Docs keep their history: add dated notes, decisions and status sentences; never rewrite or delete earlier statements in `docs/MASTER_PLAN.md` or in specs (the owner's standing rule since 3 October 2026).
- Local services, for Tasks 7, 8 and 12: `supabase start` at the repo root, `supabase seed buckets`, and `pnpm --filter @cobweb/web chain:local` running in the background with its two printed lines in `apps/web/.env.local`. Never point a script at anything but localhost.
- Implementers never use `git commit --amend` or `git stash`. `rm` is used only where a step says so (Task 10). To fix a commit, make a new one.
- Before every commit, at the repo root: `pnpm typecheck && pnpm lint && pnpm test`.
- Commit messages are one plain imperative sentence with no prefix, and end with exactly these two lines:

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KzWVSCKjsfbP9YKBetKHwW
```

## Decisions

1. Decision: `services/worker/src/testing/stub-aws.ts` is renamed to `stub-s3.ts` (function `stubS3`) rather than deleted outright. It is a generic S3 client stand-in that `adapters/filebase.test.ts` and `adapters/s3-store.test.ts` use; only its name was AWS shaped. The spec's "deleted" is met: the file is gone.
2. Decision: the web app's worker routes pass `NEXT_PUBLIC_SUPABASE_URL` to the worker as `SUPABASE_URL` when `SUPABASE_URL` is not set (`workerEnv` in `apps/web/src/lib/render/env.ts`). The web app's environment has no `SUPABASE_URL` and the spec adds none.
3. Decision: the consumer rethrows a `MessageFailed` whose message is the masked summary, never the original error, because the SDK and the runtime may print a thrown error whole and viem and storage errors can carry a URL with a key. A delivery past `MAX_DELIVERIES` (the one after a `handleDead` that threw) goes straight to `handleDead` without running the step again.
4. Decision: the SDK calls `retry(error, metadata)`, and the spec's `retryAfter` takes `metadata` alone, so the route passes `retry: (_error, metadata) => retryAfter(metadata)`.
5. Decision: no layer cache is added (spec section 8, decision 5). The render library already reads each distinct key once per `renderBatch` call (`services/render/src/batch.ts`, `cachedLoader`), so Task 4 only lowers the pass-through ceiling.
6. Decision: the start send lives in `apps/web/src/lib/render/start.ts` (`startRender`, and `startIfWaived` for the lock), so it can be unit tested without `lock-core.ts`, which pulls in `server-only` through `@cobweb/shared/server`. The pay flow itself is checked end to end in `verify:chain`: the paid job sends exactly one start message with `retries` 0, the short payment sends none, and a queue that throws leaves the payment recorded and the job paid. The lock check also asserts that a `payment_due` lock queues nothing. Four existing check names change; the count stays 12.
7. Decision: `productionDeps` puts both buckets behind one S3 client. R2 and Supabase Storage each serve both buckets from one endpoint with one key pair; the second, credential-less client existed for an AWS role.
8. Decision: `apps/web` lists `@cobweb/render` (workspace) as a dependency next to `@cobweb/worker`, so `transpilePackages` resolves both from the app.
9. Decision: the root `esbuild` dev dependency goes with `infra` (it existed only because CDK ran esbuild from the lockfile's directory), and so do the three `cdk.out` ignore lines. `onlyBuiltDependencies: [esbuild]` in `pnpm-workspace.yaml` stays, for the esbuild that Vitest's toolchain installs.
10. Decision: the preview deployment links the repo root to the Vercel project `cobweb` with Root Directory `apps/web`, and deploys from the repo root. Vercel CLI 62.7.0 has no `--name` flag, and a deploy from `apps/web` alone would not upload the workspace packages the app imports. A committed root `.vercelignore` keeps `legacy/`, env files and build output out of the upload; a dry run proves it before the real upload.
11. Decision: the cron route answers 404 when `CRON_SECRET` is unset, and compares the header in constant time.
12. Decision: a web app test reads `vercel.json` and `next.config.ts`, so the trigger, the cron and the function path cannot drift from the route files.
13. Decision: a waived job (a single asset with no fee) is started at lock: `lockCore` calls `startIfWaived` from the same module as the pay flow's send, with `retries` 0. A job `art_lock` returns as `payment_due` sends nothing; its start comes with the payment. `lockPlaceholderCore` does the same after `art_lock_placeholder` returns its job.

## Review Focus

Inputs and failure modes the spec implies but its own test list would not exercise, most likely first. Each is pinned to a test in the task that owns the code.

1. A step throws an error whose message carries an RPC or storage URL with a key in it. Expected: the consumer logs the name and masked line and throws a `MessageFailed` carrying only that line, so nothing the SDK or the runtime prints can hold the key. Pinned by "rethrows a masked MessageFailed below the third delivery, never the original error" (Task 3, `consumer.test.ts`).
2. The queue refuses the start send after the payment is recorded (a Vercel outage, a missing OIDC token on a misconfigured project). Expected: the creator sees the payment accepted and the job `paid`, the failure is logged with the job id and the error name only, and the sweep starts the job. Pinned by "swallows a failed send and logs the job id with the error name only" (Task 8, `start.test.ts`) and the renamed verify:chain check "confirm: the payment left unrecorded is recorded and the job is paid, even when the queue refuses the start message" (Task 8).
3. A creator's retry of a failed job is sent with the same idempotency key as the attempt that failed and is dropped as a duplicate for a day. Expected: keys differ across `retries`, so a retry always reaches the worker. Pinned by "differs for every message a job can send, and across retries" (Task 1, `render-queue.test.ts`) and "sends the same keys again on a rerun after a failed send" (Task 2, `vercel-queue.test.ts`).
4. A cron request with no header, a wrong secret, or a project where `CRON_SECRET` was never set (an empty secret would match `Bearer `). Expected: 404 and no sweep. Pinned by "answers 404 and does not sweep when CRON_SECRET is unset, even for a bare Bearer header" (Task 9, `sweep-route.test.ts`).
5. A job that needs no payment (a single asset, fee 0) is locked straight into `waived`, with no payment step to send its start. Expected: the lock sends one start message with `retries` 0, a `payment_due` lock sends nothing, and a failed send at lock still returns the locked job. Pinned by "starts a waived job at lock and nothing else" and "returns normally when the send at lock fails" (Task 8, `start.test.ts`), and the lock check in verify:chain asserting nothing is queued for a `payment_due` lock (Task 8).

## File map

| Path | Task | Responsibility |
| --- | --- | --- |
| `packages/shared/src/render-queue.ts`, `render-queue.test.ts` | 1, 6 | `messageKey`, `RENDER_TOPIC`, `RENDER_RETENTION_SECONDS` (1); `RenderQueue` without `backlog` (6) |
| `services/worker/src/adapters/vercel-queue.ts`, `vercel-queue.test.ts` | 2 | `vercelRenderQueue`, `QueueSender` |
| `services/worker/src/queue.ts` | 2 | The `@cobweb/worker/queue` entry re-exports the Vercel adapter |
| `services/worker/src/vercel/consumer.ts`, `consumer.test.ts` | 3 | `queueConsumer`, `retryAfter`, `MessageFailed`, the three constants |
| `services/worker/src/steps.ts`, `steps.test.ts` | 4, 6 | `MAX_BATCH_BYTES` 600 MB (4); sweep with one threshold (6) |
| `services/worker/src/env.ts`, `env.test.ts`, `.env.example` | 5 | `productionDeps(env, { queue, log?, kind? })`, no queue URL |
| `services/worker/src/index.ts` | 2 to 6 | Package exports |
| `services/worker/src/lambda/*`, `adapters/sqs.ts`, `adapters/sqs.test.ts` | 5 | Deleted |
| `services/worker/src/testing/stub-aws.ts` to `stub-s3.ts` | 5 | Renamed (Decision 1) |
| `services/worker/package.json` | 5 | Drops the SQS, Secrets Manager and Lambda type packages |
| `services/worker/src/doubles/memory-queue.ts`, `doubles.test.ts` | 6 | `memoryQueue` without `backlog` |
| `supabase/migrations/20261013010000_asset_batch_target.sql` | 7 | 500 MB asset batch target |
| `apps/web/scripts/verify-local.ts` | 7 | Batch-size checks: 9 tokens a batch, 5 batches |
| `apps/web/src/lib/render/start.ts`, `start.test.ts` | 8 | `startRender`, `startIfWaived` |
| `apps/web/src/lib/render/queue.ts`, `queue.test.ts` | 8 | `renderQueue` |
| `apps/web/src/lib/art/lock-core.ts`, `lock-write.ts` | 8 | `LockContext.queue`, the start send in `confirmCore` and, for a waived job, in `lockCore` |
| `apps/web/scripts/verify-chain.ts`, `verify-render.ts` | 8 | Contexts carry a queue; three pay checks assert the send |
| `apps/web/package.json` | 8 | `@vercel/queue` 0.8.0, `@cobweb/worker` and `@cobweb/render` as dependencies |
| `apps/web/src/lib/render/env.ts`, `env.test.ts` | 9 | `workerEnv`, `cronAuthorized` |
| `apps/web/src/lib/render/worker.ts` | 9 | `workerDeps`, `renderDeps` |
| `apps/web/src/app/api/queues/render/route.ts` | 9 | The consumer route |
| `apps/web/src/app/api/cron/render-sweep/route.ts`, `apps/web/src/lib/render/sweep-route.test.ts` | 9 | The sweep cron route and its test |
| `apps/web/vercel.json`, `next.config.ts`, `src/lib/render/vercel-config.test.ts` | 9 | Trigger, cron, region; transpile and external packages |
| `apps/web/.env.example` | 9 | Filebase names, `CRON_SECRET`, R2 notes |
| `infra/` (all), `pnpm-workspace.yaml`, root `package.json`, `.gitignore`, `.prettierignore`, `eslint.config.mjs`, `CLAUDE.md`, `services/worker/scripts/bench.ts` | 10 | `infra` deleted; workspace and docs references removed |
| `docs/MASTER_PLAN.md`, `docs/specs/2026-10-12-render-worker.md`, `services/worker/README.md`, `README.md` | 11 | Hosting decision, superseded notes, the worker README, the root README's hosting wording |
| `.vercelignore`, `docs/specs/2026-10-13-render-worker-vercel.md` | 12 | Upload ignore list; acceptance boxes |

---

### Task 1: The message key and the queue settings in the shared contract

**Files:**

- Modify: `packages/shared/src/render-queue.ts`
- Test: `packages/shared/src/render-queue.test.ts`

**Interfaces:**

- Consumes: `RenderMessage` (already in the file).
- Produces, from `@cobweb/shared` and `@cobweb/shared/render-queue`:
  - `function messageKey(message: RenderMessage): string`, returning `<jobId>:start:<retries>`, `<jobId>:batch:<index>:<retries>` or `<jobId>:metadata:<retries>`
  - `const RENDER_TOPIC = 'render'`
  - `const RENDER_RETENTION_SECONDS = 604_800`

`RenderQueue.backlog` stays in this task: the SQS adapter and `memoryQueue` still implement it, and removing it now would break the worker's type check. Task 6 removes it.

- [ ] **Step 1: Write the failing tests**

In `packages/shared/src/render-queue.test.ts`, replace the import block at the top with:

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ART_PROBLEM_CODES,
  collageKey,
  enqueueRender,
  messageKey,
  parseRenderMessage,
  RENDER_RETENTION_SECONDS,
  RENDER_TOPIC,
  WORKER_FAILURE_CODES,
  type RenderMessage,
} from './render-queue.ts'
```

Then add these two blocks after the `describe('enqueueRender', ...)` block:

```ts
describe('messageKey', () => {
  it('is <jobId>:<step>:<retries>, with the index for a batch', () => {
    expect(messageKey({ jobId: JOB, step: 'start', retries: 0 })).toBe(`${JOB}:start:0`)
    expect(messageKey({ jobId: JOB, step: 'batch', index: 7, retries: 2 })).toBe(`${JOB}:batch:7:2`)
    expect(messageKey({ jobId: JOB, step: 'metadata', retries: 5 })).toBe(`${JOB}:metadata:5`)
  })

  it('differs for every message a job can send, and across retries', () => {
    const keys = new Set<string>()
    for (const retries of [0, 1]) {
      keys.add(messageKey({ jobId: JOB, step: 'start', retries }))
      for (const index of [0, 1, 2]) keys.add(messageKey({ jobId: JOB, step: 'batch', index, retries }))
      keys.add(messageKey({ jobId: JOB, step: 'metadata', retries }))
    }
    expect(keys.size).toBe(10)
  })

  it('stays under 64 characters for a large job, well within the 256 Vercel allows', () => {
    expect(messageKey({ jobId: JOB, step: 'batch', index: 99_999, retries: 5 }).length).toBeLessThan(64)
    expect(messageKey({ jobId: JOB, step: 'metadata', retries: 5 }).length).toBeLessThan(64)
  })
})

describe('the queue settings', () => {
  it('sends to the render topic and keeps a message for 7 days, the most Vercel allows', () => {
    expect(RENDER_TOPIC).toBe('render')
    expect(RENDER_RETENTION_SECONDS).toBe(604_800)
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @cobweb/shared exec vitest run src/render-queue.test.ts`
Expected: FAIL, `messageKey is not a function` (and the settings test fails on `undefined`).

- [ ] **Step 3: Write the key and the settings**

In `packages/shared/src/render-queue.ts`, append at the end of the file:

```ts
/** The Vercel Queues topic the render messages go to. */
export const RENDER_TOPIC = 'render'

/**
 * How long a sent message is kept: 7 days, the most Vercel allows, so a message waiting behind a long
 * queue never expires. The deduplication window is 24 hours whatever this is.
 */
export const RENDER_RETENTION_SECONDS = 604_800

/**
 * A message's idempotency key: `<jobId>:start:<retries>`, `<jobId>:batch:<index>:<retries>` or
 * `<jobId>:metadata:<retries>`. The queue drops a second message with the same key for 24 hours, so a
 * step that is rerun after a partial send, or a sweep that sends a start already sent, does no work
 * twice. A creator's retry raises `retries` and so gets new keys. Under 64 characters.
 */
export function messageKey(message: RenderMessage): string {
  if (message.step === 'batch') return `${message.jobId}:batch:${message.index}:${message.retries}`
  return `${message.jobId}:${message.step}:${message.retries}`
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm --filter @cobweb/shared exec vitest run src/render-queue.test.ts`
Expected: PASS. The "imports nothing" test still passes. `@cobweb/shared` now has 48 tests (44 before, 4 added).

- [ ] **Step 5: Format, run the root checks and commit**

```bash
pnpm exec prettier --write packages/shared/src/render-queue.ts packages/shared/src/render-queue.test.ts
pnpm typecheck && pnpm lint && pnpm test
git add packages/shared/src/render-queue.ts packages/shared/src/render-queue.test.ts
git commit -m "$(cat <<'EOF'
Give each render message an idempotency key and name the render topic and its retention

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KzWVSCKjsfbP9YKBetKHwW
EOF
)"
```

---

### Task 2: The Vercel queue adapter

**Files:**

- Create: `services/worker/src/adapters/vercel-queue.ts`
- Create: `services/worker/src/adapters/vercel-queue.test.ts`
- Modify: `services/worker/src/queue.ts` (whole file)
- Modify: `services/worker/src/index.ts` (two lines added)

**Interfaces:**

- Consumes: `messageKey`, `RENDER_TOPIC`, `RENDER_RETENTION_SECONDS`, `RenderMessage`, `RenderQueue` from `@cobweb/shared/render-queue` (Task 1).
- Produces, from `@cobweb/worker` and `@cobweb/worker/queue`:
  - `type QueueSender = { send(topic: string, body: unknown, options: { idempotencyKey: string; retentionSeconds: number }): Promise<unknown> }`
  - `function vercelRenderQueue(sender: QueueSender): RenderQueue`

The adapter imports nothing from `@vercel/queue`; the web app passes the SDK's `send` (Tasks 8 and 9). `@cobweb/worker/queue` stops exporting the SQS adapter now; nothing imports it from that entry (checked with `git grep -n "@cobweb/worker/queue"`).

- [ ] **Step 1: Write the failing test**

Create `services/worker/src/adapters/vercel-queue.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { messageKey, RENDER_RETENTION_SECONDS, RENDER_TOPIC } from '@cobweb/shared/render-queue'
import type { RenderMessage } from '@cobweb/shared/render-queue'
import { describe, expect, it } from 'vitest'
import { vercelRenderQueue } from './vercel-queue.ts'
import type { QueueSender } from './vercel-queue.ts'

const JOB = '3f0c2f5e-8a51-4c0e-9d7b-0d0f5a3b9c11'

type Sent = {
  topic: string
  body: unknown
  options: { idempotencyKey: string; retentionSeconds: number }
}

/** A sender that records each call, and throws instead of recording the call numbered `failAt` (from 0). */
function recorder(failAt?: number) {
  const sent: Sent[] = []
  let calls = 0
  const sender: QueueSender = {
    async send(topic, body, options) {
      const call = calls++
      if (call === failAt) throw new Error('queue down')
      sent.push({ topic, body, options })
      return { messageId: `m-${call}` }
    },
  }
  return { sent, sender }
}

const messages: RenderMessage[] = [
  { jobId: JOB, step: 'batch', index: 0, retries: 1 },
  { jobId: JOB, step: 'batch', index: 1, retries: 1 },
  { jobId: JOB, step: 'metadata', retries: 1 },
]

/** The module specifiers a source file imports or re-exports from. */
const specifiers = (file: string): string[] => [
  ...new Set(
    [
      ...readFileSync(new URL(file, import.meta.url), 'utf8').matchAll(
        /^(?:import|export)[^'"]*from\s+'([^']+)'/gm,
      ),
    ].map((match) => match[1]!),
  ),
]

describe('vercelRenderQueue', () => {
  it('sends each message to the render topic, in order, with its key and the retention', async () => {
    const { sent, sender } = recorder()
    await vercelRenderQueue(sender).send(messages)
    expect(sent).toEqual(
      messages.map((message) => ({
        topic: RENDER_TOPIC,
        body: message,
        options: { idempotencyKey: messageKey(message), retentionSeconds: RENDER_RETENTION_SECONDS },
      })),
    )
  })

  it('sends nothing for an empty list', async () => {
    const { sent, sender } = recorder()
    await vercelRenderQueue(sender).send([])
    expect(sent).toEqual([])
  })

  it('passes a failed send on to the caller and sends nothing after it', async () => {
    const { sent, sender } = recorder(1)
    await expect(vercelRenderQueue(sender).send(messages)).rejects.toThrow('queue down')
    expect(sent.map((call) => call.options.idempotencyKey)).toEqual([messageKey(messages[0]!)])
  })

  it('sends the same keys again on a rerun after a failed send, so the queue drops the repeats', async () => {
    const first = recorder(2)
    await expect(vercelRenderQueue(first.sender).send(messages)).rejects.toThrow('queue down')
    const second = recorder()
    await vercelRenderQueue(second.sender).send(messages)
    const keys = (calls: Sent[]) => calls.map((call) => call.options.idempotencyKey)
    expect(keys(second.sent).slice(0, 2)).toEqual(keys(first.sent))
    expect(keys(second.sent)).toEqual(messages.map(messageKey))
  })
})

describe('the queue entry', () => {
  it('imports only the shared contract, so the web app can use it without sharp or the queue SDK', () => {
    expect(specifiers('./vercel-queue.ts')).toEqual(['@cobweb/shared/render-queue'])
    expect(specifiers('../queue.ts')).toEqual(['./adapters/vercel-queue.ts'])
  })
})
```

- [ ] **Step 2: Run the test to see it fail**

Run: `pnpm --filter @cobweb/worker exec vitest run src/adapters/vercel-queue.test.ts`
Expected: FAIL, the module `./vercel-queue.ts` cannot be found.

- [ ] **Step 3: Write the adapter and the entry**

Create `services/worker/src/adapters/vercel-queue.ts`:

```ts
/**
 * The `RenderQueue` port on Vercel Queues (docs/specs/2026-10-13-render-worker-vercel.md, section 5).
 * It imports nothing from `@vercel/queue`: the caller passes the SDK's `send`, so the worker never
 * depends on the SDK and its tests never reach Vercel.
 */
import { messageKey, RENDER_RETENTION_SECONDS, RENDER_TOPIC } from '@cobweb/shared/render-queue'
import type { RenderMessage, RenderQueue } from '@cobweb/shared/render-queue'

/** The part of the SDK's `send` the adapter uses. */
export type QueueSender = {
  send(
    topic: string,
    body: unknown,
    options: { idempotencyKey: string; retentionSeconds: number },
  ): Promise<unknown>
}

/**
 * Sends messages one at a time, in order, each with its idempotency key and the longest retention. A
 * throw stops the rest and reaches the caller, whose step is then retried; the messages that went
 * through before it carry the same keys on the rerun, so the queue drops them.
 */
export function vercelRenderQueue(sender: QueueSender): RenderQueue {
  return {
    async send(messages: RenderMessage[]) {
      for (const message of messages)
        await sender.send(RENDER_TOPIC, message, {
          idempotencyKey: messageKey(message),
          retentionSeconds: RENDER_RETENTION_SECONDS,
        })
    },
  }
}
```

Replace the whole of `services/worker/src/queue.ts` with:

```ts
// The `@cobweb/worker/queue` entry: the Vercel Queues adapter alone, for the web app's queue module and
// the retry action. Nothing here imports sharp, the render library, Supabase, viem or the queue SDK.
export { vercelRenderQueue } from './adapters/vercel-queue.ts'
export type { QueueSender } from './adapters/vercel-queue.ts'
```

In `services/worker/src/index.ts`, after the line `export { sqsRenderQueue } from './adapters/sqs.ts'`, add:

```ts
export { vercelRenderQueue } from './adapters/vercel-queue.ts'
export type { QueueSender } from './adapters/vercel-queue.ts'
```

- [ ] **Step 4: Run the test to see it pass**

Run: `pnpm --filter @cobweb/worker exec vitest run src/adapters/vercel-queue.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Format, run the root checks and commit**

```bash
pnpm exec prettier --write services/worker/src/adapters/vercel-queue.ts services/worker/src/adapters/vercel-queue.test.ts services/worker/src/queue.ts services/worker/src/index.ts
pnpm typecheck && pnpm lint && pnpm test
git add services/worker/src/adapters/vercel-queue.ts services/worker/src/adapters/vercel-queue.test.ts services/worker/src/queue.ts services/worker/src/index.ts
git commit -m "$(cat <<'EOF'
Add the Vercel Queues adapter and make it the worker's queue entry

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KzWVSCKjsfbP9YKBetKHwW
EOF
)"
```

---

### Task 3: The queue consumer

**Files:**

- Create: `services/worker/src/vercel/consumer.ts`
- Create: `services/worker/src/vercel/consumer.test.ts`
- Modify: `services/worker/src/index.ts` (two lines added)

**Interfaces:**

- Consumes: `parseRenderMessage`, `RenderMessage` (shared); `handle`, `handleDead`, `Deps`, `DEAD_LETTER` (`steps.ts`); `consoleLog`, `errorSummary`, `Log` (`log.ts`); `harness`, `batchMessage`, `startMessage` (`testing/harness.ts`).
- Produces, from `@cobweb/worker`:
  - `const MAX_DELIVERIES = 3`, `const FIRST_RETRY_SECONDS = 120`, `const LATER_RETRY_SECONDS = 3600`
  - `type DeliveryMetadata = { messageId: string; deliveryCount: number }`
  - `class MessageFailed extends Error` with `static from(error: unknown): MessageFailed`
  - `function retryAfter(metadata: { deliveryCount: number }): { afterSeconds: number }`
  - `function queueConsumer(getDeps: () => Promise<Deps>, log?: Log): (body: unknown, metadata: DeliveryMetadata) => Promise<void>`

Delivery rules (spec section 6 and Decision 3): a body that is not a render message is logged and returned (acknowledged). Deliveries 1 and 2: run `handle`; a throw is logged and rethrown as `MessageFailed`. Delivery 3: run `handle`; a throw is logged and the message goes to `handleDead`, then the call returns. Delivery 4 and later (only reached when `handleDead` threw): straight to `handleDead`. A `handleDead` throw is logged and rethrown as `MessageFailed`. `getDeps` is called once and memoised; a failed build is dropped so the next message builds again.

- [ ] **Step 1: Write the failing test**

Create `services/worker/src/vercel/consumer.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { Log } from '../log.ts'
import { DEAD_LETTER } from '../steps.ts'
import type { Deps } from '../steps.ts'
import { batchMessage, harness, startMessage } from '../testing/harness.ts'
import {
  FIRST_RETRY_SECONDS,
  LATER_RETRY_SECONDS,
  MAX_DELIVERIES,
  queueConsumer,
  retryAfter,
} from './consumer.ts'

const meta = (deliveryCount: number) => ({ messageId: `m-${deliveryCount}`, deliveryCount })

/** A consumer over a claimed generative job, recording its log lines and how often it built its ports. */
async function setUp() {
  const h = await harness('generative', { claimed: true })
  const lines: string[] = []
  const fields: Record<string, unknown>[] = []
  const log: Log = (event, more = {}) => {
    lines.push(event)
    fields.push(more)
  }
  let builds = 0
  const consume = queueConsumer(async (): Promise<Deps> => {
    builds += 1
    return h.deps
  }, log)
  return { h, lines, fields, consume, builds: () => builds }
}

describe('retryAfter', () => {
  it('waits 120 seconds after the first delivery and an hour after any later one', () => {
    expect(FIRST_RETRY_SECONDS).toBe(120)
    expect(LATER_RETRY_SECONDS).toBe(3600)
    expect(retryAfter({ deliveryCount: 1 })).toEqual({ afterSeconds: 120 })
    expect(retryAfter({ deliveryCount: 2 })).toEqual({ afterSeconds: 3600 })
    expect(retryAfter({ deliveryCount: 3 })).toEqual({ afterSeconds: 3600 })
  })
})

describe('queueConsumer', () => {
  it('dead-letters on the third delivery', () => {
    expect(MAX_DELIVERIES).toBe(3)
  })

  it('acknowledges a body that is not a render message, without building its ports', async () => {
    const { consume, lines, builds } = await setUp()
    for (const body of [{ hello: 'world' }, 'start', undefined, null, { ...startMessage(), extra: 1 }])
      await expect(consume(body, meta(1))).resolves.toBeUndefined()
    expect(lines).toEqual(Array(5).fill('message ignored'))
    expect(builds()).toBe(0)
  })

  it('runs the step for a render message and resolves, so it is acknowledged', async () => {
    const { h, consume } = await setUp()
    await consume(batchMessage(0), meta(1))
    expect(h.jobs.rows[0]!.state).toBe('done')
  })

  it('rethrows a masked MessageFailed below the third delivery, never the original error', async () => {
    const { h, consume, lines, fields } = await setUp()
    h.jobs.batchStart = () => Promise.reject(new Error('request to https://user:key@rpc.example/v2 failed'))
    for (const delivery of [1, 2]) {
      const thrown = (await consume(batchMessage(0), meta(delivery)).catch((error: unknown) => error)) as Error
      expect(thrown.name).toBe('MessageFailed')
      expect(thrown.message).toBe('Error: request to [url] failed')
    }
    expect(lines).toEqual(['message failed', 'message failed'])
    expect(JSON.stringify(fields)).not.toContain('https://')
    expect(h.jobs.failures).toEqual([])
  })

  it('on the third delivery hands the message to handleDead and resolves, so it is acknowledged', async () => {
    const { h, consume, lines } = await setUp()
    h.jobs.batchStart = () => Promise.reject(new Error('storage down'))
    await expect(consume(batchMessage(0), meta(3))).resolves.toBeUndefined()
    expect(h.jobs.failures).toEqual([
      { index: 0, code: 'dead-letter', message: DEAD_LETTER, final: true, retries: 0 },
    ])
    expect(h.jobs.record.state).toBe('failed')
    expect(lines).toEqual(['message failed', 'message dead'])
  })

  it('rethrows when handleDead throws, and the next delivery reports without running the step again', async () => {
    const { h, consume, lines } = await setUp()
    let starts = 0
    h.jobs.batchStart = () => {
      starts += 1
      return Promise.reject(new Error('storage down'))
    }
    const fail = h.jobs.fail
    h.jobs.fail = () => Promise.reject(new Error('connection reset'))
    const thrown = (await consume(batchMessage(0), meta(3)).catch((error: unknown) => error)) as Error
    expect(thrown.name).toBe('MessageFailed')
    expect(thrown.message).toBe('Error: connection reset')
    h.jobs.fail = fail
    await expect(consume(batchMessage(0), meta(4))).resolves.toBeUndefined()
    expect(starts).toBe(1)
    expect(h.jobs.record.errorCode).toBe('dead-letter')
    expect(lines).toEqual(['message failed', 'dead letter failed', 'message dead'])
  })

  it('builds its ports once for many messages', async () => {
    const { consume, builds } = await setUp()
    await consume(batchMessage(0), meta(1))
    await consume(batchMessage(1), meta(1))
    expect(builds()).toBe(1)
  })

  it('builds its ports again after a failed build', async () => {
    const h = await harness('generative', { claimed: true })
    let calls = 0
    const consume = queueConsumer(
      async () => {
        calls += 1
        if (calls === 1) throw new Error('SUPABASE_URL is not set.')
        return h.deps
      },
      () => {},
    )
    await expect(consume(batchMessage(0), meta(1))).rejects.toThrow('SUPABASE_URL is not set.')
    await consume(batchMessage(0), meta(2))
    expect(calls).toBe(2)
    expect(h.jobs.rows[0]!.state).toBe('done')
  })
})
```

- [ ] **Step 2: Run the test to see it fail**

Run: `pnpm --filter @cobweb/worker exec vitest run src/vercel/consumer.test.ts`
Expected: FAIL, the module `./consumer.ts` cannot be found.

- [ ] **Step 3: Write the consumer**

Create `services/worker/src/vercel/consumer.ts`:

```ts
/**
 * The render queue's consumer on Vercel Queues (docs/specs/2026-10-13-render-worker-vercel.md,
 * section 6). The web app's route hands the function `queueConsumer` returns to the SDK's
 * `handleCallback`: a message is acknowledged when it returns and delivered again when it throws.
 * Vercel Queues has no dead-letter queue, so the third failed delivery is dead-lettered here.
 */
import { parseRenderMessage } from '@cobweb/shared/render-queue'
import type { RenderMessage } from '@cobweb/shared/render-queue'
import { consoleLog, errorSummary } from '../log.ts'
import type { Log } from '../log.ts'
import { handle, handleDead } from '../steps.ts'
import type { Deps } from '../steps.ts'

/** The delivery on which a message whose run throws is handed to `handleDead`. */
export const MAX_DELIVERIES = 3
/** The wait after a first failed delivery: a transient fault is tried again soon. */
export const FIRST_RETRY_SECONDS = 120
/**
 * The wait after any later failure. A fault that outlasted the quick retry is an outage or a bad
 * setting, and quick tries would dead-letter every message in flight and spend creators' retries.
 */
export const LATER_RETRY_SECONDS = 3600

/** The part of the SDK's message metadata the consumer reads. */
export type DeliveryMetadata = { messageId: string; deliveryCount: number }

/**
 * What the consumer throws: the failure's name and masked line only. The SDK and the runtime may print
 * a thrown error whole, and viem and storage errors can carry a URL with a key in it.
 */
export class MessageFailed extends Error {
  static from(error: unknown): MessageFailed {
    return new MessageFailed(errorSummary(error))
  }

  private constructor(summary: string) {
    super(summary)
    this.name = 'MessageFailed'
  }
}

/** The SDK's `retry` answer: 120 seconds after the first delivery, an hour after any later one. */
export function retryAfter(metadata: { deliveryCount: number }): { afterSeconds: number } {
  return { afterSeconds: metadata.deliveryCount <= 1 ? FIRST_RETRY_SECONDS : LATER_RETRY_SECONDS }
}

/** A body the SDK decoded, as a render message, or null for anything else. */
function asMessage(body: unknown): RenderMessage | null {
  let text: string | undefined
  try {
    text = JSON.stringify(body)
  } catch {
    return null
  }
  return typeof text === 'string' ? parseRenderMessage(text) : null
}

/**
 * The function the queue route hands to `handleCallback`. Its ports are built once per instance, on
 * the first render message; a failed build is tried again on the next message.
 */
export function queueConsumer(
  getDeps: () => Promise<Deps>,
  log: Log = consoleLog,
): (body: unknown, metadata: DeliveryMetadata) => Promise<void> {
  let pending: Promise<Deps> | null = null
  const deps = (): Promise<Deps> => {
    pending ??= getDeps().catch((error: unknown) => {
      pending = null
      throw error
    })
    return pending
  }
  return async (body, metadata) => {
    const message = asMessage(body)
    if (!message) {
      log('message ignored', { messageId: metadata.messageId })
      return
    }
    const fields = {
      messageId: metadata.messageId,
      jobId: message.jobId,
      step: message.step,
      delivery: metadata.deliveryCount,
    }
    // A delivery past the third comes back only because the dead-letter report threw: report again.
    if (metadata.deliveryCount <= MAX_DELIVERIES) {
      try {
        await handle(message, await deps())
        return
      } catch (error) {
        log('message failed', { ...fields, error: errorSummary(error) })
        if (metadata.deliveryCount < MAX_DELIVERIES) throw MessageFailed.from(error)
      }
    }
    try {
      await handleDead(message, await deps())
    } catch (error) {
      // The database could not be reached: the message comes back and the report is made then.
      log('dead letter failed', { ...fields, error: errorSummary(error) })
      throw MessageFailed.from(error)
    }
    log('message dead', fields)
  }
}
```

In `services/worker/src/index.ts`, after the two lines Task 2 added, add:

```ts
export {
  FIRST_RETRY_SECONDS,
  LATER_RETRY_SECONDS,
  MAX_DELIVERIES,
  MessageFailed,
  queueConsumer,
  retryAfter,
} from './vercel/consumer.ts'
export type { DeliveryMetadata } from './vercel/consumer.ts'
```

- [ ] **Step 4: Run the test to see it pass**

Run: `pnpm --filter @cobweb/worker exec vitest run src/vercel/consumer.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Format, run the root checks and commit**

```bash
pnpm exec prettier --write services/worker/src/vercel/consumer.ts services/worker/src/vercel/consumer.test.ts services/worker/src/index.ts
pnpm typecheck && pnpm lint && pnpm test
git add services/worker/src/vercel/consumer.ts services/worker/src/vercel/consumer.test.ts services/worker/src/index.ts
git commit -m "$(cat <<'EOF'
Add the render queue consumer that retries twice and dead-letters on the third delivery

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KzWVSCKjsfbP9YKBetKHwW
EOF
)"
```

---

### Task 4: The 600 MB batch ceiling

**Files:**

- Modify: `services/worker/src/steps.ts` (`MAX_BATCH_BYTES` and its comment)
- Modify: `services/worker/src/steps.test.ts` (the ceiling test)
- Modify: `services/worker/src/index.ts` (one export added)

**Interfaces:**

- Consumes: nothing new.
- Produces: `MAX_BATCH_BYTES = 600_000_000`, now also exported from `@cobweb/worker`.

No layer cache is added (spec section 8, decision 5): the render library already reads each distinct key once per batch (`services/render/src/batch.ts`, `cachedLoader`). The test count of `steps.test.ts` does not change.

- [ ] **Step 1: Write the failing test**

In `services/worker/src/steps.test.ts`, replace the ceiling test's first two lines:

```ts
  it('is 1.2 GB, with a plain sentence', () => {
    expect(MAX_BATCH_BYTES).toBe(1_200_000_000)
```

with:

```ts
  it('is 600 MB, with a plain sentence', () => {
    expect(MAX_BATCH_BYTES).toBe(600_000_000)
```

- [ ] **Step 2: Run the test to see it fail**

Run: `pnpm --filter @cobweb/worker exec vitest run src/steps.test.ts`
Expected: FAIL, "is 600 MB" receives `1200000000`.

- [ ] **Step 3: Lower the ceiling**

In `services/worker/src/steps.ts`, replace the `MAX_BATCH_BYTES` comment and constant with:

```ts
/**
 * The most bytes one pass-through batch (1/1 or single asset) may load, counted from what is really
 * read, not from the sizes the database holds: the lock sizes batches from `uploads.bytes`, a planning
 * number, to about 500 MB. A batch is held about 2.8 times over while it is packed, which the 4 GB
 * Performance instance takes at about 1.7 GB.
 */
export const MAX_BATCH_BYTES = 600_000_000
```

In `services/worker/src/index.ts`, add `MAX_BATCH_BYTES,` to the `export { ... } from './steps.ts'` list, after `handleDead,`.

- [ ] **Step 4: Run the test to see it pass**

Run: `pnpm --filter @cobweb/worker exec vitest run src/steps.test.ts`
Expected: PASS, same number of tests as before.

- [ ] **Step 5: Format, run the root checks and commit**

```bash
pnpm exec prettier --write services/worker/src/steps.ts services/worker/src/steps.test.ts services/worker/src/index.ts
pnpm typecheck && pnpm lint && pnpm test
git add services/worker/src/steps.ts services/worker/src/steps.test.ts services/worker/src/index.ts
git commit -m "$(cat <<'EOF'
Lower the worker's pass-through batch ceiling to 600 MB

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KzWVSCKjsfbP9YKBetKHwW
EOF
)"
```

---

### Task 5: Inject the queue into `productionDeps` and delete the AWS shell

**Files:**

- Modify: `services/worker/src/env.ts` (whole file below)
- Modify: `services/worker/src/env.test.ts` (whole file below)
- Modify: `services/worker/.env.example` (whole file below)
- Modify: `services/worker/src/index.ts` (whole file below)
- Modify: `services/worker/package.json`
- Modify (comments only): `services/worker/src/adapters/s3-store.ts`, `services/worker/src/log.ts`, `services/worker/src/local.ts`
- Rename: `services/worker/src/testing/stub-aws.ts` to `services/worker/src/testing/stub-s3.ts` (Decision 1), and its two users `services/worker/src/adapters/filebase.test.ts`, `services/worker/src/adapters/s3-store.test.ts`
- Delete: `services/worker/src/lambda/dead.ts`, `services/worker/src/lambda/deps.ts`, `services/worker/src/lambda/deps.test.ts`, `services/worker/src/lambda/entries.test.ts`, `services/worker/src/lambda/handler.ts`, `services/worker/src/lambda/lambda.test.ts`, `services/worker/src/lambda/render.ts`, `services/worker/src/lambda/sweep.ts`, `services/worker/src/adapters/sqs.ts`, `services/worker/src/adapters/sqs.test.ts`
- Modify: `pnpm-lock.yaml` (by `pnpm install`)

**Interfaces:**

- Consumes: `RenderQueue` (shared); the adapters and `PRODUCTION_RETRY` (unchanged).
- Produces, from `@cobweb/worker`:
  - `type DepsKind = 'render' | 'jobs'`
  - `type DepsOptions = { queue: RenderQueue; log?: Log; kind?: DepsKind }`
  - `function productionDeps(env: Env, options: DepsOptions): Deps`
  - `WORKER_ENV` without `RENDER_QUEUE_URL`
  - no `sqsRenderQueue`, no `SQS_BATCH`

The deleted test files held 43 tests (`sqs.test.ts` and the four in `lambda/`). `env.test.ts` gains 3.

- [ ] **Step 1: Write the failing tests**

Replace the whole of `services/worker/src/env.test.ts` with:

```ts
import { readFileSync } from 'node:fs'
import type { RenderQueue } from '@cobweb/shared/render-queue'
import { describe, expect, it } from 'vitest'
import { artS3Options, filebaseS3Options, need, productionDeps, WORKER_ENV } from './env.ts'

const LOCAL = {
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key-value',
  ART_S3_ENDPOINT: 'http://127.0.0.1:54321/storage/v1/s3',
  ART_S3_REGION: 'local',
  ART_S3_BUCKET: 'art',
  ART_S3_ACCESS_KEY_ID: 'art-key-id',
  ART_S3_SECRET_ACCESS_KEY: 'art-key-secret',
  ART_S3_FORCE_PATH_STYLE: '1',
  RENDER_S3_BUCKET: 'render',
  FILEBASE_BUCKET: 'cobweb-pins',
  FILEBASE_ACCESS_KEY_ID: 'filebase-key-id',
  FILEBASE_SECRET_ACCESS_KEY: 'filebase-key-secret',
}

/** The queue the wiring is given; nothing is sent in these tests. */
const queue: RenderQueue = { send: async () => {} }
const quiet = { queue, log: () => {} }

describe('the env names', () => {
  it('never start with NEXT_PUBLIC_', () => {
    for (const name of WORKER_ENV) expect(name.startsWith('NEXT_PUBLIC_')).toBe(false)
  })

  it('have no queue URL: the queue is passed in', () => {
    expect(WORKER_ENV).not.toContain('RENDER_QUEUE_URL')
  })

  it('are all in .env.example, which sets no secret and no public name', () => {
    const example = readFileSync(new URL('../.env.example', import.meta.url), 'utf8')
    const lines = example.split('\n').filter((line) => line && !line.startsWith('#'))
    const names = lines.map((line) => line.split('=')[0])
    for (const name of WORKER_ENV) expect(names, name).toContain(name)
    expect(names).toContain('RPC_URL_31337')
    expect(names).toContain('FACTORY_ADDRESS_31337')
    expect(names).not.toContain('RENDER_QUEUE_URL')
    expect(names).not.toContain('RENDER_SECRET_ARN')
    expect(example).not.toContain('NEXT_PUBLIC_SUPABASE')
    for (const line of lines)
      if (/KEY|SECRET|RPC_URL/.test(line.split('=')[0] ?? '')) expect(line.endsWith('=')).toBe(true)
  })
})

describe('need', () => {
  it('names the missing variable and never a value', () => {
    expect(need({ A: 'value' }, 'A')).toBe('value')
    expect(() => need({ A: '' }, 'A')).toThrow('A is not set.')
    expect(() => need({}, 'SUPABASE_SERVICE_ROLE_KEY')).toThrow('SUPABASE_SERVICE_ROLE_KEY is not set.')
  })
})

describe('artS3Options', () => {
  it('uses the endpoint, path style and keys of local storage, with the checksum settings that work there', () => {
    expect(artS3Options(LOCAL)).toEqual({
      region: 'local',
      endpoint: 'http://127.0.0.1:54321/storage/v1/s3',
      forcePathStyle: true,
      credentials: { accessKeyId: 'art-key-id', secretAccessKey: 'art-key-secret' },
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    })
  })

  it('leaves credentials to the SDK default chain when no keys are set', () => {
    expect(artS3Options({ ART_S3_REGION: 'us-east-1' })).toEqual({
      region: 'us-east-1',
      forcePathStyle: false,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    })
    expect(() => artS3Options({})).toThrow('ART_S3_REGION is not set.')
  })
})

describe('filebaseS3Options', () => {
  it('defaults to the documented endpoint and needs both keys', () => {
    expect(filebaseS3Options(LOCAL)).toEqual({
      region: 'us-east-1',
      endpoint: 'https://s3.filebase.com',
      forcePathStyle: true,
      credentials: { accessKeyId: 'filebase-key-id', secretAccessKey: 'filebase-key-secret' },
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    })
    expect(filebaseS3Options({ ...LOCAL, FILEBASE_S3_ENDPOINT: 'http://127.0.0.1:9000' }).endpoint).toBe(
      'http://127.0.0.1:9000',
    )
    expect(() => filebaseS3Options({})).toThrow('FILEBASE_ACCESS_KEY_ID is not set.')
  })
})

describe('productionDeps', () => {
  const JOBS_ONLY = {
    SUPABASE_URL: LOCAL.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: LOCAL.SUPABASE_SERVICE_ROLE_KEY,
  }

  it('builds every port without opening a connection', () => {
    const deps = productionDeps(LOCAL, quiet)
    expect(Object.keys(deps).sort()).toEqual(['chain', 'jobs', 'log', 'pinner', 'queue', 'retry', 'store'])
    expect(deps.retry?.delaysMs).toEqual([1000, 3000, 6000])
  })

  it('uses the queue it is given, for either kind', () => {
    expect(productionDeps(LOCAL, quiet).queue).toBe(queue)
    expect(productionDeps(JOBS_ONLY, { ...quiet, kind: 'jobs' }).queue).toBe(queue)
  })

  describe('for the sweep ("jobs")', () => {
    it('builds from the Supabase URL and key alone', () => {
      const deps = productionDeps(JOBS_ONLY, { ...quiet, kind: 'jobs' })
      expect(Object.keys(deps).sort()).toEqual(['chain', 'jobs', 'log', 'pinner', 'queue', 'retry', 'store'])
    })

    it('never requires storage, Filebase or chain settings, and does not compare the buckets', () => {
      expect(() => productionDeps(JOBS_ONLY, { ...quiet, kind: 'jobs' })).not.toThrow()
      expect(() => productionDeps(JOBS_ONLY, { ...quiet, kind: 'render' })).toThrow(
        'RENDER_S3_BUCKET is not set.',
      )
    })

    it('still names what it does need', () => {
      for (const name of Object.keys(JOBS_ONLY))
        expect(() => productionDeps({ ...JOBS_ONLY, [name]: undefined }, { ...quiet, kind: 'jobs' })).toThrow(
          `${name} is not set.`,
        )
    })

    it('gives the ports it cannot use an error named NotAvailable, not a quiet success', async () => {
      const deps = productionDeps(JOBS_ONLY, { ...quiet, kind: 'jobs' })
      const named = async (run: () => Promise<unknown>) =>
        ((await run().catch((error: unknown) => error)) as Error).name
      expect(await named(() => deps.store.load({ key: 'k.png', ext: 'png' }))).toBe('NotAvailable')
      expect(await named(() => deps.store.putCollage('k', new Uint8Array()))).toBe('NotAvailable')
      expect(await named(() => deps.pinner.pin(new Uint8Array(), 'cid'))).toBe('NotAvailable')
      expect(await named(() => deps.chain.jobPayment({} as never))).toBe('NotAvailable')
    })
  })

  it('refuses an incomplete environment by name, without echoing any value', () => {
    for (const name of ['SUPABASE_SERVICE_ROLE_KEY', 'RENDER_S3_BUCKET', 'FILEBASE_BUCKET']) {
      let message = ''
      try {
        productionDeps({ ...LOCAL, [name]: undefined }, quiet)
      } catch (error) {
        message = (error as Error).message
      }
      expect(message).toBe(`${name} is not set.`)
      for (const value of Object.values(LOCAL)) expect(message).not.toContain(value)
    }
  })

  it('refuses the art bucket as the render bucket, before building any client or reading anything else', () => {
    // Nothing else in this environment is set, so a client built first would fail on another name.
    const env = { ART_S3_BUCKET: 'art', RENDER_S3_BUCKET: 'art', ART_S3_REGION: 'local' }
    expect(() => productionDeps(env, quiet)).toThrow('RENDER_S3_BUCKET must not be the art bucket.')
    expect(() => productionDeps({ ...LOCAL, RENDER_S3_BUCKET: LOCAL.ART_S3_BUCKET }, quiet)).toThrow(
      'RENDER_S3_BUCKET must not be the art bucket.',
    )
  })
})

describe('the package', () => {
  it('has no SQS, Secrets Manager or Lambda package, and keeps the S3 client', () => {
    const source = readFileSync(new URL('./env.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/client-sqs|client-secrets-manager|aws-lambda/)
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      dependencies: Record<string, string>
      devDependencies: Record<string, string>
    }
    const names = [...Object.keys(manifest.dependencies), ...Object.keys(manifest.devDependencies)]
    expect(names).not.toContain('@aws-sdk/client-sqs')
    expect(names).not.toContain('@aws-sdk/client-secrets-manager')
    expect(names).not.toContain('@types/aws-lambda')
    expect(names).toContain('@aws-sdk/client-s3')
  })
})
```

- [ ] **Step 2: Run the test to see it fail**

Run: `pnpm --filter @cobweb/worker exec vitest run src/env.test.ts`
Expected: FAIL. "have no queue URL" fails (`RENDER_QUEUE_URL` is in the list), the `productionDeps` tests fail with `RENDER_QUEUE_URL is not set.`, and "the package" fails on `@aws-sdk/client-sqs`.

- [ ] **Step 3: Rewrite the wiring**

Replace the whole of `services/worker/src/env.ts` with:

```ts
/**
 * The worker's configuration (docs/specs/2026-10-12-render-worker.md, section 10, as changed by
 * docs/specs/2026-10-13-render-worker-vercel.md, section 10) and the production wiring of the ports.
 * Every value comes from the record passed in: the process environment, locally and on Vercel. None of
 * the names starts with NEXT_PUBLIC_, none is read by a browser, and no value is ever logged. The queue
 * is passed in, because its client belongs to the caller (on Vercel, the SDK's `send`).
 */
import { S3Client } from '@aws-sdk/client-s3'
import type { S3ClientConfig } from '@aws-sdk/client-s3'
import type { Env } from '@cobweb/shared'
import type { RenderQueue } from '@cobweb/shared/render-queue'
import { createClient } from '@supabase/supabase-js'
import { FILEBASE_ENDPOINT, filebasePinner } from './adapters/filebase.ts'
import { s3Store } from './adapters/s3-store.ts'
import { supabaseJobs } from './adapters/supabase-jobs.ts'
import type { WorkerClient } from './adapters/supabase-jobs.ts'
import { viemChain } from './adapters/viem-chain.ts'
import { consoleLog } from './log.ts'
import type { Log } from './log.ts'
import { PRODUCTION_RETRY } from './steps.ts'
import type { Deps } from './steps.ts'

/** The fixed names. `RPC_URL_<chainId>` and `FACTORY_ADDRESS_<chainId>` are read per chain. */
export const WORKER_ENV = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'ART_S3_ENDPOINT',
  'ART_S3_REGION',
  'ART_S3_BUCKET',
  'ART_S3_ACCESS_KEY_ID',
  'ART_S3_SECRET_ACCESS_KEY',
  'ART_S3_FORCE_PATH_STYLE',
  'RENDER_S3_BUCKET',
  'FILEBASE_S3_ENDPOINT',
  'FILEBASE_BUCKET',
  'FILEBASE_ACCESS_KEY_ID',
  'FILEBASE_SECRET_ACCESS_KEY',
] as const

/** A required value. The error names the variable and never a value. */
export function need(env: Env, name: string): string {
  const value = env[name]
  if (!value) throw new Error(`${name} is not set.`)
  return value
}

// The SDK's default checksums add headers that Supabase Storage and Filebase do not all accept; the
// web app's storage client turns them off the same way (apps/web/src/lib/storage/config.ts).
const CHECKSUMS = {
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
} as const

/**
 * The storage client's options: R2 in production (endpoint `https://<account id>.r2.cloudflarestorage.com`,
 * region `auto`, path style on), Supabase Storage locally. With no access key the SDK's default
 * credential chain applies.
 */
export function artS3Options(env: Env): S3ClientConfig {
  const accessKeyId = env.ART_S3_ACCESS_KEY_ID
  const secretAccessKey = env.ART_S3_SECRET_ACCESS_KEY
  return {
    region: need(env, 'ART_S3_REGION'),
    ...(env.ART_S3_ENDPOINT ? { endpoint: env.ART_S3_ENDPOINT } : {}),
    forcePathStyle: env.ART_S3_FORCE_PATH_STYLE === '1',
    ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
    ...CHECKSUMS,
  }
}

export function filebaseS3Options(env: Env): S3ClientConfig {
  return {
    region: 'us-east-1',
    endpoint: env.FILEBASE_S3_ENDPOINT || FILEBASE_ENDPOINT,
    forcePathStyle: true,
    credentials: {
      accessKeyId: need(env, 'FILEBASE_ACCESS_KEY_ID'),
      secretAccessKey: need(env, 'FILEBASE_SECRET_ACCESS_KEY'),
    },
    ...CHECKSUMS,
  }
}

/** The service-role client the worker owns. No session is kept. */
export function workerClient(env: Env): WorkerClient {
  return createClient(need(env, 'SUPABASE_URL'), need(env, 'SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

/** Which route the ports are for: the queue consumer renders; the sweep only ever uses "jobs". */
export type DepsKind = 'render' | 'jobs'

export type DepsOptions = { queue: RenderQueue; log?: Log; kind?: DepsKind }

/** A port a route does not use: it fails loudly, by name, if it is ever called. */
class NotAvailable extends Error {
  constructor(what: string) {
    super(`${what} is not available in this function.`)
    this.name = 'NotAvailable'
  }
}

/**
 * Every port on its production adapter, around the queue the caller passes. Building it opens no
 * connection. For "jobs" (the sweep) only the jobs, queue and log ports are built, from the Supabase
 * URL and service key; storage, the pinning service and the chain are ports that throw.
 */
export function productionDeps(env: Env, options: DepsOptions): Deps {
  const { queue, log = consoleLog, kind = 'render' } = options
  // For rendering, checked before any client is built. The upload sweep deletes every object in the
  // art bucket that no upload row records, so a collage written there would be swept away.
  if (kind === 'render' && need(env, 'RENDER_S3_BUCKET') === need(env, 'ART_S3_BUCKET'))
    throw new Error('RENDER_S3_BUCKET must not be the art bucket.')
  const jobs = supabaseJobs(workerClient(env), { log })
  if (kind === 'jobs') {
    const unused = (what: string) => () => Promise.reject(new NotAvailable(what))
    return {
      jobs,
      queue,
      log,
      store: { load: unused('Storage'), putCollage: unused('Storage') },
      pinner: { pin: unused('The pinning service') },
      chain: { jobPayment: unused('The chain') },
      retry: PRODUCTION_RETRY,
    }
  }
  // Both buckets sit behind one client: R2 in production and Supabase Storage locally each serve both
  // from one endpoint with one key pair.
  const storage = new S3Client(artS3Options(env))
  return {
    jobs,
    store: s3Store(
      { client: storage, bucket: need(env, 'ART_S3_BUCKET') },
      { client: storage, bucket: need(env, 'RENDER_S3_BUCKET') },
    ),
    pinner: filebasePinner(new S3Client(filebaseS3Options(env)), need(env, 'FILEBASE_BUCKET')),
    chain: viemChain(env),
    queue,
    log,
    retry: PRODUCTION_RETRY,
  }
}
```

Replace the whole of `services/worker/.env.example` with:

```
# The render worker's configuration. Server only: none of these is read by a browser, none starts
# with NEXT_PUBLIC_, and no value is printed or logged. Every value below is a placeholder, and a name
# marked "secret" is left empty here: fill it in a local .env, never in this file.
#
# On Vercel the worker runs inside apps/web and reads these names from the web app's environment
# (apps/web/.env.example; services/worker/README.md lists the project settings). The web app has no
# SUPABASE_URL of its own: its worker routes pass NEXT_PUBLIC_SUPABASE_URL under that name.
#
# Nothing here is read by `pnpm --filter @cobweb/web verify:render`. It takes its Supabase and storage
# settings from `supabase status` and the two chain names (RPC_URL_31337, FACTORY_ADDRESS_31337) from
# apps/web/.env.local, and runs the worker on a folder for the pinning service and a queue in memory.

# Supabase: the project URL, and the service-role key (secret).
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=

# The art bucket, read only. Local: Supabase Storage (STORAGE_S3_URL, S3_PROTOCOL_REGION and the S3
# protocol keys from `supabase status -o env`), bucket "art", path style on. Production: Cloudflare R2
# through https://<account id>.r2.cloudflarestorage.com, region "auto", path style on, one API token
# with object read and write on both buckets. The two keys are secret.
ART_S3_ENDPOINT=
ART_S3_REGION=auto
ART_S3_BUCKET=art
ART_S3_ACCESS_KEY_ID=
ART_S3_SECRET_ACCESS_KEY=
ART_S3_FORCE_PATH_STYLE=1

# The render bucket, for preview collages, behind the same endpoint and keys. It must not be the art
# bucket. Local: the "render" bucket in Supabase Storage, created by `supabase seed buckets`.
RENDER_S3_BUCKET=render

# Filebase. The endpoint defaults to https://s3.filebase.com. The two keys are secret.
FILEBASE_S3_ENDPOINT=
FILEBASE_BUCKET=your-filebase-ipfs-bucket
FILEBASE_ACCESS_KEY_ID=
FILEBASE_SECRET_ACCESS_KEY=

# One pair per chain a job can be paid on: the RPC URL (secret) and the factory address, as in
# apps/web/.env.example. 31337 is the local Anvil chain.
RPC_URL_31337=
FACTORY_ADDRESS_31337=0x0000000000000000000000000000000000000000
```

Replace the whole of `services/worker/src/index.ts` with:

```ts
export * from './ports.ts'
export { consoleLog, errorSummary } from './log.ts'
export type { Log } from './log.ts'
export { imageRef, renderSpec, tokenSlice } from './spec.ts'
export {
  CID_MISMATCH,
  DEAD_LETTER,
  handle,
  handleDead,
  MAX_BATCH_BYTES,
  PAYMENT_MISMATCH,
  PRODUCTION_RETRY,
  RESULT_DIFFERS,
  sweep,
  STUCK_MINUTES,
  STUCK_MINUTES_BUSY,
} from './steps.ts'
export type { Deps, Retry } from './steps.ts'
export { supabaseJobs } from './adapters/supabase-jobs.ts'
export type { WorkerClient } from './adapters/supabase-jobs.ts'
export { s3Store } from './adapters/s3-store.ts'
export { viemChain } from './adapters/viem-chain.ts'
export { filebasePinner } from './adapters/filebase.ts'
export { vercelRenderQueue } from './adapters/vercel-queue.ts'
export type { QueueSender } from './adapters/vercel-queue.ts'
export {
  FIRST_RETRY_SECONDS,
  LATER_RETRY_SECONDS,
  MAX_DELIVERIES,
  MessageFailed,
  queueConsumer,
  retryAfter,
} from './vercel/consumer.ts'
export type { DeliveryMetadata } from './vercel/consumer.ts'
export { artS3Options, productionDeps, WORKER_ENV, workerClient } from './env.ts'
export type { DepsKind, DepsOptions } from './env.ts'
```

In `services/worker/package.json`, delete these three lines (and the trailing comma they leave if any):

```json
    "@aws-sdk/client-secrets-manager": "3.1147.0",
    "@aws-sdk/client-sqs": "3.1147.0",
```

```json
    "@types/aws-lambda": "^8.10.164",
```

- [ ] **Step 4: Delete the AWS shell and rename the S3 stand-in**

```bash
git rm services/worker/src/lambda/dead.ts services/worker/src/lambda/deps.ts services/worker/src/lambda/deps.test.ts services/worker/src/lambda/entries.test.ts services/worker/src/lambda/handler.ts services/worker/src/lambda/lambda.test.ts services/worker/src/lambda/render.ts services/worker/src/lambda/sweep.ts services/worker/src/adapters/sqs.ts services/worker/src/adapters/sqs.test.ts
git mv services/worker/src/testing/stub-aws.ts services/worker/src/testing/stub-s3.ts
sed -i '' -e 's#../testing/stub-aws.ts#../testing/stub-s3.ts#' -e 's/stubAws/stubS3/g' services/worker/src/adapters/filebase.test.ts services/worker/src/adapters/s3-store.test.ts services/worker/src/testing/stub-s3.ts
sed -i '' -e 's#A stand-in for an AWS SDK client in adapter tests#A stand-in for an S3 client in adapter tests#' services/worker/src/testing/stub-s3.ts
pnpm install
```

Expected: `git grep -n "stubAws\|stub-aws\|sqs\|aws-lambda\|secrets-manager" -- services/worker` prints nothing. `pnpm install` removes the two SDK packages and the Lambda types from `pnpm-lock.yaml`.

- [ ] **Step 5: Fix the comments that describe the deleted pieces**

- `services/worker/src/adapters/s3-store.ts` line 2: replace `(AWS in production, Supabase Storage locally)` with `(Cloudflare R2 in production, Supabase Storage locally)`.
- `services/worker/src/log.ts`: replace `/** Writes each line as one JSON object, which CloudWatch indexes by field. */` with `/** Writes each line as one JSON object, which Vercel's logs show by field. */`, and in the `errorSummary` comment replace `viem and AWS errors` with `viem and storage errors`.
- `services/worker/src/local.ts` lines 2 and 3: replace `drains an in-memory queue\n * the way SQS and the Lambdas would, so the whole pipeline runs without AWS.` with `drains an in-memory queue\n * the way Vercel Queues and the queue consumer would, so the whole pipeline runs locally.` (keep the rest of the comment).

- [ ] **Step 6: Run the tests to see them pass**

Run: `pnpm --filter @cobweb/worker test`
Expected: PASS. The 43 deleted tests are gone and `env.test.ts` has 3 more; no file fails.

- [ ] **Step 7: Format, run the root checks and commit**

```bash
pnpm exec prettier --write services/worker/src/env.ts services/worker/src/env.test.ts services/worker/src/index.ts services/worker/package.json services/worker/src/testing/stub-s3.ts services/worker/src/adapters/filebase.test.ts services/worker/src/adapters/s3-store.test.ts services/worker/src/adapters/s3-store.ts services/worker/src/log.ts services/worker/src/local.ts
pnpm typecheck && pnpm lint && pnpm test
git add -A services/worker pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
Pass the queue into productionDeps and delete the Lambda entry points, the SQS adapter and the Secrets Manager loader

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KzWVSCKjsfbP9YKBetKHwW
EOF
)"
```

---

### Task 6: One sweep threshold and no backlog

**Files:**

- Modify: `packages/shared/src/render-queue.ts` (`RenderQueue`)
- Modify: `packages/shared/src/render-queue.test.ts` (one test added)
- Modify: `services/worker/src/steps.ts` (`STUCK_MINUTES_BUSY` and the sweep)
- Modify: `services/worker/src/steps.test.ts` (the sweep blocks)
- Modify: `services/worker/src/doubles/memory-queue.ts`
- Modify: `services/worker/src/doubles/doubles.test.ts` (one block removed)
- Modify: `services/worker/src/index.ts` (one line removed)

**Interfaces:**

- Produces: `type RenderQueue = { send(messages: RenderMessage[]): Promise<void> }`; `sweep(deps)` always calls `jobs.stuck(STUCK_MINUTES)`; `STUCK_MINUTES_BUSY` no longer exists.

Test counts: `steps.test.ts` loses the six tests of `describe('sweep and the queue backlog')` and gains two; `doubles.test.ts` loses one; `render-queue.test.ts` gains one (49 in `@cobweb/shared`).

- [ ] **Step 1: Write the failing tests**

In `packages/shared/src/render-queue.test.ts`, add inside `describe('the module', ...)`:

```ts
  it('has no backlog: duplicates are stopped by idempotency keys, not by reading the queue', () => {
    const source = readFileSync(new URL('./render-queue.ts', import.meta.url), 'utf8')
    expect(source).not.toContain('backlog')
  })
```

In `services/worker/src/steps.test.ts`:

1. Remove `STUCK_MINUTES_BUSY,` from the import list from `./steps.ts`.
2. Delete the whole block `describe('sweep and the queue backlog', () => { ... })` and put in its place:

```ts
describe('the sweep threshold', () => {
  it('is 15 minutes', () => {
    expect(STUCK_MINUTES).toBe(15)
  })

  it('asks for 15 minutes even with messages waiting in the queue', async () => {
    const h = await harness()
    await h.queue.send([startMessage(0), batchMessage(0)])
    const minutes: number[] = []
    h.jobs.stuck = async (threshold) => {
      minutes.push(threshold)
      return []
    }
    await sweep(h.deps)
    expect(minutes).toEqual([15])
  })
})
```

3. In the test `'re-enqueues a job at most once per threshold: a second sweep straight after finds nothing'`, delete these two lines:

```ts
    // The queue reads as idle, so the threshold is 15 minutes (the memory queue would count its own start).
    h.deps.queue = { ...h.queue, backlog: async () => 0 }
```

In `services/worker/src/doubles/doubles.test.ts`, delete the whole block `describe('memoryQueue backlog', () => { ... })`.

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @cobweb/shared exec vitest run src/render-queue.test.ts && pnpm --filter @cobweb/worker exec vitest run src/steps.test.ts`
Expected: FAIL. The shared "has no backlog" test fails (the word is in the source); "asks for 15 minutes even with messages waiting" receives `[120]`.

- [ ] **Step 3: Remove the busy branch and the backlog**

In `packages/shared/src/render-queue.ts`, replace:

```ts
/**
 * Where messages go: SQS in production, an in-memory queue locally. `backlog` is how many messages
 * are waiting to be received; a queue that cannot tell leaves it out.
 */
export type RenderQueue = {
  send(messages: RenderMessage[]): Promise<void>
  backlog?: () => Promise<number>
}
```

with:

```ts
/**
 * Where messages go: Vercel Queues in production (the worker's `vercelRenderQueue`), an in-memory
 * queue locally. Each message is sent with `messageKey(message)` as its idempotency key.
 */
export type RenderQueue = {
  send(messages: RenderMessage[]): Promise<void>
}
```

In `services/worker/src/steps.ts`, replace everything from the comment above `export const STUCK_MINUTES_BUSY = 120` to the end of the file with:

```ts
/**
 * Re-enqueues a start message for each job left `rendering` or `finalizing`, or left `paid` or
 * `waived` and never claimed, with nothing touched for 15 minutes. The start step then claims an
 * unclaimed job, re-sends the open batches of a `rendering` one, or sends `metadata` for a
 * `finalizing` one. The message carries the job's key (`messageKey`), so a start the queue already
 * took within the last day is dropped as a duplicate instead of being run twice.
 */
export async function sweep(deps: Deps): Promise<number> {
  const jobs = await deps.jobs.stuck(STUCK_MINUTES)
  for (const job of jobs) {
    await enqueueRender(deps.queue, job)
    // Only after the send went through: a failed send leaves the job eligible for the next sweep.
    // Without this a job is returned on every sweep until something updates its row.
    try {
      await deps.jobs.touch(job.id)
    } catch (error) {
      deps.log('touch failed', { jobId: job.id, error: errorSummary(error) })
    }
  }
  deps.log('sweep', { requeued: jobs.length })
  return jobs.length
}
```

Keep the `STUCK_MINUTES` constant and its comment above this, unchanged.

In `services/worker/src/doubles/memory-queue.ts`, delete:

```ts
    async backlog() {
      return waiting.length
    },
```

and in the comment above `memoryQueue`, replace `with the delivery rules of SQS that matter to the worker` with `with the delivery rules that matter to the worker`.

In `services/worker/src/index.ts`, delete the line `  STUCK_MINUTES_BUSY,`.

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm --filter @cobweb/shared test && pnpm --filter @cobweb/worker test`
Expected: PASS. `git grep -n "backlog\|STUCK_MINUTES_BUSY" -- packages services apps/web/src apps/web/scripts` prints nothing.

- [ ] **Step 5: Format, run the root checks and commit**

```bash
pnpm exec prettier --write packages/shared/src/render-queue.ts packages/shared/src/render-queue.test.ts services/worker/src/steps.ts services/worker/src/steps.test.ts services/worker/src/doubles/memory-queue.ts services/worker/src/doubles/doubles.test.ts services/worker/src/index.ts
pnpm typecheck && pnpm lint && pnpm test
git add packages/shared/src/render-queue.ts packages/shared/src/render-queue.test.ts services/worker/src/steps.ts services/worker/src/steps.test.ts services/worker/src/doubles/memory-queue.ts services/worker/src/doubles/doubles.test.ts services/worker/src/index.ts
git commit -m "$(cat <<'EOF'
Drop the queue backlog and give the sweep one 15 minute threshold

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KzWVSCKjsfbP9YKBetKHwW
EOF
)"
```

---

### Task 7: The 500 MB asset batch target

**Files:**

- Create: `supabase/migrations/20261013010000_asset_batch_target.sql`
- Modify: `apps/web/scripts/verify-local.ts:3144-3161` (two batch-size checks)

**Interfaces:**

- Consumes: the trigger `render_jobs_size_asset_batches` and its function from `supabase/migrations/20261012020000_asset_batch_size.sql`.
- Produces: the same function with a 500,000,000 byte target. The trigger is unchanged.

Numbers: a 1/1 job of 45 tokens whose largest file is 52,428,800 bytes gets `batch_size` floor(500,000,000 / 52,428,800) = 9 and `batches_total` ceil(45 / 9) = 5. Five distinct files of that size are 262,144,000 bytes, under 500 MB, so they keep 100 tokens a batch.

This task needs local Supabase running (Global Constraints). It applies one migration and never resets the database.

- [ ] **Step 1: Change the verify-local checks first**

In `apps/web/scripts/verify-local.ts`, replace:

```ts
  await check(
    'render_jobs: a 1/1 job with a 50 MiB file gets 19 tokens a batch and the batch count to match',
    async () => {
      const job = await lockedOneOfOne(A, 45, 50 * 1024 * 1024)
      // floor(1,000,000,000 / 52,428,800) = 19; ceil(45 / 19) = 3.
      return job.batch_size === 19 && job.batches_total === 3 && job.token_count === 45
```

with:

```ts
  await check(
    'render_jobs: a 1/1 job with a 50 MiB file gets 9 tokens a batch and the batch count to match',
    async () => {
      const job = await lockedOneOfOne(A, 45, 50 * 1024 * 1024)
      // floor(500,000,000 / 52,428,800) = 9; ceil(45 / 9) = 5.
      return job.batch_size === 9 && job.batches_total === 5 && job.token_count === 45
```

and replace the comment line:

```ts
      // Five distinct files, the largest 50 MiB: at most 5 x 52,428,800 bytes in a batch, under 1 GB.
```

with:

```ts
      // Five distinct files, the largest 50 MiB: at most 5 x 52,428,800 = 262,144,000 bytes, under 500 MB.
```

- [ ] **Step 2: Run verify:local to see the changed check fail**

Run: `pnpm --filter @cobweb/web verify:local`
Expected: one FAIL, `render_jobs: a 1/1 job with a 50 MiB file gets 9 tokens a batch ...`, printing a job with `batch_size` 19 and `batches_total` 3. Every other check passes.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261013010000_asset_batch_target.sql`:

```sql
-- Asset batches target 500 MB (docs/specs/2026-10-13-render-worker-vercel.md, section 9). Was 1 GB in
-- 20261012020000_asset_batch_size.sql. Marketplaces cache and cap video assets at around 5 to 10 MB,
-- so 1 GB batches were far above need, and the render worker now runs on a 4 GB Vercel Function whose
-- ceiling for one pass-through batch is 600 MB of files. The trigger is unchanged; only the function's
-- target moves.
--
-- The size at lock is still a planning number: uploads.bytes is what record_upload was told. The
-- worker's batch step adds up the bytes it really loads and fails the job with batch-too-large past
-- its own ceiling.
--
-- The function stays security invoker: every insert into render_jobs comes from art_lock or
-- art_lock_placeholder, both security definer functions, so it runs as their owner and reads uploads
-- without any extra grant. A role that could not read the rows would see no upload and leave the
-- sizes as they were; render_jobs has no insert grant for clients, so there is none.

create or replace function private.render_jobs_size_asset_batches()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_max_bytes bigint;
  v_files bigint;
begin
  if new.kind <> 'real' or new.token_list is null then
    return new;
  end if;
  select max(u.bytes), count(*) into v_max_bytes, v_files
  from public.uploads u
  where u.collection_id = new.collection_id
    and u.id in (
      select (entry ->> 'uploadId')::uuid from jsonb_array_elements(new.token_list) as entry
    );
  if v_max_bytes is null then
    return new;
  end if;
  -- A batch holds each distinct file once, however many tokens share it (a single asset, or
  -- editions of a few files). When every distinct file together stays under the target, the
  -- default of 100 tokens a batch is already safe.
  if v_files * v_max_bytes <= 500000000 then
    return new;
  end if;
  new.batch_size := greatest(1, least(100, floor(500000000::numeric / v_max_bytes)))::integer;
  new.batches_total := ceil(new.token_count::numeric / new.batch_size)::integer;
  return new;
end;
$$;

revoke all on function private.render_jobs_size_asset_batches() from public, anon, authenticated;
```

- [ ] **Step 4: Apply it and run verify:local to see it pass**

```bash
supabase migration up --local
pnpm --filter @cobweb/web verify:local
```

Expected: the migration applies with no error, and verify:local ends with the same number of PASS lines as before this task and `0 failed`. Then run `pnpm --filter @cobweb/web verify:render` once: it sets its own batch size and must still end `19 passed, 0 failed`.

- [ ] **Step 5: Format, run the root checks and commit**

```bash
pnpm exec prettier --write apps/web/scripts/verify-local.ts
pnpm typecheck && pnpm lint && pnpm test
git add supabase/migrations/20261013010000_asset_batch_target.sql apps/web/scripts/verify-local.ts
git commit -m "$(cat <<'EOF'
Size 1/1 and single asset batches to 500 MB at lock

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KzWVSCKjsfbP9YKBetKHwW
EOF
)"
```

---

### Task 8: The web app's queue and the start message at payment and at a waived lock

**Files:**

- Create: `apps/web/src/lib/render/start.ts`, `apps/web/src/lib/render/start.test.ts`
- Create: `apps/web/src/lib/render/queue.ts`, `apps/web/src/lib/render/queue.test.ts`
- Modify: `apps/web/src/lib/art/lock-core.ts` (`LockContext`, `lockCore`, `lockPlaceholderCore`, `confirmCore`)
- Modify: `apps/web/src/lib/art/lock-write.ts`
- Modify: `apps/web/scripts/verify-chain.ts` (`contextFor`, four checks)
- Modify: `apps/web/scripts/verify-render.ts` (`contextFor`, two comments)
- Modify: `apps/web/package.json`, `pnpm-lock.yaml`

**Interfaces:**

- Consumes: `enqueueRender`, `RenderQueue`, `RenderMessage` (shared); `vercelRenderQueue`, `QueueSender` from `@cobweb/worker/queue` (Task 2); `send` from `@vercel/queue`.
- Produces:
  - `startRender(queue: RenderQueue, jobId: string, log?: (line: string) => void): Promise<void>` in `@/lib/render/start`
  - `startIfWaived(queue: RenderQueue, job: { id: string; state: string }, log?: (line: string) => void): Promise<void>` in `@/lib/render/start`
  - `renderQueue(env?: Record<string, string | undefined>, log?: (line: string) => void): RenderQueue` in `@/lib/render/queue`
  - `LockContext.queue: RenderQueue`

This task needs local Supabase and Anvil running for `verify:chain` and `verify:render` (Global Constraints). Decision 6 explains why the send is its own module; Decision 13 why a waived lock sends too (spec decision 8 and section 7). A single asset lock is the only lock that comes back `waived`; no verify script locks one, so the waived path is covered by the unit tests and the `payment_due` path also by verify:chain.

- [ ] **Step 1: Add the dependencies**

In `apps/web/package.json`, delete `"@cobweb/worker": "workspace:^",` from `devDependencies`, and add to `dependencies`, keeping alphabetical order:

```json
    "@cobweb/render": "workspace:^",
    "@cobweb/worker": "workspace:^",
    "@vercel/queue": "0.8.0",
```

Run: `pnpm install`
Expected: `@vercel/queue@0.8.0` is installed under `apps/web/node_modules/@vercel/queue`, and `pnpm-lock.yaml` records it with the exact version.

- [ ] **Step 2: Write the failing tests**

Create `apps/web/src/lib/render/start.test.ts`:

```ts
import type { RenderMessage, RenderQueue } from '@cobweb/shared/render-queue'
import { describe, expect, it } from 'vitest'
import { startIfWaived, startRender } from './start'

const JOB = '3f0c2f5e-8a51-4c0e-9d7b-0d0f5a3b9c11'

/** A queue that keeps what is sent. */
function recording() {
  const sent: RenderMessage[][] = []
  const queue: RenderQueue = { send: async (messages) => void sent.push(messages) }
  return { sent, queue }
}

describe('startRender', () => {
  it('sends one start message with retries 0', async () => {
    const sent: RenderMessage[][] = []
    await startRender({ send: async (messages) => void sent.push(messages) }, JOB, () => {})
    expect(sent).toEqual([[{ jobId: JOB, step: 'start', retries: 0 }]])
  })

  it('swallows a failed send and logs the job id with the error name only', async () => {
    const lines: string[] = []
    const queue: RenderQueue = {
      send: () => Promise.reject(new TypeError('fetch failed https://queue.example/?token=abc')),
    }
    await expect(startRender(queue, JOB, (line) => lines.push(line))).resolves.toBeUndefined()
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain(JOB)
    expect(lines[0]).toContain('TypeError')
    expect(lines[0]).not.toContain('https://')
    expect(lines[0]).not.toContain('token')
  })
})

describe('startIfWaived', () => {
  it('starts a waived job at lock and nothing else', async () => {
    const waived = recording()
    await startIfWaived(waived.queue, { id: JOB, state: 'waived' }, () => {})
    expect(waived.sent).toEqual([[{ jobId: JOB, step: 'start', retries: 0 }]])
    for (const state of ['payment_due', 'paid', 'locked']) {
      const other = recording()
      await startIfWaived(other.queue, { id: JOB, state }, () => {})
      expect(other.sent).toEqual([])
    }
  })

  it('returns normally when the send at lock fails, and logs the job id', async () => {
    const lines: string[] = []
    const queue: RenderQueue = { send: () => Promise.reject(new Error('queue down')) }
    await expect(
      startIfWaived(queue, { id: JOB, state: 'waived' }, (line) => lines.push(line)),
    ).resolves.toBeUndefined()
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain(JOB)
  })

  it('starts a waived placeholder job at lock and nothing else', async () => {
    const waived = recording()
    await startIfWaived(waived.queue, { id: JOB, state: 'waived' }, () => {})
    expect(waived.sent).toEqual([[{ jobId: JOB, step: 'start', retries: 0 }]])
    for (const state of ['locked', 'payment_due', 'rendering']) {
      const other = recording()
      await startIfWaived(other.queue, { id: JOB, state }, () => {})
      expect(other.sent).toEqual([])
    }
  })
})
```

Create `apps/web/src/lib/render/queue.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderQueue } from './queue'

const sdk = vi.hoisted(() => ({
  send: vi.fn<(topic: string, body: unknown, options: unknown) => Promise<{ messageId: string }>>(
    async () => ({ messageId: 'm-1' }),
  ),
}))
vi.mock('@vercel/queue', () => ({ send: sdk.send }))

const JOB = '3f0c2f5e-8a51-4c0e-9d7b-0d0f5a3b9c11'
const start = { jobId: JOB, step: 'start', retries: 0 } as const

describe('renderQueue', () => {
  beforeEach(() => sdk.send.mockClear())

  it('on Vercel, sends through the SDK to the render topic with the key and seven days of retention', async () => {
    await renderQueue({ VERCEL: '1' }, () => {}).send([start])
    expect(sdk.send).toHaveBeenCalledTimes(1)
    expect(sdk.send).toHaveBeenCalledWith('render', start, {
      idempotencyKey: `${JOB}:start:0`,
      retentionSeconds: 604_800,
    })
  })

  it('anywhere else, logs that the render was not queued and sends nothing', async () => {
    const lines: string[] = []
    await renderQueue({}, (line) => lines.push(line)).send([start])
    expect(lines).toEqual([`render not queued (no queue here): job ${JOB}`])
    expect(sdk.send).not.toHaveBeenCalled()
  })

  it('treats an empty VERCEL as not on Vercel', async () => {
    const lines: string[] = []
    await renderQueue({ VERCEL: '' }, (line) => lines.push(line)).send([start])
    expect(lines).toHaveLength(1)
    expect(sdk.send).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `pnpm --filter @cobweb/web exec vitest run src/lib/render/start.test.ts src/lib/render/queue.test.ts`
Expected: FAIL, the modules `./start` and `./queue` cannot be found.

- [ ] **Step 4: Write the two modules**

Create `apps/web/src/lib/render/start.ts`:

```ts
import { enqueueRender, type RenderQueue } from '@cobweb/shared/render-queue'

/**
 * Sends a newly paid job's start message (docs/specs/2026-10-13-render-worker-vercel.md, section 7).
 * A failed send is logged with the job id and the error's name and swallowed: the payment is already
 * recorded, and the sweep starts the job within 15 minutes. The error's message is left out, because
 * it can carry a URL with a token in it.
 */
export async function startRender(
  queue: RenderQueue,
  jobId: string,
  log: (line: string) => void = console.error,
): Promise<void> {
  try {
    await enqueueRender(queue, { id: jobId, retries: 0 })
  } catch (error) {
    const name = error instanceof Error ? error.name : 'Unknown error'
    log(`The render of job ${jobId} was not queued (${name}); the sweep will start it.`)
  }
}

/**
 * Starts a job the lock returned already `waived` (a single asset, which pays nothing): there is no
 * payment step to send its start message. Any other state sends nothing; a `payment_due` job is
 * started when its payment is recorded.
 */
export async function startIfWaived(
  queue: RenderQueue,
  job: { id: string; state: string },
  log: (line: string) => void = console.error,
): Promise<void> {
  if (job.state === 'waived') await startRender(queue, job.id, log)
}
```

Create `apps/web/src/lib/render/queue.ts`:

```ts
import type { RenderQueue } from '@cobweb/shared/render-queue'
import { vercelRenderQueue } from '@cobweb/worker/queue'
import { send } from '@vercel/queue'

/**
 * The queue the web app sends render messages to (docs/specs/2026-10-13-render-worker-vercel.md,
 * section 7). On Vercel, the `render` topic through the SDK's `send`, whose default client reads its
 * credentials from the Vercel environment. Anywhere else (local development, the verify scripts, which
 * drive the local runner themselves) a queue that logs and sends nothing, so nothing ever reaches Vercel.
 */
export function renderQueue(
  env: Record<string, string | undefined> = process.env,
  log: (line: string) => void = console.log,
): RenderQueue {
  if (env.VERCEL) return vercelRenderQueue({ send })
  return {
    async send(messages) {
      for (const message of messages) log(`render not queued (no queue here): job ${message.jobId}`)
    },
  }
}
```

If `pnpm typecheck` later reports that the SDK's `send` is not assignable to `QueueSender`, pass `{ send: (topic, body, options) => send(topic, body, options) }` instead of `{ send }`; do not change `QueueSender`.

- [ ] **Step 5: Run the tests to see them pass**

Run: `pnpm --filter @cobweb/web exec vitest run src/lib/render/start.test.ts src/lib/render/queue.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Send the start message from the pay flow and from a waived lock**

In `apps/web/src/lib/art/lock-core.ts`:

1. Change the first `@cobweb/shared` import to also bring the type:

```ts
import {
  chainById,
  confirmationsFor,
  factoryAbi,
  factoryAddress,
  hasConfirmations,
  type RenderQueue,
} from '@cobweb/shared'
```

2. After the line `import { matchArtPaid } from '@/lib/chain/art-paid'`, add:

```ts
import { startIfWaived, startRender } from '@/lib/render/start'
```

3. In `LockContext`, after `collection: LockCollection`, add:

```ts
  /**
   * Where the pay flow sends a newly paid job's start message: Vercel Queues on Vercel, a queue that
   * only logs anywhere else (lib/render/queue.ts). The verify scripts pass their own.
   */
  queue: RenderQueue
```

4. At the end of `lockCore`, replace:

```ts
  if (error) return { error }
  return { data: await loadJob(supabase, (data as { id: string }).id) }
}
```

with:

```ts
  if (error) return { error }
  const job = await loadJob(supabase, (data as { id: string }).id)
  // A single asset pays nothing and is locked straight into `waived`: start its render now.
  await startIfWaived(ctx.queue, job)
  return { data: job }
}
```

5. At the end of `lockPlaceholderCore`, replace:

```ts
  if (error) return { error }
  return { data: await loadJob(ctx.supabase, (data as { id: string }).id) }
}
```

with:

```ts
  if (error) return { error }
  const job = await loadJob(ctx.supabase, (data as { id: string }).id)
  // A placeholder lock costs nothing: a job that comes back `waived` is started now.
  await startIfWaived(ctx.queue, job)
  return { data: job }
}
```

6. At the end of `confirmCore`, replace:

```ts
  if (recorded.error) return { error: recorded.error }
  if (short) return { refused: `${SHORT_PAYMENT} Tell support about job ${row.onchain_job_id}.` }
  return { data: await loadJob(supabase, row.id) }
```

with:

```ts
  if (recorded.error) return { error: recorded.error }
  if (short) return { refused: `${SHORT_PAYMENT} Tell support about job ${row.onchain_job_id}.` }
  // The job is paid: start its render now. A failed send is logged and left to the sweep.
  await startRender(ctx.queue, row.id)
  return { data: await loadJob(supabase, row.id) }
```

In `apps/web/src/lib/art/lock-write.ts`, add after `import { createServiceClient } from '@/lib/supabase/service'`:

```ts
import { renderQueue } from '@/lib/render/queue'
```

and in the object passed to `run(...)`, after `collection: owned.collection,`, add:

```ts
      queue: renderQueue(),
```

- [ ] **Step 7: Make verify:chain check the send**

In `apps/web/scripts/verify-chain.ts`:

1. After `import type { RenderJob } from '../src/lib/demo/types.ts'`, add:

```ts
import type { RenderMessage, RenderQueue } from '@cobweb/shared/render-queue'
```

2. Replace `contextFor` with:

```ts
/** The context `lockWrite` builds: the creator's RLS client, the service client, the owner's id, a queue. */
async function contextFor(
  client: ReturnType<typeof createClient<Database>>,
  owner: string,
  wallet: string,
  cid: string,
  queue: RenderQueue,
): Promise<LockContext> {
  const collection = await readLockCollection(client, cid)
  if (!collection || collection.owner_id !== owner) throw new Error('the creator cannot read the collection')
  return { supabase: client, service: () => admin, owner, wallet: wallet.toLowerCase(), collection, queue }
}

/** A queue that keeps what the pay flow sends, so a check can read it. */
function recordingQueue(): RenderQueue & { sent: RenderMessage[] } {
  const sent: RenderMessage[] = []
  return { sent, send: async (messages) => void sent.push(...messages) }
}

/** A queue that refuses every send, as Vercel Queues would during an outage. */
const refusingQueue: RenderQueue = { send: () => Promise.reject(new Error('the queue is down')) }
```

3. In `main`, replace

```ts
  const first = await contextFor(client, userId, creator.address, await seededCollection(client))
```

with

```ts
  const firstQueue = recordingQueue()
  const first = await contextFor(client, userId, creator.address, await seededCollection(client), firstQueue)
```

replace

```ts
  const second = await contextFor(client, userId, creator.address, await seededCollection(client))
```

with

```ts
  const secondQueue = recordingQueue()
  const second = await contextFor(client, userId, creator.address, await seededCollection(client), secondQueue)
```

and replace

```ts
  const third = await contextFor(client, userId, creator.address, await seededCollection(client))
```

with

```ts
  const third = await contextFor(client, userId, creator.address, await seededCollection(client), refusingQueue)
```

4. Rename the first lock check to `'lockArt: the creator locks a three-token set, quoted from the factory rate, and nothing is queued'`, and in it replace

```ts
    return job1.state === 'payment_due' &&
```

with

```ts
    if (firstQueue.sent.length > 0) return `queued at lock ${JSON.stringify(firstQueue.sent)}`
    return job1.state === 'payment_due' &&
```

5. Replace the pay check's name and its final return:

```ts
    'pay: payForArt from the quote wallet with the exact total; confirm marks the job paid',
```

becomes

```ts
    'pay: payForArt from the quote wallet with the exact total; confirm marks the job paid and queues one start',
```

and inside that check replace

```ts
      return job.state === 'paid' &&
        'payment' in job &&
        job.payment?.txHash === paidHash &&
        job.payment.amountWei === job1.quote.totalWei
        ? null
        : JSON.stringify(job)
```

with

```ts
      if (
        !(
          job.state === 'paid' &&
          'payment' in job &&
          job.payment?.txHash === paidHash &&
          job.payment.amountWei === job1.quote.totalWei
        )
      )
        return JSON.stringify(job)
      const want = [{ jobId: job1.id, step: 'start', retries: 0 }]
      return JSON.stringify(firstQueue.sent) === JSON.stringify(want)
        ? null
        : `queued ${JSON.stringify(firstQueue.sent)}`
```

6. Rename the short payment check to `'confirm: a payment short of the quote is refused and recorded, the job stays due and nothing is queued'`, and in it replace

```ts
      return row.data.state === 'payment_due' && row.data.payment_tx_hash === hash.toLowerCase()
        ? null
        : JSON.stringify(row.data)
```

with

```ts
      if (secondQueue.sent.length > 0) return `queued ${JSON.stringify(secondQueue.sent)}`
      return row.data.state === 'payment_due' && row.data.payment_tx_hash === hash.toLowerCase()
        ? null
        : JSON.stringify(row.data)
```

7. Rename the last confirm check to `'confirm: the payment left unrecorded is recorded and the job is paid, even when the queue refuses the start message'`. Its body is unchanged: the context `third` now carries `refusingQueue`.

In `apps/web/scripts/verify-render.ts`:

1. In `contextFor`, change the returned object to end with `collection, queue: { send: async () => {} } }` and add above the function's `return` the comment `// The script drives the runner itself, so the pay flow's start message goes nowhere.`
2. Line 4: replace `steps the Lambdas run` with `steps the queue consumer runs`.
3. Replace `/** Enqueues the job's start message and drains the queue, as SQS and the Lambdas would. */` with `/** Enqueues the job's start message and drains the queue, as Vercel Queues and the consumer would. */`.

- [ ] **Step 8: Run the unit tests, verify:chain and verify:render**

```bash
pnpm --filter @cobweb/web test
pnpm --filter @cobweb/web verify:chain
pnpm --filter @cobweb/web verify:render
```

Expected: the web unit tests pass (290: 282 before, 8 added). verify:chain ends `12 passed, 0 failed`, prints one line `The render of job <uuid> was not queued (Error); the sweep will start it.` for the third collection, and the four renamed checks print PASS. verify:render ends `19 passed, 0 failed`.

- [ ] **Step 9: Format, run the root checks and commit**

```bash
pnpm exec prettier --write apps/web/src/lib/render/start.ts apps/web/src/lib/render/start.test.ts apps/web/src/lib/render/queue.ts apps/web/src/lib/render/queue.test.ts apps/web/src/lib/art/lock-core.ts apps/web/src/lib/art/lock-write.ts apps/web/scripts/verify-chain.ts apps/web/scripts/verify-render.ts apps/web/package.json
pnpm typecheck && pnpm lint && pnpm test
git add apps/web/src/lib/render apps/web/src/lib/art/lock-core.ts apps/web/src/lib/art/lock-write.ts apps/web/scripts/verify-chain.ts apps/web/scripts/verify-render.ts apps/web/package.json pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
Send a job's start message when its payment is recorded or when it is locked as waived, and leave a failed send to the sweep

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KzWVSCKjsfbP9YKBetKHwW
EOF
)"
```

---

### Task 9: The consumer and sweep routes, `vercel.json` and the Next config

**Files:**

- Create: `apps/web/src/lib/render/env.ts`, `apps/web/src/lib/render/env.test.ts`
- Create: `apps/web/src/lib/render/worker.ts`
- Create: `apps/web/src/app/api/queues/render/route.ts`
- Create: `apps/web/src/app/api/cron/render-sweep/route.ts`
- Create: `apps/web/src/lib/render/sweep-route.test.ts`
- Create: `apps/web/vercel.json`
- Create: `apps/web/src/lib/render/vercel-config.test.ts`
- Modify: `apps/web/next.config.ts`
- Modify: `apps/web/.env.example`

**Interfaces:**

- Consumes: `productionDeps`, `DepsKind`, `Deps`, `vercelRenderQueue`, `queueConsumer`, `retryAfter`, `sweep`, `consoleLog`, `errorSummary` from `@cobweb/worker` (Tasks 2 to 6); `RENDER_TOPIC` (shared); `handleCallback`, `send` from `@vercel/queue`.
- Produces:
  - `workerEnv(env: Env): Env` and `cronAuthorized(header: string | null, secret: string | undefined): boolean` in `@/lib/render/env`
  - `workerDeps(kind: DepsKind, env?: Env): Deps` and `renderDeps(): Promise<Deps>` in `@/lib/render/worker`
  - `POST /api/queues/render` (queue consumer, `maxDuration` 800) and `GET /api/cron/render-sweep` (404 without the cron secret; `{ requeued }` with it)

Route conventions follow `src/app/api/uploads/[id]/route.ts`: an unknown or unauthorised caller gets a bare 404. The consumer route is never reachable from the internet; only Vercel's queue infrastructure invokes it.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/lib/render/env.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { cronAuthorized, workerEnv } from './env'

describe('workerEnv', () => {
  it('passes the public Supabase URL to the worker as SUPABASE_URL when that is not set', () => {
    const env = workerEnv({ NEXT_PUBLIC_SUPABASE_URL: 'https://p.supabase.co', OTHER: 'x' })
    expect(env.SUPABASE_URL).toBe('https://p.supabase.co')
    expect(env.OTHER).toBe('x')
  })

  it('keeps SUPABASE_URL when it is set', () => {
    const env = workerEnv({ SUPABASE_URL: 'https://a.supabase.co', NEXT_PUBLIC_SUPABASE_URL: 'https://b' })
    expect(env.SUPABASE_URL).toBe('https://a.supabase.co')
  })
})

describe('cronAuthorized', () => {
  const SECRET = 'cron-secret-value'

  it('accepts exactly Bearer and the secret', () => {
    expect(cronAuthorized(`Bearer ${SECRET}`, SECRET)).toBe(true)
  })

  it('refuses no header, another secret, another scheme and a longer value', () => {
    expect(cronAuthorized(null, SECRET)).toBe(false)
    expect(cronAuthorized('Bearer other-secret-value', SECRET)).toBe(false)
    expect(cronAuthorized(`Basic ${SECRET}`, SECRET)).toBe(false)
    expect(cronAuthorized(`Bearer ${SECRET}x`, SECRET)).toBe(false)
  })

  it('refuses everything when the secret is not set', () => {
    expect(cronAuthorized('Bearer ', undefined)).toBe(false)
    expect(cronAuthorized('Bearer ', '')).toBe(false)
  })
})
```

Create `apps/web/src/lib/render/sweep-route.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/cron/render-sweep/route'

const mocks = vi.hoisted(() => ({
  sweep: vi.fn<(deps: unknown) => Promise<number>>(),
  workerDeps: vi.fn<(kind: string) => unknown>(() => ({ ports: 'jobs' })),
  log: vi.fn<(event: string, fields?: Record<string, unknown>) => void>(),
}))
vi.mock('@cobweb/worker', () => ({
  sweep: mocks.sweep,
  consoleLog: mocks.log,
  errorSummary: (error: unknown) => `${(error as Error).name}: [masked]`,
}))
vi.mock('@/lib/render/worker', () => ({ workerDeps: mocks.workerDeps }))

const SECRET = 'cron-secret-value'
const request = (authorization?: string) =>
  new Request('https://cobweb.test/api/cron/render-sweep', {
    headers: authorization === undefined ? {} : { authorization },
  })

describe('GET /api/cron/render-sweep', () => {
  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', SECRET)
    mocks.sweep.mockReset()
    mocks.log.mockReset()
    mocks.workerDeps.mockClear()
  })
  afterEach(() => vi.unstubAllEnvs())

  it('answers 404 and does not sweep without the header or with another secret', async () => {
    for (const header of [undefined, 'Bearer other-secret-value', SECRET]) {
      const response = await GET(request(header))
      expect(response.status).toBe(404)
    }
    expect(mocks.sweep).not.toHaveBeenCalled()
  })

  it('answers 404 and does not sweep when CRON_SECRET is unset, even for a bare Bearer header', async () => {
    vi.stubEnv('CRON_SECRET', '')
    expect((await GET(request('Bearer '))).status).toBe(404)
    expect(mocks.sweep).not.toHaveBeenCalled()
  })

  it('sweeps with the jobs ports and answers with the count re-sent', async () => {
    mocks.sweep.mockResolvedValue(2)
    const response = await GET(request(`Bearer ${SECRET}`))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ requeued: 2 })
    expect(mocks.workerDeps).toHaveBeenCalledWith('jobs')
  })

  it('answers 500 with an empty body and logs the masked error when the sweep throws', async () => {
    mocks.sweep.mockRejectedValue(new Error('https://db.example/?key=abc'))
    const response = await GET(request(`Bearer ${SECRET}`))
    expect(response.status).toBe(500)
    expect(await response.text()).toBe('')
    expect(mocks.log).toHaveBeenCalledWith('sweep failed', { error: 'Error: [masked]' })
  })
})
```

Create `apps/web/src/lib/render/vercel-config.test.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs'
import { RENDER_TOPIC } from '@cobweb/shared/render-queue'
import { describe, expect, it } from 'vitest'
import nextConfig from '../../../next.config'

const app = (path: string) => new URL(`../../../${path}`, import.meta.url)
const CONSUMER = 'src/app/api/queues/render/route.ts'
const SWEEP = 'src/app/api/cron/render-sweep/route.ts'

type VercelConfig = {
  regions: string[]
  functions: Record<string, { experimentalTriggers: Record<string, unknown>[] }>
  crons: { path: string; schedule: string }[]
}
const config = JSON.parse(readFileSync(app('vercel.json'), 'utf8')) as VercelConfig

describe('vercel.json', () => {
  it('runs in iad1', () => {
    expect(config.regions).toEqual(['iad1'])
  })

  it('triggers the consumer route from the render topic, at most 25 at once', () => {
    expect(Object.keys(config.functions)).toEqual([CONSUMER])
    expect(existsSync(app(CONSUMER))).toBe(true)
    expect(config.functions[CONSUMER]!.experimentalTriggers).toEqual([
      {
        type: 'queue/v2beta',
        topic: RENDER_TOPIC,
        retryAfterSeconds: 120,
        maxDeliveries: 10,
        maxConcurrency: 25,
      },
    ])
  })

  it('lets the consumer run for 800 seconds', () => {
    expect(readFileSync(app(CONSUMER), 'utf8')).toContain('export const maxDuration = 800')
  })

  it('runs the sweep every 15 minutes, on a route that exists', () => {
    expect(config.crons).toEqual([{ path: '/api/cron/render-sweep', schedule: '*/15 * * * *' }])
    expect(existsSync(app(SWEEP))).toBe(true)
  })
})

describe('next.config.ts', () => {
  it('transpiles the worker and the render library and keeps sharp out of the bundle', () => {
    expect(nextConfig.transpilePackages).toEqual(
      expect.arrayContaining(['@cobweb/worker', '@cobweb/render', '@cobweb/shared']),
    )
    expect(nextConfig.serverExternalPackages).toEqual(['sharp'])
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @cobweb/web exec vitest run src/lib/render/env.test.ts src/lib/render/sweep-route.test.ts src/lib/render/vercel-config.test.ts`
Expected: FAIL. `./env` and the sweep route cannot be found, and `vercel.json` does not exist (`ENOENT`).

- [ ] **Step 3: Write the env helpers and the worker wiring**

Create `apps/web/src/lib/render/env.ts`:

```ts
import { timingSafeEqual } from 'node:crypto'
import type { Env } from '@cobweb/shared'

/**
 * The web app's environment as the worker reads it. The app keeps its Supabase URL under
 * NEXT_PUBLIC_SUPABASE_URL; the worker reads SUPABASE_URL.
 */
export function workerEnv(env: Env): Env {
  return { ...env, SUPABASE_URL: env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL }
}

/**
 * True when a cron request carries `Authorization: Bearer <CRON_SECRET>`, compared in constant time.
 * False for everything when the secret is not set, so a project without one never runs the sweep.
 */
export function cronAuthorized(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false
  const want = Buffer.from(`Bearer ${secret}`)
  const got = Buffer.from(header)
  return got.length === want.length && timingSafeEqual(got, want)
}
```

Create `apps/web/src/lib/render/worker.ts`:

```ts
import 'server-only'
import type { Env } from '@cobweb/shared'
import { productionDeps, vercelRenderQueue, type Deps, type DepsKind } from '@cobweb/worker'
import { send } from '@vercel/queue'
import { workerEnv } from './env'

/**
 * The worker's production ports for the render routes, over the web app's environment, sending through
 * the `render` topic. "render" for the queue consumer, "jobs" for the sweep (no storage, pinning or
 * chain keys needed). Building them opens no connection.
 */
export function workerDeps(kind: DepsKind, env: Env = process.env): Deps {
  return productionDeps(workerEnv(env), { queue: vercelRenderQueue({ send }), kind })
}

/** The consumer's ports; `queueConsumer` calls this once per instance. */
export const renderDeps = async (): Promise<Deps> => workerDeps('render')
```

- [ ] **Step 4: Write the two routes**

Create `apps/web/src/app/api/queues/render/route.ts`:

```ts
import { queueConsumer, retryAfter } from '@cobweb/worker'
import { handleCallback } from '@vercel/queue'
import { renderDeps } from '@/lib/render/worker'

/** A batch of 100 tokens at 2048 by 2048 takes minutes; Pro allows 800 seconds an invocation. */
export const maxDuration = 800

/**
 * The `render` topic's consumer (docs/specs/2026-10-13-render-worker-vercel.md, sections 6 and 7).
 * Only Vercel's queue infrastructure invokes it. A message is acknowledged when the handler returns and
 * delivered again when it throws, after 120 seconds the first time and an hour after that; the third
 * failed delivery fails the job with `dead-letter` and is acknowledged.
 */
export const POST = handleCallback(queueConsumer(renderDeps), {
  retry: (_error, metadata) => retryAfter(metadata),
})
```

Create `apps/web/src/app/api/cron/render-sweep/route.ts`:

```ts
import { consoleLog, errorSummary, sweep } from '@cobweb/worker'
import { cronAuthorized } from '@/lib/render/env'
import { workerDeps } from '@/lib/render/worker'

/**
 * The render sweep, run by Vercel Cron every 15 minutes (docs/specs/2026-10-13-render-worker-vercel.md,
 * section 7): sends a start message again for each job nothing has touched for 15 minutes. Vercel sends
 * `Authorization: Bearer <CRON_SECRET>`; any other caller gets a 404, as the other routes answer the
 * unknown. A failure is logged masked and answered with an empty 500.
 */
export async function GET(request: Request): Promise<Response> {
  if (!cronAuthorized(request.headers.get('authorization'), process.env.CRON_SECRET))
    return new Response(null, { status: 404 })
  try {
    const requeued = await sweep(workerDeps('jobs'))
    return Response.json({ requeued })
  } catch (error) {
    consoleLog('sweep failed', { error: errorSummary(error) })
    return new Response(null, { status: 500 })
  }
}
```

- [ ] **Step 5: Write `vercel.json` and the Next config**

Create `apps/web/vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "regions": ["iad1"],
  "functions": {
    "src/app/api/queues/render/route.ts": {
      "experimentalTriggers": [
        {
          "type": "queue/v2beta",
          "topic": "render",
          "retryAfterSeconds": 120,
          "maxDeliveries": 10,
          "maxConcurrency": 25
        }
      ]
    }
  },
  "crons": [{ "path": "/api/cron/render-sweep", "schedule": "*/15 * * * *" }]
}
```

In `apps/web/next.config.ts`, replace:

```ts
  // The UI and DNA packages ship TypeScript source, so Next compiles it with the app.
  transpilePackages: ['@cobweb/ui', '@cobweb/dna', '@cobweb/shared'],
```

with:

```ts
  // The workspace packages ship TypeScript source, so Next compiles them with the app. The worker and
  // the render library run in the render queue consumer and the sweep cron.
  transpilePackages: ['@cobweb/ui', '@cobweb/dna', '@cobweb/shared', '@cobweb/worker', '@cobweb/render'],
  // sharp is a native module: loaded from node_modules at run time, never bundled.
  serverExternalPackages: ['sharp'],
```

- [ ] **Step 6: Add the worker's names to the web env example**

In `apps/web/.env.example`, replace the block from `# Object storage for layer images, assets and placeholders` through `ART_S3_FORCE_PATH_STYLE=1` with:

```
# Object storage for layer images, assets and placeholders (server only; never NEXT_PUBLIC_).
# Local: run `supabase status -o env` and copy STORAGE_S3_URL, S3_PROTOCOL_REGION,
# S3_PROTOCOL_ACCESS_KEY_ID and S3_PROTOCOL_ACCESS_KEY_SECRET; the bucket is "art" and path style is on.
# Production: Cloudflare R2. ART_S3_ENDPOINT=https://<account id>.r2.cloudflarestorage.com,
# ART_S3_REGION=auto, path style on, and an R2 API token with object read and write on the art and
# render buckets. The art bucket needs a CORS rule allowing PUT with the Content-Type header from the
# app origin (services/worker/README.md has the rule). The signed length and the server's HEAD check
# are the size guard.
ART_S3_ENDPOINT=
ART_S3_REGION=
ART_S3_BUCKET=art
ART_S3_ACCESS_KEY_ID=
ART_S3_SECRET_ACCESS_KEY=
ART_S3_FORCE_PATH_STYLE=1
```

and replace the block from `# The render bucket (server only; never NEXT_PUBLIC_)` to the end of the file with:

```
# The render bucket (server only; never NEXT_PUBLIC_): the preview collages the render worker writes.
# Local: the "render" bucket in Supabase Storage, created by `supabase seed buckets`. Production: the
# second R2 bucket, behind the same endpoint and token as the art bucket. It must not be the art
# bucket. verify:render uses "render" unless set in the shell environment.
RENDER_S3_BUCKET=render

# The render worker's pinning service (server only; never NEXT_PUBLIC_): a Filebase IPFS bucket and its
# access key pair. The endpoint defaults to https://s3.filebase.com. Not used locally: verify:render
# pins to a folder. The worker's own notes are in services/worker/README.md.
FILEBASE_S3_ENDPOINT=
FILEBASE_BUCKET=
FILEBASE_ACCESS_KEY_ID=
FILEBASE_SECRET_ACCESS_KEY=

# The secret Vercel sends with each cron request as `Authorization: Bearer <CRON_SECRET>`; the render
# sweep route answers 404 without it. Generate one with `openssl rand -hex 32`. Not used locally.
CRON_SECRET=
```

- [ ] **Step 7: Run the tests to see them pass**

Run: `pnpm --filter @cobweb/web exec vitest run src/lib/render`
Expected: PASS: `env.test.ts` 5, `sweep-route.test.ts` 4, `vercel-config.test.ts` 5, plus the 8 from Task 8.

- [ ] **Step 8: Build the web app**

Run: `pnpm --filter @cobweb/web build`
Expected: the build succeeds and its route list shows `ƒ /api/cron/render-sweep` and `ƒ /api/queues/render`. If the build fails inside a workspace package or on sharp, stop and report the first error with its file; do not change the worker or the render library to make the build pass.

- [ ] **Step 9: Format, run the root checks and commit**

```bash
pnpm exec prettier --write apps/web/src/lib/render apps/web/src/app/api/queues/render/route.ts apps/web/src/app/api/cron/render-sweep/route.ts apps/web/vercel.json apps/web/next.config.ts
pnpm typecheck && pnpm lint && pnpm test
git add apps/web/src/lib/render apps/web/src/app/api/queues apps/web/src/app/api/cron apps/web/vercel.json apps/web/next.config.ts apps/web/.env.example
git commit -m "$(cat <<'EOF'
Run the render worker inside the web app as a queue consumer route and a sweep cron

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KzWVSCKjsfbP9YKBetKHwW
EOF
)"
```

---

### Task 10: Delete the `infra` package

**Files:**

- Delete: `infra/README.md`, `infra/bin/app.ts`, `infra/cdk.json`, `infra/lambda-deps/package-lock.json`, `infra/lambda-deps/package.json`, `infra/lib/render-stack.ts`, `infra/package.json`, `infra/test/render-stack.test.ts`, `infra/tsconfig.json`, and the untracked `infra/cdk.out` and `infra/node_modules`
- Modify: `pnpm-workspace.yaml`, root `package.json`, `.gitignore`, `.prettierignore`, `eslint.config.mjs`, `pnpm-lock.yaml`
- Modify: `CLAUDE.md` (layout and commands)
- Modify: `services/worker/scripts/bench.ts` (header comment)

**Interfaces:** none. After this task `git grep -n "infra" -- . ':!docs' ':!pnpm-lock.yaml'` prints nothing that refers to the package.

- [ ] **Step 1: Write the failing check**

Run:

```bash
test ! -e infra && ! grep -q "infra" pnpm-workspace.yaml && ! grep -q "cobweb/infra" CLAUDE.md && echo OK
```

Expected: no `OK` (the directory and the references still exist).

- [ ] **Step 2: Remove the package**

```bash
git rm -r infra
rm -rf infra
```

The `rm -rf` removes only what git does not track (`infra/cdk.out` and `infra/node_modules`). It is the one `rm` this plan allows.

- [ ] **Step 3: Remove the workspace wiring**

- `pnpm-workspace.yaml`: delete the line `  - infra`. Keep `onlyBuiltDependencies` as it is (Decision 9).
- Root `package.json`: delete the line `    "esbuild": "0.28.2",` from `devDependencies`.
- `.gitignore`: delete the line `cdk.out/`.
- `.prettierignore`: delete the line `cdk.out/`.
- `eslint.config.mjs`: delete the line `      '**/cdk.out/**',`.

Run: `pnpm install`
Expected: the lockfile loses the `infra` importer, `aws-cdk-lib`, `aws-cdk`, `constructs` and the root `esbuild` entry.

- [ ] **Step 4: Update CLAUDE.md and the bench comment**

In `CLAUDE.md`, in the Layout block, replace

```
apps/web           Next.js app: creator dashboard and mint page
```

with

```
apps/web           Next.js app: creator dashboard, mint page, and the render queue consumer and sweep cron (Vercel)
```

replace

```
services/worker    Render worker: ports, steps, adapters, local runner, Lambda entry points
infra/             AWS CDK stack for the render pipeline (defined and tested; not deployed)
```

with

```
services/worker    Render worker: ports, steps, adapters, queue consumer, local runner. Runs inside apps/web on Vercel
```

In the Commands block, replace

```
pnpm --filter @cobweb/worker test         # the render worker: steps, adapters, Lambda entry points
```

with

```
pnpm --filter @cobweb/worker test         # the render worker: steps, adapters, the queue consumer
```

and delete the two lines that start with `pnpm --filter @cobweb/infra`.

In `services/worker/scripts/bench.ts`, replace the first four comment lines with:

```ts
// Renders one batch in process and prints wall time, peak resident memory and CAR size
// (docs/specs/2026-10-12-render-worker.md, section 8). The same batch on a Vercel Function took 187
// seconds at a 779 MB peak (docs/specs/2026-10-13-render-worker-vercel.md, section 2). Not a test:
// nothing asserts on its numbers.
```

- [ ] **Step 5: Run the check to see it pass**

```bash
test ! -e infra && ! grep -q "infra" pnpm-workspace.yaml && ! grep -q "cobweb/infra" CLAUDE.md && echo OK
git grep -n "aws-cdk-lib\|cobweb/infra\|cdk.out" -- . ':!docs' ':!pnpm-lock.yaml'
```

Expected: `OK`, and the `git grep` prints nothing.

- [ ] **Step 6: Format, run the root checks and commit**

```bash
pnpm exec prettier --write package.json services/worker/scripts/bench.ts eslint.config.mjs
pnpm typecheck && pnpm lint && pnpm test && pnpm build
git add pnpm-workspace.yaml package.json .gitignore .prettierignore eslint.config.mjs pnpm-lock.yaml CLAUDE.md services/worker/scripts/bench.ts
git commit -m "$(cat <<'EOF'
Delete the infra package and its workspace wiring now that the worker runs on Vercel

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KzWVSCKjsfbP9YKBetKHwW
EOF
)"
```

---

### Task 11: The docs

**Files:**

- Create: `services/worker/README.md`
- Modify: `docs/MASTER_PLAN.md` (a Decisions subsection; the Phase 0 accounts line; the Phase 7 alerts line)
- Modify: `docs/specs/2026-10-12-render-worker.md` (dated superseded notes only)
- Modify: `README.md` (root; the AWS wording)

**Interfaces:** none. `docs/PLAN.md` must not change. The Phase 4 status sentence about this sub-project is added in Task 12, after the preview deployment, so it reports what happened.

- [ ] **Step 1: Write the failing check**

```bash
test -f services/worker/README.md && grep -q "### Hosting" docs/MASTER_PLAN.md && grep -q "Superseded on 13 October 2026" docs/specs/2026-10-12-render-worker.md && ! grep -qE "SQS|CloudFront|Lambdas|Metadata Lambda|subgraph aws" README.md && echo OK
```

Expected: no `OK`.

- [ ] **Step 2: Add the hosting decision and update the two plan lines**

In `docs/MASTER_PLAN.md`, add this subsection at the end of `## Decisions`, directly before `## Open decisions`:

```markdown
### Hosting

- **Render pipeline on Vercel, Cloudflare R2 and Vercel Queues; no AWS** (decided 13 October 2026; [specs/2026-10-13-render-worker-vercel.md](specs/2026-10-13-render-worker-vercel.md)). The render worker runs inside the web app as Vercel Functions on fluid compute, which scale to zero: the consumer of the `render` topic and a sweep cron every 15 minutes. Pro allows 800 seconds an invocation and a 4 GB Performance instance; a proof run rendered 100 tokens at 2048 by 2048 with 7 layers in 187 seconds at a 779 MB peak and produced the laptop's CID. Layers and collages live in Cloudflare R2 (no egress charge) through its S3 endpoint; locally both buckets stay on Supabase Storage. Duplicates are stopped by idempotency keys; dead-lettering is in the consumer, on the third delivery; the start message is sent when the payment is recorded, or at lock for a waived job; 1/1 and single asset batches target 500 MB at lock and the worker's ceiling is 600 MB; 25 batches run at once to start, in `iad1`. The `infra` CDK package, the Lambda entry points, the SQS adapter and the Secrets Manager loader are deleted. Railway stays for the freshness server.
```

Replace the Phase 0 line

```markdown
- Accounts: Supabase project, Railway project, AWS account with a scoped deploy role, Cloudflare zone, Filebase bucket.
```

with

```markdown
- Accounts: Supabase project, Railway project, Vercel project, Cloudflare zone and R2, Filebase bucket. (13 October 2026: the AWS account with a scoped deploy role was dropped; see the Hosting decision.)
```

Replace the Phase 7 line

```markdown
- Alerts on the dead-letter queue, freshness server health and RPC errors.
```

with

```markdown
- Alerts on render queue retries (Vercel Observability, from the dashboard; the dead-letter queue went with AWS on 13 October 2026), freshness server health and RPC errors.
```

- [ ] **Step 3: Mark the AWS parts of the worker spec superseded**

In `docs/specs/2026-10-12-render-worker.md`, insert each note as its own paragraph. Do not change any other text.

After the opening paragraph (the one that ends with `sections 4, 7 and 9.`), before `## 1. Goal`:

```markdown
> **13 October 2026:** section 9 (AWS) and the AWS lines of sections 4, 8, 10 and 11 are superseded by [2026-10-13-render-worker-vercel.md](2026-10-13-render-worker-vercel.md): the worker runs on Vercel, with no AWS. The text below is kept as it was written.
```

Directly under the heading `## 4. The queue contract (...)`:

```markdown
> Superseded on 13 October 2026: `backlog` and the SQS adapter. `RenderQueue` is `send` only, `messageKey` gives each message its idempotency key, and the queue adapter is `vercelRenderQueue` from `@cobweb/worker/queue` ([2026-10-13-render-worker-vercel.md](2026-10-13-render-worker-vercel.md), sections 4 and 5).
```

Directly under the heading `## 8. Local runner and scripts`:

```markdown
> Superseded on 13 October 2026: the benchmark is no longer the input to Lambda settings; the functions run on Vercel ([2026-10-13-render-worker-vercel.md](2026-10-13-render-worker-vercel.md), section 2).
```

Directly under the heading `## 9. AWS (`infra/`)`:

```markdown
> Superseded on 13 October 2026, in full: the `infra` package, the Lambda entry points, the SQS adapter and the Secrets Manager loader are deleted. The queue consumer, the dead-lettering and the sweep cron are in [2026-10-13-render-worker-vercel.md](2026-10-13-render-worker-vercel.md), sections 6 and 7.
```

Directly under the heading `## 10. Configuration`:

```markdown
> Superseded on 13 October 2026: `RENDER_QUEUE_URL`, `RENDER_SECRET_ARN`, `JOBS_SECRET_ARN` and `RENDER_DEAD_LETTER_QUEUE_URL` are gone. The names and the Vercel and R2 settings are in [2026-10-13-render-worker-vercel.md](2026-10-13-render-worker-vercel.md), section 10.
```

Directly under the heading `## 11. Testing`:

```markdown
> Superseded on 13 October 2026: the Lambda handler tests and the CDK template assertions went with the code they tested; the consumer and adapter tests that replace them are in [2026-10-13-render-worker-vercel.md](2026-10-13-render-worker-vercel.md), section 11.
```

- [ ] **Step 4: Write the worker README**

Create `services/worker/README.md`:

````markdown
# Render worker

`@cobweb/worker` turns a `paid` or `waived` render job into pinned images and metadata. The specs are
[docs/specs/2026-10-12-render-worker.md](../../docs/specs/2026-10-12-render-worker.md) (ports, steps,
local runner) and [docs/specs/2026-10-13-render-worker-vercel.md](../../docs/specs/2026-10-13-render-worker-vercel.md)
(how it runs on Vercel).

## What runs where

- This package holds the five ports and their adapters, the three steps (`start`, `batch`,
  `metadata`), the dead-letter handler, the sweep, the Vercel queue adapter and the
  queue consumer. It imports nothing from `@vercel/queue`; the web app passes the SDK in.
- On Vercel the worker runs inside `apps/web`, in the same project as the pay flow, because a topic's
  messages are delivered to the deployment that published them:
  - `POST /api/queues/render` (`src/app/api/queues/render/route.ts`): the consumer of the `render`
    topic. Only Vercel's queue infrastructure invokes it. `maxDuration` 800 seconds.
  - `GET /api/cron/render-sweep` (`src/app/api/cron/render-sweep/route.ts`): every 15 minutes, with
    `Authorization: Bearer <CRON_SECRET>`; any other caller gets a 404.
  - The pay flow (`src/lib/art/lock-core.ts`, `confirmCore`) sends a job's start message as soon as the
    payment is recorded, and the lock (`lockCore`) sends it for a job locked as `waived` (a single
    asset, which pays nothing). A failed send is logged and the sweep starts the job.
- Locally nothing reaches Vercel: the web app's queue only logs `render not queued (no queue here)`,
  and `pnpm --filter @cobweb/web verify:render` drives the local runner (`@cobweb/worker/local`) over a
  queue in memory and a folder standing in for Filebase.

## Delivery, retries and duplicates

- Every message carries an idempotency key, `<jobId>:<step>[:<index>]:<retries>`. Vercel drops a
  second message with the same key for 24 hours, so a rerun step or a sweep never renders a batch twice
  within a day. A creator's retry raises `retries` and so gets new keys.
- A message whose run throws is delivered again after 120 seconds the first time and an hour after
  that. On its third delivery a failure fails the job with `dead-letter` and the message is
  acknowledged. If that report cannot be written (a database outage) the message comes back and the
  report is made then. The trigger's `maxDeliveries` of 10 bounds a runaway; it is never the normal
  path.
- The sweep sends a start message again for each job nothing has touched for 15 minutes.

## Environment

Every name is server only and none starts with `NEXT_PUBLIC_`. They live in the web app's environment
(`apps/web/.env.example`); `services/worker/.env.example` lists the worker's own view of them.

| Name | Secret | What |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | no | The Supabase URL; the worker routes pass it as `SUPABASE_URL` |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | The worker's database key |
| `ART_S3_ENDPOINT` | no | `https://<account id>.r2.cloudflarestorage.com` |
| `ART_S3_REGION` | no | `auto` |
| `ART_S3_FORCE_PATH_STYLE` | no | `1` |
| `ART_S3_BUCKET` | no | The R2 bucket for layers, assets and placeholders |
| `RENDER_S3_BUCKET` | no | The R2 bucket for collages; never the art bucket |
| `ART_S3_ACCESS_KEY_ID`, `ART_S3_SECRET_ACCESS_KEY` | yes | The R2 API token, object read and write on both buckets |
| `FILEBASE_BUCKET` | no | The Filebase IPFS bucket |
| `FILEBASE_ACCESS_KEY_ID`, `FILEBASE_SECRET_ACCESS_KEY` | yes | The Filebase key pair |
| `FILEBASE_S3_ENDPOINT` | no | Optional; defaults to `https://s3.filebase.com` |
| `RPC_URL_<chainId>` | yes | One per launch chain |
| `FACTORY_ADDRESS_<chainId>` | no | One per launch chain |
| `CRON_SECRET` | yes | Sent by Vercel Cron; generate with `openssl rand -hex 32` |

## Vercel project settings (the owner)

1. Project `cobweb`, Root Directory `apps/web`, framework Next.js, Node 24.x.
2. Settings, Functions: Function CPU **Performance** (4 GB, 2 vCPU). From the CLI:
   `vercel project update cobweb --function-cpu performance`.
3. Region `iad1` (also set in `apps/web/vercel.json`). Create the Supabase project in us-east-1 so the
   database sits beside the functions.
4. Production environment values for every name in the table above, and `CRON_SECRET`.
5. Crons run on production deployments only; the queue trigger is registered on every deployment.

## Cloudflare R2 (the owner)

1. Two buckets in one account: one for layers, assets and placeholders (`ART_S3_BUCKET`) and one for
   collages (`RENDER_S3_BUCKET`).
2. One R2 API token with Object Read and Write on both buckets; its key id and secret are
   `ART_S3_ACCESS_KEY_ID` and `ART_S3_SECRET_ACCESS_KEY`.
3. A CORS rule on the layer bucket, because browser uploads are presigned PUTs:

   ```json
   [
     {
       "AllowedOrigins": ["https://<the app's origin>"],
       "AllowedMethods": ["PUT"],
       "AllowedHeaders": ["Content-Type"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

4. `ART_S3_ENDPOINT=https://<account id>.r2.cloudflarestorage.com`, `ART_S3_REGION=auto`,
   `ART_S3_FORCE_PATH_STYLE=1`.

## Filebase: two behaviours to confirm with a real key

They come from Filebase's public documentation and have not been checked against a live account.

1. **A CAR uploaded with the import metadata is imported as a directory.** The pinner
   (`src/adapters/filebase.ts`) uploads `<cid>.car` with the object metadata `import: car`
   (`FILEBASE_IMPORT_METADATA`):

   ```
   npx -y ipfs-car@3.1.0 pack ./some-folder --output folder.car
   aws --endpoint https://s3.filebase.com s3 cp folder.car s3://<bucket>/folder.car --metadata 'import=car'
   ```

2. **The CID comes back in the head response's metadata** under `cid` (`FILEBASE_CID_METADATA_KEY`,
   the `x-amz-meta-cid` header), as the CIDv1 root the render library computed:

   ```
   aws --endpoint https://s3.filebase.com s3api head-object --bucket <bucket> --key folder.car
   ```

If either differs, change the two constants and nothing else. The worker already fails a job with
`cid-mismatch` rather than accept a different CID.

## Concurrency

At most 25 batches render at once: `maxConcurrency` on the queue trigger in `apps/web/vercel.json`.
It is a starting point. After the first real job, read Filebase's ingest rate from the logs and raise
the number in `vercel.json` (and in `apps/web/src/lib/render/vercel-config.test.ts`, which pins it).

## Batch sizes and memory

A batch is held about 2.8 times over while it is packed. Generative batches are 100 tokens. 1/1 and
single asset batches are sized at lock to about 500 MB of files, and the batch step fails a job with
`batch-too-large` past 600 MB of files it really loads. The render library reads each distinct layer
once per batch.

## Local

```
pnpm --filter @cobweb/worker test         # steps, adapters, the queue consumer
pnpm --filter @cobweb/web verify:render   # end to end against local Supabase, local storage and Anvil
pnpm --filter @cobweb/worker bench        # one batch of 100 tokens at 2048 x 2048: time, memory, CAR size
```
````

- [ ] **Step 5: Replace the AWS wording in the root README**

In `README.md` make these replacements and nothing else. The S3 protocol stays named where it describes storage, because the S3 SDK stays. The legacy table row `ArtGenLambda` is a legacy repo's name and stays.

Line 3, replace `with AWS cut down to Lambda, SQS and S3 for art rendering.` with:

```markdown
with no AWS: art renders on Vercel Functions fed by Vercel Queues, and layers sit in Cloudflare R2 behind its S3 protocol.
```

In the architecture diagram, replace

```
  subgraph aws[AWS]
    s3[(S3<br/>source layers)]
    cf[CloudFront<br/>thumbnails]
    sqs[SQS<br/>one message per 100 tokens]
    render[Render Lambdas<br/>sharp compositing]
    meta[Metadata Lambda]
  end
```

with

```
  subgraph r2[Cloudflare R2]
    s3[(S3 protocol<br/>source layers, collages)]
  end

  subgraph vercelrender[Vercel, inside apps/web]
    queue[Vercel Queues<br/>render topic]
    render[Render functions<br/>sharp compositing]
    meta[Metadata step]
  end
```

replace `  s3 --> cf --> web` with `  s3 -- signed GET --> web`, and replace `  db -- paid job --> sqs --> render` with `  web -- paid job --> queue --> render`.

In the pieces table, replace the two rows

```
| Render pipeline   | `services/render` | AWS SQS and Lambda         | Composites tokens, packs CARs, uploads to Filebase                |
| Layer storage     |                   | S3, CloudFront             | Source layers and their thumbnails                                |
```

with

```
| Render pipeline | `services/render`, `services/worker` | Vercel Functions and Vercel Queues, inside `apps/web` | Composites tokens, packs CARs, uploads to Filebase |
| Layer storage | | Cloudflare R2, over the S3 protocol | Source layers, their thumbnails and preview collages |
```

Replace `Only source layers touch S3. Rendered images go from a Lambda's temporary disk straight to Filebase, one batch at a time.` with:

```markdown
Only source layers and preview collages touch storage (R2, over the S3 protocol). Rendered images go from a render function's memory straight to Filebase, one batch at a time.
```

In the art pipeline flowchart, replace `  Pay --> Q[SQS<br/>100 tokens per message]` with `  Pay --> Q[Vercel Queues<br/>one message per batch]`, `  Q --> R[Render Lambdas in parallel]` with `  Q --> R[Render functions in parallel]`, and `  R -->|last batch| M[Metadata Lambda<br/>one metadata CAR]` with `  R -->|last batch| M[Metadata step<br/>one metadata CAR]`.

Replace `- Failed batches retry through SQS, with a dead-letter queue.` with `- Failed batches retry through Vercel Queues; the third failed delivery fails the job with dead-letter.` (the rest of that bullet stays).

In the repository layout, replace

```
services/render    Render and metadata Lambdas, SQS wiring
```

with

```
services/render    Render library: layers to images, CARs and CIDs
services/worker    Render worker: steps, adapters, queue consumer. Runs inside apps/web on Vercel
```

In the paid services table, replace the row

```
| AWS      | S3 for layers, SQS, Lambda for rendering | Pay per use | About $1 at rest, about $2 per 10,000-token render |
```

with

```
| Vercel (render) | Render functions and Vercel Queues, inside `apps/web` | Pro, usage | About $1.50 of compute per 10,000-token render |
```

In the free tiers table, replace the `CloudFront` row with:

```
| Cloudflare R2 | Layers and preview collages, over the S3 protocol | Past the free storage allowance; no egress charge |
```

In the technology table, replace the row

```
| Render    | AWS SDK (S3, SQS)                              | Planned, Phases 3 and 4 | Presigned uploads, job fan-out                 |
```

with the two rows

```
| Render | AWS SDK (S3 client) | Installed | Presigned uploads and storage reads over the S3 protocol (Supabase Storage, R2, Filebase) |
| Render | Vercel Queues (`@vercel/queue`) | Installed | Render job fan-out |
```

In the build status table, replace `Render pipeline: SQS, Lambdas, Filebase` with `Render pipeline: Vercel Queues, Vercel Functions, Filebase`, and `Queue, Lambdas, IPFS upload` with `Queue, render functions, IPFS upload`.

Prettier aligns the table columns in Step 7.

- [ ] **Step 6: Run the check to see it pass**

```bash
test -f services/worker/README.md && grep -q "### Hosting" docs/MASTER_PLAN.md && grep -q "Superseded on 13 October 2026" docs/specs/2026-10-12-render-worker.md && ! grep -qE "SQS|CloudFront|Lambdas|Metadata Lambda|subgraph aws" README.md && echo OK
git diff --quiet HEAD -- docs/PLAN.md && echo "PLAN.md unchanged"
```

Expected: `OK` and `PLAN.md unchanged`.

- [ ] **Step 7: Format and commit**

```bash
pnpm exec prettier --write services/worker/README.md README.md
pnpm format:check
pnpm typecheck && pnpm lint && pnpm test
git add services/worker/README.md README.md docs/MASTER_PLAN.md docs/specs/2026-10-12-render-worker.md
git commit -m "$(cat <<'EOF'
Record the move to Vercel and R2 in the master plan, mark the AWS spec sections superseded, add the worker README and drop AWS from the root README

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KzWVSCKjsfbP9YKBetKHwW
EOF
)"
```

---

### Task 12: The whole check list, the preview deployment and the bench project

**Files:**

- Create: `.vercelignore` (repo root)
- Modify: `docs/MASTER_PLAN.md` (one sentence block appended to the Phase 4 status paragraph)
- Modify: `docs/specs/2026-10-13-render-worker-vercel.md` (acceptance boxes)

**Interfaces:** none.

Never pass `--prod`. Never set a real secret on Vercel. The only env values you may add are the three placeholders in Step 6, for `preview` only. Save every command's output you need to read under the session scratchpad, not in the repo.

- [ ] **Step 1: Start the local services**

```bash
supabase status || supabase start
supabase seed buckets
```

Start `pnpm --filter @cobweb/web chain:local` in the background and wait for it to print its two lines; make sure `apps/web/.env.local` holds those two lines (`RPC_URL_31337` and `FACTORY_ADDRESS_31337`).

- [ ] **Step 2: Run the whole suite**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm format:check
pnpm --filter @cobweb/web verify:render
pnpm --filter @cobweb/web verify:render
pnpm --filter @cobweb/web verify:render
pnpm --filter @cobweb/web verify:local
pnpm --filter @cobweb/web verify:storage
pnpm --filter @cobweb/web verify:sweep
pnpm --filter @cobweb/web verify:chain
```

Expected: every command exits 0. verify:render ends `19 passed, 0 failed` all three times; verify:chain ends `12 passed, 0 failed`; verify:local, verify:storage and verify:sweep end with `0 failed`. Then:

```bash
git grep -n "@aws-sdk/client-sqs\|@aws-sdk/client-secrets-manager\|aws-lambda\|aws-cdk-lib" -- apps packages services supabase
test ! -e infra && echo "infra gone"
git diff --quiet main -- docs/PLAN.md && echo "PLAN.md unchanged"
```

Expected: the `git grep` prints nothing, then `infra gone` and `PLAN.md unchanged`. If anything fails, stop and report it; do not deploy.

- [ ] **Step 3: Write the upload ignore list**

Create `.vercelignore` at the repo root:

```
# What the Vercel CLI never uploads from this repo (the web app deploys from the repo root with Root
# Directory apps/web, so the workspace packages go up with it).
legacy/
node_modules/
**/node_modules/
.next/
**/.next/
.turbo/
**/.turbo/
.vercel/
contracts/
docs/
supabase/
.remember/
.superpowers/
.playwright-mcp/
**/.env
**/.env.*
**/*.tsbuildinfo
```

The `.env.example` files are not needed by the build and stay out with the other env files.

- [ ] **Step 4: Create and link the project**

From the repo root:

```bash
vercel whoami
vercel project create cobweb
vercel project update cobweb --root-directory apps/web --framework nextjs --node-version 24.x --yes
vercel link --yes --project cobweb
```

If `vercel project create` answers that `cobweb` exists, go on. If `vercel project update` asks to confirm a setting that affects charges, answer no and report it. `vercel link` writes `.vercel/project.json` at the repo root, which `.gitignore` already ignores.

- [ ] **Step 5: Check the upload with a dry run**

```bash
vercel deploy --dry > "$SCRATCH/dry.json"
grep -c '"legacy/' "$SCRATCH/dry.json"
grep -c '\.env\.local' "$SCRATCH/dry.json"
grep -c 'packages/shared/src/render-queue.ts' "$SCRATCH/dry.json"
grep -c 'services/worker/src/vercel/consumer.ts' "$SCRATCH/dry.json"
```

(`$SCRATCH` is the session scratchpad directory.) Expected: `0`, `0`, then a count of at least 1 for each of the last two. If a `legacy/` path or an env file appears, stop: fix `.vercelignore` and run the dry run again before any upload.

- [ ] **Step 6: Deploy a preview**

```bash
vercel deploy --yes --format json > "$SCRATCH/deploy.json"
```

Expected: a preview URL on `vercel.app`. If the build fails because a `NEXT_PUBLIC_` value is missing at build time, add these non-secret placeholders to `preview` only and deploy again:

```bash
vercel env add NEXT_PUBLIC_SUPABASE_URL preview --value https://placeholder.supabase.co --yes
vercel env add NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY preview --value placeholder-publishable-key --yes
vercel env add NEXT_PUBLIC_DEMO_DATA preview --value 0 --yes
```

Add nothing else. If the build fails for any other reason, read `vercel inspect <url> --logs`, report the first error and stop.

- [ ] **Step 7: Confirm the consumer, its trigger and the cron**

```bash
vercel inspect <url> --format json > "$SCRATCH/inspect.json"
vercel inspect <url>
vercel api "/v13/deployments/<deployment id from inspect>" > "$SCRATCH/deployment.json"
grep -o '"queue/v2beta"[^}]*' "$SCRATCH/deployment.json" "$SCRATCH/inspect.json"
grep -o 'render-sweep[^"]*' "$SCRATCH/deployment.json" "$SCRATCH/inspect.json"
```

Expected: the deployment is `READY`; its function list includes `api/queues/render` and `api/cron/render-sweep`; the deployment record carries the `queue/v2beta` trigger on topic `render` and the cron `/api/cron/render-sweep` at `*/15 * * * *`. If the API output shows neither the trigger nor the cron, confirm them from a local build of the linked project instead:

```bash
vercel pull --yes --environment=preview
vercel build
```

and read the `crons` entry in `.vercel/output/config.json` and the `experimentalTriggers` entry in the `.vc-config.json` of the `api/queues/render` function under `.vercel/output/functions`. Report which of the two ways showed them. No message is sent to the preview, and its consumer would fail at its first message until the owner enters the env values; that is expected.

- [ ] **Step 8: Remove the throwaway bench project**

```bash
vercel project remove cobweb-render-bench
vercel project ls
```

If the remove asks for confirmation it cannot get non-interactively, run `vercel project rm cobweb-render-bench --yes`; if that flag is refused, run `printf 'y\n' | vercel project remove cobweb-render-bench`. Expected: `cobweb-render-bench` is not in the list and `cobweb` is.

- [ ] **Step 9: Record the landing**

In `docs/MASTER_PLAN.md`, append to the end of the Phase 4 `**Status:**` paragraph (after `Next: screen wiring (fourth sub-project).`), in the same paragraph:

```markdown
 On 13 October 2026 the render worker moved to Vercel; see [specs/2026-10-13-render-worker-vercel.md](specs/2026-10-13-render-worker-vercel.md). The worker runs inside `apps/web` as the `render` topic's consumer (`/api/queues/render`, 800 seconds, at most 25 at once, region `iad1`) and the sweep cron (`/api/cron/render-sweep`, every 15 minutes); the pay flow sends the start message when the payment is recorded, and the lock sends it for a waived job; layers and collages are in Cloudflare R2; asset batches target 500 MB at lock and the worker's ceiling is 600 MB; a waived job is started at lock. The `infra` package, the Lambda entry points, the SQS adapter and the Secrets Manager loader are gone, and the fourth sub-project's retry action uses `vercelRenderQueue` from `@cobweb/worker/queue` in place of `sqsRenderQueue`. A preview deployment to the Vercel project `cobweb` built with sharp and registered the consumer's trigger and the cron. The AWS to-dos above (the deploy, the benchmark on Lambda, the alarm's notification target, the cap of 10 concurrent render functions) are withdrawn. Owed to the owner before production: the production env values and settings on the Vercel project (Function CPU Performance, the Supabase project in us-east-1, the two R2 buckets with their token and CORS rule, `CRON_SECRET`, the Filebase key) and the two Filebase behaviours confirmed against a live account (services/worker/README.md). Alerting on queue retries moves to Phase 7.
```

If Step 7 confirmed the trigger and the cron only through the local build, write `built with sharp, and a local build of the linked project showed the consumer's trigger and the cron` in place of `built with sharp and registered the consumer's trigger and the cron`.

In `docs/specs/2026-10-13-render-worker-vercel.md`, section 13, change each `- [ ]` to `- [x]` for every criterion this task showed to hold. Leave a box unticked for anything that did not, and say why in your report.

- [ ] **Step 10: Commit**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add .vercelignore docs/MASTER_PLAN.md docs/specs/2026-10-13-render-worker-vercel.md
git commit -m "$(cat <<'EOF'
Deploy a preview of the web app to Vercel and record the render worker's move off AWS

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KzWVSCKjsfbP9YKBetKHwW
EOF
)"
```

Report the preview URL, the deployment id, how the trigger and the cron were confirmed, any placeholder env value you added, and that `cobweb-render-bench` is gone.

---

## Self-review

**Spec coverage.** Section 4 (contract): Tasks 1 and 6. Section 5 (adapter, re-exported from `@cobweb/worker/queue`): Task 2. Section 6 (consumer, `retryAfter`, memoised deps, `handleDead` rethrow): Task 3. Section 7 (routes, queue module, the start send at payment and at a waived lock, `LockContext.queue`, `vercel.json`, Next config, `@vercel/queue` 0.8.0 in `apps/web` only): Tasks 8 and 9. Section 8 (`productionDeps` with an injected queue, `WORKER_ENV`, no layer cache, `MAX_BATCH_BYTES`, the sweep, `memoryQueue`, deletions including the `stub-s3.ts` rename, `queue.ts`, `index.ts`, `package.json`): Tasks 4, 5 and 6. Section 9 (migration, verify-local numbers): Task 7. Section 10 (web and worker env examples; Vercel and R2 settings in the README): Tasks 5, 9 and 11. Section 11 (the unit tests listed, `verify:render` three times, `verify:local`, build, preview, the suite): Tasks 1 to 9 and 12. Section 12 (docs, and the root README): Tasks 10, 11 and 12. Section 13 (acceptance): Task 12. Spec decision 6 (the 24 hour key window) is accepted as designed; no test asserts a sweep re-send inside the window (the sweep tests use the memory queue, which does not deduplicate).

**Placeholder scan.** No step says "add error handling" or "similar to Task N"; every code step shows the code. The deploy steps have explicit fallbacks with exact commands because the CLI's output for triggers and crons on a preview could not be checked from the planning session.

**Type consistency.** `QueueSender`, `vercelRenderQueue`, `queueConsumer(getDeps, log?)`, `retryAfter(metadata)`, `MessageFailed.from`, `MAX_BATCH_BYTES`, `productionDeps(env, { queue, log?, kind? })`, `DepsKind`, `DepsOptions`, `startRender(queue, jobId, log?)`, `startIfWaived(queue, job, log?)`, `renderQueue(env?, log?)`, `workerEnv`, `cronAuthorized`, `workerDeps(kind, env?)` and `renderDeps()` are spelled the same in every task that uses them. No task names a layer cache.

**Review Focus.** Five lines, each with its test in the owning task: the masked rethrow (Task 3), the refused start send (Task 8, unit and verify:chain), keys across retries (Tasks 1 and 2), the cron secret unset (Task 9), the waived lock and the `payment_due` lock (Task 8, unit and verify:chain).
