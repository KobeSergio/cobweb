'use client'

import { CheckIcon, CopyIcon } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@cobweb/ui/components/button'

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={copied ? 'Copied' : label}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1600)
        })
      }}
    >
      {copied ? <CheckIcon className="text-success-foreground" /> : <CopyIcon />}
    </Button>
  )
}
