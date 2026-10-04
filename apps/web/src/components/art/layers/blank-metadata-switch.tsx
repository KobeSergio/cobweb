'use client'

import { Switch } from '@cobweb/ui/components/switch'

/**
 * The project-wide choice the legacy Rarity page offered as "Include blank traits": whether a
 * token that leaves a layer out says so in its metadata. Off by default.
 */
export function BlankMetadataSwitch({
  on,
  onChange,
  readOnly,
}: {
  on: boolean
  onChange: (on: boolean) => void
  readOnly: boolean
}) {
  return (
    <label className="bg-card flex cursor-pointer items-start gap-3 rounded-xl border px-5 py-3.5 shadow-raised">
      <Switch checked={on} disabled={readOnly} onCheckedChange={onChange} className="mt-0.5" />
      <span className="space-y-0.5">
        <span className="block text-sm font-medium">Blank traits in metadata</span>
        <span className="text-muted-foreground block text-xs leading-snug">
          {on
            ? 'A token that leaves a layer out lists it with the blank’s name, for example Headwear: None.'
            : 'A token that leaves a layer out has no attribute for it. Turn on to list it with the blank’s name.'}{' '}
          Applies to every collection.
        </span>
      </span>
    </label>
  )
}
