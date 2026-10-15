import type { Address } from 'viem'

// Written by hand from the pinned creator-token-standards (contracts/lib/creator-token-standards at 980a63b):
// src/utils/CreatorTokenTransferValidator.sol lines 809 to 828 (the level setter), 945 to 949 (the policy
// getter) and 179 (the event), the struct in src/utils/TransferPolicy.sol lines 25 to 32, and the address in
// src/utils/CreatorTokenBase.sol line 43. Foundry never compiles the validator, and scripts/copy-abi.ts copies
// only what contracts/out holds, so this file is not generated. Change it only with the pinned library
// (docs/specs/2026-10-15-airdrop-settings.md, section 5).

/** The transfer validator's three entries Settings uses: the level setter, the policy getter and its event. */
export const validatorAbi = [
  {
    type: 'function',
    name: 'setTransferSecurityLevelOfCollection',
    inputs: [
      { name: 'collection', type: 'address', internalType: 'address' },
      { name: 'level', type: 'uint8', internalType: 'uint8' },
      { name: 'disableAuthorizationMode', type: 'bool', internalType: 'bool' },
      { name: 'disableWildcardOperators', type: 'bool', internalType: 'bool' },
      { name: 'enableAccountFreezingMode', type: 'bool', internalType: 'bool' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getCollectionSecurityPolicy',
    inputs: [{ name: 'collection', type: 'address', internalType: 'address' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        internalType: 'struct CollectionSecurityPolicyV3',
        components: [
          { name: 'disableAuthorizationMode', type: 'bool', internalType: 'bool' },
          { name: 'authorizersCannotSetWildcardOperators', type: 'bool', internalType: 'bool' },
          { name: 'transferSecurityLevel', type: 'uint8', internalType: 'uint8' },
          { name: 'listId', type: 'uint120', internalType: 'uint120' },
          { name: 'enableAccountFreezingMode', type: 'bool', internalType: 'bool' },
          { name: 'tokenType', type: 'uint16', internalType: 'uint16' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'event',
    name: 'SetTransferSecurityLevel',
    inputs: [
      { name: 'collection', type: 'address', indexed: true, internalType: 'address' },
      { name: 'level', type: 'uint8', indexed: false, internalType: 'uint8' },
    ],
    anonymous: false,
  },
] as const

/**
 * Limit Break's default transfer validator: what `getTransferValidator()` answers until the owner sets one, the
 * same address on every chain (CreatorTokenBase's `DEFAULT_TRANSFER_VALIDATOR`).
 */
export const DEFAULT_TRANSFER_VALIDATOR: Address = '0x721C008fdff27BF06E7E123956E2Fe03B63342e3'
