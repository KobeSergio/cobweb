import { CircleAlertIcon, CircleCheckIcon } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@cobweb/ui/components/alert'
import { Panel } from '@cobweb/ui/components/panel'
import { Stat, StatGroup } from '@cobweb/ui/components/stat'
import type { MediaType } from '@/lib/demo/types'
import { mediaLabel } from './media'

const n = (value: number) => value.toLocaleString('en-US')

/** Artworks and tokens at a glance, and whether the tokens match the collection's supply. */
export function AssetsSummary({
  artworks,
  tokens,
  maxSupply,
  tokenWord,
  mediaType,
}: {
  artworks: number
  tokens: number
  maxSupply: number
  /** What a token is called for this project: "editions" for 1/1s, "tokens" otherwise. */
  tokenWord: 'editions' | 'tokens'
  /** Single asset: what the shared file is, named in the summary (MASTER_PLAN, Art: media types). */
  mediaType?: MediaType
}) {
  const matches = tokens === maxSupply
  const diff = Math.abs(tokens - maxSupply)
  return (
    <Panel bodyClassName="space-y-5">
      <StatGroup>
        <Stat size="default" label={artworks === 1 ? 'Artwork' : 'Artworks'} value={n(artworks)} />
        <Stat
          label={tokenWord === 'editions' ? 'Total editions' : 'Total tokens'}
          value={n(tokens)}
          suffix={`/ ${n(maxSupply)} supply`}
        />
        {mediaType && (
          // Words, not a number, so not a Stat (its value is set in the mono face).
          <div className="flex min-w-0 flex-col gap-1.5">
            <dt className="text-xs font-medium text-muted-foreground">Media</dt>
            <dd className="text-2xl font-medium tracking-tight">{mediaLabel(mediaType)}</dd>
          </div>
        )}
      </StatGroup>
      {artworks > 0 &&
        (matches ? (
          <p className="flex items-center gap-2 text-sm text-success-foreground">
            <CircleCheckIcon aria-hidden="true" className="size-4 shrink-0" />
            The {tokenWord} match the collection supply.
          </p>
        ) : (
          <Alert variant="warning" role="status">
            <CircleAlertIcon aria-hidden="true" />
            <AlertTitle>The {tokenWord} do not match the supply</AlertTitle>
            <AlertDescription>
              Your collection has a supply of <span className="numeric">{n(maxSupply)}</span> but{' '}
              {tokens < maxSupply ? 'only ' : ''}
              <span className="numeric">{n(tokens)}</span> {tokenWord} {tokens === 1 ? 'is' : 'are'} here,{' '}
              <span className="numeric">{n(diff)}</span> {tokens < maxSupply ? 'short' : 'too many'}. You can
              continue, but add or remove artwork, or change the supply in the details, to make them agree.
            </AlertDescription>
          </Alert>
        ))}
    </Panel>
  )
}
