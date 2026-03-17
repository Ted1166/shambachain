"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mintReceipt = mintReceipt;
exports.estimateValuationKes = estimateValuationKes;
const contracts_1 = require("../config/contracts");
const logger_1 = require("../utils/logger");
async function mintReceipt(params) {
    const factory = (0, contracts_1.getReceiptFactory)();
    logger_1.logger.info("Minting oCR NFT", {
        mpesaRef: params.mpesaRef,
        custodian: params.custodian,
        farmer: params.farmer,
        warehouseId: params.warehouseId,
        weightKg: params.weightKg,
        hcsSequence: params.hcsSequenceNumber.toString(),
    });
    const tx = await factory.mintReceipt(params.custodian, params.farmer, params.commodityType, params.weightKg, params.grade, params.warehouseId, params.mpesaRef, params.hcsSequenceNumber, params.initialValuationKes, params.metadataURI, { gasLimit: 500_000 });
    const receipt = await tx.wait();
    const iface = factory.interface;
    let tokenId = 0n;
    for (const log of receipt?.logs ?? []) {
        try {
            const parsed = iface.parseLog({ topics: log.topics, data: log.data });
            if (parsed?.name === "ReceiptMinted") {
                tokenId = parsed.args.tokenId;
                break;
            }
        }
        catch { /* not our event */ }
    }
    logger_1.logger.info("oCR NFT minted successfully", {
        tokenId: tokenId.toString(),
        mpesaRef: params.mpesaRef,
        txHash: receipt?.hash,
        blockNumber: receipt?.blockNumber,
    });
    return tokenId;
}
function estimateValuationKes(weightKg, priceKesPerKg = 45) {
    return BigInt(weightKg) * BigInt(priceKesPerKg) * 10n ** 18n;
}
//# sourceMappingURL=receipt-minter.js.map