'use client'

import { EllipsisIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { Button } from '@cobweb/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@cobweb/ui/components/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@cobweb/ui/components/select'
import { ConfirmDialog } from '../confirm-dialog'
import { NameDialog } from '../name-dialog'
import type { CollectionsControl } from './use-collections'

/** The menu value that opens "Add collection" instead of switching to a collection. */
const ADD = '__add-collection'

/**
 * The bar at the top of Layers and Rules: a dropdown of the project's collections (name and size,
 * so ten of them still fit), with "Add collection" at the foot of the list, and a small menu beside
 * it to rename or delete the shown collection.
 *
 * Hidden until the project has layers: on a first visit the folder upload decides the collections
 * from the folder structure, as the legacy app did.
 */
export function CollectionSwitcher({
  control,
  readOnly,
}: {
  control: CollectionsControl
  readOnly: boolean
}) {
  const { collections, activeId, active, hasLayers } = control
  if (!hasLayers || collections.length === 0) return null
  const several = collections.length > 1

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span id="collection-switcher-label" className="text-muted-foreground text-sm">
        Collection
      </span>
      <div className="flex min-w-0 items-center gap-1">
        <Select
          value={activeId}
          // "Add collection" opens its dialog once the list has closed and handed focus back.
          onValueChange={(value) =>
            value === ADD ? window.setTimeout(control.askAdd, 0) : control.select(value)
          }
        >
          <SelectTrigger aria-labelledby="collection-switcher-label" className="max-w-[22rem] min-w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" align="start" className="max-h-80">
            {collections.map((collection) => (
              <SelectItem key={collection.id} value={collection.id}>
                <span className="truncate">{collection.name}</span>
                <span className="text-muted-foreground text-xs">
                  <span className="numeric">{collection.size.toLocaleString('en-US')}</span>{' '}
                  {collection.size === 1 ? 'token' : 'tokens'}
                </span>
              </SelectItem>
            ))}
            {!readOnly && (
              <>
                <SelectSeparator />
                <SelectItem value={ADD}>
                  <PlusIcon aria-hidden="true" />
                  Add collection
                </SelectItem>
              </>
            )}
          </SelectContent>
        </Select>
        {!readOnly && active && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`Rename or delete ${active.name}`}>
                <EllipsisIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={() => control.askRename(active)}>
                <PencilIcon />
                Rename {active.name}
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                disabled={!several}
                onSelect={() => control.askDelete(active)}
              >
                <Trash2Icon />
                {several ? `Delete ${active.name}` : 'A project keeps at least one collection'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <NameDialog request={control.naming} onClose={control.closeNaming} />
      <ConfirmDialog request={control.confirm} onClose={control.closeConfirm} />
    </div>
  )
}
