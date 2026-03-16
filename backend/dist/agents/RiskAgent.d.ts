/**
 * RiskAgent — runs every 10 minutes.
 *
 * Responsibilities:
 *   1. Scan all active loans for LTV health
 *   2. Trigger RiskOracle valuation updates on Hedera EVM
 *   3. Alert farmers when LTV approaches liquidation threshold
 *   4. Auto-liquidate positions that exceed 80% LTV
 *   5. Force-resolve RiskMarket prediction markets on liquidation
 *   6. Write all risk events to HCS for audit trail
 *   7. Use Claude to generate risk summaries for the dashboard
 *   8. Earn SHAMBA rewards for successful risk checks + liquidations
 */
export declare class RiskAgent {
    private agentAddress;
    private monitoredTokenIds;
    private running;
    private alertedLoans;
    constructor();
    start(): void;
    /**
     * Add a tokenId to the monitor list (called when a new oCR is minted).
     */
    addToMonitor(tokenId: number): void;
    runRiskScan(): Promise<void>;
    private triggerValuationUpdate;
    private handleWarning;
    private handleLiquidation;
    private subscribeToLiquidationEvents;
    private discoverActiveTokens;
    private generateLiquidationExplanation;
}
//# sourceMappingURL=RiskAgent.d.ts.map