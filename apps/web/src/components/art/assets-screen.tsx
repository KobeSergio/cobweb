'use client'

import { useState } from 'react'
import Link from 'next/link'
import { LayersIcon } from 'lucide-react'
import { Button } from '@cobweb/ui/components/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@cobweb/ui/components/empty'
import type { Tables } from '@/lib/database.types'
import type { UploadedAsset } from '@/lib/demo'
import { MetadataView } from './assets/metadata-view'
import { CheckingNotice, LockedNotice, RejectedList } from './assets/notices'
import { OneOfOneView } from './assets/one-of-one-view'
import { SingleAssetView } from './assets/single-asset-view'
import { AssetsSummary } from './assets/summary'
import { useAnnouncer, useAssetItems } from './assets/use-assets'
import { useMetadata } from './assets/use-metadata'

export type AssetsScreenProps = {
  collection: Tables<'collections'>
  /** Uploaded artworks with their attributes (1/1s may have a quantity). */
  assets: UploadedAsset[]
  readOnly: boolean
}

/**
 * Art for non-generative projects (1/1s, metadata, single asset): upload finished images, or
 * images with metadata JSON, validate them, and review the list. Varies by `collection.project_type`.
 * All state is client state; nothing is sent anywhere yet (see the seams in `assets/use-*.ts`).
 */
export function AssetsScreen({ collection, assets, readOnly }: AssetsScreenProps) {
  const type = collection.project_type
  const { message, announce } = useAnnouncer()
  const files = useAssetItems(assets, announce)
  const metadata = useMetadata(assets, announce)
  const [singleQuantity, setSingleQuantity] = useState(() => assets[0]?.quantity ?? 1)

  if (type === 'generative') {
    return (
      <Empty className="border bg-card shadow-raised">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LayersIcon aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>This collection is built from layers</EmptyTitle>
          <EmptyDescription>
            Generative collections have no files to upload here. Set up the layers instead.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild variant="secondary">
            <Link href={`/collections/${collection.id}/art/layers`}>Go to layers</Link>
          </Button>
        </EmptyContent>
      </Empty>
    )
  }

  const shown = type === 'metadata' ? metadata.items : files.items
  const single = files.items[0]
  const tokens =
    type === 'single_asset'
      ? single
        ? singleQuantity
        : 0
      : shown.reduce((sum, item) => sum + item.quantity, 0)
  const checking = type === 'metadata' ? metadata.checking : files.checking

  return (
    <div className="space-y-6">
      <div role="status" aria-live="polite" className="sr-only">
        {message}
      </div>
      {readOnly && <LockedNotice />}
      <AssetsSummary
        artworks={type === 'single_asset' ? (single ? 1 : 0) : shown.length}
        tokens={tokens}
        maxSupply={collection.max_supply}
        tokenWord={type === 'one_of_one' ? 'editions' : 'tokens'}
        mediaType={type === 'single_asset' ? single?.mediaType : undefined}
      />
      {checking > 0 && <CheckingNotice count={checking} />}
      {type !== 'metadata' && !readOnly && (
        <RejectedList rejected={files.rejected} onDismiss={files.dismissRejected} />
      )}
      {type === 'one_of_one' && (
        <OneOfOneView
          items={files.items}
          readOnly={readOnly}
          onAdd={files.add}
          onQuantity={files.setQuantity}
          onAttributes={files.setAttributes}
          onRemove={files.remove}
        />
      )}
      {type === 'single_asset' && (
        <SingleAssetView
          item={single}
          quantity={singleQuantity}
          readOnly={readOnly}
          onReplace={files.replace}
          onQuantity={setSingleQuantity}
        />
      )}
      {type === 'metadata' && (
        <MetadataView
          items={metadata.items}
          report={metadata.report}
          staged={metadata.staged}
          counts={metadata.fileCounts}
          readOnly={readOnly}
          onAdd={metadata.add}
          onClear={metadata.clear}
        />
      )}
    </div>
  )
}
