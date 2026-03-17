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
exports.LoanAgent = void 0;
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const contracts_1 = require("../config/contracts");
const contracts_2 = require("../config/contracts");
const bot_1 = require("../telegram/bot");
const logger_1 = require("../utils/logger");
const dotenv = __importStar(require("dotenv"));
dotenv.config();
const anthropic = new sdk_1.default({ apiKey: process.env.ANTHROPIC_API_KEY });
const DEFAULT_LTV_BPS = 6_000;
class LoanAgent {
    agentAddress;
    constructor() {
        this.agentAddress = contracts_2.signer.address;
    }
    async proposeLoan(tokenId, farmerTelegramChatId) {
        const factory = (0, contracts_1.getReceiptFactory)(true);
        const vault = (0, contracts_1.getCollateralVault)();
        const feed = (0, contracts_1.getSupraPriceFeed)();
        const isActive = await factory.isActive(tokenId);
        if (!isActive) {
            throw new Error(`oCR #${tokenId} is not active`);
        }
        const valuationKesRaw = await factory.getValuation(tokenId);
        const farmerAddr = await factory.ownerOf(tokenId);
        const receipt = {
            farmer: farmerAddr,
            weightKg: BigInt(40),
            commodityType: "MAIZE",
            warehouseId: "WH-NKR-001",
            valuationKes: valuationKesRaw,
        };
        // Fetch oracle price
        const [currentPriceKes] = await feed.getMaizePriceKes();
        const isStale = await feed.isStale();
        if (isStale) {
            logger_1.logger.warn("Oracle price is stale — proceeding with last known price");
        }
        // Calculate loan
        const maxLoanUsdcH = await vault.getMaxLoan(tokenId);
        const proposal = {
            tokenId,
            farmer: receipt.farmer,
            weightKg: Number(receipt.weightKg),
            valuationKes: BigInt(receipt.valuationKes.toString()),
            maxLoanUsdcH: BigInt(maxLoanUsdcH.toString()),
            ltvBps: DEFAULT_LTV_BPS,
            explanation: "",
        };
        // Claude explanation
        proposal.explanation = await this.generateLoanExplanation(proposal, currentPriceKes);
        logger_1.logger.info("LoanAgent: loan proposal generated", {
            tokenId: tokenId.toString(),
            farmer: receipt.farmer,
            weightKg: proposal.weightKg,
            maxLoanUsdcH: formatUsdc(proposal.maxLoanUsdcH),
        });
        if (farmerTelegramChatId) {
            const msg = `🌽 *Loan Offer — oCR #${tokenId}*\n\n` +
                `${proposal.explanation}\n\n` +
                `💰 *Max Loan:* $${formatUsdc(proposal.maxLoanUsdcH)} USDC-H\n` +
                `📊 *LTV:* 60%\n` +
                `📦 *Commodity:* ${proposal.weightKg}kg ${receipt.commodityType}\n` +
                `🏭 *Warehouse:* ${receipt.warehouseId}\n\n` +
                `Reply */accept ${tokenId}* to accept this loan offer.`;
            await (0, bot_1.sendTelegramMessage)(msg, farmerTelegramChatId);
        }
        return proposal;
    }
    async executeLoan(tokenId, farmerAddress) {
        const vault = (0, contracts_1.getCollateralVault)();
        logger_1.logger.info("LoanAgent: executing loan", {
            tokenId: tokenId.toString(),
            farmerAddress,
        });
        const lockTx = await vault.lockCollateral(tokenId, { gasLimit: 300_000 });
        const lockReceipt = await lockTx.wait();
        let loanId = 0n;
        const iface = vault.interface;
        for (const log of lockReceipt?.logs ?? []) {
            try {
                const parsed = iface.parseLog({ topics: log.topics, data: log.data });
                if (parsed?.name === "CollateralLocked") {
                    loanId = parsed.args.loanId;
                    break;
                }
            }
            catch { /* not our event */ }
        }
        const issueTx = await vault.issueLoan(loanId, DEFAULT_LTV_BPS, { gasLimit: 300_000 });
        await issueTx.wait();
        try {
            const shamba = (0, contracts_1.getShambaToken)();
            await (await shamba.rewardLoanIssuance(this.agentAddress, { gasLimit: 300_000 })).wait();
        }
        catch { /* non-critical */ }
        logger_1.logger.info("LoanAgent: loan issued", { loanId: loanId.toString(), tokenId: tokenId.toString() });
        return loanId;
    }
    async generateLoanExplanation(proposal, currentPriceKes) {
        try {
            const kesPerKg = Number(currentPriceKes) / 1e18;
            const totalKes = kesPerKg * proposal.weightKg;
            const loanUsd = Number(proposal.maxLoanUsdcH) / 1e6;
            const res = await anthropic.messages.create({
                model: "claude-sonnet-4-20250514",
                max_tokens: 150,
                messages: [{
                        role: "user",
                        content: `You are a friendly agricultural loan agent in Kenya. In 2-3 short sentences, explain to a farmer in simple English that:\n` +
                            `- Their ${proposal.weightKg}kg of maize stored in the warehouse is worth KES ${totalKes.toFixed(0)}\n` +
                            `- They can borrow up to $${loanUsd.toFixed(2)} USDC (60% of value) against it\n` +
                            `- They keep ownership of their grain while borrowing\n` +
                            `Be warm, encouraging, and clear. No jargon.`,
                    }],
            });
            return res.content[0].text.trim();
        }
        catch {
            const loanUsd = (Number(proposal.maxLoanUsdcH) / 1e6).toFixed(2);
            return `Your ${proposal.weightKg}kg of stored maize qualifies you for a loan of up to $${loanUsd} USDC-H at 60% LTV.`;
        }
    }
}
exports.LoanAgent = LoanAgent;
function formatUsdc(amount) {
    return (Number(amount) / 1e6).toFixed(2);
}
//# sourceMappingURL=LoanAgent.js.map