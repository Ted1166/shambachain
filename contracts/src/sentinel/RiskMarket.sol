// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title RiskMarket
 * @author ShambaChain Protocol — Sentinel Layer
 * @notice Peer-to-peer prediction market on agricultural commodity risk.
 *         Participants bet on whether a specific oCR NFT will be liquidated
 *         within a given time window. Creates a market signal for warehouse
 *         and counterparty risk.
 *
 * @dev Ported and adapted from Sentinel RiskMarket.sol for ShambaChain on
 *      Hedera EVM. Key ShambaChain-specific changes:
 *        - Markets are created on specific oCR tokenIds (not abstract contracts)
 *        - Resolution triggered by CollateralVault liquidation event
 *        - Payouts in USDC-H (not ETH)
 *        - SHAMBA token holders get fee rebates (incentivize staking)
 *        - RiskAgent (OpenClaw) monitors and triggers market resolution
 *
 * How it works:
 *   1. Anyone creates a RiskMarket on an oCR position (tokenId + loanId)
 *   2. Participants take YES (will liquidate) or NO (will not) positions
 *   3. USDC-H is staked into the market
 *   4. On resolution (at marketDeadline or on liquidation event):
 *      - If loan was liquidated → YES wins → YES stakers split pot minus fee
 *      - If loan survived → NO wins → NO stakers split pot minus fee
 *   5. RiskAgent can auto-resolve by watching CollateralVault events
 *
 * Economics:
 *   - Protocol fee: 2% of winning pool
 *   - SHAMBA holders: fee rebate on redemption
 *   - Minimum stake: 1 USDC-H
 */

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

// ─── INTERFACES ─────────────────────────────────────────────────────────────

interface ICollateralVaultForMarket {
    enum LoanStatus { None, Active, Repaid, Liquidated, Defaulted }

    struct Loan {
        uint256 loanId;
        uint256 tokenId;
        address borrower;
        uint256 principal;
        uint256 interestAccrued;
        uint256 collateralKes;
        uint256 ltvBps;
        uint256 openedAt;
        uint256 dueAt;
        uint256 repaidAt;
        LoanStatus status;
    }

    function getLoan(uint256 loanId) external view returns (Loan memory);
    function getCurrentLtv(uint256 loanId) external view returns (uint256);
}

interface IShambaToken {
    function balanceOf(address account) external view returns (uint256);
}

// ─── CONTRACT ────────────────────────────────────────────────────────────────

