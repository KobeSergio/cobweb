'use client'

import { Artwork } from '@cobweb/ui/components/artwork'
import { Stagger, StaggerItem } from '@cobweb/ui/components/motion'
import { CopyValue } from '@/components/deploy/copy-value'
import { mediaLabel } from '@/components/art/assets/media'
import { MediaPreview } from '@/components/art/assets/media-preview'
import { IPFS_GATEWAY, tokenPreview, type RenderResult } from './upload-shared'

const GALLERY = 12

type CidRow = { label: string; name: string; cid: string | null; help: string }

/**
 * Done: the pinned CIDs, a sample of the final images, and a pointer to Deploy. Creators always see
 * their CIDs: the real set and, with "Reveal later", the placeholder (decision D25). With deferred
 * art the real set is not rendered yet and says so.
 */
export function DoneStep({ result, tokenCount }: { result: RenderResult; tokenCount: number }) {
  const { placeholder } = result
  const rendered = result.imagesCid !== null && result.metadataCid !== null
  const cids: CidRow[] = [
    ...(rendered
      ? [
          {
            label: 'Images',
            name: 'Images CID',
            cid: result.imagesCid,
            help: `${tokenCount.toLocaleString('en-US')} final images`,
          },
          {
            label: 'Metadata',
            name: 'Metadata CID',
            cid: result.metadataCid,
            help: placeholder
              ? 'The real set: one file per token. The contract reveals to it from Settings.'
              : 'One file per token. The contract starts here.',
          },
        ]
      : [
          {
            label: 'Real art',
            name: 'Real art CID',
            cid: null,
            help: 'Lock the real art later from Art. It is rendered to its own CID, and you reveal to it from Settings.',
          },
        ]),
    ...(placeholder
      ? [
          {
            label: 'Placeholder',
            name: 'Placeholder CID',
            cid: placeholder.cid,
            help: `${mediaLabel(placeholder.mediaType)}. Every token shows it until you reveal. The contract starts here.`,
          },
        ]
      : []),
  ]

  return (
    <div className="divide-y">
      <dl className="divide-y px-6">
        {cids.map((entry) => (
          <div
            key={entry.label}
            className="grid gap-x-6 gap-y-1 py-4 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-baseline"
          >
            <dt className="text-sm font-medium">{entry.label}</dt>
            <dd className="min-w-0 space-y-0.5">
              {entry.cid ? (
                <CopyValue
                  value={entry.cid}
                  label={entry.name}
                  href={`${IPFS_GATEWAY}${entry.cid}`}
                  linkLabel="Open on an IPFS gateway"
                />
              ) : (
                <p className="text-sm">Not rendered yet</p>
              )}
              <p className="text-muted-foreground text-[0.8125rem]">{entry.help}</p>
            </dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-col gap-6 p-6 sm:flex-row">
        {placeholder && (
          <div className="shrink-0 space-y-3 sm:w-40">
            <h4 className="text-sm font-medium">Placeholder</h4>
            <MediaPreview
              src={placeholder.imageUrl}
              mediaType={placeholder.mediaType}
              alt="The placeholder every token shows before the reveal"
              seed="placeholder"
              className="border-border-strong rounded-lg border"
              imageClassName="object-contain"
            />
          </div>
        )}
        {rendered && (
          <div className="min-w-0 flex-1 space-y-3">
            <h4 className="text-sm font-medium">From the final set</h4>
            <Stagger className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {Array.from({ length: GALLERY }, (_, index) => {
                const id = index * 61 + 1
                return (
                  <StaggerItem key={id} className={index >= 8 ? 'hidden sm:block' : undefined}>
                    <Artwork
                      src={tokenPreview(id)}
                      alt={`Token ${id}`}
                      seed={`token-${id}`}
                      className="border-border-strong rounded-lg border"
                    />
                  </StaggerItem>
                )
              })}
            </Stagger>
          </div>
        )}
      </div>

      <p className="text-muted-foreground p-6 text-[0.8125rem] leading-snug">
        {!rendered
          ? 'The placeholder is stored on IPFS. Next, deploy the contract on it, then finish the art; the real set is locked and rendered later, and you reveal to it from Settings.'
          : placeholder
            ? 'Your art is stored on IPFS and cannot change. Next, deploy the contract: it starts on the placeholder and points at the metadata when you reveal.'
            : 'Your art is stored on IPFS and cannot change. Next, deploy the contract: it starts on the metadata, so every token shows its art from the first mint.'}
      </p>
    </div>
  )
}
