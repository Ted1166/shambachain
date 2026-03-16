// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title IRiskOracle
 * @notice Interface for the ShambaChain RiskOracle — autonomous Supra price
 *         ingestion and oCR valuation propagation.
 * @dev Consumed by: CollateralVault (staleness check), HedgePosition,
 *      RiskMarket, backend RiskAgent.
 */
interface IRiskOracle {

    // ─── STRUCTS ──────────────────────────────────────────────────────────

    struct OracleConfig {
        uint256 maizeKesPerKg;
        bool    useSupraPrice;
        uint256 stalePriceThreshold;
        uint256 updateThresholdBps;
    }

    // ─── EVENTS ───────────────────────────────────────────────────────────

    event ValuationUpdated(
        uint256 indexed tokenId,
        uint256         oldKes,
        uint256         newKes,
        uint256         maizePriceKes,
        uint256         timestamp
    );

    event PriceVerified(
        uint256 maizePriceKes,
        uint256 supraTimestamp,
        uint256 hcsSequence
    );

    event BatchUpdateCompleted(
        uint256 tokenCount,
        uint256 updatedCount,
        uint256 timestamp
    );

    event OracleConfigUpdated(OracleConfig config);
    event FallbackPriceSet(uint256 maizeKesPerKg, address setBy);

    // ─── ERRORS ───────────────────────────────────────────────────────────

    error PriceTooStale(uint256 priceAge, uint256 maxAge);
    error ZeroPrice();
    error InvalidTokenIds();
    error SupraProofRequired();
    error BatchTooLarge(uint256 provided, uint256 maxAllowed);

    // ─── WRITE ────────────────────────────────────────────────────────────

    function triggerValuationUpdate(
        uint256[] calldata tokenIds,
        bytes     calldata supraProof,
        uint256            hcsSequence
    ) external;

    function updateSingleValuation(uint256 tokenId, bytes calldata supraProof) external;

    function setManualPrice(uint256 maizeKesPerKg) external;

    function updateOracleConfig(OracleConfig calldata cfg) external;

    // ─── READ ─────────────────────────────────────────────────────────────

    function isPriceStale() external view returns (bool);

    function getLatestPrice()
        external
        view
        returns (uint256 price, uint256 timestamp, bool stale);

    function previewValuation(uint256 tokenId) external view returns (uint256 estimatedKes);

    function latestMaizeKes() external view returns (uint256);

    function latestPriceTimestamp() external view returns (uint256);

    function lastValuationKes(uint256 tokenId) external view returns (uint256);

    function lastUpdateTimestamp(uint256 tokenId) external view returns (uint256);

    function oracleConfig() external view returns (OracleConfig memory);
}
