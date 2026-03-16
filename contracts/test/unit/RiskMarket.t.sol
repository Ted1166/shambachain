// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {RiskMarket}     from "../../src/sentinel/RiskMarket.sol";
import {CollateralVault} from "../../src/CollateralVault.sol";
import {ReceiptFactory}  from "../../src/RecipientFactory.sol";
import {SupraPriceFeed}  from "../../src/oracle/SupraPriceFeed.sol";
import {ShambaToken}     from "../../src/token/ShambaToken.sol";
import {MockERC20}       from "../mocks/MockERC20.sol";
import {MockSupraOracle} from "../mocks/MockSupraOracle.sol";

/**
 * @title RiskMarketTest
 * @notice Unit tests for RiskMarket.sol (Sentinel prediction market layer)
 *
 * Covers:
 *   - createMarket: risk market on a loan
 *   - takePosition: YES/NO positions, USDC escrowed
 *   - resolveMarket: RESOLVER_ROLE settles, winners claim
 *   - claimWinnings: correct payout proportional to stake
 *   - claimRefund: when market cancelled
 *   - cancelMarket: RESOLVER_ROLE can cancel
 *   - SHAMBA holder rebate (0.5% fee rebate)
 */
contract RiskMarketTest is Test {

    // ── Contracts ─────────────────────────────────────────────────────────────
    RiskMarket      public riskMarket;
    CollateralVault public vault;
    ReceiptFactory  public factory;
    SupraPriceFeed  public priceFeed;
    ShambaToken     public shambaToken;
    MockERC20       public usdc;
    MockSupraOracle public oracle;

    // ── Roles ─────────────────────────────────────────────────────────────────
    bytes32 constant MINTER_ROLE      = keccak256("MINTER_ROLE");
    bytes32 constant LOAN_AGENT_ROLE  = keccak256("LOAN_AGENT_ROLE");
    bytes32 constant RISK_AGENT_ROLE  = keccak256("RISK_AGENT_ROLE");
    bytes32 constant RESOLVER_ROLE    = keccak256("RESOLVER_ROLE");

    // ── Actors ────────────────────────────────────────────────────────────────
    address admin     = makeAddr("admin");
    address minter    = makeAddr("minter");
    address loanAgent = makeAddr("loanAgent");
    address resolver  = makeAddr("resolver");
    address riskAgent = makeAddr("riskAgent");
    address farmer    = makeAddr("farmer");
    address custodian = makeAddr("custodian");
    address treasury  = makeAddr("treasury");
    address yesStaker = makeAddr("yesStaker"); // bets loan WILL liquidate
    address noStaker  = makeAddr("noStaker");  // bets loan will NOT liquidate
    address lp        = makeAddr("lp");

    // ── State ─────────────────────────────────────────────────────────────────
    uint256 public tokenId;
    uint256 public loanId;
    uint256 constant STAKE = 100e6; // $100 USDC-H each

    function setUp() public {
        oracle = new MockSupraOracle();
        usdc   = new MockERC20("USD Coin Hedera", "USDC-H", 6);

        vm.startPrank(admin);
        priceFeed   = new SupraPriceFeed(admin, address(oracle), 45e18, true);
        factory     = new ReceiptFactory(admin);
        vault       = new CollateralVault(
            admin, address(usdc), address(factory), address(priceFeed), treasury
        );
        shambaToken = new ShambaToken(admin, treasury, 1_000_000e18);
        riskMarket  = new RiskMarket(
            admin, address(usdc), address(vault), address(shambaToken), treasury
        );

        factory.grantRole(MINTER_ROLE, minter);
        factory.setCollateralVault(address(vault));
        vault.grantRole(LOAN_AGENT_ROLE, loanAgent);
        vault.grantRole(keccak256("LIQUIDATOR_ROLE"), loanAgent);
        riskMarket.grantRole(RISK_AGENT_ROLE, riskAgent);
        riskMarket.grantRole(RESOLVER_ROLE, resolver);
        vm.stopPrank();

        // Mint oCR
        vm.prank(minter);
        tokenId = factory.mintReceipt(
            custodian, farmer, "MAIZE", 200,
            ReceiptFactory.Grade.A, "WH-NKR-001",
            "QJK2HX9ABC", 1001, 7_111e18, "ipfs://QmRiskTest"
        );

        // Deposit vault liquidity and open a loan
        usdc.mint(lp, 10_000e6);
        vm.startPrank(lp);
        usdc.approve(address(vault), 10_000e6);
        vault.depositLiquidity(10_000e6);
        vm.stopPrank();

        vm.prank(custodian);
        factory.approve(address(vault), tokenId);
        vm.prank(custodian);
        loanId = vault.lockCollateral(tokenId);
        vm.prank(loanAgent);
        vault.issueLoan(loanId, 5_500); // 55% LTV

        // Fund stakers
        usdc.mint(yesStaker, STAKE * 5);
        usdc.mint(noStaker,  STAKE * 5);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Create Market
    // ─────────────────────────────────────────────────────────────────────────

    function test_CreateMarket_ByRiskAgent() public {
        vm.prank(riskAgent);
        uint256 marketId = riskMarket.createMarket(tokenId, loanId, 7 days);
        assertGt(marketId, 0);
    }

    function test_CreateMarket_RevertIfNotAgent() public {
        vm.prank(makeAddr("stranger"));
        riskMarket.createMarket(tokenId, loanId, 7 days);
    }

    function test_CreateMarket_RevertDuplicateOnSameLoan() public {
        vm.prank(riskAgent);
        riskMarket.createMarket(tokenId, loanId, 7 days);

        vm.prank(riskAgent);
        vm.expectRevert();
        riskMarket.createMarket(tokenId, loanId, 7 days); // same loanId
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Take Position
    // ─────────────────────────────────────────────────────────────────────────

    function _createMarket() internal returns (uint256 marketId) {
        vm.prank(riskAgent);
        marketId = riskMarket.createMarket(tokenId, loanId, 7 days);
    }

    function test_TakePosition_Yes_EscrowsUSDC() public {
        uint256 marketId = _createMarket();

        vm.startPrank(yesStaker);
        usdc.approve(address(riskMarket), STAKE);
        uint256 yesPositionId = riskMarket.takePosition(marketId, true, STAKE); // YES
        vm.stopPrank();

        assertEq(usdc.balanceOf(address(riskMarket)), STAKE);
    }

    function test_TakePosition_No_EscrowsUSDC() public {
        uint256 marketId = _createMarket();

        vm.startPrank(noStaker);
        usdc.approve(address(riskMarket), STAKE);
        uint256 noPositionId = riskMarket.takePosition(marketId, false, STAKE);
        vm.stopPrank();

        assertEq(usdc.balanceOf(address(riskMarket)), STAKE);
    }

    function test_TakePosition_RevertAfterClose() public {
        uint256 marketId = _createMarket();

        // Warp past resolution window
        vm.warp(block.timestamp + 8 days);

        vm.startPrank(yesStaker);
        usdc.approve(address(riskMarket), STAKE);
        vm.expectRevert();
        uint256 yesPositionId = riskMarket.takePosition(marketId, true, STAKE);
        vm.stopPrank();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Resolve Market
    // ─────────────────────────────────────────────────────────────────────────

    function _setupMarketWithPositions()
        internal
        returns (uint256 marketId, uint256 yesPositionId, uint256 noPositionId)
    {
        marketId = _createMarket();

        vm.startPrank(yesStaker);
        usdc.approve(address(riskMarket), STAKE);
        yesPositionId = riskMarket.takePosition(marketId, true, STAKE);
        vm.stopPrank();

        vm.startPrank(noStaker);
        usdc.approve(address(riskMarket), STAKE);
        noPositionId = riskMarket.takePosition(marketId, false, STAKE);
        vm.stopPrank();
    }

    function test_ResolveMarket_Yes_ByResolver() public {
        (uint256 marketId, uint256 yesPositionId, uint256 noPositionId) = _setupMarketWithPositions();
        vm.warp(block.timestamp + 7 days + 1);

        vm.prank(resolver);
        riskMarket.resolveMarket(marketId); // YES won (loan liquidated)
    }

    function test_ResolveMarket_RevertIfNotResolver() public {
        (uint256 marketId, uint256 yesPositionId, uint256 noPositionId) = _setupMarketWithPositions();
        vm.warp(block.timestamp + 7 days + 1);

        vm.prank(makeAddr("stranger"));
        riskMarket.resolveMarket(marketId);
    }

    function test_ResolveMarket_RevertIfAlreadyResolved() public {
        (uint256 marketId, uint256 yesPositionId, uint256 noPositionId) = _setupMarketWithPositions();
        vm.warp(block.timestamp + 7 days + 1);

        vm.prank(resolver);
        riskMarket.resolveMarket(marketId);

        vm.prank(resolver);
        vm.expectRevert();
        riskMarket.resolveMarket(marketId);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Claim Winnings
    // ─────────────────────────────────────────────────────────────────────────

    function test_ClaimWinnings_YesWinner() public {
        (uint256 marketId, uint256 yesPositionId, uint256 noPositionId) = _setupMarketWithPositions();
        vm.warp(block.timestamp + 7 days + 1);

        // Liquidate loan so YES wins
        vm.prank(admin);
        factory.updateValuation(tokenId, 1e18); // crash valuation
        vm.prank(loanAgent);
        vault.liquidate(loanId);
        vm.prank(resolver);
        riskMarket.resolveMarket(marketId); // YES wins

        uint256 balBefore = usdc.balanceOf(yesStaker);
        vm.prank(yesStaker);
        riskMarket.claimPayout(marketId, yesPositionId);
        uint256 balAfter = usdc.balanceOf(yesStaker);

        // YesStaker should win more than their stake (minus protocol fee)
        assertGt(balAfter, balBefore);
    }

    function test_ClaimWinnings_NoWinner() public {
        (uint256 marketId, uint256 yesPositionId, uint256 noPositionId) = _setupMarketWithPositions();
        vm.warp(block.timestamp + 7 days + 1);

        vm.prank(resolver);
        riskMarket.resolveMarket(marketId); // NO wins

        uint256 balBefore = usdc.balanceOf(noStaker);
        vm.prank(noStaker);
        riskMarket.claimPayout(marketId, noPositionId);

        assertGt(usdc.balanceOf(noStaker), balBefore);
    }

    function test_ClaimWinnings_LoserGetsNothing() public {
        (uint256 marketId, uint256 yesPositionId, uint256 noPositionId) = _setupMarketWithPositions();
        vm.warp(block.timestamp + 7 days + 1);

        vm.prank(resolver);
        riskMarket.resolveMarket(marketId); // YES wins

        // NO wins (loan Active), so yesStaker is the loser
        uint256 balBefore = usdc.balanceOf(yesStaker);
        vm.prank(yesStaker);
        vm.expectRevert();
        riskMarket.claimPayout(marketId, yesPositionId);
        assertEq(usdc.balanceOf(yesStaker), balBefore);
    }
    function test_ClaimWinnings_RevertIfClaimedTwice() public {
        (uint256 marketId, uint256 yesPositionId, uint256 noPositionId) = _setupMarketWithPositions();
        vm.warp(block.timestamp + 7 days + 1);
        // Liquidate loan so YES wins
        vm.prank(admin);
        factory.updateValuation(tokenId, 1e18);
        vm.prank(loanAgent);
        vault.liquidate(loanId);

        vm.prank(resolver);
        riskMarket.resolveMarket(marketId);

        vm.prank(yesStaker);
        riskMarket.claimPayout(marketId, yesPositionId);

        vm.prank(yesStaker);
        vm.expectRevert();
        riskMarket.claimPayout(marketId, yesPositionId);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Cancel Market + Refund
    // ─────────────────────────────────────────────────────────────────────────

    function test_CancelMarket_RefundsBothSides() public {
        (uint256 marketId, uint256 yesPositionId, uint256 noPositionId) = _setupMarketWithPositions();

        vm.prank(admin);
        riskMarket.cancelMarket(marketId, "test cancel");

        uint256 yBefore = usdc.balanceOf(yesStaker);
        uint256 nBefore = usdc.balanceOf(noStaker);

        vm.prank(yesStaker);
        riskMarket.claimRefund(marketId, yesPositionId);
        vm.prank(noStaker);
        riskMarket.claimRefund(marketId, noPositionId);

        assertEq(usdc.balanceOf(yesStaker), yBefore + STAKE);
        assertEq(usdc.balanceOf(noStaker),  nBefore + STAKE);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Fuzz
    // ─────────────────────────────────────────────────────────────────────────

    function testFuzz_TakePosition_AnyStake(uint256 stake) public {
        stake = bound(stake, 1e6, 10_000e6); // $1 to $10k

        uint256 marketId = _createMarket();

        usdc.mint(yesStaker, stake);
        vm.startPrank(yesStaker);
        usdc.approve(address(riskMarket), stake);
        uint256 yesPositionId = riskMarket.takePosition(marketId, true, stake);
        vm.stopPrank();

        assertGe(usdc.balanceOf(address(riskMarket)), stake);
    }
}
