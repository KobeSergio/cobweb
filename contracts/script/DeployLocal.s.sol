// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {CobwebFactory} from "../src/CobwebFactory.sol";
import {CobwebCollection} from "../src/CobwebCollection.sol";

/**
 * @notice Deploys the factory to a local Anvil chain for development, verify:chain and the browser walk.
 * @dev The broadcasting account (Anvil's first account, unlocked) is admin and treasury. The art fee
 *      stands in for $0.11 per token. the web app's chain:local script (pnpm --filter web chain:local) runs:
 *      forge script script/DeployLocal.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --unlocked --sender <first account>
 */
contract DeployLocal is Script {
    uint256 internal constant ART_FEE_PER_TOKEN = 25_000_000_000_000;

    function run() external returns (CobwebFactory factory) {
        require(block.chainid == 31337, "DeployLocal runs on Anvil (31337) only");
        vm.startBroadcast();
        (VmSafe.CallerMode mode, address deployer,) = vm.readCallers();
        require(mode == VmSafe.CallerMode.RecurrentBroadcast, "Run with --broadcast");
        factory = new CobwebFactory(deployer, deployer);
        factory.approveCreationCode(keccak256(type(CobwebCollection).creationCode));
        factory.setArtFeePerToken(ART_FEE_PER_TOKEN);
        vm.stopBroadcast();
        console2.log("CobwebFactory:", address(factory));
    }
}
