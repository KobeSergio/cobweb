import { ArrowRightIcon, LockIcon } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@cobweb/ui/components/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@cobweb/ui/components/empty'
import { getStage, stageHref, UNLOCK_REQUIREMENTS, type ProjectType, type StageSlug } from '@/lib/steps'

export type StageLockedProps = {
  collectionId: string
  projectType: ProjectType
  /** The locked stage. Details and Art are never locked. */
  stage: keyof typeof UNLOCK_REQUIREMENTS
}

/** Shown in place of a stage that cannot be opened yet: what has to happen first, and a link to it. */
export function StageLocked({ collectionId, projectType, stage }: StageLockedProps) {
  const { requirement, action, stage: target } = UNLOCK_REQUIREMENTS[stage]
  const name = getStage(stage)?.name
  return (
    <Empty className="bg-card flex-1 rounded-lg border border-dashed py-16">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <LockIcon />
        </EmptyMedia>
        <EmptyTitle>{name} is not open yet</EmptyTitle>
        <EmptyDescription>{requirement}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild>
          <Link href={stageHref(collectionId, target as StageSlug, projectType)}>
            {action}
            <ArrowRightIcon />
          </Link>
        </Button>
      </EmptyContent>
    </Empty>
  )
}
