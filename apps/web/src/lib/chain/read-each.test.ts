import {
  BaseError,
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  erc721Abi,
  multicall3Abi,
  type Address,
  type ContractFunctionParameters,
  type PublicClient,
} from 'viem'
import { describe, expect, it } from 'vitest'
import { readEach } from './read-each'

const CONTRACT: Address = '0x0409454C375c8a6aB05383bFB6D9FcDe9ebB8F85'
const MULTICALL3: Address = '0xcA11bde05977b3631167028862bE2a173976CA11'
const BLOCK = 120n

const call = (id: number): ContractFunctionParameters => ({
  address: CONTRACT,
  abi: erc721Abi,
  functionName: 'ownerOf',
  args: [BigInt(id)],
})
const calls = (count: number) => Array.from({ length: count }, (_, id) => call(id))
const idOf = (parameters: { args?: readonly unknown[] }) => Number(parameters.args?.[0])
/** The ids the fakes revert: every seventh, from 3. */
const reverts = (id: number) => id % 7 === 3

/** A revert as viem reports it for one call. */
const reverted = (id: number) =>
  new ContractFunctionExecutionError(
    new ContractFunctionRevertedError({ abi: erc721Abi, functionName: 'ownerOf' }),
    {
      abi: erc721Abi,
      args: [BigInt(id)],
      contractAddress: CONTRACT,
      functionName: 'ownerOf',
    },
  )
/** A request that never reached the node: the multicall as a whole, or one call. */
const unreachable = (whole: boolean) =>
  whole
    ? new ContractFunctionExecutionError(new BaseError('fetch failed'), {
        abi: multicall3Abi,
        args: [[]],
        contractAddress: MULTICALL3,
        functionName: 'aggregate3',
      })
    : new ContractFunctionExecutionError(new BaseError('fetch failed'), {
        abi: erc721Abi,
        args: [60n],
        contractAddress: CONTRACT,
        functionName: 'ownerOf',
      })

type Answer = { status: 'success'; result: number } | { status: 'failure'; error: Error; result: undefined }

/** A chain with multicall3: each multicall answers id * 2, or a revert for the ids `reverts` names. */
function multicallClient(answer?: (contracts: readonly ContractFunctionParameters[]) => Answer[]) {
  const groups: number[] = []
  const blocks: (bigint | undefined)[] = []
  const client = {
    chain: { contracts: { multicall3: { address: MULTICALL3 } } },
    multicall: async (parameters: {
      contracts: readonly ContractFunctionParameters[]
      allowFailure: boolean
      batchSize: number
      blockNumber?: bigint
    }) => {
      groups.push(parameters.contracts.length)
      blocks.push(parameters.blockNumber)
      expect(parameters.allowFailure).toBe(true)
      expect(parameters.batchSize).toBe(0)
      if (answer) return answer(parameters.contracts)
      return parameters.contracts.map((contract): Answer =>
        reverts(idOf(contract))
          ? { status: 'failure', error: reverted(idOf(contract)), result: undefined }
          : { status: 'success', result: idOf(contract) * 2 },
      )
    },
  } as unknown as PublicClient
  return { client, groups, blocks }
}

/** A chain without multicall3 (Anvil): each read waits a tick, so the reads in flight can be counted. */
function parallelClient(fail?: (id: number) => Error | null) {
  let inFlight = 0
  let most = 0
  const blocks: (bigint | undefined)[] = []
  const client = {
    chain: { contracts: {} },
    readContract: async (parameters: { args?: readonly unknown[]; blockNumber?: bigint }) => {
      inFlight++
      most = Math.max(most, inFlight)
      blocks.push(parameters.blockNumber)
      await new Promise((resolve) => setTimeout(resolve, 0))
      inFlight--
      const id = idOf(parameters)
      const error = fail?.(id) ?? (reverts(id) ? reverted(id) : null)
      if (error) throw error
      return id * 2
    },
  } as unknown as PublicClient
  return { client, most: () => most, blocks }
}

const expected = (count: number) => Array.from({ length: count }, (_, id) => (reverts(id) ? null : id * 2))

describe('readEach', () => {
  it('reads groups of 500 as one multicall each, in turn, a reverted read as null, at the block given', async () => {
    const { client, groups, blocks } = multicallClient()
    expect(await readEach<number>(client, calls(1_001), { blockNumber: BLOCK })).toEqual(expected(1_001))
    expect(groups).toEqual([500, 500, 1])
    expect(blocks).toEqual([BLOCK, BLOCK, BLOCK])
  })

  it('reads groups of 50 side by side without multicall3, a reverted read as null, at the block given', async () => {
    const { client, most, blocks } = parallelClient()
    expect(await readEach<number>(client, calls(120), { blockNumber: BLOCK })).toEqual(expected(120))
    expect(most()).toBe(50)
    expect(blocks.every((block) => block === BLOCK)).toBe(true)
  })

  it('answers nothing for no calls', async () => {
    expect(await readEach<number>(multicallClient().client, [])).toEqual([])
  })

  it('throws a request that failed as a whole, with multicall3 or without', async () => {
    const whole = unreachable(true)
    const failedMulticall = multicallClient((contracts) =>
      contracts.map((): Answer => ({ status: 'failure', error: whole, result: undefined })),
    )
    await expect(readEach<number>(failedMulticall.client, calls(3))).rejects.toBe(whole)
    const thrown = new Error('fetch failed')
    const throwing = multicallClient(() => {
      throw thrown
    })
    await expect(readEach<number>(throwing.client, calls(3))).rejects.toBe(thrown)
    const network = unreachable(false)
    const parallel = parallelClient((id) => (id === 60 ? network : null))
    await expect(readEach<number>(parallel.client, calls(120))).rejects.toBe(network)
  })
})
