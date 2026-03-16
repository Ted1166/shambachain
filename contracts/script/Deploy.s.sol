// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title Deploy
 * @notice Full ShambaChain protocol deployment — all contracts in dependency order.
 *
 * Deploy order:
 *   1. ShambaToken
 *   2. SupraPriceFeed
 *   3. ReceiptFactory
 *   4. CollateralVault
 *   5. ForwardMarket
 *   6. RiskOracle
 *   7. RiskMarket
 *   8. HedgePosition
 *
 * Post-deploy wiring:
 *   - ReceiptFactory.setCollateralVault()
 *   - ReceiptFactory.setRiskOracle()
 *   - Grant roles to agents and backend service
 *
 * Usage:
 *   forge script script/Deploy.s.sol \
 *     --rpc-url hedera_testnet \
 *     --private-key $DEPLOYER_PRIVATE_KEY \
 *     --broadcast \
 *     -vvvv
 */

import {Script, console} from "forge-std/Script.sol";

import {ShambaToken}     from "../src/token/ShambaToken.sol";
import {SupraPriceFeed}  from "../src/oracle/SupraPriceFeed.sol";
import {ReceiptFactory}  from "../src/RecipientFactory.sol";
import {CollateralVault} from "../src/CollateralVault.sol";
import {ForwardMarket}   from "../src/ForwardMarket.sol";
import {RiskOracle}      from "../src/sentinel/RiskOracle.sol";
import {RiskMarket}      from "../src/sentinel/RiskMarket.sol";
import {HedgePosition}   from "../src/sentinel/HedgePosition.sol";

