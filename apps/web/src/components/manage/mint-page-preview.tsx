import { GlobeIcon, LockIcon, MessageCircleIcon, SendIcon } from 'lucide-react'
import { Artwork } from '@cobweb/ui/components/artwork'
import { Progress } from '@cobweb/ui/components/progress'
import { StatusBadge } from '@cobweb/ui/components/status-badge'
import { cn } from '@cobweb/ui/lib/utils'
import { ChainName } from '@/components/chains/chain-icon'
import { formatNative, type MintPageData, type Socials } from '@/lib/demo'
import { count, percent } from './format'

export type PreviewOverrides = {
  description: string
  bannerUrl: string
  avatarUrl: string
  socials: Socials
  featured: { id: number; name: string; imageUrl: string }[]
}

/**
 * A miniature of the public mint page, drawn from the same data the page renders, with the
 * form's unsaved values laid over it. Not interactive: it is a picture of the page.
 */
export function MintPagePreview({
  data,
  overrides,
  url,
}: {
  data: MintPageData
  overrides: PreviewOverrides
  url: string
}) {
  const { collection, supply } = data
  const live = data.groups.find((group) => group.active)
  const symbol = collection.chain.nativeSymbol
  const socials = [
    overrides.socials.website && { key: 'web', label: 'Website', icon: <GlobeIcon className="size-3" /> },
    overrides.socials.x && {
      key: 'x',
      label: 'X',
      icon: <span className="text-[0.625rem] leading-none font-semibold">X</span>,
    },
    overrides.socials.discord && {
      key: 'discord',
      label: 'Discord',
      icon: <MessageCircleIcon className="size-3" />,
    },
    overrides.socials.telegram && {
      key: 'telegram',
      label: 'Telegram',
      icon: <SendIcon className="size-3" />,
    },
  ].filter((item): item is { key: string; label: string; icon: React.ReactElement } => !!item)

  return (
    <figure
      aria-label="Preview of the public mint page"
      className="bg-sidebar shadow-lifted overflow-hidden rounded-xl border border-border-strong"
    >
      {/* Browser chrome, so it reads as a page and not a card. */}
      <div aria-hidden="true" className="flex items-center gap-2 border-b px-3 py-2">
        <span className="flex gap-1">
          <span className="bg-surface-3 size-2 rounded-full" />
          <span className="bg-surface-3 size-2 rounded-full" />
          <span className="bg-surface-3 size-2 rounded-full" />
        </span>
        <span className="bg-well numeric text-muted-foreground flex-1 truncate rounded-sm px-2 py-0.5 text-[0.6875rem]">
          {url}
        </span>
      </div>

      <div className="bg-background" inert>
        <Artwork
          src={overrides.bannerUrl || null}
          alt=""
          seed={`${collection.slug}-banner`}
          label={overrides.bannerUrl ? undefined : 'No banner'}
          className="aspect-[3/1]"
        />
        <div className="grid gap-4 px-4 pb-4">
          {/* Only the avatar overlaps the banner; the name sits fully below it. */}
          <div className="flex items-start gap-3">
            <Artwork
              src={overrides.avatarUrl || null}
              alt=""
              seed={`${collection.slug}-avatar`}
              className="border-background relative z-10 -mt-7 size-14 shrink-0 rounded-lg border-2"
            />
            <div className="min-w-0 pt-2">
              <p className="truncate text-sm font-semibold">{collection.name}</p>
              <p className="text-muted-foreground flex items-center gap-1.5 text-[0.6875rem]">
                <span className="numeric">{collection.symbol}</span>
                <span aria-hidden="true" className="bg-faint size-0.5 rounded-full" />
                <ChainName chain={collection.chain} iconClassName="size-3" className="gap-1" />
              </p>
            </div>
            {socials.length > 0 && (
              <div className="ml-auto flex gap-1 pt-2">
                {socials.map((social) => (
                  <span
                    key={social.key}
                    title={social.label}
                    className="bg-surface-2 text-muted-foreground flex size-6 items-center justify-center rounded-md"
                  >
                    {social.icon}
                  </span>
                ))}
              </div>
            )}
          </div>

          <p
            className={cn(
              'line-clamp-3 text-[0.75rem] leading-relaxed',
              overrides.description.trim() ? 'text-muted-foreground' : 'text-faint italic',
            )}
          >
            {overrides.description.trim() || 'No description yet.'}
          </p>

          <div className="bg-card shadow-raised grid gap-3 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-[0.75rem] font-medium">{live ? live.name : 'Mint'}</p>
              {live ? (
                <StatusBadge status="live" className="h-5 text-[0.625rem]" />
              ) : (
                <StatusBadge status="scheduled" className="h-5 text-[0.625rem]" />
              )}
            </div>
            <div className="flex items-baseline justify-between">
              <span className="numeric text-base">{live ? formatNative(live.priceWei, symbol) : 'Soon'}</span>
              <span className="numeric text-muted-foreground text-[0.6875rem]">
                {count(supply.minted)} / {count(supply.max)}
              </span>
            </div>
            <Progress size="sm" value={percent(supply.minted, supply.max)} aria-hidden="true" />
            <span className="bg-primary text-primary-foreground flex h-7 items-center justify-center rounded-md text-[0.75rem] font-semibold">
              Mint
            </span>
            {collection.transfersLocked && (
              <p className="text-muted-foreground flex items-center gap-1 text-[0.625rem]">
                <LockIcon className="size-2.5" /> Transfers locked
              </p>
            )}
          </div>

          {overrides.featured.length > 0 && (
            <div className="grid grid-cols-6 gap-1.5">
              {overrides.featured.slice(0, 6).map((token) => (
                <Artwork
                  key={token.id}
                  src={token.imageUrl}
                  alt=""
                  seed={String(token.id)}
                  className="rounded-sm"
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </figure>
  )
}
