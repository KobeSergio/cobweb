'use client'

import { useMemo, useState } from 'react'
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
import { MAX_SUPPLY } from '@/lib/collections'
import { CheckingNotice, LockedNotice, RejectedList } from './assets/notices'
import { OneOfOneView } from './assets/one-of-one-view'
import { SingleAssetView } from './assets/single-asset-view'
import { AssetsSummary } from './assets/summary'
import { SupplySave } from './assets/supply-save'
import { TokenDetailsPanel } from './assets/token-details'
import { TOKEN_DESCRIPTION_MAX, TOKEN_NAME_MAX, type TokenDetails } from './assets/token-list'
import { useAnnouncer, useAssetItems, type AssetUploads } from './assets/use-assets'
import { createUploader } from './uploads/create-uploader'
import { UploadQueuePanel } from './uploads/upload-queue-panel'
import { queueTotals, useUploadQueue } from './uploads/upload-queue'

export type AssetsScreenProps = {
  collection: Tables<'collections'>
  /** Artworks already there, with their attributes (1/1s may have several editions). */
  assets: UploadedAsset[]
  readOnly: boolean
}

/**
 * Art for 1/1s and single asset projects, as in the legacy app: upload finished files, each
 * checked in the browser and then sent through the upload queue (pause, resume, retry),
 * and review the list. The supply comes from here: files times editions for 1/1s, the quantity for
 * a single asset, saved with `setCollectionSupply`. The token name and description start from the
 * collection's and are written into every token (legacy asked for them in the 1/1 and single
 * asset modals). The legacy parity audit is section 12 of the creator flow spec.
 *
 * Seam: `details` and the items are submitted as the token list at lock (Phase 3).
 */
export function AssetsScreen({ collection, assets, readOnly }: AssetsScreenProps) {
  const type = collection.project_type
  const { message, announce } = useAnnouncer()
  const uploader = useMemo(
    () => createUploader({ collectionId: collection.id, kind: 'asset' }),
    [collection.id],
  )
  const { queue, items: uploads } = useUploadQueue(3, uploader)
  const sink = useMemo<AssetUploads>(
    () => ({ add: (entries) => queue.add(entries), remove: (id) => queue.remove(id) }),
    [queue],
  )
  const files = useAssetItems(assets, announce, sink)
  const [singleQuantity, setSingleQuantity] = useState(
    () => collection.max_supply ?? assets[0]?.quantity ?? 1,
  )
  const [details, setDetails] = useState<TokenDetails>(() => ({
    name: collection.name.slice(0, TOKEN_NAME_MAX),
    description: collection.description.slice(0, TOKEN_DESCRIPTION_MAX),
    order: 'upload',
    seed: 0,
  }))

  if (type === 'generative') {
    return (
      <Empty className="bg-card shadow-raised border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LayersIcon aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>This collection is built from layers</EmptyTitle>
          <EmptyDescription>
            Generative collections have no files to upload here. Upload the layers instead.
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

  const single = files.items[0]
  const tokens =
    type === 'single_asset'
      ? single
        ? singleQuantity
        : 0
      : files.items.reduce((sum, item) => sum + item.quantity, 0)

  const totals = queueTotals(uploads)
  const blocked =
    files.items.length === 0
      ? 'Add your art first.'
      : totals.done < totals.files
        ? 'Finish the uploads first.'
        : tokens > MAX_SUPPLY
          ? `The most a collection can have is ${MAX_SUPPLY.toLocaleString('en-US')}.`
          : null
  const supplyControl = (
    <SupplySave
      collectionId={collection.id}
      saved={collection.max_supply}
      supply={tokens}
      blocked={blocked}
      readOnly={readOnly}
    />
  )

  return (
    <div className="space-y-6">
      <div role="status" aria-live="polite" className="sr-only">
        {message}
      </div>
      {readOnly && <LockedNotice />}
      <AssetsSummary
        artworks={type === 'single_asset' ? (single ? 1 : 0) : files.items.length}
        tokens={tokens}
        tokenWord={type === 'one_of_one' ? 'editions' : 'tokens'}
        mediaType={type === 'single_asset' ? single?.mediaType : undefined}
      >
        {type === 'one_of_one' && supplyControl}
      </AssetsSummary>
      {files.checking > 0 && <CheckingNotice count={files.checking} />}
      {!readOnly && <RejectedList rejected={files.rejected} onDismiss={files.dismissRejected} />}
      {!readOnly && <UploadQueuePanel queue={queue} items={uploads} />}
      {files.items.length > 0 && (
        <TokenDetailsPanel
          details={details}
          onChange={setDetails}
          tokens={tokens}
          numbered={type === 'one_of_one'}
          readOnly={readOnly}
        />
      )}
      {type === 'one_of_one' && (
        <OneOfOneView
          items={files.items}
          readOnly={readOnly}
          details={details}
          handlers={{
            onAdd: files.add,
            onQuantity: files.setQuantity,
            onQuantityMany: files.setQuantityMany,
            onAttributes: files.setAttributes,
            onApplyAttribute: files.applyAttribute,
            onClearTraitType: files.clearTraitType,
            onRemove: files.remove,
            onRemoveMany: files.removeMany,
          }}
        />
      )}
      {type === 'single_asset' && (
        <SingleAssetView
          item={single}
          quantity={singleQuantity}
          readOnly={readOnly}
          onReplace={files.replace}
          onQuantity={setSingleQuantity}
          onAttributes={(attributes) => single && files.setAttributes(single.key, attributes)}
          supplyControl={single ? supplyControl : undefined}
        />
      )}
    </div>
  )
}
