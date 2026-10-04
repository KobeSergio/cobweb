'use client'

import { FolderUpIcon } from 'lucide-react'
import { useRef, useState } from 'react'
import { cn } from '@cobweb/ui/lib/utils'
import { fromDrop, fromPicker, type PathedFile } from './folder-tree'

/** Lets the picker choose a folder (every browser the app supports reads this attribute). */
function folderInput(node: HTMLInputElement | null) {
  node?.setAttribute('webkitdirectory', '')
  node?.setAttribute('directory', '')
}

/**
 * A drop target for a whole folder that is also a button: click, Enter or Space opens the folder
 * picker. Files are read in the browser with their paths; nothing is uploaded here.
 */
export function FolderDropZone({
  onFiles,
  disabled,
  className,
}: {
  onFiles: (files: PathedFile[]) => void
  disabled?: boolean
  className?: string
}) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

  return (
    <div
      onDragEnter={(event) => {
        event.preventDefault()
        if (!disabled) setOver(true)
      }}
      onDragOver={(event) => {
        event.preventDefault()
        if (!disabled) setOver(true)
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false)
      }}
      onDrop={(event) => {
        event.preventDefault()
        setOver(false)
        if (disabled) return
        // The entries must be taken before anything is awaited; `fromDrop` does that first.
        void fromDrop(event.dataTransfer).then(onFiles)
      }}
      className={className}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => input.current?.click()}
        className={cn(
          'group border-border-strong bg-well flex w-full cursor-pointer flex-col items-center justify-center gap-4 rounded-xl border border-dashed px-6 py-14 text-center outline-none',
          'transition-[border-color,background-color] duration-150 ease-out',
          'hover:border-muted-foreground/70 hover:bg-surface-1',
          'focus-visible:border-primary focus-visible:ring-primary/20 focus-visible:ring-3',
          'disabled:cursor-not-allowed disabled:opacity-50',
          over && 'border-primary-line bg-primary-soft',
        )}
      >
        <span className="border-border-strong bg-surface-2 text-foreground shadow-raised flex size-12 items-center justify-center rounded-lg border [&_svg]:size-5">
          <FolderUpIcon aria-hidden="true" />
        </span>
        <span className="space-y-1.5">
          <span className="block text-sm font-medium">
            {over ? 'Drop the folder to read it' : 'Drop your project folder here, or choose it'}
          </span>
          <span className="text-muted-foreground block text-[0.8125rem] text-pretty">
            Laid out as <span className="numeric">collection/layer/trait.png</span> or{' '}
            <span className="numeric">project/collection/layer/trait.png</span>
          </span>
        </span>
      </button>
      <input
        ref={(node) => {
          input.current = node
          folderInput(node)
        }}
        type="file"
        multiple
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        onChange={(event) => {
          onFiles(fromPicker(event.target.files))
          event.target.value = ''
        }}
      />
    </div>
  )
}
