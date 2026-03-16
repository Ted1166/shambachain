import Anthropic from "@anthropic-ai/sdk";
import cron from "node-cron";
import { getSupraPriceFeed, getRiskOracle, getShambaToken, CONTRACT_ADDRESSES } from "../config/contracts";
import { signer } from "../config/contracts";
import { writeHcsEvent } from "../hcs/writer";
import { sendTelegramMessage } from "../telegram/bot";
import { logger } from "../utils/logger";
import * as dotenv from "dotenv";
dotenv.config();

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

let lastPriceKes = 0n;
let lastAlertSentAt = 0;
const ALERT_COOLDOWN_MS = 30 * 60 * 1000;


export class PriceAgent {
  private agentAddress: string;
  private running = false;

  constructor() {
    this.agentAddress = signer.address;
  }

  start() {
    if (this.running) return;
    this.running = true;
    logger.info("PriceAgent started", { wallet: this.agentAddress });

    cron.schedule("*/5 * * * *", () => this.tick());

    this.tick();
  }

  async tick() {
    try {
      await this.checkPrice();
    } catch (err) {
      logger.error("PriceAgent tick error", { err });
    }
  }

  async checkPrice() {
    const feed = getSupraPriceFeed();

    const [price, timestamp] = await feed.getMaizePriceKes();
    const isStale = await feed.isStale();

    const currentPrice = BigInt(price.toString());
    const tsNum = Number(timestamp);

    logger.info("PriceAgent: price fetched", {
      priceKes:  formatKes(currentPrice),
      timestamp: new Date(tsNum * 1000).toISOString(),
      stale:     isStale,
    });

    if (isStale) {
      logger.warn("PriceAgent: oracle price is stale — skipping update");
      return;
    }

    const priceMoved = lastPriceKes > 0n && priceChangePct(lastPriceKes, currentPrice) >= 5;

    if (priceMoved || lastPriceKes === 0n) {
      const direction = currentPrice > lastPriceKes ? "↑" : "↓";
      const changePct = lastPriceKes > 0n
        ? priceChangePct(lastPriceKes, currentPrice).toFixed(1)
        : "0.0";

      logger.info(`PriceAgent: significant move ${direction} ${changePct}%`, {
        old: formatKes(lastPriceKes),
        new: formatKes(currentPrice),
      });

      await writeHcsEvent({
        type:      "VALUATION_UPDATE",
        version:   "1.0",
        timestamp: new Date().toISOString(),
        network:   (process.env.HEDERA_NETWORK ?? "testnet") as "testnet" | "mainnet",
      });

      const commentary = await this.generateCommentary(currentPrice, lastPriceKes);

      const now = Date.now();
      if (now - lastAlertSentAt > ALERT_COOLDOWN_MS && currentPrice < lastPriceKes) {
        const alertMsg =
          `🌽 *ShambaChain Price Alert*\n\n` +
          `Maize: *KES ${formatKes(currentPrice)}/kg* ${direction} ${changePct}%\n\n` +
          `${commentary}\n\n` +
          `_Consider buying a hedge to protect your oCR collateral._`;

        await sendTelegramMessage(alertMsg);
        lastAlertSentAt = now;
      }

      try {
        const shamba = getShambaToken();
        await (await shamba.rewardPriceUpdate(this.agentAddress, { gasLimit: 300_000 })).wait();
        logger.info("PriceAgent: SHAMBA reward claimed");
      } catch (rewardErr) {
        logger.warn("PriceAgent: SHAMBA reward failed (may be out of supply)", { rewardErr });
      }
    }

    lastPriceKes = currentPrice;
  }


  private async generateCommentary(current: bigint, previous: bigint): Promise<string> {
    try {
      const pct = previous > 0n ? priceChangePct(previous, current).toFixed(1) : "0";
      const dir = current > previous ? "risen" : "fallen";

      const msg = await anthropic.messages.create({
        model:      "claude-sonnet-4-20250514",
        max_tokens: 100,
        messages: [{
          role:    "user",
          content: `In one sentence (max 25 words), explain to a Kenyan maize farmer what a ${pct}% ${dir} in maize price to KES ${formatKes(current)}/kg means for their stored grain value. Be encouraging.`,
        }],
      });

      return (msg.content[0] as { text: string }).text.trim();
    } catch {
      return `Maize price has moved to KES ${formatKes(current)}/kg.`;
    }
  }
}


function formatKes(wei: bigint): string {
  return (Number(wei) / 1e18).toFixed(2);
}

function priceChangePct(oldPrice: bigint, newPrice: bigint): number {
  if (oldPrice === 0n) return 0;
  const diff = newPrice > oldPrice ? newPrice - oldPrice : oldPrice - newPrice;
  return Number((diff * 10000n) / oldPrice) / 100;
}