// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {BaseTest, EtherRejecter, MockDelegateRegistry} from "./utils/BaseTest.sol";
import {CobwebFactory} from "../src/CobwebFactory.sol";
import {CobwebCollection} from "../src/CobwebCollection.sol";

/// @dev The accounts both handlers reach: five minters, the creator, three platform admins and two treasuries.
struct Accounts {
    address[] actors;
    address creator;
    address[] admins;
    address[] treasuries;
}

/// @dev Reads the accounts both handlers share.
abstract contract Reach is Test {
    CobwebFactory internal immutable factory;
    address[] internal actors;
    address internal immutable creator;
    address[] internal admins;
    address[] internal treasuries;

    constructor(CobwebFactory factory_, Accounts memory accounts) {
        factory = factory_;
        actors = accounts.actors;
        creator = accounts.creator;
        admins = accounts.admins;
        treasuries = accounts.treasuries;
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    /// @dev The first of the three accounts holding the admin role; the factory never lets the last one go.
    function _admin() internal view returns (address) {
        for (uint256 i = 0; i < admins.length; i++) {
            if (factory.isAdmin(admins[i])) return admins[i];
        }
        return admins[0];
    }

    function _treasuryBalances() internal view returns (uint256 total) {
        for (uint256 i = 0; i < treasuries.length; i++) {
            total += treasuries[i].balance;
        }
    }
}

/// @dev Drives the factory's art payments, their withdrawal and the admin role.
contract FactoryHandler is Reach {
    uint256 public artPaid;
    uint256 public artWithdrawn;
    uint256 public artReceived;
    mapping(address => bool) public adminRecord;

    bool public repeatPaymentLanded;
    bool public lastAdminRemoved;
    bool public withdrawalRefused;

    mapping(bytes32 => mapping(address => bool)) internal paid;

    constructor(CobwebFactory factory_, Accounts memory accounts) Reach(factory_, accounts) {
        for (uint256 i = 0; i < admins.length; i++) {
            adminRecord[admins[i]] = factory.isAdmin(admins[i]);
        }
    }

    /// @dev A payer pays for a job; paying again for the same job must be refused.
    function payForArt(uint256 payerSeed, uint256 job, uint256 amount) external {
        address payer = _actor(payerSeed);
        bytes32 jobId = bytes32(bound(job, 1, 20));
        amount = bound(amount, 1, 1 ether);
        bool repeat = paid[jobId][payer];
        vm.prank(payer);
        try factory.payForArt{value: amount}(jobId) {
            if (repeat) repeatPaymentLanded = true;
            paid[jobId][payer] = true;
            artPaid += amount;
        } catch {}
    }

    /// @dev An admin sends everything the factory holds to the treasury.
    function withdrawArt() external {
        uint256 held = address(factory).balance;
        uint256 before = _treasuryBalances();
        vm.prank(_admin());
        try factory.withdraw() {
            artWithdrawn += held;
            artReceived += _treasuryBalances() - before;
        } catch {
            if (held > 0) withdrawalRefused = true;
        }
    }

    function grantAdmin(uint256 whoSeed) external {
        address who = admins[whoSeed % admins.length];
        bytes32 role = factory.DEFAULT_ADMIN_ROLE();
        vm.prank(_admin());
        factory.grantRole(role, who);
        adminRecord[who] = true;
    }

    /// @dev An admin revokes one of the three; the last admin's revoke must be refused.
    function revokeAdmin(uint256 whoSeed) external {
        address who = admins[whoSeed % admins.length];
        bytes32 role = factory.DEFAULT_ADMIN_ROLE();
        uint256 holders = 0;
        for (uint256 i = 0; i < admins.length; i++) {
            if (factory.isAdmin(admins[i])) holders++;
        }
        vm.prank(_admin());
        try factory.revokeRole(role, who) {
            if (adminRecord[who] && holders == 1) lastAdminRemoved = true;
            adminRecord[who] = false;
        } catch {}
    }
}

/// @dev Drives a collection through every path that moves value or ownership: mints of each kind, a refund held for
///      a contract that rejects ether, airdrops, burns, withdrawals, fee and treasury changes, phase edits with time
///      moving, whitelist chunks and transfers between holders.
contract CollectionHandler is Reach {
    uint256 internal constant PUBLIC = 0;
    uint256 internal constant MAX_GROUPS = 7;
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;

    enum Kind {
        Batch,
        OnBehalf,
        Delegate
    }

    CobwebCollection internal immutable collection;
    MockDelegateRegistry internal immutable registry;
    EtherRejecter public immutable rejecter;

    /// @dev Ghost totals: what was charged, withdrawn and received, held and claimed, airdropped and burned.
    uint256 public platformCharged;
    uint256 public proceedsCharged;
    uint256 public feesWithdrawn;
    uint256 public feesReceived;
    uint256 public proceedsWithdrawn;
    uint256 public proceedsReceived;
    uint256 public heldCredited;
    uint256 public heldClaimed;
    uint256 public heldReceived;
    uint256 public airdropped;
    uint256 public burned;
    mapping(address => uint256) public publicMintsOf;
    mapping(uint256 => mapping(address => uint256)) internal lastClaimed;

    /// @dev The registered groups are 0 to groupCount - 1, registered in order.
    uint256 public groupCount = 2;
    mapping(uint256 => bool) public closedSinceSchedule;

    /// @dev The admin's last fees; before any, the factory's defaults at the deploy.
    uint256 public lastFlat;
    uint256 public lastBps;
    uint256 public lastAirdropFee;

    /// @dev What must never happen.
    bool public strangerFeeChangeLanded;
    bool public mintedWhileNotLive;
    bool public capOrQuotaPassed;
    bool public claimedWentDown;
    bool public chargedOtherThanQuote;
    /// @dev A withdrawal refused while something was owed, one flag for each kind, read by the invariant named for it.
    bool public heldClaimRefused;
    bool public feesWithdrawalRefused;
    bool public proceedsWithdrawalRefused;

    address[] internal lastChunk;
    uint256[] internal lastQuotas;
    uint256 internal lastChunkGroup;
    /// @dev The caller each vault last delegated to and has not taken back, so delegated mints find a delegation.
    mapping(address => address) internal delegateOf;

    constructor(
        CobwebCollection collection_,
        CobwebFactory factory_,
        MockDelegateRegistry registry_,
        EtherRejecter rejecter_,
        Accounts memory accounts
    ) Reach(factory_, accounts) {
        collection = collection_;
        registry = registry_;
        rejecter = rejecter_;
        (lastFlat, lastBps, lastAirdropFee) = factory.collectionFees();
        for (uint256 i = 0; i < actors.length; i++) {
            vm.deal(actors[i], 1_000_000 ether);
        }
        vm.deal(creator, 1_000_000 ether);
        vm.deal(address(this), 1_000_000 ether);
    }

    /// @dev After every action, no claimed count of a minter went down.
    modifier notingClaims() {
        _;
        for (uint256 group = 1; group < groupCount; group++) {
            for (uint256 i = 0; i < actors.length; i++) {
                uint256 claimed = collection.quotaClaimed(group, actors[i]);
                if (claimed < lastClaimed[group][actors[i]]) claimedWentDown = true;
                lastClaimed[group][actors[i]] = claimed;
            }
        }
    }

    function mintPublic(uint256 actorSeed, uint256 amount, uint256 overpay) external notingClaims {
        address actor = _actor(actorSeed);
        _mint(Kind.Batch, actor, actor, PUBLIC, bound(amount, 1, 10), bound(overpay, 0, 1 ether));
    }

    /// @dev Half the time from the group the last chunk named, so list mints find their quotas.
    function mintFromList(uint256 actorSeed, uint256 group, uint256 amount) external notingClaims {
        address actor = _actor(actorSeed);
        group = group % 2 == 0 && lastChunk.length > 0 ? lastChunkGroup : 1 + group % (groupCount - 1);
        _mint(Kind.Batch, actor, actor, group, bound(amount, 1, 10), 0);
    }

    /// @dev A payer mints for a receiver's cap or quota, paying the quote and up to 1 ether more; refused while the
    ///      switch is off.
    function mintOnBehalf(uint256 payerSeed, uint256 receiverSeed, uint256 group, uint256 amount, uint256 overpay)
        external
        notingClaims
    {
        address payer = _actor(payerSeed);
        address receiver = _actor(receiverSeed);
        _mint(Kind.OnBehalf, payer, receiver, _groupOf(group), bound(amount, 1, 10), bound(overpay, 0, 1 ether));
    }

    /// @dev A caller mints on a vault's cap or quota, paying the quote and up to 1 ether more: three times in four the
    ///      caller the vault last delegated to, else any account, which the registry mock refuses unless the vault
    ///      delegated to it.
    function delegateMint(uint256 callerSeed, uint256 vaultSeed, uint256 group, uint256 amount, uint256 overpay)
        external
        notingClaims
    {
        address vault = _actor(vaultSeed);
        address caller = delegateOf[vault];
        if (callerSeed % 4 == 0 || caller == address(0)) caller = _actor(callerSeed);
        _mint(Kind.Delegate, caller, vault, _groupOf(group), bound(amount, 1, 10), bound(overpay, 0, 1 ether));
    }

    /// @dev EtherRejecter mints from Public with an excess its refund cannot reach, so the excess is held for it.
    function mintRefused(uint256 amount, uint256 overpay) external notingClaims {
        amount = bound(amount, 1, 10);
        overpay = bound(overpay, 1, 1 ether);
        address holder = address(rejecter);
        (uint256 cost, uint256 fee) = collection.quoteBatchMint(PUBLIC, amount);
        bool live = collection.mintGroupActive(PUBLIC);
        bool passes = collection.publicMints(holder) + amount > collection.publicMaxMintPerWallet();
        uint256 heldBefore = collection.pendingBalance(holder);
        uint256 balanceBefore = address(collection).balance;
        try rejecter.mint{value: cost + overpay}(collection, amount, PUBLIC) {}
        catch {
            return;
        }
        if (!live) mintedWhileNotLive = true;
        if (passes) capOrQuotaPassed = true;
        if (
            collection.pendingBalance(holder) != heldBefore + overpay
                || address(collection).balance != balanceBefore + cost + overpay
        ) {
            chargedOtherThanQuote = true;
        }
        heldCredited += overpay;
        platformCharged += fee;
        proceedsCharged += cost - fee;
        publicMintsOf[holder] += amount;
    }

    /// @dev EtherRejecter claims its held refunds to an account that can receive them.
    function claimHeld(uint256 toSeed) external notingClaims {
        address to = _actor(toSeed);
        uint256 held = collection.pendingBalance(address(rejecter));
        uint256 before = to.balance;
        try rejecter.claimTo(collection, to) returns (uint256 claimed) {
            heldClaimed += claimed;
            heldReceived += to.balance - before;
        } catch {
            if (held > 0) heldClaimRefused = true;
        }
    }

    /// @dev The creator airdrops 1 to 10 tokens to up to three accounts, paying the fee and an excess.
    function airdrop(uint256 seed, uint256 count, uint256 total, uint256 overpay) external notingClaims {
        total = bound(total, 1, 10);
        count = bound(count, 1, 3);
        if (count > total) count = total;
        address[] memory to = new address[](count);
        uint256[] memory amounts = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            to[i] = _actor(seed % actors.length + i);
            amounts[i] = total / count + (i == 0 ? total % count : 0);
        }
        _airdrop(to, amounts, total, bound(overpay, 0, 1 ether));
    }

    /// @dev The creator airdrops 1 to 10 tokens to the dead address, paying the fee.
    function burn(uint256 amount) external notingClaims {
        amount = bound(amount, 1, 10);
        address[] memory to = new address[](1);
        to[0] = DEAD;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = amount;
        if (_airdrop(to, amounts, amount, 0)) burned += amount;
    }

    /// @dev The owner or the payout address withdraws the creator's balance, which only the payout address receives.
    function withdrawProceeds(bool byPayout) external notingClaims {
        address payout = collection.ownerPayoutAddress();
        uint256 owed = collection.creatorBalance();
        uint256 before = payout.balance;
        vm.prank(byPayout ? payout : creator);
        try collection.withdrawMintFunds() returns (uint256 paidOut) {
            proceedsWithdrawn += paidOut;
            proceedsReceived += payout.balance - before;
        } catch {
            if (owed > 0) proceedsWithdrawalRefused = true;
        }
    }

    /// @dev Anyone sends the platform balance to the factory's treasury.
    function withdrawFees(uint256 callerSeed) external notingClaims {
        address caller = _actor(callerSeed);
        uint256 owed = collection.platformBalance();
        uint256 before = _treasuryBalances();
        vm.prank(caller);
        try collection.withdrawPlatformFees() returns (uint256 paidOut) {
            feesWithdrawn += paidOut;
            feesReceived += _treasuryBalances() - before;
        } catch {
            if (owed > 0) feesWithdrawalRefused = true;
        }
    }

    function setTreasury(uint256 which) external notingClaims {
        address treasury = treasuries[which % treasuries.length];
        vm.prank(_admin());
        factory.setTreasury(treasury);
    }

    function setPayout(uint256 actorSeed) external notingClaims {
        address payout = _actor(actorSeed);
        vm.prank(creator);
        collection.setOwnerPayoutAddress(payout);
    }

    /// @dev The admin sets the collection's fees, up or down.
    function setFees(uint256 flat, uint256 bps, uint256 airdropFee) external notingClaims {
        flat = bound(flat, 0, 1 ether);
        bps = bound(bps, 0, 10_000);
        airdropFee = bound(airdropFee, 0, 1 ether);
        vm.prank(_admin());
        collection.setFees(flat, bps, airdropFee);
        (lastFlat, lastBps, lastAirdropFee) = (flat, bps, airdropFee);
    }

    /// @dev The creator or an account tries to set the fees, and must be refused.
    function setFeesAsStranger(uint256 callerSeed, uint256 flat, uint256 bps, uint256 airdropFee)
        external
        notingClaims
    {
        address caller = callerSeed % 6 == 5 ? creator : _actor(callerSeed);
        flat = bound(flat, 0, 1 ether);
        bps = bound(bps, 0, 10_000);
        airdropFee = bound(airdropFee, 0, 1 ether);
        vm.prank(caller);
        try collection.setFees(flat, bps, airdropFee) {
            strangerFeeChangeLanded = true;
        } catch {}
    }

    /// @dev The admin changes the factory's defaults, which the deployed collection must not take.
    function setFactoryFees(uint256 flat, uint256 bps, uint256 airdropFee) external notingClaims {
        flat = bound(flat, 0, 1 ether);
        bps = bound(bps, 0, 10_000);
        airdropFee = bound(airdropFee, 0, 1 ether);
        vm.prank(_admin());
        factory.setCollectionFees(flat, bps, airdropFee);
    }

    /// @dev The creator registers the next group id, 2 to 6, scheduled or not.
    function registerGroup(uint256 price, uint256 supply, uint256 start) external notingClaims {
        if (groupCount == MAX_GROUPS) return;
        price = bound(price, 0, 10 ether);
        supply = bound(supply, 0, 40);
        uint256 startTimestamp = start % 2 == 0 ? 0 : block.timestamp + bound(start, 1, 3_600);
        vm.prank(creator);
        try collection.registerMintGroup(groupCount, price, supply, startTimestamp) {
            closedSinceSchedule[groupCount] = false;
            groupCount++;
        } catch {}
    }

    function setPrice(uint256 group, uint256 price) external notingClaims {
        group %= groupCount;
        price = bound(price, 0, 10 ether);
        vm.prank(creator);
        collection.changeSalePrice(price, group);
    }

    function setStatus(uint256 group, bool open) external notingClaims {
        group %= groupCount;
        vm.prank(creator);
        collection.setMintGroupStatus(group, open);
        if (!open) closedSinceSchedule[group] = true;
    }

    function setGroupSupply(uint256 group, uint256 supply) external notingClaims {
        group %= groupCount;
        supply = bound(supply, 0, 200);
        vm.prank(creator);
        try collection.setMintGroupMaxSupply(group, supply) {} catch {}
    }

    /// @dev The creator schedules a start 1 to 3,600 s ahead, or clears it with 0; half the time on Public.
    function schedule(uint256 group, uint256 offset) external notingClaims {
        group = group % 2 == 0 ? PUBLIC : group % groupCount;
        offset = bound(offset, 0, 3_600);
        uint256 start = offset == 0 ? 0 : block.timestamp + offset;
        vm.prank(creator);
        collection.scheduleMintGroupStart(group, start);
        closedSinceSchedule[group] = false;
    }

    /// @dev The creator opens or closes every group at once.
    function setAll(bool open) external notingClaims {
        vm.prank(creator);
        collection.stopOrStartAllMintGroups(open);
        if (!open) {
            for (uint256 group = 0; group < groupCount; group++) {
                closedSinceSchedule[group] = true;
            }
        }
    }

    /// @dev Time moves 1 to 3,600 s, with a block. A quarter of the time it moves instead to the next start of a group
    ///      whose flag is off, the only kind a start can turn live: half of those moves exactly to that second, the
    ///      second the phase turns live, and half to the second before it, the last one it is not (Review Focus 5).
    function warp(uint256 seconds_) external notingClaims {
        uint256 next = type(uint256).max;
        for (uint256 group = 0; group < groupCount; group++) {
            uint256 start = collection.mintGroupStartTimestamp(group);
            if (!collection.mintGroupActiveFlag(group) && start > block.timestamp && start < next) next = start;
        }
        uint256 to = block.timestamp + bound(seconds_, 1, 3_600);
        if (seconds_ % 4 == 0 && next != type(uint256).max) to = seconds_ % 8 == 0 ? next : next - 1;
        vm.warp(to);
        vm.roll(block.number + 1);
    }

    /// @dev The creator writes quotas of 0 to 20 for 1 to 50 addresses (the minters first), or the last chunk again.
    function writeChunk(uint256 group, uint256 size, uint256 quota, bool again) external notingClaims {
        if (!again || lastChunk.length == 0) {
            group = 1 + group % (groupCount - 1);
            size = bound(size, 1, 50);
            delete lastChunk;
            delete lastQuotas;
            for (uint256 i = 0; i < size; i++) {
                lastChunk.push(
                    i < actors.length ? actors[i] : address(uint160(uint256(keccak256(abi.encode("chunk", i)))))
                );
                lastQuotas.push(uint256(keccak256(abi.encode(quota, i))) % 21);
            }
            lastChunkGroup = group;
        }
        vm.prank(creator);
        collection.setMintQuota(lastChunk, lastChunkGroup, lastQuotas);
    }

    function setPublicCap(uint256 cap) external notingClaims {
        cap = bound(cap, 0, 50);
        vm.prank(creator);
        collection.setPublicMaxMintPerWallet(cap);
    }

    function setMintOnBehalf(bool open) external notingClaims {
        vm.prank(creator);
        collection.setMintOnBehalfStatus(open);
    }

    /// @dev A vault delegates to a caller in the registry mock, or takes the delegation back.
    function delegate(uint256 vaultSeed, uint256 callerSeed, bool on) external notingClaims {
        address vault = _actor(vaultSeed);
        address caller = _actor(callerSeed);
        registry.setDelegate(vault, caller, on);
        if (on) delegateOf[vault] = caller;
        else if (delegateOf[vault] == caller) delegateOf[vault] = address(0);
    }

    /// @dev A token a minter holds moves to another minter.
    function transfer(uint256 tokenSeed, uint256 toSeed) external notingClaims {
        uint256 minted = collection.totalMinted();
        if (minted == 0) return;
        uint256 token = 1 + tokenSeed % minted;
        address owner = collection.ownerOf(token);
        if (owner == DEAD || owner == address(rejecter)) return;
        address to = _actor(toSeed);
        vm.prank(owner);
        collection.transferFrom(owner, to, token);
    }

    /// @dev Public, the group the last chunk named, or any registered group, a third of the time each.
    function _groupOf(uint256 seed) internal view returns (uint256) {
        if (seed % 3 == 0) return PUBLIC;
        if (seed % 3 == 1 && lastChunk.length > 0) return lastChunkGroup;
        return seed % groupCount;
    }

    /// @dev A mint judged against the rules as they stood when it was sent: the group live; `holder`'s cap or quota,
    ///      and the right to spend it (the on-behalf switch on, or the vault's delegation to `payer`), spending one
    ///      without that right counting as passing it; and the quote taken exactly from `payer`, the excess returned.
    function _mint(Kind kind, address payer, address holder, uint256 group, uint256 amount, uint256 overpay) internal {
        (uint256 cost, uint256 fee) = collection.quoteBatchMint(group, amount);
        bool live = collection.mintGroupActive(group);
        bool passes = group == PUBLIC
            ? collection.publicMints(holder) + amount > collection.publicMaxMintPerWallet()
            : collection.quotaClaimed(group, holder) + amount > collection.mintQuotas(group, holder);
        if (kind == Kind.OnBehalf && !collection.mintOnBehalfActive()) passes = true;
        if (kind == Kind.Delegate && !registry.checkDelegateForContract(payer, holder, address(collection), "")) {
            passes = true;
        }
        uint256 before = payer.balance;
        bool landed;
        vm.prank(payer);
        if (kind == Kind.Batch) {
            try collection.batchMint{value: cost + overpay}(amount, group) {
                landed = true;
            } catch {}
        } else if (kind == Kind.OnBehalf) {
            try collection.mintOnBehalf{value: cost + overpay}(amount, group, holder) {
                landed = true;
            } catch {}
        } else {
            try collection.delegateMint{value: cost + overpay}(amount, group, holder) {
                landed = true;
            } catch {}
        }
        if (!landed) return;
        if (!live) mintedWhileNotLive = true;
        if (passes) capOrQuotaPassed = true;
        if (payer.balance + cost != before) chargedOtherThanQuote = true;
        platformCharged += fee;
        proceedsCharged += cost - fee;
        if (group == PUBLIC) publicMintsOf[holder] += amount;
    }

    /// @dev An airdrop from the creator, who must pay exactly the fee, the excess returned.
    function _airdrop(address[] memory to, uint256[] memory amounts, uint256 total, uint256 overpay)
        internal
        returns (bool landed)
    {
        (,, uint256 perToken) = collection.fees();
        uint256 fee = perToken * total;
        uint256 before = creator.balance;
        vm.prank(creator);
        try collection.airdropNFTs{value: fee + overpay}(to, amounts) {
            landed = true;
        } catch {
            return false;
        }
        if (creator.balance + fee != before) chargedOtherThanQuote = true;
        platformCharged += fee;
        airdropped += total;
    }
}

