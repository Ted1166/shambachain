// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title RiskOracle
 * @author ShambaChain Protocol — Sentinel Layer
 * @notice Autonomous risk oracle that ingests Supra price data and pushes
 *         updated valuations into ReceiptFactory for every active oCR NFT.
 *
 * @dev Adapted from the original Sentinel RiskOracle.sol for Hedera EVM.
 *      Key changes vs original:
 *        - Replaces Chainlink with Supra pull oracle (ISupraOraclePull)
 *        - Adds updateValuation() bridge to ReceiptFactory
 *        - HCS sequence numbers stored per-update for audit trail
 *        - RiskAgent (OpenClaw) calls triggerValuationUpdate() on a cron
 *        - CollateralVault.checkLoanHealth() calls back into this when
 *          a ValuationAlert is emitted
 *
 * Architecture:
 *   RiskAgent (off-chain OpenClaw)
 *       │
 *       ▼  triggerValuationUpdate(tokenIds[], proofBytes)
 *   RiskOracle.sol
 *       │  ① verify Supra proof → extract maize KES price
 *       │  ② compute new oCR valuations
 *       │  ③ call ReceiptFactory.updateValuation(tokenId, newKes)
 *       │  ④ call CollateralVault.checkLoanHealth(loanId)  [if collateral]
 *       └─ emit ValuationUpdated(tokenId, oldKes, newKes, priceKes)
 */

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

// ─── INTERFACES ─────────────────────────────────────────────────────────────

/// @notice Minimal Supra pull oracle interface (v3 proof verification)
interface ISupraOraclePull {
    struct PriceData {
        uint256[] pairs;
        uint256[] prices;
        uint256[] decimals;
        uint256[] timestamp;
    }

    function verifyOracleProof(bytes calldata _bytesproof)
        external
        returns (PriceData memory);
}

/// @notice ReceiptFactory interface — only what RiskOracle needs
interface IReceiptFactory {
    function updateValuation(uint256 tokenId, uint256 newValuationKes) external;
    function getValuation(uint256 tokenId) external view returns (uint256);
    function isActive(uint256 tokenId) external view returns (bool);
    function totalSupply() external view returns (uint256);
}

/// @notice CollateralVault interface — health check trigger
interface ICollateralVault {
    function checkLoanHealth(uint256 loanId) external;
    function tokenToLoan(uint256 tokenId) external view returns (uint256);
}

// ─── CONTRACT ────────────────────────────────────────────────────────────────

