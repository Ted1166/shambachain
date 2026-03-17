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
exports.initTelegramBot = initTelegramBot;
exports.sendTelegramMessage = sendTelegramMessage;
const node_telegram_bot_api_1 = __importDefault(require("node-telegram-bot-api"));
const LoanAgent_1 = require("../agents/LoanAgent");
const contracts_1 = require("../config/contracts");
const logger_1 = require("../utils/logger");
const dotenv = __importStar(require("dotenv"));
dotenv.config();
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
let bot = null;
let loanAgent = null;
const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID ?? "";
function initTelegramBot() {
    if (!BOT_TOKEN || BOT_TOKEN === "your-token-here") {
        throw new Error("TELEGRAM_BOT_TOKEN not set");
    }
    bot = new node_telegram_bot_api_1.default(BOT_TOKEN, { polling: true });
    loanAgent = new LoanAgent_1.LoanAgent();
    registerHandlers(bot);
    logger_1.logger.info("Telegram bot started (polling mode)");
    return bot;
}
async function sendTelegramMessage(text, chatId = ADMIN_CHAT_ID) {
    if (!bot || !chatId) {
        logger_1.logger.warn("Telegram bot not initialised or no chatId — skipping message");
        return;
    }
    try {
        await bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
    }
    catch (err) {
        logger_1.logger.error("Failed to send Telegram message", { err, chatId });
    }
}
function registerHandlers(bot) {
    bot.onText(/\/start/, async (msg) => {
        const chatId = String(msg.chat.id);
        await bot.sendMessage(chatId, `🌽 *Welcome to ShambaChain*\n\n` +
            `I help you manage your tokenised grain receipts (oCR) on Hedera.\n\n` +
            `*Commands:*\n` +
            `/price — current maize price\n` +
            `/loan <tokenId> — get a loan offer on your oCR\n` +
            `/accept <tokenId> — accept a loan offer\n` +
            `/status <tokenId> — check your loan status\n` +
            `/help — show this menu`, { parse_mode: "Markdown" });
    });
    bot.onText(/\/price/, async (msg) => {
        const chatId = String(msg.chat.id);
        try {
            const feed = (0, contracts_1.getSupraPriceFeed)();
            const [price, timestamp] = await feed.getMaizePriceKes();
            const isStale = await feed.isStale();
            const priceNum = (Number(price) / 1e18).toFixed(2);
            const tsDate = new Date(Number(timestamp) * 1000).toLocaleString("en-KE");
            await bot.sendMessage(chatId, `🌽 *Maize Price*\n\n` +
                `*KES ${priceNum}/kg*\n` +
                `Updated: ${tsDate}\n` +
                (isStale ? "⚠️ _Price may be stale_" : "✅ _Live price_"), { parse_mode: "Markdown" });
        }
        catch (err) {
            await bot.sendMessage(chatId, "❌ Could not fetch price. Try again.");
            logger_1.logger.error("Telegram /price error", { err });
        }
    });
    bot.onText(/\/loan (\d+)/, async (msg, match) => {
        const chatId = String(msg.chat.id);
        const tokenId = BigInt(match[1]);
        await bot.sendMessage(chatId, `⏳ Evaluating oCR #${tokenId}...`);
        try {
            const proposal = await loanAgent.proposeLoan(tokenId, chatId);
            await bot.sendMessage(chatId, `🏦 *Loan Offer — oCR #${tokenId}*\n\n` +
                `${proposal.explanation}\n\n` +
                `💰 *Max Loan:* $${(Number(proposal.maxLoanUsdcH) / 1e6).toFixed(2)} USDC-H\n` +
                `📊 *LTV:* 60%\n` +
                `⚖️ *Weight:* ${proposal.weightKg}kg maize\n\n` +
                `Reply */accept ${tokenId}* to confirm.`, { parse_mode: "Markdown" });
        }
        catch (err) {
            await bot.sendMessage(chatId, `❌ ${err?.message ?? "Could not evaluate oCR"}`);
            logger_1.logger.error("Telegram /loan error", { tokenId: tokenId.toString(), err });
        }
    });
    bot.onText(/\/accept (\d+)/, async (msg, match) => {
        const chatId = String(msg.chat.id);
        const tokenId = BigInt(match[1]);
        await bot.sendMessage(chatId, `⏳ Processing loan for oCR #${tokenId}...`);
        try {
            const farmerAddress = process.env.ADMIN_ADDRESS ?? "";
            const loanId = await loanAgent.executeLoan(tokenId, farmerAddress);
            await bot.sendMessage(chatId, `✅ *Loan Issued!*\n\n` +
                `Loan ID: *#${loanId}*\n` +
                `USDC-H has been sent to your wallet.\n\n` +
                `Your oCR #${tokenId} is locked as collateral.\n` +
                `Repay anytime with */repay ${loanId}*.`, { parse_mode: "Markdown" });
        }
        catch (err) {
            await bot.sendMessage(chatId, `❌ ${err?.message ?? "Loan execution failed"}`);
            logger_1.logger.error("Telegram /accept error", { tokenId: tokenId.toString(), err });
        }
    });
    bot.onText(/\/status (\d+)/, async (msg, match) => {
        const chatId = String(msg.chat.id);
        const tokenId = BigInt(match[1]);
        try {
            const vault = (0, contracts_1.getCollateralVault)();
            const loanId = await vault.tokenToLoan(tokenId);
            if (loanId === 0n) {
                await bot.sendMessage(chatId, `ℹ️ oCR #${tokenId} has no active loan.`);
                return;
            }
            const loan = await vault.getLoan(loanId);
            const ltvBps = Number(await vault.getCurrentLtv(loanId));
            const owed = await vault.getTotalOwed(loanId);
            const ltvPct = (ltvBps / 100).toFixed(1);
            const owedUsd = (Number(owed) / 1e6).toFixed(2);
            const statusEmoji = ltvBps >= 8000 ? "🔴" : ltvBps >= 7000 ? "🟡" : "🟢";
            const dueDate = new Date(Number(loan.dueAt) * 1000).toLocaleDateString("en-KE");
            await bot.sendMessage(chatId, `${statusEmoji} *Loan Status — oCR #${tokenId}*\n\n` +
                `Loan ID: *#${loanId}*\n` +
                `LTV: *${ltvPct}%* ${ltvBps >= 8000 ? "(⚠️ at risk)" : ""}\n` +
                `Total Owed: *$${owedUsd} USDC-H*\n` +
                `Due: ${dueDate}\n\n` +
                (ltvBps >= 7000
                    ? "⚠️ _LTV is high. Consider repaying to avoid liquidation._"
                    : "✅ _Your loan is healthy._"), { parse_mode: "Markdown" });
        }
        catch (err) {
            await bot.sendMessage(chatId, "❌ Could not fetch loan status.");
            logger_1.logger.error("Telegram /status error", { err });
        }
    });
    bot.onText(/\/help/, async (msg) => {
        const chatId = String(msg.chat.id);
        await bot.sendMessage(chatId, `*ShambaChain Commands*\n\n` +
            `/price — current maize KES price\n` +
            `/loan <tokenId> — loan offer for your oCR\n` +
            `/accept <tokenId> — accept a loan\n` +
            `/status <tokenId> — loan health check\n` +
            `/help — this menu\n\n` +
            `_Powered by Hedera + Supra Oracle_`, { parse_mode: "Markdown" });
    });
    bot.on("polling_error", (err) => {
        logger_1.logger.error("Telegram polling error", { err });
    });
}
//# sourceMappingURL=bot.js.map