contract RiskMarket is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ─── ROLES ────────────────────────────────────────────────────────────
    bytes32 public constant RISK_AGENT_ROLE  = keccak256("RISK_AGENT_ROLE");
    bytes32 public constant RESOLVER_ROLE    = keccak256("RESOLVER_ROLE");

    // ─── CONSTANTS ────────────────────────────────────────────────────────
    uint256 public constant MIN_STAKE          = 1e6;      // 1 USDC-H (6 dec)
    uint256 public constant PROTOCOL_FEE_BPS   = 200;      // 2%
    uint256 public constant SHAMBA_FEE_REBATE  = 50;       // 0.5% rebate for SHAMBA holders
    uint256 public constant BPS_DENOMINATOR    = 10_000;
    uint256 public constant MIN_MARKET_DURATION = 1 days;
    uint256 public constant MAX_MARKET_DURATION = 90 days;
    uint256 public constant SHAMBA_THRESHOLD    = 100e18;  // 100 SHAMBA to get rebate

    // ─── ENUMS ────────────────────────────────────────────────────────────

    enum MarketStatus {
        Open,       // accepting positions
        Closed,     // deadline passed, awaiting resolution
        Resolved,   // outcome determined, payouts claimable
        Cancelled   // cancelled before deadline (refunds available)
    }

    enum Outcome {
        None,       // not yet resolved
        YesWon,     // loan was liquidated — YES wins
        NoWon       // loan survived — NO wins
    }

    // ─── STRUCTS ──────────────────────────────────────────────────────────

    struct MarketInfo {
        uint256      marketId;
        uint256      tokenId;
        uint256      loanId;
        address      creator;
        uint256      createdAt;
        uint256      deadline;
        MarketStatus status;
        Outcome      outcome;
    }

    struct MarketFinancials {
        uint256 yesPool;
        uint256 noPool;
        uint256 totalPool;
        uint256 resolvedAt;
        uint256 finalLtvBps;
        string  resolutionNote;
        uint256 protocolFeeCollected;
    }

    struct Position {
        address participant;
        bool    isYes;        // true = YES (will liquidate), false = NO (will survive)
        uint256 staked;       // USDC-H staked
        bool    claimed;      // payout claimed
    }

    // ─── STATE ────────────────────────────────────────────────────────────

    uint256 private _marketIds;

    /// @notice marketId → Market
    mapping(uint256 => MarketInfo)       public markets;
    mapping(uint256 => MarketFinancials) public marketFinancials;

    /// @notice marketId → list of position IDs
    mapping(uint256 => uint256[]) public marketPositions;

    /// @notice positionId → Position
    mapping(uint256 => Position) private _positions;
    uint256 private _positionIds;

    /// @notice marketId → participant → positionId[]
    mapping(uint256 => mapping(address => uint256[])) public participantPositions;

    /// @notice creator → marketIds
    mapping(address => uint256[]) public creatorMarkets;

    /// @notice tokenId → active marketId (0 = none)
    mapping(uint256 => uint256) public tokenActiveMarket;

    /// @notice Protocol contracts
    IERC20                      public immutable usdcH;
    ICollateralVaultForMarket   public collateralVault;
    IShambaToken                public shambaToken;

    /// @notice Protocol treasury
    address public treasury;

    // Stats
    uint256 public totalMarketsCreated;
    uint256 public totalMarketsResolved;
    uint256 public totalVolumeUsdcH;
    uint256 public totalFeesCollected;

    // ─── EVENTS ───────────────────────────────────────────────────────────

    event MarketCreated(
        uint256 indexed marketId,
        uint256 indexed tokenId,
        uint256 indexed loanId,
        address creator,
        uint256 deadline
    );

    event PositionTaken(
        uint256 indexed marketId,
        uint256 indexed positionId,
        address indexed participant,
        bool    isYes,
        uint256 staked
    );

    event MarketResolved(
        uint256 indexed marketId,
        Outcome outcome,
        uint256 yesPool,
        uint256 noPool,
        uint256 finalLtvBps
    );

    event PayoutClaimed(
        uint256 indexed marketId,
        uint256 indexed positionId,
        address indexed participant,
        uint256 payout
    );

    event MarketCancelled(
        uint256 indexed marketId,
        string reason
    );

    // ─── ERRORS ───────────────────────────────────────────────────────────

    error MarketNotOpen(uint256 marketId, MarketStatus status);
    error MarketNotResolvable(uint256 marketId);
    error MarketNotResolved(uint256 marketId);
    error DeadlineNotPassed(uint256 deadline, uint256 currentTime);
    error DeadlinePassed(uint256 deadline);
    error StakeTooSmall(uint256 provided, uint256 minimum);
    error AlreadyClaimed(uint256 positionId);
    error NotPositionOwner();
    error ActiveMarketExists(uint256 tokenId, uint256 marketId);
    error InvalidDuration(uint256 duration, uint256 min, uint256 max);
    error ZeroPool();

    // ─── CONSTRUCTOR ──────────────────────────────────────────────────────

    constructor(
        address admin,
        address _usdcH,
        address _collateralVault,
        address _shambaToken,
        address _treasury
    ) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(RISK_AGENT_ROLE, admin);
        _grantRole(RESOLVER_ROLE, admin);

        usdcH           = IERC20(_usdcH);
        collateralVault = ICollateralVaultForMarket(_collateralVault);
        shambaToken     = IShambaToken(_shambaToken);
        treasury        = _treasury;
    }

    // ─── CREATE MARKET ────────────────────────────────────────────────────

    /**
     * @notice Create a risk prediction market on an oCR loan position.
     * @dev Anyone can create a market. No stake required from creator.
     *      Only one active market per tokenId at a time.
     *
     * @param tokenId   The oCR NFT being wagered on
     * @param loanId    The CollateralVault loan ID for this tokenId
     * @param duration  Seconds until market closes (1 day to 90 days)
     */
    function createMarket(
        uint256 tokenId,
        uint256 loanId,
        uint256 duration
    )
        external
        whenNotPaused
        returns (uint256 marketId)
    {
        if (duration < MIN_MARKET_DURATION || duration > MAX_MARKET_DURATION) {
            revert InvalidDuration(duration, MIN_MARKET_DURATION, MAX_MARKET_DURATION);
        }

        if (tokenActiveMarket[tokenId] != 0) {
            revert ActiveMarketExists(tokenId, tokenActiveMarket[tokenId]);
        }

        // Verify loanId exists
        ICollateralVaultForMarket.Loan memory loan = collateralVault.getLoan(loanId);
        require(loan.tokenId == tokenId, "RiskMarket: tokenId/loanId mismatch");

        _marketIds++;
        marketId = _marketIds;

        markets[marketId] = MarketInfo({
            marketId:  marketId,
            tokenId:   tokenId,
            loanId:    loanId,
            creator:   msg.sender,
            createdAt: block.timestamp,
            deadline:  block.timestamp + duration,
            status:    MarketStatus.Open,
            outcome:   Outcome.None
        });

        marketFinancials[marketId] = MarketFinancials({
            yesPool:              0,
            noPool:               0,
            totalPool:            0,
            resolvedAt:           0,
            finalLtvBps:          0,
            resolutionNote:       "",
            protocolFeeCollected: 0
        });

        tokenActiveMarket[tokenId] = marketId;
        creatorMarkets[msg.sender].push(marketId);
        totalMarketsCreated++;

        emit MarketCreated(marketId, tokenId, loanId, msg.sender, block.timestamp + duration);
    }

    // ─── TAKE POSITION ────────────────────────────────────────────────────

    /**
     * @notice Take a YES or NO position in a risk market.
     * @dev USDC-H is transferred to contract immediately.
     *      Payouts are proportional to stake in the winning pool.
     *
     * @param marketId  The market to participate in
     * @param isYes     true = bet loan will be liquidated; false = bet it survives
     * @param stakeAmt  USDC-H amount to stake (6 decimals, min 1 USDC-H)
     */
    function takePosition(
        uint256 marketId,
        bool    isYes,
        uint256 stakeAmt
    )
        external
        nonReentrant
        whenNotPaused
        returns (uint256 positionId)
    {
        MarketInfo storage market = markets[marketId];
        MarketFinancials storage fin = marketFinancials[marketId];

        if (market.status != MarketStatus.Open) {
            revert MarketNotOpen(marketId, market.status);
        }
        if (block.timestamp >= market.deadline) {
            revert DeadlinePassed(market.deadline);
        }
        if (stakeAmt < MIN_STAKE) {
            revert StakeTooSmall(stakeAmt, MIN_STAKE);
        }

        // Transfer USDC-H
        usdcH.safeTransferFrom(msg.sender, address(this), stakeAmt);

        // Create position
        _positionIds++;
        positionId = _positionIds;

        _positions[positionId] = Position({
            participant: msg.sender,
            isYes:       isYes,
            staked:      stakeAmt,
            claimed:     false
        });

        // Update pool
        if (isYes) {
            fin.yesPool += stakeAmt;
        } else {
            fin.noPool  += stakeAmt;
        }
        fin.totalPool += stakeAmt;

        marketPositions[marketId].push(positionId);
        participantPositions[marketId][msg.sender].push(positionId);
        totalVolumeUsdcH += stakeAmt;

        emit PositionTaken(marketId, positionId, msg.sender, isYes, stakeAmt);
    }

    // ─── RESOLVE MARKET ───────────────────────────────────────────────────

    /**
     * @notice Resolve a market after its deadline.
     * @dev Called by RiskAgent (RESOLVER_ROLE) or anyone after deadline.
     *      Checks current loan status on CollateralVault:
     *        - Liquidated → YES wins
     *        - Repaid or Active (survived) → NO wins
     *
     * @param marketId  The market to resolve
     */
    function resolveMarket(uint256 marketId)
        external
        nonReentrant
    {
        MarketInfo storage market = markets[marketId];
        MarketFinancials storage fin = marketFinancials[marketId];

        if (market.status != MarketStatus.Open) {
            revert MarketNotOpen(marketId, market.status);
        }
        if (block.timestamp < market.deadline) {
            revert DeadlineNotPassed(market.deadline, block.timestamp);
        }
        if (fin.totalPool == 0) {
            // No stakes — cancel and allow creator to close
            market.status = MarketStatus.Cancelled;
            tokenActiveMarket[market.tokenId] = 0;
            emit MarketCancelled(marketId, "No positions taken");
            return;
        }

        // Check loan status
        ICollateralVaultForMarket.Loan memory loan =
            collateralVault.getLoan(market.loanId);
        uint256 currentLtv = collateralVault.getCurrentLtv(market.loanId);

        Outcome outcome;
        string memory note;

        if (loan.status == ICollateralVaultForMarket.LoanStatus.Liquidated) {
            outcome = Outcome.YesWon;
            note    = "Loan was liquidated";
        } else if (
            loan.status == ICollateralVaultForMarket.LoanStatus.Repaid   ||
            loan.status == ICollateralVaultForMarket.LoanStatus.Defaulted
        ) {
            outcome = Outcome.NoWon;
            note    = "Loan repaid or defaulted without liquidation";
        } else if (loan.status == ICollateralVaultForMarket.LoanStatus.Active) {
            // Still active — NO wins (survived the prediction window)
            outcome = Outcome.NoWon;
            note    = "Loan active and survived prediction window";
        } else {
            // None — loan may have been cleaned up
            outcome = Outcome.NoWon;
            note    = "No active loan found";
        }

        // Collect protocol fee
        uint256 fee = (fin.totalPool * PROTOCOL_FEE_BPS) / BPS_DENOMINATOR;
        fin.protocolFeeCollected = fee;
        totalFeesCollected += fee;
        usdcH.safeTransfer(treasury, fee);

        // Update market
        market.status       = MarketStatus.Resolved;
        market.outcome      = outcome;
        fin.resolvedAt   = block.timestamp;
        fin.finalLtvBps  = currentLtv;
        fin.resolutionNote = note;

        tokenActiveMarket[market.tokenId] = 0;
        totalMarketsResolved++;

        emit MarketResolved(
            marketId,
            outcome,
            fin.yesPool,
            fin.noPool,
            currentLtv
        );
    }

    /**
     * @notice Force-resolve when loan is liquidated mid-market (before deadline).
     * @dev Called by RiskAgent immediately when it detects a LoanLiquidated event.
     *      This closes the market early with YES winning.
     *
     * @param marketId  The market to force-resolve
     */
    function forceResolveOnLiquidation(uint256 marketId)
        external
        onlyRole(RESOLVER_ROLE)
        nonReentrant
    {
        MarketInfo storage market = markets[marketId];
        MarketFinancials storage fin = marketFinancials[marketId];

        if (market.status != MarketStatus.Open) {
            revert MarketNotOpen(marketId, market.status);
        }
        if (fin.totalPool == 0) {
            market.status = MarketStatus.Cancelled;
            tokenActiveMarket[market.tokenId] = 0;
            emit MarketCancelled(marketId, "No positions, force cancelled");
            return;
        }

        uint256 currentLtv = collateralVault.getCurrentLtv(market.loanId);
        uint256 fee        = (fin.totalPool * PROTOCOL_FEE_BPS) / BPS_DENOMINATOR;

        fin.protocolFeeCollected = fee;
        totalFeesCollected         += fee;
        usdcH.safeTransfer(treasury, fee);

        market.status         = MarketStatus.Resolved;
        market.outcome        = Outcome.YesWon;
        fin.resolvedAt     = block.timestamp;
        fin.finalLtvBps    = currentLtv;
        fin.resolutionNote = "Force resolved: liquidation detected by RiskAgent";

        tokenActiveMarket[market.tokenId] = 0;
        totalMarketsResolved++;

        emit MarketResolved(
            marketId,
            Outcome.YesWon,
            fin.yesPool,
            fin.noPool,
            currentLtv
        );
    }

    // ─── CLAIM PAYOUT ─────────────────────────────────────────────────────

    /**
     * @notice Claim winning payout after market resolution.
     * @dev Payout = (participant stake / winning pool) * (total pool - fee)
     *      SHAMBA holders (>= 100 SHAMBA) get a 0.5% fee rebate.
     *
     * @param marketId    The resolved market
     * @param positionId  The position to claim
     */
    function claimPayout(uint256 marketId, uint256 positionId)
        external
        nonReentrant
    {
        MarketInfo storage market = markets[marketId];
        MarketFinancials storage fin = marketFinancials[marketId];

        if (market.status != MarketStatus.Resolved) {
            revert MarketNotResolved(marketId);
        }

        Position storage pos = _positions[positionId];

        if (pos.participant != msg.sender) revert NotPositionOwner();
        if (pos.claimed)                   revert AlreadyClaimed(positionId);

        // Must be on the winning side
        bool isWinner = (market.outcome == Outcome.YesWon && pos.isYes) ||
                        (market.outcome == Outcome.NoWon  && !pos.isYes);

        require(isWinner, "RiskMarket: losing position");

        uint256 winningPool = market.outcome == Outcome.YesWon
            ? fin.yesPool
            : fin.noPool;

        if (winningPool == 0) revert ZeroPool();

        uint256 netPool = fin.totalPool - fin.protocolFeeCollected;

        // Proportional payout
        uint256 payout = (pos.staked * netPool) / winningPool;

        // SHAMBA holder rebate — applies to the fee portion of their stake
        if (shambaToken.balanceOf(msg.sender) >= SHAMBA_THRESHOLD) {
            uint256 rebate = (pos.staked * SHAMBA_FEE_REBATE) / BPS_DENOMINATOR;
            // Rebate is capped at what we collected (approximate, best-effort)
            uint256 maxRebate = (fin.protocolFeeCollected * pos.staked) / winningPool;
            if (rebate > maxRebate) rebate = maxRebate;
            payout += rebate;
        }

        pos.claimed = true;

        usdcH.safeTransfer(msg.sender, payout);

        emit PayoutClaimed(marketId, positionId, msg.sender, payout);
    }

    /**
     * @notice Claim refund from a cancelled market.
     */
    function claimRefund(uint256 marketId, uint256 positionId)
        external
        nonReentrant
    {
        MarketInfo storage market = markets[marketId];
        require(market.status == MarketStatus.Cancelled, "RiskMarket: not cancelled");

        Position storage pos = _positions[positionId];
        if (pos.participant != msg.sender) revert NotPositionOwner();
        if (pos.claimed)                   revert AlreadyClaimed(positionId);

        pos.claimed = true;
        usdcH.safeTransfer(msg.sender, pos.staked);
    }

    // ─── ADMIN ────────────────────────────────────────────────────────────

    function cancelMarket(uint256 marketId, string calldata reason)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        MarketInfo storage market = markets[marketId];
        require(market.status == MarketStatus.Open, "RiskMarket: not open");
        market.status = MarketStatus.Cancelled;
        tokenActiveMarket[market.tokenId] = 0;
        emit MarketCancelled(marketId, reason);
    }

    function setTreasury(address _treasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        treasury = _treasury;
    }

    function setShambaToken(address _shambaToken) external onlyRole(DEFAULT_ADMIN_ROLE) {
        shambaToken = IShambaToken(_shambaToken);
    }

    function pause()   external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    // ─── VIEWS ────────────────────────────────────────────────────────────

    function getMarketInfo(uint256 marketId) external view returns (MarketInfo memory) {
        return markets[marketId];
    }

    function getMarketFinancials(uint256 marketId) external view returns (MarketFinancials memory) {
        return marketFinancials[marketId];
    }

    function getPosition(uint256 positionId) external view returns (Position memory) {
        return _positions[positionId];
    }

    function getMarketPositions(uint256 marketId) external view returns (uint256[] memory) {
        return marketPositions[marketId];
    }

    function getParticipantPositions(uint256 marketId, address participant)
        external
        view
        returns (uint256[] memory)
    {
        return participantPositions[marketId][participant];
    }

    /// @notice Get market pool sizes and current implied probability
    function getMarketOdds(uint256 marketId)
        external
        view
        returns (
            uint256 yesPool,
            uint256 noPool,
            uint256 impliedYesProbBps  // probability that YES wins, in BPS
        )
    {
        MarketFinancials memory fin = marketFinancials[marketId];
        yesPool = fin.yesPool;
        noPool  = fin.noPool;
        if (fin.totalPool == 0) return (0, 0, 0);
        impliedYesProbBps = (yesPool * BPS_DENOMINATOR) / fin.totalPool;
    }
}
