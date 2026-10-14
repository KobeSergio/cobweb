import { concatHex, encodeAbiParameters, getContractAddress, keccak256, type Address, type Hex } from 'viem'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The constructor arguments of CobwebCollection (contracts/src/CobwebCollection.sol), as the deploy
 * screen prepares them: `BaseVariables`, the supply and price per launch group (index 0 the public
 * sale), the public per-wallet cap, the royalty in basis points (a uint96 on chain), the owner and
 * the royalty receiver.
 */
export type CollectionArgs = {
  name: string
  symbol: string
  payout: Address
  baseUri: string
  maxSupply: bigint
  groupSupplies: bigint[]
  groupPrices: bigint[]
  publicMaxPerWallet: bigint
  royaltyBps: number
  owner: Address
  royaltyReceiver: Address
}

/**
 * The CREATE2 salt a collection deploys with (docs/specs/2026-10-14-deploy.md, decision 5): the 16
 * bytes of its uuid, left-aligned in 32, as `onchainJobId` is for payments. With the factory at the
 * same address on every chain, the same creator and arguments predict the same address everywhere.
 */
export function collectionSalt(collectionId: string): Hex {
  if (!UUID.test(collectionId)) throw new Error('A collection id is a uuid.')
  return `0x${collectionId.replace(/-/g, '').toLowerCase()}${'0'.repeat(32)}`
}

/** The constructor's parameter list, in the contract's order. */
const CONSTRUCTOR_PARAMS = [
  {
    type: 'tuple',
    components: [
      { name: 'name', type: 'string' },
      { name: 'symbol', type: 'string' },
      { name: 'ownerPayoutAddress', type: 'address' },
      { name: 'initialBaseURI', type: 'string' },
      { name: 'maxSupply', type: 'uint256' },
    ],
  },
  { type: 'uint256[]' },
  { type: 'uint256[]' },
  { type: 'uint256' },
  { type: 'uint96' },
  { type: 'address' },
  { type: 'address' },
] as const

/** `abi.encode` of the constructor arguments: what `deployCollection` takes as `constructorArgs`. */
export function encodeCollectionArgs(args: CollectionArgs): Hex {
  return encodeAbiParameters(CONSTRUCTOR_PARAMS, [
    {
      name: args.name,
      symbol: args.symbol,
      ownerPayoutAddress: args.payout,
      initialBaseURI: args.baseUri,
      maxSupply: args.maxSupply,
    },
    args.groupSupplies,
    args.groupPrices,
    args.publicMaxPerWallet,
    BigInt(args.royaltyBps),
    args.owner,
    args.royaltyReceiver,
  ])
}

/**
 * The address `deployCollection` produces: CREATE2 from the factory with the salt the factory derives,
 * `keccak256(abi.encode(deployer, salt))`, over `creationCode ++ args` (CobwebFactory.sol,
 * `predictCollectionAddress` and `_salt`). Checksummed.
 */
export function predictCollectionAddress(input: {
  factory: Address
  deployer: Address
  salt: Hex
  creationCode: Hex
  args: Hex
}): Address {
  const finalSalt = keccak256(
    encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }], [input.deployer, input.salt]),
  )
  return getContractAddress({
    opcode: 'CREATE2',
    from: input.factory,
    salt: finalSalt,
    bytecodeHash: keccak256(concatHex([input.creationCode, input.args])),
  })
}
