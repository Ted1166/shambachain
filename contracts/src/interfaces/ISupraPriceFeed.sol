// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title ISupraPriceFeed
 * @notice Interface for the ShambaChain SupraPriceFeed — Supra pull oracle
 *         wrapper providing maize KES price to all protocol contracts.
 * @dev Consumed by: CollateralVault, RiskOracle, HedgePosition,
 *      and backend RiskAgent / PriceAgent.
 */
interface ISupraPriceFeed {

    // ─── EVENTS ───────────────────────────────────────────────────────────

    event PriceUpdated(
        uint256 newPriceKes,
        uint256 supraTimestamp,
        uint256 hcsSequence,
        address updatedBy
    );

    event ManualPriceSet(uint256 priceKes, address setBy);
    event TestnetModeToggled(bool enabled);
    event SupraOracleUpdated(address newOracle);

    // ─── ERRORS ───────────────────────────────────────────────────────────

    error PriceTooStale(uint256 priceAge, uint256 maxAge);
    error ZeroPrice();
    error PairNotFound(uint256 pairIndex);
    error EmptyProof();

    // ─── WRITE ────────────────────────────────────────────────────────────

    function updatePrice(bytes calldata supraProof, uint256 hcsSequence) external;

    function setManualPrice(uint256 priceKes) external;

    function setTestnetMode(bool enabled) external;

    // ─── READ ─────────────────────────────────────────────────────────────

    /**
     * @notice Get current maize price in KES (18 decimals).
     * @return price     KES per kg (18 decimals)
     * @return timestamp Timestamp of the last verified price
     */
    function getMaizePriceKes() external view returns (uint256 price, uint256 timestamp);

    /**
     * @notice Is the cached price older than STALENESS_THRESHOLD?
     * @dev CollateralVault reverts loan issuance when true (if oracleRequired).
     */
    function isStale() external view returns (bool);

    /// @notice Seconds since last price update
    function priceAge() external view returns (uint256);

    /// @notice Convert KES (18 decimals) to USDC-H (6 decimals) at protocol rate
    function kesTo6DecUsd(uint256 kes) external pure returns (uint256 usd);

    function getOracleInfo()
        external
        view
        returns (
            uint256 price,
            uint256 timestamp,
            uint256 ageSeconds,
            bool    stale,
            bool    inTestnetMode,
            uint256 updates,
            uint256 hcsSequence
        );

    function latestMaizePriceKes() external view returns (uint256);

    function latestPriceTimestamp() external view returns (uint256);

    function testnetMode() external view returns (bool);

    function updateCount() external view returns (uint256);
}
