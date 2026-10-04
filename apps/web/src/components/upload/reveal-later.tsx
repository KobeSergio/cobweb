'use client'

import { CircleAlertIcon, EyeIcon, EyeOffIcon, RefreshCwIcon, Trash2Icon } from 'lucide-react'
import { useId, useState } from 'react'
import { Button } from '@cobweb/ui/components/button'
import { ChoiceCard, ChoiceCards } from '@cobweb/ui/components/choice-cards'
import { Spinner } from '@cobweb/ui/components/spinner'
import { Textarea } from '@cobweb/ui/components/textarea'
import type { MediaType } from '@/lib/demo/types'
import { DropZone, FilePickerButton } from '@/components/art/assets/drop-zone'
import { ACCEPT_MEDIA, checkMediaFile, mediaLabel, MEDIA_RULES_COPY } from '@/components/art/assets/media'
import { MediaPreview } from '@/components/art/assets/media-preview'
import { formatBytes } from '@/components/art/lib/image-checks'

/** The placeholder file chosen for "Reveal later". Same rules as a single asset (MASTER_PLAN, Art: media types). */
export type PlaceholderFile = {
  url: string
  fileName: string
  mediaType: MediaType
  /** Size on disk, or null for the sample. */
  bytes: number | null
  /** The URL is an object URL made here, so it must be revoked when replaced. */
  owned: boolean
}

export type RevealLaterState = {
  /** "Reveal later" is chosen; false is "Reveal at mint". */
  on: boolean
  /** Forced on: the art is deferred, so the contract can only start on a placeholder. */
  forced: boolean
  file: PlaceholderFile | null
  description: string
}

const DESCRIPTION_MAX = 1000

/**
 * The reveal choice at the top of the Review step: "Reveal at mint" or "Reveal later" (MASTER_PLAN,
 * Flow: pre-reveal). Reveal later shows the placeholder file and its description right below; the
 * contract starts on them and Settings reveals to the real art in one transaction. Deferred art
 * forces Reveal later. Seam: the file goes to storage and is pinned to its own CID by the render
 * pipeline (Phase 4).
 */
export function RevealChoice({
  state,
  onChange,
  readOnly,
}: {
  state: RevealLaterState
  onChange: (next: RevealLaterState) => void
  readOnly: boolean
}) {
  const id = useId()
  const [checking, setChecking] = useState(false)
  const [errors, setErrors] = useState<string[]>([])

  async function pick(files: File[]) {
    const file = files[0]
    if (!file) return
    setChecking(true)
    setErrors([])
    try {
      const checked = await checkMediaFile(file)
      if (checked.errors.length > 0 || !checked.mediaType) {
        URL.revokeObjectURL(checked.url)
        setErrors(checked.errors)
        return
      }
      if (state.file?.owned) URL.revokeObjectURL(state.file.url)
      onChange({
        ...state,
        file: {
          url: checked.url,
          fileName: file.name,
          mediaType: checked.mediaType,
          bytes: file.size,
          owned: true,
        },
      })
    } finally {
      setChecking(false)
    }
  }

  function remove() {
    if (state.file?.owned) URL.revokeObjectURL(state.file.url)
    onChange({ ...state, file: null })
  }

  return (
    <div className="space-y-5 p-6">
      <div className="space-y-3">
        <h4 id={`${id}-choice`} className="text-sm font-medium">
          When do tokens show their art?
        </h4>
        <ChoiceCards
          aria-labelledby={`${id}-choice`}
          value={state.on ? 'later' : 'mint'}
          onValueChange={(value) => onChange({ ...state, on: value === 'later' })}
          disabled={readOnly}
          className="sm:grid-cols-2"
        >
          <ChoiceCard
            value="mint"
            disabled={state.forced}
            icon={<EyeIcon />}
            title="Reveal at mint"
            description="Every token shows its art as soon as it is minted."
          />
          <ChoiceCard
            value="later"
            icon={<EyeOffIcon />}
            title="Reveal later"
            description="Tokens show a placeholder until you reveal from Settings."
          />
        </ChoiceCards>
        {state.forced && (
          <p className="text-muted-foreground text-[0.8125rem] leading-snug">
            You are finishing the art later, so the contract can only start on a placeholder.
          </p>
        )}
      </div>

      {state.on && (
        <>
          <div className="grid gap-5 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
            <div className="space-y-2">
              <p className="text-sm font-medium" id={`${id}-file`}>
                Placeholder
              </p>
              {state.file ? (
                <div className="space-y-3">
                  <MediaPreview
                    src={state.file.url}
                    mediaType={state.file.mediaType}
                    alt={`Placeholder: ${state.file.fileName}`}
                    seed="placeholder"
                    className="border-border-strong w-full rounded-lg border"
                    imageClassName="object-contain"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-[0.8125rem] font-medium" title={state.file.fileName}>
                      {state.file.fileName}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {mediaLabel(state.file.mediaType)}
                      {state.file.bytes !== null && (
                        <>
                          {' · '}
                          <span className="numeric">{formatBytes(state.file.bytes)}</span>
                        </>
                      )}
                    </p>
                  </div>
                  {!readOnly && (
                    <div className="flex flex-wrap gap-2">
                      <FilePickerButton
                        multiple={false}
                        accept={ACCEPT_MEDIA}
                        onFiles={pick}
                        variant="secondary"
                        size="sm"
                        disabled={checking}
                      >
                        {checking ? <Spinner /> : <RefreshCwIcon aria-hidden="true" />}
                        Replace
                      </FilePickerButton>
                      <Button variant="ghost" size="sm" onClick={remove} disabled={checking}>
                        <Trash2Icon aria-hidden="true" />
                        Remove
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <DropZone
                  multiple={false}
                  accept={ACCEPT_MEDIA}
                  disabled={readOnly || checking}
                  onFiles={pick}
                  title={checking ? 'Checking the file' : 'Drop the placeholder or choose a file'}
                  hint={MEDIA_RULES_COPY}
                />
              )}
              {errors.length > 0 && (
                <p role="alert" className="text-destructive-foreground flex items-start gap-1.5 text-xs">
                  <CircleAlertIcon aria-hidden="true" className="mt-px size-3.5 shrink-0" />
                  {errors.join(' ')}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <label htmlFor={`${id}-description`} className="text-sm font-medium">
                Description
              </label>
              <Textarea
                id={`${id}-description`}
                value={state.description}
                maxLength={DESCRIPTION_MAX}
                rows={5}
                disabled={readOnly}
                placeholder="What collectors read on every token before the reveal."
                onChange={(event) => onChange({ ...state, description: event.target.value })}
              />
              <p className="text-muted-foreground flex justify-between gap-4 text-xs">
                <span>Shown as every token&apos;s description until the reveal.</span>
                <span className="numeric shrink-0">
                  {state.description.length.toLocaleString('en-US')} /{' '}
                  {DESCRIPTION_MAX.toLocaleString('en-US')}
                </span>
              </p>
            </div>
          </div>

          <p className="bg-surface-2/50 text-muted-foreground rounded-lg border px-4 py-3 text-[0.8125rem] leading-snug">
            The contract will start on the placeholder. It is rendered to its own small CID next to the real
            set. When you are ready, reveal to the real art from Manage drop, Settings, in one transaction.
          </p>
        </>
      )}
    </div>
  )
}
