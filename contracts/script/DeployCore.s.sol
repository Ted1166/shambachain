// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title DeployCore
 * @notice Deploys only the core ShambaChain contracts — no Sentinel layer.
 *         Use this for faster iteration when testing the RWA flow:
 *         MPESA → HCS → ReceiptFactory → CollateralVault → ForwardMarket
 *
 * Usage:
 *   forge script script/DeployCore.s.sol \
 *     --rpc-url hedera_testnet \
 *     --private-key $DEPLOYER_PRIVATE_KEY \
 *     --broadcast \
 *     -vvvv
 */

import {Script, console} from "forge-std/Script.sol";

import {SupraPriceFeed}  from "../src/oracle/SupraPriceFeed.sol";
import {ReceiptFactory}  from "../src/RecipientFactory.sol";
import {CollateralVault} from "../src/CollateralVault.sol";
import {ForwardMarket}   from "../src/ForwardMarket.sol";

contract DeployCore is Script {

    function run() external {
        uint256 deployerKey   = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address admin         = vm.envAddress("ADMIN_ADDRESS");
        address treasury      = vm.envAddress("TREASURY_ADDRESS");
        address usdcH         = vm.envAddress("USDC_H_ADDRESS");
        address backendWallet = vm.envAddress("BACKEND_WALLET_ADDRESS");
        address supraOracle   = vm.envOr("SUPRA_ORACLE_ADDRESS", address(0));

        vm.startBroadcast(deployerKey);

        // ── 1. SupraPriceFeed ─────────────────────────────────────────────────
        SupraPriceFeed supraPriceFeed = new SupraPriceFeed(
            admin,
            supraOracle,
            45e18,
            true   // testnet mode
        );
        console.log("SupraPriceFeed: ", address(supraPriceFeed));

        // ── 2. ReceiptFactory ─────────────────────────────────────────────────
        ReceiptFactory receiptFactory = new ReceiptFactory(admin);
        console.log("ReceiptFactory: ", address(receiptFactory));

        // ── 3. CollateralVault ────────────────────────────────────────────────
        CollateralVault collateralVault = new CollateralVault(
            admin,
            usdcH,
            address(receiptFactory),
            address(supraPriceFeed),
            treasury
        );
        console.log("CollateralVault:", address(collateralVault));

        // ── 4. ForwardMarket ──────────────────────────────────────────────────
        ForwardMarket forwardMarket = new ForwardMarket(
            admin,
            usdcH,
            address(receiptFactory),
            treasury
        );
        console.log("ForwardMarket:  ", address(forwardMarket));

        // ── WIRING ────────────────────────────────────────────────────────────
        receiptFactory.setCollateralVault(address(collateralVault));

        bytes32 MINTER_ROLE     = keccak256("MINTER_ROLE");
        bytes32 LOAN_AGENT_ROLE = keccak256("LOAN_AGENT_ROLE");
        bytes32 BUYER_AGENT_ROLE = keccak256("BUYER_AGENT_ROLE");

        receiptFactory.grantRole(MINTER_ROLE, backendWallet);
        collateralVault.grantRole(LOAN_AGENT_ROLE, backendWallet);
        forwardMarket.grantRole(BUYER_AGENT_ROLE, backendWallet);

        vm.stopBroadcast();

        console.log("\n=== CORE DEPLOYMENT COMPLETE ===");
        console.log("SupraPriceFeed: ", address(supraPriceFeed));
        console.log("ReceiptFactory: ", address(receiptFactory));
        console.log("CollateralVault:", address(collateralVault));
        console.log("ForwardMarket:  ", address(forwardMarket));
        console.log("================================\n");
    }
}