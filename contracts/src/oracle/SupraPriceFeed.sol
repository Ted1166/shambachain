// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title SupraPriceFeed
 * @author ShambaChain Protocol
 * @notice Wrapper around the Supra Pull Oracle for Hedera EVM.
 *         Provides clean price access for CollateralVault, RiskOracle,
 *         and HedgePosition contracts.
 *
 * @dev Supra Pull Oracle on Hedera:
 *      - Testnet:  0x2fa6DbFe4291136Cf272E1A3294362b6651e8517
 *      - Mainnet:  TBD (check https://supraoracles.com/docs/data-feeds/networks)
 *
 *      Pull Oracle flow:
 *        1. Off-chain: call Supra API to get latest proof bytes for pair(s)
 *        2. On-chain: verifyOracleProof(proofBytes) --> PriceData
 *        3. Cache verified price on-chain with timestamp
 *        4. Other contracts call getMaizePriceKes() for the cached price
 *
 *      Pair indices (Supra):
 *        - 0:   BTC/USD  (testnet placeholder for MAIZE/KES)
 *        - 49:  KES/USD  (FX conversion on mainnet)
 *        - TBD: MAIZE/KES (mainnet, when available)
 *
 *      Testnet note: MAIZE/KES may not exist on Supra testnet.
 *      Set testnetMode=true and call setManualPrice() for realistic
 *      maize pricing during hackathon demo. RiskAgent handles this.
 */

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

// ─── INTERFACES ─────────────────────────────────────────────────────────────

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

// ─── CONTRACT ────────────────────────────────────────────────────────────────

contract SupraPriceFeed is AccessControl, Pausable {

    // ─── ROLES ────────────────────────────────────────────────────────────
    bytes32 public constant UPDATER_ROLE = keccak256("UPDATER_ROLE");

    // ─── CONSTANTS ────────────────────────────────────────────────────────

    /// @notice Supra pair index for the primary price (MAIZE/KES or testnet placeholder)
    uint256 public constant PRIMARY_PAIR_INDEX  = 0;

    /// @notice Supra pair index for KES/USD FX rate
    uint256 public constant KES_USD_PAIR_INDEX  = 49;

    /// @notice Price freshness window
    uint256 public constant STALENESS_THRESHOLD = 3600;  // 1 hour

    /// @notice Output precision
    uint256 public constant PRICE_DECIMALS = 18;

    // ─── STATE ────────────────────────────────────────────────────────────

    ISupraOraclePull public supraOracle;

    /// @notice Cached maize price in KES (18 decimals)
    uint256 public latestMaizePriceKes;

    /// @notice Timestamp of the Supra proof that set this price
    uint256 public latestPriceTimestamp;

    /// @notice Block number when price was last cached on-chain
    uint256 public lastUpdateBlock;

    /// @notice HCS sequence number of the proof submission (for audit trail)
    uint256 public latestHcsSequence;

    /// @notice Testnet mode: use manual price, skip proof verification
    bool public testnetMode;

    /// @notice Manual fallback price for testnet (KES per kg, 18 decimals)
    uint256 public manualMaizePriceKes;

    /// @notice Total successful price updates
    uint256 public updateCount;

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

    // ─── CONSTRUCTOR ──────────────────────────────────────────────────────

    /**
     * @param admin             Protocol admin
     * @param _supraOracle      Supra pull oracle address on Hedera
     *                          Testnet: 0x2fa6DbFe4291136Cf272E1A3294362b6651e8517
     * @param _initialPriceKes  Initial manual price (e.g. 45e18 = 45 KES/kg)
     * @param _testnetMode      true = skip Supra proof, use manual price
     */
    constructor(
        address admin,
        address _supraOracle,
        uint256 _initialPriceKes,
        bool    _testnetMode
    ) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(UPDATER_ROLE, admin);

        supraOracle         = ISupraOraclePull(_supraOracle);
        manualMaizePriceKes = _initialPriceKes > 0 ? _initialPriceKes : 45e18;
        testnetMode         = _testnetMode;

        // Initialize with manual price so contracts work from block 0
        latestMaizePriceKes  = manualMaizePriceKes;
        latestPriceTimestamp = block.timestamp;
    }

    // ─── CORE: UPDATE PRICE FROM SUPRA PROOF ──────────────────────────────

    /**
     * @notice Verify Supra proof and cache maize price on-chain.
     * @dev Called by RiskAgent before any price-sensitive operation.
     *      In testnetMode=true: proof ignored, manual price used.
     *
     *      Off-chain fetch proof (Node.js / backend):
     *        const sdk = new SupraClient("https://rpc.supraoracles.com/rpc/v1");
     *        const proof = await sdk.getProofForPair([PRIMARY_PAIR_INDEX]);
     *
     * @param supraProof   Raw proof bytes from Supra API
     * @param hcsSequence  HCS sequence number of the trigger message
     */
    function updatePrice(
        bytes   calldata supraProof,
        uint256          hcsSequence
    )
        external
        whenNotPaused
        onlyRole(UPDATER_ROLE)
    {
        if (testnetMode) {
            // Testnet: refresh timestamp, use manual price
            latestMaizePriceKes  = manualMaizePriceKes;
            latestPriceTimestamp = block.timestamp;
            latestHcsSequence    = hcsSequence;
            lastUpdateBlock      = block.number;
            updateCount++;

            emit PriceUpdated(
                latestMaizePriceKes,
                block.timestamp,
                hcsSequence,
                msg.sender
            );
            return;
        }

        if (supraProof.length == 0) revert EmptyProof();

        // Verify Supra proof
        ISupraOraclePull.PriceData memory pd =
            supraOracle.verifyOracleProof(supraProof);

        // Extract primary pair price
        uint256 rawPrice;
        uint256 rawDecimals;
        uint256 rawTimestamp;
        bool    found;

        for (uint256 i; i < pd.pairs.length; ++i) {
            if (pd.pairs[i] == PRIMARY_PAIR_INDEX) {
                rawPrice     = pd.prices[i];
                rawDecimals  = pd.decimals[i];
                rawTimestamp = pd.timestamp[i];
                found        = true;
                break;
            }
        }

        if (!found)       revert PairNotFound(PRIMARY_PAIR_INDEX);
        if (rawPrice == 0) revert ZeroPrice();

        // Check freshness
        uint256 age = block.timestamp - rawTimestamp;
        if (age > STALENESS_THRESHOLD) revert PriceTooStale(age, STALENESS_THRESHOLD);

        // Normalize to 18 decimals
        uint256 normalized;
        if (rawDecimals < PRICE_DECIMALS) {
            normalized = rawPrice * (10 ** (PRICE_DECIMALS - rawDecimals));
        } else {
            normalized = rawPrice / (10 ** (rawDecimals - PRICE_DECIMALS));
        }

        // Production note: if PRIMARY_PAIR_INDEX is MAIZE/USD (not MAIZE/KES),
        // fetch KES_USD_PAIR_INDEX from same proof and multiply:
        //   uint256 kesPerUsd = extractPair(pd, KES_USD_PAIR_INDEX);
        //   uint256 maizeKes  = normalized * kesPerUsd / 1e18;
        // For testnet, treat normalized price directly as KES price.

        latestMaizePriceKes  = normalized;
        latestPriceTimestamp = rawTimestamp;
        latestHcsSequence    = hcsSequence;
        lastUpdateBlock      = block.number;
        updateCount++;

        emit PriceUpdated(normalized, rawTimestamp, hcsSequence, msg.sender);
    }

    // ─── ADMIN: MANUAL PRICE ──────────────────────────────────────────────

    /**
     * @notice Set manual fallback price (testnet or emergency override).
     * @dev Price is KES per kg with 18 decimals.
     *      Example: 45 KES/kg = 45e18
     *      Nakuru maize market reference: ~40-50 KES/kg (2025)
     *
     * @param priceKes  New manual price (KES per kg, 18 decimals)
     */
    function setManualPrice(uint256 priceKes)
        external
        onlyRole(UPDATER_ROLE)
    {
        if (priceKes == 0) revert ZeroPrice();
        manualMaizePriceKes = priceKes;

        if (testnetMode) {
            latestMaizePriceKes  = priceKes;
            latestPriceTimestamp = block.timestamp;
        }

        emit ManualPriceSet(priceKes, msg.sender);
    }

    function setTestnetMode(bool enabled)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        testnetMode = enabled;
        if (enabled) {
            latestMaizePriceKes  = manualMaizePriceKes;
            latestPriceTimestamp = block.timestamp;
        }
        emit TestnetModeToggled(enabled);
    }

    function setSupraOracle(address _supraOracle)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        supraOracle = ISupraOraclePull(_supraOracle);
        emit SupraOracleUpdated(_supraOracle);
    }

    function pause()   external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    // ─── VIEWS ────────────────────────────────────────────────────────────

    /**
     * @notice Get current maize price in KES (18 decimals).
     * @dev Primary interface for CollateralVault, RiskOracle, HedgePosition.
     * @return price     KES per kg (18 decimals)
     * @return timestamp When this price was set
     */
    function getMaizePriceKes()
        external
        view
        returns (uint256 price, uint256 timestamp)
    {
        return (latestMaizePriceKes, latestPriceTimestamp);
    }

    /**
     * @notice Is the cached price stale?
     * @dev CollateralVault reverts loan issuance when true (if oracleRequired).
     */
    function isStale() external view returns (bool) {
        return block.timestamp - latestPriceTimestamp > STALENESS_THRESHOLD;
    }

    /// @notice Age of current price in seconds
    function priceAge() external view returns (uint256) {
        return block.timestamp - latestPriceTimestamp;
    }

    /**
     * @notice Convert KES (18 decimals) to USDC-H (6 decimals).
     * @dev Testnet: fixed 130 KES/USD.
     *      Production: use Supra KES/USD feed from same proof.
     */
    function kesTo6DecUsd(uint256 kes) external pure returns (uint256 usd) {
        usd = kes / (130 * 1e12);
    }

    /**
     * @notice Full oracle info for dashboards and agents.
     */
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
        )
    {
        price         = latestMaizePriceKes;
        timestamp     = latestPriceTimestamp;
        ageSeconds    = block.timestamp - latestPriceTimestamp;
        stale         = ageSeconds > STALENESS_THRESHOLD;
        inTestnetMode = testnetMode;
        updates       = updateCount;
        hcsSequence   = latestHcsSequence;
    }
}
