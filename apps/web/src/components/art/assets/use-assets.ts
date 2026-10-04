'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { UploadedAsset } from '@/lib/demo'
import { checkImageFiles, releaseChecked, type CheckedFile } from '../lib/image-checks'
import { checkMediaFile, type CheckedMedia } from './media'
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
  }
}

function revoke(items: AssetItem[]) {
  for (const item of items) if (item.owned) URL.revokeObjectURL(item.url)
}

function plural(count: number, word: string) {
  return `${count.toLocaleString('en-US')} ${word}${count === 1 ? '' : 's'}`
}

/** Where accepted files go to be uploaded (the resumable queue), and how a removed one is dropped. */
export type AssetUploads = {
  add: (entries: { id: string; file: File; label: string }[]) => void
  remove: (id: string) => void
}

let repeatCounter = 0

/**
 * The artworks for a 1/1 or single asset project, and the checks on files being added. Files are
 * checked 25 at a time; each batch that passes is listed at once (previewed from object URLs) and
 * handed to `uploads`, the resumable upload queue, under the item's key. Hidden files are skipped
 * and a file already in the list (same name and size) is refused.
 *
 * Seam: replace with the uploads table (Phase 3). `items` becomes the rows, and `remove` deletes
 * the row and the stored object as well as cancelling the upload.
 */
export function useAssetItems(
  initial: UploadedAsset[],
  announce: (text: string) => void,
  uploads: AssetUploads,
) {
  const [items, setItems] = useState<AssetItem[]>(() => initial.map(fromSample))
  const [rejected, setRejected] = useState<RejectedFile[]>([])
  const [checking, setChecking] = useState(0)
  const latest = useRef(items)

  useEffect(() => {
    latest.current = items
  }, [items])
  useEffect(() => () => revoke(latest.current), [])

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
    async (file: File | undefined) => {
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
      for (const item of latest.current) uploads.remove(item.key)
      setItems((current) => {
        revoke(current)
        return [fromMedia(checked, attributes)]
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
      for (const item of gone) uploads.remove(item.key)
      setItems((current) => current.filter((item) => !drop.has(item.key)))
      announce(
        gone.length === 1 ? `Removed ${gone[0]!.fileName}.` : `Removed ${plural(gone.length, 'file')}.`,
      )
    },
    [announce, uploads],
  )
  const remove = useCallback((key: string) => removeMany([key]), [removeMany])

  const update = useCallback((keys: string[], change: (item: AssetItem) => AssetItem) => {
    const target = new Set(keys)
    setItems((current) => current.map((item) => (target.has(item.key) ? change(item) : item)))
  }, [])

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
    setQuantity,
    setQuantityMany,
    setAttributes,
    applyAttribute,
    clearTraitType,
    dismissRejected,
  }
}
