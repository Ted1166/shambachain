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
Object.defineProperty(exports, "__esModule", { value: true });
exports.mpesaCallbackHandler = mpesaCallbackHandler;
const stk_push_1 = require("./stk-push");
const writer_1 = require("../hcs/writer");
const receipt_minter_1 = require("../minter/receipt-minter");
const logger_1 = require("../utils/logger");
const dotenv = __importStar(require("dotenv"));
dotenv.config();
const PROTOCOL_CUSTODIAN = process.env.ADMIN_ADDRESS ?? "";
async function mpesaCallbackHandler(req, res) {
    res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });
    const body = req.body;
    try {
        const cb = body.Body.stkCallback;
        logger_1.logger.info("MPESA callback received", {
            checkoutRequestId: cb.CheckoutRequestID,
            resultCode: cb.ResultCode,
        });
        if (cb.ResultCode !== 0) {
            logger_1.logger.warn("STK Push failed", { resultDesc: cb.ResultDesc });
            const pending = stk_push_1.pendingStkPushes.get(cb.CheckoutRequestID);
            if (pending)
                pending.status = "failed";
            return;
        }
        const items = cb.CallbackMetadata?.Item ?? [];
        const get = (name) => items.find((i) => i.Name === name)?.Value;
        const mpesaReceiptNumber = String(get("MpesaReceiptNumber") ?? "");
        const amount = Number(get("Amount") ?? 0);
        const phoneNumber = String(get("PhoneNumber") ?? "");
        const transactionDate = String(get("TransactionDate") ?? "");
        if (!mpesaReceiptNumber) {
            logger_1.logger.error("MPESA callback missing receipt number", { cb });
            return;
        }
        const pending = stk_push_1.pendingStkPushes.get(cb.CheckoutRequestID);
        if (!pending) {
            logger_1.logger.warn("No pending STK push found", { id: cb.CheckoutRequestID });
            return;
        }
        pending.status = "confirmed";
        logger_1.logger.info("MPESA payment confirmed", {
            receipt: mpesaReceiptNumber,
            amount,
            phone: phoneNumber,
            warehouse: pending.accountRef,
        });
        const hcsResult = await (0, writer_1.writeDepositEvent)({
            mpesaRef: mpesaReceiptNumber,
            phoneNumber,
            amount,
            warehouseId: pending.accountRef,
            timestamp: transactionDate,
        });
        logger_1.logger.info("HCS deposit event written", {
            topicId: hcsResult.topicId,
            sequenceNumber: hcsResult.sequenceNumber,
        });
        const estimatedWeightKg = Math.max(1, Math.floor(amount / 2.5));
        const initialValuationKes = (0, receipt_minter_1.estimateValuationKes)(estimatedWeightKg, 45);
        const tokenId = await (0, receipt_minter_1.mintReceipt)({
            custodian: PROTOCOL_CUSTODIAN,
            farmer: PROTOCOL_CUSTODIAN,
            commodityType: "MAIZE",
            weightKg: estimatedWeightKg,
            grade: 0,
            warehouseId: pending.accountRef,
            mpesaRef: mpesaReceiptNumber,
            hcsSequenceNumber: BigInt(hcsResult.sequenceNumber),
            initialValuationKes,
            metadataURI: `ipfs://QmShamba_${mpesaReceiptNumber}`,
        });
        logger_1.logger.info("oCR NFT minted", {
            tokenId: tokenId.toString(),
            mpesaRef: mpesaReceiptNumber,
            weightKg: estimatedWeightKg,
            hcsSequence: hcsResult.sequenceNumber,
        });
        const { LoanAgent } = await Promise.resolve().then(() => __importStar(require("../agents/LoanAgent")));
        const loanAgent = new LoanAgent();
        await loanAgent.proposeLoan(tokenId).catch(err => logger_1.logger.warn("LoanAgent proposal failed", { err }));
    }
    catch (err) {
        logger_1.logger.error("Error processing MPESA callback", { err });
    }
}
//# sourceMappingURL=webhook.js.map