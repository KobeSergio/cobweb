'use client'

import { ImagesIcon, PlusIcon } from 'lucide-react'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@cobweb/ui/components/empty'
import { AssetGrid } from './asset-grid'
import { DropZone, FilePickerButton } from './drop-zone'
import { type AssetItem, type Attribute } from './types'

export const ASSET_RULES_COPY =
  'PNG, JPG or WebP, up to 20 MB each. Any shape; images do not need to be square.'

export function OneOfOneView({
  items,
  readOnly,
  onAdd,
  onQuantity,
  onAttributes,
  onRemove,
}: {
  items: AssetItem[]
  readOnly: boolean
  onAdd: (files: File[]) => void
  onQuantity: (key: string, quantity: number) => void
  onAttributes: (key: string, attributes: Attribute[]) => void
  onRemove: (key: string) => void
}) {
  if (items.length === 0) {
    return (
      <Empty className="border bg-card shadow-raised">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ImagesIcon aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>No artwork yet</EmptyTitle>
          <EmptyDescription>
            {readOnly
              ? 'No artwork was added before the art was locked.'
              : 'Add the finished images for your collection. Each file can have several editions and its own attributes.'}
          </EmptyDescription>
        </EmptyHeader>
        {!readOnly && (
          <EmptyContent className="max-w-xl">
            <DropZone
              className="w-full"
              onFiles={onAdd}
              title="Drop images here or choose files"
              hint={ASSET_RULES_COPY}
            />
            <FilePickerButton onFiles={onAdd} variant="default">
              <PlusIcon aria-hidden="true" />
              Choose images
            </FilePickerButton>
          </EmptyContent>
        )}
      </Empty>
    )
  }

  return (
    <div className="space-y-6">
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-3">
          <DropZone
            compact
            className="min-w-0 flex-1 basis-80"
            onFiles={onAdd}
            title="Drop more images or choose files"
            hint={ASSET_RULES_COPY}
          />
          <FilePickerButton onFiles={onAdd} variant="secondary">
            <PlusIcon aria-hidden="true" />
            Add images
          </FilePickerButton>
        </div>
      )}
      <AssetGrid
        items={items}
        actions={{ editions: true, readOnly, editable: true, onQuantity, onAttributes, onRemove }}
      />
    </div>
  )
}
