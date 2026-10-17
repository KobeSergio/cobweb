'use client'

import { ExternalLinkIcon, GlobeIcon, MessageCircleIcon, AtSignIcon, SendIcon } from 'lucide-react'
import { Button } from '@cobweb/ui/components/button'
import { Skeleton } from '@cobweb/ui/components/skeleton'
import { cn } from '@cobweb/ui/lib/utils'
import { explorerAddressUrl, formatBps, shortAddress } from '@/lib/demo/helpers'
import type { MintLive } from '@/lib/mint/live-data'
import type { MintPageStatic } from '@/lib/mint/page-doc'
import { ChainName } from '@/components/chains/chain-icon'
import { LogoMark } from '@/components/shell/logo'
import { CopyButton } from './copy-button'
import { useMint } from './mint-context'
import { TokenArtFrame } from './token-image'
import { useTokenArt } from './use-token-art'

/*
 * A salon hang: the featured tokens at different sizes and heights, like a wall in a small
 * gallery, rather than a row of equal cards. On phones the wall becomes a strip you swipe. On wide
 * screens each card takes its share of a wall of six (24, 14, 19, 13, 20 and 15 parts of the row,
 * less the five gaps), so a page that features fewer keeps the same sizes instead of stretching them.
 */
const HANG = [
  { size: 'w-[64vw] sm:w-[40vw] lg:w-[calc((100%_-_6.25rem)*24/105)]', align: 'self-start' },
  { size: 'w-[46vw] sm:w-[28vw] lg:w-[calc((100%_-_6.25rem)*14/105)]', align: 'self-end' },
  { size: 'w-[56vw] sm:w-[34vw] lg:w-[calc((100%_-_6.25rem)*19/105)]', align: 'self-center' },
  { size: 'w-[42vw] sm:w-[26vw] lg:w-[calc((100%_-_6.25rem)*13/105)]', align: 'self-start lg:mt-10' },
  { size: 'w-[60vw] sm:w-[36vw] lg:w-[calc((100%_-_6.25rem)*20/105)]', align: 'self-end' },
  { size: 'w-[46vw] sm:w-[28vw] lg:w-[calc((100%_-_6.25rem)*15/105)]', align: 'self-center lg:-mt-6' },
]

