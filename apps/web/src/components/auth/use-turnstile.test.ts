import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TurnstileApi } from '@/lib/turnstile'
import { useTurnstile } from './use-turnstile'

/**
 * `useTurnstile` runs here on a small stand-in for React's four hooks, since this package's tests run in Node with no
 * DOM and so have no renderer to mount a component into. The stand-in keeps what the hook relies on: a state setter
 * re-renders the hook when the value changed, refs and callbacks keep their identity, and an effect runs after a
 * render whose dependencies changed, its last cleanup first.
 */
const react = vi.hoisted(() => {
  type Effect = {
    run: () => void | (() => void)
    deps: readonly unknown[]
    cleanup: (() => void) | undefined
    due: boolean
  }
  type State = { value: unknown; set: (next: unknown) => void }
  type Mounted = {
    hook: () => unknown
    result: unknown
    states: State[]
    refs: { current: unknown }[]
    callbacks: { fn: unknown; deps: readonly unknown[] }[]
    effects: Effect[]
    at: { state: number; ref: number; callback: number; effect: number }
    dirty: boolean
    busy: boolean
  }

  let rendering: Mounted | null = null

  function inRender(): Mounted {
    if (!rendering) throw new Error('A hook was called outside a render.')
    return rendering
  }

  function same(a: readonly unknown[], b: readonly unknown[]) {
    return a.length === b.length && a.every((value, index) => Object.is(value, b[index]))
  }

  /** A render and its commit, and again while a state change is waiting. */
  function settle(mounted: Mounted) {
    mounted.busy = true
    try {
      for (let pass = 1; ; pass++) {
        if (pass > 20) throw new Error('The hook kept re-rendering.')
        mounted.dirty = false
        mounted.at = { state: 0, ref: 0, callback: 0, effect: 0 }
        rendering = mounted
        try {
          mounted.result = mounted.hook()
        } finally {
          rendering = null
        }
        const due = mounted.effects.filter((effect) => effect.due)
        for (const effect of due) {
          effect.cleanup?.()
          effect.cleanup = undefined
        }
        for (const effect of due) {
          effect.due = false
          const cleanup = effect.run()
          effect.cleanup = typeof cleanup === 'function' ? cleanup : undefined
        }
        if (!mounted.dirty) return
      }
    } finally {
      mounted.busy = false
    }
  }

  function useState<S>(initial: S): [S, (next: S) => void] {
    const mounted = inRender()
    const index = mounted.at.state++
    let state = mounted.states[index]
    if (!state) {
      const created: State = {
        value: initial,
        set: (next) => {
          if (Object.is(created.value, next)) return
          created.value = next
          mounted.dirty = true
          if (!mounted.busy) settle(mounted)
        },
      }
      mounted.states[index] = created
      state = created
    }
    return [state.value as S, state.set]
  }

  function useRef<T>(initial: T): { current: T } {
    const mounted = inRender()
    const index = mounted.at.ref++
    return (mounted.refs[index] ??= { current: initial }) as { current: T }
  }

  function useCallback<F>(fn: F, deps: readonly unknown[]): F {
    const mounted = inRender()
    const index = mounted.at.callback++
    const kept = mounted.callbacks[index]
    if (kept && same(kept.deps, deps)) return kept.fn as F
    mounted.callbacks[index] = { fn, deps }
    return fn
  }

  function useEffect(run: () => void | (() => void), deps: readonly unknown[]) {
    const mounted = inRender()
    const index = mounted.at.effect++
    const kept = mounted.effects[index]
    if (!kept) mounted.effects[index] = { run, deps, cleanup: undefined, due: true }
    else if (!same(kept.deps, deps)) Object.assign(kept, { run, deps, due: true })
  }

  /** Renders the hook once and answers its latest result. */
  function mount<T>(hook: () => T) {
    const mounted: Mounted = {
      hook,
      result: undefined,
      states: [],
      refs: [],
      callbacks: [],
      effects: [],
      at: { state: 0, ref: 0, callback: 0, effect: 0 },
      dirty: false,
      busy: false,
    }
    settle(mounted)
    return {
      get current() {
        return mounted.result as T
      },
    }
  }

  return { useCallback, useEffect, useRef, useState, mount }
})
vi.mock('react', () => ({
  useCallback: react.useCallback,
  useEffect: react.useEffect,
  useRef: react.useRef,
  useState: react.useState,
}))

const turnstile = vi.hoisted(() => ({ loadTurnstile: vi.fn<() => Promise<TurnstileApi>>() }))
vi.mock('@/lib/turnstile', () => turnstile)

const SITE_KEY = '1x00000000000000000000AA'

/** Waits for the promises the hook started to settle. */
const settled = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/** A container the hook can be handed; the stand-in never touches it. */
const containerElement = () => ({}) as HTMLDivElement

