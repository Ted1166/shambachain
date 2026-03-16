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
exports.writeDepositEvent = writeDepositEvent;
exports.writeHcsEvent = writeHcsEvent;
const sdk_1 = require("@hashgraph/sdk");
const hedera_1 = require("../config/hedera");
const logger_1 = require("../utils/logger");
const dotenv = __importStar(require("dotenv"));
dotenv.config();
const HCS_TOPIC_ID = process.env.HCS_DEPOSIT_TOPIC_ID ?? "";
/**
 * Write a MPESA deposit confirmation event to the ShambaChain HCS topic.
 *
 * Each message is a JSON-encoded ShambaHcsEvent. The returned sequence number
 * is stored on-chain in the oCR NFT as an immutable audit trail reference.
 *
 * HCS properties that make this audit-proof:
 *   - Consensus timestamp is set by the Hedera network (not the submitter)
 *   - Sequence numbers are monotonically increasing
 *   - Content is immutable once submitted
 *   - Anyone can verify via mirror node: https://testnet.mirrornode.hedera.com/api/v1/topics/{topicId}/messages
 */
async function writeDepositEvent(payload) {
    if (!HCS_TOPIC_ID) {
        throw new Error("HCS_DEPOSIT_TOPIC_ID not set in environment");
    }
    const event = {
        type: "DEPOSIT",
        version: "1.0",
        mpesaRef: payload.mpesaRef,
        phoneNumber: payload.phoneNumber,
        amount: payload.amount,
        warehouseId: payload.warehouseId,
        timestamp: payload.timestamp,
        network: hedera_1.HEDERA_NETWORK,
    };
    const message = JSON.stringify(event);
    const topicId = sdk_1.TopicId.fromString(HCS_TOPIC_ID);
    const tx = await new sdk_1.TopicMessageSubmitTransaction()
        .setTopicId(topicId)
        .setMessage(message)
        .execute(hedera_1.hederaClient);
    const receipt = await tx.getReceipt(hedera_1.hederaClient);
    // receipt.topicSequenceNumber is a Long — convert to number
    const sequenceNumber = receipt.topicSequenceNumber?.toNumber() ?? 0;
    const result = {
        topicId: HCS_TOPIC_ID,
        sequenceNumber,
        transactionId: tx.transactionId?.toString() ?? "",
        consensusTimestamp: new Date().toISOString(),
    };
    logger_1.logger.info("HCS deposit event written", {
        topicId: HCS_TOPIC_ID,
        sequenceNumber,
        mpesaRef: payload.mpesaRef,
        transactionId: result.transactionId,
    });
    return result;
}
/**
 * Write a generic ShambaChain event to HCS.
 * Used by RiskAgent to log valuation updates, liquidations, etc.
 */
async function writeHcsEvent(event) {
    if (!HCS_TOPIC_ID) {
        throw new Error("HCS_DEPOSIT_TOPIC_ID not set in environment");
    }
    const message = JSON.stringify(event);
    const topicId = sdk_1.TopicId.fromString(HCS_TOPIC_ID);
    const tx = await new sdk_1.TopicMessageSubmitTransaction()
        .setTopicId(topicId)
        .setMessage(message)
        .execute(hedera_1.hederaClient);
    const receipt = await tx.getReceipt(hedera_1.hederaClient);
    const sequenceNumber = receipt.topicSequenceNumber?.toNumber() ?? 0;
    return {
        topicId: HCS_TOPIC_ID,
        sequenceNumber,
        transactionId: tx.transactionId?.toString() ?? "",
        consensusTimestamp: new Date().toISOString(),
    };
}
//# sourceMappingURL=writer.js.map