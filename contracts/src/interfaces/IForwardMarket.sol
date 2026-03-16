// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title IForwardMarket
 * @notice Interface for the ShambaChain ForwardMarket — peer-to-peer forward
 *         commodity sales between BuyerAgents and farmers.
 * @dev Consumed by: PriceAgent (off-chain), RiskAgent, settlement scripts.
 */
interface IForwardMarket {

    // ─── ENUMS ───────────────────────────────────────────────────────────

    enum BidStatus {
        Open,
        Accepted,
        Settled,
        Cancelled,
        Expired,
        Disputed
    }

    enum BidType {
        Specific,   // bid on an existing oCR tokenId
        Open        // bid on future oCR matching specs
    }

    // ─── STRUCTS ──────────────────────────────────────────────────────────

    struct Bid {
        uint256   bidId;
        BidType   bidType;
        BidStatus status;
        address   buyer;
        string    buyerRef;
        uint256   tokenId;
        string    commodityType;
        uint256   minWeightKg;
        uint8     minGrade;
        uint256   offerUsdcH;
        uint256   upfrontUsdcH;
        uint256   escrowedUsdcH;
        uint256   placedAt;
        uint256   settlementDate;
        uint256   acceptedAt;
        uint256   settledAt;
        address   farmer;
        uint256   farmerTokenId;
    }

    // ─── EVENTS ───────────────────────────────────────────────────────────

    event BidPlaced(
        uint256 indexed bidId,
        BidType         bidType,
        address indexed buyer,
        uint256         tokenId,
        string          commodityType,
        uint256         offerUsdcH,
        uint256         settlementDate
    );

    event BidAccepted(
        uint256 indexed bidId,
        address indexed farmer,
        uint256         farmerTokenId,
        uint256         upfrontPaid,
        uint256         timestamp
    );

    event BidSettled(
        uint256 indexed bidId,
        address indexed farmer,
        address indexed buyer,
        uint256         farmerTokenId,
        uint256         remainingPayment,
        uint256         platformFee,
        uint256         timestamp
    );

    event BidCancelled(
        uint256 indexed bidId,
        address indexed buyer,
        uint256         refundedUsdcH,
        uint256         timestamp
    );

    event BidExpired(uint256 indexed bidId, uint256 timestamp);

    event BidDisputed(
        uint256 indexed bidId,
        address indexed raisedBy,
        string          reason
    );

    event OpenBidMatched(
        uint256 indexed bidId,
        uint256 indexed tokenId,
        address indexed farmer
    );

    // ─── ERRORS ───────────────────────────────────────────────────────────

    error InvalidSettlementDate(uint256 provided, uint256 minAllowed, uint256 maxAllowed);
    error BidNotOpen(uint256 bidId, BidStatus status);
    error BidNotAccepted(uint256 bidId, BidStatus status);
    error NotSettlementTime(uint256 bidId, uint256 settlementDate, uint256 currentTime);
    error SettlementDatePassed(uint256 bidId, uint256 settlementDate);
    error NotBuyer(address caller, address buyer);
    error NotFarmer(address caller, address farmer);
    error ReceiptNotActive(uint256 tokenId);
    error TokenAlreadyBid(uint256 tokenId);
    error Unauthorized();

    // ─── WRITE ────────────────────────────────────────────────────────────

    function placeBid(
        uint256         tokenId,
        uint256         offerUsdcH,
        uint256         settlementDate,
        string calldata buyerRef
    ) external returns (uint256 bidId);

    function placeOpenBid(
        string calldata commodityType,
        uint256         minWeightKg,
        uint8           minGrade,
        uint256         offerUsdcH,
        uint256         settlementDate,
        string calldata buyerRef
    ) external returns (uint256 bidId);

    function acceptBid(uint256 bidId) external;

    function matchOpenBid(uint256 bidId, uint256 tokenId) external;

    function settle(uint256 bidId) external;

    function consentEarlySettle(uint256 bidId) external;

    function cancelBid(uint256 bidId) external;

    function raisedDispute(uint256 bidId, string calldata reason) external;

    function resolveDispute(uint256 bidId, address recipient, uint256 amount) external;

    // ─── READ ─────────────────────────────────────────────────────────────

    function getBid(uint256 bidId) external view returns (Bid memory);

    function getBuyerBids(address buyer) external view returns (uint256[] memory);

    function getFarmerBids(address farmer) external view returns (uint256[] memory);

    function getOpenBids() external view returns (uint256[] memory);

    function openBidCount() external view returns (uint256);

    function hasBid(uint256 tokenId) external view returns (bool has, uint256 bidId);

    function getBidFairnessScore(uint256 bidId) external view returns (uint256 fairnessBps);

    function earlySettleConsent(uint256 bidId, address party) external view returns (bool);
}
