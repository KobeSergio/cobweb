// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice The one function of the delegate.xyz v2 registry that the collection uses.
interface IDelegateRegistry {
    /// @return True if `to` may act for `from` on `contract_`, by a contract-level or whole-wallet delegation.
    function checkDelegateForContract(address to, address from, address contract_, bytes32 rights)
        external
        view
        returns (bool);
}
