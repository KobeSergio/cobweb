import { ArtStage } from './art-stage'
import { About, Details, Gallery, MintFooter } from './collection-sections'
import { MintProvider } from './mint-context'
import { MintFlowDialog } from './mint-flow-dialog'
import { MintPanel } from './mint-panel'
import { DegradedBanner, MintTopBar } from './mint-top-bar'
import { PageSections } from './page-sections'
import { PhaseList } from './phase-list'
import { RecentMints } from './recent-mints'
import { StickyMintBar } from './sticky-mint-bar'
import type { MintPageProps } from './types'

/**
 * The public mint page. It stands alone: no app sidebar, the collection's identity at the top, the art and the
 * mint menu side by side, then the collection itself below. The content comes from the page's document; the
 * chain's state from the source the browser polls.
 */
export function MintPage(props: MintPageProps) {
  const { page } = props
  return (
    <MintProvider {...props}>
      {/* Most collectors mint on a phone, so this page reads one step larger there than the
          dashboard's 12px root. The rule only exists while this page is mounted. */}
      <style>{'@media (max-width: 639px) { html { font-size: 14px } }'}</style>
      <div className="relative isolate min-h-svh overflow-x-clip">
        {/* The creator's banner, dimmed into the page behind the hero; the theme's colours without one. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 -z-20 h-[34rem] overflow-hidden"
          style={{ maskImage: 'linear-gradient(to bottom, black 20%, transparent 100%)' }}
        >
          {page.bannerUrl ? (
            <img src={page.bannerUrl} alt="" className="size-full object-cover opacity-[0.16] blur-[2px]" />
          ) : (
            <div className="from-primary/10 via-surface-2 to-background size-full bg-linear-to-b" />
          )}
        </div>

        <MintTopBar page={page} />
        <DegradedBanner />

        <main className="mx-auto max-w-[90rem] px-4 pt-6 sm:px-8 lg:pt-10">
          <div className="grid gap-10 lg:grid-cols-12 lg:gap-12 xl:gap-16">
            <div className="self-start lg:sticky lg:top-10 lg:col-span-7 lg:pt-8">
              <ArtStage />
            </div>
            <div className="lg:col-span-5">
              <MintPanel />
              <PhaseList />
              <RecentMints />
            </div>
          </div>
        </main>

        <div className="mt-24 lg:mt-32">
          <Gallery />
        </div>

        <div className="mx-auto mt-20 grid max-w-[90rem] gap-14 px-4 sm:px-8 lg:mt-28 lg:grid-cols-12 lg:gap-12 xl:gap-16">
          <div className="lg:col-span-7">
            <About page={page} />
          </div>
          <div className="lg:col-span-5">
            <Details />
          </div>
        </div>

        <PageSections page={page} />

        <MintFooter />
        <StickyMintBar />
        <MintFlowDialog />
      </div>
    </MintProvider>
  )
}
