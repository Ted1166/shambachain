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
exports.getTopicMessages = getTopicMessages;
exports.getMessageBySequence = getMessageBySequence;
exports.getDepositEvents = getDepositEvents;
exports.verifyMpesaRefOnHcs = verifyMpesaRefOnHcs;
const axios_1 = __importDefault(require("axios"));
const hedera_1 = require("../config/hedera");
const logger_1 = require("../utils/logger");
const dotenv = __importStar(require("dotenv"));
dotenv.config();
const HCS_TOPIC_ID = process.env.HCS_DEPOSIT_TOPIC_ID ?? "";
/**
 * Fetch HCS messages from the Hedera Mirror Node REST API.
 * Used by the backend to verify deposit events and by the dashboard.
 *
 * Mirror node endpoint:
 *   GET /api/v1/topics/{topicId}/messages?limit=25&order=desc
 */
async function getTopicMessages(topicId = HCS_TOPIC_ID, limit = 25, order = "desc") {
    const url = `${hedera_1.MIRROR_NODE_URL}/api/v1/topics/${topicId}/messages`;
    const res = await axios_1.default.get(url, {
        params: { limit, order },
    });
    const raw = res.data.messages ?? [];
    return raw.map((m) => ({
        sequenceNumber: m.sequence_number,
        consensusTimestamp: m.consensus_timestamp,
        contents: decodeBase64(m.message),
        runningHash: m.running_hash,
    }));
}
/**
 * Fetch a single HCS message by sequence number.
 */
async function getMessageBySequence(sequenceNumber, topicId = HCS_TOPIC_ID) {
    try {
        const url = `${hedera_1.MIRROR_NODE_URL}/api/v1/topics/${topicId}/messages/${sequenceNumber}`;
        const res = await axios_1.default.get(url);
        const m = res.data;
        return {
            sequenceNumber: m.sequence_number,
            consensusTimestamp: m.consensus_timestamp,
            contents: decodeBase64(m.message),
            runningHash: m.running_hash,
        };
    }
    catch (err) {
        logger_1.logger.warn(`HCS message #${sequenceNumber} not found`, { topicId });
        return null;
    }
}
/**
 * Fetch and parse all DEPOSIT events from the HCS topic.
 */
async function getDepositEvents(limit = 50) {
    const messages = await getTopicMessages(HCS_TOPIC_ID, limit, "desc");
    const events = [];
    for (const msg of messages) {
        try {
            const event = JSON.parse(msg.contents);
            if (event.type === "DEPOSIT") {
                events.push(event);
            }
        }
        catch {
            // skip malformed messages
        }
    }
    return events;
}
/**
 * Verify that a given MPESA ref exists in the HCS audit trail.
 * Called by the minter before calling mintReceipt() as an extra guard.
 */
async function verifyMpesaRefOnHcs(mpesaRef) {
    const events = await getDepositEvents(100);
    return events.some((e) => e.mpesaRef === mpesaRef);
}
// ── Helpers ──────────────────────────────────────────────────────────────────
function decodeBase64(b64) {
    try {
        return Buffer.from(b64, "base64").toString("utf-8");
    }
    catch {
        return b64;
    }
}
//# sourceMappingURL=reader.js.map