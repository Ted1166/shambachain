import { getReceiptFactory } from "../config/contracts";
import { logger } from "../utils/logger";

export interface MintReceiptParams {
  custodian:         string;
  farmer:            string;
  commodityType:     string;
  weightKg:          number;
  grade:             number;
  warehouseId:       string;
  mpesaRef:          string;
  hcsSequenceNumber: bigint;
  initialValuationKes: bigint;
  metadataURI:       string;
}

export async function mintReceipt(params: MintReceiptParams): Promise<bigint> {
  const factory = getReceiptFactory();

  logger.info("Minting oCR NFT", {
    mpesaRef:    params.mpesaRef,
    custodian:   params.custodian,
    farmer:      params.farmer,
    warehouseId: params.warehouseId,
    weightKg:    params.weightKg,
    hcsSequence: params.hcsSequenceNumber.toString(),
  });

  const tx = await factory.mintReceipt(
    params.custodian,
    params.farmer,
    params.commodityType,
    params.weightKg,
    params.grade,
    params.warehouseId,
    params.mpesaRef,
    params.hcsSequenceNumber,
    params.initialValuationKes,
    params.metadataURI,
    { gasLimit: 500_000 }
  );

  const receipt = await tx.wait();

  const iface = factory.interface;
  let tokenId = 0n;
  for (const log of receipt?.logs ?? []) {
    try {
      const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
      if (parsed?.name === "ReceiptMinted") {
        tokenId = parsed.args.tokenId as bigint;
        break;
      }
    } catch { /* not our event */ }
  }

  logger.info("oCR NFT minted successfully", {
    tokenId:     tokenId.toString(),
    mpesaRef:    params.mpesaRef,
    txHash:      receipt?.hash,
    blockNumber: receipt?.blockNumber,
  });

  return tokenId;
}

export function estimateValuationKes(weightKg: number, priceKesPerKg = 45): bigint {
  return BigInt(weightKg) * BigInt(priceKesPerKg) * 10n ** 18n;
}
