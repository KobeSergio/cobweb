// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ICobwebFactory} from "./interfaces/ICobwebFactory.sol";

/**
 * @title CobwebFactory
 * @notice Deploys Cobweb collections, holds the platform fee settings they copy at deployment, and
 *         takes the art-generation payment.
 * @dev Collections are full contracts, not proxies. The caller supplies the collection's creation code
 *      in calldata; the factory only deploys code whose hash an admin has approved. Deploying is open
 *      to anyone. Everything else that changes state is admin-only.
 */
contract CobwebFactory is AccessControl, ICobwebFactory {
    /*//////////////////////////////////////////////////////////////
                                 ERRORS
    //////////////////////////////////////////////////////////////*/
    error NotAdmin();
    error ZeroAddress();
    error ZeroHash();
    error CreationCodeNotApproved(bytes32 codeHash);
    error DeploymentFailed();
    error FeeBpsTooHigh(uint256 bps);
    error ZeroPayment();
    error JobAlreadyPaid(bytes32 jobId, address payer);
    error LastAdmin();
    error NothingToWithdraw();
    error WithdrawFailed();

    /*//////////////////////////////////////////////////////////////
                                 EVENTS
    //////////////////////////////////////////////////////////////*/
    event CreationCodeApproved(bytes32 indexed codeHash);
    event CreationCodeRemoved(bytes32 indexed codeHash);
    event CollectionDeployed(
        address indexed collection, bytes32 indexed codeHash, address indexed deployer, bytes32 salt
    );
    event CollectionFeesUpdated(uint256 mintFeeFlat, uint256 mintFeeBps, uint256 airdropFeePerToken);
    event ArtFeeUpdated(uint256 artFeePerToken);
    event TreasuryUpdated(address indexed treasury);
    event ArtPaid(bytes32 indexed jobId, address indexed payer, uint256 amount);
    event Withdrawn(address indexed treasury, uint256 amount);

    /*//////////////////////////////////////////////////////////////
                           STORAGE VARIABLES
    //////////////////////////////////////////////////////////////*/
    uint256 public constant MAX_BPS = 10_000;

    /// @dev Hash of creation code (without constructor arguments) that may be deployed.
    mapping(bytes32 => bool) private s_approvedCreationCode;
    /// @dev Every collection this factory has deployed.
    mapping(address => bool) private s_isCollection;
    /// @dev Amount received for each art-generation job, per payer. Non-zero means paid. Keyed by
    ///      payer so that nobody can block a job by paying a token amount for someone else's id.
    mapping(bytes32 => mapping(address => uint256)) private s_jobPayment;
    /// @dev Number of accounts holding the admin role. Never allowed to reach zero.
    uint256 private s_adminCount;

    /// @dev Flat platform fee per minted token, in the chain's native token.
    uint256 private s_mintFeeFlat;
    /// @dev Platform fee as a share of the creator's mint price, in basis points.
    uint256 private s_mintFeeBps;
    /// @dev Platform fee per airdropped token, in the chain's native token.
    uint256 private s_airdropFeePerToken;
    /// @dev Published rate per generated token. The server quotes from it; payForArt does not enforce it.
    uint256 private s_artFeePerToken;
    address private s_treasury;

    /*//////////////////////////////////////////////////////////////
                               MODIFIERS
    //////////////////////////////////////////////////////////////*/
    modifier onlyAdmin() {
        if (!hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) revert NotAdmin();
        _;
    }

    /*//////////////////////////////////////////////////////////////
                               FUNCTIONS
    //////////////////////////////////////////////////////////////*/
    /**
     * @param admin First platform admin
     * @param treasury_ Where platform fees are paid out
     * @dev Use the same arguments on every chain so the factory lands on the same address everywhere.
     */
    constructor(address admin, address treasury_) {
        if (admin == address(0) || treasury_ == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        s_treasury = treasury_;
        emit TreasuryUpdated(treasury_);
    }

    /*//////////////////////////////////////////////////////////////
                              DEPLOYMENT
    //////////////////////////////////////////////////////////////*/
    /**
     * @notice Deploys a collection from approved creation code
     * @param creationCode The collection's creation code, without constructor arguments
     * @param constructorArgs ABI-encoded constructor arguments
     * @param salt Caller-chosen salt. Combined with the caller's address, so the resulting address is
     *        predictable and cannot be taken by someone else.
     * @return collection Address of the new collection
     */
    function deployCollection(bytes calldata creationCode, bytes calldata constructorArgs, bytes32 salt)
        external
        returns (address collection)
    {
        bytes32 codeHash = keccak256(creationCode);
        if (!s_approvedCreationCode[codeHash]) revert CreationCodeNotApproved(codeHash);

        bytes memory initCode = abi.encodePacked(creationCode, constructorArgs);
        bytes32 finalSalt = _salt(msg.sender, salt);
        assembly {
            collection := create2(0, add(initCode, 0x20), mload(initCode), finalSalt)
        }
        if (collection == address(0)) revert DeploymentFailed();

        s_isCollection[collection] = true;
        emit CollectionDeployed(collection, codeHash, msg.sender, salt);
    }

    /**
     * @notice The address deployCollection would produce for these inputs
     * @param deployer The account that will call deployCollection
     */
    function predictCollectionAddress(
        address deployer,
        bytes calldata creationCode,
        bytes calldata constructorArgs,
        bytes32 salt
    ) external view returns (address) {
        bytes32 initCodeHash = keccak256(abi.encodePacked(creationCode, constructorArgs));
        return address(
            uint160(
                uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), _salt(deployer, salt), initCodeHash)))
            )
        );
    }

    /*//////////////////////////////////////////////////////////////
                            ART PAYMENT
    //////////////////////////////////////////////////////////////*/
    /**
     * @notice Pays for an art-generation job
     * @dev The amount is not checked here. The server compares the ArtPaid event against the quote it
     *      issued for the job, so a quote stays valid even if the published rate changes meanwhile.
     *      A payment is recorded against its payer, so the server must also check that the payer is
     *      the wallet the quote was issued to.
     * @param jobId The job identifier issued by the server at lock
     */
    function payForArt(bytes32 jobId) external payable {
        if (msg.value == 0) revert ZeroPayment();
        if (s_jobPayment[jobId][msg.sender] != 0) revert JobAlreadyPaid(jobId, msg.sender);
        s_jobPayment[jobId][msg.sender] = msg.value;
        emit ArtPaid(jobId, msg.sender, msg.value);
    }

    /**
     * @notice Sends everything the factory holds to the treasury
     */
    function withdraw() external onlyAdmin {
        uint256 amount = address(this).balance;
        if (amount == 0) revert NothingToWithdraw();
        address to = s_treasury;
        (bool success,) = payable(to).call{value: amount}("");
        if (!success) revert WithdrawFailed();
        emit Withdrawn(to, amount);
    }

    /*//////////////////////////////////////////////////////////////
                            ADMIN FUNCTIONS
    //////////////////////////////////////////////////////////////*/
    /**
     * @notice Allows a collection's creation code to be deployed through the factory
     * @param codeHash keccak256 of the creation code, without constructor arguments
     */
    function approveCreationCode(bytes32 codeHash) external onlyAdmin {
        if (codeHash == bytes32(0)) revert ZeroHash();
        s_approvedCreationCode[codeHash] = true;
        emit CreationCodeApproved(codeHash);
    }

    /**
     * @notice Stops further deployments of a creation code. Existing collections are unaffected.
     */
    function removeCreationCode(bytes32 codeHash) external onlyAdmin {
        s_approvedCreationCode[codeHash] = false;
        emit CreationCodeRemoved(codeHash);
    }

    /**
     * @notice Sets the fees that collections deployed from now on will start with
     * @dev Does not change collections already deployed; each has its own setFees.
     * @param mintFeeFlat Flat fee per minted token, in the native token
     * @param mintFeeBps Share of the creator's mint price, in basis points
     * @param airdropFeePerToken Fee per airdropped token, in the native token
     */
    function setCollectionFees(uint256 mintFeeFlat, uint256 mintFeeBps, uint256 airdropFeePerToken) external onlyAdmin {
        if (mintFeeBps > MAX_BPS) revert FeeBpsTooHigh(mintFeeBps);
        s_mintFeeFlat = mintFeeFlat;
        s_mintFeeBps = mintFeeBps;
        s_airdropFeePerToken = airdropFeePerToken;
        emit CollectionFeesUpdated(mintFeeFlat, mintFeeBps, airdropFeePerToken);
    }

    /**
     * @notice Sets the published art-generation rate per token, in the native token
     */
    function setArtFeePerToken(uint256 newArtFeePerToken) external onlyAdmin {
        s_artFeePerToken = newArtFeePerToken;
        emit ArtFeeUpdated(newArtFeePerToken);
    }

    /**
     * @notice Sets where platform fees are paid out, for the factory and every collection
     */
    function setTreasury(address newTreasury) external onlyAdmin {
        if (newTreasury == address(0)) revert ZeroAddress();
        s_treasury = newTreasury;
        emit TreasuryUpdated(newTreasury);
    }

    /*//////////////////////////////////////////////////////////////
                             VIEW FUNCTIONS
    //////////////////////////////////////////////////////////////*/
    /// @inheritdoc ICobwebFactory
    function collectionFees()
        external
        view
        returns (uint256 mintFeeFlat, uint256 mintFeeBps, uint256 airdropFeePerToken)
    {
        return (s_mintFeeFlat, s_mintFeeBps, s_airdropFeePerToken);
    }

    /// @inheritdoc ICobwebFactory
    function treasury() external view returns (address) {
        return s_treasury;
    }

    /// @inheritdoc ICobwebFactory
    function isAdmin(address account) external view returns (bool) {
        return hasRole(DEFAULT_ADMIN_ROLE, account);
    }

    function artFeePerToken() external view returns (uint256) {
        return s_artFeePerToken;
    }

    function isCreationCodeApproved(bytes32 codeHash) external view returns (bool) {
        return s_approvedCreationCode[codeHash];
    }

    /// @notice Whether an address is a collection this factory deployed
    function isCollection(address collection) external view returns (bool) {
        return s_isCollection[collection];
    }

    /// @notice Amount a payer has paid for an art-generation job; zero if unpaid
    function jobPayment(bytes32 jobId, address payer) external view returns (uint256) {
        return s_jobPayment[jobId][payer];
    }

    /*//////////////////////////////////////////////////////////////
                           INTERNAL FUNCTIONS
    //////////////////////////////////////////////////////////////*/
    /// @dev Counts admins so the last one can never be removed, which would strand the factory's
    ///      balance and freeze every collection's fees.
    function _grantRole(bytes32 role, address account) internal override returns (bool granted) {
        granted = super._grantRole(role, account);
        if (granted && role == DEFAULT_ADMIN_ROLE) {
            s_adminCount++;
        }
    }

    function _revokeRole(bytes32 role, address account) internal override returns (bool revoked) {
        revoked = super._revokeRole(role, account);
        if (revoked && role == DEFAULT_ADMIN_ROLE) {
            if (--s_adminCount == 0) revert LastAdmin();
        }
    }

    function _salt(address deployer, bytes32 salt) private pure returns (bytes32) {
        return keccak256(abi.encode(deployer, salt));
    }
}
