// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice The parts of the factory a collection reads.
interface ICobwebFactory {
    /// @notice Platform fees a new collection copies into its own storage when it is deployed.
    function collectionFees()
        external
        view
        returns (uint256 mintFeeFlat, uint256 mintFeeBps, uint256 airdropFeePerToken);

    /// @notice Where platform fees are sent. Read at withdrawal time, so it can be rotated.
    function treasury() external view returns (address);

    /// @notice Whether an address is a platform admin.
    function isAdmin(address account) external view returns (bool);
}
