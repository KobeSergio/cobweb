import type { Address } from 'viem'

// Written by hand from the delegate.xyz v2 registry's published source
// (github.com/delegatexyz/delegate-registry, src/IDelegateRegistry.sol, `@custom:version 2.0`): the
// `Delegation` struct, its `DelegationType` enum (NONE, ALL, CONTRACT, ERC721, ERC20, ERC1155) encoded as
// uint8, and `getIncomingDelegations(address)`. Confirmed on 16 October 2026 with the two rules of its
// implementation the freshness server relies on: getIncomingDelegations leaves out revoked delegations, and
// checkDelegateForContract(to, from, contract_, "") accepts only an ALL or a CONTRACT delegation with empty
// rights. The address is the one the collection holds (contracts/src/CobwebCollection.sol, line 119) and the
// one the registry's README lists for its EVM chains. Change it only with the registry
// (docs/specs/2026-10-16-freshness-server.md, section 5.3).

/** The delegate.xyz v2 registry: the same address on every EVM chain it is deployed to. */
export const DELEGATE_REGISTRY: Address = '0x00000000000000447e69651d841bD8D104Bed493'

/** The registry's `DelegationType`, as the uint8 it encodes. */
export const DELEGATION_TYPE = { none: 0, all: 1, contract: 2, erc721: 3, erc20: 4, erc1155: 5 } as const

/** The one entry the freshness server reads: a wallet's incoming delegations, the revoked ones left out. */
export const delegateRegistryAbi = [
  {
    type: 'function',
    name: 'getIncomingDelegations',
    inputs: [{ name: 'to', type: 'address', internalType: 'address' }],
    outputs: [
      {
        name: 'delegations',
        type: 'tuple[]',
        internalType: 'struct IDelegateRegistry.Delegation[]',
        components: [
          { name: 'type_', type: 'uint8', internalType: 'enum IDelegateRegistry.DelegationType' },
          { name: 'to', type: 'address', internalType: 'address' },
          { name: 'from', type: 'address', internalType: 'address' },
          { name: 'rights', type: 'bytes32', internalType: 'bytes32' },
          { name: 'contract_', type: 'address', internalType: 'address' },
          { name: 'tokenId', type: 'uint256', internalType: 'uint256' },
          { name: 'amount', type: 'uint256', internalType: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
] as const
