import {
  TopicMessageSubmitTransaction,
  TopicId,
  TransactionId,
} from "@hashgraph/sdk";
import { hederaClient, HEDERA_NETWORK } from "../config/hedera";
import { DepositEventPayload, HcsWriteResult, ShambaHcsEvent } from "./hcs.types";
import { logger } from "../utils/logger";
import * as dotenv from "dotenv";
dotenv.config();

const HCS_TOPIC_ID = process.env.HCS_DEPOSIT_TOPIC_ID ?? "";

export async function writeDepositEvent(
  payload: DepositEventPayload
): Promise<HcsWriteResult> {
  if (!HCS_TOPIC_ID) {
    throw new Error("HCS_DEPOSIT_TOPIC_ID not set in environment");
  }

  const event: ShambaHcsEvent = {
    type:        "DEPOSIT",
    version:     "1.0",
    mpesaRef:    payload.mpesaRef,
    phoneNumber: payload.phoneNumber,
    amount:      payload.amount,
    warehouseId: payload.warehouseId,
    timestamp:   payload.timestamp,
    network:     HEDERA_NETWORK,
  };

  const message = JSON.stringify(event);

  const topicId = TopicId.fromString(HCS_TOPIC_ID);

  const tx = await new TopicMessageSubmitTransaction()
    .setTopicId(topicId)
    .setMessage(message)
    .execute(hederaClient);

  const receipt = await tx.getReceipt(hederaClient);

  const sequenceNumber = receipt.topicSequenceNumber?.toNumber() ?? 0;

  const result: HcsWriteResult = {
    topicId:            HCS_TOPIC_ID,
    sequenceNumber,
    transactionId:      tx.transactionId?.toString() ?? "",
    consensusTimestamp: new Date().toISOString(),
  };

  logger.info("HCS deposit event written", {
    topicId:        HCS_TOPIC_ID,
    sequenceNumber,
    mpesaRef:       payload.mpesaRef,
    transactionId:  result.transactionId,
  });

  return result;
}

export async function writeHcsEvent(event: ShambaHcsEvent): Promise<HcsWriteResult> {
  if (!HCS_TOPIC_ID) {
    throw new Error("HCS_DEPOSIT_TOPIC_ID not set in environment");
  }

  const message = JSON.stringify(event);
  const topicId = TopicId.fromString(HCS_TOPIC_ID);

  const tx = await new TopicMessageSubmitTransaction()
    .setTopicId(topicId)
    .setMessage(message)
    .execute(hederaClient);

  const receipt = await tx.getReceipt(hederaClient);
  const sequenceNumber = receipt.topicSequenceNumber?.toNumber() ?? 0;

  return {
    topicId:            HCS_TOPIC_ID,
    sequenceNumber,
    transactionId:      tx.transactionId?.toString() ?? "",
    consensusTimestamp: new Date().toISOString(),
  };
}