'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { UploadedAsset } from '@/lib/demo'
import { checkImageFiles } from '../lib/image-checks'
import { checkJson, evaluate, fileNumber, isJsonFile, type StagedImage, type StagedJson } from './metadata'
import { ASSET_IMAGE_RULES, type AssetItem } from './types'
import { fromSample } from './use-assets'

let counter = 0

function revokeImages(images: StagedImage[]) {
  for (const image of images) URL.revokeObjectURL(image.url)
}

/**
 * A metadata project: images and JSON files dropped together, checked against the strict rules
 * in the browser. While nothing is dropped, or the drop fails a rule, the saved set stays on show.
 * When every rule passes, the dropped files become the set.
 *
 * Seam: replace with the uploads table (Phase 3). The server repeats these checks on the stored
 * files; this stays as the fast first pass.
 */
export function useMetadata(initial: UploadedAsset[], announce: (text: string) => void) {
  const [images, setImages] = useState<StagedImage[]>([])
  const [jsons, setJsons] = useState<StagedJson[]>([])
  const [checking, setChecking] = useState(0)
  const latest = useRef(images)

  useEffect(() => {
    latest.current = images
  }, [images])
  useEffect(() => () => revokeImages(latest.current), [])

  const report = useMemo(() => evaluate(images, jsons), [images, jsons])
  const staged = images.length > 0 || jsons.length > 0

  const items = useMemo<AssetItem[]>(() => {
    if (!report.ok) return initial.map(fromSample)
    return report.pairs.map((number) => {
      const image = images.find((entry) => entry.number === number)!
      const json = jsons.find((entry) => entry.number === number)!
      return {
        key: `meta-${number}`,
        fileName: image.fileName,
        url: image.url,
        mediaType: 'image' as const,
        quantity: 1,
        attributes: json.attributes,
        bytes: image.bytes,
        owned: false,
      }
    })
  }, [report, images, jsons, initial])

  const add = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return
      setChecking((count) => count + files.length)
      try {
        const jsonFiles = files.filter(isJsonFile)
        const imageFiles = files.filter((file) => !isJsonFile(file))
        const nextJsons: StagedJson[] = []
        for (const file of jsonFiles)
          nextJsons.push(checkJson(`json-${++counter}`, file.name, await file.text(), file.size))
        const checked = await checkImageFiles(imageFiles, ASSET_IMAGE_RULES)
        const nextImages: StagedImage[] = checked.map((entry) => ({
          key: entry.key,
          fileName: entry.file.name,
          number: fileNumber(entry.file.name),
          url: entry.url,
          bytes: entry.file.size,
          issues: entry.errors.map((message) => ({ rule: 'size' as const, message })),
        }))
        // A file dropped again replaces the one with the same name.
        const names = new Set(nextImages.map((image) => image.fileName))
        const dropped = latest.current.filter((image) => names.has(image.fileName))
        revokeImages(dropped)
        setImages((current) => [...current.filter((image) => !names.has(image.fileName)), ...nextImages])
        const jsonNames = new Set(nextJsons.map((json) => json.fileName))
        setJsons((current) => [...current.filter((json) => !jsonNames.has(json.fileName)), ...nextJsons])
        announce(`Checked ${files.length.toLocaleString('en-US')} ${files.length === 1 ? 'file' : 'files'}.`)
      } finally {
        setChecking((count) => count - files.length)
      }
    },
    [announce],
  )

  const clear = useCallback(() => {
    revokeImages(latest.current)
    setImages([])
    setJsons([])
    announce('Cleared the dropped files.')
  }, [announce])

  return {
    items,
    report,
    staged,
    checking,
    fileCounts: { images: images.length, jsons: jsons.length },
    add,
    clear,
  }
}
