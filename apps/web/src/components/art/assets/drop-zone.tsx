'use client'

import { useRef, useState } from 'react'
import { UploadIcon } from 'lucide-react'
import { Button } from '@cobweb/ui/components/button'
import { cn } from '@cobweb/ui/lib/utils'
import { ACCEPT_IMAGES } from './types'

/** Files from a drop or a picker, as a plain array. */
function toFiles(list: FileList | null | undefined): File[] {
  return list ? Array.from(list) : []
}

/**
 * A drop target that is also a button: click, Enter or Space opens the file picker, dragging files
 * over it highlights it. Nothing is uploaded; the caller reads the files in the browser.
 */
export function DropZone({
  onFiles,
  title,
  hint,
  accept = ACCEPT_IMAGES,
  multiple = true,
  disabled,
  compact,
  className,
}: {
  onFiles: (files: File[]) => void
  title: string
  hint: string
  accept?: string
  multiple?: boolean
  disabled?: boolean
  compact?: boolean
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
        const files = toFiles(event.dataTransfer.files)
        onFiles(multiple ? files : files.slice(0, 1))
      }}
      className={className}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => input.current?.click()}
        className={cn(
          'group flex w-full cursor-pointer items-center rounded-xl border border-dashed border-border-strong bg-well text-left outline-none',
          'transition-[border-color,background-color] duration-150 ease-out',
          'hover:border-muted-foreground/70 hover:bg-surface-1',
          'focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/20',
          'disabled:cursor-not-allowed disabled:opacity-50',
          over && 'border-primary-line bg-primary-soft',
          compact ? 'gap-4 px-5 py-4' : 'flex-col justify-center gap-3 px-6 py-10 text-center',
        )}
      >
        <span className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-border-strong bg-surface-2 text-foreground shadow-raised [&_svg]:size-5">
          <UploadIcon aria-hidden="true" />
        </span>
        <span className="min-w-0 space-y-1">
          <span className="block text-sm font-medium">{over ? 'Drop to add' : title}</span>
          <span className="block text-[0.8125rem] text-pretty text-muted-foreground">{hint}</span>
        </span>
      </button>
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple={multiple}
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        onChange={(event) => {
          onFiles(toFiles(event.target.files))
          event.target.value = ''
        }}
      />
    </div>
  )
}

/** A plain button that opens the file picker. */
export function FilePickerButton({
  onFiles,
  children,
  accept = ACCEPT_IMAGES,
  multiple = true,
  disabled,
  variant = 'secondary',
  size = 'default',
}: {
  onFiles: (files: File[]) => void
  children: React.ReactNode
  accept?: string
  multiple?: boolean
  disabled?: boolean
  variant?: 'secondary' | 'outline' | 'ghost' | 'default'
  size?: 'default' | 'sm'
}) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        {children}
      </Button>
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple={multiple}
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        onChange={(event) => {
          onFiles(toFiles(event.target.files))
          event.target.value = ''
        }}
      />
    </>
  )
}
