'use client'

import { useSearchParams, useSelectedLayoutSegments } from 'next/navigation'
import { Badge } from '@cobweb/ui/components/badge'
import { STATUS_LABELS } from '@/components/collections/collection-card'
import type { CollectionStatus } from '@/lib/steps'

/**
 * The collection's status beside its name in the top bar. Sample mode opens Manage drop and
 * `?state=deployed` before the row is deployed; there the chip says Deployed, as the nav does
 * (`WorkspaceNav`), so the top bar never calls a drop with Manage tabs a draft.
 */
export function CollectionStatusChip({ status, demo }: { status: CollectionStatus; demo: boolean }) {
  const [segment] = useSelectedLayoutSegments()
  const searchParams = useSearchParams()
  const shown =
    demo && (segment === 'manage' || searchParams.get('state') === 'deployed') ? 'deployed' : status
  return (
    <Badge variant="secondary" className="shrink-0">
      {STATUS_LABELS[shown]}
    </Badge>
  )
}
