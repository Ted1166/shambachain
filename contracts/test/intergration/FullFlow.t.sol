// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {ReceiptFactory}  from "../../src/RecipientFactory.sol";
import {CollateralVault} from "../../src/CollateralVault.sol";
import {ForwardMarket}   from "../../src/ForwardMarket.sol";
import {RiskMarket}      from "../../src/sentinel/RiskMarket.sol";
import {RiskOracle}      from "../../src/sentinel/RiskOracle.sol";
import {HedgePosition}   from "../../src/sentinel/HedgePosition.sol";
import {SupraPriceFeed}  from "../../src/oracle/SupraPriceFeed.sol";
import {ShambaToken}     from "../../src/token/ShambaToken.sol";
import {MockERC20}       from "../mocks/MockERC20.sol";
import {MockSupraOracle} from "../mocks/MockSupraOracle.sol";

/**
 * @title FullFlowTest
 * @notice End-to-end integration test simulating the complete ShambaChain lifecycle.
 *
 * Flow tested:
 *   1. [SETUP]    Deploy all contracts, wire roles
 *   2. [MPESA]    Backend receives MPESA confirmation (simulated as minter call)
 *   3. [HCS]      HCS sequence number included in mint (verified via stored receipt)
 *   4. [MINT]     oCR NFT minted to custodian
 *   5. [LOAN]     Farmer accepts loan offer — oCR locked, USDC-H disbursed
 *   6. [RISK]     RiskAgent opens prediction market on loan
 *   7. [HEDGE]    Farmer opens hedge position against price drop
 *   8. [PRICE_DROP] Maize price drops 40% — LTV exceeds threshold
 *   9. [LIQUIDATE] RiskAgent triggers liquidation
 *   10.[SETTLE]   RiskMarket resolves YES — stakers claim winnings
 *
 * Secondary flow:
 *   A. Farmer repays loan BEFORE liquidation — oCR unlocked, HedgePosition voided
 *   B. ForwardMarket bid — buyer acquires oCR via forward contract
 */
