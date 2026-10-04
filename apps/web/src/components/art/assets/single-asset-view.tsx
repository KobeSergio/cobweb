'use client'

import { ImageUpIcon, RefreshCwIcon } from 'lucide-react'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@cobweb/ui/components/empty'
import { Panel } from '@cobweb/ui/components/panel'
import { formatBytes } from '../lib/image-checks'
import { SINGLE_ASSET_MAX_SUPPLY } from '@/lib/collections'
import { AttributeChips } from './asset-card'
import { AttributesDialog } from './attributes-dialog'
import { DropZone, FilePickerButton } from './drop-zone'
import { QuantityInput } from './quantity-input'
import { ACCEPT_MEDIA, mediaLabel, MEDIA_RULES_COPY } from './media'
import { MediaPreview } from './media-preview'
import type { AssetItem, Attribute } from './types'

/**
 * One artwork shared by every token, and the quantity: how many tokens there are, which is the
 * collection's supply for this type (1 to 4,000; `supplyControl` saves it). Unlike 1/1s it may be a
 * GIF or an MP4 video as well as an image (MASTER_PLAN, Art: media types).
 *
 * As legacy's `single_asset { url, id_start: 1, id_end: quantity, layers }`: the attributes
 * ("layers", starting with Name: <file name>) are shared by every token, ids run 1 to the quantity,
 * and the contract's `tokenURI` returns one metadata file for all of them (MASTER_PLAN, Contracts).
 */
export function SingleAssetView({
  item,
  quantity,
  readOnly,
  onReplace,
  onQuantity,
  onAttributes,
  supplyControl,
}: {
  item: AssetItem | undefined
  quantity: number
  readOnly: boolean
  onReplace: (file: File | undefined) => void
  onQuantity: (quantity: number) => void
  onAttributes: (attributes: Attribute[]) => void
  /** Saves the quantity as the supply. */
  supplyControl?: React.ReactNode
}) {
  const pick = (files: File[]) => onReplace(files[0])

  if (!item) {
    return (
      <Empty className="border bg-card shadow-raised">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ImageUpIcon aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>No artwork yet</EmptyTitle>
          <EmptyDescription>
            {readOnly
              ? 'No artwork was added before the art was locked.'
              : 'Add the one image, GIF or video every token will share, then set how many tokens there are.'}
          </EmptyDescription>
        </EmptyHeader>
        {!readOnly && (
          <EmptyContent className="max-w-xl">
            <DropZone
              className="w-full"
              multiple={false}
              accept={ACCEPT_MEDIA}
              onFiles={pick}
              title="Drop a file here or choose one"
              hint={MEDIA_RULES_COPY}
            />
            <FilePickerButton multiple={false} accept={ACCEPT_MEDIA} onFiles={pick} variant="default">
              <ImageUpIcon aria-hidden="true" />
              Choose file
            </FilePickerButton>
          </EmptyContent>
        )}
      </Empty>
    )
  }

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <MediaPreview
        src={item.url}
        mediaType={item.mediaType}
        alt={item.fileName}
        seed="single-asset"
        className="mx-auto w-full max-w-2xl rounded-xl border shadow-raised"
        imageClassName="object-contain"
      />
      <div className="space-y-5">
        <Panel title="Artwork" bodyClassName="space-y-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium" title={item.fileName}>
              {item.fileName}
            </p>
            <p className="text-xs text-muted-foreground">
              {mediaLabel(item.mediaType)}
              {item.bytes !== null && (
                <>
                  {' · '}
                  <span className="numeric">{formatBytes(item.bytes)}</span>
                </>
              )}
            </p>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Attributes, shared by every token</p>
            <AttributeChips attributes={item.attributes} />
          </div>
          {!readOnly && (
            <>
              <div className="flex flex-wrap gap-2">
                <FilePickerButton multiple={false} accept={ACCEPT_MEDIA} onFiles={pick} variant="secondary">
                  <RefreshCwIcon aria-hidden="true" />
                  Replace file
                </FilePickerButton>
                <AttributesDialog
                  fileName={item.fileName}
                  attributes={item.attributes}
                  onSave={onAttributes}
                />
              </div>
              <p className="text-[0.8125rem] text-muted-foreground">{MEDIA_RULES_COPY}</p>
            </>
          )}
        </Panel>
        <Panel
          title="Quantity"
          description="How many tokens share this artwork. This is the collection's supply."
          bodyClassName="space-y-3"
        >
          {readOnly ? (
            <p className="text-sm">
              <span className="numeric text-2xl">{quantity.toLocaleString('en-US')}</span>{' '}
              <span className="text-muted-foreground">tokens</span>
            </p>
          ) : (
            <QuantityInput
              value={quantity}
              max={SINGLE_ASSET_MAX_SUPPLY}
              label="Quantity"
              onCommit={onQuantity}
            />
          )}
          <p className="text-[0.8125rem] text-muted-foreground">
            From <span className="numeric">1</span> to{' '}
            <span className="numeric">{SINGLE_ASSET_MAX_SUPPLY.toLocaleString('en-US')}</span> tokens. Token
            ids run from <span className="numeric text-foreground">#1</span> to{' '}
            <span className="numeric text-foreground">#{quantity.toLocaleString('en-US')}</span>, and every id
            shares one metadata file.
          </p>
          {supplyControl}
        </Panel>
      </div>
    </div>
  )
}
