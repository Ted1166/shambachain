export interface LoanProposal {
    tokenId: bigint;
    farmer: string;
    weightKg: number;
    valuationKes: bigint;
    maxLoanUsdcH: bigint;
    ltvBps: number;
    explanation: string;
}
/**
 * LoanAgent — evaluates oCR receipts and proposes loans to farmers via Telegram.
 *
 * Triggered when:
 *   1. A new oCR NFT is minted (called from webhook.ts)
 *   2. A farmer sends "/loan <tokenId>" via Telegram bot
 *
 * Responsibilities:
 *   1. Fetch receipt + current oracle price
 *   2. Calculate max loan amount at 60% LTV
 *   3. Use Claude to generate human-readable loan offer explanation
 *   4. Send proposal to farmer via Telegram (in Swahili or English)
 *   5. Execute lockCollateral + issueLoan when farmer confirms
 *   6. Earn SHAMBA reward on successful issuance
 */
export declare class LoanAgent {
    private agentAddress;
    constructor();
    /**
     * Evaluate a newly minted oCR and send loan proposal to farmer.
     */
    proposeLoan(tokenId: bigint, farmerTelegramChatId?: string): Promise<LoanProposal>;
    /**
     * Execute the loan after farmer acceptance.
     * Called by bot.ts when farmer replies "/accept <tokenId>"
     */
    executeLoan(tokenId: bigint, farmerAddress: string): Promise<bigint>;
    /**
     * Use Claude to generate a farmer-friendly loan offer explanation.
     */
    private generateLoanExplanation;
}
//# sourceMappingURL=LoanAgent.d.ts.map