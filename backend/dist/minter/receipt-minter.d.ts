export interface MintReceiptParams {
    custodian: string;
    farmer: string;
    commodityType: string;
    weightKg: number;
    grade: number;
    warehouseId: string;
    mpesaRef: string;
    hcsSequenceNumber: bigint;
    initialValuationKes: bigint;
    metadataURI: string;
}
export declare function mintReceipt(params: MintReceiptParams): Promise<bigint>;
export declare function estimateValuationKes(weightKg: number, priceKesPerKg?: number): bigint;
//# sourceMappingURL=receipt-minter.d.ts.map