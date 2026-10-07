/**
 * Why a start time needs a warning, judged against the chain's clock, never the browser's. Null
 * when the time is fine. A past time is allowed (the phase opens as soon as the transaction
 * confirms), so this warns rather than refuses.
 */
export function scheduleWarning(startUnix: number | null, blockTimestamp: number): string | null {
  if (startUnix === null) return null
  if (startUnix <= blockTimestamp)
    return 'This time has already passed on chain, so the phase opens as soon as the transaction confirms.'
  return null
}
