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
exports.pendingStkPushes = void 0;
exports.initiateStkPush = initiateStkPush;
const axios_1 = __importDefault(require("axios"));
const logger_1 = require("../utils/logger");
const dotenv = __importStar(require("dotenv"));
dotenv.config();
const CONSUMER_KEY = process.env.MPESA_CONSUMER_KEY ?? "";
const CONSUMER_SECRET = process.env.MPESA_CONSUMER_SECRET ?? "";
const SHORTCODE = process.env.MPESA_SHORTCODE ?? "";
const PASSKEY = process.env.MPESA_PASSKEY ?? "";
const CALLBACK_URL = process.env.MPESA_CALLBACK_URL ?? "";
const BASE_URL = "https://sandbox.safaricom.co.ke"; // swap to production URL on go-live
// In-memory store of pending STK pushes (use Redis in production)
exports.pendingStkPushes = new Map();
// ── OAuth token ──────────────────────────────────────────────────────────────
async function getAccessToken() {
    const credentials = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString("base64");
    const res = await axios_1.default.get(`${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`, {
        headers: { Authorization: `Basic ${credentials}` },
    });
    return res.data.access_token;
}
// ── STK Push ─────────────────────────────────────────────────────────────────
/**
 * Initiate an MPESA STK Push to collect the farmer's warehouse deposit fee.
 * Returns the CheckoutRequestID to track the transaction.
 *
 * Flow:
 *   1. Farmer approaches warehouse → operator enters phone + kg + commodity
 *   2. This function is called → farmer receives a prompt on their phone
 *   3. Farmer enters PIN → MPESA fires callback to /api/mpesa/callback
 *   4. webhook.ts parses callback → triggers HCS write + NFT mint
 */
async function initiateStkPush(req) {
    const token = await getAccessToken();
    const timestamp = getTimestamp();
    const password = Buffer.from(`${SHORTCODE}${PASSKEY}${timestamp}`).toString("base64");
    const payload = {
        BusinessShortCode: SHORTCODE,
        Password: password,
        Timestamp: timestamp,
        TransactionType: "CustomerPayBillOnline",
        Amount: req.amount,
        PartyA: req.phoneNumber,
        PartyB: SHORTCODE,
        PhoneNumber: req.phoneNumber,
        CallBackURL: CALLBACK_URL,
        AccountReference: req.accountRef,
        TransactionDesc: req.description,
    };
    const res = await axios_1.default.post(`${BASE_URL}/mpesa/stkpush/v1/processrequest`, payload, {
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        },
    });
    const data = res.data;
    if (data.ResponseCode !== "0") {
        throw new Error(`STK Push failed: ${data.ResponseDescription}`);
    }
    // Store pending push
    exports.pendingStkPushes.set(data.CheckoutRequestID, {
        checkoutRequestId: data.CheckoutRequestID,
        merchantRequestId: data.MerchantRequestID,
        phoneNumber: req.phoneNumber,
        amount: req.amount,
        accountRef: req.accountRef,
        initiatedAt: new Date(),
        status: "pending",
    });
    logger_1.logger.info(`STK Push initiated`, {
        checkoutRequestId: data.CheckoutRequestID,
        phone: req.phoneNumber,
        amount: req.amount,
        warehouse: req.accountRef,
    });
    return data;
}
// ── Helpers ──────────────────────────────────────────────────────────────────
function getTimestamp() {
    const now = new Date();
    const pad = (n) => n.toString().padStart(2, "0");
    return (now.getFullYear().toString() +
        pad(now.getMonth() + 1) +
        pad(now.getDate()) +
        pad(now.getHours()) +
        pad(now.getMinutes()) +
        pad(now.getSeconds()));
}
//# sourceMappingURL=stk-push.js.map