// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {BaseTest} from "./utils/BaseTest.sol";
import {CobwebFactory} from "../src/CobwebFactory.sol";
import {CobwebCollection} from "../src/CobwebCollection.sol";

contract CobwebFactoryTest is BaseTest {
    bytes internal code = type(CobwebCollection).creationCode;

    function test_constructor_setsAdminAndTreasury() public view {
        assertTrue(factory.isAdmin(admin));
        assertFalse(factory.isAdmin(alice));
        assertEq(factory.treasury(), treasury);
    }

    function test_constructor_revertsOnZeroAddress() public {
        vm.expectRevert(CobwebFactory.ZeroAddress.selector);
        new CobwebFactory(address(0), treasury);
        vm.expectRevert(CobwebFactory.ZeroAddress.selector);
        new CobwebFactory(admin, address(0));
    }

    /*//////////////////////////////////////////////////////////////
                              DEPLOYMENT
    //////////////////////////////////////////////////////////////*/
    function test_deploy_recordsCollectionAndSetsOwner() public view {
        assertTrue(factory.isCollection(address(collection)));
        assertEq(collection.owner(), creator);
        assertEq(collection.factory(), address(factory));
    }

    function test_deploy_isOpenToAnyone() public {
        vm.prank(alice);
        address deployed = factory.deployCollection(code, _constructorArgs(alice, "Alice"), bytes32(0));
        assertEq(CobwebCollection(deployed).owner(), alice);
    }

    function test_deploy_revertsForUnapprovedCode() public {
        bytes memory other = hex"6080604052";
        vm.expectRevert(abi.encodeWithSelector(CobwebFactory.CreationCodeNotApproved.selector, keccak256(other)));
        factory.deployCollection(other, "", bytes32(0));
    }

    function test_deploy_revertsAfterCodeRemoved() public {
        vm.prank(admin);
        factory.removeCreationCode(keccak256(code));
        vm.expectRevert(abi.encodeWithSelector(CobwebFactory.CreationCodeNotApproved.selector, keccak256(code)));
        factory.deployCollection(code, _constructorArgs(alice, "Alice"), bytes32(0));
    }

    function test_deploy_addressMatchesPrediction() public {
        bytes memory args = _constructorArgs(alice, "Alice");
        bytes32 salt = keccak256("salt");
        address predicted = factory.predictCollectionAddress(alice, code, args, salt);
        vm.prank(alice);
        address deployed = factory.deployCollection(code, args, salt);
        assertEq(deployed, predicted);
    }

    function test_deploy_sameSaltDifferentDeployers_differentAddresses() public {
        bytes memory args = _constructorArgs(alice, "Shared");
        bytes32 salt = keccak256("salt");
        vm.prank(alice);
        address a = factory.deployCollection(code, args, salt);
        vm.prank(bob);
        address b = factory.deployCollection(code, args, salt);
        assertTrue(a != b);
    }

    function test_deploy_sameDeployerSameInputs_reverts() public {
        bytes memory args = _constructorArgs(alice, "Alice");
        vm.startPrank(alice);
        factory.deployCollection(code, args, bytes32(0));
        vm.expectRevert(CobwebFactory.DeploymentFailed.selector);
        factory.deployCollection(code, args, bytes32(0));
        vm.stopPrank();
    }

    function test_deploy_runtimeBytecodeIsIdenticalAcrossCollections() public {
        vm.prank(alice);
        address other = factory.deployCollection(code, _constructorArgs(alice, "A Different Collection"), bytes32(0));
        assertEq(other.codehash, address(collection).codehash);
    }

    /*//////////////////////////////////////////////////////////////
                             ADMIN FUNCTIONS
    //////////////////////////////////////////////////////////////*/
    function test_adminFunctions_revertForNonAdmin() public {
        vm.startPrank(alice);
        vm.expectRevert(CobwebFactory.NotAdmin.selector);
        factory.approveCreationCode(bytes32(uint256(1)));
        vm.expectRevert(CobwebFactory.NotAdmin.selector);
        factory.removeCreationCode(bytes32(uint256(1)));
        vm.expectRevert(CobwebFactory.NotAdmin.selector);
        factory.setCollectionFees(0, 0, 0);
        vm.expectRevert(CobwebFactory.NotAdmin.selector);
        factory.setArtFeePerToken(0);
        vm.expectRevert(CobwebFactory.NotAdmin.selector);
        factory.setTreasury(alice);
        vm.expectRevert(CobwebFactory.NotAdmin.selector);
        factory.withdraw();
        vm.stopPrank();
    }

    function test_approveCreationCode_revertsOnZeroHash() public {
        vm.prank(admin);
        vm.expectRevert(CobwebFactory.ZeroHash.selector);
        factory.approveCreationCode(bytes32(0));
    }

    function test_setCollectionFees_appliesToNewCollectionsOnly() public {
        vm.prank(admin);
        factory.setCollectionFees(1, 2, 3);

        (uint256 flat, uint256 bps, uint256 airdrop) = collection.fees();
        assertEq(flat, MINT_FEE_FLAT);
        assertEq(bps, MINT_FEE_BPS);
        assertEq(airdrop, AIRDROP_FEE);

        CobwebCollection fresh = _deployCollection(creator, bytes32(uint256(2)));
        (flat, bps, airdrop) = fresh.fees();
        assertEq(flat, 1);
        assertEq(bps, 2);
        assertEq(airdrop, 3);
    }

    function test_setCollectionFees_revertsAboveMaxBps() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(CobwebFactory.FeeBpsTooHigh.selector, 10_001));
        factory.setCollectionFees(0, 10_001, 0);
    }

    function test_setTreasury_updatesAndRejectsZero() public {
        vm.startPrank(admin);
        factory.setTreasury(bob);
        assertEq(factory.treasury(), bob);
        vm.expectRevert(CobwebFactory.ZeroAddress.selector);
        factory.setTreasury(address(0));
        vm.stopPrank();
    }

    function test_setArtFeePerToken() public {
        assertEq(factory.artFeePerToken(), ART_FEE);
        vm.prank(admin);
        factory.setArtFeePerToken(7);
        assertEq(factory.artFeePerToken(), 7);
    }

    /*//////////////////////////////////////////////////////////////
                              ART PAYMENT
    //////////////////////////////////////////////////////////////*/
    function test_payForArt_recordsAndEmits() public {
        bytes32 jobId = keccak256("job-1");
        vm.expectEmit(true, true, false, true, address(factory));
        emit CobwebFactory.ArtPaid(jobId, creator, 1 ether);
        vm.prank(creator);
        factory.payForArt{value: 1 ether}(jobId);
        assertEq(factory.jobPayment(jobId, creator), 1 ether);
        assertEq(address(factory).balance, 1 ether);
    }

    function test_payForArt_revertsOnZeroValue() public {
        vm.prank(creator);
        vm.expectRevert(CobwebFactory.ZeroPayment.selector);
        factory.payForArt(keccak256("job-1"));
    }

    function test_payForArt_revertsWhenAlreadyPaid() public {
        bytes32 jobId = keccak256("job-1");
        vm.startPrank(creator);
        factory.payForArt{value: 1 ether}(jobId);
        vm.expectRevert(abi.encodeWithSelector(CobwebFactory.JobAlreadyPaid.selector, jobId, creator));
        factory.payForArt{value: 1 ether}(jobId);
        vm.stopPrank();
    }

    function test_withdraw_sendsBalanceToTreasury() public {
        vm.prank(creator);
        factory.payForArt{value: 2 ether}(keccak256("job-1"));
        vm.prank(admin);
        factory.withdraw();
        assertEq(treasury.balance, 2 ether);
        assertEq(address(factory).balance, 0);
    }

    function test_withdraw_revertsWhenEmpty() public {
        vm.prank(admin);
        vm.expectRevert(CobwebFactory.NothingToWithdraw.selector);
        factory.withdraw();
    }

    function test_payForArt_cannotBeBlockedByAnotherPayer() public {
        bytes32 jobId = keccak256("job-1");
        vm.prank(alice);
        factory.payForArt{value: 1}(jobId);

        vm.prank(creator);
        factory.payForArt{value: 1 ether}(jobId);
        assertEq(factory.jobPayment(jobId, creator), 1 ether);
        assertEq(factory.jobPayment(jobId, alice), 1);
    }

    function test_lastAdminCannotBeRemoved() public {
        bytes32 role = factory.DEFAULT_ADMIN_ROLE();
        vm.startPrank(admin);
        vm.expectRevert(CobwebFactory.LastAdmin.selector);
        factory.renounceRole(role, admin);
        vm.expectRevert(CobwebFactory.LastAdmin.selector);
        factory.revokeRole(role, admin);

        factory.grantRole(role, bob);
        factory.renounceRole(role, admin);
        vm.stopPrank();
        assertFalse(factory.isAdmin(admin));
        assertTrue(factory.isAdmin(bob));
    }
}
