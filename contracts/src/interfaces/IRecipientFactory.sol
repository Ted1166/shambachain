// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title IReceiptFactory
 * @notice Interface for the ShambaChain ReceiptFactory — the on-chain
 *         Commodity Receipt (oCR) NFT registry.
 * @dev Consumed by: CollateralVault, ForwardMarket, RiskOracle, RiskMarket.
 */
interface IReceiptFactory {

    // ─── ENUMS ───────────────────────────────────────────────────────────

    enum Grade  { A, B, C }
    enum Status { Active, LockedAsCollateral, Redeemed, Disputed }

    // ─── STRUCTS ──────────────────────────────────────────────────────────

    struct CommodityReceipt {
        uint256 tokenId;
        string  mpesaRef;          // MPESA STK Push transaction reference
        uint256 weightKg;          // commodity weight in kg
        Grade   grade;             // quality grade
        string  commodityType;     // e.g. "MAIZE"
        string  warehouseId;       // certified warehouse identifier
        uint256 valuationKes;      // current valuation in KES (18 decimals)
        uint256 issuedAt;          // block.timestamp at mint
        uint256 expiresAt;         // storage expiry timestamp
        Status  status;
        address farmer;            // farmer wallet / custodial address
        uint256 hcsSequenceNumber; // HCS audit trail reference
    }

    // ─── EVENTS ───────────────────────────────────────────────────────────

    event ReceiptMinted(
        uint256 indexed tokenId,
        address indexed farmer,
        string          mpesaRef,
        string          warehouseId,
        uint256         weightKg,
        uint256         valuationKes,
        uint256         hcsSequenceNumber
    );

    event ReceiptRedeemed(
        uint256 indexed tokenId,
        address indexed farmer,
        uint256         timestamp
    );

    event ReceiptLocked(uint256 indexed tokenId, address indexed vault);
    event ReceiptUnlocked(uint256 indexed tokenId, address indexed vault);

    event ValuationUpdated(
        uint256 indexed tokenId,
        uint256         oldValuationKes,
        uint256         newValuationKes
    );

    event ReceiptDisputed(
        uint256 indexed tokenId,
        address indexed reporter,
        string          reason
    );

    // ─── ERRORS ───────────────────────────────────────────────────────────

    error DuplicateMpesaRef(string mpesaRef);
    error ReceiptNotActive(uint256 tokenId, Status status);
    error ReceiptExpired(uint256 tokenId, uint256 expiry);
    error NotCollateralVault();
    error NotRiskOracle();
    error ZeroWeight();
    error InvalidWarehouse();
    error Unauthorized();

    // ─── WRITE ────────────────────────────────────────────────────────────

    function mintReceipt(
        address farmer,
        string  calldata mpesaRef,
        string  calldata warehouseId,
        uint256          weightKg,
        uint8            grade,
        string  calldata commodityType,
        uint256          valuationKes,
        uint256          expiresAt,
        uint256          hcsSequenceNumber
    ) external returns (uint256 tokenId);

    function lockReceipt(uint256 tokenId) external;

    function unlockReceipt(uint256 tokenId) external;

    function redeemReceipt(uint256 tokenId) external;

    function updateValuation(uint256 tokenId, uint256 newValuationKes) external;

    function updateGrade(uint256 tokenId, Grade newGrade) external;

    function disputeReceipt(uint256 tokenId, string calldata reason) external;

    // ─── READ ─────────────────────────────────────────────────────────────

    function getReceipt(uint256 tokenId) external view returns (CommodityReceipt memory);

    function getWarehouseReceipts(string calldata warehouseId) external view returns (uint256[] memory);

    function isActive(uint256 tokenId) external view returns (bool);

    function getValuation(uint256 tokenId) external view returns (uint256);

    function totalSupply() external view returns (uint256);
}
