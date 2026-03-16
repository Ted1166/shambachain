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
const express_1 = __importDefault(require("express"));
const dotenv = __importStar(require("dotenv"));
dotenv.config();
const webhook_1 = require("./mpesa/webhook");
const bot_1 = require("./telegram/bot");
const PriceAgent_1 = require("./agents/PriceAgent");
const RiskAgent_1 = require("./agents/RiskAgent");
const logger_1 = require("./utils/logger");
const PORT = Number(process.env.PORT ?? 3000);
async function main() {
    logger_1.logger.info("ShambaChain Backend starting...");
    // ── Express server ───────────────────────────────────────────────────────
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    // Health check
    app.get("/health", (_req, res) => {
        res.json({ status: "ok", service: "shambachain-backend", ts: new Date().toISOString() });
    });
    // MPESA STK Push callback
    app.post("/api/mpesa/callback", webhook_1.mpesaCallbackHandler);
    // STK Push initiation endpoint (called by warehouse operator UI)
    app.post("/api/mpesa/stk-push", async (req, res) => {
        const { initiateStkPush } = await Promise.resolve().then(() => __importStar(require("./mpesa/stk-push")));
        try {
            const result = await initiateStkPush(req.body);
            res.json(result);
        }
        catch (err) {
            logger_1.logger.error("STK Push error", { err });
            res.status(500).json({ error: err?.message ?? "STK Push failed" });
        }
    });
    app.listen(PORT, () => {
        logger_1.logger.info(`HTTP server listening on port ${PORT}`);
    });
    // ── Telegram bot ─────────────────────────────────────────────────────────
    const _tgToken = process.env.TELEGRAM_BOT_TOKEN ?? "";
    if (_tgToken && _tgToken.length > 10 && !_tgToken.startsWith("your")) {
        try {
            (0, bot_1.initTelegramBot)();
            logger_1.logger.info("Telegram bot initialised");
        }
        catch (err) {
            logger_1.logger.warn("Telegram bot failed to start", { err });
        }
    }
    else {
        logger_1.logger.info("Telegram bot skipped (token not configured)");
    }
    // ── Sentinel agents ──────────────────────────────────────────────────────
    const priceAgent = new PriceAgent_1.PriceAgent();
    const riskAgent = new RiskAgent_1.RiskAgent();
    priceAgent.start();
    riskAgent.start();
    logger_1.logger.info("ShambaChain Backend fully started", {
        port: PORT,
        network: process.env.HEDERA_NETWORK ?? "testnet",
        contracts: {
            receiptFactory: process.env.RECEIPT_FACTORY_ADDRESS ?? "(not set)",
            collateralVault: process.env.COLLATERAL_VAULT_ADDRESS ?? "(not set)",
            riskOracle: process.env.RISK_ORACLE_ADDRESS ?? "(not set)",
        },
    });
}
main().catch((err) => {
    logger_1.logger.error("Fatal startup error", { err });
    process.exit(1);
});
//# sourceMappingURL=index.js.map