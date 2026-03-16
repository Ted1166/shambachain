import { Client, PrivateKey, AccountId } from "@hashgraph/sdk";
import * as dotenv from "dotenv";
dotenv.config();

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

export const HEDERA_ACCOUNT_ID  = requireEnv("HEDERA_ACCOUNT_ID");
export const HEDERA_PRIVATE_KEY = requireEnv("HEDERA_PRIVATE_KEY");
export const HEDERA_NETWORK     = (process.env.HEDERA_NETWORK ?? "testnet") as "testnet" | "mainnet";
export const HEDERA_TESTNET_RPC = process.env.HEDERA_TESTNET_RPC ?? "https://testnet.hashio.io/api";
export const HEDERA_MAINNET_RPC = process.env.HEDERA_MAINNET_RPC ?? "https://mainnet.hashio.io/api";

export const MIRROR_NODE_URL =
  HEDERA_NETWORK === "mainnet"
    ? "https://mainnet-public.mirrornode.hedera.com"
    : "https://testnet.mirrornode.hedera.com";

export function buildHederaClient(): Client {
  const accountId  = AccountId.fromString(HEDERA_ACCOUNT_ID);
  const privateKey = PrivateKey.fromStringECDSA(HEDERA_PRIVATE_KEY);

  const client =
    HEDERA_NETWORK === "mainnet"
      ? Client.forMainnet()
      : Client.forTestnet();

  client.setOperator(accountId, privateKey);

  client.setRequestTimeout(30_000);

  return client;
}

export const hederaClient = buildHederaClient();

export const EVM_RPC_URL =
  HEDERA_NETWORK === "mainnet" ? HEDERA_MAINNET_RPC : HEDERA_TESTNET_RPC;