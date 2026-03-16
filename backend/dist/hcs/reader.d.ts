import { HcsMessage, ShambaHcsEvent } from "./hcs.types";
/**
 * Fetch HCS messages from the Hedera Mirror Node REST API.
 * Used by the backend to verify deposit events and by the dashboard.
 *
 * Mirror node endpoint:
 *   GET /api/v1/topics/{topicId}/messages?limit=25&order=desc
 */
export declare function getTopicMessages(topicId?: string, limit?: number, order?: "asc" | "desc"): Promise<HcsMessage[]>;
/**
 * Fetch a single HCS message by sequence number.
 */
export declare function getMessageBySequence(sequenceNumber: number, topicId?: string): Promise<HcsMessage | null>;
/**
 * Fetch and parse all DEPOSIT events from the HCS topic.
 */
export declare function getDepositEvents(limit?: number): Promise<ShambaHcsEvent[]>;
/**
 * Verify that a given MPESA ref exists in the HCS audit trail.
 * Called by the minter before calling mintReceipt() as an extra guard.
 */
export declare function verifyMpesaRefOnHcs(mpesaRef: string): Promise<boolean>;
//# sourceMappingURL=reader.d.ts.map