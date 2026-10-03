import type { Metadata } from 'next'
import { CornerWeb } from '@cobweb/ui/components/artwork'
import { Stagger, StaggerItem } from '@cobweb/ui/components/motion'
import { PageHeader } from '@cobweb/ui/components/page-header'
import { CollectionCard } from '@/components/collections/collection-card'
import { CreateCollectionDialog } from '@/components/collections/create-collection-dialog'
import { DashboardTopbar } from '@/components/shell/dashboard-topbar'
import { requireUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { STEPS } from '@/lib/steps'

export const metadata: Metadata = { title: 'Collections' }

export default async function CollectionsPage() {
  const user = await requireUser()
  const supabase = await createClient()
  // Row-level security returns only this creator's collections; the filter states the intent.
  const { data: collections, error } = await supabase
    .from('collections')
    .select('*')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: false })

  if (error) throw new Error('Collections could not be loaded.')

  const deployed = collections.filter((collection) => collection.status === 'deployed').length

  return (
    <>
      <DashboardTopbar title="Collections" walletAddress={user.walletAddress} />

      {collections.length === 0 ? (
        <EmptyDashboard />
      ) : (
        <div className="mx-auto w-full max-w-[90rem] space-y-8 px-8 pt-10 pb-16">
          <PageHeader
            title="Collections"
            description={
              <>
                <span className="numeric text-foreground">{collections.length}</span>{' '}
                {collections.length === 1 ? 'collection' : 'collections'},{' '}
                <span className="numeric text-foreground">{deployed}</span> deployed.
              </>
            }
            actions={<CreateCollectionDialog />}
          />
          <Stagger className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3 3xl:grid-cols-4">
            {collections.map((collection) => (
              <StaggerItem key={collection.id}>
                <CollectionCard collection={collection} />
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      )}
    </>
  )
}

/**
 * First visit: an empty gallery wall. Three empty frames hang behind the invitation to start,
 * and the stages of a launch sit underneath so the creator knows what follows.
 */
function EmptyDashboard() {
  return (
    <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden px-8 py-16">
      {/* The wall: three empty frames, dimmed, behind the call to action. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-[12%] flex justify-center gap-6 opacity-90 [mask-image:linear-gradient(to_bottom,black_10%,transparent_75%)]"
      >
        {['wall-a', 'wall-b', 'wall-c'].map((seed, index) => (
          <div
            key={seed}
            className="spotlight relative aspect-[4/5] w-56 overflow-hidden rounded-xl border bg-card shadow-raised"
            style={{ transform: `translateY(${index === 1 ? 0 : 2.5}rem)` }}
          >
            <CornerWeb seed={seed} className="text-foreground/25" />
          </div>
        ))}
      </div>

      <div className="relative z-10 mt-40 flex max-w-xl flex-col items-center text-center">
        <h1 className="text-display">Your first collection starts here</h1>
        <p className="mt-4 max-w-md text-[0.9375rem] leading-relaxed text-muted-foreground">
          Give it a name and a type. You will build the art, deploy the contract and open the mint from
          there.
        </p>
        <div className="mt-8">
          <CreateCollectionDialog variant="empty" />
        </div>
      </div>

      <ol className="relative z-10 mt-16 grid w-full max-w-4xl grid-cols-5 gap-3">
        {STEPS.map((step, index) => (
          <li key={step.slug} className="rounded-lg border bg-card/60 px-4 py-3.5">
            <span className="numeric text-xs text-muted-foreground">{String(index + 1).padStart(2, '0')}</span>
            <p className="mt-1 text-sm font-medium">{step.name}</p>
          </li>
        ))}
      </ol>
    </div>
  )
}
