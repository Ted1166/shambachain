"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RiskAgent = void 0;
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const node_cron_1 = __importDefault(require("node-cron"));
const contracts_1 = require("../config/contracts");
const contracts_2 = require("../config/contracts");
const writer_1 = require("../hcs/writer");
const bot_1 = require("../telegram/bot");
const logger_1 = require("../utils/logger");
const dotenv = __importStar(require("dotenv"));
dotenv.config();
const anthropic = new sdk_1.default({ apiKey: process.env.ANTHROPIC_API_KEY });
// LTV thresholds (BPS)
const WARNING_LTV_BPS = 7_000; // 70% — alert farmer
const LIQUIDATION_LTV_BPS = 8_000; // 80% — liquidate
/**
 * RiskAgent — runs every 10 minutes.
 *
 * Responsibilities:
 *   1. Scan all active loans for LTV health
 *   2. Trigger RiskOracle valuation updates on Hedera EVM
 *   3. Alert farmers when LTV approaches liquidation threshold
 *   4. Auto-liquidate positions that exceed 80% LTV
 *   5. Force-resolve RiskMarket prediction markets on liquidation
 *   6. Write all risk events to HCS for audit trail
 *   7. Use Claude to generate risk summaries for the dashboard
 *   8. Earn SHAMBA rewards for successful risk checks + liquidations
 */
