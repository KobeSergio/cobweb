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
import { formatBytes } from '../lib/image-checks'
import { AttributesDialog } from './attributes-dialog'
import { QuantityInput } from './quantity-input'
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
            {fileName} and its editions are taken out of the collection. You can add the file again later.
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
  /** Attributes and removal are edited here. Metadata sets come from their JSON files instead. */
  editable: boolean
  onQuantity: (key: string, quantity: number) => void
  onAttributes: (key: string, attributes: Attribute[]) => void
  onRemove: (key: string) => void
}

/** One uploaded artwork: its image, name, editions and attributes. */
export function AssetCard({ item, actions }: { item: AssetItem; actions: AssetCardActions }) {
  const canEdit = actions.editable && !actions.readOnly
  return (
    <li className="flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card shadow-raised">
      <Artwork
        src={item.url}
        alt={item.fileName}
        seed={item.key}
        className="border-b"
        imageClassName="object-contain"
      />
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium" title={item.fileName}>
            {item.fileName}
          </p>
          {item.bytes !== null && (
            <p className="numeric text-xs text-muted-foreground">{formatBytes(item.bytes)}</p>
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
