'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { setAssetOrder, updateAsset } from '@/app/actions/art/assets'
import type { UploadedAsset } from '@/lib/demo'
import { checkImageFiles, releaseChecked, type CheckedFile } from '../lib/image-checks'
import { useArtSync } from '../state/art-sync'
import type { QueueItem } from '../uploads/upload-queue'
import { adoptRecords } from './stored'
import { checkMediaFile, type CheckedMedia } from './media'
import { needsDetails, orderRows } from './saves'
import {
  attributesForReplacement,
  fileNameAttribute,
  inBatches,
  sortIncoming,
  withAttribute,
  withoutTraitType,
} from './token-list'
import { ASSET_IMAGE_RULES, type AssetItem, type Attribute, type RejectedFile } from './types'

/** A polite live-region message that changes each time, so screen readers announce repeats. */
export function useAnnouncer() {
  const [message, setMessage] = useState('')
  const flip = useRef(false)
  const announce = useCallback((text: string) => {
    flip.current = !flip.current
    setMessage(flip.current ? text : `${text} `)
  }, [])
  return { message, announce }
}

export function fromSample(asset: UploadedAsset): AssetItem {
  return {
    key: `sample-${asset.id}`,
    fileName: asset.fileName,
    url: asset.imageUrl,
    mediaType: asset.mediaType,
    quantity: asset.quantity,
    attributes: asset.attributes,
    bytes: null,
    owned: false,
    uploadId: asset.uploadId ?? null,
    addedAt: asset.addedAt ?? asset.id,
  }
}

/** A 1/1 image that passed its checks. With `nameAttribute`, it starts with Name: <file name>, as legacy. */
export function fromChecked(entry: CheckedFile, nameAttribute = true): AssetItem {
  return {
    key: entry.key,
    fileName: entry.file.name,
    url: entry.url,
    mediaType: 'image',
    quantity: 1,
    attributes: nameAttribute ? [fileNameAttribute(entry.file.name)] : [],
    bytes: entry.file.size,
    owned: true,
    uploadId: null,
    addedAt: Date.now(),
  }
}

/** A single-asset file that passed the media checks: an image, a GIF or an MP4 video. */
export function fromMedia(entry: CheckedMedia, attributes: Attribute[]): AssetItem {
  return {
    key: entry.key,
    fileName: entry.file.name,
    url: entry.url,
    mediaType: entry.mediaType ?? 'image',
    quantity: 1,
    attributes,
    bytes: entry.file.size,
    owned: true,
    uploadId: null,
    addedAt: Date.now(),
  }
}

function revoke(items: AssetItem[]) {
  for (const item of items) if (item.owned) URL.revokeObjectURL(item.url)
}

function plural(count: number, word: string) {
  return `${count.toLocaleString('en-US')} ${word}${count === 1 ? '' : 's'}`
}

/** Where accepted files go to be uploaded (the upload queue), how a removed one is dropped, and how a stored one is deleted. */
export type AssetUploads = {
  add: (entries: { id: string; file: File; label: string }[]) => void
  remove: (id: string) => void
  deleteStored: (uploadId: string) => Promise<{ ok: true } | { error: string }>
}

let repeatCounter = 0

/**
 * The artworks for a 1/1 or single asset project, and the checks on files being added. Files are
 * checked 25 at a time; each batch that passes is listed at once (previewed from object URLs) and
 * handed to `uploads`, the upload queue, under the item's key. Hidden files are skipped
 * and a file already in the list (same name and size) is refused.
 *
 * Finished uploads are adopted from `queueItems`: the item switches to its served URL and upload id,
 * and removing it deletes the row and the object. Editions, attributes and the list order are saved
 * as they change, 250 ms after the last edit of an item; an edit made while a file uploads is saved
 * once its row exists.
 */
