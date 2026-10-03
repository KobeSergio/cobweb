'use client'

import { ExternalLinkIcon, Share2Icon } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { toast } from 'sonner'
import { Button } from '@cobweb/ui/components/button'
import { EASE_OUT } from '@cobweb/ui/lib/motion'
import { cn } from '@cobweb/ui/lib/utils'
import { explorerTxUrl } from '@/lib/demo/helpers'
import { useMint } from './mint-context'
import { TokenImage } from './token-image'

/**
 * The peak of the page: the minted tokens are revealed one after another, a curtain lifting off
 * each. Ids, the transaction, a share action, and "Mint more" when the wallet still has room.
 */
export function MintSuccess() {
  const { flow, data, previewFor, action, closeFlow } = useMint()
  const reduce = useReducedMotion()
  if (flow.step !== 'success') return null
  const chain = data.collection.chain
  const name = data.collection.name
  const ids = flow.tokenIds
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
                  <TokenImage layers={previewFor(id).layers} alt={`${name} #${id}`} eager />
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
            </motion.li>
          ))}
        </ul>
      </div>

      <motion.div
        initial={reduce ? false : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE_OUT, delay: reduce ? 0 : 0.5 + ids.length * 0.18 }}
      >
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[0.8125rem]">
          <a
            href={explorerTxUrl(chain, flow.hash)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            View transaction
            <ExternalLinkIcon aria-hidden="true" className="size-3.5" />
          </a>
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
