export interface LoanProposal {
    tokenId: bigint;
    farmer: string;
    weightKg: number;
    valuationKes: bigint;
    maxLoanUsdcH: bigint;
    ltvBps: number;
    explanation: string;
}
export declare class LoanAgent {
    private agentAddress;
    constructor();
    proposeLoan(tokenId: bigint, farmerTelegramChatId?: string): Promise<LoanProposal>;
    executeLoan(tokenId: bigint, farmerAddress: string): Promise<bigint>;
    private generateLoanExplanation;
}
//# sourceMappingURL=LoanAgent.d.ts.map