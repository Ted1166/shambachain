import express from "express";
import cors from "cors";

// ── Transaction queue (prevents nonce conflicts on Hedera) ──────────────────
let txQueue = Promise.resolve();
async function queueTx<T>(fn: () => Promise<T>): Promise<T> {
  await txQueue;
  const result = fn();
  txQueue = result.then(() => {}, () => {});
  return result;
}
import * as dotenv from "dotenv";
dotenv.config();

import { mpesaCallbackHandler } from "./mpesa/webhook";
import { initTelegramBot } from "./telegram/bot";
import { PriceAgent } from "./agents/PriceAgent";
import { RiskAgent } from "./agents/RiskAgent";
import { logger } from "./utils/logger";
import { LoanAgent } from "./agents/LoanAgent";

const PORT = Number(process.env.PORT ?? 3000);

async function main() {
  logger.info("ShambaChain Backend starting...");

  const app = express();
  app.use(express.json());
  app.use(cors({ origin: "*" }));

  // ── Vault auto-issue loan (called after user locks collateral) ───────────
  app.post("/api/vault/issue-loan", async (req, res) => {
    try {
      const { tokenId, ltvBps = 6000 } = req.body;
      const { getCollateralVault, CONTRACT_ADDRESSES } = await import("./config/contracts");
      const { ethers } = await import("ethers");

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

      logger.info("Vault: loan issued by agent", { tokenId, loanId: loanId.toString(), txHash: tx.hash });
      res.json({ success: true, loanId: loanId.toString(), txHash: tx.hash });
    } catch (err: any) {
      logger.error("Vault: issue loan failed", { err });
      res.status(500).json({ error: err?.shortMessage ?? err?.message ?? "Failed" });
    }
  });

  // ── Markets: create risk market (backend calls) ──────────────────────────
  app.post("/api/market/create", async (req, res) => {
    try {
      const { tokenId, loanId, durationDays = 7 } = req.body;
      const { getRiskMarket } = await import("./config/contracts");
      const market = getRiskMarket();
      const durationSecs = BigInt(durationDays * 86400);
      const tx = await market.createMarket(BigInt(tokenId), BigInt(loanId), durationSecs, { gasLimit: 400_000 });
      const receipt = await tx.wait();
      logger.info("Market: created", { tokenId, loanId, txHash: tx.hash });
      res.json({ success: true, txHash: tx.hash });
    } catch (err: any) {
      logger.error("Market: create failed", { err });
      res.status(500).json({ error: err?.shortMessage ?? err?.message ?? "Failed" });
    }
  });

  // ── Vault: lock collateral + issue loan (backend does both) ─────────────
  app.post("/api/vault/lock-and-borrow", async (req, res) => {
    try {
      const { tokenId, ltvBps = 6000 } = req.body;
      const { getCollateralVault } = await import("./config/contracts");
      const vault = getCollateralVault();

      // Get loanId (user already locked via MetaMask)
      const loanId = await vault.tokenToLoan(BigInt(tokenId));
      if (!loanId || loanId === 0n) throw new Error("Token not locked yet — user must lock first");

      // Issue loan
      const issueTx = await queueTx(() => vault.issueLoan(loanId, ltvBps, { gasLimit: 400_000 }));
      await issueTx.wait();

      logger.info("Vault: lock+borrow complete", { tokenId, loanId: loanId.toString() });
      res.json({ success: true, loanId: loanId.toString(), txHash: issueTx.hash });
    } catch (err: any) {
      logger.error("Vault: lock+borrow failed", { err });
      res.status(500).json({ error: err?.shortMessage ?? err?.message ?? "Failed" });
    }
  });

  // ── Markets: take position (backend calls after user approves USDC-H) ────
  app.post("/api/market/take-position", async (req, res) => {
    try {
      const { marketId, isYes, amount } = req.body;
      const { getRiskMarket } = await import("./config/contracts");
      // USDC-H pre-approved via cast send — just call takePosition directly
      const amountBn = BigInt(Math.ceil(amount * 1e6));
      const market = getRiskMarket();
      const tx = await queueTx(() => market.takePosition(marketId, isYes, amountBn, { gasLimit: 400_000 }));
      await tx.wait();
      logger.info("Market: position taken", { marketId, isYes, txHash: tx.hash });
      res.json({ success: true, txHash: tx.hash });
    } catch (err: any) {
      logger.error("Market: take position failed", { err });
      res.status(500).json({ error: err?.shortMessage ?? err?.message ?? "Failed" });
    }
  });

  // ── Mirror node proxy (avoids CORS in browser) ─────────────────────────
  app.get("/api/mirror/receipt-tokens", async (req, res) => {
    const axios = (await import("axios")).default;
    const addr = "0x451f2f54a027f9ec359f1411f341878d645dd337";
    const topic0 = "0x90e6f23b6f72b87ceea2b71263a788fdd9a39a2f51983274ae78d6ac65f3794c";
    const r = await axios.get(`https://testnet.mirrornode.hedera.com/api/v1/contracts/${addr}/results/logs?limit=100&order=asc`);
    const ids = (r.data?.logs ?? [])
      .filter((l: any) => l.topics?.[0] === topic0 && l.topics?.[1])
      .map((l: any) => parseInt(l.topics[1], 16))
      .filter((id: number) => id > 0 && id <= 10_000);
    res.json({ tokenIds: [...new Set(ids)] });
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "shambachain-backend", ts: new Date().toISOString() });
  });

  app.post("/api/mpesa/callback", mpesaCallbackHandler);

  app.post("/api/mpesa/stk-push", async (req, res) => {
    const { initiateStkPush } = await import("./mpesa/stk-push");
    try {
      const result = await initiateStkPush(req.body);
      res.json(result);
    } catch (err: any) {
      logger.error("STK Push error", { err });
      res.status(500).json({ error: err?.message ?? "STK Push failed" });
    }
  });

  app.listen(PORT, () => {
    logger.info(`HTTP server listening on port ${PORT}`);
  });

  const _tgToken = process.env.TELEGRAM_BOT_TOKEN ?? "";
  if (_tgToken && _tgToken.length > 10 && !_tgToken.startsWith("your")) {
    try {
      initTelegramBot();
      logger.info("Telegram bot initialised");
    } catch (err) {
      logger.warn("Telegram bot failed to start", { err });
    }
  } else {
    logger.info("Telegram bot skipped (token not configured)");
  }

  const priceAgent = new PriceAgent();
  const riskAgent  = new RiskAgent();

  priceAgent.start();
  riskAgent.start();

  logger.info("ShambaChain Backend fully started", {
    port:       PORT,
    network:    process.env.HEDERA_NETWORK ?? "testnet",
    contracts: {
      receiptFactory:  process.env.RECEIPT_FACTORY_ADDRESS ?? "(not set)",
      collateralVault: process.env.COLLATERAL_VAULT_ADDRESS ?? "(not set)",
      riskOracle:      process.env.RISK_ORACLE_ADDRESS ?? "(not set)",
    },
  });
}

main().catch((err) => {
  logger.error("Fatal startup error", { err });
  process.exit(1);
});