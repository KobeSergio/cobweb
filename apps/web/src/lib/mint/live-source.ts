import type { Address } from 'viem'
import { pollState, pollWallet, type StatePoll, type WalletPoll } from './fresh-client'
import type { MintChain } from './mint-run'
import type { MintPageStatic } from './page-doc'
import { tokenArtOf, type TokenArt } from './token-art'

/**
 * Where the mint page reads and mints (docs/specs/2026-10-16-mint-page-live-data.md, decision 27): the state and
 * wallet polls, the chain the mint is checked, sent and confirmed on, and token art. The components see only
 * the source: the live one on the freshness server, wagmi and the IPFS gateway, or the sample one on `lib/demo`
 * (components/mint/sample-source.ts).
 */
export type MintSource = {
  pollState(): Promise<StatePoll>
  pollWallet(wallet: Address): Promise<WalletPoll>
  chain: MintChain
  tokenArt(baseUri: string, id: number): Promise<TokenArt | null>
}

/** The live source: polls the freshness server at `freshnessUrl`, mints through `chain`, reads art through the page's gateway. */
export function liveMintSource(
  page: MintPageStatic,
  deps: { freshnessUrl: string | undefined; chain: MintChain; fetchImpl?: typeof fetch },
): MintSource {
  const fetchImpl = deps.fetchImpl ?? fetch
  return {
    pollState: () => pollState(deps.freshnessUrl, page.chain.id, page.contract, fetchImpl),
    pollWallet: (wallet) => pollWallet(deps.freshnessUrl, page.chain.id, page.contract, wallet, fetchImpl),
    chain: deps.chain,
    tokenArt: (baseUri, id) => tokenArtOf(baseUri, id, page.gateway, fetchImpl),
  }
}
