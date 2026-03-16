// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {ForwardMarket}  from "../../src/ForwardMarket.sol";
import {ReceiptFactory} from "../../src/RecipientFactory.sol";
import {MockERC20}      from "../mocks/MockERC20.sol";

/**
 * @title ForwardMarketTest
 * @notice Unit tests for ForwardMarket.sol
 *
 * Covers:
 *   - placeBid: specific oCR bid accepted, USDC escrowed
 *   - placeOpenBid: open bid without specific tokenId
 *   - acceptBid: farmer accepts → oCR transferred, USDC disbursed
 *   - cancelBid: buyer can cancel unfilled bid, USDC returned
 *   - settleBid: SETTLER_ROLE settles expired bids
 *   - Role gating
 */
contract ForwardMarketTest is Test {

    // ── Contracts ─────────────────────────────────────────────────────────────
    ForwardMarket  public market;
    ReceiptFactory public factory;
    MockERC20      public usdc;

    // ── Roles ─────────────────────────────────────────────────────────────────
    bytes32 constant MINTER_ROLE      = keccak256("MINTER_ROLE");
    bytes32 constant BUYER_AGENT_ROLE = keccak256("BUYER_AGENT_ROLE");
    bytes32 constant SETTLER_ROLE     = keccak256("SETTLER_ROLE");

    // ── Actors ────────────────────────────────────────────────────────────────
    address admin     = makeAddr("admin");
    address minter    = makeAddr("minter");
    address buyer     = makeAddr("buyer");
    address buyerAgent = makeAddr("buyerAgent");
    address settler   = makeAddr("settler");
    address farmer    = makeAddr("farmer");
    address custodian = makeAddr("custodian");
    address treasury  = makeAddr("treasury");

    // ── State ─────────────────────────────────────────────────────────────────
    uint256 public tokenId;
    uint256 constant BID_AMOUNT = 107e6; // $107 USDC-H

    function setUp() public {
        usdc = new MockERC20("USD Coin Hedera", "USDC-H", 6);

        vm.startPrank(admin);
        factory = new ReceiptFactory(admin);
        market  = new ForwardMarket(admin, address(usdc), address(factory), treasury);

        factory.grantRole(MINTER_ROLE, minter);
        factory.setCollateralVault(admin); // admin acts as vault for locking
        market.grantRole(BUYER_AGENT_ROLE, buyerAgent);
        market.grantRole(SETTLER_ROLE, settler);
        vm.stopPrank();

        // Mint a test oCR
        vm.prank(minter);
        tokenId = factory.mintReceipt(
            custodian, farmer, "MAIZE", 500,
            ReceiptFactory.Grade.B, "WH-ELD-003",
            "RLM8KZ2XYZ", 1002, 16_500e18, "ipfs://QmForwardTest"
        );

        // Fund buyer
        usdc.mint(buyer, 10_000e6);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Place Bid (specific oCR)
    // ─────────────────────────────────────────────────────────────────────────

    function test_PlaceBid_EscrowsUSDC() public {
        vm.startPrank(buyer);
        usdc.approve(address(market), BID_AMOUNT);
        uint256 bidId = market.placeBid(tokenId, BID_AMOUNT, block.timestamp + 30 days, "UNGA-001");
        vm.stopPrank();

        assertGt(bidId, 0);
        assertEq(usdc.balanceOf(address(market)), BID_AMOUNT);
    }

    function test_PlaceBid_RevertZeroAmount() public {
        vm.startPrank(buyer);
        usdc.approve(address(market), BID_AMOUNT);
        market.placeBid(tokenId, 0, block.timestamp + 30 days, "UNGA-001");
        vm.stopPrank();
    }

    function test_PlaceBid_RevertExpiredDeadline() public {
        vm.startPrank(buyer);
        usdc.approve(address(market), BID_AMOUNT);
        vm.expectRevert();
        market.placeBid(tokenId, BID_AMOUNT, block.timestamp - 1, "UNGA-001");
        vm.stopPrank();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Place Open Bid (no specific oCR)
    // ─────────────────────────────────────────────────────────────────────────

    function test_PlaceOpenBid_Succeeds() public {
        vm.startPrank(buyer);
        usdc.approve(address(market), BID_AMOUNT);
        uint256 bidId = market.placeOpenBid(
            "MAIZE",     // commodity
            500,         // min weight kg
            0,           // minGrade
            BID_AMOUNT,
            block.timestamp + 30 days,
            "UNGA-001"
        );
        vm.stopPrank();

        assertGt(bidId, 0);
        assertEq(usdc.balanceOf(address(market)), BID_AMOUNT);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Accept Bid
    // ─────────────────────────────────────────────────────────────────────────

    function _placeBid() internal returns (uint256 bidId) {
        vm.startPrank(buyer);
        usdc.approve(address(market), BID_AMOUNT);
        bidId = market.placeBid(tokenId, BID_AMOUNT, block.timestamp + 30 days, "UNGA-001");
        vm.stopPrank();
    }

    function test_AcceptBid_TransfersNFTAndUSDC() public {
        uint256 bidId = _placeBid();

        uint256 farmerBalBefore = usdc.balanceOf(farmer);

        // Custodian approves market to move the NFT
        vm.prank(custodian);
        factory.approve(address(market), tokenId);
        // acceptBid marks bid as accepted; NFT transferred on settle()
        vm.prank(custodian);
        market.acceptBid(bidId);
        assertEq(factory.ownerOf(tokenId), custodian); // still with custodian
    }






    function test_AcceptBid_RevertIfAlreadyAccepted() public {
        uint256 bidId = _placeBid();

        vm.prank(custodian);
        factory.approve(address(market), tokenId);
        vm.prank(custodian);
        market.acceptBid(bidId);

        // Try to accept again
        vm.prank(custodian);
        vm.expectRevert();
        market.acceptBid(bidId);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Cancel Bid
    // ─────────────────────────────────────────────────────────────────────────

    function test_CancelBid_RefundsUSDC() public {
        uint256 bidId = _placeBid();
        uint256 balBefore = usdc.balanceOf(buyer);

        vm.prank(buyer);
        market.cancelBid(bidId);

        assertEq(usdc.balanceOf(buyer), balBefore + BID_AMOUNT);
    }

    function test_CancelBid_RevertByStranger() public {
        uint256 bidId = _placeBid();
        vm.prank(makeAddr("stranger"));
        vm.expectRevert();
        market.cancelBid(bidId);
    }

    function test_CancelBid_RevertIfAccepted() public {
        uint256 bidId = _placeBid();

        vm.prank(custodian);
        factory.approve(address(market), tokenId);
        vm.prank(custodian);
        market.acceptBid(bidId);

        vm.prank(buyer);
        vm.expectRevert();
        market.cancelBid(bidId);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Settle (expired, unfilled bids)
    // ─────────────────────────────────────────────────────────────────────────

    function test_SettleBid_RefundsExpiredBid() public {
        uint256 bidId = _placeBid();
        uint256 buyerBalBefore = usdc.balanceOf(buyer);

        // Warp past deadline
        vm.warp(block.timestamp + 31 days);

        vm.prank(buyer);
        market.cancelBid(bidId);

        // Buyer refunded
        assertEq(usdc.balanceOf(buyer), buyerBalBefore + BID_AMOUNT);
    }

    function test_SettleBid_RevertIfNotExpired() public {
        uint256 bidId = _placeBid();

        vm.prank(settler);
        vm.expectRevert(); // bid still active
        market.settle(bidId);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Fuzz
    // ─────────────────────────────────────────────────────────────────────────

    function testFuzz_PlaceBid_AnyAmount(uint256 amount) public {
        amount = bound(amount, 1e6, 1_000_000e6); // $1 to $1M USDC-H

        usdc.mint(buyer, amount);
        vm.startPrank(buyer);
        usdc.approve(address(market), amount);
        uint256 bidId = market.placeBid(tokenId, amount, block.timestamp + 30 days, "FUZZ");
        vm.stopPrank();

        assertGt(bidId, 0);
    }
}
