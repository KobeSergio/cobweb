'use client'

import { useQuery } from '@tanstack/react-query'
import { ExternalLinkIcon, Share2Icon } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { toast } from 'sonner'
import type { Hex } from 'viem'
import { Button } from '@cobweb/ui/components/button'
import { EASE_OUT } from '@cobweb/ui/lib/motion'
import { cn } from '@cobweb/ui/lib/utils'
import { TierDot } from '@/components/art/generate/rarity'
import { rarityTier, TIER_RANGES } from '@/components/art/state/token-logic'
import { explorerTxUrl } from '@/lib/demo/helpers'
import { useMint } from './mint-context'
import { TokenArtFrame } from './token-image'
import { useTokenArt } from './use-token-art'

/** A minted token's rarity tier, its range as the title (docs/specs/2026-10-16-mint-page-live-data.md, section 7.7). */
function TierChip({ rank, total }: { rank: number; total: number }) {
  const tier = rarityTier(rank, total)
  return (
    <span
      title={`${TIER_RANGES[tier.key]} by rarity`}
      className="inline-flex h-6 items-center gap-1.5 rounded-full border bg-surface-2 px-2 text-xs font-medium"
    >
      <TierDot tier={tier.key} />
      {tier.label}
    </span>
  )
}

/**
 * The peak of the page: the minted tokens are revealed one after another, a curtain lifting off each, with their
 * rarity tier once the collection is revealed (or their number of the supply where every token shares its art).
 * Ids, the transaction, a share action, and "Mint more" when the wallet still has room.
 */
export function MintSuccess() {
  const { flow, page, live, source, action, closeFlow } = useMint()
  const reduce = useReducedMotion()
  const ids = flow.step === 'success' ? flow.tokenIds : []
  // Each minted token's art at the state's base URI: the placeholder's image before the reveal.
  const art = useTokenArt(source, live?.baseUri ?? null, ids)
  const generative = page.projectType === 'generative'
  const revealed = !!live?.revealed
  // Asked once per mint, for the first 20 ids; a failure shows nothing.
  const tiers = useQuery({
    queryKey: ['mint-tiers', flow.step === 'success' ? flow.hash : null],
    queryFn: () => source.tiers(live?.baseUri ?? '', ids.slice(0, 20)),
    enabled: flow.step === 'success' && generative && revealed && ids.length > 0,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  })
  if (flow.step !== 'success') return null
  if (ids.length === 0) return <NoTokens hash={flow.hash} />
  const supply = live?.supply.max ?? 0
  const chain = page.chain
  const name = page.name
  const canMintMore = action.kind === 'mint'

  const share = async () => {
    const url = window.location.href.split('?')[0]!
    const text = `I just minted ${ids.map((id) => `${name} #${id}`).join(', ')}.`
    try {
      if (navigator.share) {
        await navigator.share({ title: name, text, url })
        return
      }
      await navigator.clipboard.writeText(`${text} ${url}`)
      toast.success('Link copied.')
    } catch {
      // The share sheet was dismissed; nothing to report.
    }
  }

  return (
    <div className="mt-6">
      <div className="spotlight -mx-2 rounded-xl bg-well/60 px-5 pt-6 pb-4 shadow-inset">
        <ul
          className={cn(
            'mx-auto grid gap-3',
            ids.length === 1 && 'max-w-[15rem] grid-cols-1',
            ids.length === 2 && 'max-w-[26rem] grid-cols-2',
            ids.length >= 3 && 'grid-cols-3',
          )}
        >
          {ids.map((id, index) => (
            <motion.li
              key={id}
              initial={reduce ? false : { opacity: 0, y: 18, scale: 0.94 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.7, ease: EASE_OUT, delay: reduce ? 0 : 0.1 + index * 0.18 }}
            >
              <div className="relative overflow-hidden rounded-xl border border-border-strong shadow-lifted">
                <motion.div
                  initial={reduce ? false : { scale: 1.12 }}
                  animate={{ scale: 1 }}
                  transition={{ duration: 1.4, ease: EASE_OUT, delay: reduce ? 0 : 0.35 + index * 0.18 }}
                >
                  <TokenArtFrame art={art.get(id)} id={id} alt={`${name} #${id}`} eager />
                </motion.div>
                {!reduce && (
                  <motion.span
                    aria-hidden="true"
                    className="absolute inset-0 bg-surface-3"
                    initial={{ y: '0%' }}
                    animate={{ y: '-101%' }}
                    transition={{ duration: 0.9, ease: EASE_OUT, delay: 0.3 + index * 0.18 }}
                  />
                )}
              </div>
              <p className="mt-2 text-center text-[0.8125rem]">
                <span className="text-muted-foreground">{name} </span>
                <span className="numeric font-medium">#{id}</span>
              </p>
              {generative && tiers.data?.ranks[id] !== undefined && (
                <p className="mt-1.5 flex justify-center">
                  <TierChip rank={tiers.data.ranks[id]} total={tiers.data.total} />
                </p>
              )}
              {!generative && supply > 0 && (
                <p className="numeric mt-1 text-center text-xs text-muted-foreground">
                  #{id} of {supply.toLocaleString('en-US')}
                </p>
              )}
            </motion.li>
          ))}
        </ul>
        {generative && !revealed && (
          <p className="mt-4 text-center text-[0.8125rem] text-muted-foreground">
            Rarity shows after the reveal
          </p>
        )}
      </div>

      <motion.div
        initial={reduce ? false : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE_OUT, delay: reduce ? 0 : 0.5 + ids.length * 0.18 }}
      >
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[0.8125rem]">
          {chain.explorerUrl && (
            <a
              href={explorerTxUrl(chain, flow.hash)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              View transaction
              <ExternalLinkIcon aria-hidden="true" className="size-3.5" />
            </a>
          )}
          <button
            type="button"
            onClick={share}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-sm text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Share2Icon aria-hidden="true" className="size-3.5" />
            Share
          </button>
        </div>
        <div className={cn('mt-6 grid gap-2.5', canMintMore && 'sm:grid-cols-2')}>
          {canMintMore && <Button onClick={closeFlow}>Mint more</Button>}
          <Button variant={canMintMore ? 'secondary' : 'default'} onClick={closeFlow}>
            Done
          </Button>
        </div>
      </motion.div>
    </div>
  )
}

/**
 * A mint the wallet replaced with a transaction that minted nothing to it, such as a cancel: the transaction that
 * landed, and Done. The failure dialog does not open for it (lib/mint/mint-run.ts).
 */
function NoTokens({ hash }: { hash: Hex }) {
  const { page, closeFlow } = useMint()
  return (
    <div className="mt-6 grid gap-4">
      {page.chain.explorerUrl && (
        <a
          href={explorerTxUrl(page.chain, hash)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center justify-center gap-1.5 text-[0.8125rem] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          View transaction
          <ExternalLinkIcon aria-hidden="true" className="size-3.5" />
        </a>
      )}
      <Button onClick={closeFlow}>Done</Button>
    </div>
  )
}
