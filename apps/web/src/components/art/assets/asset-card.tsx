'use client'

import { Trash2Icon } from 'lucide-react'
import { Artwork } from '@cobweb/ui/components/artwork'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@cobweb/ui/components/alert-dialog'
import { Badge } from '@cobweb/ui/components/badge'
import { Button } from '@cobweb/ui/components/button'
import { Checkbox } from '@cobweb/ui/components/checkbox'
import { cn } from '@cobweb/ui/lib/utils'
import { formatBytes } from '../lib/image-checks'
import { AttributesDialog } from './attributes-dialog'
import { QuantityInput } from './quantity-input'
import type { Rarity } from './token-list'
import { MAX_EDITIONS_PER_FILE, type AssetItem, type Attribute } from './types'

const CHIPS_SHOWN = 4

export function AttributeChips({ attributes }: { attributes: Attribute[] }) {
  if (attributes.length === 0) return <p className="text-[0.8125rem] text-muted-foreground">No attributes</p>
  const shown = attributes.slice(0, CHIPS_SHOWN)
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Attributes">
      {shown.map((attribute, index) => (
        <li key={index} className="max-w-full">
          <Badge
            variant="secondary"
            title={`${attribute.traitType}: ${attribute.value}`}
            className="max-w-full"
          >
            <span className="truncate">
              <span className="text-muted-foreground">{attribute.traitType}</span> {attribute.value}
            </span>
          </Badge>
        </li>
      ))}
      {attributes.length > CHIPS_SHOWN && (
        <li>
          <Badge variant="outline">
            +<span className="numeric">{attributes.length - CHIPS_SHOWN}</span>
          </Badge>
        </li>
      )}
    </ul>
  )
}

function RemoveButton({ fileName, onConfirm }: { fileName: string; onConfirm: () => void }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${fileName}`}>
          <Trash2Icon aria-hidden="true" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove this artwork?</AlertDialogTitle>
          <AlertDialogDescription>
            {fileName} and its editions are taken out of the collection, and the token ids after it close up.
            You can add the file again later.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            Remove artwork
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export type AssetCardActions = {
  /** Show the editions field (1/1s). */
  editions: boolean
  readOnly: boolean
  /** Attributes and removal are edited here. */
  editable: boolean
  onQuantity: (key: string, quantity: number) => void
  onAttributes: (key: string, attributes: Attribute[]) => void
  onRemove: (key: string) => void
  /** Ticks for the selection bar (bulk editions, attributes, removal). */
  onSelect?: (key: string, selected: boolean) => void
}

/** Where the artwork sits in the token list: its ids and rarity rank. */
export type AssetCardMeta = { ids: string; rarity: Rarity | undefined }

function rankLabel(rarity: Rarity) {
  const n = (value: number) => `#${value.toLocaleString('en-US')}`
  return rarity.firstRank === rarity.lastRank
    ? `Rank ${n(rarity.firstRank)}`
    : `Rank ${n(rarity.firstRank)} to ${n(rarity.lastRank)}`
}

/** One uploaded artwork: its image, name, token ids, rank, editions and attributes. */
export function AssetCard({
  item,
  actions,
  meta,
  selected = false,
}: {
  item: AssetItem
  actions: AssetCardActions
  meta?: AssetCardMeta
  selected?: boolean
}) {
  const canEdit = actions.editable && !actions.readOnly
  return (
    <li
      className={cn(
        'flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card shadow-raised',
        selected && 'border-primary-line ring-2 ring-primary/20',
      )}
    >
      <Artwork
        src={item.url}
        alt={item.fileName}
        seed={item.key}
        className="border-b"
        imageClassName="object-contain"
      >
        {canEdit && actions.onSelect && (
          <span className="absolute top-2 left-2 z-10 flex rounded-md bg-card/90 p-1 shadow-raised">
            <Checkbox
              checked={selected}
              aria-label={`Select ${item.fileName}`}
              onCheckedChange={(checked) => actions.onSelect?.(item.key, checked === true)}
            />
          </span>
        )}
      </Artwork>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="min-w-0 space-y-0.5">
          <p className="truncate text-sm font-medium" title={item.fileName}>
            {item.fileName}
          </p>
          {meta?.ids && (
            <p className="numeric truncate text-xs text-muted-foreground" title={`Token ids ${meta.ids}`}>
              <span className="sr-only">Token ids </span>
              {meta.ids}
            </p>
          )}
          {(meta?.rarity || item.bytes !== null) && (
            <p className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
              {meta?.rarity && <span className="numeric text-foreground/85">{rankLabel(meta.rarity)}</span>}
              {item.bytes !== null && <span className="numeric">{formatBytes(item.bytes)}</span>}
            </p>
          )}
        </div>
        {actions.editions &&
          (canEdit ? (
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Editions</span>
              <QuantityInput
                value={item.quantity}
                max={MAX_EDITIONS_PER_FILE}
                label={`Editions of ${item.fileName}`}
                onCommit={(quantity) => actions.onQuantity(item.key, quantity)}
              />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              <span className="numeric text-foreground">{item.quantity.toLocaleString('en-US')}</span>{' '}
              {item.quantity === 1 ? 'edition' : 'editions'}
            </p>
          ))}
        <AttributeChips attributes={item.attributes} />
      </div>
      {canEdit && (
        <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
          <AttributesDialog
            fileName={item.fileName}
            attributes={item.attributes}
            onSave={(attributes) => actions.onAttributes(item.key, attributes)}
          />
          <RemoveButton fileName={item.fileName} onConfirm={() => actions.onRemove(item.key)} />
        </div>
      )}
    </li>
  )
}
