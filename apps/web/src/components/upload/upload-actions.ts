import {
  confirmArtPayment,
  getRenderJob,
  lockArt,
  lockPlaceholder,
  quoteArt,
  retryRender,
  unlockArt,
} from '@/app/actions/lock'
import { deleteUpload } from '@/app/actions/uploads'
import { createUploader } from '@/components/art/uploads/create-uploader'
import { uploadOnce } from '@/components/art/uploads/upload-once'
import { done, fail, NO_PLACEHOLDER } from '@/lib/art/result'
import type { UploadActions } from './upload-shared'

/**
 * Lock and upload against the server (docs/specs/2026-10-09-lock-and-pay.md, section 8). The
 * payment itself runs in the pay step through wagmi (pay-machine.ts); sample mode uses
 * `sampleActions` (upload-sim.ts) instead.
 */
export function realActions(collectionId: string): UploadActions {
  const startPlaceholder = createUploader({ collectionId, kind: 'placeholder' })
  return {
    lock: (input) => lockArt(collectionId, input),
    unlock: () => unlockArt(collectionId),
    requote: () => quoteArt(collectionId),
    confirm: (jobId, txHash) => confirmArtPayment(collectionId, jobId, txHash),
    reload: () => getRenderJob(collectionId),
    retry: () => retryRender(collectionId),
    lockPlaceholder: async (uploadId) =>
      uploadId ? lockPlaceholder(collectionId, uploadId) : fail(NO_PLACEHOLDER),
    uploadPlaceholder: async (file) => {
      const stored = await uploadOnce(startPlaceholder, file)
      return 'error' in stored ? stored : { uploadId: stored.record.id, url: stored.record.url }
    },
    removePlaceholder: async (uploadId) => {
      const result = await deleteUpload(uploadId)
      return 'error' in result ? fail(result.error) : done
    },
  }
}
