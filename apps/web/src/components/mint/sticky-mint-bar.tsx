'use client'

import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { MinusIcon, PlusIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@cobweb/ui/components/button'
import { transition } from '@cobweb/ui/lib/motion'
import { formatNative } from '@/lib/demo/helpers'
import { MintButton } from './mint-action'
import { useMint } from './mint-context'

/**
 * On phones and tablets, the mint action follows the thumb: once the panel's own button scrolls
 * out of view, this bar holds the same button at the bottom of the screen.
 */
export function StickyMintBar() {
  const { phase, action, page, live, track, soldOut, minted, quantity, setQuantity, maxQuantity } = useMint()
  const reduce = useReducedMotion()
  const [panelVisible, setPanelVisible] = useState(true)

  // The panel draws its action anew when it changes shape (reading the chain, then loaded; refused has none), so
  // the bar observes the element on screen, once per shape.
  const shape = track.final ? 'refused' : live ? 'loaded' : 'reading'
  useEffect(() => {
    const target = document.querySelector('[data-mint-action]')
    if (!target) return
    const observer = new IntersectionObserver(([entry]) => setPanelVisible(!!entry?.isIntersecting), {
      rootMargin: '0px 0px -40px 0px',
    })
    observer.observe(target)
    return () => observer.disconnect()
  }, [shape])

  const show = !panelVisible && !soldOut && !track.final
  // The stepper lives in the bar too, so a collector never scrolls back up to change the quantity.
  const canPickQuantity = action.kind === 'mint' && maxQuantity > 1
  const symbol = page.chain.nativeSymbol
  const amount =
    action.kind === 'mint'
      ? formatNative(action.quote.totalWei, symbol)
      : phase
        ? phase.group.priceWei === '0'
          ? 'Free'
          : formatNative(phase.group.priceWei, symbol)
        : null

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={reduce ? false : { y: '100%' }}
          animate={{ y: 0 }}
          exit={reduce ? { opacity: 0 } : { y: '100%' }}
          transition={transition.base}
          className="fixed inset-x-0 bottom-0 z-40 border-t border-border-strong bg-card px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-overlay lg:hidden"
        >
          <div className="mx-auto flex max-w-xl items-center gap-4">
            <div className={canPickQuantity ? 'hidden min-w-0 shrink-0 sm:block' : 'min-w-0 shrink-0'}>
              <p className="truncate text-[0.8125rem] text-muted-foreground">
                {phase ? phase.group.name : page.name}
              </p>
              <p className="numeric text-base font-medium">
                {amount ??
                  (live
                    ? `${minted.toLocaleString('en-US')} / ${live.supply.max.toLocaleString('en-US')}`
                    : 'Reading the chain')}
              </p>
            </div>
            {canPickQuantity && (
              <div
                role="group"
                aria-label="Quantity"
                className="flex h-12 shrink-0 items-center rounded-md border border-border-strong bg-well"
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-11 rounded-r-none"
                  aria-label="One fewer"
                  disabled={quantity <= 1}
                  onClick={() => setQuantity(quantity - 1)}
                >
                  <MinusIcon aria-hidden="true" />
                </Button>
                <span className="numeric min-w-7 text-center text-base font-medium" aria-live="polite">
                  {quantity}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-11 rounded-l-none"
                  aria-label="One more"
                  disabled={quantity >= maxQuantity}
                  onClick={() => setQuantity(quantity + 1)}
                >
                  <PlusIcon aria-hidden="true" />
                </Button>
              </div>
            )}
            <MintButton size="default" className="h-12 min-w-0 flex-1 px-3 leading-tight whitespace-normal" />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
