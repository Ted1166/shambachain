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
exports.PriceAgent = void 0;
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
// ── State ─────────────────────────────────────────────────────────────────────
let lastPriceKes = 0n;
let lastAlertSentAt = 0;
const ALERT_COOLDOWN_MS = 30 * 60 * 1000; // 30 min between alerts
/**
 * PriceAgent — runs every 5 minutes.
 *
 * Responsibilities:
 *   1. Poll SupraPriceFeed for latest maize KES/kg price
 *   2. Detect significant price moves (>= 5% change)
 *   3. Post price update to HCS for audit trail
 *   4. Send Telegram alert to farmers if price drops significantly
 *   5. Earn SHAMBA reward via ShambaToken.rewardPriceUpdate()
 *   6. Use Claude to generate a natural-language market commentary
 */
class PriceAgent {
    agentAddress;
    running = false;
    constructor() {
        this.agentAddress = contracts_2.signer.address;
    }
    start() {
        if (this.running)
            return;
        this.running = true;
        logger_1.logger.info("PriceAgent started", { wallet: this.agentAddress });
        // Run every 5 minutes
        node_cron_1.default.schedule("*/5 * * * *", () => this.tick());
        // Run immediately on start
        this.tick();
    }
    async tick() {
        try {
            await this.checkPrice();
        }
        catch (err) {
            logger_1.logger.error("PriceAgent tick error", { err });
        }
    }
    async checkPrice() {
        const feed = (0, contracts_1.getSupraPriceFeed)();
        const [price, timestamp] = await feed.getMaizePriceKes();
        const isStale = await feed.isStale();
        const currentPrice = BigInt(price.toString());
        const tsNum = Number(timestamp);
        logger_1.logger.info("PriceAgent: price fetched", {
            priceKes: formatKes(currentPrice),
            timestamp: new Date(tsNum * 1000).toISOString(),
            stale: isStale,
        });
        if (isStale) {
            logger_1.logger.warn("PriceAgent: oracle price is stale — skipping update");
            return;
        }
        // ── Detect significant price move ────────────────────────────────────
        const priceMoved = lastPriceKes > 0n && priceChangePct(lastPriceKes, currentPrice) >= 5;
        if (priceMoved || lastPriceKes === 0n) {
            const direction = currentPrice > lastPriceKes ? "↑" : "↓";
            const changePct = lastPriceKes > 0n
                ? priceChangePct(lastPriceKes, currentPrice).toFixed(1)
                : "0.0";
            logger_1.logger.info(`PriceAgent: significant move ${direction} ${changePct}%`, {
                old: formatKes(lastPriceKes),
                new: formatKes(currentPrice),
            });
            // ── Write to HCS ─────────────────────────────────────────────────
            await (0, writer_1.writeHcsEvent)({
                type: "VALUATION_UPDATE",
                version: "1.0",
                timestamp: new Date().toISOString(),
                network: (process.env.HEDERA_NETWORK ?? "testnet"),
            });
            // ── Generate Claude commentary ────────────────────────────────────
            const commentary = await this.generateCommentary(currentPrice, lastPriceKes);
            // ── Telegram alert ────────────────────────────────────────────────
            const now = Date.now();
            if (now - lastAlertSentAt > ALERT_COOLDOWN_MS && currentPrice < lastPriceKes) {
                const alertMsg = `🌽 *ShambaChain Price Alert*\n\n` +
                    `Maize: *KES ${formatKes(currentPrice)}/kg* ${direction} ${changePct}%\n\n` +
                    `${commentary}\n\n` +
                    `_Consider buying a hedge to protect your oCR collateral._`;
                await (0, bot_1.sendTelegramMessage)(alertMsg);
                lastAlertSentAt = now;
            }
            // ── Earn SHAMBA reward ────────────────────────────────────────────
            try {
                const shamba = (0, contracts_1.getShambaToken)();
                await (await shamba.rewardPriceUpdate(this.agentAddress, { gasLimit: 100_000 })).wait();
                logger_1.logger.info("PriceAgent: SHAMBA reward claimed");
            }
            catch (rewardErr) {
                logger_1.logger.warn("PriceAgent: SHAMBA reward failed (may be out of supply)", { rewardErr });
            }
        }
        lastPriceKes = currentPrice;
    }
    /**
     * Use Claude to generate a 1-sentence Telegram-friendly market commentary.
     */
    async generateCommentary(current, previous) {
        try {
            const pct = previous > 0n ? priceChangePct(previous, current).toFixed(1) : "0";
            const dir = current > previous ? "risen" : "fallen";
            const msg = await anthropic.messages.create({
                model: "claude-sonnet-4-20250514",
                max_tokens: 100,
                messages: [{
                        role: "user",
                        content: `In one sentence (max 25 words), explain to a Kenyan maize farmer what a ${pct}% ${dir} in maize price to KES ${formatKes(current)}/kg means for their stored grain value. Be encouraging.`,
                    }],
            });
            return msg.content[0].text.trim();
        }
        catch {
            return `Maize price has moved to KES ${formatKes(current)}/kg.`;
        }
    }
}
exports.PriceAgent = PriceAgent;
// ── Helpers ───────────────────────────────────────────────────────────────────
function formatKes(wei) {
    return (Number(wei) / 1e18).toFixed(2);
}
function priceChangePct(oldPrice, newPrice) {
    if (oldPrice === 0n)
        return 0;
    const diff = newPrice > oldPrice ? newPrice - oldPrice : oldPrice - newPrice;
    return Number((diff * 10000n) / oldPrice) / 100;
}
//# sourceMappingURL=PriceAgent.js.map