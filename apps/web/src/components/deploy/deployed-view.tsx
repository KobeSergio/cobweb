'use client'

import {
  ArrowRightIcon,
  CheckIcon,
  ImageIcon,
  LayersIcon,
  ListChecksIcon,
  Share2Icon,
  ShieldCheckIcon,
} from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import Link from 'next/link'
import { useEffect, useRef } from 'react'
import { Artwork } from '@cobweb/ui/components/artwork'
import { Button } from '@cobweb/ui/components/button'
import { Stagger, StaggerItem } from '@cobweb/ui/components/motion'
import { Panel } from '@cobweb/ui/components/panel'
import { EASE_OUT, transition } from '@cobweb/ui/lib/motion'
import { ChainIcon, ChainName } from '@/components/chains/chain-icon'
import { slugState } from '@/lib/collections'
import type { Tables } from '@/lib/database.types'
import {
  explorerAddressUrl,
  explorerTxUrl,
  formatBps,
  formatNative,
  formatUtc,
  shortAddress,
} from '@/lib/demo/helpers'
import type { SupportedChain } from '@/lib/demo/types'
import type { DeployRecord } from '@/lib/deploy/deploy-types'
import { useArtDeferred } from './art-deferred'
import { CopyValue, SummaryRow } from './copy-value'
import { mintFeeText } from './deploy-summary'

/** The deployed view's primary action, for the footer: Manage drop, where the phases are opened. */
export function SetUpDropButton({ collectionId }: { collectionId: string }) {
  return (
    <Button asChild>
      <Link href={`/collections/${collectionId}/manage`}>
        Set up your drop
        <ArrowRightIcon aria-hidden="true" />
      </Link>
    </Button>
  )
}

