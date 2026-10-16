import { PAGE_UPLOAD_FAILED, type ActionResult } from '@/lib/art/result'
import type { MediaAsk, MintPageInput, MintPageSettingsView } from '@/lib/mint/settings-core'
import { draftOf, inputOf, mediaAskOf, pickedFiles, type MintPageDraft } from './mint-page-draft'

/**
 * A save of the Mint page tab's draft (docs/specs/2026-10-16-mint-page-live-data.md, section 7.9), pure over its
 * steps: hash each picked file, have the server sign them, PUT each one the bucket does not hold yet, then write
 * the draft with every file as its key. A failed step stops it before the write, so nothing is written for it.
 */

const MB = 1024 * 1024

/**
 * How long one PUT may take before it is given up: a minute, and 10 s more for each started MB, so a 20 MB track
 * has 260 s. A PUT that stalls would otherwise hold the save, and the fieldset it disables, with no end.
 */
export function putTimeoutMs(bytes: number): number {
  return 60_000 + 10_000 * Math.ceil(bytes / MB)
}

/** The steps a save runs: the screen passes the browser's hash, the two actions and `fetch`; tests pass fakes. */
export type SaveSteps = {
  /** The file's SHA-256, as 64 lowercase hex characters. */
  hash: (file: File) => Promise<string>
  /** Each file's key and PUT URL, in the order asked; a null URL when the bucket already holds the file. */
  presign: (asks: MediaAsk[]) => Promise<ActionResult<{ key: string; putUrl: string | null }[]>>
  /** Whether the PUT of a file to its signed URL succeeded; one that throws or times out is a failed upload. */
  put: (url: string, file: File) => Promise<boolean>
  /** Writes the draft and answers the saved view. */
  save: (input: MintPageInput) => Promise<ActionResult<MintPageSettingsView>>
}

/** The draft to show once the save is written, or the error to show when it is not. */
export type SaveOutcome = { ok: true; draft: MintPageDraft } | { ok: false; error: string }

/**
 * Runs a save. A hash or a PUT that fails or throws answers PAGE_UPLOAD_FAILED, as do signed answers that cannot be
 * paired with the files; a refused signing or save answers its error. Sample mode runs no step at all: nothing is
 * uploaded or written, and the draft as sent is the saved one.
 */
export async function runSave(
  draft: MintPageDraft,
  steps: SaveSteps,
  { sample }: { sample: boolean },
): Promise<SaveOutcome> {
  if (sample) return { ok: true, draft }
  const files = pickedFiles(draft)
  const keys = new Map<File, string>()
  if (files.length > 0) {
    let asks: MediaAsk[]
    try {
      asks = await Promise.all(files.map(async (entry) => mediaAskOf(entry, await steps.hash(entry.file))))
    } catch {
      return { ok: false, error: PAGE_UPLOAD_FAILED }
    }
    const signed = await steps.presign(asks)
    if (!signed.ok) return { ok: false, error: signed.error }
    // The answers pair with the files by index, so any other count cannot be paired and nothing is sent.
    if (signed.data.length !== files.length) return { ok: false, error: PAGE_UPLOAD_FAILED }
    for (const [index, entry] of signed.data.entries()) {
      const file = files[index]!.file
      keys.set(file, entry.key)
      if (entry.putUrl === null) continue
      const sent = await steps.put(entry.putUrl, file).catch(() => false)
      if (!sent) return { ok: false, error: PAGE_UPLOAD_FAILED }
    }
  }
  const result = await steps.save(inputOf(draft, keys))
  if (!result.ok) return { ok: false, error: result.error }
  return { ok: true, draft: draftOf(result.data) }
}
