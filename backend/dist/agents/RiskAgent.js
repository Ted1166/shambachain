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
const WARNING_LTV_BPS = 7_000;
const LIQUIDATION_LTV_BPS = 8_000;
class RiskAgent {
    agentAddress;
    monitoredTokenIds = [];
    running = false;
    alertedLoans = new Set();
    constructor() {
        this.agentAddress = contracts_2.signer.address;
    }
    start() {
        if (this.running)
            return;
        this.running = true;
        logger_1.logger.info("RiskAgent started", { wallet: this.agentAddress });
        node_cron_1.default.schedule("*/10 * * * *", () => this.runRiskScan());
        this.subscribeToLiquidationEvents();
        this.runRiskScan();
    }
    addToMonitor(tokenId) {
        if (!this.monitoredTokenIds.includes(tokenId)) {
            this.monitoredTokenIds.push(tokenId);
            logger_1.logger.info(`RiskAgent: monitoring tokenId ${tokenId}`);
        }
    }
    async runRiskScan() {
        logger_1.logger.info("RiskAgent: starting risk scan", {
            tokenCount: this.monitoredTokenIds.length,
        });
        if (this.monitoredTokenIds.length === 0) {
            await this.discoverActiveTokens();
        }
        if (this.monitoredTokenIds.length === 0)
            return;
        try {
            await this.triggerValuationUpdate();
            const vault = (0, contracts_1.getCollateralVault)();
            const risks = [];
            for (const tokenId of this.monitoredTokenIds) {
                try {
                    const loanId = await vault.tokenToLoan(tokenId);
                    if (loanId === 0n)
                        continue;
                    const ltvBps = Number(await vault.getCurrentLtv(loanId));
                    risks.push({ tokenId, loanId, ltvBps });
                    logger_1.logger.info(`RiskAgent: LTV check`, {
                        tokenId,
                        loanId: loanId.toString(),
                        ltvBps,
                        pct: (ltvBps / 100).toFixed(1) + "%",
                    });
                    if (ltvBps >= WARNING_LTV_BPS && ltvBps < LIQUIDATION_LTV_BPS) {
                        await this.handleWarning(tokenId, loanId, ltvBps);
                    }
                    if (ltvBps >= LIQUIDATION_LTV_BPS) {
                        await this.handleLiquidation(tokenId, loanId, ltvBps);
                    }
                }
                catch (err) {
                    logger_1.logger.warn(`RiskAgent: error checking tokenId ${tokenId}`, { err });
                }
            }
            if (risks.length > 0) {
                try {
                    const shamba = (0, contracts_1.getShambaToken)();
                    await (await shamba.rewardRiskCheck(this.agentAddress, { gasLimit: 300_000 })).wait();
                }
                catch { /* non-critical */ }
            }
            logger_1.logger.info("RiskAgent: scan complete", { checked: risks.length });
        }
        catch (err) {
            logger_1.logger.error("RiskAgent: scan error", { err });
        }
    }
    async triggerValuationUpdate() {
        const oracle = (0, contracts_1.getRiskOracle)();
        const tokenIds = this.monitoredTokenIds.slice(0, 50);
        try {
            const tx = await oracle.triggerValuationUpdate(tokenIds, "0x", 0, { gasLimit: 1_000_000 });
            await tx.wait();
            logger_1.logger.info("RiskAgent: valuation update triggered", { tokenIds });
        }
        catch (err) {
            logger_1.logger.warn("RiskAgent: valuation update failed", { err });
        }
    }
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
            const rmarket = (0, contracts_1.getRiskMarket)();
            const activeMarketId = await rmarket.tokenActiveMarket(tokenId);
            if (activeMarketId > 0n) {
                await (await rmarket.forceResolveOnLiquidation(activeMarketId, { gasLimit: 300_000 })).wait();
                logger_1.logger.info("RiskAgent: RiskMarket resolved on liquidation", {
                    marketId: activeMarketId.toString(),
                });
            }
            const shamba = (0, contracts_1.getShambaToken)();
            await (await shamba.rewardLiquidation(this.agentAddress, { gasLimit: 300_000 })).wait();
            await (0, writer_1.writeHcsEvent)({
                type: "LIQUIDATION",
                version: "1.0",
                tokenId: String(tokenId),
                timestamp: new Date().toISOString(),
                network: (process.env.HEDERA_NETWORK ?? "testnet"),
            });
            const explanation = await this.generateLiquidationExplanation(tokenId, pct);
            await (0, bot_1.sendTelegramMessage)(`🔴 *Loan Liquidated — oCR #${tokenId}*\n\n${explanation}`);
        }
        catch (err) {
            logger_1.logger.error("RiskAgent: liquidation failed", { loanId: loanId.toString(), err });
        }
    }
    subscribeToLiquidationEvents() {
        logger_1.logger.info("RiskAgent: liquidation monitoring via poll (Hedera hashio limitation)");
    }
    async discoverActiveTokens() {
        try {
            const mirrorUrl = process.env.HEDERA_NETWORK === "mainnet"
                ? "https://mainnet-public.mirrornode.hedera.com"
                : "https://testnet.mirrornode.hedera.com";
            const factoryAddr = (process.env.RECEIPT_FACTORY_ADDRESS ?? "").toLowerCase();
            const topic0 = "0x90e6f23b6f72b87ceea2b71263a788fdd9a39a2f51983274ae78d6ac65f3794c";
            const url = `${mirrorUrl}/api/v1/contracts/${factoryAddr}/results/logs?limit=100&order=asc`;
            const { default: axios } = await Promise.resolve().then(() => __importStar(require("axios")));
            const res = await axios.get(url);
            const logs = res.data?.logs ?? [];
            const tokenIds = new Set();
            for (const log of logs) {
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