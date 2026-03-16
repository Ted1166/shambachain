import Anthropic from "@anthropic-ai/sdk";
import cron from "node-cron";
import { ethers } from "ethers";
import {
  getCollateralVault,
  getReceiptFactory,
  getRiskOracle,
  getRiskMarket,
  getShambaToken,
  COLLATERAL_VAULT_ABI,
  CONTRACT_ADDRESSES,
  provider,
} from "../config/contracts";
import { signer } from "../config/contracts";
import { writeHcsEvent } from "../hcs/writer";
import { sendTelegramMessage } from "../telegram/bot";
import { logger } from "../utils/logger";
import * as dotenv from "dotenv";
dotenv.config();

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const WARNING_LTV_BPS     = 7_000;
const LIQUIDATION_LTV_BPS = 8_000;


export class RiskAgent {
  private agentAddress: string;
  private monitoredTokenIds: number[] = [];
  private running = false;

  private alertedLoans = new Set<string>();

  constructor() {
    this.agentAddress = signer.address;
  }

  start() {
    if (this.running) return;
    this.running = true;
    logger.info("RiskAgent started", { wallet: this.agentAddress });

    cron.schedule("*/10 * * * *", () => this.runRiskScan());

    this.subscribeToLiquidationEvents();

    this.runRiskScan();
  }


  addToMonitor(tokenId: number) {
    if (!this.monitoredTokenIds.includes(tokenId)) {
      this.monitoredTokenIds.push(tokenId);
      logger.info(`RiskAgent: monitoring tokenId ${tokenId}`);
    }
  }


  async runRiskScan() {
    logger.info("RiskAgent: starting risk scan", {
      tokenCount: this.monitoredTokenIds.length,
    });

    if (this.monitoredTokenIds.length === 0) {
      await this.discoverActiveTokens();
    }

    if (this.monitoredTokenIds.length === 0) return;

    try {
      await this.triggerValuationUpdate();

      const vault = getCollateralVault();
      const risks: { tokenId: number; loanId: bigint; ltvBps: number }[] = [];

      for (const tokenId of this.monitoredTokenIds) {
        try {
          const loanId = await vault.tokenToLoan(tokenId);
          if (loanId === 0n) continue;

          const ltvBps = Number(await vault.getCurrentLtv(loanId));
          risks.push({ tokenId, loanId, ltvBps });

          logger.info(`RiskAgent: LTV check`, {
            tokenId,
            loanId: loanId.toString(),
            ltvBps,
            pct:   (ltvBps / 100).toFixed(1) + "%",
          });

          if (ltvBps >= WARNING_LTV_BPS && ltvBps < LIQUIDATION_LTV_BPS) {
            await this.handleWarning(tokenId, loanId, ltvBps);
          }

          if (ltvBps >= LIQUIDATION_LTV_BPS) {
            await this.handleLiquidation(tokenId, loanId, ltvBps);
          }

        } catch (err) {
          logger.warn(`RiskAgent: error checking tokenId ${tokenId}`, { err });
        }
      }

      if (risks.length > 0) {
        try {
          const shamba = getShambaToken();
          await (await shamba.rewardRiskCheck(this.agentAddress, { gasLimit: 300_000 })).wait();
        } catch { /* non-critical */ }
      }

      logger.info("RiskAgent: scan complete", { checked: risks.length });

    } catch (err) {
      logger.error("RiskAgent: scan error", { err });
    }
  }


  private async triggerValuationUpdate() {
    const oracle = getRiskOracle();
    const tokenIds = this.monitoredTokenIds.slice(0, 50);

    try {
      const tx = await oracle.triggerValuationUpdate(
        tokenIds,
        "0x",
        0,
        { gasLimit: 1_000_000 }
      );
      await tx.wait();
      logger.info("RiskAgent: valuation update triggered", { tokenIds });
    } catch (err) {
      logger.warn("RiskAgent: valuation update failed", { err });
    }
  }


  private async handleWarning(tokenId: number, loanId: bigint, ltvBps: number) {
    const alertKey = `warning-${loanId}`;
    if (this.alertedLoans.has(alertKey)) return;

    this.alertedLoans.add(alertKey);

    const pct = (ltvBps / 100).toFixed(1);
    logger.warn(`RiskAgent: LTV warning`, { tokenId, loanId: loanId.toString(), pct });

    const msg =
      `⚠️ *ShambaChain Risk Alert — oCR #${tokenId}*\n\n` +
      `Your loan LTV is at *${pct}%* — approaching the 80% liquidation threshold.\n\n` +
      `*Actions you can take:*\n` +
      `• Repay part of your loan to reduce LTV\n` +
      `• Buy a price hedge to protect against further drops\n\n` +
      `Reply */status ${tokenId}* for details.`;

    await sendTelegramMessage(msg);

    await writeHcsEvent({
      type:     "VALUATION_UPDATE",
      version:  "1.0",
      tokenId:  String(tokenId),
      timestamp: new Date().toISOString(),
      network:  (process.env.HEDERA_NETWORK ?? "testnet") as "testnet" | "mainnet",
    });
  }


