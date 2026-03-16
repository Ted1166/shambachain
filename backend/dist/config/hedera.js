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
exports.EVM_RPC_URL = exports.hederaClient = exports.MIRROR_NODE_URL = exports.HEDERA_MAINNET_RPC = exports.HEDERA_TESTNET_RPC = exports.HEDERA_NETWORK = exports.HEDERA_PRIVATE_KEY = exports.HEDERA_ACCOUNT_ID = void 0;
exports.buildHederaClient = buildHederaClient;
const sdk_1 = require("@hashgraph/sdk");
const dotenv = __importStar(require("dotenv"));
dotenv.config();
// ── Validate required env ────────────────────────────────────────────────────
function requireEnv(key) {
    const val = process.env[key];
    if (!val)
        throw new Error(`Missing required env var: ${key}`);
    return val;
}
exports.HEDERA_ACCOUNT_ID = requireEnv("HEDERA_ACCOUNT_ID");
exports.HEDERA_PRIVATE_KEY = requireEnv("HEDERA_PRIVATE_KEY");
exports.HEDERA_NETWORK = (process.env.HEDERA_NETWORK ?? "testnet");
exports.HEDERA_TESTNET_RPC = process.env.HEDERA_TESTNET_RPC ?? "https://testnet.hashio.io/api";
exports.HEDERA_MAINNET_RPC = process.env.HEDERA_MAINNET_RPC ?? "https://mainnet.hashio.io/api";
// ── Mirror node base URLs ────────────────────────────────────────────────────
exports.MIRROR_NODE_URL = exports.HEDERA_NETWORK === "mainnet"
    ? "https://mainnet-public.mirrornode.hedera.com"
    : "https://testnet.mirrornode.hedera.com";
// ── Build Hedera SDK client ──────────────────────────────────────────────────
function buildHederaClient() {
    const accountId = sdk_1.AccountId.fromString(exports.HEDERA_ACCOUNT_ID);
    const privateKey = sdk_1.PrivateKey.fromStringECDSA(exports.HEDERA_PRIVATE_KEY);
    const client = exports.HEDERA_NETWORK === "mainnet"
        ? sdk_1.Client.forMainnet()
        : sdk_1.Client.forTestnet();
    client.setOperator(accountId, privateKey);
    // Increase timeout for slower RPC
    client.setRequestTimeout(30_000);
    return client;
}
// Singleton client for reuse across modules
exports.hederaClient = buildHederaClient();
// ── EVM JSON-RPC URL (for ethers.js contract calls) ──────────────────────────
exports.EVM_RPC_URL = exports.HEDERA_NETWORK === "mainnet" ? exports.HEDERA_MAINNET_RPC : exports.HEDERA_TESTNET_RPC;
//# sourceMappingURL=hedera.js.map