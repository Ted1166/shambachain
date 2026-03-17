import { HcsMessage, ShambaHcsEvent } from "./hcs.types";
export declare function getTopicMessages(topicId?: string, limit?: number, order?: "asc" | "desc"): Promise<HcsMessage[]>;
export declare function getMessageBySequence(sequenceNumber: number, topicId?: string): Promise<HcsMessage | null>;
export declare function getDepositEvents(limit?: number): Promise<ShambaHcsEvent[]>;
export declare function verifyMpesaRefOnHcs(mpesaRef: string): Promise<boolean>;
//# sourceMappingURL=reader.d.ts.map