contract RiskOracle is AccessControl, ReentrancyGuard, Pausable {

    // ─── ROLES ────────────────────────────────────────────────────────────
    bytes32 public constant RISK_AGENT_ROLE  = keccak256("RISK_AGENT_ROLE");
    bytes32 public constant KEEPER_ROLE      = keccak256("KEEPER_ROLE");

    // ─── CONSTANTS ────────────────────────────────────────────────────────

    /// @notice Supra pair index for MAIZE/KES
    /// @dev Testnet: use pair 0 (BTC/USD) as placeholder; mainnet: actual MAIZE/KES pair
    uint256 public constant MAIZE_KES_PAIR_INDEX = 0;

    /// @notice Weight per kg in KES used for oCR valuation
    /// @dev Base rate; actual = supraPrice * weightKg * qualityMultiplier
    uint256 public constant KES_DECIMALS = 18;

    /// @notice Maximum staleness allowed for a price (seconds)
    uint256 public constant MAX_PRICE_AGE = 3600; // 1 hour

    /// @notice Minimum price movement to trigger on-chain update (basis points)
    uint256 public constant MIN_UPDATE_THRESHOLD_BPS = 50; // 0.5%

    uint256 public constant BPS_DENOMINATOR = 10_000;

    // ─── STATE ────────────────────────────────────────────────────────────

    /// @notice Supra pull oracle contract
    ISupraOraclePull public supraOracle;

    /// @notice ReceiptFactory — valuations written here
    IReceiptFactory public receiptFactory;

    /// @notice CollateralVault — health checks triggered here
    ICollateralVault public collateralVault;

    /// @notice Latest verified maize price in KES (18 decimals)
    uint256 public latestMaizeKes;

    /// @notice Timestamp of last verified price
    uint256 public latestPriceTimestamp;

    /// @notice HCS sequence number of last update (written by off-chain indexer)
    uint256 public latestHcsSequence;

    /// @notice tokenId → last valuation KES at time of update
    mapping(uint256 => uint256) public lastValuationKes;

    /// @notice tokenId → timestamp of last valuation update
    mapping(uint256 => uint256) public lastUpdateTimestamp;

    /// @notice Cumulative update count (for agent metrics)
    uint256 public totalUpdates;

    /// @notice Number of ReceiptFactory.updateValuation() calls made
    uint256 public totalValuationPushes;

    // ─── ORACLE CONFIG ────────────────────────────────────────────────────

    struct OracleConfig {
        uint256 maizeKesPerKg;       // fallback manual price (KES per kg, 18 dec)
        bool    useSupraPrice;       // if false: use manual price
        uint256 stalePriceThreshold; // seconds before price considered stale
        uint256 updateThresholdBps;  // minimum price move to trigger update
    }

    OracleConfig public oracleConfig;

    // ─── EVENTS ───────────────────────────────────────────────────────────

    event ValuationUpdated(
        uint256 indexed tokenId,
        uint256 oldKes,
        uint256 newKes,
        uint256 maizePriceKes,
        uint256 timestamp
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

    // ─── CONSTRUCTOR ──────────────────────────────────────────────────────

    constructor(
        address admin,
        address _supraOracle,
        address _receiptFactory,
        address _collateralVault
    ) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(RISK_AGENT_ROLE, admin);
        _grantRole(KEEPER_ROLE, admin);

        supraOracle     = ISupraOraclePull(_supraOracle);
        receiptFactory  = IReceiptFactory(_receiptFactory);
        collateralVault = ICollateralVault(_collateralVault);

        // Default config: use manual price until Supra MAIZE/KES pair live
        oracleConfig = OracleConfig({
            maizeKesPerKg:       45e18,    // 45 KES/kg (Nakuru spot approx)
            useSupraPrice:       false,    // flip to true when pair is live
            stalePriceThreshold: MAX_PRICE_AGE,
            updateThresholdBps:  MIN_UPDATE_THRESHOLD_BPS
        });

        // Set a reasonable initial price
        latestMaizeKes      = 45e18;
        latestPriceTimestamp = block.timestamp;
    }

    // ─── CORE: TRIGGER BATCH VALUATION UPDATE ─────────────────────────────

    /**
     * @notice RiskAgent calls this on a cron (every 15 min during market hours).
     * @dev If useSupraPrice=true: verifies Supra proof first, extracts price.
     *      If useSupraPrice=false: uses oracleConfig.maizeKesPerKg as fallback.
     *      Then iterates tokenIds and pushes new valuations to ReceiptFactory.
     *      For any tokenId that is locked as collateral, also triggers
     *      CollateralVault.checkLoanHealth() to catch undercollateralized loans.
     *
     * @param tokenIds      List of oCR tokenIds to update (max 50 per call)
     * @param supraProof    Supra proof bytes (pass empty bytes if useSupraPrice=false)
     * @param hcsSequence   HCS sequence number of the trigger event (for audit)
     */
    function triggerValuationUpdate(
        uint256[]  calldata tokenIds,
        bytes      calldata supraProof,
        uint256             hcsSequence
    )
        external
        nonReentrant
        whenNotPaused
        onlyRole(RISK_AGENT_ROLE)
    {
        if (tokenIds.length == 0)  revert InvalidTokenIds();
        if (tokenIds.length > 50)  revert BatchTooLarge(tokenIds.length, 50);

        // ── Step 1: Get current maize price ──
        uint256 maizeKes = _resolvePrice(supraProof);

        latestHcsSequence = hcsSequence;
        totalUpdates++;

        // ── Step 2: Update valuations ──
        uint256 updatedCount;

        for (uint256 i; i < tokenIds.length; ++i) {
            uint256 tokenId = tokenIds[i];

            if (!receiptFactory.isActive(tokenId)) continue;

            uint256 oldKes = lastValuationKes[tokenId];
            uint256 newKes = _computeValuation(tokenId, maizeKes);

            // Skip if price move is below threshold (save gas)
            if (oldKes != 0) {
                uint256 moveBps = _priceMoveAbsBps(oldKes, newKes);
                if (moveBps < oracleConfig.updateThresholdBps) continue;
            }

            // Push to ReceiptFactory
            receiptFactory.updateValuation(tokenId, newKes);

            lastValuationKes[tokenId]    = newKes;
            lastUpdateTimestamp[tokenId] = block.timestamp;
            totalValuationPushes++;
            updatedCount++;

            emit ValuationUpdated(tokenId, oldKes, newKes, maizeKes, block.timestamp);

            // Check loan health if tokenId is collateral
            uint256 loanId = collateralVault.tokenToLoan(tokenId);
            if (loanId != 0) {
                // External call — non-reverting to not block batch
                try collateralVault.checkLoanHealth(loanId) {} catch {}
            }
        }

        emit BatchUpdateCompleted(tokenIds.length, updatedCount, block.timestamp);
    }

    /**
     * @notice Single-token update — used by CollateralVault or admin for
     *         immediate re-pricing of a specific oCR.
     */
    function updateSingleValuation(
        uint256 tokenId,
        bytes   calldata supraProof
    )
        external
        nonReentrant
        whenNotPaused
    {
        // Allow RISK_AGENT_ROLE, KEEPER_ROLE, or CollateralVault itself
        require(
            hasRole(RISK_AGENT_ROLE, msg.sender) ||
            hasRole(KEEPER_ROLE, msg.sender)      ||
            msg.sender == address(collateralVault),
            "RiskOracle: unauthorized"
        );

        if (!receiptFactory.isActive(tokenId)) return;

        uint256 maizeKes = _resolvePrice(supraProof);
        uint256 oldKes   = lastValuationKes[tokenId];
        uint256 newKes   = _computeValuation(tokenId, maizeKes);

        receiptFactory.updateValuation(tokenId, newKes);

        lastValuationKes[tokenId]    = newKes;
        lastUpdateTimestamp[tokenId] = block.timestamp;
        totalValuationPushes++;

        emit ValuationUpdated(tokenId, oldKes, newKes, maizeKes, block.timestamp);
    }

    // ─── ADMIN: MANUAL PRICE OVERRIDE ─────────────────────────────────────

    /**
     * @notice Set manual fallback price (used when useSupraPrice=false).
     * @dev RiskAgent calls this when Supra MAIZE/KES pair is unavailable.
     *      Kept at 18 decimals to match oCR valuation units.
     *
     * @param maizeKesPerKg  New price in KES per kg (18 decimals)
     */
    function setManualPrice(uint256 maizeKesPerKg)
        external
        onlyRole(RISK_AGENT_ROLE)
    {
        if (maizeKesPerKg == 0) revert ZeroPrice();
        oracleConfig.maizeKesPerKg = maizeKesPerKg;
        latestMaizeKes             = maizeKesPerKg;
        latestPriceTimestamp       = block.timestamp;

        emit FallbackPriceSet(maizeKesPerKg, msg.sender);
    }

    function updateOracleConfig(OracleConfig calldata cfg)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        oracleConfig = cfg;
        emit OracleConfigUpdated(cfg);
    }

    function setSupraOracle(address _supraOracle)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        supraOracle = ISupraOraclePull(_supraOracle);
    }

    function setCollateralVault(address _vault)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        collateralVault = ICollateralVault(_vault);
    }

    function pause()   external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    // ─── VIEWS ────────────────────────────────────────────────────────────

    /// @notice Is the current price stale?
    function isPriceStale() public view returns (bool) {
        return block.timestamp - latestPriceTimestamp > oracleConfig.stalePriceThreshold;
    }

    /// @notice Get latest maize price (KES, 18 decimals) + staleness flag
    function getLatestPrice()
        external
        view
        returns (uint256 price, uint256 timestamp, bool stale)
    {
        return (latestMaizeKes, latestPriceTimestamp, isPriceStale());
    }

    /// @notice Estimate valuation for a given tokenId at current price
    function previewValuation(uint256 tokenId)
        external
        view
        returns (uint256 estimatedKes)
    {
        return _computeValuation(tokenId, latestMaizeKes);
    }

    // ─── INTERNAL ─────────────────────────────────────────────────────────

    /**
     * @dev Resolve price: verify Supra proof OR use manual fallback.
     */
    function _resolvePrice(bytes calldata supraProof)
        internal
        returns (uint256 maizeKes)
    {
        if (oracleConfig.useSupraPrice) {
            if (supraProof.length == 0) revert SupraProofRequired();

            ISupraOraclePull.PriceData memory pd =
                supraOracle.verifyOracleProof(supraProof);

            // Extract MAIZE/KES pair price
            uint256 rawPrice;
            uint256 decimals;
            for (uint256 i; i < pd.pairs.length; ++i) {
                if (pd.pairs[i] == MAIZE_KES_PAIR_INDEX) {
                    rawPrice = pd.prices[i];
                    decimals = pd.decimals[i];

                    // Check timestamp freshness
                    uint256 age = block.timestamp - pd.timestamp[i];
                    if (age > oracleConfig.stalePriceThreshold) {
                        revert PriceTooStale(age, oracleConfig.stalePriceThreshold);
                    }

                    latestPriceTimestamp = pd.timestamp[i];
                    break;
                }
            }

            if (rawPrice == 0) revert ZeroPrice();

            // Normalize to 18 decimals
            if (decimals < 18) {
                maizeKes = rawPrice * (10 ** (18 - decimals));
            } else {
                maizeKes = rawPrice / (10 ** (decimals - 18));
            }

            latestMaizeKes = maizeKes;
            emit PriceVerified(maizeKes, latestPriceTimestamp, latestHcsSequence);

        } else {
            // Fallback: manual price set by RiskAgent
            maizeKes = oracleConfig.maizeKesPerKg;
            latestMaizeKes = maizeKes;
        }
    }

    /**
     * @dev Compute oCR valuation in KES (18 decimals).
     *      In production: pull weightKg and qualityGrade from ReceiptFactory.
     *      For MVP: use a simplified flat valuation based on stored valuation
     *      scaled by the new price vs the stored price.
     *
     *      Formula: newValuation = storedValuation * (newPrice / oldPrice)
     *      If no prior valuation: newValuation = latestMaizeKes * 200 (200kg default)
     */
    function _computeValuation(
        uint256 tokenId,
        uint256 maizeKes
    )
        internal
        view
        returns (uint256 newKes)
    {
        uint256 currentKes = receiptFactory.getValuation(tokenId);

        if (currentKes == 0 || latestMaizeKes == 0) {
            // No prior valuation — assign based on default 200kg lot
            newKes = maizeKes * 200;
        } else {
            // Scale existing valuation proportionally to price move
            newKes = (currentKes * maizeKes) / latestMaizeKes;
        }
    }

    /**
     * @dev Calculate absolute price move in basis points.
     */
    function _priceMoveAbsBps(uint256 a, uint256 b)
        internal
        pure
        returns (uint256 bps)
    {
        if (a == 0) return BPS_DENOMINATOR; // treat as 100% move
        uint256 diff = a > b ? a - b : b - a;
        bps = (diff * BPS_DENOMINATOR) / a;
    }
}
