import { ExternalLinkIcon, GlobeIcon, MessageCircleIcon, AtSignIcon } from 'lucide-react'
import { Button } from '@cobweb/ui/components/button'
import { cn } from '@cobweb/ui/lib/utils'
import type { MintPageData } from '@/lib/demo'
import { explorerAddressUrl, formatBps, shortAddress } from '@/lib/demo/helpers'
import { LogoMark } from '@/components/shell/logo'
import { CopyButton } from './copy-button'
import { TokenImage } from './token-image'
import type { MintPageExtras } from './types'

/*
 * A salon hang: the featured tokens at different sizes and heights, like a wall in a small
 * gallery, rather than a row of equal cards. On phones the wall becomes a strip you swipe.
 */
const HANG = [
  { size: 'w-[64vw] sm:w-[40vw] lg:w-auto lg:flex-24', align: 'self-start' },
  { size: 'w-[46vw] sm:w-[28vw] lg:w-auto lg:flex-14', align: 'self-end' },
  { size: 'w-[56vw] sm:w-[34vw] lg:w-auto lg:flex-19', align: 'self-center' },
  { size: 'w-[42vw] sm:w-[26vw] lg:w-auto lg:flex-13', align: 'self-start lg:mt-10' },
  { size: 'w-[60vw] sm:w-[36vw] lg:w-auto lg:flex-20', align: 'self-end' },
  { size: 'w-[46vw] sm:w-[28vw] lg:w-auto lg:flex-15', align: 'self-center lg:-mt-6' },
]

export function Gallery({ data }: { data: MintPageData }) {
  const featured = data.collection.featured
  if (featured.length === 0) return null
  return (
    <section id="gallery" aria-labelledby="gallery-title" className="scroll-mt-8">
      <h2 id="gallery-title" className="text-title px-4 sm:px-8">
        From the collection
      </h2>
      <ul className="scrollbar-hide mt-8 flex snap-x snap-mandatory scroll-px-4 items-start sm:scroll-px-8 gap-4 overflow-x-auto px-4 pb-4 sm:gap-5 sm:px-8 lg:min-h-[26rem] lg:snap-none lg:overflow-visible">
        {featured.map((token, index) => {
          const hang = HANG[index % HANG.length]!
          return (
            <li key={token.id} className={cn('shrink-0 snap-start', hang.size, hang.align)}>
              <figure className="group">
                <div className="overflow-hidden rounded-xl border border-border-strong shadow-raised transition-[transform,box-shadow] duration-300 ease-out-expo group-hover:-translate-y-1 group-hover:shadow-lifted">
                  <TokenImage
                    layers={[token.imageUrl]}
                    alt={token.name}
                    className="transition-transform duration-500 ease-out-expo group-hover:scale-[1.03]"
                  />
                </div>
                <figcaption className="mt-2.5 flex items-baseline justify-between gap-2 text-[0.8125rem]">
                  <span className="truncate text-muted-foreground">{data.collection.name}</span>
                  <span className="numeric text-foreground">#{token.id}</span>
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
] as const

export function About({ data }: { data: MintPageData }) {
  const { collection } = data
  const socials = SOCIALS.filter((entry) => collection.socials[entry.key])
  return (
    <section aria-labelledby="about-title">
      <div className="overflow-hidden rounded-xl border border-border-strong bg-well">
        <img src={collection.bannerUrl} alt="" className="aspect-[3/1] w-full object-cover" loading="lazy" />
      </div>
      <h2 id="about-title" className="text-title mt-8">
        About {collection.name}
      </h2>
      <p className="mt-3 max-w-[62ch] text-base leading-relaxed text-foreground/85">
        {collection.description}
      </p>
      {socials.length > 0 && (
        <div className="mt-6 flex flex-wrap gap-2.5">
          {socials.map(({ key, label, Icon }) => (
            <Button key={key} asChild variant="outline" size="sm">
              <a href={collection.socials[key]} target="_blank" rel="noreferrer">
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

export function Details({ data, extras }: { data: MintPageData; extras: MintPageExtras }) {
  const { collection } = data
  const chain = collection.chain
  const rows: { label: string; value: React.ReactNode }[] = [
    { label: 'Chain', value: chain.name },
    { label: 'Token standard', value: 'ERC-721C' },
    { label: 'Supply', value: <span className="numeric">{data.supply.max.toLocaleString('en-US')}</span> },
    { label: 'Royalties', value: <span className="numeric">{formatBps(extras.royaltyBps)}</span> },
    { label: 'Transfers', value: collection.transfersLocked ? 'Locked by the creator' : 'Open' },
    { label: 'Art', value: collection.revealed ? 'Revealed' : 'Reveals after the mint' },
  ]
  return (
    <section aria-labelledby="details-title">
      <h2 id="details-title" className="text-title">
        Details
      </h2>
      <div className="mt-5 rounded-xl border bg-card p-5 shadow-raised sm:p-6">
        <p className="text-[0.8125rem] text-muted-foreground">Contract</p>
        <div className="mt-1.5 flex items-center gap-1">
          <a
            href={explorerAddressUrl(chain, collection.contractAddress)}
            target="_blank"
            rel="noreferrer"
            className="numeric inline-flex min-w-0 items-center gap-1.5 text-[0.9375rem] underline-offset-4 hover:underline"
          >
            <span className="truncate">{shortAddress(collection.contractAddress, 6)}</span>
            <ExternalLinkIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="sr-only">(opens the explorer)</span>
          </a>
          <CopyButton value={collection.contractAddress} label="Copy contract address" />
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
