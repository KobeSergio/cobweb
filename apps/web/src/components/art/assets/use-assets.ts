'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { UploadedAsset } from '@/lib/demo'
import { checkImageFiles, releaseChecked, type CheckedFile } from '../lib/image-checks'
import { checkMediaFile, type CheckedMedia } from './media'
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

export function fromChecked(entry: CheckedFile): AssetItem {
  return {
    key: entry.key,
    fileName: entry.file.name,
    url: entry.url,
    mediaType: 'image',
    quantity: 1,
    attributes: [],
    bytes: entry.file.size,
    owned: true,
  }
}

/** A single-asset file that passed the media checks: an image, a GIF or an MP4 video. */
export function fromMedia(entry: CheckedMedia): AssetItem {
  return {
    key: entry.key,
    fileName: entry.file.name,
    url: entry.url,
    mediaType: entry.mediaType ?? 'image',
    quantity: 1,
    attributes: [],
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

/**
 * The uploaded artworks for a 1/1 or single asset project, and the checks on files being added.
 * Files are read with object URLs and never leave the browser.
 *
 * Seam: replace with the uploads table (Phase 3) and storage uploads. `items` becomes the rows,
 * `add` and `replace` start an upload, and `remove` deletes the row and the stored object.
 */
export function useAssetItems(initial: UploadedAsset[], announce: (text: string) => void) {
  const [items, setItems] = useState<AssetItem[]>(() => initial.map(fromSample))
  const [rejected, setRejected] = useState<RejectedFile[]>([])
  const [checking, setChecking] = useState(0)
  const latest = useRef(items)

  useEffect(() => {
    latest.current = items
  }, [items])
  useEffect(() => () => revoke(latest.current), [])

  const check = useCallback(async (files: File[]) => {
    setChecking((count) => count + files.length)
    try {
      const checked = await checkImageFiles(files, ASSET_IMAGE_RULES)
      const good = checked.filter((entry) => entry.errors.length === 0)
      const bad = checked.filter((entry) => entry.errors.length > 0)
      releaseChecked(bad)
      setRejected((current) => [
        ...current,
        ...bad.map((entry) => ({ key: entry.key, fileName: entry.file.name, errors: entry.errors })),
      ])
      return { good, bad }
    } finally {
      setChecking((count) => count - files.length)
    }
  }, [])

  const add = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return
      const { good, bad } = await check(files)
      setItems((current) => [...current, ...good.map(fromChecked)])
      announce(
        bad.length === 0
          ? `Added ${plural(good.length, 'file')}.`
          : `Added ${good.length.toLocaleString('en-US')} of ${plural(files.length, 'file')}. ${plural(bad.length, 'file')} could not be used.`,
      )
    },
    [check, announce],
  )

  /**
   * Single asset: the one file is replaced, and its quantity is kept by the caller. Unlike 1/1s it
   * may be a GIF or an MP4 video (decision D28), so it goes through the media checks.
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
        setRejected((current) => [
          ...current,
          { key: checked.key, fileName: file.name, errors: checked.errors },
        ])
        announce(`${file.name} could not be used.`)
        return
      }
      setItems((current) => {
        revoke(current)
        return [fromMedia(checked)]
      })
      announce(`Replaced the artwork with ${file.name}.`)
    },
    [announce],
  )

  const remove = useCallback(
    (key: string) => {
      const gone = latest.current.find((item) => item.key === key)
      if (!gone) return
      revoke([gone])
      setItems((current) => current.filter((item) => item.key !== key))
      announce(`Removed ${gone.fileName}.`)
    },
    [announce],
  )

  const setQuantity = useCallback((key: string, quantity: number) => {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, quantity } : item)))
  }, [])

  const setAttributes = useCallback((key: string, attributes: Attribute[]) => {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, attributes } : item)))
  }, [])

  const dismissRejected = useCallback((key?: string) => {
    setRejected((current) => (key ? current.filter((entry) => entry.key !== key) : []))
  }, [])

  return { items, rejected, checking, add, replace, remove, setQuantity, setAttributes, dismissRejected }
}
