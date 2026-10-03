'use client'

import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useState } from 'react'
import { transition } from '@cobweb/ui/lib/motion'
import { formatNative } from '@/lib/demo/helpers'
import { MintButton } from './mint-action'
import { useMint } from './mint-context'

/**
 * On phones and tablets, the mint action follows the thumb: once the panel's own button scrolls
 * out of view, this bar holds the same button at the bottom of the screen.
 */
export function StickyMintBar() {
  const { phase, action, data, soldOut, minted } = useMint()
  const reduce = useReducedMotion()
  const [panelVisible, setPanelVisible] = useState(true)

  useEffect(() => {
    const target = document.querySelector('[data-mint-action]')
    if (!target) return
    const observer = new IntersectionObserver(([entry]) => setPanelVisible(!!entry?.isIntersecting), {
      rootMargin: '0px 0px -40px 0px',
    })
    observer.observe(target)
    return () => observer.disconnect()
  }, [])

  const show = !panelVisible && !soldOut
  const symbol = data.collection.chain.nativeSymbol
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
            <div className="min-w-0 shrink-0">
              <p className="truncate text-[0.8125rem] text-muted-foreground">
                {phase ? phase.group.name : data.collection.name}
              </p>
              <p className="numeric text-base font-medium">
                {amount ?? `${minted.toLocaleString('en-US')} / ${data.supply.max.toLocaleString('en-US')}`}
              </p>
            </div>
            <MintButton size="default" className="h-12 min-w-0 flex-1 px-3 leading-tight whitespace-normal" />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
