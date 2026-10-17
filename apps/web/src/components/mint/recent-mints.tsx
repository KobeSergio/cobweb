'use client'

import { explorerTxUrl, shortAddress } from '@/lib/demo/helpers'
import { formatDistance } from './format'
import { useMint } from './mint-context'

/**
 * The latest mints, under the phases (docs/specs/2026-10-16-indexer-overview.md, section 7.5): each one's receiver,
 * count and phase, and its time on the chain clock, each row a link to its transaction on the chain's explorer
 * (plain text without one). Left out while the indexer's activity is null or holds no mint. No time shows
 * until the chain clock has its first body; on a narrow screen the sentence wraps beside the time, so the
 * phase stays in view.
 */
export function RecentMints() {
  const { page, live, chainNow } = useMint()
  const mints = live?.activity?.recentMints ?? []
  if (mints.length === 0) return null
  const chain = page.chain
  return (
    <section aria-labelledby="recent-mints-title" className="mt-10">
      <h2 id="recent-mints-title" className="text-heading">
        Recent mints
      </h2>
      <ol className="mt-4 divide-y rounded-xl border bg-card shadow-raised">
        {mints.map((mint) => {
          const what = (
            <>
              <span className="numeric">{shortAddress(mint.recipient)}</span> minted {mint.amount}
              {mint.phase && ` in ${mint.phase}`}
            </>
          )
          return (
            <li
              key={`${mint.txHash}:${mint.firstTokenId}`}
              className="flex items-baseline justify-between gap-3 px-4 py-3 text-sm"
            >
              {chain.explorerUrl ? (
                <a
                  href={explorerTxUrl(chain, mint.txHash)}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 underline-offset-4 hover:underline"
                >
                  {what}
                  <span className="sr-only">, view transaction</span>
                </a>
              ) : (
                <span className="min-w-0">{what}</span>
              )}
              {chainNow !== null && (
                <span className="shrink-0 text-[0.8125rem] text-muted-foreground">
                  {formatDistance(chainNow - mint.blockTimestamp)} ago
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
