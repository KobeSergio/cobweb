'use client'

import { useMemo, useRef, useState } from 'react'
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
import { updateArtSettings } from '@/app/actions/art/settings'
import { deleteUpload } from '@/app/actions/uploads'
import type { Tables } from '@/lib/database.types'
import type { UploadedAsset } from '@/lib/demo'
import { MAX_SUPPLY } from '@/lib/collections'
import { addedOrder, inAddedOrder, shuffledOrder } from './assets/saves'
import { CheckingNotice, LockedNotice, RejectedList } from './assets/notices'
import { OneOfOneView } from './assets/one-of-one-view'
import { SingleAssetView } from './assets/single-asset-view'
import { AssetsSummary } from './assets/summary'
import { SupplySave } from './assets/supply-save'
import { TokenDetailsPanel } from './assets/token-details'
import {
  TOKEN_DESCRIPTION_MAX,
  TOKEN_NAME_MAX,
  tokenDescriptionError,
  tokenNameError,
  type TokenDetails,
} from './assets/token-list'
import { fromSample, useAnnouncer, useAssetItems, type AssetUploads } from './assets/use-assets'
import { useArtSync } from './state/art-sync'
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
 * Editions, attributes, the list order and the token name and description are saved as they change;
 * lock (the next sub-project) builds the token list from the stored rows.
 */
export function AssetsScreen({ collection, assets, readOnly: readOnlyProp }: AssetsScreenProps) {
  const type = collection.project_type
  const sync = useArtSync()
  const readOnly = readOnlyProp || sync.locked
  const { message, announce } = useAnnouncer()
  const uploader = useMemo(
    () => createUploader({ collectionId: collection.id, kind: 'asset' }),
    [collection.id],
  )
  const { queue, items: uploads } = useUploadQueue(3, uploader)
  const sink = useMemo<AssetUploads>(
    () => ({
      add: (entries) => queue.add(entries),
      remove: (id) => queue.remove(id),
      deleteStored: deleteUpload,
    }),
    [queue],
  )
  const files = useAssetItems(collection.id, assets, announce, sink, uploads)
  const [singleQuantity, setSingleQuantity] = useState(() =>
    assets[0]?.uploadId ? assets[0].quantity : (collection.max_supply ?? assets[0]?.quantity ?? 1),
  )
  // Nothing saved yet: the collection's own name and description.
  const untouched = collection.token_name === null && collection.token_description === ''
  const [details, setDetails] = useState<TokenDetails>(() => ({
    name: (collection.token_name ?? collection.name).slice(0, TOKEN_NAME_MAX),
    description: (untouched ? collection.description : collection.token_description).slice(
      0,
      TOKEN_DESCRIPTION_MAX,
    ),
    order: inAddedOrder(assets.map(fromSample)) ? 'upload' : 'shuffled',
    seed: 0,
  }))
  const savedText = useRef({ tokenName: details.name, tokenDescription: details.description })
  // Ids follow the saved list, which "Shuffled" has already reordered.
  const idDetails = useMemo<TokenDetails>(() => ({ ...details, order: 'upload' }), [details])

  /** Saves the token name or description 250 ms after the last keystroke; a refusal puts back the saved text. */
  const saveText = (field: 'tokenName' | 'tokenDescription', value: string) =>
    sync.debounce.schedule(`asset-${field}`, () => {
      const patch = field === 'tokenName' ? { tokenName: value } : { tokenDescription: value }
      void sync
        .run({ apply: (p) => p, persist: () => updateArtSettings(collection.id, patch) })
        .then((ok) => {
          if (ok) {
            savedText.current[field] = value
            return
          }
          const back = savedText.current[field]
          setDetails((current) =>
            field === 'tokenName' ? { ...current, name: back } : { ...current, description: back },
          )
        })
    })

  const changeDetails = (next: TokenDetails) => {
    if (next.order === 'shuffled' && (details.order !== 'shuffled' || next.seed !== details.seed))
      files.reorder((items) => shuffledOrder(items, next.seed))
    else if (next.order === 'upload' && details.order !== 'upload') files.reorder(addedOrder)
    setDetails(next)
    if (next.name !== details.name && !tokenNameError(next.name)) saveText('tokenName', next.name.trim())
    if (next.description !== details.description && !tokenDescriptionError(next.description))
      saveText('tokenDescription', next.description)
  }

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
          onChange={changeDetails}
          tokens={tokens}
          numbered={type === 'one_of_one'}
          readOnly={readOnly}
        />
      )}
      {type === 'one_of_one' && (
        <OneOfOneView
          items={files.items}
          readOnly={readOnly}
          details={idDetails}
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
          onReplace={(file) => void files.replace(file, singleQuantity)}
          onQuantity={(quantity) => {
            setSingleQuantity(quantity)
            if (single) files.setQuantity(single.key, quantity)
          }}
          onAttributes={(attributes) => single && files.setAttributes(single.key, attributes)}
          supplyControl={single ? supplyControl : undefined}
        />
      )}
    </div>
  )
}
