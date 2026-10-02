// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {BaseTest} from "./utils/BaseTest.sol";
import {CobwebFactory} from "../src/CobwebFactory.sol";
import {CobwebCollection} from "../src/CobwebCollection.sol";

/// @dev Drives a collection with random mints, airdrops, withdrawals, fee changes and group edits.
contract Handler is Test {
    uint256 internal constant PUBLIC = 0;
    uint256 internal constant ALLOWLIST = 1;

    CobwebCollection internal immutable collection;
    address internal immutable admin;
    address internal immutable creator;
    address[] internal actors;

    uint256 public airdropped;

    constructor(CobwebCollection collection_, address admin_, address creator_) {
        collection = collection_;
        admin = admin_;
        creator = creator_;
        for (uint256 i = 0; i < 5; i++) {
            address actor = makeAddr(string(abi.encodePacked("actor", i)));
            actors.push(actor);
            vm.deal(actor, 1_000_000 ether);
        }
        vm.deal(creator, 1_000_000 ether);
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function mintPublic(uint256 actorSeed, uint256 amount) external {
        amount = bound(amount, 1, 10);
        (uint256 cost,) = collection.quoteBatchMint(PUBLIC, amount);
        vm.prank(_actor(actorSeed));
        try collection.batchMint{value: cost + 1}(amount, PUBLIC) {} catch {}
    }

    function mintAllowlist(uint256 actorSeed, uint256 amount, uint256 quota) external {
        address actor = _actor(actorSeed);
        amount = bound(amount, 1, 10);
        address[] memory addrs = new address[](1);
        addrs[0] = actor;
        uint256[] memory quotas = new uint256[](1);
        quotas[0] = bound(quota, 0, 20);
        vm.prank(creator);
        collection.setMintQuota(addrs, ALLOWLIST, quotas);

        (uint256 cost,) = collection.quoteBatchMint(ALLOWLIST, amount);
        vm.prank(actor);
        try collection.batchMint{value: cost}(amount, ALLOWLIST) {} catch {}
    }

    function airdrop(uint256 actorSeed, uint256 amount) external {
        amount = bound(amount, 1, 10);
        address[] memory to = new address[](1);
        to[0] = _actor(actorSeed);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = amount;
        (,, uint256 fee) = collection.fees();
        vm.prank(creator);
        try collection.airdropNFTs{value: fee * amount}(to, amounts) {
            airdropped += amount;
        } catch {}
    }

    function withdrawCreator() external {
        vm.prank(creator);
        try collection.withdrawMintFunds() {} catch {}
    }

    function withdrawPlatform() external {
        try collection.withdrawPlatformFees() {} catch {}
    }

    function setFees(uint256 flat, uint256 bps, uint256 airdropFee) external {
        vm.prank(admin);
        collection.setFees(bound(flat, 0, 1 ether), bound(bps, 0, 10_000), bound(airdropFee, 0, 1 ether));
    }

    function setPrice(uint256 group, uint256 price) external {
        vm.prank(creator);
        collection.changeSalePrice(bound(price, 0, 10 ether), group % 2);
    }

    function setStatus(uint256 group, bool status) external {
        vm.prank(creator);
        collection.setMintGroupStatus(group % 2, status);
    }

    function setGroupSupply(uint256 group, uint256 supply) external {
        vm.prank(creator);
        try collection.setMintGroupMaxSupply(group % 2, bound(supply, 0, 1_000)) {} catch {}
    }

    function setPayoutAddress(uint256 actorSeed) external {
        vm.prank(creator);
        collection.setOwnerPayoutAddress(_actor(actorSeed));
    }

    function setPublicCap(uint256 cap) external {
        vm.prank(creator);
        collection.setPublicMaxMintPerWallet(bound(cap, 0, 50));
    }
}

contract InvariantsTest is BaseTest {
    Handler internal handler;

    function setUp() public override {
        super.setUp();
        vm.prank(creator);
        collection.stopOrStartAllMintGroups(true);
        handler = new Handler(collection, admin, creator);
        targetContract(address(handler));
    }

    /// @dev Every wei the collection holds is owed to the creator or the platform, and nothing more
    ///      is owed than it holds. The handler's actors are plain accounts, so no refund is ever
    ///      credited to a pending balance.
    function invariant_balanceEqualsWhatIsOwed() public view {
        assertEq(address(collection).balance, collection.creatorBalance() + collection.platformBalance());
    }

    function invariant_supplyNeverExceedsMax() public view {
        assertLe(collection.totalMinted(), collection.maxSupply());
    }

    function invariant_groupMintsNeverExceedAllocation() public view {
        assertLe(collection.mintGroupMints(PUBLIC), collection.mintGroupMaxSupply(PUBLIC));
        assertLe(collection.mintGroupMints(ALLOWLIST), collection.mintGroupMaxSupply(ALLOWLIST));
    }

    function invariant_allocationsFitInCollection() public view {
        assertLe(
            collection.mintGroupMaxSupply(PUBLIC) + collection.mintGroupMaxSupply(ALLOWLIST), collection.maxSupply()
        );
    }

    function invariant_everyTokenCameFromAGroupOrAnAirdrop() public view {
        assertEq(
            collection.totalMinted(),
            collection.mintGroupMints(PUBLIC) + collection.mintGroupMints(ALLOWLIST) + handler.airdropped()
        );
    }
}
