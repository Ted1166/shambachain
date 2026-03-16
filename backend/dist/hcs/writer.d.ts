import { DepositEventPayload, HcsWriteResult, ShambaHcsEvent } from "./hcs.types";
/**
 * Write a MPESA deposit confirmation event to the ShambaChain HCS topic.
 *
 * Each message is a JSON-encoded ShambaHcsEvent. The returned sequence number
 * is stored on-chain in the oCR NFT as an immutable audit trail reference.
 *
 * HCS properties that make this audit-proof:
 *   - Consensus timestamp is set by the Hedera network (not the submitter)
 *   - Sequence numbers are monotonically increasing
 *   - Content is immutable once submitted
 *   - Anyone can verify via mirror node: https://testnet.mirrornode.hedera.com/api/v1/topics/{topicId}/messages
 */
export declare function writeDepositEvent(payload: DepositEventPayload): Promise<HcsWriteResult>;
/**
 * Write a generic ShambaChain event to HCS.
 * Used by RiskAgent to log valuation updates, liquidations, etc.
 */
export declare function writeHcsEvent(event: ShambaHcsEvent): Promise<HcsWriteResult>;
//# sourceMappingURL=writer.d.ts.map