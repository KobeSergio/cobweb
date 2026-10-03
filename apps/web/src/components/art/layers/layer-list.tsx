'use client'

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  EyeIcon,
  EyeOffIcon,
  GripVerticalIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from 'lucide-react'
import { Button } from '@cobweb/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@cobweb/ui/components/dropdown-menu'
import { cn } from '@cobweb/ui/lib/utils'
import type { Layer } from '@/lib/demo'
import { weightsValid } from '../lib/trait-index'

type Props = {
  layers: Layer[]
  selectedId: string | null
  onSelect: (id: string) => void
  /** Trait name shown in the preview for each layer. */
  previewNames: Record<string, string>
  hidden: ReadonlySet<string>
  onToggleHidden: (id: string) => void
  /** Indexes in stack order (0 is the bottom). */
  onMove: (from: number, to: number) => void
  onAdd: () => void
  onRename: (layer: Layer) => void
  onDelete: (layer: Layer) => void
  readOnly: boolean
}

/**
 * The stack, drawn the way design tools draw it: the top of the list is the top of the art.
 * Rows reorder by dragging the handle, or with the keyboard (focus the handle, Space, arrows,
 * Space).
 */
export function LayerList(props: Props) {
  const { layers, readOnly, onMove } = props
  // Shown top first; the data is bottom first.
  const shown = [...layers].reverse()
  const ids = shown.map((layer) => layer.id)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const nameOf = (id: string | number) => layers.find((layer) => layer.id === id)?.name ?? 'Layer'
  const placeOf = (id: string | number) => ids.indexOf(String(id)) + 1

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const reordered = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)))
    const from = layers.findIndex((layer) => layer.id === active.id)
    const to = layers.length - 1 - reordered.indexOf(String(active.id))
    onMove(from, to)
  }

  return (
    <section aria-labelledby="layers-heading" className="bg-card rounded-xl border shadow-raised">
      <header className="flex items-center justify-between gap-3 border-b py-3 pr-3 pl-5">
        <h3 id="layers-heading" className="text-heading flex items-baseline gap-2">
          Layers
          <span className="numeric text-muted-foreground text-sm font-normal">{layers.length}</span>
        </h3>
        {!readOnly && (
          <Button variant="ghost" size="icon-sm" onClick={props.onAdd} aria-label="Add layer">
            <PlusIcon />
          </Button>
        )}
      </header>
      {layers.length === 0 ? (
        <p className="text-muted-foreground px-5 py-6 text-sm">
          No layers yet. Add the first one to start the stack.
        </p>
      ) : (
        <DndContext
          id="layer-order"
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
          accessibility={{
            announcements: {
              onDragStart: ({ active }) =>
                `Picked up ${nameOf(active.id)}, position ${placeOf(active.id)} of ${ids.length} from the top.`,
              onDragOver: ({ active, over }) =>
                over
                  ? `${nameOf(active.id)} is over position ${placeOf(over.id)} of ${ids.length}.`
                  : `${nameOf(active.id)} is not over a position.`,
              onDragEnd: ({ active, over }) =>
                over
                  ? `${nameOf(active.id)} dropped at position ${placeOf(over.id)} of ${ids.length}.`
                  : `${nameOf(active.id)} dropped.`,
              onDragCancel: ({ active }) => `Moving ${nameOf(active.id)} was cancelled.`,
            },
            screenReaderInstructions: {
              draggable:
                'To reorder, press Space, use the arrow keys to move, then press Space again to drop or Escape to cancel.',
            },
          }}
        >
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <ol className="space-y-0.5 p-2">
              {shown.map((layer) => (
                <LayerRow key={layer.id} layer={layer} {...props} />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      )}
      <p className="text-muted-foreground border-t px-5 py-3 text-xs">The top of the list is drawn on top.</p>
    </section>
  )
}

function LayerRow({
  layer,
  selectedId,
  onSelect,
  previewNames,
  hidden,
  onToggleHidden,
  onRename,
  onDelete,
  readOnly,
}: Props & { layer: Layer }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({
      id: layer.id,
      disabled: readOnly,
    })
  const selected = selectedId === layer.id
  const isHidden = hidden.has(layer.id)
  const invalid = !weightsValid(layer) || layer.traits.length === 0

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        'group/row relative flex items-center gap-1 rounded-lg pr-1 transition-colors',
        selected ? 'bg-surface-2' : 'hover:bg-surface-2/60',
        isDragging && 'bg-surface-2 shadow-lifted z-10',
      )}
    >
      {/* The active marker: the selected layer is the one being edited. */}
      <span
        aria-hidden="true"
        className={cn(
          'bg-primary absolute inset-y-2 left-0 w-0.5 rounded-full transition-opacity',
          selected ? 'opacity-100' : 'opacity-0',
        )}
      />
      {readOnly ? (
        <span className="w-2" />
      ) : (
        <button
          ref={setActivatorNodeRef}
          type="button"
          className="text-faint hover:text-foreground focus-visible:ring-ring flex h-10 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-sm outline-none focus-visible:ring-2 active:cursor-grabbing"
          aria-label={`Reorder ${layer.name}`}
          {...attributes}
          {...listeners}
        >
          <GripVerticalIcon className="size-4" />
        </button>
      )}
      <button
        type="button"
        onClick={() => onSelect(layer.id)}
        aria-current={selected ? 'true' : undefined}
        className="focus-visible:ring-ring min-w-0 flex-1 rounded-sm py-2 text-left outline-none focus-visible:ring-2"
      >
        <span
          className={cn('flex items-center gap-1.5 text-sm font-medium', isHidden && 'text-muted-foreground')}
        >
          <span className="truncate">{layer.name}</span>
          {invalid && (
            <TriangleAlertIcon
              aria-label="Needs attention"
              className="text-warning-foreground size-3.5 shrink-0"
            />
          )}
        </span>
        <span className="text-muted-foreground flex items-center gap-1.5 truncate text-xs">
          <span>
            <span className="numeric">{layer.traits.length}</span>{' '}
            {layer.traits.length === 1 ? 'trait' : 'traits'}
          </span>
          {previewNames[layer.id] && (
            <>
              <span aria-hidden="true" className="bg-faint size-0.5 shrink-0 rounded-full" />
              <span className="truncate">{previewNames[layer.id]}</span>
            </>
          )}
        </span>
      </button>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={() => onToggleHidden(layer.id)}
        aria-pressed={isHidden}
        aria-label={isHidden ? `Show ${layer.name} in the preview` : `Hide ${layer.name} in the preview`}
        className={cn(!isHidden && 'opacity-60 group-hover/row:opacity-100 focus-visible:opacity-100')}
      >
        {isHidden ? <EyeOffIcon /> : <EyeIcon />}
      </Button>
      {!readOnly && (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-xs" aria-label={`More actions for ${layer.name}`}>
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onRename(layer)}>
              <PencilIcon />
              Rename
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => onDelete(layer)}>
              <Trash2Icon />
              Delete layer
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  )
}
