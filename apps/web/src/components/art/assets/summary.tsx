import { Panel } from '@cobweb/ui/components/panel'
import { Stat, StatGroup } from '@cobweb/ui/components/stat'
import type { MediaType } from '@/lib/demo/types'
import { mediaLabel } from './media'

const n = (value: number) => value.toLocaleString('en-US')

/**
 * Artworks and tokens at a glance. The tokens are the supply this art makes (1/1s: files times
 * editions; single asset: the quantity); `children` saves it (`SupplySave`).
 */
export function AssetsSummary({
  artworks,
  tokens,
  tokenWord,
  mediaType,
  children,
}: {
  artworks: number
  tokens: number
  /** What a token is called for this project: "editions" for 1/1s, "tokens" otherwise. */
  tokenWord: 'editions' | 'tokens'
  /** Single asset: what the shared file is, named in the summary (MASTER_PLAN, Art: media types). */
  mediaType?: MediaType
  children?: React.ReactNode
}) {
  return (
    <Panel bodyClassName="space-y-5">
      <StatGroup>
        <Stat size="default" label={artworks === 1 ? 'Artwork' : 'Artworks'} value={n(artworks)} />
        <Stat label={tokenWord === 'editions' ? 'Total editions' : 'Total tokens'} value={n(tokens)} />
        {mediaType && (
          // Words, not a number, so not a Stat (its value is set in the mono face).
          <div className="flex min-w-0 flex-col gap-1.5">
            <dt className="text-muted-foreground text-xs font-medium">Media</dt>
            <dd className="text-2xl font-medium tracking-tight">{mediaLabel(mediaType)}</dd>
          </div>
        )}
      </StatGroup>
      {children}
    </Panel>
  )
}
