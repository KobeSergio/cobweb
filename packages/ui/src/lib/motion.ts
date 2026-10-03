import type { Transition, Variants } from 'motion/react'

/*
 * Motion presets. Motion in Cobweb is small and motivated: a state changed, an action landed, a
 * list arrived. Animate transform and opacity only. Components that use these must also respect
 * reduced motion (the Motion components in components/motion.tsx do).
 */

/** The house curve: fast out, long settle. */
export const EASE_OUT = [0.16, 1, 0.3, 1] as const

export const DURATION = {
  /** Hover, press, toggles. */
  fast: 0.15,
  /** Entries, state changes. */
  base: 0.3,
  /** A panel or list arriving. */
  slow: 0.5,
} as const

export const transition = {
  base: { duration: DURATION.base, ease: EASE_OUT } satisfies Transition,
  slow: { duration: DURATION.slow, ease: EASE_OUT } satisfies Transition,
  /** For things that move with the pointer or swap places (drag, reorder). */
  spring: { type: 'spring', stiffness: 420, damping: 34, mass: 0.8 } satisfies Transition,
}

/** Rise in by 8px and fade. The default entry for a card or a row. */
export const riseIn: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: transition.slow },
}

/** Parent of a list whose children use `riseIn`. Children arrive 50ms apart. */
export const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05, delayChildren: 0.04 } },
}