/** "From the collection": the featured tokens once revealed; hidden before the reveal and for a single asset. */
export function Gallery() {
  const { page, live, source } = useMint()
  const shown = !!live?.revealed && page.projectType !== 'single_asset'
  const featured = shown ? page.featuredTokenIds : []
  const art = useTokenArt(source, live?.baseUri ?? null, featured)
  if (featured.length === 0) return null
  return (
    <section id="gallery" aria-labelledby="gallery-title" className="scroll-mt-8">
      <h2 id="gallery-title" className="text-title px-4 sm:px-8">
        From the collection
      </h2>
      <ul className="scrollbar-hide mt-8 flex snap-x snap-mandatory scroll-px-4 items-start sm:scroll-px-8 gap-4 overflow-x-auto px-4 pb-4 sm:gap-5 sm:px-8 lg:min-h-[26rem] lg:snap-none lg:overflow-visible">
        {featured.map((id, index) => {
          const hang = HANG[index % HANG.length]!
          return (
            <li key={id} className={cn('shrink-0 snap-start', hang.size, hang.align)}>
              <figure className="group">
                <div className="overflow-hidden rounded-xl border border-border-strong shadow-raised transition-[transform,box-shadow] duration-300 ease-out-expo group-hover:-translate-y-1 group-hover:shadow-lifted">
                  <TokenArtFrame
                    art={art.get(id)}
                    id={id}
                    alt={`${page.name} #${id}`}
                    className="transition-transform duration-500 ease-out-expo group-hover:scale-[1.03]"
                  />
                </div>
                <figcaption className="mt-2.5 flex items-baseline justify-between gap-2 text-[0.8125rem]">
                  <span className="truncate text-muted-foreground">{page.name}</span>
                  <span className="numeric text-foreground">#{id}</span>
                </figcaption>
              </figure>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

const SOCIALS = [
  { key: 'website', label: 'Website', Icon: GlobeIcon },
  { key: 'x', label: 'X', Icon: AtSignIcon },
  { key: 'discord', label: 'Discord', Icon: MessageCircleIcon },
  { key: 'telegram', label: 'Telegram', Icon: SendIcon },
] as const

/** The collection's story: the About banner (else the banner), the description as plain text, and its links. */
export function About({ page }: { page: MintPageStatic }) {
  const socials = SOCIALS.filter((entry) => page.socials[entry.key]?.startsWith('https://'))
  const banner = page.aboutBannerUrl ?? page.bannerUrl
  return (
    <section aria-labelledby="about-title">
      {banner && (
        <div className="mb-8 overflow-hidden rounded-xl border border-border-strong bg-well">
          <img src={banner} alt="" className="aspect-[3/1] w-full object-cover" loading="lazy" />
        </div>
      )}
      <h2 id="about-title" className="text-title">
        About {page.name}
      </h2>
      {page.description && (
        <p className="mt-3 max-w-[62ch] text-base leading-relaxed whitespace-pre-line text-foreground/85">
          {page.description}
        </p>
      )}
      {socials.length > 0 && (
        <div className="mt-6 flex flex-wrap gap-2.5">
          {socials.map(({ key, label, Icon }) => (
            <Button key={key} asChild variant="outline" size="sm">
              <a href={page.socials[key]} target="_blank" rel="noreferrer">
                <Icon />
                {label}
              </a>
            </Button>
          ))}
        </div>
      )}
    </section>
  )
}

/** The Transfers row's words, by the collection's level on its validator. */
const TRANSFERS: Record<NonNullable<MintLive['transfers']>, string> = {
  open: 'Open',
  locked: 'Locked by the creator',
  restricted: 'Restricted by the creator',
}

/** The contract and its facts: supply, royalties, transfers and the art, from the chain's state. */
export function Details() {
  const { page, live, track } = useMint()
  const chain = page.chain
  // The chain's rows pulse until the first answer; after a refusal that ends the polls they are left off.
  const pending = track.final ? null : <Skeleton className="h-4 w-20" />
  const rows: { label: string; value: React.ReactNode }[] = [
    { label: 'Chain', value: <ChainName chain={chain} /> },
    { label: 'Token standard', value: 'ERC-721C' },
    {
      label: 'Supply',
      value: live ? <span className="numeric">{live.supply.max.toLocaleString('en-US')}</span> : pending,
    },
    // The indexer's count (docs/specs/2026-10-16-indexer-overview.md, section 7.5); left out while it has none.
    ...(live?.activity
      ? [
          {
            label: 'Holders',
            value: <span className="numeric">{live.activity.holders.toLocaleString('en-US')}</span>,
          },
        ]
      : []),
    {
      label: 'Royalties',
      value: live ? (
        <>
          <span className="numeric">{formatBps(live.royaltyBps)}</span>
          {live.royaltyEnforced && ', enforced on secondary sales through the transfer validator'}
        </>
      ) : (
        pending
      ),
    },
    ...(live?.transfers ? [{ label: 'Transfers', value: TRANSFERS[live.transfers] }] : []),
    { label: 'Art', value: live ? (live.revealed ? 'Revealed' : 'Not revealed yet') : pending },
  ].filter((row) => row.value !== null)
  return (
    <section aria-labelledby="details-title">
      <h2 id="details-title" className="text-title">
        Details
      </h2>
      <div className="mt-5 rounded-xl border bg-card p-5 shadow-raised sm:p-6">
        <p className="text-[0.8125rem] text-muted-foreground">Contract</p>
        <div className="mt-1.5 flex items-center gap-1">
          {chain.explorerUrl ? (
            <a
              href={explorerAddressUrl(chain, page.contract)}
              target="_blank"
              rel="noreferrer"
              className="numeric inline-flex min-w-0 items-center gap-1.5 text-[0.9375rem] underline-offset-4 hover:underline"
            >
              <span className="truncate">{shortAddress(page.contract, 6)}</span>
              <ExternalLinkIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="sr-only">(opens the explorer)</span>
            </a>
          ) : (
            <span className="numeric min-w-0 truncate text-[0.9375rem]">
              {shortAddress(page.contract, 6)}
            </span>
          )}
          <CopyButton value={page.contract} label="Copy contract address" />
        </div>
        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-t pt-5">
          {rows.map((row) => (
            <div key={row.label}>
              <dt className="text-[0.8125rem] text-muted-foreground">{row.label}</dt>
              <dd className="mt-0.5 text-sm">{row.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}

export function MintFooter() {
  return (
    <footer className="mx-auto mt-24 flex max-w-[90rem] flex-col items-center justify-between gap-3 border-t px-4 py-8 pb-28 text-[0.8125rem] text-muted-foreground sm:flex-row sm:px-8 lg:pb-8">
      <a
        href="/"
        className="inline-flex items-center gap-2 rounded-md outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <LogoMark className="size-5" />
        Powered by Cobweb
      </a>
      <p>Prices are in the chain&apos;s native token. Gas is extra.</p>
    </footer>
  )
}
