'use client'

import * as React from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { riseIn, stagger } from '@cobweb/ui/lib/motion'

/**
 * A list whose items rise in one after another when it first renders. With reduced motion the
 * items simply appear. Use it for a grid of cards or a list of rows, once per screen.
 *
 *   <Stagger className="grid grid-cols-3 gap-4">
 *     {items.map((item) => <StaggerItem key={item.id}>...</StaggerItem>)}
 *   </Stagger>
 */
function Stagger({ className, children, ...props }: React.ComponentProps<typeof motion.div>) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      className={className}
      variants={stagger}
      initial={reduce ? false : 'hidden'}
      animate="show"
      {...props}
    >
      {children}
    </motion.div>
  )
}

function StaggerItem({ className, children, ...props }: React.ComponentProps<typeof motion.div>) {
  return (
    <motion.div className={className} variants={riseIn} {...props}>
      {children}
    </motion.div>
  )
}

/** One block that rises in on first render. For a single panel; for lists use Stagger. */
function RiseIn({
  className,
  children,
  delay = 0,
  ...props
}: React.ComponentProps<typeof motion.div> & { delay?: number }) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay }}
      {...props}
    >
      {children}
    </motion.div>
  )
}

export { Stagger, StaggerItem, RiseIn }
