// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title HedgePosition
 * @author ShambaChain Protocol — Sentinel Layer
 * @notice ERC-721 tokenized hedge position that allows oCR NFT holders to
 *         purchase price protection against maize price drops.
 *
 * @dev Ported and adapted from Sentinel HedgePosition.sol for ShambaChain.
 *      Each HedgePosition NFT represents the right to receive a payout if the
 *      maize price falls below the strike price at expiry.
 *
 *      This is a simplified covered put option:
 *        - Buyer (farmer): pays premium in USDC-H → receives HedgePosition NFT
 *        - Seller (protocol / LPs): provides USDC-H collateral to back payouts
 *        - If price < strike at expiry → buyer exercises → receives payout
 *        - If price >= strike at expiry → position expires worthless
 *
 *      ShambaChain-specific features:
 *        - Linked to a specific oCR tokenId (the underlying commodity receipt)
 *        - RiskOracle provides the settlement price
 *        - LoanAgent can recommend hedging when it opens a loan
 *        - PriceAgent monitors and auto-exercises in-the-money positions
 *        - SHAMBA token holders: 10% discount on premiums
 *
 *      Capital efficiency:
 *        - Hedge payout = (strikeKes - currentKes) * weightKg
 *        - Capped at 50% of notional (prevents extreme downside)
 *        - Minimum payout: 1 USDC-H
 *
 * Example:
 *   Farmer deposits 200kg maize. Oracle: 45 KES/kg. Notional: 9,000 KES.
 *   Farmer buys hedge: strike = 40 KES/kg, expiry = 90 days, premium = 300 KES.
 *   At expiry, price = 35 KES/kg:
 *     Payout = (40 - 35) * 200 = 1,000 KES → ~$7.69 USDC-H
 *   Farmer's loss on commodity is offset by hedge payout.
 */

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Burnable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

// ─── INTERFACES ─────────────────────────────────────────────────────────────

interface IRiskOracleForHedge {
    function latestMaizeKes() external view returns (uint256);
    function latestPriceTimestamp() external view returns (uint256);
    function isPriceStale() external view returns (bool);
}

interface IShambaTokenForHedge {
    function balanceOf(address account) external view returns (uint256);
}

// ─── CONTRACT ────────────────────────────────────────────────────────────────

