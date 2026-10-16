import type { Socials } from '@/lib/demo/types'

/**
 * The mint page's link rules (docs/specs/2026-10-16-mint-page-live-data.md, section 4.1), pure and shared: the
 * save's schemas check with them (settings-core.ts for the page's links, page-doc.ts for a team member's), and the
 * Mint page tab's draft flags what they refuse, so the tab never offers a link the save refuses. No pattern has the
 * `g` flag, so `test` keeps no state between calls.
 */

/** Longest page link a save takes, as in legacy. */
export const PAGE_LINK_MAX = 200

/** Each page link: https, on the hosts the database's checks name, with a path after the host. */
export const PAGE_LINK_PATTERNS: Record<keyof Socials, RegExp> = {
  website: /^https:\/\/\S+$/,
  x: /^https:\/\/(www\.)?(x|twitter)\.com\/\S+$/,
  discord: /^https:\/\/(www\.)?discord\.(gg|com)\/\S+$/,
  telegram: /^https:\/\/(www\.)?(t|telegram)\.me\/\S+$/,
}

/** Longest team member link a save takes. */
export const MEMBER_LINK_MAX = 40

/** A team member's link: https, with no spaces. */
export const MEMBER_LINK_PATTERN = /^https:\/\/\S+$/