/** A Turnstile that records each widget's options, and calls a widget's callbacks as the script would. */
function fakeTurnstile() {
  const widgets: Record<string, unknown>[] = []
  const api = {
    render: vi.fn((_container: HTMLElement, options: Record<string, unknown>) => {
      widgets.push(options)
      return `widget-${widgets.length}`
    }),
    reset: vi.fn<(widgetId: string) => void>(),
    remove: vi.fn<(widgetId: string) => void>(),
  } satisfies TurnstileApi
  const call = (widget: number, callback: string, ...given: unknown[]) =>
    (widgets[widget - 1]![callback] as (...args: unknown[]) => void)(...given)
  return { api, call }
}

describe('useTurnstile (docs/specs/2026-10-17-production-hardening.md, section 6.1)', () => {
  beforeEach(() => {
    turnstile.loadTurnstile.mockReset()
  })

  it('is ready and renders nothing without a site key', async () => {
    const hook = react.mount(() => useTurnstile(null))
    hook.current.container(containerElement())
    await settled()
    expect(turnstile.loadTurnstile).not.toHaveBeenCalled()
    expect(hook.current).toMatchObject({ ready: true, failed: false })
    expect(hook.current.token()).toBeNull()
  })

  it("renders Turnstile's widget into its container and holds the token it answers", async () => {
    const { api, call } = fakeTurnstile()
    turnstile.loadTurnstile.mockResolvedValue(api)
    const container = containerElement()
    const hook = react.mount(() => useTurnstile(SITE_KEY))
    expect(hook.current).toMatchObject({ ready: false, failed: false })
    hook.current.container(container)
    await settled()
    expect(api.render).toHaveBeenCalledOnce()
    expect(api.render).toHaveBeenCalledWith(
      container,
      expect.objectContaining({
        sitekey: SITE_KEY,
        action: 'sign-in',
        appearance: 'interaction-only',
        size: 'flexible',
        theme: 'dark',
        'refresh-expired': 'auto',
      }),
    )
    expect(hook.current.ready).toBe(false)
    call(1, 'callback', 'token-1')
    expect(hook.current).toMatchObject({ ready: true, failed: false })
    expect(hook.current.token()).toBe('token-1')
  })

  it('drops the held token when its container goes away, so the next wallet waits for a new one', async () => {
    const { api, call } = fakeTurnstile()
    turnstile.loadTurnstile.mockResolvedValue(api)
    const hook = react.mount(() => useTurnstile(SITE_KEY))
    hook.current.container(containerElement())
    await settled()
    call(1, 'callback', 'token-1')
    expect(hook.current.ready).toBe(true)

    // "Use a different wallet": the container unmounts and the widget goes with it.
    hook.current.container(null)
    expect(api.remove).toHaveBeenCalledWith('widget-1')
    expect(hook.current.token()).toBeNull()
    expect(hook.current.ready).toBe(false)

    // The next wallet connects: the button stays on its check until the new widget answers.
    hook.current.container(containerElement())
    await settled()
    expect(api.render).toHaveBeenCalledTimes(2)
    expect(hook.current.ready).toBe(false)
    call(2, 'callback', 'token-2')
    expect(hook.current.ready).toBe(true)
    expect(hook.current.token()).toBe('token-2')
  })

  it('renders nothing, and does not fail, when its container goes away before the script has loaded', async () => {
    const { api } = fakeTurnstile()
    let loaded: (api: TurnstileApi) => void = () => {}
    turnstile.loadTurnstile.mockReturnValue(
      new Promise<TurnstileApi>((resolve) => {
        loaded = resolve
      }),
    )
    const hook = react.mount(() => useTurnstile(SITE_KEY))
    hook.current.container(containerElement())
    hook.current.container(null)
    loaded(api)
    await settled()
    expect(api.render).not.toHaveBeenCalled()
    expect(hook.current).toMatchObject({ ready: false, failed: false })
  })

  it('fails when the script cannot load', async () => {
    turnstile.loadTurnstile.mockRejectedValue(new Error('The browser check could not load.'))
    const hook = react.mount(() => useTurnstile(SITE_KEY))
    hook.current.container(containerElement())
    await settled()
    expect(hook.current).toMatchObject({ ready: false, failed: true })
  })

  it('fails, and holds no widget, when Turnstile refuses to render one', async () => {
    const { api } = fakeTurnstile()
    api.render.mockImplementation(() => {
      throw new Error('Invalid input for parameter "sitekey".')
    })
    turnstile.loadTurnstile.mockResolvedValue(api)
    const hook = react.mount(() => useTurnstile(SITE_KEY))
    hook.current.container(containerElement())
    await settled()
    expect(hook.current).toMatchObject({ ready: false, failed: true })
    hook.current.reset()
    expect(api.reset).not.toHaveBeenCalled()
  })
})
