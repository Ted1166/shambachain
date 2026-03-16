// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title ReceiptFactory
 * @author ShambaChain Protocol
 * @notice Mints and burns on-chain Commodity Receipts (oCR) as NFTs on Hedera EVM.
 *         Each oCR represents a verified physical grain deposit, bridged from
 *         an MPESA payment confirmation recorded on Hedera Consensus Service (HCS).
 *
 * @dev Hedera HTS native NFTs are the preferred production path, but this ERC-721
 *      implementation runs on Hedera EVM and is fully compatible with the
 *      JSON-RPC relay — giving us WalletConnect + MetaMask support out of the box.
 *
 * Flow:
 *   1. Farmer deposits grain at certified aggregator
 *   2. Pays deposit fee via MPESA STK Push
 *   3. Backend receives MPESA webhook → writes event to HCS topic
 *   4. Backend calls mintReceipt() on this contract
 *   5. oCR NFT minted to custodian address
 *   6. Farmer receives SMS: "Your receipt #SHM-XXXX is live"
 */

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Burnable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

contract ReceiptFactory is ERC721, ERC721URIStorage, ERC721Burnable, AccessControl {

    // ─── ROLES ────────────────────────────────────────────────────────────────
    bytes32 public constant MINTER_ROLE   = keccak256("MINTER_ROLE");   // backend service
    bytes32 public constant GRADER_ROLE   = keccak256("GRADER_ROLE");   // certified aggregator
    bytes32 public constant AUDITOR_ROLE  = keccak256("AUDITOR_ROLE");  // read-only audit access

    // ─── STATE ────────────────────────────────────────────────────────────────
    uint256 private _tokenIds;

    /// @notice Commodity grades: A = premium, B = standard, C = low
    enum Grade { A, B, C }

    /// @notice Redemption status of a receipt
    enum Status { Active, LockedAsCollateral, Redeemed, Disputed }

    struct CommodityReceipt {
        uint256 tokenId;
        string  commodityType;      // "MAIZE", "COFFEE", "TEA"
        uint256 weightKg;           // gross weight in kilograms
        Grade   grade;              // A / B / C
        string  warehouseId;        // certified aggregator ID e.g. "WH-NKR-001"
        string  mpesaRef;           // MPESA transaction reference
        uint256 hcsSequenceNumber;  // HCS topic sequence number for audit trail
        uint256 depositTimestamp;   // block.timestamp at mint
        uint256 expiryTimestamp;    // receipt validity period (default 180 days)
        Status  status;
        address farmer;             // original depositor (MPESA number mapped off-chain)
        uint256 valuationKes;       // last oracle valuation in KES (updated by RiskOracle)
    }

    /// @notice tokenId → receipt data
    mapping(uint256 => CommodityReceipt) public receipts;

    /// @notice warehouse → list of active receipt IDs
    mapping(string => uint256[]) public warehouseReceipts;

    /// @notice mpesaRef → tokenId (prevent duplicate mints)
    mapping(string => uint256) public mpesaRefToTokenId;

    /// @notice address authorized to lock receipts (CollateralVault)
    address public collateralVault;

    /// @notice address of the RiskOracle (updates valuations)
    address public riskOracle;

    /// @notice default receipt validity in seconds (180 days)
    uint256 public constant RECEIPT_VALIDITY = 180 days;

    /// @notice protocol-level receipt counter for human-readable IDs
    uint256 public totalMinted;
    uint256 public totalRedeemed;

    // ─── EVENTS ───────────────────────────────────────────────────────────────
    event ReceiptMinted(
        uint256 indexed tokenId,
        address indexed custodian,
        string  commodityType,
        uint256 weightKg,
        Grade   grade,
        string  warehouseId,
        string  mpesaRef,
        uint256 hcsSequenceNumber,
        uint256 valuationKes
    );

    event ReceiptRedeemed(
        uint256 indexed tokenId,
        address indexed redeemer,
        uint256 timestamp
    );

    event ReceiptLocked(
        uint256 indexed tokenId,
        address indexed vault
    );

    event ReceiptUnlocked(
        uint256 indexed tokenId,
        address indexed vault
    );

    event ValuationUpdated(
        uint256 indexed tokenId,
        uint256 oldValuation,
        uint256 newValuation
    );

    event ReceiptDisputed(
        uint256 indexed tokenId,
        string  reason
    );

    // ─── ERRORS ───────────────────────────────────────────────────────────────
    error DuplicateMpesaRef(string mpesaRef);
    error ReceiptNotActive(uint256 tokenId, Status status);
    error ReceiptExpired(uint256 tokenId, uint256 expiry);
    error NotCollateralVault();
    error NotRiskOracle();
    error ZeroWeight();
    error InvalidWarehouse();
    error Unauthorized();

    // ─── CONSTRUCTOR ──────────────────────────────────────────────────────────
    constructor(address admin) ERC721("ShambaChain Commodity Receipt", "oCR") {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);
    }

    // ─── ADMIN CONFIG ─────────────────────────────────────────────────────────

    function setCollateralVault(address vault) external onlyRole(DEFAULT_ADMIN_ROLE) {
        collateralVault = vault;
    }

    function setRiskOracle(address oracle) external onlyRole(DEFAULT_ADMIN_ROLE) {
        riskOracle = oracle;
    }

    // ─── CORE: MINT ───────────────────────────────────────────────────────────

    /**
     * @notice Mint a new on-chain Commodity Receipt (oCR)
     * @dev Called by backend service (MINTER_ROLE) after:
     *      1. MPESA STK Push confirmation received
     *      2. Deposit event written to HCS
     *      3. HCS sequence number returned
     *
     * @param custodian         Address to receive the NFT (protocol custodial wallet)
     * @param farmer            Original farmer identifier (mapped from MPESA number off-chain)
     * @param commodityType     Commodity string e.g. "MAIZE"
     * @param weightKg          Gross weight in kilograms
     * @param grade             Commodity grade (A/B/C)
     * @param warehouseId       Certified aggregator warehouse ID
     * @param mpesaRef          MPESA transaction reference (idempotency key)
     * @param hcsSequenceNumber Sequence number from HCS deposit event
     * @param initialValuationKes  Initial KES valuation from price oracle
     * @param metadataURI       IPFS URI containing full receipt metadata JSON
     */
    function mintReceipt(
        address custodian,
        address farmer,
        string  calldata commodityType,
        uint256 weightKg,
        Grade   grade,
        string  calldata warehouseId,
        string  calldata mpesaRef,
        uint256 hcsSequenceNumber,
        uint256 initialValuationKes,
        string  calldata metadataURI
    ) external onlyRole(MINTER_ROLE) returns (uint256 tokenId) {
        // ── Validations ──
        if (weightKg == 0) revert ZeroWeight();
        if (bytes(warehouseId).length == 0) revert InvalidWarehouse();
        if (mpesaRefToTokenId[mpesaRef] != 0) revert DuplicateMpesaRef(mpesaRef);

        // ── Mint ──
        _tokenIds++;
        tokenId = _tokenIds;

        _safeMint(custodian, tokenId);
        _setTokenURI(tokenId, metadataURI);

        // ── Store receipt data ──
        receipts[tokenId] = CommodityReceipt({
            tokenId:           tokenId,
            commodityType:     commodityType,
            weightKg:          weightKg,
            grade:             grade,
            warehouseId:       warehouseId,
            mpesaRef:          mpesaRef,
            hcsSequenceNumber: hcsSequenceNumber,
            depositTimestamp:  block.timestamp,
            expiryTimestamp:   block.timestamp + RECEIPT_VALIDITY,
            status:            Status.Active,
            farmer:            farmer,
            valuationKes:      initialValuationKes
        });

        // ── Indexes ──
        mpesaRefToTokenId[mpesaRef]   = tokenId;
        warehouseReceipts[warehouseId].push(tokenId);

        totalMinted++;

        emit ReceiptMinted(
            tokenId,
            custodian,
            commodityType,
            weightKg,
            grade,
            warehouseId,
            mpesaRef,
            hcsSequenceNumber,
            initialValuationKes
        );
    }

    // ─── CORE: LOCK / UNLOCK (CollateralVault) ────────────────────────────────

    /**
     * @notice Lock receipt as collateral — called by CollateralVault
     * @dev Only CollateralVault can lock. Prevents transfer while locked.
     */
    function lockReceipt(uint256 tokenId) external {
        if (msg.sender != collateralVault) revert NotCollateralVault();
        CommodityReceipt storage receipt = receipts[tokenId];
        if (receipt.status != Status.Active) revert ReceiptNotActive(tokenId, receipt.status);
        if (block.timestamp > receipt.expiryTimestamp) revert ReceiptExpired(tokenId, receipt.expiryTimestamp);

        receipt.status = Status.LockedAsCollateral;
        emit ReceiptLocked(tokenId, msg.sender);
    }

    /**
     * @notice Unlock receipt — called by CollateralVault on loan repayment
     */
    function unlockReceipt(uint256 tokenId) external {
        if (msg.sender != collateralVault) revert NotCollateralVault();
        receipts[tokenId].status = Status.Active;
        emit ReceiptUnlocked(tokenId, msg.sender);
    }

    // ─── CORE: REDEEM ─────────────────────────────────────────────────────────

    /**
     * @notice Redeem a receipt — farmer withdraws physical grain
     * @dev Burns the NFT. Called by custodian after physical grain release confirmed.
     *      The burn event on HCS (written by backend) closes the audit trail.
     */
    function redeemReceipt(uint256 tokenId) external {
        if (ownerOf(tokenId) != msg.sender && !hasRole(MINTER_ROLE, msg.sender)) {
            revert Unauthorized();
        }

        CommodityReceipt storage receipt = receipts[tokenId];
        if (receipt.status != Status.Active) revert ReceiptNotActive(tokenId, receipt.status);

        receipt.status = Status.Redeemed;
        totalRedeemed++;

        emit ReceiptRedeemed(tokenId, msg.sender, block.timestamp);

        // Burn the NFT — closes the on-chain lifecycle
        _burn(tokenId);
    }

    // ─── CORE: VALUATION UPDATE (RiskOracle) ─────────────────────────────────

    /**
     * @notice Update oCR valuation — called by RiskOracle / Sentinel layer
     * @dev This is the bridge between ShambaChain RWA layer and Sentinel risk layer.
     *      RiskOracle calls this after fetching latest Supra maize price.
     */
    function updateValuation(uint256 tokenId, uint256 newValuationKes) external {
        if (msg.sender != riskOracle && !hasRole(MINTER_ROLE, msg.sender)) {
            revert NotRiskOracle();
        }

        uint256 old = receipts[tokenId].valuationKes;
        receipts[tokenId].valuationKes = newValuationKes;

        emit ValuationUpdated(tokenId, old, newValuationKes);
    }

    // ─── GRADER: UPDATE GRADE ─────────────────────────────────────────────────

    /**
     * @notice Update commodity grade after physical inspection
     * @dev Called by certified aggregator (GRADER_ROLE)
     */
    function updateGrade(uint256 tokenId, Grade newGrade) external onlyRole(GRADER_ROLE) {
        CommodityReceipt storage receipt = receipts[tokenId];
        if (receipt.status == Status.Redeemed) revert ReceiptNotActive(tokenId, receipt.status);
        receipt.grade = newGrade;
    }

    // ─── DISPUTE ─────────────────────────────────────────────────────────────

    /**
     * @notice Flag a receipt as disputed (e.g. warehouse discrepancy)
     */
    function disputeReceipt(uint256 tokenId, string calldata reason)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        receipts[tokenId].status = Status.Disputed;
        emit ReceiptDisputed(tokenId, reason);
    }

    // ─── VIEWS ────────────────────────────────────────────────────────────────

    function getReceipt(uint256 tokenId)
        external
        view
        returns (CommodityReceipt memory)
    {
        return receipts[tokenId];
    }

    function getWarehouseReceipts(string calldata warehouseId)
        external
        view
        returns (uint256[] memory)
    {
        return warehouseReceipts[warehouseId];
    }

    function isActive(uint256 tokenId) external view returns (bool) {
        CommodityReceipt memory r = receipts[tokenId];
        return r.status == Status.Active && block.timestamp <= r.expiryTimestamp;
    }

    function getValuation(uint256 tokenId) external view returns (uint256) {
        return receipts[tokenId].valuationKes;
    }

    // ─── TRANSFER GUARD ───────────────────────────────────────────────────────

    /**
     * @dev Block transfers of locked receipts
     */
    function _update(address to, uint256 tokenId, address auth)
        internal override(ERC721)
        returns (address)
    {
        address from = _ownerOf(tokenId);
        if (from != address(0)) { // not a mint
            if (receipts[tokenId].status == Status.LockedAsCollateral) {
                revert ReceiptNotActive(tokenId, Status.LockedAsCollateral);
            }
        }
        return super._update(to, tokenId, auth);
    }

    // ─── OVERRIDES ────────────────────────────────────────────────────────────

    function tokenURI(uint256 tokenId)
        public view override(ERC721, ERC721URIStorage)
        returns (string memory)
    {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public view override(ERC721, ERC721URIStorage, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
