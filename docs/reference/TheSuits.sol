// SPDX-License-Identifier: MIT
// Reference only: the latest collection contract (TheSuits), kept verbatim as the model for
// mint-group handling. Not compiled in this repo. See the-suits-mint-analysis.md.

pragma solidity 0.8.30;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {Context as OZContext} from "@openzeppelin/contracts/utils/Context.sol";
import {ERC721AC} from "@creator-token-standards/erc721c/ERC721AC.sol";

/**
 * @title TheSuits
 * @notice Creator-owned ERC721AC collection with multi-group minting, per-wallet caps, allowlist
 *         quotas and ERC2981 royalties. There are exactly two actors: the minter, who pays the
 *         mint price, and the creator (`owner`), who receives all proceeds and controls the sale.
 */
contract TheSuits is ERC721AC, ERC2981, Ownable, ReentrancyGuard {
    struct BaseVariables {
        string name;
        string symbol;
        address ownerPayoutAddress;
        string initialBaseURI;
        uint256 maxSupply;
    }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:´:°•.°*/
    /*                              ERRORS                              */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•.•°:°.*/
    error MintOnBehalfNotActive();
    error AddressZero();
    error Unauthorized(address caller);
    error InvalidOperation(string reason);
    error ExceedsMaxSupply(uint256 requested, uint256 available);
    error InsufficientEther(uint256 required, uint256 provided);
    error ExceedsPublicMaxPerWallet(uint256 requested, uint256 allowed);
    error ExceedsMintQuota(uint256 requested, uint256 allowed);
    error ExceedsMintGroupMaxSupply(uint256 requested, uint256 available);
    error MintGroupInactive(uint256 mintGroup);
    error NotInWhitelist(address caller, uint256 mintGroup);
    error MintGroupDoesNotExist(uint256 mintGroup);
    error MintGroupAlreadyExists(uint256 mintGroup);
    error ArrayLengthMismatch();

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:´:°•.°*/
    /*                              EVENTS                              */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•.•°:°.*/
    event BatchMetadataUpdate(uint256 indexed fromTokenId, uint256 indexed toTokenId);
    event TokensMinted(address indexed recipient, uint256 amount, uint256 mintGroup);
    event SalePriceChanged(uint256 indexed mintGroup, uint256 newPrice);
    event PublicMaxMintPerWalletChanged(uint256 newMaxMintPerWallet);
    event MintGroupStatusChanged(uint256 indexed mintGroup, bool status);
    event AllMintGroupsStatusChanged(bool status, uint256 groupsAffected);
    event MintGroupStartTimestampChanged(uint256 indexed mintGroup, uint256 timestamp);
    event MintQuotasAdded(uint256 mintGroup, uint256 numberOfAddresses);
    event MintOnBehalfUpdated(bool newStatus);
    event MintGroupMaxSupplyUpdated(uint256 indexed mintGroup, uint256 newMaxSupply);
    event OwnerPayoutAddressUpdated(address newOwnerPayoutAddress);
    event DefaultRoyaltyUpdated(address receiver, uint96 feeNumerator);
    event TokenRoyaltyUpdated(uint256 tokenId, address receiver, uint96 feeNumerator);
    event NFTsAirdropped(uint256 recipients, uint256 amount);
    event MintFundsWithdrawn(address indexed payoutAddress, uint256 amount);
    event MintGroupRegistered(uint256 indexed mintGroup);

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:´:°•.°*/
    /*                        STORAGE VARIABLES                         */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•.•°:°.*/
    /// @dev Mint group 0 is the open public sale: it is capped per wallet rather than by an
    ///      allowlist quota. It is gated by the same open/closed switch as every other group.
    uint256 private constant PUBLIC_MINT_GROUP = 0;
    /// @dev EIP-4906 (metadata update extension), reported by supportsInterface.
    bytes4 private constant INTERFACE_ID_ERC4906 = 0x49064906;
    uint256 private immutable i_maxSupply;
    uint256 private s_publicMaxMintPerWallet;
    uint256[] private s_activeMintGroups;
    bool private s_mintOnBehalfActive;
    string private s_baseURI;
    address private s_ownerPayoutAddress;

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:´:°•.°*/
    /*                             MAPPINGS                             */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•.•°:°.*/
    /// @dev Pull-payment ledger. Holds creator proceeds, plus any minter refund whose push failed.
    mapping(address => uint256) private s_pendingBalances;
    mapping(uint256 => uint256) private s_mintPrice;
    mapping(uint256 => uint256) private s_mintGroupMaxSupply;
    mapping(uint256 => uint256) private s_mintGroupMints;
    mapping(uint256 => uint256) private s_mintGroupStartTimestamp;
    mapping(address => mapping(uint256 => uint256)) private s_addressMints;
    /// @dev The allowance ISSUED to an address, not a decaying remainder. Re-uploading an
    ///      allowlist therefore restates the same allocation instead of re-granting spent quota.
    mapping(uint256 => mapping(address => uint256)) private s_mintQuotas;
    /// @dev How much of the issued allowance has been claimed. Paired with s_mintQuotas so that
    ///      setMintQuota is idempotent: remaining = issued - claimed.
    mapping(uint256 => mapping(address => uint256)) private s_quotaClaimed;
    mapping(uint256 => bool) private s_mintGroupActive;

    constructor(
        BaseVariables memory baseVariables,
        uint256[] memory mintGroupMaxSupplies_,
        uint256[] memory mintPrice_,
        uint256 publicMaxMintPerWallet_,
        uint96 royaltyPercentage,
        address owner_,
        address royaltyPayoutAddress
    ) ERC721AC(baseVariables.name, baseVariables.symbol) Ownable(owner_) {
        if (mintPrice_.length != mintGroupMaxSupplies_.length) {
            revert ArrayLengthMismatch();
        }
        // Index 0 of these arrays configures the public mint group, so at least one entry is required.
        if (mintGroupMaxSupplies_.length == 0) {
            revert InvalidOperation({reason: "At least one mint group is required"});
        }
        if (baseVariables.ownerPayoutAddress == address(0)) {
            revert AddressZero();
        }

        uint256 totalAllocatedSupply = 0;
        for (uint256 i = 0; i < mintGroupMaxSupplies_.length; i++) {
            totalAllocatedSupply += mintGroupMaxSupplies_[i];
            s_mintGroupMaxSupply[i] = mintGroupMaxSupplies_[i];
            s_mintPrice[i] = mintPrice_[i];
            s_mintGroupMints[i] = 0;
            s_activeMintGroups.push(i);
        }
        if (totalAllocatedSupply > baseVariables.maxSupply) {
            revert InvalidOperation({reason: "Mint group allocations exceed collection max supply"});
        }
        i_maxSupply = baseVariables.maxSupply;
        // Every group, the public sale included, starts closed. The owner opens them explicitly.
        s_baseURI = baseVariables.initialBaseURI;
        s_ownerPayoutAddress = baseVariables.ownerPayoutAddress;
        s_publicMaxMintPerWallet = publicMaxMintPerWallet_;

        /**
         * Set default royalty for ERC2981
         */
        _setDefaultRoyalty(royaltyPayoutAddress, royaltyPercentage);
    }

    /**
     * @notice Mints NFTs to the caller for a specific mint group
     * @param amount Amount of NFTs to be minted
     * @param mintGroup Id of mint group
     * @return totalCost Total cost of the mint for batch mint
     */
    function batchMint(uint256 amount, uint256 mintGroup) external payable returns (uint256 totalCost) {
        totalCost = _batchMint(msg.sender, amount, mintGroup, msg.sender);
        emit TokensMinted(msg.sender, amount, mintGroup);
        _refundExcessEther(totalCost);
    }

    /**
     * @notice Mints NFTs to a specified receiver address
     * @param amount The number of tokens to mint
     * @param mintGroup The mint group ID
     * @param receiver The address to mint the tokens to
     */
    function mintOnBehalf(uint256 amount, uint256 mintGroup, address receiver)
        external
        payable
        returns (uint256 totalCost)
    {
        if (!s_mintOnBehalfActive) {
            revert MintOnBehalfNotActive();
        }
        totalCost = _batchMint(receiver, amount, mintGroup, receiver);
        emit TokensMinted(receiver, amount, mintGroup);
        _refundExcessEther(totalCost);
    }

    /**
     * @notice Withdraws the accumulated mint proceeds to the owner payout address
     * @dev Callable by the owner or the payout address itself. A minter whose refund push failed
     *      claims their own credit through withdrawPendingBalance instead.
     */
    function withdrawMintFunds() external nonReentrant returns (uint256 payout) {
        if (msg.sender != owner() && msg.sender != s_ownerPayoutAddress) {
            revert Unauthorized(msg.sender);
        }
        payout = _withdrawFor(s_ownerPayoutAddress);
        emit MintFundsWithdrawn(s_ownerPayoutAddress, payout);
    }

    /**
     * @notice Claims the caller's own pending balance, credited when a mint refund push failed
     */
    function withdrawPendingBalance() external nonReentrant returns (uint256 payout) {
        payout = _withdrawFor(msg.sender);
    }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:´:°•.°*/
    /*                         OWNER FUNCTIONS                          */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•.•°:°.*/
    /**
     *
     * @param addressesToAdd Addresses to change mint quota
     * @param mintGroup mint ID group of addresses to change mint quota
     * @param mintQuotas_ mint quotas address in array
     * @notice Sets the per-address mint quota for an allowlist group, registering the group if new.
     *         Quotas apply to groups 1+; the public group is capped by publicMaxMintPerWallet.
     */
    function setMintQuota(address[] memory addressesToAdd, uint256 mintGroup, uint256[] memory mintQuotas_)
        external
        onlyOwner
    {
        if (addressesToAdd.length != mintQuotas_.length) {
            revert ArrayLengthMismatch();
        }

        _requireMintGroupExists(mintGroup);

        uint256 addressesToAddLength = addressesToAdd.length;

        for (uint256 i = 0; i < addressesToAddLength; i++) {
            s_mintQuotas[mintGroup][addressesToAdd[i]] = mintQuotas_[i];
        }
        emit MintQuotasAdded(mintGroup, addressesToAddLength);
    }

    /**
     * @notice Registers a new mint group so it can be priced, allocated and opened
     * @dev Registration is deliberately explicit. The configuration setters reject unknown groups
     *      rather than creating them, so a mistyped group id reverts instead of silently adding a
     *      group that can never be removed.
     * @param mintGroup id of the group to register
     */
    function registerMintGroup(uint256 mintGroup) external onlyOwner {
        if (_mintGroupExists(mintGroup)) {
            revert MintGroupAlreadyExists({mintGroup: mintGroup});
        }
        _initializeNewMintGroup(mintGroup);
        emit MintGroupRegistered(mintGroup);
    }

    /**
     * @notice Sets the lifetime per-wallet mint cap for the public group (0)
     * @dev Cumulative across transactions, not per batch: enforced against s_addressMints, which
     *      accumulates. Applies to group 0 only — allowlist groups are limited by s_mintQuotas
     *      instead, so this is the public sale's only per-address limit.
     */
    function setPublicMaxMintPerWallet(uint256 newPublicMaxMintPerWallet) external onlyOwner {
        s_publicMaxMintPerWallet = newPublicMaxMintPerWallet;
        emit PublicMaxMintPerWalletChanged(newPublicMaxMintPerWallet);
    }

    /**
     * @notice Sets the mint on behalf status
     * @param status new mint on behalf status
     */
    function setMintOnBehalfStatus(bool status) external onlyOwner {
        s_mintOnBehalfActive = status;
        emit MintOnBehalfUpdated(status);
    }

    /**
     * @notice Changes the price to mint a token of a specific mint group id
     * @param newMintPrice New mint Price
     * @param mintGroup Mint ID to change price
     */
    function changeSalePrice(uint256 newMintPrice, uint256 mintGroup) external onlyOwner {
        _requireMintGroupExists(mintGroup);
        s_mintPrice[mintGroup] = newMintPrice;
        emit SalePriceChanged(mintGroup, newMintPrice);
    }

    /**
     * @notice Sets how many tokens a mint group may sell in total, registering the group if new
     * @dev This is a supply allocation for the whole group, NOT a per-wallet limit. Per-wallet
     *      limits live elsewhere: group 0 is capped by s_publicMaxMintPerWallet, groups 1+ by each
     *      address's entry in s_mintQuotas.
     * @dev Outside the constructor this is the only writer of s_mintGroupMaxSupply, so a group
     *      created implicitly by setMintQuota or changeSalePrice stays unmintable at 0 allocation
     *      until this is called for it.
     * @param mintGroup mint ID of the group to allocate supply to
     * @param newMaxSupply the group's new total supply allocation
     */
    function setMintGroupMaxSupply(uint256 mintGroup, uint256 newMaxSupply) external onlyOwner {
        _requireMintGroupExists(mintGroup);

        // Every group's allocation must still fit inside the collection, so that no group can be
        // sold spots that another group has already been promised.
        uint256 totalAllocatedSupply = 0;
        uint256 activeMintGroupsLength = s_activeMintGroups.length;
        for (uint256 i = 0; i < activeMintGroupsLength; i++) {
            if (s_activeMintGroups[i] == mintGroup) {
                totalAllocatedSupply += newMaxSupply; // Use the new allocation for the target group
            } else {
                totalAllocatedSupply += s_mintGroupMaxSupply[s_activeMintGroups[i]];
            }
        }

        if (totalAllocatedSupply > i_maxSupply) {
            revert InvalidOperation({reason: "Mint group allocations would exceed collection max supply"});
        }

        s_mintGroupMaxSupply[mintGroup] = newMaxSupply;
        emit MintGroupMaxSupplyUpdated(mintGroup, newMaxSupply);
    }

    /**
     * @notice Opens or closes minting for a single mint group, the public sale (group 0) included
     * @dev Closing also clears the group's scheduled start, otherwise a schedule set earlier would
     *      silently reopen the group the moment its timestamp passed.
     * @param mintGroup mint group to open or close
     * @param status true to open the group, false to close it
     */
    function setMintGroupStatus(uint256 mintGroup, bool status) external onlyOwner {
        // Checks if mintGroup already exists inside activeMintGroups.
        if (!_mintGroupExists(mintGroup)) {
            revert MintGroupDoesNotExist({mintGroup: mintGroup});
        }
        _setMintGroupStatus(mintGroup, status);
    }

    /**
     * @notice Contingency switch that opens or closes every registered mint group at once
     * @dev Deliberately idempotent, unlike the per-group setter's older sibling: an emergency halt
     *      must never revert because the state already matched, and it must not require the caller
     *      to know how many groups exist. Emits the per-group event for each group so off-chain
     *      indexers see the same state transitions they would from individual calls.
     * @param status true to open every registered group, false to halt the entire sale
     */
    function stopOrStartAllMintGroups(bool status) external onlyOwner {
        uint256 activeMintGroupsLength = s_activeMintGroups.length;
        for (uint256 i = 0; i < activeMintGroupsLength; i++) {
            _setMintGroupStatus(s_activeMintGroups[i], status);
        }
        emit AllMintGroupsStatusChanged(status, activeMintGroupsLength);
    }

    /**
     * @notice Schedules when a mint group will open on its own, without a further transaction
     * @dev The group opens once block.timestamp passes startTimestamp. Pass 0 to clear a schedule.
     * @param mintGroup mint group to schedule
     * @param startTimestamp Unix timestamp after which the group is open
     */
    function scheduleMintGroupStart(uint256 mintGroup, uint256 startTimestamp) external onlyOwner {
        if (!_mintGroupExists(mintGroup)) {
            revert MintGroupDoesNotExist({mintGroup: mintGroup});
        }
        s_mintGroupStartTimestamp[mintGroup] = startTimestamp;
        emit MintGroupStartTimestampChanged(mintGroup, startTimestamp);
    }

    /**
     * @notice Sets the base URI for the token metadata. Only the contract owner can call this function.
     * @param newBaseURI the newBASEURI for the token metadata
     */
    function setBaseURI(string memory newBaseURI) external onlyOwner {
        s_baseURI = newBaseURI;
        emit BatchMetadataUpdate(1, type(uint256).max);
    }

    /**
     * @notice Updates the owner's payout address and transfers pending balance to new address
     * @dev Transfers existing balance from old to new address, then updates ownerPayoutAddress
     * @param newOwnerPayoutAddress The new address for owner payouts
     */
    function setOwnerPayoutAddress(address newOwnerPayoutAddress) external onlyOwner {
        if (newOwnerPayoutAddress == address(0)) {
            revert AddressZero();
        }
        // Guarded so re-setting the same address cannot zero out its own pending balance.
        if (newOwnerPayoutAddress != s_ownerPayoutAddress) {
            s_pendingBalances[newOwnerPayoutAddress] += s_pendingBalances[s_ownerPayoutAddress];
            s_pendingBalances[s_ownerPayoutAddress] = 0;
            s_ownerPayoutAddress = newOwnerPayoutAddress;
        }
        emit OwnerPayoutAddressUpdated(newOwnerPayoutAddress);
    }

    /**
     * @notice Sets the default royalty recipient and fee percentage for all tokens
     * @dev Calls internal _setDefaultRoyalty function. Only callable by owner
     * @param receiver Address that will receive royalty payments
     * @param feeNumerator Royalty fee as basis points (e.g., 250 = 2.5%)
     */
    function setDefaultRoyalty(address receiver, uint96 feeNumerator) external onlyOwner {
        _setDefaultRoyalty(receiver, feeNumerator);
        emit DefaultRoyaltyUpdated(receiver, feeNumerator);
    }

    /**
     * @notice Sets royalty recipient and fee for a specific token, overriding default royalty
     * @dev Calls internal _setTokenRoyalty function. Only callable by owner
     * @param tokenId The token ID to set specific royalty for
     * @param receiver Address that will receive royalty payments for this token
     * @param feeNumerator Royalty fee as basis points (e.g., 250 = 2.5%)
     */
    function setTokenRoyalty(uint256 tokenId, address receiver, uint96 feeNumerator) external onlyOwner {
        _setTokenRoyalty(tokenId, receiver, feeNumerator);
        emit TokenRoyaltyUpdated(tokenId, receiver, feeNumerator);
    }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:´:°•.°*/
    /*                        AIRDROP FUNCTIONS                         */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•.•°:°.*/
    /**
     * @notice Airdrops NFTs to multiple recipients, free of charge
     * @param recipients Recipent to receive NFTs
     * @param amounts the number of NFTs to airdrop per recipient
     * @dev Airdrops consume total supply but are not counted against any mint group allocation.
     */
    function airdropNFTs(address[] memory recipients, uint256[] memory amounts) external onlyOwner nonReentrant {
        uint256 amountsLength = amounts.length;
        if (recipients.length != amountsLength) {
            revert InvalidOperation({reason: "Mismatch between recipients and amounts"});
        }
        uint256 totalNFTToMint = 0;
        for (uint256 i = 0; i < amountsLength; i++) {
            totalNFTToMint += amounts[i];
        }
        // _totalMinted() rather than totalSupply(): the ceiling must count tokens ever minted, so
        // that a future burn cannot free headroom and let the collection mint past its cap.
        if (_totalMinted() + totalNFTToMint > i_maxSupply) {
            revert InvalidOperation({reason: "Airdrop exceeds max supply"});
        }

        uint256 recipientsLength = recipients.length;
        for (uint256 j = 0; j < recipientsLength; j++) {
            _safeMint(recipients[j], amounts[j]); // Mint NFTs to recipients
        }
        emit NFTsAirdropped(recipientsLength, totalNFTToMint);
    }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:´:°•.°*/
    /*                          VIEW FUNCTIONS                          */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•.•°:°.*/

    function maxSupply() external view returns (uint256) {
        return i_maxSupply;
    }

    function publicMaxMintPerWallet() external view returns (uint256) {
        return s_publicMaxMintPerWallet;
    }

    function activeMintGroups() external view returns (uint256[] memory) {
        return s_activeMintGroups;
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

    /// @notice The raw open/closed flag, ignoring any scheduled start. Use mintGroupActive for the
    ///         effective state, which also accounts for a schedule that has since elapsed.
    function mintGroupActiveFlag(uint256 mintGroup) external view returns (bool) {
        return s_mintGroupActive[mintGroup];
    }

    /// @notice Whether a mint group is registered, whether or not it is currently open
    function mintGroupExists(uint256 mintGroup) external view returns (bool) {
        return _mintGroupExists(mintGroup);
    }

    /**
     * @notice Checks if a mint operation is valid for the given parameters
     * @param amount Amount of ERC
     * @param mintGroup mintGroup to check if eligible to mint
     * @param minterAddress Address to mint
     */
    function canMintCheck(uint256 amount, uint256 mintGroup, address minterAddress)
        external
        view
        returns (bool, string memory)
    {
        if (amount == 0) {
            return (false, "InvalidOperation");
        }

        // Pre-conditions checks
        if (!mintGroupActive(mintGroup)) {
            return (false, "MintGroupInactive");
        }

        if (mintGroup == PUBLIC_MINT_GROUP) {
            if (amount + s_addressMints[minterAddress][mintGroup] > s_publicMaxMintPerWallet) {
                return (false, "ExceedsPublicMaxMintPerWallet");
            }
        } else {
            if (s_mintQuotas[mintGroup][minterAddress] == 0) {
                return (false, "NotInWhitelist");
            }

            if (amount + s_quotaClaimed[mintGroup][minterAddress] > s_mintQuotas[mintGroup][minterAddress]) {
                return (false, "ExceedsMintQuota");
            }
        }

        if (s_mintGroupMints[mintGroup] + amount > s_mintGroupMaxSupply[mintGroup]) {
            return (false, "ExceedsMintGroupMaxSupply");
        }

        if (_totalMinted() + amount > i_maxSupply) {
            return (false, "ExceedsMaxSupply");
        }

        return (true, "");
    }

    /**
     * @notice Quote the total cost of minting a batch of tokens
     * @param mintGroup The mint group ID
     * @param amount The number of tokens to mint
     * @return totalCost The mint price for the group multiplied by the token count
     */
    function quoteBatchMint(uint256 mintGroup, uint256 amount) public view returns (uint256 totalCost) {
        totalCost = s_mintPrice[mintGroup] * amount;
    }

    /**
     * @notice Checks the balance pending withdrawal for the sender.
     */
    function checkPendingBalance() external view returns (uint256) {
        return s_pendingBalances[msg.sender];
    }

    /**
     * @notice Checks the balance pending withdrawal for the user.
     */
    function checkPendingBalanceFor(address user) external view returns (uint256) {
        return s_pendingBalances[user];
    }

    /**
     * @notice Returns whether this contract supports the given interface
     */
    function supportsInterface(bytes4 interfaceId) public view override(ERC721AC, ERC2981) returns (bool) {
        // ERC4906 is reported explicitly: setBaseURI emits BatchMetadataUpdate, and marketplaces
        // gate their metadata-refresh handling on this interface id.
        return interfaceId == INTERFACE_ID_ERC4906 || ERC721AC.supportsInterface(interfaceId)
            || ERC2981.supportsInterface(interfaceId);
    }

    /**
     * @notice Checks whether a mint group ID has been registered
     * @dev Registration is separate from being open: a registered group still has to be opened
     *      by setMintGroupStatus or a scheduled start before anyone can mint from it.
     */
    /// @dev Reverts unless the group has been registered, so a mistyped id can never silently
    ///      create a group that no function is able to remove.
    function _requireMintGroupExists(uint256 mintGroup) private view {
        if (!_mintGroupExists(mintGroup)) {
            revert MintGroupDoesNotExist({mintGroup: mintGroup});
        }
    }

    function _mintGroupExists(uint256 mintGroup) private view returns (bool) {
        uint256 activeMintGroupsLength = s_activeMintGroups.length;
        for (uint256 i = 0; i < activeMintGroupsLength; i++) {
            if (s_activeMintGroups[i] == mintGroup) {
                return true;
            }
        }
        return false;
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        if (!_exists(tokenId)) revert URIQueryForNonexistentToken();
        if (bytes(s_baseURI).length == 0) {
            return "";
        }
        if (bytes(s_baseURI)[bytes(s_baseURI).length - 1] != bytes("/")[0]) {
            return s_baseURI;
        }
        return string(abi.encodePacked(s_baseURI, _toString(tokenId)));
    }

    /**
     * @notice Whether a mint group is open, either by explicit flag or by an elapsed scheduled start
     * @dev This is the only gate on minting. It applies uniformly to every group, the public sale
     *      (group 0) included, so closing every group halts all minting.
     */
    function mintGroupActive(uint256 mintGroup) public view returns (bool) {
        if (!s_mintGroupActive[mintGroup]) {
            if (s_mintGroupStartTimestamp[mintGroup] == 0 || block.timestamp < s_mintGroupStartTimestamp[mintGroup]) {
                return false;
            }
        }

        return true;
    }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:´:°•.°*/
    /*                        INTERNAL FUNCTIONS                        */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•.•°:°.*/
    /**
     * @notice Registers a new mint group with default values
     * @dev The group is registered closed. Opening it is a separate, explicit call, so configuring
     *      a group's price or quota can never start selling it as a side effect.
     */
    function _initializeNewMintGroup(uint256 mintGroup) internal {
        s_mintPrice[mintGroup] = 0;
        s_mintGroupMaxSupply[mintGroup] = 0;
        s_mintGroupMints[mintGroup] = 0;
        s_activeMintGroups.push(mintGroup);
    }

    /**
     * @notice Opens or closes one mint group, clearing its schedule on close
     * @dev Shared by the single-group setter and the stop-all contingency so both can never drift.
     *      Assumes the caller has already checked that the group is registered.
     */
    function _setMintGroupStatus(uint256 mintGroup, bool status) internal {
        s_mintGroupActive[mintGroup] = status;
        if (!status) {
            s_mintGroupStartTimestamp[mintGroup] = 0;
        }
        emit MintGroupStatusChanged(mintGroup, status);
    }

    /**
     * @notice Internal function to handle batch minting logic
     */
    function _batchMint(address quotaHolder, uint256 amount, uint256 mintGroup, address receiver)
        internal
        returns (uint256)
    {
        if (amount == 0) {
            revert InvalidOperation({reason: "Amount must be greater than 0"});
        }

        // Pre-conditions checks
        if (!mintGroupActive(mintGroup)) {
            revert MintGroupInactive({mintGroup: mintGroup});
        }

        if (mintGroup == PUBLIC_MINT_GROUP) {
            uint256 alreadyMinted = s_addressMints[quotaHolder][mintGroup];
            if (amount + alreadyMinted > s_publicMaxMintPerWallet) {
                // Saturating: the owner may lower the cap below what a wallet already holds, and
                // the error itself must not underflow into an opaque panic when that happens.
                revert ExceedsPublicMaxPerWallet({
                    requested: amount,
                    allowed: s_publicMaxMintPerWallet > alreadyMinted ? s_publicMaxMintPerWallet - alreadyMinted : 0
                });
            }
        } else {
            // Checks required for non public mint
            uint256 issued = s_mintQuotas[mintGroup][quotaHolder];
            if (issued == 0) {
                revert NotInWhitelist({caller: quotaHolder, mintGroup: mintGroup});
            }

            uint256 claimed = s_quotaClaimed[mintGroup][quotaHolder];
            if (amount + claimed > issued) {
                // Saturating for the same reason as the public cap: the owner may lower an
                // allocation below what an address has already claimed.
                revert ExceedsMintQuota({requested: amount, allowed: issued > claimed ? issued - claimed : 0});
            }
            s_quotaClaimed[mintGroup][quotaHolder] = claimed + amount;
        }

        // Check mint group supply limits
        if (s_mintGroupMints[mintGroup] + amount > s_mintGroupMaxSupply[mintGroup]) {
            revert ExceedsMintGroupMaxSupply({
                requested: amount, available: s_mintGroupMaxSupply[mintGroup] - s_mintGroupMints[mintGroup]
            });
        }

        // Check total supply limit. _totalMinted() counts tokens ever minted, so a burn can never
        // free headroom that lets the collection mint past its cap.
        uint256 minted = _totalMinted();
        if (minted + amount > i_maxSupply) {
            revert ExceedsMaxSupply({requested: amount, available: i_maxSupply - minted});
        }

        uint256 totalCost = quoteBatchMint(mintGroup, amount);

        if (msg.value < totalCost) {
            revert InsufficientEther({required: totalCost, provided: msg.value});
        }

        s_addressMints[quotaHolder][mintGroup] += amount;

        // All proceeds go to the creator's payout address.
        s_pendingBalances[s_ownerPayoutAddress] += totalCost;

        // Finalize minting
        s_mintGroupMints[mintGroup] += amount;
        _safeMint(receiver, amount);

        return totalCost;
    }

    /**
     * @notice Internal function to withdraw funds for a specific user
     */
    function _withdrawFor(address user) internal returns (uint256 payout) {
        payout = s_pendingBalances[user];
        if (payout == 0) {
            revert InvalidOperation({reason: "Nothing to withdraw"});
        }
        s_pendingBalances[user] = 0;
        (bool success,) = payable(user).call{value: payout}("");
        if (!success) {
            revert InvalidOperation({reason: "Withdraw Transfer Failed"});
        }
    }

    /**
     * @notice Internal function to refund excess Ether sent in a transaction
     */
    function _refundExcessEther(uint256 totalCharge) internal {
        uint256 excess = msg.value - totalCharge;
        if (excess > 0) {
            (bool success,) = payable(msg.sender).call{value: excess}("");
            if (!success) {
                s_pendingBalances[msg.sender] += excess;
            }
        }
    }

    /**
     * @notice Overrides the start token ID function from the ERC721A contract
     */
    function _startTokenId() internal view virtual override returns (uint256) {
        return 1;
    }

    /**
     * @notice Returns the base URI for the token metadata
     */
    function _baseURI() internal view override returns (string memory) {
        return s_baseURI;
    }

    /**
     * @notice Internal function to check if caller is contract owner
     */
    function _requireCallerIsContractOwner() internal view virtual override {
        _checkOwner();
    }

    /**
     * @notice Returns the message data for the current call
     */
    function _msgData() internal view override(OZContext) returns (bytes calldata) {
        return super._msgData();
    }

    /**
     * @notice Returns the sender of the current call
     */
    function _msgSender() internal view override(OZContext) returns (address) {
        return super._msgSender();
    }
}
