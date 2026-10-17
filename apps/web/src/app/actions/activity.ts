'use server'

import type { ActionResult } from '@/lib/art/result'
import { activityViewCore } from '@/lib/manage/activity-core'
import type { ActivityView } from '@/lib/manage/activity-view'
import { phasesWrite } from '@/lib/manage/phases-write'

/**
 * The Overview's activity (docs/specs/2026-10-16-indexer-overview.md, section 7.1): the holders and the latest
 * mints the indexer recorded, through `phasesWrite`, which checks the session and the ownership (CLAUDE.md rule
 * 4).
 */
export async function getActivity(collectionId: string): Promise<ActionResult<ActivityView>> {
  return phasesWrite(collectionId, activityViewCore)
}
