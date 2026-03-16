import axios from "axios";
import { MIRROR_NODE_URL } from "../config/hedera";
import { HcsMessage, ShambaHcsEvent } from "./hcs.types";
import { logger } from "../utils/logger";
import * as dotenv from "dotenv";
dotenv.config();

const HCS_TOPIC_ID = process.env.HCS_DEPOSIT_TOPIC_ID ?? "";

export async function getTopicMessages(
  topicId: string = HCS_TOPIC_ID,
  limit = 25,
  order: "asc" | "desc" = "desc"
): Promise<HcsMessage[]> {
  const url = `${MIRROR_NODE_URL}/api/v1/topics/${topicId}/messages`;

  const res = await axios.get(url, {
    params: { limit, order },
  });

  const raw: any[] = res.data.messages ?? [];

  return raw.map((m) => ({
    sequenceNumber:     m.sequence_number,
    consensusTimestamp: m.consensus_timestamp,
    contents:           decodeBase64(m.message),
    runningHash:        m.running_hash,
  }));
}

export async function getMessageBySequence(
  sequenceNumber: number,
  topicId: string = HCS_TOPIC_ID
): Promise<HcsMessage | null> {
  try {
    const url = `${MIRROR_NODE_URL}/api/v1/topics/${topicId}/messages/${sequenceNumber}`;
    const res = await axios.get(url);
    const m   = res.data;
    return {
      sequenceNumber:     m.sequence_number,
      consensusTimestamp: m.consensus_timestamp,
      contents:           decodeBase64(m.message),
      runningHash:        m.running_hash,
    };
  } catch (err) {
    logger.warn(`HCS message #${sequenceNumber} not found`, { topicId });
    return null;
  }
}

export async function getDepositEvents(
  limit = 50
): Promise<ShambaHcsEvent[]> {
  const messages = await getTopicMessages(HCS_TOPIC_ID, limit, "desc");

  const events: ShambaHcsEvent[] = [];
  for (const msg of messages) {
    try {
      const event = JSON.parse(msg.contents) as ShambaHcsEvent;
      if (event.type === "DEPOSIT") {
        events.push(event);
      }
    } catch {
    }
  }
  return events;
}

export async function verifyMpesaRefOnHcs(mpesaRef: string): Promise<boolean> {
  const events = await getDepositEvents(100);
  return events.some((e) => e.mpesaRef === mpesaRef);
}


function decodeBase64(b64: string): string {
  try {
    return Buffer.from(b64, "base64").toString("utf-8");
  } catch {
    return b64;
  }
}