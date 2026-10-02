// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {CobwebFactory} from "../src/CobwebFactory.sol";
import {CobwebCollection} from "../src/CobwebCollection.sol";

/**
 * @notice Deploys the factory for one chain and, when the deployer is the admin, approves the
 *         collection's creation code.
 * @dev The factory is created with a fixed salt through the deterministic deployment proxy, so the
 *      same admin and treasury give the same factory address on every chain.
 *      Usage: forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast --verify
 */
contract Deploy is Script {
    bytes32 internal constant FACTORY_SALT = keccak256("cobweb.factory.v1");

    function run() external returns (CobwebFactory factory) {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address admin = vm.envAddress("FACTORY_ADMIN");
        address treasury = vm.envAddress("FACTORY_TREASURY");
        bytes32 collectionCodeHash = keccak256(type(CobwebCollection).creationCode);

        vm.startBroadcast(deployerKey);
        factory = new CobwebFactory{salt: FACTORY_SALT}(admin, treasury);
        if (vm.addr(deployerKey) == admin) {
            factory.approveCreationCode(collectionCodeHash);
        }
        vm.stopBroadcast();

        console2.log("CobwebFactory:", address(factory));
        console2.log("Collection creation code hash:");
        console2.logBytes32(collectionCodeHash);
        if (vm.addr(deployerKey) != admin) {
            console2.log("Deployer is not the admin. The admin must call approveCreationCode with the hash above.");
        }
        console2.log("Next: the admin sets fees with setCollectionFees and setArtFeePerToken.");
    }
}
