import express from "express";
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