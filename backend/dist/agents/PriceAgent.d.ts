export declare class PriceAgent {
    private agentAddress;
    private running;
    constructor();
    start(): void;
    tick(): Promise<void>;
    checkPrice(): Promise<void>;
    private generateCommentary;
}
//# sourceMappingURL=PriceAgent.d.ts.map