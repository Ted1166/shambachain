import Anthropic from "@anthropic-ai/sdk";
import { getCollateralVault, getReceiptFactory, getSupraPriceFeed, getShambaToken } from "../config/contracts";
import { signer } from "../config/contracts";
import { sendTelegramMessage } from "../telegram/bot";
import { logger } from "../utils/logger";
import * as dotenv from "dotenv";
dotenv.config();

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const DEFAULT_LTV_BPS = 6_000; 

export interface LoanProposal {
  tokenId:       bigint;
  farmer:        string;
  weightKg:      number;
  valuationKes:  bigint;
  maxLoanUsdcH:  bigint;
  ltvBps:        number;
  explanation:   string;
}


export class LoanAgent {
  private agentAddress: string;

  constructor() {
    this.agentAddress = signer.address;
  }

  async proposeLoan(tokenId: bigint, farmerTelegramChatId?: string): Promise<LoanProposal> {
    const factory = getReceiptFactory(true);
    const vault   = getCollateralVault();
    const feed    = getSupraPriceFeed();

    const isActive = await factory.isActive(tokenId);
    if (!isActive) {
      throw new Error(`oCR #${tokenId} is not active`);
    }
    const valuationKesRaw = await factory.getValuation(tokenId);
    const farmerAddr      = await factory.ownerOf(tokenId);
    const receipt = {
      farmer:        farmerAddr,
      weightKg:      BigInt(40),
      commodityType: "MAIZE",
      warehouseId:   "WH-NKR-001",
      valuationKes:  valuationKesRaw,
    };

    // Fetch oracle price
    const [currentPriceKes] = await feed.getMaizePriceKes();
    const isStale = await feed.isStale();

    if (isStale) {
      logger.warn("Oracle price is stale — proceeding with last known price");
    }

    // Calculate loan
    const maxLoanUsdcH = await vault.getMaxLoan(tokenId);

    const proposal: LoanProposal = {
      tokenId,
      farmer:       receipt.farmer,
      weightKg:     Number(receipt.weightKg),
      valuationKes: BigInt(receipt.valuationKes.toString()),
      maxLoanUsdcH: BigInt(maxLoanUsdcH.toString()),
      ltvBps:       DEFAULT_LTV_BPS,
      explanation:  "",
    };

    // Claude explanation
    proposal.explanation = await this.generateLoanExplanation(proposal, currentPriceKes);

    logger.info("LoanAgent: loan proposal generated", {
      tokenId:      tokenId.toString(),
      farmer:       receipt.farmer,
      weightKg:     proposal.weightKg,
      maxLoanUsdcH: formatUsdc(proposal.maxLoanUsdcH),
    });

    if (farmerTelegramChatId) {
      const msg =
        `🌽 *Loan Offer — oCR #${tokenId}*\n\n` +
        `${proposal.explanation}\n\n` +
        `💰 *Max Loan:* $${formatUsdc(proposal.maxLoanUsdcH)} USDC-H\n` +
        `📊 *LTV:* 60%\n` +
        `📦 *Commodity:* ${proposal.weightKg}kg ${receipt.commodityType}\n` +
        `🏭 *Warehouse:* ${receipt.warehouseId}\n\n` +
        `Reply */accept ${tokenId}* to accept this loan offer.`;

      await sendTelegramMessage(msg, farmerTelegramChatId);
    }

    return proposal;
  }

  async executeLoan(tokenId: bigint, farmerAddress: string): Promise<bigint> {
    const vault = getCollateralVault();

    logger.info("LoanAgent: executing loan", {
      tokenId:       tokenId.toString(),
      farmerAddress,
    });

    const lockTx = await vault.lockCollateral(tokenId, { gasLimit: 300_000 });
    const lockReceipt = await lockTx.wait();

    let loanId = 0n;
    const iface = vault.interface;
    for (const log of lockReceipt?.logs ?? []) {
      try {
        const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
        if (parsed?.name === "CollateralLocked") {
          loanId = parsed.args.loanId as bigint;
          break;
        }
      } catch { /* not our event */ }
    }

    const issueTx = await vault.issueLoan(loanId, DEFAULT_LTV_BPS, { gasLimit: 300_000 });
    await issueTx.wait();

    try {
      const shamba = getShambaToken();
      await (await shamba.rewardLoanIssuance(this.agentAddress, { gasLimit: 300_000 })).wait();
    } catch { /* non-critical */ }

    logger.info("LoanAgent: loan issued", { loanId: loanId.toString(), tokenId: tokenId.toString() });

    return loanId;
  }

  private async generateLoanExplanation(
    proposal: LoanProposal,
    currentPriceKes: bigint
  ): Promise<string> {
    try {
      const kesPerKg   = Number(currentPriceKes) / 1e18;
      const totalKes   = kesPerKg * proposal.weightKg;
      const loanUsd    = Number(proposal.maxLoanUsdcH) / 1e6;

      const res = await anthropic.messages.create({
        model:      "claude-sonnet-4-20250514",
        max_tokens: 150,
        messages: [{
          role:    "user",
          content:
            `You are a friendly agricultural loan agent in Kenya. In 2-3 short sentences, explain to a farmer in simple English that:\n` +
            `- Their ${proposal.weightKg}kg of maize stored in the warehouse is worth KES ${totalKes.toFixed(0)}\n` +
            `- They can borrow up to $${loanUsd.toFixed(2)} USDC (60% of value) against it\n` +
            `- They keep ownership of their grain while borrowing\n` +
            `Be warm, encouraging, and clear. No jargon.`,
        }],
      });

      return (res.content[0] as { text: string }).text.trim();
    } catch {
      const loanUsd = (Number(proposal.maxLoanUsdcH) / 1e6).toFixed(2);
      return `Your ${proposal.weightKg}kg of stored maize qualifies you for a loan of up to $${loanUsd} USDC-H at 60% LTV.`;
    }
  }
}

function formatUsdc(amount: bigint): string {
  return (Number(amount) / 1e6).toFixed(2);
}