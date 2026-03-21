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
const cors_1 = __importDefault(require("cors"));
// ── Transaction queue (prevents nonce conflicts on Hedera) ──────────────────
let txQueue = Promise.resolve();
async function queueTx(fn) {
    await txQueue;
    const result = fn();
    txQueue = result.then(() => { }, () => { });
    return result;
}
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
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    app.use((0, cors_1.default)({ origin: "*" }));
    // ── Vault auto-issue loan (called after user locks collateral) ───────────
    app.post("/api/vault/issue-loan", async (req, res) => {
        try {
            const { tokenId, ltvBps = 6000 } = req.body;
            const { getCollateralVault, CONTRACT_ADDRESSES } = await Promise.resolve().then(() => __importStar(require("./config/contracts")));
            const { ethers } = await Promise.resolve().then(() => __importStar(require("ethers")));
            // Read loanId from tokenToLoan
            const roVault = getCollateralVault();
            const loanId = await roVault.tokenToLoan(BigInt(tokenId));
            if (!loanId || loanId === 0n) {
                return res.status(400).json({ error: "No loan found for token" });
            }
            // Issue loan as LOAN_AGENT_ROLE
            const vault = getCollateralVault();
            const tx = await vault.issueLoan(loanId, ltvBps, { gasLimit: 400_000 });
            await tx.wait();
            logger_1.logger.info("Vault: loan issued by agent", { tokenId, loanId: loanId.toString(), txHash: tx.hash });
            res.json({ success: true, loanId: loanId.toString(), txHash: tx.hash });
        }
        catch (err) {
            logger_1.logger.error("Vault: issue loan failed", { err });
            res.status(500).json({ error: err?.shortMessage ?? err?.message ?? "Failed" });
        }
    });
    // ── Markets: create risk market (backend calls) ──────────────────────────
    app.post("/api/market/create", async (req, res) => {
        try {
            const { tokenId, loanId, durationDays = 7 } = req.body;
            const { getRiskMarket } = await Promise.resolve().then(() => __importStar(require("./config/contracts")));
            const market = getRiskMarket();
            const durationSecs = BigInt(durationDays * 86400);
            const tx = await market.createMarket(BigInt(tokenId), BigInt(loanId), durationSecs, { gasLimit: 400_000 });
            const receipt = await tx.wait();
            logger_1.logger.info("Market: created", { tokenId, loanId, txHash: tx.hash });
            res.json({ success: true, txHash: tx.hash });
        }
        catch (err) {
            logger_1.logger.error("Market: create failed", { err });
            res.status(500).json({ error: err?.shortMessage ?? err?.message ?? "Failed" });
        }
    });
    // ── Vault: lock collateral + issue loan (backend does both) ─────────────
    app.post("/api/vault/lock-and-borrow", async (req, res) => {
        try {
            const { tokenId, ltvBps = 6000 } = req.body;
            const { getCollateralVault } = await Promise.resolve().then(() => __importStar(require("./config/contracts")));
            const vault = getCollateralVault();
            // Get loanId (user already locked via MetaMask)
            const loanId = await vault.tokenToLoan(BigInt(tokenId));
            if (!loanId || loanId === 0n)
                throw new Error("Token not locked yet — user must lock first");
            // Issue loan
            const issueTx = await queueTx(() => vault.issueLoan(loanId, ltvBps, { gasLimit: 400_000 }));
            await issueTx.wait();
            logger_1.logger.info("Vault: lock+borrow complete", { tokenId, loanId: loanId.toString() });
            res.json({ success: true, loanId: loanId.toString(), txHash: issueTx.hash });
        }
        catch (err) {
            logger_1.logger.error("Vault: lock+borrow failed", { err });
            res.status(500).json({ error: err?.shortMessage ?? err?.message ?? "Failed" });
        }
    });
    // ── Markets: take position (backend calls after user approves USDC-H) ────
    app.post("/api/market/take-position", async (req, res) => {
        try {
            const { marketId, isYes, amount } = req.body;
            const { getRiskMarket } = await Promise.resolve().then(() => __importStar(require("./config/contracts")));
            // USDC-H pre-approved via cast send — just call takePosition directly
            const amountBn = BigInt(Math.ceil(amount * 1e6));
            const market = getRiskMarket();
            const tx = await queueTx(() => market.takePosition(marketId, isYes, amountBn, { gasLimit: 400_000 }));
            await tx.wait();
            logger_1.logger.info("Market: position taken", { marketId, isYes, txHash: tx.hash });
            res.json({ success: true, txHash: tx.hash });
        }
        catch (err) {
            logger_1.logger.error("Market: take position failed", { err });
            res.status(500).json({ error: err?.shortMessage ?? err?.message ?? "Failed" });
        }
    });
    // ── Mirror node proxy (avoids CORS in browser) ─────────────────────────
    app.get("/api/mirror/receipt-tokens", async (req, res) => {
        const axios = (await Promise.resolve().then(() => __importStar(require("axios")))).default;
        const addr = "0x451f2f54a027f9ec359f1411f341878d645dd337";
        const topic0 = "0x90e6f23b6f72b87ceea2b71263a788fdd9a39a2f51983274ae78d6ac65f3794c";
        const r = await axios.get(`https://testnet.mirrornode.hedera.com/api/v1/contracts/${addr}/results/logs?limit=100&order=asc`);
        const ids = (r.data?.logs ?? [])
            .filter((l) => l.topics?.[0] === topic0 && l.topics?.[1])
            .map((l) => parseInt(l.topics[1], 16))
            .filter((id) => id > 0 && id <= 10_000);
        res.json({ tokenIds: [...new Set(ids)] });
    });
    app.get("/health", (_req, res) => {
        res.json({ status: "ok", service: "shambachain-backend", ts: new Date().toISOString() });
    });
    app.post("/api/mpesa/callback", webhook_1.mpesaCallbackHandler);
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