import { describe, expect, it, vi } from 'vitest'
import { LOCKED, THROWN, type ActionResult } from '@/lib/art/result'
import type { ArtProject } from './art-store'
import { ArtSyncQueue, getQueue } from './art-sync-queue'

function setup(demo = false) {
  let project: ArtProject = {
    collections: [],
    canvas: null,
    seed: 1,
    staleNote: null,
    showBlankTraits: false,
  }
  const notify = vi.fn()
  const onLocked = vi.fn()
  const queue = new ArtSyncQueue({
    demo,
    read: () => project,
    write: (next) => {
      project = next
    },
    notify,
    onLocked,
  })
  return {
    queue,
    notify,
    onLocked,
    names: () => (project.collections ?? []).map((collection) => collection.name),
  }
}

const named =
  (name: string) =>
  (project: ArtProject): ArtProject => ({
    ...project,
    collections: [...(project.collections ?? []), { id: name, name, size: 1 }],
  })

function later<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

const saved: ActionResult = { ok: true, data: undefined }
const refused: ActionResult = { ok: false, error: 'No.' }
const tick = () => new Promise((settle) => setTimeout(settle, 0))

describe('ArtSyncQueue', () => {
  it('pending() is true while an edit is queued or in flight and false once it is saved or rolled back', async () => {
    const s = setup()
    expect(s.queue.pending()).toBe(false)
    const slow = later<ActionResult>()
    const a = s.queue.run({ apply: named('a'), persist: () => slow.promise })
    expect(s.queue.pending()).toBe(true)
    slow.resolve(saved)
    await a
    expect(s.queue.pending()).toBe(false)
    const b = s.queue.run({ apply: named('b'), persist: async () => refused })
    expect(s.queue.pending()).toBe(true)
    await b
    expect(s.queue.pending()).toBe(false)
  })

  it('gives undo the snapshot, so it can choose to restore it', async () => {
    const s = setup()
    let seen: string[] = []
    await s.queue.run({
      apply: named('a'),
      persist: async () => refused,
      undo: (p, snapshot) => {
        seen = (snapshot.collections ?? []).map((c) => c.name)
        return p
      },
    })
    expect(seen).toEqual([])
  })

  it('applies at once and saves in the order the edits were made', async () => {
    const s = setup()
    const first = later<ActionResult>()
    const calls: string[] = []
    const a = s.queue.run({
      apply: named('a'),
      persist: () => {
        calls.push('a')
        return first.promise
      },
    })
    const b = s.queue.run({
      apply: named('b'),
      persist: async () => {
        calls.push('b')
        return saved
      },
    })
    expect(s.names()).toEqual(['a', 'b'])
    await tick()
    expect(calls).toEqual(['a'])
    first.resolve(saved)
    expect(await a).toBe(true)
    expect(await b).toBe(true)
    expect(calls).toEqual(['a', 'b'])
  })

  it('restores the snapshot on a failed save, says why, and drops the edits queued behind it', async () => {
    const s = setup()
    const calls: string[] = []
    const a = s.queue.run({
      apply: named('a'),
      persist: async () => {
        calls.push('a')
        return refused
      },
    })
    const b = s.queue.run({
      apply: named('b'),
      persist: async () => {
        calls.push('b')
        return saved
      },
    })
    expect(await a).toBe(false)
    expect(await b).toBe(false)
    expect(calls).toEqual(['a'])
    expect(s.names()).toEqual([])
    expect(s.notify).toHaveBeenCalledWith('No.')
    expect(s.notify).toHaveBeenCalledTimes(1)
  })

  it('applies undo instead of the snapshot when the edit gives one', async () => {
    const s = setup()
    await s.queue.run({ apply: named('kept') })
    await s.queue.run({ apply: (project) => project, persist: async () => refused, undo: named('undone') })
    expect(s.names()).toEqual(['kept', 'undone'])
  })

  it('rolls back a thrown save with the retry sentence', async () => {
    const s = setup()
    const ok = await s.queue.run({ apply: named('a'), persist: () => Promise.reject(new Error('offline')) })
    expect(ok).toBe(false)
    expect(s.names()).toEqual([])
    expect(s.notify).toHaveBeenCalledWith(THROWN)
  })

  it('applies a create only when the action returns the id; the edit behind it waits', async () => {
    const s = setup()
    const made = later<ActionResult<{ id: string }>>()
    let seenBehind = ''
    const created = s.queue.create<{ id: string }>({
      persist: () => made.promise,
      apply: (project, data) => named(data?.id ?? 'sample')(project),
    })
    const behind = s.queue.run({
      apply: (project) => project,
      persist: async () => {
        seenBehind = s.names().join()
        return saved
      },
    })
    expect(s.names()).toEqual([])
    made.resolve({ ok: true, data: { id: 'uuid-1' } })
    expect(await created).toBe(true)
    expect(await behind).toBe(true)
    expect(s.names()).toEqual(['uuid-1'])
    expect(seenBehind).toBe('uuid-1')
  })

  it('keeps a created row when an edit made while it was out fails', async () => {
    const s = setup()
    const made = later<ActionResult<{ id: string }>>()
    const created = s.queue.create<{ id: string }>({
      persist: () => made.promise,
      apply: (project, data) => named(data?.id ?? 'sample')(project),
    })
    const failing = s.queue.run({ apply: named('x'), persist: async () => refused })
    expect(s.names()).toEqual(['x'])
    made.resolve({ ok: true, data: { id: 'uuid-1' } })
    await created
    expect(await failing).toBe(false)
    expect(s.names()).toEqual(['uuid-1'])
  })

  it('saves nothing in sample mode and applies creates without an id', async () => {
    const s = setup(true)
    const persist = vi.fn(async () => saved)
    const create = vi.fn(async () => ({ ok: true as const, data: { id: 'x' } }))
    expect(await s.queue.run({ apply: named('a'), persist })).toBe(true)
    expect(
      await s.queue.create<{ id: string }>({
        persist: create,
        apply: (project, data) => named(data === null ? 'sample' : data.id)(project),
      }),
    ).toBe(true)
    expect(persist).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
    expect(s.names()).toEqual(['a', 'sample'])
  })

  it('turns read only on the lock sentence: later edits neither apply nor save', async () => {
    const s = setup()
    await s.queue.run({ apply: named('a'), persist: async () => ({ ok: false, error: LOCKED }) })
    expect(s.onLocked).toHaveBeenCalledTimes(1)
    const persist = vi.fn(async () => saved)
    expect(await s.queue.run({ apply: named('b'), persist })).toBe(false)
    expect(persist).not.toHaveBeenCalled()
    expect(s.names()).toEqual([])
  })

  it('builds a payload when the job runs, after an earlier create has applied', async () => {
    const s = setup()
    const made = later<ActionResult<{ id: string }>>()
    const created = s.queue.create<{ id: string }>({
      persist: () => made.promise,
      apply: (project, data) => named(data?.id ?? 'sample')(project),
    })
    let payload = ''
    const saving = s.queue.run({
      apply: (project) => project,
      persist: async () => {
        payload = s.names().join()
        return saved
      },
    })
    made.resolve({ ok: true, data: { id: 'uuid-1' } })
    await created
    await saving
    expect(payload).toBe('uuid-1')
  })

  it('applies nothing for a refused create and cancels the edits queued behind it', async () => {
    const s = setup()
    const created = s.queue.create<{ id: string }>({
      persist: async () => refused,
      apply: (project, data) => named(data?.id ?? 'sample')(project),
    })
    const persist = vi.fn(async () => saved)
    const behind = s.queue.run({ apply: named('x'), persist })
    expect(await created).toBe(false)
    expect(await behind).toBe(false)
    expect(persist).not.toHaveBeenCalled()
    expect(s.names()).toEqual([])
  })

  it('applies undo on top of the edits queued behind the failed one', async () => {
    const s = setup()
    const a = s.queue.run({
      apply: named('a'),
      persist: async () => refused,
      undo: (project) => ({
        ...project,
        collections: (project.collections ?? []).filter((c) => c.id !== 'a'),
      }),
    })
    const b = s.queue.run({ apply: named('b'), persist: async () => saved })
    expect(s.names()).toEqual(['a', 'b'])
    expect(await a).toBe(false)
    expect(await b).toBe(false)
    expect(s.names()).toEqual([])
  })
})

describe('getQueue', () => {
  it('shares one chain per collection', async () => {
    let project: ArtProject = {
      collections: [],
      canvas: null,
      seed: 1,
      staleNote: null,
      showBlankTraits: false,
    }
    const options = {
      demo: false,
      read: () => project,
      write: (next: ArtProject) => {
        project = next
      },
      notify: () => {},
      onLocked: () => {},
    }
    const first = getQueue('shared', options)
    const second = getQueue('shared', options)
    expect(second).toBe(first)
    const slow = later<ActionResult>()
    const calls: string[] = []
    const a = first.run({
      apply: (p) => p,
      persist: () => {
        calls.push('first')
        return slow.promise
      },
    })
    const b = second.run({
      apply: (p) => p,
      persist: async () => {
        calls.push('second')
        return saved
      },
    })
    await tick()
    expect(calls).toEqual(['first'])
    slow.resolve(saved)
    await a
    await b
    expect(calls).toEqual(['first', 'second'])
  })
})
