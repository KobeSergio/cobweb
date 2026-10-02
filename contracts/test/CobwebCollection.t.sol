// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {BaseTest, MockDelegateRegistry, MockTransferValidator, EtherRejecter} from "./utils/BaseTest.sol";
import {CobwebCollection} from "../src/CobwebCollection.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract CobwebCollectionTest is BaseTest {
    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/
    function test_constructor_copiesFeesFromFactory() public view {
        (uint256 flat, uint256 bps, uint256 airdrop) = collection.fees();
        assertEq(flat, MINT_FEE_FLAT);
        assertEq(bps, MINT_FEE_BPS);
        assertEq(airdrop, AIRDROP_FEE);
    }

    function test_constructor_groupsStartClosed() public view {
        assertFalse(collection.mintGroupActive(PUBLIC));
        assertFalse(collection.mintGroupActive(ALLOWLIST));
        assertEq(collection.mintGroups().length, 2);
        assertEq(collection.maxSupply(), MAX_SUPPLY);
    }

    function test_constructor_revertsWhenDeployerIsNotAFactory() public {
        CobwebCollection.BaseVariables memory base =
            CobwebCollection.BaseVariables("X", "X", creatorPayout, "", MAX_SUPPLY);
        uint256[] memory one = new uint256[](1);
        vm.prank(alice);
        vm.expectRevert();
        new CobwebCollection(base, one, one, 1, 0, alice, royaltyReceiver);
    }

    function test_constructor_revertsWhenAllocationsExceedMaxSupply() public {
        CobwebCollection.BaseVariables memory base = CobwebCollection.BaseVariables("X", "X", creatorPayout, "", 10);
        uint256[] memory supplies = new uint256[](1);
        supplies[0] = 11;
        uint256[] memory prices = new uint256[](1);
        bytes memory args = abi.encode(base, supplies, prices, 1, uint96(0), alice, royaltyReceiver);
        vm.expectRevert();
        factory.deployCollection(type(CobwebCollection).creationCode, args, bytes32(0));
    }

    /*//////////////////////////////////////////////////////////////
                                LIVENESS
    //////////////////////////////////////////////////////////////*/
    function test_mint_revertsWhileGroupClosed() public {
        uint256 cost = _cost(PUBLIC, 1);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CobwebCollection.MintGroupInactive.selector, PUBLIC));
        collection.batchMint{value: cost}(1, PUBLIC);
    }

    function test_schedule_opensExactlyAtStart() public {
        uint256 start = block.timestamp + 1 hours;
        vm.prank(creator);
        collection.scheduleMintGroupStart(PUBLIC, start);

        uint256 cost = _cost(PUBLIC, 1);
        vm.warp(start - 1);
        assertFalse(collection.mintGroupActive(PUBLIC));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CobwebCollection.MintGroupInactive.selector, PUBLIC));
        collection.batchMint{value: cost}(1, PUBLIC);

        vm.warp(start);
        assertTrue(collection.mintGroupActive(PUBLIC));
        assertFalse(collection.mintGroupActiveFlag(PUBLIC));
        vm.prank(alice);
        collection.batchMint{value: cost}(1, PUBLIC);
        assertEq(collection.balanceOf(alice), 1);
    }

    function test_close_clearsScheduleSoItCannotReopen() public {
        uint256 start = block.timestamp + 1 hours;
        vm.startPrank(creator);
        collection.scheduleMintGroupStart(PUBLIC, start);
        vm.warp(start + 1);
        assertTrue(collection.mintGroupActive(PUBLIC));
        collection.setMintGroupStatus(PUBLIC, false);
        vm.stopPrank();

        assertFalse(collection.mintGroupActive(PUBLIC));
        assertEq(collection.mintGroupStartTimestamp(PUBLIC), 0);
        vm.warp(start + 1 days);
        assertFalse(collection.mintGroupActive(PUBLIC));
    }

    function test_stopOrStartAllMintGroups() public {
        vm.startPrank(creator);
        collection.stopOrStartAllMintGroups(true);
        assertTrue(collection.mintGroupActive(PUBLIC));
        assertTrue(collection.mintGroupActive(ALLOWLIST));
        collection.stopOrStartAllMintGroups(false);
        collection.stopOrStartAllMintGroups(false);
        vm.stopPrank();
        assertFalse(collection.mintGroupActive(PUBLIC));
        assertFalse(collection.mintGroupActive(ALLOWLIST));
    }

    /*//////////////////////////////////////////////////////////////
                              PUBLIC MINT
    //////////////////////////////////////////////////////////////*/
    function test_publicMint_splitsPriceAndFee() public {
        _open(PUBLIC);
        (uint256 cost, uint256 fee) = collection.quoteBatchMint(PUBLIC, 3);
        assertEq(fee, (MINT_FEE_FLAT + (PUBLIC_PRICE * MINT_FEE_BPS) / 10_000) * 3);
        assertEq(cost, PUBLIC_PRICE * 3 + fee);

        vm.prank(alice);
        collection.batchMint{value: cost}(3, PUBLIC);

        assertEq(collection.balanceOf(alice), 3);
        assertEq(collection.ownerOf(1), alice);
        assertEq(collection.creatorBalance(), PUBLIC_PRICE * 3);
        assertEq(collection.platformBalance(), fee);
        assertEq(address(collection).balance, cost);
        assertEq(collection.mintGroupMints(PUBLIC), 3);
        assertEq(collection.publicMints(alice), 3);
    }

    function test_publicMint_refundsExcess() public {
        _open(PUBLIC);
        uint256 cost = _cost(PUBLIC, 1);
        uint256 before = alice.balance;
        vm.prank(alice);
        collection.batchMint{value: cost + 1 ether}(1, PUBLIC);
        assertEq(alice.balance, before - cost);
    }

    function test_publicMint_failedRefundIsCreditedNotLost() public {
        _open(PUBLIC);
        EtherRejecter rejecter = new EtherRejecter();
        uint256 cost = _cost(PUBLIC, 1);
        rejecter.mint{value: cost + 1 ether}(collection, 1, PUBLIC);
        assertEq(collection.balanceOf(address(rejecter)), 1);
        assertEq(collection.pendingBalance(address(rejecter)), 1 ether);
    }

    function test_publicMint_revertsOnInsufficientEther() public {
        _open(PUBLIC);
        uint256 cost = _cost(PUBLIC, 1);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CobwebCollection.InsufficientEther.selector, cost, cost - 1));
        collection.batchMint{value: cost - 1}(1, PUBLIC);
    }

    function test_publicMint_revertsOnZeroAmount() public {
        _open(PUBLIC);
        vm.prank(alice);
        vm.expectRevert(CobwebCollection.ZeroAmount.selector);
        collection.batchMint(0, PUBLIC);
    }

    function test_publicMint_capIsCumulative() public {
        _open(PUBLIC);
        vm.startPrank(alice);
        collection.batchMint{value: _cost(PUBLIC, 3)}(3, PUBLIC);
        uint256 cost = _cost(PUBLIC, 3);
        vm.expectRevert(abi.encodeWithSelector(CobwebCollection.ExceedsPublicMaxPerWallet.selector, 3, 2));
        collection.batchMint{value: cost}(3, PUBLIC);
        collection.batchMint{value: _cost(PUBLIC, 2)}(2, PUBLIC);
        vm.stopPrank();
        assertEq(collection.balanceOf(alice), PUBLIC_CAP);
    }

    function test_publicMint_capLoweredBelowHeld_reportsZeroAllowed() public {
        _open(PUBLIC);
        {
            uint256 value = _cost(PUBLIC, 4);
            vm.prank(alice);
            collection.batchMint{value: value}(4, PUBLIC);
        }
        vm.prank(creator);
        collection.setPublicMaxMintPerWallet(2);

        uint256 cost = _cost(PUBLIC, 1);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CobwebCollection.ExceedsPublicMaxPerWallet.selector, 1, 0));
        collection.batchMint{value: cost}(1, PUBLIC);
    }

    function test_freeMint_stillChargesFlatFee() public {
        vm.startPrank(creator);
        collection.changeSalePrice(0, PUBLIC);
        collection.setMintGroupStatus(PUBLIC, true);
        vm.stopPrank();

        (uint256 cost, uint256 fee) = collection.quoteBatchMint(PUBLIC, 2);
        assertEq(cost, MINT_FEE_FLAT * 2);
        assertEq(fee, cost);
        vm.prank(alice);
        collection.batchMint{value: cost}(2, PUBLIC);
        assertEq(collection.creatorBalance(), 0);
        assertEq(collection.platformBalance(), cost);
    }

    /*//////////////////////////////////////////////////////////////
                             ALLOWLIST MINT
    //////////////////////////////////////////////////////////////*/
    function test_allowlistMint_requiresQuota() public {
        _open(ALLOWLIST);
        uint256 cost = _cost(ALLOWLIST, 1);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CobwebCollection.NotInWhitelist.selector, alice, ALLOWLIST));
        collection.batchMint{value: cost}(1, ALLOWLIST);
    }

    function test_allowlistMint_usesQuotaAndIgnoresPublicCap() public {
        _open(ALLOWLIST);
        _setQuota(alice, 8);
        {
            uint256 value = _cost(ALLOWLIST, 8);
            vm.prank(alice);
            collection.batchMint{value: value}(8, ALLOWLIST);
        }
        assertEq(collection.balanceOf(alice), 8);
        assertEq(collection.quotaClaimed(ALLOWLIST, alice), 8);
        assertEq(collection.quotaRemaining(ALLOWLIST, alice), 0);
        assertEq(collection.publicMints(alice), 0);
    }

    function test_allowlistMint_revertsBeyondQuota() public {
        _open(ALLOWLIST);
        _setQuota(alice, 2);
        vm.startPrank(alice);
        collection.batchMint{value: _cost(ALLOWLIST, 1)}(1, ALLOWLIST);
        uint256 cost = _cost(ALLOWLIST, 2);
        vm.expectRevert(abi.encodeWithSelector(CobwebCollection.ExceedsMintQuota.selector, 2, 1));
        collection.batchMint{value: cost}(2, ALLOWLIST);
        vm.stopPrank();
    }

    function test_setMintQuota_reuploadDoesNotRegrantSpentQuota() public {
        _open(ALLOWLIST);
        _setQuota(alice, 2);
        {
            uint256 value = _cost(ALLOWLIST, 2);
            vm.prank(alice);
            collection.batchMint{value: value}(2, ALLOWLIST);
        }

        _setQuota(alice, 2);
        assertEq(collection.quotaRemaining(ALLOWLIST, alice), 0);
        uint256 cost = _cost(ALLOWLIST, 1);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CobwebCollection.ExceedsMintQuota.selector, 1, 0));
        collection.batchMint{value: cost}(1, ALLOWLIST);
    }

    function test_setMintQuota_revertsForPublicGroup() public {
        address[] memory addrs = new address[](1);
        uint256[] memory quotas = new uint256[](1);
        vm.prank(creator);
        vm.expectRevert(CobwebCollection.PublicGroupHasNoQuota.selector);
        collection.setMintQuota(addrs, PUBLIC, quotas);
    }

    function test_setMintQuota_revertsOnLengthMismatchAndUnknownGroup() public {
        address[] memory addrs = new address[](2);
        uint256[] memory quotas = new uint256[](1);
        vm.startPrank(creator);
        vm.expectRevert(CobwebCollection.ArrayLengthMismatch.selector);
        collection.setMintQuota(addrs, ALLOWLIST, quotas);
        address[] memory one = new address[](1);
        vm.expectRevert(abi.encodeWithSelector(CobwebCollection.MintGroupDoesNotExist.selector, 9));
        collection.setMintQuota(one, 9, quotas);
        vm.stopPrank();
    }

    /*//////////////////////////////////////////////////////////////
                                 SUPPLY
    //////////////////////////////////////////////////////////////*/
    function test_groupSupply_isEnforced() public {
        vm.startPrank(creator);
        collection.setMintGroupMaxSupply(PUBLIC, 2);
        collection.setMintGroupStatus(PUBLIC, true);
        vm.stopPrank();

        uint256 cost = _cost(PUBLIC, 3);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CobwebCollection.ExceedsMintGroupMaxSupply.selector, 3, 2));
        collection.batchMint{value: cost}(3, PUBLIC);
    }

    function test_setMintGroupMaxSupply_revertsBelowMinted() public {
        _open(PUBLIC);
        {
            uint256 value = _cost(PUBLIC, 4);
            vm.prank(alice);
            collection.batchMint{value: value}(4, PUBLIC);
        }
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(CobwebCollection.BelowMinted.selector, 4));
        collection.setMintGroupMaxSupply(PUBLIC, 3);
    }

    function test_setMintGroupMaxSupply_revertsWhenAllocationsExceedCollection() public {
        vm.prank(creator);
        vm.expectRevert(CobwebCollection.AllocationsExceedMaxSupply.selector);
        collection.setMintGroupMaxSupply(PUBLIC, MAX_SUPPLY - ALLOWLIST_SUPPLY + 1);
    }

    function test_collectionSupply_holdsAfterAirdropsTakeHeadroom() public {
        // Allocations sum to 900 of 1,000. Airdrop 999, leaving room for one.
        address[] memory to = new address[](1);
        to[0] = bob;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 999;
        vm.prank(creator);
        collection.airdropNFTs{value: AIRDROP_FEE * 999}(to, amounts);

        _open(PUBLIC);
        uint256 cost = _cost(PUBLIC, 2);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CobwebCollection.ExceedsMaxSupply.selector, 2, 1));
        collection.batchMint{value: cost}(2, PUBLIC);
    }

    /*//////////////////////////////////////////////////////////////
                              MINT GROUPS
    //////////////////////////////////////////////////////////////*/
    function test_registerMintGroup_configuresInOneCall() public {
        uint256 start = block.timestamp + 1 days;
        vm.prank(creator);
        collection.registerMintGroup(7, 0.02 ether, 50, start);

        assertTrue(collection.mintGroupExists(7));
        assertEq(collection.mintPrice(7), 0.02 ether);
        assertEq(collection.mintGroupMaxSupply(7), 50);
        assertEq(collection.mintGroupStartTimestamp(7), start);
        assertFalse(collection.mintGroupActive(7));
        assertEq(collection.mintGroups().length, 3);
    }

    function test_registerMintGroup_revertsIfExistsOrOverAllocated() public {
        vm.startPrank(creator);
        vm.expectRevert(abi.encodeWithSelector(CobwebCollection.MintGroupAlreadyExists.selector, ALLOWLIST));
        collection.registerMintGroup(ALLOWLIST, 0, 0, 0);
        vm.expectRevert(CobwebCollection.AllocationsExceedMaxSupply.selector);
        collection.registerMintGroup(2, 0, 101, 0);
        vm.stopPrank();
    }

    function test_settersRejectUnknownGroup() public {
        bytes memory err = abi.encodeWithSelector(CobwebCollection.MintGroupDoesNotExist.selector, 9);
        vm.startPrank(creator);
        vm.expectRevert(err);
        collection.changeSalePrice(1, 9);
        vm.expectRevert(err);
        collection.setMintGroupMaxSupply(9, 1);
        vm.expectRevert(err);
        collection.setMintGroupStatus(9, true);
        vm.expectRevert(err);
        collection.scheduleMintGroupStart(9, 1);
        vm.stopPrank();
    }

    function test_ownerFunctions_revertForNonOwner() public {
        bytes memory err = abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice);
        address[] memory addrs = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        vm.startPrank(alice);
        vm.expectRevert(err);
        collection.registerMintGroup(2, 0, 0, 0);
        vm.expectRevert(err);
        collection.setMintQuota(addrs, ALLOWLIST, amounts);
        vm.expectRevert(err);
        collection.setPublicMaxMintPerWallet(1);
        vm.expectRevert(err);
        collection.setMintOnBehalfStatus(true);
        vm.expectRevert(err);
        collection.changeSalePrice(1, PUBLIC);
        vm.expectRevert(err);
        collection.setMintGroupMaxSupply(PUBLIC, 1);
        vm.expectRevert(err);
        collection.setMintGroupStatus(PUBLIC, true);
        vm.expectRevert(err);
        collection.stopOrStartAllMintGroups(true);
        vm.expectRevert(err);
        collection.scheduleMintGroupStart(PUBLIC, 1);
        vm.expectRevert(err);
        collection.setBaseURI("x");
        vm.expectRevert(err);
        collection.setOwnerPayoutAddress(alice);
        vm.expectRevert(err);
        collection.setDefaultRoyalty(alice, 1);
        vm.expectRevert(err);
        collection.setTokenRoyalty(1, alice, 1);
        vm.expectRevert(err);
        collection.airdropNFTs(addrs, amounts);
        vm.stopPrank();
    }

    /*//////////////////////////////////////////////////////////////
                             MINT ON BEHALF
    //////////////////////////////////////////////////////////////*/
    function test_mintOnBehalf_revertsWhenOff() public {
        _open(PUBLIC);
        uint256 cost = _cost(PUBLIC, 1);
        vm.prank(alice);
        vm.expectRevert(CobwebCollection.MintOnBehalfNotActive.selector);
        collection.mintOnBehalf{value: cost}(1, PUBLIC, bob);
    }

    function test_mintOnBehalf_usesReceiversQuotaAndDeliversToReceiver() public {
        _open(ALLOWLIST);
        _setQuota(bob, 2);
        vm.prank(creator);
        collection.setMintOnBehalfStatus(true);

        {

            uint256 value = _cost(ALLOWLIST, 2);

            vm.prank(alice);

            collection.mintOnBehalf{value: value}(2, ALLOWLIST, bob);
        }
        assertEq(collection.balanceOf(bob), 2);
        assertEq(collection.balanceOf(alice), 0);
        assertEq(collection.quotaClaimed(ALLOWLIST, bob), 2);
    }

    /*//////////////////////////////////////////////////////////////
                             DELEGATED MINT
    //////////////////////////////////////////////////////////////*/
    function test_delegateMint_revertsWhereRegistryIsNotDeployed() public {
        _open(ALLOWLIST);
        _setQuota(bob, 2);
        uint256 cost = _cost(ALLOWLIST, 1);
        vm.prank(alice);
        vm.expectRevert();
        collection.delegateMint{value: cost}(1, ALLOWLIST, bob);
    }

    function test_delegateMint_revertsWithoutDelegation() public {
        _etchDelegateRegistry();
        _open(ALLOWLIST);
        _setQuota(bob, 2);
        uint256 cost = _cost(ALLOWLIST, 1);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CobwebCollection.NotDelegate.selector, alice, bob));
        collection.delegateMint{value: cost}(1, ALLOWLIST, bob);
    }

    function test_delegateMint_usesVaultQuotaAndDeliversToCaller() public {
        MockDelegateRegistry registry = _etchDelegateRegistry();
        registry.setDelegate(bob, alice, true);
        _open(ALLOWLIST);
        _setQuota(bob, 2);

        {

            uint256 value = _cost(ALLOWLIST, 2);

            vm.prank(alice);

            collection.delegateMint{value: value}(2, ALLOWLIST, bob);
        }
        assertEq(collection.balanceOf(alice), 2);
        assertEq(collection.balanceOf(bob), 0);
        assertEq(collection.quotaClaimed(ALLOWLIST, bob), 2);
        assertEq(collection.quotaClaimed(ALLOWLIST, alice), 0);
    }

    function test_delegateMint_publicGroupCountsAgainstVaultCap() public {
        MockDelegateRegistry registry = _etchDelegateRegistry();
        registry.setDelegate(bob, alice, true);
        _open(PUBLIC);

        {

            uint256 value = _cost(PUBLIC, PUBLIC_CAP);

            vm.prank(alice);

            collection.delegateMint{value: value}(PUBLIC_CAP, PUBLIC, bob);
        }
        assertEq(collection.publicMints(bob), PUBLIC_CAP);
        assertEq(collection.publicMints(alice), 0);
    }

    /*//////////////////////////////////////////////////////////////
                                AIRDROPS
    //////////////////////////////////////////////////////////////*/
    function test_airdrop_chargesFeeAndSkipsGroupAllocation() public {
        address[] memory to = new address[](2);
        to[0] = alice;
        to[1] = DEAD;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 3;
        amounts[1] = 2;

        uint256 before = creator.balance;
        vm.prank(creator);
        collection.airdropNFTs{value: 1 ether}(to, amounts);

        assertEq(collection.balanceOf(alice), 3);
        assertEq(collection.balanceOf(DEAD), 2);
        assertEq(collection.totalMinted(), 5);
        assertEq(collection.platformBalance(), AIRDROP_FEE * 5);
        assertEq(creator.balance, before - AIRDROP_FEE * 5);
        assertEq(collection.mintGroupMints(PUBLIC), 0);
        assertEq(collection.creatorBalance(), 0);
    }

    function test_airdrop_revertsOnInsufficientFee() public {
        address[] memory to = new address[](1);
        to[0] = alice;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 4;
        vm.prank(creator);
        vm.expectRevert(
            abi.encodeWithSelector(CobwebCollection.InsufficientEther.selector, AIRDROP_FEE * 4, AIRDROP_FEE * 4 - 1)
        );
        collection.airdropNFTs{value: AIRDROP_FEE * 4 - 1}(to, amounts);
    }

    function test_airdrop_revertsPastMaxSupplyAndOnMismatch() public {
        address[] memory to = new address[](1);
        to[0] = alice;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = MAX_SUPPLY + 1;
        vm.startPrank(creator);
        vm.expectRevert(abi.encodeWithSelector(CobwebCollection.ExceedsMaxSupply.selector, MAX_SUPPLY + 1, MAX_SUPPLY));
        collection.airdropNFTs{value: 1 ether}(to, amounts);
        uint256[] memory two = new uint256[](2);
        vm.expectRevert(CobwebCollection.ArrayLengthMismatch.selector);
        collection.airdropNFTs(to, two);
        vm.stopPrank();
    }

    /*//////////////////////////////////////////////////////////////
                              WITHDRAWALS
    //////////////////////////////////////////////////////////////*/
    function _mintPublic(address minter, uint256 amount) internal returns (uint256 cost, uint256 fee) {
        (cost, fee) = collection.quoteBatchMint(PUBLIC, amount);
        vm.prank(minter);
        collection.batchMint{value: cost}(amount, PUBLIC);
    }

    function test_withdrawMintFunds_paysPayoutAddress() public {
        _open(PUBLIC);
        _mintPublic(alice, 5);

        vm.prank(creator);
        collection.withdrawMintFunds();
        assertEq(creatorPayout.balance, PUBLIC_PRICE * 5);
        assertEq(collection.creatorBalance(), 0);

        _mintPublic(bob, 1);
        vm.prank(creatorPayout);
        collection.withdrawMintFunds();
        assertEq(creatorPayout.balance, PUBLIC_PRICE * 6);
    }

    function test_withdrawMintFunds_revertsForOthersAndWhenEmpty() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CobwebCollection.Unauthorized.selector, alice));
        collection.withdrawMintFunds();
        vm.prank(creator);
        vm.expectRevert(CobwebCollection.NothingToWithdraw.selector);
        collection.withdrawMintFunds();
    }

    function test_withdrawPlatformFees_goesToCurrentTreasury() public {
        _open(PUBLIC);
        (, uint256 fee) = _mintPublic(alice, 5);

        address newTreasury = makeAddr("newTreasury");
        vm.prank(admin);
        factory.setTreasury(newTreasury);

        vm.prank(bob);
        collection.withdrawPlatformFees();
        assertEq(newTreasury.balance, fee);
        assertEq(treasury.balance, 0);
        assertEq(collection.platformBalance(), 0);

        vm.expectRevert(CobwebCollection.NothingToWithdraw.selector);
        collection.withdrawPlatformFees();
    }

    function test_withdrawals_areIndependent() public {
        _open(PUBLIC);
        (uint256 cost, uint256 fee) = _mintPublic(alice, 5);

        collection.withdrawPlatformFees();
        assertEq(address(collection).balance, cost - fee);
        vm.prank(creator);
        collection.withdrawMintFunds();
        assertEq(address(collection).balance, 0);
    }

    function test_setOwnerPayoutAddress_redirectsProceeds() public {
        _open(PUBLIC);
        _mintPublic(alice, 2);
        address newPayout = makeAddr("newPayout");

        vm.startPrank(creator);
        collection.setOwnerPayoutAddress(newPayout);
        vm.expectRevert(CobwebCollection.AddressZero.selector);
        collection.setOwnerPayoutAddress(address(0));
        collection.withdrawMintFunds();
        vm.stopPrank();

        assertEq(newPayout.balance, PUBLIC_PRICE * 2);
        assertEq(creatorPayout.balance, 0);
        assertEq(collection.ownerPayoutAddress(), newPayout);
    }

    function test_setOwnerPayoutAddress_cannotSweepAMintersRefund() public {
        _open(PUBLIC);
        EtherRejecter rejecter = new EtherRejecter();
        uint256 cost = _cost(PUBLIC, 1);
        rejecter.mint{value: cost + 1 ether}(collection, 1, PUBLIC);

        vm.startPrank(creator);
        collection.setOwnerPayoutAddress(address(rejecter));
        collection.setOwnerPayoutAddress(creator);
        collection.withdrawMintFunds();
        vm.stopPrank();

        assertEq(collection.pendingBalance(address(rejecter)), 1 ether);
        assertEq(collection.creatorBalance(), 0);
        assertEq(address(collection).balance, 1 ether + collection.platformBalance());
    }

    function test_withdrawPendingBalanceTo_rescuesARefundTheMinterCannotReceive() public {
        _open(PUBLIC);
        EtherRejecter rejecter = new EtherRejecter();
        uint256 cost = _cost(PUBLIC, 1);
        rejecter.mint{value: cost + 1 ether}(collection, 1, PUBLIC);

        vm.prank(address(rejecter));
        vm.expectRevert(CobwebCollection.WithdrawFailed.selector);
        collection.withdrawPendingBalance();

        address rescue = makeAddr("rescue");
        vm.prank(address(rejecter));
        collection.withdrawPendingBalanceTo(rescue);
        assertEq(rescue.balance, 1 ether);
        assertEq(collection.pendingBalance(address(rejecter)), 0);
    }

    function test_renouncedOwnership_payoutAddressCanStillWithdraw() public {
        _open(PUBLIC);
        _mintPublic(alice, 2);
        vm.prank(creator);
        collection.renounceOwnership();
        vm.prank(creatorPayout);
        collection.withdrawMintFunds();
        assertEq(creatorPayout.balance, PUBLIC_PRICE * 2);
    }

    /*//////////////////////////////////////////////////////////////
                             PLATFORM FEES
    //////////////////////////////////////////////////////////////*/
    function test_setFees_adminCanRaiseAndLower() public {
        vm.startPrank(admin);
        collection.setFees(MINT_FEE_FLAT * 2, 500, AIRDROP_FEE * 2);
        (uint256 flat, uint256 bps, uint256 airdrop) = collection.fees();
        assertEq(flat, MINT_FEE_FLAT * 2);
        assertEq(bps, 500);
        assertEq(airdrop, AIRDROP_FEE * 2);

        collection.setFees(0, 0, 0);
        vm.stopPrank();
        (uint256 cost, uint256 fee) = collection.quoteBatchMint(PUBLIC, 1);
        assertEq(cost, PUBLIC_PRICE);
        assertEq(fee, 0);
    }

    function test_setFees_revertsForCreatorAndOthers() public {
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(CobwebCollection.Unauthorized.selector, creator));
        collection.setFees(0, 0, 0);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CobwebCollection.Unauthorized.selector, alice));
        collection.setFees(0, 0, 0);
    }

    function test_setFees_revertsAboveMaxBps() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(CobwebCollection.FeeBpsTooHigh.selector, 10_001));
        collection.setFees(0, 10_001, 0);
    }

    function testFuzz_quoteBatchMint(uint96 price, uint96 flat, uint16 bps, uint16 amount) public {
        bps = uint16(bound(bps, 0, 10_000));
        vm.prank(creator);
        collection.changeSalePrice(price, PUBLIC);
        vm.prank(admin);
        collection.setFees(flat, bps, 0);

        (uint256 cost, uint256 fee) = collection.quoteBatchMint(PUBLIC, amount);
        uint256 unitFee = uint256(flat) + (uint256(price) * bps) / 10_000;
        assertEq(fee, unitFee * amount);
        assertEq(cost, uint256(price) * amount + fee);
    }

    /*//////////////////////////////////////////////////////////////
                           METADATA AND VIEWS
    //////////////////////////////////////////////////////////////*/
    function test_tokenURI_returnsBaseAsIsUntilItEndsInSlash() public {
        _open(PUBLIC);
        _mintPublic(alice, 2);
        assertEq(collection.tokenURI(1), "ipfs://unrevealed");
        assertEq(collection.tokenURI(2), "ipfs://unrevealed");

        vm.expectEmit(true, true, false, false, address(collection));
        emit CobwebCollection.BatchMetadataUpdate(1, type(uint256).max);
        vm.prank(creator);
        collection.setBaseURI("ipfs://revealed/");
        assertEq(collection.tokenURI(1), "ipfs://revealed/1");
        assertEq(collection.tokenURI(2), "ipfs://revealed/2");

        vm.prank(creator);
        collection.setBaseURI("");
        assertEq(collection.tokenURI(1), "");
    }

    function test_tokenURI_revertsForNonexistentToken() public {
        vm.expectRevert();
        collection.tokenURI(1);
    }

    function test_collectionState_reportsGroupsFeesAndBlockTime() public {
        uint256 start = block.timestamp + 1 hours;
        vm.startPrank(creator);
        collection.setMintGroupStatus(PUBLIC, true);
        collection.scheduleMintGroupStart(ALLOWLIST, start);
        vm.stopPrank();
        _mintPublic(alice, 2);

        CobwebCollection.CollectionState memory state = collection.collectionState();
        assertEq(state.maxSupply, MAX_SUPPLY);
        assertEq(state.totalMinted, 2);
        assertEq(state.publicMaxMintPerWallet, PUBLIC_CAP);
        assertEq(state.mintFeeFlat, MINT_FEE_FLAT);
        assertEq(state.mintFeeBps, MINT_FEE_BPS);
        assertEq(state.airdropFeePerToken, AIRDROP_FEE);
        assertEq(state.blockTimestamp, block.timestamp);
        assertEq(state.groups.length, 2);

        assertEq(state.groups[0].id, PUBLIC);
        assertEq(state.groups[0].price, PUBLIC_PRICE);
        assertEq(state.groups[0].maxSupply, PUBLIC_SUPPLY);
        assertEq(state.groups[0].minted, 2);
        assertTrue(state.groups[0].activeFlag);
        assertTrue(state.groups[0].active);

        assertEq(state.groups[1].startTimestamp, start);
        assertFalse(state.groups[1].activeFlag);
        assertFalse(state.groups[1].active);

        vm.warp(start);
        state = collection.collectionState();
        assertFalse(state.groups[1].activeFlag);
        assertTrue(state.groups[1].active);
    }

    function test_walletState_reportsCapAndQuotas() public {
        vm.prank(creator);
        collection.stopOrStartAllMintGroups(true);
        _setQuota(alice, 4);
        _mintPublic(alice, 2);
        {
            uint256 value = _cost(ALLOWLIST, 1);
            vm.prank(alice);
            collection.batchMint{value: value}(1, ALLOWLIST);
        }

        (uint256 publicMinted, uint256[] memory ids, uint256[] memory issued, uint256[] memory claimed) =
            collection.walletState(alice);
        assertEq(publicMinted, 2);
        assertEq(ids.length, 2);
        assertEq(ids[1], ALLOWLIST);
        assertEq(issued[0], 0);
        assertEq(issued[1], 4);
        assertEq(claimed[1], 1);
    }

    function test_canMintCheck_namesTheFailingCheck() public {
        (bool ok, string memory reason) = collection.canMintCheck(1, PUBLIC, alice);
        assertFalse(ok);
        assertEq(reason, "MintGroupInactive");

        vm.prank(creator);
        collection.stopOrStartAllMintGroups(true);
        (ok, reason) = collection.canMintCheck(0, PUBLIC, alice);
        assertEq(reason, "ZeroAmount");
        (ok, reason) = collection.canMintCheck(PUBLIC_CAP + 1, PUBLIC, alice);
        assertEq(reason, "ExceedsPublicMaxPerWallet");
        (ok, reason) = collection.canMintCheck(1, ALLOWLIST, alice);
        assertEq(reason, "NotInWhitelist");
        _setQuota(alice, 1);
        (ok, reason) = collection.canMintCheck(2, ALLOWLIST, alice);
        assertEq(reason, "ExceedsMintQuota");
        (ok, reason) = collection.canMintCheck(1, ALLOWLIST, alice);
        assertTrue(ok);
        assertEq(reason, "");
    }

    function test_royaltyAndInterfaces() public view {
        (address receiver, uint256 amount) = collection.royaltyInfo(1, 1 ether);
        assertEq(receiver, royaltyReceiver);
        assertEq(amount, 0.05 ether);
        assertTrue(collection.supportsInterface(0x80ac58cd)); // ERC721
        assertTrue(collection.supportsInterface(0x2a55205a)); // ERC2981
        assertTrue(collection.supportsInterface(0x49064906)); // ERC4906
    }

    /*//////////////////////////////////////////////////////////////
                         TRANSFERS AND LOCKING
    //////////////////////////////////////////////////////////////*/
    function test_transfer_worksWhereNoValidatorIsDeployed() public {
        _open(PUBLIC);
        _mintPublic(alice, 1);
        vm.prank(alice);
        collection.transferFrom(alice, bob, 1);
        assertEq(collection.ownerOf(1), bob);
    }

    function test_validatorLock_blocksTransfersButNotMints() public {
        MockTransferValidator validator = _etchValidator();
        _open(PUBLIC);
        _mintPublic(alice, 1);

        validator.setLocked(true);
        vm.prank(alice);
        vm.expectRevert(MockTransferValidator.TransfersLocked.selector);
        collection.transferFrom(alice, bob, 1);

        _mintPublic(bob, 1);
        assertEq(collection.balanceOf(bob), 1);

        validator.setLocked(false);
        vm.prank(alice);
        collection.transferFrom(alice, bob, 1);
        assertEq(collection.ownerOf(1), bob);
    }

    function test_creatorCanChangeTransferValidator() public {
        MockTransferValidator validator = _etchValidator();
        validator.setLocked(true);
        _open(PUBLIC);
        _mintPublic(alice, 1);

        vm.prank(alice);
        vm.expectRevert();
        collection.setTransferValidator(address(0));

        vm.prank(creator);
        collection.setTransferValidator(address(0));
        vm.prank(alice);
        collection.transferFrom(alice, bob, 1);
        assertEq(collection.ownerOf(1), bob);
    }

    function test_customValidatorWithAutoApproval_cannotMoveHoldersTokens() public {
        _open(PUBLIC);
        _mintPublic(alice, 1);
        RogueValidator rogue = new RogueValidator();

        vm.startPrank(creator);
        collection.setTransferValidator(address(rogue));
        collection.setAutomaticApprovalOfTransfersFromValidator(true);
        vm.stopPrank();

        assertFalse(collection.isApprovedForAll(alice, address(rogue)));
        vm.expectRevert();
        rogue.take(collection, alice, creator, 1);
        assertEq(collection.ownerOf(1), alice);
    }

    function test_defaultValidatorAutoApproval_isHonoured() public {
        _etchValidator();
        vm.prank(creator);
        collection.setAutomaticApprovalOfTransfersFromValidator(true);
        assertTrue(collection.isApprovedForAll(alice, DEFAULT_VALIDATOR));
        assertFalse(collection.isApprovedForAll(alice, bob));
    }

    /*//////////////////////////////////////////////////////////////
                         LARGE BATCHES, REENTRANCY
    //////////////////////////////////////////////////////////////*/
    function test_largeAirdrop_lastTokenStaysCheapToTransfer() public {
        address[] memory to = new address[](1);
        to[0] = alice;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 600;
        vm.prank(creator);
        collection.airdropNFTs{value: AIRDROP_FEE * 600}(to, amounts);
        assertEq(collection.balanceOf(alice), 600);

        vm.prank(alice);
        uint256 gasBefore = gasleft();
        collection.transferFrom(alice, bob, 600);
        assertLt(gasBefore - gasleft(), 200_000);
        assertEq(collection.ownerOf(600), bob);
        assertEq(collection.ownerOf(599), alice);
    }

    function test_reentrantMintFromReceiverCallback_reverts() public {
        _open(PUBLIC);
        ReentrantMinter attacker = new ReentrantMinter(collection);
        uint256 cost = _cost(PUBLIC, 1);
        vm.deal(address(attacker), 10 ether);
        vm.expectRevert();
        attacker.attack{value: cost}(cost);
        assertEq(collection.totalMinted(), 0);
    }
}

/// @dev A creator-installed "validator" that tries to move a holder's token.
contract RogueValidator {
    function take(CobwebCollection collection, address from, address to, uint256 tokenId) external {
        collection.transferFrom(from, to, tokenId);
    }

    function validateTransfer(address, address, address, uint256) external pure {}

    function setTokenTypeOfCollection(address, uint16) external {}
}

/// @dev Tries to mint again from inside the ERC721 receiver callback.
contract ReentrantMinter {
    CobwebCollection internal immutable collection;
    uint256 internal cost;

    constructor(CobwebCollection collection_) {
        collection = collection_;
    }

    function attack(uint256 cost_) external payable {
        cost = cost_;
        collection.batchMint{value: cost_}(1, 0);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4) {
        collection.batchMint{value: cost}(1, 0);
        return this.onERC721Received.selector;
    }
}
