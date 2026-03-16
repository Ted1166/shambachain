/**
 * PriceAgent — runs every 5 minutes.
 *
 * Responsibilities:
 *   1. Poll SupraPriceFeed for latest maize KES/kg price
 *   2. Detect significant price moves (>= 5% change)
 *   3. Post price update to HCS for audit trail
 *   4. Send Telegram alert to farmers if price drops significantly
 *   5. Earn SHAMBA reward via ShambaToken.rewardPriceUpdate()
 *   6. Use Claude to generate a natural-language market commentary
 */
export declare class PriceAgent {
    private agentAddress;
    private running;
    constructor();
    start(): void;
    tick(): Promise<void>;
    checkPrice(): Promise<void>;
    /**
     * Use Claude to generate a 1-sentence Telegram-friendly market commentary.
     */
    private generateCommentary;
}
//# sourceMappingURL=PriceAgent.d.ts.map