contract Deploy is Script {

    // ─── DEPLOYED ADDRESSES (written to console after deploy) ─────────────────
    ShambaToken     public shambaToken;
    SupraPriceFeed  public supraPriceFeed;
    ReceiptFactory  public receiptFactory;
    CollateralVault public collateralVault;
    ForwardMarket   public forwardMarket;
    RiskOracle      public riskOracle;
    RiskMarket      public riskMarket;
    HedgePosition   public hedgePosition;

    function run() external {
        // ── Load env ──
        uint256 deployerKey  = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address admin        = vm.envAddress("ADMIN_ADDRESS");
        address treasury     = vm.envAddress("TREASURY_ADDRESS");
        address usdcH        = vm.envAddress("USDC_H_ADDRESS");
        address backendWallet = vm.envAddress("BACKEND_WALLET_ADDRESS");

        // On testnet: Supra oracle pull contract address
        // If not set, deploy uses address(0) and testnet mode = true
        address supraOracle  = vm.envOr("SUPRA_ORACLE_ADDRESS", address(0));

        vm.startBroadcast(deployerKey);

        // ── 1. ShambaToken ────────────────────────────────────────────────────
        shambaToken = new ShambaToken(
            admin,
            treasury,
            1_000_000e18   // 1M SHAMBA initial supply
        );
        console.log("ShambaToken:    ", address(shambaToken));

        // ── 2. SupraPriceFeed ─────────────────────────────────────────────────
        supraPriceFeed = new SupraPriceFeed(
            admin,
            supraOracle,
            45e18,   // initial maize price: KES 45 per kg (18 decimals)
            true     // testnetMode = true (use manual price on testnet)
        );
        console.log("SupraPriceFeed: ", address(supraPriceFeed));

        // ── 3. ReceiptFactory ─────────────────────────────────────────────────
        receiptFactory = new ReceiptFactory(admin);
        console.log("ReceiptFactory: ", address(receiptFactory));

        // ── 4. CollateralVault ────────────────────────────────────────────────
        collateralVault = new CollateralVault(
            admin,
            usdcH,
            address(receiptFactory),
            address(supraPriceFeed),
            treasury
        );
        console.log("CollateralVault:", address(collateralVault));

        // ── 5. ForwardMarket ──────────────────────────────────────────────────
        forwardMarket = new ForwardMarket(
            admin,
            usdcH,
            address(receiptFactory),
            treasury
        );
        console.log("ForwardMarket:  ", address(forwardMarket));

        // ── 6. RiskOracle ─────────────────────────────────────────────────────
        riskOracle = new RiskOracle(
            admin,
            supraOracle,
            address(receiptFactory),
            address(collateralVault)
        );
        console.log("RiskOracle:     ", address(riskOracle));

        // ── 7. RiskMarket ─────────────────────────────────────────────────────
        riskMarket = new RiskMarket(
            admin,
            usdcH,
            address(collateralVault),
            address(shambaToken),
            treasury
        );
        console.log("RiskMarket:     ", address(riskMarket));

        // ── 8. HedgePosition ──────────────────────────────────────────────────
        hedgePosition = new HedgePosition(
            admin,
            usdcH,
            address(riskOracle),
            address(shambaToken),
            treasury
        );
        console.log("HedgePosition:  ", address(hedgePosition));

        // ── POST-DEPLOY WIRING ────────────────────────────────────────────────

        // Wire ReceiptFactory to vault and oracle
        receiptFactory.setCollateralVault(address(collateralVault));
        receiptFactory.setRiskOracle(address(riskOracle));

        // Grant MINTER_ROLE to backend service wallet
        bytes32 MINTER_ROLE = keccak256("MINTER_ROLE");
        receiptFactory.grantRole(MINTER_ROLE, backendWallet);

        // Grant LOAN_AGENT_ROLE to admin (LoanAgent will use this wallet)
        bytes32 LOAN_AGENT_ROLE = keccak256("LOAN_AGENT_ROLE");
        collateralVault.grantRole(LOAN_AGENT_ROLE, backendWallet);

        // Grant RESOLVER_ROLE to backend (RiskAgent will resolve markets)
        bytes32 RESOLVER_ROLE = keccak256("RESOLVER_ROLE");
        riskMarket.grantRole(RESOLVER_ROLE, backendWallet);

        // Grant KEEPER_ROLE to backend (RiskAgent runs keepUpkeep)
        bytes32 KEEPER_ROLE = keccak256("KEEPER_ROLE");
        riskOracle.grantRole(KEEPER_ROLE, backendWallet);

        // Grant BUYER_AGENT_ROLE on ForwardMarket to backend
        bytes32 BUYER_AGENT_ROLE = keccak256("BUYER_AGENT_ROLE");
        forwardMarket.grantRole(BUYER_AGENT_ROLE, backendWallet);


        // Grant RISK_AGENT_ROLE to backend (creates prediction markets)
        bytes32 RISK_AGENT_ROLE = keccak256("RISK_AGENT_ROLE");
        riskMarket.grantRole(RISK_AGENT_ROLE, backendWallet);

        // Grant UPDATER_ROLE to backend (updates maize price)
        bytes32 UPDATER_ROLE = keccak256("UPDATER_ROLE");
        supraPriceFeed.grantRole(UPDATER_ROLE, backendWallet);

        // Grant LIQUIDATOR_ROLE to backend (triggers liquidations)
        bytes32 LIQUIDATOR_ROLE = keccak256("LIQUIDATOR_ROLE");
        collateralVault.grantRole(LIQUIDATOR_ROLE, backendWallet);

        // Grant SETTLER_ROLE to backend on ForwardMarket
        bytes32 SETTLER_ROLE = keccak256("SETTLER_ROLE");
        forwardMarket.grantRole(SETTLER_ROLE, backendWallet);

        vm.stopBroadcast();

        // ── SUMMARY ───────────────────────────────────────────────────────────
        console.log("\n=== SHAMBACHAIN DEPLOYMENT COMPLETE ===");
        console.log("Network:        Hedera Testnet");
        console.log("Admin:         ", admin);
        console.log("Treasury:      ", treasury);
        console.log("Backend Wallet:", backendWallet);
        console.log("USDC-H:        ", usdcH);
        console.log("----------------------------------------");
        console.log("ShambaToken:   ", address(shambaToken));
        console.log("SupraPriceFeed:", address(supraPriceFeed));
        console.log("ReceiptFactory:", address(receiptFactory));
        console.log("CollateralVault:", address(collateralVault));
        console.log("ForwardMarket: ", address(forwardMarket));
        console.log("RiskOracle:    ", address(riskOracle));
        console.log("RiskMarket:    ", address(riskMarket));
        console.log("HedgePosition: ", address(hedgePosition));
        console.log("========================================\n");
    }
}
