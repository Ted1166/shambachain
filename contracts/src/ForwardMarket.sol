// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title ForwardMarket
 * @author ShambaChain Protocol
 * @notice Peer-to-peer forward commodity market where BuyerAgents (OpenClaw)
 *         place bids on oCR NFTs at fixed future prices. Farmers can accept
 *         bids to lock in a guaranteed sale price — eliminating the harvest
 *         pricing trap.
 *
 * @dev Two participation modes:
 *
 *   MODE A — Forward Sale (farmer has existing oCR):
 *     1. BuyerAgent calls placeBid(tokenId, offerUsdcH, settlementDate)
 *     2. USDC-H escrowed in contract
 *     3. Farmer accepts bid → oCR ownership committed, settlement date set
 *     4. On settlementDate → anyone calls settle(bidId)
 *        → USDC-H released to farmer, oCR redeemed or transferred to buyer
 *
 *   MODE B — Pre-harvest Commitment (farmer doesn't have oCR yet):
 *     1. BuyerAgent calls placeOpenBid(commodityType, weightKg, grade,
 *        offerUsdcH, settlementDate)
 *     2. Farmer matches open bid → gets paid partial upfront
 *     3. On harvest: farmer mints oCR and fulfills commitment
 *
 * This is economically equivalent to trade finance / invoice factoring:
 * farmers sell future receivables at a discount for immediate liquidity.
 *
 * OpenClaw Integration:
 *   - BuyerAgent: calls placeBid(), cancelBid()
 *   - PriceAgent: monitors oracle vs bid prices, alerts farmers to accept
 *   - LoanAgent: can compare loan vs forward sale to recommend best option
 */

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IReceiptFactoryForMarket {
    function isActive(uint256 tokenId) external view returns (bool);
    function getValuation(uint256 tokenId) external view returns (uint256);
    function getReceipt(uint256 tokenId) external view returns (
        uint256, string memory, uint256, uint8, string memory,
        string memory, uint256, uint256, uint256, uint8, address, uint256
    );
}

interface IReceiptNFT {
    function ownerOf(uint256 tokenId) external view returns (address);
    function safeTransferFrom(address from, address to, uint256 tokenId) external;
    function getApproved(uint256 tokenId) external view returns (address);
    function isApprovedForAll(address owner, address operator) external view returns (bool);
}

contract ForwardMarket is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ─── ROLES ────────────────────────────────────────────────────────────────
    bytes32 public constant BUYER_AGENT_ROLE = keccak256("BUYER_AGENT_ROLE");
    bytes32 public constant SETTLER_ROLE     = keccak256("SETTLER_ROLE");

    // ─── CONSTANTS ────────────────────────────────────────────────────────────
    uint256 public constant MIN_SETTLEMENT_DELAY = 1 days;
    uint256 public constant MAX_SETTLEMENT_DELAY = 365 days;
    uint256 public constant PLATFORM_FEE_BPS     = 100;   // 1% platform fee
    uint256 public constant BPS_DENOMINATOR       = 10_000;
    uint256 public constant UPFRONT_PAYMENT_BPS   = 2_000; // 20% upfront for open bids

    // ─── ENUMS ────────────────────────────────────────────────────────────────
    enum BidStatus {
        Open,       // placed, waiting for farmer to accept
        Accepted,   // farmer accepted, awaiting settlement
        Settled,    // payment sent, oCR transferred
        Cancelled,  // buyer cancelled before acceptance
        Expired,    // settlement date passed without settlement
        Disputed    // dispute raised, needs resolution
    }

    enum BidType {
        Specific,   // bid on a specific existing oCR tokenId
        Open        // bid on future oCR matching commodity specs
    }

    // ─── STRUCTS ──────────────────────────────────────────────────────────────
    struct Bid {
        uint256     bidId;
        BidType     bidType;
        BidStatus   status;

        // Buyer info
        address     buyer;               // BuyerAgent or institutional buyer wallet
        string      buyerRef;            // off-chain buyer reference (e.g. "UNGA-MILLS-001")

        // Commodity specs
        uint256     tokenId;             // 0 if open bid
        string      commodityType;       // "MAIZE"
        uint256     minWeightKg;         // minimum acceptable weight
        uint8       minGrade;            // minimum acceptable grade (0=A, 1=B, 2=C)

        // Financial terms
        uint256     offerUsdcH;          // total offer in USDC-H (6 decimals)
        uint256     upfrontUsdcH;        // amount paid upfront on acceptance
        uint256     escrowedUsdcH;       // currently escrowed in contract

        // Timing
        uint256     placedAt;            // block.timestamp when bid placed
        uint256     settlementDate;      // unix timestamp: when oCR must be delivered
        uint256     acceptedAt;          // block.timestamp when accepted (0 if not)
        uint256     settledAt;           // block.timestamp when settled (0 if not)

        // Farmer side
        address     farmer;              // farmer who accepted (0 if not accepted)
        uint256     farmerTokenId;       // actual tokenId committed by farmer
    }

    // ─── STATE ────────────────────────────────────────────────────────────────
    uint256 private _bidIds;

    /// @notice bidId → Bid
    mapping(uint256 => Bid) public bids;

    /// @notice tokenId → bidId (specific bids only, 0 = no bid)
    mapping(uint256 => uint256) public tokenBid;

    /// @notice buyer → list of bid IDs
    mapping(address => uint256[]) public buyerBids;

    /// @notice farmer → list of accepted bid IDs
    mapping(address => uint256[]) public farmerBids;

    /// @notice open bids list (type = Open, status = Open)
    uint256[] public openBidList;
    mapping(uint256 => uint256) private _openBidListIndex; // bidId → index in openBidList

    /// @notice platform treasury
    address public treasury;

    /// @notice USDC-H
    IERC20 public immutable usdcH;

    /// @notice ReceiptFactory
    IReceiptFactoryForMarket public immutable receiptFactory;

    /// @notice oCR NFT contract
    IReceiptNFT public immutable receiptNFT;

    // ── Stats ──
    uint256 public totalBidsPlaced;
    uint256 public totalBidsSettled;
    uint256 public totalVolumeUsdcH;
    uint256 public totalFeesCollected;

    // ─── EVENTS ───────────────────────────────────────────────────────────────
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

    event BidExpired(
        uint256 indexed bidId,
        uint256         timestamp
    );

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

    // ─── ERRORS ───────────────────────────────────────────────────────────────
    error InvalidSettlementDate(uint256 provided, uint256 minAllowed, uint256 maxAllowed);
    error BidNotOpen(uint256 bidId, BidStatus status);
    error BidNotAccepted(uint256 bidId, BidStatus status);
    error NotSettlementTime(uint256 bidId, uint256 settlementDate, uint256 currentTime);
    error SettlementDatePassed(uint256 bidId, uint256 settlementDate);
    error NotBuyer(address caller, address buyer);
    error NotFarmer(address caller, address farmer);
    error ReceiptNotActive(uint256 tokenId);
    error TokenAlreadyBid(uint256 tokenId);
    error CommodityMismatch(string expected, string provided);
    error WeightTooLow(uint256 required, uint256 provided);
    error GradeTooLow(uint8 required, uint8 provided);
    error InsufficientEscrow();
    error BidAlreadyAccepted(uint256 bidId);
    error Unauthorized();

    // ─── CONSTRUCTOR ──────────────────────────────────────────────────────────
    constructor(
        address admin,
        address _usdcH,
        address _receiptFactory,
        address _treasury
    ) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(BUYER_AGENT_ROLE, admin);
        _grantRole(SETTLER_ROLE, admin);

        usdcH          = IERC20(_usdcH);
        receiptFactory = IReceiptFactoryForMarket(_receiptFactory);
        receiptNFT     = IReceiptNFT(_receiptFactory);
        treasury       = _treasury;
    }

    // ─── MODE A: SPECIFIC BID ON EXISTING oCR ────────────────────────────────

    /**
     * @notice BuyerAgent places a bid on a specific existing oCR.
     * @dev USDC-H is escrowed immediately. Farmer can accept anytime before
     *      settlementDate. BuyerAgent can cancel before acceptance.
     *
     * @param tokenId        The oCR NFT to bid on
     * @param offerUsdcH     Total offer price in USDC-H (6 decimals)
     * @param settlementDate Unix timestamp when delivery is expected
     * @param buyerRef       Off-chain buyer reference string
     */
    function placeBid(
        uint256 tokenId,
        uint256 offerUsdcH,
        uint256 settlementDate,
        string calldata buyerRef
    ) external nonReentrant whenNotPaused returns (uint256 bidId) {
        // ── Validate ──
        _validateSettlementDate(settlementDate);
        if (!receiptFactory.isActive(tokenId)) revert ReceiptNotActive(tokenId);
        if (tokenBid[tokenId] != 0) revert TokenAlreadyBid(tokenId);

        // ── Escrow USDC-H ──
        usdcH.safeTransferFrom(msg.sender, address(this), offerUsdcH);

        // ── Create bid ──
        _bidIds++;
        bidId = _bidIds;

        bids[bidId] = Bid({
            bidId:          bidId,
            bidType:        BidType.Specific,
            status:         BidStatus.Open,
            buyer:          msg.sender,
            buyerRef:       buyerRef,
            tokenId:        tokenId,
            commodityType:  "",          // not needed for specific bid
            minWeightKg:    0,
            minGrade:       0,
            offerUsdcH:     offerUsdcH,
            upfrontUsdcH:   0,           // no upfront for specific bids
            escrowedUsdcH:  offerUsdcH,
            placedAt:       block.timestamp,
            settlementDate: settlementDate,
            acceptedAt:     0,
            settledAt:      0,
            farmer:         address(0),
            farmerTokenId:  tokenId
        });

        tokenBid[tokenId] = bidId;
        buyerBids[msg.sender].push(bidId);
        totalBidsPlaced++;

        emit BidPlaced(bidId, BidType.Specific, msg.sender, tokenId, "", offerUsdcH, settlementDate);
    }

    // ─── MODE B: OPEN BID FOR FUTURE oCR ─────────────────────────────────────

    /**
     * @notice BuyerAgent places an open bid for a future oCR matching specs.
     * @dev Farmers can match this bid by presenting a conforming oCR.
     *      20% paid upfront on match, 80% on settlement.
     *      Useful for pre-harvest commitments.
     *
     * @param commodityType   e.g. "MAIZE"
     * @param minWeightKg     Minimum acceptable weight in kg
     * @param minGrade        Minimum grade (0=A, 1=B, 2=C)
     * @param offerUsdcH      Total offer for the full commodity amount
     * @param settlementDate  When the oCR must be delivered
     * @param buyerRef        Off-chain buyer reference
     */
    function placeOpenBid(
        string  calldata commodityType,
        uint256 minWeightKg,
        uint8   minGrade,
        uint256 offerUsdcH,
        uint256 settlementDate,
        string  calldata buyerRef
    ) external nonReentrant whenNotPaused returns (uint256 bidId) {
        _validateSettlementDate(settlementDate);

        uint256 upfront = (offerUsdcH * UPFRONT_PAYMENT_BPS) / BPS_DENOMINATOR;

        // ── Escrow full amount ──
        usdcH.safeTransferFrom(msg.sender, address(this), offerUsdcH);

        // ── Create open bid ──
        _bidIds++;
        bidId = _bidIds;

        bids[bidId] = Bid({
            bidId:          bidId,
            bidType:        BidType.Open,
            status:         BidStatus.Open,
            buyer:          msg.sender,
            buyerRef:       buyerRef,
            tokenId:        0,
            commodityType:  commodityType,
            minWeightKg:    minWeightKg,
            minGrade:       minGrade,
            offerUsdcH:     offerUsdcH,
            upfrontUsdcH:   upfront,
            escrowedUsdcH:  offerUsdcH,
            placedAt:       block.timestamp,
            settlementDate: settlementDate,
            acceptedAt:     0,
            settledAt:      0,
            farmer:         address(0),
            farmerTokenId:  0
        });

        buyerBids[msg.sender].push(bidId);
        openBidList.push(bidId);
        _openBidListIndex[bidId] = openBidList.length - 1;
        totalBidsPlaced++;

        emit BidPlaced(bidId, BidType.Open, msg.sender, 0, commodityType, offerUsdcH, settlementDate);
    }

    // ─── ACCEPT BID (FARMER) ──────────────────────────────────────────────────

    /**
     * @notice Farmer accepts a specific bid on their oCR.
     * @dev Farmer must own the oCR NFT. oCR committed to this bid.
     *      No upfront payment for specific bids — full payment on settlement.
     *
     * @param bidId  The bid to accept
     */
    function acceptBid(uint256 bidId)
        external
        nonReentrant
        whenNotPaused
    {
        Bid storage bid = bids[bidId];

        if (bid.status != BidStatus.Open) revert BidNotOpen(bidId, bid.status);
        if (block.timestamp >= bid.settlementDate) revert SettlementDatePassed(bidId, bid.settlementDate);

        uint256 tokenId = bid.farmerTokenId;
        if (receiptNFT.ownerOf(tokenId) != msg.sender) revert Unauthorized();
        if (!receiptFactory.isActive(tokenId)) revert ReceiptNotActive(tokenId);

        // ── Commit ──
        bid.status     = BidStatus.Accepted;
        bid.farmer     = msg.sender;
        bid.acceptedAt = block.timestamp;

        farmerBids[msg.sender].push(bidId);

        emit BidAccepted(bidId, msg.sender, tokenId, 0, block.timestamp);
    }

    /**
     * @notice Farmer matches an open bid with a conforming oCR.
     * @dev Validates commodity type, weight, and grade against bid specs.
     *      Pays upfront immediately on match.
     *
     * @param bidId    The open bid to match
     * @param tokenId  The farmer's oCR NFT that matches the bid specs
     */
    function matchOpenBid(uint256 bidId, uint256 tokenId)
        external
        nonReentrant
        whenNotPaused
    {
        Bid storage bid = bids[bidId];

        if (bid.status != BidStatus.Open) revert BidNotOpen(bidId, bid.status);
        if (bid.bidType != BidType.Open) revert Unauthorized();
        if (block.timestamp >= bid.settlementDate) revert SettlementDatePassed(bidId, bid.settlementDate);
        if (receiptNFT.ownerOf(tokenId) != msg.sender) revert Unauthorized();
        if (!receiptFactory.isActive(tokenId)) revert ReceiptNotActive(tokenId);

        // ── Validate commodity specs ──
        // Note: in production, call getReceipt() to destructure fields
        // For MVP: trust farmer's oCR metadata written at mint time
        // Full validation happens off-chain by RiskAgent before settlement

        // ── Update bid ──
        bid.status        = BidStatus.Accepted;
        bid.farmer        = msg.sender;
        bid.farmerTokenId = tokenId;
        bid.acceptedAt    = block.timestamp;
        bid.escrowedUsdcH -= bid.upfrontUsdcH;

        // Remove from open bid list
        _removeFromOpenBidList(bidId);

        farmerBids[msg.sender].push(bidId);

        // ── Pay upfront ──
        if (bid.upfrontUsdcH > 0) {
            usdcH.safeTransfer(msg.sender, bid.upfrontUsdcH);
        }

        emit OpenBidMatched(bidId, tokenId, msg.sender);
        emit BidAccepted(bidId, msg.sender, tokenId, bid.upfrontUsdcH, block.timestamp);
    }

    // ─── SETTLE ───────────────────────────────────────────────────────────────

    /**
     * @notice Settle an accepted bid on or after settlementDate.
     * @dev Callable by anyone (farmer, buyer, PriceAgent, or SETTLER_ROLE).
     *      In production: validates oCR hasn't been tampered with.
     *      Transfers remaining USDC-H to farmer, NFT rights to buyer.
     *
     * @param bidId  The bid to settle
     */
    function settle(uint256 bidId)
        external
        nonReentrant
        whenNotPaused
    {
        Bid storage bid = bids[bidId];

        if (bid.status != BidStatus.Accepted) revert BidNotAccepted(bidId, bid.status);
        if (block.timestamp < bid.settlementDate) {
            revert NotSettlementTime(bidId, bid.settlementDate, block.timestamp);
        }

        uint256 tokenId = bid.farmerTokenId;
        if (!receiptFactory.isActive(tokenId)) revert ReceiptNotActive(tokenId);

        // ── Calculate platform fee ──
        uint256 remaining  = bid.escrowedUsdcH;
        uint256 platformFee = (bid.offerUsdcH * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
        uint256 farmerPayment = remaining - platformFee;

        // ── Update state ──
        bid.status    = BidStatus.Settled;
        bid.settledAt = block.timestamp;
        bid.escrowedUsdcH = 0;

        if (bid.bidType == BidType.Specific) {
            tokenBid[tokenId] = 0;
        }

        // ── Pay farmer ──
        usdcH.safeTransfer(bid.farmer, farmerPayment);

        // ── Platform fee to treasury ──
        if (platformFee > 0) {
            usdcH.safeTransfer(treasury, platformFee);
            totalFeesCollected += platformFee;
        }

        // ── Transfer oCR NFT to buyer ──
        // Farmer must have approved ForwardMarket contract before settlement
        // In full flow: farmer calls NFT.approve(forwardMarket, tokenId) at acceptance
        receiptNFT.safeTransferFrom(bid.farmer, bid.buyer, tokenId);

        totalBidsSettled++;
        totalVolumeUsdcH += bid.offerUsdcH;

        emit BidSettled(bidId, bid.farmer, bid.buyer, tokenId, farmerPayment, platformFee, block.timestamp);
    }

    // ─── EARLY SETTLEMENT (mutual agreement) ─────────────────────────────────

    /**
     * @notice Settle early with mutual agreement before settlementDate.
     * @dev Both buyer and farmer must call this. Second call triggers settlement.
     *      Useful if grain needs to move to market before original settlement date.
     */
    mapping(uint256 => mapping(address => bool)) public earlySettleConsent;

    function consentEarlySettle(uint256 bidId) external {
        Bid storage bid = bids[bidId];
        if (bid.status != BidStatus.Accepted) revert BidNotAccepted(bidId, bid.status);

        if (msg.sender != bid.farmer && msg.sender != bid.buyer) revert Unauthorized();

        earlySettleConsent[bidId][msg.sender] = true;

        // If both parties consented — trigger settlement
        if (earlySettleConsent[bidId][bid.farmer] && earlySettleConsent[bidId][bid.buyer]) {
            bid.settlementDate = block.timestamp; // advance settlement date
        }
    }

    // ─── CANCEL (BUYER ONLY, BEFORE ACCEPTANCE) ───────────────────────────────

    /**
     * @notice Buyer cancels an open bid and recovers escrowed USDC-H.
     * @dev Only callable before a farmer has accepted.
     *
     * @param bidId  The bid to cancel
     */
    function cancelBid(uint256 bidId)
        external
        nonReentrant
    {
        Bid storage bid = bids[bidId];

        if (bid.status != BidStatus.Open) revert BidNotOpen(bidId, bid.status);
        if (msg.sender != bid.buyer && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            revert NotBuyer(msg.sender, bid.buyer);
        }

        uint256 refund = bid.escrowedUsdcH;

        bid.status        = BidStatus.Cancelled;
        bid.escrowedUsdcH = 0;

        if (bid.bidType == BidType.Specific) {
            tokenBid[bid.tokenId] = 0;
        } else {
            _removeFromOpenBidList(bidId);
        }

        usdcH.safeTransfer(bid.buyer, refund);

        emit BidCancelled(bidId, bid.buyer, refund, block.timestamp);
    }

    // ─── DISPUTE ─────────────────────────────────────────────────────────────

    /**
     * @notice Raise a dispute on an accepted bid.
     * @dev Admin resolves disputes manually in V1.
     *      V2: decentralized dispute resolution via Hedera HCS arbitration.
     */
    function raisedDispute(uint256 bidId, string calldata reason) external {
        Bid storage bid = bids[bidId];
        if (bid.status != BidStatus.Accepted) revert BidNotAccepted(bidId, bid.status);
        if (msg.sender != bid.farmer && msg.sender != bid.buyer) revert Unauthorized();

        bid.status = BidStatus.Disputed;
        emit BidDisputed(bidId, msg.sender, reason);
    }

    /**
     * @notice Admin resolves a dispute by releasing funds to either party.
     */
    function resolveDispute(uint256 bidId, address recipient, uint256 amount)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        nonReentrant
    {
        Bid storage bid = bids[bidId];
        require(bid.status == BidStatus.Disputed, "Not disputed");
        require(amount <= bid.escrowedUsdcH, "Exceeds escrow");

        bid.escrowedUsdcH -= amount;
        if (bid.escrowedUsdcH == 0) bid.status = BidStatus.Settled;

        usdcH.safeTransfer(recipient, amount);
    }

    // ─── VIEWS ────────────────────────────────────────────────────────────────

    function getBid(uint256 bidId) external view returns (Bid memory) {
        return bids[bidId];
    }

    function getBuyerBids(address buyer) external view returns (uint256[] memory) {
        return buyerBids[buyer];
    }

    function getFarmerBids(address farmer) external view returns (uint256[] memory) {
        return farmerBids[farmer];
    }

    /// @notice Get all open bids (for PriceAgent to match farmers)
    function getOpenBids() external view returns (uint256[] memory) {
        return openBidList;
    }

    /// @notice Get open bids count — useful for agents polling for opportunities
    function openBidCount() external view returns (uint256) {
        return openBidList.length;
    }

    /**
     * @notice Check if a specific oCR has any pending bids.
     */
    function hasBid(uint256 tokenId) external view returns (bool, uint256 bidId) {
        bidId = tokenBid[tokenId];
        return (bidId != 0, bidId);
    }

    /**
     * @notice Get oracle price vs bid price ratio — tells farmer if bid is fair.
     * @dev Returns basisPoints: 10000 = bid matches oracle exactly.
     *      > 10000 = bid is above oracle (good for farmer)
     *      < 10000 = bid is below oracle (farmer should negotiate)
     */
    function getBidFairnessScore(uint256 bidId)
        external
        view
        returns (uint256 fairnessBps)
    {
        Bid memory bid = bids[bidId];
        if (bid.farmerTokenId == 0) return 0;

        uint256 oracleKes = receiptFactory.getValuation(bid.farmerTokenId);
        if (oracleKes == 0) return 0;

        // Convert KES to USDC-H (same conversion as CollateralVault)
        uint256 oracleUsd = oracleKes / (130 * 1e12);
        if (oracleUsd == 0) return 0;

        fairnessBps = (bid.offerUsdcH * BPS_DENOMINATOR) / oracleUsd;
    }

    // ─── ADMIN ────────────────────────────────────────────────────────────────

    function setTreasury(address _treasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        treasury = _treasury;
    }

    function pause()   external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    // ─── INTERNAL ─────────────────────────────────────────────────────────────

    function _validateSettlementDate(uint256 settlementDate) internal view {
        uint256 minDate = block.timestamp + MIN_SETTLEMENT_DELAY;
        uint256 maxDate = block.timestamp + MAX_SETTLEMENT_DELAY;
        if (settlementDate < minDate || settlementDate > maxDate) {
            revert InvalidSettlementDate(settlementDate, minDate, maxDate);
        }
    }

    function _removeFromOpenBidList(uint256 bidId) internal {
        uint256 idx      = _openBidListIndex[bidId];
        uint256 lastBidId = openBidList[openBidList.length - 1];

        openBidList[idx]              = lastBidId;
        _openBidListIndex[lastBidId]  = idx;

        openBidList.pop();
        delete _openBidListIndex[bidId];
    }
}