  private async handleLiquidation(tokenId: number, loanId: bigint, ltvBps: number) {
    const alertKey = `liquidation-${loanId}`;
    if (this.alertedLoans.has(alertKey)) return;

    this.alertedLoans.add(alertKey);

    const pct = (ltvBps / 100).toFixed(1);
    logger.warn(`RiskAgent: liquidating loan`, {
      tokenId,
      loanId: loanId.toString(),
      ltvBps: pct,
    });

    const vault = getCollateralVault();

    try {
      const tx = await vault.liquidate(loanId, { gasLimit: 500_000 });
      await tx.wait();

      logger.info("RiskAgent: loan liquidated", { loanId: loanId.toString() });

      const rmarket = getRiskMarket();
      const activeMarketId = await rmarket.tokenActiveMarket(tokenId);
      if (activeMarketId > 0n) {
        await (await rmarket.forceResolveOnLiquidation(activeMarketId, { gasLimit: 300_000 })).wait();
        logger.info("RiskAgent: RiskMarket resolved on liquidation", {
          marketId: activeMarketId.toString(),
        });
      }

      const shamba = getShambaToken();
      await (await shamba.rewardLiquidation(this.agentAddress, { gasLimit: 300_000 })).wait();

      await writeHcsEvent({
        type:     "LIQUIDATION",
        version:  "1.0",
        tokenId:  String(tokenId),
        timestamp: new Date().toISOString(),
        network:  (process.env.HEDERA_NETWORK ?? "testnet") as "testnet" | "mainnet",
      });

      const explanation = await this.generateLiquidationExplanation(tokenId, pct);
      await sendTelegramMessage(
        `🔴 *Loan Liquidated — oCR #${tokenId}*\n\n${explanation}`
      );

    } catch (err) {
      logger.error("RiskAgent: liquidation failed", { loanId: loanId.toString(), err });
    }
  }


  private subscribeToLiquidationEvents() {
    logger.info("RiskAgent: liquidation monitoring via poll (Hedera hashio limitation)");
  }

  private async discoverActiveTokens() {
    try {
      const mirrorUrl = process.env.HEDERA_NETWORK === "mainnet"
        ? "https://mainnet-public.mirrornode.hedera.com"
        : "https://testnet.mirrornode.hedera.com";
      const factoryAddr = (process.env.RECEIPT_FACTORY_ADDRESS ?? "").toLowerCase();
      const topic0 = "0x90e6f23b6f72b87ceea2b71263a788fdd9a39a2f51983274ae78d6ac65f3794c";
      const url = `${mirrorUrl}/api/v1/contracts/${factoryAddr}/results/logs?limit=100&order=asc`;
      const { default: axios } = await import("axios");
      const res = await axios.get(url);
      const logs: any[] = res.data?.logs ?? [];
      const tokenIds = new Set<number>();
      for (const log of logs) {
        if (log.topics && log.topics.length >= 2) {
          const tokenId = parseInt(log.topics[1], 16);
          if (tokenId > 0) tokenIds.add(tokenId);
        }
      }
      this.monitoredTokenIds = Array.from(tokenIds).filter(id => id > 0 && id <= 10_000);
      logger.info("RiskAgent: discovered tokens via mirror node logs", { 
        count: this.monitoredTokenIds.length,
        tokenIds: this.monitoredTokenIds 
      });
    } catch (err) {
      logger.warn("RiskAgent: mirror node discovery failed, using on-chain fallback", { err });
      const vault = getCollateralVault();
      const active: number[] = [];
      for (let i = 1; i <= 20; i++) {
        try {
          const loanId = await vault.tokenToLoan(i);
          if (loanId > 0n) active.push(i);
        } catch { /* token doesn't exist */ }
      }
      this.monitoredTokenIds = active;
      logger.info("RiskAgent: fallback discovered active loans", { tokenIds: active });
    }
  }


  private async generateLiquidationExplanation(tokenId: number, ltvPct: string): Promise<string> {
    try {
      const res = await anthropic.messages.create({
        model:      "claude-sonnet-4-20250514",
        max_tokens: 100,
        messages: [{
          role:    "user",
          content: `In 2 sentences, explain to a Kenyan farmer in simple English that their grain receipt #${tokenId} was liquidated because the loan reached ${ltvPct}% LTV due to falling maize prices. Be empathetic and mention they can deposit new grain to start again.`,
        }],
      });
      return (res.content[0] as { text: string }).text.trim();
    } catch {
      return `oCR #${tokenId} was liquidated at ${ltvPct}% LTV. You can deposit new grain to get a new receipt.`;
    }
  }
}