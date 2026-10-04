'use client'

import { EllipsisIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { Button } from '@cobweb/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@cobweb/ui/components/dropdown-menu'
import { Tabs, TabsList, TabsTrigger } from '@cobweb/ui/components/tabs'
import { ConfirmDialog } from '../confirm-dialog'
import { NameDialog } from '../name-dialog'
import type { CollectionsControl } from './use-collections'

/**
 * The bar at the top of Layers and Rules: which collection is shown (a segmented control), and
 * adding, renaming or deleting a collection. A project with one collection shows it with "Add
 * collection", so a second one (for example male and female) is one click away.
 */
export function CollectionSwitcher({
  control,
  readOnly,
}: {
  control: CollectionsControl
  readOnly: boolean
}) {
  const { collections, activeId, active } = control
  const several = collections.length > 1

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span id="collection-switcher-label" className="text-muted-foreground text-sm">
        {several ? 'Collection' : 'One collection'}
      </span>
      <Tabs value={activeId} onValueChange={control.select} className="max-w-full min-w-0">
        <TabsList aria-labelledby="collection-switcher-label" className="max-w-full overflow-x-auto">
          {collections.map((collection) => (
            <TabsTrigger key={collection.id} value={collection.id} className="gap-2">
              {collection.name}
              <span className="numeric text-muted-foreground text-xs">
                {collection.size.toLocaleString('en-US')}
                <span className="sr-only"> tokens</span>
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {!readOnly && (
        <div className="flex items-center gap-1">
          {active && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={`More for ${active.name}`}>
                  <EllipsisIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onSelect={() => control.askRename(active)}>
                  <PencilIcon />
                  Rename {active.name}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
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
          <Button variant="ghost" size="sm" onClick={control.askAdd}>
            <PlusIcon />
            Add collection
          </Button>
        </div>
      )}
      <NameDialog request={control.naming} onClose={control.closeNaming} />
      <ConfirmDialog request={control.confirm} onClose={control.closeConfirm} />
    </div>
  )
}
