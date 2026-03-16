// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title IHedgePosition
 * @notice Interface for the ShambaChain HedgePosition — ERC-721 tokenized
 *         put options on maize commodity price.
 * @dev Consumed by: PriceAgent (auto-exercise), RiskAgent, LoanAgent
 *      (recommend hedge when opening loan), backend dashboards.
 */
interface IHedgePosition {

    // ─── ENUMS ───────────────────────────────────────────────────────────

    enum HedgeStatus { Active, Exercised, Expired, Cancelled }

    // ─── STRUCTS ──────────────────────────────────────────────────────────

    struct Hedge {
        uint256     hedgeId;
        uint256     ocrTokenId;
        address     buyer;
        uint256     weightKg;
        uint256     strikePriceKes;
        uint256     purchasePriceKes;
        uint256     premiumUsdcH;
        uint256     maxPayoutUsdcH;
        uint256     purchasedAt;
        uint256     expiryDate;
        HedgeStatus status;
        uint256     exercisedAt;
        uint256     payoutUsdcH;
        uint256     settlementPriceKes;
    }

    // ─── EVENTS ───────────────────────────────────────────────────────────

    event HedgePurchased(
        uint256 indexed hedgeId,
        uint256 indexed ocrTokenId,
        address indexed buyer,
        uint256         strikePriceKes,
        uint256         premiumUsdcH,
        uint256         maxPayoutUsdcH,
        uint256         expiryDate
    );

    event HedgeExercised(
        uint256 indexed hedgeId,
        address indexed buyer,
        uint256         settlementPriceKes,
        uint256         strikePriceKes,
        uint256         payoutUsdcH
    );

    event HedgeExpired(
        uint256 indexed hedgeId,
        uint256         settlementPriceKes,
        uint256         strikePriceKes
    );

    event LiquidityDeposited(address indexed lp, uint256 amount);
    event LiquidityWithdrawn(address indexed lp, uint256 amount);

    // ─── ERRORS ───────────────────────────────────────────────────────────

    error HedgeNotActive(uint256 hedgeId);
    error NotExpiredYet(uint256 hedgeId, uint256 expiryDate);
    error OutOfTheMoney(uint256 currentPriceKes, uint256 strikePriceKes);
    error InsufficientLpCollateral(uint256 required, uint256 available);
    error OraclePriceStale();
    error StrikeTooHigh(uint256 strikePriceKes, uint256 currentPriceKes);
    error StrikeTooLow(uint256 strikePriceKes);
    error InvalidDuration(uint256 duration, uint256 min, uint256 max);
    error ActiveHedgeExists(uint256 ocrTokenId, uint256 hedgeId);
    error NotHedgeBuyer();

    // ─── WRITE ────────────────────────────────────────────────────────────

    function depositLiquidity(uint256 amount) external;

    function withdrawLiquidity(uint256 amount) external;

    function buyHedge(
        uint256 ocrTokenId,
        uint256 weightKg,
        uint256 strikePriceKes,
        uint256 durationSecs
    ) external returns (uint256 hedgeId);

    function exerciseHedge(uint256 hedgeId) external;

    function expireHedge(uint256 hedgeId) external;

    // ─── READ ─────────────────────────────────────────────────────────────

    function getHedge(uint256 hedgeId) external view returns (Hedge memory);

    function getBuyerHedges(address buyer) external view returns (uint256[] memory);

    function estimatePayout(uint256 hedgeId)
        external
        view
        returns (uint256 estimatedUsdcH, bool inTheMoney);

    function availableLpCollateral() external view returns (uint256);

    function tokenActiveHedge(uint256 ocrTokenId) external view returns (uint256 hedgeId);

    function totalLpCollateral() external view returns (uint256);

    function totalOpenExposure() external view returns (uint256);
}