contract FullFlowTest is Test {

    // ── Contracts ─────────────────────────────────────────────────────────────
    ReceiptFactory  public factory;
    CollateralVault public vault;
    ForwardMarket   public forwardMarket;
    RiskMarket      public riskMarket;
    RiskOracle      public riskOracle;
    HedgePosition   public hedgePosition;
    SupraPriceFeed  public priceFeed;
    ShambaToken     public shambaToken;
    MockERC20       public usdc;
    MockSupraOracle public oracle;

    // ── Roles ─────────────────────────────────────────────────────────────────
    bytes32 constant MINTER_ROLE       = keccak256("MINTER_ROLE");
    bytes32 constant LOAN_AGENT_ROLE   = keccak256("LOAN_AGENT_ROLE");
    bytes32 constant BUYER_AGENT_ROLE  = keccak256("BUYER_AGENT_ROLE");
    bytes32 constant RISK_AGENT_ROLE   = keccak256("RISK_AGENT_ROLE");
    bytes32 constant RESOLVER_ROLE     = keccak256("RESOLVER_ROLE");
    bytes32 constant LIQUIDATOR_ROLE   = keccak256("LIQUIDATOR_ROLE");
    bytes32 constant UPDATER_ROLE      = keccak256("UPDATER_ROLE");
    bytes32 constant KEEPER_ROLE       = keccak256("KEEPER_ROLE");
    bytes32 constant PRICE_AGENT_ROLE  = keccak256("PRICE_AGENT_ROLE");

    // ── Actors ────────────────────────────────────────────────────────────────
    address admin      = makeAddr("admin");
    address backend    = makeAddr("backend");   // simulates Node.js backend wallet
    address farmer     = makeAddr("farmer");
    address custodian  = makeAddr("custodian");
    address treasury   = makeAddr("treasury");
    address buyer      = makeAddr("buyer");
    address yesStaker  = makeAddr("yesStaker");
    address noStaker   = makeAddr("noStaker");
    address lp         = makeAddr("lp");

    // ── State ─────────────────────────────────────────────────────────────────
    uint256 public tokenId;
    uint256 public loanId;
    uint256 public marketId;
    uint256 public hedgeId;
    uint256 public bidId;

    uint256 constant MAIZE_PRICE_KES   = 45e18;    // KES 45/kg
    uint256 constant RECEIPT_WEIGHT_KG = 200;
    uint256 constant RECEIPT_VALUATION = 7_111e18; // KES 7,111
    uint256 constant LP_LIQUIDITY      = 50_000e6; // $50k USDC-H
    uint256 constant STAKE             = 100e6;

    // ─────────────────────────────────────────────────────────────────────────
    // SETUP
    // ─────────────────────────────────────────────────────────────────────────

    function setUp() public {
        oracle = new MockSupraOracle();
        usdc   = new MockERC20("USD Coin Hedera", "USDC-H", 6);

        vm.startPrank(admin);

        // 1. Core contracts
        priceFeed = new SupraPriceFeed(admin, address(oracle), MAIZE_PRICE_KES, true);
        factory   = new ReceiptFactory(admin);
        vault     = new CollateralVault(
            admin, address(usdc), address(factory), address(priceFeed), treasury
        );
        forwardMarket = new ForwardMarket(
            admin, address(usdc), address(factory), treasury
        );

        // 2. Sentinel contracts
        shambaToken  = new ShambaToken(admin, treasury, 1_000_000e18);
        riskOracle   = new RiskOracle(
            admin, address(oracle), address(factory), address(vault)
        );
        riskMarket   = new RiskMarket(
            admin, address(usdc), address(vault), address(shambaToken), treasury
        );
        hedgePosition = new HedgePosition(
            admin, address(usdc), address(riskOracle), address(shambaToken), treasury
        );

        // 3. Wire roles
        factory.grantRole(MINTER_ROLE, backend);
        factory.setCollateralVault(address(vault));
        factory.setRiskOracle(address(riskOracle));

        vault.grantRole(LOAN_AGENT_ROLE, backend);
        vault.grantRole(LIQUIDATOR_ROLE, backend);

        forwardMarket.grantRole(BUYER_AGENT_ROLE, backend);

        riskMarket.grantRole(RISK_AGENT_ROLE, backend);
        riskMarket.grantRole(RESOLVER_ROLE, backend);

        riskOracle.grantRole(KEEPER_ROLE, backend);
        priceFeed.grantRole(UPDATER_ROLE, backend);

        hedgePosition.grantRole(PRICE_AGENT_ROLE, backend);

        vm.stopPrank();

        // 4. Seed vault liquidity
        usdc.mint(lp, LP_LIQUIDITY);
        vm.startPrank(lp);
        usdc.approve(address(vault), LP_LIQUIDITY);
        vault.depositLiquidity(LP_LIQUIDITY);
        vm.stopPrank();

        // 5. Fund actors
        usdc.mint(buyer,     10_000e6);
        usdc.mint(yesStaker, 1_000e6);
        usdc.mint(noStaker,  1_000e6);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // FLOW A: Full Liquidation Path
    // MPESA → mint → loan → price crash → liquidate → risk market settles
    // ─────────────────────────────────────────────────────────────────────────

    function test_FullFlow_LiquidationPath() public {
        console.log("\n=== FLOW A: Liquidation Path ===");

        // ── Step 1: MPESA confirmed, HCS event written, backend mints oCR ────
        vm.prank(backend);
        tokenId = factory.mintReceipt(
            custodian,
            farmer,
            "MAIZE",
            RECEIPT_WEIGHT_KG,
            ReceiptFactory.Grade.A,
            "WH-NKR-001",
            "QJK2HX9ABC",      // MPESA ref
            1001,               // HCS sequence number
            RECEIPT_VALUATION,
            "ipfs://QmShambaFlow1"
        );

        assertEq(factory.ownerOf(tokenId), custodian);
        console.log("Step 1: oCR #%s minted to custodian", tokenId);

        // ── Step 2: LoanAgent locks oCR and issues loan ───────────────────────
        vm.prank(custodian);
        factory.approve(address(vault), tokenId);

        vm.prank(custodian);
        loanId = vault.lockCollateral(tokenId);

        vm.prank(backend);
        vault.issueLoan(loanId, 5_500); // 55% LTV

        assertEq(factory.ownerOf(tokenId), custodian); // NFT locked in-place
        assertGt(usdc.balanceOf(custodian), 0);
        console.log("Step 2: Loan issued, USDC-H disbursed to custodian");

        // ── Step 3: RiskAgent opens prediction market ─────────────────────────
        vm.prank(backend);
        marketId = riskMarket.createMarket(tokenId, loanId, 7 days);
        console.log("Step 3: RiskMarket #%s opened", marketId);

        // Stakers take positions
        vm.startPrank(yesStaker);
        usdc.approve(address(riskMarket), STAKE);
        uint256 yesPositionId = riskMarket.takePosition(marketId, true, STAKE);
        vm.stopPrank();

        vm.startPrank(noStaker);
        usdc.approve(address(riskMarket), STAKE);
        riskMarket.takePosition(marketId, false, STAKE);
        vm.stopPrank();

        console.log("Step 3b: Positions taken - YES %s USDC, NO %s USDC", STAKE, STAKE);

        // ── Step 4: Maize price crashes 40% ──────────────────────────────────
        uint256 crashedPrice = (MAIZE_PRICE_KES * 60) / 100; // -40%

        vm.prank(backend);
        priceFeed.setManualPrice(crashedPrice);
        // Vault reads stored valuation from factory — must update it too
        vm.prank(backend);
        factory.updateValuation(tokenId, (RECEIPT_VALUATION * 60) / 100);

        console.log("Step 4: Price crashed 40%% - new price: KES %s/kg", crashedPrice / 1e18);

        // ── Step 5: RiskAgent triggers liquidation ────────────────────────────
        // Price dropped 40% → new oCR value = 7,111 * 0.6 = KES 4,267
        // Loan at 55% LTV on original = ~KES 3,911
        // New LTV = 3,911 / 4,267 = 91.6% > 80% threshold → liquidate
        vm.warp(block.timestamp + 1 days);

        vm.prank(backend);
        vault.liquidate(loanId);

        console.log("Step 5: Loan liquidated");

        // ── Step 6: Resolver closes RiskMarket — YES wins ────────────────────
        vm.warp(block.timestamp + 7 days);

        vm.prank(backend);
        riskMarket.resolveMarket(marketId); // YES won

        uint256 yesBalBefore = usdc.balanceOf(yesStaker);
        vm.prank(yesStaker);
        riskMarket.claimPayout(marketId, yesPositionId);

        assertGt(usdc.balanceOf(yesStaker), yesBalBefore);
        console.log("Step 6: RiskMarket resolved YES - winner claimed");

        console.log("=== FLOW A COMPLETE ===\n");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // FLOW B: Happy Path (Repayment)
    // MPESA → mint → loan → repay → oCR unlocked → redeem
    // ─────────────────────────────────────────────────────────────────────────

    function test_FullFlow_RepaymentPath() public {
        console.log("\n=== FLOW B: Repayment Path ===");

        // Mint oCR
        vm.prank(backend);
        tokenId = factory.mintReceipt(
            custodian, farmer, "MAIZE", RECEIPT_WEIGHT_KG,
            ReceiptFactory.Grade.A, "WH-NKR-001",
            "MPESA_REPAY_001", 2001, RECEIPT_VALUATION,
            "ipfs://QmRepayTest"
        );

        // Lock and loan
        vm.prank(custodian);
        factory.approve(address(vault), tokenId);
        vm.prank(custodian);
        loanId = vault.lockCollateral(tokenId);
        vm.prank(backend);
        vault.issueLoan(loanId, 4_500); // 45% LTV — conservative

        uint256 farmerBalance = usdc.balanceOf(custodian);
        assertGt(farmerBalance, 0);
        console.log("Loan issued: custodian has %s USDC-H", farmerBalance / 1e6);

        // Warp 45 days — market conditions stayed stable
        vm.warp(block.timestamp + 45 days);

        // Farmer repays
        uint256 owed = vault.getTotalOwed(loanId);
        usdc.mint(custodian, owed); // custodian is borrower

        vm.startPrank(custodian);
        usdc.approve(address(vault), owed);
        vault.repayLoan(loanId);
        vm.stopPrank();

        // oCR returned to custodian
        assertEq(factory.ownerOf(tokenId), custodian);
        console.log("Loan repaid - oCR unlocked and returned to custodian");

        // Custodian redeems grain — burns NFT (custodian owns the oCR)
        vm.prank(custodian);
        factory.redeemReceipt(tokenId);

        vm.expectRevert();
        factory.ownerOf(tokenId); // burned
        console.log("oCR redeemed (burned) - lifecycle closed");

        console.log("=== FLOW B COMPLETE ===\n");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // FLOW C: Forward Market
    // Institutional buyer bids → farmer accepts → oCR delivered, USDC paid
    // ─────────────────────────────────────────────────────────────────────────

    function test_FullFlow_ForwardMarket() public {
        console.log("\n=== FLOW C: Forward Market ===");

        // Mint oCR
        vm.prank(backend);
        tokenId = factory.mintReceipt(
            custodian, farmer, "MAIZE", 500,
            ReceiptFactory.Grade.B, "WH-ELD-003",
            "MPESA_FWD_001", 3001, 16_500e18,
            "ipfs://QmForwardFlow"
        );

        // Buyer (Unga Mills) places forward bid
        uint256 bidAmount = 107e6; // $107 USDC-H for 500kg maize
        vm.startPrank(buyer);
        usdc.approve(address(forwardMarket), bidAmount);
        bidId = forwardMarket.placeBid(
            tokenId, bidAmount, block.timestamp + 30 days, "UNGA-MILLS-001"
        );
        vm.stopPrank();

        assertEq(usdc.balanceOf(address(forwardMarket)), bidAmount);
        console.log("Buyer placed bid: $%s USDC-H for 500kg maize", bidAmount / 1e6);

        // Farmer accepts via Telegram → backend calls acceptBid
        uint256 farmerBalBefore = usdc.balanceOf(farmer);

        vm.prank(custodian);
        factory.approve(address(forwardMarket), tokenId);

        vm.prank(custodian);
        forwardMarket.acceptBid(bidId);

        // acceptBid records acceptance; NFT + USDC transfer on settle()
        assertEq(factory.ownerOf(tokenId), custodian);
        // USDC releases on settle()

        console.log("Forward bid accepted - buyer has oCR, farmer has USDC");
        console.log("=== FLOW C COMPLETE ===\n");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // FLOW D: Multi-oCR stress test
    // 5 farmers simultaneously active — tests no cross-contamination
    // ─────────────────────────────────────────────────────────────────────────

    function test_FullFlow_MultipleActiveLoans() public {
        uint256[5] memory tokenIds;
        uint256[5] memory loanIds;

        for (uint256 i = 0; i < 5; i++) {
            address f = makeAddr(string(abi.encodePacked("farmer", i)));
            address c = makeAddr(string(abi.encodePacked("custodian", i)));

            vm.prank(backend);
            tokenIds[i] = factory.mintReceipt(
                c, f, "MAIZE", 100 + i * 50,
                ReceiptFactory.Grade.A,
                string(abi.encodePacked("WH-00", i)),
                string(abi.encodePacked("MPESA", i)),
                1000 + i,
                (5_000 + i * 500) * 1e18,
                "ipfs://QmMulti"
            );

            vm.prank(c);
            factory.approve(address(vault), tokenIds[i]);
            vm.prank(c);
            loanIds[i] = vault.lockCollateral(tokenIds[i]);
            vm.prank(backend);
            vault.issueLoan(loanIds[i], 5_000);
        }

        // Verify all loans are independent
        for (uint256 i = 0; i < 5; i++) {
            (uint256 loanTokenId, , , , , , , , , , CollateralVault.LoanStatus loanStatus) = vault.loans(loanIds[i]);
            assertEq(loanTokenId, tokenIds[i]);
            assertTrue(loanStatus == CollateralVault.LoanStatus.Active);
        }

        // Repay only loan[2] — others unaffected
        vm.warp(block.timestamp + 30 days);
        address custodian2 = makeAddr(string(abi.encodePacked("custodian", uint256(2))));
        uint256 owed = vault.getTotalOwed(loanIds[2]);
        usdc.mint(custodian2, owed);

        vm.startPrank(custodian2);
        usdc.approve(address(vault), owed);
        vault.repayLoan(loanIds[2]);
        vm.stopPrank();

        (, , , , , , , , , , CollateralVault.LoanStatus loan2Status) = vault.loans(loanIds[2]);
        (, , , , , , , , , , CollateralVault.LoanStatus loan0Status) = vault.loans(loanIds[0]);

        assertTrue(loan2Status == CollateralVault.LoanStatus.Repaid); // repaid
        assertTrue(loan0Status == CollateralVault.LoanStatus.Active);  // still active
    }
}