contract HedgePosition is ERC721, ERC721Burnable, AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ─── ROLES ────────────────────────────────────────────────────────────
    bytes32 public constant PRICE_AGENT_ROLE = keccak256("PRICE_AGENT_ROLE");
    bytes32 public constant LP_ROLE          = keccak256("LP_ROLE");

    // ─── CONSTANTS ────────────────────────────────────────────────────────
    uint256 public constant MAX_PAYOUT_BPS      = 5_000;  // 50% of notional max payout
    uint256 public constant PROTOCOL_FEE_BPS    = 200;    // 2% of premium to treasury
    uint256 public constant SHAMBA_DISCOUNT_BPS = 1_000;  // 10% discount for SHAMBA holders
    uint256 public constant SHAMBA_THRESHOLD     = 100e18; // 100 SHAMBA to qualify
    uint256 public constant BPS_DENOMINATOR      = 10_000;
    uint256 public constant MIN_HEDGE_DURATION   = 7 days;
    uint256 public constant MAX_HEDGE_DURATION   = 180 days;
    uint256 public constant KES_USD_RATE         = 130;    // 1 USD = 130 KES (testnet)

    // ─── ENUMS ────────────────────────────────────────────────────────────

    enum HedgeStatus {
        Active,     // purchased, awaiting expiry
        Exercised,  // exercised in-the-money, payout sent
        Expired,    // expired out-of-the-money (worthless)
        Cancelled   // cancelled before expiry (refund issued)
    }

    // ─── STRUCTS ──────────────────────────────────────────────────────────

    struct Hedge {
        uint256   hedgeId;
        uint256   ocrTokenId;       // underlying oCR NFT
        address   buyer;            // farmer who purchased hedge
        uint256   weightKg;         // commodity weight in kg (from oCR)
        uint256   strikePriceKes;   // strike price (KES per kg, 18 decimals)
        uint256   purchasePriceKes; // oracle price at purchase time (18 dec)
        uint256   premiumUsdcH;     // premium paid (6 decimals)
        uint256   maxPayoutUsdcH;   // capped maximum payout (6 decimals)
        uint256   purchasedAt;      // block.timestamp
        uint256   expiryDate;       // unix timestamp
        HedgeStatus status;
        uint256   exercisedAt;      // 0 if not exercised
        uint256   payoutUsdcH;      // actual payout (0 if not exercised)
        uint256   settlementPriceKes; // oracle price at exercise/expiry
    }

    // ─── STATE ────────────────────────────────────────────────────────────

    uint256 private _hedgeIds;

    /// @notice hedgeId → Hedge
    mapping(uint256 => Hedge) public hedges;

    /// @notice buyer → hedgeIds
    mapping(address => uint256[]) public buyerHedges;

    /// @notice ocrTokenId → active hedgeId (0 = none)
    mapping(uint256 => uint256) public tokenActiveHedge;

    /// @notice Protocol contracts
    IERC20                  public immutable usdcH;
    IRiskOracleForHedge     public riskOracle;
    IShambaTokenForHedge    public shambaToken;

    /// @notice LP vault — provides USDC-H to back hedge payouts
    address public lpVault;

    /// @notice Protocol treasury
    address public treasury;

    // LP accounting
    uint256 public totalLpCollateral;     // USDC-H deposited by LPs
    uint256 public totalOpenExposure;     // max possible payouts outstanding

    // Stats
    uint256 public totalHedgesSold;
    uint256 public totalPremiumsCollected;
    uint256 public totalPayoutsIssued;
    uint256 public totalFeesCollected;

    // ─── EVENTS ───────────────────────────────────────────────────────────

    event HedgePurchased(
        uint256 indexed hedgeId,
        uint256 indexed ocrTokenId,
        address indexed buyer,
        uint256 strikePriceKes,
        uint256 premiumUsdcH,
        uint256 maxPayoutUsdcH,
        uint256 expiryDate
    );

    event HedgeExercised(
        uint256 indexed hedgeId,
        address indexed buyer,
        uint256 settlementPriceKes,
        uint256 strikePriceKes,
        uint256 payoutUsdcH
    );

    event HedgeExpired(
        uint256 indexed hedgeId,
        uint256 settlementPriceKes,
        uint256 strikePriceKes
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

    // ─── CONSTRUCTOR ──────────────────────────────────────────────────────

    constructor(
        address admin,
        address _usdcH,
        address _riskOracle,
        address _shambaToken,
        address _treasury
    )
        ERC721("ShambaChain Hedge Position", "SHP")
    {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PRICE_AGENT_ROLE, admin);
        _grantRole(LP_ROLE, admin);

        usdcH       = IERC20(_usdcH);
        riskOracle  = IRiskOracleForHedge(_riskOracle);
        shambaToken = IShambaTokenForHedge(_shambaToken);
        treasury    = _treasury;
        lpVault     = address(this); // self-managed LP for MVP
    }

    // ─── LP: DEPOSIT/WITHDRAW COLLATERAL ──────────────────────────────────

    /**
     * @notice LP deposits USDC-H to back hedge payouts.
     * @dev Earns premiums proportionally. In V2: tokenized LP shares.
     */
    function depositLiquidity(uint256 amount)
        external
        onlyRole(LP_ROLE)
        nonReentrant
    {
        usdcH.safeTransferFrom(msg.sender, address(this), amount);
        totalLpCollateral += amount;
        emit LiquidityDeposited(msg.sender, amount);
    }

    /**
     * @notice LP withdraws idle USDC-H (not backing open positions).
     */
    function withdrawLiquidity(uint256 amount)
        external
        onlyRole(LP_ROLE)
        nonReentrant
    {
        uint256 available = totalLpCollateral - totalOpenExposure;
        require(amount <= available, "HedgePosition: insufficient idle liquidity");
        totalLpCollateral -= amount;
        usdcH.safeTransfer(msg.sender, amount);
        emit LiquidityWithdrawn(msg.sender, amount);
    }

    function _calcPremium(
        uint256 currentPriceKes,
        uint256 strikePriceKes,
        uint256 notionalUsdcH,
        uint256 durationSecs
    ) internal pure returns (uint256 premiumUsdcH, uint256 maxPayoutUsdcH) {
        uint256 priceDiff    = currentPriceKes - strikePriceKes;
        uint256 cappedPayout = (notionalUsdcH * MAX_PAYOUT_BPS) / BPS_DENOMINATOR;

        maxPayoutUsdcH = _kesTo6DecUsd(priceDiff * (notionalUsdcH * BPS_DENOMINATOR / currentPriceKes / BPS_DENOMINATOR));
        if (maxPayoutUsdcH > cappedPayout) maxPayoutUsdcH = cappedPayout;

        uint256 moneynessBps     = (priceDiff * BPS_DENOMINATOR) / currentPriceKes;
        uint256 durationRatioBps = (durationSecs * BPS_DENOMINATOR) / MAX_HEDGE_DURATION;
        premiumUsdcH = (notionalUsdcH * moneynessBps * durationRatioBps)
                    / BPS_DENOMINATOR / BPS_DENOMINATOR;
        if (premiumUsdcH < 1e5) premiumUsdcH = 1e5;
    }

    // ─── BUY HEDGE ────────────────────────────────────────────────────────

    /**
     * @notice Purchase price protection on an oCR NFT.
     * @dev Farmer pays premium → receives ERC-721 HedgePosition NFT.
     *      If price at expiry < strike → exercise for payout.
     *      Only one active hedge per oCR at a time.
     *
     *      Premium = strikeRiskBps * notionalUsdcH / BPS_DENOMINATOR
     *      Where strikeRiskBps = (currentPrice - strike) / currentPrice in BPS
     *      (simplified Black-Scholes approximation for testnet)
     *
     * @param ocrTokenId     The oCR NFT to hedge
     * @param weightKg       Weight of commodity in kg (from oCR metadata)
     * @param strikePriceKes Strike price in KES per kg (18 decimals)
     * @param durationSecs   Hedge duration in seconds
     */
    function buyHedge(
        uint256 ocrTokenId,
        uint256 weightKg,
        uint256 strikePriceKes,
        uint256 durationSecs
    )
        external
        nonReentrant
        whenNotPaused
        returns (uint256 hedgeId)
    {
        // ── Validations ──
        if (durationSecs < MIN_HEDGE_DURATION || durationSecs > MAX_HEDGE_DURATION) {
            revert InvalidDuration(durationSecs, MIN_HEDGE_DURATION, MAX_HEDGE_DURATION);
        }
        if (tokenActiveHedge[ocrTokenId] != 0) {
            revert ActiveHedgeExists(ocrTokenId, tokenActiveHedge[ocrTokenId]);
        }
        if (riskOracle.isPriceStale()) revert OraclePriceStale();

        uint256 currentPriceKes = riskOracle.latestMaizeKes();

        // Strike must be below current price (put option)
        if (strikePriceKes >= currentPriceKes) {
            revert StrikeTooHigh(strikePriceKes, currentPriceKes);
        }
        if (strikePriceKes == 0) revert StrikeTooLow(strikePriceKes);

        // ── Calculate premium and max payout ──
        uint256 notionalUsdcH = _kesTo6DecUsd(currentPriceKes * weightKg);

        (uint256 premiumUsdcH, uint256 maxPayoutUsdcH) = _calcPremium(
            currentPriceKes, strikePriceKes, notionalUsdcH, durationSecs
        );

        if (shambaToken.balanceOf(msg.sender) >= SHAMBA_THRESHOLD) {
            premiumUsdcH -= (premiumUsdcH * SHAMBA_DISCOUNT_BPS) / BPS_DENOMINATOR;
        }

        // ── Check LP has enough collateral ──
        uint256 freeCollateral = totalLpCollateral - totalOpenExposure;
        if (freeCollateral < maxPayoutUsdcH) {
            revert InsufficientLpCollateral(maxPayoutUsdcH, freeCollateral);
        }

        // ── Collect premium ──
        uint256 protocolFee = (premiumUsdcH * PROTOCOL_FEE_BPS) / BPS_DENOMINATOR;
        usdcH.safeTransferFrom(msg.sender, address(this), premiumUsdcH);
        if (protocolFee > 0) {
            usdcH.safeTransfer(treasury, protocolFee);
            totalFeesCollected += protocolFee;
        }
        totalPremiumsCollected += premiumUsdcH;

        // ── Create hedge ──
        _hedgeIds++;
        hedgeId = _hedgeIds;

        Hedge storage h  = hedges[hedgeId];
        h.hedgeId        = hedgeId;
        h.ocrTokenId     = ocrTokenId;
        h.buyer          = msg.sender;
        h.weightKg       = weightKg;
        h.strikePriceKes = strikePriceKes;
        h.purchasePriceKes = currentPriceKes;
        h.premiumUsdcH   = premiumUsdcH;
        h.maxPayoutUsdcH = maxPayoutUsdcH;
        h.purchasedAt    = block.timestamp;
        h.expiryDate     = block.timestamp + durationSecs;
        h.status         = HedgeStatus.Active;

        tokenActiveHedge[ocrTokenId] = hedgeId;
        buyerHedges[msg.sender].push(hedgeId);
        totalOpenExposure += maxPayoutUsdcH;
        totalHedgesSold++;

        // Mint SHP NFT to buyer
        _safeMint(msg.sender, hedgeId);

        emit HedgePurchased(
            hedgeId,
            ocrTokenId,
            msg.sender,
            strikePriceKes,
            premiumUsdcH,
            maxPayoutUsdcH,
            block.timestamp + durationSecs
        );
    }

    // ─── EXERCISE HEDGE ───────────────────────────────────────────────────

    /**
     * @notice Exercise an in-the-money hedge after expiry.
     * @dev Callable by buyer or PriceAgent (auto-exercise).
     *      Current price must be below strike price.
     *      HedgePosition NFT is burned on exercise.
     *
     * @param hedgeId  The hedge to exercise
     */
    function exerciseHedge(uint256 hedgeId)
        external
        nonReentrant
        whenNotPaused
    {
        Hedge storage hedge = hedges[hedgeId];

        if (hedge.status != HedgeStatus.Active) revert HedgeNotActive(hedgeId);
        if (block.timestamp < hedge.expiryDate)  revert NotExpiredYet(hedgeId, hedge.expiryDate);

        // Caller must be buyer or PriceAgent
        if (msg.sender != hedge.buyer && !hasRole(PRICE_AGENT_ROLE, msg.sender)) {
            revert NotHedgeBuyer();
        }

        if (riskOracle.isPriceStale()) revert OraclePriceStale();

        uint256 settlementPrice = riskOracle.latestMaizeKes();

        // Must be in the money
        if (settlementPrice >= hedge.strikePriceKes) {
            // Auto-expire if PriceAgent calls on OTM position
            _expireHedge(hedgeId, settlementPrice);
            return;
        }

        // ── Calculate payout ──
        uint256 priceDiffKes = hedge.strikePriceKes - settlementPrice;
        uint256 payoutKes    = priceDiffKes * hedge.weightKg;
        uint256 payoutUsdcH  = _kesTo6DecUsd(payoutKes);

        // Cap at max payout
        if (payoutUsdcH > hedge.maxPayoutUsdcH) {
            payoutUsdcH = hedge.maxPayoutUsdcH;
        }

        // ── Update state ──
        hedge.status              = HedgeStatus.Exercised;
        hedge.exercisedAt         = block.timestamp;
        hedge.payoutUsdcH         = payoutUsdcH;
        hedge.settlementPriceKes  = settlementPrice;

        tokenActiveHedge[hedge.ocrTokenId] = 0;
        totalOpenExposure -= hedge.maxPayoutUsdcH;
        totalPayoutsIssued += payoutUsdcH;

        // ── Burn NFT and pay out ──
        _burn(hedgeId);
        usdcH.safeTransfer(hedge.buyer, payoutUsdcH);

        emit HedgeExercised(
            hedgeId,
            hedge.buyer,
            settlementPrice,
            hedge.strikePriceKes,
            payoutUsdcH
        );
    }

    /**
     * @notice Expire an out-of-the-money hedge (cleanup after expiry).
     * @dev Called by PriceAgent to clean up expired positions.
     *      No payout issued. LP collateral freed.
     *
     * @param hedgeId  The hedge to expire
     */
    function expireHedge(uint256 hedgeId)
        external
        nonReentrant
    {
        Hedge storage hedge = hedges[hedgeId];

        if (hedge.status != HedgeStatus.Active) revert HedgeNotActive(hedgeId);
        if (block.timestamp < hedge.expiryDate)  revert NotExpiredYet(hedgeId, hedge.expiryDate);

        uint256 settlementPrice = riskOracle.isPriceStale()
            ? hedge.strikePriceKes + 1  // treat as OTM if stale
            : riskOracle.latestMaizeKes();

        _expireHedge(hedgeId, settlementPrice);
    }

    // ─── INTERNAL ─────────────────────────────────────────────────────────

    function _expireHedge(uint256 hedgeId, uint256 settlementPrice) internal {
        Hedge storage hedge = hedges[hedgeId];

        hedge.status             = HedgeStatus.Expired;
        hedge.exercisedAt        = block.timestamp;
        hedge.settlementPriceKes = settlementPrice;

        tokenActiveHedge[hedge.ocrTokenId] = 0;
        totalOpenExposure -= hedge.maxPayoutUsdcH;

        _burn(hedgeId);

        emit HedgeExpired(hedgeId, settlementPrice, hedge.strikePriceKes);
    }

    /**
     * @dev Convert KES (18 decimals) to USDC-H (6 decimals) at fixed testnet rate.
     *      Production: use Supra KES/USD feed.
     */
    function _kesTo6DecUsd(uint256 kes) internal pure returns (uint256 usd) {
        usd = kes / (KES_USD_RATE * 1e12);
    }

    // ─── ADMIN ────────────────────────────────────────────────────────────

    function setRiskOracle(address _riskOracle) external onlyRole(DEFAULT_ADMIN_ROLE) {
        riskOracle = IRiskOracleForHedge(_riskOracle);
    }

    function setTreasury(address _treasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        treasury = _treasury;
    }

    function pause()   external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    // ─── VIEWS ────────────────────────────────────────────────────────────

    function getHedge(uint256 hedgeId) external view returns (Hedge memory) {
        return hedges[hedgeId];
    }

    function getBuyerHedges(address buyer) external view returns (uint256[] memory) {
        return buyerHedges[buyer];
    }

    /// @notice Estimate current payout for a hedge at current oracle price
    function estimatePayout(uint256 hedgeId)
        external
        view
        returns (uint256 estimatedUsdcH, bool inTheMoney)
    {
        Hedge memory hedge = hedges[hedgeId];
        if (hedge.status != HedgeStatus.Active) return (0, false);

        uint256 currentPrice = riskOracle.latestMaizeKes();
        if (currentPrice >= hedge.strikePriceKes) return (0, false);

        inTheMoney = true;
        uint256 priceDiff   = hedge.strikePriceKes - currentPrice;
        uint256 payoutKes   = priceDiff * hedge.weightKg;
        estimatedUsdcH      = _kesTo6DecUsd(payoutKes);
        if (estimatedUsdcH > hedge.maxPayoutUsdcH) {
            estimatedUsdcH = hedge.maxPayoutUsdcH;
        }
    }

    /// @notice How much free LP collateral is available
    function availableLpCollateral() external view returns (uint256) {
        return totalLpCollateral > totalOpenExposure
            ? totalLpCollateral - totalOpenExposure
            : 0;
    }

    // ─── ERC-165 ──────────────────────────────────────────────────────────

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
