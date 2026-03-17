import { DepositEventPayload, HcsWriteResult, ShambaHcsEvent } from "./hcs.types";
export declare function writeDepositEvent(payload: DepositEventPayload): Promise<HcsWriteResult>;
export declare function writeHcsEvent(event: ShambaHcsEvent): Promise<HcsWriteResult>;
//# sourceMappingURL=writer.d.ts.map