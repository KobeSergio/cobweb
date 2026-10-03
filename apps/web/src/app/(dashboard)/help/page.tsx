import type { Metadata } from 'next'
import { Badge } from '@cobweb/ui/components/badge'
import { RiseIn } from '@cobweb/ui/components/motion'
import { PageHeader } from '@cobweb/ui/components/page-header'
import { DashboardTopbar } from '@/components/shell/dashboard-topbar'
import { requireUser } from '@/lib/auth'
import { artSubSteps, MANAGE_TABS, STEPS } from '@/lib/steps'

export const metadata: Metadata = { title: 'Help' }

/** What each stage contains, where it has a second level. */
const DETAIL: Partial<Record<(typeof STEPS)[number]['slug'], readonly string[]>> = {
  art: artSubSteps('generative').map((sub) => sub.name),
  manage: MANAGE_TABS.map((tab) => tab.name),
}

/** A short guide to the launch flow. Fuller documentation comes as each stage is built. */
export default async function HelpPage() {
  const user = await requireUser()

  return (
    <>
      <DashboardTopbar title="Help" walletAddress={user.walletAddress} />
      <div className="mx-auto w-full max-w-4xl space-y-10 px-8 pt-10 pb-16">
        <PageHeader
          title="How a launch works"
          description="Every collection moves through the same five stages, in this order. You can leave at any point and pick up where you stopped."
        />
        <RiseIn>
          <ol className="overflow-hidden rounded-xl border bg-card shadow-raised">
            {STEPS.map((step, index) => (
              <li key={step.slug} className="grid grid-cols-[4.5rem_1fr] gap-2 border-b p-6 last:border-b-0">
                <span aria-hidden="true" className="numeric pt-0.5 text-[1.75rem] leading-none text-faint">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <div>
                  <h2 className="text-heading">{step.name}</h2>
                  <p className="mt-1.5 max-w-[60ch] text-sm leading-relaxed text-muted-foreground">
                    {step.summary}
                  </p>
                  {DETAIL[step.slug] && (
                    <ul className="mt-4 flex flex-wrap gap-2" aria-label={`${step.name} sections`}>
                      {DETAIL[step.slug]!.map((name) => (
                        <li key={name}>
                          <Badge variant="outline">{name}</Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </RiseIn>
      </div>
    </>
  )
}
