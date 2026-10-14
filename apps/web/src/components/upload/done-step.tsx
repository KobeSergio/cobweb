'use client'

import { ChevronDownIcon } from 'lucide-react'
import { useState } from 'react'
import { Artwork } from '@cobweb/ui/components/artwork'
import { Button } from '@cobweb/ui/components/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@cobweb/ui/components/collapsible'
import { cn } from '@cobweb/ui/lib/utils'
import { CopyValue } from '@/components/deploy/copy-value'
import { mediaLabel } from '@/components/art/assets/media'
import { MediaPreview } from '@/components/art/assets/media-preview'
import { IPFS_GATEWAY, type RenderResult } from './upload-shared'

/** The gateway link for an `ipfs://` URI. */
const gatewayUrl = (uri: string) => `${IPFS_GATEWAY}${uri.replace(/^ipfs:\/\//, '')}`

const fmt = (value: number) => value.toLocaleString('en-US')

/**
 * Done: the preview collage, the pinned CIDs (the metadata, the base URI and every batch directory)
 * and a pointer to Deploy. Creators always see their CIDs: the real set and, with "Reveal later", the
 * placeholder (MASTER_PLAN, Flow: pre-reveal). With deferred art the real set is not rendered yet and
 * says so.
 */
export function DoneStep({ result, tokenCount }: { result: RenderResult; tokenCount: number }) {
  const { placeholder, metadataCid, baseUri } = result
  const rendered = metadataCid !== null && baseUri !== null
  const [batchesOpen, setBatchesOpen] = useState(false)
  const batchCount = result.batchCids.length

  return (
    <div className="divide-y">
      {result.collageUrl && (
        <figure className="space-y-3 p-6">
          <div className="mx-auto w-full max-w-sm">
            <Artwork
              src={result.collageUrl}
              alt="The first 16 tokens"
              seed="collage"
              className="border-border-strong rounded-lg border"
            />
          </div>
          <figcaption className="text-muted-foreground text-center text-[0.8125rem]">
            A preview of the first 16 tokens
          </figcaption>
        </figure>
      )}

      <dl className="divide-y px-6">
        {metadataCid !== null && baseUri !== null ? (
          <>
            <Row
              label="Metadata"
              help={
                placeholder
                  ? 'The real set: one file per token. The contract reveals to it from Settings.'
                  : 'One file per token. The contract starts here.'
              }
            >
              <CopyValue
                value={metadataCid}
                label="Metadata CID"
                href={`${IPFS_GATEWAY}${metadataCid}`}
                linkLabel="Open on an IPFS gateway"
              />
            </Row>
            <Row
              label="Base URI"
              help="What the contract is given: the metadata directory, with the token id appended."
            >
              <CopyValue value={baseUri} label="Base URI" />
            </Row>
            <Row label="Images" help={`${fmt(tokenCount)} final images, one directory per batch.`}>
              <Collapsible open={batchesOpen} onOpenChange={setBatchesOpen}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="-ml-2.5">
                    <ChevronDownIcon
                      aria-hidden="true"
                      className={cn('transition-transform', batchesOpen && 'rotate-180')}
                    />
                    <span className="numeric">{fmt(batchCount)}</span>{' '}
                    {batchCount === 1 ? 'batch' : 'batches'}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <ol className="mt-2 space-y-1">
                    {result.batchCids.map((cid, index) => (
                      <li
                        key={cid}
                        className="grid gap-x-3 sm:grid-cols-[4.5rem_minmax(0,1fr)] sm:items-center"
                      >
                        <span className="text-muted-foreground text-[0.8125rem]">Batch {index + 1}</span>
                        <CopyValue
                          value={cid}
                          label={`Batch ${index + 1} CID`}
                          href={`${IPFS_GATEWAY}${cid}`}
                          linkLabel="Open on an IPFS gateway"
                        />
                      </li>
                    ))}
                  </ol>
                </CollapsibleContent>
              </Collapsible>
            </Row>
          </>
        ) : (
          <Row
            label="Real art"
            help="Lock the real art later from Art. It is rendered to its own CID, and you reveal to it from Settings."
          >
            <p className="text-sm">Not rendered yet</p>
          </Row>
        )}
        {placeholder && (
          <Row
            label="Placeholder"
            help={
              result.placeholderUri
                ? "The placeholder's metadata. Every token shows the placeholder until you reveal. The contract starts here."
                : `${mediaLabel(placeholder.mediaType)}. Every token shows it until you reveal.`
            }
          >
            <CopyValue
              value={result.placeholderUri ?? placeholder.cid}
              label={result.placeholderUri ? 'Placeholder base URI' : 'Placeholder CID'}
              href={
                result.placeholderUri
                  ? gatewayUrl(result.placeholderUri)
                  : `${IPFS_GATEWAY}${placeholder.cid}`
              }
              linkLabel="Open on an IPFS gateway"
            />
          </Row>
        )}
      </dl>

      {placeholder && (
        <div className="p-6">
          <div className="space-y-3 sm:w-40">
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
        </div>
      )}

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

/** One row of the CID list: a label, the value and a line of help. */
function Row({ label, help, children }: { label: string; help: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-x-6 gap-y-1 py-4 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-baseline">
      <dt className="text-sm font-medium">{label}</dt>
      <dd className="min-w-0 space-y-0.5">
        {children}
        <p className="text-muted-foreground text-[0.8125rem]">{help}</p>
      </dd>
    </div>
  )
}