contract InvariantsTest is BaseTest {
    /// @dev The suite's collection: 200 tokens, Public 120 and Allowlist 60, small enough that most runs sell it out.
    uint256 internal constant SUPPLY = 200;

    address internal admin2 = makeAddr("admin2");
    address internal admin3 = makeAddr("admin3");
    address internal treasury2 = makeAddr("treasury2");

    CollectionHandler internal handler;
    FactoryHandler internal factoryHandler;
    EtherRejecter internal rejecter;
    address[] internal holders;
    address[] internal admins;

    function setUp() public override {
        super.setUp();
        collection = _smallCollection();
        MockDelegateRegistry registry = _etchDelegateRegistry();
        rejecter = new EtherRejecter();
        vm.prank(creator);
        collection.stopOrStartAllMintGroups(true);

        Accounts memory accounts;
        accounts.actors = new address[](5);
        for (uint256 i = 0; i < 5; i++) {
            accounts.actors[i] = makeAddr(string(abi.encodePacked("actor", vm.toString(i))));
            holders.push(accounts.actors[i]);
        }
        holders.push(address(rejecter));
        accounts.creator = creator;
        admins.push(admin);
        admins.push(admin2);
        admins.push(admin3);
        accounts.admins = admins;
        accounts.treasuries = new address[](2);
        accounts.treasuries[0] = treasury;
        accounts.treasuries[1] = treasury2;

        handler = new CollectionHandler(collection, factory, registry, rejecter, accounts);
        factoryHandler = new FactoryHandler(factory, accounts);
        targetContract(address(handler));
        targetContract(address(factoryHandler));
    }

    /// @dev The suite's collection, deployed through the factory as the base test deploys its own.
    function _smallCollection() internal returns (CobwebCollection) {
        CobwebCollection.BaseVariables memory base = CobwebCollection.BaseVariables({
            name: "Cobweb Invariants",
            symbol: "CBW",
            ownerPayoutAddress: creatorPayout,
            initialBaseURI: "ipfs://unrevealed",
            maxSupply: SUPPLY
        });
        uint256[] memory supplies = new uint256[](2);
        supplies[0] = 120;
        supplies[1] = 60;
        uint256[] memory prices = new uint256[](2);
        prices[0] = PUBLIC_PRICE;
        prices[1] = ALLOWLIST_PRICE;
        bytes memory args = abi.encode(base, supplies, prices, PUBLIC_CAP, uint96(500), creator, royaltyReceiver);
        vm.prank(creator);
        return
            CobwebCollection(factory.deployCollection(type(CobwebCollection).creationCode, args, bytes32(uint256(2))));
    }

    /*//////////////////////////////////////////////////////////////
                         FEE CUSTODY AND PROCEEDS
    //////////////////////////////////////////////////////////////*/
    /// @dev Every wei the collection holds is owed to the creator, the platform or a refund held for an account the
    ///      handlers reach, which only EtherRejecter's failed refunds ever are; every mint and airdrop took exactly
    ///      its quote, the excess returned or held; and no claim of a held refund was refused.
    function invariant_balanceEqualsWhatIsOwed() public view {
        uint256 held = collection.pendingBalance(creator);
        for (uint256 i = 0; i < holders.length; i++) {
            held += collection.pendingBalance(holders[i]);
        }
        assertEq(address(collection).balance, collection.creatorBalance() + collection.platformBalance() + held);
        assertEq(collection.pendingBalance(address(rejecter)), handler.heldCredited() - handler.heldClaimed());
        assertEq(handler.heldReceived(), handler.heldClaimed());
        assertFalse(handler.chargedOtherThanQuote());
        assertFalse(handler.heldClaimRefused());
    }

    /// @dev Platform fees are owed or were withdrawn, only the treasuries received them, and no withdrawal of them was
    ///      refused.
    function invariant_platformFeesReachOnlyTheTreasury() public view {
        assertEq(handler.platformCharged(), collection.platformBalance() + handler.feesWithdrawn());
        assertEq(handler.feesReceived(), handler.feesWithdrawn());
        assertEq(treasury.balance + treasury2.balance, handler.feesReceived() + factoryHandler.artReceived());
        assertFalse(handler.feesWithdrawalRefused());
    }

    /// @dev Mint proceeds are owed or were withdrawn, only the payout address received them, whoever asked, and no
    ///      withdrawal of them was refused.
    function invariant_proceedsReachOnlyThePayout() public view {
        assertEq(handler.proceedsCharged(), collection.creatorBalance() + handler.proceedsWithdrawn());
        assertEq(handler.proceedsReceived(), handler.proceedsWithdrawn());
        assertFalse(handler.proceedsWithdrawalRefused());
    }

    /// @dev The fees are the admin's last setting, the factory's defaults at the deploy before any.
    function invariant_feesChangeOnlyByTheAdmin() public view {
        (uint256 flat, uint256 bps, uint256 airdropFee) = collection.fees();
        assertEq(flat, handler.lastFlat());
        assertEq(bps, handler.lastBps());
        assertEq(airdropFee, handler.lastAirdropFee());
        assertFalse(handler.strangerFeeChangeLanded());
    }

    /// @dev The factory holds what was paid for art and not withdrawn, and the treasury received what was.
    function invariant_artPaymentsHeldOrPaidToTheTreasury() public view {
        assertEq(address(factory).balance, factoryHandler.artPaid() - factoryHandler.artWithdrawn());
        assertEq(factoryHandler.artReceived(), factoryHandler.artWithdrawn());
        assertFalse(factoryHandler.repeatPaymentLanded());
        assertFalse(factoryHandler.withdrawalRefused());
    }

    /*//////////////////////////////////////////////////////////////
                                THE ADMINS
    //////////////////////////////////////////////////////////////*/
    function invariant_anAdminAlwaysRemains() public view {
        uint256 holding = 0;
        for (uint256 i = 0; i < admins.length; i++) {
            bool isAdmin = factory.isAdmin(admins[i]);
            assertEq(isAdmin, factoryHandler.adminRecord(admins[i]));
            if (isAdmin) holding++;
        }
        assertGt(holding, 0);
        assertFalse(factoryHandler.lastAdminRemoved());
    }

    /*//////////////////////////////////////////////////////////////
                               PHASE BOUNDS
    //////////////////////////////////////////////////////////////*/
    function invariant_supplyNeverExceedsMax() public view {
        assertLe(collection.totalMinted(), collection.maxSupply());
    }

    function invariant_groupMintsNeverExceedAllocation() public view {
        for (uint256 group = 0; group < handler.groupCount(); group++) {
            assertLe(collection.mintGroupMints(group), collection.mintGroupMaxSupply(group));
        }
    }

    function invariant_allocationsFitInCollection() public view {
        uint256 allocated = 0;
        for (uint256 group = 0; group < handler.groupCount(); group++) {
            allocated += collection.mintGroupMaxSupply(group);
        }
        assertLe(allocated, collection.maxSupply());
    }

    /// @dev A group is live by its flag or a reached start and nothing else, in both views; a group closed since its
    ///      last schedule has no start; and no mint landed in a group that was not live when it was sent.
    function invariant_liveOnlyByFlagOrStart() public view {
        CobwebCollection.CollectionState memory state = collection.collectionState();
        assertEq(state.groups.length, handler.groupCount());
        for (uint256 group = 0; group < handler.groupCount(); group++) {
            uint256 start = collection.mintGroupStartTimestamp(group);
            bool live = collection.mintGroupActiveFlag(group) || (start != 0 && block.timestamp >= start);
            assertEq(collection.mintGroupActive(group), live);
            assertEq(state.groups[group].id, group);
            assertEq(state.groups[group].active, live);
            if (handler.closedSinceSchedule(group)) assertEq(start, 0);
        }
        assertFalse(handler.mintedWhileNotLive());
    }

    /// @dev No mint passed the public cap or a quota as they stood when it landed, or spent one without the right to
    ///      (the on-behalf switch off, no delegation), and no claimed count went down, a chunk written again included.
    function invariant_capsAndQuotasHeld() public view {
        assertFalse(handler.capOrQuotaPassed());
        assertFalse(handler.claimedWentDown());
    }

    /*//////////////////////////////////////////////////////////////
                             OWNERSHIP COUNTS
    //////////////////////////////////////////////////////////////*/
    function invariant_everyTokenCameFromAGroupOrAnAirdrop() public view {
        uint256 fromGroups = 0;
        for (uint256 group = 0; group < handler.groupCount(); group++) {
            fromGroups += collection.mintGroupMints(group);
        }
        assertEq(collection.totalMinted(), fromGroups + handler.airdropped());
    }

    /// @dev Every token is held by an account the handlers reach, the dead address holds exactly the burned ones,
    ///      and each account's public mints are those counted against it.
    function invariant_ownershipAddsUp() public view {
        uint256 held = collection.balanceOf(DEAD);
        for (uint256 i = 0; i < holders.length; i++) {
            held += collection.balanceOf(holders[i]);
            assertEq(collection.publicMints(holders[i]), handler.publicMintsOf(holders[i]));
        }
        assertEq(held, collection.totalSupply());
        assertEq(collection.totalSupply(), collection.totalMinted());
        assertEq(collection.balanceOf(DEAD), handler.burned());
    }
}
