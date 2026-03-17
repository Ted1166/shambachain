export declare class RiskAgent {
    private agentAddress;
    private monitoredTokenIds;
    private running;
    private alertedLoans;
    constructor();
    start(): void;
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