import { availableChains, chainById, readEach, revertedRead } from '@cobweb/shared'
import { publicClientFor } from '@cobweb/shared/server'
import { erc721Abi, parseAbi, type Address, type PublicClient } from 'viem'
import { errorSummary } from '@/lib/art/lock-core'
import {
  NO_HOLDERS,
  NO_TOTAL_SUPPLY,
  NOT_A_CONTRACT,
  NOT_ERC721,
  SNAPSHOT_CHAIN,
  SNAPSHOT_FAILED,
  SNAPSHOT_TOO_LARGE,
} from '@/lib/art/result'
import { holdersOf, SNAPSHOT_MAX_SUPPLY, snapshotIds, type HolderSnapshot } from './holders'

/**
 * The holder snapshot on the server (docs/specs/2026-10-15-whitelist.md, section 6.4): another collection's
 * holders read at one block over the server's RPC for the chain, for Whitelist and Airdrop alike. No indexer:
 * `totalSupply()`, then `ownerOf` for every id. No `server-only` marker, so verify:whitelist can import it; the
 * browser never does (the RPC URLs are secrets).
 */

/** viem's `erc721Abi` has no `supportsInterface`, so ERC-165 has its own one-function ABI. */
const erc165Abi = parseAbi(['function supportsInterface(bytes4 interfaceId) view returns (bool)'])
/** ERC-721's interface id. */
const ERC721_INTERFACE = '0x80ac58cd'

/** The chains a snapshot can read: the available chains whose `RPC_URL_<id>` is set. */
export function snapshotChains(): number[] {
  return availableChains()
    .filter((chain) => Boolean(process.env[chain.rpcEnv]))
    .map((chain) => chain.id)
}

/** Whether the contract says it is an ERC-721; a contract without ERC-165 reverts, which reads as no. */
async function isErc721(client: PublicClient, contract: Address, blockNumber: bigint): Promise<boolean> {
  try {
    return await client.readContract({
      address: contract,
      abi: erc165Abi,
      functionName: 'supportsInterface',
      args: [ERC721_INTERFACE],
      blockNumber,
    })
  } catch (error) {
    if (revertedRead(error)) return false
    throw error
  }
}

/** `totalSupply()`, or null when the contract does not answer it. */
async function totalSupplyOf(
  client: PublicClient,
  contract: Address,
  blockNumber: bigint,
): Promise<bigint | null> {
  try {
    return await client.readContract({
      address: contract,
      abi: erc721Abi,
      functionName: 'totalSupply',
      blockNumber,
    })
  } catch (error) {
    if (revertedRead(error)) return null
    throw error
  }
}

/**
 * The holders of an ERC-721 contract at the latest block: SNAPSHOT_CHAIN for a chain Cobweb cannot read,
 * NOT_A_CONTRACT for an address without code, NOT_ERC721 when ERC-165 says no or is missing, NO_TOTAL_SUPPLY,
 * SNAPSHOT_TOO_LARGE above 20,000 tokens, NO_HOLDERS when no owner is left. A read that throws is logged and
 * answers SNAPSHOT_FAILED.
 */
export async function fetchHoldersCore(
  chainId: number,
  contract: Address,
): Promise<{ data: HolderSnapshot } | { refused: string }> {
  const chain = chainById(chainId)
  if (!chain || !snapshotChains().includes(chainId)) return { refused: SNAPSHOT_CHAIN }
  try {
    const client = publicClientFor(chainId)
    // cacheTime 0: one pinned block, read now, so every read below agrees.
    const blockNumber = await client.getBlockNumber({ cacheTime: 0 })
    const code = await client.getCode({ address: contract, blockNumber })
    if (!code || code === '0x') return { refused: NOT_A_CONTRACT(chain.name) }
    if (!(await isErc721(client, contract, blockNumber))) return { refused: NOT_ERC721(chain.name) }
    const supply = await totalSupplyOf(client, contract, blockNumber)
    if (supply === null) return { refused: NO_TOTAL_SUPPLY }
    if (supply > BigInt(SNAPSHOT_MAX_SUPPLY)) return { refused: SNAPSHOT_TOO_LARGE }
    const owners = await readEach<Address>(
      client,
      snapshotIds(supply).map((id) => ({
        address: contract,
        abi: erc721Abi,
        functionName: 'ownerOf',
        args: [id],
      })),
      { blockNumber },
    )
    const holders = holdersOf(owners)
    if (holders.length === 0) return { refused: NO_HOLDERS }
    return { data: { holders, block: Number(blockNumber), supply: Number(supply) } }
  } catch (error) {
    console.error(`The holders of ${contract} could not be read on chain ${chainId}: ${errorSummary(error)}`)
    return { refused: SNAPSHOT_FAILED }
  }
}
