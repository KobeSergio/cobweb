import type { Metadata } from 'next'
import { LayersIcon } from 'lucide-react'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@cobweb/ui/components/empty'
import { CollectionCard } from '@/components/collections/collection-card'
import { CreateCollectionDialog } from '@/components/collections/create-collection-dialog'
import { DashboardTopbar } from '@/components/shell/dashboard-topbar'
import { requireUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

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

  return (
    <>
      <DashboardTopbar title="Collections" walletAddress={user.walletAddress}>
        {collections.length > 0 && <CreateCollectionDialog />}
      </DashboardTopbar>

      {collections.length === 0 ? (
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LayersIcon />
            </EmptyMedia>
            <EmptyTitle>No collections yet</EmptyTitle>
            <EmptyDescription>
              Start with a name and a collection type. You will add the art, deploy the contract and open the
              mint from there.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <CreateCollectionDialog variant="empty" />
          </EmptyContent>
        </Empty>
      ) : (
        <div className="grid grid-cols-1 gap-4 p-6 lg:grid-cols-2 2xl:grid-cols-3">
          {collections.map((collection) => (
            <CollectionCard key={collection.id} collection={collection} />
          ))}
        </div>
      )}
    </>
  )
}
