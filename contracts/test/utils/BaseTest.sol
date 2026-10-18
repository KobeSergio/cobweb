// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {CobwebFactory} from "../../src/CobwebFactory.sol";
import {CobwebCollection} from "../../src/CobwebCollection.sol";

/// @dev Stands in for the delegate.xyz v2 registry. Etched at the registry's address in tests.
contract MockDelegateRegistry {
    mapping(address => mapping(address => bool)) private s_delegated;

    function setDelegate(address vault, address delegate, bool enabled) external {
        s_delegated[vault][delegate] = enabled;
    }

    function checkDelegateForContract(address to, address from, address, bytes32) external view returns (bool) {
        return s_delegated[from][to];
    }
}

/// @dev Stands in for the Limit Break transfer validator. Etched at the default validator address.
///      While locked, every transfer between holders is rejected, as the soulbound level does.
contract MockTransferValidator {
    error TransfersLocked();

    bool public locked;

    function setLocked(bool locked_) external {
        locked = locked_;
    }

    function validateTransfer(address, address, address, uint256) external view {
        if (locked) revert TransfersLocked();
    }

    function setTokenTypeOfCollection(address, uint16) external {}
}

/// @dev A contract minter that accepts NFTs but rejects native-token transfers.
contract EtherRejecter {
    function mint(CobwebCollection collection, uint256 amount, uint256 mintGroup) external payable {
        collection.batchMint{value: msg.value}(amount, mintGroup);
    }

    /// @dev Claims the refunds held for this contract to an address that can receive them.
    function claimTo(CobwebCollection collection, address to) external returns (uint256) {
        return collection.withdrawPendingBalanceTo(to);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }
}

abstract contract BaseTest is Test {
    address internal constant DELEGATE_REGISTRY = 0x00000000000000447e69651d841bD8D104Bed493;
    address internal constant DEFAULT_VALIDATOR = 0x721C008fdff27BF06E7E123956E2Fe03B63342e3;
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;

    uint256 internal constant PUBLIC = 0;
    uint256 internal constant ALLOWLIST = 1;

    uint256 internal constant MAX_SUPPLY = 1_000;
    uint256 internal constant PUBLIC_SUPPLY = 600;
    uint256 internal constant ALLOWLIST_SUPPLY = 300;
    uint256 internal constant PUBLIC_PRICE = 0.1 ether;
    uint256 internal constant ALLOWLIST_PRICE = 0.05 ether;
    uint256 internal constant PUBLIC_CAP = 5;

    uint256 internal constant MINT_FEE_FLAT = 0.001 ether;
    uint256 internal constant MINT_FEE_BPS = 300;
    uint256 internal constant AIRDROP_FEE = 0.0005 ether;
    uint256 internal constant ART_FEE = 0.00004 ether;

    address internal admin = makeAddr("admin");
    address internal treasury = makeAddr("treasury");
    address internal creator = makeAddr("creator");
    address internal creatorPayout = makeAddr("creatorPayout");
    address internal royaltyReceiver = makeAddr("royaltyReceiver");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    CobwebFactory internal factory;
    CobwebCollection internal collection;

    function setUp() public virtual {
        factory = new CobwebFactory(admin, treasury);
        vm.startPrank(admin);
        factory.approveCreationCode(keccak256(type(CobwebCollection).creationCode));
        factory.setCollectionFees(MINT_FEE_FLAT, MINT_FEE_BPS, AIRDROP_FEE);
        factory.setArtFeePerToken(ART_FEE);
        vm.stopPrank();

        collection = _deployCollection(creator, bytes32(uint256(1)));

        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(creator, 100 ether);
    }

    function _constructorArgs(address owner_, string memory name) internal view returns (bytes memory) {
        CobwebCollection.BaseVariables memory base = CobwebCollection.BaseVariables({
            name: name,
            symbol: "CBW",
            ownerPayoutAddress: creatorPayout,
            initialBaseURI: "ipfs://unrevealed",
            maxSupply: MAX_SUPPLY
        });
        uint256[] memory supplies = new uint256[](2);
        supplies[0] = PUBLIC_SUPPLY;
        supplies[1] = ALLOWLIST_SUPPLY;
        uint256[] memory prices = new uint256[](2);
        prices[0] = PUBLIC_PRICE;
        prices[1] = ALLOWLIST_PRICE;
        return abi.encode(base, supplies, prices, PUBLIC_CAP, uint96(500), owner_, royaltyReceiver);
    }

    function _deployCollection(address owner_, bytes32 salt) internal returns (CobwebCollection) {
        vm.prank(owner_);
        address deployed = factory.deployCollection(
            type(CobwebCollection).creationCode, _constructorArgs(owner_, "Cobweb Test"), salt
        );
        return CobwebCollection(deployed);
    }

    function _open(uint256 mintGroup) internal {
        vm.prank(creator);
        collection.setMintGroupStatus(mintGroup, true);
    }

    function _setQuota(address minter, uint256 quota) internal {
        address[] memory addrs = new address[](1);
        addrs[0] = minter;
        uint256[] memory quotas = new uint256[](1);
        quotas[0] = quota;
        vm.prank(creator);
        collection.setMintQuota(addrs, ALLOWLIST, quotas);
    }

    function _cost(uint256 mintGroup, uint256 amount) internal view returns (uint256 totalCost) {
        (totalCost,) = collection.quoteBatchMint(mintGroup, amount);
    }

    function _etchDelegateRegistry() internal returns (MockDelegateRegistry) {
        vm.etch(DELEGATE_REGISTRY, address(new MockDelegateRegistry()).code);
        return MockDelegateRegistry(DELEGATE_REGISTRY);
    }

    function _etchValidator() internal returns (MockTransferValidator) {
        vm.etch(DEFAULT_VALIDATOR, address(new MockTransferValidator()).code);
        return MockTransferValidator(DEFAULT_VALIDATOR);
    }
}