class RiskAgent {
    agentAddress;
    monitoredTokenIds = [];
    running = false;
    // Loan IDs we've already alerted on (to avoid spam)
    alertedLoans = new Set();
    constructor() {
        this.agentAddress = contracts_2.signer.address;
    }
    start() {
        if (this.running)
            return;
        this.running = true;
        logger_1.logger.info("RiskAgent started", { wallet: this.agentAddress });
        // Full risk scan every 10 minutes
        node_cron_1.default.schedule("*/10 * * * *", () => this.runRiskScan());
        // Listen to LoanLiquidated events from CollateralVault
        this.subscribeToLiquidationEvents();
        // Run immediately
        this.runRiskScan();
    }
    /**
     * Add a tokenId to the monitor list (called when a new oCR is minted).
     */
    addToMonitor(tokenId) {
        if (!this.monitoredTokenIds.includes(tokenId)) {
            this.monitoredTokenIds.push(tokenId);
            logger_1.logger.info(`RiskAgent: monitoring tokenId ${tokenId}`);
        }
    }
    // ── Main risk scan ──────────────────────────────────────────────────────
    async runRiskScan() {
        logger_1.logger.info("RiskAgent: starting risk scan", {
            tokenCount: this.monitoredTokenIds.length,
        });
        if (this.monitoredTokenIds.length === 0) {
            // Auto-discover active tokens from totalSupply
            await this.discoverActiveTokens();
        }
        if (this.monitoredTokenIds.length === 0)
            return;
        try {
            // ── 1. Trigger bulk valuation update via RiskOracle ────────────────
            await this.triggerValuationUpdate();
            // ── 2. Check each loan's LTV ───────────────────────────────────────
            const vault = (0, contracts_1.getCollateralVault)();
            const risks = [];
            for (const tokenId of this.monitoredTokenIds) {
                try {
                    const loanId = await vault.tokenToLoan(tokenId);
                    if (loanId === 0n)
                        continue; // no loan on this token
                    const ltvBps = Number(await vault.getCurrentLtv(loanId));
                    risks.push({ tokenId, loanId, ltvBps });
                    logger_1.logger.info(`RiskAgent: LTV check`, {
                        tokenId,
                        loanId: loanId.toString(),
                        ltvBps,
                        pct: (ltvBps / 100).toFixed(1) + "%",
                    });
                    // ── Warning zone ───────────────────────────────────────────
                    if (ltvBps >= WARNING_LTV_BPS && ltvBps < LIQUIDATION_LTV_BPS) {
                        await this.handleWarning(tokenId, loanId, ltvBps);
                    }
                    // ── Liquidation zone ───────────────────────────────────────
                    if (ltvBps >= LIQUIDATION_LTV_BPS) {
                        await this.handleLiquidation(tokenId, loanId, ltvBps);
                    }
                }
                catch (err) {
                    logger_1.logger.warn(`RiskAgent: error checking tokenId ${tokenId}`, { err });
                }
            }
            // ── 3. Earn SHAMBA reward for risk scan ────────────────────────────
            if (risks.length > 0) {
                try {
                    const shamba = (0, contracts_1.getShambaToken)();
                    await (await shamba.rewardRiskCheck(this.agentAddress, { gasLimit: 100_000 })).wait();
                }
                catch { /* non-critical */ }
            }
            logger_1.logger.info("RiskAgent: scan complete", { checked: risks.length });
        }
        catch (err) {
            logger_1.logger.error("RiskAgent: scan error", { err });
        }
    }
    // ── Valuation update ────────────────────────────────────────────────────
    async triggerValuationUpdate() {
        const oracle = (0, contracts_1.getRiskOracle)();
        const tokenIds = this.monitoredTokenIds.slice(0, 50); // max 50 per batch
        try {
            const tx = await oracle.triggerValuationUpdate(tokenIds, "0x", // empty proof — testnetMode uses manual price
            0, // hcsSequence (0 = no HCS proof in testnet mode)
            { gasLimit: 1_000_000 });
            await tx.wait();
            logger_1.logger.info("RiskAgent: valuation update triggered", { tokenIds });
        }
        catch (err) {
            logger_1.logger.warn("RiskAgent: valuation update failed", { err });
        }
    }
    // ── Warning handler ─────────────────────────────────────────────────────
    async handleWarning(tokenId, loanId, ltvBps) {
        const alertKey = `warning-${loanId}`;
        if (this.alertedLoans.has(alertKey))
            return;
        this.alertedLoans.add(alertKey);
        const pct = (ltvBps / 100).toFixed(1);
        logger_1.logger.warn(`RiskAgent: LTV warning`, { tokenId, loanId: loanId.toString(), pct });
        const msg = `⚠️ *ShambaChain Risk Alert — oCR #${tokenId}*\n\n` +
            `Your loan LTV is at *${pct}%* — approaching the 80% liquidation threshold.\n\n` +
            `*Actions you can take:*\n` +
            `• Repay part of your loan to reduce LTV\n` +
            `• Buy a price hedge to protect against further drops\n\n` +
            `Reply */status ${tokenId}* for details.`;
        await (0, bot_1.sendTelegramMessage)(msg);
        await (0, writer_1.writeHcsEvent)({
            type: "VALUATION_UPDATE",
            version: "1.0",
            tokenId: String(tokenId),
            timestamp: new Date().toISOString(),
            network: (process.env.HEDERA_NETWORK ?? "testnet"),
        });
    }
    // ── Liquidation handler ─────────────────────────────────────────────────
    async handleLiquidation(tokenId, loanId, ltvBps) {
        const alertKey = `liquidation-${loanId}`;
        if (this.alertedLoans.has(alertKey))
            return;
        this.alertedLoans.add(alertKey);
        const pct = (ltvBps / 100).toFixed(1);
        logger_1.logger.warn(`RiskAgent: liquidating loan`, {
            tokenId,
            loanId: loanId.toString(),
            ltvBps: pct,
        });
        const vault = (0, contracts_1.getCollateralVault)();
        try {
            const tx = await vault.liquidate(loanId, { gasLimit: 500_000 });
            await tx.wait();
            logger_1.logger.info("RiskAgent: loan liquidated", { loanId: loanId.toString() });
            // ── Force-resolve any active RiskMarket for this token ─────────────
            const rmarket = (0, contracts_1.getRiskMarket)();
            const activeMarketId = await rmarket.tokenActiveMarket(tokenId);
            if (activeMarketId > 0n) {
                await (await rmarket.forceResolveOnLiquidation(activeMarketId, { gasLimit: 300_000 })).wait();
                logger_1.logger.info("RiskAgent: RiskMarket resolved on liquidation", {
                    marketId: activeMarketId.toString(),
                });
            }
            // ── SHAMBA liquidation reward ──────────────────────────────────────
            const shamba = (0, contracts_1.getShambaToken)();
            await (await shamba.rewardLiquidation(this.agentAddress, { gasLimit: 100_000 })).wait();
            // ── HCS audit event ────────────────────────────────────────────────
            await (0, writer_1.writeHcsEvent)({
                type: "LIQUIDATION",
                version: "1.0",
                tokenId: String(tokenId),
                timestamp: new Date().toISOString(),
                network: (process.env.HEDERA_NETWORK ?? "testnet"),
            });
            // ── Telegram notification ──────────────────────────────────────────
            const explanation = await this.generateLiquidationExplanation(tokenId, pct);
            await (0, bot_1.sendTelegramMessage)(`🔴 *Loan Liquidated — oCR #${tokenId}*\n\n${explanation}`);
        }
        catch (err) {
            logger_1.logger.error("RiskAgent: liquidation failed", { loanId: loanId.toString(), err });
        }
    }
    // ── Event subscription ──────────────────────────────────────────────────
    subscribeToLiquidationEvents() {
        // Hedera hashio RPC does not support eth_newFilter / event subscriptions.
        // Liquidation cleanup is handled inside handleLiquidation() after each scan.
        logger_1.logger.info("RiskAgent: liquidation monitoring via poll (Hedera hashio limitation)");
    }
    // ── Auto-discover tokens ────────────────────────────────────────────────
    async discoverActiveTokens() {
        try {
            // Query ReceiptMinted events from mirror node to discover all minted token IDs
            const mirrorUrl = process.env.HEDERA_NETWORK === "mainnet"
                ? "https://mainnet-public.mirrornode.hedera.com"
                : "https://testnet.mirrornode.hedera.com";
            const factoryAddr = (process.env.RECEIPT_FACTORY_ADDRESS ?? "").toLowerCase();
            // ReceiptMinted event topic0
            const topic0 = "0x90e6f23b6f72b87ceea2b71263a788fdd9a39a2f51983274ae78d6ac65f3794c"; // ReceiptMinted
            const url = `${mirrorUrl}/api/v1/contracts/${factoryAddr}/results/logs?limit=100&order=asc`;
            const { default: axios } = await Promise.resolve().then(() => __importStar(require("axios")));
            const res = await axios.get(url);
            const logs = res.data?.logs ?? [];
            const tokenIds = new Set();
            for (const log of logs) {
                // topics[1] is indexed tokenId (first indexed param)
                if (log.topics && log.topics.length >= 2) {
                    const tokenId = parseInt(log.topics[1], 16);
                    if (tokenId > 0)
                        tokenIds.add(tokenId);
                }
            }
            this.monitoredTokenIds = Array.from(tokenIds).filter(id => id > 0 && id <= 10_000);
            logger_1.logger.info("RiskAgent: discovered tokens via mirror node logs", {
                count: this.monitoredTokenIds.length,
                tokenIds: this.monitoredTokenIds
            });
        }
        catch (err) {
            // Fallback: check token IDs 1-20 directly on-chain
            logger_1.logger.warn("RiskAgent: mirror node discovery failed, using on-chain fallback", { err });
            const vault = (0, contracts_1.getCollateralVault)();
            const active = [];
            for (let i = 1; i <= 20; i++) {
                try {
                    const loanId = await vault.tokenToLoan(i);
                    if (loanId > 0n)
                        active.push(i);
                }
                catch { /* token doesn't exist */ }
            }
            this.monitoredTokenIds = active;
            logger_1.logger.info("RiskAgent: fallback discovered active loans", { tokenIds: active });
        }
    }
    // ── Claude commentary ───────────────────────────────────────────────────
    async generateLiquidationExplanation(tokenId, ltvPct) {
        try {
            const res = await anthropic.messages.create({
                model: "claude-sonnet-4-20250514",
                max_tokens: 100,
                messages: [{
                        role: "user",
                        content: `In 2 sentences, explain to a Kenyan farmer in simple English that their grain receipt #${tokenId} was liquidated because the loan reached ${ltvPct}% LTV due to falling maize prices. Be empathetic and mention they can deposit new grain to start again.`,
                    }],
            });
            return res.content[0].text.trim();
        }
        catch {
            return `oCR #${tokenId} was liquidated at ${ltvPct}% LTV. You can deposit new grain to get a new receipt.`;
        }
    }
}
exports.RiskAgent = RiskAgent;
//# sourceMappingURL=RiskAgent.js.map