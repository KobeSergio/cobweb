'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { importLayers } from '@/app/actions/art/layers'
import type { ImportResult } from '@/lib/art/schemas'
import { checkImageFiles, LAYER_IMAGE_RULES } from '../../lib/image-checks'
import { useArtSync } from '../../state/art-sync'
import { createUploader } from '../../uploads/create-uploader'
import { queueTotals, useUploadQueue } from '../../uploads/upload-queue'
import {
  countTraits,
  detectProject,
  traitNameFromFile,
  type DetectedProject,
  type PathedFile,
} from './folder-tree'
import { applyImport, importPayload, mergeUpload, type UploadedImage } from './to-layers'

/** One image's checks: the preview URL, its pixel size and any reasons it cannot be used. */
export type TraitCheck = { url: string; errors: string[] }

export type FolderPhase = 'pick' | 'reading' | 'review' | 'uploading' | 'done'

/** Images are checked this many at a time, so the count can move while a big folder is read. */
const CHECK_BATCH = 40

/**
 * The folder upload for a generative project with no layers: read the folder, check every image
 * against the layer rules, upload the good ones through the upload queue, then hand the result
 * to the Art screens (the shared art project, keyed by `collectionId`).
 */
export function useFolderUpload(collectionId: string, projectName: string, activeCollectionId?: string) {
  const sync = useArtSync()
  const uploader = useMemo(() => createUploader({ collectionId, kind: 'layer_image' }), [collectionId])
  const { queue, items } = useUploadQueue(4, uploader)
  const [phase, setPhase] = useState<FolderPhase>('pick')
  const [detected, setDetected] = useState<DetectedProject | null>(null)
  const [checks, setChecks] = useState<ReadonlyMap<string, TraitCheck>>(new Map())
  const [checked, setChecked] = useState(0)
  const [canvas, setCanvas] = useState<{ width: number; height: number } | null>(null)
  const [saving, setSaving] = useState(false)
  const urls = useRef<string[]>([])
  const run = useRef(0)

  const release = useCallback(() => {
    for (const url of urls.current) URL.revokeObjectURL(url)
    urls.current = []
  }, [])
  useEffect(() => release, [release])

  const pick = useCallback(
    async (files: PathedFile[]) => {
      const id = ++run.current
      release()
      const project = detectProject(files, projectName)
      setDetected(project)
      setChecks(new Map())
      setChecked(0)
      setCanvas(null)
      if (project.structureErrors.length > 0) {
        setPhase('review')
        return
      }
      setPhase('reading')
      const traits = project.collections.flatMap((c) => c.layers.flatMap((layer) => layer.traits))
      const results = new Map<string, TraitCheck>()
      let size: { width: number; height: number } | null = null
      for (let start = 0; start < traits.length; start += CHECK_BATCH) {
        const batch = traits.slice(start, start + CHECK_BATCH)
        const out = await checkImageFiles(
          batch.map((trait) => trait.file),
          { ...LAYER_IMAGE_RULES, sameSizeAs: size },
        )
        if (id !== run.current) {
          for (const entry of out) URL.revokeObjectURL(entry.url)
          return
        }
        out.forEach((entry, index) => {
          urls.current.push(entry.url)
          const clash = batch[index]!.clash
          results.set(batch[index]!.key, {
            url: entry.url,
            errors: clash ? [...entry.errors, clash] : entry.errors,
          })
          if (!size && entry.errors.length === 0 && entry.width && entry.height)
            size = { width: entry.width, height: entry.height }
        })
        setChecked(Math.min(traits.length, start + CHECK_BATCH))
      }
      setChecks(results)
      setCanvas(size)
      setPhase('review')
    },
    [release, projectName],
  )

  const valid = useMemo(() => {
    if (!detected) return []
    return detected.collections.flatMap((c) =>
      c.layers.flatMap((layer) => layer.traits.filter((trait) => checks.get(trait.key)?.errors.length === 0)),
    )
  }, [detected, checks])

  const start = useCallback(() => {
    queue.add(
      valid.map((trait) => ({ id: trait.key, file: trait.file, label: trait.path.replace(/^\/+/, '') })),
    )
    setPhase('uploading')
  }, [queue, valid])

  const reset = useCallback(() => {
    run.current++
    for (const item of items) queue.remove(item.id)
    release()
    setDetected(null)
    setChecks(new Map())
    setPhase('pick')
  }, [items, queue, release])

  const totals = queueTotals(items)
  const complete = phase === 'uploading' && totals.complete

  /**
   * Saves the uploaded layers in one transaction, then shows them with the ids the database gave
   * them; the Layers screen then replaces this upload. A refused save keeps the review on screen.
   */
  const finish = useCallback(async () => {
    if (!detected) return
    const names = new Map(
      detected.collections.flatMap((c) =>
        c.layers.flatMap((layer) => layer.traits.map((t) => [t.key, t.name])),
      ),
    )
    const images = new Map<string, UploadedImage>()
    for (const item of items) {
      if (item.state !== 'done' || !item.record) continue
      images.set(item.id, {
        url: item.record.url,
        name: names.get(item.id) ?? traitNameFromFile(item.file.name),
        uploadId: item.record.id,
      })
    }
    const payload = importPayload(detected, images, activeCollectionId)
    setSaving(true)
    const saved = await sync.create<ImportResult>({
      persist: () => importLayers(collectionId, payload),
      apply: (project, data) => ({
        ...project,
        ...(data
          ? applyImport(project, payload, data)
          : mergeUpload(project, detected, images, activeCollectionId)),
        canvas: project.canvas ?? canvas,
      }),
    })
    setSaving(false)
    // The traits now point at the stored files, so the previews can go.
    if (saved) release()
  }, [detected, items, release, sync, collectionId, activeCollectionId, canvas])

  const rejected = detected ? countTraits(detected) - valid.length : 0
  return {
    phase: complete ? ('done' as const) : phase,
    detected,
    checks,
    checked,
    canvas,
    saving,
    valid: valid.length,
    rejected,
    queue,
    items,
    pick,
    start,
    reset,
    finish,
  }
}
