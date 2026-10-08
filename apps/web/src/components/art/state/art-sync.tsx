'use client'

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { readProject, seedProject, writeProject, type ArtProject } from './art-store'
import { ArtSyncQueue, type SyncCreate, type SyncEdit } from './art-sync-queue'
import { EDIT_DEBOUNCE_MS, KeyedDebounce } from './keyed-debounce'

export type ArtSync = {
  /** Sample mode: edits apply on screen and nothing is saved. */
  demo: boolean
  /** A save came back with the lock sentence: every Art control turns read only until the next load. */
  locked: boolean
  run: (edit: SyncEdit) => Promise<boolean>
  create: <T>(edit: SyncCreate<T>) => Promise<boolean>
  /** The project as it is now, outside the render (for debounced saves). */
  read: () => ArtProject
  /**
   * Weight, size, text and asset edits wait 250 ms per key before they are saved. A create must
   * call `debounce.flush(key)` (or `flushAll()`) for the keys it affects before it joins the queue,
   * so the earlier edits are queued ahead of it.
   *
   * Lazy payloads: `persist` runs only when the edit's turn comes, after every earlier edit and
   * create has been saved and applied. A save that depends on the store (the weight table of a
   * layer, which a trait create changes) must read `read()` inside `persist`, never when the
   * timer fires or the edit is made.
   */
  debounce: KeyedDebounce
}

const ArtSyncContext = createContext<ArtSync | null>(null)

/**
 * Wraps the Art screens of one collection: seeds the browser store from the loaded rows and saves
 * every edit through `ArtSyncQueue` (spec section 5). Errors show as toasts.
 */
export function ArtSyncProvider({
  collectionId,
  demo,
  initial,
  children,
}: {
  collectionId: string
  demo: boolean
  /** The loaded project; absent in sample mode and for projects without layers. */
  initial?: ArtProject
  children: ReactNode
}) {
  const [locked, setLocked] = useState(false)
  const [queue] = useState(() => {
    // The store is module state; seed it in the browser only, never on the server.
    if (initial && typeof window !== 'undefined') seedProject(collectionId, initial)
    return new ArtSyncQueue({
      demo,
      read: () => readProject(collectionId),
      write: (project) => writeProject(collectionId, project),
      notify: (message) => toast.error(message),
      onLocked: () => setLocked(true),
    })
  })
  const [debounce] = useState(() => new KeyedDebounce(EDIT_DEBOUNCE_MS))
  // Leaving the Art stage saves what is still waiting.
  useEffect(() => () => debounce.flushAll(), [debounce])

  const value = useMemo<ArtSync>(
    () => ({
      demo,
      locked,
      run: (edit) => queue.run(edit),
      create: <T,>(edit: SyncCreate<T>) => queue.create(edit),
      read: () => readProject(collectionId),
      debounce,
    }),
    [demo, locked, queue, debounce, collectionId],
  )
  return <ArtSyncContext value={value}>{children}</ArtSyncContext>
}

export function useArtSync(): ArtSync {
  const sync = useContext(ArtSyncContext)
  if (!sync) throw new Error('useArtSync is used outside ArtSyncProvider (the Art layout provides it).')
  return sync
}
