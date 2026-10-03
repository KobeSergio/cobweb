import { Skeleton } from '@cobweb/ui/components/skeleton'

/** The page's shape while it loads: top bar, the art, the mint panel and the phases. */
export function MintPageSkeleton() {
  return (
    <div className="min-h-svh" aria-busy="true" aria-label="Loading the mint page">
      <div className="mx-auto flex h-16 max-w-[90rem] items-center justify-between px-4 sm:h-[4.5rem] sm:px-8">
        <div className="flex items-center gap-3">
          <Skeleton className="size-9 rounded-full" />
          <Skeleton className="h-4 w-28" />
        </div>
        <Skeleton className="h-10 w-36" />
      </div>
      <div className="mx-auto max-w-[90rem] px-4 pt-6 sm:px-8 lg:pt-10">
        <div className="grid gap-10 lg:grid-cols-12 lg:gap-12 xl:gap-16">
          <div className="lg:col-span-7 lg:pt-8">
            <Skeleton className="mx-auto aspect-square w-[84%] max-w-[34rem] rounded-xl sm:w-[76%] lg:w-[82%]" />
            <Skeleton className="mx-auto mt-6 h-4 w-[40%] max-w-[12rem]" />
          </div>
          <div className="lg:col-span-5">
            <div className="rounded-xl border border-border-strong bg-card p-5 sm:p-7">
              <Skeleton className="h-6 w-28 rounded-full" />
              <Skeleton className="mt-5 h-10 w-3/4" />
              <Skeleton className="mt-3 h-4 w-32" />
              <Skeleton className="mt-7 h-4 w-full" />
              <Skeleton className="mt-3 h-1 w-full rounded-full" />
              <div className="mt-7 space-y-4 border-t pt-6">
                <div className="flex justify-between">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-8 w-28" />
                </div>
                <Skeleton className="h-12 w-full rounded-lg" />
                <Skeleton className="h-20 w-full" />
              </div>
              <Skeleton className="mt-6 h-14 w-full" />
            </div>
            <Skeleton className="mt-10 h-5 w-20" />
            <Skeleton className="mt-4 h-24 w-full rounded-xl" />
            <Skeleton className="mt-2.5 h-24 w-full rounded-xl" />
          </div>
        </div>
      </div>
    </div>
  )
}