/** The deployed contract as the server recorded it: where it is, the receipt, and what to do next in Manage drop. */
export function DeployedView({
  collection,
  record,
  chain,
  artSrc,
  mintPagePublished,
  focusOnMount = false,
}: {
  collection: Tables<'collections'>
  record: DeployRecord
  chain: SupportedChain
  artSrc: string | null
  /**
   * Whether the mint page is public, for the link row: it opens the page once public. Null when the mint page's row
   * could not be read: the row shows the link alone.
   */
  mintPagePublished: boolean | null
  /** Move focus to the heading, after a deploy that just finished on this screen. */
  focusOnMount?: boolean
}) {
  const reduce = useReducedMotion()
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (focusOnMount) headingRef.current?.focus()
  }, [focusOnMount])
  const artDeferred = useArtDeferred()
  const manage = `/collections/${collection.id}/manage`
  // A deploy makes a live reservation permanent; one that lapsed first was released.
  const state = slugState(collection)
  const slug = state.kind === 'permanent' || state.kind === 'reserved' ? state.slug : null
  // A chain with no explorer (Anvil) has no links to show.
  const explorerName = chain.explorerUrl ? new URL(chain.explorerUrl).hostname.replace(/^www\./, '') : null
  const nextSteps = [
    // Deferred art (MASTER_PLAN, Flow: pre-reveal): the contract is on the placeholder until the real set is revealed.
    ...(artDeferred
      ? [
          {
            href: `/collections/${collection.id}/art/generate`,
            icon: <ImageIcon />,
            title: 'Finish the art, then reveal',
            text: 'Art stays open. Lock and upload the real set, then reveal it from Settings.',
          },
        ]
      : []),
    {
      href: `${manage}/phases`,
      icon: <LayersIcon />,
      title: 'Open the phases',
      text: 'Every phase starts closed. Open the public sale, or schedule it, in Phases.',
    },
    {
      href: `${manage}/whitelist`,
      icon: <ListChecksIcon />,
      title: 'Upload the whitelist',
      text: 'Add wallets and their quotas to each whitelist phase.',
    },
    {
      href: `${manage}/mint-page`,
      icon: <Share2Icon />,
      title: 'Prepare the mint page',
      text: slug
        ? 'Add a banner and links, then make the page public.'
        : 'Choose its link, add a banner and links, then make the page public.',
    },
  ]

  return (
    <div className="space-y-10">
      <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-center">
        <div className="relative shrink-0">
          <motion.div
            initial={reduce ? false : { opacity: 0, scale: 0.92, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={transition.slow}
          >
            <Artwork
              src={artSrc}
              alt={`${collection.name} sample token`}
              seed={collection.id}
              className="border-border-strong shadow-lifted size-24 rounded-xl border"
            />
          </motion.div>
          {/* The seal lands once, with a single ring that widens and fades. */}
          <motion.span
            aria-hidden="true"
            initial={reduce ? false : { scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ ...transition.spring, delay: reduce ? 0 : 0.25 }}
            className="bg-success text-background ring-card absolute -right-2 -bottom-2 flex size-8 items-center justify-center rounded-full ring-4"
          >
            <CheckIcon className="size-4" strokeWidth={3} />
          </motion.span>
          {!reduce && (
            <motion.span
              aria-hidden="true"
              initial={{ scale: 0.6, opacity: 0.7 }}
              animate={{ scale: 2.2, opacity: 0 }}
              transition={{ duration: 0.9, ease: EASE_OUT, delay: 0.3 }}
              className="border-success absolute -right-2 -bottom-2 size-8 rounded-full border-2"
            />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <h3 ref={headingRef} className="text-title outline-none" tabIndex={-1}>
            {collection.name} is deployed on{' '}
            <span className="inline-flex items-center gap-2 align-bottom">
              <ChainIcon chainId={chain.id} className="text-muted-foreground" />
              {chain.name}
            </span>
          </h3>
          <p className="text-muted-foreground text-[0.9375rem] leading-relaxed">
            The contract is deployed and every phase starts closed. Nothing can be minted until you open a
            phase.
          </p>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Panel title="Contract" bodyClassName="px-6 py-2">
            <dl className="divide-y">
              <SummaryRow label="Chain">
                <ChainName chain={chain} className="text-[0.8125rem]" />
              </SummaryRow>
              <SummaryRow label="Address">
                <CopyValue
                  value={record.contractAddress}
                  label="Contract address"
                  display={shortAddress(record.contractAddress, 8)}
                  href={explorerName ? explorerAddressUrl(chain, record.contractAddress) : undefined}
                  linkLabel={explorerName ? `View on ${explorerName}` : undefined}
                />
              </SummaryRow>
              <SummaryRow label="Transaction">
                <CopyValue
                  value={record.txHash}
                  label="Transaction hash"
                  display={shortAddress(record.txHash, 8)}
                  href={explorerName ? explorerTxUrl(chain, record.txHash) : undefined}
                  linkLabel={explorerName ? `View on ${explorerName}` : undefined}
                />
              </SummaryRow>
              <SummaryRow label="Deployed">
                <span className="numeric text-[0.8125rem]">{formatUtc(record.deployedAt)}</span>
              </SummaryRow>
              <SummaryRow label="Deployed by">
                <span className="numeric text-[0.8125rem]" title={record.deployer}>
                  {shortAddress(record.deployer)}
                </span>
              </SummaryRow>
              <SummaryRow label="Starts on">
                <span className="numeric truncate text-[0.8125rem]" title={record.baseUri}>
                  {record.baseUri.replace(/^(ipfs:\/\/.{10}).*(.{6})$/, '$1…$2')}
                </span>
              </SummaryRow>
              <SummaryRow label="Mint page link">
                {slug ? (
                  <span className="flex min-w-0 flex-col items-end">
                    <span className="numeric text-[0.8125rem]">cobweb.app/{slug}</span>
                    {mintPagePublished ? (
                      <a
                        href={`/${slug}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs underline-offset-4 hover:underline"
                      >
                        Open mint page
                      </a>
                    ) : mintPagePublished === false ? (
                      <span className="text-muted-foreground text-xs">
                        Not public yet. Make it public in Manage drop, Mint page.
                      </span>
                    ) : null}
                  </span>
                ) : (
                  <span className="text-muted-foreground text-[0.8125rem]">
                    None yet. Set it in Manage drop.
                  </span>
                )}
              </SummaryRow>
              <SummaryRow label="Payout">
                <span className="numeric text-[0.8125rem]" title={record.payout}>
                  {shortAddress(record.payout)}
                </span>
              </SummaryRow>
              <SummaryRow label="Royalty">
                <span className="numeric text-[0.8125rem]">
                  {formatBps(record.royaltyBps)} to {shortAddress(record.royaltyReceiver)}
                </span>
              </SummaryRow>
              <SummaryRow label="Public limit">
                <span>
                  <span className="numeric">{record.publicMaxPerWallet}</span> per wallet
                </span>
              </SummaryRow>
              <SummaryRow label="Mint fee">
                <span className="numeric text-[0.8125rem]">
                  {mintFeeText(record.fees, chain.nativeSymbol)}
                </span>
              </SummaryRow>
            </dl>
            <div className="bg-surface-2/40 -mx-6 mt-2 -mb-2 flex gap-3 rounded-b-xl border-t px-6 py-4">
              <ShieldCheckIcon aria-hidden="true" className="text-muted-foreground mt-0.5 size-4 shrink-0" />
              <div className="space-y-1 text-[0.8125rem] leading-snug">
                <p className="font-medium">
                  Royalties <span className="numeric">{formatBps(record.royaltyBps)}</span>, enforced on
                  secondary sales through the transfer validator
                </p>
                <p className="text-muted-foreground">
                  Collectors can resell only where the royalty is paid; marketplaces that skip it cannot move
                  the tokens.
                </p>
              </div>
            </div>
          </Panel>

          <Panel
            title="Launch phases"
            description="As the constructor took them, all closed."
            bodyClassName="px-6 py-2"
          >
            <dl className="divide-y">
              {record.groups.map((group) => (
                <SummaryRow key={group.onchainId} label={`${group.onchainId}. ${group.name}`}>
                  <span className="numeric text-[0.8125rem]">
                    {formatNative(group.priceWei, chain.nativeSymbol, 18)} ·{' '}
                    {group.maxSupply.toLocaleString('en-US')} tokens · closed
                  </span>
                </SummaryRow>
              ))}
            </dl>
          </Panel>
        </div>

        <Panel
          title="What happens next"
          description={artDeferred ? 'The art first, then Manage drop.' : 'All in Manage drop.'}
          bodyClassName="p-3"
        >
          <Stagger className="space-y-1">
            {nextSteps.map((step, index) => (
              <StaggerItem key={step.href}>
                <Link
                  href={step.href}
                  className="group hover:bg-surface-2 focus-visible:ring-ring flex items-start gap-3.5 rounded-lg p-3 outline-none transition-colors focus-visible:ring-2"
                >
                  <span
                    aria-hidden="true"
                    className="bg-surface-3 text-muted-foreground shadow-raised flex size-9 shrink-0 items-center justify-center rounded-md [&_svg]:size-4"
                  >
                    {step.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">
                      <span className="numeric text-muted-foreground mr-1.5">{index + 1}.</span>
                      {step.title}
                    </span>
                    <span className="text-muted-foreground mt-0.5 block text-[0.8125rem] leading-snug">
                      {step.text}
                    </span>
                  </span>
                  <ArrowRightIcon
                    aria-hidden="true"
                    className="text-faint group-hover:text-foreground mt-2.5 size-4 shrink-0 transition-[transform,color] duration-300 group-hover:translate-x-0.5"
                  />
                </Link>
              </StaggerItem>
            ))}
          </Stagger>
        </Panel>
      </div>
    </div>
  )
}
