import type { Metadata } from 'next'
import { DashboardTopbar } from '@/components/shell/dashboard-topbar'
import { requireUser } from '@/lib/auth'
import { STEPS } from '@/lib/steps'

export const metadata: Metadata = { title: 'Help' }

/** A short guide to the launch flow. Fuller documentation comes as each step is built. */
export default async function HelpPage() {
  const user = await requireUser()

  return (
    <>
      <DashboardTopbar title="Help" walletAddress={user.walletAddress} />
      <div className="mx-auto w-full max-w-3xl space-y-8 p-6 py-10">
        <header className="space-y-2">
          <h2 className="text-2xl font-semibold">How a launch works</h2>
          <p className="text-muted-foreground text-base text-pretty">
            Every collection goes through the same steps, in this order. You can leave at any point and pick
            up where you stopped.
          </p>
        </header>
        <ol className="divide-y rounded-lg border">
          {STEPS.map((step, index) => (
            <li key={step.slug} className="flex gap-4 p-5">
              <span
                aria-hidden="true"
                className="text-muted-foreground w-5 shrink-0 text-sm font-medium tabular-nums"
              >
                {index + 1}
              </span>
              <div>
                <h3 className="text-base font-medium">{step.name}</h3>
                <p className="text-muted-foreground mt-1 text-sm text-pretty">{step.summary}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </>
  )
}
