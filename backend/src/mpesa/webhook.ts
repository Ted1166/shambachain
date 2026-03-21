import { Request, Response } from "express";
import { StkCallback, MpesaPaymentConfirmed } from "./mpesa.types";
import { pendingStkPushes } from "./stk-push";
import { writeDepositEvent } from "../hcs/writer";
import { mintReceipt, estimateValuationKes } from "../minter/receipt-minter";
import { logger } from "../utils/logger";
import * as dotenv from "dotenv";
dotenv.config();

const PROTOCOL_CUSTODIAN = process.env.ADMIN_ADDRESS ?? "";

export async function mpesaCallbackHandler(req: Request, res: Response): Promise<void> {
  res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });

  const body: StkCallback = req.body;

  try {
    const cb = body.Body.stkCallback;

    logger.info("MPESA callback received", {
      checkoutRequestId: cb.CheckoutRequestID,
      resultCode:        cb.ResultCode,
    });

    if (cb.ResultCode !== 0) {
      logger.warn("STK Push failed", { resultDesc: cb.ResultDesc });
      const pending = pendingStkPushes.get(cb.CheckoutRequestID);
      if (pending) pending.status = "failed";
      return;
    }

    const items = cb.CallbackMetadata?.Item ?? [];
    const get = (name: string) => items.find((i) => i.Name === name)?.Value;

    const mpesaReceiptNumber = String(get("MpesaReceiptNumber") ?? "");
    const amount             = Number(get("Amount") ?? 0);
    const phoneNumber        = String(get("PhoneNumber") ?? "");
    const transactionDate    = String(get("TransactionDate") ?? "");

    if (!mpesaReceiptNumber) {
      logger.error("MPESA callback missing receipt number", { cb });
      return;
    }

    let pending = pendingStkPushes.get(cb.CheckoutRequestID);
    if (!pending) {
      logger.warn("No pending STK push found — creating synthetic entry for demo", { id: cb.CheckoutRequestID });
      // Create a synthetic pending entry for direct callback testing
      pending = {
        checkoutRequestId: cb.CheckoutRequestID,
        merchantRequestId: cb.MerchantRequestID,
        phoneNumber,
        amount,
        accountRef: "WH-NKR-001",
        initiatedAt: new Date(),
        status: "confirmed",
      };
    } else {
      pending.status = "confirmed";
    }

    logger.info("MPESA payment confirmed", {
      receipt:   mpesaReceiptNumber,
      amount,
      phone:     phoneNumber,
      warehouse: pending.accountRef,
    });

    const hcsResult = await writeDepositEvent({
      mpesaRef:    mpesaReceiptNumber,
      phoneNumber,
      amount,
      warehouseId: pending.accountRef,
      timestamp:   transactionDate,
    });

    logger.info("HCS deposit event written", {
      topicId:        hcsResult.topicId,
      sequenceNumber: hcsResult.sequenceNumber,
    });

    const estimatedWeightKg   = Math.max(1, Math.floor(amount / 2.5));
    const initialValuationKes = estimateValuationKes(estimatedWeightKg, 45);

    const tokenId = await mintReceipt({
      custodian:           PROTOCOL_CUSTODIAN,
      farmer:              PROTOCOL_CUSTODIAN,
      commodityType:       "MAIZE",
      weightKg:            estimatedWeightKg,
      grade:               0,
      warehouseId:         pending.accountRef,
      mpesaRef:            mpesaReceiptNumber,
      hcsSequenceNumber:   BigInt(hcsResult.sequenceNumber),
      initialValuationKes,
      metadataURI:         `ipfs://QmShamba_${mpesaReceiptNumber}`,
    });

    logger.info("oCR NFT minted", {
      tokenId:     tokenId.toString(),
      mpesaRef:    mpesaReceiptNumber,
      weightKg:    estimatedWeightKg,
      hcsSequence: hcsResult.sequenceNumber,
    });

    const { LoanAgent } = await import("../agents/LoanAgent");
    const loanAgent = new LoanAgent();
    await loanAgent.proposeLoan(tokenId).catch(err =>
      logger.warn("LoanAgent proposal failed", { err })
    );

  } catch (err) {
    logger.error("Error processing MPESA callback", { err });
  }
}
