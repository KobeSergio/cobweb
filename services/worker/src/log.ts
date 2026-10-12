/** One log line: an event name and a few plain fields. Never an error object, never a secret. */
export type Log = (event: string, fields?: Record<string, string | number | boolean | null>) => void

const URL_LIKE = /[a-z][a-z0-9+.-]*:\/\/\S+/gi
/** A long run of key characters, hyphen included so base64url secrets and `sb_secret_` keys go whole. */
const KEY_LIKE = /[A-Za-z0-9_+/=.-]{32,}/g
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** A CID is public and needed to debug a mismatch. */
const CID = /^baf[a-z2-7]{56,}$/
const mask = (run: string): string => (UUID.test(run) || CID.test(run) ? run : '[key]')

/**
 * An error as a log field: its name and a short message. viem and AWS errors can carry an RPC or
 * endpoint URL with a key in it, so viem's `shortMessage` is preferred, only the first line is kept,
 * a URL is replaced by `[url]` and a key (a run of 32 or more key characters, other than a uuid or a CID) by `[key]`, and the text
 * is cut at 200 characters.
 */
export function errorSummary(error: unknown): string {
  if (!(error instanceof Error)) return 'Unknown error'
  const short = (error as { shortMessage?: unknown }).shortMessage
  const text = (typeof short === 'string' ? short : error.message).split('\n')[0] ?? ''
  return `${error.name}: ${text.replace(URL_LIKE, '[url]').replace(KEY_LIKE, mask).slice(0, 200)}`
}

/** Writes each line as one JSON object, which CloudWatch indexes by field. */
export const consoleLog: Log = (event, fields = {}) => {
  console.log(JSON.stringify({ event, ...fields }))
}
