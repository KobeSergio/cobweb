/**
 * What a collection's base URI points at (docs/specs/2026-10-16-freshness-server.md, section 5.1), shared by
 * Settings, the Overview and the mint page. Pure.
 */

/** What the base URI points at: the rendered metadata, the placeholder, or a link set some other way. */
export type RevealPointer = 'revealed' | 'placeholder' | 'custom'

/**
 * The base URIs Reveal offers: the latest done real job's, the latest done placeholder job's, and the
 * deploy-time one.
 */
export type RevealTargets = { real: string | null; placeholder: string | null; start: string }

/**
 * What the base URI points at, compared exactly: the real job's (checked first, so a collection deployed on
 * its real job reads revealed), the placeholder job's or the deploy-time one, else a custom link.
 */
export function pointerOf(baseUri: string, targets: RevealTargets): RevealPointer {
  if (targets.real !== null && baseUri === targets.real) return 'revealed'
  if (baseUri === targets.placeholder || baseUri === targets.start) return 'placeholder'
  return 'custom'
}
