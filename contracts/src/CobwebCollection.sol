// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {ERC721AC} from "@creator-token-standards/erc721c/ERC721AC.sol";
import {ERC721A} from "erc721a/contracts/ERC721A.sol";
import {ICobwebFactory} from "./interfaces/ICobwebFactory.sol";
import {IDelegateRegistry} from "./interfaces/IDelegateRegistry.sol";

/**
 * @title CobwebCollection
 * @notice Creator-owned ERC721AC collection with multi-group minting, a public per-wallet cap,
 *         allowlist quotas, airdrops, delegated minting, ERC2981 royalties and platform fees.
 * @dev Deployed through CobwebFactory. Three actors: the minter, who pays the mint price plus the
 *      platform fee; the creator (`owner`), who receives the mint price and controls the sale; and the
 *      platform, which receives the fees and whose admins can change this collection's fee rates.
 * @dev Nothing here is immutable or chain-specific, so runtime bytecode is identical for every
 *      collection and explorer verification happens once per chain.
 */
contract CobwebCollection is ERC721AC, ERC2981, Ownable, ReentrancyGuard {
    struct BaseVariables {
        string name;
        string symbol;
        address ownerPayoutAddress;
        string initialBaseURI;
        uint256 maxSupply;
    }

    struct MintGroupInfo {
        uint256 id;
        uint256 price;
        uint256 maxSupply;
        uint256 minted;
        uint256 startTimestamp;
        /// @dev The raw open/closed flag
        bool activeFlag;
        /// @dev The effective state: flag on, or scheduled start reached
        bool active;
    }

    struct CollectionState {
        uint256 maxSupply;
        uint256 totalMinted;
        uint256 publicMaxMintPerWallet;
        uint256 mintFeeFlat;
        uint256 mintFeeBps;
        uint256 airdropFeePerToken;
        bool mintOnBehalfActive;
        /// @dev Timestamp of the block this was read at, so readers never need their own clock
        uint256 blockTimestamp;
        MintGroupInfo[] groups;
    }

    /*//////////////////////////////////////////////////////////////
                                 ERRORS
    //////////////////////////////////////////////////////////////*/
    error AddressZero();
    error Unauthorized(address caller);
    error ArrayLengthMismatch();
    error ZeroAmount();
    error NoMintGroups();
    error AllocationsExceedMaxSupply();
    error BelowMinted(uint256 minted);
    error FeeBpsTooHigh(uint256 bps);
    error MintOnBehalfNotActive();
    error NotDelegate(address caller, address vault);
    error PublicGroupHasNoQuota();
    error MintGroupInactive(uint256 mintGroup);
    error MintGroupDoesNotExist(uint256 mintGroup);
    error MintGroupAlreadyExists(uint256 mintGroup);
    error NotInWhitelist(address caller, uint256 mintGroup);
    error ExceedsMaxSupply(uint256 requested, uint256 available);
    error ExceedsMintGroupMaxSupply(uint256 requested, uint256 available);
    error ExceedsPublicMaxPerWallet(uint256 requested, uint256 allowed);
    error ExceedsMintQuota(uint256 requested, uint256 allowed);
    error InsufficientEther(uint256 required, uint256 provided);
    error NothingToWithdraw();
    error WithdrawFailed();

    /*//////////////////////////////////////////////////////////////
                                 EVENTS
    //////////////////////////////////////////////////////////////*/
    event BatchMetadataUpdate(uint256 indexed fromTokenId, uint256 indexed toTokenId);
    event TokensMinted(address indexed recipient, uint256 amount, uint256 mintGroup);
    event TokensDelegateMinted(address indexed vault, address indexed recipient, uint256 amount, uint256 mintGroup);
    event SalePriceChanged(uint256 indexed mintGroup, uint256 newPrice);
    event PublicMaxMintPerWalletChanged(uint256 newMaxMintPerWallet);
    event MintGroupStatusChanged(uint256 indexed mintGroup, bool status);
    event AllMintGroupsStatusChanged(bool status, uint256 groupsAffected);
    event MintGroupStartTimestampChanged(uint256 indexed mintGroup, uint256 timestamp);
    event MintQuotasAdded(uint256 mintGroup, uint256 numberOfAddresses);
    event MintOnBehalfUpdated(bool newStatus);
    event MintGroupMaxSupplyUpdated(uint256 indexed mintGroup, uint256 newMaxSupply);
    event MintGroupRegistered(uint256 indexed mintGroup);
    event OwnerPayoutAddressUpdated(address newOwnerPayoutAddress);
    event DefaultRoyaltyUpdated(address receiver, uint96 feeNumerator);
    event TokenRoyaltyUpdated(uint256 tokenId, address receiver, uint96 feeNumerator);
    event NFTsAirdropped(uint256 recipients, uint256 amount, uint256 feePaid);
    event MintFundsWithdrawn(address indexed payoutAddress, uint256 amount);
    event PlatformFeesWithdrawn(address indexed treasury, uint256 amount);
    event FeesUpdated(uint256 mintFeeFlat, uint256 mintFeeBps, uint256 airdropFeePerToken);

    /*//////////////////////////////////////////////////////////////
                           STORAGE VARIABLES
    //////////////////////////////////////////////////////////////*/
    /// @dev Mint group 0 is the open public sale: it is capped per wallet rather than by an
    ///      allowlist quota. It is gated by the same open/closed switch as every other group.
    uint256 private constant PUBLIC_MINT_GROUP = 0;
    uint256 private constant MAX_BPS = 10_000;
    /// @dev Tokens minted per ERC721A batch. ERC721A finds a token's owner by scanning back to the
    ///      start of its batch, so one huge batch would make its last tokens costly to transfer.
    uint256 private constant MINT_CHUNK = 20;
    /// @dev EIP-4906 (metadata update extension), reported by supportsInterface.
    bytes4 private constant INTERFACE_ID_ERC4906 = 0x49064906;
    /// @dev delegate.xyz v2 registry. Same address on every chain it is deployed to.
    IDelegateRegistry private constant DELEGATE_REGISTRY =
        IDelegateRegistry(0x00000000000000447e69651d841bD8D104Bed493);

    /// @dev The factory that deployed this collection. Storage, not immutable, so that runtime
    ///      bytecode stays identical across collections.
    address private s_factory;
    uint256 private s_maxSupply;
    uint256 private s_publicMaxMintPerWallet;
    uint256[] private s_mintGroups;
    bool private s_mintOnBehalfActive;
    string private s_baseURI;
    address private s_ownerPayoutAddress;

    /// @dev Platform fee rates. Copied from the factory at deployment; changeable by platform admins.
    uint256 private s_mintFeeFlat;
    uint256 private s_mintFeeBps;
    uint256 private s_airdropFeePerToken;
    /// @dev Platform fees collected and not yet withdrawn to the treasury.
    uint256 private s_platformBalance;
    /// @dev Mint proceeds owed to the creator. Kept apart from the refund ledger so that changing
    ///      the payout address can never move anyone else's money.
    uint256 private s_creatorBalance;

    /*//////////////////////////////////////////////////////////////
                                MAPPINGS
    //////////////////////////////////////////////////////////////*/
    /// @dev Refunds whose push failed, claimable by the address they belong to.
    mapping(address => uint256) private s_pendingBalances;
    mapping(uint256 => bool) private s_mintGroupExists;
    mapping(uint256 => uint256) private s_mintPrice;
    mapping(uint256 => uint256) private s_mintGroupMaxSupply;
    mapping(uint256 => uint256) private s_mintGroupMints;
    mapping(uint256 => uint256) private s_mintGroupStartTimestamp;
    mapping(uint256 => bool) private s_mintGroupActive;
    /// @dev Tokens an address has minted from the public group, counted against the per-wallet cap.
    mapping(address => uint256) private s_publicMints;
    /// @dev The allowance ISSUED to an address, not a decaying remainder. Re-uploading an
    ///      allowlist therefore restates the same allocation instead of re-granting spent quota.
    mapping(uint256 => mapping(address => uint256)) private s_mintQuotas;
    /// @dev How much of the issued allowance has been claimed: remaining = issued - claimed.
    mapping(uint256 => mapping(address => uint256)) private s_quotaClaimed;

    /*//////////////////////////////////////////////////////////////
                               MODIFIERS
    //////////////////////////////////////////////////////////////*/
    modifier onlyPlatformAdmin() {
        if (!ICobwebFactory(s_factory).isAdmin(msg.sender)) revert Unauthorized(msg.sender);
        _;
    }

    /*//////////////////////////////////////////////////////////////
                               FUNCTIONS
    //////////////////////////////////////////////////////////////*/
    /**
     * @param baseVariables Name, symbol, creator payout address, initial base URI and max supply
     * @param mintGroupMaxSupplies_ Supply allocation per initial mint group; index 0 is the public group
     * @param mintPrice_ Price per initial mint group, same order
     * @param publicMaxMintPerWallet_ Lifetime per-wallet cap for the public group
     * @param royaltyPercentage Default royalty in basis points
     * @param owner_ The creator
     * @param royaltyPayoutAddress Default royalty receiver
     * @dev The deployer must be the factory: fee rates are read from `msg.sender`, so they cannot be
     *      supplied by whoever asks the factory to deploy.
     */
    constructor(
        BaseVariables memory baseVariables,
        uint256[] memory mintGroupMaxSupplies_,
        uint256[] memory mintPrice_,
        uint256 publicMaxMintPerWallet_,
        uint96 royaltyPercentage,
        address owner_,
        address royaltyPayoutAddress
    ) ERC721AC(baseVariables.name, baseVariables.symbol) Ownable(owner_) {
        uint256 groupCount = mintGroupMaxSupplies_.length;
        if (mintPrice_.length != groupCount) revert ArrayLengthMismatch();
        // Index 0 configures the public mint group, so at least one entry is required.
        if (groupCount == 0) revert NoMintGroups();
        if (baseVariables.ownerPayoutAddress == address(0)) revert AddressZero();

        uint256 totalAllocatedSupply = 0;
        for (uint256 i = 0; i < groupCount; i++) {
            totalAllocatedSupply += mintGroupMaxSupplies_[i];
            s_mintGroupMaxSupply[i] = mintGroupMaxSupplies_[i];
            s_mintPrice[i] = mintPrice_[i];
            s_mintGroupExists[i] = true;
            s_mintGroups.push(i);
        }
        if (totalAllocatedSupply > baseVariables.maxSupply) revert AllocationsExceedMaxSupply();

        // Every group, the public sale included, starts closed. The owner opens them explicitly.
        s_maxSupply = baseVariables.maxSupply;
        s_baseURI = baseVariables.initialBaseURI;
        s_ownerPayoutAddress = baseVariables.ownerPayoutAddress;
        s_publicMaxMintPerWallet = publicMaxMintPerWallet_;

        s_factory = msg.sender;
        (s_mintFeeFlat, s_mintFeeBps, s_airdropFeePerToken) = ICobwebFactory(msg.sender).collectionFees();

        _setDefaultRoyalty(royaltyPayoutAddress, royaltyPercentage);
    }

    /*//////////////////////////////////////////////////////////////
                             MINT FUNCTIONS
    //////////////////////////////////////////////////////////////*/
    /**
     * @notice Mints NFTs to the caller from a mint group
     * @param amount Number of NFTs to mint
     * @param mintGroup Id of the mint group
     * @return totalCost Mint price plus platform fee charged; any excess sent is refunded
     */
    function batchMint(uint256 amount, uint256 mintGroup) external payable nonReentrant returns (uint256 totalCost) {
        totalCost = _batchMint(msg.sender, amount, mintGroup, msg.sender);
        emit TokensMinted(msg.sender, amount, mintGroup);
        _refundExcessEther(totalCost);
    }

    /**
     * @notice Mints NFTs to a receiver, paid for by the caller and counted against the receiver's
     *         own cap or quota
     * @param amount Number of NFTs to mint
     * @param mintGroup Id of the mint group
     * @param receiver The address that receives the NFTs and whose allowance is used
     */
    function mintOnBehalf(uint256 amount, uint256 mintGroup, address receiver)
        external
        payable
        nonReentrant
        returns (uint256 totalCost)
    {
        if (!s_mintOnBehalfActive) revert MintOnBehalfNotActive();
        totalCost = _batchMint(receiver, amount, mintGroup, receiver);
        emit TokensMinted(receiver, amount, mintGroup);
        _refundExcessEther(totalCost);
    }

    /**
     * @notice Mints NFTs to the caller using a vault's cap or quota, where the vault has delegated
     *         to the caller through delegate.xyz
     * @dev Accepts a whole-wallet delegation or one scoped to this contract. Reverts on a chain
     *      where the delegate.xyz registry is not deployed.
     * @param amount Number of NFTs to mint
     * @param mintGroup Id of the mint group
     * @param vault The address whose allowance is used
     */
    function delegateMint(uint256 amount, uint256 mintGroup, address vault)
        external
        payable
        nonReentrant
        returns (uint256 totalCost)
    {
        if (!DELEGATE_REGISTRY.checkDelegateForContract(msg.sender, vault, address(this), "")) {
            revert NotDelegate(msg.sender, vault);
        }
        totalCost = _batchMint(vault, amount, mintGroup, msg.sender);
        emit TokensDelegateMinted(vault, msg.sender, amount, mintGroup);
        _refundExcessEther(totalCost);
    }

    /*//////////////////////////////////////////////////////////////
                              WITHDRAWALS
    //////////////////////////////////////////////////////////////*/
    /**
     * @notice Withdraws the accumulated mint proceeds to the owner payout address
     * @dev Callable by the owner or the payout address itself.
     */
    function withdrawMintFunds() external nonReentrant returns (uint256 payout) {
        address payoutAddress = s_ownerPayoutAddress;
        if (msg.sender != owner() && msg.sender != payoutAddress) revert Unauthorized(msg.sender);
        payout = s_creatorBalance;
        if (payout == 0) revert NothingToWithdraw();
        s_creatorBalance = 0;
        _send(payoutAddress, payout);
        emit MintFundsWithdrawn(payoutAddress, payout);
    }

    /**
     * @notice Claims the caller's own pending balance, credited when a refund push failed
     */
    function withdrawPendingBalance() external nonReentrant returns (uint256 payout) {
        payout = _withdrawPending(msg.sender);
    }

    /**
     * @notice Claims the caller's own pending balance to another address
     * @dev For a caller that cannot receive the native token itself, which is why its refund failed.
     */
    function withdrawPendingBalanceTo(address to) external nonReentrant returns (uint256 payout) {
        if (to == address(0)) revert AddressZero();
        payout = _withdrawPending(to);
    }

    /**
     * @notice Sends the collected platform fees to the factory's current treasury
     * @dev Callable by anyone: the destination is fixed by the factory, so there is nothing to gain
     *      by calling it, and the creator's own withdrawal never depends on it.
     */
    function withdrawPlatformFees() external nonReentrant returns (uint256 payout) {
        payout = s_platformBalance;
        if (payout == 0) revert NothingToWithdraw();
        s_platformBalance = 0;
        address treasury = ICobwebFactory(s_factory).treasury();
        _send(treasury, payout);
        emit PlatformFeesWithdrawn(treasury, payout);
    }

    /*//////////////////////////////////////////////////////////////
                            OWNER FUNCTIONS
    //////////////////////////////////////////////////////////////*/
    /**
     * @notice Registers a new mint group and configures it in one call
     * @dev Registration is explicit: the setters reject unknown groups rather than creating them, so
     *      a mistyped id reverts instead of adding a group that can never be removed. The group is
     *      registered closed; it opens by setMintGroupStatus or once a non-zero startTimestamp passes.
     * @param mintGroup Id of the group to register
     * @param price Mint price per token
     * @param maxSupply_ Supply allocation for the group
     * @param startTimestamp Scheduled start, or 0 for none
     */
    function registerMintGroup(uint256 mintGroup, uint256 price, uint256 maxSupply_, uint256 startTimestamp)
        external
        onlyOwner
    {
        if (s_mintGroupExists[mintGroup]) revert MintGroupAlreadyExists(mintGroup);
        s_mintGroupExists[mintGroup] = true;
        s_mintGroups.push(mintGroup);
        emit MintGroupRegistered(mintGroup);

        s_mintPrice[mintGroup] = price;
        emit SalePriceChanged(mintGroup, price);
        _setMintGroupMaxSupply(mintGroup, maxSupply_);
        if (startTimestamp != 0) {
            s_mintGroupStartTimestamp[mintGroup] = startTimestamp;
            emit MintGroupStartTimestampChanged(mintGroup, startTimestamp);
        }
    }

    /**
     * @notice Sets the per-address mint quota for an allowlist group
     * @dev Quotas apply to groups 1 and up; the public group is capped by publicMaxMintPerWallet.
     *      A quota is the total issued to the address, so sending the same list twice is harmless.
     * @param addressesToAdd Addresses whose quota is being set
     * @param mintGroup Id of the allowlist group
     * @param mintQuotas_ Quota per address, same order
     */
    function setMintQuota(address[] calldata addressesToAdd, uint256 mintGroup, uint256[] calldata mintQuotas_)
        external
        onlyOwner
    {
        uint256 length = addressesToAdd.length;
        if (length != mintQuotas_.length) revert ArrayLengthMismatch();
        if (mintGroup == PUBLIC_MINT_GROUP) revert PublicGroupHasNoQuota();
        _requireMintGroupExists(mintGroup);

        for (uint256 i = 0; i < length; i++) {
            s_mintQuotas[mintGroup][addressesToAdd[i]] = mintQuotas_[i];
        }
        emit MintQuotasAdded(mintGroup, length);
    }

    /**
     * @notice Sets the lifetime per-wallet mint cap for the public group (0)
     * @dev Cumulative across transactions, not per batch.
     */
    function setPublicMaxMintPerWallet(uint256 newPublicMaxMintPerWallet) external onlyOwner {
        s_publicMaxMintPerWallet = newPublicMaxMintPerWallet;
        emit PublicMaxMintPerWalletChanged(newPublicMaxMintPerWallet);
    }

    /**
     * @notice Turns mintOnBehalf on or off
     */
    function setMintOnBehalfStatus(bool status) external onlyOwner {
        s_mintOnBehalfActive = status;
        emit MintOnBehalfUpdated(status);
    }

    /**
     * @notice Changes the mint price of a mint group
     */
    function changeSalePrice(uint256 newMintPrice, uint256 mintGroup) external onlyOwner {
        _requireMintGroupExists(mintGroup);
        s_mintPrice[mintGroup] = newMintPrice;
        emit SalePriceChanged(mintGroup, newMintPrice);
    }

    /**
     * @notice Sets how many tokens a mint group may sell in total
     * @dev A supply allocation for the whole group, not a per-wallet limit. It cannot go below what
     *      the group has already minted, and all allocations together must fit in the collection.
     */
    function setMintGroupMaxSupply(uint256 mintGroup, uint256 newMaxSupply) external onlyOwner {
        _requireMintGroupExists(mintGroup);
        _setMintGroupMaxSupply(mintGroup, newMaxSupply);
    }

    /**
     * @notice Opens or closes minting for a single mint group, the public sale (group 0) included
     * @dev Closing also clears the group's scheduled start, otherwise an earlier schedule would
     *      reopen the group the moment its timestamp passed.
     */
    function setMintGroupStatus(uint256 mintGroup, bool status) external onlyOwner {
        _requireMintGroupExists(mintGroup);
        _setMintGroupStatus(mintGroup, status);
    }

    /**
     * @notice Opens or closes every registered mint group at once
     * @dev Idempotent, so an emergency halt never reverts because the state already matched. Emits
     *      the per-group event for each group, as individual calls would.
     */
    function stopOrStartAllMintGroups(bool status) external onlyOwner {
        uint256 length = s_mintGroups.length;
        for (uint256 i = 0; i < length; i++) {
            _setMintGroupStatus(s_mintGroups[i], status);
        }
        emit AllMintGroupsStatusChanged(status, length);
    }

    /**
     * @notice Schedules when a mint group opens on its own, without a further transaction
     * @dev The group is open from the first block whose timestamp is at or after startTimestamp.
     *      Pass 0 to clear a schedule.
     */
    function scheduleMintGroupStart(uint256 mintGroup, uint256 startTimestamp) external onlyOwner {
        _requireMintGroupExists(mintGroup);
        s_mintGroupStartTimestamp[mintGroup] = startTimestamp;
        emit MintGroupStartTimestampChanged(mintGroup, startTimestamp);
    }

    /**
     * @notice Sets the base URI for token metadata. Used for reveal.
     * @dev A base URI ending in "/" has the token id appended; any other base URI is returned as-is
     *      for every token.
     */
    function setBaseURI(string calldata newBaseURI) external onlyOwner {
        s_baseURI = newBaseURI;
        emit BatchMetadataUpdate(1, type(uint256).max);
    }

    /**
     * @notice Changes where the creator's mint proceeds are paid out
     */
    function setOwnerPayoutAddress(address newOwnerPayoutAddress) external onlyOwner {
        if (newOwnerPayoutAddress == address(0)) revert AddressZero();
        s_ownerPayoutAddress = newOwnerPayoutAddress;
        emit OwnerPayoutAddressUpdated(newOwnerPayoutAddress);
    }

    /**
     * @notice Sets the default royalty receiver and fee for all tokens
     * @param feeNumerator Royalty in basis points (250 = 2.5%)
     */
    function setDefaultRoyalty(address receiver, uint96 feeNumerator) external onlyOwner {
        _setDefaultRoyalty(receiver, feeNumerator);
        emit DefaultRoyaltyUpdated(receiver, feeNumerator);
    }

    /**
     * @notice Sets the royalty receiver and fee for one token, overriding the default
     */
    function setTokenRoyalty(uint256 tokenId, address receiver, uint96 feeNumerator) external onlyOwner {
        _setTokenRoyalty(tokenId, receiver, feeNumerator);
        emit TokenRoyaltyUpdated(tokenId, receiver, feeNumerator);
    }

    /**
     * @notice Airdrops NFTs to recipients, for the platform's per-token airdrop fee
     * @dev Airdrops consume total supply but are not counted against any mint group allocation.
     *      Burning is an airdrop to the dead address: those tokens still count as minted.
     * @param recipients Addresses to receive NFTs
     * @param amounts Number of NFTs per recipient, same order
     */
    function airdropNFTs(address[] calldata recipients, uint256[] calldata amounts)
        external
        payable
        onlyOwner
        nonReentrant
    {
        uint256 length = recipients.length;
        if (length != amounts.length) revert ArrayLengthMismatch();

        uint256 total = 0;
        for (uint256 i = 0; i < length; i++) {
            total += amounts[i];
        }
        // _totalMinted() rather than totalSupply(): the ceiling counts tokens ever minted.
        uint256 minted = _totalMinted();
        if (minted + total > s_maxSupply) revert ExceedsMaxSupply(total, s_maxSupply - minted);

        uint256 fee = s_airdropFeePerToken * total;
        if (msg.value < fee) revert InsufficientEther(fee, msg.value);
        s_platformBalance += fee;

        for (uint256 j = 0; j < length; j++) {
            _mintInChunks(recipients[j], amounts[j]);
        }
        emit NFTsAirdropped(length, total, fee);
        _refundExcessEther(fee);
    }

    /*//////////////////////////////////////////////////////////////
                        PLATFORM ADMIN FUNCTIONS
    //////////////////////////////////////////////////////////////*/
    /**
     * @notice Changes this collection's platform fee rates, up or down
     * @dev Callable only by an admin of the factory that deployed this collection.
     * @param mintFeeFlat Flat fee per minted token, in the native token
     * @param mintFeeBps Share of the mint price, in basis points
     * @param airdropFeePerToken Fee per airdropped token, in the native token
     */
    function setFees(uint256 mintFeeFlat, uint256 mintFeeBps, uint256 airdropFeePerToken) external onlyPlatformAdmin {
        if (mintFeeBps > MAX_BPS) revert FeeBpsTooHigh(mintFeeBps);
        s_mintFeeFlat = mintFeeFlat;
        s_mintFeeBps = mintFeeBps;
        s_airdropFeePerToken = airdropFeePerToken;
        emit FeesUpdated(mintFeeFlat, mintFeeBps, airdropFeePerToken);
    }

    /*//////////////////////////////////////////////////////////////
                             VIEW FUNCTIONS
    //////////////////////////////////////////////////////////////*/
    /**
     * @notice Everything a mint page needs about the collection, in one call
     * @dev Includes the block timestamp so a reader can compare schedules against chain time.
     */
    function collectionState() external view returns (CollectionState memory state) {
        uint256 length = s_mintGroups.length;
        MintGroupInfo[] memory groups = new MintGroupInfo[](length);
        for (uint256 i = 0; i < length; i++) {
            uint256 id = s_mintGroups[i];
            groups[i] = MintGroupInfo({
                id: id,
                price: s_mintPrice[id],
                maxSupply: s_mintGroupMaxSupply[id],
                minted: s_mintGroupMints[id],
                startTimestamp: s_mintGroupStartTimestamp[id],
                activeFlag: s_mintGroupActive[id],
                active: mintGroupActive(id)
            });
        }
        state = CollectionState({
            maxSupply: s_maxSupply,
            totalMinted: _totalMinted(),
            publicMaxMintPerWallet: s_publicMaxMintPerWallet,
            mintFeeFlat: s_mintFeeFlat,
            mintFeeBps: s_mintFeeBps,
            airdropFeePerToken: s_airdropFeePerToken,
            mintOnBehalfActive: s_mintOnBehalfActive,
            blockTimestamp: block.timestamp,
            groups: groups
        });
    }

    /**
     * @notice A wallet's standing in every mint group, in one call
     * @return publicMinted Tokens the wallet has minted from the public group
     * @return groupIds Every registered group id
     * @return quotaIssued Allowance issued to the wallet per group, same order (0 for the public group)
     * @return quotaClaimed_ Allowance already used per group, same order
     */
    function walletState(address wallet)
        external
        view
        returns (
            uint256 publicMinted,
            uint256[] memory groupIds,
            uint256[] memory quotaIssued,
            uint256[] memory quotaClaimed_
        )
    {
        uint256 length = s_mintGroups.length;
        groupIds = s_mintGroups;
        quotaIssued = new uint256[](length);
        quotaClaimed_ = new uint256[](length);
        for (uint256 i = 0; i < length; i++) {
            quotaIssued[i] = s_mintQuotas[groupIds[i]][wallet];
            quotaClaimed_[i] = s_quotaClaimed[groupIds[i]][wallet];
        }
        publicMinted = s_publicMints[wallet];
    }

    /**
     * @notice Whether a mint group is open, either by explicit flag or by a scheduled start that has
     *         been reached
     * @dev The only gate on minting. It applies to every group, the public sale included.
     */
    function mintGroupActive(uint256 mintGroup) public view returns (bool) {
        if (s_mintGroupActive[mintGroup]) return true;
        uint256 start = s_mintGroupStartTimestamp[mintGroup];
        return start != 0 && block.timestamp >= start;
    }

    /**
     * @notice Quotes the total cost of minting from a group
     * @return totalCost What the minter must send: mint price plus platform fee, for all tokens
     * @return platformFee The platform's part of totalCost
     */
    function quoteBatchMint(uint256 mintGroup, uint256 amount)
        public
        view
        returns (uint256 totalCost, uint256 platformFee)
    {
        uint256 price = s_mintPrice[mintGroup];
        platformFee = (s_mintFeeFlat + (price * s_mintFeeBps) / MAX_BPS) * amount;
        totalCost = price * amount + platformFee;
    }

    /**
     * @notice Checks whether a mint would pass, without sending it
     * @return ok True if the mint would pass the group, cap, quota and supply checks
     * @return reason Name of the failing check, or empty
     */
    function canMintCheck(uint256 amount, uint256 mintGroup, address minterAddress)
        external
        view
        returns (bool ok, string memory reason)
    {
        if (amount == 0) return (false, "ZeroAmount");
        if (!mintGroupActive(mintGroup)) return (false, "MintGroupInactive");

        if (mintGroup == PUBLIC_MINT_GROUP) {
            if (amount + s_publicMints[minterAddress] > s_publicMaxMintPerWallet) {
                return (false, "ExceedsPublicMaxPerWallet");
            }
        } else {
            uint256 issued = s_mintQuotas[mintGroup][minterAddress];
            if (issued == 0) return (false, "NotInWhitelist");
            if (amount + s_quotaClaimed[mintGroup][minterAddress] > issued) return (false, "ExceedsMintQuota");
        }

        if (s_mintGroupMints[mintGroup] + amount > s_mintGroupMaxSupply[mintGroup]) {
            return (false, "ExceedsMintGroupMaxSupply");
        }
        if (_totalMinted() + amount > s_maxSupply) return (false, "ExceedsMaxSupply");
        return (true, "");
    }

    function factory() external view returns (address) {
        return s_factory;
    }

    function maxSupply() external view returns (uint256) {
        return s_maxSupply;
    }

    function totalMinted() external view returns (uint256) {
        return _totalMinted();
    }

    function publicMaxMintPerWallet() external view returns (uint256) {
        return s_publicMaxMintPerWallet;
    }

    /// @notice Ids of every registered mint group, open or closed
    function mintGroups() external view returns (uint256[] memory) {
        return s_mintGroups;
    }

    function mintOnBehalfActive() external view returns (bool) {
        return s_mintOnBehalfActive;
    }

    function baseURI() external view returns (string memory) {
        return s_baseURI;
    }

    function ownerPayoutAddress() external view returns (address) {
        return s_ownerPayoutAddress;
    }

    /// @notice This collection's platform fee rates
    function fees() external view returns (uint256 mintFeeFlat, uint256 mintFeeBps, uint256 airdropFeePerToken) {
        return (s_mintFeeFlat, s_mintFeeBps, s_airdropFeePerToken);
    }

    /// @notice Platform fees collected and not yet withdrawn
    function platformBalance() external view returns (uint256) {
        return s_platformBalance;
    }

    function mintPrice(uint256 mintGroup) external view returns (uint256) {
        return s_mintPrice[mintGroup];
    }

    function mintGroupMaxSupply(uint256 mintGroup) external view returns (uint256) {
        return s_mintGroupMaxSupply[mintGroup];
    }

    function mintGroupMints(uint256 mintGroup) external view returns (uint256) {
        return s_mintGroupMints[mintGroup];
    }

    function mintGroupStartTimestamp(uint256 mintGroup) external view returns (uint256) {
        return s_mintGroupStartTimestamp[mintGroup];
    }

    /// @notice The raw open/closed flag, ignoring any scheduled start. Use mintGroupActive for the
    ///         effective state.
    function mintGroupActiveFlag(uint256 mintGroup) external view returns (bool) {
        return s_mintGroupActive[mintGroup];
    }

    /// @notice Whether a mint group is registered, whether or not it is currently open
    function mintGroupExists(uint256 mintGroup) external view returns (bool) {
        return s_mintGroupExists[mintGroup];
    }

    /// @notice Tokens an address has minted from the public group
    function publicMints(address minter) external view returns (uint256) {
        return s_publicMints[minter];
    }

    /// @notice The allowance issued to an address for a group. Does not shrink as it is used.
    function mintQuotas(uint256 mintGroup, address minter) external view returns (uint256) {
        return s_mintQuotas[mintGroup][minter];
    }

    /// @notice How much of an address's issued allowance has already been minted
    function quotaClaimed(uint256 mintGroup, address minter) external view returns (uint256) {
        return s_quotaClaimed[mintGroup][minter];
    }

    /// @notice How much of an address's issued allowance is still mintable
    function quotaRemaining(uint256 mintGroup, address minter) external view returns (uint256) {
        uint256 issued = s_mintQuotas[mintGroup][minter];
        uint256 claimed = s_quotaClaimed[mintGroup][minter];
        return issued > claimed ? issued - claimed : 0;
    }

    /// @notice A failed refund waiting to be claimed by an address
    function pendingBalance(address user) external view returns (uint256) {
        return s_pendingBalances[user];
    }

    /// @notice Mint proceeds owed to the creator and not yet withdrawn
    function creatorBalance() external view returns (uint256) {
        return s_creatorBalance;
    }

    /**
     * @notice Whether an operator may move all of an owner's tokens
     * @dev ERC721AC lets the creator auto-approve the transfer validator for every holder. That is
     *      honoured only for Limit Break's default validator. If the creator installs any other
     *      validator contract, it gets no approval a holder did not give it, so it cannot be used to
     *      move holders' tokens.
     */
    function isApprovedForAll(address owner, address operator) public view virtual override returns (bool) {
        if (operator != DEFAULT_TRANSFER_VALIDATOR && operator == getTransferValidator()) {
            return ERC721A.isApprovedForAll(owner, operator);
        }
        return super.isApprovedForAll(owner, operator);
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721AC, ERC2981) returns (bool) {
        // ERC4906 is reported explicitly: setBaseURI emits BatchMetadataUpdate, and marketplaces
        // gate their metadata-refresh handling on this interface id.
        return interfaceId == INTERFACE_ID_ERC4906 || ERC721AC.supportsInterface(interfaceId)
            || ERC2981.supportsInterface(interfaceId);
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        if (!_exists(tokenId)) revert URIQueryForNonexistentToken();
        bytes memory base = bytes(s_baseURI);
        if (base.length == 0) return "";
        if (base[base.length - 1] != "/") return s_baseURI;
        return string(abi.encodePacked(s_baseURI, _toString(tokenId)));
    }

    /*//////////////////////////////////////////////////////////////
                           INTERNAL FUNCTIONS
    //////////////////////////////////////////////////////////////*/
    function _requireMintGroupExists(uint256 mintGroup) private view {
        if (!s_mintGroupExists[mintGroup]) revert MintGroupDoesNotExist(mintGroup);
    }

    /**
     * @dev Assumes the group is registered. Rejects an allocation below what the group has minted,
     *      and one that would push the sum of all allocations past the collection's max supply.
     */
    function _setMintGroupMaxSupply(uint256 mintGroup, uint256 newMaxSupply) private {
        uint256 minted = s_mintGroupMints[mintGroup];
        if (newMaxSupply < minted) revert BelowMinted(minted);

        uint256 totalAllocatedSupply = 0;
        uint256 length = s_mintGroups.length;
        for (uint256 i = 0; i < length; i++) {
            uint256 id = s_mintGroups[i];
            totalAllocatedSupply += id == mintGroup ? newMaxSupply : s_mintGroupMaxSupply[id];
        }
        if (totalAllocatedSupply > s_maxSupply) revert AllocationsExceedMaxSupply();

        s_mintGroupMaxSupply[mintGroup] = newMaxSupply;
        emit MintGroupMaxSupplyUpdated(mintGroup, newMaxSupply);
    }

    /**
     * @dev Shared by the single-group setter and the stop-all switch so the two cannot drift.
     *      Assumes the group is registered.
     */
    function _setMintGroupStatus(uint256 mintGroup, bool status) private {
        s_mintGroupActive[mintGroup] = status;
        if (!status) {
            s_mintGroupStartTimestamp[mintGroup] = 0;
        }
        emit MintGroupStatusChanged(mintGroup, status);
    }

    /**
     * @dev Checks the group, the cap or quota of `quotaHolder`, and supply; charges msg.value; credits
     *      the creator and the platform; mints to `receiver`.
     */
    function _batchMint(address quotaHolder, uint256 amount, uint256 mintGroup, address receiver)
        private
        returns (uint256 totalCost)
    {
        if (amount == 0) revert ZeroAmount();
        if (!mintGroupActive(mintGroup)) revert MintGroupInactive(mintGroup);

        if (mintGroup == PUBLIC_MINT_GROUP) {
            uint256 alreadyMinted = s_publicMints[quotaHolder];
            uint256 cap = s_publicMaxMintPerWallet;
            if (amount + alreadyMinted > cap) {
                // Saturating: the owner may lower the cap below what a wallet already holds.
                revert ExceedsPublicMaxPerWallet(amount, cap > alreadyMinted ? cap - alreadyMinted : 0);
            }
            s_publicMints[quotaHolder] = alreadyMinted + amount;
        } else {
            uint256 issued = s_mintQuotas[mintGroup][quotaHolder];
            if (issued == 0) revert NotInWhitelist(quotaHolder, mintGroup);

            uint256 claimed = s_quotaClaimed[mintGroup][quotaHolder];
            if (amount + claimed > issued) {
                // Saturating: the owner may lower an allocation below what an address has claimed.
                revert ExceedsMintQuota(amount, issued > claimed ? issued - claimed : 0);
            }
            s_quotaClaimed[mintGroup][quotaHolder] = claimed + amount;
        }

        uint256 groupMinted = s_mintGroupMints[mintGroup];
        uint256 groupMax = s_mintGroupMaxSupply[mintGroup];
        if (groupMinted + amount > groupMax) {
            revert ExceedsMintGroupMaxSupply(amount, groupMax > groupMinted ? groupMax - groupMinted : 0);
        }

        // _totalMinted() counts tokens ever minted, so nothing can free headroom past the cap.
        uint256 minted = _totalMinted();
        if (minted + amount > s_maxSupply) revert ExceedsMaxSupply(amount, s_maxSupply - minted);

        uint256 platformFee;
        (totalCost, platformFee) = quoteBatchMint(mintGroup, amount);
        if (msg.value < totalCost) revert InsufficientEther(totalCost, msg.value);

        s_creatorBalance += totalCost - platformFee;
        s_platformBalance += platformFee;
        s_mintGroupMints[mintGroup] = groupMinted + amount;

        _mintInChunks(receiver, amount);
    }

    /// @dev Mints `amount` tokens as several ERC721A batches of at most MINT_CHUNK tokens.
    function _mintInChunks(address to, uint256 amount) private {
        while (amount > MINT_CHUNK) {
            _safeMint(to, MINT_CHUNK);
            amount -= MINT_CHUNK;
        }
        if (amount > 0) {
            _safeMint(to, amount);
        }
    }

    /// @dev Pays the caller's pending refund balance to `to`.
    function _withdrawPending(address to) private returns (uint256 payout) {
        payout = s_pendingBalances[msg.sender];
        if (payout == 0) revert NothingToWithdraw();
        s_pendingBalances[msg.sender] = 0;
        _send(to, payout);
    }

    function _send(address to, uint256 amount) private {
        (bool success,) = payable(to).call{value: amount}("");
        if (!success) revert WithdrawFailed();
    }

    /**
     * @dev Sends back whatever the caller overpaid. If the push fails, the amount is credited to the
     *      caller's pending balance instead of reverting the mint.
     */
    function _refundExcessEther(uint256 totalCharge) private {
        uint256 excess = msg.value - totalCharge;
        if (excess > 0) {
            (bool success,) = payable(msg.sender).call{value: excess}("");
            if (!success) {
                s_pendingBalances[msg.sender] += excess;
            }
        }
    }

    /**
     * @dev Skips transfer validation when no validator contract exists at the configured address, so
     *      the same bytecode works on a chain where the Limit Break validator is not deployed.
     *      Where it is deployed, the creator locks transfers by changing the collection's security
     *      level on the validator.
     */
    function _preValidateTransfer(address caller, address from, address to, uint256 tokenId, uint256 value)
        internal
        virtual
        override
    {
        if (getTransferValidator().code.length == 0) return;
        super._preValidateTransfer(caller, from, to, tokenId, value);
    }

    function _startTokenId() internal view virtual override returns (uint256) {
        return 1;
    }

    function _baseURI() internal view override returns (string memory) {
        return s_baseURI;
    }

    function _requireCallerIsContractOwner() internal view virtual override {
        _checkOwner();
    }
}
