'use client'

import { CircleCheckIcon, CircleDashedIcon, CircleXIcon, FileJsonIcon } from 'lucide-react'
import { Button } from '@cobweb/ui/components/button'
import { Panel } from '@cobweb/ui/components/panel'
import { cn } from '@cobweb/ui/lib/utils'
import { AssetGrid } from './asset-grid'
import { DropZone } from './drop-zone'
import type { MetadataReport, RuleResult } from './metadata'
import { ACCEPT_IMAGES, type AssetItem } from './types'

const STATUS_LABEL = { idle: 'Not checked yet', pass: 'Passed', fail: 'Failed' } as const
const PROBLEMS_SHOWN = 4

function Rule({ rule }: { rule: RuleResult }) {
  const Icon =
    rule.status === 'pass' ? CircleCheckIcon : rule.status === 'fail' ? CircleXIcon : CircleDashedIcon
  return (
    <li className="flex items-start gap-3">
      <Icon
        aria-hidden="true"
        className={cn(
          'mt-0.5 size-4 shrink-0',
          rule.status === 'pass' && 'text-success-foreground',
          rule.status === 'fail' && 'text-destructive-foreground',
          rule.status === 'idle' && 'text-faint',
        )}
      />
      <div className="min-w-0 space-y-1">
        <p className={cn('text-sm', rule.status === 'idle' && 'text-muted-foreground')}>
          {rule.label}
          <span className="sr-only">. {STATUS_LABEL[rule.status]}.</span>
        </p>
        {rule.problems.length > 0 && (
          <ul className="space-y-0.5 text-[0.8125rem] text-destructive-foreground">
            {rule.problems.slice(0, PROBLEMS_SHOWN).map((problem, index) => (
              <li key={index} className="break-words">
                {problem}
              </li>
            ))}
            {rule.problems.length > PROBLEMS_SHOWN && (
              <li>
                and <span className="numeric">{rule.problems.length - PROBLEMS_SHOWN}</span> more
              </li>
            )}
          </ul>
        )}
      </div>
    </li>
  )
}

/** Images plus JSON files, paired by number and checked live against the strict rules. */
export function MetadataView({
  items,
  report,
  staged,
  counts,
  readOnly,
  onAdd,
  onClear,
}: {
  items: AssetItem[]
  report: MetadataReport
  /** Files have been dropped in this session. */
  staged: boolean
  counts: { images: number; jsons: number }
  readOnly: boolean
  onAdd: (files: File[]) => void
  onClear: () => void
}) {
  const showing = staged && report.ok ? 'the files you dropped' : 'the saved set'
  return (
    <div className="space-y-6">
      {!readOnly && (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className="space-y-4">
            <DropZone
              onFiles={onAdd}
              accept={`${ACCEPT_IMAGES},application/json,.json`}
              title="Drop images and JSON files together"
              hint="Pair them by number, like 1.png and 1.json. PNG, JPG or WebP and JSON, up to 20 MB each."
            />
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
              <p className="flex items-center gap-2">
                <FileJsonIcon aria-hidden="true" className="size-4 text-faint" />
                <span>
                  <span className="numeric text-foreground">{counts.images.toLocaleString('en-US')}</span>{' '}
                  images,{' '}
                  <span className="numeric text-foreground">{counts.jsons.toLocaleString('en-US')}</span> JSON
                  files
                </span>
              </p>
              {staged && (
                <Button type="button" variant="outline" size="sm" onClick={onClear}>
                  Clear dropped files
                </Button>
              )}
            </div>
          </div>
          <Panel
            title="Checks"
            description="Each rule updates as you drop files. Nothing leaves your browser."
            bodyClassName="p-5"
          >
            <ul className="space-y-3.5">
              {report.rules.map((rule) => (
                <Rule key={rule.id} rule={rule} />
              ))}
            </ul>
          </Panel>
        </div>
      )}
      {items.length > 0 ? (
        <section aria-label="Artworks" className="space-y-4">
          <h3 className="text-heading">
            Showing {showing}
            <span className="numeric ml-2 text-muted-foreground">{items.length.toLocaleString('en-US')}</span>
          </h3>
          <AssetGrid
            items={items}
            actions={{
              editions: false,
              readOnly: true,
              editable: false,
              onQuantity: () => {},
              onAttributes: () => {},
              onRemove: () => {},
            }}
          />
        </section>
      ) : (
        <p className="rounded-xl border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
          No artwork yet.{' '}
          {readOnly ? 'None was added before the art was locked.' : 'Drop your images and JSON files above.'}
        </p>
      )}
    </div>
  )
}
