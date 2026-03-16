// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title Seed
 * @notice Seeds the Hedera testnet with sample oCR receipts and demo loan positions.
 *         Run this AFTER Deploy.s.sol to populate the protocol with realistic data
 *         for demos and testing.
 *
 * What it creates:
 *   - 3 oCR NFTs (different warehouses, weights, grades)
 *   - 1 active CollateralVault loan (oCR #1 as collateral)
 *   - 1 ForwardMarket bid (oCR #2 with a buyer bid)
 *   - 1 RiskMarket prediction market (oCR #1 loan)
 *
 * Usage (run AFTER Deploy.s.sol):
 *   forge script script/Seed.s.sol \
 *     --rpc-url hedera_testnet \
 *     --private-key $DEPLOYER_PRIVATE_KEY \
 *     --broadcast \
 *     -vvvv
 *
 * Requirements:
 *   - All contract addresses must be set in .env
 *   - USDC_H_ADDRESS wallet must have enough USDC-H for loans + bids
 *   - DEPLOYER must have MINTER_ROLE on ReceiptFactory
 */

import {Script, console} from "forge-std/Script.sol";

import {ReceiptFactory}  from "../src/RecipientFactory.sol";
import {CollateralVault} from "../src/CollateralVault.sol";
import {ForwardMarket}   from "../src/ForwardMarket.sol";
import {RiskMarket}      from "../src/sentinel/RiskMarket.sol";
import {IERC20}          from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract Seed is Script {

    // ── Farmer demo wallets (deployer acts as all farmers on testnet) ──────────
    // In production these are protocol custodial wallets per farmer
    // Demo farmer wallets — deployer acts as all actors on testnet

    function run() external {
        // ── Load deployed addresses from env ──
        uint256 deployerKey     = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer        = vm.addr(deployerKey);

        address receiptFactoryAddr  = vm.envAddress("RECEIPT_FACTORY_ADDRESS");
        address collateralVaultAddr = vm.envAddress("COLLATERAL_VAULT_ADDRESS");
        address forwardMarketAddr   = vm.envAddress("FORWARD_MARKET_ADDRESS");
        address riskMarketAddr      = vm.envAddress("RISK_MARKET_ADDRESS");
        address usdcHAddr           = vm.envAddress("USDC_H_ADDRESS");

        ReceiptFactory  receiptFactory  = ReceiptFactory(receiptFactoryAddr);
        CollateralVault collateralVault = CollateralVault(collateralVaultAddr);
        ForwardMarket   forwardMarket   = ForwardMarket(forwardMarketAddr);
        RiskMarket      riskMarket      = RiskMarket(riskMarketAddr);
        IERC20          usdcH           = IERC20(usdcHAddr);

        vm.startBroadcast(deployerKey);

        // ─────────────────────────────────────────────────────────────────────
        // MINT oCR #1 — Nakuru warehouse, 200kg maize, Grade A
        // Simulates: farmer pays KES 500 via MPESA, backend mints after HCS event
        // ─────────────────────────────────────────────────────────────────────
        uint256 tokenId1 = receiptFactory.mintReceipt(
            deployer,                    // custodian (deployer acts as protocol custodian)
            deployer,                    // farmer (deployer on testnet)
            "MAIZE",                     // commodity
            200,                         // 200 kg
            ReceiptFactory.Grade.A,      // Grade A
            "WH-NKR-001",               // Nakuru warehouse
            "QJK2HX9ABD",               // MPESA ref
            1001,                        // HCS sequence number
            7_111e18,                    // KES 7,111 valuation (200kg * KES 35.55)
            "ipfs://QmShambaReceiptMetadata1"
        );
        console.log("Minted oCR #1 tokenId:", tokenId1);

        // ─────────────────────────────────────────────────────────────────────
        // MINT oCR #2 — Eldoret warehouse, 500kg maize, Grade B
        // ─────────────────────────────────────────────────────────────────────
        uint256 tokenId2 = receiptFactory.mintReceipt(
            deployer,
            deployer,
            "MAIZE",
            500,
            ReceiptFactory.Grade.B,
            "WH-ELD-003",
            "RLM8KZ2XYW",
            1002,
            16_500e18,
            "ipfs://QmShambaReceiptMetadata2"
        );
        console.log("Minted oCR #2 tokenId:", tokenId2);

        // ─────────────────────────────────────────────────────────────────────
        // MINT oCR #3 — Kisumu warehouse, 150kg coffee, Grade A
        // ─────────────────────────────────────────────────────────────────────
        uint256 tokenId3 = receiptFactory.mintReceipt(
            deployer,
            deployer,
            "COFFEE",
            150,
            ReceiptFactory.Grade.A,
            "WH-KSM-007",
            "TNP4WA3MNP",
            1003,
            45_000e18,   // coffee valued higher
            "ipfs://QmShambaReceiptMetadata3"
        );
        console.log("Minted oCR #3 tokenId:", tokenId3);

        // ─────────────────────────────────────────────────────────────────────
        // OPEN LOAN on oCR #1 (demonstrating full DeFi flow)
        // LTV 60% → max loan on KES 7,111 = ~$32.80 USDC-H
        // ─────────────────────────────────────────────────────────────────────

        // First deposit USDC-H liquidity into vault so it can disburse
        uint256 liquidityAmount = 1000e6; // 1000 USDC-H (6 decimals)
        usdcH.approve(collateralVaultAddr, liquidityAmount);
        collateralVault.depositLiquidity(liquidityAmount);
        console.log("Deposited USDC-H liquidity:", liquidityAmount);

        // Approve vault to handle the NFT
        // Note: ReceiptFactory implements ERC721 — approve vault for transfer ops
        receiptFactory.approve(collateralVaultAddr, tokenId1);

        // Lock oCR #1 as collateral
        uint256 loanId = collateralVault.lockCollateral(tokenId1);
        console.log("Locked collateral, loanId:", loanId);

        // Issue loan at 55% LTV (conservative, under the 60% max)
        collateralVault.issueLoan(loanId, 5_500); // 55% LTV in BPS
        console.log("Issued loan at 55% LTV");

        // ─────────────────────────────────────────────────────────────────────
        // PLACE FORWARD BID on oCR #2
        // BuyerAgent bids KES 14,000 ($107 USDC-H) for 500kg maize
        // Settlement in 30 days
        // ─────────────────────────────────────────────────────────────────────
        uint256 bidAmount = 107e6; // $107 USDC-H
        usdcH.approve(forwardMarketAddr, bidAmount);

        uint256 bidId = forwardMarket.placeBid(
            tokenId2,
            bidAmount,
            block.timestamp + 30 days,
            "UNGA-MILLS-001"             // buyer reference
        );
        console.log("Placed forward bid, bidId:", bidId);

        // ─────────────────────────────────────────────────────────────────────
        // CREATE RISK MARKET on loan #1 (oCR #1)
        // 7-day prediction window: will this loan be liquidated?
        // ─────────────────────────────────────────────────────────────────────
        uint256 marketId = riskMarket.createMarket(
            tokenId1,
            loanId,
            7 days
        );
        console.log("Created RiskMarket, marketId:", marketId);

        // Seed the market with an initial NO position (loan is healthy at 55% LTV)
        uint256 noStake = 10e6; // $10 USDC-H
        usdcH.approve(riskMarketAddr, noStake);
        riskMarket.takePosition(marketId, false, noStake); // NO = will not liquidate
        console.log("Seeded RiskMarket with NO position");

        vm.stopBroadcast();

        // ── SUMMARY ───────────────────────────────────────────────────────────
        console.log("\n=== SEED COMPLETE ===");
        console.log("oCR #1 (tokenId):", tokenId1, "| MAIZE 200kg Grade A | Collateral for loan", loanId);
        console.log("oCR #2 (tokenId):", tokenId2, "| MAIZE 500kg Grade B | Forward bid", bidId);
        console.log("oCR #3 (tokenId):", tokenId3, "| COFFEE 150kg Grade A | No positions yet");
        console.log("RiskMarket:", marketId, "| 7-day prediction on loan", loanId);
        console.log("====================\n");
    }
}
