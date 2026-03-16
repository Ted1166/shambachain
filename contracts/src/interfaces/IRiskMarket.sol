// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title IRiskMarket
 * @notice Interface for the ShambaChain RiskMarket — prediction market on
 *         oCR loan liquidation risk.
 * @dev Consumed by: RiskAgent (auto-resolution), dashboards, backend indexer.
 */
interface IRiskMarket {

    // ─── ENUMS ───────────────────────────────────────────────────────────

    enum MarketStatus { Open, Closed, Resolved, Cancelled }

    enum Outcome { None, YesWon, NoWon }

    // ─── STRUCTS ──────────────────────────────────────────────────────────

    struct Market {
        uint256      marketId;
        uint256      tokenId;
        uint256      loanId;
        address      creator;
        uint256      createdAt;
        uint256      deadline;
        MarketStatus status;
        Outcome      outcome;
        uint256      yesPool;
        uint256      noPool;
        uint256      totalPool;
        uint256      resolvedAt;
        uint256      finalLtvBps;
        string       resolutionNote;
        uint256      protocolFeeCollected;
    }

    struct Position {
        address participant;
        bool    isYes;
        uint256 staked;
        bool    claimed;
    }

    // ─── EVENTS ───────────────────────────────────────────────────────────

    event MarketCreated(
        uint256 indexed marketId,
        uint256 indexed tokenId,
        uint256 indexed loanId,
        address         creator,
        uint256         deadline
    );

    event PositionTaken(
        uint256 indexed marketId,
        uint256 indexed positionId,
        address indexed participant,
        bool            isYes,
        uint256         staked
    );

    event MarketResolved(
        uint256 indexed marketId,
        Outcome         outcome,
        uint256         yesPool,
        uint256         noPool,
        uint256         finalLtvBps
    );

    event PayoutClaimed(
        uint256 indexed marketId,
        uint256 indexed positionId,
        address indexed participant,
        uint256         payout
    );

    event MarketCancelled(uint256 indexed marketId, string reason);

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

    // ─── WRITE ────────────────────────────────────────────────────────────

    function createMarket(uint256 tokenId, uint256 loanId, uint256 duration)
        external
        returns (uint256 marketId);

    function takePosition(uint256 marketId, bool isYes, uint256 stakeAmt)
        external
        returns (uint256 positionId);

    function resolveMarket(uint256 marketId) external;

    function forceResolveOnLiquidation(uint256 marketId) external;

    function claimPayout(uint256 marketId, uint256 positionId) external;

    function claimRefund(uint256 marketId, uint256 positionId) external;

    // ─── READ ─────────────────────────────────────────────────────────────

    function getMarket(uint256 marketId) external view returns (Market memory);

    function getPosition(uint256 positionId) external view returns (Position memory);

    function getMarketPositions(uint256 marketId) external view returns (uint256[] memory);

    function getParticipantPositions(uint256 marketId, address participant)
        external
        view
        returns (uint256[] memory);

    function getMarketOdds(uint256 marketId)
        external
        view
        returns (uint256 yesPool, uint256 noPool, uint256 impliedYesProbBps);

    function tokenActiveMarket(uint256 tokenId) external view returns (uint256 marketId);
}