export function useAssetItems(
  collectionId: string,
  initial: UploadedAsset[],
  announce: (text: string) => void,
  uploads: AssetUploads,
  queueItems: readonly QueueItem[],
) {
  const [items, setItems] = useState<AssetItem[]>(() => initial.map(fromSample))
  const [rejected, setRejected] = useState<RejectedFile[]>([])
  const [checking, setChecking] = useState(0)
  const latest = useRef(items)
  const sync = useArtSync()
  /** The values each stored row holds, for a rollback when a save fails. */
  const saved = useRef(
    new Map<string, { quantity: number; attributes: Attribute[] }>(
      initial.flatMap((asset) =>
        asset.uploadId
          ? [[asset.uploadId, { quantity: asset.quantity, attributes: asset.attributes }] as const]
          : [],
      ),
    ),
  )
  /** Upload ids already in the list, so a newly stored file can be told apart. */
  const known = useRef(new Set(initial.flatMap((asset) => (asset.uploadId ? [asset.uploadId] : []))))

  /** Saves one item's editions and attributes 250 ms after its last edit; a file still uploading waits. */
  const saveDetails = useCallback(
    (key: string) =>
      sync.debounce.schedule(`asset:${key}`, () => {
        const item = latest.current.find((candidate) => candidate.key === key)
        if (!item?.uploadId) return
        const uploadId = item.uploadId
        const patch = { quantity: item.quantity, attributes: item.attributes }
        void sync
          .run({ apply: (p) => p, persist: () => updateAsset(collectionId, uploadId, patch) })
          .then((ok) => {
            if (ok) {
              saved.current.set(uploadId, patch)
              return
            }
            const back = saved.current.get(uploadId)
            if (back)
              setItems((current) =>
                current.map((other) => (other.uploadId === uploadId ? { ...other, ...back } : other)),
              )
          })
      }),
    [collectionId, sync],
  )

  /** Saves the list order 250 ms after the last change to it. */
  const saveOrder = useCallback(
    () =>
      sync.debounce.schedule('asset-order', () => {
        const rows = orderRows(latest.current)
        if (rows.length) void sync.run({ apply: (p) => p, persist: () => setAssetOrder(collectionId, rows) })
      }),
    [collectionId, sync],
  )

  // A file that has just been stored: its place in the list, and any edit made while it uploaded.
  useEffect(() => {
    const fresh = items.filter((item) => item.uploadId && !known.current.has(item.uploadId))
    if (fresh.length === 0) return
    for (const item of fresh) {
      known.current.add(item.uploadId!)
      saved.current.set(item.uploadId!, { quantity: 1, attributes: [] })
      if (needsDetails(item)) saveDetails(item.key)
    }
    saveOrder()
  }, [items, saveDetails, saveOrder])

  useEffect(() => {
    latest.current = items
  }, [items])
  useEffect(() => () => revoke(latest.current), [])
  useEffect(() => {
    setItems((current) => {
      const change = adoptRecords(current, queueItems)
      if (!change) return current
      // Revoking twice (StrictMode runs updaters twice) is harmless.
      for (const url of change.revoke) URL.revokeObjectURL(url)
      return change.items
    })
  }, [queueItems])

  const reject = useCallback((entries: RejectedFile[]) => {
    if (entries.length > 0) setRejected((current) => [...current, ...entries])
  }, [])

  const add = useCallback(
    async (files: File[], options: { nameAttribute: boolean } = { nameAttribute: true }) => {
      if (files.length === 0) return
      const { fresh, hidden, repeated } = sortIncoming(files, latest.current)
      reject(
        repeated.map((file) => ({
          key: `repeat-${++repeatCounter}`,
          fileName: file.name,
          errors: ['Already added. Raise its editions instead of adding it twice.'],
        })),
      )
      let added = 0
      let failed = 0
      setChecking((count) => count + fresh.length)
      for (const batch of inBatches(fresh)) {
        let checked: CheckedFile[]
        try {
          checked = await checkImageFiles(batch, ASSET_IMAGE_RULES)
        } finally {
          setChecking((count) => count - batch.length)
        }
        const good = checked.filter((entry) => entry.errors.length === 0)
        const bad = checked.filter((entry) => entry.errors.length > 0)
        releaseChecked(bad)
        reject(bad.map((entry) => ({ key: entry.key, fileName: entry.file.name, errors: entry.errors })))
        setItems((current) => [...current, ...good.map((entry) => fromChecked(entry, options.nameAttribute))])
        uploads.add(good.map((entry) => ({ id: entry.key, file: entry.file, label: entry.file.name })))
        added += good.length
        failed += bad.length
      }
      const notes = [
        failed + repeated.length > 0 ? `${plural(failed + repeated.length, 'file')} could not be used.` : '',
        hidden.length > 0 ? `Skipped ${plural(hidden.length, 'hidden file')}.` : '',
      ].filter(Boolean)
      announce([`Added ${plural(added, 'file')}.`, ...notes].join(' '))
    },
    [announce, reject, uploads],
  )

  /**
   * Single asset: the one file is replaced; its quantity is kept by the caller, its attributes are
   * kept here (the Name attribute follows the new file). Unlike 1/1s it may be a GIF or an MP4
   * video (MASTER_PLAN, Art: media types), so it goes through the media checks.
   */
  const replace = useCallback(
    async (file: File | undefined, keepQuantity?: number) => {
      if (!file) return
      setChecking((count) => count + 1)
      let checked: CheckedMedia
      try {
        checked = await checkMediaFile(file)
      } finally {
        setChecking((count) => count - 1)
      }
      if (checked.errors.length > 0) {
        URL.revokeObjectURL(checked.url)
        reject([{ key: checked.key, fileName: file.name, errors: checked.errors }])
        announce(`${file.name} could not be used.`)
        return
      }
      const previous = latest.current[0]
      const attributes = attributesForReplacement(
        previous?.attributes ?? [],
        previous?.fileName ?? null,
        file.name,
      )
      for (const item of latest.current) {
        uploads.remove(item.key)
        if (item.uploadId)
          void uploads.deleteStored(item.uploadId).then((result) => {
            if ('error' in result) announce(result.error)
          })
      }
      setItems((current) => {
        revoke(current)
        // The single asset keeps its quantity when the file is replaced.
        return [{ ...fromMedia(checked, attributes), quantity: keepQuantity ?? 1 }]
      })
      uploads.add([{ id: checked.key, file, label: file.name }])
      announce(previous ? `Replaced the artwork with ${file.name}.` : `Added ${file.name}.`)
    },
    [announce, reject, uploads],
  )

  /** Removes files with all their editions; later token ids close up (legacy delete renumbering). */
  const removeMany = useCallback(
    (keys: string[]) => {
      const drop = new Set(keys)
      const gone = latest.current.filter((item) => drop.has(item.key))
      if (gone.length === 0) return
      revoke(gone)
      for (const item of gone) {
        uploads.remove(item.key)
        if (item.uploadId)
          void uploads.deleteStored(item.uploadId).then((result) => {
            if ('error' in result) announce(result.error)
          })
      }
      setItems((current) => current.filter((item) => !drop.has(item.key)))
      announce(
        gone.length === 1 ? `Removed ${gone[0]!.fileName}.` : `Removed ${plural(gone.length, 'file')}.`,
      )
    },
    [announce, uploads],
  )
  const remove = useCallback((key: string) => removeMany([key]), [removeMany])

  const update = useCallback(
    (keys: string[], change: (item: AssetItem) => AssetItem) => {
      const target = new Set(keys)
      setItems((current) => current.map((item) => (target.has(item.key) ? change(item) : item)))
      for (const key of keys) saveDetails(key)
    },
    [saveDetails],
  )

  /** Puts the list in a new order and saves it (the token ids follow the saved order). */
  const reorder = useCallback(
    (order: (items: AssetItem[]) => AssetItem[]) => {
      setItems((current) => order(current))
      saveOrder()
    },
    [saveOrder],
  )

  const setQuantity = useCallback(
    (key: string, quantity: number) => update([key], (item) => ({ ...item, quantity })),
    [update],
  )
  const setQuantityMany = useCallback(
    (keys: string[], quantity: number) => update(keys, (item) => ({ ...item, quantity })),
    [update],
  )
  const setAttributes = useCallback(
    (key: string, attributes: Attribute[]) => update([key], (item) => ({ ...item, attributes })),
    [update],
  )
  /** Bulk edit (legacy "custom layers" applied to a whole batch): set or clear one trait type. */
  const applyAttribute = useCallback(
    (keys: string[], attribute: Attribute) =>
      update(keys, (item) => ({ ...item, attributes: withAttribute(item.attributes, attribute) })),
    [update],
  )
  const clearTraitType = useCallback(
    (keys: string[], traitType: string) =>
      update(keys, (item) => ({ ...item, attributes: withoutTraitType(item.attributes, traitType) })),
    [update],
  )

  const dismissRejected = useCallback((key?: string) => {
    setRejected((current) => (key ? current.filter((entry) => entry.key !== key) : []))
  }, [])

  return {
    items,
    rejected,
    checking,
    add,
    replace,
    remove,
    removeMany,
    reorder,
    setQuantity,
    setQuantityMany,
    setAttributes,
    applyAttribute,
    clearTraitType,
    dismissRejected,
  }
}
